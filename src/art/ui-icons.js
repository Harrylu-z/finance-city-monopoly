/**
 * UI 像素图标 —— 骰子、特殊格图标、通用 UI 元素。
 * 全部原生小尺寸绘制，整数倍放大，硬边缘。
 */

import {
  makeCanvas, rect, strokeRect, hline, vline,
  pixelCircle, pixelRing, outline,
} from './pixeldraw.js';

const iconCache = new Map();

function cached(key, factory) {
  if (iconCache.has(key)) return iconCache.get(key);
  const v = factory();
  iconCache.set(key, v);
  return v;
}

/* 骰子 —— 16×16 */
export function getDie(face) {
  return cached(`die${face}`, () => {
    const cv = makeCanvas(16, 16);
    const ctx = cv.getContext('2d');
    rect(ctx, 2, 2, 12, 12, 'paper');
    rect(ctx, 1, 3, 14, 10, 'paper');
    rect(ctx, 3, 1, 10, 14, 'paper');
    hline(ctx, 1, 12, 14, 'paperDeep');
    hline(ctx, 2, 13, 12, 'paperDeep');
    vline(ctx, 13, 3, 10, 'paperDeep');
    strokeRect(ctx, 1, 1, 14, 14, 'ink');

    const pts = {
      1: [[8, 8]],
      2: [[5, 5], [11, 11]],
      3: [[5, 5], [8, 8], [11, 11]],
      4: [[5, 5], [11, 5], [5, 11], [11, 11]],
      5: [[5, 5], [11, 5], [8, 8], [5, 11], [11, 11]],
      6: [[5, 4], [11, 4], [5, 8], [11, 8], [5, 12], [11, 12]],
    }[face] || [[8, 8]];

    for (const [x, y] of pts) {
      rect(ctx, x - 1, y - 1, 3, 3, 'ink');
      rect(ctx, x - 1, y - 1, 2, 2, 'red');
    }
    return cv;
  });
}

/** 骰子滚动帧 */
export function getDieRollFrames() {
  return cached('dieRoll', () => {
    return [3, 6, 2, 5, 1, 4].map((f) => getDie(f));
  });
}

/* 特殊格图标 —— 16×16 */
export function getSpecialIcon(kind) {
  return cached(`sp_${kind}`, () => {
    const cv = makeCanvas(16, 16);
    const ctx = cv.getContext('2d');
    switch (kind) {
      case 'start': drawStart(ctx); break;
      case 'clearing': drawClearing(ctx); break;
      case 'cross': drawCross(ctx); break;
      case 'metro': drawMetro(ctx); break;
      case 'tax': drawTax(ctx); break;
      case 'charity': drawCharity(ctx); break;
      case 'fine': drawFine(ctx); break;
      case 'event': drawEvent(ctx); break;
      case 'market': drawMarket(ctx); break;
      case 'audit': drawAudit(ctx); break;
      case 'risk': drawRisk(ctx); break;
      case 'bond': drawBond(ctx); break;
      case 'rating': drawRating(ctx); break;
      case 'commodity': drawCommodity(ctx); break;
      case 'roadshow': drawRoadshow(ctx); break;
      default: rect(ctx, 2, 2, 12, 12, 'glass'); break;
    }
    return cv;
  });
}

function drawStart(ctx) {
  rect(ctx, 3, 7, 4, 8, 'gold');
  rect(ctx, 3, 7, 1, 8, 'goldLt');
  rect(ctx, 8, 4, 5, 11, 'goldDk');
  rect(ctx, 8, 4, 1, 11, 'gold');
  rect(ctx, 3, 6, 4, 1, 'goldLt');
  rect(ctx, 8, 3, 5, 1, 'gold');
  rect(ctx, 4, 9, 1, 1, 'ink');
  rect(ctx, 6, 9, 1, 1, 'ink');
  rect(ctx, 4, 11, 1, 1, 'ink');
  rect(ctx, 9, 6, 1, 1, 'ink');
  rect(ctx, 11, 6, 1, 1, 'ink');
  rect(ctx, 9, 9, 1, 1, 'ink');
  rect(ctx, 11, 9, 1, 1, 'ink');
  for (let i = 0; i < 3; i++) rect(ctx, 13 - i, 1 + i, 1 + i * 2, 1, 'neon');
  outline(ctx, 0, 0, 16, 16, 'ink');
}

function drawClearing(ctx) {
  rect(ctx, 1, 7, 14, 2, 'neon');
  for (let i = 0; i < 3; i++) rect(ctx, 1 + i, 8 - i, 1, 1, 'neon');
  rect(ctx, 2, 5, 1, 1, 'neon');
  for (let i = 0; i < 3; i++) rect(ctx, 12 - i, 9 + i, 1, 1, 'neon');
  rect(ctx, 13, 11, 1, 1, 'neon');
  rect(ctx, 7, 3, 1, 4, 'paper');
  rect(ctx, 9, 3, 1, 4, 'paper');
  hline(ctx, 7, 4, 3, 'paper');
  hline(ctx, 7, 6, 3, 'paper');
  rect(ctx, 8, 7, 1, 2, 'paper');
  outline(ctx, 0, 0, 16, 16, 'ink');
}

function drawCross(ctx) {
  pixelCircle(ctx, 6, 8, 4, 'jade');
  pixelRing(ctx, 6, 8, 4, 'jadeDk');
  rect(ctx, 4, 7, 5, 1, 'paper');
  rect(ctx, 5, 6, 3, 1, 'paper');
  rect(ctx, 9, 7, 5, 1, 'gold');
  for (let i = 0; i < 3; i++) rect(ctx, 11 + i, 5 + i, 1, 1, 'gold');
  for (let i = 0; i < 3; i++) rect(ctx, 11 + i, 8 - i, 1, 1, 'gold');
  outline(ctx, 0, 0, 16, 16, 'ink');
}

function drawMetro(ctx) {
  rect(ctx, 2, 3, 12, 9, 'red');
  rect(ctx, 2, 3, 12, 1, 'redLt');
  rect(ctx, 2, 11, 12, 1, 'redDk');
  rect(ctx, 4, 5, 3, 3, 'neonLt');
  rect(ctx, 9, 5, 3, 3, 'neonLt');
  rect(ctx, 4, 5, 3, 1, 'paper');
  rect(ctx, 3, 10, 1, 1, 'amber');
  rect(ctx, 12, 10, 1, 1, 'amber');
  hline(ctx, 1, 14, 14, 'glassDk');
  hline(ctx, 3, 13, 2, 'glassDk');
  hline(ctx, 11, 13, 2, 'glassDk');
  outline(ctx, 2, 3, 12, 9, 'ink');
}

function drawTax(ctx) {
  rect(ctx, 2, 2, 10, 12, 'paper');
  hline(ctx, 3, 4, 8, 'glass');
  hline(ctx, 3, 6, 8, 'glass');
  hline(ctx, 3, 8, 5, 'glass');
  pixelCircle(ctx, 10, 10, 3, 'red');
  pixelRing(ctx, 10, 10, 3, 'redDk');
  rect(ctx, 9, 9, 3, 3, 'redDk');
  outline(ctx, 2, 2, 10, 12, 'ink');
}

function drawCharity(ctx) {
  for (let y = 0; y < 7; y++) {
    const w = y === 0 ? 2 : y < 3 ? 6 : y === 3 ? 10 : 8 - (y - 3) * 2;
    rect(ctx, 8 - Math.floor(w / 2), 4 + y, w, 1, 'red');
  }
  rect(ctx, 7, 5, 1, 2, 'redLt');
  rect(ctx, 7, 6, 1, 1, 'redLt');
  outline(ctx, 0, 0, 16, 16, 'ink');
}

function drawFine(ctx) {
  rect(ctx, 4, 6, 8, 6, 'gold');
  rect(ctx, 4, 6, 8, 1, 'goldLt');
  rect(ctx, 4, 11, 8, 1, 'goldDk');
  rect(ctx, 6, 3, 4, 3, 'goldDk');
  rect(ctx, 7, 2, 2, 2, 'gold');
  rect(ctx, 7, 7, 3, 1, 'ink');
  rect(ctx, 9, 8, 2, 1, 'ink');
  rect(ctx, 8, 9, 2, 1, 'ink');
  rect(ctx, 7, 10, 2, 1, 'ink');
  rect(ctx, 6, 11, 2, 1, 'ink');
  outline(ctx, 0, 0, 16, 16, 'ink');
}

function drawEvent(ctx) {
  rect(ctx, 2, 2, 12, 12, 'paper');
  rect(ctx, 2, 2, 12, 1, 'glassLt');
  rect(ctx, 3, 4, 6, 2, 'ink');
  rect(ctx, 3, 8, 4, 5, 'glass');
  rect(ctx, 8, 8, 4, 5, 'glass');
  rect(ctx, 3, 8, 4, 1, 'glassDk');
  rect(ctx, 8, 8, 4, 1, 'glassDk');
  outline(ctx, 2, 2, 12, 12, 'ink');
}

function drawMarket(ctx) {
  vline(ctx, 2, 2, 12, 'glass');
  hline(ctx, 2, 13, 12, 'glass');
  const bars = [[4, 9, 1], [6, 6, 2], [8, 7, 1], [10, 4, 3], [12, 6, 2]];
  for (const [x, top, hgt] of bars) {
    const up = x % 4 === 0;
    const c = up ? 'red' : 'jade';
    vline(ctx, x, top - 1, 1, c);
    rect(ctx, x - 1, top, 3, hgt, c);
    rect(ctx, x - 1, top, 1, hgt, up ? 'redLt' : 'jadeLt');
    vline(ctx, x, top + hgt, 1, c);
  }
  outline(ctx, 0, 0, 16, 16, 'ink');
}

/* 监管抽查 —— 放大镜 + 警示三角（陷阱） */
function drawAudit(ctx) {
  // 放大镜
  pixelRing(ctx, 6, 6, 4, 'glassLt');
  pixelRing(ctx, 6, 6, 3, 'glass');
  rect(ctx, 9, 9, 4, 2, 'glassDk');
  rect(ctx, 9, 9, 4, 1, 'glass');
  // 警示三角
  rect(ctx, 11, 2, 3, 3, 'red');
  rect(ctx, 10, 5, 5, 1, 'red');
  rect(ctx, 11, 6, 3, 1, 'red');
  rect(ctx, 11, 7, 3, 1, 'red');
  rect(ctx, 12, 5, 1, 2, 'redLt');
  outline(ctx, 0, 0, 16, 16, 'ink');
}

/* 风险警示 —— 断裂的闪电 + 感叹号（陷阱） */
function drawRisk(ctx) {
  // 闪电
  rect(ctx, 4, 2, 3, 4, 'amber');
  rect(ctx, 5, 6, 3, 3, 'amber');
  rect(ctx, 4, 9, 2, 3, 'amber');
  rect(ctx, 4, 2, 1, 4, 'amberLt');
  // 裂缝
  rect(ctx, 7, 4, 1, 2, 'red');
  rect(ctx, 8, 6, 1, 2, 'red');
  // 感叹号
  rect(ctx, 11, 3, 2, 5, 'red');
  rect(ctx, 11, 9, 2, 2, 'red');
  rect(ctx, 11, 3, 1, 5, 'redLt');
  outline(ctx, 0, 0, 16, 16, 'ink');
}

/* 债券发行 —— 凭证 + 上升箭头 */
function drawBond(ctx) {
  // 凭证
  rect(ctx, 2, 4, 9, 9, 'jade');
  rect(ctx, 2, 4, 1, 9, 'jadeLt');
  rect(ctx, 3, 6, 7, 1, 'paper');
  rect(ctx, 3, 8, 7, 1, 'paper');
  rect(ctx, 3, 10, 5, 1, 'paper');
  // 印章
  pixelCircle(ctx, 8, 11, 2, 'red');
  // 上升箭头
  rect(ctx, 11, 9, 1, 4, 'jadeLt');
  rect(ctx, 12, 8, 1, 4, 'jadeLt');
  rect(ctx, 13, 5, 1, 6, 'jadeLt');
  rect(ctx, 11, 5, 3, 1, 'jadeLt');
  rect(ctx, 10, 6, 3, 1, 'jadeLt');
  outline(ctx, 0, 0, 16, 16, 'ink');
}

/* 信用评级 —— 评级徽章 + 上下箭头 */
function drawRating(ctx) {
  // 盾形评级章
  rect(ctx, 3, 3, 10, 8, 'gold');
  rect(ctx, 3, 3, 10, 1, 'goldLt');
  rect(ctx, 4, 4, 8, 6, 'goldDk');
  rect(ctx, 5, 5, 6, 4, 'gold');
  rect(ctx, 6, 6, 4, 2, 'ink');
  // 上下箭头
  rect(ctx, 5, 12, 6, 1, 'jadeLt');
  rect(ctx, 7, 13, 2, 1, 'jadeLt');
  rect(ctx, 5, 12, 2, 1, 'jadeLt');
  rect(ctx, 9, 12, 2, 1, 'jadeLt');
  outline(ctx, 0, 0, 16, 16, 'ink');
}

/* 要素市场 · 大宗交易 —— 货箱 + 双向箭头 */
function drawCommodity(ctx) {
  // 货箱
  rect(ctx, 2, 7, 8, 7, 'amberDk');
  rect(ctx, 2, 7, 8, 1, 'amber');
  rect(ctx, 2, 7, 1, 7, 'amber');
  rect(ctx, 4, 9, 4, 1, 'amberDk');
  rect(ctx, 4, 11, 4, 1, 'amberDk');
  rect(ctx, 5, 8, 2, 5, 'amber');
  // 双向箭头
  rect(ctx, 11, 4, 4, 1, 'paper');
  rect(ctx, 11, 4, 1, 2, 'paper');
  rect(ctx, 14, 4, 1, 2, 'paper');
  rect(ctx, 11, 11, 4, 1, 'paper');
  rect(ctx, 11, 9, 1, 2, 'paper');
  rect(ctx, 14, 9, 1, 2, 'paper');
  outline(ctx, 0, 0, 16, 16, 'ink');
}

/* 投资者路演 —— 演讲台 + 聚光灯 + 观众 */
function drawRoadshow(ctx) {
  // 讲台
  rect(ctx, 5, 8, 6, 6, 'glassDk');
  rect(ctx, 5, 8, 6, 1, 'glassLt');
  rect(ctx, 6, 10, 4, 3, 'glass');
  // 演讲者（小人）
  rect(ctx, 7, 4, 2, 2, 'paper');
  rect(ctx, 6, 6, 4, 2, 'neon');
  // 聚光灯
  rect(ctx, 2, 1, 2, 4, 'amber');
  rect(ctx, 12, 1, 2, 4, 'amber');
  rect(ctx, 1, 0, 4, 1, 'amberLt');
  rect(ctx, 11, 0, 4, 1, 'amberLt');
  // 观众席
  rect(ctx, 1, 14, 14, 1, 'ink');
  rect(ctx, 3, 12, 2, 2, 'gold');
  rect(ctx, 7, 12, 2, 2, 'gold');
  rect(ctx, 11, 12, 2, 2, 'gold');
  outline(ctx, 0, 0, 16, 16, 'ink');
}

/* 通用 UI 图标 */

export function getStarIcon(color = 'gold') {
  return cached(`star_${color}`, () => {
    const cv = makeCanvas(9, 9);
    const ctx = cv.getContext('2d');
    const pts = [
      [4, 0], [5, 3], [8, 3], [6, 5], [7, 8], [4, 6], [1, 8], [2, 5], [0, 3], [3, 3],
    ];
    for (const [x, y] of pts) rect(ctx, x, y, 1, 1, color);
    outline(ctx, 0, 0, 9, 9, 'ink');
    return cv;
  });
}

export function getCoinIcon() {
  return cached('coin', () => {
    const cv = makeCanvas(8, 8);
    const ctx = cv.getContext('2d');
    pixelCircle(ctx, 4, 4, 3, 'gold');
    pixelRing(ctx, 4, 4, 3, 'goldDk');
    pixelCircle(ctx, 4, 4, 2, 'amber');
    rect(ctx, 3, 2, 1, 5, 'goldLt');
    rect(ctx, 4, 3, 1, 3, 'goldDk');
    return cv;
  });
}

export function getFlagIcon(color) {
  return cached(`flag_${color}`, () => {
    const cv = makeCanvas(8, 10);
    const ctx = cv.getContext('2d');
    vline(ctx, 1, 0, 10, 'ink');
    rect(ctx, 1, 0, 1, 10, 'paperDeep');
    rect(ctx, 2, 1, 5, 4, color);
    rect(ctx, 2, 1, 5, 1, '#ffffff');
    rect(ctx, 2, 4, 5, 1, 'ink');
    return cv;
  });
}

/** 产权牌（股票代码牌） */
export function getTickerPlate(code, color, w = 20, h = 7) {
  return cached(`tick_${code}_${color}_${w}`, () => {
    const cv = makeCanvas(w, h);
    const ctx = cv.getContext('2d');
    rect(ctx, 0, 0, w, h, color);
    rect(ctx, 0, 0, w, 1, '#ffffff');
    rect(ctx, 0, h - 1, w, 1, 'ink');
    strokeRect(ctx, 0, 0, w, h, 'ink');
    ctx.fillStyle = 'ink';
    const text = code.slice(0, Math.floor((w - 2) / 4)).toUpperCase();
    for (let i = 0; i < text.length; i++) {
      drawMiniChar(ctx, text[i], 1 + i * 4, 1);
    }
    return cv;
  });
}

/** 3×5 像素字模 */
const MINI_FONT = {
  A: ['111', '101', '111', '101', '101'], B: ['110', '101', '110', '101', '110'],
  C: ['111', '100', '100', '100', '111'], D: ['110', '101', '101', '101', '110'],
  E: ['111', '100', '110', '100', '111'], F: ['111', '100', '110', '100', '100'],
  G: ['111', '100', '101', '101', '111'], H: ['101', '101', '111', '101', '101'],
  I: ['111', '010', '010', '010', '111'], J: ['001', '001', '001', '101', '111'],
  K: ['101', '101', '110', '101', '101'], L: ['100', '100', '100', '100', '111'],
  M: ['101', '111', '111', '101', '101'], N: ['110', '101', '101', '101', '101'],
  O: ['111', '101', '101', '101', '111'], P: ['111', '101', '111', '100', '100'],
  Q: ['111', '101', '101', '111', '001'], R: ['111', '101', '111', '110', '101'],
  S: ['111', '100', '111', '001', '111'], T: ['111', '010', '010', '010', '010'],
  U: ['101', '101', '101', '101', '111'], V: ['101', '101', '101', '101', '010'],
  W: ['101', '101', '111', '111', '101'], X: ['101', '101', '010', '101', '101'],
  Y: ['101', '101', '010', '010', '010'], Z: ['111', '001', '010', '100', '111'],
  0: ['111', '101', '101', '101', '111'], 1: ['010', '110', '010', '010', '111'],
  2: ['111', '001', '111', '100', '111'], 3: ['111', '001', '111', '001', '111'],
  4: ['101', '101', '111', '001', '001'], 5: ['111', '100', '111', '001', '111'],
  6: ['111', '100', '111', '101', '111'], 7: ['111', '001', '010', '010', '010'],
  8: ['111', '101', '111', '101', '111'], 9: ['111', '101', '111', '001', '111'],
  '.': ['0', '0', '0', '0', '1'], '-': ['000', '000', '111', '000', '000'],
  ' ': ['0', '0', '0', '0', '0'],
};

export function drawMiniChar(ctx, ch, x, y, color = 'ink') {
  const glyph = MINI_FONT[ch];
  if (!glyph) return;
  ctx.fillStyle = color;
  for (let r = 0; r < glyph.length; r++) {
    const row = glyph[r];
    for (let c = 0; c < row.length; c++) {
      if (row[c] === '1') ctx.fillRect(x + c, y + r, 1, 1);
    }
  }
}

/** 文本转像素精灵 */
export function textToSprite(text, color, scale = 1) {
  const w = text.length * 4 - 1;
  const h = 5;
  const cv = makeCanvas(w, h);
  const ctx = cv.getContext('2d');
  ctx.fillStyle = color;
  for (let i = 0; i < text.length; i++) {
    drawMiniChar(ctx, text[i].toUpperCase(), i * 4, 0, color);
  }
  if (scale === 1) return cv;
  const out = makeCanvas(w * scale, h * scale);
  const octx = out.getContext('2d');
  octx.imageSmoothingEnabled = false;
  octx.drawImage(cv, 0, 0, out.width, out.height);
  return out;
}
