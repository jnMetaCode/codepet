/**
 * Claude Code hooks 集成（主进程）：
 *   - install/uninstall：安全地把 recorder 装到 ~/.claude/hooks，
 *     并把 hooks 配置合并进 ~/.claude/settings.json（保留用户原有配置，可干净卸载）
 *   - watch：增量读取 ~/.claude/codepet-events.jsonl，把新事件回调出去
 *
 * 安全原则：只 opt-in；合并不破坏用户既有 settings；卸载只删我们加的部分。
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const RECORDER_SRC = path.join(__dirname, '../hooks/codepet-record.js');

// 与 stats.js 一致地解析 ~/.claude：配置覆盖 > CLAUDE_CONFIG_DIR > ~/.claude。
// 用 setConfigDir 注入桌宠设置里的 configDir，保证 install/watch/读事件三处路径一致。
let _configDir = '';
function setConfigDir(dir) { _configDir = dir || ''; }
function claudeDir() { return _configDir || process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'); }
function recorderDst() { return path.join(claudeDir(), 'hooks', 'codepet-record.js'); }
function settingsPath() { return path.join(claudeDir(), 'settings.json'); }
function eventsFile() { return path.join(claudeDir(), 'codepet-events.jsonl'); }

// 我们要挂的事件（都只旁路记录、不阻断）
const HOOK_EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop', 'SessionEnd'];
const MARK = 'codepet-record'; // 用命令里的这个子串识别"我们加的" hook

function nodeCommand() {
  // 跨平台：node 在 PATH（Claude Code 依赖 node）。引号处理空格路径。
  return `node "${recorderDst()}"`;
}

function readSettings() {
  try { return JSON.parse(fs.readFileSync(settingsPath(), 'utf8')); } catch { return {}; }
}
function writeSettings(obj) {
  fs.mkdirSync(claudeDir(), { recursive: true });
  fs.writeFileSync(settingsPath(), JSON.stringify(obj, null, 2));
}

function isOurGroup(group) {
  return group && Array.isArray(group.hooks) &&
    group.hooks.some((h) => typeof h.command === 'string' && h.command.includes(MARK));
}

function install() {
  // 1) 装 recorder 脚本
  const dst = recorderDst();
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(RECORDER_SRC, dst);
  try { fs.chmodSync(dst, 0o755); } catch {}

  // 2) 合并 settings.json
  const s = readSettings();
  if (!s.hooks || typeof s.hooks !== 'object') s.hooks = {};
  const cmd = nodeCommand();
  for (const ev of HOOK_EVENTS) {
    if (!Array.isArray(s.hooks[ev])) s.hooks[ev] = [];
    // 已存在我们的就跳过（幂等）
    if (s.hooks[ev].some(isOurGroup)) continue;
    s.hooks[ev].push({ matcher: '*', hooks: [{ type: 'command', command: cmd, timeout: 5 }] });
  }
  writeSettings(s);
  return status();
}

function uninstall() {
  const s = readSettings();
  if (s.hooks && typeof s.hooks === 'object') {
    for (const ev of Object.keys(s.hooks)) {
      if (!Array.isArray(s.hooks[ev])) continue;
      s.hooks[ev] = s.hooks[ev].filter((g) => !isOurGroup(g));
      if (s.hooks[ev].length === 0) delete s.hooks[ev];
    }
    if (Object.keys(s.hooks).length === 0) delete s.hooks;
    writeSettings(s);
  }
  try { fs.unlinkSync(recorderDst()); } catch {}
  // 事件历史文件保留（不删，便于继续统计）
  return status();
}

function status() {
  const s = readSettings();
  let installed = false;
  if (s.hooks && typeof s.hooks === 'object') {
    for (const ev of Object.keys(s.hooks)) {
      if (Array.isArray(s.hooks[ev]) && s.hooks[ev].some(isOurGroup)) { installed = true; break; }
    }
  }
  return { installed, recorderExists: fs.existsSync(recorderDst()), eventsFile: eventsFile() };
}

// ---------- 事件文件监听（增量） ----------

let _offset = 0;
let _watching = false;

let _watchedFile = '';
function startWatch(onEvent) {
  if (_watching) return;
  _watching = true;
  const file = eventsFile();
  _watchedFile = file;
  try { _offset = fs.statSync(file).size; } catch { _offset = 0; }

  fs.watchFile(file, { interval: 400 }, (curr) => {
    if (curr.size < _offset) _offset = 0; // 文件被截断/轮换
    if (curr.size <= _offset) return;
    let chunk = '';
    try {
      const fd = fs.openSync(file, 'r');
      const buf = Buffer.alloc(curr.size - _offset);
      fs.readSync(fd, buf, 0, buf.length, _offset);
      fs.closeSync(fd);
      chunk = buf.toString('utf8');
    } catch { return; }
    _offset = curr.size;
    for (const line of chunk.split('\n')) {
      if (!line.trim()) continue;
      try { onEvent(JSON.parse(line)); } catch {}
    }
  });
}

function stopWatch() {
  if (_watching) { fs.unwatchFile(_watchedFile); _watching = false; }
}

module.exports = { setConfigDir, install, uninstall, status, startWatch, stopWatch, eventsFile };
