/**
 * 背景场景 —— **现代扁平风**金融城区。
 *
 * ================== 设计目标（去像素化）==================
 * 用户反馈「现在还是像素风」——问题不在配色，而在**形状语言**：
 *   · 楼体是**硬边矩形 + 逐格窗点阵** → 立刻回到 8-bit 观感；
 *   · 星空是**单像素小圆点**、云是**硬边椭圆**；
 *   · 车道虚线是**等距方块**、K 线灯带是**逐格柱体**；
 *   · 钟楼窗格是**一格一格的实心矩形**。
 *
 * 本版彻底改造为**柔和几何 + 渐变 + 弥散光晕**：
 *   ① 天空：多层渐变 + 柔和径向光晕（无硬边分层）；
 *   ② 云：多层半透明柔边椭圆（径向渐变，边缘自然消散）；
 *   ③ 天际线：**单个 SVG 路径剪影**（连续天际线轮廓，非独立方块），
 *      窗光改为**低透明度渐变条带**（不是点阵）；
 *   ④ 地面：大面积柔和渐变 + 车道用**渐变虚线**（软边）；
 *   ⑤ 钟楼：轮廓化剪影 + 柔边表盘；
 *   ⑥ K 线灯带：圆角柱 + 竖向渐变（不再是硬色块）。
 *
 * 所有绘制走 Canvas 2D 矢量 API，任意分辨率都不糊。
 */

import { PALETTE } from '../core/palette.js';

/** 昼夜四档 —— 渐变天空配色（现代扁平 · D+ 浅色体系） */
export const DAY_PHASES = [
  { id: 'dawn',  name: '晨',   skyTop: '#e6edff', skyMid: '#f3e8ff', skyBot: '#ffe4e6',
    sun: '#fbbf24', sunGlow: 'rgba(251,191,36,.34)',
    cloud: 'rgba(255,255,255,.68)', dim: 0.05, neon: 0.04,
    bld: ['#c7d2fe', '#a5b4fc', '#818cf8'], bldEdge: '#6366f1' },
  { id: 'noon',  name: '午',   skyTop: '#cfe9fb', skyMid: '#e3f2fe', skyBot: '#f2f9ff',
    sun: '#fde68a', sunGlow: 'rgba(253,230,138,.30)',
    cloud: 'rgba(255,255,255,.82)', dim: 0.0,  neon: 0.0,
    bld: ['#a9b6c9', '#8b9ab1', '#6b7b94'], bldEdge: '#5b6b84' },
  { id: 'dusk',  name: '黄昏', skyTop: '#8b5cf6', skyMid: '#c084fc', skyBot: '#fca97a',
    sun: '#fdba74', sunGlow: 'rgba(252,169,122,.34)',
    cloud: 'rgba(255,255,255,.52)', dim: 0.08, neon: 0.30,
    bld: ['#5b6b8c', '#475569', '#334155'], bldEdge: '#334155' },
  { id: 'night', name: '夜',   skyTop: '#111c33', skyMid: '#1b2a49', skyBot: '#2c3f63',
    sun: '#f8fafc', sunGlow: 'rgba(226,232,240,.26)',
    cloud: 'rgba(148,163,184,.24)', dim: 0.20, neon: 0.72,
    bld: ['#22304c', '#1a2640', '#131d33'], bldEdge: '#0f172a' },
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
   * 构建视差层 —— **连续天际线剪影**。
   *
   * ⚠ 与旧版的根本区别：不再画一堆独立的硬边矩形楼体，
   * 而是把所有楼体连成**一条闭合路径**（skyline path），
   * 一次 fill 成型 —— 轮廓是流畅的几何剪影，没有 1px 像素锯齿感。
   * 窗光用**低透明度横向渐变条带**表示（不是离散点阵）。
   */
  buildLayers() {
    const W = this.w;
    const H = this.h;

    this.layers = [];
    const configs = [
      { seed: 7,  minH: 0.16, maxH: 0.34, alpha: 0.48, band: 0.010 },
      { seed: 23, minH: 0.10, maxH: 0.24, alpha: 0.70, band: 0.007 },
      { seed: 41, minH: 0.05, maxH: 0.15, alpha: 1.00, band: 0.005 },
    ];

    for (const cfg of configs) {
      const cv = document.createElement('canvas');
      cv.width = W;
      cv.height = H;
      const ctx = cv.getContext('2d');
      let s = cfg.seed;
      const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };

      const groundY = H;
      // ===== ① 生成天际线轮廓点（每个楼顶一个点）=====
      const pts = [];
      let x = -30;
      while (x < W + 30) {
        const bw = 34 + Math.floor(rnd() * 88);
        const bh = Math.floor(H * (cfg.minH + rnd() * (cfg.maxH - cfg.minH)));
        pts.push({ x, w: bw, h: bh, top: groundY - bh });
        x += bw;
      }

      // ===== ② 闭合成一条连续路径（楼顶之间用直线，垂直边平直）=====
      ctx.beginPath();
      ctx.moveTo(pts[0].x, groundY);
      for (const p of pts) {
        ctx.lineTo(p.x, p.top);
        ctx.lineTo(p.x + p.w, p.top);
      }
      ctx.lineTo(pts[pts.length - 1].x + pts[pts.length - 1].w, groundY);
      ctx.closePath();

      // 竖向渐变填充（越靠上越亮 —— 模拟天光洒在楼顶）
      const g = ctx.createLinearGradient(0, groundY - H * 0.34, 0, groundY);
      const c0 = this.phase.bld[0], c1 = this.phase.bld[2];
      g.addColorStop(0, c0);
      g.addColorStop(1, c1);
      ctx.globalAlpha = cfg.alpha;
      ctx.fillStyle = g;
      ctx.fill();

      // ===== ③ 楼顶柔光（柔和的横向高光，不是硬边描边）=====
      ctx.save();
      ctx.clip();
      for (const p of pts) {
        const hg = ctx.createLinearGradient(0, p.top, 0, p.top + Math.max(6, p.h * 0.28));
        hg.addColorStop(0, 'rgba(255,255,255,.22)');
        hg.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = hg;
        ctx.fillRect(p.x, p.top, p.w, Math.max(6, p.h * 0.28));
      }

      // ===== ④ 窗光：**柔和渐变条带**（不是离散点阵）=====
      // 每栋楼画若干条水平渐变带 —— 远看像一层层发亮的窗户，
      // 近看是平滑的明暗过渡，没有任何像素点。
      const bandH = Math.max(3, cfg.band * H);
      for (const p of pts) {
        const rows = Math.max(1, Math.floor(p.h / (bandH * 3.2)));
        for (let r = 0; r < rows; r++) {
          const by = p.top + bandH * 1.4 + r * bandH * 3.0;
          if (by + bandH > groundY) break;
          const lit = ((r * 7 + Math.floor(p.x)) % 5) !== 0;
          const a = lit ? 0.20 : 0.08;
          const wg = ctx.createLinearGradient(p.x, 0, p.x + p.w, 0);
          const col = lit ? '253,224,71' : '148,163,184';
          wg.addColorStop(0, `rgba(${col},${a * 0.35})`);
          wg.addColorStop(0.5, `rgba(${col},${a})`);
          wg.addColorStop(1, `rgba(${col},${a * 0.35})`);
          ctx.fillStyle = wg;
          ctx.fillRect(p.x + p.w * 0.14, by, p.w * 0.72, bandH);
        }
      }

      // ===== ⑤ 天际线顶部一条极细的亮边（不是 1px 硬描边，而是渐隐）=====
      ctx.fillStyle = hexA(this.phase.bldEdge, 0.22);
      ctx.fillRect(0, groundY - H * cfg.maxH - 1, W, 1.5);
      ctx.restore();

      ctx.globalAlpha = 1;
      this.layers.push(cv);
    }

    // ===== 地面：柔和沥青渐变 + 柔边车道线 =====
    this.groundHeightRatio = 0.16;
    const roadH = Math.floor(H * this.groundHeightRatio);
    const roadY = H - roadH;
    this.ground = document.createElement('canvas');
    this.ground.width = W;
    this.ground.height = roadH + 8;
    const gctx = this.ground.getContext('2d');
    const gGrad = gctx.createLinearGradient(0, 0, 0, roadH);
    gGrad.addColorStop(0, '#3f4d63');
    gGrad.addColorStop(0.35, '#334155');
    gGrad.addColorStop(1, '#1e293b');
    gctx.fillStyle = gGrad;
    gctx.fillRect(0, 0, W, roadH);
    // 路缘：柔和渐变而非实色条
    const curb = gctx.createLinearGradient(0, 0, 0, 3);
    curb.addColorStop(0, 'rgba(203,213,225,.62)');
    curb.addColorStop(1, 'rgba(148,163,184,0)');
    gctx.fillStyle = curb;
    gctx.fillRect(0, 0, W, 3);
    // 车道虚线：**柔边渐变**（两端淡出），不再是等距硬方块
    for (let lx = 0; lx < W; lx += 58) {
      const dg = gctx.createLinearGradient(lx, 0, lx + 28, 0);
      dg.addColorStop(0, 'rgba(226,232,240,0)');
      dg.addColorStop(0.5, 'rgba(226,232,240,.40)');
      dg.addColorStop(1, 'rgba(226,232,240,0)');
      gctx.fillStyle = dg;
      gctx.fillRect(lx, roadH * 0.52 - 1.5, 28, 3);
    }

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

    // ===== ① 天空：多段线性渐变（柔和过渡，无硬边分层）=====
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, ph.skyTop);
    sky.addColorStop(0.45, ph.skyMid);
    sky.addColorStop(0.78, ph.skyBot);
    sky.addColorStop(1, ph.skyTop);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, this.w, this.h);

    // ===== ② 星星（柔和光点 + 弥散晕）=====
    if (ph.id === 'night') {
      let s = 999;
      const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
      for (let i = 0; i < 60; i++) {
        const x = rnd() * W;
        const y = rnd() * H * 0.45;
        const twinkle = Math.floor(elapsed / 700 + i) % 3 === 0;
        const r = twinkle ? 2.0 : 1.3;
        const hg = ctx.createRadialGradient(x, y, 0, x, y, r * 4.5);
        hg.addColorStop(0, `rgba(248,250,252,${twinkle ? 0.95 : 0.5})`);
        hg.addColorStop(0.35, `rgba(248,250,252,${twinkle ? 0.35 : 0.18})`);
        hg.addColorStop(1, 'rgba(248,250,252,0)');
        ctx.fillStyle = hg;
        ctx.beginPath();
        ctx.arc(x, y, r * 4.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // ===== ③ 太阳 / 月亮：柔和光晕（纯径向渐变，无硬边）=====
    const sunX = W * 0.78;
    const sunY = H * 0.16;
    const R = H * 0.24;
    const glow = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, R);
    glow.addColorStop(0, ph.sunGlow);
    glow.addColorStop(0.35, hexA(ph.sun, 0.10));
    glow.addColorStop(1, hexA(ph.sun, 0));
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(sunX, sunY, R, 0, Math.PI * 2);
    ctx.fill();
    // 日面：柔和渐变圆（边缘略淡）
    const disc = ctx.createRadialGradient(sunX, sunY - 3, 1, sunX, sunY, ph.id === 'night' ? 18 : 22);
    disc.addColorStop(0, ph.sun);
    disc.addColorStop(0.72, hexA(ph.sun, 0.9));
    disc.addColorStop(1, hexA(ph.sun, 0.55));
    ctx.fillStyle = disc;
    ctx.beginPath();
    ctx.arc(sunX, sunY, ph.id === 'night' ? 18 : 22, 0, Math.PI * 2);
    ctx.fill();
    if (ph.id === 'night') {
      // 月牙：偏移的柔和遮罩
      const mg = ctx.createRadialGradient(sunX + 8, sunY - 6, 2, sunX + 8, sunY - 6, 16);
      mg.addColorStop(0, ph.skyMid);
      mg.addColorStop(1, ph.skyMid);
      ctx.fillStyle = mg;
      ctx.beginPath();
      ctx.arc(sunX + 8, sunY - 6, 16, 0, Math.PI * 2);
      ctx.fill();
    }

    // ===== ④ 云：**柔边椭圆**（径向渐变，边缘自然消散）=====
    this.drawClouds(ctx, elapsed, 0.5, ph.cloud, 6);
    this.drawClouds(ctx, elapsed, 1.0, ph.cloud, 4);

    // ===== ⑤ 视差天际线（连续剪影）=====
    const parallax = [0.05, 0.12, 0.25];
    for (let i = 0; i < this.layers.length; i++) {
      const off = -(elapsed * parallax[i] * 0.02) % W;
      const yOff = H * (0.02 + i * 0.05);
      ctx.drawImage(this.layers[i], off, yOff);
      if (off + W < W) ctx.drawImage(this.layers[i], off + W, yOff);
    }

    if (ph.neon > 0.05) this.drawNeonSigns(ctx, elapsed);

    // ===== ⑥ 钟楼（轮廓化扁平剪影）=====
    const tw = 62;
    const th = 86;
    const tx = W * 0.10;
    const ty = H - this.groundHeight() - th;
    this.drawExchangeTower(ctx, tx, ty, tw, th, ph);

    // ===== ⑦ 地面 =====
    ctx.drawImage(this.ground, 0, H - this.groundHeight());

    this.drawSignals(ctx, elapsed);
    this.drawTaxi(ctx, elapsed);
    this.drawTickerBand(ctx, elapsed);

    // ===== ⑧ 夜色压暗（极淡）=====
    if (ph.dim > 0) {
      ctx.fillStyle = `rgba(15,23,42,${ph.dim})`;
      ctx.fillRect(0, 0, this.w, this.h);
    }
  }

  /** 云 —— 用径向渐变画柔边椭圆（不是硬边 path） */
  drawClouds(ctx, elapsed, speed, color, count) {
    const { W, H } = this;
    for (let i = 0; i < count; i++) {
      const x = ((i * 173 + elapsed * speed * 0.012) % (W + 220)) - 110;
      const y = 16 + ((i * 41) % Math.max(18, Math.floor(H * 0.28)));
      const w = 52 + (i % 4) * 30;
      const h = 13 + (i % 3) * 6;
      // 主云团：柔边
      const g = ctx.createRadialGradient(x, y, 0, x, y, w);
      g.addColorStop(0, color);
      g.addColorStop(0.55, color);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(x, y, w, h, 0, 0, Math.PI * 2);
      ctx.fill();
      // 顶部隆起
      const g2 = ctx.createRadialGradient(x + w * 0.26, y - h * 0.6, 0, x + w * 0.26, y - h * 0.6, w * 0.55);
      g2.addColorStop(0, color);
      g2.addColorStop(0.6, color);
      g2.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g2;
      ctx.beginPath();
      ctx.ellipse(x + w * 0.26, y - h * 0.6, w * 0.55, h * 0.9, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /** 霓虹招牌 —— 圆角底板 + 外发光（软阴影） */
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
      const w = ctx.measureText(s.text).width + 18;
      // 外发光（柔和）
      ctx.shadowColor = hexA(s.c, 0.75);
      ctx.shadowBlur = 14;
      const bg = ctx.createLinearGradient(0, y - 12, 0, y + 12);
      bg.addColorStop(0, hexA('#0b1220', 0.62));
      bg.addColorStop(1, hexA('#020617', 0.48));
      ctx.fillStyle = bg;
      roundRect(ctx, x - w / 2, y - 12, w, 24, 8);
      ctx.fill();
      ctx.shadowBlur = 0;
      // 文字（微微发光）
      ctx.shadowColor = hexA(s.c, 0.6);
      ctx.shadowBlur = 8;
      ctx.fillStyle = s.c;
      ctx.fillText(s.text, x, y + 0.5);
      ctx.shadowBlur = 0;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
    }
  }

  /** 交通信号灯 —— 圆角灯箱 + 柔边灯点 */
  drawSignals(ctx, elapsed) {
    const { W, H } = this;
    const roadY = H - this.groundHeight();
    const phase = Math.floor(elapsed / 2400) % 3;
    for (let i = 0; i < 3; i++) {
      const x = W * (0.22 + i * 0.3);
      const y = roadY - 34;
      // 杆
      const pg = ctx.createLinearGradient(x - 2, 0, x + 2, 0);
      pg.addColorStop(0, '#5b6b84');
      pg.addColorStop(1, '#3f4d63');
      ctx.fillStyle = pg;
      roundRect(ctx, x - 1.5, y, 3, 34, 1.5);
      ctx.fill();
      // 灯箱
      ctx.fillStyle = '#1e293b';
      roundRect(ctx, x - 7, y, 14, 24, 5);
      ctx.fill();
      const colors = ['#ef4444', '#f59e0b', '#22c55e'];
      for (let k = 0; k < 3; k++) {
        const on = k === phase;
        const c = colors[k];
        if (on) {
          const lg = ctx.createRadialGradient(x, y + 5 + k * 7, 0, x, y + 5 + k * 7, 6);
          lg.addColorStop(0, hexA(c, 0.95));
          lg.addColorStop(0.4, hexA(c, 0.45));
          lg.addColorStop(1, hexA(c, 0));
          ctx.fillStyle = lg;
          ctx.beginPath();
          ctx.arc(x, y + 5 + k * 7, 6, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = on ? c : 'rgba(100,116,139,.45)';
        ctx.beginPath();
        ctx.arc(x, y + 5 + k * 7, 2.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  /** 出租车 —— 圆角车身 + 渐变玻璃 + 柔边轮胎 */
  drawTaxi(ctx, elapsed) {
    const { W, H } = this;
    const roadY = H - this.groundHeight();
    const x = ((elapsed * this.taxiSpeed) % (W + 140)) - 70;
    const y = roadY + 16;
    // 车身（渐变）
    const bg = ctx.createLinearGradient(0, y - 6, 0, y + 12);
    bg.addColorStop(0, '#fcd34d');
    bg.addColorStop(1, '#f59e0b');
    ctx.fillStyle = bg;
    roundRect(ctx, x, y - 5, 46, 17, 7);
    ctx.fill();
    // 车顶
    const rg = ctx.createLinearGradient(0, y - 15, 0, y - 3);
    rg.addColorStop(0, '#475569');
    rg.addColorStop(1, '#334155');
    ctx.fillStyle = rg;
    roundRect(ctx, x + 11, y - 15, 24, 12, 6);
    ctx.fill();
    // 车窗（渐变玻璃）
    const wg = ctx.createLinearGradient(0, y - 13, 0, y - 5);
    wg.addColorStop(0, 'rgba(203,213,225,.85)');
    wg.addColorStop(1, 'rgba(100,116,139,.65)');
    ctx.fillStyle = wg;
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

  /** 底部 K 线灯带 —— 圆角柱 + 竖向渐变（柔化，不再是硬色块） */
  drawTickerBand(ctx, elapsed) {
    const { W, H } = this;
    const bandH = 26;
    const y = H - bandH;
    const g = ctx.createLinearGradient(0, y, 0, y + bandH);
    g.addColorStop(0, 'rgba(15,23,42,.90)');
    g.addColorStop(1, 'rgba(2,6,23,.96)');
    ctx.fillStyle = g;
    ctx.fillRect(0, y, this.w, bandH);
    ctx.fillStyle = 'rgba(148,163,184,.22)';
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
      // 竖向渐变（底部更实、顶部更淡）
      const cg = ctx.createLinearGradient(0, y + top, 0, y + top + hgt);
      const c = up ? '248,113,113' : '74,222,128';
      cg.addColorStop(0, `rgba(${c},.55)`);
      cg.addColorStop(1, `rgba(${c},.95)`);
      ctx.fillStyle = cg;
      roundRect(ctx, i * step, y + top, 4.5, hgt, 2.2);
      ctx.fill();
    }
  }

  /** 交易所钟楼 —— 扁平剪影 + 柔边表盘 */
  drawExchangeTower(ctx, x, y, w, h, ph) {
    const body = ph.bld[2];
    const face = ph.bld[1];

    // 塔身（竖向渐变）
    const bg = ctx.createLinearGradient(0, y, 0, y + h);
    bg.addColorStop(0, face);
    bg.addColorStop(1, body);
    ctx.fillStyle = bg;
    roundRect(ctx, x + w * 0.16, y + h * 0.30, w * 0.68, h * 0.70, 6);
    ctx.fill();
    // 钟塔
    ctx.fillStyle = face;
    roundRect(ctx, x + w * 0.30, y + h * 0.10, w * 0.40, h * 0.24, 5);
    ctx.fill();
    // 顶檐
    ctx.fillStyle = ph.bld[0];
    roundRect(ctx, x + w * 0.22, y + h * 0.06, w * 0.56, h * 0.07, 3);
    ctx.fill();
    // 尖顶
    const sg = ctx.createLinearGradient(0, y - h * 0.06, 0, y + h * 0.07);
    sg.addColorStop(0, '#f87171');
    sg.addColorStop(1, '#dc2626');
    ctx.fillStyle = sg;
    ctx.beginPath();
    ctx.moveTo(x + w * 0.50, y - h * 0.06);
    ctx.lineTo(x + w * 0.60, y + h * 0.07);
    ctx.lineTo(x + w * 0.40, y + h * 0.07);
    ctx.closePath();
    ctx.fill();

    // 表盘（柔边渐变）
    const cx = x + w * 0.50;
    const cy = y + h * 0.22;
    const r = w * 0.14;
    const dg = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.3, r * 0.1, cx, cy, r);
    dg.addColorStop(0, '#ffffff');
    dg.addColorStop(1, '#e2e8f0');
    ctx.fillStyle = dg;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#e8a93c';
    ctx.lineWidth = 2;
    ctx.stroke();
    // 指针
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 1.8;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx, cy - r * 0.62);
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + r * 0.46, cy + r * 0.2);
    ctx.stroke();
    ctx.lineCap = 'butt';

    // 窗光：**柔和横向渐变条带**（替代一格一格的实心矩形）
    const rows = 4;
    const bandH = Math.max(2.5, h * 0.055);
    for (let r2 = 0; r2 < rows; r2++) {
      const by = y + h * 0.38 + r2 * h * 0.13;
      const wg = ctx.createLinearGradient(x + w * 0.20, 0, x + w * 0.80, 0);
      wg.addColorStop(0, 'rgba(253,224,71,0)');
      wg.addColorStop(0.5, 'rgba(253,224,71,.48)');
      wg.addColorStop(1, 'rgba(253,224,71,0)');
      ctx.fillStyle = wg;
      ctx.fillRect(x + w * 0.20, by, w * 0.60, bandH);
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
