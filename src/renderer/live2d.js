/**
 * Live2D 形象管理（Cubism 4 / .model3.json）。
 * 依赖加载顺序（见 index.html）：pixi → live2dcubismcore → pixi-live2d-display/cubism4。
 * 用 PIXI.live2d.Live2DModel.from() 加载，透明背景叠在桌面上。
 */
(function (global) {
  function Live2D() {
    this.app = null;
    this.model = null;
    this.scale = 0.18;     // aersasi_3 偏大，缩小一点
    this.offsetY = 0.06;   // 相对画布高度的下移比例（露出上半身）
  }

  Live2D.prototype.ready = function () {
    return typeof PIXI !== 'undefined' && !!PIXI.live2d;
  };

  Live2D.prototype.init = function (containerEl) {
    if (!this.ready()) { console.warn('[Live2D] PIXI/PIXI.live2d 未加载'); return false; }
    const dpr = window.devicePixelRatio || 1;
    this.app = new PIXI.Application({
      resizeTo: containerEl,
      backgroundAlpha: 0,
      antialias: true,
      autoDensity: true,
      autoStart: true,
      resolution: dpr,
    });
    if (this.app.ticker) this.app.ticker.maxFPS = 60;
    const view = this.app.view;
    view.style.width = '100%';
    view.style.height = '100%';
    containerEl.appendChild(view);
    return true;
  };

  Live2D.prototype.loadModel = function (modelPath) {
    const self = this;
    if (!this.app) return Promise.reject(new Error('画布未初始化'));
    return PIXI.live2d.Live2DModel.from(modelPath).then(function (model) {
      if (self.model) { self.app.stage.removeChild(self.model); self.model.destroy({ children: true }); }
      self.model = model;
      model.anchor.set(0.5, 0.5);
      self._place();
      self.app.stage.addChild(model);

      // 点击模型 → 摸头动作 + 通知外部
      model.eventMode = 'static';
      model.on('pointertap', function () {
        self.playRandomMotion(['', 'Tap', 'TapBody', 'touch_body']);
        if (typeof self.onTap === 'function') self.onTap();
      });
      console.log('[Live2D] 模型已加载:', modelPath);
      return model;
    });
  };

  Live2D.prototype._place = function () {
    if (!this.model || !this.app) return;
    const w = this.app.screen.width, h = this.app.screen.height;
    this.model.x = w / 2;
    this.model.y = h / 2 + h * this.offsetY;
    this.model.scale.set(this.scale);
  };

  Live2D.prototype.setScale = function (s) { this.scale = s; this._place(); };

  /** 在候选 group 里挑第一个存在的播一个随机动作 */
  Live2D.prototype.playRandomMotion = function (groups) {
    if (!this.model || !this.model.internalModel) return;
    const defs = this.model.internalModel.motionManager.definitions || {};
    const candidates = groups && groups.length ? groups : Object.keys(defs);
    for (const g of candidates) {
      const list = defs[g];
      const arr = Array.isArray(list) ? list : (list && list.motions) || [];
      if (arr && arr.length) {
        const idx = Math.floor(Math.random() * arr.length);
        try { this.model.motion(g, idx); } catch (e) {}
        return g;
      }
    }
    // 没匹配到候选就随便播一个存在的
    const all = Object.keys(defs);
    if (all.length) { try { this.model.motion(all[0]); } catch (e) {} }
  };

  /** 按表情名设置（模型有 expressions 时） */
  Live2D.prototype.setExpression = function (name) {
    if (!this.model) return;
    try { this.model.expression(name); } catch (e) {}
  };

  global.Live2D = new Live2D();
})(window);
