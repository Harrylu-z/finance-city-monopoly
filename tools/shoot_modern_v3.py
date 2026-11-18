"""
生成验收截图（device_scale_factor=3，跳过教学）：
  mod-board-v3.png  整块棋盘
  mod-hud-v3.png    整屏
  mod-reg-v3.png    四个监管格特写
  mod-wheel-v3.png  转盘格特写

用法：python tools/shoot_modern_v3.py
"""
import asyncio
import os

from playwright.async_api import async_playwright

CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
URL = "http://127.0.0.1:8000/"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOT_DIR = os.path.join(ROOT, "design-proposals", "maps", "shots")


async def dismiss(page):
    await page.wait_for_timeout(800)
    start = await page.query_selector("#btn-start")
    if start:
        await start.click()
        await page.wait_for_timeout(1200)
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
    await page.wait_for_timeout(800)


async def main():
    os.makedirs(SHOT_DIR, exist_ok=True)
    async with async_playwright() as p:
        browser = await p.chromium.launch(executable_path=CHROME, headless=True)
        page = await browser.new_page(viewport={"width": 2560, "height": 1440},
                                      device_scale_factor=3)
        await page.goto(URL, wait_until="load")
        await dismiss(page)

        # ① 整块棋盘
        wrap = page.locator("#board-wrap")
        await wrap.screenshot(path=os.path.join(SHOT_DIR, "mod-board-v3.png"))

        # ② 整屏
        await page.screenshot(path=os.path.join(SHOT_DIR, "mod-hud-v3.png"))

        # ③ 四个监管格特写
        box = await page.evaluate("""() => {
          const cells=[...document.querySelectorAll('.mt-cell')];
          const regs=cells.filter(c=>c.querySelector('.mt-reg-scene'));
          if(!regs.length) return null;
          let x1=Infinity,y1=Infinity,x2=-Infinity,y2=-Infinity;
          for(const c of regs){const r=c.getBoundingClientRect();
            x1=Math.min(x1,r.left);y1=Math.min(y1,r.top);
            x2=Math.max(x2,r.right);y2=Math.max(y2,r.bottom);}
          const pad=14;
          const x=Math.max(0,x1-pad), y=Math.max(0,y1-pad);
          return {x:x,y:y,
                  width:Math.min(innerWidth,x2+pad)-x,
                  height:Math.min(innerHeight,y2+pad)-y};
        }""")
        if box:
            await page.screenshot(path=os.path.join(SHOT_DIR, "mod-reg-v3.png"), clip=box)

        # ④ 转盘格特写
        box2 = await page.evaluate("""() => {
          const cells=[...document.querySelectorAll('.mt-cell')];
          const wh=cells.filter(c=>c.querySelector('.mt-d2-sp-list'));
          if(!wh.length) return null;
          let x1=Infinity,y1=Infinity,x2=-Infinity,y2=-Infinity;
          for(const c of wh){const r=c.getBoundingClientRect();
            x1=Math.min(x1,r.left);y1=Math.min(y1,r.top);
            x2=Math.max(x2,r.right);y2=Math.max(y2,r.bottom);}
          const pad=14;
          const x=Math.max(0,x1-pad), y=Math.max(0,y1-pad);
          return {x:x,y:y,
                  width:Math.min(innerWidth,x2+pad)-x,
                  height:Math.min(innerHeight,y2+pad)-y};
        }""")
        if box2:
            await page.screenshot(path=os.path.join(SHOT_DIR, "mod-wheel-v3.png"), clip=box2)

        await browser.close()
    for f in ("mod-board-v3.png", "mod-hud-v3.png", "mod-reg-v3.png", "mod-wheel-v3.png"):
        p = os.path.join(SHOT_DIR, f)
        print(f, os.path.getsize(p) if os.path.exists(p) else "MISSING")


asyncio.run(main())
