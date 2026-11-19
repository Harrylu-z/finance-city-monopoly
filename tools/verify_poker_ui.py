#!/usr/bin/env python3
"""
扑克 UI 增强（P1-16 / P1-17）—— 端到端验证。

验证内容：
  1. 牌力提示存在且显示牌型 / 强度
  2. 加注滑杆 + 数字输入存在且双向联动
  3. 底池赔率显示
  4. 全下需要二次确认（点一次不直接结算）
  5. 确认后正常全下
  6. 无 JS 运行时错误

用法：
    python tools/verify_poker_ui.py
"""

import http.server
import json
import os
import sys
import threading

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8825
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


JS = r"""
async () => {
  const pk = await import('/src/core/poker.js');
  const ui = await import('/src/app/poker-ui.js');

  const game = pk.createPokerGame({
    players: [
      { id: 0, name: '你', isAI: false, colorIndex: 0, avatar: 7, cash: 1000 },
      { id: 1, name: 'A1', isAI: true, colorIndex: 1, avatar: 8, cash: 1000 },
      { id: 2, name: 'A2', isAI: true, colorIndex: 2, avatar: 9, cash: 1000 },
    ],
    seed: 'poker-ui-test',
  });

  ui.showPokerTable({
    game,
    viewerId: 0,
    onFinish: () => {},
    onExit: () => {},
  });

  // ⚠ 盲注后可能先轮到 AI —— 等到**人类回合**再断言操作区。
  const waitViewer = async () => {
    for (let i = 0; i < 60; i++) {
      const a = pk.currentActor(game);
      if (a >= 0 && game.seats[a].playerId === 0) return true;
      await new Promise(r => setTimeout(r, 120));
    }
    return false;
  };
  const gotViewerTurn = await waitViewer();
  await new Promise(r => setTimeout(r, 200));

  const box = document.getElementById('poker-box');
  const q = (s) => box.querySelector(s);
  const out = {
    gotViewerTurn,
    hasHandHint: !!q('.poker-hand-hint'),
    handHintText: q('.poker-hand-hint') ? q('.poker-hand-hint').textContent : '',
    hasBar: !!q('.poker-hand-bar'),
    hasFill: !!q('.poker-hand-fill'),
    fillWidth: q('.poker-hand-fill') ? q('.poker-hand-fill').style.width : '',
    hasBetBox: !!q('.poker-bet-box'),
    hasSlider: !!q('.poker-bet-slider'),
    hasNumber: !!q('.poker-bet-number'),
    hasOdds: !!q('.poker-odds-item'),
    oddsText: Array.from(box.querySelectorAll('.poker-odds-item'))
      .map(e => e.textContent).join(' | '),
    hasAllinBtn: !!q('.poker-btn-allin'),
    actions: Array.from(box.querySelectorAll('.poker-btn')).map(b => b.textContent.trim()),
    street: game.street,
    pot: game.pot,
    viewerSeat: game.seats.findIndex(s => s.playerId === 0),
  };

  const range = q('.poker-bet-slider');
  const num = q('.poker-bet-number');
  if (range && num) {
    range.value = String(Number(range.max));
    range.dispatchEvent(new Event('input', { bubbles: true }));
    out.afterRangeMax = num.value;
    out.rangeMax = range.max;
    num.value = String(Number(range.min));
    num.dispatchEvent(new Event('input', { bubbles: true }));
    out.afterNumMin = range.value;
    out.rangeMin = range.min;
    const cf = Array.from(box.querySelectorAll('.poker-btn'))
      .find(b => b.textContent.includes('确认加注'));
    out.confirmText = cf ? cf.textContent : '';
  }

  const stackBefore = game.seats[out.viewerSeat].stack;
  const allinBtn = q('.poker-btn-allin');
  if (allinBtn) {
    allinBtn.click();
    await new Promise(r => setTimeout(r, 150));
    out.hasConfirmBar = !!q('.poker-allin-confirm');
    out.stackAfterFirstClick = game.seats[out.viewerSeat].stack;
    out.allInNotYetApplied = out.stackAfterFirstClick === stackBefore;
    const okBtn = Array.from(box.querySelectorAll('.poker-allin-confirm .poker-btn'))
      .find(b => b.textContent.includes('确认全下'));
    out.hasConfirmBtn = !!okBtn;
    if (okBtn) {
      okBtn.click();
      await new Promise(r => setTimeout(r, 250));
    }
    out.stackAfterConfirm = game.seats[out.viewerSeat].stack;
    out.allInApplied = out.stackAfterConfirm < stackBefore
      || game.seats[out.viewerSeat].allIn === true;
  }
  return out;
}
"""


def main():
    chrome = find_chrome()
    if not chrome:
        print("[FAIL] 找不到 Chrome / Edge")
        return 2

    from playwright.sync_api import sync_playwright

    httpd = serve()
    url = f"http://127.0.0.1:{PORT}/index.html"
    failures = []

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
            page = browser.new_page(viewport={"width": 1440, "height": 900})
            errors = []
            page.on("pageerror", lambda e: errors.append("PAGEERROR " + str(e)))
            page.on(
                "console",
                lambda m: errors.append("CONSOLE " + m.text) if m.type == "error" else None,
            )
            page.goto(url, wait_until="networkidle")
            page.wait_for_timeout(400)

            info = page.evaluate(JS)
            print(json.dumps(info, ensure_ascii=False, indent=2))

            check("牌力提示存在", info["hasHandHint"])
            check("牌力提示含牌型 / 强度文案",
                  ("%" in info["handHintText"]) and len(info["handHintText"]) > 6,
                  info["handHintText"].strip()[:70])
            check("牌力强度条存在", info["hasBar"] and info["hasFill"],
                  f"填充宽度 = {info['fillWidth']}")

            check("加注滑杆存在", info["hasSlider"])
            check("加注数字输入存在", info["hasNumber"])
            check("滑杆 → 数字 联动",
                  info.get("afterRangeMax") == info.get("rangeMax"),
                  f"拖到 max={info.get('rangeMax')} → 数字框 = {info.get('afterRangeMax')}")
            check("数字 → 滑杆 联动",
                  info.get("afterNumMin") == info.get("rangeMin"),
                  f"输入 min={info.get('rangeMin')} → 滑杆 = {info.get('afterNumMin')}")
            check("确认按钮文案跟随金额变化",
                  "确认加注" in (info.get("confirmText") or ""),
                  info.get("confirmText"))

            check("底池赔率显示", info["hasOdds"] and "%" in info["oddsText"],
                  info["oddsText"])

            check("全下按钮存在", info["hasAllinBtn"])
            check("全下需要二次确认（首次点击不结算）",
                  info.get("hasConfirmBar") is True
                  and info.get("allInNotYetApplied") is True,
                  f"确认条={info.get('hasConfirmBar')} "
                  f"筹码 {info.get('stackAfterFirstClick')}")
            check("有「确认全下」按钮", info.get("hasConfirmBtn") is True)
            check("确认后全下生效",
                  info.get("allInApplied") is True,
                  f"筹码 {info.get('stackAfterFirstClick')} → {info.get('stackAfterConfirm')}")

            check("无 JS 运行时错误", not errors, str(errors[:3]))

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
