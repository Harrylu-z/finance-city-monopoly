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
    theme = 'finance',
    aiCount = 3,
  } = options;

  const rng = makeRng(seed);

  const state = {
    seed,
    rng,
    theme,
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
    state.players.push({
      id: p.id ?? i,
      index: i,
      name: p.name,
      isAI: !!p.isAI,
      avatar: p.avatar ?? 0,
      colorIndex: p.colorIndex ?? i,
      personality: p.personality || null,
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
      // 无主 —— 触发收购决策（路演等限时状态可降低收购成本）
      const level = cell.tier;
      const basePrice = purchasePrice(cell, level, state.market);
      const price = Math.round(basePrice * buffEffectMult(player, 'buyCostMult'));
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
        const rent = Math.round(calculateRent(cell, inst.level, {
          market: state.market, eventMult: state.eventMult, buffMult,
        }) * selfMult);
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
          marketNote: marketNoteFor(state.market)
            + (selfMult !== 1 ? ` × 自身系数 ${selfMult.toFixed(2)}` : ''),
        });
        emit(state, 'rent-paid', { from: player.id, to: owner.id, rent, cellIndex });
      }
    }
  } else {
    // 特殊格
    results.push(...settleSpecial(state, player, cell));
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
function settleSpecial(state, player, cell) {
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
 * 持有「金融稳定委员会」的玩家可减免 50% 罚金。
 */
export function applyTrapCard(state, player, card) {
  const e = card.effect;
  let cash = e.cash || 0;
  const relief = globalRegulatorEffects(state).trapRelief || 0;
  if (cash < 0 && relief > 0) {
    cash = Math.round(cash * (1 - relief));
  }
  if (cash) player.cash += cash;
  if (e.rentMult && e.scope === 'self') {
    player.selfRentMult = (player.selfRentMult ?? 1) * e.rentMult;
  }
  emit(state, 'trap-applied', { playerId: player.id, cardId: card.id, cash });
  log(state, 'bad',
    `${player.name} 触发「${card.title}」：${card.text}${relief > 0 && cash < 0 ? '（金稳会已减免部分罚金）' : ''}`,
    '监管');
  return { cash, relief };
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
  // 路演等限时状态可降低扩表成本
  const cost = Math.round(baseCost * buffEffectMult(player, 'upgradeCostMult'));
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
        log(state, 'bad',
          `${player.name} 贷款「${l.name}」到期，现金不足 ￥${shortfall}，触发强制平仓`, '违约');
      }
      checkBankruptcy(state, player);
      emit(state, 'loan-repaid', { playerId: player.id, amount: owed, loanId: l.id });
    }
  }
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
