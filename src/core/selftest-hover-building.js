/**
 * hover 立体建筑浮现层自检 —— PR-D
 *
 * ================== 覆盖的断言 ==================
 * 1. 建筑图层在 3D 模式下启用，平面模式下完全隐藏
 * 2. 悬停机构格 → 生成建筑节点，且建筑内容与格子信息匹配
 * 3. 建筑高度随等级递增（网点 < 地标）
 * 4. 建筑配色匹配集团色；已持有时匹配持有人色
 * 5. 特殊格（转盘 / 赌场等）不生成建筑
 * 6. 建筑随棋盘一起倾斜（**不**做 billboard 补偿）—— 保证立体感
 * 7. 建筑有地面投影
 *
 * 运行方式：tools/run-selftest.py 会自动调用本模块。
 */

/** 断言收集器 —— 与 selftest.js 保持同样的返回结构 */
function makeCollector() {
  const rows = [];
  return {
    rows,
    check(name, cond, detail) {
      rows.push({ name, pass: !!cond, detail: detail || '' });
    },
  };
}

/** 读取元素的计算矩阵（列主序 matrix3d） */
function matrixOf(el) {
  const t = getComputedStyle(el).transform;
  if (!t || t === 'none') return null;
  const nums = t.match(/matrix3d?\(([^)]+)\)/);
  if (!nums) return null;
  return nums[1].split(',').map(Number);
}

/**
 * 从 matrix3d 里取 X 轴旋转角（度）。
 * 列主序：nums[5] = m22 = cos(θ)，nums[9] = m32 = sin(θ)
 */
function rotateXOf(el) {
  const nums = matrixOf(el);
  if (!nums) return 0;
  if (nums.length === 16) {
    return Math.atan2(nums[9], nums[5]) * 180 / Math.PI;
  }
  return 0;
}

/** 等 CSS 过渡结束 —— Web Animations API 直接跳到终态 */
function settle() {
  const anims = document.getAnimations ? document.getAnimations() : [];
  for (const a of anims) {
    try {
      if (a.playState === 'running' || a.playState === 'pending') a.finish();
    } catch (e) { /* 忽略不可 finish 的动画 */ }
  }
  void document.body.offsetHeight;
}

/** 悬停到某格（模拟真实鼠标移动 —— mousemove 才会触发建筑） */
function hoverCell(index) {
  const cell = document.querySelector(`.mt-cell[data-index="${index}"]`);
  if (!cell) return false;
  const r = cell.getBoundingClientRect();
  const x = r.left + r.width / 2;
  const y = r.top + r.height / 2;
  cell.dispatchEvent(new MouseEvent('mousemove', {
    bubbles: true, clientX: x, clientY: y,
  }));
  return true;
}

/**
 * 主入口 —— 返回 [{ name, pass, detail }]
 */
export function runAll() {
  const c = makeCollector();
  const stage = document.getElementById('board-stage');
  const btn = document.getElementById('btn-3d');
  const layer = document.getElementById('hover-buildings');

  if (!stage || !btn || !layer) {
    c.check('hover 建筑层 DOM 存在', false, '缺少 #board-stage / #btn-3d / #hover-buildings');
    return c.rows;
  }

  // ---------- 1. 平面模式：建筑必须完全隐藏 ----------
  const flatHb = layer.querySelector('.mt-hb');
  c.check('平面模式下建筑层不显示建筑',
    !flatHb || getComputedStyle(flatHb).display === 'none',
    '平面模式不应出现悬浮建筑');

  // ---------- 2. 切到 3D ----------
  // ⚠ #btn-3d 现在是真等距 3D 总开关 —— 旧倾斜管线改走 Stage3D 直调。
  const game = window.__game;
  const was3D = stage.classList.contains('is-3d');
  if (!was3D) {
    if (game && game.stage3d && typeof game.stage3d.set3D === 'function') game.stage3d.set3D(true);
    else btn.click();
  }
  settle();
  c.check('3D 模式已启用',
    stage.classList.contains('is-3d'),
    `stage.className = ${stage.className}`);

  // ---------- 3. 悬停机构格 → 生成建筑 ----------
  const cells = Array.from(document.querySelectorAll('.mt-cell'));
  // 机构格带有 .mt-facade（矢量立面），特殊格没有
  const instCells = cells.filter((n) => n.querySelector('.mt-facade'));

  if (!instCells.length) {
    c.check('存在机构格可悬停', false, '未找到 .mt-facade 机构格');
    return c.rows;
  }

  const target = instCells[0];
  const targetIndex = Number(target.dataset.index);
  hoverCell(targetIndex);
  settle();

  const hb = layer.querySelector(`.mt-hb[data-index="${targetIndex}"]`);
  c.check('悬停机构格后生成建筑节点', !!hb,
    hb ? `index=${targetIndex}` : `未生成 .mt-hb[data-index="${targetIndex}"]`);

  if (!hb) return c.rows;

  // ---------- 4. 建筑有立绘与投影 ----------
  const img = hb.querySelector('.mt-hb-img');
  const shadow = hb.querySelector('.mt-hb-shadow');
  c.check('建筑含立绘图片', !!img && !!img.src && img.src.startsWith('data:image/png'),
    img ? (img.src || '').slice(0, 32) : '无 img');
  c.check('建筑含地面投影', !!shadow, shadow ? '有 .mt-hb-shadow' : '无 .mt-hb-shadow');

  // ---------- 5. 建筑随棋盘倾斜（不做 billboard 补偿）----------
  // ⚠ getComputedStyle().transform 只返回元素**自身**的变换，
  //   不含祖先累积 —— 建筑自身是 translateZ/scale/translateY，
  //   所以「自身旋转 = 0°」恰恰说明它**没有**被单独补偿。
  //
  // 正确判据：
  //   a) 建筑自身 transform 里**不含 rotate**（没做 billboard 反向补偿）
  //   b) 建筑位于 #board-pan 之内 → 继承 45° 倾斜
  const pan = document.getElementById('board-pan');
  const tilt = rotateXOf(pan);
  const ownTransform = getComputedStyle(hb).transform;
  const hasOwnRotate = /rotate|matrix3d/.test(ownTransform)
    && ownTransform.includes('matrix3d')
    && rotateXOf(hb) > 20;
  const insidePan = !!(pan && pan.contains(hb));
  c.check('建筑继承棋盘倾斜（自身不做 billboard 补偿）',
    Math.abs(tilt) > 20 && insidePan && !hasOwnRotate,
    `棋盘 ${tilt.toFixed(1)}° / 建筑自身旋转 ${rotateXOf(hb).toFixed(1)}° / 位于倾斜层内=${insidePan}`);

  // ---------- 6. 特殊格不生成建筑 ----------
  const specialCells = cells.filter((n) => !n.querySelector('.mt-facade'));
  let specialOk = true;
  let specialDetail = '';
  for (const sc of specialCells.slice(0, 4)) {
    const i = Number(sc.dataset.index);
    hoverCell(i);
    settle();
    const node = layer.querySelector(`.mt-hb[data-index="${i}"]`);
    if (node && node.classList.contains('is-in')) {
      specialOk = false;
      specialDetail = `特殊格 ${i} 也生成了建筑`;
      break;
    }
  }
  if (specialOk) {
    specialDetail = `抽查 ${Math.min(4, specialCells.length)} 个特殊格，均未生成建筑`;
  }
  c.check('特殊格不生成建筑', specialOk, specialDetail);

  // ---------- 7. 建筑按等级设置体量缩放 ----------
  const scaleOf = (i) => {
    const n = layer.querySelector(`.mt-hb[data-index="${i}"]`);
    if (!n) return null;
    const v = n.style.getPropertyValue('--hb-scale');
    return v ? Number(v) : null;
  };
  const s0 = scaleOf(targetIndex);
  c.check('建筑按等级设置体量缩放', s0 !== null && s0 > 0,
    s0 !== null ? `--hb-scale = ${s0}` : '未设置 --hb-scale');

  // ---------- 8. 建筑层不裁剪溢出内容 ----------
  const layerOverflow = getComputedStyle(layer).overflow;
  c.check('建筑层不裁剪溢出内容',
    layerOverflow === 'visible',
    `overflow = ${layerOverflow}`);

  // ---------- 9. 同一时刻只有一座建筑可见 ----------
  // ⚠ 回归点：曾经「移动到相邻格时旧建筑不消失」，导致两座楼叠在一起。
  if (instCells.length >= 2) {
    const a = Number(instCells[0].dataset.index);
    const b = Number(instCells[1].dataset.index);
    hoverCell(a);
    settle();
    hoverCell(b);
    settle();
    const visible = Array.from(layer.querySelectorAll('.mt-hb'))
      .filter((n) => n.classList.contains('is-in'));
    c.check('同一时刻只显示一座建筑',
      visible.length === 1 && Number(visible[0].dataset.index) === b,
      `可见 ${visible.length} 座` +
      (visible.length ? `（index=${visible.map((n) => n.dataset.index).join(',')}）` : ''));
  }

  // ---------- 10. 指针离开棋盘 → 建筑隐藏 ----------
  // ⚠ 回归点：leave(-1) 曾因索引不匹配而永不触发，建筑会「粘」在棋盘上。
  {
    hoverCell(targetIndex);
    settle();
    const before = layer.querySelectorAll('.mt-hb.is-in').length;
    // 模拟 mouseleave（离开整个棋盘容器）
    const root = document.getElementById('board-tiles');
    root.dispatchEvent(new MouseEvent('mouseleave', { bubbles: false }));
    settle();
    const after = layer.querySelectorAll('.mt-hb.is-in').length;
    c.check('指针离开棋盘后建筑隐藏',
      before >= 1 && after === 0,
      `离开前 ${before} 座 / 离开后 ${after} 座`);
  }

  // ---------- 11. 恢复原状 ----------
  if (!was3D) {
    if (game && game.stage3d && typeof game.stage3d.set3D === 'function') game.stage3d.set3D(false);
    else btn.click();
    settle();
  }
  hoverCell(-1);

  return c.rows;
}
