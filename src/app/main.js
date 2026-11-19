/**
 * 主控制器 —— 串联规则引擎、渲染、AI、UI。
 */

import { BOARD_CELLS, BOARD_SIZE, EVENT_CARDS, TRAP_CARDS, GROUP_META, WHEEL_BY_ID } from '../core/board.js';
import {
  CONFIG, calculateRent, upgradeCost, mortgageValue, redeemFee,
  totalAssets, levelLabel, allGroupBuffs, globalRegulatorEffects,
  groupBuffTier, outstandingLoan, bondRedeemValue, bondCouponFor, financialMetrics,
} from '../core/economy.js';
import {
  createState, log, currentPlayer, computeMove, computeTeleportSteps,
  rollDice, movePlayer, settleOnCell, resolvePurchase, resolveTakeover, upgradeInstitution,
  mortgageInstitution, redeemInstitution, endTurn, checkBankruptcy, rankPlayers,
  raiseFundsForDeficit,
  applyEventCard, applyTrapCard, takeCentralLoan, repayLoan, issueBond,
  underwriteBond, grantStartPass, startCasinoGame, finishCasinoGame,
  recordCash,
} from '../core/rules.js';
import {
  decide, planTurn, wantsReroll, assignPersonalities, aiName,
  decideBondSubscription, decideLoan, playerPersonality,
} from '../core/ai.js';
import { makeRng, randomSeed, hashSeed } from '../core/rng.js';
import { BoardRenderer } from '../render/canvas.js';
import { TileLayer } from '../render/tiles.js';
import { Background } from '../render/background.js';
import { Effects, MoveAnimator } from '../render/effects.js';
import { Stage3D } from '../render/stage3d.js';
import { HoverBuildingLayer } from '../render/hoverBuilding.js';
import { LandingFxLayer } from '../render/landingFx.js';
import { Sfx } from '../audio/sfx.js';
import { renderRank, renderFinanceCompare, renderActiveStatus, appendLog, clearLog, renderTabPanels } from './hud.js';
import {
  showPurchaseDialog, showTakeoverDialog, showInstitutionDialog, showMetroDialog,
  showEventCardDialog, showGameOverDialog,
  showLoanDialog, showBondDialog, showBondResultDialog, showTrapDialog, showBuffPanel,
  showPlayerDetailDialog, showRentDialog, openModal, closeModal,
  showMarginCallDialog, showSettingsDialog,
  shouldShowRentDialog, resetRentDialogMute,
} from './dialogs.js';
import { showTutorial } from './tutorial.js';
import { openShareDialog, parseShareUrl } from './share.js';
import { saveRecord, saveSettings, loadSettings } from './persist.js';
import { getAvatarIcon } from '../art/avatars.js';
import { showPokerTable, showPokerResult, closePokerTable } from './poker-ui.js';
import { showWheelDialog } from '../ui/wheel.js';
import { abortPokerGame } from '../core/poker.js';
import { getCareerPieceIcon, ensurePortraitsReady } from '../art/career-pieces.js';
import { CAREERS, CAREER_BY_ID, getCareer, assignAiCareers } from '../core/careers.js';
import { getInstitutionSprite } from '../art/buildings.js';
import { PALETTE, PLAYER_COLORS } from '../core/palette.js';

/**
 * 特效 / 飘字用的调色板别名。
 *
 * ⚠ `PALETTE` 里只有精简后的 16 色（ink / panel / dim / board /
 *   boardDk / gold / goldLt / goldDk / paper / red / redLt / green / greenLt）。
 *   旧代码引用了 `amberLt` / `neon` / `jadeLt` / `glass` / `paperDeep`
 *   等**并不存在**的键 —— 值是 undefined，
 *   传到 `effects.hexA()` 就变成 `rgba(NaN,...)`，
 *   `addColorStop` 直接抛异常、整个渲染循环中断。
 *   这里显式映射到真实存在的色值。
 */
const FX = {
  amber: PALETTE.gold,
  amberLt: PALETTE.goldLt,
  amberDk: PALETTE.goldDk,
  neon: '#3fc6c6',
  jade: PALETTE.green,
  jadeLt: PALETTE.greenLt,
  glass: PALETTE.dim,
  paperDeep: '#b3aa96',
};
import { delay, interval } from '../core/scheduler.js';

/** 集团 → 建筑造型索引（与 render/canvas.js 保持一致） */
const GROUP_INDEX_BY_GROUP = { bank: 0, broker: 1, insurer: 2, asset: 3 };

/**
 * ==========================================================
 * 逐格步进的**集中调速参数** —— 唯一调速入口
 * ==========================================================
 *
 * ⚠ 此前步进时长散落在两处（`MoveAnimator.stepMs` 与
 *   `moveAndSettle` 里的 `interval(120, …)`），
 *   两者还不同步（120 vs 110），导致音效与画面错位。
 *   现在统一到下面这一个常量。
 *
 * · `STEP_MS` —— 人类玩家**每格**的完整耗时（毫秒）
 *   300ms ≈ 每秒 3.3 格：足够看清「起跳 → 腾空 → 落地」三段，
 *   多格连走时有节奏感，又不至于让 6 格的移动拖到近 2 秒。
 *
 * · `AI_STEP_FACTOR` —— AI 回合的加速系数
 *   AI 不需要看清每一步的细节，但仍要**看得见逐格**，
 *   因此只给温和的 0.75（225ms/格），不做整体跳过。
 *
 * · `LANDING_SFX_OFFSET` —— 落地音效相对动画的偏移
 *   音效必须**对齐落地瞬间**（动画的 76% 处开始下坠，
 *   压缩帧在 76%~90%），否则会听到「还在空中就落地了」。
 */
const STEP_MS = 300;
const AI_STEP_FACTOR = 0.75;
const LANDING_SFX_OFFSET = 0;

/**
 * 骰子翻滚动画时长 —— 与 `showDice` 的帧数**绑定**。
 *
 * ⚠ 为什么不能写死：帧数改了就必须同步改这里的等待时间，
 *   否则会出现「骰子还在滚，人已经开始走」。
 *   集中成常量后，两处引用同一来源。
 */
const DIE_FRAME_MS = 90;
const DIE_FRAMES = 7;              // 7 帧滚动 + 1 帧定格
const DIE_ROLL_MS = DIE_FRAME_MS * DIE_FRAMES;   // = 630ms

class Game {
  constructor() {
    this.state = null;
    this.renderer = null;
    this.tileLayer = null;
    this.hoverBuildings = null;
    this.landingFx = null;
    this.background = null;
    this.effects = new Effects();
    this.mover = new MoveAnimator();
    this.sfx = new Sfx();
    this.el = {};
    this.running = false;
    this.busy = false;
    this.config = null;
    this.effectsEnabled = true;
    // P1-32：棋盘尺寸 dirty 位 + 节流时间戳
    this._boardSizeDirty = true;
    this._lastSizeCheck = 0;
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
        // P1-32：置 dirty 位 —— 逐帧兜底检查时才知道要去读 DOM 尺寸
        this.markBoardSizeDirty();
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
      'input-nickname', 'career-picker', 'difficulty-picker', 'aicount-picker',
      'dice-picker', 'cash-picker', 'market-picker',
      'ai-preview', 'chk-sound', 'chk-anim', 'chk-tutorial', 'btn-start',
      'board-canvas', 'board-wrap', 'board-tiles', 'stage-bg', 'fx-layer',
      // 3D 舞台骨架（视角切换 + 拖拽平移）
      'board-stage', 'board-pan', 'btn-3d',
      // hover 立体建筑层（PR-D）
      'hover-buildings',
      // HUD 容器（四角定位，用于测量与避让计算）
      'hud-left', 'hud-player', 'hud-top-right', 'hud-feed', 'hud-bottom', 'hud-right',
      // 左上：当前玩家紧凑单条
      'active-player-card', 'active-avatar', 'active-player-name',
      'active-player-cash', 'active-player-sub', 'active-status',
      // 左侧：Tab 面板（我的机构 / Buff / 贷款 / 债券 / 净值）
      'tab-list', 'tab-panel-inst', 'tab-panel-buff', 'tab-panel-loan',
      'tab-panel-bond', 'tab-panel-net',
      // 右上：回合徽章 + 按钮
      'hud-round', 'hud-market', 'btn-rank', 'btn-settings',
      // 顶部全宽回合归属条（P1-1）
      'turn-bar', 'turn-bar-track', 'turn-bar-owner', 'turn-bar-name',
      // 资产排行弹窗底部的「菜单」分组（承接原 #btn-menu 的功能）
      'btn-menu-share', 'btn-menu-assets', 'btn-menu-metrics', 'btn-menu-sound',
      'btn-menu-anim', 'btn-menu-theme', 'btn-menu-selftest', 'btn-menu-setup',
      // 左侧：回合播报（常驻展开，无折叠按钮）
      'log-panel', 'log-list',
      // 底部：主行动 + 常用操作按钮
      'btn-roll', 'btn-assets', 'btn-mortgage', 'btn-endturn',
      // 右侧：资产排行 + 财务对比常驻面板
      'hud-right', 'rank-side', 'fin-compare',
      // 弹窗 / 其他
      'rank-root', 'rank-backdrop', 'rank-box', 'rank-list', 'btn-rank-close',
      'cell-detail',
      'dice-tray', 'toast-layer',
      'selftest-screen', 'selftest-output', 'btn-selftest-back',
    ];
    for (const id of ids) this.el[id] = document.getElementById(id);
  }

  /* ==================== 开局界面 ==================== */
  setupSetupScreen() {
    const settings = loadSettings();

    // **没有「选择棋子形象」** —— 立绘由职业唯一决定，用户不再能自由选外观。
    this.setup = {
      nickname: settings.nickname || '你',
      careerId: settings.careerId || CAREERS[0].id,
      difficulty: settings.difficulty || 'normal',
      aiCount: settings.aiCount ?? 3,
      diceCount: settings.diceCount ?? 2,
      cash: settings.cash || 'standard',
      market: settings.market || 'normal',
      sound: settings.sound !== false,
      anim: settings.anim !== false,
      tutorial: settings.tutorial !== false,
    };

    // 职业选择器 —— 7 种金融职业，与棋子形象一一对应
    const cp = this.el['career-picker'];
    cp.innerHTML = '';
    for (const c of CAREERS) {
      const btn = document.createElement('button');
      btn.className = 'career-opt';
      btn.type = 'button';
      btn.dataset.career = c.id;
      btn.title = `${c.name} · ${c.title} —— ${c.passive.name}：${c.passive.desc}`;
      btn.setAttribute('role', 'radio');
      btn.setAttribute('aria-label', `${c.name} ${c.passive.name}`);

      const cv = getCareerPieceIcon(c.pieceIndex, 0);
      btn.appendChild(cv);

      const body = document.createElement('div');
      body.className = 'career-opt-body';
      body.innerHTML = `<span class="career-opt-name">${c.name}</span>`
        + `<span class="career-opt-passive">${c.passive.name}：${c.passive.desc}</span>`;
      btn.appendChild(body);

      btn.addEventListener('click', () => {
        this.setup.careerId = c.id;
        this.refreshCareers();
        this.sfx.unlock();
        this.sfx.click();
      });
      cp.appendChild(btn);
    }

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

    this.buildSegments('dice-picker', [
      { id: '1', label: '1 颗' },
      { id: '2', label: '2 颗' },
      { id: '3', label: '3 颗' },
    ], (v) => { this.setup.diceCount = parseInt(v, 10); });

    this.buildSegments('cash-picker', [
      { id: 'tight', label: '紧巴 ￥2000' },
      { id: 'standard', label: '标准 ￥2800' },
      { id: 'loose', label: '宽裕 ￥3600' },
    ], (v) => { this.setup.cash = v; });

    this.buildSegments('market-picker', [
      { id: 'normal', label: '震荡市' },
      { id: 'bull', label: '牛市开局' },
      { id: 'bear', label: '熊市开局' },
    ], (v) => { this.setup.market = v; });

    this.el['chk-sound'].checked = this.setup.sound;
    this.el['chk-anim'].checked = this.setup.anim;
    this.el['chk-tutorial'].checked = this.setup.tutorial;

    this.refreshCareers();
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

  /** 刷新职业选择器的高亮状态 */
  refreshCareers() {
    const cp = this.el['career-picker'];
    if (!cp) return;
    [...cp.children].forEach((b) => {
      const sel = b.dataset.career === this.setup.careerId;
      b.classList.toggle('is-sel', sel);
      b.setAttribute('aria-checked', sel ? 'true' : 'false');
    });
  }

  refreshAiPreview() {
    const el = this.el['ai-preview'];
    el.innerHTML = '';
    const rng = makeRng(hashSeed('preview-' + this.setup.difficulty + this.setup.aiCount));
    const personalities = assignPersonalities(rng, this.setup.aiCount);
    const careerIds = assignAiCareers(rng, this.setup.aiCount);
    const colors = ['#3fc6c6', '#c8392b', '#a06cd5', '#4f8f8b'];
    personalities.forEach((p, i) => {
      const row = document.createElement('div');
      row.className = 'ai-row';
      row.style.borderLeftColor = colors[i % colors.length];
      const career = getCareer(careerIds[i]);
      // 职业 + 性格 双属性展示
      row.innerHTML = `
        <span class="ai-name">AI ${i + 1}</span>
        <span class="ai-tag ai-tag-career">${career ? career.name : '待定'}</span>
        <span class="ai-tag">${p.tag}</span>
        <span class="ai-desc">${career ? career.title + ' · ' : ''}${p.desc}</span>
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
    // 背景为矢量绘制 —— 开启平滑缩放（去像素风）
    ctx.imageSmoothingEnabled = true;
    this.setupBg.setPhase(3);
    this.setupBg.draw(ctx, performance.now());
  }

  /* ==================== 开局 ==================== */
  startGame() {
    this.sfx.unlock();
    // 分享链接会带入 seed —— 必须沿用它，否则 AI 的「职业 + 性格」无法复现
    const seed = this.shareSeed || randomSeed();
    this.shareSeed = null;   // 只复现一次，之后再开新局用新种子
    this.config = {
      seed,
      difficulty: this.setup.difficulty,
      aiCount: this.setup.aiCount,
      diceCount: this.setup.diceCount,
      cash: this.setup.cash,
      market: this.setup.market,
      nickname: this.setup.nickname,
      careerId: this.setup.careerId,
    };
    this.beginGame(this.config);
  }

  beginGame(config) {
    clearInterval(this.setupBgTimer);

    // ⚠ P0-18：「本局不再提示交租窗」是**内存态**的临时偏好，
    //   每开一局都要重置 —— 否则上一局勾选后，之后所有局都不弹交租窗。
    resetRentDialogMute();

    const rng = makeRng(config.seed);
    const personalities = assignPersonalities(rng, config.aiCount);
    // AI 的职业同样按 seed 稳定分配（与性格相互独立）
    const careerIds = assignAiCareers(rng, config.aiCount);

    const players = [{
      id: 0, name: config.nickname || '你', isAI: false,
      colorIndex: 0,
      // 真人玩家：**不分配性格**（personalityId 为 null）
      personalityId: null, personality: null,
      careerId: config.careerId || CAREERS[0].id,
    }];

    personalities.forEach((p, i) => {
      players.push({
        id: i + 1,
        name: aiName(rng, p),
        isAI: true,
        // 不指定 avatar —— createState 会按职业自动选用**职业专属立绘**
        colorIndex: i + 1,        // 性格：AI 独有
        personalityId: p.id,
        personality: p,
        // 职业：AI 独有（与性格正交，任一职业可配任一性格）
        careerId: careerIds[i],
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
      aiCount: config.aiCount,
    });

    this.effects = new Effects();
    this.effects.enabled = this.setup.anim !== false;
    this.effectsEnabled = this.setup.anim !== false;
    this.mover = new MoveAnimator();

    if (this.setupBgTimer) { this.setupBgTimer.cancel(); this.setupBgTimer = null; }
    this.el['setup-screen'].hidden = true;
    this.el['game-screen'].hidden = false;
    this.el['selftest-screen'].hidden = true;

    this.renderer = new BoardRenderer(this.el['board-canvas']);

    // ===== 地块 DOM 层（34 个现代数据卡）=====
    // 与 canvas 共享同一套几何：cellRect(index) → 百分比定位。
    this.tileLayer = new TileLayer(this.el['board-tiles'], this.renderer);
    this.tileLayer.build();
    this.bindTileEvents();

    // ===== hover 立体建筑层（PR-D）=====
    // 与地块层平级 —— 不挂在 .mt-cell 里，这样建筑可以自由地
    // 抬到棋盘之上，且不受地块的 z-index 深度排序干扰。
    this.hoverBuildings = new HoverBuildingLayer(
      this.el['board-tiles'],
      this.el['hover-buildings'],
      this.renderer,
    );

    // ===== 落地特效层（PR-E）=====
    // ⚠ 必须走 **DOM**（#fx-layer）而不是 Canvas ——
    //   地块是 DOM 卡片且完全不透明，Canvas 在最底层，
    //   画在 Canvas 上的地面冲击波会被牌面完全遮住。
    this.landingFx = new LandingFxLayer(this.el['fx-layer'], this.renderer);

    this.background = new Background(window.innerWidth, window.innerHeight);

    // ===== 3D 舞台（视角切换 + 拖拽平移）=====
    // 必须在 renderer 建好之后创建 —— 它要读写 #board-stage / #board-pan，
    // 且平移只改 transform，不碰 Canvas 的 backing store。
    //
    // ⚠ 切换视角后必须让地块层重排深度 —— 3D 模式下靠 z-index 表达
    //   「离观察者更近」，平面模式不需要。
    this.stage3d = new Stage3D(
      this.el['board-stage'],
      this.el['board-pan'],
      this.el['btn-3d'],
      {
        onChange: ({ is3D }) => {
          if (this.tileLayer) this.tileLayer.set3D(is3D);
          if (this.renderer) this.renderer.set3D(is3D);
          if (this.hoverBuildings) {
            this.hoverBuildings.set3D(is3D);
            if (is3D && this.state) this.hoverBuildings.sync(this.state);
          }
        },
      },
    );

    this.onResize();
    // 布局稳定后再量一次（隐藏→显示后容器尺寸才最终确定）
    requestAnimationFrame(() => this.onResize());
    // 职业立绘是矢量光栅化的 —— 先确保解码完成，避免首帧棋子空白
    ensurePortraitsReady().catch(() => { /* 解码失败不影响游戏继续 */ });

    clearLog(this.el['log-list']);
    log(this.state, 'sys', `开局！种子 ${config.seed}，${players.length} 位玩家入场`, '开局');
    log(this.state, 'sys', `难度「${this.difficultyName(config.difficulty)}」，市场初始为${this.marketName(config.market)}`, '设定');
    for (const p of players) {
      if (p.personality) {
        const career = getCareer(p.careerId);
        // 播报 AI 的「职业 + 性格」双属性
        log(this.state, 'ai',
          `${p.name}（${career ? career.name : '未定职业'} · ${p.personality.name}）：${p.personality.quote}`,
          p.personality.tag);
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
    // blur() 防止按钮保持焦点后，空格/回车快捷键误触上次点击的按钮
    this.el['btn-roll'].addEventListener('click', () => { this.el['btn-roll'].blur(); this.handleRoll(); });
    this.el['btn-assets'].addEventListener('click', () => { this.el['btn-assets'].blur(); this.handleShowAssets(); });
    this.el['btn-mortgage'].addEventListener('click', () => { this.el['btn-mortgage'].blur(); this.handleShowAssets(); });
    this.el['btn-endturn'].addEventListener('click', () => { this.el['btn-endturn'].blur(); this.handleEndTurn(); });

    this.el['btn-menu-share'].addEventListener('click', () => {
      this.closeRankModal();
      this.handleShare();
    });
    this.el['btn-menu-assets'].addEventListener('click', () => {
      this.closeRankModal();
      this.handleShowAssets();
    });
    this.el['btn-menu-metrics'].addEventListener('click', () => {
      this.closeRankModal();
      const me = this.humanPlayer();
      if (me) this.openPlayerDetail(me, null);
    });
    this.el['btn-menu-sound'].addEventListener('click', (e) => {
      this.sfx.setEnabled(!this.sfx.enabled);
      e.currentTarget.textContent = `音效：${this.sfx.enabled ? '开' : '关'}`;
      this.toast(this.sfx.enabled ? '音效开启' : '音效关闭');
    });
    this.el['btn-menu-anim'].addEventListener('click', (e) => {
      this.effectsEnabled = !this.effectsEnabled;
      this.effects.enabled = this.effectsEnabled;
      document.body.classList.toggle('no-anim', !this.effectsEnabled);
      e.currentTarget.textContent = `特效：${this.effectsEnabled ? '开' : '关'}`;
      this.toast(this.effectsEnabled ? '特效开启' : '特效关闭（保帧率）');
    });
    this.el['btn-menu-theme'].addEventListener('click', (e) => {
      document.body.classList.toggle('theme-light');
      const light = document.body.classList.contains('theme-light');
      e.currentTarget.textContent = `主题：${light ? '亮色' : '暗色'}`;
      this.toast(light ? '亮色主题' : '暗色主题');
    });
    this.el['btn-menu-selftest'].addEventListener('click', () => {
      this.closeRankModal();
      this.runSelfTest();
    });
    this.el['btn-menu-setup'].addEventListener('click', () => {
      this.closeRankModal();
      this.backToSetup();
    });

    // ===== 左侧 Tab 面板切换 =====
    this.setupTabPanel();

    // ===== 回合播报 =====
    // 播报列表常驻显示（原先的折叠切换按钮 #feed-toggle 已删除），
    // 这里只保证列表始终滚动到最新一条。
    {
      const list = this.el['log-list'];
      list.scrollTop = list.scrollHeight;
    }

    // ===== 资产排行弹窗（不常驻）=====
    this.el['btn-rank'].addEventListener('click', () => this.openRankModal());
    this.el['btn-rank-close'].addEventListener('click', () => this.closeRankModal());
    this.el['rank-backdrop'].addEventListener('click', () => this.closeRankModal());

    // ===== 设置入口（P1-2）：右上角齿轮 =====
    // 独立弹窗，**不再**要求先打开排行弹窗才能改设置。
    this.el['btn-settings'].addEventListener('click', () => this.openSettingsDialog());

    this.el['btn-selftest-back'].addEventListener('click', () => {
      this.el['selftest-screen'].hidden = true;
      this.el['setup-screen'].hidden = false;
      this.setupBgTimer = interval(100, () => this.drawSetupBg());
    });

    document.addEventListener('keydown', (e) => {
      if (!this.state || this.el['game-screen'].hidden) return;
      if (!document.getElementById('modal-root').hidden) return;
      if (!this.el['rank-root'].hidden) {
        if (e.key === 'Escape') this.closeRankModal();
        return;
      }
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        this.handleRoll();
      }
    });

    // ===== 棋盘交互：悬停高亮 + 点击查看详情 =====
    this.el['board-canvas'].addEventListener('mousemove', (e) => {
      if (!this.renderer) return;
      const rect = this.el['board-canvas'].getBoundingClientRect();
      this.renderer.hoverCell = this.renderer.cellAt(e.clientX - rect.left, e.clientY - rect.top);
    });

    this.el['board-canvas'].addEventListener('mouseleave', () => {
      if (this.renderer) this.renderer.hoverCell = -1;
      this.hideCellDetail();
    });

    // 点击地块 → 弹出详情卡（移动端解决小屏格子过小的关键交互）
    this.el['board-canvas'].addEventListener('click', (e) => {
      if (!this.renderer) return;
      const rect = this.el['board-canvas'].getBoundingClientRect();
      const index = this.renderer.cellAt(e.clientX - rect.left, e.clientY - rect.top);
      if (index < 0) return;
      // 转盘格：只有**轮到人类玩家**时才允许触发；AI 回合点击无效
      if (this.triggerWheelCell(index)) return;
      this.showCellDetail(index, e.clientX - rect.left, e.clientY - rect.top);
    });

    // 触摸设备：点空白处关闭详情卡
    this.el['board-canvas'].addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'mouse') this.hideCellDetail();
    });

    this.setupPinchZoom();

    const unlock = () => { this.sfx.unlock(); document.removeEventListener('pointerdown', unlock); };
    document.addEventListener('pointerdown', unlock);
  }

  /**
   * 地块 DOM 事件绑定 —— 34 个数据卡直接响应点击 / 悬停 / 键盘。
   *
   * 地块层盖在 canvas 之上（pointer-events: auto），
   * 因此命中判定由浏览器直接完成，无需 `cellAt(px,py)` 反算。
   */
  bindTileEvents() {
    const root = this.el['board-tiles'];
    if (!root) return;

    const findIndex = (target) => {
      const cell = target && target.closest ? target.closest('.mt-cell') : null;
      return cell ? Number(cell.dataset.index) : -1;
    };

    root.addEventListener('click', (e) => {
      const index = findIndex(e.target);
      if (index < 0) return;
      // 转盘格：只有**轮到人类玩家**时才允许触发；AI 回合点击无效
      if (this.triggerWheelCell(index)) return;
      const rect = this.el['board-wrap'].getBoundingClientRect();
      // 详情卡定位：用地块自身的中心（DOM 坐标系）
      const node = this.tileLayer && this.tileLayer.nodes[index];
      let px = 0;
      let py = 0;
      if (node) {
        const r = node.getBoundingClientRect();
        px = r.left - rect.left + r.width / 2;
        py = r.top - rect.top + r.height / 2;
      } else {
        px = e.clientX - rect.left;
        py = e.clientY - rect.top;
      }
      this.showCellDetail(index, px, py);
    });

    root.addEventListener('dblclick', (e) => {
      const index = findIndex(e.target);
      if (index < 0) return;
      this.focusTile(index);
    });

    // 悬停高亮（沿用 canvas 的 hoverCell 状态，供棋子绘制等使用）
    root.addEventListener('mousemove', (e) => {
      if (!this.renderer) return;
      const index = findIndex(e.target);
      this.renderer.hoverCell = index;
      // PR-D：3D 模式下在悬停格上方浮起建筑
      if (this.hoverBuildings) {
        if (index < 0) this.hoverBuildings.leave(-1);
        else this.hoverBuildings.enter(index);
      }
    });
    root.addEventListener('mouseleave', () => {
      if (this.renderer) this.renderer.hoverCell = -1;
      if (this.hoverBuildings) this.hoverBuildings.leave(-1);
    });

    // 键盘可达性：Enter / Space = 选中该格
    root.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const index = findIndex(e.target);
      if (index < 0) return;
      e.preventDefault();
      this.focusTile(index);
    });
  }

  /** 选中并高亮某个地块（键盘 / 双击路径） */
  focusTile(index) {
    if (!this.tileLayer) return;
    this.tileLayer.nodes.forEach((n, i) => {
      if (n) n.classList.toggle('is-selected', i === index);
    });
    const node = this.tileLayer.nodes[index];
    if (node) node.classList.add('is-active');
  }

  /**
   * 移动端双指缩放 —— 解决小屏格子过小的问题。
   *
   * 实现方式：在 #board-wrap 上监听 pointer 事件，跟踪两个活跃指针的距离，
   * 距离变化超过阈值时调整棋盘的 CSS 缩放倍数（1.0 ~ 2.0）。
   * 缩放只作用于棋盘容器，不影响 HUD。
   */
  setupPinchZoom() {
    const wrap = this.el['board-wrap'];
    if (!wrap) return;

    const pointers = new Map();
    let startDist = 0;
    let startZoom = 1;
    let moved = false;

    const distance = () => {
      const [a, b] = [...pointers.values()];
      return Math.hypot(a.x - b.x, a.y - b.y);
    };

    wrap.style.touchAction = 'none';

    wrap.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse') return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        startDist = distance();
        startZoom = this.boardZoom || 1;
        moved = true;
      }
    });

    wrap.addEventListener('pointermove', (e) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2 && startDist > 0) {
        const d = distance();
        if (Math.abs(d - startDist) < 8) return;
        const next = Math.max(1, Math.min(2.2, startZoom * (d / startDist)));
        this.setBoardZoom(next);
      }
    });

    const release = (e) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) startDist = 0;
    };
    wrap.addEventListener('pointerup', release);
    wrap.addEventListener('pointercancel', release);
    wrap.addEventListener('pointerleave', release);
  }

  /**
   * 设置棋盘缩放倍数（移动端双指缩放）。
   *
   * ================== P0-25：为什么不能再改 Canvas 的 transform ==================
   * 旧实现只给 `#board-canvas` 加 `scale()` —— 而棋盘其实是**两层**：
   *   · Canvas（`#board-canvas`）—— 棋子 / 特效 / 底板
   *   · DOM 地块（`#board-tiles`）—— 34 个地块卡面
   * 只缩放 Canvas 会让地块层原地不动，表现为**缩放后地块与棋盘错位**。
   *
   * 现在改为作用到 `#board-pan`（两层的共同祖先）——
   * 由 Stage3D 把缩放与平移、倾斜合并进同一个 transform，
   * 保证 Canvas 与地块层**同源同缩放**，永远对齐。
   */
  setBoardZoom(z) {
    const next = Math.max(1, Math.min(2.2, Number(z) || 1));
    this.boardZoom = next;
    if (this.stage3d && typeof this.stage3d.setZoom === 'function') {
      this.stage3d.setZoom(next);
      return;
    }
    // 兜底：Stage3D 不可用时至少保证 Canvas 自身缩放生效
    const canvas = this.el['board-canvas'];
    if (!canvas) return;
    canvas.style.transformOrigin = 'center center';
    canvas.style.transform = next > 1.01 ? `scale(${next.toFixed(3)})` : '';
  }

  /** 打开资产排行弹窗 */
  openRankModal() {
    const state = this.state;
    if (!state) return;
    renderRank(this.el['rank-list'], state, (p, rank) => {
      this.closeRankModal();
      this.openPlayerDetail(p, rank);
    });
    this.el['rank-root'].hidden = false;
  }

  closeRankModal() {
    this.el['rank-root'].hidden = true;
  }

  /**
   * 打开设置弹窗（P1-2）。
   *
   * 独立入口 —— 右上角齿轮直接开设置，不必先打开排行弹窗。
   * 排行弹窗底部的旧菜单项**保留兼容**（仍可点，状态同源）。
   */
  openSettingsDialog() {
    const light = document.body.classList.contains('theme-light');
    showSettingsDialog({
      soundOn: this.sfx.enabled,
      animOn: this.effectsEnabled,
      lightOn: light,
      onSound: (on) => {
        this.sfx.setEnabled(on);
        // 同步排行弹窗里的旧开关文案（兼容入口）
        const b = this.el['btn-menu-sound'];
        if (b) b.textContent = `音效：${on ? '开' : '关'}`;
        this.toast(on ? '音效开启' : '音效关闭');
      },
      onAnim: (on) => {
        this.effectsEnabled = on;
        this.effects.enabled = on;
        document.body.classList.toggle('no-anim', !on);
        const b = this.el['btn-menu-anim'];
        if (b) b.textContent = `特效：${on ? '开' : '关'}`;
        this.toast(on ? '特效开启' : '特效关闭（保帧率）');
      },
      onTheme: (on) => {
        document.body.classList.toggle('theme-light', on);
        const b = this.el['btn-menu-theme'];
        if (b) b.textContent = `主题：${on ? '亮色' : '暗色'}`;
        this.toast(on ? '亮色主题' : '暗色主题');
      },
      onAssets: () => this.handleShowAssets(),
      onMetrics: () => {
        const me = this.humanPlayer();
        if (me) this.openPlayerDetail(me, null);
      },
      onShare: () => this.handleShare(),
      onSelfTest: () => this.runSelfTest(),
      onBackToSetup: () => this.backToSetup(),
    });
  }

  /**
   * 地块详情卡 —— 移动端点击格子后弹出，读出完整信息。
   */
  showCellDetail(index, px, py) {
    const state = this.state;
    const el = this.el['cell-detail'];
    if (!state || !el) return;
    const cell = BOARD_CELLS[index];
    if (!cell) return;

    const inst = this.renderer ? this.renderer.getInstitutionState(state, index) : null;
    const parts = [];

    // 站在该格上的所有玩家
    const here = state.players.filter((pl) => !pl.bankrupt && pl.position === index);
    if (here.length) {
      parts.push(`<div class="cd-meta">在场：${here.map((pl) => escapeHtml(pl.name)).join('、')}</div>`);
    }

    if (cell.type === 'institution') {
      const level = inst ? inst.level : cell.tier;
      const price = cell.price[Math.min(4, level)] ?? cell.price[0];
      parts.push(`<div class="cd-name">${escapeHtml(cell.name)}</div>`);
      parts.push(`<div>价格 <span class="cd-price">￥${price}</span></div>`);
      parts.push(`<div class="cd-meta">代码 ${cell.code} · 等级 ${level}/${cell.maxLevel}</div>`);
      if (cell.regulator) {
        parts.push(`<div class="cd-meta">监管机构 · 持有后不可升级</div>`);
      }
      if (inst) {
        const owner = inst.player;
        parts.push(`<div class="cd-meta">归属：${escapeHtml(owner.name)}</div>`);
        if (inst.mortgaged) parts.push(`<div class="cd-meta">状态：已质押</div>`);
        else {
          const rent = cell.rent[Math.min(4, level)] ?? cell.rent[0];
          parts.push(`<div class="cd-meta">租金 ￥${rent}</div>`);
        }
      } else {
        parts.push(`<div class="cd-meta">状态：可购买</div>`);
      }
    } else {
      const sp = cell.special;
      parts.push(`<div class="cd-name">${escapeHtml(sp.name)}</div>`);
      parts.push(`<div class="cd-meta">${escapeHtml(sp.desc || sp.short || '')}</div>`);
      if (sp.amount) parts.push(`<div>费用 <span class="cd-price">-￥${sp.amount}</span></div>`);
      if (sp.trap) parts.push(`<div class="cd-meta">状态：陷阱格</div>`);
    }

    el.innerHTML = parts.join('');
    el.hidden = false;

    // 定位：优先贴近点击点，超出容器时贴边
    const wrapRect = this.el['board-wrap'].getBoundingClientRect();
    const box = el.getBoundingClientRect();
    let left = px + 14;
    let top = py + 14;
    if (left + box.width > wrapRect.width - 6) left = px - box.width - 14;
    if (top + box.height > wrapRect.height - 6) top = py - box.height - 14;
    el.style.left = `${Math.max(6, Math.min(left, wrapRect.width - box.width - 6))}px`;
    el.style.top = `${Math.max(6, Math.min(top, wrapRect.height - box.height - 6))}px`;
  }

  hideCellDetail() {
    const el = this.el['cell-detail'];
    if (el) el.hidden = true;
  }

  /**
   * 取人类玩家（`!isAI`）—— HUD 的「当前玩家卡」永远显示他，
   * 不随 AI 回合切换。
   */
  humanPlayer() {
    if (!this.state) return null;
    return this.state.players.find((p) => !p.isAI) || null;
  }

  /**
   * 左侧 Tab 面板 —— 真实 tab 语义（role=tablist / tab / tabpanel）。
   * 支持鼠标点击 + 键盘（←/→ 切换、Home/End 跳首尾）。
   */
  setupTabPanel() {
    const list = this.el['tab-list'];
    if (!list) return;
    this.tabButtons = [...list.querySelectorAll('[role="tab"]')];

    this.tabButtons.forEach((btn) => {
      btn.addEventListener('click', () => this.switchTab(btn.dataset.tab, false));
      btn.addEventListener('keydown', (e) => {
        const i = this.tabButtons.indexOf(btn);
        let next = -1;
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (i + 1) % this.tabButtons.length;
        else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (i - 1 + this.tabButtons.length) % this.tabButtons.length;
        else if (e.key === 'Home') next = 0;
        else if (e.key === 'End') next = this.tabButtons.length - 1;
        if (next < 0) return;
        e.preventDefault();
        this.switchTab(this.tabButtons[next].dataset.tab, true);
      });
    });
    this.switchTab('inst', false);
  }

  /** 切换 tab —— 更新 aria-selected / hidden，并聚焦（键盘操作时） */
  switchTab(key, focus) {
    if (!this.tabButtons || !this.tabButtons.length) return;
    for (const btn of this.tabButtons) {
      const on = btn.dataset.tab === key;
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
      btn.setAttribute('tabindex', on ? '0' : '-1');
      const panel = this.el[`tab-panel-${btn.dataset.tab}`];
      if (panel) panel.hidden = !on;
      if (on && focus) btn.focus();
    }
    this.activeTab = key;
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
    // 现金为负（如债券兑付）先追保，补足后才允许开始掷骰
    if (!p.isAI && p.cash < 0) {
      this.ensureSolvency(p, () => this.beginPlayerTurn());
      return;
    }
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
    // ⚠ 守卫：只有**人类玩家**能掷骰。
    //   AI 回合期间 `runAITurn` 也会把 phase 置为 'await-roll'，
    //   在 AI 摇骰的那段时间里 busy 仍为 false ——
    //   若此处不拦，玩家点一下就会**替 AI 掷骰**（并把 AI 的骰子结果改掉）。
    //   UI 上的按钮虽已 disabled，但 handleRoll 可能被其他入口直接调用，
    //   所以状态层必须自带这道守卫。
    if (p.isAI) return;
    this.sfx.unlock();

    const { dice } = rollDice(this.state, p);
    const total = dice.reduce((a, b) => a + b, 0);
    this.showDice(dice);
    this.sfx.diceRoll();

    // ⚠ 骰子动画与移动起点对齐
    //
    // 骰子翻滚动画是 7 帧 × 90ms = 630ms（见 showDice）。
    // 此前用固定 620ms 启动移动 —— 与动画收尾差 10ms，
    // 加上渲染抖动会让人看到「骰子还没停、人已经开始走」。
    // 这里把等待时间定义成与骰子帧数绑定，两处永远一致。
    delay(DIE_ROLL_MS, () => {
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
        ctx.imageSmoothingEnabled = true;
        tray.appendChild(cv);

        const frames = m.getDieRollFrames();
        let i = 0;
        const timer = interval(DIE_FRAME_MS, () => {
          ctx.clearRect(0, 0, 16, 16);
          ctx.imageSmoothingEnabled = true;
          ctx.drawImage(frames[i % frames.length], 0, 0, 16, 16);
          i++;
          if (i >= DIE_FRAMES) {
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
    // 记录本次移动经过的格子 —— 用于判定「是否经过起点格」（不只是落在起点）
    this._lastPath = path.slice();

    // ⚠ 步速：AI 稍快，但**仍然逐格可见**（不跳过动画）
    const isAI = !!(player && player.isAI);
    const stepMs = Math.round(STEP_MS * (isAI ? AI_STEP_FACTOR : 1));

    // ⚠ 音效对齐 —— 关键修复点
    //
    // 此前用独立的 `interval(120, …)` 播脚步音，而动画本身是 110ms/格，
    // 两者**不同步**：音效会先于画面到达，逐渐累积偏移，
    // 听感上像「脚步落地时角色还悬在半空」。
    //
    // 现在改为：**由动画的落地事件驱动音效**。
    // onLand 在角色真正踩上那一格的瞬间触发（step 从 n-1 → n），
    // 此时播落地音 + 生成落地特效 —— 音画严格同步。
    let stepTick = 0;

    this.mover.start({
      playerId: player.id,
      from,
      to: path[path.length - 1],
      steps,
      path,
      stepMs,
      // PR-E：每踩上一格触发一次落地特效（椭圆冲击波 + 轻微上浮）
      onLand: (stepIdx) => {
        // 落地音与落地特效**同一帧**触发 —— 保证音画同步
        this.sfx.step();
        stepTick++;
        this.spawnLandingFx(player, path, stepIdx);
      },
      onDone: () => {
        const passedStart = computeMove(from, steps, BOARD_SIZE).passedStart;
        player.position = path[path.length - 1];
        player.lastAction = { ...(player.lastAction || {}), passedStart };
        this.afterMove(player, passedStart);
      },
    });
  }

  /**
   * 落地特效 —— 角色每踩上一格，脚下浮起一圈椭圆冲击波 + 轻微上浮的柔光。
   *
   * ⚠ 特效画在 **DOM 层**（#fx-layer）而非 Canvas：
   *   地块是 DOM 卡片且**完全不透明**（白色渐变底），
   *   Canvas 又在最底层 —— 画在 Canvas 上的地面冲击波会被牌面完全遮住。
   *   DOM 层在牌面之上，冲击波才能真正「印」在格子上。
   *
   * @param {object} player 移动中的玩家
   * @param {number[]} path 本次移动路径
   * @param {number} stepIdx 刚刚踩上的第几步（1 起）
   */
  spawnLandingFx(player, path, stepIdx) {
    if (!this.effectsEnabled || !this.landingFx) return;
    const cellIndex = path[Math.min(path.length - 1, Math.max(0, stepIdx - 1))];
    if (cellIndex == null) return;

    // 颜色取玩家色 —— 与棋子底座呼应
    const pc = PLAYER_COLORS[(player.colorIndex || 0) % PLAYER_COLORS.length];
    this.landingFx.spawn(cellIndex, pc.lt);
  }

  afterMove(player, passedStart) {
    const state = this.state;

    // ===== 起点经过判定 =====
    // 规则：只要「经过」起点格就能拿补贴 + 可选贷款，不必恰好停在起点。
    //   · 落在起点格            → landedOnStart
    //   · 移动路径跨过起点格    → passedOverStart（绕圈时最常见）
    const landedOnStart = player.position === 0;
    const path = this._lastPath || [];
    const passedOverStart = path.length > 0 && path.some((idx) => idx === 0) && !landedOnStart;

    if (landedOnStart || passedOverStart || passedStart) {
      // ⚠ P2（m6）：起点补贴的去重改为**按圈号**记录（见 rules.grantStartPass），
      //   不再在这里手动复位 `_startBonusGranted` ——
      //   旧写法只在 passedStart 时复位，「恰好落在起点」的路径不复位，
      //   导致该玩家此后永远拿不到补贴。
      //   现在由 player.laps 推进自然解锁下一圈，三条触发路径语义一致。
      const startCell = state.board[0];
      const results = [];

      // 1) 发放补贴 —— 经过起点即得（落点恰好是起点时，此处发过，
      //    后续 settleOnCell 内的再次调用会被去重标记挡掉）
      const bonusResults = grantStartPass(state, player, startCell);
      results.push(...bonusResults);

      // 2) 持有央行 → 每圈流动性投放
      const regBonus = globalRegulatorEffects(state).roundBonus || 0;
      if (regBonus > 0) {
        recordCash(state, player, regBonus, '央行流动性投放', '央行');
        results.push({ kind: 'pbc-bonus', amount: regBonus, cell: startCell });
      }

      // 3) 贷款机会（每圈限一次）
      if (player.loanCountThisRound < CONFIG.maxLoansPerRound) {
        results.push({ kind: 'loan-offer', cell: startCell, tiers: CONFIG.loanTiers });
      }

      // 4) 落点若是起点格，仍需走正常结算（起点自身是特殊格）
      //    注意 settleOnCell 内部也会产出 loan-offer，这里要剔除以免弹两次
      if (landedOnStart) {
        const cellResults = settleOnCell(state, player, player.position);
        results.push(...cellResults.filter((r) => r.kind !== 'loan-offer'));
      }

      this.handleSettlement(player, results);

      if (bonusResults.length) {
        const c = this.cellCenter(0);
        log(state, player.isAI ? 'ai' : 'good',
          `${player.name} ${passedOverStart ? '经过' : '抵达'}陆家嘴金融中心，获得货币发行补贴 ￥${CONFIG.startBonus}`, '补贴');
        this.sfx.buy();
        this.effects.floatUp(c.x, c.y, { count: 6, colors: [PALETTE.gold, FX.amberLt] });
      }
      return;
    }

    // ===== 转盘格：先转盘，抽出效果后再结算 =====
    // 落点若为转盘格（kind = 'wheel'），必须先让玩家「转」一次，
    // 拿到抽中的效果 id，再交给规则层走该效果原有的结算逻辑。
    const landed = state.board[player.position];
    if (landed && landed.type === 'special' && landed.special?.kind === 'wheel') {
      this.spinWheelThenSettle(player, landed);
      return;
    }

    const results = settleOnCell(state, player, player.position);
    this.handleSettlement(player, results);
  }

  /**
   * 转盘格点击入口 —— **只有轮到人类玩家**时才能触发转盘。
   *
   * ⚠ 需求：AI 触发转盘时，玩家不能触发任何转盘。
   *   · 弹窗是模态的（遮罩拦截棋盘点击），AI 转盘期间玩家点不到棋盘；
   *   · 即使遮罩被绕过（比如直接调 API），本守卫也会拦下：
   *     当前回合不是人类玩家 → 拒绝。
   *
   * ⚠ P2（m8）：**禁止「跳过移动直触转盘」**。
   *   旧实现 `cur.position = index;` 直接把玩家瞬移到转盘格 ——
   *   这等于给玩家一个「随时免费转到任意转盘」的作弊入口：
   *     · 无需掷骰、无需走完格子，落到哪个转盘全凭玩家点击；
   *     · 转盘的候选里包含「牛熊切换」「大额事件卡」等强力效果，
   *       白嫖等于破坏了回合推进与位置博弈；
   *     · 也绕过了「经过起点」的次数判定（可反复刷起点附近的转盘）。
   *   现在必须**真的落在**该格（棋子移动后的落点）才能触发转盘：
   *     · 玩家正常掷骰走到转盘格 → 由 afterMove 走转盘结算（正常路径）；
   *     · 点击棋盘上的转盘格 → 只弹**详情卡**（不结算、不转盘）。
   *
   * @returns {boolean} true = 已触发转盘（调用方应中止后续处理）
   */
  triggerWheelCell(index) {
    const state = this.state;
    if (!state) return false;
    const cell = state.board[index];
    if (!cell || cell.type !== 'special' || cell.special?.kind !== 'wheel') return false;

    // 守卫 ①：当前回合必须是人类玩家
    const cur = currentPlayer(state);
    if (!cur || cur.isAI || cur.bankrupt) return false;

    // 守卫 ②：游戏必须处于「等待玩家行动」阶段，且没有别的弹窗在跑
    if (this.busy) return false;
    if (!document.getElementById('modal-root').hidden) return false;
    if (!document.getElementById('rank-root').hidden) return false;

    // ⚠ P2（m8）：守卫 ③ —— 玩家必须**已经落在**该转盘格上。
    //   点击任意转盘格不再触发转盘（那会变成「跳过移动的作弊入口」）；
    //   正常流程由「掷骰 → 移动 → 落点即转盘格」自动触发。
    if (cur.position !== index) return false;

    this.spinWheelThenSettle(cur, cell);
    return true;
  }

  /**
   * 转盘格结算 —— 弹大转盘 → 玩家转 → 抽出效果 → 按该效果结算。
   *
   * ================== 新语义（v2）==================
   * · **玩家可连续转多次**：每转一次 → 抽效果 → **立即真实结算**
   *   → 转盘重置回可转状态 → 玩家可继续转（上限 5 次，UI 显示剩余次数）。
   *   玩家点「完成并离开」才退出并继续回合。
   * · **AI 触发时玩家只读**：`readonly: true` → 「转」按钮不渲染，
   *   玩家只看 AI 的抽中结果与结算。
   * · **模态拦截**：弹窗打开期间遮罩挡住棋盘点击，
   *   玩家无法在 AI 转盘期间触发自己的转盘格。
   *
   * 抽中的效果 id 通过 `state.pending.wheelPick` 传给规则层，
   * 规则层据此走该效果**原有**的 case 分支（不复制粘贴逻辑）。
   */
  spinWheelThenSettle(player, cell) {
    const state = this.state;
    const wheel = WHEEL_BY_ID[cell.special.wheelId];
    if (!wheel) {
      // 转盘定义缺失（数据异常）—— 降级为普通结算，不阻断回合
      const results = settleOnCell(state, player, player.position);
      this.handleSettlement(player, results);
      return;
    }

    const isAI = !!player.isAI;
    // 本次转盘是否已经结算过（供 onClose 判断要不要兜底随机）
    let settled = false;

    // ===== AI 触发转盘：玩家不能操作任何转盘 =====
    // ① 转盘格只允许「当前回合玩家」触发 —— AI 回合期间玩家点自己的转盘格
    //    不会再次开转盘（见下方 triggerWheelCell 守卫）。
    // ② 弹窗期间模态遮罩拦截棋盘点击。
    // ③ readonly 让玩家的「转」按钮不渲染。
    this.busy = true;

    const doSettle = (outcomeId, outcomeName) => {
      settled = true;
      // 记录抽中的效果 → 规则层据此结算
      state.pending = { kind: 'wheel', wheelPick: outcomeId, playerId: player.id };
      log(state, player.isAI ? 'ai' : 'self',
        `${player.name} 转动${wheel.label}，抽中「${outcomeName}」`, '转盘');
      const results = settleOnCell(state, player, player.position);
      state.pending = null;
      this.handleSettlement(player, results);
    };

    const wheelModal = showWheelDialog(wheel, {
      autoSpin: isAI,
      readonly: isAI,
      playerName: player.name,
      // ⚠ P1：转盘抽签必须走对局随机源 —— 保证同 seed 可复现
      rng: state.rng,
      onSpin: (r) => {
        if (isAI) {
          // AI 只读转盘：让结果停留片刻再自动收起并继续回合，
          // 之前弹窗滞留在屏幕上、游戏在背后悄悄继续。
          delay(1400, () => {
            doSettle(r.outcomeId, r.outcome.name);
            // modal.close 是 openModal 的纯关闭，不会再触发下方 onClose 兜底
            if (wheelModal.modal) wheelModal.modal.close();
          });
          return;
        }
        // 每次转动都**立即真实结算** —— 玩家可以接着再转
        doSettle(r.outcomeId, r.outcome.name);
      },
      onClose: () => {
        // 玩家点「完成并离开」—— 若一次都没转过，兜底随机一个效果，保证回合能继续
        if (settled) {
          this.busy = true;
          this.continueAfterSettlement(player);
          return;
        }
        const outs = cell.special.outcomes || [];
        if (!outs.length) {
          this.busy = true;
          this.continueAfterSettlement(player);
          return;
        }
        const picked = outs[state.rng.int(0, outs.length - 1)];
        // 兜底也必须传 outcome 的 id / name —— 之前把整个对象当 id 传入，
        // 规则层匹配不到效果（该路径在 onClose 修活前是死代码，从未暴露）
        doSettle(picked.id, picked.name);
      },
    });
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
            count: 12, colors: [PALETTE.gold, FX.amberLt, PALETTE.paper], speed: 2.6,
          });
          this.effects.triggerShake();
          this.shakeScreen();
          this.floatText(`-￥${r.rent}`, c, PALETTE.redLt);
          // 踩到他人机构 —— 弹出交租确认窗（AI 不弹，避免打断观战节奏）
          //
          // ⚠ P0-18：小额（< ￥200）**不弹窗**，只飘字 + toast。
          //   连续几步都在交租时，反复弹窗会把节奏完全打断。
          //   大额仍弹窗 —— 那是需要玩家确认的重要决策。
          if (!player.isAI) {
            if (!shouldShowRentDialog(r.rent)) {
              // 免打扰路径：只提示，不打断
              this.toast(`交租 ￥${r.rent} 给 ${r.ownerName}`, 't-bad');
              break;
            }
            this.busy = false;
            showRentDialog(player, {
              cellName: r.cell.name,
              ownerName: r.ownerName,
              rent: r.rent,
              baseRent: r.baseRent ?? r.rent,
              buffMult: r.buffMult,
              marketNote: r.marketNote || '',
              levelLabel: r.level != null ? levelLabel(r.level) : '',
              sprite: this.institutionSprite(r.cell, r.level ?? r.cell.tier, r.ownerColorIndex),
            }, () => {
              this.busy = true;
              this.continueAfterSettlement(player);
            });
            return;
          }
          break;
        }
        case 'takeover-offer': {
          if (player.isAI) {
            this.aiTakeover(player, r);
          } else {
            this.busy = false;
            showTakeoverDialog(r.cell, r.price, r.level, player, r.ownerName,
              () => {
                const ok = resolveTakeover(state, player, true);
                if (ok) this.onTakeovered(player, r);
                this.busy = true;
                this.continueAfterSettlement(player);
              },
              () => {
                resolveTakeover(state, player, false);
                this.busy = true;
                this.continueAfterSettlement(player);
              });
            return;
          }
          break;
        }
        case 'mortgaged-no-rent': {
          log(state, 'sys', `${r.cell.name} 已被 ${r.ownerName} 质押，暂停产生管理费`, '质押');
          break;
        }
        case 'charge': {
          log(state, 'bad', `${player.name} 缴纳${r.reason} ￥${r.amount}`, '成本');
          this.sfx.deny();
          const c = this.cellCenter(player.position);
          this.effects.burst(c.x, c.y, { count: 8, colors: [FX.glass, FX.paperDeep], speed: 1.6 });
          this.floatText(`-￥${r.amount}`, c, PALETTE.redLt);
          break;
        }
        case 'bonus': {
          log(state, 'good', `${player.name} ${r.reason} +￥${r.amount}`, '收益');
          this.sfx.buy();
          const c = this.cellCenter(player.position);
          this.effects.floatUp(c.x, c.y, { count: 8, colors: [PALETTE.gold, PALETTE.greenLt] });
          this.floatText(`+￥${r.amount}`, c, PALETTE.greenLt);
          break;
        }
        case 'neutral': {
          log(state, 'sys', `${player.name} ${r.reason}`, '风险');
          break;
        }
        case 'buff': {
          if (!player.isAI) {
            this.toast(`获得状态「${r.buff.name}」：${r.buff.desc}`, r.buff.kind === 'bad' ? 't-bad' : 't-good');
          }
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
        case 'wheel-result': {
          // 转盘抽中的效果 —— 播报 + 特效（具体效果由后续结果条目结算）
          log(state, player.isAI ? 'ai' : 'good',
            `${player.name} 的${r.wheelName}抽出「${r.outcomeName}」${r.big ? `（${r.big}）` : ''}`,
            '转盘');
          const c = this.cellCenter(player.position);
          this.effects.confetti(c.x, c.y);
          this.floatText(r.outcomeName, c, r.trap ? PALETTE.redLt : PALETTE.gold);
          break;
        }
        case 'casino-open': {
          // 私人赌场 · 德州扑克 —— 全体玩家同桌
          this.openCasino(player);
          return;
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
          this.floatText(`+￥${r.amount}`, this.cellCenter(player.position), FX.jadeLt);
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
            // 真人玩家在场时弹窗征询认购，流程挂起由弹窗回调恢复
            if (this.aiBond(player) === false) return;
          } else {
            this.busy = false;
            showBondDialog(player, this.state,
              () => {
                // 认购结果由市场随机决定，发行人无法自判成败
                const res = underwriteBond(this.state, player);
                this.busy = false;
                showBondResultDialog(res, () => {
                  if (res.ok) {
                    this.sfx.buy();
                    this.floatText(`+￥${res.raised}`, this.cellCenter(player.position), PALETTE.greenLt);
                    this.toast(`债券发行成功，${res.subscribers} 家认购`, 't-good');
                  } else {
                    this.sfx.deny();
                    this.toast(`发行失败：${res.reason}`, 't-bad');
                  }
                  this.busy = true;
                  this.continueAfterSettlement(player);
                });
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
          // 必须真实应用监管卡效果（罚金 / 强制披露 / 自我租金倍率）——
          // 之前只记日志不做结算，「监管抽查」形同虚设。
          // applyTrapCard 内部含减免判定与 log，这里不重复记日志。
          applyTrapCard(state, player, r.card);
          this.sfx.deny();
          const c = this.cellCenter(player.position);
          this.effects.burst(c.x, c.y, { count: 14, colors: [PALETTE.red, PALETTE.redLt, FX.amber], speed: 2.4 });
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

  /**
   * AI 发行债券 —— 逐一征询其他玩家认购意愿。
   * 真人玩家必须弹窗确认，不再被 AI 代扣资金；弹窗打开时返回 false 挂起流程。
   */
  aiBond(player) {
    const state = this.state;
    const decisions = [];
    const human = state.players.find((o) => o.id !== player.id && !o.bankrupt && !o.isAI) || null;
    // 票息由发行人财务状况决定（负债率越高、净资产越差，票息越高）
    const coupon = bondCouponFor(state, player);
    const couponPer = Math.round(CONFIG.bondFace * coupon);

    for (const other of state.players) {
      if (other.id === player.id || other.bankrupt || !other.isAI) continue;
      const d = decideBondSubscription(state, other, player, coupon);
      decisions.push({ playerId: other.id, subscribed: d.subscribed, reason: d.reason });
      log(state, 'ai', `${other.name} ${d.subscribed ? '认购' : '放弃'}：${d.reason}`, playerPersonality(other).tag);
    }

    const finalize = (humanDecision) => {
      const all = humanDecision ? decisions.concat(humanDecision) : decisions;
      const res = issueBond(state, player, all);
      if (humanDecision) {
        log(state, humanDecision[0].subscribed ? 'self' : 'sys',
          `你${humanDecision[0].subscribed ? '认购了' : '放弃了'} ${player.name} 的债券`, '债券');
      }
      if (res.ok) {
        log(state, 'ai', `${player.name} 成功发行债券，募资 ￥${res.raised}`, playerPersonality(player).tag);
      } else {
        log(state, 'ai', `${player.name} 债券发行失败：${res.reason}`, playerPersonality(player).tag);
      }
      return res;
    };

    if (!human) {
      finalize(null);
      return true;
    }

    // 真人玩家：弹窗征询是否认购（AI 不得代扣资金）
    this.busy = false;
    const issuerAssets = Math.max(0, totalAssets(player, state));
    const bondMetrics = financialMetrics(player, state);
    const body = document.createElement('div');
    body.className = 'modal-text';
    body.innerHTML = `
      <span class="hl">${escapeHtml(player.name)}</span> 正在发行公司债券，邀请你认购。<br>
      面值 <span class="hl">￥${CONFIG.bondFace}</span> · 每圈票息
      <span class="hl">￥${couponPer}</span>（<span class="hl">${Math.round(coupon * 1000) / 10}%</span>）·
      期限 <span class="hl">${CONFIG.bondTerm} 圈</span><br>
      持有到期共可获
      <span class="hl-green">￥${CONFIG.bondFace + couponPer * CONFIG.bondTerm}</span><br>
      <span class="dim">发行方总资产 ￥${issuerAssets} · 负债率 ${bondMetrics.debtRatio}% · 你当前现金 ￥${human.cash}（若发行方中途爆仓，可能损失本金与票息）</span>
    `;
    openModal({
      title: '债券认购征询',
      body,
      dismissible: false,
      actions: [
        {
          text: '放弃认购',
          onClick: () => {
            finalize([{ playerId: human.id, subscribed: false }]);
            this.busy = true;
            this.continueAfterSettlement(player);
          },
        },
        {
          text: `认购 ￥${CONFIG.bondFace}`,
          primary: true,
          onClick: () => {
            finalize([{ playerId: human.id, subscribed: true }]);
            this.busy = true;
            this.continueAfterSettlement(player);
          },
        },
      ],
    });
    return false; // 告知调用方流程已挂起，由弹窗回调恢复
  }

  applyEvent(player, card) {
    const res = applyEventCard(this.state, player, card);
    log(this.state, player.isAI ? 'ai' : 'sys',
      `${player.name} 抽到「${card.title}」：${card.text}`, '事件');
    if (res.cash) {
      this.floatText(`${res.cash > 0 ? '+' : ''}￥${res.cash}`, this.cellCenter(player.position),
        res.cash > 0 ? FX.jadeLt : PALETTE.redLt);
    }
    const c = this.cellCenter(player.position);
    this.effects.floatUp(c.x, c.y, { count: 8, colors: [PALETTE.gold, FX.neon] });
  }

  onPurchased(player, r) {
    this.sfx.buy();
    const c = this.cellCenter(r.cellIndex);
    this.effects.floatUp(c.x, c.y, { count: 10, colors: [PALETTE.gold, FX.amberLt, PALETTE.paper] });
    this.effects.burst(c.x, c.y, { count: 14, colors: [PALETTE.gold, FX.amberLt], speed: 2.8 });
    this.floatText(`-￥${r.price}`, c, FX.amber);
    log(this.state, player.isAI ? 'ai' : 'good',
      `${player.name} 收购了 ${r.cell.name}（￥${r.price}）`, '收购');
  }

  onTakeovered(player, r) {
    this.sfx.buy();
    const c = this.cellCenter(r.cellIndex);
    this.effects.floatUp(c.x, c.y, { count: 10, colors: [PALETTE.gold, FX.amberLt, PALETTE.paper] });
    this.effects.burst(c.x, c.y, { count: 14, colors: [PALETTE.gold, FX.amberLt], speed: 2.8 });
    this.effects.triggerShake();
    this.shakeScreen();
    this.floatText(`-￥${r.price}`, c, FX.amber);
    log(this.state, player.isAI ? 'ai' : 'good',
      `${player.name} 强制收购了 ${r.ownerName} 的 ${r.cell.name}（￥${r.price}，${levelLabel(r.level)} 2 倍价）`, '强收');
  }

  /* ==================== 私人赌场 · 德州扑克 ==================== */

  /**
   * 打开德州扑克桌面。
   *
   * 流程：
   *   1. `startCasinoGame` 建局（规则引擎负责发牌 / 牌库断言）；
   *   2. `showPokerTable` 渲染桌面并驱动 AI 行动；
   *   3. 对局结束 → `finishCasinoGame` 结算回主游戏 → 展示摊牌结果；
   *   4. 无论结束还是中途退出，都必须**恢复主游戏**（pending 清空、
   *      state.poker 清空、棋盘重新可交互、继续原玩家的回合）。
   */
  openCasino(player) {
    const state = this.state;
    const game = startCasinoGame(state);
    if (!game) {
      // 人数不足（其它玩家已全部破产）—— 安全降级，直接继续主游戏
      log(state, 'sys', '赌场人数不足，本局德州扑克取消', '赌场');
      state.pending = null;
      this.continueAfterSettlement(player);
      return;
    }

    // 把头像 / 配色索引带进对局，供 UI 渲染座位小像
    const avatarIdx = new Map();
    const colorIdx = new Map();
    for (const p of state.players) {
      avatarIdx.set(p.id, p.avatar ?? 0);
      colorIdx.set(p.id, p.colorIndex ?? 0);
    }
    game.seatAvatarIndex = avatarIdx;
    game.seatColorIndex = colorIdx;

    this.busy = true;
    this.sfx.cardFlip();
    const c = this.cellCenter(player.position);
    this.effects.confetti(c.x, c.y);
    this.toast('进入私人赌场 · 德州扑克', 't-good');

    const viewerId = player.isAI ? (state.players.find((p) => !p.isAI) || player).id : player.id;

    /** 收尾：结算 + 恢复主游戏 */
    const finish = (g, exited = false) => {
      const res = finishCasinoGame(state, g);
      state.pending = null;
      showPokerResult(g, () => {
        closePokerTable();
        this.syncLog();
        this.updateHUD();
        this.busy = false;
        if (exited) {
          log(state, 'sys', '本局德州扑克提前结束，已回到主游戏', '赌场');
        }
        // 恢复主游戏流程：继续原玩家的回合
        this.continueAfterSettlement(player);
      });
      return res;
    };

    showPokerTable({
      game,
      viewerId,
      onFinish: (g) => finish(g, false),
      onExit: (g) => {
        // 中途退出：由引擎把剩余玩家标记为弃牌并按规则分配底池，
        // 然后正常结算回主游戏（现金绝不为负、机构所有权不变）。
        abortPokerGame(g);
        finish(g, true);
      },
    });
  }

  continueAfterSettlement(player) {
    if (!player.isAI) {
      this.state.phase = 'await-decision';
      // 玩家这一回合的播报要立刻落到列表里 ——
      // 例如「放弃收购机构格」这类只走 resolvePurchase() 的分支
      // 不会经过 syncLog()，不补这一句列表就会漏掉这条播报。
      this.syncLog();
      this.updateHUD();
      this.busy = false;
      return;
    }

    this.runAIEconomy(player);
    this.ensureSolvency(player, () => {
      this.syncLog();
      this.updateHUD();
      this.busy = false;
      delay(500, () => this.advanceTurn());
    });
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

  aiTakeover(player, r) {
    const state = this.state;
    const decision = decide(state, player, 'takeover', { cellIndex: r.cellIndex, price: r.price });

    if (decision.action === 'buy' && player.cash >= r.price) {
      const ok = resolveTakeover(state, player, true);
      if (ok) this.onTakeovered(player, r);
      else log(state, 'ai', `${player.name} 强收 ${r.cell.name} 失败（现金不足）`, playerPersonality(player).tag);
      if (decision.reason) log(state, 'ai', `${player.name}：${decision.reason}`, playerPersonality(player).tag);
    } else {
      resolveTakeover(state, player, false);
      log(state, 'ai', `${player.name} 放弃强收 ${r.cell.name}：${decision.reason}`, playerPersonality(player).tag);
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
    } else if (plan.wantRedeem) {
      // 现金充裕时赎回质押机构，恢复租金收入与完整市值
      const d = decide(state, player, 'redeem');
      if (d.action === 'redeem') {
        const res = redeemInstitution(state, player, d.cellIndex);
        if (res.ok) {
          const r = this.cellCenter(d.cellIndex);
          this.effects.dust(r.x, r.y, 10);
          log(state, 'ai', `${player.name}：${d.reason}`, playerPersonality(player).tag);
        }
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
    // 现金为负不能无条件结束回合：必须先追缴保证金
    if (p.cash < 0) {
      this.ensureSolvency(p, () => {
        if (!this.state || this.state.phase === 'gameover') return;
        this.state.phase = 'settling';
        this.advanceTurn();
      });
      return;
    }
    this.state.phase = 'settling';
    this.advanceTurn();
  }

  /* ==================== 追缴保证金 ==================== */
  /** 现金为负时的统一处理：AI 自动质押，玩家弹出强制补足窗口 */
  ensureSolvency(player, onDone) {
    if (!player || player.bankrupt || player.cash >= 0) { onDone(); return; }
    if (player.isAI) {
      const raised = raiseFundsForDeficit(this.state, player);
      if (raised.length) {
        const total = raised.reduce((s, r) => s + r.amount, 0);
        log(this.state, 'ai',
          `${player.name} 现金缺口触发追缴保证金，追加质押 ${raised.length} 家机构，补足 ￥${total}`,
          '追保');
      }
      checkBankruptcy(this.state, player);
      onDone();
      return;
    }
    this.openMarginCallDialog(player, onDone);
  }

  /** 玩家追保窗口：逐家质押或一键补足，补不足则强制平仓 */
  openMarginCallDialog(player, onDone) {
    const state = this.state;
    if (!player || player.bankrupt) { onDone(); return; }
    if (player.cash >= 0) { closeModal(); onDone(); return; }

    const unmortgaged = (player.institutions || []).filter((i) => !i.mortgaged);
    if (!unmortgaged.length) {
      // 已无可质押机构 → 强制平仓清算
      checkBankruptcy(state, player);
      this.syncLog();
      this.updateHUD();
      if (player.bankrupt) this.toast(`${player.name} 无力补足缺口，被强制平仓`, 't-bad');
      closeModal();
      onDone();
      return;
    }

    const self = this;
    showMarginCallDialog(player, state, {
      onMortgage: (cellIndex) => {
        const res = mortgageInstitution(state, player, cellIndex);
        if (res.ok) {
          self.sfx.buy();
          self.toast(`质押融资 ￥${res.amount}`, 't-gold');
        } else {
          self.sfx.deny();
          self.toast(res.reason, 't-bad');
        }
        self.syncLog();
        self.updateHUD();
        self.openMarginCallDialog(player, onDone);
      },
      onRaiseAll: () => {
        const raised = raiseFundsForDeficit(state, player);
        const total = raised.reduce((s, r) => s + r.amount, 0);
        if (total > 0) {
          self.sfx.buy();
          self.toast(`追加质押 ${raised.length} 家机构，补足 ￥${total}`, 't-gold');
        }
        self.syncLog();
        self.updateHUD();
        self.openMarginCallDialog(player, onDone);
      },
    });
  }

  runAITurn(player) {
    if (!this.state || this.state.phase === 'gameover') return;
    if (player.bankrupt) { this.advanceTurn(); return; }

    const state = this.state;
    this.state.phase = 'await-roll';
    // ⚠ AI 摇骰期间锁住 busy。
    //   AI 回合同样把 phase 置为 'await-roll'，而本函数随后要等待
    //   「700ms 起手 + DIE_ROLL_MS 滚动」才进入 moveAndSettle（那时才置 busy=true）。
    //   若不提前锁，这段窗口内 phase='await-roll' 且 busy=false ——
    //   状态上看起来「正等着人类掷骰」，与玩家回合无法区分。
    //   锁上之后：phase/busy 始终成对一致，AI 回合期间不会误触发玩家操作。
    this.busy = true;
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

      delay(DIE_ROLL_MS, () => {
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
    // 「我的机构」永远针对**人类玩家**（AI 回合也能查看自己的资产）
    const p = this.humanPlayer();
    if (!p || p.bankrupt) return;
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
          self.toast(`赎回完成，归还本金+解押费共 ￥${res.total}`, 't-good');
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
        name: p.name,
        assets: Math.max(0, totalAssets(p, state)),
        count: p.institutions.length,
        // 记录 AI 的「职业 + 性格」，便于战绩回看
        isAI: p.isAI,
        careerId: p.careerId,
        careerName: getCareer(p.careerId)?.name || '',
        personalityId: p.personalityId || null,
        personalityName: p.personality?.name || '',
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
    //
    // ⚠ P1-32：读取 clientWidth/Height 会触发**强制同步布局**，
    //   每帧读就是每秒 60 次强制回流 —— 已改为 dirty 位 + 250ms 节流，
    //   未标记脏时完全不碰布局属性（详见 syncBoardSize 注释）。
    this.syncBoardSize();

    // 背景层绘制到独立的 #stage-bg（覆盖整个 stage）
    const bgCanvas = this.el['stage-bg'];
    if (bgCanvas) {
      const bctx = bgCanvas.getContext('2d');
      const shake = this.effects.shakeOffset();
      bctx.save();
      // 背景是矢量绘制 —— 开启平滑，避免位图缩放出现锯齿（去像素风）
      bctx.imageSmoothingEnabled = true;
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

    this.renderer.draw(state, { elapsed: now, time: now, moveAnim, effects: this.effects });

    // 地块 DOM 状态同步（内部做 key 比对，状态没变就不碰 DOM）
    if (this.tileLayer) this.tileLayer.sync(state);
    // PR-D：建筑的等级 / 持有人配色依赖状态 —— 同步刷新
    if (this.hoverBuildings) this.hoverBuildings.sync(state);
    // PR-E：清理已播完的落地特效 DOM
    if (this.landingFx) this.landingFx.update();
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

    // 底部 HUD 预留：主行动按钮（掷骰子）浮在棋盘正下方，
    // 棋盘整体上移，保证底边一排格子永不被按钮遮挡。
    const bottomBar = this.el['hud-bottom'];
    let reserve = 0;
    if (bottomBar) {
      const br = bottomBar.getBoundingClientRect();
      const wrapRect = wrap ? wrap.getBoundingClientRect() : null;
      if (br.height > 0 && wrapRect) {
        // 按钮底边到棋盘容器底边的距离 + 按钮高度 + 一点安全间隙
        const gap = Math.max(0, wrapRect.bottom - br.bottom);
        reserve = Math.ceil(br.height + gap + 8);
      }
    }

    // 幂等：尺寸没变就直接跳过，避免无谓地重设 canvas.width/height
    // （重设会清空画布并触发 ResizeObserver 的再次通知）。
    const stageChanged = sw !== this._lastStageW || sh !== this._lastStageH;
    const boardChanged = bw !== this.renderer.w || bh !== this.renderer.h;
    if (!stageChanged && !boardChanged && reserve === this._lastReserve) return;

    this._lastStageW = sw;
    this._lastStageH = sh;
    this._lastReserve = reserve;
    this.renderer.resize(bw, bh, dpr);
    // resize 之后再设预留：setBottomReserve 会重算布局，需要正确的 w/h
    this.renderer.setBottomReserve(reserve);
    // 地块 DOM 层同步布局：cellRect → 百分比（canvas 尺寸已定，cellRect 才是最终值）
    if (this.tileLayer) this.tileLayer.layout();
    // PR-D：建筑位置是像素写死的 —— 必须跟着重排
    if (this.hoverBuildings) this.hoverBuildings.relayout();
    this.background.resize(Math.max(1, sw), Math.max(1, sh));
    this.resizeStageBg(sw, sh);
  }

  /**
   * 逐帧兜底：棋盘容器尺寸与渲染器记录不一致时触发重算。
   * 覆盖「媒体查询刚切换」「字体加载后行高变化」「面板增减」等
   * ResizeObserver 可能漏掉的时机。
   *
   * ================== P1-32：节流 250ms + dirty 位 ==================
   *
   * 旧实现**每帧**都读 `clientWidth/clientHeight` ——
   * 这会触发浏览器的**强制同步布局**（layout thrashing）：
   * 读尺寸 → 写样式 → 下一帧再读尺寸 → 再强制回流。
   * 在 60fps 下就是每秒 60 次强制回流，是掉帧的隐形杀手。
   *
   * 优化：
   *   ① 用 `ResizeObserver` 置 dirty 位 —— 尺寸真的变了才标记；
   *   ② 读取尺寸的频率节流到 250ms 一次；
   *   ③ 没 dirty 时**完全不读 DOM 尺寸**（零布局开销）。
   */
  syncBoardSize(force = false) {
    const wrap = this.el['board-wrap'];
    if (!wrap) return;

    // 未标记脏 且 未到节流窗口 → 直接跳过（不读任何布局属性）
    const now = performance.now();
    if (!force && !this._boardSizeDirty && (now - (this._lastSizeCheck || 0)) < 250) {
      return;
    }
    this._lastSizeCheck = now;
    this._boardSizeDirty = false;

    const bw = Math.floor(wrap.clientWidth);
    const bh = Math.floor(wrap.clientHeight);
    if (bw < 80 || bh < 80) return;
    if (bw !== this.renderer.w || bh !== this.renderer.h) {
      this.onResize();
    }
  }

  /**
   * 标记棋盘尺寸为「脏」—— 由 ResizeObserver 调用。
   *
   * 置脏后下一次 `syncBoardSize()` 才会真正去读 DOM 尺寸。
   */
  markBoardSizeDirty() {
    this._boardSizeDirty = true;
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
    // 背景层为矢量绘制 —— 开启平滑缩放（去像素风）
    ctx.imageSmoothingEnabled = true;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /* ==================== HUD ==================== */
  updateHUD() {
    const state = this.state;
    if (!state) return;

    const p = currentPlayer(state);
    // ===== 当前玩家卡：永远显示**人类玩家**，不随 AI 回合切换 =====
    const me = this.humanPlayer() || p;

    // ===== 左上角：当前玩家紧凑单条 =====
    const card = this.el['active-player-card'];
    if (me) {
      const pc = PLAYER_COLORS[me.colorIndex % PLAYER_COLORS.length];
      card.style.borderLeft = `4px solid ${pc.main}`;
      this.el['active-player-name'].textContent = me.name;
      this.el['active-player-cash'].textContent = `￥${me.cash}`;
      const cnt = me.institutions.length;
      // 副标题：真人显示「职业 · 控股 N 家 · 资产」
      const career = getCareer(me.careerId);
      const roleText = career ? career.name : '';
      this.el['active-player-sub'].textContent = me.bankrupt
        ? '已退市'
        : (roleText
          ? `${roleText} · 控股 ${cnt} 家 · 资产 ￥${totalAssets(me, state)}`
          : `控股 ${cnt} 家 · 资产 ￥${totalAssets(me, state)}`);

      // 头像（职业立绘 32×40，居中适配到 HUD 画布）
      const avatarCanvas = this.el['active-avatar'];
      const icon = getAvatarIcon(me.avatar, me.colorIndex);
      const actx = avatarCanvas.getContext('2d');
      actx.clearRect(0, 0, avatarCanvas.width, avatarCanvas.height);
      const isVector = icon.width >= 32;
      actx.imageSmoothingEnabled = isVector;
      const scale = Math.min(avatarCanvas.width / icon.width, avatarCanvas.height / icon.height);
      const dw = icon.width * scale;
      const dh = icon.height * scale;
      actx.drawImage(
        icon, 0, 0, icon.width, icon.height,
        Math.round((avatarCanvas.width - dw) / 2),
        Math.round((avatarCanvas.height - dh) / 2),
        Math.round(dw), Math.round(dh),
      );

      // 贷款 / 债券 / 限时状态提示（无内容时自动隐藏）
      renderActiveStatus(this.el['active-status'], me, state);

      // ===== 左侧 Tab 面板内容（数据源与排行 / 财务下钻一致）=====
      renderTabPanels({
        inst: this.el['tab-panel-inst'],
        buff: this.el['tab-panel-buff'],
        loan: this.el['tab-panel-loan'],
        bond: this.el['tab-panel-bond'],
        net: this.el['tab-panel-net'],
      }, me, state);
    }

    // ===== 右上角：回合数 + 市场 =====
    this.el['hud-round'].textContent = String(state.round || 1);
    const mk = this.el['hud-market'];
    mk.textContent = this.marketName(state.market);
    mk.className = 'hud-market ' + (state.market === 'bull' ? 'is-bull' : state.market === 'bear' ? 'is-bear' : '');

    // ===== 顶部全宽回合归属条（P1-1）：谁在行动 =====
    this.renderTurnBar(state);

    // ===== 底部：主行动 + 常用操作按钮 =====
    const isPlayer = p && !p.isAI && !p.bankrupt;
    const canRoll = isPlayer && !this.busy && state.phase === 'await-roll';
    this.el['btn-roll'].disabled = !canRoll;
    // 主按钮随回合阶段切换文案（保持只有一个主行动）
    const rollBtn = this.el['btn-roll'];
    const nextLabel = canRoll ? '掷 骰 子'
      : (isPlayer && state.phase !== 'await-roll' ? '结 算 中' : '等 待 AI');
    if (rollBtn.textContent.trim() !== nextLabel) {
      rollBtn.textContent = nextLabel;
    }
    this.el['btn-assets'].disabled = !isPlayer;
    this.el['btn-mortgage'].disabled = !isPlayer;
    this.el['btn-endturn'].disabled = !isPlayer || state.phase === 'await-roll';

    // ===== 右侧常驻面板：资产排行 + 全玩家财务对比 =====
    renderRank(this.el['rank-side'], state, (p2, rank) => this.openPlayerDetail(p2, rank));
    renderFinanceCompare(this.el['fin-compare'], state);

    // 排行弹窗（窄屏入口）内容保持最新（打开时立即可见）
    if (!this.el['rank-root'].hidden) {
      renderRank(this.el['rank-list'], state, (p2, rank) => {
        this.closeRankModal();
        this.openPlayerDetail(p2, rank);
      });
    }
  }

  syncLog() {
    const state = this.state;
    const el = this.el['log-list'];
    if (!state) return;
    clearLog(el);
    for (const entry of state.log.slice(-60)) appendLog(el, entry);
  }

  /**
   * 顶部全宽回合归属条（P1-1）。
   *
   * ================== 为什么需要它 ==================
   * 左侧「当前玩家卡」固定显示**人类玩家**（我的资产 / 我的机构），
   * 它**不会**随 AI 回合切换 —— 所以「现在是谁在行动」这件事
   * 在屏幕上**没有直接答案**。玩家只能盯着棋盘上的箭头猜，
   * AI 一多就彻底分不清谁在动。
   *
   * 这条色带按玩家分段（每段 = 一个玩家，底色 = 玩家主色，
   * 与棋盘棋子 / HUD 头像 / 扑克座位完全一致），
   * 当前行动者那段高亮 + 呼吸光晕，并在下方标出名字。
   *
   * ⚠ DOM 只在**玩家集合变化**时重建；每帧只改 class / 颜色，
   *   避免逐帧操作 DOM 造成布局抖动（性能）。
   */
  renderTurnBar(state) {
    const track = this.el['turn-bar-track'];
    const owner = this.el['turn-bar-owner'];
    const nameEl = this.el['turn-bar-name'];
    if (!track || !owner) return;

    const players = state.players || [];
    // ---- 结构性变化才重建 DOM：玩家数量 / id 列表变了 ----
    const sig = players.map((p) => `${p.id}:${p.colorIndex}`).join(',');
    if (this._turnBarSig !== sig) {
      this._turnBarSig = sig;
      track.innerHTML = '';
      this._turnBarSegs = players.map((p) => {
        const seg = document.createElement('div');
        seg.className = 'turn-bar-seg';
        seg.dataset.pid = String(p.id);
        const pc = PLAYER_COLORS[p.colorIndex % PLAYER_COLORS.length];
        seg.style.setProperty('--seg-color', pc.main);
        track.appendChild(seg);
        return seg;
      });
    }

    // ---- 逐帧只更新「谁在行动」 ----
    const cur = currentPlayer(state);
    const curId = cur ? cur.id : -1;
    const segs = this._turnBarSegs || [];
    for (let i = 0; i < segs.length; i++) {
      const p = players[i];
      const seg = segs[i];
      const isActive = p && p.id === curId && state.phase !== 'gameover';
      seg.classList.toggle('is-active', !!isActive);
      seg.classList.toggle('is-out', !!(p && p.bankrupt));
    }

    if (cur) {
      const pc = PLAYER_COLORS[cur.colorIndex % PLAYER_COLORS.length];
      nameEl.textContent = cur.isAI
        ? `${cur.name}（AI）行动中`
        : `${cur.name} 行动中`;
      owner.style.setProperty('--owner-color', pc.main);
    } else {
      nameEl.textContent = '—';
      owner.style.setProperty('--owner-color', 'var(--c-dim)');
    }
  }

  /* ==================== 特效辅助 ==================== */
  cellCenter(index) {
    const r = this.renderer.cellRect(index);
    return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
  }

  /**
   * 取机构立绘精灵（供交租弹窗展示）。
   * 找不到时返回 null —— 弹窗会自动跳过图片区，不影响主流程。
   */
  institutionSprite(cell, level, ownerColorIndex) {
    try {
      const gi = GROUP_INDEX_BY_GROUP[cell.group] ?? 0;
      const ownerColor = ownerColorIndex != null
        ? PLAYER_COLORS[ownerColorIndex % PLAYER_COLORS.length].main
        : null;
      return getInstitutionSprite(cell, level, ownerColor, gi);
    } catch {
      return null;
    }
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
    // 记录分享 seed：开局时沿用，保证 AI 的「职业 + 性格」组合可复现
    this.shareSeed = params.seed;
    this.setup.nickname = params.nickname || this.setup.nickname;
    // 旧分享链接可能带 `av`（棋子形象）参数 —— **直接忽略**，
    // 立绘已由职业唯一决定，无需也不能再从链接恢复外观。
    if (params.careerId && CAREER_BY_ID[params.careerId]) {
      this.setup.careerId = params.careerId;
    }
    this.setup.difficulty = params.difficulty;
    this.setup.aiCount = params.aiCount;
    this.setup.diceCount = params.diceCount;
    this.setup.cash = params.cash;
    this.setup.market = params.market;
    this.el['input-nickname'].value = this.setup.nickname;
    this.refreshCareers();
    this.refreshSegments();
    this.refreshAiPreview();
    this.toast(`已载入分享局（种子 ${params.seed}），点击"开局"复现`, 't-gold');
  }
}

/** HTML 转义 —— 防止玩家昵称 / 机构名注入到 innerHTML */
function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const game = new Game();
game.init();
window.__game = game;
// 暴露非节流延时，供自动化测试脚本使用
window.__delay = (ms, fn) => delay(ms, fn);
