/**
 * 弹窗系统 —— 像素风硬描边、九宫格边框。
 */

import { PALETTE, PLAYER_COLORS } from '../core/palette.js';
import { getInstitutionSprite } from '../art/buildings.js';
import { getAvatarSprites } from '../art/avatars.js';
import {
  calculateRent, upgradeCost, mortgageValue, redeemFee, levelLabel,
  groupBuffTier, globalRegulatorEffects, CONFIG, allGroupBuffs,
  financialMetrics,
} from '../core/economy.js';
import { GROUP_META, REGULATORS } from '../core/board.js';

const GROUP_INDEX = { bank: 0, broker: 1, insurer: 2, asset: 3 };

/** 打开弹窗 */
export function openModal(opts) {
  const root = document.getElementById('modal-root');
  const box = document.getElementById('modal-box');
  box.innerHTML = '';

  const inner = document.createElement('div');
  inner.className = 'modal-inner';

  if (opts.title) {
    const t = document.createElement('h2');
    t.className = 'modal-title';
    t.textContent = opts.title;
    inner.appendChild(t);
  }

  if (opts.body) {
    if (typeof opts.body === 'string') {
      const p = document.createElement('div');
      p.className = 'modal-text';
      p.innerHTML = opts.body;
      inner.appendChild(p);
    } else {
      inner.appendChild(opts.body);
    }
  }

  box.appendChild(inner);

  if (opts.actions && opts.actions.length) {
    const actions = document.createElement('div');
    actions.className = 'modal-actions';
    // 暴露原始动作回调，供自动化（无头/合成事件被吞的环境）直接触发业务逻辑
    box._modalActions = opts.actions;
    opts.actions.forEach((a, actionIndex) => {
      const btn = document.createElement('button');
      btn.className = 'pixel-btn' + (a.primary ? ' pixel-btn-primary' : '');
      btn.textContent = a.text;
      // 暴露动作索引，便于自动化 / 无障碍工具直接触发对应动作
      btn.dataset.actionIndex = String(actionIndex);
      btn.addEventListener('click', () => {
        if (a.onClick) {
          const keep = a.onClick();
          if (keep === false) return;
        }
        closeModal();
      });
      actions.appendChild(btn);
    });
    box.appendChild(actions);
  }

  root.hidden = false;

  const backdrop = document.getElementById('modal-backdrop');
  backdrop.onclick = () => {
    if (opts.dismissible !== false) {
      closeModal();
      if (opts.onClose) opts.onClose();
    }
  };

  const firstBtn = box.querySelector('.pixel-btn');
  if (firstBtn) firstBtn.focus();

  return { close: closeModal, box };
}

export function closeModal() {
  const root = document.getElementById('modal-root');
  root.hidden = true;
  const box = document.getElementById('modal-box');
  box.innerHTML = '';
  box._modalActions = null;
}

/** 收购确认弹窗 */
export function showPurchaseDialog(cell, price, level, player, onAccept, onDecline) {
  const body = document.createElement('div');

  const thumb = getInstitutionSprite(cell, level, PLAYER_COLORS[player.colorIndex % PLAYER_COLORS.length].main, GROUP_INDEX[cell.group] ?? 0);
  const img = document.createElement('canvas');
  img.className = 'modal-thumb';
  const k = 3;
  img.width = thumb.width * k;
  img.height = thumb.height * k;
  img.style.width = img.width + 'px';
  img.style.height = img.height + 'px';
  const ictx = img.getContext('2d');
  ictx.imageSmoothingEnabled = false;
  ictx.drawImage(thumb, 0, 0, img.width, img.height);
  body.appendChild(img);

  const text = document.createElement('div');
  text.className = 'modal-text';
  const group = GROUP_META[cell.group];
  const rent = calculateRent(cell, level, { market: 'normal', eventMult: 1 });
  text.innerHTML = `
    是否以 <span class="hl">￥${price}</span> 收购
    <span class="hl">${cell.name}</span>（${group.name} · ${levelLabel(level)}）<br>
    <span style="color:${PALETTE.glass}">战略入股 30% 股权，获取该机构经营权</span><br>
    当前基础管理费：<span class="hl-green">￥${rent}</span> / 次
  `;
  body.appendChild(text);

  const note = document.createElement('div');
  note.className = 'modal-note';
  note.textContent = `交易完成后你将持有该机构的经营权，其他玩家路过时需向你支付管理费。${player.cash < price ? '注意：当前现金不足。' : ''}`;
  body.appendChild(note);

  return openModal({
    title: '股权收购要约',
    body,
    dismissible: false,
    actions: [
      { text: '放弃收购', onClick: onDecline },
      { text: `确认收购 ￥${price}`, primary: true, onClick: onAccept },
    ],
  });
}

/** 机构管理弹窗 */
export function showInstitutionDialog(player, state, onUpgrade, onMortgage, onRedeem) {
  const body = document.createElement('div');

  if (!player.institutions.length) {
    const t = document.createElement('div');
    t.className = 'modal-text';
    t.textContent = '你还没有控股任何金融机构。走到无主机构上才能发起收购。';
    body.appendChild(t);
    return openModal({ title: '我的机构', body, actions: [{ text: '关闭', primary: true }] });
  }

  const list = document.createElement('div');
  list.className = 'inst-list';

  for (const inst of player.institutions) {
    const cell = state.board[inst.cellIndex];
    const item = document.createElement('div');
    item.className = 'inst-item';

    const thumb = getInstitutionSprite(cell, inst.level, PLAYER_COLORS[player.colorIndex % PLAYER_COLORS.length].main, GROUP_INDEX[cell.group] ?? 0);
    const cv = document.createElement('canvas');
    const k = 2;
    cv.width = thumb.width * k;
    cv.height = thumb.height * k;
    cv.style.width = cv.width + 'px';
    cv.style.height = cv.height + 'px';
    const cctx = cv.getContext('2d');
    cctx.imageSmoothingEnabled = false;
    cctx.drawImage(thumb, 0, 0, cv.width, cv.height);
    item.appendChild(cv);

    const info = document.createElement('div');
    info.className = 'inst-info';
    const nameRow = document.createElement('div');
    nameRow.className = 'inst-name';
    nameRow.textContent = cell.name;
    const lv = document.createElement('span');
    lv.className = 'inst-lv';
    lv.textContent = levelLabel(inst.level);
    lv.style.background = PALETTE.gold;
    nameRow.appendChild(lv);
    if (inst.mortgaged) {
      const mg = document.createElement('span');
      mg.className = 'inst-lv';
      mg.textContent = '已质押';
      mg.style.background = PALETTE.glass;
      nameRow.appendChild(mg);
    }
    info.appendChild(nameRow);

    const meta = document.createElement('div');
    meta.className = 'inst-meta';
    const rent = calculateRent(cell, inst.level, {
      market: state.market, eventMult: state.eventMult,
      buffMult: groupBuffTier(player, cell.group).mult,
    });
    const regEff = globalRegulatorEffects(state);
    const upCost = upgradeCost(cell, inst.level, { regulatorCostMult: regEff.upgradeCostMult });
    if (cell.regulator) {
      meta.textContent = `监管机构 · 不可升级 · ${cell.code}`;
    } else {
      const buff = groupBuffTier(player, cell.group);
      const buffTxt = buff.tier > 0 ? ` · ${buff.name}×${buff.mult.toFixed(2)}` : '';
      meta.textContent = inst.mortgaged
        ? `管理费 ￥${rent} · 质押额 ￥${inst.mortgageAmount}`
        : `管理费 ￥${rent}${buffTxt} · 升级需 ￥${isFinite(upCost) ? upCost : '已满级'}`;
    }
    info.appendChild(meta);
    item.appendChild(info);

    const btns = document.createElement('div');
    btns.className = 'inst-btns';

    if (cell.regulator) {
      // 监管机构不可升级，也不可质押（牌照资产）
      const tag = document.createElement('span');
      tag.className = 'inst-lv';
      tag.textContent = '监管牌照';
      tag.style.background = PALETTE.purple;
      btns.appendChild(tag);
    } else if (!inst.mortgaged) {
      const hasPermit = !!(player.upgradePermits && player.upgradePermits[inst.cellIndex]);
      if (isFinite(upCost) && upCost <= player.cash) {
        const b = document.createElement('button');
        b.className = 'pixel-btn pixel-btn-xs pixel-btn-primary';
        b.textContent = `升级 ￥${upCost}`;
        b.disabled = !hasPermit;
        b.title = hasPermit ? '' : '需再次踏足该机构才能升级';
        if (!hasPermit) b.textContent = '需再次踏足';
        b.addEventListener('click', (e) => {
          e.stopPropagation();
          onUpgrade(inst.cellIndex);
        });
        btns.appendChild(b);
      } else if (!hasPermit && isFinite(upCost)) {
        const b = document.createElement('button');
        b.className = 'pixel-btn pixel-btn-xs';
        b.textContent = '需再次踏足';
        b.disabled = true;
        b.title = '只有再次踩到该机构才能升级';
        btns.appendChild(b);
      }
      const mv = mortgageValue(cell, inst.level);
      const bm = document.createElement('button');
      bm.className = 'pixel-btn pixel-btn-xs';
      bm.textContent = `质押 ￥${mv}`;
      bm.addEventListener('click', (e) => {
        e.stopPropagation();
        onMortgage(inst.cellIndex);
      });
      btns.appendChild(bm);
    } else {
      const fee = redeemFee(inst.mortgageAmount);
      const br = document.createElement('button');
      br.className = 'pixel-btn pixel-btn-xs';
      br.textContent = `赎回 ￥${fee}`;
      br.disabled = player.cash < fee;
      br.addEventListener('click', (e) => {
        e.stopPropagation();
        onRedeem(inst.cellIndex);
      });
      btns.appendChild(br);
    }

    item.appendChild(btns);
    list.appendChild(item);
  }

  body.appendChild(list);
  return openModal({ title: '我的机构 · 经营与扩表', body, actions: [{ text: '关闭', primary: true }] });
}

/** 地铁枢纽选择 */
export function showMetroDialog(onChoose) {
  const body = document.createElement('div');
  const t = document.createElement('div');
  t.className = 'modal-text';
  t.innerHTML = '你已抵达 <span class="hl">地铁通勤枢纽</span>。<br>可换乘线路，额外前进 <span class="hl">1 / 2 / 3</span> 格。';
  body.appendChild(t);

  const grid = document.createElement('div');
  grid.className = 'modal-grid';
  for (const s of [1, 2, 3]) {
    const b = document.createElement('button');
    b.className = 'pixel-btn';
    b.style.padding = '16px 0';
    b.textContent = `前进 ${s} 格`;
    b.addEventListener('click', () => onChoose(s));
    grid.appendChild(b);
  }
  body.appendChild(grid);

  return openModal({ title: '地铁 · 通勤枢纽', body, dismissible: false, actions: [] });
}

/** 事件卡弹窗 */
export function showEventCardDialog(card, effect, onClose) {
  const body = document.createElement('div');

  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;justify-content:center;margin-bottom:12px;';
  const cv = document.createElement('canvas');
  cv.width = 96;
  cv.height = 128;
  cv.style.cssText = 'width:96px;height:128px;image-rendering:pixelated;animation:cardFlipIn 600ms steps(8,end);';
  const cctx = cv.getContext('2d');
  cctx.imageSmoothingEnabled = false;
  drawEventCardFace(cctx, card, 96, 128);
  wrap.appendChild(cv);
  body.appendChild(wrap);

  const t = document.createElement('div');
  t.className = 'modal-text';
  t.innerHTML = `
    <span class="hl">${card.title}</span><br>
    ${card.text}<br><br>
    ${effect.cash ? (effect.cash > 0
      ? `现金 <span class="hl-green">+￥${effect.cash}</span>`
      : `现金 <span class="hl-red">￥${effect.cash}</span>`) : ''}
    ${effect.rentMult ? `<br>全市场管理费系数调整为 <span class="hl">×${effect.rentMult}</span>` : ''}
  `;
  body.appendChild(t);

  return openModal({
    title: '财经快讯',
    body,
    dismissible: false,
    actions: [{ text: '知道了', primary: true, onClick: onClose }],
  });
}

/** 事件卡正面 */
function drawEventCardFace(ctx, card, W, H) {
  ctx.fillStyle = PALETTE.navy;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = PALETTE.gold;
  ctx.fillRect(0, 0, W, 4);
  ctx.fillRect(0, H - 4, W, 4);
  ctx.fillRect(0, 0, 4, H);
  ctx.fillRect(W - 4, 0, 4, H);
  ctx.fillStyle = PALETTE.ink;
  ctx.fillRect(4, 4, W - 8, 2);
  ctx.fillRect(4, H - 6, W - 8, 2);

  ctx.fillStyle = PALETTE.red;
  ctx.fillRect(10, 14, W - 20, 14);
  ctx.fillStyle = PALETTE.paper;
  ctx.font = 'bold 11px "Microsoft YaHei", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('华尔街日报', W / 2, 25);

  ctx.fillStyle = PALETTE.gold;
  ctx.font = 'bold 13px "Microsoft YaHei", sans-serif';
  ctx.fillText(card.title, W / 2, 48);

  ctx.fillStyle = PALETTE.glassDk;
  ctx.fillRect(12, 56, W - 24, 1);

  ctx.fillStyle = PALETTE.glass;
  for (let i = 0; i < 7; i++) {
    const w = 30 + ((i * 13) % 44);
    ctx.fillRect(12, 64 + i * 7, w, 2);
  }

  ctx.fillStyle = PALETTE.red;
  ctx.fillRect(W - 34, H - 40, 22, 22);
  ctx.fillStyle = PALETTE.redDk;
  ctx.fillRect(W - 31, H - 37, 16, 16);
  ctx.fillStyle = PALETTE.red;
  ctx.fillRect(W - 29, H - 35, 12, 12);
  ctx.textAlign = 'left';
}

/** 破产结算面板 */
export function showBankruptcyDialog(player, settlement, actions, onClose) {
  const body = document.createElement('div');

  const banner = document.createElement('div');
  banner.className = 'winner-banner';
  banner.style.color = PALETTE.redLt;
  banner.textContent = '强制平仓 · 摘牌退市';
  body.appendChild(banner);

  const t = document.createElement('div');
  t.className = 'modal-text';
  t.innerHTML = `
    <span class="hl-red">${player.name}</span> 资不抵债，已触发爆仓清算。<br>
    清算回收：<span class="hl">￥${settlement}</span><br>
    机构股权全部强制质押并计为坏账。
  `;
  body.appendChild(t);

  const list = document.createElement('div');
  list.className = 'inst-list';
  for (const a of actions) {
    const row = document.createElement('div');
    row.className = 'inst-item';
    row.style.background = 'rgba(200,57,43,.12)';
    const txt = document.createElement('div');
    txt.className = 'inst-meta';
    txt.style.color = PALETTE.paper;
    txt.textContent = a;
    row.appendChild(txt);
    list.appendChild(row);
  }
  body.appendChild(list);

  return openModal({
    title: '破产清算结算',
    body,
    dismissible: false,
    actions: [{ text: '继续', primary: true, onClick: onClose }],
  });
}

/** 胜利画面 */
export function showGameOverDialog(state, ranked, playerIsWinner, onShare, onRestart) {
  const body = document.createElement('div');

  const banner = document.createElement('div');
  banner.className = 'winner-banner';
  const champ = ranked[0] ? ranked[0].player : null;
  banner.textContent = playerIsWinner
    ? '金融霸主 · 登顶！'
    : (champ ? `${champ.name} 夺得金融城！` : '金融城归属已定！');
  body.appendChild(banner);

  const list = document.createElement('div');
  list.className = 'inst-list';

  ranked.forEach((entry, i) => {
    const p = entry.p;
    const pc = PLAYER_COLORS[p.colorIndex % PLAYER_COLORS.length];
    const row = document.createElement('div');
    row.className = 'inst-item';
    row.style.borderLeft = `4px solid ${pc.main}`;

    const sprites = getAvatarSprites(p.avatar, p.colorIndex);
    const cv = document.createElement('canvas');
    cv.width = 32;
    cv.height = 48;
    cv.style.cssText = 'width:16px;height:24px;image-rendering:pixelated;';
    const cctx = cv.getContext('2d');
    cctx.imageSmoothingEnabled = false;
    cctx.drawImage(sprites.idle, 0, 0, 32, 48);
    row.appendChild(cv);

    const info = document.createElement('div');
    info.className = 'inst-info';
    const nameRow = document.createElement('div');
    nameRow.className = 'inst-name';
    nameRow.textContent = `#${i + 1} ${p.name}`;
    if (p.personality) {
      const tag = document.createElement('span');
      tag.className = 'inst-lv';
      tag.textContent = p.personality.tag;
      tag.style.background = pc.main;
      nameRow.appendChild(tag);
    }
    info.appendChild(nameRow);
    const meta = document.createElement('div');
    meta.className = 'inst-meta';
    meta.textContent = p.bankrupt
      ? `控股 ${p.institutions.length} 家 · 已爆仓清算`
      : `控股 ${p.institutions.length} 家 · 现金 ￥${Math.max(0, p.cash)}`;
    info.appendChild(meta);
    row.appendChild(info);

    const val = document.createElement('span');
    val.className = 'rank-val';
    val.style.fontSize = '13px';
    val.textContent = `￥${Math.max(0, entry.assets)}`;
    row.appendChild(val);

    list.appendChild(row);
  });

  body.appendChild(list);

  const note = document.createElement('div');
  note.className = 'modal-note';
  note.textContent = `共进行 ${state.round} 圈 / ${state.turnNumber} 回合。最终市场周期：${state.market === 'bull' ? '牛市' : state.market === 'bear' ? '熊市' : '震荡'}。`;
  body.appendChild(note);

  return openModal({
    title: '最终结算',
    body,
    dismissible: false,
    actions: [
      { text: '再开一局', onClick: onRestart },
      { text: '分享战绩', primary: true, onClick: onShare },
    ],
  });
}

/** 通用菜单 */
export function showMenuDialog(items) {
  const body = document.createElement('div');
  body.className = 'menu-list';
  for (const it of items) {
    const b = document.createElement('button');
    b.className = 'pixel-btn' + (it.primary ? ' pixel-btn-primary' : '');
    b.textContent = it.text;
    b.addEventListener('click', () => {
      closeModal();
      if (it.onClick) it.onClick();
    });
    body.appendChild(b);
  }
  return openModal({ title: '菜单', body, actions: [] });
}

/* ===================================================================
 * 新增机制弹窗 —— 央行贷款 / 债券发行 / 监管陷阱 / Buff 总览
 * =================================================================== */

/** 央行贷款选择弹窗 —— 可选利率与额度 */
export function showLoanDialog(player, tiers, onPick, onCancel) {
  const body = document.createElement('div');

  const intro = document.createElement('div');
  intro.className = 'modal-text';
  intro.innerHTML = `
    走过起点 <span class="hl">陆家嘴金融中心</span>，你获得了向中央银行申请流动性支持的机会。<br>
    贷款用于<span class="hl">经营性周转</span>（收购地标级机构等），<span class="hl-red">到期需连本带息一次性偿还</span>。<br>
    <span class="dim">与「股权质押」不同：质押是把资产变现，贷款是负债且不影响资产权属。</span>
  `;
  body.appendChild(intro);

  const cash = document.createElement('div');
  cash.className = 'modal-text';
  cash.style.marginBottom = '10px';
  cash.innerHTML = `当前现金 <span class="hl">￥${player.cash}</span>`;
  body.appendChild(cash);

  const grid = document.createElement('div');
  grid.className = 'modal-grid';

  for (const t of tiers) {
    const card = document.createElement('button');
    card.className = 'loan-card';
    card.innerHTML = `
      <div class="loan-name">${t.name}</div>
      <div class="loan-amt">￥${t.amount}</div>
      <div class="loan-rate">年化 ${Math.round(t.rate * 100)}%</div>
      <div class="loan-repay">到期需还 ￥${Math.round(t.amount * (1 + t.rate))}</div>
      <div class="loan-desc">${t.desc}</div>
    `;
    card.addEventListener('click', () => {
      closeModal();
      onPick(t.id);
    });
    grid.appendChild(card);
  }
  body.appendChild(grid);

  const note = document.createElement('div');
  note.className = 'modal-text dim';
  note.style.marginTop = '10px';
  note.textContent = '每圈最多申请一次；贷款在下一圈结束时自动从现金扣除，未足额还款将触发强制平仓。';
  body.appendChild(note);

  return openModal({
    title: '央行贷款 · 流动性支持',
    body,
    actions: [{ text: '暂不借款', onClick: onCancel }],
  });
}

/** 债券发行弹窗 —— 向其他玩家募集，需 ≥2 人认购 */
export function showBondDialog(issuer, state, onConfirm, onCancel) {
  const body = document.createElement('div');

  const others = state.players.filter((p) => p.id !== issuer.id && !p.bankrupt);
  const min = CONFIG.bondMinSubscribers;

  const intro = document.createElement('div');
  intro.className = 'modal-text';
  intro.innerHTML = `
    你抵达了 <span class="hl">再融资窗口</span>，可以向其他玩家发行公司债券。<br>
    每份面值 <span class="hl">￥${CONFIG.bondFace}</span>，票息 <span class="hl">${Math.round(CONFIG.bondCoupon * 100)}%</span>，
    期限 <span class="hl">${CONFIG.bondTerm} 圈</span>。<br>
    <span class="hl-red">需至少 ${min} 人认购，发行方才能成立。</span>
  `;
  body.appendChild(intro);

  const list = document.createElement('div');
  list.className = 'inst-list';

  const decisions = [];

  for (const p of others) {
    const item = document.createElement('div');
    item.className = 'inst-item';

    const sprites = getAvatarSprites(p.avatar, p.colorIndex);
    const av = document.createElement('canvas');
    const k = 2;
    av.width = sprites.down[0].width * k;
    av.height = sprites.down[0].height * k;
    av.style.width = av.width + 'px';
    av.style.height = av.height + 'px';
    const actx = av.getContext('2d');
    actx.imageSmoothingEnabled = false;
    actx.drawImage(sprites.down[0], 0, 0, av.width, av.height);
    item.appendChild(av);

    const info = document.createElement('div');
    info.className = 'inst-info';
    const nameRow = document.createElement('div');
    nameRow.className = 'inst-name';
    nameRow.textContent = p.name;
    const cashTag = document.createElement('span');
    cashTag.className = 'inst-lv';
    cashTag.textContent = `现金 ￥${p.cash}`;
    cashTag.style.background = PALETTE.glass;
    nameRow.appendChild(cashTag);
    info.appendChild(nameRow);

    const meta = document.createElement('div');
    meta.className = 'inst-meta';
    meta.textContent = p.personality ? `${p.personality.tag} · ${p.personality.desc}` : '其他玩家';
    info.appendChild(meta);
    item.appendChild(info);

    const btns = document.createElement('div');
    btns.className = 'inst-btns';

    const yes = document.createElement('button');
    yes.className = 'pixel-btn pixel-btn-xs pixel-btn-primary';
    yes.textContent = '认购';
    const no = document.createElement('button');
    no.className = 'pixel-btn pixel-btn-xs';
    no.textContent = '拒绝';
    const dec = { playerId: p.id, subscribed: false };

    yes.addEventListener('click', (e) => {
      e.stopPropagation();
      dec.subscribed = true;
      yes.classList.add('pixel-btn-primary');
      no.classList.remove('pixel-btn-primary');
    });
    no.addEventListener('click', (e) => {
      e.stopPropagation();
      dec.subscribed = false;
      no.classList.add('pixel-btn-primary');
      yes.classList.remove('pixel-btn-primary');
    });
    btns.appendChild(yes);
    btns.appendChild(no);
    item.appendChild(btns);

    decisions.push(dec);
    list.appendChild(item);
  }

  if (!others.length) {
    const t = document.createElement('div');
    t.className = 'modal-text';
    t.textContent = '当前没有其他玩家可以认购，债券无法发行。';
    body.appendChild(t);
  }

  body.appendChild(list);

  const status = document.createElement('div');
  status.className = 'modal-text dim';
  status.style.marginTop = '10px';
  const upd = () => {
    const n = decisions.filter((d) => d.subscribed).length;
    status.innerHTML = `当前认购 <span class="hl">${n}</span> 人，门槛 <span class="hl">${min}</span> 人`
      + (n >= min ? ' —— <span class="hl">可以成立</span>' : ' —— <span class="hl-red">不足</span>');
  };
  upd();
  body.appendChild(status);

  // 订阅变化时更新计数
  const obs = new MutationObserver(upd);
  obs.observe(list, { subtree: true, attributes: true, attributeFilter: ['class'] });

  return openModal({
    title: '债券发行 · 市场化融资',
    body,
    actions: [
      { text: '放弃发行', onClick: onCancel },
      {
        text: '确认发行',
        primary: true,
        onClick: () => {
          closeModal();
          onConfirm(decisions.map((d) => ({ ...d })));
        },
      },
    ],
  });
}

/** 监管陷阱弹窗 —— 展示抽到的监管/风险事件 */
export function showTrapDialog(card, result, onClose) {
  const body = document.createElement('div');

  const banner = document.createElement('div');
  banner.className = 'winner-banner';
  banner.style.color = PALETTE.redLt;
  banner.textContent = '监管风险事件';
  body.appendChild(banner);

  const t = document.createElement('div');
  t.className = 'modal-text';
  t.innerHTML = `<div class="hl-red">${card.title}</div><br>${card.text}`;
  body.appendChild(t);

  if (result && result.cash) {
    const c = document.createElement('div');
    c.className = 'modal-text';
    c.innerHTML = `处罚金额 <span class="hl-red">￥${Math.abs(result.cash)}</span>`
      + (result.relief > 0 ? ' <span class="dim">（金稳会已减免部分罚金）</span>' : '');
    body.appendChild(c);
  }

  return openModal({ title: '监管抽查 · 穿透检查', body, actions: [{ text: '知道了', primary: true, onClick: onClose }] });
}

/** Buff 与监管效果总览面板 */
export function showBuffPanel(player, state) {
  const body = document.createElement('div');

  const buffs = allGroupBuffs(player);
  const sec1 = document.createElement('div');
  sec1.className = 'modal-text';
  sec1.innerHTML = '<span class="hl">集团协同 Buff</span>（持有同类机构数量达阈值触发）';
  body.appendChild(sec1);

  const list = document.createElement('div');
  list.className = 'inst-list';
  for (const [g, b] of Object.entries(buffs)) {
    const item = document.createElement('div');
    item.className = 'inst-item';
    const info = document.createElement('div');
    info.className = 'inst-info';
    const nm = document.createElement('div');
    nm.className = 'inst-name';
    nm.textContent = GROUP_META[g].name;
    const tg = document.createElement('span');
    tg.className = 'inst-lv';
    tg.textContent = b.tier > 0 ? b.name : '未激活';
    tg.style.background = b.tier > 0 ? PALETTE.gold : PALETTE.glass;
    nm.appendChild(tg);
    info.appendChild(nm);
    const meta = document.createElement('div');
    meta.className = 'inst-meta';
    meta.textContent = `持有 ${b.count} 家 · 租金系数 ×${b.mult.toFixed(2)}`
      + (b.tier > 0 ? ` · 下档 ${CONFIG.groupBuffThresholds[b.tier] || '—'} 家` : ` · ${CONFIG.groupBuffThresholds[0]} 家激活`);
    info.appendChild(meta);
    item.appendChild(info);
    list.appendChild(item);
  }
  body.appendChild(list);

  const sec2 = document.createElement('div');
  sec2.className = 'modal-text';
  sec2.innerHTML = '<span class="hl">监管牌照</span>（持有即全局生效，不可升级）';
  body.appendChild(sec2);

  const owned = player.institutions.filter((i) => state.board[i.cellIndex] && state.board[i.cellIndex].regulator);
  if (!owned.length) {
    const t = document.createElement('div');
    t.className = 'modal-text dim';
    t.textContent = '你尚未持有任何监管机构。人民银行 / 证监会 / 金融监管总局 / 金稳会 均为可收购的牌照资产。';
    body.appendChild(t);
  } else {
    const rlist = document.createElement('div');
    rlist.className = 'inst-list';
    for (const inst of owned) {
      const cell = state.board[inst.cellIndex];
      const reg = REGULATORS[cell.regulatorId];
      const item = document.createElement('div');
      item.className = 'inst-item';
      const info = document.createElement('div');
      info.className = 'inst-info';
      const nm = document.createElement('div');
      nm.className = 'inst-name';
      nm.textContent = cell.name;
      const tg = document.createElement('span');
      tg.className = 'inst-lv';
      tg.textContent = reg.effectName;
      tg.style.background = PALETTE.purple;
      nm.appendChild(tg);
      info.appendChild(nm);
      const meta = document.createElement('div');
      meta.className = 'inst-meta';
      meta.textContent = reg.effect;
      info.appendChild(meta);
      item.appendChild(info);
      rlist.appendChild(item);
    }
    body.appendChild(rlist);
  }

  // 融资状况
  const loanTotal = outstandingLoan(player);
  const sec3 = document.createElement('div');
  sec3.className = 'modal-text';
  sec3.innerHTML = '<span class="hl">融资状况</span>';
  body.appendChild(sec3);
  const fin = document.createElement('div');
  fin.className = 'modal-text dim';
  fin.innerHTML = `
    现金 <span class="hl">￥${player.cash}</span> ·
    未偿贷款 <span class="${loanTotal > 0 ? 'hl-red' : 'hl'}">￥${loanTotal}</span> ·
    发行中债券 <span class="hl">${(player.bonds || []).length} 笔</span> ·
    持有债券 <span class="hl">${(player.subscribedBonds || []).length} 笔</span>
  `;
  body.appendChild(fin);

  return openModal({ title: 'Buff · 监管 · 融资总览', body, actions: [{ text: '关闭', primary: true }] });
}

/* ===================================================================
 * 资产排行下钻 —— 单个玩家财务指标
 * =================================================================== */

/** 指标行的小工具：构造一个「标签 / 数值」两栏 */
function metricRow(label, value, tone = '') {
  const row = document.createElement('div');
  row.className = 'fin-row';
  const l = document.createElement('span');
  l.className = 'fin-label';
  l.textContent = label;
  const v = document.createElement('span');
  v.className = 'fin-value' + (tone ? ' ' + tone : '');
  v.textContent = value;
  row.appendChild(l);
  row.appendChild(v);
  return row;
}

/** 指标分组小标题 */
function metricSection(title) {
  const s = document.createElement('div');
  s.className = 'fin-section';
  s.textContent = title;
  return s;
}

/**
 * 玩家财务指标下钻窗口 —— 从「资产排行」点击某一行打开。
 *
 * @param {object} state  当前对局状态
 * @param {object} player 目标玩家（可为 AI）
 * @param {object} opts   { rank } —— 该玩家当前名次（可选）
 */
export function showPlayerDetailDialog(state, player, opts = {}) {
  const m = financialMetrics(player, state);
  const pc = PLAYER_COLORS[player.colorIndex % PLAYER_COLORS.length];
  const body = document.createElement('div');

  // ===== 顶部：头像 + 名称 + 名次 =====
  const head = document.createElement('div');
  head.className = 'fin-head';
  head.style.borderLeftColor = pc.main;

  const sprites = getAvatarSprites(player.avatar, player.colorIndex);
  const cv = document.createElement('canvas');
  cv.width = 32;
  cv.height = 48;
  cv.style.cssText = 'width:32px;height:48px;image-rendering:pixelated;flex:none;';
  const cctx = cv.getContext('2d');
  cctx.imageSmoothingEnabled = false;
  cctx.drawImage(sprites.idle, 0, 0, 32, 48);
  head.appendChild(cv);

  const headInfo = document.createElement('div');
  headInfo.className = 'fin-head-info';
  const nameRow = document.createElement('div');
  nameRow.className = 'fin-head-name';
  nameRow.textContent = player.name;
  if (opts.rank) {
    const rk = document.createElement('span');
    rk.className = 'inst-lv';
    rk.textContent = `第 ${opts.rank} 名`;
    rk.style.background = PALETTE.gold;
    nameRow.appendChild(rk);
  }
  if (player.personality) {
    const pt = document.createElement('span');
    pt.className = 'inst-lv';
    pt.textContent = player.personality.tag;
    pt.style.background = pc.main;
    nameRow.appendChild(pt);
  }
  if (m.bankrupt) {
    const bt = document.createElement('span');
    bt.className = 'inst-lv';
    bt.textContent = '已爆仓清算';
    bt.style.background = PALETTE.red;
    nameRow.appendChild(bt);
  }
  headInfo.appendChild(nameRow);

  const headSub = document.createElement('div');
  headSub.className = 'fin-head-sub';
  headSub.textContent =
    `总资产 ￥${Math.max(0, m.assets)} · ${m.institutionCount} 家机构 · 已进行 ${m.rounds} 圈`;
  headInfo.appendChild(headSub);
  head.appendChild(headInfo);
  body.appendChild(head);

  // ===== 资产结构 =====
  body.appendChild(metricSection('资产结构'));
  const gridA = document.createElement('div');
  gridA.className = 'fin-grid';
  gridA.appendChild(metricRow('总资产', `￥${Math.max(0, m.assets)}`, 'is-gold'));
  gridA.appendChild(metricRow('现金', `￥${m.cash}`, m.cash < 0 ? 'is-red' : 'is-jade'));
  gridA.appendChild(metricRow('机构市值', `￥${m.grossValue - m.mortgagedValue}`));
  gridA.appendChild(metricRow('质押资产', `￥${m.mortgagedValue}`));
  body.appendChild(gridA);

  // ===== 负债与净值 =====
  body.appendChild(metricSection('负债与净值'));
  const gridB = document.createElement('div');
  gridB.className = 'fin-grid';
  gridB.appendChild(metricRow('总负债', `￥${m.debt}`, m.debt > 0 ? 'is-red' : ''));
  gridB.appendChild(metricRow('未偿贷款', `￥${m.loanDebt}`));
  gridB.appendChild(metricRow('应付债券', `￥${m.bondPayable}`));
  gridB.appendChild(metricRow('质押融资额', `￥${m.mortgagedAmount}`));
  gridB.appendChild(metricRow('持有债券债权', `￥${m.bondReceivable}`, 'is-jade'));
  gridB.appendChild(metricRow('净资产', `￥${m.netWorth}`, m.netWorth < 0 ? 'is-red' : 'is-gold'));
  body.appendChild(gridB);

  const ratioWrap = document.createElement('div');
  ratioWrap.className = 'fin-ratios';
  const debtBar = document.createElement('div');
  debtBar.className = 'fin-bar';
  const debtFill = document.createElement('i');
  debtFill.style.width = `${Math.min(100, Math.max(0, m.debtRatio))}%`;
  debtFill.style.background = PALETTE.red;
  debtBar.appendChild(debtFill);
  const eqBar = document.createElement('div');
  eqBar.className = 'fin-bar';
  const eqFill = document.createElement('i');
  eqFill.style.width = `${Math.min(100, Math.max(0, m.equityRatio))}%`;
  eqFill.style.background = PALETTE.jade;
  eqBar.appendChild(eqFill);
  ratioWrap.appendChild(debtBar);
  ratioWrap.appendChild(eqBar);

  const ratioNote = document.createElement('div');
  ratioNote.className = 'fin-ratio-note';
  ratioNote.innerHTML =
    `资产负债率 <span class="hl-red">${m.debtRatio}%</span> · `
    + `权益比率 <span class="hl-green">${m.equityRatio}%</span> · `
    + `权益乘数 <span class="hl">×${m.leverage}</span>`;
  ratioWrap.appendChild(ratioNote);
  body.appendChild(ratioWrap);

  // ===== 经营指标 =====
  body.appendChild(metricSection('经营指标'));
  const gridC = document.createElement('div');
  gridC.className = 'fin-grid';
  gridC.appendChild(metricRow('在营机构', `${m.activeCount} 家`));
  gridC.appendChild(metricRow('质押机构', `${m.pledgedCount} 家`, m.pledgedCount > 0 ? 'is-red' : ''));
  gridC.appendChild(metricRow('监管牌照', `${m.regulatorCount} 张`, m.regulatorCount > 0 ? 'is-purple' : ''));
  gridC.appendChild(metricRow('机构平均等级', `${m.avgLevel}`, 'is-gold'));
  gridC.appendChild(metricRow('最高等级', `${m.maxLevel}`));
  gridC.appendChild(metricRow('每圈管理费收入', `￥${m.rentIncome}`, 'is-jade'));
  gridC.appendChild(metricRow('圈均摊薄收入', `￥${m.avgRentIncome}`, 'is-jade'));
  body.appendChild(gridC);

  // ===== 现金流与交易统计 =====
  body.appendChild(metricSection('现金流与交易统计'));
  const gridD = document.createElement('div');
  gridD.className = 'fin-grid';
  gridD.appendChild(metricRow('累计收取管理费', `￥${m.rentsCollected}`, 'is-jade'));
  gridD.appendChild(metricRow('累计支付管理费', `￥${m.rentsPaid}`, 'is-red'));
  gridD.appendChild(metricRow('管理费净流入', `￥${m.netRentFlow}`, m.netRentFlow >= 0 ? 'is-jade' : 'is-red'));
  gridD.appendChild(metricRow('收购次数', `${m.acquisitions} 次`));
  gridD.appendChild(metricRow('升级次数', `${m.upgrades} 次`));
  gridD.appendChild(metricRow('单笔最高管理费', `￥${m.largestRent}`, 'is-gold'));
  body.appendChild(gridD);

  const note = document.createElement('div');
  note.className = 'modal-note';
  note.textContent =
    `口径：总资产 = 现金 + 机构市值（已质押按半值计）。`
    + `总负债含未偿贷款、应付债券兑付义务与质押融资本金。`
    + `当前市场：${state.market === 'bull' ? '牛市' : state.market === 'bear' ? '熊市' : '震荡市'}。`;
  body.appendChild(note);

  return openModal({
    title: '财务指标 · 下钻',
    body,
    actions: [{ text: '关闭', primary: true }],
  });
}
