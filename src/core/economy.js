/**
 * 经济规则引擎 —— 纯函数，无副作用，便于单元测试。
 *
 * 核心公式：
 *   租金 = 基础租金(level) × 市场周期系数 × 全局事件系数 × 集团系数 × 集团Buff系数
 *   升级费用 = 下一级买入价 × 升级系数 × 监管优惠系数
 *   总资产 = 现金 + 机构市值（按当前等级买入价折算）
 *
 * 金融化包装：
 *   质押融资 → 股权质押（已实现）
 *   央行贷款 → 起点可申请的过桥/流动性贷款（新增）
 *   债券融资 → 向其他玩家发行债券，≥2 人认购方成立（新增）
 */

import { BOARD_CELLS, LEVELS, GROUP_META, REGULATORS } from './board.js';

/** 可调参数 —— 全部集中在此，便于平衡调整 */
export const CONFIG = {
  // 升级费用 = 下一级买入价 × 该系数
  upgradeCostFactor: 0.85,
  // 升级到地标级额外附加费
  landmarkSurcharge: 400,

  // ===== 升级许可（P2 / m5）=====
  // 许可有效期（该玩家自己的回合数）—— 过期需再次踏足
  upgradePermitTurns: 3,
  // 同时持有的许可数量上限 —— 防止囤积许可后连升多级
  maxUpgradePermits: 3,

  // 抵押（股权质押融资）系数
  mortgageRatio: 0.55,
  // 赎回（解押）费用
  redeemFee: 0.12,

  // 起点补贴
  startBonus: 300,

  // 市场周期
  bullRentMult: 1.2,
  bearRentMult: 0.8,
  // 每多少圈切换一次牛熊
  marketCycleRounds: 3,

  // ===== 限时全局状态 / 自身租金系数（P1）=====
  // 事件卡「全行业」租金系数的持续圈数（到期自动恢复为 1）
  eventMultTurns: 2,
  // 监管卡「影响自身」的租金系数持续回合数（限时 Buff，到期自动消失）
  selfRentMultTurns: 3,
  // 自身租金系数的下限（防止负面限时状态把收入压到 0）
  selfRentFloorMult: 0.7,
  // 旧存档中永久 selfRentMult 的恢复节奏（多少回合回到 1）
  selfRentMultDecayTurns: 4,

  // 集团租金系数（券商弹性高，保险稳健，资管牌照溢价）
  groupRentMult: {
    bank: 1.0,
    broker: 1.1,
    insurer: 0.95,
    asset: 1.05,
  },

  /**
   * 初始现金档位。
   *
   * ================= 经济平衡推导（34 格 / 24 机构版）=================
   * 改动前（HEAD 3c2f3d9：46 格 / 35 家普通机构 + 4 家监管）：
   *   · 旧语义「买下即升到 tier 级」→ 玩家实际支付 price[tier]
   *   · 35 家机构实际买入总额 ￥115,460、对应租金 ￥12,121
   *     （平均买入价 ￥3,299、平均初始租金 ￥346）
   *   · 若从 level 0 起步，35 家的 level-0 价格合计 ￥24,390
   *   · 35 家全部升到 level 4：价格合计 ￥142,920、租金合计 ￥15,186
   *   · 玩家初始现金 standard ￥2,800
   *
   * 改动后（34 格 / 24 机构）：
   *   · 买下即 level 0（网点级）→ 24 家的 level-0 价格合计 ￥14,362
   *   · 24 家机构 5 级价格合计 ￥213,127、5 级租金合计 ￥22,184
   *     （约为旧「全升级口径」的 149% / 146%）
   *   · 平均起步价（level 0）￥598、平均地标级（level 4）￥6,225
   *     —— 比旧版「买下即 tier」的平均买入价 ￥3,299 低 82%，
   *     这是刻意的：买地门槛降低，让玩家能先铺盘再逐级升级。
   *   · 若沿用 ￥2,800 初始现金 → 可买 **5~6 家 1 星机构**，
   *     一圈（34 格 ≈ 5 回合/人）就能铺满整个银行段，节奏偏快。
   *
   * 因此把初始现金下调到「≈ 3~4 家 1 星机构」的水平：
   *   tight    ￥2,000 —— 开局可买 4~5 家 1 星，需靠租金滚起来
   *   standard ￥2,400 —— 开局可买 4~5 家 1 星（1 星起步价 ￥260~429）
   *   loose    ￥3,200 —— 开局可买 1 家 2 星 + 4 家 1 星
   *
   * 预期回合数：34 格一圈，平均每回合前进 7 格（2 骰 × 均值 3.5），
   * 单人约 **5 回合 / 圈**；4 人局一圈 ≈ 20 个总回合。
   * 一次完整对局（20~30 圈）≈ 400~600 个总回合，
   * 玩家在这段时间里能买下 12~16 家机构并把 4~6 家升到 2~3 级 ——
   * 与「24 家机构 / 4 家 3 星核心资产」的棋盘规模匹配。
   */
  cashLevels: {
    tight: 2000,
    standard: 2400,
    loose: 3200,
  },

  // 破产判定阈值
  bankruptcyFloor: 0,

  // ===== 央行贷款（起点绕圈后可申请）=====
  // 单利 3%/回合；期限按「借款人自己的回合」计（与谁先绕圈无关）
  // 额度越大期限越长：1200→4 回合、2400→6 回合、4000→8 回合
  // 「每回合付息、到期还本」：每个回合扣当期利息，本金到期一次性归还；
  // 现金不足时当期利息转为欠息，到期连同本金一并结清。
  loanTiers: [
    { id: 'micro', name: '支小再贷款', amount: 1200, rate: 0.03, term: 4, desc: '小额流动性支持，期限最短' },
    { id: 'bridge', name: '过桥资金',   amount: 2400, rate: 0.03, term: 6, desc: '过桥融资，额度与期限均衡' },
    { id: 'relending', name: 'PSL 棚改', amount: 4000, rate: 0.03, term: 8, desc: '政策性工具，额度大、期限长' },
  ],
  // 每圈最多可申请的贷款次数（同一圈只允许一次）
  maxLoansPerRound: 1,
  // 贷款到期应还 = 本金 × (1 + rate × term)
  loanRepayMultiplier: 1,

  // ===== 债券融资（再融资窗口格）=====
  // 发行面值（每位认购者认购金额）
  bondFace: 800,
  // 债券票面利率（每圈结束时按比例付息）
  bondCoupon: 0.06,
  // 债券发行期限（圈数）
  bondTerm: 3,
  // 至少需要多少名认购者才算发行成功
  bondMinSubscribers: 2,
  // 认购者拒绝的概率基准（AI 依据自身现金与性格决定）
  bondBaseDeclineRate: 0.45,

  // ===== 集团 Buff（持有同类机构数量触发）=====
  // 达到数量阈值即激活对应档位
  // ⚠ 34 格 / 24 机构版：每类只有 6 家机构 —— 阈值由 [3, 6, 9]
  //   收紧为 [2, 4, 6]，让「区域协同 / 集团化经营 / 生态圈龙头」
  //   三档在单类只有 6 家的情况下依然全部可达。
  groupBuffThresholds: [2, 4, 6],
  // 各档位带来的租金加成
  groupBuffRentMult: [1.08, 1.16, 1.25],
  // 各档位名称
  groupBuffNames: ['区域协同', '集团化经营', '生态圈龙头'],

  // ===== 维持成本（每圈按持有机构收取）=====
  // ⚠ 这是「破产机制可触发」与「不存在必赢策略」的关键一环。
  //
  // 为什么必须有它：
  //   旧版只有「收入侧」（租金）与「一次性支出」（买入 / 升级），
  //   没有「持有侧」的持续成本 —— 于是：
  //     · 铺满 24 家机构后每圈躺着收租，现金只会越来越多；
  //     · 只要开局铺满一圈，就有了「正现金流永动机」；
  //     · 破产（现金为负）几乎永远不会发生，机制形同虚设。
  //
  // 有了维持成本之后：
  //   · 每圈净收益 = 收租 − 维持费，必须为正才有意义；
  //   · 「铺盘」有真实的持有成本 —— 铺得越多、每天的固定支出越大；
  //   · 现金为负 → 追保（质押）→ 仍不足 → **破产清算**，机制真正可达。
  //
  // 数值口径：按**机构等级**递增（高级位更贵 —— 与租金同步），
  // 保证「升级」不会被维持成本吃掉升级带来的增量收益。
  //   1 星 网点级 ≈ 每圈 6~10 元（约为该机构租金的 12%~15%）
  //   3 星 地标级 ≈ 每圈 40~60 元（约为该机构租金的 40%）
  maintenanceCostPerLevel: [8, 18, 32, 48, 66],
  // 监管机构（不产生租金）不收维持成本 —— 它们的价值在全局效果上
  maintenanceFreeRegulators: true,
  // 维持成本按「中位圈数」结算（与牛熊周期、债券到期同一时间基准）
  maintenanceSettleOnRoundComplete: true,

  // ===== 监管机构持有效果 =====
  regulatorEffects: {
    // 人民银行：每圈开始额外流动性投放
    pbc: { roundBonus: 80 },
    // 证监会：全体升级费用降低
    csrc: { upgradeCostMult: 0.88 },
    // 银保监：全体租金降低（审慎约束）
    nfra: { rentMult: 0.92 },
    // 金稳会：陷阱罚金减免
    fsc: { trapRelief: 0.5 },
  },

  // 难度系数（影响 AI，不影响玩家）
  difficulty: {
    novice: { accuracy: 0.55, noise: 0.50, greed: 0.75, risk: 0.35 },
    normal: { accuracy: 0.75, noise: 0.32, greed: 1.00, risk: 0.50 },
    expert: { accuracy: 0.92, noise: 0.18, greed: 1.15, risk: 0.68 },
  },
};

/** 机构的当前基础租金（按已升级等级） */
export function baseRent(cell, level) {
  const lv = Math.max(0, Math.min(4, level | 0));
  return cell.rent[lv] || 0;
}

/**
 * 计算某格在当前市场环境下的实际租金。
 * @param {object} cell 棋盘格
 * @param {number} level 等级
 * @param {object} ctx { market, eventMult, buffMult }
 */
export function calculateRent(cell, level, ctx = {}) {
  if (!cell || cell.type !== 'institution') return 0;
  if (cell.regulator) return 0; // 监管机构不产生租金
  const base = baseRent(cell, level);
  const marketMult = ctx.market === 'bull' ? CONFIG.bullRentMult
    : ctx.market === 'bear' ? CONFIG.bearRentMult
    : 1.0;
  const groupMult = CONFIG.groupRentMult[cell.group] ?? 1;
  const eventMult = ctx.eventMult ?? 1;
  const buffMult = ctx.buffMult ?? 1;
  return Math.round(base * marketMult * groupMult * eventMult * buffMult);
}

/**
 * 升级到下一级的费用；已满级返回 Infinity
 * @param {object} cell 棋盘格
 * @param {number} currentLevel 当前等级
 * @param {object} ctx { regulatorCostMult } —— 持有证监会时的优惠系数
 */
export function upgradeCost(cell, currentLevel, ctx = {}) {
  if (!cell || cell.type !== 'institution') return Infinity;
  if (cell.regulator) return Infinity; // 监管机构不可升级
  if (currentLevel >= cell.maxLevel) return Infinity;
  const nextLevel = currentLevel + 1;
  let cost = Math.round(cell.price[nextLevel] * CONFIG.upgradeCostFactor);
  if (nextLevel === 4) cost += CONFIG.landmarkSurcharge;
  const m = ctx.regulatorCostMult ?? 1;
  return Math.round(cost * m);
}

/** 抵押（股权质押融资）可得现金 */
export function mortgageValue(cell, level) {
  if (!cell || cell.type !== 'institution') return 0;
  const lv = Math.max(0, Math.min(4, level | 0));
  return Math.round((cell.price[lv] || 0) * CONFIG.mortgageRatio);
}

/**
 * 赎回（解押）需要支付的费用 */
export function redeemFee(mortgagedAmount) {
  return Math.round(mortgagedAmount * CONFIG.redeemFee);
}

/**
 * 某家机构每圈的**维持成本**（持有侧固定支出）。
 *
 * @param {object} cell
 * @param {number} level
 * @returns {number} 每圈应付的维持费（监管机构为 0）
 */
export function maintenanceCost(cell, level) {
  if (!cell || cell.type !== 'institution') return 0;
  if (cell.regulator && CONFIG.maintenanceFreeRegulators) return 0;
  const lv = Math.max(0, Math.min(4, level | 0));
  return CONFIG.maintenanceCostPerLevel[lv] || 0;
}

/**
 * 玩家持有全部机构的**每圈维持成本**合计。
 *
 * @param {object} player
 * @returns {number}
 */
export function totalMaintenanceCost(player) {
  let sum = 0;
  for (const inst of (player.institutions || [])) {
    const cell = BOARD_CELLS[inst.cellIndex];
    if (!cell) continue;
    sum += maintenanceCost(cell, inst.level);
  }
  return sum;
}

/** 机构资产市值（排名与清算用）；已抵押按半值计 */
export function assetValue(cell, level, mortgaged) {
  if (!cell || cell.type !== 'institution') return 0;
  const lv = Math.max(0, Math.min(4, level | 0));
  const v = cell.price[lv] || 0;
  return mortgaged ? Math.round(v * 0.5) : v;
}

/**
 * 玩家**机构市值**（不含现金）—— 赌场资产折算额度的唯一基数。
 *
 * ⚠ F1：不能用 `totalAssets()`（= 现金 + 机构市值）当折算基数 ——
 *   那等于把现金算两遍（现金既进 cashStack 又进 assetStack），
 *   玩家可凭空拿到 1.5 倍桌上面值。
 *
 * @param {object} player
 * @param {object} state
 * @returns {number} 机构市值合计（已质押按半值计）
 */
export function institutionValue(player, state) {
  let total = 0;
  for (const inst of (player.institutions || [])) {
    const cell = BOARD_CELLS[inst.cellIndex];
    total += assetValue(cell, inst.level, inst.mortgaged);
  }
  // 赌场中已让渡的资产估值不再重复计入额度
  const lock = Math.max(0, player.pokerAssetLock || 0);
  return Math.max(0, total - lock);
}

/**
 * 玩家总资产 = 现金 + 所有机构市值 − 赌场抵押让渡
 *
 * `player.pokerAssetLock` 是德州扑克里的「资产抵押让渡」：
 * 当玩家用资产额度下注时，这部分估值被让渡出总资产（所有权不变）；
 * 结算时按**净额**一次性记账：
 *   · 押上但没赢回 → 让渡保留，等于真实折损（体现下注的代价）；
 *   · 赢回自己押的部分 → 让渡解除，估值原样归位；
 *   · 赢下别人的资产筹码 → 超出自己押注的部分**折成现金派付**
 *     （资产所有权不转移，别人押进的资产以现金面值兑付给赢家）。
 * 因此该值只反映「当前仍处于让渡状态的估值」，不会重复累加。
 */
export function totalAssets(player, state) {
  let total = player.cash;
  for (const inst of (player.institutions || [])) {
    const cell = BOARD_CELLS[inst.cellIndex];
    total += assetValue(cell, inst.level, inst.mortgaged);
  }
  // 赌场资产让渡折损（永不为负）
  const lock = Math.max(0, player.pokerAssetLock || 0);
  total = Math.max(0, total - lock);
  return total;
}

/**
 * 财务指标汇总 —— 供「资产排行下钻」窗口展示。
 *
 * 全部为纯计算，无副作用；与 `totalAssets` 口径一致（机构市值按已质押半值计）。
 *
 * @param {object} player 目标玩家
 * @param {object} state  当前对局状态（用于市场周期 / 监管效果 / 圈数）
 * @returns {object} 财务指标集合
 */
export function financialMetrics(player, state) {
  const cash = player.cash;
  const stats = player.stats || {};

  // ===== 资产端：机构市值拆分 =====
  let grossValue = 0;       // 未折价的机构账面市值
  let mortgagedValue = 0;   // 已质押机构的账面市值（按半值计入总资产）
  let mortgagedAmount = 0;  // 质押融资本金（负债）
  let activeCount = 0;      // 在营（未质押）机构数
  let pledgedCount = 0;     // 质押机构数
  let regulatorCount = 0;   // 监管牌照数
  let avgLevel = 0;         // 机构平均等级
  let levelSum = 0;
  let levelCount = 0;
  let maxLevel = 0;

  // 每家机构的「当前管理费收入」（未质押且非监管机构才产生）
  let rentIncome = 0;
  // 每圈维持成本合计（持有侧固定支出）
  let maintenance = 0;

  const market = state ? state.market : 'normal';
  const regEff = globalRegulatorEffects(state || { players: [] });

  for (const inst of (player.institutions || [])) {
    const cell = BOARD_CELLS[inst.cellIndex];
    if (!cell) continue;

    const bookValue = cell.price[inst.level] || 0;
    grossValue += bookValue;
    levelSum += inst.level;
    levelCount += 1;
    if (inst.level > maxLevel) maxLevel = inst.level;
    // 维持成本：所有机构（含已质押）都要付 —— 机构还在你名下就要养
    maintenance += maintenanceCost(cell, inst.level);

    if (cell.regulator) {
      regulatorCount += 1;
      continue;
    }

    if (inst.mortgaged) {
      pledgedCount += 1;
      mortgagedAmount += inst.mortgageAmount || 0;
      mortgagedValue += assetValue(cell, inst.level, true);
    } else {
      activeCount += 1;
      // 管理费收入按当前市场周期 + 集团 Buff + 限时状态计算
      const buff = groupBuffTier(player, cell.group).mult * buffEffectMult(player, 'rentMult');
      rentIncome += calculateRent(cell, inst.level, {
        market,
        eventMult: state ? state.eventMult : 1,
        buffMult: buff,
      });
    }
  }

  avgLevel = levelCount > 0 ? Math.round((levelSum / levelCount) * 100) / 100 : 0;

  // ===== 负债端 =====
  const loanDebt = outstandingLoan(player);            // 未偿贷款（本金+利息）
  const bondPayable = (player.bonds || []).reduce(      // 发行中债券的到期兑付义务
    (a, b) => a + b.face * b.subscribers.length, 0);
  const bondReceivable = (player.subscribedBonds || []).reduce(
    (a, b) => a + b.face, 0);                          // 持有他人债券的债权
  const debt = loanDebt + bondPayable + mortgagedAmount;

  // ===== 净值与杠杆 =====
  const assets = totalAssets(player, state);
  const netWorth = assets - debt;
  const debtRatio = assets > 0 ? Math.round((debt / assets) * 1000) / 10 : 0;   // 资产负债率 %
  const equityRatio = assets > 0 ? Math.round(((assets - debt) / assets) * 1000) / 10 : 0;
  const leverage = netWorth > 0 ? Math.round((assets / netWorth) * 100) / 100 : 0; // 权益乘数

  // ===== 现金流 =====
  const rentsCollected = stats.rentsCollected || 0;     // 累计收取管理费
  const rentsPaid = stats.rentsPaid || 0;               // 累计支付管理费
  const netRentFlow = rentsCollected - rentsPaid;
  const cashFlow = netRentFlow - (stats.upgradeSpend || 0) - (stats.acquisitionSpend || 0);

  const rounds = state ? Math.max(1, state.round) : 1;
  const avgRentIncome = Math.round(rentIncome / rounds);

  // ===== 统计 =====
  const acquisitions = stats.acquisitions || 0;
  const upgrades = stats.upgrades || 0;
  const largestRent = stats.largestRent || 0;

  return {
    // 资产
    assets,
    cash,
    grossValue,           // 机构账面市值（未折价）
    mortgagedValue,       // 计入总资产的质押机构市值
    activeValue: grossValue - mortgagedValue * 2, // 在营机构市值（未折价）
    // 负债
    debt,
    loanDebt,
    bondPayable,
    bondReceivable,
    mortgagedAmount,
    // 净值
    netWorth,
    debtRatio,            // 资产负债率 %
    equityRatio,          // 权益比率 %
    leverage,             // 权益乘数
    // 经营
    institutionCount: (player.institutions || []).length,
    activeCount,
    pledgedCount,
    regulatorCount,
    avgLevel,
    maxLevel,
    rentIncome,           // 当前每圈潜在管理费收入
    avgRentIncome,        // 按已进行圈数摊薄
    // 持有侧固定支出（每圈）—— 与 rentIncome 一起决定每圈净现金流
    maintenanceCost: maintenance,
    maintenanceDebt: player.maintenanceDebt || 0,
    netPerLap: rentIncome - maintenance,
    rentsCollected,
    rentsPaid,
    netRentFlow,
    cashFlow,
    acquisitions,
    upgrades,
    largestRent,
    rounds,
    bankrupt: !!player.bankrupt,
  };
}

/**
 * 是否资不抵债：现金为负 且 现金 + 全部未抵押机构的可变现价值 < 0
 */
export function isBankrupt(player, state) {
  if (player.bankrupt) return true;
  let liquid = player.cash;
  for (const inst of (player.institutions || [])) {
    if (inst.mortgaged) continue;
    const cell = BOARD_CELLS[inst.cellIndex];
    liquid += assetValue(cell, inst.level, false);
  }
  return liquid < CONFIG.bankruptcyFloor;
}

/**
 * 清算：变卖所有机构，得出最终清算金额。
 *
 * ⚠ F2：破产清算必须**清除全部金融头寸**，否则会出现「死后仍在收息 / 收租」：
 *   · `loans` —— 央行贷款（否则 serviceLoans 继续扣息、还会再触发一次破产检查）；
 *   · `bonds` —— 作为发行方持有的债券（否则 processBonds 继续付息/兑付，
 *     凭空从破产方转走现金）；
 *   · `subscribedBonds` —— 作为认购方持有的债券（否则继续收票息、收本金）；
 *   · `pokerAssetLock` —— 赌场的资产让渡（否则总资产永远少一块）；
 *   · `buffs` —— 限时状态（否则状态残留）；
 *   · `upgradePermits` —— 升级许可（否则残留）。
 *
 * 债券债务的处理：债券本息是**发行方的偿付义务**，
 * 发行方破产 → 该笔债券到期时**跳过兑付**（债权人损失本金），
 * 由 rules.processBonds 依据 `p.bankrupt` 判定。
 *
 * @param {object} player
 * @returns {{settlement:number, actions:string[], debts:object}}
 */
export function liquidate(player) {
  const actions = [];
  let proceeds = player.cash;

  // ===== 记录被免除的债务（供上层播报 / 审计）=====
  const debts = {
    loans: (player.loans || []).length,
    loanAmount: (player.loans || []).reduce((a, l) => a + (l.amount || 0), 0),
    bonds: (player.bonds || []).length,
    bondPayable: (player.bonds || []).reduce(
      (a, b) => a + b.face * (b.subscribers ? b.subscribers.length : 0), 0),
    subscribedBonds: (player.subscribedBonds || []).length,
    bondReceivable: (player.subscribedBonds || []).reduce((a, b) => a + (b.face || 0), 0),
    pokerAssetLock: Math.max(0, player.pokerAssetLock || 0),
  };

  for (const inst of (player.institutions || [])) {
    const cell = BOARD_CELLS[inst.cellIndex];
    const v = assetValue(cell, inst.level, inst.mortgaged);
    proceeds += v;
    actions.push(`${cell.name} 强制转让 ￥${v}`);
  }

  // ===== 清除全部金融头寸（F2）=====
  player.institutions = [];
  player.cash = 0;
  player.bankrupt = true;
  player.loans = [];
  player.bonds = [];
  player.subscribedBonds = [];
  player.pokerAssetLock = 0;
  player.buffs = [];
  player.upgradePermits = {};
  player.loanCountThisRound = 0;

  return { settlement: Math.max(0, Math.round(proceeds)), actions, debts };
}

/** 买入价（受市场周期影响：牛市挂牌价上浮，熊市折价） */
export function purchasePrice(cell, level, market = 'normal') {
  if (!cell || cell.type !== 'institution') return 0;
  const lv = Math.max(0, Math.min(4, level | 0));
  const base = cell.price[lv] || 0;
  if (market === 'bull') return Math.round(base * 1.10);
  if (market === 'bear') return Math.round(base * 0.88);
  return base;
}

/** 等级名称 */
export function levelLabel(level) {
  return (LEVELS[level] || LEVELS[0]).label;
}

/* ===================================================================
 * 集团 Buff —— 持有同类机构数量达阈值触发
 * =================================================================== */

/**
 * 计算某玩家在某集团上的 Buff 档位。
 * @returns {{tier:number, count:number, mult:number, name:string|null}}
 */
export function groupBuffTier(player, groupId) {
  const count = (player.institutions || [])
    .filter((i) => {
      const c = BOARD_CELLS[i.cellIndex];
      return c && c.group === groupId && !c.regulator && !i.mortgaged;
    }).length;
  let tier = 0;
  CONFIG.groupBuffThresholds.forEach((th, i) => { if (count >= th) tier = i + 1; });
  const mult = tier > 0 ? CONFIG.groupBuffRentMult[tier - 1] : 1;
  return {
    tier,
    count,
    mult,
    name: tier > 0 ? CONFIG.groupBuffNames[tier - 1] : null,
  };
}

/** 玩家所有集团的 Buff 汇总 */
export function allGroupBuffs(player) {
  const out = {};
  for (const g of ['bank', 'broker', 'insurer', 'asset']) {
    out[g] = groupBuffTier(player, g);
  }
  return out;
}

/**
 * 玩家在指定集团上应享受的租金系数（含全局监管效果）。
 */
export function buffMultiplierFor(player, groupId, state) {
  let mult = groupBuffTier(player, groupId).mult;
  // 银保监：全体租金下调（审慎约束）
  const reg = globalRegulatorEffects(state);
  if (reg.rentMult) mult *= reg.rentMult;
  return mult;
}

/* ===================================================================
 * 监管机构 —— 全局效果聚合
 * =================================================================== */

/**
 * 汇总全局监管效果（只统计当前存在的监管机构持有者）。
 * @returns {{roundBonus:number, upgradeCostMult:number, rentMult:number, trapRelief:number}}
 */
export function globalRegulatorEffects(state) {
  const eff = { roundBonus: 0, upgradeCostMult: 1, rentMult: 1, trapRelief: 0 };
  if (!state || !state.players) return eff;
  for (const p of state.players) {
    if (p.bankrupt) continue;
    for (const inst of (p.institutions || [])) {
      const cell = BOARD_CELLS[inst.cellIndex];
      if (!cell || !cell.regulator) continue;
      const e = CONFIG.regulatorEffects[cell.regulatorId];
      if (!e) continue;
      if (e.roundBonus) eff.roundBonus += e.roundBonus;
      if (e.upgradeCostMult) eff.upgradeCostMult *= e.upgradeCostMult;
      if (e.rentMult) eff.rentMult *= e.rentMult;
      if (e.trapRelief) eff.trapRelief = Math.max(eff.trapRelief, e.trapRelief);
    }
  }
  return eff;
}

/** 玩家是否持有某个监管机构 */
export function ownsRegulator(player, regulatorId) {
  return (player.institutions || []).some((i) => {
    const c = BOARD_CELLS[i.cellIndex];
    return c && c.regulator && c.regulatorId === regulatorId;
  });
}

/* ===================================================================
 * 央行贷款 —— 起点绕圈后可申请
 * =================================================================== */

/** 某档贷款每回合应付利息（单利，按本金计） */
export function loanInterestPerTurn(loanOrTier) {
  const amount = loanOrTier.amount;
  const rate = loanOrTier.rate;
  return Math.round(amount * rate);
}

/** 某档贷款到期应还的「本息合计」（本金 + 单利 × 期限） */
export function loanRepayAmount(tier) {
  const t = CONFIG.loanTiers.find((x) => x.id === tier) || CONFIG.loanTiers[0];
  return Math.round(t.amount * (1 + t.rate * t.term) * CONFIG.loanRepayMultiplier);
}

/** 单笔贷款当前未偿金额 = 本金 + 尚未支付的欠息 */
export function loanOutstandingAmount(loan) {
  return loan.amount + (loan.accruedInterest || 0);
}

/** 玩家未偿还的贷款总额（本金 + 欠息） */
export function outstandingLoan(player) {
  return (player.loans || []).reduce((a, l) => a + loanOutstandingAmount(l), 0);
}

/* ===================================================================
 * 限时 Buff —— 由特殊格赋予，持续若干「自己的回合」
 * =================================================================== */

/** 汇总玩家所有 Buff 在某个效果键上的乘数 */
export function buffEffectMult(player, key) {
  let mult = 1;
  for (const b of (player.buffs || [])) {
    const v = b.effect?.[key];
    if (typeof v === 'number' && v !== 1) mult *= v;
  }
  return mult;
}

/** 租金乘数（含集团 Buff / 监管 / 限时状态） */
export function playerRentMult(player, groupId, state) {
  return buffMultiplierFor(player, groupId, state) * buffEffectMult(player, 'rentMult');
}

/* ===================================================================
 * 债券 —— 向其他玩家发行
 * =================================================================== */

/**
 * 债券票息 —— 与发行人财务状况挂钩。
 *
 *   基础票息 6%；资产负债率超过 40% 后每 10 个百分点加 1.5%（上限 +6%）；
 *   净资产为负再加 2%；净资产雄厚（>6000）减 1%。
 *   最终限定在 5% ~ 18% 区间。
 */
export function bondCouponFor(state, issuer) {
  const m = financialMetrics(issuer, state);
  let coupon = CONFIG.bondCoupon;
  // 资产归零但仍有负债 → 视为极端高杠杆
  const ratio = m.assets > 0 ? m.debtRatio : (m.debt > 0 ? 100 : 0);
  const excess = Math.max(0, ratio - 40);
  coupon += Math.min(0.06, (excess / 10) * 0.015);
  if (m.netWorth < 0) coupon += 0.02;
  if (m.netWorth > 6000) coupon -= 0.01;
  coupon = Math.max(0.05, Math.min(0.18, coupon));
  return Math.round(coupon * 1000) / 1000;
}

/**
 * 一张债券的到期兑付金额。
 *
 * ⚠ m2（口径统一）：此前的实现返回「本金 + 累计票息」，
 *   与 processBonds 里的实际兑付口径（**本金** + 当期另付的票息）不一致，
 *   导致 HUD / 债务面板显示的数字和实际兑付对不上。
 *   现在统一为：**本金面值**（票息单独按期支付，不计入兑付额）。
 *
 * @param {object} bond
 * @returns {number} 每位认购者可获得的本金
 */
export function bondRedeemValue(bond) {
  return bond.face || 0;
}

/**
 * 一张债券的「累计已付票息」（仅供展示，与实际付息记录一致）。
 * @param {object} bond
 */
export function bondCouponPaidValue(bond) {
  const per = bond.couponPer ?? Math.round(bond.face * CONFIG.bondCoupon);
  return Math.round(per * (bond.couponsPaid || 0));
}

/** 发行一次债券需要的最低认购人数 */
export function bondMinSubscribers() {
  return CONFIG.bondMinSubscribers;
}
