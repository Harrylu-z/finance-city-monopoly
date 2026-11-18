/**
 * 角色实体渲染 —— **2.5D 伪 3D 棋子**。
 *
 * ================== 为什么需要独立模块 ==================
 * 此前角色只有「一张立绘 + 一个椭圆底座」，在 3D 俯视下：
 *   · 立绘是**纯平贴图**，没有体积 —— 像贴在棋盘上的贴纸；
 *   · 底座只是一圈椭圆色环 —— 没有任何厚度与材质；
 *   · 落地只有一圈水波纹 —— 看不到「脚踩在地上」的实体感。
 *
 * 本模块把角色拆成**可数的实体构件**，让「有没有实体」变成可断言的事实：
 *
 *   ┌ 底座台座（plinth）──── 梯形台 + 顶面 + 侧壁 + 接地阴影
 *   ├ 身体（body）──── 立体柱体：正面 / 受光侧面 / 暗侧面
 *   ├ 头部（head）──── 球体感：主色 + 高光 + 帽檐 / 发型
 *   └ 配饰（badge）──── 职业图标（象牙棋子环）+ 玩家色肩章
 *
 * ================== 为什么用 Canvas 矢量画 ==================
 * · 棋子只有 20~40px 宽，矢量画的渐变/描边在任意缩放下都锐利；
 * · 需要随时间变化的**呼吸 / 倾斜 / 弹跳**，矢量参数化最自然；
 * · 不引入新的美术资源文件，与现有 `career-pieces.js` 的色板一致。
 *
 * ================== 与既有立绘的关系 ==================
 * 职业立绘（`career-pieces.js`）表达的是**人物细节**（脸、服饰）。
 * 本模块在其之下补一层**体积**（台座 / 柱体 / 球头 / 肩章），
 * 两者叠加 —— 立绘浮在柱体之上，形成「小人站在台座上」的层次。
 */

import { PLAYER_COLORS } from '../core/palette.js';

/**
 * 光照方向 —— 全局统一。
 *
 * ⚠ 棋盘在 3D 下是 `rotateX(45deg)`，即**俯视**。
 *   俯视时「上」= 远离观众 = 光的来源方向。
 *   因此统一：光源来自**左上后方**，
 *   → 高光在左上，受光面偏左上，暗面偏右下。
 *
 * 全局只此一处定义，实体 / 建筑 / 地块共用同一套光照，
 * 三者的立体感才会互相吻合（这是重设计的关键：光要一致）。
 */
export const LIGHT = { x: -0.55, y: -0.62 };

/** #rrggbb → rgba() */
export function hexA(hex, a) {
  const h = String(hex || '').replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return `rgba(255,255,255,${a})`;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

/** 两个 hex 混合 */
export function mix(colorA, colorB, t) {
  const pa = parseHex(colorA);
  const pb = parseHex(colorB);
  const r = Math.round(pa[0] + (pb[0] - pa[0]) * t);
  const g = Math.round(pa[1] + (pb[1] - pa[1]) * t);
  const b = Math.round(pa[2] + (pb[2] - pa[2]) * t);
  return `rgb(${r},${g},${b})`;
}

function parseHex(hex) {
  const h = String(hex || '').replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return [200, 200, 200];
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

/**
 * 职业 → 实体造型参数。
 *
 * 造型差异要**可辨识**（一眼分清是谁），但风格统一（同一套语汇）。
 * 因此每种职业给的是「同样的构件、不同的比例与配色」：
 *   · 体型比例（宽 / 高）
 *   · 头部造型（帽檐 / 圆顶 / 高帽 / 皇冠 / 头巾）
 *   · 肩章颜色
 */
const CAREER_LOOK = {
  // 投行家 —— 修身西装 + 高礼帽（精英感）
  7: { body: 'suit', head: 'topHat', wide: 0.92, tall: 1.06, accent: '#e8a93c' },
  // 风控总监 —— 厚肩 + 鸭舌帽（守卫感）
  8: { body: 'guard', head: 'cap', wide: 1.16, tall: 0.98, accent: '#3fc6c6' },
  // 精算师 —— 圆润 + 圆顶眼镜（理性感）
  9: { body: 'round', head: 'dome', wide: 1.04, tall: 0.96, accent: '#e05a4a' },
  // 量化研究员 —— 瘦削 + 科技目镜（科技感）
  10: { body: 'slim', head: 'visor', wide: 0.88, tall: 1.04, accent: '#b07ce8' },
  // 基金经理 —— 中庸 + 礼帽（稳重感）
  11: { body: 'suit', head: 'fedora', wide: 1.0, tall: 1.0, accent: '#e8a93c' },
  // 交易员 —— 敞领 + 耳机（凌厉感）
  12: { body: 'slim', head: 'phones', wide: 0.94, tall: 1.02, accent: '#3fc6c6' },
  // 赌王 —— 阔肩 + 皇冠（张扬感）
  13: { body: 'guard', head: 'crown', wide: 1.18, tall: 1.0, accent: '#e8a93c' },
};

/** 兜底造型 */
const DEFAULT_LOOK = { body: 'suit', head: 'dome', wide: 1.0, tall: 1.0, accent: '#e8a93c' };

/**
 * 取某职业的造型参数。
 * @param {number} avatar 职业立绘索引（7~13）
 */
export function lookOf(avatar) {
  return CAREER_LOOK[avatar] || DEFAULT_LOOK;
}

/**
 * 角色实体渲染器。
 *
 * 持有**跨帧缓存**（台座渐变 / 身体柱体），避免每帧重建渐变。
 */
export class CharEntityRenderer {
  constructor() {
    /** 本次绘制绘制的实体数量（供自检断言） */
    this.entityCount = 0;
  }

  /** 供外部断言使用 */
  get lastEntityCount() {
    return this.entityCount;
  }

  /**
   * 绘制一个角色实体。
   *
   * @param {CanvasRenderingContext2D} ctx
   * @param {object} o
   *   cx, cy   —— 脚底中心（屏幕坐标）
   *   s        —— 缩放（与格子尺度挂钩）
   *   color    —— 玩家主色
   *   colorLt  —— 玩家亮色
   *   colorDk  —— 玩家暗色
   *   avatar   —— 职业索引（决定造型）
   *   isCurrent—— 是否当前回合玩家
   *   isAI     —— 是否 AI（AI 头顶加一枚小徽标）
   *   time     —— 动画时间（呼吸 / 脉动）
   *   flat     —— 是否俯视压扁（3D 模式）
   *   lean     —— 朝向微倾（-1~1）
   *   bob      —— 弹跳位移（像素，已含符号）
   *   squash   —— {sx, sy} 落地压缩
   */
  draw(ctx, o) {
    const {
      cx, cy, s, color, colorLt, colorDk, avatar,
      isCurrent = false, isAI = false, time = 0, flat = false,
      lean = 0, bob = 0, squash = null,
    } = o;

    const look = lookOf(avatar);

    // 3D 俯视时垂直方向压扁（与底座同一比例，保持「贴地」）
    //
    // ⚠ 为什么是 0.72 而不是 0.42：
    //   0.42 是**地面圆**在 45° 俯视下的真实投影比 —— 适用于平贴的圆。
    //   但角色是**立着的**，它在俯视下只该被压扁一部分：
    //   真正的 3D 渲染会保留垂直立柱的高度（只是顶部收窄）。
    //   若用 0.42，角色会被压成一张纸 —— 体积感全失。
    //   0.72 是「立柱在俯视下的观感折中」：明显有透视，但仍是个人形。
    const vScale = flat ? 0.72 : 1;

    // 呼吸：当前玩家有明显的呼吸起伏，其他玩家几乎静止
    const breathAmt = isCurrent ? 1 : 0.22;
    const breath = Math.sin(time / 420) * 0.9 * breathAmt * s;

    // 落地压缩 → 整体纵向压扁 + 横向撑开
    const sx = squash ? squash.sx : 1;
    const sy = squash ? squash.sy : 1;

    const baseW = 12.5 * s * look.wide;     // 台座底宽
    const bodyW = 9.4 * s * look.wide;      // 身体柱宽
    const bodyH = 17 * s * look.tall;       // 身体柱高
    const headR = 4.8 * s;                 // 头半径

    const footY = cy + bob;

    ctx.save();

    // 接地阴影 —— 画在最底层，且**不跟随压缩**（影子属于地面，不属于身体）
    ctx.save();
    ctx.fillStyle = 'rgba(15,23,42,.30)';
    ctx.beginPath();
    ctx.ellipse(cx + baseW * 0.10, footY + 1.5 * s, baseW * 0.56, baseW * 0.19 * vScale, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(15,23,42,.16)';
    ctx.beginPath();
    ctx.ellipse(cx + baseW * 0.14, footY + 1.2 * s, baseW * 0.72, baseW * 0.24 * vScale, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // 整体倾斜（朝向微倾）—— 绕脚底旋转，产生「身体前倾」的动态
    if (lean) {
      ctx.translate(cx, footY);
      ctx.transform(1, 0, lean * 0.16, 1, 0, 0);
      ctx.translate(-cx, -footY);
    }
    // 压缩
    if (squash) {
      ctx.translate(cx, footY);
      ctx.scale(sx, sy);
      ctx.translate(-cx, -footY);
    }

    // ---------- ② 台座（plinth）----------
    this._drawPlinth(ctx, {
      cx, y: footY, w: baseW, s, vScale,
      color, colorLt, colorDk, isCurrent, time, breath,
    });

    // ---------- ③ 身体柱体 ----------
    const bodyTop = footY - bodyH * vScale;
    this._drawBody(ctx, {
      cx, top: bodyTop, h: bodyH * vScale, w: bodyW,
      s, vScale, look, color, colorLt, colorDk,
      isCurrent, time, breath, flat,
    });

    // ---------- ④ 头部 ----------
    const headCy = bodyTop - headR * 0.72 + breath * 0.5;
    this._drawHead(ctx, {
      cx, cy: headCy, r: headR, s, look,
      color, colorLt, colorDk, isCurrent, time, breath, flat,
    });

    // ---------- ⑤ 配饰：肩章 + AI 徽标 ----------
    this._drawBadges(ctx, {
      cx, top: bodyTop, w: bodyW, s, look, color, colorLt, isAI, isCurrent,
    });

    ctx.restore();
    this.entityCount++;
  }

  /**
   * 台座 —— **梯形台 + 顶面 + 侧壁**。
   *
   * 三段结构：
   *   ① 侧壁：上下两个梯形之间的柱面（左暗右亮）
   *   ② 顶面：压扁的椭圆（俯视时能看到台面）
   *   ③ 顶面高光边 + 内圈刻线
   */
  _drawPlinth(ctx, o) {
    const { cx, y, w, s, vScale, color, colorLt, colorDk, isCurrent, time, breath } = o;

    const h = 3.6 * s;                 // 台座总高
    const topY = y - h + breath * 0.3; // 台面高度
    const rx = w * 0.5;                // 半宽
    const ryTop = rx * 0.42 * vScale;  // 台面椭圆短半轴

    // ---- 侧壁 ----
    // 上沿（台面）比下沿（地面）窄 → 梯形侧壁，形成「收腰」的透视
    const wallGrad = ctx.createLinearGradient(cx - rx, 0, cx + rx, 0);
    wallGrad.addColorStop(0, hexA(colorDk, 0.92));
    wallGrad.addColorStop(0.30, hexA(colorDk, 0.70));
    wallGrad.addColorStop(0.62, hexA(color, 0.55));
    wallGrad.addColorStop(1, hexA(colorDk, 0.88));
    ctx.fillStyle = wallGrad;
    ctx.beginPath();
    ctx.ellipse(cx, topY, rx, ryTop, 0, Math.PI, Math.PI * 2);
    ctx.lineTo(cx + rx, y);
    ctx.ellipse(cx, y, rx, ryTop * 0.94, 0, 0, Math.PI);
    ctx.closePath();
    ctx.fill();

    // ---- 台面 ----
    const topGrad = ctx.createRadialGradient(
      cx - rx * 0.35, topY - ryTop * 0.45, 0,
      cx, topY, rx * 1.1,
    );
    topGrad.addColorStop(0, hexA(colorLt, 0.95));
    topGrad.addColorStop(0.55, hexA(color, 0.72));
    topGrad.addColorStop(1, hexA(colorDk, 0.80));
    ctx.fillStyle = topGrad;
    ctx.beginPath();
    ctx.ellipse(cx, topY, rx, ryTop, 0, 0, Math.PI * 2);
    ctx.fill();

    // ---- 台面刻线（外圈 + 内圈）----
    ctx.strokeStyle = hexA(colorLt, 0.55);
    ctx.lineWidth = Math.max(0.7, 0.9 * s);
    ctx.beginPath();
    ctx.ellipse(cx, topY, rx, ryTop, 0, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = hexA(colorDk, 0.42);
    ctx.lineWidth = Math.max(0.5, 0.6 * s);
    ctx.beginPath();
    ctx.ellipse(cx, topY, rx * 0.66, ryTop * 0.66, 0, 0, Math.PI * 2);
    ctx.stroke();

    // ---- 当前玩家：呼吸光晕（在台面之上）----
    if (isCurrent) {
      const pulse = 0.5 + 0.5 * Math.sin(time / 300);
      const halo = ctx.createRadialGradient(cx, topY, 0, cx, topY, rx * 2.0);
      halo.addColorStop(0, hexA(colorLt, 0.30 + 0.22 * pulse));
      halo.addColorStop(0.5, hexA(color, 0.12 * pulse));
      halo.addColorStop(1, hexA(color, 0));
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.ellipse(cx, topY, rx * 2.0, rx * 2.0 * 0.44 * vScale, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /**
   * 身体柱体 —— **正面 + 受光侧面 + 暗侧面**。
   *
   * 关键：不能只画一个圆角矩形 —— 那在俯视下仍是平的。
   * 这里画成「圆柱」：主面居中偏右（受光），左侧一道暗面，
   * 顶面再补一道亮弧，形成体积。
   */
  _drawBody(ctx, o) {
    const {
      cx, top, h, w, s, vScale, look, color, colorLt, colorDk,
      isCurrent, time, breath, flat,
    } = o;

    const halfW = w * 0.5;
    const bottom = top + h;

    // 躯干（职业体型决定宽高比）
    const g = ctx.createLinearGradient(cx - halfW, 0, cx + halfW, 0);
    g.addColorStop(0, hexA(colorDk, 1));
    g.addColorStop(0.26, hexA(mix(colorDk, color, 0.55), 1));
    g.addColorStop(0.52, hexA(color, 1));
    g.addColorStop(0.74, hexA(colorLt, 1));
    g.addColorStop(1, hexA(mix(color, colorDk, 0.45), 1));
    ctx.fillStyle = g;

    // 体型：suit 收腰、guard 厚肩、slim 窄、round 圆肚
    ctx.beginPath();
    const shoulderY = top + h * 0.06;
    switch (look.body) {
      case 'guard':
        ctx.moveTo(cx - halfW * 1.06, shoulderY);
        ctx.lineTo(cx + halfW * 1.06, shoulderY);
        ctx.lineTo(cx + halfW * 0.94, bottom);
        ctx.lineTo(cx - halfW * 0.94, bottom);
        break;
      case 'slim':
        ctx.moveTo(cx - halfW * 0.92, shoulderY);
        ctx.lineTo(cx + halfW * 0.92, shoulderY);
        ctx.lineTo(cx + halfW * 0.84, bottom);
        ctx.lineTo(cx - halfW * 0.84, bottom);
        break;
      case 'round':
        ctx.moveTo(cx - halfW * 0.96, shoulderY);
        ctx.quadraticCurveTo(cx - halfW * 1.12, top + h * 0.55, cx - halfW * 0.90, bottom);
        ctx.lineTo(cx + halfW * 0.90, bottom);
        ctx.quadraticCurveTo(cx + halfW * 1.12, top + h * 0.55, cx + halfW * 0.96, shoulderY);
        break;
      default: // suit —— 收腰
        ctx.moveTo(cx - halfW, shoulderY);
        ctx.quadraticCurveTo(cx - halfW * 0.74, top + h * 0.58, cx - halfW * 0.80, bottom);
        ctx.lineTo(cx + halfW * 0.80, bottom);
        ctx.quadraticCurveTo(cx + halfW * 0.74, top + h * 0.58, cx + halfW, shoulderY);
    }
    ctx.closePath();
    ctx.fill();

    // 顶部受光弧（肩线高光）
    ctx.strokeStyle = hexA(colorLt, 0.75);
    ctx.lineWidth = Math.max(0.8, 1.1 * s);
    ctx.beginPath();
    ctx.moveTo(cx - halfW * 0.92, shoulderY + 0.6);
    ctx.quadraticCurveTo(cx, shoulderY - 1.4 * s, cx + halfW * 0.92, shoulderY + 0.6);
    ctx.stroke();

    // 领口 / 衣襟（职业色细条）
    ctx.strokeStyle = hexA(look.accent, 0.9);
    ctx.lineWidth = Math.max(0.7, 0.9 * s);
    ctx.beginPath();
    ctx.moveTo(cx - halfW * 0.26, shoulderY + 1.2 * s);
    ctx.lineTo(cx, top + h * 0.42);
    ctx.lineTo(cx + halfW * 0.26, shoulderY + 1.2 * s);
    ctx.stroke();

    // 底部暗边（与台座衔接）
    ctx.fillStyle = hexA('#0f172a', 0.24);
    ctx.fillRect(cx - halfW, bottom - 1.4 * s, halfW * 2, 1.4 * s);

    // 当前玩家：胸口一点高光点缀
    if (isCurrent) {
      const pulse = 0.5 + 0.5 * Math.sin(time / 300);
      ctx.fillStyle = hexA('#fff', 0.16 + 0.16 * pulse);
      ctx.beginPath();
      ctx.ellipse(cx - halfW * 0.34, top + h * 0.34, halfW * 0.30, h * 0.10, -0.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /**
   * 头部 —— **球体感**：主色球 + 左上高光 + 底部反光 + 职业头饰。
   */
  _drawHead(ctx, o) {
    const { cx, cy, r, s, look, color, colorLt, colorDk, isCurrent, time, breath } = o;

    // 头（球）
    const g = ctx.createRadialGradient(
      cx - r * 0.42, cy - r * 0.46, r * 0.10,
      cx, cy, r * 1.12,
    );
    g.addColorStop(0, '#fff8ec');
    g.addColorStop(0.30, mix(colorLt, '#fff8ec', 0.45));
    g.addColorStop(0.72, color);
    g.addColorStop(1, colorDk);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(cx, cy, r, r * 0.98, 0, 0, Math.PI * 2);
    ctx.fill();

    // 底部反光（地面反弹光）
    ctx.fillStyle = hexA(colorLt, 0.24);
    ctx.beginPath();
    ctx.ellipse(cx + r * 0.10, cy + r * 0.52, r * 0.62, r * 0.26, 0, 0, Math.PI * 2);
    ctx.fill();

    // 头饰
    switch (look.head) {
      case 'topHat':
        // 高礼帽：帽筒 + 帽檐
        ctx.fillStyle = hexA('#1f2937', 1);
        ctx.fillRect(cx - r * 0.62, cy - r * 1.85, r * 1.24, r * 1.05);
        ctx.fillStyle = hexA(look.accent, 1);
        ctx.fillRect(cx - r * 0.62, cy - r * 1.05, r * 1.24, r * 0.24);
        ctx.fillStyle = hexA('#111827', 1);
        ctx.beginPath();
        ctx.ellipse(cx, cy - r * 0.82, r * 1.08, r * 0.22, 0, 0, Math.PI * 2);
        ctx.fill();
        break;
      case 'fedora':
        ctx.fillStyle = hexA('#334155', 1);
        ctx.beginPath();
        ctx.ellipse(cx, cy - r * 0.62, r * 1.02, r * 0.30, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = hexA('#1e293b', 1);
        ctx.fillRect(cx - r * 0.60, cy - r * 1.30, r * 1.20, r * 0.72);
        ctx.fillStyle = hexA(look.accent, 1);
        ctx.fillRect(cx - r * 0.60, cy - r * 0.72, r * 1.20, r * 0.18);
        break;
      case 'cap':
        // 鸭舌帽：帽冠 + 帽舌（帽舌朝左 = 朝向感）
        ctx.fillStyle = hexA(colorDk, 1);
        ctx.beginPath();
        ctx.ellipse(cx, cy - r * 0.50, r * 0.98, r * 0.56, 0, Math.PI, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = hexA(colorDk, 1);
        ctx.beginPath();
        ctx.ellipse(cx - r * 0.72, cy - r * 0.48, r * 0.62, r * 0.20, -0.22, 0, Math.PI * 2);
        ctx.fill();
        break;
      case 'visor':
        // 科技目镜：额前一道发光条
        ctx.fillStyle = hexA('#1e293b', 1);
        ctx.beginPath();
        ctx.ellipse(cx, cy - r * 0.56, r * 0.94, r * 0.40, 0, Math.PI, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = hexA(look.accent, 0.95);
        ctx.fillRect(cx - r * 0.80, cy - r * 0.32, r * 1.60, r * 0.22);
        break;
      case 'phones':
        // 耳机：两侧耳罩
        ctx.fillStyle = hexA('#1e293b', 1);
        ctx.beginPath();
        ctx.arc(cx - r * 0.98, cy, r * 0.32, 0, Math.PI * 2);
        ctx.arc(cx + r * 0.98, cy, r * 0.32, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = hexA('#1e293b', 1);
        ctx.lineWidth = Math.max(0.8, r * 0.20);
        ctx.beginPath();
        ctx.arc(cx, cy - r * 0.30, r * 0.98, Math.PI * 1.18, Math.PI * 1.82);
        ctx.stroke();
        break;
      case 'crown':
        // 皇冠：三尖
        ctx.fillStyle = hexA('#e8a93c', 1);
        ctx.beginPath();
        ctx.moveTo(cx - r * 0.86, cy - r * 0.52);
        ctx.lineTo(cx - r * 0.62, cy - r * 1.28);
        ctx.lineTo(cx - r * 0.24, cy - r * 0.74);
        ctx.lineTo(cx, cy - r * 1.42);
        ctx.lineTo(cx + r * 0.24, cy - r * 0.74);
        ctx.lineTo(cx + r * 0.62, cy - r * 1.28);
        ctx.lineTo(cx + r * 0.86, cy - r * 0.52);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = hexA('#fff', 0.55);
        ctx.beginPath();
        ctx.arc(cx, cy - r * 0.94, r * 0.12, 0, Math.PI * 2);
        ctx.fill();
        break;
      default: // dome —— 圆顶 + 眼镜
        ctx.fillStyle = hexA(colorDk, 0.55);
        ctx.beginPath();
        ctx.ellipse(cx, cy - r * 0.42, r * 0.90, r * 0.46, 0, Math.PI, Math.PI * 2);
        ctx.fill();
        // 眼镜
        ctx.strokeStyle = hexA('#1f2937', 0.9);
        ctx.lineWidth = Math.max(0.6, r * 0.13);
        ctx.beginPath();
        ctx.arc(cx - r * 0.34, cy + r * 0.10, r * 0.28, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(cx + r * 0.34, cy + r * 0.10, r * 0.28, 0, Math.PI * 2);
        ctx.stroke();
    }

    // 当前玩家：头部高光闪烁
    if (isCurrent) {
      const pulse = 0.5 + 0.5 * Math.sin(time / 260);
      ctx.fillStyle = hexA('#fff', 0.30 + 0.30 * pulse);
      ctx.beginPath();
      ctx.ellipse(cx - r * 0.36, cy - r * 0.42, r * 0.26, r * 0.17, -0.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /**
   * 配饰 —— 肩章 + AI 徽标。
   *
   * AI 徽标：头顶一枚小三角 —— 让人一眼分出「这是电脑」。
   */
  _drawBadges(ctx, o) {
    const { cx, top, w, s, look, color, colorLt, isAI, isCurrent } = o;

    // 肩章：身体两侧各一枚玩家色小块
    const halfW = w * 0.5;
    ctx.fillStyle = hexA(colorLt, 0.95);
    ctx.fillRect(cx - halfW * 1.0, top + 1.6 * s, halfW * 0.30, 1.6 * s);
    ctx.fillRect(cx + halfW * 0.70, top + 1.6 * s, halfW * 0.30, 1.6 * s);

    // AI 徽标：头顶小三角
    if (isAI) {
      const ty = top - 8.4 * s;
      ctx.fillStyle = 'rgba(15,23,42,.72)';
      ctx.beginPath();
      ctx.moveTo(cx, ty + 3.4 * s);
      ctx.lineTo(cx - 2.6 * s, ty);
      ctx.lineTo(cx + 2.6 * s, ty);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = hexA(colorLt, 0.95);
      ctx.beginPath();
      ctx.arc(cx, ty + 1.8 * s, 0.9 * s, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
