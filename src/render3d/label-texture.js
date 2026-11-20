/**
 * 地块**悬浮名牌** —— 永远正对相机的 Sprite（billboard）。
 *
 * ================== 为什么必须有这一层 ==================
 * 真等距下，地块顶面被压缩到屏幕上的 ~25×15 px。
 * 这么小的面积**放不下**「名称 + 买入价 + 管理费 + 等级」——
 * 强行画进顶面纹理只会得到一堆看不懂的糊字。
 *
 * 纪念碑谷类游戏的解法是**分层**：
 *   · **顶面纹理** → 只放「色带 + 等级刻度 + 一个大号主读数」
 *     （在 25px 下仍然能分辨归属与等级）；
 *   · **悬浮名牌** → 放「名称 + 关键读数 + 持有人」，
 *     用 Sprite 永远正对相机，尺寸按屏幕像素锁定 → 清晰可读。
 *
 * ================== 为什么用 Sprite 而不是 DOM ==================
 * DOM 覆盖层需要额外的命中判定与深度排序，且与 WebGL 画布不在同一
 * 合成层，缩放/旋转时容易错位。Sprite 是**场景内**对象 ——
 * 相机旋转时自动跟着转，深度排序由 three.js 负责，永远正确。
 *
 * ================== 性能 ==================
 * 34 个 Sprite，每个一张独立 CanvasTexture。
 * 只有「名称 + 等级 + 持有人」变化时才重绘（脏纹理策略同 tile-texture）。
 */

/** 名牌纹理宽高（像素） */
export const LABEL_W = 320;
export const LABEL_H = 96;

const FONT_UI = '"Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif';
const FONT_NUM = '"Consolas", "Menlo", monospace';

/** 圆角矩形 */
function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

/**
 * 名牌绘制器 —— 管理 34 张名牌纹理（脏纹理重绘）。
 */
export class LabelPainter {
  constructor() {
    /** index → { canvas, ctx, texture, stateKey } */
    this.slots = new Map();
    /** 本轮重绘数 */
    this.redrawCount = 0;
    /** 名牌总数 */
    this.labelCount = 0;
  }

  /**
   * 取得某格的名牌纹理。
   *
   * @param {number} index
   * @param {object} face  tileFace() 的结果
   * @param {THREE} THREE
   * @returns {THREE.CanvasTexture}
   */
  acquire(index, face, THREE) {
    const key = this.stateKeyOf(face);
    let slot = this.slots.get(index);
    if (!slot) {
      const canvas = document.createElement('canvas');
      canvas.width = LABEL_W;
      canvas.height = LABEL_H;
      const ctx = canvas.getContext('2d');
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = 4;
      texture.needsUpdate = true;
      slot = { canvas, ctx, texture, stateKey: null };
      this.slots.set(index, slot);
      this.labelCount++;
    }
    if (slot.stateKey !== key) {
      slot.stateKey = key;
      this.paint(slot.ctx, face);
      slot.texture.needsUpdate = true;
      this.redrawCount++;
    }
    return slot.texture;
  }

  /** 状态指纹 */
  stateKeyOf(face) {
    return [
      face.title, face.kind,
      face.held ? face.owner.main : '-',
      face.ownerName || '-',
      face.mainValue, face.mainLabel,
      face.subValue, face.subLabel,
      face.footLabel, face.footValue,
      face.mortgaged ? 1 : 0,
      face.affordable ? 1 : 0,
      face.segments ? face.segments.map((s) => (s.solid ? '1' : s.pending ? 'd' : '0')).join('') : '',
      face.effectBig || '',
      face.effectUnit || '',
    ].join('~');
  }

  /** 重绘统计复位 */
  resetCount() {
    this.redrawCount = 0;
  }

  /** 名牌总数 */
  get count() {
    return this.labelCount;
  }

  /* ===========================================================
   * 绘制一张名牌
   * =========================================================== */
  paint(ctx, face) {
    const W = LABEL_W;
    const H = LABEL_H;

    ctx.clearRect(0, 0, W, H);
    ctx.textBaseline = 'middle';

    // ---- 底板：深色胶囊（与深色金融城背景协调）----
    ctx.fillStyle = 'rgba(18, 23, 36, .92)';
    roundRect(ctx, 4, 4, W - 8, H - 8, 16);
    ctx.fill();

    // ---- 左侧归属色条 ----
    const accent = face.held ? face.owner.main : face.accent;
    ctx.fillStyle = accent;
    roundRect(ctx, 4, 4, 14, H - 8, 7);
    ctx.fill();

    // ---- 名称 ----
    ctx.textAlign = 'left';
    ctx.fillStyle = '#f6efe0';
    ctx.font = `bold 34px ${FONT_UI}`;
    const name = String(face.title || '');
    // 名称过长 → 缩字号（不截断，宁可换行）
    let size = 34;
    while (size > 22 && ctx.measureText(name).width > W - 46) {
      size -= 2;
      ctx.font = `bold ${size}px ${FONT_UI}`;
    }
    ctx.fillText(name, 30, 28);

    // ---- 等级 / 状态行 ----
    ctx.font = `20px ${FONT_UI}`;
    ctx.fillStyle = 'rgba(246,239,224,.72)';
    const sub = [face.footLabel, face.kind === 'institution' ? face.footValue : '']
      .filter(Boolean).join(' · ');
    ctx.fillText(sub, 30, 60);

    // ---- 右侧主读数 ----
    ctx.textAlign = 'right';
    ctx.fillStyle = face.held ? '#ffc861' : '#f6efe0';
    ctx.font = `bold 32px ${FONT_NUM}`;
    ctx.fillText(face.mainValue || '', W - 16, 30);
    ctx.fillStyle = 'rgba(246,239,224,.66)';
    ctx.font = `18px ${FONT_UI}`;
    ctx.fillText(face.mainLabel || '', W - 16, 62);

    // ---- 持有人真名（已持有时）----
    if (face.held && face.ownerName) {
      ctx.textAlign = 'left';
      ctx.fillStyle = face.owner.main;
      ctx.font = `bold 19px ${FONT_UI}`;
      ctx.fillText(face.ownerName, 30, 84);
    } else if (face.affordable) {
      ctx.textAlign = 'left';
      ctx.fillStyle = '#4f9d55';
      ctx.font = `bold 19px ${FONT_UI}`;
      ctx.fillText('可收购', 30, 84);
    }

    // ---- 质押印章 ----
    if (face.mortgaged) {
      ctx.save();
      ctx.translate(W - 74, H - 20);
      ctx.rotate(-0.18);
      ctx.strokeStyle = 'rgba(200,57,43,.9)';
      ctx.lineWidth = 2;
      roundRect(ctx, -40, -12, 80, 24, 5);
      ctx.stroke();
      ctx.fillStyle = 'rgba(200,57,43,.95)';
      ctx.font = `bold 17px ${FONT_UI}`;
      ctx.textAlign = 'center';
      ctx.fillText('已质押', 0, 1);
      ctx.restore();
    }

    // ---- 边框 ----
    ctx.strokeStyle = face.held ? face.owner.main : 'rgba(232,169,60,.42)';
    ctx.lineWidth = 2;
    roundRect(ctx, 4, 4, W - 8, H - 8, 16);
    ctx.stroke();
  }
}
