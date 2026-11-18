/**
 * 落地特效层 —— PR-E（DOM 版）
 *
 * ================== 为什么不用 Canvas 画 ==================
 * 角色虽然画在 Canvas 上，但 **Canvas 位于整个棋盘的最底层** ——
 * 地块是 DOM 卡片，且**完全不透明**（白色渐变底），
 * 因此画在 Canvas 上的任何地面特效都会被牌面**完全遮住**。
 *
 * 对比：
 *   · Canvas 的 `fx-layer`（粒子 / 金币 / 礼花）→ 画在**上层**的 DOM；
 *   · 落地冲击波是「印在地面上」的 → 必须盖在**牌面之上**才能看见。
 *
 * ================== 为什么用百分比定位 ==================
 * `#fx-layer` 与 `#board-tiles` 同尺寸同位置（都在 #board-pan 内）。
 * 地块用**百分比**定位（left/top/width/height 相对 #board-tiles），
 * 因此 canvas 缩放时地块自动跟随，**无需 JS 重排**。
 *
 * 落地特效沿用同一套百分比定位 → 天然与地块对齐，无需同步两套尺寸。
 *
 * ================== 为什么特效也随棋盘倾斜 ==================
 * `#fx-layer` 在 `#board-pan` 之内 → 继承 `rotateX(45deg)`。
 * 所以冲击波在 3D 下会被透视压扁 —— 这是**正确的物理表现**：
 * 地面的圆在俯视时本来就该是椭圆。
 *
 * ⚠ 因此不需要额外的椭圆压扁补偿 —— CSS 透视已经替我们做了。
 */

import { BOARD_CELLS } from '../core/board.js';

/** 单个落地特效的 DOM */
class LandingFx {
  constructor(layer, cellIndex, color) {
    this.el = document.createElement('div');
    this.el.className = 'landing-fx';
    this.el.setAttribute('aria-hidden', 'true');
    this.el.dataset.index = String(cellIndex);

    this.ring = document.createElement('div');
    this.ring.className = 'landing-fx-ring';
    this.ring.style.borderColor = color;

    this.glow = document.createElement('div');
    this.glow.className = 'landing-fx-glow';
    this.glow.style.background = color;

    this.el.appendChild(this.glow);
    this.el.appendChild(this.ring);
    layer.appendChild(this.el);

    this.cellIndex = cellIndex;
    this.dead = false;
    // 触发 CSS 入场动画
    this.el.classList.add('is-in');
  }

  destroy() {
    if (this.el.parentNode) this.el.parentNode.removeChild(this.el);
  }
}

/**
 * 落地特效管理器
 */
export class LandingFxLayer {
  /**
   * @param {HTMLElement} layer  #fx-layer 容器
   * @param {object} renderer    BoardRenderer（提供 cellRect + 画布尺寸）
   */
  constructor(layer, renderer) {
    this.layer = layer;
    this.renderer = renderer || null;
    this.items = [];
    this.enabled = true;
  }

  /**
   * 在某格触发一次落地特效。
   *
   * @param {number} cellIndex 格子索引
   * @param {string} color     颜色（玩家色）
   */
  spawn(cellIndex, color) {
    if (!this.enabled || !this.layer) return;
    const cell = BOARD_CELLS[cellIndex];
    if (!cell) return;

    const rect = this._rectOf(cellIndex);
    if (!rect) return;

    const item = new LandingFx(this.layer, cellIndex, color);
    item.el.style.left = `${rect.x}%`;
    item.el.style.top = `${rect.y}%`;
    item.el.style.width = `${rect.w}%`;
    item.el.style.height = `${rect.h}%`;
    this.items.push(item);

    // 动画结束后移除
    setTimeout(() => {
      item.dead = true;
    }, 620);
  }

  /** 清理已结束的特效 */
  update() {
    if (!this.items.length) return;
    const keep = [];
    for (const it of this.items) {
      if (it.dead) it.destroy();
      else keep.push(it);
    }
    this.items = keep;
  }

  /** 全部清空 */
  clear() {
    for (const it of this.items) it.destroy();
    this.items.length = 0;
  }

  /**
   * 格子 → 百分比矩形（与地块层同一套坐标系）。
   */
  _rectOf(cellIndex) {
    const r = this.renderer;
    if (!r || !r.cellRect) return null;
    const rect = r.cellRect(cellIndex);
    const w = r.w || 1;
    const h = r.h || 1;
    return {
      x: (rect.x / w) * 100,
      y: (rect.y / h) * 100,
      w: (rect.w / w) * 100,
      h: (rect.h / h) * 100,
    };
  }
}
