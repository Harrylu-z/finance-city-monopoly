/**
 * 本地存储 —— 历史战绩、设置项、排行榜。
 */

const KEY_HISTORY = 'fc-monopoly.history';
const KEY_SETTINGS = 'fc-monopoly.settings';
const KEY_STATS = 'fc-monopoly.stats';

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/** 保存一局战绩 */
export function saveRecord(record) {
  const hist = read(KEY_HISTORY, []);
  hist.unshift({ ...record, date: new Date().toISOString(), id: Date.now() });
  while (hist.length > 50) hist.pop();
  write(KEY_HISTORY, hist);
  updateStats(record);
  return hist;
}

export function loadHistory() {
  return read(KEY_HISTORY, []);
}

export function clearHistory() {
  try { localStorage.removeItem(KEY_HISTORY); } catch { /* ignore */ }
}

function updateStats(record) {
  const stats = read(KEY_STATS, { games: 0, wins: 0, bestChain: 0, bestAssets: 0 });
  stats.games = (stats.games || 0) + 1;
  if (record.isPlayerWinner) stats.wins = (stats.wins || 0) + 1;
  if (record.bestChain) stats.bestChain = Math.max(stats.bestChain || 0, record.bestChain);
  if (record.winnerAssets) stats.bestAssets = Math.max(stats.bestAssets || 0, record.winnerAssets);
  write(KEY_STATS, stats);
}

export function loadStats() {
  return read(KEY_STATS, { games: 0, wins: 0, bestChain: 0, bestAssets: 0 });
}

export function saveSettings(settings) {
  return write(KEY_SETTINGS, settings);
}

/**
 * 读取设置项。
 *
 * ================== 兼容规则 ==================
 * 旧存档可能仍带 `avatar`（棋子形象）与 `theme`（题材皮肤）字段 ——
 * 这两个功能已删除，读取时**直接忽略**，不影响其余设置项的恢复。
 * 未知的旧字段不会导致崩溃，也不会被写回。
 */
export function loadSettings() {
  const s = read(KEY_SETTINGS, null) || {};
  return {
    nickname: typeof s.nickname === 'string' ? s.nickname : '',
    careerId: typeof s.careerId === 'string' && s.careerId ? s.careerId : 'ib',
    difficulty: s.difficulty || 'normal',
    aiCount: Number.isFinite(s.aiCount) ? s.aiCount : 3,
    diceCount: Number.isFinite(s.diceCount) ? s.diceCount : 2,
    cash: s.cash || 'standard',
    market: s.market || 'normal',
    sound: s.sound !== false,
    anim: s.anim !== false,
    tutorial: s.tutorial !== false,
  };
}

/** 排行榜（按玩家名聚合胜率） */
export function loadLeaderboard() {
  const hist = loadHistory();
  const map = new Map();
  for (const r of hist) {
    const name = r.winnerName || '未知';
    if (!map.has(name)) map.set(name, { name, wins: 0, games: 0, assets: 0 });
    const e = map.get(name);
    e.games += 1;
    e.wins += 1;
    e.assets = Math.max(e.assets, r.winnerAssets || 0);
  }
  return [...map.values()]
    .sort((a, b) => b.wins - a.wins || b.assets - a.assets)
    .slice(0, 10);
}
