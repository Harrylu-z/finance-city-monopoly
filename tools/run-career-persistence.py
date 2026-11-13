"""端到端（补充）：职业被动触发 + 存档/读取/分享链接往返一致性。

用法：python tools/run-career-persistence.py
"""
import http.server
import os
import socketserver
import sys
import threading

from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8819

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
            page.wait_for_timeout(700)

            # ---- 1) 选中「赌王」（索引 6）并开局 ----
            page.locator("#career-picker .career-opt").nth(6).click()
            page.evaluate("() => { const c = document.getElementById('chk-tutorial'); if (c) c.checked = false; }")
            page.locator("#btn-start").click()
            page.wait_for_timeout(1200)

            # ---- 2) 7 种职业被动逐条验证 ----
            passive = page.evaluate(
                """async () => {
                    const rules = await import('/src/core/rules.js');
                    const careers = await import('/src/core/careers.js');
                    const g = window.__game;
                    const st = g.state;
                    const mk = (id) => ({ ...st.players[0], id: 999, careerId: id, career: id });
                    const mult = (id, key) => rules.playerCostMult(mk(id), key);

                    // 交易员：市场周期格 +￥120
                    const tSt = JSON.parse(JSON.stringify(st));
                    tSt.players[0].careerId = 'trader';
                    tSt.players[0].career = 'trader';
                    const marketCell = st.board.find(c => c.type === 'special' && c.special && c.special.id === 'market');
                    const before = tSt.players[0].cash;
                    if (marketCell) rules.settleOnCell(tSt, tSt.players[0], marketCell.index);
                    const traderDelta = tSt.players[0].cash - before;

                    // 赌王：德扑 3 张底牌 + 牌库 ≤52
                    const pSt = JSON.parse(JSON.stringify(st));
                    pSt.players = pSt.players.map((x, i) => ({
                        ...x, careerId: i === 0 ? 'king' : 'ib', career: i === 0 ? 'king' : 'ib',
                    }));
                    const pg = rules.startCasinoGame(pSt);
                    const used = [...pg.deckUsed, ...pg.burned];

                    return {
                        ib: mult('ib', 'buyCostMult'),
                        fund: mult('fund', 'upgradeCostMult'),
                        actuary: mult('actuary', 'rentMult'),
                        risk: mult('risk', 'trapRelief'),
                        quant: careers.careerEffectValue(mk('quant'), 'pokerFoldBias'),
                        traderDelta,
                        kingHoles: pg.seats.map(s => s.hole.length),
                        kingExtra: pg.seats.map(s => s.extraHole),
                        deckTotal: used.length,
                        deckUnique: new Set(used.map(c => c.id)).size,
                        deckCount: pg.deck.length + used.length,
                    };
                }"""
            )
            print("[1] 职业被动：", passive)

            def near(a, b):
                return a is not None and abs(a - b) < 1e-9

            if not near(passive.get("ib"), 0.92):
                failures.append(f"投行家收购乘数应为 0.92，实际 {passive.get('ib')}")
            if not near(passive.get("fund"), 0.94):
                failures.append(f"基金经理升级乘数应为 0.94，实际 {passive.get('fund')}")
            if not near(passive.get("actuary"), 1.06):
                failures.append(f"精算师租金乘数应为 1.06，实际 {passive.get('actuary')}")
            if not near(passive.get("risk"), 0.30):
                failures.append(f"风控总监罚金减免应为 0.30，实际 {passive.get('risk')}")
            if passive.get("quant", 0) <= 0:
                failures.append(f"量化研究员折牌偏置未生效：{passive.get('quant')}")
            if passive.get("traderDelta", 0) < 120:
                failures.append(f"交易员价差收益未生效：{passive.get('traderDelta')}")

            holes = passive.get("kingHoles") or []
            if not holes or holes[0] != 3:
                failures.append(f"赌王底牌应为 3 张：{holes}")
            if any(h != 2 for h in holes[1:]):
                failures.append(f"其余玩家底牌应为 2 张：{holes}")
            if passive.get("deckTotal", 99) > 52:
                failures.append(f"牌库用量超过 52：{passive.get('deckTotal')}")
            if passive.get("deckUnique") != passive.get("deckTotal"):
                failures.append(f"牌库出现重复牌：{passive}")
            if passive.get("deckCount") != 52:
                failures.append(f"总牌数应为 52，实际 {passive.get('deckCount')}")

            # ---- 3) AI 职业 + 性格双属性；真人不得被分配性格 ----
            dual = page.evaluate(
                """async () => {
                    const st = window.__game.state;
                    const ai = st.players.filter(p => p.isAI);
                    const human = st.players.find(p => !p.isAI);
                    const careers = await import('/src/core/careers.js');
                    const pdefs = await import('/src/core/personalities.js');
                    return {
                        aiCount: ai.length,
                        aiCareerIds: ai.map(p => p.careerId),
                        aiCareerValid: ai.every(p => !!careers.CAREER_BY_ID[p.careerId]),
                        aiPersonalityIds: ai.map(p => p.personalityId),
                        aiPersonalityValid: ai.every(p => !!pdefs.PERSONALITY_BY_ID[p.personalityId]),
                        aiPersonalityUnique: new Set(ai.map(p => p.personalityId)).size === ai.length,
                        aiAvatarMatchesCareer: ai.every(
                            p => p.avatar === careers.CAREER_BY_ID[p.careerId].pieceIndex),
                        humanPersonalityId: human.personalityId,
                        humanPersonality: human.personality,
                        humanCareerId: human.careerId,
                    };
                }"""
            )
            print("[3] AI 双属性：", dual)
            if dual.get("aiCount", 0) < 1:
                failures.append("对局中没有 AI 玩家")
            if not dual.get("aiCareerValid"):
                failures.append(f"AI 职业无效：{dual.get('aiCareerIds')}")
            if not dual.get("aiPersonalityValid"):
                failures.append(f"AI 性格无效：{dual.get('aiPersonalityIds')}")
            if not dual.get("aiPersonalityUnique"):
                failures.append(f"AI 性格重复：{dual.get('aiPersonalityIds')}")
            if not dual.get("aiAvatarMatchesCareer"):
                failures.append("AI 棋子未使用职业专属立绘")
            if dual.get("humanPersonalityId") is not None:
                failures.append(f"真人玩家不应被分配性格：{dual.get('humanPersonalityId')}")
            if dual.get("humanPersonality") is not None:
                failures.append("真人玩家 personality 应为 null")

            # ---- 4) 旧存档兼容：AI 缺性格字段 → 中性基准；真人恒 null ----
            legacy = page.evaluate(
                """async () => {
                    const rules = await import('/src/core/rules.js');
                    const pdefs = await import('/src/core/personalities.js');
                    const st = rules.createState({
                        seed: 'legacy-save', legacy: true,
                        players: [
                            { id: 0, name: '旧人类', isAI: false, careerId: 'ib' },
                            { id: 1, name: '旧AI', isAI: true, careerId: 'risk' },
                        ],
                        cash: 1500,
                    });
                    const ai = st.players[1];
                    const human = st.players[0];
                    // 旧存档里的 AI 没有性格字段时必须降级为中性，而不是报错
                    const d = (await import('/src/core/ai.js')).decide(
                        st, ai, 'purchase', { cellIndex: 1 });
                    // 真人即使带了 personality 字段也不应被接受
                    const st2 = rules.createState({
                        seed: 'legacy-human', legacy: true,
                        players: [
                            { id: 0, name: '人类', isAI: false, personalityId: 'aggressive' },
                        ],
                        cash: 1500,
                    });
                    return {
                        aiPersonalityId: ai.personalityId,
                        aiPersonality: ai.personality,
                        neutralId: pdefs.DEFAULT_PERSONALITY_ID,
                        decisionOk: !!(d && d.action),
                        humanPersonalityId: human.personalityId,
                        humanWithPersonalityId: st2.players[0].personalityId,
                    };
                }"""
            )
            print("[4] 旧存档兼容：", legacy)
            if legacy.get("aiPersonalityId") != legacy.get("neutralId"):
                failures.append(
                    f"旧存档 AI 缺性格应降级为 {legacy.get('neutralId')}，"
                    f"实际 {legacy.get('aiPersonalityId')}")
            if legacy.get("aiPersonality") is not None:
                failures.append("旧存档 AI 降级后不应挂载性格定义")
            if not legacy.get("decisionOk"):
                failures.append("旧存档 AI 决策失败")
            if legacy.get("humanPersonalityId") is not None:
                failures.append("旧存档真人性格应为 null")
            if legacy.get("humanWithPersonalityId") is not None:
                failures.append(
                    f"真人即使携带性格字段也不应被分配：{legacy.get('humanWithPersonalityId')}")

            # ---- 5) 存档 / 读取 / 分享链接往返 ----
            rt = page.evaluate(
                """async () => {
                    const persist = await import('/src/app/persist.js');
                    const share = await import('/src/app/share.js');
                    const g = window.__game;
                    const st = g.state;
                    persist.saveRecord({
                        seed: st.seed, winnerName: 'X', winnerAssets: 1,
                        isPlayerWinner: true, rounds: 1, turns: 1, bestChain: 0, players: [],
                    });
                    return {
                        settingsCareer: persist.loadSettings().careerId,
                        historyLen: persist.loadHistory().length,
                        url: share.buildShareUrl({
                            seed: st.seed, nickname: st.players[0].name,
                            avatar: st.players[0].avatar, careerId: st.players[0].careerId,
                            difficulty: 'normal', aiCount: 3, diceCount: 2,
                            cash: 'standard', market: 'normal',
                        }),
                    };
                }"""
            )
            print("[5] 存档/分享往返：", {k: v for k, v in rt.items() if k != "url"})
            if rt.get("settingsCareer") != "king":
                failures.append(f"设置项存档职业应为 king，实际 {rt.get('settingsCareer')}")
            if rt.get("historyLen", 0) < 1:
                failures.append("战绩未写入本地存储")

            # ---- 4) 分享链接打开 → 界面与开局后职业均为 king ----
            page.goto(rt["url"], wait_until="load")
            page.wait_for_timeout(1300)
            sel = page.evaluate(
                "() => document.querySelector('#career-picker .career-opt.is-sel')?.dataset.career ?? null"
            )
            print("[6] 分享链接界面选中职业：", sel)
            if sel != "king":
                failures.append(f"分享链接界面职业应为 king，实际 {sel}")

            page.evaluate("() => { const c = document.getElementById('chk-tutorial'); if (c) c.checked = false; }")
            page.locator("#btn-start").click()
            page.wait_for_timeout(1200)
            started = page.evaluate(
                "() => window.__game?.state?.players?.[0]?.careerId ?? null"
            )
            print("[7] 分享链接开局后职业：", started)
            if started != "king":
                failures.append(f"分享链接开局后职业应为 king，实际 {started}")

            # ---- 8) 分享链接还原后 AI 性格与首次开局完全一致（可复现） ----
            restored = page.evaluate(
                """() => {
                    const st = window.__game.state;
                    return {
                        seed: st.seed,
                        aiPersonalityIds: st.players.filter(p => p.isAI).map(p => p.personalityId),
                        aiCareerIds: st.players.filter(p => p.isAI).map(p => p.careerId),
                    };
                }"""
            )
            print("[8] 分享链接还原后的 AI 属性：", restored)
            if not restored.get("aiPersonalityIds") or any(
                    x is None for x in restored.get("aiPersonalityIds", [])):
                failures.append(f"分享链接还原后 AI 缺少性格：{restored.get('aiPersonalityIds')}")
            if restored.get("aiCareerIds") != dual.get("aiCareerIds"):
                failures.append(
                    f"分享链接还原后 AI 职业与首次不一致："
                    f"{restored.get('aiCareerIds')} vs {dual.get('aiCareerIds')}")
            if restored.get("aiPersonalityIds") != dual.get("aiPersonalityIds"):
                failures.append(
                    f"分享链接还原后 AI 性格与首次不一致："
                    f"{restored.get('aiPersonalityIds')} vs {dual.get('aiPersonalityIds')}")

            # ---- 5) 刷新后设置项仍保留职业 ----
            page.goto(f"http://127.0.0.1:{PORT}/index.html", wait_until="load")
            page.wait_for_timeout(800)
            persisted = page.evaluate(
                """async () => {
                    const persist = await import('/src/app/persist.js');
                    const s = persist.loadSettings();
                    const sel = document.querySelector('#career-picker .career-opt.is-sel');
                    return { career: s.careerId, sel: sel ? sel.dataset.career : null };
                }"""
            )
            print("[8] 刷新后设置项：", persisted)
            if persisted.get("career") != "king":
                failures.append(f"刷新后设置项职业应为 king，实际 {persisted.get('career')}")

            print("[9] JS 运行时错误：", js_errors)
            if js_errors:
                failures.append(f"存在 JS 运行时错误：{js_errors[:3]}")

            browser.close()
    finally:
        httpd.shutdown()

    print("=" * 70)
    if failures:
        print("职业 / 持久化测试失败：")
        for f in failures:
            print("  -", f)
        return 1
    print("职业 / 持久化测试全部通过 ✓")
    return 0


if __name__ == "__main__":
    sys.exit(main())
