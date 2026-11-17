"""
HUD 改版截图 —— device_scale_factor=3，跳过教学。

用法：python tools/shoot_hud2.py
产物：design-proposals/maps/shots/hud2-{full,tabs,bg,wheel,tiles}.png
"""
import asyncio
import os
from playwright.async_api import async_playwright

CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
URL = "http://127.0.0.1:8000/"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOT_DIR = os.path.join(ROOT, "design-proposals", "maps", "shots")


async def dismiss(page):
    """开局 → 跳过教学 → 移除教学遮罩。"""
    await page.wait_for_timeout(900)
    start = await page.query_selector("#btn-start")
    if start:
        await start.click()
        await page.wait_for_timeout(1400)
    for _ in range(8):
        clicked = await page.evaluate("""() => {
          const b=[...document.querySelectorAll('button')].find(x =>
            x.offsetParent !== null && /跳过教学|开始游戏|下一步/.test(x.textContent));
          if (b) { b.click(); return true; }
          return false;
        }""")
        await page.wait_for_timeout(400)
        if not clicked:
            break
    await page.evaluate("""() => {
      const m=document.querySelector('.tutorial-mask'); if(m) m.remove();
    }""")
    for _ in range(40):
        ok = await page.evaluate("() => !!(window.__game && window.__game.state)")
        if ok:
            break
        await page.wait_for_timeout(300)
    await page.wait_for_timeout(900)


async def main():
    os.makedirs(SHOT_DIR, exist_ok=True)
    async with async_playwright() as p:
        browser = await p.chromium.launch(executable_path=CHROME, headless=True)
        page = await browser.new_page(
            viewport={"width": 1920, "height": 1080},
            device_scale_factor=3,
        )
        await page.goto(URL, wait_until="load")
        await dismiss(page)

        # ---------- 造出「有资产」的中期局面 ----------
        await page.evaluate("""() => {
          const g = window.__game;
          const st = g.state;
          const human = st.players.find(p => !p.isAI);
          const ais = st.players.filter(p => p.isAI);
          const instIdx = [];
          for (let i = 0; i < st.board.length; i++) {
            const c = st.board[i];
            if (c && c.type === 'institution') instIdx.push(i);
          }
          // 人类持 3 家（含 1 家质押），AI 持 2 家
          [0,1,2].forEach((k, n) => {
            const i = instIdx[k];
            const cell = st.board[i];
            human.institutions.push({ cellIndex: i, level: (cell.tier||0) + 1,
              mortgaged: n === 0, mortgageAmount: n === 0 ? 800 : 0 });
            cell.owner = st.players.indexOf(human);
            cell.mortgaged = n === 0;
          });
          [3,4].forEach((k) => {
            const i = instIdx[k];
            const cell = st.board[i];
            ais[0].institutions.push({ cellIndex: i, level: cell.tier||0,
              mortgaged: false, mortgageAmount: 0 });
            cell.owner = st.players.indexOf(ais[0]);
          });
          const tl = g.tiles || (g.renderer && g.renderer.tiles) || g.tileLayer;
          if (tl && tl._render) tl._render(st);
          g.updateHUD();
        }""")
        await page.wait_for_timeout(900)

        # ---------- ① 整屏 ----------
        await page.screenshot(path=os.path.join(SHOT_DIR, "hud2-full.png"))
        print("hud2-full.png")

        # ---------- ② Tab 面板展开（切到「我的机构」）----------
        await page.evaluate("""() => {
          const b = document.getElementById('tab-btn-inst');
          if (b) b.click();
        }""")
        await page.wait_for_timeout(500)
        # 只截 Tab 面板本身（竖栏上段的 tab + 面板区），不要把整条竖栏拉长
        tabs = await page.query_selector("#hud-tabs")
        if tabs:
            tb = await tabs.bounding_box()
            if tb:
                await page.screenshot(
                    path=os.path.join(SHOT_DIR, "hud2-tabs.png"),
                    clip={"x": tb["x"], "y": tb["y"],
                          "width": tb["width"], "height": min(tb["height"], 560)},
                )
        print("hud2-tabs.png")

        # ---------- ③ 背景细节（棋盘外的天空区域）----------
        await page.screenshot(path=os.path.join(SHOT_DIR, "hud2-bg.png"),
                              clip={"x": 284, "y": 12, "width": 1334, "height": 220})
        print("hud2-bg.png")

        # ---------- ④ 转盘弹窗 ----------
        await page.evaluate("""() => {
          const g = window.__game;
          const st = g.state;
          const human = st.players.find(p => !p.isAI);
          let wheelIdx = -1;
          for (let i = 0; i < st.board.length; i++) {
            const c = st.board[i];
            if (c && c.type === 'special' && c.special && c.special.kind === 'wheel') { wheelIdx = i; break; }
          }
          st.currentPlayerIndex = st.players.indexOf(human);
          human.position = wheelIdx;
          st.phase = 'await-roll';
          g.busy = false;
          g.triggerWheelCell(wheelIdx);
        }""")
        await page.wait_for_timeout(1200)
        await page.screenshot(path=os.path.join(SHOT_DIR, "hud2-wheel.png"))
        print("hud2-wheel.png")

        # ---------- ⑤ 地块特写（持有人真名）----------
        await page.evaluate("""() => {
          const r = document.getElementById('modal-root');
          if (r) r.hidden = true;
        }""")
        await page.wait_for_timeout(400)
        # 只截左上角 4×3 格 —— 那里有持有人真名，最能说明问题
        await page.screenshot(path=os.path.join(SHOT_DIR, "hud2-tiles.png"),
                              clip={"x": 284, "y": 12, "width": 760, "height": 470})
        print("hud2-tiles.png")

        await browser.close()


asyncio.run(main())
