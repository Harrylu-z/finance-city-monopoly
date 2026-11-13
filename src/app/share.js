/**
 * 分享 —— 深链接、复制链接、嵌入代码、分享图下载。
 */

import { renderShareCard, downloadCanvas } from '../render/share-card.js';
import { totalAssets } from '../core/economy.js';
import { getCareer } from '../core/careers.js';

/**
 * 生成深链接（编码 seed 与开局配置）
 */
export function buildShareUrl(config) {
  const base = `${location.protocol}//${location.host}${location.pathname}`;
  const p = new URLSearchParams();
  p.set('seed', config.seed);
  if (config.difficulty) p.set('mode', config.difficulty);
  if (config.aiCount != null) p.set('ai', String(config.aiCount));
  if (config.diceCount) p.set('dice', String(config.diceCount));
  if (config.cash) p.set('cash', config.cash);
  if (config.market) p.set('mkt', config.market);
  // URLSearchParams.set 会自动做 URL 编码，此处不可再手动 encodeURIComponent（否则会二次编码）
  if (config.nickname) p.set('nick', config.nickname);
  // 不再写 `av`（棋子形象）—— 立绘由职业唯一决定，无需序列化。
  if (config.careerId) p.set('career', String(config.careerId));
  return `${base}?${p.toString()}`;
}

/**
 * 解析深链接参数
 */
export function parseShareUrl() {
  const p = new URLSearchParams(location.search);
  const seed = p.get('seed');
  if (!seed) return null;
  // URLSearchParams.get 已自动解码，此处不可再手动 decodeURIComponent
  let nickname = p.get('nick') || '';
  // 兼容早期版本产生的二次编码昵称
  if (/%[0-9a-f]{2}/i.test(nickname)) {
    try { nickname = decodeURIComponent(nickname); } catch (e) { /* 保留原值 */ }
  }
  return {
    seed,
    difficulty: p.get('mode') || 'normal',
    aiCount: p.get('ai') ? parseInt(p.get('ai'), 10) : 3,
    diceCount: p.get('dice') ? parseInt(p.get('dice'), 10) : 2,
    cash: p.get('cash') || 'standard',
    market: p.get('mkt') || 'normal',
    nickname,
    // 旧链接里的 `av`（棋子形象）参数**直接忽略** —— 形象已由职业固定绑定。
    careerId: p.get('career') || 'ib',
  };
}

/** iframe 嵌入代码 */
export function buildEmbedCode(url) {
  return `<iframe src="${url}" width="100%" height="720" style="border:2px solid #e0a53f;background:#161b2e;" allowfullscreen loading="lazy"></iframe>`;
}

/** 复制到剪贴板（带回退） */
export async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* 回退 */ }

  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/**
 * 打开分享弹窗
 */
export function openShareDialog(state, config, onToast) {
  const root = document.getElementById('share-root');
  const canvas = document.getElementById('share-canvas');
  const urlInput = document.getElementById('share-url');
  const embedInput = document.getElementById('embed-code');

  const url = buildShareUrl(config);
  urlInput.value = url;
  embedInput.value = buildEmbedCode(url);

  const owners = new Array(state.board.length).fill(null);
  for (const p of state.players) {
    for (const inst of p.institutions) owners[inst.cellIndex] = p.colorIndex;
  }

  renderShareCard(canvas, {
    title: '中国金融城 · 机构争夺战',
    seed: state.seed,
    boardCells: state.board,
    owners,
    players: state.players.map((p) => ({
      name: p.name,
      assets: totalAssets(p, state),
      cash: p.cash,
      count: p.institutions.length,
      colorIndex: p.colorIndex,
      avatar: p.avatar,
      isAI: p.isAI,
      // AI 的「职业 + 性格」双属性
      careerId: p.careerId,
      careerName: getCareer(p.careerId)?.name || '',
      personality: p.personality,
    })),
  });

  root.hidden = false;

  document.getElementById('btn-share-close').onclick = () => { root.hidden = true; };
  document.getElementById('share-backdrop').onclick = () => { root.hidden = true; };

  document.getElementById('btn-copy-url').onclick = async () => {
    const ok = await copyText(url);
    onToast(ok ? '链接已复制！' : '复制失败，请手动复制', ok ? 't-good' : 't-bad');
  };

  document.getElementById('btn-copy-embed').onclick = async () => {
    const ok = await copyText(embedInput.value);
    onToast(ok ? '嵌入代码已复制' : '复制失败', ok ? 't-good' : 't-bad');
  };

  document.getElementById('btn-dl-card').onclick = () => {
    const ok = downloadCanvas(canvas, `finance-city-${state.seed}.png`);
    onToast(ok ? '分享图已下载' : '下载失败', ok ? 't-good' : 't-bad');
  };
}
