/**
 * HUD 与日志面板 —— DOM 渲染（像素风硬边框样式）。
 */

import { PLAYER_COLORS, PALETTE } from '../core/palette.js';
import { getAvatarIcon } from '../art/avatars.js';
import { totalAssets } from '../core/economy.js';
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
