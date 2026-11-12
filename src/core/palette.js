/**
 * 调色板 —— 项目级受限色板（32 色）
 * 所有像素资源只允许取用此表中的颜色，保证整体视觉统一。
 * 规范：色阶 + 高光 + 阴影三层表现体积，禁止渐变。
 */

export const PALETTE = {
  // 墨蓝 / 藏青（底色与建筑石材）
  ink:        '#161b2e',
  inkLt:      '#1e2440',
  inkDeep:    '#0d1120',
  navy:       '#243356',
  navyLt:     '#2f4270',
  navyDk:     '#1a2440',
  navyDeep:   '#10162a',

  // 鎏金（主强调）
  gold:       '#e0a53f',
  goldLt:     '#f5cf7a',
  goldDk:     '#a8762a',
  goldDeep:   '#6d4a17',

  // 朱红（风险 / 上涨）
  red:        '#c8392b',
  redLt:      '#e35a49',
  redDk:      '#8d2419',
  redDeep:    '#5c1810',

  // 玉青（下跌 / 合规）
  jade:       '#4f8f8b',
  jadeLt:     '#6fb3ad',
  jadeDk:     '#33615f',
  jadeDeep:   '#1e3f3e',

  // 玻璃灰（玻璃幕墙 / 混凝土）
  glass:      '#8a95ab',
  glassLt:    '#b3bccc',
  glassDk:    '#5b6479',
  glassDeep:  '#3d4457',

  // 霓虹青（夜景灯光）
  neon:       '#3fc6c6',
  neonLt:     '#7fe3e3',
  neonDk:     '#259a9a',

  // 宣纸米白（主文字 / 高光）
  paper:      '#f2e6cf',
  paperDk:    '#d3c4a8',
  paperDeep:  '#a8977c',

  // 琥珀（现金 / 金钱）
  amber:      '#f0a830',
  amberLt:    '#ffd070',
  amberDk:    '#b87a1c',

  // 天空四档（晨/午/黄昏/夜）
  skyDawn:    '#3b4a6b',
  skyDawnLt:  '#6b6f8c',
  skyNoon:    '#5b8fc4',
  skyNoonLt:  '#9dc4e0',
  skyDusk:    '#8c5a6b',
  skyDuskLt:  '#d98f6b',
  skyNight:   '#141a30',
  skyNightLt: '#2a3560',

  // 紫晶（监管机构专用色 —— 与四大集团色明确区分）
  purple:     '#a06cd5',
  purpleLt:   '#c39ae8',
  purpleDk:   '#6f42a0',
  purpleDeep: '#42265e',
};

/** 集团配色 —— 决定该集团全部 10 格建筑的色调与 HUD 标识 */
export const GROUP_COLORS = {
  bank:    { base: PALETTE.red,    lt: PALETTE.redLt,    dk: PALETTE.redDk,    accent: PALETTE.gold },
  broker:  { base: PALETTE.neon,   lt: PALETTE.neonLt,   dk: PALETTE.neonDk,   accent: PALETTE.glassLt },
  insurer: { base: PALETTE.jade,   lt: PALETTE.jadeLt,   dk: PALETTE.jadeDk,   accent: PALETTE.paper },
  asset:   { base: PALETTE.gold,   lt: PALETTE.goldLt,   dk: PALETTE.goldDk,   accent: PALETTE.navyLt },
};

/** 玩家色 —— 4 组，色相区分明显，全部取自受控色板派生 */
export const PLAYER_COLORS = [
  { main: PALETTE.amber,  lt: PALETTE.amberLt,  dk: PALETTE.amberDk,  name: '鎏金' },
  { main: PALETTE.neon,   lt: PALETTE.neonLt,   dk: PALETTE.neonDk,   name: '霓青' },
  { main: PALETTE.red,    lt: PALETTE.redLt,    dk: PALETTE.redDk,    name: '朱红' },
  { main: '#a06cd5',     lt: '#c39ae8',        dk: '#6f42a0',        name: '紫晶' },
];

/** 把 '#rrggbb' 转成 [r,g,b] */
export function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

/** 所有合法颜色集合，供像素绘制工具做校验 */
export const ALLOWED_COLORS = new Set(Object.values(PALETTE));

/** 校验一个颜色是否在调色板内（供自检使用） */
export function isAllowed(color) {
  return ALLOWED_COLORS.has(color);
}
