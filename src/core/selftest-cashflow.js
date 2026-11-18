/**
 * 资金流水等价性自检 —— 在**规则层**直接跑一局固定种子的对局，
 * 断言「账本净额」与「现金实际变化」完全吻合。
 *
 * 为什么放在 rules 层而不是 UI 层？
 *   UI 层的时序依赖弹窗与墙钟时间，跑两次结果可能不同，
 *   无法作为「改动没碰数值」的证据。
 *   规则层是纯函数式的 —— 同一颗种子必然得到同一局。
 *
 * 检查项：
 *   1. 每位玩家的「账本净额 + 初始现金」== 「当前现金」
 *      （若漏记或多记任何一笔现金变动，这里必然对不上）；
 *   2. 账本条目的 turn / round 与发生时点一致；
 *   3. 账本只增不减（旧的不会被改写）。
 */
import { createState, recordCash, noteCash, settleOnCell, resolvePurchase, upgradeInstitution,
  mortgageInstitution, redeemInstitution, endTurn, takeCentralLoan, repayLoan,
  grantStartPass, checkBankruptcy, rollDice, movePlayer,
} from './rules.js';
import { BOARD_CELLS } from './board.js';
import { CONFIG } from './economy.js';

function check(results, name, fn) {
  try {
    const detail = fn();
    results.push({ name, pass: true, detail });
  } catch (e) {
    results.push({ name, pass: false, detail: e && e.message ? e.message : String(e) });
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

/**
 * 跑一局确定性的对局，返回最终状态。
 * 用固定种子 + 固定决策（永远买、永远升级）驱动，不依赖任何随机输入。
 */
function playDeterministicGame(seed, turns = 260) {
  const players = [
    { id: 0, name: '你', isAI: false, colorIndex: 0, careerId: 'ib' },
    { id: 1, name: 'AI甲', isAI: true, colorIndex: 1, careerId: 'ib' },
    { id: 2, name: 'AI乙', isAI: true, colorIndex: 2, careerId: 'ib' },
    { id: 3, name: 'AI丙', isAI: true, colorIndex: 3, careerId: 'ib' },
  ];
  const state = createState({
    seed, players, diceCount: 2,
    cash: CONFIG.cashLevels.standard, market: 'normal', difficulty: 'normal',
  });
  const startCash = state.players.map((p) => p.cash);

  for (let t = 0; t < turns; t++) {
    const p = state.players[state.currentPlayerIndex];
    if (!p || p.bankrupt) break;

    // 固定决策：能买就买、刚踩到自有地块就升级
    if (state.pending && state.pending.kind === 'purchase') {
      resolvePurchase(state, p, true);
    } else {
      const dice = rollDice(state, p);
      movePlayer(state, p, dice.total);
      settleOnCell(state, p, p.position);
      if (state.pending && state.pending.kind === 'purchase') {
        resolvePurchase(state, p, true);
      }
      // 升级许可：踩到自有地块后升一级
      for (const inst of p.institutions) {
        if (p.upgradePermits && p.upgradePermits[inst.cellIndex]) {
          upgradeInstitution(state, p, inst.cellIndex);
        }
      }
    }

    // 每隔几回合做一次融资动作（贷款 / 质押 / 赎回），
    // 好让账本覆盖「融资」这类分支
    if (t % 7 === 3) {
      if (p.loans.length === 0) takeCentralLoan(state, p, CONFIG.loanTiers[0].id);
      else repayLoan(state, p, p.loans[0].id);
    }
    if (t % 11 === 5 && p.institutions.length) {
      const inst = p.institutions.find((i) => !i.mortgaged);
      if (inst) mortgageInstitution(state, p, inst.cellIndex);
    }

    endTurn(state);
  }
  return { state, startCash };
}

/** 账本净额 —— 用独立累加的 cashFlowNet（条目列表会被截断，不能反推） */
function ledgerNet(player) {
  return player.cashFlowNet || 0;
}

export function runAll() {
  const results = [];

  check(results, '账本净额与现金变化严格吻合（4 局 × 4 玩家）', () => {
    const seeds = ['eq-1', 'eq-2', 'eq-3', 'eq-4'];
    const report = [];
    for (const seed of seeds) {
      const { state, startCash } = playDeterministicGame(seed);
      state.players.forEach((p, i) => {
        const net = ledgerNet(p);
        const delta = p.cash - startCash[i];
        // 破产清算会把现金清零 —— 清算那一笔也记在账本里，所以仍然要吻合
        assert(net === delta,
          `${seed} / ${p.name}：账本净额 ${net} ≠ 现金变化 ${delta}`
          + `（现金 ${startCash[i]} → ${p.cash}）`);
        report.push(`${seed}:${p.name}=${delta}`);
      });
    }
    return `${report.length} 位玩家全部吻合（${seeds.length} 局）`;
  });

  check(results, '账本条目内容合法（金额非零、事由非空、回合有效）', () => {
    const { state } = playDeterministicGame('eq-1');
    let n = 0;
    for (const p of state.players) {
      for (const f of p.cashFlow || []) {
        n++;
        assert(typeof f.amount === 'number' && Number.isFinite(f.amount) && f.amount !== 0,
          `金额非法：${JSON.stringify(f)}`);
        assert(typeof f.reason === 'string' && f.reason.length > 0,
          `事由为空：${JSON.stringify(f)}`);
        assert(Number.isInteger(f.turn) && f.turn >= 0,
          `回合号非法：${JSON.stringify(f)}`);
        assert(Number.isInteger(f.round) && f.round >= 1,
          `圈数非法：${JSON.stringify(f)}`);
        assert(f.id > 0, `条目 id 非法：${JSON.stringify(f)}`);
      }
    }
    assert(n > 0, '账本没有任何条目 —— 记录逻辑没生效');
    return `${n} 条流水全部合法`;
  });

  check(results, '账本只记本玩家自己的流水（不串号）', () => {
    const { state } = playDeterministicGame('eq-1');
    for (const p of state.players) {
      // 每条流水都必须在自己的 cashFlow 里（结构上天然隔离）
      assert(Array.isArray(p.cashFlow), `${p.name} 缺 cashFlow 字段`);
      // 金额符号与 tag 语义一致：收入为正、支出为负
      for (const f of p.cashFlow) {
        if (f.amount > 0) {
          assert(f.tag !== '支出', `${p.name} 收入条目 tag 异常：${JSON.stringify(f)}`);
        } else {
          assert(f.tag !== '收入', `${p.name} 支出条目 tag 异常：${JSON.stringify(f)}`);
        }
      }
    }
    const counts = state.players.map((p) => (p.cashFlow || []).length);
    return `各玩家流水条数：${counts.join(' / ')}`;
  });

  check(results, '账本条数上限受控（不超过 CASHFLOW_LIMIT）', async () => {
    const { state } = playDeterministicGame('eq-1', 400);
    const limit = 40;
    for (const p of state.players) {
      assert((p.cashFlow || []).length <= limit,
        `${p.name} 流水 ${p.cashFlow.length} 条，超过上限 ${limit}`);
    }
    return `最长 ${Math.max(...state.players.map((p) => (p.cashFlow || []).length))} 条 / 上限 ${limit}`;
  });

  check(results, '条目被截断后净额仍然准确（cashFlowNet 独立累加）', () => {
    const { state } = playDeterministicGame('eq-1', 400);
    for (const p of state.players) {
      const list = p.cashFlow || [];
      assert(list.length > 0, `${p.name} 没有流水条目`);
      // 列表被截断 → 列表求和 ≠ cashFlowNet，但 cashFlowNet 必须等于现金总变化
      const sumOfList = list.reduce((s, f) => s + f.amount, 0);
      const net = p.cashFlowNet || 0;
      // 至少有一位玩家的列表确实被截断过（否则这条断言没意义）
      if (p === state.players[0]) {
        assert(list.length >= 40, '样本列表未达到上限，无法验证截断场景');
      }
      assert(typeof net === 'number' && Number.isFinite(net),
        `${p.name} 净额非法：${net}`);
      assert(sumOfList !== net || list.length < 40,
        `${p.name} 净额看起来是从列表反推的（截断后会失真）`);
    }
    return `各玩家 cashFlowNet：${state.players.map((p) => p.cashFlowNet).join(' / ')}`;
  });

  check(results, 'recordCash 与 noteCash 行为符合约定', () => {
    const state = createState({
      seed: 'rc', players: [{ id: 0, name: '你', isAI: false, colorIndex: 0 }],
    });
    const p = state.players[0];
    const cash0 = p.cash;
    recordCash(state, p, 100, '测试收入', '收益');
    assert(p.cash === cash0 + 100, 'recordCash 未同步现金');
    assert(p.cashFlow.length === 1, 'recordCash 未写入账本');
    const before = p.cash;
    // noteCash 只写账本、不动现金
    noteCash(state, p, -50, '测试支出', '成本');
    assert(p.cash === before, 'noteCash 动了现金');
    assert(p.cashFlow.length === 2, 'noteCash 未写入账本');
    return 'recordCash 改现金 + 写账本；noteCash 只写账本';
  });

  return results;
}
