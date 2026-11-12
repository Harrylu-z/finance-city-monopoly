/**
 * 特效系统 —— 全部按"帧"离散变化，不做连续插值。
 */

import { PALETTE } from '../core/palette.js';
import { makeCanvas, pixelCircle } from '../art/pixeldraw.js';

/** 像素方块精灵（4×4，用于粒子） */
const particleSprites = (() => {
  const cache = new Map();
  const make = (color) => {
    const cv = makeCanvas(4, 4);
    const ctx = cv.getContext('2d');
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 4, 4);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(0, 3, 4, 1);
    return cv;
  };
  return {
    get(color) {
      if (!cache.has(color)) cache.set(color, make(color));
      return cache.get(color);
    },
  };
})();

/** 尘土精灵 */
const dustSprite = (() => {
  const cv = makeCanvas(6, 6);
  const ctx = cv.getContext('2d');
  ctx.fillStyle = PALETTE.paperDeep;
  ctx.fillRect(1, 1, 4, 4);
  ctx.fillStyle = PALETTE.glass;
  ctx.fillRect(2, 2, 2, 2);
  return cv;
})();

export class Effects {
  constructor() {
    this.particles = [];
    this.shake = 0;
    this.enabled = true;
  }

  clear() {
    this.particles.length = 0;
    this.shake = 0;
  }

  /** 发射像素粒子 */
  burst(x, y, opts = {}) {
    if (!this.enabled) return;
    const {
      count = 10, colors = [PALETTE.gold, PALETTE.amberLt, PALETTE.paper],
      speed = 2, gravity = 0.08, size = 1, life = 40,
    } = opts;
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + Math.random() * 0.6;
      const sp = speed * (0.6 + Math.random() * 0.8);
      this.particles.push({
        x, y,
        vx: Math.cos(angle) * sp,
        vy: Math.sin(angle) * sp - speed * 0.4,
        color: colors[i % colors.length],
        size, gravity,
        life: life + Math.floor(Math.random() * 10),
        maxLife: life + 10,
        kind: 'square',
      });
    }
  }

  /** 向上飘的星星/金币 */
  floatUp(x, y, opts = {}) {
    if (!this.enabled) return;
    const { count = 6, colors = [PALETTE.gold], rise = 1.4 } = opts;
    for (let i = 0; i < count; i++) {
      this.particles.push({
        x: x + (Math.random() - 0.5) * 16,
        y: y + (Math.random() - 0.5) * 8,
        vx: (Math.random() - 0.5) * 0.5,
        vy: -rise - Math.random() * 0.6,
        color: colors[i % colors.length],
        size: 1, gravity: 0.01,
        life: 50 + Math.floor(Math.random() * 20),
        maxLife: 70,
        kind: 'coin',
      });
    }
  }

  /** 尘土粒子（升级塌楼） */
  dust(x, y, count = 12) {
    if (!this.enabled) return;
    for (let i = 0; i < count; i++) {
      this.particles.push({
        x: x + (Math.random() - 0.5) * 20,
        y: y + (Math.random() - 0.5) * 10,
        vx: (Math.random() - 0.5) * 1.2,
        vy: -Math.random() * 0.8,
        color: 'dust',
        size: 1, gravity: 0.05,
        life: 30 + Math.floor(Math.random() * 20),
        maxLife: 50,
        kind: 'dust',
      });
    }
  }

  /** 礼花碎片 */
  confetti(x, y) {
    this.burst(x, y, {
      count: 22,
      colors: [PALETTE.gold, PALETTE.red, PALETTE.neon, PALETTE.jade, PALETTE.paper, PALETTE.amber],
      speed: 3.2, gravity: 0.12, life: 70,
    });
  }

  /** 屏幕抖动 */
  triggerShake(duration = 320) {
    if (!this.enabled) return;
    this.shake = duration;
  }

  update() {
    const ps = [];
    for (const p of this.particles) {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += p.gravity;
      p.life -= 1;
      if (p.life > 0) ps.push(p);
    }
    this.particles = ps;
    if (this.shake > 0) this.shake -= 16;
  }

  draw(ctx) {
    if (!this.particles.length) return;
    ctx.imageSmoothingEnabled = false;
    for (const p of this.particles) {
      const alpha = p.life / p.maxLife;
      if (alpha > 0.5) {
        const s = p.size * 4;
        if (p.kind === 'coin') {
          pixelCircle(ctx, Math.round(p.x), Math.round(p.y), Math.max(1, Math.round(s / 4)), p.color);
        } else if (p.kind === 'dust') {
          ctx.globalAlpha = alpha;
          ctx.drawImage(dustSprite, Math.round(p.x), Math.round(p.y));
          ctx.globalAlpha = 1;
        } else {
          ctx.fillStyle = p.color;
          ctx.fillRect(Math.round(p.x), Math.round(p.y), s, s);
        }
      } else {
        ctx.fillStyle = p.color;
        ctx.fillRect(Math.round(p.x), Math.round(p.y), p.size * 3, p.size * 3);
      }
    }
  }

  shakeOffset() {
    if (this.shake <= 0) return { x: 0, y: 0 };
    const f = Math.floor(this.shake / 60);
    const table = [
      { x: -5, y: 3 }, { x: 5, y: -3 }, { x: -3, y: -2 }, { x: 3, y: 2 }, { x: 0, y: 0 },
    ];
    return table[f % table.length];
  }
}

/**
 * 逐格跳跃移动动画器 —— 一格一跳，落地压扁
 */
export class MoveAnimator {
  constructor() {
    this.active = false;
    this.playerId = null;
    this.from = 0;
    this.to = 0;
    this.steps = 0;
    this.step = 0;
    this.frame = 0;
    this.tick = 0;
    this.onDone = null;
    this.path = [];
    this.startedAt = 0;
    this.stepMs = 110;   // 每格跳跃耗时（毫秒）
    this.deadline = 0;   // 兜底截止时间，防止动画卡死锁住回合
  }

  start(opts) {
    this.active = true;
    this.playerId = opts.playerId;
    this.from = opts.from;
    this.to = opts.to;
    this.steps = Math.max(1, opts.steps || 1);
    this.path = opts.path || [];
    this.step = 0;
    this.frame = 0;
    this.tick = 0;
    this.onDone = opts.onDone || null;
    this.startedAt = performance.now();
    // 兜底：即使渲染循环被浏览器暂停（后台标签页），也必须在此时限内完成
    this.deadline = this.startedAt + this.steps * this.stepMs + 400;
  }

  get progress() {
    if (!this.steps) return 1;
    return Math.min(1, this.step / this.steps);
  }

  /**
   * 推进动画（基于真实时间，与帧率无关）。
   * 返回 true 表示仍在动画中。
   */
  update() {
    if (!this.active) return false;
    const now = performance.now();
    const elapsed = now - this.startedAt;

    const targetStep = Math.min(this.steps, Math.floor(elapsed / this.stepMs));
    this.tick = elapsed % this.stepMs;

    if (targetStep !== this.step) {
      this.step = targetStep;
      this.frame = (this.frame + 1) % 4;
    }

    if (this.step >= this.steps || now >= this.deadline) {
      this.active = false;
      this.step = this.steps;
      const cb = this.onDone;
      this.onDone = null;
      if (cb) cb();
      return false;
    }
    return true;
  }

  /** 立即结束动画并触发完成回调（后台标签页 / 用户切走时使用） */
  finish() {
    if (!this.active) return;
    this.active = false;
    this.step = this.steps;
    const cb = this.onDone;
    this.onDone = null;
    if (cb) cb();
  }

  /**
   * 计算当前渲染位置与挤压。
   *
   * 关键设计：棋子的落点坐标必须与「静止站位」完全一致，
   * 否则会出现「走着走着人跳到格子另一处」的突兀感。
   * 因此这里在两个格子的站位槽之间做插值 —— 起点用起点槽，终点用终点槽，
   * 走完最后一格时正好落在静止站位上，零跳变。
   *
   * @param {function} rectOf 格子索引 → 矩形
   * @param {function} slotOf 格子索引 → {dx, dy} 站位槽在格内的偏移
   */
  frameState(rectOf, slotOf) {
    if (!this.active) return null;
    const CYCLE = this.stepMs;
    const local = this.tick;
    const fromIdx = this.path[Math.max(0, this.step - 1)] ?? this.from;
    const toIdx = this.path[Math.min(this.path.length - 1, this.step)] ?? this.to;
    const fromRect = rectOf(fromIdx);
    const toRect = rectOf(toIdx);

    const t = Math.min(1, local / CYCLE);
    const FRAMES = 4;
    const fstep = Math.floor(t * FRAMES) / (FRAMES - 1);

    // 站位槽偏移在两格之间插值（保证走完一格正好落到该格的静止站位）
    const fromSlot = slotOf ? (slotOf(fromIdx) || { dx: 0, dy: 0 }) : { dx: 0, dy: 0 };
    const toSlot = slotOf ? (slotOf(toIdx) || { dx: 0, dy: 0 }) : { dx: 0, dy: 0 };
    const sdx = fromSlot.dx + (toSlot.dx - fromSlot.dx) * fstep;
    const sdy = fromSlot.dy + (toSlot.dy - fromSlot.dy) * fstep;

    const x = fromRect.x + (toRect.x - fromRect.x) * fstep + sdx;
    const y = fromRect.y + (toRect.y - fromRect.y) * fstep + sdy;

    // 跳跃弧线（4 段离散帧，像素风）
    const JUMP = [0, -6, -8, -4];
    const jumpIdx = Math.min(JUMP.length - 1, Math.floor(t * JUMP.length));
    const jump = JUMP[jumpIdx];

    let squash = null;
    if (local >= CYCLE - 40) {
      squash = local < CYCLE - 20 ? { sx: 1.25, sy: 0.75 } : { sx: 0.9, sy: 1.1 };
    }

    const dir = toRect.x > fromRect.x ? 'right' : toRect.x < fromRect.x ? 'left'
      : toRect.y > fromRect.y ? 'down' : 'up';

    return {
      x, y: y + jump,
      squash, dir, frame: this.frame,
    };
  }
}
