/**
 * 码宠核心数据采集模块（主进程）
 *
 * 两个数据源，都只读本机本地数据，绝不外传：
 *   1) Git：对配置的本地仓库跑 git log，统计今日 commits / 增删行数
 *   2) Claude Code：读 ~/.claude/projects 下的 jsonl，统计今日请求/会话/输出 token
 *
 * 隐私：只读聚合统计，不解析对话正文（对齐官方 Issue #59081）。
 *
 * 设计要点（来自实测，见 需求文档 §5.2）：
 *   - jsonl 里 message.usage.input_tokens 约 75% 是 0/1 占位值，不可信。
 *     所以经验用「请求次数 / 会话数」这类计数型指标当主力，token 仅粗粒度参考。
 *   - 2885+ 个 jsonl 文件全量逐行读会慢，用文件 mtime 先过滤：
 *     今天没改动过的文件不可能含今天的行，直接跳过。
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const { execFile } = require('child_process');

// ---------- 工具：今天的本地零点（用本地时区判断"今天"） ----------

function startOfToday() {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime();
}

/** ISO 时间戳是否落在今天（本地时区） */
function isToday(iso, todayStart) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return false;
  return t >= todayStart && t < todayStart + 86400000;
}

// ---------- Claude Code 用量 ----------

/** 解析出 ~/.claude 目录（跨平台）。优先级：参数 > CLAUDE_CONFIG_DIR > ~/.claude */
function resolveClaudeDir(configDir) {
  if (configDir) return configDir;
  if (process.env.CLAUDE_CONFIG_DIR) return process.env.CLAUDE_CONFIG_DIR;
  return path.join(os.homedir(), '.claude'); // Windows 下 homedir() 即 %USERPROFILE%
}

/** 递归收集 projects 下所有 jsonl 文件路径 */
function collectJsonlFiles(projectsDir) {
  const out = [];
  let entries;
  try {
    entries = fs.readdirSync(projectsDir, { withFileTypes: true });
  } catch {
    return out; // 目录不存在
  }
  for (const e of entries) {
    const full = path.join(projectsDir, e.name);
    if (e.isDirectory()) out.push(...collectJsonlFiles(full));
    else if (e.isFile() && e.name.endsWith('.jsonl')) out.push(full);
  }
  return out;
}

/** 是否是用户真实输入的 prompt（排除工具结果回显） */
function isRealPrompt(o) {
  const c = o.message && o.message.content;
  if (typeof c === 'string') return true;
  if (Array.isArray(c)) return !c.some((b) => b && b.type === 'tool_result');
  return false;
}

/**
 * 逐行读一个 jsonl，累加今天的指标：
 *   ccRequests = 用户真实提问轮次（比 assistant 条数诚实得多，避免一天冲到几十级）
 *   ccOutputTokens = assistant 输出 token 累加（粗粒度参考）
 */
function scanJsonlFile(file, todayStart, acc) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: fs.createReadStream(file, { encoding: 'utf8' }),
      crlfDelay: Infinity,
    });
    rl.on('line', (line) => {
      if (!line) return;
      // 快速预筛：只解析 user / assistant 行
      const isUser = line.indexOf('"type":"user"') !== -1;
      const isAsst = !isUser && line.indexOf('"type":"assistant"') !== -1;
      if (!isUser && !isAsst) return;
      let o;
      try { o = JSON.parse(line); } catch { return; }
      if (!o.timestamp || !isToday(o.timestamp, todayStart)) return;
      if (o.sessionId) acc.sessions.add(o.sessionId);
      if (o.type === 'assistant') {
        const u = o.message && o.message.usage;
        if (u && typeof u.output_tokens === 'number') acc.ccOutputTokens += u.output_tokens;
      } else if (o.type === 'user' && !o.isSidechain && isRealPrompt(o)) {
        acc.ccRequests += 1; // 真实提问轮次
      }
    });
    rl.on('close', resolve);
    rl.on('error', resolve); // 单个文件坏了不影响整体
  });
}

async function getClaudeStats(configDir) {
  const todayStart = startOfToday();
  const claudeDir = resolveClaudeDir(configDir);
  const projectsDir = path.join(claudeDir, 'projects');

  const acc = { ccRequests: 0, ccOutputTokens: 0, sessions: new Set() };

  const files = collectJsonlFiles(projectsDir);
  // mtime 过滤：今天没动过的文件不可能含今天的行
  const todayFiles = files.filter((f) => {
    try { return fs.statSync(f).mtimeMs >= todayStart; } catch { return false; }
  });

  for (const f of todayFiles) {
    await scanJsonlFile(f, todayStart, acc);
  }

  return {
    ccRequests: acc.ccRequests,
    ccSessions: acc.sessions.size,
    ccOutputTokens: acc.ccOutputTokens,
    _scanned: { totalFiles: files.length, todayFiles: todayFiles.length },
  };
}

// ---------- Claude Code 实时事件（hooks 写入，更诚实的指标） ----------

/**
 * 读 ~/.claude/codepet-events.jsonl，统计今日有意义事件：
 *   prompts = 提交的 prompt 数（你的投入）
 *   tasks   = 完成的回应数 Stop（产出）
 *   tools   = 工具调用数 PreToolUse
 *   sessions= 今日活跃会话数
 * 这些是"干了多少活"，比 token 数诚实。
 */
function getEventStats(configDir, todayStart) {
  const claudeDir = resolveClaudeDir(configDir);
  const file = path.join(claudeDir, 'codepet-events.jsonl');
  const acc = { prompts: 0, tasks: 0, tools: 0, sessions: new Set(), count: 0 };
  let content;
  try { content = fs.readFileSync(file, 'utf8'); } catch { return { ...acc, sessions: 0, active: false }; }
  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    let o; try { o = JSON.parse(line); } catch { continue; }
    if (typeof o.t !== 'number' || o.t < todayStart || o.t >= todayStart + 86400000) continue;
    acc.count += 1;
    if (o.sid) acc.sessions.add(o.sid);
    if (o.ev === 'UserPromptSubmit') acc.prompts += 1;
    else if (o.ev === 'Stop') acc.tasks += 1;
    else if (o.ev === 'PreToolUse') acc.tools += 1;
  }
  return { prompts: acc.prompts, tasks: acc.tasks, tools: acc.tools, sessions: acc.sessions.size, active: acc.count > 0 };
}

// ---------- Git 用量 ----------

function gitLogNumstat(repoDir, authorFilter) {
  return new Promise((resolve) => {
    const args = ['log', '--since=00:00:00', '--pretty=tformat:--C--', '--numstat'];
    if (authorFilter) args.push(`--author=${authorFilter}`);
    execFile('git', args, { cwd: repoDir, maxBuffer: 1024 * 1024 * 32 }, (err, stdout) => {
      if (err) { resolve({ commits: 0, linesAdded: 0, linesDeleted: 0, ok: false }); return; }
      let commits = 0, linesAdded = 0, linesDeleted = 0;
      for (const raw of stdout.split('\n')) {
        const line = raw.trim();
        if (!line) continue;
        if (line === '--C--') { commits += 1; continue; }
        // numstat 行：<added>\t<deleted>\t<path>；二进制文件是 "-"
        const m = line.split('\t');
        if (m.length >= 2) {
          const a = parseInt(m[0], 10);
          const d = parseInt(m[1], 10);
          if (!Number.isNaN(a)) linesAdded += a;
          if (!Number.isNaN(d)) linesDeleted += d;
        }
      }
      resolve({ commits, linesAdded, linesDeleted, ok: true });
    });
  });
}

async function getGitStats(repoDirs, authorFilter) {
  const totals = { commits: 0, linesAdded: 0, linesDeleted: 0, repos: [] };
  for (const dir of repoDirs || []) {
    const r = await gitLogNumstat(dir, authorFilter);
    totals.commits += r.commits;
    totals.linesAdded += r.linesAdded;
    totals.linesDeleted += r.linesDeleted;
    totals.repos.push({ dir, ...r });
  }
  return totals;
}

// ---------- 汇总 ----------

/**
 * @param {object} config 见 config/default.json 结构
 * @returns {Promise<{commits,linesAdded,linesDeleted,ccRequests,ccSessions,ccOutputTokens}>}
 */
async function getTodayStats(config = {}) {
  const claudeCfg = config.claude || {};
  const gitCfg = config.git || {};
  const todayStart = startOfToday();
  const ccOff = claudeCfg.enabled === false;

  const [git, claude] = await Promise.all([
    getGitStats(gitCfg.repos, gitCfg.authorFilter),
    ccOff ? Promise.resolve({ ccRequests: 0, ccSessions: 0, ccOutputTokens: 0 })
          : getClaudeStats(claudeCfg.configDir),
  ]);

  // 事件文件（hooks）优先；没有则回退 jsonl 计数
  const ev = ccOff ? { prompts: 0, tasks: 0, tools: 0, sessions: 0, active: false }
                   : getEventStats(claudeCfg.configDir, todayStart);

  return {
    commits: git.commits,
    linesAdded: git.linesAdded,
    linesDeleted: git.linesDeleted,
    // 诚实指标（来自 hooks 实时事件）
    prompts: ev.prompts,
    tasks: ev.tasks,
    tools: ev.tools,
    eventsActive: ev.active,
    // jsonl 回填指标（事件文件缺失时用）
    ccRequests: claude.ccRequests,
    ccSessions: ev.active ? ev.sessions : claude.ccSessions,
    ccOutputTokens: claude.ccOutputTokens,
    _detail: { git: git.repos, claude: claude._scanned, eventsActive: ev.active },
  };
}

module.exports = { getTodayStats, getClaudeStats, getGitStats };

// ---------- CLI：node stats.js [git仓库目录...] ----------
if (require.main === module) {
  const repos = process.argv.slice(2);
  const t0 = Date.now();
  getTodayStats({
    claude: { enabled: true },
    git: { repos },
  }).then((s) => {
    const ms = Date.now() - t0;
    console.log('\n=== 码宠 · 今日数据 ===');
    console.log(`Git     commits=${s.commits}  +${s.linesAdded} / -${s.linesDeleted} 行`);
    if (s.eventsActive) {
      console.log(`Claude  [hooks 实时] prompts=${s.prompts}  tasks=${s.tasks}  tools=${s.tools}  会话=${s.ccSessions}`);
    } else {
      console.log(`Claude  [jsonl 回填] 提问=${s.ccRequests}  会话=${s.ccSessions}  (未装 hooks，建议开启实时联动)`);
    }
    const cc = s.eventsActive ? (s.prompts * 4 + s.tasks * 8 + s.tools * 1) : (s.ccRequests * 3 + s.ccSessions * 5);
    const exp = s.commits * 10 + (s.linesAdded + s.linesDeleted) * 0.1 + cc;
    console.log(`经验    ${exp.toFixed(1)}  →  ${Math.floor(exp / 100)} 级`);
    console.log(`耗时    ${ms}ms\n`);
  });
}
