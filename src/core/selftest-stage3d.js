/**
 * Stage3D 控制器自检 —— 纯逻辑验证，不依赖真实 DOM 事件。
 *
 * 用最小 DOM 替身（stage / pan / toggle 三个对象）驱动 Stage3D，
 * 验证六条不变量：
 *
 *   ① 3D 切换：class / aria-pressed / title 三者同步
 *   ② 拖拽阈值：小于阈值不算拖拽（不改变平移量）
 *   ③ 边界阻尼：拖出允许范围后位移被压缩
 *   ④ 弹性回弹：松手后回到合法范围内
 *   ⑤ 切回平面时平移归零
 *   ⑥ 地块上的按下不触发棋盘平移
 *
 * ⚠ 本文件只测**控制器逻辑**，不测真实浏览器里的透视渲染效果。
 */

import { Stage3D } from '../render/stage3d.js';

/* ===========================================================
 * 最小 DOM 替身
 * =========================================================== */
function makeEl() {
  const el = {
    _classes: new Set(),
    style: {},
    attrs: {},
    clientWidth: 1000,
    clientHeight: 800,
    listeners: {},
    classList: {
      add(...c) { c.forEach((x) => el._classes.add(x)); },
      remove(...c) { c.forEach((x) => el._classes.delete(x)); },
      contains(c) { return el._classes.has(c); },
      toggle(c, on) {
        const want = on === undefined ? !el._classes.has(c) : !!on;
        if (want) el._classes.add(c); else el._classes.delete(c);
        return want;
      },
    },
    setAttribute(k, v) { el.attrs[k] = String(v); },
    getAttribute(k) { return el.attrs[k] === undefined ? null : el.attrs[k]; },
    addEventListener(type, fn) { (el.listeners[type] ||= []).push(fn); },
    dispatch(type, ev) { (el.listeners[type] || []).forEach((fn) => fn(ev)); },
  };
  return el;
}

/** 构造带控制器与替身 DOM 的测试夹具 */
function fixture() {
  const stage = makeEl();
  const pan = makeEl();
  const toggle = makeEl();
  const ctrl = new Stage3D(stage, pan, toggle);
  return { stage, pan, toggle, ctrl };
}

/** 伪造 pointer 事件 */
function pev(type, x, y) {
  return {
    type, pointerId: 1, clientX: x, clientY: y, button: 0,
    preventDefault() {}, target: null,
  };
}

/* ===========================================================
 * 断言工具
 * =========================================================== */
const results = [];
function check(name, fn) {
  try {
    const detail = fn();
    results.push({ name, pass: true, detail: detail || 'OK' });
  } catch (e) {
    results.push({ name, pass: false, detail: e && e.message ? e.message : String(e) });
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg || '断言失败');
}
function near(a, b, tol, msg) {
  assert(Math.abs(a - b) <= tol, `${msg || ''} 期望 ${b} ± ${tol}，实际 ${a}`);
}

/* ===========================================================
 * 测试项
 * =========================================================== */

// ① 3D 切换
check('3D 视角切换同步 class / aria-pressed / title', () => {
  const f = fixture();
  assert(!f.ctrl.is3D, '初始应为平面模式');
  assert(!f.stage.classList.contains('is-3d'), '初始 stage 不应有 is-3d');

  f.ctrl.set3D(true);
  assert(f.ctrl.is3D, 'set3D(true) 后 is3D 应为 true');
  assert(f.stage.classList.contains('is-3d'), 'stage 应有 is-3d');
  assert(f.toggle.getAttribute('aria-pressed') === 'true', 'aria-pressed 应为 true');
  assert(f.toggle.title === '切换回平面视角', 'title 应切换为「切换回平面视角」');
  assert(f.pan.style.transform && f.pan.style.transform.indexOf('translate3d') >= 0,
    'pan 应立即写入 transform（含 Z 位移）');

  f.ctrl.set3D(false);
  assert(!f.stage.classList.contains('is-3d'), '关闭后应移除 is-3d');
  assert(f.toggle.getAttribute('aria-pressed') === 'false', 'aria-pressed 应回到 false');
  assert(f.toggle.title === '切换 3D 立体视角', 'title 应恢复');
  return '3D 开/关状态全部同步';
});

// ② 拖拽阈值
check('小于阈值的位移不触发拖拽（不改变平移量）', () => {
  const f = fixture();
  f.ctrl.set3D(true);
  const before = f.ctrl.x;
  f.ctrl._onDown(pev('pointerdown', 100, 100));
  f.ctrl._onMove(pev('pointermove', 102, 101));
  near(f.ctrl.x, before, 0.01, '微动后平移量应不变');
  assert(!f.ctrl._moved, '不应标记为已移动');
  f.ctrl._onUp(pev('pointerup', 102, 101));
  f.ctrl._cancelSpring();
  return '2px 位移被正确判定为点击而非拖拽';
});

// ③ 拖拽生效 + 边界阻尼
check('拖拽生效且超出边界时位移被阻尼压缩', () => {
  const f = fixture();
  f.ctrl.set3D(true);
  const lim = f.ctrl._limits();
  assert(lim.maxX > 0, '边界应为正');

  const drag = lim.maxX * 4;
  f.ctrl._onDown(pev('pointerdown', 100, 100));
  f.ctrl._onMove(pev('pointermove', 100 + drag, 100));
  const raw = f.ctrl.x;
  assert(raw > lim.maxX, '应仍处于越界位置（阻尼而非硬截断）');
  assert(raw < drag, '应被阻尼压缩，不能等于原始拖动量');
  assert(raw - lim.maxX < (drag - lim.maxX) * 0.5, '越界溢出量应小于原始溢出量的一半');

  f.ctrl._onUp(pev('pointerup', 100 + drag, 100));
  f.ctrl._cancelSpring();
  return `越界 ${raw.toFixed(1)}（边界 ${lim.maxX.toFixed(1)}）已阻尼`;
});

// ④ 弹性回弹
check('松手后弹性回弹到合法范围内', () => {
  const f = fixture();
  f.ctrl.set3D(true);
  const lim = f.ctrl._limits();

  f.ctrl._onDown(pev('pointerdown', 100, 100));
  f.ctrl._onMove(pev('pointermove', 100 + lim.maxX * 4, 100));
  f.ctrl._onUp(pev('pointerup', 100 + lim.maxX * 4, 100));

  // 回弹是 rAF 驱动的 —— 动画期间实际位置仍在越界处，
  // 因此断言「收敛目标」必须落在边界内。
  near(f.ctrl.target.x, lim.maxX, 0.01, '回弹目标应在边界上');
  near(f.ctrl.target.y, 0, 0.01, 'Y 方向未拖动，目标应为 0');
  f.ctrl._cancelSpring();
  return '回弹目标已钳位到边界内';
});

// ⑤ 切回平面时平移归零
check('切回平面视角时平移量归零', () => {
  const f = fixture();
  f.ctrl.set3D(true);
  f.ctrl._onDown(pev('pointerdown', 100, 100));
  f.ctrl._onMove(pev('pointermove', 260, 180));
  f.ctrl._onUp(pev('pointerup', 260, 180));
  f.ctrl._cancelSpring();
  assert(Math.abs(f.ctrl.x) > 0 || Math.abs(f.ctrl.y) > 0, '拖拽后应有偏移');

  f.ctrl.set3D(false);
  near(f.ctrl.x, 0, 0.01, '切回平面后 x 应归零');
  near(f.ctrl.y, 0, 0.01, '切回平面后 y 应归零');
  assert(f.pan.style.transform.indexOf('0.00px') >= 0, 'transform 应写为归零值');
  return '平面模式不留残余偏移';
});

// ⑥ 地块上的拖拽不触发平移
check('在地块上按下不会触发棋盘平移', () => {
  const f = fixture();
  f.ctrl.set3D(true);
  const cell = { closest: (sel) => (sel === '.mt-cell' ? {} : null) };
  const ev = pev('pointerdown', 100, 100);
  ev.target = cell;
  f.ctrl._onDown(ev);
  assert(!f.ctrl.dragging, '在地块上按下不应进入拖拽状态');
  return '地块点击与棋盘拖拽互不干扰';
});

/* ===========================================================
 * 导出
 * =========================================================== */
export function runStage3DTests() {
  return results.slice();
}

/** 供 run-selftest.py 直接调用 */
export function runAll() {
  return runStage3DTests();
}
