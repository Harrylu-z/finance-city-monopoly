/**
 * 3D 职业棋子 —— 把 `careerPiece.js` 的**旋转体轮廓**转成 LatheGeometry。
 *
 * ================== 为什么复用 careerPiece 的 profile ==================
 * 2D 管线（`src/render/careerPiece.js`）已经把 7 个职业的辨识度做到了
 * 「剪影可辨」—— 每职业有**独立的 profile 序列** + **独立的头饰**。
 * 如果 3D 里另起一套造型，两条管线的棋子会「长得不一样」，
 * 用户会觉得换了个游戏。
 *
 * 所以：**profile 直接复用**（同一个数据源），轮廓插值函数也复用。
 * 3D 里做的是「同一副轮廓的三维化」——
 *   · profile → LatheGeometry（旋转体，天然有圆柱体积与自阴影）；
 *   · crown → 对应的 3D 头饰几何（帽筒 / 帽檐 / 冠齿 / 目镜 …）；
 *   · 配色仍取 `PLAYER_COLORS`（哑光 roughness 0.9）。
 *
 * ================== 辨识度保持 ==================
 *   投行家 = 细高杆 + 高礼帽      赌王   = 粗壮杆 + 皇冠
 *   风控总监 = 中宽杆 + 鸭舌帽    量化研究员 = 极瘦杆 + 科技目镜
 *   精算师 = 鼓腹杆 + 圆顶眼镜    交易员 = 细杆 + 耳机
 *   基金经理 = 标准杆 + 礼帽
 * —— 与 2D 完全一致。
 */

import { PLAYER_COLORS } from '../core/palette.js';
import { CAREER_PIECES, pieceOf } from '../render/careerPiece.js';

export { CAREER_PIECES, pieceOf };

/**
 * 按轮廓插值求某个高度的**相对半宽**（与 careerPiece.js 同算法）。
 *
 * @param {object} piece 造型定义
 * @param {number} t 0（台面）~ 1（顶端）
 */
export function profileWidth(piece, t) {
  const pr = piece.profile;
  if (t <= pr[0].y) return pr[0].w;
  for (let i = 1; i < pr.length; i++) {
    if (t <= pr[i].y) {
      const a = pr[i - 1];
      const b = pr[i];
      const k = (t - a.y) / Math.max(1e-6, b.y - a.y);
      const e = k * k * (3 - 2 * k);
      return a.w + (b.w - a.w) * e;
    }
  }
  return pr[pr.length - 1].w;
}

/** 台座半径（基准） */
const BASE_R = 0.30;
/** 杆身半径（基准） */
const SHAFT_R = 0.145;
/** 杆身高度（基准） */
const SHAFT_H = 0.52;

/**
 * 3D 职业棋子管理器 —— 为每个玩家创建一个棋子 Group。
 */
export class CareerPiece3D {
  /**
   * @param {THREE} THREE three.js 命名空间
   */
  constructor(THREE) {
    this.THREE = THREE;
    /** playerId → { group, body, crown, halo, aiMark, squash } */
    this.pieces = new Map();
    /** 几何缓存：pieceId → geometry */
    this._geo = new Map();
    /** 材质缓存：color → material */
    this._matCache = new Map();
    /** 当前回合的玩家 id */
    this.currentPlayerId = null;
    /** 动画时钟（秒） */
    this.time = 0;
  }

  /**
   * 创建（或复用）一个玩家的棋子。
   *
   * @param {number} playerId
   * @param {number} pieceIndex 职业索引 7..13
   * @param {number} colorIndex 玩家配色索引
   * @param {boolean} isAI
   * @returns {THREE.Group}
   */
  acquire(playerId, pieceIndex, colorIndex, isAI) {
    let p = this.pieces.get(playerId);
    if (p) {
      // 换职业 / 换色 → 重建
      if (p.pieceIndex !== pieceIndex || p.colorIndex !== colorIndex) {
        this.dispose(playerId);
        p = null;
      } else {
        return p.group;
      }
    }
    p = this._build(playerId, pieceIndex, colorIndex, isAI);
    this.pieces.set(playerId, p);
    return p.group;
  }

  /** 销毁某玩家的棋子 */
  dispose(playerId) {
    const p = this.pieces.get(playerId);
    if (!p) return;
    if (p.group.parent) p.group.parent.remove(p.group);
    this.pieces.delete(playerId);
  }

  /** 全部棋子数量（自检断言用） */
  get count() {
    return this.pieces.size;
  }

  /* ===========================================================
   * 构建
   * =========================================================== */
  _build(playerId, pieceIndex, colorIndex, isAI) {
    const { THREE } = this;
    const piece = pieceOf(pieceIndex);
    const tone = PLAYER_COLORS[colorIndex % PLAYER_COLORS.length];

    const group = new THREE.Group();
    group.name = `piece-${playerId}`;

    // ---- 台座（圆柱）----
    const baseH = 0.11;
    const base = new THREE.Mesh(
      this._cylGeo(BASE_R * piece.base, BASE_R * piece.base, baseH, 20),
      this.mat(tone.main, 0.9),
    );
    base.position.y = baseH / 2;
    base.castShadow = true;
    base.receiveShadow = true;
    group.add(base);

    // 台座暗边（底部一圈）
    const baseRing = new THREE.Mesh(
      this._cylGeo(BASE_R * piece.base * 1.06, BASE_R * piece.base * 1.06, 0.028, 20),
      this.mat(tone.dk, 0.9),
    );
    baseRing.position.y = 0.014;
    group.add(baseRing);

    // ---- 杆身（旋转体）----
    const shaftH = SHAFT_H * piece.height;
    const shaft = new THREE.Mesh(
      this._latheGeo(piece),
      this.mat(tone.main, 0.9),
    );
    shaft.position.y = baseH;
    shaft.scale.set(SHAFT_R, shaftH, SHAFT_R);
    shaft.castShadow = true;
    shaft.receiveShadow = true;
    group.add(shaft);

    // ---- 职业色环带（1/3 高处）----
    const bandW = SHAFT_R * profileWidth(piece, 0.66) * 1.06;
    const band = new THREE.Mesh(
      this._cylGeo(bandW, bandW, 0.05, 18),
      this.mat(piece.accent, 0.85),
    );
    band.position.y = baseH + shaftH * 0.66;
    group.add(band);

    // ---- 头饰 ----
    const crown = this._buildCrown(piece, tone, baseH + shaftH);
    group.add(crown);

    // ---- 当前回合呼吸光晕（贴地圆环）----
    const halo = new THREE.Mesh(
      this._ringGeo(BASE_R * piece.base * 1.5, BASE_R * piece.base * 2.4, 24),
      new THREE.MeshBasicMaterial({
        color: tone.lt, transparent: true, opacity: 0.0, side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    halo.rotation.x = -Math.PI / 2;
    halo.position.y = 0.012;
    halo.renderOrder = 2;
    group.add(halo);

    // ---- AI 三角标 ----
    let aiMark = null;
    if (isAI) {
      aiMark = this._buildAiMark(tone);
      aiMark.position.y = baseH + shaftH + 0.42;
      group.add(aiMark);
    }

    return {
      playerId, pieceIndex, colorIndex, isAI,
      group, base, shaft, band, crown, halo, aiMark,
      baseH, shaftH,
      tone,
      /** 落地压缩（squash） */
      squash: { sx: 1, sy: 1 },
      /** 浮空高度 */
      hover: 0,
      /** 是否选中 */
      selected: false,
    };
  }

  /* ===========================================================
   * 头饰 —— 3D 版（保持 2D 的辨识点）
   * =========================================================== */
  _buildCrown(piece, tone, y) {
    const { THREE } = this;
    const g = new THREE.Group();
    g.name = `crown-${piece.id}`;

    const accent = this.mat(piece.accent, 0.72);
    const dark = this.mat('#1e293b', 0.88);

    switch (piece.crown) {
      case 'topHat': {
        const brim = new THREE.Mesh(this._cylGeo(0.17, 0.17, 0.022, 18), dark);
        brim.position.y = 0.011;
        g.add(brim);
        const hat = new THREE.Mesh(this._cylGeo(0.115, 0.10, 0.20, 16), dark);
        hat.position.y = 0.022 + 0.10;
        hat.castShadow = true;
        g.add(hat);
        const bandM = new THREE.Mesh(this._cylGeo(0.122, 0.122, 0.035, 16), accent);
        bandM.position.y = 0.022 + 0.045;
        g.add(bandM);
        break;
      }
      case 'fedora': {
        const brim = new THREE.Mesh(this._cylGeo(0.165, 0.165, 0.02, 18), this.mat('#334155', 0.88));
        brim.position.y = 0.01;
        g.add(brim);
        const crownM = new THREE.Mesh(this._cylGeo(0.11, 0.115, 0.145, 16), this.mat('#1e293b', 0.88));
        crownM.position.y = 0.02 + 0.0725;
        crownM.castShadow = true;
        g.add(crownM);
        const bandM = new THREE.Mesh(this._cylGeo(0.118, 0.118, 0.03, 16), accent);
        bandM.position.y = 0.02 + 0.032;
        g.add(bandM);
        break;
      }
      case 'cap': {
        const crownM = new THREE.Mesh(
          this._sphereGeo(0.125, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2),
          this.mat(tone.dk, 0.9),
        );
        crownM.castShadow = true;
        g.add(crownM);
        // 帽舌（朝前）
        const peak = new THREE.Mesh(this._boxGeo(0.14, 0.018, 0.11), this.mat(tone.dk, 0.9));
        peak.position.set(0, 0.012, 0.115);
        g.add(peak);
        break;
      }
      case 'visor': {
        const hood = new THREE.Mesh(
          this._sphereGeo(0.125, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2),
          this.mat('#1e293b', 0.88),
        );
        hood.castShadow = true;
        g.add(hood);
        const lens = new THREE.Mesh(this._boxGeo(0.19, 0.036, 0.05), accent);
        lens.position.set(0, 0.012, 0.10);
        g.add(lens);
        break;
      }
      case 'phones': {
        const head = new THREE.Mesh(this._sphereGeo(0.105, 12, 10), this.mat('#1e293b', 0.88));
        head.position.y = 0.03;
        head.castShadow = true;
        g.add(head);
        for (const sx of [-1, 1]) {
          const cup = new THREE.Mesh(this._cylGeo(0.048, 0.048, 0.032, 12), this.mat('#1e293b', 0.88));
          cup.rotation.z = Math.PI / 2;
          cup.position.set(sx * 0.115, 0.03, 0);
          g.add(cup);
        }
        break;
      }
      case 'crown': {
        // 三尖冠（3 个小圆锥 + 一圈冠带）
        const bandM = new THREE.Mesh(this._cylGeo(0.115, 0.115, 0.045, 16), this.mat(piece.accent, 0.6));
        bandM.position.y = 0.0225;
        g.add(bandM);
        for (const a of [0, 2.094, 4.189]) {
          const spike = new THREE.Mesh(this._coneGeo(0.042, 0.14, 6), accent);
          spike.position.set(Math.sin(a) * 0.08, 0.045 + 0.07, Math.cos(a) * 0.08);
          spike.castShadow = true;
          g.add(spike);
        }
        break;
      }
      default: {
        // dome —— 圆顶 + 眼镜
        const dome = new THREE.Mesh(
          this._sphereGeo(0.125, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2),
          this.mat(tone.dk, 0.55),
        );
        dome.castShadow = true;
        g.add(dome);
        const glass = new THREE.Mesh(new this.THREE.TorusGeometry(0.105, 0.012, 6, 16), dark);
        glass.rotation.x = Math.PI / 2;
        glass.position.y = -0.01;
        g.add(glass);
        break;
      }
    }

    g.position.y = y;
    return g;
  }

  /* ===========================================================
   * AI 三角标
   * =========================================================== */
  _buildAiMark(tone) {
    const { THREE } = this;
    const g = new THREE.Group();
    const tri = new THREE.Mesh(
      this._coneGeo(0.062, 0.10, 3),
      new THREE.MeshBasicMaterial({ color: 0x151a26 }),
    );
    tri.rotation.x = Math.PI;
    g.add(tri);
    const dot = new THREE.Mesh(
      new THREE.SphereGeometry(0.022, 8, 6),
      new THREE.MeshBasicMaterial({ color: tone.lt }),
    );
    dot.position.y = -0.01;
    g.add(dot);
    return g;
  }

  /* ===========================================================
   * 状态更新
   * =========================================================== */

  /**
   * 标记当前回合玩家 —— 呼吸光晕 + 浮空。
   *
   * @param {number|null} playerId
   */
  setCurrent(playerId) {
    this.currentPlayerId = playerId;
  }

  /**
   * 设置选中态（额外高亮环）。
   *
   * @param {number} playerId
   * @param {boolean} on
   */
  setSelected(playerId, on) {
    const p = this.pieces.get(playerId);
    if (p) p.selected = !!on;
  }

  /**
   * 逐帧动画 —— 呼吸光晕 + 浮空 + 压缩恢复。
   *
   * ⚠ **移动中的棋子不写 Y**：
   *   跳跃动画（`iso-board.js` 的 `_updateMove`）自己管 Y ——
   *   若这里也写 `group.position.y`，两者会打架，
   *   抛物线高度会被压成 0（棋子贴着地面滑过去，没有跳跃感）。
   *
   * @param {number} dt 秒
   */
  update(dt, movingIds) {
    this.time += dt;
    for (const p of this.pieces.values()) {
      const isCur = this.currentPlayerId === p.playerId;
      const pulse = 0.5 + 0.5 * Math.sin(this.time / 0.62);

      // 当前回合：呼吸光晕 + 浮空
      const targetHover = isCur ? 0.06 + pulse * 0.02 : 0;
      p.hover += (targetHover - p.hover) * Math.min(1, dt * 9);
      // ⚠ 移动中 → 不覆盖 Y（交给跳跃动画）
      const moving = !!(movingIds && movingIds.has(p.playerId));
      if (!moving) p.group.position.y = p.hover;

      // 光晕
      const targetOpacity = isCur ? 0.18 + 0.20 * pulse : 0;
      p.halo.material.opacity += (targetOpacity - p.halo.material.opacity) * Math.min(1, dt * 8);
      const hs = isCur ? 1 + 0.06 * pulse : 1;
      p.halo.scale.set(hs, hs, hs);

      // 选中：额外的亮环
      if (p.selected) {
        p.halo.material.opacity = Math.max(p.halo.material.opacity, 0.34);
      }

      // 压缩恢复（squash 衰减回 1）
      // ⚠ 移动中 → 不覆盖缩放（落地压扁由跳跃动画负责）
      if (!moving) {
        const s = p.squash;
        if (s.sx !== 1 || s.sy !== 1) {
          s.sx += (1 - s.sx) * Math.min(1, dt * 10);
          s.sy += (1 - s.sy) * Math.min(1, dt * 10);
          if (Math.abs(s.sx - 1) < 0.002) { s.sx = 1; s.sy = 1; }
        }
        p.group.scale.set(s.sx, s.sy, s.sx);
      }
    }
  }

  /**
   * 施加落地压缩。
   *
   * @param {number} playerId
   * @param {number} amount 压缩量（0.85 = 压到 85%）
   */
  applySquash(playerId, amount) {
    const p = this.pieces.get(playerId);
    if (!p) return;
    p.squash.sx = amount;
    p.squash.sy = 2 - amount;
  }

  /* ===========================================================
   * 几何 / 材质缓存
   * =========================================================== */
  _latheGeo(piece) {
    const key = `lathe:${piece.id}`;
    if (this._geo.has(key)) return this._geo.get(key);
    const pts = [];
    const STEPS = 18;
    for (let i = 0; i <= STEPS; i++) {
      const t = i / STEPS;
      pts.push(new this.THREE.Vector2(Math.max(0.02, profileWidth(piece, t)), t));
    }
    const geo = new this.THREE.LatheGeometry(pts, 20);
    this._geo.set(key, geo);
    return geo;
  }

  _cylGeo(rt, rb, h, seg) {
    const key = `cyl:${rt}:${rb}:${h}:${seg}`;
    if (!this._geo.has(key)) {
      this._geo.set(key, new this.THREE.CylinderGeometry(rt, rb, h, seg));
    }
    return this._geo.get(key);
  }

  _coneGeo(r, h, seg) {
    const key = `cone:${r}:${h}:${seg}`;
    if (!this._geo.has(key)) {
      this._geo.set(key, new this.THREE.ConeGeometry(r, h, seg));
    }
    return this._geo.get(key);
  }

  _sphereGeo(r, w, h, ps, pl, ts, tl) {
    const key = `sphere:${r}:${w}:${h}:${ps}:${pl}:${ts}:${tl}`;
    if (!this._geo.has(key)) {
      this._geo.set(key, new this.THREE.SphereGeometry(r, w, h, ps, pl, ts, tl));
    }
    return this._geo.get(key);
  }

  _ringGeo(inner, outer, seg) {
    const key = `ring:${inner}:${outer}:${seg}`;
    if (!this._geo.has(key)) {
      this._geo.set(key, new this.THREE.RingGeometry(inner, outer, seg));
    }
    return this._geo.get(key);
  }

  _boxGeo(w, h, d) {
    const key = `box:${w}:${h}:${d}`;
    if (!this._geo.has(key)) {
      this._geo.set(key, new this.THREE.BoxGeometry(w, h, d));
    }
    return this._geo.get(key);
  }

  /**
   * 哑光材质缓存 —— roughness 0.9（纪念碑谷式的柔和哑光）。
   */
  mat(color, roughness) {
    const key = `${color}:${roughness}`;
    if (!this._matCache.has(key)) {
      this._matCache.set(key, new this.THREE.MeshStandardMaterial({
        color: new this.THREE.Color(color),
        roughness: roughness == null ? 0.9 : roughness,
        metalness: 0.05,
      }));
    }
    return this._matCache.get(key);
  }
}
