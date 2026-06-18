/**
 * 渲染进程主逻辑：初始化 Live2D 形象 → 拉数据 → 成长结算 → 更新形象/徽标/气泡。
 */

const petEl = document.getElementById('pet');
const badgeEl = document.getElementById('badge');
const bubbleEl = document.getElementById('bubble');
const panelEl = document.getElementById('panel');

const MODEL_PATH = 'models/aersasi_3/aersasi_3.model3.json';

// 状态 → 动作组（该模型无表情，用动作表现情绪）
const STATE_MOTION = {
  idle:   ['idle'],
  warm:   ['main_1', 'home'],
  active: ['main_2', 'main_3'],
  beast:  ['main_4', 'complete'],
};

const LINES = {
  idle:   ['今天还没开张呀…要不要写两行？', '摸鱼一时爽，KPI 火葬场 🐟'],
  warm:   ['热身完毕，准备起飞 🛫', '手感慢慢回来了～'],
  active: ['今天又是被需求追着跑的一天 🏃', '代码如流水，bug 似飞花'],
  beast:  ['卷王本王，今日已封神 🔥', '这强度…你是想把我喂成传说级吗？'],
};

let config = null;
let growth = null;
let lastState = null;
let avatar = null; // 选定的形象实现（Sprite 或 Live2D）
let pets = [];     // 宠物图鉴
let currentPet = null;
let lastLowEnergy = false;

function findPet(id) { return pets.find((p) => p.id === id) || pets[0]; }

// 形象动作安全包装：avatar 可能在初始化完成前被实时事件/定时器调用
function petMotion(groups) { if (avatar && avatar.playRandomMotion) avatar.playRandomMotion(groups); }

// 优先用当前宠物的性格台词，回退到通用台词
function petLine(stateKey) {
  const k = stateKey || 'idle';
  const arr = (currentPet && currentPet.lines && currentPet.lines[k]) || LINES[k] || LINES.idle;
  return arr[Math.floor(Math.random() * arr.length)];
}

function say(text, ms = 4000) {
  bubbleEl.textContent = text;
  bubbleEl.classList.add('show');
  clearTimeout(say._t);
  say._t = setTimeout(() => bubbleEl.classList.remove('show'), ms);
}

// 情绪飘字：从桌宠头顶升起淡出
function emote(text, dx = 0) {
  const el = document.createElement('div');
  el.className = 'emote';
  el.textContent = text;
  el.style.setProperty('--dx', `${dx}px`);
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1600);
}
function emoteBurst(texts) {
  texts.forEach((t, i) => setTimeout(() => emote(t, (i - (texts.length - 1) / 2) * 28), i * 100));
}

let lastStreak = 0;
let lastSettled = null;
let lastStats = null;
function render(settled, stats) {
  const { state, level, todayExp, totalExp, energy, lowEnergy, streak } = settled;
  lastStreak = streak || 0;
  lastSettled = settled;
  lastStats = stats;
  const ebar = energy >= 60 ? '⚡' : energy >= 30 ? '🔋' : '🪫';
  const streakTag = streak > 0 ? ` · 🔥连${streak}天` : '';
  badgeEl.textContent = `Lv.${level} · ${state.emoji}${state.label} · ${ebar}${Math.round(energy)}${streakTag}`;

  document.getElementById('p-commits').textContent = stats.commits;
  document.getElementById('p-lines').textContent = `+${stats.linesAdded} / -${stats.linesDeleted}`;
  document.getElementById('p-sess').textContent = stats.ccSessions;
  // 有 hooks 实时事件就显示有意义指标，否则显示 jsonl 回填
  const ev = stats.eventsActive;
  ['row-prompts', 'row-tasks', 'row-tools'].forEach((id) => {
    document.getElementById(id).style.display = ev ? 'flex' : 'none';
  });
  document.getElementById('row-cc').style.display = ev ? 'none' : 'flex';
  if (ev) {
    document.getElementById('p-prompts').textContent = stats.prompts;
    document.getElementById('p-tasks').textContent = stats.tasks;
    document.getElementById('p-tools').textContent = stats.tools;
  } else {
    document.getElementById('p-cc').textContent = stats.ccRequests;
  }
  document.getElementById('p-exp').textContent = todayExp.toFixed(0);
  document.getElementById('p-level').textContent = `${level}（累计 ${totalExp.toFixed(0)}）`;

  lastLowEnergy = lowEnergy;
  // 连续打卡到了新的一天（里程碑更隆重）
  if (settled.streakIncreased && streak > 1) {
    const milestone = [3, 7, 14, 30, 50, 100].includes(streak);
    say(milestone ? `连续写代码 ${streak} 天！太猛了，给你撒花 🎉🔥` : `连续打卡第 ${streak} 天，继续保持～🔥`, milestone ? 5000 : 3000);
    if (milestone) { petMotion(['complete', 'wedding']); emoteBurst(['🔥', '✨', '🎉']); } else { emote('🔥'); }
  }
  if (settled.leveledUp) {
    say(`今天写了 ${stats.linesAdded + stats.linesDeleted} 行、喂了 ${stats.ccRequests} 次 Claude，我升到 ${level} 级啦！🎉`, 5000);
    petMotion(['complete', 'wedding', 'login']);
    emoteBurst(['🎉', '✨', '⭐', '🎊']);
  } else if (lastState && lastState !== state.key) {
    say(`进入「${state.label}」状态 ${state.emoji}`);
    petMotion(STATE_MOTION[state.key]);
    emote(state.emoji);
  } else if (lowEnergy && state.key === 'idle') {
    say('好几天没一起写代码了…能量快空了，喂我两行嘛 🪫');
    if (avatar && avatar.setExpression) avatar.setExpression('tired');
  }
  lastState = state.key;
}

async function tick() {
  try {
    const stats = await window.codepet.getStats();
    const settled = window.Growth.settle(growth, stats, config);
    growth = settled.growth;
    await window.codepet.setGrowth(growth);
    render(settled, stats);
  } catch (e) {
    console.error('tick 失败', e);
  }
}

// ---------- 交互 ----------

// 点击形象：摸头反应 + 台词（在 init 里挂到选定的 avatar 上）
function onAvatarTap() {
  if (petEl._dragged) { petEl._dragged = false; return; }
  say(petLine(lastState));
}

// 拖动窗口（在画布容器上按下拖动）
(function enableDrag() {
  let dragging = false, lastX = 0, lastY = 0;
  petEl.addEventListener('mousedown', (e) => {
    dragging = true; lastX = e.screenX; lastY = e.screenY; petEl._dragged = false;
  });
  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const dx = e.screenX - lastX, dy = e.screenY - lastY;
    if (dx || dy) petEl._dragged = true;
    lastX = e.screenX; lastY = e.screenY;
    window.codepet.dragBy(dx, dy);
  });
  window.addEventListener('mouseup', () => { dragging = false; });
})();

// ---------- Claude Code 实时联动：魔法时刻 ----------
const EVENT_REACTION = {
  SessionStart:     { motion: ['login', 'home'],        line: '新的一局开始啦，一起写！🎮', emote: '🎮', throttle: 0 },
  UserPromptSubmit: { motion: ['touch_head', 'main_1'], line: '在听～说吧 👂',              emote: '💬', throttle: 1500 },
  Stop:             { motion: ['complete', 'main_2'],   line: '搞定一个 ✅',                emote: '✅', throttle: 1500 },
  PreToolUse:       { motion: ['touch_body', 'main_3'], line: null,                        emote: '⚙️', throttle: 2500 },
  PostToolUse:      { motion: null,                      line: null,                        emote: null, throttle: 3000 },
  SessionEnd:       { motion: ['idle'],                 line: '辛苦啦，歇会儿 ☕',          emote: '👋', throttle: 0 },
};
const _lastReact = {};
let _tickTimer = null;

window.codepet.onCcEvent((evt) => {
  const r = EVENT_REACTION[evt.ev];
  const now = Date.now();
  if (r) {
    if (!r.throttle || now - (_lastReact[evt.ev] || 0) >= r.throttle) {
      _lastReact[evt.ev] = now;
      if (r.motion) petMotion(r.motion);
      if (r.line) say(r.line, 2500);
      if (r.emote) emote(r.emote);
    }
  }
  // 实时事件 = "去重新结算一次"，但 debounce，避免频繁工具事件刷爆
  clearTimeout(_tickTimer);
  _tickTimer = setTimeout(tick, 1200);
});

// 环境氛围：按状态/能量周期性飘字，让桌宠永远有"情绪"
setInterval(() => {
  if (document.hidden) return;
  if (lastLowEnergy) { emote('💤'); return; }
  if (lastState === 'beast') emote('🔥');
  else if (lastState === 'active' && Math.random() < 0.5) emote('💪');
}, 9000);

// 主动搭话：每隔一会儿自己说一句（不打断正在显示的气泡）
setInterval(() => {
  if (document.hidden) return;
  if (bubbleEl.classList.contains('show')) return;
  if (Math.random() < 0.75) say(petLine(lastState));
}, 18000);

// 设置变更：热更新配置并立即重算；若换了宠物就热切换形象
window.codepet.onConfigChanged(async (c) => {
  const petChanged = c.avatar && config && config.avatar && c.avatar.pet !== config.avatar.pet;
  config = c;
  if (petChanged && avatar && avatar.loadPet) {
    pets = await window.codepet.getPets(); // 自定义宠物可能是刚新建的，刷新图鉴再找
    const p = findPet(c.avatar.pet);
    currentPet = p;
    avatar.loadPet(p);
    say(`换成${p.name}啦 ${p.emoji}`);
  } else {
    say('设置已更新 ⚙️');
  }
  tick();
});

// 首次启动欢迎引导
window.codepet.onWelcome(() => {
  const steps = [
    '你好！我是你的码宠 🐾 你写代码我就长大～',
    '在设置里挑一只你喜欢的宠物吧（已帮你打开）',
    '开启「⚡实时联动」，我就能即时陪你写 Claude Code！',
  ];
  steps.forEach((s, i) => setTimeout(() => say(s, 4500), 1000 + i * 4200));
});

// 今日数据面板：托盘切换 + 点面板关闭 + 12秒自动消失
window.codepet.onShowStats(() => {
  panelEl.classList.toggle('show');
  clearTimeout(panelEl._t);
  if (panelEl.classList.contains('show')) panelEl._t = setTimeout(() => panelEl.classList.remove('show'), 12000);
});
panelEl.addEventListener('click', () => { panelEl.classList.remove('show'); clearTimeout(panelEl._t); });

// 点击穿透开关提示
window.codepet.onClickThrough((on) => {
  if (on) say('已开启点击穿透。按 ⌘⇧P 或托盘 🐾 可关闭 👻', 5000);
});
window.codepet.onFeed(async () => {
  const quota = window.Growth.feedQuota(growth);
  if (quota <= 0) { say('今天喂太多啦，明天再来～🍱'); return; }
  const today = window.Growth.todayKey();
  if (growth.feedDate !== today) { growth.feedDate = today; growth.feedCount = 0; }
  growth.feedCount += 1;
  growth.totalExpBeforeToday = (growth.totalExpBeforeToday || 0) + 20;
  await window.codepet.setGrowth(growth);
  say(`喂食成功！+20 经验，今天还能喂 ${quota - 1} 次 🍖`);
  petMotion(['touch_body', 'touch_head', 'complete']);
  emoteBurst(['❤️', '🍖', '✨']);
});

// ---------- 今日战报分享卡 ----------
function fmtNum(n) {
  n = Math.round(n || 0);
  return n >= 10000 ? (n / 10000).toFixed(1) + 'w' : (n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n));
}
function loadImage(src) {
  return new Promise((res) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = src; });
}
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

async function drawReportCard() {
  const W = 760, H = 1000;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  const FONT = '-apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';

  // 背景渐变
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, '#FFE7F3'); g.addColorStop(1, '#E6E1FF');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

  const cx = W / 2;
  ctx.textAlign = 'center';

  // 标题 + 日期
  const d = new Date();
  ctx.fillStyle = '#4a3a6a'; ctx.font = `800 46px ${FONT}`;
  ctx.fillText('码宠 · 今日战报', cx, 84);
  ctx.fillStyle = '#9a86c4'; ctx.font = `500 24px ${FONT}`;
  ctx.fillText(`${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`, cx, 122);

  // 宠物立绘（取不到就画 emoji）
  const base = (currentPet && currentPet.assetBase) || `assets/${(currentPet && currentPet.id) || 'cat'}`;
  const petSrc = `${base}/${currentPet && currentPet.frames ? 'frame-0.png' : 'character-neutral.png'}`;
  const im = await loadImage(petSrc);
  const PS = 300, py = 150;
  if (im) {
    const r = Math.min(PS / im.width, PS / im.height);
    const w = im.width * r, h = im.height * r;
    ctx.drawImage(im, cx - w / 2, py + (PS - h), w, h);
  } else {
    ctx.font = `${PS * 0.7}px ${FONT}`; ctx.fillText((currentPet && currentPet.emoji) || '🐱', cx, py + PS * 0.8);
  }

  const s = lastSettled || {}; const st = lastStats || {};
  const state = s.state || { emoji: '🌱', label: '热身' };

  // 等级 + 状态
  ctx.fillStyle = '#2c2240'; ctx.font = `800 56px ${FONT}`;
  ctx.fillText(`Lv.${s.level || 0} · ${state.label}${state.emoji}`, cx, 530);

  // streak
  if (s.streak > 0) {
    ctx.fillStyle = '#e8517a'; ctx.font = `700 32px ${FONT}`;
    ctx.fillText(`🔥 连续写代码 ${s.streak} 天`, cx, 580);
  }

  // 数据行（卡片底框）
  const rows = [
    ['今日提交', `${st.commits || 0} 次`],
    ['增删行数', `+${fmtNum(st.linesAdded)} / -${fmtNum(st.linesDeleted)}`],
    st.eventsActive ? ['提问 / 完成 / 工具', `${st.prompts || 0} / ${st.tasks || 0} / ${fmtNum(st.tools)}`]
                    : ['Claude 请求 / 会话', `${st.ccRequests || 0} / ${st.ccSessions || 0}`],
    ['今日经验', `+${fmtNum(s.todayExp)}`],
  ];
  const bx = 90, bw = W - 180, by = 620, rh = 64;
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  roundRect(ctx, bx, by, bw, rh * rows.length + 24, 22); ctx.fill();
  rows.forEach((row, i) => {
    const ry = by + 24 + i * rh + rh / 2;
    ctx.textAlign = 'left'; ctx.fillStyle = '#6a5a8a'; ctx.font = `500 28px ${FONT}`;
    ctx.fillText(row[0], bx + 34, ry + 9);
    ctx.textAlign = 'right'; ctx.fillStyle = '#2c2240'; ctx.font = `800 30px ${FONT}`;
    ctx.fillText(row[1], bx + bw - 34, ry + 9);
  });

  // 页脚品牌
  ctx.textAlign = 'center';
  ctx.fillStyle = '#8a7ab0'; ctx.font = `600 26px ${FONT}`;
  ctx.fillText('你写代码，它陪你卷 🐾', cx, H - 70);
  ctx.fillStyle = '#a99ac8'; ctx.font = `500 22px ${FONT}`;
  ctx.fillText('github.com/jnMetaCode/codepet', cx, H - 36);

  return cv.toDataURL('image/png');
}

window.codepet.onReport(async () => {
  try {
    say('生成今日战报中…📸', 2000);
    const dataUrl = await drawReportCard();
    const r = await window.codepet.saveReport(dataUrl);
    if (r && r.ok) { say('战报已存到桌面，也复制到剪贴板啦，去晒一张 🎉', 5000); emoteBurst(['📸', '✨', '🎉']); }
    else { say('战报生成失败了…' + ((r && r.error) || ''), 4000); }
  } catch (e) { say('战报生成出错了…'); console.error(e); }
});

// ---------- 启动 ----------
(async function init() {
  config = await window.codepet.getConfig();
  growth = await window.codepet.getGrowth();

  // 按配置选形象：sprite（v1 立绘）或 live2d（v2）
  const av = config.avatar || {};
  const mode = av.mode === 'live2d' ? 'live2d' : 'sprite';
  avatar = mode === 'live2d' ? window.Live2D : window.Sprite;

  pets = await window.codepet.getPets();
  currentPet = findPet(av.pet);

  if (avatar.init(petEl)) {
    try {
      if (mode === 'live2d') {
        await avatar.loadModel(av.live2dModel || MODEL_PATH);
        petMotion(['idle']);
      } else {
        await avatar.loadPet(findPet(av.pet));
      }
    } catch (e) {
      console.error('[avatar] 形象加载失败:', e);
      say('形象加载失败了…先看数据吧');
    }
  }
  avatar.onTap = onAvatarTap;
  console.log(`[avatar] 形象模式=${mode}，已就绪`);

  await tick();
  setInterval(tick, 60 * 1000);
  setTimeout(() => say('码宠上线啦～开写吧！👾'), 800);
})();
