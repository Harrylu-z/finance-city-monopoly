#!/usr/bin/env python3
"""
职业棋子 —— 像素级形体检索。

不依赖人眼看图，直接对渲染结果做**可断言的测量**：
  · 每个职业的剪影包围盒（宽 / 高 / 面积）
  · 台座厚度（3D 下侧壁是否存在）
  · 剪影两两不同
  · 头饰区域是否有内容（顶部非空）

用法：
    python tools/verify_career_pieces.py
"""

import http.server
import json
import os
import sys
import threading

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8824
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
  const m = await import('/src/render/careerPiece.js');
  const { CareerPieceRenderer, pieceOf } = m;
  const COLORS = [
    { main: '#d98b1f', lt: '#ffc861', dk: '#8d5c0f' },
    { main: '#159e9e', lt: '#63e0e0', dk: '#0b6363' },
    { main: '#d4453a', lt: '#ff8a80', dk: '#8a241c' },
    { main: '#8b5cc7', lt: '#b189e0', dk: '#5c3a86' },
  ];
  const W = 200, H = 200;

  function measure(idx, flat) {
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    const r = new CareerPieceRenderer();
    const col = COLORS[0];
    r.draw(ctx, {
      cx: 100, cy: 160, s: 3,
      color: col.main, colorLt: col.lt, colorDk: col.dk,
      pieceIndex: idx, isCurrent: false, isAI: false, time: 0, flat: !!flat,
    });
    const d = ctx.getImageData(0, 0, W, H).data;
    let minX = 1e9, maxX = -1, minY = 1e9, maxY = -1, area = 0;
    // 逐行统计 —— 用于判断「杆身宽度曲线」
    const rowMin = [], rowMax = [];
    for (let y = 0; y < H; y++) {
      let rm = -1, rx = -1;
      for (let x = 0; x < W; x++) {
        if (d[(y * W + x) * 4 + 3] > 40) {
          area++;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
          if (rm < 0) rm = x;
          rx = x;
        }
      }
      rowMin.push(rm); rowMax.push(rx);
    }
    // 台座厚度：取底部区域（脚底往上 0~8px）的行宽是否明显大于上行
    const bottomRows = [];
    for (let y = Math.max(0, maxY - 8); y <= maxY; y++) {
      if (rowMax[y] >= 0) bottomRows.push(rowMax[y] - rowMin[y]);
    }
    const maxBottom = bottomRows.length ? Math.max(...bottomRows) : 0;
    // 顶部 12px 是否为空（头饰是否有内容）
    let topHas = 0;
    for (let y = minY; y < minY + 12 && y < H; y++) {
      if (rowMax[y] >= 0) topHas++;
    }
    return {
      idx, name: pieceOf(idx).name, flat: !!flat,
      w: maxX - minX, h: maxY - minY, area,
      maxBottomWidth: maxBottom, topRows: topHas,
      // 剪影签名：按行宽分 16 段
      sig: (() => {
        const out = [];
        for (let k = 0; k < 16; k++) {
          const y = Math.round(minY + (maxY - minY) * (k + 0.5) / 16);
          out.push(rowMax[y] >= 0 ? (rowMax[y] - rowMin[y]) : 0);
        }
        return out.join(',');
      })(),
    };
  }

  const out = [];
  for (let i = 7; i <= 13; i++) {
    out.push(measure(i, false));
    out.push(measure(i, true));
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
            page = browser.new_page(viewport={"width": 800, "height": 600})
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.goto(url, wait_until="networkidle")
            page.wait_for_timeout(400)

            rows = page.evaluate(JS)
            flats = [r for r in rows if not r["flat"]]
            threes = [r for r in rows if r["flat"]]

            print("=== 平面模式测量 ===")
            for r in flats:
                print(f"  {r['name']:<8} 宽={r['w']:>3} 高={r['h']:>3} "
                      f"面积={r['area']:>5} 底宽={r['maxBottomWidth']:>3} "
                      f"顶部行数={r['topRows']}")

            print()
            print("=== 3D 模式测量 ===")
            for r in threes:
                print(f"  {r['name']:<8} 宽={r['w']:>3} 高={r['h']:>3} "
                      f"面积={r['area']:>5} 底宽={r['maxBottomWidth']:>3} "
                      f"顶部行数={r['topRows']}")

            print()
            # ---- 断言 ----
            check("7 个职业全部渲染出内容",
                  all(r["area"] > 800 for r in flats),
                  f"最小面积 = {min(r['area'] for r in flats)}")

            check("剪影签名两两不同（每个职业可辨识）",
                  len(set(r["sig"] for r in flats)) == 7,
                  f"唯一签名 {len(set(r['sig'] for r in flats))} / 7")

            widths = [r["w"] for r in flats]
            check("剪影宽度有区分度（≥4 种不同宽度）",
                  len(set(widths)) >= 4,
                  f"宽度集合 = {sorted(set(widths))}")

            heights = [r["h"] for r in flats]
            check("剪影高度有区分度（≥4 种不同高度）",
                  len(set(heights)) >= 4,
                  f"高度集合 = {sorted(set(heights))}")

            check("每个职业都有头饰（顶部区域非空）",
                  all(r["topRows"] >= 3 for r in flats),
                  f"最小顶部行数 = {min(r['topRows'] for r in flats)}")

            check("台座宽度明显大于杆身（有实体底座）",
                  all(r["maxBottomWidth"] >= 20 for r in flats),
                  f"最小底宽 = {min(r['maxBottomWidth'] for r in flats)}")

            check("3D 俯视压扁生效（高度变矮）",
                  all(t["h"] < f["h"] for t, f in zip(threes, flats)),
                  " / ".join(
                      f"{f['name']} {f['h']}→{t['h']}"
                      for t, f in zip(threes, flats)))

            check("3D 下台座仍有实体（宽度不塌陷）",
                  all(t["maxBottomWidth"] >= 20 for t in threes),
                  f"最小底宽 = {min(t['maxBottomWidth'] for t in threes)}")

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
