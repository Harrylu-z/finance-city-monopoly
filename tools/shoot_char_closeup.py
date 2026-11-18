#!/usr/bin/env python3
"""
角色实体特写截图 —— 放大观察 2.5D 棋子的体积感。

用途：验证「角色不是只有水波纹，而是有台座 / 柱体 / 球头」。

用法：
    python tools/shoot_char_closeup.py
"""

import http.server
import os
import sys
import threading

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8821
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
                device_scale_factor=3,   # 3× 高清，便于看细节
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

            # ---- 平面模式：角色实体特写 ----
            clip = page.evaluate(
                """() => {
                    const g = window.__game || window.game;
                    const r = g.renderer;
                    const me = g.state.players[0];
                    const rect = r.cellRect(me.position);
                    // 把所有角色挪到同一格，便于横向对比四种配色 / 职业
                    return {
                        x: rect.x - 30, y: rect.y - 40,
                        w: rect.w + 60, h: rect.h + 60,
                        canvasBox: r.canvas.getBoundingClientRect(),
                    };
                }"""
            )
            page.wait_for_timeout(400)
            p1 = os.path.join(shots, "char3d-closeup-flat.png")
            box = clip["canvasBox"]
            page.screenshot(
                path=p1,
                clip={
                    "x": box["x"] + clip["x"],
                    "y": box["y"] + clip["y"],
                    "width": clip["w"],
                    "height": clip["h"],
                },
            )
            print("截图:", p1)

            # ---- 3D 模式：角色实体 + 悬停建筑特写 ----
            page.evaluate(
                """() => {
                    const b = document.getElementById('btn-3d');
                    if (b) b.click();
                }"""
            )
            page.wait_for_timeout(600)

            clip3d = page.evaluate(
                """async () => {
                    const g = window.__game || window.game;
                    const r = g.renderer;
                    const me = g.state.players[0];
                    const rect = r.cellRect(me.position);
                    // 触发一个机构格的 hover 建筑
                    const inst = g.state.board.findIndex(c => c && c.type === 'institution');
                    if (inst >= 0) g.hoverBuildings.enter(inst);
                    await new Promise(x => setTimeout(x, 450));
                    const box = r.canvas.getBoundingClientRect();
                    return {
                        x: box.x + rect.x - 70, y: box.y + rect.y - 130,
                        w: rect.w + 140, h: rect.h + 170,
                    };
                }"""
            )
            p2 = os.path.join(shots, "char3d-closeup-3d.png")
            page.screenshot(
                path=p2,
                clip={
                    "x": max(0, clip3d["x"]),
                    "y": max(0, clip3d["y"]),
                    "width": clip3d["w"],
                    "height": clip3d["h"],
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
