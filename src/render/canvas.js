/**
 * 棋盘渲染器 —— Canvas 2D，像素硬边。
 *
 * ================== 版图 ==================
 * **同心双环（疏朗）**：10 列 × 7 网格，46 格沿一条闭合回路推进 ——
 * 外环 30 格（城墙）+ 护城河 + 城门 2 格 + 内环 14 格（城中之城）。
 * 全部文字严格水平，可读性第一。
 *
 * ================== 每格三要素 ==================
 *   ① 顶部产权组色条（主色 + 亮部高光 + 暗部阴影三层）
 *   ② 机构名称 / 特殊格标题（字号 ≥ 格子高度的 1/4，自动降级不裁切）
 *   ③ 价格 / 功能说明（等宽数字，紧贴底部）
 *
 * ================== 格子底色 ==================
 * 浅米色（#e8ddc4）—— 与深色背景形成强烈图地分离，
 * 深色文字压在浅底上，边缘清晰可读。
 *
 * ================== 全局状态语言 ==================
 *   当前玩家所在格 → 黄色呼吸光圈 + 脉冲
 *   已购买格       → 归属玩家色边框 + 小旗帜
 *   可购买格       → 轻微绿色渐变提示
 *   抵押 / 禁用格  → 降饱和 + 斜线纹理
 */

import {
  BOARD_CELLS, BOARD_SIZE, BOARD_SHAPE, TRACK_POINTS, PLAZA_CENTER,
  TRACK_CELLS, INNER_INDICES, GATE_INDICES, ZONES, BOARD_GRID,
  cellZone, isInner, isGate, cellSideInfo,
} from '../core/board.js';
import { PLAYER_COLORS, PALETTE, GROUP_COLORS, REGULATOR_COLOR } from '../core/palette.js';
import { getInstitutionSprite } from '../art/buildings.js';
import { getCompactIcon } from '../art/compact-icons.js';
import { getAvatarSprites } from '../art/avatars.js';
import { getSpecialIcon, getTickerPlate, getFlagIcon } from '../art/ui-icons.js';

const GROUP_INDEX = { bank: 0, broker: 1, insurer: 2, asset: 3 };

/** 像素字体栈 —— 与 CSS 保持一致 */
const FONT_UI = '"Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif';
const FONT_NUM = '"Consolas", "Menlo", monospace';

/**
 * 特殊格底色（浅色系，特殊格用不同纹理区分）。
 *
 * 46 格版：棋盘上只保留 7 个特殊格 —— 起点 / 4 转盘 / 2 赌场。
 * 其余 13 个功能格（清算所 / 地铁 / 印花税 ...）被收进转盘内部，
 * 它们的定义仍保留在 board.js 的 SPECIAL 里（转盘结算要用）。
 */
const SPECIAL_TINT = {
  start:        { bg: '#f0d79a', edge: PALETTE.goldDk },
  // ===== 四大转盘（配色沿用 D+ 地块方案的转盘语义色）=====
  hub:          { bg: '#cfe6ee', edge: '#1c6b88' },
  risk:         { bg: '#e8c4bc', edge: PALETTE.redDk },
  chance:       { bg: '#cfe8d0', edge: '#336b38' },
  fate:         { bg: '#dcd8ea', edge: '#5c3a86' },
  // ===== 赌场（城门上的娱乐区入口）=====
  casino:       { bg: '#e4d3ea', edge: '#5c3a86' },
};

/** 转盘分类的语义色（转盘图标 / 徽章用） */
const WHEEL_CAT = {
  hub:   { color: '#2f9fc4', lt: '#63c6e6', dk: '#1c6b88', sign: '流转' },
  cost:  { color: '#c8392b', lt: '#e4604d', dk: '#8d2419', sign: '付出' },
  gain:  { color: '#4f9d55', lt: '#7ac77f', dk: '#336b38', sign: '收益' },
  random:{ color: '#8b5cc7', lt: '#b189e0', dk: '#5c3a86', sign: '抽取' },
  casino:{ color: '#8b5cc7', lt: '#b189e0', dk: '#5c3a86', sign: '开局' },
};

/**
 * 四大监管机构的专属视觉身份（沿用 D+ 地块方案）。
 * 每个监管机构有自己的主色 + 徽章造型 + 效果读数。
 */
const REGULATOR_VISUAL = {
  pbc:  { color: '#c0392b', lt: '#e4604d', dk: '#8d2419', role: '货币政策', badge: 'coin',  big: '+￥80', unit: '每圈开始' },
  csrc: { color: '#2f9fc4', lt: '#63c6e6', dk: '#1c6b88', role: '发行审核', badge: 'shield', big: '-12%', unit: '全体升级费' },
  nfra: { color: '#4f9d55', lt: '#7ac77f', dk: '#336b38', role: '审慎监管', badge: 'scale', big: '-8%',  unit: '全体租金收入' },
  fsc:  { color: '#8b5cc7', lt: '#b189e0', dk: '#5c3a86', role: '风险处置', badge: 'castle',big: '-50%', unit: '陷阱罚金' },
};

/**
 * ================== D+ 现代数据卡 —— 移植到 Canvas ==================
 *
 * 视觉语言源自 `design-proposals/tiles-modern/modern-tiles.js`（HTML 预览版），
 * 这里把 SVG/HTML 的语义转译成 Canvas 绘制指令：
 *
 *   ① **语义优先级翻转** —— 未持有主读数 = 买入价，已持有主读数 = 管理费；
 *   ② **未持有 = 蓝图态** —— 虚线轮廓 + 淡填充 + 三态等级刻度；
 *   ③ **已持有 = 完色态** —— 玩家品牌色 + 所有人徽章 + 等级刻度全实心；
 *   ④ **质押态** —— 红色警示条 + 「已质押」印章；
 *   ⑤ **可收购提示** —— 绿色描边发光 + 「可收购」角标；
 *   ⑥ **特殊格 5 类配色** + 数值读数 + 陷阱角标；
 *   ⑦ **监管格** —— 专属徽章 + 不可升级 + 无管理费。
 *
 * ⚠ 数据源保持不变：全部读自 `core/board.js` 的 price/rent/tier/LEVELS，
 *    规则层零改动。
 */

/** 特殊格 5 类配色（色相即语义） */
const SPECIAL_CATS = {
  hub:    { label: '枢纽', color: '#2f9fc4', lt: '#63c6e6', dk: '#1c6b88', sign: '流转' },
  random: { label: '随机', color: '#8b5cc7', lt: '#b189e0', dk: '#5c3a86', sign: '抽取' },
  cost:   { label: '成本', color: '#c8392b', lt: '#e4604d', dk: '#8d2419', sign: '付出' },
  gain:   { label: '增益', color: '#4f9d55', lt: '#7ac77f', dk: '#336b38', sign: '收益' },
  cycle:  { label: '周期', color: '#e8a93c', lt: '#ffc861', dk: '#9a6a1c', sign: '全局' },
};

/** 特殊格 id → 分类 key（四大转盘的 cat 由 board.js 直接给出） */
const SPECIAL_CAT_OF = {
  start: 'hub', clearing: 'hub', crossborder: 'hub', metro: 'hub',
  event: 'random', casino: 'random',
  tax: 'cost', audit: 'cost', risk: 'cost',
  charity: 'gain', roadshow: 'gain', rating: 'gain', commodity: 'gain', refinance: 'gain',
  market: 'cycle',
};

/** 特殊格关键数值读数（取自 board.js 的真实数值） */
const SPECIAL_EFFECT = {
  start:       { big: '+￥200', lbl: '每圈补贴' },
  clearing:    { big: '直达',   lbl: '结算机构' },
  crossborder: { big: '随机',   lbl: '飞往机构' },
  metro:       { big: '1/2/3', lbl: '前进格数' },
  tax:         { big: '￥40',   lbl: '每份 · 封顶360' },
  charity:     { big: '-￥120', lbl: '管理费 +12%' },
  event:       { big: '抽 1',   lbl: '财经事件卡' },
  market:      { big: '牛↔熊', lbl: '全局租金' },
  audit:       { big: '处罚',   lbl: '罚款/没收' },
  risk:        { big: '整改',   lbl: '去杠杆 2 回合' },
  refinance:   { big: '债券',   lbl: '票息浮动' },
  rating:      { big: '±15%',  lbl: '管理费 3 回合' },
  commodity:   { big: '折溢价', lbl: '套保 2 回合' },
  roadshow:    { big: '+￥80',  lbl: '成本 -15%' },
  casino:      { big: '德扑',   lbl: '全员参与' },
};

/** 等级语义名（与 core/board.js 的 LEVELS 一致，此处做降级兜底） */
const LEVEL_LABELS = ['网点级', '支行级', '分行级', '总部级', '地标级'];

/**
 * 监管效果语义色 —— 增益绿 / 减负蓝 / 约束琥珀 / 减害紫。
 */
const REG_SIGN = {
  benefit:   { label: '增益', color: '#4f9d55' },
  relief:    { label: '减负', color: '#2f9fc4' },
  restraint: { label: '约束', color: '#e8a93c' },
  shield:    { label: '减害', color: '#8b5cc7' },
};

/** 监管效果语义 —— 与 REGULATOR_VISUAL 配套 */
const REG_SIGN_OF = { pbc: 'benefit', csrc: 'relief', nfra: 'restraint', fsc: 'shield' };

/** 监管效果名（D+ 底栏「效果名 · 全体玩家生效」） */
const REG_EFFECT_NAME = {
  pbc: '流动性投放', csrc: '注册制便利', nfra: '审慎约束', fsc: '风险缓冲',
};

/**
 * 颜色明暗调整 —— amt > 0 变亮，amt < 0 变暗（与 D+ 预览版一致）。
 */
function shade(hex, amt) {
  const h = String(hex || '').replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  if (full.length !== 6) return hex;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  const f = (v) => {
    const t = amt > 0 ? 255 : 0;
    const p = Math.abs(amt);
    return Math.round((t - v) * p + v);
  };
  return '#' + [f(r), f(g), f(b)].map((v) => v.toString(16).padStart(2, '0')).join('');
}

/** 千分位格式化 */
function yuanNum(n) {
  return Number(n ?? 0).toLocaleString('en-US');
}

export class BoardRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.ctx.imageSmoothingEnabled = false;
    this.hoverCell = -1;
    this.scale = 2;
    this.time = 0;
    // 底部为 HUD 主行动按钮预留的像素高度（0 = 不预留）
    this.bottomReserve = 0;
  }

  /**
   * 设置底部 HUD 预留高度 —— 棋盘自动上移，避免被主按钮压住。
   *
   * @param {number} px 预留像素高度
   */
  setBottomReserve(px) {
    const next = Math.max(0, Math.round(px || 0));
    if (next === this.bottomReserve) return;
    this.bottomReserve = next;
    this.computeLayout();
  }

  /**
   * 调整画布尺寸。
   *
   * @param {number} w  CSS 像素宽（棋盘容器可用宽度）
   * @param {number} h  CSS 像素高（棋盘容器可用高度）
   * @param {number} dpr 设备像素比
   */
  resize(w, h, dpr = 1) {
    const cw = Math.max(1, Math.floor(w));
    const ch = Math.max(1, Math.floor(h));
    // 只在尺寸真正变化时重建后备存储，避免每帧重置画布（会清空内容）
    const pw = Math.max(1, Math.floor(cw * dpr));
    const ph = Math.max(1, Math.floor(ch * dpr));
    if (this.canvas.width !== pw) this.canvas.width = pw;
    if (this.canvas.height !== ph) this.canvas.height = ph;
    this.ctx.imageSmoothingEnabled = false;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.w = cw;
    this.h = ch;
    this.computeLayout();
  }

  /**
   * 计算棋盘几何布局 —— **同心双环 10×7 网格**。
   *
   * 网格 10 列 × 7 行铺满可用区域：格子宽 = 可用宽 / 10、高 = 可用高 / 7。
   * 由于 TRACK_POINTS 归一化到 0..1000（格心在 (col+0.5)/10 × 1000），
   * 包围盒比整块棋盘**内缩半格** —— 渲染时把整块棋盘按 10/7 的宽高比
   * 缩放即可精确对上格心。
   *
   * ⚠ 关键：格子是以轨道点**为中心**绘制的，所以轨道包围盒必须
   *   比棋盘可用区域**内缩半格**，否则贴边的格子会有一半露到画布外。
   */
  computeLayout() {
    // 边距收紧到 6px —— 尽量把每一像素留给格子，提升名称与立绘可读性
    const margin = 6;

    // ===== 底部预留：主行动按钮（掷骰子）浮在棋盘下方居中 =====
    // 棋盘必须整体上移，避免底边一排格子被按钮压住。
    const bottomReserve = this.bottomReserve || 0;

    // ===== 第一步：可用区域 =====
    const availW = Math.max(80, this.w - margin * 2);
    const availH = Math.max(80, this.h - margin * 2 - bottomReserve);

    // ===== 第二步：格宽 / 格高（严格保持棋盘 10:7 宽高比）=====
    // 整块棋盘（含贴边格子的完整宽度）必须同时塞进可用区域：
    //   棋盘占宽 = cols × cellW，占高 = rows × cellH
    // 归一化坐标 0..1000 对应的是**格心跨度**（cols-1 个格宽 / rows-1 个格高），
    // 因此轨道包围盒 = (cols-1) × cellW × (rows-1) × cellH。
    //
    // ⚠ 关键 1：不能分别用 availW/cols 与 availH/rows 独立取格宽格高 ——
    //   那会破坏 TRACK.aspect = cols/rows，棋盘被拉伸成非等比矩形，
    //   轨道包围盒随之超出可用区，贴边格子就会越界。
    // ⚠ 关键 2：TRACK.aspect = cols/rows 是**整块棋盘**的宽高比，
    //   所以 (cols×cellW) / (rows×cellH) = cols/rows
    //   ⟹ cellW == cellH（格子是正方形），约束只作用在棋盘外框上。
    const cell = Math.max(10, Math.floor(Math.min(
      availW / BOARD_GRID.cols,
      availH / BOARD_GRID.rows,
    )));
    const cellW = cell;
    const cellH = cell;

    // 轨道包围盒（格心跨度）
    const trackW = cellW * (BOARD_GRID.cols - 1);
    const trackH = cellH * (BOARD_GRID.rows - 1);

    // ===== 第三步：居中（水平居中；垂直方向在「上方可用区」内居中）=====
    // 垂直可用区 = [margin, this.h - margin - bottomReserve]
    const usableH = this.h - margin * 2 - bottomReserve;
    // ⚠ 必须按**整块棋盘**（含外侧半格 = rows × cellH）居中，
    //   而不是按轨道包围盒（(rows-1) × cellH）居中 ——
    //   后者会把贴边那一排格子整体顶出可用区，造成底部越界。
    //   棋盘左上角 = 轨道包围盒左上角 − 半格
    const boardW = BOARD_GRID.cols * cellW;
    const boardH = BOARD_GRID.rows * cellH;
    const boardX = Math.floor((this.w - boardW) / 2);
    const boardY = Math.floor(margin + (usableH - boardH) / 2);
    const trackX = boardX + cellW / 2;
    const trackY = boardY + cellH / 2;

    // 整数倍缩放 —— 保证立绘边缘绝对锐利（nearest-neighbor）。
    // 紧凑图标原生 16×16，按「格子可用高度 / 16」取最大整数倍。
    const iconZone = Math.round(Math.min(cellW, cellH) * 0.46);
    const s = Math.max(1, Math.min(4, Math.floor(iconZone / 16) || 1));
    this.scale = s;
    this.cellW = cellW;
    this.cellH = cellH;

    this.trackW = trackW;
    this.trackH = trackH;
    this.trackX = trackX;
    this.trackY = trackY;

    this.layout = {
      cellW, cellH,
      trackX: this.trackX, trackY: this.trackY,
      trackW, trackH,
      // 整块棋盘的外框（贴边格子的完整边界）
      boardX: Math.round(trackX - cellW / 2),
      boardY: Math.round(trackY - cellH / 2),
      boardW: Math.round(trackW + cellW),
      boardH: Math.round(trackH + cellH),
    };
  }

  /**
   * 格子索引 → 屏幕矩形。
   *
   * 棋盘是**一条连续闭合的环道**：index 0..62 沿正方形逆时针推进，
   * index 62 与 index 0 相邻 —— 棋子绕圈全程连贯，不存在瞬移。
   *
   * 每条边按「边内序号」精确切分：
   *   右边 17 格、上边 17 格、左边 17 格、底边 16 格。
   * 格子以轨道点为中心，左右/上下边严格对齐，形成无缝棋盘。
   */
  cellRect(index) {
    const { cellW, cellH } = this.layout;
    const idx = ((index % BOARD_SIZE) + BOARD_SIZE) % BOARD_SIZE;
    const cell = TRACK_CELLS[idx];
    if (!cell) {
      const { trackX, trackY } = this.layout;
      return { x: trackX, y: trackY, w: cellW, h: cellH };
    }
    const { cx, cy } = this.trackCenter(idx);
    return {
      x: Math.round(cx - cellW / 2),
      y: Math.round(cy - cellH / 2),
      w: cellW, h: cellH,
      cx, cy,
    };
  }

  /**
   * 轨道点 → 屏幕中心。
   *
   * ⚠ 归一化坐标的**轨道包围盒**不是 0..1000 —— 格心落在
   *   (col + 0.5) / cols × 1000，所以第 0 列中心在 0.5/cols×1000，
   *   第 (cols-1) 列中心在 (cols-0.5)/cols×1000。
   *   轨道实际跨度只占 (cols-1)/cols，必须先**归一化到 [0,1]**：
   *
   *     t = (p / 1000 − 0.5 / cols) / ((cols − 1) / cols)
   *     cx = trackX + t × trackW
   *
   * 直接用 `p / 1000 × trackW` 会把轨道横向压缩并整体偏移，
   * 导致格子与网格错位、互相压盖、边缘越界。
   */
  trackCenter(idx) {
    const { cellW, cellH, trackX, trackY } = this.layout;
    const cols = BOARD_GRID.cols;
    const rows = BOARD_GRID.rows;
    const p = TRACK_POINTS[idx] || [0, 0];
    const tx = ((p[0] / 1000) - 0.5 / cols) / ((cols - 1) / cols);
    const ty = ((p[1] / 1000) - 0.5 / rows) / ((rows - 1) / rows);
    return {
      cx: trackX + tx * (cols - 1) * cellW,
      cy: trackY + ty * (rows - 1) * cellH,
    };
  }

  /** 屏幕坐标 → 格子索引（取中心距离最近的一格） */
  cellAt(px, py) {
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < TRACK_POINTS.length; i++) {
      const { cx, cy } = this.trackCenter(i);
      const d = (px - cx) ** 2 + (py - cy) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  draw(state, view) {
    const ctx = this.ctx;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, this.w, this.h);
    this.time = view.time || 0;

    this.drawBoardBase(ctx, state);

    for (let i = 0; i < BOARD_SIZE; i++) {
      this.drawCell(ctx, state, i, view);
    }

    // D+ ⑤：可收购绿光 + 角标（独立 pass，必须在格子全部画完后）
    this.drawAffordablePass(ctx, state);

    this.drawTokens(ctx, state, view);

    if (view.effects) view.effects.draw(ctx);
  }

  /**
   * 棋盘底板 —— 实体棋盘（2px 深描边 + 内侧高光）。
   *
   * 同心双环版：整块棋盘是 10 列 × 7 行的横向矩形，
   * 内部由「护城河」（1 格宽空白带）分隔出内外两环。
   */
  drawBoardBase(ctx, state) {
    const { boardX, boardY, boardW, boardH } = this.layout;

    // ===== 实体板质感：外描边 → 暗边 → 内高光 =====
    // 最外层：深墨描边（2px）
    rect(ctx, boardX - 4, boardY - 4, boardW + 8, boardH + 8, PALETTE.ink);
    // 次层：板框（中灰）
    rect(ctx, boardX - 2, boardY - 2, boardW + 4, boardH + 4, '#39415a');
    // 板面（比格子底色稍暗，作为环道底）
    rect(ctx, boardX, boardY, boardW, boardH, PALETTE.boardDk);
    // 内侧微弱高光（1px 顶部 + 左侧）
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillRect(boardX + 1, boardY + 1, boardW - 2, 1);
    ctx.fillRect(boardX + 1, boardY + 1, 1, boardH - 2);

    // ---- 护城河（外环与内环之间的空白带）----
    this.drawMoat(ctx, state);

    // ---- 中央广场（内环围出的中心区域）----
    this.drawCenterPlaza(ctx, state);
  }

  /**
   * 护城河 —— 外环与内环之间的 1 格宽空白带。
   *
   * 画成深蓝水面 + 波纹 + 「护 城 河」字样，
   * 让内外两环在视觉上彻底分开（城墙上跑外环，城中城里跑内环）。
   */
  drawMoat(ctx, state) {
    const z = ZONES.find((v) => v.kind === 'moat');
    if (!z) return;
    const { cellW, cellH, boardX, boardY, boardW, boardH } = this.layout;
    // 归一化坐标 → 像素
    const x = Math.round(boardX + (z.x / 1000) * boardW);
    const y = Math.round(boardY + (z.y / 1000) * boardH);
    const w = Math.round((z.w / 1000) * boardW);
    const h = Math.round((z.h / 1000) * boardH);
    if (w <= 0 || h <= 0) return;

    // 水面底色（深蓝）
    rect(ctx, x, y, w, h, '#1b2a44');
    // 水纹（横条）
    ctx.fillStyle = 'rgba(120,180,220,0.10)';
    for (let wy = y + 3; wy < y + h - 1; wy += 6) {
      ctx.fillRect(x + 2, wy, w - 4, 1);
    }
    // 上下岸线
    ctx.fillStyle = '#2b3a58';
    ctx.fillRect(x, y, w, 1);
    ctx.fillRect(x, y + h - 1, w, 1);

    // 「护 城 河」字样 —— 画在水面正中，浅色低对比，不抢眼
    const labelSize = Math.max(9, Math.min(14, Math.round(h * 0.30)));
    if (h >= labelSize * 2) {
      ctx.font = `bold ${labelSize}px ${FONT_UI}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(160,200,230,0.42)';
      ctx.fillText('护 城 河', x + w / 2, y + h / 2);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
    }
  }

  /**
   * 中心广场 —— LOGO + 当前回合信息 + 骰子动画区。
   *
   * 不做虚线点阵装饰，改为功能性的信息中枢：
   *   ① 顶部：天际线像素 LOGO + 「中国金融城」标题
   *   ② 中部：当前回合玩家 + 市场周期徽章
   *   ③ 底部：骰子动画舞台（骰子精灵在此翻滚）
   */
  drawCenterPlaza(ctx, state) {
    const { boardX, boardY, boardW, boardH } = this.layout;

    // 广场 = 内环围出的中央区域（ZONES 里的 plaza：4 列 × 1 行）
    const z = ZONES.find((v) => v.kind === 'plaza');
    if (!z) return;
    const pw = Math.round((z.w / 1000) * boardW);
    const ph = Math.round((z.h / 1000) * boardH);
    if (pw < 60 || ph < 40) return;
    const px = Math.round(boardX + (z.x / 1000) * boardW);
    const py = Math.round(boardY + (z.y / 1000) * boardH);

    // 广场底板（深色面板，与浅色格子形成对比）
    rect(ctx, px, py, pw, ph, PALETTE.panel);
    // 像素描边（阶梯感：外墨线 + 内金线）
    strokeRect(ctx, px, py, pw, ph, PALETTE.ink);
    strokeRect(ctx, px + 2, py + 2, pw - 4, ph - 4, PALETTE.goldDk);
    // 四角像素装饰
    for (const [ox, oy] of [[0, 0], [pw - 8, 0], [0, ph - 8], [pw - 8, ph - 8]]) {
      rect(ctx, px + ox, py + oy, 8, 8, PALETTE.gold);
      rect(ctx, px + ox + 2, py + oy + 2, 4, 4, PALETTE.panel);
    }

    // 广场是横向长条（4 列 × 1 行）—— 左中右三栏布局：
    //   左栏 = 天际线 LOGO + 标题
    //   中栏 = 当前回合玩家 + 市场周期
    //   右栏 = 骰子动画舞台
    const cx = Math.round(px + pw / 2);
    const isBull = state.market === 'bull';
    const isBear = state.market === 'bear';

    // ===== ① 左栏 · LOGO =====
    const logoS = Math.max(1, Math.min(2, Math.round(ph / 70) || 1));
    const logoX = px + 26;
    this.drawSkylineMark(ctx, logoX, py + ph / 2, logoS);
    ctx.fillStyle = PALETTE.gold;
    ctx.font = `bold ${Math.max(12, Math.min(16, ph * 0.26))}px ${FONT_UI}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('中国金融城', logoX + 24 * logoS, py + ph * 0.36);
    ctx.fillStyle = PALETTE.paper;
    ctx.font = `${Math.max(8, Math.min(10, ph * 0.16))}px ${FONT_UI}`;
    ctx.fillText('像素大富翁 · 金融机构争夺战', logoX + 24 * logoS, py + ph * 0.58);

    // ===== ② 中栏 · 当前回合 =====
    const cur = state.players && state.players[state.currentPlayerIndex];
    ctx.fillStyle = PALETTE.dim;
    ctx.font = `${Math.max(8, Math.min(10, ph * 0.17))}px ${FONT_UI}`;
    ctx.textAlign = 'center';
    ctx.fillText('当 前 回 合', cx, py + ph * 0.26);

    if (cur) {
      const pc = PLAYER_COLORS[cur.colorIndex % PLAYER_COLORS.length];
      const name = cur.name.length > 8 ? cur.name.slice(0, 8) : cur.name;
      ctx.font = `bold ${Math.max(13, Math.min(16, ph * 0.26))}px ${FONT_UI}`;
      const tw = ctx.measureText(name).width;
      const bw = tw + 26;
      const by = Math.round(py + ph * 0.36);
      const bh = Math.max(20, Math.round(ph * 0.36));
      rect(ctx, cx - bw / 2, by, bw, bh, PALETTE.ink);
      strokeRect(ctx, cx - bw / 2, by, bw, bh, pc.main);
      rect(ctx, cx - bw / 2, by, 5, bh, pc.main);
      ctx.fillStyle = pc.lt;
      ctx.textBaseline = 'middle';
      ctx.fillText(name, cx + 5, by + bh / 2);
    }

    // 市场周期徽章
    const label = isBull ? '牛市' : isBear ? '熊市' : '震荡';
    const mc = isBull ? PALETTE.red : isBear ? PALETTE.green : PALETTE.dim;
    ctx.font = `${Math.max(9, Math.min(11, ph * 0.18))}px ${FONT_UI}`;
    ctx.textBaseline = 'middle';
    const mw = ctx.measureText(label).width + 16;
    const mx = Math.round(cx - mw / 2);
    const my = Math.round(py + ph * 0.74);
    rect(ctx, mx, my, mw, Math.max(14, Math.round(ph * 0.22)), PALETTE.ink);
    strokeRect(ctx, mx, my, mw, Math.max(14, Math.round(ph * 0.22)), mc);
    ctx.fillStyle = mc;
    ctx.fillText(label, cx, my + Math.max(14, Math.round(ph * 0.22)) / 2);

    // ===== ③ 右栏 · 骰子动画舞台 =====
    const stageW = Math.max(80, Math.round(pw * 0.26));
    const stageH = Math.max(26, Math.round(ph * 0.62));
    const stageX = px + pw - stageW - 12;
    const stageY = py + (ph - stageH) / 2;
    rect(ctx, stageX, stageY, stageW, stageH, PALETTE.ink);
    strokeRect(ctx, stageX, stageY, stageW, stageH, '#39415a');
    ctx.fillStyle = PALETTE.dim;
    ctx.font = `${Math.max(8, Math.min(10, ph * 0.17))}px ${FONT_UI}`;
    ctx.textAlign = 'center';
    ctx.fillText('骰 子 舞 台', stageX + stageW / 2, stageY + stageH / 2);

    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  /** 天际线像素徽章 */
  drawSkylineMark(ctx, cx, cy, s = 1) {
    const baseY = cy + 8 * s;
    const tower = (bx, bw, bh, color) => {
      rect(ctx, bx, baseY - bh * s, bw * s, bh * s, color);
      rect(ctx, bx, baseY - bh * s, bw * s, 1 * s, PALETTE.goldLt);
      for (let i = 2; i < bh * s; i += 3 * s) rect(ctx, bx + s, baseY - bh * s + i, bw * s - 2 * s, 1, PALETTE.ink);
    };
    tower(cx - 16 * s, 7 * s, 12 * s, '#39415a');
    tower(cx - 6 * s, 10 * s, 18 * s, PALETTE.goldDk);
    tower(cx + 6 * s, 6 * s, 10 * s, '#39415a');
    rect(ctx, cx - 1 * s, baseY - 22 * s, 2 * s, 4 * s, PALETTE.gold);
    rect(ctx, cx - 2 * s, baseY - 23 * s, 4 * s, 1 * s, PALETTE.goldLt);
    rect(ctx, cx - 19 * s, baseY, 38 * s, 2 * s, PALETTE.ink);
    hline(ctx, cx - 19 * s, baseY, 38 * s, PALETTE.goldDk);
  }

  drawCell(ctx, state, index, view) {
    const cell = BOARD_CELLS[index];
    const r = this.cellRect(index);
    const inst = this.getInstitutionState(state, index);
    const isCorner = cellSideInfo(index).corner;
    const zone = cellZone(index);

    // ===== ① 格子底色：浅米色 + 图地分离 =====
    const bg = this.cellBaseColor(index, inst, isCorner);
    rect(ctx, r.x, r.y, r.w, r.h, bg);

    // ===== ② 顶部产权组色条（三层色阶）=====
    this.drawGroupBar(ctx, cell, r, inst);

    // ===== ③ 边框：普通 1px 墨线 =====
    strokeRect(ctx, r.x, r.y, r.w, r.h, PALETTE.ink);

    // ===== ③b 内环「核心」描边 —— 与外环城墙一眼区分 =====
    if (zone === 'inner') {
      this.drawCoreFrame(ctx, r, cell);
    }

    // ===== ④ 状态叠加（在文字之前，画在底色层）=====
    this.drawCellStateOverlay(ctx, state, index, r, inst);

    // ===== ⑤ 主体内容 =====
    if (cell.type === 'institution') {
      this.drawInstitutionCell(ctx, state, cell, r, inst, view, isCorner);
    } else {
      this.drawSpecialCell(ctx, state, cell, r, view, isCorner);
    }

    // ===== ⑥ 当前玩家所在格：黄色呼吸光圈（画在最上层）=====
    this.drawActiveHalo(ctx, state, index, r);
  }

  /**
   * 内环「核心」描边 —— 城中之城的专属边框。
   *
   * 内环格子比外环多一圈金色内描边 + 一层暖色底调，
   * 一眼就能看出「这块地在核心区、越贵」。
   */
  drawCoreFrame(ctx, r, cell) {
    // 暖金内描边（2px）
    ctx.fillStyle = PALETTE.goldDk;
    ctx.fillRect(r.x + 1, r.y + 1, r.w - 2, 2);
    ctx.fillRect(r.x + 1, r.y + r.h - 3, r.w - 2, 2);
    ctx.fillRect(r.x + 1, r.y + 1, 2, r.h - 2);
    ctx.fillRect(r.x + r.w - 3, r.y + 1, 2, r.h - 2);
    // 监管格用紫晶色（非紫则用鎏金）
    const edge = cell.regulator ? REGULATOR_COLOR.dk : PALETTE.goldLt;
    ctx.fillStyle = edge;
    ctx.fillRect(r.x + 1, r.y + 3, r.w - 2, 1);
    ctx.fillRect(r.x + 1, r.y + r.h - 4, r.w - 2, 1);
    ctx.fillRect(r.x + 3, r.y + 1, 1, r.h - 2);
    ctx.fillRect(r.x + r.w - 4, r.y + 1, 1, r.h - 2);
  }

  /**
   * 顶部产权组色条 —— 主色 + 顶部亮部高光 + 底部暗部阴影。
   *
   * D+ ②：**未持有**时色条为**半透明 + 下缘虚线**
   * （「色还在，地皮还没到手」）；已持有时才是实色渐变。
   */
  drawGroupBar(ctx, cell, r, inst) {
    const barH = Math.max(4, Math.round(r.h * 0.12));
    let base = PALETTE.dim;
    let lt = PALETTE.dim;
    let dk = PALETTE.dim;
    if (cell.type === 'institution') {
      if (cell.regulator) {
        // 四大监管各有独立主色（D+ 地块方案）
        const rv = REGULATOR_VISUAL[cell.regulatorId];
        base = rv ? rv.color : REGULATOR_COLOR.base;
        lt = rv ? rv.lt : REGULATOR_COLOR.lt;
        dk = rv ? rv.dk : REGULATOR_COLOR.dk;
      } else {
        const g = GROUP_COLORS[cell.group] || GROUP_COLORS.bank;
        base = g.base; lt = g.lt; dk = g.dk;
      }
    } else {
      const tint = SPECIAL_TINT[cell.special?.id] || { edge: PALETTE.dim };
      base = tint.edge;
      lt = tint.edge;
      dk = PALETTE.ink;
    }
    // 抵押 → 降饱和：改用中性灰
    if (inst && inst.mortgaged) {
      base = PALETTE.dim; lt = '#6b7488'; dk = '#2c3244';
    }

    // ===== D+ ②：未持有 = 蓝图态 → 色条半透明 + 下缘虚线 =====
    const vacant = cell.type === 'institution' && !cell.regulator && !inst;
    if (vacant) {
      ctx.save();
      ctx.globalAlpha = 0.55;
      rect(ctx, r.x + 1, r.y + 1, r.w - 2, barH, base);
      ctx.globalAlpha = 0.85;
      rect(ctx, r.x + 1, r.y + 1, r.w - 2, 1, lt);      // 顶部高光
      ctx.restore();
      // 下缘虚线
      this.drawDashedLine(ctx, r.x + 1, r.y + barH, r.w - 2, dk);
      return;
    }

    rect(ctx, r.x + 1, r.y + 1, r.w - 2, barH, base);
    rect(ctx, r.x + 1, r.y + 1, r.w - 2, 1, lt);      // 顶部高光
    rect(ctx, r.x + 1, r.y + barH, r.w - 2, 1, dk);  // 底部阴影
  }

  /**
   * 水平虚线 —— 像素风虚线（Canvas setLineDash 在像素风下不锐利，手工画）。
   */
  drawDashedLine(ctx, x, y, w, color, dash = 3) {
    const d = Math.max(2, Math.round(dash));
    ctx.fillStyle = color;
    for (let i = 0; i < w; i += d * 2) {
      ctx.fillRect(x + i, Math.round(y), Math.min(d, w - i), 1);
    }
  }

  /**
   * 格子底色 —— 浅米色系；特殊格用不同底色纹理区分。
   */
  cellBaseColor(index, inst, isCorner = false) {
    const cell = BOARD_CELLS[index];
    if (cell.type === 'special') {
      const tint = SPECIAL_TINT[cell.special?.id];
      if (tint) return tint.bg;
      return PALETTE.board;
    }
    if (isCorner) return '#ded0b2';
    if (inst && inst.mortgaged) return '#cfc9bd';  // 降饱和
    return PALETTE.board;
  }

  getInstitutionState(state, index) {
    for (const p of state.players) {
      for (const inst of p.institutions) {
        if (inst.cellIndex === index) return { ...inst, player: p };
      }
    }
    return null;
  }

  /**
   * 状态视觉语言 —— 全局统一，四种状态叠加在底色层。
   *
   *   · 可购买（未持有、当前玩家够钱）→ **绿色描边发光 + 「可收购」角标**（D+ ⑤）
   *   · 已购买 → 归属玩家色边框 + 右上角所有人徽章
   *   · 抵押 / 禁用 → 降饱和 + 斜线纹理
   */
  drawCellStateOverlay(ctx, state, index, r, inst) {
    const cell = BOARD_CELLS[index];

    // ---- 抵押 / 禁用：斜线纹理 ----
    if (inst && inst.mortgaged) {
      this.drawHazardStripes(ctx, r, 'rgba(21,26,38,0.22)');
    }

    // ---- 可购买：绿色描边发光 + 「可收购」角标（D+ ⑤）----
    if (cell.type === 'institution' && !inst) {
      const cur = state.players && state.players[state.currentPlayerIndex];
      const isTurn = cur && !cur.isAI && !cur.bankrupt;
      const affordable = isTurn && cur.cash >= this.cellBuyPrice(cell);
      if (isTurn) {
        const g = ctx.createLinearGradient(0, r.y, 0, r.y + r.h);
        g.addColorStop(0, 'rgba(79,157,85,0.22)');
        g.addColorStop(1, 'rgba(79,157,85,0.04)');
        ctx.fillStyle = g;
        ctx.fillRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
      }
      // ⚠ 绿光（drawAffordableGlow）会画到**格子矩形之外**，
      //    而格子是按 index 顺序逐个画的 —— 下一格的底色会把前一格的
      //    外扩绿光盖掉。因此绿光 + 角标改由「全格画完后」的
      //    drawAffordablePass 统一绘制（见 draw()）。
    }

    // ---- 已购买：归属玩家色边框 ----
    if (inst && inst.player) {
      const pc = PLAYER_COLORS[inst.player.colorIndex % PLAYER_COLORS.length];
      // 内描边（2px 玩家色）
      ctx.fillStyle = pc.main;
      ctx.fillRect(r.x + 1, r.y + 1, r.w - 2, 2);
      ctx.fillRect(r.x + 1, r.y + r.h - 3, r.w - 2, 2);
      ctx.fillRect(r.x + 1, r.y + 1, 2, r.h - 2);
      ctx.fillRect(r.x + r.w - 3, r.y + 1, 2, r.h - 2);
    }
  }

  /**
   * D+ ⑤「可收购」统一绘制 —— **必须在所有格子画完之后调用**。
   *
   * ⚠ 为什么不能画在 drawCellStateOverlay 里：
   *    绿光是**向外扩**的（画在 r.x - t / r.y - t），
   *    而格子按 index 顺序逐个绘制，后一格的底色 rect 会把
   *    前一格的外扩绿光覆盖掉。抽成独立 pass 后，
   *    绿光永远压在所有格子之上，才真正可见。
   */
  drawAffordablePass(ctx, state) {
    const cur = state.players && state.players[state.currentPlayerIndex];
    if (!cur || cur.isAI || cur.bankrupt) return;
    for (let i = 0; i < BOARD_SIZE; i++) {
      const cell = BOARD_CELLS[i];
      if (cell.type !== 'institution') continue;
      if (this.getInstitutionState(state, i)) continue;   // 已持有不提示
      if (cur.cash < this.cellBuyPrice(cell)) continue;     // 钱不够不提示
      const r = this.cellRect(i);
      this.drawAffordableGlow(ctx, r);
      this.drawAffordableBadge(ctx, r);
    }
  }

  /**
   * 该格的**买入价**（监管格为买断价）。
   * 供「可收购」判定与卡片主读数共用，保证两处数字一致。
   */
  cellBuyPrice(cell) {
    if (!cell) return Infinity;
    if (cell.regulator) return Array.isArray(cell.price) ? cell.price[0] : cell.price;
    const tier = cell.tier || 0;
    const idx = Math.max(0, Math.min(4, tier));
    return Array.isArray(cell.price) ? (cell.price[idx] ?? cell.price[0]) : (cell.price || 0);
  }

  /**
   * D+ ⑤：绿色描边发光 —— 玩家现金足够时，格子外圈泛起绿光。
   */
  drawAffordableGlow(ctx, r) {
    const t = Math.max(2, Math.round(Math.min(r.w, r.h) * 0.045));
    // 外层柔光（半透明绿）
    ctx.fillStyle = 'rgba(79,157,85,0.30)';
    ctx.fillRect(r.x - t, r.y - t, r.w + t * 2, t);
    ctx.fillRect(r.x - t, r.y + r.h, r.w + t * 2, t);
    ctx.fillRect(r.x - t, r.y - t, t, r.h + t * 2);
    ctx.fillRect(r.x + r.w, r.y - t, t, r.h + t * 2);
    // 内层实心绿框
    ctx.fillStyle = PALETTE.green;
    ctx.fillRect(r.x, r.y, r.w, t);
    ctx.fillRect(r.x, r.y + r.h - t, r.w, t);
    ctx.fillRect(r.x, r.y, t, r.h);
    ctx.fillRect(r.x + r.w - t, r.y, t, r.h);
  }

  /**
   * D+ ⑤：「可收购」角标 —— 左上角绿色小旗标。
   */
  drawAffordableBadge(ctx, r) {
    const label = '可收购';
    const fs = Math.max(8, Math.min(11, Math.round(r.h * 0.125)));
    ctx.font = `${fs}px ${FONT_UI}`;
    const tw = ctx.measureText(label).width;
    const pad = Math.max(3, Math.round(fs * 0.38));
    const bw = Math.round(tw + pad * 2);
    const bh = Math.round(fs * 1.55);
    const bx = Math.round(r.x + 2);
    const by = Math.round(r.y + 2);
    rect(ctx, bx, by, bw, bh, PALETTE.green);
    ctx.fillStyle = PALETTE.paper;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, bx + bw / 2, by + bh / 2 + 0.5);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  /** 右上角归属小旗 */
  drawOwnerFlag(ctx, r, color, light) {
    const fx = r.x + r.w - 9;
    const fy = r.y + 3;
    rect(ctx, fx, fy, 1, 8, PALETTE.ink);
    rect(ctx, fx + 1, fy + 1, 5, 4, color);
    rect(ctx, fx + 1, fy + 1, 5, 1, light);
  }

  /**
   * 当前玩家所在格 —— 黄色呼吸光圈 + 脉冲。
   *
   * 呼吸：亮度按时间正弦变化；脉冲：外圈半径周期性扩张。
   * prefers-reduced-motion 时由调用方冻结 this.time（静态高亮）。
   */
  drawActiveHalo(ctx, state, index, r) {
    const cur = state.players && state.players[state.currentPlayerIndex];
    if (!cur) return;
    if (cur.position !== index) return;

    const t = this.time / 900;
    const pulse = (Math.sin(t * Math.PI * 2) + 1) / 2;   // 0..1
    const thickness = Math.max(2, Math.round(Math.min(r.w, r.h) * 0.06));

    // 外层脉冲圈（渐隐的黄色描边）
    const spread = Math.round(1 + pulse * 3);
    ctx.fillStyle = `rgba(232,169,60,${(0.85 - pulse * 0.45).toFixed(3)})`;
    ctx.fillRect(r.x - spread, r.y - spread, r.w + spread * 2, thickness);
    ctx.fillRect(r.x - spread, r.y + r.h - thickness + spread, r.w + spread * 2, thickness);
    ctx.fillRect(r.x - spread, r.y - spread, thickness, r.h + spread * 2);
    ctx.fillRect(r.x + r.w - thickness + spread, r.y - spread, thickness, r.h + spread * 2);

    // 内层实心描边（稳定黄框，一眼定位）
    ctx.fillStyle = PALETTE.gold;
    ctx.fillRect(r.x, r.y, r.w, thickness);
    ctx.fillRect(r.x, r.y + r.h - thickness, r.w, thickness);
    ctx.fillRect(r.x, r.y, thickness, r.h);
    ctx.fillRect(r.x + r.w - thickness, r.y, thickness, r.h);
  }

  /**
   * 机构格 —— **D+ 现代数据卡（双态）**。
   *
   * ================== ① 语义优先级翻转（D+ 的灵魂）==================
   *   · **未持有（蓝图态）**：主读数 = **买入价**（大号）
   *                          次读数 = 「买后每回合 ￥XX」（管理费，小号）
   *   · **已持有（完色态）**：主读数 = **管理费**（大号，玩家最关心的经常性收益）
   *                          次读数 = 「买入/升级价 ￥XX」（小号）
   *   两个数字**永不丢失**，只是主次互换 —— 玩家扫一眼就知道「这块地现在能收多少租」。
   *
   * ================== ② 未持有 = 蓝图态 ==================
   *   · 建筑图标用**虚线线框 + 淡填充**（尚未拥有）
   *   · 等级刻度三态：**实心** = 买下即得（cell.tier）· **虚线** = 之后可升级 · **空白** = 锁定
   *   · 集团色条半透明虚线（「色还在，地皮还没到手」）
   *   · 「买下即 X 级」徽章
   *
   * ================== ③ 已持有 = 完色态 ==================
   *   · 建筑满色 + 玩家品牌色（所有人颜色）
   *   · 所有人徽章（dot + 等级名），不只是那条 2px 色条
   *   · 等级刻度全实心
   *
   * ⚠ 零文字裁切是硬标准：所有文本都走 fitText() / splitNameLines()。
   */
  drawInstitutionCell(ctx, state, cell, r, inst, view, isCorner) {
    const gi = GROUP_INDEX[cell.group] ?? 0;
    const isReg = !!cell.regulator;
    const held = !!(inst && inst.player);
    const owner = inst ? inst.player : null;
    const level = inst ? inst.level : (cell.tier || 0);
    const mortgaged = !!(inst && inst.mortgaged);

    const barH = Math.max(5, Math.round(r.h * 0.13));
    const bodyTop = r.y + barH + 1;
    const bodyH = r.h - barH - 2;

    // ===== 集团配色（未持有 = 集团色；已持有 = 玩家品牌色）=====
    const g = GROUP_COLORS[cell.group] || GROUP_COLORS.bank;
    const pc = owner ? PLAYER_COLORS[owner.colorIndex % PLAYER_COLORS.length] : null;
    const accent = held ? pc.main : g.base;
    const accentDk = held ? pc.dk : g.dk;

    // ===== 建筑图标（D+：贴在名称行右侧，读数行独占整行宽度）=====
    // ⚠ 旧版把图标放在右下角，导致读数行只剩 (textW - iw) 的可用宽度，
    //    「买入/升级价 ￥2,260」这类次读数会被 fitText 截断成「买入/升级价 ￥…」。
    //    现在图标移到名称行右端 —— 读数行拿回整行宽度，数值不再被裁。
    const icon = getCompactIcon({
      kind: cell.kind, level, group: cell.group,
      seed: gi * 31 + (cell.index || 0), regulatorId: cell.regulatorId,
    });
    const iconScale = Math.max(1, Math.min(3, Math.floor((r.h * 0.26) / 16) || 1));
    const iw = icon.width * iconScale;
    const ih = icon.height * iconScale;

    // ===== 名称：必要时拆两行，绝不截断 =====
    const textX = r.x + 3;
    const textW = r.w - 6;
    const nameSizeMax = Math.min(20, Math.round(r.h * 0.26));
    const nameSizeMin = Math.max(11, Math.round(r.h * 0.16));
    // 名称行右侧给建筑图标留位（图标画在名称行右端）
    const nameReserve = iw > 0 ? iw + 3 : 0;
    const nameW = Math.max(20, textW - nameReserve);
    const { lines: nameLines, size: nameSize } = this.splitNameLines(
      cell.name, nameW, nameSizeMin, nameSizeMax,
    );
    const lineH = Math.ceil(nameSize * 1.12);

    // ===== 主读数 / 次读数（① 语义翻转）=====
    // ⚠ 监管格例外：rent 恒为 0 且**不可升级** —— 主读数永远是买断价，
    //    且**不显示管理费**（否则玩家会误以为它能产租金）。
    const lvIdx = Math.max(0, Math.min(4, level));
    const priceVal = Array.isArray(cell.price) ? (cell.price[lvIdx] ?? cell.price[0]) : cell.price;
    const rentVal = Array.isArray(cell.rent) ? (cell.rent[lvIdx] ?? cell.rent[0] ?? 0) : (cell.rent || 0);
    const mainVal = isReg ? priceVal : (held ? rentVal : priceVal);
    const mainLbl = isReg ? '买断价' : (held ? '管理费' : '买入价');
    const subVal = held ? priceVal : rentVal;
    // ⚠ 小视口（cell ≈ 100px）下长标签 + 数值会超出格子宽度。
    //    fitText 会截成「买入/升级价 ￥…」—— 数值丢失，玩家读不到关键信息。
    //    这里按**实际可用宽度**选标签：宽裕用全称，紧凑用短标签，
    //    极端情况只保数值（标签另起一行也不划算，直接省掉）。
    const subLongLbl = held ? '买入/升级价' : '买后每回合';
    const subShortLbl = held ? '升级价' : '每回合';

    // ===== 垂直版面预算（自上而下：名称 / 刻度 / 主读数 / 主标签 / 次读数）=====
    const mainSize = Math.max(13, Math.min(21, Math.round(r.h * 0.21)));
    const mainH = Math.ceil(mainSize * 1.16);
    const lblSize = Math.max(8, Math.min(11, Math.round(r.h * 0.13)));
    const lblH = Math.ceil(lblSize * 1.2);
    const subSize = Math.max(9, Math.min(12, Math.round(r.h * 0.14)));
    const subH = Math.ceil(subSize * 1.2);
    const segH = Math.max(5, Math.round(r.h * 0.055));
    const segGap = Math.max(2, Math.round(r.h * 0.014));

    const nameBlockH = lineH * nameLines.length;
    const readBlockH = mainH + lblH + subH;
    const totalNeed = nameBlockH + (isReg ? 0 : segH + segGap) + readBlockH;

    // 名称块顶部（整体垂直居中；剩余空间优先给名称）
    const slack = Math.max(0, bodyH - totalNeed);
    let y = bodyTop + slack * 0.2;

    // ===== 名称 =====
    ctx.font = `bold ${nameSize}px ${FONT_UI}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = mortgaged ? PALETTE.dim : PALETTE.ink;
    nameLines.forEach((ln, li) => {
      const ly = y + lineH * li + lineH / 2;
      ctx.fillText(ln, textX, Math.round(ly));
    });
    y += nameBlockH;

    // ===== 等级刻度（D+ 三态：实心 = 已有/买下即得，虚线 = 待升级，空白 = 锁定）=====
    if (!isReg) {
      y += segGap;
      this.drawLevelScale(ctx, r.x + 3, y, textW, segH, level, held, accent, accentDk);
      y += segH;
    }

    // ===== 主读数（大号，语义随所有权翻转）=====
    const mainY = y + mainH / 2;
    ctx.font = `bold ${mainSize}px ${FONT_NUM}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = mortgaged ? PALETTE.dim : (held ? PALETTE.redDk : PALETTE.ink);
    const mainText = `￥${yuanNum(mainVal)}`;
    // 读数行独占整行宽度（图标已移到名称行）
    ctx.fillText(this.fitText(ctx, mainText, textW), textX, Math.round(mainY));
    y += mainH;

    // ===== 主读数标签 =====
    ctx.font = `${lblSize}px ${FONT_UI}`;
    ctx.fillStyle = PALETTE.dim;
    ctx.fillText(this.fitText(ctx, mainLbl, textW), textX, Math.round(y + lblH / 2));
    y += lblH;

    // ===== 次读数（小号）=====
    // ⚠ 监管格**不显示管理费**（rent 恒为 0）—— 底部留给效果读数带。
    if (!isReg) {
      ctx.font = `${subSize}px ${FONT_NUM}`;
      ctx.fillStyle = PALETTE.dim;
      const subNum = `￥${yuanNum(subVal)}`;
      const numW = ctx.measureText(subNum).width;
      ctx.font = `${subSize}px ${FONT_UI}`;
      const longW = ctx.measureText(`${subLongLbl} ${subNum}`).width;
      const shortW = ctx.measureText(`${subShortLbl} ${subNum}`).width;
      let subText;
      if (longW <= textW) {
        subText = `${subLongLbl} ${subNum}`;
      } else if (shortW <= textW) {
        subText = `${subShortLbl} ${subNum}`;
      } else if (numW <= textW) {
        // 放不下标签就只显示数值 —— 数值比标签重要
        subText = subNum;
      } else {
        // 极端窄格：数值本身也放不下 → 缩字号后仍要显示完整数值
        const minFs = Math.max(7, subSize - 2);
        ctx.font = `${minFs}px ${FONT_NUM}`;
        subText = this.fitText(ctx, subNum, textW);
      }
      ctx.font = `${subSize}px ${FONT_NUM}`;
      ctx.fillText(subText, textX, Math.round(y + subH / 2));
    }
    y += subH;

    // ===== 建筑图标（D+：名称行右端；未持有 = 蓝图虚线态）=====
    if (iw > 0) {
      const ix = Math.round(r.x + r.w - iw - 1);
      const iy = Math.round(bodyTop + Math.max(0, (nameBlockH - ih) / 2));
      ctx.fillStyle = 'rgba(21,26,38,0.22)';
      ctx.fillRect(ix + 2, iy + ih, Math.max(1, iw - 4), 1);
      if (!held) {
        // ② 蓝图态：虚线线框 + 淡填充（表示尚未拥有）
        this.drawBlueprintIcon(ctx, icon, ix, iy, iw, ih, accent);
      } else {
        // ③ 完色态：满色建筑 + 玩家品牌色
        ctx.drawImage(icon, ix, iy, iw, ih);
      }
    }

    // ===== 监管徽章（右上角，含专属造型 + 「不可升级」铭牌）=====
    if (isReg) {
      this.drawRegulatorBadge(ctx, r, cell.regulatorId);
      // D+ ⑦：效果读数带（语义色标签 + 大号数值）—— 画在格子底部
      this.drawRegulatorEffectBand(ctx, r, cell.regulatorId);
    }

    // ===== 等级徽章（未持有：右「买下即 X 级」；已持有：左上金色方块）=====
    if (!isReg) {
      if (!held) {
        this.drawTierBadge(ctx, r, cell.tier || 0);
      } else {
        this.drawLevelBadge(ctx, r, level);
      }
    }

    // ===== 归属标记 =====
    if (owner) {
      // ③ 所有人徽章（dot + 等级名），不只是那条 2px 色条
      this.drawOwnerBadge(ctx, r, pc, level);
    }
    if (mortgaged) {
      // ④ 质押态：红色警示条 + 「已质押」印章
      this.drawMortgageStamp(ctx, r);
    }

    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  /**
   * 等级刻度条 —— **D+ 三态**（5 段）。
   *
   *   · **实心** = 已有等级（已持有：实际等级）/
   *               买下即得（未持有：cell.tier —— 购买时授予的初始等级）
   *   · **虚线** = 之后可升级到的等级（未持有时的「未来可达」）
   *   · **空白** = 锁定（不可达）
   *
   * 段数固定 5（对应 LEVELS 的 网点/支行/分行/总部/地标）。
   */
  drawLevelScale(ctx, x, y, w, h, level, held, accent, accentDk) {
    const segs = 5;
    const gap = Math.max(1, Math.round(h * 0.3));
    const segW = Math.max(2, Math.floor((w - gap * (segs - 1)) / segs));
    const lv = Math.max(0, Math.min(4, level));
    for (let i = 0; i < segs; i++) {
      const sx = Math.round(x + i * (segW + gap));
      const solid = i <= lv;
      if (solid) {
        // 实心：已有等级 / 买下即得
        ctx.fillStyle = accent;
        ctx.fillRect(sx, Math.round(y), segW, Math.round(h));
      } else if (!held && i === lv + 1) {
        // 虚线：之后可升级到的等级
        this.drawDashedRect(ctx, sx, Math.round(y), segW, Math.round(h), accentDk);
      } else {
        // 空白：锁定
        ctx.fillStyle = 'rgba(21,26,38,0.13)';
        ctx.fillRect(sx, Math.round(y), segW, Math.round(h));
      }
    }
  }

  /**
   * 虚线矩形 —— 像素风虚线描边（Canvas 没有原生虚线矩形，手工画）。
   */
  drawDashedRect(ctx, x, y, w, h, color, dash = 3) {
    const d = Math.max(2, Math.round(dash));
    ctx.fillStyle = color;
    // 上下边
    for (let i = 0; i < w; i += d * 2) {
      const seg = Math.min(d, w - i);
      ctx.fillRect(x + i, y, seg, 1);
      ctx.fillRect(x + i, y + h - 1, seg, 1);
    }
    // 左右边
    for (let j = 0; j < h; j += d * 2) {
      const seg = Math.min(d, h - j);
      ctx.fillRect(x, y + j, 1, seg);
      ctx.fillRect(x + w - 1, y + j, 1, seg);
    }
  }

  /**
   * 蓝图态建筑图标 —— 虚线线框 + 淡填充（未持有的建筑立面）。
   *
   * 直接对 16×16 原生精灵逐像素取 alpha：非透明像素画成**半透明集团色**，
   * 外轮廓再补一圈虚线 —— 这样即使精灵本身是彩色像素，
   * 也会被统一压成「规划蓝图」的灰调，而不是彩色小楼。
   */
  drawBlueprintIcon(ctx, icon, x, y, w, h, accent) {
    const iw = icon.width;
    const ih = icon.height;
    let img = null;
    try {
      const sctx = icon.getContext('2d');
      img = sctx.getImageData(0, 0, iw, ih);
    } catch {
      img = null;
    }
    if (!img) {
      this.drawDashedRect(ctx, x, y, w, h, accent);
      return;
    }
    const scale = w / iw;
    ctx.save();
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = accent;
    for (let py = 0; py < ih; py++) {
      for (let px = 0; px < iw; px++) {
        const a = img.data[(py * iw + px) * 4 + 3];
        if (a === 0) continue;
        ctx.fillRect(
          Math.round(x + px * scale), Math.round(y + py * scale),
          Math.max(1, Math.round(scale)), Math.max(1, Math.round(scale)),
        );
      }
    }
    ctx.globalAlpha = 1;
    // 外轮廓虚线（描出建筑的剪影包围盒）
    const bh = Math.round(h * 0.88);
    const by = Math.round(y + h - bh);
    this.drawDashedRect(ctx, Math.round(x + 1), by, Math.round(w - 2), bh, accent);
    ctx.restore();
  }

  /**
   * 「买下即 X 级」徽章 —— 未持有格右上角的小铭牌。
   * 直接暴露 cell.tier（购买时授予的初始等级）。
   */
  drawTierBadge(ctx, r, tier) {
    const lv = Math.max(0, Math.min(4, tier));
    const label = `买下即 ${LEVEL_LABELS[lv] || lv + '级'}`;
    const fs = Math.max(8, Math.min(11, Math.round(r.h * 0.13)));
    ctx.font = `${fs}px ${FONT_UI}`;
    const tw = ctx.measureText(label).width;
    const pad = Math.max(3, Math.round(fs * 0.4));
    const bw = Math.round(tw + pad * 2);
    const bh = Math.round(fs * 1.6);
    const bx = Math.round(r.x + r.w - bw - 2);
    const by = Math.round(r.y + 2);
    rect(ctx, bx, by, bw, bh, 'rgba(21,26,38,0.78)');
    ctx.fillStyle = PALETTE.goldLt;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, bx + bw / 2, by + bh / 2 + 0.5);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  /**
   * 所有人徽章 —— D+「右上业主色点 + 等级名」形式。
   *
   * 比旧版那条 2px 色条信息量高得多：一眼看出「谁的地」+「什么等级」。
   */
  drawOwnerBadge(ctx, r, pc, level) {
    const dot = Math.max(5, Math.round(Math.min(r.w, r.h) * 0.075));
    const dx = Math.round(r.x + r.w - dot - 2);
    const dy = Math.round(r.y + 2);
    ctx.fillStyle = PALETTE.ink;
    ctx.fillRect(dx - 1, dy - 1, dot + 2, dot + 2);
    ctx.fillStyle = pc.main;
    ctx.fillRect(dx, dy, dot, dot);
    ctx.fillStyle = pc.lt;
    ctx.fillRect(dx, dy, dot, 1);

    // 等级名（徽章下方）
    const lv = Math.max(0, Math.min(4, level));
    const label = LEVEL_LABELS[lv] || `Lv${lv}`;
    const fs = Math.max(7, Math.min(10, Math.round(r.h * 0.115)));
    ctx.font = `${fs}px ${FONT_UI}`;
    const tw = ctx.measureText(label).width;
    const lw = Math.round(tw + 5);
    const lh = Math.round(fs * 1.35);
    const lx = Math.round(r.x + r.w - lw - 2);
    const ly = dy + dot + 1;
    if (ly + lh < r.y + r.h) {
      rect(ctx, lx, ly, lw, lh, pc.dk);
      ctx.fillStyle = PALETTE.paper;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, lx + lw / 2, ly + lh / 2 + 0.5);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
    }
  }

  /**
   * 质押态标识 —— D+ 红色警示条 + 「已质押」印章。
   */
  drawMortgageStamp(ctx, r) {
    const label = '已质押';
    const fs = Math.max(8, Math.min(12, Math.round(r.h * 0.145)));
    ctx.font = `bold ${fs}px ${FONT_UI}`;
    const tw = ctx.measureText(label).width;
    const pad = Math.max(4, Math.round(fs * 0.45));
    const bw = Math.round(tw + pad * 2);
    const bh = Math.round(fs * 1.55);
    const bx = Math.round(r.x + r.w / 2 - bw / 2);
    const by = Math.round(r.y + r.h - bh - 2);

    // 红色警示条（顶部）
    const warnH = Math.max(3, Math.round(r.h * 0.05));
    ctx.fillStyle = PALETTE.red;
    ctx.fillRect(r.x + 1, r.y + 1, r.w - 2, warnH);

    // 印章
    rect(ctx, bx, by, bw, bh, 'rgba(200,57,43,0.92)');
    ctx.strokeStyle = PALETTE.paper;
    ctx.lineWidth = 1;
    ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);
    ctx.fillStyle = PALETTE.paper;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, bx + bw / 2, by + bh / 2 + 0.5);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  /**
   * 等级徽章 —— 顶部色条上的金色方块（墨色描边，等级越高块越多）。
   * 压在深色组色条上依然醒目，一眼读出「网点/支行/分行/总部/地标」档位。
   */
  drawLevelBadge(ctx, r, level) {
    const n = Math.max(0, Math.min(4, level));
    if (n <= 0) return;
    const s = Math.max(4, Math.min(6, Math.round(r.h * 0.085)));
    const y = r.y + 1;
    const x0 = r.x + 2;
    for (let i = 0; i < n; i++) {
      const x = x0 + i * (s + 1);
      ctx.fillStyle = PALETTE.ink;      // 墨色描边
      ctx.fillRect(x, y, s + 1, s + 1);
      ctx.fillStyle = PALETTE.goldLt;   // 亮金填充
      ctx.fillRect(x, y, s, s);
    }
  }

  /**
   * 监管机构徽章 —— 四大监管各有独立的**造型 + 主色**（D+ ⑦）。
   *
   * 沿用 D+ 地块方案（modern-tiles.js 的 regBadgeSVG）：
   *   央行（铜钱方孔 + 上下箭头）· 证监会（盾牌 + 勾）
   *   银保监（天平）· 金稳会（城楼 + 顶棚）
   *
   * 卡面结构（D+ 四张监管卡的共有结构）：
   *   ① 专属徽章（浮于右上角）
   *   ② 「不可升级」铭牌 —— 明确表达不可升级
   *   ③ 效果读数带（语义色标签 + 大号数值）—— 放在格子底部
   *
   * ⚠ 监管格**不画等级刻度、不显示管理费**（rent 恒为 0）——
   *    主读数是买断价，由 drawInstitutionCell 负责。
   */
  drawRegulatorBadge(ctx, r, regulatorId) {
    const info = REGULATOR_VISUAL[regulatorId];
    if (!info) return;
    const size = Math.max(12, Math.min(26, Math.round(Math.min(r.w, r.h) * 0.26)));
    const bx = r.x + r.w - size - 2;
    const by = r.y + 2;
    const cx = bx + size / 2;
    const cy = by + size / 2;
    const u = size / 40;   // 以 40×40 为设计基准缩放

    if (info.badge === 'coin') {
      // 央行：铜钱方孔 + 上下箭头（流动性投放）
      ctx.fillStyle = info.dk;
      ctx.beginPath(); ctx.arc(cx, cy, 13 * u, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = info.color;
      ctx.beginPath(); ctx.arc(cx, cy, 10.5 * u, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = info.dk;
      ctx.fillRect(cx - 4 * u, cy - 4 * u, 8 * u, 8 * u);
      ctx.fillStyle = info.lt;
      ctx.fillRect(cx - 1 * u, cy - 17 * u, 2 * u, 5 * u);
      ctx.fillRect(cx - 1 * u, cy + 12 * u, 2 * u, 5 * u);
    } else if (info.badge === 'shield') {
      // 证监会：盾牌 + 勾（合规即放行）
      ctx.fillStyle = info.dk;
      ctx.beginPath();
      ctx.moveTo(cx, cy - 13 * u);
      ctx.lineTo(cx + 11 * u, cy - 9 * u);
      ctx.lineTo(cx + 11 * u, cy + 2 * u);
      ctx.quadraticCurveTo(cx + 11 * u, cy + 11 * u, cx, cy + 14 * u);
      ctx.quadraticCurveTo(cx - 11 * u, cy + 11 * u, cx - 11 * u, cy + 2 * u);
      ctx.lineTo(cx - 11 * u, cy - 9 * u);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = info.color;
      ctx.beginPath();
      ctx.moveTo(cx, cy - 13 * u);
      ctx.lineTo(cx + 11 * u, cy - 9 * u);
      ctx.lineTo(cx + 11 * u, cy + 2 * u);
      ctx.quadraticCurveTo(cx + 11 * u, cy + 11 * u, cx, cy + 14 * u);
      ctx.closePath();
      ctx.fill();
      // 白色勾
      ctx.strokeStyle = '#f6efe0';
      ctx.lineWidth = Math.max(1, 2.4 * u);
      ctx.beginPath();
      ctx.moveTo(cx - 6 * u, cy);
      ctx.lineTo(cx - 1 * u, cy + 5 * u);
      ctx.lineTo(cx + 7 * u, cy - 6 * u);
      ctx.stroke();
    } else if (info.badge === 'scale') {
      // 银保监：天平（审慎约束）
      ctx.fillStyle = info.dk;
      ctx.fillRect(cx - 1.6 * u, cy - 11 * u, 3.2 * u, 22 * u);
      ctx.fillRect(cx - 11 * u, cy + 10 * u, 22 * u, 3 * u);
      ctx.fillStyle = info.color;
      ctx.fillRect(cx - 13 * u, cy - 11 * u, 26 * u, 2.6 * u);
      ctx.fillStyle = info.lt;
      ctx.beginPath(); ctx.arc(cx, cy - 13 * u, 2.6 * u, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath();
      ctx.moveTo(cx - 13 * u, cy - 8 * u); ctx.lineTo(cx - 17 * u, cy + 2 * u); ctx.lineTo(cx - 9 * u, cy + 2 * u);
      ctx.closePath(); ctx.fill();
      ctx.beginPath();
      ctx.moveTo(cx + 13 * u, cy - 8 * u); ctx.lineTo(cx + 9 * u, cy + 2 * u); ctx.lineTo(cx + 17 * u, cy + 2 * u);
      ctx.closePath(); ctx.fill();
    } else {
      // 金稳会：城楼 + 顶棚（风险屏障）
      ctx.fillStyle = info.color;
      ctx.beginPath();
      ctx.moveTo(cx - 16 * u, cy - 6 * u); ctx.lineTo(cx, cy - 14 * u); ctx.lineTo(cx + 16 * u, cy - 6 * u);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = info.dk;
      ctx.fillRect(cx - 14 * u, cy - 5 * u, 28 * u, 14 * u);
      ctx.fillStyle = info.lt;
      for (let i = 0; i < 4; i++) {
        ctx.fillRect(cx - 11 * u + i * 7 * u, cy - 1 * u, 3.4 * u, 7 * u);
      }
      ctx.fillStyle = info.color;
      ctx.fillRect(cx - 17 * u, cy + 9 * u, 34 * u, 3.4 * u);
    }

    // 「不可升级」铭牌（徽章下方）
    const tagH = Math.max(7, Math.round(size * 0.28));
    const tagW = Math.round(size * 1.2);
    const tx = r.x + r.w - tagW - 2;
    const ty = r.y + 3 + size;
    if (ty + tagH < r.y + r.h - 3) {
      rect(ctx, tx, ty, tagW, tagH, info.dk);
      ctx.fillStyle = PALETTE.paper;
      ctx.font = `${Math.max(6, tagH - 3)}px ${FONT_UI}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('不可升级', tx + tagW / 2, ty + tagH / 2);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
    }
  }

  /**
   * D+ ⑦：监管效果读数带 —— 语义色标签 + 大号数值 + 作用对象。
   *
   * 画在格子底部（压在主读数下方），让玩家不用翻规则就知道
   * 这个监管机构给的是好处还是负担。
   */
  drawRegulatorEffectBand(ctx, r, regulatorId) {
    const info = REGULATOR_VISUAL[regulatorId];
    if (!info) return;
    const sign = REG_SIGN[REG_SIGN_OF[regulatorId]] || REG_SIGN.benefit;
    const effName = REG_EFFECT_NAME[regulatorId] || '';

    const bandH = Math.max(13, Math.round(r.h * 0.115));
    const by = Math.round(r.y + r.h - bandH - 2);
    if (by <= r.y) return;

    // 底板（语义色淡底）
    ctx.fillStyle = 'rgba(15,23,42,0.80)';
    ctx.fillRect(r.x + 2, by, r.w - 4, bandH);
    // 左侧语义色竖条
    ctx.fillStyle = sign.color;
    ctx.fillRect(r.x + 2, by, Math.max(3, Math.round(bandH * 0.28)), bandH);

    // 文本：语义标签 + 数值 + 作用对象
    const fs = Math.max(7, Math.min(10, Math.round(bandH * 0.62)));
    const tx = r.x + 2 + Math.max(4, Math.round(bandH * 0.28)) + 3;
    const availW = r.w - (tx - r.x) - 4;

    ctx.font = `bold ${fs}px ${FONT_UI}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const signLabel = sign.label;
    const sw = ctx.measureText(signLabel).width;

    ctx.fillStyle = sign.color;
    ctx.fillText(signLabel, tx, Math.round(by + bandH / 2));

    // 大号数值（等宽数字，紧跟语义标签）
    ctx.font = `bold ${fs}px ${FONT_NUM}`;
    ctx.fillStyle = PALETTE.paper;
    const numX = tx + sw + 4;
    const numW = availW - sw - 4;
    ctx.fillText(this.fitText(ctx, info.big, Math.max(8, numW)), numX, Math.round(by + bandH / 2));

    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  /**
   * 特殊格 —— **D+ 分类色数据卡**（⑥）。
   *
   * 版式结构（自上而下）：
   *   ① 分类标签 + 语义标签（枢纽/流转 · 成本/付出 …）
   *   ② 大图标（居中）
   *   ③ 短名称（用 special.short，完整名在弹窗里）
   *   ④ **关键数值读数**（把 board.js 里的真实数值提到正面：+￥200 / ￥40 / ±15% …）
   *   ⑤ 陷阱角标（trap: true）
   *
   * ⚠ 转盘格 / 赌场格走各自的专属渲染（drawWheelCell / drawCasinoCell），
   *    这里只处理起点这类独立功能格。
   */
  drawSpecialCell(ctx, state, cell, r, view, isCorner) {
    const sp = cell.special;

    // ===== 转盘格：走专属渲染（转盘图标 + 候选效果清单）=====
    if (sp.kind === 'wheel') {
      this.drawWheelCell(ctx, state, cell, r);
      return;
    }
    // ===== 城门上的赌场：走专属渲染 =====
    if (sp.kind === 'gate' || sp.id === 'casino') {
      this.drawCasinoCell(ctx, state, cell, r);
      return;
    }

    // ===== D+ ⑥：分类色（色相即语义）=====
    const catKey = SPECIAL_CAT_OF[sp.id] || 'random';
    const cat = SPECIAL_CATS[catKey] || SPECIAL_CATS.random;
    const eff = SPECIAL_EFFECT[sp.id] || { big: '', lbl: '' };
    const isTrap = !!sp.trap;

    const barH = Math.max(5, Math.round(r.h * 0.13));
    const bodyTop = r.y + barH + 1;
    const bodyH = r.h - barH - 2;
    const textX = r.x + 3;
    const textW = r.w - 6;

    // ---- ① 分类标签 + 语义标签（色条下沿的一行小标签）----
    const tagH = Math.max(10, Math.round(r.h * 0.105));
    const tagFs = Math.max(7, Math.min(10, Math.round(tagH * 0.66)));
    ctx.font = `${tagFs}px ${FONT_UI}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const catLabel = cat.label;
    const catW = ctx.measureText(catLabel).width;
    const signLabel = cat.sign;
    ctx.font = `bold ${tagFs}px ${FONT_UI}`;
    const signW = ctx.measureText(signLabel).width;

    // 分类标签（实底）
    rect(ctx, textX, bodyTop, catW + 6, tagH, cat.color);
    ctx.fillStyle = PALETTE.paper;
    ctx.font = `bold ${tagFs}px ${FONT_UI}`;
    ctx.textAlign = 'center';
    ctx.fillText(catLabel, textX + (catW + 6) / 2, Math.round(bodyTop + tagH / 2));
    // 语义标签（淡底）
    const signX = textX + catW + 8;
    if (signX + signW + 6 <= r.x + r.w - 3) {
      rect(ctx, signX, bodyTop, signW + 6, tagH, 'rgba(21,26,38,0.18)');
      ctx.fillStyle = cat.dk;
      ctx.font = `bold ${tagFs}px ${FONT_UI}`;
      ctx.fillText(signLabel, signX + (signW + 6) / 2, Math.round(bodyTop + tagH / 2));
    }
    ctx.textAlign = 'left';

    const afterTag = bodyTop + tagH + 2;

    // ---- ② 大图标（居中）----
    const effH = Math.max(11, Math.round(r.h * 0.16));
    const iconAreaH = Math.max(14, bodyH - tagH - 2 - effH - 2);
    const iconScale = Math.max(1, Math.min(4, Math.floor(iconAreaH / 16)));
    const icon = getSpecialIcon(sp.icon);
    let iw = icon.width * iconScale;
    let ih = icon.height * iconScale;
    const maxW = r.w - 8;
    if (ih > iconAreaH || iw > maxW) {
      const k = Math.max(1, Math.floor(Math.min(iconAreaH / icon.height, maxW / icon.width)));
      iw = icon.width * k;
      ih = icon.height * k;
    }
    const ix = Math.round(r.x + (r.w - iw) / 2);
    const iy = Math.round(afterTag + Math.max(0, (iconAreaH - ih) * 0.3));
    ctx.drawImage(icon, ix, iy, iw, ih);

    // ---- ③ 短名称（独占整行，绝不截断）----
    const titleText = sp.short || sp.name;
    const titleFs = Math.max(10, Math.min(16, Math.round(r.h * 0.19)));
    const { lines: titleLines, size: titleSize } = this.splitNameLines(
      titleText, textW, Math.max(9, Math.round(r.h * 0.14)), titleFs,
    );
    const titleLineH = Math.ceil(titleSize * 1.12);
    const titleBlockH = titleLineH * titleLines.length;

    // 名称 + 数值读数的版面：优先保住数值读数（策略信息）
    const effTop = Math.round(r.y + r.h - effH - 2);
    const titleTop = Math.min(
      Math.round(iy + ih + 1),
      effTop - titleBlockH - 1,
    );
    ctx.font = `bold ${titleSize}px ${FONT_UI}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = PALETTE.ink;
    titleLines.forEach((ln, li) => {
      const ly = titleTop + titleLineH * li + titleLineH / 2;
      ctx.fillText(ln, r.x + r.w / 2, Math.round(ly));
    });
    ctx.textAlign = 'left';

    // ---- ④ 关键数值读数（直接数值影响，如 +￥200 / ￥40/份）----
    if (eff.big) {
      const bigFs = Math.max(10, Math.min(16, Math.round(r.h * 0.185)));
      const lblFs = Math.max(7, Math.min(10, Math.round(r.h * 0.115)));

      // 先量两段文字，再按「剩余宽度」分配 —— 保证两段都不越界
      ctx.font = `bold ${bigFs}px ${FONT_NUM}`;
      const bigRawW = ctx.measureText(eff.big).width;
      ctx.font = `${lblFs}px ${FONT_UI}`;
      const lblRawW = eff.lbl ? ctx.measureText(eff.lbl).width : 0;

      const bigY = Math.round(effTop + effH * 0.42);
      const gap = 4;

      // 数值优先（策略信息），说明文字可压缩
      let bigMaxW = textW;
      let lblMaxW = 0;
      if (eff.lbl) {
        lblMaxW = Math.max(8, textW - bigRawW - gap);
        bigMaxW = Math.max(8, textW - Math.min(lblRawW, lblMaxW) - gap);
      }
      // ---- 说明文字（eff.lbl）自适应 ----
      // 数值读数（eff.big）优先级最高，**必须完整**；说明文字次之。
      // 策略：① 同行放得下 → 同行右对齐；
      //      ② 放不下 → **独占下一行**（数值下方还有空间）；
      //      ③ 仍放不下 → 缩字号硬塞。
      // 这样小视口下不会出现「每圈补…」这种半截词。
      let lblText = '';
      let lblFsUsed = lblFs;
      let lblStandalone = false;
      if (eff.lbl) {
        ctx.font = `${lblFs}px ${FONT_UI}`;
        if (ctx.measureText(eff.lbl).width <= lblMaxW) {
          lblText = eff.lbl;
        } else {
          // ② 试独占一行：排到数值下方（bigY 之下）
          const standFs = Math.max(7, lblFs - 1);
          const standH = Math.ceil(standFs * 1.25);
          const standTop = Math.round(bigY + effH * 0.30);
          ctx.font = `${standFs}px ${FONT_UI}`;
          const standW = ctx.measureText(eff.lbl).width;
          if (standTop + standH <= r.y + r.h - 1 && standW <= textW) {
            ctx.fillStyle = PALETTE.dim;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillText(eff.lbl, textX, Math.round(standTop + standH / 2));
            ctx.textAlign = 'left';
            ctx.textBaseline = 'alphabetic';
            lblStandalone = true;
            lblFsUsed = standFs;
          } else {
            // ③ 缩字号硬塞
            for (let k = 0; k < 3; k++) {
              const fs = Math.max(7, lblFs - k);
              ctx.font = `${fs}px ${FONT_UI}`;
              if (ctx.measureText(eff.lbl).width <= lblMaxW) {
                lblText = eff.lbl;
                lblFsUsed = fs;
                break;
              }
            }
            if (!lblText) {
              ctx.font = `${Math.max(7, lblFs - 2)}px ${FONT_UI}`;
              lblText = this.fitText(ctx, eff.lbl, lblMaxW);
              lblFsUsed = Math.max(7, lblFs - 2);
            }
          }
        }
      }

      ctx.font = `bold ${bigFs}px ${FONT_NUM}`;
      ctx.fillStyle = isTrap ? PALETTE.redDk : cat.dk;
      ctx.fillText(this.fitText(ctx, eff.big, bigMaxW), textX, bigY);

      if (lblText && !lblStandalone) {
        ctx.font = `${lblFsUsed}px ${FONT_UI}`;
        ctx.fillStyle = PALETTE.dim;
        ctx.textAlign = 'right';
        // 右端对齐到「文字区右端」（= 格子右沿 - 3px），保证不越界
        ctx.fillText(lblText, textX + textW, bigY);
        ctx.textAlign = 'left';
      }
    }

    // ---- ⑤ 陷阱角标 ----
    if (isTrap) {
      this.drawTrapBadge(ctx, r);
    }

    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  /**
   * D+ ⑥：陷阱角标 —— 红色「陷阱」小章（右上角）。
   */
  drawTrapBadge(ctx, r) {
    const label = '陷阱';
    const fs = Math.max(8, Math.min(11, Math.round(r.h * 0.13)));
    ctx.font = `bold ${fs}px ${FONT_UI}`;
    const tw = ctx.measureText(label).width;
    const pad = Math.max(3, Math.round(fs * 0.4));
    const bw = Math.round(tw + pad * 2);
    const bh = Math.round(fs * 1.55);
    const bx = Math.round(r.x + r.w - bw - 2);
    const by = Math.round(r.y + 2);
    rect(ctx, bx, by, bw, bh, PALETTE.red);
    ctx.fillStyle = PALETTE.paper;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, bx + bw / 2, by + bh / 2 + 0.5);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  /**
   * 转盘格 —— 大转盘图标 + 候选效果清单。
   *
   * 视觉沿用 D+ 地块方案的「现代数据卡」：
   *   顶部色条 = 转盘主色；
   *   中部     = 真实转盘造型（4 扇区 + 中心轴 + 固定指针）；
   *   下部     = 候选效果名 + 数值读数（陷阱项标红）。
   */
  drawWheelCell(ctx, state, cell, r) {
    const sp = cell.special;
    const cat = WHEEL_CAT[sp.cat] || WHEEL_CAT.random;
    const barH = Math.max(5, Math.round(r.h * 0.12));
    const bodyTop = r.y + barH + 1;
    const bodyH = r.h - barH - 2;

    // ---- D+ ⑥：分类标签（语义）—— 放在标题右上角的小标签 ----
    const titleText = sp.short || sp.name;
    const textX = r.x + 3;
    const textW = r.w - 6;

    // 分类标签（占右上角，标题避开它）
    const catTagH = Math.max(9, Math.round(r.h * 0.10));
    const catTagFs = Math.max(7, Math.min(10, Math.round(catTagH * 0.66)));
    ctx.font = `bold ${catTagFs}px ${FONT_UI}`;
    const catTagW = ctx.measureText(cat.sign).width + 6;
    const catTagX = r.x + r.w - catTagW - 2;
    const catTagY = r.y + 2;
    rect(ctx, catTagX, catTagY, catTagW, catTagH, cat.color);
    ctx.fillStyle = PALETTE.paper;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(cat.sign, catTagX + catTagW / 2, Math.round(catTagY + catTagH / 2));
    ctx.textAlign = 'left';

    const titleMaxW = Math.max(20, textW - catTagW - 3);
    const { lines: titleLines, size: titleSize } = this.splitNameLines(
      titleText, titleMaxW, Math.max(11, Math.round(r.h * 0.17)), Math.min(18, Math.round(r.h * 0.26)),
    );
    const titleLineH = Math.ceil(titleSize * 1.12);
    ctx.font = `bold ${titleSize}px ${FONT_UI}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = PALETTE.ink;
    titleLines.forEach((ln, li) => {
      const y = bodyTop + titleLineH * li + titleLineH / 2 + 1;
      ctx.fillText(ln, textX, Math.round(y));
    });
    const afterTitle = bodyTop + titleLineH * titleLines.length + 2;

    // ---- 转盘图标（居中）----
    const iconH = Math.max(14, Math.min(r.h * 0.34, (bodyH - titleLineH * titleLines.length) * 0.62));
    const iconW = Math.min(r.w - 12, iconH);
    const ix = Math.round(r.x + (r.w - iconW) / 2);
    const iy = Math.round(afterTitle + Math.max(0, (bodyH - titleLineH * titleLines.length - iconH) * 0.25));
    this.drawWheelIcon(ctx, ix, iy, iconW, iconH, cat);

    // ---- 候选效果清单（最多 3 条，超出用「+N」）----
    const outs = sp.outcomeData || [];
    const listTop = Math.round(iy + iconH + 2);
    const listH = Math.max(0, r.y + r.h - listTop - 2);
    if (listH >= 9 && outs.length) {
      const rowH = Math.max(8, Math.min(11, Math.floor(listH / Math.min(3, outs.length))));
      const maxRows = Math.max(1, Math.floor(listH / rowH));
      ctx.font = `${Math.max(7, Math.min(9, rowH - 2))}px ${FONT_UI}`;
      ctx.textBaseline = 'middle';
      const rowFs = Math.max(7, Math.min(9, rowH - 2));
      for (let i = 0; i < Math.min(maxRows, outs.length); i++) {
        const o = outs[i];
        const y = listTop + rowH * i + rowH / 2;
        const label = o.name;
        const val = o.big;

        // ⚠ 值右对齐于「文字区右端」（= 格子右沿 - 3px），
        //    因此值与标签之和不得超过 textW —— 两者都需 fitText。
        ctx.font = `bold ${rowFs}px ${FONT_NUM}`;
        const valRawW = ctx.measureText(val).width;
        ctx.font = `${rowFs}px ${FONT_UI}`;
        const labelRawW = ctx.measureText(label).width;

        // 值最多占 45%，剩下的给标签
        const valMaxW = Math.max(6, Math.min(valRawW, textW * 0.45));
        const labelMaxW = Math.max(6, textW - valMaxW - 4);

        ctx.fillStyle = o.trap ? PALETTE.redDk : PALETTE.dim;
        ctx.fillText(this.fitText(ctx, label, labelMaxW), textX, Math.round(y));

        ctx.font = `bold ${rowFs}px ${FONT_NUM}`;
        ctx.textAlign = 'right';
        ctx.fillStyle = o.trap ? PALETTE.redDk : cat.dk;
        ctx.fillText(this.fitText(ctx, val, valMaxW), textX + textW, Math.round(y));
        ctx.textAlign = 'left';
        ctx.font = `${rowFs}px ${FONT_UI}`;
      }
      // 剩余候选用「+N」提示
      if (outs.length > maxRows) {
        ctx.fillStyle = PALETTE.dim;
        ctx.font = `${Math.max(7, Math.min(9, rowH - 2))}px ${FONT_UI}`;
        const more = `+${outs.length - maxRows}`;
        ctx.textAlign = 'right';
        ctx.fillText(this.fitText(ctx, more, Math.max(6, textW * 0.45)), textX + textW,
          Math.round(listTop + rowH * maxRows + rowH / 2));
        ctx.textAlign = 'left';
      }
    }

    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  /**
   * 转盘图标 —— 4 扇区轮盘 + 中心轴 + **固定指针**。
   *
   * ⚠ 指针画在轮盘之外的独立层（不随轮盘旋转），
   *    坐标沿用设计稿已验证的 `16.5,3 23.5,3 20,10`（尖端朝下）。
   */
  drawWheelIcon(ctx, x, y, w, h, cat) {
    const cx = x + w / 2;
    const cy = y + h / 2;
    const r = Math.min(w, h) / 2 - 1;
    if (r <= 2) return;

    // 轮盘底盘（暗色描边）
    ctx.fillStyle = cat.dk;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();

    // 4 个扇区（交替深浅）
    const n = 4;
    for (let i = 0; i < n; i++) {
      const a0 = (i * (360 / n) - 90) * Math.PI / 180;
      const a1 = ((i + 1) * (360 / n) - 90) * Math.PI / 180;
      ctx.fillStyle = i % 2 ? cat.lt : cat.color;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, r - 1, a0, a1);
      ctx.closePath();
      ctx.fill();
    }

    // 中心轴
    const hub = Math.max(2, Math.round(r * 0.28));
    ctx.fillStyle = '#f6efe0';
    ctx.beginPath();
    ctx.arc(cx, cy, hub, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = cat.dk;
    ctx.beginPath();
    ctx.arc(cx, cy, hub, 0, Math.PI * 2);
    ctx.lineWidth = 1;
    ctx.stroke();

    // 固定指针（尖端朝下，指向轮盘）—— 不随轮盘旋转
    const pw = Math.max(3, Math.round(r * 0.42));
    const ph = Math.max(4, Math.round(r * 0.55));
    const py = cy - r - 1;
    ctx.fillStyle = cat.dk;
    ctx.beginPath();
    ctx.moveTo(cx - pw / 2, py);
    ctx.lineTo(cx + pw / 2, py);
    ctx.lineTo(cx, py + ph);
    ctx.closePath();
    ctx.fill();
  }

  /**
   * 赌场格（城门上的娱乐区入口）—— 扑克牌造型 + 「德州扑克」字样。
   */
  drawCasinoCell(ctx, state, cell, r) {
    const sp = cell.special;
    const cat = WHEEL_CAT.casino;
    const barH = Math.max(5, Math.round(r.h * 0.12));
    const bodyTop = r.y + barH + 1;
    const bodyH = r.h - barH - 2;

    // 标题
    const titleText = '私人赌场';
    const textX = r.x + 3;
    const textW = r.w - 6;
    const { lines: titleLines, size: titleSize } = this.splitNameLines(
      titleText, textW, Math.max(11, Math.round(r.h * 0.17)), Math.min(18, Math.round(r.h * 0.26)),
    );
    const titleLineH = Math.ceil(titleSize * 1.12);
    ctx.font = `bold ${titleSize}px ${FONT_UI}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = PALETTE.ink;
    titleLines.forEach((ln, li) => {
      ctx.fillText(ln, textX, Math.round(bodyTop + titleLineH * li + titleLineH / 2 + 1));
    });
    const afterTitle = bodyTop + titleLineH * titleLines.length + 2;

    // 扑克牌图标（红桃 + 黑桃）
    const iconH = Math.max(12, Math.min(r.h * 0.30, (bodyH - titleLineH * titleLines.length) * 0.66));
    const iconW = Math.min(r.w - 12, iconH * 1.6);
    const ix = Math.round(r.x + (r.w - iconW) / 2);
    const iy = Math.round(afterTitle);
    const rr = iconH / 2;
    // 红桃
    ctx.fillStyle = '#c8392b';
    ctx.beginPath();
    ctx.arc(ix + iconW * 0.34, iy + rr * 0.78, rr * 0.52, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(ix + iconW * 0.66, iy + rr * 0.78, rr * 0.52, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(ix + iconW * 0.16, iy + rr * 0.92);
    ctx.lineTo(ix + iconW * 0.84, iy + rr * 0.92);
    ctx.lineTo(ix + iconW * 0.5, iy + iconH - 1);
    ctx.closePath();
    ctx.fill();
    // 黑桃
    ctx.fillStyle = '#1d4ed8';
    ctx.beginPath();
    ctx.arc(ix + iconW * 0.36, iy + rr * 0.5, rr * 0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(ix + iconW * 0.42, iy + rr * 0.86);
    ctx.lineTo(ix + iconW * 0.58, iy + rr * 0.86);
    ctx.lineTo(ix + iconW * 0.5, iy + iconH - 1);
    ctx.closePath();
    ctx.fill();

    // 说明
    const descY = Math.min(r.y + r.h - 4, iy + iconH + 6);
    const descSize = Math.max(9, Math.min(12, Math.round(r.h * 0.15)));
    // ⚠ 小视口（cell ≈ 100px）下长说明会撑不下 —— 先缩字号，仍放不下才裁字。
    const descText = '德州扑克 · 全员同桌';
    let descFs = descSize;
    for (let k = 0; k < 4; k++) {
      ctx.font = `${descFs}px ${FONT_UI}`;
      if (ctx.measureText(descText).width <= textW) break;
      descFs = Math.max(7, descFs - 1);
    }
    ctx.font = `${descFs}px ${FONT_UI}`;
    ctx.fillStyle = cat.dk;
    ctx.fillText(this.fitText(ctx, descText, textW), textX, Math.round(descY));

    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  /** 斜线纹理（禁用 / 陷阱）—— 铺满整格 */
  drawHazardStripes(ctx, r, color) {
    this.drawHazardStripesIn(ctx, r, color, r.y + 1, r.h - 2);
  }

  /**
   * 斜线纹理 —— 只在指定高度区间内绘制。
   *
   * 陷阱格若整格铺斜线，会横穿标题文字，严重损害可读性。
   * 这里把斜纹限制在「顶部色条」高度内：既能一眼看出是陷阱格，
   * 又不会干扰下方的机构名与说明文字。
   */
  drawHazardStripesIn(ctx, r, color, top, height) {
    const step = 8;
    if (height <= 0) return;
    ctx.save();
    ctx.beginPath();
    ctx.rect(r.x + 1, top, r.w - 2, height);
    ctx.clip();
    ctx.fillStyle = color;
    for (let d = -height; d < r.w + height; d += step) {
      for (let y = top; y < top + height; y += step) {
        ctx.fillRect(r.x + 1 + d, y, step, step);
      }
    }
    ctx.restore();
  }

  /**
   * 字号自适应 —— 保证不超出给定宽度，且不低于下限。
   */
  fitFontSize(maxWidth, minSize, maxSize, text) {
    const len = Math.max(1, text.length);
    let size = Math.floor(maxSize);
    while (size > minSize && size * len > maxWidth * 1.05) {
      size -= 1;
    }
    return Math.max(Math.floor(minSize), size);
  }

  /**
   * 把过长的中文名**拆成两行**（而不是截断成「中国…」）。
   *
   * 可读性铁律：地块名必须完整可读。56px 的格子在 14px 字号下
   * 一行只放得下 3 个汉字，「中国工商银行」会被截成「中国…」。
   * 这里按「尽量均分」把名字切成两行：
   *   「中国工商银行」 → 「中国工商」/「银行」
   *   「城东银行」     → 「城东」/「银行」（≤4 字则仍单行）
   *
   * @returns {{lines: string[], size: number}}
   */
  splitNameLines(name, maxWidth, minSize, maxSize) {
    if (!name) return { lines: [''], size: maxSize };

    // 单行能放下就单行（字号取上限）
    const single = this.fitFontSize(maxWidth, minSize, maxSize, name);
    this.ctx.font = `bold ${single}px ${FONT_UI}`;
    if (this.ctx.measureText(name).width <= maxWidth) {
      return { lines: [name], size: single };
    }

    // 需要两行：在 [minSize, maxSize] 内找一个能放下半名的字号
    const mid = Math.ceil(name.length / 2);
    let size = Math.floor(maxSize);
    while (size > minSize) {
      this.ctx.font = `bold ${size}px ${FONT_UI}`;
      const w1 = this.ctx.measureText(name.slice(0, mid)).width;
      const w2 = this.ctx.measureText(name.slice(mid)).width;
      if (Math.max(w1, w2) <= maxWidth) break;
      size -= 1;
    }
    this.ctx.font = `bold ${size}px ${FONT_UI}`;
    return { lines: [name.slice(0, mid), name.slice(mid)], size };
  }

  /**
   * 文本裁剪 —— 按可用宽度截断并加省略号。
   */
  fitText(ctx, text, maxWidth) {
    if (!text) return '';
    if (ctx.measureText(text).width <= maxWidth) return text;
    let s = text;
    while (s.length > 1 && ctx.measureText(s + '…').width > maxWidth) {
      s = s.slice(0, -1);
    }
    return s + '…';
  }

  drawTokens(ctx, state, view) {
    const byCell = new Map();
    const movingId = view.moveAnim ? view.moveAnim.playerId : null;
    for (const p of state.players) {
      if (p.bankrupt) continue;
      if (movingId !== null && p.id === movingId) continue;
      if (!byCell.has(p.position)) byCell.set(p.position, []);
      byCell.get(p.position).push(p);
    }

    for (const [cellIndex, players] of byCell) {
      const r = this.cellRect(cellIndex);
      const n = players.length;
      // 先取第一个玩家的立绘做基准（同一格内通常同职业/同尺寸）
      const refSprite = getAvatarSprites(players[0].avatar, players[0].colorIndex).idle;
      const slots = this.tokenSlots(r, n, refSprite);
      const ts = this.tokenScale(r, refSprite);
      players.forEach((p, i) => {
        const sprites = getAvatarSprites(p.avatar, p.colorIndex);
        const anim = view.moveAnim && view.moveAnim.playerId === p.id ? view.moveAnim : null;

        let tx, ty, sprite;
        if (anim) {
          tx = anim.x;
          ty = anim.y;
          const dirSprites = sprites[anim.dir] || sprites.down;
          sprite = dirSprites[anim.frame % dirSprites.length] || sprites.down[0];
        } else {
          const slot = slots[i];
          tx = slot.x;
          ty = slot.y;
          sprite = sprites.down[0];
        }

        const s = ts;
        const pc = PLAYER_COLORS[p.colorIndex % PLAYER_COLORS.length];

        // 立绘尺寸（职业矢量立绘 32×40）
        const sw = sprite.width;
        const sh = sprite.height;
        const halfW = sw / 2;

        // 底座对齐到棋子脚下
        const baseCx = tx + halfW * s;
        const baseCy = ty + (sh - 1) * s;
        this.drawTokenBase(ctx, baseCx, baseCy, s, pc.main, halfW);

        if (anim && anim.squash) {
          const sq = anim.squash;
          const outlined = this.outlinedSprite(sprite, pc.main);
          const pad = 2;
          ctx.save();
          ctx.translate(Math.round(tx + halfW * s), Math.round(ty + sh * s));
          ctx.scale(sq.sx, sq.sy);
          ctx.drawImage(
            outlined,
            -(halfW + pad) * s,
            -(sh + pad) * s,
            (sw + pad * 2) * s,
            (sh + pad * 2) * s
          );
          ctx.restore();
        } else {
          this.drawTokenOutline(ctx, sprite, tx, ty, s, pc.main);
        }

        // 名牌 —— 站在格子上的**所有玩家**都挂名牌；当前回合玩家额外有箭头 + 金色高亮
        if (!anim) {
          const isCur = state.currentPlayerIndex === p.index;
          if (isCur) this.drawTurnArrow(ctx, tx + halfW * s, ty - 7);
          this.drawTokenNameTag(ctx, tx + halfW * s, ty - 10, p.name, pc.main, isCur);
        }
      });
    }
  }

  /** 棋子底座（深色站台 + 玩家色高光边） */
  drawTokenBase(ctx, cx, cy, s, glow, halfW = 8) {
    // 底座宽度跟随立绘宽度（经典棋子 8，职业立绘 16），但封顶避免过宽
    const rx = Math.max(3, Math.min(Math.round(halfW * s), Math.round(9 * s)));
    const ry = Math.max(2, Math.round(3 * s));
    for (let y = -ry; y <= ry; y++) {
      const t = (y + ry) / (ry * 2);
      const k = Math.sqrt(Math.max(0, 1 - (t * 2 - 1) ** 2));
      const rowRx = Math.max(0, Math.round(rx * k));
      if (rowRx <= 0) continue;
      ctx.fillStyle = PALETTE.ink;
      ctx.fillRect(Math.round(cx - rowRx), Math.round(cy - ry + y), rowRx * 2 + 1, 1);
    }
    ctx.fillStyle = glow;
    ctx.fillRect(Math.round(cx - rx + 1), Math.round(cy - ry), Math.max(0, (rx - 1) * 2), 1);
  }

  /** 棋子双层描边 */
  drawTokenOutline(ctx, sprite, x, y, s, glow) {
    const w = sprite.width;
    const h = sprite.height;
    const alpha = this.tokenAlpha(sprite);
    if (!alpha) {
      ctx.drawImage(sprite, Math.round(x), Math.round(y), w * s, h * s);
      return;
    }
    this.paintOutline(ctx, alpha, w, h, x, y, s, glow);
    ctx.drawImage(sprite, Math.round(x), Math.round(y), w * s, h * s);
  }

  outlinedSprite(sprite, glow) {
    if (!this._outlinedCache) this._outlinedCache = new WeakMap();
    const cached = this._outlinedCache.get(sprite);
    if (cached && cached.glow === glow) return cached.canvas;

    const w = sprite.width;
    const h = sprite.height;
    const pad = 2;
    const cv = document.createElement('canvas');
    cv.width = w + pad * 2;
    cv.height = h + pad * 2;
    const ctx = cv.getContext('2d');
    ctx.imageSmoothingEnabled = false;

    const alpha = this.tokenAlpha(sprite);
    if (!alpha) {
      ctx.drawImage(sprite, pad, pad);
    } else {
      this.paintOutline(ctx, alpha, w, h, pad, pad, 1, glow);
      ctx.drawImage(sprite, pad, pad);
    }
    const entry = { canvas: cv, glow, pad };
    this._outlinedCache.set(sprite, entry);
    return cv;
  }

  paintOutline(ctx, alpha, w, h, x, y, s, glow) {
    const ink = PALETTE.ink;
    for (let py = 0; py < h; py++) {
      for (let px = 0; px < w; px++) {
        if (alpha[py * w + px] !== 0) continue;
        if (!this.nearOpaque(alpha, w, h, px, py)) continue;
        for (let oy = -2; oy <= 2; oy++) {
          for (let ox = -2; ox <= 2; ox++) {
            if (Math.abs(ox) < 2 && Math.abs(oy) < 2) continue;
            const nx = px + ox;
            const ny = py + oy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            if (alpha[ny * w + nx] !== 0) continue;
            ctx.fillStyle = ink;
            ctx.fillRect(Math.round(x + nx * s), Math.round(y + ny * s), s, s);
          }
        }
      }
    }
    ctx.fillStyle = glow;
    for (let py = 0; py < h; py++) {
      for (let px = 0; px < w; px++) {
        if (alpha[py * w + px] !== 0) continue;
        if (!this.nearOpaque(alpha, w, h, px, py)) continue;
        ctx.fillRect(Math.round(x + px * s), Math.round(y + py * s), s, s);
      }
    }
  }

  tokenAlpha(sprite) {
    if (!sprite || !sprite.getContext) return null;
    if (!this._alphaCache) this._alphaCache = new WeakMap();
    if (this._alphaCache.has(sprite)) return this._alphaCache.get(sprite);
    let alpha = null;
    try {
      const sctx = sprite.getContext('2d');
      const img = sctx.getImageData(0, 0, sprite.width, sprite.height);
      alpha = new Uint8Array(sprite.width * sprite.height);
      for (let i = 0; i < alpha.length; i++) alpha[i] = img.data[i * 4 + 3];
    } catch {
      alpha = null;
    }
    this._alphaCache.set(sprite, alpha);
    return alpha;
  }

  nearOpaque(alpha, w, h, px, py) {
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        if (ox === 0 && oy === 0) continue;
        const nx = px + ox;
        const ny = py + oy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        if (alpha[ny * w + nx] !== 0) return true;
      }
    }
    return false;
  }

  /**
   * 棋子缩放倍数 —— 按**立绘实际尺寸**自适应，始终**整数倍**（nearest-neighbor）。
   *
   * 棋子统一是职业矢量立绘（32×40），但仍要保证：
   *   · 完整落在格子的站立带内（不越界、不盖住机构名称）；
   *   · 缩放为整数倍（像素棋子不糊；矢量立绘本就抗锯齿，整数倍更锐利）。
   */
  tokenScale(r, sprite) {
    const bandH = Math.max(16, Math.round(r.h * 0.34));   // 底部站立带高度
    const natH = (sprite && sprite.height) || 24;
    const natW = (sprite && sprite.width) || 16;
    const byH = Math.floor(bandH / natH);
    const maxByW = Math.max(1, Math.floor((r.w * 0.92) / natW));
    return Math.max(1, Math.min(3, byH, maxByW));
  }

  /**
   * 同一格内 N 个棋子的站位。
   *
   * 棋子统一站在格子**底部的站台带**上，横向排布：
   *   · 永远完整落在格子内（不越界、不被画布裁掉）；
   *   · 多人同格时按列排开，超出宽度则错位成多排并抬高后排；
   *   · 不遮挡上方的机构名称与价格（可读性优先）。
   */
  tokenSlots(r, n, sprite) {
    const s = this.tokenScale(r, sprite);
    const natW = (sprite && sprite.width) || 16;
    const natH = (sprite && sprite.height) || 24;
    const w = natW * s;
    const h = natH * s;
    const barH = Math.max(4, Math.round(r.h * 0.12));
    const bodyTop = r.y + barH + 1;
    const bodyH = r.h - barH - 2;

    const slots = [];
    const availW = r.w - 4;
    const perRow = Math.max(1, Math.min(n, Math.floor((availW + 1) / (w + 1)) || 1));
    const rows = Math.ceil(n / perRow);

    // 站立带：贴在格子底部，棋子脚底不越过格子下沿
    const bandTop = bodyTop + bodyH - h;
    const rowLift = Math.max(1, Math.floor(h * 0.16));

    for (let i = 0; i < n; i++) {
      const row = Math.floor(i / perRow);
      const col = i % perRow;
      const inRow = Math.min(perRow, n - row * perRow);
      const rowW = inRow * (w + 1) - 1;
      const startX = r.x + 2 + Math.floor((availW - rowW) / 2);
      // 后排抬高，形成前后层次（但仍在格子内）
      const y = Math.max(bodyTop + 1, bandTop - (rows - 1 - row) * rowLift);
      const x = startX + col * (w + 1);
      slots.push({ x, y, dx: x - r.x, dy: y - r.y });
    }
    return slots;
  }

  slotOffsetFor(state, cellIndex) {
    const r = this.cellRect(cellIndex);
    const others = state.players.filter((p) => !p.bankrupt && p.position === cellIndex);
    const n = Math.max(1, others.length);
    const ref = others[0];
    const sprite = ref ? getAvatarSprites(ref.avatar, ref.colorIndex).idle : null;
    const slots = this.tokenSlots(r, n, sprite);
    const slot = slots[0];
    return { dx: slot.dx, dy: slot.dy };
  }

  /** 玩家名小标签 —— 所有在场玩家都显示；当前回合玩家字号更大、金色顶条 */
  drawTokenNameTag(ctx, cx, cy, name, color, isCurrent = false) {
    const text = (name || '').slice(0, 4);
    const fs = isCurrent ? 9 : 8;
    const h = isCurrent ? 12 : 11;
    ctx.font = `bold ${fs}px ${FONT_UI}`;
    const tw = ctx.measureText(text).width;
    const bw = tw + 6;
    const bx = Math.round(cx - bw / 2);
    const by = Math.round(cy - 10);
    rect(ctx, bx, by, bw, h, PALETTE.ink);
    rect(ctx, bx, by, bw, 1, isCurrent ? PALETTE.gold : color);
    ctx.fillStyle = PALETTE.paper;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, Math.round(cx), by + h / 2 + 0.5);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  drawTurnArrow(ctx, cx, cy) {
    ctx.fillStyle = PALETTE.gold;
    ctx.fillRect(cx - 3, cy, 6, 2);
    ctx.fillRect(cx - 2, cy + 2, 4, 2);
    ctx.fillRect(cx - 1, cy + 4, 2, 2);
    ctx.fillStyle = PALETTE.goldLt;
    ctx.fillRect(cx - 3, cy, 6, 1);
  }
}

// 本地小工具（避免额外依赖）
function rect(ctx, x, y, w, h, color) {
  ctx.fillStyle = PALETTE[color] || color;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}
function hline(ctx, x, y, w, color) {
  ctx.fillStyle = PALETTE[color] || color;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), 1);
}
function strokeRect(ctx, x, y, w, h, color) {
  ctx.fillStyle = PALETTE[color] || color;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), 1);
  ctx.fillRect(Math.round(x), Math.round(y + h - 1), Math.round(w), 1);
  ctx.fillRect(Math.round(x), Math.round(y), 1, Math.round(h));
  ctx.fillRect(Math.round(x + w - 1), Math.round(y), 1, Math.round(h));
}
