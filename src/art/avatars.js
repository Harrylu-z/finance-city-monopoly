/**
 * 玩家棋子立绘 —— **统一由职业决定，用户不可自由选择**。
 *
 * ================== 变更说明 ==================
 * 旧版：开局界面提供「选择棋子形象」（4 种经典像素小人，索引 0~3），
 *       玩家可任选外观，与职业无关。
 *
 * 新版：删除形象选择功能。**职业与立绘一一对应**：
 *   · 7 种金融职业专属矢量立绘（索引 7~13，见 src/art/career-pieces.js）：
 *       7 投行家 / 8 风控总监 / 9 精算师 / 10 量化研究员
 *       11 基金经理 / 12 交易员 / 13 赌王
 *   · 规则层（`src/core/rules.js`）在建局时按 `careerId` 直接解析出 `pieceIndex`，
 *       本文件只负责按索引取到对应的精灵集。
 *
 * 由于经典像素小人（索引 0~3）已无任何玩家会用到，相关绘制代码一并移除，
 * 避免留下死代码。立绘原生尺寸为 32×40（矢量），4 方向（down/up/left/right）× 2 帧。
 *
 * ================== 保留的通用能力 ==================
 * `getAvatarIcon` / `makePlayerSpriteCanvas` 是**通用头像展示**工具
 * （HUD、排行榜、扑克座位、玩家详情弹窗都在用），与「形象选择」功能无关，
 * 全部保留。
 */

import { makeCanvas } from './pixeldraw.js';
import { getCareerPieceSprites } from './career-pieces.js';

/** 职业立绘起始索引（>= 该索引走 career-pieces.js） */
export const CAREER_PIECE_START = 7;

const avatarCache = new Map();

/**
 * 取得棋子精灵集。
 *
 * @param {number} avatarIndex 职业立绘索引（7~13）
 * @param {number} colorIndex 玩家配色索引
 */
export function getAvatarSprites(avatarIndex, colorIndex) {
  const key = `av${avatarIndex}_${colorIndex}`;
  if (avatarCache.has(key)) return avatarCache.get(key);

  const set = getCareerPieceSprites(avatarIndex, colorIndex);
  avatarCache.set(key, set);
  return set;
}

/**
 * 小图标版棋子立绘 —— 保持立绘原始宽高比（32×40）。
 */
export function getAvatarIcon(avatarIndex, colorIndex) {
  const key = `avi${avatarIndex}_${colorIndex}`;
  if (avatarCache.has(key)) return avatarCache.get(key);
  const sprites = getAvatarSprites(avatarIndex, colorIndex);
  const src = sprites.idle;
  const cv = makeCanvas(src.width, src.height);
  const ctx = cv.getContext('2d');
  ctx.imageSmoothingEnabled = true;   // 矢量立绘用平滑缩放
  ctx.drawImage(src, 0, 0);
  avatarCache.set(key, cv);
  return cv;
}

/**
 * 按玩家实际立绘尺寸生成一个「展示用」canvas 元素。
 *
 * ================== 为什么需要 ==================
 * 职业立绘是 32×40 矢量形象，放大要平滑（否则边缘发虚）；
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

  const cv = document.createElement('canvas');
  cv.width = sw * scale;
  cv.height = sh * scale;
  cv.style.width = `${sw * scale}px`;
  cv.style.height = `${sh * scale}px`;
  cv.style.imageRendering = 'auto';
  cv.style.flex = 'none';

  const ctx = cv.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(src, 0, 0, cv.width, cv.height);
  return cv;
}
