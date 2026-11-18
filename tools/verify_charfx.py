#!/usr/bin/env python3
"""
PR-E 落地特效视觉验证 —— 抓取落地冲击波动画中间帧。

用法：
    python tools/verify_charfx.py

验证内容：
  1. 3D 模式下落地特效能生成，且位于不透明牌面**之上**（不被遮挡）
  2. 落地环是贴地椭圆（Y 方向压扁）
  3. 动画结束后 DOM 节点被自动清理
  4. 平面模式下落地特效同样可见
  5. 逐格移动时**每一步**都触发一次落地回调
"""

import argparse
import http.server
import os
import sys
import threading
from pathlib import Path

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8788

CHROME_PATHS = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
]

SHOTS = Path(ROOT) / "tools" / "shots"


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
    ap.add_argument("--keep", action="store_true", help="保留浏览器窗口（调试用）")
    args = ap.parse_args()

    chrome = find_chrome()
    if not chrome:
        print("[FAIL] 找不到 Chrome / Edge 可执行文件")
        return 2

    from playwright.sync_api import sync_playwright

    SHOTS.mkdir(parents=True, exist_ok=True)
    httpd = serve()
    url = f"http://127.0.0.1:{PORT}/index.html"
    errors = []

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(
                executable_path=chrome,
                headless=not args.keep,
                args=["--disable-gpu", "--no-sandbox", "--allow-file-access-from-files"],
            )
            page = browser.new_page(viewport={"width": 1440, "height": 900})
            page.on("pageerror", lambda e: errors.append("PAGEERROR " + str(e)))
            page.on(
                "console",
                lambda m: errors.append("CONSOLE.ERROR " + m.text) if m.type == "error" else None,
            )

            page.goto(url, wait_until="networkidle")
            page.wait_for_timeout(400)

            # 开局（用 JS 点击 —— headless 下按钮可能不可见）
            page.evaluate(
                """() => {
                    const b = [...document.querySelectorAll('button')]
                        .find(x => x.textContent.trim() === '开局');
                    if (b) b.click();
                }"""
            )
            page.wait_for_timeout(700)

            # 关掉教学（用 JS 点击 —— headless 下弹层可能不可见）
            page.evaluate(
                """() => {
                    for (const label of ['跳过教学', '下一步']) {
                        const b = [...document.querySelectorAll('button')]
                            .find(x => x.textContent.trim() === label && x.offsetParent !== null);
                        if (b) { b.click(); break; }
                    }
                }"""
            )
            page.wait_for_timeout(400)
            page.evaluate(
                """() => {
                    for (const label of ['跳过教学', '下一步']) {
                        const b = [...document.querySelectorAll('button')]
                            .find(x => x.textContent.trim() === label && x.offsetParent !== null);
                        if (b) { b.click(); break; }
                    }
                }"""
            )
            page.wait_for_timeout(400)

            # 开 3D（用 JS 点击 —— headless 下按钮可能在折叠的 HUD 里，不可见）
            page.evaluate("document.getElementById('btn-3d').click()")
            page.wait_for_timeout(900)

            # ---------- 1. 3D 模式落地特效 ----------
            # 在动画中段抓帧（~40% 处）—— 此时环已张开到最大附近，最容易看清
            captured = page.evaluate(
                """async () => {
                    const g = window.__game;
                    if (!g) return { error: 'no __game' };
                    if (!g.landingFx) return { error: 'no landingFx' };
                    const idx = g.state.board.findIndex(c => c.type === 'institution');
                    g.landingFx.spawn(idx, '#63c6e6');
                    // 等待动画推进到 ~40%（总时长 620ms）
                    await new Promise(r => setTimeout(r, 250));
                    const n = document.querySelector('#fx-layer .landing-fx');
                    if (!n) return { error: 'no node' };
                    const r = n.getBoundingClientRect();
                    const ring = n.querySelector('.landing-fx-ring');
                    const cs = getComputedStyle(ring);
                    const rr = ring.getBoundingClientRect();
                    return {
                        count: document.querySelectorAll('#fx-layer .landing-fx').length,
                        index: idx,
                        rect: { x: Math.round(r.x), y: Math.round(r.y),
                                w: Math.round(r.width), h: Math.round(r.height) },
                        ringRect: { x: Math.round(rr.x), y: Math.round(rr.y),
                                    w: Math.round(rr.width), h: Math.round(rr.height) },
                        ringTransform: cs.transform,
                        ringOpacity: cs.opacity,
                        fxZ: getComputedStyle(document.getElementById('fx-layer')).zIndex,
                        tilesZ: getComputedStyle(document.getElementById('board-tiles')).zIndex,
                        stage3D: document.getElementById('board-stage').classList.contains('is-3d'),
                        is3D: g.renderer && g.renderer.is3D,
                    };
                }"""
            )
            print("[3D 落地特效]", captured)
            page.screenshot(path=str(SHOTS / "pr-e-landing-fx-3d.png"))

            # ---------- 2. 动画结束后自动清理 ----------
            page.wait_for_timeout(1200)
            after = page.evaluate(
                "document.querySelectorAll('#fx-layer .landing-fx').length"
            )
            print(f"[动画结束后残留节点] {after}（应为 0）")

            # ---------- 3. 平面模式 ----------
            page.evaluate("document.getElementById('btn-3d').click()")
            page.wait_for_timeout(800)
            flat = page.evaluate(
                """async () => {
                    const g = window.__game;
                    const idx = g.state.board.findIndex(c => c.type === 'institution');
                    g.landingFx.spawn(idx, '#63c6e6');
                    await new Promise(r => setTimeout(r, 250));
                    const n = document.querySelector('#fx-layer .landing-fx');
                    if (!n) return { error: 'no node' };
                    const r = n.getBoundingClientRect();
                    const ring = n.querySelector('.landing-fx-ring');
                    return {
                        count: document.querySelectorAll('#fx-layer .landing-fx').length,
                        rect: { x: Math.round(r.x), y: Math.round(r.y),
                                w: Math.round(r.width), h: Math.round(r.height) },
                        ringTransform: getComputedStyle(ring).transform,
                    };
                }"""
            )
            print("[平面模式落地特效]", flat)
            page.screenshot(path=str(SHOTS / "pr-e-landing-fx-flat.png"))

            # ---------- 4. 逐格移动触发落地回调 ----------
            page.wait_for_timeout(900)
            moved = page.evaluate(
                """async () => {
                    const g = window.__game;
                    let fired = 0;
                    const orig = g.spawnLandingFx.bind(g);
                    g.spawnLandingFx = (pl, path, i) => { fired++; return orig(pl, path, i); };
                    const p0 = g.state.players[0];
                    const steps = 4;
                    const from = p0.position;
                    const path = [];
                    for (let k = 1; k <= steps; k++) path.push((from + k) % g.state.board.length);
                    g.mover.start({
                        playerId: p0.id, from, to: path[path.length-1], steps, path,
                        onLand: (i) => g.spawnLandingFx(p0, path, i),
                        onDone: () => {},
                    });
                    await new Promise(r => setTimeout(r, 1400));
                    return { fired };
                }"""
            )
            print(f"[逐格落地回调次数] {moved.get('fired')}（4 格应 >= 3）")

            print("[JS 运行时错误]", errors)
            browser.close()
    finally:
        httpd.shutdown()

    return 0 if not errors else 1


if __name__ == "__main__":
    sys.exit(main())
