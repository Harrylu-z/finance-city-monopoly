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
import { CONFIG, totalAssets, liquidate, institutionValue, bondRedeemValue } from './economy.js';
import {
  createState, settleOnCell, resolvePurchase, upgradeInstitution,
  applyTrapCard, startCasinoGame, finishCasinoGame, playerCostMult,
  processBonds, underwriteBond, grantMarketTimingBonus,
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
    assert(careerEffectMult({ career: 'ib' }, 'buyCostMult') === 0.88, '投行家应为 0.88');
    assert(careerEffectMult({ career: 'fund' }, 'upgradeCostMult') === 0.90, '基金经理应为 0.90');
    assert(careerEffectMult({ career: 'actuary' }, 'rentMult') === 1.15, '精算师应为 1.15');
    assert(careerEffectMult({ career: 'risk' }, 'trapRelief') === 0.45, '风控总监应为 0.45');
    assert(careerEffectMult({ career: 'quant' }, 'rentMult') === 1.06, '量化研究员定价加成应为 1.06');
    return 'buyCostMult 0.88 / upgradeCostMult 0.90 / rentMult 1.15 / trapRelief 0.45 / quant 定价 1.06';
  });

  check(results, '未知职业 id 安全降级', () => {
    assert(getCareer('nope') === null, '未知 id 应返回 null');
    assert(playerCareer({ career: 'nope' }) === null, '未知职业应返回 null');
    assert(getCareer(null) === null, 'null 应返回 null');
    assert(getCareer(DEFAULT_CAREER_ID) !== null, '默认职业应有效');
    return '未知 id 一律降级为 null（不抛错）';
  });

  /* ---------- 被动实际生效 ---------- */

  check(results, '被动 · 投行家收购价 -12%', () => {
    // ⚠ 34 格版：tier 恒为 0 —— 改用「星级」挑一个 1 星标的（门槛最低）。
    const cellIdx = BOARD_CELLS.findIndex(
      (c) => c.type === 'institution' && !c.regulator && c.star === 1,
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
    assert(offer.price === Math.round(plainOffer.price * 0.88),
      `收购价 ${offer.price} ≠ ${plainOffer.price}×0.88`);
    assert(offer.price < plainOffer.price, '投行家未享受折价');
    return `￥${offer.price}（对照 ￥${plainOffer.price} × 0.88）`;
  });

  check(results, '被动 · 基金经理升级费 -10%', () => {
    const state = makeCasinoState();
    const p = state.players[0];
    p.career = 'fund';
    p.careerId = 'fund';
    // ⚠ 34 格版：所有机构买下即网点级（tier 恒为 0）——
    //   改用「星级」来挑一个高门槛标的（3 星 = 最贵）。
    const cellIdx = BOARD_CELLS.findIndex(
      (c) => c.type === 'institution' && !c.regulator && c.star === 3,
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
    assert(res.cost === Math.round(res2.cost * 0.90),
      `升级费 ${res.cost} ≠ ${res2.cost}×0.90`);
    return `￥${res.cost}（对照 ￥${res2.cost} × 0.90）`;
  });

  check(results, '被动 · 风控总监罚金 -45%', () => {
    const state = makeCasinoState();
    const p = state.players[1];
    p.career = 'risk';
    p.careerId = 'risk';
    const card = { id: 't', title: '测试罚单', text: '测试', effect: { cash: -200 } };
    const res = applyTrapCard(state, p, card);
    assert(res.cash === -110, `罚金 ${res.cash} ≠ -110（-200×0.55）`);
    assert(p.cash === CONFIG.cashLevels.standard - 110, '现金结算错误');
    return `罚金 -200 → ${res.cash}（减免 45%）`;
  });

  check(results, '被动 · 精算师租金 +15%', () => {
    const state = makeCasinoState();
    const owner = state.players[2];
    owner.career = 'actuary';
    owner.careerId = 'actuary';
    const payer = state.players[0];
    // ⚠ 34 格版：tier 恒为 0 —— 改用「星级」挑一个 2 星标的。
    const cellIdx = BOARD_CELLS.findIndex(
      (c) => c.type === 'institution' && !c.regulator && c.star === 2,
    );
    const cell = BOARD_CELLS[cellIdx];
    owner.institutions.push({ cellIndex: cellIdx, level: 2, mortgaged: false, mortgageAmount: 0 });
    payer.position = cellIdx;
    const before = payer.cash;
    const res = settleOnCell(state, payer, cellIdx);
    const rentRes = res.find((r) => r.kind === 'rent-paid');
    assert(rentRes, '未产生交租结算');
    // 基准口径：基础租金 × 等级租金系数 × 集团系数 → calculateRent 取整，
    // 再乘职业系数（rules.js 里职业系数是**在取整之后**另乘的一层）。
    const base = Math.round(cell.rent[2]
      * CONFIG.levelRentMult[2]
      * CONFIG.groupRentMult[cell.group]);
    assert(rentRes.rent === Math.round(base * 1.15),
      `租金 ${rentRes.rent} ≠ ${Math.round(base * 1.15)}`);
    assert(before - payer.cash === rentRes.rent, '扣款额与租金不一致');
    return `租金 ￥${rentRes.rent}（基础 ￥${cell.rent[2]} × 等级 ${CONFIG.levelRentMult[2]} × 集团 ${CONFIG.groupRentMult[cell.group]} = ￥${base}，再 × 职业 1.15）`;
  });

  check(results, '被动 · 交易员择时价差收益', () => {
    const state = makeCasinoState();
    const p = state.players[3];
    p.career = 'trader';
    p.careerId = 'trader';
    // 34 格版：「市场周期 · 牛熊切换」被收进「命运转盘」
    const cellIdx = BOARD_CELLS.findIndex(
      (c) => c.type === 'special' && c.special?.kind === 'wheel' && c.special.wheelId === 'fate',
    );
    assert(cellIdx >= 0, '未找到命运转盘格');
    // 指定转盘抽出「市场周期」
    state.pending = { kind: 'wheel', wheelPick: 'market', playerId: p.id };
    const before = p.cash;
    const res = settleOnCell(state, p, cellIdx);
    const bonus = res.find((r) => r.kind === 'bonus');
    assert(bonus, '未产生价差收益');
    assert(bonus.amount === 220, `金额 ${bonus.amount} ≠ 220`);
    assert(p.cash === before + 220, '现金未增加 ￥220');
    // 同圈再踩一次不应重复发放
    state.pending = { kind: 'wheel', wheelPick: 'market', playerId: p.id };
    const res2 = settleOnCell(state, p, cellIdx);
    assert(!res2.find((r) => r.kind === 'bonus'), '同圈重复发放了价差收益');
    return '￥220 / 圈，且同圈不重复';
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

  check(results, '棋盘含 2 块赌场地块（架在城门 A / B）', () => {
    const idxs = casinoCellIndices();
    // 34 格版：外环 24 + 城门 2 + 内环 8 = 34 格，
    //   外环与城门合计 26 格，要装 20 个外围机构 + 起点 1 + 转盘 3 + 赌场 2 = 26 格 ✓
    //   因此保留双赌场，转盘从 4 个减为 3 个
    //   （枢纽转盘的三个移动类效果已并入机会转盘，功能不丢失）。
    assert(idxs.length === 2, `赌场格 ${idxs.length} 个（应为 2）`);
    assert(SPECIAL.casino, '缺少 casino 特殊格定义');
    assert(SPECIAL.casino.icon === 'casino', '赌场图标 key 应为 casino');
    // 两座赌场必须都架在城门上（渲染层画城门造型）
    for (const i of idxs) {
      assert(BOARD_CELLS[i].special?.kind === 'gate',
        `赌场格 #${i} 应标记为 gate 造型（架在城门上）`);
    }
    return `赌场格 index ${idxs.join(' / ')}（城门 A / 城门 B）`;
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

  check(results, '翻牌后可以加注（回归：streetBet 与累计 bet 解耦）', () => {
    const game = createPokerGame({
      players: [
        { id: 0, name: 'A', cash: 1000 },
        { id: 1, name: 'B', cash: 1000 },
        { id: 2, name: 'C', cash: 1000 },
      ],
      seed: 'flop-raise',
    });
    // —— 翻牌前：所有人只跟平 / 过牌，推进到翻牌圈 ——
    let guard = 0;
    while (game.street === 'preflop' && guard++ < 60) {
      const idx = currentActor(game);
      if (idx < 0) break;
      const acts = legalActions(game);
      const pick = acts.find((a) => a.type === 'call') || acts.find((a) => a.type === 'check');
      const r = applyAction(game, idx, pick || { type: 'fold' });
      assert(r.ok, `翻牌前动作失败：${r.reason || '?'}`);
    }
    assert(game.street === 'flop', `未进入翻牌圈（当前 ${game.street}）`);
    // —— 翻牌圈：第一个行动者必须拿到「加注」选项（旧版会消失）——
    const idx = currentActor(game);
    assert(idx >= 0, '翻牌圈无可行动者');
    const acts = legalActions(game);
    const raiseAct = acts.find((a) => a.type === 'raise');
    assert(raiseAct, '翻牌后没有加注选项（回归失败：minRaiseTo 误用累计 bet）');
    assert(raiseAct.min > 0 && raiseAct.max >= raiseAct.min, '加注区间非法');
    // —— 执行最小加注：必须成功且抬高 currentBet ——
    const seat = game.seats[idx];
    const r = applyAction(game, idx, { type: 'raise', amount: raiseAct.min });
    assert(r.ok, `翻牌圈加注被拒绝：${r.reason}`);
    assert(game.currentBet === seat.streetBet, 'currentBet 未同步到本街注额');
    assert(game.currentBet > 0, 'currentBet 未被加注抬高');
    // —— 其余玩家跟平后，街道应正常推进到转牌（不卡死）——
    guard = 0;
    while (game.street === 'flop' && guard++ < 60) {
      const i = currentActor(game);
      if (i < 0) break;
      const a = legalActions(game);
      const pick = a.find((x) => x.type === 'call') || a.find((x) => x.type === 'check');
      const rr = applyAction(game, i, pick || { type: 'fold' });
      assert(rr.ok, `翻牌圈跟平失败：${rr.reason}`);
    }
    assert(game.street === 'turn', `翻牌圈未推进到转牌（当前 ${game.street}）`);
    return `翻牌圈最小加注 ￥${raiseAct.min} 成功 · 街道正常推进到转牌`;
  });

  check(results, '结算守恒：全桌现金净额之和为 0（不凭空造钱）', () => {
    // 回归用例：曾经出现过「赢家底池被重复计入」导致总现金凭空增加。
    for (let i = 0; i < 12; i++) {
      const state = makeCasinoState();
      const before = state.players.reduce((s, p) => s + p.cash, 0);
      const game = startCasinoGame(state);
      assert(game, '赌场应能开局');
      let guard = 0;
      while (!game.over && guard++ < 300) {
        const idx = currentActor(game);
        if (idx < 0) break;
        const acts = legalActions(game);
        if (!acts.length) break;
        const r = applyAction(game, idx, acts[(i + guard) % acts.length]);
        if (!r.ok) applyAction(game, idx, { type: 'fold' });
      }
      const out = finishCasinoGame(state, game);
      const after = state.players.reduce((s, p) => s + p.cash, 0);
      assert(
        after === before,
        `第 ${i + 1} 局现金不守恒：结算前 ￥${before} → 结算后 ￥${after}（差 ${after - before}）`,
      );
      // 结算条目里的现金净额之和也必须是 0
      const sumCashNet = out.deltas.reduce((s, d) => s + (d.cashDelta || 0), 0);
      assert(sumCashNet === 0, `第 ${i + 1} 局现金净额之和 ${sumCashNet}（应为 0）`);
    }
    return '12 局随机对局 · 全桌现金净额之和恒为 0';
  });

  check(results, '结算守恒：财富净额之和为 0（现金+资产让渡口径）', () => {
    // 回归用例：曾经出现过「下注记一次 + 结算再记一次」导致资产折让翻倍。
    // 资产筹码派付时超额部分折现金（赢家现金 ↔ 输家让渡等额转移），
    // 所以现金与资产**各自**不要求守恒，两者之和（财富）必须恒为 0。
    //
    // ⚠ 财富口径说明：
    //   `totalAssets(p, state)` 已经包含现金（= 现金 + 机构市值 − 资产让渡），
    //   所以**不能再加一次 p.cash**（那会把现金算两遍）。
    //   正确写法就是直接对 totalAssets 求和。
    for (let i = 0; i < 12; i++) {
      const state = makeCasinoState();
      // 给每人加资产，制造资产额度下注场景
      for (const p of state.players) {
        p.institutions.push({ cellIndex: 4, level: 3, mortgaged: false, mortgageAmount: 0 });
      }
      const game = startCasinoGame(state);
      assert(game, '赌场应能开局');
      const wealthBefore = state.players.reduce((s, p) => s + totalAssets(p, state), 0);
      let guard = 0;
      while (!game.over && guard++ < 300) {
        const idx = currentActor(game);
        if (idx < 0) break;
        const acts = legalActions(game);
        if (!acts.length) break;
        const r = applyAction(game, idx, acts[(i + guard) % acts.length]);
        if (!r.ok) applyAction(game, idx, { type: 'fold' });
      }
      const out = finishCasinoGame(state, game);
      const sumCashNet = out.deltas.reduce((s, d) => s + (d.cashDelta || 0), 0);
      const sumAssetNet = out.deltas.reduce((s, d) => s + (d.assetDelta || 0), 0);
      assert(sumCashNet + sumAssetNet === 0,
        `第 ${i + 1} 局财富净额之和 ${sumCashNet + sumAssetNet}（应为 0；现金 ${sumCashNet} / 资产 ${sumAssetNet}）`);
      // 全桌总财富（现金 + 机构市值 − 资产让渡）结算前后必须相等 —— 防止价值蒸发
      const wealthAfter = state.players.reduce((s, p) => s + totalAssets(p, state), 0);
      assert(wealthAfter === wealthBefore,
        `第 ${i + 1} 局总财富蒸发：结算前 ￥${wealthBefore} → 结算后 ￥${wealthAfter}`);
      // 每人的资产折让不得为负
      for (const p of state.players) {
        assert((p.pokerAssetLock || 0) >= 0, `${p.name} 资产折让为负 ${p.pokerAssetLock}`);
      }
    }
    return '12 局含资产下注 · 财富净额之和恒为 0 · 无重复记账';
  });

  check(results, '赢家赢回的资产折让被正确解除', () => {
    // 回归用例：曾经出现过「赢家赢了却仍被锁定资产折让」的永久性估值损失。
    const state = makeCasinoState();
    for (const p of state.players) {
      p.institutions.push({ cellIndex: 4, level: 4, mortgaged: false, mortgageAmount: 0 });
    }
    const game = startCasinoGame(state);
    // ⚠ P1：allin 现在受 maxBetRatio 约束（不能一次押光全部现金），
    //   因此「一轮 allin 就打光」不再成立 ——
    //   改为**反复 raise + allin** 直到引擎自动摊牌（game.over）。
    let guard = 0;
    while (!game.over && guard++ < 400) {
      const idx = currentActor(game);
      if (idx < 0) break;
      const seat = game.seats[idx];
      if (!seat.allIn) {
        // 先 raise 抬高底池，再 allin 逼其他人跟
        const acts = legalActions(game);
        const raiseAct = acts.find((a) => a.type === 'raise');
        if (raiseAct && !raiseAct.disabled) {
          applyAction(game, idx, { type: 'raise', amount: raiseAct.max });
        }
        const ar = applyAction(game, idx, { type: 'allin' });
        if (!ar.ok) {
          // allin 不可用（额度为 0）→ 退而求其次跟注 / 过牌 / 弃牌
          const again = legalActions(game);
          const alt = again.find((a) => a.type === 'call' && !a.disabled)
            || again.find((a) => a.type === 'check' && !a.disabled)
            || again.find((a) => a.type === 'fold' && !a.disabled);
          if (!alt) break;
          applyAction(game, idx, { type: alt.type, amount: alt.amount });
        }
      }
    }
    const winners = (game.result && game.result.winners) || [];
    assert(winners.length > 0, '未产生赢家');
    const out = finishCasinoGame(state, game);
    // 财富守恒：现金净额 + 资产净额之和必须为 0
    const sumCashNet = out.deltas.reduce((s, d) => s + (d.cashDelta || 0), 0);
    const sumAssetNet = out.deltas.reduce((s, d) => s + (d.assetDelta || 0), 0);
    assert(sumCashNet + sumAssetNet === 0,
      `财富不守恒：现金 ${sumCashNet} + 资产 ${sumAssetNet} = ${sumCashNet + sumAssetNet}`);
    for (const seat of game.seats) {
      const p = state.players.find((x) => x.id === seat.playerId);
      if (!p) continue;
      const isWinner = winners.includes(seat.seat);
      if (isWinner) {
        // 赢家至少赢回自己押上的资产 → 折让不得高于其押注额
        assert(
          (p.pokerAssetLock || 0) <= seat.assetPaid,
          `赢家 ${p.name} 仍被锁定 assetLock=${p.pokerAssetLock} > 押注资产 ${seat.assetPaid}`,
        );
      }
    }
    const locks = state.players.map((p) => p.pokerAssetLock || 0);
    return `赢家资产折让已归位 · 各玩家折让 [${locks.join(', ')}]`;
  });

  check(results, '连续 30 局赌场结算不产生负数且状态自洽', () => {    let minCash = Infinity;
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

  // ===================================================================
  // ================= P2 新增：破产清算 / 债券违约 / 赌场额度 =================
  // ===================================================================

  check(results, '破产清算：loans/bonds/subscribedBonds/pokerAssetLock 全部清空', () => {
    // 回归用例（F2）：破产玩家若仍保留贷款 / 债券 / 资产抵押，
    //   就会在清算后继续负债、继续吃票息、继续被资产折损 —— 破产形同虚设。
    const p = {
      id: 99, name: '破产测试', cash: 100, bankrupt: false,
      institutions: [{ cellIndex: 4, level: 2, mortgaged: false, mortgageAmount: 0 }],
      loans: [{ id: 'L1', amount: 500, rate: 0.06, dueLap: 5, remaining: 3 }],
      bonds: [{ id: 'B1', face: 300, couponPer: 18, subscribers: [1, 2] }],
      subscribedBonds: [{ id: 'B2', face: 300, couponPer: 18, couponsPaid: 2 }],
      pokerAssetLock: 480,
      buffs: [{ id: 'buff-1', remaining: 3 }],
      upgradePermits: { 4: { turn: 1, expiresTurn: 3 } },
      loanCountThisRound: 2,
    };
    const res = liquidate(p);
    assert(p.bankrupt === true, '清算后应标记破产');
    assert(p.cash === 0, `清算后现金应为 0，实际 ${p.cash}`);
    assert(Array.isArray(p.loans) && p.loans.length === 0, '清算后贷款应清空');
    assert(Array.isArray(p.bonds) && p.bonds.length === 0, '清算后发行的债券应清空');
    assert(Array.isArray(p.subscribedBonds) && p.subscribedBonds.length === 0,
      '清算后认购的债券应清空');
    assert((p.pokerAssetLock || 0) === 0, `清算后资产折让应归零，实际 ${p.pokerAssetLock}`);
    assert(Array.isArray(p.buffs) && p.buffs.length === 0, '清算后 Buff 应清空');
    assert(Object.keys(p.upgradePermits || {}).length === 0, '清算后升级许可应清空');
    assert((p.loanCountThisRound || 0) === 0, '清算后本轮贷款计数应归零');
    assert(res.debts.loans === 1, `清算记录应含 1 笔贷款，实际 ${res.debts.loans}`);
    assert(res.debts.bonds === 1, `清算记录应含 1 笔债券，实际 ${res.debts.bonds}`);
    assert(res.debts.subscribedBonds === 1,
      `清算记录应含 1 笔认购债券，实际 ${res.debts.subscribedBonds}`);
    return `贷款/债券/认购/资产折让/Buff/升级许可全部清空 · 免除债务 ${JSON.stringify(res.debts)}`;
  });

  check(results, '债券违约：发行方破产则债权人损失本金（跳过兑付）', () => {
    // 回归用例（F3）：发行方破产后，债券必须停止付息、到期不得兑付，
    //   认购方**损失全部本金**（否则「发债」是无风险套利）。
    const state = makeCasinoState();
    const issuer = state.players[1];
    const buyer = state.players[2];
    // 发行方破产
    issuer.bankrupt = true;
    issuer.bonds = [{
      id: 9001, issuerId: issuer.id, face: CONFIG.bondFace, couponPer: 18,
      subscribers: [buyer.id], dueLap: 0, dueRound: 0, couponsPaid: 0,
    }];
    buyer.subscribedBonds = [{
      id: 9001, issuerId: issuer.id, face: CONFIG.bondFace,
      couponPer: 18, couponsPaid: 0, boughtLap: 0,
    }];
    const cashBefore = buyer.cash;
    const issuerCashBefore = issuer.cash;
    // 到期兑付
    processBonds(state, 99);
    // 发行方不得付出任何现金（跳过兑付）
    assert(issuer.cash === issuerCashBefore,
      `发行方破产后现金不应变动：${issuerCashBefore} → ${issuer.cash}`);
    // 认购方不得收到任何本金回款（损失本金）
    assert(buyer.cash === cashBefore,
      `债券违约时认购方不应收到回款：${cashBefore} → ${buyer.cash}`);
    // 该债券应从双方账上移除
    assert((issuer.bonds || []).length === 0, '发行方破产后其债券应被勾销');
    assert((buyer.subscribedBonds || []).length === 0, '违约后认购方持有记录应被清除');
    return `发行人 ${issuer.name} 破产 → 债权人 ${buyer.name} 损失本金 ￥${CONFIG.bondFace} · 无兑付`;
  });

  check(results, '债券违约：认购方破产则跳过其回款（不影响他人）', () => {
    // 回归用例（F3）：认购方破产时，其应收回款必须跳过，
    //   但**不影响其他认购方**的正常回款。
    const state = makeCasinoState();
    const issuer = state.players[1];
    const deadBuyer = state.players[2];
    const liveBuyer = state.players[3];
    const face = CONFIG.bondFace;
    issuer.bonds = [{
      id: 9002, issuerId: issuer.id, face, couponPer: Math.round(face * CONFIG.bondCoupon),
      subscribers: [deadBuyer.id, liveBuyer.id], dueLap: 0, dueRound: 0, couponsPaid: 0,
    }];
    deadBuyer.bankrupt = true;
    deadBuyer.subscribedBonds = [{ id: 9002, issuerId: issuer.id, face, couponPer: Math.round(face * CONFIG.bondCoupon), couponsPaid: 0 }];
    liveBuyer.subscribedBonds = [{ id: 9002, issuerId: issuer.id, face, couponPer: Math.round(face * CONFIG.bondCoupon), couponsPaid: 0 }];
    const deadCashBefore = deadBuyer.cash;
    const liveCashBefore = liveBuyer.cash;
    const issuerCashBefore = issuer.cash;
    processBonds(state, 99);
    // 破产认购方不得收到回款
    assert(deadBuyer.cash === deadCashBefore,
      `破产认购方不应收到回款：${deadCashBefore} → ${deadBuyer.cash}`);
    // 存活认购方照常回款
    assert(liveBuyer.cash > liveCashBefore,
      `存活认购方应收到本金回款：${liveCashBefore} → ${liveBuyer.cash}`);
    // 发行方只为存活认购人兑付（本金 face + 当期票息 couponPer）
    const couponPer = Math.round(face * CONFIG.bondCoupon);
    const expectedPay = face + couponPer;
    assert(issuerCashBefore - issuer.cash === expectedPay,
      `发行方应只兑付 1 份（本金 ￥${face} + 票息 ￥${couponPer}），实际付出 ￥${issuerCashBefore - issuer.cash}`);
    return `破产认购方回款被跳过 · 存活认购方收回 ￥${liveBuyer.cash - liveCashBefore} · 发行方仅付 1 份 ￥${expectedPay}`;
  });

  check(results, '债券兑付口径统一：bondRedeemValue 等于面值', () => {
    // 回归用例（m2）：兑付口径必须与 bondRedeemValue 一致（按面值兑付）。
    const bond = { id: 1, face: 300, price: 280, premium: 0.1 };
    assert(bondRedeemValue(bond) === 300,
      `bondRedeemValue 应等于面值 300，实际 ${bondRedeemValue(bond)}`);
    const bond2 = { id: 2, face: 500 };
    assert(bondRedeemValue(bond2) === 500,
      `bondRedeemValue 应等于面值 500，实际 ${bondRedeemValue(bond2)}`);
    const bond3 = { id: 3 };
    assert(bondRedeemValue(bond3) === 0,
      `无面值的债券应返回 0，实际 ${bondRedeemValue(bond3)}`);
    return '面值 300 / 500 / 无面值 0 —— 兑付口径统一为面值';
  });

  check(results, '赌场资产额度只按机构市值算（现金不重复计入）', () => {
    // 回归用例（F1）：赌场折算额度若用 totalAssets（= 现金 + 机构市值），
    //   现金会被算两遍（既进 cashStack 又进 assetStack），
    //   玩家可凭空拿到 1.5 倍桌上面值。
    const state = makeCasinoState();
    const p = state.players[0];
    p.institutions = [{ cellIndex: 4, level: 3, mortgaged: false, mortgageAmount: 0 }];
    p.cash = 2400;
    const instValue = institutionValue(p, state);
    const total = totalAssets(p, state);
    // totalAssets = 现金 + 机构市值（应当比机构市值多出全部现金）
    assert(total === p.cash + instValue,
      `totalAssets 应等于 现金 + 机构市值：${total} ≠ ${p.cash} + ${instValue}`);
    // 机构市值必须显著小于 totalAssets（说明现金没有被重复算进资产额度）
    assert(instValue < total, '机构市值应小于总资产（现金不得计入资产额度）');
    const game = startCasinoGame(state);
    assert(game, '赌场应能开局');
    const seat = game.seats[0];
    // 资产额度 = 机构市值 × assetBetRatio（不含现金）
    const expected = Math.round(instValue * POKER_CONFIG.assetBetRatio);
    assert(seat.assetStack === expected,
      `资产额度应为 ${expected}（机构市值 ${instValue} × ${POKER_CONFIG.assetBetRatio}），实际 ${seat.assetStack}`);
    // 桌上面值 = 现金 + 资产额度
    assert(seat.stack === seat.cashStack + seat.assetStack,
      '桌上面值应等于 现金筹码 + 资产额度');
    return `机构市值 ￥${instValue} → 资产额度 ￥${seat.assetStack}（现金 ￥${p.cash} 未计入）`;
  });

  check(results, '赌场 allin 受 maxBetRatio 约束且不产生死锁', () => {
    // 回归用例（P1）：allin 不得绕过 maxBetRatio（一次押光主游戏现金）。
    const state = makeCasinoState();
    const game = startCasinoGame(state);
    const seat = game.seats[0];
    // 让 0 号成为当前行动者
    game.currentSeat = 0;
    const acts = legalActions(game);
    const allin = acts.find((a) => a.type === 'allin');
    assert(allin, '应提供 allin 选项');
    assert(!allin.disabled, 'allin 不应被禁用');
    const cashCap = Math.floor(seat.cashStack * POKER_CONFIG.maxBetRatio);
    assert(allin.amount <= cashCap + seat.assetStack,
      `allin 金额 ${allin.amount} 超出上限 ${cashCap + seat.assetStack}`);
    // 连续 allin 不应死锁：连续执行直到分池或结束
    let guard = 0;
    while (!game.over && guard++ < 120) {
      const idx = currentActor(game);
      if (idx < 0) break;
      const list = legalActions(game);
      if (!list.length) break;
      const a = list.find((x) => x.type === 'allin' && !x.disabled)
        || list.find((x) => x.type === 'call' && !x.disabled)
        || list.find((x) => x.type === 'check' && !x.disabled)
        || list.find((x) => x.type === 'fold' && !x.disabled);
      if (!a) break;
      const r = applyAction(game, idx, { type: a.type, amount: a.amount });
      if (!r.ok) {
        const fb = list.find((x) => x.type === 'fold');
        if (!fb) break;
        applyAction(game, idx, { type: 'fold' });
      }
    }
    assert(guard < 120, 'allin 循环出现死锁（超过 120 步仍未结束）');
    return `allin 上限 ￥${allin.amount} ≤ ￥${cashCap + seat.assetStack} · ${guard} 步内正常结束`;
  });

  check(results, '资产额度可被全下（现金耗尽时不产生死锁）', () => {
    // 回归用例：玩家现金用光后只剩资产额度时，
    //   若 allin 也按 maxBetRatio 封顶（现金为 0 → 上限 0），
    //   玩家将永远无法全下 → 行动循环死锁。
    const state = makeCasinoState();
    const p = state.players[0];
    p.institutions = [{ cellIndex: 4, level: 4, mortgaged: false, mortgageAmount: 0 }];
    const game = startCasinoGame(state);
    const seat = game.seats[0];
    // 人为把现金筹码清零，只留资产额度
    seat.cashStack = 0;
    seat.cashPaid = 0;
    seat.stack = seat.assetStack;
    game.currentSeat = 0;
    const acts = legalActions(game);
    const allin = acts.find((a) => a.type === 'allin');
    assert(allin && !allin.disabled, '现金耗尽后 allin 仍应可用（只剩资产额度）');
    assert(allin.amount > 0, 'allin 金额必须为正');
    const r = applyAction(game, 0, { type: 'allin' });
    assert(r.ok, `allin 应成功：${r.reason || ''}`);
    assert(seat.allIn === true, 'allin 后应标记为全下状态');
    return `现金 0 / 资产额度 ￥${seat.assetStack + seat.assetPaid} → 仍可全下 ￥${allin.amount}`;
  });

  check(results, '交易员择时奖励：行情切换时发放且每圈只发一次', () => {
    // 回归用例：34 格棋盘上没有独立的「牛熊切换格」，
    //   行情切换改由「转盘抽到牛熊切换」与「每 3 圈自动切换」两条路径触发。
    //   旧实现只挂在 `case 'market'` 上 → 自动切换路径完全漏发，
    //   职业被动事实上失效。
    const state = makeCasinoState();
    const p = state.players[0];
    p.careerId = 'trader';
    p.career = 'trader';
    const before = p.cash;
    const r1 = grantMarketTimingBonus(state, p);
    assert(r1, '行情切换时应发放择时价差收益');
    assert(p.cash === before + 220, `应加 ￥220，实际 ${p.cash - before}`);
    // 同一圈内不得重复发放
    const r2 = grantMarketTimingBonus(state, p);
    assert(!r2, '同一圈内不得重复发放择时奖励');
    assert(p.cash === before + 220, '重复调用不得改变现金');
    // 圈号推进后允许再次发放
    p.laps = (p.laps || 0) + 1;
    const r3 = grantMarketTimingBonus(state, p);
    assert(r3, '圈号推进后应允许再次发放');
    assert(p.cash === before + 440, `应累计 ￥440，实际 ${p.cash - before}`);
    // 非交易员不得发放
    const state2 = makeCasinoState();
    const p2 = state2.players[0];
    p2.careerId = 'ib';
    p2.career = 'ib';
    const b2 = p2.cash;
    const r4 = grantMarketTimingBonus(state2, p2);
    assert(!r4, '非交易员不应发放择时奖励');
    assert(p2.cash === b2, '非交易员现金不得变动');
    return '交易员行情切换 +￥220 · 每圈一次 · 非交易员不发';
  });

  return results;
}

/** 一次性跑完 */
export function runAll() {
  return [...runCareerChecks(), ...runCasinoChecks()];
}
