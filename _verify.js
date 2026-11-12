/**
 * 临时验证脚本（验证完即删除）—— 在真实游戏页内运行，把结果写入 document.title 分段回报。
 */
export async function runVerify() {
  const lines = [];
  const log = (s) => lines.push(s);
  const flush = () => { document.title = 'V|' + lines.join(' ⏎ '); };

  const errs = [];
  window.addEventListener('error', (e) => errs.push(String(e.message)));
  window.addEventListener('unhandledrejection', (e) => errs.push('rej:' + String(e.reason)));
  const origErr = console.error.bind(console);
  console.error = (...a) => { errs.push('console.error:' + a.map(String).join(' ')); origErr(...a); };

  try {
    const g = window.__game;
    if (!g) throw new Error('window.__game 未就绪');
    log('game ready');

    // ---- 1. selftest ----
    const st = await import('/src/core/selftest.js');
    const res = st.runAll();
    const fails = res.filter((r) => !r.pass);
    log(`SELFTEST ${res.length - fails.length}/${res.length}`);
    for (const f of fails) log('FAIL:' + f.name + '::' + f.detail);
    flush();

    // ---- 2. autoplay 回归 ----
    g.beginGame({
      seed: 'regress-1', difficulty: 'normal', aiCount: 3, diceCount: 2,
      cash: 'standard', market: 'normal', nickname: '回归', avatar: 0, rounds: 'standard',
    });
    await new Promise((r) => setTimeout(r, 400));
    const sc = document.createElement('script');
    sc.src = '/tools/autoplay.js';
    document.head.appendChild(sc);
    await new Promise((r) => setTimeout(r, 900));
    const hasAuto = typeof window.__autoPlay === 'function';
    log('AUTOPLAY_LOADED ' + hasAuto);
    flush();

    if (hasAuto) {
      try {
        const ap = await window.__autoPlay(g, 300);
        log('APOUT ' + JSON.stringify(ap));
      } catch (e) {
        log('APERR ' + (e && e.message));
      }
    }
    const state = g.state;
    log(`STATE round=${state.round} turn=${state.turnNumber} phase=${state.phase}`);
    for (const p of state.players) {
      const s2 = p.stats || {};
      log(`P ${p.name} bk=${p.bankrupt} cash=${p.cash} inst=${p.institutions.length} `
        + `acq=${s2.acquisitions} upg=${s2.upgrades} acqSp=${s2.acquisitionSpend} `
        + `upgSp=${s2.upgradeSpend} rentC=${s2.rentsCollected} rentP=${s2.rentsPaid} `
        + `redeemSp=${s2.redeemSpend}`);
    }
    flush();

    const { financialMetrics } = await import('/src/core/economy.js');

    // ---- 3. 破产玩家 ----
    let bank = state.players.find((p) => p.bankrupt);
    if (!bank) {
      bank = JSON.parse(JSON.stringify(state.players[0]));
      bank.bankrupt = true; bank.institutions = [];
      log('BANK constructed');
    }
    const mb = financialMetrics(bank, state);
    log(`BANK assets=${mb.assets} debt=${mb.debt} net=${mb.netWorth} bk=${mb.bankrupt}`);
    g.openPlayerDetail(bank, 99);
    log(`BANK_DIALOG open=${!document.getElementById('modal-root').hidden} rows=${document.querySelectorAll('#modal-box .fin-row').length} head=${document.querySelector('#modal-box .fin-head-name')?.textContent}`);
    document.getElementById('modal-backdrop').click();
    flush();

    // ---- 4. 无机构玩家 ----
    const empty = JSON.parse(JSON.stringify(state.players[0]));
    empty.bankrupt = false; empty.institutions = []; empty.cash = 1600;
    empty.loans = []; empty.bonds = []; empty.subscribedBonds = [];
    const me = financialMetrics(empty, state);
    log(`EMPTY assets=${me.assets} net=${me.netWorth} debt=${me.debt} avgLv=${me.avgLevel} rent=${me.rentIncome} cnt=${me.institutionCount}`);
    g.openPlayerDetail(empty, 1);
    log(`EMPTY_DIALOG rows=${document.querySelectorAll('#modal-box .fin-row').length}`);
    document.getElementById('modal-backdrop').click();

    // ---- 5. 布局 ----
    g.updateHUD();
    document.querySelectorAll('#rank-list .rank-item')[0].click();
    const box = document.getElementById('modal-box');
    const grid = box.querySelector('.fin-grid');
    const r0 = box.getBoundingClientRect();
    log(`LAYOUT cols=${getComputedStyle(grid).gridTemplateColumns} modal=${r0.width | 0}x${r0.height | 0} ovfX=${box.scrollWidth > box.clientWidth}`);
    const ratio = box.querySelector('.fin-ratio-note');
    if (ratio) log('RATIO ' + ratio.textContent.replace(/\s+/g, ' ').trim());
    document.getElementById('modal-backdrop').click();

    // ---- 6. 键盘 ----
    const row = document.querySelectorAll('#rank-list .rank-item')[0];
    log(`A11Y role=${row.getAttribute('role')} tabindex=${row.getAttribute('tabindex')} arrow=${!!row.querySelector('.rank-drill')}`);
    row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    log('KB_ENTER ' + !document.getElementById('modal-root').hidden);
    document.getElementById('modal-backdrop').click();

    // ---- 7. 菜单 ----
    g.el['btn-menu'].click();
    const items = [...document.querySelectorAll('#modal-box .menu-list .pixel-btn')].map((b) => b.textContent);
    log('MENU ' + JSON.stringify(items));
    const finBtn = [...document.querySelectorAll('#modal-box .menu-list .pixel-btn')].find((b) => b.textContent === '财务指标总览');
    if (finBtn) {
      finBtn.click();
      log('MENU_DIALOG open=' + !document.getElementById('modal-root').hidden + ' title=' + document.querySelector('#modal-box .modal-title')?.textContent);
      document.getElementById('modal-backdrop').click();
    }

    // ---- 8. 窄视口 ----
    const iframe = document.createElement('iframe');
    iframe.style.cssText = 'position:fixed;left:0;top:0;width:390px;height:780px;border:0;z-index:99999;';
    iframe.src = '/index.html';
    document.body.appendChild(iframe);
    await new Promise((r) => setTimeout(r, 1200));
    try {
      const iw = iframe.contentWindow;
      const ig = iw.document;
      const igame = iw.__game;
      log('IFRAME game=' + !!igame);
      if (igame) {
        igame.beginGame({
          seed: 'narrow', difficulty: 'normal', aiCount: 3, diceCount: 2,
          cash: 'standard', market: 'normal', nickname: '窄', avatar: 0, rounds: 'standard',
        });
        await new Promise((r) => setTimeout(r, 500));
        igame.openPlayerDetail(igame.state.players[0], 1);
        const ibox = ig.document.getElementById('modal-box');
        const igrid = ibox.querySelector('.fin-grid');
        const ir = ibox.getBoundingClientRect();
        log(`NARROW cols=${iw.getComputedStyle(igrid).gridTemplateColumns} modal=${ir.width | 0}x${ir.height | 0} ovfX=${ibox.scrollWidth > ibox.clientWidth} winW=${iw.innerWidth}`);
        const ih = ibox.querySelector('.fin-head').getBoundingClientRect();
        log(`NARROW_HEAD ${ih.width | 0}x${ih.height | 0}`);
      }
    } catch (e) {
      log('IFRAME_ERR ' + e.message);
    }
    iframe.remove();

    // ---- 9. console ----
    log('ERRORS ' + JSON.stringify(errs));
    log('DONE');
  } catch (e) {
    log('FATAL ' + (e && e.stack ? e.stack : e));
  }
  flush();
}
