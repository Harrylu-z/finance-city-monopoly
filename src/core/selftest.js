/**
 * 规则引擎自检 —— 在浏览器内直接运行，覆盖核心规则。
 */

import {
  BOARD_CELLS, BOARD_SIZE, BOARD_SHAPE, GROUP_CELLS, REGULATOR_CELLS,
  UPGRADABLE_CELLS, REGULATORS, TRAP_CARDS, SPECIAL, validateBoard, LEVELS,
  CLEARING_TARGETS, TRACK_POINTS, trackSpacing, trackGap,
  SIDE_COUNTS, CORNER_INDICES, cellSideInfo,
} from './board.js';
import {
  CONFIG, calculateRent, upgradeCost, mortgageValue, redeemFee,
  isBankrupt, liquidate, purchasePrice, totalAssets,
  groupBuffTier, allGroupBuffs, globalRegulatorEffects, ownsRegulator,
  loanRepayAmount, bondRedeemValue, buffMultiplierFor, financialMetrics,
} from './economy.js';
import {
  createState, computeMove, computeTeleportSteps, rollDice, movePlayer, settleOnCell,
  resolvePurchase, upgradeInstitution, mortgageInstitution, redeemInstitution,
  endTurn, checkBankruptcy, rankPlayers, currentPlayer,
  applyTrapCard, takeCentralLoan, repayLoan, issueBond, processBonds,
} from './rules.js';
import {
  decide, planTurn, wantsReroll, assignPersonalities,
  decideBondSubscription, decideLoan,
} from './ai.js';
import { makeRng, hashSeed } from './rng.js';
import { getBuilding, getInstitutionSprite } from '../art/buildings.js';

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

/** 构造测试用状态 */
function makeTestState(overrides = {}) {
  const rng = makeRng('selftest');
  const personalities = assignPersonalities(rng, 3);
  const players = [
    { id: 0, name: '测试者', isAI: false, avatar: 0, colorIndex: 0 },
    { id: 1, name: 'AI甲', isAI: true, avatar: 1, colorIndex: 1, personality: personalities[0] },
    { id: 2, name: 'AI乙', isAI: true, avatar: 2, colorIndex: 2, personality: personalities[1] },
    { id: 3, name: 'AI丙', isAI: true, avatar: 3, colorIndex: 3, personality: personalities[2] },
  ];
  return createState({
    seed: 'selftest',
    players,
    diceCount: 2,
    cash: 1600,
    market: 'normal',
    difficulty: 'normal',
    ...overrides,
  });
}

/** 第一个机构格索引 */
function firstInstitution(state) {
  return BOARD_CELLS.findIndex((c) => c.type === 'institution');
}

/** 运行全部自检 */
export function runAll() {
  const results = [];

  /* ---------- 棋盘结构 ---------- */
  check(results, '棋盘结构完整性（45 机构 + 4 监管 + 14 特殊 = 63 格）', () => {
    const errors = validateBoard();
    assert(errors.length === 0, errors.join('; '));
    assert(BOARD_CELLS.length === BOARD_SIZE, `格数 ${BOARD_CELLS.length}`);
    assert(BOARD_SIZE === 63, `应为 63 格，实际 ${BOARD_SIZE}`);
    assert(BOARD_SHAPE.count === 63, '应为正方形环道布局（63 格）');
    assert(GROUP_CELLS.bank.length === 12, `银行组 ${GROUP_CELLS.bank.length} 格（应为 12）`);
    assert(GROUP_CELLS.broker.length === 12, `券商组 ${GROUP_CELLS.broker.length} 格（应为 12）`);
    assert(GROUP_CELLS.insurer.length === 12, `保险组 ${GROUP_CELLS.insurer.length} 格（应为 12）`);
    assert(GROUP_CELLS.asset.length === 13, `资管组 ${GROUP_CELLS.asset.length} 格（应为 13）`);
    assert(REGULATOR_CELLS.length === 4, `监管格 ${REGULATOR_CELLS.length} 个（应为 4）`);
    assert(UPGRADABLE_CELLS.length === 45, `可升级格 ${UPGRADABLE_CELLS.length} 个（应为 45）`);
    const specials = BOARD_CELLS.filter((c) => c.type === 'special').length;
    assert(specials === 14, `特殊格 ${specials} 个（应为 14）`);
    return '63 格 · 正方形连续环道 · 四大监管机构齐备';
  });

  check(results, '棋盘轮廓为严格正方形（宽高比 = 1，不旋转）', () => {
    const ratio = BOARD_SHAPE.aspect;
    assert(Math.abs(ratio - 1) < 1e-9, `棋盘宽高比应为 1，实际 ${ratio.toFixed(3)}`);
    // 轨道包围盒必须也是正方形：所有轨道点的 x/y 极值对称
    const xs = TRACK_POINTS.map((p) => p[0]);
    const ys = TRACK_POINTS.map((p) => p[1]);
    assert(Math.min(...xs) === 0 && Math.max(...xs) === 1000,
      `轨道 x 范围应为 0..1000，实际 ${Math.min(...xs)}..${Math.max(...xs)}`);
    assert(Math.min(...ys) === 0 && Math.max(...ys) === 1000,
      `轨道 y 范围应为 0..1000，实际 ${Math.min(...ys)}..${Math.max(...ys)}`);
  });

  check(results, '正方形环道：四边格子数正确且角格恰为 4 个', () => {
    assert(SIDE_COUNTS.right === 17 && SIDE_COUNTS.top === 17 &&
      SIDE_COUNTS.left === 17 && SIDE_COUNTS.bottom === 16,
      `边长分配应为 17/17/17/16，实际 ${SIDE_COUNTS.right}/${SIDE_COUNTS.top}/${SIDE_COUNTS.left}/${SIDE_COUNTS.bottom}`);
    const total = SIDE_COUNTS.right + SIDE_COUNTS.top + SIDE_COUNTS.left + SIDE_COUNTS.bottom - 4;
    assert(total === BOARD_SIZE, `四边合计（去重角格）应为 ${BOARD_SIZE}，实际 ${total}`);
    assert(CORNER_INDICES.length === 4, `角格应为 4 个，实际 ${CORNER_INDICES.length}`);
    // 每个角格都必须落在包围盒四角
    for (const i of CORNER_INDICES) {
      const [x, y] = TRACK_POINTS[i];
      const onCorner = (x === 0 || x === 1000) && (y === 0 || y === 1000);
      assert(onCorner, `index ${i} 被标记为角格但坐标 (${x},${y}) 不在四角`);
    }
    // 每条边的格子数应与实际分布吻合。
    // 归属约定：角格归「它开始的那条边」，因此每格恰好统计一次：
    //   右边 16（idx 0..15，其中 0 是右下角）+ 右上角归上边
    //   上边 16（idx 16..31，其中 16 是右上角）+ 左上角归左边
    //   左边 16（idx 32..47，其中 32 是左上角）+ 左下角归底边
    //   底边 15（idx 48..62，其中 48 是左下角）
    // 合计 16 × 3 + 15 = 63 ✔
    const counts = { right: 0, top: 0, left: 0, bottom: 0 };
    for (let i = 0; i < BOARD_SIZE; i++) counts[cellSideInfo(i).side]++;
    assert(counts.right === 16, `右边实际 ${counts.right} 格（应 16）`);
    assert(counts.top === 16, `上边实际 ${counts.top} 格（应 16）`);
    assert(counts.left === 16, `左边实际 ${counts.left} 格（应 16）`);
    assert(counts.bottom === 15, `底边实际 ${counts.bottom} 格（应 15）`);
    assert(counts.right + counts.top + counts.left + counts.bottom === BOARD_SIZE,
      '四边合计应等于 63');
  });

  check(results, '轨道是单条闭合连续环道（无断裂、无瞬移）', () => {
    assert(TRACK_POINTS.length === BOARD_SIZE, `轨道采样点 ${TRACK_POINTS.length} ≠ ${BOARD_SIZE}`);

    // ① 采样点互不重合
    const seen = new Set();
    for (let i = 0; i < BOARD_SIZE; i++) {
      const p = TRACK_POINTS[i];
      assert(p, `index ${i} 无轨道坐标`);
      const key = `${p[0]},${p[1]}`;
      assert(!seen.has(key), `index ${i} 与其他格重叠于 (${key})`);
      seen.add(key);
    }

    // ② 相邻间距必须均匀 —— 这是「连续」的核心保证。
    //    上一版外环→内环处间距是普通间距的数倍，棋子会瞬移。
    //    距离按「显示尺度」计算（x 映射 2a、y 映射 2b），
    //    否则横向被误当成与纵向等长，均匀性结论会失真。
    const dists = [];
    for (let i = 0; i < BOARD_SIZE; i++) {
      dists.push(trackGap(i));
    }
    const avg = dists.reduce((s, d) => s + d, 0) / dists.length;
    const maxD = Math.max(...dists);
    const minD = Math.min(...dists);
    assert(avg > 0, '轨道平均间距为 0');
    // 最大间距不得超过平均间距的 1.2 倍 —— 杜绝「瞬移」
    assert(maxD <= avg * 1.2,
      `轨道间距不均：平均 ${avg.toFixed(4)}，最大 ${maxD.toFixed(4)}（#${dists.indexOf(maxD)}）`);
    // 最小间距不能过小 —— 杜绝格子完全重叠
    assert(minD >= avg * 0.8,
      `轨道间距过小：平均 ${avg.toFixed(4)}，最小 ${minD.toFixed(4)}`);

    // ③ 闭合边（62 → 0）也必须满足均匀性
    const closeGap = dists[BOARD_SIZE - 1];
    assert(closeGap <= avg * 1.2, `闭合边间距 ${closeGap.toFixed(4)} 过大，绕圈会跳格`);

    // ④ trackSpacing 与实测一致
    assert(Math.abs(trackSpacing() - avg) < 1e-6, 'trackSpacing 与实测平均间距不符');
  });

  check(results, '环道围出的中心留白可用于金融城广场', () => {
    // 中心点 (500,500) 到最近轨道点的距离应足够大 —— 说明中心是空的
    let minDist = Infinity;
    for (const p of TRACK_POINTS) {
      const d = Math.hypot(p[0] - 500, p[1] - 500);
      if (d < minDist) minDist = d;
    }
    const avg = trackSpacing();
    assert(minDist > avg * 2.5,
      `中心留白过小：最近轨道点距中心 ${minDist.toFixed(1)}，间距 ${avg.toFixed(4)}`);
  });

  check(results, '轨道点严格落在包围盒内', () => {
    for (let i = 0; i < BOARD_SIZE; i++) {
      const [x, y] = TRACK_POINTS[i];
      assert(x >= 0 && x <= 1000, `index ${i} 的 x=${x} 越界`);
      assert(y >= 0 && y <= 1000, `index ${i} 的 y=${y} 越界`);
    }
  });

  check(results, '所有格子严格水平/垂直对齐（文字绝不倾斜）', () => {
    // 正方形环道的每条边必须完全水平或完全垂直 —— 这一点决定了
    // 地块名称与价格永远是水平文字，不会出现菱形布局的斜字。
    const edges = [
      { side: 'right',  axis: 'x', value: 1000 },
      { side: 'top',    axis: 'y', value: 0 },
      { side: 'left',   axis: 'x', value: 0 },
      { side: 'bottom', axis: 'y', value: 1000 },
    ];
    for (const e of edges) {
      const idxs = [];
      for (let i = 0; i < BOARD_SIZE; i++) {
        if (cellSideInfo(i).side === e.side) idxs.push(i);
      }
      for (const i of idxs) {
        const p = TRACK_POINTS[i];
        const v = e.axis === 'x' ? p[0] : p[1];
        assert(v === e.value,
          `${e.side} 边的 index ${i} 坐标 ${v} 未对齐到 ${e.value}（会破坏水平文字）`);
      }
    }
    // 非角格必须恰好落在一条边上（不可能同时属于两条边）
    for (let i = 0; i < BOARD_SIZE; i++) {
      const p = TRACK_POINTS[i];
      const onX = p[0] === 0 || p[0] === 1000;
      const onY = p[1] === 0 || p[1] === 1000;
      const onCorner = onX && onY;
      const side = cellSideInfo(i);
      if (!onCorner) {
        assert(onX || onY, `index ${i} 既不在边上也不在角上`);
        assert(side.corner === false, `index ${i} 被误判为角格`);
      } else {
        assert(side.corner === true, `index ${i} 是角格但未被标记`);
      }
    }
  });

  check(results, '特殊格均匀穿插（任意两个功能格不相邻）', () => {
    // 「功能格」= 特殊格 + 监管机构格。它们必须被普通机构格隔开，
    // 不能连成一片 —— 否则玩家的落点分布会严重偏斜。
    const isFunctional = (c) => c.type === 'special' || c.regulator;
    const functionalIdx = BOARD_CELLS.map((c, i) => (isFunctional(c) ? i : -1)).filter((i) => i >= 0);
    assert(functionalIdx.length === 18, `功能格应为 18 个（14 特殊 + 4 监管），实际 ${functionalIdx.length}`);

    // 环形相邻（含 62 → 0 的闭合边）不得出现功能格紧邻
    for (let i = 0; i < BOARD_CELLS.length; i++) {
      const a = BOARD_CELLS[i];
      const b = BOARD_CELLS[(i + 1) % BOARD_CELLS.length];
      assert(!(isFunctional(a) && isFunctional(b)),
        `#${i} ${a.name} 与 #${(i + 1) % BOARD_CELLS.length} ${b.name} 功能格相邻`);
    }

    // 特殊格子集同样必须互不相邻（更严格的读法也成立）
    const specialIdx = BOARD_CELLS.map((c, i) => (c.type === 'special' ? i : -1)).filter((i) => i >= 0);
    assert(specialIdx.length === 14, `特殊格应为 14 个，实际 ${specialIdx.length}`);
    for (let i = 0; i < specialIdx.length; i++) {
      const a = specialIdx[i];
      const b = specialIdx[(i + 1) % specialIdx.length];
      const gap = (b - a + BOARD_SIZE) % BOARD_SIZE;
      assert(gap >= 2, `特殊格 #${a} 与 #${b} 相邻（间隔 ${gap}）`);
    }

    // 起点必须是 index 0，且前后都隔着普通机构格
    assert(BOARD_CELLS[0].special && BOARD_CELLS[0].special.id === 'start', 'index 0 应为起点');
    assert(!isFunctional(BOARD_CELLS[1]), '起点后一格应为普通机构格');
    assert(!isFunctional(BOARD_CELLS[BOARD_SIZE - 1]), '起点前一格（环形闭合）应为普通机构格');

    // 分布均匀度：相邻功能格的最大间隔不应过大（避免大片连续普通格）
    const gaps = functionalIdx.map((v, i) =>
      (functionalIdx[(i + 1) % functionalIdx.length] - v + BOARD_SIZE) % BOARD_SIZE);
    const maxGap = Math.max(...gaps);
    assert(maxGap <= 8, `功能格最大间隔 ${maxGap} 过大，分布不均匀`);

    return `18 个功能格 · 最短间隔 ${Math.min(...gaps)} · 最长间隔 ${maxGap}`;
  });

  check(results, '四大监管机构齐备且不可升级', () => {
    const ids = new Set();
    for (const i of REGULATOR_CELLS) {
      const c = BOARD_CELLS[i];
      assert(c.regulator === true, `${c.name} 未标记 regulator`);
      assert(c.maxLevel === 0, `${c.name} maxLevel 应为 0`);
      assert(c.regulatorId && REGULATORS[c.regulatorId], `${c.name} 缺少 regulatorId`);
      ids.add(c.regulatorId);
    }
    assert(ids.size === 4, `监管机构种类 ${ids.size}（应为 4）`);
    for (const k of ['pbc', 'csrc', 'nfra', 'fsc']) {
      assert(ids.has(k), `缺少监管机构 ${k}`);
    }
    return '央行 / 证监会 / 金融监管总局 / 金稳会 —— 均不可升级';
  });

  check(results, '陷阱格存在且带独立卡池', () => {
    const traps = BOARD_CELLS.filter((c) => c.type === 'special' && c.special.trap);
    assert(traps.length === 2, `陷阱格 ${traps.length} 个（应为 2）`);
    assert(TRAP_CARDS.length >= 6, `陷阱卡 ${TRAP_CARDS.length} 张（应 ≥6）`);
    for (const t of traps) {
      assert(!!t.special.desc, `${t.special.id} 缺少说明`);
    }
    return `2 个陷阱格 · ${TRAP_CARDS.length} 张监管事件卡`;
  });

  check(results, '价格/租金梯度递增', () => {
    for (const c of BOARD_CELLS) {
      if (c.type !== 'institution' || c.regulator) continue;
      for (let i = 1; i < c.price.length; i++) {
        assert(c.price[i] > c.price[i - 1], `${c.name} 价格未递增`);
        assert(c.rent[i] > c.rent[i - 1], `${c.name} 租金未递增`);
      }
    }
    return '全部普通机构价格与租金随等级严格递增';
  });

  /* ---------- 移动与绕圈 ---------- */
  check(results, '移动与绕圈', () => {
    let m = computeMove(BOARD_SIZE - 1, 3, BOARD_SIZE);
    assert(m.position === 2, `${BOARD_SIZE - 1}+3 应为 2，实际 ${m.position}`);
    assert(m.passedStart === true, '应经过起点');

    m = computeMove(0, 1, BOARD_SIZE);
    assert(m.position === 1, '0+1 应为 1');
    assert(m.passedStart === false, '不应经过起点');

    m = computeMove(0, BOARD_SIZE, BOARD_SIZE);
    assert(m.position === 0, '整圈后应回到起点');
    assert(m.passedStart === true, '整圈应经过起点');

    m = computeMove(10, BOARD_SIZE * 3 + 5, BOARD_SIZE);
    assert(m.position === 15, `多圈计算错误：${m.position}`);
    assert(m.laps === 3, `圈数错误：${m.laps}`);
    return '绕圈与多圈计算正确';
  });

  check(results, '移动后玩家位置正确更新', () => {
    const state = makeTestState();
    const p = state.players[0];
    p.position = BOARD_SIZE - 3;
    const mv = movePlayer(state, p, 5);
    assert(p.position === 2, `位置应为 2，实际 ${p.position}`);
    assert(mv.passedStart, '应标记经过起点');
    return '位置更新与绕圈标记正确';
  });

  check(results, '经过起点时圈数递增', () => {
    const state = makeTestState();
    const p = state.players[0];
    const roundBefore = state.round;

    p.position = BOARD_SIZE - 3;
    movePlayer(state, p, 5);          // 53 → 2，经过起点
    assert(p.lastAction && p.lastAction.passedStart, 'lastAction 未记录经过起点');
    endTurn(state);
    assert(state.round === roundBefore + 1, `圈数应 +1，实际 ${state.round}`);

    // 未经过起点时圈数不变
    const roundNow = state.round;
    p.position = 0;
    movePlayer(state, p, 3);          // 0 → 3，不经过起点
    assert(!p.lastAction.passedStart, '不应标记经过起点');
    endTurn(state);
    assert(state.round === roundNow, `圈数不应变化，实际 ${state.round}`);
    return `绕圈后圈数 ${roundBefore} → ${state.round}`;
  });

  /* ---------- 收购扣款 ---------- */
  check(results, '收购扣款与股权入账', () => {
    const state = makeTestState();
    const p = state.players[0];
    const idx = firstInstitution(state);
    const cell = BOARD_CELLS[idx];
    const price = purchasePrice(cell, cell.tier, state.market);

    const before = p.cash;
    state.pending = { kind: 'purchase', cellIndex: idx, price, level: cell.tier, playerId: p.id };
    const ok = resolvePurchase(state, p, true);
    assert(ok, '收购应成功');
    assert(p.cash === before - price, `扣款错误：${before} → ${p.cash}`);
    assert(p.institutions.length === 1, '应持有 1 家机构');
    assert(p.institutions[0].cellIndex === idx, '机构索引错误');
    assert(state.pending === null, 'pending 应清空');
    return `扣款 ￥${price}，股权入账正确`;
  });

  check(results, '现金不足时收购失败', () => {
    const state = makeTestState();
    const p = state.players[0];
    p.cash = 10;
    const idx = firstInstitution(state);
    const cell = BOARD_CELLS[idx];
    state.pending = { kind: 'purchase', cellIndex: idx, price: cell.price[4] * 100, level: cell.tier, playerId: p.id };
    const ok = resolvePurchase(state, p, true);
    assert(!ok, '应收购失败');
    assert(p.institutions.length === 0, '不应持有机构');
    return '现金不足时正确拒绝';
  });

  /* ---------- 租金计算 ---------- */
  check(results, '租金计算与归属转移', () => {
    const state = makeTestState();
    const owner = state.players[1];
    const payer = state.players[0];
    const idx = firstInstitution(state);
    const cell = BOARD_CELLS[idx];

    owner.institutions.push({ cellIndex: idx, level: 2, mortgaged: false, mortgageAmount: 0 });
    payer.position = idx;
    const ownerBefore = owner.cash;
    const payerBefore = payer.cash;

    settleOnCell(state, payer, idx);

    const expect = calculateRent(cell, 2, { market: state.market, eventMult: state.eventMult });
    assert(payer.cash === payerBefore - expect, `付款方扣款错误：${payerBefore} → ${payer.cash}`);
    assert(owner.cash === ownerBefore + expect, `收款方入账错误：${ownerBefore} → ${owner.cash}`);
    assert(expect > 0, '租金应为正');
    return `管理费 ￥${expect} 正确转移`;
  });

  check(results, '等级越高租金越高', () => {
    const state = makeTestState();
    const idx = firstInstitution(state);
    const cell = BOARD_CELLS[idx];
    let last = 0;
    for (let lv = 0; lv <= 4; lv++) {
      const r = calculateRent(cell, lv, { market: 'normal', eventMult: 1 });
      assert(r > last, `等级 ${lv} 租金未提高`);
      last = r;
    }
    return '五级租金递增正确';
  });

  /* ---------- 升级费用 ---------- */
  check(results, '升级费用与等级推进', () => {
    const state = makeTestState();
    const p = state.players[0];
    const idx = firstInstitution(state);
    const cell = BOARD_CELLS[idx];
    p.institutions.push({ cellIndex: idx, level: 0, mortgaged: false, mortgageAmount: 0 });
    p.cash = 100000;

    const before = p.cash;
    const cost = upgradeCost(cell, 0);
    const res = upgradeInstitution(state, p, idx, { force: true });
    assert(res.ok, '升级应成功');
    assert(p.institutions[0].level === 1, '等级应变为 1');
    assert(p.cash === before - cost, `扣款错误：${before} → ${p.cash}`);
    assert(cost === Math.round(cell.price[1] * CONFIG.upgradeCostFactor), '升级费用公式不符');
    return `升级费 ￥${cost}，等级 0→1 正确`;
  });

  check(results, '升级到满级后拒绝继续升级', () => {
    const state = makeTestState();
    const p = state.players[0];
    const idx = firstInstitution(state);
    p.institutions.push({ cellIndex: idx, level: 4, mortgaged: false, mortgageAmount: 0 });
    p.cash = 100000;
    const res = upgradeInstitution(state, p, idx, { force: true });
    assert(!res.ok, '满级应拒绝升级');
    return '满级保护正确';
  });

  /* ---------- 再踏足升级规则 ---------- */
  check(results, '升级须再次踏足自有地块', () => {
    const state = makeTestState();
    const p = state.players[0];
    const idx = firstInstitution(state);
    p.institutions.push({ cellIndex: idx, level: 0, mortgaged: false, mortgageAmount: 0 });
    p.cash = 100000;

    // 未踏足 —— 应拒绝
    let res = upgradeInstitution(state, p, idx);
    assert(!res.ok, '未踏足时不应允许升级');
    assert(/踏足/.test(res.reason), `拒绝理由应为「需再次踏足」，实际「${res.reason}」`);
    assert(p.institutions[0].level === 0, '等级不应变化');

    // 踏足后 —— 获得升级许可
    p.position = idx;
    settleOnCell(state, p, idx);
    assert(p.upgradePermits[idx] === true, '踏足后应获得升级许可');

    res = upgradeInstitution(state, p, idx);
    assert(res.ok, '踏足后应允许升级');
    assert(p.institutions[0].level === 1, '等级应变为 1');
    // 许可被消耗
    assert(!p.upgradePermits[idx], '升级后许可应被消耗');

    // 再次升级 —— 需重新踏足
    res = upgradeInstitution(state, p, idx);
    assert(!res.ok, '许可消耗后不应允许再次升级');
    return '许可发放 / 消耗 / 阻断 三态正确';
  });

  check(results, '监管机构不可升级', () => {
    const state = makeTestState();
    const p = state.players[0];
    const idx = REGULATOR_CELLS[0];
    const cell = BOARD_CELLS[idx];
    p.institutions.push({ cellIndex: idx, level: 0, mortgaged: false, mortgageAmount: 0 });
    p.cash = 100000;
    p.position = idx;
    settleOnCell(state, p, idx);

    const res = upgradeInstitution(state, p, idx, { force: true });
    assert(!res.ok, '监管机构不应允许升级');
    assert(/不可升级/.test(res.reason), `理由应为「不可升级」，实际「${res.reason}」`);
    assert(p.institutions[0].level === 0, '等级不应变化');
    assert(isFinite(upgradeCost(cell, 0)) === false, '监管机构升级费应为 Infinity');
    return `${cell.name} 升级被正确阻止`;
  });

  /* ---------- 集团 Buff ---------- */
  check(results, '集团协同 Buff 阈值与租金加成', () => {
    const state = makeTestState();
    const p = state.players[0];
    const bankCells = GROUP_CELLS.bank.filter((i) => !BOARD_CELLS[i].regulator);

    // 0 家 —— 无加成
    let b = groupBuffTier(p, 'bank');
    assert(b.tier === 0 && b.mult === 1, '0 家不应有加成');

    // 3 家 —— 第 1 档
    for (let i = 0; i < 3; i++) {
      p.institutions.push({ cellIndex: bankCells[i], level: 0, mortgaged: false, mortgageAmount: 0 });
    }
    b = groupBuffTier(p, 'bank');
    assert(b.count === 3, `计数应为 3，实际 ${b.count}`);
    assert(b.tier === 1, `档位应为 1，实际 ${b.tier}`);
    assert(b.mult === CONFIG.groupBuffRentMult[0], `系数应为 ${CONFIG.groupBuffRentMult[0]}`);
    assert(b.name === CONFIG.groupBuffNames[0], 'Buff 名称不正确');

    // 6 家 —— 第 2 档
    for (let i = 3; i < 6; i++) {
      p.institutions.push({ cellIndex: bankCells[i], level: 0, mortgaged: false, mortgageAmount: 0 });
    }
    b = groupBuffTier(p, 'bank');
    assert(b.tier === 2, `档位应为 2，实际 ${b.tier}`);
    assert(b.mult === CONFIG.groupBuffRentMult[1], '第 2 档系数不正确');

    // 租金确实被加成
    const cell = BOARD_CELLS[bankCells[0]];
    const plain = calculateRent(cell, 0, { market: 'normal', eventMult: 1 });
    const buffed = calculateRent(cell, 0, { market: 'normal', eventMult: 1, buffMult: b.mult });
    assert(buffed > plain, `Buff 后租金应更高：${plain} → ${buffed}`);

    // 质押的不计入
    p.institutions[1].mortgaged = true;
    assert(groupBuffTier(p, 'bank').count === 5, '质押机构不应计入 Buff 计数');
    return `3 档阈值 ${CONFIG.groupBuffThresholds.join('/')} 生效，最高 ×${CONFIG.groupBuffRentMult[2]}`;
  });

  /* ---------- 监管机构效果 ---------- */
  check(results, '监管机构全局效果生效', () => {
    const state = makeTestState();
    const owner = state.players[1];

    // 初始 —— 无效果
    let eff = globalRegulatorEffects(state);
    assert(eff.roundBonus === 0, '初始不应有流动性投放');
    assert(eff.upgradeCostMult === 1, '初始升级费系数应为 1');

    // 持有证监会 —— 升级费 -12%
    const csrcIdx = REGULATOR_CELLS.find((i) => BOARD_CELLS[i].regulatorId === 'csrc');
    owner.institutions.push({ cellIndex: csrcIdx, level: 0, mortgaged: false, mortgageAmount: 0 });
    eff = globalRegulatorEffects(state);
    assert(Math.abs(eff.upgradeCostMult - 0.88) < 1e-9, `升级费系数应为 0.88，实际 ${eff.upgradeCostMult}`);
    assert(ownsRegulator(owner, 'csrc'), '应识别出持有证监会');

    // 持有央行 —— 每圈 +80
    const pbcIdx = REGULATOR_CELLS.find((i) => BOARD_CELLS[i].regulatorId === 'pbc');
    owner.institutions.push({ cellIndex: pbcIdx, level: 0, mortgaged: false, mortgageAmount: 0 });
    eff = globalRegulatorEffects(state);
    assert(eff.roundBonus === 80, `流动性投放应为 80，实际 ${eff.roundBonus}`);

    // 持有金稳会 —— 陷阱罚金减免 50%
    const fscIdx = REGULATOR_CELLS.find((i) => BOARD_CELLS[i].regulatorId === 'fsc');
    owner.institutions.push({ cellIndex: fscIdx, level: 0, mortgaged: false, mortgageAmount: 0 });
    eff = globalRegulatorEffects(state);
    assert(Math.abs(eff.trapRelief - 0.5) < 1e-9, `罚金减免应为 0.5，实际 ${eff.trapRelief}`);

    // 持有银保监 —— 全体租金 -8%
    const nfraIdx = REGULATOR_CELLS.find((i) => BOARD_CELLS[i].regulatorId === 'nfra');
    owner.institutions.push({ cellIndex: nfraIdx, level: 0, mortgaged: false, mortgageAmount: 0 });
    eff = globalRegulatorEffects(state);
    assert(Math.abs(eff.rentMult - 0.92) < 1e-9, `租金系数应为 0.92，实际 ${eff.rentMult}`);

    return '央行投放 / 证监会降费 / 银保监降租 / 金稳会减免 全部生效';
  });

  /* ---------- 陷阱格 ---------- */
  check(results, '陷阱格触发处罚且受金稳会减免', () => {
    const state = makeTestState();
    const p = state.players[0];
    const card = TRAP_CARDS.find((c) => c.effect.cash < 0);

    // 无金稳会 —— 全额罚款
    p.cash = 1000;
    let res = applyTrapCard(state, p, card);
    assert(res.cash === card.effect.cash, `罚款应为 ${card.effect.cash}，实际 ${res.cash}`);
    assert(p.cash === 1000 + card.effect.cash, '现金扣减错误');

    // 有金稳会 —— 罚金减半
    const owner = state.players[1];
    const fscIdx = REGULATOR_CELLS.find((i) => BOARD_CELLS[i].regulatorId === 'fsc');
    owner.institutions.push({ cellIndex: fscIdx, level: 0, mortgaged: false, mortgageAmount: 0 });
    p.cash = 1000;
    res = applyTrapCard(state, p, card);
    assert(res.relief === 0.5, '减免比例应为 0.5');
    assert(res.cash === Math.round(card.effect.cash * 0.5), `减免后罚金应为 ${Math.round(card.effect.cash * 0.5)}，实际 ${res.cash}`);

    return `基础罚款 ￥${card.effect.cash}，金稳会减免至 ￥${res.cash}`;
  });

  /* ---------- 央行贷款 ---------- */
  check(results, '央行贷款：取款、加息与偿还', () => {
    const state = makeTestState();
    const p = state.players[0];
    const tier = CONFIG.loanTiers[1];
    const before = p.cash;

    const res = takeCentralLoan(state, p, tier.id);
    assert(res.ok, '贷款应成功');
    assert(p.cash === before + tier.amount, `现金应增加 ${tier.amount}`);
    assert(p.loans.length === 1, '应记录 1 笔贷款');
    assert(res.repay === loanRepayAmount(tier.id), '还款额公式不符');
    assert(res.repay > tier.amount, '应含利息');
    // 期限必须按回合数、与额度匹配，而不是 1 圈
    assert(res.loan.dueTurn === state.turnNumber + tier.term,
      `到期回合应为借入回合 + ${tier.term}，实际 ${res.loan.dueTurn}`);
    assert(tier.term >= 4, `期限过短：${tier.term} 回合`);

    // 每圈只能一次
    const again = takeCentralLoan(state, p, tier.id);
    assert(!again.ok, '同一圈不应允许二次贷款');

    // 手动偿还
    p.cash = 100000;
    const rp = repayLoan(state, p, p.loans[0].id);
    assert(rp.ok, '还款应成功');
    assert(p.loans.length === 0, '贷款应被清除');
    return `借款 ￥${tier.amount}，期限 ${tier.term} 回合，到期还 ￥${res.repay}`;
  });

  check(results, '央行贷款期限按回合计，不被他人绕圈提前触发', () => {
    const state = makeTestState();
    const p = state.players[0];
    const tier = CONFIG.loanTiers[0];
    takeCentralLoan(state, p, tier.id);
    const cashAfterLoan = p.cash;
    const loan = p.loans[0];
    assert(loan.dueTurn === tier.term, `到期回合应为 ${tier.term}，实际 ${loan.dueTurn}`);

    // 连续 3 名玩家绕圈（圈数上涨），但回合数不足 —— 不应提前扣款
    for (let i = 0; i < Math.min(3, tier.term - 1); i++) {
      const cur = currentPlayer(state);
      cur.position = BOARD_SIZE - 1;
      movePlayer(state, cur, 1);
      endTurn(state);
    }
    assert(p.loans.length === 1, '他人绕圈导致贷款提前到期（周期未与回合匹配）');
    assert(state.round >= 2, `圈数应已上涨，实际 ${state.round}`);

    // 推进到到期回合
    let guard = 0;
    while (p.loans.length && guard++ < 50) endTurn(state);
    assert(p.loans.length === 0, '到期后贷款应被清除');
    assert(state.turnNumber >= loan.dueTurn, `应在第 ${loan.dueTurn} 回合结算，实际 ${state.turnNumber}`);
    assert(p.cash === cashAfterLoan - loan.repay, `应扣除 ${loan.repay}，实际扣除 ${cashAfterLoan - p.cash}`);
    return `${tier.term} 回合后到期，自动扣款 ￥${loan.repay}`;
  });

  /* ---------- 债券发行 ---------- */
  check(results, '债券发行需 ≥2 人认购方成立', () => {
    const state = makeTestState();
    const issuer = state.players[0];
    const before = issuer.cash;

    // 仅 1 人认购 —— 失败
    let res = issueBond(state, issuer, [{ playerId: 1, subscribed: true }]);
    assert(!res.ok, '1 人认购不应成立');
    assert(issuer.bonds.length === 0, '失败不应留下债券');
    assert(issuer.cash === before, '失败不应改变现金');

    // 2 人认购 —— 成功
    res = issueBond(state, issuer, [
      { playerId: 1, subscribed: true },
      { playerId: 2, subscribed: true },
      { playerId: 3, subscribed: false },
    ]);
    assert(res.ok, '2 人认购应成立');
    assert(res.subscribers === 2, `认购人数应为 2，实际 ${res.subscribers}`);
    assert(issuer.bonds.length === 1, '应记录 1 笔债券');
    assert(issuer.cash === before + CONFIG.bondFace * 2, `应募资 ${CONFIG.bondFace * 2}`);
    // 认购方扣款
    assert(state.players[1].cash === 1600 - CONFIG.bondFace, '认购方应扣款');
    assert(state.players[1].subscribedBonds.length === 1, '认购方应记录持有债券');
    return `2 人认购成立，募资 ￥${res.raised}`;
  });

  check(results, '债券按期付息并到期兑付', () => {
    const state = makeTestState();
    const issuer = state.players[0];
    issueBond(state, issuer, [
      { playerId: 1, subscribed: true },
      { playerId: 2, subscribed: true },
    ]);
    const buyer1 = state.players[1];
    const buyerCash = buyer1.cash;
    const couponEach = CONFIG.bondFace * CONFIG.bondCoupon;

    // 一圈付息
    processBonds(state);
    assert(buyer1.cash === buyerCash + couponEach, `认购方应收票息 ${couponEach}`);

    // 到期 —— 兑付本金（当期同时付息）
    state.round = CONFIG.bondTerm + 1;
    const buyerCashBefore = buyer1.cash;
    processBonds(state);
    assert(buyer1.cash === buyerCashBefore + CONFIG.bondFace + couponEach,
      `到期应兑付本金+票息，实际 ${buyer1.cash - buyerCashBefore}`);
    assert(buyer1.subscribedBonds.length === 0, '到期后应清除持有记录');
    assert(issuer.bonds.length === 0, '到期后发行方应清除债券');
    return `票息 ${Math.round(CONFIG.bondCoupon * 100)}% · ${CONFIG.bondTerm} 圈到期兑付`;
  });

  check(results, 'AI 债券认购决策可用', () => {
    const state = makeTestState();
    const buyer = state.players[1];
    const issuer = state.players[0];
    const d = decideBondSubscription(state, buyer, issuer);
    assert(typeof d.subscribed === 'boolean', '应返回认购布尔值');
    assert(typeof d.reason === 'string' && d.reason.length > 0, '应给出可读理由');

    // 现金不足时不应认购
    buyer.cash = 10;
    const d2 = decideBondSubscription(state, buyer, issuer);
    assert(d2.subscribed === false, '现金不足时不应认购');
    return `决策合理：${d.reason}`;
  });

  check(results, 'AI 贷款决策可用', () => {
    const state = makeTestState();
    const p = state.players[0];
    const tier = CONFIG.loanTiers[1];
    const d = decideLoan(state, p, tier);
    assert(typeof d.take === 'boolean', '应返回贷款布尔值');
    assert(typeof d.reason === 'string' && d.reason.length > 0, '应给出可读理由');

    // 现金充裕时不应贷款
    p.cash = 100000;
    const d2 = decideLoan(state, p, tier);
    assert(d2.take === false, '现金充裕时不应贷款');
    return `决策合理：${d.reason}`;
  });

  /* ---------- 质押与赎回 ---------- */
  check(results, '质押融资与赎回（反套利）', () => {
    const state = makeTestState();
    const p = state.players[0];
    const idx = firstInstitution(state);
    const cell = BOARD_CELLS[idx];
    p.institutions.push({ cellIndex: idx, level: 1, mortgaged: false, mortgageAmount: 0 });

    const before = p.cash;
    const mv = mortgageInstitution(state, p, idx);
    assert(mv.ok, '质押应成功');
    assert(p.cash === before + mv.amount, '质押未入账');
    assert(p.institutions[0].mortgaged === true, '未标记质押');

    const afterMv = p.cash;
    const fee = redeemFee(mv.amount);
    const total = mv.amount + fee;   // 赎回 = 归还本金 + 解押费
    const rd = redeemInstitution(state, p, idx);
    assert(rd.ok, '赎回应成功');
    assert(p.cash === afterMv - total, `赎回未足额扣款（本金+解押费）：${afterMv} → ${p.cash}`);
    assert(p.institutions[0].mortgaged === false, '未解除质押');
    // 反套利核心断言：质押→赎回一进一出必须净亏损，杜绝回合内刷现金
    assert(p.cash < before, `质押→赎回不应产生净收益：${before} → ${p.cash}`);
    assert(rd.total === total, '赎回返回的总额应为「本金+解押费」');

    // 现金不足以归还本金+解押费时必须拒绝赎回（旧版只验解押费，可无限套利）
    const mv2 = mortgageInstitution(state, p, idx);
    p.cash = redeemFee(mv2.amount);   // 只有解押费、没有本金
    const rd2 = redeemInstitution(state, p, idx);
    assert(!rd2.ok, '现金不足以归还本金时应拒绝赎回');
    assert(p.institutions[0].mortgaged === true, '被拒绝的赎回不应解除质押');
    return `质押 +￥${mv.amount}，赎回 -￥${total}（净 -￥${before - p.cash + mv2.amount}）`;
  });

  /* ---------- 质押机构暂停收租 ---------- */
  check(results, '已质押机构不产生管理费', () => {
    const state = makeTestState();
    const owner = state.players[0];
    const payer = state.players[1];
    const idx = firstInstitution(state);
    owner.institutions.push({ cellIndex: idx, level: 2, mortgaged: true, mortgageAmount: 500 });
    owner.cash = 1000;
    payer.cash = 1000;

    const results2 = settleOnCell(state, payer, idx);
    const noRent = results2.find((r) => r.kind === 'mortgaged-no-rent');
    assert(!!noRent, '踩到已质押机构应触发「暂停收租」而非扣租');
    assert(payer.cash === 1000, '已质押机构不应收取管理费');
    assert(owner.cash === 1000, '已质押机构不应给归属人带来收入');

    // 解押后恢复收租
    owner.institutions[0].mortgaged = false;
    owner.institutions[0].mortgageAmount = 0;
    const results3 = settleOnCell(state, payer, idx);
    const paid = results3.find((r) => r.kind === 'rent-paid');
    assert(!!paid && paid.rent > 0, '解押后应恢复收取管理费');
    return `质押 0 租金 → 解押后 ￥${paid ? paid.rent : 0}`;
  });

  /* ---------- 自身租金系数（评级展望）---------- */
  check(results, '自身租金系数 selfRentMult 应生效', () => {
    const state = makeTestState();
    const owner = state.players[0];
    const payer = state.players[1];
    const idx = firstInstitution(state);
    owner.institutions.push({ cellIndex: idx, level: 1, mortgaged: false, mortgageAmount: 0 });
    payer.cash = 100000;

    const results2 = settleOnCell(state, payer, idx);
    const base = results2.find((r) => r.kind === 'rent-paid');
    assert(!!base, '应产生租金');

    owner.selfRentMult = 1.12;   // 评级上调
    payer.position = idx;        // 重置位置，再次结算
    const results3 = settleOnCell(state, payer, idx);
    const up = results3.find((r) => r.kind === 'rent-paid');
    assert(up.rent === Math.round(base.rent * 1.12), `评级上调后租金应 ×1.12：${base.rent} → ${up.rent}`);
    return `基础 ￥${base.rent} → 上调后 ￥${up.rent}`;
  });

  /* ---------- 破产判定 ---------- */
  check(results, '破产判定与清算', () => {
    const state = makeTestState();
    const p = state.players[0];
    p.cash = -500;
    p.institutions = [];
    assert(isBankrupt(p, state), '现金为负应判定破产');

    p.cash = 100;
    assert(!isBankrupt(p, state), '现金为正不应破产');

    const idx = firstInstitution(state);
    p.cash = -50;
    p.institutions.push({ cellIndex: idx, level: 4, mortgaged: false, mortgageAmount: 0 });
    assert(!isBankrupt(p, state), '有可变现资产不应破产');

    p.cash = -100000;
    const res = liquidate(p);
    assert(p.bankrupt === true, '应标记破产');
    assert(p.cash >= 0, '清算后现金不应为负');
    assert(res.actions.length > 0, '应有清算动作记录');
    return `清算回收 ￥${res.settlement}`;
  });

  check(results, '已破产玩家被跳过', () => {
    const state = makeTestState();
    state.players[1].bankrupt = true;
    state.currentPlayerIndex = 1;
    const next = endTurn(state);
    assert(next && !next.bankrupt, '应跳过破产玩家');
    assert(next.index !== 1, '不应仍停在破产玩家');
    return '轮转正确跳过破产玩家';
  });

  /* ---------- 牛熊周期 ---------- */
  check(results, '牛熊周期影响租金', () => {
    const state = makeTestState();
    const cell = BOARD_CELLS[firstInstitution(state)];
    const normal = calculateRent(cell, 2, { market: 'normal', eventMult: 1 });
    const bull = calculateRent(cell, 2, { market: 'bull', eventMult: 1 });
    const bear = calculateRent(cell, 2, { market: 'bear', eventMult: 1 });

    assert(bull > normal, `牛市租金应更高：${bull} vs ${normal}`);
    assert(bear < normal, `熊市租金应更低：${bear} vs ${normal}`);
    assert(bull === Math.round(normal * CONFIG.bullRentMult), '牛市系数不符');
    assert(bear === Math.round(normal * CONFIG.bearRentMult), '熊市系数不符');
    return `正常 ￥${normal} / 牛 ￥${bull} / 熊 ￥${bear}`;
  });

  check(results, '牛熊按圈数切换', () => {
    const state = makeTestState();
    const start = state.market;
    state.players[0].lastAction = { passedStart: true };
    endTurn(state);
    assert(state.market === start, `第 2 圈不应切换周期，实际 ${state.market}`);
    return '周期切换节奏正确（每 3 圈）';
  });

  /* ---------- 特殊格 ---------- */
  check(results, '特殊格结算（合规成本）', () => {
    const state = makeTestState();
    const p = state.players[0];
    const taxIdx = BOARD_CELLS.findIndex((c) => c.type === 'special' && c.special.id === 'tax');
    assert(taxIdx > 0, '应存在合规成本格');

    // 合规成本格在印花税 / 交易手续费 / 监管罚款中随机取其一
    const VALID = [140, 180, 240];
    const seen = new Set();
    for (let i = 0; i < 60; i++) {
      p.cash = 1000;
      const before = p.cash;
      const results = settleOnCell(state, p, taxIdx);
      const charged = results.find((r) => r.kind === 'charge');
      assert(!!charged, '合规成本格应产生扣款');
      assert(VALID.includes(charged.amount), `合规成本金额非法：${charged.amount}`);
      assert(before - charged.amount === p.cash, '合规成本未正确扣除');
      seen.add(charged.amount);
    }
    assert(seen.size > 1, '合规成本应为随机多档，而非固定值');
    return `随机扣除 ${[...seen].sort((a, b) => a - b).map((v) => '￥' + v).join(' / ')}`;
  });

  check(results, '起点补贴', () => {
    const state = makeTestState();
    const p = state.players[0];
    const before = p.cash;
    settleOnCell(state, p, 0);
    assert(p.cash === before + CONFIG.startBonus, '起点补贴未发放');
    return `+￥${CONFIG.startBonus}`;
  });

  check(results, '清算所跳转与跨境互联', () => {
    const state = makeTestState();
    const p = state.players[0];
    const clearIdx = BOARD_CELLS.findIndex((c) => c.type === 'special' && c.special.id === 'clearing');
    settleOnCell(state, p, clearIdx);
    assert(state.pending && state.pending.kind === 'teleport', '清算所应产生跳转');
    assert(state.pending.target !== clearIdx, '跳转目标不应是自身');

    const crossIdx = BOARD_CELLS.findIndex((c) => c.type === 'special' && c.special.id === 'crossborder');
    state.pending = null;
    settleOnCell(state, p, crossIdx);
    assert(state.pending && state.pending.kind === 'teleport', '跨境互联应产生跳转');
    return '两类跳转格均正常';
  });

  check(results, '瞬移步数恒为正（向后跳不会算出负步数）', () => {
    // 清算所 / 跨境互联 的目标可能位于当前位置之前，必须环绕成正向步数
    const cases = [
      [0, 46], [46, 0], [22, 10], [10, 22], [11, 21], [21, 11], [47, 1], [1, 47],
    ];
    for (const [from, to] of cases) {
      const steps = computeTeleportSteps(from, to, BOARD_SIZE);
      assert(steps > 0, `瞬移步数必须为正：${from} → ${to} 得到 ${steps}`);
      assert(steps < BOARD_SIZE, `瞬移步数不应超过一圈：${from} → ${to} 得到 ${steps}`);
      const landed = ((from + steps) % BOARD_SIZE + BOARD_SIZE) % BOARD_SIZE;
      assert(landed === to, `瞬移落点错误：${from} + ${steps} ≠ ${to}`);
    }
    // 目标与起点相同 → 走满一圈
    assert(computeTeleportSteps(5, 5, BOARD_SIZE) === BOARD_SIZE, '同位置应走满一圈');

    // 真实数据驱动：清算所的每一个跳转目标都必须能算出正步数
    const clearIdx = BOARD_CELLS.findIndex((c) => c.type === 'special' && c.special.id === 'clearing');
    assert(clearIdx >= 0, '应存在清算所格');
    for (const target of CLEARING_TARGETS) {
      const cell = BOARD_CELLS[target];
      assert(cell && cell.type === 'institution' && !cell.regulator,
        `清算所目标 ${target}（${cell && cell.name}）应为普通机构格`);
      assert(target !== clearIdx, '清算所目标不能是清算所自身');
      const steps = computeTeleportSteps(clearIdx, target, BOARD_SIZE);
      assert(steps > 0 && steps < BOARD_SIZE, `清算所瞬移步数异常：${clearIdx} → ${target} = ${steps}`);
      const landed = (clearIdx + steps) % BOARD_SIZE;
      assert(landed === target, `清算所瞬移落点错误：${clearIdx} + ${steps} ≠ ${target}`);
    }
    // 清算所目标必须分散在地图不同方位（至少覆盖 3 个不同区段）
    const quarters = new Set(CLEARING_TARGETS.map((t) => Math.floor(t / (BOARD_SIZE / 4))));
    assert(quarters.size >= 3, `清算所目标分布过于集中（仅 ${quarters.size} 个区段）`);
    return '正反方向瞬移均正确 · 清算所 4 个目标全部有效';
  });

  /* ---------- AI 决策 ---------- */
  check(results, 'AI 决策不崩溃（3 难度 × 5 局）', () => {
    let decisions = 0;
    for (const diff of ['novice', 'normal', 'expert']) {
      for (let i = 0; i < 5; i++) {
        const state = makeTestState({ difficulty: diff, seed: `ai-${diff}-${i}` });
        const idx = firstInstitution(state);
        for (const p of state.players) {
          if (!p.isAI) continue;
          const d = decide(state, p, 'purchase', { cellIndex: idx });
          assert(d && typeof d.action === 'string', '购买决策格式错误');
          assert(typeof d.reason === 'string' && d.reason.length > 0, '决策理由缺失');
          decisions++;

          const u = decide(state, p, 'upgrade');
          assert(u && typeof u.action === 'string', '升级决策格式错误');
          decisions++;

          const m = decide(state, p, 'mortgage');
          assert(m && typeof m.action === 'string', '质押决策格式错误');
          decisions++;

          const plan = planTurn(state, p);
          assert(plan && typeof plan.wantUpgrade === 'boolean', '回合计划格式错误');

          const rr = wantsReroll(state, p);
          assert(rr && typeof rr.use === 'boolean', '重掷决策格式错误');
        }
      }
    }
    assert(decisions > 100, '决策次数不足');
    return `执行 ${decisions} 次决策，全部合法`;
  });

  check(results, 'AI 随机性：不同种子产生不同行为', () => {
    const idx = firstInstitution(makeTestState());
    const stateA = makeTestState({ seed: 'seed-A' });
    const stateB = makeTestState({ seed: 'seed-B' });
    const dA = decide(stateA, stateA.players[1], 'purchase', { cellIndex: idx });
    const dB = decide(stateB, stateB.players[1], 'purchase', { cellIndex: idx });
    const same = dA.action === dB.action && dA.reason === dB.reason;
    assert(!same, '不同种子应产生不同决策');
    return `A: ${dA.action} / B: ${dB.action}`;
  });

  check(results, 'AI 不作弊（决策不含骰子信息）', () => {
    const state = makeTestState();
    const p = state.players[1];
    const idx = firstInstitution(state);
    const d = decide(state, p, 'purchase', { cellIndex: idx });
    assert(!('dice' in d) && !('total' in d), '决策不应包含骰子结果');
    return '决策函数不接收骰子结果';
  });

  /* ---------- 完整回合模拟 ---------- */
  check(results, '完整 200 回合模拟无死循环/崩溃', () => {
    const state = makeTestState();
    state.maxTurns = 200;
    let guard = 0;
    while (state.phase !== 'gameover' && guard < 300) {
      guard++;
      const p = state.players[state.currentPlayerIndex];
      if (!p.bankrupt) {
        const { dice } = rollDice(state, p);
        const total = dice.reduce((a, b) => a + b, 0);
        movePlayer(state, p, total);
        const results = settleOnCell(state, p, p.position);
        for (const r of results) {
          if (r.kind === 'purchase-offer') {
            const d = decide(state, p, 'purchase', { cellIndex: r.cellIndex });
            state.pending = { kind: 'purchase', cellIndex: r.cellIndex, price: r.price, level: r.level, playerId: p.id };
            resolvePurchase(state, p, d.action === 'buy');
          } else if (r.kind === 'teleport') {
            state.pending = null;
            movePlayer(state, p, (r.target - p.position + BOARD_SIZE) % BOARD_SIZE);
            settleOnCell(state, p, p.position);
          } else if (r.kind === 'metro-choice') {
            state.pending = null;
            movePlayer(state, p, 2);
            settleOnCell(state, p, p.position);
          } else if (r.kind === 'event-card') {
            state.pending = null;
          }
        }
        if (state.pending && state.pending.kind === 'purchase') state.pending = null;
        checkBankruptcy(state, p);
      }
      endTurn(state);
    }
    assert(guard < 300, '疑似死循环');
    const ranked = rankPlayers(state);
    assert(ranked.length === state.players.length, '排名数量错误');
    const alive = state.players.filter((p) => !p.bankrupt);
    assert(alive.length >= 1, '至少应有一名存活玩家');
    assert(state.round >= 2, `201 回合应至少完成 2 圈，实际 ${state.round} 圈`);
    return `模拟 ${guard} 回合，存活 ${alive.length} 人，共 ${state.round} 圈`;
  });

  check(results, '多种子 50 局快速对局不崩溃', () => {
    for (let i = 0; i < 50; i++) {
      const state = makeTestState({ seed: `multi-${i}` });
      state.maxTurns = 60;
      let guard = 0;
      while (state.phase !== 'gameover' && guard < 80) {
        guard++;
        const p = state.players[state.currentPlayerIndex];
        if (!p.bankrupt) {
          const { dice } = rollDice(state, p);
          movePlayer(state, p, dice.reduce((a, b) => a + b, 0));
          const res = settleOnCell(state, p, p.position);
          for (const r of res) {
            if (r.kind === 'purchase-offer') {
              const d = decide(state, p, 'purchase', { cellIndex: r.cellIndex });
              state.pending = { kind: 'purchase', cellIndex: r.cellIndex, price: r.price, level: r.level, playerId: p.id };
              resolvePurchase(state, p, d.action === 'buy');
            }
          }
          if (state.pending && state.pending.kind === 'purchase') state.pending = null;
          checkBankruptcy(state, p);
        }
        endTurn(state);
      }
    }
    return '50 局全部正常结束';
  });

  /* ---------- 资产计算 ---------- */
  check(results, '总资产 = 现金 + 机构市值', () => {
    const state = makeTestState();
    const p = state.players[0];
    p.cash = 1000;
    const idx = firstInstitution(state);
    p.institutions.push({ cellIndex: idx, level: 2, mortgaged: false, mortgageAmount: 0 });
    const cell = BOARD_CELLS[idx];
    const expect = 1000 + cell.price[2];
    assert(totalAssets(p, state) === expect, `资产计算错误：${totalAssets(p, state)} vs ${expect}`);
    return `总资产 ￥${expect}`;
  });

  /* ---------- 财务指标（资产排行下钻） ---------- */
  check(results, '财务指标 · 总资产与总资产口径一致', () => {
    const state = makeTestState();
    const p = state.players[0];
    p.cash = 1000;
    const idx = firstInstitution(state);
    p.institutions.push({ cellIndex: idx, level: 2, mortgaged: false, mortgageAmount: 0 });
    const m = financialMetrics(p, state);
    assert(m.assets === totalAssets(p, state), `财务指标总资产 ${m.assets} 与 totalAssets 不一致`);
    assert(m.cash === 1000, '现金口径错误');
    assert(m.institutionCount === 1, '机构数口径错误');
    assert(m.activeCount === 1, '在营机构数口径错误');
    assert(m.pledgedCount === 0, '质押机构数口径错误');
    assert(m.debt === 0, '无负债时总负债应为 0');
    assert(m.netWorth === m.assets, '无负债时净资产应等于总资产');
    assert(m.debtRatio === 0, '无负债时资产负债率应为 0');
    return `总资产 ￥${m.assets} · 净资产 ￥${m.netWorth}`;
  });

  check(results, '财务指标 · 负债与资产负债率口径正确', () => {
    const state = makeTestState();
    const p = state.players[0];
    p.cash = 500;
    const idx = firstInstitution(state);
    const cell = BOARD_CELLS[idx];
    p.institutions.push({ cellIndex: idx, level: 1, mortgaged: false, mortgageAmount: 0 });

    // 制造一笔贷款负债
    p.loans.push({ id: 'L1', tier: 'micro', name: '支小再贷款', amount: 600, rate: 0.03, term: 4, repay: 672, takenTurn: 1, dueTurn: 5 });
    const m = financialMetrics(p, state);
    assert(m.loanDebt === 672, `未偿贷款口径错误：${m.loanDebt}`);
    assert(m.debt === 672, `总负债口径错误：${m.debt}`);
    assert(m.netWorth === m.assets - 672, '净资产口径错误');
    const expectRatio = Math.round((672 / m.assets) * 1000) / 10;
    assert(m.debtRatio === expectRatio, `资产负债率错误：${m.debtRatio} vs ${expectRatio}`);
    assert(m.equityRatio === Math.round(((m.assets - 672) / m.assets) * 1000) / 10, '权益比率错误');
    return `负债 ￥${m.debt} · 资产负债率 ${m.debtRatio}%`;
  });

  check(results, '财务指标 · 质押机构计入市值但不计入在营', () => {
    const state = makeTestState();
    const p = state.players[0];
    p.cash = 0;
    const idx = firstInstitution(state);
    const cell = BOARD_CELLS[idx];
    p.institutions.push({
      cellIndex: idx, level: 1, mortgaged: true,
      mortgageAmount: Math.round(cell.price[1] * CONFIG.mortgageRatio),
    });
    const m = financialMetrics(p, state);
    assert(m.pledgedCount === 1, '质押机构数错误');
    assert(m.activeCount === 0, '在营机构数错误');
    assert(m.mortgagedAmount > 0, '质押融资本金应为正');
    assert(m.debt === m.mortgagedAmount, '质押融资本金应计入总负债');
    assert(m.assets === Math.round(cell.price[1] * 0.5), '已质押机构应按半值计入总资产');
    return `质押市值 ￥${m.mortgagedValue} · 负债 ￥${m.debt}`;
  });

  check(results, '财务指标 · 管理费收入随市场周期变化', () => {
    const state = makeTestState({ market: 'normal' });
    const p = state.players[0];
    const idx = firstInstitution(state);
    p.institutions.push({ cellIndex: idx, level: 2, mortgaged: false, mortgageAmount: 0 });
    const normal = financialMetrics(p, state).rentIncome;

    state.market = 'bull';
    const bull = financialMetrics(p, state).rentIncome;
    state.market = 'bear';
    const bear = financialMetrics(p, state).rentIncome;

    assert(bull > normal, `牛市管理费应高于常态：${bull} vs ${normal}`);
    assert(bear < normal, `熊市管理费应低于常态：${bear} vs ${normal}`);
    return `熊 ${bear} / 常 ${normal} / 牛 ${bull}`;
  });

  check(results, '财务指标 · 全玩家均可安全计算（不崩溃）', () => {
    const state = makeTestState();
    for (const p of state.players) {
      const m = financialMetrics(p, state);
      assert(typeof m.assets === 'number', '总资产应为数字');
      assert(typeof m.debtRatio === 'number', '资产负债率应为数字');
      assert(m.netWorth === m.assets - m.debt, '净资产口径错误');
      assert(m.institutionCount === 0, '初始状态不应持有机构');
    }
    return `${state.players.length} 位玩家指标计算正常`;
  });

  /* ---------- RNG ---------- */
  check(results, 'RNG 确定性（同种子同结果）', () => {
    const a = makeRng('abc');
    const b = makeRng('abc');
    for (let i = 0; i < 20; i++) {
      assert(a.next() === b.next(), '同种子结果不一致');
    }
    const c = makeRng('abd');
    const d = makeRng('abd');
    assert(c.next() === d.next(), '同种子结果不一致');
    assert(hashSeed('abc') === hashSeed('abc'), '哈希不稳定');
    return 'RNG 完全可复现';
  });

  check(results, '等级定义完整（5 级）', () => {
    assert(LEVELS.length === 5, '应有 5 个等级');
    const labels = LEVELS.map((l) => l.label);
    assert(labels.includes('网点级') && labels.includes('地标级'), '缺少首尾等级');
    for (let i = 1; i < LEVELS.length; i++) {
      assert(LEVELS[i].mult > LEVELS[i - 1].mult, '等级倍率未递增');
    }
    return LEVELS.map((l) => l.label).join(' → ');
  });

  /* ============ 像素立绘 ============ */
  check(results, '机构立绘互不相同（48 家独立像素肖像）', () => {
    const insts = BOARD_CELLS.filter((c) => c.group);
    const seen = new Map();
    for (const c of insts) {
      const cv = getInstitutionSprite(c, c.tier, null, 0);
      const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
      let key = '';
      for (let i = 0; i < d.length; i += 4) key += `${d[i]},${d[i + 1]},${d[i + 2]},${d[i + 3]};`;
      assert(!seen.has(key), `${c.name} 与 ${seen.get(key)} 的立绘完全相同`);
      seen.set(key, c.name);
    }
    assert(seen.size === insts.length, `应有 ${insts.length} 张独立立绘，实际 ${seen.size}`);
    return `${seen.size}/${insts.length} 立绘均不相同`;
  });

  check(results, '建筑等级高度递进（网点 → 地标）', () => {
    const cell = BOARD_CELLS.find((c) => c.group === 'bank' && !c.regulator);
    const heights = [];
    for (let lv = 0; lv <= 4; lv++) {
      const cv = getBuilding({
        kind: cell.kind, level: lv, group: cell.group,
        groupIndex: 0, seed: cell.index, landmark: false,
      });
      heights.push(cv.height);
    }
    for (let i = 1; i < heights.length; i++) {
      assert(heights[i] > heights[i - 1], `等级 ${i} 高度未超过等级 ${i - 1}`);
    }
    const landmark = BOARD_CELLS.find((c) => c.landmark);
    const lcv = getBuilding({
      kind: landmark.kind, level: 4, group: landmark.group,
      groupIndex: 0, seed: landmark.index, landmark: true,
    });
    assert(lcv.height > heights[4], '地标级建筑未高于最高等级');
    return `高度 ${heights.join(' → ')}，地标 ${lcv.width}×${lcv.height}`;
  });

  check(results, '四大集团建筑形态互不相同', () => {
    const kinds = ['bank', 'broker', 'insurer', 'asset'];
    const shapes = kinds.map((g) => {
      const cell = BOARD_CELLS.find((c) => c.group === g && !c.landmark);
      const cv = getBuilding({
        kind: cell.kind, level: 2, group: g,
        groupIndex: 0, seed: cell.index, landmark: false,
      });
      const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
      let key = '';
      for (let i = 0; i < d.length; i += 4) key += `${d[i]},${d[i + 1]},${d[i + 2]},${d[i + 3]};`;
      return key;
    });
    assert(new Set(shapes).size === 4, '四大集团的建筑立绘存在重复');
    return '银行/券商/保险/资管 四种轮廓均不同';
  });

  return results;
}
