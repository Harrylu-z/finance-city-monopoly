/**
 * 3D 棋盘构建 —— 8×6 砖块 + 护城河 + 中央广场石台。
 *
 * ================== 版图（与 core/board-shape.js 完全一致）==================
 *   · 网格 = 8 列 × 6 行；
 *   · 外环 24 格（城墙）· 护城河 1 格宽 · 内环 8 格（城中之城）· 城门 2 格；
 *   · 两环由城门架桥并成一条闭合回路 —— 规则层的 TRACK_CELLS 零改动。
 *
 * ================== 砖块高度 ==================
 * level 0~4 → 0.3 ~ 1.2（用户拍板）。
 *   · 未持有的普通机构 = 蓝图态：矮砖（level 0）+ 虚线感；
 *   · 已持有 = 按实际等级升高；
 *   · **地标**（landmark）额外加尖顶；
 *   · **监管** = 矮砖 + 穹顶（不可升级，形态独立）。
 *
 * ================== 侧面配色 ==================
 * 砖体侧面按 `GROUP_COLORS` 染一圈（监管用紫晶监管色），
 * 顶面则是 CanvasTexture（卡面）—— 形成「侧面识别归属 / 顶面读数据」的分工。
 */

import { BOARD_CELLS, BOARD_SIZE, TRACK_CELLS, BOARD_GRID } from '../core/board.js';
import { GROUP_COLORS, REGULATOR_COLOR, PALETTE } from '../core/palette.js';
import { groupOf } from './tile-face.js';
import {
  gridToScene, brickHeight, BRICK_FOOTPRINT, MOAT_DEPTH, PLAZA_HEIGHT,
} from './iso-geometry.js';
import { LABEL_W, LABEL_H } from './label-texture.js';

/** 名牌纹理宽高比 */
const LABEL_ASPECT = LABEL_W / LABEL_H;

/** 护城河水面颜色（深蓝 —— 与深色金融城呼应） */
const MOAT_COLOR = 0x1b2a44;
const MOAT_EDGE = 0x2b3a58;
/** 广场石台颜色 */
const PLAZA_COLOR = 0x1e2436;

/**
 * 3D 棋盘构建器。
 *
 * 产出：
 *   · `group` —— 承载全部静态几何的 Group；
 *   · `bricks` —— index → { mesh, topMesh, height, baseColor }；
 *   · `tileMeshes` —— index → 顶面 mesh（贴 CanvasTexture）。
 */
export class Board3DBuilder {
  /**
   * @param {THREE} THREE three.js 命名空间
   */
  constructor(THREE) {
    this.THREE = THREE;
    this.group = new THREE.Group();
    this.group.name = 'board3d';
    /** index → 砖块记录 */
    this.bricks = new Map();
    /** index → 顶面 mesh */
    this.tileMeshes = new Map();
    /** 材质缓存：key → material */
    this._matCache = new Map();
    /** 几何缓存 */
    this._geoCache = new Map();
  }

  /** 构建整块棋盘 */
  build() {
    const { THREE } = this;
    this._buildBase();
    this._buildMoat();
    this._buildPlaza();
    this._buildBricks();
    return this.group;
  }

  /* ===========================================================
   * 底座 —— 整个棋盘的地板
   * =========================================================== */
  _buildBase() {
    const { THREE } = this;
    const cols = BOARD_GRID.cols;
    const rows = BOARD_GRID.rows;
    const w = cols + 0.6;
    const h = rows + 0.6;

    const geo = new THREE.BoxGeometry(w, 0.4, h);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x171c2b,
      roughness: 0.94,
      metalness: 0.02,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = -0.24;
    mesh.receiveShadow = true;
    mesh.name = 'board-base';
    this.group.add(mesh);

    // 底座侧边一圈金线（金融城的鎏金）
    const trim = new THREE.Mesh(
      new THREE.BoxGeometry(w + 0.08, 0.05, h + 0.08),
      new THREE.MeshStandardMaterial({ color: PALETTE.goldDk, roughness: 0.6, metalness: 0.35 }),
    );
    trim.position.y = -0.055;
    trim.receiveShadow = true;
    this.group.add(trim);
  }

  /* ===========================================================
   * 护城河 —— 外环与内环之间的 1 格宽水道
   * ===========================================================
   * ⚠ 护城河是**环绕内环的 1 格宽水道**，不是一整片水面 ——
   *   内环（cols 2..5 × rows 2..3）就坐在水道中央，
   *   若铺满 cols 1..6 × rows 1..4，水面会把内环砖块淹掉。
   *
   * 做法：按 ZONES 的 moat 区**减去内环占地**，拆成 4 段水面。
   * =========================================================== */
  _buildMoat() {
    const { THREE } = this;
    const cols = BOARD_GRID.cols;
    const rows = BOARD_GRID.rows;

    const mat = new THREE.MeshStandardMaterial({
      color: MOAT_COLOR,
      roughness: 0.22,
      metalness: 0.25,
    });

    // ⚠ 护城河是**环绕内环的 1 格宽水道**，共 4 段：
    //   · 上段：row 1，cols 1..6（城门 A/B 架在上面）
    //   · 下段：row 4，cols 1..6
    //   · 左段：col 1，rows 2..3
    //   · 右段：col 6，rows 2..3
    // 与 `core/board-shape.js` 的 ZONES（moat 区 = cols 1..6 × rows 1..4）
    // 减去内环占地（cols 2..5 × rows 2..3）完全一致。
    const strips = [
      // [colStart, colEnd, rowStart, rowEnd]
      [1, 6, 1, 1],   // 上
      [1, 6, 4, 4],   // 下
      [1, 1, 2, 3],   // 左
      [6, 6, 2, 3],   // 右
    ];
    for (const [c0, c1, r0, r1] of strips) {
      const wCells = c1 - c0 + 1;
      const dCells = r1 - r0 + 1;
      const geo = new THREE.BoxGeometry(wCells * 0.98, MOAT_DEPTH, dCells * 0.98);
      const water = new THREE.Mesh(geo, mat);
      const cx = (c0 + c1) / 2 - (cols - 1) / 2;
      const cz = (r0 + r1) / 2 - (rows - 1) / 2;
      water.position.set(cx, -MOAT_DEPTH / 2 + 0.01, cz);
      water.receiveShadow = true;
      water.name = 'moat';
      this.group.add(water);
    }

    // 护城河两岸（上下各一条河堤）
    const bankGeo = new THREE.BoxGeometry(cols - 1, 0.10, 0.12);
    const bankMat = new THREE.MeshStandardMaterial({
      color: MOAT_EDGE, roughness: 0.85, metalness: 0.05,
    });
    for (const z of [-1.5, 1.5]) {
      const bank = new THREE.Mesh(bankGeo, bankMat);
      bank.position.set(0, 0.05, z);
      bank.receiveShadow = true;
      this.group.add(bank);
    }
  }

  /* ===========================================================
   * 中央广场 —— 内环围出的石台
   * ===========================================================
   * ⚠ 与 `core/board-shape.js` 的 ZONES 一致：
   *   广场 = 内环**中央两列**（cols 3..4）× **一行高**（row 2），
   *   横跨内环、居于棋盘正中（与旧管线的画法保持一致）。
   * =========================================================== */
  _buildPlaza() {
    const { THREE } = this;
    const cols = BOARD_GRID.cols;
    const rows = BOARD_GRID.rows;
    const w = 2;    // 中央两列
    const d = 1;    // 一行高

    // 广场中心：cols 3..4 → x = (3.5 + 4.5)/2 - 3.5 = 0.5；row 2 → z = 2 - 2.5 = -0.5
    const cx = (3 + 0.5) - (cols - 1) / 2 + (w - 1) / 2;
    const cz = (2 + 0.5) - (rows - 1) / 2;

    const geo = new THREE.BoxGeometry(w * 0.9, PLAZA_HEIGHT, d * 0.9);
    const mat = new THREE.MeshStandardMaterial({
      color: PLAZA_COLOR,
      roughness: 0.78,
      metalness: 0.12,
    });
    const plaza = new THREE.Mesh(geo, mat);
    plaza.position.set(cx, PLAZA_HEIGHT / 2, cz);
    plaza.receiveShadow = true;
    plaza.name = 'plaza';
    this.group.add(plaza);

    // 广场四角的金色角标
    const corner = new THREE.BoxGeometry(0.20, PLAZA_HEIGHT + 0.03, 0.20);
    const cMat = new THREE.MeshStandardMaterial({
      color: PALETTE.gold, roughness: 0.5, metalness: 0.4,
    });
    for (const x of [cx - w / 2 + 0.12, cx + w / 2 - 0.12]) {
      for (const z of [cz - d / 2 + 0.12, cz + d / 2 - 0.12]) {
        const c = new THREE.Mesh(corner, cMat);
        c.position.set(x, (PLAZA_HEIGHT + 0.03) / 2, z);
        c.castShadow = true;
        this.group.add(c);
      }
    }
  }

  /* ===========================================================
   * 砖块 —— 34 格
   * =========================================================== */
  _buildBricks() {
    const { THREE } = this;
    const cols = BOARD_GRID.cols;
    const rows = BOARD_GRID.rows;

    for (let i = 0; i < BOARD_SIZE; i++) {
      const cell = BOARD_CELLS[i];
      const [col, row] = TRACK_CELLS[i];
      const { x, z } = gridToScene(col, row, cols, rows);

      const g = groupOf(cell);
      const isReg = !!cell.regulator;
      const baseColor = isReg
        ? (REGULATOR_COLOR.base || g.base)
        : (GROUP_COLORS[cell.group] ? GROUP_COLORS[cell.group].base : g.base);
      const sideColor = isReg
        ? (REGULATOR_COLOR.dk || g.dk)
        : (GROUP_COLORS[cell.group] ? GROUP_COLORS[cell.group].dk : g.dk);

      // ---- 砖体（高度按 level，后续会变）----
      const brick = new THREE.Mesh(
        this._boxGeo(BRICK_FOOTPRINT, 1, BRICK_FOOTPRINT),
        new THREE.MeshStandardMaterial({
          color: sideColor,
          roughness: 0.88,
          metalness: 0.06,
        }),
      );
      brick.position.set(x, 0, z);
      brick.castShadow = true;
      brick.receiveShadow = true;
      brick.name = `brick-${i}`;
      brick.userData.cellIndex = i;
      this.group.add(brick);

      // ---- 顶面（贴 CanvasTexture，稍后由 tile-texture 填充）----
      const top = new THREE.Mesh(
        this._planeGeo(BRICK_FOOTPRINT * 0.97, BRICK_FOOTPRINT * 0.97),
        new THREE.MeshStandardMaterial({
          color: 0xffffff,
          roughness: 0.82,
          metalness: 0.04,
        }),
      );
      top.rotation.x = -Math.PI / 2;
      top.position.set(x, 0.5, z);
      top.receiveShadow = true;
      top.name = `tile-${i}`;
      top.userData.cellIndex = i;
      this.group.add(top);

      // ---- 地标尖顶 ----
      let spire = null;
      if (cell.landmark) {
        spire = new THREE.Mesh(
          this._coneGeo(BRICK_FOOTPRINT * 0.36, 0.55),
          new THREE.MeshStandardMaterial({
            color: baseColor, roughness: 0.6, metalness: 0.25,
          }),
        );
        spire.position.set(x, 0.5 + 0.275, z);
        spire.castShadow = true;
        spire.name = `spire-${i}`;
        this.group.add(spire);
      }

      // ---- 监管穹顶 ----
      let dome = null;
      if (isReg) {
        dome = new THREE.Mesh(
          this._sphereGeo(BRICK_FOOTPRINT * 0.30, 12, 10),
          new THREE.MeshStandardMaterial({
            color: baseColor, roughness: 0.42, metalness: 0.35,
          }),
        );
        dome.position.set(x, 0.5, z);
        dome.castShadow = true;
        dome.name = `dome-${i}`;
        this.group.add(dome);
      }

      this.bricks.set(i, {
        index: i,
        cell,
        brick,
        top,
        spire,
        dome,
        baseColor,
        sideColor,
        height: 0.3,
        x, z,
        col, row,
        label: null,
      });
      this.tileMeshes.set(i, top);
    }
  }

  /**
   * 挂上某格的**悬浮名牌** Sprite（永远正对相机）。
   *
   * ⚠ Sprite 的尺寸按**场景单位**给定，而正交相机的缩放由 frustum 决定 ——
   *   名牌要在 4 个方位下大小一致，只能用 Sprite（three.js 会自动
   *   让它面向相机并按屏幕尺寸保持比例）。
   *
   * @param {number} index
   * @param {THREE.Texture} texture 名牌纹理
   * @param {number} worldWidth 名牌的世界宽度（场景单位）
   */
  attachLabel(index, texture, worldWidth) {
    const b = this.bricks.get(index);
    if (!b) return;
    const { THREE } = this;
    const aspect = LABEL_ASPECT;
    const mat = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,      // 名牌永远浮在棋盘之上，不被砖块遮挡
      depthWrite: false,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(worldWidth, worldWidth / aspect, 1);
    sprite.renderOrder = 10;
    sprite.name = `label-${index}`;
    sprite.userData.cellIndex = index;
    if (b.label) {
      b.label.material.map = texture;
      b.label.material.needsUpdate = true;
    } else {
      b.label = sprite;
      this.group.add(sprite);
    }
  }

  /** 取某格的名牌 Sprite */
  getLabel(index) {
    const b = this.bricks.get(index);
    return b ? b.label : null;
  }

  /* ===========================================================
   * 高度更新 —— 状态变化时调整砖体高度与顶面位置
   * =========================================================== */

  /**
   * 设置某格的砖高（依据等级）。
   *
   * @param {number} index 格子索引
   * @param {number} level 等级 0..4
   */
  setHeight(index, level) {
    const b = this.bricks.get(index);
    if (!b) return;
    const h = brickHeight(level);
    b.height = h;

    b.brick.scale.y = h;
    b.brick.position.y = h / 2;

    b.top.position.y = h;
    if (b.spire) b.spire.position.y = h + 0.275;
    if (b.dome) b.dome.position.y = h + BRICK_FOOTPRINT * 0.12;
  }

  /**
   * 设置某格顶面的贴图。
   *
   * @param {number} index
   * @param {THREE.Texture} texture
   */
  setTexture(index, texture) {
    const b = this.bricks.get(index);
    if (!b) return;
    b.top.material.map = texture;
    b.top.material.needsUpdate = true;
  }

  /**
   * 设置某格的顶面贴图颜色染色 —— 未持有时压成「蓝图态」的淡灰蓝。
   *
   * @param {number} index
   * @param {boolean} held 是否已持有
   */
  setHeldStyle(index, held) {
    const b = this.bricks.get(index);
    if (!b) return;
    b.top.material.color.setHex(held ? 0xffffff : 0xc9d2e4);
  }

  /* ===========================================================
   * 几何 / 材质缓存
   * =========================================================== */
  _boxGeo(w, h, d) {
    const key = `box:${w}:${h}:${d}`;
    if (!this._geoCache.has(key)) {
      this._geoCache.set(key, new this.THREE.BoxGeometry(w, h, d));
    }
    return this._geoCache.get(key);
  }

  _planeGeo(w, h) {
    const key = `plane:${w}:${h}`;
    if (!this._geoCache.has(key)) {
      this._geoCache.set(key, new this.THREE.PlaneGeometry(w, h));
    }
    return this._geoCache.get(key);
  }

  _coneGeo(r, h) {
    const key = `cone:${r}:${h}`;
    if (!this._geoCache.has(key)) {
      this._geoCache.set(key, new this.THREE.ConeGeometry(r, h, 4));
    }
    return this._geoCache.get(key);
  }

  _sphereGeo(r, w, h) {
    const key = `sphere:${r}:${w}:${h}`;
    if (!this._geoCache.has(key)) {
      this._geoCache.set(key, new this.THREE.SphereGeometry(r, w, h));
    }
    return this._geoCache.get(key);
  }

  /**
   * 统计 draw call 相关指标（供自检断言）。
   *
   * @returns {{bricks: number, textures: number, landmarks: number, regulators: number}}
   */
  stats() {
    let landmarks = 0;
    let regulators = 0;
    for (const b of this.bricks.values()) {
      if (b.spire) landmarks++;
      if (b.dome) regulators++;
    }
    return {
      bricks: this.bricks.size,
      textures: this.tileMeshes.size,
      landmarks,
      regulators,
    };
  }
}
