#!/usr/bin/env python3
"""
「我的机构」tab 排版体检 —— 在 1280×720（--left-panel-w: 236px 断点）下
逐项检查上下两段的高度、滚动与溢出情况。

用法：python tools/check_cashflow_layout.py
"""
import asyncio
import http.server
import json
import os
import sys
import threading

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8793

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


LAYOUT_JS = """() => {
  const panel = document.getElementById('tab-panel-inst');
  const top = panel.querySelector('.tab-split-top');
  const bottom = panel.querySelector('.tab-split-bottom');
  const list = panel.querySelector('.cf-list');
  const rows = [...panel.querySelectorAll('.cf-row')];
  const t = top.getBoundingClientRect();
  const b = bottom.getBoundingClientRect();
  const p = panel.getBoundingClientRect();
  const l = list.getBoundingClientRect();
  const hud = document.getElementById('hud-left').getBoundingClientRect();
  const board = document.querySelector('.board-wrap').getBoundingClientRect();
  const cs = getComputedStyle;
  return {
    leftPanelW: Math.round(hud.width),
    boardLeft: Math.round(board.left),
    panel: { top: Math.round(p.top), bottom: Math.round(p.bottom), h: Math.round(p.height) },
    top: { top: Math.round(t.top), bottom: Math.round(t.bottom), h: Math.round(t.height),
           scrollH: top.scrollHeight, clientH: top.clientHeight },
    bottom: { top: Math.round(b.top), bottom: Math.round(b.bottom), h: Math.round(b.height),
              scrollH: bottom.scrollHeight, clientH: bottom.clientHeight },
    list: { top: Math.round(l.top), bottom: Math.round(l.bottom), h: Math.round(l.height),
            scrollH: list.scrollHeight, clientH: list.clientHeight,
            overflowY: cs(list).overflowY },
    rowCount: rows.length,
    // 越界检查：上下两段必须都落在 panel 内部
    topOverflow: t.bottom > p.bottom + 1,
    bottomOverflow: b.bottom > p.bottom + 1,
    hudOverflow: Math.round(b.bottom) > Math.round(hud.bottom) + 1,
    boardOverlap: Math.round(hud.right) > Math.round(board.left) + 1,
    fontFamily: rows.length ? cs(rows[0]).fontFamily : null,
  };
}"""

COLORS_JS = """() => {
  const rows = [...document.querySelectorAll('#tab-panel-inst .cf-row')];
  const pick = (cls) => {
    const r = rows.find(x => x.classList.contains(cls));
    if (!r) return null;
    const a = r.querySelector('.cf-amt');
    return { amount: a.textContent, color: getComputedStyle(a).color,
             reason: r.querySelector('.cf-reason').textContent };
  };
  return { in: pick('is-in'), out: pick('is-out') };
}"""


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

            for _ in range(400):
                picked = await page.evaluate("""() => {
                  const roots=[...document.querySelectorAll('.modal-root:not([hidden])')];
                  for (const r of roots) {
                    const btns=[...r.querySelectorAll('button')].filter(b =>
                      b.offsetParent!==null && !b.disabled);
                    if (!btns.length) continue;
                    const pri=btns.find(b=>/买入|购买|确认|确定|继续|支付|升级|跟注|过牌|弃牌/.test(b.textContent))
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
                rolled = await page.evaluate("""() => {
                  const g=window.__game, s=g&&g.state;
                  const pl=s && s.players[s.currentPlayerIndex];
                  const b=document.getElementById('btn-roll');
                  if (!pl || pl.isAI || pl.bankrupt || g.busy || !b || b.disabled) return false;
                  b.click(); return true;
                }""")
                if rolled:
                    await page.wait_for_timeout(1100)
                    continue
                ended = await page.evaluate("""() => {
                  const b=document.getElementById('btn-endturn');
                  if (!b || b.disabled || b.offsetParent===null) return false;
                  b.click(); return true;
                }""")
                if ended:
                    await page.wait_for_timeout(550)
                    continue
                await page.wait_for_timeout(250)

            await page.evaluate("""() => {
              const b=document.getElementById('tab-btn-inst');
              if (b) b.click();
            }""")
            await page.wait_for_timeout(600)

            layout = await page.evaluate(LAYOUT_JS)
            colors = await page.evaluate(COLORS_JS)
            await browser.close()
    finally:
        httpd.shutdown()

    print("=" * 70)
    print("排版体检（1280×720 → 左栏 236px 断点）")
    print("=" * 70)
    print(json.dumps({"layout": layout, "colors": colors},
                     ensure_ascii=False, indent=1))

    fails = []
    if layout["leftPanelW"] != 236:
        fails.append(f"左栏宽度不是 236px，而是 {layout['leftPanelW']}")
    if layout["topOverflow"]:
        fails.append("上半段溢出 panel")
    if layout["bottomOverflow"]:
        fails.append("下半段溢出 panel")
    if layout["hudOverflow"]:
        fails.append("下半段溢出左栏（会压到棋盘）")
    if layout["boardOverlap"]:
        fails.append("左栏右边界压到棋盘")
    if layout["rowCount"] <= 0:
        fails.append("没有流水条目")
    if layout["list"]["overflowY"] != "auto":
        fails.append(f"流水列表不是可滚动的（overflow-y={layout['list']['overflowY']}）")
    # --font-ui 解析后就是「微软雅黑 / PingFang SC / …」这套栈，
    # 断言用解析后的实际字体而不是 var() 字面量。
    expected_fonts = ("Microsoft YaHei", "PingFang SC")
    if not any(f in (layout["fontFamily"] or "") for f in expected_fonts):
        fails.append(f"流水条目字体不是 var(--font-ui)：{layout['fontFamily']}")
    if colors.get("in") and colors.get("out"):
        if colors["in"]["color"] == colors["out"]["color"]:
            fails.append("收入与支出颜色相同 —— 语义色没生效")

    print()
    if fails:
        for f in fails:
            print(f"[FAIL] {f}")
        print("结果：存在失败项")
        return 1
    print("[PASS] 上下两段都在左栏内，未溢出棋盘区域")
    print(f"[PASS] 左栏宽度 {layout['leftPanelW']}px（符合断点预期）")
    print(f"[PASS] 流水列表可滚动（{layout['list']['scrollH']}px 内容 / "
          f"{layout['list']['clientH']}px 视口）")
    print(f"[PASS] 收支语义色生效：收入 {colors.get('in')} / 支出 {colors.get('out')}")
    print("结果：全部通过 ✓")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
