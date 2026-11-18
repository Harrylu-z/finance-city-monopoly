#!/usr/bin/env python3
"""
「我的机构」tab 左栏局部截图 —— 用于人工核对上下两段的视觉排版。

用法：python tools/shoot_cashflow.py
"""
import asyncio
import http.server
import os
import sys
import threading

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8792

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
    await page.wait_for_timeout(600)


async def main():
    chrome = find_chrome()
    if not chrome:
        print("[FAIL] 找不到 Chrome")
        return 2

    from playwright.async_api import async_playwright

    httpd = serve()
    url = f"http://127.0.0.1:{PORT}/index.html"
    out = os.path.join(ROOT, "tools", "shots", "hud-cashflow-tab.png")

    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(
                executable_path=chrome, headless=True,
                args=["--disable-gpu", "--no-sandbox"],
            )
            # 1280×720 → 触发 --left-panel-w: 236px 的断点
            page = await browser.new_page(viewport={"width": 1280, "height": 720})
            await page.goto(url, wait_until="load")
            await page.wait_for_timeout(400)
            await dismiss(page)

            # 走 16 回合，让流水条数足够多
            for _ in range(400):
                picked = await page.evaluate("""() => {
                  const roots=[...document.querySelectorAll('.modal-root:not([hidden])')];
                  for (const r of roots) {
                    const btns=[...r.querySelectorAll('button')].filter(b =>
                      b.offsetParent!==null && !b.disabled);
                    if (!btns.length) continue;
                    const pri=btns.find(b=>/买入|购买|确认|确定|继续|支付|升级/.test(b.textContent))
                            || btns.find(b=>/放弃|跳过|取消/.test(b.textContent))
                            || btns[0];
                    pri.click(); return true;
                  }
                  return false;
                }""")
                if picked:
                    await page.wait_for_timeout(320)
                    continue
                turn = await page.evaluate(
                    "() => (window.__game && window.__game.state) ? window.__game.state.turnNumber : -1")
                if turn >= 16:
                    break
                roll_ok = await page.evaluate("""() => {
                  const g=window.__game, s=g&&g.state;
                  const pl=s && s.players[s.currentPlayerIndex];
                  const b=document.getElementById('btn-roll');
                  if (!pl || pl.isAI || pl.bankrupt || g.busy || !b || b.disabled) return false;
                  // 弹窗打开时按钮点不动 —— 先关掉弹窗再掷骰
                  const roots=[...document.querySelectorAll('.modal-root:not([hidden])')];
                  for (const r of roots) {
                    const btns=[...r.querySelectorAll('button')].filter(x =>
                      x.offsetParent!==null && !x.disabled);
                    if (!btns.length) continue;
                    const pri=btns.find(x=>/买入|购买|确认|确定|继续|支付|升级/.test(x.textContent))
                            || btns.find(x=>/放弃|跳过|取消/.test(x.textContent))
                            || btns[0];
                    pri.click();
                  }
                  return true;
                }""")
                if roll_ok:
                    await page.wait_for_timeout(700)
                    await page.click("#btn-roll", timeout=8000)
                    await page.wait_for_timeout(1100)
                    continue
                end_ok = await page.evaluate("""() => {
                  const b=document.getElementById('btn-endturn');
                  return !!(b && !b.disabled && b.offsetParent!==null);
                }""")
                if end_ok:
                    await page.click("#btn-endturn")
                    await page.wait_for_timeout(550)
                    continue
                await page.wait_for_timeout(250)

            await page.evaluate("""() => {
              const b=document.getElementById('tab-btn-inst');
              if (b) b.click();
            }""")
            await page.wait_for_timeout(600)

            el = await page.query_selector("#hud-left")
            if el:
                await el.screenshot(path=out)
                print(f"[OK] 已保存 {out}")
            else:
                await page.screenshot(path=out)
                print(f"[OK] 已保存整页 {out}")
            await browser.close()
    finally:
        httpd.shutdown()
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
