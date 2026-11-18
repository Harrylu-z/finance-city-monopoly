/**
 * 棋盘渲染器 —— Canvas 2D，现代扁平风。
 *
 * ================== 职责边界（地块 DOM 化后）==================
 * 本模块**只画大块结构与棋子**，不再画地块卡面：
 *   · Canvas：底板 / 护城河 / 中央广场 / 棋子 / 特效
 *   · DOM（`src/render/tiles.js` + `#board-tiles`）：34 个地块的全部卡面
 * 两者共享同一套几何（`cellRect`），因此永远对齐。
 *
 * ================== 版图 ==================
 * **同心双环（疏朗）**：8 列 × 6 网格，34 格沿一条闭合回路推进 ——
 * 外环 24 格（城墙）+ 护城河 + 城门 2 格 + 内环 8 格（城中之城）。
 * 全部文字严格水平，可读性第一。
 */

import {
  BOARD_SIZE, TRACK_POINTS, TRACK_CELLS, ZONES, BOARD_GRID,
} from '../core/board.js';
import { PLAYER_COLORS, PALETTE, GROUP_COLORS, REGULATOR_COLOR } from '../core/palette.js';
import { getAvatarSprites } from '../art/avatars.js';

const GROUP_INDEX = { bank: 0, broker: 1, insurer: 2, asset: 3 };

/** 字体栈 —— 与 CSS 保持一致（真实系统字体，非像素字体） */
const FONT_UI = '"Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif';
const FONT_NUM = '"Consolas", "Menlo", monospace';

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

/** 特殊格 id → 分类 key（转盘的 cat 由 board.js 直接给出） */
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
    this.ctx.imageSmoothingEnabled = true;
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
    this.ctx.imageSmoothingEnabled = true;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.w = cw;
    this.h = ch;
    this.computeLayout();
  }

  /**
   * 计算棋盘几何布局 —— **同心双环 8×6 网格**。
   *
   * 棋盘宽高比 = `BOARD_GRID.cols / BOARD_GRID.rows` = 8/6 = 1.3333，
   * 是**横向**网格 —— 宽度先饱和，高度按比例收窄。
   *
   * 轨道点 `TRACK_POINTS` 的 x/y 分别编码了
   *   `(col + 0.5) / cols` 与 `(row + 0.5) / rows`，
   * 所以显示坐标应直接按**完整网格**反解，而不是把两轴都塞进
   * 同一个正方形轨道包围盒。这样 `cellW !== cellH` 时仍精确对齐。
   */
  computeLayout() {
    // 边距收紧到 6px —— 尽量把每一像素留给格子，提升名称与立绘可读性
    const margin = 6;

    // ===== 底部预留：主行动按钮（掷骰子）浮在棋盘下方居中 =====
    //
    // ⚠ bottomReserve 的语义 = **操作栏在棋盘区里的覆盖高度**
    //   （操作栏实测高度 + 按钮底边到棋盘容器底边的间距 + 8px 安全间隙）。
    //
    // 它**不是**「棋盘高度预算的扣除项」：
    //   棋盘是 8:6 的横向网格，横向永远先饱和 —— 基准视口下
    //   棋盘只占画布高度的 60%~77%，纵向始终有富余。
    //   若把 reserve 从高度预算里扣掉，棋盘就会被无谓地整体上推，
    //   造成「顶部留白 / 底部留白」的不对称。
    //
    // 因此 reserve 只做两件事：
    //   ① 作为**高度上限**（棋盘再高也不能压到操作栏）；
    //   ② 作为**位置钳位**（极端视口下把棋盘往下压时兜底）。
    // 垂直居中则以**整个画布**为基准 → 顶部留白 ≡ 底部留白。
    const bottomReserve = this.bottomReserve || 0;

    // ===== 第一步：可用区域 =====
    const availW = Math.max(80, this.w - margin * 2);
    // 高度上限：画布去掉上下边距，并扣掉操作栏覆盖的高度。
    const availH = Math.max(80, this.h - margin * 2 - bottomReserve);

    // ===== 第二步：格宽 / 格高（严格保持 cellW / cellH = cols / rows）=====
    // 整块棋盘（含贴边格子的完整宽高）必须同时塞进可用区域：
    //   棋盘占宽 = cols × cellW，占高 = rows × cellH
    // 优先由宽度定格子（横向是硬约束）；若由宽度得到的棋盘比可用高度还高，
    // 再由高度反推宽度。
    const cols = BOARD_GRID.cols;
    const rows = BOARD_GRID.rows;
    const aspect = cols / rows;
    let cellW = availW / cols;
    let cellH = cellW / aspect;
    if (cellH * rows > availH) {
      cellH = availH / rows;
      cellW = cellH * aspect;
    }
    // 防止极端小视口下出现 0 尺寸；正常视口不受影响。
    cellW = Math.max(10, cellW);
    cellH = Math.max(10, cellH);

    // 轨道包围盒（格心跨度）：x 从第 0 列中心到第 (cols-1) 列中心，
    // y 从第 0 行中心到第 (rows-1) 行中心。
    const trackW = cellW * (cols - 1);
    const trackH = cellH * (rows - 1);

    // ===== 第三步：居中 =====
    // 必须按**整块棋盘**（含外侧半格 = rows × cellH）居中，
    //   而不是按轨道包围盒（(rows-1) × cellH）居中 ——
    //   后者会把贴边那一排格子整体顶出可用区，造成底部越界。
    const boardW = cols * cellW;
    const boardH = rows * cellH;
    const boardX = (this.w - boardW) / 2;

    // 垂直居中基准 = **整个画布**（不是「扣掉操作栏后的上方区域」）。
    // 这样顶部留白 === 底部留白，棋盘在视觉上真正居中；
    // 操作栏是绝对定位的浮层，居中后仍位于棋盘下方的留白里。
    let boardY = (this.h - boardH) / 2;
    // 兜底钳位：棋盘底边绝不能越过操作栏顶边（含 8px 安全间隙）。
    const maxY = this.h - margin - bottomReserve - boardH;
    if (boardY > maxY) boardY = maxY;
    if (boardY < margin) boardY = margin;

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
      boardX,
      boardY,
      boardW,
      boardH,
    };
  }

  /**
   * 格子索引 → 屏幕矩形。
   *
   * 格子是轴对齐矩形，中心精确落在所属网格的格心。
   * 矩形边界保留小数，避免 DOM 百分比与 Canvas 绘制产生半像素漂移。
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
      x: cx - cellW / 2,
      y: cy - cellH / 2,
      w: cellW,
      h: cellH,
      cx, cy,
    };
  }

  /**
   * 轨道点 → 屏幕中心。
   *
   * `TRACK_POINTS[i]` 已分别编码两个轴的格心：
   *   x = (col + 0.5) / cols，y = (row + 0.5) / rows。
   * 因此必须分别反解到**显示网格的格心**，再换算成像素：
   *
   *     col = p.x / 1000 × cols − 0.5
   *     cx  = boardX + (col + 0.5) × cellW
   *
   * 不能把 x/y 归一化到同一个正方形轨道包围盒 —— 那在
   * `cellW !== cellH` 时会把横向/纵向比例混在一起，导致错位。
   */
  trackCenter(idx) {
    const { cellW, cellH, boardX, boardY } = this.layout;
    const cols = BOARD_GRID.cols;
    const rows = BOARD_GRID.rows;
    const p = TRACK_POINTS[idx] || [0, 0];
    const col = (p[0] / 1000) * cols - 0.5;
    const row = (p[1] / 1000) * rows - 0.5;
    return {
      cx: boardX + (col + 0.5) * cellW,
      cy: boardY + (row + 0.5) * cellH,
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
    ctx.imageSmoothingEnabled = true;
    ctx.clearRect(0, 0, this.w, this.h);
    this.time = view.time || 0;

    // 地块卡面已全部 DOM 化（#board-tiles）——canvas 只负责底板 / 护城河 / 广场 / 棋子 / 特效
    this.drawBoardBase(ctx, state);

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
   * 天际线标志 —— 现代扁平风：平顶楼体 + 金色线条，无阶梯角。
   */
  drawSkylineMark(ctx, cx, cy, s = 1) {
    const baseY = cy + 8 * s;
    const tower = (bx, bw, bh, color) => {
      rect(ctx, bx, baseY - bh * s, bw * s, bh * s, color);
      rect(ctx, bx, baseY - bh * s, bw * s, 1.5 * s, PALETTE.goldLt);
      for (let i = 3; i < bh * s; i += 4 * s) {
        rect(ctx, bx + s, baseY - bh * s + i, bw * s - 2 * s, 1.5 * s, 'rgba(255,255,255,.22)');
      }
    };
    tower(cx - 16 * s, 7 * s, 12 * s, '#5b6478');
    tower(cx - 6 * s, 10 * s, 18 * s, PALETTE.goldDk);
    tower(cx + 6 * s, 6 * s, 10 * s, '#5b6478');
    rect(ctx, cx - 1 * s, baseY - 22 * s, 2 * s, 4 * s, PALETTE.gold);
    rect(ctx, cx - 2 * s, baseY - 23 * s, 4 * s, 1.5 * s, PALETTE.goldLt);
    rect(ctx, cx - 19 * s, baseY, 38 * s, 2 * s, PALETTE.ink);
    hline(ctx, cx - 19 * s, baseY, 38 * s, PALETTE.goldDk);
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
    ctx.fillStyle = PALETTE.ink;
    ctx.font = `bold ${Math.max(12, Math.min(16, ph * 0.26))}px ${FONT_UI}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('中国金融城', logoX + 24 * logoS, py + ph * 0.36);
    ctx.fillStyle = PALETTE.dim;
    ctx.font = `${Math.max(8, Math.min(10, ph * 0.16))}px ${FONT_UI}`;
    ctx.fillText('金融机构争夺战 · 现代版', logoX + 24 * logoS, py + ph * 0.58);

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


  /**
   * 内环「核心」描边 —— 城中之城的专属边框。
   *
   * 内环格子比外环多一圈金色内描边 + 一层暖色底调，
   * 一眼就能看出「这块地在核心区、越贵」。
   */

  /**
   * 顶部产权组色条 —— 主色 + 顶部亮部高光 + 底部暗部阴影。
   *
   * D+ ②：**未持有**时色条为**半透明 + 下缘虚线**
   * （「色还在，地皮还没到手」）；已持有时才是实色渐变。
   */

  /**
   * 水平虚线 —— 像素风虚线（Canvas setLineDash 在像素风下不锐利，手工画）。
   */

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

  /**
   * D+ ⑤「可收购」统一绘制 —— **必须在所有格子画完之后调用**。
   *
   * ⚠ 为什么不能画在 drawCellStateOverlay 里：
   *    绿光是**向外扩**的（画在 r.x - t / r.y - t），
   *    而格子按 index 顺序逐个绘制，后一格的底色 rect 会把
   *    前一格的外扩绿光覆盖掉。抽成独立 pass 后，
   *    绿光永远压在所有格子之上，才真正可见。
   */

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

  /**
   * D+ ⑤：「可收购」角标 —— 左上角绿色小旗标。
   */

  /** 右上角归属小旗 */

  /**
   * 当前玩家所在格 —— 黄色呼吸光圈 + 脉冲。
   *
   * 呼吸：亮度按时间正弦变化；脉冲：外圈半径周期性扩张。
   * prefers-reduced-motion 时由调用方冻结 this.time（静态高亮）。
   */

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

  /**
   * 虚线矩形 —— 像素风虚线描边（Canvas 没有原生虚线矩形，手工画）。
   */

  /**
   * 蓝图态建筑图标 —— 虚线线框 + 淡填充（未持有的建筑立面）。
   *
   * 直接对 16×16 原生精灵逐像素取 alpha：非透明像素画成**半透明集团色**，
   * 外轮廓再补一圈虚线 —— 这样即使精灵本身是彩色像素，
   * 也会被统一压成「规划蓝图」的灰调，而不是彩色小楼。
   */

  /**
   * 「买下即 X 级」徽章 —— 未持有格右上角的小铭牌。
   * 直接暴露 cell.tier（购买时授予的初始等级）。
   */

  /**
   * 所有人徽章 —— D+「右上业主色点 + 等级名」形式。
   *
   * 比旧版那条 2px 色条信息量高得多：一眼看出「谁的地」+「什么等级」。
   */

  /**
   * 质押态标识 —— D+ 红色警示条 + 「已质押」印章。
   */

  /**
   * 等级徽章 —— 顶部色条上的金色方块（墨色描边，等级越高块越多）。
   * 压在深色组色条上依然醒目，一眼读出「网点/支行/分行/总部/地标」档位。
   */

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

  /**
   * D+ ⑦：监管效果读数带 —— 语义色标签 + 大号数值 + 作用对象。
   *
   * 画在格子底部（压在主读数下方），让玩家不用翻规则就知道
   * 这个监管机构给的是好处还是负担。
   */

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

  /**
   * D+ ⑥：陷阱角标 —— 红色「陷阱」小章（右上角）。
   */

  /**
   * 转盘格 —— 大转盘图标 + 候选效果清单。
   *
   * 视觉沿用 D+ 地块方案的「现代数据卡」：
   *   顶部色条 = 转盘主色；
   *   中部     = 真实转盘造型（4 扇区 + 中心轴 + 固定指针）；
   *   下部     = 候选效果名 + 数值读数（陷阱项标红）。
   */

  /**
   * 转盘图标 —— 4 扇区轮盘 + 中心轴 + **固定指针**。
   *
   * ⚠ 指针画在轮盘之外的独立层（不随轮盘旋转），
   *    坐标沿用设计稿已验证的 `16.5,3 23.5,3 20,10`（尖端朝下）。
   */

  /**
   * 赌场格（城门上的娱乐区入口）—— 扑克牌造型 + 「德州扑克」字样。
   */

  /** 斜线纹理（禁用 / 陷阱）—— 铺满整格 */

  /**
   * 斜线纹理 —— 只在指定高度区间内绘制。
   *
   * 陷阱格若整格铺斜线，会横穿标题文字，严重损害可读性。
   * 这里把斜纹限制在「顶部色条」高度内：既能一眼看出是陷阱格，
   * 又不会干扰下方的机构名与说明文字。
   */

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
          const pad = 4;
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

  /**
   * 棋子底座 —— 现代扁平风：软阴影 + 玩家色圆形轮廓。
   *
   * 像素版用逐行 fillRect 拓出一个位图圆，边缘是硬阶梯；
   * 现在改用 Canvas 的路径 + 软阴影，任何分辨率下都平滑。
   */
  drawTokenBase(ctx, cx, cy, s, glow, halfW = 8) {
    // 底座宽度跟随立绘宽度（经典棋子 8，职业立绘 16），但封顶避免过宽
    const rx = Math.max(4, Math.min(halfW * s, 10 * s));
    const ry = Math.max(2.5, 3.2 * s);

    // 阴影（从下方向上的渐变深）
    const shadow = ctx.createRadialGradient(cx, cy, 0, cx, cy, rx);
    shadow.addColorStop(0, 'rgba(15,23,42,.34)');
    shadow.addColorStop(0.65, 'rgba(15,23,42,.18)');
    shadow.addColorStop(1, 'rgba(15,23,42,0)');
    ctx.fillStyle = shadow;
    ctx.beginPath();
    ctx.ellipse(cx, cy + ry * 0.35, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();

    // 底座圆形（深色）
    ctx.fillStyle = 'rgba(15,23,42,.55)';
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx * 0.88, ry * 0.8, 0, 0, Math.PI * 2);
    ctx.fill();

    // 玩家色轮廓（发光）
    ctx.strokeStyle = glow;
    ctx.lineWidth = Math.max(1, 1.2 * s);
    ctx.beginPath();
    ctx.ellipse(cx, cy - ry * 0.1, rx * 0.88, ry * 0.8, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  /** 棋子双层描边 —— 用缓存的柔光精灵绘制 */
  drawTokenOutline(ctx, sprite, x, y, s, glow) {
    const w = sprite.width;
    const h = sprite.height;
    const alpha = this.tokenAlpha(sprite);
    if (!alpha) {
      ctx.drawImage(sprite, Math.round(x), Math.round(y), w * s, h * s);
      return;
    }
    const outlined = this.outlinedSprite(sprite, glow);
    const pad = 4;
    ctx.drawImage(
      outlined,
      Math.round(x) - pad * s,
      Math.round(y) - pad * s,
      (w + pad * 2) * s,
      (h + pad * 2) * s,
    );
  }

  /**
   * 预渲染「带柔和光晕」的棋子精灵 —— 只绘制一次，后续直接复用。
   *
   * 渲染流程：
   *   ① 用玩家色 `shadowBlur` 画一遍立绘（软光晕）
   *   ② 用深色 `shadowBlur` 再画一遍（影子）
   *   ③ 最后渲染本体（不加任何模糊）
   */
  outlinedSprite(sprite, glow) {
    if (!this._outlinedCache) this._outlinedCache = new WeakMap();
    const cached = this._outlinedCache.get(sprite);
    if (cached && cached.glow === glow) return cached.canvas;

    const w = sprite.width;
    const h = sprite.height;
    const pad = 4;
    const cv = document.createElement('canvas');
    cv.width = w + pad * 2;
    cv.height = h + pad * 2;
    const ctx = cv.getContext('2d');
    ctx.imageSmoothingEnabled = true;

    const alpha = this.tokenAlpha(sprite);
    if (!alpha) {
      ctx.drawImage(sprite, pad, pad);
    } else {
      // ① 玩家色柔光晕
      ctx.shadowColor = glow;
      ctx.shadowBlur = 4;
      ctx.drawImage(sprite, pad, pad);
      // ② 深色影子
      ctx.shadowColor = 'rgba(15,23,42,.55)';
      ctx.shadowBlur = 2.5;
      ctx.shadowOffsetY = 1;
      ctx.drawImage(sprite, pad, pad);
      // ③ 本体
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;
      ctx.drawImage(sprite, pad, pad);
    }
    const entry = { canvas: cv, glow, pad };
    this._outlinedCache.set(sprite, entry);
    return cv;
  }

  /**
   * 棋子描边 —— 现代版：用 Canvas 的 `shadowBlur` 做柔和外发光，
   * 取代像素级 2px 墨线。立绘本体不变，只换外圈的表现方式。
   *
   * 注：这里只设置 shadow 参数，实际描边由 `outlinedSprite()`
   * 预渲染到离屏 canvas 上（只绘制一次，后续直接复用）。
   */
  paintOutline(ctx, alpha, w, h, x, y, s, glow) {
    ctx.save();
    ctx.shadowColor = glow;
    ctx.shadowBlur = Math.max(3, 3.2 * s);
    ctx.restore();
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
