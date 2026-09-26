// AGC program sequencer for both spacecraft.
//
// LM (LGC "Luminary"):
//   P63 braking phase   ignition sequence at PDI TIG (ullage, V99 N62 "please perform engine on",
//                       10 % thrust for 26 s, throttle-up to FTP), quadratic guidance to High Gate,
//                       throttle-down when the command falls below ~60 %, yaw-around to windows-up,
//                       landing-radar lock and delta-h incorporation, optional 1201/1202 alarms.
//   P64 approach        pitch-over, guidance to Low Gate, LPD angle (V06 N64) and redesignation.
//   P66 rate of descent automatic throttle holding vessel.gnc.rodCmd (ROD switch +-1 ft/s), pilot
//                       flies attitude (or, hands-off, the LGC nulls the horizontal velocity).
//   P67 manual          throttle from the TTCA lever.
//   P68 landing confirmation (V06 N43).
//   P12 powered ascent  (PRO at V99 N74) staging, APS ignition, 10-s vertical rise, pitch-over,
//                       guidance to the Apollo 11 insertion target, cut-off, then LOCAL_VERTICAL.
//   P70 / P71           DPS / APS abort to orbit (same ascent steering).
//   P40 DOI             descent orbit insertion after undocking (PRO in P00): DPS retrograde burn
//                       (~23 m/s: 10 % for 15 s, then 40 %) half an orbit before the PDI point; at
//                       cut-off the LGC computes the PDI time and loads P63 ten minutes before it.
//   P00 / P47           idle / thrust monitor (V16 N44 orbit, V16 N83 delta-V).
// CSM (CMC "Colossus"): P00 / P47.
//
// Each step writes S.throttle (null = manual lever), S.ullage (+Y translation request) and the
// guidance attitude S.guid (followed by the DAP when vessel.gnc.autopilot === 'GUIDANCE').

import * as THREE from 'three';
import { LM, FT, G0, MOON, MISSION } from '../core/constants.js';
import { terrainHeight } from '../world/moon.js';
import { quatFromUpForward } from '../core/frames.js';
import * as G from './guidance.js';
import { controlMassProps } from './dap.js';
import { cgPos } from './attitude.js';
import { programAlarm, compBurst, operatorError } from './agc.js';
import { landingCallouts } from './callouts.js';

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

/** Descent sequencing constants (Apollo 11). */
export const DESCENT = {
  ullage: 7.5, // s of +X (our +Y) translation before TIG
  ignitionThrottle: 0.1,
  ignitionHold: 26, // s at 10 % for the gimbal trim
  cycle: 2, // guidance cycle (s)
  yawAround: 260, // s after ignition: yaw to windows-up (PDI + 4:20)
  radarLockAlt: 12500, // m: landing radar acquisition (~41,000 ft)
  radarVelDelay: 16, // s after altitude lock until velocity data are good
  incorporateDelay: 8, // s after lock until the crew enables radar updates (V57)
  incorporateTau: 14, // s, delta-h convergence time constant
  navBias: 880, // m: LGC altitude error at PDI (delta-h ~ -2,900 ft, as on Apollo 11)
  lpdElevStep: 0.5, // deg per LPD click (fore/aft)
  lpdAzStep: 2, // deg per LPD click (left/right)
  lpdElevMin: 12,
  lpdElevMax: 72,
  lpdMaxShift: 6000, // m: max total redesignation distance
  engineStopDelay: 1.0, // s after LUNAR CONTACT (probe) the crew pushes ENGINE STOP (hands-off P66)
  engineStopMax: 5, // s after LUNAR CONTACT at most (pilot-flown P66): engine stop at footpad contact
  // Apollo 11 program alarms (s after ignition) when game.settings.historicalAlarms
  alarms: [
    { t: 317, code: '1202' },
    { t: 357, code: '1202' },
    { t: 553, code: '1201' },
    { t: 578, code: '1202' },
  ],
};

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _rf = new THREE.Vector3();
const _vf = new THREE.Vector3();
const _ac = new THREE.Vector3();
const _g = new THREE.Vector3();
const _gf = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _cg = new THREE.Vector3();

// ------------------------------------------------------------------ helpers

function setDisp(S, verb, noun, flash = false, blank = false) {
  const d = S.disp;
  d.verb = verb;
  d.noun = noun;
  d.flash = flash;
  d.blank = blank;
}

/** Set the guidance attitude command; small updates are spread over one guidance cycle. */
export function setGuid(S, q, rate) {
  const g = S.guid;
  if (!g.valid) {
    g.quat.copy(q);
    g.cmd.copy(q);
    g.valid = true;
    g.step = Infinity;
  } else {
    const ang = g.cmd.angleTo(q);
    g.cmd.copy(q);
    g.step = ang < 6 * D2R ? Math.max(ang / DESCENT.cycle, 0.2 * D2R) : Infinity;
  }
  if (rate) g.rate = rate;
}

/** Advance the smoothed guidance attitude toward the latest command (per substep). */
export function stepGuid(S, h) {
  const g = S.guid;
  if (!g.valid) return;
  if (g.step === Infinity) g.quat.copy(g.cmd);
  else g.quat.rotateTowards(g.cmd, g.step * h);
}

function up(v, out) {
  return out.copy(v.pos).normalize();
}

/** Downrange travel direction of an orbit plane at a point (unit, horizontal). */
function travelAt(pos, vel, targetDir, out) {
  const hvec = _b.crossVectors(pos, vel);
  if (hvec.lengthSq() < 1e-6) return out.set(0, 0, 0);
  return out.crossVectors(hvec, targetDir).normalize();
}

// ------------------------------------------------------------------ descent state

function newDescent(v, tig) {
  return {
    active: true,
    tig,
    proAck: false,
    ignited: false,
    ignTime: null,
    lateIgnAt: null,
    noIgnMsg: false,
    F: null,
    tgo: 600,
    gcyc: 0,
    cmdFrac: 0,
    thrCmd: 0,
    thr: { ftp: true, throttledDown: false },
    windowsUp: false,
    aThr: new THREE.Vector3(),
    dir: new THREE.Vector3(),
    navBias: 0,
    radarLock: false,
    radarGood: false,
    radarVelGood: false,
    lockTime: null,
    deltaH: 0,
    lpdTimer: 0,
    lpdShift: 0,
    origTarget: v.gnc.targetDir.clone(),
    rodAuto: false,
    rodTimer: 0,
    contactTime: null,
    engineStop: false,
    prevVs: null,
    accUp: 0,
    dvAcc: 0,
    alarmIdx: 0,
    said: {},
    p66Timer: 0,
  };
}

function makeFrame(v, d) {
  const travel = travelAt(cgPos(v, _cg), v.vel, v.gnc.targetDir, _c);
  if (travel.lengthSq() < 0.5) {
    // no usable velocity: approach along the LM's forward axis
    const u = up(v, _a);
    travel.set(0, 0, -1).applyQuaternion(v.quat).addScaledVector(u, -travel.dot(u)).normalize();
  }
  d.F = G.makeSiteFrame(v.gnc.targetDir, travel, d.F || {});
}

/** One descent guidance cycle (P63 / P64): thrust vector and attitude command. */
function descentCycle(v, S, tgt) {
  const d = S.descent;
  const F = d.F;
  cgPos(v, _cg);
  G.toFramePos(F, _cg, _rf);
  _rf.x += d.navBias;
  G.toFrameVec(F, v.vel, _vf);
  d.tgo = G.solveTgo(_rf.z, _vf.z, tgt, Math.max(1, d.tgo - DESCENT.cycle));
  G.quadraticAccel(_rf, _vf, tgt, Math.max(d.tgo, 1), _ac);
  G.gravity(_cg, _g);
  G.toFrameVec(F, _g, _gf);
  _ac.sub(_gf);
  G.fromFrameVec(F, _ac, d.aThr);
  const mass = controlMassProps(v).mass;
  d.cmdFrac = (d.aThr.length() * mass) / v.mainEngine.maxThrust;
  d.dir.copy(d.aThr).normalize();
  // windows: -Z toward downrange-and-up (windows up / forward) or toward the surface (windows
  // down). Adding the local vertical keeps the reference well defined when the thrust axis is
  // horizontal (braking at PDI): it then selects windows exactly up or down.
  _a.copy(F.down).addScaledVector(up(v, _b), d.windowsUp ? 1 : -1);
  // P64: yaw about the thrust axis so that the landing site sits on the LPD scale line of the
  // CDR's window (the thrust vector is unchanged by this yaw)
  if (tgt === G.DESCENT_TARGETS.approach && d.windowsUp) {
    const eye = _b.copy(LM.eyeCDR).applyQuaternion(v.quat).add(v.pos);
    if (G.lpdForward(d.dir, eye, F.origin, G.LPD_AZIMUTH, _c)) _a.copy(_c);
  }
  quatFromUpForward(d.dir, _a, _q);
  setGuid(S, _q, 6 * D2R);
  compBurst(S.agc, 0.6 + Math.random() * 0.4);
}

/** Landing radar: acquisition, delta-h, and the LGC's incorporation of the radar altitude. */
function radarCycle(v, S, ctx) {
  const d = S.descent;
  const t = v.tel;
  const met = ctx.game.time.met;
  let ra = t.radarAltitude;
  if (!Number.isFinite(ra) && !v.staged && t.altitude < DESCENT.radarLockAlt) {
    // LR antenna in position 1: beams tilted 24 deg from -Y toward +Z (the LM's back), so the
    // radar sees the surface once the LM has yawed to windows-up.
    const beam = _a.set(0, -Math.cos(24 * D2R), Math.sin(24 * D2R)).applyQuaternion(v.quat);
    const c = -beam.dot(up(v, _b));
    if (c > 0.5 || t.altitude < 6000) ra = t.gearAltitude;
  }
  d.radarGood = Number.isFinite(ra) && t.altitude < DESCENT.radarLockAlt;
  if (d.radarGood) d.deltaH = ra - (t.gearAltitude + d.navBias);
  if (d.radarGood && !d.radarLock) {
    d.radarLock = true;
    d.lockTime = met;
    const dh = Math.round(d.deltaH / FT / 100) * 100;
    ctx.say(`Altitude light's out. Delta-H is ${dh < 0 ? 'minus' : 'plus'} ${Math.abs(dh).toLocaleString('en-US')}.`, 'LMP', 1.5);
    ctx.message(`Landing radar lock — delta-H ${Math.round(d.deltaH / FT)} ft`, 'good');
  }
  d.radarVelGood = d.radarLock && d.radarGood && met - d.lockTime > DESCENT.radarVelDelay;
  if (d.radarLock && met - d.lockTime > DESCENT.incorporateDelay) {
    if (!d.said.v57) {
      d.said.v57 = true;
      ctx.message('V57 — radar updates enabled: the LGC is incorporating landing-radar altitude', 'info');
    }
    d.navBias *= Math.exp(-DESCENT.cycle / DESCENT.incorporateTau);
    if (Math.abs(d.navBias) < 0.5) d.navBias = 0;
  }
}

function historicalAlarms(v, S, ctx) {
  const d = S.descent;
  if (!ctx.game.settings.historicalAlarms || d.alarmIdx >= DESCENT.alarms.length) return;
  const al = DESCENT.alarms[d.alarmIdx];
  if (ctx.game.time.met - d.ignTime < al.t) return;
  d.alarmIdx++;
  const text = al.code === '1202' ? 'Program alarm 1202 — Executive overflow: no core sets' : 'Program alarm 1201 — Executive overflow: no VAC areas';
  programAlarm(v, S.agc, ctx.game, al.code, text);
  if (d.alarmIdx === 1) {
    ctx.say('Program alarm.', 'CDR', 0.3);
    ctx.say(`It's a ${al.code}.`, 'CDR', 3.5);
    ctx.say('Give us a reading on the 1202 program alarm.', 'CDR', 14);
    ctx.say("Roger. We got — we're go on that alarm.", 'CAPCOM', 27);
  } else {
    ctx.say(`Program alarm. ${al.code}.`, 'LMP', 0.4);
    ctx.say(al.code === '1201' ? "Roger. 1201 alarm. We're go. Same type. We're go." : "Roger. We're go on that alarm.", 'CAPCOM', 9);
  }
}

// ------------------------------------------------------------------ program entry points

/** Change the major mode (emits 'program'). */
export function setProgram(v, S, ctx, p) {
  if (v.gnc.program === p) return;
  v.gnc.program = p;
  ctx.game.events.emit('program', { vessel: v.id, program: p });
  compBurst(S.agc, 0.8);
}

/** P63 with ignition at `tig` (MET s). */
export function startP63(v, S, ctx, tig) {
  S.descent = newDescent(v, tig);
  const d = S.descent;
  makeFrame(v, d);
  d.navBias = DESCENT.navBias;
  // windows up or down at the start (-Z relative to local up)
  d.windowsUp = _a.set(0, 0, -1).applyQuaternion(v.quat).dot(up(v, _b)) > 0;
  d.tgo = G.solveTgo(G.toFramePos(d.F, cgPos(v, _cg), _rf).z, G.toFrameVec(d.F, v.vel, _vf).z, G.DESCENT_TARGETS.braking, 600);
  S.guid.valid = false;
  v.gnc.throttleMode = 'AUTO';
  setProgram(v, S, ctx, 'P63');
}

/** P64 approach phase (from P63, or a mid-flight scenario start). */
export function startP64(v, S, ctx, fromP63) {
  if (!S.descent) {
    S.descent = newDescent(v, null);
    S.descent.ignited = true;
    S.descent.ignTime = ctx.game.time.met - 520;
    S.descent.radarLock = true;
    S.descent.lockTime = ctx.game.time.met - 100;
    S.descent.alarmIdx = DESCENT.alarms.length;
    S.descent.said.v57 = true;
  }
  const d = S.descent;
  makeFrame(v, d);
  d.windowsUp = true;
  d.gcyc = 0;
  // time-to-go on the approach target from the current state (no fixed guess: a poor one made
  // the first cycles command a throttle surge at the pitch-over)
  d.tgo = G.solveTgo(G.toFramePos(d.F, cgPos(v, _cg), _rf).z, G.toFrameVec(d.F, v.vel, _vf).z, G.DESCENT_TARGETS.approach, 100);
  d.thr.ftp = false;
  d.thr.throttledDown = true; // P64 is always flown in the throttleable range
  v.gnc.throttleMode = 'AUTO';
  if (!fromP63 && v.gnc.autopilot !== 'OFF') v.gnc.autopilot = 'GUIDANCE';
  setProgram(v, S, ctx, 'P64');
  if (fromP63) {
    ctx.say('P64.', 'LMP', 0.2);
    ctx.message('P64 — approach phase: pitch-over. LPD angle on the DSKY (V06 N64); redesignate with the hand controller', 'info');
    const altFt = Math.round(v.tel.altitude / FT / 100) * 100;
    ctx.say("Eagle, Houston. You're go for landing. Over.", 'CAPCOM', 12);
    ctx.say(`Roger. Understand. Go for landing. ${Math.max(1000, altFt - 1000).toLocaleString('en-US')} feet.`, 'LMP', 17);
  }
}

/**
 * P66 rate of descent. auto = entered at Low Gate hands-off (the LGC keeps flying attitude and
 * steps the ROD like a crew would until the pilot takes over); otherwise the pilot flies.
 */
export function startP66(v, S, ctx, auto) {
  if (!S.descent) {
    S.descent = newDescent(v, null);
    S.descent.ignited = true;
    S.descent.ignTime = ctx.game.time.met - 600;
    S.descent.radarLock = true;
    S.descent.lockTime = ctx.game.time.met - 200;
    S.descent.alarmIdx = DESCENT.alarms.length;
    S.descent.said.v57 = true;
    makeFrame(v, S.descent);
  }
  const d = S.descent;
  d.rodAuto = !!auto;
  d.rodTimer = 1;
  d.p66Fwd = null;
  d.engineStop = false;
  d.prevVs = null;
  v.gnc.rodCmd = v.tel.vSpeed;
  v.gnc.throttleMode = 'AUTO';
  v.gnc.lpdAngle = null;
  v.gnc.lpdTimeLeft = null;
  if (!auto) v.gnc.autopilot = 'OFF';
  else if (v.gnc.autopilot !== 'OFF') v.gnc.autopilot = 'GUIDANCE';
  const was = v.gnc.program;
  setProgram(v, S, ctx, 'P66');
  if (was !== 'P66') {
    ctx.message(auto ? 'P66 — Low Gate: the LGC is holding the descent rate and nulling drift. ROD clicks or the hand controller take over' : 'P66 — rate of descent: throttle automatic, ROD switch ±1 ft/s, fly attitude by hand (PRO: hand it to the LGC)', 'info', 7);
  }
}

/** P67 manual throttle (bumpless: the lever is set to the current throttle). */
export function startP67(v, S, ctx) {
  if (ctx.game.active === v) v.ctrl.throttle = Math.max(0, v.mainEngine.firing ? v.mainEngine.throttleCmd : 0);
  v.gnc.throttleMode = 'MANUAL';
  v.gnc.lpdAngle = null;
  v.gnc.lpdTimeLeft = null;
  if (v.gnc.autopilot === 'GUIDANCE') v.gnc.autopilot = 'OFF';
  setProgram(v, S, ctx, 'P67');
  ctx.message('P67 — manual throttle (TTCA lever)', 'info');
}

/** P68 landing confirmation. */
export function startP68(v, S, ctx) {
  v.gnc.throttleMode = 'MANUAL';
  v.gnc.autopilot = 'OFF';
  v.gnc.lpdAngle = null;
  v.gnc.lpdTimeLeft = null;
  if (S.descent) S.descent.active = false;
  setProgram(v, S, ctx, 'P68');
}

/** P00 idle. */
export function startP00(v, S, ctx) {
  v.gnc.throttleMode = 'MANUAL';
  if (v.gnc.autopilot === 'GUIDANCE') v.gnc.autopilot = 'OFF';
  v.gnc.lpdAngle = null;
  v.gnc.lpdTimeLeft = null;
  if (S.descent) S.descent.active = false;
  setProgram(v, S, ctx, 'P00');
}

/** P12 powered ascent (tig: MET of ignition) or P70/P71 aborts (immediate ignition). */
export function startAscent(v, S, ctx, kind, tig) {
  const game = ctx.game;
  const csm = game.vessels.CSM;
  // target plane: Columbia's orbit (fallback: the LM's own motion or the approach track)
  let n = _a.crossVectors(csm.pos, csm.vel);
  if (csm.crashed || n.lengthSq() < 1) n = _a.crossVectors(v.pos, v.vel);
  if (n.lengthSq() < 1) {
    // no usable orbit: fly toward the LM's forward direction (downrange = n x up = forward)
    const u = up(v, _b);
    n = _a.crossVectors(u, _c.set(0, 0, -1).applyQuaternion(v.quat));
  }
  // insertion altitude above the landing site (Apollo) but never below the reference sphere
  const siteR = MOON.radius + Math.max(0, v.tel.terrainHeight ?? 0);
  S.ascent = {
    kind,
    tig: tig ?? game.time.met,
    proAck: kind !== 'P12',
    ignited: false,
    ignTime: null,
    noIgnMsg: false,
    gcyc: 0,
    steer: {},
    cutoff: false,
    cutTime: null,
    frozen: false,
    planeNormal: n.clone().normalize(),
    target: { radius: siteR + G.ASCENT_TARGET.altitude, vRadial: G.ASCENT_TARGET.vRadial, vHorizontal: G.ASCENT_TARGET.vHorizontal },
    riseTime: kind === 'P12' || v.tel.altitude < 150 ? G.ASCENT_TARGET.verticalRise : 0,
    yawAfterRise: 0,
    pitchAfterRise: 90,
    crossRange: 0,
  };
  if (S.descent) S.descent.active = false;
  S.burn = null;
  S.pdi = null;
  S.engineStopLatched = false;
  S.guid.valid = false;
  v.gnc.throttleMode = 'AUTO';
  v.gnc.autopilot = 'GUIDANCE';
  v.gnc.lpdAngle = null;
  v.gnc.lpdTimeLeft = null;
  v.gnc.tig = S.ascent.tig;
  setProgram(v, S, ctx, kind);
  if (kind !== 'P12') {
    ctx.message(kind === 'P71' ? 'P71 — APS abort: ascent stage to orbit' : 'P70 — DPS abort: descent engine to orbit', 'alarm');
    ctx.say('Abort.', 'CDR', 0);
  }
}

// ------------------------------------------------------------------ crew keys

/**
 * PROCEED key. Returns true when it was accepted.
 */
export function proKey(v, S, ctx) {
  const met = ctx.game.time.met;
  const p = v.gnc.program;
  const d = S.descent;
  if (p === 'P63' && d && !d.ignited) {
    if (met < d.tig - 5.5) {
      operatorError(v, S.agc, ctx.game, 'no response requested yet (V99 N62 flashes 5 s before ignition)');
      return false;
    }
    d.proAck = true;
    if (met >= d.tig) {
      d.lateIgnAt = met + 2; // short ullage, then ignition
      ctx.message('PRO — late ignition after 2 s of ullage', 'warn');
    } else ctx.message('PRO — engine ON enabled', 'good');
    return true;
  }
  if (p === 'P40' && S.burn && !S.burn.ignited) {
    const b = S.burn;
    if (met < b.tig - 5.5) {
      operatorError(v, S.agc, ctx.game, `no response requested yet — DOI ignition in ${mmss(b.tig - met)} (V99 N40 flashes 5 s before)`);
      return false;
    }
    b.proAck = true;
    if (met >= b.tig) {
      b.lateIgnAt = met + 2;
      ctx.message('PRO — late DOI ignition after 2 s of ullage', 'warn');
    } else ctx.message('PRO — engine ON enabled', 'good');
    return true;
  }
  if ((p === 'P12' || p === 'P70' || p === 'P71') && S.ascent && !S.ascent.ignited) {
    if (met < S.ascent.tig - 5.5) {
      operatorError(v, S.agc, ctx.game, 'no response requested yet (V99 flashes 5 s before ignition)');
      return false;
    }
    S.ascent.proAck = true;
    ctx.message(met >= S.ascent.tig ? 'PRO — ascent engine ignition' : 'PRO — ascent engine ON enabled', 'good');
    return true;
  }
  if ((p === 'P63' || p === 'P64' || p === 'P12' || p === 'P70' || p === 'P71' || (p === 'P40' && S.burn && !S.burn.cutoff)) && v.gnc.autopilot !== 'GUIDANCE') {
    v.gnc.autopilot = 'GUIDANCE';
    ctx.message('PGNS AUTO — guidance steering re-engaged', 'good');
    return true;
  }
  if (p === 'P66' && v.gnc.autopilot !== 'GUIDANCE' && S.descent) {
    v.gnc.autopilot = 'GUIDANCE';
    S.descent.rodAuto = true;
    ctx.message('P66 AUTO — the LGC flies attitude and descent rate', 'good');
    return true;
  }
  if (v.type === 'LM' && (p === 'P00' || p === 'P47') && !v.landed && !onSurface(v)) {
    const why = doiUnavailable(v, S, ctx.game);
    if (!why) return startDOI(v, S, ctx);
    operatorError(v, S.agc, ctx.game, `PRO — ${why}`);
    return false;
  }
  if (v.type === 'LM' && (p === 'P68' || p === 'P00') && onSurface(v) && !v.crashed) {
    startAscent(v, S, ctx, 'P12', met + 12);
    ctx.message('P12 loaded — ascent ignition in 12 s: PRO again at the flashing V99', 'info');
    return true;
  }
  operatorError(v, S.agc, ctx.game, 'PRO — no response requested');
  return false;
}

/** LPD redesignation clicks (P64): dy = fore/aft (+ = farther), dx = left/right (+ = right). */
export function lpdRedesignate(v, S, ctx, dx, dy) {
  const d = S.descent;
  if (v.gnc.program !== 'P64' || !d || !Number.isFinite(v.gnc.lpdAngle) || !(v.gnc.lpdTimeLeft > 0)) {
    ctx.message('LPD redesignation only in P64 with time remaining', 'warn');
    return false;
  }
  const eye = _c.copy(LM.eyeCDR).applyQuaternion(v.quat).add(v.pos);
  const now = G.lpdAngles(v.quat, eye, d.F.origin, {});
  const elev = Math.max(DESCENT.lpdElevMin, Math.min(DESCENT.lpdElevMax, now.elev - (dy || 0) * DESCENT.lpdElevStep));
  const az = Math.max(G.LPD_AZIMUTH - 40, Math.min(G.LPD_AZIMUTH + 40, now.az + (dx || 0) * DESCENT.lpdAzStep));
  const dir = G.lpdRay(v.quat, eye, elev, az, new THREE.Vector3());
  if (!dir) return false;
  const shift = Math.acos(Math.min(1, dir.dot(d.origTarget))) * MOON.radius;
  if (shift > DESCENT.lpdMaxShift) {
    ctx.message('LPD — redesignation limit reached', 'warn');
    return false;
  }
  v.gnc.targetDir.copy(dir);
  d.F = G.makeSiteFrame(dir, d.F.down, d.F);
  d.gcyc = 0; // re-guide now
  v.gnc.lpdAngle = elev;
  compBurst(S.agc, 0.4);
  return true;
}

// ------------------------------------------------------------------ LM program steps

/**
 * Run the vessel's current program for one substep.
 * @param {object} v vessel
 * @param {object} S gnc state
 * @param {object} ctx {game, say, message, later}
 * @param {number} h substep (s)
 */
export function runProgram(v, S, ctx, h) {
  S.throttle = null;
  S.ullage = false;
  S.powered = false;
  const p = v.gnc.program;
  if (v.type === 'LM') {
    if (p === 'P63') return p63(v, S, ctx, h);
    if (p === 'P64') return p64(v, S, ctx, h);
    if (p === 'P66') return p66(v, S, ctx, h);
    if (p === 'P67') return p67(v, S, ctx, h);
    if (p === 'P68') return p68(v, S, ctx, h);
    if (p === 'P12' || p === 'P70' || p === 'P71') return ascent(v, S, ctx, h);
    if (p === 'P40') return p40(v, S, ctx, h);
  }
  return p00(v, S, ctx, h);
}

function p63(v, S, ctx, h) {
  const d = S.descent;
  const game = ctx.game;
  const met = game.time.met;
  if (!d) return startP00(v, S, ctx);
  S.powered = true;
  if (!d.ignited) {
    const dt = met - d.tig;
    S.throttle = 0;
    // pre-ignition guidance cycles give the ignition attitude (after DOI the LM coasts in any
    // attitude: the LGC turns it to the PDI attitude a few minutes early)
    if (d.fromDOI && dt > -DOI.pdiAlign && !d.said.align) {
      d.said.align = true;
      v.gnc.rcsMode = 'RATE';
      v.gnc.autopilot = 'GUIDANCE';
      ctx.message('P63 — manoeuvring to the PDI ignition attitude: engine forward (retrograde), windows down', 'info', 6);
    }
    if (dt > (d.fromDOI ? -DOI.pdiAlign : -30)) {
      d.gcyc -= h;
      if (d.gcyc <= 0) {
        d.gcyc += DESCENT.cycle;
        descentCycle(v, S, G.DESCENT_TARGETS.braking);
      }
    }
    if (d.fromDOI) d.said.go = true; // MCC's "go for powered descent" came when P63 was loaded
    if (!d.said.go && dt > -31) {
      d.said.go = true;
      ctx.say("Eagle, Houston. If you read, you're go for powered descent. Over.", 'CAPCOM', 0);
    }
    if (game.active !== v && dt > -3) d.proAck = true; // the crew answers the V99 themselves
    if (dt < -35) setDisp(S, '06', '62');
    else if (dt < -30) setDisp(S, '06', '62', false, true); // Average-G start: display blanks for 5 s
    else if (dt < -5 || (d.proAck && dt < 0)) setDisp(S, '06', '62');
    else setDisp(S, '99', '62', !d.proAck);
    if (dt >= -5 && !d.proAck && !d.said.v99) {
      d.said.v99 = true;
      ctx.message('V99 N62 flashing — press PRO (Space) to enable DPS ignition', 'warn', 6);
    }
    S.ullage = (dt >= -DESCENT.ullage && dt < 0.5 && !d.noIgnMsg) || d.lateIgnAt != null;
    if (dt >= 0) {
      if (d.proAck && (d.lateIgnAt == null || met >= d.lateIgnAt)) ignite(v, S, ctx);
      else if (!d.proAck && !d.noIgnMsg) {
        d.noIgnMsg = true;
        S.ullage = false;
        ctx.message('No ignition — the V99 "please perform engine on" request was not answered. Press PRO (Space) to ignite late.', 'alarm', 8);
      }
    }
    if (!d.ignited) return;
  }
  const t = met - d.ignTime;
  d.gcyc -= h;
  if (d.gcyc <= 0) {
    d.gcyc += DESCENT.cycle;
    radarCycle(v, S, ctx);
    descentCycle(v, S, G.DESCENT_TARGETS.braking);
    historicalAlarms(v, S, ctx);
    if (t >= DESCENT.ignitionHold) {
      const was = d.thr.ftp;
      d.thrCmd = G.dpsThrottle(d.thr, d.cmdFrac);
      if (was && !d.thr.ftp && !d.said.thrDown) {
        d.said.thrDown = true;
        ctx.say('Throttle down... better than the simulator.', 'LMP', 0.5);
      }
    }
  }
  if (t < DESCENT.ignitionHold) d.thrCmd = DESCENT.ignitionThrottle;
  else if (!d.said.thrUp) {
    d.said.thrUp = true;
    ctx.say('Throttle up.', 'LMP', 0);
  }
  S.throttle = d.engineStop ? 0 : d.thrCmd;
  S.ullage = t < 0.8;
  if (!d.windowsUp && t >= DESCENT.yawAround) {
    d.windowsUp = true;
    d.gcyc = 0;
    ctx.message('Yaw-around to windows-up so the landing radar can see the surface', 'info');
    ctx.say('Rolling over to windows up.', 'CDR', 0);
  }
  if (!d.said.cont && t > 232) {
    d.said.cont = true;
    ctx.say("Eagle, Houston. You are go to continue powered descent. You are go to continue powered descent.", 'CAPCOM', 0);
  }
  d.dvAcc += ((v.mainEngine.throttle * v.mainEngine.maxThrust) / Math.max(1, controlMassProps(v).mass)) * h;
  setDisp(S, '06', '63');
  if (d.tgo <= G.DESCENT_TARGETS.braking.endTgo && t > 60) startP64(v, S, ctx, true);
}

function ignite(v, S, ctx) {
  const d = S.descent;
  d.ignited = true;
  d.ignTime = ctx.game.time.met;
  d.thrCmd = DESCENT.ignitionThrottle;
  d.gcyc = 0;
  ctx.say('Ignition.', 'LMP', 0);
  ctx.message('DPS ignition — 10 % thrust for 26 s, then FTP', 'good');
}

function lpdUpdate(v, S, h) {
  const d = S.descent;
  d.lpdTimer -= h;
  if (d.lpdTimer > 0) return;
  d.lpdTimer = 0.25;
  const eye = _c.copy(LM.eyeCDR).applyQuaternion(v.quat).add(v.pos);
  const a = G.lpdAngles(v.quat, eye, d.F.origin, S.lpd || (S.lpd = {}));
  v.gnc.lpdAngle = a.elev;
  v.gnc.lpdAzimuth = a.az;
  v.gnc.lpdTimeLeft = Math.max(0, Math.floor(d.tgo - G.DESCENT_TARGETS.approach.endTgo - 2 * DESCENT.cycle));
}

function p64(v, S, ctx, h) {
  const d = S.descent;
  if (!d) return startP66(v, S, ctx, true);
  S.powered = true;
  d.gcyc -= h;
  if (d.gcyc <= 0) {
    d.gcyc += DESCENT.cycle;
    radarCycle(v, S, ctx);
    descentCycle(v, S, G.DESCENT_TARGETS.approach);
    historicalAlarms(v, S, ctx);
    d.thrCmd = G.dpsThrottle(d.thr, d.cmdFrac);
  }
  S.throttle = d.engineStop ? 0 : d.thrCmd;
  lpdUpdate(v, S, h);
  setDisp(S, '06', '64');
  landingCallouts(v, S.callouts, ctx.game, v.gnc.lpdAngle);
  if (d.tgo <= G.DESCENT_TARGETS.approach.endTgo) {
    startP66(v, S, ctx, true);
    ctx.say('P66.', 'LMP', 0.3);
  }
}

function p66(v, S, ctx, h) {
  const d = S.descent || (startP66(v, S, ctx, false), S.descent);
  const t = v.tel;
  S.powered = true;
  const met = ctx.game.time.met;
  radarTick(v, S, ctx, h);
  // vertical acceleration estimate for the lag compensation
  if (d.prevVs != null && h > 0) d.accUp += ((t.vSpeed - d.prevVs) / h - d.accUp) * Math.min(1, h / 0.2);
  d.prevVs = t.vSpeed;
  // hands-off: the LGC steps the ROD like a crew would (1 ft/s clicks)
  if (d.rodAuto) {
    d.rodTimer -= h;
    if (d.rodTimer <= 0) {
      d.rodTimer = 0.45;
      const alt = Number.isFinite(t.radarAltitude) ? t.radarAltitude : t.gearAltitude;
      let want = -Math.max(0.5, Math.min(5, 0.09 * alt));
      // hands-off (P65-like): hold ~15 m until over the target and slow, then let down
      if (v.gnc.autopilot === 'GUIDANCE' && alt < 40) {
        const u = up(v, _a);
        const vh = Math.sqrt(Math.max(0, v.vel.lengthSq() - v.vel.dot(u) ** 2));
        if ((d.p66Dist ?? 0) > 8 || vh > 1.0) want = Math.max(want, -Math.max(0, (alt - 15) * 0.12));
      }
      const diff = want - v.gnc.rodCmd;
      if (Math.abs(diff) > FT * 0.6) v.gnc.rodCmd += Math.sign(diff) * FT;
    }
  }
  const mp = controlMassProps(v);
  const e = v.mainEngine;
  const bUp = _a.set(0, 1, 0).applyQuaternion(v.quat);
  const u = up(v, _b);
  const r = v.pos.length();
  let thr = G.rodThrottle({ mass: mp.mass, g: MOON.mu / (r * r), vUp: t.vSpeed, hSpeed: t.hSpeed, r, accUp: d.accUp, cosTilt: bUp.dot(u), vCmd: v.gnc.rodCmd, maxThrust: e.maxThrust });
  thr = Math.max(e.minThrottle, Math.min(e.maxThrottle, thr));
  // LUNAR CONTACT (probe) -> ENGINE STOP. Hands-off (the LGC and the LMP fly), the crew pushes
  // ENGINE STOP about a second after the contact light, as from Apollo 12 on ("Contact light.
  // Okay. Engine stop."): the LM drops the last metre at 1-2 m/s. When the pilot flies P66 the
  // button is his (X); if he does not push it, the stop comes at footpad contact.
  if (v.gear?.probeContact && d.contactTime == null) d.contactTime = met;
  const padDown = v.gear?.pads?.some((pd) => pd.contact);
  const handsOff = d.rodAuto && v.gnc.autopilot === 'GUIDANCE';
  if (d.contactTime != null && !d.engineStop && (padDown || (handsOff && met - d.contactTime >= DESCENT.engineStopDelay) || met - d.contactTime >= DESCENT.engineStopMax)) {
    d.engineStop = true;
    if (handsOff) ctx.say('Okay. Engine stop.', 'CDR', 0);
    ctx.message('Engine stop — ENGINE STOP pushed, DPS off', 'good');
  }
  S.throttle = d.engineStop ? 0 : thr;
  // hands-off attitude: null horizontal velocity while drifting to the target (P65-like)
  if (v.gnc.autopilot === 'GUIDANCE') {
    d.p66Timer -= h;
    if (d.p66Timer <= 0) {
      d.p66Timer = 0.5;
      p66Attitude(v, S);
    }
  }
  setDisp(S, '06', '60');
  landingCallouts(v, S.callouts, ctx.game, null);
  if (v.landed) startP68(v, S, ctx);
}

/**
 * P66 hands-off attitude (P65-like): fly the horizontal velocity along a braking-feasible
 * profile toward the target and null it there. Tilt limited to 15 deg (5 deg in the last 8 m).
 */
function p66Attitude(v, S) {
  const d = S.descent;
  const u = up(v, _a);
  const r = v.pos.length();
  const g = MOON.mu / (r * r);
  const alt = v.tel.gearAltitude ?? v.tel.altitude;
  const maxA = g * Math.tan((alt < 8 ? 5 : 15) * D2R);
  const site = _b.copy(d.F.origin).sub(v.pos);
  site.addScaledVector(u, -site.dot(u)); // horizontal vector to the target
  const dist = site.length();
  const speed = Math.min(12, 0.15 * dist, Math.sqrt(2 * 0.5 * maxA * dist));
  const vCmd = site.multiplyScalar(dist > 0.05 ? speed / dist : 0);
  const vh = _c.copy(v.vel).addScaledVector(u, -v.vel.dot(u));
  const aH = vCmd.sub(vh).multiplyScalar(1 / 2.5);
  if (aH.length() > maxA) aH.setLength(maxA);
  const dir = aH.addScaledVector(u, g);
  // keep the heading the LM had at P66 entry (P64 flies yawed to put the site on the LPD
  // line; swinging back to the approach track at Low Gate would be a pointless yaw)
  if (!d.p66Fwd) {
    d.p66Fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(v.quat);
    d.p66Fwd.addScaledVector(u, -d.p66Fwd.dot(u));
    if (d.p66Fwd.lengthSq() < 1e-4) d.p66Fwd.copy(d.F.down);
    d.p66Fwd.normalize();
  }
  quatFromUpForward(dir, _rf.copy(d.p66Fwd).add(u), _q);
  setGuid(S, _q, 5 * D2R);
  S.guid.step = 4 * D2R;
  d.p66Dist = dist;
}

/** Landing-radar data-good status once per second in P66 / P67. */
function radarTick(v, S, ctx, h) {
  const d = S.descent;
  if (!d) return;
  d.radarTimer = (d.radarTimer ?? 0) - h;
  if (d.radarTimer > 0) return;
  d.radarTimer = 1;
  radarCycle(v, S, ctx);
}

function p67(v, S, ctx, h) {
  radarTick(v, S, ctx, h);
  setDisp(S, '06', '60');
  S.powered = v.mainEngine.firing;
  if (!v.landed && !v.staged && (v.tel.altitude < 3000 || v.mainEngine.firing)) landingCallouts(v, S.callouts, ctx.game, null);
  if (v.landed) startP68(v, S, ctx);
}

function p68(v, S) {
  S.throttle = 0;
  setDisp(S, '06', '43');
}

// ------------------------------------------------------------------ ascent

function ascent(v, S, ctx, h) {
  const a = S.ascent;
  const game = ctx.game;
  const met = game.time.met;
  if (!a) return startP00(v, S, ctx);
  const u = up(v, _a);
  const downrange = _b.crossVectors(a.planeNormal, u).normalize();
  // windows reference: forward and down (the crew looks at the surface ahead after pitch-over)
  const winRef = _rf.copy(downrange).sub(u);
  if (!a.ignited) {
    const dt = met - a.tig;
    S.throttle = 0;
    if (game.active !== v && dt > -3) a.proAck = true;
    if (dt < -5 || (a.proAck && dt < 0)) setDisp(S, '06', '76');
    else setDisp(S, '99', '74', !a.proAck);
    if (dt >= -5 && !a.proAck && !a.said) {
      a.said = true;
      ctx.message('V99 N74 flashing — press PRO (Space) for ascent engine ignition', 'warn', 6);
    }
    if (a.kind !== 'P12') S.ullage = dt < 0;
    if (dt >= 0 && a.proAck) {
      a.ignited = true;
      a.ignTime = met;
      if (a.kind !== 'P70' && !v.staged) game.events.emit('action', { name: 'STAGE' });
      ctx.say(a.kind === 'P12' ? '9, 8, 7, 6, 5, abort stage, engine arm, ascent, proceed.' : 'Staging.', 'LMP', 0);
      if (a.kind === 'P12') ctx.say("Beautiful. 26, 36 feet per second up. Be advised of the pitchover.", 'LMP', 6);
    } else if (dt >= 0 && !a.noIgnMsg) {
      a.noIgnMsg = true;
      ctx.message('No ignition — V99 not answered. Press PRO (Space) to ignite.', 'alarm', 8);
    }
    if (!a.ignited) {
      // hold the pre-ignition attitude: upright, windows downrange
      return;
    }
  }
  S.powered = true;
  const t = met - a.ignTime;
  const e = v.mainEngine;
  const mp = controlMassProps(v);
  cgPos(v, _cg);
  const thrust = e.maxThrust * e.maxThrottle;
  const st = G.ascentSteer(
    { pos: _cg, vel: v.vel, mass: mp.mass, thrust, ve: e.isp * G0, planeNormal: a.planeNormal, targetRadius: a.target.radius, vRadial: a.target.vRadial, vHorizontal: a.target.vHorizontal },
    a.steer,
  );
  a.crossRange = v.pos.dot(a.planeNormal);
  if (!a.cutoff) {
    S.throttle = 1;
    if (t < a.riseTime) {
      quatFromUpForward(u, winRef, _q);
      setGuid(S, _q, 6 * D2R);
    } else {
      a.gcyc -= h;
      if (a.gcyc <= 0) {
        a.gcyc += DESCENT.cycle;
        if (!a.frozen) {
          if (st.tgo < 10) a.frozen = true;
          quatFromUpForward(st.dir, winRef, _q);
          setGuid(S, _q, 8 * D2R);
          if (!a.dirLogged) {
            a.dirLogged = true;
            a.pitchAfterRise = Math.asin(Math.max(-1, Math.min(1, st.dir.dot(u)))) * R2D;
          }
        }
        compBurst(S.agc, 0.6);
      }
    }
    // cut-off when the remaining velocity-to-be-gained is exhausted (tail-off included)
    const aF = thrust / mp.mass;
    const bUp = _c.set(0, 1, 0).applyQuaternion(v.quat);
    const vgoAlong = st.vgoVec.dot(bUp);
    if (t > a.riseTime && (st.vh >= a.target.vHorizontal || (st.tgo < 20 && vgoAlong <= aF * (h + 0.12)))) {
      a.cutoff = true;
      a.cutTime = met;
      S.throttle = 0;
      ctx.message(`Insertion — engine cut-off. Orbit ${(v.tel.apoapsisAlt / 1000).toFixed(1)} × ${(v.tel.periapsisAlt / 1000).toFixed(1)} km`, 'good', 6);
      ctx.say('Shutdown. We are in orbit.', 'LMP', 0.5);
      ctx.say('Roger, Eagle. Houston. We see a good orbit.', 'CAPCOM', 8);
    }
    setDisp(S, '06', '94');
  } else {
    S.throttle = 0;
    setDisp(S, '06', '94');
    if (met - a.cutTime > 5) {
      startP00(v, S, ctx);
      v.gnc.autopilot = 'LOCAL_VERTICAL';
    }
  }
}

// ------------------------------------------------------------------ P40 DOI

/** Descent orbit insertion sequencing (Apollo 11: DOI at 101:36:14, 76.4 ft/s, 30 s of DPS). */
export const DOI = {
  minSep: 50, // m from Columbia before the DPS may fire
  minLead: 150, // s: the next DOI point must be at least this far ahead (else one orbit later)
  align: 240, // s before TIG: the LGC turns Eagle to the burn attitude
  lowThrottle: 0.1, // first 15 s at 10 % (gimbal trim), then 40 %
  lowTime: 15,
  highThrottle: 0.4,
  pdiLoad: 600, // s before PDI: P63 is loaded (V37E63E)
  pdiAlign: 240, // s before PDI: P63 turns the LM to the ignition attitude
};

function mmss(t) {
  const s = Math.max(0, Math.round(t));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h} h ${String(m).padStart(2, '0')} min` : `${m}:${ss}`;
}

function getStr(met) {
  const h = Math.floor(met / 3600);
  const m = Math.floor((met % 3600) / 60);
  const s = Math.floor(met % 60);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** LM sitting on the surface (landed, or the ascent stage still on the descent stage). */
function onSurface(v) {
  return !!(v.landed || v.phys?.sleeping || v.phys?.onPad);
}

/** Why a DOI cannot be loaded now (null = it can). */
export function doiUnavailable(v, S, game) {
  if (v.type !== 'LM') return 'DOI is an LM burn';
  if (v.docked) return 'undock first (U)';
  if (v.staged) return 'no descent stage';
  if (v.landed || v.crashed || onSurface(v)) return 'not in orbit';
  if (S.descent?.active && (v.gnc.program === 'P63' || v.gnc.program === 'P64' || v.gnc.program === 'P66')) return 'descent in progress';
  if (S.pdi) return `DOI done — PDI at GET ${getStr(S.pdi.tig)}, P63 loads 10 min before`;
  if (!(v.tel.periapsisAlt > 25000)) return 'DOI is flown from the 111-km orbit (perilune already low)';
  if (!(v.propellant.main > 500)) return 'descent propellant too low';
  const csm = game.vessels.CSM;
  if (csm && !csm.crashed && csm.pos.distanceTo(v.pos) < DOI.minSep) return `too close to Columbia (${csm.pos.distanceTo(v.pos).toFixed(0)} m) — separate at least ${DOI.minSep} m first`;
  return null;
}

/** P40: plan and load the DOI burn (TIG half an orbit before the PDI point). */
export function startDOI(v, S, ctx) {
  const game = ctx.game;
  const met = game.time.met;
  const site = v.gnc.targetDir;
  const hHat = new THREE.Vector3().crossVectors(v.pos, v.vel).normalize();
  let psi = G.PDI_ARC + Math.PI;
  psi = Math.atan2(Math.sin(psi), Math.cos(psi));
  const c = G.coastToArc(v.pos, v.vel, site, psi, DOI.minLead);
  if (!c) {
    operatorError(v, S.agc, game, 'P40 — no DOI solution (orbit does not pass over the landing site)');
    return false;
  }
  const pdiDir = G.arcPoint(hHat, site, G.PDI_ARC, new THREE.Vector3());
  const rp = MOON.radius + terrainHeight(pdiDir.x, pdiDir.y, pdiDir.z) + MISSION.doiPerilune;
  const dv = G.doiTargetVelocity(c.pos, c.vel, rp, new THREE.Vector3()).sub(c.vel);
  S.burn = {
    kind: 'DOI',
    tig: met + c.t,
    dv: dv.clone(),
    vgo: dv.clone(),
    dvMag: dv.length(),
    rp,
    proAck: false,
    ignited: false,
    ignTime: null,
    lateIgnAt: null,
    noIgnMsg: false,
    cutoff: false,
    cutTime: null,
    aligned: false,
    gcyc: 0,
    dvAcc: 0,
    said: {},
  };
  S.pdi = null;
  S.engineStopLatched = false;
  S.guid.valid = false;
  v.gnc.throttleMode = 'AUTO';
  setProgram(v, S, ctx, 'P40');
  ctx.message(
    `P40 DOI loaded — ${S.burn.dvMag.toFixed(1)} m/s retrograde (perilune 15 km over the PDI point). TIG GET ${getStr(S.burn.tig)}, in ${mmss(c.t)}: time-warp is fine, PRO (Space) at the flashing V99`,
    'good',
    9,
  );
  return true;
}

/**
 * Accelerometer (PIPA) model: the non-gravitational velocity change since the previous substep
 * (DPS thrust and the ullage RCS) is taken off the velocity to be gained.
 */
function senseDV(v, b, h) {
  if (b.prevVel) {
    G.gravity(b.prevPos, _g);
    const dv = _gf.copy(v.vel).sub(b.prevVel).addScaledVector(_g, -b.prevH);
    b.vgo.sub(dv);
    b.dvAcc += dv.length();
  } else {
    b.prevVel = new THREE.Vector3();
    b.prevPos = new THREE.Vector3();
  }
  b.prevVel.copy(v.vel);
  b.prevPos.copy(v.pos);
  b.prevH = h;
}

/** Burn attitude: thrust axis along the velocity to be gained, windows down (landmarks). */
function burnAttitude(v, S, vgo) {
  const u = up(v, _b);
  _a.copy(vgo).normalize();
  quatFromUpForward(_a, _c.copy(u).negate(), _q);
  setGuid(S, _q, 5 * D2R);
}

function p40(v, S, ctx, h) {
  const b = S.burn;
  const game = ctx.game;
  const met = game.time.met;
  if (!b || v.docked || v.staged) {
    S.burn = null;
    return startP00(v, S, ctx);
  }
  if (!b.ignited) {
    const dt = met - b.tig;
    S.throttle = 0;
    if (dt > -DOI.align) {
      if (!b.aligned) {
        b.aligned = true;
        v.gnc.rcsMode = 'RATE';
        v.gnc.autopilot = 'GUIDANCE';
        ctx.message('P40 — manoeuvring to the DOI attitude: engine forward (retrograde), windows down', 'info', 6);
      }
      b.gcyc -= h;
      if (b.gcyc <= 0) {
        b.gcyc += DESCENT.cycle;
        burnAttitude(v, S, b.vgo);
      }
    }
    if (game.active !== v && dt > -3) b.proAck = true;
    if (dt < -5 || (b.proAck && dt < 0)) setDisp(S, '06', '40');
    else setDisp(S, '99', '40', !b.proAck);
    if (dt >= -5 && !b.proAck && !b.said.v99) {
      b.said.v99 = true;
      ctx.message('V99 N40 flashing — press PRO (Space) to enable the DPS for DOI', 'warn', 6);
    }
    S.ullage = (dt >= -DESCENT.ullage && dt < 0.5 && !b.noIgnMsg) || b.lateIgnAt != null;
    S.powered = dt > -DOI.align;
    if (dt >= 0 && S.engineStopLatched) {
      S.ullage = false;
      if (!b.said.latched) {
        b.said.latched = true;
        ctx.message('No DOI ignition — ENGINE STOP is latched (X again resets it)', 'alarm', 6);
      }
    } else if (dt >= 0) {
      if (b.proAck && (b.lateIgnAt == null || met >= b.lateIgnAt)) {
        b.ignited = true;
        b.ignTime = met;
        b.gcyc = 0;
        ctx.say('Ignition.', 'LMP', 0);
        ctx.message('DOI — DPS ignition, 10 % for 15 s then 40 %', 'good');
      } else if (!b.proAck && !b.noIgnMsg) {
        b.noIgnMsg = true;
        S.ullage = false;
        ctx.message('No ignition — V99 not answered. Press PRO (Space) to ignite late.', 'alarm', 8);
      }
    }
    if (S.ullage) senseDV(v, b, h);
    if (!b.ignited) return;
  }
  const e = v.mainEngine;
  const mp = controlMassProps(v);
  const bY = _rf.set(0, 1, 0).applyQuaternion(v.quat);
  if (!b.cutoff) {
    S.powered = true;
    const t = met - b.ignTime;
    senseDV(v, b, h);
    const thr = t < DOI.lowTime ? DOI.lowThrottle : DOI.highThrottle;
    S.throttle = thr;
    S.ullage = t < 0.8;
    b.gcyc -= h;
    if (b.gcyc <= 0) {
      b.gcyc += DESCENT.cycle;
      if (b.vgo.length() > 3) burnAttitude(v, S, b.vgo);
      compBurst(S.agc, 0.6);
    }
    const along = b.vgo.dot(bY);
    const aCmd = (thr * e.maxThrust) / mp.mass;
    if (S.engineStopLatched || (t > 2 && along <= aCmd * (h + 0.15))) {
      if (S.engineStopLatched) ctx.message(`DOI cut short by ENGINE STOP — ${b.vgo.length().toFixed(1)} m/s still to go`, 'warn', 6);
      b.cutoff = true;
      b.cutTime = met;
      S.throttle = 0;
      const c = G.coastToArc(v.pos, v.vel, v.gnc.targetDir, G.PDI_ARC, 60);
      if (c) S.pdi = { tig: met + c.t };
      ctx.say('Shutdown.', 'LMP', 0.4);
      const pdiTxt = c ? ` PDI at GET ${getStr(S.pdi.tig)} (in ${mmss(c.t)}); P63 loads 10 min before — time-warp until then.` : '';
      ctx.message(`DOI complete — ${(b.dvAcc).toFixed(1)} m/s. Orbit ${(v.tel.apoapsisAlt / 1000).toFixed(0)} × ${(v.tel.periapsisAlt / 1000).toFixed(1)} km.${pdiTxt}`, 'good', 10);
    }
    setDisp(S, '06', '40');
    return;
  }
  S.throttle = 0;
  setDisp(S, '06', '40');
  if (met - b.cutTime > 4) {
    S.burn = null;
    startP00(v, S, ctx);
    if (v.gnc.autopilot === 'GUIDANCE') v.gnc.autopilot = 'OFF';
  }
}

// ------------------------------------------------------------------ P00 / P47

function p00(v, S, ctx, h) {
  const p = v.gnc.program;
  if (S.pdi && v.type === 'LM') {
    if (v.docked || v.staged || v.landed) S.pdi = null;
    else if (ctx.game.time.met >= S.pdi.tig - DOI.pdiLoad) {
      const tig = S.pdi.tig;
      S.pdi = null;
      startP63(v, S, ctx, tig);
      S.descent.fromDOI = true;
      ctx.message(`P63 loaded — braking phase. PDI in ${mmss(tig - ctx.game.time.met)}: the LGC aligns Eagle 4 min before; PRO (Space) at the flashing V99`, 'info', 8);
      ctx.say("Eagle, Houston. If you read, you're go for powered descent. Over.", 'CAPCOM', 20);
      return;
    }
  }
  const c = v.ctrl;
  const translating = Math.abs(c.transFwd) > 0.3 || Math.abs(c.transRight) > 0.3 || Math.abs(c.transUp) > 0.3;
  const thrusting = v.mainEngine.firing || translating;
  if (p !== 'P47' && thrusting && !v.landed) {
    S.agc.dv.set(0, 0, 0);
    S.p47Idle = 0;
    setProgram(v, S, ctx, 'P47');
  }
  if (v.gnc.program === 'P47') {
    S.p47Idle = thrusting ? 0 : (S.p47Idle || 0) + h;
    setDisp(S, '16', '83');
    S.powered = thrusting;
    if (S.p47Idle > 30) setProgram(v, S, ctx, 'P00');
  } else {
    if (v.landed && v.type === 'LM') setDisp(S, '06', '43');
    else setDisp(S, '16', '44');
    if (v.gnc.program !== 'P00') setProgram(v, S, ctx, 'P00');
  }
}

/** Initialise a vessel's program state from vessel.gnc after a scenario (re)load. */
export function initPrograms(v, S, ctx) {
  const g = v.gnc;
  const p = g.program || 'P00';
  S.descent = null;
  S.ascent = null;
  S.burn = null;
  S.pdi = null;
  v.gnc.program = p;
  if (v.type === 'LM') {
    if (p === 'P63' && Number.isFinite(g.tig)) return startP63Silent(v, S, ctx, g.tig);
    if (p === 'P64') return startP64(v, S, ctx, false);
    if (p === 'P66') {
      const rod = g.rodCmd;
      g.program = 'P00'; // so that startP66 announces the mode
      startP66(v, S, ctx, false);
      if (Number.isFinite(rod) && rod !== 0) g.rodCmd = rod;
      g.autopilot = 'OFF';
      return;
    }
    if (p === 'P67') {
      S.descent = newDescent(v, null);
      S.descent.ignited = true;
      S.descent.radarLock = true;
      S.descent.lockTime = -1e9;
      S.descent.said.v57 = true;
      makeFrame(v, S.descent);
      g.throttleMode = 'MANUAL';
      return;
    }
    if (p === 'P12') return startAscent(v, S, ctx, 'P12', Number.isFinite(g.tig) ? g.tig : ctx.game.time.met + 30);
    if (p === 'P68') return startP68(v, S, ctx);
  }
  g.throttleMode = g.throttleMode === 'AUTO' ? 'MANUAL' : g.throttleMode;
}

function startP63Silent(v, S, ctx, tig) {
  v.gnc.program = 'P63';
  startP63(v, S, ctx, tig);
}
