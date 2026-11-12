/**
 * HUD 与日志面板 —— DOM 渲染（像素风硬边框样式）。
 */

import { PLAYER_COLORS, PALETTE } from '../core/palette.js';
import { getAvatarIcon } from '../art/avatars.js';
import { totalAssets, financialMetrics } from '../core/economy.js';
import { institutionCount } from '../core/rules.js';

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
    canvas.style.width = '20px';
    canvas.style.height = '30px';
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
