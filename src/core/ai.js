/**
 * AI 决策引擎 —— **职业被动 × 性格偏好 × 随机性** 三层结构。
 *
 * ================== 三层职责 ==================
 *   ① **职业被动**（src/core/careers.js）
 *      作用于**规则层**：收购价 / 升级费 / 租金 / 罚金 / 择时收益 / 扑克牌库。
 *      由 `rules.js` 读取，AI 决策**不直接干预**。
 *   ② **性格偏好**（src/core/personalities.js）
 *      作用于**决策层**：买不买、升不升、扛不扛风险、说哪句话。
 *      只改变**阈值与权重**，绝不改变现金流与胜负。
 *   ③ **随机性 + 难度**
 *      在性格基线上叠加 ±noise 的扰动；难度控制准确率与噪声强度。
 *
 * ================== 平衡性保证 ==================
 *   · 性格参数全部落在「中性基准 ±25%」的温和区间（见 personalities.js）；
 *   · 每种性格都有对应的**短板**，没有必胜性格；
 *   · AI 决策**不看骰子结果**，与玩家信息对等；
 *   · 性格不改变市场周期 / 事件卡 / 对手收益 → 不直接决定走势。
 */

import { BOARD_CELLS, GROUP_META } from './board.js';
import {
  calculateRent, upgradeCost, mortgageValue, purchasePrice, totalAssets,
  globalRegulatorEffects, groupBuffTier, CONFIG,
} from './economy.js';
import { institutionCount } from './rules.js';
import {
  PERSONALITIES, PERSONALITY_BY_ID, NEUTRAL_PERSONALITY,
  getPersonality, playerPersonality, personalityParams,
} from './personalities.js';

export {
  PERSONALITIES, PERSONALITY_BY_ID, getPersonality, playerPersonality,
  assignPersonalities,
} from './personalities.js';

/** 默认性格 —— 当玩家没有性格档案时兜底（真人玩家 / 自检用例） */
export const DEFAULT_PERSONALITY = NEUTRAL_PERSONALITY;

/**
 * 随机分配性格（尽量不重复）—— 实现在 `personalities.js`，此处转出保持 API 兼容。
 *
 * @param {object} rng
 * @param {number} count AI 数量
 * @returns {object[]} 性格定义数组
 */

/**
 * 按性格生成 AI 昵称。
 *
 * ================== 命名与职业的关系 ==================
 * 昵称体现**性格**（人格），职业则由棋子立绘与标签体现 —— 两者分开呈现，
 * 避免「名字暗示职业 → 看起来像被强制绑定」的错觉。
 */
const AI_NAMES = {
  aggressive: ['铁腕操盘手', '闪电并购侠', '疾风合伙人', '进取组合经理'],
  conservative: ['老牌银行家', '风控大师', '稳健配置师', '压舱石掌柜'],
  hoarder: ['圈地大师', '牌照收藏家', '地块囤家', '并购整合人'],
  cashflow: ['现金流先生', '稳健收租王', '精算大师', '长期主义者'],
  leveraged: ['杠杆操盘手', '风险偏好狂人', '结构玩家', '资本猎手'],
};

/** 生成 AI 昵称 */
export function aiName(rng, personality) {
  const pool = AI_NAMES[personality?.id] || AI_NAMES.aggressive;
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
  const p = personalityParams(player);
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
  if (decision === 'redeem') {
    return decideRedeem(state, player, p, diff);
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

  // 抽风：梭哈 —— 高风险性格更容易「上头」
  if (isTilted(rng, tiltChance * 0.5 * p.riskTolerance) && player.cash >= price) {
    return {
      action: 'buy',
      reason: `梭哈一把！看中了${group.short}牌照，${group.name}值得赌一把`,
      cost: price, cellIndex,
    };
  }

  // 购买欲望 = 性格基线 × 难度贪婪 × 随机扰动
  let desire = p.greed * diff.greed * (1 + (rng.next() * 2 - 1) * diff.noise);

  if (p.preferGroups.includes(cell.group)) desire *= 1.20;
  if (p.preferGroups.length && !p.preferGroups.includes(cell.group)) desire *= 0.86;
  if (p.concentration) {
    const sameGroup = player.institutions.some((i) => BOARD_CELLS[i.cellIndex].group === cell.group);
    if (sameGroup) desire *= 1 + p.concentration * 0.6;
  }
  if (cell.landmark) desire *= 1.2;

  // 性格「追高」倾向：低门槛标的更容易被拿下，高门槛标的门槛更高
  const tierHurdle = 1 + (cell.tier - 1) * (0.30 - p.chaseLowTier * 0.22);
  desire /= Math.max(0.6, tierHurdle);

  // 现金约束 —— 性格的现金留存比例直接决定出手门槛
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
    // 性价比指数 = 每投入 1 元换来的年租金增量（再按性格的收益导向加权）
    const score = ((nextRent - curRent) / cost) * p.upgradeBias * p.rentFocus;
    if (score > bestScore) {
      bestScore = score;
      best = { inst, cost, c };
    }
  }
  if (!best) return { action: 'idle', reason: '暂无合适升级标的' };

  const tiltChance = 0.10 * (1.4 - diff.accuracy);
  if (isTilted(rng, tiltChance * 0.4 * p.riskTolerance) && player.cash >= best.cost) {
    return { action: 'upgrade', reason: `这轮不装了，直接把${best.c.name}拉满`, cost: best.cost, cellIndex: best.inst.cellIndex };
  }

  const reserve = Math.floor(player.cash * p.cashReserve);
  if (best.cost > player.cash - reserve) {
    return { action: 'idle', reason: `留着现金，${best.c.name}的扩表先缓缓` };
  }

  // 升级门槛随性格的「收益导向程度」变化：现金流型更容易升级。
  //
  // ================== 刻度对齐（重要） ==================
  // score 是「性价比指数」：越大越划算。
  // 门槛必须与 score **同一量纲**，否则性格对升级决策就没有实际影响。
  // 这里把 score 归一到「每投入 1 元产生的年化租金增量」这一直观刻度，
  // 再用 upgradeBias 决定「多划算才值得出手」的门槛线。
  const upgradeThreshold = 0.055 - 0.038 * p.upgradeBias + 0.012 * (diff.accuracy - 0.75);
  if (bestScore < upgradeThreshold) {
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
  // 风险承受度低的 AI 只有在「真的告急」时才会质押；高的更早动手
  const proactive = rng.next() < 0.10 * p.riskTolerance;
  if (!urgent && !proactive && !isTilted(rng, tiltChance * 0.3)) {
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

/** 赎回决策 —— 现金充裕时赎回质押机构，恢复管理费收入与完整市值 */
function decideRedeem(state, player, p, diff) {
  const rng = state.rng;
  const candidates = player.institutions.filter((i) => i.mortgaged);
  if (!candidates.length) return { action: 'idle', reason: '没有待赎回的资产' };

  // 优先赎回质押额最高的一家 —— 恢复的租金与市值最多
  let pick = candidates[0];
  let maxPrincipal = -Infinity;
  for (const inst of candidates) {
    const v = inst.mortgageAmount || 0;
    if (v > maxPrincipal) { maxPrincipal = v; pick = inst; }
  }
  const cost = Math.round(maxPrincipal * (1 + CONFIG.redeemFee));
  // 赎回后仍需留出运营现金，避免刚赎回又被迫质押
  // （保守型留更多余量，杠杆型几乎不留）
  const buffer = Math.round(400 * (0.6 + p.cashReserve * 2));
  if (player.cash < cost + buffer) {
    return { action: 'idle', reason: '现金尚不宽裕，暂不赎回' };
  }
  const c = BOARD_CELLS[pick.cellIndex];
  return { action: 'redeem', reason: `赎回${c.name}，恢复管理费收入`, cellIndex: pick.cellIndex, cost };
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
  const p = personalityParams(player);
  const diff = difficultyConfig(state);
  const rng = state.rng;
  const assets = totalAssets(player, state);
  const cashRatio = assets > 0 ? player.cash / assets : 1;

  const wantUpgrade = cashRatio > (0.35 - p.upgradeBias * 0.25)
    && player.institutions.length > 0
    && rng.next() < 0.35 + p.upgradeBias * 0.5 * diff.accuracy;

  // 杠杆型更早动质押；保守型几乎不动
  const wantMortgage = player.cash < 200
    || (p.riskTolerance > 0.6 && rng.next() < 0.10 + p.riskTolerance * 0.14);

  // 质押机构赎回意图：现金足以覆盖「本金+解押费」且留有运营余量
  const mortgaged = player.institutions.filter((i) => i.mortgaged);
  const redeemCost = mortgaged.reduce((s, i) => s + Math.round((i.mortgageAmount || 0) * (1 + CONFIG.redeemFee)), 0);
  const wantRedeem = mortgaged.length > 0 && player.cash >= redeemCost + 400;

  let note = '';
  if (wantMortgage) note = '准备质押融资';
  else if (wantRedeem) note = '现金充裕，考虑赎回质押机构';
  else if (wantUpgrade) note = '现金充裕，考虑扩表';

  return { wantUpgrade, wantMortgage, wantRedeem, note };
}

/**
 * AI 是否使用"打新/加仓"道具重掷一次。
 * 仅依据资产排名与性格判断，不看骰子结果。
 */
export function wantsReroll(state, player) {
  const p = personalityParams(player);
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
 * 依据：票息水平、自身现金储备、性格风险偏好、对手信用（对方资产排名）。
 * 不看任何骰子信息，信息对等。
 *
 * @param {number} [coupon] 本次发行的票息（由发行人财务状况决定），缺省按基准票息
 * @returns {{subscribed:boolean, reason:string}}
 */
export function decideBondSubscription(state, player, issuer, coupon = CONFIG.bondCoupon) {
  const p = personalityParams(player);
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
  // 票息越高越有吸引力：相对基准 6% 每高 1 个百分点 +0.08，低于基准则扣分
  willingness += ((coupon - CONFIG.bondCoupon) / 0.01) * 0.08;
  willingness *= (0.85 + diff.accuracy * 0.3);
  willingness += (rng.next() * 2 - 1) * diff.noise * 0.35;

  // 杠杆型 AI 更爱买债
  if (p.id === 'leveraged') willingness += 0.12;
  if (p.id === 'conservative') willingness -= 0.10;

  if (willingness > 0.5) {
    return { subscribed: true, reason: `票息 ${Math.round(coupon * 1000) / 10}% 有吸引力，认购` };
  }
  return { subscribed: false, reason: `${issuer.name}信用或票息一般，再看看` };
}

/**
 * AI 是否申请央行贷款（起点触发）。
 * 依据：现金缺口与性格杠杆偏好。
 */
export function decideLoan(state, player, tier) {
  const p = personalityParams(player);
  const diff = difficultyConfig(state);
  const rng = state.rng;

  // 现金充裕时不需要贷款
  if (player.cash > 900) {
    return { take: false, reason: '现金充裕，不需要贷款' };
  }
  // 杠杆型 AI 更容易借钱
  let willingness = 0.35 + p.riskTolerance * 0.4;
  if (p.id === 'leveraged') willingness += 0.16;
  if (p.id === 'conservative') willingness -= 0.16;
  willingness += (rng.next() * 2 - 1) * diff.noise * 0.3;

  if (willingness > 0.5) {
    return { take: true, reason: `借一笔「${tier.name}」应急` };
  }
  return { take: false, reason: '不增加杠杆，靠自己周转' };
}
