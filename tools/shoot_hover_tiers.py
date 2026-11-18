#!/usr/bin/env python3
"""
悬停建筑体量对照图 —— 验证「按等级递增」与「配色 / 归属」正确。

做法：直接把同一格的等级改成 0..4，逐级截图。

用法：
    python tools/shoot_hover_tiers.py
"""

import http.server
import os
import sys
import threading

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8823
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
                device_scale_factor=2,
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

            page.evaluate(
                """() => {
                    const b = document.getElementById('btn-3d');
                    if (b) b.click();
                }"""
            )
            page.wait_for_timeout(600)

            info = page.evaluate(
                """() => {
                    const g = window.__game || window.game;
                    const st = g.state;
                    const idx = st.board.findIndex(c => c && c.type === 'institution'
                        && !c.regulator);
                    return { idx, name: st.board[idx] && st.board[idx].name };
                }"""
            )
            print(f"目标机构格: #{info['idx']} {info['name']}")

            for lv in range(5):
                box = page.evaluate(
                    """async ([idx, lv]) => {
                        const g = window.__game || window.game;
                        const st = g.state;
                        // 强制该格归属 1 号玩家，且等级 = lv
                        const me = st.players[0];
                        st.players.forEach(p => {
                            p.institutions = p.institutions.filter(i => i.cellIndex !== idx);
                        });
                        me.institutions.push({ cellIndex: idx, level: lv });
                        g.hoverBuildings.sync(st);
                        g.hoverBuildings.enter(idx);
                        await new Promise(r => setTimeout(r, 450));
                        const r = g.renderer;
                        const rect = r.cellRect(idx);
                        const cb = r.canvas.getBoundingClientRect();
                        const node = document.querySelector('.mt-hb.is-in');
                        return {
                            x: cb.x + rect.x - rect.w * 1.2,
                            y: cb.y + rect.y - rect.h * 2.0,
                            w: rect.w * 3.4,
                            h: rect.h * 3.4,
                            scale: node ? node.style.getPropertyValue('--hb-scale') : '',
                            lvl: node ? node.dataset.level : '',
                            signText: node && node.querySelector('.mt-hb-sign')
                                ? node.querySelector('.mt-hb-sign').textContent.trim() : '',
                        };
                    }""",
                    [info["idx"], lv],
                )
                path = os.path.join(shots, f"char3d-hover-lv{lv}.png")
                page.screenshot(
                    path=path,
                    clip={
                        "x": max(0, box["x"]), "y": max(0, box["y"]),
                        "width": box["w"], "height": box["h"],
                    },
                )
                print(f"lv{lv}: scale={box['scale']} sign='{box['signText']}' → {path}")

            browser.close()
    finally:
        httpd.shutdown()

    print("完成 ✓")
    return 0


if __name__ == "__main__":
    sys.exit(main())
