// Renderer core: WebGLRenderer, scene, camera, sunlight, floating origin and the
// vessel-shadow pass used by the terrain. Owned by the integrator (see ARCHITECTURE.md).
//
// FLOATING ORIGIN: the camera always sits at render-space (0,0,0). Every object is placed at
//   object.position = objectMCI - ctx.origin     (ctx.origin = camera MCI position, doubles)
// Render axes == MCI axes, so directions and quaternions need no conversion.
//
// DEPTH: float reversed-Z (EXT_clip_control + DEPTH_COMPONENT32F) when available, else a logarithmic
// depth buffer. Reversed-Z keeps the hardware early depth test (log depth writes gl_FragDepth in every
// fragment shader, which disables it), so in the cockpit the terrain seen past the panels is not shaded
// under them. Custom shaders keep their logdepth chunks (they compile to nothing in reversed mode).

import * as THREE from 'three';
import { LAYERS, SUN, MOON, LM as LM_C, CSM as CSM_C } from '../core/constants.js';
import { SUN_DIR, localENU } from '../core/frames.js';

const QUALITY = {
  low: { pixelRatio: 1, shadowMap: 1024, vesselShadowMap: 1024, antialias: false },
  medium: { pixelRatio: 1.25, shadowMap: 2048, vesselShadowMap: 2048, antialias: false },
  high: { pixelRatio: 1.5, shadowMap: 4096, vesselShadowMap: 2048, antialias: false },
};

/** true when this browser can do reversed-Z (probed on a throw-away context before the real one). */
function probeClipControl() {
  try {
    if (typeof document === 'undefined') return false;
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2');
    if (!gl) return false;
    const ok = !!gl.getExtension('EXT_clip_control');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return ok;
  } catch {
    return false;
  }
}

// Cabin shadow-box centres in body axes (fixed in the vessel, so the IVA shadow map does not change
// with head movement and can be cached while the attitude is steady).
const CABIN_CENTRE = {
  LM: new THREE.Vector3(0, LM_C.ascentStage.cabinAxisY + 0.2, (LM_C.ascentStage.cabinFrontZ + LM_C.ascentStage.cabinRearZ) / 2),
  CSM: new THREE.Vector3(0, 0.2, CSM_C.sps.apexZ * 0.45),
};
const STACK_CENTRE_CSM = new THREE.Vector3(0, 0, -3.0); // docked stack centre in CSM axes (as cameras.focusFor)
const IVA_SHADOW_REFRESH_FRAMES = 10; // safety refresh of a cached IVA shadow map
const VS_REFRESH_FRAMES = 20; // safety refresh of an unchanged vessel-shadow map
const DS_SHARED_BOX_RANGE = 300; // m: descent stage and ascent stage share one vessel-shadow box

export function createRenderer(canvas, game) {
  const q = QUALITY[game.settings.quality] || QUALITY.high;
  const wantReversed = (game.params?.depth || 'reversed') === 'reversed';
  const reversedDepth = wantReversed && probeClipControl();
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: q.antialias,
    logarithmicDepthBuffer: !reversedDepth,
    reversedDepthBuffer: reversedDepth,
    powerPreference: 'high-performance',
    alpha: false,
    preserveDrawingBuffer: false,
  });
  const depthMode = renderer.capabilities.reversedDepthBuffer ? 'reversed' : 'log';
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
  if (depthMode === 'reversed') {
    camera._reversedDepth = true; // three sets this on first use; set it now so project() agrees from frame 0
    camera.updateProjectionMatrix();
  }
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
  if (depthMode === 'reversed') sunLight.shadow.camera._reversedDepth = true;
  scene.add(sunLight);
  scene.add(sunLight.target);

  // ---- Fill light: sunlight reflected off the lunar surface (lights vessel undersides) ----
  const fillLight = new THREE.HemisphereLight(0x000000, 0x808080, 0.0);
  scene.add(fillLight);
  // Lights are never drawn: their layers only decide which renders collect them. Both passes (main and
  // vessel-shadow) must see the SAME light set, or three's light-state version changes twice per frame
  // and every lit material re-runs getProgram() (program-cache-key string building) each frame.
  sunLight.layers.enableAll();
  fillLight.layers.enableAll();

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
  if (depthMode === 'reversed') vsCamera._reversedDepth = true; // depth 1 at near, 0 at far
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
      // depth convention of the map: ${depthMode === 'reversed' ? 'reversed-Z (1 = near the Sun, 0 = far)' : 'standard (0 = near the Sun)'}
      float vsTap(vec2 uv, float z) {
        ${depthMode === 'reversed' ? 'return step(texture2D(uVesselShadowMap, uv).x, z + 0.00005);' : 'return step(z - 0.00005, texture2D(uVesselShadowMap, uv).x);'}
      }
      // bilinearly weighted 2x2 depth comparison (smooth edges instead of texel stair-steps)
      float vsBilinear(vec2 uv, float z) {
        vec2 st = uv / uVesselShadowTexel - 0.5;
        vec2 f = fract(st);
        vec2 c = (floor(st) + 0.5) * uVesselShadowTexel;
        vec2 t = uVesselShadowTexel;
        float a = vsTap(c, z);
        float b = vsTap(c + vec2(t.x, 0.0), z);
        float d = vsTap(c + vec2(0.0, t.y), z);
        float e = vsTap(c + t, z);
        return mix(mix(a, b, f.x), mix(d, e, f.x), f.y);
      }
      float vesselShadow(vec3 worldPosRender) {
        if (uVesselShadowEnabled < 0.5) return 1.0;
        vec4 c = uVesselShadowMatrix * vec4(worldPosRender, 1.0);
        vec3 n = c.xyz / c.w;
        vec2 uv = n.xy * 0.5 + 0.5;
        // reversed: clip control ZERO_TO_ONE, window depth = NDC z, 0 = far; standard: [-1,1] -> [0,1], 1 = far
        float z = ${depthMode === 'reversed' ? 'n.z' : 'n.z * 0.5 + 0.5'};
        if (${depthMode === 'reversed' ? 'z <= 0.0' : 'z >= 1.0'}) return 1.0; // beyond the far plane
        if (uv.x <= 0.0 || uv.x >= 1.0 || uv.y <= 0.0 || uv.y >= 1.0) return 1.0;
        float sum = 0.0;
        for (int i = -1; i <= 1; i++) {
          for (int j = -1; j <= 1; j++) {
            sum += vsBilinear(uv + vec2(float(i), float(j)) * uVesselShadowTexel * 1.25, z);
          }
        }
        return sum / 9.0;
      }
    `,
    /** Frames the vessel-shadow map was actually re-rendered / skipped because nothing moved (debug). */
    stats: { rendered: 0, skipped: 0 },
  };

  const origin = new THREE.Vector3(); // camera MCI position this frame (doubles)
  const _v = new THREE.Vector3();
  const _v2 = new THREE.Vector3();
  const _qInv = new THREE.Quaternion();
  const _enu = { east: new THREE.Vector3(), north: new THREE.Vector3(), up: new THREE.Vector3() };
  const _shadowMat = new THREE.Matrix4();
  const _sunFocus = new THREE.Vector3(); // MCI centre of the sunLight shadow box
  const _vsFocus = new THREE.Vector3(); // MCI centre of the vessel-shadow box
  const _vsUp = { east: new THREE.Vector3(), north: new THREE.Vector3(), up: new THREE.Vector3() };

  // IVA sun-shadow cache: the cabin shadow map only changes when the Sun moves in body axes (attitude),
  // when something outside the cabin moves relative to it, or when a cabin asks (moving parts).
  const ivaShadow = {
    key: '',
    quat: new THREE.Quaternion(),
    pos: new THREE.Vector3(),
    other: new THREE.Vector3(),
    ds: new THREE.Vector3(),
    age: 1e9,
    requested: true,
    stats: { rendered: 0, cached: 0 },
  };
  // vessel-shadow cache: skip re-rendering the depth map when no spacecraft moved
  const vsCache = { key: new Float64Array(32), n: 0, age: 1e9, dirty: true, requested: true };

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
    /** 'reversed' (float reversed-Z) or 'log' (logarithmic depth buffer). */
    depthMode,
    sunDir: SUN_DIR.clone(),
    vesselShadow,
    frame: null, // current FrameContext (see beginFrame)
    /**
     * Ask for the sunlight shadow map (and the vessel-shadow map) to be re-rendered this frame. In the
     * cockpit the sun shadow map is cached while nothing moves; cabins call this when a moving part
     * that casts a visible shadow changes (hand controllers, hatches, stowage...).
     */
    requestShadowUpdate() {
      ivaShadow.requested = true;
      vsCache.requested = true;
    },
    /** IVA shadow-map cache statistics (debug). */
    shadowStats: ivaShadow.stats,
    /** Render-space position of an MCI point. */
    toRender(mci, out = new THREE.Vector3()) {
      return out.copy(mci).sub(origin);
    },
    /** Screen projection of an MCI point: {x, y} in CSS pixels, onScreen, behind, ndcZ. */
    project(mci, out = {}) {
      _v.copy(mci).sub(origin);
      // behind the camera -> project() mirrors; detect with the camera-space z
      _v2.copy(_v).applyQuaternion(_qInv.copy(camera.quaternion).invert());
      out.behind = _v2.z > 0;
      _v.project(camera);
      const w = renderer.domElement.clientWidth;
      const h = renderer.domElement.clientHeight;
      out.x = (_v.x * 0.5 + 0.5) * w;
      out.y = (-_v.y * 0.5 + 0.5) * h;
      out.ndcZ = _v.z;
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

  /** Other spacecraft that could throw a shadow into the active one's box (within ~100 m), or null. */
  function nearOther(active) {
    const o = game.vessels[active.id === 'LM' ? 'CSM' : 'LM'];
    if (!o || o === active) return null;
    return o.pos.distanceToSquared(active.pos) < 100 * 100 ? o : null;
  }
  function nearDescentStage(active) {
    const lm = game.vessels.LM;
    const ds = lm && lm.staged ? lm.descentStage : null;
    if (!ds) return null;
    return ds.pos.distanceToSquared(active.pos) < 100 * 100 ? ds : null;
  }

  /**
   * IVA: decide whether the cached cabin shadow map is still valid. It is when the vessel attitude has
   * not changed by more than ~0.03 deg (Sun direction in body axes), nothing nearby moved relative to
   * the cabin, and no cabin asked for a refresh. A safety refresh runs every few frames anyway.
   */
  function ivaShadowNeedsUpdate(active, ivaVesselId) {
    const S = ivaShadow;
    const key = `${ivaVesselId}|${active.id}|${active.docked ? 1 : 0}|${game.vessels.LM?.staged ? 1 : 0}|${game.scenarioId}`;
    let dirty = S.requested || key !== S.key || S.age >= IVA_SHADOW_REFRESH_FRAMES;
    if (!dirty) dirty = 1 - Math.abs(S.quat.dot(active.quat)) > 1e-8; // ~0.02 deg
    // world-fixed casters (terrain chunks, rocks) matter only close to the ground
    const alt = active.tel?.altitude ?? 1e9;
    if (!dirty && alt < 150) dirty = S.pos.distanceToSquared(active.pos) > 25e-6; // 5 mm
    _qInv.copy(active.quat).invert();
    const o = nearOther(active);
    _v.set(0, 0, 0);
    if (o) _v.copy(o.pos).sub(active.pos).applyQuaternion(_qInv);
    if (!dirty) dirty = _v.distanceToSquared(S.other) > 25e-6;
    const ds = nearDescentStage(active);
    _v2.set(0, 0, 0);
    if (ds) _v2.copy(ds.pos).sub(active.pos).applyQuaternion(_qInv);
    if (!dirty) dirty = _v2.distanceToSquared(S.ds) > 25e-6;
    if (dirty) {
      S.key = key;
      S.quat.copy(active.quat);
      S.pos.copy(active.pos);
      S.other.copy(_v);
      S.ds.copy(_v2);
      S.age = 0;
      S.requested = false;
      S.stats.rendered++;
    } else {
      S.age++;
      S.stats.cached++;
    }
    return dirty;
  }

  /**
   * Centre (MCI) and half-size of the vessel-shadow box. After LM staging the descent stage left on
   * the pad keeps casting its shadow: while the two stages are within DS_SHARED_BOX_RANGE the box
   * spans both (measured across the Sun direction, which is what the ortho box covers); further apart
   * it follows whichever stage is nearer to the camera.
   */
  function vesselShadowBox(active, stackCentre, out) {
    const docked = active.docked;
    let hs = docked ? 16 : 10;
    out.copy(stackCentre);
    let subjectAlt = active.tel?.altitude ?? 1e9;
    const lm = game.vessels.LM;
    const ds = lm && lm.staged ? lm.descentStage : null;
    if (ds && !docked) {
      _v.copy(ds.pos).sub(active.pos);
      const along = _v.dot(SUN_DIR);
      _v.addScaledVector(SUN_DIR, -along); // separation across the Sun direction
      const sep = _v.length();
      if (sep < DS_SHARED_BOX_RANGE) {
        out.addScaledVector(_v, 0.5);
        hs = Math.max(hs, sep * 0.5 + 6);
        subjectAlt = 0; // the descent stage stands on the ground
      } else if (ds.pos.distanceToSquared(origin) < active.pos.distanceToSquared(origin)) {
        out.copy(ds.pos);
        subjectAlt = 0;
      }
    }
    return { hs, subjectAlt };
  }

  /** Numbers that fully determine the vessel-shadow depth map (relative to its camera). */
  function vsKey(centreMCI, hs, near, far) {
    const k = vsCache.key;
    let n = 0;
    const push = (x) => (k[n++] = x);
    const vec = (p) => {
      push(p.x - centreMCI.x);
      push(p.y - centreMCI.y);
      push(p.z - centreMCI.z);
    };
    const quat = (qq) => {
      push(qq.x);
      push(qq.y);
      push(qq.z);
      push(qq.w);
    };
    const { LM, CSM } = game.vessels;
    // a spacecraft far outside the box (the CSM in orbit while the LM is on the surface) does not count
    const reachSq = (hs + far) * (hs + far);
    for (const v of [LM, CSM]) {
      if (v.pos.distanceToSquared(centreMCI) < reachSq) {
        vec(v.pos);
        quat(v.quat);
      } else for (let i = 0; i < 7; i++) push(0);
    }
    const ds = LM.staged ? LM.descentStage : null;
    if (ds) {
      vec(ds.pos);
      quat(ds.quat);
    } else for (let i = 0; i < 7; i++) push(0);
    push(LM.staged ? 1 : 0);
    push(hs);
    push(near);
    push(far);
    push(game.view.mode === 'iva' ? 1 : 0);
    return n;
  }
  const _vsPrev = new Float64Array(32);
  function vsChanged(n) {
    const k = vsCache.key;
    let changed = n !== vsCache.n;
    for (let i = 0; i < n && !changed; i++) changed = Math.abs(k[i] - _vsPrev[i]) > 1e-4;
    if (changed || vsCache.requested || vsCache.age >= VS_REFRESH_FRAMES) {
      _vsPrev.set(k.subarray(0, n));
      vsCache.n = n;
      vsCache.age = 0;
      vsCache.requested = false;
      return true;
    }
    vsCache.age++;
    return false;
  }

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
    const iva = view.mode === 'iva';
    const ivaVessel = iva ? game.vessels[view.ivaVessel] || active : null;
    const docked = active.docked;
    const csm = game.vessels.CSM;

    // --- sunLight: tight shadow box around the cabin (IVA) or the active vessel / stack (exterior)
    let half;
    if (ivaVessel) {
      // body-fixed cabin centre: head movement does not move the box, so the map can be cached
      half = 3.2;
      _sunFocus.copy(CABIN_CENTRE[ivaVessel.type] || CABIN_CENTRE.LM).applyQuaternion(ivaVessel.quat).add(ivaVessel.pos);
    } else if (docked && csm) {
      // docked stack: LM origin is 9.4 m ahead of the CSM origin and the SPS bell 7.8 m behind it
      half = 13;
      _sunFocus.copy(STACK_CENTRE_CSM).applyQuaternion(csm.quat).add(csm.pos);
    } else {
      half = active.type === 'CSM' ? 8 : 7;
      _sunFocus.copy(focusMCI);
      // after staging, the descent stage left on the pad keeps its self-shadowing when the camera is
      // closer to it than to the ascent stage (ground / fly-by views of the launch pad)
      const lm = game.vessels.LM;
      const ds = active === lm && lm.staged ? lm.descentStage : null;
      if (ds && ds.pos.distanceToSquared(origin) < active.pos.distanceToSquared(origin)) {
        _sunFocus.set(0, 2.2, 0).applyQuaternion(ds.quat).add(ds.pos);
      }
    }
    const focusRender = ctx.toRender(_sunFocus, _v2);
    const sc = sunLight.shadow.camera;
    if (sc.right !== half) {
      sc.left = -half;
      sc.right = half;
      sc.top = half;
      sc.bottom = -half;
      sc.near = 0.5;
      sc.far = half * 2 + 60;
      sc.updateProjectionMatrix();
    }
    sunLight.target.position.copy(focusRender);
    sunLight.position.copy(focusRender).addScaledVector(SUN_DIR, half + 30);
    sunLight.target.updateMatrixWorld();
    sunLight.updateMatrixWorld();
    if (ivaVessel) {
      // cached map: keep the shadow matrix in step with the floating origin every frame (a pure
      // translation of the light camera together with the cabin leaves the map content unchanged)
      const dirty = ivaShadowNeedsUpdate(active, ivaVessel.id);
      renderer.shadowMap.autoUpdate = false;
      if (dirty) renderer.shadowMap.needsUpdate = true;
      sunLight.shadow.updateMatrices(sunLight);
    } else {
      renderer.shadowMap.autoUpdate = true;
      ivaShadow.key = '';
    }

    // --- fill light: lunar surface reflecting sunlight, strongest near the ground
    localENU(focusMCI, _enu.east, _enu.north, _enu.up);
    const sunElev = Math.max(0, SUN_DIR.dot(_enu.up));
    const alt = Math.max(0, active.tel.altitude || 0);
    // fraction of the sky covered by the Moon's disc as seen from altitude alt
    const r = MOON.radius;
    const ang = Math.asin(Math.min(1, r / (r + alt)));
    const coverage = 1 - Math.cos(ang); // 1 at the surface (hemisphere), ~0.66 at 110 km
    fillLight.position.copy(_enu.up); // HemisphereLight: "sky" along +position, ground opposite
    fillLight.color.setRGB(0.004, 0.005, 0.007); // faint earthshine / starlight from above
    fillLight.groundColor.setRGB(1.0, 0.97, 0.93);
    fillLight.intensity = 0.12 * SUN.intensity * (0.25 + 0.75 * sunElev) * coverage;

    // --- vessel shadow pass matrix (terrain samples this); rendered in renderVesselShadow()
    const vs = vesselShadow;
    const stackCentre = docked && csm ? _v.copy(STACK_CENTRE_CSM).applyQuaternion(csm.quat).add(csm.pos) : _v.copy(focusMCI);
    const box = vesselShadowBox(active, _v2.copy(stackCentre), _vsFocus);
    const subjectAlt = Math.max(0, Math.min(alt, box.subjectAlt));
    const lifting = alt / Math.max(0.05, sunElev);
    const reach = Math.min(8000, lifting + 80);
    vs.enabled = subjectAlt < 1500;
    vs.uniforms.uVesselShadowEnabled.value = vs.enabled ? 1 : 0;
    vsCache.dirty = false;
    if (vs.enabled) {
      const hs = box.hs;
      vsCamera.left = -hs;
      vsCamera.right = hs;
      vsCamera.top = hs;
      vsCamera.bottom = -hs;
      vsCamera.near = 1;
      vsCamera.far = 60 + reach;
      const fr = ctx.toRender(_vsFocus, _v);
      vsCamera.position.copy(fr).addScaledVector(SUN_DIR, 40);
      localENU(_vsFocus, _vsUp.east, _vsUp.north, _vsUp.up);
      vsCamera.up.copy(_vsUp.up);
      vsCamera.lookAt(fr);
      vsCamera.updateProjectionMatrix();
      vsCamera.updateMatrixWorld(true);
      _shadowMat.multiplyMatrices(vsCamera.projectionMatrix, vsCamera.matrixWorldInverse);
      vs.uniforms.uVesselShadowMatrix.value.copy(_shadowMat);
      vsCache.dirty = vsChanged(vsKey(_vsFocus, hs, vsCamera.near, Math.round(vsCamera.far)));
    } else {
      vsCache.requested = true; // re-render as soon as it is enabled again
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

  /**
   * Render spacecraft depth from the Sun into the vessel shadow map. Skipped when no spacecraft moved
   * since the last render (the map is relative to its own camera, which follows the floating origin).
   * The caller may already have updated the scene matrices (scene.matrixWorldAutoUpdate = false).
   */
  function renderVesselShadow() {
    if (!vesselShadow.enabled) return;
    if (!vsCache.dirty) {
      vesselShadow.stats.skipped++;
      return;
    }
    vesselShadow.stats.rendered++;
    const prevOverride = scene.overrideMaterial;
    const prevTarget = renderer.getRenderTarget();
    const prevAutoClear = renderer.autoClear;
    const prevShadowAuto = renderer.shadowMap.autoUpdate;
    const prevShadowNeeds = renderer.shadowMap.needsUpdate;
    // this pass must neither render nor consume the sunlight shadow map
    renderer.shadowMap.autoUpdate = false;
    renderer.shadowMap.needsUpdate = false;
    scene.overrideMaterial = vsOverride;
    renderer.setRenderTarget(vsTarget);
    renderer.autoClear = true;
    renderer.clear(true, true, false);
    renderer.render(scene, vsCamera);
    renderer.setRenderTarget(prevTarget);
    scene.overrideMaterial = prevOverride;
    renderer.autoClear = prevAutoClear;
    renderer.shadowMap.autoUpdate = prevShadowAuto;
    renderer.shadowMap.needsUpdate = prevShadowNeeds;
  }

  return { ctx, renderer, scene, camera, beginFrame, renderVesselShadow, resize };
}
