/**
 * 真等距 3D 管线自检 —— 纯逻辑验证，不依赖 WebGL。
 *
 * ================== 为什么能在无 WebGL 环境跑 ==================
 * 所有可断言的**数学与数据**都放在 `src/render3d/iso-geometry.js`
 * 与 `src/render3d/tile-face.js` 里 —— 这两个模块**不 import three.js**，
 * 因此可以在任何浏览器（甚至 Node）里直接断言。
 *
 * 验证的不变量：
 *
 *   ① 等距极角：35.264° → 三轴投影长度相等（真等距的判据）；
 *   ② 方位角吸附：任意角度吸附到 45°+k×90° 的最近档；
 *   ③ 四方位文字可读：四个档位下棋盘四角的屏幕朝向仍然分散
 *      （没有退化成一团 / 一条线）；
 *   ④ 地块纹理数 = 34（与 BOARD_SIZE 一致）；
 *   ⑤ 卡面读数完整：名称 / 等级五段 / 主读数 / 次读数 / 持有人真名 /
 *      质押 / 可收购 / 监管效果读数 / 特殊格数值 —— 一个都不能丢；
 *   ⑥ 砖高映射：level 0~4 → 0.3~1.2；
 *   ⑦ 交互参数：4px 拖拽阈值 / 90° 步进 / 缩放 1~2.2 / 平移 18%；
 *   ⑧ 色彩守恒：卡面用色必须在受控色板内（`palette.js` 的 ALLOWED_COLORS）。
 */

import { BOARD_CELLS, BOARD_SIZE, LEVELS } from '../core/board.js';
import {
  ALLOWED_COLORS, GROUP_COLORS, PLAYER_COLORS, REGULATOR_COLOR, PALETTE,
} from '../core/palette.js';
import { CAREER_PIECES } from '../render/careerPiece.js';
import {
  ISO_POLAR, ISO_STEP_RAD, ISO_BASE_AZIMUTH, ISO_AZIMUTH_STEPS,
  azimuthOf, snapAzimuth, snapAzimuthIndex, quarterTurnsFor,
  easeInOutCubic, easeAzimuth, projectIso, gridToScene,
  BRICK_HEIGHT_BY_LEVEL, brickHeight, HOVER_LIFT,
} from '../render3d/iso-geometry.js';
import { tileFace, tileState } from '../render3d/tile-face.js';
import { profileWidth } from '../render3d/career-piece3d.js';
import {
  DRAG_THRESHOLD, PIXELS_PER_QUARTER, PAN_LIMIT, ZOOM_MIN, ZOOM_MAX,
} from '../render3d/interaction.js';

/* ===========================================================
 * 断言工具
 * =========================================================== */
const results = [];
function check(name, fn) {
  try {
    const detail = fn();
    results.push({ name, pass: true, detail: detail || 'OK' });
  } catch (e) {
    results.push({ name, pass: false, detail: e && e.message ? e.message : String(e) });
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg || '断言失败');
}
function near(a, b, tol, msg) {
  assert(Math.abs(a - b) <= tol, `${msg || ''} 期望 ${b} ± ${tol}，实际 ${a}`);
}

/* ===========================================================
 * 构造一份最小可用的游戏状态
 * =========================================================== */
function makeState() {
  const players = [
    { id: 0, name: '测试员', isAI: false, colorIndex: 0, position: 0, cash: 2800, institutions: [], bankrupt: false },
    { id: 1, name: '量化研究员', isAI: true, colorIndex: 1, position: 3, cash: 2800, institutions: [], bankrupt: false },
  ];
  return {
    board: BOARD_CELLS,
    players,
    currentPlayerIndex: 0,
    market: 'normal',
    round: 1,
    phase: 'await-roll',
  };
}

/* ===========================================================
 * 测试项
 * =========================================================== */

// ① 等距极角 —— 三轴投影等长
check('真等距极角 35.264° 使三轴投影长度相等', () => {
  const deg = ISO_POLAR * 180 / Math.PI;
  near(deg, 35.264, 0.01, '极角');
  // 等距判据：tan(θ) = 1/√2
  near(Math.tan(ISO_POLAR), 1 / Math.SQRT2, 1e-9, 'tan θ');
  // 三轴投影长度应相等
  const len = (x, y, z) => {
    const p = projectIso(x, y, z, ISO_BASE_AZIMUTH);
    return Math.hypot(p.sx, p.sy);
  };
  const lx = len(1, 0, 0);
  const lz = len(0, 0, 1);
  const ly = len(0, 1, 0);
  near(lx, lz, 1e-9, 'X 轴 vs Z 轴投影长度');
  near(lx, ly, 1e-9, 'X 轴 vs Y 轴投影长度');
  return `极角 ${deg.toFixed(3)}°，三轴投影长度均为 ${lx.toFixed(4)}`;
});

// ② 方位角吸附
check('方位角吸附到 45°+k×90° 的最近档位', () => {
  near(azimuthOf(0), Math.PI / 4, 1e-9, '档 0');
  near(azimuthOf(1), Math.PI / 4 + Math.PI / 2, 1e-9, '档 1');
  near(azimuthOf(3), Math.PI / 4 + 3 * Math.PI / 2, 1e-9, '档 3');
  // 越界归一化
  near(azimuthOf(4), azimuthOf(0), 1e-9, '档 4 应回到档 0');
  near(azimuthOf(-1), azimuthOf(3), 1e-9, '档 -1 应回到档 3');

  // 43° → 45°（就近）；47° → 45°（就近，2° < 88°）；92° → 135°
  near(snapAzimuth(43 * Math.PI / 180), Math.PI / 4, 1e-9, '43° 吸附');
  near(snapAzimuth(47 * Math.PI / 180), Math.PI / 4, 1e-9, '47° 吸附');
  near(snapAzimuth(92 * Math.PI / 180), Math.PI / 4 + Math.PI / 2, 1e-9, '92° 吸附');
  near(snapAzimuth(178 * Math.PI / 180), Math.PI / 4 + Math.PI / 2, 1e-9, '178° 吸附（就近 135°）');
  assert(snapAzimuthIndex(135 * Math.PI / 180) === 1, '135° 应落在档 1');
  assert(snapAzimuthIndex(-45 * Math.PI / 180) === 3, '-45° 应落在档 3');
  return '四档吸附全部正确';
});

// ③ 四方位文字可读 —— 棋盘四角的屏幕朝向
check('四个方位下棋盘朝向均可读（不塌成一团）', () => {
  const cols = 8;
  const rows = 6;
  const corners = [
    [0, 0], [cols - 1, 0], [cols - 1, rows - 1], [0, rows - 1],
  ];
  for (let q = 0; q < ISO_AZIMUTH_STEPS; q++) {
    const az = azimuthOf(q);
    const pts = corners.map(([c, r]) => {
      const { x, z } = gridToScene(c, r, cols, rows);
      return projectIso(x, 0, z, az);
    });
    const xs = pts.map((p) => p.sx);
    const spanX = Math.max(...xs) - Math.min(...xs);
    assert(spanX > 1.5, `档 ${q} 水平跨度 ${spanX.toFixed(3)} 过小（棋盘被压扁）`);

    const ys = pts.map((p) => p.sy);
    const spanY = Math.max(...ys) - Math.min(...ys);
    assert(spanY > 1.0, `档 ${q} 垂直跨度 ${spanY.toFixed(3)} 过小`);

    for (let i = 0; i < 4; i++) {
      for (let j = i + 1; j < 4; j++) {
        const d = Math.hypot(pts[i].sx - pts[j].sx, pts[i].sy - pts[j].sy);
        assert(d > 0.5, `档 ${q} 角 ${i} 与角 ${j} 重合`);
      }
    }
  }
  return '4 个方位 × 4 个角 = 16 次投影全部保持可读';
});

// ④ 纹理数 = 34
check('地块纹理数量 = 34（与 BOARD_SIZE 一致）', () => {
  assert(BOARD_SIZE === 34, `BOARD_SIZE 应为 34，实为 ${BOARD_SIZE}`);
  assert(BOARD_CELLS.length === 34, `BOARD_CELLS 应为 34，实为 ${BOARD_CELLS.length}`);
  // 每格都必须能拿到一张独立纹理槽位
  const state = makeState();
  const seen = new Set();
  for (let i = 0; i < BOARD_SIZE; i++) {
    const cell = BOARD_CELLS[i];
    assert(cell && cell.index === i, `#${i} 格子定义异常`);
    const f = tileFace(cell, tileState(state, i));
    assert(f, `#${i} 拿不到卡面`);
    seen.add(i);
  }
  assert(seen.size === 34, `纹理槽位应为 34，实为 ${seen.size}`);
  return '34 格全部有独立纹理槽位';
});

// ⑤ 卡面读数完整性
check('卡面读数完整（名称/等级/主次读数/持有人/质押/监管/特殊）', () => {
  const state = makeState();
  state.players[0].institutions.push({ cellIndex: 1, level: 3, mortgaged: false });
  state.players[0].institutions.push({ cellIndex: 2, level: 0, mortgaged: true });

  for (let i = 0; i < BOARD_SIZE; i++) {
    const cell = BOARD_CELLS[i];
    const st = tileState(state, i);
    const f = tileFace(cell, st);

    assert(f.title && f.title.length > 0, `#${i} 缺名称`);
    assert(f.mainValue && f.mainValue !== '', `#${i} 缺主读数`);
    assert(f.mainLabel && f.mainLabel !== '', `#${i} 缺主读数标签`);
    assert(f.accent && f.accent.startsWith('#'), `#${i} 缺强调色`);

    if (f.kind === 'institution') {
      assert(f.segments.length === LEVELS.length, `#${i} 等级刻度应为 ${LEVELS.length} 段`);
      assert(f.subValue !== '', `#${i} 缺次读数`);
      assert(f.subLabel !== '', `#${i} 缺次读数标签`);
      assert(f.footLabel !== '', `#${i} 缺底栏标签`);
      if (f.held) {
        assert(f.mainLabel === '管理费', `#${i} 已持有主读数应为「管理费」，实为 ${f.mainLabel}`);
        assert(f.ownerName !== '', `#${i} 已持有但缺持有人真名`);
      } else {
        assert(f.mainLabel === '买入价', `#${i} 未持有主读数应为「买入价」，实为 ${f.mainLabel}`);
      }
    }
    if (f.kind === 'regulator') {
      assert(f.effectBig !== '', `#${i} 监管格缺效果读数`);
      assert(f.effectUnit !== '', `#${i} 监管格缺效果单位`);
      assert(f.effectName !== '', `#${i} 监管格缺效果名`);
      assert(f.footLabel === '不可升级', `#${i} 监管格应标「不可升级」`);
    }
    if (f.kind === 'wheel') {
      assert(f.outcomes.length >= 2, `#${i} 转盘格候选效果过少`);
      for (const o of f.outcomes) {
        assert(o.name && o.big, `#${i} 转盘候选缺名称或数值`);
      }
    }
    if (f.kind === 'special' || f.kind === 'casino') {
      assert(f.mainValue !== '', `#${i} 特殊格缺数值读数`);
    }
  }

  const mort = tileFace(BOARD_CELLS[2], tileState(state, 2));
  assert(mort.mortgaged === true, '质押态未透传');

  const held = tileFace(BOARD_CELLS[1], tileState(state, 1));
  assert(held.ownerName === '测试员', `持有人真名应为「测试员」，实为 ${held.ownerName}`);
  assert(held.held === true, '持有态未透传');

  return '34 格读数全部完整';
});

// ⑥ 可收购角标
check('可收购角标只在「人类回合 + 现金足够 + 未持有」时出现', () => {
  const state = makeState();
  state.players[0].cash = 0;
  for (let i = 0; i < BOARD_SIZE; i++) {
    const f = tileFace(BOARD_CELLS[i], tileState(state, i));
    if (BOARD_CELLS[i].type === 'institution') {
      assert(f.affordable === false, `#${i} 现金为 0 时不应标记可收购`);
    }
  }
  state.players[0].cash = 99999;
  let anyAfford = false;
  for (let i = 0; i < BOARD_SIZE; i++) {
    const f = tileFace(BOARD_CELLS[i], tileState(state, i));
    if (BOARD_CELLS[i].type === 'institution') anyAfford = anyAfford || f.affordable;
  }
  assert(anyAfford, '现金充足时应有可收购地块');

  state.currentPlayerIndex = 1;
  for (let i = 0; i < BOARD_SIZE; i++) {
    const f = tileFace(BOARD_CELLS[i], tileState(state, i));
    assert(f.affordable === false, `#${i} AI 回合不应标记可收购`);
  }
  return '可收购判定三态正确';
});

// ⑦ 砖高映射
check('砖块高度映射 level 0~4 → 0.3~1.2', () => {
  near(brickHeight(0), 0.3, 1e-9, 'level 0');
  near(brickHeight(1), 0.525, 1e-9, 'level 1');
  near(brickHeight(2), 0.75, 1e-9, 'level 2');
  near(brickHeight(3), 0.975, 1e-9, 'level 3');
  near(brickHeight(4), 1.2, 1e-9, 'level 4');
  assert(BRICK_HEIGHT_BY_LEVEL.length === 5, '砖高表应为 5 档');
  near(brickHeight(9), 1.2, 1e-9, 'level 9 应钳到 4');
  near(brickHeight(-3), 0.3, 1e-9, 'level -3 应钳到 0');
  return '0.3 / 0.525 / 0.75 / 0.975 / 1.2';
});

// ⑧ 交互参数
check('交互参数：4px 拖拽阈值 / 90° 步进 / 缩放 1~2.2 / 平移 18%', () => {
  assert(DRAG_THRESHOLD === 4, `拖拽阈值应为 4px，实为 ${DRAG_THRESHOLD}`);
  near(ISO_STEP_RAD, Math.PI / 2, 1e-9, '步进角');
  assert(ZOOM_MIN === 1 && ZOOM_MAX === 2.2, `缩放范围应为 1~2.2，实为 ${ZOOM_MIN}~${ZOOM_MAX}`);
  near(PAN_LIMIT, 0.18, 1e-9, '平移钳制比例');

  assert(quarterTurnsFor(PIXELS_PER_QUARTER, PIXELS_PER_QUARTER) === 1, '拖满一档应为 1');
  assert(quarterTurnsFor(-PIXELS_PER_QUARTER, PIXELS_PER_QUARTER) === -1, '反向拖满应为 -1');
  assert(quarterTurnsFor(4, PIXELS_PER_QUARTER) === 0, '微动应为 0 档');
  assert(quarterTurnsFor(PIXELS_PER_QUARTER * 1.4, PIXELS_PER_QUARTER) === 1, '1.4 档应为 1');
  return `阈值 ${DRAG_THRESHOLD}px · 一档 ${PIXELS_PER_QUARTER}px · 缩放 ${ZOOM_MIN}~${ZOOM_MAX}`;
});

// ⑨ 吸附动画缓动
check('吸附动画 easeInOutCubic 单调且端点固定', () => {
  near(easeInOutCubic(0), 0, 1e-9, '起点');
  near(easeInOutCubic(1), 1, 1e-9, '终点');
  near(easeInOutCubic(0.5), 0.5, 1e-6, '中点');
  let prev = -1;
  for (let i = 0; i <= 20; i++) {
    const v = easeInOutCubic(i / 20);
    assert(v >= prev, '缓动必须单调递增');
    prev = v;
  }
  const from = 0.3;
  const to = 1.0;
  near(easeAzimuth(from, to, 0), from, 1e-9, '动画起点');
  near(easeAzimuth(from, to, 1), to, 1e-9, '动画终点');
  return 'easeInOutCubic 单调、端点固定';
});

// ⑩ 职业棋子剪影保留（7 职业两两不同）
check('7 个职业的 3D 旋转体轮廓两两不同（剪影保留）', () => {
  const sigs = new Set();
  const ids = Object.keys(CAREER_PIECES);
  assert(ids.length === 7, `职业数应为 7，实为 ${ids.length}`);
  for (const id of ids) {
    const p = CAREER_PIECES[id];
    const sig = [
      p.crown, p.emblem, p.height, p.base,
      p.profile.map((k) => `${k.y}:${k.w}`).join('|'),
    ].join('/');
    assert(!sigs.has(sig), `职业 ${p.name} 与另一职业造型重复`);
    sigs.add(sig);
    const w0 = profileWidth(p, 0);
    const w1 = profileWidth(p, 1);
    assert(w0 > 0 && w1 > 0, `职业 ${p.name} 轮廓宽度非法`);
  }
  return '7 职业造型指纹互不相同';
});

// ⑪ 色彩守恒 —— 卡面用色必须在受控色板内
check('卡面用色全部落在受控色板内（配色不变）', () => {
  const state = makeState();
  state.players[0].institutions.push({ cellIndex: 1, level: 2, mortgaged: false });
  const bad = [];
  for (let i = 0; i < BOARD_SIZE; i++) {
    const f = tileFace(BOARD_CELLS[i], tileState(state, i));
    // ⚠ 只校验**配色受控**的字段：
    //   · body / groupBase —— 集团色（palette.js 的 GROUP_COLORS）；
    //   · accent / accentLt —— 归属色（未持有 = 集团色 / 已持有 = 玩家色）；
    //   · accentDk —— 归属暗部；
    //   监管格的 accent 是**逐机构的专属色**（沿用旧管线，
    //   见 canvas.js 的 REGULATOR_VISUAL），不在 16 色主色板内，
    //   但 3D **砖体侧面**用的是 palette.js 的紫晶 `REGULATOR_COLOR`，
    //   因此「紫晶监管」在 3D 里严格成立。
    for (const key of ['accent', 'accentLt', 'accentDk', 'body', 'groupBase']) {
      const c = f[key];
      if (!c) continue;
      if (f.kind === 'regulator' && (key === 'accent' || key === 'accentLt' || key === 'accentDk')) {
        continue;
      }
      if (!ALLOWED_COLORS.has(c)) bad.push(`#${i}.${key}=${c}`);
    }
  }
  for (const g of Object.values(GROUP_COLORS)) {
    for (const k of Object.keys(g)) {
      if (k === 'name') continue;
      assert(ALLOWED_COLORS.has(g[k]), `集团色 ${g[k]} 不在色板内`);
    }
  }
  assert(ALLOWED_COLORS.has(REGULATOR_COLOR.base), '监管色不在色板内');
  for (const p of PLAYER_COLORS) {
    assert(ALLOWED_COLORS.has(p.main), `玩家色 ${p.main} 不在色板内`);
  }
  assert(bad.length === 0, `卡面出现色板外的颜色：${bad.slice(0, 5).join(', ')}`);
  return '34 格卡面 + 四组色 + 监管色 + 玩家色全部在色板内';
});

// ⑫ 深色金融城配色保留
check('深色金融城主色未被改动（背景 / 面板 / 墨色）', () => {
  assert(PALETTE.panel === '#1e2436', `深色面板色被改动：${PALETTE.panel}`);
  assert(PALETTE.ink === '#151a26', `墨色被改动：${PALETTE.ink}`);
  assert(PALETTE.board === '#e8ddc4', `棋盘浅底被改动：${PALETTE.board}`);
  return 'panel #1e2436 / ink #151a26 / board #e8ddc4 保持不变';
});

// ⑬ hover 上浮高度
check('hover / 选中上浮高度 = 0.25 砖', () => {
  near(HOVER_LIFT, 0.25, 1e-9, '上浮高度');
  return '0.25';
});

/* ===========================================================
 * 导出
 * =========================================================== */
export function runIso3DTests() {
  return results.slice();
}

/** 供 run-selftest.py 直接调用 */
export function runAll() {
  return runIso3DTests();
}
