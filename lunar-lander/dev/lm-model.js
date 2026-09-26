// LM-MODEL studio harness: renders the LM exterior with a low Sun, a black sky and a lunar-ground
// environment map (like scene.environment in the game), with camera presets for screenshots.
import * as THREE from 'three';
import { LAYERS, SUN, LM } from '../src/core/constants.js';
import { createLMModel } from '../src/render/models/lm/lmModel.js';
import { lmFootpads } from '../src/core/constants.js';

const q = new URLSearchParams(location.search);
const num = (k, d) => (q.has(k) ? +q.get(k) : d);
const vec = (k) => (q.has(k) ? new THREE.Vector3(...q.get(k).split(',').map(Number)) : null);

const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, logarithmicDepthBuffer: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(innerWidth, innerHeight, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = num('exposure', 0.55);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);

// ---- views
const VIEWS = {
  three: { cam: [-9.5, 5.2, -11.5], target: [0, 3.0, 0], fov: 36, sunaz: -35 },
  front: { cam: [0, 3.9, -16], target: [0, 3.4, 0], fov: 36, sunaz: -20 },
  side: { cam: [16, 3.9, 0.5], target: [0, 3.2, 0], fov: 36, sunaz: 70 },
  rear: { cam: [3, 4.2, 16], target: [0, 3.3, 0], fov: 36, sunaz: 160 },
  aft: { cam: [9, 6.5, 10], target: [0, 3.6, 0], fov: 36, sunaz: 130 },
  top: { cam: [0.01, 24, 0.01], target: [0, 0, 0], fov: 36, sunaz: -40, up: [0, 0, -1] },
  top3: { cam: [-6, 12, -8], target: [0, 4, 0], fov: 36, sunaz: -60 },
  under: { cam: [5.5, -2.2, -6], target: [0, 1.6, 0], fov: 40, sunaz: -30, ground: 0 },
  window: { cam: [-1.3, 5.9, -3.6], target: [0, 5.0, -1.2], fov: 32, sunaz: -30 },
  hatch: { cam: [-0.8, 4.2, -4.2], target: [0, 3.9, -1.3], fov: 34, sunaz: -25 },
  quad: { cam: [-3.1, 5.6, -3.4], target: [-1.5, 4.8, -1.5], fov: 30, sunaz: -50 },
  foil: { cam: [-3.4, 2.7, -3.0], target: [-1.2, 2.3, -1.2], fov: 34, sunaz: -60 },
  leg: { cam: [-2.4, 2.8, -7.2], target: [0, 2.0, -3.0], fov: 40, sunaz: -25 },
  pad: { cam: [6.8, 1.3, -2.4], target: [4.4, 0.4, 0.0], fov: 34, sunaz: 60 },
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
const el = num('sunel', 12) * Math.PI / 180;
const sunDir = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
const sun = new THREE.DirectionalLight(SUN.color, SUN.intensity);
sun.position.copy(sunDir).multiplyScalar(40).add(new THREE.Vector3(0, 3, 0));
sun.target.position.set(0, 3, 0);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
sun.shadow.bias = -0.0002;
sun.shadow.normalBias = 0.02;
sun.shadow.camera.left = sun.shadow.camera.bottom = -7;
sun.shadow.camera.right = sun.shadow.camera.top = 7;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 90;
sun.shadow.camera.layers.enableAll();
scene.add(sun, sun.target);

const useGround = q.has('ground') ? q.get('ground') !== '0' : V.ground !== 0;
const fill = new THREE.HemisphereLight(0x010101, 0xfff8ee, useGround ? 0.12 * SUN.intensity * (0.25 + 0.75 * Math.sin(el)) : 0.08 * SUN.intensity);
fill.position.set(0, 1, 0);
scene.add(fill);

// ---- environment: black sky + bright lunar ground + small sun spot (like the sky module)
{
  const envScene = new THREE.Scene();
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: { uSun: { value: sunDir }, uI: { value: SUN.intensity } },
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
      uniform vec3 uSun; uniform float uI; varying vec3 vDir;
      void main() {
        #include <logdepthbuf_fragment>
        vec3 d = normalize(vDir);
        vec3 col = vec3(0.0);
        if (d.y < -0.004) {
          float mu0 = max(uSun.y, 0.0);
          float mu = max(-d.y, 0.02);
          float alpha = acos(clamp(dot(uSun, -d), -1.0, 1.0));
          float phase = exp(-0.9 * alpha) * (1.0 + 0.8 * exp(-alpha / 0.06));
          col = vec3(1.0, 0.95, 0.89) * uI / PI * 0.12 * 2.0 * mu0 / (mu0 + mu) * phase;
        } else {
          col = vec3(1.0, 0.96, 0.9) * 60.0 * smoothstep(0.9997, 0.9999, dot(d, uSun));
        }
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  envScene.add(new THREE.Mesh(new THREE.SphereGeometry(50, 64, 32), mat));
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = useGround || true ? pmrem.fromScene(envScene, 0, 0.1, 100).texture : null;
}

// ---- ground
if (useGround) {
  const g = new THREE.Mesh(new THREE.CircleGeometry(60, 64), new THREE.MeshStandardMaterial({ color: new THREE.Color(0.13, 0.125, 0.12), roughness: 1, metalness: 0 }));
  g.rotation.x = -Math.PI / 2;
  g.position.y = -0.002;
  g.receiveShadow = true;
  scene.add(g);
}

// ---- model with a fake vessel / context
const events = { on() {} };
const ctx = { THREE, renderer, scene, camera, sunLight: sun, fillLight: fill, LAYERS, quality: q.get('quality') || 'high', game: { events } };
const t0 = performance.now();
const model = createLMModel(ctx);
const buildMs = performance.now() - t0;
scene.add(model.root);

const vessel = {
  pos: new THREE.Vector3(),
  quat: new THREE.Quaternion(),
  cg: LM.cgDescentProp.clone(),
  staged: q.get('staged') === '1',
  descentStage: null,
  landed: q.get('fold') === '1',
  tel: { altitude: useGround ? 2.2 : 1e5 },
  gear: { pads: lmFootpads().map((p) => ({ ...p, compression: num('compress', 0), contact: q.get('fold') === '1' })) },
};
if (vessel.staged) {
  vessel.descentStage = { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), landed: true };
  vessel.pos.set(0, 5, 0);
}
const frame = { origin: new THREE.Vector3(), time: 0.02 };
model.update(frame, vessel);
if (q.get('iva') === '1') model.setIVA(true);

const info = document.getElementById('info');
let frames = 0;
function render() {
  if (q.get('anim') === '1') {
    const a = performance.now() * 0.0002;
    const r = camera.position.distanceTo(target);
    camera.position.set(Math.sin(a) * r, camera.position.y, -Math.cos(a) * r);
    camera.lookAt(target);
  }
  frame.time += 1 / 60;
  model.update(frame, vessel);
  renderer.render(scene, camera);
  frames++;
  const st = model.stats();
  info.textContent = `LM model  build ${buildMs.toFixed(0)} ms  tris ${st.triangles}  meshes ${st.meshes}  draw calls ${renderer.info.render.calls}  tex ${renderer.info.memory.textures}`;
  if (q.get('anim') === '1' || frames < 3) requestAnimationFrame(render);
  else window.__READY = true;
}
model.ready.then(() => requestAnimationFrame(render));
window.model = model;
window.lmStudio = { scene, camera, renderer, model, vessel };
