/**
 * 背景场景 —— 像素都市金融区。
 *
 * 包含：像素云、远景天际线视差、霓虹招牌、红绿灯、出租车、
 *      交易所钟楼、股市 K 线灯带、四档昼夜色板。
 */

import { PALETTE } from '../core/palette.js';
import { makeCanvas, rect, hline, vline, pixelCircle, pixelRing, outline } from '../art/pixeldraw.js';

/** 昼夜四档 */
export const DAY_PHASES = [
  { id: 'dawn',  name: '晨',   sky: 'skyDawn',    skyLt: 'skyDawnLt',  cloud: 'paperDeep', dim: 0.35, neon: 0.1 },
  { id: 'noon',  name: '午',   sky: 'skyNoon',    skyLt: 'skyNoonLt',  cloud: 'paper',     dim: 0.0,  neon: 0.0 },
  { id: 'dusk',  name: '黄昏', sky: 'skyDusk',    skyLt: 'skyDuskLt',  cloud: 'amberDk',   dim: 0.18, neon: 0.4 },
  { id: 'night', name: '夜',   sky: 'skyNight',   skyLt: 'skyNightLt', cloud: 'glassDk',   dim: 0.55, neon: 1.0 },
];

export class Background {
  constructor(w, h) {
    this.t = 0;
    this.phaseIndex = 3;
    this.taxiSpeed = 0.22;
    this.resize(w, h);
  }

  resize(w, h) {
    this.w = w;
    this.h = h;
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

  /** 构建视差层（原生画布 + 整数倍放大绘制） */
  buildLayers() {
    const scale = 2;
    const W = Math.ceil(this.w / scale);
    const H = Math.ceil(this.h / scale);

    this.layers = [];
    const configs = [
      { seed: 7,  minH: 40, maxH: 90, color: 'navyDeep', win: 'ink',     lit: 0.05, dens: 0.55 },
      { seed: 23, minH: 26, maxH: 62, color: 'navyDk',   win: 'inkDeep', lit: 0.14, dens: 0.70 },
      { seed: 41, minH: 14, maxH: 38, color: 'ink',      win: 'navy',    lit: 0.30, dens: 0.85 },
    ];

    for (const cfg of configs) {
      const cv = makeCanvas(W, H);
      const ctx = cv.getContext('2d');
      let s = cfg.seed;
      const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };

      let x = 0;
      while (x < W) {
        const bw = 8 + Math.floor(rnd() * 18);
        const bh = cfg.minH + Math.floor(rnd() * (cfg.maxH - cfg.minH));
        const by = H - bh;
        rect(ctx, x, by, bw, bh, cfg.color);
        if (rnd() > 0.5) rect(ctx, x + Math.floor(bw / 3), by - 3, 3, 3, cfg.color);
        if (rnd() > 0.7) {
          vline(ctx, x + Math.floor(bw / 2), by - 8, 8, cfg.color);
          pixelCircle(ctx, x + Math.floor(bw / 2), by - 9, 1, 'red');
        }
        const cols = Math.max(1, Math.floor(bw / 3));
        const rows = Math.max(1, Math.floor(bh / 3));
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            if (rnd() > cfg.dens) continue;
            const wx = x + 1 + c * 3;
            const wy = by + 2 + r * 3;
            if (wx >= x + bw - 1 || wy >= H - 1) continue;
            ctx.fillStyle = rnd() < cfg.lit ? 'amber' : cfg.win;
            ctx.fillRect(wx, wy, 1, 1);
          }
        }
        x += bw + (rnd() > 0.6 ? 2 : 0);
      }
      this.layers.push(cv);
    }

    // 地面
    const roadH = Math.floor(H * 0.16);
    const roadY = H - roadH;
    this.ground = makeCanvas(W, H);
    const gctx = this.ground.getContext('2d');
    rect(gctx, 0, roadY, W, roadH, 'ink');
    hline(gctx, 0, roadY, W, 'glassDeep');
    for (let x = 4; x < W; x += 22) rect(gctx, x, roadY + 3, 7, roadH - 6, 'glassDk');
    for (let x = 0; x < W; x += 9) rect(gctx, x, roadY + Math.floor(roadH / 2) - 1, 4, 1, 'glass');
    rect(gctx, 0, roadY - 4, W, 4, 'navyDk');
    hline(gctx, 0, roadY - 4, W, 'glassDk');
    for (let x = 2; x < W; x += 6) vline(gctx, x, roadY - 4, 4, 'ink');

    // 交易所钟楼
    this.tower = makeCanvas(40, 56);
    drawExchangeTower(this.tower.getContext('2d'));

    this.scale = scale;
    this.W = W;
    this.H = H;
  }

  groundHeight() {
    return Math.floor(this.H * 0.16) + 4;
  }

  draw(ctx, elapsed) {
    this.t = elapsed;
    const { W, H, scale } = this;
    const ph = this.phase;

    rect(ctx, 0, 0, this.w, this.h, PALETTE[ph.sky]);

    // 星星（夜晚）
    if (ph.id === 'night') {
      let s = 999;
      const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
      for (let i = 0; i < 60; i++) {
        const x = Math.floor(rnd() * W);
        const y = Math.floor(rnd() * H * 0.5);
        const twinkle = Math.floor(elapsed / 700 + i) % 3 === 0;
        ctx.fillStyle = twinkle ? 'paper' : 'glass';
        ctx.fillRect(x * scale, y * scale, scale, scale);
      }
    }

    // 太阳 / 月亮
    const sunX = Math.floor(W * 0.78);
    const sunY = Math.floor(H * 0.16);
    if (ph.id === 'night') {
      pixelCircle(ctx, sunX * scale, sunY * scale, 7 * scale, 'paper');
      ctx.fillStyle = PALETTE[ph.sky];
      ctx.fillRect((sunX - 5) * scale, (sunY - 8) * scale, 9 * scale, 9 * scale);
    } else {
      pixelCircle(ctx, sunX * scale, sunY * scale, 8 * scale, ph.id === 'dusk' ? 'amber' : 'goldLt');
      pixelCircle(ctx, sunX * scale, sunY * scale, 5 * scale, ph.id === 'dusk' ? 'amberLt' : 'gold');
    }

    this.drawClouds(ctx, elapsed, 0.5, ph.cloud, 26);
    this.drawClouds(ctx, elapsed, 1.0, ph.id === 'night' ? 'glassDk' : 'paperDeep', 18);

    // 视差天际线
    const parallax = [0.05, 0.12, 0.25];
    for (let i = 0; i < this.layers.length; i++) {
      const off = -(elapsed * parallax[i] * 0.02) % W;
      const yOff = Math.floor(H * (0.02 + i * 0.05));
      ctx.drawImage(this.layers[i], off * scale, yOff * scale);
      ctx.drawImage(this.layers[i], (off + W) * scale, yOff * scale);
    }

    if (ph.neon > 0.05) this.drawNeonSigns(ctx, elapsed);

    // 钟楼
    const towerScale = 2;
    const tx = Math.floor(W * 0.12) * scale;
    const ty = (H - 56 - this.groundHeight() + 6) * scale;
    ctx.drawImage(this.tower, tx, ty, this.tower.width * towerScale, this.tower.height * towerScale);

    // 地面
    ctx.drawImage(this.ground, 0, (H - this.groundHeight()) * scale);

    this.drawSignals(ctx, elapsed);
    this.drawTaxi(ctx, elapsed);
    this.drawTickerBand(ctx, elapsed);

    // 夜色压暗（叠加，不用渐变）
    if (ph.dim > 0) {
      ctx.fillStyle = `rgba(16,22,42,${ph.dim})`;
      ctx.fillRect(0, 0, this.w, this.h);
    }
  }

  drawClouds(ctx, elapsed, speed, color, count) {
    const { W, H, scale } = this;
    for (let i = 0; i < count; i++) {
      const x = ((i * 137 + elapsed * speed * 0.012) % (W + 40)) - 20;
      const y = 6 + ((i * 31) % Math.max(10, Math.floor(H * 0.28)));
      const w = 7 + (i % 4) * 3;
      ctx.fillStyle = PALETTE[color];
      ctx.fillRect(Math.round(x * scale), Math.round(y * scale), w * scale, 3 * scale);
      ctx.fillRect(Math.round((x + 2) * scale), Math.round((y - 1) * scale), (w - 4) * scale, scale);
    }
  }

  drawNeonSigns(ctx, elapsed) {
    const { W, scale } = this;
    const signs = [
      { x: 0.18, c: 'neon',   text: 'FIN' },
      { x: 0.34, c: 'red',    text: 'K' },
      { x: 0.56, c: 'amber',  text: 'FX' },
      { x: 0.86, c: 'neonLt', text: 'BANK' },
    ];
    for (const s of signs) {
      const flick = Math.floor(elapsed / 420 + s.x * 10) % 5 !== 0;
      if (!flick) continue;
      const x = Math.floor(W * s.x);
      const y = Math.floor(this.H * 0.12) + (s.text.length % 3) * 6;
      const w = s.text.length * 3 + 3;
      ctx.fillStyle = PALETTE.ink;
      ctx.fillRect(x * scale, y * scale, w * scale, 7 * scale);
      ctx.fillStyle = PALETTE[s.c];
      ctx.fillRect((x + 1) * scale, (y + 1) * scale, (w - 2) * scale, 5 * scale);
      ctx.fillStyle = PALETTE.paper;
      ctx.fillRect((x + 2) * scale, (y + 2) * scale, (w - 4) * scale, scale);
    }
  }

  drawSignals(ctx, elapsed) {
    const { W, H, scale } = this;
    const roadY = (H - this.groundHeight()) * scale;
    const phase = Math.floor(elapsed / 2400) % 3;
    for (let i = 0; i < 3; i++) {
      const x = Math.floor(W * (0.22 + i * 0.3)) * scale;
      const y = roadY - 26 * scale;
      ctx.fillStyle = PALETTE.ink;
      ctx.fillRect(x, y, 2 * scale, 26 * scale);
      ctx.fillRect(x - 2 * scale, y, 6 * scale, 9 * scale);
      ctx.fillStyle = PALETTE[i === phase ? 'red' : 'jadeDeep'];
      ctx.fillRect(x, y + 1 * scale, 2 * scale, 2 * scale);
      ctx.fillStyle = PALETTE.amberDk;
      ctx.fillRect(x, y + 4 * scale, 2 * scale, 2 * scale);
    }
  }

  drawTaxi(ctx, elapsed) {
    const { W, H, scale } = this;
    const roadY = (H - this.groundHeight()) * scale;
    const x = ((elapsed * this.taxiSpeed) % (W + 30)) - 15;
    const y = roadY + 3 * scale;
    ctx.fillStyle = PALETTE.amber;
    ctx.fillRect(Math.round(x * scale), Math.round(y), 12 * scale, 5 * scale);
    ctx.fillStyle = PALETTE.amberLt;
    ctx.fillRect(Math.round(x * scale), Math.round(y), 12 * scale, scale);
    ctx.fillStyle = PALETTE.ink;
    ctx.fillRect(Math.round((x + 3) * scale), Math.round(y - 3 * scale), 6 * scale, 3 * scale);
    ctx.fillStyle = PALETTE.neonLt;
    ctx.fillRect(Math.round((x + 4) * scale), Math.round(y - 2 * scale), 2 * scale, scale);
    ctx.fillStyle = PALETTE.ink;
    ctx.fillRect(Math.round((x + 2) * scale), Math.round(y + 5 * scale), 3 * scale, 2 * scale);
    ctx.fillRect(Math.round((x + 8) * scale), Math.round(y + 5 * scale), 3 * scale, 2 * scale);
    ctx.fillStyle = PALETTE.paper;
    ctx.fillRect(Math.round((x + 5) * scale), Math.round(y - 4 * scale), 2 * scale, scale);
  }

  drawTickerBand(ctx, elapsed) {
    const { W, H, scale } = this;
    const bandH = 14;
    const y = (H - bandH) * scale;
    ctx.fillStyle = PALETTE.ink;
    ctx.fillRect(0, y, this.w, bandH * scale);
    ctx.fillStyle = PALETTE.navyDk;
    ctx.fillRect(0, y, this.w, scale);

    const step = 5;
    const count = Math.ceil(W / step);
    for (let i = 0; i < count; i++) {
      const k = this.kline[i % this.kline.length];
      const tick = Math.floor(elapsed / 260 + i * 0.7) % 3;
      const amp = k.base * 6 + tick * 0.9;
      const mid = bandH / 2;
      const top = Math.max(1, Math.round(mid - amp));
      const hgt = Math.max(1, Math.round(amp * 2));
      const up = k.dir > 0;
      ctx.fillStyle = up ? PALETTE.red : PALETTE.jade;
      ctx.fillRect(Math.round(i * step * scale), y + top * scale, 2 * scale, hgt * scale);
      ctx.fillStyle = up ? PALETTE.redDk : PALETTE.jadeDk;
      ctx.fillRect(Math.round((i * step + 1) * scale), y + Math.max(0, top - 2) * scale, scale, 2 * scale);
    }
  }
}

/** 交易所钟楼 —— 40×56 原生像素 */
function drawExchangeTower(ctx) {
  rect(ctx, 6, 16, 28, 40, 'glassDeep');
  rect(ctx, 6, 16, 28, 1, 'glass');
  rect(ctx, 6, 16, 1, 40, 'glass');
  rect(ctx, 33, 16, 1, 40, 'ink');
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 7; c++) {
      ctx.fillStyle = (r + c) % 4 === 0 ? 'amber' : 'glass';
      ctx.fillRect(8 + c * 4, 19 + r * 4, 2, 2);
    }
  }
  rect(ctx, 4, 14, 32, 2, 'glassDk');
  hline(ctx, 4, 14, 32, 'glassLt');

  rect(ctx, 13, 4, 14, 12, 'navyDk');
  rect(ctx, 13, 4, 14, 1, 'navyLt');
  vline(ctx, 13, 4, 12, 'glassDk');
  vline(ctx, 26, 4, 12, 'ink');
  pixelCircle(ctx, 20, 10, 4, 'paper');
  pixelRing(ctx, 20, 10, 4, 'gold');
  rect(ctx, 20, 8, 1, 2, 'ink');
  rect(ctx, 20, 10, 2, 1, 'ink');
  for (let i = 0; i < 5; i++) rect(ctx, 15 + i, 3 - i, 10 - i * 2, 1, 'red');
  vline(ctx, 20, 0, 2, 'gold');

  rect(ctx, 16, 50, 8, 6, 'ink');
  rect(ctx, 17, 51, 6, 5, 'inkDeep');
  rect(ctx, 19, 51, 1, 5, 'gold');

  rect(ctx, 4, 54, 32, 2, 'glassDk');
  hline(ctx, 4, 54, 32, 'glass');

  outline(ctx, 4, 14, 32, 42, 'ink');
}
