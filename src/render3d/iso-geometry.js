/**
 * 真等距 3D 场景 —— 几何常量与坐标换算（**纯数据，不依赖 three.js**）。
 *
 * ================== 为什么单独抽一个「无依赖」模块 ==================
 * 自检脚本（`src/core/selftest-iso3d.js`）必须在**没有 WebGL、没有 three.js**
 * 的环境里也能跑（CI 上跑的是纯逻辑断言）。
 * 因此所有「等距投影 / 网格换算 / 吸附角度」这类**纯数学**的部分
 * 全部放在这里，既能被 3D 渲染层复用，也能被自检直接断言。
 *
 * ================== 等距投影（isometric projection）==================
 * 正交相机 + 极角 35.264°（= atan(1/√2)）+ 方位角 45°+k×90° —— 这是
 * 经典「2:1 像素游戏等距」在 3D 里的标准解：
 *
 *   · 极角 35.264° 保证 X / Y / Z 三轴的投影长度**完全相等**（真等距），
 *     而不是 2:1 像素风那种「看起来像等距」的近似；
 *   · 方位角每档差 90°，四个档位互为 90° 旋转 —— 旋转后棋盘拓扑不变，
 *     玩家只需学会看四个方向，比自由旋转好懂得多。
 *
 * 投影公式（正交相机基向量）：
 *   right = (−sin α, 0, cos α)
 *   up    = (−cos α·sin θ, cos θ, −sin α·sin θ)
 *   屏幕 X = p · right      屏幕 Y = p · up
 *
 * ⚠ 当 θ = atan(1/√2) 时，三轴投影长度**完全相等**（均为 √(2/3) ≈ 0.8165）
 *   —— 这正是「真等距」的判据；2:1 像素风那种「看起来像等距」的近似
 *   达不到这个等式（实测三轴分别为 1.225 / 0.816 / 0.707）。
 *
 * ⚠ 这里的换算用于**自检断言**（三轴等长 / 文字朝向 / 格心落点 / 取景框）；
 *   实际渲染交给 three.js 的 OrthographicCamera，本模块不重复造轮子。
 */

/** 极角 —— 35.264°（真等距：tan θ = 1/√2） */
export const ISO_POLAR = Math.atan(1 / Math.SQRT2);

/** 方位角档数（45° + k×90°，共 4 档） */
export const ISO_AZIMUTH_STEPS = 4;

/** 基准方位角 —— 45° */
export const ISO_BASE_AZIMUTH = 45 * Math.PI / 180;

/** 90° 步进（弧度） */
export const ISO_STEP_RAD = Math.PI / 2;

/**
 * 方位角档位 → 弧度。
 *
 * @param {number} k 档位序号（0..3，可越界，内部归一化）
 * @returns {number} 弧度
 */
export function azimuthOf(k) {
  const n = ((Math.round(k) % ISO_AZIMUTH_STEPS) + ISO_AZIMUTH_STEPS) % ISO_AZIMUTH_STEPS;
  return ISO_BASE_AZIMUTH + n * ISO_STEP_RAD;
}

/**
 * 方位角 → 最近的 90° 档位序号。
 *
 * @param {number} az 方位角（弧度）
 * @returns {number} 档位序号（0..3）
 */
export function snapAzimuthIndex(az) {
  const rel = az - ISO_BASE_AZIMUTH;
  const k = Math.round(rel / ISO_STEP_RAD);
  return ((k % ISO_AZIMUTH_STEPS) + ISO_AZIMUTH_STEPS) % ISO_AZIMUTH_STEPS;
}

/**
 * 旋转吸附 —— 把任意角度吸附到最近的 90° 档位。
 *
 * ⚠ 这是「单指左右拖攒旋转量松手吸附 90°」的核心：
 *   拖到 43° 就松手 → 吸附到 45°（第 0 档）；
 *   拖到 47° 就松手 → 吸附到 135°（第 1 档）。
 *
 * @param {number} az 当前方位角（弧度）
 * @returns {number} 吸附后的方位角（弧度）
 */
export function snapAzimuth(az) {
  return azimuthOf(snapAzimuthIndex(az));
}

/**
 * 拖拽累积量 → 目标档位增量。
 *
 * 拖拽方向与旋转方向一致：向右拖（dx > 0）→ 视角顺时针转，
 * 对应方位角**减小**（three.js 里 camera 绕 Y 轴负向旋转 = 场景顺时针）。
 *
 * @param {number} dx 横向拖拽像素
 * @param {number} pixelsPerQuarter 拖满一档（90°）所需的像素
 * @returns {number} 档位增量（整数，正 = 顺时针）
 */
export function quarterTurnsFor(dx, pixelsPerQuarter) {
  if (!pixelsPerQuarter || pixelsPerQuarter <= 0) return 0;
  return Math.round(dx / pixelsPerQuarter);
}

/**
 * 网格坐标 → 场景坐标（XZ 平面）。
 *
 * 棋盘是 8 列 × 6 行；场景里以「格宽 = 1」为单位，
 * 原点在棋盘几何中心，X 向右、Z 向前（three.js 的 Y 轴朝上）。
 *
 * @param {number} col 列号（0..cols-1）
 * @param {number} row 行号（0..rows-1）
 * @param {number} cols 总列数
 * @param {number} rows 总行数
 * @returns {{x: number, z: number}}
 */
export function gridToScene(col, row, cols, rows) {
  return {
    x: (col - (cols - 1) / 2),
    z: (row - (rows - 1) / 2),
  };
}

/**
 * 等距投影：场景坐标 → 屏幕偏移（单位：格宽）。
 *
 * ================== 推导（正交相机基向量）==================
 * 相机位于方位角 α、极角 θ（自 Y 轴起算），看向原点：
 *   · 右向量 right = (−sin α, 0, cos α)
 *   · 上向量 up    = (−cos α·sin θ, cos θ, −sin α·sin θ)
 * 于是：
 *   · screen_x = p · right
 *   · screen_y = p · up
 *
 * ⚠ 当 θ = atan(1/√2) ≈ 35.264° 时，三轴的投影长度**完全相等**
 *   （三者均为 √(2/3) ≈ 0.8165）—— 这正是「真等距」的判据。
 *   用 2:1 像素风那种「近似等距」是达不到这个等式的。
 *
 * @param {number} x 场景 X
 * @param {number} y 场景 Y（高度）
 * @param {number} z 场景 Z
 * @param {number} az 方位角（弧度）
 * @returns {{sx: number, sy: number}}
 */
export function projectIso(x, y, z, az) {
  const sa = Math.sin(az);
  const ca = Math.cos(az);
  const st = Math.sin(ISO_POLAR);
  const ct = Math.cos(ISO_POLAR);

  const rightX = -sa;
  const rightZ = ca;
  const upX = -ca * st;
  const upY = ct;
  const upZ = -sa * st;

  return {
    sx: x * rightX + z * rightZ,
    sy: x * upX + y * upY + z * upZ,
  };
}

/**
 * 缓动 —— easeInOutCubic（旋转吸附动画用）。
 *
 * @param {number} t 0..1
 * @returns {number} 0..1
 */
export function easeInOutCubic(t) {
  const x = Math.max(0, Math.min(1, t));
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

/** 吸附动画时长（毫秒） */
export const SNAP_MS = 350;

/**
 * 旋转吸附动画的求值。
 *
 * @param {number} from 起始方位角（弧度）
 * @param {number} to 目标方位角（弧度）
 * @param {number} t 进度 0..1
 * @returns {number} 当前方位角（弧度）
 */
export function easeAzimuth(from, to, t) {
  return from + (to - from) * easeInOutCubic(t);
}

/* ===========================================================
 * 尺寸常量 —— 砖块 / 水槽 / 广场
 * =========================================================== */

/** 砖块高度随等级（level 0..4）的映射 —— 用户拍板：0.3 ~ 1.2 */
export const BRICK_HEIGHT_BY_LEVEL = [0.3, 0.525, 0.75, 0.975, 1.2];

/** 砖块平面尺寸（格宽的比例）—— 留一点缝隙给护城河 */
export const BRICK_FOOTPRINT = 0.86;

/** 护城河深度（相对砖块基础高度） */
export const MOAT_DEPTH = 0.22;

/** 中央广场石台的抬升高度 */
export const PLAZA_HEIGHT = 0.16;

/** hover / 选中上浮高度 */
export const HOVER_LIFT = 0.25;

/**
 * 砖块高度 → 由 level 求高度。
 *
 * @param {number} level 0..4
 * @returns {number}
 */
export function brickHeight(level) {
  const i = Math.max(0, Math.min(4, Math.round(level || 0)));
  return BRICK_HEIGHT_BY_LEVEL[i];
}
