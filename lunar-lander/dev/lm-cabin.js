// LM-CABIN harness: the real cabin module over a fake bright lunar surface, with the real renderer
// (sunlight + IVA shadow box) and post-processing (auto exposure).
import * as THREE from 'three';
import { createGameState, readParams } from '../src/core/state.js';
import { MOON, LM, FT, LAYERS } from '../src/core/constants.js';
import { SITE_DIR, localENU, SUN_DIR } from '../src/core/frames.js';
import { createRenderer } from '../src/render/renderer.js';
import { createPost } from '../src/render/post.js';
import { createLMCabin } from '../src/render/cockpit/lmCabin.js';

const q = new URLSearchParams(location.search);
const num = (k, d) => (q.has(k) ? +q.get(k) : d);
const params = readParams('?quality=' + (q.get('quality') || 'high'));
const game = createGameState(params);
game.started = true;
window.game = game;
const R = createRenderer(document.getElementById('scene'), game);
const { ctx, scene } = R;
const usePost = q.get('post') !== '0';
const post = usePost ? createPost(ctx) : null;
if (post && q.has('exposure')) post.exposure.override = +q.get('exposure');

let att = q.get('att') || 'p64';
const LMv = game.vessels.LM;
const alt0 = num('alt', { p64: 900, landed: 0, pdi: 14000, orbit: 110000 }[att] ?? 900);
const siteR = MOON.radius;
LMv.pos.copy(SITE_DIR).multiplyScalar(siteR + alt0 + (att === 'landed' ? 0 : 0));
const { east, north, up } = localENU(LMv.pos);

// ---------------------------------------------------------------- fake outside: ground + env
{
  const envScene = new THREE.Scene();
  const sph = new THREE.Mesh(
    new THREE.SphereGeometry(10, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: { uUp: { value: up.clone() } },
      vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 uUp; varying vec3 vP; void main(){ float h = dot(normalize(vP), uUp); vec3 c = mix(vec3(0.0), vec3(0.12,0.115,0.11), smoothstep(0.02,-0.06,h)); gl_FragColor = vec4(c,1.0); }',
    }),
  );
  envScene.add(sph);
  const sun = new THREE.Mesh(new THREE.SphereGeometry(0.35, 16, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(60, 58, 55) }));
  sun.position.copy(SUN_DIR).multiplyScalar(8);
  envScene.add(sun);
  const pm = new THREE.PMREMGenerator(R.renderer);
  scene.environment = pm.fromScene(envScene, 0.02).texture;
}
const groundMat = new THREE.ShaderMaterial({
  uniforms: { uSun: { value: SUN_DIR.clone() }, uUp: { value: up.clone() }, uEast: { value: east.clone() }, uNorth: { value: north.clone() }, uCam: { value: new THREE.Vector3() }, uOrigin: { value: new THREE.Vector3() } },
  vertexShader: `
    #include <common>
    #include <logdepthbuf_pars_vertex>
    varying vec3 vW; varying vec2 vL;
    void main(){ vec4 w = modelMatrix*vec4(position,1.0); vW = w.xyz; vL = position.xy; gl_Position = projectionMatrix*viewMatrix*w;
    #include <logdepthbuf_vertex>
    }`,
  fragmentShader: `
    #include <logdepthbuf_pars_fragment>
    uniform vec3 uSun; uniform vec3 uUp; varying vec3 vW; varying vec2 vL;
    float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
    float n2(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(h21(i),h21(i+vec2(1,0)),f.x), mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x), f.y); }
    // crater field: slopes from bowl-shaped craters on a jittered grid
    vec2 craters(vec2 p, float s){ vec2 g = floor(p/s); vec2 grad = vec2(0.0);
      for(int i=-1;i<=1;i++) for(int j=-1;j<=1;j++){ vec2 c = g+vec2(i,j); float r = h21(c)*0.45*s+0.05*s; vec2 ctr=(c+vec2(h21(c+3.1),h21(c+7.7)))*s; vec2 d=p-ctr; float l=length(d);
        if(l<r*1.3){ float k = l/r; float sl = k<1.0 ? k*0.9 : -(1.3-k)*2.0; grad += normalize(d+1e-4)*sl*0.5; } }
      return grad; }
    void main(){
      #include <logdepthbuf_fragment>
      vec2 p = vL;
      vec2 g = craters(p, 60.0) + 0.6*craters(p, 17.0) + 0.35*craters(p, 5.0) + vec2(n2(p*0.3)-0.5, n2(p*0.3+9.0)-0.5)*0.3;
      vec3 e = normalize(cross(uUp, vec3(0.0,0.0,1.0))); vec3 nn = normalize(cross(uUp, e));
      vec3 n = normalize(uUp - (e*g.x + nn*g.y)*0.35);
      float mu0 = max(0.0, dot(n, uSun));
      vec3 v = normalize(-vW); float mu = max(0.05, dot(n, v));
      float alb = 0.11 + 0.04*n2(p*0.02) + 0.02*n2(p*0.3);
      float ls = 2.0*mu0/(mu0+mu); // Lommel-Seeliger
      float phase = 1.0 + 0.6*pow(max(0.0, dot(v, uSun)), 8.0);
      vec3 col = vec3(1.0,0.97,0.93) * alb * 7.0 * ls * phase / 3.14159 * 0.9;
      gl_FragColor = vec4(col, 1.0);
    }`,
});
const ground = new THREE.Mesh(new THREE.PlaneGeometry(60000, 60000, 1, 1), groundMat);
ground.frustumCulled = false;
scene.add(ground);
const groundQ = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(east, north, up));
const groundMCI = SITE_DIR.clone().multiplyScalar(siteR);

// ---------------------------------------------------------------- cabin
const cabin = createLMCabin(ctx);
scene.add(cabin.root);
cabin.setActive(true);
for (const k of (q.get('hide') || '').split(',').filter(Boolean)) if (cabin.parts[k]?.group) cabin.parts[k].group.visible = false;

// ---------------------------------------------------------------- attitude presets
function attitude(t) {
  // approach flying WEST (Sun behind, from the east), windows forward
  const west = east.clone().negate();
  let pitch = 0; // forward axis elevation above horizon (deg)
  let roll = 0;
  let yawDeg = 0;
  if (att === 'p64') pitch = -38 + 3 * Math.sin(t * 0.3); // windows look forward-down at the surface
  else if (att === 'landed') pitch = -90 + 4.5; // upright (forward axis horizontal): pitch here = tilt
  else if (att === 'pdi') pitch = 0; // windows down (face down), engine forward
  else if (att === 'orbit') pitch = 0;
  roll = 2 * Math.sin(t * 0.21);
  yawDeg = 3 * Math.sin(t * 0.13);
  const D = THREE.MathUtils.DEG2RAD;
  let fwd;
  let upB;
  if (att === 'landed') {
    // upright on the surface: +Y along local up, -Z toward the west, small tilt
    upB = up.clone().applyAxisAngle(north, 0.04);
    fwd = west.clone().applyAxisAngle(up, yawDeg * D * 0.2);
  } else if (att === 'pdi' || att === 'orbit') {
    // face down, windows toward the ground, thrust axis forward (east->west flight: thrust retrograde = east)
    fwd = up.clone().negate().applyAxisAngle(north, 0.25);
    upB = east.clone();
  } else {
    // P64: thrust axis tilted back (toward the east) ~ 40 deg from vertical; windows look ahead/down
    const tilt = (-pitch - 0) * D;
    upB = up.clone().multiplyScalar(Math.cos(tilt * 0.9)).addScaledVector(east, Math.sin(tilt * 0.9));
    fwd = west.clone().multiplyScalar(Math.cos(tilt * 0.9)).addScaledVector(up, Math.sin(tilt * 0.9));
  }
  const z = fwd.clone().normalize().negate();
  const x = new THREE.Vector3().crossVectors(upB, z).normalize();
  const y = new THREE.Vector3().crossVectors(z, x);
  const qv = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
  qv.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yawDeg * D, roll * D)));
  // heading: turn the whole vehicle about the local vertical (e.g. heading=180 faces the Sun)
  qv.premultiply(new THREE.Quaternion().setFromAxisAngle(up, num('heading', 0) * D));
  return qv;
}

// ---------------------------------------------------------------- fake vessel state
let T = num('t', 20);
const animate = q.get('anim') !== '0';
function fake(t) {
  const L = LMv;
  game.time.met = 102 * 3600 + 43 * 60 + 5 + t;
  L.quat.copy(attitude(t));
  L.angVel.set(0.01 * Math.cos(t * 0.3), 0.01 * Math.sin(t * 0.4), -0.008 * Math.cos(t * 0.2));
  L.gnc.attError.set(1.5 * Math.sin(t * 0.5), -1.2 * Math.cos(t * 0.37), 2 * Math.sin(t * 0.23));
  const alt = att === 'landed' ? 0 : alt0;
  L.tel.altitude = alt;
  L.tel.radarAltitude = alt;
  L.tel.vSpeed = att === 'landed' ? 0 : -6 - 2 * Math.sin(t * 0.3);
  L.tel.hSpeed = att === 'landed' ? 0 : 18;
  L.tel.twr = att === 'landed' ? 0 : 1.1;
  L.vel.copy(east).multiplyScalar(-L.tel.hSpeed).addScaledVector(up, L.tel.vSpeed);
  const firing = att !== 'landed' && att !== 'orbit';
  L.mainEngine.firing = firing;
  L.mainEngine.throttle = firing ? 0.45 + 0.05 * Math.sin(t * 0.4) : 0;
  L.mainEngine.throttleCmd = L.mainEngine.throttle + 0.02;
  L.mainEngine.armed = firing;
  L.propellant.main = L.propellant.mainMax * 0.08;
  L.landed = att === 'landed';
  L.gnc.program = att === 'landed' ? 'P68' : att === 'pdi' ? 'P63' : 'P64';
  L.gnc.autopilot = att === 'p64' || att === 'pdi' ? 'GUIDANCE' : 'OFF';
  L.gnc.throttleMode = att === 'p64' || att === 'pdi' ? 'AUTO' : 'MANUAL';
  L.gnc.rcsMode = Math.floor(t / 8) % 3 === 2 ? 'PULSE' : 'RATE';
  const a = L.agc;
  a.prog = L.gnc.program.slice(1);
  a.verb = '06';
  a.noun = att === 'landed' ? '43' : '64';
  a.r1 = att === 'landed' ? '+00674' : `+${String(Math.max(0, 40 - Math.floor(t / 4) % 40)).padStart(2, '0')} ${String(42 + Math.floor(t) % 6).padStart(2, '0')}`;
  a.r2 = att === 'landed' ? '+02347' : '-' + String(Math.round(-L.tel.vSpeed / FT * 10)).padStart(5, '0');
  a.r3 = att === 'landed' ? '+00000' : '+' + String(Math.round(alt / FT)).padStart(5, '0');
  a.flashVerbNoun = false;
  a.lights.compActy = (t * 7) % 1 < 0.45;
  a.lights.prog = false;
  L.cw.masterAlarm = Math.floor(t / 6) % 3 === 0;
  L.cw.lights['DES QTY'] = att !== 'orbit';
  L.cw.lights['LUNAR CONTACT'] = att === 'landed';
  L.gear.probeContact = att === 'landed';
  // hand controllers: slow sweeps so the ACA / TTCA deflection is visible
  const c = L.ctrl;
  const k = q.get('ctrl') === '0' ? 0 : 1;
  c.pitch = 0.8 * Math.sin(t * 0.9) * k;
  c.roll = 0.6 * Math.sin(t * 0.7 + 1) * k;
  c.yaw = 0.5 * Math.sin(t * 0.5 + 2) * k;
  c.transFwd = 0.8 * Math.sin(t * 0.6);
  c.transRight = 0.6 * Math.cos(t * 0.8);
  c.throttle = 0.5 + 0.4 * Math.sin(t * 0.4);
}

// ---------------------------------------------------------------- camera
let station = (q.get('station') || 'CDR').toUpperCase();
const eyeFor = (st) => (st === 'LMP' ? LM.eyeLMP.clone() : st === 'OVERHEAD' ? new THREE.Vector3(-0.42, 5.3, -0.72) : st === 'AFT' ? new THREE.Vector3(0, 5.15, -0.55) : LM.eyeCDR.clone());
const eyeB = eyeFor(station);
const cam = { yaw: num('yaw', 0), pitch: num('pitch', station === 'OVERHEAD' ? 80 : -12) };
game.view.mode = 'iva';
game.view.ivaVessel = 'LM';
game.view.fov = num('fov', 70);
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
  game.view.cameraMCI.copy(eyeB).applyQuaternion(LMv.quat).add(LMv.pos);
  qCam.setFromEuler(new THREE.Euler(cam.pitch * THREE.MathUtils.DEG2RAD, cam.yaw * THREE.MathUtils.DEG2RAD, 0, 'YXZ'));
  game.view.quat.copy(LMv.quat).multiply(qCam);
  const f = R.beginFrame({ realDt: dt, simDt: dt });
  ground.position.copy(groundMCI).sub(f.origin);
  ground.quaternion.copy(groundQ);
  cabin.update(f, LMv);
  if (post) post.render(f);
  else R.renderer.render(scene, ctx.camera);
  frames++;
  if (frames === 6) window.__READY = true;
  if (q.get('info') === '1' && frames % 10 === 0) {
    const s = cabin.stats();
    info.textContent = `${station} yaw ${cam.yaw.toFixed(0)} pitch ${cam.pitch.toFixed(0)}  calls ${R.renderer.info.render.calls}  tris ${R.renderer.info.render.triangles}  cabin tris ${s.triangles} meshes ${s.meshes}`;
  }
}
requestAnimationFrame(tick);
/** Multishot hook: {station, yaw, pitch, fov, t, att, eye:[x,y,z]} */
function setView(o = {}) {
  if (o.station) {
    station = o.station.toUpperCase();
    eyeB.copy(eyeFor(station));
  }
  if (o.eye) eyeB.set(o.eye[0], o.eye[1], o.eye[2]);
  if (o.yaw != null) cam.yaw = o.yaw;
  if (o.pitch != null) cam.pitch = o.pitch;
  if (o.fov != null) game.view.fov = o.fov;
  if (o.t != null) T = o.t;
  if (o.att) att = o.att;
}
window.H = { cabin, cam, game, ctx, R, LAYERS, setView, get frames() { return frames; } };
