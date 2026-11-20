/**
 * 规则引擎 —— 游戏状态与回合流程。纯逻辑 + 事件发射，渲染层只负责表现。
 *
 * 设计要点：
 *   - 所有状态变更都通过 `state` 对象，规则函数尽量保持纯粹
 *   - 通过 `emit(event)` 把内部发生的事推给 UI（播报、音效、特效）
 *   - 回合轮转带死循环保护（maxTurns），破产玩家立即跳过
 */

import {
  BOARD_CELLS, BOARD_SIZE, LEVELS, EVENT_CARDS, TRAP_CARDS,
  CLEARING_TARGETS, GROUP_META, SPECIAL,
} from './board.js';
import {
  CONFIG, calculateRent, upgradeCost, mortgageValue, redeemFee,
  assetValue, totalAssets, institutionValue, isBankrupt, liquidate, purchasePrice, levelLabel,
  globalRegulatorEffects, playerRegulatorEffects, groupBuffTier, buffMultiplierFor, loanRepayAmount,
  loanInterestPerTurn, loanOutstandingAmount,
  outstandingLoan, bondRedeemValue, bondMinSubscribers, bondCouponFor,
  buffEffectMult, maintenanceCost, totalMaintenanceCost,
} from './economy.js';
import { makeRng } from './rng.js';
import {
  CAREERS, CAREER_BY_ID, DEFAULT_CAREER_ID, getCareer, CAREER_PIECE_START,
  careerEffectMult, careerEffectValue, careerHasHook,
} from './careers.js';
import {
  PERSONALITIES, PERSONALITY_BY_ID, getPersonality, DEFAULT_PERSONALITY_ID,
  assignPersonalities,
} from './personalities.js';
import {
  createPokerGame, settlePoker, POKER_CONFIG,
} from './poker.js';

let eventSeq = 0;

/**
 * 债券 id 全局自增计数器（m1）。
 *
 * 放在 state 上（而非模块级），这样：
 *   · 读档 / 分局时计数器随状态一起保存，恢复后不会重复；
 *   · 同种子对局的 id 序列完全可复现。
 *
 * @param {object} state
 * @returns {string} 形如 `bond_7` 的唯一 id
 */
export function nextBondId(state) {
  if (!state) return 'bond_0';
  if (typeof state.bondSeq !== 'number' || !Number.isFinite(state.bondSeq)) {
    // 兼容旧存档：从现有债券里推断一个起点，避免与已有 id 冲突
    let max = 0;
    for (const p of (state.players || [])) {
      for (const b of (p.bonds || [])) {
        const m = /bond_(\d+)$/.exec(b.id || '');
        if (m) max = Math.max(max, Number(m[1]) + 1);
      }
      for (const b of (p.subscribedBonds || [])) {
        const m = /bond_(\d+)$/.exec(b.id || '');
        if (m) max = Math.max(max, Number(m[1]) + 1);
      }
    }
    state.bondSeq = max;
  }
  state.bondSeq += 1;
  return `bond_${state.bondSeq}`;
}

/** 创建初始状态 */
export function createState(options = {}) {
  const {
    seed = 'default',
    players = [],
    diceCount = 2,
    cash = CONFIG.cashLevels.standard,
    market = 'normal',
    difficulty = 'normal',
    aiCount = 3,
    // legacy = true 表示「载入旧存档」：AI 缺失性格字段时降级为中性基准，
    // 不凭空补一个人格（避免旧档被追溯性改写）。
    // 新开局（legacy 缺省 false）时，AI 未指定性格会按 seed 稳定随机分配。
    legacy = false,
  } = options;

  const rng = makeRng(seed);

  // ===== 新开局：为未指定性格的 AI 稳定分配性格 ====================
  // 按 seed 抽样 → 同种子可复现（分享链接还原出完全相同的对局）。
  // 真人玩家永远不进入这个池子（绝不被无故强制分配性格）。
  // 用**派生随机源**，避免消耗 state.rng 的随机序列（保持对局随机流不变）。
  const autoPersonalities = legacy ? [] : assignPersonalities(rng.fork('personality'), players.length);
  let autoPersonalityCursor = 0;

  const state = {
    seed,
    rng,
    difficulty,
    diceCount,
    market,               // 'bull' | 'bear' | 'normal'
    eventMult: 1,         // 全局事件卡租金系数（由 globalBuffs 推导，见 recomputeGlobalMult）
    globalBuffs: [],      // 限时全局状态：{ id, name, desc, remaining, total, effect }
    round: 1,             // 全局圈数（发生过几次绕圈事件；展示用）
    turnNumber: 0,        // 总回合数
    currentPlayerIndex: 0,
    players: [],
    board: BOARD_CELLS,
    phase: 'await-roll',  // await-roll | moving | settling | await-decision | gameover
    pending: null,        // 待处理的一次结算
    log: [],
    events: [],
    maxTurns: 5000,
    bankruptedThisTurn: false,
    // 债券 id 全局自增计数器（m1）
    bondSeq: 0,
  };

  players.forEach((p, i) => {
    // ===== 职业 & 性格 的规范化解析 ====================
    // 职业：未指定时 AI 按 seed 稳定分配，真人默认投行家（永不被无故改动）
    const resolvedCareerId = resolveCareerId(p, rng, i);
    // 性格：真人 → null（**不强制分配**）；
    //       AI 且指定了合法性格 → 该性格；
    //       AI 但旧存档缺字段 → 'neutral'（无性格倾向，行为等同中性基准）
    const resolvedPersonalityId = resolvePersonalityId(p, autoPersonalities, autoPersonalityCursor);
    if (p.isAI && !p.personalityId && !(typeof p.personality === 'string') && !p.personality) {
      autoPersonalityCursor++;
    }
    const personalityDef = resolvedPersonalityId ? getPersonality(resolvedPersonalityId) : null;

    state.players.push({
      id: p.id ?? i,
      index: i,
      name: p.name,
      isAI: !!p.isAI,
      // 棋子立绘：**由职业唯一决定**（索引 7~13）——
      // 职业与形象一一对应，玩家不再能自由选择外观，
      // 因此真人 / AI 都使用自己职业的专属立绘，一眼就能从棋子认出职业。
      // 传入的 avatar 字段（旧存档遗留）一律忽略。
      avatar: getCareer(resolvedCareerId)?.pieceIndex ?? (CAREER_PIECE_START + i),
      colorIndex: p.colorIndex ?? i,
      // ===== 职业（金融行业专属角色）=====
      // careerId 决定出场被动；career 是同值的兼容别名（旧代码用 player.career）
      careerId: resolvedCareerId,
      career: resolvedCareerId,
      // ===== 性格（仅 AI 有）=====
      // personalityId 是唯一事实来源；personality 保存性格**定义快照**（便于 UI 直接读）
      personalityId: resolvedPersonalityId,
      personality: personalityDef || null,
      cash: p.cash ?? cash,
      position: 0,
      inJail: false,
      bankrupt: false,
      // ⚠ P1：玩家**自己**绕过的圈数（与全局 state.round 分离）。
      //   牛熊周期与债券到期统一按「全家中位圈数」判定，
      //   避免跑得快的玩家单方面改变全场节奏。
      laps: p.laps ?? 0,
      institutions: [],   // {cellIndex, level, mortgaged, mortgageAmount}
      stats: {
        acquisitions: 0, upgrades: 0, rentsCollected: 0, rentsPaid: 0, largestRent: 0,
        acquisitionSpend: 0, upgradeSpend: 0, mortgageSpend: 0, redeemSpend: 0,
      },
      lastAction: null,
      // ===== 资金流水账本 =====
      // 只记自己的现金增减（收入为正 / 支出为负），供 HUD「我的机构」tab 下半部分展示。
      // 所有现金变动都必须走 rules.recordCash()，否则账本会与实际现金对不上。
      cashFlow: [],
      // 累计净额（独立累加）—— 条目列表会被截断，不能从列表反推净额
      cashFlowNet: 0,
      // ===== 新增金融状态 =====
      loans: [],          // 央行贷款：{id, tier, name, amount, rate, term, interestPerTurn, accruedInterest, interestPaid, turnsElapsed, takenTurn}
      bonds: [],          // 作为发行方持有的债券：{id, face, coupon, couponPer, subscribers:[playerId], couponsPaid, issuedRound, dueRound}
      subscribedBonds: [],// 作为认购方持有的债券：{id, issuerId, face, coupon, couponPer, couponsPaid, dueRound}
      buffs: [],          // 限时状态：{id, name, desc, kind, remaining, total, startedTurn, effect}
      loanCountThisRound: 0,
      // 维持成本欠费累计（超过资产 50% → 强制清算）
      maintenanceDebt: 0,
      // 升级许可：只有再次踩到自有地块后才获得一次升级许可
      upgradePermits: {}, // cellIndex -> { turn, expiresTurn }
    });
  });

  return state;
}

/**
 * 为 AI 分配职业 —— 按 rng 稳定取样，避免同种子对局职业重复。
 * @param {object} rng
 * @param {number} index 该玩家序号（用于错开抽样）
 */
export function pickCareerId(rng, index = 0) {
  if (!CAREERS.length) return DEFAULT_CAREER_ID;
  // 基础位置由序号错开，抽样只在小范围内取 —— 保证一局里职业不重复
  const start = index % CAREERS.length;
  const offset = rng.int(0, CAREERS.length - 1);
  return CAREERS[(start + offset) % CAREERS.length].id;
}

/**
 * 解析玩家职业 id。
 *
 * ================== 兼容规则 ==================
 *   1. 显式给了合法 careerId → 直接采用；
 *   2. 给了非法 careerId（拼写错误 / 旧版本已删除的 id）→ 回落到默认值，**不抛错**；
 *   3. 完全没给：
 *      · AI   → 按 seed 稳定分配一个（本局内不重复）；
 *      · 真人 → 默认「投行家」（人类玩家不应被无故改动）。
 */
function resolveCareerId(p, rng, index) {
  const explicit = p.careerId || p.career;
  if (explicit && CAREER_BY_ID[explicit]) return explicit;
  if (explicit) {
    // 非法 id —— 静默降级，不阻断开局
    return p.isAI ? pickCareerId(rng, index) : DEFAULT_CAREER_ID;
  }
  return p.isAI ? pickCareerId(rng, index) : DEFAULT_CAREER_ID;
}

/**
 * 解析玩家性格 id。
 *
 * ================== 兼容规则 ==================
 *   1. 真人玩家 → **null**（绝不无故被分配性格）；
 *   2. AI 显式给了合法性格（id 字符串或性格定义对象）→ 该性格 id；
 *   3. AI 给了非法性格 → 降级为 'neutral'（无性格倾向），不抛错；
 *   4. AI 完全没给（旧存档）→ 'neutral'，行为等同中性基准。
 */
function resolvePersonalityId(p, autoPool = [], cursor = 0) {
  if (!p.isAI) return null;
  const raw = p.personalityId
    ?? (typeof p.personality === 'string' ? p.personality : p.personality?.id);
  if (raw) {
    if (raw === DEFAULT_PERSONALITY_ID) return DEFAULT_PERSONALITY_ID;
    return PERSONALITY_BY_ID[raw] ? raw : DEFAULT_PERSONALITY_ID;
  }
  // 未指定性格：
  //   · 新开局 → 从 seed 稳定的池子里取一个（性格 + 职业相互独立）
  //   · 旧存档 → 'neutral'（不追溯改写旧局）
  if (autoPool.length) {
    const pick = autoPool[cursor % autoPool.length];
    if (pick) return pick.id;
  }
  return DEFAULT_PERSONALITY_ID;
}

/**
 * 玩家职业被动 × 限时状态被动 的合并乘数。
 *
 * 规则：职业被动与 buff 效果**同构**（都是乘数），
 * 因此直接相乘即可叠加：
 *   收购成本 = 基础价 × careerMult × buffMult
 *
 * @param {object} player
 * @param {string} key 'buyCostMult' | 'upgradeCostMult' | 'rentMult' | ...
 */
export function playerCostMult(player, key) {
  const career = careerEffectMult(player, key);
  const buff = buffEffectMult(player, key);
  return career * buff;
}

/** 事件发射 */
export function emit(state, type, payload = {}) {
  const ev = { id: ++eventSeq, type, ...payload };
  state.events.push(ev);
  return ev;
}

/** 记录日志 */
export function log(state, kind, text, tag) {
  const entry = { id: ++eventSeq, kind, text, tag: tag || defaultTag(kind) };
  state.log.push(entry);
  if (state.log.length > 300) state.log.shift();
  return entry;
}

function defaultTag(kind) {
  switch (kind) {
    case 'self': return '你';
    case 'ai': return 'AI';
    case 'good': return '利好';
    case 'bad': return '利空';
    case 'sys': return '系统';
    default: return '系统';
  }
}

/* ===================================================================
 * 资金流水（玩家账本）
 *
 * 为什么要单独记一份账，而不是复用 `state.log`？
 *   · `state.log` 是**全桌广播**（AI 的播报也在里面），而账本只服务「我的」；
 *   · `state.log` 的文案是为播报写的（含玩家名、句式），不适合直接当条目展示；
 *   · 账本需要**金额**这一结构化字段，才能算收支、做配色（+/-）。
 *
 * 因此所有**现金增减**都必须经由 `recordCash()`，这样才不会漏记 ——
 * 只要改了 `player.cash` 而没走这里，账本就会与实际现金对不上。
 *
 * 条目结构：{ id, turn, round, amount, reason, tag }
 *   amount > 0 → 收入；amount < 0 → 支出。
 *
 * ⚠️ 关于「累计净额」：
 *   账本只保留最近 CASHFLOW_LIMIT 条（更早的会被丢弃），
 *   所以「所有条目求和」≠ 「现金总变化」——
 *   早期条目一旦被丢弃，净额就会偏小。
 *   因此净额**单独累加**在 player.cashFlowNet 上，不从条目反推。
 * =================================================================== */

/** 单个玩家保留的流水条数上限（超出后丢弃最旧的） */
export const CASHFLOW_LIMIT = 40;

/**
 * 记一笔现金流水并同步修改玩家现金。
 *
 * ⚠️ 这是**唯一**允许改动 `player.cash` 的入口（破产清算等极端路径除外，
 * 那里走的是 `liquidate()`，会自己补一条清算流水）。
 *
 * @param {object} state 游戏状态
 * @param {object} player 玩家
 * @param {number} amount 金额（正=收入，负=支出）
 * @param {string} reason 事由简述（展示用，尽量短）
 * @param {string} [tag] 分类标签（展示用，可省略）
 * @returns {object|null} 写入的流水条目；amount 为 0 时返回 null
 */
export function recordCash(state, player, amount, reason, tag) {
  if (!player || !amount) return null;
  player.cash += amount;
  return noteCash(state, player, amount, reason, tag);
}

/**
 * 只写账本、**不改现金**。
 *
 * 用于「现金已被别处改过、但这里需要补一条流水」的场景
 * （例如赌场：poker.js 直接结算了 `ref.cash`，规则层只补流水）。
 * ⚠️ 误用会导致账本与实际现金对不上 —— 常规路径请用 recordCash()。
 *
 * @param {object} state 游戏状态
 * @param {object} player 玩家
 * @param {number} amount 金额（正=收入，负=支出）
 * @param {string} reason 事由简述（展示用，尽量短）
 * @param {string} [tag] 分类标签（展示用，可省略）
 * @returns {object|null} 写入的流水条目；amount 为 0 时返回 null
 */
export function noteCash(state, player, amount, reason, tag) {
  if (!player || !amount) return null;

  if (!player.cashFlow) player.cashFlow = [];
  const entry = {
    id: ++eventSeq,
    turn: state ? state.turnNumber : 0,
    round: state ? state.round : 0,
    amount,
    reason: reason || '',
    tag: tag || (amount > 0 ? '收入' : '支出'),
  };
  player.cashFlow.push(entry);
  // 净额单独累加 —— 不能从（会被截断的）条目列表反推
  player.cashFlowNet = (player.cashFlowNet || 0) + amount;
  // 只保留最近的若干条 —— 账本是「近期资金动态」，不是完整历史档案
  while (player.cashFlow.length > CASHFLOW_LIMIT) player.cashFlow.shift();
  return entry;
}

/**
 * 取玩家最近 N 条资金流水（新的在前）。
 * @param {object} player
 * @param {number} [limit]
 */
export function recentCashFlow(player, limit = 25) {
  if (!player || !player.cashFlow || !player.cashFlow.length) return [];
  return player.cashFlow.slice(-limit).reverse();
}

/** 当前玩家 */
export function currentPlayer(state) {
  return state.players[state.currentPlayerIndex];
}

/** 找到某格归属的玩家 */
export function ownerOf(state, cellIndex) {
  for (const p of state.players) {
    for (const inst of p.institutions) {
      if (inst.cellIndex === cellIndex) return p;
    }
  }
  return null;
}

/**
 * 计算新位置（处理绕圈）
 * @returns {{position:number, passedStart:boolean, laps:number}}
 */
export function computeMove(position, steps, size = BOARD_SIZE) {
  const raw = position + steps;
  const laps = Math.floor(raw / size);
  return {
    position: ((raw % size) + size) % size,
    passedStart: raw >= size,
    laps,
  };
}

/**
 * 计算「瞬移」需要前进的格数（顺时针）。
 *
 * 传送可以落在当前位置之前（例如清算所跳到地图另一端的机构），
 * 此时差值为负数，必须环绕成正向步数，否则会出现负步数导致位置变成 undefined。
 *
 * @param {number} from 起始位置
 * @param {number} to   目标位置
 * @param {number} size 棋盘长度
 * @returns {number} 顺时针步数（1 ~ size-1）
 */
export function computeTeleportSteps(from, to, size = BOARD_SIZE) {
  const delta = (to - from) % size;
  return ((delta % size) + size) % size || size;
}

/** 掷骰子 */
export function rollDice(state, player) {
  const dice = [];
  for (let i = 0; i < state.diceCount; i++) {
    dice.push(state.rng.int(1, 6));
  }
  const total = dice.reduce((a, b) => a + b, 0);
  emit(state, 'dice-rolled', { playerId: player.id, dice, total });
  return { dice, total };
}

/**
 * 移动玩家（逐格跳跃由渲染层处理，此处只结算最终位置）
 */
export function movePlayer(state, player, steps) {
  const from = player.position;
  const move = computeMove(from, steps, BOARD_SIZE);
  player.position = move.position;
  player.lastAction = { from, to: move.position, steps, passedStart: move.passedStart };
  emit(state, 'player-moved', { playerId: player.id, from, to: move.position, steps, passedStart: move.passedStart });
  return move;
}

/**
 * 结算落点。返回结算描述数组（供播报与特效使用）。
 */
export function settleOnCell(state, player, cellIndex) {
  const cell = BOARD_CELLS[cellIndex];
  const results = [];

  if (!cell) return results;

  if (cell.type === 'institution') {
    const owner = ownerOf(state, cellIndex);
    if (!owner) {
      // 无主 —— 触发收购决策（路演等限时状态 + 投行家职业可降低收购成本）
      //
      // ⚠ 买下即**网点级（level 0）**（用户拍板的星级体系）：
      //   星级只影响价格 / 租金高低，**不决定初始等级**。
      //   board.js 里所有机构的 `tier` 恒为 0，因此这里取到的恒是 0 ——
      //   但为了语义明确，这里不再依赖 `cell.tier` 的数据巧合，
      //   而是显式写死 INITIAL_LEVEL = 0（网点级）。
      // 证监会牌照：持有人收购价 9 折（注册制定价权）。
      const level = 0;
      const basePrice = purchasePrice(cell, level, state.market);
      const regEff = playerRegulatorEffects(state, player);
      const price = Math.round(basePrice * playerCostMult(player, 'buyCostMult') * (regEff.buyCostMult ?? 1));
      results.push({ kind: 'purchase-offer', cellIndex, price, level, cell });
      state.pending = { kind: 'purchase', cellIndex, price, level, playerId: player.id };
    } else if (owner.id === player.id) {
      // 踩到自己的机构 —— 获得升级许可（只有再次踩到自有地块后才能升级）
      if (!cell.regulator) {
        // ⚠ P2（m5）：升级许可加**时效 + 数量上限**。
        //   旧实现 `upgradePermits[cellIndex] = true` 是**永久**的 ——
        //   只要踩过一次自己的地块，以后走到哪都能对这块地升级，
        //   甚至囤积一堆许可后一次性连升多级（实质上取消了「再次踏足」限制）。
        //   现在：
        //     · 每个许可有**时效**（CONFIG.upgradePermitTurns 个自己的回合）；
        //     · 同时持有的许可数有**上限**（CONFIG.maxUpgradePermits），
        //       超出的不再发放（并提示）；
        //     · 许可的记录结构从 `true` 升级为 `{ turn, expiresTurn }`，
        //       同时兼容旧存档的 `true`（视为刚发放、给足时效）。
        grantUpgradePermit(state, player, cellIndex);
        results.push({ kind: 'upgrade-permit', cellIndex, cell });
      } else {
        results.push({ kind: 'own-regulator', cellIndex, cell });
      }
    } else {
      // 收租 —— 租金受集团 Buff 与监管效果影响
      const inst = owner.institutions.find((i) => i.cellIndex === cellIndex);

      // 已质押的机构：暂停收租，并提供「强制收购」选项
      // 踩到他人已质押地块 → 可按「该地块当前等级买入价 × 2」强行收购（含建筑等级）
      if (inst.mortgaged) {
        const takeoverPrice = Math.round(
          ((cell.price[inst.level] ?? cell.price[0] ?? 0)) * (CONFIG.forcedTakeoverMult ?? 2),
        );
        results.push({
          kind: 'takeover-offer', cellIndex, cell,
          level: inst.level,
          price: takeoverPrice,
          from: player.id,
          to: owner.id,
          ownerId: owner.id,
          ownerName: owner.name,
          mortgageAmount: inst.mortgageAmount || 0,
        });
        state.pending = {
          kind: 'takeover', cellIndex, price: takeoverPrice, level: inst.level,
          from: player.id, to: owner.id, playerId: player.id,
        };
      } else {
        const buffMult = buffMultiplierFor(owner, cell.group, state)
          * buffEffectMult(owner, 'rentMult');
        // 归属人的自身租金系数（信用评级展望 / 自查类事件卡）
        // ⚠ P1：`selfRentMult` 不再是**永久**乘数（一次监管抽查就永久扣租）。
        //   现在它由「限时 Buff（reg-self-rent）」承担 ——
        //   buffEffectMult(owner, 'rentMult') 已包含该限时效果，
        //   selfRentMult 只保留一个**下限保护**的角色（见 selfRentFloorMult）：
        //   即便有负面限时状态，租金也不会低于基准的一定的比例，
        //   且到期后自动恢复（不留下永久痕迹）。
        const selfMult = selfRentMultFor(owner);
        // 精算师职业：自己收取的管理费 +12%（温和加成，不改写胜负）
        const careerMult = careerEffectMult(owner, 'rentMult');
        // 金融监管总局牌照：持有人收租 +25%；他人持有时收租 -10%
        //   —— 牌照是「独享型」资产，效果按**归属人**判定，而非交租方。
        //   ⚠ 注意：buffMultiplierFor(owner, ...) 内已包含该牌照的 rentMult，
        //     此处不可再乘一次，否则会变成 1.25² 的平方加成。
        const rent = Math.round(calculateRent(cell, inst.level, {
          market: state.market, eventMult: state.eventMult, buffMult,
        }) * selfMult * careerMult);
        // 交租 / 收租 —— 两端都记账，账本才能对得上现金
        recordCash(state, player, -rent, `交租 ${cell.name}`, '交租');
        recordCash(state, owner, rent, `收租 ${cell.name}`, '管理费');
        player.stats.rentsPaid += rent;
        owner.stats.rentsCollected += rent;
        if (rent > owner.stats.largestRent) owner.stats.largestRent = rent;
        results.push({
          kind: 'rent-paid', cellIndex, cell, rent,
          from: player.id, to: owner.id, ownerName: owner.name, buffMult, selfMult,
          // 弹窗展示用：基础租金、机构等级、归属人配色、市场系数说明
          baseRent: cell.rent[inst.level] ?? cell.rent[0] ?? rent,
          level: inst.level,
          ownerColorIndex: owner.colorIndex,
          careerMult,
          marketNote: marketNoteFor(state.market)
            + (selfMult !== 1 ? ` × 自身系数 ${selfMult.toFixed(2)}` : '')
            + (careerMult !== 1 ? ` × 职业系数 ${careerMult.toFixed(2)}` : ''),
        });
        emit(state, 'rent-paid', { from: player.id, to: owner.id, rent, cellIndex });
      }
    }
  } else {
    // 特殊格
    results.push(...settleSpecial(state, player, cell, cellIndex));
  }

  return results;
}

/**
 * 市场周期 → 租金系数说明（用于交租弹窗）。
 */
export function marketNoteFor(market) {
  if (market === 'bull') return ' × 牛市 1.2';
  if (market === 'bear') return ' × 熊市 0.8';
  return '';
}

/**
 * 「交易员」职业的择时价差收益 —— 在**行情切换**时发放。
 *
 * ⚠ P2（m-trader）：34 格棋盘上**没有独立的「牛熊切换格」**了 ——
 *   行情切换有两条来源：
 *     1. 转盘抽到「牛熊切换」效果（`SPECIAL.market`）；
 *     2. 每 `CONFIG.marketCycleRounds` 圈**自动切换**（按中位圈数判定）。
 *   旧实现只在 `case 'market'` 里发奖励，而该 case 现在只能由转盘触发，
 *   自动切换路径完全漏发 —— 职业被动事实上**失效**。
 *   现在把发放逻辑抽成本函数，两条路径共用；
 *   并且「每圈只发一次」的去重键从 `state.round` 改成
 *   **玩家自己的圈数** `player.laps`（与 state.round 分离后语义才对得上）。
 *
 * @param {object} state
 * @param {object} player
 * @param {object} [cell] 触发格（可选）
 * @returns {object|null} 结算条目（未发放时返回 null）
 */
export function grantMarketTimingBonus(state, player, cell = null) {
  if (!player || player.bankrupt) return null;
  const amount = careerEffectValue(player, 'marketBonus');
  if (!(amount > 0)) return null;
  // 每「玩家自己的一圈」只发一次（用 laps 做去重键）
  const lap = player.laps || 0;
  if (player._marketBonusLap != null && player._marketBonusLap === lap) return null;
  player._marketBonusLap = lap;
  recordCash(state, player, amount, '择时价差收益', '收益');
  return {
    kind: 'bonus', amount, cell,
    reason: '交易员择时价差收益',
  };
}

/**
 * 归属人的「自身租金系数」—— P1：限时 buff + 下限 + 恢复。
 *
 * 语义：
 *   · 正面效果（评级上调等）由限时 Buff 承担，在 `buffEffectMult` 里生效；
 *   · 负面效果（监管整改等）同样由限时 Buff 承担（见 applyTrapCard）；
 *   · 本函数只负责**下限保护**：
 *     即使叠加了负面限时状态，租金也不低于基准 × CONFIG.selfRentFloorMult，
 *     避免「一次监管抽查 + 一个陷阱」把某个机构的收入压到 0；
 *   · 旧字段 `player.selfRentMult` 若来自**旧存档**（永久乘数），
 *     这里按「下限 + 恢复」处理：只取其与下限之间较宽松的一侧，
 *     并在若干回合后自动衰减回 1（`selfRentMultDecayTurns`），
 *     不再让永久痕迹留在存档里。
 *
 * @param {object} owner 归属人
 * @returns {number} 自身租金系数（≥ CONFIG.selfRentFloorMult）
 */
export function selfRentMultFor(owner) {
  const legacy = owner.selfRentMult;
  if (typeof legacy !== 'number' || legacy === 1) return 1;
  // 旧存档的永久乘数：按剩余回合逐步恢复
  const remain = typeof owner.selfRentMultTurns === 'number'
    ? owner.selfRentMultTurns
    : 0;
  if (remain <= 0) return 1;
  const floor = CONFIG.selfRentFloorMult;
  // 复利式恢复：每回合向 1 靠拢 1/总回合
  const step = 1 / Math.max(1, CONFIG.selfRentMultDecayTurns);
  const cur = legacy + (1 - legacy) * step;
  owner.selfRentMult = Math.round(cur * 1000) / 1000;
  owner.selfRentMultTurns = remain - 1;
  if (owner.selfRentMultTurns <= 0) {
    owner.selfRentMult = 1;
    owner.selfRentMultTurns = 0;
  }
  return Math.max(floor, owner.selfRentMult);
}

/**
 * 发放「经过起点」的货币发行补贴。
 *
 * 规则（改动后）：
 *   · **只要经过起点格就能拿到补贴** —— 不要求「恰好停在起点」；
 *   · 绕圈跨过起点（索引 0）时同样发放；
 *   · 同一圈内不重复发放。
 *
 * ⚠ P2（m6）：去重标记的**复位时机**从「布尔标志」改为**圈号记录**。
 *   旧实现用 `_startBonusGranted = true/false`：
 *     · 复位只发生在 main.js 的 `if (passedStart)` 分支 ——
 *       「恰好停在起点」（landedOnStart）但没跨圈的路径**不复位**，
 *       于是该玩家此后**永远拿不到补贴**；
 *     · 而「跨过起点」却会复位 —— 两条路径的语义不对称。
 *   现在记录「发放时所在的圈号」`_startBonusLap`：
 *     · 判定 = 「本圈（玩家自己的 laps）还没发过」；
 *     · 无论落在起点、跨过起点、还是传送回起点，
 *       只要玩家自己的圈号推进了，就自然解锁下一圈。
 *   这样「每圈恰好一次」由**圈号**保证，与触发路径无关。
 *
 * 返回结算条目数组（空数组表示本圈已发过，不再重复发放）。
 */
export function grantStartPass(state, player, cell) {
  const lap = player.laps || 0;
  // 首圈（laps = 0）也允许发一次：用 -1 作为「从未发放」的初始值
  if (player._startBonusLap != null && player._startBonusLap === lap) return [];
  recordCash(state, player, CONFIG.startBonus, '货币发行补贴', '补贴');
  player._startBonusLap = lap;
  player._startBonusGranted = true;
  return [{ kind: 'start-bonus', amount: CONFIG.startBonus, cell: cell || null }];
}

/**
 * 添加限时状态（Buff）。
 *
 * buff = { id, name, desc, turns, kind:'good'|'bad', group?, effect:{ rentMult?, buyCostMult?, upgradeCostMult? } }
 * 同一个 id 或同一个 group 的旧状态会被覆盖（例如评级上调会顶掉评级下调）。
 */
export function addBuff(state, player, buff) {
  player.buffs = player.buffs || [];
  if (buff.group) player.buffs = player.buffs.filter((b) => b.group !== buff.group);
  player.buffs = player.buffs.filter((b) => b.id !== buff.id);
  const entry = {
    id: buff.id,
    group: buff.group || null,
    name: buff.name,
    desc: buff.desc || '',
    kind: buff.kind || 'good',
    remaining: buff.turns,
    total: buff.turns,
    startedTurn: state.turnNumber,
    effect: buff.effect || {},
  };
  player.buffs.push(entry);
  emit(state, 'buff-gained', { playerId: player.id, buffId: entry.id, name: entry.name });
  log(state, entry.kind === 'bad' ? 'bad' : 'good',
    `${player.name} 获得「${entry.name}」：${entry.desc}（持续 ${entry.total} 回合）`, '状态');
  return entry;
}

/**
 * 添加**限时全局状态**（影响全场租金等全局系数）。
 *
 * ⚠ P1：事件卡的「全行业」租金系数现在走这里 ——
 *   它是**限时**的（到期自动恢复 1），而不是永久改写 state.eventMult。
 *
 * 同 id 的旧状态被覆盖；`eventMult` 每次重算：
 *   多个全局状态叠加时，取**对收取方最不利**的那个
 *   （即 rentMult 最小者）—— 避免玩家靠抽卡叠增益无限膨胀。
 *
 * @param {object} state
 * @param {object} buff { id, name, desc, turns, effect:{rentMult?} }
 */
export function setGlobalBuff(state, buff) {
  state.globalBuffs = state.globalBuffs || [];
  state.globalBuffs = state.globalBuffs.filter((b) => b.id !== buff.id);
  const entry = {
    id: buff.id,
    name: buff.name,
    desc: buff.desc || '',
    remaining: buff.turns,
    total: buff.turns,
    startedLap: state.lapCounter || 0,
    effect: buff.effect || {},
  };
  state.globalBuffs.push(entry);
  recomputeGlobalMult(state);
  emit(state, 'global-buff-gained', { buffId: entry.id, name: entry.name });
  log(state, 'sys', `全市场进入「${entry.name}」状态：${entry.desc}（持续 ${entry.total} 圈）`, '状态');
  return entry;
}

/**
 * 重算全局乘数（state.eventMult）—— 由限时全局状态推导。
 * @param {object} state
 */
export function recomputeGlobalMult(state) {
  let mult = 1;
  for (const b of (state.globalBuffs || [])) {
    const v = b.effect?.rentMult;
    if (typeof v === 'number' && v !== 1) mult = Math.min(mult, v);
  }
  state.eventMult = mult;
  return mult;
}

/**
 * 递减全局限时状态（每完成一圈调用一次）。
 * @param {object} state
 */
export function tickGlobalBuffs(state) {
  if (!state.globalBuffs || !state.globalBuffs.length) return;
  const expired = [];
  for (const b of state.globalBuffs) {
    b.remaining -= 1;
    if (b.remaining <= 0) expired.push(b);
  }
  if (expired.length) {
    state.globalBuffs = state.globalBuffs.filter((b) => b.remaining > 0);
    for (const b of expired) {
      log(state, 'sys', `全市场状态「${b.name}」结束`, '状态');
      emit(state, 'global-buff-expired', { buffId: b.id });
    }
    recomputeGlobalMult(state);
  }
}

/**
 * 回合结束时递减该玩家自己的 Buff。
 * 获得状态的当回合不扣减，因此「3 回合」= 之后完整经历 3 个自己的回合。
 */
export function tickBuffs(state, player) {
  if (player.bankrupt || !player.buffs || !player.buffs.length) return;
  const expired = [];
  for (const b of player.buffs) {
    if (b.startedTurn === state.turnNumber) continue;
    b.remaining -= 1;
    if (b.remaining <= 0) expired.push(b);
  }
  if (expired.length) {
    player.buffs = player.buffs.filter((b) => b.remaining > 0);
    for (const b of expired) {
      log(state, 'sys', `${player.name} 的「${b.name}」状态结束`, '状态');
      emit(state, 'buff-expired', { playerId: player.id, buffId: b.id });
    }
  }
}

/**
 * 需要「每回合一次」闸门的特殊效果 id（P1）。
 *
 * 这些效果都具备「自我放大」或「可套利」的性质：
 *   · refinance（再融资窗口）—— 一回合内可无限发债 → 无限融资套利；
 *   · clearing（清算所）/ crossborder（跨境互联）—— 传送后可再落到传送格 → 连锁传送；
 *   · metro（地铁枢纽）—— 传送后可再落到地铁格 → 连锁移动。
 */
export const GATED_SPECIALS = new Set(['refinance', 'clearing', 'crossborder', 'metro']);

/**
 * 读取玩家本回合已用掉的特殊格闸门集合。
 * @param {object} state
 * @param {object} player
 * @returns {Set<string>}
 */
function specialGateSet(state, player) {
  if (!player._specialGates) player._specialGates = {};
  const rec = player._specialGates;
  // 回合号变了 → 闸门重置
  if (rec.turn !== state.turnNumber) {
    rec.turn = state.turnNumber;
    rec.used = {};
  }
  if (!rec.used) rec.used = {};
  return rec.used;
}

/**
 * 该玩家本回合是否已经触发过某个特殊效果。
 */
export function specialGateUsed(state, player, specialId) {
  return !!specialGateSet(state, player)[specialId];
}

/**
 * 标记该玩家本回合已触发某个特殊效果。
 */
export function markSpecialGate(state, player, specialId) {
  specialGateSet(state, player)[specialId] = true;
}

/**
 * 发放升级许可（带**时效 + 数量上限** —— P2 / m5）。
 *
 * 规则：
 *   · 每个许可的有效期为 `CONFIG.upgradePermitTurns` 个**自己的回合**；
 *   · 同时持有的许可数不超过 `CONFIG.maxUpgradePermits`；
 *     超限时不再发放（并提示玩家），防止囤积许可后一次性连升多级；
 *   · 旧存档里 `upgradePermits[cell] === true` 的记录视为「刚发放」，
 *     补齐时效字段（向后兼容）。
 *
 * @param {object} state
 * @param {object} player
 * @param {number} cellIndex
 * @returns {{ok:boolean, reason?:string}}
 */
export function grantUpgradePermit(state, player, cellIndex) {
  if (!player.upgradePermits) player.upgradePermits = {};
  // 先清理过期许可
  pruneUpgradePermits(state, player);
  const live = Object.keys(player.upgradePermits).length;
  if (live >= CONFIG.maxUpgradePermits && !player.upgradePermits[cellIndex]) {
    log(state, 'sys',
      `${player.name} 的升级许可已达上限（${CONFIG.maxUpgradePermits} 个），本次不再发放`, '升级');
    return { ok: false, reason: '升级许可已达上限' };
  }
  player.upgradePermits[cellIndex] = {
    turn: state.turnNumber,
    expiresTurn: state.turnNumber + CONFIG.upgradePermitTurns,
  };
  return { ok: true };
}

/**
 * 清理过期的升级许可（在自己的回合结束时调用）。
 * @param {object} state
 * @param {object} player
 */
export function pruneUpgradePermits(state, player) {
  if (!player.upgradePermits) return;
  for (const k of Object.keys(player.upgradePermits)) {
    const p = player.upgradePermits[k];
    if (p === true) {
      // 旧存档格式 → 补齐时效
      player.upgradePermits[k] = {
        turn: state.turnNumber,
        expiresTurn: state.turnNumber + CONFIG.upgradePermitTurns,
      };
      continue;
    }
    if (!p || typeof p.expiresTurn !== 'number' || state.turnNumber > p.expiresTurn) {
      delete player.upgradePermits[k];
    }
  }
}

/**
 * 特殊格结算。
 *
 * ================== 转盘格（kind = 'wheel'）==================
 * 原来 13 个功能特殊格被合并成 4 个转盘格。踩到转盘时：
 *   1. **转盘动画**由 UI 层（src/ui/wheel.js）负责 —— 它随机挑一个候选、
 *      播完动画后把选中的效果 id 回传；
 *   2. 本函数在拿到选中的 id 后，**复用该效果原有的 case 分支**结算。
 *
 * ⚠ 关键设计：这里**不复制粘贴** 13 个 case 的逻辑 —— 而是把
 *   `switch` 的判定对象从「格子自身的 special」换成「实际要结算的 special」，
 *   于是 wheel 分支只需先解析出候选的 special 对象，再 fallthrough 到对应 case。
 *
 * 若 UI 尚未回传选中效果（state.pending.wheelPick 为空），
 * 则在此**就地随机**选一个（AI 玩家 / 降级路径），保证结算永远能走完。
 */
function settleSpecial(state, player, cell, cellIndex = cell.index ?? 0) {
  const results = [];
  let sp = cell.special;

  // ===== 转盘格：解析出真正要结算的效果 =====
  if (sp && sp.kind === 'wheel') {
    const pending = state.pending;
    let pickedId = pending && pending.kind === 'wheel' ? pending.wheelPick : null;
    if (!pickedId) {
      // 兜底：就地随机选一个候选（AI 玩家 / 旧存档降级）
      const outs = sp.outcomes || [];
      if (!outs.length) return results;
      pickedId = outs[state.rng.int(0, outs.length - 1)];
    }
    const picked = SPECIAL[pickedId];
    if (!picked) {
      // 候选 id 无效（数据异常）—— 记一条中性结果，不阻断回合
      results.push({ kind: 'neutral', cell, reason: `转盘未抽到有效效果（${pickedId}）` });
      return results;
    }
    // 记录抽中的效果（玩家要知道自己转到了什么）
    const meta = (sp.outcomeData || []).find((o) => o.id === pickedId) || null;
    results.push({
      kind: 'wheel-result', cell, cellIndex,
      wheelId: sp.wheelId, wheelName: sp.short || sp.name,
      outcomeId: pickedId,
      outcomeName: picked.name || picked.short || pickedId,
      big: meta ? meta.big : '',
      lbl: meta ? meta.lbl : '',
      trap: meta ? !!meta.trap : !!picked.trap,
    });
    // 把结算目标换成抽中的效果 —— 下面的 switch 会直接命中它原有的 case
    sp = picked;
  }

  // ===== 每回合一次的「特殊格闸门」（P1）=====
  // 某些特殊效果**不应该**在一个回合内被反复触发：
  //   · 再融资窗口（发债）—— 一回合内可无限发债 = 无限融资套利；
  //   · 清算所 / 跨境互联（传送）—— 传送后可再落到传送格，形成连锁；
  //   · 地铁枢纽（地铁）—— 传送后可再落到地铁格，形成连锁。
  // 闸门按「效果 id」维度记录：**每个玩家每个回合每种效果只生效一次**。
  const gated = GATED_SPECIALS.has(sp.id);
  if (gated && specialGateUsed(state, player, sp.id)) {
    results.push({
      kind: 'neutral', cell,
      reason: `${sp.name || sp.short || sp.id} 本回合已触发过，本次不再生效`,
    });
    return results;
  }
  if (gated) markSpecialGate(state, player, sp.id);

  switch (sp.id) {
    case 'start': {
      // 起点补贴由 grantStartPass 统一发放（带去重标记），避免重复计息
      const granted = grantStartPass(state, player, cell);
      if (granted) results.push(...granted);
      // 持有中国人民银行 —— 每圈开始获得独享流动性投放（￥350）
      const regBonus = playerRegulatorEffects(state, player).roundBonus || 0;
      if (regBonus > 0) {
        recordCash(state, player, regBonus, '央行流动性投放', '央行');
        results.push({ kind: 'pbc-bonus', amount: regBonus, cell });
      }
      // 经过起点后可申请央行贷款（持有人每圈可贷 2 次，直营利率 5 折）
      // 贷款额度上限 = 基础次数 + 央行牌照加成
      const loanLimit = CONFIG.maxLoansPerRound + (playerRegulatorEffects(state, player).loanLimitBonus || 0);
      if (player.loanCountThisRound < loanLimit) {
        results.push({ kind: 'loan-offer', cell, tiers: CONFIG.loanTiers });
      }
      break;
    }
    case 'tax': {
      // 「合规成本」格：按机构持有规模计征 —— 每份机构 ￥40，最低 ￥120、封顶 ￥360
      const holdings = (player.institutions || []).length;
      const amount = Math.min(360, Math.max(120, holdings * 40));
      recordCash(state, player, -amount, '印花税', '成本');
      results.push({
        kind: 'charge', amount, cell,
        reason: `按机构持有规模（${holdings} 份）计征印花税`,
      });
      break;
    }
    case 'fine': {
      recordCash(state, player, -sp.amount, sp.name, '成本');
      results.push({ kind: 'charge', amount: sp.amount, cell, reason: sp.name });
      break;
    }
    case 'charity': {
      // 慈善公益捐赠：捐出善款换来「公益声誉」——3 回合管理费 +12%
      const amount = sp.amount || 120;
      recordCash(state, player, -amount, '公益捐赠', '成本');
      const buff = addBuff(state, player, {
        id: 'public-good', name: '公益声誉', turns: 3,
        desc: '机构管理费 +12%',
        effect: { rentMult: 1.12 },
      });
      results.push({ kind: 'charge', amount, cell, reason: '金融公益基金捐赠' });
      results.push({ kind: 'buff', cell, buff });
      break;
    }
    case 'clearing': {
      const target = CLEARING_TARGETS[state.rng.int(0, CLEARING_TARGETS.length - 1)];
      results.push({ kind: 'teleport', target, cell, reason: sp.name });
      state.pending = { kind: 'teleport', target, playerId: player.id };
      break;
    }
    case 'crossborder': {
      // 随机飞往另一处机构
      // ⚠ P2（m7）：排除**监管格**与**内环 3 星核心格**。
      //   旧实现从「全部机构格」里随机 —— 意味着跨境互联可能把人
      //   直接送到监管格（一次性买断 ￥3000~3600 的核心资产，
      //   等于「免费抽奖抽中核心资产」），或送到内环 3 星机构
      //   （同样是最贵的几块地）。
      //   现在只在**外环普通机构**里跳 —— 传送是「位置变动」，
      //   不应成为「白拿核心资产」的漏洞。
      const instCells = BOARD_CELLS
        .map((c, i) => {
          if (c.type !== 'institution') return -1;
          if (c.regulator) return -1;                       // 排除监管格
          if (c.star === 3) return -1;                      // 排除 3 星核心资产
          return i;
        })
        .filter((i) => i >= 0);
      const target = instCells.length
        ? instCells[state.rng.int(0, instCells.length - 1)]
        : -1;
      if (target < 0) {
        results.push({ kind: 'neutral', cell, reason: '跨境互联暂无可达机构' });
        break;
      }
      results.push({ kind: 'teleport', target, cell, reason: sp.name });
      state.pending = { kind: 'teleport', target, playerId: player.id };
      break;
    }
    case 'metro': {
      const steps = state.rng.int(1, 3);
      results.push({ kind: 'metro-choice', cell, options: [1, 2, 3] });
      state.pending = { kind: 'metro', playerId: player.id };
      break;
    }
    case 'event': {
      const card = EVENT_CARDS[state.rng.int(0, EVENT_CARDS.length - 1)];
      results.push({ kind: 'event-card', card, cell });
      state.pending = { kind: 'event', cardId: card.id, playerId: player.id };
      break;
    }
    case 'market': {
      const next = state.market === 'bull' ? 'bear' : 'bull';
      state.market = next;
      results.push({ kind: 'market-switch', market: next, cell });
      // 「交易员」职业：行情切换时额外获得一笔价差收益
      // （每圈只发一次，防止反复刷；金额温和，不决定走势）
      const bonus = grantMarketTimingBonus(state, player);
      if (bonus) results.push(bonus);
      break;
    }
    case 'casino': {
      // 私人赌场 · 德州扑克 —— 所有玩家参与一局
      const seats = state.players.filter((p) => !p.bankrupt);
      results.push({
        kind: 'casino-open',
        cell,
        seats: seats.map((p) => p.id),
        reason: sp.name,
      });
      state.pending = { kind: 'casino', playerId: player.id, cellIndex: cellIndex };
      break;
    }
    case 'audit': {
      // 陷阱格 —— 抽取监管事件卡（穿透检查 / 罚款 / 强制披露）
      const card = TRAP_CARDS[state.rng.int(0, TRAP_CARDS.length - 1)];
      results.push({ kind: 'trap-card', card, cell });
      state.pending = { kind: 'trap', cardId: card.id, playerId: player.id };
      break;
    }
    case 'risk': {
      // 「风险警示 · 集中度整改」—— 检查单一集团持仓是否超过 3 家
      const counts = {};
      for (const inst of (player.institutions || [])) {
        const c = BOARD_CELLS[inst.cellIndex];
        if (!c || c.regulator) continue;
        counts[c.group] = (counts[c.group] || 0) + 1;
      }
      let maxGroup = null;
      let maxCount = 0;
      for (const [g, n] of Object.entries(counts)) {
        if (n > maxCount) { maxCount = n; maxGroup = g; }
      }
      if (maxCount >= 4) {
        const fee = (maxCount - 3) * 80;
        recordCash(state, player, -fee, '集中度整改费', '成本');
        const buff = addBuff(state, player, {
          id: 'deleverage', name: '去杠杆整改', turns: 2, kind: 'bad',
          desc: '集中度超限，机构管理费 -15%',
          effect: { rentMult: 0.85 },
        });
        results.push({
          kind: 'charge', amount: fee, cell,
          reason: `${GROUP_META[maxGroup]?.name || maxGroup}持仓 ${maxCount} 家，集中度超限被要求整改`,
        });
        results.push({ kind: 'buff', cell, buff });
      } else {
        results.push({
          kind: 'neutral', cell,
          reason: maxCount > 0
            ? `单一集团最多 ${maxCount} 家，集中度合规，无需整改`
            : '暂无机构持仓，无集中度风险',
        });
      }
      break;
    }
    case 'rating': {
      // 信用评级 —— 随机上调 / 下调展望，持续 3 回合（不再永久改变租金）
      const positive = state.rng.next() < 0.55;
      const buff = addBuff(state, player, positive
        ? {
          id: 'rating-up', group: 'rating', name: '评级上调', turns: 3,
          desc: '展望上调，机构管理费 +15%',
          effect: { rentMult: 1.15 },
        }
        : {
          id: 'rating-down', group: 'rating', name: '评级下调', turns: 3, kind: 'bad',
          desc: '展望下调，机构管理费 -10%',
          effect: { rentMult: 0.90 },
        });
      results.push({
        kind: 'rating-shift', positive, mult: buff.effect.rentMult, cell,
        reason: positive ? '评级展望上调，管理费收益提升' : '评级展望下调，管理费收益承压',
      });
      results.push({ kind: 'buff', cell, buff });
      break;
    }
    case 'commodity': {
      // 要素市场 · 大宗交易 —— 按行情方向折溢价结算，并建立 2 回合套期保值状态
      let amount;
      let reason;
      if (state.market === 'bull') {
        amount = 150 + state.rng.int(0, 3) * 30;
        reason = '牛市大宗商品溢价成交';
      } else if (state.market === 'bear') {
        amount = -(120 + state.rng.int(0, 3) * 30);
        reason = '熊市大宗商品折价出货';
      } else {
        amount = 90;
        reason = '震荡市套利成交';
      }
      recordCash(state, player, amount, reason, amount >= 0 ? '收益' : '成本');
      const buff = addBuff(state, player, {
        id: 'hedge', name: '套期保值', turns: 2,
        desc: '机构管理费 +5%',
        effect: { rentMult: 1.05 },
      });
      results.push(amount >= 0
        ? { kind: 'bonus', amount, cell, reason }
        : { kind: 'charge', amount: -amount, cell, reason });
      results.push({ kind: 'buff', cell, buff });
      break;
    }
    case 'roadshow': {
      // 投资者路演 —— 3 回合内收购与扩表成本降低 15%，另获 ￥80 意向金
      recordCash(state, player, 80, '路演意向金', '收益');
      const buff = addBuff(state, player, {
        id: 'roadshow', name: '路演热度', turns: 3,
        desc: '收购与升级成本 -15%',
        effect: { buyCostMult: 0.85, upgradeCostMult: 0.85 },
      });
      results.push({ kind: 'bonus', amount: 80, cell, reason: '路演意向金到账' });
      results.push({ kind: 'buff', cell, buff });
      break;
    }
    case 'refinance': {
      // 再融资窗口 —— 可向其他玩家发行债券
      results.push({ kind: 'bond-offer', cell });
      state.pending = { kind: 'bond', playerId: player.id };
      break;
    }
    default:
      break;
  }
  return results;
}

/**
 * 应用事件卡效果。
 *
 * ⚠ P1：`scope === 'all'` 的租金系数不再是**永久**改写 `state.eventMult`，
 *   而是变成一个**限时全局状态**（`state.globalBuffs`），
 *   到期自动恢复为 1。
 *   旧实现的问题：任何一张「全行业」事件卡都会**永久**改变全场的租金系数，
 *   而且后来的卡片直接覆盖前面的（取 max / 覆盖），
 *   玩家一旦抽到一张 e9（rentMult 1.20）就永久通吃了。
 *   现在：限时 N 圈、同类叠加取更严格（对收取方更不利）的那个、到期自动失效。
 */
export function applyEventCard(state, player, card) {
  const e = card.effect;
  if (e.cash) {
    recordCash(state, player, e.cash, `事件卡「${card.title}」`, e.cash > 0 ? '收益' : '成本');
  }
  if (e.rentMult && e.scope === 'all') {
    // 限时全局状态：持续 CONFIG.eventMultTurns 圈
    setGlobalBuff(state, {
      id: 'event-rent-mult',
      name: `事件卡「${card.title}」`,
      desc: `全市场管理费 ×${e.rentMult.toFixed(2)}`,
      turns: CONFIG.eventMultTurns,
      effect: { rentMult: e.rentMult },
    });
  }
  emit(state, 'event-applied', { playerId: player.id, cardId: card.id });
  return { cash: e.cash || 0, rentMult: state.eventMult };
}

/**
 * 应用陷阱卡效果（监管抽查 / 风险警示）。
 * 罚金减免来源（取最大，不叠加）：
 *   1. 持有「金融稳定委员会」的玩家 —— 减免 50%
 *   2. 「风控总监」职业 —— 减免 30%
 *
 * ⚠ P1：`scope === 'self'` 的租金系数不再是**永久**写进
 *   `player.selfRentMult`（那是乘算且永不恢复 —— 一次监管抽查
 *   就永久扣掉该玩家 12%~25% 的管理费收入），
 *   现在改成**限时 Buff**（与其它限时状态同构），
 *   到期自动消失；确实需要「永久下调」时用下限 + 恢复机制兜底。
 */
export function applyTrapCard(state, player, card) {
  const e = card.effect;
  let cash = e.cash || 0;
  // 双重压制：
  //   · 持有金稳会 → 罚金全免（trapRelief = 1）
  //   · 他人持有金稳会 → 罚金 ×1.25（victimTrapMult）
  const regEff = playerRegulatorEffects(state, player);
  const regRelief = regEff.trapRelief || 0;
  const victimMult = regEff.trapMult ?? 1;
  // 风控总监职业被动：温和的 30% 罚金缓冲
  const careerRelief = careerEffectValue(player, 'trapRelief');
  const relief = Math.max(regRelief, careerRelief);
  const fromCareer = careerRelief > regRelief;
  if (cash < 0) {
    cash = Math.round(cash * (1 - relief) * victimMult);
  }
  if (cash) recordCash(state, player, cash, `监管卡「${card.title}」`, cash > 0 ? '收益' : '成本');
  if (e.rentMult && e.scope === 'self') {
    addBuff(state, player, {
      id: 'reg-self-rent',
      name: `监管整改 · ${card.title}`,
      desc: `本机构管理费 ×${e.rentMult.toFixed(2)}`,
      turns: CONFIG.selfRentMultTurns,
      kind: 'bad',
      effect: { rentMult: e.rentMult },
    });
  }
  emit(state, 'trap-applied', { playerId: player.id, cardId: card.id, cash });
  log(state, 'bad',
    `${player.name} 触发「${card.title}」：${card.text}`
    + (relief > 0 && cash < 0
      ? (fromCareer ? '（风控总监职业已减免 30% 罚金）' : '（金稳会已减免部分罚金）')
      : ''),
    '监管');
  return { cash, relief };
}

/* ===================================================================
 * 私人赌场 · 德州扑克 —— 主游戏 <-> 小游戏桥接
 * =================================================================== */

/**
 * 开一局德州扑克（由赌场格触发）。
 *
 * 规则要点：
 *   1. 所有**未破产**玩家上桌（至少 2 人才能开局）；
 *   2. 桌上面值 = 现金 + **机构市值**折算额度（资产折算率 50%）；
 *      —— 允许「用资产下注」，但**不转移资产所有权**；
 *      ⚠ F1：折算基数**只能是机构市值**，绝不能包含现金。
 *      `totalAssets()` = 现金 + 机构市值，若直接拿来当折算基数，
 *      等于把现金算两遍（现金既进 cashStack 又进 assetStack），
 *      玩家可以凭空拿到 1.5 倍的桌上面值。
 *   3. 「赌王」职业起始底牌 3 张（其余 2 张），
 *      全局牌库仍严格一副 52 张（见 core/poker.js 的 assertDeckIntegrity）；
 *   4. 结算时现金**最多扣到 0**，不足部分记为资产折让 → 绝不产生负数。
 *
 * @param {object} state 主游戏状态
 * @returns {object|null} 对局对象；人数不足时返回 null
 */
export function startCasinoGame(state) {
  const seats = state.players.filter((p) => !p.bankrupt);
  if (seats.length < 2) return null;

  const participants = seats.map((p) => ({
    id: p.id,
    name: p.name,
    isAI: !!p.isAI,
    cash: Math.max(0, p.cash || 0),
    // 资产折算额度 —— 由 poker.js 内部按 assetBetRatio 折算，
    // 这里只传**机构市值**（不含现金），避免重复折算 / 重复计入现金。
    // ⚠ F1：totalAssets 含现金，必须扣掉 cash 只留机构市值。
    assetValue: Math.max(0, institutionValue(p, state)),
    // 赌王职业：多 1 张底牌
    extraHole: careerEffectValue(p, 'pokerExtraHole'),
    // 量化研究员：坏牌判定更保守（更容易跟牌）
    foldBias: careerEffectValue(p, 'pokerFoldBias'),
    personality: p.personality || null,
    // 主游戏引用（结算时回写现金）
    ref: p,
  }));

  const game = createPokerGame({
    players: participants,
    seed: `${state.seed}:casino:${state.turnNumber}:${state.round}`,
  });
  if (!game) return null;

  // 「量化研究员」职业：坏牌判定更保守（更容易跟牌）
  game.foldBiasById = new Map(participants.map((p) => [p.id, p.foldBias || 0]));

  state.poker = game;
  emit(state, 'casino-opened', { seats: participants.map((p) => p.id) });
  log(state, 'sys',
    `全体玩家进入「私人赌场 · 德州扑克」（${participants.length} 人同桌，牌库一副 52 张）`,
    '赌场');
  return game;
}

/**
 * 结束德州扑克并把结果写回主游戏。
 *
 * 保证：
 *   1. 玩家现金**绝不为负**；
 *   2. 机构所有权 / 等级 / 质押状态**完全不变**；
 *   3. 结算后 `state.poker` 清空，主游戏恢复正常流程。
 *
 * @param {object} state
 * @param {object} game
 * @returns {{deltas:Array, log:Array, pot:number}}
 */
export function finishCasinoGame(state, game) {
  if (!game) return { deltas: [], log: [], pot: 0 };
  const res = settlePoker(game, state);

  for (const d of res.deltas) {
    const p = state.players.find((x) => x.id === d.playerId);
    if (!p) continue;
    // 双保险：现金永不为负
    if (p.cash < 0) p.cash = 0;
    const net = d.net || 0;
    // 现金净额入账 —— poker.js 已经结算过 cash，这里**只写账本**（noteCash 不改现金）
    const cashDelta = d.cashDelta || 0;
    if (cashDelta) {
      noteCash(state, p, cashDelta,
        cashDelta > 0 ? '德州扑克赢得' : '德州扑克投注',
        '赌场');
    }
    const netText = net > 0 ? `赢得 ￥${d.gain}` : (net < 0 ? `净亏 ￥${-net}` : '持平');
    log(state, p.isAI ? 'ai' : 'self',
      `${p.name} 在德州扑克中${netText}`
      + (d.bet > 0 ? `（投注 ￥${d.bet}` + (d.assetStaked > 0 ? `，含资产折让 ￥${d.assetStaked}，机构所有权不变` : '') + '）' : '')
      + (d.handName ? ` · ${d.handName}` : ''),
      '赌场');
  }

  state.poker = null;
  state.pending = null;
  emit(state, 'casino-closed', { pot: res.pot });
  return res;
}

/* ===================================================================
 * 央行贷款 —— 玩家在起点可申请
 * =================================================================== */

/**
 * 申请央行贷款。
 * @returns {{ok:boolean, reason?:string, amount?:number}}
 */
export function takeCentralLoan(state, player, tierId) {
  if (!state || !player) return { ok: false, reason: '状态无效' };
  const tier = CONFIG.loanTiers.find((t) => t.id === tierId);
  if (!tier) return { ok: false, reason: '未知的贷款档位' };
  // 央行牌照：持有人每圈可多贷一次（loanLimitBonus）+ 直营利率折扣
  const regEff = playerRegulatorEffects(state, player);
  const loanLimit = CONFIG.maxLoansPerRound + (regEff.loanLimitBonus || 0);
  if (player.loanCountThisRound >= loanLimit) {
    return { ok: false, reason: '本圈已申请过贷款' };
  }
  const rateMult = regEff.loanRateMult ?? 1;
  const interestPerTurn = loanInterestPerTurn(tier, rateMult);
  const repay = loanRepayAmount(tier.id, rateMult);
  const loan = {
    id: `loan${state.turnNumber}_${player.id}`,
    tier: tier.id,
    name: tier.name,
    amount: tier.amount,
    rate: tier.rate * rateMult,
    term: tier.term,
    interestPerTurn,
    accruedInterest: 0,   // 现金不足时未付的利息（欠息）
    interestPaid: 0,      // 已付利息累计
    repay,                // 本息合计（展示用）
    takenTurn: state.turnNumber,
    turnsElapsed: 0,      // 已经历的「自己的回合」数
  };
  recordCash(state, player, tier.amount, `央行贷款「${tier.name}」`, '融资');
  player.loans.push(loan);
  player.loanCountThisRound += 1;
  emit(state, 'loan-taken', { playerId: player.id, loan });
  log(state, player.isAI ? 'ai' : 'self',
    `${player.name} 向央行申请「${tier.name}」贷款 ￥${tier.amount}，` +
    `期限 ${tier.term} 个自己的回合：每回合付息 ￥${interestPerTurn}，到期归还本金`,
    '融资');
  return { ok: true, amount: tier.amount, repay, interestPerTurn, loan };
}

/** 偿还一笔贷款（到期或提前）—— 归还本金 + 未付欠息，已付利息不退 */
export function repayLoan(state, player, loanId) {
  const loan = (player.loans || []).find((l) => l.id === loanId);
  if (!loan) return { ok: false, reason: '未找到该贷款' };
  const owed = loanOutstandingAmount(loan);
  if (player.cash < owed) {
    return { ok: false, reason: `偿还需 ￥${owed}，现金不足` };
  }
  recordCash(state, player, -owed, `结清贷款「${loan.name}」`, '还款');
  player.loans = player.loans.filter((l) => l.id !== loanId);
  emit(state, 'loan-repaid', { playerId: player.id, amount: owed });
  log(state, player.isAI ? 'ai' : 'self',
    `${player.name} 提前结清央行贷款，归还本金 ￥${loan.amount}`
    + (loan.accruedInterest ? ` + 欠息 ￥${loan.accruedInterest}` : ''), '还款');
  return { ok: true, amount: owed };
}

/* ===================================================================
 * 债券发行 —— 再融资窗口格
 * =================================================================== */

/**
 * 尝试发行债券：需至少 bondMinSubscribers 名其他玩家认购方成立。
 *
 * 票息由发行人财务状况决定（见 economy.bondCouponFor），而非固定值；
 * 认购结果由市场（AI / 真人认购意愿）决定，发行人不能自行判定成败。
 *
 * @param {object} state
 * @param {object} issuer 发行方
 * @param {Array<{playerId:number, subscribed:boolean}>} decisions 各玩家的认购意愿
 */
export function issueBond(state, issuer, decisions) {
  if (!state || !issuer) return { ok: false, reason: '状态无效' };
  const min = bondMinSubscribers();
  const coupon = bondCouponFor(state, issuer);
  const couponPer = Math.round(CONFIG.bondFace * coupon);
  const subs = (decisions || []).filter((d) => {
    if (!d.subscribed) return false;
    const buyer = state.players.find((p) => p.id === d.playerId);
    return buyer && !buyer.bankrupt && buyer.cash >= CONFIG.bondFace;
  });
  if (subs.length < min) {
    log(state, 'sys',
      `${issuer.name} 的债券发行未获通过：仅 ${subs.length} 人认购，未达 ${min} 人门槛`,
      '债券');
    emit(state, 'bond-failed', { playerId: issuer.id, subscribers: subs.length });
    return {
      ok: false, min,
      reason: `认购人数不足（${subs.length}/${min}）`,
      subscribers: subs.length, coupon,
    };
  }
  const bond = {
    // ⚠ m1：债券 id 改为**全局自增**。
    //   旧写法 `bond${turnNumber}_${issuerId}` 在「同一回合内同一发行人
    //   发多笔债」或「多局/读档」时会撞 id —— 认购方的 subscribedBonds
    //   按 id 匹配，一旦撞 id 就会串账（多债共用一条持有记录、
    //   兑付时重复清除）。
    //   现在用 state 内的全局自增计数器，天然唯一且可复现。
    id: nextBondId(state),
    issuerId: issuer.id,
    face: CONFIG.bondFace,
    coupon,
    couponPer,
    subscribers: subs.map((s) => s.playerId),
    couponsPaid: 0,
    issuedRound: state.round,
    // ⚠ P1：到期圈数按**发行方自己的圈数**记（而不是全局 state.round），
    //   再由 processBonds 用「中位圈数」与之比较 —— 保证不同座位
    //   速度不同时，债券的存续期是稳定的「N 圈」而不是「N 次绕圈事件」。
    dueLap: (issuer.laps || 0) + CONFIG.bondTerm,
    dueRound: state.round + CONFIG.bondTerm,
  };
  issuer.bonds.push(bond);
  for (const s of subs) {
    const buyer = state.players.find((p) => p.id === s.playerId);
    if (!buyer) continue;
    recordCash(state, buyer, -CONFIG.bondFace, '认购公司债券', '债券');
    buyer.subscribedBonds.push({
      id: bond.id, issuerId: issuer.id, face: CONFIG.bondFace,
      coupon, couponPer, couponsPaid: 0,
      dueLap: bond.dueLap, dueRound: bond.dueRound,
    });
  }
  recordCash(state, issuer, CONFIG.bondFace * subs.length, `发行债券募资（${subs.length} 家认购）`, '债券');
  emit(state, 'bond-issued', { playerId: issuer.id, bondId: bond.id, subscribers: subs.length });
  log(state, issuer.isAI ? 'ai' : 'self',
    `${issuer.name} 成功发行债券，获 ${subs.length} 家认购，募资 ￥${CONFIG.bondFace * subs.length}，票息 ${Math.round(coupon * 1000) / 10}%`,
    '债券');
  return {
    ok: true, bond, subscribers: subs.length,
    raised: CONFIG.bondFace * subs.length, coupon, min,
  };
}

/**
 * 市场化发行 —— 由市场随机决定认购结果。
 *
 * 认购意愿 = 票息溢价吸引力 + 自身资金充裕度 + 市场风险偏好 + 随机噪声。
 * 票息越高越抢手，但高票息本身就是发行人财务状况差的信号。
 */
export function underwriteBond(state, issuer) {
  const coupon = bondCouponFor(state, issuer);
  const others = state.players.filter((p) => p.id !== issuer.id && !p.bankrupt);
  const decisions = others.map((p) => {
    let willingness = 0.45;
    // 票息相对基准 6% 每高 1 个百分点，认购意愿 +0.08
    willingness += ((coupon - CONFIG.bondCoupon) / 0.01) * 0.08;
    if (p.cash >= CONFIG.bondFace * 4) willingness += 0.15;
    else if (p.cash < CONFIG.bondFace * 2) willingness -= 0.30;
    if (state.market === 'bull') willingness += 0.08;
    else if (state.market === 'bear') willingness -= 0.12;
    willingness += (state.rng.next() * 2 - 1) * 0.25;
    const subscribed = willingness > 0.5 && p.cash >= CONFIG.bondFace;
    return { playerId: p.id, subscribed };
  });
  return issueBond(state, issuer, decisions);
}

/**
 * 每圈结束时的债券付息与到期兑付。
 *
 * ================== 违约口径（F3）=================
 * 债券是**有信用风险**的融资工具，否则「发债」就等于无风险套利：
 *   1. **发行方破产** → 该笔债券**停止付息、到期跳过兑付**，
 *      债权人（认购方）**损失全部本金**（已收的票息不退）；
 *      该债券从发行方的 `bonds` 中移除，并从每个认购方的
 *      `subscribedBonds` 中移除（债一笔勾销）。
 *   2. **认购方破产** → 跳过该认购方的票息收入与本金回款
 *      （钱付给谁？付给一个已清算的玩家毫无意义），
 *      但**发行方仍需向其他未破产的认购方足额兑付**。
 *      破产认购方的认购记录同样被清除。
 *   3. 发行方**现金不足以付息/兑付**时 → 不足部分计入欠息
 *      （不凭空扣成负数），到期兑付时按实际现金兑付。
 *
 * 破产方在 `liquidate()` 中已被清空 `bonds` / `subscribedBonds`，
 * 因此这里主要处理「发行方在付息环节刚刚破产」的边界情况。
 *
 * @param {object} state
 * @param {number} [currentLap] 当前中位圈数（到期判定基准；缺省用 state.round）
 * @returns {string[]} 播报文案
 */
export function processBonds(state, currentLap = null) {
  const notes = [];
  const findPlayer = (id) => state.players.find((x) => x.id === id);
  // 到期判定基准：中位圈数优先（公平），缺省回落到 state.round（旧调用方兼容）
  const lap = (currentLap == null) ? (state.round || 0) : currentLap;

  for (const p of state.players) {
    // ===== 发行方已破产：该笔债券直接勾销（债权人损失本金）=====
    if (p.bankrupt) {
      for (const b of (p.bonds || [])) {
        const lost = b.face * (b.subscribers ? b.subscribers.length : 0);
        for (const sid of (b.subscribers || [])) {
          const buyer = findPlayer(sid);
          if (!buyer) continue;
          buyer.subscribedBonds = buyer.subscribedBonds.filter((x) => x.id !== b.id);
        }
        notes.push(`${p.name} 已破产，其发行的债券违约，认购方损失本金 ￥${lost}`);
      }
      p.bonds = [];
      continue;
    }

    // ===== 发行方付息 =====
    for (const b of (p.bonds || [])) {
      const aliveSubs = (b.subscribers || []).filter((sid) => {
        const buyer = findPlayer(sid);
        return buyer && !buyer.bankrupt;
      });
      if (!aliveSubs.length) {
        // 全部认购方都已破产 → 无人可付、无人可收，直接勾销
        for (const sid of (b.subscribers || [])) {
          const buyer = findPlayer(sid);
          if (!buyer) continue;
          buyer.subscribedBonds = buyer.subscribedBonds.filter((x) => x.id !== b.id);
        }
        notes.push(`${p.name} 的债券已无存续认购方，予以注销`);
        continue;
      }
      const due = Math.round(b.couponPer * aliveSubs.length);
      // 现金不足 → 只付得起多少付多少，差额计入欠息（不扣成负数）
      const paid = Math.min(due, Math.max(0, p.cash || 0));
      if (paid > 0) {
        recordCash(state, p, -paid, `债券票息（${aliveSubs.length} 家）`, '付息');
      }
      const unpaid = due - paid;
      if (unpaid > 0) {
        b.accruedInterest = (b.accruedInterest || 0) + unpaid;
        notes.push(`${p.name} 现金不足，债券票息 ￥${unpaid} 转为欠息`);
      }
      for (const sid of aliveSubs) {
        const buyer = findPlayer(sid);
        if (!buyer) continue;
        recordCash(state, buyer, b.couponPer, '债券票息收入', '收益');
        const held = (buyer.subscribedBonds || []).find((x) => x.id === b.id);
        if (held) held.couponsPaid += 1;
      }
      b.couponsPaid += 1;
      notes.push(`${p.name} 支付债券票息 ￥${paid}`);
    }

    // ===== 到期兑付本金 =====
    // 到期判定优先用 dueLap（中位圈数口径）；旧存档没有该字段时回落到 dueRound。
    const matured = (p.bonds || []).filter((b) => {
      const due = (b.dueLap != null) ? b.dueLap : b.dueRound;
      return lap >= due;
    });
    for (const b of matured) {
      const aliveSubs = (b.subscribers || []).filter((sid) => {
        const buyer = findPlayer(sid);
        return buyer && !buyer.bankrupt;
      });
      const total = b.face * aliveSubs.length;
      // 兑付口径（m2）：本金按**发行时实际认购人数**的存活部分兑付，
      // 票息在到期当期照付（与到期同时结算）。
      const paid = Math.min(total, Math.max(0, p.cash || 0));
      if (paid > 0) {
        recordCash(state, p, -paid, `债券到期兑付（${aliveSubs.length} 家）`, '还款');
      }
      const shortfall = total - paid;
      if (shortfall > 0) {
        notes.push(`${p.name} 债券到期兑付缺口 ￥${shortfall}（现金不足，部分兑付）`);
      }
      for (const sid of aliveSubs) {
        const buyer = findPlayer(sid);
        if (!buyer) continue;
        // 按「实际兑付比例」分配，避免兑付不足时多发
        const ratio = total > 0 ? paid / total : 0;
        const back = Math.round(b.face * ratio);
        if (back > 0) {
          recordCash(state, buyer, back, '债券本金回款', '收益');
        }
        buyer.subscribedBonds = (buyer.subscribedBonds || []).filter((x) => x.id !== b.id);
      }
      // 破产认购方的记录一并清除（他们拿不到钱）
      for (const sid of (b.subscribers || [])) {
        const buyer = findPlayer(sid);
        if (!buyer) continue;
        buyer.subscribedBonds = (buyer.subscribedBonds || []).filter((x) => x.id !== b.id);
      }
      p.bonds = p.bonds.filter((x) => x.id !== b.id);
      notes.push(`${p.name} 债券到期兑付 ￥${paid}`);
    }
  }
  return notes;
}

/**
 * 玩家决定是否收购。
 * @returns {boolean} 是否成交
 */
export function resolveTakeover(state, player, accept) {
  const pend = state.pending;
  if (!pend || pend.kind !== 'takeover') return false;
  const cell = BOARD_CELLS[pend.cellIndex];
  const owner = (state.players || []).find((p) => p.id === pend.to);

  if (!accept) {
    log(state, 'sys', `${player.name} 放弃了强制收购 ${cell.name} 的机会`, '放弃');
    state.pending = null;
    return false;
  }
  if (!owner || owner.bankrupt) {
    log(state, 'bad', `原持有人已不在场，强制收购 ${cell.name} 失败`, '收购');
    state.pending = null;
    return false;
  }
  const ownerInst = owner.institutions.find((i) => i.cellIndex === pend.cellIndex);
  if (!ownerInst || !ownerInst.mortgaged) {
    log(state, 'sys', `${cell.name} 已不在质押状态，强制收购取消`, '收购');
    state.pending = null;
    return false;
  }

  const level = ownerInst.level;
  const mult = CONFIG.forcedTakeoverMult ?? 2;
  const price = pend.price ?? Math.round((cell.price[level] ?? 0) * mult);
  if (player.cash < price) {
    log(state, 'bad', `${player.name} 现金不足，无法强制收购 ${cell.name}（需 ￥${price}）`, '缺钱');
    state.pending = null;
    return false;
  }

  // 成交：买方付款 → 原持有人收款 → 机构连等级一起过户（质押状态清除）
  recordCash(state, player, -price, `强制收购 ${cell.name}`, '收购');
  recordCash(state, owner, price, `被强制收购 ${cell.name}`, '转让');
  owner.institutions = owner.institutions.filter((i) => i.cellIndex !== pend.cellIndex);
  player.institutions.push({
    cellIndex: pend.cellIndex,
    level,
    mortgaged: false,
    mortgageAmount: 0,
  });
  player.stats.acquisitions += 1;
  player.stats.acquisitionSpend += price;
  state.pending = null;
  emit(state, 'takeover', { playerId: player.id, from: owner.id, cellIndex: pend.cellIndex, price, level });
  log(state, player.isAI ? 'ai' : 'self',
    `${player.name} 以 ￥${price} 强制收购了 ${owner.name} 已质押的 ${cell.name}（${levelLabel(level)}，${mult} 倍含建筑等级价）`,
    '收购');
  return true;
}

/**
 * 玩家决定是否收购。
 * @returns {boolean} 是否成交
 */
export function resolvePurchase(state, player, accept) {
  const pend = state.pending;
  if (!pend || pend.kind !== 'purchase') return false;
  const cell = BOARD_CELLS[pend.cellIndex];

  if (!accept) {
    log(state, 'sys', `${player.name} 放弃了收购 ${cell.name} 的机会`, '放弃');
    state.pending = null;
    return false;
  }

  const price = pend.price;
  if (player.cash < price) {
    log(state, 'bad', `${player.name} 现金不足，无法收购 ${cell.name}`, '缺钱');
    state.pending = null;
    return false;
  }

  recordCash(state, player, -price, `买入 ${cell.name}`, '收购');
  player.institutions.push({
    cellIndex: pend.cellIndex,
    level: pend.level,
    mortgaged: false,
    mortgageAmount: 0,
  });
  player.stats.acquisitions += 1;
  player.stats.acquisitionSpend += price;
  state.pending = null;
  emit(state, 'purchase', { playerId: player.id, cellIndex: pend.cellIndex, price });
  log(state, player.isAI ? 'ai' : 'self',
    `${player.name} 以 ￥${price} 收购了 ${cell.name} ${GROUP_META[cell.group].short}经营权`,
    '收购');
  return true;
}

/**
 * 升级一个机构。
 *
 * 规则约束：
 *   1. 监管机构不可升级
 *   2. 必须「再次踩到」该自有地块才获得升级许可（upgradePermits）
 *   3. 持有中国证监会时升级费享受注册制便利（-12%）
 *
 * @param {object} opts { force } —— force=true 时跳过许可检查（仅供测试/GM 用途）
 * @returns {{ok:boolean, reason?:string, cost?:number}}
 */
export function upgradeInstitution(state, player, cellIndex, opts = {}) {
  const inst = player.institutions.find((i) => i.cellIndex === cellIndex);
  if (!inst) return { ok: false, reason: '未持有该机构' };
  if (inst.mortgaged) return { ok: false, reason: '已质押机构需先赎回' };

  const cell = BOARD_CELLS[cellIndex];
  if (cell.regulator) return { ok: false, reason: '监管机构不可升级' };
  if (inst.level >= cell.maxLevel) return { ok: false, reason: '已达最高等级' };

  // 必须先踩到该地块才有升级许可
  // ⚠ P2（m5）：许可带**时效** —— 过期后即使踩过也不能升级
  //   （防止「踩一次 → 攒着 → 随时用」的无限期许可能力）。
  if (!opts.force) {
    const permit = player.upgradePermits?.[cellIndex];
    if (!permit) {
      return { ok: false, reason: '需再次踏足该机构才能升级' };
    }
    if (permit !== true) {
      const expires = typeof permit.expiresTurn === 'number' ? permit.expiresTurn : null;
      if (expires != null && state.turnNumber > expires) {
        delete player.upgradePermits[cellIndex];
        return { ok: false, reason: '升级许可已过期，请再次踏足该机构' };
      }
    }
  }

  const regEff = playerRegulatorEffects(state, player);
  const baseCost = upgradeCost(cell, inst.level, { regulatorCostMult: regEff.upgradeCostMult });
  // 路演等限时状态 + 基金经理职业（-6%）可降低扩表成本
  const cost = Math.round(baseCost * playerCostMult(player, 'upgradeCostMult'));
  if (player.cash < cost) return { ok: false, reason: '现金不足', cost };

  recordCash(state, player, -cost, `升级 ${cell.name}`, '升级');
  inst.level += 1;
  player.stats.upgrades += 1;
  player.stats.upgradeSpend += cost;
  // 升级许可消耗，需再次踩到才能继续升级
  if (player.upgradePermits) delete player.upgradePermits[cellIndex];
  emit(state, 'upgrade', { playerId: player.id, cellIndex, level: inst.level });
  log(state, player.isAI ? 'ai' : 'self',
    `${player.name} 将 ${cell.name} 升级至 ${levelLabel(inst.level)}，支出 ￥${cost}`,
    '升级');
  return { ok: true, cost };
}

/**
 * 质押机构融资。
 */
export function mortgageInstitution(state, player, cellIndex) {
  const inst = player.institutions.find((i) => i.cellIndex === cellIndex);
  if (!inst) return { ok: false, reason: '未持有该机构' };
  if (inst.mortgaged) return { ok: false, reason: '该机构已质押' };

  const cell = BOARD_CELLS[cellIndex];
  // 金稳会牌照：质押融资可得金额 +30%（风险处置通道畅通）
  const regEff = playerRegulatorEffects(state, player);
  const amount = Math.round(mortgageValue(cell, inst.level) * (regEff.mortgageMult ?? 1));
  recordCash(state, player, amount, `质押 ${cell.name}`, '质押');
  inst.mortgaged = true;
  inst.mortgageAmount = amount;
  emit(state, 'mortgage', { playerId: player.id, cellIndex, amount });
  log(state, player.isAI ? 'ai' : 'self',
    `${player.name} 将 ${cell.name} 质押融资，获得 ￥${amount}`,
    '质押');
  return { ok: true, amount };
}

/**
 * 赎回机构 —— 必须一次性归还「质押本金 + 解押费」。
 *
 * 反套利约束：质押可得本金（市值×0.55），赎回须还本金并额外支付 12% 解押费，
 * 因此「质押→赎回」一进一出必为净亏损，无法在一回合内反复刷现金。
 */
export function redeemInstitution(state, player, cellIndex) {
  const inst = player.institutions.find((i) => i.cellIndex === cellIndex);
  if (!inst) return { ok: false, reason: '未持有该机构' };
  if (!inst.mortgaged) return { ok: false, reason: '该机构未质押' };

  const principal = inst.mortgageAmount || 0;
  const fee = redeemFee(principal);
  const total = principal + fee;
  if (player.cash < total) {
    return {
      ok: false,
      reason: `赎回需 ￥${total}（本金 ￥${principal} + 解押费 ￥${fee}），现金不足`,
      cost: total,
    };
  }

  const cell = BOARD_CELLS[cellIndex];
  recordCash(state, player, -total, `赎回 ${cell.name}`, '赎回');
  player.stats.redeemSpend += total;
  inst.mortgaged = false;
  inst.mortgageAmount = 0;
  emit(state, 'redeem', { playerId: player.id, cellIndex, fee, total });
  log(state, player.isAI ? 'ai' : 'self',
    `${player.name} 赎回 ${cell.name}，归还本金 ￥${principal} + 解押费 ￥${fee}`,
    '赎回');
  return { ok: true, fee, total };
}

/** 回合结束 —— 轮转下一个未破产玩家 */
export function endTurn(state) {
  const player = currentPlayer(state);

  // 追缴保证金：现金为负必须先质押补足，补不足才进入破产清算
  if (!player.bankrupt && player.cash < 0) {
    const raised = raiseFundsForDeficit(state, player);
    if (raised.length) {
      const total = raised.reduce((s, r) => s + r.amount, 0);
      log(state, 'bad',
        `${player.name} 现金缺口触发追缴保证金，追加质押 ${raised.length} 家机构，补足 ￥${total}`,
        '追保');
    }
  }

  // 结算本回合可能产生的破产
  checkBankruptcy(state, player);

  // 限时状态递减（只对本人的回合生效）
  tickBuffs(state, player);

  // 央行贷款：按「借款人自己的回合」逐期付息，最后一期归还本金
  // （放在回合号自增之前，借入当回合不会立即扣息）
  serviceLoans(state, player);

  // 推进指针，跳过破产玩家
  let guard = 0;
  do {
    state.currentPlayerIndex = (state.currentPlayerIndex + 1) % state.players.length;
    guard++;
  } while (state.players[state.currentPlayerIndex].bankrupt && guard < state.players.length * 2);

  state.turnNumber += 1;
  state.phase = 'await-roll';

  // 起点经过 → 圈数 +1（消费后立即清除，避免重复触发）
  if (player.lastAction?.passedStart) {
    player.lastAction.passedStart = false;
    // 「每圈最多贷一次」只对该玩家自己的圈生效
    player.loanCountThisRound = 0;
    // ⚠ P1：**玩家自己的圈数**（player.laps）与全局圈数（state.round）分离。
    //   旧逻辑把 state.round 当作「全局推进的圈数」，谁先绕圈谁加 1，
    //   于是：
    //     · 债券到期（dueRound）按“谁先绕圈”结算 —— 同一个 dueRound
    //       在不同对局里对应的真实时长完全不同；
    //     · 牛熊切换按 state.round % 3 —— 同样受“谁先绕圈”影响，
    //       一个跑得快的玩家就能把全场的牛熊节奏带偏；
    //     · 贷款「每圈一次」的重置时机（见上）与实际圈数脱节。
    //   现在 player.laps 记录「该玩家自己绕了多少圈」，
    //   state.round 仍表示「全局已发生几次绕圈事件」（用于 HUD 展示），
    //   而**周期与债券到期一律按玩家自己的圈数（中位数）判定**。
    player.laps = (player.laps || 0) + 1;
    state.round += 1;
    // 「交易员」职业的择时奖励**每玩家每圈只发一次** ——
    // 去重键用的是 `player.laps`，所以必须**先加 laps 再重置标记**，
    // 否则本圈刚发过奖励就会被清掉，下一次切换又能再发（可被反复刷）。
    player._marketBonusLap = null;
    // 起点补贴的去重标记同样按**圈号**记录（见 grantStartPass），
    // 圈号推进后自然解锁下一圈，无需在这里手动清标志。
    // 维持成本：谁走完一圈就结谁的（不再全场一起结）
    onRoundComplete(state, player);
  }

  // 游戏结束检测
  const alive = state.players.filter((p) => !p.bankrupt);
  if (alive.length <= 1) {
    state.phase = 'gameover';
    emit(state, 'gameover', { winnerId: alive[0]?.id ?? null });
    return alive[0] || null;
  }

  // 死循环保护
  if (state.turnNumber > state.maxTurns) {
    state.phase = 'gameover';
    return rankPlayers(state)[0];
  }

  return currentPlayer(state);
}

/**
 * 取全桌玩家的「中位圈数」—— 周期与债券到期的统一时间基准（P1）。
 *
 * 为什么要中位数而不是 state.round：
 *   · `state.round` 是「全局发生过几次绕圈事件」，谁先跑完谁贡献 1，
 *     一个跑得快的玩家就能把全场的节奏带偏；
 *   · `player.laps` 是每个玩家**自己**绕的圈数；
 *   · 中位数对「跑得快 / 跑得慢 / 已破产」的个体差异不敏感，
 *     是最接近「全场真实进度」的度量。
 *
 * @param {object} state
 * @returns {number} 中位圈数（至少 0）
 */
export function medianLaps(state) {
  const vals = (state.players || [])
    .filter((p) => !p.bankrupt)
    .map((p) => p.laps || 0)
    .sort((a, b) => a - b);
  if (!vals.length) return 0;
  const mid = Math.floor(vals.length / 2);
  return vals.length % 2 ? vals[mid] : Math.round((vals[mid - 1] + vals[mid]) / 2);
}

/**
 * 结算某位玩家的**维持成本**（该角色自己走完一圈时结算一次）。
 *
 * ⚠ 这是「破产机制可触发」与「不存在必赢策略」的关键一环。
 *   旧版没有持有侧成本 —— 铺满机构后每圈只进不出，
 *   形成「正现金流永动机」，破产几乎不会发生。
 *
 * 规则：
 *   · 谁走完一圈就结谁的（按各机构的**等级**计费，高级位更贵）；
 *   · 监管机构不收维持成本（它们的价值在全局效果上）；
 *   · 现金不足以支付时：先扣到 0（不产生负数），
 *     剩余部分转为**欠费**，并立即触发追保 / 破产检查；
 *   · 欠费累计超过**市值的 50%** → 强制清算（资不抵债）。
 *
 * @param {object} state
 * @param {object|null} target 只结算该玩家；传空则结算全场（兼容旧调用）
 * @returns {string[]} 播报文案
 */
export function chargeMaintenanceCosts(state, target = null) {
  const notes = [];
  const list = target
    ? [target]
    : (state.players || []);
  for (const p of list) {
    if (!p || p.bankrupt) continue;
    const insts = (p.institutions || []);
    if (!insts.length) continue;

    let due = 0;
    // 金稳会牌照：维持成本 5 折（风险处置基金补贴）
    const maintMult = playerRegulatorEffects(state, p).maintenanceMult ?? 1;
    for (const inst of insts) {
      const cell = BOARD_CELLS[inst.cellIndex];
      if (!cell) continue;
      due += maintenanceCost(cell, inst.level);
    }
    if (due <= 0) continue;
    due = Math.round(due * maintMult);

    const paid = Math.min(due, Math.max(0, p.cash || 0));
    if (paid > 0) {
      recordCash(state, p, -paid, '机构维持成本', '维持成本');
    }
    const unpaid = due - paid;
    if (unpaid > 0) {
      p.maintenanceDebt = (p.maintenanceDebt || 0) + unpaid;
      notes.push(`${p.name} 维持成本 ￥${due}，现金仅够支付 ￥${paid}，欠费 ￥${unpaid}`);
      // 欠费 → 追保 → 仍不足则破产
      if (p.cash < 0) {
        const raised = raiseFundsForDeficit(state, p);
        if (raised.length) {
          const total = raised.reduce((s, r) => s + r.amount, 0);
          notes.push(`${p.name} 维持成本缺口触发追缴保证金，追加质押 ${raised.length} 家机构补足 ￥${total}`);
        }
      }
      checkBankruptcy(state, p);
      // 欠费超过资产 50% → 强制清算（资不抵债式清算，不走流动性判定）
      const assets = totalAssets(p, state);
      if (!p.bankrupt && p.maintenanceDebt > assets * 0.5) {
        notes.push(`${p.name} 维持成本欠费 ￥${p.maintenanceDebt} 超过资产 50%，强制清算`);
        checkBankruptcy(state, p, { force: true, reason: '维持成本欠费超过资产 50%' });
      }
    } else {
      notes.push(`${p.name} 支付机构维持成本 ￥${paid}`);
    }
  }
  return notes;
}

/**
 * 每圈结束 —— 触发牛熊周期切换、债券付息、贷款到期
 *
 * ⚠ P1：牛熊周期与债券到期一律按**中位圈数**（medianLaps）判定，
 *   而非 state.round —— 保证不同座位速度不同也能公平对齐。
 */
function onRoundComplete(state, lapPlayer = null) {
  const lap = medianLaps(state);

  // 限时全局状态递减（P1：事件卡的全场租金系数到期自动恢复）
  tickGlobalBuffs(state);

  // 维持成本结算：谁走完一圈就结谁的（lapPlayer 为本次绕圈的角色）
  const maintNotes = chargeMaintenanceCosts(state, lapPlayer);
  for (const n of maintNotes) log(state, 'bad', n, '维持成本');

  // 牛熊周期切换（按中位圈数）
  if (lap > 0 && lap % CONFIG.marketCycleRounds === 0) {
    const next = state.market === 'bull' ? 'bear' : 'bull';
    state.market = next;
    const label = next === 'bull' ? '牛市' : '熊市';
    log(state, next === 'bull' ? 'good' : 'bad',
      `行情切换：进入${label}，全市场租金系数调整为 ${next === 'bull' ? '+20%' : '-20%'}`,
      '周期');
    emit(state, 'market-shift', { market: next, round: state.round, laps: lap });
    // 「交易员」职业：自动切换行情时同样发放择时价差收益
    // （与转盘抽到「牛熊切换」共用同一套逻辑，每玩家每圈只发一次）
    for (const p of state.players) {
      if (p.bankrupt) continue;
      const b = grantMarketTimingBonus(state, p);
      if (b) {
        log(state, 'good', `${p.name} 择时价差收益 +￥${b.amount}`, '职业');
      }
    }
  }

  // 债券付息与到期兑付（到期判定同样按中位圈数）
  const bondNotes = processBonds(state, lap);
  for (const n of bondNotes) log(state, 'sys', n, '债券');
}

/**
 * 央行贷款逐期还本付息 —— 只在「借款人自己的回合」结算。
 *
 * 时间线：
 *   · 借入当回合不扣息（takenTurn === 当前回合时跳过）；
 *   · 之后每个自己的回合扣当期利息（本金 × 单利），现金不足计入「欠息」；
 *   · 第 term 个自己的回合，在扣完当期利息后归还本金 + 欠息。
 *
 * 因此期限与「自己走几回合」严格对应，不会被别人绕圈催收，
 * 也不会出现「刚借一轮就被要求还钱」。
 */
function serviceLoans(state, player) {
  if (player.bankrupt) return;
  const loans = player.loans || [];
  if (!loans.length) return;
  for (const l of [...loans]) {
    if (state.turnNumber === l.takenTurn) continue;
    l.turnsElapsed = (l.turnsElapsed || 0) + 1;

    const interest = l.interestPerTurn ?? Math.round(l.amount * l.rate);
    if (player.cash >= interest) {
      recordCash(state, player, -interest, `贷款「${l.name}」第 ${l.turnsElapsed}/${l.term} 期利息`, '付息');
      l.interestPaid = (l.interestPaid || 0) + interest;
      log(state, player.isAI ? 'ai' : 'self',
        `${player.name} 支付「${l.name}」第 ${l.turnsElapsed}/${l.term} 期利息 ￥${interest}`, '付息');
    } else {
      l.accruedInterest = (l.accruedInterest || 0) + interest;
      log(state, 'bad',
        `${player.name} 现金不足，「${l.name}」第 ${l.turnsElapsed}/${l.term} 期利息 ￥${interest} 转为欠息（累计 ￥${l.accruedInterest}）`,
        '欠息');
    }

    if (l.turnsElapsed >= l.term) {
      const accrued = l.accruedInterest || 0;
      const owed = l.amount + accrued;
      const shortfall = owed - player.cash;
      recordCash(state, player, -owed, `贷款「${l.name}」到期还本`, '还款');
      player.loans = player.loans.filter((x) => x.id !== l.id);
      if (shortfall <= 0) {
        log(state, 'sys',
          `${player.name} 贷款「${l.name}」到期，归还本金 ￥${l.amount}`
          + (accrued ? ` + 欠息 ￥${accrued}` : '') + '（利息已按期支付）', '还款');
      } else {
        // 现金不足时先追保（质押补足），补不足才强制平仓
        const raised = player.cash < 0 ? raiseFundsForDeficit(state, player) : [];
        if (raised.length) {
          const total = raised.reduce((s, r) => s + r.amount, 0);
          log(state, 'bad',
            `${player.name} 贷款「${l.name}」到期，现金缺口追保：追加质押 ${raised.length} 家机构补足 ￥${total}`,
            '追保');
        } else {
          log(state, 'bad',
            `${player.name} 贷款「${l.name}」到期，现金不足 ￥${shortfall}，触发强制平仓`, '违约');
        }
      }
      checkBankruptcy(state, player);
      emit(state, 'loan-repaid', { playerId: player.id, amount: owed, loanId: l.id });
    }
  }
}

/**
 * 追缴保证金：现金为负时，强制质押未质押机构以补足缺口。
 *
 * 按质押可得金额从高到低依次抵押，直到现金回到 0 以上。
 * 若全部质押后仍为负，交由 checkBankruptcy 平仓清算。
 *
 * @returns {Array<{cellIndex:number, amount:number, name:string}>} 本次追加质押明细
 */
export function raiseFundsForDeficit(state, player) {
  const raised = [];
  if (!player || player.bankrupt || player.cash >= 0) return raised;

  const candidates = (player.institutions || [])
    .filter((inst) => !inst.mortgaged)
    .map((inst) => {
      const cell = BOARD_CELLS[inst.cellIndex];
      return { cellIndex: inst.cellIndex, amount: mortgageValue(cell, inst.level) };
    })
    .sort((a, b) => b.amount - a.amount);

  for (const c of candidates) {
    if (player.cash >= 0) break;
    const res = mortgageInstitution(state, player, c.cellIndex);
    if (res.ok) raised.push({ cellIndex: c.cellIndex, amount: res.amount, name: BOARD_CELLS[c.cellIndex].name });
  }
  return raised;
}

/** 破产检测与清算（force=true 时跳过流动性判定，直接强制清算） */
export function checkBankruptcy(state, player, opts = {}) {
  if (player.bankrupt) return false;
  if (!opts.force && !isBankrupt(player, state)) return false;

  // 清算前先记一笔 —— liquidate() 会把现金清零，账本要留下「被清零」这一笔。
  // ⚠️ 用 noteCash（只写账本）而不是 recordCash（会同时改现金）：
  //    现金的清零由 liquidate() 负责，这里再改一次会把现金变成负数。
  const before = player.cash;
  if (before) {
    noteCash(state, player, -before, '破产清算', '破产');
  }
  const res = liquidate(player);
  const why = opts.reason ? `（${opts.reason}）` : '';
  log(state, 'bad',
    `${player.name} 爆仓清算${why}！${res.actions.join('；')}，最终清算金额 ￥${res.settlement}`,
    '破产');
  emit(state, 'bankrupt', { playerId: player.id, settlement: res.settlement, actions: res.actions, reason: opts.reason || null });
  return true;
}

/** 资产排名 */
export function rankPlayers(state) {
  return state.players
    // 同时提供 player 与 p 两个别名，避免不同调用点读错字段
    .map((p) => ({ player: p, p, assets: totalAssets(p, state) }))
    .sort((a, b) => {
      if (a.player.bankrupt !== b.player.bankrupt) return a.player.bankrupt ? 1 : -1;
      return b.assets - a.assets;
    });
}

/**
 * 完整的一次玩家回合结算（AI 与玩家共用）。
 * @returns {{events:Array, results:Array}}
 */
export function completeTurnSettlement(state, player) {
  const results = [];
  let guard = 0;

  // 处理 pending（收购/传送/事件/地铁）
  while (state.pending && guard < 20) {
    guard++;
    const pend = state.pending;
    const cell = BOARD_CELLS[player.position];

    if (pend.kind === 'purchase') {
      const r = settleOnCell(state, player, player.position);
      results.push(...r);
      if (state.pending === pend) state.pending = null; // 避免死循环
      break;
    }
    if (pend.kind === 'takeover') {
      const r = settleOnCell(state, player, player.position);
      results.push(...r);
      if (state.pending === pend) state.pending = null; // 避免死循环
      break;
    }
    if (pend.kind === 'teleport') {
      const mv = movePlayer(state, player, pend.target - player.position);
      state.pending = null;
      results.push({ kind: 'teleport-arrived', target: pend.target });
      const r2 = settleOnCell(state, player, player.position);
      results.push(...r2);
      continue;
    }
    if (pend.kind === 'event') {
      const card = EVENT_CARDS.find((c) => c.id === pend.cardId);
      if (card) {
        applyEventCard(state, player, card);
        results.push({ kind: 'event-applied', card });
      }
      state.pending = null;
      continue;
    }
    if (pend.kind === 'metro') {
      // AI 直接选一个步数；玩家由 UI 决定
      const steps = 1 + Math.floor(state.rng.next() * 3);
      const mv = movePlayer(state, player, steps);
      state.pending = null;
      results.push({ kind: 'metro-moved', steps });
      const r2 = settleOnCell(state, player, player.position);
      results.push(...r2);
      continue;
    }
    if (pend.kind === 'trap') {
      const card = TRAP_CARDS.find((c) => c.id === pend.cardId);
      if (card) {
        applyTrapCard(state, player, card);
        results.push({ kind: 'trap-applied', card });
      }
      state.pending = null;
      continue;
    }
    if (pend.kind === 'bond') {
      // 债券发行由 UI 收集认购意愿后调用 issueBond；此处仅清理待决状态
      state.pending = null;
      continue;
    }
    break;
  }

  // 起点经过检查（补发可能被遗漏的补贴）
  return { results };
}

/** 统计某玩家控股机构数 */
export function institutionCount(player) {
  return (player.institutions || []).filter((i) => !i.mortgaged).length;
}

/** 总控股机构数（含质押） */
export function allInstitutionCount(player) {
  return (player.institutions || []).length;
}
