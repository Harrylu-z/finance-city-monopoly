/**
 * 棋盘渲染器 —— Canvas 2D，像素硬边。
 *
 * 布局：56 格环形棋盘（7 列 × 8 行的非正方形布局），中央为金融城广场。
 * 每格：机构像素立绘 / 特殊格图标、名称、代码牌、归属标记。
 *
 * 视觉区分：
 *   普通机构格 —— 集团色顶条 + 等级星标 + 归属色带
 *   监管机构格 —— 紫金警示边框 + 「监管」角标 + 天平徽章（不可升级）
 *   特殊格     —— 按类型分配底色 + 图标（与普通格明显不同）
 *   陷阱格     —— 斜向警戒纹 + 红色角标
 */

import { BOARD_CELLS, BOARD_SIZE, BOARD_SHAPE } from '../core/board.js';
import { PLAYER_COLORS, PALETTE } from '../core/palette.js';
import { getInstitutionSprite } from '../art/buildings.js';
import { getAvatarSprites } from '../art/avatars.js';
import { getSpecialIcon, getTickerPlate, getFlagIcon } from '../art/ui-icons.js';

const GROUP_INDEX = { bank: 0, broker: 1, insurer: 2, asset: 3 };

export class BoardRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.ctx.imageSmoothingEnabled = false;
    this.hoverCell = -1;
    this.scale = 2;
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
    // 注意：画布的 CSS 尺寸由样式表控制（width/height: 100%），
    // 这里不再写死 px，避免与容器实际尺寸脱节。
    this.ctx.imageSmoothingEnabled = false;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.w = cw;
    this.h = ch;
    this.computeLayout();
  }

  /**
   * 计算棋盘几何布局。
   *
   * 棋盘容器（#board-wrap）已经是「不遮挡」的区域，因此这里不再为
   * HUD 预留上下留白 —— 直接在可用矩形内把 9×7 棋盘居中。
   * 格子宽高按固定 9:7 比例推导，避免被容器压扁。
   * 顶部额外预留「金融城广场」横幅的高度（不占用格子）。
   */
  computeLayout() {
    const margin = 12;
    const bannerH = 30;   // 横幅 + 边框留白
    const availW = Math.max(1, this.w - margin * 2);
    const availH = Math.max(1, this.h - margin * 2 - bannerH);

    const cols = BOARD_SHAPE.cols;
    const rows = BOARD_SHAPE.rows;

    // 单元格宽高可以不同 —— 适配 9×7 的横向长方形棋盘
    let cellW = Math.floor(availW / cols);
    let cellH = Math.floor(availH / rows);

    // 9:7 是棋盘的天然比例：若容器比例不匹配，按比例收缩，避免格子被拉长
    const naturalCell = cellW / (cols / rows);
    if (cellH > naturalCell) cellH = Math.floor(naturalCell);
    else cellW = Math.floor(cellH * (cols / rows));

    cellW = Math.max(12, cellW);
    cellH = Math.max(12, cellH);

    // 整数倍缩放：保证立绘完整显示且不糊
    const s = Math.max(1, Math.min(3, Math.floor(Math.min(cellW / 2, cellH) / 32) || 1));
    this.scale = s;
    this.cellW = cellW;
    this.cellH = cellH;

    const boardW = cols * cellW;
    const boardH = rows * cellH;
    // 横幅在格子上方，因此整个棋盘（含横幅）整体居中
    const totalH = boardH + bannerH;
    this.boardX = Math.floor((this.w - boardW) / 2);
    this.boardY = Math.floor((this.h - totalH) / 2) + bannerH;

    this.layout = { cols, rows, cellW, cellH, boardX: this.boardX, boardY: this.boardY, bannerH };
  }

  /**
   * 格子索引 → 屏幕矩形。
   *
   * 棋盘是 9 列 × 7 行的**填满矩阵**（63 格全部可玩），移动顺序采用
   * 蛇形（boustrophedon）折返：自底行起，逐行左右交替推进。
   *
   *   index  0.. 8 → 底行，从左到右
   *   index  9..17 → 倒数第 2 行，从右到左
   *   index 18..26 → 第 3 行，从左到右 …… 以此类推
   *   index 54..62 → 顶行，从左到右
   *
   * 这样每一行首尾与相邻行首尾在屏幕上直接相接，棋子沿行推进时
   * 视觉上是连贯的「U 形赛道」；行末即折返，最后一行回到起点，
   * 形成闭合的环形拓扑（index 62 → 0 即「经过起点」）。
   *
   * 注意：9×7 的格点图无法构成真正的哈密顿环（63 为奇数），
   * 因此收尾格与起点格在几何上并非紧邻 —— 这与大富翁类棋盘
   * 「起点单独成格、经过起点触发补贴」的通行做法一致。
   */
  cellRect(index) {
    const { cols, rows, cellW, cellH, boardX, boardY } = this.layout;
    const idx = ((index % BOARD_SIZE) + BOARD_SIZE) % BOARD_SIZE;

    // 每行 cols 格，共 rows 行
    const band = Math.floor(idx / cols);   // 0 = 底行
    const pos = idx % cols;                // 行内序号
    const row = rows - 1 - band;           // 屏幕行号（0 = 顶行）
    // 偶数带（自底向上数）从左向右，奇数带从右向左
    const col = (band % 2 === 0) ? pos : (cols - 1 - pos);

    return { x: boardX + col * cellW, y: boardY + row * cellH, w: cellW, h: cellH, col, row };
  }

  /** 屏幕坐标 → 格子索引（cellRect 的严格逆运算） */
  cellAt(px, py) {
    const { cols, rows, cellW, cellH, boardX, boardY } = this.layout;
    const col = Math.floor((px - boardX) / cellW);
    const row = Math.floor((py - boardY) / cellH);
    if (col < 0 || col >= cols || row < 0 || row >= rows) return -1;
    const band = rows - 1 - row;
    const pos = (band % 2 === 0) ? col : (cols - 1 - col);
    return band * cols + pos;
  }

  draw(state, view) {
    const ctx = this.ctx;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, this.w, this.h);

    this.drawBoardBase(ctx, state);

    for (let i = 0; i < BOARD_SIZE; i++) {
      this.drawCell(ctx, state, i, view);
    }

    this.drawTokens(ctx, state, view);

    if (view.effects) view.effects.draw(ctx);
  }

  /**
   * 棋盘底板 —— 外框 + 「金融城广场」横幅 + 市场周期徽章。
   *
   * 63 个格子会把 9×7 的格点矩阵铺满，因此中央不再留出空洞；
   * 原设计的「中央金融城广场」改为棋盘上方的横幅条，
   * 承载天际线徽章与市场周期指示（牛市 / 熊市 / 震荡）。
   */
  drawBoardBase(ctx, state) {
    const { boardX, boardY, cols, rows, cellW, cellH } = this.layout;
    const w = cols * cellW;
    const h = rows * cellH;

    rect(ctx, boardX - 6, boardY - 6, w + 12, h + 12, 'ink');
    rect(ctx, boardX - 4, boardY - 4, w + 8, h + 8, 'glassDk');
    rect(ctx, boardX, boardY, w, h, 'navyDk');

    // ---- 金融城广场横幅（画在格子上层，不遮挡任何格子）----
    const bannerH = 26;
    const by = boardY - bannerH - 4;
    rect(ctx, boardX, by, w, bannerH, 'navy');
    strokeRect(ctx, boardX, by, w, bannerH, 'goldDk');
    for (let y = by + 3; y < by + bannerH - 2; y += 6) {
      for (let x = boardX + 3; x < boardX + w - 2; x += 6) {
        ctx.fillStyle = ((x + y) % 12 === 0) ? PALETTE.navyLt : PALETTE.navyDk;
        ctx.fillRect(x, y, 4, 4);
      }
    }

    // 天际线徽章（横幅左侧）
    const mx = boardX + 34;
    const my = by + bannerH / 2;
    this.drawSkylineMark(ctx, mx, my);

    // 市场周期指示（横幅右侧）
    const isBull = state.market === 'bull';
    const isBear = state.market === 'bear';
    const label = isBull ? '牛市' : isBear ? '熊市' : '震荡';
    const c = isBull ? 'red' : isBear ? 'jade' : 'glass';
    const bw = 54;
    const bx = Math.round(boardX + w - bw - 8);
    const bh = 15;
    const bly = Math.round(by + (bannerH - bh) / 2);
    rect(ctx, bx, bly, bw, bh, PALETTE.ink);
    strokeRect(ctx, bx, bly, bw, bh, PALETTE[c]);
    ctx.fillStyle = PALETTE[c];
    ctx.fillRect(bx + 2, bly + 2, bw - 4, bh - 4);
    ctx.fillStyle = PALETTE.ink;
    ctx.font = '10px "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, bx + bw / 2, bly + bh / 2);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';

    // 横幅标题
    ctx.font = '10px "Microsoft YaHei", sans-serif';
    ctx.fillStyle = PALETTE.goldLt;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('金融城广场', boardX + w / 2, by + bannerH / 2);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  /** 横幅左侧的天际线徽章 */
  drawSkylineMark(ctx, cx, cy) {
    const baseY = cy + 7;
    const tower = (bx, bw, bh, color) => {
      rect(ctx, bx, baseY - bh, bw, bh, color);
      rect(ctx, bx, baseY - bh, bw, 1, PALETTE.goldLt);
      for (let i = 2; i < bh - 1; i += 3) rect(ctx, bx + 1, baseY - bh + i, bw - 2, 1, PALETTE.ink);
    };
    tower(cx - 16, 7, 12, PALETTE.glassDk);
    tower(cx - 6, 10, 18, PALETTE.goldDk);
    tower(cx + 6, 6, 10, PALETTE.glassDk);
    rect(ctx, cx - 1, baseY - 22, 2, 4, PALETTE.gold);
    rect(ctx, cx - 2, baseY - 23, 4, 1, PALETTE.goldLt);
    rect(ctx, cx - 19, baseY, 38, 2, PALETTE.ink);
    hline(ctx, cx - 19, baseY, 38, PALETTE.goldDk);
  }

  drawCell(ctx, state, index, view) {
    const cell = BOARD_CELLS[index];
    const r = this.cellRect(index);
    const inst = this.getInstitutionState(state, index);

    rect(ctx, r.x, r.y, r.w, r.h, this.cellBaseColor(index, inst));

    ctx.fillStyle = PALETTE.ink;
    ctx.fillRect(r.x, r.y, r.w, 1);
    ctx.fillRect(r.x, r.y + r.h - 1, r.w, 1);
    ctx.fillRect(r.x, r.y, 1, r.h);
    ctx.fillRect(r.x + r.w - 1, r.y, 1, r.h);

    if (this.hoverCell === index) {
      ctx.fillStyle = 'rgba(224,165,63,0.18)';
      ctx.fillRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
    }

    if (cell.type === 'institution') {
      this.drawInstitutionCell(ctx, state, cell, r, inst, view);
    } else {
      this.drawSpecialCell(ctx, state, cell, r, view);
    }
  }

  cellBaseColor(index, inst) {
    const cell = BOARD_CELLS[index];
    if (cell.type === 'special') {
      // 特殊格底色由 drawSpecialCell 覆盖
      return PALETTE.navyDk;
    }
    if (cell.regulator) return PALETTE.purpleDk || PALETTE.navy;
    if (inst && inst.mortgaged) return PALETTE.ink;
    return PALETTE.navy;
  }

  getInstitutionState(state, index) {
    for (const p of state.players) {
      for (const inst of p.institutions) {
        if (inst.cellIndex === index) return { ...inst, player: p };
      }
    }
    return null;
  }

  drawInstitutionCell(ctx, state, cell, r, inst, view) {
    const gi = GROUP_INDEX[cell.group] ?? 0;
    const isReg = !!cell.regulator;
    const level = inst ? inst.level : cell.tier;
    const owner = inst ? inst.player : null;
    const ownerColor = owner ? PLAYER_COLORS[owner.colorIndex % PLAYER_COLORS.length].main : null;

    const groupBar = { bank: PALETTE.red, broker: PALETTE.neon, insurer: PALETTE.jade, asset: PALETTE.gold }[cell.group] || PALETTE.glass;

    if (isReg) {
      // 监管机构格 —— 紫金警示边框 + 专用底色，与普通机构明显不同
      rect(ctx, r.x + 1, r.y + 1, r.w - 2, r.h - 2, PALETTE.purpleDeep);
      // 双层金边
      strokeRect(ctx, r.x + 2, r.y + 2, r.w - 4, r.h - 4, PALETTE.gold);
      strokeRect(ctx, r.x + 4, r.y + 4, r.w - 8, r.h - 8, PALETTE.goldDk);
      rect(ctx, r.x + 1, r.y + 1, r.w - 2, 3, PALETTE.purple);
    } else {
      rect(ctx, r.x + 1, r.y + 1, r.w - 2, 3, groupBar);
    }

    const sprite = getInstitutionSprite(cell, level, ownerColor, gi);
    const s = this.scale;
    const sw = sprite.width * s;
    const sh = sprite.height * s;
    // ===== 分区布局 =====
    // 顶部条：等级 + 名称（高 18px）
    // 左侧：机构立绘（宽 spriteW）
    // 右侧：棋子的行走/站位区（其余宽度）
    // 底部条：归属牌 / 代码（高 16px）
    const topBar = 18;
    const botBar = 16;
    const bodyTop = r.y + topBar;
    const bodyH = r.h - topBar - botBar;
    const bodyW = r.w - 4;

    // 立绘：占据左侧 spriteW 宽度，垂直居中于主体区
    const spriteZoneW = Math.min(bodyW - 34, Math.max(sw + 2, Math.floor(bodyW * 0.34)));
    const sx = Math.round(r.x + 2 + (spriteZoneW - sw) / 2);
    const sy = Math.round(bodyTop + (bodyH - sh) / 2 + (bodyH - sh) * 0.12);

    ctx.fillStyle = PALETTE.ink;
    ctx.fillRect(sx + 2, sy + sh - 1, sw - 4, 1);
    ctx.drawImage(sprite, sx, sy, sw, sh);

    if (cell.landmark) {
      ctx.fillStyle = PALETTE.goldDk;
      ctx.fillRect(sx - 1, sy - 1, sw + 2, 1);
      ctx.fillRect(sx - 1, sy + sh, sw + 2, 1);
      ctx.fillRect(sx - 1, sy, 1, sh);
      ctx.fillRect(sx + sw, sy, 1, sh);
    }

    // ===== 顶部信息栏：等级 + 名称 =====
    const barY = r.y + 5;
    if (isReg) {
      this.drawRegulatorBadge(ctx, r);
    } else {
      this.drawLevelBadge(ctx, r, level);
    }

    ctx.font = '10px "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillStyle = inst && inst.mortgaged ? PALETTE.glassDk : PALETTE.paper;
    const nameX = r.x + (isReg ? 6 : 28);
    ctx.fillText(this.shortName(cell.name), nameX, barY + 9);

    // ===== 底部信息栏：归属牌 / 代码 =====
    if (owner) {
      const plate = getTickerPlate(cell.code, ownerColor, Math.min(30, Math.max(16, r.w - 10)), 7);
      const pw = plate.width;
      ctx.drawImage(plate, Math.round(r.x + (r.w - pw) / 2), r.y + r.h - 9);
      // 归属色带 —— 沿格子右侧竖条，玩家一眼可辨归属
      rect(ctx, r.x + r.w - 4, r.y + 5, 3, r.h - 6, ownerColor);
      // 归属者首字标记
      ctx.font = '9px "Microsoft YaHei", sans-serif';
      ctx.fillStyle = ownerColor;
      ctx.textAlign = 'right';
      ctx.fillText(owner.name.slice(0, 1), r.x + r.w - 6, barY + 9);
      ctx.textAlign = 'left';
    } else {
      ctx.font = '8px monospace';
      ctx.fillStyle = PALETTE.glass;
      ctx.textAlign = 'center';
      ctx.fillText(cell.code, Math.round(r.x + r.w / 2), r.y + r.h - 4);
      ctx.textAlign = 'left';
    }

    if (inst && inst.mortgaged) {
      const flag = getFlagIcon(PALETTE.glass);
      ctx.drawImage(flag, r.x + 2, r.y + r.h - 26, flag.width, flag.height);
      ctx.font = '8px "Microsoft YaHei", sans-serif';
      ctx.fillStyle = PALETTE.glass;
      ctx.fillText('质押', r.x + 11, r.y + r.h - 18);
    }
  }

  /** 等级徽章 —— 左上角实心方块 + Lv 数字，深底保证可读 */
  drawLevelBadge(ctx, r, level) {
    const n = Math.max(0, Math.min(4, level));
    const x0 = r.x + 3;
    const y = r.y + 6;
    rect(ctx, x0 - 1, y - 1, n * 4 + 3, 5, PALETTE.ink);
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = PALETTE.gold;
      ctx.fillRect(x0 + i * 4, y, 3, 3);
      ctx.fillStyle = PALETTE.goldLt;
      ctx.fillRect(x0 + i * 4, y, 3, 1);
    }
    ctx.font = '8px monospace';
    ctx.fillStyle = PALETTE.goldLt;
    ctx.textAlign = 'left';
    ctx.fillText(`L${n}`, x0 + n * 4 + 2, y + 3);
    ctx.textAlign = 'left';
  }

  /** 监管机构角标 —— 「监管」二字 + 不可升级提示 */
  drawRegulatorBadge(ctx, r) {
    const label = '监管';
    ctx.font = '9px "Microsoft YaHei", sans-serif';
    const w = ctx.measureText(label).width + 6;
    const bx = r.x + 3;
    const by = r.y + 5;
    rect(ctx, bx, by, w, 11, PALETTE.purple);
    rect(ctx, bx, by, w, 1, PALETTE.gold);
    ctx.fillStyle = PALETTE.goldLt;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, bx + w / 2, by + 6);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  drawSpecialCell(ctx, state, cell, r, view) {
    const sp = cell.special;
    const specialBg = {
      start: 'goldDk', clearing: 'neonDk', metro: 'redDk',
      crossborder: 'jadeDk', tax: 'glassDk', charity: 'redDeep',
      fine: 'amberDk', event: 'navyLt', market: 'glassDeep',
      audit: 'redDk', risk: 'amberDk', refinance: 'jadeDk',
      rating: 'goldDk', commodity: 'amberDk', roadshow: 'neonDk',
    }[sp.id] || 'navyDk';

    rect(ctx, r.x + 1, r.y + 1, r.w - 2, r.h - 2, specialBg);
    ctx.fillStyle = PALETTE.ink;
    ctx.fillRect(r.x + 1, r.y + 1, r.w - 2, 1);

    // 陷阱格 —— 斜向警戒纹，视觉上与普通特殊格区分开
    if (sp.trap) {
      this.drawHazardStripes(ctx, r);
      // 红色警戒角标
      rect(ctx, r.x + 1, r.y + 1, 5, 5, PALETTE.red);
      rect(ctx, r.x + 1, r.y + 1, 3, 3, PALETTE.redLt || PALETTE.paper);
    } else {
      // 普通特殊格顶部加一条装饰边，标记其为「功能格」
      rect(ctx, r.x + 1, r.y + 1, r.w - 2, 2, PALETTE.goldDk);
    }

    const icon = getSpecialIcon(sp.icon);
    const s = this.scale;
    const iw = icon.width * s;
    const ih = icon.height * s;
    // 与普通机构格一致：图标在左侧，右侧留给棋子
    const topBar = 18;
    const botBar = 16;
    const bodyTop = r.y + topBar;
    const bodyH = r.h - topBar - botBar;
    const spriteZoneW = Math.min(r.w - 4 - 34, Math.max(iw + 2, Math.floor((r.w - 4) * 0.34)));
    const ix = Math.round(r.x + 2 + (spriteZoneW - iw) / 2);
    const iy = Math.round(bodyTop + (bodyH - ih) / 2 + (bodyH - ih) * 0.12);
    ctx.drawImage(icon, ix, iy, iw, ih);

    // 顶部：名称（特殊格用金色小标区分）
    ctx.font = '10px "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillStyle = PALETTE.goldLt;
    ctx.fillText(this.shortName(sp.short, 8), r.x + 5, r.y + 14);

    // 底部：金额 / 说明
    ctx.textAlign = 'center';
    if (sp.amount) {
      ctx.font = '9px monospace';
      ctx.fillStyle = PALETTE.amber;
      ctx.fillText(`-${sp.amount}`, Math.round(r.x + r.w / 2), r.y + r.h - 3);
    } else if (sp.amountRange) {
      const lo = Math.min(...sp.amountRange);
      const hi = Math.max(...sp.amountRange);
      ctx.font = '9px monospace';
      ctx.fillStyle = PALETTE.amber;
      ctx.fillText(`-${lo}~${hi}`, Math.round(r.x + r.w / 2), r.y + r.h - 3);
    } else if (sp.trap) {
      ctx.font = '9px "Microsoft YaHei", sans-serif';
      ctx.fillStyle = PALETTE.redLt || PALETTE.paper;
      ctx.fillText('陷阱 · 监管处罚', Math.round(r.x + r.w / 2), r.y + r.h - 3);
    } else if (sp.id === 'refinance') {
      ctx.font = '9px monospace';
      ctx.fillStyle = PALETTE.jadeLt || PALETTE.paper;
      ctx.fillText('债券发行 · 需≥2人认购', Math.round(r.x + r.w / 2), r.y + r.h - 3);
    } else if (sp.id === 'start') {
      ctx.font = '9px monospace';
      ctx.fillStyle = PALETTE.goldLt;
      ctx.fillText('每圈补贴 ￥200 · 可贷款', Math.round(r.x + r.w / 2), r.y + r.h - 3);
    } else {
      ctx.font = '9px monospace';
      ctx.fillStyle = PALETTE.glass;
      ctx.fillText(sp.code || '', Math.round(r.x + r.w / 2), r.y + r.h - 3);
    }
    ctx.textAlign = 'left';
  }

  /** 陷阱格斜向警戒纹 */
  drawHazardStripes(ctx, r) {
    const step = 7;
    ctx.save();
    ctx.beginPath();
    ctx.rect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
    ctx.clip();
    for (let d = -r.h; d < r.w + r.h; d += step) {
      for (let y = r.y + 1; y < r.y + r.h - 1; y += step) {
        ctx.fillStyle = ((Math.floor((y - r.y) / step) % 2 === 0) ? 'rgba(0,0,0,0.18)' : 'rgba(0,0,0,0.05)');
        ctx.fillRect(r.x + 1 + d, y, step, step);
      }
    }
    ctx.restore();
  }

  shortName(name, max = 7) {
    if (name.length <= max) return name;
    let s = name.replace(/^中国/, '').replace(/股份有限公司$/, '');
    if (s.length <= max) return s;
    return s.slice(0, max - 1) + '…';
  }

  drawTokens(ctx, state, view) {
    const byCell = new Map();
    const movingId = view.moveAnim ? view.moveAnim.playerId : null;
    for (const p of state.players) {
      if (p.bankrupt) continue;
      // 正在移动的玩家由动画单独绘制，不参与静态站位排布
      if (movingId !== null && p.id === movingId) continue;
      if (!byCell.has(p.position)) byCell.set(p.position, []);
      byCell.get(p.position).push(p);
    }

    for (const [cellIndex, players] of byCell) {
      const r = this.cellRect(cellIndex);
      const n = players.length;
      // 多人同格 —— 在格子底部的「站位区」内均匀分布，避免互相遮挡
      const slots = this.tokenSlots(r, n);
      players.forEach((p, i) => {
        const sprites = getAvatarSprites(p.avatar, p.colorIndex);
        const anim = view.moveAnim && view.moveAnim.playerId === p.id ? view.moveAnim : null;

        let tx, ty, sprite;
        if (anim) {
          tx = anim.x;
          ty = anim.y;
          // sprites 是 { down, up, left, right, idle } 的方向字典，
          // 每项为 2 帧行走循环。anim.dir 由 MoveAnimator 依据移动方向给出。
          const dirSprites = sprites[anim.dir] || sprites.down;
          sprite = dirSprites[anim.frame % dirSprites.length] || sprites.down[0];
        } else {
          const slot = slots[i];
          tx = slot.x;
          ty = slot.y;
          sprite = sprites.down[0];
        }

        const s = this.scale;
        const pc = PLAYER_COLORS[p.colorIndex % PLAYER_COLORS.length];

        if (anim && anim.squash) {
          const sq = anim.squash;
          ctx.save();
          ctx.translate(Math.round(tx + 8), Math.round(ty + 24));
          ctx.scale(sq.sx, sq.sy);
          ctx.drawImage(sprite, -8, -24, 16 * s, 24 * s);
          ctx.restore();
        } else {
          ctx.drawImage(sprite, Math.round(tx), Math.round(ty), 16 * s, 24 * s);
        }

        // 玩家色像素描边
        ctx.fillStyle = pc.main;
        ctx.fillRect(Math.round(tx) - 1, Math.round(ty) - 1, 16 * s + 2, 1);
        ctx.fillRect(Math.round(tx) - 1, Math.round(ty) + 24 * s, 16 * s + 2, 1);
        ctx.fillRect(Math.round(tx) - 1, Math.round(ty), 1, 24 * s);
        ctx.fillRect(Math.round(tx) + 16 * s, Math.round(ty), 1, 24 * s);

        // 玩家名牌（仅当前回合玩家显示，避免拥挤）
        if (state.currentPlayerIndex === p.index && !anim) {
          this.drawTurnArrow(ctx, tx + 8 * s, ty - 7);
          this.drawTokenNameTag(ctx, tx + 8 * s, ty - 10, p.name, pc.main);
        }
      });
    }
  }

  /**
   * 计算同一格内 N 个棋子的站位（绝对坐标）。
   * 棋子站在格子底部靠下方的「站台带」上，按人数排成 1~2 排，
   * 既不会压住机构立绘，也不会彼此重叠。
   */
  /**
   * 计算同一格内 N 个棋子的站位。
   *
   * 分区规则：
   *   顶部条 18px（等级 / 名称） + 底部条 16px（归属牌 / 代码）
   *   中间主体区左侧留给机构立绘，右侧是棋子的行走与站位区
   * 多人同格时在站位区内排成 1~3 列 × N 排，形成前后层次，不互相遮挡。
   */
  tokenSlots(r, n) {
    const s = this.scale;
    const w = 16 * s;
    const h = 24 * s;
    const topBar = 18;
    const botBar = 16;
    const bodyTop = r.y + topBar;
    const bodyH = r.h - topBar - botBar;

    // 左侧立绘区宽度（与 drawInstitutionCell 保持一致）
    const spriteZoneW = Math.min(r.w - 4 - 34, Math.max(w + 2, Math.floor((r.w - 4) * 0.34)));
    // 站位区起点
    const zoneX = r.x + 2 + spriteZoneW;
    const zoneW = Math.max(w, r.w - 4 - spriteZoneW);
    const zoneRight = zoneX + zoneW;

    // 站位区内可容纳的列数
    const perRow = Math.max(1, Math.min(3, Math.floor((zoneW - 2) / (w + 1))));
    const rows = Math.ceil(n / perRow);

    const slots = [];
    for (let i = 0; i < n; i++) {
      const row = Math.floor(i / perRow);
      const col = i % perRow;
      const inRow = Math.min(perRow, n - row * perRow);
      // 每排水平居中（相对站位区）
      const rowW = inRow * (w + 1) - 1;
      const startX = zoneX + Math.floor((zoneW - rowW) / 2);
      // 多排时后排抬高，形成前后层次
      const rowLift = (rows - 1 - row) * Math.floor(h * 0.22);
      const baseY = bodyTop + bodyH - h - 1;
      const y = Math.max(bodyTop + 1, baseY - rowLift);
      const x = startX + col * (w + 1);
      slots.push({ x, y, dx: x - r.x, dy: y - r.y });
    }
    return slots;
  }

  /**
   * 供 MoveAnimator 使用的站位查询 —— 返回格内偏移。
   *
   * 若该格内有其他玩家，则依次排布；当前移动的玩家占据其应有槽位。
   * 这样走完最后一格时，人物正好站在与静止态一致的槽位上，不会跳位。
   */
  slotOffsetFor(state, cellIndex) {
    const r = this.cellRect(cellIndex);
    const others = state.players.filter((p) => !p.bankrupt && p.position === cellIndex);
    const n = Math.max(1, others.length);
    const slots = this.tokenSlots(r, n);
    // 优先返回第一个槽位（大多数情况下只有一人）
    const slot = slots[0];
    return { dx: slot.dx, dy: slot.dy };
  }

  /** 玩家名小标签 */
  drawTokenNameTag(ctx, cx, cy, name, color) {
    const text = (name || '').slice(0, 4);
    ctx.font = '9px "Microsoft YaHei", sans-serif';
    const tw = ctx.measureText(text).width;
    const bw = tw + 6;
    const bx = Math.round(cx - bw / 2);
    const by = Math.round(cy - 10);
    rect(ctx, bx, by, bw, 11, PALETTE.ink);
    rect(ctx, bx, by, bw, 1, color);
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, Math.round(cx), by + 6);
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
