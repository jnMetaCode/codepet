#!/usr/bin/env node
/**
 * 码宠 · Claude Code hook 记录器（会被安装到 ~/.claude/hooks/codepet-record.js）。
 *
 * 绝对安全、绝不影响用户正常使用 Claude Code：
 *   - 永远 exit 0（绝不返回 2，不阻断任何操作）
 *   - 从不向 stdout 写任何东西（不干扰 Claude Code 解析）
 *   - 只读 stdin 的事件元数据，写一行紧凑记录到事件文件
 *   - 任何异常都静默吞掉；3 秒内必退出
 *   - 只记录元数据（事件名/工具名/会话id/cwd），绝不记录 prompt 或对话正文
 *
 * 跨平台：用 node 执行（Claude Code 本身依赖 node，故 node 一定在 PATH）。
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const KILL = setTimeout(() => process.exit(0), 3000);
KILL.unref && KILL.unref();

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => { raw += d; if (raw.length > 1e6) raw = raw.slice(0, 1e6); });
process.stdin.on('error', () => process.exit(0));
process.stdin.on('end', () => {
  try {
    const e = JSON.parse(raw || '{}');
    // 只取元数据，绝不取消息正文 / tool_input 细节
    const rec = {
      t: Date.now(),
      ev: e.hook_event_name || '',
      tool: e.tool_name || '',
      sid: e.session_id || '',
      cwd: e.cwd || '',
    };
    const dir = path.join(os.homedir(), '.claude');
    try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
    fs.appendFileSync(path.join(dir, 'codepet-events.jsonl'), JSON.stringify(rec) + '\n');
  } catch (_) { /* 静默 */ }
  process.exit(0);
});
