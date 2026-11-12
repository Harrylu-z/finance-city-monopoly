/**
 * AI 决策引擎 —— 性格系统 + 随机性。
 *
 * 设计原则：
 *   1. AI 信息与玩家对等：决策时不能偷看骰子结果
 *   2. 每个决策 = 性格基线 × 随机系数(0.7~1.3) + 小概率"抽风"
 *   3. 每次决策都产出可读的中文理由（决策日志），用于回合播报
 *   4. 难度影响决策准确率与随机性强度
 */

import { BOARD_CELLS, GROUP_META } from './board.js';
import {
  calculateRent, upgradeCost, mortgageValue, purchasePrice, totalAssets,
  globalRegulatorEffects, groupBuffTier, CONFIG,
} from './economy.js';
import { institutionCount } from './rules.js';

/**
 * 性格档案 —— 5 种，每局随机分配
 */
export const PERSONALITIES = [
  {
    id: 'aggressive',
    name: '激进型',
    tag: '激进',
    desc: '现金不留手，见机构就抢，杠杆拉满',
    quote: '牌照就是印钞机，先拿下再说！',
    cashReserve: 0.10,
    greed: 1.35,
    upgradeBias: 0.55,
    riskTolerance: 0.85,
    preferGroups: ['broker', 'asset'],
    rentFocus: 0.6,
  },
  {
    id: 'conservative',
    name: '保守型',
    tag: '保守',
    desc: '现金充足才出手，只买核心城市的大行',
    quote: '不急，等估值合适了再说。',
    cashReserve: 0.42,
    greed: 0.65,
    upgradeBias: 0.30,
    riskTolerance: 0.25,
    preferGroups: ['bank'],
    rentFocus: 0.85,
  },
  {
    id: 'hoarder',
    name: '囤房型',
    tag: '囤积',
    desc: '垄断同一集团，见机构就拿，不升级',
    quote: '这一串我全包了，其他人靠边站。',
    cashReserve: 0.28,
    greed: 1.10,
    upgradeBias: 0.18,
    riskTolerance: 0.45,
    preferGroups: [],
    preferSameGroup: 0.72,
    rentFocus: 0.55,
  },
  {
    id: 'cashflow',
    name: '现金流型',
    tag: '现金流',
    desc: '只看管理费收益，优先升级高租金机构',
    quote: '现金流为王，纸面繁荣不算数。',
    cashReserve: 0.34,
    greed: 0.92,
    upgradeBias: 0.95,
    riskTolerance: 0.40,
    preferGroups: ['insurer'],
    rentFocus: 1.0,
  },
  {
    id: 'leveraged',
    name: '杠杆型',
    tag: '杠杆',
    desc: '满仓质押融资加杠杆，收益翻倍也容易爆仓',
    quote: '杠杆是撬动世界的支点。',
    cashReserve: 0.05,
    greed: 1.20,
    upgradeBias: 0.70,
    riskTolerance: 0.92,
    preferGroups: ['broker', 'asset', 'bank'],
    rentFocus: 0.5,
  },
];

/** 默认性格 —— 当玩家没有性格档案时兜底（真人玩家 / 自检用例） */
export const DEFAULT_PERSONALITY = {
  id: 'balanced',
  name: '稳健型',
  tag: '稳健',
  desc: '均衡配置，兼顾牌照与现金流',
  quote: '稳扎稳打，先看看再说。',
  cashReserve: 0.28,
  greed: 1.00,
  upgradeBias: 0.50,
  riskTolerance: 0.45,
  preferGroups: [],
  rentFocus: 0.75,
};

/** 取得玩家性格（缺失时回退到默认性格） */
export function playerPersonality(player) {
  return (player && player.personality) || DEFAULT_PERSONALITY;
}

/** 随机分配性格（尽量不重复） */
export function assignPersonalities(rng, count) {
  const pool = rng.shuffle([...PERSONALITIES]);
  const out = [];
  for (let i = 0; i < count; i++) out.push(pool[i % pool.length]);
  return out;
}

/** AI 名字池 —— 按性格给出名字 */
const AI_NAMES = {
  aggressive: ['铁腕操盘手', '闪电并购侠', '杠杆狂人', '激进基金经理'],
  conservative: ['老牌银行家', '风控大师', '稳健配置师', '压舱石掌柜'],
  hoarder: ['圈地大师', '牌照收藏家', '地块囤家', '并购整合人'],
  cashflow: ['现金流先生', '稳健收租王', '精算大师', '长期主义者'],
  leveraged: ['赌王操盘手', '风险偏好狂人', '空头猎手', '结构性玩家'],
};

/** 生成 AI 昵称 */
export function aiName(rng, personality) {
  const pool = AI_NAMES[personality.id] || AI_NAMES.aggressive;
  return rng.pick(pool);
}

/** 难度参数表 */
export function difficultyConfig(state) {
  const table = {
    novice: { accuracy: 0.55, noise: 0.50, greed: 0.75, risk: 0.35 },
    normal: { accuracy: 0.75, noise: 0.32, greed: 1.00, risk: 0.50 },
    expert: { accuracy: 0.92, noise: 0.18, greed: 1.15, risk: 0.68 },
  };
  return table[state.difficulty] || table.normal;
}

/** 是否"抽风"：突然梭哈 / 追高被套 / 突然清仓 */
function isTilted(rng, chance) {
  return rng.next() < chance;
}

/**
 * 决策核心。
 * @param {object} state
 * @param {object} player AI 玩家
 * @param {string} decision 'purchase' | 'upgrade' | 'mortgage' | 'idle'
 * @param {object} ctx { cellIndex }
 */
export function decide(state, player, decision, ctx = {}) {
  const p = playerPersonality(player);
  const diff = difficultyConfig(state);

  if (decision === 'purchase') {
    return decidePurchase(state, player, p, diff, ctx.cellIndex);
  }
  if (decision === 'upgrade') {
    return decideUpgrade(state, player, p, diff);
  }
  if (decision === 'mortgage') {
    return decideMortgage(state, player, p, diff);
  }
  return { action: 'idle', reason: '观望' };
}

/** 收购决策 */
function decidePurchase(state, player, p, diff, cellIndex) {
  const rng = state.rng;
  const cell = BOARD_CELLS[cellIndex];
  const price = purchasePrice(cell, cell.tier, state.market);
  const group = GROUP_META[cell.group];
  const tiltChance = 0.10 * (1.4 - diff.accuracy);

  // 抽风：梭哈
  if (isTilted(rng, tiltChance * 0.5) && player.cash >= price) {
    return {
      action: 'buy',
      reason: `梭哈一把！看中了${group.short}牌照，${group.name}值得赌一把`,
      cost: price, cellIndex,
    };
  }

  // 购买欲望 = 性格基线 × 难度贪婪 × 随机扰动
  let desire = p.greed * diff.greed * (1 + (rng.next() * 2 - 1) * diff.noise);

  if (p.preferGroups.includes(cell.group)) desire *= 1.35;
  if (p.preferGroups.length && !p.preferGroups.includes(cell.group)) desire *= 0.80;
  if (p.preferSameGroup) {
    const sameGroup = player.institutions.some((i) => BOARD_CELLS[i.cellIndex].group === cell.group);
    if (sameGroup) desire *= 1 + p.preferSameGroup;
  }
  if (cell.landmark) desire *= 1.2;

  // 现金约束
  const reserve = Math.floor(player.cash * p.cashReserve);
  if (price > player.cash - reserve) desire *= 0.18;

  const threshold = 0.85 - 0.35 * diff.accuracy;
  if (desire < threshold) {
    return { action: 'pass', reason: `现金要留足，${cell.name}先放一放` };
  }

  // 保守型：额外过滤高门槛标的
  if (p.id === 'conservative' && cell.tier >= 3 && rng.next() > diff.accuracy + 0.15) {
    return { action: 'pass', reason: '风格稳健，不追高门槛标的' };
  }

  if (player.cash < price) {
    return { action: 'pass', reason: `现金不足，${cell.name}还差 ￥${price - player.cash}` };
  }

  return { action: 'buy', reason: pickReason(rng, p, cell, 'buy'), cost: price, cellIndex };
}

/** 升级决策 —— 挑回报率最高的机构 */
function decideUpgrade(state, player, p, diff) {
  const rng = state.rng;
  // 只有「再次踩到」的机构才有升级许可
  const permits = player.upgradePermits || {};
  const candidates = player.institutions.filter((i) => {
    const c = BOARD_CELLS[i.cellIndex];
    if (c.regulator) return false;             // 监管机构不可升级
    if (i.mortgaged) return false;
    if (i.level >= c.maxLevel) return false;
    if (!permits[i.cellIndex]) return false;    // 需先踏足该地块
    return true;
  });
  if (!candidates.length) return { action: 'idle', reason: '没有获得升级许可的机构' };

  const regEff = globalRegulatorEffects(state);
  const buffMult = groupBuffTier(player, candidates[0] ? BOARD_CELLS[candidates[0].cellIndex].group : 'bank').mult;

  let best = null;
  let bestScore = -Infinity;
  for (const inst of candidates) {
    const c = BOARD_CELLS[inst.cellIndex];
    const cost = upgradeCost(c, inst.level, { regulatorCostMult: regEff.upgradeCostMult });
    if (!isFinite(cost) || cost <= 0) continue;
    const curRent = calculateRent(c, inst.level, { market: state.market, eventMult: state.eventMult, buffMult });
    const nextRent = calculateRent(c, inst.level + 1, { market: state.market, eventMult: state.eventMult, buffMult });
    const score = ((nextRent - curRent) / cost) * 100 * p.upgradeBias * p.rentFocus;
    if (score > bestScore) {
      bestScore = score;
      best = { inst, cost, c };
    }
  }
  if (!best) return { action: 'idle', reason: '暂无合适升级标的' };

  const tiltChance = 0.10 * (1.4 - diff.accuracy);
  if (isTilted(rng, tiltChance * 0.4) && player.cash >= best.cost) {
    return { action: 'upgrade', reason: `这轮不装了，直接把${best.c.name}拉满`, cost: best.cost, cellIndex: best.inst.cellIndex };
  }

  const reserve = Math.floor(player.cash * p.cashReserve);
  if (best.cost > player.cash - reserve) {
    return { action: 'idle', reason: `留着现金，${best.c.name}的扩表先缓缓` };
  }

  if (bestScore < 0.55 - 0.25 * diff.accuracy) {
    return { action: 'idle', reason: `${best.c.name}扩表性价比一般，观望` };
  }

  return { action: 'upgrade', reason: pickReason(rng, p, best.c, 'upgrade'), cost: best.cost, cellIndex: best.inst.cellIndex };
}

/** 质押决策 —— 现金见底才融资 */
function decideMortgage(state, player, p, diff) {
  const rng = state.rng;
  const candidates = player.institutions.filter((i) => !i.mortgaged);
  if (!candidates.length) return { action: 'idle', reason: '没有可质押的资产' };

  const tiltChance = 0.10 * (1.4 - diff.accuracy);
  const urgent = player.cash < 250;
  if (!urgent && !isTilted(rng, tiltChance * 0.3)) {
    return { action: 'idle', reason: '现金流还健康，不必质押' };
  }

  let pick = candidates[0];
  let minVal = Infinity;
  for (const inst of candidates) {
    const v = mortgageValue(BOARD_CELLS[inst.cellIndex], inst.level);
    if (v < minVal) { minVal = v; pick = inst; }
  }
  const c = BOARD_CELLS[pick.cellIndex];
  const reason = isTilted(rng, tiltChance * 0.5)
    ? `流动性告急，${c.name}先质押顶上`
    : `现金紧张，${c.name}做一笔质押融资`;
  return { action: 'mortgage', reason, cellIndex: pick.cellIndex };
}

/** 决策理由模板 —— 按性格挑话术 */
function pickReason(rng, p, cell, type) {
  const group = GROUP_META[cell.group];
  const templates = {
    buy: {
      aggressive: [
        `看中了${group.short}牌照，${cell.name}必须拿下`,
        `${group.name}估值还有空间，先下手为强`,
        `有钱不拿是亏，${cell.name}直接上`,
      ],
      conservative: [
        `${cell.name}是${group.short}里的稳健选择，配置一点`,
        `${group.name}的护城河够深，值得长期持有`,
        `低估了，${cell.name}可以慢慢建仓`,
      ],
      hoarder: [
        `这条线我盯很久了，${cell.name}归我`,
        `${group.short}这一串要连成片，${cell.name}是关键一环`,
        `缺了${cell.name}整片都不完整`,
      ],
      cashflow: [
        `${cell.name}的管理费回报不错，现金流能打`,
        `买${cell.name}是为稳定收租`,
        `${group.short}的费率结构健康，值得持有`,
      ],
      leveraged: [
        `加杠杆上${cell.name}，收益放大`,
        `${cell.name}是这轮最好的杠杆标的`,
        `质押一部分再买${cell.name}，用别人的钱办事`,
      ],
    },
    upgrade: {
      aggressive: [
        `把${cell.name}扩表拉满，牌照价值才能兑现`,
        `${cell.name}继续加大投入，压制对手`,
      ],
      conservative: [
        `${cell.name}升一级，护城河更稳`,
        `${cell.name}该升了，长期价值更确定`,
      ],
      hoarder: [
        `${cell.name}升级一下，显得气派`,
        `光占着不够，${cell.name}也得有排面`,
      ],
      cashflow: [
        `${cell.name}升级后管理费能翻倍，值`,
        `算过了，扩${cell.name}的回报率最高`,
      ],
      leveraged: [
        `加杠杆扩${cell.name}，收益最大化`,
        `${cell.name}继续加注，把杠杆做足`,
      ],
    },
  };
  const list = (templates[type] && templates[type][p.id]) || templates[type].aggressive;
  return rng.pick(list);
}

/**
 * AI 回合计划 —— 在掷骰前决定意图（不能看骰子结果）
 */
export function planTurn(state, player) {
  const p = playerPersonality(player);
  const diff = difficultyConfig(state);
  const rng = state.rng;
  const assets = totalAssets(player, state);
  const cashRatio = assets > 0 ? player.cash / assets : 1;

  const wantUpgrade = cashRatio > (0.35 - p.upgradeBias * 0.25)
    && player.institutions.length > 0
    && rng.next() < 0.35 + p.upgradeBias * 0.5 * diff.accuracy;

  const wantMortgage = player.cash < 200 || (p.id === 'leveraged' && rng.next() < 0.22);

  let note = '';
  if (wantMortgage) note = '准备质押融资';
  else if (wantUpgrade) note = '现金充裕，考虑扩表';

  return { wantUpgrade, wantMortgage, note };
}

/**
 * AI 是否使用"打新/加仓"道具重掷一次。
 * 仅依据资产排名与性格判断，不看骰子结果。
 */
export function wantsReroll(state, player) {
  const p = playerPersonality(player);
  const rng = state.rng;
  const assets = totalAssets(player, state);
  const avg = state.players.reduce((s, o) => s + totalAssets(o, state), 0) / state.players.length;
  const behind = assets < avg;
  const base = behind ? 0.16 : 0.05;
  const chance = base * (p.id === 'aggressive' ? 1.6 : p.id === 'conservative' ? 0.5 : 1.0);
  if (rng.next() < chance) {
    return { use: true, reason: behind ? '落后了，打新加仓重掷一次！' : '手气不好，重掷一次' };
  }
  return { use: false, reason: '' };
}

/* ===================================================================
 * 新增机制 —— 债券认购 / 央行贷款决策
 * =================================================================== */

/**
 * AI 是否认购他人的债券。
 * 依据：自身现金储备、性格风险偏好、对手信用（对方资产排名）。
 * 不看任何骰子信息，信息对等。
 *
 * @returns {{subscribed:boolean, reason:string}}
 */
export function decideBondSubscription(state, player, issuer) {
  const p = playerPersonality(player);
  const diff = difficultyConfig(state);
  const rng = state.rng;
  const face = CONFIG.bondFace;

  if (player.cash < face * 2) {
    return { subscribed: false, reason: '现金不够认购，放弃' };
  }

  const assets = totalAssets(player, state);
  const reserve = Math.floor(player.cash * p.cashReserve);
  if (face > player.cash - reserve) {
    return { subscribed: false, reason: '要留足现金，不认购' };
  }

  // 对手信用：对方资产排名越靠后，违约概率越高
  const ranked = state.players
    .map((x) => ({ x, a: totalAssets(x, state) }))
    .sort((a, b) => b.a - a.a);
  const issuerRank = ranked.findIndex((r) => r.x.id === issuer.id);
  const creditPenalty = issuerRank >= 0 ? issuerRank * 0.10 : 0.2;

  // 风险偏好越高越愿意认购
  let willingness = 0.55 + p.riskTolerance * 0.35 - creditPenalty;
  willingness *= (0.85 + diff.accuracy * 0.3);
  willingness += (rng.next() * 2 - 1) * diff.noise * 0.35;

  // 杠杆型 AI 更爱买债
  if (p.id === 'leveraged') willingness += 0.15;
  if (p.id === 'conservative') willingness -= 0.12;

  if (willingness > 0.5) {
    return { subscribed: true, reason: `${issuer.name}的债券票息划算，认购` };
  }
  return { subscribed: false, reason: `${issuer.name}信用一般，再看看` };
}

/**
 * AI 是否申请央行贷款（起点触发）。
 * 依据：现金缺口与性格杠杆偏好。
 */
export function decideLoan(state, player, tier) {
  const p = playerPersonality(player);
  const diff = difficultyConfig(state);
  const rng = state.rng;

  // 现金充裕时不需要贷款
  if (player.cash > 900) {
    return { take: false, reason: '现金充裕，不需要贷款' };
  }
  // 杠杆型 AI 更容易借钱
  let willingness = 0.35 + p.riskTolerance * 0.4;
  if (p.id === 'leveraged') willingness += 0.2;
  if (p.id === 'conservative') willingness -= 0.18;
  willingness += (rng.next() * 2 - 1) * diff.noise * 0.3;

  if (willingness > 0.5) {
    return { take: true, reason: `借一笔「${tier.name}」应急` };
  }
  return { take: false, reason: '不增加杠杆，靠自己周转' };
}
