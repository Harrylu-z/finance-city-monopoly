"""
现代棋盘布局全量验收 —— 溢出 / 垂直分布 / 几何对齐 / 可玩性。

与上一轮 `verify_modern_layout.py` 的区别：
  **溢出检测遍历每个 `.mt-cell` 的所有后代元素**，
  对 `display !== 'none'` 的元素检查
  `scrollWidth > clientWidth + 1 || scrollHeight > clientHeight + 1`。
  （上一轮只检查 `firstElementChild`，因此漏掉了监管格 / 转盘清单的深层溢出。）

用法：python tools/verify_modern_layout.py
"""
import asyncio
import json
import os
import sys

from playwright.async_api import async_playwright

CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
URL = "http://127.0.0.1:8000/"
VIEWPORTS = [(1280, 720), (1440, 900), (1600, 950), (1920, 1080), (2560, 1440)]
SHOT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                        "design-proposals", "maps", "shots")


async def dismiss(page):
    """开局 → 跳过教学 → 移除教学遮罩。"""
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
    # 截图前必须移除教学遮罩（z-index 60 会盖住画布）
    await page.evaluate("""() => {
      const m=document.querySelector('.tutorial-mask'); if(m) m.remove();
    }""")
    await page.wait_for_timeout(600)


# ---------- 页面内采集脚本 ----------
COLLECT_JS = r"""async () => {
  const bs = await import('/src/core/board-shape.js');
  const cv = document.getElementById('board-canvas');
  const cr = cv.getBoundingClientRect();
  const wrap = document.getElementById('board-wrap');
  const wr = wrap.getBoundingClientRect();
  const hudBottom = document.getElementById('hud-bottom');
  const hr = hudBottom.getBoundingClientRect();
  const bar = hudBottom.querySelector('.bottom-bar');
  const brr = bar ? bar.getBoundingClientRect() : null;
  const renderer = window.__game && window.__game.renderer;
  const L = renderer && renderer.layout;

  const cols = bs.BOARD_GRID.cols, rows = bs.BOARD_GRID.rows;
  const canvasW = cr.width, canvasH = cr.height;
  const colW = L ? L.cellW : canvasW / cols;
  const rowH = L ? L.cellH : canvasH / rows;
  const boardX = L ? L.boardX : 0;
  const boardY = L ? L.boardY : 0;

  const tiles = [...document.querySelectorAll('.mt-cell')];

  // ---------- ① 溢出检测：遍历每个 .mt-cell 的所有后代 ----------
  const overflow = [];
  const descOf = (el) => {
    const cls = (el.getAttribute && el.getAttribute('class')) || el.tagName.toLowerCase();
    const p = el.parentElement;
    const pcls = p && p.getAttribute && p.getAttribute('class');
    return pcls ? `${pcls} > ${cls}` : cls;
  };
  for (const cell of tiles) {
    const cellIdx = Number(cell.dataset.index);
    const all = [cell, ...cell.querySelectorAll('*')];
    for (const el of all) {
      const cs = getComputedStyle(el);
      if (cs.display === 'none') continue;
      if (cs.visibility === 'hidden') continue;
      const sw = el.scrollWidth, cw = el.clientWidth;
      const sh = el.scrollHeight, ch = el.clientHeight;
      if (sw > cw + 1 || sh > ch + 1) {
        overflow.push({
          cell: cellIdx,
          cellName: cell.getAttribute('aria-label') || '',
          el: descOf(el),
          tag: el.tagName.toLowerCase(),
          sw, cw, sh, ch,
          overX: +(sw - cw).toFixed(1),
          overY: +(sh - ch).toFixed(1),
        });
      }
    }
  }

  // ---------- ② 垂直分布 ----------
  let minT = Infinity, maxB = -Infinity, minL = Infinity, maxR = -Infinity;
  const ratios = [], domDevs = [], trackDevs = [], expectedDevs = [];
  for (let i = 0; i < tiles.length; i++) {
    const t = tiles[i];
    const q = t.getBoundingClientRect();
    ratios.push(q.width / q.height);
    minT = Math.min(minT, q.top); maxB = Math.max(maxB, q.bottom);
    minL = Math.min(minL, q.left); maxR = Math.max(maxR, q.right);
    // DOM 中心 vs 独立反解的期望格心（用 TRACK_CELLS 的 [col,row]）
    const [col, row] = bs.TRACK_CELLS[i];
    const ex = cr.left + boardX + (col + 0.5) * colW;
    const ey = cr.top + boardY + (row + 0.5) * rowH;
    domDevs.push(Math.hypot(q.left + q.width / 2 - ex, q.top + q.height / 2 - ey));
    // DOM 中心 vs TRACK_POINTS 反解
    const p = bs.TRACK_POINTS[i];
    const tx = cr.left + boardX + (p[0] / 1000) * (cols * colW);
    const ty = cr.top + boardY + (p[1] / 1000) * (rows * rowH);
    trackDevs.push(Math.hypot(q.left + q.width / 2 - tx, q.top + q.height / 2 - ty));
    // renderer.trackCenter vs layout 反解
    if (renderer && renderer.layout) {
      const c = renderer.trackCenter(i);
      expectedDevs.push(Math.hypot(c.cx - (L.boardX + (col + 0.5) * L.cellW),
                                  c.cy - (L.boardY + (row + 0.5) * L.cellH)));
    }
  }

  const topGap = minT - cr.top;
  const botGap = cr.bottom - maxB;
  const barH = brr ? brr.height : hr.height;
  const barTop = brr ? brr.top : hr.top;

  // ---------- ③ 监管格 / 转盘格明细 ----------
  const regs = [], wheels = [];
  for (const cell of tiles) {
    const sc = cell.querySelector('.mt-reg-scene');
    if (sc) {
      const badge = sc.querySelector('.mt-reg-badge');
      const bld = sc.querySelector('.mt-reg-bld');
      const bcs = badge ? getComputedStyle(badge) : null;
      regs.push({
        cell: Number(cell.dataset.index),
        name: cell.getAttribute('aria-label'),
        sceneW: sc.clientWidth, sceneH: sc.clientHeight,
        sceneScrollW: sc.scrollWidth, sceneScrollH: sc.scrollHeight,
        display: getComputedStyle(sc).display,
        badgeW: badge ? +badge.getBoundingClientRect().width.toFixed(2) : 0,
        badgeH: badge ? +badge.getBoundingClientRect().height.toFixed(2) : 0,
        badgeCssW: bcs ? bcs.width : null, badgeCssH: bcs ? bcs.height : null,
        bldW: bld ? +bld.getBoundingClientRect().width.toFixed(2) : 0,
        bldH: bld ? +bld.getBoundingClientRect().height.toFixed(2) : 0,
      });
    }
    const wl = cell.querySelector('.mt-d2-sp-list');
    if (wl) {
      const rows = [...wl.querySelectorAll('.mt-d2-sp-row')];
      wheels.push({
        cell: Number(cell.dataset.index),
        name: cell.getAttribute('aria-label'),
        listH: wl.clientHeight, listScrollH: wl.scrollHeight,
        listW: wl.clientWidth, listScrollW: wl.scrollWidth,
        rowsTotal: rows.length,
        rowsVisible: rows.filter(x => getComputedStyle(x).display !== 'none').length,
        moreVisible: wl.querySelector('.mt-d2-sp-more')
          ? getComputedStyle(wl.querySelector('.mt-d2-sp-more')).display !== 'none' : false,
      });
    }
  }

  return {
    canvas: { w: +canvasW.toFixed(1), h: +canvasH.toFixed(1), top: +cr.top.toFixed(1), bottom: +cr.bottom.toFixed(1) },
    wrap: { w: +wr.width.toFixed(1), h: +wr.height.toFixed(1), top: +wr.top.toFixed(1), bottom: +wr.bottom.toFixed(1) },
    bottomBar: brr ? { h: +brr.height.toFixed(1), top: +brr.top.toFixed(1), bottom: +brr.bottom.toFixed(1) } : null,
    hudBottomH: +hr.height.toFixed(1),
    barGapToWrapBottom: +((wr.bottom) - (brr ? brr.bottom : hr.bottom)).toFixed(1),
    bottomReserve: renderer ? renderer.bottomReserve : null,
    layout: L ? { boardX: +L.boardX.toFixed(1), boardY: +L.boardY.toFixed(1),
                  boardW: +L.boardW.toFixed(1), boardH: +L.boardH.toFixed(1),
                  cellW: +L.cellW.toFixed(3), cellH: +L.cellH.toFixed(3) } : null,
    tileCount: tiles.length,
    cellRatioMin: +Math.min(...ratios).toFixed(5),
    cellRatioMax: +Math.max(...ratios).toFixed(5),
    boardWidthPct: +((maxR - minL) / canvasW * 100).toFixed(2),
    boardHeightPct: +((maxB - minT) / canvasH * 100).toFixed(2),
    topGap: +topGap.toFixed(1),
    botGap: +botGap.toFixed(1),
    gapDiff: +Math.abs(topGap - botGap).toFixed(1),
    gapDiffPct: +(Math.abs(topGap - botGap) / canvasH * 100).toFixed(2),
    barTopInCanvas: +(barTop - cr.top).toFixed(1),
    boardBottomInCanvas: +(maxB - cr.top).toFixed(1),
    boardClearOfBar: +(barTop - maxB).toFixed(1),
    botGapVsBar: +(botGap - barH).toFixed(1),
    domMaxDev: +Math.max(...domDevs).toFixed(4),
    domMaxDevIdx: domDevs.indexOf(Math.max(...domDevs)),
    trackMaxDev: +Math.max(...trackDevs).toFixed(4),
    expectedCenterMaxDev: expectedDevs.length ? +Math.max(...expectedDevs).toFixed(4) : null,
    overflowCount: overflow.length,
    overflow: overflow.slice(0, 24),
    regs, wheels,
  };
}"""


async def main():
    results = {"viewports": {}, "errors": [], "play": {}}
    async with async_playwright() as p:
        browser = await p.chromium.launch(executable_path=CHROME, headless=True)

        for vw, vh in VIEWPORTS:
            page = await browser.new_page(viewport={"width": vw, "height": vh})
            errors = []
            page.on("pageerror", lambda e, errors=errors: errors.append("pageerror: " + str(e)))
            page.on("console", lambda m, errors=errors: errors.append("console.error: " + m.text)
                    if m.type == "error" and "favicon" not in m.text.lower() else None)
            await page.goto(URL, wait_until="load")
            await dismiss(page)
            data = await page.evaluate(COLLECT_JS)
            data["errors"] = errors
            results["viewports"][f"{vw}x{vh}"] = data
            await page.close()

        # ---------- 8 回合可玩性（1440×900）----------
        page = await browser.new_page(viewport={"width": 1440, "height": 900})
        perrors = []
        page.on("pageerror", lambda e, perrors=perrors: perrors.append("pageerror: " + str(e)))
        page.on("console", lambda m, perrors=perrors: perrors.append("console.error: " + m.text)
                if m.type == "error" and "favicon" not in m.text.lower() else None)
        await page.goto(URL, wait_until="load")
        await dismiss(page)
        play = await page.evaluate(r"""async () => {
          const errs = [];
          const btn = document.getElementById('btn-roll');
          let rolls = 0, ends = 0;
          const click = async (el, tag) => {
            if (!el) return;
            try { el.click(); } catch (e) { errs.push(tag + ': ' + (e && e.message)); }
            await new Promise(r => setTimeout(r, 260));
          };
          for (let i = 0; i < 120; i++) {
            const st = window.__game && window.__game.state;
            if (!st) { errs.push('no state at step ' + i); break; }
            if (st.phase === 'gameover') break;
            // 关闭可能出现的弹窗
            const modal = document.querySelector('.modal-mask, .dialog-mask');
            if (modal && modal.offsetParent !== null) {
              const ok = [...modal.querySelectorAll('button')].find(b => /确定|继续|好|确认|买入|放弃|跳过/.test(b.textContent));
              await click(ok, 'modal');
              continue;
            }
            const roll = document.getElementById('btn-roll');
            if (roll && !roll.disabled && roll.offsetParent !== null) { await click(roll, 'roll'); rolls++; }
            else {
              const end = document.getElementById('btn-endturn');
              if (end && !end.disabled && end.offsetParent !== null) { await click(end, 'endturn'); ends++; }
              else { await new Promise(r => setTimeout(r, 150)); }
            }
          }
          const st = window.__game && window.__game.state;
          return { errors: errs, rolls, ends,
                   turn: st ? st.turn : null, phase: st ? st.phase : null,
                   positions: st ? st.players.map(p => p.position) : null };
        }""")
        play["pageErrors"] = perrors
        results["play"] = play
        await page.close()
        await browser.close()

    print(json.dumps(results, ensure_ascii=False, indent=1))
    return 0 if not results["errors"] else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
