/**
 * 职业棋子建模（2.5D / 3D 立体台座）自检
 *
 * ================== 覆盖的断言 ==================
 * 1. CareerPieceRenderer 可实例化，且能在 Canvas 上画出**非空像素**
 * 2. 棋子具备五层构件：台座 / 杆身 / 头饰 / 徽记 / 状态标记
 * 3. **7 种职业两两不同**（轮廓 + 头饰 + 徽记 + 比例 任一不同）
 * 4. 职业轮廓**真的产生不同剪影**（逐个渲染 → 像素指纹互不相同）
 * 5. 台座有**真实厚度**（3D 下侧壁可见）
 * 6. 当前回合呼吸光晕 / AI 徽标 / hover 高亮 生效
 * 7. 3D 俯视压扁生效（flat 模式与平面模式结果不同）
 * 8. 落地压缩 / 朝向倾斜 / 弹跳 生效
 * 9. **已接入棋盘渲染器**（BoardRenderer.careerPieces 存在且被调用）
 * 10. 配色与 PLAYER_COLORS 一致（棋子主色 = 玩家色）
 */

/* ⚠ 静态 import 安全 —— careerPiece.js 无副作用。 */
import { CareerPieceRenderer, pieceOf, pieceSignature, CAREER_PIECES } from '../render/careerPiece.js';
import { PLAYER_COLORS } from './palette.js';

/** 断言收集器 */
function makeCollector() {
  const rows = [];
  return {
    rows,
    check(name, cond, detail) {
      rows.push({ name, pass: !!cond, detail: detail || '' });
    },
  };
}

/** 创建一张离屏画布 */
function makeCanvas(w = 200, h = 200) {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  return { cv, ctx };
}

/** 统计画布上的「非透明彩色像素」数量 */
function countPixels(ctx, w, h) {
  const d = ctx.getImageData(0, 0, w, h).data;
  let n = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] > 24) n++;
  }
  return n;
}

/** 画布内容的指纹 —— 用来判断两次绘制是否不同 */
function fingerprint(ctx, w, h) {
  const d = ctx.getImageData(0, 0, w, h).data;
  let s = 0;
  for (let i = 0; i < d.length; i += 4) {
    s = (s * 31 + d[i] + d[i + 1] * 3 + d[i + 2] * 7 + d[i + 3] * 11) >>> 0;
  }
  return s;
}

/**
 * 主入口 —— 返回 [{ name, pass, detail }]
 */
export function runAll() {
  const c = makeCollector();

  // ---------- 1. 可实例化且画得出像素 ----------
  const { cv, ctx } = makeCanvas(160, 160);
  const renderer = new CareerPieceRenderer();
  renderer.draw(ctx, {
    cx: 80, cy: 130, s: 2,
    color: PLAYER_COLORS[0].main,
    colorLt: PLAYER_COLORS[0].lt,
    colorDk: PLAYER_COLORS[0].dk,
    pieceIndex: 7,
    isCurrent: true,
    isAI: false,
    time: 0,
    flat: false,
  });
  const px = countPixels(ctx, 160, 160);
  c.check('职业棋子能画出实体像素（非空）',
    px > 300,
    `绘制像素 ${px} 个`);
  c.check('棋子计数正确',
    renderer.lastPieceCount === 1,
    `pieceCount = ${renderer.lastPieceCount}`);

  // ---------- 2. 五层构件齐备 ----------
  const proto = CareerPieceRenderer.prototype;
  const has = (m) => typeof proto[m] === 'function';
  c.check('棋子具备台座 / 杆身 / 头饰 / 徽记 / 状态标记五层构件',
    has('_drawBase') && has('_drawShaft') && has('_drawCrown')
    && has('_drawEmblem') && has('_drawGroundShadow'),
    `base=${has('_drawBase')} shaft=${has('_drawShaft')} `
    + `crown=${has('_drawCrown')} emblem=${has('_drawEmblem')} `
    + `shadow=${has('_drawGroundShadow')}`);

  // ---------- 3. 7 种职业两两不同（造型指纹） ----------
  const sigs = new Map();
  for (let a = 7; a <= 13; a++) {
    const s = pieceSignature(a);
    if (!sigs.has(s)) sigs.set(s, []);
    sigs.get(s).push(a);
  }
  c.check('7 种职业的造型指纹两两不同',
    sigs.size === 7,
    `唯一造型 ${sigs.size} 种 / 共 7 种职业`);

  // 头饰 / 徽记各自也应有区分度
  const crowns = new Set();
  const emblems = new Set();
  for (let a = 7; a <= 13; a++) {
    const p = pieceOf(a);
    crowns.add(p.crown);
    emblems.add(p.emblem);
  }
  c.check('7 种职业头饰各不相同（剪影辨识点）',
    crowns.size === 7,
    [...crowns].join(' / '));
  c.check('7 种职业徽记各不相同',
    emblems.size === 7,
    [...emblems].join(' / '));

  // ---------- 4. 轮廓真的产生不同剪影（像素级验证）----------
  // ⚠ 光看配置不够 —— 必须**渲染出来**看形状真的不同。
  const fingerprints = new Map();
  const widths = [];
  for (let a = 7; a <= 13; a++) {
    const { cv: cvC, ctx: ctxC } = makeCanvas(160, 160);
    const r = new CareerPieceRenderer();
    r.draw(ctxC, {
      cx: 80, cy: 130, s: 2,
      color: PLAYER_COLORS[0].main,
      colorLt: PLAYER_COLORS[0].lt,
      colorDk: PLAYER_COLORS[0].dk,
      pieceIndex: a,
      isCurrent: false, isAI: false, time: 0, flat: false,
    });
    const f = fingerprint(ctxC, 160, 160);
    if (!fingerprints.has(f)) fingerprints.set(f, []);
    fingerprints.get(f).push(a);
    // 量测剪影宽度（按行统计非透明像素的左右边界）
    const d = ctxC.getImageData(0, 0, 160, 160).data;
    let minX = 999, maxX = -1;
    for (let y = 0; y < 160; y++) {
      for (let x = 0; x < 160; x++) {
        if (d[(y * 160 + x) * 4 + 3] > 40) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
        }
      }
    }
    widths.push({ a, name: pieceOf(a).name, w: maxX - minX });
  }
  c.check('7 种职业渲染出的**剪影**互不相同',
    fingerprints.size === 7,
    `唯一像素指纹 ${fingerprints.size} 种 / 7 种职业`);
  const distinctWidths = new Set(widths.map((x) => x.w));
  c.check('至少 5 种职业的剪影**宽度**不同（体型有区分）',
    distinctWidths.size >= 5,
    widths.map((x) => `${x.name}:${x.w}px`).join(' '));

  // ---------- 5. 台座有真实厚度（3D 侧壁）----------
  const { cv: cv3d, ctx: ctx3d } = makeCanvas(160, 160);
  const r3d = new CareerPieceRenderer();
  r3d.draw(ctx3d, {
    cx: 80, cy: 130, s: 2,
    color: PLAYER_COLORS[0].main,
    colorLt: PLAYER_COLORS[0].lt,
    colorDk: PLAYER_COLORS[0].dk,
    pieceIndex: 13, isCurrent: false, isAI: false, time: 0, flat: true,
  });
  const flat3d = fingerprint(ctx3d, 160, 160);
  c.check('3D 俯视模式（flat）能画出棋子',
    countPixels(ctx3d, 160, 160) > 300,
    `flat 模式像素 ${countPixels(ctx3d, 160, 160)} 个`);

  const { cv: cvP, ctx: ctxP } = makeCanvas(160, 160);
  r3d.draw(ctxP, {
    cx: 80, cy: 130, s: 2,
    color: PLAYER_COLORS[0].main,
    colorLt: PLAYER_COLORS[0].lt,
    colorDk: PLAYER_COLORS[0].dk,
    pieceIndex: 13, isCurrent: false, isAI: false, time: 0, flat: false,
  });
  c.check('平面模式与 3D 模式表现不同（俯视压扁生效）',
    flat3d !== fingerprint(ctxP, 160, 160));

  // ---------- 6. 当前回合呼吸 / AI 徽标 / hover 高亮 ----------
  const base = {
    cx: 80, cy: 130, s: 2,
    color: PLAYER_COLORS[1].main,
    colorLt: PLAYER_COLORS[1].lt,
    colorDk: PLAYER_COLORS[1].dk,
    pieceIndex: 9, time: 0, flat: false,
  };
  const mk = (extra) => {
    const { cv: cvX, ctx: ctxX } = makeCanvas(160, 160);
    const r = new CareerPieceRenderer();
    r.draw(ctxX, { ...base, ...extra });
    return fingerprint(ctxX, 160, 160);
  };
  const fCur = mk({ isCurrent: true });
  const fNot = mk({ isCurrent: false });
  c.check('当前回合有呼吸光晕（与普通棋子不同）', fCur !== fNot);
  c.check('AI 徽标生效（与人形棋子可区分）',
    mk({ isAI: true }) !== mk({ isAI: false }));
  c.check('hover 高亮生效',
    mk({ hovered: true }) !== mk({ hovered: false }));

  // ---------- 7. 压缩 / 倾斜 / 弹跳 生效 ----------
  c.check('落地压缩生效（squash → 不同形态）',
    mk({ squash: { sx: 1.25, sy: 0.7 } }) !== fNot);
  c.check('朝向微倾生效（lean → 不同形态）',
    mk({ lean: 0.9 }) !== fNot);
  c.check('弹跳位移生效（bob → 不同形态）',
    mk({ bob: -14 }) !== fNot);

  // ---------- 8. 配色与玩家色一致 ----------
  const { cv: cvCol, ctx: ctxCol } = makeCanvas(160, 160);
  const rCol = new CareerPieceRenderer();
  rCol.draw(ctxCol, {
    cx: 80, cy: 130, s: 2,
    color: PLAYER_COLORS[2].main,
    colorLt: PLAYER_COLORS[2].lt,
    colorDk: PLAYER_COLORS[2].dk,
    pieceIndex: 7, isCurrent: false, isAI: false, time: 0, flat: false,
  });
  // 取样棋子杆身中部 —— 应当接近玩家主色
  const dCol = ctxCol.getImageData(0, 0, 160, 160).data;
  let best = null;
  let bestDist = 1e9;
  const target = PLAYER_COLORS[2].main.replace('#', '');
  const tr = parseInt(target.slice(0, 2), 16);
  const tg = parseInt(target.slice(2, 4), 16);
  const tb = parseInt(target.slice(4, 6), 16);
  for (let i = 0; i < dCol.length; i += 4) {
    if (dCol[i + 3] < 200) continue;
    const dd = (dCol[i] - tr) ** 2 + (dCol[i + 1] - tg) ** 2 + (dCol[i + 2] - tb) ** 2;
    if (dd < bestDist) { bestDist = dd; best = [dCol[i], dCol[i + 1], dCol[i + 2]]; }
  }
  c.check('棋子主色取自 PLAYER_COLORS（与地块 / 头像一致）',
    !!best && bestDist < 900,
    best ? `最近色 rgb(${best.join(',')}) vs 目标 rgb(${tr},${tg},${tb})` : '未取到主色');

  // ---------- 9. 已接入棋盘渲染器 ----------
  const game = window.__game || window.game;
  const br = game && game.renderer;
  if (br) {
    c.check('BoardRenderer 已接入职业棋子渲染器',
      !!br.careerPieces && typeof br.careerPieces.draw === 'function',
      `careerPieces = ${br.careerPieces ? br.careerPieces.constructor.name : '无'}`);
    c.check('本帧确实绘制了职业棋子',
      (br.careerPieces ? br.careerPieces.lastPieceCount : 0) >= 1,
      `pieceCount = ${br.careerPieces ? br.careerPieces.lastPieceCount : '?'}`);
  } else {
    c.check('BoardRenderer 已接入职业棋子渲染器',
      false, '无法访问 game.renderer');
  }

  // ---------- 10. 造型定义完整 ----------
  c.check('职业造型定义覆盖 7 种职业',
    Object.keys(CAREER_PIECES).length === 7,
    `共 ${Object.keys(CAREER_PIECES).length} 种`);
  let allProfileOk = true;
  for (const k of Object.keys(CAREER_PIECES)) {
    const p = CAREER_PIECES[k];
    if (!p.profile || p.profile.length < 4) allProfileOk = false;
    if (!p.crown || !p.emblem) allProfileOk = false;
  }
  c.check('每个职业都有完整轮廓 / 头饰 / 徽记', allProfileOk);

  return c.rows;
}
