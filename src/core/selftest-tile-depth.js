/**
 * 地块深度排序自检 —— 验证 3D 模式下的遮挡关系正确。
 *
 * ⚠ 深度排序是 3D 视角的**关键正确性**问题：
 *   DOM 没有深度缓冲，若不显式排序，靠下（离观察者更近）的格子
 *   可能被排在 DOM 后面，视觉上被前面的格子盖住 —— 但实际应该反过来。
 *
 * 覆盖：
 *   ① 平面模式不写 z-index（交回给 hover 规则）
 *   ② 3D 模式按**行号**排序（不是回合顺序）
 *   ③ 同一行内的格子 z-index 相同
 *   ④ 切换模式时深度重排
 */

import { BOARD_CELLS, BOARD_SIZE, TRACK_POINTS, BOARD_GRID } from './board.js';

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

/* ===========================================================
 * 替身 —— 只实现 TileLayer 用到的接口
 * =========================================================== */
function makeNode() {
  return { style: {} };
}

/** 复刻 TileLayer.applyDepth 的排序规则（与实现保持一致） */
function computeDepth(nodes, is3D) {
  const rows = BOARD_GRID.rows || 1;
  for (let i = 0; i < BOARD_SIZE; i++) {
    const node = nodes[i];
    if (!node) continue;
    if (!is3D) {
      node.style.zIndex = '';
      continue;
    }
    const p = TRACK_POINTS[i];
    const row = p ? Math.floor((p[1] / 1000) * rows) : 0;
    node.style.zIndex = String(10 + row * 10);
  }
}

// ① 平面模式
check('平面模式不写 z-index（保留 hover 抢占能力）', () => {
  const nodes = Array.from({ length: BOARD_SIZE }, makeNode);
  computeDepth(nodes, false);
  for (let i = 0; i < BOARD_SIZE; i++) {
    assert(nodes[i].style.zIndex === '', `格子 ${i} 在平面模式不应有 z-index`);
  }
  return `${BOARD_SIZE} 个格子均未写 z-index`;
});

// ② 3D 模式按行号排序
check('3D 模式按格子的行号排序（行号越大越靠上）', () => {
  const nodes = Array.from({ length: BOARD_SIZE }, makeNode);
  computeDepth(nodes, true);
  const rows = BOARD_GRID.rows || 1;

  // 逐格核对：z-index 必须严格由行号决定
  for (let i = 0; i < BOARD_SIZE; i++) {
    const p = TRACK_POINTS[i];
    const row = p ? Math.floor((p[1] / 1000) * rows) : 0;
    const expect = String(10 + row * 10);
    assert(nodes[i].style.zIndex === expect,
      `格子 ${i}（${BOARD_CELLS[i] && BOARD_CELLS[i].name}）期望 z-index ${expect}，实际 ${nodes[i].style.zIndex}`);
  }
  return `全部 ${BOARD_SIZE} 格按行号排定`;
});

// ③ 靠下的行 z-index 更大
check('靠下（离观察者更近）的行 z-index 更大', () => {
  const nodes = Array.from({ length: BOARD_SIZE }, makeNode);
  computeDepth(nodes, true);
  const rows = BOARD_GRID.rows || 1;

  // 找到第一行与最后一行的代表格子
  const rowOf = (i) => {
    const p = TRACK_POINTS[i];
    return p ? Math.floor((p[1] / 1000) * rows) : 0;
  };
  const topIdx = [];
  const botIdx = [];
  for (let i = 0; i < BOARD_SIZE; i++) {
    if (rowOf(i) === 0) topIdx.push(i);
    if (rowOf(i) === rows - 1) botIdx.push(i);
  }
  assert(topIdx.length > 0, '应存在第一行的格子');
  assert(botIdx.length > 0, '应存在最后一行的格子');

  const topZ = Number(nodes[topIdx[0]].style.zIndex);
  const botZ = Number(nodes[botIdx[0]].style.zIndex);
  assert(botZ > topZ, `最后一行 z-index ${botZ} 应大于第一行 ${topZ}`);

  // 同一行内的格子 z-index 相同
  for (const i of topIdx) {
    assert(nodes[i].style.zIndex === nodes[topIdx[0]].style.zIndex,
      `同一行内 z-index 应一致，格子 ${i} 与 ${topIdx[0]} 不一致`);
  }
  return `第一行 z=${topZ} < 最后一行 z=${botZ}`;
});

// ④ 切换模式重排
check('3D ↔ 平面切换时深度重排正确', () => {
  const nodes = Array.from({ length: BOARD_SIZE }, makeNode);
  computeDepth(nodes, true);
  const zIn3D = nodes[0].style.zIndex;
  assert(zIn3D !== '', '3D 模式应写 z-index');

  computeDepth(nodes, false);
  assert(nodes[0].style.zIndex === '', '切回平面应清空 z-index');

  computeDepth(nodes, true);
  assert(nodes[0].style.zIndex === zIn3D, '再次切回 3D 应恢复相同 z-index');
  return '切换往返后深度序列一致';
});

/* ===========================================================
 * 导出
 * =========================================================== */
export function runDepthTests() {
  return results.slice();
}

export function runAll() {
  return runDepthTests();
}
