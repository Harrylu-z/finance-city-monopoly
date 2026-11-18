#!/usr/bin/env python3
"""
3D 界面与角色实体改造 —— 端到端验证脚本。

验证内容：
  1. 角色实体存在（Canvas 内绘制了实体棋子，而非只有水波纹）
  2. 多格移动耗时符合预期（每步 ≥ 260ms）
  3. hover 立体建筑可见且带体量
  4. 地块 3D 样式生效（厚度 / 浮雕 / 侧边）
  5. 无 JS 运行时错误
  6. 平面模式为 fallback（3D 关掉后角色实体仍在）

用法：
    python tools/verify_char3d.py
"""

import http.server
import json
import os
import re
import sys
import threading
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8820
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
    errors = []
    failures = []
    shots = os.path.join(ROOT, "tools", "shots")
    os.makedirs(shots, exist_ok=True)

    def check(name, cond, detail=""):
        print(f"[{'PASS' if cond else 'FAIL'}] {name}")
        if detail:
            print(f"        {detail}")
        if not cond:
            failures.append(name)

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(
                executable_path=chrome,
                headless=True,
                args=["--disable-gpu", "--no-sandbox"],
            )
            page = browser.new_page(viewport={"width": 1600, "height": 1000})
            page.on("pageerror", lambda e: errors.append("PAGEERROR " + str(e)))
            page.on(
                "console",
                lambda m: errors.append("CONSOLE.ERROR " + m.text) if m.type == "error" else None,
            )

            page.goto(url, wait_until="networkidle")
            page.wait_for_timeout(400)

            # ---- 开局 ----
            page.evaluate(
                """() => {
                    const b = [...document.querySelectorAll('button')]
                        .find(x => x.textContent.trim() === '开局');
                    if (b) b.click();
                }"""
            )
            page.wait_for_timeout(800)

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
                page.wait_for_timeout(280)

            # ---- 开启 3D ----
            page.evaluate(
                """() => {
                    const b = document.getElementById('btn-3d');
                    if (b) b.click();
                }"""
            )
            page.wait_for_timeout(500)
            is3d = page.evaluate(
                "() => !!document.getElementById('board-stage').classList.contains('is-3d')"
            )
            check("3D 模式已开启", is3d)

            # ---- 断言 1：角色实体存在（不是只有水波纹）----
            # 通过渲染器的调试接口读取「本次绘制绘制了多少实体构件」
            ent = page.evaluate(
                """() => {
                    const g = window.__game || window.game;
                    const r = g && g.renderer;
                    if (!r) return null;
                    return {
                        // ⚠ 实体的计数由 CharEntityRenderer 持有 —— 
                        //   renderer.charEntities.entityCount 才是真实来源
                        entityCount: r.charEntities
                            ? (r.charEntities.entityCount || 0)
                            : 0,
                        entitySupported: !!(r.charEntities
                            && typeof r.charEntities.draw === 'function'),
                        tokensDrawn: r.lastTokenCount || 0,
                    };
                }"""
            )
            check("渲染器具备角色实体绘制能力", bool(ent) and ent.get("entitySupported"),
                  json.dumps(ent, ensure_ascii=False))
            check("本帧确实绘制了角色实体", bool(ent) and (ent.get("entityCount") or 0) >= 1,
                  f"实体数 = {ent.get('entityCount') if ent else '?'}，"
                  f"棋子数 = {ent.get('tokensDrawn') if ent else '?'}")

            # ---- 断言 2：多格移动耗时 ----
            # 强制把玩家放到起点附近，掷出较大的点数，测量整段步进耗时
            timing = page.evaluate(
                """async () => {
                    const g = window.__game || window.game;
                    const me = g.state.players[0];
                    const stepMs = (g.mover && g.mover.stepMs) || 0;

                    // 直接驱动 MoveAnimator，走 6 格
                    const t0 = performance.now();
                    await new Promise(resolve => {
                        const orig = g.mover.onDone;
                        g.mover.start({
                            playerId: me.id,
                            from: me.position,
                            to: (me.position + 6) % 34,
                            steps: 6,
                            path: Array.from({length: 6}, (_, i) => (me.position + 1 + i) % 34),
                            onLand: () => {},
                            onDone: () => {
                                if (orig) orig();
                                resolve();
                            },
                        });
                        const tick = () => {
                            if (!g.mover.active) return;
                            g.mover.update();
                            requestAnimationFrame(tick);
                        };
                        requestAnimationFrame(tick);
                    });
                    const dt = performance.now() - t0;
                    return { stepMs, steps: 6, elapsed: Math.round(dt),
                             perStep: Math.round(dt / 6) };
                }"""
            )
            print(f"        步进计时：{json.dumps(timing, ensure_ascii=False)}")
            check("每格步进耗时 ≥ 260ms（已放慢）",
                  timing.get("perStep", 0) >= 260,
                  f"实测每格 {timing.get('perStep')}ms（常量 STEP_MS = {timing.get('stepMs')}）")
            check("步进常量已集中定义（STEP_MS 可配置）",
                  timing.get("stepMs", 0) >= 260,
                  f"MoveAnimator.stepMs = {timing.get('stepMs')}")

            # ---- 断言 2b：角色实体在画布上真的画出了「体量」----
            #
            # ⚠ 光靠「方法存在」证明不了实体真的被画出来。
            #   这里直接读 Canvas 像素：取角色脚下方形区域，
            #   统计**非背景色的像素簇** —— 实体（台座 + 柱体 + 头）
            #   会形成明显的彩色像素群，而空白画布不会有。
            pixels = page.evaluate(
                """() => {
                    const g = window.__game || window.game;
                    const r = g.renderer;
                    const cv = r.canvas;
                    const ctx = cv.getContext('2d');
                    const me = g.state.players[0];
                    const rect = r.cellRect(me.position);

                    // 角色站位区域（格子中下部）
                    const x = Math.max(0, Math.floor(rect.x * (cv.width / r.w)));
                    const y = Math.max(0, Math.floor((rect.y + rect.h * 0.35) * (cv.height / r.h)));
                    const w = Math.max(1, Math.floor(rect.w * (cv.width / r.w)));
                    const h = Math.max(1, Math.floor(rect.h * 0.6 * (cv.height / r.h)));
                    if (x + w > cv.width || y + h > cv.height) return null;

                    const data = ctx.getImageData(x, y, w, h).data;
                    let colored = 0;
                    let distinct = new Set();
                    for (let i = 0; i < data.length; i += 4) {
                        const a = data[i + 3];
                        if (a < 24) continue;
                        const key = (data[i] >> 4) + ',' + (data[i+1] >> 4) + ',' + (data[i+2] >> 4);
                        // 忽略近白/近黑（牌面底色与文字）
                        const lum = 0.299*data[i] + 0.587*data[i+1] + 0.114*data[i+2];
                        if (lum > 232 || lum < 26) continue;
                        colored++;
                        distinct.add(key);
                    }
                    return { colored, distinct: distinct.size, w, h };
                }"""
            )
            print(f"        角色区域像素：{json.dumps(pixels, ensure_ascii=False)}")
            check("角色在画布上确实画出了实体像素",
                  bool(pixels) and (pixels.get("colored") or 0) > 40
                  and (pixels.get("distinct") or 0) >= 4,
                  f"彩色像素 {pixels.get('colored') if pixels else '?'} 个，"
                  f"色簇 {pixels.get('distinct') if pixels else '?'} 种")

            # ---- 断言 3：hover 立体建筑 ----
            hb = page.evaluate(
                """async () => {
                    const g = window.__game || window.game;
                    const inst = g.state.board.findIndex(c => c && c.type === 'institution');
                    if (inst < 0) return null;
                    const layer = document.getElementById('hover-buildings');
                    g.hoverBuildings.enter(inst);
                    await new Promise(r => setTimeout(r, 420));
                    const node = layer.querySelector('.mt-hb.is-in');
                    if (!node) return { visible: false, index: inst };
                    const r = node.getBoundingClientRect();
                    const img = node.querySelector('.mt-hb-img');
                    return {
                        visible: true,
                        index: inst,
                        w: Math.round(r.width),
                        h: Math.round(r.height),
                        hasPlaza: !!node.querySelector('.mt-hb-plaza'),
                        hasGlow: !!node.querySelector('.mt-hb-glow'),
                        hasSign: !!node.querySelector('.mt-hb-sign'),
                        hasWindows: !!node.querySelector('.mt-hb-windows'),
                        imgLoaded: !!(img && img.src && img.src.length > 40),
                        scale: node.style.getPropertyValue('--hb-scale'),
                        lift: getComputedStyle(node).transform,
                    };
                }"""
            )
            print(f"        hover 建筑：{json.dumps(hb, ensure_ascii=False)}")
            check("hover 立体建筑可见", bool(hb) and hb.get("visible") is True,
                  f"尺寸 {hb.get('w') if hb else '?'}×{hb.get('h') if hb else '?'}px")
            check("建筑含底座广场 / 窗户灯光 / 招牌等精细构件",
                  bool(hb) and hb.get("hasPlaza") and hb.get("hasGlow")
                  and hb.get("hasWindows") and hb.get("hasSign"),
                  f"plaza={hb.get('hasPlaza') if hb else None} "
                  f"glow={hb.get('hasGlow') if hb else None} "
                  f"windows={hb.get('hasWindows') if hb else None} "
                  f"sign={hb.get('hasSign') if hb else None}")

            # ---- 断言 4：地块 3D 样式生效 ----
            tile = page.evaluate(
                """() => {
                    const cell = document.querySelector('.mt-cell');
                    if (!cell) return null;
                    const cs = getComputedStyle(cell);
                    const face = cell.querySelector('.mt-face');
                    const fs = face ? getComputedStyle(face) : null;
                    const after = getComputedStyle(cell, '::after');
                    return {
                        transform: cs.transform,
                        hasThickness: cs.transform && cs.transform !== 'none',
                        faceShadow: fs ? fs.boxShadow : '',
                        sideShadow: after.background && after.background !== 'rgba(0, 0, 0, 0)',
                        d2Transform: (() => {
                            const d2 = cell.querySelector('.mt-d2');
                            return d2 ? getComputedStyle(d2).transform : null;
                        })(),
                    };
                }"""
            )
            print(f"        地块样式：{json.dumps(tile, ensure_ascii=False)}")
            check("地块在 3D 下有厚度变换", bool(tile) and tile.get("hasThickness"),
                  f"transform = {tile.get('transform') if tile else '?'}")
            check("牌面有浮雕 / 落影", bool(tile) and "inset" in (tile.get("faceShadow") or ""),
                  f"box-shadow = {tile.get('faceShadow') if tile else '?'}")
            check("牌体有侧边（厚度面）", bool(tile) and tile.get("sideShadow") is True)
            check("信息层做 billboard 反向补偿",
                  bool(tile) and tile.get("d2Transform") is not None
                  and "matrix" in (tile.get("d2Transform") or ""),
                  f"mt-d2 transform = {tile.get('d2Transform') if tile else '?'}")

            # ---- 截图：3D 全景 ----
            page.wait_for_timeout(300)
            p1 = os.path.join(shots, "char3d-3d-scene.png")
            page.screenshot(path=p1)
            print("截图:", p1)

            # ---- 截图：左栏 + 角色特写 ----
            left = page.query_selector("#hud-left")
            if left:
                p2 = os.path.join(shots, "char3d-hud.png")
                left.screenshot(path=p2)
                print("截图:", p2)

            # ---- 断言 5：平面 fallback ----
            page.evaluate(
                """() => {
                    const b = document.getElementById('btn-3d');
                    if (b) b.click();
                }"""
            )
            page.wait_for_timeout(500)
            flat = page.evaluate(
                """() => {
                    const g = window.__game || window.game;
                    const r = g.renderer;
                    return {
                        is3d: !!document.getElementById('board-stage').classList.contains('is-3d'),
                        entityStillSupported: !!(r.charEntities
                            && typeof r.charEntities.draw === 'function'),
                        entityCount: r.charEntities
                            ? (r.charEntities.entityCount || 0)
                            : 0,
                        tokens: r.lastTokenCount || 0,
                    };
                }"""
            )
            check("切回平面模式后 3D 关闭", flat.get("is3d") is False)
            check("平面模式下角色实体依然存在（fallback）",
                  flat.get("entityStillSupported") is True
                  and (flat.get("entityCount") or 0) >= 1,
                  f"平面模式实体数 = {flat.get('entityCount')}")

            p3 = os.path.join(shots, "char3d-flat-scene.png")
            page.screenshot(path=p3)
            print("截图:", p3)

            # ---- 断言 6：无 JS 错误 ----
            check("无 JS 运行时错误", not errors, f"错误：{errors[:4]}")

            browser.close()
    finally:
        httpd.shutdown()

    print("=" * 70)
    if failures:
        print(f"结果：{len(failures)} 项失败 —— {failures}")
        return 1
    print("结果：全部通过 ✓")
    return 0


if __name__ == "__main__":
    sys.exit(main())
