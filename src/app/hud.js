/**
 * HUD 与日志面板 —— DOM 渲染（现代扁平风 · 浅色卡片）。
 */

import { PLAYER_COLORS, PALETTE } from '../core/palette.js';
import { getAvatarIcon } from '../art/avatars.js';
import {
  totalAssets, financialMetrics, levelLabel, allGroupBuffs,
  groupBuffTier, outstandingLoan, bondRedeemValue, holdingTier,
  calculateRent, buffMultiplierFor, buffEffectMult,
} from '../core/economy.js';
import { institutionCount } from '../core/rules.js';
import { GROUP_META } from '../core/board.js';

/** 渲染玩家卡片 */
export function renderPlayerCards(el, state, onClick) {
  el.innerHTML = '';
  for (const p of state.players) {
    const card = document.createElement('div');
    card.className = 'pcard';
    if (p.index === state.currentPlayerIndex) card.classList.add('is-active');
    if (p.bankrupt) card.classList.add('is-dead');
    const pc = PLAYER_COLORS[p.colorIndex % PLAYER_COLORS.length];
    card.style.borderLeftColor = pc.main;

    const canvas = getAvatarIcon(p.avatar, p.colorIndex);
    // 保持立绘原始宽高比（职业立绘 32×40）
    canvas.style.width = '20px';
    canvas.style.height = `${Math.round(20 * canvas.height / canvas.width)}px`;
    card.appendChild(canvas);

    const info = document.createElement('div');
    info.className = 'pcard-info';

    const nameRow = document.createElement('div');
    nameRow.className = 'pcard-name';
    const nm = document.createElement('span');
    nm.textContent = p.name;
    if (p.bankrupt) {
      const tag = document.createElement('span');
      tag.style.color = PALETTE.redLt;
      tag.textContent = '爆仓';
      nameRow.appendChild(tag);
    }
    const cash = document.createElement('span');
    cash.className = 'pcard-cash';
    cash.textContent = `￥${p.cash}`;
    nameRow.appendChild(nm);
    nameRow.appendChild(cash);
    info.appendChild(nameRow);

    const sub = document.createElement('div');
    sub.className = 'pcard-sub';
    const cnt = institutionCount(p);
    sub.textContent = p.bankrupt
      ? '已退市'
      : `控股 ${cnt} 家 · 总资产 ￥${totalAssets(p, state)}`;
    info.appendChild(sub);

    const bar = document.createElement('div');
    bar.className = 'pcard-bar';
    const fill = document.createElement('i');
    const total = state.players.reduce((s, o) => s + totalAssets(o, state), 0) || 1;
    const pct = Math.round((totalAssets(p, state) / total) * 100);
    fill.style.width = `${pct}%`;
    fill.style.background = pc.main;
    bar.appendChild(fill);
    info.appendChild(bar);

    card.appendChild(info);
    if (onClick) {
      card.addEventListener('click', () => onClick(p));
      card.setAttribute('role', 'button');
      card.setAttribute('tabindex', '0');
    }
    el.appendChild(card);
  }
}

/**
 * 渲染资产排行
 * @param {HTMLElement} el 排行容器
 * @param {object} state 游戏状态
 * @param {Function} [onPick] 点击某位玩家时的回调（用于打开财务指标下钻窗口）
 */
export function renderRank(el, state, onPick) {
  el.innerHTML = '';
  const ranked = state.players
    .map((p) => ({ p, assets: totalAssets(p, state) }))
    .sort((a, b) => {
      if (a.p.bankrupt !== b.p.bankrupt) return a.p.bankrupt ? 1 : -1;
      return b.assets - a.assets;
    });

  ranked.forEach((entry, i) => {
    const row = document.createElement('div');
    row.className = 'rank-item';
    const pc = PLAYER_COLORS[entry.p.colorIndex % PLAYER_COLORS.length];

    const pos = document.createElement('span');
    pos.className = 'rank-pos';
    pos.textContent = String(i + 1);
    row.appendChild(pos);

    const dot = document.createElement('span');
    dot.className = 'rank-dot';
    dot.style.background = pc.main;
    row.appendChild(dot);

    const name = document.createElement('span');
    name.className = 'rank-name';
    name.textContent = entry.p.name;
    row.appendChild(name);

    const val = document.createElement('span');
    val.className = 'rank-val';
    val.textContent = entry.p.bankrupt ? '已清算' : `￥${Math.max(0, entry.assets)}`;
    row.appendChild(val);

    // 下钻入口：点击行查看该玩家的财务指标
    if (onPick) {
      const drill = document.createElement('span');
      drill.className = 'rank-drill';
      drill.textContent = '▸';
      drill.title = `查看 ${entry.p.name} 的财务指标`;
      row.appendChild(drill);

      row.classList.add('is-clickable');
      row.setAttribute('role', 'button');
      row.setAttribute('tabindex', '0');
      row.title = `查看 ${entry.p.name} 的财务指标`;
      row.addEventListener('click', () => onPick(entry.p, i + 1));
      row.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onPick(entry.p, i + 1);
        }
      });
    }

    el.appendChild(row);
  });
}

/* ===================================================================
 * 财务对比表 —— 右侧常驻面板
 *
 * 行 = 关键财务指标；列 = 玩家（按资产排名排序）。
 * 指标全部来自 economy.js 的 financialMetrics（单一数据源），
 * 每行最优值金色加粗，真人玩家所在列高亮 —— 无需点开弹窗即可横向对比。
 * =================================================================== */

const COMPARE_ROWS = [
  { key: 'assets',     label: '总资产',   fmt: (m) => `￥${Math.max(0, m.assets)}`, dir: 'max' },
  { key: 'cash',       label: '现金',     fmt: (m) => `￥${m.cash}`,                dir: 'max' },
  { key: 'netWorth',   label: '净资产',   fmt: (m) => `￥${m.netWorth}`,            dir: 'max' },
  { key: 'debt',       label: '总负债',   fmt: (m) => `￥${m.debt}`,                dir: 'min' },
  { key: 'debtRatio',  label: '负债率',   fmt: (m) => `${m.debtRatio}%`,            dir: 'min' },
  { key: 'rentIncome', label: '每圈收入', fmt: (m) => `￥${m.rentIncome}`,          dir: 'max' },
  { key: 'activeCount',label: '在营机构', fmt: (m) => `${m.activeCount}`,           dir: 'max' },
  { key: 'institutionCount', label: '控股总数', fmt: (m) => `${m.institutionCount}`, dir: 'max' },
];

/**
 * 渲染全玩家财务对比表。
 * @param {HTMLElement} el 表格容器
 * @param {object} state 游戏状态
 */
export function renderFinanceCompare(el, state) {
  el.innerHTML = '';
  if (!state || !state.players || !state.players.length) return;

  const ranked = state.players
    .map((p) => ({ p, assets: totalAssets(p, state) }))
    .sort((a, b) => {
      if (a.p.bankrupt !== b.p.bankrupt) return a.p.bankrupt ? 1 : -1;
      return b.assets - a.assets;
    })
    .map((e) => ({ p: e.p, m: financialMetrics(e.p, state) }));

  const table = document.createElement('table');
  table.className = 'fin-cmp-table';

  // ===== 表头：指标 | 玩家 1..N =====
  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  const corner = document.createElement('th');
  corner.textContent = '指标';
  headRow.appendChild(corner);
  for (const e of ranked) {
    const pc = PLAYER_COLORS[e.p.colorIndex % PLAYER_COLORS.length];
    const th = document.createElement('th');
    th.className = 'fin-cmp-head' + (e.p.bankrupt ? ' is-dead' : '');
    if (!e.p.isAI) th.classList.add('is-me');
    const dot = document.createElement('i');
    dot.className = 'fin-cmp-dot';
    dot.style.background = pc.main;
    th.appendChild(dot);
    const nm = document.createElement('span');
    nm.textContent = e.p.name.length > 4 ? e.p.name.slice(0, 4) : e.p.name;
    nm.title = e.p.name;
    th.appendChild(nm);
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);
  table.appendChild(thead);

  // ===== 表体 =====
  const tbody = document.createElement('tbody');
  for (const row of COMPARE_ROWS) {
    const values = ranked.map((e) => row.fmt(e.m));
    const nums = ranked.map((e) => {
      const n = Number(e.m[row.key]);
      return Number.isFinite(n) ? n : null;
    });
    // 每行最优值（破产玩家不参与「最优」评选）
    let bestIdx = -1;
    const liveIdx = ranked.map((e, i) => (e.p.bankrupt ? -1 : i)).filter((i) => i >= 0);
    if (liveIdx.length >= 2) {
      let best = null;
      for (const i of liveIdx) {
        const v = nums[i];
        if (v == null) continue;
        if (best == null
          || (row.dir === 'max' && v > nums[best])
          || (row.dir === 'min' && v < nums[best])) best = i;
      }
      // 只有当最优值确实优于别人时才标注
      const distinct = [...new Set(liveIdx.map((i) => nums[i]))];
      if (best != null && distinct.length > 1) bestIdx = best;
    }

    const tr = document.createElement('tr');
    const label = document.createElement('td');
    label.textContent = row.label;
    tr.appendChild(label);
    ranked.forEach((e, i) => {
      const td = document.createElement('td');
      td.textContent = e.p.bankrupt && row.key === 'assets' ? '已清算' : values[i];
      if (!e.p.isAI) td.classList.add('is-me');
      if (i === bestIdx) td.classList.add('is-best');
      if (row.key === 'debtRatio' && e.m.debtRatio >= 100) td.classList.add('is-bad');
      if (row.key === 'cash' && e.m.cash < 0) td.classList.add('is-bad');
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  el.appendChild(table);
}

/**
 * 左上角状态提示 —— 贷款 / 债券 / 限时状态。
 *
 * 只展示当前行动玩家（与上方玩家卡片一致）的负债与状态：
 *   贷款    本金 + 欠息，剩余回合数
 *   发行债券 募集金额，剩余圈数（到期需还本付息）
 *   持有债券 认购面值合计
 *   限时状态 buff 名称 + 剩余回合，坏状态用红色
 *
 * 无内容时整块隐藏，不占版面。最多展示 5 条，其余折叠为 +N。
 */
export function renderActiveStatus(el, player, state) {
  if (!el) return;
  if (!player || player.bankrupt) {
    el.hidden = true;
    el.replaceChildren();
    return;
  }

  const chips = [];

  for (const l of player.loans || []) {
    const left = Math.max(0, (l.term || 0) - (l.turnsElapsed || 0));
    const owed = (l.amount || 0) + (l.accruedInterest || 0);
    chips.push({
      cls: 'is-debt',
      text: `贷款 ￥${owed} · ${left > 0 ? `剩 ${left} 回合` : '本期到期'}`,
      title: `${l.name || '银行贷款'}　本金 ￥${l.amount}`
        + (l.accruedInterest ? `　欠息 ￥${l.accruedInterest}` : ''),
    });
  }

  for (const b of player.bonds || []) {
    const left = Math.max(0, (b.dueRound || 0) - (state.round || 1));
    const raised = (b.face || 0) * ((b.subscribers || []).length);
    chips.push({
      cls: 'is-bond',
      text: `发行债券 ￥${raised} · ${left > 0 ? `剩 ${left} 圈` : '本期到期'}`,
      title: `票息 ${Math.round((b.coupon || 0) * 1000) / 10}%　到期需还本付息`,
    });
  }

  const heldBond = (player.subscribedBonds || [])
    .reduce((s, b) => s + (b.face || 0), 0);
  if (heldBond > 0) {
    chips.push({ cls: 'is-bond', text: `持有债券 ￥${heldBond}`, title: '已认购他人发行的债券' });
  }

  for (const f of player.buffs || []) {
    chips.push({
      cls: f.kind === 'bad' ? 'is-bad' : 'is-good',
      text: `${f.name} · 剩 ${f.remaining} 回合`,
      title: f.desc || '',
    });
  }

  if (!chips.length) {
    el.hidden = true;
    el.replaceChildren();
    return;
  }

  const MAX = 5;
  el.hidden = false;
  el.replaceChildren();
  for (const c of chips.slice(0, MAX)) {
    const s = document.createElement('span');
    s.className = `status-chip ${c.cls}`;
    s.textContent = c.text;
    if (c.title) s.title = c.title;
    el.appendChild(s);
  }
  if (chips.length > MAX) {
    const more = document.createElement('span');
    more.className = 'status-chip is-more';
    more.textContent = `+${chips.length - MAX}`;
    more.title = chips.slice(MAX).map((c) => c.text).join(' / ');
    el.appendChild(more);
  }
}

/** 追加日志 */
export function appendLog(el, entry) {
  const item = document.createElement('div');
  item.className = `log-item l-${entry.kind}`;
  const tag = document.createElement('span');
  tag.className = 'log-tag';
  tag.textContent = entry.tag;
  const text = document.createElement('span');
  text.textContent = entry.text;
  item.appendChild(tag);
  item.appendChild(text);
  el.appendChild(item);
  while (el.children.length > 120) el.removeChild(el.firstChild);
  el.scrollTop = el.scrollHeight;
}

export function clearLog(el) {
  el.innerHTML = '';
}

/** 现金数字跳帧动画 */
export function animateCash(el, from, to) {
  if (from === to) {
    el.textContent = `￥${to}`;
    return;
  }
  const diff = to - from;
  const steps = 8;
  let i = 0;
  const timer = setInterval(() => {
    i++;
    const val = Math.round(from + (diff * i) / steps);
    el.textContent = `￥${val}`;
    if (i >= steps) {
      clearInterval(timer);
      el.textContent = `￥${to}`;
    }
  }, 45);
}

/** 行情灯带 */
export function drawKline(canvas, state, elapsed) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = PALETTE.ink;
  ctx.fillRect(0, 0, W, H);

  const count = 18;
  const step = W / count;

  for (let i = 0; i < count; i++) {
    const seed = Math.abs(Math.sin(i * 12.9898 + state.round * 78.233)) * 43758.5453;
    const r = seed - Math.floor(seed);
    const tick = Math.floor(elapsed / 300 + i * 0.5) % 3;
    const amp = 6 + r * 8 + tick;
    const mid = H / 2;
    const top = Math.max(1, Math.round(mid - amp));
    const h = Math.max(2, Math.round(amp * 2));
    const up = (i + state.round) % 3 !== 0;
    const c = up ? PALETTE.red : PALETTE.jade;
    ctx.fillStyle = c;
    ctx.fillRect(Math.round(i * step), top, Math.max(2, Math.round(step) - 1), h);
    ctx.fillStyle = up ? PALETTE.redLt : PALETTE.jadeLt;
    ctx.fillRect(Math.round(i * step), top, Math.max(2, Math.round(step) - 1), 1);
  }

  ctx.fillStyle = PALETTE.glassDeep;
  ctx.fillRect(0, Math.floor(H / 2), W, 1);
}

/* ===================================================================
 * 左侧 Tab 面板 —— 玩家关键信息（3 tab，内容互不重复）
 *
 * 数据全部取自 `state`（与 openPlayerDetail / 排行面板同一数据源）：
 *   · 我的机构 —— 机构列表 + 每圈管理费 + 资金流水（player.cashFlow）
 *   · Buff      —— player.buffs + allGroupBuffs(player)（经营生态加成）
 *   · 融资      —— player.loans / bonds / subscribedBonds + 质押融资 + 监管牌照
 *
 * ⚠ 原「净值」tab 已删除：资产 / 净资产 / 负债率等汇总由右侧
 *   「财务对比表」与玩家卡片常驻展示，点击排行榜玩家可看完整下钻明细。
 * =================================================================== */

/** 数字格式化（千分位） */
function fmtNum(n) {
  return (n == null ? 0 : Number(n)).toLocaleString('en-US');
}

/** 建一个「小节标题」 */
function tabSection(title, valueText) {
  const sec = document.createElement('div');
  sec.className = 'tab-sec';
  const t = document.createElement('span');
  t.textContent = title;
  sec.appendChild(t);
  if (valueText != null) {
    const v = document.createElement('span');
    v.className = 'tab-sec-v';
    v.textContent = valueText;
    sec.appendChild(v);
  }
  return sec;
}

/** 建一个「键值行」 */
function tabRow(key, value, cls) {
  const row = document.createElement('div');
  row.className = 'tab-row';
  const k = document.createElement('span');
  k.className = 'tab-row-k';
  k.textContent = key;
  row.appendChild(k);
  const v = document.createElement('span');
  v.className = 'tab-row-v' + (cls ? ' ' + cls : '');
  v.textContent = value;
  row.appendChild(v);
  return row;
}

/** 空状态提示 */
function tabEmpty(text) {
  const d = document.createElement('div');
  d.className = 'tab-empty';
  d.textContent = text;
  return d;
}

/**
 * 渲染「我的机构」tab —— 机构列表 + 资金流水（2026-11 合并回归）。
 *
 * ⚠️ 布局（2026-11 调整）：「资金流水」重新并入本 tab ——
 *    上半段机构列表、下半段流水列表，一屏对照「资产 ↔ 现金流」。
 *    （资金流水曾短暂独立成 tab，横向 tab 位挤不下且与机构来回切换繁琐。）
 *
 * @param {HTMLElement} el  我的机构 tabpanel 元素
 */
export function renderTabInstitutions(el, player, state) {
  el.replaceChildren();
  if (!player) { el.appendChild(tabEmpty('暂无数据')); return; }

  const insts = (player.institutions || []).slice()
    .sort((a, b) => a.cellIndex - b.cellIndex);

  if (!insts.length) {
    el.appendChild(tabEmpty('尚未持有任何机构\n买下即成为网点级资产'));
  } else {
    // ⚠ 租金展示必须与后台实际收租**同口径**（2026-11 一致性修复）：
    //   calculateRent（基础 × 等级系数 × 行情 × 事件）
    //   × buffMultiplierFor（纵深×精耕×控股×牛市特色×监管牌照）
    //   × buffEffectMult('rentMult')（限时 buff：评级/公益/去杠杆/套保…）
    //   —— 与 rules.js 交租结算、financialMetrics.rentIncome 完全一致。
    //   旧实现直接显示裸 cell.rent[level]，与实际到手的租金严重不符。
    const buffMultFor = (group) => buffMultiplierFor(player, group, state)
      * buffEffectMult(player, 'rentMult');
    const effectiveRent = (cell, lv) => calculateRent(cell, lv, {
      market: state.market,
      eventMult: state.eventMult ?? 1,
      buffMult: buffMultFor(cell.group),
    });

    const totalRent = insts.reduce((s, i) => {
      const cell = state.board[i.cellIndex];
      if (!cell || i.mortgaged) return s;
      return s + effectiveRent(cell, i.level);
    }, 0);

    el.appendChild(tabSection('持有机构', `${insts.length} 家`));

    for (const inst of insts) {
      const cell = state.board[inst.cellIndex];
      if (!cell) continue;
      const row = document.createElement('div');
      row.className = 'tab-inst';

      const pc = PLAYER_COLORS[player.colorIndex % PLAYER_COLORS.length];
      const dot = document.createElement('i');
      dot.className = 'tab-inst-dot';
      dot.style.background = pc.main;
      row.appendChild(dot);

      const name = document.createElement('span');
      name.className = 'tab-inst-name';
      name.textContent = cell.name;
      name.title = cell.name;
      row.appendChild(name);

      const lv = document.createElement('span');
      lv.className = 'tab-inst-lv';
      lv.textContent = levelLabel(inst.level) || `L${inst.level}`;
      row.appendChild(lv);

      if (inst.mortgaged) {
        const flag = document.createElement('span');
        flag.className = 'tab-inst-flag';
        flag.textContent = '质押';
        flag.title = '已质押 —— 暂停产生管理费';
        row.appendChild(flag);
      } else {
        const rent = effectiveRent(cell, inst.level);
        const rv = document.createElement('span');
        rv.className = 'tab-inst-rent';
        rv.textContent = `￥${fmtNum(rent)}`;
        rv.title = `当前每圈管理费 ￥${fmtNum(rent)}（含行情 / 集团生态 / 限时状态加成）`;
        row.appendChild(rv);
      }

      el.appendChild(row);
    }

    el.appendChild(tabSection('每圈管理费收入', `￥${fmtNum(totalRent)}`));
  }

  // ===== 下半段：资金流水（并入本 tab，一屏对照「资产 ↔ 现金流」）=====
  renderCashFlowInto(el, player, state);
}

/**
 * 渲染资金流水内容到指定容器 —— **不清空容器**。
 *
 * 只展示玩家自己的账本（player.cashFlow），不含 AI 的流水。
 * 条目包含：回合数 / 金额（+ 收入 − 支出）/ 事由 / 分类标签。
 * 新的在最上面，最多展示 CASHFLOW_SHOW_MAX 条，超出部分可滚动查看。
 *
 * ⚠️ 净额用 player.cashFlowNet（独立累加），不能从流水条目反推 ——
 *    条目列表只保留最近 N 条，早期条目已被丢弃。
 *
 * @param {HTMLElement} el 目标容器（由调用方保证已清空/定位）
 */
function renderCashFlowInto(el, player, state) {
  void state;
  const flows = (player.cashFlow || []).slice(-CASHFLOW_SHOW_MAX).reverse();

  el.appendChild(tabSection('资金流水', flows.length ? `${flows.length} 条` : '无'));
  const net = player.cashFlowNet || 0;
  el.appendChild(tabRow(
    '累计净额',
    `${net >= 0 ? '+' : '−'}￥${fmtNum(Math.abs(net))}`,
    net > 0 ? 'is-green' : (net < 0 ? 'is-red' : 'is-dim'),
  ));

  if (!flows.length) {
    el.appendChild(tabEmpty('暂无资金流水\n交租、买入、收租等收支都会记在这里'));
    return;
  }

  // 流水列表 —— 独立滚动，机构很多时流水不会被顶出视野
  const list = document.createElement('div');
  list.className = 'cf-list';

  for (const f of flows) {
    const row = document.createElement('div');
    row.className = 'cf-row ' + (f.amount >= 0 ? 'is-in' : 'is-out');

    const turn = document.createElement('span');
    turn.className = 'cf-turn';
    turn.textContent = f.round ? `R${f.round}` : `T${f.turn}`;
    turn.title = `第 ${f.turn} 回合 · 第 ${f.round} 圈`;
    row.appendChild(turn);

    const reason = document.createElement('span');
    reason.className = 'cf-reason';
    reason.textContent = f.reason || (f.tag || '资金变动');
    reason.title = reason.textContent;
    row.appendChild(reason);

    const amt = document.createElement('span');
    amt.className = 'cf-amt';
    amt.textContent = `${f.amount >= 0 ? '+' : '−'}￥${fmtNum(Math.abs(f.amount))}`;
    row.appendChild(amt);

    list.appendChild(row);
  }

  el.appendChild(list);
}

/**
 * 渲染「资金流水」tab（独立面板形态，当前 tab 结构已并入「我的机构」）。
 * 保留导出仅为兼容潜在的复用点；主路径走 renderTabInstitutions。
 *
 * @param {HTMLElement} el 资金流水 tabpanel 元素
 */
export function renderTabCashFlow(el, player, state) {
  el.replaceChildren();
  if (!player) return;
  renderCashFlowInto(el, player, state);
}

/** 流水条目展示上限 —— 旧的在更上面，净额用 cashFlowNet 独立累加不受截断影响 */
const CASHFLOW_SHOW_MAX = 30;

/**
 * 渲染「Buff」tab —— 限时状态 + 集团牌照加成。
 */
export function renderTabBuffs(el, player, state) {
  el.replaceChildren();
  if (!player) { el.appendChild(tabEmpty('暂无数据')); return; }

  const buffs = player.buffs || [];
  el.appendChild(tabSection('限时状态', buffs.length ? `${buffs.length} 条` : '无'));

  if (!buffs.length) {
    el.appendChild(tabEmpty('当前没有生效中的增益 / 减益'));
  } else {
    for (const f of buffs) {
      const row = document.createElement('div');
      row.className = 'tab-buff ' + (f.kind === 'bad' ? 'is-bad' : 'is-good');

      const tag = document.createElement('span');
      tag.className = 'tab-buff-tag';
      tag.textContent = f.kind === 'bad' ? '减益' : '增益';
      row.appendChild(tag);

      const body = document.createElement('div');
      body.className = 'tab-buff-body';
      const nm = document.createElement('div');
      nm.className = 'tab-buff-name';
      nm.textContent = f.name;
      body.appendChild(nm);
      if (f.desc) {
        const ds = document.createElement('div');
        ds.className = 'tab-buff-desc';
        ds.textContent = f.desc;
        body.appendChild(ds);
      }
      row.appendChild(body);

      const left = document.createElement('span');
      left.className = 'tab-buff-left';
      left.textContent = `剩 ${f.remaining}`;
      row.appendChild(left);

      el.appendChild(row);
    }
  }

  // ===== 经营生态加成（四层叠乘：纵深 × 精耕 × 特色 × 控股）=====
  const gb = allGroupBuffs(player);
  /** 乘数展示：去掉多余的尾零（×1.15 / ×1.335） */
  const fmtMult = (m) => `×${Number(Number(m).toFixed(3))}`;
  const anyActive = Object.keys(gb).some((k) => {
    const g = gb[k];
    return (g.tier || 0) > 0 || (g.depth?.mult || 1) > 1 || g.special?.active;
  });

  // 「生态总览」入口 —— 派发 DOM 事件，由 main.js 打开 showBuffPanel
  // （hud.js 不直接 import dialogs.js，保持展示层单向依赖）
  const overviewBtn = document.createElement('button');
  overviewBtn.className = 'tab-eco-btn';
  overviewBtn.type = 'button';
  overviewBtn.textContent = '查看生态总览 ≫';
  overviewBtn.title = '打开经营生态四层加成总览';
  overviewBtn.addEventListener('click', () => {
    document.dispatchEvent(new CustomEvent('open-buff-panel'));
  });

  el.appendChild(tabSection('经营生态加成', anyActive ? '' : '未触发'));
  el.appendChild(overviewBtn);
  if (!anyActive) {
    el.appendChild(tabEmpty('同类机构 ≥2 家 → 集团纵深\n升级机构 → 精耕加成\n总控股 ≥6 家 → 金融控股\n全部叠乘'));
  } else {
    for (const k of Object.keys(gb)) {
      const g = gb[k];
      const meta = GROUP_META[k];
      const label = (meta && meta.name) || k;
      if ((g.count || 0) <= 0) continue;
      // 该集团租金合计 = 纵深（数量档）× 精耕（等级档）
      const groupMult = (g.mult || 1) * (g.depth?.mult || 1);
      const bits = [];
      if (g.tier > 0) bits.push(g.name);
      for (const d of (g.depth?.items || [])) bits.push(d.name);
      // ⚠ 唯一性（2026-11）：不在 Buff tab 显示持有机构家数 ——
      //   持有机构信息只在「我的机构」tab 展示，这里只给加成乘数与档位名。
      el.appendChild(tabRow(
        label,
        fmtMult(groupMult),
        groupMult > 1 ? 'is-green' : 'is-dim',
      ));
      if (bits.length) {
        el.appendChild(tabRow(`└ ${bits.join(' / ')}`, '', 'is-dim'));
      }
      if (g.special?.active) {
        el.appendChild(tabRow(`└ ${g.special.name}`, '已解锁', 'is-green'));
      }
    }
    // 层 4 金融控股（跨集团总持有）—— 不展示家数（持有机构信息只在「我的机构」tab）
    const holding = holdingTier(player);
    if (holding.tier > 0) {
      el.appendChild(tabSection('金融控股', holding.names.join(' / ')));
      el.appendChild(tabRow(
        '全局收租',
        fmtMult(holding.rentMult),
        'is-green',
      ));
      if (holding.upgradeCostMult < 1) {
        el.appendChild(tabRow('└ 升级费', `−${Math.round((1 - holding.upgradeCostMult) * 100)}%`, 'is-green'));
      }
      if (holding.roundBonus > 0) {
        el.appendChild(tabRow('└ 每圈补贴', `￥${holding.roundBonus}`, 'is-green'));
      }
      if (holding.loanRateMult < 1) {
        el.appendChild(tabRow('└ 贷款利率', `${(holding.loanRateMult * 10).toFixed(1).replace(/\.0$/, '')} 折`, 'is-green'));
      }
    }
  }}

/* ===================================================================
 * 「融资」tab —— 央行贷款 + 债券（发行与持有）合一
 *
 * 2026-11：原「贷款」「债券」两个 tab 合并为「融资」——
 * 两者同属负债端的融资工具，一屏对照「贷了多少 / 发了多少 / 认购了谁」。
 * ⚠ 与「净值」tab 的分工（唯一性）：
 *   · 融资 tab = **明细**（每笔额度/利率/期限/欠息、每笔债券票息/到期）；
 *   · 净值 tab = **汇总**（总负债 / 负债率 / 权益比率），不重复明细数字。
 * =================================================================== */

/** 贷款明细段（不清空容器，供「融资」tab 组装） */
function renderLoansInto(el, player) {
  const loans = player.loans || [];
  const total = loans.reduce((s, l) => s + (l.amount || 0), 0);

  el.appendChild(tabSection('央行贷款', loans.length ? `${loans.length} 笔` : '无'));

  if (!loans.length) {
    el.appendChild(tabEmpty('尚无央行贷款\n每圈经过起点后可申请一次'));
    return;
  }

  for (const l of loans) {
    el.appendChild(tabSection(l.name || '银行贷款'));
    el.appendChild(tabRow('已贷额度', `￥${fmtNum(l.amount)}`, 'is-red'));
    const rate = (l.rate || 0) * 100;
    el.appendChild(tabRow('利率', `${Number(rate.toFixed(2))}% / 回合`));
    const left = Math.max(0, (l.term || 0) - (l.turnsElapsed || 0));
    el.appendChild(tabRow('剩余期数', left > 0 ? `${left} 期` : '本期到期',
      left > 0 ? '' : 'is-red'));
    const perTurn = l.interestPerTurn || 0;
    el.appendChild(tabRow('每期利息', `￥${fmtNum(perTurn)}`));
    if (l.accruedInterest) {
      el.appendChild(tabRow('累计欠息', `￥${fmtNum(l.accruedInterest)}`, 'is-red'));
    }
  }

  el.appendChild(tabSection('贷款合计'));
  el.appendChild(tabRow('未偿本金', `￥${fmtNum(total)}`, 'is-red'));
  const owe = outstandingLoan(player);
  if (owe) {
    el.appendChild(tabRow('应还总额', `￥${fmtNum(owe)}`, 'is-red'));
  }
}

/** 债券明细段（不清空容器，供「融资」tab 组装） */
function renderBondsInto(el, player, state) {
  const issued = player.bonds || [];
  const held = player.subscribedBonds || [];

  // ===== 发行中 =====
  el.appendChild(tabSection('我发行的债券', issued.length ? `${issued.length} 笔` : '无'));
  if (!issued.length) {
    el.appendChild(tabEmpty('尚未发行公司债券\n踩到「再融资窗口」可向其他玩家发行'));
  } else {
    for (const b of issued) {
      const left = Math.max(0, (b.dueRound || 0) - (state.round || 1));
      const subs = (b.subscribers || []).length;
      const raised = (b.face || 0) * subs;
      el.appendChild(tabSection(`公司债 · ${subs} 家认购`));
      el.appendChild(tabRow('募资额', `￥${fmtNum(raised)}`, 'is-green'));
      el.appendChild(tabRow('面值', `￥${fmtNum(b.face)}`));
      const cp = (b.coupon || 0) * 100;
      el.appendChild(tabRow('票息', `${Number(cp.toFixed(2))}% / 圈`));
      el.appendChild(tabRow('到期', left > 0 ? `剩 ${left} 圈` : '本期到期',
        left > 0 ? '' : 'is-red'));
    }
  }

  // ===== 持有中 =====
  el.appendChild(tabSection('我持有的债券', held.length ? `${held.length} 笔` : '无'));
  if (!held.length) {
    el.appendChild(tabEmpty('未认购他人债券'));
  } else {
    for (const b of held) {
      const issuer = state.players.find((p) => p.id === b.issuerId);
      const left = Math.max(0, (b.dueRound || 0) - (state.round || 1));
      el.appendChild(tabSection(issuer ? issuer.name : '未知发行人'));
      el.appendChild(tabRow('面值', `￥${fmtNum(b.face)}`));
      const cp = (b.coupon || 0) * 100;
      el.appendChild(tabRow('利息', `${Number(cp.toFixed(2))}% / 圈`));
      el.appendChild(tabRow('到期', left > 0 ? `剩 ${left} 圈` : '本期到期',
        left > 0 ? '' : 'is-red'));
      const rv = bondRedeemValue(b);
      if (rv) {
        el.appendChild(tabRow('到期可得', `￥${fmtNum(rv)}`, 'is-green'));
      }
    }
  }
}

/**
 * 渲染「融资」tab —— 贷款 + 债券 + 质押融资 + 监管牌照。
 *
 * ⚠ 唯一性（2026-11）：持有机构相关信息**只出现在「我的机构」tab** ——
 *   本 tab 只放融资工具（贷款 / 债券 / 质押 / 牌照），不展示机构列表或租金。
 *   原「净值」tab 已删除 —— 资产 / 净资产 / 负债率等汇总由
 *   右侧「财务对比表」与玩家卡片常驻展示，排行榜下钻弹窗提供完整明细，
 *   不再占用左侧 tab 位。
 *
 * @param {HTMLElement} el 融资 tabpanel 元素
 */
export function renderTabFinance(el, player, state) {
  el.replaceChildren();
  if (!player) { el.appendChild(tabEmpty('暂无数据')); return; }
  renderLoansInto(el, player);
  renderBondsInto(el, player, state);

  // ===== 质押融资（从已删除的「净值」tab 并入 —— 质押是融资工具之一）
  // ⚠ 唯一性：不展示质押机构数（持有机构信息只在「我的机构」tab）
  const m = financialMetrics(player, state);
  const pledged = m.mortgagedAmount || 0;
  el.appendChild(tabSection('质押融资'));
  el.appendChild(tabRow('已质押金额', `￥${fmtNum(pledged)}`));

  // ===== 监管牌照（持有人独享效果的资产，归入融资 tab）=====
  el.appendChild(tabSection('监管牌照', `${m.regulatorCount} 张`));
}

/**
 * 渲染全部 tab 面板。
 * @param {object} els  {inst, buff, finance} 各 tabpanel 元素
 */
export function renderTabPanels(els, player, state) {
  if (!els || !player || !state) return;

  // ===== 各 tab 独立渲染（内容互不重复）=====
  //   「我的机构」= 持有机构 + 每圈管理费 + 资金流水（机构相关信息只在此 tab）
  //   「Buff」    = 限时状态 + 经营生态加成
  //   「融资」    = 央行贷款明细 + 债券（发行/持有）+ 质押融资 + 监管牌照
  renderTabInstitutions(els.inst, player, state);
  renderTabBuffs(els.buff, player, state);
  renderTabFinance(els.finance, player, state);
}
