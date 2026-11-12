/**
 * 机构建筑像素立绘 —— 每家机构独立绘制，正面视角。
 *
 * 规格：
 *   - 原生尺寸 16×32（基础），地标级 32×48
 *   - 统一 1px 深色描边
 *   - 色阶 + 高光 + 阴影 三层体积
 *   - 不同类型形态必须一眼可辨：
 *       银行 branch   矮而宽，低层网点 + 圆弧顶
 *       券商 tower    高而尖，玻璃幕墙 + 天线
 *       保险 midrise  方正中层 + 穹顶顶冠
 *       资管 modern   现代几何体量（错落体块）
 *       地标 landmark 摩天金融中心 + 顶部标志物
 *   - 5 个等级在高度、层数、细节上明显递进
 */

import { GROUP_COLORS } from '../core/palette.js';
import {
  makeCanvas, rect, strokeRect, hline, vline, pixelCircle,
  pixelRing, outline, windows, col,
} from './pixeldraw.js';

/** 等级的视觉高度（像素）—— 网点 → 地标 明显递增 */
const LEVEL_HEIGHT = [12, 16, 21, 26, 32];
const LEVEL_WIDTH = [14, 14, 15, 15, 16];

/**
 * 机构立绘变体参数 —— 让每家机构拥有独立的像素细节，
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
    // 立面分格数：窗列 / 横向分隔带
    winCols: pick([2, 3, 3, 4]),
    bandStep: pick([3, 3, 4]),
    // 屋顶造型：平顶 / 台阶 / 退台 / 尖顶
    roof: pick(['flat', 'step', 'setback', 'spire']),
    // 附属构件：雨棚 / 侧翼 / 旗杆 / 空调机组
    annex: pick(['none', 'awning', 'wing', 'mast', 'vents']),
    // 招牌样式
    sign: pick(['band', 'plate', 'box']),
    // 立面纹理：竖向凹槽 / 横向腰线 / 网格桁架
    facade: pick(['none', 'groove', 'belt', 'grid']),
    // 窗户点亮密度
    lit: pick([0.18, 0.25, 0.32, 0.4]),
  };
}

/**
 * 生成一座建筑精灵
 */
export function buildBuilding(opts) {
  const {
    kind = 'branch', level = 0, group = 'bank',
    groupIndex = 0, seed = 0, landmark = false,
  } = opts;

  const gc = GROUP_COLORS[group] || GROUP_COLORS.bank;
  const lv = Math.max(0, Math.min(4, level));

  if (landmark || kind === 'landmark') {
    return buildLandmark(gc, lv, seed, groupIndex);
  }

  const h = LEVEL_HEIGHT[lv] + 4;
  const w = LEVEL_WIDTH[lv];
  const cv = makeCanvas(w, h);
  const ctx = cv.getContext('2d');
  const v = makeVariant(seed);

  rect(ctx, 0, h - 2, w, 2, 'ink');

  switch (kind) {
    case 'tower':   drawTower(ctx, w, h, lv, gc, seed, v); break;
    case 'midrise': drawMidrise(ctx, w, h, lv, gc, seed, v); break;
    case 'modern':  drawModern(ctx, w, h, lv, gc, seed, v); break;
    default:        drawBranch(ctx, w, h, lv, gc, seed, v); break;
  }

  return cv;
}

/* 银行：矮而宽 —— 低层网点，石材立面，台阶基座 + 圆弧顶 */
function drawBranch(ctx, w, h, lv, gc, seed, v) {
  const bodyH = LEVEL_HEIGHT[lv];
  const top = h - 2 - bodyH;
  const bodyW = w - 2;
  const bx = 1;

  rect(ctx, 0, h - 4, w, 2, gc.dk);
  hline(ctx, 0, h - 4, w, gc.lt);

  const face = lv >= 3 ? gc.base : gc.dk;
  rect(ctx, bx, top, bodyW, bodyH, face);
  vline(ctx, bx, top, bodyH, gc.lt);
  vline(ctx, bx + bodyW - 1, top, bodyH, 'ink');
  rect(ctx, bx + bodyW - 2, top, 1, bodyH, gc.dk);

  for (let y = top + 2; y < h - 4; y += v.bandStep) {
    hline(ctx, bx + 1, y, bodyW - 2, gc.dk);
  }

  const winRows = Math.max(1, Math.floor((bodyH - 6) / 3));
  windows(ctx, bx + 1, top + 3, bodyW - 2, bodyH - 8, v.winCols, winRows, gc.dk, 'glassDeep', v.lit, seed);
  drawFacade(ctx, v.facade, bx + 1, top + 3, bodyW - 2, Math.max(1, bodyH - 8), gc);

  const cx = Math.floor(w / 2);

  // 屋顶造型：平顶 / 台阶 / 退台 —— 同一集团内也能一眼分辨
  if (v.roof === 'step') {
    rect(ctx, cx - 3, top - 2, 6, 2, gc.base);
    hline(ctx, cx - 3, top - 2, 6, gc.lt);
  } else if (v.roof === 'setback') {
    rect(ctx, bx + 2, top - 3, bodyW - 4, 3, gc.base);
    hline(ctx, bx + 2, top - 3, bodyW - 4, gc.lt);
    vline(ctx, bx + bodyW - 3, top - 3, 3, 'ink');
  }

  const arcW = Math.min(bodyW - 2, 10);
  const arcX = cx - Math.floor(arcW / 2);
  const arcH = lv >= 2 ? 4 : 3;
  for (let i = 0; i < arcH; i++) {
    const inset = Math.floor(i * 0.6);
    rect(ctx, arcX + inset, top - arcH + i, arcWidth(arcW, inset), 1, i === 0 ? gc.lt : gc.base);
  }

  // 招牌样式：横牌 / 方牌 / 灯箱
  const sw = v.sign === 'plate' ? 5 : v.sign === 'box' ? 7 : 8;
  const sx = cx - Math.floor(sw / 2);
  const sy = top - arcH - 2;
  rect(ctx, sx, sy, sw, 2, 'gold');
  if (v.sign === 'box') {
    vline(ctx, sx, sy, 2, 'goldLt');
    vline(ctx, sx + sw - 1, sy, 2, 'goldDk');
  } else {
    hline(ctx, sx, sy, sw, 'goldLt');
    hline(ctx, sx, sy + 1, sw, 'goldDk');
  }

  // 附属构件：雨棚 / 侧翼 / 旗杆 / 空调机组
  drawAnnex(ctx, v.annex, w, h, top, bodyW, bx, gc);

  const dw = 3;
  rect(ctx, cx - 1, h - 6, dw, 4, 'inkDeep');
  rect(ctx, cx - 1, h - 6, dw, 1, 'gold');

  drawEmblem(ctx, seed, bx + 1, h - 6, 'goldLt');

  outline(ctx, 0, h - 4, w, 2, 'ink');
}

/**
 * 立绘指纹 —— 在建筑立面上烙一枚 3×3 的专属像素徽记。
 * 由 seed 派生的 9 个二进制位决定明暗，保证任何两家机构的
 * 像素图都不会完全一致（即使体量与配色相近）。
 */
function drawEmblem(ctx, seed, x, y, color) {
  let s = (seed * 0x9e3779b1) >>> 0;
  s = Math.imul(s ^ (s >>> 16), 0x21f0aaad) >>> 0;
  s = Math.imul(s ^ (s >>> 15), 0x735a2d97) >>> 0;
  s = (s ^ (s >>> 15)) >>> 0;
  // 注意：必须用 col() 解析调色板名称，fillStyle 不接受 'goldLt' 这种裸名字
  const on = col(color);
  const off = col('ink');
  for (let i = 0; i < 9; i++) {
    const bit = (s >> i) & 1;
    const px = x + (i % 3);
    const py = y + Math.floor(i / 3);
    ctx.fillStyle = bit ? on : off;
    ctx.fillRect(px, py, 1, 1);
  }
}

/** 立面纹理 —— 竖向凹槽 / 横向腰线 / 网格桁架 */
function drawFacade(ctx, facade, x, y, w, h, gc) {
  if (!facade || facade === 'none' || w <= 1 || h <= 1) return;
  switch (facade) {
    case 'groove':
      for (let gx = x + 1; gx < x + w; gx += 3) vline(ctx, gx, y, h, gc.dk);
      break;
    case 'belt':
      for (let gy = y + 2; gy < y + h; gy += 4) hline(ctx, x, gy, w, gc.dk);
      break;
    case 'grid':
      for (let gx = x + 1; gx < x + w; gx += 3) vline(ctx, gx, y, h, gc.dk);
      for (let gy = y + 1; gy < y + h; gy += 3) hline(ctx, x, gy, w, gc.dk);
      break;
    default:
      break;
  }
}

/** 附属构件 —— 让同类机构之间也有细节差异 */
function drawAnnex(ctx, annex, w, h, top, bodyW, bx, gc) {
  switch (annex) {
    case 'awning':
      rect(ctx, bx, h - 8, bodyW, 1, 'goldDk');
      hline(ctx, bx, h - 8, bodyW, 'gold');
      break;
    case 'wing': {
      const ww = 3;
      rect(ctx, bx + bodyW, h - 9, ww, 7, gc.dk);
      vline(ctx, bx + bodyW, h - 9, 7, gc.lt);
      windows(ctx, bx + bodyW + 1, h - 8, ww - 2, 3, 1, 2, gc.dk, 'glass', 0.3, 5);
      break;
    }
    case 'mast':
      vline(ctx, w - 2, top - 5, 5, 'ink');
      rect(ctx, w - 3, top - 6, 1, 1, 'red');
      break;
    case 'vents':
      rect(ctx, bx + 1, h - 7, 2, 2, 'glassDeep');
      rect(ctx, bx + 4, h - 7, 2, 2, 'glassDeep');
      break;
    default:
      break;
  }
}

function arcWidth(arcW, inset) {
  return Math.max(1, arcW - inset * 2);
}

/* 券商：高而尖 —— 玻璃幕墙塔楼 + 顶部天线/徽标 */
function drawTower(ctx, w, h, lv, gc, seed, v) {
  const bodyH = LEVEL_HEIGHT[lv] + 4;
  const top = h - 2 - bodyH;
  const bodyW = Math.min(w - 4, 10);
  const bx = Math.floor((w - bodyW) / 2);

  rect(ctx, bx, top, bodyW, bodyH, 'glassDeep');
  const cols = v.winCols;
  const colW = Math.floor((bodyW - 2) / cols);
  for (let c = 0; c < cols; c++) {
    rect(ctx, bx + 1 + c * colW, top + 1, colW - 1, bodyH - 2, 'glass');
  }
  rect(ctx, bx + 1, top + 1, 1, bodyH - 2, 'glassLt');
  rect(ctx, bx + bodyW - 3, top + 1, 1, bodyH - 2, 'ink');

  for (let y = top + 2; y < h - 4; y += 2) {
    hline(ctx, bx, y, bodyW, 'ink');
  }

  if (lv >= 1) {
    for (let y = top + 2; y < h - 6; y += 4) {
      rect(ctx, bx, y, bodyW, 1, gc.lt);
    }
  }
  windows(ctx, bx + 1, top + 1, bodyW - 2, bodyH - 2, cols, Math.max(2, Math.floor(bodyH / 3)), 'ink', 'amber', v.lit, seed);
  drawFacade(ctx, v.facade, bx + 1, top + 1, bodyW - 2, Math.max(1, bodyH - 2), gc);

  rect(ctx, bx - 1, top - 1, bodyW + 2, 1, gc.base);

  const cx = Math.floor(w / 2);
  if (lv >= 3) {
    // 顶部标志物：天线 / 徽标 / 双翼 / 旗杆 —— 同一集团高塔也能区分
    switch (v.roof) {
      case 'spire':
        vline(ctx, cx, top - 8, 7, 'glassLt');
        pixelCircle(ctx, cx, top - 9, 1, 'gold');
        break;
      case 'setback':
        rect(ctx, cx - 4, top - 6, 8, 3, gc.base);
        strokeRect(ctx, cx - 4, top - 6, 8, 3, 'ink');
        hline(ctx, cx - 3, top - 5, 6, gc.lt);
        vline(ctx, cx, top - 8, 2, 'glassLt');
        break;
      case 'step':
        rect(ctx, cx - 3, top - 5, 6, 2, gc.base);
        hline(ctx, cx - 3, top - 5, 6, gc.lt);
        vline(ctx, cx, top - 8, 3, 'glassLt');
        pixelCircle(ctx, cx, top - 9, 1, 'gold');
        break;
      default:
        vline(ctx, cx, top - 6, 5, 'glassLt');
        pixelCircle(ctx, cx, top - 7, 1, gc.lt);
        vline(ctx, cx - 4, top - 4, 3, 'glassDk');
        vline(ctx, cx + 4, top - 4, 3, 'glassDk');
        break;
    }
    // 塔楼招牌带：横牌 / 方牌 / 灯箱
    if (v.sign === 'band') {
      rect(ctx, bx, top + bodyH - 6, bodyW, 2, 'gold');
      hline(ctx, bx, top + bodyH - 6, bodyW, 'goldLt');
    } else if (v.sign === 'plate') {
      rect(ctx, cx - 2, top + bodyH - 7, 4, 3, 'gold');
      hline(ctx, cx - 2, top + bodyH - 7, 4, 'goldLt');
    } else {
      rect(ctx, cx - 3, top + bodyH - 8, 6, 4, 'amber');
      strokeRect(ctx, cx - 3, top + bodyH - 8, 6, 4, 'ink');
    }
  } else if (v.roof === 'spire') {
    vline(ctx, cx, top - 6, 5, gc.lt);
    rect(ctx, cx - 1, top - 7, 3, 1, 'gold');
  } else {
    rect(ctx, cx - 2, top - 4, 5, 3, gc.base);
    strokeRect(ctx, cx - 2, top - 4, 5, 3, 'ink');
    hline(ctx, cx - 1, top - 3, 3, gc.lt);
  }

  rect(ctx, bx - 1, h - 4, bodyW + 2, 2, 'ink');
  hline(ctx, bx - 1, h - 4, bodyW + 2, 'glassDk');

  rect(ctx, cx - 1, h - 7, 3, 3, 'inkDeep');
  rect(ctx, cx - 1, h - 7, 3, 1, gc.lt);

  drawEmblem(ctx, seed, bx + 1, h - 7, gc.lt);

  drawAnnex(ctx, v.annex, w, h, top, bodyW, bx, gc);

  outline(ctx, bx - 1, h - 4, bodyW + 2, 2, 'ink');
}

/* 保险：方正中层 + 穹顶顶冠 */
function drawMidrise(ctx, w, h, lv, gc, seed, v) {
  const bodyH = LEVEL_HEIGHT[lv];
  const top = h - 2 - bodyH;
  const bodyW = w - 2;
  const bx = 1;

  rect(ctx, 0, h - 4, w, 2, gc.dk);
  hline(ctx, 0, h - 4, w, gc.lt);

  rect(ctx, bx, top, bodyW, bodyH, gc.dk);
  vline(ctx, bx, top, bodyH, gc.lt);
  vline(ctx, bx + bodyW - 1, top, bodyH, 'ink');

  const winRows = Math.max(1, Math.floor((bodyH - 7) / 3));
  windows(ctx, bx + 1, top + 2, bodyW - 2, bodyH - 8, v.winCols + 1, winRows, gc.dk, 'glass', v.lit, seed);
  drawFacade(ctx, v.facade, bx + 1, top + 2, bodyW - 2, Math.max(1, bodyH - 8), gc);

  for (let c = 0; c <= v.winCols; c++) {
    const cx = bx + Math.floor((bodyW - 1) * c / v.winCols);
    vline(ctx, cx, top + 2, bodyH - 6, gc.lt);
  }

  rect(ctx, bx - 1, top - 1, bodyW + 2, 1, gc.base);
  hline(ctx, bx - 1, top - 1, bodyW + 2, gc.lt);

  const cx = Math.floor(w / 2);
  if (lv >= 2) {
    const dw = 8;
    const dx = cx - Math.floor(dw / 2);
    for (let i = 0; i < 4; i++) {
      rect(ctx, dx + i, top - 4 + i, dw - i * 2, 1, i === 0 ? gc.lt : gc.base);
    }
    vline(ctx, cx, top - 6, 2, gc.lt);
    pixelCircle(ctx, cx, top - 7, 1, 'gold');
    hline(ctx, dx + 1, top - 2, dw - 2, gc.dk);
  } else if (v.roof === 'step') {
    rect(ctx, cx - 3, top - 4, 6, 3, gc.base);
    strokeRect(ctx, cx - 3, top - 4, 6, 3, 'ink');
    hline(ctx, cx - 2, top - 3, 4, gc.lt);
  } else {
    rect(ctx, cx - 2, top - 4, 5, 3, gc.base);
    strokeRect(ctx, cx - 2, top - 4, 5, 3, 'ink');
    hline(ctx, cx - 1, top - 3, 3, gc.lt);
    rect(ctx, cx - 5, top - 3, 2, 2, gc.dk);
    rect(ctx, cx + 4, top - 3, 2, 2, gc.dk);
  }

  rect(ctx, cx - 2, h - 7, 5, 3, 'inkDeep');
  rect(ctx, cx - 2, h - 7, 5, 1, gc.base);
  rect(ctx, cx - 3, h - 7, 1, 3, gc.lt);
  rect(ctx, cx + 3, h - 7, 1, 3, gc.lt);

  drawEmblem(ctx, seed, bx + 1, h - 7, gc.lt);

  drawAnnex(ctx, v.annex, w, h, top, bodyW, bx, gc);

  outline(ctx, 0, h - 4, w, 2, 'ink');
}

/* 资管：现代几何体量 —— 错落的体块 */
function drawModern(ctx, w, h, lv, gc, seed, v) {
  const bodyH = LEVEL_HEIGHT[lv];
  const top = h - 2 - bodyH;

  const mainW = w - 3;
  const sideW = Math.max(4, Math.floor(mainW * 0.45));
  const sideH = Math.max(6, bodyH - 4);

  const sx = w - sideW - 1;
  rect(ctx, sx, h - 2 - sideH, sideW, sideH, gc.dk);
  vline(ctx, sx, h - 2 - sideH, sideH, gc.lt);
  windows(ctx, sx + 1, h - 1 - sideH, sideW - 2, sideH - 3, 2, Math.max(1, Math.floor(sideH / 3)), gc.dk, 'glassDeep', v.lit, seed);

  const bx = 1;
  rect(ctx, bx, top, mainW, bodyH, gc.base);
  vline(ctx, bx, top, bodyH, gc.lt);
  vline(ctx, bx + mainW - 1, top, bodyH, 'ink');
  rect(ctx, bx + mainW - 2, top, 1, bodyH, gc.dk);

  const cut = lv >= 2 ? 3 : 2;
  for (let i = 0; i < cut; i++) {
    rect(ctx, bx + mainW - 1 - i, top + i, 1, 1, 'ink');
    rect(ctx, bx + mainW - cut + i, top, 1, 1, 'ink');
  }

  const winRows = Math.max(1, Math.floor((bodyH - 5) / 3));
  windows(ctx, bx + 1, top + 2, mainW - 2, bodyH - 6, v.winCols, winRows, gc.dk, 'glass', v.lit, seed);
  drawFacade(ctx, v.facade, bx + 1, top + 2, mainW - 2, Math.max(1, bodyH - 6), gc);

  for (let y = top + 4; y < h - 5; y += v.bandStep + 1) {
    rect(ctx, bx + 1, y, mainW - 2, 1, gc.lt);
  }

  const cx = Math.floor(w / 2);
  if (lv >= 3) {
    // 高层总部：横梁招牌 + 屋顶设备 —— 按变体区分不同交易所
    rect(ctx, bx + 2, top - 3, mainW - 4, 2, gc.lt);
    hline(ctx, bx + 2, top - 3, mainW - 4, v.sign === 'box' ? 'amberLt' : 'paper');
    if (v.roof === 'spire') {
      vline(ctx, cx, top - 8, 5, gc.dk);
      rect(ctx, cx - 1, top - 9, 3, 1, 'gold');
    } else if (v.roof === 'setback') {
      rect(ctx, bx + 4, top - 6, mainW - 8, 3, gc.dk);
      hline(ctx, bx + 4, top - 6, mainW - 8, gc.lt);
    } else {
      vline(ctx, bx + 3, top - 6, 3, gc.dk);
      rect(ctx, bx + 3, top - 7, mainW - 6, 1, gc.base);
    }
  } else if (v.roof === 'setback') {
    rect(ctx, bx + 1, top - 3, mainW - 2, 3, gc.dk);
    hline(ctx, bx + 1, top - 3, mainW - 2, gc.lt);
  } else {
    rect(ctx, cx - 3, top - 3, 6, 2, gc.lt);
    strokeRect(ctx, cx - 3, top - 3, 6, 2, 'ink');
  }

  rect(ctx, cx - 1, h - 6, 3, 4, 'inkDeep');
  rect(ctx, cx - 1, h - 6, 3, 1, gc.lt);

  drawEmblem(ctx, seed, bx + 1, h - 6, gc.lt);

  drawAnnex(ctx, v.annex, w, h, top, mainW, bx, gc);

  outline(ctx, 0, h - 2, w, 2, 'ink');
}

/* 地标：32×48 摩天金融中心 + 顶部标志物 */
function buildLandmark(gc, lv, seed, groupIndex) {
  const w = 32;
  const h = 48;
  const cv = makeCanvas(w, h);
  const ctx = cv.getContext('2d');
  const cx = 16;

  rect(ctx, 0, h - 3, w, 3, 'ink');
  hline(ctx, 0, h - 3, w, 'glassDeep');

  const towerW = 14;
  const towerTop = 12;
  rect(ctx, cx - 7, towerTop, towerW, h - 3 - towerTop, 'glassDeep');
  for (let c = 0; c < 4; c++) {
    rect(ctx, cx - 6 + c * 3, towerTop + 1, 2, h - 4 - towerTop, 'glass');
  }
  vline(ctx, cx - 6, towerTop + 1, h - 4 - towerTop, 'glassLt');
  vline(ctx, cx + 5, towerTop + 1, h - 4 - towerTop, 'ink');
  for (let y = towerTop + 2; y < h - 4; y += 2) hline(ctx, cx - 7, y, towerW, 'ink');
  windows(ctx, cx - 6, towerTop + 1, 12, h - 5 - towerTop, 4, 11, 'ink', 'amber', 0.28, seed);

  rect(ctx, 1, 24, 8, h - 27, gc.dk);
  vline(ctx, 1, 24, h - 27, gc.lt);
  windows(ctx, 2, 25, 6, h - 30, 2, 5, gc.dk, 'glassDeep', 0.35, seed + 7);
  rect(ctx, 23, 30, 8, h - 33, gc.dk);
  vline(ctx, 23, 30, h - 33, gc.lt);
  windows(ctx, 24, 31, 6, h - 36, 2, 4, gc.dk, 'glassDeep', 0.35, seed + 13);

  drawLandmarkCrown(ctx, cx, towerTop, gc, groupIndex);

  rect(ctx, 0, h - 9, w, 6, gc.base);
  hline(ctx, 0, h - 9, w, gc.lt);
  hline(ctx, 0, h - 4, w, 'ink');
  for (let x = 0; x < w; x += 4) {
    rect(ctx, x + 1, h - 8, 2, 3, 'glassDeep');
  }

  rect(ctx, cx - 4, h - 12, 8, 3, 'inkDeep');
  rect(ctx, cx - 4, h - 12, 8, 1, 'gold');

  rect(ctx, cx - 6, h - 15, 12, 2, 'gold');
  hline(ctx, cx - 6, h - 15, 12, 'goldLt');
  hline(ctx, cx - 6, h - 14, 12, 'goldDk');

  drawEmblem(ctx, seed, 3, h - 8, 'goldLt');

  outline(ctx, 0, h - 3, w, 3, 'ink');
  return cv;
}

/** 地标顶部标志物 —— 按集团区分轮廓 */
function drawLandmarkCrown(ctx, cx, towerTop, gc, groupIndex) {
  switch (groupIndex % 4) {
    case 0: { // 银行：金色钱币圆盘 + 尖顶
      vline(ctx, cx, towerTop - 8, 8, 'glassLt');
      pixelCircle(ctx, cx, towerTop - 9, 3, 'gold');
      pixelRing(ctx, cx, towerTop - 9, 3, 'goldDk');
      pixelCircle(ctx, cx, towerTop - 9, 1, 'goldLt');
      break;
    }
    case 1: { // 券商：菱形徽标
      for (let i = 0; i < 6; i++) {
        rect(ctx, cx - i, towerTop - 3 - i, i * 2 + 1, 1, gc.lt);
        rect(ctx, cx - i, towerTop - 3 + i, i * 2 + 1, 1, gc.lt);
      }
      rect(ctx, cx - 1, towerTop - 4, 3, 3, 'ink');
      break;
    }
    case 2: { // 保险：盾形顶冠
      rect(ctx, cx - 4, towerTop - 7, 9, 4, gc.lt);
      for (let i = 0; i < 3; i++) {
        rect(ctx, cx - 3 + i, top(i), 8 - i * 2, 1, gc.lt);
      }
      rect(ctx, cx - 2, towerTop - 6, 5, 2, 'paper');
      break;
    }
    default: { // 资管：双塔 + 连桥
      rect(ctx, cx - 6, towerTop - 7, 4, 7, gc.lt);
      rect(ctx, cx + 3, towerTop - 7, 4, 7, gc.lt);
      hline(ctx, cx - 2, towerTop - 5, 6, 'gold');
      rect(ctx, cx - 6, towerTop - 8, 4, 1, gc.lt);
      rect(ctx, cx + 3, towerTop - 8, 4, 1, gc.lt);
      break;
    }
  }
}

function top(i) { return -3 + i; }

/* ===================================================================
 * 监管机构 —— 紫金配色的对称行政建筑 + 天平/徽章顶冠
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
 *   fsc  —— 三角旗/天平（风险处置）
 */
export function buildRegulator(opts) {
  const { regulatorId = 'pbc', seed = 0 } = opts;
  const w = 18;
  const h = 30;
  const cv = makeCanvas(w, h);
  const ctx = cv.getContext('2d');
  const p = REGULATOR_PAL;

  // 基座台阶（三级）
  rect(ctx, 0, h - 2, w, 2, 'ink');
  rect(ctx, 1, h - 4, w - 2, 2, p.dk);
  hline(ctx, 1, h - 4, w - 2, p.lt);
  rect(ctx, 2, h - 7, w - 4, 3, p.base);
  hline(ctx, 2, h - 7, w - 4, p.lt);

  // 主体 —— 对称方塔
  const bodyW = w - 6;
  const bodyH = 15;
  const bx = 3;
  const by = h - 7 - bodyH;
  rect(ctx, bx, by, bodyW, bodyH, p.base);
  vline(ctx, bx, by, bodyH, p.lt);
  vline(ctx, bx + bodyW - 1, by, bodyH, 'ink');
  rect(ctx, bx + bodyW - 2, by, 1, bodyH, p.dk);
  // 横向腰线
  hline(ctx, bx + 1, by + 5, bodyW - 2, p.dk);
  hline(ctx, bx + 1, by + 10, bodyW - 2, p.dk);
  // 立柱
  for (let i = 0; i < 3; i++) {
    const cx = bx + 2 + i * 4;
    rect(ctx, cx, by + 1, 2, bodyH - 2, p.lt);
    rect(ctx, cx, by + 1, 1, bodyH - 2, p.base);
  }

  // 穹顶（阶梯式）
  const domeTop = by - 6;
  rect(ctx, bx + 1, domeTop + 4, bodyW - 2, 2, p.lt);
  rect(ctx, bx + 3, domeTop + 2, bodyW - 6, 2, p.lt);
  rect(ctx, bx + 5, domeTop, bodyW - 10, 2, p.accent);
  rect(ctx, bx + 5, domeTop, bodyW - 10, 1, p.accentLt);

  // 顶冠徽章 —— 四家各不相同
  const cx = Math.floor(w / 2);
  switch (regulatorId) {
    case 'pbc': { // 梅花币章
      pixelCircle(ctx, cx, domeTop - 3, 3, p.accent);
      rect(ctx, cx - 3, domeTop - 3, 7, 1, p.accent);
      rect(ctx, cx - 1, domeTop - 5, 3, 1, p.accent);
      rect(ctx, cx - 1, domeTop - 1, 3, 1, p.accent);
      rect(ctx, cx - 1, domeTop - 3, 1, 3, p.accentLt);
      break;
    }
    case 'csrc': { // 盾形刻章
      rect(ctx, cx - 3, domeTop - 5, 7, 5, p.accent);
      rect(ctx, cx - 2, domeTop - 4, 5, 3, p.dk);
      rect(ctx, cx - 3, domeTop - 1, 7, 1, p.accent);
      rect(ctx, cx - 2, domeTop, 5, 1, p.accent);
      rect(ctx, cx - 1, domeTop + 1, 3, 1, p.accent);
      break;
    }
    case 'nfra': { // 齿状圆章
      pixelCircle(ctx, cx, domeTop - 3, 4, p.accent);
      pixelCircle(ctx, cx, domeTop - 3, 2, p.dk);
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2;
        const dx = Math.round(Math.cos(a) * 5);
        const dy = Math.round(Math.sin(a) * 5);
        rect(ctx, cx + dx - 1, domeTop - 3 + dy, 2, 2, p.accent);
      }
      break;
    }
    default: { // fsc —— 天平（风险处置）
      rect(ctx, cx, domeTop - 5, 1, 6, p.accent);
      rect(ctx, cx - 4, domeTop - 4, 9, 1, p.accent);
      rect(ctx, cx - 4, domeTop - 4, 1, 2, p.accent);
      rect(ctx, cx + 4, domeTop - 4, 1, 2, p.accent);
      rect(ctx, cx - 5, domeTop - 2, 3, 1, p.accentLt);
      rect(ctx, cx + 3, domeTop - 2, 3, 1, p.accentLt);
      rect(ctx, cx - 1, domeTop - 1, 3, 1, p.accent);
      break;
    }
  }

  // 门廊
  rect(ctx, cx - 2, h - 12, 4, 5, p.dk);
  rect(ctx, cx - 2, h - 12, 4, 1, p.lt);
  // 门前台阶
  rect(ctx, cx - 3, h - 7, 6, 1, p.accent);

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
    ctx.fillStyle = ownerColor;
    ctx.fillRect(1, h - 2, w - 2, 2);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(1, h - 2, w - 2, 1);
    ctx.fillStyle = ownerColor;
    ctx.fillRect(0, h - 4, 1, 4);
    ctx.fillRect(w - 1, h - 4, 1, 4);
  }

  cache.set(key, cv);
  return cv;
}
