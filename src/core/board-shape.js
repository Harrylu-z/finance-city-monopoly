/**
 * 棋盘形状 —— **同心双环（疏朗）** 46 格。
 *
 * ================== 为什么改成同心双环 ==================
 * 之前的「严格正方形环道」（67 格）把 16 个功能特殊格全部摊在一条方环上，
 * 轨道被功能格切碎、格子小到看不清地块名。新版改为**两圈同心环**：
 *
 *   · 网格 = **10 列 × 7 行**（横向铺满画布，格子大幅放大）；
 *   · **外环** = 10×7 矩形边框 = 30 格（城墙）—— 网点级 / 支行级资产；
 *   · **护城河** = 1 格宽的空白带（视觉上把内外城隔开）；
 *   · **内环** = (10−4)×(7−4) = 6×3 矩形边框 = 14 格（城中之城）——
 *     四大监管 + 总部级 / 地标级资产，越靠中心越贵；
 *   · **2 座城门** 架在顶部护城河上（坐标 (3,1) 与 (4,1)），
 *     把两环并成**一条闭合回路**。
 *
 * ================== 轨道拓扑 ==================
 * 外环从 (4,0) 起顺时针绕行一周 → 落到城门 A (3,1) → 进入内环（**逆时针**）→
 * 内环终点 (4,2) → 城门 B (4,1) → 回到外环起点 (4,0)。
 *
 * 全程**每一步都是网格四邻接移动**（曼哈顿距离恒为 1），
 * 棋子只做平移、绝不瞬移；因此移动 / 买地 / 绕圈 / 破产等规则层逻辑零改动。
 *
 * ⚠ 实现要点（勿改）：`ring()` 的底边必须用 `range(c1 - 1, c0 - 1, -1)`，
 *   终点是 `c0 - 1`（**包含左下角**）。若写成 `range(c1 - 1, c0, -1)`，
 *   左下角缺失，轨道在此断开。
 *
 * ================== 渲染约定 ==================
 * 格子本身是**轴对齐矩形**，中心落在 TRACK_POINTS 给出的轨道点上；
 * 归一化坐标 = (col + 0.5) / 10 × 1000 与 (row + 0.5) / 7 × 1000，
 * 因此 **TRACK.aspect = 10 / 7**（不再是正方形的 1）。
 */

/** 棋盘尺寸（格数） */
export const BOARD_SIZE = 46;

/** 网格尺寸 —— 10 列 × 7 行 */
export const BOARD_GRID = { cols: 10, rows: 7 };

/** 网格列数 / 行数 */
export const GRID_COLS = BOARD_GRID.cols;
export const GRID_ROWS = BOARD_GRID.rows;

/**
 * 轨道参数 —— 归一化到 0..1000 的包围盒。
 *
 * aspect = 10/7：棋盘是**横向**的（10 格宽 × 7 格高），
 * 渲染层按此把归一化坐标映射到实际像素，保证格子近似正方形。
 */
export const TRACK = {
  /** 棋盘宽高比（外轮廓）—— 10 列 ÷ 7 行 */
  aspect: GRID_COLS / GRID_ROWS,
  /** 归一化半边长（仅作兼容占位，实际按 aspect 缩放） */
  half: 500,
};

/* ===================================================================
 * 几何构造 —— 网格坐标（col, row）
 * =================================================================== */

/**
 * 矩形边框上的格子，顺时针（从左上角向右）。
 *
 * 角格只出现一次：顶边含两端角，右边含下角，底边含左角，左边不含两端角。
 *
 * ⚠ 底边必须用 `range(c1 - 1, c0 - 1, -1)` —— 终点是 `c0 - 1`，
 * 即**包含左下角** (c0, r1)。若写成 `range(c1 - 1, c0, -1)`，
 * 左下角会缺失，轨道在此断开（校验会报「不相邻」）。
 */
function ring(c0, c1, r0, r1) {
  const out = [];
  for (let c = c0; c <= c1; c++) out.push([c, r0]);          // 顶边（含两角）
  for (let r = r0 + 1; r <= r1; r++) out.push([c1, r]);      // 右边（含下角）
  for (let c = c1 - 1; c >= c0; c--) out.push([c, r1]);      // 底边（含左角）★
  for (let r = r1 - 1; r > r0; r--) out.push([c0, r]);        // 左边（不含两角）
  return out;
}

/** 把序列旋转到从 startIdx 开始（step = 1 顺时针，-1 逆时针） */
function rot(seq, startIdx, step = 1) {
  const n = seq.length;
  const out = [];
  for (let k = 0; k < n; k++) out.push(seq[((startIdx + step * k) % n + n) % n]);
  return out;
}

/** 校验闭合回路：无重复坐标 + 相邻曼哈顿距离恒为 1 */
function validateCycle(name, cycle) {
  if (new Set(cycle.map((c) => c.join(','))).size !== cycle.length) {
    throw new Error(`${name}：存在重复坐标`);
  }
  for (let i = 0; i < cycle.length; i++) {
    const a = cycle[i];
    const b = cycle[(i + 1) % cycle.length];
    if (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) !== 1) {
      throw new Error(`${name}：(${a}) → (${b}) 不相邻`);
    }
  }
}

/* ---- 外环 / 内环 / 城门 ---- */

/** 外环 —— 10×7 边框，从 (4,0) 起顺时针 */
export const OUTER_PATH = (() => {
  const outer = ring(0, GRID_COLS - 1, 0, GRID_ROWS - 1);
  const start = outer.findIndex((c) => c[0] === 4 && c[1] === 0);
  return rot(outer, start);
})();

/** 内环 —— 6×3 边框（cols 2..7, rows 2..4），从 (3,2) 起逆时针 */
export const INNER_PATH = (() => {
  const inner = ring(2, GRID_COLS - 3, 2, GRID_ROWS - 3);
  return rot(inner, inner.findIndex((c) => c[0] === 3 && c[1] === 2), -1);
})();

/** 城门 —— 架在顶部护城河上的两格（把内外环并成一条回路） */
export const GATE_A = [3, 1];
export const GATE_B = [4, 1];

/** 完整闭合回路 —— 外环 → 城门A → 内环 → 城门B */
export const TRACK_CELLS = (() => {
  const cyc = [...OUTER_PATH, GATE_A, ...INNER_PATH, GATE_B];
  validateCycle('同心双环', cyc);
  if (cyc.length !== BOARD_SIZE) {
    throw new Error(`回路长度 ${cyc.length} ≠ ${BOARD_SIZE}`);
  }
  return cyc;
})();

/** 外环格数（30） */
export const OUTER_COUNT = OUTER_PATH.length;
/** 内环格数（14） */
export const INNER_COUNT = INNER_PATH.length;
/** 城门格数（2） */
export const GATE_COUNT = 2;

/**
 * 轨道采样点 —— 46 个格子中心，坐标归一化到 0..1000。
 *
 * x = (col + 0.5) / 10 × 1000，y = (row + 0.5) / 7 × 1000。
 */
export const TRACK_POINTS = TRACK_CELLS.map(([c, r]) => [
  Math.round(((c + 0.5) / GRID_COLS) * 1000),
  Math.round(((r + 0.5) / GRID_ROWS) * 1000),
]);

/**
 * 内环 14 个 index。
 *
 * 回路顺序：外环 0..29 → 城门A 30 → 内环 31..44 → 城门B 45。
 */
export const INNER_INDICES = (() => {
  const out = [];
  for (let i = OUTER_COUNT + 1; i < OUTER_COUNT + 1 + INNER_COUNT; i++) out.push(i);
  return out;
})();

/** 城门 2 个 index（城门 A 与城门 B） */
export const GATE_INDICES = [OUTER_COUNT, OUTER_COUNT + 1 + INNER_COUNT];

/**
 * 区域描述 —— 供渲染层画护城河与中央广场。
 * 坐标均为**归一化**（0..1000），与 TRACK_POINTS 同一坐标系。
 */
export const ZONES = (() => {
  const cw = 1000 / GRID_COLS;
  const ch = 1000 / GRID_ROWS;
  return [
    {
      kind: 'moat',
      label: '',
      x: cw, y: ch,
      w: (GRID_COLS - 2) * cw, h: (GRID_ROWS - 2) * ch,
    },
    {
      kind: 'moat-label',
      label: '护 城 河',
      x: cw, y: ch,
      w: (GRID_COLS - 2) * cw, h: ch,
    },
    {
      kind: 'plaza',
      label: '中央广场',
      x: 3 * cw, y: 3 * ch,
      w: (GRID_COLS - 6) * cw, h: (GRID_ROWS - 6) * ch,
    },
  ];
})();

/** 中央广场（金融城广场）位置 —— 内环几何中心（归一化） */
export const PLAZA_CENTER = (() => {
  const cw = 1000 / GRID_COLS;
  const ch = 1000 / GRID_ROWS;
  return { x: (GRID_COLS / 2) * cw, y: (GRID_ROWS / 2) * ch };
})();

/**
 * index → 区域归属。
 *   'outer' 外环（城墙）/ 'gate' 城门 / 'inner' 内环（城中之城）
 */
export function cellZone(index) {
  const idx = ((index % BOARD_SIZE) + BOARD_SIZE) % BOARD_SIZE;
  if (GATE_INDICES.includes(idx)) return 'gate';
  if (INNER_INDICES.includes(idx)) return 'inner';
  return 'outer';
}

/** 是否内环格 */
export function isInner(index) {
  return cellZone(index) === 'inner';
}

/** 是否城门格 */
export function isGate(index) {
  return cellZone(index) === 'gate';
}

/**
 * 某个 index 属于哪条边 / 是否是角格。
 *
 * 同心双环没有「一条边」的概念，改为返回**网格坐标**与**环带归属**：
 *   · col / row —— 该格在 10×7 网格中的位置；
 *   · side —— 该格所处的城墙段（top / right / bottom / left），角格归属它
 *     「开始的那条边」（与正方形版的约定一致）；
 *   · corner —— 是否为角格；
 *   · zone —— 'outer' / 'gate' / 'inner'；
 *   · edgeIndex —— 该边内的序号。
 *
 * @returns {{side: string, corner: boolean, edgeIndex: number, col: number, row: number, zone: string}}
 */
export function cellSideInfo(index) {
  const idx = ((index % BOARD_SIZE) + BOARD_SIZE) % BOARD_SIZE;
  const [col, row] = TRACK_CELLS[idx];
  const zone = cellZone(idx);

  // 内环的边框坐标（cols 2..7, rows 2..4）
  const INNER_C0 = 2;
  const INNER_C1 = GRID_COLS - 3;   // 7
  const INNER_R0 = 2;
  const INNER_R1 = GRID_ROWS - 3;   // 4

  // 城墙段归属：先判横边（上 / 下），再判竖边（左 / 右）
  let side = 'top';
  if (zone === 'inner') {
    if (row === INNER_R1) side = 'bottom';
    else if (col === INNER_C0) side = 'left';
    else if (col === INNER_C1) side = 'right';
  } else if (zone === 'gate') {
    // 城门架在护城河上（顶部开口），归属「上边」段
    side = 'top';
  } else {
    if (row === GRID_ROWS - 1) side = 'bottom';
    else if (col === 0) side = 'left';
    else if (col === GRID_COLS - 1) side = 'right';
  }

  // 角格判定 —— 必须**按所属环带**判断：
  //   外环角 = 贴外框两角；内环角 = 贴内框两角；城门不是角格。
  let corner = false;
  if (zone === 'outer') {
    const onTop = row === 0;
    const onBottom = row === GRID_ROWS - 1;
    const onLeft = col === 0;
    const onRight = col === GRID_COLS - 1;
    corner = (onTop || onBottom) && (onLeft || onRight);
  } else if (zone === 'inner') {
    const onTop = row === INNER_R0;
    const onBottom = row === INNER_R1;
    const onLeft = col === INNER_C0;
    const onRight = col === INNER_C1;
    corner = (onTop || onBottom) && (onLeft || onRight);
  }

  return { side, corner, edgeIndex: idx, col, row, zone };
}

/**
 * 棋盘形状描述 —— 供渲染层使用。
 */
export const BOARD_SHAPE = {
  /** 网格列 / 行 */
  cols: GRID_COLS,
  rows: GRID_ROWS,
  /** 外环 / 内环 / 城门格数 */
  outerCount: OUTER_COUNT,
  innerCount: INNER_COUNT,
  gateCount: GATE_COUNT,
  /** 棋盘宽高比 —— 10 / 7 */
  aspect: TRACK.aspect,
  /** 格子总数 */
  count: BOARD_SIZE,
  /** 城门 index（角格概念已随正方形版一同移除） */
  gateIndices: GATE_INDICES,
  /** 内环 index */
  innerIndices: INNER_INDICES,
  /**
   * 角格 index —— 兼容旧渲染层。
   *
   * 同心双环没有正方形版的「四条边角格」概念，但仍需要一组角格
   * （外框两角 + 内框两角）供渲染层画特殊格大图标。
   */
  cornerIndices: (() => {
    const out = [];
    for (let i = 0; i < BOARD_SIZE; i++) {
      if (cellSideInfo(i).corner) out.push(i);
    }
    return out;
  })(),
};

/**
 * 兼容旧渲染层 —— 正方形版每条边的格数。
 *
 * 同心双环没有「每边 N 格」的概念，但旧渲染层（canvas.js）在 import
 * 语句里静态引用了 SIDE_COUNTS，缺失会直接抛错。
 * 这里给出一份**等价的推导值**：外环四条边各自的格数。
 */
export const SIDE_COUNTS = (() => {
  const counts = { top: 0, right: 0, bottom: 0, left: 0 };
  for (let i = 0; i < BOARD_SIZE; i++) {
    const info = cellSideInfo(i);
    counts[info.side] = (counts[info.side] || 0) + 1;
  }
  return counts;
})();

/**
 * index → 轨道归一化坐标（0..1000）。
 */
export function cellTrackPos(index) {
  const p = TRACK_POINTS[((index % BOARD_SIZE) + BOARD_SIZE) % BOARD_SIZE];
  return { x: p[0], y: p[1] };
}

/**
 * 相邻两格中心距离（**显示尺度**下的真实距离，归一化单位）。
 *
 * TRACK_POINTS 归一化到 0..1000，但棋盘宽高比 = 10/7，
 * 因此 x 方向要乘 aspect、y 方向乘 1 才能还原成显示尺度。
 */
export function trackSpacing() {
  let sum = 0;
  for (let i = 0; i < BOARD_SIZE; i++) {
    sum += trackGap(i);
  }
  return sum / BOARD_SIZE;
}

/**
 * 相邻两格中心距离（显示尺度）—— 供自检逐对校验。
 */
export function trackGap(index) {
  const a = TRACK_POINTS[((index % BOARD_SIZE) + BOARD_SIZE) % BOARD_SIZE];
  const b = TRACK_POINTS[(index + 1) % BOARD_SIZE];
  const dx = ((b[0] - a[0]) / 1000) * 2 * TRACK.half * TRACK.aspect;
  const dy = ((b[1] - a[1]) / 1000) * 2 * TRACK.half;
  return Math.hypot(dx, dy);
}
