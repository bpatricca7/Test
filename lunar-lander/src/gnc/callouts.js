// Crew callouts during the LM landing, in the style of Buzz Aldrin's Apollo 11 calls, built from
// live telemetry (feet, ft/s): "750, coming down at 23", "400 feet, down at 9",
// "100 feet, 3 1/2 down, 9 forward", "40 feet, down 2 1/2, picking up some dust",
// "4 forward, drifting to the right a little". Emitted as 'callout' {text, voice:true, who:'LMP'},
// rate-limited (>= 3 s apart, slower higher up).

import * as THREE from 'three';
import { FT } from '../core/constants.js';

const _up = new THREE.Vector3();
const _f = new THREE.Vector3();
const _r = new THREE.Vector3();

/** Per-LM callout state. */
export function createCalloutState() {
  return { next: 0, n: 0, saidDust: false, saidShadow: false, saidGood: false, lastText: '' };
}

/** Round an altitude (ft) the way it was read off the tape meter / DSKY. */
export function roundAltitude(ft) {
  const step = ft > 1000 ? 100 : ft > 200 ? 50 : ft > 100 ? 10 : 5;
  return Math.max(0, Math.round(ft / step) * step);
}

/** "2,000" style number. */
export function withCommas(n) {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** Speed in ft/s as spoken: 23 / 9 / 4 1/2 / a half. */
export function spokenRate(fps) {
  const a = Math.abs(fps);
  if (a >= 9.75) return String(Math.round(a));
  const h = Math.round(a * 2) / 2;
  if (h === 0) return 'zero';
  if (h === 0.5) return 'a half';
  const i = Math.floor(h);
  return h > i ? `${i} 1/2` : String(i);
}

/**
 * Build the altitude / rate / drift callout for the current state.
 * @param {object} s {altFt, downFps (+ = descending), fwdFps, rightFps, lpdDeg?, n (counter)}
 * @param {object} C callout state (one-time remarks)
 * @returns {string}
 */
export function buildCallout(s, C) {
  const alt = roundAltitude(s.altFt);
  const altS = withCommas(alt);
  const n = s.n || 0;
  const parts = [];
  const r = spokenRate(s.downFps);
  // altitude and rate are separate phrases so remarks can go between them
  let pair;
  if (s.downFps > 0.25) {
    const forms = r === 'a half' ? [[`${altS} feet`, 'down a half'], [altS, 'down a half']] : [[`${altS} feet`, `down at ${r}`], [altS, `coming down at ${r}`], [`${altS} feet`, `${r} down`], [altS, `down ${r}`]];
    pair = forms[n % forms.length];
  } else if (s.downFps < -0.25) pair = [`${altS} feet`, `up ${r}`];
  else pair = [`${altS} feet`, 'holding'];
  parts.push(pair[0]);
  if (!C.saidGood && s.altFt < 90 && s.altFt > 55 && s.downFps > 0 && s.downFps < 4.5 && Math.abs(s.fwdFps) < 12) {
    C.saidGood = true;
    parts.push('looking good');
  }
  parts.push(pair[1]);
  if (s.lpdDeg != null && s.altFt > 400) parts.push(`${Math.round(s.lpdDeg)} degrees`);
  if (s.altFt < 400 && Math.abs(s.fwdFps) >= 0.75) {
    parts.push(s.fwdFps > 0 ? `${spokenRate(s.fwdFps)} forward` : `${spokenRate(s.fwdFps)} back`);
  }
  // one-time remarks, only when true
  if (!C.saidDust && s.dust && s.altFt < 60 && s.altFt > 20) {
    C.saidDust = true;
    parts.push('picking up some dust');
  } else if (C.saidDust && !C.saidShadow && s.shadow && s.altFt < 40 && s.altFt > 12) {
    C.saidShadow = true;
    parts.push('faint shadow');
  }
  if (s.altFt < 250 && Math.abs(s.rightFps) >= 1.5) parts.push(`drifting to the ${s.rightFps > 0 ? 'right' : 'left'} a little`);
  return parts.join(', ') + '.';
}

/**
 * Per-substep landing callouts for the LM (P64 / P66 / P67 below ~3,000 ft).
 * @param {object} v LM
 * @param {object} C callout state
 * @param {object} game
 * @param {number|null} lpdDeg current LPD angle (P64) or null
 */
export function landingCallouts(v, C, game, lpdDeg) {
  const met = game.time.met;
  if (met < C.next || v.gear?.probeContact || v.landed) return;
  const t = v.tel;
  const altM = Number.isFinite(t.radarAltitude) ? t.radarAltitude : t.gearAltitude ?? t.altitude;
  const altFt = altM / FT;
  if (!(altFt < 3000) || altFt < 4) return;
  _up.copy(v.pos).normalize();
  _f.set(0, 0, -1).applyQuaternion(v.quat).addScaledVector(_up, -_f.dot(_up));
  _r.set(1, 0, 0).applyQuaternion(v.quat).addScaledVector(_up, -_r.dot(_up));
  const vh = v.vel.clone().addScaledVector(_up, -v.vel.dot(_up));
  const fwd = _f.lengthSq() > 1e-6 ? vh.dot(_f.normalize()) : 0;
  const right = _r.lengthSq() > 1e-6 ? vh.dot(_r.normalize()) : 0;
  const s = {
    altFt,
    downFps: -t.vSpeed / FT,
    fwdFps: fwd / FT,
    rightFps: right / FT,
    lpdDeg,
    n: C.n,
    dust: v.mainEngine.firing && altM < 30,
    shadow: altM < 14,
  };
  const text = buildCallout(s, C);
  C.n++;
  C.next = met + (altFt > 1000 ? 9 : altFt > 300 ? 6 : altFt > 100 ? 4.5 : 3.4);
  if (text === C.lastText) return;
  C.lastText = text;
  if (game.settings.callouts !== false) game.events.emit('callout', { text, voice: true, who: 'LMP' });
}
