// The avatar: a detailed, adorable blocky "chibi" kid built from the look (see
// wardrobe-data.js), with its own materials (so the camera can fade it), springy hair,
// flapping wings, swaying capes and skirts, a floating balloon, a sparkling wand, big blinking
// anime eyes, and every pose and emote in DESIGN.md.
//
//   createAvatar(look, { fx, blink, seaAuto }) -> { group, look, setLook, update, playEmote,
//                    dispose, setOpacity, emoting, settle, hold, held, heldShown, seaForm,
//                    seaShown, setSeaAuto, prepareSea, seaParts }
//   group: origin at the feet (seat surface when sitting, mattress-top centre when sleeping,
//   saddle when riding), ~1.75 tall, facing +Z.
//   fx(kind, Vector3, opts): optional particle hook (in the world: game.particles.emit).
//   seaAuto: (look) => 'mermaid' | 'sea_dragon' | 'me', or one of those strings: the form a look
//   with sea.form 'auto' shows in deep water (default 'me'). update(dt, { sea: true }) turns her
//   (docs/teams/merfolk.md §6.3): the sea parts are built lazily (on the first turn, or hidden
//   by prepareSea() in a quiet moment), never in build(), and disposeSea() alone owns their meshes, bones, materials and textures.

import * as THREE from 'three';
import { angleDelta, shade } from '../core/util.js';
import { DEFAULT_LOOK, normalizeLook, lookSignature } from './wardrobe-data.js';
import { GeoBuilder, Flare, lin } from './avatar/geo.js';
import { REST, PARENT, BONES, PIVOT_Y, HIP, HAND_R } from './avatar/rig.js';
import {
  acquire, release, acquireCloth, clothKey, hairStrands, paintEyes, paintMouth, mouthInk, paintGlasses, paintWing,
  EYE_VARIANTS,
} from './avatar/textures.js';
import { buildBody, buildOutfit } from './avatar/outfit.js';
import { buildHair } from './avatar/hair.js';
import { buildAccessories } from './avatar/accessories.js';
import { buildSea, paintScales, paintFin } from './merfolk/parts.js';
import { seaColorOf, SEA_GROW, SEA_CUT, SEA_SWIM } from './merfolk/rules.js';

export const EMOTE_DURATIONS = { wave: 2.4, dance: 4.2, twirl: 1.8, cartwheel: 1.7, jump: 1.9, heart: 2.6, sit: 6 };

// pose channels
const RPX = 0, RPY = 1, RPZ = 2, RRX = 3, RRY = 4, RRZ = 5;
const TX = 6, TY = 7, TZ = 8, HX = 9, HY = 10, HZ = 11;
const ALX = 12, ALY = 13, ALZ = 14, ELX = 15, ELZ = 16;
const ARX = 17, ARY = 18, ARZ = 19, ERX = 20, ERZ = 21;
const LLX = 22, LLY = 23, LLZ = 24, KL = 25;
const LRX = 26, LRY = 27, LRZ = 28, KR = 29;
const FLARE = 30, SWX = 31, SWZ = 32, SIT = 33, LIFT = 34;
const NCH = 35;
const IS_ANGLE = new Uint8Array(NCH);
for (let i = RRX; i <= KR; i++) IS_ANGLE[i] = 1;

const WAND_FX = { count: 1, spread: 0.12, scale: 0.55 };
const WAND_FX_FAST = { count: 2, spread: 0.12, scale: 0.55 };
const ZZZ_FX = { count: 1, spread: 0.1 };
const hop = (e, s0, len) => {
  const h = (e - s0) / len;
  return h > 0 && h < 1 ? 4 * h * (1 - h) : 0;
};

const PERMANENT = new Set(['plain', 'plain2', 'glow', 'hair', 'eyes', 'mouth']);
// sea-form materials belong to disposeSea(), never to build()'s sweep
const isSeaKey = (k) => k.startsWith('scale:') || k.startsWith('fin:') || k.startsWith('seaglow:');
const SEA_FORM_KEYS = new Set(['mermaid', 'sea_dragon', 'me']);
// emotes that only move the arms: they still play over the sea pose
const ARM_ONLY = new Set(['wave', 'heart']);
const SEA_IN_FX = { count: 14, spread: 0.5 };
const SEA_BUBBLE_FX = { count: 6, spread: 0.4 };
const SEA_OUT_FX = { count: 8, spread: 0.4 };
const SEA_GLINT_FX = { count: 1, spread: 0.1, scale: 0.7 };
const MOUTHS_ALWAYS = ['open', 'o', 'sleep', 'grin'];
// Toys held up in front like the ice cream, so they show.
const HOLD_UP = new Set(['soccer_ball', 'toy_car', 'dino_toy']);

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const mix = (a, b, t) => a + (b - a) * t;

// ---------- build context ----------

class BuildContext {
  constructor(av, look) {
    this.av = av;
    this.look = look;
    this.skin = look.skin;
    this.tieColor = look.acc.head !== 'none' ? look.acc.headColor : '#FF5FA2';
    this.builders = new Map();
    this.specs = new Map();
    this.flares = [];
    this.stride = 1;
    this.lift = 0;
    this.handPose = null;
    this.skirtStiff = false;
    this.backZ = -0.12; // where back accessories start (long hair pushes them out)
    this.dyn = { chains: [], swings: [], wings: [], halo: null, balloon: null, upright: null, wandTip: null };
  }

  boneOf(b) {
    return typeof b === 'string' ? this.av.bones[b] : b;
  }

  /** Builder for (bone, material); authored in avatar space. */
  B(bone, mat, opts = {}) {
    const g = this.boneOf(bone);
    if (!g) throw new Error(`no bone ${bone}`);
    const uv = opts.uv || (mat === 'hair' ? 'hair' : 'world');
    const key = `${g.uuid}|${mat}|${uv}`;
    let e = this.builders.get(key);
    if (!e) {
      e = { bone: g, mat, builder: new GeoBuilder(g.userData.origin, { uv }) };
      this.builders.set(key, e);
    }
    return e.builder;
  }

  /** Material key for a cloth spec { color, pattern, patternColor, fabric }. */
  cloth(spec, double = false) {
    const key = (double ? 'cloth2:' : 'cloth:') + clothKey(spec);
    this.specs.set(key, spec);
    this.av.specs.set(key, spec);
    return key;
  }

  clothSpec(key) {
    return this.specs.get(key) || this.av.specs.get(key);
  }

  linColor(hex) {
    return lin(hex);
  }

  /** A dynamic bone (rebuilt with the look) with its rest pivot in avatar space. */
  bone(name, parent, pivot) {
    const par = this.boneOf(parent);
    const g = new THREE.Group();
    g.name = name;
    const po = par.userData.origin;
    g.position.set(pivot[0] - po[0], pivot[1] - po[1], pivot[2] - po[2]);
    g.userData.origin = pivot.slice();
    g.userData.dynamic = true;
    par.add(g);
    this.av.bones[name] = g;
    this.av.dynBones.push(g);
    return g;
  }

  /** A chain of swinging bones through `points` (pivots, root first). Returns bone names. */
  chain(name, parent, points, opts = {}) {
    const names = [];
    let par = parent;
    for (let i = 0; i < points.length - 1; i++) {
      const n = name + i;
      this.bone(n, par, points[i]);
      names.push(n);
      par = n;
    }
    this.dyn.chains.push({
      bones: names.map((n) => this.av.bones[n]),
      kind: opts.kind || 'hair',
      swing: opts.swing ?? 1,
      side: Math.sign(points[0][0]),
      back: points[0][2] < -0.1,
      state: new Float32Array(names.length * 4),
    });
    return names;
  }

  addSwing(bone, opts) {
    this.dyn.swings.push({ bone, kind: opts.kind, ax: 0, vx: 0, az: 0, vz: 0 });
  }

  flare(bone, mat, rings, opts = {}) {
    const g = this.boneOf(bone);
    const f = new Flare(rings, { ...opts, origin: g.userData.origin });
    this.flares.push({ bone: g, mat, flare: f });
    return f;
  }
}

// ---------- the avatar ----------

export function createAvatar(lookIn = DEFAULT_LOOK, opts = {}) {
  const fx = typeof opts.fx === 'function' ? opts.fx : null;
  const blinkOn = opts.blink !== false;
  let seaAutoFn = null;
  function setSeaAutoFn(v) {
    seaAutoFn = typeof v === 'function' ? v : typeof v === 'string' ? () => v : () => 'me';
  }
  setSeaAutoFn(opts.seaAuto);
  const group = new THREE.Group();
  group.name = 'avatar';
  const spin = new THREE.Group();
  spin.position.y = PIVOT_Y;
  group.add(spin);
  const body = new THREE.Group();
  body.position.y = -PIVOT_Y;
  body.userData.origin = [0, 0, 0];
  spin.add(body);

  const av = { bones: { body }, dynBones: [], specs: new Map() };
  const bones = av.bones;
  for (const name of BONES) {
    const g = new THREE.Group();
    g.name = name;
    const o = REST[name], po = REST[PARENT[name]];
    g.position.set(o[0] - po[0], o[1] - po[1], o[2] - po[2]);
    g.userData.origin = o;
    bones[PARENT[name]].add(g);
    bones[name] = g;
  }

  // ----- materials (own instances; textures come from the shared cache) -----
  const mats = new Map(); // key -> { mat, gen, texKeys, base, baseTransparent }
  let gen = 0;
  let opacity = 1;
  const wingMats = [];
  const seaMats = []; // { mat, base emissive } of the sea materials (the shimmer)
  const seaGlow = []; // the sea dragon's glow-spot materials (a soft pulse)

  function register(key, mat, { texKeys = [], base = 1, transparent = false } = {}) {
    mat.opacity = base * opacity;
    mat.transparent = transparent || opacity < 0.999;
    const e = { mat, gen, texKeys, base, baseTransparent: transparent };
    mats.set(key, e);
    return mat;
  }

  function material(key) {
    const e = mats.get(key);
    if (e) {
      e.gen = gen;
      return e.mat;
    }
    const L = THREE.MeshLambertMaterial;
    if (key === 'plain') return register(key, new L({ vertexColors: true }));
    if (key === 'plain2') return register(key, new L({ vertexColors: true, side: THREE.DoubleSide }));
    if (key === 'glow') return register(key, new THREE.MeshBasicMaterial({ vertexColors: true }));
    if (key === 'bright') return register(key, new L({ vertexColors: true, emissive: 0xffffff, emissiveIntensity: 0.32 }));
    if (key === 'hair') return register(key, new L({ vertexColors: true, map: hairStrands() }));
    if (key === 'eyes' || key === 'mouth') {
      const m = new L({ transparent: true, map: faceTex[key === 'eyes' ? 'eyes' : 'mouth'] || null, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
      return register(key, m, { transparent: true });
    }
    if (key.startsWith('cloth:') || key.startsWith('cloth2:')) {
      const spec = av.specs.get(key);
      const { key: tk, tex } = acquireCloth(spec);
      const m = new L({ vertexColors: true, map: tex, side: key.startsWith('cloth2:') ? THREE.DoubleSide : THREE.FrontSide });
      return register(key, m, { texKeys: [tk] });
    }
    if (key.startsWith('glasses:')) {
      const [, type, color] = key.split(':');
      const tk = `glasses|${type}|${color}`;
      const tex = acquire(tk, 256, 128, (g, w, h) => paintGlasses(g, w, h, type, color));
      const m = new L({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
      return register(key, m, { texKeys: [tk], transparent: true });
    }
    if (key.startsWith('seaglow:')) {
      // the sea dragon's glow spots: unlit, their brightness pulses softly (seaTick). Drawn in
      // the blended pass after the water (the tube's renderOrder), so they shine up through it
      // at night and in deep water, a little softened (0.85)
      const m = new THREE.MeshBasicMaterial({ vertexColors: true, depthWrite: false });
      seaGlow.push(m);
      return register(key, m, { base: 0.85, transparent: true });
    }
    if (isSeaKey(key)) {
      // scale:<hex>:<form> (the cloth: program) and fin:<hex>:<form> (the cloth2: program plus
      // transparency); the gray-scale textures are shared per form, the color is per vertex
      const [kind, hex, form] = key.split(':');
      const fin = kind === 'fin';
      const tk = `sea|${kind}|${form}`;
      const tex = fin
        ? acquire(tk, 128, 128, (g, w, h) => paintFin(g, w, h, form))
        : acquire(tk, 128, 128, (g, w, h) => paintScales(g, w, h, form), { repeat: true });
      const m = new L({
        vertexColors: true, map: tex, side: fin ? THREE.DoubleSide : THREE.FrontSide,
        emissive: new THREE.Color(hex), emissiveIntensity: fin ? 0.25 : 0.12,
        ...(fin ? { depthWrite: false } : {}),
      });
      seaMats.push({ mat: m, base: fin ? 0.25 : 0.12 });
      return register(key, m, { texKeys: [tk], transparent: fin, base: 1 });
    }
    if (key.startsWith('wing:')) {
      const [, type, color, part] = key.split(':');
      const tk = `wing|${type}|${color}|${part}`;
      const tex = acquire(tk, 128, 128, (g, w, h) => paintWing(g, w, h, type, color, part));
      const m = new L({ map: tex, transparent: true, side: THREE.DoubleSide, depthWrite: false, emissive: new THREE.Color(color), emissiveIntensity: 0.3 });
      wingMats.push(m);
      return register(key, m, { texKeys: [tk], base: type === 'butterfly_wings' ? 0.97 : 0.92, transparent: true });
    }
    return register(key, new L({ color: 0xff00ff }));
  }

  function setOpacity(o) {
    o = Math.min(1, Math.max(0, o));
    if (Math.abs(o - opacity) < 0.004) return;
    opacity = o;
    for (const e of mats.values()) {
      const m = e.mat;
      m.opacity = e.base * o;
      const tr = e.baseTransparent || o < 0.999;
      if (m.transparent !== tr) {
        m.transparent = tr;
        m.needsUpdate = true;
      }
    }
  }

  // ----- face textures -----
  const faceTex = { eyes: null, mouth: null };
  let eyeTex = {};
  let mouthTex = {};
  let faceKeys = [];
  let eyesVariant = 'open', mouthVariant = 'happy';

  function acquireFace(look) {
    const keys = [];
    const brow = shade(look.hair.color, -0.3);
    const base = `${look.eyes.color}|${look.eyes.lashes}|${look.face.blush}|${look.face.freckles}|${look.skin}|${brow}|${look.face.brows}`;
    const eyes = {};
    for (const v of EYE_VARIANTS) {
      const k = `eyes|${base}|${v}`;
      eyes[v] = acquire(k, 256, 128, (g, w, h) => paintEyes(g, w, h, {
        eyeColor: look.eyes.color, lashes: look.eyes.lashes, blush: look.face.blush, freckles: look.face.freckles,
        skin: look.skin, brow, brows: look.face.brows, variant: v,
      }));
      keys.push(k);
    }
    const mouth = {};
    const ink = mouthInk(look.skin);
    for (const v of new Set([look.face.smile, ...MOUTHS_ALWAYS])) {
      const k = `mouth|${v}|${ink}`;
      mouth[v] = acquire(k, 64, 32, (g, w, h) => paintMouth(g, w, h, v, ink));
      keys.push(k);
    }
    for (const k of faceKeys) release(k);
    faceKeys = keys;
    eyeTex = eyes;
    mouthTex = mouth;
    faceTex.eyes = eyes[eyesVariant] || eyes.open;
    faceTex.mouth = mouth[mouthVariant] || mouth[look.face.smile];
    const em = mats.get('eyes'), mm = mats.get('mouth');
    if (em) em.mat.map = faceTex.eyes;
    if (mm) mm.mat.map = faceTex.mouth;
  }

  function setFace(eyes, mouth) {
    const et = eyeTex[eyes] || eyeTex.open;
    const mt = mouthTex[mouth] || mouthTex[look.face.smile];
    if (et !== faceTex.eyes) {
      faceTex.eyes = et;
      const e = mats.get('eyes');
      if (e) e.mat.map = et;
    }
    if (mt !== faceTex.mouth) {
      faceTex.mouth = mt;
      const e = mats.get('mouth');
      if (e) e.mat.map = mt;
    }
    eyesVariant = eyes;
    mouthVariant = mouth;
  }

  // ----- heart prop for the heart-hands emote (built once) -----
  const heartProp = new THREE.Group();
  heartProp.position.set(0, 0.36, 0.38);
  heartProp.visible = false;
  bones.torso.add(heartProp);
  {
    const b = new GeoBuilder([0, 0, 0]);
    const px = [[-2, 1], [-1, 2], [1, 2], [2, 1], [-2, 0], [-1, 0], [0, 0], [1, 0], [2, 0], [-1, 1], [0, 1], [1, 1], [-1, -1], [0, -1], [1, -1], [0, -2]];
    const s = 0.035;
    for (const [i, j] of px) b.cube(i * s, j * s, 0, s, s, s, (i + j) % 2 ? '#FF7EB6' : '#FF5FA2');
    heartProp.add(new THREE.Mesh(b.build(), material('glow')));
  }

  // ----- a held item (hook for other modules, e.g. a shop treat in her right hand) -----
  // hold(object3d, pose) puts it in her hand, kept upright like the hand accessories, with the
  // arm raised ('hold') or lifted to her mouth ('eat'); hold(null) lets go. The caller owns
  // (and disposes) the object. Her hand accessory hides while she holds something.
  const heldBone = new THREE.Group();
  heldBone.name = 'held';
  heldBone.position.set(HAND_R[0] - REST.elbowR[0], HAND_R[1] - REST.elbowR[1], HAND_R[2] - REST.elbowR[2]);
  bones.elbowR.add(heldBone);
  let heldObj = null, heldPose = 'hold';
  function syncHandItem() {
    const d = parts.dyn;
    if (!d) return;
    const show = !heldObj;
    if (d.upright) d.upright.visible = show;
    if (d.wandTip) d.wandTip.visible = show;
    if (d.balloon) d.balloon.ball.visible = d.balloon.string.visible = show;
  }
  function hold(obj, pose = 'hold') {
    heldPose = pose || 'hold';
    if (obj !== heldObj) {
      if (heldObj && heldObj.parent === heldBone) heldBone.remove(heldObj);
      heldObj = obj || null;
      if (heldObj) heldBone.add(heldObj);
      syncHandItem();
    }
  }

  // ----- per-look parts -----
  let look = normalizeLook(lookIn);
  let sig = '';
  let parts = { meshes: [], flares: [], flareMeshes: [], dyn: null, stride: 1, lift: 0, handPose: null, stiff: false };
  let snapSecondary = true;

  // ----- sea form (merfolk) -----
  let sea = null; // { form, hex, root, tip, tube, meshes, bones, matKeys, frill }
  let seaW = 0, seaTarget = 0, seaPhase = 0, seaFlash = 0, seaGlintT = 0, seaMouthT = 0, leapSpin = 0;
  let autoForm = null; // the cached resolved 'auto' form (cleared by setLook / setSeaAuto)
  let seaLastForm = null; // the form of the last parts built (a look change disposes them)
  let seaHex = null; // { form, hex } cached Match color for this look
  const seaKick = { amp: 0, turn: 0, curl: 0, float: 0, side: 0, sp: 0 };
  // the floating sea dragon's tail bend per joint (positive: toward its back), blended by speed.
  // Floating still, the tail sweeps back from the hips and its end sinks a little; swimming
  // along the top, it trails straight back and a little down under the surface (never curling
  // up toward the camera behind him: seen from there an upturned end was a flat splash).
  const FLOAT_STILL = [0.45, 0.3, 0.1, 0, -0.05, -0.1, -0.1];
  const FLOAT_SWIM = [0, -0.04, -0.06, -0.1, -0.14, -0.18, -0.2];
  const seaAngles = new Float32Array(7), seaSides = new Float32Array(7);

  /** The form this look shows: its explicit choice, or the cached seaAuto(look) for 'auto'. */
  function seaFormNow() {
    const f = look.sea && look.sea.form;
    if (f && f !== 'auto') return SEA_FORM_KEYS.has(f) ? f : 'me';
    if (autoForm === null) {
      let r = 'me';
      try { r = seaAutoFn(look); } catch (err) { r = 'me'; }
      autoForm = SEA_FORM_KEYS.has(r) ? r : 'me';
    }
    return autoForm;
  }

  function seaHexFor(form) {
    if (!seaHex || seaHex.form !== form) seaHex = { form, hex: seaColorOf(look, form) };
    return seaHex.hex;
  }

  /** The only owner of sea resources: meshes, bones, materials and their textures. */
  function disposeSea() {
    if (!sea) return;
    for (const m of sea.meshes) {
      if (m.parent) m.parent.remove(m);
      if (m.geometry) m.geometry.dispose();
    }
    for (const b of sea.bones) if (b.parent) b.parent.remove(b);
    if (sea.root.parent) sea.root.parent.remove(sea.root);
    seaLastForm = sea.form;
    for (const k of sea.matKeys) {
      const e = mats.get(k);
      if (!e) continue;
      e.mat.dispose();
      for (const tk of e.texKeys) release(tk);
      mats.delete(k);
    }
    seaMats.length = 0;
    seaGlow.length = 0;
    sea = null;
  }

  /** Build (once per look and form) the sea parts, hidden until the weight shows them. */
  function ensureSea(form, hex) {
    if (sea && sea.form === form && sea.hex === hex) return;
    // a form change while the tail is out (a Studio tap, the bubble): sparkle (a look change
    // disposed the old parts first, so the last built form is remembered)
    const prevForm = sea ? sea.form : seaLastForm;
    const wasShown = seaW > 0.5 && !!prevForm && prevForm !== form;
    disposeSea();
    const P = new BuildContext(av, look);
    const out = buildSea(P, form, hex, look);
    const meshes = [];
    let frill = null;
    for (const e of P.builders.values()) {
      const geo = e.builder.build();
      if (!geo) continue;
      const mesh = new THREE.Mesh(geo, material(e.mat));
      if (e.mat.startsWith('fin:')) mesh.renderOrder = 3;
      e.bone.add(mesh);
      meshes.push(mesh);
      if (e.bone === out.root && e.mat.startsWith('fin:')) frill = mesh;
    }
    const tube = new THREE.Mesh(out.tube.geometry, out.tubeMats.map((k) => material(k)));
    tube.frustumCulled = false;
    tube.renderOrder = 4; // its blended glow spots after the water (water chunks sort below 0)
    out.root.add(tube);
    meshes.push(tube);
    const fluke = new THREE.Mesh(out.fluke, material(out.flukeMat));
    fluke.frustumCulled = false;
    fluke.renderOrder = 3;
    out.tip.add(fluke);
    meshes.push(fluke);
    sea = {
      form, hex, root: out.root, tip: out.tip, tube: out.tube, meshes, bones: out.bones, matKeys: out.keys, frill, fluke,
    };
    const vis = seaW > 0.01;
    sea.root.visible = vis;
    for (const b of sea.bones) b.visible = vis;
    if (wasShown) {
      seaFlash = 1;
      emit('sparkle', bones.hips, 0, -0.1, 0, SEA_IN_FX);
    }
  }

  function clearParts() {
    disposeSea();
    for (const m of parts.meshes) {
      if (m.parent) m.parent.remove(m);
      m.geometry.dispose();
    }
    for (const b of av.dynBones) {
      if (b.parent) b.parent.remove(b);
      delete bones[b.name];
    }
    av.dynBones = [];
    parts.meshes = [];
    parts.flares = [];
    parts.flareMeshes = [];
  }

  function build() {
    gen++;
    clearParts();
    wingMats.length = 0;
    av.specs = new Map();
    const P = new BuildContext(av, look);
    buildBody(P);
    buildOutfit(P);
    buildHair(P);
    buildAccessories(P);
    acquireFace(look);
    const meshes = [];
    for (const e of P.builders.values()) {
      const geo = e.builder.build();
      if (!geo) continue;
      const mesh = new THREE.Mesh(geo, material(e.mat));
      if (e.mat === 'eyes' || e.mat === 'mouth') mesh.renderOrder = 1;
      if (e.mat.startsWith('glasses:')) mesh.renderOrder = 2;
      if (e.mat.startsWith('wing:')) mesh.renderOrder = 3;
      e.bone.add(mesh);
      meshes.push(mesh);
    }
    const flares = [];
    const flareMeshes = [];
    for (const f of P.flares) {
      const mesh = new THREE.Mesh(f.flare.geometry, material(f.mat));
      f.bone.add(mesh);
      meshes.push(mesh);
      flares.push(f.flare);
      flareMeshes.push(mesh);
    }
    material('eyes');
    material('mouth');
    material('glow');
    // drop materials this look no longer uses
    for (const [k, e] of mats) {
      if (e.gen === gen || PERMANENT.has(k) || isSeaKey(k)) continue;
      e.mat.dispose();
      for (const tk of e.texKeys) release(tk);
      mats.delete(k);
    }
    wingMats.length = 0;
    for (const [k, e] of mats) if (k.startsWith('wing:')) wingMats.push(e.mat);
    parts = {
      meshes, flares, flareMeshes, dyn: P.dyn, stride: P.stride, lift: P.lift, handPose: P.handPose, stiff: P.skirtStiff,
    };
    snapSecondary = true;
    syncHandItem();
  }

  function setLook(next) {
    const n = normalizeLook(next);
    const s = JSON.stringify(n);
    if (s === sig) return;
    sig = s;
    look = n;
    autoForm = null;
    seaHex = null;
    build();
  }
  setLook(look);

  function setSeaAuto(v) {
    setSeaAutoFn(v);
    autoForm = null;
  }

  // ----- animation state -----
  const cur = new Float32Array(NCH);
  const tgt = new Float32Array(NCH);
  const air = new Float32Array(NCH);
  let t = Math.random() * 10;
  let walkPhase = 0, wingPhase = 0;
  let emote = null; // { name, e, dur, fired }
  let hasPrev = false, prevX = 0, prevY = 0, prevZ = 0, prevYaw = 0;
  let mvSpeed = 0, vy = 0, fwd = 0, yawRate = 0, airW = 0, prevRRY = 0, spinRate = 0;
  let nextBlink = 1.5 + Math.random() * 2, blinkUntil = 0, nextGlance = 3 + Math.random() * 3, glanceUntil = 0, glanceDir = 0;
  let wandTimer = 0, zzzTimer = 1;
  const flareParams = { flare: 0, swayX: 0, swayZ: 0, sit: 0, lift: 0 };
  const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3();
  const q1 = new THREE.Quaternion();
  const UP = new THREE.Vector3(0, 1, 0);
  const balloonPos = new THREE.Vector3(), balloonVel = new THREE.Vector3();
  let purseA = 0, purseV = 0, purseZ = 0, purseVZ = 0;

  function emit(kind, obj, ox, oy, oz, o) {
    if (!fx) return;
    obj.updateWorldMatrix(true, false);
    v1.set(ox, oy, oz);
    obj.localToWorld(v1);
    fx(kind, v1, o);
  }

  // ----- poses -----

  function poseGround(s, dt, speed) {
    const a = Math.min(1.25, speed / 4.3);
    const stride = parts.stride;
    const skates = parts.lift > 0;
    walkPhase += dt * speed * (skates ? 1.25 : 2.35);
    const ph = walkPhase, sw = Math.sin(ph), cw = Math.cos(ph);
    const A = a * 0.62 * stride;
    tgt[LLX] = -sw * A;
    tgt[LRX] = sw * A;
    const kk = a * (0.4 + 0.6 * stride) * (skates ? 0.4 : 1);
    tgt[KL] = kk * (0.08 + 0.85 * Math.max(0, -cw));
    tgt[KR] = kk * (0.08 + 0.85 * Math.max(0, cw));
    tgt[ALX] = sw * 0.62 * a;
    tgt[ARX] = -sw * 0.62 * a;
    tgt[ELX] = tgt[ERX] = -0.12 - 0.45 * a;
    tgt[ALZ] = 0.1 + 0.05 * a;
    tgt[ARZ] = -(0.1 + 0.05 * a);
    tgt[TX] = 0.07 * a;
    tgt[TY] = sw * 0.1 * a;
    tgt[HX] = -0.05 * a;
    tgt[HY] = -sw * 0.08 * a;
    tgt[RPY] = (0.5 - Math.abs(sw)) * 0.06 * a * (skates ? 0.3 : 1);
    tgt[RRZ] = sw * 0.035 * a;
    tgt[SWZ] = -0.05 * a;
    tgt[SWX] = -sw * 0.02 * a;
    tgt[FLARE] = 0.05 * a + Math.abs(cw) * 0.05 * a;
    if (skates && a > 0.05) {
      tgt[LLZ] = Math.max(0, sw) * 0.3 * a;
      tgt[LRZ] = -Math.max(0, -sw) * 0.3 * a;
      tgt[ALZ] += 0.35 * a;
      tgt[ARZ] -= 0.35 * a;
      tgt[TX] += 0.12 * a;
    }
    // idle: breathing, a slow weight shift, looking around
    const idle = 1 - Math.min(1, a * 3);
    if (idle > 0) {
      const br = Math.sin(t * 1.9);
      tgt[TX] += br * 0.014 * idle;
      tgt[ALZ] += (0.03 + br * 0.018) * idle;
      tgt[ARZ] -= (0.03 + br * 0.018) * idle;
      tgt[HY] += (glanceDir * 0.24 + Math.sin(t * 0.45) * 0.06) * idle;
      tgt[HZ] += Math.sin(t * 0.6) * 0.04 * idle;
      tgt[HX] += Math.sin(t * 0.37) * 0.03 * idle;
      tgt[RRZ] += Math.sin(t * 0.5) * 0.012 * idle;
      tgt[RPX] += Math.sin(t * 0.5) * 0.008 * idle;
    }
    // in the air: arms up when rising, out wide when falling
    const inAir = !s.onGround && !s.flying && !s.swimming ? 1 : 0;
    airW += (inAir - airW) * Math.min(1, dt * 12);
    if (airW > 0.01) {
      air.set(tgt);
      if (vy > 0.5) {
        air[ALZ] = 2.3; air[ARZ] = -2.3; air[ELX] = air[ERX] = -0.3;
        air[LLX] = -0.55; air[KL] = 1.0; air[LRX] = -0.15; air[KR] = 0.45;
        air[FLARE] = 0.12;
      } else {
        air[ALZ] = 1.2; air[ARZ] = -1.2; air[ELX] = air[ERX] = -0.2;
        air[LLX] = -0.15; air[LRX] = 0.1; air[KL] = 0.25; air[KR] = 0.15; air[LLZ] = 0.08; air[LRZ] = -0.08;
        air[FLARE] = 0.4; air[LIFT] = 0.04;
      }
      for (let i = 0; i < NCH; i++) tgt[i] += (air[i] - tgt[i]) * airW;
    }
    handPose(sw, a);
  }

  function handPose(sw, a) {
    const hp = parts.handPose;
    if (!hp || heldObj) return;
    const sw2 = sw * a;
    if (hp === 'teddy') { tgt[ARX] = -0.4 + sw2 * 0.1; tgt[ARZ] = 0.26; tgt[ERX] = -1.55; tgt[ERZ] = 0.2; }
    else if (hp === 'wand') { tgt[ARX] = -0.25 - sw2 * 0.2; tgt[ARZ] = -0.16; tgt[ERX] = -1.0; }
    else if (hp === 'ice_cream' || HOLD_UP.has(hp)) { tgt[ARX] = -0.3 - sw2 * 0.1; tgt[ARZ] = 0.06; tgt[ERX] = -1.4; }
    else if (hp === 'balloon') { tgt[ARX] = -0.3 - sw2 * 0.15; tgt[ARZ] = -0.22; tgt[ERX] = -0.55; }
    else if (hp === 'purse') { tgt[ARZ] = -0.2; tgt[ERX] = -0.25; }
  }

  function poseSit(riding, dt) {
    tgt[RPY] = -(HIP - 0.095);
    tgt[TX] = 0.04 + Math.sin(t * 1.7) * 0.012;
    tgt[HX] = 0.04 + Math.sin(t * 0.37) * 0.03;
    tgt[HY] = glanceDir * 0.22 + Math.sin(t * 0.45) * 0.06;
    tgt[HZ] = Math.sin(t * 0.6) * 0.05;
    tgt[SIT] = riding ? 0.55 : 1;
    if (riding) {
      const bounce = Math.min(1, mvSpeed / 4);
      walkPhase += dt * mvSpeed * 2.2;
      tgt[RPY] += Math.abs(Math.sin(walkPhase)) * 0.05 * bounce;
      tgt[LLX] = tgt[LRX] = -1.2;
      tgt[LLZ] = 0.55; tgt[LRZ] = -0.55;
      tgt[KL] = tgt[KR] = 1.15;
      tgt[ALX] = tgt[ARX] = -0.95;
      tgt[ALZ] = -0.12; tgt[ARZ] = 0.12;
      tgt[ELX] = tgt[ERX] = -0.55;
      tgt[TX] = 0.12 + bounce * 0.06;
      tgt[FLARE] = 0.3;
    } else {
      tgt[LLX] = tgt[LRX] = -1.5;
      tgt[LLZ] = 0.05; tgt[LRZ] = -0.05;
      tgt[KL] = 1.45 + Math.sin(t * 2.1) * 0.14;
      tgt[KR] = 1.45 + Math.sin(t * 2.1 + 1.6) * 0.14;
      tgt[ALX] = tgt[ARX] = -0.55;
      tgt[ALZ] = 0.14; tgt[ARZ] = -0.14;
      tgt[ELX] = tgt[ERX] = -0.65;
      tgt[FLARE] = 0.08;
    }
  }

  function poseSleep() {
    tgt[RRX] = -Math.PI / 2;
    tgt[RPY] = -0.74;
    tgt[RPZ] = -0.06;
    const br = Math.sin(t * 1.15);
    tgt[TX] = br * 0.018;
    tgt[RPY] += br * 0.004;
    tgt[HX] = 0.18;
    tgt[HZ] = 0.12;
    tgt[ALX] = -0.45; tgt[ALZ] = -0.32; tgt[ELX] = -1.25;
    tgt[ARZ] = -0.12; tgt[ERX] = -0.1;
    tgt[LLZ] = 0.03; tgt[LRZ] = -0.03; tgt[KL] = 0.1; tgt[KR] = 0.05;
  }

  function poseSwim(speed) {
    const sp = Math.min(1, speed / 2.8);
    const c = t * 4.2;
    tgt[RRX] = 0.15 + 0.85 * sp;
    tgt[HX] = -0.7 * tgt[RRX];
    tgt[RPY] = Math.sin(t * 2) * 0.04;
    // crawl strokes when moving, sculling when floating
    tgt[ALX] = mix(-0.2 + Math.sin(c) * 0.25, -1.6 - Math.sin(c) * 1.3, sp);
    tgt[ARX] = mix(-0.2 - Math.sin(c) * 0.25, -1.6 + Math.sin(c) * 1.3, sp);
    tgt[ALZ] = mix(0.9 + Math.sin(t * 3) * 0.35, 0.3, sp);
    tgt[ARZ] = -mix(0.9 + Math.sin(t * 3 + Math.PI) * 0.35, 0.3, sp);
    tgt[ELX] = tgt[ERX] = -0.4;
    tgt[LLX] = mix(Math.sin(t * 3) * 0.4, Math.sin(t * 9) * 0.35 + 0.1, sp);
    tgt[LRX] = mix(-Math.sin(t * 3) * 0.4, -Math.sin(t * 9) * 0.35 + 0.1, sp);
    tgt[KL] = mix(0.6 + Math.sin(t * 3) * 0.3, 0.2, sp);
    tgt[KR] = mix(0.6 - Math.sin(t * 3) * 0.3, 0.2, sp);
    tgt[FLARE] = 0.35;
    tgt[SWZ] = -0.1 * sp;
  }

  function poseFly(speed) {
    const fs = Math.min(1.4, speed / 7.5);
    const f = Math.min(1, fs);
    tgt[RRX] = 0.22 + 0.62 * f;
    tgt[HX] = -tgt[RRX] * 0.8;
    tgt[RPY] = Math.sin(t * 2.2) * 0.05;
    // hovering: arms out; zooming: one arm forward like a superhero
    tgt[ALZ] = mix(1.1 + Math.sin(t * 3) * 0.12, 0.2, f);
    tgt[ALX] = mix(0, 0.3, f);
    tgt[ARZ] = mix(-1.1 - Math.sin(t * 3) * 0.12, -0.12, f);
    tgt[ARX] = mix(0, -2.9, f);
    tgt[ELX] = mix(-0.3, -0.05, f);
    tgt[ERX] = mix(-0.3, 0, f);
    tgt[LLX] = mix(Math.sin(t * 3) * 0.15, 0.12, f);
    tgt[LRX] = mix(-Math.sin(t * 3) * 0.15, 0.3, f);
    tgt[KL] = mix(0.35, 0.15, f);
    tgt[KR] = mix(0.25, 0.45, f);
    tgt[SWZ] = -0.16 * f;
    tgt[FLARE] = 0.12 + Math.sin(t * 13) * 0.03 * f;
  }

  // ----- sea poses (docs/teams/merfolk.md §6.4) -----

  /** Swimming with a tail: streamlined and flat when fast, nose down when diving; resting on
   *  the floor of shallow water, the tail curls back along it (it never sinks into the sand). */
  function poseSea(speed, dt, onFloor = false, float = false) {
    const sp = Math.min(1, speed / SEA_SWIM);
    seaPhase += dt * (2.2 + 6.5 * sp);
    const dive = Math.max(-0.55, Math.min(0.55, -vy * 0.16));
    tgt[RRX] = 0.3 + 1.1 * sp + dive * (0.4 + 0.6 * sp);
    tgt[HX] = -0.8 * Math.max(0, tgt[RRX] - 0.2);
    tgt[RPY] = Math.sin(seaPhase) * 0.035 * (0.3 + sp);
    tgt[TX] = Math.sin(seaPhase + Math.PI) * 0.05 * sp;
    tgt[ALX] = mix(-0.25 + Math.sin(t * 2.6) * 0.3, 0.25, sp);
    tgt[ARX] = mix(-0.25 - Math.sin(t * 2.6) * 0.3, 0.25, sp);
    tgt[ALZ] = mix(0.75 + Math.sin(t * 2.6) * 0.25, 0.18, sp);
    tgt[ARZ] = -mix(0.75 + Math.sin(t * 2.6 + Math.PI) * 0.25, 0.18, sp);
    tgt[ELX] = tgt[ERX] = mix(-0.5, -0.1, sp);
    seaKick.amp = 0.16 + 0.3 * sp;
    seaKick.turn = Math.max(-0.5, Math.min(0.5, -yawRate * 0.12));
    const curl = onFloor && sp < 0.35 ? 0.24 : sp < 0.2 && vy > -0.2 && vy < 0.2 ? -0.05 : 0;
    seaKick.curl += (curl - seaKick.curl) * Math.min(1, dt * 6);
    // the sea dragon swims like a creature: its long tail waves side to side in a slow S (seen
    // from behind, the play camera, the tail and its crest show instead of pointing at the
    // camera), with a smaller up-and-down kick
    const dragon = !!sea && sea.form === 'sea_dragon';
    seaKick.sp = sp;
    seaKick.side = dragon ? 0.35 * (0.6 + 0.4 * sp) : 0;
    if (dragon) seaKick.amp *= 0.4;
    const fl = float && !onFloor && dragon ? 1 : 0;
    seaKick.float += (fl - seaKick.float) * Math.min(1, dt * 4);
  }

  /** The tail out of the water: a leap (head up rising, head first falling), or a flop on sand. */
  function poseLeap(dt, s) {
    seaPhase += dt * 3;
    tgt[RRX] = Math.max(0.2, Math.min(2.0, 1.0 - vy * 0.2));
    tgt[ALX] = tgt[ARX] = vy < 0 ? -2.8 : -0.6;
    tgt[ALZ] = 0.2;
    tgt[ARZ] = -0.2;
    tgt[HX] = -0.3;
    seaKick.amp = 0.06;
    seaKick.turn = 0;
    seaKick.curl = s.onGround ? 0.05 : 0.18;
    seaKick.float = Math.max(0, seaKick.float - dt * 4);
    seaKick.side = 0;
  }

  /** Riding a dolphin with a tail: side-saddle, holding on, the tail draped along its side. */
  function poseSaddleSea(dt, s) {
    poseSit(true, dt);
    tgt[RRY] = 0.5;
    tgt[TY] = -0.35;
    tgt[HY] += -0.12;
    tgt[RPY] += 0.02;
    seaPhase = Number.isFinite(s.seaKick) && s.seaKick !== 0 ? s.seaKick : seaPhase + dt * 1.2;
    seaKick.amp = 0.08;
    seaKick.turn = 0.35;
    seaKick.curl = 0.25;
    seaKick.float = Math.max(0, seaKick.float - dt * 4);
    seaKick.side = 0;
  }

  /** After the bones are set: bend the tail, place the fin, flutter the frill, shimmer. */
  function seaTick(dt) {
    if (!sea) return;
    const w = seaW;
    const gw = Math.max(0.001, w);
    sea.root.scale.set(0.6 + 0.4 * gw, gw, 0.6 + 0.4 * gw);
    for (const b of sea.bones) b.scale.setScalar(gw);
    for (let i = 0; i < 7; i++) {
      const fb = FLOAT_STILL[i] + (FLOAT_SWIM[i] - FLOAT_STILL[i]) * seaKick.sp;
      seaAngles[i] = seaKick.amp * Math.sin(seaPhase - 0.8 * i) * (0.3 + (0.7 * i) / 6) + seaKick.curl + seaKick.float * fb;
      seaSides[i] = (seaKick.turn * i) / 6 + seaKick.side * Math.sin(seaPhase * 0.6 - 0.9 * i) * (0.4 + (0.6 * i) / 6);
    }
    sea.tube.deform(seaAngles, seaSides);
    sea.tip.matrix.copy(sea.tube.tipMat);
    sea.tip.matrixWorldNeedsUpdate = true;
    // the dragon's fan fin rolls with the S-wave and turns on edge as he speeds up (a flat disc
    // facing the camera behind him read as a splash); the mermaid's fin never rolls
    if (sea.form === 'sea_dragon') {
      const roll = seaKick.side ? 0.6 * seaKick.sp + 0.5 * Math.sin(seaPhase * 0.6 - 5.4) : 0;
      sea.fluke.rotation.y += (roll - sea.fluke.rotation.y) * Math.min(1, dt * 6);
    }
    if (sea.frill) sea.frill.scale.x = 1 + 0.06 * Math.sin(t * 5);
    seaFlash = Math.max(0, seaFlash - dt * 2);
    for (let i = 0; i < seaMats.length; i++) {
      const e = seaMats[i];
      e.mat.emissiveIntensity = e.base + 0.06 * Math.sin(t * 2.4 + i) + 0.5 * seaFlash;
    }
    for (let i = 0; i < seaGlow.length; i++) seaGlow[i].color.setScalar(Math.min(1, 0.8 + 0.2 * Math.sin(t * 2.2) + 0.2 * seaFlash));
    // glints along the tail while it grows
    if (fx && w > 0.02 && w < 0.98 && seaTarget > 0) {
      seaGlintT -= dt;
      if (seaGlintT <= 0) {
        seaGlintT = 0.05;
        emit('sparkle', sea.tip, 0, 0, 0, SEA_GLINT_FX);
      }
    }
  }

  // ----- emotes -----

  function poseEmote(dt) {
    const E = emote;
    const e = E.e, d = E.dur;
    const k = smooth(0, 0.28, e) * (1 - smooth(d - 0.32, d, e));
    let eyes = 'open', mouth = 'open';
    switch (E.name) {
      case 'wave': {
        tgt[ARZ] = mix(tgt[ARZ], -2.55 + Math.sin(e * 11) * 0.3, k);
        tgt[ARX] = mix(tgt[ARX], -0.2, k);
        tgt[ERX] = mix(tgt[ERX], -0.35, k);
        tgt[HZ] += 0.12 * k;
        tgt[HY] -= 0.1 * k;
        tgt[TZ] = 0.05 * k;
        tgt[RRZ] += Math.sin(e * 5.5) * 0.025 * k;
        eyes = Math.floor(e * 2) % 3 === 2 ? 'happy' : 'open';
        if (E.fired[0] < 0 && e > 0.4) { E.fired[0] = 1; emit('sparkle', bones.elbowR, 0, -0.22, 0, { count: 5, spread: 0.2, scale: 0.7 }); }
        break;
      }
      case 'dance': {
        const b = e * 13;
        const bounce = Math.abs(Math.sin(b * 0.5));
        tgt[RPY] = (bounce * 0.07 - 0.02) * k;
        tgt[KL] = tgt[KR] = (0.2 + bounce * 0.3) * k;
        tgt[LLX] = tgt[LRX] = -(0.1 + bounce * 0.15) * k;
        if (e < d * 0.5) {
          tgt[ALZ] = mix(tgt[ALZ], 2.45 + Math.sin(b * 0.5) * 0.35, k);
          tgt[ARZ] = mix(tgt[ARZ], -2.45 + Math.sin(b * 0.5) * 0.35, k);
          tgt[ELX] = tgt[ERX] = -0.3 * k;
          tgt[RRY] = Math.sin(b * 0.25) * 0.45 * k;
          tgt[TZ] = Math.sin(b * 0.5) * 0.1 * k;
        } else {
          const s = (Math.sin(b * 0.25) + 1) / 2;
          tgt[ALZ] = mix(tgt[ALZ], mix(0.55, 2.7, s), k);
          tgt[ELX] = mix(tgt[ELX], mix(-1.4, -0.1, s), k);
          tgt[ARZ] = mix(tgt[ARZ], mix(-2.7, -0.55, s), k);
          tgt[ERX] = mix(tgt[ERX], mix(-0.1, -1.4, s), k);
          tgt[TZ] = (s - 0.5) * 0.22 * k;
          tgt[HZ] = -(s - 0.5) * 0.2 * k;
          tgt[RRY] = (s - 0.5) * 0.6 * k;
        }
        tgt[FLARE] = 0.15 + bounce * 0.15;
        eyes = 'happy';
        mouth = 'grin';
        const beat = Math.floor(e / 0.55);
        if (beat !== E.fired[0]) { E.fired[0] = beat; emit('note', bones.head, 0.3 * (beat % 2 ? 1 : -1), 0.7, 0, { count: 1, spread: 0.1 }); }
        break;
      }
      case 'twirl': {
        const p = smooth(0.08, d - 0.18, e);
        const bell = Math.sin(p * Math.PI);
        tgt[RRY] = p * Math.PI * 2;
        tgt[ALZ] = mix(tgt[ALZ], 2.75, k); tgt[ELX] = mix(tgt[ELX], -0.25, k); tgt[ELZ] = -0.5 * k;
        tgt[ARZ] = mix(tgt[ARZ], -1.35, k); tgt[ERX] = mix(tgt[ERX], -0.15, k);
        tgt[RPY] = 0.07 * bell;
        tgt[KL] = 0.3 * bell;
        tgt[LLX] = -0.25 * bell;
        tgt[FLARE] = 0.85 * bell;
        tgt[LIFT] = 0.08 * bell;
        tgt[HZ] = 0.15 * k;
        eyes = 'happy';
        mouth = 'grin';
        if (E.fired[0] < 0 && e > 0.8) { E.fired[0] = 1; emit('sparkle', body, 0, 0.9, 0, { count: 18, spread: 1.1, scale: 1 }); }
        break;
      }
      case 'cartwheel': {
        const p = smooth(0.14, d - 0.26, e);
        const bell = Math.sin(p * Math.PI);
        tgt[RRZ] = -p * Math.PI * 2;
        tgt[RPY] = 0.34 * bell;
        tgt[RPX] = -0.25 * bell;
        const up = smooth(0, 0.14, e) * (1 - smooth(d - 0.1, d, e));
        tgt[ALZ] = mix(tgt[ALZ], 2.75, up); tgt[ARZ] = mix(tgt[ARZ], -2.75, up);
        tgt[ELX] = tgt[ERX] = 0;
        tgt[LLZ] = 0.62 * bell; tgt[LRZ] = -0.62 * bell;
        tgt[KL] = tgt[KR] = 0;
        tgt[FLARE] = 0.3 * bell;
        eyes = 'happy';
        mouth = 'grin';
        if (E.fired[0] < 0 && e > d - 0.3) { E.fired[0] = 1; emit('sparkle', body, 0, 0.8, 0, { count: 12, spread: 0.9 }); }
        break;
      }
      case 'jump': {
        const h1 = hop(e, 0.2, 0.55), h2 = hop(e, 0.95, 0.55);
        const hgt = Math.max(h1, h2);
        const crouch = Math.max(smooth(0, 0.12, e) * (1 - smooth(0.12, 0.2, e)), smooth(0.72, 0.8, e) * (1 - smooth(0.87, 0.95, e)), smooth(1.47, 1.55, e) * (1 - smooth(1.62, 1.75, e)));
        tgt[RPY] = hgt * 0.5 - crouch * 0.1;
        const star = Math.min(1, hgt * 2.5);
        tgt[ALZ] = mix(tgt[ALZ], 2.6, star); tgt[ARZ] = mix(tgt[ARZ], -2.6, star);
        tgt[LLZ] = 0.45 * star; tgt[LRZ] = -0.45 * star;
        tgt[KL] = tgt[KR] = 0.15 * star + crouch * 0.9;
        tgt[LLX] = tgt[LRX] = -crouch * 0.5;
        tgt[TX] = crouch * 0.25;
        tgt[ALX] = mix(tgt[ALX], 0.6, crouch); tgt[ARX] = mix(tgt[ARX], 0.6, crouch);
        tgt[FLARE] = 0.45 * star;
        tgt[LIFT] = 0.05 * star;
        eyes = 'happy';
        mouth = hgt > 0.2 ? 'open' : 'grin';
        const apex = h1 > 0.95 ? 1 : h2 > 0.95 ? 2 : 0;
        if (apex && E.fired[apex] !== 1) { E.fired[apex] = 1; emit('star', body, 0, 1.4, 0, { count: 7, spread: 0.6 }); }
        break;
      }
      case 'heart': {
        tgt[ALX] = mix(tgt[ALX], -1.1, k); tgt[ARX] = mix(tgt[ARX], -1.1, k);
        tgt[ALZ] = mix(tgt[ALZ], -0.45, k); tgt[ARZ] = mix(tgt[ARZ], 0.45, k);
        tgt[ELX] = mix(tgt[ELX], -1.0, k); tgt[ERX] = mix(tgt[ERX], -1.0, k);
        tgt[HZ] = 0.2 * k * Math.sin(e * 2.2);
        tgt[TX] = -0.04 * k;
        tgt[RRZ] = Math.sin(e * 3) * 0.04 * k;
        eyes = 'happy';
        mouth = 'grin';
        heartProp.visible = k > 0.05;
        const pop = k * (1 + 0.1 * Math.sin(e * 9));
        heartProp.scale.setScalar(Math.max(0.001, pop));
        const beat = Math.floor((e - 0.45) / 0.65);
        if (e > 0.45 && beat !== E.fired[0] && e < d - 0.3) { E.fired[0] = beat; emit('heart', heartProp, 0, 0.05, 0, { count: 4, spread: 0.25 }); }
        break;
      }
      case 'sit': {
        tgt[RPY] = mix(tgt[RPY], -(HIP - 0.095), k);
        tgt[LLX] = mix(tgt[LLX], -1.45, k); tgt[LRX] = mix(tgt[LRX], -1.45, k);
        tgt[KL] = mix(tgt[KL], 0.3, k); tgt[KR] = mix(tgt[KR], 0.4, k);
        tgt[LLZ] = 0.07 * k; tgt[LRZ] = -0.07 * k;
        tgt[ALX] = mix(tgt[ALX], 0.5, k); tgt[ARX] = mix(tgt[ARX], 0.5, k);
        tgt[ALZ] = mix(tgt[ALZ], 0.25, k); tgt[ARZ] = mix(tgt[ARZ], -0.25, k);
        tgt[ELX] = tgt[ERX] = 0;
        tgt[TX] = -0.1 * k;
        tgt[HZ] = Math.sin(e * 1.2) * 0.1 * k;
        tgt[SIT] = k;
        eyes = e % 3 > 2.4 ? 'happy' : 'open';
        mouth = look.face.smile;
        break;
      }
      default:
        break;
    }
    E.eyes = eyes;
    E.mouth = mouth;
  }

  // ----- secondary motion -----

  function springs(dt, s, a) {
    const dyn = parts.dyn;
    if (!dyn) return;
    const snap = snapSecondary;
    const lying = s.sleeping ? 0.2 : 1;
    const spinAbs = Math.min(8, Math.abs(spinRate));
    for (let ci = 0; ci < dyn.chains.length; ci++) {
      const ch = dyn.chains[ci];
      const st = ch.state;
      const n = ch.bones.length;
      let tx, tz;
      if (ch.kind === 'cape') {
        tx = 0.06 + Math.max(0, fwd) * 0.11 + (s.flying ? 0.95 : 0) + (airW > 0.5 && vy < 0 ? 0.35 : 0) + Math.sin(t * 5) * 0.04 * a + spinAbs * 0.12;
        tz = -yawRate * 0.08;
      } else {
        tx = Math.max(-0.1, fwd * 0.055) + Math.sin(walkPhase * 2) * 0.09 * a + (ch.back ? spinAbs * 0.1 : 0) + (s.flying ? 0.5 : 0);
        tz = Math.sin(walkPhase) * 0.08 * a - yawRate * 0.12 + ch.side * spinAbs * 0.12 + (airW > 0.5 ? ch.side * 0.12 : 0);
        tx *= ch.swing * lying;
        tz *= ch.swing * lying;
      }
      // soft floating hair in sea form (not while riding a dolphin)
      const floaty = ch.kind !== 'cape' && seaW > 0.5 && !s.riding;
      if (floaty) tx = tx * 0.5 + 0.32 + Math.sin(t * 1.3 + ci) * 0.08;
      tz = Math.max(-0.9, Math.min(0.9, tz));
      const K = ch.kind === 'cape' ? 34 : floaty ? 30 : 70, C = ch.kind === 'cape' ? 7 : floaty ? 6 : 9;
      for (let i = 0; i < n; i++) {
        const j = i * 4;
        const gx = i === 0 ? tx : st[j - 4] * 0.5;
        const gz = i === 0 ? tz : st[j - 2] * 0.5;
        if (snap) {
          st[j] = gx; st[j + 1] = 0; st[j + 2] = gz; st[j + 3] = 0;
        } else {
          st[j + 1] += ((gx - st[j]) * K - st[j + 1] * C) * dt;
          st[j] += st[j + 1] * dt;
          st[j + 3] += ((gz - st[j + 2]) * K - st[j + 3] * C) * dt;
          st[j + 2] += st[j + 3] * dt;
        }
        ch.bones[i].rotation.set(st[j], 0, st[j + 2]);
      }
    }
    for (let si = 0; si < dyn.swings.length; si++) {
      const sw = dyn.swings[si];
      const gx = Math.max(-0.02, 0.02 + Math.max(0, fwd) * 0.035 + Math.abs(Math.sin(walkPhase * 2)) * 0.035 * a + spinAbs * 0.05 + (s.flying ? 0.35 : 0)) * lying;
      const gz = Math.max(-0.3, Math.min(0.3, -yawRate * 0.04));
      if (snap) { sw.ax = gx; sw.az = gz; sw.vx = sw.vz = 0; }
      sw.vx += ((gx - sw.ax) * 50 - sw.vx * 8) * dt;
      sw.ax += sw.vx * dt;
      sw.vz += ((gz - sw.az) * 50 - sw.vz * 8) * dt;
      sw.az += sw.vz * dt;
      sw.bone.rotation.set(Math.max(-0.02, sw.ax), 0, sw.az);
    }
    // wings
    if (dyn.wings.length) {
      const flying = s.flying;
      wingPhase += dt * (flying ? 11 : airW > 0.5 ? 7 : a > 0.1 ? 3.4 : 2.1);
      const amp = flying ? 0.5 : airW > 0.5 ? 0.32 : 0.1 + 0.08 * a;
      for (let wi = 0; wi < dyn.wings.length; wi++) {
        const w = dyn.wings[wi];
        const ang = w.rest + (flying ? -0.12 : 0) + Math.sin(wingPhase) * amp * (w.kind === 'angel' ? 0.6 : 1);
        w.bone.rotation.set(0, w.side * ang, w.kind === 'angel' ? -w.side * (0.1 + Math.sin(wingPhase) * 0.08) : 0);
      }
      for (let i = 0; i < wingMats.length; i++) wingMats[i].emissiveIntensity = 0.22 + 0.2 * Math.sin(t * 3 + i);
    }
    if (dyn.halo) {
      dyn.halo.position.y = 0.88 + Math.sin(t * 2) * 0.018;
      dyn.halo.rotation.y = t * 0.8;
    }
    // balloon on a string, lagging behind the hand
    if (dyn.balloon) {
      const { ball, string } = dyn.balloon;
      v2.set(0, -0.215, 0.02);
      bones.elbowR.updateWorldMatrix(true, false);
      bones.elbowR.localToWorld(v2);
      body.worldToLocal(v2);
      v3.set(v2.x - 0.12, v2.y + 1.12 + Math.sin(t * 1.7) * 0.03, v2.z - 0.08);
      if (snap) {
        balloonPos.copy(v3);
        balloonVel.set(0, 0, 0);
      } else {
        balloonVel.x += ((v3.x - balloonPos.x) * 16 - balloonVel.x * 4) * dt;
        balloonVel.y += ((v3.y - balloonPos.y) * 16 - balloonVel.y * 4) * dt;
        balloonVel.z += ((v3.z - balloonPos.z) * 16 - balloonVel.z * 4) * dt;
        balloonPos.addScaledVector(balloonVel, dt);
      }
      ball.position.copy(balloonPos);
      ball.rotation.set(balloonVel.z * 0.12, 0, -balloonVel.x * 0.12);
      v3.set(balloonPos.x, balloonPos.y - 0.25, balloonPos.z);
      v1.copy(v3).add(v2).multiplyScalar(0.5);
      string.position.copy(v1);
      v1.subVectors(v3, v2);
      const len = Math.max(0.01, v1.length());
      string.quaternion.setFromUnitVectors(UP, v1.multiplyScalar(1 / len));
      string.scale.set(1, len, 1);
    }
    // items that stay upright in the hand (teddy, ice cream, purse)
    if (dyn.upright) {
      q1.copy(bones.armR.quaternion).multiply(bones.elbowR.quaternion).invert();
      dyn.upright.quaternion.copy(q1);
      if (parts.handPose === 'purse') {
        const gx = -tgt[ARX] * 0.6 + fwd * 0.03;
        purseV += ((gx - purseA) * 40 - purseV * 3) * dt;
        purseA += purseV * dt;
        purseVZ += ((-yawRate * 0.1 - purseZ) * 40 - purseVZ * 3) * dt;
        purseZ += purseVZ * dt;
        dyn.upright.rotateX(purseA);
        dyn.upright.rotateZ(purseZ);
      }
    }
    if (dyn.wandTip && fx) {
      wandTimer -= dt;
      if (wandTimer <= 0) {
        wandTimer = a > 0.2 ? 0.1 : 0.28;
        emit('sparkle', dyn.wandTip, 0, 0, 0, a > 0.2 ? WAND_FX_FAST : WAND_FX);
      }
    }
    snapSecondary = false;
  }

  // ----- update -----

  function update(dt, s = {}) {
    dt = Math.min(Math.max(dt || 0, 0), 0.1);
    t += dt;
    const gp = group.position;
    const yaw = group.rotation.y;
    if (hasPrev && dt > 0) {
      const dx = gp.x - prevX, dy = gp.y - prevY, dz = gp.z - prevZ;
      if (dx * dx + dz * dz < 4 && Math.abs(dy) < 2) {
        const k = Math.min(1, dt * 10);
        mvSpeed += (Math.hypot(dx, dz) / dt - mvSpeed) * k;
        vy += (dy / dt - vy) * Math.min(1, dt * 12);
        fwd += ((dx * Math.sin(yaw) + dz * Math.cos(yaw)) / dt - fwd) * k;
      }
      yawRate += (angleDelta(prevYaw, yaw) / dt - yawRate) * Math.min(1, dt * 8);
    }
    hasPrev = true;
    prevX = gp.x; prevY = gp.y; prevZ = gp.z; prevYaw = yaw;
    const speed = s.riding ? mvSpeed : (s.speed ?? mvSpeed);

    // sea form: the weight grows toward the target; nothing is resolved on land (s.sea false, w 0)
    if (s.sea || seaW > 0) {
      const form = seaFormNow();
      const ridingOk = !s.riding || !!s.seaRide;
      seaTarget = s.sea && form !== 'me' && !s.sitting && !s.sleeping && ridingOk ? 1 : 0;
      if (seaTarget > 0) ensureSea(form, seaHexFor(form));
      const fast = s.seaCut || s.sitting || (s.riding && !s.seaRide) || s.sleeping || s.flying;
      const rateW = fast ? 1 / SEA_CUT : 1 / SEA_GROW;
      const before = seaW;
      seaW = snapSecondary ? seaTarget : seaTarget > seaW ? Math.min(seaTarget, seaW + rateW * dt) : Math.max(seaTarget, seaW - rateW * dt);
      if (!snapSecondary && before <= 0.5 && seaW > 0.5) {
        seaFlash = 1;
        seaMouthT = 0.6;
        seaGlintT = 0;
        emit('sparkle', bones.hips, 0, -0.1, 0, SEA_IN_FX);
        emit('bubble', bones.hips, 0, -0.2, 0, SEA_BUBBLE_FX);
      } else if (!snapSecondary && before > 0.5 && seaW <= 0.5) {
        emit('sparkle', bones.hips, 0, -0.1, 0, SEA_OUT_FX);
      }
    } else seaTarget = 0;
    const tail = seaW > 0.5;
    bones.legL.visible = bones.legR.visible = !tail;
    for (let i = 0; i < parts.flareMeshes.length; i++) parts.flareMeshes[i].visible = !tail;
    if (sea) {
      const vis = seaW > 0.01;
      sea.root.visible = vis;
      for (const b of sea.bones) b.visible = vis;
    }

    // pick the pose
    tgt.fill(0);
    let rate = 16;
    if (emote && ((speed > 0.6 && !tail) || s.sitting || s.sleeping || s.riding || (s.swimming && !tail) || (tail && !ARM_ONLY.has(emote.name)))) endEmote();
    const seaEmote = () => {
      if (!emote) return;
      emote.e += dt;
      if (emote.e >= emote.dur) endEmote();
      else poseEmote(dt);
    };
    if (s.sleeping) { poseSleep(); rate = 6; }
    else if (s.riding && s.seaRide && tail) { poseSaddleSea(dt, s); rate = 12; }
    else if (s.sitting || s.riding) { poseSit(!!s.riding, dt); rate = s.riding ? 12 : 8; }
    else if (s.swimming && tail) { poseSea(speed, dt, !!s.onGround, !!s.seaFloat); seaEmote(); rate = 10; }
    else if (s.swimming) poseSwim(speed);
    else if (tail && !s.flying) { poseLeap(dt, s); seaEmote(); rate = 10; }
    else if (s.flying && !emote) poseFly(speed);
    else {
      poseGround(s, dt, speed);
      if (emote) {
        emote.e += dt;
        if (emote.e >= emote.dur) endEmote();
        else { poseEmote(dt); rate = 18; }
      }
    }
    if (!s.sitting && !s.sleeping && !s.riding && !tail) tgt[RPY] += parts.lift;
    // a held item: arm up in front of her (or at her mouth for a bite); emotes keep their arms.
    // Hidden while swimming and while the tail is out (a leap, a dolphin ride: hands on the fin).
    // On a dolphin without a tail (Just Me) she holds it, as on a pony (wave4-integration §1.2).
    heldBone.visible = !s.sleeping && !tail && (!s.swimming || !!s.seaRide);
    if (heldObj && heldBone.visible && !emote) {
      if (heldPose === 'eat') {
        const nib = Math.max(0, Math.sin(t * 7.8)) * 0.16;
        tgt[ARX] = -1.2 - nib; tgt[ARY] = 0.3; tgt[ARZ] = 0.1; tgt[ERX] = -1.55;
      } else {
        const sw2 = s.sitting || s.riding ? 0 : Math.sin(walkPhase) * Math.min(1.25, speed / 4.3);
        tgt[ARX] = -0.35 - sw2 * 0.1; tgt[ARZ] = 0.06; tgt[ERX] = -1.3;
      }
    }
    // blend toward the pose
    const k = snapSecondary ? 1 : 1 - Math.exp(-rate * dt);
    for (let i = 0; i < NCH; i++) {
      if (IS_ANGLE[i]) cur[i] += angleDelta(cur[i], tgt[i]) * k;
      else cur[i] += (tgt[i] - cur[i]) * k;
    }
    spinRate = dt > 0 ? angleDelta(prevRRY, cur[RRY]) / dt : 0;
    prevRRY = cur[RRY];
    // apply
    spin.position.set(cur[RPX], PIVOT_Y + cur[RPY], cur[RPZ]);
    // the leap's twirl: one turn while rising out of the water, added after the smoothing
    if (tail && !s.swimming && !s.flying && !s.riding && !s.onGround && vy > 0.5) leapSpin = Math.min(Math.PI * 2, leapSpin + dt * 13);
    else if (s.swimming || s.onGround || !tail) leapSpin = 0;
    spin.rotation.set(cur[RRX], cur[RRY] + (leapSpin < Math.PI * 2 ? leapSpin : 0), cur[RRZ]);
    bones.torso.rotation.set(cur[TX], cur[TY], cur[TZ]);
    bones.head.rotation.set(cur[HX], cur[HY], cur[HZ]);
    bones.armL.rotation.set(cur[ALX], cur[ALY], cur[ALZ]);
    bones.elbowL.rotation.set(cur[ELX], 0, cur[ELZ]);
    bones.armR.rotation.set(cur[ARX], cur[ARY], cur[ARZ]);
    bones.elbowR.rotation.set(cur[ERX], 0, cur[ERZ]);
    bones.legL.rotation.set(cur[LLX], cur[LLY], cur[LLZ]);
    bones.kneeL.rotation.set(cur[KL], 0, 0);
    bones.legR.rotation.set(cur[LRX], cur[LRY], cur[LRZ]);
    bones.kneeR.rotation.set(cur[KR], 0, 0);
    if (!emote || emote.name !== 'heart') heartProp.visible = false;
    if (sea && seaW > 0) seaTick(dt);
    // skirts (hidden flares under a tail are not deformed)
    if (parts.flares.length && !tail) {
      const stiff = parts.stiff ? 0.45 : 1;
      flareParams.flare = cur[FLARE] * stiff;
      flareParams.swayX = cur[SWX] * stiff;
      flareParams.swayZ = cur[SWZ] * stiff;
      flareParams.sit = cur[SIT];
      flareParams.lift = cur[LIFT] + cur[FLARE] * 0.08 * stiff;
      for (let i = 0; i < parts.flares.length; i++) parts.flares[i].deform(flareParams);
    }
    const a = Math.min(1.25, speed / 4.3);
    springs(dt, s, s.sitting || s.sleeping ? 0 : a);
    if (heldObj) {
      q1.copy(bones.armR.quaternion).multiply(bones.elbowR.quaternion).invert();
      heldBone.quaternion.copy(q1);
    }
    // face
    let eyes = 'open', mouth = look.face.smile;
    if (blinkOn) {
      if (t > nextGlance) {
        if (glanceUntil < t) {
          glanceDir = Math.random() < 0.5 ? -1 : 1;
          glanceUntil = t + 0.9 + Math.random() * 1.2;
        } else {
          glanceDir = 0;
          nextGlance = t + 3 + Math.random() * 5;
        }
      }
      if (glanceUntil < t) glanceDir = 0;
      if (a < 0.1 && glanceDir) eyes = glanceDir < 0 ? 'right' : 'left';
      if (t > nextBlink) {
        blinkUntil = t + 0.13;
        nextBlink = t + (Math.random() < 0.2 ? 0.25 : 2 + Math.random() * 3.5);
      }
      if (t < blinkUntil) eyes = 'blink';
    } else glanceDir = 0;
    if (s.sleeping) {
      eyes = 'sleep';
      mouth = 'sleep';
      zzzTimer -= dt;
      if (zzzTimer <= 0 && fx) {
        zzzTimer = 2.6;
        emit('zzz', bones.head, 0.2, 0.75, 0, ZZZ_FX);
      }
    } else if (emote && emote.eyes) {
      eyes = emote.eyes === 'open' && t < blinkUntil ? 'blink' : emote.eyes;
      mouth = emote.mouth || mouth;
    } else if (seaMouthT > 0) {
      seaMouthT -= dt;
      mouth = 'open'; // a happy gasp as the tail appears
    } else if (s.flying && speed > 5) mouth = 'open';
    else if (airW > 0.6 && vy > 1) mouth = 'o';
    setFace(eyes, mouth);
  }

  /** Forget all motion (next update snaps straight into its pose). */
  function resetPose() {
    emote = null;
    heartProp.visible = false;
    snapSecondary = true;
    hasPrev = false;
    mvSpeed = vy = fwd = yawRate = airW = spinRate = prevRRY = 0;
    walkPhase = wingPhase = 0;
    glanceDir = 0;
    glanceUntil = 0;
    cur.fill(0);
    // snapshots and teleports snap the tail too (no sparkles)
    seaW = seaTarget;
    seaPhase = 0;
    seaFlash = 0;
    seaMouthT = 0;
    leapSpin = 0;
  }

  function endEmote() {
    emote = null;
    heartProp.visible = false;
  }

  function playEmote(name) {
    const dur = EMOTE_DURATIONS[name] || 2;
    emote = { name, e: 0, dur, fired: [-1, -1, -1], eyes: null, mouth: null };
    return dur;
  }

  /** Run the animation for `seconds` in small steps (thumbnails / snapshots). */
  function settle(state = {}, seconds = 0.6, step = 1 / 30) {
    const n = Math.max(1, Math.round(seconds / step));
    for (let i = 0; i < n; i++) update(step, state);
  }

  function dispose() {
    hold(null);
    clearParts(); // disposeSea() first
    for (const e of mats.values()) {
      e.mat.dispose();
      for (const tk of e.texKeys) release(tk);
    }
    mats.clear();
    for (const k of faceKeys) release(k);
    faceKeys = [];
    heartProp.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    if (group.parent) group.parent.remove(group);
    group.clear();
  }

  return {
    group,
    get look() {
      return normalizeLook(look);
    },
    get signature() {
      return sig;
    },
    get emoting() {
      return emote ? emote.name : null;
    },
    get opacity() {
      return opacity;
    },
    setLook,
    update,
    playEmote,
    stopEmote: endEmote,
    resetPose,
    settle,
    setOpacity,
    dispose,
    /** Put an Object3D in her right hand (pose 'hold' | 'eat'), or hold(null) to let go. */
    hold,
    get held() {
      return heldObj;
    },
    /** False while the held item is hidden (swimming, the tail out, asleep). */
    get heldShown() {
      return heldBone.visible;
    },
    /** The form this look shows in deep water: 'mermaid' | 'sea_dragon' | 'me' (cached). */
    get seaForm() {
      return seaFormNow();
    },
    /** The tail is out (more than half grown). */
    get seaShown() {
      return seaW > 0.5;
    },
    /** Change what 'auto' resolves to: (look) => form, or a form string. */
    setSeaAuto,
    /** Build this look's sea parts ahead, hidden (a quiet moment after a world loads), so the
     *  first turn only shows them. Nothing for 'me'; a look change frees them again. */
    prepareSea() {
      const form = seaFormNow();
      if (form !== 'me') ensureSea(form, seaHexFor(form));
      return !!sea;
    },
    /** Probes: what the sea parts are doing. */
    seaParts() {
      let meshes = 0;
      if (sea) for (const m of sea.meshes) if (m.parent) meshes++;
      return {
        built: !!sea, form: sea ? sea.form : null, color: sea ? sea.hex : null, shown: seaW > 0.5, weight: seaW,
        meshes, legsVisible: bones.legL.visible && bones.legR.visible,
        flaresVisible: parts.flareMeshes.every((m) => m.visible), matKeys: sea ? sea.matKeys.slice() : [],
      };
    },
    /** Bones by name (read-only use: photo poses, name tags...). */
    bones,
  };
}

export function install(game) {
  const fxScratch = new THREE.Vector3();
  const worldFx = (kind, pos, o) => {
    if (!game.particles) return;
    fxScratch.copy(pos);
    game.particles.emit(kind, fxScratch, o);
  };
  game.createAvatar = (look, opts = {}) => createAvatar(look, { fx: worldFx, ...opts });
  game.defaultLook = normalizeLook(DEFAULT_LOOK);
  game.lookSignature = lookSignature;
}
