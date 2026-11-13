/**
 * 分享卡片 —— Canvas 绘制像素风战绩图，可下载 PNG。
 */

import { PALETTE, PLAYER_COLORS } from '../core/palette.js';
import { GROUP_COLORS } from '../core/palette.js';
import { makeCanvas, rect, hline, vline, strokeRect, outline } from '../art/pixeldraw.js';
import { getAvatarSprites } from '../art/avatars.js';
import { CAREERS } from '../core/careers.js';
import { drawMiniChar } from '../art/ui-icons.js';

/** 职业 id → 立绘索引（分享图里每位玩家都用自己的职业立绘） */
const CAREER_PIECE_BY_CAREER = Object.fromEntries(CAREERS.map((c) => [c.id, c.pieceIndex]));

const W = 480;
const H = 300;

/**
 * 绘制分享卡片
 * @param {HTMLCanvasElement} canvas
 * @param {object} data { title, players:[{name, assets, cash, count, colorIndex, avatar, isAI, personality}], boardCells, state }
 */
export function renderShareCard(canvas, data) {
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  // 背景
  rect(ctx, 0, 0, W, H, PALETTE.ink);
  rect(ctx, 0, 0, W, 42, PALETTE.navyDk);
  hline(ctx, 0, 42, W, PALETTE.goldDk);

  // 标题
  ctx.font = 'bold 17px "Microsoft YaHei", sans-serif';
  ctx.fillStyle = PALETTE.gold;
  ctx.textAlign = 'left';
  ctx.fillText(data.title || '中国金融城 · 战绩', 14, 26);
  ctx.font = '10px monospace';
  ctx.fillStyle = PALETTE.glass;
  ctx.textAlign = 'right';
  ctx.fillText(`SEED ${data.seed || '-'}`, W - 14, 25);
  ctx.textAlign = 'left';

  // 排行条
  const list = data.players || [];
  const barX = 14;
  const barY = 54;
  const barW = W - 28;
  const maxAssets = Math.max(1, ...list.map((p) => p.assets));

  list.slice(0, 4).forEach((p, i) => {
    const y = barY + i * 30;
    const pc = PLAYER_COLORS[p.colorIndex % PLAYER_COLORS.length];

    // 排名底条
    rect(ctx, barX, y, barW, 24, PALETTE.navy);
    // 资产比例条
    const w = Math.round((p.assets / maxAssets) * (barW - 20));
    rect(ctx, barX + 2, y + 2, w, 20, pc.dk);
    rect(ctx, barX + 2, y + 2, w, 2, pc.main);
    rect(ctx, barX + 2, y + 2, 2, 20, pc.main);

    // 名次
    ctx.font = 'bold 11px monospace';
    ctx.fillStyle = i === 0 ? PALETTE.gold : PALETTE.glass;
    ctx.fillText(`#${i + 1}`, barX + 8, y + 16);

    // 棋子 —— **统一使用职业立绘**（真人 / AI 一致，与棋盘上看到的完全相同）
    const pieceIndex = (p.careerId && CAREER_PIECE_BY_CAREER[p.careerId] != null)
      ? CAREER_PIECE_BY_CAREER[p.careerId]
      : p.avatar;
    const sprites = getAvatarSprites(pieceIndex ?? 0, p.colorIndex);
    const isVector = sprites.idle.width >= 32;
    ctx.imageSmoothingEnabled = isVector;
    const ts = 24 / sprites.idle.height;   // 统一高度 24
    const tw = sprites.idle.width * ts;
    ctx.drawImage(sprites.idle, barX + 26, y - 6, tw, 24);

    // 名字
    ctx.font = 'bold 12px "Microsoft YaHei", sans-serif';
    ctx.fillStyle = PALETTE.paper;
    ctx.fillText(p.name, barX + 48, y + 16);

    // 资产
    ctx.font = 'bold 11px monospace';
    ctx.fillStyle = PALETTE.amber;
    ctx.textAlign = 'right';
    ctx.fillText(`￥${p.assets}`, barX + barW - 8, y + 16);
    ctx.textAlign = 'left';

    // 机构数 + 职业 / 性格标签
    ctx.font = '9px "Microsoft YaHei", sans-serif';
    ctx.fillStyle = PALETTE.neon;
    const tags = [];
    if (p.careerName) tags.push(p.careerName);
    if (p.personality?.tag) tags.push(p.personality.tag);
    ctx.fillText(`${p.count} 机构${tags.length ? ' · ' + tags.join(' · ') : ''}`, barX + 48, y + 26);
  });

  // 地盘分布图（微型棋盘）
  const boardY = 54 + Math.min(4, list.length) * 30 + 8;
  drawMiniBoard(ctx, 14, boardY, data.boardCells, data.owners);

  // 页脚
  const footY = H - 26;
  rect(ctx, 0, footY, W, 26, PALETTE.navyDk);
  hline(ctx, 0, footY, W, PALETTE.ink);
  ctx.font = '9px "Microsoft YaHei", sans-serif';
  ctx.fillStyle = PALETTE.glass;
  ctx.fillText('像素大富翁 · 四方机构争夺战', 14, footY + 16);
  ctx.textAlign = 'right';
  ctx.fillStyle = PALETTE.neon;
  ctx.fillText('直接在浏览器开打，无需注册', W - 14, footY + 16);
  ctx.textAlign = 'left';
}

/** 微型棋盘 —— 显示归属分布 */
function drawMiniBoard(ctx, x, y, cells, owners) {
  if (!cells) return;
  const size = 4;
  const cols = 4;
  const per = cells.length / cols;

  for (let i = 0; i < cells.length; i++) {
    const side = Math.floor(i / per);
    const pos = i % per;
    let col, row;
    switch (side) {
      case 0: col = cols - 1 - pos; row = per - 1; break;
      case 1: col = cols - 1; row = per - 1 - pos; break;
      case 2: col = cols - 1 - pos; row = 0; break;
      default: col = 0; row = pos; break;
    }
    const px = x + col * size;
    const py = y + row * size;

    const cell = cells[i];
    const ownerIdx = owners ? owners[i] : undefined;
    const isInst = cell.type === 'institution';

    let c = PALETTE.navyDk;
    if (isInst) {
      const g = { bank: PALETTE.red, broker: PALETTE.neon, insurer: PALETTE.jade, asset: PALETTE.gold }[cell.group];
      c = ownerIdx != null ? PLAYER_COLORS[ownerIdx % PLAYER_COLORS.length].main : g;
    } else {
      c = PALETTE.glassDeep;
    }
    rect(ctx, px, py, size - 1, size - 1, c);
  }
}

/** 下载 canvas 为 PNG */
export function downloadCanvas(canvas, filename) {
  try {
    const url = canvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || 'finance-city-share.png';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    return true;
  } catch {
    return false;
  }
}
