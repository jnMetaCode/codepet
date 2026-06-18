/**
 * growth.js 纯逻辑单测。跑：npm test （node --test）
 * 覆盖：经验公式 / 升级 / 跨天结算 / 连续打卡 streak / 能量衰减 / 喂食额度。
 */
const test = require('node:test');
const assert = require('node:assert');
const G = require('../src/renderer/growth.js');
const cfg = require('../config/default.json');

const DAY = 86400000;
const BASE = 1700000000000; // 固定时间起点，避免依赖真实时钟
const stats = (o = {}) => Object.assign(
  { commits: 0, linesAdded: 0, linesDeleted: 0, prompts: 0, tasks: 0, tools: 0, eventsActive: false, ccRequests: 0, ccSessions: 0 },
  o);

test('computeTodayExp · 实时事件模式', () => {
  const e = G.computeTodayExp(stats({ eventsActive: true, prompts: 2, tasks: 1, tools: 5, commits: 1, linesAdded: 10 }), cfg.exp);
  assert.strictEqual(e, 1 * 10 + 10 * 0.1 + (2 * 4 + 1 * 8 + 5 * 1)); // 32
});

test('computeTodayExp · jsonl 回退模式', () => {
  const e = G.computeTodayExp(stats({ ccRequests: 2, ccSessions: 1 }), cfg.exp);
  assert.strictEqual(e, 2 * cfg.exp.perCcRequest + 1 * cfg.exp.perCcSession); // 11
});

test('pickState · 阈值选择', () => {
  assert.strictEqual(G.pickState(0, cfg.states.thresholds).key, 'idle');
  assert.strictEqual(G.pickState(200, cfg.states.thresholds).key, 'beast');
});

test('settle · 升级', () => {
  const r = G.settle({}, stats({ commits: 25 }), cfg, BASE); // 250 exp
  assert.strictEqual(r.todayExp, 250);
  assert.strictEqual(r.level, 2);
  assert.strictEqual(r.leveledUp, true);
});

test('settle · 跨天把昨天经验沉淀进累计', () => {
  const g1 = G.settle({}, stats({ commits: 10 }), cfg, BASE).growth; // 今日 100
  const r2 = G.settle(g1, stats({ commits: 5 }), cfg, BASE + DAY);     // 次日 今日 50
  assert.strictEqual(r2.growth.totalExpBeforeToday, 100);
  assert.strictEqual(r2.todayExp, 50);
  assert.strictEqual(r2.totalExp, 150);
});

test('streak · 连续三天递增', () => {
  let g = {};
  const seen = [];
  for (let i = 0; i < 3; i++) {
    const r = G.settle(g, stats({ commits: 1 }), cfg, BASE + i * DAY + 3600000);
    g = r.growth; seen.push(r.streak);
  }
  assert.deepStrictEqual(seen, [1, 2, 3]);
});

test('streak · 断签后重置为 1', () => {
  let g = G.settle({}, stats({ commits: 1 }), cfg, BASE).growth;          // day0 streak1
  g = G.settle(g, stats({ commits: 1 }), cfg, BASE + DAY).growth;          // day1 streak2
  const r = G.settle(g, stats({ commits: 1 }), cfg, BASE + 3 * DAY);       // 跳过 day2
  assert.strictEqual(r.streak, 1);
  assert.strictEqual(r.streakIncreased, true);
});

test('streak · 昨天活跃今天还没动，连胜仍在线', () => {
  const g = G.settle({}, stats({ commits: 1 }), cfg, BASE).growth;         // day0 活跃
  const r = G.settle(g, stats({}), cfg, BASE + DAY);                       // day1 无活动
  assert.strictEqual(r.streak, 1);          // 还没断
  assert.strictEqual(r.streakIncreased, false);
});

test('streak · 隔两天没动则归零', () => {
  const g = G.settle({}, stats({ commits: 1 }), cfg, BASE).growth;
  const r = G.settle(g, stats({}), cfg, BASE + 2 * DAY);
  assert.strictEqual(r.streak, 0);
});

test('energy · 按时间衰减', () => {
  const g = { energy: 100, energyTs: BASE, todayDate: G.dateKey(BASE), todayExp: 0 };
  const r = G.settle(g, stats({}), cfg, BASE + DAY); // 衰减 ~33/天
  assert.ok(Math.abs(r.energy - (100 - cfg.energy.decayPerDay)) < 0.5, `energy=${r.energy}`);
});

test('feedQuota · 当日额度', () => {
  assert.strictEqual(G.feedQuota({}), 3);
  assert.strictEqual(G.feedQuota({ feedDate: G.todayKey(), feedCount: 2 }), 1);
  assert.strictEqual(G.feedQuota({ feedDate: G.todayKey(), feedCount: 5 }), 0);
});
