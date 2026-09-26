// Ground contact: LM landing gear, hull strikes, CSM ground impact, landing evaluation.
//
// LM landing gear (per LM.gear, four cantilever legs):
//   * Footpad / regolith contact: stiff spring + damper along the local surface normal
//     (world/moon.js surfaceNormal), static load sinks a pad ~1 cm into the regolith.
//   * Primary strut: crushable aluminium honeycomb. The strut is rigid until its axial load
//     exceeds the crush load, then strokes plastically (no rebound) up to LM.gear.maxStroke.
//     The pad moves along the primary-strut axis (toward the strut's upper attachment).
//     Once the stroke is used up the strut "bottoms" (structural load path, hard landing).
//   * Coulomb friction with the regolith (mu 0.5) using a stick/slip anchor per pad, so a
//     resting LM does not creep at all; the body is put to sleep once settled.
//   * 1.73 m contact probes under the aft, left and right pads: first touch lights LUNAR CONTACT.
// Hull contact points (nozzle rim, descent-stage corners, RCS quads, ascent stage) detect
// structural strikes: > 1.5 m/s impact = crash; the ascent stage touching = tipped over.
//
// Landing result (game.result) is evaluated once the LM has settled with the engine off.

import * as THREE from 'three';
import { LM, CSM, MOON, MISSION, G0 } from '../core/constants.js';
import { terrainHeight, surfaceNormal } from '../world/moon.js';
import { pointVelocity, cgWorld, localG } from './physics.js';

export const GEAR = {
  K_PAD: 3.0e5, // N/m pad-regolith normal stiffness
  C_PAD: 2.4e4, // N s/m normal damping
  K_T: 3.0e5, // N/m tangential stick stiffness
  C_T: 2.0e4, // N s/m tangential damping
  MU: 0.5, // regolith friction coefficient (static / slow sliding)
  PLOW: 0.45, // extra resistance per m/s of pad sliding speed: footpads plough a berm of regolith
  F_CRUSH: 18500, // N (~4,150 lbf) primary-strut honeycomb crush load (axial)
  K_HULL: 2.0e6,
  C_HULL: 6.0e4,
  HULL_CRASH_SPEED: 1.5, // m/s structural strike -> crash
  BOTTOM_CRASH_SPEED: 1.5, // m/s closing speed when a strut bottoms -> gear collapse
  TIP_DEG: 42, // tilt beyond which the LM is lost (tipping over)
  SETTLE_SPEED: 0.05, // m/s
  SETTLE_RATE: 0.01, // rad/s
  SETTLE_TIME: 1.0, // s
  NEAR_ALT: 12, // m: below this CG altitude contact points are evaluated
};

const deg = Math.PI / 180;
const v3 = (x, y, z) => new THREE.Vector3(x, y, z);

// Unit stroke direction of each primary strut (from the footpad toward the upper attachment).
function strokeDirFor(padPos) {
  const g = LM.gear;
  const h = new THREE.Vector3(padPos.x, 0, padPos.z).normalize();
  const top = h.clone().multiplyScalar(g.strutTopRadius).setY(g.strutTopY);
  return top.sub(padPos).normalize();
}

// ---- hull contact points (body frame) --------------------------------------------------
function lmHullPoints() {
  const pts = [];
  // DPS nozzle exit rim (the nozzle extension is designed to crush)
  for (let k = 0; k < 8; k++) {
    const a = (k * 45) * deg;
    pts.push({ label: 'nozzle', desc: 'descent engine nozzle', descent: true, p: v3(0.76 * Math.cos(a), LM.dps.nozzleExit.y, 0.76 * Math.sin(a)) });
  }
  // descent stage octagon (bottom and top corners)
  const rc = LM.descentStage.widthFlats / 2 / Math.cos(22.5 * deg);
  for (let k = 0; k < 8; k++) {
    const a = (22.5 + k * 45) * deg;
    pts.push({ label: 'descent', desc: 'descent stage', descent: true, p: v3(rc * Math.cos(a), LM.descentStage.yBottom, rc * Math.sin(a)) });
    pts.push({ label: 'descent', desc: 'descent stage', descent: true, p: v3(rc * Math.cos(a), LM.descentStage.yTop, rc * Math.sin(a)) });
  }
  // ascent stage: RCS quads (incl. nozzles), cabin corners, top deck, docking tunnel
  const q = LM.rcs.quadRadius + LM.rcs.nozzleOffset;
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    pts.push({ label: 'rcs', desc: 'RCS quad', p: v3(sx * q, LM.rcs.quadHeight, sz * q) });
    pts.push({ label: 'ascent', desc: 'ascent stage', p: v3(sx * 1.3, LM.ascentStage.yBottom, sz * 1.3) });
    pts.push({ label: 'ascent', desc: 'ascent stage', p: v3(sx * 0.95, LM.ascentStage.yTop, sz * 0.9) });
    pts.push({ label: 'ascent', desc: 'ascent stage', p: v3(sx * LM.ascentStage.cabinRadius, LM.ascentStage.cabinAxisY, sz > 0 ? 1.6 : LM.ascentStage.cabinFrontZ) });
  }
  pts.push({ label: 'ascent', desc: 'docking tunnel', p: LM.docking.port.clone() });
  return pts;
}

function csmHullPoints() {
  const pts = [{ p: CSM.docking.probeTip.clone() }, { p: CSM.sps.nozzleExit.clone() }];
  for (let k = 0; k < 8; k++) {
    const a = k * 45 * deg;
    const c = Math.cos(a);
    const s = Math.sin(a);
    pts.push({ p: v3(CSM.cm.baseRadius * c, CSM.cm.baseRadius * s, 0) });
    pts.push({ p: v3(CSM.sm.radius * c, CSM.sm.radius * s, CSM.sm.zRear) });
    pts.push({ p: v3(CSM.cm.coneTopRadius * c, CSM.cm.coneTopRadius * s, CSM.cm.coneTopZ) });
    pts.push({ p: v3(CSM.sps.nozzleExitRadius * c, CSM.sps.nozzleExitRadius * s, CSM.sps.nozzleExit.z) });
  }
  return pts.map((x) => ({ ...x, label: 'csm', desc: 'Columbia' }));
}

/** Initialise contact state for a vessel (vessel.phys.gear / .hull / .td). */
export function initContactState(v) {
  const ph = v.phys;
  if (v.type === 'LM') {
    ph.gear = v.gear.pads.map(() => ({ anchor: new THREE.Vector3(), stuck: false, bottomed: false, pen: 0 }));
    for (const pad of v.gear.pads) {
      pad.strokeDir = strokeDirFor(pad.pos); // body frame, added field (used by render models)
      pad.bodyPos = pad.pos.clone(); // current (compressed) pad-bottom position, body frame
      pad.bottomed = false;
    }
    ph.hull = lmHullPoints().map((h) => ({ ...h, inContact: false }));
  } else {
    ph.hull = csmHullPoints().map((h) => ({ ...h, inContact: false }));
  }
  ph.td = newTouchdownState();
}

export function newTouchdownState() {
  return {
    phase: 'air', // 'air' | 'contact' | 'settled'
    firstPadMet: null,
    vSpeed: 0, // sink rate at first pad contact (m/s, positive down)
    hSpeed: 0,
    maxTilt: 0,
    bottomed: false,
    hullHard: false,
    hullWhat: null,
    engineStopMet: null,
    lastFiringMet: null,
    hintShown: false,
    settleTimer: 0,
    airTimer: 0,
    resultDone: false,
    wasFiringAtContact: false,
  };
}

const _P = new THREE.Vector3();
const _u = new THREE.Vector3();
const _n = new THREE.Vector3();
const _vp = new THREE.Vector3();
const _F = new THREE.Vector3();
const _Ft = new THREE.Vector3();
const _d = new THREE.Vector3();
const _r = new THREE.Vector3();
const _tq = new THREE.Vector3();
const _cg = new THREE.Vector3();
const _pb = new THREE.Vector3();
const _sW = new THREE.Vector3();
const _G = new THREE.Vector3();
const _nCg = new THREE.Vector3();
const _qi = new THREE.Quaternion();
const _nrm = { x: 0, y: 0, z: 1 };

function groundAt(P, outN) {
  const r = P.length();
  _u.copy(P).divideScalar(r);
  const rg = MOON.radius + terrainHeight(_u.x, _u.y, _u.z);
  if (outN) {
    surfaceNormal(_u.x, _u.y, _u.z, _nrm);
    outN.set(_nrm.x, _nrm.y, _nrm.z);
  }
  return rg - r; // radial penetration (m, > 0 = below ground)
}

/**
 * groundAt() with a per-point cache: the terrain radius (and normal) under a contact point is
 * reused while the point stays within sqrt(tol2) metres of where it was last queried. In contact
 * the LM moves millimetres per substep, so this removes most terrain evaluations.
 * Leaves the unit direction of P in _u.
 */
function groundAtCached(P, c, tol2, outN) {
  const r = P.length();
  _u.copy(P).divideScalar(r);
  if (!c.p || c.p.distanceToSquared(P) > tol2 || (outN && !c.n)) {
    c.rg = MOON.radius + terrainHeight(_u.x, _u.y, _u.z);
    (c.p || (c.p = new THREE.Vector3())).copy(P);
    if (outN) {
      surfaceNormal(_u.x, _u.y, _u.z, _nrm);
      (c.n || (c.n = new THREE.Vector3())).set(_nrm.x, _nrm.y, _nrm.z);
    } else c.n = null;
  }
  if (outN) outN.copy(c.n);
  return c.rg - r;
}

/** Altitude of the CG above the terrain directly below it (m). */
export function cgAltitude(v) {
  cgWorld(v, _cg);
  return -groundAt(_cg, null);
}

function addForce(v, ph, P, F) {
  ph.force.add(F);
  ph.contactForce.add(F);
  _r.copy(P).sub(_cg);
  _tq.crossVectors(_r, F);
  _qi.copy(v.quat).invert();
  ph.torque.add(_tq.applyQuaternion(_qi));
}

/**
 * Compute gear + hull contact forces for a free LM (adds into v.phys.force / .torque).
 * Updates gear pad states and the probe contact. Returns {near, padCount, crash}.
 * @param {object} v LM vessel
 * @param {number} h step (s)
 * @param {{emit: Function}} ev event emitter (game.events or a muted wrapper)
 */
export function lmContact(v, h, ev) {
  const ph = v.phys;
  const out = { near: false, padCount: 0, crash: null };
  cgWorld(v, _cg);
  const cc = ph.cgGround || (ph.cgGround = {});
  const altCg = -groundAtCached(_cg, cc, 0.25, null);
  if (altCg > GEAR.NEAR_ALT) {
    releasePads(v);
    for (const hp of ph.hull) hp.inContact = false;
    return out;
  }
  out.near = true;
  if (!cc.n) groundAtCached(_cg, cc, 0, _nCg);
  else _nCg.copy(cc.n);
  // ground point below the CG (for the hull prefilter plane)
  _G.copy(_cg).setLength(_cg.length() + (-altCg));
  const g = LM.gear;
  const gearActive = !v.staged; // the gear belongs to the descent stage

  if (gearActive) {
    for (let i = 0; i < v.gear.pads.length; i++) {
      const pad = v.gear.pads[i];
      const ps = ph.gear[i];
      _pb.copy(pad.pos).addScaledVector(pad.strokeDir, pad.compression);
      pad.bodyPos.copy(_pb);
      _P.copy(_pb).applyQuaternion(v.quat).add(v.pos);
      // probe (hangs 1.73 m below the pad, folds up on contact)
      if (pad.hasProbe && !v.gear.probeContact) {
        _d.set(0, -g.probeLength, 0).applyQuaternion(v.quat).add(_P);
        if (groundAtCached(_d, ps.probe || (ps.probe = {}), 0.0025, null) > 0) probeContact(v, ev);
      }
      const pc = ps.g || (ps.g = {});
      const penR = groundAtCached(_P, pc, 1e-4, null);
      if (penR <= 0) {
        // A pad resting within a few millimetres of the (soft) regolith counts as touching for the
        // resting-stance logic, even though it carries no load this substep. Without this a
        // four-legged LM on uneven ground flickers between tripods and never reads as settled.
        pad.contact = penR > -0.006;
        if (pad.contact) out.padCount++;
        pad.load = 0;
        ps.stuck = false;
        ps.pen = 0;
        continue;
      }
      // local ground normal under this pad (cached while the pad stays within 5 cm)
      if (!ps.nPos || ps.nPos.distanceToSquared(_P) > 0.0025) {
        surfaceNormal(_u.x, _u.y, _u.z, _nrm);
        (ps.n || (ps.n = new THREE.Vector3())).set(_nrm.x, _nrm.y, _nrm.z);
        (ps.nPos || (ps.nPos = new THREE.Vector3())).copy(_P);
      }
      _n.copy(ps.n);
      const cosNU = _n.dot(_u);
      let pen = penR * cosNU;
      pointVelocity(v, _pb, _vp);
      const vn = _vp.dot(_n);
      let Fn = GEAR.K_PAD * pen - GEAR.C_PAD * vn;
      if (Fn < 0) Fn = 0;
      // Primary strut honeycomb crush. Strut (rigid-plastic) and pad/regolith (spring-damper) act
      // in series: while the strut crushes, the normal force is capped at F_CRUSH / ns and the
      // pad's real penetration follows C dpen/dt = F - K pen; the rest of the leg's travel toward
      // the ground is absorbed as strut stroke (energy F_CRUSH x stroke, no rebound).
      _sW.copy(pad.strokeDir).applyQuaternion(v.quat);
      const ns = _n.dot(_sW);
      if (ns > 0.15 && Fn > 0) {
        const cap = GEAR.F_CRUSH / ns;
        if (Fn > cap && pad.compression < g.maxStroke) {
          const prev = ps.pen > 0 ? ps.pen : 0;
          const rate = Math.min((cap - GEAR.K_PAD * prev) / GEAR.C_PAD, Math.max(0, -vn));
          const penA = Math.min(pen, Math.max(0, prev + rate * h));
          let dc = (pen - penA) / ns;
          if (dc > 0) {
            dc = Math.min(dc, g.maxStroke - pad.compression);
            pad.compression += dc;
            pen -= dc * ns;
            _P.addScaledVector(_sW, dc);
            pad.bodyPos.addScaledVector(pad.strokeDir, dc);
          }
          Fn = pad.compression < g.maxStroke - 1e-6 ? cap : Math.max(0, GEAR.K_PAD * pen - GEAR.C_PAD * vn);
        }
        if (pad.compression >= g.maxStroke - 1e-4 && !ps.bottomed) {
          ps.bottomed = true;
          pad.bottomed = true;
          ph.td.bottomed = true;
          // reason text: landing.js impactReason() (units, impact vs gear failure)
          if (-vn > GEAR.BOTTOM_CRASH_SPEED) out.crash = { outcome: 'crashed', kind: 'gear', pad: pad.id, speed: -vn, reason: `Landing gear collapsed (${pad.id} strut bottomed)` };
        }
      }
      ps.pen = pen;
      // friction: stick anchor with Coulomb limit
      if (!ps.stuck) {
        ps.anchor.copy(_P);
        ps.stuck = true;
      }
      _d.copy(_P).sub(ps.anchor);
      _d.addScaledVector(_n, -_d.dot(_n));
      _vp.addScaledVector(_n, -vn); // tangential velocity
      _Ft.copy(_d).multiplyScalar(-GEAR.K_T).addScaledVector(_vp, -GEAR.C_T);
      const lim = (GEAR.MU + GEAR.PLOW * Math.min(_vp.length(), 3)) * Fn;
      const ft = _Ft.length();
      if (ft > lim) {
        if (ft > 1e-9) _Ft.multiplyScalar(lim / ft);
        // slip: re-anchor so the spring alone carries the friction limit
        // (_Ft is tangential, so the new anchor stays on the contact plane)
        ps.anchor.copy(_P).addScaledVector(_Ft, 1 / GEAR.K_T);
      }
      _F.copy(_n).multiplyScalar(Fn).add(_Ft);
      addForce(v, ph, _P, _F);
      pad.contact = Fn > 0 || pen > 0;
      pad.load = Fn;
      if (pad.contact) out.padCount++;
    }
  }

  // hull strikes
  for (const hp of ph.hull) {
    if (v.staged && hp.descent) continue;
    _P.copy(hp.p).applyQuaternion(v.quat).add(v.pos);
    // cheap prefilter: height above the local ground plane under the CG
    if (_d.copy(_P).sub(_G).dot(_nCg) > 1.5) {
      hp.inContact = false;
      continue;
    }
    const penR = groundAtCached(_P, hp.g || (hp.g = {}), 0.0025, _n);
    if (penR <= 0) {
      hp.inContact = false;
      continue;
    }
    pointVelocity(v, hp.p, _vp);
    const vn = _vp.dot(_n);
    if (!hp.inContact) {
      hp.inContact = true;
      if (-vn > GEAR.HULL_CRASH_SPEED && !out.crash) {
        out.crash = { outcome: 'crashed', kind: 'hull', what: hp.desc, speed: -vn, reason: `The ${hp.desc} struck the surface` };
      }
      if (hp.label === 'nozzle' || hp.label === 'descent') {
        ph.td.hullHard = true;
        ph.td.hullWhat = hp.desc;
      }
    }
    const pen = penR * _n.dot(_u);
    let Fn = GEAR.K_HULL * pen - GEAR.C_HULL * vn;
    if (Fn < 0) Fn = 0;
    _vp.addScaledVector(_n, -vn);
    const vt = _vp.length();
    _Ft.copy(_vp).multiplyScalar(vt > 1e-6 ? -Math.min(GEAR.C_HULL, (GEAR.MU * Fn) / vt) : 0);
    _F.copy(_n).multiplyScalar(Fn).add(_Ft);
    addForce(v, ph, _P, _F);
    ph.anyContact = true;
  }
  if (out.padCount > 0) ph.anyContact = true;
  return out;
}

/** Reset pad contact state (gear clear of the ground). */
export function releasePads(v) {
  if (!v.gear) return;
  const ph = v.phys;
  for (let i = 0; i < v.gear.pads.length; i++) {
    const pad = v.gear.pads[i];
    pad.contact = false;
    pad.load = 0;
    ph.gear[i].stuck = false;
  }
}

function probeContact(v, ev) {
  v.gear.probeContact = true;
  v.cw.lights['LUNAR CONTACT'] = true;
  ev.emit('contact', { vessel: v.id });
  ev.emit('callout', { text: 'Contact light.', voice: true, who: 'LMP' });
}

/**
 * CSM (or docked stack member) ground check: any hull point below the terrain = crash.
 * @returns {string|null} crash reason
 */
export function hullBelowGround(v) {
  cgWorld(v, _cg);
  const alt = -groundAt(_cg, null);
  if (alt > 30) return null;
  for (const hp of v.phys.hull) {
    _P.copy(hp.p).applyQuaternion(v.quat).add(v.pos);
    if (groundAt(_P, null) > 0) return `${v.name} struck the lunar surface`;
  }
  if (v.type === 'LM' && !v.staged) {
    for (const pad of v.gear.pads) {
      _P.copy(pad.pos).applyQuaternion(v.quat).add(v.pos);
      if (groundAt(_P, null) > 0) return `${v.name} struck the lunar surface`;
    }
  }
  return null;
}

/** Angle (deg) between the LM thrust axis and the local vertical. */
export function tiltDeg(v) {
  _u.copy(v.pos).normalize();
  _d.set(0, 1, 0).applyQuaternion(v.quat);
  return Math.acos(Math.max(-1, Math.min(1, _d.dot(_u)))) / deg;
}

/** Hover propellant flow (kg/s) of an LM on its current engine at local gravity. */
export function hoverMdot(v) {
  const r = v.pos.length();
  return (v.mass * localG(r)) / (v.mainEngine.isp * G0);
}

/** Ground range (m) from the vessel to its guidance target (vessel.gnc.targetDir). */
export function rangeToTarget(v) {
  _u.copy(v.pos).normalize();
  const t = v.gnc.targetDir;
  const c = Math.max(-1, Math.min(1, _u.dot(t) / (t.length() || 1)));
  return Math.acos(c) * MOON.radius;
}

/**
 * Build the landing result object (see ARCHITECTURE / events.js 'touchdown').
 * @param {object} v LM
 * @param {object} game
 * @param {string} outcome 'landed'|'hard'|'crashed'|'tipped'
 */
export function buildResult(v, game, outcome, reason = null) {
  const td = v.phys.td;
  const lim = MISSION.touchdown;
  const tilt = tiltDeg(v);
  const fuelKg = v.staged ? 0 : Math.max(0, v.propellant.main);
  const fuelSeconds = fuelKg / hoverMdot(v);
  const dist = rangeToTarget(v);
  const vS = td.firstPadMet != null ? td.vSpeed : Math.max(0, -radialSpeed(v));
  const hS = td.firstPadMet != null ? td.hSpeed : horizSpeed(v);
  let rating = 'hard';
  let score = 0;
  const clamp01 = (x) => Math.max(0, Math.min(1, x));
  const accuracy = clamp01(1 - (dist - 30) / 970);
  if (outcome === 'landed') {
    rating = vS <= 0.9 && hS <= 0.6 && tilt <= 6 ? 'perfect' : 'good';
    score = 50 + 15 * clamp01(1 - vS / lim.maxVSpeed) + 10 * clamp01(1 - hS / lim.maxHSpeed) + 5 * clamp01(1 - tilt / lim.maxTiltDeg) + 12 * accuracy + 8 * clamp01(fuelSeconds / 60);
  } else if (outcome === 'hard') {
    score = 20 + 10 * accuracy + 5 * clamp01(fuelSeconds / 60);
  }
  return {
    vessel: v.id,
    outcome,
    reason,
    vSpeed: vS,
    hSpeed: hS,
    tiltDeg: tilt,
    maxTiltDeg: Math.max(td.maxTilt, tilt),
    fuelKg,
    fuelSeconds,
    distanceToTarget: dist,
    met: game.time.met,
    rating,
    score: Math.round(score),
  };
}

function radialSpeed(v) {
  _u.copy(v.pos).normalize();
  return v.vel.dot(_u);
}
function horizSpeed(v) {
  _u.copy(v.pos).normalize();
  const vr = v.vel.dot(_u);
  return Math.sqrt(Math.max(0, v.vel.lengthSq() - vr * vr));
}
export { radialSpeed, horizSpeed };
