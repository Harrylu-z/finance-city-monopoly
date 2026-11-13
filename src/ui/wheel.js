/**
 * 大转盘弹窗 —— 转盘格的交互主体。
 *
 * ================== 为什么需要它 ==================
 * 原来 16 个功能特殊格把轨道切得太碎。现在它们被合并成 **4 个转盘格**，
 * 踩到格子 → 弹大转盘 → 指针旋转 → 停在某个扇区 → 结算对应效果。
 * 玩家体验反而更强：走过去，命运由转盘决定。
 *
 * ================== 三条关键实现约束（踩过的坑）==================
 *   ① **扇区文字径向摆放**，下半圈翻转 180° —— 否则中文倒置；
 *   ② **指针必须是独立图层**，绝不随转盘旋转（.wheel-pointer 是 SVG 兄弟节点）；
 *   ③ **落点数学必须减去累积角度 current**：
 *        center = pick × slice + slice/2
 *        delta  = ((-center - current) % 360 + 360) % 360
 *        target = current + 360×5 + delta
 *      漏掉 `- current` 会导致连续转动时指针指错扇区。
 *
 * ================== 落点一致性保证 ==================
 * 转盘的**视觉落点**与**结算结果**必须完全一致 —— 否则玩家会认为游戏作弊。
 * 因此本模块用**同一个 pick 索引**驱动两件事：
 *   · 视觉：计算 target 旋转角，让 pick 扇区转到指针正下方；
 *   · 逻辑：把 pick 对应的候选效果 id 回传给规则层。
 * `spinWheel()` 返回的 outcomeId 就是规则层实际结算的那个效果。
 */

import { openModal, closeModal } from '../app/dialogs.js';

/** 转盘配色（与 canvas.js 的 WHEEL_CAT 保持一致） */
const WHEEL_STYLE = {
  hub:   { color: '#2f9fc4', lt: '#63c6e6', dk: '#1c6b88', sign: '流转' },
  risk:  { color: '#c8392b', lt: '#e4604d', dk: '#8d2419', sign: '付出' },
  chance:{ color: '#4f9d55', lt: '#7ac77f', dk: '#336b38', sign: '收益' },
  fate:  { color: '#8b5cc7', lt: '#b189e0', dk: '#5c3a86', sign: '抽取' },
};

/** 转盘总圈数 —— 至少 5 圈，落点才显得「转得久」 */
const SPIN_TURNS = 5;
/** 动画时长（毫秒）—— 与 CSS transition 时长保持一致 */
const SPIN_MS = 3600;

/**
 * 构造转盘 SVG。
 *
 * 扇区文字**径向摆放**（沿半径朝外），处于下半圈时翻转 180°，
 * 保证中文永远正着读。
 */
function wheelSVG(outcomes, style) {
  const cx = 100, cy = 100, r = 96;
  const n = outcomes.length;
  const slice = 360 / n;
  let s = '';

  // 扇区底色（交替深浅）
  for (let i = 0; i < n; i++) {
    const a0 = (i * slice - 90) * Math.PI / 180;
    const a1 = ((i + 1) * slice - 90) * Math.PI / 180;
    const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0);
    const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
    const fill = i % 2 ? style.lt : style.color;
    s += `<path d="M${cx},${cy} L${x0.toFixed(2)},${y0.toFixed(2)}`
      + ` A${r},${r} 0 0 1 ${x1.toFixed(2)},${y1.toFixed(2)} Z" fill="${fill}"/>`;
    // 扇区分隔线
    s += `<line x1="${cx}" y1="${cy}" x2="${x0.toFixed(2)}" y2="${y0.toFixed(2)}"`
      + ` stroke="#fff" stroke-width="1.5" opacity=".45"/>`;
  }

  // 文字层：径向摆放，下半圈翻转 180°
  for (let j = 0; j < n; j++) {
    const mid = ((j + 0.5) * slice - 90) * Math.PI / 180;
    const deg = (j + 0.5) * slice;   // 该扇区中心相对顶部的角度
    const tx = cx + (r * 0.60) * Math.cos(mid);
    const ty = cy + (r * 0.60) * Math.sin(mid);
    let rot = deg;
    if (deg > 90 && deg < 270) rot = deg + 180;   // 下半圈翻转
    s += `<text x="${tx.toFixed(1)}" y="${(ty + 4).toFixed(1)}" text-anchor="middle"`
      + ` font-size="11.5" font-weight="800" fill="#fff"`
      + ` transform="rotate(${rot.toFixed(1)} ${tx.toFixed(1)} ${ty.toFixed(1)})">`
      + `${escapeXml(outcomes[j].name)}</text>`;
    // 数值读数（靠圆心）
    const vx = cx + (r * 0.30) * Math.cos(mid);
    const vy = cy + (r * 0.30) * Math.sin(mid);
    s += `<text x="${vx.toFixed(1)}" y="${(vy + 3.5).toFixed(1)}" text-anchor="middle"`
      + ` font-size="10" font-weight="700" fill="rgba(255,255,255,.85)"`
      + ` transform="rotate(${rot.toFixed(1)} ${vx.toFixed(1)} ${vy.toFixed(1)})">`
      + `${escapeXml(outcomes[j].big)}</text>`;
  }

  // 外圈描边
  s += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#0f172a" stroke-width="3"/>`;
  return s;
}

/** XML 转义 */
function escapeXml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * 计算落点旋转角。
 *
 * 扇区 pick 的中心在 SVG 角度 (-90 + pick×slice + slice/2) 处（0° = 正右，-90° = 正上）。
 * 转盘顺时针转 θ 后落到 (-90 + pick×slice + slice/2 + θ)。
 * 要正对顶部指针（-90°），需 θ ≡ -(pick×slice + slice/2) (mod 360)。
 *
 * ⚠ θ 是**累积**总角度，所以增量必须减去当前累积值 current。
 *
 * @param {number} pick     选中的扇区索引
 * @param {number} n        扇区总数
 * @param {number} current  当前累积旋转角（度）
 * @returns {number} 新的累积旋转角（度）
 */
export function spinTarget(pick, n, current) {
  const slice = 360 / n;
  const center = pick * slice + slice / 2;
  const delta = (((-center - current) % 360) + 360) % 360;
  return current + (360 * SPIN_TURNS) + delta;
}

/**
 * 计算「指针指向的扇区索引」—— 供自检验证落点一致性。
 *
 * @param {number} rotation 累积旋转角（度）
 * @param {number} n        扇区总数
 * @returns {number} 指针正下方所指的扇区索引
 */
export function pointerSector(rotation, n) {
  const slice = 360 / n;
  // 扇区 pick 的中心角度 = pick×slice + slice/2（相对顶部，顺时针）
  // 转过 rotation 后落在 rotation + center（mod 360）；
  // 要与顶部（0°）对齐，需 rotation + center ≡ 0 (mod 360)
  //
  // ⚠ 取模前必须先把结果规约到 [0, n) —— 不能用「+1000000 再 % n」
  //   这种写法，因为 1000000 未必是 n 的整数倍，会把索引整体偏移。
  const norm = ((rotation % 360) + 360) % 360;
  const raw = (-norm / slice) - 0.5;
  const idx = Math.round(raw);
  return ((idx % n) + n) % n;
}

/**
 * 打开大转盘弹窗。
 *
 * @param {object} wheel     转盘定义（board.js 的 WHEELS 元素）
 * @param {object} opts
 * @param {function} opts.onSpin  转动结束回调 —— 接收 {outcomeId, outcome, pick, rotation}
 * @param {function} opts.onClose 关闭回调
 * @param {boolean}  opts.autoSpin 是否自动开转（AI 玩家用）
 */
export function showWheelDialog(wheel, opts = {}) {
  // 候选数据的三种可能来源（按优先级）：
  //   1. outcomeData —— 完整元数据（name / big / lbl / trap）
  //   2. outcomes 是**对象数组** —— WHEELS 的原始形态
  //   3. outcomes 是**纯 id 数组** —— 退化为只有 id
  const raw = wheel.outcomeData && wheel.outcomeData.length
    ? wheel.outcomeData
    : (wheel.outcomes || []);
  const outcomes = raw.map((o) => (
    (o && typeof o === 'object')
      ? o
      : { id: o, name: o, big: '', lbl: '' }
  ));
  const style = WHEEL_STYLE[wheel.cat] || WHEEL_STYLE.fate;

  const body = document.createElement('div');

  // ---- 转盘容器 ----
  const wrap = document.createElement('div');
  wrap.className = 'wheel-wrap';
  wrap.style.cssText = 'width:300px;height:300px;margin:0 auto 14px;position:relative;';

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 200 200');
  svg.setAttribute('class', 'wheel-svg');
  svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;'
    + 'transform:rotate(0deg);transition:transform 3600ms cubic-bezier(.15,.85,.1,1);';
  svg.innerHTML = wheelSVG(outcomes, style);
  wrap.appendChild(svg);

  // ---- 指针（独立图层，绝不随转盘旋转）----
  const pointer = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  pointer.setAttribute('viewBox', '0 0 200 200');
  pointer.setAttribute('aria-hidden', 'true');
  pointer.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;'
    + 'pointer-events:none;filter:drop-shadow(0 2px 3px rgba(15,23,42,.35));';
  pointer.innerHTML = '<polygon points="90,1 110,1 100,21" fill="#0f172a"/>'
    + '<polygon points="94,1 106,1 100,9" fill="#fff" opacity=".25"/>';
  wrap.appendChild(pointer);

  // ---- 中心轴 ----
  const hub = document.createElement('div');
  hub.className = 'wheel-hub';
  hub.style.cssText = 'position:absolute;left:50%;top:50%;width:74px;height:74px;'
    + 'margin:-37px 0 0 -37px;border-radius:50%;background:#fff;border:4px solid #0f172a;'
    + 'color:#0f172a;display:flex;align-items:center;justify-content:center;'
    + 'font-weight:800;font-size:14px;box-shadow:0 3px 12px rgba(15,23,42,.3);';
  hub.textContent = 'SPIN';
  wrap.appendChild(hub);

  body.appendChild(wrap);

  // ---- 结果文字 ----
  const result = document.createElement('div');
  result.className = 'wheel-result';
  result.style.cssText = 'font-size:15px;font-weight:800;color:var(--c-paper);'
    + 'min-height:24px;text-align:center;';
  result.textContent = '点击下方按钮开始转动';
  body.appendChild(result);

  // ---- 说明文字 ----
  const desc = document.createElement('div');
  desc.className = 'wheel-desc';
  desc.style.cssText = 'font-size:12.5px;color:var(--c-dim);line-height:1.7;margin:8px 0 16px;text-align:center;';
  desc.innerHTML = escapeXml(wheel.desc || '') + '<br><span style="opacity:.7">'
    + outcomes.map((o) => `${escapeXml(o.name)}（${escapeXml(o.big)}）`).join(' · ')
    + '</span>';
  body.appendChild(desc);

  // ---- 转动按钮 ----
  const spinBtn = document.createElement('button');
  spinBtn.className = 'pixel-btn pixel-btn-primary';
  spinBtn.style.cssText = 'margin:0 auto 10px;display:block;';
  spinBtn.textContent = '转 盘';
  body.appendChild(spinBtn);

  const modal = openModal({
    title: wheel.label || '命运转盘',
    body,
    dismissible: false,
    actions: [{ text: '关闭', primary: false }],
  });

  // 暴露给自动化测试
  body.dataset.wheelId = wheel.id || '';

  let spinning = false;

  /**
   * 执行一次转动。
   *
   * @param {number} pick 强制指定的扇区（测试用；不传则随机）
   */
  const spin = (pick) => {
    if (spinning) return;
    spinning = true;
    spinBtn.disabled = true;
    hub.textContent = '···';

    const n = outcomes.length;
    const slice = 360 / n;
    const chosen = (pick == null) ? Math.floor(Math.random() * n) : (pick % n + n) % n;
    const current = parseFloat(svg.dataset.rot || '0');
    const target = spinTarget(chosen, n, current);
    svg.dataset.rot = String(target);
    svg.style.transform = `rotate(${target}deg)`;
    result.textContent = '转动中…';

    setTimeout(() => {
      const o = outcomes[chosen];
      result.innerHTML = `抽中：<b style="color:${style.dk}">${escapeXml(o.name)}</b>`
        + (o.trap ? ' <span style="color:#dc2626">⚠ 陷阱</span>' : '')
        + `<div style="font-size:12.5px;color:var(--c-dim);margin-top:6px;font-weight:600">`
        + `${escapeXml(o.big)} · ${escapeXml(o.lbl)}</div>`;
      spinning = false;
      spinBtn.disabled = false;
      hub.textContent = 'SPIN';
      if (opts.onSpin) {
        opts.onSpin({ outcomeId: o.id, outcome: o, pick: chosen, rotation: target });
      }
    }, SPIN_MS);
  };

  spinBtn.addEventListener('click', () => spin());

  // AI 玩家 —— 自动开转
  if (opts.autoSpin) {
    setTimeout(() => spin(), 260);
  }

  // 暴露 spin 以便自动化测试触发
  body._wheelSpin = spin;

  return {
    close: () => { closeModal(); if (opts.onClose) opts.onClose(); },
    spin,
    modal,
  };
}

/**
 * 便捷函数 —— 打开转盘并在转完后回调。
 *
 * @param {object} wheel 转盘定义
 * @param {function} onDone 回调 (outcomeId, outcome)
 */
export function spinWheel(wheel, onDone) {
  return showWheelDialog(wheel, {
    onSpin: (r) => {
      if (onDone) onDone(r.outcomeId, r.outcome);
    },
  });
}
