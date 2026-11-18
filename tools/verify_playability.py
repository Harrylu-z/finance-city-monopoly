"""
8 回合可玩性验证 —— 真实点击 UI（掷骰子 / 结束回合 / 处理决策弹窗），
统计 JS 错误数。

用法：python tools/verify_playability.py
"""
import asyncio
import json
import sys

from playwright.async_api import async_playwright

CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
URL = "http://127.0.0.1:8000/"


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


STATE_JS = """() => {
  const g = window.__game;
  if (!g || !g.state) return null;
  const s = g.state;
  const p = s.players[s.currentPlayerIndex];
  const roll = document.getElementById('btn-roll');
  const end = document.getElementById('btn-endturn');
  return {
    phase: s.phase, round: s.round, turn: s.turn,
    cur: s.currentPlayerIndex, isAI: p ? p.isAI : null,
    busy: g.busy,
    rollOk: !!roll && !roll.disabled && roll.offsetParent !== null,
    endOk: !!end && !end.disabled && end.offsetParent !== null,
  };
}"""

FINAL_JS = """() => {
  const g = window.__game;
  const s = g && g.state;
  return s ? {
    phase: s.phase, round: s.round,
    positions: s.players.map(p => p.position),
    cash: s.players.map(p => p.cash),
    institutions: s.players.map(p => p.institutions.length),
    logCount: s.log.length,
  } : null;
}"""


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(executable_path=CHROME, headless=True)
        page = await browser.new_page(viewport={"width": 1440, "height": 900})
        page_errors = []
        page.on("pageerror", lambda e: page_errors.append("pageerror: " + str(e)))
        page.on("console", lambda m: page_errors.append("console.error: " + m.text)
                if m.type == "error" and "favicon" not in m.text.lower() else None)
        await page.goto(URL, wait_until="load")
        await dismiss(page)

        rounds = 0
        roll_clicks = 0
        end_clicks = 0
        decision_clicks = 0
        seen_turn = set()
        target_rounds = 8

        for step in range(900):
            # decision dialog first
            picked_idx = await page.evaluate("""() => {
              const roots=[...document.querySelectorAll('.modal-root:not([hidden])')];
              for(const r of roots){
                const btns=[...r.querySelectorAll('button')].filter(b =>
                  b.offsetParent!==null && !b.disabled);
                if(!btns.length) continue;
                const pri=btns.find(b=>/买入|购买|确认|确定|继续|支付|升级/.test(b.textContent))
                        || btns.find(b=>/放弃|跳过|取消/.test(b.textContent))
                        || btns[0];
                pri.click();
                return true;
              }
              return false;
            }""")
            if picked_idx:
                decision_clicks += 1
                await page.wait_for_timeout(400)
                continue

            info = await page.evaluate(STATE_JS)
            if info is None:
                break
            if info["phase"] == "gameover":
                break

            key = (info["round"], info["cur"], info["turn"])
            if key not in seen_turn:
                seen_turn.add(key)
                if len(seen_turn) > 1:
                    rounds += 1
            if rounds >= target_rounds:
                break

            if (not info["isAI"]) and info["rollOk"]:
                await page.click("#btn-roll")
                roll_clicks += 1
                await page.wait_for_timeout(1500)
                continue
            if (not info["isAI"]) and info["endOk"]:
                await page.click("#btn-endturn")
                end_clicks += 1
                await page.wait_for_timeout(700)
                continue
            await page.wait_for_timeout(300)

        final = await page.evaluate(FINAL_JS)
        res = {
            "rounds": rounds,
            "rollClicks": roll_clicks,
            "endClicks": end_clicks,
            "decisionClicks": decision_clicks,
            "jsErrors": page_errors,
            "final": final,
        }
        print(json.dumps(res, ensure_ascii=False, indent=1))
        await browser.close()

    print(f"\nplayability: rounds={res['rounds']} roll={res['rollClicks']} "
          f"end={res['endClicks']} decision={res['decisionClicks']} "
          f"jsErrors={len(res['jsErrors'])}")
    return 0 if not res["jsErrors"] else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
