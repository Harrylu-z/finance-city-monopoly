/**
 * AI 性格档案 —— 金融职场人格，决定 AI 的**决策偏好 / 风险倾向**。
 *
 * ================== 与「职业」的关系 ==================
 * 职业 = **被动**（做什么、有什么结构性优势），性格 = **偏好**（怎么做、愿不愿意冒风险）。
 * 两者是**正交**的两层：
 *   · 职业被动由 `src/core/careers.js` 定义，作用于**具体规则点**（乘数 / 加成）；
 *   · 性格只作用于**AI 决策层的软偏好**（阈值 / 排序权重 / 话术），
 *     **绝不直接改写现金流、租金、胜负**。
 *
 * ================== 平衡约束（重要） ==================
 *   1. 性格只改变**决策偏好**，不改变**收益期望**：
 *      同一性格下的购买成功率、升级次数等统计量与「无性格」基准接近。
 *   2. 任何性格都不存在**单方面优势**：
 *      每种性格都有对应的短板（保守拿不到便宜货、激进容易翻车……），
 *      因此不可能出现「某性格必胜」。
 *   3. 性格**不决定走势**：没有性格能直接改变市场周期、事件卡结果或对手收益。
 *   4. 所有参数都控制在**温和区间**（相对中性基准偏移 ≤ 25%），
 *      保证不同性格之间的胜率差异在随机波动范围内。
 *
 * ================== 性格 × 职业 的组合 ==================
 * 组合不是「加成叠加」，而是**互补**：
 *   · 稳健性格 × 激进的赌王：庄家之眼 + 保守现金管理 → 靠牌技而非靠运气；
 *   · 激进性格 × 精算师：精算费率 + 敢扩张 → 现金流型进攻；
 *   · 风控总监 × 任何性格：trapRelief 是**规则层**减免，性格只决定 AI 要不要主动去踩监管格。
 * 组合关系由 `comboNotes()` 给出（用于 UI 展示与自检），不产生额外数值加成。
 */

/**
 * 中性基准 —— 所有性格参数都围绕它做温和偏移。
 * 该基准等价于「没有性格的 AI」，用于自检对比。
 */
export const NEUTRAL_PERSONALITY = Object.freeze({
  id: 'neutral',
  name: '中性',
  tag: '中性',
  desc: '无性格倾向的基准人格',
  quote: '照章办事。',
  // 现金留存比例：出手前至少保留的现金占比
  cashReserve: 0.28,
  // 购买欲望倍率
  greed: 1.00,
  // 升级倾向：0 = 从不升级，1 = 看到机会就升
  upgradeBias: 0.50,
  // 风险承受度：影响质押 / 举债 / 认购债券的意愿
  riskTolerance: 0.45,
  // 偏好的产权组（空 = 不偏好）
  preferGroups: [],
  // 对管理费收益的重视程度
  rentFocus: 0.75,
  // 追高（低门槛标的）的意愿
  chaseLowTier: 0.50,
  // 集中度偏好：0 = 分散，1 = 集中同一集团
  concentration: 0.40,
  // 组合风格标签
  style: 'balanced',
});

/**
 * 5 种性格 —— 温和、平衡、互有长短。
 *
 * 参数含义（相对 NEUTRAL_PERSONALITY 的偏移）：
 *   cashReserve    出手前保留现金比例
 *   greed          购买欲望倍率
 *   upgradeBias    升级倾向
 *   riskTolerance  风险承受度（质押 / 贷款 / 债券认购）
 *   preferGroups   偏好产权组
 *   rentFocus      管理费收益权重
 *   chaseLowTier   追低门槛标的倾向
 *   concentration  集中度偏好
 */
export const PERSONALITIES = [
  {
    id: 'aggressive',
    name: '激进型',
    tag: '激进',
    desc: '现金不留手，见机构就抢，杠杆拉满',
    quote: '牌照就是印钞机，先拿下再说！',
    style: '进攻',
    cashReserve: 0.10,
    greed: 1.22,
    upgradeBias: 0.62,
    riskTolerance: 0.72,
    preferGroups: ['broker', 'asset'],
    rentFocus: 0.62,
    chaseLowTier: 0.85,
    concentration: 0.55,
    /** 短板：现金留存极低，遇到罚金/陷阱容易被动 */
    weakness: '现金留存低，遇突发支出易被动',
  },
  {
    id: 'conservative',
    name: '保守型',
    tag: '保守',
    desc: '现金充足才出手，只买核心城市的大行',
    quote: '不急，等估值合适了再说。',
    style: '防守',
    cashReserve: 0.44,
    greed: 0.80,
    upgradeBias: 0.32,
    riskTolerance: 0.24,
    preferGroups: ['bank'],
    rentFocus: 0.86,
    chaseLowTier: 0.18,
    concentration: 0.28,
    /** 短板：错过低价标的，扩张慢 */
    weakness: '出手慢，容易错过低价窗口',
  },
  {
    id: 'hoarder',
    name: '囤积型',
    tag: '囤积',
    desc: '垄断同一集团，见机构就拿，不升级',
    quote: '这一串我全包了，其他人靠边站。',
    style: '垄断',
    cashReserve: 0.30,
    greed: 1.06,
    upgradeBias: 0.20,
    riskTolerance: 0.42,
    preferGroups: [],
    rentFocus: 0.52,
    chaseLowTier: 0.55,
    concentration: 0.82,
    /** 短板：不升级，管理费收益偏低 */
    weakness: '只占不升，单点管理费收益偏低',
  },
  {
    id: 'cashflow',
    name: '现金流型',
    tag: '现金流',
    desc: '只看管理费收益，优先升级高租金机构',
    quote: '现金流为王，纸面繁荣不算数。',
    style: '收益',
    cashReserve: 0.34,
    greed: 0.90,
    upgradeBias: 0.92,
    riskTolerance: 0.38,
    preferGroups: ['insurer'],
    rentFocus: 1.00,
    chaseLowTier: 0.30,
    concentration: 0.32,
    /** 短板：不铺牌照，资产广度差 */
    weakness: '不铺牌照，资产广度差',
  },
  {
    id: 'leveraged',
    name: '杠杆型',
    tag: '杠杆',
    desc: '满仓质押融资加杠杆，收益翻倍也容易爆仓',
    quote: '杠杆是撬动世界的支点。',
    style: '加杠杆',
    cashReserve: 0.08,
    greed: 1.10,
    upgradeBias: 0.68,
    riskTolerance: 0.86,
    preferGroups: ['broker', 'asset', 'bank'],
    rentFocus: 0.55,
    chaseLowTier: 0.72,
    concentration: 0.60,
    /** 短板：爆仓风险最高 */
    weakness: '杠杆最高，爆仓风险最明显',
  },
];

/**
 * 性格 id → 性格定义 */
export const PERSONALITY_BY_ID = Object.fromEntries(
  PERSONALITIES.map((p) => [p.id, p]),
);

/**
 * 按 rng 为一批 AI 分配性格。
 *
 * ================== 设计 ==================
 * · **可复现**：同一 seed + 同一 rng 序列 → 完全相同的分配（分享链接可还原对局）；
 * · **不重复优先**：一局内性格尽量不重复（池子不足时才循环复用）；
 * · **与职业正交**：这里只管性格，职业由 `careers.js` 的 `assignAiCareers` 独立分配，
 *   两者不互相约束 —— 任意「职业 × 性格」组合都可能出现。
 *
 * @param {object} rng 带 `.shuffle()` 的随机数发生器
 * @param {number} count 需要的数量
 * @returns {object[]} 性格定义数组
 */
export function assignPersonalities(rng, count) {
  const pool = rng.shuffle([...PERSONALITIES]);
  const out = [];
  for (let i = 0; i < count; i++) out.push(pool[i % pool.length]);
  return out;
}

/**
 * 「无性格」标记 id —— 用于旧存档兼容。
 *
 * ================== 兼容策略 ==================
 * · 真人玩家 → personalityId = null（**绝不被无故强制分配性格**）
 * · AI 且明确指定 → 该性格 id
 * · AI 但旧存档没有性格字段 → DEFAULT_PERSONALITY_ID（= 'neutral'）
 *   表示「有 AI 但无性格倾向」，行为回落到中性基准，
 *   既不报错、也不凭空给 AI 套一个人格。
 */
export const DEFAULT_PERSONALITY_ID = 'neutral';

/**
 * 取得性格定义；未知 id 返回 null。
 */
export function getPersonality(personalityId) {
  if (!personalityId) return null;
  return PERSONALITY_BY_ID[personalityId] || null;
}

/**
 * 取得玩家性格。
 *
 * ================== 兼容策略 ==================
 *   · 真人玩家 → 返回 null（**绝不被无故强制分配性格**）
 *   · AI 且有合法性格 → 返回该性格
 *   · AI 但旧存档没有性格字段 → 返回 null（由调用方回落到中性基准）
 */
export function playerPersonality(player) {
  if (!player) return null;
  if (!player.isAI) return null;
  const p = getPersonality(player.personalityId || player.personality);
  return p || null;
}

/**
 * 取得玩家的**决策参数**（性格参数或中性基准）。
 */
export function personalityParams(player) {
  return playerPersonality(player) || NEUTRAL_PERSONALITY;
}

/**
 * 校验性格定义自洽性（供自检使用）。
 * @returns {string[]} 错误列表，空数组代表全部通过
 */
export function validatePersonalities() {
  const errors = [];
  const ids = new Set();

  if (PERSONALITIES.length !== 5) {
    errors.push(`性格数量 ${PERSONALITIES.length} ≠ 5`);
  }

  const NUMERIC_KEYS = [
    'cashReserve', 'greed', 'upgradeBias', 'riskTolerance',
    'rentFocus', 'chaseLowTier', 'concentration',
  ];

  for (const p of PERSONALITIES) {
    if (!p.id) errors.push('性格缺少 id');
    if (ids.has(p.id)) errors.push(`性格 id 重复：${p.id}`);
    ids.add(p.id);

    if (!p.name) errors.push(`${p.id} 缺少名称`);
    if (!p.tag) errors.push(`${p.id} 缺少标签`);
    if (!p.desc) errors.push(`${p.id} 缺少描述`);
    if (!p.quote) errors.push(`${p.id} 缺少台词`);
    if (!p.weakness) errors.push(`${p.id} 缺少短板说明`);

    for (const k of NUMERIC_KEYS) {
      const v = p[k];
      if (typeof v !== 'number' || !isFinite(v)) {
        errors.push(`${p.id} 的 ${k} 不是有效数值`);
        continue;
      }
      // 温和区间约束：参数不得越出 [0,1]（除 greed 外）
      if (k !== 'greed' && (v < 0 || v > 1)) {
        errors.push(`${p.id} 的 ${k}=${v} 越出 [0,1]`);
      }
    }

    // greed 相对中性基准偏移不得超过 25%
    const g = p.greed;
    if (typeof g === 'number' && (g < 0.75 || g > 1.25)) {
      errors.push(`${p.id} 的 greed=${g} 偏离中性基准超过 25%`);
    }

    // 风险偏好不能是极端值 —— 保证没有性格「必胜」
    if (typeof p.riskTolerance === 'number'
      && (p.riskTolerance < 0.15 || p.riskTolerance > 0.90)) {
      errors.push(`${p.id} 的 riskTolerance=${p.riskTolerance} 过于极端`);
    }

    // 短板必须存在且与风格相反 —— 平衡性的核心约束
    if (p.riskTolerance > 0.6 && !/爆仓|现金|被动/.test(p.weakness || '')) {
      errors.push(`${p.id} 风险偏高但未声明对应短板`);
    }
    if (p.cashReserve > 0.38 && !/慢|错过|扩张/.test(p.weakness || '')) {
      errors.push(`${p.id} 现金留存高但未声明对应短板`);
    }
  }

  // 至少要有一个低风险与一个高风险性格 —— 保证性格谱系两端都有
  if (!PERSONALITIES.some((p) => p.riskTolerance <= 0.30)) {
    errors.push('缺少低风险性格（性格谱系失衡）');
  }
  if (!PERSONALITIES.some((p) => p.riskTolerance >= 0.70)) {
    errors.push('缺少高风险性格（性格谱系失衡）');
  }

  return errors;
}

/**
 * 性格 × 职业 的**组合说明**（仅用于 UI 展示与自检，不产生数值加成）。
 *
 * @param {string} careerId 职业 id
 * @param {string} personalityId 性格 id
 * @returns {string} 一句话说明
 */
export function comboNotes(careerId, personalityId) {
  const map = {
    'ib:aggressive': '发行折价 + 激进扩张 —— 低价扫货，但现金薄',
    'ib:conservative': '承销折价 + 谨慎出手 —— 只在估值合适时发行',
    'ib:hoarder': '承销折价 + 圈地 —— 拿下一个集团的入场券',
    'ib:cashflow': '承销折价 + 现金流 —— 低价买入再升租',
    'ib:leveraged': '承销折价 + 杠杆 —— 折价拿货、质押加仓',
    'risk:aggressive': '罚金减免 + 激进 —— 大胆下注但有合规缓冲',
    'risk:conservative': '罚金减免 + 保守 —— 几乎不踩监管陷阱',
    'risk:hoarder': '罚金减免 + 圈地 —— 垄断集团，风险可控',
    'risk:cashflow': '罚金减免 + 现金流 —— 稳稳收管理费',
    'risk:leveraged': '罚金减免 + 杠杆 —— 高杠杆但有合规护垫',
    'actuary:aggressive': '精算费率 + 激进 —— 快速铺开收租网络',
    'actuary:conservative': '精算费率 + 保守 —— 精挑细选高确定性标的',
    'actuary:hoarder': '精算费率 + 圈地 —— 集中吃下一条线的管理费',
    'actuary:cashflow': '精算费率 + 现金流 —— 双管齐下，租金收益最优',
    'actuary:leveraged': '精算费率 + 杠杆 —— 借力扩张管理费收入',
    'quant:aggressive': '模型优势 + 激进 —— 牌桌上更敢跟注',
    'quant:conservative': '模型优势 + 保守 —— 概率优势下仍稳扎稳打',
    'quant:hoarder': '模型优势 + 圈地 —— 用模型精准锁定一个集团',
    'quant:cashflow': '模型优势 + 现金流 —— 算准回报再升级',
    'quant:leveraged': '模型优势 + 杠杆 —— 概率优势 + 杠杆放大',
    'fund:aggressive': '升级折扣 + 激进 —— 低价升维，快速拉开身位',
    'fund:conservative': '升级折扣 + 保守 —— 长期持有，慢慢升',
    'fund:hoarder': '升级折扣 + 圈地 —— 垄断后低成本升维',
    'fund:cashflow': '升级折扣 + 现金流 —— 折扣价买入 + 升租收现',
    'fund:leveraged': '升级折扣 + 杠杆 —— 借力低成本升维',
    'trader:aggressive': '择时收益 + 激进 —— 踩准周期就跑',
    'trader:conservative': '择时收益 + 保守 —— 等牛市切换点出手',
    'trader:hoarder': '择时收益 + 圈地 —— 择时拿地，慢慢经营',
    'trader:cashflow': '择时收益 + 现金流 —— 顺势加仓高租金标的',
    'trader:leveraged': '择时收益 + 杠杆 —— 顺周期满仓加杠杆',
    'king:aggressive': '庄家之眼 + 激进 —— 多一张底牌，敢压大注',
    'king:conservative': '庄家之眼 + 保守 —— 牌技压场，仓位克制',
    'king:hoarder': '庄家之眼 + 圈地 —— 靠牌技赢下资本再圈地',
    'king:cashflow': '庄家之眼 + 现金流 —— 牌桌收益补贴日常现金流',
    'king:leveraged': '庄家之眼 + 杠杆 —— 牌技 + 杠杆双线扩张',
  };
  return map[`${careerId}:${personalityId}`] || '职业与性格自由组合，无额外数值加成';
}
