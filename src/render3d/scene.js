/**
 * 真等距 3D 场景 —— 相机（OrthographicCamera）+ 光照 + 雾。
 *
 * ================== 为什么是 OrthographicCamera ==================
 * 真等距（isometric）= **正交投影**。透视投影会让远处的砖块变小，
 * 破坏了「三轴等长」的等距性质 —— 纪念碑谷那种干净的阶梯感
 * 恰恰来自正交投影。
 *
 * ================== 相机参数 ==================
 *   · 极角（polar）= 35.264° = atan(1/√2) —— 三轴投影等长；
 *   · 方位角（azimuth）= 45° + k×90° —— 四个档位。
 *   · 相机**始终看向原点** —— 棋盘居中，不需要额外的 lookAt 目标。
 *
 * ================== 光照 ==================
 *   · **半球光**（HemisphereLight）—— 提供天/地两色的柔和环境色，
 *     这是纪念碑谷式柔和阴影的关键；
 *   · **定向光**（DirectionalLight）—— 唯一的硬阴影来源，
 *     开启 PCFSoftShadowMap（柔和阴影）；
 *   · **补光**（DirectionalLight，弱）—— 从反方向补一点，
 *     避免背面全黑（深色金融城背景下的可读性）。
 *
 * ⚠ 光照方向与 `careerPiece.js` 的 `LIGHT`（左上后方）保持一致，
 *   否则棋子与地块会「互相打架」。
 *
 * ================== 雾 ==================
 * 淡雾（FogExp2）—— 让远处砖块微微融入深色背景，
 * 制造纪念碑谷那种「浮在雾里的城市」的氛围。
 */

import {
  ISO_POLAR, ISO_BASE_AZIMUTH, azimuthOf,
} from './iso-geometry.js';
import { PAN_LIMIT } from './interaction.js';

/** 相机距离（正交相机下只影响裁剪范围，但要有足够深度） */
export const CAMERA_DISTANCE = 40;

/** 正交相机的「视口半高」（场景单位） */
export const VIEW_HALF_HEIGHT = 6.2;

/**
 * 场景构建器。
 */
export class Scene3D {
  /**
   * @param {THREE} THREE three.js 命名空间
   */
  constructor(THREE) {
    this.THREE = THREE;

    /** 渲染器 */
    this.renderer = null;
    /** 场景 */
    this.scene = null;
    /** 正交相机 */
    this.camera = null;
    /** 场景根 Group —— 承载所有内容 */
    this.root = null;
    /** 棋盘 Group（可整体旋转 / 平移） */
    this.boardGroup = null;
    /** 棋子 Group */
    this.pieceGroup = null;

    /** 当前方位角（弧度） */
    this.azimuth = ISO_BASE_AZIMUTH;
    /** 当前档位（0..3） */
    this.quarter = 0;
    /** 缩放倍数 */
    this.zoom = 1;
    /** 平移偏移（场景单位） */
    this.pan = { x: 0, z: 0 };
    /** 场景包围半径（用于 fit） */
    this.boundsRadius = 7.2;
    /** 取景留白系数（1 = 恰好贴边，越大留白越多） */
    this.fitPadding = 1.04;
    /** 棋盘投影包围盒（{ w, h }） */
    this._frame = null;
    /** 像素宽度（用于 zoom → frustum 换算） */
    this._w = 1;
    this._h = 1;
  }

  /**
   * 初始化渲染器 / 场景 / 相机 / 光照。
   *
   * @param {HTMLCanvasElement} canvas
   * @param {number} w 宽（CSS 像素）
   * @param {number} h 高（CSS 像素）
   */
  init(canvas, w, h) {
    const { THREE } = this;

    // ---- 渲染器 ----
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(Math.max(1, w), Math.max(1, h), false);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    // ---- 场景 ----
    this.scene = new THREE.Scene();
    // 背景透明 —— 让底层的 #stage-bg（天际线视差）透出来
    this.scene.background = null;
    // 淡雾（与深色金融城背景融合）
    this.scene.fog = new THREE.FogExp2(0x141a28, 0.0125);

    this.root = new THREE.Group();
    this.root.name = 'iso-root';
    this.scene.add(this.root);

    this.boardGroup = new THREE.Group();
    this.boardGroup.name = 'iso-board';
    this.root.add(this.boardGroup);

    this.pieceGroup = new THREE.Group();
    this.pieceGroup.name = 'iso-pieces';
    this.root.add(this.pieceGroup);

    // ---- 相机（正交）----
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
    this.camera.position.set(0, 0, CAMERA_DISTANCE);
    this.camera.lookAt(0, 0, 0);

    this._buildLights();
    this.resize(w, h);
    this.applyCamera();
    return this;
  }

  /* ===========================================================
   * 光照 —— 半球 + 定向柔阴影 + 补光
   * =========================================================== */
  _buildLights() {
    const { THREE } = this;

    // 半球光 —— 天空冷色 / 地面暖色
    const hemi = new THREE.HemisphereLight(0xcfe3ff, 0x2a2438, 1.05);
    hemi.position.set(0, 12, 0);
    hemi.name = 'hemi';
    this.scene.add(hemi);

    // 主定向光 —— 唯一硬阴影来源
    // 方向与 careerPiece.js 的 LIGHT（x=-0.55, y=-0.62）同向（左上后方）
    const key = new THREE.DirectionalLight(0xfff3d8, 2.05);
    key.position.set(-9, 15, 7);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -12;
    key.shadow.camera.right = 12;
    key.shadow.camera.top = 12;
    key.shadow.camera.bottom = -12;
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 60;
    key.shadow.bias = -0.0012;
    key.shadow.normalBias = 0.022;
    key.name = 'key-light';
    this.scene.add(key);
    this.keyLight = key;

    // 补光 —— 反方向弱补光，避免背面全黑
    const fill = new THREE.DirectionalLight(0x9fb6d8, 0.55);
    fill.position.set(8, 6, -8);
    fill.name = 'fill-light';
    this.scene.add(fill);

    // 底部反弹光（让砖体下缘不至于死黑）
    const bounce = new THREE.DirectionalLight(0x6b7488, 0.32);
    bounce.position.set(0, -8, 2);
    bounce.name = 'bounce-light';
    this.scene.add(bounce);
  }

  /* ===========================================================
   * 尺寸 / 视锥
   * =========================================================== */
  resize(w, h) {
    this._w = Math.max(1, w);
    this._h = Math.max(1, h);
    if (!this.renderer) return;
    this.renderer.setSize(this._w, this._h, false);
    this._updateFrustum();
  }

  /**
   * 视锥自适应 —— **按棋盘投影后的实际包围盒**取景。
   *
   * ⚠ 为什么不能写死半高：
   *   等距投影下棋盘的屏幕宽高由方位角决定（45° 档最宽），
   *   写死的视锥会在某些档位下把棋盘切掉一角、
   *   或者让棋盘缩成屏幕中间的一小块。
   *   这里在每次方位角变化后重新投影四个角 + 砖块最高点，
   *   取包围盒并按**可用宽高**取最小留白。
   */
  _updateFrustum() {
    if (!this.camera) return;
    const aspect = this._w / this._h;

    let halfH;
    if (this._frame) {
      // _frame = { w, h } —— 棋盘投影后的屏幕包围盒（场景单位）
      const needH = this._frame.h / 2;
      const needW = this._frame.w / 2;
      // 宽高两个方向都要装下 → 取更紧的那个
      halfH = Math.max(needH, needW / aspect);
    } else {
      halfH = VIEW_HALF_HEIGHT / this.zoom;
    }
    halfH *= (1 / this.zoom) * this.fitPadding;

    const halfW = halfH * aspect;
    this.camera.left = -halfW;
    this.camera.right = halfW;
    this.camera.top = halfH;
    this.camera.bottom = -halfH;
    this.camera.near = 0.1;
    this.camera.far = 200;
    this.camera.updateProjectionMatrix();
  }

  /**
   * 设置棋盘的投影包围盒（由 iso-board.js 在构建后调用）。
   *
   * @param {{w: number, h: number}} frame 屏幕包围盒尺寸（场景单位）
   */
  setFrame(frame) {
    this._frame = frame;
    this._updateFrustum();
  }

  /* ===========================================================
   * 相机姿态
   * =========================================================== */

  /**
   * 设置方位角（弧度）。
   *
   * @param {number} az
   */
  setAzimuth(az) {
    this.azimuth = az;
    this.applyCamera();
  }

  /**
   * 设置档位（0..3）—— 90° 步进。
   *
   * @param {number} q
   */
  setQuarter(q) {
    this.quarter = ((Math.round(q) % 4) + 4) % 4;
    this.azimuth = azimuthOf(this.quarter);
    this.applyCamera();
  }

  /** 把相机摆到当前方位角 */
  applyCamera() {
    if (!this.camera) return;
    const az = this.azimuth;
    const r = CAMERA_DISTANCE;
    // 球坐标 → 直角坐标（Y 轴朝上）
    const x = r * Math.sin(ISO_POLAR) * Math.sin(az);
    const y = r * Math.cos(ISO_POLAR);
    const z = r * Math.sin(ISO_POLAR) * Math.cos(az);
    this.camera.position.set(x, y, z);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(0, 0, 0);
    this.camera.updateProjectionMatrix();
  }

  /* ===========================================================
   * 平移 / 缩放
   * =========================================================== */

  /**
   * 设置平移（场景单位）—— 沿**屏幕水平/垂直**方向平移，
   * 这样拖动方向与画面一致（不会因为旋转而「横移变成纵移」）。
   *
   * @param {number} dx 屏幕水平位移（场景单位）
   * @param {number} dz 屏幕垂直位移（场景单位）
   */
  setPan(dx, dz) {
    // ⚠ **在这里钳制**（不只在控制器里）——
    //   控制器、按钮、回正等多个入口都会调 setPan，
    //   钳制放在这一层才不会出现「从某个入口能拖出界」。
    const lim = this.panLimit();
    const px = Math.max(-lim, Math.min(lim, Number(dx) || 0));
    const pz = Math.max(-lim, Math.min(lim, Number(dz) || 0));
    this.pan.x = px;
    this.pan.z = pz;
    if (!this.root) return;
    const { THREE } = this;
    // 屏幕水平方向 = 相机右向量；屏幕垂直方向 = 相机「前」的水平投影
    const right = new THREE.Vector3();
    this.camera.getWorldDirection(right);
    right.y = 0;
    if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
    right.normalize();
    const fwd = new THREE.Vector3(-right.z, 0, right.x);

    this.root.position.set(
      right.x * px + fwd.x * pz,
      0,
      right.z * px + fwd.z * pz,
    );
  }

  /**
   * 平移钳制范围（场景单位）—— 视口半高的 18%。
   *
   * ⚠ 与 `interaction.js` 的 PAN_LIMIT 保持一致 ——
   *   交互层用它做「拖拽中的阻尼」，这里用它做「最终硬边界」。
   *
   * @returns {number}
   */
  panLimit() {
    if (!this.camera) return 1;
    const halfH = (this.camera.top - this.camera.bottom) / 2;
    return halfH * PAN_LIMIT;
  }

  /**
   * 设置缩放（1 ~ 2.2）。
   *
   * @param {number} z
   */
  setZoom(z) {
    const next = Math.max(1, Math.min(2.2, Number(z) || 1));
    if (Math.abs(next - this.zoom) < 0.001) return;
    this.zoom = next;
    this._updateFrustum();
  }

  /** 当前缩放 */
  get zoomLevel() {
    return this.zoom;
  }

  /* ===========================================================
   * 渲染
   * =========================================================== */

  /** 渲染一帧 */
  render() {
    if (!this.renderer) return;
    this.renderer.render(this.scene, this.camera);
  }

  /** draw call 数（自检断言用） */
  get drawCalls() {
    return this.renderer ? this.renderer.info.render.calls : 0;
  }

  /** 三角形数（自检断言用） */
  get triangles() {
    return this.renderer ? this.renderer.info.render.triangles : 0;
  }
}
