/**
 * 主控制器 —— 串联规则引擎、渲染、AI、UI。
 */

import { BOARD_CELLS, BOARD_SIZE, EVENT_CARDS, TRAP_CARDS, GROUP_META } from '../core/board.js';
import {
  CONFIG, calculateRent, upgradeCost, mortgageValue, redeemFee,
  totalAssets, levelLabel, allGroupBuffs, globalRegulatorEffects,
  groupBuffTier, outstandingLoan, bondRedeemValue,
} from '../core/economy.js';
import {
  createState, log, currentPlayer, computeMove, computeTeleportSteps,
  rollDice, movePlayer, settleOnCell, resolvePurchase, upgradeInstitution,
  mortgageInstitution, redeemInstitution, endTurn, checkBankruptcy, rankPlayers,
  applyEventCard, applyTrapCard, takeCentralLoan, repayLoan, issueBond,
} from '../core/rules.js';
import {
  decide, planTurn, wantsReroll, assignPersonalities, aiName,
  decideBondSubscription, decideLoan, playerPersonality,
} from '../core/ai.js';
import { makeRng, randomSeed, hashSeed } from '../core/rng.js';
import { BoardRenderer } from '../render/canvas.js';
import { Background } from '../render/background.js';
import { Effects, MoveAnimator } from '../render/effects.js';
import { Sfx } from '../audio/sfx.js';
import { renderPlayerCards, renderRank, appendLog, clearLog, drawKline } from './hud.js';
import {
  showPurchaseDialog, showInstitutionDialog, showMetroDialog,
  showEventCardDialog, showGameOverDialog, showMenuDialog,
  showLoanDialog, showBondDialog, showTrapDialog, showBuffPanel,
  showPlayerDetailDialog,
} from './dialogs.js';
import { showTutorial } from './tutorial.js';
import { openShareDialog, parseShareUrl } from './share.js';
import { saveRecord, saveSettings, loadSettings } from './persist.js';
import { AVATARS, getAvatarIcon } from '../art/avatars.js';
import { PALETTE } from '../core/palette.js';
import { delay, interval } from '../core/scheduler.js';

class Game {
  constructor() {
    this.state = null;
    this.renderer = null;
    this.background = null;
    this.effects = new Effects();
    this.mover = new MoveAnimator();
    this.sfx = new Sfx();
    this.el = {};
    this.running = false;
    this.busy = false;
    this.config = null;
    this.effectsEnabled = true;
  }

  init() {
    this.cacheElements();
    this.setupSetupScreen();
    this.setupGameEvents();
    this.handleShareLink();
    window.addEventListener('resize', () => this.onResize());

    // 棋盘容器尺寸变化时（窗口缩放、字体加载、面板增减）自动重算画布尺寸。
    // 只监听 #board-wrap，避免 HUD 面板变化误触发。
    //
    // 注意：ResizeObserver 的回调发生在「布局 → 观测尺寸」同一次刷新周期内。
    // 若回调里同步改变被观测元素的子节点尺寸（这里是把画布重设为新尺寸），
    // 浏览器会判定为「观察循环未收敛」，抛出
    // "ResizeObserver loop completed with undelivered notifications" 错误。
    // 因此把重算推迟到下一帧执行，避开同批次布局，循环即可收敛。
    if (typeof ResizeObserver !== 'undefined' && this.el['board-wrap']) {
      this.boardObserver = new ResizeObserver(() => {
        if (this._resizePending) return;
        this._resizePending = true;
        requestAnimationFrame(() => {
          this._resizePending = false;
          this.onResize();
        });
      });
      this.boardObserver.observe(this.el['board-wrap']);
    }

    // 标签页切到后台时浏览器会暂停 requestAnimationFrame，
    // 用非节流调度器兜底推进动画，避免回合被永久卡住。
    this.watchdog = interval(120, () => this.tickWatchdog());
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) this.tickWatchdog();
    });
  }

  /** 看门狗 —— 后台标签页中 RAF 停摆时强制完成移动动画 */
  tickWatchdog() {
    if (!this.state) return;
    if (this.mover && this.mover.active) {
      this.mover.update();
    }
  }

  cacheElements() {
    const ids = [
      'setup-screen', 'game-screen', 'setup-bg', 'logo-canvas',
      'input-nickname', 'avatar-picker', 'difficulty-picker', 'aicount-picker',
      'theme-picker', 'rounds-picker', 'dice-picker', 'cash-picker', 'market-picker',
      'ai-preview', 'chk-sound', 'chk-anim', 'chk-tutorial', 'btn-start',
      'board-canvas', 'board-wrap', 'stage-bg', 'fx-layer', 'hud-turn-name', 'hud-market', 'player-cards',
      'rank-list', 'kline-canvas', 'log-list', 'btn-roll', 'btn-assets',
      'btn-mortgage', 'btn-endturn', 'dice-tray', 'toast-layer',
      'btn-sound', 'btn-anim', 'btn-theme', 'btn-menu',
      'selftest-screen', 'selftest-output', 'btn-selftest-back',
    ];
    for (const id of ids) this.el[id] = document.getElementById(id);
  }

  /* ==================== 开局界面 ==================== */
  setupSetupScreen() {
    const settings = loadSettings();

    const ap = this.el['avatar-picker'];
    ap.innerHTML = '';
    AVATARS.forEach((a, i) => {
      const btn = document.createElement('button');
      btn.className = 'avatar-opt';
      btn.type = 'button';
      btn.title = `${a.name} —— ${a.desc}`;
      btn.setAttribute('role', 'radio');
      btn.setAttribute('aria-label', a.name);
      const cv = getAvatarIcon(i, 0);
      cv.style.width = '32px';
      cv.style.height = '48px';
      btn.appendChild(cv);
      btn.addEventListener('click', () => {
        this.setup.avatar = i;
        this.refreshAvatars();
        this.sfx.unlock();
        this.sfx.click();
      });
      ap.appendChild(btn);
    });

    this.setup = {
      nickname: settings.nickname || '你',
      avatar: settings.avatar ?? 0,
      difficulty: settings.difficulty || 'normal',
      aiCount: settings.aiCount ?? 3,
      theme: settings.theme || 'finance',
      diceCount: settings.diceCount ?? 2,
      cash: settings.cash || 'standard',
      market: settings.market || 'normal',
      sound: settings.sound !== false,
      anim: settings.anim !== false,
      tutorial: settings.tutorial !== false,
      rounds: 'standard',
    };

    this.el['input-nickname'].value = this.setup.nickname;
    this.el['input-nickname'].addEventListener('input', (e) => {
      this.setup.nickname = e.target.value.slice(0, 10) || '你';
    });

    this.buildSegments('difficulty-picker', [
      { id: 'novice', label: '新手' },
      { id: 'normal', label: '普通' },
      { id: 'expert', label: '老手' },
    ], (v) => { this.setup.difficulty = v; this.refreshAiPreview(); });

    this.buildSegments('aicount-picker', [
      { id: '1', label: '1 位' },
      { id: '2', label: '2 位' },
      { id: '3', label: '3 位' },
    ], (v) => { this.setup.aiCount = parseInt(v, 10); this.refreshAiPreview(); });

    this.buildSegments('theme-picker', [
      { id: 'finance', label: '金融城' },
      { id: 'classic', label: '经典' },
    ], (v) => { this.setup.theme = v; });

    this.buildSegments('rounds-picker', [
      { id: 'short', label: '速通局' },
      { id: 'standard', label: '标准局' },
      { id: 'long', label: '长局' },
    ], (v) => { this.setup.rounds = v; });

    this.buildSegments('dice-picker', [
      { id: '1', label: '1 颗' },
      { id: '2', label: '2 颗' },
      { id: '3', label: '3 颗' },
    ], (v) => { this.setup.diceCount = parseInt(v, 10); });

    this.buildSegments('cash-picker', [
      { id: 'tight', label: '紧巴 ￥1200' },
      { id: 'standard', label: '标准 ￥1600' },
      { id: 'loose', label: '宽裕 ￥2200' },
    ], (v) => { this.setup.cash = v; });

    this.buildSegments('market-picker', [
      { id: 'normal', label: '震荡市' },
      { id: 'bull', label: '牛市开局' },
      { id: 'bear', label: '熊市开局' },
    ], (v) => { this.setup.market = v; });

    this.el['chk-sound'].checked = this.setup.sound;
    this.el['chk-anim'].checked = this.setup.anim;
    this.el['chk-tutorial'].checked = this.setup.tutorial;

    this.refreshAvatars();
    this.refreshSegments();
    this.refreshAiPreview();

    this.el['btn-start'].addEventListener('click', () => this.startGame());

    this.setupBg = new Background(window.innerWidth, window.innerHeight);
    this.drawSetupBg();
    this.setupBgTimer = interval(100, () => this.drawSetupBg());
  }

  buildSegments(containerId, options, setter) {
    const el = this.el[containerId];
    el.innerHTML = '';
    options.forEach((o) => {
      const b = document.createElement('button');
      b.className = 'seg-opt';
      b.type = 'button';
      b.textContent = o.label;
      b.dataset.id = o.id;
      b.setAttribute('role', 'radio');
      b.addEventListener('click', () => {
        setter(o.id);
        this.refreshSegments();
        this.sfx.unlock();
        this.sfx.click();
      });
      el.appendChild(b);
    });
  }

  refreshSegments() {
    const map = {
      'difficulty-picker': () => this.setup.difficulty,
      'aicount-picker': () => String(this.setup.aiCount),
      'theme-picker': () => this.setup.theme,
      'rounds-picker': () => this.setup.rounds,
      'dice-picker': () => String(this.setup.diceCount),
      'cash-picker': () => this.setup.cash,
      'market-picker': () => this.setup.market,
    };
    for (const [id, getter] of Object.entries(map)) {
      const cur = getter();
      [...this.el[id].children].forEach((b) => {
        b.classList.toggle('is-sel', b.dataset.id === cur);
        b.setAttribute('aria-checked', b.dataset.id === cur ? 'true' : 'false');
      });
    }
  }

  refreshAvatars() {
    [...this.el['avatar-picker'].children].forEach((b, i) => {
      b.classList.toggle('is-sel', i === this.setup.avatar);
      b.setAttribute('aria-checked', i === this.setup.avatar ? 'true' : 'false');
    });
  }

  refreshAiPreview() {
    const el = this.el['ai-preview'];
    el.innerHTML = '';
    const rng = makeRng(hashSeed('preview-' + this.setup.difficulty + this.setup.aiCount));
    const personalities = assignPersonalities(rng, this.setup.aiCount);
    const colors = ['#3fc6c6', '#c8392b', '#a06cd5', '#4f8f8b'];
    personalities.forEach((p, i) => {
      const row = document.createElement('div');
      row.className = 'ai-row';
      row.style.borderLeftColor = colors[i % colors.length];
      row.innerHTML = `
        <span class="ai-name">AI ${i + 1}</span>
        <span class="ai-tag">${p.tag}</span>
        <span class="ai-desc">${p.desc}</span>
      `;
      el.appendChild(row);
    });
  }

  drawSetupBg() {
    const cv = this.el['setup-bg'];
    if (!cv) return;
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (cv.width !== w || cv.height !== h) {
      cv.width = w;
      cv.height = h;
      this.setupBg.resize(w, h);
    }
    const ctx = cv.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    this.setupBg.setPhase(3);
    this.setupBg.draw(ctx, performance.now());
  }

  /* ==================== 开局 ==================== */
  startGame() {
    this.sfx.unlock();
    const seed = randomSeed();
    this.config = {
      seed,
      difficulty: this.setup.difficulty,
      aiCount: this.setup.aiCount,
      diceCount: this.setup.diceCount,
      cash: this.setup.cash,
      market: this.setup.market,
      nickname: this.setup.nickname,
      avatar: this.setup.avatar,
      rounds: this.setup.rounds,
    };
    this.beginGame(this.config);
  }

  beginGame(config) {
    clearInterval(this.setupBgTimer);

    const rng = makeRng(config.seed);
    const personalities = assignPersonalities(rng, config.aiCount);

    const players = [{
      id: 0, name: config.nickname || '你', isAI: false,
      avatar: config.avatar, colorIndex: 0, personality: null,
    }];

    personalities.forEach((p, i) => {
      players.push({
        id: i + 1,
        name: aiName(rng, p),
        isAI: true,
        avatar: (i + 1) % AVATARS.length,
        colorIndex: i + 1,
        personality: p,
      });
    });

    const cash = CONFIG.cashLevels[config.cash] ?? CONFIG.cashLevels.standard;

    this.state = createState({
      seed: config.seed,
      players,
      diceCount: config.diceCount,
      cash,
      market: config.market,
      difficulty: config.difficulty,
      theme: config.theme,
      aiCount: config.aiCount,
    });

    this.state.maxTurns = config.rounds === 'short' ? 800 : config.rounds === 'long' ? 20000 : 5000;

    this.effects = new Effects();
    this.effects.enabled = this.setup.anim !== false;
    this.effectsEnabled = this.setup.anim !== false;
    this.mover = new MoveAnimator();

    if (this.setupBgTimer) { this.setupBgTimer.cancel(); this.setupBgTimer = null; }
    this.el['setup-screen'].hidden = true;
    this.el['game-screen'].hidden = false;
    this.el['selftest-screen'].hidden = true;

    this.renderer = new BoardRenderer(this.el['board-canvas']);
    this.background = new Background(window.innerWidth, window.innerHeight);
    this.onResize();
    // 布局稳定后再量一次（隐藏→显示后容器尺寸才最终确定）
    requestAnimationFrame(() => this.onResize());

    clearLog(this.el['log-list']);
    log(this.state, 'sys', `开局！种子 ${config.seed}，${players.length} 位玩家入场`, '开局');
    log(this.state, 'sys', `难度「${this.difficultyName(config.difficulty)}」，市场初始为${this.marketName(config.market)}`, '设定');
    for (const p of players) {
      if (p.personality) {
        log(this.state, 'ai', `${p.name}（${p.personality.name}）：${p.personality.quote}`, p.personality.tag);
      }
    }
    this.syncLog();

    saveSettings({ ...loadSettings(), ...this.setup, nickname: this.setup.nickname });

    this.updateHUD();
    this.startLoop();

    if (this.setup.tutorial) {
      this.setup.tutorial = false;
      showTutorial(() => this.beginPlayerTurn());
    } else {
      this.beginPlayerTurn();
    }
  }

  difficultyName(d) {
    return { novice: '新手', normal: '普通', expert: '老手' }[d] || d;
  }

  marketName(m) {
    return { bull: '牛市', bear: '熊市', normal: '震荡市' }[m] || m;
  }

  /* ==================== 游戏事件 ==================== */
  setupGameEvents() {
    this.el['btn-roll'].addEventListener('click', () => this.handleRoll());
    this.el['btn-assets'].addEventListener('click', () => this.handleShowAssets());
    this.el['btn-mortgage'].addEventListener('click', () => this.handleShowAssets());
    this.el['btn-endturn'].addEventListener('click', () => this.handleEndTurn());

    this.el['btn-sound'].addEventListener('click', () => {
      this.sfx.setEnabled(!this.sfx.enabled);
      this.el['btn-sound'].classList.toggle('is-off', !this.sfx.enabled);
      if (this.sfx.enabled) this.sfx.click();
      this.toast(this.sfx.enabled ? '音效开启' : '音效关闭');
    });

    this.el['btn-anim'].addEventListener('click', () => {
      this.effectsEnabled = !this.effectsEnabled;
      this.effects.enabled = this.effectsEnabled;
      document.body.classList.toggle('no-anim', !this.effectsEnabled);
      this.el['btn-anim'].classList.toggle('is-off', !this.effectsEnabled);
      this.toast(this.effectsEnabled ? '特效开启' : '特效关闭（保帧率）');
    });

    this.el['btn-theme'].addEventListener('click', () => {
      document.body.classList.toggle('theme-light');
      this.toast(document.body.classList.contains('theme-light') ? '亮色主题' : '暗色主题');
    });

    this.el['btn-menu'].addEventListener('click', () => this.handleMenu());

    this.el['btn-selftest-back'].addEventListener('click', () => {
      this.el['selftest-screen'].hidden = true;
      this.el['setup-screen'].hidden = false;
      this.setupBgTimer = interval(100, () => this.drawSetupBg());
    });

    document.addEventListener('keydown', (e) => {
      if (!this.state || this.el['game-screen'].hidden) return;
      if (!document.getElementById('modal-root').hidden) return;
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        this.handleRoll();
      }
    });

    this.el['board-canvas'].addEventListener('mousemove', (e) => {
      if (!this.renderer) return;
      const rect = this.el['board-canvas'].getBoundingClientRect();
      this.renderer.hoverCell = this.renderer.cellAt(e.clientX - rect.left, e.clientY - rect.top);
    });

    this.el['board-canvas'].addEventListener('mouseleave', () => {
      if (this.renderer) this.renderer.hoverCell = -1;
    });

    const unlock = () => { this.sfx.unlock(); document.removeEventListener('pointerdown', unlock); };
    document.addEventListener('pointerdown', unlock);
  }

  handleMenu() {
    showMenuDialog([
      { text: '分享战绩', primary: true, onClick: () => this.handleShare() },
      { text: '我的机构', onClick: () => this.handleShowAssets() },
      { text: '财务指标总览', onClick: () => this.openPlayerDetail(currentPlayer(this.state), null) },
      { text: '规则引擎自检', onClick: () => this.runSelfTest() },
      { text: '返回开局界面', onClick: () => this.backToSetup() },
    ]);
  }

  backToSetup() {
    this.running = false;
    if (this.setupBgTimer) { this.setupBgTimer.cancel(); this.setupBgTimer = null; }
    this.el['game-screen'].hidden = true;
    this.el['setup-screen'].hidden = false;
    this.setupBgTimer = interval(100, () => this.drawSetupBg());
    this.drawSetupBg();
  }

  handleShare() {
    openShareDialog(this.state, this.config, (msg, cls) => this.toast(msg, cls));
  }

  async runSelfTest() {
    const m = await import('../core/selftest.js');
    this.el['selftest-screen'].hidden = false;
    this.el['game-screen'].hidden = true;
    const results = m.runAll();
    const out = this.el['selftest-output'];
    out.innerHTML = '';
    let pass = 0;
    for (const r of results) {
      const row = document.createElement('div');
      row.className = 'st-row';
      row.innerHTML = `
        <span class="${r.pass ? 'st-pass' : 'st-fail'}">${r.pass ? 'PASS' : 'FAIL'}</span>
        <span class="st-desc">${r.name}<br><span class="st-detail">${r.detail}</span></span>
      `;
      out.appendChild(row);
      if (r.pass) pass++;
    }
    const summary = document.createElement('div');
    summary.className = 'st-row';
    summary.innerHTML = `<span class="${pass === results.length ? 'st-pass' : 'st-fail'}">${pass}/${results.length}</span><span class="st-desc">全部通过</span>`;
    out.appendChild(summary);
  }

  /* ==================== 回合流程 ==================== */
  beginPlayerTurn() {
    if (!this.state || this.state.phase === 'gameover') return;
    const p = currentPlayer(this.state);
    if (p.bankrupt) { this.advanceTurn(); return; }
    this.state.phase = 'await-roll';
    this.updateHUD();
    if (!p.isAI) {
      this.sfx.startTurn();
      this.toast(`轮到 ${p.name} 行动`, 't-gold');
    }
  }

  handleRoll() {
    if (!this.state || this.busy) return;
    const p = currentPlayer(this.state);
    if (!p || p.bankrupt) return;
    if (this.state.phase !== 'await-roll') return;
    this.sfx.unlock();

    const { dice } = rollDice(this.state, p);
    const total = dice.reduce((a, b) => a + b, 0);
    this.showDice(dice);
    this.sfx.diceRoll();

    delay(620, () => {
      this.sfx.diceLand();
      this.moveAndSettle(p, total);
    });
  }

  showDice(dice) {
    const tray = this.el['dice-tray'];
    tray.innerHTML = '';
    import('../art/ui-icons.js').then((m) => {
      for (const d of dice) {
        const cv = document.createElement('canvas');
        cv.className = 'die';
        cv.width = 16;
        cv.height = 16;
        cv.style.width = '44px';
        cv.style.height = '44px';
        const ctx = cv.getContext('2d');
        ctx.imageSmoothingEnabled = false;
        tray.appendChild(cv);

        const frames = m.getDieRollFrames();
        let i = 0;
        const timer = interval(90, () => {
          ctx.clearRect(0, 0, 16, 16);
          ctx.imageSmoothingEnabled = false;
          ctx.drawImage(frames[i % frames.length], 0, 0, 16, 16);
          i++;
          if (i > 6) {
            timer.cancel();
            ctx.clearRect(0, 0, 16, 16);
            ctx.drawImage(m.getDie(d), 0, 0, 16, 16);
            cv.classList.add('settle');
          }
        });
      }
      setTimeout(() => { tray.innerHTML = ''; }, 2200);
    });
  }

  /** 逐格跳跃移动 */
  moveAndSettle(player, steps) {
    // 防御：步数必须为正整数，否则原地不动（避免位置被写成 undefined）
    steps = Math.max(0, Math.floor(steps || 0));
    if (steps === 0) {
      this.afterMove(player, false);
      return;
    }
    this.busy = true;
    const from = player.position;
    const path = [];
    for (let i = 1; i <= steps; i++) path.push((from + i) % BOARD_SIZE);

    let stepTick = 0;
    const stepTimer = interval(120, () => {
      this.sfx.step();
      stepTick++;
      if (stepTick >= steps) stepTimer.cancel();
    });

    this.mover.start({
      playerId: player.id,
      from,
      to: path[path.length - 1],
      steps,
      path,
      onDone: () => {
        stepTimer.cancel();
        const passedStart = computeMove(from, steps, BOARD_SIZE).passedStart;
        player.position = path[path.length - 1];
        player.lastAction = { ...(player.lastAction || {}), passedStart };
        this.afterMove(player, passedStart);
      },
    });
  }

  afterMove(player, passedStart) {
    const state = this.state;

    if (passedStart) {
      // 起点补贴由 settleOnCell 统一发放（带去重标记），此处仅记录日志与特效
      player._startBonusGranted = false;
      const c = this.cellCenter(player.position);
      const results = settleOnCell(state, player, player.position);
      this.handleSettlement(player, results);
      if (player._startBonusGranted) {
        log(state, player.isAI ? 'ai' : 'good',
          `${player.name} 经过陆家嘴金融中心，获得货币发行补贴 ￥${CONFIG.startBonus}`, '补贴');
        this.sfx.buy();
        this.effects.floatUp(c.x, c.y, { count: 6, colors: [PALETTE.gold, PALETTE.amberLt] });
      }
      return;
    }

    const results = settleOnCell(state, player, player.position);
    this.handleSettlement(player, results);
  }

  handleSettlement(player, results) {
    const state = this.state;

    for (const r of results) {
      switch (r.kind) {
        case 'purchase-offer': {
          if (player.isAI) {
            this.aiPurchase(player, r);
          } else {
            this.busy = false;
            showPurchaseDialog(r.cell, r.price, r.level, player,
              () => {
                const ok = resolvePurchase(state, player, true);
                if (ok) this.onPurchased(player, r);
                this.busy = true;
                this.continueAfterSettlement(player);
              },
              () => {
                resolvePurchase(state, player, false);
                this.busy = true;
                this.continueAfterSettlement(player);
              });
            return;
          }
          break;
        }
        case 'rent-paid': {
          log(state, 'bad',
            `${player.name} 向 ${r.ownerName} 支付管理费 ￥${r.rent}（${r.cell.name}）`, '交租');
          this.sfx.payRent();
          const c = this.cellCenter(r.cellIndex);
          this.effects.burst(c.x, c.y, {
            count: 12, colors: [PALETTE.gold, PALETTE.amberLt, PALETTE.paper], speed: 2.6,
          });
          this.effects.triggerShake();
          this.shakeScreen();
          this.floatText(`-￥${r.rent}`, c, PALETTE.redLt);
          break;
        }
        case 'charge': {
          log(state, 'bad', `${player.name} 缴纳${r.reason} ￥${r.amount}`, '成本');
          this.sfx.deny();
          const c = this.cellCenter(player.position);
          this.effects.burst(c.x, c.y, { count: 8, colors: [PALETTE.glass, PALETTE.paperDeep], speed: 1.6 });
          this.floatText(`-￥${r.amount}`, c, PALETTE.redLt);
          break;
        }
        case 'teleport': {
          log(state, 'sys', `${player.name} 触发${r.reason}，直达 ${state.board[r.target].name}`, '跳转');
          this.sfx.teleport();
          const c = this.cellCenter(player.position);
          this.effects.confetti(c.x, c.y);
          const steps = computeTeleportSteps(player.position, r.target, BOARD_SIZE);
          this.moveAndSettle(player, steps);
          return;
        }
        case 'metro-choice': {
          if (player.isAI) {
            const steps = state.rng.int(1, 3);
            log(state, 'ai', `${player.name} 换乘地铁，前进 ${steps} 格`, '地铁');
            this.moveAndSettle(player, steps);
          } else {
            this.busy = false;
            showMetroDialog((s) => {
              log(state, 'self', `${player.name} 换乘地铁，前进 ${s} 格`, '地铁');
              this.busy = true;
              this.moveAndSettle(player, s);
            });
            return;
          }
          break;
        }
        case 'event-card': {
          if (player.isAI) {
            this.applyEvent(player, r.card);
          } else {
            this.busy = false;
            this.sfx.cardFlip();
            showEventCardDialog(r.card, r.card.effect, () => {
              this.applyEvent(player, r.card);
              this.busy = true;
              this.continueAfterSettlement(player);
            });
            return;
          }
          break;
        }
        case 'market-switch': {
          const label = r.market === 'bull' ? '牛市' : '熊市';
          log(state, r.market === 'bull' ? 'good' : 'bad',
            `行情切换：进入${label}，全场租金系数 ${r.market === 'bull' ? '+20%' : '-20%'}`, '周期');
          this.sfx[r.market === 'bull' ? 'marketBull' : 'marketBear']();
          this.toast(`行情切换：${label}`, r.market === 'bull' ? 't-bad' : 't-good');
          break;
        }
        case 'upgrade-permit': {
          // 踩到自有机构 —— 获得升级许可
          const inst = player.institutions.find((i) => i.cellIndex === r.cellIndex);
          const canUpgrade = inst && inst.level < r.cell.maxLevel;
          if (canUpgrade) {
            log(state, player.isAI ? 'ai' : 'good',
              `${player.name} 踏足自有「${r.cell.name}」，可升级至${levelLabel(inst.level + 1)}`, '升级');
            this.sfx.upgrade();
            const c = this.cellCenter(r.cellIndex);
            this.effects.dust(c.x, c.y, 12);
            this.floatText('可升级', c, PALETTE.gold);
          }
          break;
        }
        case 'pbc-bonus': {
          log(state, 'good', `中国人民银行流动性投放 +￥${r.amount}`, '央行');
          this.floatText(`+￥${r.amount}`, this.cellCenter(player.position), PALETTE.jadeLt);
          break;
        }
        case 'loan-offer': {
          // 绕圈后可向央行贷款
          if (player.isAI) {
            this.aiLoan(player, r);
          } else {
            this.busy = false;
            showLoanDialog(player, r.tiers,
              (tierId) => {
                const res = takeCentralLoan(this.state, player, tierId);
                if (res.ok) {
                  this.sfx.buy();
                  this.floatText(`+￥${res.amount}`, this.cellCenter(player.position), PALETTE.gold);
                  this.toast(`已获央行贷款 ￥${res.amount}`, 't-gold');
                }
                this.busy = true;
                this.continueAfterSettlement(player);
              },
              () => {
                this.busy = true;
                this.continueAfterSettlement(player);
              });
            return;
          }
          break;
        }
        case 'bond-offer': {
          // 再融资窗口 —— 向其他玩家发行债券
          if (player.isAI) {
            this.aiBond(player);
          } else {
            this.busy = false;
            showBondDialog(player, this.state,
              (decisions) => {
                const res = issueBond(this.state, player, decisions);
                if (res.ok) {
                  this.sfx.buy();
                  this.floatText(`+￥${res.raised}`, this.cellCenter(player.position), PALETTE.jadeLt);
                  this.toast(`债券发行成功，募资 ￥${res.raised}`, 't-good');
                } else {
                  this.sfx.deny();
                  this.toast(res.reason, 't-bad');
                }
                this.busy = true;
                this.continueAfterSettlement(player);
              },
              () => {
                this.busy = true;
                this.continueAfterSettlement(player);
              });
            return;
          }
          break;
        }
        case 'trap-card': {
          log(state, 'bad', `${player.name} 触发监管陷阱「${r.card.title}」`, '监管');
          this.sfx.deny();
          const c = this.cellCenter(player.position);
          this.effects.burst(c.x, c.y, { count: 14, colors: [PALETTE.red, PALETTE.redLt, PALETTE.amber], speed: 2.4 });
          this.effects.triggerShake();
          this.shakeScreen();
          this.floatText('监管!', c, PALETTE.redLt);
          break;
        }
        default:
          break;
      }
    }

    this.continueAfterSettlement(player);
  }

  /** AI 申请央行贷款 */
  aiLoan(player, r) {
    const state = this.state;
    const tiers = r.tiers || CONFIG.loanTiers;
    // 选一个能覆盖当前现金缺口的档位
    const need = Math.max(0, 800 - player.cash);
    let chosen = tiers[0];
    for (const t of tiers) {
      if (t.amount >= need) { chosen = t; break; }
      chosen = t;
    }
    const d = decideLoan(state, player, chosen);
    if (d.take) {
      const res = takeCentralLoan(state, player, chosen.id);
      if (res.ok) {
        log(state, 'ai', `${player.name}：${d.reason}，获贷 ￥${res.amount}`, playerPersonality(player).tag);
      }
    } else {
      log(state, 'ai', `${player.name}：${d.reason}`, playerPersonality(player).tag);
    }
  }

  /** AI 发行债券 —— 逐一征询其他玩家认购意愿 */
  aiBond(player) {
    const state = this.state;
    const decisions = [];
    for (const other of state.players) {
      if (other.id === player.id || other.bankrupt) continue;
      const d = decideBondSubscription(state, other, player);
      decisions.push({ playerId: other.id, subscribed: d.subscribed, reason: d.reason });
    }
    const res = issueBond(state, player, decisions);
    if (res.ok) {
      log(state, 'ai', `${player.name} 成功发行债券，募资 ￥${res.raised}`, playerPersonality(player).tag);
      for (const d of decisions) {
        const buyer = state.players.find((p) => p.id === d.playerId);
        // 认购方可能是真人玩家（personality 为 null），需回退到默认性格标签
        if (buyer) log(state, 'ai', `${buyer.name} ${d.subscribed ? '认购' : '放弃'}：${d.reason}`, playerPersonality(buyer).tag);
      }
    } else {
      log(state, 'ai', `${player.name} 债券发行失败：${res.reason}`, playerPersonality(player).tag);
    }
  }

  applyEvent(player, card) {
    const res = applyEventCard(this.state, player, card);
    log(this.state, player.isAI ? 'ai' : 'sys',
      `${player.name} 抽到「${card.title}」：${card.text}`, '事件');
    if (res.cash) {
      this.floatText(`${res.cash > 0 ? '+' : ''}￥${res.cash}`, this.cellCenter(player.position),
        res.cash > 0 ? PALETTE.jadeLt : PALETTE.redLt);
    }
    const c = this.cellCenter(player.position);
    this.effects.floatUp(c.x, c.y, { count: 8, colors: [PALETTE.gold, PALETTE.neon] });
  }

  onPurchased(player, r) {
    this.sfx.buy();
    const c = this.cellCenter(r.cellIndex);
    this.effects.floatUp(c.x, c.y, { count: 10, colors: [PALETTE.gold, PALETTE.amberLt, PALETTE.paper] });
    this.effects.burst(c.x, c.y, { count: 14, colors: [PALETTE.gold, PALETTE.amberLt], speed: 2.8 });
    this.floatText(`-￥${r.price}`, c, PALETTE.amber);
    log(this.state, player.isAI ? 'ai' : 'good',
      `${player.name} 收购了 ${r.cell.name}（￥${r.price}）`, '收购');
  }

  continueAfterSettlement(player) {
    const state = this.state;

    if (!player.isAI) {
      this.state.phase = 'await-decision';
      this.updateHUD();
      this.busy = false;
      return;
    }

    this.runAIEconomy(player);
    checkBankruptcy(state, player);
    this.syncLog();
    this.updateHUD();
    this.busy = false;
    delay(500, () => this.advanceTurn());
  }

  /* ==================== AI ==================== */
  aiPurchase(player, r) {
    const state = this.state;
    const decision = decide(state, player, 'purchase', { cellIndex: r.cellIndex });

    if (decision.action === 'buy' && player.cash >= r.price) {
      resolvePurchase(state, player, true);
      this.onPurchased(player, r);
      log(state, 'ai', `${player.name}：${decision.reason}`, playerPersonality(player).tag);
    } else {
      resolvePurchase(state, player, false);
      log(state, 'ai', `${player.name} 放弃 ${r.cell.name}：${decision.reason}`, playerPersonality(player).tag);
    }
  }

  runAIEconomy(player) {
    const state = this.state;
    const plan = planTurn(state, player);

    if (plan.wantMortgage) {
      const d = decide(state, player, 'mortgage');
      if (d.action === 'mortgage') {
        mortgageInstitution(state, player, d.cellIndex);
        log(state, 'ai', `${player.name}：${d.reason}`, playerPersonality(player).tag);
      }
    }

    if (plan.wantUpgrade) {
      const d = decide(state, player, 'upgrade');
      if (d.action === 'upgrade') {
        const cell = state.board[d.cellIndex];
        const r = this.cellCenter(d.cellIndex);
        this.effects.dust(r.x, r.y, 16);
        const res = upgradeInstitution(state, player, d.cellIndex);
        if (res.ok) {
          this.effects.confetti(r.x, r.y);
          this.sfx.upgrade();
          log(state, 'ai', `${player.name}：${d.reason}`, playerPersonality(player).tag);
          this.floatText(`升级 ${cell.name}`, r, PALETTE.gold);
        }
      }
    }
  }

  /* ==================== 回合推进 ==================== */
  advanceTurn() {
    if (!this.state || this.state.phase === 'gameover') return;
    const state = this.state;
    const player = currentPlayer(state);

    const winner = endTurn(state);

    if (state.phase === 'gameover') {
      this.onGameOver(winner);
      return;
    }

    this.background.setPhase(state.round - 1);
    this.syncLog();
    this.updateHUD();

    const next = currentPlayer(state);
    if (next.isAI) {
      delay(500, () => this.runAITurn(next));
    } else {
      this.beginPlayerTurn();
    }
  }

  handleEndTurn() {
    if (!this.state || this.busy) return;
    const p = currentPlayer(this.state);
    if (p.isAI) return;
    if (this.state.phase === 'await-roll') {
      this.toast('请先掷骰子', 't-bad');
      this.sfx.deny();
      return;
    }
    this.state.phase = 'settling';
    this.advanceTurn();
  }

  runAITurn(player) {
    if (!this.state || this.state.phase === 'gameover') return;
    if (player.bankrupt) { this.advanceTurn(); return; }

    const state = this.state;
    this.state.phase = 'await-roll';
    this.updateHUD();

    const plan = planTurn(state, player);
    const personality = playerPersonality(player);
    if (plan.note) {
      log(state, 'ai', `${player.name}（${personality.tag}）：${plan.note}`, personality.tag);
    }

    const rr = wantsReroll(state, player);
    if (rr.use) {
      log(state, 'ai', `${player.name}：${rr.reason}`, personality.tag);
    }

    delay(700, () => {
      const first = rollDice(state, player);
      this.showDice(first.dice);
      this.sfx.diceRoll();

      delay(620, () => {
        this.sfx.diceLand();
        let finalTotal = first.total;
        if (rr.use) {
          const second = rollDice(state, player);
          finalTotal = second.total;
          log(state, 'ai', `${player.name} 加仓重掷：${first.total} → ${finalTotal}`, personality.tag);
        }
        this.moveAndSettle(player, finalTotal);
      });
    });
  }

  /* ==================== 玩家操作 ==================== */
  handleShowAssets() {
    const p = currentPlayer(this.state);
    if (!p || p.isAI) return;
    this.openAssetsDialog(p);
  }

  /** 打开某位玩家的财务指标下钻窗口（资产排行点击入口） */
  openPlayerDetail(p, rank) {
    if (!p || !this.state) return;
    this.sfx.click();
    showPlayerDetailDialog(this.state, p, { rank });
  }

  openAssetsDialog(p) {
    const self = this;
    showInstitutionDialog(p, this.state,
      (cellIndex) => {
        const res = upgradeInstitution(this.state, p, cellIndex);
        if (res.ok) {
          self.sfx.upgrade();
          const c = self.cellCenter(cellIndex);
          self.effects.dust(c.x, c.y, 14);
          self.effects.confetti(c.x, c.y);
          self.toast(`${self.state.board[cellIndex].name} 升级成功！`, 't-good');
          self.syncLog();
          self.updateHUD();
          self.openAssetsDialog(p);
        } else {
          self.sfx.deny();
          self.toast(res.reason, 't-bad');
        }
      },
      (cellIndex) => {
        const res = mortgageInstitution(this.state, p, cellIndex);
        if (res.ok) {
          self.sfx.buy();
          self.toast(`质押融资 ￥${res.amount}`, 't-gold');
          self.syncLog();
          self.updateHUD();
          self.openAssetsDialog(p);
        } else {
          self.sfx.deny();
          self.toast(res.reason, 't-bad');
        }
      },
      (cellIndex) => {
        const res = redeemInstitution(this.state, p, cellIndex);
        if (res.ok) {
          self.sfx.buy();
          self.toast(`赎回完成，支付 ￥${res.fee}`, 't-good');
          self.syncLog();
          self.updateHUD();
          self.openAssetsDialog(p);
        } else {
          self.sfx.deny();
          self.toast(res.reason, 't-bad');
        }
      });
  }

  /* ==================== 游戏结束 ==================== */
  onGameOver(winner) {
    this.running = false;
    const state = this.state;
    const ranked = rankPlayers(state);
    const player = state.players.find((p) => !p.isAI) || state.players[0];
    const playerIsWinner = !!winner && !!player && winner.id === player.id;

    this.sfx[playerIsWinner ? 'win' : 'bankrupt']();

    const c = player ? this.cellCenter(player.position) : { x: 0, y: 0 };
    for (let i = 0; i < 4; i++) {
      setTimeout(() => this.effects.confetti(c.x + (Math.random() - 0.5) * 200, c.y + (Math.random() - 0.5) * 100), i * 260);
    }

    const bestChain = Math.max(0, ...state.players.map((p) => p.stats.largestRent));
    saveRecord({
      seed: state.seed,
      winnerName: ranked[0] ? ranked[0].player.name : '—',
      winnerAssets: ranked[0] ? Math.max(0, ranked[0].assets) : 0,
      isPlayerWinner: playerIsWinner,
      rounds: state.round,
      turns: state.turnNumber,
      bestChain,
      players: state.players.map((p) => ({
        name: p.name, assets: Math.max(0, totalAssets(p, state)), count: p.institutions.length,
      })),
    });

    this.updateHUD();
    delay(700, () => {
      showGameOverDialog(state, ranked, playerIsWinner,
        () => this.handleShare(),
        () => this.backToSetup());
    });
  }

  /* ==================== 渲染循环 ==================== */
  startLoop() {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    const loop = (now) => {
      if (!this.running) return;
      this.lastTime = now;
      this.frame(now);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  frame(now) {
    const state = this.state;
    if (!state || !this.renderer) return;

    // 兜底尺寸同步：若棋盘容器尺寸与渲染器记录不一致（例如媒体查询
    // 刚刚切换、或字体加载导致行高变化），立即重算。
    // clientWidth/clientHeight 是整数且读取代价极低，逐帧检查无压力。
    this.syncBoardSize();

    // 背景层绘制到独立的 #stage-bg（覆盖整个 stage）
    const bgCanvas = this.el['stage-bg'];
    if (bgCanvas) {
      const bctx = bgCanvas.getContext('2d');
      const shake = this.effects.shakeOffset();
      bctx.save();
      bctx.imageSmoothingEnabled = false;
      bctx.translate(shake.x, shake.y);
      this.background.draw(bctx, now);
      bctx.restore();
    }

    this.mover.update();
    this.effects.update();

    const moveAnim = this.mover.active
      ? {
        ...this.mover.frameState(
          (i) => this.renderer.cellRect(i),
          (i) => this.renderer.slotOffsetFor(state, i),
        ),
        playerId: this.mover.playerId,
      }
      : null;

    this.renderer.draw(state, { elapsed: now, moveAnim, effects: this.effects });
    drawKline(this.el['kline-canvas'], state, now);
  }

  /**
   * 尺寸适配。
   *
   * 棋盘画布按「棋盘容器（#board-wrap）」的实测尺寸绘制 —— 该容器位于
   * 三栏 Grid 的中栏，天然避开了左右两侧 HUD 面板，因此棋盘永不被遮挡。
   * 背景层（#stage-bg）仍按整个 stage 的尺寸绘制，保持天际线视差覆盖全屏。
   */
  onResize() {
    if (!this.renderer) {
      this.drawSetupBg();
      return;
    }

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const wrap = this.el['board-wrap'];

    // 棋盘容器实测尺寸（CSS 像素，不含边框）
    let bw = 0;
    let bh = 0;
    if (wrap) {
      bw = Math.floor(wrap.clientWidth);
      bh = Math.floor(wrap.clientHeight);
    }
    // 容器尚未布局完成（例如 hidden 状态下首次进入）时退回窗口尺寸
    if (bw < 80 || bh < 80) {
      bw = Math.floor(window.innerWidth);
      bh = Math.floor(window.innerHeight);
    }

    // 背景层：覆盖整个 stage
    const stage = document.getElementById('stage');
    const sw = stage ? Math.floor(stage.clientWidth) : window.innerWidth;
    const sh = stage ? Math.floor(stage.clientHeight) : window.innerHeight;

    // 幂等：尺寸没变就直接跳过，避免无谓地重设 canvas.width/height
    // （重设会清空画布并触发 ResizeObserver 的再次通知）。
    const stageChanged = sw !== this._lastStageW || sh !== this._lastStageH;
    const boardChanged = bw !== this.renderer.w || bh !== this.renderer.h;
    if (!stageChanged && !boardChanged) return;

    this._lastStageW = sw;
    this._lastStageH = sh;
    this.renderer.resize(bw, bh, dpr);
    this.background.resize(Math.max(1, sw), Math.max(1, sh));
    this.resizeStageBg(sw, sh);
  }

  /**
   * 逐帧兜底：棋盘容器尺寸与渲染器记录不一致时触发重算。
   * 覆盖「媒体查询刚切换」「字体加载后行高变化」「面板增减」等
   * ResizeObserver 可能漏掉的时机。
   */
  syncBoardSize() {
    const wrap = this.el['board-wrap'];
    if (!wrap) return;
    const bw = Math.floor(wrap.clientWidth);
    const bh = Math.floor(wrap.clientHeight);
    if (bw < 80 || bh < 80) return;
    if (bw !== this.renderer.w || bh !== this.renderer.h) {
      this.onResize();
    }
  }

  /** 让背景 canvas 的内部像素尺寸与 CSS 尺寸一致 */
  resizeStageBg(w, h) {
    const cv = this.el['stage-bg'];
    if (!cv) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const pw = Math.max(1, Math.floor(w * dpr));
    const ph = Math.max(1, Math.floor(h * dpr));
    if (cv.width !== pw || cv.height !== ph) {
      cv.width = pw;
      cv.height = ph;
    }
    const ctx = cv.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /* ==================== HUD ==================== */
  updateHUD() {
    const state = this.state;
    if (!state) return;

    const p = currentPlayer(state);
    this.el['hud-turn-name'].textContent = p ? p.name : '—';

    const mk = this.el['hud-market'];
    mk.textContent = `市场：${this.marketName(state.market)}`;
    mk.className = 'hud-market ' + (state.market === 'bull' ? 'is-bull' : state.market === 'bear' ? 'is-bear' : '');

    renderPlayerCards(this.el['player-cards'], state, (p2) => {
      this.toast(`${p2.name} · 资产 ￥${totalAssets(p2, state)} · 控股 ${p2.institutions.length} 家`);
    });
    renderRank(this.el['rank-list'], state, (p, rank) => {
      this.openPlayerDetail(p, rank);
    });

    const isPlayer = p && !p.isAI && !p.bankrupt;
    this.el['btn-roll'].disabled = !isPlayer || this.busy || state.phase !== 'await-roll';
    this.el['btn-assets'].disabled = !isPlayer;
    this.el['btn-mortgage'].disabled = !isPlayer;
    this.el['btn-endturn'].disabled = !isPlayer || state.phase === 'await-roll';

    // HUD 内容变化（玩家卡片增减）会改变中栏可用高度，
    // 这里同步一次棋盘画布尺寸，保证任何时候棋盘都完整可见。
    if (this.renderer) this.syncBoardSize();
  }

  syncLog() {
    const state = this.state;
    const el = this.el['log-list'];
    if (!state) return;
    clearLog(el);
    for (const entry of state.log.slice(-60)) appendLog(el, entry);
  }

  /* ==================== 特效辅助 ==================== */
  cellCenter(index) {
    const r = this.renderer.cellRect(index);
    return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
  }

  floatText(text, pos, color) {
    const layer = this.el['fx-layer'];
    const el = document.createElement('div');
    el.className = 'pixel-float';
    el.textContent = text;
    el.style.left = pos.x + 'px';
    el.style.top = pos.y + 'px';
    el.style.color = color;
    layer.appendChild(el);
    setTimeout(() => el.remove(), 1500);
  }

  shakeScreen() {
    const stage = document.getElementById('stage');
    if (!stage) return;
    stage.classList.remove('shake');
    void stage.offsetWidth;
    stage.classList.add('shake');
    setTimeout(() => stage.classList.remove('shake'), 340);
  }

  toast(text, cls = '') {
    const layer = this.el['toast-layer'];
    const el = document.createElement('div');
    el.className = 'toast ' + cls;
    el.textContent = text;
    layer.appendChild(el);
    setTimeout(() => el.remove(), 2200);
  }

  /* ==================== 深链接 ==================== */
  handleShareLink() {
    const params = parseShareUrl();
    if (!params) return;
    this.setup.nickname = params.nickname || this.setup.nickname;
    this.setup.avatar = params.avatar ?? this.setup.avatar;
    this.setup.difficulty = params.difficulty;
    this.setup.aiCount = params.aiCount;
    this.setup.diceCount = params.diceCount;
    this.setup.cash = params.cash;
    this.setup.market = params.market;
    this.el['input-nickname'].value = this.setup.nickname;
    this.refreshAvatars();
    this.refreshSegments();
    this.refreshAiPreview();
    this.toast(`已载入分享局（种子 ${params.seed}），点击"开局"复现`, 't-gold');
  }
}

const game = new Game();
game.init();
window.__game = game;
// 暴露非节流延时，供自动化测试脚本使用
window.__delay = (ms, fn) => delay(ms, fn);
