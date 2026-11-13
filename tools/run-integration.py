"""浏览器端集成测试 —— 验证开局界面职业选择器、赌场 UI、完整对局流程。

用法：python tools/run-integration.py
"""
import http.server
import os
import socketserver
import sys
import threading

from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8791

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
            page = browser.new_page(viewport={"width": 1440, "height": 900})
            js_errors = []
            page.on("pageerror", lambda e: js_errors.append(str(e)))

            page.goto(f"http://127.0.0.1:{PORT}/index.html", wait_until="load")
            page.wait_for_timeout(500)

            # ---- 1) 开局界面职业选择器 ----
            career_count = page.locator("#career-picker .career-opt").count()
            print(f"[1] 职业选择器选项数：{career_count}")
            if career_count != 7:
                failures.append(f"职业选择器应有 7 项，实际 {career_count}")

            canvas_count = page.locator("#career-picker .career-opt canvas").count()
            print(f"[2] 职业棋子画布数：{canvas_count}")
            if canvas_count != 7:
                failures.append(f"职业棋子画布应有 7 个，实际 {canvas_count}")

            page.locator("#career-picker .career-opt").nth(2).click()
            page.wait_for_timeout(150)
            sel = page.locator("#career-picker .career-opt.is-sel").count()
            sel_id = page.evaluate(
                "() => { const b = document.querySelector('#career-picker .career-opt.is-sel'); return b ? b.dataset.career : null; }"
            )
            print(f"[3] 选中职业：{sel_id}（高亮 {sel} 项）")
            if sel != 1 or sel_id != "actuary":
                failures.append(f"职业选中状态异常：{sel_id} / {sel}")

            # ---- 2) 开局 ----
            page.locator("#btn-start").click()
            page.wait_for_timeout(1200)
            game_hidden = page.evaluate(
                "() => document.getElementById('game-screen').hidden"
            )
            print(f"[4] 主游戏界面已显示：{not game_hidden}")
            if game_hidden:
                failures.append("开局后游戏界面未显示")

            player_career = page.evaluate(
                """() => {
                    const g = window.__game;
                    if (!g || !g.state) return null;
                    return g.state.players[0].careerId;
                }"""
            )
            print(f"[5] 玩家职业（运行时状态）：{player_career}")
            if player_career and player_career != "actuary":
                failures.append(f"玩家职业应为 actuary，实际 {player_career}")

            # ---- 3) 赌场 UI 渲染 ----
            poker_ok = page.evaluate(
                """async () => {
                    const rules = await import('/src/core/rules.js');
                    const ui = await import('/src/app/poker-ui.js');
                    const g = window.__game;
                    if (!g || !g.state) return { err: 'no game state' };
                    const game = rules.startCasinoGame(g.state);
                    if (!game) return { err: 'no poker game' };
                    game.seatAvatarIndex = new Map(g.state.players.map(p => [p.id, p.avatar ?? 0]));
                    game.seatColorIndex = new Map(g.state.players.map(p => [p.id, p.colorIndex ?? 0]));
                    ui.showPokerTable({
                        game, viewerId: 0,
                        onFinish: () => {},
                        onExit: () => {},
                    });
                    await new Promise(r => setTimeout(r, 300));
                    const root = document.getElementById('poker-root');
                    const seats = document.querySelectorAll('.poker-seat').length;
                    const cards = document.querySelectorAll('.poker-card').length;
                    const pot = document.getElementById('pk-pot');
                    return {
                        visible: !root.hidden,
                        seats, cards,
                        pot: pot ? pot.textContent : null,
                        board: document.querySelectorAll('.poker-card-board').length,
                    };
                }"""
            )
            print(f"[6] 德州扑克桌面：{poker_ok}")
            if poker_ok.get("err"):
                failures.append(f"德州扑克 UI 失败：{poker_ok['err']}")
            else:
                if not poker_ok.get("visible"):
                    failures.append("德州扑克面板未显示")
                if poker_ok.get("seats") != 4:
                    failures.append(f"座位数应为 4，实际 {poker_ok.get('seats')}")
                if poker_ok.get("board") != 5:
                    failures.append(f"公共牌位应为 5，实际 {poker_ok.get('board')}")
                if poker_ok.get("cards", 0) < 9:
                    failures.append(f"牌面数量偏少：{poker_ok.get('cards')}")

            page.wait_for_timeout(1200)
            btn_texts = page.evaluate(
                "() => [...document.querySelectorAll('.poker-btn')].map(b => b.textContent)"
            )
            print(f"[7] 操作按钮：{btn_texts}")

            # ---- 4) 退出后主游戏恢复 ----
            restore = page.evaluate(
                """async () => {
                    const rules = await import('/src/core/rules.js');
                    const ui = await import('/src/app/poker-ui.js');
                    const poker = await import('/src/core/poker.js');
                    const g = window.__game;
                    const game = g.state.poker || rules.startCasinoGame(g.state);
                    poker.abortPokerGame(game);
                    rules.finishCasinoGame(g.state, game);
                    ui.closePokerTable();
                    return {
                        poker: g.state.poker,
                        pending: g.state.pending,
                        phase: g.state.phase,
                        minCash: Math.min(...g.state.players.map(p => p.cash)),
                    };
                }"""
            )
            print(f"[8] 退出后主游戏状态：{restore}")
            if restore.get("poker") is not None:
                failures.append("退出后 state.poker 未清空")
            if restore.get("minCash", 0) < 0:
                failures.append(f"退出后现金为负：{restore.get('minCash')}")

            print(f"[9] JS 运行时错误：{js_errors}")
            if js_errors:
                failures.append(f"存在 JS 运行时错误：{js_errors[:3]}")

            browser.close()
    finally:
        httpd.shutdown()

    print("=" * 70)
    if failures:
        print("集成测试失败：")
        for f in failures:
            print("  -", f)
        return 1
    print("集成测试全部通过 ✓")
    return 0


if __name__ == "__main__":
    sys.exit(main())
