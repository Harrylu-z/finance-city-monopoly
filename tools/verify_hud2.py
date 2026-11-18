"""
HUD 改版验收 —— 遮挡 / 当前玩家 / 回合播报位置 / Tab / 菜单迁移 / 背景 / 转盘 / 真名 / 溢出。

用法：python tools/verify_hud2.py
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
    await page.evaluate("""() => {
      const m=document.querySelector('.tutorial-mask'); if(m) m.remove();
    }""")
    # 等主控制器就绪（window.__game 在 main.js 末尾挂载，
    # game.state 要等开局后才创建）
    for _ in range(40):
        ok = await page.evaluate("() => !!(window.__game && window.__game.state)")
        if ok:
            break
        await page.wait_for_timeout(300)
    await page.wait_for_timeout(600)


# ---------- ① 遮挡检测 + ② 当前玩家 + ③ 播报位置 ----------
CHECK_JS = r"""() => {
  const wrap = document.getElementById('board-wrap');
  const wr = wrap.getBoundingClientRect();
  const boardLeft = wr.left;

  // 所有 HUD 元素（左侧竖栏 + 右上 + 右侧 + 底部）
  const ids = ['hud-left','hud-player','active-player-card','active-status',
               'hud-tabs','tab-list','hud-feed','feed-toggle','log-panel',
               'hud-top-right','hud-right','hud-bottom'];
  const els = [];
  for (const id of ids) {
    const el = document.getElementById(id);
    if (!el) continue;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;
    els.push({ id, left: +r.left.toFixed(1), right: +r.right.toFixed(1),
               top: +r.top.toFixed(1), bottom: +r.bottom.toFixed(1),
               w: +r.width.toFixed(1), h: +r.height.toFixed(1) });
  }
  // 遮挡判定：**只有「左边缘在棋盘左边界左边、右边缘越过棋盘左边界、
  // 且与棋盘在垂直方向上有重叠」的元素才算真正压住棋盘**。
  //  · 右上角按钮 / 右侧面板在棋盘右边，越过 boardRight 是设计如此；
  //  · 底部操作栏 .hud-bottom 在棋盘**下方**，垂直方向不重叠，也不算遮挡。
  const overlapping = els.filter(e =>
    e.left < boardLeft - 0.5 && e.right > boardLeft + 0.5 &&
    e.top < wr.bottom - 0.5 && e.bottom > wr.top + 0.5);
  const overlapPx = overlapping.map(e => +(e.right - boardLeft).toFixed(1));
  // 左侧竖栏所有元素的右边界（用于逐项报告）
  const leftSide = els.filter(e => e.left < boardLeft - 0.5)
      .map(e => ({ id: e.id, left: e.left, right: e.right,
                   clears: e.right <= boardLeft + 0.5,
                   gapToBoard: +(boardLeft - e.right).toFixed(1) }));

  // 当前玩家卡内容
  const name = document.getElementById('active-player-name');
  const st = window.__game && window.__game.state;
  const cur = st ? st.players[st.currentPlayerIndex] : null;
  const human = st ? st.players.find(p => !p.isAI) : null;

  // 回合播报位置
  const feed = document.getElementById('hud-feed');
  const feedCs = feed ? getComputedStyle(feed) : null;
  const fr = feed ? feed.getBoundingClientRect() : null;

  // Tab 面板
  const tablist = document.getElementById('tab-list');
  const tabs = [...document.querySelectorAll('[role="tab"]')];
  const panels = [...document.querySelectorAll('[role="tabpanel"]')];
  const tabInfo = tabs.map(t => ({
    id: t.id, tab: t.dataset.tab,
    ariaSelected: t.getAttribute('aria-selected'),
    controls: t.getAttribute('aria-controls'),
    text: t.textContent.trim(),
  }));

  // 菜单按钮是否还在
  const menuBtn = document.getElementById('btn-menu');
  const menuItems = [...document.querySelectorAll('#rank-box [id^="btn-menu-"]')]
      .map(b => ({ id: b.id, text: b.textContent.trim() }));

  // 背景：pixelated 计数
  let pixelated = 0;
  for (const sheet of document.styleSheets) {
    let rules; try { rules = sheet.cssRules; } catch(e) { continue; }
    for (const rule of rules) {
      if (rule.style && rule.style.imageRendering === 'pixelated') pixelated++;
    }
  }
  let pixelatedText = 0;
  const raw = document.documentElement.outerHTML;
  pixelatedText = (raw.match(/image-rendering\s*:\s*pixelated/gi) || []).length;

  return {
    boardLeft: +boardLeft.toFixed(1),
    boardRight: +wr.right.toFixed(1),
    boardTop: +wr.top.toFixed(1),
    boardBottom: +wr.bottom.toFixed(1),
    els, overlapping: overlapping.map(e => e.id), overlapPx, leftSide,
    activeName: name ? name.textContent.trim() : null,
    currentIsAI: cur ? !!cur.isAI : null,
    currentName: cur ? cur.name : null,
    humanName: human ? human.name : null,
    humanCash: human ? human.cash : null,
    feedPos: feedCs ? { top: feedCs.top, bottom: feedCs.bottom, left: feedCs.left } : null,
    feedRect: fr ? { top: +fr.top.toFixed(1), bottom: +fr.bottom.toFixed(1),
                     left: +fr.left.toFixed(1), right: +fr.right.toFixed(1) } : null,
    feedParent: feed ? feed.parentElement.id : null,
    tablistRole: tablist ? tablist.getAttribute('role') : null,
    tabs: tabInfo,
    panelCount: panels.length,
    panelRoles: panels.map(p => p.getAttribute('role')),
    menuBtnExists: !!menuBtn,
    menuItems,
    pixelatedCount: pixelated,
    pixelatedTextCount: pixelatedText,
  };
}"""


# ---------- ④ Tab 切换测试 ----------
TABS_JS = r"""async () => {
  const tabs = [...document.querySelectorAll('[role="tab"]')];
  const out = [];
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  for (const t of tabs) {
    t.click();
    await sleep(120);
    const panel = document.getElementById(t.getAttribute('aria-controls'));
    const visible = panel && !panel.hidden;
    out.push({
      tab: t.dataset.tab,
      label: t.textContent.trim(),
      ariaSelected: t.getAttribute('aria-selected'),
      panelId: panel ? panel.id : null,
      panelHidden: panel ? panel.hidden : null,
      panelRole: panel ? panel.getAttribute('role') : null,
      panelLabelledby: panel ? panel.getAttribute('aria-labelledby') : null,
      panelVisible: visible,
      contentLen: panel ? panel.textContent.trim().length : 0,
      contentHead: panel ? panel.textContent.trim().slice(0, 60) : '',
      selectedCount: tabs.filter(x => x.getAttribute('aria-selected') === 'true').length,
      visiblePanelCount: [...document.querySelectorAll('[role="tabpanel"]')]
          .filter(p => !p.hidden).length,
    });
  }
  return out;
}"""


# ---------- ⑥ 转盘连续转测试 ----------
WHEEL_JS = r"""async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const g = window.__game;
  const st = g.state;
  if (!st) return { error: 'no state' };

  // 找到转盘格
  const bs = await import('/src/core/board.js');
  let wheelIdx = -1;
  for (let i = 0; i < st.board.length; i++) {
    const c = st.board[i];
    if (c && c.type === 'special' && c.special && c.special.kind === 'wheel') { wheelIdx = i; break; }
  }
  if (wheelIdx < 0) return { error: 'no wheel cell', size: st.board.length };

  // 强制轮到人类玩家
  const human = st.players.find(p => !p.isAI);
  st.currentPlayerIndex = st.players.indexOf(human);
  human.position = wheelIdx;
  st.phase = 'await-roll';
  g.busy = false;

  const cashBefore = human.cash;
  const logLenBefore = st.log.length;

  // 触发转盘
  const triggered = g.triggerWheelCell(wheelIdx);
  await sleep(300);
  const modalOpen = !document.getElementById('modal-root').hidden;
  const body = document.querySelector('.wheel-wrap') ? document.querySelector('.wheel-wrap').closest('.modal-inner') : null;
  const spinBtn = body ? [...body.querySelectorAll('button')].find(b => /转/.test(b.textContent) && !/关闭|完成/.test(b.textContent)) : null;
  const counter = body ? body.querySelector('.wheel-counter') : null;

  const spins = [];
  for (let i = 0; i < 4; i++) {
    const btn = body ? [...body.querySelectorAll('button')].find(b => /转/.test(b.textContent) && !/关闭|完成/.test(b.textContent)) : null;
    if (!btn || btn.disabled) { spins.push({ i, skipped: true, reason: 'no enabled spin button' }); break; }
    btn.click();
    await sleep(3900);   // SPIN_MS 3600 + 余量
    const st2 = g.state;
    spins.push({
      i,
      cashAfter: human.cash,
      logDelta: st2.log.length - logLenBefore,
      lastLog: st2.log.length ? st2.log[st2.log.length-1].text : '',
      modalStillOpen: !document.getElementById('modal-root').hidden,
    });
  }
  const btnAfter = body ? [...body.querySelectorAll('button')].find(b => /转/.test(b.textContent) && !/关闭|完成/.test(b.textContent)) : null;

  return {
    triggered, modalOpen, wheelIdx,
    cashBefore, cashAfter: human.cash,
    spinCount: spins.length,
    spins,
    counterText: counter ? counter.textContent.trim() : null,
    btnText: btnAfter ? btnAfter.textContent.trim() : null,
    btnDisabled: btnAfter ? btnAfter.disabled : null,
    logGrew: st.log.length - logLenBefore,
  };
}"""


# ---------- ⑦ AI 转盘只读测试 ----------
AI_WHEEL_JS = r"""async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const g = window.__game;
  const st = g.state;
  if (!st) return { error: 'no state' };
  const ai = st.players.find(p => p.isAI && !p.bankrupt);
  const human = st.players.find(p => !p.isAI);
  if (!ai) return { error: 'no ai' };

  // 轮到 AI
  st.currentPlayerIndex = st.players.indexOf(ai);
  st.phase = 'await-roll';
  g.busy = false;

  // 找转盘格，让 AI 站上去
  let wheelIdx = -1;
  for (let i = 0; i < st.board.length; i++) {
    const c = st.board[i];
    if (c && c.type === 'special' && c.special && c.special.kind === 'wheel') { wheelIdx = i; break; }
  }
  ai.position = wheelIdx;
  g.spinWheelThenSettle(ai, st.board[wheelIdx]);
  await sleep(500);

  const inner = document.querySelector('#modal-box .modal-inner');
  const spinBtn = inner ? [...inner.querySelectorAll('button')].find(b => /^\s*转/.test(b.textContent)) : null;
  const readonlyFlag = inner ? inner.querySelector('.wheel-readonly') : null;
  const backdrop = document.getElementById('modal-backdrop');

  // 玩家此刻点自己的转盘格 → 应被拒绝
  const busyBefore = g.busy;
  const modalHiddenBefore = document.getElementById('modal-root').hidden;
  // 直接调 API 模拟玩家触发
  const humanTriggered = g.triggerWheelCell(wheelIdx);
  await sleep(200);

  return {
    modalOpen: !document.getElementById('modal-root').hidden,
    spinBtnExists: !!spinBtn,
    spinBtnText: spinBtn ? spinBtn.textContent.trim() : null,
    spinBtnDisabled: spinBtn ? spinBtn.disabled : null,
    readonlyNotice: readonlyFlag ? readonlyFlag.textContent.trim() : null,
    backdropPresent: !!backdrop,
    backdropZ: backdrop ? getComputedStyle(backdrop).zIndex : null,
    playerTriggerResult: humanTriggered,
    busyBefore, busyAfter: g.busy,
    modalStillOpen: !document.getElementById('modal-root').hidden,
    humanIsNotCurrent: st.currentPlayerIndex !== st.players.indexOf(human),
  };
}"""


# ---------- ② 当前玩家固定为人类（AI 回合时验证） ----------
AI_TURN_JS = r"""async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const g = window.__game;
  const st = g.state;
  if (!st) return { error: 'no state' };
  const ai = st.players.find(p => p.isAI && !p.bankrupt);
  const human = st.players.find(p => !p.isAI);
  if (!ai) return { error: 'no ai' };

  // 强制切到 AI 回合
  st.currentPlayerIndex = st.players.indexOf(ai);
  g.updateHUD();
  await sleep(300);

  const nameEl = document.getElementById('active-player-name');
  const cardEl = document.getElementById('active-player-card');
  const shown = nameEl ? nameEl.textContent.trim() : null;

  // 人工读一遍「当前玩家卡」的完整文本，确认没有切到 AI
  const cardText = cardEl ? cardEl.textContent.replace(/\s+/g, ' ').trim() : null;

  // Tab 面板里的内容也应属于人类玩家
  const tabOwner = document.querySelector('#hud-tabs') ? document.querySelector('#hud-tabs').textContent : '';

  // 恢复到人类回合
  st.currentPlayerIndex = st.players.indexOf(human);
  g.updateHUD();
  await sleep(200);
  const restored = nameEl ? nameEl.textContent.trim() : null;

  return {
    aiTurn: true,
    currentIsAI: !!st.players[st.currentPlayerIndex].isAI,
    shownName: shown,
    humanName: human.name,
    aiName: ai.name,
    matchesHuman: shown === human.name,
    showsAiName: shown === ai.name,
    cardText,
    cardMentionsAi: cardText ? cardText.includes(ai.name) : null,
    tabOwnerSample: tabOwner.slice(0, 120),
    restoredName: restored,
  };
}"""


# ---------- ⑧ 持有人真名 ----------
OWNER_JS = r"""() => {
  const g = window.__game;
  const st = g.state;
  const names = st.players.map(p => p.name);

  // ===== 先造出「有人持有」的场面 =====
  // 人类拿 3 个机构格，AI 拿 2 个，模拟中期局面
  const human = st.players.find(p => !p.isAI);
  const ai = st.players.find(p => p.isAI);
  const instIdx = [];
  for (let i = 0; i < st.board.length; i++) {
    const c = st.board[i];
    if (c && c.type === 'institution') instIdx.push(i);
    if (instIdx.length >= 5) break;
  }
  // 人类持 3 个（含 1 个质押），AI 持 2 个
  [0,1,2].forEach((k, n) => {
    const i = instIdx[k];
    const cell = st.board[i];
    human.institutions = human.institutions || [];
    human.institutions.push({ cellIndex: i, level: cell.tier || 0,
                              mortgaged: n === 0, mortgageAmount: 0 });
    cell.owner = st.players.indexOf(human);
    cell.mortgaged = n === 0;
  });
  [3,4].forEach((k) => {
    const i = instIdx[k];
    const cell = st.board[i];
    ai.institutions = ai.institutions || [];
    ai.institutions.push({ cellIndex: i, level: cell.tier || 0, mortgaged: false, mortgageAmount: 0 });
    cell.owner = st.players.indexOf(ai);
  });
  // 重新渲染地块层
  try { g.renderer.tileLayer && g.renderer.tileLayer._render(st); } catch(e) {}
  if (g.tiles && g.tiles._render) { try { g.tiles._render(st); } catch(e) {} }
  // 兜底：直接调 TileLayer
  try {
    const tl = g.tileLayer || (g.renderer && g.renderer.tiles) || g.tiles;
    if (tl && tl._render) tl._render(st);
  } catch(e) {}

  const tiles = [...document.querySelectorAll('.mt-cell')];
  const owners = [];
  for (const t of tiles) {
    const o = t.querySelector('.mt-d2-owner');
    if (o) {
      owners.push({
        cell: Number(t.dataset.index),
        cellName: t.getAttribute('aria-label'),
        text: o.textContent.trim(),
        title: o.getAttribute('title'),
      });
    }
  }
  // 检查是否还有「XX持有」式的设计稿简化名
  const designNames = ['霓青','鎏金','朱红','紫晶','橙方'];
  const bad = owners.filter(o => designNames.some(d => o.text.includes(d)));
  // 真名匹配：显示的文字应当是某个玩家真名的前缀（截断后）
  const matchesRealName = owners.filter(o =>
    names.some(n => o.text === n || (o.text.endsWith('…') && n.startsWith(o.text.slice(0, -1)))));
  return { playerNames: names, ownerCount: owners.length,
           owners: owners.slice(0, 12),
           designNameHits: bad.length, badSample: bad.slice(0, 5),
           realNameMatches: matchesRealName.length };
}"""


# ---------- ⑨ 溢出检测 ----------
OVERFLOW_JS = r"""() => {
  const tiles = [...document.querySelectorAll('.mt-cell')];
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
        overflow.push({ cell: cellIdx, el: descOf(el), sw, cw, sh, ch,
                       overX: +(sw-cw).toFixed(1), overY: +(sh-ch).toFixed(1) });
      }
    }
  }
  const g = window.__game;
  const r = g && g.renderer;
  const L = r && r.layout;
  const first = tiles[0];
  const fr = first ? first.getBoundingClientRect() : null;
  return {
    overflowCount: overflow.length,
    overflow: overflow.slice(0, 20),
    cellW: L ? +L.cellW.toFixed(2) : null,
    cellH: L ? +L.cellH.toFixed(2) : null,
    cellDomW: fr ? +fr.width.toFixed(2) : null,
    cellDomH: fr ? +fr.height.toFixed(2) : null,
    tileCount: tiles.length,
  };
}"""


async def main():
    results = {"viewports": {}, "errors": [], "checks": {}}
    async with async_playwright() as p:
        browser = await p.chromium.launch(executable_path=CHROME, headless=True)

        # ---------- 各视口：遮挡 / 溢出 ----------
        for vw, vh in VIEWPORTS:
            page = await browser.new_page(viewport={"width": vw, "height": vh})
            errors = []
            page.on("pageerror", lambda e, errors=errors: errors.append("pageerror: " + str(e)))
            page.on("console", lambda m, errors=errors: errors.append("console.error: " + m.text)
                    if m.type == "error" and "favicon" not in m.text.lower() else None)
            await page.goto(URL, wait_until="load")
            await dismiss(page)
            chk = await page.evaluate(CHECK_JS)
            ovf = await page.evaluate(OVERFLOW_JS)
            chk["overflow"] = ovf
            chk["errors"] = errors
            results["viewports"][f"{vw}x{vh}"] = chk
            await page.close()

        # ---------- 交互测试（1440×900）----------
        page = await browser.new_page(viewport={"width": 1440, "height": 900})
        perrors = []
        page.on("pageerror", lambda e, perrors=perrors: errors.append("pageerror: " + str(e)))
        page.on("console", lambda m, perrors=perrors: errors.append("console.error: " + m.text)
                if m.type == "error" and "favicon" not in m.text.lower() else None)
        await page.goto(URL, wait_until="load")
        await dismiss(page)

        results["checks"]["tabs"] = await page.evaluate(TABS_JS)
        results["checks"]["aiTurn"] = await page.evaluate(AI_TURN_JS)
        results["checks"]["owners"] = await page.evaluate(OWNER_JS)
        results["checks"]["wheel"] = await page.evaluate(WHEEL_JS)
        await page.evaluate("""() => {
          const r = document.getElementById('modal-root'); if (r) r.hidden = true;
        }""")
        await page.wait_for_timeout(300)
        results["checks"]["aiWheel"] = await page.evaluate(AI_WHEEL_JS)
        results["pageErrors"] = perrors
        await page.close()
        await browser.close()

    print(json.dumps(results, ensure_ascii=False, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
