/**
 * 规则引擎自检 —— 在浏览器内直接运行，覆盖核心规则。
 */

import {
  BOARD_CELLS, BOARD_SIZE, BOARD_SHAPE, GROUP_CELLS, REGULATOR_CELLS,
  UPGRADABLE_CELLS, REGULATORS, TRAP_CARDS, SPECIAL, validateBoard, LEVELS,
  CLEARING_TARGETS, TRACK_POINTS, trackSpacing, trackGap,
  INNER_INDICES, GATE_INDICES, TRACK_CELLS, ZONES, cellSideInfo,
  cellZone, isInner, isGate, WHEELS, WHEEL_BY_ID,
} from './board.js';
import {
  CONFIG, calculateRent, upgradeCost, mortgageValue, redeemFee,
  isBankrupt, liquidate, purchasePrice, totalAssets,
  groupBuffTier, allGroupBuffs, globalRegulatorEffects, ownsRegulator,
  loanRepayAmount, bondRedeemValue, buffMultiplierFor, financialMetrics,
  bondCouponFor, buffEffectMult,
} from './economy.js';
import {
  createState, computeMove, computeTeleportSteps, rollDice, movePlayer, settleOnCell,
  resolvePurchase, upgradeInstitution, mortgageInstitution, redeemInstitution,
  endTurn, checkBankruptcy, rankPlayers, currentPlayer,
  applyTrapCard, takeCentralLoan, repayLoan, issueBond, processBonds,
  underwriteBond, addBuff,
} from './rules.js';
import {
  decide, planTurn, wantsReroll, assignPersonalities,
  decideBondSubscription, decideLoan,
} from './ai.js';
import { makeRng, hashSeed } from './rng.js';
import { getBuilding, getInstitutionSprite } from '../art/buildings.js';
import { getCareerPieceSprites, pieceSignature } from '../art/career-pieces.js';
import { getCardFace, getCardBack } from '../art/cards.js';
import { CAREERS, CAREER_BY_ID } from './careers.js';
import { runAll as runCareerCasinoChecks } from './selftest-career-casino.js';
import { runAll as runPersonalityChecks } from './selftest-personality.js';

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
    // 不传 avatar —— 立绘由职业唯一决定
    { id: 0, name: '测试者', isAI: false, colorIndex: 0 },
    { id: 1, name: 'AI甲', isAI: true, colorIndex: 1, personality: personalities[0] },
    { id: 2, name: 'AI乙', isAI: true, colorIndex: 2, personality: personalities[1] },
    { id: 3, name: 'AI丙', isAI: true, colorIndex: 3, personality: personalities[2] },
  ];
  return createState({
    seed: 'selftest',
    players,
    diceCount: 2,
    cash: CONFIG.cashLevels.standard,
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
  check(results, '棋盘结构完整性（35 机构 + 4 监管 + 7 特殊 = 46 格）', () => {
    const errors = validateBoard();
    assert(errors.length === 0, errors.join('; '));
    assert(BOARD_CELLS.length === BOARD_SIZE, `格数 ${BOARD_CELLS.length}`);
    assert(BOARD_SIZE === 46, `应为 46 格，实际 ${BOARD_SIZE}`);
    assert(BOARD_SHAPE.count === 46, '应为同心双环布局（46 格）');
    assert(GROUP_CELLS.bank.length === 10, `银行组 ${GROUP_CELLS.bank.length} 格（应为 10）`);
    assert(GROUP_CELLS.broker.length === 9, `券商组 ${GROUP_CELLS.broker.length} 格（应为 9）`);
    assert(GROUP_CELLS.insurer.length === 9, `保险组 ${GROUP_CELLS.insurer.length} 格（应为 9）`);
    assert(GROUP_CELLS.asset.length === 11, `资管组 ${GROUP_CELLS.asset.length} 格（应为 11）`);
    assert(REGULATOR_CELLS.length === 4, `监管格 ${REGULATOR_CELLS.length} 个（应为 4）`);
    assert(UPGRADABLE_CELLS.length === 35, `可升级格 ${UPGRADABLE_CELLS.length} 个（应为 35）`);
    const specials = BOARD_CELLS.filter((c) => c.type === 'special').length;
    assert(specials === 7, `特殊格 ${specials} 个（应为 7：起点 1 + 转盘 4 + 赌场 2）`);
    return '46 格 · 同心双环闭合回路 · 四大监管机构齐备 · 4 转盘 + 2 赌场';
  });

  check(results, '棋盘为 10×7 横向网格（宽高比 = 10/7）', () => {
    const ratio = BOARD_SHAPE.aspect;
    assert(Math.abs(ratio - 10 / 7) < 1e-9, `棋盘宽高比应为 10/7，实际 ${ratio.toFixed(4)}`);
    assert(BOARD_SHAPE.cols === 10 && BOARD_SHAPE.rows === 7,
      `网格应为 10 列 × 7 行，实际 ${BOARD_SHAPE.cols} × ${BOARD_SHAPE.rows}`);
    // 轨道包围盒必须铺满 0..1000
    const xs = TRACK_POINTS.map((p) => p[0]);
    const ys = TRACK_POINTS.map((p) => p[1]);
    assert(Math.min(...xs) === 50 && Math.max(...xs) === 950,
      `轨道 x 范围应为 50..950，实际 ${Math.min(...xs)}..${Math.max(...xs)}`);
    assert(Math.min(...ys) === 71 && Math.max(...ys) === 929,
      `轨道 y 范围应为 71..929，实际 ${Math.min(...ys)}..${Math.max(...ys)}`);
    return '10 × 7 网格 · 宽高比 1.4286 · 格子横向铺满';
  });

  check(results, '同心双环：外环 30 + 城门 2 + 内环 14 = 46 格', () => {
    assert(BOARD_SHAPE.outerCount === 30, `外环应为 30 格，实际 ${BOARD_SHAPE.outerCount}`);
    assert(BOARD_SHAPE.innerCount === 14, `内环应为 14 格，实际 ${BOARD_SHAPE.innerCount}`);
    assert(BOARD_SHAPE.gateCount === 2, `城门应为 2 格，实际 ${BOARD_SHAPE.gateCount}`);
    assert(INNER_INDICES.length === 14, `内环 index 应为 14 个，实际 ${INNER_INDICES.length}`);
    assert(GATE_INDICES.length === 2, `城门 index 应为 2 个，实际 ${GATE_INDICES.length}`);
    // 内环 index 必须连续且在城门 A 之后
    assert(INNER_INDICES[0] === GATE_INDICES[0] + 1,
      `内环首格应在城门 A 之后：${INNER_INDICES[0]} vs ${GATE_INDICES[0] + 1}`);
    assert(INNER_INDICES[INNER_INDICES.length - 1] === GATE_INDICES[1] - 1,
      '内环末格应在城门 B 之前');
    // 城门格必须是赌场
    for (const gi of GATE_INDICES) {
      assert(BOARD_CELLS[gi].special?.id === 'casino', `城门 #${gi} 应为赌场`);
    }
    // 内环前 4 格必须是四大监管
    for (let i = 0; i < 4; i++) {
      assert(BOARD_CELLS[INNER_INDICES[i]].regulator === true,
        `内环 #${INNER_INDICES[i]} 应为监管机构`);
    }
    // 内环其余 10 格必须是 tier 4 的总部级 / 地标级资产
    for (let i = 4; i < 14; i++) {
      const c = BOARD_CELLS[INNER_INDICES[i]];
      assert(c.type === 'institution' && !c.regulator, `内环 #${INNER_INDICES[i]} 应为普通机构`);
      assert(c.tier === 4, `内环 #${INNER_INDICES[i]} 等级应为 4（${c.name} 实为 ${c.tier}）`);
    }
    return '外环 30 · 城门 2 · 内环 14（4 监管 + 10 地标级）';
  });

  check(results, '网格坐标无重复、回路连续（四邻接）', () => {
    assert(TRACK_CELLS.length === BOARD_SIZE, `网格坐标 ${TRACK_CELLS.length} ≠ ${BOARD_SIZE}`);
    // ① 坐标互不重复
    const seen = new Set();
    for (let i = 0; i < BOARD_SIZE; i++) {
      const key = TRACK_CELLS[i].join(',');
      assert(!seen.has(key), `index ${i} 与其他格重叠于 (${key})`);
      seen.add(key);
    }
    // ② 相邻格（含首尾闭合）曼哈顿距离恒为 1 —— 棋子只做平移、绝不瞬移
    for (let i = 0; i < BOARD_SIZE; i++) {
      const a = TRACK_CELLS[i];
      const b = TRACK_CELLS[(i + 1) % BOARD_SIZE];
      const d = Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);
      assert(d === 1, `#${i} (${a}) → #${(i + 1) % BOARD_SIZE} (${b}) 曼哈顿距离 ${d} ≠ 1`);
    }
    // ③ 所有坐标都必须落在 10×7 网格内
    for (let i = 0; i < BOARD_SIZE; i++) {
      const [c, r] = TRACK_CELLS[i];
      assert(c >= 0 && c < 10 && r >= 0 && r < 7, `index ${i} 坐标 (${c},${r}) 越界`);
    }
    return '46 个网格坐标互不重复 · 相邻恒为四邻接 · 首尾闭合';
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
    //    距离按「显示尺度」计算（x 映射 2a×aspect、y 映射 2b），
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

    // ③ 闭合边（45 → 0）也必须满足均匀性
    const closeGap = dists[BOARD_SIZE - 1];
    assert(closeGap <= avg * 1.2, `闭合边间距 ${closeGap.toFixed(4)} 过大，绕圈会跳格`);

    // ④ trackSpacing 与实测一致
    assert(Math.abs(trackSpacing() - avg) < 1e-6, 'trackSpacing 与实测平均间距不符');
  });

  check(results, '中央广场留白可用于金融城广场', () => {
    // 同心双环的内环围出 4 列 × 1 行的中央广场（归一化 x 300..700, y 500±71）。
    // 中心点 (500,500) 到最近轨道点的距离应足够大 —— 说明中心是空的
    let minDist = Infinity;
    for (const p of TRACK_POINTS) {
      const d = Math.hypot(p[0] - 500, p[1] - 500);
      if (d < minDist) minDist = d;
    }
    const avg = trackSpacing();
    // 同心双环的内环只有 1 行高（中央广场是横向长条），
    // 中心到最近轨道点的距离必然接近 1 个格距 —— 用 0.9 倍作为下限。
    assert(minDist > avg * 0.9,
      `中心留白过小：最近轨道点距中心 ${minDist.toFixed(1)}，间距 ${avg.toFixed(4)}`);
    // 护城河区域（外环与内环之间的空白带）必须存在
    const moat = ZONES.find((z) => z.kind === 'moat');
    const plaza = ZONES.find((z) => z.kind === 'plaza');
    assert(moat && moat.w > 0 && moat.h > 0, '缺少护城河区域定义');
    assert(plaza && plaza.w > 0 && plaza.h > 0, '缺少中央广场区域定义');
    return `中央留白半径 ${minDist.toFixed(1)} · 护城河 ${moat.w.toFixed(0)}×${moat.h.toFixed(0)}`;
  });

  check(results, '轨道点严格落在包围盒内', () => {
    for (let i = 0; i < BOARD_SIZE; i++) {
      const [x, y] = TRACK_POINTS[i];
      assert(x >= 0 && x <= 1000, `index ${i} 的 x=${x} 越界`);
      assert(y >= 0 && y <= 1000, `index ${i} 的 y=${y} 越界`);
    }
  });

  check(results, '所有格子严格水平/垂直对齐（文字绝不倾斜）', () => {
    // 同心双环的每一圈都是轴对齐矩形 —— 这一点决定了
    // 地块名称与价格永远是水平文字，不会出现菱形布局的斜字。
    // 外环：col 0 或 col 9（左右竖边） / row 0 或 row 6（上下横边）
    // 内环：col 2 或 col 7 / row 2 或 row 4
    for (let i = 0; i < BOARD_SIZE; i++) {
      const info = cellSideInfo(i);
      const [col, row] = TRACK_CELLS[i];
      const zone = info.zone;
      assert(zone === 'outer' || zone === 'inner' || zone === 'gate',
        `index ${i} 的区域归属异常：${zone}`);
      if (zone === 'gate') {
        // 城门格位于护城河上（第 1 行），不属于任何一圈的边框
        assert(row === 1, `城门 #${i} 应在第 1 行（护城河），实际第 ${row} 行`);
        continue;
      }
      const onH = (zone === 'outer')
        ? (row === 0 || row === 6)
        : (row === 2 || row === 4);
      const onV = (zone === 'outer')
        ? (col === 0 || col === 9)
        : (col === 2 || col === 7);
      assert(onH || onV, `index ${i}（${col},${row}）既不在${zone === 'outer' ? '外' : '内'}环边框上`);
      // 角格判定：横竖边同时成立
      assert(info.corner === (onH && onV),
        `index ${i} 角格标记与几何位置不符`);
    }
    // 环带归属必须与 cellZone 一致
    for (let i = 0; i < BOARD_SIZE; i++) {
      assert(cellZone(i) === cellSideInfo(i).zone, `index ${i} 的区域判定前后不一致`);
    }
    return '外环 / 内环 / 城门 全部轴对齐 · 角格判定正确';
  });

  check(results, '特殊格分布均匀（功能格不相邻，城门与监管连段豁免）', () => {
    // 「功能格」= 特殊格 + 监管机构格。它们必须被普通机构格隔开，
    // 不能连成一片 —— 否则玩家的落点分布会严重偏斜。
    //
    // ⚠ 同心双环的两处**预期**例外：
    //   1. 城门格（赌场）架在护城河上，一侧必然挨着外环末格、
    //      另一侧必然挨着内环首格；
    //   2. 四大监管在内环首尾相连（权力中枢连成一段）。
    const isFunctional = (c) => c.type === 'special' || c.regulator;
    const isGateCell = (c) => c.type === 'special' && c.special?.kind === 'gate';
    const functionalIdx = BOARD_CELLS.map((c, i) => (isFunctional(c) ? i : -1)).filter((i) => i >= 0);
    assert(functionalIdx.length === 11, `功能格应为 11 个（7 特殊 + 4 监管），实际 ${functionalIdx.length}`);

    // 环形相邻（含 45 → 0 的闭合边）不得出现功能格紧邻
    // （城门豁免 + 监管连段豁免）
    for (let i = 0; i < BOARD_CELLS.length; i++) {
      const a = BOARD_CELLS[i];
      const b = BOARD_CELLS[(i + 1) % BOARD_CELLS.length];
      if (isGateCell(a) || isGateCell(b)) continue;
      if (a.regulator && b.regulator) continue;
      assert(!(isFunctional(a) && isFunctional(b)),
        `#${i} ${a.name} 与 #${(i + 1) % BOARD_CELLS.length} ${b.name} 功能格相邻`);
    }

    // 特殊格子集同样必须互不相邻（更严格的读法也成立）
    const specialIdx = BOARD_CELLS.map((c, i) => (c.type === 'special' ? i : -1)).filter((i) => i >= 0);
    assert(specialIdx.length === 7, `特殊格应为 7 个，实际 ${specialIdx.length}`);
    // 特殊格之间应至少隔 1 个普通机构格
    // （城门豁免：城门架在护城河上，与外环末格 / 内环首格贴邻是拓扑决定的）
    for (let i = 0; i < specialIdx.length; i++) {
      const a = specialIdx[i];
      const b = specialIdx[(i + 1) % specialIdx.length];
      if (isGateCell(BOARD_CELLS[a]) || isGateCell(BOARD_CELLS[b])) continue;
      const gap = (b - a + BOARD_SIZE) % BOARD_SIZE;
      assert(gap >= 2, `特殊格 #${a} 与 #${b} 相邻（间隔 ${gap}）`);
    }

    // 起点必须是 index 0，且后一格是普通机构格
    assert(BOARD_CELLS[0].special && BOARD_CELLS[0].special.id === 'start', 'index 0 应为起点');
    assert(!isFunctional(BOARD_CELLS[1]), '起点后一格应为普通机构格');
    // 起点前一格（index 45）是**城门 B（赌场）** —— 闭合边必然挨着城门，
    // 这是同心双环拓扑决定的（城门一侧接外环、一侧接内环）。
    assert(GATE_INDICES.includes(BOARD_SIZE - 1),
      `起点前一格应是城门 B，实际 ${BOARD_CELLS[BOARD_SIZE - 1].name}`);

    // 分布均匀度：相邻功能格的最大间隔不应过大（避免大片连续普通格）
    //
    // ⚠ 同心双环的**内环**是「4 监管 + 10 总部级资产」——
    //   监管连成一段后，后面跟着 10 个连续的高等级资产，
    //   再到城门 B。因此最大间隔天然会比外环大（内环段 = 11）。
    //   这是「城中之城」的设计意图（核心区就是连成一片的优质资产），
    //   故阈值放宽到 12。
    const gaps = functionalIdx.map((v, i) =>
      (functionalIdx[(i + 1) % functionalIdx.length] - v + BOARD_SIZE) % BOARD_SIZE);
    const maxGap = Math.max(...gaps);
    assert(maxGap <= 12, `功能格最大间隔 ${maxGap} 过大，分布不均匀`);

    return `11 个功能格 · 最短间隔 ${Math.min(...gaps)} · 最长间隔 ${maxGap}（内环核心段）`;
  });

  check(results, '四大转盘：候选效果齐备且都能结算', () => {
    assert(WHEELS.length === 4, `转盘应为 4 个，实际 ${WHEELS.length}`);
    const wheelCells = BOARD_CELLS.filter((c) => c.type === 'special' && c.special?.kind === 'wheel');
    assert(wheelCells.length === 4, `转盘格应为 4 个，实际 ${wheelCells.length}`);
    // 每个转盘的候选效果都必须有 SPECIAL 定义（否则结算会落到 default 分支）
    for (const w of WHEELS) {
      assert(w.outcomes.length >= 2, `${w.label} 候选效果不足 2 个`);
      for (const o of w.outcomes) {
        assert(SPECIAL[o.id], `${w.label} 的候选效果 ${o.id} 在 SPECIAL 中没有定义`);
        assert(o.name && o.icon && o.big && o.lbl,
          `${w.label} 的候选效果 ${o.id} 缺少元数据（name/icon/big/lbl）`);
        assert(typeof o.trap === 'boolean' || o.trap === undefined,
          `${w.label} 的候选效果 ${o.id} trap 标记异常`);
      }
    }
    // 13 个原功能特殊格全部被某个转盘收录
    const covered = new Set(WHEELS.flatMap((w) => w.outcomes.map((o) => o.id)));
    for (const id of ['clearing', 'crossborder', 'metro', 'tax', 'audit', 'risk',
      'charity', 'roadshow', 'rating', 'commodity', 'refinance', 'event', 'market']) {
      assert(covered.has(id), `功能效果 ${id} 没有被任何转盘收录`);
    }
    // 棋盘上的转盘格必须与 WHEELS 一一对应
    for (const c of wheelCells) {
      const w = WHEEL_BY_ID[c.special.wheelId];
      assert(w, `转盘格 ${c.name} 的 wheelId 无效`);
      assert(c.special.outcomes.length === w.outcomes.length,
        `${c.name} 的候选数与转盘定义不符`);
      assert(c.special.outcomeData.length === w.outcomes.length,
        `${c.name} 的候选元数据数与转盘定义不符`);
    }
    return '枢纽 3 · 风险 3 · 机会 5 · 命运 2 —— 13 个功能效果全覆盖';
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

  check(results, '陷阱效果存在且带独立卡池', () => {
    // 46 格版把陷阱效果收进了「风险转盘」，棋盘上不再有独立陷阱格，
    // 但 SPECIAL 里的 audit / risk 定义必须保留（转盘内部要用）。
    const traps = Object.values(SPECIAL).filter((sp) => sp.trap);
    assert(traps.length === 2, `陷阱效果应为 2 个（audit / risk），实际 ${traps.length}`);
    assert(TRAP_CARDS.length >= 6, `陷阱卡 ${TRAP_CARDS.length} 张（应 ≥6）`);
    for (const t of traps) {
      assert(!!t.special || !!t.desc, `${t.id} 缺少说明`);
    }
    // 两个陷阱都必须出现在风险转盘的候选里
    const riskWheel = WHEEL_BY_ID.risk;
    const ids = riskWheel.outcomes.map((o) => o.id);
    assert(ids.includes('audit') && ids.includes('risk'),
      `风险转盘应包含 audit 与 risk，实际 ${ids.join('/')}`);
    return `2 个陷阱效果（收进风险转盘） · ${TRAP_CARDS.length} 张监管事件卡`;
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
    // 46 格版：第一个机构格是「中国工商银行」（tier 4），
    // 起步价远超起始现金 —— 必须挑一个买得起的机构格。
    const idx = BOARD_CELLS.findIndex((c) =>
      c.type === 'institution' && !c.regulator
      && purchasePrice(c, c.tier, state.market) <= p.cash);
    assert(idx >= 0, '应存在买得起的机构格');
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
    assert(res.repay === loanRepayAmount(tier.id), '本息合计公式不符');
    assert(res.repay > tier.amount, '应含利息');
    // 利率按本金逐期计息，本金到期才归还
    assert(res.interestPerTurn === Math.round(tier.amount * tier.rate),
      `每回合利息应为 ${Math.round(tier.amount * tier.rate)}，实际 ${res.interestPerTurn}`);
    assert(res.loan.accruedInterest === 0, '新贷款不应带欠息');
    assert(res.loan.interestPaid === 0, '新贷款尚未付息');
    // 期限必须按「自己的回合数」计，与额度匹配
    assert(res.loan.term === tier.term, `期限应为 ${tier.term} 个自己的回合`);
    assert(res.loan.turnsElapsed === 0, '刚借入时不应已经历回合');
    assert(tier.term >= 4, `期限过短：${tier.term} 回合`);

    // 每圈只能一次
    const again = takeCentralLoan(state, p, tier.id);
    assert(!again.ok, '同一圈不应允许二次贷款');

    // 手动偿还：本金 + 欠息（已付利息不退）
    p.cash = 100000;
    const rp = repayLoan(state, p, p.loans[0].id);
    assert(rp.ok, '还款应成功');
    assert(rp.amount === tier.amount, `未付息时应只还本金 ${tier.amount}，实际 ${rp.amount}`);
    assert(p.loans.length === 0, '贷款应被清除');
    return `借款 ￥${tier.amount}，期限 ${tier.term} 回合，每回合付息 ￥${res.interestPerTurn}、到期还本`;
  });

  check(results, '央行贷款按自己的回合逐期付息、到期还本', () => {
    const state = makeTestState();
    const p = state.players[0];
    const tier = CONFIG.loanTiers[0];
    takeCentralLoan(state, p, tier.id);
    const cashAfterLoan = p.cash;
    const loan = p.loans[0];

    // 其他人（非借款人）连续行动 —— 不应计息、也不应催收
    const others = state.players.length - 1;
    for (let i = 0; i < others * 2; i++) {
      state.currentPlayerIndex = 1 + (i % others);
      const cur = currentPlayer(state);
      cur.position = BOARD_SIZE - 1;
      movePlayer(state, cur, 1);
      endTurn(state);
    }
    assert(p.loans.length === 1, '他人回合不应触发还款');
    assert(loan.turnsElapsed === 0, `他人回合不应计入借款人期限，实际 ${loan.turnsElapsed}`);
    assert(loan.interestPaid === 0, '他人回合不应扣借款人的利息');

    // 走完借款人自己的 term 个回合：每回合付息，最后一期还本
    for (let r = 0; r < tier.term; r++) {
      state.currentPlayerIndex = 0;
      const cur = currentPlayer(state);
      cur.position = BOARD_SIZE - 1;
      movePlayer(state, cur, 1);
      endTurn(state);
      if (r < tier.term - 1) {
        assert(p.loans.length === 1, `第 ${r + 1} 个自己的回合后不应到期`);
        assert(loan.interestPaid === loan.interestPerTurn * (r + 1),
          `第 ${r + 1} 期应付息 ${loan.interestPerTurn}，累计 ${loan.interestPaid}`);
        assert(loan.accruedInterest === 0, '现金充足不应产生欠息');
      }
    }
    assert(p.loans.length === 0, '到期后贷款应被清除');
    const total = Math.round(tier.amount * (1 + tier.rate * tier.term));
    assert(cashAfterLoan - p.cash === total,
      `本息合计应为 ￥${total}，实际 ${cashAfterLoan - p.cash}`);
    return `每回合付息 ￥${loan.interestPerTurn} × ${tier.term}，到期还本 ￥${tier.amount}`;
  });

  check(results, '央行贷款现金不足时利息转为欠息', () => {
    const state = makeTestState();
    const p = state.players[0];
    const tier = CONFIG.loanTiers[0];
    takeCentralLoan(state, p, tier.id);
    const loan = p.loans[0];
    // 借入当回合不扣息
    state.currentPlayerIndex = 0;
    endTurn(state);
    assert(loan.interestPaid === 0 && loan.accruedInterest === 0, '借入当回合不应计息');

    p.cash = 0; // 制造现金枯竭
    state.currentPlayerIndex = 0;
    endTurn(state);
    assert(loan.interestPaid === 0, '现金不足时不应扣息');
    assert(loan.accruedInterest === loan.interestPerTurn,
      `欠息应为 ${loan.interestPerTurn}，实际 ${loan.accruedInterest}`);
    assert(p.cash === 0, '现金不足时不应被扣成负数');
    return `现金不足，欠息累计 ￥${loan.accruedInterest}`;
  });

  /* ---------- 特殊格限时状态 ---------- */
  check(results, '特殊格机制差异化：公益捐赠换取限时状态（机会转盘）', () => {
    const state = makeTestState();
    const p = state.players[0];
    // 公益捐赠已被收进「机会转盘」—— 通过转盘格触发
    const idx = BOARD_CELLS.findIndex((c) => c.special?.kind === 'wheel' && c.special.wheelId === 'chance');
    assert(idx >= 0, '应存在机会转盘格');
    // 指定抽中「公益捐赠」
    state.pending = { kind: 'wheel', wheelPick: 'charity', playerId: p.id };
    const before = p.cash;
    settleOnCell(state, p, idx);
    assert(p.cash === before - SPECIAL.charity.amount,
      `应扣捐赠 ${SPECIAL.charity.amount}，实际 ${before - p.cash}`);
    const buff = p.buffs.find((b) => b.id === 'public-good');
    assert(!!buff, '应获得「公益声誉」状态');
    assert(buff.effect.rentMult > 1, '公益声誉应提升管理费');
    return `捐赠 ￥${SPECIAL.charity.amount} → 3 回合管理费 ×${buff.effect.rentMult}`;
  });

  check(results, '特殊格机制差异化：合规成本按机构规模计征（风险转盘）', () => {
    const state = makeTestState();
    const p = state.players[0];
    // 印花税已被收进「风险转盘」
    const idx = BOARD_CELLS.findIndex((c) => c.special?.kind === 'wheel' && c.special.wheelId === 'risk');
    assert(idx >= 0, '应存在风险转盘格');
    state.pending = { kind: 'wheel', wheelPick: 'tax', playerId: p.id };
    // 5 份机构 → 5 × 40 = ￥200
    for (const ci of UPGRADABLE_CELLS.slice(0, 5)) {
      p.institutions.push({ cellIndex: ci, level: 0, mortgaged: false, mortgageAmount: 0 });
    }
    const before = p.cash;
    settleOnCell(state, p, idx);
    assert(before - p.cash === 200, `持有 5 份机构应缴 ￥200，实际 ${before - p.cash}`);
    return `持有 5 份机构 → 缴税 ￥200`;
  });

  check(results, '限时状态按自己的回合递减并到期移除', () => {
    const state = makeTestState();
    const p = state.players[0];
    addBuff(state, p, { id: 'test', name: '测试状态', turns: 2, effect: { rentMult: 1.2 } });
    assert(buffEffectMult(p, 'rentMult') === 1.2, '状态应立即生效');
    // 获得当回合不递减
    state.currentPlayerIndex = 0;
    endTurn(state);
    assert(p.buffs[0].remaining === 2, '获得当回合不应递减');
    state.currentPlayerIndex = 0;
    endTurn(state);
    assert(p.buffs[0].remaining === 1, `应剩 1 回合，实际 ${p.buffs[0].remaining}`);
    state.currentPlayerIndex = 0;
    endTurn(state);
    assert(p.buffs.length === 0, '到期应移除状态');
    assert(buffEffectMult(p, 'rentMult') === 1, '到期后乘数应恢复');
    return '2 个自己的回合后状态到期';
  });

  check(results, '同组限时状态互相覆盖', () => {
    const state = makeTestState();
    const p = state.players[0];
    addBuff(state, p, { id: 'a', group: 'rating', name: '评级上调', turns: 3, effect: { rentMult: 1.15 } });
    addBuff(state, p, { id: 'b', group: 'rating', name: '评级下调', turns: 3, kind: 'bad', effect: { rentMult: 0.9 } });
    const list = p.buffs.filter((x) => x.group === 'rating');
    assert(list.length === 1, `同组状态应只剩 1 条，实际 ${list.length}`);
    assert(buffEffectMult(p, 'rentMult') === 0.9, '应以最新状态为准');
    return '评级上调被下调覆盖';
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
    assert(state.players[1].cash === CONFIG.cashLevels.standard - CONFIG.bondFace, '认购方应扣款');
    assert(state.players[1].subscribedBonds.length === 1, '认购方应记录持有债券');
    return `2 人认购成立，募资 ￥${res.raised}`;
  });

  check(results, '债券按期付息并到期兑付', () => {
    const state = makeTestState();
    const issuer = state.players[0];
    const issueRes = issueBond(state, issuer, [
      { playerId: 1, subscribed: true },
      { playerId: 2, subscribed: true },
    ]);
    assert(issueRes.ok, '发行应成功');
    const buyer1 = state.players[1];
    const buyerCash = buyer1.cash;
    const couponEach = issueRes.bond.couponPer;
    assert(couponEach > 0, '票息必须为正');

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
    return `票息 ${Math.round(issueRes.bond.coupon * 1000) / 10}% · ${CONFIG.bondTerm} 圈到期兑付`;
  });

  check(results, '债券票息与发行人财务状况挂钩', () => {
    const state = makeTestState();
    const healthy = state.players[0];
    const weak = state.players[1];

    const base = bondCouponFor(state, healthy);
    // 制造高负债：多笔贷款 + 现金枯竭
    weak.cash = 100;
    for (let i = 0; i < 6; i++) {
      weak.loans.push({
        id: `L${i}`, name: '过桥资金', amount: 1200, rate: 0.03, term: 6,
        interestPerTurn: 36, accruedInterest: 0, interestPaid: 0, turnsElapsed: 0, takenTurn: 0,
      });
    }
    const highRisk = bondCouponFor(state, weak);
    assert(highRisk > base, `高负债发行人票息应更高：${highRisk} vs ${base}`);
    assert(highRisk <= 0.18, '票息应有上限');
    assert(base >= 0.05, '票息应有下限');

    // 市场化发行：结果由随机认购决定，不依赖发行人自选
    const res = underwriteBond(state, healthy);
    assert(typeof res.ok === 'boolean', '应返回发行结果');
    assert(typeof res.subscribers === 'number', '应返回认购人数');
    assert(res.coupon === bondCouponFor(state, healthy), '票息应与财务状况一致');
    return `健康发行人 ${Math.round(base * 1000) / 10}% · 高负债 ${Math.round(highRisk * 1000) / 10}%`;
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

  check(results, '现金为负触发追缴保证金（自动质押补足）', () => {
    const state = makeTestState();
    const p = state.players[0];
    const idx = firstInstitution(state);
    p.institutions = [{ cellIndex: idx, level: 1, mortgaged: false, mortgageAmount: 0 }];
    const amount = mortgageValue(BOARD_CELLS[idx], 1);
    p.cash = -Math.max(1, Math.floor(amount / 2));
    state.currentPlayerIndex = 0;

    endTurn(state);

    assert(p.institutions[0].mortgaged === true, '应自动质押机构补足缺口');
    assert(p.cash >= 0, `追保后现金应非负，实际 ${p.cash}`);
    assert(!p.bankrupt, '仍有可变现资产不应破产');
    return `质押 ￥${amount}，现金回到 ￥${p.cash}`;
  });

  check(results, '无可质押资产且现金为负则强制平仓', () => {
    const state = makeTestState();
    const p = state.players[0];
    p.institutions = [];
    p.cash = -100;
    state.currentPlayerIndex = 0;

    endTurn(state);

    assert(p.bankrupt === true, '无力补足缺口应被强制平仓');
    assert(p.cash >= 0, '清算后现金不应为负');
    return '缺口无法补足 → 强制平仓';
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
  check(results, '特殊格结算（合规成本 · 风险转盘抽出）', () => {
    const state = makeTestState();
    const p = state.players[0];
    const taxIdx = BOARD_CELLS.findIndex(
      (c) => c.type === 'special' && c.special?.kind === 'wheel' && c.special.wheelId === 'risk');
    assert(taxIdx > 0, '应存在风险转盘格');
    // 指定转盘抽出「印花税」
    state.pending = { kind: 'wheel', wheelPick: 'tax', playerId: p.id };

    // 合规成本按机构持有规模计征：每份 ￥40，最低 ￥120、封顶 ￥360
    const cases = [
      { holdings: 0, expect: 120 },
      { holdings: 3, expect: 120 },
      { holdings: 5, expect: 200 },
      { holdings: 9, expect: 360 },
      { holdings: 20, expect: 360 },
    ];
    for (const c of cases) {
      p.institutions = UPGRADABLE_CELLS.slice(0, c.holdings)
        .map((ci) => ({ cellIndex: ci, level: 0, mortgaged: false, mortgageAmount: 0 }));
      p.cash = 1000;
      state.pending = { kind: 'wheel', wheelPick: 'tax', playerId: p.id };
      const results = settleOnCell(state, p, taxIdx);
      const charged = results.find((r) => r.kind === 'charge');
      assert(!!charged, '合规成本格应产生扣款');
      assert(charged.amount === c.expect,
        `持有 ${c.holdings} 份机构应缴 ￥${c.expect}，实际 ￥${charged.amount}`);
      assert(p.cash === 1000 - c.expect, '合规成本未正确扣除');
    }
    return '按机构规模计征：0~3 份 ￥120 / 5 份 ￥200 / ≥9 份 ￥360';
  });

  check(results, '起点补贴', () => {
    const state = makeTestState();
    const p = state.players[0];
    const before = p.cash;
    settleOnCell(state, p, 0);
    assert(p.cash === before + CONFIG.startBonus, '起点补贴未发放');
    return `+￥${CONFIG.startBonus}`;
  });

  check(results, '清算所跳转与跨境互联（枢纽转盘抽出）', () => {
    const state = makeTestState();
    const p = state.players[0];
    // 清算所 / 跨境互联 都被收进「枢纽转盘」
    const hubIdx = BOARD_CELLS.findIndex(
      (c) => c.type === 'special' && c.special?.kind === 'wheel' && c.special.wheelId === 'hub');
    assert(hubIdx >= 0, '应存在枢纽转盘格');

    state.pending = { kind: 'wheel', wheelPick: 'clearing', playerId: p.id };
    settleOnCell(state, p, hubIdx);
    assert(state.pending && state.pending.kind === 'teleport', '清算所应产生跳转');
    assert(state.pending.target !== hubIdx, '跳转目标不应是自身');

    state.pending = { kind: 'wheel', wheelPick: 'crossborder', playerId: p.id };
    settleOnCell(state, p, hubIdx);
    assert(state.pending && state.pending.kind === 'teleport', '跨境互联应产生跳转');
    return '两类跳转效果均正常';
  });

  check(results, '瞬移步数恒为正（向后跳不会算出负步数）', () => {
    // 清算所 / 跨境互联 的目标可能位于当前位置之前，必须环绕成正向步数
    // （46 格版：棋盘共 46 格，index 0..45）
    const cases = [
      [0, 45], [45, 0], [22, 10], [10, 22], [11, 21], [21, 11], [44, 1], [1, 44],
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
    // （清算所收在枢纽转盘里，传送源就是枢纽转盘格）
    const clearIdx = BOARD_CELLS.findIndex(
      (c) => c.type === 'special' && c.special?.kind === 'wheel' && c.special?.wheelId === 'hub');
    assert(clearIdx >= 0, '应存在枢纽转盘格');
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
    // 46 格版棋盘头几格是总部级 / 地标级资产（起步价高），
    // AI 对它们的决策几乎是确定的 —— 取一个**网点级**格子，
    // 决策空间大，种子差异才体现得出来。
    const probe = makeTestState();
    const idx = BOARD_CELLS.findIndex((c) =>
      c.type === 'institution' && !c.regulator && c.tier === 0);
    assert(idx >= 0, '应存在网点级机构格');
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
    p.loans.push({ id: 'L1', tier: 'micro', name: '支小再贷款', amount: 600, rate: 0.03, term: 4, interestPerTurn: 18, accruedInterest: 72, interestPaid: 0, turnsElapsed: 3, takenTurn: 1 });
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
    // ⚠ 必须挑**非地标**格 —— 地标建筑（buildLandmark）是固定 32×48 的
    //   「权力建筑」，不随等级变化（它本身就代表最高档）。
    const cell = BOARD_CELLS.find((c) => c.group === 'bank' && !c.regulator && !c.landmark);
    assert(cell, '应存在非地标的银行格');
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

  /* ============ 职业棋子形象（矢量立绘） ============ */
  check(results, '7 张职业立绘两两不同（一一对应）', () => {
    const sigs = new Map();
    for (const c of CAREERS) {
      const sig = pieceSignature(c.pieceIndex, 0);
      assert(!sigs.has(sig), `${c.name} 与 ${sigs.get(sig)} 的立绘完全相同`);
      sigs.set(sig, c.name);
    }
    assert(sigs.size === 7, `应有 7 张独立立绘，实际 ${sigs.size}`);
    return `${sigs.size}/7 张职业立绘均不相同`;
  });

  check(results, '职业立绘四方向 × 两帧齐备（矢量尺寸 32×40）', () => {
    for (const c of CAREERS) {
      const set = getCareerPieceSprites(c.pieceIndex, 0);
      for (const dir of ['down', 'up', 'left', 'right']) {
        assert(Array.isArray(set[dir]) && set[dir].length === 2,
          `${c.name} 的 ${dir} 帧数异常`);
        for (const cv of set[dir]) {
          assert(cv.width === 32 && cv.height === 40,
            `${c.name} 的 ${dir} 尺寸 ${cv.width}×${cv.height}（应 32×40）`);
        }
      }
      assert(set.idle, `${c.name} 缺 idle 帧`);
    }
    return '7 职业 × 4 方向 × 2 帧 = 56 张矢量精灵，尺寸统一 32×40';
  });

  check(results, '职业立绘实际有内容（非空白画布）', () => {
    for (const c of CAREERS) {
      const cv = getCareerPieceSprites(c.pieceIndex, 0).idle;
      const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
      let opaque = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i] > 0) opaque++;
      // 立绘至少要有 1/3 的画布被覆盖，否则说明 SVG 没画出来
      assert(opaque > cv.width * cv.height * 0.30,
        `${c.name} 的立绘几乎空白（仅 ${opaque} 个可见像素）`);
    }
    return '7 张立绘均正常绘制（非空白）';
  });

  check(results, '职业立绘四方向互不相同（正面/背面/左右可辨）', () => {
    for (const c of CAREERS) {
      const set = getCareerPieceSprites(c.pieceIndex, 0);
      const sigOf = (canvas) => {
        const d = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
        let key = '';
        for (let k = 0; k < d.length; k += 4) key += `${d[k]},${d[k + 1]},${d[k + 2]},${d[k + 3]};`;
        return key;
      };
      const down = sigOf(set.down[0]);
      const up = sigOf(set.up[0]);
      const left = sigOf(set.left[0]);
      const right = sigOf(set.right[0]);
      assert(down !== up, `${c.name} 的正面与背面相同`);
      assert(left !== right, `${c.name} 的左右朝向相同`);
    }
    return '7 职业的正面≠背面、左侧≠右侧（朝向清晰可辨）';
  });

  check(results, '棋子立绘由职业唯一决定（真人 / AI 皆然）', () => {
    // 「选择棋子形象」功能已删除 —— 传入的 avatar 一律被忽略，
    // 立绘必须严格等于该玩家职业的 pieceIndex。
    const st = createState({
      seed: 'bind-test',
      players: [
        { id: 0, name: '真人', isAI: false, careerId: 'ib', avatar: 2 },
        { id: 1, name: 'AI', isAI: true, careerId: 'risk', avatar: 0 },
      ],
      cash: CONFIG.cashLevels.standard,
    });
    for (const p of st.players) {
      const expected = CAREER_BY_ID[p.careerId].pieceIndex;
      assert(p.avatar === expected,
        `${p.name} 的立绘应为职业立绘 ${expected}，实际 ${p.avatar}`);
    }
    return '真人与 AI 的立绘均严格绑定职业，旧 avatar 字段被忽略';
  });

  check(results, '立绘索引全部落在职业区间（7~13）', () => {
    const st = makeTestState();
    for (const p of st.players) {
      assert(p.avatar >= 7 && p.avatar <= 13,
        `${p.name} 的立绘索引 ${p.avatar} 越界（应 7~13）`);
    }
    return '所有玩家的立绘索引均在 7~13 职业区间内';
  });

  /* ============ 扑克牌渲染 ============ */
  check(results, '扑克牌渲染（正面 / 背面）', () => {
    const deck = [
      { rank: 'A', suit: 'S', id: 'AS', value: 14 },
      { rank: 'K', suit: 'H', id: 'KH', value: 13 },
      { rank: 'T', suit: 'D', id: 'TD', value: 10 },
      { rank: '2', suit: 'C', id: '2C', value: 2 },
    ];
    for (const c of deck) {
      const cv = getCardFace(c);
      assert(cv && cv.width === 22 && cv.height === 30,
        `${c.id} 尺寸 ${cv && cv.width}×${cv && cv.height}（应 22×30）`);
      const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
      let opaque = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i] > 0) opaque++;
      assert(opaque > cv.width * cv.height * 0.5, `${c.id} 绘制过少`);
    }
    const back = getCardBack();
    assert(back && back.width === 22 && back.height === 30, '牌背尺寸异常');
    return '4 种花色点数正面 + 牌背均正确绘制（22×30）';
  });

  /* ============ 职业 & 赌场德州扑克（专项模块） ============ */
  const careerCasino = runCareerCasinoChecks();
  for (const r of careerCasino) {
    results.push(r);
  }

  /* ============ AI 性格系统（专项模块） ============ */
  const personalityChecks = runPersonalityChecks();
  for (const r of personalityChecks) {
    results.push(r);
  }

  return results;
}
