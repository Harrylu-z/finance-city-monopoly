/**
 * 棋盘渲染器 —— Canvas 2D，像素硬边。
 *
 * ================== 版图 ==================
 * 经典**正方形环道**（不旋转）：63 格沿正方形四边逆时针排布，
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
  BOARD_CELLS, BOARD_SIZE, BOARD_SHAPE, TRACK_POINTS, PLAZA_CENTER, SIDE_COUNTS,
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

/** 特殊格底色（浅色系，特殊格用不同纹理区分） */
const SPECIAL_TINT = {
  start:        { bg: '#f0d79a', edge: PALETTE.goldDk },
  clearing:     { bg: '#cfe6ee', edge: '#1c6b88' },
  metro:        { bg: '#f2c6bd', edge: PALETTE.redDk },
  crossborder:  { bg: '#cfe8d0', edge: '#336b38' },
  tax:          { bg: '#e4d3c4', edge: '#6b5a48' },
  charity:      { bg: '#f2d6d2', edge: PALETTE.redDk },
  fine:         { bg: '#ecd4b6', edge: PALETTE.goldDk },
  event:        { bg: '#dcd8ea', edge: '#5c3a86' },
  market:       { bg: '#dcd8ea', edge: '#4a5266' },
  audit:        { bg: '#e8c4bc', edge: PALETTE.redDk },
  risk:         { bg: '#e8c4bc', edge: PALETTE.redDk },
  refinance:    { bg: '#cfe6d8', edge: '#336b38' },
  rating:       { bg: '#f0d79a', edge: PALETTE.goldDk },
  commodity:    { bg: '#e8dcc0', edge: '#8a6d2c' },
  roadshow:     { bg: '#cfe6ee', edge: '#1c6b88' },
};

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
   * 计算棋盘几何布局 —— 严格正方形。
   *
   * 正方形环道：上/右/左三边各 17 格、底边 16 格（合计 63）。
   * 因为环道包围盒本身就是正方形，只需让 trackW === trackH 即可。
   *
   * ⚠ 关键：格子是以轨道点**为中心**绘制的，所以轨道包围盒必须
   *   比棋盘可用区域**内缩半格**，否则贴边的格子会有一半露到画布外
   *   （左侧格子 x 为负、被裁掉）。这里先按 17 格估算格宽，再回填内缩量。
   */
  computeLayout() {
    // 边距收紧到 6px —— 尽量把每一像素留给格子，提升名称与立绘可读性
    const margin = 6;

    // ===== 底部预留：主行动按钮（掷骰子）浮在棋盘下方居中 =====
    // 棋盘必须整体上移，避免底边一排格子被按钮压住。
    const bottomReserve = this.bottomReserve || 0;

    // ===== 第一步：按可用区域估算格边长 =====
    const avail = Math.max(80, Math.min(
      this.w - margin * 2,
      this.h - margin * 2 - bottomReserve,
    ));

    // ===== 第二步：求解格边长 =====
    // 轨道点归一化到 0..1000。17 格一边的**中心**首尾相距 1000 单位，
    // 即相邻中心间距 = 1000/16 = 62.5 单位。
    // 映射到像素：cell = trackW × 62.5/1000 = trackW / 16
    //   → trackW = 16 × cell
    // 但格子是以中心绘制的，首尾两格各向外探出半格，
    // 所以棋盘实际占宽 = trackW + cell = 17 × cell，必须 ≤ 可用区域。
    //   → cell = avail / 17
    const cell = Math.max(14, Math.floor(avail / 17));
    const trackW = cell * 16;
    const trackH = cell * 16;

    // ===== 第三步：居中（水平居中；垂直方向在「上方可用区」内居中）=====
    // 垂直可用区 = [margin, this.h - margin - bottomReserve]
    const usableH = this.h - margin * 2 - bottomReserve;
    const trackX = Math.floor((this.w - trackW) / 2);
    const trackY = Math.floor(margin + (usableH - trackH) / 2);

    const cellW = cell;
    const cellH = cell;

    // 整数倍缩放 —— 保证立绘边缘绝对锐利（nearest-neighbor）。
    // 紧凑图标原生 16×16，按「格子可用高度 / 16」取最大整数倍。
    const iconZone = Math.round(cell * 0.46);
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
    const { cellW, cellH, trackX, trackY, trackW, trackH } = this.layout;
    const idx = ((index % BOARD_SIZE) + BOARD_SIZE) % BOARD_SIZE;
    const p = TRACK_POINTS[idx];
    if (!p) {
      return { x: trackX, y: trackY, w: cellW, h: cellH };
    }
    const cx = trackX + (p[0] / 1000) * trackW;
    const cy = trackY + (p[1] / 1000) * trackH;
    return {
      x: Math.round(cx - cellW / 2),
      y: Math.round(cy - cellH / 2),
      w: cellW, h: cellH,
      cx, cy,
    };
  }

  /** 屏幕坐标 → 格子索引（取中心距离最近的一格） */
  cellAt(px, py) {
    const { trackX, trackY, trackW, trackH } = this.layout;
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < TRACK_POINTS.length; i++) {
      const p = TRACK_POINTS[i];
      const cx = trackX + (p[0] / 1000) * trackW;
      const cy = trackY + (p[1] / 1000) * trackH;
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

    this.drawTokens(ctx, state, view);

    if (view.effects) view.effects.draw(ctx);
  }

  /**
   * 棋盘底板 —— 实体正方形棋盘（2px 深描边 + 内侧高光）。
   */
  drawBoardBase(ctx, state) {
    const { trackX, trackY, trackW, trackH, cellW, cellH } = this.layout;

    // 外框比轨道包围盒外扩半格，把贴边的格子完整包进来
    const pad = Math.ceil(Math.max(cellW, cellH) / 2) + 1;
    const bx = trackX - pad;
    const by = trackY - pad;
    const boardW = trackW + pad * 2;
    const boardH = trackH + pad * 2;

    // ===== 实体板质感：外描边 → 暗边 → 内高光 =====
    // 最外层：深墨描边（2px）
    rect(ctx, bx - 4, by - 4, boardW + 8, boardH + 8, PALETTE.ink);
    // 次层：板框（中灰）
    rect(ctx, bx - 2, by - 2, boardW + 4, boardH + 4, '#39415a');
    // 板面（比格子底色稍暗，作为环道底）
    rect(ctx, bx, by, boardW, boardH, PALETTE.boardDk);
    // 内侧微弱高光（1px 顶部 + 左侧）
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillRect(bx + 1, by + 1, boardW - 2, 1);
    ctx.fillRect(bx + 1, by + 1, 1, boardH - 2);

    // ---- 中心广场（环道围出的中心区域）----
    this.drawCenterPlaza(ctx, state);
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
    const { trackX, trackY, trackW, trackH } = this.layout;

    // 广场尺寸 = 环道包围盒的 64%（去掉两侧各 18% 的环带）
    const pw = Math.round(trackW * 0.64);
    const ph = Math.round(trackH * 0.64);
    if (pw < 80 || ph < 80) return;
    const px = Math.round(trackX + (trackW - pw) / 2);
    const py = Math.round(trackY + (trackH - ph) / 2);

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

    const cx = Math.round(px + pw / 2);

    // ===== ① LOGO 区 =====
    const logoY = py + 16;
    this.drawSkylineMark(ctx, cx, logoY + 14, 2);

    ctx.fillStyle = PALETTE.gold;
    ctx.font = `bold 16px ${FONT_UI}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('中国金融城', cx, logoY + 42);
    ctx.fillStyle = PALETTE.paper;
    ctx.font = `10px ${FONT_UI}`;
    ctx.fillText('像素大富翁 · 金融机构争夺战', cx, logoY + 60);

    // ===== ② 当前回合信息 =====
    const infoY = py + ph * 0.52;
    const cur = state.players && state.players[state.currentPlayerIndex];
    ctx.fillStyle = PALETTE.dim;
    ctx.font = `10px ${FONT_UI}`;
    ctx.fillText('当 前 回 合', cx, infoY);

    if (cur) {
      const pc = PLAYER_COLORS[cur.colorIndex % PLAYER_COLORS.length];
      // 玩家色底牌
      const name = cur.name.length > 8 ? cur.name.slice(0, 8) : cur.name;
      ctx.font = `bold 16px ${FONT_UI}`;
      const tw = ctx.measureText(name).width;
      const bw = tw + 26;
      rect(ctx, cx - bw / 2, infoY + 10, bw, 24, PALETTE.ink);
      strokeRect(ctx, cx - bw / 2, infoY + 10, bw, 24, pc.main);
      rect(ctx, cx - bw / 2, infoY + 10, 5, 24, pc.main);
      ctx.fillStyle = pc.lt;
      ctx.fillText(name, cx + 5, infoY + 22);
    }

    // 市场周期徽章
    const isBull = state.market === 'bull';
    const isBear = state.market === 'bear';
    const label = isBull ? '牛市' : isBear ? '熊市' : '震荡';
    const mc = isBull ? PALETTE.red : isBear ? PALETTE.green : PALETTE.dim;
    ctx.font = `10px ${FONT_UI}`;
    const mw = ctx.measureText(label).width + 16;
    const mx = Math.round(cx - mw / 2);
    const my = Math.round(infoY + 40);
    rect(ctx, mx, my, mw, 16, PALETTE.ink);
    strokeRect(ctx, mx, my, mw, 16, mc);
    ctx.fillStyle = mc;
    ctx.fillText(label, cx, my + 8);

    // ===== ③ 骰子动画舞台 =====
    const stageH = Math.max(28, Math.round(ph * 0.16));
    const stageY = py + ph - stageH - 10;
    rect(ctx, px + 12, stageY, pw - 24, stageH, PALETTE.ink);
    strokeRect(ctx, px + 12, stageY, pw - 24, stageH, '#39415a');
    ctx.fillStyle = PALETTE.dim;
    ctx.font = `9px ${FONT_UI}`;
    ctx.fillText('骰 子 舞 台', cx, stageY + stageH / 2);

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
    const isCorner = BOARD_SHAPE.cornerIndices.includes(index);

    // ===== ① 格子底色：浅米色 + 图地分离 =====
    const bg = this.cellBaseColor(index, inst, isCorner);
    rect(ctx, r.x, r.y, r.w, r.h, bg);

    // ===== ② 顶部产权组色条（三层色阶）=====
    this.drawGroupBar(ctx, cell, r, inst);

    // ===== ③ 边框：普通 1px 墨线 =====
    strokeRect(ctx, r.x, r.y, r.w, r.h, PALETTE.ink);

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
   * 顶部产权组色条 —— 主色 + 顶部亮部高光 + 底部暗部阴影。
   */
  drawGroupBar(ctx, cell, r, inst) {
    const barH = Math.max(4, Math.round(r.h * 0.12));
    let base = PALETTE.dim;
    let lt = PALETTE.dim;
    let dk = PALETTE.dim;
    if (cell.type === 'institution') {
      if (cell.regulator) {
        base = REGULATOR_COLOR.base;
        lt = REGULATOR_COLOR.lt;
        dk = REGULATOR_COLOR.dk;
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
    rect(ctx, r.x + 1, r.y + 1, r.w - 2, barH, base);
    rect(ctx, r.x + 1, r.y + 1, r.w - 2, 1, lt);      // 顶部高光
    rect(ctx, r.x + 1, r.y + barH, r.w - 2, 1, dk);  // 底部阴影
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
   *   · 可购买（未持有、当前玩家够钱）→ 轻微绿色渐变提示
   *   · 已购买 → 归属玩家色边框 + 小旗帜
   *   · 抵押 / 禁用 → 降饱和 + 斜线纹理
   */
  drawCellStateOverlay(ctx, state, index, r, inst) {
    const cell = BOARD_CELLS[index];

    // ---- 抵押 / 禁用：斜线纹理 ----
    if (inst && inst.mortgaged) {
      this.drawHazardStripes(ctx, r, 'rgba(21,26,38,0.22)');
    }

    // ---- 可购买：轻微绿色渐变提示 ----
    if (cell.type === 'institution' && !inst && !cell.regulator) {
      const cur = state.players && state.players[state.currentPlayerIndex];
      const isTurn = cur && !cur.isAI && !cur.bankrupt;
      if (isTurn) {
        const g = ctx.createLinearGradient(0, r.y, 0, r.y + r.h);
        g.addColorStop(0, 'rgba(79,157,85,0.22)');
        g.addColorStop(1, 'rgba(79,157,85,0.04)');
        ctx.fillStyle = g;
        ctx.fillRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
      }
    }

    // ---- 已购买：归属玩家色边框 + 右上角小旗帜 ----
    if (inst && inst.player) {
      const pc = PLAYER_COLORS[inst.player.colorIndex % PLAYER_COLORS.length];
      // 内描边（2px 玩家色）
      ctx.fillStyle = pc.main;
      ctx.fillRect(r.x + 1, r.y + 1, r.w - 2, 2);
      ctx.fillRect(r.x + 1, r.y + r.h - 3, r.w - 2, 2);
      ctx.fillRect(r.x + 1, r.y + 1, 2, r.h - 2);
      ctx.fillRect(r.x + r.w - 3, r.y + 1, 2, r.h - 2);
      // 右上角小旗帜
      this.drawOwnerFlag(ctx, r, pc.main, pc.lt);
    }
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
   * 机构格 —— 三要素布局：顶部色条 / 名称 / 价格。
   *
   * 格子内部结构（自上而下）：
   *   ① 顶部产权组色条（主 + 亮 + 暗三层）
   *   ② 机构名称 —— **独占整行宽度**，字号 ≥ 格子高度 1/4，绝不截断
   *   ③ 价格（左）+ 16×16 建筑图标（右下角徽记）
   *
   * ⚠ 可读性铁律：名称必须拿到格子的**全部**宽度。
   *   旧版「左图标 + 右文字」并排会把 56px 的格子切成 34px 文字区，
   *   导致「中国工商银行」被截成「中国…」（63 格中 62 格截断）。
   *   现改为纵向布局：名称独占 52px，4 个汉字完整显示；
   *   图标挪到右下角与价格同行，避开了名称。
   */
  drawInstitutionCell(ctx, state, cell, r, inst, view, isCorner) {
    const gi = GROUP_INDEX[cell.group] ?? 0;
    const isReg = !!cell.regulator;
    const level = inst ? inst.level : cell.tier;
    const owner = inst ? inst.player : null;
    const ownerColor = owner ? PLAYER_COLORS[owner.colorIndex % PLAYER_COLORS.length].main : null;

    const barH = Math.max(5, Math.round(r.h * 0.13));
    const bodyTop = r.y + barH + 1;
    const bodyH = r.h - barH - 2;

    // ===== 紧凑图标（16×16 原生，整数倍放大），作右下角徽记 =====
    const icon = getCompactIcon({
      kind: cell.kind, level, group: cell.group,
      seed: gi * 31 + (cell.index || 0), regulatorId: cell.regulatorId,
    });
    // 图标贴着格子右下角，超出部分允许压到格子边缘（视觉上像徽章）
    const iconScale = Math.max(1, Math.min(3, Math.floor((r.h * 0.42) / 16) || 1));
    const iw = icon.width * iconScale;
    const ih = icon.height * iconScale;

    // ===== 名称：独占整行宽度，必要时拆两行，绝不截断 =====
    const textX = r.x + 3;
    const textW = r.w - 6;
    const { lines: nameLines, size: nameSize } = this.splitNameLines(
      cell.name, textW, Math.max(12, Math.round(r.h * 0.22)), Math.min(20, Math.round(r.h * 0.32)),
    );
    const lineH = Math.ceil(nameSize * 1.12);
    const priceSize = Math.max(11, Math.min(15, Math.round(r.h * 0.2)));
    const priceH = Math.ceil(priceSize * 1.2);

    // 名称占据「色条之下、价格之上」的空间，两行则垂直居中
    const textAreaH = Math.max(lineH * nameLines.length, bodyH - priceH);
    const nameBlockH = lineH * nameLines.length;
    const nameTop = bodyTop + (textAreaH - nameBlockH) / 2;

    // ===== 名称 =====
    ctx.font = `bold ${nameSize}px ${FONT_UI}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = inst && inst.mortgaged ? PALETTE.dim : PALETTE.ink;
    nameLines.forEach((ln, li) => {
      const y = nameTop + lineH * li + lineH / 2;
      ctx.fillText(ln, textX, Math.round(y));
    });

    // ===== 价格（底部左侧，给右下角图标留出位置）=====
    const priceText = isReg
      ? `￥${cell.price}`
      : `￥${(cell.price[Math.min(4, level)] ?? cell.price[0])}`;
    const priceY = r.y + r.h - priceH / 2 - 2;
    const priceW = textW - iw;
    ctx.font = `bold ${priceSize}px ${FONT_NUM}`;
    ctx.fillStyle = inst && inst.mortgaged ? PALETTE.dim : PALETTE.redDk;
    ctx.fillText(this.fitText(ctx, priceText, priceW), textX, Math.round(priceY));

    // ===== 建筑图标（右下角徽记）=====
    if (iw > 0) {
      const ix = Math.round(r.x + r.w - iw - 1);
      const iy = Math.round(r.y + r.h - ih - 1);
      // 图标底部 1px 墨色投影，把建筑「压」在浅底格子上
      ctx.fillStyle = 'rgba(21,26,38,0.22)';
      ctx.fillRect(ix + 2, iy + ih, Math.max(1, iw - 4), 1);
      ctx.drawImage(icon, ix, iy, iw, ih);
    }

    // ===== 监管角标（右上角）=====
    if (isReg) {
      this.drawRegulatorBadge(ctx, r);
    }

    // ===== 等级星标（左上角，压在色条上）=====
    if (!isReg) {
      this.drawLevelBadge(ctx, r, level);
    }

    // ===== 归属标记 =====
    if (owner) {
      const pc = PLAYER_COLORS[owner.colorIndex % PLAYER_COLORS.length];
      rect(ctx, r.x + 2, r.y + r.h - 4, 10, 2, pc.main);
    } else if (inst && inst.mortgaged) {
      ctx.font = `${Math.max(8, Math.round(r.h * 0.13))}px ${FONT_UI}`;
      ctx.fillStyle = PALETTE.dim;
      ctx.textAlign = 'center';
      ctx.fillText('已质押', Math.round(r.x + r.w / 2), Math.round(r.y + r.h - 8));
    }

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

  /** 监管机构角标 —— 紫底金字 */
  drawRegulatorBadge(ctx, r) {
    const label = '监管';
    const fs = Math.max(8, Math.min(11, Math.round(r.h * 0.13)));
    ctx.font = `${fs}px ${FONT_UI}`;
    const w = ctx.measureText(label).width + 6;
    const h = fs + 3;
    const bx = r.x + r.w - w - 2;
    const by = r.y + 2;
    rect(ctx, bx, by, w, h, REGULATOR_COLOR.base);
    ctx.fillStyle = PALETTE.goldLt;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, bx + w / 2, by + h / 2);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  /**
   * 特殊格 —— 大图标 + 标题 + 功能说明。
   * 角格（起点等）用更大的图标与专属底色纹理，与普通特殊格明显区分。
   */
  drawSpecialCell(ctx, state, cell, r, view, isCorner) {
    const sp = cell.special;
    const barH = Math.max(5, Math.round(r.h * 0.13));
    const bodyTop = r.y + barH + 1;
    const bodyH = r.h - barH - 2;

    // ---- 陷阱格：斜向警戒纹（只铺在顶部色条带内，不横穿文字）----
    if (sp.trap) {
      this.drawHazardStripesIn(ctx, r, 'rgba(200,57,43,0.30)', r.y + 1, barH);
      rect(ctx, r.x + 2, r.y + 2, 6, 6, PALETTE.red);
      rect(ctx, r.x + 3, r.y + 3, 4, 4, PALETTE.redLt);
    }

    // ---- 大图标（右上角徽记，整数倍放大）----
    const descH = Math.max(10, Math.round(r.h * 0.19));
    const iconScale = Math.max(1, Math.min(4, Math.floor((r.h * 0.46) / 16)));
    const icon = getSpecialIcon(sp.icon);
    let iw = icon.width * iconScale;
    let ih = icon.height * iconScale;
    const maxH = bodyH - 4;
    const maxW = r.w - 8;
    if (ih > maxH || iw > maxW) {
      const k = Math.max(1, Math.floor(Math.min(maxH / icon.height, maxW / icon.width)));
      iw = icon.width * k;
      ih = icon.height * k;
    }

    // ---- 标题：独占整行宽度，必要时拆两行 ----
    const titleText = sp.short || sp.name;
    const textX = r.x + 3;
    const textW = r.w - 6;
    const { lines: titleLines, size: titleSize } = this.splitNameLines(
      titleText, textW, Math.max(12, Math.round(r.h * 0.22)), Math.min(20, Math.round(r.h * 0.32)),
    );
    const titleLineH = Math.ceil(titleSize * 1.12);
    const descSize = Math.max(10, Math.min(13, Math.round(r.h * 0.17)));

    // 标题块占据「色条之下、说明之上」
    const titleBlockH = titleLineH * titleLines.length;
    const titleAreaH = Math.max(titleBlockH, bodyH - descH);
    const titleTop = bodyTop + (titleAreaH - titleBlockH) / 2;

    ctx.font = `bold ${titleSize}px ${FONT_UI}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = PALETTE.ink;
    titleLines.forEach((ln, li) => {
      const y = titleTop + titleLineH * li + titleLineH / 2;
      ctx.fillText(ln, textX, Math.round(y));
    });

    // 图标放右上角，压在色条上（背景浅，不与文字冲突）
    if (iw > 0) {
      const ix = Math.round(r.x + r.w - iw - 2);
      const iy = Math.round(r.y + 1);
      ctx.drawImage(icon, ix, iy, iw, ih);
    }

    // ---- 说明文字（底部一行）----
    let desc = '';
    if (sp.id === 'tax') desc = '按规模计税';
    else if (sp.id === 'risk') desc = '集中度整改';
    else if (sp.id === 'rating') desc = '评级 3 回合';
    else if (sp.id === 'commodity') desc = '行情结算';
    else if (sp.id === 'roadshow') desc = '路演 3 回合';
    else if (sp.amount) desc = `-￥${sp.amount}`;
    else if (sp.amountRange) {
      const lo = Math.min(...sp.amountRange);
      const hi = Math.max(...sp.amountRange);
      desc = `-￥${lo}~${hi}`;
    } else if (sp.trap) desc = '陷阱 · 处罚';
    else if (sp.id === 'refinance') desc = '债券发行';
    else if (sp.id === 'start') desc = '每圈+￥200';
    else desc = sp.code || '';

    ctx.font = `${descSize}px ${FONT_UI}`;
    ctx.fillStyle = sp.trap ? PALETTE.redDk : PALETTE.dim;
    ctx.fillText(this.fitText(ctx, desc, textW), textX, Math.round(r.y + r.h - descH / 2 - 2));

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
      const slots = this.tokenSlots(r, n);
      const ts = this.tokenScale(r);
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

        // 底座对齐到棋子脚下（16×24 原生，脚底 = y + 24*s）
        const baseCx = tx + 8 * s;
        const baseCy = ty + 23 * s;
        this.drawTokenBase(ctx, baseCx, baseCy, s, pc.main);

        if (anim && anim.squash) {
          const sq = anim.squash;
          const outlined = this.outlinedSprite(sprite, pc.main);
          const pad = 2;
          ctx.save();
          ctx.translate(Math.round(tx + 8 * s), Math.round(ty + 24 * s));
          ctx.scale(sq.sx, sq.sy);
          ctx.drawImage(
            outlined,
            -(8 + pad) * s,
            -(24 + pad) * s,
            (16 + pad * 2) * s,
            (24 + pad * 2) * s
          );
          ctx.restore();
        } else {
          this.drawTokenOutline(ctx, sprite, tx, ty, s, pc.main);
        }

        // 名牌 —— 站在格子上的**所有玩家**都挂名牌；当前回合玩家额外有箭头 + 金色高亮
        if (!anim) {
          const isCur = state.currentPlayerIndex === p.index;
          if (isCur) this.drawTurnArrow(ctx, tx + 8 * s, ty - 7);
          this.drawTokenNameTag(ctx, tx + 8 * s, ty - 10, p.name, pc.main, isCur);
        }
      });
    }
  }

  /** 棋子底座（深色站台 + 玩家色高光边） */
  drawTokenBase(ctx, cx, cy, s, glow) {
    const rx = Math.round(7 * s);
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
   * 棋子缩放倍数 —— 按格子实际尺寸自适应，始终**整数倍**（nearest-neighbor）。
   *
   * 棋子原生 16×24。格子 60px 时 1 倍只有 24px 高（占 40%），
   * 太小看不清；2 倍则 48px 高会盖住名称。这里取「能塞进站立带的最大整数倍」。
   */
  tokenScale(r) {
    const bandH = Math.max(16, Math.round(r.h * 0.34));   // 底部站立带高度
    return Math.max(1, Math.min(3, Math.floor(bandH / 24)));
  }

  /**
   * 同一格内 N 个棋子的站位。
   *
   * 棋子统一站在格子**底部的站台带**上，横向排布：
   *   · 永远完整落在格子内（不越界、不被画布裁掉）；
   *   · 多人同格时按列排开，超出宽度则错位成多排并抬高后排；
   *   · 不遮挡上方的机构名称与价格（可读性优先）。
   */
  tokenSlots(r, n) {
    const s = this.tokenScale(r);
    const w = 16 * s;
    const h = 24 * s;
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
    const slots = this.tokenSlots(r, n);
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
