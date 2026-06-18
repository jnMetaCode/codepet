/**
 * 成长系统纯逻辑。无副作用，便于测试。
 * 经验公式见 需求文档 §6：计数型指标为主力。
 * 浏览器里挂到 window.Growth；Node 里 module.exports（供单测）。
 */
(function (root, factory) {
  const G = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = G;
  if (root) root.Growth = G;
})(typeof window !== 'undefined' ? window : null, function () {
  const DAY = 86400000;

  /** 把毫秒（或 now）转成本地日期键 YYYY-MM-DD */
  function dateKey(ms) {
    const n = (typeof ms === 'number') ? new Date(ms) : new Date();
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
  }
  function todayKey() { return dateKey(); }

  /** 由今日统计算今日经验。有 hooks 实时事件就用有意义指标，否则回退 jsonl 计数。 */
  function computeTodayExp(stats, w) {
    const base = stats.commits * w.perCommit + (stats.linesAdded + stats.linesDeleted) * w.perLine;
    let ccExp;
    if (stats.eventsActive) {
      ccExp = stats.prompts * (w.perPrompt || 4) +
              stats.tasks * (w.perTask || 8) +
              stats.tools * (w.perTool || 1);
    } else {
      ccExp = stats.ccRequests * w.perCcRequest + stats.ccSessions * w.perCcSession;
    }
    return base + ccExp;
  }

  /** 由今日经验选状态 */
  function pickState(todayExp, thresholds) {
    let cur = thresholds[0];
    for (const t of thresholds) if (todayExp >= t.min) cur = t;
    return cur;
  }

  /**
   * 结算一次：把最新 stats 合进持久化的 growth，返回新的 growth + 变化信息。
   * @returns {{growth, totalExp, todayExp, level, leveledUp, state, energy, lowEnergy, streak, streakIncreased}}
   */
  function settle(growth, stats, config, nowMs) {
    const w = config.exp;
    const now = nowMs || Date.now();
    const g = { ...growth };
    const today = dateKey(now);
    const yday = dateKey(now - DAY);

    // 今天之内本次相比上次新增的经验（用于补充能量）
    const sameDay = g.todayDate === today;
    const prevTodayExp = sameDay ? (g.todayExp || 0) : 0;

    // 跨天：把昨天的 todayExp 沉淀进累计，重置今天
    if (!sameDay) {
      g.totalExpBeforeToday = (g.totalExpBeforeToday || 0) + (g.todayDate ? g.todayExp || 0 : 0);
      g.todayDate = today;
      g.todayExp = 0;
    }

    const todayExp = computeTodayExp(stats, w);
    g.todayExp = todayExp;
    const gain = Math.max(0, todayExp - prevTodayExp);

    const totalExp = (g.totalExpBeforeToday || 0) + todayExp;
    const newLevel = Math.floor(totalExp / w.levelUpExp);
    const leveledUp = newLevel > (g.level || 0);
    g.level = newLevel;

    // 连续打卡：今天有"有意义活动"（今日经验 > 0）就算打卡一天
    g.streakDays = g.streakDays || 0;
    g.lastActiveDate = g.lastActiveDate || '';
    let streakIncreased = false;
    if (todayExp > 0 && g.lastActiveDate !== today) {
      g.streakDays = (g.lastActiveDate === yday) ? g.streakDays + 1 : 1; // 昨天也活跃才接龙，否则重置为 1
      g.lastActiveDate = today;
      streakIncreased = true;
    }
    // 当前仍然"在线"的连胜：今天或昨天活跃过才算没断，否则归 0
    const streak = (g.lastActiveDate === today || g.lastActiveDate === yday) ? g.streakDays : 0;

    // 能量：按真实时间衰减 + 新增经验补充
    const ec = config.energy || { decayPerDay: 33, replenishPerExp: 0.5, lowThreshold: 30 };
    const decayPerMs = ec.decayPerDay / DAY;
    let energy = typeof g.energy === 'number' ? g.energy : 100;
    energy -= decayPerMs * (now - (g.energyTs || now));
    energy += gain * ec.replenishPerExp;
    energy = Math.max(0, Math.min(100, energy));
    g.energy = energy;
    g.energyTs = now;

    const state = pickState(todayExp, config.states.thresholds);
    const lowEnergy = energy < (ec.lowThreshold || 30);

    return { growth: g, totalExp, todayExp, level: newLevel, leveledUp, state, energy, lowEnergy, streak, streakIncreased };
  }

  /** 今日还能喂几次（每日上限 3） */
  function feedQuota(growth, max = 3) {
    const today = todayKey();
    if (growth.feedDate !== today) return max;
    return Math.max(0, max - (growth.feedCount || 0));
  }

  return { todayKey, dateKey, computeTodayExp, pickState, settle, feedQuota };
});
