"""
容器查询档位重标定 —— 在不依赖 core/board.js 加载成功的前提下，
用与生产环境完全相同的 CSS（styles/tiles.css）渲染 8x6 网格的模拟地块，
实测 5 个基准视口下每个格子的实际宽高。

用法：python tools/recalibrate_tiles.py
"""
import asyncio
import json
import os
import sys

from playwright.async_api import async_playwright

CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
URL = "http://127.0.0.1:8000/"
VIEWPORTS = [(1280, 720), (1440, 900), (1600, 950), (1920, 1080), (2560, 1440)]

# 生产环境的左右让位（与 styles.css 的 --left-panel-w / --right-panel-w 一致）
LEFT_RESERVE = 264 + 12 + 8      # --left-panel-w + --sp-3 + --left-gutter
RIGHT_RESERVE = 284 + 12 + 6     # --right-panel-w + --sp-3 + 6
BOTTOM_RESERVE = 86              # 底部操作栏高度 + 间隙 + 8（经验值）

MEASURE_JS = r"""() => {
  const tiles = [...document.querySelectorAll('.mt-cell')];
  const overflow = [];
  const descOf = (el) => {
    const cls = (el.getAttribute && el.getAttribute('class')) || el.tagName.toLowerCase();
    const p = el.parentElement;
    const pcls = p && p.getAttribute && p.getAttribute('class');
    return pcls ? `${pcls} > ${cls}` : cls;
  };
  let minW = Infinity, maxW = -Infinity, minH = Infinity, maxH = -Infinity;
  const sizes = [];
  for (const cell of tiles) {
    const idx = Number(cell.dataset.index);
    const r = cell.getBoundingClientRect();
    sizes.push({ idx, w: +r.width.toFixed(2), h: +r.height.toFixed(2) });
    minW = Math.min(minW, r.width); maxW = Math.max(maxW, r.width);
    minH = Math.min(minH, r.height); maxH = Math.max(maxH, r.height);
    for (const el of [cell, ...cell.querySelectorAll('*')]) {
      const cs = getComputedStyle(el);
      if (cs.display === 'none') continue;
      if (cs.visibility === 'hidden') continue;
      const sw = el.scrollWidth, cw = el.clientWidth;
      const sh = el.scrollHeight, ch = el.clientHeight;
      if (sw > cw + 1 || sh > ch + 1) {
        overflow.push({ cell: idx, el: descOf(el), sw, cw, sh, ch,
                       overX: +(sw-cw).toFixed(1), overY: +(sh-ch).toFixed(1) });
      }
    }
  }
  const wrap = document.getElementById('board-tiles').getBoundingClientRect();
  return {
    wrapW: +wrap.width.toFixed(2), wrapH: +wrap.height.toFixed(2),
    cellMinW: +minW.toFixed(2), cellMaxW: +maxW.toFixed(2),
    cellMinH: +minH.toFixed(2), cellMaxH: +maxH.toFixed(2),
    ratio: +(maxW / maxH).toFixed(4),
    tileCount: tiles.length,
    overflowCount: overflow.length,
    overflow: overflow.slice(0, 30),
    sizes: sizes.slice(0, 3),
  };
}"""


async def main():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    with open(os.path.join(root, "styles.css"), encoding="utf-8") as f:
        base_css = f.read()
    with open(os.path.join(root, "styles", "tiles.css"), encoding="utf-8") as f:
        tiles_css = f.read()

    results = {"viewports": {}}

    async with async_playwright() as p:
        browser = await p.chromium.launch(executable_path=CHROME, headless=True)

        for vw, vh in VIEWPORTS:
            page = await browser.new_page(viewport={"width": vw, "height": vh})
            await page.goto(URL, wait_until="load")

            await page.add_style_tag(content=base_css)
            await page.add_style_tag(content=tiles_css)

            await page.evaluate(r"""() => {
              document.body.innerHTML = '';
              const app = document.createElement('div');
              app.id = 'app';
              const scr = document.createElement('section');
              scr.className = 'screen';
              const stage = document.createElement('div');
              stage.id = 'stage';
              stage.className = 'stage';
              const wrap = document.createElement('div');
              wrap.id = 'board-wrap';
              wrap.className = 'board-wrap';
              const tiles = document.createElement('div');
              tiles.id = 'board-tiles';
              tiles.className = 'board-tiles';
              wrap.appendChild(tiles);
              stage.appendChild(wrap);
              scr.appendChild(stage);
              app.appendChild(scr);
              document.body.appendChild(app);
            }""")

            gen = await page.evaluate(r"""async () => {
              const m = await import('/src/render/tiles.js');
              const bs = await import('/src/core/board.js');
              const bsShape = await import('/src/core/board-shape.js');
              const cells = bs.BOARD_CELLS;
              const root = document.getElementById('board-tiles');
              root.innerHTML = '';
              const nodes = [];
              for (let i = 0; i < cells.length; i++) {
                const cell = cells[i];
                const node = document.createElement('div');
                node.className = 'mt-cell';
                node.dataset.index = String(i);
                node.setAttribute('aria-label', cell.name);
                root.appendChild(node);
                nodes.push(node);
              }

              // ===== 严格复刻 render/canvas.js 的 computeLayout() =====
              const cols = bsShape.BOARD_GRID.cols;
              const rows = bsShape.BOARD_GRID.rows;
              const aspect = cols / rows;
              const margin = 6;
              const W = root.clientWidth;
              const H = root.clientHeight;
              const bottomReserve = window.__bottomReserve || 0;
              const availW = Math.max(80, W - margin * 2);
              const availH = Math.max(80, H - margin * 2 - bottomReserve);
              let cellW = availW / cols;
              let cellH = cellW / aspect;
              if (cellH * rows > availH) {
                cellH = availH / rows;
                cellW = cellH * aspect;
              }
              cellW = Math.max(10, cellW);
              cellH = Math.max(10, cellH);
              const boardW = cols * cellW;
              const boardH = rows * cellH;
              const boardX = (W - boardW) / 2;
              let boardY = (H - boardH) / 2;
              const maxY = H - margin - bottomReserve - boardH;
              if (boardY > maxY) boardY = maxY;
              if (boardY < margin) boardY = margin;

              // 用 TRACK_CELLS 把每格定位到正确的网格位置（同心双环，非线性）
              const trackCells = bsShape.TRACK_CELLS;
              for (let i = 0; i < nodes.length; i++) {
                const n = nodes[i];
                const tc = trackCells[i] || [i % cols, Math.floor(i / cols)];
                const col = tc[0], row = tc[1];
                n.style.left = ((boardX + col * cellW) / W * 100) + '%';
                n.style.top = ((boardY + row * cellH) / H * 100) + '%';
                n.style.width = (cellW / W * 100) + '%';
                n.style.height = (cellH / H * 100) + '%';
              }

              // ===== 用**生产路径** TileLayer._render 渲染卡面 =====
              // 构造一个最小 state：2 名玩家（人类 + AI），带真实名字与机构
              const players = [
                { id: 0, index: 0, name: '测试玩家真名超长十个字', isAI: false,
                  colorIndex: 0, cash: 5000, institutions: [], bankruptcy: false },
                { id: 1, index: 1, name: 'NPC', isAI: true,
                  colorIndex: 1, cash: 5000, institutions: [], bankruptcy: false },
              ];
              // 把前 1/3 的格子分给人类，前 1/6 标记为质押
              const fakeState = {
                players, currentPlayerIndex: 0, round: 3, market: 'normal',
                board: cells,
              };
              const owned = [];
              for (let i = 0; i < cells.length; i += 3) {
                const inst = { cellIndex: i, level: cells[i].tier || 0,
                               mortgaged: (i % 6 === 0), mortgageAmount: 0 };
                players[0].institutions.push(inst);
                owned.push(i);
              }
              // 手动走 TileLayer 的渲染逻辑（build + 私有 _render 的等价体）
              const layer = new m.TileLayer(root, {
                layout: { cellW, cellH },
                w: W, h: H,
                cellRect: (i) => {
                  const tc = trackCells[i] || [i % cols, Math.floor(i / cols)];
                  return { x: boardX + tc[0] * cellW, y: boardY + tc[1] * cellH,
                           w: cellW, h: cellH };
                },
              });
              layer.build();
              // 再按真实几何定位（build() 里的 layout() 用的 renderer.cellRect）
              for (let i = 0; i < nodes.length; i++) {
                const n = nodes[i];
                const tc = trackCells[i] || [i % cols, Math.floor(i / cols)];
                n.style.left = ((boardX + tc[0] * cellW) / W * 100) + '%';
                n.style.top = ((boardY + tc[1] * cellH) / H * 100) + '%';
                n.style.width = (cellW / W * 100) + '%';
                n.style.height = (cellH / H * 100) + '%';
              }
              layer._render(fakeState);

              return { count: nodes.length, cols, rows,
                       cellW: +cellW.toFixed(2), cellH: +cellH.toFixed(2),
                       boardX: +boardX.toFixed(2), boardY: +boardY.toFixed(2),
                       ownedCount: owned.length };
            }""", {"bottomReserve": BOTTOM_RESERVE})

            await page.wait_for_timeout(300)
            data = await page.evaluate(MEASURE_JS)
            data["generated"] = gen
            results["viewports"][f"{vw}x{vh}"] = data
            await page.close()

        await browser.close()

    summary = {
        "cellWidthRange": [
            min(v["cellMinW"] for v in results["viewports"].values()),
            max(v["cellMaxW"] for v in results["viewports"].values()),
        ],
        "cellHeightRange": [
            min(v["cellMinH"] for v in results["viewports"].values()),
            max(v["cellMaxH"] for v in results["viewports"].values()),
        ],
        "overflowByViewport": {k: v["overflowCount"] for k, v in results["viewports"].items()},
        "totalOverflow": sum(v["overflowCount"] for v in results["viewports"].values()),
    }
    results["summary"] = summary
    print(json.dumps(results, ensure_ascii=False, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
