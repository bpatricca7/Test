// Film runtime: builds the world once, then renders any frame on demand via window.renderFrame(frame).
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { Sky, mood, mixMood, dirFromAngles } from './world/sky.js';
import { buildTerrain, heightAt } from './world/terrain.js';
import { buildJunk } from './world/junk.js';
import { buildNature } from './world/nature.js';
import { Effects } from './world/particles.js';
import { LAYOUT, shared } from './world/common.js';
import { Bolt } from './characters/bolt.js';
import { Luma } from './characters/luma.js';
import { Sprout, TinCan, WateringCan } from './characters/props.js';
import { GradeShader } from './post.js';
import { Overlay } from './overlay.js';
import { noise1 } from './lib/anim.js';

const params = new URLSearchParams(location.search);
const W = +params.get('w') || 1920;
const H = Math.round((W * 9) / 16);

await document.fonts.load('700 64px Fredoka');
await document.fonts.load('600 64px Fredoka');
await document.fonts.load('400 64px Fredoka');

const container = document.getElementById('stage');
container.style.width = W + 'px';
container.style.height = H + 'px';
const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(1);
renderer.setSize(W, H);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0xe6bb8c, 0.012);
const camera = new THREE.PerspectiveCamera(35, W / H, 0.03, 3000);

const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 3);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.02;
sun.shadow.radius = 3;
scene.add(sun);
scene.add(sun.target);
const fill = new THREE.DirectionalLight(0xffffff, 0);
fill.visible = false;
scene.add(fill);

const sky = new Sky(scene);
const terrain = buildTerrain(scene);
const junk = buildJunk(scene);
const nature = buildNature(scene);
const fx = new Effects(scene);

const bolt = new Bolt();
scene.add(bolt.root);
const luma = new Luma();
scene.add(luma.root);
const sprout = new Sprout();
const can = new TinCan();
scene.add(can.root);
scene.add(sprout.root);
const wcan = new WateringCan();
scene.add(wcan.root);

// Hero junk cubes Bolt makes and stacks (animated individually).
const heroCubes = [];
{
  const geo = new THREE.BoxGeometry(0.4, 0.4, 0.4);
  for (let i = 0; i < 6; i++) {
    const m = new THREE.Mesh(geo, junk.matA);
    m.castShadow = m.receiveShadow = true;
    scene.add(m);
    heroCubes.push(m);
  }
}
// small pieces of junk Bolt scoops up
const scraps = [];
{
  const geos = [new THREE.CylinderGeometry(0.05, 0.05, 0.14, 10), new THREE.BoxGeometry(0.16, 0.1, 0.12), new THREE.TorusGeometry(0.08, 0.03, 8, 14), new THREE.BoxGeometry(0.22, 0.02, 0.14)];
  const cols = ['#b84a3a', '#c8c8c0', '#3a3634', '#5a8ab0', '#d8b050', '#7a9a5a'];
  for (let i = 0; i < 10; i++) {
    const m = new THREE.Mesh(geos[i % geos.length], new THREE.MeshStandardMaterial({ color: cols[i % cols.length], roughness: 0.5, metalness: 0.5 }));
    m.castShadow = true;
    scene.add(m);
    scraps.push(m);
  }
}

// A squeaky rubber duck hiding in the junk pile.
const duck = new THREE.Group();
{
  const yellow = new THREE.MeshStandardMaterial({ color: '#ffd23a', roughness: 0.35 });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.075, 20, 14), yellow);
  body.scale.set(1.25, 0.85, 1);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.048, 16, 12), yellow);
  head.position.set(0.055, 0.075, 0);
  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.05, 10), new THREE.MeshStandardMaterial({ color: '#ff7a1a', roughness: 0.4 }));
  beak.rotation.z = -Math.PI / 2;
  beak.position.set(0.11, 0.07, 0);
  const eyeMat = new THREE.MeshBasicMaterial({ color: '#111111' });
  for (const z of [-0.028, 0.028]) {
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.009, 8, 6), eyeMat);
    e.position.set(0.085, 0.09, z);
    duck.add(e);
  }
  duck.add(body, head, beak);
  duck.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  scene.add(duck);
}

// Post-processing ---------------------------------------------------------
const rt = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, samples: +(params.get('msaa') ?? 0) });
const composer = new EffectComposer(renderer, rt);
composer.setPixelRatio(1);
composer.setSize(W, H);
composer.addPass(new RenderPass(scene, camera));
const bokeh = new BokehPass(scene, camera, { focus: 1, aperture: 0.02, maxblur: 0.01 });
bokeh.enabled = false;
composer.addPass(bokeh);
const bloomPass = new UnrealBloomPass(new THREE.Vector2(W / 2, H / 2), 0.55, 0.55, 0.82);
composer.addPass(bloomPass);
composer.addPass(new OutputPass());
const fxaa = new ShaderPass(FXAAShader);
fxaa.uniforms.resolution.value.set(1 / W, 1 / H);
composer.addPass(fxaa);
const grade = new ShaderPass(GradeShader);
composer.addPass(grade);
const G = grade.uniforms;

const overlay = new Overlay(container, W, H);

// Reflection environment per mood (cached, generated from the sky itself).
const pmrem = new THREE.PMREMGenerator(renderer);
const envScene = new THREE.Scene();
const envSky = new Sky(envScene);
const envCache = new Map();
function envFor(m) {
  const key = m.name;
  if (!envCache.has(key)) {
    applySkyUniforms(envSky.uniforms, m, 0);
    envSky.mesh.position.set(0, 0, 0);
    const rtEnv = pmrem.fromScene(envScene, 0.02);
    envCache.set(key, rtEnv.texture);
  }
  return envCache.get(key);
}

function applySkyUniforms(u, m, t) {
  u.uZenith.value.copy(m.zenith);
  u.uHorizon.value.copy(m.horizon);
  u.uGround.value.copy(m.ground);
  u.uSunDir.value.copy(dirFromAngles(m.sunEl, m.sunAz));
  u.uMoonDir.value.copy(dirFromAngles(m.moonEl, m.moonAz));
  u.uSunColor.value.copy(m.sunColor);
  u.uSunSize.value = m.sunSize;
  u.uSunGlow.value = m.sunGlow;
  u.uNight.value = m.night;
  u.uCloud.value = m.cloud;
  u.uCloudCol.value.copy(m.cloudCol);
  u.uCloudShade.value.copy(m.cloudShade);
  u.uHaze.value = m.haze;
  u.uMoon.value = m.moon;
  u.uTime.value = t;
}

const focus = new THREE.Vector3();
let shadowSize = 12;

const stage = {
  THREE, W, H, scene, camera, renderer, sky, sun, hemi, fill, terrain, junk, nature, fx, bolt, luma, sprout, can, wcan, heroCubes, scraps, duck,
  overlay, grade: G, bloomPass, composer, heightAt, LAYOUT, shared,
  mood,
  mixMood,
  setMood(m) {
    applySkyUniforms(sky.uniforms, m, stage.t);
    scene.fog.color.copy(m.fog);
    scene.fog.density = m.fogDensity;
    const sd = dirFromAngles(Math.max(m.sunEl, 4), m.sunAz);
    stage.sunDir = sd;
    sun.color.copy(m.lightColor);
    sun.intensity = m.light;
    if (m.sunEl < 0) {
      // moonlight: cool light from the moon's direction
      stage.sunDir = dirFromAngles(m.moonEl, m.moonAz);
    }
    hemi.color.copy(m.hemiSky);
    hemi.groundColor.copy(m.hemiGround);
    hemi.intensity = m.hemi;
    renderer.toneMappingExposure = m.exposure;
    bloomPass.strength = m.bloom;
    scene.environment = envFor(m);
    scene.environmentIntensity = 0.6 * Math.min(1, m.hemi);
    stage.currentMood = m;
  },
  shadowFocus(x, z, size = 12) {
    focus.set(x, heightAt(x, z), z);
    shadowSize = size;
  },
  cam(pos, target, fov = 35, roll = 0) {
    camera.position.set(pos[0], Math.max(pos[1], heightAt(pos[0], pos[2]) + 0.12), pos[2]);
    camera.up.set(0, 1, 0);
    camera.lookAt(target[0], target[1], target[2]);
    if (roll) camera.rotateZ(roll);
    if (camera.fov !== fov) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
  },
  // Depth of field for close-ups: focus distance in world units.
  dof(focus, aperture = 0.02, maxblur = 0.012) {
    bokeh.enabled = params.get('dof') !== '0';
    bokeh.uniforms.focus.value = focus;
    bokeh.uniforms.aperture.value = aperture;
    bokeh.uniforms.maxblur.value = maxblur;
  },
  shake(amount, speed = 0.6) {
    const t = stage.t * speed;
    camera.rotateX(noise1(t * 3.1 + 11) * amount * 0.01);
    camera.rotateY(noise1(t * 2.7 + 23) * amount * 0.01);
    camera.rotateZ(noise1(t * 1.9 + 37) * amount * 0.004);
  },
  ground: (x, z) => heightAt(x, z),
};
window.stage = stage;

function resetStage(t) {
  stage.t = t;
  shared.uTime.value = t;
  shared.uBloomRadius.value = -20;
  shared.uFrontGlow.value = 0;
  shared.uWind.value = 1;
  terrain.uniforms.uSoil.value.w = 0;
  bolt.root.visible = false;
  luma.root.visible = false;
  sprout.root.visible = false;
  can.root.visible = false;
  wcan.root.visible = false;
  nature.hero.root.visible = false;
  for (const c of heroCubes) c.visible = false;
  for (const s of scraps) { s.visible = false; s.scale.setScalar(1); s.rotation.set(0, 0, 0); }
  for (const b of nature.butterflies.list) b.obj.visible = false;
  duck.visible = false;
  G.uFade.value = 0;
  G.uIris.value = 2;
  G.uVignette.value = 0.35;
  G.uSaturation.value = 1.08;
  G.uContrast.value = 1.04;
  G.uLift.value.set(0, 0, 0);
  G.uGain.value.set(1, 1, 1);
  G.uTime.value = t;
  fill.intensity = 0;
  fill.visible = false;
  bokeh.enabled = false;
  overlay.reset();
  fx.begin();
  stage.shadowFocus(0, 0, 12);
}

const { SHOTS, FPS, DURATION } = await import('./story/shots.js');
stage.FPS = FPS;

window.renderFrame = (frame) => {
  const t = frame / FPS;
  resetStage(t);
  const shot = SHOTS.find((s) => t >= s.start && t < s.end) || SHOTS[SHOTS.length - 1];
  shot.update(stage, t - shot.start, t);
  nature.update(t);
  // sun + shadow camera follow the current focus
  const sd = stage.sunDir || new THREE.Vector3(0, 1, 0);
  sun.target.position.copy(focus);
  sun.position.copy(focus).addScaledVector(sd, 80);
  const sc = sun.shadow.camera;
  sc.left = -shadowSize; sc.right = shadowSize; sc.top = shadowSize; sc.bottom = -shadowSize;
  sc.near = 1; sc.far = 200;
  sc.updateProjectionMatrix();
  fill.position.copy(camera.position).add(new THREE.Vector3(0, 2, 0));
  fill.target.position.copy(focus);
  sky.follow(camera);
  fx.end(camera, H);
  composer.render();
  return shot.name;
};
window.filmInfo = { FPS, DURATION, frames: Math.round(DURATION * FPS), shots: SHOTS.map((s) => ({ name: s.name, start: s.start, end: s.end })) };
window.layoutInfo = () => {
  const out = { towers: junk.towers.map((t) => [t.x, t.z, t.n, t.layers]), debris: [], cubes: [] };
  const m = new THREE.Matrix4(), p = new THREE.Vector3();
  junk.group.traverse((o) => {
    if (!o.isInstancedMesh) return;
    for (let i = 0; i < o.count; i++) {
      o.getMatrixAt(i, m);
      p.setFromMatrixPosition(m);
      if (Math.hypot(p.x, p.z) < 16 && p.y < 1.2) out[o.geometry.type === 'BoxGeometry' && o.geometry.parameters.width === 1 ? 'cubes' : 'debris'].push([+p.x.toFixed(2), +p.z.toFixed(2)]);
    }
  });
  return out;
};
window.ready = true;
