"""
删除 #feed-toggle 后的验收 —— 按钮不存在 / 播报常驻可见 / 掷骰子后新增条目 / 无 JS 错误。

用法：python tools/verify_feed_removed.py
"""
import http.server
import os
import sys
import threading

from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8795

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
            page.on("pageerror", lambda e: js_errors.append("pageerror: " + str(e)))
            page.on(
                "console",
                lambda m: js_errors.append(f"console.error: {m.text}")
                if m.type == "error" and "Failed to load resource" not in m.text
                else None,
            )

            page.goto(f"http://127.0.0.1:{PORT}/index.html", wait_until="load")
            page.wait_for_timeout(400)

            # ---- ① #feed-toggle 必须不存在 ----
            toggle = page.evaluate(
                """() => {
                    const el = document.getElementById('feed-toggle');
                    return {
                        exists: !!el,
                        count: document.querySelectorAll('#feed-toggle, .feed-toggle').length,
                        latestExists: !!document.getElementById('feed-latest'),
                    };
                }"""
            )
            print("[1] #feed-toggle 状态：", toggle)
            if toggle["exists"] or toggle["count"]:
                failures.append("页面仍存在 #feed-toggle 按钮")
            if toggle["latestExists"]:
                failures.append("页面仍存在 #feed-latest 元素")

            # ---- 开局 ----
            page.evaluate("() => document.getElementById('btn-start').click()")
            page.wait_for_timeout(1500)
            # 跳过教学引导 —— 必须**点击**「跳过教学」按钮，
            # 因为只有它会触发 showTutorial 的 onFinish → beginPlayerTurn()，
            # 直接移除 .tutorial-mask 会让玩家的回合永远不开始（骰子按不动）。
            for _ in range(8):
                clicked = page.evaluate(
                    """() => {
                        const b = [...document.querySelectorAll('button')].find(x =>
                            x.offsetParent !== null && /跳过教学|开始游戏|下一步/.test(x.textContent));
                        if (b) { b.click(); return true; }
                        return false;
                    }"""
                )
                page.wait_for_timeout(400)
                if not clicked:
                    break
            page.wait_for_timeout(800)

            # ---- ② 播报列表常驻可见且有内容 ----
            feed = page.evaluate(
                """() => {
                    const panel = document.getElementById('log-panel');
                    const list  = document.getElementById('log-list');
                    const feed  = document.getElementById('hud-feed');
                    if (!panel || !list) return { err: 'missing panel/list' };
                    const pr = panel.getBoundingClientRect();
                    const lr = list.getBoundingClientRect();
                    const cs = getComputedStyle(panel);
                    const items = [...list.querySelectorAll('.log-item')].map(i => ({
                        tag: i.querySelector('.log-tag')?.textContent || '',
                        text: (i.querySelector('.log-item > span:last-child')?.textContent || '').trim(),
                    }));
                    return {
                        panelHidden: panel.hidden,
                        panelDisplay: cs.display,
                        panelVisibility: cs.visibility,
                        panelRect: { w: +pr.width.toFixed(1), h: +pr.height.toFixed(1),
                                    top: +pr.top.toFixed(1), bottom: +pr.bottom.toFixed(1) },
                        listRect: { w: +lr.width.toFixed(1), h: +lr.height.toFixed(1) },
                        listScrollHeight: list.scrollHeight,
                        listClientHeight: list.clientHeight,
                        itemCount: items.length,
                        items: items.slice(0, 8),
                        titleText: panel.querySelector('.panel-title')?.textContent.trim(),
                        feedRect: feed ? feed.getBoundingClientRect().bottom : null,
                        hudLeftPadBottom: getComputedStyle(document.getElementById('hud-left')).paddingBottom,
                    };
                }"""
            )
            print("[2] 播报区状态：", feed)
            if feed.get("err"):
                failures.append("播报面板缺失")
            else:
                if feed["panelHidden"]:
                    failures.append("#log-panel 仍处于 hidden 状态（未常驻显示）")
                if feed["panelDisplay"] == "none":
                    failures.append("#log-panel display:none")
                if feed["panelRect"]["h"] <= 0 or feed["panelRect"]["w"] <= 0:
                    failures.append("#log-panel 尺寸为 0")
                if feed["itemCount"] == 0:
                    failures.append("回合播报列表没有任何条目")
                if feed.get("titleText") != "回合播报":
                    failures.append(f"播报标题异常：{feed.get('titleText')}")

            # ---- ③ 掷骰子后日志新增条目 ----
            before = page.evaluate(
                """() => ({
                    domCount: document.querySelectorAll('#log-list .log-item').length,
                    stateLen: window.__game && window.__game.state ? window.__game.state.log.length : -1,
                    last: window.__game && window.__game.state && window.__game.state.log.length
                        ? window.__game.state.log[window.__game.state.log.length - 1].text : null,
                })"""
            )
            rolled = page.evaluate(
                """async () => {
                    const g = window.__game;
                    const btn = document.getElementById('btn-roll');
                    if (!g || !g.state || !btn) return { ok: false };
                    const before = {
                        phase: g.state.phase,
                        busy: g.busy,
                        disabled: btn.disabled,
                        label: btn.textContent.trim(),
                        logLen: g.state.log.length,
                    };
                    btn.click();
                    // 移动是逐格动画（每格约 110ms），且落地可能弹出
                    // 「股权收购要约」等模态窗 —— 先把模态窗关掉，
                    // 否则回合停在模态窗上，日志不会增长。
                    const deadline = Date.now() + 20000;
                    let declined = 0;
                    while (Date.now() < deadline) {
                        const modal = document.getElementById('modal-root');
                        if (modal && !modal.hidden) {
                            const b = [...modal.querySelectorAll('button')].find(x =>
                                /放弃|取消|关闭|不买|离开/.test(x.textContent));
                            if (b) { b.click(); declined++; }
                            else {
                                const close = document.getElementById('modal-backdrop');
                                if (close) close.click();
                            }
                        }
                        if (g.state.log.length > before.logLen) break;
                        await new Promise(r => setTimeout(r, 200));
                    }
                    return {
                        ok: true,
                        before,
                        declined,
                        afterPhase: g.state.phase,
                        afterBusy: g.busy,
                    };
                }"""
            )
            page.wait_for_timeout(500)
            after = page.evaluate(
                """() => ({
                    domCount: document.querySelectorAll('#log-list .log-item').length,
                    stateLen: window.__game && window.__game.state ? window.__game.state.log.length : -1,
                    last: window.__game && window.__game.state && window.__game.state.log.length
                        ? window.__game.state.log[window.__game.state.log.length - 1].text : null,
                    lastItems: [...document.querySelectorAll('#log-list .log-item')].slice(-5).map(i => ({
                        tag: i.querySelector('.log-tag')?.textContent || '',
                        text: (i.querySelector('.log-item > span:last-child')?.textContent || '').trim(),
                    })),
                })"""
            )
            print(f"[3] 掷骰子 rolled={rolled}")
            print(f"[3] 日志 before={before}")
            print(f"[3] 日志 after={after}")
            if after["stateLen"] <= before["stateLen"]:
                failures.append(f"掷骰子后 state.log 未增长（{before['stateLen']} -> {after['stateLen']}）")
            if after["domCount"] <= before["domCount"]:
                failures.append(f"掷骰子后 #log-list 条目未增长（{before['domCount']} -> {after['domCount']}）")

            # ---- ④ 无 JS 运行时错误 ----
            print("[4] JS 运行时错误：", js_errors)
            if js_errors:
                failures.append(f"存在 JS 运行时错误：{js_errors[:3]}")

            # ---- ⑤ 右栏 / 底部按钮 / 棋盘未被破坏 ----
            others = page.evaluate(
                """() => {
                    const ids = ['hud-right','hud-bottom','btn-roll','btn-assets','btn-endturn',
                                 'board-canvas','board-wrap','hud-tabs','tab-panel-inst'];
                    const out = {};
                    for (const id of ids) {
                        const el = document.getElementById(id);
                        if (!el) { out[id] = null; continue; }
                        const r = el.getBoundingClientRect();
                        out[id] = { w: +r.width.toFixed(1), h: +r.height.toFixed(1) };
                    }
                    return out;
                }"""
            )
            print("[5] 其它区域：", others)
            for k, v in others.items():
                if v is None:
                    failures.append(f"其它区域元素丢失：#{k}")
                elif v["w"] <= 0 or v["h"] <= 0:
                    failures.append(f"其它区域元素尺寸为 0：#{k}")

            browser.close()
    finally:
        httpd.shutdown()

    print("=" * 70)
    if failures:
        print("验收失败：")
        for f in failures:
            print("  -", f)
        return 1
    print("验收全部通过 ✓")
    return 0


if __name__ == "__main__":
    sys.exit(main())
