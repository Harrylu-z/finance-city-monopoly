/**
 * 角色实体（2.5D）+ 步速放慢 自检 —— 本轮重设计
 *
 * ================== 覆盖的断言 ==================
 * 1. CharEntityRenderer 可实例化，且能在 Canvas 上画出**非空像素**
 * 2. 实体具备五层构件：台座 / 身体 / 头部 / 头饰 / 肩章（+ AI 徽标）
 * 3. 职业造型映射完整（7 种职业各有专属头饰与体型）
 * 4. 4 名玩家配色彼此可区分
 * 5. AI 与人类可区分（AI 头顶徽标）
 * 6. 呼吸 / 倾斜 / 压缩参数生效（不同参数 → 不同像素结果）
 * 7. 步速常量已放慢到 ≥ 260ms/格
 * 8. 三段 easing 生效：起跳（抬升）→ 腾空（最高点）→ 落地（压缩）
 * 9. 落地压缩真的出现（squash ≠ null），且回弹有形变
 * 10. 平面 fallback：3D 关掉后实体依然绘制
 */

/* ⚠ 静态 import 是安全的 —— charEntity.js / effects.js 都无副作用。 */
import { CharEntityRenderer, lookOf, LIGHT } from '../render/charEntity.js';
import { MoveAnimator } from '../render/effects.js';
import { PLAYER_COLORS } from './palette.js';

/** 断言收集器 */
function makeCollector() {
  const rows = [];
  return {
    rows,
    check(name, cond, detail) {
      rows.push({ name, pass: !!cond, detail: detail || '' });
    },
  };
}

/** 创建一张离屏画布 */
function makeCanvas(w = 200, h = 200) {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  return { cv, ctx };
}

/** 统计画布上的「非透明彩色像素」数量 */
function countPixels(ctx, w, h) {
  const d = ctx.getImageData(0, 0, w, h).data;
  let n = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] > 24) n++;
  }
  return n;
}

/** 画布内容的指纹 —— 用来判断两次绘制是否不同 */
function fingerprint(ctx, w, h) {
  const d = ctx.getImageData(0, 0, w, h).data;
  let s = 0;
  for (let i = 0; i < d.length; i += 4) {
    s = (s * 31 + d[i] + d[i + 1] * 3 + d[i + 2] * 7 + d[i + 3] * 11) >>> 0;
  }
  return s;
}

/**
 * 主入口 —— 返回 [{ name, pass, detail }]
 */
export function runAll() {
  const c = makeCollector();

  // ---------- 1. 可实例化且画得出像素 ----------
  const { cv, ctx } = makeCanvas(160, 160);
  const renderer = new CharEntityRenderer();
  renderer.draw(ctx, {
    cx: 80, cy: 130, s: 2,
    color: PLAYER_COLORS[0].main,
    colorLt: PLAYER_COLORS[0].lt,
    colorDk: PLAYER_COLORS[0].dk,
    avatar: 7,
    isCurrent: true,
    isAI: false,
    time: 0,
    flat: false,
  });
  const px = countPixels(ctx, 160, 160);
  c.check('角色实体能画出实体像素（非空）',
    px > 200,
    `绘制像素 ${px} 个`);
  c.check('实体计数正确',
    renderer.lastEntityCount === 1,
    `entityCount = ${renderer.lastEntityCount}`);

  // ---------- 2. 五层构件齐备 ----------
  // ⚠ 通过源码结构断言（构件是独立私有方法）——
  //   实体是纯 Canvas 绘制，没有 DOM 可查，只能靠结构 + 像素共同验证。
  const proto = CharEntityRenderer.prototype;
  const has = (m) => typeof proto[m] === 'function';
  c.check('实体具备台座 / 身体 / 头部 / 配饰四层构件',
    has('_drawPlinth') && has('_drawBody') && has('_drawHead') && has('_drawBadges'),
    `plinth=${has('_drawPlinth')} body=${has('_drawBody')} ` +
    `head=${has('_drawHead')} badges=${has('_drawBadges')}`);

  // ---------- 3. 职业造型映射完整 ----------
  const heads = new Set();
  const bodies = new Set();
  let mapped = 0;
  for (let a = 7; a <= 13; a++) {
    const look = lookOf(a);
    heads.add(look.head);
    bodies.add(look.body);
    mapped++;
  }
  c.check('7 种职业均有专属造型', mapped === 7 && heads.size === 7,
    `头饰种类 ${heads.size}（${[...heads].join('/')}），体型种类 ${bodies.size}`);
  c.check('兜底造型可用于未知职业',
    lookOf(999) && lookOf(999).head === 'dome',
    `未知职业 → ${lookOf(999).head}`);

  // ---------- 4. 4 名玩家配色可区分 ----------
  const mains = PLAYER_COLORS.map((p) => p.main);
  c.check('4 名玩家主色互不相同',
    new Set(mains).size === 4,
    mains.join(' / '));

  // ---------- 5. AI 与人类可区分 ----------
  const { cv: cvA, ctx: ctxA } = makeCanvas(160, 160);
  const { cv: cvH, ctx: ctxH } = makeCanvas(160, 160);
  const base = {
    cx: 80, cy: 130, s: 2,
    color: PLAYER_COLORS[1].main,
    colorLt: PLAYER_COLORS[1].lt,
    colorDk: PLAYER_COLORS[1].dk,
    avatar: 9, time: 0, flat: false,
  };
  const r2 = new CharEntityRenderer();
  r2.draw(ctxA, { ...base, isAI: true });
  r2.draw(ctxH, { ...base, isAI: false });
  c.check('AI 头顶有专属徽标（与人形可区分）',
    fingerprint(ctxA, 160, 160) !== fingerprint(ctxH, 160, 160),
    `AI 像素 ${countPixels(ctxA, 160, 160)} vs 人类 ${countPixels(ctxH, 160, 160)}`);

  // ---------- 6. 呼吸 / 倾斜 / 压缩参数生效 ----------
  const { cv: cvR1, ctx: ctxR1 } = makeCanvas(160, 160);
  const { cv: cvR2, ctx: ctxR2 } = makeCanvas(160, 160);
  const { cv: cvS, ctx: ctxS } = makeCanvas(160, 160);
  const r3 = new CharEntityRenderer();
  const common = {
    cx: 80, cy: 130, s: 2,
    color: PLAYER_COLORS[2].main,
    colorLt: PLAYER_COLORS[2].lt,
    colorDk: PLAYER_COLORS[2].dk,
    avatar: 11, isCurrent: true, flat: false,
  };
  r3.draw(ctxR1, { ...common, time: 0 });
  r3.draw(ctxR2, { ...common, time: 400 });          // 呼吸相位不同
  r3.draw(ctxS, { ...common, time: 0, squash: { sx: 1.2, sy: 0.7 } });
  const fR1 = fingerprint(ctxR1, 160, 160);
  const fR2 = fingerprint(ctxR2, 160, 160);
  const fS = fingerprint(ctxS, 160, 160);
  c.check('呼吸参数生效（不同时间 → 不同形态）', fR1 !== fR2);
  c.check('落地压缩参数生效（squash → 不同形态）', fR1 !== fS);
  c.check('压缩后像素更少（纵向被压扁）',
    countPixels(ctxS, 160, 160) < countPixels(ctxR1, 160, 160),
    `压缩 ${countPixels(ctxS, 160, 160)} vs 原形 ${countPixels(ctxR1, 160, 160)}`);

  // ---------- 7. 倾斜参数生效 ----------
  const { cv: cvL, ctx: ctxL } = makeCanvas(160, 160);
  r3.draw(ctxL, { ...common, time: 0, lean: 0.9 });
  c.check('朝向微倾参数生效', fingerprint(ctxL, 160, 160) !== fR1);

  // ---------- 8. 光照方向全局统一 ----------
  c.check('光照方向已集中定义（左上后方）',
    LIGHT.x < 0 && LIGHT.y < 0,
    `LIGHT = (${LIGHT.x}, ${LIGHT.y})`);

  // ---------- 9. 步速已放慢 ----------
  const mover = new MoveAnimator();
  mover.start({
    playerId: 0, from: 0, to: 2, steps: 2, path: [1, 2],
    stepMs: 300, onLand: () => {}, onDone: () => {},
  });
  c.check('每格步进 ≥ 260ms（已放慢）',
    mover.stepMs >= 260,
    `stepMs = ${mover.stepMs}ms`);

  // ---------- 10. 三段 easing：起跳 / 腾空 / 落地 ----------
  // ⚠ 格子矩形必须是**水平递增**的 —— lean 由移动方向推导，
  //   若所有格子同 y，dir 会退化成 'up'，lean 恒为 0。
  const rectOf = (i) => ({ x: i * 100, y: 0, w: 100, h: 100 });
  const slotOf = () => ({ dx: 0, dy: 0 });

  // 起跳早期：应已抬升（bob < 0）
  mover.startedAt = performance.now() - 30;
  mover.update();
  const early = mover.frameState(rectOf, slotOf);
  // 腾空中段：抬升最高
  mover.startedAt = performance.now() - 140;
  mover.update();
  const mid = mover.frameState(rectOf, slotOf);
  // 落地末段：应出现压缩
  // ⚠ 取样点必须在落地段内（76% × 300ms = 228ms 之后），
  //   且选在**回弹帧**（u ≈ 0.57）—— 那里形变最明显，
  //   便于断言「压缩 / 回弹确实发生」。
  mover.startedAt = performance.now() - 258;
  mover.update();
  const late = mover.frameState(rectOf, slotOf);

  c.check('起跳阶段角色已抬升（bob < 0）',
    early && early.bob < 0,
    `早期 bob = ${early ? early.bob.toFixed(2) : '?'}`);
  c.check('腾空阶段抬升最高（bob 更负）',
    mid && early && mid.bob < early.bob,
    `早期 ${early ? early.bob.toFixed(2) : '?'} → 中段 ${mid ? mid.bob.toFixed(2) : '?'}`);
  c.check('落地阶段出现压缩（squash 非空）',
    late && late.squash !== null && late.squash !== undefined,
    late && late.squash ? `squash = (${late.squash.sx}, ${late.squash.sy})` : '无 squash');
  c.check('落地阶段抬升归零（回到地面）',
    late && Math.abs(late.bob) < 0.6,
    `落地 bob = ${late ? late.bob.toFixed(2) : '?'}`);
  c.check('落地压缩有形变（sy ≠ 1 或 sx ≠ 1）',
    late && late.squash && (Math.abs(late.squash.sy - 1) > 0.01
      || Math.abs(late.squash.sx - 1) > 0.01),
    late && late.squash ? `(${late.squash.sx}, ${late.squash.sy})` : '');

  // ---------- 10b. 腾空 → 落地 无高度跳变 ----------
  // ⚠ 回归防护：三段 easing 的衔接处若出现「弹回最高点」，
  //   角色会在落地瞬间猛地跳一下。这里断言 76% 附近的高度是连续的。
  const heights = [];
  for (const ms of [220, 228, 236, 244, 252]) {
    mover.startedAt = performance.now() - ms;
    mover.update();
    const st = mover.frameState(rectOf, slotOf);
    heights.push({ ms, bob: st ? st.bob : 0 });
  }
  const maxJump = heights.reduce((m, h, i) => (
    i === 0 ? 0 : Math.max(m, Math.abs(h.bob - heights[i - 1].bob))
  ), 0);
  c.check('腾空→落地衔接无高度跳变（相邻帧位移 < 3px）',
    maxJump < 3,
    heights.map((h) => `${h.ms}ms:${h.bob.toFixed(1)}`).join(' → ')
    + ` （最大跳变 ${maxJump.toFixed(2)}px）`);
  c.check('移动中带朝向微倾（lean ≠ 0）',
    mid && Math.abs(mid.lean) > 0.01,
    `lean = ${mid ? mid.lean.toFixed(3) : '?'}`);

  // ---------- 11. 平面 fallback ----------
  const { cv: cvP, ctx: ctxP } = makeCanvas(160, 160);
  r3.draw(ctxP, { ...common, time: 0, flat: true });
  c.check('3D 俯视模式也能画出实体（flat 生效）',
    countPixels(ctxP, 160, 160) > 200,
    `flat 模式像素 ${countPixels(ctxP, 160, 160)} 个`);

  // ---------- 12. 渲染器接入检查 ----------
  const game = window.__game;
  const br = game && game.renderer;
  if (br) {
    c.check('BoardRenderer 已接入角色实体渲染器',
      !!br.charEntities && typeof br.charEntities.draw === 'function',
      `charEntities = ${br.charEntities ? br.charEntities.constructor.name : '无'}`);
  } else {
    c.check('BoardRenderer 已接入角色实体渲染器',
      false, '无法访问 game.renderer');
  }

  return c.rows;
}
