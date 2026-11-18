/**
 * billboard 文字补偿自检 —— 验证 3D 视角下文字保持正立且不裁切。
 *
 * ⚠ 这是一个**浏览器渲染层**自检（需要真实 DOM + CSS 3D），
 *   因此不能像纯逻辑自检那样用替身 —— 必须跑在真实页面里。
 *
 * 验证三件事：
 *   ① 信息层确实带上了反向 rotateX(-45°)
 *   ② 补偿后的信息层**净旋转为 0**（文字正立）
 *   ③ 机构名与主读数**零裁切**（可读性硬标准）
 */

import { BOARD_CELLS, BOARD_SIZE } from './board.js';

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
 * 读取 3D 变换矩阵
 * =========================================================== */
/**
 * 从 computed transform 的 matrix3d 中取出 X 轴旋转量（角度）。
 *
 * ⚠ CSS `matrix3d()` 是**列主序**（column-major）：
 *
 *   matrix3d(
 *     m11 m12 m13 m14,     ← 第 1 列
 *     m21 m22 m23 m24,     ← 第 2 列
 *     m31 m32 m33 m34,     ← 第 3 列
 *     m41 m42 m43 m44)     ← 第 4 列
 *
 *   即 nums[0]=m11, nums[1]=m12, nums[2]=m13, nums[3]=m14,
 *      nums[4]=m21, nums[5]=m22, nums[6]=m23, nums[7]=m24,
 *      nums[8]=m31, nums[9]=m32, ...
 *
 *   rotateX(θ) 的矩阵为：
 *     [1    0      0   0]
 *     [0  cosθ  -sinθ  0]
 *     [0  sinθ   cosθ  0]
 *     [0    0      0   1]
 *
 *   因此 X 旋转的两个分量是 **m22 / m23 / m32 / m33**
 *   （nums[5] / nums[6] / nums[9] / nums[10]），与 Y/Z 无关。
 *
 *   θ = atan2(m32, m22) = atan2(nums[9], nums[5])
 *
 * ⚠ 浏览器对旋转方向的符号约定与 CSS 书写方向可能相反
 *   （rotateX(-45deg) 的 computed matrix 可能读出 +45°）。
 *   因此本测试**只比较相对关系**（信息层角度 + 牌体角度 ≈ 0），
 *   不断言绝对符号 —— 绝对符号由「净旋转 = 0」那条断言把关。
 */
function rotateXOf(el) {
  const t = getComputedStyle(el).transform;
  if (!t || t === 'none') return 0;
  if (t.indexOf('matrix3d') < 0) return 0;
  const nums = t.slice(t.indexOf('(') + 1, t.lastIndexOf(')')).split(',').map(Number);
  const m22 = nums[5];
  const m32 = nums[9];
  return Math.atan2(m32, m22) * 180 / Math.PI;
}

/** 读取 computed transform 原文（失败时给出可诊断信息） */
function rawTransform(el) {
  return el ? getComputedStyle(el).transform : '(元素不存在)';
}

/* ===========================================================
 * 工具 —— 切到 3D / 切回平面
 * ===========================================================
 * ⚠ 必须走**真实**的切换路径：倾斜规则挂在
 *   `#board-stage.is-3d .board-pan` 上（PR-A 的设计），
 *   只给 stage 加 class 而不动 .board-pan 不会产生倾斜。
 *
 *   最可靠的做法：直接点 #btn-3d 按钮 —— 它走 Stage3D 控制器，
 *   会同时更新 class / transform / tileLayer 深度排序。
 */
function set3D(on) {
  const btn = document.getElementById('btn-3d');
  const stage = document.getElementById('board-stage');
  if (!btn || !stage) return false;
  const is3D = stage.classList.contains('is-3d');
  if (is3D !== on) {
    btn.click();
    // ⚠ 必须等过渡动画结束 —— .board-pan 有 `transition: transform .35s`，
    //   过渡期间 getComputedStyle 返回的是**动画中间值**（从 identity 开始），
    //   读到的是 0° 而不是目标角度。等动画自然结束后再断言。
    settle();
  }
  const now3D = stage.classList.contains('is-3d');
  if (now3D !== on) {
    throw new Error(
      `切换 3D 失败：期望 ${on}，实际 ${now3D}（stage="${stage.className}"）`
    );
  }
  return true;
}

/**
 * 等 CSS 过渡结束 —— **用 Web Animations API 直接跳到终态**。
 *
 * ⚠ 不能用同步 busy-wait：那会阻塞事件循环，浏览器无法推进过渡动画，
 *   getComputedStyle 永远停在起始值（实测踩过：读到 identity 而不是目标矩阵）。
 * ⚠ 也不能只 setTimeout —— 过渡时长由 CSS 决定（.35s / .45s）。
 *
 * 做法：getAnimations() 拿到所有动画 → finish() 立即跳到终态。
 * 这是确定性的，不依赖时间。
 */
function settle() {
  const anims = document.getAnimations ? document.getAnimations() : [];
  for (const a of anims) {
    try {
      if (a.playState === 'running' || a.playState === 'pending') a.finish();
    } catch (e) {
      /* 某些动画不可 finish —— 忽略 */
    }
  }
  void document.body.offsetHeight;
}

/* ===========================================================
 * 测试项
 * =========================================================== */

// ① 结构存在
check('地块 DOM 含三层结构（.mt-tile > .mt-face > .mt-d2）', () => {
  const cells = document.querySelectorAll('.mt-cell');
  assert(cells.length === BOARD_SIZE, `应有 ${BOARD_SIZE} 个地块，实际 ${cells.length}`);
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i];
    assert(c.querySelector('.mt-tile'), `地块 ${i} 缺 .mt-tile`);
    assert(c.querySelector('.mt-face'), `地块 ${i} 缺 .mt-face`);
    assert(c.querySelector('.mt-d2'), `地块 ${i} 缺 .mt-d2`);
  }
  return `${BOARD_SIZE} 个地块结构完整`;
});

// ② 平面模式：信息层无旋转（净旋转 0）
check('平面模式信息层无旋转（净旋转 = 0°）', () => {
  const d2s = document.querySelectorAll('.mt-d2');
  assert(d2s.length > 0, '找不到信息层');
  let maxDev = 0;
  for (const d2 of d2s) {
    const ang = Math.abs(rotateXOf(d2));
    if (ang > maxDev) maxDev = ang;
  }
  assert(maxDev < 0.5, `平面模式下信息层应无旋转，实测最大偏转 ${maxDev.toFixed(2)}°`);
  return `最大偏转 ${maxDev.toFixed(3)}°`;
});

// ③ 3D 模式：信息层带反向补偿
check('3D 模式信息层带反向补偿（与倾斜等大反向）', () => {
  assert(set3D(true), '切换到 3D 失败');

  const d2s = document.querySelectorAll('.mt-d2');
  assert(d2s.length > 0, '找不到信息层');

  // 所有信息层的补偿角必须一致
  let minAng = Infinity;
  let maxAng = -Infinity;
  for (const d2 of d2s) {
    const ang = rotateXOf(d2);
    if (ang < minAng) minAng = ang;
    if (ang > maxAng) maxAng = ang;
  }
  assert(maxAng - minAng < 0.5,
    `所有信息层的补偿角应一致，实测区间 [${minAng.toFixed(2)}, ${maxAng.toFixed(2)}]`);

  // 补偿角必须与「实际倾斜角」等大反向
  // ⚠ 倾斜写在 .board-pan 的 transform 里（rotateX + translate3d 合并）
  //   —— .mt-tile 自身没有 transform（computed 为 0），
  //   倾斜是靠 preserve-3d 链**继承**的，因此要以 pan 为基准。
  const pan = document.querySelector('.board-pan');
  assert(pan, '找不到 .board-pan');
  const tiltAng = rotateXOf(pan);
  assert(Math.abs(tiltAng) > 30,
    `平移层应带明显的 X 轴倾斜，实测 ${tiltAng.toFixed(2)}°（computed="${rawTransform(pan)}"）`);
  assert(Math.abs(Math.abs(minAng) - Math.abs(tiltAng)) < 1.5,
    `补偿角应与倾斜等大：倾斜 ${tiltAng.toFixed(2)}°，补偿 ${minAng.toFixed(2)}°`);

  set3D(false);
  return `倾斜 ${tiltAng.toFixed(1)}° / 补偿 ${minAng.toFixed(1)}°（等大反向）`;
});

// ④ 3D 模式：净旋转为 0（文字正立）
check('3D 模式下信息层净旋转 = 0°（文字正立）', () => {
  assert(set3D(true), '切换到 3D 失败');

  // 倾斜在 .board-pan；信息层 .mt-d2 反向补偿 → 净旋转 0
  const pan = document.querySelector('.board-pan');
  const d2 = document.querySelector('.mt-d2');
  assert(pan && d2, '找不到平移层或信息层');

  const tiltAng = rotateXOf(pan);
  const d2Ang = rotateXOf(d2);
  const net = tiltAng + d2Ang;
  assert(Math.abs(net) < 1.5,
    `净旋转应为 0°，实测 ${net.toFixed(2)}°（倾斜 ${tiltAng.toFixed(2)}° + 补偿 ${d2Ang.toFixed(2)}°）`);

  set3D(false);
  return `倾斜 ${tiltAng.toFixed(1)}° + 补偿 ${d2Ang.toFixed(1)}° = ${net.toFixed(2)}°`;
});

// ⑤ 3D 模式：机构名与主读数零裁切
check('3D 模式下机构名与主读数零裁切', () => {
  assert(set3D(true), '切换到 3D 失败');

  const clipped = [];
  for (const n of document.querySelectorAll('.mt-d2-name')) {
    if (n.scrollHeight > n.clientHeight + 1 || n.scrollWidth > n.clientWidth + 1) {
      clipped.push('名称 ' + (n.textContent || '').trim());
    }
  }
  for (const m of document.querySelectorAll('.mt-d2-main')) {
    if (m.scrollWidth > m.clientWidth + 1 || m.scrollHeight > m.clientHeight + 1) {
      clipped.push('主读数 ' + (m.textContent || '').trim());
    }
  }
  assert(clipped.length === 0,
    `发现 ${clipped.length} 处裁切：${clipped.slice(0, 5).join(' / ')}`);

  set3D(false);
  return '机构名与主读数全部完整';
});

/* ===========================================================
 * 导出
 * =========================================================== */
export function runBillboardTests() {
  return results.slice();
}

export function runAll() {
  return runBillboardTests();
}
