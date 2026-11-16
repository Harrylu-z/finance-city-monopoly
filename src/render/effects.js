/**
 * 特效系统 —— **现代扁平风**：柔和径向光晕、圆角碎片、渐隐淡出。
 *
 * ================== 与像素版的差异 ==================
 *   · 粒子：圆形（带径向渐变 + 柔光）取代 4×4 像素方块
 *   · 金币：金色圆盘 + 高光弧 + 外发光
 *   · 尘土：半透明柔边圆斑
 *   · 礼花：圆角小矩形（可旋转）+ 重力
 *   · 屏幕抖动：连续衰减（正弦）取代 5 段硬切
 */

import { PALETTE } from '../core/palette.js';

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

  /** 发射柔光粒子 */
  burst(x, y, opts = {}) {
    if (!this.enabled) return;
    const {
      count = 10, colors = [PALETTE.gold, '#ffc861', '#f8fafc'],
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
        kind: 'spark',
        rot: Math.random() * Math.PI,
        vrot: (Math.random() - 0.5) * 0.18,
      });
    }
  }

  /** 向上飘的金币 */
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
        rot: 0, vrot: 0,
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
        color: '#cbd5e1',
        size: 1.6 + Math.random() * 1.4, gravity: 0.05,
        life: 30 + Math.floor(Math.random() * 20),
        maxLife: 50,
        kind: 'dust',
        rot: 0, vrot: 0,
      });
    }
  }

  /** 礼花碎片 */
  confetti(x, y) {
    this.burst(x, y, {
      count: 22,
      colors: [PALETTE.gold, PALETTE.red, '#22d3ee', PALETTE.green, '#f8fafc', '#fb923c'],
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
      p.rot += p.vrot;
      if (p.life > 0) ps.push(p);
    }
    this.particles = ps;
    if (this.shake > 0) this.shake -= 16;
  }

  draw(ctx) {
    if (!this.particles.length) return;
    ctx.save();
    for (const p of this.particles) {
      const alpha = Math.max(0, Math.min(1, p.life / p.maxLife));
      if (p.kind === 'coin') {
        this.drawCoin(ctx, p, alpha);
      } else if (p.kind === 'dust') {
        this.drawDust(ctx, p, alpha);
      } else {
        this.drawSpark(ctx, p, alpha);
      }
    }
    ctx.restore();
  }

  /** 金币：金色圆盘 + 高光弧 + 外发光 */
  drawCoin(ctx, p, alpha) {
    const r = 4.5 * p.size;
    ctx.globalAlpha = alpha;
    const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 2.6);
    glow.addColorStop(0, hexA(p.color, 0.45));
    glow.addColorStop(1, hexA(p.color, 0));
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r * 2.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = hexA('#b4791a', 0.85);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r * 0.66, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,.55)';
    ctx.beginPath();
    ctx.ellipse(p.x - r * 0.3, p.y - r * 0.34, r * 0.28, r * 0.18, -0.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  /** 尘土：半透明柔边圆斑 */
  drawDust(ctx, p, alpha) {
    const r = p.size;
    const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
    g.addColorStop(0, hexA(p.color, 0.55 * alpha));
    g.addColorStop(1, hexA(p.color, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  /** 礼花碎片：圆角小矩形 + 旋转 */
  drawSpark(ctx, p, alpha) {
    const w = 4 * p.size;
    const h = 7 * p.size;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = p.color;
    roundRect(ctx, -w / 2, -h / 2, w, h, 1.6);
    ctx.fill();
    ctx.globalAlpha = alpha * 0.5;
    ctx.fillStyle = 'rgba(255,255,255,.6)';
    roundRect(ctx, -w / 2, -h / 2, w * 0.42, h, 1.2);
    ctx.fill();
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  /** 屏幕抖动 —— 连续衰减 */
  shakeOffset() {
    if (this.shake <= 0) return { x: 0, y: 0 };
    const k = Math.min(1, this.shake / 320);
    const t = performance.now() / 1000;
    return {
      x: Math.sin(t * 47) * 5 * k,
      y: Math.cos(t * 39) * 3 * k,
    };
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

    // 站位槽偏移在两格之间插值（保证走完一格正好落到该格的静止站位）
    const fromSlot = slotOf ? (slotOf(fromIdx) || { dx: 0, dy: 0 }) : { dx: 0, dy: 0 };
    const toSlot = slotOf ? (slotOf(toIdx) || { dx: 0, dy: 0 }) : { dx: 0, dy: 0 };
    const sdx = fromSlot.dx + (toSlot.dx - fromSlot.dx) * t;
    const sdy = fromSlot.dy + (toSlot.dy - fromSlot.dy) * t;

    const x = fromRect.x + (toRect.x - fromRect.x) * t + sdx;
    const y = fromRect.y + (toRect.y - fromRect.y) * t + sdy;

    // 跳跃弧线 —— 连续抛物线（现代扁平风，不再 4 段离散帧）
    const jump = -Math.sin(t * Math.PI) * 9;

    let squash = null;
    if (local >= CYCLE - 40) {
      squash = local < CYCLE - 20 ? { sx: 1.18, sy: 0.82 } : { sx: 0.93, sy: 1.07 };
    }

    const dir = toRect.x > fromRect.x ? 'right' : toRect.x < fromRect.x ? 'left'
      : toRect.y > fromRect.y ? 'down' : 'up';

    return {
      x, y: y + jump,
      squash, dir, frame: this.frame,
    };
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

/**
 * #rrggbb + alpha → rgba()
 *
 * ⚠ 容错：调用方有时会传入 undefined / 非十六进制色（例如调色板里
 *   不存在的键名），此时不能产出 `rgba(NaN,...)` —— 那会让
 *   `addColorStop` 直接抛异常、整个渲染循环中断。
 *   解析失败时回落到不透明白，保证特效仍然绘制得出来。
 */
function hexA(hex, a) {
  const raw = String(hex || '').trim();
  const h = raw.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return `rgba(255,255,255,${a})`;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}
