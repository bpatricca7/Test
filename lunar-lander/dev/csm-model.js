// CSM-MODEL studio harness: the CSM in lunar orbit lighting (black sky, bright Moon below in the
// environment map, low Sun), camera presets for screenshots.
import * as THREE from 'three';
import { LAYERS, SUN } from '../src/core/constants.js';
import { createCSMModel } from '../src/render/models/csm/csmModel.js';

const q = new URLSearchParams(location.search);
const num = (k, d) => (q.has(k) ? +q.get(k) : d);
const vec = (k) => (q.has(k) ? new THREE.Vector3(...q.get(k).split(',').map(Number)) : null);

const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, logarithmicDepthBuffer: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(innerWidth, innerHeight, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = num('exposure', 0.6);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);

// The CSM lies along the world Z axis (nose toward -Z), +Y (hatch) up; the Moon is below (-Y).
const VIEWS = {
  three: { cam: [-8.5, 3.2, -9.5], target: [0, 0, 1.6], fov: 38, sunaz: -60 },
  front: { cam: [0.0, 1.2, -12], target: [0, 0, 0], fov: 32, sunaz: -30 },
  nose: { cam: [-2.4, 2.2, -6.2], target: [0, 0.2, -2.2], fov: 34, sunaz: -40 },
  side: { cam: [14, 0.8, 1.8], target: [0, 0, 1.8], fov: 38, sunaz: 60 },
  top: { cam: [0.5, 14, 1.8], target: [0, 0, 1.8], fov: 38, sunaz: -20, up: [0, 0, -1] },
  rear: { cam: [3.5, 2.8, 15], target: [0, 0, 4.5], fov: 36, sunaz: 150 },
  aft3: { cam: [-7, -2.5, 11], target: [0, 0, 3.5], fov: 38, sunaz: 130 },
  sps: { cam: [2.8, -1.2, 11.6], target: [0, 0, 6.2], fov: 34, sunaz: 120 },
  windows: { cam: [-2.2, 2.6, -4.6], target: [-0.3, 0.6, -1.3], fov: 30, sunaz: -50 },
  rv: { cam: [-1.3, 1.6, -3.9], target: [-0.75, 0.62, -1.45], fov: 24, sunaz: -40 },
  hatch: { cam: [0.4, 3.9, -3.2], target: [0, 1.1, -1.05], fov: 30, sunaz: -20 },
  quad: { cam: [-1.2, 3.4, -0.6], target: [0.27, 2.08, 1.35], fov: 30, sunaz: -60 },
  probe: { cam: [-1.2, 0.9, -5.2], target: [0, 0, -3.05], fov: 28, sunaz: -50 },
  decal: { cam: [-3.4, 4.35, 2.5], target: [-1.2, 1.54, 2.6], fov: 40, sunaz: -90, sunel: 40, up: [0, 0, -1] },
  hga: { cam: [-4.8, -3.2, 8.4], target: [-1.9, -1.6, 5.6], fov: 32, sunaz: 140 },
};
const V = VIEWS[q.get('view') || 'three'] || VIEWS.three;
const camera = new THREE.PerspectiveCamera(num('fov', V.fov), innerWidth / innerHeight, 0.01, 1e6);
camera.layers.enable(LAYERS.VESSEL);
camera.layers.enable(LAYERS.FX);
camera.layers.enable(LAYERS.CABIN);
camera.position.copy(vec('cam') || new THREE.Vector3(...V.cam));
if (V.up) camera.up.set(...V.up);
const target = vec('target') || new THREE.Vector3(...V.target);
camera.lookAt(target);

// ---- sun
const az = num('sunaz', V.sunaz) * Math.PI / 180;
const el = num('sunel', V.sunel ?? 12) * Math.PI / 180;
const sunDir = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
const sun = new THREE.DirectionalLight(SUN.color, SUN.intensity);
sun.position.copy(sunDir).multiplyScalar(40).add(new THREE.Vector3(0, 0, 2));
sun.target.position.set(0, 0, 2);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
sun.shadow.bias = -0.0002;
sun.shadow.normalBias = 0.02;
sun.shadow.camera.left = sun.shadow.camera.bottom = -8;
sun.shadow.camera.right = sun.shadow.camera.top = 8;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 90;
scene.add(sun, sun.target);

const useMoon = q.get('moon') !== '0';
// lunar-orbit fill: the Moon below reflects sunlight up at the spacecraft (~ as renderer.js)
const fill = new THREE.HemisphereLight(0x010102, 0xfff8ee, useMoon ? 0.12 * SUN.intensity * 0.66 * (0.25 + 0.75 * Math.sin(Math.max(el, 0.2))) : 0);
fill.position.set(0, 1, 0);
scene.add(fill);

// ---- environment: black sky + bright lunar ground (Moon below from ~110 km) + small sun spot
{
  const envScene = new THREE.Scene();
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: { uSun: { value: sunDir }, uI: { value: SUN.intensity }, uMoon: { value: useMoon ? 1 : 0 } },
    vertexShader: `
      #include <common>
      #include <logdepthbuf_pars_vertex>
      varying vec3 vDir;
      void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: `
      #include <common>
      #include <logdepthbuf_pars_fragment>
      uniform vec3 uSun; uniform float uI; uniform float uMoon; varying vec3 vDir;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      void main() {
        #include <logdepthbuf_fragment>
        vec3 d = normalize(vDir);
        vec3 col = vec3(0.0);
        // Moon seen from 110 km: limb ~ 19.5 deg below the horizontal
        if (uMoon > 0.5 && d.y < -0.33) {
          float mu0 = 0.35;
          float mu = max(-d.y, 0.02);
          float alpha = acos(clamp(dot(uSun, -d), -1.0, 1.0));
          float phase = exp(-0.9 * alpha) * (1.0 + 0.8 * exp(-alpha / 0.06));
          float mottling = 0.8 + 0.4 * hash(floor(d.xz * 40.0));
          col = vec3(1.0, 0.95, 0.89) * uI / PI * 0.12 * 2.0 * mu0 / (mu0 + mu) * phase * mottling;
        } else {
          col = vec3(1.0, 0.96, 0.9) * 60.0 * smoothstep(0.9997, 0.9999, dot(d, uSun));
        }
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  envScene.add(new THREE.Mesh(new THREE.SphereGeometry(50, 64, 32), mat));
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(envScene, 0, 0.1, 100).texture;
}

// ---- model with a fake vessel / context
const ctx = { THREE, renderer, scene, camera, sunLight: sun, fillLight: fill, LAYERS, quality: q.get('quality') || 'high', game: { events: { on() {} }, time: { frame: 0 } } };
const t0 = performance.now();
const model = createCSMModel(ctx);
const buildMs = performance.now() - t0;
scene.add(model.root);

const gim = (q.get('gimbal') || '0,0').split(',').map((x) => (+x * Math.PI) / 180);
const vessel = {
  pos: new THREE.Vector3(),
  quat: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), (num('roll', 0) * Math.PI) / 180),
  docked: q.get('docked') === '1',
  mainEngine: { firing: q.get('fire') === '1', throttle: 1, gimbal: new THREE.Vector2(gim[0], gim[1]) },
};
const frame = { origin: new THREE.Vector3(), time: 0, dt: 1 / 60, simDt: q.get('fire') === '1' ? 30 : 1 / 60, game: ctx.game };
// Earth: place it up-and-behind so the HGA points somewhere sensible in the studio
vessel.pos.set(-3.8e8, 0, 0);
frame.origin.copy(vessel.pos);
for (let i = 0; i < 4; i++) model.update(frame, vessel);
frame.simDt = 1 / 60;
if (q.get('iva') === '1') model.setIVA(true);

const info = document.getElementById('info');
let frames = 0;
function render() {
  frame.time += 1 / 60;
  model.update(frame, vessel);
  renderer.render(scene, camera);
  frames++;
  const st = model.stats();
  info.textContent = `CSM model  build ${buildMs.toFixed(0)} ms  tris ${st.triangles}  meshes ${st.meshes}  draw calls ${renderer.info.render.calls}  tex ${renderer.info.memory.textures}`;
  if (q.get('anim') === '1' || frames < 3) requestAnimationFrame(render);
  else window.__READY = true;
}
model.ready.then(() => requestAnimationFrame(render));
window.model = model;
window.csmStudio = { scene, camera, renderer, model, vessel };
