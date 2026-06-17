/**
 * v1 立绘形象渲染器（程序化生命感版）。
 * 全 AI 管线下"最好体验"的现实路径：把 2D 立绘做到"真的活"——
 *   连续呼吸 + 左右摇摆 + 微倾 + 周期眨眼 + 地面影子 + 不定时自发小动作 + 挤压回弹。
 * 与 live2d.js 暴露同样的方法名，renderer 可二选一。立绘缺失时用宠物 emoji 占位，照常动。
 */
(function (global) {
  const EXPR = ['neutral', 'happy', 'tired', 'working'];

  function injectStyles() {
    if (document.getElementById('codepet-sprite-style')) return;
    const s = document.createElement('style');
    s.id = 'codepet-sprite-style';
    s.textContent = `
      #sprite-wrap { position:absolute; inset:0; display:flex; align-items:flex-end; justify-content:center; }
      #sprite-stage { position:relative; width:80%; max-width:250px; aspect-ratio:1/1.05; margin-bottom:5%; }
      #sprite-shadow {
        position:absolute; left:50%; bottom:2%; width:46%; height:7%;
        transform:translateX(-50%); border-radius:50%;
        background:radial-gradient(ellipse, rgba(0,0,0,.28), rgba(0,0,0,0) 72%);
        will-change:transform,opacity;
      }
      #sprite-outer { position:absolute; inset:0; will-change:transform; }
      #sprite-body {
        position:absolute; inset:0; transform-origin:center bottom; cursor:grab;
        background-size:contain; background-repeat:no-repeat; background-position:center bottom;
        will-change:transform; filter:drop-shadow(0 4px 6px rgba(0,0,0,.10));
      }
      #sprite-body.placeholder {
        display:flex; align-items:flex-end; justify-content:center; padding-bottom:8%;
        font-size:108px; line-height:1;
        background-image:radial-gradient(circle at 50% 42%, rgba(120,160,255,.28), rgba(120,160,255,0) 68%);
      }
    `;
    document.head.appendChild(s);
  }

  function Sprite() {
    this.body = null; this.outer = null; this.shadow = null;
    this.have = {}; this.cur = 'neutral'; this.scale = 1;
    this.petEmoji = '🐱'; this.petId = 'cat';
    this._t0 = 0; this._raf = 0; this._blinkUntil = 0; this._nextBlink = 0;
    this._squash = 0; this._nextEmote = 0; this._paused = false;
    this.frames = []; this.frameMode = false; this.fps = 6;
    this._frameTimer = null; this._danceTimer = null; this._dancing = false;
  }

  Sprite.prototype.ready = function () { return true; };

  Sprite.prototype.init = function (container) {
    injectStyles();
    const wrap = document.createElement('div'); wrap.id = 'sprite-wrap';
    const stage = document.createElement('div'); stage.id = 'sprite-stage';
    this.shadow = document.createElement('div'); this.shadow.id = 'sprite-shadow';
    this.outer = document.createElement('div'); this.outer.id = 'sprite-outer';
    this.body = document.createElement('div'); this.body.id = 'sprite-body';
    this.outer.appendChild(this.body);
    stage.appendChild(this.shadow); stage.appendChild(this.outer);
    wrap.appendChild(stage); container.appendChild(wrap);

    this._applyExpr('neutral');
    this.body.addEventListener('click', () => {
      if (this.body._dragged) { this.body._dragged = false; return; }
      if (this.frameMode) this.danceBurst(3000); else this.bounce();
      if (typeof this.onTap === 'function') this.onTap();
    });
    this._startLoop();
    return true;
  };

  // ---------- 程序化空闲动画（rAF 连续驱动） ----------
  Sprite.prototype._startLoop = function () {
    const step = (ts) => {
      if (!this._t0) { this._t0 = ts; this._nextBlink = ts + 2500; this._nextEmote = ts + 6000; }
      const t = (ts - this._t0) / 1000;

      // 周期眨眼（约 3.5~6s 一次，持续 ~120ms）
      if (ts > this._nextBlink) { this._blinkUntil = ts + 120; this._nextBlink = ts + 3500 + Math.floor((Math.sin(t) * 0.5 + 0.5) * 2500); }
      const blinking = ts < this._blinkUntil;

      // 不定时自发小动作（帧动画模式不需要，舞蹈帧本身就在动）
      if (!this.frameMode && ts > this._nextEmote) {
        this._nextEmote = ts + 3500 + (t % 3) * 800;
        if (Math.cos(t * 1.3) > 0) this.wiggle(); else this.hop();
      }

      // 挤压回弹衰减
      if (this._squash > 0.001) this._squash *= 0.86; else this._squash = 0;

      // 帧动画模式：晃动幅度大幅减弱（让舞蹈帧主导），不眨眼压扁
      const m = this.frameMode ? 0.2 : 1;
      const bob = Math.sin(t * 2.0) * 10 * m;
      const sway = Math.sin(t * 0.95) * 9 * m;
      const tilt = Math.sin(t * 0.75) * 3 * m;
      const breathe = 1 + Math.sin(t * 2.0) * 0.035 * (this.frameMode ? 0.3 : 1);
      const blinkSquash = (blinking && !this.frameMode) ? 0.86 : 1;
      const sX = (1 + this._squash) * this.scale;
      const sY = (breathe - this._squash) * blinkSquash * this.scale;

      this.body.style.transform =
        `translate(${sway}px, ${-bob}px) rotate(${tilt}deg) scale(${sX}, ${sY})`;

      // 影子随浮动变化（宠物升高→影子变小变淡）
      const up = (bob + 4) / 8; // 0~1
      this.shadow.style.transform = `translateX(-50%) scale(${1 - up * 0.18})`;
      this.shadow.style.opacity = String(0.85 - up * 0.25);

      this._raf = requestAnimationFrame(step);
    };
    this._raf = requestAnimationFrame(step);
  };

  // ---------- 立绘加载 ----------
  // 帧动画：循环播放 frame-0..N-1.png = 跳舞
  Sprite.prototype._stopFrames = function () {
    if (this._frameTimer) { clearTimeout(this._frameTimer); this._frameTimer = null; }
    if (this._danceTimer) { clearTimeout(this._danceTimer); this._danceTimer = null; }
    this.frameMode = false; this.frames = []; this._dancing = false;
  };

  Sprite.prototype._showFrame = function (i) {
    if (!this.body || !this.frames.length) return;
    this.body.classList.remove('placeholder');
    this.body.textContent = '';
    this.body.style.backgroundImage = `url("${this.frames[i % this.frames.length]}")`;
    this._squash = 0.05; // 换姿势轻轻一弹
  };

  // 跳一小段舞（随机摆 pose，每个停 0.5~1s），结束后回到安静 pose
  Sprite.prototype.danceBurst = function (ms) {
    if (!this.frameMode || !this.frames.length) return;
    if (this._danceTimer) clearTimeout(this._danceTimer);
    if (this._frameTimer) { clearTimeout(this._frameTimer); this._frameTimer = null; }
    this._dancing = true;
    const end = Date.now() + (ms || (3000 + Math.random() * 3000)); // 跳 3~6 秒
    let cur = -1;
    const step = () => {
      if (!this.frameMode) return;
      if (Date.now() >= end) { this._dancing = false; this._showFrame(0); this._scheduleBurst(); return; }
      let i = Math.floor(Math.random() * this.frames.length);
      if (this.frames.length > 1 && i === cur) i = (i + 1) % this.frames.length;
      cur = i; this._showFrame(i);
      this._danceTimer = setTimeout(step, 500 + Math.random() * 500); // 每姿势 0.5~1s
    };
    step();
  };

  // 安排下一次自发跳舞（12~28 秒后）
  Sprite.prototype._scheduleBurst = function () {
    if (this._frameTimer) clearTimeout(this._frameTimer);
    this._frameTimer = setTimeout(() => this.danceBurst(), 12000 + Math.random() * 16000);
  };

  // 平时安静待着摆个 pose，定期/被触发时才跳一段
  Sprite.prototype._startFrames = function () {
    this._dancing = false;
    this._showFrame(0);       // 安静站姿
    this._scheduleBurst();    // 过一会儿自己跳一段
    setTimeout(() => this.danceBurst(2500), 800); // 刚上线先跳一小下打个招呼
  };

  Sprite.prototype.loadPet = function (pet) {
    if (pet) { this.petId = pet.id; this.petEmoji = pet.emoji || '🐱'; }
    // 内置宠物 assetBase=assets/<id>（相对本页），自定义宠物=petasset://<id>（绝对）
    this.assetBase = (pet && pet.assetBase) || `assets/${this.petId}`;
    this._stopFrames();

    // 帧动画宠物
    if (pet && pet.frames > 0) {
      this.frameMode = true; this.fps = pet.fps || 6;
      const n = pet.frames; const arr = new Array(n); let done = 0;
      this._applyExpr(this.cur); // 先占位
      return new Promise((resolve) => {
        for (let k = 0; k < n; k++) {
          const url = `${this.assetBase}/frame-${k}.png`;
          const img = new Image();
          img.onload = () => { arr[k] = url; if (++done === n) { this.frames = arr.filter(Boolean); this._startFrames(); resolve(); } };
          img.onerror = () => { if (++done === n) { this.frames = arr.filter(Boolean); if (this.frames.length) this._startFrames(); resolve(); } };
          img.src = url;
        }
      });
    }

    this.have = {}; this._applyExpr(this.cur);
    return new Promise((resolve) => {
      let pending = EXPR.length;
      EXPR.forEach((name) => {
        const url = `${this.assetBase}/character-${name}.png`;
        const img = new Image();
        img.onload = () => {
          this.have[name] = url;
          this._applyExpr(this.cur); // 任何图加载完都重渲染：缺失表情自动回退到 neutral 图
          if (--pending === 0) resolve(this.have);
        };
        img.onerror = () => { if (--pending === 0) resolve(this.have); };
        img.src = url;
      });
    });
  };
  Sprite.prototype.loadModel = function () { return this.loadPet(); };

  Sprite.prototype._applyExpr = function (name) {
    if (!this.body) return;
    const url = this.have[name] || this.have['neutral'];
    if (url) {
      this.body.classList.remove('placeholder');
      this.body.textContent = '';
      this.body.style.backgroundImage = `url("${url}")`;
    } else {
      this.body.classList.add('placeholder');
      this.body.style.backgroundImage = '';
      this.body.textContent = this.petEmoji || '🐱';
    }
  };

  Sprite.prototype.setExpression = function (name) {
    if (this.frameMode) return; // 帧动画模式下不切表情，避免覆盖舞蹈帧
    if (!EXPR.includes(name)) return;
    this.cur = name; this._applyExpr(name);
  };

  // ---------- 一次性反应（叠在 outer 上，不干扰 idle 的 body transform） ----------
  Sprite.prototype.hop = function () { this._squash = 0.06;
    this.outer.animate([{ transform: 'translateY(0)' }, { transform: 'translateY(-24px)' }, { transform: 'translateY(0)' }], { duration: 460, easing: 'ease-out' });
  };
  Sprite.prototype.bounce = function () { this._squash = 0.10;
    this.outer.animate([{ transform: 'translateY(0) scale(1)' }, { transform: 'translateY(-30px) scale(1.08)' }, { transform: 'translateY(0) scale(1)' }], { duration: 500, easing: 'ease-out' });
  };
  Sprite.prototype.wiggle = function () {
    this.outer.animate([{ transform: 'rotate(0)' }, { transform: 'rotate(-5deg)' }, { transform: 'rotate(5deg)' }, { transform: 'rotate(0)' }], { duration: 420, easing: 'ease-in-out' });
  };
  Sprite.prototype.celebrate = function () { this._squash = 0.12;
    this.outer.animate([
      { transform: 'translateY(0) rotate(0) scale(1)' },
      { transform: 'translateY(-26px) rotate(-7deg) scale(1.12)' },
      { transform: 'translateY(-10px) rotate(7deg) scale(1.08)' },
      { transform: 'translateY(0) rotate(0) scale(1)' }], { duration: 760, easing: 'ease-out' });
  };

  // 与 live2d.js 同名：动作组语义 → 立绘反应 + 表情
  Sprite.prototype.playRandomMotion = function (groups) {
    if (this.frameMode) { this.danceBurst(2500 + Math.random() * 1500); return; } // 帧动画宠物：反应=跳一段
    const g = (groups || []).join(' ');
    if (/complete|wedding|login/.test(g)) { this.setExpression('happy'); this.celebrate(); }
    else if (/main_2/.test(g)) { this.setExpression('happy'); this.bounce(); }
    else if (/touch_head|main_1/.test(g)) { this.setExpression('neutral'); this.hop(); }
    else if (/touch_body|main_3/.test(g)) { this.setExpression('working'); this.wiggle(); }
    else if (/idle|home/.test(g)) { this.setExpression('neutral'); }
    else { this.bounce(); }
  };

  Sprite.prototype.setScale = function (s) { this.scale = s; };

  global.Sprite = new Sprite();
})(window);
