"""资产下注安全性压力测试 —— 极端输入下不得出现负数或主游戏状态损坏。

覆盖：
   1. 资产额度全下 —— 现金 / 资产估值非负，机构所有权不变；
   2. 非法下注金额（负数 / NaN / Infinity / 超额 / 未知动作）—— 一律拒绝，不抛异常；
   3. 连续 30 局赌场结算 —— 累计现金与资产估值均非负，状态自洽；
   4. 中途退出 —— 正常结算并安全恢复主游戏；
   5. 牌库完整性 —— 始终严格 52 张且无重复。

用法：python tools/run-asset-safety.py
"""
import http.server
import os
import socketserver
import sys
import threading

from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8821

CHROME_PATHS = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
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
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


def main():
    chrome = find_chrome()
    if not chrome:
        print("[FAIL] 找不到 Chrome")
        return 2

    http.server.ThreadingHTTPServer.allow_reuse_address = True
    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()

    failures = []
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(
                executable_path=chrome, headless=True,
                args=["--disable-gpu", "--no-sandbox"],
            )
            page = browser.new_page()
            js_errors = []
            page.on("pageerror", lambda e: js_errors.append(str(e)))

            page.goto(f"http://127.0.0.1:{PORT}/index.html", wait_until="load")
            page.wait_for_timeout(700)
            page.evaluate("() => { const c = document.getElementById('chk-tutorial'); if (c) c.checked = false; }")
            page.locator("#btn-start").click()
            page.wait_for_timeout(1200)

            out = page.evaluate(
                """async () => {
                    const rules = await import('/src/core/rules.js');
                    const poker = await import('/src/core/poker.js');
                    const economy = await import('/src/core/economy.js');
                    const g = window.__game;
                    const st = g.state;
                    const report = { cases: [] };
                    const clone = () => JSON.parse(JSON.stringify(st));

                    // 1) 资产额度全下
                    {
                        const s = clone();
                        s.players[0].cash = 100;
                        s.players[0].institutions = [{ cellIndex: 10, level: 2, mortgaged: false, mortgageAmount: 0 }];
                        const before = economy.totalAssets(s.players[0], s);
                        const game = rules.startCasinoGame(s);
                        game.seats[0].cashStack = 0;
                        game.seats[0].assetStack = 5000;
                        game.currentSeat = 0;
                        const r = poker.applyAction(game, 0, { type: 'allin' });
                        report.cases.push({
                            name: '资产全下', ok: r.ok,
                            cash: s.players[0].cash,
                            assetLock: s.players[0].pokerAssetLock ?? 0,
                            assets: economy.totalAssets(s.players[0], s),
                            before, instCount: s.players[0].institutions.length,
                        });
                    }

                    // 2) 非法下注金额
                    {
                        const s = clone();
                        const game = rules.startCasinoGame(s);
                        const bad = [
                            { type: 'raise', amount: -99999 },
                            { type: 'raise', amount: NaN },
                            { type: 'raise', amount: Infinity },
                            { type: 'raise', amount: 1e12 },
                            { type: 'raise', amount: 0 },
                            { type: 'allin', amount: -1 },
                            { type: 'allin', amount: NaN },
                            { type: 'unknown-action' },
                        ];
                        const results = [];
                        for (const a of bad) {
                            game.currentSeat = 0;
                            game.seats.forEach(s2 => { s2.folded = false; s2.allIn = false; });
                            let r;
                            try { r = poker.applyAction(game, 0, a); }
                            catch (e) { r = { ok: false, reason: 'THROW ' + String(e) }; }
                            results.push({ act: `${a.type}:${a.amount}`, ok: r.ok, reason: r.reason ?? null });
                        }
                        report.cases.push({
                            name: '非法下注', results,
                            minCash: Math.min(...s.players.map(x => x.cash)),
                            instCount: s.players[0].institutions.length,
                        });
                    }

                    // 3) 连续 30 局结算
                    {
                        const s = clone();
                        let minCash = Infinity, minAssets = Infinity;
                        for (let i = 0; i < 30; i++) {
                            const game = rules.startCasinoGame(s);
                            if (!game) break;
                            let guard = 0;
                            while (!game.over && guard++ < 200) {
                                const idx = poker.currentActor(game);
                                if (idx < 0) break;
                                const acts = poker.legalActions(game);
                                if (!acts.length) break;
                                const r = poker.applyAction(game, idx, acts[(i + guard) % acts.length]);
                                if (!r.ok) poker.applyAction(game, idx, { type: 'fold' });
                            }
                            rules.finishCasinoGame(s, game);
                            minCash = Math.min(minCash, ...s.players.map(x => x.cash));
                            minAssets = Math.min(minAssets, ...s.players.map(x => economy.totalAssets(x, s)));
                        }
                        report.cases.push({
                            name: '连续 30 局结算', minCash, minAssets,
                            poker: s.poker, pending: s.pending,
                        });
                    }

                    // 4) 中途退出
                    {
                        const s = clone();
                        s.players[0].cash = 50;
                        s.players[0].institutions = [{ cellIndex: 10, level: 1, mortgaged: false, mortgageAmount: 0 }];
                        const game = rules.startCasinoGame(s);
                        game.currentSeat = 0;
                        poker.applyAction(game, 0, { type: 'allin' });
                        const beforeInst = JSON.stringify(s.players[0].institutions);
                        poker.abortPokerGame(game);
                        const res = rules.finishCasinoGame(s, game);
                        report.cases.push({
                            name: '中途退出', deltas: res.deltas.length,
                            cash: s.players[0].cash,
                            instSame: JSON.stringify(s.players[0].institutions) === beforeInst,
                            poker: s.poker, pending: s.pending,
                        });
                    }

                    // 5) 牌库完整性
                    {
                        let maxTotal = 0, dupFound = false, maxDeck = 0;
                        for (let i = 0; i < 20; i++) {
                            const s = clone();
                            const game = rules.startCasinoGame(s);
                            let guard = 0;
                            while (!game.over && guard++ < 200) {
                                const idx = poker.currentActor(game);
                                if (idx < 0) break;
                                const acts = poker.legalActions(game);
                                if (!acts.length) break;
                                const r = poker.applyAction(game, idx, acts[(i + guard) % acts.length]);
                                if (!r.ok) poker.applyAction(game, idx, { type: 'fold' });
                                const ids = [...game.deckUsed, ...game.burned].map(c => c.id);
                                if (new Set(ids).size !== ids.length) dupFound = true;
                                maxTotal = Math.max(maxTotal, ids.length);
                            }
                            maxDeck = Math.max(maxDeck, game.deck.length + game.deckUsed.length + game.burned.length);
                        }
                        report.cases.push({ name: '牌库完整性', maxTotal, dupFound, maxDeck });
                    }

                    return report;
                }"""
            )

            for c in out.get("cases", []):
                print("[S]", c.get("name"), "=", {k: v for k, v in c.items() if k != "name"})

            for c in out.get("cases", []):
                n = c.get("name")
                if n == "资产全下":
                    if c.get("cash", 0) < 0:
                        failures.append(f"资产全下后现金为负：{c}")
                    if c.get("assets", 0) < 0:
                        failures.append(f"资产全下后资产估值为负：{c}")
                    if c.get("instCount", 0) < 1:
                        failures.append(f"资产全下后机构丢失：{c}")
                elif n == "非法下注":
                    if c.get("minCash", 0) < 0:
                        failures.append(f"非法下注导致负现金：{c}")
                    for r in c.get("results", []):
                        if "THROW" in str(r.get("reason")):
                            failures.append(f"非法下注抛异常：{r}")
                        if r.get("ok"):
                            failures.append(f"非法金额被接受：{r}")
                elif n == "连续 30 局结算":
                    if c.get("minCash", 0) < 0:
                        failures.append(f"连续结算出现负现金：{c}")
                    if c.get("minAssets", 0) < 0:
                        failures.append(f"连续结算出现负资产：{c}")
                    if c.get("poker") is not None or c.get("pending") is not None:
                        failures.append(f"连续结算后状态未清空：{c}")
                elif n == "中途退出":
                    if c.get("cash", 0) < 0:
                        failures.append(f"中途退出后现金为负：{c}")
                    if not c.get("instSame"):
                        failures.append(f"中途退出后机构被改变：{c}")
                    if c.get("poker") is not None or c.get("pending") is not None:
                        failures.append(f"中途退出后状态未清空：{c}")
                elif n == "牌库完整性":
                    if c.get("maxTotal", 99) > 52:
                        failures.append(f"牌库用量超过 52：{c}")
                    if c.get("dupFound"):
                        failures.append(f"牌库出现重复牌：{c}")
                    if c.get("maxDeck", 99) != 52:
                        failures.append(f"牌库总牌数不是 52：{c}")

            print("[S] JS 运行时错误：", js_errors)
            if js_errors:
                failures.append(f"存在 JS 运行时错误：{js_errors[:3]}")

            browser.close()
    finally:
        httpd.shutdown()

    print("=" * 70)
    if failures:
        print("资产安全测试失败：")
        for f in failures:
            print("  -", f)
        return 1
    print("资产安全测试全部通过 ✓")
    return 0


if __name__ == "__main__":
    sys.exit(main())
