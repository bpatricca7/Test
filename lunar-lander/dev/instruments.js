// INSTRUMENTS harness: every kit component and instrument on a grey test wall inside a mock cabin
// (sun patch through a triangular window + dim flood light), driven by an animated fake vessel.
import * as THREE from 'three';
import { createGameState, readParams } from '../src/core/state.js';
import { MOON, FT } from '../src/core/constants.js';
import { SITE_DIR, localENU, SUN_DIR } from '../src/core/frames.js';
import { createRenderer } from '../src/render/renderer.js';
import { createPost } from '../src/render/post.js';
import * as KIT from '../src/render/cockpit/kit/index.js';
import * as INS from '../src/render/cockpit/instruments/index.js';

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

// ---------------------------------------------------------------- environment (black sky + lunar ground + Sun)
{
  const envScene = new THREE.Scene();
  const sph = new THREE.Mesh(
    new THREE.SphereGeometry(10, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: { uUp: { value: localENU(SITE_DIR).up.clone() } },
      vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 uUp; varying vec3 vP; void main(){ float h = dot(normalize(vP), uUp); vec3 c = mix(vec3(0.0), vec3(0.55,0.53,0.5), smoothstep(0.02,-0.06,h)); gl_FragColor = vec4(c,1.0); }',
    }),
  );
  envScene.add(sph);
  const sun = new THREE.Mesh(new THREE.SphereGeometry(0.35, 16, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(60, 58, 55) }));
  sun.position.copy(SUN_DIR).multiplyScalar(8); // env axes = render axes = MCI
  envScene.add(sun);
  const pm = new THREE.PMREMGenerator(R.renderer);
  scene.environment = pm.fromScene(envScene, 0.02).texture;
}

// ---------------------------------------------------------------- vessel pose: sun from behind-right-above
const LMv = game.vessels.LM;
const CSMv = game.vessels.CSM;
const sitePos = SITE_DIR.clone().multiplyScalar(MOON.radius + 1500);
LMv.pos.copy(sitePos);
CSMv.pos.copy(SITE_DIR).multiplyScalar(MOON.radius + 110000);
const { up: siteUp } = localENU(sitePos);
const sunBody = new THREE.Vector3(num('sx', 0.62), num('sy', 0.42), num('sz', 0.66)).normalize(); // desired sun dir in the root frame
function frameQuat(dA, upA, dB, upB) {
  const a1 = dA.clone().normalize();
  const a2 = upA.clone().addScaledVector(a1, -upA.dot(a1)).normalize();
  const a3 = new THREE.Vector3().crossVectors(a1, a2);
  const b1 = dB.clone().normalize();
  const b2 = upB.clone().addScaledVector(b1, -upB.dot(b1)).normalize();
  const b3 = new THREE.Vector3().crossVectors(b1, b2);
  const A = new THREE.Matrix4().makeBasis(a1, a2, a3);
  const B = new THREE.Matrix4().makeBasis(b1, b2, b3);
  return new THREE.Quaternion().setFromRotationMatrix(B.multiply(A.transpose()));
}
const rootQuat = frameQuat(sunBody, new THREE.Vector3(0, 1, 0), SUN_DIR, siteUp);

// ---------------------------------------------------------------- the test wall
const root = new THREE.Group();
scene.add(root);
const WALL_Z = -0.62;
const wall = new THREE.Group();
wall.position.z = WALL_Z;
root.add(wall);
const backing = KIT.createPanel({ name: 'backing', width: 1.3, height: 0.86, depth: 0.02, screws: 'dzus', wear: 0.6, pxPerM: 1500 });
backing.position.z = -0.03;
wall.add(backing);

const items = {};
const place = (name, obj, x, y, z = 0) => {
  const o = obj.object || obj;
  o.position.set(x, y, z);
  wall.add(o);
  items[name] = { obj, x, y, w: obj.width || o.width || 0.1, h: obj.height || o.height || 0.1 };
  return obj;
};

// ---- instruments (LM panel 1 style cluster)
const dsky = place('dsky', INS.createDSKY(), -0.47, 0.22);
const fdai = place('fdai', INS.createFDAI({ size: 0.19 }), -0.235, 0.22);
const tapes = place('tapes', INS.createAltTapes(), -0.055, 0.22);
const xptr = place('xptr', INS.createCrossPointer({ size: 0.11 }), 0.08, 0.255);
const mtimer = place('mtimer', INS.createMissionTimer(), 0.26, 0.31);
const etimer = place('etimer', INS.createEventTimer(), 0.26, 0.245);
const thrust = place('thrust', INS.createThrustIndicator(), 0.08, 0.13);
const cwLabels = [
  ['ABORT', 'red'], ['ASC PRESS', 'red'], ['DES REG', 'red'], ['CES AC', 'red'], ['CES DC', 'red'], ['AGS', 'red'],
  ['LGC', 'red'], ['ISS', 'red'], ['ASC HI\nREG', 'amber'], ['DES QTY', 'amber'], ['ENG FIRE', 'red'], ['RCS', 'amber'],
  ['PRE-\nAMPS', 'amber'], ['ASC QTY', 'amber'], ['RCS TCA', 'red'], ['HEATER', 'amber'], ['ALT', 'amber'], ['VEL', 'amber'],
].map(([text, color]) => ({ text, key: text.replace('\n', ' ').replace('- ', '-'), color }));
const cw = place('cw', INS.createAnnunciatorPanel({ labels: cwLabels, cols: 6, cellW: 0.034, cellH: 0.016 }), 0.26, 0.16);
const master = place('master', INS.createMasterAlarm(), 0.43, 0.29);
const contact = place('contact', INS.createContactLights(), 0.43, 0.22);
const rtapes = place('rtapes', INS.createRangeTapes(), 0.52, 0.12);

// ---- kit panels
const switchPanel = KIT.createPanel({
  name: 'ENGINE THRUST CONT',
  width: 0.31,
  height: 0.16,
  screws: true,
  boxes: [
    { x: -0.065, y: 0.004, w: 0.16, h: 0.118, title: 'ENGINE THRUST CONT' },
    { x: 0.095, y: 0.004, w: 0.13, h: 0.118, title: 'PROP PQGS' },
  ],
  switches: [
    { id: 'thrContAuto', x: -0.12, y: 0.018, label: 'THR CONT', positions: ['AUTO', 'MAN'], state: 0 },
    { id: 'manThr', x: -0.083, y: 0.018, label: 'MAN THROT', positions: ['CDR', 'LMP'], state: 0 },
    { id: 'attTrans', x: -0.046, y: 0.018, label: 'ATT/\nTRANSL', positions: ['4 JETS', '2 JETS'], state: 0 },
    { id: 'balCpl', x: -0.009, y: 0.018, label: 'BAL CPL', positions: ['ON', 'OFF'], state: 0, guard: 'grey' },
    { id: 'engArm', x: -0.12, y: -0.035, label: 'ENG ARM', positions: ['ASC', 'OFF', 'DES'], state: 2, guard: 'grey' },
    { id: 'desEngCmd', x: -0.07, y: -0.035, label: 'DES ENG\nCMD OVRD', positions: ['ON', 'OFF'], state: 1, cover: 'red' },
    { id: 'abortStage', x: -0.02, y: -0.035, label: 'ENG STOP', positions: ['STOP', 'RESET'], state: 1, guard: 'red' },
    { id: 'pqgs', x: 0.06, y: 0.018, label: 'PQGS', positions: ['ON', 'OFF'], state: 0 },
    { id: 'temp', x: 0.1, y: 0.018, label: 'TEMP/\nPRESS MON', positions: ['HELIUM', 'PRPLNT', 'FUEL'], state: 1 },
    { id: 'heTank', x: 0.14, y: 0.018, label: 'HE MON', positions: ['OXID', 'FUEL'], state: 1, orientation: 'v' },
    { id: 'rateScale', x: 0.08, y: -0.035, label: 'RATE/ERR\nMON', positions: ['LDG RDR\nCMPTR', 'RNDZ RDR'], state: 0, orientation: 'h' },
  ],
  talkbacks: [
    { id: 'tb1', x: 0.125, y: -0.04, state: 'barber', label: 'ASC HE\nREG 1' },
  ],
});
place('switches', switchPanel, -0.43, -0.03);

const cbPanel = KIT.createCircuitBreakerPanel({
  title: 'PANEL 11',
  rows: 3,
  cols: 12,
  pitchX: 0.0205,
  pitchY: 0.036,
  rowLabels: ['FLIGHT\nDISPLAYS', 'HEATERS', 'EPS'],
  groups: [
    { row: 0, from: 0, to: 5, title: 'CDR' },
    { row: 0, from: 6, to: 11, title: 'LMP' },
    { row: 1, from: 0, to: 11, title: 'RCS SYS A & B' },
    { row: 2, from: 0, to: 7, title: 'CDR BUS' },
  ],
  labels: [
    ['FDAI', 'X-PNTR', 'THRUST\nIND', 'ALT/ALT\nRATE', 'ENG\nTHRUST', 'RNG/RNG\nRATE', 'FDAI', 'X-PNTR', 'ORDEAL', 'TIMER', 'EVENT\nTIMER', 'MSN\nTIMER'],
    ['QUAD 1', 'QUAD 2', 'QUAD 3', 'QUAD 4', 'DISP', 'LR', 'RR', 'S-BAND\nANT', 'DOCK\nWINDOW', 'AOT\nLAMP', 'SBD\nANT', 'RCS\nSTBY'],
    ['DC BUS\nVOLT', 'INV 1', 'INV 2', 'BAT\nFEED', 'ASC\nECA', 'DES\nECA', 'XLUNAR', 'CROSS\nTIE', '', '', '', ''],
  ],
  amps: (r, c) => [2, 5, 7.5, 10, 5, 3, 5, 2][(r * 5 + c) % 8],
  popped: [[0, 3], [1, 7], [2, 5]],
  gaps: [[2, 8], [2, 9], [2, 10], [2, 11]],
});
place('cb', cbPanel, -0.1, -0.035);

const ctlPanel = KIT.createPanel({
  name: 'controls',
  width: 0.22,
  height: 0.16,
  screws: 'dzus',
  boxes: [{ x: 0, y: 0.0, w: 0.2, h: 0.13, title: 'LIGHTING', style: 'bar' }],
  rotaries: [
    { id: 'floods', x: -0.06, y: 0.018, positions: ['OFF', 'POST\nLDG', 'ALL'], index: 2, label: 'FLOOD' },
    { id: 'annun', x: 0.0, y: 0.018, positions: ['BRT', 'DIM', 'OFF'], index: 0, label: 'ANUN/NUM' },
    { id: 'mode', x: 0.06, y: 0.018, positions: ['LR', 'PGNS', 'AGS', 'RR', 'CMPTR'], index: 1, label: 'MODE SEL', step: 36 },
  ],
  buttons: [
    { id: 'abort', x: -0.06, y: -0.04, label: 'ABORT', color: 'red', lit: false, size: 0.019, tone: 'light', caption: 'ABORT' },
    { id: 'abortStage', x: -0.02, y: -0.04, label: 'ABORT\nSTAGE', color: 'red', lit: true, size: 0.019, guard: 'red' },
    { id: 'eng', x: 0.02, y: -0.04, label: 'START', color: 'green', lit: true, size: 0.019 },
  ],
  thumbwheels: [{ id: 'tw', x: 0.068, y: -0.042, digits: 3, value: 471, label: 'DELTA V' }],
});
place('controls', ctlPanel, 0.24, -0.035);

// ---- CSM instruments & gauges
const ems = place('ems', INS.createEMS(), -0.44, -0.28);
const gpi = place('gpi', INS.createGPI(), -0.23, -0.28);
const prop = place('prop', INS.createPropellantGauges(), -0.06, -0.28);
const g1 = place('g1', INS.createGauge({ kind: 'vertical', label: 'RCS\nQTY', min: 0, max: 100, units: '%', ticks: [0, 20, 40, 60, 80, 100], redline: [0, 10], getValue: (v) => (v.propellant.rcs / v.propellant.rcsMax) * 100 }), 0.08, -0.28);
const g2 = place('g2', INS.createGauge({ kind: 'round', label: 'SPS\nCHAMBER', min: 0, max: 150, units: 'PSIA', ticks: [0, 25, 50, 75, 100, 125, 150], getValue: (v, g) => 95 + 5 * Math.sin(g.time.met * 3), width: 0.07, height: 0.07 }), 0.16, -0.28);
const card = KIT.createChecklistCard({
  title: 'LM DESCENT CUE CARD',
  lines: ['PDI  +00:00  THROT UP  26 SEC', '  P63  V16N68  RANGE', '+02:00  YAW TO FACE UP', '+04:00  RADAR ALT DATA GOOD', { rule: true }, 'HI GATE  P64  7400 FT', '  LPD  V06N64', 'LO GATE  500 FT  P66', '  ROD  1 FT/S/CLICK', { rule: true }, 'CONTACT  ENG STOP', '  ENG ARM - OFF', '  413 IS IN'],
});
card.position.set(0.3, -0.27, 0.002);
wall.add(card);
items.cards = { obj: card, x: 0.3, y: -0.27, w: 0.12, h: 0.15 };
const strip = KIT.createLabelStrip({ text: 'FLIGHT DATA FILE' });
strip.position.set(0.47, -0.33, 0.002);
wall.add(strip);
const placard = KIT.createPlacard({ text: 'DO NOT USE AS HANDHOLD', width: 0.075, height: 0.012, bg: '#e8e4d8', fg: '#b01810' });
placard.position.set(0.47, -0.25, 0.001);
wall.add(placard);
const toggle = KIT.createToggleSwitch({ state: 'center', positions: ['ON', 'OFF', 'MOM'] });
toggle.position.set(0.47, -0.19, 0);
wall.add(toggle);
const lamp = KIT.createLamp({ color: 'amber', lit: true });
lamp.position.set(0.44, -0.19, 0);
wall.add(lamp);

KIT.setLayerRecursive(root);
const insts = [dsky, fdai, tapes, xptr, mtimer, etimer, thrust, cw, master, contact, rtapes, ems, gpi, prop, g1, g2];
const csmInsts = new Set([ems, gpi, prop, g2]);

// ---------------------------------------------------------------- mock cabin: sun patch through a triangular window
if (q.get('sun') !== '0') {
  const shape = new THREE.Shape();
  shape.moveTo(-3, -3);
  shape.lineTo(3, -3);
  shape.lineTo(3, 3);
  shape.lineTo(-3, 3);
  shape.closePath();
  const hole = new THREE.Path();
  hole.moveTo(-0.34, -0.26);
  hole.lineTo(0.38, -0.18);
  hole.lineTo(-0.05, 0.36);
  hole.closePath();
  shape.holes.push(hole);
  const occ = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, side: THREE.DoubleSide }));
  occ.castShadow = true;
  // plane perpendicular to the sun, 0.55 m from the wall centre toward the Sun
  occ.position.set(num('wx', -0.15), num('wy', 0.05), WALL_Z).addScaledVector(sunBody, 0.55);
  occ.lookAt(occ.position.clone().add(sunBody));
  root.add(occ);
  KIT.setLayerRecursive(occ);
}
const flood = new THREE.PointLight(0xfff0dc, num('flood', 0.35), 0, 2);
flood.position.set(0.1, 0.45, 0.1);
root.add(flood);
KIT.setLayerRecursive(flood);
flood.layers.enableAll();
if (q.has('integral')) KIT.setIntegralLighting(+q.get('integral'));
// cabinenv=1: interior environment for the kit's chrome & glass (what cabins should do)
if (q.get('cabinenv') === '1') {
  const toWorld = (v) => v.clone().applyQuaternion(rootQuat); // env is sampled in world (render) axes
  KIT.setCabinEnvironment(KIT.createCabinEnvironment(R.renderer, { up: toWorld(new THREE.Vector3(0, 1, 0)), windows: [{ dir: toWorld(new THREE.Vector3(0.3, 0.25, -1)), size: 1.3, radiance: 3 }] }));
}

// ---------------------------------------------------------------- camera views
const VIEWS = {
  all: [0, 0, 1.08],
  lm: [-0.1, 0.22, 0.45],
  dsky: [-0.47, 0.22, 0.3],
  fdai: [-0.235, 0.22, 0.27],
  tapes: [-0.03, 0.22, 0.22],
  xptr: [0.08, 0.22, 0.2],
  timers: [0.3, 0.26, 0.24],
  cw: [0.3, 0.19, 0.22],
  switches: [-0.43, -0.03, 0.26],
  cb: [-0.1, -0.035, 0.26],
  controls: [0.24, -0.035, 0.24],
  csm: [-0.25, -0.28, 0.4],
  ems: [-0.44, -0.28, 0.26],
  gauges: [0.05, -0.28, 0.25],
  cards: [0.38, -0.27, 0.25],
};
let vw = q.get('view') || 'all';
let vd = VIEWS[vw] || (vw.includes(',') ? vw.split(',').map(Number) : VIEWS.all);
const cam = { x: vd[0], y: vd[1], d: num('dist', vd[2]), yaw: num('yaw', 0), pitch: num('pitch', 0) };
game.view.mode = 'iva';
game.view.ivaVessel = 'LM';
game.view.fov = num('fov', 50);
game.view.near = 0.01;

// ---------------------------------------------------------------- fake vessel animation
let T = num('t', 20);
const animate = q.get('anim') !== '0';
function fake(t) {
  const L = LMv;
  game.time.met = 102 * 3600 + 33 * 60 + 5 + t;
  // attitude: wobble about local vertical, pitched back 30-50 deg as in P64
  const { east, north, up } = localENU(L.pos);
  const pitch = (32 + 12 * Math.sin(t * 0.21)) * THREE.MathUtils.DEG2RAD; // P64: pitched back, forward axis above the horizon
  const roll = 8 * Math.sin(t * 0.17) * THREE.MathUtils.DEG2RAD;
  const yaw = (270 + 20 * Math.sin(t * 0.09)) * THREE.MathUtils.DEG2RAD;
  const fwd = north.clone().multiplyScalar(Math.cos(yaw)).addScaledVector(east, Math.sin(yaw));
  const f2 = fwd.clone().multiplyScalar(Math.cos(pitch)).addScaledVector(up, Math.sin(pitch));
  const u2 = up.clone().multiplyScalar(Math.cos(pitch)).addScaledVector(fwd, -Math.sin(pitch));
  const right = new THREE.Vector3().crossVectors(f2, u2);
  const u3 = u2.clone().multiplyScalar(Math.cos(roll)).addScaledVector(right, -Math.sin(roll));
  const r3 = new THREE.Vector3().crossVectors(f2, u3);
  L.quat.setFromRotationMatrix(new THREE.Matrix4().makeBasis(r3, u3, f2.clone().negate()));
  L.angVel.set(0.03 * Math.cos(t * 0.21), 0.02 * Math.sin(t * 0.3), -0.025 * Math.cos(t * 0.17));
  L.gnc.attError.set(2.5 * Math.sin(t * 0.5), -1.8 * Math.cos(t * 0.37), 3 * Math.sin(t * 0.23));
  const alt = Math.max(0, 1600 - t * 12);
  L.tel.altitude = alt;
  L.tel.radarAltitude = alt;
  L.tel.vSpeed = -8 - 4 * Math.sin(t * 0.3);
  L.tel.hSpeed = 20;
  L.tel.twr = 1.4 + 0.3 * Math.sin(t * 0.4);
  L.tel.accel = 2.4;
  L.tel.relTarget = { range: 12000 + 800 * Math.sin(t * 0.05), rangeRate: -14 + 6 * Math.sin(t * 0.2), pos: new THREE.Vector3() };
  L.vel.copy(f2).multiplyScalar(6 + 4 * Math.sin(t * 0.3)).addScaledVector(r3, 3 * Math.cos(t * 0.25)).addScaledVector(up, L.tel.vSpeed);
  L.mainEngine.throttle = 0.55 + 0.1 * Math.sin(t * 0.4);
  L.mainEngine.throttleCmd = 0.58 + 0.12 * Math.sin(t * 0.4 + 0.4);
  L.mainEngine.firing = true;
  L.propellant.rcs = L.propellant.rcsMax * (0.72 - 0.002 * t);
  const a = L.agc;
  a.prog = '64';
  a.verb = '06';
  a.noun = '64';
  a.r1 = `+${String(45 - Math.floor(t / 4) % 40).padStart(2, '0')} ${String(38 + Math.floor(t) % 7).padStart(2, '0')}`;
  a.r2 = '-' + String(Math.round(-L.tel.vSpeed / FT * 10)).padStart(5, '0');
  a.r3 = '+' + String(Math.round(alt / FT)).padStart(5, '0');
  a.flashVerbNoun = Math.floor(t / 6) % 2 === 1;
  a.lights.compActy = (t * 7) % 1 < 0.45;
  a.lights.prog = Math.floor(t / 5) % 3 === 0;
  a.lights.keyRel = Math.floor(t / 4) % 2 === 1;
  a.lights.alt = false;
  a.lights.vel = Math.floor(t / 7) % 2 === 0;
  a.lights.temp = false;
  a.lights.uplinkActy = true;
  L.cw.masterAlarm = Math.floor(t / 5) % 2 === 0;
  L.cw.lights['DES QTY'] = true;
  L.cw.lights['ENG FIRE'] = Math.floor(t / 3) % 2 === 0;
  L.cw.lights['ALT'] = false;
  L.cw.lights['VEL'] = true;
  L.cw.lights['LGC'] = Math.floor(t / 4) % 3 === 0;
  L.cw.lights['LUNAR CONTACT'] = Math.floor(t / 4) % 2 === 0;
  L.gear.probeContact = L.cw.lights['LUNAR CONTACT'];
  // CSM (EMS / GPI / gauges)
  const C = CSMv;
  C.quat.copy(L.quat);
  C.mainEngine.firing = Math.floor(t / 10) % 2 === 0;
  C.mainEngine.throttle = C.mainEngine.firing ? 1 : 0;
  C.mainEngine.gimbal.set(0.02 * Math.sin(t * 0.7), -0.015 * Math.cos(t * 0.5));
  C.tel.accel = C.mainEngine.firing ? 4.2 : 0;
  C.propellant.main = C.propellant.mainMax * (0.63 - 0.001 * t);
  C.propellant.rcs = C.propellant.rcsMax * 0.81;
  C.cw.lights['SPS PRESS'] = false;
}

// ---------------------------------------------------------------- loop
const info = document.getElementById('info');
const eyeOff = new THREE.Vector3();
const qCam = new THREE.Quaternion();
let frames = 0;
let last = performance.now();
function tick(now) {
  requestAnimationFrame(tick);
  const dt = q.get('fixedstep') === '0' ? Math.min(0.1, (now - last) / 1000) : 1 / 60;
  last = now;
  if (animate) T += dt;
  fake(T);
  // eye in the root (body-like) frame
  eyeOff.set(cam.x, cam.y, WALL_Z + cam.d);
  const eyeMCI = eyeOff.clone().applyQuaternion(rootQuat).add(LMv.pos);
  game.view.cameraMCI.copy(eyeMCI);
  qCam.setFromEuler(new THREE.Euler(cam.pitch * THREE.MathUtils.DEG2RAD, cam.yaw * THREE.MathUtils.DEG2RAD, 0, 'YXZ'));
  game.view.quat.copy(rootQuat).multiply(qCam);
  const f = R.beginFrame({ realDt: dt, simDt: dt });
  root.position.copy(LMv.pos).sub(f.origin);
  root.quaternion.copy(rootQuat);
  for (const i of insts) i.update(csmInsts.has(i) ? CSMv : LMv, game, dt);
  if (post) post.render(f);
  else R.renderer.render(scene, ctx.camera);
  frames++;
  if (frames === 8) window.__READY = true;
  if (q.get('info') === '1' && frames % 15 === 0) info.textContent = `view ${vw}  t ${T.toFixed(1)}  calls ${R.renderer.info.render.calls}  tris ${R.renderer.info.render.triangles}`;
}
requestAnimationFrame(tick);
window.H = { KIT, INS, items, cam, game, root, ctx, flood, setView(v) { vd = VIEWS[v]; Object.assign(cam, { x: vd[0], y: vd[1], d: vd[2] }); vw = v; } };
