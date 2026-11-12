/**
 * 像素画工具 —— 所有素材以原生小尺寸绘制，整数倍放大。
 *
 * 规范：
 *   - 统一 1px 描边
 *   - 色阶 + 高光 + 阴影 三层表现体积，禁止渐变
 *   - 硬边缘、无羽化
 */

import { PALETTE } from '../core/palette.js';

/** 创建离屏像素画布（原生尺寸） */
export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  return c;
}

/** 取色（支持 'C.ink' 路径） */
export function col(path) {
  if (!path) return 'transparent';
  if (path[0] === '#') return path;
  if (path[0] === '.') return path.slice(1);
  const parts = path.split('.');
  let obj = PALETTE;
  for (const p of parts) obj = obj?.[p];
  return obj || 'transparent';
}

/** 矩形 */
export function rect(ctx, x, y, w, h, color) {
  ctx.fillStyle = col(color);
  ctx.fillRect(x, y, w, h);
}

/** 描边矩形（1px） */
export function strokeRect(ctx, x, y, w, h, color) {
  ctx.fillStyle = col(color);
  ctx.fillRect(x, y, w, 1);
  ctx.fillRect(x, y + h - 1, w, 1);
  ctx.fillRect(x, y, 1, h);
  ctx.fillRect(x + w - 1, y, 1, h);
}

/** 实心圆（像素风用方块拼，不用抗锯齿 arc） */
export function pixelCircle(ctx, cx, cy, r, color) {
  ctx.fillStyle = col(color);
  for (let y = -r; y <= r; y++) {
    const span = Math.floor(Math.sqrt(Math.max(0, r * r - y * y)));
    ctx.fillRect(cx - span, cy + y, span * 2 + 1, 1);
  }
}

/** 空心圆 */
export function pixelRing(ctx, cx, cy, r, color) {
  ctx.fillStyle = col(color);
  for (let y = -r; y <= r; y++) {
    const span = Math.floor(Math.sqrt(Math.max(0, r * r - y * y)));
    const w = span * 2 + 1;
    if (Math.abs(y) === r) ctx.fillRect(cx - span, cy + y, w, 1);
    else {
      ctx.fillRect(cx - span, cy + y, 1, 1);
      ctx.fillRect(cx + span, cy + y, 1, 1);
    }
  }
}

/** 水平线 */
export function hline(ctx, x, y, w, color) {
  ctx.fillStyle = col(color);
  ctx.fillRect(x, y, w, 1);
}

/** 垂直线 */
export function vline(ctx, x, y, h, color) {
  ctx.fillStyle = col(color);
  ctx.fillRect(x, y, 1, h);
}

/** 斜线（Bresenham，1px 硬边） */
export function line(ctx, x0, y0, x1, y1, color) {
  ctx.fillStyle = col(color);
  let x = x0, y = y0;
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    ctx.fillRect(x, y, 1, 1);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x += sx; }
    if (e2 <= dx) { err += dx; y += sy; }
  }
}

/** 三色斜面矩形 —— 色阶+高光+阴影 */
export function bevel(ctx, x, y, w, h, base, lt, dk) {
  rect(ctx, x, y, w, h, base);
  hline(ctx, x, y, w, lt);
  hline(ctx, x, y + h - 1, w, dk);
  vline(ctx, x, y, h, lt);
  vline(ctx, x + w - 1, y, h, dk);
}

/** 深色 1px 外描边 */
export function outline(ctx, x, y, w, h, color = 'ink') {
  ctx.fillStyle = col(color);
  ctx.fillRect(x - 1, y - 1, w + 2, 1);
  ctx.fillRect(x - 1, y + h, w + 2, 1);
  ctx.fillRect(x - 1, y, 1, h);
  ctx.fillRect(x + w, y, 1, h);
}

/** 地面棋盘格（大理石 / 沥青）—— 确定性伪随机 */
export function tileFloor(ctx, x, y, w, h, base, seed = 0) {
  rect(ctx, x, y, w, h, base);
  let s = seed * 9301 + 49297;
  const rnd = () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
  const count = Math.floor((w * h) / 40);
  for (let i = 0; i < count; i++) {
    const px = x + Math.floor(rnd() * w);
    const py = y + Math.floor(rnd() * h);
    const shade = rnd() > 0.6;
    ctx.fillStyle = col(shade ? 'paperDeep' : 'glassDeep');
    ctx.fillRect(px, py, 1, 1);
  }
}

/** 玻璃幕墙窗户阵列 */
export function windows(ctx, x, y, w, h, cols, rows, frame, glass, litChance, seed = 0) {
  let s = seed * 7919 + 13;
  const rnd = () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
  const cw = Math.floor(w / cols);
  const ch = Math.floor(h / rows);
  // 边框留白不能把玻璃吃掉：至少保留 1px 玻璃，且边框只在有 2px 以上高度时绘制
  const mx = Math.min(Math.max(0, Math.floor(cw * 0.22)), Math.max(0, cw - 1));
  const my = Math.min(Math.max(0, Math.floor(ch * 0.26)), Math.max(0, ch - 1));
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const wx = x + c * cw + mx;
      const wy = y + r * ch + my;
      const ww = Math.max(1, cw - mx * 2);
      const wh = Math.max(1, ch - my * 2);
      ctx.fillStyle = col(rnd() < litChance ? 'amberLt' : glass);
      ctx.fillRect(wx, wy, ww, wh);
      // 顶部压边：只在玻璃高度 ≥2px 时画，否则会把玻璃整行盖掉
      if (wh >= 2) {
        ctx.fillStyle = col(frame);
        ctx.fillRect(wx, wy, ww, 1);
      }
    }
  }
}

/** 绘制精灵到目标 canvas */
export function blit(destCtx, sprite, x, y, scale = 1, flip = false) {
  destCtx.imageSmoothingEnabled = false;
  destCtx.save();
  if (flip) {
    destCtx.translate(x + sprite.width * scale, y);
    destCtx.scale(-1, 1);
    destCtx.drawImage(sprite, 0, 0, sprite.width * scale, sprite.height * scale);
  } else {
    destCtx.drawImage(sprite, x, y, sprite.width * scale, sprite.height * scale);
  }
  destCtx.restore();
}

/** sprite → dataURL */
export function spriteToDataUrl(sprite) {
  return sprite.toDataURL('image/png');
}
