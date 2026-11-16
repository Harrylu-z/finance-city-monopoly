/**
 * 扑克牌渲染 —— **现代扁平风**（德州扑克桌面专用）。
 *
 * 尺寸 22×30（原生），圆角卡面 + 真实字体点数 + 矢量花色符号。
 *
 * ================== 与像素版的差异 ==================
 *   · 卡面：圆角矩形 + 柔和内阴影（取代硬直角）
 *   · 点数：系统字体渲染（取代 3×5 像素点阵）
 *   · 花色：Canvas 路径绘制 ♠♥♦♣（取代逐行 fillRect 拼形）
 *   · 牌背：圆角 + 柔和菱格 + 中心圆章
 *   · 描边：1px 细线 + 圆角（取代像素阶梯 outline）
 */

const CW = 22;
const CH = 30;

const cache = new Map();

/** 花色配色 —— 与 D+ 浅色体系一致 */
const SUIT = {
  S: { main: '#0f172a', light: '#475569', name: '♠' },
  C: { main: '#0f172a', light: '#475569', name: '♣' },
  H: { main: '#dc2626', light: '#f87171', name: '♥' },
  D: { main: '#dc2626', light: '#f87171', name: '♦' },
};
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

  const cv = document.createElement('canvas');
  cv.width = CW;
  cv.height = CH;
  const ctx = cv.getContext('2d');
  const suit = SUIT[card.suit] || SUIT.S;
  const rt = rankText(card.rank);

  // ===== 卡面：圆角白底 + 内阴影 =====
  roundRect(ctx, 0.5, 0.5, CW - 1, CH - 1, 3);
  ctx.fillStyle = opts.dim ? '#cbd5e1' : '#ffffff';
  ctx.fill();

  // 顶部柔和高光
  const sheen = ctx.createLinearGradient(0, 0, 0, CH * 0.4);
  sheen.addColorStop(0, 'rgba(255,255,255,.95)');
  sheen.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = sheen;
  roundRect(ctx, 1, 1, CW - 2, CH * 0.4, 2.5);
  ctx.fill();

  // 描边
  ctx.strokeStyle = opts.dim ? 'rgba(100,116,139,.6)' : 'rgba(15,23,42,.42)';
  ctx.lineWidth = 1;
  roundRect(ctx, 0.5, 0.5, CW - 1, CH - 1, 3);
  ctx.stroke();

  // ===== 左上角：点数 + 小花色 =====
  ctx.fillStyle = suit.main;
  ctx.font = 'bold 8px "Consolas", "Menlo", monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(rt, 2.5, 2);

  // ===== 中央大花色 =====
  drawSuitMark(ctx, CW / 2, CH / 2 + 1.5, card.suit, suit, 1);

  // ===== 右下角：倒置点数（旋转 180°）=====
  ctx.save();
  ctx.translate(CW - 2.5, CH - 2);
  ctx.rotate(Math.PI);
  ctx.fillStyle = suit.main;
  ctx.font = 'bold 8px "Consolas", "Menlo", monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(rt, 0, 0);
  ctx.restore();

  cache.set(key, cv);
  return cv;
}

/** 牌背（圆角 + 柔和菱格 + 中心圆章） */
export function getCardBack() {
  return cached('cb', () => {
    const cv = document.createElement('canvas');
    cv.width = CW;
    cv.height = CH;
    const ctx = cv.getContext('2d');

    // 底板
    roundRect(ctx, 0.5, 0.5, CW - 1, CH - 1, 3);
    const bg = ctx.createLinearGradient(0, 0, CW, CH);
    bg.addColorStop(0, '#c8392b');
    bg.addColorStop(1, '#8d2419');
    ctx.fillStyle = bg;
    ctx.fill();

    // 菱格纹（用路径 + clip，不用逐格方块）
    ctx.save();
    roundRect(ctx, 1.5, 1.5, CW - 3, CH - 3, 2);
    ctx.clip();
    ctx.strokeStyle = 'rgba(255,200,97,.30)';
    ctx.lineWidth = 1;
    for (let i = -CH; i < CW + CH; i += 5) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i + CH, CH);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(i + CH, 0);
      ctx.lineTo(i, CH);
      ctx.stroke();
    }
    ctx.restore();

    // 中心圆章
    ctx.fillStyle = 'rgba(232,169,60,.95)';
    ctx.beginPath();
    ctx.arc(CW / 2, CH / 2, 4.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#8d2419';
    ctx.font = 'bold 7px "Consolas", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('¥', CW / 2, CH / 2 + 0.5);

    // 描边
    ctx.strokeStyle = 'rgba(15,23,42,.5)';
    ctx.lineWidth = 1;
    roundRect(ctx, 0.5, 0.5, CW - 1, CH - 1, 3);
    ctx.stroke();

    return cv;
  });
}

function cached(key, factory) {
  if (cache.has(key)) return cache.get(key);
  const v = factory();
  cache.set(key, v);
  return v;
}

/** 画花色符号（矢量路径） */
function drawSuitMark(ctx, cx, cy, suit, colors, scale = 1) {
  const r = 6 * scale;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.fillStyle = colors.main;

  if (suit === 'S') {
    // 黑桃：两瓣 + 下尖 + 梗
    ctx.beginPath();
    ctx.moveTo(0, r * 0.62);
    ctx.bezierCurveTo(-r * 1.15, -r * 0.12, -r * 0.55, -r * 0.98, 0, -r * 0.36);
    ctx.bezierCurveTo(r * 0.55, -r * 0.98, r * 1.15, -r * 0.12, 0, r * 0.62);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = colors.main;
    ctx.lineWidth = 1.6 * scale;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(0, r * 0.55);
    ctx.lineTo(0, r * 1.15);
    ctx.stroke();
  } else if (suit === 'C') {
    // 梅花：三瓣 + 梗
    for (let i = 0; i < 3; i++) {
      const a = -Math.PI / 2 + (i * Math.PI * 2) / 3;
      ctx.beginPath();
      ctx.arc(Math.cos(a) * r * 0.52, Math.sin(a) * r * 0.52, r * 0.52, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = colors.main;
    ctx.lineWidth = 1.7 * scale;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(0, r * 0.2);
    ctx.lineTo(0, r * 1.15);
    ctx.stroke();
  } else if (suit === 'D') {
    // 方块：旋转 45° 的圆角方
    ctx.save();
    ctx.rotate(Math.PI / 4);
    const d = r * 0.92;
    roundRect(ctx, -d / 2, -d / 2, d, d, 1.6 * scale);
    ctx.fill();
    ctx.restore();
  } else {
    // 红桃：两圆 + 下尖
    ctx.beginPath();
    ctx.moveTo(0, r * 0.92);
    ctx.bezierCurveTo(-r * 1.2, -r * 0.1, -r * 0.55, -r * 0.95, 0, -r * 0.3);
    ctx.bezierCurveTo(r * 0.55, -r * 0.95, r * 1.2, -r * 0.1, 0, r * 0.92);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
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

/** 花色中文/符号名（UI 文本用） */
export function suitSymbol(suit) {
  return SUIT_NAME[suit] || '?';
}
