/**
 * 背景场景 —— **现代扁平风**金融城区。
 *
 * ================== 与像素版的差异 ==================
 *   · 天空：线性渐变 + 柔和径向光晕（取代分层纯色）
 *   · 云：半透明柔和椭圆（取代阶梯方块云）
 *   · 天际线：扁平色块楼体 + 圆角 + 柔光窗格（取代 1px 像素点阵）
 *   · 霓虹招牌：圆角底板 + 外发光（取代 1px 硬边）
 *   · 钟楼：几何化扁平建筑 + 圆形表盘
 *   · 地面：柔和沥青色 + 车道虚线（取代逐格点阵）
 *   · K 线灯带：圆角柱 + 渐变
 *
 * 所有绘制走 Canvas 2D 的矢量 API，任意分辨率都不糊。
 */

import { PALETTE } from '../core/palette.js';

/** 昼夜四档 —— 渐变天空配色 */
export const DAY_PHASES = [
  { id: 'dawn',  name: '晨',   skyTop: '#e0e7ff', skyBot: '#fecdd3', sun: '#fbbf24',
    cloud: 'rgba(255,255,255,.55)', dim: 0.10, neon: 0.05, bld: ['#c7d2fe', '#a5b4fc', '#818cf8'] },
  { id: 'noon',  name: '午',   skyTop: '#bae6fd', skyBot: '#e0f2fe', sun: '#fde68a',
    cloud: 'rgba(255,255,255,.72)', dim: 0.0,  neon: 0.0,  bld: ['#94a3b8', '#64748b', '#475569'] },
  { id: 'dusk',  name: '黄昏', skyTop: '#7c3aed', skyBot: '#fb923c', sun: '#fdba74',
    cloud: 'rgba(255,255,255,.42)', dim: 0.14, neon: 0.45, bld: ['#475569', '#334155', '#1e293b'] },
  { id: 'night', name: '夜',   skyTop: '#0f172a', skyBot: '#1e293b', sun: '#f8fafc',
    cloud: 'rgba(148,163,184,.22)', dim: 0.32, neon: 1.0, bld: ['#1e293b', '#0f172a', '#020617'] },
];

export class Background {
  constructor(w, h) {
    this.t = 0;
    this.phaseIndex = 3;
    this.taxiSpeed = 0.22;
    this.resize(w, h);
  }

  resize(w, h) {
    this.w = Math.max(1, w);
    this.h = Math.max(1, h);
    this.buildLayers();
    this.initKline();
  }

  setPhase(index) {
    this.phaseIndex = ((index % DAY_PHASES.length) + DAY_PHASES.length) % DAY_PHASES.length;
  }

  get phase() {
    return DAY_PHASES[this.phaseIndex];
  }

  initKline() {
    this.kline = [];
    let s = 12345;
    const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
    for (let i = 0; i < 48; i++) {
      this.kline.push({ base: rnd() * 0.6 + 0.2, dir: rnd() > 0.5 ? 1 : -1 });
    }
  }

  /**
   * 构建视差层 —— 楼体用圆角矩形 + 半透明窗格绘制到离屏画布。
   * 离屏画布按 1:1 分辨率生成（不再整数倍缩小），保证清晰。
   */
  buildLayers() {
    const W = this.w;
    const H = this.h;

    this.layers = [];
    const configs = [
      { seed: 7,  minH: 0.16, maxH: 0.34, win: 0.05, dens: 0.42, alpha: 0.55 },
      { seed: 23, minH: 0.10, maxH: 0.24, win: 0.14, dens: 0.58, alpha: 0.78 },
      { seed: 41, minH: 0.05, maxH: 0.15, win: 0.30, dens: 0.74, alpha: 1.0 },
    ];

    for (const cfg of configs) {
      const cv = document.createElement('canvas');
      cv.width = W;
      cv.height = H;
      const ctx = cv.getContext('2d');
      let s = cfg.seed;
      const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };

      const groundY = H;
      let x = -20;
      while (x < W) {
        const bw = 26 + Math.floor(rnd() * 74);
        const bh = Math.floor(H * (cfg.minH + rnd() * (cfg.maxH - cfg.minH)));
        const by = groundY - bh;
        const rad = Math.min(6, bw * 0.14);
        const color = this.phase.bld[Math.floor(rnd() * this.phase.bld.length)];

        // 楼体：扁平圆角块 + 顶部微高光
        ctx.globalAlpha = cfg.alpha;
        ctx.fillStyle = color;
        roundRect(ctx, x, by, bw, bh, rad);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,.10)';
        roundRect(ctx, x, by, bw, Math.min(4, bh * 0.12), rad);
        ctx.fill();

        // 屋顶天线
        if (rnd() > 0.62) {
          ctx.fillStyle = color;
          const aw = Math.max(2, bw * 0.06);
          ctx.fillRect(x + bw / 2 - aw / 2, by - 14, aw, 14);
          ctx.fillStyle = 'rgba(239,68,68,.9)';
          ctx.beginPath();
          ctx.arc(x + bw / 2, by - 15, 2.2, 0, Math.PI * 2);
          ctx.fill();
        }

        // 窗格：柔和半透明圆点
        const cols = Math.max(2, Math.floor(bw / 13));
        const rows = Math.max(2, Math.floor(bh / 17));
        const wW = Math.max(2, bw / cols * 0.42);
        const wH = Math.max(3, bh / rows * 0.38);
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            if (rnd() > cfg.dens) continue;
            const wx = x + (bw / cols) * (c + 0.5) - wW / 2;
            const wy = by + (bh / rows) * (r + 0.5) - wH / 2;
            if (wy + wH > groundY) continue;
            const lit = rnd() < cfg.win;
            ctx.globalAlpha = cfg.alpha * (lit ? 0.95 : 0.55);
            ctx.fillStyle = lit ? 'rgba(253,224,71,.92)' : 'rgba(148,163,184,.34)';
            roundRect(ctx, wx, wy, wW, wH, Math.min(2, wW / 2));
            ctx.fill();
          }
        }
        ctx.globalAlpha = 1;
        x += bw + Math.floor(rnd() * 12);
      }
      this.layers.push(cv);
    }

    // ===== 地面：柔和沥青 + 车道虚线 =====
    this.groundHeightRatio = 0.16;
    const roadH = Math.floor(H * this.groundHeightRatio);
    const roadY = H - roadH;
    this.ground = document.createElement('canvas');
    this.ground.width = W;
    this.ground.height = roadH + 8;
    const gctx = this.ground.getContext('2d');
    const gGrad = gctx.createLinearGradient(0, 0, 0, roadH);
    gGrad.addColorStop(0, '#334155');
    gGrad.addColorStop(1, '#1e293b');
    gctx.fillStyle = gGrad;
    gctx.fillRect(0, 0, W, roadH);
    // 路缘
    gctx.fillStyle = 'rgba(148,163,184,.55)';
    gctx.fillRect(0, 0, W, 2);
    // 车道虚线
    gctx.fillStyle = 'rgba(226,232,240,.42)';
    for (let x = 0; x < W; x += 46) gctx.fillRect(x, roadH / 2 - 1.5, 24, 3);

    this.scale = 1;
    this.W = W;
    this.H = H;
  }

  groundHeight() {
    return Math.floor(this.H * this.groundHeightRatio);
  }

  draw(ctx, elapsed) {
    this.t = elapsed;
    const { W, H } = this;
    const ph = this.phase;

    // ===== ① 天空：线性渐变 =====
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, ph.skyTop);
    sky.addColorStop(0.62, ph.skyBot);
    sky.addColorStop(1, ph.skyTop);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, this.w, this.h);

    // ===== ② 星星（夜晚，柔和光点）=====
    if (ph.id === 'night') {
      let s = 999;
      const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
      for (let i = 0; i < 70; i++) {
        const x = rnd() * W;
        const y = rnd() * H * 0.5;
        const twinkle = Math.floor(elapsed / 700 + i) % 3 === 0;
        ctx.globalAlpha = twinkle ? 0.9 : 0.4;
        ctx.fillStyle = '#f8fafc';
        ctx.beginPath();
        ctx.arc(x, y, twinkle ? 1.5 : 1, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    // ===== ③ 太阳 / 月亮：柔和光晕 =====
    const sunX = W * 0.78;
    const sunY = H * 0.16;
    const glow = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, H * 0.22);
    glow.addColorStop(0, hexA(ph.sun, 0.55));
    glow.addColorStop(0.4, hexA(ph.sun, 0.18));
    glow.addColorStop(1, hexA(ph.sun, 0));
    ctx.fillStyle = glow;
    ctx.fillRect(sunX - H * 0.22, sunY - H * 0.22, H * 0.44, H * 0.44);
    ctx.fillStyle = ph.sun;
    ctx.beginPath();
    ctx.arc(sunX, sunY, ph.id === 'night' ? 16 : 20, 0, Math.PI * 2);
    ctx.fill();
    if (ph.id === 'night') {
      // 月牙：用一个天空色圆偏移遮罩
      ctx.fillStyle = ph.skyTop;
      ctx.beginPath();
      ctx.arc(sunX + 7, sunY - 5, 14, 0, Math.PI * 2);
      ctx.fill();
    }

    // ===== ④ 云：柔和椭圆 =====
    this.drawClouds(ctx, elapsed, 0.5, ph.cloud, 7);
    this.drawClouds(ctx, elapsed, 1.0, ph.cloud, 5);

    // ===== ⑤ 视差天际线 =====
    const parallax = [0.05, 0.12, 0.25];
    for (let i = 0; i < this.layers.length; i++) {
      const off = -(elapsed * parallax[i] * 0.02) % W;
      const yOff = H * (0.02 + i * 0.05);
      ctx.drawImage(this.layers[i], off, yOff);
      if (off + W < W) ctx.drawImage(this.layers[i], off + W, yOff);
    }

    if (ph.neon > 0.05) this.drawNeonSigns(ctx, elapsed);

    // ===== ⑥ 钟楼（几何扁平）=====
    const tw = 56;
    const th = 78;
    const tx = W * 0.10;
    const ty = H - this.groundHeight() - th;
    this.drawExchangeTower(ctx, tx, ty, tw, th, ph);

    // ===== ⑦ 地面 =====
    ctx.drawImage(this.ground, 0, H - this.groundHeight());

    this.drawSignals(ctx, elapsed);
    this.drawTaxi(ctx, elapsed);
    this.drawTickerBand(ctx, elapsed);

    // ===== ⑧ 夜色压暗 =====
    if (ph.dim > 0) {
      ctx.fillStyle = `rgba(15,23,42,${ph.dim})`;
      ctx.fillRect(0, 0, this.w, this.h);
    }
  }

  drawClouds(ctx, elapsed, speed, color, count) {
    const { W, H } = this;
    for (let i = 0; i < count; i++) {
      const x = ((i * 173 + elapsed * speed * 0.012) % (W + 180)) - 90;
      const y = 14 + ((i * 41) % Math.max(16, Math.floor(H * 0.3)));
      const w = 42 + (i % 4) * 26;
      const h = 12 + (i % 3) * 5;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.ellipse(x, y, w, h, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(x + w * 0.28, y - h * 0.5, w * 0.52, h * 0.8, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  drawNeonSigns(ctx, elapsed) {
    const { W, H } = this;
    const signs = [
      { x: 0.18, c: '#22d3ee', text: 'FIN' },
      { x: 0.34, c: '#f87171', text: 'K' },
      { x: 0.56, c: '#fbbf24', text: 'FX' },
      { x: 0.86, c: '#a78bfa', text: 'BANK' },
    ];
    for (const s of signs) {
      const flick = Math.floor(elapsed / 420 + s.x * 10) % 6 !== 0;
      if (!flick) continue;
      const x = W * s.x;
      const y = H * 0.12 + (s.text.length % 3) * 12;
      ctx.font = '600 13px "Microsoft YaHei", "PingFang SC", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const w = ctx.measureText(s.text).width + 16;
      // 外发光
      ctx.shadowColor = s.c;
      ctx.shadowBlur = 16;
      ctx.fillStyle = hexA(s.c, 0.22);
      roundRect(ctx, x - w / 2, y - 11, w, 22, 7);
      ctx.fill();
      ctx.shadowBlur = 0;
      // 底板 + 文字
      ctx.fillStyle = hexA('#020617', 0.55);
      roundRect(ctx, x - w / 2, y - 11, w, 22, 7);
      ctx.fill();
      ctx.fillStyle = s.c;
      ctx.fillText(s.text, x, y + 0.5);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
    }
  }

  drawSignals(ctx, elapsed) {
    const { W, H } = this;
    const roadY = H - this.groundHeight();
    const phase = Math.floor(elapsed / 2400) % 3;
    for (let i = 0; i < 3; i++) {
      const x = W * (0.22 + i * 0.3);
      const y = roadY - 34;
      // 杆
      ctx.fillStyle = '#475569';
      ctx.fillRect(x - 1.5, y, 3, 34);
      // 灯箱
      ctx.fillStyle = '#1e293b';
      roundRect(ctx, x - 7, y, 14, 24, 4);
      ctx.fill();
      const colors = ['#ef4444', '#f59e0b', '#22c55e'];
      for (let k = 0; k < 3; k++) {
        ctx.fillStyle = k === phase ? colors[k] : 'rgba(100,116,139,.45)';
        ctx.beginPath();
        ctx.arc(x, y + 5 + k * 7, 2.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  drawTaxi(ctx, elapsed) {
    const { W, H } = this;
    const roadY = H - this.groundHeight();
    const x = ((elapsed * this.taxiSpeed) % (W + 120)) - 60;
    const y = roadY + 16;
    // 车身
    ctx.fillStyle = '#fbbf24';
    roundRect(ctx, x, y - 5, 46, 17, 6);
    ctx.fill();
    // 车顶
    ctx.fillStyle = '#334155';
    roundRect(ctx, x + 11, y - 15, 24, 12, 5);
    ctx.fill();
    // 车窗
    ctx.fillStyle = 'rgba(148,163,184,.75)';
    roundRect(ctx, x + 13, y - 13, 20, 8, 3);
    ctx.fill();
    // 轮
    ctx.fillStyle = '#0f172a';
    for (const dx of [10, 33]) {
      ctx.beginPath();
      ctx.arc(x + dx, y + 13, 4, 0, Math.PI * 2);
      ctx.fill();
    }
    // 顶灯
    ctx.fillStyle = '#fde68a';
    roundRect(ctx, x + 19, y - 19, 9, 4, 2);
    ctx.fill();
  }

  drawTickerBand(ctx, elapsed) {
    const { W, H } = this;
    const bandH = 26;
    const y = H - bandH;
    // 底板：柔和深色 + 顶部高光
    const g = ctx.createLinearGradient(0, y, 0, y + bandH);
    g.addColorStop(0, 'rgba(15,23,42,.92)');
    g.addColorStop(1, 'rgba(2,6,23,.96)');
    ctx.fillStyle = g;
    ctx.fillRect(0, y, this.w, bandH);
    ctx.fillStyle = 'rgba(148,163,184,.28)';
    ctx.fillRect(0, y, this.w, 1);

    const step = 9;
    const count = Math.ceil(W / step);
    for (let i = 0; i < count; i++) {
      const k = this.kline[i % this.kline.length];
      const tick = Math.floor(elapsed / 260 + i * 0.7) % 3;
      const amp = k.base * 8 + tick * 1.2;
      const mid = bandH / 2;
      const top = Math.max(2, mid - amp);
      const hgt = Math.max(2, amp * 2);
      const up = k.dir > 0;
      ctx.fillStyle = up ? 'rgba(248,113,113,.92)' : 'rgba(74,222,128,.92)';
      roundRect(ctx, i * step, y + top, 4.5, hgt, 2);
      ctx.fill();
    }
  }

  /** 交易所钟楼 —— 扁平几何建筑 + 圆形表盘 */
  drawExchangeTower(ctx, x, y, w, h, ph) {
    const body = ph.bld[2];
    const face = ph.bld[1];

    // 塔身
    ctx.fillStyle = body;
    roundRect(ctx, x + w * 0.16, y + h * 0.30, w * 0.68, h * 0.70, 5);
    ctx.fill();
    // 钟塔
    ctx.fillStyle = face;
    roundRect(ctx, x + w * 0.30, y + h * 0.10, w * 0.40, h * 0.24, 4);
    ctx.fill();
    // 顶檐
    ctx.fillStyle = ph.bld[0];
    roundRect(ctx, x + w * 0.22, y + h * 0.06, w * 0.56, h * 0.07, 3);
    ctx.fill();
    // 尖顶
    ctx.fillStyle = '#ef4444';
    ctx.beginPath();
    ctx.moveTo(x + w * 0.50, y - h * 0.06);
    ctx.lineTo(x + w * 0.60, y + h * 0.07);
    ctx.lineTo(x + w * 0.40, y + h * 0.07);
    ctx.closePath();
    ctx.fill();

    // 表盘
    const cx = x + w * 0.50;
    const cy = y + h * 0.22;
    const r = w * 0.13;
    ctx.fillStyle = '#f8fafc';
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#e8a93c';
    ctx.lineWidth = 2;
    ctx.stroke();
    // 指针
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx, cy - r * 0.62);
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + r * 0.46, cy + r * 0.2);
    ctx.stroke();

    // 窗格
    ctx.fillStyle = 'rgba(253,224,71,.55)';
    for (let r2 = 0; r2 < 4; r2++) {
      for (let c = 0; c < 4; c++) {
        ctx.fillRect(x + w * 0.22 + c * w * 0.14, y + h * 0.38 + r2 * h * 0.13, w * 0.07, h * 0.07);
      }
    }
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

/** #rrggbb + alpha → rgba() */
function hexA(hex, a) {
  const h = String(hex).replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}
