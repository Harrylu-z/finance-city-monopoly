/**
 * 职业形象 —— 矢量立绘（SVG 源码 + Canvas 光栅化）。
 *
 * ================== 为什么改成矢量 ==================
 * 旧版职业棋子是 16×24 的像素小人（src/art/career-pieces.js 原实现）。
 * 在棋盘上只占 16~24px，像素一压就糊成一团色块，
 * **完全看不出职业**（投行家和基金经理几乎无法区分）。
 *
 * 新版改为「清晰的矢量角色立绘 / 头像」：
 *   · 每种职业有**轮廓分明的头部 + 标志性道具**，即使缩到 24px 高也能辨形；
 *   · 用 SVG path 描述形状（圆/椭圆/路径），由浏览器矢量光栅化，
 *     天然抗锯齿、任意缩放不糊；
 *   · 服装主色取玩家色（区分归属），道具与配色取自受限色板，
 *     保证与整体视觉统一。
 *
 * ================== 与既有渲染管线的关系 ==================
 * 对外接口与旧版**完全一致**：
 *   getCareerPieceSprites(pieceIndex, colorIndex) → { down, up, left, right, idle }
 *   getCareerPieceIcon(pieceIndex, colorIndex)    → HTMLCanvasElement
 * 因此 `src/art/avatars.js`（棋子分发）、`src/render/canvas.js`（棋盘渲染）、
 * `src/app/main.js`（职业选择器）、`src/app/dialogs.js`（排行榜）都无需改动。
 *
 * 尺寸：原生 32×40（比旧版更大，细节更足），
 *       棋盘上由 render/canvas.js 的 tokenScale 整数倍缩放。
 */

import { PLAYER_COLORS } from '../core/palette.js';

/** 原生立绘尺寸（宽 × 高） */
export const PORTRAIT_W = 32;
export const PORTRAIT_H = 40;

/** 职业棋子索引 → 立绘定义 */
export const CAREER_PORTRAITS = {
  7: { id: 'ib', name: '投行家' },
  8: { id: 'risk', name: '风控总监' },
  9: { id: 'actuary', name: '精算师' },
  10: { id: 'quant', name: '量化研究员' },
  11: { id: 'fund', name: '基金经理' },
  12: { id: 'trader', name: '交易员' },
  13: { id: 'king', name: '赌王' },
};

/* ===================================================================
 * 调色板（受限色板内的固定色）
 * =================================================================== */
const C = {
  ink: '#151a26',
  panel: '#1e2436',
  paper: '#f6efe0',
  paperDk: '#ded5c2',
  skin: '#f0d2b4',
  skinDk: '#d3ab86',
  hairDark: '#2b2f3d',
  hairGrey: '#b9b3a4',
  gold: '#e8a93c',
  goldLt: '#ffc861',
  goldDk: '#9a6a1c',
  red: '#c8392b',
  redLt: '#e4604d',
  redDk: '#8d2419',
  glass: '#4a5266',
  glassDk: '#3a4256',
  glassLt: '#6b7488',
  neon: '#3fc6c6',
  neonLt: '#7fe3e3',
  jade: '#4f9d55',
  jadeLt: '#7ac77f',
  jadeDk: '#336b38',
  purple: '#8b5cc7',
  purpleLt: '#b189e0',
};

/* ===================================================================
 * 对外接口
 * =================================================================== */

const cache = new Map();

/**
 * 取得职业立绘精灵集（与 getAvatarSprites 同结构）。
 * @param {number} pieceIndex 7~13
 * @param {number} colorIndex 玩家配色索引
 */
export function getCareerPieceSprites(pieceIndex, colorIndex) {
  const key = `cp${pieceIndex}_${colorIndex}`;
  if (cache.has(key)) return cache.get(key);

  const pc = PLAYER_COLORS[colorIndex % PLAYER_COLORS.length];
  const svg = buildPortraitSvg(pieceIndex, pc);
  const base = svgToCanvas(svg);

  // 4 个朝向：正面（down）、背面（up）、左/右。
  // 左右朝向是**两份独立 SVG**（side 与其水平镜像 sideRight），
  // 这样各自独立解码，不存在「镜像画布在源图解码前就空白」的时序问题。
  const down = base;
  const up = svgToCanvas(buildPortraitSvg(pieceIndex, pc, 'up'));
  const left = svgToCanvas(buildPortraitSvg(pieceIndex, pc, 'side'));
  const right = svgToCanvas(buildPortraitSvg(pieceIndex, pc, 'sideRight'));

  const set = {
    down: [down, down],
    up: [up, up],
    left: [left, left],
    right: [right, right],
    idle: down,
  };
  cache.set(key, set);
  return set;
}

/**
 * 小图标版职业立绘（职业选择器 / 排行榜使用）。
 *
 * ================== 每次返回**独立**元素 ==================
 * 同一个职业可能被放到多个容器里（选择器 / 排行榜 / 预览），
 * 若返回缓存的同一个 DOM 节点，第二个 `appendChild` 会把它**搬走**，
 * 导致第一个容器里凭空消失。因此这里每次都新建一份 canvas。
 */
export function getCareerPieceIcon(pieceIndex, colorIndex) {
  const sprites = getCareerPieceSprites(pieceIndex, colorIndex);
  const cv = document.createElement('canvas');
  cv.width = PORTRAIT_W;
  cv.height = PORTRAIT_H;
  const ctx = cv.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(sprites.idle, 0, 0);
  // 立绘尚未解码时，idle canvas 会在图片 load 后被重绘 —— 图标也需同步
  registerFollower(sprites.idle, cv);
  return cv;
}

/**
 * 登记「跟随 canvas」：当来源精灵在图片解码后被重绘时，同步重绘跟随者。
 *
 * @param {HTMLCanvasElement} source
 * @param {HTMLCanvasElement} follower
 * @param {{mirror?:boolean}} [opts] mirror=true 时水平镜像（用于左右朝向）
 */
const followers = new WeakMap();

function registerFollower(source, follower, opts = {}) {
  let list = followers.get(source);
  if (!list) {
    list = [];
    followers.set(source, list);
  }
  list.push({ cv: follower, opts });
  // 若来源已经有内容（图片已解码），立刻补一次绘制 ——
  // 否则当来源在 registerFollower **之前**就已解码完成，跟随者会永远空白。
  if (followerHasContent(source)) paintFollower(source, follower, opts);
}

/** canvas 是否已有可见内容（抽样若干像素判断） */
function followerHasContent(cv) {
  try {
    const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 0) return true;
  } catch { /* ignore */ }
  return false;
}

/** 把 source 画进 follower（可选镜像） */
function paintFollower(source, follower, opts) {
  const c = follower.getContext('2d');
  c.clearRect(0, 0, follower.width, follower.height);
  c.imageSmoothingEnabled = true;
  if (opts.mirror) {
    c.save();
    c.translate(follower.width, 0);
    c.scale(-1, 1);
    c.drawImage(source, 0, 0, follower.width, follower.height);
    c.restore();
  } else {
    c.drawImage(source, 0, 0, follower.width, follower.height);
  }
}

/** 同步重绘某个精灵的全部跟随者 */
function repaintFollowers(source) {
  const list = followers.get(source);
  if (!list || !list.length) return;
  for (const { cv, opts } of list) paintFollower(source, cv, opts);
}

/**
 * 职业立绘「差异指纹」—— 用于自检断言 7 张形象两两不同。
 * 采样缩小后的像素（避免字体/抗锯齿造成的不稳定），保证可复现。
 */
export function pieceSignature(pieceIndex, colorIndex = 0) {
  const sprites = getCareerPieceSprites(pieceIndex, colorIndex);
  const src = sprites.idle;
  const S = 16;
  const cv = document.createElement('canvas');
  cv.width = S;
  cv.height = Math.round(S * (src.height / src.width));
  const ctx = cv.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(src, 0, 0, cv.width, cv.height);
  const data = ctx.getImageData(0, 0, cv.width, cv.height).data;
  const sig = [];
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    sig.push(`${(i / 4) % cv.width},${Math.floor(i / 4 / cv.width)}:${data[i]},${data[i + 1]},${data[i + 2]}`);
  }
  return sig.join('|');
}

/* ===================================================================
 * SVG 构造
 * =================================================================== */

/**
 * 生成某职业的立绘 SVG 字符串。
 *
 * @param {number} pieceIndex 7~13
 * @param {object} pc 玩家配色 { main, lt, dk }
 * @param {'front'|'up'|'side'|'sideRight'} [view='front']
 *        'sideRight' = 侧脸的**水平镜像**版本（用 SVG transform 实现，
 *        这样左右朝向是两份**独立**的 SVG，解码时序互不影响）。
 */
export function buildPortraitSvg(pieceIndex, pc, view = 'front') {
  const p = CAREER_PORTRAITS[pieceIndex];
  if (!p) return '';
  const actualView = view === 'sideRight' ? 'side' : view;
  const body = (PORTRAIT_BUILDERS[p.id] || PORTRAIT_BUILDERS.ib)(pc, actualView);
  const content = view === 'sideRight'
    ? `<g transform="translate(${PORTRAIT_W} 0) scale(-1 1)">${body}</g>`
    : body;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${PORTRAIT_W}" height="${PORTRAIT_H}"`,
    ` viewBox="0 0 ${PORTRAIT_W} ${PORTRAIT_H}">`,
    content,
    '</svg>',
  ].join('');
}

/**
 * SVG → canvas（走浏览器的矢量光栅化，天然抗锯齿）。
 *
 * ================== 为什么要「挂回调重绘」 ==================
 * `img.src = dataURI` 之后图片是**异步解码**的，
 * 立刻 `drawImage(img, …)` 在尚未解码时是**静默无操作**（不抛错、也不画东西）。
 * 这会让棋盘上的职业棋子一开局就「消失」，直到某次意外重绘才出现。
 *
 * 解决办法：
 *   · 维护一张 `svg → { img, targets:Set<canvas> }` 的表；
 *   · 每张目标 canvas 登记自己，图片 `load` 事件触发时统一重绘；
 *   · 同时提供 `ensurePortraitsReady()`，在开局前主动 await 全部解码完成，
 *     保证第一帧就有正确的棋子。
 */
function svgToCanvas(svg) {
  const cv = document.createElement('canvas');
  cv.width = PORTRAIT_W;
  cv.height = PORTRAIT_H;
  const ctx = cv.getContext('2d');
  ctx.imageSmoothingEnabled = true;

  const entry = svgImageEntry(svg);
  entry.targets.add(cv);
  // 若已解码完成，直接画一次（解码失败的条目跳过，避免对 broken 图片 drawImage）
  if (entry.loaded && !entry.failed) {
    ctx.drawImage(entry.img, 0, 0, PORTRAIT_W, PORTRAIT_H);
  }
  return cv;
}

/** SVG 源码 → { img, loaded, targets:Set<canvas> }（按源码缓存，同职业同色只解码一次） */
const svgImages = new Map();

function svgImageEntry(svg) {
  let entry = svgImages.get(svg);
  if (entry) return entry;

  const img = new Image();
  entry = { img, loaded: false, failed: false, targets: new Set(), pending: [] };
  svgImages.set(svg, entry);

  entry.pending.push(new Promise((resolve) => {
    // 解码成功 → 把 SVG 画进所有目标 canvas
    const onLoad = () => {
      if (entry.loaded) return;
      entry.loaded = true;
      for (const cv of entry.targets) {
        const c = cv.getContext('2d');
        c.clearRect(0, 0, cv.width, cv.height);
        c.imageSmoothingEnabled = true;
        c.drawImage(img, 0, 0, PORTRAIT_W, PORTRAIT_H);
        // 同步刷新跟随此 canvas 的图标 / 副本
        repaintFollowers(cv);
      }
      resolve();
    };
    // 解码失败 → **不要**去 drawImage（图片处于 broken 状态，
    // drawImage 会抛 InvalidStateError）。留空 canvas 即可，
    // 游戏继续运行，只是这一个立绘缺失。
    const onError = () => {
      if (entry.loaded) return;
      entry.loaded = true;
      entry.failed = true;
      resolve();
    };
    img.addEventListener('load', onLoad);
    img.addEventListener('error', onError);
  }));

  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  return entry;
}

/**
 * 等待所有职业立绘解码完成 —— 开局前调用，保证首帧即有图。
 * @returns {Promise<void>}
 */
export function ensurePortraitsReady(pieceIndexes = Object.keys(CAREER_PORTRAITS).map(Number)) {
  const pc = PLAYER_COLORS[0];
  const promises = [];
  for (const idx of pieceIndexes) {
    for (const view of ['front', 'up', 'side', 'sideRight']) {
      const svg = buildPortraitSvg(idx, pc, view);
      if (!svg) continue;
      const entry = svgImageEntry(svg);
      promises.push(entry.pending[0]);
    }
  }
  return Promise.all(promises).then(() => undefined);
}

/** 水平镜像一张 canvas */
function mirrorCanvas(src) {
  const cv = document.createElement('canvas');
  cv.width = src.width;
  cv.height = src.height;
  const ctx = cv.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.translate(src.width, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(src, 0, 0);
  return cv;
}
/* ===================================================================
 * 立绘构件
 * =================================================================== */

/**
 * 通用构件：肩部以上（头像 + 西装肩线）。
 * 返回一串 SVG 片段。
 */
function bust(pc, opts = {}) {
  const {
    hair = C.hairDark,
    hairStyle = 'short',
    skin = C.skin,
    face = 'front',
    tie = 'long',
    tieColor = pc.main,
    accessory = '',
    prop = '',
    glasses = '',
    beard = '',
  } = opts;

  const cx = PORTRAIT_W / 2;
  const headCx = cx;
  const headCy = 15;
  const headRx = 8.2;
  const headRy = 9.2;

  const parts = [];

  // ---------- 肩 / 躯干 ----------
  // 西装轮廓：梯形肩线 + 深色描边，保证在浅色地块上也有边界
  parts.push(`<path d="M${cx - 13.5} ${PORTRAIT_H} L${cx - 13.5} ${PORTRAIT_H - 8.5}`
    + ` Q${cx - 13} ${PORTRAIT_H - 14.5} ${cx - 5.5} ${PORTRAIT_H - 16.5}`
    + ` L${cx + 5.5} ${PORTRAIT_H - 16.5}`
    + ` Q${cx + 13} ${PORTRAIT_H - 14.5} ${cx + 13.5} ${PORTRAIT_H - 8.5}`
    + ` L${cx + 13.5} ${PORTRAIT_H} Z"`
    + ` fill="${pc.dk}" stroke="${C.ink}" stroke-width="1"/>`);
  // 左肩高光
  parts.push(`<path d="M${cx - 13.5} ${PORTRAIT_H} L${cx - 13.5} ${PORTRAIT_H - 8.5}`
    + ` Q${cx - 13} ${PORTRAIT_H - 14.5} ${cx - 5.5} ${PORTRAIT_H - 16.5}`
    + ` L${cx - 4} ${PORTRAIT_H - 16.5}`
    + ` Q${cx - 10.5} ${PORTRAIT_H - 14} ${cx - 11} ${PORTRAIT_H - 8}`
    + ` L${cx - 11} ${PORTRAIT_H} Z" fill="${pc.main}" opacity="0.85"/>`);

  // 衬衫 V 领
  parts.push(`<path d="M${cx - 5.5} ${PORTRAIT_H - 16.5} L${cx} ${PORTRAIT_H - 8.5}`
    + ` L${cx + 5.5} ${PORTRAIT_H - 16.5} Z" fill="${C.paper}" stroke="${C.ink}" stroke-width="0.6"/>`);

  // 领带
  if (face === 'back') {
    // 背面：只有领口
  } else if (tie === 'bow') {
    // 领结（赌王）
    parts.push(`<path d="M${cx - 3.6} ${PORTRAIT_H - 15.2} L${cx - 0.4} ${PORTRAIT_H - 13.6}`
      + ` L${cx - 3.6} ${PORTRAIT_H - 12} Z" fill="${C.red}" stroke="${C.ink}" stroke-width="0.6"/>`);
    parts.push(`<path d="M${cx + 3.6} ${PORTRAIT_H - 15.2} L${cx + 0.4} ${PORTRAIT_H - 13.6}`
      + ` L${cx + 3.6} ${PORTRAIT_H - 12} Z" fill="${C.red}" stroke="${C.ink}" stroke-width="0.6"/>`);
    parts.push(`<circle cx="${cx}" cy="${PORTRAIT_H - 13.6}" r="1.3" fill="${C.redLt}"`
      + ` stroke="${C.ink}" stroke-width="0.5"/>`);
  } else {
    // 长领带
    parts.push(`<path d="M${cx - 1.5} ${PORTRAIT_H - 14.8} L${cx + 1.5} ${PORTRAIT_H - 14.8}`
      + ` L${cx + 1.1} ${PORTRAIT_H - 5.5} L${cx - 1.1} ${PORTRAIT_H - 5.5} Z"`
      + ` fill="${tieColor}" stroke="${C.ink}" stroke-width="0.6"/>`);
    parts.push(`<path d="M${cx - 1.5} ${PORTRAIT_H - 14.8} L${cx - 0.4} ${PORTRAIT_H - 14.8}`
      + ` L${cx - 0.4} ${PORTRAIT_H - 5.5} L${cx - 1.1} ${PORTRAIT_H - 5.5} Z"`
      + ` fill="${pc.lt}" opacity="0.7"/>`);
  }

  // ---------- 脖子 ----------
  parts.push(`<rect x="${headCx - 2.6}" y="${headCy + headRy - 2.5}" width="5.2" height="4.2"`
    + ` fill="${skin}" stroke="${C.ink}" stroke-width="0.7"/>`);

  // ---------- 头 ----------
  // 侧脸时把整颗头左移，让五官（鼻梁、嘴）落在画面右侧 —— 形成真正的**侧向剪影**。
  // 这样左右朝向互为镜像且**确实不同**，玩家一眼能看出角色面朝哪边。
  const hx = face === 'side' ? headCx - 2.6 : headCx;
  parts.push(`<ellipse cx="${hx}" cy="${headCy}" rx="${headRx}" ry="${headRy}"`
    + ` fill="${skin}" stroke="${C.ink}" stroke-width="1.1"/>`);
  // 面部暗侧（体积感）
  parts.push(`<path d="M${hx + 1.6} ${headCy - headRy + 0.6}`
    + ` A${headRx} ${headRy} 0 0 1 ${hx + 1.6} ${headCy + headRy - 0.6}`
    + ` L${hx + 4.6} ${headCy + headRy - 0.6}`
    + ` A${headRx + 2.6} ${headRy} 0 0 0 ${hx + 1.6} ${headCy - headRy + 0.6} Z"`
    + ` fill="${C.skinDk}" opacity="0.45"/>`);
  // 耳朵（侧脸只保留靠后的一只，前耳被脸部遮住）
  parts.push(`<ellipse cx="${hx - headRx + 0.4}" cy="${headCy + 1.6}" rx="1.5" ry="2.1"`
    + ` fill="${skin}" stroke="${C.ink}" stroke-width="0.7"/>`);
  if (face !== 'side') {
    parts.push(`<ellipse cx="${hx + headRx - 0.4}" cy="${headCy + 1.6}" rx="1.5" ry="2.1"`
      + ` fill="${skin}" stroke="${C.ink}" stroke-width="0.7"/>`);
  } else {
    // 侧脸：耳朵移到头后（画面左侧）
    parts.push(`<ellipse cx="${hx - headRx + 0.2}" cy="${headCy + 1.4}" rx="1.4" ry="2.0"`
      + ` fill="${skin}" stroke="${C.ink}" stroke-width="0.7"/>`);
  }

  // ---------- 五官 ----------
  if (face === 'front') {
    // 眉毛
    parts.push(`<rect x="${hx - 4.4}" y="${headCy - 2.6}" width="3" height="1" rx="0.5" fill="${C.ink}"/>`);
    parts.push(`<rect x="${hx + 1.4}" y="${headCy - 2.6}" width="3" height="1" rx="0.5" fill="${C.ink}"/>`);
    // 眼睛
    parts.push(`<ellipse cx="${hx - 2.9}" cy="${headCy + 0.1}" rx="1.35" ry="1.55" fill="${C.ink}"/>`);
    parts.push(`<ellipse cx="${hx + 2.9}" cy="${headCy + 0.1}" rx="1.35" ry="1.55" fill="${C.ink}"/>`);
    parts.push(`<circle cx="${hx - 2.5}" cy="${headCy - 0.5}" r="0.45" fill="${C.paper}"/>`);
    parts.push(`<circle cx="${hx + 3.3}" cy="${headCy - 0.5}" r="0.45" fill="${C.paper}"/>`);
    // 鼻
    parts.push(`<path d="M${hx - 0.5} ${headCy + 0.4} L${hx + 0.8} ${headCy + 2.4}`
      + ` L${hx - 0.9} ${headCy + 2.5}" fill="none" stroke="${C.skinDk}" stroke-width="0.9"`
      + ` stroke-linecap="round" stroke-linejoin="round"/>`);
    // 嘴
    parts.push(`<path d="M${hx - 2.4} ${headCy + 5.2} Q${hx} ${headCy + 6.6} ${hx + 2.4} ${headCy + 5.2}"`
      + ` fill="none" stroke="${C.ink}" stroke-width="0.9" stroke-linecap="round"/>`);
  } else if (face === 'side') {
    // 侧脸：一只眼睛 + 鼻梁 + 嘴（全部落在画面右缘 → 明确的侧向剪影）
    parts.push(`<rect x="${hx + 1.2}" y="${headCy - 2.6}" width="3" height="1" rx="0.5" fill="${C.ink}"/>`);
    parts.push(`<ellipse cx="${hx + 3}" cy="${headCy + 0.2}" rx="1.3" ry="1.5" fill="${C.ink}"/>`);
    parts.push(`<circle cx="${hx + 3.4}" cy="${headCy - 0.4}" r="0.42" fill="${C.paper}"/>`);
    parts.push(`<path d="M${hx + 5.4} ${headCy - 0.4} L${hx + 7.6} ${headCy + 1.4}`
      + ` L${hx + 5.2} ${headCy + 1.9}" fill="none" stroke="${C.skinDk}" stroke-width="0.9"`
      + ` stroke-linecap="round" stroke-linejoin="round"/>`);
    parts.push(`<path d="M${hx + 4.6} ${headCy + 4.6} Q${hx + 6} ${headCy + 5.2} ${hx + 6.4} ${headCy + 3.9}"`
      + ` fill="none" stroke="${C.ink}" stroke-width="0.9" stroke-linecap="round"/>`);
  }

  if (beard) parts.push(beard);

  // ---------- 眼镜 ----------
  if (glasses) parts.push(glasses);

  // ---------- 头发 ----------
  parts.push(hairLayer(hairStyle, hair, hx, headCy, headRx, headRy, face));

  // ---------- 职业专属道具 / 配饰 ----------
  if (accessory) parts.push(accessory);
  if (prop) parts.push(prop);

  return parts.join('');
}

/** 头发层 —— 5 种发型，靠轮廓（不是靠颜色）区分职业 */
function hairLayer(style, hair, cx, cy, rx, ry, face) {
  switch (style) {
    case 'sidePart':   // 三七分背头 —— 投行家
      return `<path d="M${cx - rx - 0.5} ${cy - 1.5}`
        + ` Q${cx - rx - 0.7} ${cy - ry - 2.6} ${cx + 0.5} ${cy - ry - 2.2}`
        + ` Q${cx + rx + 0.4} ${cy - ry - 1.6} ${cx + rx + 0.6} ${cy - 3.2}`
        + ` Q${cx + 4} ${cy - 5.6} ${cx - 1.6} ${cy - 5.2}`
        + ` Q${cx - 5.6} ${cy - 4.6} ${cx - rx - 0.5} ${cy - 1.5} Z"`
        + ` fill="${hair}" stroke="${C.ink}" stroke-width="0.8"/>`;
    case 'buzz':       // 板寸 —— 风控总监
      return `<path d="M${cx - rx - 0.3} ${cy - 2.2}`
        + ` Q${cx - rx - 0.3} ${cy - ry - 1.1} ${cx} ${cy - ry - 1.1}`
        + ` Q${cx + rx + 0.3} ${cy - ry - 1.1} ${cx + rx + 0.3} ${cy - 2.2}`
        + ` Q${cx + 5} ${cy - 4.8} ${cx} ${cy - 5}`
        + ` Q${cx - 5} ${cy - 4.8} ${cx - rx - 0.3} ${cy - 2.2} Z"`
        + ` fill="${hair}" stroke="${C.ink}" stroke-width="0.8"/>`;
    case 'parted':     // 中分 + 鬓角 —— 精算师
      return `<path d="M${cx - rx - 0.6} ${cy + 1}`
        + ` Q${cx - rx - 0.6} ${cy - ry - 2.2} ${cx} ${cy - ry - 2.2}`
        + ` Q${cx + rx + 0.6} ${cy - ry - 2.2} ${cx + rx + 0.6} ${cy + 1}`
        + ` L${cx + rx + 0.2} ${cy - 1.6} Q${cx + 4} ${cy - 3.4} ${cx} ${cy - 1.4}`
        + ` Q${cx - 4} ${cy - 3.4} ${cx - rx - 0.2} ${cy - 1.6} Z"`
        + ` fill="${hair}" stroke="${C.ink}" stroke-width="0.8"/>`
        + `<rect x="${cx - rx - 0.5}" y="${cy - 1}" width="1.8" height="4" fill="${hair}"/>`
        + `<rect x="${cx + rx - 1.3}" y="${cy - 1}" width="1.8" height="4" fill="${hair}"/>`;
    case 'mop':        // 蓬松短发 —— 量化研究员
      return `<path d="M${cx - rx - 1.4} ${cy - 0.4}`
        + ` Q${cx - rx - 1.2} ${cy - ry - 3.4} ${cx - 3} ${cy - ry - 2.4}`
        + ` Q${cx - 1} ${cy - ry - 3.8} ${cx + 1.6} ${cy - ry - 2.4}`
        + ` Q${cx + 4.4} ${cy - ry - 3.2} ${cx + rx + 1.4} ${cy - 0.4}`
        + ` Q${cx + 6} ${cy - 4.4} ${cx + 2.4} ${cy - 4.8}`
        + ` Q${cx - 2} ${cy - 5.2} ${cx - 5.4} ${cy - 3.6}`
        + ` Q${cx - 7.4} ${cy - 3} ${cx - rx - 1.4} ${cy - 0.4} Z"`
        + ` fill="${hair}" stroke="${C.ink}" stroke-width="0.8"/>`;
    case 'greySide':   // 花白侧分 —— 基金经理
      return `<path d="M${cx - rx - 0.7} ${cy - 0.6}`
        + ` Q${cx - rx - 0.7} ${cy - ry - 2.4} ${cx + 0.6} ${cy - ry - 2}`
        + ` Q${cx + rx + 0.4} ${cy - ry - 1.6} ${cx + rx + 0.6} ${cy - 2.4}`
        + ` Q${cx + 3.4} ${cy - 4.8} ${cx - 2.2} ${cy - 4.4}`
        + ` Q${cx - 5.8} ${cy - 4} ${cx - rx - 0.7} ${cy - 0.6} Z"`
        + ` fill="${hair}" stroke="${C.ink}" stroke-width="0.8"/>`
        + `<path d="M${cx - rx + 0.4} ${cy - 4.2} Q${cx - 2} ${cy - 6.2} ${cx + 2.6} ${cy - 5.2}"`
        + ` fill="none" stroke="${C.paper}" stroke-width="0.9" opacity="0.75"/>`;
    case 'cap':        // 反戴鸭舌帽 —— 交易员
      return `<path d="M${cx - rx - 1.6} ${cy - 3.4} Q${cx - rx - 1.4} ${cy - ry - 3.6} ${cx} ${cy - ry - 3.2}`
        + ` Q${cx + rx + 1.4} ${cy - ry - 3.4} ${cx + rx + 1.6} ${cy - 3.4}`
        + ` L${cx + rx + 1.6} ${cy - 2} L${cx - rx - 1.6} ${cy - 2} Z"`
        + ` fill="${C.gold}" stroke="${C.ink}" stroke-width="0.9"/>`
        + `<path d="M${cx - rx - 1.6} ${cy - 2.6} Q${cx} ${cy - 4.4} ${cx + rx + 1.6} ${cy - 2.6}`
        + ` L${cx + rx + 1.6} ${cy - 2} L${cx - rx - 1.6} ${cy - 2} Z" fill="${C.goldLt}"/>`
        // 后脑勺反戴的帽檐
        + `<path d="M${cx - rx - 1.2} ${cy - 3.2} L${cx - rx - 1.2} ${cy - 1}`
        + ` Q${cx - rx - 3.6} ${cy - 0.4} ${cx - rx - 3.8} ${cy - 2.4}`
        + ` L${cx - rx - 3.8} ${cy - 3.4} Z" fill="${C.goldDk}" stroke="${C.ink}" stroke-width="0.8"/>`;
    case 'fedora':     // 礼帽 —— 赌王
      return `<path d="M${cx - rx - 4.6} ${cy - 4.6} Q${cx} ${cy - 6.6} ${cx + rx + 4.6} ${cy - 4.6}`
        + ` L${cx + rx + 4.6} ${cy - 2.8} Q${cx} ${cy - 0.8} ${cx - rx - 4.6} ${cy - 2.8} Z"`
        + ` fill="${C.ink}" stroke="${C.ink}" stroke-width="0.8"/>`
        + `<path d="M${cx - 6.4} ${cy - 5.6} L${cx - 6.4} ${cy - 10.4}`
        + ` Q${cx - 6.4} ${cy - 13.6} ${cx} ${cy - 13.6}`
        + ` Q${cx + 6.4} ${cy - 13.6} ${cx + 6.4} ${cy - 10.4}`
        + ` L${cx + 6.4} ${cy - 5.6} Z" fill="${C.ink}" stroke="${C.ink}" stroke-width="0.9"/>`
        + `<rect x="${cx - 6.6}" y="${cy - 8.2}" width="13.2" height="2.6" fill="${C.red}"/>`;
    default:
      return '';
  }
}

/* ===================================================================
 * 7 种职业立绘
 * =================================================================== */

const PORTRAIT_BUILDERS = {
  /** 投行家 —— 三七分背头 + 领带 + 手中承销文件夹 */
  ib(pc, view) {
    const face = view === 'up' ? 'back' : view === 'side' ? 'side' : 'front';
    const prop = view === 'up' ? '' : `
      <g transform="translate(20.5 25.5) rotate(-8)">
        <rect x="0" y="0" width="9" height="11" rx="0.8" fill="${C.paper}" stroke="${C.ink}" stroke-width="0.9"/>
        <rect x="0" y="0" width="9" height="2.6" rx="0.8" fill="${C.gold}" stroke="${C.ink}" stroke-width="0.7"/>
        <rect x="1.6" y="4.4" width="5.8" height="0.9" fill="${C.glass}"/>
        <rect x="1.6" y="6.4" width="4.4" height="0.9" fill="${C.glass}"/>
        <rect x="1.6" y="8.4" width="5.8" height="0.9" fill="${C.glass}"/>
      </g>`;
    return bust(pc, { hairStyle: 'sidePart', hair: C.hairDark, face, prop });
  },

  /** 风控总监 —— 板寸 + 风控清单 + 胸前徽章 */
  risk(pc, view) {
    const face = view === 'up' ? 'back' : view === 'side' ? 'side' : 'front';
    const accessory = view === 'up' ? '' : `
      <g>
        <circle cx="16" cy="31" r="2.5" fill="${C.gold}" stroke="${C.ink}" stroke-width="0.9"/>
        <path d="M16 28.8 L16.9 30.6 L18.8 30.8 L17.4 32.1 L17.8 34 L16 33.1 L14.2 34 L14.6 32.1 L13.2 30.8 L15.1 30.6 Z"
              fill="${C.goldLt}"/>
      </g>`;
    const prop = view === 'up' ? '' : `
      <g transform="translate(1.5 26) rotate(6)">
        <rect x="0" y="0" width="8.5" height="10.5" rx="0.8" fill="${C.red}" stroke="${C.ink}" stroke-width="0.9"/>
        <rect x="0.9" y="2" width="6.7" height="0.9" fill="${C.redLt}"/>
        <rect x="0.9" y="4.2" width="6.7" height="0.9" fill="${C.paper}"/>
        <rect x="0.9" y="6.2" width="4.6" height="0.9" fill="${C.paper}"/>
      </g>`;
    return bust(pc, { hairStyle: 'buzz', hair: C.hairDark, face, accessory, prop });
  },

  /** 精算师 —— 中分鬓角 + 金丝眼镜 + 计算器 */
  actuary(pc, view) {
    const face = view === 'up' ? 'back' : view === 'side' ? 'side' : 'front';
    const glasses = face === 'back' ? '' : `
      <g fill="none" stroke="${C.goldDk}" stroke-width="1">
        <circle cx="${16 - 3}" cy="15.1" r="2.5"/>
        <circle cx="${16 + 3}" cy="15.1" r="2.5"/>
        <path d="M${16 - 0.5} 15.1 L${16 + 0.5} 15.1"/>
      </g>
      <g fill="none" stroke="${C.goldDk}" stroke-width="0.8">
        ${face === 'side' ? `<path d="M13 15.1 L11.2 14.6"/>` : `<path d="M13 15.1 L10.8 14.8"/><path d="M19 15.1 L21.2 14.8"/>`}
      </g>`;
    const prop = view === 'up' ? '' : `
      <g transform="translate(21 26.5)">
        <rect x="0" y="0" width="8" height="10" rx="1" fill="${C.glassDk}" stroke="${C.ink}" stroke-width="0.9"/>
        <rect x="1.2" y="1.4" width="5.6" height="3" rx="0.4" fill="${C.neon}"/>
        <rect x="1.4" y="6" width="1.5" height="1.5" fill="${C.neonLt}"/>
        <rect x="4" y="6" width="1.5" height="1.5" fill="${C.paperDk}"/>
        <rect x="1.4" y="8.2" width="1.5" height="1.2" fill="${C.paperDk}"/>
        <rect x="4" y="8.2" width="1.5" height="1.2" fill="${C.paperDk}"/>
      </g>`;
    return bust(pc, { hairStyle: 'parted', hair: C.hairDark, face, glasses, prop });
  },

  /** 量化研究员 —— 蓬松短发 + 护目镜 + 发光终端 */
  quant(pc, view) {
    const face = view === 'up' ? 'back' : view === 'side' ? 'side' : 'front';
    const glasses = face === 'back' ? '' : `
      <g>
        <rect x="${16 - 7.4}" y="12.6" width="14.8" height="4.4" rx="2" fill="${C.glassDk}"
              stroke="${C.ink}" stroke-width="0.9"/>
        <rect x="${16 - 6.2}" y="13.6" width="5" height="2.4" rx="1" fill="${C.neon}" opacity="0.9"/>
        <rect x="${16 + 1.2}" y="13.6" width="5" height="2.4" rx="1" fill="${C.neon}" opacity="0.9"/>
      </g>`;
    const prop = view === 'up' ? '' : `
      <g transform="translate(20.5 26)">
        <rect x="0" y="0" width="9.5" height="11" rx="1" fill="${C.panel}" stroke="${C.ink}" stroke-width="0.9"/>
        <rect x="1.2" y="1.4" width="7.1" height="6.4" rx="0.5" fill="${C.glassDk}"/>
        <path d="M2.2 6.6 L3.6 4.4 L5 5.6 L7.4 2.8" fill="none" stroke="${C.neon}" stroke-width="1.1"
              stroke-linecap="round" stroke-linejoin="round"/>
        <rect x="1.6" y="9" width="6.3" height="0.9" fill="${C.neonLt}" opacity="0.8"/>
      </g>`;
    return bust(pc, { hairStyle: 'mop', hair: C.hairDark, face, glasses, prop });
  },

  /** 基金经理 —— 花白侧分 + 保温杯 + 围巾 */
  fund(pc, view) {
    const face = view === 'up' ? 'back' : view === 'side' ? 'side' : 'front';
    const accessory = view === 'up' ? '' : (
      '<g>'
      + `<path d="M${16 - 7} ${PORTRAIT_H - 17.4} Q${16} ${PORTRAIT_H - 13.4} ${16 + 7} ${PORTRAIT_H - 17.4}`
      + ` L${16 + 6.2} ${PORTRAIT_H - 15.6} Q${16} ${PORTRAIT_H - 11.8} ${16 - 6.2} ${PORTRAIT_H - 15.6} Z"`
      + ` fill="${C.jade}" stroke="${C.ink}" stroke-width="0.7"/>`
      + '</g>'
    );
    const prop = view === 'up' ? '' : `
      <g transform="translate(21 25.5)">
        <rect x="0" y="2" width="7" height="11" rx="1.6" fill="${C.jade}" stroke="${C.ink}" stroke-width="0.9"/>
        <rect x="0" y="2" width="7" height="2.6" rx="1.2" fill="${C.jadeLt}"/>
        <rect x="0" y="7" width="7" height="1.6" fill="${C.jadeDk}"/>
        <rect x="1.6" y="0" width="3.8" height="2.2" rx="0.6" fill="${C.glassDk}" stroke="${C.ink}" stroke-width="0.7"/>
      </g>`;
    return bust(pc, { hairStyle: 'greySide', hair: C.hairGrey, face, accessory, prop });
  },

  /** 交易员 —— 反戴鸭舌帽 + 耳麦 + 行情屏 */
  trader(pc, view) {
    const face = view === 'up' ? 'back' : view === 'side' ? 'side' : 'front';
    const accessory = face === 'back' ? '' : `
      <g fill="none" stroke="${C.glassDk}" stroke-width="1.5" stroke-linecap="round">
        <path d="M${16 + 6.4} 13.4 Q${16 + 9.6} 15.6 ${16 + 6.6} 18.4"/>
      </g>
      <rect x="${16 + 5.2}" y="17" width="3.4" height="4" rx="1.2" fill="${C.neon}" stroke="${C.ink}" stroke-width="0.8"/>`;
    const prop = view === 'up' ? '' : `
      <g transform="translate(19.5 25)">
        <rect x="0" y="0" width="10" height="11" rx="1" fill="${C.panel}" stroke="${C.ink}" stroke-width="0.9"/>
        <rect x="1.2" y="1.4" width="7.6" height="6.6" rx="0.5" fill="${C.glassDk}"/>
        <rect x="2" y="5.4" width="1.2" height="2" fill="${C.jadeLt}"/>
        <rect x="3.8" y="3.4" width="1.2" height="4" fill="${C.redLt}"/>
        <rect x="3.8" y="4.6" width="1.2" height="1.2" fill="${C.redLt}"/>
        <rect x="5.6" y="2.4" width="1.2" height="5" fill="${C.jadeLt}"/>
        <rect x="5.6" y="4" width="1.2" height="1.2" fill="${C.jadeLt}"/>
        <rect x="1.6" y="9" width="6.8" height="0.9" fill="${C.gold}" opacity="0.8"/>
      </g>`;
    return bust(pc, { hairStyle: 'cap', hair: C.hairDark, face, accessory, prop });
  },

  /** 赌王 —— 礼帽 + 油头 + 领结 + 扑克牌 */
  king(pc, view) {
    const face = view === 'up' ? 'back' : view === 'side' ? 'side' : 'front';
    const prop = view === 'up' ? '' : `
      <g transform="translate(19.8 26.5) rotate(10)">
        <rect x="0" y="0" width="8" height="10.5" rx="0.8" fill="${C.paper}" stroke="${C.ink}" stroke-width="0.9"/>
        <path d="M4 2 L5.4 5.2 L1 5.2 Z" fill="${C.red}"/>
        <path d="M4 8.6 L5.4 5.4 L1 5.4 Z" fill="${C.red}"/>
        <circle cx="4" cy="3.6" r="0.9" fill="${C.ink}"/>
      </g>`;
    // 油头：礼帽下露出的侧分油光
    const hair = `
      <path d="M9.6 8.4 Q16 4.4 22.4 8.4 Q18 9.6 14 8.8 Z"
            fill="${C.hairDark}" stroke="${C.ink}" stroke-width="0.7"/>
      <path d="M11 7.6 Q16 5.6 20.6 7.4" fill="none" stroke="${C.glassLt}" stroke-width="0.7" opacity="0.8"/>`;
    return bust(pc, {
      hairStyle: 'fedora',
      hair: C.hairDark,
      face,
      tie: 'bow',
      beard: face === 'front'
        ? `<path d="M11.2 19.4 Q16 25.6 20.8 19.4 Q19.4 23.4 16 23.6 Q12.6 23.4 11.2 19.4 Z"
                 fill="${C.hairDark}" opacity="0.85"/>`
        : '',
      prop,
    }) + hair;
  },
};

export { PORTRAIT_BUILDERS };
