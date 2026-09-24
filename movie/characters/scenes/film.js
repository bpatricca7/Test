// ECHO (characters cut) — the director: blocking, performance, lip-sync, cameras.
//
// Builds the hut (lib/set.js), Maya and Sam (lib/human.js) and the Visitor
// (lib/visitor.js), then for every frame works out where everyone is, what
// they are doing, where they look, when they blink and which mouth shape they
// make, and which shot we are in. Everything is a pure function of film time.
// Until a department's module exists, a simple stand-in with the same API is used.

import { createStandInHuman, createStandInVisitor, createStandInSet } from './standins.js';

export async function create(env) {
  const { THREE, TL, ENV, U } = env;
  const { clamp, lerp, smooth, prog, easeInOut, mulberry32 } = U;

  async function load(path, fn, fallback, ...args) {
    try {
      const mod = await import(path);
      return await mod[fn](env, ...args);
    } catch (e) {
      if (!String(e && e.message).includes('Failed to fetch dynamically imported module')) console.error(`film: ${path}: ${e && e.stack || e}`);
      return fallback(env, ...args);
    }
  }

  const set = await load('../lib/set.js', 'createSet', createStandInSet);
  const maya = await load('../lib/human.js', 'createHuman', createStandInHuman, 'maya');
  const sam = await load('../lib/human.js', 'createHuman', createStandInHuman, 'sam');
  const visitor = await load('../lib/visitor.js', 'createVisitor', createStandInVisitor);

  const interior = new THREE.Scene();
  interior.background = new THREE.Color(0x000000);
  interior.add(set.interior.root, maya.root, sam.root, visitor.root);
  if (visitor.light) interior.add(visitor.light);
  // the set provides a ready exterior scene (sky, fog); fall back to wrapping its root
  let exterior = set.exterior.scene;
  if (!exterior) {
    exterior = new THREE.Scene();
    exterior.background = new THREE.Color(0x000000);
    exterior.add(set.exterior.root);
  }

  const camera = new THREE.PerspectiveCamera(35, 16 / 9, 0.03, 4000);
  // a soft bounce near the lens, as a cinematographer would add, so faces read in the dark hut
  const faceFill = new THREE.PointLight(0xffe2c4, 0, 3.2, 2);
  interior.add(faceFill);
  const out = { scene: interior, camera, update, bloom };

  const B = TL.beats, MK = TL.marks;
  const V3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);
  const mark = id => ({ pos: V3(MK[id].pos), yaw: MK[id].yaw });
  const screen = set.anchors && set.anchors.screen
    ? { center: V3(set.anchors.screen.center), width: set.anchors.screen.width, height: set.anchors.screen.height }
    : { center: new THREE.Vector3(-0.5, 1.12, -1.70), width: 0.62, height: 0.35 };
  const windowPt = set.anchors && set.anchors.window ? V3(set.anchors.window.center) : new THREE.Vector3(2.5, 1.4, 0.3);
  const dishOutside = new THREE.Vector3(9, 5, 2.5);   // what Maya gazes at through the window

  // -------------------------------------------------------------------------
  // small animation toolkit
  // -------------------------------------------------------------------------

  // piecewise keys [[t, v], ...] with smoothstep easing between them
  function keys(t, ks) {
    if (t <= ks[0][0]) return ks[0][1];
    for (let i = 1; i < ks.length; i++) {
      if (t <= ks[i][0]) {
        const [t0, v0] = ks[i - 1], [t1, v1] = ks[i];
        const u = smooth(t0, t1, t);
        return typeof v0 === 'number' ? lerp(v0, v1, u) : v0.map((x, j) => lerp(x, v1[j], u));
      }
    }
    return ks[ks.length - 1][1];
  }
  const angLerp = (a, b, u) => { let d = ((b - a + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI; return a + d * u; };

  // deterministic blink schedule per character
  function makeBlinks(seed, t0, t1) {
    const r = mulberry32(seed), out = [];
    for (let t = t0; t < t1;) { t += 2.2 + r() * 3.6; out.push(t); if (r() < 0.18) out.push(t + 0.28); }
    return out;
  }
  const BLINKS = { maya: makeBlinks(11, 7, 126), sam: makeBlinks(23, 7, 126), visitor: makeBlinks(37, 60, 126) };
  function blinkAt(who, t, extra = []) {
    let b = 0;
    for (const bt of BLINKS[who].concat(extra)) {
      const d = t - bt;
      if (d > -0.06 && d < 0.2) b = Math.max(b, d < 0 ? 1 + d / 0.06 : d < 0.05 ? 1 : 1 - (d - 0.05) / 0.15);
    }
    return clamp(b);
  }
  // small saccades around a gaze target
  function saccade(seed, t, amp) {
    const r = mulberry32(seed + Math.floor(t / 0.7) * 7919);
    return new THREE.Vector3((r() - 0.5) * amp, (r() - 0.5) * amp * 0.6, (r() - 0.5) * amp);
  }

  // walks from the timeline: position, yaw and the walk cycle, feet planting on TL.footsteps
  function walkState(who, t) {
    for (const w of TL.walks) {
      if (w.who !== who) continue;
      const a = mark(w.from), b = mark(w.to);
      const d = (w.end - w.start) / w.steps;
      if (t < w.start - 0.001 || t > w.end + 0.001) continue;
      const u = clamp((t - w.start) / (w.end - w.start));
      const pos = a.pos.clone().lerp(b.pos, u);
      const dir = Math.atan2(b.pos.x - a.pos.x, b.pos.z - a.pos.z);
      const heading = w.backward ? a.yaw : dir;
      const yaw = u < 0.2 ? angLerp(a.yaw, heading, smooth(0, 0.2, u)) : u > 0.8 ? angLerp(heading, b.yaw, smooth(0.8, 1, u)) : heading;
      let phase;
      if (w.gait === 'tri') phase = (t - w.start) / (w.end - w.start) * (w.steps / 3) - 1 / 6;   // plants at 0, 1/3, 2/3
      else { const cyc = (t - w.start) / (2 * d); phase = w.backward ? 0.5 - cyc : cyc; }
      const amount = smooth(w.start, w.start + d * 0.35, t) * (1 - smooth(w.end - d * 0.35, w.end, t));
      const stride = a.pos.distanceTo(b.pos) / w.steps;
      return { pos, yaw, walk: { phase, amount, stride } };
    }
    return null;
  }
  function lastMark(who, t, restMark) {
    let m = restMark;
    for (const w of TL.walks) if (w.who === who && t > w.end) m = w.to;
    return mark(m);
  }

  // ---- lip-sync --------------------------------------------------------------
  const VIS = ['sil', 'PP', 'FF', 'TH', 'DD', 'kk', 'CH', 'SS', 'nn', 'RR', 'aa', 'E', 'I', 'O', 'U'];
  const PH2V = {
    P: 'PP', B: 'PP', M: 'PP', F: 'FF', V: 'FF', TH: 'TH', DH: 'TH', T: 'DD', D: 'DD', DX: 'DD',
    K: 'kk', G: 'kk', NG: 'kk', CH: 'CH', JH: 'CH', SH: 'CH', ZH: 'CH', S: 'SS', Z: 'SS',
    N: 'nn', L: 'nn', R: 'RR', ER: 'RR', AA: 'aa', AH: 'aa', AO: 'O', AW: 'aa', AY: 'aa',
    EH: 'E', AE: 'E', EY: 'E', IH: 'I', IY: 'I', Y: 'I', OW: 'O', OY: 'O', UW: 'U', UH: 'U', W: 'U',
  };
  function visemeOf(p, next) {
    const base = p.replace(/[0-9]/g, '');
    if (base === 'HH') return next ? visemeOf(next, null) : 'sil';
    return PH2V[base] || 'sil';
  }
  // weights for the speaker at time t, with anticipation and blended transitions
  function visemesFor(who, t) {
    const w = Object.fromEntries(VIS.map(k => [k, 0]));
    let talking = 0;
    for (const d of TL.dialogue) {
      if (d.speaker !== who) continue;
      const dur = d.duration || d.target;
      if (t < d.start - 0.2 || t > d.start + dur + 0.2) continue;
      const lt = t - d.start + 0.045;              // lips lead the sound slightly
      const ph = d.phonemes && d.phonemes.length ? d.phonemes : fakePhonemes(d);
      for (let i = 0; i < ph.length; i++) {
        const p = ph[i];
        const ramp = Math.min(0.07, (p.end - p.start) * 0.6);
        const a = smooth(p.start - ramp, p.start + ramp * 0.3, lt) * (1 - smooth(p.end - ramp * 0.3, p.end + ramp, lt));
        if (a <= 0) continue;
        const v = visemeOf(p.p, ph[i + 1] && ph[i + 1].p);
        w[v] += a;
        talking = Math.max(talking, a);
      }
    }
    let s = 0;
    for (const k of VIS) s += w[k];
    if (s > 1) for (const k of VIS) w[k] /= s;
    w.sil = Math.max(w.sil, 1 - Math.min(1, s));
    return { visemes: w, talking };
  }
  // until the voices exist: a rough syllable rhythm from the text so mouths move
  const fakeCache = new Map();
  function fakePhonemes(d) {
    if (fakeCache.has(d.id)) return fakeCache.get(d.id);
    const dur = d.target, letters = d.text.replace(/[^a-z]/gi, '').toUpperCase().split('');
    const map = { A: 'AA', E: 'EH', I: 'IY', O: 'OW', U: 'UW', M: 'M', B: 'B', P: 'P', F: 'F', V: 'V', S: 'S', T: 'T', D: 'D', N: 'N', L: 'L', R: 'R', W: 'W', K: 'K', G: 'G', H: 'HH', Y: 'Y' };
    const ph = [], step = dur / Math.max(1, letters.length);
    letters.forEach((c, i) => ph.push({ p: map[c] || 'AH', start: i * step, end: (i + 1) * step }));
    fakeCache.set(d.id, ph);
    return ph;
  }
  function isSpeaking(who, t) {
    for (const d of TL.dialogue) if (d.speaker === who && t >= d.start && t <= d.start + (d.duration || d.target)) return d;
    return null;
  }
  const loud = (who, t) => U.envAt(ENV, `${who}_rms`, t);

  // -------------------------------------------------------------------------
  // performances
  // -------------------------------------------------------------------------
  const tmp = new THREE.Vector3();
  const eyeOf = (c) => { const v = new THREE.Vector3(); c.getEye(v); return v; };

  // speech-driven head motion: small nods on stressed syllables, a slow sway,
  // and a settle at the end of the line
  function talkHead(who, t, amt = 1) {
    let pitch = 0, yaw = 0, roll = 0;
    for (const d of TL.dialogue) {
      if (d.speaker !== who) continue;
      const dur = d.duration || d.target;
      const k = U.window01(t, d.start - 0.1, d.start + dur + 0.5, 0.15, 0.5);
      if (k <= 0) continue;
      const lt = t - d.start;
      const env = Math.max(loud(who, t), 0.5 * visemesFor(who, t).talking);
      pitch += k * amt * (0.05 * env * Math.sin(lt * 9.0) + 0.035 * Math.sin(lt * 2.3 + d.start));
      yaw += k * amt * 0.06 * Math.sin(lt * 1.7 + d.start * 3);
      roll += k * amt * 0.03 * Math.sin(lt * 1.3 + d.start);
      // a little downward nod as the line lands
      pitch += amt * 0.07 * U.window01(t, d.start + dur - 0.25, d.start + dur + 0.45, 0.15, 0.3);
    }
    return { pitch, yaw, roll };
  }
  // a listener's nods while the other person talks
  function listenNods(who, t, amt = 1) {
    let p = 0;
    for (const d of TL.dialogue) {
      if (d.speaker === who) continue;
      const dur = d.duration || d.target;
      p += amt * 0.05 * U.window01(t, d.start + dur * 0.55, d.start + dur + 0.6, 0.2, 0.35) * Math.sin((t - d.start) * 6);
    }
    return p;
  }
  // a quick 0 -> 1 -> 0 pulse
  const pulse = (t, at, up = 0.12, down = 0.5) => t < at ? 0 : t < at + up ? (t - at) / up : Math.max(0, 1 - (t - at - up) / down);
  const addArm = (arm, k, v) => { arm[k] = Math.max(arm[k] || 0, v); };
  function normArm(arm) {
    let s = 0;
    for (const k in arm) if (k !== 'rest') s += arm[k];
    arm.rest = Math.max(0, 1 - s);
  }

  function perfSam(t) {
    const s = { t, sit: 1, seatHeight: 0.47, brows: {}, eyes: {}, mouth: {}, armL: {}, armR: {} };
    const chair = mark('sam_chair');
    const rollU = smooth(B.sam_backs_off.start, B.sam_backs_off.start + 0.6, t);
    const chairPos = chair.pos.clone().lerp(mark('sam_chair_back').pos, rollU);
    // spins the chair round to Maya for d01-d03, back to the screen as she comes over,
    // a nervous little swivel while the pulses run
    let yaw = keys(t, [[16.9, Math.PI], [17.9, Math.PI + 1.3], [26.8, Math.PI + 1.3], [27.8, Math.PI + 0.4], [30.4, Math.PI + 0.4], [31.4, Math.PI]]);
    yaw += 0.08 * Math.sin(t * 1.1) * U.window01(t, 39, 45.5, 1, 1);
    yaw = angLerp(yaw, mark('sam_chair_back').yaw, rollU);
    s.position = chairPos.toArray();
    s.yaw = yaw;
    s.chair = { pos: chairPos.toArray(), yaw };

    // asleep face-down on the desk -> jolts awake
    const wake = smooth(B.sam_wakes.start + 0.05, B.sam_wakes.end, t);
    s.startle = pulse(t, B.sam_wakes.start, 0.1, 0.55) + pulse(t, B.surge.start + 0.05, 0.1, 0.8);
    s.energy = lerp(0, 0.85, wake);
    s.lean = lerp(0.95, 0.1, wake);
    s.head = { pitch: lerp(0.55, 0, wake), yaw: 0, roll: lerp(0.25, 0, wake) };
    addArm(s.armL, 'desk', 1 - wake); addArm(s.armR, 'desk', 1 - wake);
    const asleep = 1 - smooth(B.sam_wakes.start + 0.1, B.sam_wakes.start + 0.5, t);

    // "Maya. Maya! Wake up." - an arm flung out toward her
    addArm(s.armR, 'point', 0.6 * U.window01(t, 18.9, 20.3, 0.25, 0.5));
    // d03: both hands up, excited
    addArm(s.armL, 'gesture', 0.8 * U.window01(t, 24.2, 26.8, 0.25, 0.5));
    addArm(s.armR, 'gesture', 0.9 * U.window01(t, 24.2, 26.8, 0.2, 0.5));

    // at the desk while Maya reads the screen; a head scratch on "then nothing"
    const atDesk = smooth(30.8, 32, t) * (1 - smooth(B.sam_backs_off.start - 0.3, B.sam_backs_off.start, t));
    s.lean = lerp(s.lean, 0.35 + 0.1 * Math.sin(t * 0.7), atDesk);
    const scratch = U.window01(t, 43.2, 45.0, 0.3, 0.4);
    addArm(s.armL, 'desk', atDesk * (1 - scratch)); addArm(s.armR, 'desk', atDesk);
    addArm(s.armL, 'scratch', scratch);
    // d06 reading off the counter: a quick emphatic beat
    addArm(s.armR, 'beat', 0.7 * U.window01(t, 41.3, 42.6, 0.15, 0.3));
    // Maya reaches over him; he leans out of the way
    const dodge = U.window01(t, B.maya_reach_key.start - 0.2, B.maya_reach_key.end + 0.2, 0.3, 0.4);
    s.lean -= 0.25 * dodge;

    // "Then who is that?" - points hard at the screen
    const pt = U.window01(t, B.sam_points.start, B.sam_points.end, 0.3, 0.5);
    addArm(s.armR, 'point', pt); s.armR.desk = (s.armR.desk || 0) * (1 - pt);
    s.pointAt = screen.center.clone().add(new THREE.Vector3(0.12, -0.06, 0)).toArray();
    s.lean += 0.25 * pt;

    // the surge: shoves back from the desk, stands, backs away, then edges in behind Maya
    const stand = smooth(B.sam_backs_off.start + 0.6, B.sam_backs_off.start + 1.4, t);
    s.sit = 1 - stand;
    const walk = walkState('sam', t);
    if (walk) { s.position = walk.pos.toArray(); s.yaw = walk.yaw; s.walk = walk.walk; }
    else if (t > B.sam_backs_off.end) { const m = lastMark('sam', t, 'sam_chair_back'); s.position = m.pos.toArray(); s.yaw = m.yaw; }
    else if (stand > 0) s.yaw = angLerp(yaw, mark('sam_retreat').yaw, stand);
    if (stand > 0) {
      s.armL.desk = (s.armL.desk || 0) * (1 - stand); s.armR.desk = (s.armR.desk || 0) * (1 - stand);
      s.lean = lerp(s.lean, -0.2, stand);
      // hands half-raised, defensive, while it forms
      addArm(s.armL, 'raise', 0.35 * U.window01(t, 67.8, 76.5, 0.5, 1.5));
      addArm(s.armR, 'raise', 0.25 * U.window01(t, 67.8, 76.5, 0.5, 1.5));
    }
    // later: arms crossed, hugging himself; hands in the hoodie pocket at the end
    addArm(s.armL, 'cross', 0.8 * U.window01(t, 81.6, 99.5, 1.0, 1.0));
    addArm(s.armR, 'cross', 0.8 * U.window01(t, 81.6, 99.5, 1.0, 1.0));
    addArm(s.armR, 'gesture', 0.6 * U.window01(t, 101.0, 102.9, 0.3, 0.5));
    addArm(s.armL, 'pocket', U.window01(t, 103.2, 126, 0.8, 1));
    addArm(s.armR, 'pocket', U.window01(t, 103.6, 126, 0.8, 1));
    s.gesturePhase = t * 1.4;
    s.reachAt = null;

    // gaze
    const vHead = eyeOf(visitor);
    let look = screen.center.clone();
    const mayaEye = eyeOf(maya);
    if (t > 17.7 && t < 27.6) look = mayaEye;
    if (t > 36.2 && t < 36.9) look = mayaEye;
    if (t > 45.1 && t < 46.0) look = mayaEye;
    if (t > 58.6 && t < 59.4) look = mayaEye;
    if (t > 66.3) look = vHead;
    if (t > 77.0 && t < 78.4) look = mayaEye;
    if (t > 95.2) look = windowPt.clone().lerp(vHead, 1 - smooth(95.2, 98.5, t));
    if (t > 100.2) look = mayaEye;
    s.lookAt = look.clone().add(saccade(101, t, 0.04 + 0.03 * U.window01(t, 66, 96, 1, 1))).toArray();
    s.headFollow = t > 66.3 && t < 95 ? 0.6 : 0.5;
    const th = talkHead('sam', t, 1.3);
    s.head.pitch += th.pitch + listenNods('sam', t, 0.8);
    s.head.yaw += th.yaw;
    s.head.roll += th.roll;
    s.shake = 0.5 * U.window01(t, 77.2, 78.3, 0.2, 0.3);

    // face
    const fear = U.window01(t, 66.6, 96, 0.4, 2.0);
    s.eyes.wide = 0.8 * fear + 0.4 * U.window01(t, 16.0, 19, 0.1, 1.5) + 0.5 * U.window01(t, 62.3, 66.3, 0.3, 0.4);
    s.brows.raise = 0.6 * fear + 0.5 * U.window01(t, 62.3, 66, 0.3, 0.5) + 0.4 * U.window01(t, 18.6, 21, 0.2, 0.6) + 0.3 * U.window01(t, 24.2, 27, 0.2, 0.5);
    s.brows.sad = 0.35 * U.window01(t, 100.6, 104, 0.4, 1.0) + 0.3 * fear;
    s.brows.furrow = 0.35 * U.window01(t, 40.8, 45.0, 0.5, 0.8);
    s.mouth.smile = 0.35 * U.window01(t, 106.8, 126, 1.0, 1.0) + 0.2 * U.window01(t, 33.0, 36.5, 0.8, 0.8);
    const lip = visemesFor('sam', t);
    s.visemes = lip.visemes;
    s.mouth.jaw = 0.14 * fear * (1 - lip.talking) + 0.2 * U.window01(t, 66.8, 73.5, 0.3, 1.5) * (1 - lip.talking);
    s.blink = Math.max(asleep, blinkAt('sam', t, [16.25, 16.55, 66.62]));
    normArm(s.armL); normArm(s.armR);
    return s;
  }

  function perfMaya(t) {
    const s = { t, sit: 1, seatHeight: 0.42, brows: {}, eyes: {}, mouth: {}, armL: {}, armR: {} };
    const chair = mark('maya_armchair');
    s.position = chair.pos.toArray(); s.yaw = chair.yaw;
    const armOff = smooth(B.maya_arm_off_eyes, B.maya_arm_off_eyes + 0.9, t);
    s.recline = 1 - smooth(B.maya_sits_forward.start, B.maya_sits_forward.end, t);
    addArm(s.armL, 'overEyes', 1 - armOff);
    s.lean = 0.4 * U.window01(t, B.maya_sits_forward.start, B.maya_stands.end, 0.6, 0.5);
    const stand = smooth(B.maya_stands.start, B.maya_stands.end, t);
    s.sit = 1 - stand;
    s.energy = lerp(0.05, 0.55, smooth(22.5, 28, t)) + 0.3 * U.window01(t, 66.5, 97, 1, 2);
    if (stand > 0) s.position = chair.pos.clone().lerp(mark('maya_stand').pos, stand).toArray();
    // stretches and rubs her neck as she gets up
    addArm(s.armR, 'scratch', 0.7 * U.window01(t, 28.4, 30.0, 0.4, 0.4));

    const walk = walkState('maya', t);
    if (walk) { s.position = walk.pos.toArray(); s.yaw = walk.yaw; s.walk = walk.walk; s.sit = 0; s.recline = 0; }
    else if (t > B.maya_walks.end) {
      const m = lastMark('maya', t, 'maya_stand');
      s.position = m.pos.toArray(); s.yaw = m.yaw; s.sit = 0; s.recline = 0;
    }

    // at the desk: hands planted, leaning in to read; hand to chin; the explaining beat;
    // then she reaches over Sam and hits the key
    const desk = U.window01(t, B.maya_walks.end - 0.2, B.maya_steps_forward.start, 0.6, 0.4);
    const reach = U.window01(t, B.maya_reach_key.start, B.maya_reach_key.end, 0.45, 0.45);
    const chin = 0.85 * U.window01(t, 36.4, 40.8, 0.5, 0.6);
    const explain = 0.8 * U.window01(t, 44.9, B.maya_reach_key.start + 0.2, 0.25, 0.3);
    addArm(s.armL, 'lean', desk * (1 - chin * 0.2) * (1 - reach) * 0.9);
    addArm(s.armR, 'lean', desk * (1 - chin) * (1 - explain) * (1 - reach) * 0.9);
    addArm(s.armR, 'chin', chin);
    addArm(s.armR, 'gesture', explain);
    addArm(s.armR, 'reach', reach);
    s.reachAt = [screen.center.x + 0.05, 0.78, screen.center.z + 0.28];
    s.lean = Math.max(s.lean, 0.3 * desk + 0.35 * reach);
    s.gesturePhase = (t - 44.9) * 1.7;
    // awe at the picture: hand to mouth-ish (chin), then steps back a touch
    addArm(s.armL, 'chin', 0.6 * U.window01(t, 56.4, 61.5, 0.6, 0.8));
    // facing the Visitor: arms slightly out, open; gestures on her questions
    addArm(s.armR, 'gesture', 0.55 * U.window01(t, 78.9, 80.6, 0.3, 0.5) + 0.6 * U.window01(t, 87.2, 88.9, 0.3, 0.5));
    s.gesturePhase = t > 70 ? (t - 78.9) * 1.2 : s.gesturePhase;
    // she raises her hand to answer its gesture
    addArm(s.armR, 'raise', U.window01(t, B.maya_raises_hand.start, B.dematerialize.start + 1.5, 1.2, 1.0));
    // at the window: a hand on the sill... on her hip, looking out
    addArm(s.armL, 'hips', 0.7 * U.window01(t, 106.0, 126, 0.8, 1));

    // gaze
    const vHead = eyeOf(visitor);
    const samEye = eyeOf(sam);
    let look = samEye;
    if (t > 30.6) look = screen.center.clone();
    if (t > 45.2 && t < 46.2) look = samEye;
    if (t > 58.4 && t < 59.2) look = samEye;
    if (t > 63.2 && t < 64.2) look = samEye;
    if (t > 67.0) look = vHead;
    if (t > 95.2) look = windowPt.clone().lerp(vHead, 1 - smooth(95.2, 98.5, t));
    if (t > 101.0 && t < 102.9) look = samEye;
    if (t > 102.9) look = dishOutside;
    s.lookAt = look.clone().add(saccade(202, t, 0.035)).toArray();
    s.headFollow = 0.5;
    const th = talkHead('maya', t, 1.0);
    s.head = { pitch: th.pitch + listenNods('maya', t, 1.0), yaw: th.yaw, roll: th.roll + 0.12 * U.window01(t, 84.4, 88.6, 0.8, 0.8) };
    s.nod = 0.4 * U.window01(t, 86.2, 87.0, 0.2, 0.3);

    // face
    const asleep = t < B.maya_arm_off_eyes + 1 ? 1 - smooth(B.maya_arm_off_eyes + 0.3, B.maya_arm_off_eyes + 0.8, t) : 0;
    s.blink = Math.max(asleep, blinkAt('maya', t, [23.6, 56.5, 67.5]));
    s.eyes.squint = 0.45 * U.window01(t, 23, 27, 0.5, 1.2) + 0.3 * U.window01(t, 33.5, 44, 0.8, 1);
    s.eyes.wide = 0.55 * U.window01(t, 56.2, 60, 0.5, 1.5) + 0.6 * U.window01(t, 66.8, 76, 0.4, 2.5);
    s.brows.furrow = 0.55 * U.window01(t, 33.5, 44, 0.8, 1.0);
    s.brows.raise = 0.7 * U.window01(t, 56.2, 61, 0.5, 1.5) + 0.55 * U.window01(t, 66.8, 76, 0.4, 3.0) + 0.3 * U.window01(t, 21.4, 23.2, 0.3, 0.6);
    s.brows.sad = 0.35 * U.window01(t, 93.0, 99.5, 1.0, 1.5);
    s.mouth.smile = 0.22 * U.window01(t, 21.2, 23.8, 0.3, 0.8) + 0.6 * U.window01(t, 107.0, 126, 0.8, 1.0)
      + 0.3 * U.window01(t, 84.6, 88, 0.6, 1.0) + 0.35 * U.window01(t, 93.4, 96, 0.6, 1.0);
    const lip = visemesFor('maya', t);
    s.visemes = lip.visemes;
    s.mouth.jaw = 0.12 * U.window01(t, 56.2, 58.5, 0.3, 0.6) * (1 - lip.talking);
    normArm(s.armL); normArm(s.armR);
    return s;
  }

  function perfVisitor(t) {
    const m = lastMark('visitor', t, 'visitor');
    const s = { t, position: m.pos.toArray(), yaw: m.yaw };
    const walk = walkState('visitor', t);
    if (walk) { s.position = walk.pos.toArray(); s.yaw = walk.yaw; s.walk = walk.walk; }
    s.materialize = smooth(B.materialize.start, B.materialize.end, t);
    s.materializeFrom = { center: screen.center.toArray(), width: screen.width, height: screen.height };
    s.dissolve = smooth(B.dematerialize.start, B.dematerialize.end, t);
    s.dissolveTo = windowPt.toArray();
    s.flicker = 0.12 + 0.6 * U.window01(t, B.surge.start, B.materialize.end, 0.2, 1.5) + 0.4 * s.dissolve;
    const look = t < 76.5 ? eyeOf(sam).lerp(eyeOf(maya), 0.5) : t < 78.2 ? eyeOf(sam) : eyeOf(maya);
    s.lookAt = look.add(saccade(303, t, 0.02)).toArray();
    s.headFollow = 0.6;
    const th = talkHead('visitor', t, 0.8);
    // curious tilts while it listens and looks them over
    s.tilt = 0.18 * Math.sin(t * 0.35 + 1) * U.window01(t, 73, 95, 1.5, 1.5) + 0.25 * U.window01(t, 79.0, 80.8, 0.5, 0.6);
    s.head = { pitch: th.pitch, yaw: th.yaw, roll: th.roll };
    s.crouch = U.window01(t, B.visitor_crouch.start, B.visitor_crouch.end, 1.0, 1.1);
    s.lean = 0.3 * s.crouch + 0.15 * U.window01(t, 76.0, 78.0, 0.6, 0.8);
    s.gesture = U.window01(t, B.visitor_gesture.start, B.visitor_gesture.end, 0.6, 0.5) + 0.4 * U.window01(t, 81.2, 83.6, 0.5, 0.5);
    s.gesturePhase = t * 0.9;
    s.blink = blinkAt('visitor', t, [80.2, 91.6]);
    s.raiseHand = U.window01(t, B.visitor_raises_hand.start, B.dematerialize.start + 1.2, 1.1, 1.0);
    const lip = visemesFor('visitor', t);
    s.visemes = lip.visemes;
    s.glow = Math.max(loud('visitor', t), 0.6 * lip.talking);
    return s;
  }

  // -------------------------------------------------------------------------
  // cameras, one function per shot
  // -------------------------------------------------------------------------
  const P = new THREE.Vector3(), T = new THREE.Vector3();
  const facing = (yaw) => new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
  function hand(t, amp, seed) {
    // gentle handheld drift
    return new THREE.Vector3(
      amp * (Math.sin(t * 0.61 + seed) + 0.5 * Math.sin(t * 1.37 + seed * 2)),
      amp * 0.7 * (Math.sin(t * 0.83 + seed * 3) + 0.4 * Math.sin(t * 1.9 + seed)),
      amp * 0.5 * Math.sin(t * 0.47 + seed * 5));
  }
  function faceShot(char, yawOfChar, t, u, { dist = 0.72, side = 0.18, up = 0.03, fov = 30, lookFrom = null, seed = 1, push = 0.06 }) {
    const eye = eyeOf(char);
    const f = lookFrom ? lookFrom.clone().sub(eye).setY(0).normalize() : facing(yawOfChar);
    const right = new THREE.Vector3(f.z, 0, -f.x);
    P.copy(eye).addScaledVector(f, dist - push * u).addScaledVector(right, side).add(new THREE.Vector3(0, up, 0)).add(hand(t, 0.006, seed));
    T.copy(eye).addScaledVector(right, side * 0.25).add(new THREE.Vector3(0, -0.03, 0));
    return fov;
  }

  const SHOT_FN = {
    ext_push: (t, u) => {
      const sh = set.exterior.anchors && set.exterior.anchors.shots && set.exterior.anchors.shots.ext_push;
      if (sh) { const e = easeInOut(u); P.copy(V3(sh.from)).lerp(V3(sh.to), e); T.copy(V3(sh.lookFrom)).lerp(V3(sh.lookTo), e); return sh.fov || 40; } const a = set.exterior.anchors || {}; const w = V3(a.hutWindow || [0, 2, 0]); const look = V3(a.lookAt || a.hutWindow || [0, 2, 0]);
      const from = V3(a.pushFrom || [look.x + 38, look.y + 7, look.z + 30]);
      P.copy(from).lerp(w.clone().add(new THREE.Vector3(6, 1.2, 6)), easeInOut(u) * 0.8); T.copy(look).lerp(w, easeInOut(u)); return 40; },
    int_wide: (t, u) => { P.set(lerp(2.15, 1.9, u), 1.72, lerp(1.75, 1.5, u)); T.set(-0.95, 0.95, -0.55); return 52; },
    maya_chair_cu: (t, u) => faceShot(maya, MK.maya_armchair.yaw, t, u, { dist: 1.0, side: -0.22, up: 0.1, fov: 32, seed: 3 }),
    sam_mcu: (t, u) => faceShot(sam, 0, t, u, { dist: 1.05, side: 0.2, up: -0.02, fov: 34, lookFrom: eyeOf(maya), seed: 5 }),
    int_wide_up: (t, u) => { P.set(lerp(1.95, 1.55, u), 1.6, lerp(1.6, 1.25, u)).add(hand(t, 0.008, 8));
      T.copy(eyeOf(maya)).add(new THREE.Vector3(0.1, -0.35, 0)); return 50; },   // tracks her across the room
    screen_ots: (t, u) => { P.set(lerp(0.55, 0.45, u), 1.55, lerp(0.55, 0.35, u)).add(hand(t, 0.008, 7)); T.copy(screen.center).add(new THREE.Vector3(0.05, 0.02, 0)); return 38; },
    screen_insert: (t, u) => { P.copy(screen.center).add(new THREE.Vector3(0, 0, lerp(0.52, 0.44, u))).add(hand(t, 0.002, 9)); T.copy(screen.center); return 40; },
    maya_cu_1: (t, u) => faceShot(maya, 0, t, u, { dist: 0.62, side: 0.1, up: 0.0, fov: 30, lookFrom: screen.center, seed: 11 }),
    fold_insert: (t, u) => { P.copy(screen.center).add(new THREE.Vector3(0, 0, lerp(0.5, 0.36, easeInOut(u)))).add(hand(t, 0.002, 13)); T.copy(screen.center); return 40; },
    maya_cu_2: (t, u) => faceShot(maya, 0, t, u, { dist: 0.6, side: -0.08, up: 0.01, fov: 29, lookFrom: screen.center, seed: 15, push: 0.1 }),
    two_shot: (t, u) => { P.set(lerp(-0.08, -0.02, u), 1.44, -1.52).add(hand(t, 0.005, 17)); T.copy(eyeOf(sam)).lerp(eyeOf(maya), 0.5).add(new THREE.Vector3(0, -0.06, 0)); return 42; },
    surge_wide: (t, u) => { P.set(lerp(-1.95, -1.8, u), 1.5, lerp(1.55, 1.35, u)).add(hand(t, 0.01 + 0.02 * U.window01(t, B.surge.start, B.surge.end, 0.1, 0.4), 19));
      T.set(lerp(-0.2, 0.7, smooth(B.materialize.start, B.materialize.end, t)), 1.15, -0.75); return 48; },
    visitor_cu_1: (t, u) => faceShot(visitor, MK.visitor.yaw, t, u, { dist: 0.85, side: 0.12, up: -0.05, fov: 30, seed: 21 }),
    sam_reaction: (t, u) => faceShot(sam, 0, t, u, { dist: 0.9, side: -0.15, up: 0.0, fov: 32, lookFrom: eyeOf(visitor), seed: 23 }),
    maya_ots_visitor: (t, u) => { const v = eyeOf(visitor), m = eyeOf(maya); const f = m.clone().sub(v).setY(0).normalize(); const r = new THREE.Vector3(f.z, 0, -f.x);
      P.copy(v).addScaledVector(f, -0.45).addScaledVector(r, -0.35).add(new THREE.Vector3(0, -0.12, 0)).add(hand(t, 0.006, 25)); T.copy(m).add(new THREE.Vector3(0, -0.05, 0)); return 38; },
    visitor_cu_2: (t, u) => faceShot(visitor, MK.visitor.yaw, t, u, { dist: 0.8, side: -0.14, up: -0.04, fov: 29, lookFrom: eyeOf(maya), seed: 27, push: 0.08 }),
    maya_cu_3: (t, u) => faceShot(maya, 0, t, u, { dist: 0.72, side: 0.0, up: 0.0, fov: 30, lookFrom: eyeOf(visitor).add(new THREE.Vector3(-0.1, 0, 0.75)), seed: 29 }),
    arc_two: (t, u) => {
      // orbit around the space between them as it folds down to her eye level
      const v = eyeOf(visitor), m = eyeOf(maya), mid = v.clone().lerp(m, 0.5);
      const axis = v.clone().sub(m).setY(0).normalize(); const side = new THREE.Vector3(axis.z, 0, -axis.x); if (side.z < 0) side.negate();   // the open side of the room
      const ang = lerp(-0.55, 0.35, easeInOut(u));
      const dir = side.clone().multiplyScalar(Math.cos(ang)).addScaledVector(axis, Math.sin(ang));
      P.copy(mid).addScaledVector(dir, 1.55).add(new THREE.Vector3(0, -0.05, 0)); T.copy(mid).add(new THREE.Vector3(0, -0.06, 0)); return 36;
    },
    hands_two: (t, u) => {
      // over Maya's shoulder: her raised hand on one side of frame, the Visitor's on the other,
      // the two figures of the picture made real
      const v = eyeOf(visitor), m = eyeOf(maya);
      const f = v.clone().sub(m).setY(0).normalize();
      const right = new THREE.Vector3(-f.z, 0, f.x); if (right.z < 0) right.negate();
      P.copy(m).addScaledVector(f, -lerp(1.15, 1.0, u)).addScaledVector(right, 0.42).add(new THREE.Vector3(0, 0.12, 0)).add(hand(t, 0.005, 39));
      T.copy(m).lerp(v, 0.62).add(new THREE.Vector3(0, 0.12, 0)); return 44;
    },
    visitor_ms: (t, u) => { const v = eyeOf(visitor); const f = facing(MK.visitor.yaw);
      P.copy(v).addScaledVector(f, lerp(2.3, 2.0, u)).add(new THREE.Vector3(0, -0.45, 0)).add(hand(t, 0.008, 31)); T.copy(v).add(new THREE.Vector3(0, -0.45, 0)); return 38; },
    dissolve_wide: (t, u) => { P.set(-1.85, 1.45, lerp(-1.0, -0.8, u)).add(hand(t, 0.008, 33)); T.set(lerp(1.3, 2.2, smooth(0.2, 0.9, u)), 1.3, lerp(-0.4, 0.2, u)); return 50; },
    sam_cu_after: (t, u) => faceShot(sam, 0, t, u, { dist: 1.0, side: 0.1, up: 0.0, fov: 32, lookFrom: new THREE.Vector3(1.2, 1.55, 1.7), seed: 35 }),
    maya_window: (t, u) => {
      const walkU = smooth(B.maya_to_window.start, B.maya_to_window.end, t);
      if (walkU < 1) { P.set(lerp(-0.4, 0.2, walkU), 1.5, lerp(1.6, 1.4, walkU)); T.copy(eyeOf(maya)).add(new THREE.Vector3(0, -0.2, 0)); return 42; }
      return faceShot(maya, 0, t, u, { dist: 0.62, side: -0.05, up: 0.0, fov: 30, lookFrom: new THREE.Vector3(2.35, 1.5, -0.35), seed: 37, push: 0.05 });
    },
    ext_dish: (t, u) => {
      const sh = set.exterior.anchors && set.exterior.anchors.shots && set.exterior.anchors.shots.ext_dish;
      if (sh) { const e = easeInOut(u); P.copy(V3(sh.from)).lerp(V3(sh.to), e); T.copy(V3(sh.lookFrom)).lerp(V3(sh.lookTo), e); return sh.fov || 42; } const a = set.exterior.anchors || {}; const d = V3(a.dish || [0, 10, 0]);
      P.copy(d).add(new THREE.Vector3(lerp(34, 30, u), lerp(4, 14, easeInOut(u)), lerp(22, 18, u))); T.copy(d).add(new THREE.Vector3(0, lerp(2, 12, easeInOut(u)), 0)); return 42; },
  };

  function shotAt(t) {
    for (const s of TL.shots) if (t >= s.start && t < s.end) return s;
    return TL.shots[TL.shots.length - 1];
  }

  // -------------------------------------------------------------------------

  function update(t) {
    const shot = shotAt(t);
    const u = prog(t, shot.start, shot.end);
    const isExt = shot.id.startsWith('ext_');
    out.scene = isExt ? exterior : interior;

    const sP = perfSam(t), mP = perfMaya(t), vP = perfVisitor(t);
    // two passes so gaze targets use this frame's eye positions
    sam.set(sP); maya.set(mP); visitor.set(vP);
    const sP2 = perfSam(t), mP2 = perfMaya(t), vP2 = perfVisitor(t);
    // `past` lets the rigs run follow-through (hair, clothes, hands) from the real recent motion
    sP2.past = dt => perfSam(t - dt);
    mP2.past = dt => perfMaya(t - dt);
    vP2.past = dt => perfVisitor(t - dt);
    sam.set(sP2); maya.set(mP2); visitor.set(vP2);

    const surge = U.window01(t, B.surge.start, B.surge.end, 0.15, 0.6);
    const lights = 1 - 0.65 * smooth(B.surge.start, B.surge.end, t) * (1 - smooth(B.lights_return - 0.4, B.lights_return + 0.6, t));
    set.update(t, {
      alarm: t >= B.alarm && t < (B.alarm_dies ?? B.lights_return) ? 0.5 - 0.4 * U.window01(t, B.surge.start, B.alarm_dies, 0.05, 0.05) * (Math.sin(t * 90) > 0 ? 1 : 0) : 0,
      surge, lights,
      hologram: 0.5 * (vP2.materialize || 0) * (1 - (vP2.dissolve || 0)) * (0.8 + 0.4 * (vP2.glow || 0)),
      samChair: sP2.chair,
      dish: { az: keys(t, [[B.dish_turns.start, 0], [B.dish_turns.end, 0.35]]), el: keys(t, [[B.dish_turns.start, 0.55], [B.dish_turns.end, 1.2]]) },
    });

    const fov = (SHOT_FN[shot.id] || SHOT_FN.int_wide)(t, u);
    const close = /_cu|_mcu|reaction|_ots|arc_two|maya_window/.test(shot.id);
    faceFill.position.copy(P).add(new THREE.Vector3(0, 0.25, 0));
    faceFill.intensity = isExt ? 0 : (close ? 0.9 : 0.3) * (0.55 + 0.45 * (1 - U.window01(t, B.surge.start, B.lights_return, 0.3, 0.6)));
    camera.position.copy(P);
    camera.lookAt(T);
    camera.fov = fov;
    camera.updateProjectionMatrix();
  }

  function bloom(t) {
    const v = U.envAt(ENV, 'visitor_rms', t);
    const holo = smooth(B.materialize.start, B.materialize.end, t) * (1 - smooth(B.dematerialize.start, B.dematerialize.end, t));
    return { strength: 0.3 + 0.35 * holo + 0.2 * v, radius: 0.4, threshold: 0.9 - 0.1 * holo };
  }

  return out;
}
