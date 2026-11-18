#!/usr/bin/env python3
"""
四名玩家角色实体对照图 —— 验证配色 / 职业 / AI 徽标可辨识。

用法：
    python tools/shoot_char_roster.py
"""

import http.server
import os
import sys
import threading

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8822
CHROME_CANDIDATES = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
]


def find_chrome():
    for p in CHROME_CANDIDATES:
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


def main():
    chrome = find_chrome()
    if not chrome:
        print("[FAIL] 找不到 Chrome / Edge")
        return 2

    from playwright.sync_api import sync_playwright

    httpd = serve()
    url = f"http://127.0.0.1:{PORT}/index.html"
    shots = os.path.join(ROOT, "tools", "shots")
    os.makedirs(shots, exist_ok=True)

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(
                executable_path=chrome,
                headless=True,
                args=["--disable-gpu", "--no-sandbox"],
            )
            page = browser.new_page(
                viewport={"width": 1600, "height": 1000},
                device_scale_factor=3,
            )
            page.goto(url, wait_until="networkidle")
            page.wait_for_timeout(400)
            page.evaluate(
                """() => {
                    const b = [...document.querySelectorAll('button')]
                        .find(x => x.textContent.trim() === '开局');
                    if (b) b.click();
                }"""
            )
            page.wait_for_timeout(700)
            for _ in range(10):
                acted = page.evaluate(
                    """() => {
                        const vis = b => b && b.offsetParent !== null && !b.disabled;
                        const s = [...document.querySelectorAll('button')]
                            .find(x => vis(x) && x.textContent.trim() === '跳过教学');
                        if (s) { s.click(); return 1; }
                        const n = [...document.querySelectorAll('button')]
                            .find(x => vis(x) && x.textContent.trim() === '下一步');
                        if (n) { n.click(); return 1; }
                        return 0;
                    }"""
                )
                if not acted:
                    break
                page.wait_for_timeout(260)

            # 把 4 名玩家全部挪到同一格 —— 横向对照
            box = page.evaluate(
                """() => {
                    const g = window.__game || window.game;
                    const st = g.state;
                    // 找一个空旷的机构格
                    const target = st.board.findIndex(c => c && c.type === 'institution');
                    st.players.forEach(p => { p.position = target; });
                    // 当前回合设为 1 号（人类），其余为 AI
                    st.currentPlayerIndex = 0;
                    const r = g.renderer;
                    const rect = r.cellRect(target);
                    const cb = r.canvas.getBoundingClientRect();
                    return {
                        target,
                        x: cb.x + rect.x - rect.w * 0.9,
                        y: cb.y + rect.y - rect.h * 0.5,
                        w: rect.w * 2.8,
                        h: rect.h * 1.8,
                        names: st.players.map(p => ({
                            name: p.name, isAI: !!p.isAI,
                            avatar: p.avatar, color: p.colorIndex,
                        })),
                    };
                }"""
            )
            print("玩家:", box["names"])
            page.wait_for_timeout(600)

            p1 = os.path.join(shots, "char3d-roster-flat.png")
            page.screenshot(
                path=p1,
                clip={
                    "x": max(0, box["x"]), "y": max(0, box["y"]),
                    "width": box["w"], "height": box["h"],
                },
            )
            print("截图:", p1)

            # 3D 模式
            page.evaluate(
                """() => {
                    const b = document.getElementById('btn-3d');
                    if (b) b.click();
                }"""
            )
            page.wait_for_timeout(700)
            box3d = page.evaluate(
                """() => {
                    const g = window.__game || window.game;
                    const r = g.renderer;
                    const rect = r.cellRect(g.state.players[0].position);
                    const cb = r.canvas.getBoundingClientRect();
                    return {
                        x: cb.x + rect.x - rect.w * 0.9,
                        y: cb.y + rect.y - rect.h * 0.9,
                        w: rect.w * 2.8,
                        h: rect.h * 2.2,
                    };
                }"""
            )
            p2 = os.path.join(shots, "char3d-roster-3d.png")
            page.screenshot(
                path=p2,
                clip={
                    "x": max(0, box3d["x"]), "y": max(0, box3d["y"]),
                    "width": box3d["w"], "height": box3d["h"],
                },
            )
            print("截图:", p2)

            browser.close()
    finally:
        httpd.shutdown()

    print("完成 ✓")
    return 0


if __name__ == "__main__":
    sys.exit(main())
