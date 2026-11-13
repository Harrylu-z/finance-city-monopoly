/**
 * 棋盘形状 —— **经典正方形环道**（不旋转、文字严格水平）。
 *
 * ================== 为什么回到正方形 ==================
 * 之前的「超椭圆环道」虽然拓扑连续，但带来了三个硬伤：
 *   1. 菱形/弯曲轮廓让边角格子的**文字倾斜**，中文小字极难辨认；
 *   2. 63 个格子挤在细窄环带上，格子过小 → 建筑立绘缩成一团色块；
 *   3. 深蓝背景 + 深蓝棋盘 → 图地不分，剪影读不出来。
 *
 * 本版回到经典大富翁式**正方形环道**：
 *   · 棋盘外形严格为正方形，四条边水平/垂直，**不旋转**；
 *   · 所有格子都是轴对齐矩形，文字与立绘永远水平 —— 可读性第一；
 *   · 格子接近正方形，建筑立绘有足够像素空间；
 *   · 中心区域天然留出一块正方形广场，用于 LOGO / 回合信息 / 骰子动画。
 *
 * ================== 63 格怎么放进正方形 ==================
 * 四个角各属于两条边。设每条边（含端点角格）的格子数为 T/R/B/L，
 * 则总格子数 = T + R + B + L − 4（四个角被重复计了一次）。
 *
 *   取 右 = 上 = 左 = 17、下 = 16  →  17 + 17 + 17 + 16 − 4 = 63  ✔
 *
 * 正方形条件：上边总宽 = 17w，右边总高 = 17h → w = h，格子近似正方；
 * 下边只有 16 格铺满同一条边，故下边格子略宽（17/16 ≈ 1.06 倍），
 * 这正是经典大富翁「底边少一格」的视觉特征，不是缺陷。
 *
 * 环道方向：index 0 = 起点（右下角），之后**逆时针**沿右边 → 上边 →
 * 左边 → 下边推进，index 62 与 index 0 相邻 —— 首尾相连，绝不断裂。
 *
 * ================== 渲染约定 ==================
 * 格子本身是**轴对齐矩形**，中心落在 TRACK_POINTS 给出的轨道点上；
 * 相邻格严格等距，棋子移动是连续平移，不会瞬移。
 */

/** 棋盘尺寸（格数） */
export const BOARD_SIZE = 67;

/**
 * 每条边（含两端角格）的格子数。
 *   右 / 上 / 左 = 18，下 = 17 → 合计 67 格。
 *
 * 说明：底边比其余三边少 1 格，使棋盘容纳新增的 2 块「赌场」地块；
 * 轨道包围盒仍是严格正方形（0..1000），底边格子略宽于其余三边
 * （与原 63 格版本的「下边少一格」设计保持一致）。
 */
export const SIDE_COUNTS = { right: 18, top: 18, left: 18, bottom: 17 };

/**
 * 四个角格的 index —— 由各边格数推导，随 SIDE_COUNTS 自动同步。
 *   右下角(0) → 右上角 → 左上角 → 左下角
 */
export const CORNER_TOP_RIGHT = SIDE_COUNTS.right - 1;
export const CORNER_TOP_LEFT = CORNER_TOP_RIGHT + SIDE_COUNTS.top - 1;
export const CORNER_BOTTOM_LEFT = CORNER_TOP_LEFT + SIDE_COUNTS.left - 1;

/**
 * 轨道参数 —— 归一化到 0..1000 的正方形包围盒。
 * aspect = 1 保证棋盘外形为正方形。
 */
export const TRACK = {
  /** 棋盘宽高比（外轮廓）—— 严格正方形 */
  aspect: 1,
  /** 归一化边长（半边长） */
  half: 500,
};

/**
 * 轨道采样点 —— 63 个格子中心，坐标归一化到 0..1000（正方形）。
 *
 * index 0 = 起点（右下角），逆时针：
 *   右下角 → 右边向上 → 右上角 → 上边向左 → 左上角 → 左边向下 →
 *   左下角 → 下边向右 → 回到起点。
 */
export const TRACK_POINTS = (() => {
  const pts = [];
  const N = 1000;

  // 每条边的 (起点, 终点)；count 含两端角格。
  // 「起始角格」由上一条边负责加入，本边只产出新点。
  const edges = [
    { side: 'right',  count: SIDE_COUNTS.right,  from: { x: N, y: N }, to: { x: N, y: 0 } },
    { side: 'top',    count: SIDE_COUNTS.top,    from: { x: N, y: 0 }, to: { x: 0, y: 0 } },
    { side: 'left',   count: SIDE_COUNTS.left,   from: { x: 0, y: 0 }, to: { x: 0, y: N } },
    // 下边：终点角格 = 起点角格（index 0），因此只取 count−2 个新点。
    { side: 'bottom', count: SIDE_COUNTS.bottom, from: { x: 0, y: N }, to: { x: N, y: N }, closed: true },
  ];

  // 起点：右下角
  pts.push([N, N]);

  for (const e of edges) {
    // 本边新增点数 = count − 1（终点角格）；闭合边再减 1（终点就是起点）。
    const steps = e.count - (e.closed ? 2 : 1);
    for (let i = 1; i <= steps; i++) {
      const t = i / (steps + (e.closed ? 1 : 0));
      const x = e.from.x + (e.to.x - e.from.x) * t;
      const y = e.from.y + (e.to.y - e.from.y) * t;
      pts.push([x, y]);
    }
  }

  if (pts.length !== BOARD_SIZE) {
    throw new Error(`轨道点数量 ${pts.length} ≠ ${BOARD_SIZE}`);
  }
  return pts.map(([x, y]) => [Math.round(x), Math.round(y)]);
})();

/** 四个角格的 index —— 渲染层据此绘制大图标特殊格 */
export const CORNER_INDICES = (() => {
  const out = [];
  for (let i = 0; i < BOARD_SIZE; i++) {
    const p = TRACK_POINTS[i];
    const isXEdge = p[0] === 0 || p[0] === 1000;
    const isYEdge = p[1] === 0 || p[1] === 1000;
    if (isXEdge && isYEdge) out.push(i);
  }
  return out;
})();

/**
 * 棋盘形状描述 —— 供渲染层使用。
 */
export const BOARD_SHAPE = {
  /** 每条边的格子数（含角格） */
  sides: { ...SIDE_COUNTS },
  /** 棋盘宽高比 —— 严格 1（正方形） */
  aspect: TRACK.aspect,
  /** 格子总数 */
  count: BOARD_SIZE,
  /** 角格 index 列表 */
  cornerIndices: CORNER_INDICES,
};

/** 兼容旧接口：网格尺寸描述（渲染层已改用 TRACK_POINTS，此处仅保留元信息） */
export const BOARD_GRID = { cols: 17, rows: 17 };

/**
 * index → 轨道归一化坐标（0..1000）。
 */
export function cellTrackPos(index) {
  const p = TRACK_POINTS[((index % BOARD_SIZE) + BOARD_SIZE) % BOARD_SIZE];
  return { x: p[0], y: p[1] };
}

/** 中心广场（金融城广场）位置 —— 正方形中心（归一化 500,500） */
export const PLAZA_CENTER = { x: 500, y: 500 };

/**
 * 相邻两格中心距离（**显示尺度**下的真实距离，归一化单位）。
 *
 * TRACK_POINTS 已归一化到 0..1000 的正方形，x/y 尺度相同（aspect = 1），
 * 因此可以直接用归一化距离乘以 2×half 还原到显示尺度。
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
  const dx = ((b[0] - a[0]) / 1000) * 2 * TRACK.half;
  const dy = ((b[1] - a[1]) / 1000) * 2 * TRACK.half;
  return Math.hypot(dx, dy);
}

/**
 * 某个 index 属于哪条边 / 是否是角格。
 *
 * 每条边**拥有** count 个格子（含它的两个端点角格），但两个角格
 * 同时也是相邻边的端点 —— 这正是 4 个角被算两次、总和比 63 多 4 的原因。
 *
 * 实际区间（由 TRACK_POINTS 的构造顺序决定）：
 *   右边  idx  0..16   （右下角 → 右上角，17 格）
 *   上边  idx 16..32   （右上角 → 左上角，17 格）
 *   左边  idx 32..48   （左上角 → 左下角，17 格）
 *   底边  idx 48..62   （左下角 → 右下角，15 格 + 起点角格 0）
 *
 * 归属规则：按**几何位置**判定，不靠序号推算 —— 一个格子落在
 * 哪条边上由它的坐标唯一决定（角格归属由「先判横边」决定）。
 * 这样 63 格恰好被统计一次。
 *
 * 实际几何分布：
 *   右边  x = 1000，y 从 1000 → 0    （17 格：idx 0..16）
 *   上边  y = 0，   x 从 1000 → 0    （17 格：idx 16..32）
 *   左边  x = 0，   y 从 0 → 1000    （17 格：idx 32..48）
 *   底边  y = 1000，x 从 0 → 1000    （16 格：idx 48..62 + idx 0）
 *
 * @returns {{side: string, corner: boolean, edgeIndex: number}}
 */
export function cellSideInfo(index) {
  const idx = ((index % BOARD_SIZE) + BOARD_SIZE) % BOARD_SIZE;
  const p = TRACK_POINTS[idx];

  const onRight = p[0] === 1000;
  const onTop = p[1] === 0;
  const onLeft = p[0] === 0;
  const onBottom = p[1] === 1000;
  const isCorner = (onRight || onLeft) && (onTop || onBottom);

  // 角格：按「起点归属」确定唯一一边
  //   右下角(0) → right，上边右上角 → top，左上角 → left，左下角 → bottom
  if (idx === 0) return { side: 'right', corner: true, edgeIndex: 0 };
  if (idx === CORNER_TOP_RIGHT) return { side: 'top', corner: true, edgeIndex: 0 };
  if (idx === CORNER_TOP_LEFT) return { side: 'left', corner: true, edgeIndex: 0 };
  if (idx === CORNER_BOTTOM_LEFT) return { side: 'bottom', corner: true, edgeIndex: 0 };

  if (onRight) return { side: 'right', corner: false, edgeIndex: idx };
  if (onTop) return { side: 'top', corner: false, edgeIndex: idx - CORNER_TOP_RIGHT };
  if (onLeft) return { side: 'left', corner: false, edgeIndex: idx - CORNER_TOP_LEFT };
  return { side: 'bottom', corner: false, edgeIndex: idx - CORNER_BOTTOM_LEFT };
}
