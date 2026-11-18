/**
 * 3D 舞台控制器 —— 视角切换 + 拖拽平移。
 *
 * ================== 职责 ==================
 *   · 3D / 平面视角切换（给 `#board-stage` 加 `.is-3d`）
 *   · 鼠标 / 触摸拖拽平移棋盘（写 `#board-pan` 的 translate3d）
 *   · 弹性边界 —— 拖出允许范围时回弹到原位
 *
 * ================== 与渲染层的关系 ==================
 * 本模块**不碰 Canvas 的 backing store**。
 * Canvas 的尺寸基准始终是 `#board-wrap`（最外层，不参与变换），
 * 因此：
 *   · 切换 3D 视角  →  画布不重设，不清空
 *   · 拖拽平移      →  画布不重设，只改 transform
 *
 * ================== 为什么平移要做边界限制 ==================
 * 棋盘是一张有限大小的「桌子」。如果能无限拖走，玩家会迷失方位，
 * 找不到当前回合在哪。弹性回弹的边界 = 视口的一个百分比，
 * 既允许玩家把棋盘推到一边看角落，又保证「一松手就回到熟悉的构图」。
 */

/** 平移允许范围（相对视口尺寸的比例） */
const PAN_LIMIT = 0.18;

/** 回弹动画时长（毫秒） */
const SPRING_MS = 420;

/** 拖拽启动的最小位移（像素）—— 小于此值视为点击，不触发拖拽 */
const DRAG_THRESHOLD = 4;

export class Stage3D {
  /**
   * @param {HTMLElement} stage  #board-stage
   * @param {HTMLElement} pan    #board-pan
   * @param {HTMLElement} toggle #btn-3d（可为 null）
   * @param {object} opts        { onChange }
   */
  constructor(stage, pan, toggle, opts = {}) {
    this.stage = stage;
    this.pan = pan;
    this.toggle = toggle;
    this.onChange = opts.onChange || null;

    this.is3D = false;
    this.x = 0;
    this.y = 0;
    this.dragging = false;
    this._pointerId = null;
    this._start = { px: 0, py: 0, x: 0, y: 0 };
    this._moved = false;
    this._springRaf = 0;
    this._springTarget = null;

    this._bind();
    // 初始写入一次 transform —— 让 3D 模式的 Z 位移立即生效，
    // 也让平移量归零的状态显式化（而不是靠 transform 缺省）。
    this._apply();
  }

  /** 切换 3D 视角 */
  toggle3D() {
    this.set3D(!this.is3D);
  }

  /** 设置 3D 视角状态 */
  set3D(on) {
    const next = !!on;
    if (next === this.is3D) return;
    this.is3D = next;
    if (this.stage) this.stage.classList.toggle('is-3d', next);
    if (this.toggle) {
      this.toggle.setAttribute('aria-pressed', next ? 'true' : 'false');
      this.toggle.classList.toggle('is-off', !next);
      this.toggle.title = next ? '切换回平面视角' : '切换 3D 立体视角';
    }
    // 切回平面时把平移量一并归零 —— 否则残留的偏移会让平面棋盘偏在一角
    if (!next) {
      this._cancelSpring();
      this.x = 0;
      this.y = 0;
    }
    this._apply();
    if (this.onChange) this.onChange({ is3D: next });
  }

  /** 当前平移量 */
  get offset() {
    return { x: this.x, y: this.y };
  }

  /**
   * 平移的**收敛目标** —— 回弹动画期间，实际位置仍在越界处，
   * 目标才是合法范围内的答案。
   */
  get target() {
    return this._springTarget || { x: this.x, y: this.y };
  }

  /** 重置平移到原位 */
  reset() {
    this._springTo(0, 0);
  }

  /* ===========================================================
   * 事件绑定
   * =========================================================== */
  _bind() {
    if (this.toggle) {
      this.toggle.addEventListener('click', () => this.toggle3D());
    }
    if (!this.pan) return;

    // 用 pointer 事件统一处理鼠标 / 触摸 / 触控笔
    this.pan.addEventListener('pointerdown', (e) => this._onDown(e));
    window.addEventListener('pointermove', (e) => this._onMove(e));
    window.addEventListener('pointerup', (e) => this._onUp(e));
    window.addEventListener('pointercancel', (e) => this._onUp(e));
  }

  /* ===========================================================
   * 拖拽
   * =========================================================== */
  _onDown(e) {
    // 只响应主键；右键留给浏览器菜单
    if (e.button !== undefined && e.button !== 0) return;
    // 地块是可点的 —— 点击地块（而非拖动）不应触发平移
    if (e.target && e.target.closest && e.target.closest('.mt-cell')) return;

    this._cancelSpring();
    this._pointerId = e.pointerId;
    this.dragging = true;
    this._moved = false;
    this._start = { px: e.clientX, py: e.clientY, x: this.x, y: this.y };
  }

  _onMove(e) {
    if (!this.dragging || e.pointerId !== this._pointerId) return;

    const dx = e.clientX - this._start.px;
    const dy = e.clientY - this._start.py;

    // 超过阈值才算真正的拖拽 —— 否则会把「点击地块」误判成拖动
    if (!this._moved) {
      if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
      this._moved = true;
      if (this.pan) this.pan.classList.add('is-dragging');
    }

    e.preventDefault();

    const lim = this._limits();
    let nx = this._start.x + dx;
    let ny = this._start.y + dy;

    // 超出边界时按比例阻尼 —— 越拖越沉，手感明确
    if (nx > lim.maxX) nx = lim.maxX + (nx - lim.maxX) * 0.35;
    else if (nx < lim.minX) nx = lim.minX + (nx - lim.minX) * 0.35;
    if (ny > lim.maxY) ny = lim.maxY + (ny - lim.maxY) * 0.35;
    else if (ny < lim.minY) ny = lim.minY + (ny - lim.minY) * 0.35;

    this.x = nx;
    this.y = ny;
    this._apply();
  }

  _onUp(e) {
    if (!this.dragging || (e && e.pointerId !== this._pointerId)) return;
    this.dragging = false;
    this._pointerId = null;
    if (this.pan) this.pan.classList.remove('is-dragging');
    // 弹回合法范围内
    this._springTo(this._clampX(this.x), this._clampY(this.y));
  }
  /* ===========================================================
   * 边界与回弹
   * =========================================================== */
  _limits() {
    const w = this.pan ? this.pan.clientWidth : window.innerWidth;
    const h = this.pan ? this.pan.clientHeight : window.innerHeight;
    const lim = Math.min(w, h) * PAN_LIMIT;
    return { minX: -lim, maxX: lim, minY: -lim, maxY: lim };
  }

  _clampX(x) {
    const l = this._limits();
    return Math.max(l.minX, Math.min(l.maxX, x));
  }

  _clampY(y) {
    const l = this._limits();
    return Math.max(l.minY, Math.min(l.maxY, y));
  }

  /**
   * 弹性回弹 —— 用 easeOutBack 手势，超出量越大回弹越「弹」。
   *
   * 用 rAF 而不是 CSS transition：需要按当前速度做阻尼，
   * CSS 缓动无法表达「拖多远就弹多狠」。
   *
   * ⚠ 目标值记录在 `this._springTarget` —— 动画期间 `this.x` 仍在
   *   越界位置（阻尼后的位置），只有目标才是「合法范围」的答案。
   *   外部（测试 / 重置）据此判断当前应当收敛到哪。
   */
  _springTo(tx, ty) {
    this._cancelSpring();
    this._springTarget = { x: tx, y: ty };
    const sx = this.x;
    const sy = this.y;
    const dx = tx - sx;
    const dy = ty - sy;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) {
      this.x = tx;
      this.y = ty;
      this._apply();
      return;
    }

    const start = performance.now();
    const self = this;
    const step = (now) => {
      const t = Math.min(1, (now - start) / SPRING_MS);
      // easeOutBack —— 回弹时略微过冲再稳定
      const c1 = 1.70158;
      const c3 = c1 + 1;
      const e = 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
      self.x = sx + dx * e;
      self.y = sy + dy * e;
      self._apply();
      if (t < 1) {
        self._springRaf = requestAnimationFrame(step);
      } else {
        self._springRaf = 0;
        self.x = tx;
        self.y = ty;
        self._apply();
      }
    };
    this._springRaf = requestAnimationFrame(step);
  }

  _cancelSpring() {
    if (this._springRaf) {
      cancelAnimationFrame(this._springRaf);
      this._springRaf = 0;
    }
  }

  /** 写入 transform */
  _apply() {
    if (!this.pan) return;
    // ⚠ 倾斜与平移必须写在**同一个** transform 里。
    //   .board-pan 的 transform 是行内样式 —— 行内优先级高于选择器，
    //   若把 rotateX 单独写在 CSS 规则里，会被这里整个盖掉，
    //   表现为「切了 3D 但画面完全没倾斜」（实测踩过）。
    //
    // ⚠ 顺序很重要：先 rotateX 再 translate3d —— 平移在倾斜**之内**，
    //   拖拽量才不会被透视投影二次放大。
    const tilt = this.is3D ? 'rotateX(45deg) ' : '';
    // 3D 模式下额外给一点 Z 位移，避免棋盘「贴脸」
    const z = this.is3D ? '-40px' : '0px';
    this.pan.style.transform =
      `${tilt}translate3d(${this.x.toFixed(2)}px, ${this.y.toFixed(2)}px, ${z})`;
  }
}
