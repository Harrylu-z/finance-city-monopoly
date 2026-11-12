/**
 * 紧凑机构图标 —— 16×16 像素，在小格子里也能一眼辨形。
 *
 * ================== 为什么另起一套 ==================
 * 主立绘（src/art/buildings.js）是 16×32 的「建筑全身像」，信息量大，
 * 放进 60px 的地块里只剩 1 倍缩放，缩成一团色块 —— 这正是用户反馈的
 * 「建筑 sprite 缩成一团色块」。
 *
 * 本模块按地块实际尺寸重绘一套**极简体图标**：
 *   · 原生 16×16，整数倍放大（1× / 2× / 3×）永不糊；
 *   · 大色块 + 简单明暗两色，不堆细节；
 *   · 四类机构形态一眼可辨：
 *       银行 branch  —— 矮而宽，阶梯屋顶 + 门廊
 *       券商 tower   —— 高而尖，尖顶 + 天线
 *       保险 midrise —— 方正中层 + 穹顶顶冠
 *       资管 modern  —— 错落体块，退台轮廓
 *   · 等级 0~4 用**高度**递进（大色块表达，不加细节点数）。
 *
 * 色彩只取「1 主色 + 1 亮部 + 1 暗部」，全部来自受限色板。
 */

import { GROUP_COLORS, REGULATOR_COLOR } from '../core/palette.js';
import { makeCanvas, rect, hline, vline } from './pixeldraw.js';

/** 缓存 */
const cache = new Map();

/** 各等级的图标高度（像素）—— 递进明显 */
const ICON_HEIGHT = [6, 8, 10, 12, 14];

/**
 * 生成 16×16 紧凑机构图标。
 *
 * @param {object} opts
 * @param {string} opts.kind      'branch' | 'tower' | 'midrise' | 'modern' | 'regulator'
 * @param {number} opts.level     0..4
 * @param {string} opts.group     'bank' | 'broker' | 'insurer' | 'asset'
 * @param {number} opts.seed      决定变体，保证同一机构每次一致
 * @param {string} [opts.regulatorId] 监管机构 id
 * @returns {HTMLCanvasElement} 16×16 画布
 */
export function getCompactIcon(opts) {
  const {
    kind = 'branch', level = 0, group = 'bank', seed = 0, regulatorId = null,
  } = opts;
  const key = `c|${kind}|${level}|${group}|${seed}|${regulatorId || ''}`;
  if (cache.has(key)) return cache.get(key);

  const cv = makeCanvas(16, 16);
  const ctx = cv.getContext('2d');
  const lv = Math.max(0, Math.min(4, level));

  if (regulatorId) {
    drawRegulatorIcon(ctx, lv, seed);
  } else {
    const gc = GROUP_COLORS[group] || GROUP_COLORS.bank;
    const bodyH = ICON_HEIGHT[lv];
    switch (kind) {
      case 'tower':  drawTower(ctx, bodyH, gc, seed); break;
      case 'midrise': drawMidrise(ctx, bodyH, gc, seed); break;
      case 'modern': drawModern(ctx, bodyH, gc, seed); break;
      default:       drawBranch(ctx, bodyH, gc, seed); break;
    }
  }

  cache.set(key, cv);
  return cv;
}

/* ---------- 银行：矮而宽，阶梯屋顶 + 门廊 ---------- */
function drawBranch(ctx, bodyH, gc, seed) {
  const w = 12;
  const x = 2;
  const baseY = 15;

  // 主体（大色块）
  rect(ctx, x, baseY - bodyH, w, bodyH, gc.dk);
  // 右侧暗部 + 左侧亮部（两色明暗，不堆细节）
  rect(ctx, x, baseY - bodyH, 2, bodyH, gc.lt);
  rect(ctx, x + w - 2, baseY - bodyH, 2, bodyH, gc.dk);
  // 屋顶台阶
  rect(ctx, x + 1, baseY - bodyH - 2, w - 2, 2, gc.base);
  hline(ctx, x + 1, baseY - bodyH - 2, w - 2, gc.lt);
  // 门廊
  rect(ctx, x + 4, baseY - 3, 4, 3, gc.dk);
  rect(ctx, x + 5, baseY - 2, 2, 2, gc.base);
  // 地基
  hline(ctx, x - 1, baseY, w + 2, gc.dk);
}

/* ---------- 券商：高而尖，尖顶 + 天线 ---------- */
function drawTower(ctx, bodyH, gc, seed) {
  const w = 8;
  const x = 4;
  const baseY = 15;

  rect(ctx, x, baseY - bodyH, w, bodyH, gc.dk);
  rect(ctx, x, baseY - bodyH, 2, bodyH, gc.lt);
  rect(ctx, x + w - 2, baseY - bodyH, 2, bodyH, gc.dk);
  // 尖顶
  const apex = baseY - bodyH;
  rect(ctx, x + 2, apex - 3, 4, 3, gc.base);
  rect(ctx, x + 3, apex - 5, 2, 2, gc.base);
  hline(ctx, x + 3, apex - 5, 2, gc.lt);
  // 天线
  rect(ctx, x + 3, apex - 7, 1, 2, gc.lt);
  rect(ctx, x + 2, apex - 7, 3, 1, gc.lt);
  // 地面线
  hline(ctx, x - 1, baseY, w + 2, gc.dk);
}

/* ---------- 保险：方正中层 + 穹顶顶冠 ---------- */
function drawMidrise(ctx, bodyH, gc, seed) {
  const w = 10;
  const x = 3;
  const baseY = 15;

  rect(ctx, x, baseY - bodyH, w, bodyH, gc.dk);
  rect(ctx, x, baseY - bodyH, 2, bodyH, gc.lt);
  rect(ctx, x + w - 2, baseY - bodyH, 2, bodyH, gc.dk);
  // 穹顶顶冠
  const apex = baseY - bodyH;
  rect(ctx, x + 2, apex - 2, w - 4, 2, gc.base);
  rect(ctx, x + 3, apex - 3, w - 6, 1, gc.base);
  hline(ctx, x + 3, apex - 3, w - 6, gc.lt);
  rect(ctx, x + 4, apex - 5, 2, 2, gc.lt);
  // 门廊
  rect(ctx, x + 3, baseY - 3, 4, 3, gc.dk);
  rect(ctx, x + 4, baseY - 2, 2, 2, gc.base);
  hline(ctx, x - 1, baseY, w + 2, gc.dk);
}

/* ---------- 资管：错落体块，退台轮廓 ---------- */
function drawModern(ctx, bodyH, gc, seed) {
  const baseY = 15;
  // 两个错落的体块
  const tallH = bodyH;
  const shortH = Math.max(4, bodyH - 4);

  rect(ctx, 2, baseY - tallH, 6, tallH, gc.dk);
  rect(ctx, 2, baseY - tallH, 1, tallH, gc.lt);
  rect(ctx, 8, baseY - shortH, 6, shortH, gc.base);
  rect(ctx, 8, baseY - shortH, 1, shortH, gc.lt);
  rect(ctx, 12, baseY - shortH, 2, shortH, gc.dk);
  // 退台冠
  rect(ctx, 3, baseY - tallH - 2, 4, 2, gc.base);
  hline(ctx, 3, baseY - tallH - 2, 4, gc.lt);
  hline(ctx, 1, baseY, 14, gc.dk);
}

/* ---------- 监管机构：天平徽章（紫晶色，与四组明确区分） ---------- */
function drawRegulatorIcon(ctx, lv, seed) {
  const p = REGULATOR_COLOR;
  const baseY = 15;

  // 底座
  rect(ctx, 4, baseY - 2, 8, 2, p.dk);
  hline(ctx, 4, baseY - 2, 8, p.lt);
  // 立柱
  rect(ctx, 7, 4, 2, baseY - 6, p.dk);
  rect(ctx, 7, 4, 1, baseY - 6, p.lt);
  // 横梁
  rect(ctx, 3, 5, 10, 2, p.base);
  hline(ctx, 3, 5, 10, p.lt);
  // 两端秤盘
  rect(ctx, 1, 7, 4, 3, p.base);
  rect(ctx, 2, 10, 2, 2, p.dk);
  rect(ctx, 11, 7, 4, 3, p.base);
  rect(ctx, 12, 10, 2, 2, p.dk);
  // 顶端金球
  rect(ctx, 7, 2, 2, 2, p.accent);
  rect(ctx, 6, 3, 4, 1, p.accent);
}
