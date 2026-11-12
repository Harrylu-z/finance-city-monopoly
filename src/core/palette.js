/**
 * 受限色板 —— 16 色封顶，所有像素资源只允许取用此表。
 *
 * ================== 设计约束 ==================
 *  · 总数 ≤ 16 色，保证整体视觉统一、不会有「霓虹紫/品红/绿/橙/青乱飞」；
 *  · 每个产权组 = 1 主色 + 1 亮部 + 1 暗部（三色阶表达体积）；
 *  · 四组主色的色相间隔 ≥ 60°，且明度差异明显 —— 远看就能分辨归属；
 *  · 深色背景与浅色棋盘分离，形成「图地分明」的实体板观感；
 *  · 全部为纯色，禁用渐变（像素风铁律）。
 *
 * ================== 色相分配 ==================
 *   银行  12°   暖红      —— 稳重、国有
 *   券商  190°  青蓝      —— 锐利、进取
 *   保险  140°  翠绿      —— 稳健、避险
 *   资管  45°   琥珀金    —— 财富、杠杆
 */

export const PALETTE = {
  // ===== 中性色（5 色）=====
  /** 墨色 —— 描边、最深阴影 */
  ink:        '#151a26',
  /** 深底 —— 背景、HUD 面板底 */
  panel:      '#1e2436',
  /** 中灰 —— 禁用态、分割线 */
  dim:        '#4a5266',
  /** 棋盘浅底 —— 地块底色（与深色背景形成强对比） */
  board:      '#e8ddc4',
  /** 棋盘浅底暗调 —— 特殊格底、棋盘外框内圈 */
  boardDk:    '#cfc1a4',

  // ===== 强调色（4 色）=====
  /** 鎏金 —— 主行动色、当前回合 */
  gold:       '#e8a93c',
  goldLt:     '#ffc861',
  goldDk:     '#9a6a1c',
  /** 宣纸白 —— 主文字 */
  paper:      '#f6efe0',
  /** 朱红 —— 上涨、危险 */
  red:        '#c8392b',
  redLt:      '#e4604d',
  /** 翠绿 —— 可购买、盈利 */
  green:      '#4f9d55',
  greenLt:    '#77c47c',
};

/**
 * 四产权组配色 —— 每组 3 色阶（主 / 亮 / 暗）。
 *
 * 色相间隔 ≥ 60°（券商↔保险为 50°，靠明度差拉开）。
 * 监管机构使用紫晶警示色（第五组），与四组明显区分。
 */
export const GROUP_COLORS = {
  bank:    { base: '#c8392b', lt: '#e4604d', dk: '#8d2419', accent: '#e8a93c', name: '银行' },
  broker:  { base: '#2f9fc4', lt: '#63c6e6', dk: '#1c6b88', accent: '#f6efe0', name: '券商' },
  insurer: { base: '#4f9d55', lt: '#7ac77f', dk: '#336b38', accent: '#f6efe0', name: '保险' },
  asset:   { base: '#e8a93c', lt: '#ffc861', dk: '#9a6a1c', accent: '#151a26', name: '资管' },
};

/** 监管机构专用色 —— 第五组，紫晶，与产权组明确区分 */
export const REGULATOR_COLOR = {
  base: '#8b5cc7', lt: '#b189e0', dk: '#5c3a86', accent: '#e8a93c',
};

/**
 * 玩家色 —— 4 组，色相间隔 ≥ 90°，全部为高饱和以便在小格上辨识。
 * 琥珀 / 青 / 朱红 / 紫晶 —— 与四产权组的主色刻意错开，避免语义混淆。
 */
export const PLAYER_COLORS = [
  { main: '#e8a93c', lt: '#ffc861', dk: '#9a6a1c', name: '鎏金' },
  { main: '#3fc6c6', lt: '#7fe3e3', dk: '#259a9a', name: '霓青' },
  { main: '#e05a4a', lt: '#f08373', dk: '#963026', name: '朱红' },
  { main: '#b07ce8', lt: '#cfa6f5', dk: '#7549a8', name: '紫晶' },
];

/** 兼容旧引用（部分模块曾用到这些键名） */
export const LEGACY_ALIAS = {
  navy: PALETTE.panel,
  navyLt: '#2b3348',
  navyDk: '#171c2b',
  navyDeep: '#0e1220',
  glass: PALETTE.dim,
  glassLt: '#6b7488',
  glassDk: '#3a4256',
  glassDeep: '#282f40',
  neon: '#3fc6c6',
  neonLt: '#7fe3e3',
  neonDk: '#259a9a',
  amber: PALETTE.gold,
  amberLt: PALETTE.goldLt,
  amberDk: PALETTE.goldDk,
  jade: PALETTE.green,
  jadeLt: PALETTE.greenLt,
  jadeDk: '#336b38',
  purple: REGULATOR_COLOR.base,
  purpleLt: REGULATOR_COLOR.lt,
  purpleDk: REGULATOR_COLOR.dk,
  purpleDeep: '#3d2757',
  inkDeep: '#0b0e17',
  paperDk: '#ded5c2',
  paperDeep: '#b3aa96',
  goldDeep: '#6d4a17',
  redDeep: '#5c1810',
};

/** 把 '#rrggbb' 转成 [r,g,b] */
export function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

/** 受控色集合 —— 供像素绘制工具校验 */
export const ALLOWED_COLORS = new Set([
  ...Object.values(PALETTE),
  ...Object.values(REGULATOR_COLOR),
  ...Object.values(LEGACY_ALIAS),
  ...Object.values(GROUP_COLORS).flatMap((g) => [g.base, g.lt, g.dk, g.accent]),
  ...PLAYER_COLORS.flatMap((p) => [p.main, p.lt, p.dk]),
]);

/** 校验一个颜色是否在受控色板内（供自检使用） */
export function isAllowed(color) {
  return ALLOWED_COLORS.has(color);
}
