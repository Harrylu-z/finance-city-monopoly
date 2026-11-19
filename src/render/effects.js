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

/**
 * ================== P1-32：粒子预渲染（离屏 canvas 缓存）==================
 *
 * 旧实现每帧为**每一个粒子**新建一个 `createRadialGradient` ——
 * 一场结算能同时有 30+ 粒子，即 30+ 次渐变对象分配 + 30+ 次路径填充。
 * 渐变对象是 Canvas 里最贵的对象之一，这是掉帧的主因。
 *
 * 优化：把粒子按「颜色 + 半径」**预渲染到离屏 canvas**，
 * 之后每帧只是 `drawImage` —— 快一个数量级。
 *
 * 缓存 key = `${kind}|${color}|${r}`，尺寸取整以提高命中率。
 */
const spriteCache = new Map();

/** 离屏画布工厂 */
function makeOffscreen(w, h) {
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.ceil(w));
  cv.height = Math.max(1, Math.ceil(h));
  return cv;
}

/**
 * 取（并缓存）一个粒子的离屏贴图。
 *
 * @param {'spark'|'coin'|'dust'} kind
 * @param {string} color
 * @param {number} r 半径（像素）
 * @returns {HTMLCanvasElement} 贴图，绘制时用 drawImage + 平移居中
 */
function particleSprite(kind, color, r) {
  // 半径量化到 0.5px —— 提高缓存命中率（视觉无差别）
  const rq = Math.max(1, Math.round(r * 2) / 2);
  const key = `${kind}|${color}|${rq}`;
  const hit = spriteCache.get(key);
  if (hit) return hit;

  const pad = Math.ceil(rq * 2.6) + 2;
  const size = pad * 2;
  const cv = makeOffscreen(size, size);
  const ctx = cv.getContext('2d');
  const c = pad;

  if (kind === 'coin') {
    // 金币：金色圆盘 + 高光弧 + 外发光
    const glow = ctx.createRadialGradient(c, c, 0, c, c, rq * 2.6);
    glow.addColorStop(0, hexA(color, 0.45));
    glow.addColorStop(1, hexA(color, 0));
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(c, c, rq * 2.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(c, c, rq, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = hexA('#b4791a', 0.85);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(c, c, rq * 0.66, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,.55)';
    ctx.beginPath();
    ctx.ellipse(c - rq * 0.3, c - rq * 0.34, rq * 0.28, rq * 0.18, -0.6, 0, Math.PI * 2);
    ctx.fill();
  } else if (kind === 'dust') {
    // 尘土：半透明柔边圆斑
    const g = ctx.createRadialGradient(c, c, 0, c, c, rq);
    g.addColorStop(0, hexA(color, 0.55));
    g.addColorStop(1, hexA(color, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(c, c, rq, 0, Math.PI * 2);
    ctx.fill();
  } else {
    // 礼花碎片：圆角小矩形（旋转在 draw 时做，不进贴图）
    const w = 4;
    const h = 7;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(c - w / 2, c - h / 2, w, h, 1.5);
    ctx.fill();
    // 顶部高光
    ctx.fillStyle = 'rgba(255,255,255,.34)';
    ctx.beginPath();
    ctx.roundRect(c - w / 2, c - h / 2, w, h * 0.42, 1.2);
    ctx.fill();
  }

  spriteCache.set(key, cv);
  // 缓存上限 —— 长时间游戏不会无限增长
  if (spriteCache.size > 240) spriteCache.clear();
  return cv;
}

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

  /**
   * 空中层特效 —— 在棋子**之后**绘制。
   *
   * 粒子 / 金币 / 礼花都是「飘在空中」的，盖住角色是正确的。
   *
   * ⚠ 落地冲击波**不在这里** —— 它是地面特效，走 DOM 层
   *   （见 src/render/landingFx.js）：地块卡片不透明，
   *   画在 Canvas 上会被完全遮住。
   */
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

  /**
   * 金币：金色圆盘 + 高光弧 + 外发光
   *
   * ⚠ P1-32：改用**预渲染离屏贴图**（particleSprite）——
   *   旧实现每帧为每个金币新建径向渐变，30 个金币 = 30 次渐变分配。
   */
  drawCoin(ctx, p, alpha) {
    const r = 4.5 * p.size;
    const sprite = particleSprite('coin', p.color, r);
    const half = sprite.width / 2;
    ctx.globalAlpha = alpha;
    ctx.drawImage(sprite, p.x - half, p.y - half);
    ctx.globalAlpha = 1;
  }

  /**
   * 尘土：半透明柔边圆斑
   *
   * ⚠ P1-32：预渲染贴图（alpha 改由 globalAlpha 施加）。
   */
  drawDust(ctx, p, alpha) {
    const sprite = particleSprite('dust', p.color, p.size);
    const half = sprite.width / 2;
    ctx.globalAlpha = alpha;
    ctx.drawImage(sprite, p.x - half, p.y - half);
    ctx.globalAlpha = 1;
  }

  /**
   * 礼花碎片：圆角小矩形 + 旋转
   *
   * ⚠ P1-32：形状预渲染到离屏贴图，旋转/缩放在 draw 时叠加。
   */
  drawSpark(ctx, p, alpha) {
    const w = 4 * p.size;
    const h = 7 * p.size;
    const sprite = particleSprite('spark', p.color, Math.max(w, h) / 2);
    const half = sprite.width / 2;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.globalAlpha = alpha;
    ctx.drawImage(sprite, -half, -half);
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
 * 逐格跳跃移动动画器 —— 一格一跳，落地压扁。
 *
 * ================== 步速设计 ==================
 * 每格耗时由 `stepMs` 控制（默认 300ms，可在 `main.js` 集中调速）。
 * 单格内部切成**三段**：
 *
 *   0% ──── 32% ──── 76% ──── 100%
 *   起跳      腾空        落地
 *   0→1      1→1        1→0（压缩回弹）
 *
 * · **起跳（0~32%）**：身体上抬 + 后仰蓄力，水平位移缓（easeOutQuad）
 * · **腾空（32~76%）**：抛物线最高点，水平位移线性，垂直走正弦弧
 * · **落地（76~100%）**：快速下坠 + 压缩（squash），水平位移收尾（easeInQuad）
 *
 * ⚠ 三段的意义：单一正弦弧只能给出「跳起来再落下」，
 *   但缺少「蓄力」与「砸下」的重量感。分段后每一步都有明确的重心转移。
 *
 * ================== 为什么 AI 可以稍快 ==================
 * AI 回合玩家不需要看清每一步的细节，但**仍要看得见逐格**，
 * 因此只给一个温和的加速系数（默认 0.75），不做整体跳过。
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
    // 每格跳跃耗时（毫秒）—— 由调用方在 start() 时指定
    this.stepMs = 300;
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
    // ⚠ 落地回调 —— 每踩过一格触发一次（PR-E 落地特效）
    this.onLand = opts.onLand || null;
    // ⚠ 每格耗时可被调用方覆盖（AI 回合用稍快的系数）
    this.stepMs = Math.max(80, Math.round(opts.stepMs || this.stepMs));
    this.startedAt = performance.now();
    // 兜底：即使渲染循环被浏览器暂停（后台标签页），也必须在此时限内完成
    this.deadline = this.startedAt + this.steps * this.stepMs + 600;
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
      // ⚠ 落地回调 —— **每跨过一格触发一次**（PR-E 落地特效）。
      //   step 从 n-1 变成 n 时，说明刚**踩上**了第 n 格 —— 此刻出落地特效。
      //   ⚠ 不能只触发一次：角色可能连走多格，每一格都要有落脚感。
      if (this.onLand) {
        try { this.onLand(this.step, this.path); } catch (e) { /* 特效失败不影响回合 */ }
      }
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
   * ================== 三段 easing ==================
   *   0% ──── 32% ──── 76% ──── 100%
   *   起跳      腾空        落地
   *
   * · **起跳**：水平用 easeOutQuad（快速离地），垂直上抬用 easeOutCubic
   * · **腾空**：水平线性推进，垂直走正弦弧（最高点在中段）
   * · **落地**：水平 easeInQuad 收尾，垂直快速下坠，末段压缩回弹
   *
   * ⚠ 为什么落地压缩放在**最后 24%** 而不是瞬时触发：
   *   压缩若与下坠同时发生，角色会「陷进地面」而不是「砸在地面」。
   *   分成「先压扁（sy=0.78）→ 再弹回（sy=1.06）」两帧，
   *   才有弹性玩具的质感。
   *
   * @param {function} rectOf 格子索引 → 矩形
   * @param {function} slotOf 格子索引 → {dx, dy} 站位槽在格内的偏移
   */
  frameState(rectOf, slotOf) {
    if (!this.active) return null;
    const CYCLE = this.stepMs;
    const local = this.tick;
    // ⚠ 起跳格 = 当前步的**终点**；上一格 = 当前步的**起点**。
    //   step=0 时「上一格」应回退到 path[0] 之外（即 from 本身）。
    //   早期写法 `path[Math.max(0, step-1)]` 在 step=0 时会取到 path[0]，
    //   与 toIdx 相同 → dir 退化为 'up' → lean 恒为 0（朝向微倾失效）。
    const fromIdx = this.step > 0
      ? (this.path[Math.min(this.path.length - 1, this.step - 1)] ?? this.from)
      : this.from;
    const toIdx = this.path[Math.min(this.path.length - 1, this.step)] ?? this.to;
    const fromRect = rectOf(fromIdx);
    const toRect = rectOf(toIdx);

    const t = Math.min(1, local / CYCLE);

    // ===== 三段 easing =====
    const T_LIFT = 0.32;   // 起跳段结束
    const T_FALL = 0.76;   // 落地段开始

    let easeH;   // 水平进度
    let easeV;   // 垂直抬升进度（0 = 地面，1 = 最高点）
    if (t < T_LIFT) {
      // 起跳：水平快、垂直慢（蓄力上抬）
      const u = t / T_LIFT;
      easeH = u * (2 - u);                 // easeOutQuad
      easeV = 1 - Math.pow(1 - u, 3);     // easeOutCubic
    } else if (t < T_FALL) {
      // 腾空：水平线性，垂直走正弦弧（在 0.32→0.76 区间内到达最高点再回落）
      const u = (t - T_LIFT) / (T_FALL - T_LIFT);
      easeH = (1 - Math.pow(1 - (t / T_LIFT) * 0.5, 2)) * 0.5 + u * 0.5;
      easeV = Math.sin(u * Math.PI);
    } else {
      // 落地：水平收尾，垂直归零
      //
      // ⚠ 关键：腾空段末尾 easeV 已降到 0（sin(π)=0），
      //   所以落地段必须**从 0 开始**（不能再用 cos(0)=1）——
      //   否则会在 76% 处出现「角色忽然弹回最高点」的跳变。
      //   落地段用 easeInQuad 下坠：从地面高度开始，快速砸到 0。
      const u = (t - T_FALL) / (1 - T_FALL);
      const hEnd = 1;
      const hStart = 0.75;                // 落地段起点的水平进度（近似）
      easeH = hStart + (hEnd - hStart) * (u * u);
      // 下坠：从腾空末端的 0 高度「贴地」→ 保持 0
      //   （腾空段的 sin 弧已经把高度带回 0，落地段不再叠加抬升）
      easeV = 0;
    }

    // 站位槽偏移在两格之间插值（保证走完一格正好落到该格的静止站位）
    const fromSlot = slotOf ? (slotOf(fromIdx) || { dx: 0, dy: 0 }) : { dx: 0, dy: 0 };
    const toSlot = slotOf ? (slotOf(toIdx) || { dx: 0, dy: 0 }) : { dx: 0, dy: 0 };
    const sdx = fromSlot.dx + (toSlot.dx - fromSlot.dx) * easeH;
    const sdy = fromSlot.dy + (toSlot.dy - fromSlot.dy) * easeH;

    const x = fromRect.x + (toRect.x - fromRect.x) * easeH + sdx;
    const y = fromRect.y + (toRect.y - fromRect.y) * easeH + sdy;

    // 跳跃弧线 —— 腾空高度由 easeV 驱动（起跳抬升 + 腾空最高点 + 落地归零）
    const JUMP_H = 11;
    const bob = -easeV * JUMP_H;

    // 落地压缩 —— 最后 24% 内分两帧：先压扁，再回弹
    let squash = null;
    const squashStart = CYCLE * 0.76;
    if (local >= squashStart) {
      const u = (local - squashStart) / Math.max(1, CYCLE - squashStart);
      if (u < 0.45) {
        // 砸下：压扁 + 横向撑开
        squash = { sx: 1.16, sy: 0.80 };
      } else if (u < 0.72) {
        // 回弹：略微拉长
        squash = { sx: 0.95, sy: 1.08 };
      } else {
        // 复位
        squash = { sx: 1.0, sy: 1.0 };
      }
    }

    const dir = toRect.x > fromRect.x ? 'right' : toRect.x < fromRect.x ? 'left'
      : toRect.y > fromRect.y ? 'down' : 'up';

    // ===== 朝向微倾 =====
    // ⚠ 倾斜方向与移动方向相反（像人被惯性甩出去）：
    //   向右走 → 身体向左后仰（lean < 0）。
    //   起跳瞬间倾角最大，落地时归零。
    const dirSign = dir === 'right' ? 1 : dir === 'left' ? -1 : 0;
    const lean = -dirSign * easeV * 0.9;

    return {
      x, y,
      bob,
      lean,
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
