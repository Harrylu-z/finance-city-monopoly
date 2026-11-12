/* eslint-disable */
/**
 * 浏览器内自动化对局脚本（普通脚本，非 ES Module）。
 *
 * 用途：自动化回归测试 —— 驱动一整局游戏，覆盖
 *       掷骰 / 收购 / 放弃 / 升级 / 质押 / 赎回 / 地铁 / 事件卡 / 破产 / 结束。
 *
 * 加载方式（开发服务器下）：
 *   <script src="/tools/autoplay.js"></script>
 *   然后在 Console 执行： await window.__autoPlay(120)
 */
(function () {
  'use strict';

  const sleep = (ms) => new Promise((resolve) => {
    // 优先使用页面暴露的非节流延时（后台标签页同样有效）
    if (typeof window.__delay === 'function') {
      window.__delay(ms, resolve);
    } else {
      setTimeout(resolve, ms);
    }
  });

  async function autoPlay(gameOrLimit, maxTurns) {
    // 兼容两种调用方式：
    //   __autoPlay(game, maxTurns)   —— 显式指定实例
    //   __autoPlay(maxTurns)         —— 使用页面默认实例
    let g;
    let limit;
    if (typeof gameOrLimit === 'number') {
      g = window.__game;
      limit = gameOrLimit || 120;
    } else {
      g = gameOrLimit || window.__game;
      limit = maxTurns || 120;
    }
    if (!g || !g.state) throw new Error('游戏尚未开始');
    const report = {
      turns: 0,
      purchases: 0,
      upgrades: 0,
      mortgages: 0,
      redeems: 0,
      metros: 0,
      events: 0,
      gameovers: 0,
      errors: [],
      finished: false,
    };

    if (!g || !g.state) throw new Error('游戏尚未开始');
    const state = g.state;
    let rules = null;
    try { rules = await import('/src/core/rules.js'); } catch (e) { rules = null; }
    let closeModal = null;
    try {
      const dlg = await import('/src/app/dialogs.js');
      closeModal = dlg.closeModal;
    } catch (e) { closeModal = null; }

    // 等待条件轮询（不依赖页面可见性）
    const waitFor = async (pred, maxMs) => {
      const t0 = Date.now();
      while (Date.now() - t0 < (maxMs || 4000)) {
        if (pred()) return true;
        await sleep(20);
      }
      return false;
    };

    // 处理当前弹窗
    //
    // 优先直接驱动「规则层」决策（不依赖 DOM 事件），因为部分自动化/无头环境会
    // 吞掉合成的鼠标事件；只有在拿不到规则层入口时才退回点击 DOM 按钮。
    const handleModal = async () => {
      for (let i = 0; i < 10; i++) {
        const root = document.getElementById('modal-root');
        const box = root && !root.hidden ? root.querySelector('.modal-box') : null;
        if (!box) return false;
        const btns = Array.from(box.querySelectorAll('button'));
        if (!btns.length) return false;
        const txts = btns.map((b) => (b.textContent || '').trim());
        let idx = btns.findIndex((b) => b.classList.contains('pixel-btn-primary'));
        if (idx < 0) {
          const buyIdx = txts.findIndex((t) => /收购|入股|战略入股|确认|接受/.test(t));
          idx = buyIdx >= 0 ? buyIdx : btns.length - 1;
        }
        const label = txts[idx] || '';
        if (/收购|入股/.test(label)) report.purchases++;
        else if (/地铁|前进|换乘/.test(label)) report.metros++;
        else if (/确认|知道了|翻牌/.test(label)) report.events++;

        // 1) 规则层直驱：直接调用弹窗自身暴露的动作回调（最可靠，
        //    不依赖合成鼠标事件；弹窗业务逻辑与真人点击完全一致）
        const boxEl = document.getElementById('modal-box');
        const acts = boxEl && boxEl._modalActions;
        if (acts && acts.length) {
          let target = acts.find((a) => /确认收购|确认|接受|入股/.test(a.text || ''));
          if (!target) target = acts.find((a) => a.primary);
          if (!target) target = acts[acts.length - 1];
          if (target && target.onClick) {
            const keep = target.onClick();
            if (keep !== false && closeModal) closeModal();
            await sleep(60);
            continue;
          }
        }

        // 2) 退回 DOM 点击：派发完整指针序列（部分环境会吞掉 .click()）
        const btn = btns[idx];
        const r = btn.getBoundingClientRect();
        const opts = {
          bubbles: true, cancelable: true, view: window,
          clientX: r.left + r.width / 2, clientY: r.top + r.height / 2,
        };
        try { btn.dispatchEvent(new PointerEvent('pointerdown', opts)); } catch (e) { /* noop */ }
        try { btn.dispatchEvent(new MouseEvent('mousedown', opts)); } catch (e) { /* noop */ }
        try { btn.dispatchEvent(new PointerEvent('pointerup', opts)); } catch (e) { /* noop */ }
        try { btn.dispatchEvent(new MouseEvent('mouseup', opts)); } catch (e) { /* noop */ }
        try { btn.dispatchEvent(new MouseEvent('click', opts)); } catch (e) { /* noop */ }
        await sleep(60);
      }
      return true;
    };

    while (report.turns < limit && state.phase !== 'gameover') {
      const p = state.players[state.currentPlayerIndex];
      if (!p) break;
      const trace = (tag) => {
        if (!window.__apTrace) window.__apTrace = [];
        window.__apTrace.push({
          t: Math.round(performance.now()),
          tag,
          turn: report.turns,
          phase: state.phase,
          busy: g.busy,
          cur: state.currentPlayerIndex,
          isAI: p.isAI,
          pos: p.position,
        });
        if (window.__apTrace.length > 60) window.__apTrace.shift();
      };
      trace('loop');

      if (p.isAI) {
        // AI 回合：等待它自动行动完
        await waitFor(() => state.currentPlayerIndex !== state.players.indexOf(p)
          || state.phase === 'gameover', 8000);
        await sleep(40);
        continue;
      }

      // 真人回合
      try {
        if (state.phase === 'await-roll') {
          const posBefore = p.position;
          trace('roll-before');
          g.handleRoll();
          trace('roll-called');
          // 等待「掷骰 -> 移动 -> 结算」整段结束：
          //   先等 busy 变 true（进入移动），再等 busy 变 false（结算完成）
          await waitFor(() => g.busy === true, 2000);
          trace('busy-true');
          await waitFor(() => g.busy === false && p.position !== posBefore, 8000);
          trace('settled');
        }

        // 等待移动动画 / 结算，并随手处理弹窗
        const t0 = Date.now();
        let modalHandled = false;
        while (Date.now() - t0 < 8000) {
          await sleep(25);
          const root = document.getElementById('modal-root');
          if (root && !root.hidden && root.querySelector('.modal-box')) {
            await handleModal();
            modalHandled = true;
            break;
          }
          if (g.busy === false && state.phase !== 'moving') break;
        }
        if (!modalHandled) await handleModal();
        await sleep(60);

        // 升级 / 质押 / 赎回（覆盖这些代码路径）
        if (p.institutions.length && Math.random() < 0.5) {
          const inst = p.institutions[Math.floor(Math.random() * p.institutions.length)];
          try {
            const mod = await import('/src/core/rules.js');
            const res = mod.upgradeInstitution(state, p, inst.cellIndex);
            if (res.ok) report.upgrades++;
          } catch (e) { report.errors.push('upgrade: ' + e.message); }
        }
        if (p.institutions.length && Math.random() < 0.4) {
          try {
            const mod = await import('/src/core/rules.js');
            const free = p.institutions.find((i) => !i.mortgaged);
            if (free) {
              if (mod.mortgageInstitution(state, p, free.cellIndex).ok) report.mortgages++;
              if (mod.redeemInstitution(state, p, free.cellIndex).ok) report.redeems++;
            }
          } catch (e) { report.errors.push('mortgage: ' + e.message); }
        }

        if (state.phase !== 'await-roll' && state.phase !== 'gameover') g.handleEndTurn();
      } catch (e) {
        report.errors.push(String((e && e.stack) || e));
        if (report.errors.length > 5) break;
      }

      report.turns++;
      await sleep(30);
    }

    report.finished = state.phase === 'gameover';
    report.round = state.round;
    report.turnNumber = state.turnNumber;
    report.alive = state.players.filter((x) => !x.bankrupt).length;
    report.bankrupt = state.players.filter((x) => x.bankrupt).map((x) => x.name);
    report.winner = (state.players.filter((x) => !x.bankrupt)[0] || {}).name || null;
    report.assets = state.players.map((x) => x.name + ' ￥' + x.cash);
    return report;
  }

  window.__autoPlay = autoPlay;
})();
