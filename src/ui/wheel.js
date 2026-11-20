/**
 * 翻牌弹窗 —— 翻牌格（原「转盘格」）的交互主体。
 *
 * ================== 为什么从转盘改成翻牌 ==================
 * 机会翻牌有 **8 个候选效果** —— 挤在圆形转盘上时扇区极窄，
 * 中文与数值读数根本看不清。翻牌模式把候选全部收进**暗牌**：
 *   · 不需要在小扇区里塞文字 —— 牌面翻开后再展示完整元数据；
 *   · 「亲手翻开一张」比看指针停格参与感更强；
 *   · 风险翻牌里 2 张陷阱藏在暗牌里，张力反而更大。
 *
 * ================== 随机性与可复现 ==================
 *   · **洗牌顺序**用对局随机源 `opts.rng`（state.rng）做 Fisher-Yates ——
 *     同 seed 的对局中，暗牌的排列完全一致（不用 Math.random）；
 *   · **人类玩家**自由点选一张暗牌（与其它人类决策一样不进随机流）；
 *   · **AI** 用同一个 rng 随机选一张 —— 保证 AI 行为可复现。
 *   翻开哪张 = 玩家点的那张；牌面是什么由洗牌顺序决定 —— 视觉与结算一致。
 *
 * ================== 与转盘模式的行为对齐 ==================
 *   · 每翻一张 **立即真实结算**（onSpin 回调）—— 与转盘的连续 spin 相同；
 *   · 次数上限 `maxSpins`（默认 3），已翻的牌保持翻开（提供信息张力）；
 *   · AI 触发时只翻一张、只读展示（readonly），随后由 main.js 收尾；
 *   · 「没翻就关窗」由 main.js 的 onClose 兜底随机，回合不会卡死。
 */

import { openModal, closeModal } from '../app/dialogs.js';

/** 翻牌配色（与棋盘格 / tile 纹理的类别色一致） */
const FATE_STYLE = {
  risk:   { color: '#c8392b', lt: '#e4604d', dk: '#8d2419', sign: '付出' },
  chance: { color: '#4f9d55', lt: '#7ac77f', dk: '#336b38', sign: '收益' },
  fate:   { color: '#8b5cc7', lt: '#b189e0', dk: '#5c3a86', sign: '抽取' },
  hub:    { color: '#2f9fc4', lt: '#63c6e6', dk: '#1c6b88', sign: '流转' },
};

/** 翻转动画时长（毫秒）—— 与 CSS transition 保持一致 */
const FLIP_MS = 520;
/** 默认最大连续翻牌次数 —— 与旧转盘的 maxSpins 语义一致 */
export const DEFAULT_MAX_DRAWS = 3;

/** XML 转义 */
function escapeXml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Fisher-Yates 洗牌 —— **必须用对局随机源**（state.rng），
 * 保证同 seed 的暗牌排列完全可复现（分享即复现的承诺）。
 */
export function shuffleCards(items, rng) {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = rng ? rng.int(0, i) : Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * 打开翻牌弹窗。
 *
 * @param {object} wheel     翻牌格定义（board.js 的 WHEELS 元素）
 * @param {object} opts
 * @param {function} opts.onDraw   每次翻开结束回调 —— {outcomeId, outcome, pick, drawIndex}
 *                            （沿用旧 onSpin 的回调字段名，main.js 无需改动）
 * @param {function} opts.onClose  关闭回调（「收手离开」或遮罩关闭）
 * @param {boolean}  opts.autoDraw 是否自动翻一张（AI 玩家用）
 * @param {boolean}  opts.readonly 只读模式（AI 触发时玩家不能翻）
 * @param {number}   opts.maxSpins 最大连续翻牌次数（默认 3 —— 兼容旧参数名）
 * @param {string}   opts.playerName 翻牌者名字（显示用）
 * @param {object}   opts.rng   对局随机源（state.rng）—— **必须**传入
 */
export function showWheelDialog(wheel, opts = {}) {
  // 候选数据的三种可能来源（按优先级）—— 与旧版一致：
  //   1. outcomeData —— 完整元数据（name / big / lbl / trap）
  //   2. outcomes 是对象数组 —— WHEELS 的原始形态
  //   3. outcomes 是纯 id 数组 —— 退化为只有 id
  const raw = wheel.outcomeData && wheel.outcomeData.length
    ? wheel.outcomeData
    : (wheel.outcomes || []);
  const outcomes = raw.map((o) => (
    (o && typeof o === 'object')
      ? o
      : { id: o, name: o, big: '', lbl: '' }
  ));
  const style = FATE_STYLE[wheel.cat] || FATE_STYLE.fate;

  const readonly = !!opts.readonly;
  const maxSpins = opts.maxSpins != null ? opts.maxSpins : DEFAULT_MAX_DRAWS;
  const playerName = opts.playerName || '';

  const body = document.createElement('div');

  // ---- 提示语 ----
  const result = document.createElement('div');
  result.className = 'fate-result';
  result.textContent = readonly
    ? `${playerName || 'AI'} 正在翻牌…`
    : '点击一张暗牌，翻开即结算';
  body.appendChild(result);

  // ---- 卡牌区 ----
  // ⚠ 洗牌顺序由对局随机源决定（可复现）；
  //   翻开哪张由玩家/AI 决定 —— 视觉与结算完全一致。
  const deck = shuffleCards(outcomes, opts.rng || null);

  const row = document.createElement('div');
  row.className = `fate-row is-n${outcomes.length}`;

  /** 已翻次数（对齐旧版 spinIndex 计数） */
  let drawn = 0;
  /** 翻牌锁 —— 从点击到「揭示停留」结束都不可点下一张 */
  let flipping = false;

  /** 揭示停留时长 —— 让玩家看清翻到了什么，再交给结算
   *  （结算可能弹出地铁/事件卡等新弹窗顶掉本窗，停留是唯一的阅读窗口） */
  const REVEAL_HOLD_MS = 850;

  const counter = document.createElement('div');
  counter.className = 'fate-counter';

  const updateCounter = () => {
    const left = Math.max(0, maxSpins - drawn);
    counter.textContent = left > 0
      ? `还可翻 ${left} 张（每翻开一张立即结算）`
      : '次数已用完 —— 点击「收手离开」继续回合';
  };

  // ---- 关闭兜底（与旧版一致：main.js 依据 settled 决定继续或兜底随机）----
  let closed = false;
  const finish = () => {
    if (closed) return;
    closed = true;
    if (opts.onClose) opts.onClose();
  };

  /** 翻开一张暗牌 —— 动画结束后回调结算 */
  const draw = (cardEl) => {
    if (flipping || drawn >= maxSpins) return;
    if (cardEl.dataset.flipped === '1') return;
    flipping = true;
    const pick = Number(cardEl.dataset.pick);
    const o = deck[pick];
    cardEl.dataset.flipped = '1';
    cardEl.classList.add('is-flipped');
    if (o.trap) cardEl.classList.add('is-trap');
    cardEl.querySelector('.fcard-front').innerHTML = `
      <div class="fcard-name">${escapeXml(o.name)}</div>
      <div class="fcard-big">${escapeXml(o.big)}</div>
      <div class="fcard-lbl">${escapeXml(o.lbl)}</div>
      ${o.trap ? '<div class="fcard-trap">⚠ 陷阱</div>' : ''}
    `;
    result.innerHTML = `翻开：<b style="color:${style.dk}">${escapeXml(o.name)}</b>`
      + (o.trap ? ' <span style="color:#dc2626">⚠ 陷阱</span>' : '');

    setTimeout(() => {
      // 揭示停留 —— 之后才结算（结算可能弹新窗顶掉本窗）
      setTimeout(() => {
        flipping = false;
        drawn += 1;
        updateCounter();
        // 次数用完 → 剩余暗牌置灰
        if (drawn >= maxSpins) {
          row.classList.add('is-exhausted');
        }
        if (opts.onDraw) {
          opts.onDraw({
            outcomeId: o.id,
            outcome: o,
            pick,
            drawIndex: drawn,
          });
        }
      }, REVEAL_HOLD_MS);
    }, FLIP_MS);
  };

  // ---- 生成暗牌 ----
  const cardEls = [];
  deck.forEach((o, pos) => {
    const card = document.createElement('div');
    card.className = 'fcard';
    card.dataset.pick = String(pos);
    card.dataset.flipped = '0';
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    card.setAttribute('aria-label', `暗牌 ${pos + 1}`);
    card.innerHTML = `
      <div class="fcard-inner">
        <div class="fcard-face fcard-back" style="
          background:linear-gradient(160deg, ${style.color}, ${style.dk});
        ">
          <div class="fcard-sign">${escapeXml(style.sign)}</div>
          <div class="fcard-q">?</div>
        </div>
        <div class="fcard-face fcard-front" style="
          background:linear-gradient(160deg, #fff, ${style.lt}55);
          border-color:${style.dk};
        "></div>
      </div>
    `;
    const activate = () => {
      if (readonly) return;
      draw(card);
    };
    card.addEventListener('click', activate);
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); }
    });
    row.appendChild(card);
    cardEls.push(card);
  });
  body.appendChild(row);
  updateCounter();
  body.appendChild(counter);

  // ---- 只读提示（AI 触发）----
  if (readonly) {
    const note = document.createElement('div');
    note.className = 'fate-readonly';
    note.textContent = playerName
      ? `${playerName} 正在翻牌 —— 你只能观看，无法操作`
      : 'AI 正在翻牌 —— 你只能观看，无法操作';
    body.appendChild(note);
  }

  // ---- 池底说明（所有候选一览 —— 补足"暗牌看不到内容"的信息量）----
  const desc = document.createElement('div');
  desc.className = 'fate-desc';
  desc.innerHTML = escapeXml(wheel.desc || '') + '<br><span style="opacity:.7">'
    + '本池候选：' + outcomes.map((o) => `${escapeXml(o.name)}（${escapeXml(o.big)}）`).join(' · ')
    + '</span>';
  body.appendChild(desc);

  // ---- 收手按钮 ----
  const stopBtn = document.createElement('button');
  stopBtn.className = 'pixel-btn pixel-btn-primary';
  stopBtn.style.cssText = 'margin:0 auto;display:block;';
  stopBtn.textContent = readonly ? '关闭' : '收手离开';
  body.appendChild(stopBtn);

  const modal = openModal({
    title: wheel.label || '命运翻牌',
    body,
    // 只读（AI）模式不可点遮罩关闭；翻牌动画期间同样禁止关闭
    get dismissible() { return !readonly && !flipping; },
    onClose: finish,
    actions: [{
      text: stopBtn.textContent,
      primary: !readonly,
      onClick: finish,
    }],
  });
  // ⚠ body 内的收手按钮必须**自己关窗** —— openModal 的「actions 按钮 →
  //   自动 closeModal」流程只覆盖 actions 区的按钮，body 里的按钮点了
  //   只触发 finish，弹窗会留在屏幕上（旧转盘没有 body 内按钮，没踩过这个坑）。
  stopBtn.addEventListener('click', () => {
    closeModal();
    finish();
  });

  // 暴露给自动化测试
  body.dataset.wheelId = wheel.id || '';
  body.dataset.wheelReadonly = readonly ? '1' : '0';
  body._cardEls = cardEls;
  body._draw = draw;

  // ---- AI 自动翻一张（随机选位，rng 保证可复现）----
  if (opts.autoDraw) {
    setTimeout(() => {
      if (closed) return;
      const rng = opts.rng || null;
      const pick = rng ? rng.int(0, deck.length - 1) : Math.floor(Math.random() * deck.length);
      draw(cardEls[pick]);
    }, 300);
  }

  return {
    close: () => { closeModal(); if (opts.onClose) opts.onClose(); },
    modal,
    /** 当前已翻次数（自动化测试用） */
    get drawCount() { return drawn; },
  };
}
