#!/usr/bin/env python3
"""
无头浏览器回归测试 —— 用系统 Chrome 加载 index.html，
跑 src/core/selftest.js 的全部规则自检，并输出逐项结果。

用法：
    python tools/run-selftest.py            # 跑自检
    python tools/run-selftest.py --extra    # 额外跑一次随机对局冒烟测试

依赖：playwright（已安装）+ 系统 Chrome。
"""
import argparse
import http.server
import os
import socketserver
import sys
import threading
import time
import webbrowser

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8777

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
    t = threading.Thread(target=httpd.serve_forever, daemon=True)
    t.start()
    return httpd


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--extra", action="store_true", help="额外跑随机对局冒烟测试")
    ap.add_argument("--keep", action="store_true", help="保留浏览器窗口（调试用）")
    args = ap.parse_args()

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
                executable_path=chrome,
                headless=not args.keep,
                args=["--disable-gpu", "--no-sandbox", "--allow-file-access-from-files"],
            )
            page = browser.new_page(viewport={"width": 1440, "height": 900})
            errors = []
            page.on("pageerror", lambda e: errors.append("PAGEERROR " + str(e)))
            page.on(
                "console",
                lambda m: errors.append(f"[console.{m.type}] {m.text}")
                if m.type == "error" and "Failed to load resource" not in m.text
                else None,
            )

            page.goto(url, wait_until="load")
            page.wait_for_timeout(400)

            # ---- 跑规则自检 ----
            result = page.evaluate(
                """async () => {
                    const m = await import('/src/core/selftest.js');
                    const res = m.runAll();
                    return {
                        total: res.length,
                        pass: res.filter(r => r.pass).length,
                        rows: res.map(r => ({ name: r.name, pass: r.pass, detail: r.detail })),
                    };
                }"""
            )

            total = result["total"]
            passed = result["pass"]
            print("=" * 78)
            print(f"规则引擎自检：{passed}/{total} 通过")
            print("=" * 78)
            for r in result["rows"]:
                mark = "PASS" if r["pass"] else "FAIL"
                line = f"[{mark}] {r['name']}"
                if not r["pass"]:
                    line += f"\n        -> {r['detail']}"
                else:
                    line += f"\n        {r['detail']}"
                print(line)

            failed = [r for r in result["rows"] if not r["pass"]]

            # ---- 随机对局冒烟测试 ----
            smoke = None
            if args.extra:
                print("-" * 78)
                print("随机对局冒烟测试（20 局 × 120 回合）...")
                smoke = page.evaluate(
                    """async () => {
                        const rules = await import('/src/core/rules.js');
                        const ai = await import('/src/core/ai.js');
                        const econ = await import('/src/core/economy.js');
                        const rngm = await import('/src/core/rng.js');
                        const errors = [];
                        let turns = 0;
                        for (let i = 0; i < 20; i++) {
                            const rng = rngm.makeRng('smoke-' + i);
                            const personalities = ai.assignPersonalities(rng, 3);
                            const players = [
                                { id: 0, name: 'P0', isAI: false, colorIndex: 0 },
                                { id: 1, name: 'A1', isAI: true, colorIndex: 1, personality: personalities[0] },
                                { id: 2, name: 'A2', isAI: true, colorIndex: 2, personality: personalities[1] },
                                { id: 3, name: 'A3', isAI: true, colorIndex: 3, personality: personalities[2] },
                            ];
                            const state = rules.createState({
                                seed: 'smoke-' + i, players,
                                diceCount: 2, cash: econ.CONFIG.cashLevels.standard,
                                market: 'normal', difficulty: 'normal',
                            });
                            state.maxTurns = 120;
                            let guard = 0;
                            try {
                                while (state.phase !== 'gameover' && guard < 200) {
                                    guard++;
                                    const p = state.players[state.currentPlayerIndex];
                                    if (!p.bankrupt) {
                                        const { dice } = rules.rollDice(state, p);
                                        const total = dice.reduce((a, b) => a + b, 0);
                                        rules.movePlayer(state, p, total);
                                        const res = rules.settleOnCell(state, p, p.position);
                                        for (const r of res) {
                                            if (r.kind === 'purchase-offer') {
                                                const d = ai.decide(state, p, 'purchase', { cellIndex: r.cellIndex });
                                                state.pending = { kind: 'purchase', cellIndex: r.cellIndex, price: r.price, level: r.level, playerId: p.id };
                                                rules.resolvePurchase(state, p, d.action === 'buy');
                                            } else if (r.kind === 'teleport') {
                                                state.pending = null;
                                                rules.movePlayer(state, p, (r.target - p.position + 63) % 63);
                                                rules.settleOnCell(state, p, p.position);
                                            } else if (r.kind === 'metro-choice') {
                                                state.pending = null;
                                                rules.movePlayer(state, p, 2);
                                                rules.settleOnCell(state, p, p.position);
                                            }
                                        }
                                        if (state.pending && state.pending.kind === 'purchase') state.pending = null;
                                        rules.checkBankruptcy(state, p);
                                    }
                                    rules.endTurn(state);
                                    turns++;
                                }
                            } catch (e) {
                                errors.push('局 ' + i + ': ' + (e && e.message));
                            }
                            // 现金不得为负（除非已破产）
                            for (const p of state.players) {
                                if (!p.bankrupt && p.cash < 0) {
                                    errors.push('局 ' + i + ' 玩家 ' + p.name + ' 现金为负 ' + p.cash);
                                }
                            }
                        }
                        return { errors, turns };
                    }"""
                )
                if smoke["errors"]:
                    print("冒烟测试失败：")
                    for e in smoke["errors"][:20]:
                        print("   -", e)
                else:
                    print(f"冒烟测试通过：{smoke['turns']} 回合，无异常，现金无负值")

            if errors:
                print("-" * 78)
                print("页面运行时错误：")
                for e in errors[:20]:
                    print("   -", e)

            browser.close()
    finally:
        httpd.shutdown()

    bad = bool(failed) or bool(errors)
    if smoke is not None and smoke["errors"]:
        bad = True
    print("=" * 78)
    if bad:
        print("结果：存在失败项")
        return 1
    print("结果：全部通过 ✓")
    return 0


if __name__ == "__main__":
    sys.exit(main())
