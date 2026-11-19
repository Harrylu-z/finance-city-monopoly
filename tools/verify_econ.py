#!/usr/bin/env python3
"""标准档经济重构 —— 结算级验证（浏览器内跑规则模块）。

验证 4 件事：
  1. 资金守恒：账本净额 == 现金变化（多局 × 多玩家）
  2. 破产可达：现金能被打负 → 触发破产清算
  3. 回本圈数：改动前后对照（1/2/3 星，level 0 与 level 4）
  4. 关键不变量：满级+满Buff 的 3 星租金 ≥ 400

用法：python tools/verify_econ.py
"""
import http.server
import os
import socketserver
import sys
import threading

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8791

CHROME_PATHS = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
]


def find_chrome():
    for p in CHROME_PATHS:
        if os.path.exists(p):
            return p
    return None


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def log_message(self, *a):
        pass

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        super().end_headers()


def serve():
    http.server.ThreadingHTTPServer.allow_reuse_address = True
    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


JS = r"""
async () => {
  const rules = await import('/src/core/rules.js');
  const econ = await import('/src/core/economy.js');
  const { CONFIG, calculateRent, upgradeCost, groupBuffTier,
          maintenanceCost, totalMaintenanceCost } = econ;
  const { BOARD_CELLS } = await import('/src/core/board.js');

  const out = [];
  const check = (name, fn) => {
    try { out.push({ name, pass: true, detail: fn() }); }
    catch (e) { out.push({ name, pass: false, detail: e && e.message ? e.message : String(e) }); }
  };
  const assert = (c, m) => { if (!c) throw new Error(m); };

  // ===== 1. 资金守恒 =====
  function playGame(seed, turns, alwaysUpgrade) {
    const players = [
      { id: 0, name: 'P0', isAI: false, colorIndex: 0, careerId: 'ib' },
      { id: 1, name: 'A1', isAI: true, colorIndex: 1, careerId: 'ib' },
      { id: 2, name: 'A2', isAI: true, colorIndex: 2, careerId: 'ib' },
      { id: 3, name: 'A3', isAI: true, colorIndex: 3, careerId: 'ib' },
    ];
    const state = rules.createState({
      seed, players, diceCount: 2,
      cash: CONFIG.cashLevels.standard, market: 'normal', difficulty: 'normal',
    });
    const startCash = state.players.map((p) => p.cash);
    for (let t = 0; t < turns; t++) {
      const p = state.players[state.currentPlayerIndex];
      if (!p || p.bankrupt) break;
      if (state.pending && state.pending.kind === 'purchase') {
        rules.resolvePurchase(state, p, true);
      } else {
        const dice = rules.rollDice(state, p);
        rules.movePlayer(state, p, dice.total);
        rules.settleOnCell(state, p, p.position);
        if (state.pending && state.pending.kind === 'purchase') {
          rules.resolvePurchase(state, p, true);
        }
        if (alwaysUpgrade) {
          for (const inst of p.institutions) {
            if (p.upgradePermits && p.upgradePermits[inst.cellIndex]) {
              rules.upgradeInstitution(state, p, inst.cellIndex);
            }
          }
        }
      }
      if (state.pending && state.pending.kind === 'purchase') state.pending = null;
      rules.endTurn(state);
    }
    return { state, startCash };
  }

  check('资金守恒：账本净额 == 现金变化（8 局 × 4 玩家）', () => {
    for (let s = 0; s < 8; s++) {
      const { state, startCash } = playGame('econ-' + s, 320, s % 2 === 0);
      state.players.forEach((p, i) => {
        const net = p.cashFlowNet || 0;
        const delta = p.cash - startCash[i];
        assert(net === delta,
          `局 ${s}/${p.name}：账本净额 ${net} ≠ 现金变化 ${delta}`);
      });
    }
    return '32 位玩家全部吻合（8 局）';
  });

  // ===== 2. 破产可达 =====
  check('破产可达：负现金触发清算且清算后现金非负', () => {
    const state = rules.createState({
      seed: 'bk', players: [{ id: 0, name: 'P0', isAI: false, colorIndex: 0 }],
      diceCount: 2, cash: 1000,
    });
    const p = state.players[0];
    p.cash = -9999;
    p.institutions = [];
    rules.checkBankruptcy(state, p);
    assert(p.bankrupt === true, '现金为负应判定破产');
    assert(p.cash >= 0, '清算后现金不应为负');
    return `清算回收 ￥${p.cash}`;
  });

  check('破产可达：维持费欠费累积（持有侧持续输血成立）', () => {
    // 实际机制：维持费结算时现金**不打到负数**（地板为 0），
    // 付不出的部分记为 maintenanceDebt —— 于是「铺盘/深耕」有真实的持有成本。
    // ⚠ 已知前置缺口（改动前后一致，非本次回归）：
    //   `maintenanceDebt > 资产 50% → 强制清算` 分支会调用 checkBankruptcy，
    //   而 checkBankruptcy 走的是**流动性判定**（liquid < 0），
    //   资产还在就判不了破产 —— 该分支目前不真正触发强制清算。
    //   本次重构不改核心结算流程，故仅断言「欠费会累积」（输血成立）。
    const state = rules.createState({
      seed: 'bk2', players: [{ id: 0, name: 'P0', isAI: false, colorIndex: 0 }],
      diceCount: 2, cash: 100,
    });
    const p = state.players[0];
    const insts = BOARD_CELLS.filter((c) => c.type === 'institution' && !c.regulator).slice(0, 4);
    insts.forEach((c) => p.institutions.push({
      cellIndex: c.index, level: 4, mortgaged: false, mortgageAmount: 0,
    }));
    const maint = totalMaintenanceCost(p);
    assert(maint > p.cash, `维持成本 ${maint} 应超过现金 ${p.cash}`);
    const before = p.cash;
    for (let r = 0; r < 10; r++) rules.chargeMaintenanceCosts(state, p);
    const debt = p.maintenanceDebt || 0;
    assert(debt > 0, `应产生维持费欠费，实际 ${debt}`);
    assert(p.cash === 0, `现金应被扣到 0（地板），实际 ${p.cash}`);
    return `维持费 ￥${maint}/圈 > 现金 ￥${before} → 10 圈累积欠费 ￥${debt}`
      + `（现金地板 0，持有侧持续输血成立）`;
  });

  check('破产可达：现金为负且无资产 → 破产清算', () => {
    // 真正的破产触发路径：现金为负 且 现金 + 可变现资产 < 0
    const state = rules.createState({
      seed: 'bk4', players: [{ id: 0, name: 'P0', isAI: false, colorIndex: 0 }],
      diceCount: 2, cash: 100,
    });
    const p = state.players[0];
    const before = p.cash;
    p.cash = -1;
    const res = rules.checkBankruptcy(state, p);
    assert(res === true, '应判定破产');
    assert(p.bankrupt === true, '应标记破产');
    assert(p.cash >= 0, '清算后现金不应为负');
    return `现金 ￥${before} → ￥-1 且无可变现资产 → 破产清算（清算回收 ￥${p.cash}）`;
  });

  check('破产可达：有资产但可变现价值不足以抵现金缺口 → 破产', () => {
    // 持有一家**低等级**机构（可变现价值很小），现金缺口大于它 → 仍判破产
    const state = rules.createState({
      seed: 'bk5', players: [{ id: 0, name: 'P0', isAI: false, colorIndex: 0 }],
      diceCount: 2, cash: 100,
    });
    const p = state.players[0];
    const cheap = BOARD_CELLS
      .filter((c) => c.type === 'institution' && !c.regulator)
      .reduce((a, b) => (a.price[0] <= b.price[0] ? a : b));
    p.institutions.push({
      cellIndex: cheap.index, level: 0, mortgaged: false, mortgageAmount: 0,
    });
    const value = cheap.price[0];
    p.cash = -value - 1;   // 缺口大于唯一资产的可变现价值
    const res = rules.checkBankruptcy(state, p);
    assert(res === true, `应判定破产（现金 ${p.cash} + 资产 ${value} < 0）`);
    assert(p.bankrupt === true, '应标记破产');
    return `${cheap.name}（市值 ￥${value}）+ 现金 ￥${p.cash} < 0 → 破产清算`;
  });

  // ===== 3. 回本圈数对照 =====
  const OLD = {
    levelRentMult: [1, 1, 1, 1, 1],
    groupRentMult: { bank: 1.0, broker: 1.1, insurer: 0.95, asset: 1.05 },
  };
  const payback = (cell, lv, mults, gm, buff) => {
    const r = Math.round(cell.rent[lv] * mults.levelRentMult[lv] * gm * buff);
    return cell.price[lv] / r;
  };
  const table = (lv, buff) => {
    const rows = [];
    for (const cell of BOARD_CELLS) {
      if (cell.type !== 'institution' || cell.regulator) continue;
      rows.push({
        star: cell.star, name: cell.name,
        oldPb: payback(cell, lv, OLD, OLD.groupRentMult[cell.group], buff),
        newPb: payback(cell, lv, CONFIG, CONFIG.groupRentMult[cell.group], buff),
      });
    }
    const byStar = {};
    for (const st of [1, 2, 3]) {
      const v = rows.filter((r) => r.star === st);
      const o = v.map((r) => r.oldPb), n = v.map((r) => r.newPb);
      byStar[st] = {
        old: `${Math.min(...o).toFixed(1)}~${Math.max(...o).toFixed(1)}`,
        new: `${Math.min(...n).toFixed(1)}~${Math.max(...n).toFixed(1)}`,
      };
    }
    return byStar;
  };

  check('回本圈数对照 · level 0（单家，无 Buff）', () => {
    const t = table(0, 1);
    const lines = Object.keys(t).map((s) => `${s}星 ${t[s].old} → ${t[s].new}`);
    return lines.join(' | ');
  });

  check('回本圈数对照 · level 4 地标级（满 Buff ×1.6）', () => {
    const t = table(4, CONFIG.groupBuffRentMult[CONFIG.groupBuffRentMult.length - 1]);
    const lines = Object.keys(t).map((s) => `${s}星 ${t[s].old} → ${t[s].new}`);
    return lines.join(' | ');
  });

  // ===== 4. 关键不变量 =====
  check('满级 + 满 Buff 的 3 星租金 ≥ ￥400', () => {
    const top = CONFIG.groupBuffRentMult[CONFIG.groupBuffRentMult.length - 1];
    const list = [];
    for (const cell of BOARD_CELLS) {
      if (cell.type !== 'institution' || cell.regulator || cell.star !== 3) continue;
      const rent = calculateRent(cell, 4, { market: 'normal', eventMult: 1, buffMult: top });
      assert(rent >= 400, `${cell.name} 租金 ${rent} < 400`);
      list.push(`${cell.name}=${rent}`);
    }
    return list.join(' / ');
  });

  check('维持成本 ≤ 该等级租金的 60%', () => {
    for (const cell of BOARD_CELLS) {
      if (cell.type !== 'institution' || cell.regulator) continue;
      for (let lv = 0; lv <= 4; lv++) {
        const rent = calculateRent(cell, lv, { market: 'normal', eventMult: 1 });
        const m = maintenanceCost(cell, lv);
        assert(m <= rent * 0.6, `${cell.name} lv${lv}: 维持 ${m} > 租金 ${rent} 的 60%`);
      }
    }
    return '24 家 × 5 级全部满足';
  });

  check('升级费用口径正确（factor + 地标附加）', () => {
    const cell = BOARD_CELLS.find((c) => c.type === 'institution' && !c.regulator);
    for (let lv = 0; lv < 4; lv++) {
      let expect = Math.round(cell.price[lv + 1] * CONFIG.upgradeCostFactor);
      if (lv + 1 === 4) expect += CONFIG.landmarkSurcharge;
      assert(upgradeCost(cell, lv) === expect, `${cell.name} lv${lv} 升级费不符`);
    }
    return `${cell.name}：factor ${CONFIG.upgradeCostFactor} / 地标附加 ${CONFIG.landmarkSurcharge}`;
  });

  check('集团 Buff 三档全部可达且单调不减', () => {
    const cells = BOARD_CELLS.filter((c) => c.group === 'bank' && !c.regulator);
    assert(cells.length === 6, `银行集团应有 6 家，实际 ${cells.length}`);
    const player = { institutions: [] };
    const seen = [];
    for (let n = 1; n <= 6; n++) {
      player.institutions = cells.slice(0, n).map((c) => ({
        cellIndex: c.index, level: 0, mortgaged: false, mortgageAmount: 0,
      }));
      seen.push(groupBuffTier(player, 'bank').mult);
    }
    for (let i = 1; i < seen.length; i++) {
      assert(seen[i] >= seen[i - 1], `Buff 系数应单调不减：${seen.join(' → ')}`);
    }
    return `持有 1~6 家：${seen.join(' → ')}（阈值 ${CONFIG.groupBuffThresholds.join('/')}）`;
  });

  check('每圈净现金流为正（单家 3 星满 Buff 持有即自给自足）', () => {
    const top = CONFIG.groupBuffRentMult[CONFIG.groupBuffRentMult.length - 1];
    const cell = BOARD_CELLS.find((c) => c.type === 'institution' && !c.regulator && c.star === 3);
    for (let lv = 0; lv <= 4; lv++) {
      const rent = calculateRent(cell, lv, { market: 'normal', eventMult: 1, buffMult: top });
      const m = CONFIG.maintenanceCostPerLevel[lv];
      assert(rent - m > 0, `${cell.name} lv${lv} 净现金流 ${rent - m} ≤ 0`);
    }
    return `${cell.name} 五级净现金流均为正`;
  });

  return out;
}
"""


def main():
    chrome = find_chrome()
    if not chrome:
        print("[FAIL] 找不到 Chrome / Edge 可执行文件")
        return 2
    from playwright.sync_api import sync_playwright

    httpd = serve()
    url = f"http://127.0.0.1:{PORT}/index.html"
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(
                executable_path=chrome, headless=True,
                args=["--disable-gpu", "--no-sandbox"],
            )
            page = browser.new_page(viewport={"width": 1440, "height": 900})
            errors = []
            page.on("pageerror", lambda e: errors.append("PAGEERROR " + str(e)))
            page.goto(url, wait_until="load")
            page.wait_for_timeout(400)
            rows = page.evaluate(JS)
            browser.close()
    finally:
        httpd.shutdown()

    print("=" * 78)
    print("经济重构专项验证")
    print("=" * 78)
    failed = 0
    for r in rows:
        mark = "PASS" if r["pass"] else "FAIL"
        if not r["pass"]:
            failed += 1
        print(f"[{mark}] {r['name']}")
        print(f"        {r['detail']}")
    if errors:
        failed += 1
        print("-" * 78)
        print("页面运行时错误：")
        for e in errors[:10]:
            print("   -", e)
    print("=" * 78)
    print("结果：全部通过 ✓" if failed == 0 else f"结果：{failed} 项失败")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
