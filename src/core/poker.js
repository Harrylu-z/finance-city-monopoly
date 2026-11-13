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
 * ================== 结算口径（净额制）==================
 * 底池里混有「现金筹码」与「资产筹码」两种成分。结算时按**净额**一次性
 * 写回主游戏，避免重复记账：
 *   · 现金净额 = 赢得的现金筹码 − 押上的现金筹码 → 直接加减 `player.cash`；
 *   · 资产净额 = 赢得的资产筹码 − 押上的资产筹码 → 加减 `player.pokerAssetLock`。
 * 派彩按底池成分比例拆分（现金筹码 → 现金，资产筹码 → 资产估值），
 * 因此「用现金赢下资产筹码」这类价值转移不会凭空产生或消失。
 * 全桌现金净额之和恒为 0，资产净额之和恒为 0。
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
 * @returns {Array<{type:string, amount?:number, label:string, disabled?:boolean, reason?:string}>}
 */
export function legalActions(game) {
  const idx = currentActor(game);
  if (idx < 0) return [];
  const seat = game.seats[idx];
  const toCall = Math.max(0, game.currentBet - seat.bet);
  const maxBet = Math.min(
    seat.stack,
    Math.round(Math.max(seat.cash, 0) * POKER_CONFIG.maxBetRatio) || seat.stack,
  );
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
    actions.push({
      type: 'allin',
      amount: seat.stack,
      label: `全下 ￥${seat.stack}`,
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
      commitBet(game, seatIndex, total);
      game.currentBet = target;
      game.minRaise = Math.max(game.minRaise, total);
      game.raisesThisStreet += 1;
      seat.lastAction = 'raise';
      break;
    }
    case 'allin': {
      // 全下金额固定取自座位筹码，不接受调用方传入的金额。
      if (action.amount != null) {
        if (typeof action.amount !== 'number' || !Number.isFinite(action.amount)) {
          return { ok: false, reason: '全下金额非法' };
        }
        if (action.amount < 0) return { ok: false, reason: '全下金额必须大于 0' };
      }
      const total = seat.stack;
      if (total <= 0) return { ok: false, reason: '没有筹码' };
      commitBet(game, seatIndex, total);
      if (seat.bet > game.currentBet) {
        game.currentBet = seat.bet;
        game.minRaise = Math.max(game.minRaise, seat.bet - Math.max(0, game.currentBet - seat.bet));
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

  // 只剩 1 人 → 直接结束，其余筹码归他
  if (live.length <= 1) {
    finishGame(game, live[0] ? [live[0].seat] : []);
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

  const allMatched = contenders.every((s) => s.bet >= game.currentBet);
  if (allMatched && game.street !== 'preflop') {
    // 本街结束（preflop 由 big blind 的行动触发）
  }

  // 找到下一个需要行动的人
  let i = (game.currentSeat + 1) % game.seats.length;
  for (let k = 0; k < game.seats.length; k++) {
    const s = game.seats[i];
    if (!s.folded && s.active && !s.allIn) {
      // 若当前所有人都跟平了 → 进入下一街
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

  // 下一位行动者 = 按钮位左手边第一个可行动者
  const n = game.seats.length;
  let i = (game.bbSeat + 1) % n;
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
    finishGame(game, live.length ? [live[0].seat] : [], []);
    game.pot = 0;
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

  // ---- 底池的「筹码成分」拆解 ----
  // 底池里混有现金筹码与资产筹码，派彩时必须**按成分原路返回**：
  // 现金筹码回到现金，资产筹码回到资产估值（解除让渡）。
  // 否则会出现「用现金赢下资产筹码」或反之的价值凭空产生/消失。
  let potCash = 0;
  let potAsset = 0;
  for (const seat of game.seats) {
    potCash += seat.cashPaid;
    potAsset += seat.assetPaid;
  }
  const potTotal = potCash + potAsset;
  const assetShare = potTotal > 0 ? potAsset / potTotal : 0;

  const deltas = [];
  for (const seat of game.seats) {
    const ref = game.playerRefs.get(seat.playerId);
    const gain = received.get(seat.playerId) || 0;
    const totalBet = seat.bet;

    // 现金实扣：就是本座位在桌上实际付出的现金筹码（已在 commitBet 里记账）。
    // 这里不再对 ref.cash 做二次扣减之外的操作 —— 净额一次性结算。
    const cashPaid = seat.cashPaid;
    // 资产折让：座位实际用资产额度顶掉的部分（所有权不变，只是估值让渡）。
    const assetStaked = seat.assetPaid;

    // 派彩按底池成分拆分：资产筹码部分回补资产估值，现金筹码部分进现金。
    // 赢回自己押的资产 → 解除等额让渡；赢得别人的资产 → 资产估值增加等额。
    const assetWon = Math.round(gain * assetShare);
    const cashWon = gain - assetWon;

    // 资产净额 = 赢得的资产 − 押上的资产
    //   · 押了 500 资产、赢回 500 → 净额 0（估值原样归位）
    //   · 押了 500 资产、一分未赢 → 净额 −500（真实折损）
    const assetNet = assetWon - assetStaked;
    // 现金净额 = 赢得的现金 − 押上的现金
    const cashNet = cashWon - cashPaid;

    if (ref) {
      // 现金净额一次性结算；保证绝不为负
      ref.cash = Math.max(0, (ref.cash || 0) + cashNet);
      // 资产让渡净额一次性结算；正数=解除让渡，负数=真实折损。
      // 统一在这里记账，避免下注与结算两处重复累加。
      ref.pokerAssetLock = Math.max(0, (ref.pokerAssetLock || 0) - assetNet);
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
      folded: seat.folded,
      handName: seat.handName,
    });
  }

  // 守恒自检：全桌现金净额之和应为 0（筹码只在桌内转移，不凭空增减）。
  // 资产净额之和同样应为 0。
  const sumCashNet = deltas.reduce((s, d) => s + d.cashDelta, 0);
  const sumAssetNet = deltas.reduce((s, d) => s + d.assetDelta, 0);
  if (sumCashNet !== 0) {
    // 兜底修正（理论上不会发生）：把差额从最大净收益者身上收回，保证不凭空造钱。
    const maxSeat = deltas.reduce((a, b) => (b.cashDelta > a.cashDelta ? b : a), deltas[0]);
    if (maxSeat) {
      const ref = game.playerRefs.get(maxSeat.playerId);
      if (ref) ref.cash = Math.max(0, (ref.cash || 0) - sumCashNet);
      maxSeat.cashDelta -= sumCashNet;
    }
  }
  if (sumAssetNet !== 0) {
    const maxSeat = deltas.reduce((a, b) => (b.assetDelta > a.assetDelta ? b : a), deltas[0]);
    if (maxSeat) {
      const ref = game.playerRefs.get(maxSeat.playerId);
      if (ref) ref.pokerAssetLock = Math.max(0, (ref.pokerAssetLock || 0) + sumAssetNet);
      maxSeat.assetDelta -= sumAssetNet;
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

  return { deltas, pot: payouts.reduce((s, p) => s + p.amount, 0), log };
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
