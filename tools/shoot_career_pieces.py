#!/usr/bin/env python3
"""
职业棋子对照图 —— 验证「每个职业有可辨识的立体棋子」。

用法：
    python tools/shoot_career_pieces.py

做法：直接调 renderer.careerPieces.draw() 把 7 个职业画到一张
      独立画布上，再截图 —— 排除棋盘布局的干扰，专看造型。
"""

import http.server
import os
import sys
import threading

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8823
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
() => {
  return import('/src/render/careerPiece.js').then((m) => {
    const { CareerPieceRenderer } = m;
    const COLORS = [
      { main: '#d98b1f', lt: '#ffc861', dk: '#8d5c0f' },
      { main: '#159e9e', lt: '#63e0e0', dk: '#0b6363' },
      { main: '#d4453a', lt: '#ff8a80', dk: '#8a241c' },
      { main: '#8b5cc7', lt: '#b189e0', dk: '#5c3a86' },
    ];
    const names = ['投行家', '风控总监', '精算师', '量化研究员', '基金经理', '交易员', '赌王'];

    const W = 7 * 130;
    const H = 300;
    const cv = document.createElement('canvas');
    cv.id = 'sheet';
    cv.width = W;
    cv.height = H;
    cv.style.cssText = 'position:fixed;left:0;top:0;z-index:99999;'
      + 'width:' + W + 'px;height:' + H + 'px;background:#f4ecdb;';
    document.body.appendChild(cv);
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#f4ecdb';
    ctx.fillRect(0, 0, W, H);

    const r = new CareerPieceRenderer();
    for (let i = 0; i < 7; i++) {
      const idx = 7 + i;
      const col = COLORS[i % 4];
      const cx = 65 + i * 130;
      const cy = 210;
      ctx.strokeStyle = 'rgba(0,0,0,.08)';
      ctx.beginPath();
      ctx.moveTo(cx - 55, cy); ctx.lineTo(cx + 55, cy);
      ctx.stroke();
      r.draw(ctx, {
        cx: cx, cy: cy, s: 3.2,
        color: col.main, colorLt: col.lt, colorDk: col.dk,
        pieceIndex: idx,
        isCurrent: i === 0,
        isAI: i % 2 === 1,
        time: 0,
        flat: false,
      });
      ctx.fillStyle = '#2a2418';
      ctx.font = 'bold 20px "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(names[i], cx, cy + 42);
      ctx.font = '14px Consolas, monospace';
      ctx.fillStyle = '#7a6b53';
      ctx.fillText('piece ' + idx, cx, cy + 62);
    }
    return { w: W, h: H };
  });
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
    shots = os.path.join(ROOT, "tools", "shots")
    os.makedirs(shots, exist_ok=True)

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(
                executable_path=chrome,
                headless=True,
                args=["--disable-gpu", "--no-sandbox"],
            )
            page = browser.new_page(viewport={"width": 1000, "height": 400},
                                    device_scale_factor=2)
            page.goto(url, wait_until="networkidle")
            page.wait_for_timeout(500)

            page.evaluate(JS)
            page.wait_for_timeout(500)

            p1 = os.path.join(shots, "career-pieces-flat.png")
            page.locator("#sheet").screenshot(path=p1)
            print("截图:", p1)

            browser.close()
    finally:
        httpd.shutdown()

    print("完成 ✓")
    return 0


if __name__ == "__main__":
    sys.exit(main())
