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

    dom_failed = 0
    iso_failed = []
    iso_real_errors = []

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

            # ---- 开一局，让棋盘地块 DOM 真实存在 ----
            # billboard / 深度排序等**渲染层**自检需要活的棋盘，
            # 规则层自检不需要，但共用同一次开局最省事。
            page.evaluate("""() => {
                const btn = document.getElementById('btn-start');
                if (btn) btn.click();
            }""")
            page.wait_for_timeout(600)

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

            # ---- 跑 3D 舞台控制器自检（渲染层逻辑）----
            stage3d = page.evaluate(
                """async () => {
                    const m = await import('/src/core/selftest-stage3d.js');
                    const res = m.runAll();
                    return {
                        total: res.length,
                        pass: res.filter(r => r.pass).length,
                        rows: res.map(r => ({ name: r.name, pass: r.pass, detail: r.detail })),
                    };
                }"""
            )
            result["total"] += stage3d["total"]
            result["pass"] += stage3d["pass"]
            result["rows"] = result["rows"] + stage3d["rows"]

            # ---- 跑地块深度排序自检 ----
            depth = page.evaluate(
                """async () => {
                    const m = await import('/src/core/selftest-tile-depth.js');
                    const res = m.runAll();
                    return {
                        total: res.length,
                        pass: res.filter(r => r.pass).length,
                        rows: res.map(r => ({ name: r.name, pass: r.pass, detail: r.detail })),
                    };
                }"""
            )
            result["total"] += depth["total"]
            result["pass"] += depth["pass"]
            result["rows"] = result["rows"] + depth["rows"]

            # ---- 跑 billboard 文字补偿自检（需要活的棋盘 DOM）----
            billboard = page.evaluate(
                """async () => {
                    const m = await import('/src/core/selftest-billboard.js');
                    const res = m.runAll();
                    return {
                        total: res.length,
                        pass: res.filter(r => r.pass).length,
                        rows: res.map(r => ({ name: r.name, pass: r.pass, detail: r.detail })),
                    };
                }"""
            )
            result["total"] += billboard["total"]
            result["pass"] += billboard["pass"]
            result["rows"] = result["rows"] + billboard["rows"]

            # ---- 跑 hover 立体建筑自检（PR-D）----
            hoverBuilding = page.evaluate(
                """async () => {
                    const m = await import('/src/core/selftest-hover-building.js');
                    const res = m.runAll();
                    return {
                        total: res.length,
                        pass: res.filter(r => r.pass).length,
                        rows: res.map(r => ({ name: r.name, pass: r.pass, detail: r.detail })),
                    };
                }"""
            )
            result["total"] += hoverBuilding["total"]
            result["pass"] += hoverBuilding["pass"]
            result["rows"] = result["rows"] + hoverBuilding["rows"]

            # ---- 跑角色立体化 + 落地特效自检（PR-E）----
            charFx = page.evaluate(
                """async () => {
                    const m = await import('/src/core/selftest-char-fx.js');
                    const res = m.runAll();
                    return {
                        total: res.length,
                        pass: res.filter(r => r.pass).length,
                        rows: res.map(r => ({ name: r.name, pass: r.pass, detail: r.detail })),
                    };
                }"""
            )
            result["total"] += charFx["total"]
            result["pass"] += charFx["pass"]
            result["rows"] = result["rows"] + charFx["rows"]

            # ---- 跑真等距 3D 管线自检（?board=3d）----
            iso3d = page.evaluate(
                """async () => {
                    const m = await import('/src/core/selftest-iso3d.js');
                    const res = m.runAll();
                    return {
                        total: res.length,
                        pass: res.filter(r => r.pass).length,
                        rows: res.map(r => ({ name: r.name, pass: r.pass, detail: r.detail })),
                    };
                }"""
            )
            result["total"] += iso3d["total"]
            result["pass"] += iso3d["pass"]
            result["rows"] = result["rows"] + iso3d["rows"]

            # ---- DOM 管线读数回归（防止 3D 改造时把老管线读数算错）----
            # ⚠ 3D 改造把「地块卡面读数」抽到了 `render3d/tile-face.js`，
            #   DOM / Canvas / 3D 三条管线共用同一份推导。
            #   这里锁死关键读数，确保老管线**一个数字都没变**。
            dom_rows = page.evaluate(
                """() => {
                    const s = window.__game.state;
                    s.players[0].institutions.push({ cellIndex: 1, level: 3, mortgaged: false });
                    s.players[0].institutions.push({ cellIndex: 2, level: 1, mortgaged: true });
                    s.players[0].cash = 99999;
                    window.__game.tileLayer.sync(s);
                    const cards = [...document.querySelectorAll('#board-tiles > *')];
                    const txt = (i) => (cards[i] ? cards[i].textContent : '');
                    // ⚠ 状态类在**最内层** .mt-tile 上
                    //   （外层 .mt-cell 壳 → .mt-tile → .mt-face → .mt-tile.mt-d2.is-held）
                    const cls = (i) => {
                        if (!cards[i]) return '';
                        const all = cards[i].querySelectorAll('.mt-tile');
                        return all.length ? all[all.length - 1].className : cards[i].className;
                    };
                    // 找一个**未被持有**的机构格（卡面上有「买入价」）
                    let inst = -1;
                    for (let i = 0; i < cards.length; i++) {
                        if (txt(i).includes('买入价')) { inst = i; break; }
                    }
                    return {
                        count: cards.length,
                        inst,
                        c1: txt(1), c1cls: cls(1),        // 已持有 + 升级
                        c2: txt(2), c2cls: cls(2),        // 已质押
                        c0: txt(inst), c0cls: cls(inst),  // 未持有
                    };
                }"""
            )
            print("-" * 78)
            print("DOM 管线读数回归（老管线零漂移）...")
            checks = [
                ("34 张地块卡齐备", dom_rows["count"] == 34, f"{dom_rows['count']} 张"),
                ("未持有：主读数 = 买入价", "买入价" in dom_rows["c0"], dom_rows["c0"][:40]),
                ("已持有：主读数 = 管理费", "管理费" in dom_rows["c1"], dom_rows["c1"][:40]),
                ("已持有：打 is-held 标记（持有人真名在卡内）",
                    "is-held" in dom_rows["c1cls"], repr(dom_rows["c1cls"])[:120]),
                ("已质押：有质押标记", "已质押" in dom_rows["c2"] or "质押" in dom_rows["c2cls"],
                    dom_rows["c2cls"][:60]),
                ("可收购：现金充足时打标", "is-afford" in dom_rows["c0cls"], repr(dom_rows["c0cls"])[:120]),
            ]
            dom_failed = 0
            for nm, cond, det in checks:
                mark = "PASS" if cond else "FAIL"
                if not cond:
                    dom_failed += 1
                print(f"[{mark}] {nm}\n        {det}")

            # ---- 真等距 3D 管线：浏览器端集成自检（?board=3d）----
            # ⚠ 需要**另开一个页面**（带 ?board=3d 参数）——
            #   3D 管线与旧管线互斥，同一个页面里不能同时跑。
            print("-" * 78)
            print("真等距 3D 管线集成自检（?board=3d）...")
            iso_page = browser.new_page(viewport={"width": 1440, "height": 900})
            iso_errors = []
            iso_page.on("pageerror", lambda e: iso_errors.append("PAGEERROR " + str(e)))
            iso_page.goto(f"{url}?board=3d", wait_until="load")
            iso_page.wait_for_timeout(1200)
            iso_page.evaluate("() => { const b = document.getElementById('btn-start'); if (b) b.click(); }")
            iso_page.wait_for_timeout(5000)
            # 新手引导遮罩会拦截指针事件 —— 3D 交互测试前先移除
            iso_page.evaluate(
                "() => { document.querySelectorAll('.tutorial-mask').forEach(e => e.remove()); }"
            )

            iso_rows = iso_page.evaluate(
                """async () => {
                    const b = window.__game.isoBoard;
                    const rows = [];
                    const check = (name, cond, detail) =>
                        rows.push({ name, pass: !!cond, detail: detail || '' });
                    if (!b) {
                        check('3D 管线已接管', false, 'isoBoard 未创建');
                        return { rows };
                    }

                    // ① 场景构建
                    const st = b.stats();
                    check('3D 场景已构建（34 砖 / 34 纹理 / 4 穹顶 / 2 地标）',
                        st.bricks === 34 && st.textures === 34 && st.regulators === 4 && st.landmarks === 2,
                        `砖 ${st.bricks} · 纹理 ${st.textures} · 穹顶 ${st.regulators} · 地标 ${st.landmarks}`);
                    check('drawcall 上限（< 400）', st.drawCalls < 400, `drawCalls = ${st.drawCalls}`);
                    check('棋子已生成', st.pieces === 4, `pieces = ${st.pieces}`);

                    // ② 正交相机 + 极角
                    const cam = b.scene.camera;
                    check('相机为正交相机', cam.isOrthographicCamera === true, 'OrthographicCamera');
                    const r = Math.hypot(cam.position.x, cam.position.y, cam.position.z);
                    const polar = Math.acos(cam.position.y / r) * 180 / Math.PI;
                    check('极角 = 35.264°（真等距）', Math.abs(polar - 35.264) < 0.05,
                        `极角 ${polar.toFixed(3)}°`);

                    // ③ 旋转吸附到 90°
                    b.snapTo(0);
                    await new Promise(r2 => setTimeout(r2, 500));
                    b.snapTo(1);
                    await new Promise(r2 => setTimeout(r2, 500));
                    let az = b.scene.azimuth * 180 / Math.PI;
                    // 判定：方位角必须**恰好**落在 45° + k×90° 上
                    const rem = Math.abs(((az - 45) % 90 + 90) % 90);
                    const near90 = Math.min(rem, 90 - rem);
                    check('旋转吸附到 90° 档位（45° + k×90°）', near90 < 0.5 && b.quarter === 1,
                        `方位角 ${az.toFixed(2)}° · 档位 ${b.quarter}`);

                    // ④ 缩放范围
                    b.setZoom(5);
                    const zMax = b.scene.zoomLevel;
                    b.setZoom(0.2);
                    const zMin = b.scene.zoomLevel;
                    b.setZoom(1);
                    check('缩放钳制在 1 ~ 2.2', Math.abs(zMax - 2.2) < 1e-6 && Math.abs(zMin - 1) < 1e-6,
                        `${zMin} ~ ${zMax}`);

                    // ⑤ 平移钳制
                    const lim = (cam.top - cam.bottom) / 2 * 0.18;
                    b.setPan(0, 99);
                    const panZ = b.scene.pan.z;
                    b.setPan(0, 0);
                    check('平移钳制在视口 18% 内', Math.abs(panZ) <= lim + 1e-6,
                        `平移 ${panZ.toFixed(3)} ≤ ${lim.toFixed(3)}`);

                    // ⑥ 逐格 hop 动画
                    const p0 = window.__game.state.players[0];
                    const g = b.pieces.pieces.get(p0.id).group;
                    const path = [];
                    for (let i = 1; i <= 4; i++) path.push((p0.position + i) % 34);
                    b.moveAlong(p0.id, path, { onDone: () => { p0.position = path[path.length - 1]; } });
                    // ⚠ 在**动画内部**采样，而不是在 rAF 里采样 ——
                    //   无头软件渲染只有 ~10fps，外层采样会漏掉抛物线的峰顶。
                    let maxY = -99;
                    const origUpdate = b._updateMove.bind(b);
                    b._updateMove = (now) => {
                        origUpdate(now);
                        if (b._move && b._move.kind === 'hop') maxY = Math.max(maxY, g.position.y);
                    };
                    // 等动画**完全结束**（4 格 × 140ms + 余量）
                    await new Promise(res => setTimeout(res, 1400));
                    b._updateMove = origUpdate;
                    check('逐格 hop 有抛物线跳跃（高 ≈ 0.35 砖）', maxY > 0.15 && maxY <= 0.40,
                        `最大高度 ${maxY.toFixed(3)}`);
                    // ⚠ 落点必须在**动画结束后**判定 ——
                    //   动画途中采样会拿到中间位置（假失败）。
                    const tgt = b.cellPosition(path[path.length - 1]);
                    const dist = Math.hypot(g.position.x - tgt.x, g.position.z - tgt.z);
                    check('hop 落点与目标格一致', dist < 0.06, `偏差 ${dist.toFixed(4)}`);

                    // ⑦ 传送 = 沉降升起
                    b.moveAlong(p0.id, [7], { teleport: true, onDone: () => { p0.position = 7; } });
                    let minY = 99;
                    const origUpdate2 = b._updateMove.bind(b);
                    b._updateMove = (now) => {
                        origUpdate2(now);
                        if (b._move && b._move.kind === 'teleport') minY = Math.min(minY, g.position.y);
                    };
                    await new Promise(res => setTimeout(res, 900));
                    b._updateMove = origUpdate2;
                    const tgt2 = b.cellPosition(7);
                    const dist2 = Math.hypot(g.position.x - tgt2.x, g.position.z - tgt2.z);
                    check('传送为沉降→升起（非逐格跳）', minY < -0.2, `最低点 ${minY.toFixed(3)}`);
                    check('传送落点正确', dist2 < 0.01, `偏差 ${dist2.toFixed(4)}`);

                    // ⑧ 脏纹理：状态不变不重绘
                    b.textures.resetCount();
                    b.labels.resetCount();
                    b.sync(window.__game.state);
                    const same = { tex: b.textures.redrawCount, lab: b.labels.redrawCount };
                    window.__game.state.players[0].cash += 100;
                    b.textures.resetCount();
                    b.labels.resetCount();
                    b.sync(window.__game.state);
                    const cash = { tex: b.textures.redrawCount, lab: b.labels.redrawCount };
                    check('状态不变 → 纹理 0 次重绘（脏纹理策略）',
                        same.tex === 0 && same.lab === 0,
                        `顶面 ${same.tex} / 名牌 ${same.lab}`);
                    check('仅现金变化 → 顶面纹理不重绘', cash.tex === 0,
                        `顶面 ${cash.tex} 次`);

                    // ⑨ 名牌（悬浮标签）
                    const labels = b.labels.count;
                    check('34 块悬浮名牌齐备', labels === 34, `名牌 ${labels} 块`);

                    return { rows };
                }"""
            )
            for r in iso_rows["rows"]:
                mark = "PASS" if r["pass"] else "FAIL"
                line = f"[{mark}] {r['name']}"
                line += f"\n        {r['detail']}" if r["pass"] else f"\n        -> {r['detail']}"
                print(line)
            iso_failed = [r for r in iso_rows["rows"] if not r["pass"]]
            iso_real_errors = [e for e in iso_errors if "GL Driver" not in e]
            print(f"3D 管线集成自检：{len(iso_rows['rows']) - len(iso_failed)}/{len(iso_rows['rows'])} 通过")
            if iso_real_errors:
                print("[FAIL] 3D 模式页面运行时错误：")
                for e in iso_real_errors[:10]:
                    print("   -", e)
            else:
                print("[PASS] 3D 模式无页面运行时错误")
            iso_page.close()

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
    # 3D 管线集成自检 + DOM 管线读数回归也参与总判定
    if dom_failed:
        bad = True
    if iso_failed:
        bad = True
    if iso_real_errors:
        bad = True
    print("=" * 78)
    if bad:
        print("结果：存在失败项")
        return 1
    print("结果：全部通过 ✓")
    return 0


if __name__ == "__main__":
    sys.exit(main())
