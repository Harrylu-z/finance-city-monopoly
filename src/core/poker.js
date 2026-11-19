/**
 * 德州扑克小游戏引擎 —— 赌场地块专用。
 *
 * ================== 牌库约束（硬性）==================
 * 全局**只有一副 52 张牌**（52 = 4 花色 × 13 点数）。
 * 任何时点上，场上所有牌（所有玩家底牌 + 公共牌 + 已弃置的牌）之和
 * **绝不超过 52** —— 这由 `assertDeckIntegrity()` 在每次发牌后强制校验。
 *
 * 发牌策略（明确、可复核）：
 *   1. **底牌**：按「先手位 → 逆时针」每人一张、轮转发牌（标准德州扑克）。
 *      · 普通玩家底牌 2 张；「赌王」职业底牌 3 张（多 1 张）。
 *      · 底牌一次性发完，总数 = Σ(各玩家底牌数) ≤ 2×人数 + 1。
 *        4 人局最多 2×3+3 = 9 张，远小于 52。
 *   2. **公共牌**：翻牌 3 张 + 转牌 1 张 + 河牌 1 张 = 5 张。
 *      发牌前**烧牌**（burn）1 张 —— 标准做法，模拟真实牌局、
 *      也避免公共牌与底牌信息关联。总消耗 3 张烧牌。
 *   3. **弃牌策略**：弃牌的玩家，其底牌**不回收**（与真实牌局一致），
 *      但底牌本身已计入 52 张上限，不会额外占用。
 *   4. **不重复、不造牌**：所有牌来自 `buildDeck()` 生成的唯一 52 张。
 *
 * ================== 赌王「多一张底牌」的严谨性 ==================
 * 赌王多 1 张底牌 → 4 人局底牌合计 9 张（普通 8 张 + 1 张），
 * 加 5 张公共牌 + 3 张烧牌 = 17 张 < 52。
 * 即便 6 人局（4 普通 + 赌王）也只有 13 + 5 + 3 = 21 张 < 52。
 * 因此「所有玩家手牌总和超过 52」在本引擎中**不可能发生**，
 * 且由 `assertDeckIntegrity()` 在运行时持续断言。
 *
 * ================== 下注模型 ==================
 * 玩家在赌桌上有独立的「桌上面值（筹码）」与「投注额」。
 * 结算时：
 *   · 赢家拿走底池（含自己投入的部分）；
 *   · 输家从**现金**中扣除投注额 —— 但**最多扣到现金为 0**，
 *     不足部分记为「抵押敞口」，由 `settlePoker` 转成对玩家资产的
 *     **被动估值折让**（不产生负数、不破坏主游戏状态）。
 *   · 玩家也可以用**资产**下注：下注前先把机构按 `assetValue` 折算成
 *     「抵押额度」，直接从额度里扣款 —— 资产所有权不变、估值不重复计算，
 *     结算后现金与资产估值同时回补，保证总资产守恒。
 *
 * ================== 结算口径（逐座位下注结构）==================
 * 底池里混有「现金筹码」与「资产筹码」两种成分。结算时**按每个座位
 * 实际的下注结构**（cashPaid / assetPaid / bet）拆解派彩：
 *   · **先归本**：每个座位赢回自己押进去的部分，
 *     并按**该座位自己的**现金 / 资产结构拆分：
 *     现金部分原路回到现金，资产部分解除等额 `pokerAssetLock`（让渡归位）；
 *   · **再算净赢**：超出自己下注的部分来自别人的筹码 ——
 *     别人押的现金以现金派付；别人押的资产因**所有权不转移**，
 *     折成**等额现金**派付，同时对手的资产让渡照扣（两侧等额转移）。
 *
 * ⚠ 早期版本用「全局 assetShare」（底池中资产筹码占比）拆每个座位的派彩。
 *   那在「人人下注比例相同」时恰好正确，但结构不成立 ——
 *   重仓资产者与纯现金者同桌时，会凭空制造/销毁价值。
 *   现在改为逐座位拆解，全桌「现金净额 + 资产净额」（财富口径）恒为 0。
 */

import { makeRng } from './rng.js';

/* ===================================================================
 * 常量
 * =================================================================== */

export const POKER_CONFIG = {
  /** 牌库总张数（硬约束） */
  deckSize: 52,
  /** 公共牌张数 */
  communitySize: 5,
  /** 每个普通玩家的底牌数 */
  holeCards: 2,
  /** 赌王额外底牌数 */
  kingExtraHole: 1,
  /** 盲注 */
  smallBlind: 20,
  bigBlind: 40,
  /** 最低加注单位（一个大盲） */
  raiseUnit: 40,
  /** 单注上限（占玩家现金比例上限，防止一把梭哈毁掉主游戏） */
  maxBetRatio: 0.35,
  /** 资产下注折算率（机构市值 → 可下注额度） */
  assetBetRatio: 0.5,
  /** 连续加注次数上限（防止无限加注） */
  maxRaises: 4,
};

/** 花色 */
const SUITS = ['S', 'H', 'D', 'C'];
/** 点数（2..10 用数字，J/Q/K/A 用字母） */
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];

/** 点数值 */
const RANK_VALUE = {
  '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9,
  'T': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14,
};

/** 花色中文名 */
export const SUIT_NAME = { S: '黑桃', H: '红桃', D: '方块', C: '梅花' };

/** 牌型（数值越大越强） */
export const HAND_RANKS = {
  HIGH_CARD: 0,
  ONE_PAIR: 1,
  TWO_PAIR: 2,
  THREE_KIND: 3,
  STRAIGHT: 4,
  FLUSH: 5,
  FULL_HOUSE: 6,
  FOUR_KIND: 7,
  STRAIGHT_FLUSH: 8,
  ROYAL_FLUSH: 9,
};

/** 牌型中文名 */
export const HAND_NAMES = {
  0: '高牌', 1: '一对', 2: '两对', 3: '三条', 4: '顺子',
  5: '同花', 6: '葫芦', 7: '四条', 8: '同花顺', 9: '皇家同花顺',
};

/* ===================================================================
 * 牌库
 * =================================================================== */

/**
 * 构建唯一的一副 52 张牌（顺序确定性，可复现）。
 * @returns {Array<{rank:string, suit:string, id:string, value:number}>}
 */
export function buildDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ rank, suit, id: `${rank}${suit}`, value: RANK_VALUE[rank] });
    }
  }
  return deck;
}

/** 牌 → 中文名（用于 UI / 播报） */
export function cardLabel(card) {
  if (!card) return '—';
  const r = { T: '10', J: 'J', Q: 'Q', K: 'K', A: 'A' }[card.rank] || card.rank;
  return `${SUIT_NAME[card.suit]}${r}`;
}

/* ===================================================================
 * 牌力评估
 * =================================================================== */

/**
 * 评估 5 张（或更多）牌的牌力。
 *
 * @param {Array} cards 牌数组（≥5 张时取最佳 5 张组合）
 * @returns {{rank:number, name:string, cards:Array, tiebreak:Array}}
 */
export function evaluateHand(cards) {
  const list = (cards || []).filter(Boolean);
  if (list.length < 5) {
    return { rank: -1, name: '未成牌', cards: list.slice(0, 5), tiebreak: [] };
  }
  // 5 张直接评估；6/7/8 张枚举所有 5 张组合取最优
  if (list.length === 5) return evalFive(list);
  let best = null;
  const n = list.length;
  const idx = [];
  for (let i = 0; i < 5; i++) idx.push(i);
  // 组合枚举（n ≤ 8，C(8,5)=56，完全可接受）
  const combos = [];
  const rec = (start) => {
    if (idx.length === 5) { combos.push(idx.slice()); return; }
    for (let i = start; i < n; i++) {
      idx.push(i);
      rec(i + 1);
      idx.pop();
    }
  };
  rec(0);
  for (const combo of combos) {
    const hand = evalFive(combo.map((i) => list[i]));
    if (!best || compareHands(hand, best) > 0) best = hand;
  }
  return best;
}

/** 比较两手牌：>0 表示 a 更强 */
export function compareHands(a, b) {
  if (a.rank !== b.rank) return a.rank - b.rank;
  const len = Math.max(a.tiebreak.length, b.tiebreak.length);
  for (let i = 0; i < len; i++) {
    const av = a.tiebreak[i] ?? 0;
    const bv = b.tiebreak[i] ?? 0;
    if (av !== bv) return av - bv;
  }
  return 0;
}

/** 评估恰好 5 张牌 */
function evalFive(cards) {
  const values = cards.map((c) => c.value).sort((a, b) => b - a);
  const suits = cards.map((c) => c.suit);

  // 同花判定
  const isFlush = suits.every((s) => s === suits[0]);

  // 计数（rank → 个数）
  const count = new Map();
  for (const v of values) count.set(v, (count.get(v) || 0) + 1);
  // 按「个数降序，点数降序」排列
  const groups = [...count.entries()].sort((a, b) => (b[1] - a[1]) || (b[0] - a[0]));

  // 顺子判定（含 A-2-3-4-5 的轮子顺）
  const uniq = [...count.keys()].sort((a, b) => a - b);
  let straightHigh = 0;
  if (uniq.length === 5) {
    if (uniq[4] - uniq[0] === 4) straightHigh = uniq[4];
    else if (uniq[0] === 2 && uniq[1] === 3 && uniq[2] === 4 && uniq[3] === 5 && uniq[4] === 14) {
      straightHigh = 5;   // 轮子顺：A 当 1，高张为 5
    }
  }

  const [top1, top2] = [groups[0][0], groups[1] ? groups[1][0] : 0];

  if (isFlush && straightHigh) {
    const royal = straightHigh === 14;
    return {
      rank: royal ? HAND_RANKS.ROYAL_FLUSH : HAND_RANKS.STRAIGHT_FLUSH,
      name: royal ? HAND_NAMES[HAND_RANKS.ROYAL_FLUSH] : HAND_NAMES[HAND_RANKS.STRAIGHT_FLUSH],
      cards: cards.slice(),
      tiebreak: [straightHigh],
    };
  }
  if (groups[0][1] === 4) {
    return {
      rank: HAND_RANKS.FOUR_KIND, name: HAND_NAMES[HAND_RANKS.FOUR_KIND],
      cards: cards.slice(), tiebreak: [top1, top2],
    };
  }
  if (groups[0][1] === 3 && groups[1] && groups[1][1] === 2) {
    return {
      rank: HAND_RANKS.FULL_HOUSE, name: HAND_NAMES[HAND_RANKS.FULL_HOUSE],
      cards: cards.slice(), tiebreak: [top1, groups[1][0]],
    };
  }
  if (isFlush) {
    return {
      rank: HAND_RANKS.FLUSH, name: HAND_NAMES[HAND_RANKS.FLUSH],
      cards: cards.slice(), tiebreak: values.slice(0, 5),
    };
  }
  if (straightHigh) {
    return {
      rank: HAND_RANKS.STRAIGHT, name: HAND_NAMES[HAND_RANKS.STRAIGHT],
      cards: cards.slice(), tiebreak: [straightHigh],
    };
  }
  if (groups[0][1] === 3) {
    return {
      rank: HAND_RANKS.THREE_KIND, name: HAND_NAMES[HAND_RANKS.THREE_KIND],
      cards: cards.slice(), tiebreak: [top1, groups[1] ? groups[1][0] : 0],
    };
  }
  if (groups[0][1] === 2 && groups[1] && groups[1][1] === 2) {
    return {
      rank: HAND_RANKS.TWO_PAIR, name: HAND_NAMES[HAND_RANKS.TWO_PAIR],
      cards: cards.slice(), tiebreak: [top1, groups[1][0], groups[2] ? groups[2][0] : 0],
    };
  }
  if (groups[0][1] === 2) {
    return {
      rank: HAND_RANKS.ONE_PAIR, name: HAND_NAMES[HAND_RANKS.ONE_PAIR],
      cards: cards.slice(), tiebreak: [top1, groups[1] ? groups[1][0] : 0],
    };
  }
  return {
    rank: HAND_RANKS.HIGH_CARD, name: HAND_NAMES[HAND_RANKS.HIGH_CARD],
    cards: cards.slice(), tiebreak: values.slice(0, 5),
  };
}

/* ===================================================================
 * 对局
 * =================================================================== */

/**
 * 创建一局德州扑克。
 *
 * @param {object} opts
 *   - players: [{ id, name, isAI, cash, extraHole, assets, personality }]
 *   - seed: 随机种子
 *   - blindLevel: 盲注档位（1=小, 2=中, 3=大）
 * @returns {object} 对局对象
 */
export function createPokerGame(opts = {}) {
  const seed = opts.seed || 'poker';
  const rng = makeRng(`poker:${seed}`);

  const participants = (opts.players || []).filter((p) => !p.bankrupt);
  if (participants.length < 2) {
    return null;
  }

  const blinds = blindScale(participants);
  const deck = rng.shuffle(buildDeck());

  const seats = participants.map((p, i) => {
    // 桌上面值 = 现金 + 资产折算额度（两段分开记账，结算时才写回主游戏）
    const cash = Math.max(0, p.cash || 0);
    const assetQuota = Math.max(0, Math.round((p.assetValue || 0) * POKER_CONFIG.assetBetRatio));
    return {
      seat: i,
      playerId: p.id,
      name: p.name,
      isAI: !!p.isAI,
      // 起始现金（结算时写回主游戏用）
      cash,
      // 起始现金筹码池（可下注的现金部分）
      cashStack: cash,
      // 资产抵押额度池（可下注的资产折算部分，不改变所有权）
      assetStack: assetQuota,
      // 桌上面值总量
      stack: cash + assetQuota,
      bet: 0,
      hole: [],
      folded: false,
      allIn: false,
      active: true,
      extraHole: p.extraHole || 0,
      personality: p.personality || null,
      // 结算用：本次从现金实扣的金额
      cashPaid: 0,
      // 结算用：本次从资产额度实扣的金额
      assetPaid: 0,
      lastAction: null,
      handRank: null,
      handName: null,
    };
  });

  const game = {
    seed,
    rng,
    deck,
    deckUsed: [],          // 已经发出/烧掉的牌（用于完整性校验）
    burned: [],
    seats,
    community: [],
    pot: 0,
    street: 'preflop',    // preflop | flop | turn | river | showdown | over
    currentSeat: 0,
    currentBet: 0,
    minRaise: POKER_CONFIG.raiseUnit,
    raisesThisStreet: 0,
    blinds,
    sbSeat: 0,
    bbSeat: 1,
    log: [],
    result: null,
    over: false,
    // 每个玩家在主游戏里的引用（结算时回写）
    playerRefs: new Map(participants.map((p) => [p.id, p.ref || p])),
  };

  dealHoleCards(game);
  postBlinds(game);
  advanceTurn(game);
  assertDeckIntegrity(game);
  return game;
}

/** 盲注档位 —— 按桌上玩家平均现金自动分档 */
export function blindScale(players) {
  const avg = players.reduce((s, p) => s + Math.max(0, p.cash || 0), 0) / Math.max(1, players.length);
  let mult = 1;
  if (avg >= 6000) mult = 3;
  else if (avg >= 3200) mult = 2;
  return {
    small: POKER_CONFIG.smallBlind * mult,
    big: POKER_CONFIG.bigBlind * mult,
    mult,
  };
}

/**
 * 发底牌 —— 逐张轮转发牌（标准德州扑克）。
 * 赌王多 1 张底牌；总底牌数受 52 张牌库硬约束。
 */
function dealHoleCards(game) {
  const perPlayer = game.seats.map((s) => POKER_CONFIG.holeCards + (s.extraHole || 0));
  const total = perPlayer.reduce((a, b) => a + b, 0);
  // 硬约束：底牌 + 公共牌 + 烧牌必须 ≤ 52
  const needed = total + POKER_CONFIG.communitySize + 3;
  if (needed > POKER_CONFIG.deckSize) {
    throw new Error(`发牌超限：底牌 ${total} + 公共牌 ${POKER_CONFIG.communitySize} + 烧牌 3 > 52`);
  }
  for (let round = 0; round < POKER_CONFIG.holeCards + 1; round++) {
    for (let i = 0; i < game.seats.length; i++) {
      const seat = game.seats[(i + round) % game.seats.length];
      const want = POKER_CONFIG.holeCards + (seat.extraHole || 0);
      if (seat.hole.length >= want) continue;
      if (game.deck.length === 0) throw new Error('牌库已耗尽');
      seat.hole.push(game.deck.pop());
      game.deckUsed.push(seat.hole[seat.hole.length - 1]);
    }
    // 所有人底牌都发够了就停
    if (game.seats.every((s) => s.hole.length >= POKER_CONFIG.holeCards + (s.extraHole || 0))) break;
  }
}

/** 下盲注 */
function postBlinds(game) {
  const n = game.seats.length;
  game.sbSeat = n >= 3 ? n - 1 : 0;   // 三人及以上：按钮位左手边为小盲
  game.bbSeat = (game.sbSeat + 1) % n;
  commitBet(game, game.sbSeat, game.blinds.small);
  commitBet(game, game.bbSeat, game.blinds.big);
  game.currentBet = game.blinds.big;
  game.minRaise = game.blinds.big;
  game.currentSeat = n >= 3
    ? (game.bbSeat + 1) % n
    : (game.bbSeat + 1) % n;   // heads-up：大盲后即为小盲行动
}

/**
 * 从座位扣除筹码并计入底池。
 *
 * 筹码来源分两段（严格按顺序）：
 *   1. 先扣**现金**（seat.cashStack）—— 现金不足时最多扣到 0，绝不为负；
 *   2. 现金扣完仍不够，才动**资产额度**（seat.assetStack）——
 *      只是「抵押额度」，不改变主游戏的机构所有权。
 *
 * @returns {{cash:number, asset:number}} 本次从现金 / 资产额度各扣了多少
 */
function commitBet(game, seatIndex, amount) {
  const seat = game.seats[seatIndex];
  if (amount <= 0) return { cash: 0, asset: 0 };

  const capped = Math.min(amount, seat.stack);
  const fromCash = Math.min(capped, seat.cashStack);
  const fromAsset = Math.min(capped - fromCash, seat.assetStack);

  seat.cashStack -= fromCash;
  seat.assetStack -= fromAsset;
  seat.stack -= fromCash + fromAsset;
  seat.cashPaid += fromCash;
  seat.assetPaid += fromAsset;
  seat.bet += fromCash + fromAsset;
  game.pot += fromCash + fromAsset;

  // 注意：此处**不**直接写 ref.pokerAssetLock。
  // 资产让渡的记账统一由 settlePoker 完成（单点结算），
  // 避免「下注记一次 + 结算再记一次」造成资产折让被重复计算。
  // 这里只保留 seat 上的账（cashPaid / assetPaid / bet）。

  if (seat.stack <= 0) seat.allIn = true;
  return { cash: fromCash, asset: fromAsset };
}

/**
 * 「全下」标记 —— 把座位标记为 allin 状态。
 *
 * ⚠ P1：allin 现在**可能只是「上限全下」**（受 maxBetRatio 限制），
 *   座位理论上还剩一点筹码。
 *   但从规则上看，玩家已经表态「我把能押的都押了」，
 *   之后不能再加注 —— 必须显式标记 allIn，
 *   否则 advanceTurn 会一直把TA当成可行动者（死循环）。
 *
 * @param {object} game
 * @param {number} seatIndex
 */
function markAllIn(game, seatIndex) {
  const seat = game.seats[seatIndex];
  if (!seat) return;
  seat.allIn = true;
  seat.lastAction = seat.lastAction || 'allin';
}

/**
 * 牌库完整性断言 —— 保证场上所有牌不超过一副 52 张，且无重复。
 * 每次发牌后调用；违反即抛错（宁可崩也不发重复牌）。
 */
export function assertDeckIntegrity(game) {
  const ids = new Set();
  for (const c of game.deckUsed) {
    if (ids.has(c.id)) {
      throw new Error(`牌库重复：${c.id}`);
    }
    ids.add(c.id);
  }
  if (game.deckUsed.length > POKER_CONFIG.deckSize) {
    throw new Error(`场上牌数 ${game.deckUsed.length} 超过 52 张`);
  }
  // 底牌 + 公共牌 + 烧牌 的总数也必须 ≤ 52
  const total = game.deckUsed.length + game.burned.length;
  if (total > POKER_CONFIG.deckSize) {
    throw new Error(`用牌总数 ${total} 超过 52 张`);
  }
  return true;
}

/** 剩余牌数（供 UI 展示「牌库还剩多少」） */
export function remainingCards(game) {
  return POKER_CONFIG.deckSize - game.deckUsed.length - game.burned.length;
}

/* ===================================================================
 * 行动
 * =================================================================== */

/** 当前行动座位索引（跳过已弃牌/全下的玩家） */
export function currentActor(game) {
  if (game.over) return -1;
  let i = game.currentSeat;
  for (let k = 0; k < game.seats.length; k++) {
    const s = game.seats[i];
    if (!s.folded && !s.allIn && s.active) return i;
    i = (i + 1) % game.seats.length;
  }
  return -1;
}

/**
 * 计算当前玩家可执行的动作。
 *
 * ================== 下注上限口径（F1 / P1）==================
 * `maxBetRatio` 只约束**现金部分**的投入：
 *   · 现金上限 = 剩余现金 × maxBetRatio。
 *   · 关键在于：随着一局推进，seat.cashStack 会不断减少，
 *     若仍用起始现金做基数，理论上仍可把全部现金押进去 —— 不成立。
 *   · 用剩余现金做基数后，任何时刻「本次再投入的现金」都不会超过
 *     剩余现金的比例，**allin 也必须受此约束**（见 P1 修复）。
 *
 * ⚠ **资产额度不计入 maxBetRatio**：
 *   资产额度（seat.assetStack）本身已经是「机构市值 × assetBetRatio」的
 *   有限额度（所有权不转移，只是抵押折算），不是主游戏现金。
 *   若把资产额度也乘上 maxBetRatio，会出现两个严重后果：
 *     1. 现金用光的玩家**永远无法全下**（上限 = 0）→ 行动循环**死锁**；
 *     2. 资产额度形同虚设，赌场机制失去意义。
 *   因此：现金部分受 maxBetRatio 约束，资产部分按额度全额可用。
 *
 * @returns {Array<{type:string, amount?:number, label:string, disabled?:boolean, reason?:string}>}
 */
export function legalActions(game) {
  const idx = currentActor(game);
  if (idx < 0) return [];
  const seat = game.seats[idx];
  const toCall = Math.max(0, game.currentBet - seat.bet);
  // 现金上限 = 剩余现金 × maxBetRatio（剩余现金为 0 时上限为 0）
  const cashCap = Math.floor(Math.max(0, seat.cashStack) * POKER_CONFIG.maxBetRatio);
  // 单次动作的总额上限 = 现金上限 + 可用资产额度
  const maxBet = Math.min(seat.stack, cashCap + seat.assetStack);
  const actions = [];

  actions.push({ type: 'fold', label: '弃牌' });

  if (toCall <= 0) {
    actions.push({ type: 'check', label: '过牌' });
  } else {
    actions.push({
      type: 'call',
      amount: Math.min(toCall, seat.stack),
      label: `跟注 ￥${Math.min(toCall, seat.stack)}`,
      disabled: seat.stack <= 0,
      reason: seat.stack <= 0 ? '筹码不足' : '',
    });
  }

  const canRaise = seat.stack > toCall
    && (game.raisesThisStreet < POKER_CONFIG.maxRaises || toCall === 0);
  if (canRaise) {
    const minRaiseTo = Math.min(
      seat.stack,
      game.currentBet + game.minRaise,
    );
    if (minRaiseTo > seat.bet) {
      actions.push({
        type: 'raise',
        amount: minRaiseTo - seat.bet,
        min: minRaiseTo - seat.bet,
        max: Math.max(minRaiseTo - seat.bet, Math.min(seat.stack - toCall, maxBet - toCall)),
        label: '加注',
        disabled: false,
      });
    }
  }

  if (seat.stack > 0) {
    // ⚠ P1：allin 必须受 maxBetRatio 约束 ——
    //   之前 allin 直接押上 seat.stack（现金 + 资产额度全额），
    //   等于绕过 maxBetRatio，一把就能把主游戏现金全押光。
    //   现在 allin 的金额上限 = min(剩余筹码, 剩余现金 × maxBetRatio + 资产额度)。
    //
    //   ⚠ 关键：**允许「部分全下」**（all-in for less）。
    //   当 allinCap < toCall 时，玩家仍然有合法动作 ——
    //   真实德州扑克里跟注不足就是 all-in for less，剩余未跟的部分
    //   由对手的多余部分各自成池。
    //   如果这里强行要求 allinCap ≥ toCall 才会给出 allin 选项，
    //   就会出现「call 不够（需跟注 > 筹码?不会）／allin 被拒」的**死锁**：
    //   玩家既不能 call 也不能 allin（cap < toCall）→ 行动循环卡死。
    //   所以：只要 allinCap > 0 就提供 allin 选项；
    //   若 allinCap < toCall，则是「不足额全下」，照样把筹码打光进入 allin 状态。
    const allinCap = Math.min(seat.stack, cashCap + seat.assetStack);
    const allinAmount = Math.max(0, allinCap);
    const canAllin = allinAmount > 0;
    const short = allinAmount < toCall;
    actions.push({
      type: 'allin',
      amount: allinAmount,
      label: short
        ? `全下 ￥${allinAmount}（不足额全下）`
        : `全下 ￥${allinAmount}`,
      disabled: !canAllin,
      reason: canAllin ? '' : '现金额度不足，无法全下',
    });
  }

  return actions;
}

/* ===================================================================
 * AI 决策
 * =================================================================== */

/**
 * 评估当前座位的手牌强度（0~1，越大越强）。
 *
 * 只看**自己的底牌 + 已发的公共牌**（不偷看别人的牌）。
 * 公共牌未发时（preflop）用底牌的启发式强度。
 */
export function handStrength(game, seatIndex) {
  const seat = game.seats[seatIndex];
  if (!seat) return 0;
  const cards = [...seat.hole, ...game.community];
  if (cards.length < 2) return 0;

  // 预翻牌：按底牌启发式打分
  if (game.community.length === 0) {
    const vals = seat.hole.map((c) => c.value).sort((a, b) => b - a);
    const pair = vals[0] === vals[1];
    let s = vals[0] / 14 * 0.6 + vals[1] / 14 * 0.4;
    if (pair) s = Math.max(s, 0.45 + vals[0] * 0.02);
    if (vals[0] - vals[1] <= 2) s = Math.max(s, 0.5);   // 连张
    return Math.min(0.95, s);
  }

  // 有公共牌：直接评估当前最佳牌型
  const ev = evaluateHand(cards);
  const base = ev.rank / HAND_RANKS.ROYAL_FLUSH;
  // 牌型之外的微调（tiebreak 首项）
  const tb = ev.tiebreak && ev.tiebreak.length ? ev.tiebreak[0] / 14 : 0;
  return Math.min(0.99, base * 0.85 + tb * 0.15);
}

/**
 * AI 自动行动 —— 供赌场小游戏的 AI 座位使用。
 *
 * 决策依据（简单但不失平衡）：
 *   · 手牌强度越高越少弃牌、越多加注；
 *   · 「量化研究员」职业的 foldBias 让坏牌判定更保守（更少弃牌）；
 *   · 加注幅度受 maxBetRatio 约束 —— 一把牌不会毁掉主游戏。
 *
 * @param {object} game
 * @param {number} seatIndex
 * @param {object} rng 可复现随机源
 * @returns {object} action { type, amount }
 */
export function aiAction(game, seatIndex, rng) {
  const seat = game.seats[seatIndex];
  const actions = legalActions(game);
  if (!actions.length || !seat) return { type: 'check' };

  const strength = handStrength(game, seatIndex);
  const bias = (game.foldBiasById && game.foldBiasById.get(seat.playerId)) || 0;
  // 弃牌阈值：基础 0.30，量化研究员最多下调 0.30 → 最保守 0
  const foldThreshold = Math.max(0, 0.30 - bias);

  const toCall = Math.max(0, game.currentBet - seat.bet);
  const callAction = actions.find((a) => a.type === 'call');
  const checkAction = actions.find((a) => a.type === 'check');
  const raiseAction = actions.find((a) => a.type === 'raise');

  // 牌太弱 → 弃牌（但跟注价很便宜时可以不弃）
  if (strength < foldThreshold && toCall > 0) {
    const cheapCall = toCall <= Math.max(40, seat.stack * 0.08);
    if (!cheapCall || strength < foldThreshold * 0.5) return { type: 'fold' };
  }

  // 有牌 → 按强度决定加注 / 跟注 / 过牌
  if (raiseAction && !raiseAction.disabled) {
    const raiseChance = strength > 0.75 ? 0.75 : strength > 0.55 ? 0.4 : 0.18;
    if (rng.next() < raiseChance) {
      const unit = game.minRaise;
      let amount = unit;
      if (strength > 0.85) amount = unit * 2;
      else if (rng.next() < 0.4) amount = unit * 2;
      const maxAllowed = raiseAction.max ?? amount;
      amount = Math.max(raiseAction.min, Math.min(amount, maxAllowed));
      if (amount > 0) return { type: 'raise', amount };
    }
  }

  if (callAction && !callAction.disabled) return { type: 'call', amount: callAction.amount };
  if (checkAction) return { type: 'check' };
  const allin = actions.find((a) => a.type === 'allin');
  if (allin) return { type: 'allin', amount: allin.amount };
  return { type: 'fold' };
}

/**
 * 执行一个动作。
 * @param {object} game
 * @param {number} seatIndex
 * @param {object} action { type, amount }
 * @returns {{ok:boolean, reason?:string}}
 */
export function applyAction(game, seatIndex, action) {
  if (game.over) return { ok: false, reason: '对局已结束' };
  if (!action || typeof action !== 'object') return { ok: false, reason: '非法动作' };
  const idx = currentActor(game);
  if (idx !== seatIndex) return { ok: false, reason: '不是你的行动' };

  // 金额合法性：加注必须带一个有限正数金额，避免负数 / NaN / Infinity 被静默接受。
  if (action.type === 'raise') {
    const amt = action.amount;
    if (typeof amt !== 'number' || !Number.isFinite(amt)) {
      return { ok: false, reason: '加注金额非法' };
    }
    if (amt <= 0) return { ok: false, reason: '加注金额必须大于 0' };
  }

  const seat = game.seats[seatIndex];
  const toCall = Math.max(0, game.currentBet - seat.bet);

  switch (action.type) {
    case 'fold': {
      seat.folded = true;
      seat.lastAction = 'fold';
      break;
    }
    case 'check': {
      if (toCall > 0) return { ok: false, reason: '需要先跟注' };
      seat.lastAction = 'check';
      break;
    }
    case 'call': {
      const amt = Math.min(toCall, seat.stack);
      commitBet(game, seatIndex, amt);
      seat.lastAction = 'call';
      break;
    }
    case 'raise': {
      const target = game.currentBet + Math.max(game.minRaise, action.amount);
      const total = target - seat.bet;
      if (total > seat.stack) return { ok: false, reason: '筹码不足' };
      if (target <= game.currentBet) return { ok: false, reason: '加注幅度不足' };
      // ⚠ P1：加注同样不得绕过 maxBetRatio ——
      //   现金部分上限 = 剩余现金 × maxBetRatio，资产部分按额度可用。
      //   超出上限的加注必须被拒绝（否则 allin 的限制形同虚设 ——
      //   玩家只要先 raise 再 allin 就能绕过）。
      const raiseCap = Math.min(
        seat.stack,
        Math.floor(Math.max(0, seat.cashStack) * POKER_CONFIG.maxBetRatio) + seat.assetStack,
      );
      if (total > raiseCap) {
        return {
          ok: false,
          reason: `超出下注上限（本手上限 ￥${raiseCap}）`,
        };
      }
      commitBet(game, seatIndex, total);
      game.currentBet = target;
      game.minRaise = Math.max(game.minRaise, total);
      game.raisesThisStreet += 1;
      seat.lastAction = 'raise';
      break;
    }
    case 'allin': {
      // 全下金额固定取自座位的**可用额度**，不接受调用方传入的金额。
      if (action.amount != null) {
        if (typeof action.amount !== 'number' || !Number.isFinite(action.amount)) {
          return { ok: false, reason: '全下金额非法' };
        }
        if (action.amount < 0) return { ok: false, reason: '全下金额必须大于 0' };
      }
      // ⚠ P1：全下不得绕过 maxBetRatio ——
      //   上限 = min(剩余总筹码, 剩余现金 × maxBetRatio + 资产额度)。
      //   · **现金部分**受 maxBetRatio 约束（不能一把把主游戏现金全押光）；
      //   · **资产部分**按额度全额可用（它不是主游戏现金，
      //     且若也乘 maxBetRatio，现金用光的玩家将永远无法全下 → 死锁）。
      //   若上限 < 跟注额 → 允许「不足额全下」（all-in for less）：
      //   玩家把手上筹码全部打光进入 allin 状态，
      //   未跟足的部分按边池规则由对手的多余注码各自成池。
      //   ⚠ 若这里强制要求 cap ≥ toCall，就会出现**死锁** ——
      //   玩家既不能 allin（被拒）也无法推进（call 之后仍不够），
      //   行动循环会卡死。真实德州扑克里同样允许 all-in for less。
      const cap = Math.min(
        seat.stack,
        Math.floor(Math.max(0, seat.cashStack) * POKER_CONFIG.maxBetRatio) + seat.assetStack,
      );
      if (cap <= 0) return { ok: false, reason: '没有可用筹码' };
      const total = cap;
      commitBet(game, seatIndex, total);
      // ⚠ P1：显式标记 allin（上限全下后可能仍有少量剩余筹码，
      //   但玩家已表态押完，不能再加注 —— 否则行动循环会卡死）。
      markAllIn(game, seatIndex);
      if (seat.bet > game.currentBet) {
        const raiseBy = seat.bet - game.currentBet;
        game.currentBet = seat.bet;
        // ⚠ P1 修复：加注幅度必须**至少等于本街最小加注额**，
        //   之前误写成 `seat.bet - max(0, currentBet - seat.bet)`（恒为 0），
        //   导致 allin 的加注幅度永远不抬高 minRaise，
        //   后面的人可以用 1 块钱的「加注」无限抬高底池。
        game.minRaise = Math.max(game.minRaise, raiseBy);
        game.raisesThisStreet += 1;
      }
      seat.lastAction = 'allin';
      break;
    }
    default:
      return { ok: false, reason: `未知动作 ${action.type}` };
  }

  advanceTurn(game);
  return { ok: true };
}

/**
 * 推进到下一个行动者；必要时进入下一条街或摊牌。
 */
function advanceTurn(game) {
  if (game.over) return;

  const live = game.seats.filter((s) => !s.folded && s.active);

  // 只剩 1 人未弃牌 → 他赢下全部底池。
  // 必须构造 payouts —— 之前传空表，settlePoker 的守恒兜底会把整池
  // 错派给「本手付出现金最少」的座位（甚至弃牌者）。
  if (live.length <= 1) {
    const w = live[0] || null;
    const payouts = w
      ? [{ seat: w.seat, playerId: w.playerId, amount: game.pot, name: w.name, pot: '底池' }]
      : [];
    game.pot = 0;
    finishGame(game, w ? [w.seat] : [], payouts);
    return;
  }

  // 当前街结束判定：所有未弃牌、未全下的玩家都已跟平且已行动
  const contenders = game.seats.filter((s) => !s.folded && s.active && !s.allIn);
  if (contenders.length === 0) {
    // 全部全下 → 直接发完公共牌摊牌
    runOutBoard(game);
    showdown(game);
    return;
  }

  // 找到下一个需要行动的人
  let i = (game.currentSeat + 1) % game.seats.length;
  for (let k = 0; k < game.seats.length; k++) {
    const s = game.seats[i];
    if (!s.folded && s.active && !s.allIn) {
      // 若当前所有人都跟平了 → 进入下一街
      //
      // ⚠ P1：跟平判定只看**可行动者**（contenders）。
      //   全下者（allIn）可能「不足额全下」（all-in for less）——
      //   他们的 bet < currentBet 是**正常状态**（未跟足的部分
      //   由边池规则处理），不能因此判定「还有人没跟平」而卡住街道。
      //   旧代码用 `contenders.some(x => x.bet < game.currentBet)` 判定 needMore，
      //   恰好只查可行动者 —— 这里保持一致，但要确保 allIn 座位
      //   不参与 needMore 判定（否则街道永远不结束 → 死循环）。
      const needMore = contenders.some((x) => x.bet < game.currentBet);
      const someoneActed = contenders.every((x) => x.lastAction !== null);
      if (!needMore && someoneActed && game.street !== 'preflop') {
        nextStreet(game);
        return;
      }
      if (!needMore && someoneActed && game.street === 'preflop') {
        // preflop 结束条件：所有可行动者都已跟平大盲
        const everyoneCalled = contenders.every((x) => x.bet >= game.blinds.big || x.allIn);
        if (everyoneCalled) {
          nextStreet(game);
          return;
        }
      }
      game.currentSeat = i;
      return;
    }
    i = (i + 1) % game.seats.length;
  }

  // 没有可行动者了 → 摊牌
  runOutBoard(game);
  showdown(game);
}

/** 进入下一条街（发公共牌） */
function nextStreet(game) {
  game.raisesThisStreet = 0;
  game.currentBet = 0;
  game.minRaise = game.blinds.big;

  const burn = game.deck.pop();
  if (burn) { game.burned.push(burn); }

  if (game.street === 'preflop') {
    for (let i = 0; i < 3; i++) {
      const c = game.deck.pop();
      if (c) { game.community.push(c); game.deckUsed.push(c); }
    }
    game.street = 'flop';
  } else if (game.street === 'flop') {
    const c = game.deck.pop();
    if (c) { game.community.push(c); game.deckUsed.push(c); }
    game.street = 'turn';
  } else if (game.street === 'turn') {
    const c = game.deck.pop();
    if (c) { game.community.push(c); game.deckUsed.push(c); }
    game.street = 'river';
  } else {
    showdown(game);
    return;
  }

  // 重置本街的「已行动」标记
  for (const s of game.seats) s.lastAction = null;

  // 翻牌后行动顺序：从**按钮位左手边**第一个可行动者开始
  // （标准规则；heads-up 时按钮位即小盲，其对面大盲先行动）。
  // 之前固定从 (bbSeat+1) 起找 —— HU 时等于小盲/按钮先行动，顺序反了；
  // 多人局也会跳过小盲位作为首选起点。
  const n = game.seats.length;
  const btnSeat = n === 2 ? game.sbSeat : (game.sbSeat - 1 + n) % n;
  let i = (btnSeat + 1) % n;
  for (let k = 0; k < n; k++) {
    const s = game.seats[i];
    if (!s.folded && s.active && !s.allIn) { game.currentSeat = i; break; }
    i = (i + 1) % n;
  }

  assertDeckIntegrity(game);
}

/** 一次性发完剩余公共牌（全员全下时） */
function runOutBoard(game) {
  while (game.community.length < POKER_CONFIG.communitySize) {
    const burn = game.deck.pop();
    if (burn) game.burned.push(burn);
    const c = game.deck.pop();
    if (!c) break;
    game.community.push(c);
    game.deckUsed.push(c);
  }
  assertDeckIntegrity(game);
}

/* ===================================================================
 * 摊牌与结算
 * =================================================================== */

/**
 * 摊牌 —— 计算每个未弃牌玩家的最佳牌型并分池。
 */
export function showdown(game) {
  const contenders = game.seats.filter((s) => !s.folded && s.active);
  for (const s of contenders) {
    const all = [...s.hole, ...game.community];
    const ev = evaluateHand(all);
    s.handRank = ev.rank;
    s.handName = ev.name;
    s.bestCards = ev.cards;
  }

  // 分池（支持边池：all-in 玩家的筹码只参与其注额以内的池）
  const pots = buildPots(game);
  const payouts = [];

  for (const pot of pots) {
    const eligible = contenders.filter((s) => pot.seats.includes(s.seat));
    if (!eligible.length) continue;
    let best = null;
    for (const s of eligible) {
      if (!best || compareHands(
        { rank: s.handRank, tiebreak: tiebreakOf(s, game) },
        { rank: best.handRank, tiebreak: tiebreakOf(best, game) },
      ) > 0) best = s;
    }
    const winners = eligible.filter((s) => compareHands(
      { rank: s.handRank, tiebreak: tiebreakOf(s, game) },
      { rank: best.handRank, tiebreak: tiebreakOf(best, game) },
    ) === 0);
    const share = Math.floor(pot.amount / winners.length);
    let remainder = pot.amount - share * winners.length;
    for (const w of winners) {
      let amt = share;
      if (remainder > 0) { amt += 1; remainder -= 1; }
      payouts.push({ seat: w.seat, playerId: w.playerId, amount: amt, name: w.name, pot: pot.label });
    }
  }

  // 若所有玩家都弃牌（如只有一个玩家行动），赢家直接拿走全部底池
  if (!payouts.length) {
    const live = game.seats.filter((s) => !s.folded && s.active);
    if (live.length === 1) {
      payouts.push({
        seat: live[0].seat, playerId: live[0].playerId, amount: game.pot,
        name: live[0].name, pot: '底池',
      });
    }
  }

  game.pot = 0;
  finishGame(game, payouts.map((p) => p.seat), payouts);
}

/** 取座位的 tiebreak（用于比较） */
function tiebreakOf(seat, game) {
  const ev = evaluateHand([...seat.hole, ...game.community]);
  return ev.tiebreak;
}

/**
 * 构建底池（含边池）。
 * 规则：按各座位总注额分层，每层的池只由「注额达到该层」的未弃牌玩家争夺。
 */
export function buildPots(game) {
  const contribs = game.seats.map((s) => s.bet);
  const levels = [...new Set(contribs.filter((c) => c > 0))].sort((a, b) => a - b);
  const pots = [];
  let prev = 0;
  for (const lv of levels) {
    let amount = 0;
    const seats = [];
    for (const s of game.seats) {
      const put = Math.min(s.bet, lv) - Math.min(s.bet, prev);
      if (put > 0) {
        amount += put;
        if (!s.folded && s.active) seats.push(s.seat);
      }
    }
    if (amount > 0) {
      pots.push({ amount, seats, label: pots.length === 0 ? '底池' : `边池 ${pots.length}` });
    }
    prev = lv;
  }
  return pots;
}

/**
 * 结束对局 —— 记录结果。
 * @param {Array<number>} winnerSeats
 * @param {Array} payouts
 */
function finishGame(game, winnerSeats, payouts = []) {
  game.over = true;
  game.street = 'over';
  game.result = {
    winners: winnerSeats,
    payouts,
    community: game.community.slice(),
    hands: game.seats.map((s) => ({
      seat: s.seat, playerId: s.playerId, name: s.name,
      hole: s.hole.slice(), rank: s.handRank, name_: s.handName,
      folded: s.folded, bet: s.bet,
    })),
  };
}

/**
 * 中途退出牌局 —— 把所有仍在场的玩家标记为弃牌，并按规则分配底池。
 *
 * 用于「玩家主动退出赌场」的场景：
 *   · 只有 1 人还在场时 → 他拿走全部底池；
 *   · 所有人都已弃牌 → 底池退回最后一名未弃牌的玩家（按引擎规则）。
 *
 * 退出后对局进入 over 状态，可以正常走 settlePoker 写回主游戏。
 *
 * @param {object} game
 */
export function abortPokerGame(game) {
  if (!game || game.over) return game;

  // 保留最后一个未弃牌、未全下的座位作为赢家候选，其余全部弃牌
  const live = game.seats.filter((s) => !s.folded && s.active);
  if (live.length <= 1) {
    // 同 advanceTurn：必须带上 payouts，否则整池会被守恒兜底错派
    const w = live[0] || null;
    const payouts = w
      ? [{ seat: w.seat, playerId: w.playerId, amount: game.pot, name: w.name, pot: '底池' }]
      : [];
    game.pot = 0;
    finishGame(game, w ? [w.seat] : [], payouts);
    return game;
  }

  // 多人仍在场：让最后一个仍在场的人赢下底池（其余全部弃牌）
  const winner = live[live.length - 1];
  for (const s of game.seats) {
    if (s.seat !== winner.seat) {
      s.folded = true;
      s.lastAction = 'fold';
    }
  }
  // 赢家拿走全部底池
  game.result = {
    winners: [winner.seat],
    payouts: [{
      seat: winner.seat,
      playerId: winner.playerId,
      amount: game.pot,
      name: winner.name,
      pot: '底池',
    }],
    community: game.community.slice(),
    hands: game.seats.map((s) => ({
      seat: s.seat, playerId: s.playerId, name: s.name,
      hole: s.hole.slice(), rank: s.handRank, name_: s.handName,
      folded: s.folded, bet: s.bet,
    })),
  };
  game.pot = 0;
  game.over = true;
  game.street = 'over';
  return game;
}

/**
 * 结算 —— 把赌桌结果写回主游戏。
 *
 * 关键保证：
 *   1. 玩家现金**绝不为负**：现金扣款最多扣到 0；
 *   2. **净额结算**：现金与资产各按「赢 − 押」的净额一次性写回，
 *      不重复记账，也不凭空造钱（全桌净额之和恒为 0）；
 *   3. 主游戏的机构所有权、等级、质押状态**完全不变**。
 *
 * @param {object} game
 * @param {object} state 主游戏状态
 * @returns {{deltas:Array, pot:number, log:Array}}
 */
export function settlePoker(game, state) {
  const payouts = game.result ? game.result.payouts : [];
  const received = new Map();
  for (const p of payouts) {
    received.set(p.playerId, (received.get(p.playerId) || 0) + p.amount);
  }

  /* =================================================================
   * ================= 派彩拆解（F4 重写）=================
   *
   * 之前用「全局 assetShare」（底池里资产筹码占比）去拆每个座位的派彩：
   *     assetWon = round(gain × potAsset / potTotal)
   * 这在「人人下注比例相同」时恰好正确，但**结构不成立**：
   *   · 某人只押现金、某人重仓资产时，全局比例套到每个座位上，
   *     会凭空制造/销毁价值（赢家用现金赢走了本不该归他的资产份额）；
   *   · 派彩与各座位**实际下注结构**（cashPaid / assetPaid）无关。
   *
   * ===== 正确的口径：按「逐座位下注结构」拆解 =====
   * 把底池拆成两条平行的价值流：
   *   1. **现金流（cashFlow）** —— 所有座位的 cashPaid 之和，
   *      只会以**现金**形式派彩（赢家拿到现金）；
   *   2. **资产流（assetFlow）** —— 所有座位的 assetPaid 之和，
   *      资产所有权不转移，因此必须**折成现金**派给赢家；
   *      同时赢家用资产押的部分要**解除让渡**（pokerAssetLock 归位）。
   *
   * 于是：
   *   · 每个座位的现金净额 = 赢得的现金 − 自己的 cashPaid
   *   · 每个座位的资产净额 = 赢回自己的资产部分 − 自己的 assetPaid
   *   · 派彩先按「赢回自己的下注」抵扣（无论现金还是资产），
   *     剩下的才是「净赢的钱」。
   *
   * 举例（守恒验证）：
   *   A 押现金 100，B 押资产 100（= 100 让渡估值）。
   *   底池 200，A 全赢：
   *     · A 赢回自己的现金 100 → cashDelta = +100 − 100 = 0
   *     · A 赢回 B 的资产 100 → 折成现金 +100 → cashDelta += 100
   *     · B 的资产让渡保留 → assetDelta = 0 − 100 = −100
   *   财富口径：现金 +100 + 资产 −100 = 0 ✓（B 的资产估值折损转移给了 A）
   *
   *   A 押资产 100（自己赢回）：
   *     · assetRestored = 100（解除等额让渡）→ assetDelta = 100 − 100 = 0
   *     · cashDelta = 0
   *   财富口径：0 ✓（估值原样归位）
   *
   * ===== ⚠ F4 关键修正：净赢部分**全额折成现金** =====
   *   旧实现把「净赢」按底池的现金/资产比例拆成 netCashFromOthers +
   *   netAssetFromOthers，但**只把 netCashFromOthers 记进现金净额**，
   *   netAssetFromOthers 被直接丢弃 —— 这就是「财富凭空造钱 / 蒸发」的
   *   根源（赢家赢走别人资产的那部分现金凭空消失）。
   *   现在：净赢部分**全部折成现金**派给赢家
   *   （赢家到手的现金 = 赢得总额 − 赢回自己资产的那部分），
   *   对手被扣的资产让渡与之一一对应 → 财富严格守恒。
   *
   * ===== 守恒证明（可逐项核对）=====
   *   记 ΣX 为对所有座位求和。
   *   · cashNet_i  = gain_i − cashPaid_i − ownAssetBack_i
   *   · assetNet_i = ownAssetBack_i − assetStaked_i
   *   Σ(cashNet + assetNet)
   *     = Σgain − ΣcashPaid − ΣownAssetBack + ΣownAssetBack − ΣassetStaked
   *     = Σgain − Σ(cashPaid + assetStaked)
   *     = Σgain − Σseat.bet
   *   而底池守恒保证 **Σgain === Σseat.bet**（每枚筹码都派了出去），
   *   故 Σ(cashNet + assetNet) ≡ 0 ✓ —— 严格守恒，无舍入误差。
   * ================================================================= */

  // ---- 步骤 1：算出「每个座位从底池赢回了多少、其中多少属于自己」 ----
  // 「自己赢回」= min(赢得总额, 自己的**有效入池注额**)；
  // 再按**该座位自己的下注结构**拆分回现金部分与资产部分。
  //
  // ⚠ F4：用**有效入池注额**而不是 seat.bet ——
  //   seat.bet 含「未被跟注额」（超出桌面最高跟注的部分），
  //   那部分不进底池、也不产生盈亏，必须排除，
  //   否则会多扣输家 → 财富凭空蒸发。
  const seats = game.seats;
  const totalPaid = seats.reduce((s, x) => s + x.bet, 0);
  const totalCashPaid = seats.reduce((s, x) => s + x.cashPaid, 0);
  const totalAssetPaid = seats.reduce((s, x) => s + x.assetPaid, 0);

  const deltas = [];
  // 现金被「不得为负」规则截断的总额（记账用，正常应为 0）
  let cashTruncated = 0;
  for (const seat of seats) {
    const ref = game.playerRefs.get(seat.playerId);
    const gain = received.get(seat.playerId) || 0;

    const cashPaid = seat.cashPaid;
    const assetStaked = seat.assetPaid;
    const totalBet = seat.bet;

    // ---- 步骤 1a：赢回「自己的下注」部分（先归本） ----
    // 赢回金额不超过自己的总下注；按**自己的下注结构**拆成现金 / 资产。
    //
    // ⚠ ownAssetBack 的语义 =「赢回自己押的那部分资产估值」。
    //   这部分**不折成现金**（估值原样归位，pokerAssetLock 不增加），
    //   其余的「净赢」部分才全部折成现金派给赢家。
    const ownBack = Math.min(gain, totalBet);
    const ownCashBack = Math.min(ownBack, cashPaid);
    const ownAssetBack = ownBack - ownCashBack;   // ≤ assetStaked

    // ---- 步骤 1b：净赢的部分（超出自己下注的部分） ----
    // 净赢部分来自**别人**的筹码，**全部折成现金**派给赢家：
    //   · 别人押的现金 → 以现金派付；
    //   · 别人押的资产 → 资产所有权不转移，**折成现金**派付
    //     （赢家用现金拿到等值，被赢者的资产让渡照扣 → 等额转移）。
    //
    // ⚠ F4 关键修正：旧实现把净赢按底池的现金/资产比例拆成
    //   netCashFromOthers + netAssetFromOthers，却**只把前者记进现金净额**，
    //   后者被直接丢弃 —— 赢家赢走别人资产的那部分现金凭空消失
    //   （表现为「总财富蒸发 / 凭空造钱」）。
    //   现在净赢**全额折成现金** → 严格守恒。
    const netWin = gain - ownBack;

    // ---- 步骤 2：汇总本座位的现金净额与资产净额 ----
    // 现金净额 = 赢得总额 − 赢回自己资产的部分（那部分以估值归位，不算现金）
    //           − 自己押上的现金
    // 资产净额 = 赢回自己的资产 − 押上的资产（赢回部分解除让渡）
    const cashWon = gain - ownAssetBack;      // 实际到手的现金
    const cashNet = cashWon - cashPaid;
    // 资产净额：赢回自己的资产 → 解除等额让渡（净值 0）；
    // 没赢回 → 让渡保留（真实折损，净值为负）。
    const assetNet = ownAssetBack - assetStaked;
    // 净赢中来自别人资产的部分已折成现金 —— 记在 cashNet 里，
    // 同时对手的资产让渡照扣，两侧等额（财富守恒）。

    if (ref) {
      // 现金净额一次性结算；保证绝不为负
      // ⚠ 若因现金不足被截断为 0，差额必须**如实记账**，
      //   否则会凭空造钱（现金少了，账面却没记）。
      const beforeCash = ref.cash || 0;
      const afterCash = Math.max(0, beforeCash + cashNet);
      const appliedCash = afterCash - beforeCash;
      ref.cash = afterCash;
      // 让渡余额 = 旧让渡 + 本手未赢回的押注。
      // 本手赢回的部分从未记入 lock，无需冲减；旧让渡是已实现损失，不可被复活。
      ref.pokerAssetLock = Math.max(0, (ref.pokerAssetLock || 0) - assetNet);
      // 现金被截断的差额（理论上只在「现金已被其他事件扣光」时出现）
      cashTruncated += appliedCash - cashNet;
    }
    deltas.push({
      playerId: seat.playerId,
      name: seat.name,
      bet: totalBet,
      cashPaid,
      assetStaked,
      gain,
      net: gain - totalBet,
      cashDelta: cashNet,
      assetDelta: assetNet,
      // 派彩拆解明细（供 UI / 自检核对）
      cashWon,
      assetWon: ownAssetBack,
      netCashFromOthers: netWin,
      netAssetFromOthers: 0,
      folded: seat.folded,
      handName: seat.handName,
    });
  }

  // ---- 步骤 3：守恒自检（**财富口径**）----
  // 全桌「现金净额 + 资产净额」之和应为 0：
  //   · 赢家的现金增加 ↔ 输家被扣的现金；
  //   · 赢家赢走别人资产（折现金）↔ 输家让渡保留（资产净值减少）。
  // 现金单独看**允许**不守恒（资产折现部分必然导致现金净额 ≠ 0）。
  //
  // ⚠ cashTruncated：现金被「不得为负」规则截断的部分。
  //   截断意味着「账面要扣的钱比手里有的多」，
  //   真实财富少了这一块，账面也必须如实体现（不能凭空补钱）。
  const sumCashNet = deltas.reduce((s, d) => s + d.cashDelta, 0);
  const sumAssetNet = deltas.reduce((s, d) => s + d.assetDelta, 0);
  const wealthDrift = sumCashNet + sumAssetNet + cashTruncated;
  if (wealthDrift !== 0) {
    // 兜底修正（理论上仅有四舍五入误差）：从财富净收益最大者身上收回差额
    const maxSeat = deltas.reduce(
      (a, b) => ((b.cashDelta + b.assetDelta > a.cashDelta + a.assetDelta) ? b : a), deltas[0]);
    if (maxSeat) {
      const ref = game.playerRefs.get(maxSeat.playerId);
      if (ref) ref.cash = Math.max(0, (ref.cash || 0) - wealthDrift);
      maxSeat.cashDelta -= wealthDrift;
    }
  }

  const log = [];
  for (const d of deltas) {
    if (d.gain > 0) {
      log.push(`${d.name} 赢得 ￥${d.gain}${d.handName ? `（${d.handName}）` : ''}`);
    } else if (!d.folded && d.bet > 0) {
      log.push(`${d.name} 投注 ￥${d.bet}${d.assetStaked > 0 ? `（含资产折让 ￥${d.assetStaked}）` : ''}`);
    } else if (d.folded) {
      log.push(`${d.name} 弃牌`);
    }
  }

  return {
    deltas,
    pot: payouts.reduce((s, p) => s + p.amount, 0),
    log,
    // 供自检核对：底池成分拆解
    breakdown: { totalPaid, totalCashPaid, totalAssetPaid },
  };
}

/**
 * 供 UI 使用：把某座位的手牌隐藏（除非摊牌或本人）。
 */
export function visibleHoleCards(game, seatIndex, viewerPlayerId) {
  const seat = game.seats[seatIndex];
  if (!seat) return [];
  if (seat.playerId === viewerPlayerId) return seat.hole;
  if (game.over) return seat.hole;
  return [];
}
