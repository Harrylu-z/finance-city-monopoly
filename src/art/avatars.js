/**
 * 玩家棋子 —— Q 版像素小人，职业装。
 *
 * 4 种经典形象（索引 0~3）：
 *   0 投资经理   —— 职业装 + 领带 + 手持研报
 *   1 银行家     —— 背公文包 + 圆帽
 *   2 老江湖     —— 金丝眼镜 + 花白头发 + 拐杖
 *   3 暴发户     —— 扛金锭 + 敞开西装
 *
 * 7 种金融职业专属形象（索引 7~13，见 src/art/career-pieces.js）：
 *   7 投行家 / 8 风控总监 / 9 精算师 / 10 量化研究员
 *  11 基金经理 / 12 交易员 / 13 赌王
 *
 * 尺寸 16×24，4 方向朝向（down/up/left/right），每方向 2 帧行走。
 */

import { PLAYER_COLORS } from '../core/palette.js';
import { makeCanvas, rect, hline, vline, outline } from './pixeldraw.js';
import { getCareerPieceSprites } from './career-pieces.js';

/** 职业棋子起始索引（>= 该索引走 career-pieces.js） */
export const CAREER_PIECE_START = 7;

/** 形象定义 */
export const AVATARS = [
  { id: 'manager',  name: '投资经理', desc: '西装革履，手里永远拿着研报' },
  { id: 'banker',   name: '银行家',   desc: '公文包不离手，走路带风' },
  { id: 'veteran',  name: '老江湖',   desc: '金丝眼镜看穿一切，稳如老狗' },
  { id: 'nouveau',  name: '暴发户',   desc: '扛着金锭，走路带金光' },
];

const W = 16;
const H = 24;
const avatarCache = new Map();

/** 生成棋子精灵集 */
export function getAvatarSprites(avatarIndex, colorIndex) {
  const key = `av${avatarIndex}_${colorIndex}`;
  if (avatarCache.has(key)) return avatarCache.get(key);

  // 职业专属形象（索引 >= 7）走独立的绘制器，接口完全一致
  if (avatarIndex >= CAREER_PIECE_START) {
    const set = getCareerPieceSprites(avatarIndex, colorIndex);
    avatarCache.set(key, set);
    return set;
  }

  const pc = PLAYER_COLORS[colorIndex % PLAYER_COLORS.length];
  const set = {
    down: [drawAvatar(avatarIndex, pc, 'down', 0), drawAvatar(avatarIndex, pc, 'down', 1)],
    up:   [drawAvatar(avatarIndex, pc, 'up', 0), drawAvatar(avatarIndex, pc, 'up', 1)],
    left: [drawAvatar(avatarIndex, pc, 'left', 0), drawAvatar(avatarIndex, pc, 'left', 1)],
    right:[drawAvatar(avatarIndex, pc, 'right', 0), drawAvatar(avatarIndex, pc, 'right', 1)],
    idle: drawAvatar(avatarIndex, pc, 'down', 0),
  };
  avatarCache.set(key, set);
  return set;
}

/** 绘制单个棋子帧 */
function drawAvatar(av, pc, dir, frame) {
  const cv = makeCanvas(W, H);
  const ctx = cv.getContext('2d');

  const cx = 8;
  const headTop = 3;
  const bodyTop = 11;
  const bodyBottom = 20;

  const skin = 'paperDeep';
  const skinDk = 'paper';

  // 影子
  rect(ctx, cx - 4, H - 3, 9, 2, 'ink');

  // 腿
  const legY = bodyBottom;
  const step = frame === 1 ? 1 : 0;
  if (dir === 'left' || dir === 'right') {
    rect(ctx, cx - 2, legY, 2, 4 - step, 'navyDk');
    rect(ctx, cx + 1, legY, 2, 4 - (1 - step), 'navyDk');
  } else {
    rect(ctx, cx - 3, legY, 2, 4 - step, 'navyDk');
    rect(ctx, cx + 1, legY, 2, 4 - (1 - step), 'navyDk');
  }
  rect(ctx, cx - 4, H - 3 - step, 3, 1, 'ink');
  rect(ctx, cx + 1, H - 3 - (1 - step), 3, 1, 'ink');

  // 躯干（西装）
  rect(ctx, cx - 4, bodyTop, 8, bodyBottom - bodyTop, pc.dk);
  vline(ctx, cx - 4, bodyTop, bodyBottom - bodyTop, pc.main);
  vline(ctx, cx + 3, bodyTop, bodyBottom - bodyTop, 'ink');

  // 衣领
  if (dir === 'up') {
    rect(ctx, cx - 2, bodyTop, 4, 2, pc.lt);
  } else {
    rect(ctx, cx - 2, bodyTop, 4, 1, 'paper');
    rect(ctx, cx - 1, bodyTop + 1, 2, 1, pc.lt);
  }

  // 领带
  if (dir !== 'up' && av !== 3) {
    rect(ctx, cx - 1, bodyTop + 2, 2, 4, pc.main);
    rect(ctx, cx - 1, bodyTop + 2, 1, 4, pc.lt);
  }

  // 手臂
  const armY = bodyTop + 1;
  const swing = frame ? 1 : 0;
  if (dir === 'left') {
    rect(ctx, cx - 6, armY + swing, 2, 5, pc.dk);
    rect(ctx, cx + 3, armY, 2, 5, pc.dk);
  } else if (dir === 'right') {
    rect(ctx, cx - 5, armY, 2, 5, pc.dk);
    rect(ctx, cx + 4, armY + swing, 2, 5, pc.dk);
  } else {
    rect(ctx, cx - 6, armY, 2, 5, pc.dk);
    rect(ctx, cx + 4, armY, 2, 5, pc.dk);
    rect(ctx, cx - 6, armY + swing, 2, 1, pc.main);
    rect(ctx, cx + 4, armY + swing, 2, 1, pc.main);
  }

  // 手
  const handY = armY + 4 + swing;
  rect(ctx, cx - 6, handY, 2, 2, skin);
  rect(ctx, cx + 4, handY, 2, 2, skin);

  // 头
  rect(ctx, cx - 4, headTop, 8, 8, skin);
  rect(ctx, cx - 4, headTop, 1, 8, skinDk);

  // 头发
  if (dir === 'up') {
    rect(ctx, cx - 4, headTop, 8, 5, hairColor(av));
    rect(ctx, cx - 4, headTop, 8, 1, hairHighlight(av));
  } else {
    rect(ctx, cx - 4, headTop, 8, 3, hairColor(av));
    rect(ctx, cx - 4, headTop, 8, 1, hairHighlight(av));
    rect(ctx, cx - 4, headTop + 3, 1, 2, hairColor(av));
    rect(ctx, cx + 3, headTop + 3, 1, 2, hairColor(av));
  }

  // 五官
  if (dir !== 'up') {
    if (dir === 'left') {
      rect(ctx, cx - 2, headTop + 4, 1, 1, 'ink');
    } else if (dir === 'right') {
      rect(ctx, cx + 1, headTop + 4, 1, 1, 'ink');
    } else {
      rect(ctx, cx - 2, headTop + 4, 1, 2, 'ink');
      rect(ctx, cx + 1, headTop + 4, 1, 2, 'ink');
    }
    rect(ctx, cx - 1, headTop + 6, 2, 1, 'redDk');
  }

  drawAccessory(ctx, av, pc, cx, headTop, bodyTop, dir, frame);

  outline(ctx, cx - 6, headTop, 12, H - headTop - 3, 'ink');
  return cv;
}

function hairColor(av) {
  switch (av) {
    case 2: return 'glassLt';
    case 3: return 'goldDk';
    default: return 'ink';
  }
}
function hairHighlight(av) {
  switch (av) {
    case 2: return 'paper';
    case 3: return 'gold';
    default: return 'glassDk';
  }
}

/** 形象专属配饰 */
function drawAccessory(ctx, av, pc, cx, headTop, bodyTop, dir, frame) {
  switch (av) {
    case 0: { // 投资经理：手持研报
      const fx = dir === 'left' ? cx - 7 : cx + 5;
      const fy = bodyTop + 6;
      rect(ctx, fx, fy, 3, 4, 'paper');
      rect(ctx, fx, fy, 3, 1, 'glass');
      hline(ctx, fx, fy + 2, 3, 'glassDk');
      break;
    }
    case 1: { // 银行家：圆帽 + 公文包
      rect(ctx, cx - 4, headTop - 2, 8, 2, 'navyDk');
      rect(ctx, cx - 5, headTop - 1, 10, 1, 'ink');
      const bx = dir === 'left' ? cx - 8 : cx + 6;
      rect(ctx, bx, bodyTop + 7, 3, 4, 'goldDk');
      rect(ctx, bx, bodyTop + 7, 3, 1, 'gold');
      rect(ctx, bx, bodyTop + 9, 3, 1, 'ink');
      vline(ctx, bx + 1, bodyTop + 6, 1, 'ink');
      break;
    }
    case 2: { // 老江湖：金丝眼镜 + 拐杖
      if (dir !== 'up') {
        rect(ctx, cx - 3, headTop + 4, 2, 2, 'goldLt');
        rect(ctx, cx + 1, headTop + 4, 2, 2, 'goldLt');
        rect(ctx, cx - 3, headTop + 4, 2, 1, 'paper');
        rect(ctx, cx + 1, headTop + 4, 2, 1, 'paper');
        hline(ctx, cx - 1, headTop + 4, 2, 'gold');
      }
      const sx = dir === 'left' ? cx - 7 : cx + 6;
      vline(ctx, sx, bodyTop + 5, 8, 'goldDk');
      rect(ctx, sx - 1, bodyTop + 3, 3, 2, 'gold');
      break;
    }
    case 3: { // 暴发户：敞开西装 + 金锭
      rect(ctx, cx - 3, bodyTop + 1, 6, 5, 'paper');
      rect(ctx, cx - 3, bodyTop + 1, 6, 1, 'goldLt');
      const gx = dir === 'left' ? cx - 8 : cx + 5;
      rect(ctx, gx, headTop + 1, 4, 3, 'gold');
      rect(ctx, gx, headTop + 1, 4, 1, 'goldLt');
      hline(ctx, gx, headTop + 3, 4, 'goldDk');
      break;
    }
    default: break;
  }
}

/**
 * 小图标版棋子 —— 保持立绘原始宽高比。
 *
 * 经典棋子是 16×24 像素小人，职业立绘是 32×40 矢量形象，
 * 这里直接沿用 sprite 的原生尺寸，避免把 32×40 压成 16×24 造成变形。
 */
export function getAvatarIcon(avatarIndex, colorIndex) {
  const key = `avi${avatarIndex}_${colorIndex}`;
  if (avatarCache.has(key)) return avatarCache.get(key);
  const sprites = getAvatarSprites(avatarIndex, colorIndex);
  const src = sprites.idle;
  const cv = makeCanvas(src.width, src.height);
  const ctx = cv.getContext('2d');
  // 矢量立绘用平滑缩放，像素棋子保持硬边
  ctx.imageSmoothingEnabled = src.width >= 32;
  ctx.drawImage(src, 0, 0);
  avatarCache.set(key, cv);
  return cv;
}

/**
 * 按玩家实际立绘尺寸生成一个「展示用」canvas 元素。
 *
 * ================== 为什么需要 ==================
 * 经典棋子是 16×24 像素画，职业立绘是 32×40 矢量形象 —— 尺寸与缩放方式都不同：
 *   · 像素画放大要 `image-rendering: pixelated`（保持硬边）；
 *   · 矢量立绘放大要平滑（否则边缘发虚）。
 * 散落在各处的 drawImage 很容易漏掉这个区分，这里统一封装。
 *
 * @param {object} player 玩家（含 avatar / colorIndex）
 * @param {number} [scale=2] 显示放大倍数
 * @param {'idle'|'down'} [frame='idle'] 取哪一帧
 * @returns {HTMLCanvasElement}
 */
export function makePlayerSpriteCanvas(player, scale = 2, frame = 'idle') {
  const sprites = getAvatarSprites(player?.avatar ?? 0, player?.colorIndex ?? 0);
  const src = frame === 'down' ? sprites.down[0] : sprites.idle;
  const sw = src.width;
  const sh = src.height;
  // 矢量立绘（宽 ≥32）用平滑缩放；像素棋子（宽 16）保持硬边
  const isVector = sw >= 32;

  const cv = document.createElement('canvas');
  cv.width = sw * scale;
  cv.height = sh * scale;
  cv.style.width = `${sw * scale}px`;
  cv.style.height = `${sh * scale}px`;
  cv.style.imageRendering = isVector ? 'auto' : 'pixelated';
  cv.style.flex = 'none';

  const ctx = cv.getContext('2d');
  ctx.imageSmoothingEnabled = isVector;
  ctx.drawImage(src, 0, 0, cv.width, cv.height);
  return cv;
}

/**
 * 判断一个精灵是否是矢量立绘（宽 ≥32）—— 供调用方决定缩放方式。
 */
export function isVectorSprite(sprite) {
  return !!sprite && sprite.width >= 32;
}
