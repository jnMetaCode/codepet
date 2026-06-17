/**
 * 本地持久化（主进程）。所有数据存 Electron userData 目录，纯本地。
 *   - config.json：用户配置（覆盖 config/default.json）
 *   - growth.json：成长状态（经验、等级、喂食次数等）
 */

const fs = require('fs');
const path = require('path');

let userDataDir = null;     // 由 main.js 注入（app.getPath('userData')）
let defaultConfig = {};

function init(dir, defaults) {
  userDataDir = dir;
  defaultConfig = defaults || {};
  try { fs.mkdirSync(userDataDir, { recursive: true }); } catch {}
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJson(file, obj) {
  try { fs.writeFileSync(file, JSON.stringify(obj, null, 2)); return true; } catch { return false; }
}

// 浅合并（用户配置覆盖默认，顶层按段合并）
function mergeConfig(base, over) {
  const out = { ...base };
  for (const k of Object.keys(over || {})) {
    if (over[k] && typeof over[k] === 'object' && !Array.isArray(over[k])) {
      out[k] = { ...(base[k] || {}), ...over[k] };
    } else {
      out[k] = over[k];
    }
  }
  return out;
}

function getConfig() {
  const userCfg = readJson(path.join(userDataDir, 'config.json'), {});
  return mergeConfig(defaultConfig, userCfg);
}

function setConfig(partial) {
  const cur = readJson(path.join(userDataDir, 'config.json'), {});
  const next = mergeConfig(cur, partial);
  writeJson(path.join(userDataDir, 'config.json'), next);
  return getConfig();
}

const DEFAULT_GROWTH = {
  totalExpBeforeToday: 0, // 今天之前累计的经验
  todayDate: '',          // 上次结算的日期 YYYY-MM-DD
  todayExp: 0,            // 今天已获得经验（结算缓存）
  level: 0,
  energy: 100,
  energyTs: 0,
  feedDate: '',
  feedCount: 0,
};

function getGrowth() {
  return { ...DEFAULT_GROWTH, ...readJson(path.join(userDataDir, 'growth.json'), {}) };
}
function setGrowth(g) {
  return writeJson(path.join(userDataDir, 'growth.json'), g);
}

module.exports = { init, getConfig, setConfig, getGrowth, setGrowth };
