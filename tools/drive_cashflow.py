#!/usr/bin/env python3
"""驱动游戏多回合，验证「我的机构」tab 资金流水是否正确生成。"""
import http.server
import json
import os
import threading

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8810
CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"

CLICK = """() => {
  const all = [...document.querySelectorAll('button')]
      .filter(x => x.offsetParent !== null && !x.disabled);
  const buy = all.find(x => /确认收购/.test(x.textContent));
  if (buy) { buy.click(); return 'buy'; }
  const end = all.find(x => x.textContent.trim() === '结束回合');
  if (end) { end.click(); return 'end'; }
  return 'none';
}"""

DUMP = """() => {
  const g = window.__game || window.game;
  const me = g.state.players[0];
  return JSON.stringify({
    cash: me.cash,
    insts: me.institutions.map(i => i.cellIndex),
    flowLen: (me.cashFlow || []).length,
    flow: (me.cashFlow || []).map(f => `${f.tag} | ${f.reason} | ${f.amount}`),
    rows: document.querySelectorAll('.cf-row').length,
    cfText: (document.querySelector('.cf-list') || {textContent:''}).textContent
             .replace(/\\s+/g, ' ').trim().slice(0, 400),
  });
}"""


class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=ROOT, **k)

    def log_message(self, *a):
        pass


def main():
    from playwright.sync_api import sync_playwright

    http.server.ThreadingHTTPServer.allow_reuse_address = True
    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), H)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()

    try:
        with sync_playwright() as p:
            b = p.chromium.launch(
                executable_path=CHROME,
                headless=True,
                args=["--disable-gpu", "--no-sandbox"],
            )
            pg = b.new_page(viewport={"width": 1440, "height": 900})
            errs = []
            pg.on("pageerror", lambda e: errs.append(str(e)))
            pg.goto(f"http://127.0.0.1:{PORT}/index.html", wait_until="networkidle")
            pg.wait_for_timeout(400)

            pg.evaluate("""() => {
                const b = [...document.querySelectorAll('button')]
                    .find(x => x.textContent.trim() === '开局');
                if (b) b.click();
            }""")
            pg.wait_for_timeout(900)

            for _ in range(8):
                acted = pg.evaluate("""() => {
                    const vis = b => b && b.offsetParent !== null && !b.disabled;
                    const s = [...document.querySelectorAll('button')]
                        .find(x => vis(x) && x.textContent.trim() === '跳过教学');
                    if (s) { s.click(); return 1; }
                    const n = [...document.querySelectorAll('button')]
                        .find(x => vis(x) && x.textContent.trim() === '下一步');
                    if (n) { n.click(); return 1; }
                    return 0;
                }""")
                if not acted:
                    break
                pg.wait_for_timeout(280)

            for _ in range(14):
                pg.evaluate(CLICK)
                pg.wait_for_timeout(450)
                pg.evaluate("""() => {
                    const g = window.__game || window.game;
                    if (g.state.phase === 'await-roll') g.handleRoll();
                }""")
                pg.wait_for_timeout(1500)
                pg.evaluate(CLICK)
                pg.wait_for_timeout(500)
                pg.evaluate(CLICK)
                pg.wait_for_timeout(500)

            # 确定性驱动：把玩家放到会触发交易的格子上，
            # 避免骰子随机导致「本回合无资金变动」而采集不到流水。
            SEED = """() => {
              const g = window.__game || window.game;
              const me = g.state.players[0];
              // 找一个无主机构格，让玩家踩上去必定弹出收购要约
              const inst = g.state.board.findIndex(c => c && c.type === 'institution');
              if (inst >= 0) me.position = (inst - 1 + g.state.board.length) % g.state.board.length;
              return inst;
            }"""
            for _ in range(6):
                pg.evaluate(SEED)
                pg.wait_for_timeout(200)
                pg.evaluate(CLICK)
                pg.wait_for_timeout(1400)
                pg.evaluate(CLICK)
                pg.wait_for_timeout(500)
                pg.evaluate(CLICK)
                pg.wait_for_timeout(500)

            print(json.dumps(json.loads(pg.evaluate(DUMP)), ensure_ascii=False, indent=2))
            print("ERRORS:", errs[:3])

            # 截图
            out = os.path.join(ROOT, "tools", "shots")
            os.makedirs(out, exist_ok=True)
            el = pg.query_selector("#hud-left")
            if el:
                p1 = os.path.join(out, "hud-left-cashflow.png")
                el.screenshot(path=p1)
                print("左栏截图:", p1)

            b.close()
    finally:
        httpd.shutdown()


if __name__ == "__main__":
    main()
