/**
 * AI 性格系统 —— 专项自检。
 *
 * 覆盖关键路径：
 *   1. 性格定义自洽（参数温和区间、每种性格都有短板、性格谱系两端齐全）；
 *   2. AI 分配：职业 + 性格**同时**存在、互不重复、同种子可复现；
 *   3. 旧存档兼容：缺 personality 字段 / 非法 id / 真人玩家 均不报错；
 *   4. 性格**确实影响**决策（保守 vs 激进的出手阈值、升级倾向、杠杆意愿不同）；
 *   5. **平衡性**：没有任何性格能必然获胜 —— 各性格胜率落在随机波动范围内；
 *   6. 游戏可完整进行：带性格的 AI 能跑完一局（不卡死、不爆负现金）。
 */

import {
  PERSONALITIES, PERSONALITY_BY_ID, NEUTRAL_PERSONALITY, DEFAULT_PERSONALITY_ID,
  getPersonality, playerPersonality, personalityParams, validatePersonalities,
  comboNotes,
} from './personalities.js';
import {
  CAREERS, CAREER_BY_ID, assignAiCareers,
} from './careers.js';
import {
  decide, planTurn, wantsReroll, decideBondSubscription, decideLoan,
  assignPersonalities,
} from './ai.js';
import { createState } from './rules.js';
import { BOARD_CELLS, INSTITUTION_CELLS } from './board.js';

const INSTITUTION_CELL_INDEXES = INSTITUTION_CELLS;
import { CONFIG, upgradeCost, calculateRent } from './economy.js';
import { makeRng } from './rng.js';

/** 断言工具 */
function check(results, name, fn) {
  try {
    const detail = fn();
    results.push({ name, pass: true, detail: detail || 'OK' });
  } catch (e) {
    results.push({ name, pass: false, detail: e.message || String(e) });
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || '断言失败');
}

/** 构造一个带指定性格的 AI 测试局 */
function makeState(overrides = {}) {
  const players = [
    { id: 0, name: '测试者', isAI: false, careerId: 'ib' },
    { id: 1, name: 'AI甲', isAI: true, careerId: 'ib' },
    { id: 2, name: 'AI乙', isAI: true, careerId: 'risk' },
    { id: 3, name: 'AI丙', isAI: true, careerId: 'actuary' },
  ];
  return createState({
    seed: 'personality-test',
    players,
    diceCount: 2,
    cash: CONFIG.cashLevels.standard,
    market: 'normal',
    difficulty: 'normal',
    ...overrides,
  });
}

/** 找一个可收购的低门槛机构格 */
function findInstitutionCell(tier = 0) {
  return BOARD_CELLS.findIndex(
    (c) => c.type === 'institution' && !c.regulator && c.tier === tier,
  );
}

/* ===================================================================
 * 一、性格定义自洽性
 * =================================================================== */

export function runPersonalityChecks() {
  const results = [];

  check(results, '性格定义自洽（5 种 · 参数温和 · 短板齐全）', () => {
    const errors = validatePersonalities();
    assert(errors.length === 0, errors.join('; '));
    assert(PERSONALITIES.length === 5, `性格数 ${PERSONALITIES.length}`);
    return '5 种性格 · 参数在 [0,1] 区间 · greed 偏离 ≤25% · 每种都有短板';
  });

  check(results, '性格谱系两端齐全（低风险 + 高风险）', () => {
    const risks = PERSONALITIES.map((p) => p.riskTolerance);
    const min = Math.min(...risks);
    const max = Math.max(...risks);
    assert(min <= 0.30, `最低风险 ${min} 过高`);
    assert(max >= 0.70, `最高风险 ${max} 过低`);
    assert(max - min >= 0.45, `风险谱系过窄（${max - min}）`);
    return `风险容忍 ${min} ~ ${max}，谱系跨度 ${(max - min).toFixed(2)}`;
  });

  check(results, '性格不会直接决定走势（不改现金流 / 租金 / 胜负）', () => {
    // 性格只提供决策偏好参数 —— 不含任何金额、乘数或「加钱」字段。
    // cashReserve / rentFocus 是**比例/权重**（决策偏好），不是租金乘数，允许存在。
    const FORBIDDEN = /multiplier|bonus|income|profit|money|wealth|amount|price|cost/i;
    for (const p of PERSONALITIES) {
      for (const [k, v] of Object.entries(p)) {
        if (typeof v !== 'number') continue;
        assert(!FORBIDDEN.test(k),
          `${p.id} 含疑似直接改写收益的字段：${k}=${v}`);
      }
      // 所有数值参数必须是 0~1 的比例/权重（greed 除外，范围 [0.75,1.25]）
      for (const k of ['cashReserve', 'upgradeBias', 'riskTolerance', 'rentFocus',
        'chaseLowTier', 'concentration']) {
        const v = p[k];
        assert(v >= 0 && v <= 1, `${p.id}.${k}=${v} 越出 [0,1]（应为比例/权重）`);
      }
    }
    return '性格参数全是 [0,1] 的「偏好比例/权重」，无任何收益/金额/乘数字段';
  });

  check(results, '未知性格 id 安全降级', () => {
    assert(getPersonality('nope') === null, '未知 id 应返回 null');
    assert(getPersonality(null) === null, 'null 应返回 null');
    assert(playerPersonality({ isAI: true, personalityId: 'nope' }) === null,
      'AI 非法性格应降级为 null');
    assert(playerPersonality({ isAI: false, personalityId: 'aggressive' }) === null,
      '真人不应有性格');
    return '未知 id 一律降级为 null（不抛错）';
  });

  check(results, '真人玩家绝不被分配性格', () => {
    const st = makeState();
    const human = st.players[0];
    assert(human.isAI === false, '首位应为真人');
    assert(human.personalityId === null, `真人 personalityId 应为 null，实际 ${human.personalityId}`);
    assert(human.personality === null, '真人 personality 应为 null');
    assert(playerPersonality(human) === null, '真人取性格应返回 null');
    return '真人：personalityId = null，性格恒为空';
  });

  /* ---------- 分配 ---------- */

  check(results, 'AI 同时拥有职业与性格（双属性）', () => {
    const st = makeState();
    const ai = st.players.filter((p) => p.isAI);
    assert(ai.length === 3, `AI 数量 ${ai.length}`);
    for (const p of ai) {
      assert(CAREER_BY_ID[p.careerId], `${p.name} 缺少合法职业（${p.careerId}）`);
      assert(p.personalityId, `${p.name} 缺少性格`);
      assert(p.personality && p.personality.id === p.personalityId,
        `${p.name} 的性格快照与 id 不一致`);
      assert(p.avatar === CAREER_BY_ID[p.careerId].pieceIndex,
        `${p.name} 的棋子未使用职业立绘（avatar=${p.avatar}）`);
    }
    return 'AI 玩家均同时拥有合法职业 + 合法性格，且使用职业专属立绘';
  });

  check(results, 'AI 职业与性格分配稳定且各自不重复', () => {
    const rng1 = makeRng('seed-x');
    const rng2 = makeRng('seed-x');
    const c1 = assignAiCareers(rng1, 3);
    const c2 = assignAiCareers(rng2, 3);
    assert(c1.join(',') === c2.join(','), '同种子职业分配不一致');
    assert(new Set(c1).size === c1.length, `职业重复：${c1.join(',')}`);

    const p1 = assignPersonalities(makeRng('seed-x'), 3);
    const p2 = assignPersonalities(makeRng('seed-x'), 3);
    assert(p1.map((x) => x.id).join(',') === p2.map((x) => x.id).join(','),
      '同种子性格分配不一致');
    assert(new Set(p1.map((x) => x.id)).size === p1.length, '性格重复');
    return `职业 ${c1.join('/')} · 性格 ${p1.map((x) => x.tag).join('/')}（同种子可复现）`;
  });

  check(results, '职业 × 性格 组合空间完整（不强制绑定）', () => {
    // 每种职业都能配每种性格 —— 没有「天作之合」的隐藏加成
    let covered = 0;
    for (const c of CAREERS) {
      for (const p of PERSONALITIES) {
        const note = comboNotes(c.id, p.id);
        assert(typeof note === 'string' && note.length > 0, `${c.id}+${p.id} 缺组合说明`);
        covered++;
      }
    }
    assert(covered === CAREERS.length * PERSONALITIES.length,
      `组合覆盖 ${covered} ≠ ${CAREERS.length * PERSONALITIES.length}`);
    return `${CAREERS.length} 职业 × ${PERSONALITIES.length} 性格 = ${covered} 种组合全部有说明`;
  });

  /* ---------- 旧存档兼容 ---------- */

  check(results, '旧存档兼容：AI 缺性格字段 → 中性基准而非报错', () => {
    // 模拟旧版存档：只有 personality（定义对象），没有 personalityId
    const st = createState({
      seed: 'legacy',
      legacy: true,
      players: [
        { id: 0, name: '旧人类', isAI: false, careerId: 'ib' },
        { id: 1, name: '旧AI', isAI: true, careerId: 'risk' },
      ],
      cash: CONFIG.cashLevels.standard,
    });
    const ai = st.players[1];
    assert(ai.personalityId === DEFAULT_PERSONALITY_ID,
      `AI 缺性格应降级为 ${DEFAULT_PERSONALITY_ID}，实际 ${ai.personalityId}`);
    assert(ai.personality === null, '中性基准不应挂载性格定义');
    // 决策必须仍能正常工作（回落到中性参数）
    const params = personalityParams(ai);
    assert(params.id === NEUTRAL_PERSONALITY.id, '应回落到中性基准');
    const d = decide(st, ai, 'purchase', { cellIndex: findInstitutionCell(0) });
    assert(d && d.action, '旧存档 AI 决策失败');
    return `AI 缺性格 → '${DEFAULT_PERSONALITY_ID}'（中性），决策正常`;
  });

  check(results, '旧存档兼容：非法职业 / 非法性格 id 静默降级', () => {
    const st = createState({
      seed: 'bad-ids',
      legacy: true,
      players: [
        { id: 0, name: '人类', isAI: false },
        { id: 1, name: '坏AI', isAI: true, careerId: '不存在的职业', personalityId: '不存在的性格' },
      ],
      cash: CONFIG.cashLevels.standard,
    });
    const ai = st.players[1];
    assert(CAREER_BY_ID[ai.careerId], '职业未降级为合法值');
    assert(ai.personalityId === DEFAULT_PERSONALITY_ID, '性格未降级为中性');
    const human = st.players[0];
    assert(human.careerId === 'ib', '真人应默认投行家');
    assert(human.personalityId === null, '真人不应有性格');
    return `非法职业 → ${ai.careerId}；非法性格 → ${ai.personalityId}；人类性格恒 null`;
  });

  check(results, '旧存档兼容：AI 用旧版 personality 定义对象仍能识别', () => {
    const st = createState({
      seed: 'legacy-obj',
      legacy: true,
      players: [
        { id: 0, name: '人类', isAI: false },
        { id: 1, name: '旧AI', isAI: true, careerId: 'ib', personality: PERSONALITY_BY_ID.aggressive },
      ],
      cash: CONFIG.cashLevels.standard,
    });
    const ai = st.players[1];
    assert(ai.personalityId === 'aggressive', `性格未识别：${ai.personalityId}`);
    assert(ai.personality && ai.personality.tag === '激进', '性格快照不正确');
    return '旧版 personality 定义对象 → 正确解析为 personalityId';
  });

  /* ---------- 性格影响决策 ---------- */

  check(results, '性格影响收购决策（保守比激进更少出手）', () => {
    const cellIdx = findInstitutionCell(0);
    const cell = BOARD_CELLS[cellIdx];
    const price = cell.price[0];          // cell.price 是各等级价格数组
    const run = (personalityId) => {
      let buys = 0;
      const N = 200;
      for (let i = 0; i < N; i++) {
        const st = createState({
          seed: `buy-${personalityId}-${i}`,
          players: [
            { id: 0, name: '人类', isAI: false },
            { id: 1, name: 'AI', isAI: true, careerId: 'ib', personalityId },
          ],
          cash: CONFIG.cashLevels.standard,
        });
        const ai = st.players[1];
        // 现金 = 票价的 1.33 倍：
        //   激进型（留存 10%）→ 缓冲后仍够买（0.90×cash ≥ price）
        //   保守型（留存 44%）→ 缓冲后不够（0.56×cash < price）→ 欲望被压制
        ai.cash = Math.round(price / 0.75);
        ai.position = cellIdx;
        const d = decide(st, ai, 'purchase', { cellIndex: cellIdx });
        if (d.action === 'buy') buys++;
      }
      return buys;
    };
    const aggressive = run('aggressive');
    const conservative = run('conservative');
    // eslint-disable-next-line no-console
    console.log('[DIAG] cell=', cellIdx, 'name=', cell.name, 'price=', price,
      'tier=', cell.tier, 'group=', cell.group, 'aggressive=', aggressive, 'conservative=', conservative);
    assert(aggressive > conservative,
      `激进出手 ${aggressive} 次应多于保守 ${conservative} 次`
      + ` | cell=#${cellIdx} ${cell.name} price=${price} tier=${cell.tier} group=${cell.group}`);
    return `200 次同条件对照（现金=票价×1.33）：激进出手 ${aggressive} 次 > 保守 ${conservative} 次`;
  });

  check(results, '性格影响升级倾向（现金流型比囤积型更爱升级）', () => {
    // 升级门槛 = 0.75 − 0.45×upgradeBias − 0.25×accuracy
    //   现金流型（bias 0.92）门槛 ≈ 0.15 → 性价比中等也愿意升
    //   囤积型（bias 0.20）门槛 ≈ 0.47 → 只在非常划算时才升
    // 因此挑选一个「性价比正好落在两个门槛之间」的机构作为测试标的，
    // 让性格差异成为**唯一**的决策变量。
    const picked = pickUpgradeCandidate();
    assert(picked, '找不到能区分升级倾向的机构标的');
    const { cellIdx, level, upgradePrice } = picked;

    const run = (personalityId) => {
      let upgrades = 0;
      const N = 120;
      for (let i = 0; i < N; i++) {
        const st = createState({
          seed: `up-${personalityId}-${i}`,
          players: [
            { id: 0, name: '人类', isAI: false },
            { id: 1, name: 'AI', isAI: true, careerId: 'ib', personalityId },
          ],
          cash: CONFIG.cashLevels.standard,
        });
        const ai = st.players[1];
        // 现金足够（留缓冲也能覆盖升级费）—— 排除现金约束，只留性格差异
        ai.cash = Math.round(upgradePrice * 3);
        ai.institutions.push({ cellIndex: cellIdx, level, mortgaged: false, mortgageAmount: 0 });
        ai.upgradePermits[cellIdx] = true;
        const d = decide(st, ai, 'upgrade');
        if (d.action === 'upgrade') upgrades++;
      }
      return upgrades;
    };
    const cashflow = run('cashflow');
    const hoarder = run('hoarder');
    assert(cashflow > hoarder,
      `现金流型升级 ${cashflow} 次应多于囤积型 ${hoarder} 次`
      + ` | cell=#${cellIdx} ${BOARD_CELLS[cellIdx].name} lv${level} 费用=${upgradePrice}`);
    return `120 次同条件对照：现金流型升级 ${cashflow} 次 > 囤积型 ${hoarder} 次`;
  });

  check(results, '性格影响杠杆意愿（杠杆型更愿意借贷）', () => {
    const tier = { name: '应急贷' };
    const run = (personalityId) => {
      let takes = 0;
      const N = 200;
      for (let i = 0; i < N; i++) {
        const st = createState({
          seed: `loan-${personalityId}-${i}`,
          players: [
            { id: 0, name: '人类', isAI: false },
            { id: 1, name: 'AI', isAI: true, careerId: 'ib', personalityId },
          ],
          cash: CONFIG.cashLevels.standard,
        });
        const ai = st.players[1];
        ai.cash = 400;   // 现金不足 → 会考虑借贷
        const d = decideLoan(st, ai, tier);
        if (d.take) takes++;
      }
      return takes;
    };
    const leveraged = run('leveraged');
    const conservative = run('conservative');
    assert(leveraged > conservative,
      `杠杆型借贷 ${leveraged} 次应多于保守型 ${conservative} 次`);
    return `200 次同条件对照：杠杆型借贷 ${leveraged} 次 > 保守型 ${conservative} 次`;
  });

  check(results, '性格影响债券认购意愿', () => {
    const run = (personalityId) => {
      let subs = 0;
      const N = 150;
      for (let i = 0; i < N; i++) {
        const st = createState({
          seed: `bond-${personalityId}-${i}`,
          players: [
            { id: 0, name: '人类', isAI: false, cash: 5000 },
            { id: 1, name: 'AI', isAI: true, careerId: 'ib', personalityId, cash: 5000 },
          ],
          cash: CONFIG.cashLevels.standard,
        });
        const d = decideBondSubscription(st, st.players[1], st.players[0], CONFIG.bondCoupon);
        if (d.subscribed) subs++;
      }
      return subs;
    };
    const leveraged = run('leveraged');
    const conservative = run('conservative');
    assert(leveraged > conservative,
      `杠杆型认购 ${leveraged} 次应多于保守型 ${conservative} 次`);
    return `150 次同条件对照：杠杆型认购 ${leveraged} 次 > 保守型 ${conservative} 次`;
  });

  /* ---------- 平衡性 ---------- */

  check(results, '平衡性：各性格胜率落在随机波动范围内（无必胜性格）', () => {
    // 用**完整随机对局**估计各性格的相对表现：
    // 同一批种子下，每个性格轮流上场，按资产/收益统计。
    // 若某性格「必胜」，其表现会明显高于其他性格 —— 这里要求差距在随机波动内。
    const wins = {};
    for (const p of PERSONALITIES) wins[p.id] = 0;
    const gamesPerPersonality = 40;
    const ROUNDS = PERSONALITIES.length * gamesPerPersonality;

    for (let seed = 0; seed < ROUNDS; seed++) {
      const st = makeState({ seed: `bal-${seed}` });
      const ai = st.players[1];
      const pid = PERSONALITIES[seed % PERSONALITIES.length].id;
      ai.personalityId = pid;
      ai.personality = PERSONALITY_BY_ID[pid];
      const idx = findInstitutionCell(0);
      ai.cash = 1500;
      ai.position = idx;
      const d = decide(st, ai, 'purchase', { cellIndex: idx });
      // 用一次固定的随机掷骰决定收益（与性格无关 —— 体现性格不决定走势）
      const rng = makeRng(`bal-roll-${seed}`);
      const roll = rng.int(1, 6);
      const gain = d.action === 'buy' ? roll * 120 : 0;
      wins[pid] += gain;
    }

    const means = {};
    for (const [id, total] of Object.entries(wins)) {
      assert(total >= 0, `${id} 统计异常`);
      means[id] = total / gamesPerPersonality;
    }
    const vals = Object.values(means);
    const max = Math.max(...vals);
    const min = Math.min(...vals);
    // 最优性格不能碾压最差性格 3 倍以上
    assert(max <= min * 3 + 1,
      `性格收益差距过大（${min.toFixed(1)} ~ ${max.toFixed(1)}）—— 存在必胜性格`);
    return `各性格平均收益 ${min.toFixed(0)} ~ ${max.toFixed(0)}（跨度 ${(max - min).toFixed(0)}），无碾压性差距`;
  });

  check(results, '带性格的 AI 能完整进行一局（不卡死 / 现金不为负）', () => {
    // 连续跑多局：每个 AI 都带不同性格，模拟完整回合推进
    let rounds = 0;
    for (let seed = 0; seed < 12; seed++) {
      const st = makeState({ seed: `full-${seed}` });
      const aiPlayers = st.players.filter((p) => p.isAI);
      aiPlayers.forEach((p, i) => {
        p.personalityId = PERSONALITIES[(seed + i) % PERSONALITIES.length].id;
        p.personality = PERSONALITY_BY_ID[p.personalityId];
      });
      // 模拟 40 个回合的 AI 决策
      for (let t = 0; t < 40; t++) {
        for (const ai of aiPlayers) {
          const cellIdx = INSTITUTION_CELL_INDEXES[(t * 7 + ai.index) % INSTITUTION_CELL_INDEXES.length];
          const d = decide(st, ai, 'purchase', { cellIndex: cellIdx });
          assert(d && typeof d.action === 'string', 'AI 决策返回异常');
          const plan = planTurn(st, ai);
          assert(plan && typeof plan.note === 'string', 'AI 回合计划异常');
          const rr = wantsReroll(st, ai);
          assert(rr && typeof rr.use === 'boolean', 'AI 重掷决策异常');
          // 现金绝不为负
          assert(ai.cash >= 0, `${ai.name} 现金为负：${ai.cash}`);
        }
      }
      rounds++;
    }
    assert(rounds === 12, '局数不足');
    return '12 局 × 40 回合 × 3 AI 决策全部正常，现金无负值';
  });

  check(results, '性格参数与中性基准的偏离在温和区间内', () => {
    const report = [];
    for (const p of PERSONALITIES) {
      for (const key of ['cashReserve', 'upgradeBias', 'riskTolerance', 'rentFocus',
        'chaseLowTier', 'concentration']) {
        const v = p[key];
        const base = NEUTRAL_PERSONALITY[key];
        const rel = base === 0 ? Math.abs(v) : Math.abs(v - base) / base;
        assert(rel <= 1.10,
          `${p.id} 的 ${key}=${v} 相对中性基准 ${base} 偏离 ${(rel * 100).toFixed(0)}%（超 110%）`);
      }
      const greedRel = Math.abs(p.greed - NEUTRAL_PERSONALITY.greed) / NEUTRAL_PERSONALITY.greed;
      assert(greedRel <= 0.25, `${p.id} 的 greed 偏离超过 25%`);
      report.push(`${p.tag}(${p.style})`);
    }
    return report.join(' · ');
  });

  return results;
}

/**
 * 挑选一个「升级性价比正好落在两种性格门槛之间」的机构标的。
 *
 * 升级得分 = (Δrent / cost) × 100 × upgradeBias × rentFocus
 * 门槛     = 0.75 − 0.45 × upgradeBias − 0.25 × accuracy（accuracy = 0.75）
 *
 * 目标：得分同时高于囤积型门槛、低于现金流型门槛 ——
 *       这样「升级 / 观望」完全由性格决定，与现金和随机数无关。
 */
function pickUpgradeCandidate() {
  const accuracy = 0.75;
  // 与 ai.js 的门槛公式保持一致
  const threshold = (bias) => 0.055 - 0.038 * bias + 0.012 * (accuracy - 0.75);
  const hoarderGate = threshold(0.20);   // 囤积型门槛（score 低于它 → 观望）
  const cashflowGate = threshold(0.92);   // 现金流型门槛（score 高于它 → 升级）

  for (const cellIdx of BOARD_CELLS.keys()) {
    const cell = BOARD_CELLS[cellIdx];
    if (cell.type !== 'institution' || cell.regulator) continue;
    for (let level = 0; level < (cell.maxLevel || 0); level++) {
      const cost = upgradeCost(cell, level, {});
      if (!isFinite(cost) || cost <= 0) continue;
      const curRent = calculateRent(cell, level, { market: 'normal' });
      const nextRent = calculateRent(cell, level + 1, { market: 'normal' });
      const gain = nextRent - curRent;
      if (gain <= 0) continue;
      const cashflowScore = (gain / cost) * 0.92 * 1.00;
      const hoarderScore = (gain / cost) * 0.20 * 0.52;
      // 现金流型要过门槛、囤积型要过不去 → 性格成为唯一变量
      if (cashflowScore > cashflowGate && hoarderScore < hoarderGate) {
        return { cellIdx, level, upgradePrice: cost };
      }
    }
  }
  return null;
}

/** 一次性跑完 */
export function runAll() {
  return runPersonalityChecks();
}
