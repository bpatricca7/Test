// Apollo Guidance Computer display & keyboard (DSKY) state — vessel.agc — for both spacecraft.
//
// The program sequencer (gnc/programs.js) chooses the VERB/NOUN (S.disp); this module fills
// the three 5-digit registers with the noun's quantities in the real Apollo units and scaling,
// refreshes them about once per second like the LGC/CMC display routines, flickers COMP ACTY,
// drives the status lights and raises program alarms (1201/1202) and OPR ERR.
//
// Register strings: sign + 5 digits ('+12345', '-00125'); '' = blank register. Registers that
// Apollo displayed as two fields (minutes/seconds, TTAA) use a blank middle digit ('+05 30').
// Octal registers (alarm codes) have a blank sign: ' 01202'.
//
// Nouns implemented (R1 / R2 / R3):
//   N09 alarm codes              first / second / last alarm (octal)
//   N33 time of ignition         hours / minutes / seconds x100 (GET)
//   N40 DOI burn (P40)           time from ignition mm ss / velocity to be gained ft/s x10 / delta-V ft/s x10
//   N43 lat / long / alt         deg x100 / deg x100 / nmi x10       (P68 landing site)
//   N44 orbit                    apolune nmi x10 / perilune nmi x10 / time from perilune mm ss
//                                (-59 59 when the orbit is too circular for a perilune)
//   N60 P66 landing              forward velocity ft/s x10 / altitude rate ft/s x10 / altitude ft
//   N62 pre-ignition (P63)       inertial velocity ft/s x10 / time from ignition mm ss / delta-V ft/s x10
//   N63 braking phase (P63)      delta-h ft / altitude rate ft/s x10 / altitude ft
//   N64 approach (P64)           TT AA (s to go for redesignation, LPD angle deg) / h-dot x10 / altitude ft
//   N74 ascent ignition (P12)    time from ignition mm ss / yaw deg x100 / pitch deg x100
//   N76 ascent targets (P12)     horizontal velocity ft/s x10 / radial velocity ft/s x10 / crossrange nmi x10
//   N83 thrust monitor (P47)     delta-V body X / Y / Z ft/s x10 (Apollo axes)
//   N94 powered ascent (P12)     velocity to be gained ft/s x10 / altitude rate ft/s x10 / altitude ft

import * as THREE from 'three';
import { FT, NMI, MOON } from '../core/constants.js';

const R2D = 180 / Math.PI;
const _v = new THREE.Vector3();
const _u = new THREE.Vector3();
const _q = new THREE.Quaternion();

// ------------------------------------------------------------------ formatting

/** Signed 5-digit register: round(value * scale), clamped to +-99999. NaN -> blank. */
export function reg(value, scale = 1) {
  if (value == null || !Number.isFinite(value)) return '';
  let n = Math.round(value * scale);
  if (n > 99999) n = 99999;
  if (n < -99999) n = -99999;
  const s = n < 0 || Object.is(n, -0) ? '-' : '+';
  return s + String(Math.abs(n)).padStart(5, '0');
}

/** Minutes/seconds register 'XXbXX' (blank middle digit), clamped to 59:59. */
export function regMinSec(seconds) {
  if (seconds == null || !Number.isFinite(seconds)) return '';
  const s = seconds < 0 ? '-' : '+';
  let t = Math.min(3599, Math.round(Math.abs(seconds)));
  const m = Math.floor(t / 60);
  t -= m * 60;
  return `${s}${String(m).padStart(2, '0')} ${String(t).padStart(2, '0')}`;
}

/** Two 2-digit fields 'AAbBB' (e.g. N64 R1 TTAA). */
export function regPair(a, b) {
  const c = (x) => String(Math.max(0, Math.min(99, Math.round(x)))).padStart(2, '0');
  return `+${c(a)} ${c(b)}`;
}

/** Octal register without sign (alarm codes). */
export function regOctal(code) {
  return code ? ` ${String(code).padStart(5, '0')}` : '';
}

// ------------------------------------------------------------------ state

/** Per-vessel AGC private state. */
export function createAGCState() {
  return {
    refresh: 0, // s to the next register refresh
    compTimer: 0,
    compOn: false,
    busy: 0, // COMP ACTY burst remaining (s)
    oprErrTimer: 0,
    alarmDisplay: 0, // s remaining of the V05 N09 alarm display
    alarms: [], // alarm codes since the last reset (N09)
    dv: new THREE.Vector3(), // P47 accumulated delta-V (Apollo body axes, m/s)
    prevVel: null,
  };
}

/** Request a COMP ACTY burst (a guidance cycle, a key press...). */
export function compBurst(A, seconds = 0.35) {
  A.busy = Math.max(A.busy, seconds);
}

/** Light OPR ERR (invalid key sequence). */
export function operatorError(v, A, game, why) {
  v.agc.lights.oprErr = true;
  A.oprErrTimer = 4;
  if (why) game.events.emit('message', { text: `OPR ERR — ${why}`, level: 'warn' });
}

/**
 * Raise an Apollo program alarm (e.g. '1202'): PROG light, master alarm, 'alarm' event and
 * the V05 N09 alarm display. Guidance keeps running (the Executive sheds low-priority jobs).
 */
export function programAlarm(v, A, game, code, text) {
  v.agc.alarmCode = code;
  v.agc.lights.prog = true;
  A.alarms.push(code);
  if (A.alarms.length > 3) A.alarms.shift();
  A.alarmDisplay = 6;
  v.cw.masterAlarm = true;
  v.cw.lights['MASTER ALARM'] = true;
  game.events.emit('alarm', { code, text, vessel: v.id });
}

/** Clear the master alarm and the AGC alarm lights (MASTER ALARM push-button + DSKY RSET). */
export function resetAlarms(v, A) {
  v.cw.masterAlarm = false;
  if ('MASTER ALARM' in v.cw.lights) v.cw.lights['MASTER ALARM'] = false;
  v.agc.lights.prog = false;
  v.agc.lights.oprErr = false;
  v.agc.alarmCode = null;
  A.alarmDisplay = 0;
  A.alarms.length = 0;
  A.oprErrTimer = 0;
}

// ------------------------------------------------------------------ nouns

/**
 * Fill r1..r3 for a noun.
 * @param {object} v vessel
 * @param {object} S gnc per-vessel state (disp, descent, ascent, agc...)
 * @param {object} game
 * @param {string} noun two-digit noun
 */
export function nounRegisters(v, S, game, noun) {
  const t = v.tel;
  const d = S.descent;
  const out = ['', '', ''];
  switch (noun) {
    case '09': {
      const a = S.agc.alarms;
      out[0] = regOctal(a[0]);
      out[1] = regOctal(a[1]);
      out[2] = regOctal(a[a.length - 1]);
      break;
    }
    case '33': {
      const tig = S.tig ?? v.gnc.tig;
      if (Number.isFinite(tig)) {
        const hh = Math.floor(tig / 3600);
        const mm = Math.floor((tig - hh * 3600) / 60);
        out[0] = reg(hh);
        out[1] = reg(mm);
        out[2] = reg(tig - hh * 3600 - mm * 60, 100);
      }
      break;
    }
    case '40': {
      // P40 (DOI): time from ignition, velocity to be gained, delta-V accumulated
      const b = S.burn;
      const tig = b?.tig ?? v.gnc.tig;
      out[0] = regMinSec(Number.isFinite(tig) ? game.time.met - tig : NaN);
      out[1] = reg((b ? b.vgo.length() : 0) / FT, 10);
      out[2] = reg((b?.dvAcc || 0) / FT, 10);
      break;
    }
    case '43': {
      out[0] = reg(t.lat, 100);
      out[1] = reg(t.lon, 100);
      const rs = v.pos.length() - MOON.radius; // landing-site radius above the reference sphere
      out[2] = reg(rs / NMI, 10);
      break;
    }
    case '44': {
      const o = orbitNumbers(v);
      out[0] = reg(o.apo / NMI, 10);
      out[1] = reg(o.peri / NMI, 10);
      // near-circular: perilune undefined -> the DSKY's "no solution" -59 59
      out[2] = Number.isFinite(o.tfp) ? regMinSec(o.tfp) : '-59 59';
      break;
    }
    case '60': {
      // forward velocity: along the LM's forward (-Z) axis projected on the local horizontal
      const up = _u.copy(v.pos).normalize();
      const fwd = _v.set(0, 0, -1).applyQuaternion(v.quat);
      fwd.addScaledVector(up, -fwd.dot(up));
      const fv = fwd.lengthSq() > 1e-8 ? v.vel.dot(fwd.normalize()) : 0;
      out[0] = reg(fv / FT, 10);
      out[1] = reg(t.vSpeed / FT, 10);
      out[2] = reg(lgcAltitude(v, S) / FT);
      break;
    }
    case '62': {
      out[0] = reg(v.vel.length() / FT, 10);
      const tig = d?.tig ?? v.gnc.tig;
      out[1] = regMinSec(Number.isFinite(tig) ? game.time.met - tig : NaN);
      out[2] = reg((d?.dvAcc || 0) / FT, 10);
      break;
    }
    case '63':
      out[0] = reg(d && d.radarLock ? d.deltaH / FT : 0);
      out[1] = reg(t.vSpeed / FT, 10);
      out[2] = reg(lgcAltitude(v, S) / FT);
      break;
    case '64': {
      const tt = v.gnc.lpdTimeLeft;
      const aa = v.gnc.lpdAngle;
      out[0] = Number.isFinite(tt) && Number.isFinite(aa) ? regPair(tt, aa) : '';
      out[1] = reg(t.vSpeed / FT, 10);
      out[2] = reg(lgcAltitude(v, S) / FT);
      break;
    }
    case '74': {
      const a = S.ascent;
      const tig = a?.tig;
      out[0] = regMinSec(Number.isFinite(tig) ? game.time.met - tig : NaN);
      out[1] = reg(a?.yawAfterRise ?? 0, 100);
      out[2] = reg(a?.pitchAfterRise ?? 90, 100);
      break;
    }
    case '76': {
      const a = S.ascent;
      out[0] = reg((a?.target?.vHorizontal ?? 0) / FT, 10);
      out[1] = reg((a?.target?.vRadial ?? 0) / FT, 10);
      out[2] = reg((a?.crossRange ?? 0) / NMI, 10);
      break;
    }
    case '83': {
      const dv = S.agc.dv;
      out[0] = reg(dv.x / FT, 10);
      out[1] = reg(dv.y / FT, 10);
      out[2] = reg(dv.z / FT, 10);
      break;
    }
    case '94': {
      const a = S.ascent;
      out[0] = reg((a?.steer?.vgo ?? 0) / FT, 10);
      out[1] = reg(t.vSpeed / FT, 10);
      out[2] = reg(Math.max(0, v.tel.altitude) / FT);
      break;
    }
    default:
      break;
  }
  return out;
}

/** Altitude the LGC believes (descent: radar-updated state vector; else telemetry). */
export function lgcAltitude(v, S) {
  const d = S.descent;
  const t = v.tel;
  if (v.type !== 'LM') return t.altitude;
  const ga = Number.isFinite(t.gearAltitude) ? t.gearAltitude : t.altitude;
  if (d && d.active && !v.landed) return ga + (d.navBias || 0);
  return ga;
}

/** Apolune / perilune altitudes (m above the reference sphere) and time from perilune (s). */
export function orbitNumbers(v) {
  const t = v.tel;
  let tfp = NaN;
  const e = t.eccentricity ?? 0;
  const a = t.semiMajorAxis;
  if (Number.isFinite(a) && a > 0 && e < 0.99 && e > 2e-4) {
    const r = v.pos.length();
    const cosE = (1 - r / a) / e;
    let E = Math.acos(Math.max(-1, Math.min(1, cosE)));
    const vr = v.vel.dot(v.pos) / r;
    if (vr < 0) E = -E;
    const M = E - e * Math.sin(E);
    const n = Math.sqrt(MOON.mu / (a * a * a));
    tfp = M / n; // negative before perilune
  }
  return { apo: t.apoapsisAlt, peri: t.periapsisAlt, tfp };
}

// ------------------------------------------------------------------ per-substep update

/**
 * Update the DSKY for one substep: registers (~1 Hz), COMP ACTY, lights, verb/noun, P47 dV.
 * @param {object} v vessel
 * @param {object} S gnc per-vessel state; S.disp = {verb, noun, flash, blank}
 * @param {object} game
 * @param {number} h substep (s)
 * @param {boolean} powered guidance/engine active (busier computer)
 */
export function updateAGC(v, S, game, h, powered) {
  const A = S.agc;
  const agc = v.agc;
  const disp = S.disp;
  agc.prog = (v.gnc.program || 'P00').replace(/^P/, '').padStart(2, '0');

  // P47 thrust monitor: accumulate the sensed (non-gravitational) delta-V in Apollo body axes
  if (A.prevVel) {
    const r2 = v.pos.lengthSq();
    const gk = (-MOON.mu / (r2 * Math.sqrt(r2))) * (A.prevH || h); // gravity over the last physics step
    _v.copy(v.vel).sub(A.prevVel).addScaledVector(v.pos, -gk);
    if (_v.length() < 50 * h + 1) {
      _v.applyQuaternion(_q.copy(v.quat).invert());
      // Apollo axes: LM X = +Y(up) Y = +X Z = -Z ; CSM X = -Z (fwd) Y = +X Z = -Y
      if (v.type === 'LM') A.dv.x += _v.y, A.dv.y += _v.x, A.dv.z += -_v.z;
      else A.dv.x += -_v.z, A.dv.y += _v.x, A.dv.z += -_v.y;
    }
    A.prevVel.copy(v.vel);
  } else A.prevVel = v.vel.clone();
  A.prevH = h;

  // alarm display (V05 N09) overrides the program display for a few seconds
  let verb = disp.verb;
  let noun = disp.noun;
  let flash = !!disp.flash;
  if (A.alarmDisplay > 0) {
    A.alarmDisplay -= h;
    verb = '05';
    noun = '09';
    flash = true;
  }
  const changed = agc.verb !== verb || agc.noun !== noun;
  agc.verb = verb;
  agc.noun = noun;
  agc.flashVerbNoun = flash;

  A.refresh -= h;
  if (disp.blank) {
    agc.r1 = agc.r2 = agc.r3 = '';
  } else if (changed || A.refresh <= 0) {
    A.refresh = powered ? 1.0 : 1.0;
    const r = nounRegisters(v, S, game, noun);
    agc.r1 = r[0];
    agc.r2 = r[1];
    agc.r3 = r[2];
    compBurst(A, powered ? 0.25 + Math.random() * 0.35 : 0.08 + Math.random() * 0.1);
  }

  // COMP ACTY: bursts plus a random flicker while the computer is busy
  if (A.busy > 0) {
    A.busy -= h;
    A.compTimer -= h;
    if (A.compTimer <= 0) {
      A.compOn = Math.random() < 0.75;
      A.compTimer = 0.03 + Math.random() * 0.08;
    }
  } else A.compOn = false;
  agc.lights.compActy = A.compOn;

  // status lights
  if (A.oprErrTimer > 0) {
    A.oprErrTimer -= h;
    if (A.oprErrTimer <= 0) agc.lights.oprErr = false;
  }
  if (v.type === 'LM') {
    const d = S.descent;
    const descending = d && d.active && !v.landed && !v.staged;
    agc.lights.alt = !!(descending && !d.radarGood);
    agc.lights.vel = !!(descending && !d.radarVelGood);
  } else {
    agc.lights.alt = false;
    agc.lights.vel = false;
  }
  agc.lights.keyRel = !!disp.keyRel;
  agc.lights.noAtt = false;
  agc.lights.gimbalLock = false;
  agc.lights.stby = false;
  agc.lights.restart = false;
  agc.lights.tracker = false;
  agc.lights.temp = false;
  agc.lights.uplinkActy = !!disp.uplink;
}
