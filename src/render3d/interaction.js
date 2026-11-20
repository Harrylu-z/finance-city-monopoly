/**
 * 真等距 3D 交互控制器 —— 旋转吸附 / 平移 / 缩放 / 点选。
 *
 * ================== 手势语义（用户拍板）==================
 *   · **单指左右拖** → 攒旋转量，松手吸附到最近的 90° 档位；
 *   · **单指上下拖** → 小范围平移（钳制在视口的 18%）；
 *   · **双指 pinch / 滚轮** → 正交缩放 1 ~ 2.2；
 *   · **点击** → 选中地块（底部详情条）；
 *   · **双击空白** → 回正（方位角回到 45°、平移归零、缩放回 1）；
 *   · **左右旋转按钮** → 与手势共用同一个 `snapTo` 入口。
 *
 * ⚠ 旋转中**关闭 raycast** —— 旋转时指针扫过地块会误触发选中。
 *
 * ================== 旋转手感的两个关键 ==================
 *   ① **攒量**：拖拽不立刻改变相机，而是累计到 `pendingQuarters`；
 *      松手才吸附。这样「轻轻拖一下」不会把整个棋盘转歪。
 *   ② **吸附动画**：350ms easeInOutCubic（`iso-geometry.js` 的
 *      `easeAzimuth`），旋转过程顺滑、不生硬。
 *
 * ================== 与旧管线共存 ==================
 * 本控制器**只在 `?board=3d` 时启用**，旧管线的 Stage3D 逻辑不变。
 */

import {
  azimuthOf, quarterTurnsFor,
  easeAzimuth, SNAP_MS, ISO_STEP_RAD,
} from './iso-geometry.js';

/** 拖拽启动的最小位移（像素）—— 沿用 stage3d.js 的判定 */
export const DRAG_THRESHOLD = 4;

/** 平移允许范围（相对视口尺寸的比例）—— 与 stage3d.js 一致 */
export const PAN_LIMIT = 0.18;

/** 拖满一档（90°）所需的横向像素 */
export const PIXELS_PER_QUARTER = 180;

/** 缩放范围 */
export const ZOOM_MIN = 1;
export const ZOOM_MAX = 2.2;

/**
 * 交互控制器。
 */
export class Iso3DController {
  /**
   * @param {HTMLElement} dom 事件宿主（通常是 #board-wrap 或 canvas 的父容器）
   * @param {object} scene    Scene3D
   * @param {object} opts     { onSelect, onRotate, onZoom, onPan, onDoubleClickEmpty }
   */
  constructor(dom, scene, opts = {}) {
    this.dom = dom;
    this.scene = scene;
    this.onSelect = opts.onSelect || null;
    this.onRotate = opts.onRotate || null;
    this.onZoom = opts.onZoom || null;
    this.onPan = opts.onPan || null;
    this.onDoubleClickEmpty = opts.onDoubleClickEmpty || null;

    /** 正在拖拽 */
    this.dragging = false;
    /** 已超过阈值 */
    this.moved = false;
    /** 当前指针 id */
    this._pointerId = null;
    /** 拖拽起点 */
    this._start = { x: 0, y: 0 };
    /** 旋转累计量（像素） */
    this._rotateAccum = 0;
    /** 平移累计量（场景单位） */
    this._panAccum = { x: 0, z: 0 };
    /** 多点触控表 */
    this._pointers = new Map();
    /** 双指基准距离 */
    this._pinchDist = 0;
    this._pinchZoom = 1;
    /** 是否正在旋转动画 */
    this.rotating = false;
    /** 旋转动画 */
    this._rot = null;
    /** 吸附动画 rAF */
    this._rotRaf = 0;
    /** 当前档位 */
    this.quarter = 0;
    /** hover 的地块索引（-1 = 无） */
    this.hoverIndex = -1;
    /** hover 回调 */
    this.onHover = opts.onHover || null;

    this._bind();
  }

  /* ===========================================================
   * 事件绑定
   * =========================================================== */
  _bind() {
    if (!this.dom) return;
    const dom = this.dom;
    dom.style.touchAction = 'none';
    dom.addEventListener('pointerdown', (e) => this._onDown(e));
    window.addEventListener('pointermove', (e) => this._onMove(e));
    window.addEventListener('pointerup', (e) => this._onUp(e));
    window.addEventListener('pointercancel', (e) => this._onUp(e));
    dom.addEventListener('wheel', (e) => this._onWheel(e), { passive: false });
    dom.addEventListener('dblclick', (e) => this._onDoubleClick(e));
    // 阻止浏览器的双指缩放（页面级 pinch）
    dom.addEventListener('gesturestart', (e) => e.preventDefault());
  }

  /* ===========================================================
   * 指针
   * =========================================================== */
  _onDown(e) {
    if (e.button !== undefined && e.button !== 0) return;
    this._pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (this._pointers.size === 2) {
      // 进入双指模式 —— 取消单指拖拽
      this.dragging = false;
      this.moved = false;
      this._pinchDist = this._distance();
      this._pinchZoom = this.scene.zoom;
      return;
    }
    if (this._pointers.size > 2) return;

    this._cancelRotation();
    this._pointerId = e.pointerId;
    this.dragging = true;
    this.moved = false;
    this._start = { x: e.clientX, y: e.clientY };
    this._rotateAccum = 0;
    this._panAccum = { x: 0, z: 0 };
  }

  _onMove(e) {
    if (this._pointers.has(e.pointerId)) {
      this._pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }

    // ---- 双指 pinch ----
    if (this._pointers.size === 2) {
      e.preventDefault();
      const d = this._distance();
      if (this._pinchDist > 0 && d > 0) {
        const next = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, this._pinchZoom * (d / this._pinchDist)));
        this.scene.setZoom(next);
        if (this.onZoom) this.onZoom(next);
      }
      return;
    }

    if (!this.dragging) {
      // ---- 未拖拽 → hover 拾取 ----
      this._updateHover(e);
      return;
    }
    if (e.pointerId !== this._pointerId) return;

    const dx = e.clientX - this._start.x;
    const dy = e.clientY - this._start.y;

    if (!this.moved) {
      if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
      this.moved = true;
    }
    e.preventDefault();

    // ---- 横向 = 旋转（攒量）· 纵向 = 平移 ----
    this._rotateAccum = dx;
    this._panAccum = { x: 0, z: dy / this._pixelsPerUnit() };

    // 实时预览旋转（不吸附）：直接按累计量连续旋转
    const preview = this._previewAzimuth();
    this.scene.setAzimuth(preview);

    // 平移实时生效（钳制）
    const lim = this._panLimit();
    const pz = Math.max(-lim, Math.min(lim, this._panAccum.z));
    this.scene.setPan(0, pz);
    if (this.onPan) this.onPan(0, pz);
  }

  _onUp(e) {
    if (this._pointers.has(e.pointerId)) this._pointers.delete(e.pointerId);

    if (this._pointers.size < 2) this._pinchDist = 0;

    if (!this.dragging || (e && e.pointerId !== this._pointerId)) return;
    this.dragging = false;
    this._pointerId = null;

    if (!this.moved) {
      // ---- 点击：raycast 选地块 ----
      // ⚠ 旋转中不触发点击（避免拖动结束误选）
      if (!this.rotating) this._pick(e);
      return;
    }

    // ---- 松手：吸附到最近的 90° ----
    const delta = quarterTurnsFor(this._rotateAccum, PIXELS_PER_QUARTER);
    this.snapTo(this.quarter + delta);

    // 平移松手后保持在钳制范围内（不弹回 —— 3D 里弹回会让构图跳动）
    const lim = this._panLimit();
    const pz = Math.max(-lim, Math.min(lim, this._panAccum.z));
    this.scene.setPan(0, pz);
  }

  _onWheel(e) {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 0.92 : 1.08;
    const next = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, this.scene.zoom * factor));
    this.scene.setZoom(next);
    if (this.onZoom) this.onZoom(next);
  }

  _onDoubleClick(e) {
    // 双击空白 → 回正；双击地块 → 交给选中逻辑
    const hit = this._raycast(e);
    if (!hit) {
      this.resetView();
      if (this.onDoubleClickEmpty) this.onDoubleClickEmpty();
    } else {
      if (this.onSelect) this.onSelect(hit.index, e);
    }
  }

  /* ===========================================================
   * 旋转吸附
   * =========================================================== */

  /**
   * 拖拽中的预览角度 —— 累计像素 → 连续角度（不吸附）。
   */
  _previewAzimuth() {
    const base = azimuthOf(this.quarter);
    const delta = (this._rotateAccum / PIXELS_PER_QUARTER) * ISO_STEP_RAD;
    // 向右拖 → 顺时针 → 方位角减小
    return base - delta;
  }

  /**
   * 吸附到某个档位 —— **按钮与手势共用这个入口**。
   *
   * @param {number} targetQuarter 目标档位（0..3，可越界）
   * @param {number} ms 动画时长
   */
  snapTo(targetQuarter, ms = SNAP_MS) {
    this._cancelRotation();
    const from = this.scene.azimuth;
    // 目标角度取**最近的**等价角（避免绕远路转 270°）
    const target = this._nearestEquivalent(from, targetQuarter);
    this.quarter = ((Math.round(targetQuarter) % 4) + 4) % 4;

    if (Math.abs(target - from) < 1e-4) {
      this.scene.setAzimuth(target);
      this.rotating = false;
      if (this.onRotate) this.onRotate(this.quarter);
      return;
    }

    this.rotating = true;
    const start = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - start) / ms);
      this.scene.setAzimuth(easeAzimuth(from, target, t));
      if (t < 1) {
        this._rotRaf = requestAnimationFrame(step);
      } else {
        this._rotRaf = 0;
        this.rotating = false;
        this.scene.setAzimuth(target);
        if (this.onRotate) this.onRotate(this.quarter);
      }
    };
    this._rotRaf = requestAnimationFrame(step);
  }

  /**
   * 求与 `from` 最近的等价目标角（避免长距离回转）。
   */
  _nearestEquivalent(from, targetQuarter) {
    const base = azimuthOf(targetQuarter);
    const k = Math.round((from - base) / (ISO_STEP_RAD * 4));
    return base + k * ISO_STEP_RAD * 4;
  }

  /** 取消旋转动画 */
  _cancelRotation() {
    if (this._rotRaf) {
      cancelAnimationFrame(this._rotRaf);
      this._rotRaf = 0;
    }
    this.rotating = false;
  }

  /* ===========================================================
   * 视角复位
   * =========================================================== */

  /** 回正 —— 方位角回到 45°、平移归零、缩放回 1 */
  resetView() {
    this.snapTo(0);
    this.scene.setPan(0, 0);
    this.scene.setZoom(ZOOM_MIN);
    if (this.onPan) this.onPan(0, 0);
    if (this.onZoom) this.onZoom(ZOOM_MIN);
  }

  /* ===========================================================
   * 拾取
   * =========================================================== */

  /**
   * 屏幕坐标 → 命中的地块索引。
   *
   * @param {PointerEvent|MouseEvent} e
   * @returns {{index: number, point: object}|null}
   */
  _raycast(e) {
    const scene = this.scene;
    if (!scene || !scene.camera || !scene.renderer) return null;
    const rect = scene.renderer.domElement.getBoundingClientRect();
    const ndc = {
      x: ((e.clientX - rect.left) / rect.width) * 2 - 1,
      y: -((e.clientY - rect.top) / rect.height) * 2 + 1,
    };
    if (!this._raycaster) {
      this._raycaster = new scene.THREE.Raycaster();
    }
    this._raycaster.setFromCamera(ndc, scene.camera);
    const targets = [];
    for (const [, mesh] of scene.boardGroup.children.length ? scene.tileMeshesMap || [] : []) {
      targets.push(mesh);
    }
    if (!targets.length) {
      // 兜底：遍历 boardGroup 的 tile-* 子节点
      scene.boardGroup.traverse((o) => {
        if (o.name && o.name.startsWith('tile-')) targets.push(o);
      });
    }
    const hits = this._raycaster.intersectObjects(targets, false);
    if (!hits.length) return null;
    const obj = hits[0].object;
    const index = obj.userData ? obj.userData.cellIndex : undefined;
    if (index == null) return null;
    return { index, point: hits[0].point };
  }

  /**
   * hover 拾取 —— 拖拽中不做（旋转时会误触发）。
   *
   * @param {PointerEvent|MouseEvent} e
   */
  _updateHover(e) {
    const hit = this._raycast(e);
    const index = hit ? hit.index : -1;
    if (index === this.hoverIndex) return;
    this.hoverIndex = index;
    if (this.onHover) this.onHover(index, e);
  }

  /** 点击拾取 */
  _pick(e) {
    const hit = this._raycast(e);
    if (!hit) {
      if (this.onSelect) this.onSelect(-1, e);
      return;
    }
    if (this.onSelect) this.onSelect(hit.index, e);
  }

  /* ===========================================================
   * 辅助
   * =========================================================== */
  _distance() {
    const pts = [...this._pointers.values()];
    if (pts.length < 2) return 0;
    return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
  }

  /** 一个 CSS 像素对应多少场景单位（用于纵向平移换算） */
  _pixelsPerUnit() {
    const scene = this.scene;
    if (!scene || !scene.camera) return 40;
    const h = scene._h || 1;
    const halfH = (scene.camera.top - scene.camera.bottom) / 2;
    return h / (halfH * 2);
  }

  /** 平移钳制范围（场景单位） */
  _panLimit() {
    const scene = this.scene;
    if (!scene || !scene.camera) return 1;
    const halfH = (scene.camera.top - scene.camera.bottom) / 2;
    return halfH * PAN_LIMIT;
  }
}
