/**
 * Node 直跑自检 —— 无 DOM 依赖的纯逻辑专项模块。
 *
 * 用法：node tools/node-selftest.mjs [career|personality|cashflow|all]
 *
 * 说明：selftest.js 顶层的棋盘/卡牌/建筑自检包含**像素级断言**
 * （读取 canvas 像素），必须在真实浏览器里跑（tools/run-selftest.py）。
 * 这里只覆盖与规则引擎相关的纯逻辑模块，便于无浏览器环境下快速回归。
 */
import { runAll as runCareerCasino } from '../src/core/selftest-career-casino.js';
import { runAll as runPersonality } from '../src/core/selftest-personality.js';
import { runAll as runCashflow } from '../src/core/selftest-cashflow.js';

const which = (process.argv[2] || 'all').toLowerCase();

const suites = {
  career: ['职业 & 赌场德州扑克', runCareerCasino],
  personality: ['AI 性格系统', runPersonality],
  cashflow: ['资金流水账本', runCashflow],
};

const pick = which === 'all' ? Object.entries(suites) : [[which, suites[which]]];
if (!pick.every(([k]) => suites[k])) {
  console.error(`未知模块：${which}（可选 career / personality / cashflow / all）`);
  process.exit(2);
}

let pass = 0;
let fail = 0;
for (const [key, [name, run]] of pick) {
  console.log(`\n===== ${name} =====`);
  const results = run();
  for (const r of results) {
    const mark = r.pass ? 'PASS' : 'FAIL';
    console.log(`  [${mark}] ${r.name} — ${r.detail}`);
    if (r.pass) pass++; else fail++;
  }
}

console.log(`\n总计：${pass} 通过 / ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
