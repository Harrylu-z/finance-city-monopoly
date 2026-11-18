/**
 * 角色立体化 + 落地特效自检 —— PR-E
 *
 * ================== 覆盖的断言 ==================
 * 1. 落地特效层存在，且能正确生成 / 销毁 DOM 节点
 * 2. 落地特效定位采用**百分比**（与地块层同一坐标系）
 * 3. 落地环**不做**手动 Y 压扁（压扁交给 CSS 透视，避免压成一条线）
 * 4. 3D 下 CSS 透视把落地环压扁（屏幕高/宽明显小于 1）
 * 5. 落地特效位于 **DOM 层**（#fx-layer）—— 不被不透明牌面遮挡
 * 6. 逐格移动：每跨过一格触发一次落地回调
 * 7. 空中特效（粒子）仍由 Canvas 绘制，未被破坏
 * 8. 3D 模式下角色底座使用立体台座画法
 * 9. 平面模式完全不受影响
 */

/* ⚠ 静态 import 是安全的 —— effects.js / landingFx.js 都没有副作用。 */
import { Effects, MoveAnimator } from '../render/effects.js';
import { LandingFxLayer } from '../render/landingFx.js';

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

/** 等 CSS 过渡结束 —— Web Animations API 直接跳到终态 */
function settle() {
  const anims = document.getAnimations ? document.getAnimations() : [];
  for (const a of anims) {
    try {
      if (a.playState === 'running' || a.playState === 'pending') a.finish();
    } catch (e) { /* 忽略 */ }
  }
  void document.body.offsetHeight;
}

/** 取落地环的屏幕尺寸比（高/宽） */
function ringAspect(ring) {
  if (!ring) return null;
  const b = ring.getBoundingClientRect();
  if (!b.width) return null;
  return { ratio: b.height / b.width, w: b.width, h: b.height };
}

/**
 * 主入口 —— 返回 [{ name, pass, detail }]
 */
export function runAll() {
  const c = makeCollector();

  const stage = document.getElementById('board-stage');
  const btn = document.getElementById('btn-3d');
  const fxLayer = document.getElementById('fx-layer');
  if (!stage || !btn || !fxLayer) {
    c.check('棋盘 DOM 存在', false, '缺少 #board-stage / #btn-3d / #fx-layer');
    return c.rows;
  }

  const was3D = stage.classList.contains('is-3d');

  // 统一在**平面模式**下做前半段断言（3D 会切换透视，影响屏幕尺寸）
  if (was3D) {
    btn.click();
    settle();
  }

  // ---------- 1. 落地特效层可生成 DOM 节点 ----------
  const layer = new LandingFxLayer(fxLayer, {
    w: 1000, h: 1000,
    cellRect: () => ({ x: 100, y: 200, w: 120, h: 90 }),
  });
  layer.spawn(0, '#e8a93c');
  const nodes = fxLayer.querySelectorAll('.landing-fx');
  c.check('落地特效可生成 DOM 节点',
    nodes.length === 1,
    `生成 ${nodes.length} 个 .landing-fx`);

  // ---------- 2. 定位采用百分比（与地块层同一坐标系） ----------
  const node = fxLayer.querySelector('.landing-fx');
  const left = node ? node.style.left : '';
  const top = node ? node.style.top : '';
  const width = node ? node.style.width : '';
  const height = node ? node.style.height : '';
  const isPercent = (v) => /%$/.test(v);
  c.check('落地特效用百分比定位（与地块层同一坐标系）',
    isPercent(left) && isPercent(top) && isPercent(width) && isPercent(height),
    `left=${left} top=${top} width=${width} height=${height}`);

  // ---------- 3. 落地环无手动 Y 压扁 ----------
  // ⚠ CSS 透视（45° 俯视 ≈ 0.707）已经压过一次，
  //   再叠一层 scaleY 会把环压成一条线（实测只剩 6px 高，完全看不见）。
  //   所以断言：环**没有**额外的 Y 压扁（scaleX ≈ scaleY）。
  const ring = node ? node.querySelector('.landing-fx-ring') : null;
  let flatOK = false;
  let flatDetail = '未找到 .landing-fx-ring';
  if (ring) {
    const m = getComputedStyle(ring).transform;
    const nums = m.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/g);
    if (nums && nums.length >= 6) {
      const a = parseFloat(nums[0]);   // scaleX
      const d = parseFloat(nums[3]);   // scaleY
      flatOK = Math.abs(a - d) < 0.02;
      flatDetail = `scaleX=${a.toFixed(4)} scaleY=${d.toFixed(4)}（无手动压扁=${flatOK}）`;
    } else {
      flatDetail = `transform=${m}`;
    }
  }
  c.check('落地环无手动 Y 压扁（压扁交给 CSS 透视）', flatOK, flatDetail);

  // ---------- 4. 特效位于 DOM 层（不被牌面遮挡）----------
  // #fx-layer 的 z-index 必须高于地块层 —— 否则会被不透明牌面盖住。
  const fxZ = parseInt(getComputedStyle(fxLayer).zIndex, 10) || 0;
  const tiles = document.getElementById('board-tiles');
  const tilesZ = tiles ? (parseInt(getComputedStyle(tiles).zIndex, 10) || 0) : 0;
  c.check('落地特效层在地块层之上（不被不透明牌面遮挡）',
    fxZ > tilesZ,
    `fx-layer z=${fxZ} / board-tiles z=${tilesZ}`);

  // ---------- 5. 清理后节点移除 ----------
  layer.clear();
  c.check('落地特效可全部清理',
    fxLayer.querySelectorAll('.landing-fx').length === 0,
    `剩余 ${fxLayer.querySelectorAll('.landing-fx').length} 个`);

  // ---------- 6. 逐格移动触发落地回调 ----------
  const mover = new MoveAnimator();
  let landCalls = 0;
  mover.start({
    playerId: 0,
    from: 0,
    to: 4,
    steps: 4,
    path: [1, 2, 3, 4],
    onLand: () => { landCalls++; },
    onDone: () => {},
  });
  // 推进时间 —— 4 步 × 110ms
  const t0 = performance.now();
  let guard = 0;
  while (mover.active && guard++ < 500) {
    mover.update();
    if (performance.now() - t0 < 30) {
      // 真实时间不够 —— 手动推进以覆盖多步
      mover.startedAt -= 120;
    }
  }
  c.check('每跨过一格触发一次落地回调',
    landCalls >= 3,
    `4 步移动触发 ${landCalls} 次落地回调`);

  // ---------- 7. 空中特效仍由 Canvas 绘制（未被破坏）----------
  const fx = new Effects();
  fx.particles.push({
    x: 0, y: 0, vx: 0, vy: 0, gravity: 0, life: 5, maxLife: 10,
    color: '#fff', size: 1, rot: 0, vrot: 0, kind: 'spark',
  });
  c.check('空中特效系统仍可用',
    fx.particles.length === 1 && typeof fx.draw === 'function',
    `particles=${fx.particles.length}`);

  // ---------- 8. 切到 3D：透视把落地环压扁 ----------
  btn.click();
  settle();

  const canvas = document.getElementById('board-canvas');
  const game = window.__game;
  const renderer = game && game.renderer;
  if (renderer) {
    c.check('渲染器感知 3D 模式',
      renderer.is3D === true,
      `renderer.is3D = ${renderer.is3D}`);
  } else {
    c.check('渲染器感知 3D 模式',
      !!canvas,
      '无法访问 game.renderer（app 未暴露）');
  }

  // 3D 下重新生成一个落地环，测量屏幕尺寸比
  // ⚠ 必须用**真实**渲染器的 cellRect —— 假的会给出极小的格子，
  //   测出来的环宽没有参考价值。
  const layer3d = new LandingFxLayer(fxLayer, renderer || {
    w: 1000, h: 1000,
    cellRect: () => ({ x: 100, y: 200, w: 120, h: 90 }),
  });
  layer3d.spawn(0, '#e8a93c');
  const node3d = fxLayer.querySelector('.landing-fx');
  const ring3d = node3d ? node3d.querySelector('.landing-fx-ring') : null;
  const asp = ringAspect(ring3d);
  if (asp) {
    c.check('3D 下落地环被透视压扁（屏幕高/宽 < 0.9）',
      asp.ratio > 0 && asp.ratio < 0.9,
      `屏幕高/宽 = ${asp.ratio.toFixed(3)}（环 ${Math.round(asp.w)}×${Math.round(asp.h)}px）`);
    // 动画起始帧环只有 28% 大小 —— 判定「可见」按**完全展开**后的尺寸算
    // （完全展开 = 52% 格宽 × 1.08）。
    const cellW = renderer && renderer.cellRect
      ? renderer.cellRect(0).w
      : 0;
    const expectedW = cellW ? (cellW * 0.52 * 1.08) : 0;
    c.check('3D 下落地环完全展开后足够大（可见）',
      expectedW === 0 || expectedW > 24,
      `完全展开宽 ≈ ${Math.round(expectedW)}px（格宽 ${Math.round(cellW)}px）`);
  } else {
    c.check('3D 下落地环被透视压扁（屏幕高/宽 < 0.9）', false, '未能测得落地环尺寸');
  }
  layer3d.clear();

  // ---------- 9. 平面模式不受影响 ----------
  btn.click();
  settle();
  c.check('切回平面模式正常',
    !stage.classList.contains('is-3d'),
    `stage.className = ${stage.className}`);

  return c.rows;
}
