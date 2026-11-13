/**
 * 职业系统 —— 7 种金融行业职业，各自带一个温和的出场被动。
 *
 * ================== 设计原则 ==================
 *   1. **不决定走势**：任何被动都只做「温和的效率修正」或「一次性小额缓冲」，
 *      绝不提供「免租 / 免罚 / 免债」这类直接改写胜负的强力效果。
 *   2. **可读可验**：每条被动都对应一个明确的数值修正（乘数 / 加成），
 *      规则层可计算、UI 可展示、自检可断言。
 *   3. **与既有机制同构**：优先复用现有的 buff 效果键
 *      （buyCostMult / upgradeCostMult / rentMult / trapRelief …），
 *      不新增平行体系，避免两套乘数互相打架。
 *
 * ================== 与「棋子形象」的关系 ==================
 * 职业与棋子形象**一一对应**：`pieceIndex` 指向 `src/art/pieces.js` 中的
 * 7 张专属职业棋子（索引 7..13），与 4 张经典棋子（索引 0..3）并存。
 * 同一职业永远使用同一张棋子形象 —— 玩家一眼就能从棋子认出职业。
 */

import { PLAYER_COLORS } from './palette.js';

/* ===================================================================
 * 职业定义
 * =================================================================== */

/**
 * 被动类型说明：
 *   · `mult`   —— 进入既有的 buff 效果键，参与乘数计算
 *   · `flat`   —— 一次性/条件性的固定金额加成
 *   · `flag`   —— 特性开关（由规则层按需读取）
 *
 * `hook` 字段标明该被动被哪个规则点读取，便于自检与维护。
 */
export const CAREERS = [
  {
    id: 'ib',
    name: '投行家',
    title: '投行部 · 承销负责人',
    desc: '一手包办发行，熟悉每一块牌照的定价。',
    pieceIndex: 7,
    passive: {
      id: 'underwriting',
      name: '承销定价',
      desc: '收购机构时价格 -8%（发行费折让）',
      hook: 'buyCostMult',
      effect: { buyCostMult: 0.92 },
    },
  },
  {
    id: 'risk',
    name: '风控总监',
    title: '风险合规 · 首席风控官',
    desc: '习惯性盯住敞口，从不把身家压在一处。',
    pieceIndex: 8,
    passive: {
      id: 'risk-buffer',
      name: '风险缓冲',
      desc: '触发监管陷阱时罚金 -30%',
      hook: 'trapRelief',
      effect: { trapRelief: 0.30 },
    },
  },
  {
    id: 'actuary',
    name: '精算师',
    title: '保险精算 · 定价分析师',
    desc: '把概率写进条款，管理费算得更细。',
    pieceIndex: 9,
    passive: {
      id: 'actuarial',
      name: '精算费率',
      desc: '自己收取的管理费 +6%',
      hook: 'rentMult',
      effect: { rentMult: 1.06 },
    },
  },
  {
    id: 'quant',
    name: '量化研究员',
    title: '量化交易 · 模型开发',
    desc: '相信数据胜过直觉，牌桌上也算概率。',
    pieceIndex: 10,
    passive: {
      id: 'model-edge',
      name: '模型优势',
      desc: '德州扑克中判定牌力时，坏牌判定更保守（更容易跟牌）',
      hook: 'pokerFoldBias',
      effect: { pokerFoldBias: 0.30 },
    },
  },
  {
    id: 'fund',
    name: '基金经理',
    title: '公募基金 · 组合经理',
    desc: '长期主义，愿意为高质量资产多付一点。',
    pieceIndex: 11,
    passive: {
      id: 'long-term',
      name: '长期持仓',
      desc: '机构升级费用 -6%',
      hook: 'upgradeCostMult',
      effect: { upgradeCostMult: 0.94 },
    },
  },
  {
    id: 'trader',
    name: '交易员',
    title: '交易台 · 自营操盘手',
    desc: '看盘极快，市场给的甜头从不放过。',
    pieceIndex: 12,
    passive: {
      id: 'market-timing',
      name: '择时交易',
      desc: '每圈首次踩到牛市/熊市切换格时额外获得 ￥120 价差收益',
      hook: 'marketBonus',
      effect: { marketBonus: 120 },
    },
  },
  {
    id: 'king',
    name: '赌王',
    title: '私人牌局 · 庄家对家',
    desc: '牌桌上的老手，懂得什么时候多要一张牌。',
    pieceIndex: 13,
    passive: {
      id: 'dealer-eye',
      name: '庄家之眼',
      desc: '德州扑克起始手牌比其他玩家多 1 张（全局牌库仍严格一副 52 张）',
      hook: 'pokerExtraHole',
      effect: { pokerExtraHole: 1 },
    },
  },
];

/** 职业 id → 职业定义 */
export const CAREER_BY_ID = Object.fromEntries(CAREERS.map((c) => [c.id, c]));

/** 默认职业（未选择 / 旧存档兼容） */
export const DEFAULT_CAREER_ID = 'ib';

/**
 * 取得职业定义；未知 id 返回 null。
 */
export function getCareer(careerId) {
  if (!careerId) return null;
  return CAREER_BY_ID[careerId] || null;
}

/**
 * 取得玩家职业（兼容旧存档：没有 career 字段时返回 null）。
 */
export function playerCareer(player) {
  return getCareer(player && player.career);
}

/**
 * 计算职业被动在某效果键上的乘数（1 = 无修正）。
 * 与 buff 效果键同构，可直接相乘叠加。
 *
 * @param {object} player
 * @param {string} key  'buyCostMult' | 'upgradeCostMult' | 'rentMult' | ...
 */
export function careerEffectMult(player, key) {
  const c = playerCareer(player);
  const v = c?.passive?.effect?.[key];
  return typeof v === 'number' && isFinite(v) ? v : 1;
}

/**
 * 取出职业被动中的固定数值加成（无则返回 0）。
 */
export function careerEffectValue(player, key) {
  const c = playerCareer(player);
  const v = c?.passive?.effect?.[key];
  return typeof v === 'number' && isFinite(v) ? v : 0;
}

/**
 * 职业被动是否触发某 hook（用于 flag 型效果）。
 */
export function careerHasHook(player, hook) {
  const c = playerCareer(player);
  return !!c && c.passive.hook === hook;
}

/**
 * 校验职业定义自洽性（供自检使用）。
 * @returns {string[]} 错误列表，空数组代表全部通过
 */
export function validateCareers() {
  const errors = [];
  const ids = new Set();
  const pieces = new Set();

  if (CAREERS.length !== 7) {
    errors.push(`职业数量 ${CAREERS.length} ≠ 7`);
  }

  for (const c of CAREERS) {
    if (!c.id) errors.push('职业缺少 id');
    if (ids.has(c.id)) errors.push(`职业 id 重复：${c.id}`);
    ids.add(c.id);

    if (!c.name) errors.push(`${c.id} 缺少名称`);
    if (!c.desc) errors.push(`${c.id} 缺少描述`);
    if (!c.passive) {
      errors.push(`${c.id} 缺少被动定义`);
      continue;
    }
    if (!c.passive.name) errors.push(`${c.id} 的被动缺少名称`);
    if (!c.passive.desc) errors.push(`${c.id} 的被动缺少说明`);
    if (!c.passive.hook) errors.push(`${c.id} 的被动缺少 hook`);

    // 职业棋子形象必须存在且与其他职业不同（一一对应）
    if (typeof c.pieceIndex !== 'number') {
      errors.push(`${c.id} 缺少 pieceIndex`);
    } else if (pieces.has(c.pieceIndex)) {
      errors.push(`棋子形象重复：${c.pieceIndex}`);
    } else {
      pieces.add(c.pieceIndex);
    }

    // 被动强度上限：乘数不得偏离 1 超过 15%，固定加成不得超过 ￥300
    const eff = c.passive.effect || {};
    for (const [k, v] of Object.entries(eff)) {
      if (typeof v !== 'number') {
        errors.push(`${c.id} 的 ${k} 不是数值`);
        continue;
      }
      if (k.endsWith('Mult')) {
        if (v < 0.85 || v > 1.15) {
          errors.push(`${c.id} 的 ${k}=${v} 偏离过大（应在 0.85~1.15）`);
        }
      } else if (Math.abs(v) > 300) {
        errors.push(`${c.id} 的 ${k}=${v} 固定加成过大（应 ≤300）`);
      }
    }
  }

  // 必须包含「赌王」
  if (!CAREER_BY_ID.king) errors.push('缺少「赌王」职业');

  return errors;
}

/**
 * 职业卡片配色（棋子描边 / 标签色）—— 取自玩家色板，保证与整体视觉一致。
 */
export function careerColor(careerId, colorIndex = 0) {
  const pc = PLAYER_COLORS[colorIndex % PLAYER_COLORS.length];
  return pc;
}

/**
 * 为一批 AI 随机分配职业 —— **本局内互不重复**。
 *
 * ================== 与性格分配的关系 ==================
 * 职业与性格是**两套独立抽取**：
 *   · 性格决定「怎么玩」（决策偏好）；
 *   · 职业决定「玩什么」（出场被动 + 立绘形象）。
 * 两者不挂钩 —— 任何职业都能配任何性格，组合空间完整，
 * 也就不会让某个 AI 因为「天作之合」而必然获胜。
 *
 * @param {object} rng 随机源（通常由 seed 派生，保证同种子可复现）
 * @param {number} count AI 数量
 * @returns {string[]} 职业 id 数组
 */
export function assignAiCareers(rng, count) {
  const pool = rng.shuffle([...CAREERS.map((c) => c.id)]);
  const out = [];
  for (let i = 0; i < count; i++) out.push(pool[i % pool.length]);
  return out;
}
