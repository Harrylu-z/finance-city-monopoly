/**
 * hover 立体建筑浮现层 —— PR-D
 *
 * ================== 目标 ==================
 * 鼠标悬停某格时，在该格上方浮起一座**立体建筑**：
 *   · 建筑高度 / 形制 匹配该格的**等级**（网点 → 地标）；
 *   · 建筑配色 匹配该格的**集团色**（未持有）或**持有人色**（已持有）；
 *   · 建筑徽记 / 产权条 与格子信息严格一致。
 *
 * ================== 为什么复用现有资源 ==================
 * `src/art/buildings.js` 已经把「等级 → 体量」「集团 → 配色」「机构 → 指纹」
 * 全部参数化好了（`getInstitutionSprite`），`tiles.js` 的 `flatFacade`
 * 则是同一套语汇的矢量版。重新画一套只会引入不一致 —— 这里直接复用。
 *
 * ================== 渲染方式 ==================
 * **精灵图（canvas）而非 SVG**：
 *   `getInstitutionSprite` 返回 canvas，天然带像素级立绘细节（窗格、
 *   腰线、附属构件、顶冠徽章），比重新拼 SVG 更贴近「建筑」而非「图标」。
 *
 * ================== 与 billboard 的关系 ==================
 * 建筑是**纯图形**，不含需要阅读的文字 —— 因此**不做反向补偿**，
 * 让它随棋盘一起倾斜 45°，从而获得真正的透视感。
 * （若也补偿，它会变成一张「贴纸」，立体的意义就没了。）
 *
 * ⚠ 代价：建筑在 45° 俯视下会被压扁。这是**正确**的物理表现 ——
 *   一栋楼被俯视，本来就该看到它的「顶 + 正面」而非完整立面。
 */

import { BOARD_CELLS } from '../core/board.js';
import { GROUP_COLORS, PLAYER_COLORS } from '../core/palette.js';
import { getInstitutionSprite } from '../art/buildings.js';

/** 集团 → 组序号（buildings.js 用它决定建筑形制变体 / 顶冠） */
const GROUP_ORDER = ['bank', 'broker', 'insurer', 'asset'];

/** 监管机构专用色（紫晶） */
const REGULATOR_COLOR = { base: '#8b5cc7', lt: '#b189e0', dk: '#5c3a86' };

/**
 * hover 建筑图层
 *
 * 挂在 `#board-tiles` 容器内，但**与地块 DOM 平级**——
 * 这样建筑不会继承 `.mt-cell` 的 `overflow` / `z-index` 上下文，
 * 可以自由地抬到棋盘之上。
 */
export class HoverBuildingLayer {
  /**
   * @param {HTMLElement} root   #board-tiles 容器
   * @param {HTMLElement} layer  承载建筑的容器（会绝对定位铺满）
   * @param {object} renderer    BoardRenderer（提供 cellRect）
   */
  constructor(root, layer, renderer) {
    this.root = root;
    this.layer = layer;
    this.renderer = renderer || null;
    this.enabled = false;
    this._current = -1;
    this._nodes = new Map();   // cellIndex → { wrap, img, shadow }
    this._state = null;
  }

  /** 3D 模式开关 —— 只有 3D 下才显示悬浮建筑 */
  set3D(on) {
    this.enabled = !!on;
    if (!on) this.hide();
    else if (this._state) this.refresh();
  }

  /**
   * 重新定位所有建筑 —— 棋盘尺寸变化后调用。
   *
   * 建筑位置用**像素**写死（不是百分比），所以 canvas 缩放 /
   * 窗口 resize 后必须重新计算，否则建筑会与牌面错位。
   */
  relayout() {
    for (const [index, node] of this._nodes) {
      this._position(node.wrap, index);
    }
    if (this._current >= 0) this.refresh();
  }

  /**
   * 同步当前游戏状态 —— 建筑的高度 / 配色依赖「等级」与「持有人」。
   *
   * @param {object} state
   */
  sync(state) {
    this._state = state;
    if (this.enabled) this.refresh();
  }

  /** 重建当前 hover 的建筑（状态变化后调用） */
  refresh() {
    if (this._current < 0) return;
    const cell = BOARD_CELLS[this._current];
    if (!cell) return;
    const info = this._infoFor(this._current);
    if (!info) return;
    const node = this._nodes.get(this._current);
    if (!node) return;
    this._paint(node, cell, info);
  }

  /* ===========================================================
   * 悬停 / 离开
   * =========================================================== */

  /** 悬停到某格 */
  enter(index) {
    if (!this.enabled) return;
    if (this._current === index) return;
    this._current = index;
    const cell = BOARD_CELLS[index];
    if (!cell) return;

    // 只有「机构格」和「监管格」有建筑 —— 特殊格（转盘/赌场等）不显示
    if (cell.type !== 'institution') {
      this._current = index;
      this.hide(true);
      return;
    }

    const info = this._infoFor(index);
    if (!info) return;

    // ⚠ 必须先隐藏**上一个**建筑 —— 否则移动到相邻格时，
    //   两座建筑会同时可见（旧的不消失）。
    this.hide(true);

    let node = this._nodes.get(index);
    if (!node) {
      node = this._createNode(index);
      this._nodes.set(index, node);
    }
    this._paint(node, cell, info);

    // 重新触发入场动画
    node.wrap.classList.remove('is-in');
    void node.wrap.offsetWidth;
    node.wrap.classList.add('is-in');
  }

  /** 离开当前格 */
  leave(index) {
    // ⚠ index === -1 表示「指针离开了整个棋盘」——
    //   此时必须无条件隐藏，不能因为 _current 是真实索引而不匹配。
    if (index >= 0 && this._current !== index) return;
    this.hide();
  }

  /**
   * 隐藏建筑。
   * @param {boolean} keepCurrent 保留「当前格」标记（用于特殊格：先记下再隐藏）
   */
  hide(keepCurrent = false) {
    for (const node of this._nodes.values()) {
      node.wrap.classList.remove('is-in');
    }
    if (!keepCurrent) this._current = -1;
  }

  /* ===========================================================
   * 内部实现
   * =========================================================== */

  /** 创建某格的建筑 DOM（懒创建，用完保留以便复用） */
  _createNode(index) {
    const cell = BOARD_CELLS[index];

    const wrap = document.createElement('div');
    wrap.className = 'mt-hb';
    wrap.dataset.index = String(index);
    wrap.setAttribute('aria-hidden', 'true');

    // 地面光晕 —— 最底层，柔和辉光，暗示「这里有能量」
    const glow = document.createElement('div');
    glow.className = 'mt-hb-glow';

    // 地面投影
    const shadow = document.createElement('div');
    shadow.className = 'mt-hb-shadow';

    // 底座广场 —— 建筑站立的透视地台
    const plaza = document.createElement('div');
    plaza.className = 'mt-hb-plaza';

    // 楼体容器 —— 承载立绘 + 窗灯 + 招牌
    const tower = document.createElement('div');
    tower.className = 'mt-hb-tower';

    const img = document.createElement('img');
    img.className = 'mt-hb-img';
    img.alt = '';
    img.draggable = false;

    // 窗格灯光层（叠在立绘之上，screen 混合只提亮）
    const windows = document.createElement('div');
    windows.className = 'mt-hb-windows';

    // 顶部招牌 —— 等级星标 + 归属点
    const sign = document.createElement('div');
    sign.className = 'mt-hb-sign';
    const signLv = document.createElement('span');
    signLv.className = 'mt-hb-sign-lv';
    const signOwner = document.createElement('i');
    signOwner.className = 'mt-hb-sign-owner';
    sign.appendChild(signLv);
    sign.appendChild(signOwner);

    tower.appendChild(img);
    tower.appendChild(windows);
    tower.appendChild(sign);

    wrap.appendChild(glow);
    wrap.appendChild(shadow);
    wrap.appendChild(plaza);
    wrap.appendChild(tower);
    this.layer.appendChild(wrap);

    this._position(wrap, index);

    return { wrap, img, shadow, plaza, tower, windows, sign, signLv, signOwner };
  }

  /**
   * 把建筑摆到所属格的中心。
   *
   * ⚠ 建筑是**底对齐**的 —— 底部落在格子的下沿（略高于格心），
   *   这样它看起来是「立在这张牌上」，而不是浮在牌的正中间。
   * ⚠ 尺寸用**像素**而非百分比 —— 建筑的 Z 抬升与缩放需要
   *   一个确定的高度基准，百分比在 transform 下会被二次缩放。
   */
  _position(wrap, index) {
    const r = this.renderer;
    if (!r || !r.cellRect) return;
    const rect = r.cellRect(index);

    // 建筑容器：横跨格子，底部略微下沉 —— 让建筑「探出」牌面
    //
    // ⚠ 体量比例经过实拍校准：
    //   原来的 2.4×1.9 在 45° 俯视下显得**又扁又小**，
    //   楼只探出牌面一点点，远看像「牌上贴了个小图标」。
    //   现在放大到 2.9×2.5 —— 建筑明显高过牌面，
    //   在俯视下才读得出「一栋楼」而不是「一块贴纸」。
    const boxW = rect.w * 2.9;          // 建筑比牌面宽（楼比牌大）
    const boxH = rect.h * 2.5;          // 建筑比牌面高
    const cx = rect.x + rect.w / 2;     // 格心 X
    const bottom = rect.y + rect.h * 0.86; // 底沿（略低于格心）

    wrap.style.setProperty('--hb-left', `${(cx - boxW / 2).toFixed(1)}px`);
    wrap.style.setProperty('--hb-top', `${(bottom - boxH).toFixed(1)}px`);
    wrap.style.setProperty('--hb-w', `${boxW.toFixed(1)}px`);
    wrap.style.setProperty('--hb-h', `${boxH.toFixed(1)}px`);
    // 投影：贴着格子底部，宽略大于牌面 —— 与建筑体量匹配
    wrap.style.setProperty('--hb-shadow-w', `${(rect.w * 1.05).toFixed(1)}px`);
    wrap.style.setProperty('--hb-shadow-h', `${(rect.h * 0.30).toFixed(1)}px`);
    // 地面光晕：比投影略大 —— 辉光应当「溢」出投影边缘
    wrap.style.setProperty('--hb-glow-w', `${(rect.w * 1.55).toFixed(1)}px`);
    wrap.style.setProperty('--hb-glow-h', `${(rect.h * 0.42).toFixed(1)}px`);
    // 窗灯区域：覆盖楼体中段（随体量微调）
    wrap.style.setProperty('--hb-win-w', `${(rect.w * 0.62).toFixed(1)}px`);
    wrap.style.setProperty('--hb-win-h', `${(rect.h * 0.80).toFixed(1)}px`);
  }

  /**
   * 填充建筑 —— 依据等级 / 集团 / 持有人渲染对应的立绘。
   */
  _paint(node, cell, info) {
    let sprite = null;
    try {
      sprite = getInstitutionSprite(
        cell,
        info.level,
        info.ownerColor,
        info.groupIndex,
      );
    } catch {
      sprite = null;
    }

    if (!sprite) {
      node.wrap.style.display = 'none';
      return;
    }
    node.wrap.style.display = '';

    const url = this._toDataURL(sprite);
    if (node.img.dataset.url !== url) {
      node.img.src = url;
      node.img.dataset.url = url;
    }

    // 建筑高度随等级递增 —— 用 CSS 变量驱动缩放，
    // 避免为每个等级各画一份图（资源复用 + 视觉平滑）。
    node.wrap.style.setProperty('--hb-scale', String(info.scale));
    node.wrap.style.setProperty('--hb-lv', String(info.level));
    node.wrap.style.setProperty('--hb-acc', info.accent);
    node.wrap.style.setProperty('--hb-acc-lt', info.accentLt);
    node.wrap.dataset.group = cell.group || '';
    node.wrap.dataset.level = String(info.level);
    node.wrap.dataset.held = info.ownerColor ? '1' : '0';
    node.wrap.dataset.reg = cell.regulator ? '1' : '0';

    // 立绘高度：填满容器高度 —— 让建筑「站满」牌面之上。
    // ⚠ 用 height 而非 width —— 建筑的视觉体量由高度决定，
    //   宽度会自动按立绘原始比例缩放（不同等级宽高比不同）。
    node.img.style.height = '100%';
    node.img.style.width = 'auto';

    // ---------- 顶部招牌 ----------
    // 等级星标 + 归属点 —— 让「这是几级 + 属于谁」一眼可读
    if (node.signLv) {
      node.signLv.textContent = '★'.repeat(Math.max(1, info.level + 1));
    }
    if (node.signOwner) {
      if (info.ownerColor) {
        node.signOwner.style.display = '';
        node.signOwner.style.setProperty('--hb-owner', info.ownerColor);
      } else {
        // 未持有 → 隐藏归属点，只留等级星标
        node.signOwner.style.display = 'none';
      }
    }

    // ---------- 窗灯强度 ----------
    // ⚠ 等级越高窗灯越亮（高层写字楼夜里更亮），且监管机构用金色而非组色。
    const winOp = info.ownerColor
      ? 0.88
      : (cell.regulator ? 0.92 : 0.62);
    node.wrap.style.setProperty('--hb-win-op', String(winOp));
  }

  /**
   * 把建筑精灵转成 data URL（**高分辨率放大**后）。
   *
   * ⚠ 为什么需要放大：
   *   `buildings.js` 的立绘是按「小尺寸像素画」设计的 ——
   *   网点只有 14×20 px。hover 时建筑要撑到 ~100×150 CSS px，
   *   直接用原图会被浏览器拉伸 **7 倍以上**，边缘发虚。
   *
   * ⚠ 为什么不改 buildings.js：
   *   那套立绘里全是硬编码的像素级测量（fillRect(x, y, 1, 1)），
   *   改尺寸等于重写整套绘制逻辑。放大是**无损且零侵入**的做法。
   *
   * ⚠ 为什么开 imageSmoothing：
   *   这套立绘是**现代扁平风**（纯色块 + 圆角 + 抗锯齿），
   *   不是像素画 —— 关掉平滑反而会出现锯齿。
   */
  _toDataURL(sprite) {
    const K = 4;   // 4 倍放大 → 网点 56×80，足够清晰
    const cv = document.createElement('canvas');
    cv.width = sprite.width * K;
    cv.height = sprite.height * K;
    const ctx = cv.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(sprite, 0, 0, cv.width, cv.height);
    return cv.toDataURL('image/png');
  }

  /**
   * 取某格当前的建筑信息：等级、持有人色、强调色、缩放。
   */
  _infoFor(index) {
    const cell = BOARD_CELLS[index];
    if (!cell || cell.type !== 'institution') return null;

    const state = this._state;
    let level = cell.tier || 0;
    let owner = null;

    if (state && state.players) {
      for (const p of state.players) {
        for (const inst of p.institutions) {
          if (inst.cellIndex === index) {
            level = inst.level;
            owner = p;
            break;
          }
        }
        if (owner) break;
      }
    }

    // 监管机构：等级固定为 0，用监管色
    const isReg = !!cell.regulator;
    const groupIndex = Math.max(0, GROUP_ORDER.indexOf(cell.group));

    // 持有人色（已持有）优先于集团色
    const g = GROUP_COLORS[cell.group] || GROUP_COLORS.bank;
    const pc = owner ? PLAYER_COLORS[(owner.colorIndex || 0) % PLAYER_COLORS.length] : null;
    const accent = isReg
      ? REGULATOR_COLOR.base
      : (pc ? pc.main : g.base);
    const accentLt = isReg
      ? REGULATOR_COLOR.lt
      : (pc ? pc.lt : g.lt);

    // getInstitutionSprite 的 ownerColor 参数要的是**颜色值**（不是索引）
    const ownerMain = pc ? pc.main : null;

    // 缩放：等级越高建筑越大
    // ⚠ 梯度要**明显递增**（而不是线性 1.0→1.9）——
    //   玩家靠「远看一眼就能分辨等级」来决策，
    //   线性梯度在 40px 高的建筑上几乎看不出差别。
    //   现在用「前两级平缓（网点/支行）、后三级陡增（分行/总部/地标）」的曲线：
    //     网点 1.00 → 支行 1.14 → 分行 1.34 → 总部 1.58 → 地标 2.00
    const scale = [1.0, 1.14, 1.34, 1.58, 2.0][Math.max(0, Math.min(4, level))];

    return {
      level: isReg ? 0 : Math.max(0, Math.min(4, level)),
      ownerColor: ownerMain,
      accent,
      accentLt,
      groupIndex,
      scale,
    };
  }
}
