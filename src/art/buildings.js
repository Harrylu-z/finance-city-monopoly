/**
 * 机构建筑立绘 —— **现代扁平风**（纯色块 + 干净几何 + 轻阴影）。
 *
 * ================== 与像素版的差异 ==================
 *   · 轮廓：圆角矩形 / 圆角基座（取代 1px 硬描边 + 阶梯角）
 *   · 体积：单侧柔和明暗面（取代三层色阶描边）
 *   · 窗格：圆角小块 + 半透明（取代 1×1 像素点阵）
 *   · 招牌：圆角牌 + 真实字体
 *   · 地标：双塔 + 连桥 + 圆盘徽标
 *   · 监管机构：穹顶 + 独立徽章（钱币 / 盾 / 齿章 / 天平）
 *
 * 规格保持不变：基础 16×32，地标 32×48，监管 18×30，
 * 以免影响 `src/core/selftest.js` 里对尺寸与差异度的断言。
 */

import { GROUP_COLORS } from '../core/palette.js';

/** 等级的视觉高度（像素）—— 网点 → 地标 明显递增 */
const LEVEL_HEIGHT = [12, 16, 21, 26, 32];
const LEVEL_WIDTH = [14, 14, 15, 15, 16];

/** 统一的墨色（描边 / 阴影） */
const INK = '#151a26';

/**
 * 机构立绘变体参数 —— 让每家机构拥有独立的细节差异，
 * 避免出现「同一栋楼换个颜色」的观感。
 * 变体由 cell.index 派生的 seed 决定，保证同一机构每次绘制一致。
 */
function makeVariant(seed) {
  // 整数混淆（SplitMix64 变体）：确保相邻 index 得到完全不同的位序列
  let s = (seed + 0x9e3779b9) >>> 0;
  s = Math.imul(s ^ (s >>> 16), 0x21f0aaad) >>> 0;
  s = Math.imul(s ^ (s >>> 15), 0x735a2d97) >>> 0;
  s = (s ^ (s >>> 15)) >>> 0;
  const rnd = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pick = (arr) => arr[Math.floor(rnd() * arr.length) % arr.length];
  return {
    rnd,
    pick,
    winCols: pick([2, 3, 3, 4]),
    bandStep: pick([3, 3, 4]),
    roof: pick(['flat', 'step', 'setback', 'spire']),
    annex: pick(['none', 'awning', 'wing', 'mast', 'vents']),
    sign: pick(['band', 'plate', 'box']),
    facade: pick(['none', 'groove', 'belt', 'grid']),
    lit: pick([0.18, 0.25, 0.32, 0.4]),
  };
}

/** 新建画布 */
function makeCanvas(w, h) {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  return cv;
}

/**
 * 生成一座建筑精灵
 */
export function buildBuilding(opts) {
  const {
    kind = 'branch', level = 0, group = 'bank',
    groupIndex = 0, seed = 0, landmark = false,
    regulatorId = null,
  } = opts;

  const gc = GROUP_COLORS[group] || GROUP_COLORS.bank;
  const lv = Math.max(0, Math.min(4, level));

  if (landmark || kind === 'landmark') {
    return buildLandmark(gc, lv, seed, groupIndex);
  }

  // 监管机构走独立立绘（紫金对称行政建筑 + 专属徽章顶冠）
  if (kind === 'regulator') {
    return buildRegulator({ regulatorId: regulatorId || 'pbc', seed });
  }

  const h = LEVEL_HEIGHT[lv] + 4;
  const w = LEVEL_WIDTH[lv];
  const cv = makeCanvas(w, h);
  const ctx = cv.getContext('2d');
  const v = makeVariant(seed);

  switch (kind) {
    case 'tower': drawTower(ctx, w, h, lv, gc, seed, v); break;
    case 'midrise': drawMidrise(ctx, w, h, lv, gc, seed, v); break;
    case 'modern': drawModern(ctx, w, h, lv, gc, seed, v); break;
    default: drawBranch(ctx, w, h, lv, gc, seed, v); break;
  }

  return cv;
}

/* 银行：矮而宽 —— 低层网点，石材立面，圆弧顶 */
function drawBranch(ctx, w, h, lv, gc, seed, v) {
  const bodyH = LEVEL_HEIGHT[lv];
  const top = h - 2 - bodyH;
  const bodyW = w - 2;
  const bx = 1;

  // 基座（圆角）
  rr(ctx, 0, h - 4, w, 2, 1);
  ctx.fillStyle = gc.dk;
  ctx.fill();
  ctx.fillStyle = gc.lt;
  ctx.fillRect(0, h - 4, w, 0.8);

  const face = lv >= 3 ? gc.base : gc.dk;

  // 主体：圆角矩形 + 单侧明暗面
  rr(ctx, bx, top, bodyW, bodyH, 1.5);
  ctx.fillStyle = face;
  ctx.fill();
  // 受光面（左侧）
  ctx.fillStyle = hexA(gc.lt, 0.45);
  ctx.fillRect(bx, top, Math.max(1, bodyW * 0.22), bodyH);
  // 背光面（右侧）
  ctx.fillStyle = hexA(gc.dk, 0.5);
  ctx.fillRect(bx + bodyW - Math.max(1, bodyW * 0.2), top, Math.max(1, bodyW * 0.2), bodyH);

  // 腰线
  ctx.fillStyle = hexA(gc.dk, 0.55);
  for (let y = top + 2; y < h - 4; y += v.bandStep) {
    ctx.fillRect(bx + 1, y, bodyW - 2, 0.8);
  }

  drawWindows(ctx, bx + 1, top + 3, bodyW - 2, bodyH - 8, v.winCols,
    Math.max(1, Math.floor((bodyH - 6) / 3)), gc.dk, '#cbd5e1', v.lit, seed);
  drawFacade(ctx, v.facade, bx + 1, top + 3, bodyW - 2, Math.max(1, bodyH - 8), gc);

  const cx = w / 2;

  // 屋顶造型：平顶 / 台阶 / 退台
  if (v.roof === 'step') {
    rr(ctx, cx - 3, top - 2, 6, 2, 0.8);
    ctx.fillStyle = gc.base;
    ctx.fill();
  } else if (v.roof === 'setback') {
    rr(ctx, bx + 2, top - 3, bodyW - 4, 3, 1);
    ctx.fillStyle = gc.base;
    ctx.fill();
  }

  // 圆弧顶（半圆）
  const arcW = Math.min(bodyW - 2, 10);
  const arcX = cx - arcW / 2;
  const arcH = lv >= 2 ? 4 : 3;
  ctx.fillStyle = gc.base;
  ctx.beginPath();
  ctx.moveTo(arcX, top);
  ctx.quadraticCurveTo(cx, top - arcH * 1.6, arcX + arcW, top);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = hexA(gc.lt, 0.6);
  ctx.beginPath();
  ctx.moveTo(arcX, top);
  ctx.quadraticCurveTo(cx, top - arcH * 1.6, arcX + arcW * 0.55, top);
  ctx.closePath();
  ctx.fill();

  // 招牌：圆角牌
  const sw = v.sign === 'plate' ? 5 : v.sign === 'box' ? 7 : 8;
  const sx = cx - sw / 2;
  const sy = top - arcH - 2.5;
  rr(ctx, sx, sy, sw, 2.2, 0.8);
  ctx.fillStyle = '#e8a93c';
  ctx.fill();
  ctx.fillStyle = hexA('#ffc861', 0.75);
  ctx.fillRect(sx + 0.6, sy + 0.3, sw - 1.2, 0.6);

  drawAnnex(ctx, v.annex, w, h, top, bodyW, bx, gc);

  // 门
  rr(ctx, cx - 1.5, h - 6, 3, 4, 0.8);
  ctx.fillStyle = INK;
  ctx.fill();
  ctx.fillStyle = '#e8a93c';
  ctx.fillRect(cx - 1.5, h - 6, 3, 0.7);

  drawEmblem(ctx, seed, bx + 1, h - 6, '#ffc861');
}

/**
 * 立绘指纹 —— 在建筑立面上烙一枚 3×3 的专属徽记。
 * 由 seed 派生的 9 个二进制位决定明暗，保证任何两家机构的
 * 立绘都不会完全一致（即使体量与配色相近）。
 */
function drawEmblem(ctx, seed, x, y, color) {
  let s = (seed * 0x9e3779b1) >>> 0;
  s = Math.imul(s ^ (s >>> 16), 0x21f0aaad) >>> 0;
  s = Math.imul(s ^ (s >>> 15), 0x735a2d97) >>> 0;
  s = (s ^ (s >>> 15)) >>> 0;
  const on = color;
  const off = hexA(INK, 0.55);
  for (let i = 0; i < 9; i++) {
    const bit = (s >> i) & 1;
    ctx.fillStyle = bit ? on : off;
    ctx.fillRect(x + (i % 3), y + Math.floor(i / 3), 1, 1);
  }
}

/** 立面纹理 —— 竖向凹槽 / 横向腰线 / 网格桁架 */
function drawFacade(ctx, facade, x, y, w, h, gc) {
  if (!facade || facade === 'none' || w <= 1 || h <= 1) return;
  ctx.fillStyle = hexA(gc.dk, 0.35);
  switch (facade) {
    case 'groove':
      for (let gx = x + 1; gx < x + w; gx += 3) ctx.fillRect(gx, y, 0.8, h);
      break;
    case 'belt':
      for (let gy = y + 2; gy < y + h; gy += 4) ctx.fillRect(x, gy, w, 0.8);
      break;
    case 'grid':
      for (let gx = x + 1; gx < x + w; gx += 3) ctx.fillRect(gx, y, 0.8, h);
      for (let gy = y + 1; gy < y + h; gy += 3) ctx.fillRect(x, gy, w, 0.8);
      break;
    default:
      break;
  }
}

/** 附属构件 —— 让同类机构之间也有细节差异 */
function drawAnnex(ctx, annex, w, h, top, bodyW, bx, gc) {
  switch (annex) {
    case 'awning':
      rr(ctx, bx, h - 8, bodyW, 1.2, 0.5);
      ctx.fillStyle = '#b4791a';
      ctx.fill();
      break;
    case 'wing': {
      const ww = 3;
      rr(ctx, bx + bodyW, h - 9, ww, 7, 1);
      ctx.fillStyle = gc.dk;
      ctx.fill();
      drawWindows(ctx, bx + bodyW + 0.6, h - 8, ww - 1.2, 3, 1, 2, gc.dk, '#cbd5e1', 0.3, 5);
      break;
    }
    case 'mast':
      ctx.fillStyle = INK;
      ctx.fillRect(w - 2.5, top - 5, 1, 5);
      ctx.fillStyle = '#e4604d';
      ctx.beginPath();
      ctx.arc(w - 2, top - 6, 0.9, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'vents':
      ctx.fillStyle = hexA('#cbd5e1', 0.7);
      ctx.fillRect(bx + 1, h - 7, 2, 2);
      ctx.fillRect(bx + 4, h - 7, 2, 2);
      break;
    default:
      break;
  }
}

/* 券商：高而尖 —— 玻璃幕墙塔楼 + 顶部天线/徽标 */
function drawTower(ctx, w, h, lv, gc, seed, v) {
  const bodyH = LEVEL_HEIGHT[lv] + 4;
  const top = h - 2 - bodyH;
  const bodyW = Math.min(w - 4, 10);
  const bx = Math.floor((w - bodyW) / 2);

  // 塔身
  rr(ctx, bx, top, bodyW, bodyH, 1.2);
  ctx.fillStyle = '#334155';
  ctx.fill();
  // 玻璃幕墙列
  const cols = v.winCols;
  const colW = (bodyW - 2) / cols;
  for (let c = 0; c < cols; c++) {
    ctx.fillStyle = '#94a3b8';
    ctx.fillRect(bx + 1 + c * colW, top + 1, colW - 0.6, bodyH - 2);
  }
  // 受光边
  ctx.fillStyle = hexA('#e2e8f0', 0.4);
  ctx.fillRect(bx + 1, top + 1, 0.8, bodyH - 2);
  // 背光边
  ctx.fillStyle = hexA(INK, 0.45);
  ctx.fillRect(bx + bodyW - 1.6, top + 1, 0.8, bodyH - 2);

  // 横向结构带
  ctx.fillStyle = hexA(INK, 0.32);
  for (let y = top + 2; y < h - 4; y += 2) ctx.fillRect(bx, y, bodyW, 0.7);

  if (lv >= 1) {
    ctx.fillStyle = hexA(gc.lt, 0.5);
    for (let y = top + 2; y < h - 6; y += 4) ctx.fillRect(bx, y, bodyW, 0.7);
  }

  drawWindows(ctx, bx + 1, top + 1, bodyW - 2, bodyH - 2, cols,
    Math.max(2, Math.floor(bodyH / 3)), INK, '#fbbf24', v.lit, seed);
  drawFacade(ctx, v.facade, bx + 1, top + 1, bodyW - 2, Math.max(1, bodyH - 2), gc);

  // 顶部檐口
  rr(ctx, bx - 1, top - 1.4, bodyW + 2, 1.4, 0.6);
  ctx.fillStyle = gc.base;
  ctx.fill();

  const cx = w / 2;
  if (lv >= 3) {
    // 顶部标志物：天线 / 徽标 / 双翼
    switch (v.roof) {
      case 'spire':
        ctx.fillStyle = '#cbd5e1';
        ctx.fillRect(cx - 0.4, top - 8, 0.8, 7);
        ctx.fillStyle = '#e8a93c';
        ctx.beginPath();
        ctx.arc(cx, top - 9, 1.1, 0, Math.PI * 2);
        ctx.fill();
        break;
      case 'setback':
        rr(ctx, cx - 4, top - 6, 8, 3, 0.8);
        ctx.fillStyle = gc.base;
        ctx.fill();
        ctx.fillStyle = '#cbd5e1';
        ctx.fillRect(cx - 0.4, top - 8, 0.8, 2);
        break;
      case 'step':
        rr(ctx, cx - 3, top - 5, 6, 2, 0.6);
        ctx.fillStyle = gc.base;
        ctx.fill();
        ctx.fillStyle = '#cbd5e1';
        ctx.fillRect(cx - 0.4, top - 8, 0.8, 3);
        ctx.fillStyle = '#e8a93c';
        ctx.beginPath();
        ctx.arc(cx, top - 9, 1, 0, Math.PI * 2);
        ctx.fill();
        break;
      default:
        ctx.fillStyle = '#cbd5e1';
        ctx.fillRect(cx - 0.4, top - 6, 0.8, 5);
        ctx.fillStyle = gc.lt;
        ctx.beginPath();
        ctx.arc(cx, top - 7, 1, 0, Math.PI * 2);
        ctx.fill();
        break;
    }
    // 招牌带
    if (v.sign === 'band') {
      rr(ctx, bx, top + bodyH - 6, bodyW, 2, 0.6);
      ctx.fillStyle = '#e8a93c';
      ctx.fill();
    } else if (v.sign === 'plate') {
      rr(ctx, cx - 2, top + bodyH - 7, 4, 3, 0.8);
      ctx.fillStyle = '#e8a93c';
      ctx.fill();
    } else {
      rr(ctx, cx - 3, top + bodyH - 8, 6, 4, 1);
      ctx.fillStyle = '#fbbf24';
      ctx.fill();
      ctx.strokeStyle = hexA(INK, 0.6);
      ctx.lineWidth = 0.7;
      ctx.stroke();
    }
  } else if (v.roof === 'spire') {
    ctx.fillStyle = gc.lt;
    ctx.fillRect(cx - 0.4, top - 6, 0.8, 5);
    ctx.fillStyle = '#e8a93c';
    ctx.fillRect(cx - 1.5, top - 7, 3, 1.2);
  } else {
    rr(ctx, cx - 2, top - 4, 5, 3, 0.8);
    ctx.fillStyle = gc.base;
    ctx.fill();
  }

  // 基座
  rr(ctx, bx - 1, h - 4, bodyW + 2, 2, 0.8);
  ctx.fillStyle = INK;
  ctx.fill();

  // 门
  rr(ctx, cx - 1.5, h - 7, 3, 3, 0.8);
  ctx.fillStyle = hexA(INK, 0.85);
  ctx.fill();
  ctx.fillStyle = gc.lt;
  ctx.fillRect(cx - 1.5, h - 7, 3, 0.7);

  drawEmblem(ctx, seed, bx + 1, h - 7, gc.lt);
  drawAnnex(ctx, v.annex, w, h, top, bodyW, bx, gc);
}

/* 保险：方正中层 + 穹顶顶冠 */
function drawMidrise(ctx, w, h, lv, gc, seed, v) {
  const bodyH = LEVEL_HEIGHT[lv];
  const top = h - 2 - bodyH;
  const bodyW = w - 2;
  const bx = 1;

  rr(ctx, 0, h - 4, w, 2, 1);
  ctx.fillStyle = gc.dk;
  ctx.fill();
  ctx.fillStyle = gc.lt;
  ctx.fillRect(0, h - 4, w, 0.8);

  // 主体
  rr(ctx, bx, top, bodyW, bodyH, 1.5);
  ctx.fillStyle = gc.dk;
  ctx.fill();
  ctx.fillStyle = hexA(gc.lt, 0.4);
  ctx.fillRect(bx, top, Math.max(1, bodyW * 0.22), bodyH);
  ctx.fillStyle = hexA(INK, 0.4);
  ctx.fillRect(bx + bodyW - Math.max(1, bodyW * 0.2), top, Math.max(1, bodyW * 0.2), bodyH);

  drawWindows(ctx, bx + 1, top + 2, bodyW - 2, bodyH - 8, v.winCols + 1,
    Math.max(1, Math.floor((bodyH - 7) / 3)), gc.dk, '#cbd5e1', v.lit, seed);
  drawFacade(ctx, v.facade, bx + 1, top + 2, bodyW - 2, Math.max(1, bodyH - 8), gc);

  // 竖向立柱
  ctx.fillStyle = hexA(gc.lt, 0.6);
  for (let c = 0; c <= v.winCols; c++) {
    const cx = bx + Math.floor((bodyW - 1) * c / v.winCols);
    ctx.fillRect(cx, top + 2, 0.8, bodyH - 6);
  }

  // 檐口
  rr(ctx, bx - 1, top - 1.4, bodyW + 2, 1.4, 0.6);
  ctx.fillStyle = gc.base;
  ctx.fill();

  const cx = w / 2;
  if (lv >= 2) {
    // 穹顶
    ctx.fillStyle = gc.base;
    ctx.beginPath();
    ctx.moveTo(cx - 4, top);
    ctx.quadraticCurveTo(cx, top - 6.5, cx + 4, top);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = hexA(gc.lt, 0.55);
    ctx.beginPath();
    ctx.moveTo(cx - 4, top);
    ctx.quadraticCurveTo(cx - 1.5, top - 4.6, cx, top - 4.6);
    ctx.lineTo(cx, top);
    ctx.closePath();
    ctx.fill();
    // 顶珠
    ctx.fillStyle = '#e8a93c';
    ctx.beginPath();
    ctx.arc(cx, top - 6.5, 1.1, 0, Math.PI * 2);
    ctx.fill();
  } else if (v.roof === 'step') {
    rr(ctx, cx - 3, top - 4, 6, 3, 0.8);
    ctx.fillStyle = gc.base;
    ctx.fill();
  } else {
    rr(ctx, cx - 2, top - 4, 5, 3, 0.8);
    ctx.fillStyle = gc.base;
    ctx.fill();
    ctx.fillStyle = gc.dk;
    ctx.fillRect(cx - 5, top - 3, 2, 2);
    ctx.fillRect(cx + 4, top - 3, 2, 2);
  }

  // 门廊
  rr(ctx, cx - 2.5, h - 7, 5, 3.5, 0.8);
  ctx.fillStyle = hexA(INK, 0.85);
  ctx.fill();
  ctx.fillStyle = gc.base;
  ctx.fillRect(cx - 2.5, h - 7, 5, 0.7);
  ctx.fillStyle = hexA(gc.lt, 0.6);
  ctx.fillRect(cx - 3.5, h - 7, 1, 3.5);
  ctx.fillRect(cx + 3, h - 7, 1, 3.5);

  drawEmblem(ctx, seed, bx + 1, h - 7, gc.lt);
  drawAnnex(ctx, v.annex, w, h, top, bodyW, bx, gc);
}

/* 资管：现代几何体量 —— 错落的体块 */
function drawModern(ctx, w, h, lv, gc, seed, v) {
  const bodyH = LEVEL_HEIGHT[lv];
  const top = h - 2 - bodyH;

  const mainW = w - 3;
  const sideW = Math.max(4, Math.floor(mainW * 0.45));
  const sideH = Math.max(6, bodyH - 4);
  const sx = w - sideW - 1;

  // 侧翼
  rr(ctx, sx, h - 2 - sideH, sideW, sideH, 1);
  ctx.fillStyle = gc.dk;
  ctx.fill();
  ctx.fillStyle = hexA(gc.lt, 0.35);
  ctx.fillRect(sx, h - 2 - sideH, 0.8, sideH);
  drawWindows(ctx, sx + 0.8, h - 1 - sideH, sideW - 1.6, sideH - 3, 2,
    Math.max(1, Math.floor(sideH / 3)), gc.dk, '#cbd5e1', v.lit, seed);

  // 主体
  const bx = 1;
  rr(ctx, bx, top, mainW, bodyH, 1.5);
  ctx.fillStyle = gc.base;
  ctx.fill();
  ctx.fillStyle = hexA(gc.lt, 0.4);
  ctx.fillRect(bx, top, Math.max(1, mainW * 0.22), bodyH);
  ctx.fillStyle = hexA(gc.dk, 0.45);
  ctx.fillRect(bx + mainW - Math.max(1, mainW * 0.2), top, Math.max(1, mainW * 0.2), bodyH);

  // 转角切口（现代几何感）
  const cut = lv >= 2 ? 3 : 2;
  ctx.fillStyle = hexA(INK, 0.35);
  for (let i = 0; i < cut; i++) {
    ctx.fillRect(bx + mainW - 1 - i, top + i, 1, 1);
    ctx.fillRect(bx + mainW - cut + i, top, 1, 1);
  }

  drawWindows(ctx, bx + 1, top + 2, mainW - 2, bodyH - 6, v.winCols,
    Math.max(1, Math.floor((bodyH - 5) / 3)), gc.dk, '#cbd5e1', v.lit, seed);
  drawFacade(ctx, v.facade, bx + 1, top + 2, mainW - 2, Math.max(1, bodyH - 6), gc);

  // 横向分隔带
  ctx.fillStyle = hexA(gc.lt, 0.5);
  for (let y = top + 4; y < h - 5; y += v.bandStep + 1) {
    ctx.fillRect(bx + 1, y, mainW - 2, 0.8);
  }

  const cx = w / 2;
  if (lv >= 3) {
    rr(ctx, bx + 2, top - 3, mainW - 4, 2, 0.6);
    ctx.fillStyle = gc.lt;
    ctx.fill();
    if (v.roof === 'spire') {
      ctx.fillStyle = gc.dk;
      ctx.fillRect(cx - 0.4, top - 8, 0.8, 5);
      ctx.fillStyle = '#e8a93c';
      ctx.fillRect(cx - 1.5, top - 9, 3, 1.2);
    } else if (v.roof === 'setback') {
      rr(ctx, bx + 4, top - 6, mainW - 8, 3, 0.8);
      ctx.fillStyle = gc.dk;
      ctx.fill();
    } else {
      ctx.fillStyle = gc.dk;
      ctx.fillRect(bx + 3, top - 6, 3, 3);
    }
  } else if (v.roof === 'setback') {
    rr(ctx, bx + 1, top - 3, mainW - 2, 3, 0.8);
    ctx.fillStyle = gc.dk;
    ctx.fill();
  } else {
    rr(ctx, cx - 3, top - 3, 6, 2, 0.6);
    ctx.fillStyle = gc.lt;
    ctx.fill();
  }

  // 门
  rr(ctx, cx - 1.5, h - 6, 3, 4, 0.8);
  ctx.fillStyle = hexA(INK, 0.85);
  ctx.fill();
  ctx.fillStyle = gc.lt;
  ctx.fillRect(cx - 1.5, h - 6, 3, 0.7);

  drawEmblem(ctx, seed, bx + 1, h - 6, gc.lt);
  drawAnnex(ctx, v.annex, w, h, top, mainW, bx, gc);
}

/* 地标：32×48 摩天金融中心 + 顶部标志物 */
function buildLandmark(gc, lv, seed, groupIndex) {
  const w = 32;
  const h = 48;
  const cv = makeCanvas(w, h);
  const ctx = cv.getContext('2d');
  const cx = 16;

  // 基座
  rr(ctx, 0, h - 3, w, 3, 1);
  ctx.fillStyle = INK;
  ctx.fill();

  const towerW = 14;
  const towerTop = 12;

  // 主塔：玻璃幕墙
  rr(ctx, cx - 7, towerTop, towerW, h - 3 - towerTop, 1.5);
  ctx.fillStyle = '#334155';
  ctx.fill();
  for (let c = 0; c < 4; c++) {
    ctx.fillStyle = '#94a3b8';
    ctx.fillRect(cx - 6 + c * 3, towerTop + 1, 2.4, h - 4 - towerTop);
  }
  ctx.fillStyle = hexA('#e2e8f0', 0.45);
  ctx.fillRect(cx - 6, towerTop + 1, 0.8, h - 4 - towerTop);
  ctx.fillStyle = hexA(INK, 0.5);
  ctx.fillRect(cx + 5.2, towerTop + 1, 0.8, h - 4 - towerTop);
  ctx.fillStyle = hexA(INK, 0.28);
  for (let y = towerTop + 2; y < h - 4; y += 2) ctx.fillRect(cx - 7, y, towerW, 0.7);
  drawWindows(ctx, cx - 6, towerTop + 1, 12, h - 5 - towerTop, 4, 11, INK, '#fbbf24', 0.28, seed);

  // 侧翼
  rr(ctx, 1, 24, 8, h - 27, 1);
  ctx.fillStyle = gc.dk;
  ctx.fill();
  ctx.fillStyle = hexA(gc.lt, 0.35);
  ctx.fillRect(1, 24, 0.8, h - 27);
  drawWindows(ctx, 2, 25, 6, h - 30, 2, 5, gc.dk, '#cbd5e1', 0.35, seed + 7);

  rr(ctx, 23, 30, 8, h - 33, 1);
  ctx.fillStyle = gc.dk;
  ctx.fill();
  ctx.fillStyle = hexA(gc.lt, 0.35);
  ctx.fillRect(23, 30, 0.8, h - 33);
  drawWindows(ctx, 24, 31, 6, h - 36, 2, 4, gc.dk, '#cbd5e1', 0.35, seed + 13);

  drawLandmarkCrown(ctx, cx, towerTop, gc, groupIndex);

  // 底部商业裙楼
  rr(ctx, 0, h - 9, w, 6, 1);
  ctx.fillStyle = gc.base;
  ctx.fill();
  ctx.fillStyle = hexA(gc.lt, 0.5);
  ctx.fillRect(0, h - 9, w, 0.8);
  ctx.fillStyle = hexA('#cbd5e1', 0.7);
  for (let x = 0; x < w; x += 4) ctx.fillRect(x + 1, h - 8, 2, 3);

  // 门
  rr(ctx, cx - 4, h - 12, 8, 3, 0.8);
  ctx.fillStyle = hexA(INK, 0.85);
  ctx.fill();
  ctx.fillStyle = '#e8a93c';
  ctx.fillRect(cx - 4, h - 12, 8, 0.7);

  // 招牌
  rr(ctx, cx - 6, h - 15, 12, 2.2, 0.7);
  ctx.fillStyle = '#e8a93c';
  ctx.fill();
  ctx.fillStyle = hexA('#ffc861', 0.8);
  ctx.fillRect(cx - 5.4, h - 14.6, 10.8, 0.6);

  drawEmblem(ctx, seed, 3, h - 8, '#ffc861');
  return cv;
}

/** 地标顶部标志物 —— 按集团区分轮廓 */
function drawLandmarkCrown(ctx, cx, towerTop, gc, groupIndex) {
  switch (groupIndex % 4) {
    case 0: { // 银行：金色钱币圆盘 + 尖顶
      ctx.fillStyle = '#cbd5e1';
      ctx.fillRect(cx - 0.4, towerTop - 8, 0.8, 8);
      ctx.fillStyle = '#e8a93c';
      ctx.beginPath();
      ctx.arc(cx, towerTop - 9, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#b4791a';
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      ctx.arc(cx, towerTop - 9, 2.1, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#ffc861';
      ctx.beginPath();
      ctx.arc(cx, towerTop - 9, 0.9, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 1: { // 券商：菱形徽标
      ctx.fillStyle = gc.lt;
      ctx.beginPath();
      ctx.moveTo(cx, towerTop - 7);
      ctx.lineTo(cx + 3, towerTop - 3);
      ctx.lineTo(cx, towerTop + 1);
      ctx.lineTo(cx - 3, towerTop - 3);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = INK;
      ctx.beginPath();
      ctx.moveTo(cx, towerTop - 4.6);
      ctx.lineTo(cx + 1.4, towerTop - 3);
      ctx.lineTo(cx, towerTop - 1.4);
      ctx.lineTo(cx - 1.4, towerTop - 3);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 2: { // 保险：盾形顶冠
      ctx.fillStyle = gc.lt;
      ctx.beginPath();
      ctx.moveTo(cx - 4, towerTop - 6);
      ctx.lineTo(cx + 4, towerTop - 6);
      ctx.lineTo(cx + 4, towerTop - 3);
      ctx.quadraticCurveTo(cx, towerTop + 1.5, cx - 4, towerTop - 3);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = hexA('#f8fafc', 0.8);
      ctx.fillRect(cx - 2, towerTop - 5, 4, 1.6);
      break;
    }
    default: { // 资管：双塔 + 连桥
      rr(ctx, cx - 6, towerTop - 7, 4, 7, 0.8);
      ctx.fillStyle = gc.lt;
      ctx.fill();
      rr(ctx, cx + 2, towerTop - 7, 4, 7, 0.8);
      ctx.fill();
      ctx.fillStyle = '#e8a93c';
      ctx.fillRect(cx - 2, towerTop - 5, 4, 1.2);
      break;
    }
  }
}

/* ===================================================================
 * 监管机构 —— 紫金配色的对称行政建筑 + 独立徽章顶冠
 * 与四大集团建筑在色彩（紫金）与轮廓（对称穹顶）上均明显不同。
 * =================================================================== */

/** 监管机构配色 —— 统一紫金，具体细节由 regulatorId 区分 */
const REGULATOR_PAL = {
  base: '#6f42a0', lt: '#c39ae8', dk: '#42265e', deep: '#2a1740',
  accent: '#e0a53f', accentLt: '#f5cf7a',
};

/**
 * 生成监管机构立绘。
 * 四家监管机构的顶冠徽章各不相同：
 *   pbc  —— 钱币/梅花（货币政策）
 *   csrc —— 盾形刻章（发行审核）
 *   nfra —— 齿状圆章（审慎监管）
 *   fsc  —— 天平（风险处置）
 */
export function buildRegulator(opts) {
  const { regulatorId = 'pbc', seed = 0 } = opts;
  const w = 18;
  const h = 30;
  const cv = makeCanvas(w, h);
  const ctx = cv.getContext('2d');
  const p = REGULATOR_PAL;

  // 基座台阶（三级，圆角）
  rr(ctx, 0, h - 2, w, 2, 0.8);
  ctx.fillStyle = INK;
  ctx.fill();
  rr(ctx, 1, h - 4, w - 2, 2, 0.8);
  ctx.fillStyle = p.dk;
  ctx.fill();
  ctx.fillStyle = hexA(p.lt, 0.55);
  ctx.fillRect(1, h - 4, w - 2, 0.6);
  rr(ctx, 2, h - 7, w - 4, 3, 1);
  ctx.fillStyle = p.base;
  ctx.fill();
  ctx.fillStyle = hexA(p.lt, 0.6);
  ctx.fillRect(2, h - 7, w - 4, 0.7);

  // 主体 —— 对称方塔
  const bodyW = w - 6;
  const bodyH = 15;
  const bx = 3;
  const by = h - 7 - bodyH;
  rr(ctx, bx, by, bodyW, bodyH, 1.2);
  ctx.fillStyle = p.base;
  ctx.fill();
  ctx.fillStyle = hexA(p.lt, 0.4);
  ctx.fillRect(bx, by, Math.max(1, bodyW * 0.24), bodyH);
  ctx.fillStyle = hexA(p.dk, 0.5);
  ctx.fillRect(bx + bodyW - Math.max(1, bodyW * 0.22), by, Math.max(1, bodyW * 0.22), bodyH);

  // 横向腰线
  ctx.fillStyle = hexA(p.dk, 0.55);
  ctx.fillRect(bx + 1, by + 5, bodyW - 2, 0.8);
  ctx.fillRect(bx + 1, by + 10, bodyW - 2, 0.8);

  // 立柱
  for (let i = 0; i < 3; i++) {
    const cx = bx + 2 + i * 4;
    ctx.fillStyle = hexA(p.lt, 0.65);
    ctx.fillRect(cx, by + 1, 1.6, bodyH - 2);
    ctx.fillStyle = hexA(p.base, 0.8);
    ctx.fillRect(cx, by + 1, 0.7, bodyH - 2);
  }

  // 穹顶（半圆）
  const domeTop = by - 6;
  ctx.fillStyle = p.lt;
  ctx.beginPath();
  ctx.moveTo(bx + 1, by);
  ctx.quadraticCurveTo(w / 2, domeTop - 1, bx + bodyW - 1, by);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = hexA(p.accent, 0.9);
  ctx.beginPath();
  ctx.ellipse(w / 2, by - 0.6, bodyW / 2 - 2, 1.4, 0, 0, Math.PI * 2);
  ctx.fill();

  // 顶冠徽章 —— 四家各不相同
  const cx = w / 2;
  switch (regulatorId) {
    case 'pbc': { // 梅花币章
      ctx.fillStyle = p.accent;
      ctx.beginPath();
      ctx.arc(cx, domeTop - 2.6, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = p.accentLt;
      ctx.fillRect(cx - 0.5, domeTop - 4.6, 1, 4);
      ctx.fillRect(cx - 3, domeTop - 3.1, 6, 1);
      ctx.fillStyle = p.dk;
      ctx.fillRect(cx - 1.2, domeTop - 3.4, 2.4, 2.4);
      break;
    }
    case 'csrc': { // 盾形刻章
      ctx.fillStyle = p.accent;
      ctx.beginPath();
      ctx.moveTo(cx - 3, domeTop - 5);
      ctx.lineTo(cx + 3, domeTop - 5);
      ctx.lineTo(cx + 3, domeTop - 2);
      ctx.quadraticCurveTo(cx, domeTop + 1.4, cx - 3, domeTop - 2);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = p.dk;
      ctx.fillRect(cx - 1.6, domeTop - 4.2, 3.2, 1.4);
      break;
    }
    case 'nfra': { // 齿状圆章
      ctx.fillStyle = p.accent;
      ctx.beginPath();
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        const r = i % 2 === 0 ? 4.4 : 3.2;
        const px = cx + Math.cos(a) * r;
        const py = domeTop - 2.6 + Math.sin(a) * r;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = p.dk;
      ctx.beginPath();
      ctx.arc(cx, domeTop - 2.6, 2, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    default: { // fsc —— 天平
      ctx.strokeStyle = p.accent;
      ctx.lineWidth = 1.1;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(cx, domeTop - 5);
      ctx.lineTo(cx, domeTop + 0.4);
      ctx.moveTo(cx - 4, domeTop - 3.6);
      ctx.lineTo(cx + 4, domeTop - 3.6);
      ctx.stroke();
      ctx.fillStyle = p.accentLt;
      ctx.beginPath();
      ctx.arc(cx - 4, domeTop - 2, 1.4, 0, Math.PI * 2);
      ctx.arc(cx + 4, domeTop - 2, 1.4, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
  }

  // 门廊
  rr(ctx, cx - 2, h - 12, 4, 5, 0.8);
  ctx.fillStyle = p.dk;
  ctx.fill();
  ctx.fillStyle = hexA(p.lt, 0.7);
  ctx.fillRect(cx - 2, h - 12, 4, 0.8);
  // 门前台阶
  ctx.fillStyle = p.accent;
  ctx.fillRect(cx - 3, h - 7, 6, 1);

  return cv;
}

/* 缓存 */
const cache = new Map();

export function getBuilding(opts) {
  const key = `${opts.kind}|${opts.level}|${opts.group}|${opts.groupIndex}|${opts.seed}|${opts.landmark ? 1 : 0}|${opts.regulatorId || ''}`;
  if (cache.has(key)) return cache.get(key);
  const cv = buildBuilding(opts);
  cache.set(key, cv);
  return cv;
}

/** 机构整体（含产权条）的精灵 */
export function getInstitutionSprite(cell, level, ownerColor, groupIndex) {
  const key = `inst|${cell.index}|${level}|${ownerColor}|${groupIndex}`;
  if (cache.has(key)) return cache.get(key);

  const seed = groupIndex * 31 + (cell.index || 0);

  let base;
  if (cell.regulator) {
    base = buildRegulator({ regulatorId: cell.regulatorId, seed });
  } else {
    base = getBuilding({
      kind: cell.kind, level, group: cell.group,
      groupIndex, seed, landmark: cell.landmark,
    });
  }
  const w = base.width;
  const h = base.height + 4;
  const cv = makeCanvas(w, h);
  const ctx = cv.getContext('2d');

  ctx.drawImage(base, 0, 0);

  if (ownerColor) {
    // 产权条：圆角 + 玩家色
    rr(ctx, 0, h - 4, w, 2, 0.8);
    ctx.fillStyle = ownerColor;
    ctx.fill();
    ctx.fillStyle = hexA('#ffffff', 0.55);
    ctx.fillRect(0, h - 4, w, 0.7);
    ctx.fillStyle = ownerColor;
    ctx.fillRect(0, h - 6, 1.4, 4);
    ctx.fillRect(w - 1.4, h - 6, 1.4, 4);
  }

  cache.set(key, cv);
  return cv;
}

/* ===========================================================
 * 通用绘制工具（现代扁平风）
 * =========================================================== */

/** 圆角矩形路径 */
function rr(ctx, x, y, w, h, r) {
  const rad = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.lineTo(x + w - rad, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rad);
  ctx.lineTo(x + w, y + h - rad);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
  ctx.lineTo(x + rad, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
  ctx.lineTo(x, y + rad);
  ctx.quadraticCurveTo(x, y, x + rad, y);
  ctx.closePath();
}

/** #rrggbb + alpha → rgba() */
function hexA(hex, a) {
  const h = String(hex).replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

/**
 * 窗格 —— 圆角小块 + 半透明点亮。
 * @param {number} lit 点亮概率
 */
function drawWindows(ctx, x, y, w, h, cols, rows, frame, litColor, lit, seed) {
  if (w <= 1 || h <= 1) return;
  let s = (seed * 2654435761) >>> 0;
  const rnd = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const cw = w / cols;
  const ch = h / rows;
  const ww = Math.max(0.8, cw * 0.52);
  const wh = Math.max(0.8, ch * 0.5);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const px = x + cw * (c + 0.5) - ww / 2;
      const py = y + ch * (r + 0.5) - wh / 2;
      if (px < x || py < y || px + ww > x + w + 0.4 || py + wh > y + h + 0.4) continue;
      const isLit = rnd() < lit;
      rr(ctx, px, py, ww, wh, Math.min(0.6, ww / 2));
      ctx.fillStyle = isLit ? litColor : hexA(frame, 0.55);
      ctx.fill();
    }
  }
}
