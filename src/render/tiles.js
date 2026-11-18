/**
 * 地块 DOM 渲染器 —— **D+ 现代数据卡**（浅色卡片 / 扁平矢量 / 真实字体）。
 *
 * ================== 为什么地块改 DOM ==================
 * 像素风的地块靠 `fillRect` 画格子，格子一旦小于 ~90px 就塞不下
 * 「名称 + 等级刻度 + 主读数 + 次读数 + 徽章」—— 只能靠截断和省略号硬凑，
 * 这正是「地块上什么都看不清」的根源。
 *
 * DOM + CSS 的好处：
 *   · 文字由排版引擎处理 —— 字号、行高、留白都可以精细控制；
 *   · 圆角 / 渐变 / 阴影 / 虚线全部免费，且**任意缩放不糊**；
 *   · 状态（未持有 / 已持有 / 质押 / 可收购）用 class 切换即可。
 *
 * ================== 与 canvas.js 的职责切分 ==================
 *   · **DOM（本模块）**：34 个地块的全部内容 —— 卡面、名称、读数、徽章、状态；
 *   · **Canvas（canvas.js）**：底板、护城河、中央广场、棋子、特效。
 *   两者共享同一套几何（`cellRect` 换算成百分比），因此永远对齐。
 *
 * ================== 定位方式 ==================
 * 地块用**百分比**定位（left/top/width/height 全部相对 `#board-tiles`），
 * 而 `#board-tiles` 与 `#board-canvas` 同尺寸同位置 ——
 * 因此 canvas 尺寸变化时**不需要任何 JS 重排**，CSS 自动跟随。
 */

import { BOARD_CELLS, BOARD_SIZE, LEVELS, TRACK_POINTS, BOARD_GRID } from '../core/board.js';
import { PLAYER_COLORS, GROUP_COLORS } from '../core/palette.js';

/* ===========================================================
 * 特殊格分类 —— 16 个特殊格归为 5 类（色相即语义）
 * =========================================================== */
const SPECIAL_CATS = {
  hub:    { label: '枢纽', color: '#2f9fc4', lt: '#63c6e6', sign: '流转' },
  random: { label: '随机', color: '#8b5cc7', lt: '#b189e0', sign: '抽取' },
  cost:   { label: '成本', color: '#c8392b', lt: '#e4604d', sign: '付出' },
  gain:   { label: '增益', color: '#4f9d55', lt: '#7ac77f', sign: '收益' },
  cycle:  { label: '周期', color: '#e8a93c', lt: '#ffc861', sign: '全局' },
};

const SPECIAL_CAT_OF = {
  start: 'hub', clearing: 'hub', crossborder: 'hub', metro: 'hub',
  event: 'random', casino: 'random',
  tax: 'cost', audit: 'cost', risk: 'cost',
  charity: 'gain', roadshow: 'gain', rating: 'gain', commodity: 'gain', refinance: 'gain',
  market: 'cycle',
};

/** 特殊格关键数值读数（与 design-proposals/tiles-modern/modern-tiles.js 一致） */
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

/* ===========================================================
 * 四大监管机构 —— 各自独立的视觉身份
 * =========================================================== */
const REGULATORS = {
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

const REG_SIGN = {
  benefit:   { label: '增益', color: '#4f9d55' },
  relief:    { label: '减负', color: '#2f9fc4' },
  restraint: { label: '约束', color: '#e8a93c' },
  shield:    { label: '减害', color: '#8b5cc7' },
};

/* ===========================================================
 * 工具
 * =========================================================== */
const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const num = (n) => (n == null ? '—' : Number(n).toLocaleString('en-US'));
const yuan = (n) => (n == null ? '—' : '￥' + num(n));

/** 颜色明暗调整 —— amt > 0 变亮，amt < 0 变暗 */
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

/**
 * 名称排版 —— **绝不出现省略号**。
 *   ≤6 字 → 单行；7~10 字 → 均衡切两行；>10 字 → 整段（允许自然换行）。
 */
function nameHTML(name, cls) {
  const n = String(name || '');
  if (n.length <= 6) return `<div class="${cls}">${esc(n)}</div>`;
  if (n.length <= 10) {
    const cut = Math.ceil(n.length / 2);
    return `<div class="${cls}"><span>${esc(n.slice(0, cut))}</span><span>${esc(n.slice(cut))}</span></div>`;
  }
  return `<div class="${cls}">${esc(n)}</div>`;
}

/**
 * 持有人显示 —— **玩家真名**（玩家设定的昵称 / player.name）。
 *
 * 历史包袱：卡片上曾显示设计稿简化名（「霓青持有」「橙方持有」），
 * 那只是颜色代号，玩家认不出自己的地盘。现在统一显示真名。
 *
 * ⚠ 截断策略：**JS 侧按格宽自适应**（不用 CSS 省略号）。
 *   原因：`text-overflow: ellipsis` 会让 `scrollWidth > clientWidth`，
 *   溢出检测按这个判据判定 —— 省略号本身就会被误报成「溢出」。
 *   所以这里在渲染时就把名字裁到能放下的长度：
 *     · 昵称上限 10 字（index.html 的 maxlength），AI 名也差不多；
 *     · 6 字以内原样显示；超过则裁到 5 字 + 「…」。
 *   `title` 属性保留完整真名，悬停可见。
 */
function ownerLabel(player) {
  const raw = String((player && player.name) || '').trim();
  if (!raw) return '—';
  // 6 字封顶 —— 地块卡面最窄处（92px）只能放 6~7 个中文字
  return raw.length > 6 ? raw.slice(0, 5) + '…' : raw;
}

/** 集团配色（未持有时楼体是集团色，已持有才换成玩家色） */
function groupOf(cell) {
  if (cell.regulator) {
    const r = REGULATORS[cell.regulatorId];
    return r ? { base: r.color, lt: r.lt, dk: r.dk, name: '监管' } : { base: '#5b6478', lt: '#8790a5', dk: '#3b4254', name: '功能' };
  }
  if (cell.group && GROUP_COLORS[cell.group]) {
    const g = GROUP_COLORS[cell.group];
    return { base: g.base, lt: g.lt, dk: g.dk, name: g.name };
  }
  return { base: '#5b6478', lt: '#8790a5', dk: '#3b4254', name: '功能' };
}

/** 特殊格分类 */
function specialCat(cell) {
  const id = cell.special ? cell.special.id : '';
  return SPECIAL_CATS[SPECIAL_CAT_OF[id] || 'random'];
}

/* ===========================================================
 * 建筑立面 —— 扁平矢量 SVG（未持有 = 蓝图态）
 * =========================================================== */
function flatFacade(lv, body, accent, held, blueprint) {
  const floors = Math.min(5, lv + 1);
  const W = 100, H = 62, baseY = 58, ground = 60;
  const bw = 34 + lv * 7;
  const x0 = (W - bw) / 2;
  const fh = floors * 8;
  const topY = baseY - fh;
  let s = '';

  const fill = blueprint ? 'rgba(15,23,42,.045)' : body;
  const stroke = blueprint
    ? ' stroke="rgba(15,23,42,.30)" stroke-dasharray="3 2.5" stroke-width="1.2"'
    : '';

  s += `<rect x="4" y="${ground}" width="${W - 8}" height="2" fill="rgba(15,23,42,.16)"/>`;
  s += `<rect x="${x0}" y="${topY}" width="${bw}" height="${fh}" fill="${fill}"${stroke}/>`;

  if (!blueprint) {
    s += `<rect x="${x0}" y="${topY}" width="${bw * 0.18}" height="${fh}" fill="rgba(255,255,255,.22)"/>`;
    s += `<rect x="${x0 + bw * 0.82}" y="${topY}" width="${bw * 0.18}" height="${fh}" fill="rgba(0,0,0,.18)"/>`;
  }
  if (lv >= 4) {
    s += `<path d="M${x0 - 3} ${topY} L${x0 + bw / 2} ${topY - 12} L${x0 + bw + 3} ${topY} Z" fill="${blueprint ? 'rgba(15,23,42,.05)' : body}"${blueprint ? ' stroke="rgba(15,23,42,.30)" stroke-dasharray="3 2.5" stroke-width="1.2"' : ''}/>`;
    if (!blueprint) s += `<rect x="${x0 + bw / 2 - 1}" y="${topY - 17}" width="2" height="6" fill="${accent}"/>`;
  } else if (lv >= 3) {
    s += `<rect x="${x0 + bw * 0.28}" y="${topY - 7}" width="${bw * 0.44}" height="7" fill="${blueprint ? 'rgba(15,23,42,.05)' : body}"${blueprint ? ' stroke="rgba(15,23,42,.30)" stroke-dasharray="3 2.5" stroke-width="1.2"' : ''}/>`;
    if (!blueprint) s += `<rect x="${x0 + bw * 0.28}" y="${topY - 7}" width="${bw * 0.44}" height="2" fill="${accent}"/>`;
  } else if (lv >= 2) {
    s += `<rect x="${x0 + bw * 0.3}" y="${topY - 4}" width="${bw * 0.4}" height="4" fill="${blueprint ? 'rgba(15,23,42,.05)' : body}"${blueprint ? ' stroke="rgba(15,23,42,.30)" stroke-dasharray="3 2.5" stroke-width="1.2"' : ''}/>`;
  } else if (lv >= 1) {
    s += `<rect x="${x0 - 2}" y="${topY - 2}" width="${bw + 4}" height="2" fill="${blueprint ? 'rgba(15,23,42,.05)' : body}"${blueprint ? ' stroke="rgba(15,23,42,.30)" stroke-dasharray="3 2.5" stroke-width="1.2"' : ''}/>`;
  }
  for (let f = 0; f < floors; f++) {
    const wy = topY + 3 + f * 8;
    const cols = Math.max(2, Math.round(bw / 12));
    const cw = (bw - 8) / cols;
    for (let c = 0; c < cols; c++) {
      const wx = x0 + 4 + c * cw;
      let fc;
      if (blueprint) fc = 'rgba(15,23,42,.13)';
      else {
        const lit = held ? ((f * 3 + c * 5) % 4 !== 0) : ((f * 5 + c * 3) % 5 !== 0);
        fc = lit ? '#fde68a' : 'rgba(255,255,255,.30)';
      }
      s += `<rect x="${wx.toFixed(1)}" y="${wy}" width="${(cw - 3).toFixed(1)}" height="4" fill="${fc}"/>`;
    }
  }
  return `<svg class="mt-svg mt-facade" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMax meet">${s}</svg>`;
}

/* ===========================================================
 * 监管机构专属徽章 / 权力建筑
 * =========================================================== */
function regBadgeSVG(kind, color, lt, dk) {
  const s = [];
  if (kind === 'coin') {
    s.push(`<circle cx="20" cy="20" r="14" fill="${dk}"/>`);
    s.push(`<circle cx="20" cy="20" r="11.5" fill="${color}"/>`);
    s.push(`<circle cx="20" cy="20" r="8" fill="none" stroke="${lt}" stroke-width="1.4"/>`);
    s.push(`<rect x="16" y="16" width="8" height="8" fill="${dk}"/>`);
    s.push(`<path d="M20 4v5M20 31v5M17 6l3 3 3-3M17 34l3-3 3 3" stroke="${lt}" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`);
  } else if (kind === 'shield') {
    s.push(`<path d="M20 4l13 5v11c0 8-6 13.5-13 16-7-2.5-13-8-13-16V9z" fill="${color}"/>`);
    s.push(`<path d="M20 4l13 5v11c0 8-6 13.5-13 16z" fill="${dk}" opacity=".45"/>`);
    s.push(`<path d="M20 4.5l12.5 4.8v10.7c0 7.6-5.7 12.9-12.5 15.2z" fill="none" stroke="${lt}" stroke-width="1.2"/>`);
    s.push(`<path d="M13 20l5 5 10-11" stroke="#fff" stroke-width="2.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`);
  } else if (kind === 'scale') {
    s.push(`<rect x="18.4" y="9" width="3.2" height="22" fill="${dk}"/>`);
    s.push(`<rect x="9" y="31" width="22" height="3" rx="1.4" fill="${dk}"/>`);
    s.push(`<rect x="7" y="9" width="26" height="2.6" rx="1.3" fill="${color}"/>`);
    s.push(`<circle cx="20" cy="7" r="2.6" fill="${lt}"/>`);
    s.push(`<path d="M7 11.6L2.6 21h8.8z" fill="${lt}"/>`);
    s.push(`<path d="M33 11.6L28.6 21h8.8z" fill="${lt}"/>`);
    s.push(`<path d="M11.6 21a3.6 3.6 0 007.2 0M28.4 21a3.6 3.6 0 007.2 0" stroke="${dk}" stroke-width="1.4" fill="none"/>`);
  } else {
    s.push(`<path d="M4 15l16-8 16 8v3H4z" fill="${color}"/>`);
    s.push(`<rect x="6" y="18" width="28" height="14" fill="${dk}"/>`);
    s.push(`<rect x="6" y="18" width="28" height="3" fill="${lt}"/>`);
    for (let i = 0; i < 4; i++) s.push(`<rect x="${9 + i * 7}" y="22" width="3.4" height="7" fill="${lt}"/>`);
    s.push(`<rect x="3" y="32" width="34" height="3.4" rx="1" fill="${color}"/>`);
    s.push(`<path d="M20 2.5v4M17.4 4.5h5.2" stroke="${lt}" stroke-width="1.8" stroke-linecap="round"/>`);
  }
  return `<svg class="mt-svg mt-reg-badge" viewBox="0 0 40 40" preserveAspectRatio="xMidYMid meet">${s.join('')}</svg>`;
}

function regBuildingSVG(info) {
  const c = info.color, l = info.lt, d = info.dk;
  const s = [];
  s.push(`<rect x="2" y="54" width="96" height="3" fill="rgba(15,23,42,.16)"/>`);
  s.push(`<rect x="6" y="49" width="88" height="5" fill="${d}"/>`);
  s.push(`<rect x="10" y="44" width="80" height="5" fill="${c}"/>`);
  if (info.badge === 'coin') {
    s.push(`<rect x="22" y="26" width="56" height="18" fill="${c}"/>`);
    s.push(`<rect x="22" y="26" width="56" height="4" fill="${l}"/>`);
    for (let i = 0; i < 5; i++) s.push(`<rect x="${26 + i * 11}" y="32" width="5" height="12" fill="${l}" opacity=".85"/>`);
    s.push(`<circle cx="50" cy="18" r="11" fill="${d}"/>`);
    s.push(`<circle cx="50" cy="18" r="8" fill="${c}"/>`);
    s.push(`<rect x="47" y="15" width="6" height="6" fill="${d}"/>`);
  } else if (info.badge === 'shield') {
    s.push(`<rect x="14" y="20" width="30" height="24" fill="${c}"/>`);
    s.push(`<rect x="56" y="20" width="30" height="24" fill="${c}"/>`);
    s.push(`<rect x="14" y="20" width="30" height="4" fill="${l}"/>`);
    s.push(`<rect x="56" y="20" width="30" height="4" fill="${l}"/>`);
    s.push(`<path d="M29 20l15-8 15 8z" fill="${d}"/>`);
    s.push(`<path d="M41 20l15-8 15 8z" fill="${d}"/>`);
    s.push(`<rect x="44" y="30" width="12" height="14" fill="${d}"/>`);
    for (let i = 0; i < 3; i++) {
      s.push(`<rect x="${18 + i * 8}" y="26" width="3.4" height="14" fill="${l}" opacity=".8"/>`);
      s.push(`<rect x="${60 + i * 8}" y="26" width="3.4" height="14" fill="${l}" opacity=".8"/>`);
    }
  } else if (info.badge === 'scale') {
    s.push(`<rect x="18" y="22" width="64" height="22" fill="${c}"/>`);
    s.push(`<rect x="14" y="18" width="72" height="5" fill="${d}"/>`);
    s.push(`<rect x="14" y="18" width="72" height="2" fill="${l}"/>`);
    for (let i = 0; i < 6; i++) s.push(`<rect x="${22 + i * 10}" y="26" width="5" height="16" fill="${l}" opacity=".85"/>`);
    s.push(`<rect x="46" y="8" width="8" height="11" fill="${d}"/>`);
    s.push(`<path d="M44 8h12l-6-5z" fill="${l}"/>`);
  } else {
    s.push(`<rect x="16" y="24" width="68" height="20" fill="${c}"/>`);
    s.push(`<rect x="16" y="24" width="68" height="3.5" fill="${l}"/>`);
    for (let i = 0; i < 5; i++) s.push(`<rect x="${19 + i * 14}" y="20" width="7" height="5" fill="${d}"/>`);
    s.push(`<path d="M38 24a12 12 0 0124 0z" fill="${d}"/>`);
    s.push(`<path d="M42 14a8 8 0 0116 0z" fill="${l}" opacity=".7"/>`);
    s.push(`<rect x="48" y="6" width="4" height="8" fill="${l}"/>`);
    for (let i = 0; i < 4; i++) s.push(`<rect x="${23 + i * 15}" y="30" width="6" height="11" fill="${l}" opacity=".8"/>`);
  }
  return `<svg class="mt-svg mt-reg-bld" viewBox="0 0 100 60" preserveAspectRatio="xMidYMax meet">${s.join('')}</svg>`;
}

/* ===========================================================
 * 特殊格图标
 * =========================================================== */
const SPECIAL_ICON = {
  start: '<path d="M4 22 L20 12 L36 22 L20 32 Z" fill="#e8a93c"/><circle cx="20" cy="9" r="4" fill="#ffc861"/>',
  event: '<rect x="8" y="7" width="24" height="26" rx="3" fill="#e0e7ff" stroke="#4f46e5" stroke-width="2"/><path d="M13 15h14M13 21h10M13 27h12" stroke="#4f46e5" stroke-width="2" stroke-linecap="round"/>',
  tax: '<circle cx="20" cy="20" r="13" fill="#fee2e2" stroke="#dc2626" stroke-width="2"/><text x="20" y="26" font-size="16" text-anchor="middle" fill="#dc2626" font-weight="700">%</text>',
  audit: '<path d="M20 5l13 5v10c0 8-6 13-13 15-7-2-13-7-13-15V10z" fill="#ede9fe" stroke="#7c3aed" stroke-width="2"/><path d="M14 20l5 5 9-10" stroke="#7c3aed" stroke-width="2.5" fill="none" stroke-linecap="round"/>',
  clearing: '<path d="M6 20h12l6-8h10M18 20l6 8h10" stroke="#0891b2" stroke-width="3" fill="none" stroke-linecap="round"/><circle cx="20" cy="20" r="4" fill="#67e8f9"/>',
  metro: '<rect x="9" y="6" width="22" height="24" rx="4" fill="#e0f2fe" stroke="#0284c7" stroke-width="2"/><path d="M13 12h14v8H13z" fill="#38bdf8"/><circle cx="15" cy="25" r="1.8" fill="#0f172a"/><circle cx="25" cy="25" r="1.8" fill="#0f172a"/><path d="M13 33h14" stroke="#dc2626" stroke-width="2"/>',
  rating: '<path d="M20 6l4.5 9 10 1.4-7.2 7 1.7 10-9-4.8-9 4.8 1.7-10-7.2-7L15.5 15z" fill="#fde68a" stroke="#d97706" stroke-width="2"/>',
  risk: '<path d="M20 6l14 24H6z" fill="#fee2e2" stroke="#dc2626" stroke-width="2"/><path d="M20 15v7" stroke="#dc2626" stroke-width="3" stroke-linecap="round"/><circle cx="20" cy="26" r="1.8" fill="#dc2626"/>',
  commodity: '<rect x="8" y="18" width="7" height="14" fill="#dc2626"/><rect x="17" y="11" width="7" height="21" fill="#16a34a"/><rect x="26" y="5" width="7" height="27" fill="#e8a93c"/>',
  roadshow: '<rect x="7" y="9" width="26" height="18" rx="3" fill="#ecfeff" stroke="#0891b2" stroke-width="2"/><path d="M20 27v7M12 34h16" stroke="#0891b2" stroke-width="2.5" stroke-linecap="round"/><circle cx="14" cy="18" r="3" fill="#fca5a5"/><circle cx="26" cy="18" r="3" fill="#fca5a5"/>',
  charity: '<path d="M20 30S8 22 8 14a6 6 0 0112-3 6 6 0 0112 3c0 8-12 16-12 16z" fill="#fecaca" stroke="#dc2626" stroke-width="2"/>',
  crossborder: '<path d="M8 30L32 10M32 10h-9M32 10v9" stroke="#16a34a" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/><circle cx="10" cy="30" r="4" fill="#bbf7d0"/>',
  refinance: '<rect x="7" y="12" width="26" height="17" rx="3" fill="#dcfce7" stroke="#16a34a" stroke-width="2"/><path d="M12 20h16M12 25h10" stroke="#16a34a" stroke-width="2" stroke-linecap="round"/>',
  market: '<path d="M7 30l8-9 6 5 12-14" stroke="#16a34a" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M28 12h5v5" stroke="#16a34a" stroke-width="3" fill="none" stroke-linecap="round"/>',
  poker: '<circle cx="13" cy="20" r="7" fill="#dc2626"/><circle cx="27" cy="20" r="7" fill="#1d4ed8"/><path d="M20 13v14" stroke="#b91c1c" stroke-width="2.5" transform="rotate(20 20 20)"/>',
  trap: '<circle cx="20" cy="20" r="13" fill="#fee2e2" stroke="#dc2626" stroke-width="2"/><path d="M20 12v10M20 26v.5" stroke="#dc2626" stroke-width="3" stroke-linecap="round"/>',
};

/** 转盘图标（4 扇区 + 中心轴 + 固定指针） */
function wheelIconSVG(cat) {
  const cx = 20, cy = 20, r = 18;
  const s = [];
  s.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="${cat.dk}"/>`);
  const n = 4;
  for (let i = 0; i < n; i++) {
    const a0 = (i * (360 / n) - 90) * Math.PI / 180;
    const a1 = ((i + 1) * (360 / n) - 90) * Math.PI / 180;
    s.push(`<path d="M${cx},${cy} L${(cx + (r - 1) * Math.cos(a0)).toFixed(2)},${(cy + (r - 1) * Math.sin(a0)).toFixed(2)} A${r - 1},${r - 1} 0 0 1 ${(cx + (r - 1) * Math.cos(a1)).toFixed(2)},${(cy + (r - 1) * Math.sin(a1)).toFixed(2)} Z" fill="${i % 2 ? cat.lt : cat.color}"/>`);
  }
  s.push(`<circle cx="${cx}" cy="${cy}" r="5" fill="#fff"/>`);
  s.push(`<circle cx="${cx}" cy="${cy}" r="5" fill="none" stroke="${cat.dk}" stroke-width="1.4"/>`);
  // 固定指针（尖端朝下）
  s.push(`<path d="M${cx - 4},${cy - r - 2} L${cx + 4},${cy - r - 2} L${cx},${cy - r + 4} Z" fill="${cat.dk}"/>`);
  return `<svg class="mt-svg mt-wheel-icon" viewBox="0 0 40 40" preserveAspectRatio="xMidYMid meet">${s.join('')}</svg>`;
}

/* ===========================================================
 * 三类地块卡面
 * =========================================================== */

/** 监管格 */
function tileRegulator(cell, st) {
  const info = REGULATORS[cell.regulatorId];
  if (!info) return '';
  const held = st.owner != null;
  const owner = held ? PLAYER_COLORS[st.owner] : null;
  const sign = REG_SIGN[info.sign];

  return `<div class="mt-tile mt-d2 mt-d2-reg${held ? ' is-held' : ' is-vacant'}${st.mortgaged ? ' is-mort' : ''}"
        style="--acc:${info.color};--acc-lt:${info.lt};--acc-dk:${info.dk}">
      <div class="mt-d2-top">
        <span class="mt-chip" style="background:${info.color}1f;color:${info.dk}">${esc(info.role)}</span>
        ${held
          ? `<span class="mt-d2-owner" title="${esc(st.ownerName || owner.name)}"><i style="background:${owner.main}"></i><span class="mt-owner-text">${esc(st.ownerName || owner.name)}</span></span>`
          : `<span class="mt-d2-tier" style="--acc:${info.dk}">监管</span>`}
      </div>
      ${nameHTML(cell.name, 'mt-d2-name')}
      <div class="mt-reg-scene">
        ${regBadgeSVG(info.badge, info.color, info.lt, info.dk)}
        ${regBuildingSVG(info)}
      </div>
      <div class="mt-reg-effect" style="--sign:${sign.color}">
        <span class="mt-reg-sign">${esc(sign.label)}</span>
        <span class="mt-reg-big">${esc(info.big)}</span>
        <span class="mt-reg-unit">${esc(info.unit)}</span>
      </div>
      <div class="mt-d2-foot">
        <span class="mt-d2-lv" style="color:${info.dk}">不可升级</span>
        <span class="mt-d2-price">${yuan(cell.price[0])}</span>
      </div>
      <div class="mt-reg-effectname">${esc(info.effectName)} · 全体玩家生效</div>
      ${!held && st.affordable ? `<div class="mt-d2-afford">可收购</div>` : ''}
      ${st.mortgaged ? `<div class="mt-mort-stripe"></div><div class="mt-mort-stamp">已质押</div>` : ''}
    </div>`;
}

/** 特殊格（含转盘格 / 赌场格） */
function tileSpecial(cell, st) {
  const sp = cell.special || {};
  const cat = specialCat(cell);
  const isTrap = !!sp.trap;

  // ===== 转盘格：分类色 + 大转盘图标 + 候选效果清单 =====
  if (sp.kind === 'wheel') {
    const outs = sp.outcomeData || [];
    const rows = outs.slice(0, 3).map((o) => `
      <div class="mt-d2-sp-row">
        <span class="mt-d2-sp-rowname${o.trap ? ' is-trap' : ''}">${esc(o.name)}</span>
        <span class="mt-d2-sp-rowval${o.trap ? ' is-trap' : ''}">${esc(o.big)}</span>
      </div>`).join('');
    const more = outs.length > 3 ? `<div class="mt-d2-sp-more">+${outs.length - 3} 项</div>` : '';
    return `<div class="mt-tile mt-d2 mt-d2-sp mt-d2-wheel${isTrap ? ' is-trap' : ''}"
        style="--acc:${cat.color};--acc-lt:${cat.lt};--acc-dk:${shade(cat.color, -0.3)}">
      <div class="mt-d2-sp-head">
        <span class="mt-d2-cat">${esc(cat.label)}</span>
        <span class="mt-d2-sp-sign">${esc(cat.sign)}</span>
      </div>
      ${nameHTML(sp.short || cell.name, 'mt-d2-sp-name')}
      <div class="mt-d2-sp-icon">${wheelIconSVG(cat)}</div>
      <div class="mt-d2-sp-list">${rows}${more}</div>
      ${isTrap ? `<div class="mt-d2-trap">陷阱</div>` : ''}
    </div>`;
  }

  // ===== 赌场格（城门上的娱乐区入口）=====
  if (sp.kind === 'gate' || sp.id === 'casino') {
    const cat2 = { color: '#8b5cc7', lt: '#b189e0', dk: '#5c3a86' };
    return `<div class="mt-tile mt-d2 mt-d2-sp mt-d2-casino"
        style="--acc:${cat2.color};--acc-lt:${cat2.lt};--acc-dk:${cat2.dk}">
      <div class="mt-d2-sp-head">
        <span class="mt-d2-cat">娱乐</span>
        <span class="mt-d2-sp-sign">开局</span>
      </div>
      ${nameHTML('私人赌场', 'mt-d2-sp-name')}
      <div class="mt-d2-sp-icon">
        <svg class="mt-svg mt-poker-icon" viewBox="0 0 40 40" preserveAspectRatio="xMidYMid meet">
          <rect x="7" y="5" width="15" height="21" rx="2.5" fill="#fff" stroke="#0f172a" stroke-width="1.6" transform="rotate(-12 14.5 15.5)"/>
          <rect x="18" y="7" width="15" height="21" rx="2.5" fill="#fff" stroke="#0f172a" stroke-width="1.6" transform="rotate(10 25.5 17.5)"/>
          <path d="M25 11c2.6 2.4 3 4.6 1.6 5.8-1.1.9-2.5.6-3-.6-.7 1.4-2.3 1.6-3.4.6-1.4-1.3-1-3.4 1.6-5.8 2.4 2.1 3 4 3.2 5.2.2-1.2.9-3.1 3-5.2z" fill="#0f172a"/>
          <rect x="9" y="28" width="9" height="4" rx="2" fill="#dc2626"/>
          <rect x="14" y="25" width="9" height="4" rx="2" fill="#ef4444"/>
          <rect x="19" y="22" width="9" height="4" rx="2" fill="#dc2626"/>
          <rect x="9" y="28" width="9" height="1" fill="#fca5a5"/>
          <rect x="14" y="25" width="9" height="1" fill="#fca5a5"/>
          <rect x="19" y="22" width="9" height="1" fill="#fca5a5"/>
        </svg>
      </div>
      <div class="mt-d2-sp-eff">
        <span class="mt-d2-sp-big">德扑</span>
        <span class="mt-d2-sp-lbl">全员参与</span>
      </div>
    </div>`;
  }

  // ===== 起点 / 独立功能格 =====
  const eff = SPECIAL_EFFECT[sp.id] || { big: '—', lbl: '' };
  const iconId = SPECIAL_ICON[sp.icon] ? sp.icon
    : (SPECIAL_ICON[sp.id] ? sp.id : 'trap');
  const icon = `<svg class="mt-svg mt-fn-icon" viewBox="0 0 40 40" preserveAspectRatio="xMidYMid meet">${SPECIAL_ICON[iconId] || SPECIAL_ICON.trap}</svg>`;

  return `<div class="mt-tile mt-d2 mt-d2-sp${isTrap ? ' is-trap' : ''}"
        style="--acc:${cat.color};--acc-lt:${cat.lt};--acc-dk:${shade(cat.color, -0.3)}">
      <div class="mt-d2-sp-head">
        <span class="mt-d2-cat">${esc(cat.label)}</span>
        <span class="mt-d2-sp-sign">${esc(cat.sign)}</span>
      </div>
      <div class="mt-d2-sp-icon">${icon}</div>
      ${nameHTML(sp.short || cell.name, 'mt-d2-sp-name')}
      <div class="mt-d2-sp-eff">
        <span class="mt-d2-sp-big${isTrap ? ' is-neg' : ''}">${esc(eff.big)}</span>
        <span class="mt-d2-sp-lbl">${esc(eff.lbl)}</span>
      </div>
      ${isTrap ? `<div class="mt-d2-trap">陷阱</div>` : ''}
    </div>`;
}

/** 机构格 */
function tileInstitution(cell, st) {
  const held = st.owner != null;
  const owner = held ? PLAYER_COLORS[st.owner] : null;
  const g = groupOf(cell);

  const lv = st.level != null ? st.level : (cell.tier || 0);
  const lvIdx = Math.max(0, Math.min(4, lv));
  const rent = Array.isArray(cell.rent) ? (cell.rent[lvIdx] ?? cell.rent[0] ?? 0) : (cell.rent || 0);
  const price = Array.isArray(cell.price) ? (cell.price[lvIdx] ?? cell.price[0]) : (cell.price || 0);
  const lvLabel = LEVELS[lvIdx] ? LEVELS[lvIdx].label : '';

  /* 主读数随所有权切换：未持有 = 买入价，已持有 = 管理费 */
  const body = held ? owner.main : g.base;
  const accent = held ? owner.lt : g.lt;
  const acc = held ? owner.main : g.base;

  const mainVal = held ? yuan(rent) : yuan(price);
  const mainLbl = held ? '管理费' : '买入价';
  const subVal = held ? yuan(price) : yuan(rent);
  const subLbl = held ? '买入 / 升级价' : '买后每回合';

  /* 等级刻度：实心 = 已有 / 买下即得，虚线 = 待升级，空白 = 锁定 */
  const segs = LEVELS.map((L, i) => {
    const on = i <= lvIdx;
    const solid = on && (held || i < lvIdx);
    const pending = on && !held && i === lvIdx;
    const style = solid ? `background:${acc}`
      : pending ? `background:${acc}55;border:1px dashed ${acc}`
        : 'background:rgba(15,23,42,.13)';
    return `<i class="mt-seg${pending ? ' is-pending' : ''}" style="${style}"></i>`;
  }).join('');

  const afford = !!st.affordable;

  return `<div class="mt-tile mt-d2${held ? ' is-held' : ' is-vacant'}${afford ? ' is-afford' : ''}${st.mortgaged ? ' is-mort' : ''}"
        style="--acc:${acc};--acc-lt:${accent};--acc-dk:${held ? owner.dk : g.dk}">
      <div class="mt-d2-top">
        <span class="mt-chip" style="background:${g.base}22;color:${g.dk}">${esc(g.name)}</span>
        ${held
          ? `<span class="mt-d2-owner" title="${esc(st.ownerName || owner.name)}"><i style="background:${owner.main}"></i><span class="mt-owner-text">${esc(st.ownerName || owner.name)}</span></span>`
          : `<span class="mt-d2-tier">${esc(lvLabel)}</span>`}
      </div>
      ${nameHTML(cell.name, 'mt-d2-name')}
      <div class="mt-d2-segs">${segs}</div>
      <div class="mt-d2-fig">
        <div class="mt-d2-figL">
          <div class="mt-d2-main">${mainVal}</div>
          <div class="mt-d2-mainlbl">${mainLbl}</div>
          <div class="mt-d2-sub"><span class="mt-d2-sublbl">${subLbl}</span> ${subVal}</div>
        </div>
        <div class="mt-d2-figR">${flatFacade(lvIdx, body, accent, held, !held)}</div>
      </div>
      <div class="mt-d2-foot">
        <span class="mt-d2-lv">${esc(lvLabel)}</span>
        <span class="mt-d2-price">${held ? '买入 ' + yuan(price) : '未持有'}</span>
      </div>
      ${!held && afford ? `<div class="mt-d2-afford">可收购</div>` : ''}
      ${st.mortgaged ? `<div class="mt-mort-stripe"></div><div class="mt-mort-stamp">已质押</div>` : ''}
    </div>`;
}

/**
 * 统一入口 —— 监管格 / 特殊格 / 机构格。
 *
 * ================== 三层结构（3D 关键）==================
 *   .mt-tile      牌体 —— 承担 3D 倾斜、厚度、落影
 *     .mt-face    牌面底板 —— 承担浮雕与底色
 *       .mt-content  信息层 —— **不参与倾斜**，文字始终正立
 *
 * ⚠ 为什么信息层要「抽出来」而不是在牌面上做反向 rotateX：
 *   反向补偿（billboard）的固有代价是牌面不再保持平行四边形，
 *   有一边会「翘起」—— 麻将牌是矩形的，翘起会破坏牌体质感。
 *   把信息层整体平铺在牌体之上，牌体保持完整矩形，
 *   文字正立，代价只是信息层与牌面不共面（视觉上像悬浮信息屏）。
 */
export function tileHTML(cell, st) {
  let inner;
  if (cell.regulator) inner = tileRegulator(cell, st);
  else if (cell.type !== 'institution') inner = tileSpecial(cell, st);
  else inner = tileInstitution(cell, st);
  return `<div class="mt-tile"><div class="mt-face">${inner}</div></div>`;
}

/* ===========================================================
 * 地块层控制器
 * =========================================================== */
export class TileLayer {
  /**
   * @param {HTMLElement} root  #board-tiles 容器
   * @param {object} renderer BoardRenderer（提供 cellRect / trackCenter）
   */
  constructor(root, renderer) {
    this.root = root;
    this.renderer = renderer;
    this.nodes = [];
    this._lastKey = '';
    this._is3D = false;
  }

  /**
   * 布局 —— 把每格矩形换算成**百分比**写进 style。
   *
   * ⚠ 百分比是相对 `#board-tiles` 的，而 `#board-tiles` 与 canvas 同尺寸 ——
   *   因此 canvas 缩放时地块自动跟随，**无需 JS 重排**。
   */
  layout() {
    const r = this.renderer;
    if (!r || !r.layout) return;
    const w = r.w || 1;
    const h = r.h || 1;
    for (let i = 0; i < BOARD_SIZE; i++) {
      const node = this.nodes[i];
      if (!node) continue;
      const rect = r.cellRect(i);
      node.style.left = `${(rect.x / w) * 100}%`;
      node.style.top = `${(rect.y / h) * 100}%`;
      node.style.width = `${(rect.w / w) * 100}%`;
      node.style.height = `${(rect.h / h) * 100}%`;
    }
  }

  /** 构建 34 个地块 DOM（只在首次创建时调用） */
  build() {
    this.root.innerHTML = '';
    this.nodes = [];
    for (let i = 0; i < BOARD_SIZE; i++) {
      const cell = BOARD_CELLS[i];
      const node = document.createElement('div');
      node.className = 'mt-cell';
      node.dataset.index = String(i);
      node.setAttribute('role', 'button');
      node.setAttribute('tabindex', '0');
      node.setAttribute('aria-label', cell.name);
      node.innerHTML = tileHTML(cell, { level: cell.tier, owner: null, mortgaged: false, affordable: false });
      this.root.appendChild(node);
      this.nodes.push(node);
    }
    this.layout();
    this.applyDepth();
  }

  /* ===========================================================
   * 深度排序 —— 3D 视角下的正确遮挡关系
   * ===========================================================
   * ⚠ 为什么必须显式排序：
   *   DOM 没有深度缓冲。倾斜后「离屏幕近」的格子可能排在 DOM 后���，
   *   视觉上会被前面的格子盖住 —— 但实际应该是它盖住别人。
   *
   * ⚠ 排序依据 = **格子的行号**（不是回合顺序）：
   *   俯视 45° 时，越靠下（row 越大）的格子离观察者越近。
   *   回合顺序（沿轨道走）与远近无关，用它排序会得到乱七八糟的结果。
   *
   * ⚠ 只在 3D 模式下排序：
   *   平面模式下 z-index 越少越好 —— 减少重排、避免 hover 抢占的意外。
   *   所以本方法在平面模式只写 `z-index: auto`（清掉 3D 的残留）。
   */
  applyDepth() {
    const is3D = this.is3D();
    for (let i = 0; i < BOARD_SIZE; i++) {
      const node = this.nodes[i];
      if (!node) continue;
      if (!is3D) {
        // 平面模式：交回给 hover 规则（CSS 里 .mt-cell:hover { z-index: 3 }）
        node.style.zIndex = '';
        continue;
      }
      // row 越大越近 → z-index 越大越靠上
      const row = this._rowOf(i);
      node.style.zIndex = String(10 + row * 10);
    }
  }

  /** 格子索引 → 所在行号（用于深度排序） */
  _rowOf(index) {
    const p = TRACK_POINTS[index];
    if (!p) return 0;
    // TRACK_POINTS 的 y 已归一化到 0..1000（= (row + 0.5) / rows * 1000）
    const rows = BOARD_GRID.rows || 1;
    return Math.floor((p[1] / 1000) * rows);
  }

  /**
   * 切换 3D 模式 —— 切换后必须重排深度。
   *
   * @param {boolean} on
   */
  set3D(on) {
    this._is3D = !!on;
    this.applyDepth();
  }

  /** 当前是否 3D 模式 */
  is3D() {
    return !!this._is3D;
  }

  /**
   * 同步状态 —— 重新渲染每张卡面的内容（class 变化 + 内容变化）。
   *
   * 只在「影响卡面的状态」真的变了才重绘，避免每帧刷 DOM。
   */
  sync(state) {
    const key = this._stateKey(state);
    if (key === this._lastKey) return;
    this._lastKey = key;
    this._render(state);
  }

  _stateKey(state) {
    const parts = [];
    for (const p of state.players) {
      parts.push(`${p.id}:${p.cash}:${p.position}`);
      for (const inst of p.institutions) {
        parts.push(`${p.id}.${inst.cellIndex}.${inst.level}.${inst.mortgaged ? 1 : 0}`);
      }
    }
    parts.push(`cp${state.currentPlayerIndex}`);
    return parts.join('|');
  }

  _render(state) {
    const cur = state.players && state.players[state.currentPlayerIndex];
    const isTurn = !!(cur && !cur.isAI && !cur.bankrupt);

    for (let i = 0; i < BOARD_SIZE; i++) {
      const cell = BOARD_CELLS[i];
      const node = this.nodes[i];
      if (!node) continue;

      const inst = this._findInst(state, i);
      const owner = inst ? inst.player : null;
      const lv = inst ? inst.level : (cell.tier || 0);

      // 可收购判定：当前玩家 + 现金足够 + 该格未持有 + 是机构格
      let affordable = false;
      if (isTurn && !inst && cell.type === 'institution') {
        const price = cell.regulator
          ? (Array.isArray(cell.price) ? cell.price[0] : cell.price)
          : (Array.isArray(cell.price) ? (cell.price[cell.tier || 0] ?? cell.price[0]) : cell.price);
        affordable = cur.cash >= price;
      }

      const st = {
        level: lv,
        owner: owner ? owner.colorIndex : null,
        // 持有人**真名**（玩家昵称 / AI 名），不再用「霓青」这类颜色代号
        ownerName: owner ? ownerLabel(owner) : '',
        mortgaged: !!(inst && inst.mortgaged),
        affordable,
      };

      const html = tileHTML(cell, st);
      // 只在内容真的变了时才重写 innerHTML
      if (node._html !== html) {
        node.innerHTML = html;
        node._html = html;
      }

      // 当前玩家所在格 → 高亮
      const isActive = !!(cur && cur.position === i);
      node.classList.toggle('is-active', isActive);
    }
  }

  _findInst(state, index) {
    for (const p of state.players) {
      for (const inst of p.institutions) {
        if (inst.cellIndex === index) return { ...inst, player: p };
      }
    }
    return null;
  }
}
