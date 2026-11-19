/**
 * 德州扑克桌面 UI —— 赌场小游戏的交互层。
 *
 * 职责边界：
 *   · `core/poker.js`   —— 规则引擎（发牌 / 牌力 / 下注 / 分池 / 结算）
 *   · `core/rules.js`   —— 主游戏 <-> 小游戏桥接（startCasinoGame / finishCasinoGame）
 *   · `app/poker-ui.js` —— **纯表现**：渲染桌面、收集玩家动作、驱动 AI 行动
 *
 * UI 只调用引擎暴露的 API，不直接改动任何玩家资产 —— 保证主游戏状态
 * 不会被 UI 层写坏。
 */

import { PALETTE, PLAYER_COLORS } from '../core/palette.js';
import { getCardFace, getCardBack } from '../art/cards.js';
import { getAvatarSprites } from '../art/avatars.js';
import {
  currentActor, legalActions, applyAction, aiAction, visibleHoleCards,
  remainingCards, POKER_CONFIG, cardLabel, evaluateHand, HAND_NAMES,
  handStrength,
} from '../core/poker.js';

/** 街道中文名 */
const STREET_NAME = {
  preflop: '翻牌前',
  flop: '翻牌',
  turn: '转牌',
  river: '河牌',
  showdown: '摊牌',
  over: '结束',
};

/** 动作中文名 */
const ACTION_NAME = {
  fold: '弃牌', check: '过牌', call: '跟注', raise: '加注', allin: '全下',
};

/**
 * HTML 转义 —— 牌型名 / 玩家名会进 innerHTML，必须转义。
 */
function escapeText(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * 打开德州扑克桌面。
 *
 * @param {object} opts
 *   - game     —— core/poker.js 的对局对象
 *   - viewerId —— 当前人类玩家的 id
 *   - onFinish —— 对局结束回调（拿到对局对象，由调用方调 finishCasinoGame）
 *   - onExit   —— 中途退出的回调（未摊牌也允许退出，视为弃牌完结）
 */
export function showPokerTable(opts) {
  const { game, viewerId, onFinish, onExit } = opts;

  const root = document.getElementById('poker-root');
  const box = document.getElementById('poker-box');
  if (!root || !box) return null;

  box.innerHTML = '';

  // ===== 顶部：标题 + 底池 + 牌库余量 =====
  const head = document.createElement('div');
  head.className = 'poker-head';
  head.innerHTML = `
    <h2 class="modal-title">私人赌场 · 德州扑克</h2>
    <div class="poker-head-info">
      <span class="poker-pot">底池 <b id="pk-pot">￥0</b></span>
      <span class="poker-street" id="pk-street">翻牌前</span>
      <span class="poker-deck" id="pk-deck">牌库 52 张</span>
    </div>
  `;
  box.appendChild(head);

  // ===== 公共牌区 =====
  const boardWrap = document.createElement('div');
  boardWrap.className = 'poker-board';
  box.appendChild(boardWrap);

  // ===== 座位区 =====
  const seatsWrap = document.createElement('div');
  seatsWrap.className = 'poker-seats';
  box.appendChild(seatsWrap);

  // ===== 操作区 =====
  const actionWrap = document.createElement('div');
  actionWrap.className = 'poker-actions';
  box.appendChild(actionWrap);

  // ===== 规则提示 =====
  const hint = document.createElement('div');
  hint.className = 'poker-hint';
  hint.innerHTML = '德州扑克：一副 52 张牌 · 盲注下注 · 翻牌/转牌/河牌各一张 · '
    + '「赌王」起始底牌多 1 张。现金不足可用资产额度下注（机构所有权不变）。';
  box.appendChild(hint);

  const els = {
    pot: head.querySelector('#pk-pot'),
    street: head.querySelector('#pk-street'),
    deck: head.querySelector('#pk-deck'),
  };

  let finished = false;

  /** 渲染座位 */
  function renderSeats() {
    seatsWrap.innerHTML = '';
    // 按座位顺序排列，viewer 放在最后（更靠近操作区）
    const ordered = [...game.seats].sort((a, b) => {
      if (a.playerId === viewerId) return 1;
      if (b.playerId === viewerId) return -1;
      return a.seat - b.seat;
    });

    for (const seat of ordered) {
      const isViewer = seat.playerId === viewerId;
      const isTurn = currentActor(game) === seat.seat && !game.over;
      const card = document.createElement('div');
      card.className = 'poker-seat';
      if (isViewer) card.classList.add('is-me');
      if (isTurn) card.classList.add('is-turn');
      if (seat.folded) card.classList.add('is-folded');
      if (seat.allIn) card.classList.add('is-allin');

      // 头像 + 名字
      const headRow = document.createElement('div');
      headRow.className = 'poker-seat-head';

      const av = document.createElement('canvas');
      av.className = 'poker-avatar';
      const sprites = getAvatarSprites(
        game.seatAvatarIndex?.[seat.playerId] ?? 0,
        game.seatColorIndex?.[seat.playerId] ?? seat.seat,
      );
      // 立绘统一为职业矢量立绘（32×40）—— 直接沿用原生尺寸，避免压扁变形
      av.width = sprites.idle.width;
      av.height = sprites.idle.height;
      const actx = av.getContext('2d');
      actx.imageSmoothingEnabled = true;
      actx.drawImage(sprites.idle, 0, 0);
      headRow.appendChild(av);

      const nameBox = document.createElement('div');
      nameBox.className = 'poker-seat-name';
      nameBox.innerHTML = `<span class="pn">${seat.name}</span>`
        + `<span class="pc">￥${seat.stack}</span>`;
      headRow.appendChild(nameBox);
      card.appendChild(headRow);

      // 底牌
      const holeRow = document.createElement('div');
      holeRow.className = 'poker-hole';
      const visible = visibleHoleCards(game, seat.seat, viewerId);
      const showCards = visible.length > 0;
      for (let i = 0; i < seat.hole.length; i++) {
        const cv = document.createElement('canvas');
        cv.className = 'poker-card';
        cv.width = 22;
        cv.height = 30;
        const cctx = cv.getContext('2d');
        cctx.imageSmoothingEnabled = false;
        const sprite = showCards ? getCardFace(seat.hole[i]) : getCardBack();
        cctx.drawImage(sprite, 0, 0);
        holeRow.appendChild(cv);
      }
      card.appendChild(holeRow);

      // 状态条
      const status = document.createElement('div');
      status.className = 'poker-seat-status';
      const bits = [];
      if (seat.folded) bits.push('已弃牌');
      if (seat.allIn) bits.push('全下');
      if (seat.bet > 0) bits.push(`已下注 ￥${seat.bet}`);
      if (seat.handName) bits.push(seat.handName);
      if (seat.lastAction && ACTION_NAME[seat.lastAction]) {
        bits.push(ACTION_NAME[seat.lastAction]);
      }
      status.textContent = bits.join(' · ') || '等待行动';
      card.appendChild(status);

      seatsWrap.appendChild(card);
    }
  }

  /** 渲染公共牌 */
  function renderBoard() {
    boardWrap.innerHTML = '';
    const label = document.createElement('span');
    label.className = 'poker-board-label';
    label.textContent = '公共牌';
    boardWrap.appendChild(label);

    for (let i = 0; i < POKER_CONFIG.communitySize; i++) {
      const cv = document.createElement('canvas');
      cv.className = 'poker-card poker-card-board';
      cv.width = 22;
      cv.height = 30;
      const cctx = cv.getContext('2d');
      cctx.imageSmoothingEnabled = false;
      const c = game.community[i];
      cctx.drawImage(c ? getCardFace(c) : getCardBack(), 0, 0);
      boardWrap.appendChild(cv);
    }
  }

  /** 渲染顶部信息 */
  function renderHead() {
    els.pot.textContent = `￥${game.pot}`;
    els.street.textContent = STREET_NAME[game.street] || game.street;
    els.deck.textContent = `牌库余 ${remainingCards(game)} 张`;
  }

  /* ==========================================================
   * P1-17：牌力提示
   *
   * ⚠ 为什么需要：
   *   德州扑克的决策核心是「我这手牌有多强」。
   *   没有提示时玩家只能自己数点 —— 而这正是新手最不会做的事。
   *
   * ⚠ 公平性：
   *   只显示**自己**的牌力（与 AI 用的 `handStrength` 同一个函数），
   *   **不泄露**对手的牌。牌型名称（如「两对」）在摊牌前也只对自己显示。
   * ========================================================== */
  function renderHandHint(seatIndex) {
    const seat = game.seats[seatIndex];
    const box = document.createElement('div');
    box.className = 'poker-hand-hint';

    // 牌型名称（仅自己有牌时才有意义）
    const cards = [...seat.hole, ...game.community];
    let handName = '';
    if (cards.length >= 2) {
      const ev = evaluateHand(cards);
      handName = HAND_NAMES[ev.rank] || '';
    }

    // 强度（0~1）—— 与 AI 完全相同的算法
    const strength = handStrength(game, seatIndex);
    const pct = Math.round(strength * 100);
    // 分档：弱 / 中 / 强
    const level = strength >= 0.62 ? 'strong'
      : strength >= 0.38 ? 'mid' : 'weak';
    const levelText = strength >= 0.62 ? '强'
      : strength >= 0.38 ? '中等' : '偏弱';

    box.innerHTML = `
      <span class="poker-hand-hint-label">我的牌力</span>
      <span class="poker-hand-name">${escapeText(handName) || '待发牌'}</span>
      <span class="poker-hand-bar">
        <span class="poker-hand-fill is-${level}" style="width:${pct}%"></span>
      </span>
      <span class="poker-hand-pct is-${level}">${pct}% · ${levelText}</span>
    `;
    return box;
  }

  /* ==========================================================
   * P1-16：加注滑杆 + 底池赔率
   *
   * ⚠ 底池赔率（pot odds）—— 玩家判断「该不该跟」的核心依据：
   *   赔率 = 跟注额 ÷ (底池 + 跟注额)
   *   跟注额占最终底池的比例越大，赔率越差。
   *   直接显示百分比，省去玩家心算。
   * ========================================================== */
  function renderBetSlider(raiseAct, toCall, seat) {
    const box = document.createElement('div');
    box.className = 'poker-bet-box';

    const min = Math.max(1, raiseAct.min || 1);
    const max = Math.max(min, raiseAct.max ?? min);
    /**
     * 滑杆步长 —— 必须能**整除** (max - min)。
     *
     * ⚠ 为什么：
     *   HTML `<input type=range>` 会把 value 吸附到 `min + k*step`。
     *   若 step 除不尽区间，滑杆**永远到不了 max**（会被吸附回上一个刻度），
     *   表现为「拖到底了但数字框不是上限」。
     *   这里取能整除区间的最大「整齐步长」，保证滑杆两端都能精确命中。
     */
    const span = max - min;
    const rawStep = Math.max(1, Math.round(min / 2) || 1);
    let step = rawStep;
    for (let s = rawStep; s >= 1; s--) {
      if (span % s === 0) { step = s; break; }
    }
    if (span % step !== 0) step = 1;

    // ---- 赔率条 ----
    const pot = game.pot;
    const oddsRow = document.createElement('div');
    oddsRow.className = 'poker-odds-row';
    // 跟注赔率
    const callOdds = toCall > 0 ? (toCall / (pot + toCall)) : 0;
    // 加注赔率（按当前滑杆值实时更新）
    const raiseOddsEl = document.createElement('span');
    raiseOddsEl.className = 'poker-odds-item';
    oddsRow.innerHTML = `<span class="poker-odds-label">底池赔率</span>`;
    const callOddsEl = document.createElement('span');
    callOddsEl.className = 'poker-odds-item';
    callOddsEl.textContent = toCall > 0
      ? `跟注 ${(callOdds * 100).toFixed(0)}%`
      : '无需跟注';
    oddsRow.appendChild(callOddsEl);
    oddsRow.appendChild(raiseOddsEl);
    box.appendChild(oddsRow);

    // ---- 滑杆 ----
    const sliderRow = document.createElement('div');
    sliderRow.className = 'poker-bet-row';

    const range = document.createElement('input');
    range.type = 'range';
    range.className = 'poker-bet-slider';
    range.min = String(min);
    range.max = String(max);
    range.step = String(step);
    range.value = String(min);

    // ---- 数字输入（滑杆 + 数字双向绑定）----
    const num = document.createElement('input');
    num.type = 'number';
    num.className = 'poker-bet-number';
    num.min = String(min);
    num.max = String(max);
    num.step = String(step);
    num.value = String(min);

    const confirm = document.createElement('button');
    confirm.className = 'pixel-btn poker-btn poker-btn-sm';
    confirm.textContent = '确认加注';

    /** 当前加注额（**总额**：与规则层的 raise amount 语义一致） */
    const current = (from) => {
      const raw = from === 'range' ? range.value : num.value;
      const v = Math.max(min, Math.min(max, Number(raw) || min));
      return Math.round(v);
    };

    /**
     * 刷新滑杆 / 数字 / 赔率三处显示。
     *
     * ⚠ 必须**从触发源取值**（from）——
     *   若统一读 num.value，滑杆拖动时数字框还是旧值，
     *   结果会被立刻钳回最小值 —— 表现为「滑杆拖不动」。
     */
    const sync = (from) => {
      const v = current(from);
      if (from === 'range') num.value = String(v);
      else range.value = String(v);
      // 加注赔率：加注额 vs 底池
      const o = pot + v > 0 ? v / (pot + v) : 0;
      raiseOddsEl.textContent = `加注 ${(o * 100).toFixed(0)}%`;
      confirm.textContent = `确认加注 ￥${v}`;
      // 按钮是否可用（加注额必须 ≤ 上限）
      confirm.disabled = v > max;
    };

    range.addEventListener('input', () => sync('range'));
    num.addEventListener('input', () => sync('number'));
    num.addEventListener('change', () => sync('number'));
    confirm.addEventListener('click', () => {
      const v = current();
      doAction({ type: 'raise', amount: v });
    });

    sliderRow.appendChild(range);
    sliderRow.appendChild(num);
    sliderRow.appendChild(confirm);
    box.appendChild(sliderRow);

    // 档位快选（最小 / 2 倍 / 4 倍）
    const quick = document.createElement('div');
    quick.className = 'poker-raise-row';
    const opts = [min, min * 2, min * 4]
      .filter((v, i, arr) => v <= max && arr.indexOf(v) === i);
    for (const v of opts) {
      const qb = document.createElement('button');
      qb.className = 'pixel-btn poker-btn poker-btn-sm';
      qb.textContent = `￥${v}`;
      qb.addEventListener('click', () => {
        num.value = String(v);
        sync('number');
      });
      quick.appendChild(qb);
    }
    if (opts.length) box.appendChild(quick);

    sync('number');
    void seat;
    return box;
  }

  /* ==========================================================
   * P1-17：全下二次确认
   *
   * ⚠ 用**行内确认条**而不是嵌套弹窗：
   *   弹窗会盖住牌桌，玩家看不到自己的牌 —— 而「要不要全下」
   *   恰恰需要看着牌做决定。行内条保留了牌桌视野。
   * ========================================================== */
  function confirmAllIn(act, seatIndex) {
    // 已有确认条 → 去掉（取消）
    const existing = actionWrap.querySelector('.poker-allin-confirm');
    if (existing) { existing.remove(); return; }

    const seat = game.seats[seatIndex];
    const box = document.createElement('div');
    box.className = 'poker-allin-confirm';

    const msg = document.createElement('div');
    msg.className = 'poker-allin-msg';
    msg.innerHTML = `确认<b>全下 ￥${act.amount}</b>？`
      + `你的剩余筹码将全部押入，<b>无法撤销</b>。`;
    box.appendChild(msg);

    const btnRow = document.createElement('div');
    btnRow.className = 'poker-allin-btns';
    const cancel = document.createElement('button');
    cancel.className = 'pixel-btn poker-btn poker-btn-sm';
    cancel.textContent = '取消';
    const ok = document.createElement('button');
    ok.className = 'pixel-btn poker-btn poker-btn-sm poker-btn-allin';
    ok.textContent = '确认全下';
    btnRow.appendChild(cancel);
    btnRow.appendChild(ok);
    box.appendChild(btnRow);

    cancel.addEventListener('click', () => box.remove());
    ok.addEventListener('click', () => {
      box.remove();
      doAction({ type: 'allin', amount: act.amount });
    });

    actionWrap.insertBefore(box, actionWrap.firstChild);
    void seat;
  }

  /** 渲染操作区 */
  function renderActions() {
    actionWrap.innerHTML = '';
    if (finished) return;

    const idx = currentActor(game);
    if (game.over) {
      const t = document.createElement('div');
      t.className = 'poker-turn-note';
      t.textContent = '本局结束';
      actionWrap.appendChild(t);
      return;
    }

    if (idx < 0) {
      const t = document.createElement('div');
      t.className = 'poker-turn-note';
      t.textContent = '等待结算…';
      actionWrap.appendChild(t);
      return;
    }

    const seat = game.seats[idx];
    if (seat.playerId !== viewerId) {
      const t = document.createElement('div');
      t.className = 'poker-turn-note';
      t.textContent = `等待 ${seat.name} 行动…`;
      actionWrap.appendChild(t);
      return;
    }

    const acts = legalActions(game);
    const toCall = Math.max(0, game.currentBet - seat.bet);

    const note = document.createElement('div');
    note.className = 'poker-turn-note';
    note.innerHTML = `轮到你 —— 需跟注 <b>￥${toCall}</b> · 桌上可下注 <b>￥${seat.stack}</b>`
      + (seat.assetStack > 0 ? `（含资产额度 ￥${seat.assetStack}）` : '');
    actionWrap.appendChild(note);

    // ==========================================================
    // P1-17：牌力提示 —— 让玩家知道自己拿的是什么牌
    // ==========================================================
    actionWrap.appendChild(renderHandHint(idx));

    // ==========================================================
    // P1-16：加注滑杆 + 底池赔率
    // ==========================================================
    const raiseAct = acts.find((a) => a.type === 'raise');
    if (raiseAct) {
      actionWrap.appendChild(renderBetSlider(raiseAct, toCall, seat));
    }

    for (const a of acts) {
      if (a.type === 'raise') {
        // 加注档位：最小加注 / 2 倍 / 4 倍
        const row = document.createElement('div');
        row.className = 'poker-raise-row';
        const opts = [a.min, a.min * 2, a.min * 4]
          .filter((v, i, arr) => v <= (a.max ?? a.min) && arr.indexOf(v) === i);
        for (const v of opts) {
          const rb = document.createElement('button');
          rb.className = 'pixel-btn poker-btn poker-btn-sm';
          rb.textContent = `加注 ￥${v}`;
          rb.addEventListener('click', () => doAction({ type: 'raise', amount: v }));
          row.appendChild(rb);
        }
        actionWrap.appendChild(row);
        continue;
      }

      const btn = document.createElement('button');
      btn.className = 'pixel-btn poker-btn';
      if (a.type === 'allin') btn.classList.add('poker-btn-allin');
      btn.textContent = a.label;
      btn.disabled = !!a.disabled;
      if (a.disabled && a.reason) btn.title = a.reason;
      btn.addEventListener('click', () => {
        // ⚠ P1-17：全下**二次确认** —— 一把牌押上全部身家，
        //   误触的代价太大，必须让玩家确认一次。
        if (a.type === 'allin' && !a.disabled) {
          confirmAllIn(a, idx);
          return;
        }
        doAction({ type: a.type, amount: a.amount });
      });
      actionWrap.appendChild(btn);
    }

    // 退出按钮（随时可退出本局，视为弃牌完结）
    const exitBtn = document.createElement('button');
    exitBtn.className = 'pixel-btn poker-btn-exit';
    exitBtn.textContent = '退出牌局';
    exitBtn.addEventListener('click', () => {
      finished = true;
      if (onExit) onExit(game);
    });
    actionWrap.appendChild(exitBtn);
  }

  /** 执行动作并推进 */
  function doAction(action) {
    const idx = currentActor(game);
    if (idx < 0) return;
    const r = applyAction(game, idx, action);
    if (!r.ok) {
      flashNote(r.reason || '操作无效');
      return;
    }
    render();
    scheduleAI();
  }

  /** 临时提示 */
  function flashNote(text) {
    const n = document.createElement('div');
    n.className = 'poker-turn-note poker-note-bad';
    n.textContent = text;
    actionWrap.prepend(n);
    setTimeout(() => n.remove(), 1800);
  }

  /** AI 行动调度 —— 逐个回合推进，带一点节奏感 */
  function scheduleAI() {
    if (finished || game.over) {
      if (game.over && !finished) {
        finished = true;
        setTimeout(() => { if (onFinish) onFinish(game); }, 500);
      }
      return;
    }
    const idx = currentActor(game);
    if (idx < 0) return;
    const seat = game.seats[idx];
    if (seat.playerId === viewerId) return;   // 轮到人类玩家 → 停下等待

    setTimeout(() => {
      if (finished) return;
      const action = aiAction(game, idx, game.rng);
      const r = applyAction(game, idx, action);
      if (!r.ok) {
        // 兜底：非法动作直接弃牌，避免卡死
        applyAction(game, idx, { type: 'fold' });
      }
      render();
      scheduleAI();
    }, 520);
  }

  /** 全量渲染 */
  function render() {
    renderHead();
    renderBoard();
    renderSeats();
    renderActions();
  }

  // 打开
  root.hidden = false;
  document.body.classList.add('poker-open');
  render();
  scheduleAI();

  return {
    close() {
      root.hidden = true;
      document.body.classList.remove('poker-open');
      box.innerHTML = '';
    },
    refresh: render,
  };
}

/**
 * 摊牌结果弹窗 —— 对局结束后展示各玩家牌型与盈亏。
 */
export function showPokerResult(game, onClose) {
  const root = document.getElementById('poker-root');
  const box = document.getElementById('poker-box');
  if (!root || !box) return;

  box.innerHTML = '';

  const head = document.createElement('div');
  head.className = 'poker-head';
  head.innerHTML = '<h2 class="modal-title">德州扑克 · 摊牌结算</h2>';
  box.appendChild(head);

  const rows = (game.result?.hands || []).map((h) => {
    const payout = (game.result?.payouts || [])
      .filter((p) => p.playerId === h.playerId)
      .reduce((a, p) => a + p.amount, 0);
    const cards = h.hole.map((c) => cardLabel(c)).join('、');
    const rankName = h.name_ || (h.rank != null ? HAND_NAMES[h.rank] : '—');
    return `<tr>
      <td class="pk-name">${h.name}</td>
      <td class="pk-cards">${cards || '—'}</td>
      <td class="pk-rank">${h.folded ? '弃牌' : rankName}</td>
      <td class="pk-bet">￥${h.bet}</td>
      <td class="pk-win ${payout > 0 ? 'is-win' : ''}">${payout > 0 ? '+' : ''}￥${payout}</td>
    </tr>`;
  }).join('');

  const table = document.createElement('table');
  table.className = 'poker-result-table';
  table.innerHTML = `
    <thead><tr><th>玩家</th><th>底牌</th><th>牌型</th><th>下注</th><th>赢得</th></tr></thead>
    <tbody>${rows}</tbody>
  `;
  box.appendChild(table);

  // 公共牌
  const comm = document.createElement('div');
  comm.className = 'poker-board poker-board-result';
  const label = document.createElement('span');
  label.className = 'poker-board-label';
  label.textContent = '公共牌';
  comm.appendChild(label);
  for (const c of game.community || []) {
    const cv = document.createElement('canvas');
    cv.className = 'poker-card';
    cv.width = 22;
    cv.height = 30;
    const cctx = cv.getContext('2d');
    cctx.imageSmoothingEnabled = false;
    cctx.drawImage(getCardFace(c), 0, 0);
    comm.appendChild(cv);
  }
  box.appendChild(comm);

  const actions = document.createElement('div');
  actions.className = 'poker-actions';
  const btn = document.createElement('button');
  btn.className = 'pixel-btn pixel-btn-primary';
  btn.textContent = '返回主游戏';
  btn.addEventListener('click', () => {
    root.hidden = true;
    document.body.classList.remove('poker-open');
    box.innerHTML = '';
    if (onClose) onClose();
  });
  actions.appendChild(btn);
  box.appendChild(actions);
}

/**
 * 关闭德州扑克面板（并恢复 body 状态）。
 */
export function closePokerTable() {
  const root = document.getElementById('poker-root');
  const box = document.getElementById('poker-box');
  if (root) root.hidden = true;
  if (box) box.innerHTML = '';
  document.body.classList.remove('poker-open');
}
