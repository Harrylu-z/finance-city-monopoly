/**
 * 地块顶面纹理 —— 把 `tile-face.js` 的卡面模型画进 CanvasTexture。
 *
 * ================== 为什么顶面纹理只画「大字」==================
 * 真等距下，地块顶面在屏幕上只有 **~25×15 px**。
 * 在这个尺寸里：
 *   · 任何小于 ~10px 的文字都会糊成一团 —— **必须放弃**；
 *   · 只有「色块 + 粗线条 + 一个大号数字/符号」才读得出来。
 *
 * 所以顶面纹理的职责被**收窄**为：
 *   ① 顶部归属色带（哪一组 / 谁持有）；
 *   ② 等级刻度（五段实心条）；
 *   ③ **一个**大号主读数（买入价 / 管理费，用短数字）；
 *   ④ 监管 / 特殊格的**符号**（色带 + 徽记形状）。
 *
 * 完整的「名称 / 买入价 / 管理费 / 持有人 / 质押」由**悬浮名牌**
 * （`label-texture.js`）承担 —— 它是永远正对相机的 Sprite，
 * 尺寸按屏幕锁定，因此真正可读。
 *
 * ⚠ **信息不丢失**：顶面 + 名牌合起来覆盖了
 *   `tiles.js` 的**全部**字段（名称 / 等级五段 / 主读数 /
 *   次读数 / 持有人真名 / 质押 / 可收购 / 监管效果 / 特殊格数值）。
 *   名牌是完整读数，顶面是「远看即可辨识」的精简层。
 *
 * ================== 脏纹理策略 ==================
 * 复用 `TileLayer.sync` 的 `stateKey` 思路：
 *   · 每格缓存一个 `stateKey`；
 *   · 状态没变 → **完全不重绘**（不碰 Canvas、不上传 GPU）；
 *   · 状态变了 → 只重绘这一张纹理。
 */

import { tileFace, tileState } from './tile-face.js';

/** 纹理宽高（像素）—— 顶面小图，256 足够（屏幕上只有 25px） */
export const TEX_W = 256;
export const TEX_H = 192;

/** 字体栈 —— 与 CSS / canvas.js 保持一致（真实系统字体） */
const FONT_UI = '"Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif';
const FONT_NUM = '"Consolas", "Menlo", monospace';

/** 地块底色（浅色卡面 —— 与深色金融城背景形成图地分离） */
const FACE_BG = '#e8ddc4';
const INK = '#151a26';
const PAPER = '#f6efe0';
const DIM = '#4a5266';

/** 圆角矩形路径 */
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
 * 顶面短读数 —— 把「￥1,200」压成能在 25px 下读出来的形式。
 *
 * @param {string} v 原始读数
 * @returns {string} 短读数
 */
export function shortValue(v) {
  const s = String(v || '');
  // 「￥1,200」→ 「1.2k」；「￥800」→ 「800」
  const m = s.match(/([\d,]+)/);
  if (!m) return s;
  const n = Number(m[1].replace(/,/g, ''));
  if (!Number.isFinite(n)) return s;
  if (n >= 1000) {
    const k = n / 1000;
    const t = (k >= 10 ? k.toFixed(0) : k.toFixed(1)).replace(/\.0$/, '');
    return `${t}k`;
  }
  return String(n);
}

/**
 * 地块纹理绘制器 —— 负责每格纹理的生成与脏检查。
 */
export class TileTexturePainter {
  constructor() {
    /** index → { canvas, ctx, texture, stateKey } */
    this.slots = new Map();
    /** 统计：本轮实际重绘的纹理数（供自检断言） */
    this.redrawCount = 0;
    /** 统计：纹理总数 */
    this.textureCount = 0;
  }

  /**
   * 为某一格取得纹理（必要时重绘）。
   *
   * @param {number} index 格子索引
   * @param {object} cell   core/board.js 的格子定义
   * @param {object} state  游戏状态
   * @param {THREE} THREE  three.js 命名空间（由调用方注入，避免硬依赖）
   * @returns {THREE.CanvasTexture}
   */
  acquire(index, cell, state, THREE) {
    const st = tileState(state, index);
    const face = tileFace(cell, st);
    const key = this.stateKeyOf(face, st);

    let slot = this.slots.get(index);
    if (!slot) {
      const canvas = document.createElement('canvas');
      canvas.width = TEX_W;
      canvas.height = TEX_H;
      const ctx = canvas.getContext('2d');
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = 4;
      texture.needsUpdate = true;
      slot = { canvas, ctx, texture, stateKey: null };
      this.slots.set(index, slot);
      this.textureCount++;
    }

    if (slot.stateKey !== key) {
      slot.stateKey = key;
      this.paint(slot.ctx, face);
      slot.texture.needsUpdate = true;
      this.redrawCount++;
    }
    return slot.texture;
  }

  /** 全部纹理（供自检断言数量） */
  get textures() {
    return [...this.slots.values()].map((s) => s.texture);
  }

  /** 重置统计 */
  resetCount() {
    this.redrawCount = 0;
  }

  /**
   * 卡面状态指纹 —— 只有它变了才重绘。
   *
   * 顶面纹理只画精简信息，因此指纹也只含**顶面用到**的字段 ——
   * 次读数变化（比如买入价变化）不该触发顶面重绘，
   * 但**必须**触发名牌重绘（名牌承载完整读数）。
   */
  stateKeyOf(face, st) {
    return [
      face.kind,
      face.held ? face.owner.main : '-',
      face.accent,
      face.mainValue, face.mainLabel,
      face.segments ? face.segments.map((s) => (s.solid ? '1' : s.pending ? 'd' : '0')).join('') : '',
      face.footLabel,
      face.effectBig || '',
      face.trap ? 1 : 0,
      face.mortgaged ? 1 : 0,
      face.affordable ? 1 : 0,
    ].join('~');
  }

  /* ===========================================================
   * 绘制一张顶面
   * =========================================================== */
  paint(ctx, face) {
    const W = TEX_W;
    const H = TEX_H;

    ctx.clearRect(0, 0, W, H);
    ctx.textBaseline = 'middle';

    // ---- 底板 ----
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#f2e9d4');
    bg.addColorStop(1, FACE_BG);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // ---- 顶部归属色带 ----
    ctx.fillStyle = face.accent;
    ctx.fillRect(0, 0, W, 26);

    // ---- 归属短标签（≤4 字，25px 下仍能辨）----
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold 22px ${FONT_UI}`;
    const tag = face.held
      ? (face.ownerName || face.owner.name)
      : (face.kind === 'regulator' ? '监管'
        : face.kind === 'wheel' ? '转盘'
          : face.kind === 'casino' ? '赌场'
            : (face.groupLabel || ''));
    ctx.fillText(String(tag).slice(0, 4), W / 2, 14);

    // ---- 等级刻度（五段粗条）----
    let y = 40;
    if (face.segments && face.segments.length) {
      const segW = (W - 24) / face.segments.length;
      face.segments.forEach((s, i) => {
        const x = 12 + i * segW;
        if (s.solid) {
          ctx.fillStyle = s.color;
          ctx.fillRect(x + 2, y, segW - 5, 12);
        } else if (s.pending) {
          ctx.fillStyle = s.color + '66';
          ctx.fillRect(x + 2, y, segW - 5, 12);
          ctx.strokeStyle = s.color;
          ctx.lineWidth = 2;
          ctx.strokeRect(x + 3, y + 1, segW - 7, 10);
        } else {
          ctx.fillStyle = 'rgba(21,26,38,.16)';
          ctx.fillRect(x + 2, y, segW - 5, 12);
        }
      });
      y += 26;
    }

    // ---- 主读数（大号短值）----
    ctx.textAlign = 'center';
    ctx.fillStyle = face.held ? face.accent : INK;
    ctx.font = `bold 56px ${FONT_NUM}`;
    ctx.fillText(shortValue(face.mainValue), W / 2, y + 34);

    // ---- 监管 / 特殊格：效果短值 ----
    if (face.effectBig && face.kind !== 'institution') {
      ctx.fillStyle = face.effectColor;
      ctx.font = `bold 34px ${FONT_UI}`;
      ctx.fillText(String(face.effectBig).slice(0, 6), W / 2, y + 78);
    }

    // ---- 特殊格分类标（中文 1~2 字，30px 下可辨）----
    if (face.kind === 'special' || face.kind === 'wheel' || face.kind === 'casino') {
      ctx.fillStyle = 'rgba(21,26,38,.72)';
      ctx.font = `bold 30px ${FONT_UI}`;
      ctx.fillText(String(face.groupLabel || '').slice(0, 2), W / 2, y + 78);
    }

    // ---- 「可收购」角标 ----
    if (face.affordable) {
      ctx.fillStyle = '#4f9d55';
      ctx.beginPath();
      ctx.moveTo(W - 58, 0);
      ctx.lineTo(W, 0);
      ctx.lineTo(W, 58);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.font = `bold 20px ${FONT_UI}`;
      ctx.textAlign = 'center';
      ctx.save();
      ctx.translate(W - 38, 26);
      ctx.rotate(Math.PI / 4);
      ctx.fillText('可收', 0, 0);
      ctx.restore();
    }

    // ---- 陷阱角标 ----
    if (face.trap) {
      ctx.fillStyle = '#c8392b';
      roundRect(ctx, 10, H - 40, 62, 32, 6);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.font = `bold 22px ${FONT_UI}`;
      ctx.textAlign = 'center';
      ctx.fillText('陷阱', 41, H - 23);
    }

    // ---- 质押标记（左下小方块）----
    if (face.mortgaged) {
      ctx.fillStyle = '#c8392b';
      ctx.fillRect(10, H - 40, 12, 32);
    }

    // ---- 边框 ----
    ctx.strokeStyle = 'rgba(21,26,38,.35)';
    ctx.lineWidth = 3;
    ctx.strokeRect(1.5, 1.5, W - 3, H - 3);
  }
}
