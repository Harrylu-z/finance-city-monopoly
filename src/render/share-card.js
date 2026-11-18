/**
 * 分享卡片 —— Canvas 绘制 **现代扁平风**战绩图，可下载 PNG。
 *
 * ================== 与像素版的差异 ==================
 *   · 底色：浅色渐变（取代深墨底）
 *   · 排行条：白色圆角卡片 + 柔和阴影 + 圆角比例条
 *   · 文字：墨色系（取代宣纸白）
 *   · 微型棋盘：圆角小块
 *   · 页脚：浅灰分隔
 */

import { PALETTE, PLAYER_COLORS } from '../core/palette.js';
import { GROUP_COLORS } from '../core/palette.js';
import { getAvatarSprites } from '../art/avatars.js';
import { CAREERS } from '../core/careers.js';

/** 职业 id → 立绘索引（分享图里每位玩家都用自己的职业立绘） */
const CAREER_PIECE_BY_CAREER = Object.fromEntries(CAREERS.map((c) => [c.id, c.pieceIndex]));

const W = 480;
const H = 300;

/** D+ 浅色体系 */
const INK = '#0f172a';
const INK2 = '#334155';
const INK3 = '#64748b';
const LINE = '#e2e8f0';
const SURFACE = '#ffffff';

/**
 * 绘制分享卡片
 * @param {HTMLCanvasElement} canvas
 * @param {object} data { title, players:[{name, assets, cash, count, colorIndex, avatar, isAI, personality}], boardCells, state }
 */
export function renderShareCard(canvas, data) {
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;

  // ===== 背景：浅色渐变 =====
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#f8fafc');
  bg.addColorStop(1, '#eef2f7');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // ===== 标题栏 =====
  ctx.fillStyle = SURFACE;
  roundRect(ctx, 0, 0, W, 44, 0);
  ctx.fill();
  ctx.strokeStyle = LINE;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, 43.5);
  ctx.lineTo(W, 43.5);
  ctx.stroke();

  ctx.font = 'bold 17px "Microsoft YaHei", "PingFang SC", sans-serif';
  ctx.fillStyle = INK;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(data.title || '中国金融城 · 战绩', 14, 27);
  ctx.font = '10px "Consolas", "Menlo", monospace';
  ctx.fillStyle = INK3;
  ctx.textAlign = 'right';
  ctx.fillText(`SEED ${data.seed || '-'}`, W - 14, 26);
  ctx.textAlign = 'left';

  // ===== 排行条 =====
  const list = data.players || [];
  const barX = 14;
  const barY = 54;
  const barW = W - 28;
  const maxAssets = Math.max(1, ...list.map((p) => p.assets));

  list.slice(0, 4).forEach((p, i) => {
    const y = barY + i * 30;
    const pc = PLAYER_COLORS[p.colorIndex % PLAYER_COLORS.length];

    // 排名底卡：白底 + 圆角 + 柔和阴影
    ctx.save();
    ctx.shadowColor = 'rgba(15,23,42,.08)';
    ctx.shadowBlur = 6;
    ctx.shadowOffsetY = 1.5;
    ctx.fillStyle = SURFACE;
    roundRect(ctx, barX, y, barW, 24, 5);
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = LINE;
    ctx.lineWidth = 1;
    roundRect(ctx, barX + 0.5, y + 0.5, barW - 1, 23, 5);
    ctx.stroke();

    // 资产比例条：圆角
    const w = Math.round((p.assets / maxAssets) * (barW - 20));
    if (w > 2) {
      ctx.fillStyle = pc.dk;
      roundRect(ctx, barX + 2, y + 2, w, 20, 4);
      ctx.fill();
      // 顶部亮条 + 左侧主色
      ctx.fillStyle = pc.main;
      roundRect(ctx, barX + 2, y + 2, w, 3, 1.5);
      ctx.fill();
      roundRect(ctx, barX + 2, y + 2, 3, 20, 1.5);
      ctx.fill();
    }

    // 名次
    ctx.font = 'bold 11px "Consolas", "Menlo", monospace';
    ctx.fillStyle = i === 0 ? '#b4791a' : INK3;
    ctx.fillText(`#${i + 1}`, barX + 8, y + 16);

    // 棋子 —— **统一使用职业立绘**（真人 / AI 一致，与棋盘上看到的完全相同）
    const pieceIndex = (p.careerId && CAREER_PIECE_BY_CAREER[p.careerId] != null)
      ? CAREER_PIECE_BY_CAREER[p.careerId]
      : p.avatar;
    const sprites = getAvatarSprites(pieceIndex ?? 0, p.colorIndex);
    const ts = 24 / sprites.idle.height;   // 统一高度 24
    const tw = sprites.idle.width * ts;
    ctx.drawImage(sprites.idle, barX + 26, y - 6, tw, 24);

    // 名字
    ctx.font = 'bold 12px "Microsoft YaHei", "PingFang SC", sans-serif';
    ctx.fillStyle = INK;
    ctx.fillText(p.name, barX + 48, y + 16);

    // 资产
    ctx.font = 'bold 11px "Consolas", "Menlo", monospace';
    ctx.fillStyle = '#b4791a';
    ctx.textAlign = 'right';
    ctx.fillText(`￥${p.assets}`, barX + barW - 8, y + 16);
    ctx.textAlign = 'left';

    // 机构数 + 职业 / 性格标签
    ctx.font = '9px "Microsoft YaHei", "PingFang SC", sans-serif';
    ctx.fillStyle = INK3;
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
  ctx.fillStyle = '#f1f5f9';
  ctx.fillRect(0, footY, W, 26);
  ctx.strokeStyle = LINE;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, footY + 0.5);
  ctx.lineTo(W, footY + 0.5);
  ctx.stroke();
  ctx.font = '9px "Microsoft YaHei", "PingFang SC", sans-serif';
  ctx.fillStyle = INK3;
  ctx.fillText('中国金融城 · 四方机构争夺战', 14, footY + 16);
  ctx.textAlign = 'right';
  ctx.fillStyle = '#1c6b88';
  ctx.fillText('直接在浏览器开打，无需注册', W - 14, footY + 16);
  ctx.textAlign = 'left';
}

/** 微型棋盘 —— 显示归属分布（圆角小块） */
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

    let c = '#cbd5e1';
    if (isInst) {
      const g = GROUP_COLORS[cell.group];
      c = ownerIdx != null ? PLAYER_COLORS[ownerIdx % PLAYER_COLORS.length].main : (g ? g.base : '#94a3b8');
    } else {
      c = '#e2e8f0';
    }
    ctx.fillStyle = c;
    roundRect(ctx, px, py, size - 1, size - 1, 1);
    ctx.fill();
  }
}

/** 圆角矩形路径 */
function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
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
