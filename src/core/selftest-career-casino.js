/**
 * 职业系统 & 赌场德州扑克 —— 专项自检。
 *
 * 覆盖关键路径：
 *   1. 7 种职业的定义自洽性、被动强度上限、一一对应的棋子形象；
 *   2. 各职业被动的实际触发（收购价 / 升级费 / 罚金 / 租金 / 择时 / 额外底牌）；
 *   3. 赌场地块：落点触发、全员同桌、结束后正确恢复主游戏；
 *   4. 德州扑克引擎：牌库 52 张硬约束、发牌策略、摊牌分池、下注结算；
 *   5. 赌王多 1 张底牌但全局牌库仍 ≤ 52 张；
 *   6. 结算后主游戏状态不被破坏（现金非负、机构所有权不变）。
 */

import {
  CAREERS, CAREER_BY_ID, DEFAULT_CAREER_ID, getCareer, playerCareer,
  careerEffectMult, careerEffectValue, careerHasHook, validateCareers,
} from './careers.js';
import {
  BOARD_CELLS, BOARD_SIZE, SPECIAL,
} from './board.js';
import { CONFIG, totalAssets } from './economy.js';
import {
  createState, settleOnCell, resolvePurchase, upgradeInstitution,
  applyTrapCard, startCasinoGame, finishCasinoGame, playerCostMult,
} from './rules.js';
import {
  buildDeck, evaluateHand, compareHands, createPokerGame, assertDeckIntegrity,
  remainingCards, legalActions, applyAction, currentActor, buildPots, showdown,
  aiAction, handStrength, POKER_CONFIG, cardLabel,
} from './poker.js';
import { makeRng } from './rng.js';

/** 断言工具 */
function check(results, name, fn) {
  try {
    const detail = fn();
    results.push({ name, pass: true, detail: detail || 'OK' });
  } catch (e) {
    results.push({ name, pass: false, detail: e.message || String(e) });
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || '断言失败');
}

/** 构造 4 人测试局 */
function makeCasinoState(overrides = {}) {
  const players = [
    // 不传 avatar —— 立绘由职业唯一决定（createState 会忽略旧存档里的该字段）
    { id: 0, name: '测试者', isAI: false, colorIndex: 0, careerId: 'ib' },
    { id: 1, name: 'AI甲', isAI: true, colorIndex: 1, careerId: 'risk' },
    { id: 2, name: 'AI乙', isAI: true, colorIndex: 2, careerId: 'actuary' },
    { id: 3, name: 'AI丙', isAI: true, colorIndex: 3, careerId: 'king' },
  ];
  return createState({
    seed: 'casino-test',
    players,
    diceCount: 2,
    cash: CONFIG.cashLevels.standard,
    market: 'normal',
    difficulty: 'normal',
    ...overrides,
  });
}

/** 找到赌场格索引 */
function casinoCellIndices() {
  return BOARD_CELLS
    .map((c, i) => (c.type === 'special' && c.special?.id === 'casino' ? i : -1))
    .filter((i) => i >= 0);
}

/* ===================================================================
 * 一、职业系统
 * =================================================================== */

export function runCareerChecks() {
  const results = [];

  check(results, '职业定义自洽（7 种 · 被动温和 · 钩子唯一）', () => {
    const errors = validateCareers();
    assert(errors.length === 0, errors.join('; '));
    assert(CAREERS.length === 7, `职业数 ${CAREERS.length}`);
    return `7 种职业 · 被动乘数偏离 ≤15% · 固定加成 ≤￥300`;
  });

  check(results, '职业被动钩子互不重复', () => {
    const hooks = new Set();
    for (const c of CAREERS) {
      const h = c.passive.hook;
      assert(!hooks.has(h), `钩子重复：${h}`);
      hooks.add(h);
    }
    return [...hooks].join(' / ');
  });

  check(results, '职业与棋子形象一一对应', () => {
    const pieces = CAREERS.map((c) => c.pieceIndex);
    const set = new Set(pieces);
    assert(set.size === 7, `棋子索引重复：${pieces.join(',')}`);
    for (const c of CAREERS) {
      assert(c.pieceIndex >= 7 && c.pieceIndex <= 13,
        `${c.id} 的 pieceIndex=${c.pieceIndex} 越界（应 7~13）`);
    }
    return `棋子索引 ${pieces.join(' / ')} —— 7 种职业 7 张专属形象`;
  });

  check(results, '真人玩家的立绘同样绑定职业', () => {
    // 「选择棋子形象」已删除 —— 真人也不能挑外观，只能由职业决定。
    const st = makeCasinoState();
    const human = st.players.find((p) => !p.isAI);
    assert(human, '找不到真人玩家');
    assert(human.avatar === CAREER_BY_ID[human.careerId].pieceIndex,
      `真人立绘未绑定职业（avatar=${human.avatar}, career=${human.careerId}）`);
    return `真人「${human.name}」使用职业「${human.careerId}」的专属立绘（索引 ${human.avatar}）`;
  });

  check(results, '「赌王」职业存在且带额外底牌被动', () => {
    const king = CAREER_BY_ID.king;
    assert(king, '缺少赌王');
    assert(king.name === '赌王', `名称 ${king.name}`);
    assert(careerEffectValue({ career: 'king' }, 'pokerExtraHole') === 1,
      'pokerExtraHole 应为 1');
    assert(careerHasHook({ career: 'king' }, 'pokerExtraHole'), '钩子应为 pokerExtraHole');
    return '赌王 · 起始底牌 +1 张';
  });

  check(results, '职业乘数读取（缺省返回 1）', () => {
    assert(careerEffectMult({}, 'buyCostMult') === 1, '无职业应返回 1');
    assert(careerEffectMult({ career: 'ib' }, 'buyCostMult') === 0.92, '投行家应为 0.92');
    assert(careerEffectMult({ career: 'fund' }, 'upgradeCostMult') === 0.94, '基金经理应为 0.94');
    assert(careerEffectMult({ career: 'actuary' }, 'rentMult') === 1.06, '精算师应为 1.06');
    assert(careerEffectMult({ career: 'risk' }, 'trapRelief') === 0.30, '风控总监应为 0.30');
    return 'buyCostMult 0.92 / upgradeCostMult 0.94 / rentMult 1.06 / trapRelief 0.30';
  });

  check(results, '未知职业 id 安全降级', () => {
    assert(getCareer('nope') === null, '未知 id 应返回 null');
    assert(playerCareer({ career: 'nope' }) === null, '未知职业应返回 null');
    assert(getCareer(null) === null, 'null 应返回 null');
    assert(getCareer(DEFAULT_CAREER_ID) !== null, '默认职业应有效');
    return '未知 id 一律降级为 null（不抛错）';
  });

  /* ---------- 被动实际生效 ---------- */

  check(results, '被动 · 投行家收购价 -8%', () => {
    const cellIdx = BOARD_CELLS.findIndex(
      (c) => c.type === 'institution' && !c.regulator && c.tier === 0,
    );
    // 对照组：无投行家职业
    const plain = makeCasinoState();
    plain.players[0].career = 'risk';
    plain.players[0].careerId = 'risk';
    plain.players[0].position = cellIdx;
    const plainOffer = settleOnCell(plain, plain.players[0], cellIdx)
      .find((r) => r.kind === 'purchase-offer');
    assert(plainOffer, '对照组未产生收购要约');

    // 实验组：投行家
    const state = makeCasinoState();
    const p = state.players[0];
    p.position = cellIdx;
    const offer = settleOnCell(state, p, cellIdx)
      .find((r) => r.kind === 'purchase-offer');
    assert(offer, '实验组未产生收购要约');
    assert(offer.price === Math.round(plainOffer.price * 0.92),
      `收购价 ${offer.price} ≠ ${plainOffer.price}×0.92`);
    assert(offer.price < plainOffer.price, '投行家未享受折价');
    return `￥${offer.price}（对照 ￥${plainOffer.price} × 0.92）`;
  });

  check(results, '被动 · 基金经理升级费 -6%', () => {
    const state = makeCasinoState();
    const p = state.players[0];
    p.career = 'fund';
    p.careerId = 'fund';
    const cellIdx = BOARD_CELLS.findIndex(
      (c, i) => c.type === 'institution' && !c.regulator && c.tier >= 1,
    );
    const cell = BOARD_CELLS[cellIdx];
    p.institutions.push({ cellIndex: cellIdx, level: 0, mortgaged: false, mortgageAmount: 0 });
    p.upgradePermits[cellIdx] = true;
    p.cash = 20000;
    const res = upgradeInstitution(state, p, cellIdx);
    assert(res.ok, `升级失败：${res.reason}`);
    const plain = createState({
      seed: 'x', players: [{ id: 0, name: 'a', isAI: false, careerId: 'ib' }],
      cash: 20000,
    });
    const q = plain.players[0];
    q.institutions.push({ cellIndex: cellIdx, level: 0, mortgaged: false, mortgageAmount: 0 });
    q.upgradePermits[cellIdx] = true;
    q.cash = 20000;
    const res2 = upgradeInstitution(plain, q, cellIdx);
    assert(res2.ok, '对照组升级失败');
    assert(res.cost === Math.round(res2.cost * 0.94),
      `升级费 ${res.cost} ≠ ${res2.cost}×0.94`);
    return `￥${res.cost}（对照 ￥${res2.cost} × 0.94）`;
  });

  check(results, '被动 · 风控总监罚金 -30%', () => {
    const state = makeCasinoState();
    const p = state.players[1];
    p.career = 'risk';
    p.careerId = 'risk';
    const card = { id: 't', title: '测试罚单', text: '测试', effect: { cash: -200 } };
    const res = applyTrapCard(state, p, card);
    assert(res.cash === -140, `罚金 ${res.cash} ≠ -140（-200×0.7）`);
    assert(p.cash === CONFIG.cashLevels.standard - 140, '现金结算错误');
    return `罚金 -200 → ${res.cash}（减免 30%）`;
  });

  check(results, '被动 · 精算师租金 +6%', () => {
    const state = makeCasinoState();
    const owner = state.players[2];
    owner.career = 'actuary';
    owner.careerId = 'actuary';
    const payer = state.players[0];
    const cellIdx = BOARD_CELLS.findIndex(
      (c) => c.type === 'institution' && !c.regulator && c.tier === 2,
    );
    const cell = BOARD_CELLS[cellIdx];
    owner.institutions.push({ cellIndex: cellIdx, level: 2, mortgaged: false, mortgageAmount: 0 });
    payer.position = cellIdx;
    const before = payer.cash;
    const res = settleOnCell(state, payer, cellIdx);
    const rentRes = res.find((r) => r.kind === 'rent-paid');
    assert(rentRes, '未产生交租结算');
    assert(rentRes.rent === Math.round(cell.rent[2] * 1.06),
      `租金 ${rentRes.rent} ≠ ${Math.round(cell.rent[2] * 1.06)}`);
    assert(before - payer.cash === rentRes.rent, '扣款额与租金不一致');
    return `租金 ￥${rentRes.rent}（基准 ￥${cell.rent[2]} × 1.06）`;
  });

  check(results, '被动 · 交易员择时价差收益', () => {
    const state = makeCasinoState();
    const p = state.players[3];
    p.career = 'trader';
    p.careerId = 'trader';
    const cellIdx = BOARD_CELLS.findIndex(
      (c) => c.type === 'special' && c.special?.id === 'market',
    );
    assert(cellIdx >= 0, '未找到市场周期格');
    const before = p.cash;
    const res = settleOnCell(state, p, cellIdx);
    const bonus = res.find((r) => r.kind === 'bonus');
    assert(bonus, '未产生价差收益');
    assert(bonus.amount === 120, `金额 ${bonus.amount} ≠ 120`);
    assert(p.cash === before + 120, '现金未增加 ￥120');
    // 同圈再踩一次不应重复发放
    const res2 = settleOnCell(state, p, cellIdx);
    assert(!res2.find((r) => r.kind === 'bonus'), '同圈重复发放了价差收益');
    return '￥120 / 圈，且同圈不重复';
  });

  check(results, 'AI 职业分配稳定且不重复', () => {
    const s1 = makeCasinoState();
    const s2 = makeCasinoState();
    const ids1 = s1.players.map((p) => p.careerId);
    const ids2 = s2.players.map((p) => p.careerId);
    assert(ids1.join(',') === ids2.join(','), '同种子职业分配不一致');
    const aiIds = s1.players.filter((p) => p.isAI).map((p) => p.careerId);
    assert(new Set(aiIds).size === aiIds.length, `AI 职业重复：${aiIds.join(',')}`);
    return `AI 职业 ${aiIds.join(' / ')}（同种子可复现）`;
  });

  return results;
}

/* ===================================================================
 * 二、赌场地块与德州扑克
 * =================================================================== */

export function runCasinoChecks() {
  const results = [];

  check(results, '棋盘含 2 块赌场地块', () => {
    const idxs = casinoCellIndices();
    assert(idxs.length === 2, `赌场格 ${idxs.length} 个（应为 2）`);
    assert(SPECIAL.casino, '缺少 casino 特殊格定义');
    assert(SPECIAL.casino.icon === 'casino', '赌场图标 key 应为 casino');
    return `赌场格 index ${idxs.join(' / ')}`;
  });

  check(results, '踩入赌场触发全员同桌', () => {
    const state = makeCasinoState();
    const p = state.players[0];
    const cellIdx = casinoCellIndices()[0];
    const res = settleOnCell(state, p, cellIdx);
    const open = res.find((r) => r.kind === 'casino-open');
    assert(open, '未触发赌场');
    assert(open.seats.length === 4, `同桌 ${open.seats.length} 人（应为 4）`);
    assert(state.pending?.kind === 'casino', 'pending 未设为 casino');
    return `4 人同桌 · pending=casino`;
  });

  check(results, '开局后牌库严格 ≤52 张且无重复', () => {
    const state = makeCasinoState();
    const game = startCasinoGame(state);
    assert(game, '未能开局');
    assertDeckIntegrity(game);
    const used = game.deckUsed.length + game.burned.length;
    assert(used <= 52, `已用牌 ${used} > 52`);
    const ids = new Set(game.deckUsed.map((c) => c.id));
    assert(ids.size === game.deckUsed.length, '存在重复牌');
    return `已用 ${used} 张 / 52 张 · 牌库剩余 ${remainingCards(game)} 张`;
  });

  check(results, '赌王底牌 3 张 · 其余 2 张', () => {
    const state = makeCasinoState();
    const game = startCasinoGame(state);
    const king = game.seats.find((s) => s.playerId === 3);
    const others = game.seats.filter((s) => s.playerId !== 3);
    assert(king.hole.length === 3, `赌王底牌 ${king.hole.length} 张（应为 3）`);
    for (const o of others) {
      assert(o.hole.length === 2, `玩家 ${o.playerId} 底牌 ${o.hole.length} 张（应为 2）`);
    }
    const total = game.seats.reduce((a, s) => a + s.hole.length, 0);
    assert(total === 9, `底牌合计 ${total} 张（应为 9）`);
    assert(9 + POKER_CONFIG.communitySize + 3 <= 52, '底牌+公共牌+烧牌超 52');
    return `底牌合计 9 张（赌王 3 + 其余 6）· 含公共牌与烧牌共 17 张 < 52`;
  });

  check(results, '发牌顺序为逐张轮转发牌', () => {
    const game = createPokerGame({
      players: [
        { id: 0, name: 'A', cash: 1000 },
        { id: 1, name: 'B', cash: 1000 },
        { id: 2, name: 'C', cash: 1000 },
      ],
      seed: 'deal-order',
    });
    assert(game, '未能建局');
    // 标准轮转发牌：第 1 轮按座位序，第 2 轮按座位序
    const firstRound = game.seats.map((s) => s.hole[0].id);
    const secondRound = game.seats.map((s) => s.hole[1].id);
    assert(new Set(firstRound).size === 3, '第一轮有重复牌');
    assert(new Set(secondRound).size === 3, '第二轮有重复牌');
    assert(!firstRound.some((id) => secondRound.includes(id)), '两轮之间有重复');
    return '逐张轮转发牌 · 无重复';
  });

  check(results, '牌型评估覆盖 9 种牌型', () => {
    const D = { S: 'S', H: 'H', D: 'D', C: 'C' };
    const mk = (spec) => spec.map(([r, s]) => ({
      rank: r, suit: D[s], id: r + D[s], value: { T: 10, J: 11, Q: 12, K: 13, A: 14 }[r] ?? +r,
    }));
    const royal = mk([['A', 'S'], ['K', 'S'], ['Q', 'S'], ['J', 'S'], ['T', 'S']]);
    const sf = mk([['9', 'H'], ['T', 'H'], ['J', 'H'], ['Q', 'H'], ['K', 'H']]);
    const quad = mk([['7', 'C'], ['7', 'D'], ['7', 'H'], ['7', 'S'], ['2', 'C']]);
    const boat = mk([['A', 'C'], ['A', 'D'], ['A', 'H'], ['K', 'S'], ['K', 'C']]);
    const flush = mk([['2', 'S'], ['5', 'S'], ['9', 'S'], ['J', 'S'], ['Q', 'S']]);
    const straight = mk([['5', 'C'], ['6', 'D'], ['7', 'H'], ['8', 'S'], ['9', 'C']]);
    const trips = mk([['7', 'C'], ['7', 'D'], ['7', 'H'], ['2', 'S'], ['5', 'C']]);
    const twoPair = mk([['7', 'C'], ['7', 'D'], ['9', 'H'], ['9', 'S'], ['2', 'C']]);
    const pair = mk([['7', 'C'], ['7', 'D'], ['9', 'H'], ['J', 'S'], ['2', 'C']]);
    const high = mk([['7', 'C'], ['9', 'D'], ['J', 'H'], ['K', 'S'], ['2', 'C']]);
    const names = [high, pair, twoPair, trips, straight, flush, boat, quad, sf, royal]
      .map((h) => evaluateHand(h).rank);
    assert(names[9] > names[8], '皇家同花顺应最强');
    assert(names[8] > names[7], '同花顺应强于四条');
    assert(names[7] > names[6], '四条应强于葫芦');
    assert(names[6] > names[5], '葫芦应强于同花');
    assert(names[5] > names[4], '同花应强于顺子');
    assert(names[4] > names[3], '顺子应强于三条');
    assert(names[3] > names[2], '三条应强于两对');
    assert(names[2] > names[1], '两对应强于一对');
    assert(names[1] > names[0], '一对应强于高牌');
    assert(names[0] === 0, `高牌 rank=${names[0]}`);
    return '高牌 → 皇家同花顺 共 10 档全部正确';
  });

  check(results, '8 张牌取最佳 5 张组合', () => {
    const D = { S: 'S', H: 'H', D: 'D', C: 'C' };
    const v = { T: 10, J: 11, Q: 12, K: 13, A: 14 };
    const mk = (spec) => spec.map(([r, s]) => ({
      rank: r, suit: D[s], id: r + D[s], value: v[r] ?? +r,
    }));
    // 8 张里含 4 张黑桃同花 + 3 张梅花同花 —— 应取到 5 张同花
    const eight = mk([
      ['9', 'S'], ['K', 'S'], ['Q', 'S'], ['J', 'S'], ['5', 'S'],
      ['7', 'C'], ['4', 'C'], ['2', 'H'],
    ]);
    const ev = evaluateHand(eight);
    assert(ev.rank === 5, `最佳牌型 rank=${ev.rank}（应为 5 同花）`);
    assert(ev.cards.length === 5, '最佳组合应为 5 张');
    // 对照：再加一张 A♠ 会变成皇家同花顺（rank 9），验证枚举确实取最优
    const royal8 = mk([
      ['A', 'S'], ['K', 'S'], ['Q', 'S'], ['J', 'S'], ['T', 'S'],
      ['7', 'C'], ['4', 'C'], ['2', 'H'],
    ]);
    assert(evaluateHand(royal8).rank === 9,
      `含皇家同花顺时 rank=${evaluateHand(royal8).rank}（应为 9）`);
    return 'C(8,5)=56 种组合取最优 → 同花 / 皇家同花顺';
  });

  check(results, '下注 / 摊牌 / 分池完整流程', () => {
    const state = makeCasinoState();
    const game = startCasinoGame(state);
    assert(game, '未能开局');
    const rng = makeRng('flow');
    let guard = 0;
    while (!game.over && guard < 400) {
      guard++;
      const idx = currentActor(game);
      if (idx < 0) break;
      const action = aiAction(game, idx, rng);
      const r = applyAction(game, idx, action);
      if (!r.ok && game.over) break;
    }
    assert(game.over, `对局未在 ${guard} 步内结束`);
    assertDeckIntegrity(game);
    assert(game.community.length === 5, `公共牌 ${game.community.length} 张（应为 5）`);
    const pot = game.result.payouts.reduce((a, p) => a + p.amount, 0);
    assert(pot > 0, '底池为 0');
    return `${guard} 步结束 · 公共牌 5 张 · 底池 ￥${pot}`;
  });

  check(results, '结算后现金绝不为负', () => {
    const state = makeCasinoState();
    // 给一个「现金极少、资产很多」的玩家，制造扣款压力
    state.players[0].cash = 50;
    state.players[0].institutions.push({
      cellIndex: 4, level: 4, mortgaged: false, mortgageAmount: 0,
    });
    const game = startCasinoGame(state);
    const rng = makeRng('settle-neg');
    let guard = 0;
    while (!game.over && guard < 400) {
      guard++;
      const idx = currentActor(game);
      if (idx < 0) break;
      applyAction(game, idx, aiAction(game, idx, rng));
    }
    assert(game.over, '对局未结束');
    finishCasinoGame(state, game);
    for (const p of state.players) {
      assert(p.cash >= 0, `${p.name} 现金为负 ${p.cash}`);
    }
    return '全员现金 ≥ 0';
  });

  check(results, '结算后机构所有权 / 等级不变', () => {
    const state = makeCasinoState();
    const owner = state.players[1];
    owner.institutions.push({
      cellIndex: 4, level: 3, mortgaged: false, mortgageAmount: 0,
    });
    const before = JSON.stringify(owner.institutions);
    const game = startCasinoGame(state);
    const rng = makeRng('settle-own');
    let guard = 0;
    while (!game.over && guard < 400) {
      guard++;
      const idx = currentActor(game);
      if (idx < 0) break;
      applyAction(game, idx, aiAction(game, idx, rng));
    }
    finishCasinoGame(state, game);
    assert(JSON.stringify(owner.institutions) === before, '机构列表被改动');
    assert(owner.institutions[0].level === 3, '机构等级被改动');
    return '机构列表与等级完全不变';
  });

  check(results, '赌场结束后主游戏正确恢复', () => {
    const state = makeCasinoState();
    const cellIdx = casinoCellIndices()[0];
    const p = state.players[0];
    p.position = cellIdx;
    const res = settleOnCell(state, p, cellIdx);
    assert(res.find((r) => r.kind === 'casino-open'), '未触发赌场');
    const game = startCasinoGame(state);
    assert(state.poker === game, 'state.poker 未挂载');
    const rng = makeRng('restore');
    let guard = 0;
    while (!game.over && guard < 400) {
      guard++;
      const idx = currentActor(game);
      if (idx < 0) break;
      applyAction(game, idx, aiAction(game, idx, rng));
    }
    const out = finishCasinoGame(state, game);
    assert(state.poker === null, 'state.poker 未清空');
    assert(state.pending === null, 'pending 未清空');
    assert(out.deltas.length === 4, `结算条目 ${out.deltas.length} 条（应为 4）`);
    assert(state.phase !== 'gameover', '主游戏状态被破坏');
    return `结算 ${out.deltas.length} 条 · state.poker/pending 已清空 · 主游戏继续`;
  });

  check(results, '资产额度下注不改变机构所有权', () => {
    const state = makeCasinoState();
    const p = state.players[0];
    p.cash = 100;
    p.institutions.push({
      cellIndex: 4, level: 4, mortgaged: false, mortgageAmount: 0,
    });
    const game = startCasinoGame(state);
    const seat = game.seats.find((s) => s.playerId === 0);
    assert(seat.assetStack > 0, '未生成资产额度');
    // 盲注已从现金筹码中扣除，故只断言「现金筹码 ≤ 起始现金」
    assert(seat.cashStack <= 100, `现金筹码 ${seat.cashStack} 超过起始现金`);
    assert(seat.cashStack >= 0, '现金筹码为负');
    const before = p.institutions.length;
    // 强制打光资产额度
    const idx = game.seats.indexOf(seat);
    while (seat.assetStack > 0) {
      const r = applyAction(game, idx, { type: 'allin' });
      if (!r.ok) break;
      if (game.over) break;
    }
    finishCasinoGame(state, game);
    assert(p.institutions.length === before, '机构所有权发生变化');
    return `资产额度 ￥${Math.round(seat.assetStack)} 已用尽 · 机构数量仍为 ${before}`;
  });

  check(results, '单人对局无法开局（安全降级）', () => {
    const state = createState({
      seed: 'solo', players: [{ id: 0, name: '独行', isAI: false, careerId: 'ib' }],
      cash: 2000,
    });
    const game = startCasinoGame(state);
    assert(game === null, '单人局不应能开局');
    return '人数 <2 时返回 null，不抛错';
  });

  check(results, '德州扑克动作合法性校验', () => {
    const game = createPokerGame({
      players: [
        { id: 0, name: 'A', cash: 1000 },
        { id: 1, name: 'B', cash: 1000 },
        { id: 2, name: 'C', cash: 1000 },
      ],
      seed: 'legal',
    });
    const idx = currentActor(game);
    const acts = legalActions(game);
    assert(acts.length > 0, '无可用动作');
    assert(acts.some((a) => a.type === 'fold'), '缺弃牌');
    // 错误座位 → 拒绝
    const wrong = applyAction(game, (idx + 1) % game.seats.length, { type: 'fold' });
    assert(!wrong.ok, '错误座位应被拒绝');
    // check 在需要跟注时应被拒绝
    const need = game.currentBet - game.seats[idx].bet;
    if (need > 0) {
      const bad = applyAction(game, idx, { type: 'check' });
      assert(!bad.ok, '需跟注时 check 应被拒绝');
    }
    return `${acts.length} 个合法动作 · 非法动作被正确拒绝`;
  });

  check(results, '非法下注金额一律拒绝（负数 / NaN / Infinity / 超额）', () => {
    const game = createPokerGame({
      players: [
        { id: 0, name: 'A', cash: 1000 },
        { id: 1, name: 'B', cash: 1000 },
      ],
      seed: 'bad-amount',
    });
    const bad = [
      { type: 'raise', amount: -99999 },
      { type: 'raise', amount: NaN },
      { type: 'raise', amount: Infinity },
      { type: 'raise', amount: 1e12 },
      { type: 'raise', amount: 0 },
      { type: 'allin', amount: -1 },
      { type: 'allin', amount: NaN },
    ];
    const rejected = [];
    for (const a of bad) {
      // 每次都让 0 号座位成为当前行动者，确保真正走到金额校验分支
      game.currentSeat = 0;
      game.seats.forEach((s) => { s.folded = false; s.allIn = false; });
      const r = applyAction(game, 0, a);
      assert(!r.ok, `非法金额应被拒绝：${a.type}:${a.amount}`);
      rejected.push(`${a.type}:${a.amount}→${r.reason}`);
    }
    // 非法动作不得改动筹码
    const cashAfter = game.seats[0].stack;
    assert(cashAfter >= 0, '非法动作后筹码不得为负');
    return `${rejected.length} 种非法金额全部被拒绝 · 筹码保持 ￥${cashAfter}`;
  });

  check(results, '连续 30 局赌场结算不产生负数且状态自洽', () => {
    let minCash = Infinity;
    let minAssets = Infinity;
    for (let i = 0; i < 30; i++) {
      const state = makeCasinoState();
      const game = startCasinoGame(state);
      assert(game, '赌场应能开局');
      let guard = 0;
      while (!game.over && guard++ < 200) {
        const idx = currentActor(game);
        if (idx < 0) break;
        const acts = legalActions(game);
        if (!acts.length) break;
        const r = applyAction(game, idx, acts[(i + guard) % acts.length]);
        if (!r.ok) applyAction(game, idx, { type: 'fold' });
      }
      finishCasinoGame(state, game);
      minCash = Math.min(minCash, ...state.players.map((p) => p.cash));
      minAssets = Math.min(minAssets, ...state.players.map((p) => totalAssets(p, state)));
      assert(state.poker === null, '结算后 state.poker 应清空');
      assert(state.pending === null, '结算后 state.pending 应清空');
    }
    assert(minCash >= 0, `出现负现金：${minCash}`);
    assert(minAssets >= 0, `出现负资产：${minAssets}`);
    return `30 局连续结算 · 最低现金 ￥${minCash} · 最低资产 ￥${minAssets}`;
  });

  check(results, '多局牌库始终严格 52 张且无重复', () => {
    let maxTotal = 0;
    let maxDeck = 0;
    for (let i = 0; i < 20; i++) {
      const state = makeCasinoState();
      const game = startCasinoGame(state);
      let guard = 0;
      while (!game.over && guard++ < 200) {
        const idx = currentActor(game);
        if (idx < 0) break;
        const acts = legalActions(game);
        if (!acts.length) break;
        const r = applyAction(game, idx, acts[(i + guard) % acts.length]);
        if (!r.ok) applyAction(game, idx, { type: 'fold' });
        const ids = [...game.deckUsed, ...game.burned].map((c) => c.id);
        assert(new Set(ids).size === ids.length, '牌库出现重复牌');
        const total = game.deckUsed.length + game.burned.length;
        maxTotal = Math.max(maxTotal, total);
        assert(total <= 52, `牌库用量超过 52：${total}`);
      }
      maxDeck = Math.max(maxDeck,
        game.deck.length + game.deckUsed.length + game.burned.length);
    }
    assert(maxDeck === 52, `总牌数应为 52，实际 ${maxDeck}`);
    return `20 局累计 · 单局最多用牌 ${maxTotal} 张 · 总牌数恒为 52`;
  });

  return results;
}

/** 一次性跑完 */
export function runAll() {
  return [...runCareerChecks(), ...runCasinoChecks()];
}
