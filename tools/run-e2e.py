"""端到端：真实回合踩入赌场 → 完整德州扑克 → 摊牌 → 恢复主游戏。"""
import http.server
import os
import socketserver
import sys
import threading

from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8807
CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def log_message(self, *a):
        pass

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


http.server.ThreadingHTTPServer.allow_reuse_address = True
httpd = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
threading.Thread(target=httpd.serve_forever, daemon=True).start()

failures = []
try:
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path=CHROME, headless=True,
                               args=["--disable-gpu", "--no-sandbox"])
        page = b.new_page(viewport={"width": 1440, "height": 900})
        js_errors = []
        page.on("pageerror", lambda e: js_errors.append(str(e)))
        page.goto(f"http://127.0.0.1:{PORT}/index.html", wait_until="load")
        page.wait_for_timeout(700)

        # 选择「赌王」开局
        page.locator("#career-picker .career-opt").nth(6).click()
        # 关闭教学引导（否则 .tutorial-mask 遮罩会拦截按钮点击）
        page.evaluate("() => { const c = document.getElementById('chk-tutorial'); if (c) c.checked = false; }")
        page.locator("#btn-start").click()
        page.wait_for_timeout(1500)
        # 若教学遮罩仍存在，直接移除
        page.evaluate(
            """() => {
                document.querySelectorAll('.tutorial-mask, .tutorial-box, .tutorial-panel')
                    .forEach(el => el.remove());
            }"""
        )
        page.wait_for_timeout(300)

        # ---- 把真人玩家挪到赌场格，并通过应用层真实结算入口触发 ----
        setup = page.evaluate(
            """async () => {
                const rules = await import('/src/core/rules.js');
                const g = window.__game;
                const st = g.state;
                const board = st.board;
                const casinoIdx = board.findIndex(c => c.type === 'special' && c.special && c.special.id === 'casino');
                const p = st.players[0];
                p.position = casinoIdx;   // 直接站在赌场格
                const res = rules.settleOnCell(st, p, casinoIdx);
                g.handleSettlement(p, res);   // 走应用层真实分发（含 casino-open → openCasino）
                return {
                    casinoIdx,
                    casinoName: board[casinoIdx].name,
                    career: p.careerId,
                    cash: p.cash,
                    institutions: p.institutions.length,
                    results: res.map(r => r.kind),
                };
            }"""
        )
        print("[E1] 赌场格信息：", setup)
        if setup["casinoIdx"] < 0:
            failures.append("棋盘上找不到赌场格")
        if "casino-open" not in setup.get("results", []):
            failures.append(f"结算未返回 casino-open：{setup.get('results')}")

        st1 = page.evaluate(
            """() => {
                const g = window.__game;
                const st = g.state;
                return {
                    phase: st.phase,
                    pendingKind: st.pending ? st.pending.kind : null,
                    pokerActive: !!st.poker,
                    rootHidden: document.getElementById('poker-root').hidden,
                    seats: document.querySelectorAll('.poker-seat').length,
                    playerCash: st.players[0].cash,
                    minCash: Math.min(...st.players.map(x => x.cash)),
                };
            }"""
        )
        print("[E2] 踩入赌场后状态：", st1)
        if not st1["pokerActive"]:
            failures.append("踩入赌场后未开启德州扑克")
        if st1["seats"] != 4:
            failures.append(f"德州扑克座位数应为 4，实际 {st1['seats']}")
        if st1["minCash"] < 0:
            failures.append(f"出现负现金：{st1['minCash']}")

        page.screenshot(path=os.path.join(ROOT, "tools", "shots", "07-casino-enter.png"))

        # ---- 完整打完一手牌：反复点按钮直到摊牌 ----
        rounds = 0
        while rounds < 260:
            rounds += 1
            res = page.evaluate(
                """() => {
                    const st = window.__game.state;
                    if (!st.poker) return { done: true };
                    const over = !!st.poker.over;
                    const btns = [...document.querySelectorAll('.poker-btn')];
                    if (over) return { done: true, over: true };
                    // 排除「退出牌局」按钮，只点真正的操作按钮
                    const actionable = btns.filter(b => !b.disabled && !/退出牌局/.test(b.textContent));
                    if (!actionable.length) return { done: false, waiting: true, n: btns.length };
                    // 优先过牌，其次弃牌，最后任意
                    const pref = actionable.find(b => /过牌/.test(b.textContent))
                              || actionable.find(b => /弃牌/.test(b.textContent))
                              || actionable[0];
                    pref.click();
                    return { done: false, clicked: pref.textContent.trim() };
                }"""
            )
            if res.get("done"):
                break
            page.wait_for_timeout(120)
        print(f"[E3] 德州扑克推进轮次：{rounds}")

        page.wait_for_timeout(800)
        page.screenshot(path=os.path.join(ROOT, "tools", "shots", "08-poker-showdown.png"))

        st2 = page.evaluate(
            """() => {
                const st = window.__game.state;
                const g = window.__game;
                return {
                    pokerActive: !!st.poker,
                    over: st.poker ? st.poker.over : null,
                    resultVisible: !!document.querySelector('.pk-rank, .pk-win'),
                    pot: st.poker ? st.poker.pot : null,
                    playerCash: st.players[0].cash,
                    minCash: Math.min(...st.players.map(x => x.cash)),
                    instTotal: st.players.reduce((a, x) => a + x.institutions.length, 0),
                    deckUsed: st.poker ? st.poker.deckUsed.length : null,
                    burned: st.poker ? st.poker.burned.length : null,
                };
            }"""
        )
        print("[E4] 摊牌后状态：", st2)
        if st2["minCash"] < 0:
            failures.append(f"摊牌后出现负现金：{st2['minCash']}")

        # ---- 关闭结算，回到主游戏 ----
        page.evaluate(
            """() => {
                const btns = [...document.querySelectorAll('#poker-box button')];
                const btn = btns.find(b => /返回主游戏/.test(b.textContent));
                if (btn) btn.click();
            }"""
        )
        page.wait_for_timeout(1200)

        st3 = page.evaluate(
            """() => {
                const g = window.__game;
                const st = g.state;
                return {
                    poker: st.poker,
                    pending: st.pending,
                    phase: st.phase,
                    rootHidden: document.getElementById('poker-root').hidden,
                    gameHidden: document.getElementById('game-screen').hidden,
                    minCash: Math.min(...st.players.map(x => x.cash)),
                    rollDisabled: document.getElementById('btn-roll').disabled,
                };
            }"""
        )
        print("[E5] 关闭后主游戏状态：", st3)
        if st3["poker"] is not None:
            failures.append("关闭后 state.poker 未清空")
        if not st3["rootHidden"]:
            failures.append("关闭后德州扑克面板仍可见")
        if st3["gameHidden"]:
            failures.append("关闭后主游戏界面未恢复")
        if st3["minCash"] < 0:
            failures.append(f"关闭后出现负现金：{st3['minCash']}")

        print("[E6] JS 运行时错误：", js_errors)
        if js_errors:
            failures.append(f"存在 JS 运行时错误：{js_errors[:3]}")

        b.close()
finally:
    httpd.shutdown()

print("=" * 70)
if failures:
    print("端到端测试失败：")
    for f in failures:
        print("  -", f)
    sys.exit(1)
print("端到端测试全部通过 ✓")
