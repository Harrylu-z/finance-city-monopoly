/**
 * 真等距 3D 棋盘 —— 总控制器（把 scene / board / texture / piece / 交互串起来）。
 *
 * ================== 与旧管线的关系 ==================
 *   · 旧管线（Canvas 2D + DOM 地块）**默认不变**；
 *   · `?board=3d` 时启用本控制器，走 Three.js 真等距渲染；
 *   · **规则层零改动** —— 本模块只读 `core/*` 的数据，从不写。
 *
 * ================== 逐格跳跃 ==================
 * 棋子沿 `TRACK_CELLS` 逐格 hop：
 *   · 每格 ~140ms；
 *   · 抛物线高 0.35 砖（相对格宽）；
 *   · 落地 squash 0.85（压扁到 85% 再弹回）；
 *   · 传送（清算所 / 跨境互联）改为**沉降升起**（不是逐格跳）。
 */

import { BOARD_CELLS, BOARD_SIZE, TRACK_CELLS, BOARD_GRID } from '../core/board.js';
import { Scene3D } from './scene.js';
import { Board3DBuilder } from './board-builder.js';
import { TileTexturePainter } from './tile-texture.js';
import { LabelPainter, LABEL_W, LABEL_H } from './label-texture.js';

/** 名牌纹理宽高比 */
const LABEL_ASPECT = LABEL_W / LABEL_H;
import { tileFace, tileState } from './tile-face.js';
import { CareerPiece3D } from './career-piece3d.js';
import { Iso3DController } from './interaction.js';
import { HOVER_LIFT, gridToScene, projectIso } from './iso-geometry.js';

/** 逐格跳跃时长（毫秒） */
export const HOP_MS = 140;
/** 抛物线高度（场景单位） */
export const HOP_HEIGHT = 0.35;
/** 落地压缩量 */
export const SQUASH = 0.85;
/** 传送沉降动画时长（毫秒） */
export const TELEPORT_MS = 520;

/**
 * 名牌的世界宽度（场景单位）。
 *
 * ⚠ 正交相机下「屏幕像素尺寸」= 世界尺寸 × (像素数 / frustum 宽度)，
 *   frustum 宽度随视口比例变化 —— 所以名牌的世界尺寸必须
 *   **随视口一起缩放**，才能保证「屏幕上的名牌始终一样大」。
 *   `resize()` 里会按视口重算并回写。
 */
export const LABEL_WORLD_WIDTH = 1.55;

/**
 * 3D 棋盘控制器。
 */
export class Iso3DBoard {
  /**
   * @param {HTMLCanvasElement} canvas 渲染目标
   * @param {object} opts { onSelect, onCellDetail }
   */
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.opts = opts;
    this.THREE = null;
    this.scene = null;
    this.builder = null;
    this.textures = null;
    this.pieces = null;
    this.controller = null;

    /** 游戏状态 */
    this.state = null;
    /** 已创建的场景是否就绪 */
    this.ready = false;
    /** 移动动画 */
    this._move = null;
    /** hover 的地块索引 */
    this.hoverIndex = -1;
    /** 选中的地块索引 */
    this.selectedIndex = -1;
    /** 上一帧时间戳 */
    this._lastT = 0;
    /** 动画帧 id */
    this._raf = 0;
    /** 地块顶面 mesh 表（供 raycast） */
    this.tileMeshesMap = [];
    /** 统计：纹理重绘次数 */
    this.redraws = 0;
    /** 名牌显示模式 —— 'focus'（默认）| 'all' */
    this.labelMode = 'focus';
    /** 焦点格索引（当前回合玩家所在格） */
    this.focusIndex = -1;
  }

  /**
   * 初始化 —— 动态 import three.js（CDN）。
   *
   * @param {number} w 宽
   * @param {number} h 高
   */
  async init(w, h) {
    this.THREE = await loadThree();
    this.scene = new Scene3D(this.THREE);
    this.scene.init(this.canvas, w, h);

    this.builder = new Board3DBuilder(this.THREE);
    this.scene.boardGroup.add(this.builder.build());
    this.tileMeshesMap = [...this.builder.tileMeshes.values()];

    this.textures = new TileTexturePainter();
    this.labels = new LabelPainter();
    this.pieces = new CareerPiece3D(this.THREE);

    // 棋子容器 —— 挂在 scene.pieceGroup 之下
    this.pieceRoot = new this.THREE.Group();
    this.pieceRoot.name = 'piece-root';
    this.scene.pieceGroup.add(this.pieceRoot);
    this.pieces.group = this.pieceRoot;

    this.controller = new Iso3DController(
      this.canvas.parentElement || this.canvas,
      this.scene,
      {
        onSelect: (index, e) => {
          if (index >= 0) {
            this.selectedIndex = index;
            if (this.opts.onSelect) this.opts.onSelect(index, e);
          } else {
            this.selectedIndex = -1;
          }
        },
        // 方位角变了 → 重新取景（保证任何档位都不切角）
        onRotate: () => this.applyFrame(),
        // hover → 该格上浮 + 名牌浮现
        onHover: (index) => {
          this.setHover(index);
        },
      },
    );
    this.applyFrame();

    this.ready = true;
    this._lastT = performance.now();
    this._loop();
    return this;
  }

  /* ===========================================================
   * 取景 —— 按当前方位角重算棋盘的屏幕包围盒
   * =========================================================== */

  /**
   * 计算棋盘在当前方位角下的屏幕包围盒。
   *
   * 取「所有砖块四角 + 最高砖的顶面四角」的投影极值 ——
   * 这样 45° 档与 135° 档各自取到最紧的取景，不会切角。
   *
   * @returns {{w: number, h: number}} 屏幕包围盒尺寸（场景单位）
   */
  computeFrame() {
    const az = this.scene.azimuth;
    const cols = BOARD_GRID.cols;
    const rows = BOARD_GRID.rows;
    const half = 0.5;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    const push = (x, y, z) => {
      const p = projectIso(x, y, z, az);
      if (p.sx < minX) minX = p.sx;
      if (p.sx > maxX) maxX = p.sx;
      if (p.sy < minY) minY = p.sy;
      if (p.sy > maxY) maxY = p.sy;
    };

    // ⚠ 只取**砖块**的投影范围 —— 不把底板算进来。
    //   底板比砖块大一圈，若纳入取景会让整盘棋在画面里缩成一团。
    for (const [, b] of this.builder.bricks) {
      const top = b.height + 0.35;     // 含地标尖顶的高度余量
      for (const dx of [-half, half]) {
        for (const dz of [-half, half]) {
          push(b.x + dx, 0, b.z + dz);
          push(b.x + dx, top, b.z + dz);
        }
      }
    }

    return { w: maxX - minX, h: maxY - minY };
  }

  /** 重算取景并套用到相机 */
  applyFrame() {
    if (!this.scene || !this.builder) return;
    this.scene.setFrame(this.computeFrame());
    this._layoutLabels();
  }

  /* ===========================================================
   * 状态同步
   * =========================================================== */

  /**
   * 同步游戏状态 —— 纹理 / 砖高 / 棋子位置。
   *
   * @param {object} state 游戏状态
   */
  sync(state) {
    if (!this.ready || !state) return;
    this.state = state;
    const THREE = this.THREE;

    // ---- 砖块高度 + 顶面纹理 ----
    this.textures.resetCount();
    for (let i = 0; i < BOARD_SIZE; i++) {
      const cell = BOARD_CELLS[i];
      const inst = this._findInst(state, i);
      const level = inst ? inst.level : (cell.tier || 0);
      this.builder.setHeight(i, level);
      this.builder.setHeldStyle(i, !!inst);

      const tex = this.textures.acquire(i, cell, state, THREE);
      this.builder.setTexture(i, tex);

      // ---- 悬浮名牌（完整读数，永远正对相机）----
      const st = tileState(state, i);
      const face = tileFace(cell, st);
      const ltex = this.labels.acquire(i, face, THREE);
      this.builder.attachLabel(i, ltex, LABEL_WORLD_WIDTH);
    }
    this.redraws += this.textures.redrawCount;

    // ---- 棋子 ----
    const cur = state.players && state.players[state.currentPlayerIndex];
    this.pieces.setCurrent(cur ? cur.id : null);
    if (cur && cur.position !== this.focusIndex) {
      this.focusIndex = cur.position;
      this._layoutLabels();
    }
    for (const p of state.players || []) {
      if (p.bankrupt) {
        const g = this.pieces.pieces.get(p.id);
        if (g) g.group.visible = false;
        continue;
      }
      const group = this.pieces.acquire(p.id, p.avatar, p.colorIndex, !!p.isAI);
      if (!group.parent) this.pieceRoot.add(group);
      group.visible = true;
      // 位置（移动动画进行中则由动画接管）
      if (!this._move || this._move.playerId !== p.id) {
        const pos = this.cellPosition(p.position);
        group.position.x = pos.x;
        group.position.z = pos.z;
        group.position.y = 0;
      }
    }
  }

  /** 某格中心的世界坐标（XZ 平面） */
  cellPosition(index) {
    const i = ((index % BOARD_SIZE) + BOARD_SIZE) % BOARD_SIZE;
    const [col, row] = TRACK_CELLS[i];
    return gridToScene(col, row, BOARD_GRID.cols, BOARD_GRID.rows);
  }

  _findInst(state, index) {
    for (const p of state.players || []) {
      for (const inst of p.institutions || []) {
        if (inst.cellIndex === index) return inst;
      }
    }
    return null;
  }

  /* ===========================================================
   * 移动动画 —— 逐格 hop / 传送沉降
   * =========================================================== */

  /**
   * 启动一次移动动画。
   *
   * @param {number} playerId
   * @param {number[]} path 格索引序列
   * @param {object} opts { teleport, onLand, onDone }
   */
  moveAlong(playerId, path, opts = {}) {
    if (!this.ready) return;
    const piece = this.pieces.pieces.get(playerId);
    if (!piece) return;

    if (opts.teleport) {
      this._move = {
        playerId, kind: 'teleport', t: 0, start: performance.now(),
        from: { x: piece.group.position.x, z: piece.group.position.z },
        to: this.cellPosition(path[path.length - 1]),
        opts,
      };
      return;
    }

    this._move = {
      playerId, kind: 'hop', step: 0, path: path.slice(),
      stepStart: performance.now(),
      from: this.cellPosition(path.length ? path[0] : 0),
      opts,
    };
    // 起点就是第一格的前一格
    const startIdx = path.length ? path[0] : 0;
    const prev = (startIdx - 1 + BOARD_SIZE) % BOARD_SIZE;
    this._move.from = this.cellPosition(prev);
    this._move.to = this.cellPosition(path[0]);
    piece.group.position.x = this._move.from.x;
    piece.group.position.z = this._move.from.z;
  }

  /** 推进移动动画（由主循环调用） */
  _updateMove(now) {
    const m = this._move;
    if (!m) return;
    const piece = this.pieces.pieces.get(m.playerId);
    if (!piece) { this._move = null; return; }

    if (m.kind === 'teleport') {
      const t = Math.min(1, (now - m.start) / TELEPORT_MS);
      // 沉降 → 升起
      const dip = Math.sin(t * Math.PI);
      const to = m.to;
      const x = m.from.x + (to.x - m.from.x) * t;
      const z = m.from.z + (to.z - m.from.z) * t;
      piece.group.position.set(x, -dip * 0.6, z);
      const s = 1 - dip * 0.28;
      piece.group.scale.set(s, 1 + dip * 0.10, s);
      if (t >= 1) {
        piece.group.scale.set(1, 1, 1);
        piece.group.position.y = 0;
        this._move = null;
        if (m.opts.onDone) m.opts.onDone();
      }
      return;
    }

    // ---- 逐格 hop ----
    const t = Math.min(1, (now - m.stepStart) / HOP_MS);
    const from = m.from;
    const to = m.to;
    // 抛物线
    const h = Math.sin(t * Math.PI) * HOP_HEIGHT;
    piece.group.position.set(
      from.x + (to.x - from.x) * t,
      h,
      from.z + (to.z - from.z) * t,
    );
    // 落地前压缩
    if (t > 0.78) {
      const k = (t - 0.78) / 0.22;
      const s = 1 - (1 - SQUASH) * k;
      piece.group.scale.set(s, 2 - s, s);
    } else {
      piece.group.scale.set(1, 1, 1);
    }

    if (t >= 1) {
      // 落地
      piece.group.scale.set(SQUASH, 2 - SQUASH, SQUASH);
      this.pieces.applySquash(m.playerId, SQUASH);
      piece.group.position.set(to.x, 0, to.z);
      if (m.opts.onLand) m.opts.onLand(m.step);

      m.step++;
      if (m.step >= m.path.length) {
        this._move = null;
        if (m.opts.onDone) m.opts.onDone();
        return;
      }
      m.from = m.to;
      m.to = this.cellPosition(m.path[m.step]);
      m.stepStart = now;
    }
  }

  /* ===========================================================
   * hover / 选中
   * =========================================================== */

  /**
   * 设置 hover 的地块（抬升 0.25 + 发光）。
   *
   * @param {number} index
   */
  setHover(index) {
    if (index === this.hoverIndex) return;
    this.hoverIndex = index;
    this._applyLift();
  }

  /**
   * 设置选中的地块。
   *
   * @param {number} index
   */
  setSelected(index) {
    if (index === this.selectedIndex) return;
    this.selectedIndex = index;
    this._applyLift();
  }

  _applyLift() {
    for (const [i, b] of this.builder.bricks) {
      const isHover = i === this.hoverIndex;
      const isSel = i === this.selectedIndex;
      const lift = isSel ? HOVER_LIFT * 1.4 : (isHover ? HOVER_LIFT : 0);
      b.brick.position.y = b.height / 2 + lift;
      b.top.position.y = b.height + lift;
      if (b.spire) b.spire.position.y = b.height + lift + 0.275;
      if (b.dome) b.dome.position.y = b.height + lift + 0.04;
      // 选中 / hover → 顶面提亮
      b.top.material.emissive.setHex(
        isSel ? 0x4a5568 : (isHover ? 0x2a3245 : 0x000000),
      );
      b.top.material.emissiveIntensity = isSel ? 0.55 : (isHover ? 0.32 : 0);
      // 砖体侧面也同步抬升
      b.brick.scale.y = b.height;
    }
    // 名牌跟着抬升 / 缩放
    this._layoutLabels();
  }

  /* ===========================================================
   * 视角控制（对外）
   * =========================================================== */

  /** 旋转吸附到某档位 */
  snapTo(quarter) {
    if (this.controller) this.controller.snapTo(quarter);
  }

  /** 当前档位 */
  get quarter() {
    return this.controller ? this.controller.quarter : 0;
  }

  /** 缩放 */
  setZoom(z) {
    if (this.scene) this.scene.setZoom(z);
  }

  /** 平移 */
  setPan(x, z) {
    if (this.scene) this.scene.setPan(x, z);
  }

  /** 回正 */
  resetView() {
    if (this.controller) this.controller.resetView();
  }

  /* ===========================================================
   * 主循环
   * =========================================================== */
  _loop() {
    const step = () => {
      if (!this.ready) return;
      const now = performance.now();
      const dt = Math.min(0.05, (now - this._lastT) / 1000);
      this._lastT = now;
      this._updateMove(now);
      // ⚠ 把「正在移动」的棋子 id 告诉棋子层 ——
      //   避免呼吸动画覆盖跳跃动画的 Y / 缩放。
      this._movingIds = this._move ? MOVING_IDS_HOLDER(this._move.playerId) : null;
      this.pieces.update(dt, this._movingIds);
      this.scene.render();
      this._raf = requestAnimationFrame(step);
    };
    this._raf = requestAnimationFrame(step);
  }

  /** 停止渲染循环 */
  stop() {
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = 0;
    this.ready = false;
  }

  /** 尺寸变化 */
  resize(w, h) {
    if (this.scene) this.scene.resize(w, h);
    this._layoutLabels();
  }

  /**
   * 名牌布局 —— 悬在砖块上方，且**屏幕尺寸恒定**。
   *
   * ⚠ 为什么需要重算：
   *   正交相机下 Sprite 的世界尺寸 → 屏幕像素的换算依赖 frustum 宽度，
   *   而 frustum 宽度随视口宽高比与缩放变化。
   *   若不重算，窗口拉宽时名牌会跟着变小（读不清）、
   *   放大时又会盖住棋盘。
   *
   * ⚠ **默认只显示「当前回合所在格 + 选中格 + hover 格」的名牌** ——
   *   34 块名牌全开会互相压盖，反而一个都读不清。
   *   这与纪念碑谷的做法一致：标签在你「看向」某处时浮现。
   *   `labelMode = 'all'` 可切到「全显」模式（自检与截图用）。
   */
  _layoutLabels() {
    if (!this.builder || !this.scene || !this.scene.camera) return;
    const cam = this.scene.camera;
    const frustumW = cam.right - cam.left;
    const px = this.scene._w || 1;
    // 名牌目标屏幕宽度：格宽的 1.6 倍（格宽 = 1 场景单位在屏幕上的像素数）
    const unitPx = px / frustumW;
    const wantPx = Math.max(90, Math.min(190, unitPx * 1.55));
    const worldW = wantPx / unitPx;

    const showAll = this.labelMode === 'all';
    const focus = this.focusIndex;

    for (const [i, b] of this.builder.bricks) {
      if (!b.label) continue;
      b.label.scale.set(worldW, worldW / LABEL_ASPECT, 1);
      const isHot = i === this.hoverIndex || i === this.selectedIndex || i === focus;
      const lift = (i === this.hoverIndex ? HOVER_LIFT : 0)
        + (i === this.selectedIndex ? HOVER_LIFT * 0.4 : 0);
      b.label.position.set(b.x, b.height + 0.30 + lift, b.z);
      // 非焦点名牌淡出（不隐藏 —— 淡出更柔和，也避免闪烁）
      const targetOpacity = showAll || isHot ? 1 : 0;
      const mat = b.label.material;
      mat.opacity += (targetOpacity - mat.opacity) * 0.25;
      b.label.visible = mat.opacity > 0.02;
    }
  }

  /**
   * 名牌显示模式 —— 'focus'（默认，仅焦点格）/ 'all'（全显）。
   *
   * @param {string} mode
   */
  setLabelMode(mode) {
    this.labelMode = mode === 'all' ? 'all' : 'focus';
    this._layoutLabels();
  }

  /**
   * 统计信息（自检断言用）。
   */
  stats() {
    const b = this.builder ? this.builder.stats() : {};
    return {
      ...b,
      textures: this.textures ? this.textures.textureCount : 0,
      pieces: this.pieces ? this.pieces.count : 0,
      drawCalls: this.scene ? this.scene.drawCalls : 0,
      triangles: this.scene ? this.scene.triangles : 0,
      quarter: this.quarter,
      zoom: this.scene ? this.scene.zoomLevel : 1,
    };
  }
}

/**
 * 单元素 Set 复用 —— 避免每帧 new Set 造成 GC 抖动。
 *
 * @param {number} id
 * @returns {Set<number>}
 */
const MOVING_IDS_HOLDER = (() => {
  const cache = new Map();
  return (id) => {
    let s = cache.get(id);
    if (!s) { s = new Set([id]); cache.set(id, s); }
    return s;
  };
})();

/* ===========================================================
 * three.js 动态加载（CDN）
 * =========================================================== */

/** CDN 地址 —— 优先用 importmap 之外的直连 ESM 构建 */
const THREE_CDN = 'https://unpkg.com/three@0.160.0/build/three.module.js';

let _threePromise = null;

/**
 * 加载 three.js —— 全局单例（避免重复下载）。
 *
 * @returns {Promise<object>} three.js 命名空间
 */
export function loadThree() {
  if (_threePromise) return _threePromise;
  _threePromise = import(/* @vite-ignore */ THREE_CDN)
    .catch((err) => {
      _threePromise = null;
      throw new Error(`three.js 加载失败（${THREE_CDN}）：${err && err.message ? err.message : err}`);
    });
  return _threePromise;
}
