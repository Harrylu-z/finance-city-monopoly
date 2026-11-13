/**
 * 扑克牌像素渲染 —— 德州扑克桌面专用。
 *
 * 尺寸 22×30（原生），整数倍放大后仍保持硬边缘。
 *   · 正面：白底 + 花色符号 + 点数
 *   · 背面：红黑菱格纹（赌王的牌也用同一套背面）
 *
 * 只取受控色板：红桃/方块用 red 系，黑桃/梅花用 ink 系。
 */

import { makeCanvas, rect, hline, vline, outline } from './pixeldraw.js';

const CW = 22;
const CH = 30;

const cache = new Map();

const SUIT_COLOR = { S: 'ink', C: 'ink', H: 'red', D: 'red' };
const SUIT_LIGHT = { S: 'glassDk', C: 'glassDk', H: 'redLt', D: 'redLt' };
const SUIT_NAME = { S: '♠', C: '♣', H: '♥', D: '♦' };
const RANK_TEXT = { T: '10', J: 'J', Q: 'Q', K: 'K', A: 'A' };

/** 点数 → 显示文本 */
export function rankText(rank) {
  return RANK_TEXT[rank] || rank;
}

/**
 * 渲染一张牌（正面）。
 * @param {object} card { rank, suit }
 * @param {object} opts { dim } —— dim=true 时压暗（对手未摊开的底牌）
 */
export function getCardFace(card, opts = {}) {
  if (!card) return null;
  const key = `cf_${card.id}_${opts.dim ? 'd' : 'n'}`;
  if (cache.has(key)) return cache.get(key);

  const cv = makeCanvas(CW, CH);
  const ctx = cv.getContext('2d');
  const c = SUIT_COLOR[card.suit] || 'ink';
  const cl = SUIT_LIGHT[card.suit] || 'glassDk';
  const bg = opts.dim ? 'glassDeep' : 'paper';

  // 卡面
  rect(ctx, 0, 0, CW, CH, bg);
  rect(ctx, 1, 1, CW - 2, CH - 2, bg);
  // 左上角点数
  const rt = rankText(card.rank);
  const tw = rt.length === 2 ? 9 : 5;
  drawGlyph(ctx, 3, 3, rt, c);
  // 花色小标（右上）
  drawSuitMark(ctx, CW - 8, 4, card.suit, c, cl);
  // 中央大花色
  drawSuitMark(ctx, 9, 12, card.suit, c, cl, 2);
  // 右下角点数（倒置简化处理：只画小字）
  drawGlyph(ctx, CW - tw - 2, CH - 9, rt, c);
  drawSuitMark(ctx, 4, CH - 8, card.suit, c, cl);

  outline(ctx, 0, 0, CW, CH, 'ink');
  cache.set(key, cv);
  return cv;
}

/** 牌背（菱格纹） */
export function getCardBack() {
  return cached('cb', () => {
    const cv = makeCanvas(CW, CH);
    const ctx = cv.getContext('2d');
    rect(ctx, 0, 0, CW, CH, 'red');
    rect(ctx, 1, 1, CW - 2, CH - 2, 'redDk');
    for (let y = 2; y < CH - 2; y += 4) {
      for (let x = 2; x < CW - 2; x += 4) {
        const odd = ((x - 2) / 4 + (y - 2) / 4) % 2 === 0;
        rect(ctx, x, y, 2, 2, odd ? 'red' : 'goldDk');
      }
    }
    rect(ctx, 8, 12, 6, 6, 'red');
    rect(ctx, 9, 13, 4, 4, 'gold');
    rect(ctx, 10, 14, 2, 2, 'redDk');
    outline(ctx, 0, 0, CW, CH, 'ink');
    return cv;
  });
}

function cached(key, factory) {
  if (cache.has(key)) return cache.get(key);
  const v = factory();
  cache.set(key, v);
  return v;
}

/** 画点数（像素字形 3×5 或 2 行 "10"） */
function drawGlyph(ctx, x, y, text, color) {
  // 数字采用 3×5 像素点阵；10 特殊处理
  if (text === '10') {
    drawDigit(ctx, x, y, 1, color);
    drawDigit(ctx, x + 5, y, 0, color);
    return;
  }
  const map = {
    '2': ['111', '101', '111', '001', '111'],
    '3': ['111', '001', '111', '001', '111'],
    '4': ['101', '101', '111', '001', '001'],
    '5': ['111', '100', '111', '001', '111'],
    '6': ['111', '100', '111', '101', '111'],
    '7': ['111', '001', '001', '001', '001'],
    '8': ['111', '101', '111', '101', '111'],
    '9': ['111', '101', '111', '001', '111'],
    'J': ['111', '010', '010', '010', '111'],
    'Q': ['111', '101', '111', '101', '111'],
    'K': ['101', '101', '111', '101', '101'],
    'A': ['111', '101', '111', '101', '101'],
  };
  const rows = map[text];
  if (!rows) return;
  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c < rows[r].length; c++) {
      if (rows[r][c] === '1') rect(ctx, x + c, y + r, 1, 1, color);
    }
  }
}

function drawDigit(ctx, x, y, d, color) {
  const map = {
    0: ['111', '101', '101', '101', '111'],
    1: ['010', '110', '010', '010', '111'],
  };
  const rows = map[d];
  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c < rows[r].length; c++) {
      if (rows[r][c] === '1') rect(ctx, x + c, y + r, 1, 1, color);
    }
  }
}

/** 画花色符号（像素化） */
function drawSuitMark(ctx, x, y, suit, color, light, scale = 1) {
  const s = scale;
  if (suit === 'S' || suit === 'C') {
    // 桃/梅：上部圆瓣 + 下部尖
    if (suit === 'S') {
      // 倒三角（黑桃下半）
      for (let r = 0; r < 4 * s; r++) {
        const w = Math.max(1, (4 * s - r) * 2 - 1);
        rect(ctx, x + Math.floor((8 * s - w) / 2), y + 5 * s + r, w, 1, color);
      }
      // 上部两瓣
      rect(ctx, x + 1 * s, y + 2 * s, 2 * s, 3 * s, color);
      rect(ctx, x + 5 * s, y + 2 * s, 2 * s, 3 * s, color);
      rect(ctx, x + 2 * s, y + 3 * s, 4 * s, 2 * s, color);
      // 梗
      rect(ctx, x + 3 * s, y + 9 * s, 2 * s, 3 * s, color);
      rect(ctx, x + 3 * s, y + 9 * s, 1 * s, 3 * s, light);
    } else {
      // 梅花：三瓣 + 梗
      rect(ctx, x + 3 * s, y, 2 * s, 3 * s, color);
      rect(ctx, x + 1 * s, y + 2 * s, 2 * s, 2 * s, color);
      rect(ctx, x + 5 * s, y + 2 * s, 2 * s, 2 * s, color);
      rect(ctx, x + 2 * s, y + 4 * s, 4 * s, 2 * s, color);
      rect(ctx, x + 3 * s, y + 6 * s, 2 * s, 5 * s, color);
      rect(ctx, x + 3 * s, y + 6 * s, 1 * s, 5 * s, light);
    }
  } else {
    // 红桃 / 方块
    if (suit === 'D') {
      // 方块
      for (let r = 0; r < 5 * s; r++) {
        const w = (r < 2 * s ? r + 1 : 5 * s - r) * 2 - 1;
        rect(ctx, x + Math.floor((8 * s - w) / 2), y + r, w, 1, color);
      }
    } else {
      // 红桃
      rect(ctx, x + 1 * s, y + 1 * s, 3 * s, 3 * s, color);
      rect(ctx, x + 4 * s, y + 1 * s, 3 * s, 3 * s, color);
      rect(ctx, x + 2 * s, y + 2 * s, 4 * s, 3 * s, color);
      for (let r = 0; r < 5 * s; r++) {
        const w = (5 * s - r) * 2 - 1;
        rect(ctx, x + Math.floor((8 * s - w) / 2), y + 4 * s + r, w, 1, color);
      }
    }
  }
}

/** 花色中文/符号名（UI 文本用） */
export function suitSymbol(suit) {
  return SUIT_NAME[suit] || '?';
}
