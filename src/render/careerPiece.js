/**
 * 职业棋子建模 —— **真正的立体棋子**（2.5D / 3D 台座式）。
 *
 * ================== 为什么需要这个模块 ==================
 * 此前棋盘上的角色是「一张职业立绘 + 一个通用柱体」：
 *   · 立绘（32×40 矢量）是**正面平贴**的 —— 没有厚度，像贴纸；
 *   · 通用柱体的体型差异只有 ±8%，7 个职业的**剪影几乎一样**；
 *   · 立绘浮在柱体上方，两者是「贴在一起」，不是「长在一起」。
 *
 * 用户反馈「角色棋子没有建模并展示」—— 根因正是：
 * **没有一个可辨识的「棋子」**，只有一张画。
 *
 * ================== 本模块的建模思路 ==================
 * 用**国际象棋棋子**的语汇重做职业棋子 —— 这是「棋子」最经典的形象：
 *
 *   ┌ 台座（base）──── 圆盘 + 侧壁 + 刻线，3D 下有真实厚度
 *   ├ 杆身（shaft）── 职业专属**旋转体轮廓**（关键辨识点）
 *   ├ 头饰（crown）── 职业专属头饰（帽 / 冠 / 目镜 / 耳机 …）
 *   └ 职业徽记（emblem）—— 台座正面的职业色徽记
 *
 * 辨识度来自**剪影**，而不是颜色：
 *   投行家 = 细高杆 + 高礼帽      赌王   = 粗壮杆 + 皇冠
 *   风控总监 = 中宽杆 + 鸭舌帽    量化研究员 = 极瘦杆 + 科技目镜
 *   精算师 = 鼓腹杆 + 圆顶眼镜    交易员 = 细杆 + 耳机
 *   基金经理 = 标准杆 + 礼帽
 *
 * ================== 与既有系统的关系 ==================
 * · 配色全部取自 `core/palette.js` 的 PLAYER_COLORS —— 与棋盘地块、
 *   HUD 头像、扑克座位**完全一致**，不存在「两套颜色」。
 * · 职业 id ↔ 棋子造型映射来自 `core/careers.js` 的 pieceIndex（7~13）。
 * · 立绘仍会画在棋子**之上**（提供脸 / 服饰细节），
 *   但棋子在 3D 下**自带完整体积**，即使立绘缺失也依然是「一个棋子」。
 */

import { PLAYER_COLORS } from '../core/palette.js';

/**
 * 全局光源方向 —— 与 `charEntity.js` / `tiles-3d.css` / `hover-building.css`
 * **完全一致**（左上后方）。
 *
 * ⚠ 为什么必须一致：
 *   棋子、地块、建筑三种立体物如果光照方向不同，
 *   整个棋盘会「互相打架」—— 看起来像几个不同游戏拼在一起。
 */
export const LIGHT = { x: -0.55, y: -0.62 };

/* ===================================================================
 * 工具
 * =================================================================== */

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

/** 两个 hex 混合（t=0 取 A，t=1 取 B） */
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

/* ===================================================================
 * 职业 → 棋子造型定义
 * =================================================================== */

/**
 * 每个职业的**造型参数**。
 *
 * `profile` 是**旋转体轮廓**的关键点序列 —— 描述杆身从下到上的
 * 「半宽」变化。它决定剪影，因此决定辨识度。
 *
 *   profile: [ { y: 0..1, w: 相对半宽 } ... ]  （y=0 台面，y=1 顶端）
 */
export const CAREER_PIECES = {
  // 投行家 —— 高礼帽 + 细高杆（精英、挺拔）
  7: {
    id: 'ib', name: '投行家',
    profile: [
      { y: 0.00, w: 1.00 }, { y: 0.14, w: 0.78 }, { y: 0.34, w: 0.52 },
      { y: 0.56, w: 0.46 }, { y: 0.74, w: 0.54 }, { y: 0.88, w: 0.40 },
    ],
    crown: 'topHat', emblem: 'doc', accent: '#e8a93c', height: 1.12, base: 1.0,
  },
  // 风控总监 —— 鸭舌帽 + 中宽厚肩杆（守卫感）
  8: {
    id: 'risk', name: '风控总监',
    profile: [
      { y: 0.00, w: 1.12 }, { y: 0.16, w: 0.92 }, { y: 0.36, w: 0.78 },
      { y: 0.58, w: 0.74 }, { y: 0.78, w: 0.66 }, { y: 0.90, w: 0.48 },
    ],
    crown: 'cap', emblem: 'shield', accent: '#3fc6c6', height: 0.98, base: 1.14,
  },
  // 精算师 —— 圆顶 + 鼓腹杆（圆润、理性）
  9: {
    id: 'actuary', name: '精算师',
    profile: [
      { y: 0.00, w: 1.02 }, { y: 0.18, w: 0.94 }, { y: 0.40, w: 1.00 },
      { y: 0.60, w: 0.82 }, { y: 0.80, w: 0.62 }, { y: 0.92, w: 0.42 },
    ],
    crown: 'dome', emblem: 'calc', accent: '#e05a4a', height: 0.96, base: 1.06,
  },
  // 量化研究员 —— 科技目镜 + 极瘦杆（科技、锐利）
  10: {
    id: 'quant', name: '量化研究员',
    profile: [
      { y: 0.00, w: 0.92 }, { y: 0.16, w: 0.66 }, { y: 0.38, w: 0.48 },
      { y: 0.60, w: 0.42 }, { y: 0.80, w: 0.50 }, { y: 0.92, w: 0.34 },
    ],
    crown: 'visor', emblem: 'chart', accent: '#b07ce8', height: 1.06, base: 0.94,
  },
  // 基金经理 —— 礼帽 + 标准杆（稳重）
  11: {
    id: 'fund', name: '基金经理',
    profile: [
      { y: 0.00, w: 1.04 }, { y: 0.16, w: 0.82 }, { y: 0.38, w: 0.60 },
      { y: 0.58, w: 0.54 }, { y: 0.78, w: 0.62 }, { y: 0.90, w: 0.46 },
    ],
    crown: 'fedora', emblem: 'scale', accent: '#e8a93c', height: 1.0, base: 1.04,
  },
  // 交易员 —— 耳机 + 细杆前倾（凌厉、敏捷）
  12: {
    id: 'trader', name: '交易员',
    profile: [
      { y: 0.00, w: 0.90 }, { y: 0.16, w: 0.70 }, { y: 0.38, w: 0.52 },
      { y: 0.58, w: 0.48 }, { y: 0.78, w: 0.54 }, { y: 0.90, w: 0.40 },
    ],
    crown: 'phones', emblem: 'arrow', accent: '#3fc6c6', height: 1.02, base: 0.92,
  },
  // 赌王 —— 皇冠 + 粗壮杆（张扬、压迫感）
  13: {
    id: 'king', name: '赌王',
    profile: [
      { y: 0.00, w: 1.24 }, { y: 0.16, w: 1.04 }, { y: 0.38, w: 0.90 },
      { y: 0.60, w: 0.84 }, { y: 0.80, w: 0.76 }, { y: 0.92, w: 0.54 },
    ],
    crown: 'crown', emblem: 'chip', accent: '#e8a93c', height: 1.02, base: 1.22,
  },
};

/** 兜底造型（职业 id 非法时） */
const DEFAULT_PIECE = CAREER_PIECES[7];

/**
 * 取职业棋子造型。
 * @param {number} pieceIndex 职业立绘索引（7~13）
 */
export function pieceOf(pieceIndex) {
  return CAREER_PIECES[pieceIndex] || DEFAULT_PIECE;
}

/**
 * 造型「差异指纹」—— 供自检断言 7 个职业两两不同。
 * 包含轮廓 / 头饰 / 徽记 / 比例，任何一项不同即视为不同造型。
 */
export function pieceSignature(pieceIndex) {
  const p = pieceOf(pieceIndex);
  return [
    p.id, p.crown, p.emblem, p.height, p.base,
    p.profile.map((k) => `${k.y}:${k.w}`).join('|'),
  ].join('/');
}

/**
 * 按轮廓插值求某个高度的**相对半宽**。
 * @param {object} piece 造型定义
 * @param {number} t 0（台面）~ 1（顶端）
 */
function profileWidth(piece, t) {
  const pr = piece.profile;
  if (t <= pr[0].y) return pr[0].w;
  for (let i = 1; i < pr.length; i++) {
    if (t <= pr[i].y) {
      const a = pr[i - 1];
      const b = pr[i];
      const k = (t - a.y) / Math.max(1e-6, b.y - a.y);
      // 平滑插值（smoothstep）—— 轮廓转折柔和，不出现折线硬角
      const e = k * k * (3 - 2 * k);
      return a.w + (b.w - a.w) * e;
    }
  }
  return pr[pr.length - 1].w;
}

/* ===================================================================
 * 渲染器
 * =================================================================== */

/**
 * 职业棋子渲染器。
 *
 * 持有**跨帧缓存**：
 *   · 台座渐变（按玩家色缓存）
 *   · 杆身轮廓路径（按造型 + 尺寸缓存）
 * 避免每帧重建渐变对象。
 */
export class CareerPieceRenderer {
  constructor() {
    /** 本帧绘制的棋子数（供自检断言） */
    this.pieceCount = 0;
    /** 轮廓路径缓存：key = `${pieceId}|${wPx}|${hPx}` */
    this._shaftCache = new Map();
    /** 台座渐变缓存：key = `${color}|${wPx}|${flat}` */
    this._baseCache = new Map();
  }

  /** 供外部断言使用 */
  get lastPieceCount() {
    return this.pieceCount;
  }

  /** 重置计数（每帧由 canvas.js 调用） */
  resetCount() {
    this.pieceCount = 0;
  }

  /**
   * 绘制一个职业棋子。
   *
   * @param {CanvasRenderingContext2D} ctx
   * @param {object} o
   *   cx, cy   —— 脚底中心（屏幕坐标，cy = 地面）
   *   s        —— 缩放倍数
   *   color / colorLt / colorDk —— 玩家三色
   *   pieceIndex —— 职业索引（7~13）
   *   isCurrent —— 是否当前回合（呼吸光晕）
   *   isAI     —— 是否 AI（头顶徽标）
   *   selected —— 是否被选中（额外高亮环）
   *   hovered  —— 是否被 hover（轻微提亮）
   *   time     —— 动画时间
   *   flat     —— 是否 3D 俯视压扁
   *   lean     —— 朝向微倾（-1~1）
   *   bob      —— 弹跳位移
   *   squash   —— {sx, sy} 落地压缩
   */
  draw(ctx, o) {
    const {
      cx, cy, s, color, colorLt, colorDk, pieceIndex,
      isCurrent = false, isAI = false, selected = false, hovered = false,
      time = 0, flat = false, lean = 0, bob = 0, squash = null,
    } = o;

    const piece = pieceOf(pieceIndex);
    const look = this._lookOf(pieceIndex, color, colorLt, colorDk);

    // 3D 俯视：立着的物体只压扁一部分（保留体积感）
    const vScale = flat ? 0.74 : 1;

    // 呼吸 —— 当前回合明显起伏，其他几乎静止
    const breathAmt = isCurrent ? 1 : 0.20;
    const breath = Math.sin(time / 420) * 0.9 * breathAmt * s;

    const sx = squash ? squash.sx : 1;
    const sy = squash ? squash.sy : 1;

    // ---- 尺寸（以 s 为基准，与格子尺度挂钩）----
    const baseW = 13.5 * s * piece.base;      // 台座直径
    const shaftH = 20 * s * piece.height;     // 杆身高
    const shaftW = 7.6 * s * piece.base;      // 杆身最大半宽基准
    const crownR = 4.6 * s;                  // 头饰半径

    const footY = cy + bob;

    ctx.save();

    // ---------- ① 接地阴影（最底层，不随压缩 / 倾斜）----------
    this._drawGroundShadow(ctx, {
      cx, footY, baseW, s, vScale,
    });

    // ---------- ② 整体倾斜 + 压缩 ----------
    if (lean) {
      ctx.translate(cx, footY);
      ctx.transform(1, 0, lean * 0.15, 1, 0, 0);
      ctx.translate(-cx, -footY);
    }
    if (squash) {
      ctx.translate(cx, footY);
      ctx.scale(sx, sy);
      ctx.translate(-cx, -footY);
    }

    // ---------- ③ 台座（立体圆盘 + 侧壁）----------
    const baseTopY = footY - 3.2 * s * vScale + breath * 0.25;
    this._drawBase(ctx, {
      cx, baseTopY, baseW, s, vScale, look,
      isCurrent, selected, hovered, time,
    });

    // ---------- ④ 杆身（职业轮廓旋转体）----------
    const shaftTopY = baseTopY - shaftH * vScale;
    this._drawShaft(ctx, {
      cx, top: shaftTopY, h: shaftH * vScale, w: shaftW,
      s, vScale, piece, look, breath,
    });

    // ---------- ⑤ 头饰（职业辨识的第二关键）----------
    const crownY = shaftTopY - crownR * 0.35;
    this._drawCrown(ctx, {
      cx, cy: crownY, r: crownR, s, look, piece,
      isCurrent, time, vScale,
    });

    // ---------- ⑥ 职业徽记（台座正面）----------
    this._drawEmblem(ctx, {
      cx, cy: baseTopY - 1.6 * s * vScale, r: 2.6 * s, look, piece, vScale,
    });

    // ---------- ⑦ 状态标记 ----------
    if (isAI) this._drawAiBadge(ctx, { cx, cy: crownY - crownR * 1.7, s, colorLt });
    if (selected) this._drawSelectionRing(ctx, { cx, cy: footY, baseW, s, vScale, look, time });
    else if (hovered) this._drawHoverRing(ctx, { cx, cy: footY, baseW, s, vScale, look });

    ctx.restore();
    this.pieceCount++;
  }

  /** 造型配色（accent 由职业决定，三色阶由玩家决定） */
  _lookOf(pieceIndex, color, colorLt, colorDk) {
    const piece = pieceOf(pieceIndex);
    return {
      main: color, lt: colorLt, dk: colorDk,
      accent: piece.accent,
      accentLt: mix(piece.accent, '#ffffff', 0.32),
      accentDk: mix(piece.accent, '#000000', 0.34),
    };
  }

  /* ------------------------------------------------------------------
   * 接地阴影 —— 两层椭圆（紧实 + 扩散）
   * ------------------------------------------------------------------ */
  _drawGroundShadow(ctx, o) {
    const { cx, footY, baseW, s, vScale } = o;
    const rx = baseW * 0.52;
    const ry = baseW * 0.17 * vScale;

    ctx.save();
    ctx.fillStyle = 'rgba(15,23,42,.30)';
    ctx.beginPath();
    ctx.ellipse(cx + baseW * 0.10, footY + 1.4 * s, rx * 0.90, ry, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = 'rgba(15,23,42,.14)';
    ctx.beginPath();
    ctx.ellipse(cx + baseW * 0.14, footY + 1.0 * s, rx * 1.16, ry * 1.30, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /* ------------------------------------------------------------------
   * 台座 —— 圆盘 + 侧壁 + 双圈刻线 + 当前回合呼吸光晕
   *
   * 3D 下台面压扁成椭圆（俯视投影），侧壁保留真实厚度。
   * ------------------------------------------------------------------ */
  _drawBase(ctx, o) {
    const { cx, baseTopY, baseW, s, vScale, look, isCurrent, selected, hovered, time } = o;

    const rx = baseW * 0.5;
    const ry = rx * 0.40 * vScale;      // 台面椭圆短半轴（俯视压缩）
    const wallH = 3.2 * s * vScale;     // 侧壁高

    // ---- 侧壁（梯形柱面：左暗右亮，与全局光源一致）----
    const wallGrad = ctx.createLinearGradient(cx - rx, 0, cx + rx, 0);
    wallGrad.addColorStop(0, hexA(look.dk, 0.94));
    wallGrad.addColorStop(0.28, hexA(look.dk, 0.72));
    wallGrad.addColorStop(0.60, hexA(look.main, 0.58));
    wallGrad.addColorStop(1, hexA(look.dk, 0.90));
    ctx.fillStyle = wallGrad;
    ctx.beginPath();
    ctx.ellipse(cx, baseTopY, rx, ry, 0, Math.PI, Math.PI * 2);
    ctx.lineTo(cx + rx, baseTopY + wallH);
    ctx.ellipse(cx, baseTopY + wallH, rx, ry * 0.94, 0, 0, Math.PI);
    ctx.closePath();
    ctx.fill();

    // ---- 台面（径向渐变：高光在左上）----
    const topGrad = ctx.createRadialGradient(
      cx - rx * 0.38, baseTopY - ry * 0.50, 0,
      cx, baseTopY, rx * 1.15,
    );
    topGrad.addColorStop(0, hexA(look.lt, 0.96));
    topGrad.addColorStop(0.52, hexA(look.main, 0.74));
    topGrad.addColorStop(1, hexA(look.dk, 0.82));
    ctx.fillStyle = topGrad;
    ctx.beginPath();
    ctx.ellipse(cx, baseTopY, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();

    // ---- 外圈刻线 ----
    ctx.strokeStyle = hexA(look.lt, 0.58);
    ctx.lineWidth = Math.max(0.7, 0.9 * s);
    ctx.beginPath();
    ctx.ellipse(cx, baseTopY, rx, ry, 0, 0, Math.PI * 2);
    ctx.stroke();

    // ---- 内圈刻线 ----
    ctx.strokeStyle = hexA(look.dk, 0.44);
    ctx.lineWidth = Math.max(0.5, 0.6 * s);
    ctx.beginPath();
    ctx.ellipse(cx, baseTopY, rx * 0.66, ry * 0.66, 0, 0, Math.PI * 2);
    ctx.stroke();

    // ---- 当前回合：呼吸光晕（画在台面上方）----
    if (isCurrent) {
      const pulse = 0.5 + 0.5 * Math.sin(time / 300);
      const halo = ctx.createRadialGradient(cx, baseTopY, 0, cx, baseTopY, rx * 2.1);
      halo.addColorStop(0, hexA(look.lt, 0.32 + 0.24 * pulse));
      halo.addColorStop(0.5, hexA(look.main, 0.13 * pulse));
      halo.addColorStop(1, hexA(look.main, 0));
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.ellipse(cx, baseTopY, rx * 2.1, rx * 2.1 * 0.44 * vScale, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /* ------------------------------------------------------------------
   * 杆身 —— 职业轮廓旋转体
   *
   * 画法：沿 profile 采样出左右两条边界 → 拼成闭合路径，
   * 再用**横向渐变**填充（左暗 → 中亮 → 右暗）形成圆柱体积。
   * ------------------------------------------------------------------ */
  _drawShaft(ctx, o) {
    const { cx, top, h, w, s, vScale, piece, look, breath } = o;

    const halfW = w * 0.5;
    const steps = 16;
    const path = this._shaftPath(piece, cx, top, h, halfW, vScale);

    // ---- 体积：横向渐变（左暗 → 受光面偏左中 → 右暗）----
    const g = ctx.createLinearGradient(cx - halfW * 1.3, 0, cx + halfW * 1.3, 0);
    g.addColorStop(0, hexA(look.dk, 1));
    g.addColorStop(0.22, hexA(mix(look.dk, look.main, 0.55), 1));
    g.addColorStop(0.46, hexA(look.main, 1));
    g.addColorStop(0.68, hexA(look.lt, 1));
    g.addColorStop(0.88, hexA(mix(look.main, look.dk, 0.42), 1));
    g.addColorStop(1, hexA(look.dk, 1));
    ctx.fillStyle = g;
    ctx.fill(path);

    // ---- 轮廓暗边（把棋子从背景里「抠」出来）----
    ctx.strokeStyle = hexA(look.dk, 0.72);
    ctx.lineWidth = Math.max(0.7, 0.85 * s);
    ctx.stroke(path);

    // ---- 高光竖条（受光侧）----
    ctx.save();
    ctx.clip(path);
    ctx.fillStyle = hexA(look.lt, 0.30);
    ctx.beginPath();
    ctx.ellipse(cx - halfW * 0.30, top + h * 0.42, halfW * 0.24, h * 0.34, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // ---- 职业色环带（在杆身 1/3 高处，标明职业归属）----
    const bandY = top + h * 0.66;
    const bandW = halfW * profileWidth(piece, 0.66) * 1.02;
    ctx.fillStyle = hexA(look.accent, 0.95);
    ctx.beginPath();
    ctx.ellipse(cx, bandY, bandW, Math.max(0.8, bandW * 0.30 * vScale), 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = hexA(look.accentLt, 0.55);
    ctx.beginPath();
    ctx.ellipse(cx, bandY - bandW * 0.10 * vScale, bandW * 0.82, Math.max(0.5, bandW * 0.18 * vScale), 0, 0, Math.PI * 2);
    ctx.fill();

    // ---- 顶部高光弧（肩线）----
    ctx.strokeStyle = hexA(look.lt, 0.62);
    ctx.lineWidth = Math.max(0.7, 0.95 * s);
    ctx.beginPath();
    ctx.ellipse(cx, top + h * 0.05, halfW * profileWidth(piece, 0.05) * 0.94, halfW * 0.26 * vScale, 0, 0, Math.PI * 2);
    ctx.stroke();

    // ---- 当前回合：胸口一点闪动高光 ----
    // （由调用方在 crown 层补充，此处保持杆身干净）
    void breath;
  }

  /**
   * 杆身轮廓路径（带缓存）。
   *
   * 缓存 key = `${pieceId}|${cx}|${top}|${h}|${halfW}|${vScale}`
   */
  _shaftPath(piece, cx, top, h, halfW, vScale) {
    const key = `${piece.id}|${cx.toFixed(1)}|${top.toFixed(1)}|${h.toFixed(1)}`
      + `|${halfW.toFixed(1)}|${vScale.toFixed(2)}`;
    const cached = this._shaftCache.get(key);
    if (cached) return cached;

    const p = new Path2D();
    const steps = 16;
    const pts = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const wRel = profileWidth(piece, t);
      // t=0 是台面（最宽），t=1 是顶端
      const y = top + h * (1 - t);
      pts.push({ y, w: halfW * wRel });
    }
    // 右侧向下
    p.moveTo(cx + pts[0].w, pts[0].y);
    for (let i = 1; i < pts.length; i++) p.lineTo(cx + pts[i].w, pts[i].y);
    // 顶端圆滑收口
    const topPt = pts[pts.length - 1];
    p.quadraticCurveTo(cx + topPt.w, topPt.y - topPt.w * 0.55, cx, topPt.y - topPt.w * 0.72);
    // 左侧向上
    for (let i = pts.length - 2; i >= 0; i--) p.lineTo(cx - pts[i].w, pts[i].y);
    p.quadraticCurveTo(cx - pts[0].w, pts[0].y - pts[0].w * 0.55, cx - pts[0].w, pts[0].y);
    p.closePath();

    // 缓存有上限 —— 防止长时间游戏后无限增长
    if (this._shaftCache.size > 256) this._shaftCache.clear();
    this._shaftCache.set(key, p);
    return p;
  }

  /* ------------------------------------------------------------------
   * 头饰 —— 职业辨识的第一关键（剪影）
   * ------------------------------------------------------------------ */
  _drawCrown(ctx, o) {
    const { cx, cy, r, s, look, piece, isCurrent, time, vScale } = o;

    switch (piece.crown) {
      case 'topHat': {
        // 高礼帽：帽筒 + 帽檐 + 帽带
        const hatH = r * 1.75;
        const hatW = r * 0.98;
        ctx.fillStyle = hexA('#1f2937', 1);
        ctx.fillRect(cx - hatW * 0.62, cy - r * 0.55 - hatH, hatW * 1.24, hatH);
        // 帽带（职业色）
        ctx.fillStyle = hexA(look.accent, 1);
        ctx.fillRect(cx - hatW * 0.62, cy - r * 0.55 - hatH * 0.30, hatW * 1.24, hatH * 0.18);
        // 帽檐
        ctx.fillStyle = hexA('#111827', 1);
        ctx.beginPath();
        ctx.ellipse(cx, cy - r * 0.55, hatW * 1.12, r * 0.24, 0, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'fedora': {
        // 礼帽：帽檐 + 帽冠 + 帽带
        ctx.fillStyle = hexA('#334155', 1);
        ctx.beginPath();
        ctx.ellipse(cx, cy - r * 0.42, r * 1.02, r * 0.30, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = hexA('#1e293b', 1);
        ctx.fillRect(cx - r * 0.60, cy - r * 0.42 - r * 1.02, r * 1.20, r * 0.82);
        ctx.fillStyle = hexA(look.accent, 1);
        ctx.fillRect(cx - r * 0.60, cy - r * 0.42 - r * 0.42, r * 1.20, r * 0.16);
        break;
      }
      case 'cap': {
        // 鸭舌帽：帽冠 + 帽舌（朝左 = 朝向感）
        ctx.fillStyle = hexA(look.dk, 1);
        ctx.beginPath();
        ctx.ellipse(cx, cy - r * 0.42, r * 0.96, r * 0.58, 0, Math.PI, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = hexA(look.dk, 1);
        ctx.beginPath();
        ctx.ellipse(cx - r * 0.68, cy - r * 0.40, r * 0.60, r * 0.19, -0.22, 0, Math.PI * 2);
        ctx.fill();
        // 帽顶职业色纽扣
        ctx.fillStyle = hexA(look.accent, 0.95);
        ctx.beginPath();
        ctx.arc(cx, cy - r * 0.92, r * 0.13, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'visor': {
        // 科技目镜：额前发光条 + 侧框
        ctx.fillStyle = hexA('#1e293b', 1);
        ctx.beginPath();
        ctx.ellipse(cx, cy - r * 0.30, r * 0.94, r * 0.42, 0, Math.PI, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = hexA(look.accent, 0.95);
        ctx.fillRect(cx - r * 0.80, cy - r * 0.16, r * 1.60, r * 0.22);
        // 目镜上方小天线
        ctx.strokeStyle = hexA(look.accentLt, 0.85);
        ctx.lineWidth = Math.max(0.7, r * 0.14);
        ctx.beginPath();
        ctx.moveTo(cx + r * 0.60, cy - r * 0.52);
        ctx.lineTo(cx + r * 0.86, cy - r * 1.08);
        ctx.stroke();
        break;
      }
      case 'phones': {
        // 耳机：两侧耳罩 + 头梁
        ctx.strokeStyle = hexA('#1e293b', 1);
        ctx.lineWidth = Math.max(0.9, r * 0.24);
        ctx.beginPath();
        ctx.arc(cx, cy - r * 0.18, r * 0.92, Math.PI * 1.16, Math.PI * 1.84);
        ctx.stroke();
        ctx.fillStyle = hexA('#1e293b', 1);
        ctx.beginPath();
        ctx.arc(cx - r * 0.92, cy - r * 0.10, r * 0.34, 0, Math.PI * 2);
        ctx.arc(cx + r * 0.92, cy - r * 0.10, r * 0.34, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = hexA(look.accent, 0.95);
        ctx.beginPath();
        ctx.arc(cx + r * 0.92, cy - r * 0.10, r * 0.15, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'crown': {
        // 皇冠：三尖 + 宝珠
        ctx.fillStyle = hexA(look.accent, 1);
        ctx.beginPath();
        ctx.moveTo(cx - r * 0.90, cy - r * 0.20);
        ctx.lineTo(cx - r * 0.66, cy - r * 1.18);
        ctx.lineTo(cx - r * 0.28, cy - r * 0.58);
        ctx.lineTo(cx, cy - r * 1.34);
        ctx.lineTo(cx + r * 0.28, cy - r * 0.58);
        ctx.lineTo(cx + r * 0.66, cy - r * 1.18);
        ctx.lineTo(cx + r * 0.90, cy - r * 0.20);
        ctx.closePath();
        ctx.fill();
        // 宝珠
        ctx.fillStyle = hexA(look.accentLt, 0.85);
        ctx.beginPath();
        ctx.arc(cx, cy - r * 0.82, r * 0.14, 0, Math.PI * 2);
        ctx.fill();
        // 冠带
        ctx.fillStyle = hexA(look.accentDk, 1);
        ctx.fillRect(cx - r * 0.90, cy - r * 0.28, r * 1.80, r * 0.18);
        break;
      }
      default: {
        // dome —— 圆顶 + 眼镜
        ctx.fillStyle = hexA(look.dk, 0.60);
        ctx.beginPath();
        ctx.ellipse(cx, cy - r * 0.28, r * 0.88, r * 0.46, 0, Math.PI, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = hexA('#1f2937', 0.9);
        ctx.lineWidth = Math.max(0.6, r * 0.14);
        ctx.beginPath();
        ctx.arc(cx - r * 0.34, cy + r * 0.20, r * 0.28, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(cx + r * 0.34, cy + r * 0.20, r * 0.28, 0, Math.PI * 2);
        ctx.stroke();
        break;
      }
    }

    // ---- 当前回合：头饰高光闪烁 ----
    if (isCurrent) {
      const pulse = 0.5 + 0.5 * Math.sin(time / 260);
      ctx.fillStyle = hexA('#fff', 0.26 + 0.28 * pulse);
      ctx.beginPath();
      ctx.ellipse(cx - r * 0.34, cy - r * 0.46, r * 0.24, r * 0.15, -0.6, 0, Math.PI * 2);
      ctx.fill();
    }
    void vScale;
  }

  /* ------------------------------------------------------------------
   * 职业徽记 —— 台座正面的小图标（职业第三辨识点）
   * ------------------------------------------------------------------ */
  _drawEmblem(ctx, o) {
    const { cx, cy, r, look, piece, vScale } = o;
    const w = r * 2;

    ctx.save();
    // 徽记底盘
    ctx.fillStyle = hexA('#ffffff', 0.88);
    ctx.beginPath();
    ctx.ellipse(cx, cy, w * 0.5, w * 0.5 * (0.55 + 0.45 * vScale), 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = hexA(look.accent, 0.95);
    ctx.lineWidth = Math.max(0.6, r * 0.20);
    ctx.stroke();

    // 图标本体（职业色）
    ctx.fillStyle = look.accentDk;
    ctx.strokeStyle = look.accentDk;
    ctx.lineWidth = Math.max(0.6, r * 0.22);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const u = r * 0.62;   // 图标单位

    switch (piece.emblem) {
      case 'doc':      // 承销 —— 文件
        ctx.beginPath();
        ctx.moveTo(cx - u * 0.55, cy - u * 0.75);
        ctx.lineTo(cx + u * 0.25, cy - u * 0.75);
        ctx.lineTo(cx + u * 0.60, cy - u * 0.40);
        ctx.lineTo(cx + u * 0.60, cy + u * 0.75);
        ctx.lineTo(cx - u * 0.55, cy + u * 0.75);
        ctx.closePath();
        ctx.fill();
        break;
      case 'shield':   // 风控 —— 盾牌
        ctx.beginPath();
        ctx.moveTo(cx, cy - u * 0.85);
        ctx.lineTo(cx + u * 0.68, cy - u * 0.45);
        ctx.quadraticCurveTo(cx + u * 0.62, cy + u * 0.55, cx, cy + u * 0.90);
        ctx.quadraticCurveTo(cx - u * 0.62, cy + u * 0.55, cx - u * 0.68, cy - u * 0.45);
        ctx.closePath();
        ctx.fill();
        break;
      case 'calc':     // 精算 —— 计算器
        ctx.fillRect(cx - u * 0.62, cy - u * 0.82, u * 1.24, u * 1.64);
        ctx.fillStyle = hexA('#ffffff', 0.92);
        ctx.fillRect(cx - u * 0.42, cy - u * 0.62, u * 0.84, u * 0.44);
        break;
      case 'chart':    // 量化 —— 折线图
        ctx.beginPath();
        ctx.moveTo(cx - u * 0.72, cy + u * 0.62);
        ctx.lineTo(cx - u * 0.22, cy - u * 0.10);
        ctx.lineTo(cx + u * 0.14, cy + u * 0.28);
        ctx.lineTo(cx + u * 0.74, cy - u * 0.70);
        ctx.stroke();
        break;
      case 'scale':    // 基金 —— 天平
        ctx.beginPath();
        ctx.moveTo(cx, cy - u * 0.82);
        ctx.lineTo(cx, cy + u * 0.72);
        ctx.moveTo(cx - u * 0.72, cy - u * 0.42);
        ctx.lineTo(cx + u * 0.72, cy - u * 0.42);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(cx, cy - u * 0.42, u * 0.16, 0, Math.PI * 2);
        ctx.fill();
        break;
      case 'arrow':    // 交易 —— 上行箭头
        ctx.beginPath();
        ctx.moveTo(cx - u * 0.68, cy + u * 0.48);
        ctx.lineTo(cx - u * 0.10, cy - u * 0.18);
        ctx.lineTo(cx + u * 0.20, cy + u * 0.16);
        ctx.lineTo(cx + u * 0.70, cy - u * 0.62);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(cx + u * 0.70, cy - u * 0.62);
        ctx.lineTo(cx + u * 0.70, cy - u * 0.10);
        ctx.lineTo(cx + u * 0.20, cy - u * 0.62);
        ctx.closePath();
        ctx.fill();
        break;
      case 'chip':     // 赌王 —— 筹码
        ctx.beginPath();
        ctx.ellipse(cx, cy, u * 0.80, u * 0.56, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = hexA('#ffffff', 0.9);
        ctx.beginPath();
        ctx.ellipse(cx, cy, u * 0.36, u * 0.25, 0, 0, Math.PI * 2);
        ctx.fill();
        break;
      default:
        ctx.beginPath();
        ctx.arc(cx, cy, u * 0.5, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.restore();
  }

  /* ------------------------------------------------------------------
   * AI 徽标 —— 头顶小三角
   * ------------------------------------------------------------------ */
  _drawAiBadge(ctx, o) {
    const { cx, cy, s, colorLt } = o;
    ctx.fillStyle = 'rgba(15,23,42,.74)';
    ctx.beginPath();
    ctx.moveTo(cx, cy + 3.4 * s);
    ctx.lineTo(cx - 2.6 * s, cy);
    ctx.lineTo(cx + 2.6 * s, cy);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = hexA(colorLt, 0.95);
    ctx.beginPath();
    ctx.arc(cx, cy + 1.8 * s, 0.9 * s, 0, Math.PI * 2);
    ctx.fill();
  }

  /* ------------------------------------------------------------------
   * 选中环 —— 双圈 + 旋转刻线
   * ------------------------------------------------------------------ */
  _drawSelectionRing(ctx, o) {
    const { cx, cy, baseW, s, vScale, look, time } = o;
    const rx = baseW * 0.72;
    const ry = rx * 0.40 * vScale;

    ctx.save();
    ctx.strokeStyle = hexA(look.lt, 0.95);
    ctx.lineWidth = Math.max(1.1, 1.6 * s);
    ctx.setLineDash([rx * 0.42, rx * 0.26]);
    ctx.lineDashOffset = -(time / 26) % (rx * 0.68);
    ctx.beginPath();
    ctx.ellipse(cx, cy + 1.0 * s, rx, ry, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  /* ------------------------------------------------------------------
   * hover 环 —— 淡色实线
   * ------------------------------------------------------------------ */
  _drawHoverRing(ctx, o) {
    const { cx, cy, baseW, s, vScale, look } = o;
    const rx = baseW * 0.66;
    const ry = rx * 0.40 * vScale;
    ctx.strokeStyle = hexA(look.lt, 0.55);
    ctx.lineWidth = Math.max(0.8, 1.1 * s);
    ctx.beginPath();
    ctx.ellipse(cx, cy + 1.0 * s, rx, ry, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
}

/**
 * 取得玩家三色（供外部模块复用，避免各处重复取模运算）。
 * @param {number} colorIndex 玩家配色索引
 */
export function playerTones(colorIndex) {
  const pc = PLAYER_COLORS[colorIndex % PLAYER_COLORS.length];
  return { main: pc.main, lt: pc.lt, dk: pc.dk };
}
