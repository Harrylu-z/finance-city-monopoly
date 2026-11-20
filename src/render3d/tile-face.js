/**
 * 地块卡面**数据层** —— 3D 管线与 DOM 管线共用的唯一真源。
 *
 * ================== 为什么把「数据」从「绘制」里抽出来 ==================
 * 现状：
 *   · DOM 管线（`src/render/tiles.js`）—— HTML 字符串，直接内联所有读数；
 *   · Canvas 管线（`src/render/canvas.js`）—— 另一份内联读数。
 * 两份读数各自硬编码，已经出现漂移风险。
 *
 * 现在把「读数怎么算」抽到本模块（`tileFace` / `tileState`），
 * 三条渲染管线（DOM / Canvas / 3D 纹理）都从这里取数：
 *   · **规则层仍然零改动** —— 本模块只读 `core/board.js` 的数据，不改一个字节；
 *   · DOM 管线改为调用本模块（行为等价，输出不变）；
 *   · 3D 管线把本模块的结果画进 CanvasTexture。
 *
 * ================== 语义优先级（D+ 方案的灵魂）==================
 *   · **未持有**：主读数 = 买入价；次读数 = 买后每回合管理费；
 *   · **已持有**：主读数 = 管理费；次读数 = 买入 / 升级价。
 * 两个数字永不丢失，只是主次互换。
 */

/* ===========================================================
 * 基础工具
 * =========================================================== */
import { LEVELS, GROUP_META } from '../core/board.js';
import { GROUP_COLORS, PLAYER_COLORS } from '../core/palette.js';

/** 千分位 */
export function num(n) {
  return (n == null ? '—' : Number(n).toLocaleString('en-US'));
}

/** ￥ 前缀 */
export function yuan(n) {
  return (n == null ? '—' : '￥' + num(n));
}

/** 颜色明暗调整 —— amt > 0 变亮，amt < 0 变暗 */
export function shade(hex, amt) {
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

/* ===========================================================
 * 特殊格分类 —— 5 类（色相即语义）
 * =========================================================== */
export const SPECIAL_CATS = {
  hub:    { label: '枢纽', color: '#2f9fc4', lt: '#63c6e6', dk: '#1c6b88', sign: '流转' },
  random: { label: '随机', color: '#8b5cc7', lt: '#b189e0', dk: '#5c3a86', sign: '抽取' },
  cost:   { label: '成本', color: '#c8392b', lt: '#e4604d', dk: '#8d2419', sign: '付出' },
  gain:   { label: '增益', color: '#4f9d55', lt: '#7ac77f', dk: '#336b38', sign: '收益' },
  cycle:  { label: '周期', color: '#e8a93c', lt: '#ffc861', dk: '#9a6a1c', sign: '全局' },
};

export const SPECIAL_CAT_OF = {
  start: 'hub', clearing: 'hub', crossborder: 'hub', metro: 'hub',
  event: 'random', casino: 'random',
  tax: 'cost', audit: 'cost', risk: 'cost',
  charity: 'gain', roadshow: 'gain', rating: 'gain', commodity: 'gain', refinance: 'gain',
  market: 'cycle',
};

/** 特殊格关键数值读数 —— 与 DOM 管线完全一致 */
export const SPECIAL_EFFECT = {
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

/* ===========================================================
 * 四大监管机构 —— 各自独立的视觉身份
 * =========================================================== */
export const REGULATORS = {
  pbc: {
    short: '央行', name: '中国人民银行',
    color: '#c0392b', lt: '#e4604d', dk: '#8d2419',
    role: '货币政策', effectName: '流动性投放',
    big: '+￥80', unit: '每圈', badge: 'coin', sign: 'benefit',
  },
  csrc: {
    short: '证监会', name: '中国证监会',
    color: '#2f9fc4', lt: '#63c6e6', dk: '#1c6b88',
    role: '发行审核', effectName: '注册制便利',
    big: '-12%', unit: '升级费', badge: 'shield', sign: 'relief',
  },
  nfra: {
    short: '银保监', name: '金融监管总局',
    color: '#4f9d55', lt: '#7ac77f', dk: '#336b38',
    role: '审慎监管', effectName: '审慎约束',
    big: '-8%', unit: '租金', badge: 'scale', sign: 'restraint',
  },
  fsc: {
    short: '金稳会', name: '金融稳定委员会',
    color: '#8b5cc7', lt: '#b189e0', dk: '#5c3a86',
    role: '风险处置', effectName: '风险缓冲',
    big: '-50%', unit: '罚金', badge: 'castle', sign: 'shield',
  },
};

export const REG_SIGN = {
  benefit:   { label: '增益', color: '#4f9d55' },
  relief:    { label: '减负', color: '#2f9fc4' },
  restraint: { label: '约束', color: '#e8a93c' },
  shield:    { label: '减害', color: '#8b5cc7' },
};

/* ===========================================================
 * 取数
 * =========================================================== */

/** 特殊格分类 */
export function specialCat(cell) {
  const id = cell.special ? cell.special.id : '';
  return SPECIAL_CATS[SPECIAL_CAT_OF[id] || 'random'];
}

/** 集团配色（未持有时楼体是集团色，已持有才换成玩家色） */
export function groupOf(cell) {
  if (cell.regulator) {
    const r = REGULATORS[cell.regulatorId];
    return r
      ? { base: r.color, lt: r.lt, dk: r.dk, name: '监管' }
      : { base: '#5b6478', lt: '#8790a5', dk: '#3b4254', name: '功能' };
  }
  if (cell.group && GROUP_COLORS[cell.group]) {
    const g = GROUP_COLORS[cell.group];
    return { base: g.base, lt: g.lt, dk: g.dk, name: g.name };
  }
  return { base: '#5b6478', lt: '#8790a5', dk: '#3b4254', name: '功能' };
}

/**
 * 持有人显示 —— **玩家真名**（玩家设定的昵称 / player.name）。
 *
 * 6 字封顶 —— 地块卡面最窄处只能放 6~7 个中文字。
 * 超长则裁到 5 字 + 「…」，完整真名由调用方放进 title。
 */
export function ownerLabel(player) {
  const raw = String((player && player.name) || '').trim();
  if (!raw) return '—';
  return raw.length > 6 ? raw.slice(0, 5) + '…' : raw;
}

/**
 * 状态层 —— 从游戏状态里抽出某一格的全部展示状态。
 *
 * @param {object} state 游戏状态
 * @param {number} index 格子索引
 * @returns {object} { level, owner, ownerName, mortgaged, affordable, inst, isTurn }
 */
export function tileState(state, index) {
  const cur = state.players && state.players[state.currentPlayerIndex];
  const isTurn = !!(cur && !cur.isAI && !cur.bankrupt);
  const cell = (state.board || [])[index] || null;

  let inst = null;
  for (const p of state.players || []) {
    for (const it of p.institutions || []) {
      if (it.cellIndex === index) { inst = { ...it, player: p }; break; }
    }
    if (inst) break;
  }

  return {
    inst,
    owner: inst ? inst.player.colorIndex : null,
    ownerName: inst ? ownerLabel(inst.player) : '',
    ownerFullName: inst ? String(inst.player.name || '') : '',
    // ⚠ 未持有时取 `cell.tier`（买下即得的初始等级），
    //   已持有时取实际等级 —— 与 DOM 管线旧行为完全一致。
    level: inst ? inst.level : ((cell && cell.tier) || 0),
    mortgaged: !!(inst && inst.mortgaged),
    affordable: isAffordable(state, index, isTurn),
    isTurn,
  };
}

/** 该格当前玩家是否买得起（仅人类玩家回合 + 机构格） */
export function isAffordable(state, index, isTurn) {
  if (!isTurn) return false;
  const cell = (state.board || [])[index];
  if (!cell || cell.type !== 'institution') return false;
  // ⚠ 「已被**任何人**持有」都不能买 ——
  //   这里必须遍历全部玩家，而不是只看当前玩家。
  //   （旧 DOM 管线的 `_findInst` 也是遍历全部玩家的。）
  for (const p of state.players || []) {
    for (const it of p.institutions || []) {
      if (it.cellIndex === index) return false;
    }
  }
  const price = cell.regulator
    ? (Array.isArray(cell.price) ? cell.price[0] : cell.price)
    : (Array.isArray(cell.price) ? (cell.price[cell.tier || 0] ?? cell.price[0]) : cell.price);
  return state.players[state.currentPlayerIndex].cash >= price;
}

/**
 * 地块卡面 —— **归一化的展示模型**（三条渲染管线共用）。
 *
 * @param {object} cell  core/board.js 的格子定义
 * @param {object} st    tileState() 的结果
 * @returns {object} 卡面模型
 */
export function tileFace(cell, st) {
  const held = st.owner != null;
  const owner = held ? PLAYER_COLORS[st.owner] : null;
  const g = groupOf(cell);

  if (cell.regulator) {
    const info = REGULATORS[cell.regulatorId];
    const sign = info ? REG_SIGN[info.sign] : { label: '—', color: '#5b6478' };
    return {
      kind: 'regulator',
      cell,
      held,
      owner,
      ownerName: st.ownerName,
      ownerFullName: st.ownerFullName,
      mortgaged: st.mortgaged,
      affordable: st.affordable,
      title: cell.name,
      groupLabel: '监管',
      role: info ? info.role : '监管',
      tierLabel: '监管',
      badge: info ? info.badge : 'castle',
      effectSign: sign.label,
      effectColor: sign.color,
      effectBig: info ? info.big : '—',
      effectUnit: info ? info.unit : '',
      effectName: info ? info.effectName : '',
      mainValue: yuan(Array.isArray(cell.price) ? cell.price[0] : cell.price),
      mainLabel: '买入价',
      subValue: '',
      subLabel: '',
      footLabel: '不可升级',
      footValue: yuan(Array.isArray(cell.price) ? cell.price[0] : cell.price),
      accent: info ? info.color : g.base,
      accentLt: info ? info.lt : g.lt,
      accentDk: info ? info.dk : g.dk,
      segments: [],
    };
  }

  if (cell.type !== 'institution') {
    // ===== 特殊格 =====
    const sp = cell.special || {};
    const cat = specialCat(cell);
    const eff = SPECIAL_EFFECT[sp.id] || { big: '—', lbl: '' };
    const isWheel = sp.kind === 'wheel';
    const isGate = sp.kind === 'gate' || sp.id === 'casino';

    if (isWheel) {
      const outs = sp.outcomeData || [];
      return {
        kind: 'wheel',
        cell,
        held: false,
        owner: null,
        ownerName: '',
        ownerFullName: '',
        mortgaged: false,
        affordable: false,
        title: sp.short || cell.name,
        groupLabel: cat.label,
        role: cat.sign,
        tierLabel: cat.sign,
        badge: 'wheel',
        effectSign: cat.sign,
        effectColor: cat.color,
        effectBig: outs.length ? String(outs.length) : '—',
        effectUnit: '项效果',
        effectName: sp.desc || '',
        mainValue: outs.length ? String(outs.length) : '—',
        mainLabel: '候选效果',
        subValue: outs.length ? outs[0].name : '',
        subLabel: outs.length ? outs[0].big : '',
        footLabel: '随机抽取',
        footValue: '',
        accent: cat.color,
        accentLt: cat.lt,
        accentDk: cat.dk,
        segments: [],
        outcomes: outs.slice(0, 3).map((o) => ({ name: o.name, big: o.big, trap: !!o.trap })),
        outcomeMore: outs.length > 3 ? outs.length - 3 : 0,
        trap: !!sp.trap,
      };
    }

    if (isGate) {
      return {
        kind: 'casino',
        cell,
        held: false,
        owner: null,
        ownerName: '',
        ownerFullName: '',
        mortgaged: false,
        affordable: false,
        title: '私人赌场',
        groupLabel: '娱乐',
        role: '开局',
        tierLabel: '开局',
        badge: 'poker',
        effectSign: '开局',
        effectColor: '#8b5cc7',
        effectBig: '德扑',
        effectUnit: '全员参与',
        effectName: sp.desc || '',
        mainValue: '德扑',
        mainLabel: '开局',
        subValue: '全员参与',
        subLabel: '',
        footLabel: '城门',
        footValue: '',
        accent: '#8b5cc7',
        accentLt: '#b189e0',
        accentDk: '#5c3a86',
        segments: [],
      };
    }

    return {
      kind: 'special',
      cell,
      held: false,
      owner: null,
      ownerName: '',
      ownerFullName: '',
      mortgaged: false,
      affordable: false,
      title: sp.short || cell.name,
      groupLabel: cat.label,
      role: cat.sign,
      tierLabel: cat.sign,
      badge: sp.icon || 'trap',
      effectSign: cat.sign,
      effectColor: cat.color,
      effectBig: eff.big,
      effectUnit: eff.lbl,
      effectName: sp.desc || '',
      mainValue: eff.big,
      mainLabel: eff.lbl,
      subValue: '',
      subLabel: '',
      footLabel: sp.trap ? '陷阱' : '功能格',
      footValue: '',
      accent: cat.color,
      accentLt: cat.lt,
      // ⚠ 用色板里的既定暗部（SPECIAL_CATS.dk），**不派生新色** ——
      //   派生色会跑出 16 色受控色板，破坏「配色不变」的约束。
      accentDk: cat.dk,
      segments: [],
      trap: !!sp.trap,
    };
  }

  // ===== 机构格 =====
  const lv = st.level != null ? st.level : (cell.tier || 0);
  const lvIdx = Math.max(0, Math.min(4, lv));
  const rent = Array.isArray(cell.rent) ? (cell.rent[lvIdx] ?? cell.rent[0] ?? 0) : (cell.rent || 0);
  const price = Array.isArray(cell.price) ? (cell.price[lvIdx] ?? cell.price[0]) : (cell.price || 0);
  const lvLabel = LEVELS[lvIdx] ? LEVELS[lvIdx].label : '';

  const body = held ? owner.main : g.base;
  const accent = held ? owner.lt : g.lt;
  const acc = held ? owner.main : g.base;

  const mainValue = held ? yuan(rent) : yuan(price);
  const mainLabel = held ? '管理费' : '买入价';
  const subValue = held ? yuan(price) : yuan(rent);
  const subLabel = held ? '买入 / 升级价' : '买后每回合';

  // 等级刻度五段：实心 = 已有 / 买下即得；虚线 = 待升级；空白 = 锁定
  const segments = LEVELS.map((L, i) => {
    const on = i <= lvIdx;
    const solid = on && (held || i < lvIdx);
    const pending = on && !held && i === lvIdx;
    return { solid, pending, color: acc, index: i };
  });

  return {
    kind: 'institution',
    cell,
    held,
    owner,
    ownerName: st.ownerName,
    ownerFullName: st.ownerFullName,
    mortgaged: st.mortgaged,
    affordable: st.affordable,
    title: cell.name,
    groupLabel: g.name,
    role: GROUP_META[cell.group] ? GROUP_META[cell.group].short : g.name,
    tierLabel: lvLabel,
    badge: held ? 'owner' : 'blueprint',
    effectSign: '',
    effectColor: '',
    effectBig: '',
    effectUnit: '',
    effectName: '',
    mainValue,
    mainLabel,
    subValue,
    subLabel,
    footLabel: lvLabel,
    footValue: held ? '买入 ' + yuan(price) : '未持有',
    accent: acc,
    accentLt: accent,
    accentDk: held ? owner.dk : g.dk,
    body,
    groupBase: g.base,
    segments,
    level: lvIdx,
    levelCount: LEVELS.length,
    landmark: !!cell.landmark,
  };
}
