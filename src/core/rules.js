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
  CLEARING_TARGETS, GROUP_META,
} from './board.js';
import {
  CONFIG, calculateRent, upgradeCost, mortgageValue, redeemFee,
  assetValue, totalAssets, isBankrupt, liquidate, purchasePrice, levelLabel,
  globalRegulatorEffects, groupBuffTier, buffMultiplierFor, loanRepayAmount,
  loanInterestPerTurn, loanOutstandingAmount,
  outstandingLoan, bondRedeemValue, bondMinSubscribers, bondCouponFor,
  buffEffectMult,
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
    eventMult: 1,         // 全局事件卡租金系数
    round: 1,             // 圈数
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
      institutions: [],   // {cellIndex, level, mortgaged, mortgageAmount}
      stats: {
        acquisitions: 0, upgrades: 0, rentsCollected: 0, rentsPaid: 0, largestRent: 0,
        acquisitionSpend: 0, upgradeSpend: 0, mortgageSpend: 0, redeemSpend: 0,
      },
      lastAction: null,
      // ===== 新增金融状态 =====
      loans: [],          // 央行贷款：{id, tier, name, amount, rate, term, interestPerTurn, accruedInterest, interestPaid, turnsElapsed, takenTurn}
      bonds: [],          // 作为发行方持有的债券：{id, face, coupon, couponPer, subscribers:[playerId], couponsPaid, issuedRound, dueRound}
      subscribedBonds: [],// 作为认购方持有的债券：{id, issuerId, face, coupon, couponPer, couponsPaid, dueRound}
      buffs: [],          // 限时状态：{id, name, desc, kind, remaining, total, startedTurn, effect}
      loanCountThisRound: 0,
      // 升级许可：只有再次踩到自有地块后才获得一次升级许可
      upgradePermits: {}, // cellIndex -> true
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
      const level = cell.tier;
      const basePrice = purchasePrice(cell, level, state.market);
      const price = Math.round(basePrice * playerCostMult(player, 'buyCostMult'));
      results.push({ kind: 'purchase-offer', cellIndex, price, level, cell });
      state.pending = { kind: 'purchase', cellIndex, price, level, playerId: player.id };
    } else if (owner.id === player.id) {
      // 踩到自己的机构 —— 获得升级许可（只有再次踩到自有地块后才能升级）
      if (!cell.regulator) {
        player.upgradePermits[cellIndex] = true;
        results.push({ kind: 'upgrade-permit', cellIndex, cell });
      } else {
        results.push({ kind: 'own-regulator', cellIndex, cell });
      }
    } else {
      // 收租 —— 租金受集团 Buff 与监管效果影响
      const inst = owner.institutions.find((i) => i.cellIndex === cellIndex);

      // 已质押的机构暂停产生管理费（质押融资的核心代价）
      if (inst.mortgaged) {
        results.push({
          kind: 'mortgaged-no-rent', cellIndex, cell,
          ownerName: owner.name,
        });
      } else {
        const buffMult = buffMultiplierFor(owner, cell.group, state)
          * buffEffectMult(owner, 'rentMult');
        // 归属人的自身租金系数（信用评级展望 / 自查类事件卡）
        const selfMult = owner.selfRentMult ?? 1;
        // 精算师职业：自己收取的管理费 +6%（温和加成，不改写胜负）
        const careerMult = careerEffectMult(owner, 'rentMult');
        const rent = Math.round(calculateRent(cell, inst.level, {
          market: state.market, eventMult: state.eventMult, buffMult,
        }) * selfMult * careerMult);
        player.cash -= rent;
        owner.cash += rent;
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
 * 发放「经过起点」的货币发行补贴。
 *
 * 规则（改动后）：
 *   · **只要经过起点格就能拿到补贴** —— 不要求「恰好停在起点」；
 *   · 绕圈跨过起点（索引 0）时同样发放；
 *   · 同一圈内不重复发放（用 _startBonusGranted 标记去重）。
 *
 * 返回结算条目数组（空数组表示本圈已发过，不再重复发放）。
 */
export function grantStartPass(state, player, cell) {
  if (player._startBonusGranted) return [];
  player.cash += CONFIG.startBonus;
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

/** 特殊格结算 */
function settleSpecial(state, player, cell, cellIndex = cell.index ?? 0) {
  const results = [];
  const sp = cell.special;

  switch (sp.id) {
    case 'start': {
      // 起点补贴由 grantStartPass 统一发放（带去重标记），避免重复计息
      const granted = grantStartPass(state, player, cell);
      if (granted) results.push(...granted);
      // 持有中国人民银行 —— 每圈开始获得额外流动性投放
      const regBonus = globalRegulatorEffects(state).roundBonus || 0;
      if (regBonus > 0) {
        player.cash += regBonus;
        results.push({ kind: 'pbc-bonus', amount: regBonus, cell });
      }
      // 经过起点后可申请央行贷款（每圈限一次）
      if (player.loanCountThisRound < CONFIG.maxLoansPerRound) {
        results.push({ kind: 'loan-offer', cell, tiers: CONFIG.loanTiers });
      }
      break;
    }
    case 'tax': {
      // 「合规成本」格：按机构持有规模计征 —— 每份机构 ￥40，最低 ￥120、封顶 ￥360
      const holdings = (player.institutions || []).length;
      const amount = Math.min(360, Math.max(120, holdings * 40));
      player.cash -= amount;
      results.push({
        kind: 'charge', amount, cell,
        reason: `按机构持有规模（${holdings} 份）计征印花税`,
      });
      break;
    }
    case 'fine': {
      player.cash -= sp.amount;
      results.push({ kind: 'charge', amount: sp.amount, cell, reason: sp.name });
      break;
    }
    case 'charity': {
      // 慈善公益捐赠：捐出善款换来「公益声誉」——3 回合管理费 +12%
      const amount = sp.amount || 120;
      player.cash -= amount;
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
      const instCells = BOARD_CELLS
        .map((c, i) => (c.type === 'institution' ? i : -1))
        .filter((i) => i >= 0);
      const target = instCells[state.rng.int(0, instCells.length - 1)];
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
      // 「交易员」职业：踩到牛熊切换格时额外获得一笔价差收益
      // （每圈只发一次，防止反复刷同一格；金额温和，不决定走势）
      const marketBonus = careerEffectValue(player, 'marketBonus');
      if (marketBonus > 0 && !player._marketBonusRound) {
        player._marketBonusRound = state.round;
        player.cash += marketBonus;
        results.push({
          kind: 'bonus', amount: marketBonus, cell,
          reason: '交易员择时价差收益',
        });
      }
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
        player.cash -= fee;
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
      player.cash += amount;
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
      player.cash += 80;
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

/** 应用事件卡效果 */
export function applyEventCard(state, player, card) {
  const e = card.effect;
  if (e.cash) {
    player.cash += e.cash;
  }
  if (e.rentMult && e.scope === 'all') {
    state.eventMult = e.rentMult;
  }
  emit(state, 'event-applied', { playerId: player.id, cardId: card.id });
  return { cash: e.cash || 0, rentMult: state.eventMult };
}

/**
 * 应用陷阱卡效果（监管抽查 / 风险警示）。
 * 罚金减免来源（取最大，不叠加）：
 *   1. 持有「金融稳定委员会」的玩家 —— 减免 50%
 *   2. 「风控总监」职业 —— 减免 30%
 */
export function applyTrapCard(state, player, card) {
  const e = card.effect;
  let cash = e.cash || 0;
  const regRelief = globalRegulatorEffects(state).trapRelief || 0;
  // 风控总监职业被动：温和的 30% 罚金缓冲
  const careerRelief = careerEffectValue(player, 'trapRelief');
  const relief = Math.max(regRelief, careerRelief);
  const fromCareer = careerRelief > regRelief;
  if (cash < 0 && relief > 0) {
    cash = Math.round(cash * (1 - relief));
  }
  if (cash) player.cash += cash;
  if (e.rentMult && e.scope === 'self') {
    player.selfRentMult = (player.selfRentMult ?? 1) * e.rentMult;
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
 *   2. 桌上面值 = 现金 + 资产折算额度（资产折算率 50%）；
 *      —— 允许「用资产下注」，但**不转移资产所有权**；
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
    // 这里只传原始资产市值，避免重复折算。
    assetValue: Math.max(0, totalAssets(p, state)),
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
    log(state, p.isAI ? 'ai' : 'self',
      `${p.name} 在德州扑克中${d.gain > 0 ? `赢得 ￥${d.gain}` : `投注 ￥${d.bet}`}`
      + (d.assetStaked > 0 ? `（含资产折让 ￥${d.assetStaked}，机构所有权不变）` : '')
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
  if (player.loanCountThisRound >= CONFIG.maxLoansPerRound) {
    return { ok: false, reason: '本圈已申请过贷款' };
  }
  const interestPerTurn = loanInterestPerTurn(tier);
  const repay = loanRepayAmount(tier.id);
  const loan = {
    id: `loan${state.turnNumber}_${player.id}`,
    tier: tier.id,
    name: tier.name,
    amount: tier.amount,
    rate: tier.rate,
    term: tier.term,
    interestPerTurn,
    accruedInterest: 0,   // 现金不足时未付的利息（欠息）
    interestPaid: 0,      // 已付利息累计
    repay,                // 本息合计（展示用）
    takenTurn: state.turnNumber,
    turnsElapsed: 0,      // 已经历的「自己的回合」数
  };
  player.cash += tier.amount;
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
  player.cash -= owed;
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
    id: `bond${state.turnNumber}_${issuer.id}`,
    issuerId: issuer.id,
    face: CONFIG.bondFace,
    coupon,
    couponPer,
    subscribers: subs.map((s) => s.playerId),
    couponsPaid: 0,
    issuedRound: state.round,
    dueRound: state.round + CONFIG.bondTerm,
  };
  issuer.bonds.push(bond);
  for (const s of subs) {
    const buyer = state.players.find((p) => p.id === s.playerId);
    if (!buyer) continue;
    buyer.cash -= CONFIG.bondFace;
    buyer.subscribedBonds.push({
      id: bond.id, issuerId: issuer.id, face: CONFIG.bondFace,
      coupon, couponPer, couponsPaid: 0, dueRound: bond.dueRound,
    });
  }
  issuer.cash += CONFIG.bondFace * subs.length;
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

/** 每圈结束时的债券付息与到期兑付 */
export function processBonds(state) {
  const notes = [];
  // 发行方付息
  for (const p of state.players) {
    for (const b of (p.bonds || [])) {
      const due = Math.round(b.couponPer * b.subscribers.length);
      p.cash -= due;
      for (const sid of b.subscribers) {
        const buyer = state.players.find((x) => x.id === sid);
        if (!buyer) continue;
        buyer.cash += b.couponPer;
        const held = buyer.subscribedBonds.find((x) => x.id === b.id);
        if (held) held.couponsPaid += 1;
      }
      b.couponsPaid += 1;
      notes.push(`${p.name} 支付债券票息 ￥${due}`);
    }
    // 到期兑付本金
    const matured = (p.bonds || []).filter((b) => state.round >= b.dueRound);
    for (const b of matured) {
      const total = b.face * b.subscribers.length;
      p.cash -= total;
      for (const sid of b.subscribers) {
        const buyer = state.players.find((x) => x.id === sid);
        if (!buyer) continue;
        buyer.cash += b.face;
        buyer.subscribedBonds = buyer.subscribedBonds.filter((x) => x.id !== b.id);
      }
      p.bonds = p.bonds.filter((x) => x.id !== b.id);
      notes.push(`${p.name} 债券到期兑付 ￥${total}`);
    }
  }
  return notes;
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

  player.cash -= price;
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
  if (!opts.force && !player.upgradePermits?.[cellIndex]) {
    return { ok: false, reason: '需再次踏足该机构才能升级' };
  }

  const regEff = globalRegulatorEffects(state);
  const baseCost = upgradeCost(cell, inst.level, { regulatorCostMult: regEff.upgradeCostMult });
  // 路演等限时状态 + 基金经理职业（-6%）可降低扩表成本
  const cost = Math.round(baseCost * playerCostMult(player, 'upgradeCostMult'));
  if (player.cash < cost) return { ok: false, reason: '现金不足', cost };

  player.cash -= cost;
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
  const amount = mortgageValue(cell, inst.level);
  player.cash += amount;
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
  player.cash -= total;
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
    // 「交易员」职业的择时奖励同样每圈只发一次
    player._marketBonusRound = 0;
    state.round += 1;
    onRoundComplete(state);
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

/** 每圈结束 —— 触发牛熊周期切换、债券付息、贷款到期 */
function onRoundComplete(state) {
  // 牛熊周期切换
  if (state.round % CONFIG.marketCycleRounds === 0) {
    const next = state.market === 'bull' ? 'bear' : 'bull';
    state.market = next;
    const label = next === 'bull' ? '牛市' : '熊市';
    log(state, next === 'bull' ? 'good' : 'bad',
      `行情切换：进入${label}，全市场租金系数调整为 ${next === 'bull' ? '+20%' : '-20%'}`,
      '周期');
    emit(state, 'market-shift', { market: next, round: state.round });
  }

  // 债券付息与到期兑付
  const bondNotes = processBonds(state);
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
      player.cash -= interest;
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
      player.cash -= owed;
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

/** 破产检测与清算 */
export function checkBankruptcy(state, player) {
  if (player.bankrupt) return false;
  if (!isBankrupt(player, state)) return false;

  const res = liquidate(player);
  log(state, 'bad',
    `${player.name} 爆仓清算！${res.actions.join('；')}，最终清算金额 ￥${res.settlement}`,
    '破产');
  emit(state, 'bankrupt', { playerId: player.id, settlement: res.settlement, actions: res.actions });
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
