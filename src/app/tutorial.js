/**
 * 教学引导 —— 首局浮层提示。
 */

const STEPS = [
  {
    title: '欢迎来到中国金融城',
    body: '这是一座虚拟的中国金融都市圈。你将与 <b>3 位 AI 玩家</b> 争夺 <b>40 家金融机构</b> 的经营权。<br><br>四大集团各 10 格，从小型网点一路到行业标杆，租金阶梯清晰 —— 越靠后的牌照越贵，也越赚。',
  },
  {
    title: '① 掷骰与移动',
    body: '点击 <b>掷骰子</b> 抽取交易机会（点数累加），你的棋子会<b>一格一跳</b> 沿着金融街移动。走到哪里，就结算哪里的收益。',
  },
  {
    title: '② 收购经营权',
    body: '落在<b>无主机构</b>上会弹出收购要约。支付收购价即可拿到该机构的经营权 —— 这就是大富翁里的"买地"。<br><br>放弃也没关系，等下一轮再来。',
  },
  {
    title: '③ 升级总部大楼',
    body: '点击 <b>我的机构</b> 可以升级你持有的机构。等级从<b>网点级 → 支行级 → 分行级 → 总部级 → 地标级</b>，每次升级都会大幅提高收取的管理费。',
  },
  {
    title: '④ 收租与质押',
    body: '别的玩家走到你的机构上，会向你支付<b>管理费</b>。现金紧张时，可以在 <b>我的机构</b> 里做<b>股权质押融资</b>换取现金，赎回时需支付解押费。',
  },
  {
    title: '⑤ 牛熊与爆仓',
    body: '每 <b>3 圈</b> 行情切换一次：<b>牛市</b>全场租金 +20%，<b>熊市</b> −20%。若现金为负且无法变现，就会<b>爆仓清算</b>，你的机构被强制质押，角色离场。<br><br>只剩最后一位玩家时，游戏结束。祝你玩得开心！',
  },
];

/**
 * 显示教学浮层
 * @param {function} onFinish 结束时回调
 */
export function showTutorial(onFinish) {
  let index = 0;

  const mask = document.createElement('div');
  mask.className = 'tutorial-mask';
  mask.innerHTML = `
    <div class="tut-box pixel-panel">
      <div class="modal-inner">
        <div class="tut-step" id="tut-step"></div>
        <div class="tut-title" id="tut-title"></div>
        <div class="tut-body" id="tut-body"></div>
        <div class="tut-nav">
          <button class="pixel-btn" id="tut-skip">跳过教学</button>
          <div style="display:flex;gap:10px;align-items:center;">
            <div class="tut-dots" id="tut-dots"></div>
            <button class="pixel-btn pixel-btn-primary" id="tut-next">下一步</button>
          </div>
        </div>
      </div>
    </div>
  `;
  document.getElementById('app').appendChild(mask);

  const stepEl = mask.querySelector('#tut-step');
  const titleEl = mask.querySelector('#tut-title');
  const bodyEl = mask.querySelector('#tut-body');
  const dotsEl = mask.querySelector('#tut-dots');
  const nextBtn = mask.querySelector('#tut-next');

  for (let i = 0; i < STEPS.length; i++) {
    const d = document.createElement('span');
    d.className = 'tut-dot';
    dotsEl.appendChild(d);
  }

  function render() {
    const s = STEPS[index];
    stepEl.textContent = `第 ${index + 1} / ${STEPS.length} 步`;
    titleEl.textContent = s.title;
    bodyEl.innerHTML = s.body;
    [...dotsEl.children].forEach((d, i) => {
      d.classList.toggle('is-on', i === index);
    });
    nextBtn.textContent = index === STEPS.length - 1 ? '开始游戏' : '下一步';
  }

  function finish() {
    mask.remove();
    if (onFinish) onFinish();
  }

  nextBtn.addEventListener('click', () => {
    if (index === STEPS.length - 1) {
      finish();
    } else {
      index++;
      render();
    }
  });

  mask.querySelector('#tut-skip').addEventListener('click', finish);

  // 键盘：Enter/空格 = 下一步，Esc = 跳过
  const onKey = (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      nextBtn.click();
    } else if (e.key === 'Escape') {
      finish();
    }
  };
  document.addEventListener('keydown', onKey);
  const origRemove = mask.remove.bind(mask);
  mask.remove = () => {
    document.removeEventListener('keydown', onKey);
    origRemove();
  };

  render();
}
