// CSM-CABIN harness: the real cabin module in lunar orbit over a bright fake Moon, with the real
// renderer (sunlight + IVA shadow box) and post-processing (auto exposure). See csm-cabin.html.
import * as THREE from 'three';
import { createGameState, readParams } from '../src/core/state.js';
import { MOON, CSM, LM, FT, LAYERS } from '../src/core/constants.js';
import { SUN_DIR } from '../src/core/frames.js';
import { createRenderer } from '../src/render/renderer.js';
import { createPost } from '../src/render/post.js';
import { createCSMCabin } from '../src/render/cockpit/csmCabin.js';
import { stationEye } from '../src/render/cockpit/csm/layout.js';

const q = new URLSearchParams(location.search);
const num = (k, d) => (q.has(k) ? +q.get(k) : d);
const params = readParams('?quality=' + (q.get('quality') || 'high'));
const game = createGameState(params);
game.started = true;
game.activeId = 'CSM';
window.game = game;
const R = createRenderer(document.getElementById('scene'), game);
const { ctx, scene } = R;
const usePost = q.get('post') !== '0';
const post = usePost ? createPost(ctx) : null;
if (post && q.has('exposure')) post.exposure.override = +q.get('exposure');
const night = q.get('night') === '1';

const C = game.vessels.CSM;
const Lv = game.vessels.LM;
const ALT = num('alt', 111000);

// ---------------------------------------------------------------- attitude (TRIAD from body sun / nadir)
const bodyDir = (s, def) => {
  const W = CSM.windows;
  const presets = {
    sideLeft: W.sideLeft.normal.clone().add(new THREE.Vector3(0.1, 0.25, -0.1)),
    sideRight: W.sideRight.normal.clone().add(new THREE.Vector3(-0.1, 0.25, -0.1)),
    hatch: W.hatch.normal.clone().add(new THREE.Vector3(0.25, 0, 0.1)),
    rvLeft: W.rendezvousLeft.normal.clone().add(new THREE.Vector3(0.05, 0.05, 0)),
    rvRight: W.rendezvousRight.normal.clone().add(new THREE.Vector3(-0.05, 0.05, 0)),
    fwd: new THREE.Vector3(0, 0.3, -1),
    left: new THREE.Vector3(-1, 0.2, -0.3),
    right: new THREE.Vector3(1, 0.2, -0.3),
    aft: new THREE.Vector3(0, 0, 1),
    none: new THREE.Vector3(0, 0, 1),
  };
  const v = s ? presets[s] || new THREE.Vector3(...s.split(',').map(Number)) : presets[def];
  return v.clone().normalize();
};
const sunName = night ? 'none' : q.get('sun') || 'sideLeft';
const sunB = bodyDir(sunName, 'sideLeft');
const nadirB = bodyDir(q.get('moon'), 'hatch');
const sunEl = num('sunEl', sunName === 'none' ? -30 : 25) * THREE.MathUtils.DEG2RAD;
// spacecraft position: local up makes the requested angle with the Sun
const perp = new THREE.Vector3().crossVectors(SUN_DIR, new THREE.Vector3(0, 0, 1)).normalize();
const up = SUN_DIR.clone().multiplyScalar(Math.sin(sunEl)).addScaledVector(perp, Math.cos(sunEl)).normalize();
C.pos.copy(up).multiplyScalar(MOON.radius + ALT);
function triad(b1, b2, w1, w2) {
  const t = (a, b) => {
    const x = a.clone().normalize();
    const y = new THREE.Vector3().crossVectors(a, b).normalize();
    const z = new THREE.Vector3().crossVectors(x, y);
    return new THREE.Matrix4().makeBasis(x, y, z);
  };
  const B = t(b1, b2);
  const Wm = t(w1, w2);
  const Rm = Wm.multiply(B.transpose());
  return new THREE.Quaternion().setFromRotationMatrix(Rm);
}
const baseQuat = sunName === 'none'
  ? triad(nadirB, new THREE.Vector3(0, 0, -1), up.clone().negate(), SUN_DIR)
  : triad(sunB, nadirB, SUN_DIR, up.clone().negate());

// ---------------------------------------------------------------- fake Moon (sphere) + environment
{
  const envScene = new THREE.Scene();
  const sph = new THREE.Mesh(
    new THREE.SphereGeometry(10, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: { uUp: { value: up.clone() } },
      vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 uUp; varying vec3 vP; void main(){ float h = dot(normalize(vP), uUp); vec3 c = mix(vec3(0.0), vec3(0.12,0.115,0.11), smoothstep(-0.2,-0.4,h)); gl_FragColor = vec4(c,1.0); }',
    }),
  );
  envScene.add(sph);
  const sun = new THREE.Mesh(new THREE.SphereGeometry(0.35, 16, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(60, 58, 55) }));
  sun.position.copy(SUN_DIR).multiplyScalar(8);
  envScene.add(sun);
  const pm = new THREE.PMREMGenerator(R.renderer);
  scene.environment = pm.fromScene(envScene, 0.02).texture;
}
const moonMat = new THREE.ShaderMaterial({
  uniforms: { uSun: { value: SUN_DIR.clone() }, uCenter: { value: new THREE.Vector3() } },
  vertexShader: `
    #include <common>
    #include <logdepthbuf_pars_vertex>
    varying vec3 vW; varying vec3 vN;
    void main(){ vec4 w = modelMatrix*vec4(position,1.0); vW = w.xyz; vN = normalize(position); gl_Position = projectionMatrix*viewMatrix*w;
    #include <logdepthbuf_vertex>
    }`,
  fragmentShader: `
    #include <logdepthbuf_pars_fragment>
    uniform vec3 uSun; varying vec3 vW; varying vec3 vN;
    float h31(vec3 p){ return fract(sin(dot(p, vec3(127.1,311.7,74.7)))*43758.5453); }
    float n3(vec3 p){ vec3 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
      return mix(mix(mix(h31(i),h31(i+vec3(1,0,0)),f.x), mix(h31(i+vec3(0,1,0)),h31(i+vec3(1,1,0)),f.x), f.y),
                 mix(mix(h31(i+vec3(0,0,1)),h31(i+vec3(1,0,1)),f.x), mix(h31(i+vec3(0,1,1)),h31(i+vec3(1,1,1)),f.x), f.y), f.z); }
    void main(){
      #include <logdepthbuf_fragment>
      vec3 n = normalize(vN);
      vec3 p = n * 600.0;
      vec3 g = vec3(n3(p*1.0)-0.5, n3(p*1.0+7.0)-0.5, n3(p*1.0+13.0)-0.5) + 0.5*vec3(n3(p*4.0)-0.5, n3(p*4.0+3.0)-0.5, n3(p*4.0+5.0)-0.5);
      vec3 nn = normalize(n + (g - n*dot(g,n))*0.35);
      float mu0 = max(0.0, dot(nn, uSun));
      vec3 v = normalize(-vW); float mu = max(0.05, dot(n, v));
      float alb = 0.1 + 0.05*n3(p*0.05) + 0.03*n3(p*0.4);
      float ls = 2.0*mu0/(mu0+mu);
      vec3 col = vec3(1.0,0.97,0.93) * alb * 7.0 * ls / 3.14159;
      gl_FragColor = vec4(col, 1.0);
    }`,
});
const moon = new THREE.Mesh(new THREE.SphereGeometry(MOON.radius, 256, 128), moonMat);
moon.frustumCulled = false;
scene.add(moon);

// ---------------------------------------------------------------- optional docked LM (real model)
let lmModel = null;
if (q.get('lm') === '1') {
  const { createLMModel } = await import('../src/render/models/lm/lmModel.js');
  lmModel = createLMModel(ctx);
  scene.add(lmModel.root);
}
const REL_Q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
const REL_P = CSM.docking.port.clone().sub(LM.docking.port.clone().applyQuaternion(REL_Q));

// ---------------------------------------------------------------- cabin
const cabin = createCSMCabin(ctx);
scene.add(cabin.root);
cabin.setActive(true);

// ---------------------------------------------------------------- fake vessel state
let T = num('t', 20);
const animate = q.get('anim') !== '0';
function fake(t) {
  const v = C;
  game.time.met = 102 * 3600 + 32 * 60 + 5 + t;
  const k = animate ? 1 : 0;
  v.quat.copy(baseQuat).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0.004 * Math.sin(t * 0.2) * k, 0.004 * Math.sin(t * 0.13) * k, 0.003 * Math.sin(t * 0.17) * k)));
  v.angVel.set(0.004 * Math.cos(t * 0.3), 0.003 * Math.sin(t * 0.4), -0.002 * Math.cos(t * 0.2));
  v.gnc.attError.set(1.2 * Math.sin(t * 0.5), -0.8 * Math.cos(t * 0.37), 1.5 * Math.sin(t * 0.23));
  v.vel.copy(new THREE.Vector3().crossVectors(new THREE.Vector3(0, 0, 1), up).normalize().multiplyScalar(1630));
  v.tel.altitude = ALT;
  v.tel.vSpeed = 0.3;
  v.tel.orbitalSpeed = 1630;
  const firing = q.get('burn') === '1';
  v.mainEngine.firing = firing;
  v.mainEngine.throttle = firing ? 1 : 0;
  v.mainEngine.armed = true;
  v.mainEngine.gimbal.set(0.01 * Math.sin(t), -0.008 * Math.cos(t * 0.7));
  v.propellant.main = CSM.spsPropMax * 0.62;
  v.propellant.rcs = CSM.rcsPropMax * 0.71;
  v.gnc.program = 'P00';
  v.gnc.rcsMode = Math.floor(t / 8) % 3 === 2 ? 'PULSE' : 'RATE';
  v.gnc.autopilot = 'OFF';
  v.docked = q.get('lm') === '1';
  const a = v.agc;
  a.prog = '00';
  a.verb = '16';
  a.noun = '65';
  a.r1 = '+' + String(Math.floor(game.time.met / 3600)).padStart(5, '0');
  a.r2 = '+000' + String(Math.floor((game.time.met % 3600) / 60)).padStart(2, '0');
  a.r3 = '+0' + String(Math.floor(game.time.met % 60) * 100).padStart(4, '0');
  a.lights.compActy = (t * 5) % 1 < 0.35;
  v.cw.masterAlarm = Math.floor(t / 6) % 3 === 0;
  v.cw.lights['SPS PRESS'] = false;
  v.cw.lights.CMC = Math.floor(t / 6) % 3 === 0;
  const c = v.ctrl;
  c.pitch = 0.8 * Math.sin(t * 0.9) * k;
  c.roll = 0.6 * Math.sin(t * 0.7 + 1) * k;
  c.yaw = 0.5 * Math.sin(t * 0.5 + 2) * k;
  c.transFwd = 0.8 * Math.sin(t * 0.6) * k;
  c.transRight = 0.6 * Math.cos(t * 0.8) * k;
  c.transUp = 0.5 * Math.sin(t * 0.45) * k;
  if (q.has('pitchCmd')) c.pitch = +q.get('pitchCmd');
  if (q.has('rollCmd')) c.roll = +q.get('rollCmd');
  if (q.has('yawCmd')) c.yaw = +q.get('yawCmd');
  // docked LM
  if (lmModel) {
    Lv.quat.copy(v.quat).multiply(REL_Q);
    Lv.pos.copy(REL_P).applyQuaternion(v.quat).add(v.pos);
    Lv.docked = true;
  }
}

// ---------------------------------------------------------------- camera
const station = (q.get('station') || 'CDR').toUpperCase();
let eyeB = stationEye(station);
const cam = { yaw: num('yaw', 0), pitch: num('pitch', -8) };
if (station === 'RV' && !q.has('yaw')) {
  // look along the rendezvous window normal
  const n = CSM.windows.rendezvousLeft.normal.clone().normalize();
  cam.yaw = Math.atan2(-n.x, -n.z) * THREE.MathUtils.RAD2DEG;
  cam.pitch = Math.asin(n.y) * THREE.MathUtils.RAD2DEG;
}
game.view.mode = 'iva';
game.view.ivaVessel = 'CSM';
game.view.station = station;
game.view.fov = num('fov', station === 'RV' ? 55 : 75);
game.view.near = 0.01;
{
  let drag = false;
  let lx = 0;
  let ly = 0;
  const el = R.renderer.domElement;
  el.addEventListener('mousedown', (e) => { drag = true; lx = e.clientX; ly = e.clientY; });
  addEventListener('mouseup', () => (drag = false));
  addEventListener('mousemove', (e) => {
    if (!drag) return;
    cam.yaw -= (e.clientX - lx) * 0.2;
    cam.pitch -= (e.clientY - ly) * 0.2;
    lx = e.clientX;
    ly = e.clientY;
  });
  el.addEventListener('wheel', (e) => { game.view.fov = Math.max(15, Math.min(100, game.view.fov * Math.exp(e.deltaY * 0.001))); });
}

const info = document.getElementById('info');
const qCam = new THREE.Quaternion();
let frames = 0;
let last = performance.now();
function tick(now) {
  requestAnimationFrame(tick);
  const dt = q.get('fixedstep') === '0' ? Math.min(0.1, (now - last) / 1000) : 1 / 60;
  last = now;
  if (animate) T += dt;
  fake(T);
  game.view.cameraMCI.copy(eyeB).applyQuaternion(C.quat).add(C.pos);
  qCam.setFromEuler(new THREE.Euler(cam.pitch * THREE.MathUtils.DEG2RAD, cam.yaw * THREE.MathUtils.DEG2RAD, 0, 'YXZ'));
  game.view.quat.copy(C.quat).multiply(qCam);
  const f = R.beginFrame({ realDt: dt, simDt: dt });
  moon.position.set(0, 0, 0).sub(f.origin);
  if (lmModel) {
    lmModel.setIVA(false);
    lmModel.update(f, Lv);
  }
  cabin.update(f, C);
  if (post) post.render(f);
  else R.renderer.render(scene, ctx.camera);
  frames++;
  if (frames === 6) window.__READY = true;
  if (q.get('info') === '1' && frames % 10 === 0) {
    const s = cabin.stats ? cabin.stats() : {};
    info.textContent = `${station} yaw ${cam.yaw.toFixed(0)} pitch ${cam.pitch.toFixed(0)}  calls ${R.renderer.info.render.calls}  tris ${R.renderer.info.render.triangles}  cabin tris ${s.triangles} meshes ${s.meshes}`;
  }
}
requestAnimationFrame(tick);
window.H = {
  cabin, cam, game, ctx, R, LAYERS, FT,
  /** Set the view: {yaw, pitch, fov, station}. */
  setView(o) {
    if (o.station) {
      eyeB = stationEye(o.station.toUpperCase());
      game.view.station = o.station.toUpperCase();
    }
    if (o.yaw != null) cam.yaw = +o.yaw;
    if (o.pitch != null) cam.pitch = +o.pitch;
    if (o.fov != null) game.view.fov = +o.fov;
  },
};
