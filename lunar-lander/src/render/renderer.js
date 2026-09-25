// Renderer core: WebGLRenderer, scene, camera, sunlight, floating origin and the
// vessel-shadow pass used by the terrain. Owned by the integrator (see ARCHITECTURE.md).
//
// FLOATING ORIGIN: the camera always sits at render-space (0,0,0). Every object is placed at
//   object.position = objectMCI - ctx.origin     (ctx.origin = camera MCI position, doubles)
// Render axes == MCI axes, so directions and quaternions need no conversion.

import * as THREE from 'three';
import { LAYERS, SUN, MOON } from '../core/constants.js';
import { SUN_DIR, localENU } from '../core/frames.js';

const QUALITY = {
  low: { pixelRatio: 1, shadowMap: 1024, vesselShadowMap: 1024, antialias: false },
  medium: { pixelRatio: 1.25, shadowMap: 2048, vesselShadowMap: 2048, antialias: false },
  high: { pixelRatio: 2, shadowMap: 4096, vesselShadowMap: 2048, antialias: false },
};

export function createRenderer(canvas, game) {
  const q = QUALITY[game.settings.quality] || QUALITY.high;
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: q.antialias,
    logarithmicDepthBuffer: true,
    powerPreference: 'high-performance',
    alpha: false,
    preserveDrawingBuffer: false,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.pixelRatio));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.setClearColor(0x000000, 1);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);

  const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.01, 1e9);
  camera.layers.enable(LAYERS.WORLD);
  camera.layers.enable(LAYERS.VESSEL);
  camera.layers.enable(LAYERS.CABIN);
  camera.layers.enable(LAYERS.FX);
  camera.layers.disable(LAYERS.GHOST);
  scene.add(camera); // so camera-attached objects (if any) render

  // ---- Sunlight for spacecraft exteriors & cabins (three.js shadow map, tight box) ----
  const sunLight = new THREE.DirectionalLight(SUN.color, SUN.intensity);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(q.shadowMap, q.shadowMap);
  sunLight.shadow.bias = -0.0002;
  sunLight.shadow.normalBias = 0.02;
  sunLight.shadow.radius = 2;
  sunLight.shadow.camera.near = 0.5;
  sunLight.shadow.camera.far = 80;
  scene.add(sunLight);
  scene.add(sunLight.target);

  // ---- Fill light: sunlight reflected off the lunar surface (lights vessel undersides) ----
  const fillLight = new THREE.HemisphereLight(0x000000, 0x808080, 0.0);
  scene.add(fillLight);

  // ---- Vessel shadow pass (custom depth map, sampled by the terrain & rocks shaders) ----
  const vsSize = q.vesselShadowMap;
  const vsTarget = new THREE.WebGLRenderTarget(vsSize, vsSize, {
    depthBuffer: true,
    stencilBuffer: false,
  });
  vsTarget.depthTexture = new THREE.DepthTexture(vsSize, vsSize);
  vsTarget.depthTexture.type = THREE.UnsignedIntType;
  vsTarget.depthTexture.minFilter = THREE.NearestFilter;
  vsTarget.depthTexture.magFilter = THREE.NearestFilter;
  const vsCamera = new THREE.OrthographicCamera(-12, 12, 12, -12, 0.5, 600);
  vsCamera.layers.set(LAYERS.VESSEL);
  vsCamera.layers.enable(LAYERS.GHOST);
  const vsOverride = new THREE.MeshBasicMaterial({ colorWrite: false });
  vsOverride.side = THREE.DoubleSide;
  const vesselShadow = {
    enabled: true,
    camera: vsCamera,
    target: vsTarget,
    halfSize: 12,
    uniforms: {
      uVesselShadowMap: { value: vsTarget.depthTexture },
      uVesselShadowMatrix: { value: new THREE.Matrix4() },
      uVesselShadowEnabled: { value: 0 },
      uVesselShadowTexel: { value: new THREE.Vector2(1 / vsSize, 1 / vsSize) },
    },
    // GLSL helper: include in a fragment shader that has a render-space world position.
    // float s = vesselShadow(worldPosRender);   // 1 = lit, 0 = in a spacecraft's shadow
    glsl: /* glsl */ `
      uniform sampler2D uVesselShadowMap;
      uniform mat4 uVesselShadowMatrix;
      uniform float uVesselShadowEnabled;
      uniform vec2 uVesselShadowTexel;
      float vesselShadow(vec3 worldPosRender) {
        if (uVesselShadowEnabled < 0.5) return 1.0;
        vec4 c = uVesselShadowMatrix * vec4(worldPosRender, 1.0);
        vec3 p = c.xyz / c.w * 0.5 + 0.5;
        if (p.x <= 0.0 || p.x >= 1.0 || p.y <= 0.0 || p.y >= 1.0 || p.z >= 1.0) return 1.0;
        float sum = 0.0;
        for (int i = -2; i <= 2; i++) {
          for (int j = -2; j <= 2; j++) {
            float d = texture2D(uVesselShadowMap, p.xy + vec2(float(i), float(j)) * uVesselShadowTexel * 1.5).x;
            sum += (p.z - 0.00005 > d) ? 0.0 : 1.0;
          }
        }
        return sum / 25.0;
      }
    `,
  };

  const origin = new THREE.Vector3(); // camera MCI position this frame (doubles)
  const _v = new THREE.Vector3();
  const _enu = { east: new THREE.Vector3(), north: new THREE.Vector3(), up: new THREE.Vector3() };
  const _shadowMat = new THREE.Matrix4();
  const _bias = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);

  const ctx = {
    THREE,
    renderer,
    scene,
    camera,
    sunLight,
    fillLight,
    origin,
    game,
    LAYERS,
    quality: game.settings.quality,
    qualitySettings: q,
    sunDir: SUN_DIR.clone(),
    vesselShadow,
    frame: null, // current FrameContext (see beginFrame)
    /** Render-space position of an MCI point. */
    toRender(mci, out = new THREE.Vector3()) {
      return out.copy(mci).sub(origin);
    },
    /** Screen projection of an MCI point: {x, y} in CSS pixels, onScreen, behind, ndcZ. */
    project(mci, out = {}) {
      _v.copy(mci).sub(origin).project(camera);
      const w = renderer.domElement.clientWidth;
      const h = renderer.domElement.clientHeight;
      // behind the camera -> project() mirrors; detect with the camera-space z
      const cz = _v.z;
      const camSpace = new THREE.Vector3().copy(mci).sub(origin).applyQuaternion(camera.quaternion.clone().invert());
      out.behind = camSpace.z > 0;
      out.x = (_v.x * 0.5 + 0.5) * w;
      out.y = (-_v.y * 0.5 + 0.5) * h;
      out.ndcZ = cz;
      out.onScreen = !out.behind && _v.x >= -1 && _v.x <= 1 && _v.y >= -1 && _v.y <= 1;
      return out;
    },
  };

  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);

  /**
   * Called once per frame after cameras.update(): sets the floating origin, camera, lights,
   * and builds the FrameContext that every render module receives.
   */
  function beginFrame(frameInfo) {
    const view = game.view;
    origin.copy(view.cameraMCI);
    camera.position.set(0, 0, 0);
    camera.quaternion.copy(view.quat);
    if (camera.fov !== view.fov || camera.near !== view.near || camera.far !== view.far) {
      camera.fov = view.fov;
      camera.near = view.near;
      camera.far = view.far;
      camera.updateProjectionMatrix();
    }
    camera.updateMatrixWorld(true);

    const active = game.active;
    const focusMCI = active.pos;

    // --- sunLight: tight shadow box around the cabin (IVA) or the active vessel (exterior)
    const iva = view.mode === 'iva';
    const docked = active.docked;
    const half = iva ? 3.2 : docked ? 13 : active.type === 'CSM' ? 8 : 7;
    const focusRender = ctx.toRender(focusMCI, new THREE.Vector3());
    if (iva) {
      // centre on the eye so the cabin is covered
      focusRender.set(0, 0, 0);
    }
    const sc = sunLight.shadow.camera;
    sc.left = -half;
    sc.right = half;
    sc.top = half;
    sc.bottom = -half;
    sc.near = 0.5;
    sc.far = half * 2 + 60;
    sc.updateProjectionMatrix();
    sunLight.target.position.copy(focusRender);
    sunLight.position.copy(focusRender).addScaledVector(SUN_DIR, half + 30);
    sunLight.target.updateMatrixWorld();
    sunLight.updateMatrixWorld();

    // --- fill light: lunar surface reflecting sunlight, strongest near the ground
    localENU(focusMCI, _enu.east, _enu.north, _enu.up);
    const sunElev = Math.max(0, SUN_DIR.dot(_enu.up));
    const alt = Math.max(0, active.tel.altitude || 0);
    // fraction of the sky covered by the Moon's disc as seen from altitude alt
    const r = MOON.radius;
    const ang = Math.asin(Math.min(1, r / (r + alt)));
    const coverage = (1 - Math.cos(ang)); // 1 at the surface (hemisphere), ~0.66 at 110 km
    fillLight.position.copy(_enu.up); // HemisphereLight: "sky" along +position, ground opposite
    fillLight.color.setRGB(0.004, 0.005, 0.007); // faint earthshine / starlight from above
    fillLight.groundColor.setRGB(1.0, 0.97, 0.93);
    fillLight.intensity = 0.12 * SUN.intensity * (0.25 + 0.75 * sunElev) * coverage;

    // --- vessel shadow pass matrix (terrain samples this); rendered in renderVesselShadow()
    const vs = vesselShadow;
    const lifting = alt / Math.max(0.05, sunElev);
    const reach = Math.min(8000, lifting + 80);
    vs.enabled = alt < 1500 && !(iva && false);
    vs.uniforms.uVesselShadowEnabled.value = vs.enabled ? 1 : 0;
    if (vs.enabled) {
      const hs = docked ? 16 : 10;
      vsCamera.left = -hs;
      vsCamera.right = hs;
      vsCamera.top = hs;
      vsCamera.bottom = -hs;
      vsCamera.near = 1;
      vsCamera.far = 60 + reach;
      const fr = ctx.toRender(focusMCI, new THREE.Vector3());
      vsCamera.position.copy(fr).addScaledVector(SUN_DIR, 40);
      vsCamera.up.copy(_enu.up);
      vsCamera.lookAt(fr);
      vsCamera.updateProjectionMatrix();
      vsCamera.updateMatrixWorld(true);
      _shadowMat.multiplyMatrices(vsCamera.projectionMatrix, vsCamera.matrixWorldInverse);
      vs.uniforms.uVesselShadowMatrix.value.copy(_shadowMat);
    }

    const frame = {
      dt: frameInfo.realDt,
      simDt: frameInfo.simDt,
      time: game.time.met,
      origin,
      cameraMCI: view.cameraMCI,
      cameraQuat: view.quat,
      sunDir: SUN_DIR,
      viewMode: view.mode,
      ivaVessel: view.ivaVessel,
      active,
      vessels: game.vessels,
      game,
      ctx,
    };
    ctx.frame = frame;
    return frame;
  }

  /** Render spacecraft depth from the Sun into the vessel shadow map. */
  function renderVesselShadow() {
    if (!vesselShadow.enabled) return;
    const prevOverride = scene.overrideMaterial;
    const prevTarget = renderer.getRenderTarget();
    const prevAutoClear = renderer.autoClear;
    const prevShadowAuto = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false;
    scene.overrideMaterial = vsOverride;
    renderer.setRenderTarget(vsTarget);
    renderer.autoClear = true;
    renderer.clear(true, true, false);
    renderer.render(scene, vsCamera);
    renderer.setRenderTarget(prevTarget);
    scene.overrideMaterial = prevOverride;
    renderer.autoClear = prevAutoClear;
    renderer.shadowMap.autoUpdate = prevShadowAuto;
  }

  return { ctx, renderer, scene, camera, beginFrame, renderVesselShadow, resize };
}
