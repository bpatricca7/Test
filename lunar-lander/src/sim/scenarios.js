// Scenario definitions: physically consistent initial conditions built around the Apollo 11
// timeline (Ground Elapsed Time is used for the mission clock, game.time.met).
//
// Orbit geometry: both spacecraft fly the westbound great circle through Tranquility Base
// (see orbit.js). Columbia is in a 111-km (60 nmi) circular orbit. Eagle's descent orbit
// (after DOI on the far side) is 15.2 x 111 km with perilune at the PDI point, 480 km uprange
// (east) of the site. The CSM phase is propagated from DOI, when both vehicles were together,
// so Columbia trails Eagle by ~7 deg at PDI — as flown.
//
// Contract: SCENARIOS = [{ id, title, subtitle, description, difficulty, activeId, camera,
//   station?, met, tips[], setup(game, util), settleLM?, gncInit?(game, gnc) }]
// gncInit runs once, right after the GNC's first cycle of the scenario (its program state exists).

import * as THREE from 'three';
import { MOON, MISSION, LM, CSM } from '../core/constants.js';
import { SITE_DIR, quatFromUpForward, quatFromForwardUp, localENU } from '../core/frames.js';
import { terrainHeight } from '../world/moon.js';
import { trackDir, trackTravel, circularTrackState, periapsisTrackState, keplerPropagate, meanMotion } from './orbit.js';
import { REL_QUAT } from './docking.js';

const D2R = Math.PI / 180;
const G = MOON.mu; // shorthand
const get = (h, m, s = 0) => h * 3600 + m * 60 + s; // Ground Elapsed Time -> seconds

// ---- Apollo 11 timeline (GET) ------------------------------------------------------------
export const TIMELINE = {
  undock: get(100, 12, 0),
  pdi: get(102, 33, 5),
  highGate: get(102, 41, 32),
  lowGate: get(102, 43, 20),
  landing: get(102, 45, 40),
  liftoff: get(124, 22, 1),
  docking: get(128, 3, 0),
};

const R_CSM = MOON.radius + MISSION.csmOrbitAltitude;
const PHI_PDI = -MISSION.pdiRangeToSite / MOON.radius; // PDI point, uprange (east) of the site

function terrainAt(dir) {
  return terrainHeight(dir.x, dir.y, dir.z);
}

/** Eagle's descent orbit (15.2 x 111 km, perilune over the PDI point at PDI time). */
function descentOrbit() {
  const pd = trackDir(PHI_PDI);
  const rp = MOON.radius + terrainAt(pd) + MISSION.doiPerilune;
  return periapsisTrackState(PHI_PDI, rp, R_CSM);
}

/** Arc angle of Columbia at time t: both vehicles were together at DOI (apolune, half a descent orbit before PDI). */
export function csmPhaseAt(t) {
  const d = descentOrbit();
  const tDOI = TIMELINE.pdi - d.period / 2;
  const phiDOI = PHI_PDI - Math.PI;
  let phi = phiDOI + meanMotion(R_CSM) * (t - tDOI);
  phi = Math.atan2(Math.sin(phi), Math.cos(phi));
  return phi;
}

/**
 * Point on the approach ground track: downrange d (m, negative = before the site), height h
 * above the local terrain, horizontal speed hSpeed along the track (westward), vertical speed vSpeed.
 */
export function approachState(d, h, hSpeed, vSpeed) {
  const phi = d / MOON.radius;
  const dir = trackDir(phi);
  const travel = trackTravel(phi);
  const r = MOON.radius + terrainAt(dir) + h;
  return {
    pos: dir.clone().multiplyScalar(r),
    vel: travel.clone().multiplyScalar(hSpeed).addScaledVector(dir, vSpeed),
    up: dir,
    travel,
  };
}

// ---- vessel placement helpers ------------------------------------------------------------

/** LM on the approach: thrust axis tilted back (retrograde) by tiltDeg, windows forward. */
function placeLMApproach(lm, d, h, hs, vs, tiltDeg) {
  const s = approachState(d, h, hs, vs);
  lm.pos.copy(s.pos);
  lm.vel.copy(s.vel);
  const t = tiltDeg * D2R;
  const thrustAxis = s.up.clone().multiplyScalar(Math.cos(t)).addScaledVector(s.travel, -Math.sin(t));
  const fwd = s.travel.clone().multiplyScalar(Math.cos(t)).addScaledVector(s.up, Math.sin(t));
  quatFromUpForward(thrustAxis, fwd, lm.quat);
  lm.angVel.set(0, 0, 0);
  return s;
}

/** CSM on its 111-km circular orbit at arc angle phi; nose along track pitched down `pitchDownDeg`. */
function placeCSM(csm, phi, pitchDownDeg = 35) {
  const s = circularTrackState(phi, R_CSM);
  csm.pos.copy(s.pos);
  csm.vel.copy(s.vel);
  const p = pitchDownDeg * D2R;
  const fwd = s.travel.clone().multiplyScalar(Math.cos(p)).addScaledVector(s.up, -Math.sin(p));
  const up = s.up.clone().multiplyScalar(Math.cos(p)).addScaledVector(s.travel, Math.sin(p));
  quatFromForwardUp(fwd, up, csm.quat);
  csm.angVel.set(0, 0, 0);
  return s;
}

function setProps(v, { main, rcs, ascent }) {
  if (main != null) v.propellant.main = main;
  if (rcs != null) v.propellant.rcs = rcs;
  if (ascent != null) v.propellant.ascent = ascent;
}

function setGNC(v, o) {
  Object.assign(v.gnc, o);
  if (o.program) v.agc.prog = o.program.slice(1);
}

/** Mass the sim will compute for an unstaged LM (used for throttle presets). */
function lmMass(v) {
  const p = v.propellant;
  return LM.descentDryMass + p.main + LM.ascentDryMass + p.ascent + p.rcs;
}

/** Preset the descent engine as already running at `thr` (mid-burn scenario starts). */
function engineRunning(v, thr) {
  const e = v.mainEngine;
  e.throttle = thr;
  e.throttleCmd = thr;
  e.firing = true;
}

/**
 * Constant-deceleration profile between two approach gates: returns the thrust tilt (deg from
 * vertical) and the thrust acceleration (m/s^2) that take the LM from gate A to gate B.
 */
function gateProfile(a, b, r) {
  const g = G / (r * r);
  const dx = Math.abs(b.downrange - a.downrange);
  const ah = (a.hSpeed * a.hSpeed - b.hSpeed * b.hSpeed) / (2 * dx);
  const T = (a.hSpeed - b.hSpeed) / ah;
  const av = (b.vSpeed - a.vSpeed) / T;
  const cent = (a.hSpeed * a.hSpeed) / r; // "centrifugal" relief at orbital-ish speeds
  const up = av + g - cent;
  return { tiltDeg: Math.atan2(ah, up) / D2R, accel: Math.hypot(ah, up) };
}

// ---- scenario list -----------------------------------------------------------------------
export const SCENARIOS = [
  {
    id: 'pdi',
    title: 'Powered Descent',
    subtitle: 'Apollo 11 · PDI to touchdown',
    difficulty: 'Hard',
    activeId: 'LM',
    camera: 'iva',
    station: 'CDR',
    met: TIMELINE.pdi - 40,
    description:
      'Eagle coasts face-down at 15 km, 1,690 m/s, 480 km east of Tranquility Base. In 40 seconds the ' +
      'guidance computer (P63) fires the descent engine for the 12-minute braking burn. Ride the braking ' +
      'phase, the yaw-around and the pitch-over at High Gate, then take over and land before Bingo fuel.',
    tips: ['P63 runs the ignition: ullage, 10 % thrust for 26 s, then full throttle', 'Watch the DSKY and the fuel callouts', 'Take over in P66 below 150 m'],
    setup(game) {
      const lm = game.vessels.LM;
      const csm = game.vessels.CSM;
      const d = descentOrbit();
      const s = keplerPropagate(d.pos, d.vel, -40);
      lm.pos.copy(s.pos);
      lm.vel.copy(s.vel);
      const up = s.pos.clone().normalize();
      const retro = s.vel.clone().normalize().negate();
      quatFromUpForward(retro, up.clone().negate(), lm.quat); // thrust axis retrograde, windows down
      setProps(lm, { main: 8150, rcs: 268, ascent: LM.ascentPropMax });
      setGNC(lm, { program: 'P63', throttleMode: 'AUTO', autopilot: 'GUIDANCE', tig: TIMELINE.pdi, targetDir: SITE_DIR.clone() });
      placeCSM(csm, csmPhaseAt(this.met));
      setProps(csm, { main: 6900, rcs: 470 });
    },
  },
  {
    id: 'highgate',
    title: 'Approach Phase',
    subtitle: 'P64 · High Gate · 2,300 m',
    difficulty: 'Medium',
    activeId: 'LM',
    camera: 'iva',
    station: 'CDR',
    met: TIMELINE.highGate,
    description:
      'Pitch-over at High Gate: 2,300 m up, 7.9 km short of the site, closing at 150 m/s. The landing ' +
      'site swings into the window. Read the LPD angle off the DSKY, sight it on the window reticle and ' +
      'redesignate if the computer is taking you into a boulder field.',
    tips: ['LPD: the DSKY shows where the computer is going — line it up on the window scale', 'Hand-controller clicks redesignate the landing point', 'Switch to P66 near 150 m'],
    setup(game) {
      const lm = game.vessels.LM;
      const csm = game.vessels.CSM;
      setProps(lm, { main: 1500, rcs: 245, ascent: LM.ascentPropMax });
      const hg = MISSION.highGate;
      const r = MOON.radius + hg.altitude;
      const prof = gateProfile(hg, MISSION.lowGate, r);
      placeLMApproach(lm, hg.downrange, hg.altitude, hg.hSpeed, hg.vSpeed, prof.tiltDeg);
      engineRunning(lm, Math.min(1, (lmMass(lm) * prof.accel) / LM.dps.maxThrust));
      setGNC(lm, { program: 'P64', throttleMode: 'AUTO', autopilot: 'GUIDANCE', targetDir: SITE_DIR.clone() });
      placeCSM(csm, csmPhaseAt(this.met));
      setProps(csm, { main: 6900, rcs: 470 });
    },
  },
  {
    id: 'lowgate',
    title: 'Final Descent',
    subtitle: 'P66 · Low Gate · 150 m',
    difficulty: 'Easy',
    activeId: 'LM',
    camera: 'iva',
    station: 'CDR',
    met: TIMELINE.lowGate,
    description:
      '150 m above the Sea of Tranquility, sinking at 16 ft/s and still moving forward at 60 ft/s. P66 ' +
      'flies the throttle: until you touch the ROD switch the LGC eases the sink rate off on the way ' +
      'down, one 1 ft/s click at a time. Your job is the attitude — tilt back to kill the forward ' +
      'speed, then stand her upright — and the last few feet: aim for 2–3 ft/s down at contact.',
    tips: [
      'Hands off the ROD switch and the LGC slows the descent for you; each R/F click (1 ft/s) takes over',
      'She starts tilted back to brake: pitch forward (W) to level out as the forward speed dies',
      'Contact light, then ENGINE STOP',
    ],
    /**
     * After the GNC has initialised P66: hands-off rate-of-descent stepping (as at P64 exit),
     * unless the pilot has already clicked the ROD switch.
     */
    gncInit(game, gnc) {
      const lm = game.vessels.LM;
      const d = gnc?.states?.get?.(lm)?.descent;
      if (d && lm.gnc.program === 'P66' && Math.abs(lm.gnc.rodCmd - MISSION.lowGate.vSpeed) < 1e-6) d.rodAuto = true;
    },
    setup(game) {
      const lm = game.vessels.LM;
      const csm = game.vessels.CSM;
      setProps(lm, { main: 720, rcs: 235, ascent: LM.ascentPropMax });
      const lg = MISSION.lowGate;
      const r = MOON.radius + lg.altitude;
      const prof = gateProfile(lg, { downrange: 0, hSpeed: 0, vSpeed: -1 }, r);
      placeLMApproach(lm, lg.downrange, lg.altitude, lg.hSpeed, lg.vSpeed, prof.tiltDeg);
      engineRunning(lm, Math.min(1, (lmMass(lm) * prof.accel) / LM.dps.maxThrust));
      setGNC(lm, { program: 'P66', throttleMode: 'AUTO', autopilot: 'OFF', rcsMode: 'RATE', attHold: true, rodCmd: lg.vSpeed, targetDir: SITE_DIR.clone() });
      placeCSM(csm, csmPhaseAt(this.met));
      setProps(csm, { main: 6900, rcs: 470 });
    },
  },
  {
    id: 'hover',
    title: 'Landing Practice',
    subtitle: 'Manual hover · 60 m',
    difficulty: 'Beginner',
    activeId: 'LM',
    camera: 'chase',
    station: 'CDR',
    met: get(102, 44, 30),
    description:
      'Eagle hangs motionless 60 m above the plain, 150 m east of Tranquility Base, with the descent ' +
      'engine at hover thrust and about three minutes of propellant. Fully manual: throttle, attitude ' +
      'and translation are yours. Fly to the site and set her down gently.',
    tips: ['Hover throttle is ~29 %: small throttle changes, wait for the response', 'Tilt a few degrees to move, tilt back to stop', 'Cut the engine (X) at contact light'],
    setup(game) {
      const lm = game.vessels.LM;
      const csm = game.vessels.CSM;
      setProps(lm, { main: 800, rcs: 250, ascent: LM.ascentPropMax });
      const s = approachState(-150, 60, 0, 0);
      lm.pos.copy(s.pos);
      lm.vel.set(0, 0, 0);
      quatFromUpForward(s.up, s.travel, lm.quat);
      lm.angVel.set(0, 0, 0);
      // hover throttle = m g / Fmax (g at the CG radius); the sim computes the CG ~2.5 m above the pads
      const r = s.pos.length() + 2.5;
      const hover = (lmMass(lm) * (G / (r * r))) / LM.dps.maxThrust;
      engineRunning(lm, hover);
      lm.ctrl.throttle = hover;
      setGNC(lm, { program: 'P67', throttleMode: 'MANUAL', autopilot: 'OFF', rcsMode: 'RATE', attHold: true, targetDir: SITE_DIR.clone() });
      placeCSM(csm, csmPhaseAt(this.met));
      setProps(csm, { main: 6900, rcs: 470 });
    },
  },
  {
    id: 'undock',
    title: 'Lunar Orbit',
    subtitle: 'Undocking · 111 km',
    difficulty: 'Medium',
    activeId: 'LM',
    camera: 'chase',
    station: 'CDR',
    met: TIMELINE.undock,
    description:
      'Columbia and Eagle, docked, in a 111-km lunar orbit approaching the eastern limb — Earthrise is a ' +
      'few minutes ahead. Undock ("The Eagle has wings"), pirouette in front of Columbia\'s windows for ' +
      'inspection, and fly either spacecraft. Re-docking works too.',
    tips: ['U: undock (0.1 m/s spring separation)', 'V: switch between Eagle and Columbia', 'Translate gently: capture needs about 1 ft/s (0.3 m/s) closing or less and < 10° misalignment'],
    setup(game, util) {
      const lm = game.vessels.LM;
      const csm = game.vessels.CSM;
      const s = circularTrackState(csmPhaseAt(this.met), R_CSM);
      // Eagle upright (thrust axis radial), windows forward along track; Columbia above, nose down.
      quatFromUpForward(s.up, s.travel, lm.quat);
      csm.quat.copy(lm.quat).multiply(REL_QUAT.clone().invert());
      csm.pos.copy(s.pos); // the sim moves the stack so that its CG sits on this orbit point
      csm.vel.copy(s.vel);
      setProps(lm, { main: LM.descentPropMax, rcs: LM.rcsPropMax, ascent: LM.ascentPropMax });
      setProps(csm, { main: CSM.spsPropMax, rcs: 500 });
      setGNC(lm, { program: 'P00' });
      setGNC(csm, { program: 'P00' });
      util.dock();
    },
  },
  {
    id: 'landed',
    title: 'Lunar Liftoff',
    subtitle: 'Tranquility Base · P12 ascent',
    difficulty: 'Medium',
    activeId: 'LM',
    camera: 'chase',
    station: 'CDR',
    met: get(124, 20, 0),
    description:
      'Eagle on the surface after 21½ hours at Tranquility Base. Columbia passed overhead a few minutes ' +
      'ago — the window for a standard co-elliptic rendezvous opens at 124:22:01. P12 is loaded: ' +
      'PROCEED at ignition, the ascent stage fires off the descent stage and climbs to a 17 x 83 km orbit.',
    tips: ['P12 fires the APS at TIG (PRO), or STAGE then throttle up for a manual liftoff', 'The descent stage stays behind as the launch pad', 'Expect the ascent stage to wobble: it has no gimbal'],
    settleLM: true,
    setup(game) {
      const lm = game.vessels.LM;
      const csm = game.vessels.CSM;
      const up = SITE_DIR.clone();
      const { east } = localENU(up);
      const west = east.clone().negate();
      // Eagle came to rest facing west, tilted a few degrees by the local slope
      const pads = LM.gear.padCenterRadius;
      const hW = terrainAt(up.clone().addScaledVector(west, pads / MOON.radius).normalize());
      const hE = terrainAt(up.clone().addScaledVector(west, -pads / MOON.radius).normalize());
      const north = new THREE.Vector3().crossVectors(up, east);
      const hN = terrainAt(up.clone().addScaledVector(north, pads / MOON.radius).normalize());
      const hS = terrainAt(up.clone().addScaledVector(north, -pads / MOON.radius).normalize());
      const normal = up.clone().addScaledVector(west, -(hW - hE) / (2 * pads)).addScaledVector(north, -(hN - hS) / (2 * pads)).normalize();
      quatFromUpForward(normal, west, lm.quat);
      const hMax = Math.max(hW, hE, hN, hS, terrainAt(up));
      lm.pos.copy(up).multiplyScalar(MOON.radius + hMax + 0.02);
      lm.vel.set(0, 0, 0);
      lm.angVel.set(0, 0, 0);
      // touchdown strokes of the primary struts (m) — a soft landing crushes a few centimetres
      const strokes = { fwd: 0.04, right: 0.07, aft: 0.06, left: 0.05 };
      for (const p of lm.gear.pads) p.compression = strokes[p.id] ?? 0.05;
      setProps(lm, { main: 360, rcs: 230, ascent: LM.ascentPropMax });
      setGNC(lm, { program: 'P12', throttleMode: 'AUTO', autopilot: 'GUIDANCE', tig: TIMELINE.liftoff, targetDir: SITE_DIR.clone() });
      // Columbia ~14 deg past the site at liftoff (co-elliptic sequence: CSI, CDH, TPI, docking at 128:03)
      placeCSM(csm, 14 * D2R - meanMotion(R_CSM) * (TIMELINE.liftoff - this.met));
      setProps(csm, { main: 6200, rcs: 400 });
    },
  },
  {
    id: 'csm',
    title: 'Columbia Solo',
    subtitle: 'Command Module Pilot · during the landing',
    difficulty: 'Easy',
    activeId: 'CSM',
    camera: 'iva',
    station: 'CDR',
    met: TIMELINE.pdi - 30,
    description:
      'You are Michael Collins, alone in Columbia at 111 km while Eagle begins its powered descent ' +
      '200 km ahead under computer control. Fly the CSM, watch the landing unfold through the ' +
      'telemetry, and switch to Eagle (V) whenever you want to take the controls.',
    tips: ['V: switch to Eagle', 'Eagle flies itself under P63/P64 guidance until you take over', 'Time warp is limited to 10x while an engine burns'],
    setup(game) {
      SCENARIOS.find((s) => s.id === 'pdi').setup.call({ met: this.met + 0 }, game);
      // re-propagate Eagle to this start time (pdi setup assumed 40 s before PDI)
      const lm = game.vessels.LM;
      const d = descentOrbit();
      const s = keplerPropagate(d.pos, d.vel, this.met - TIMELINE.pdi);
      lm.pos.copy(s.pos);
      lm.vel.copy(s.vel);
      const up = s.pos.clone().normalize();
      quatFromUpForward(s.vel.clone().normalize().negate(), up.clone().negate(), lm.quat);
      placeCSM(game.vessels.CSM, csmPhaseAt(this.met), 35);
    },
  },
  {
    id: 'docking',
    title: 'Docking',
    subtitle: 'Columbia & Eagle · 128:03',
    difficulty: 'Medium',
    activeId: 'CSM',
    camera: 'iva',
    station: 'RV',
    met: get(128, 0, 0),
    description:
      'After the co-elliptic rendezvous Eagle\'s ascent stage is station-keeping 15 m in front of ' +
      'Columbia\'s probe, with the Earth hanging over the lunar horizon beyond. Line up the COAS on the ' +
      'drogue target and close at a few centimetres per second for capture.',
    tips: ['Capture needs about 1 ft/s (0.3 m/s) closing or less, < 1 ft (0.3 m) off-centre, < 10° misalignment', 'Translate with the THC, keep attitude hold on', 'The probe retracts for ~6 s after capture, then the 12 latches fire: hard dock'],
    setup(game) {
      const lm = game.vessels.LM;
      const csm = game.vessels.CSM;
      const phi = -76.5 * D2R; // over the eastern near side, Earth low over the western horizon ahead
      const s = placeCSM(csm, phi, 0);
      // Eagle's ascent stage on the same circular orbit, 25 m ahead (probe tip -> drogue 15 m)
      const gap = -CSM.docking.probeTip.z + 15 + LM.docking.port.y;
      const sl = circularTrackState(phi + gap / R_CSM, R_CSM);
      lm.pos.copy(sl.pos);
      lm.vel.copy(sl.vel);
      // drogue (LM +Y) faces Columbia, windows (-Z) up: already in the docking roll alignment
      quatFromUpForward(sl.travel.clone().negate(), sl.up, lm.quat);
      // ascent stage only; the descent stage stands at Tranquility Base
      lm.staged = true;
      lm.descentStage = { pos: SITE_DIR.clone().multiplyScalar(MOON.radius + terrainAt(SITE_DIR)), quat: quatFromUpForward(SITE_DIR, trackTravel(0), new THREE.Quaternion()), vel: new THREE.Vector3(), angVel: new THREE.Vector3(), landed: true, falling: false, crashed: false, propellant: 360 };
      const e = lm.mainEngine;
      const A = LM.aps;
      Object.assign(e, { name: A.name, maxThrust: A.maxThrust, isp: A.isp, minThrottle: A.minThrottle, maxThrottle: A.maxThrottle, nozzleExitRadius: A.nozzleExitRadius });
      e.thrustDir.copy(A.thrustDir);
      e.nozzleExit.copy(A.nozzleExit);
      e.nozzleThroat.copy(A.nozzleThroat);
      lm.propellant.ascent = 260;
      lm.propellant.main = 260;
      lm.propellant.mainMax = LM.ascentPropMax;
      lm.propellant.rcs = 120;
      setGNC(lm, { program: 'P00', rcsMode: 'RATE', attHold: true });
      setGNC(csm, { program: 'P00', rcsMode: 'RATE', attHold: true });
      setProps(csm, { main: 6200, rcs: 380 });
      csm.gnc.targetDir = s.up.clone();
    },
  },
];
