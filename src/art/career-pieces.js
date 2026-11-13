/**
 * 职业棋子 —— 对外统一入口（**矢量立绘**，非像素风）。
 *
 * ================== 变更说明 ==================
 * 旧版：16×24 像素小人（`drawPiece` 手绘像素），在棋盘上缩到 1 倍时糊成色块，
 *       投行家 / 基金经理 / 交易员几乎无法区分，职业辨识度极低。
 *
 * 新版：改为**清晰的矢量角色立绘（SVG 光栅化）**——
 *   · 每种职业有独立的**发型轮廓 + 标志性道具**，缩到 24px 高仍可辨形；
 *   · 抗锯齿、任意缩放不糊，棋盘 / 选择器 / 排行榜三处观感一致；
 *   · 颜色仍取自受限色板 + 玩家色，与整体视觉统一。
 *
 * 具体的绘制实现全部在 `src/art/career-portraits.js`。
 * 本文件保留原有对外接口（`getCareerPieceSprites` / `getCareerPieceIcon` /
 * `pieceSignature`），因此调用方无需改动：
 *   · src/art/avatars.js        —— 棋子分发（索引 ≥7 走职业形象）
 *   · src/app/main.js           —— 职业选择器
 *   · src/app/dialogs.js        —— 排行榜
 *   · src/core/selftest.js      —— 形象自检
 *
 * ================== 与职业系统的对应关系 ==================
 * 职业与形象**一一对应**：`src/core/careers.js` 中 `CAREERS[].pieceIndex`
 * 指向 7~13 共 7 张专属立绘，同一职业永远使用同一张形象。
 */

import {
  getCareerPieceSprites as _sprites,
  getCareerPieceIcon as _icon,
  pieceSignature as _signature,
  buildPortraitSvg,
  ensurePortraitsReady,
  CAREER_PORTRAITS,
  PORTRAIT_W,
  PORTRAIT_H,
} from './career-portraits.js';

/** 立绘原生尺寸（宽 × 高） */
export const CAREER_PORTRAIT_SIZE = { w: PORTRAIT_W, h: PORTRAIT_H };

/**
 * 取得职业棋子精灵集（与 getAvatarSprites 同结构）。
 * @param {number} pieceIndex 7~13
 * @param {number} colorIndex 玩家配色索引
 */
export function getCareerPieceSprites(pieceIndex, colorIndex) {
  return _sprites(pieceIndex, colorIndex);
}

/** 小图标版职业立绘（职业选择器 / 排行榜使用） */
export function getCareerPieceIcon(pieceIndex, colorIndex) {
  return _icon(pieceIndex, colorIndex);
}

/**
 * 职业立绘「差异指纹」—— 供自检断言 7 张形象两两不同。
 */
export function pieceSignature(pieceIndex, colorIndex = 0) {
  return _signature(pieceIndex, colorIndex);
}

/**
 * 职业立绘的 SVG 源码 —— 供调试 / 导出使用。
 */
export { buildPortraitSvg, ensurePortraitsReady, CAREER_PORTRAITS };
