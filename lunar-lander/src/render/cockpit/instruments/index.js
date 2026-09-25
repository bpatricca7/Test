// STUB — owned by the INSTRUMENTS agent. Live Apollo instruments.
// Contract (see ARCHITECTURE.md §Instruments): every factory returns
//   { object: THREE.Object3D, width, height, update(vessel, game, dt) }
// Face in the local XY plane, facing +Z, centred on the origin; depth toward -Z. Metres.
import * as THREE from 'three';
import { createPanel } from '../kit/index.js';

function placeholder(label, w, h) {
  const object = createPanel({ width: w, height: h, color: 0x202224, labels: [{ text: label, x: 0, y: 0, size: Math.min(w, h) * 0.12 }] });
  return { object, width: w, height: h, update() {} };
}

/** DSKY — display & keyboard. Face 0.203 x 0.216 m. Reads vessel.agc. opts: { keyboard: true } */
export function createDSKY(opts = {}) { return placeholder('DSKY', 0.203, 0.216); }
/** FDAI "8-ball" attitude indicator with rate & error needles. opts: { size: 0.19 } (square bezel). */
export function createFDAI(opts = {}) { const s = opts.size || 0.19; return placeholder('FDAI', s, s); }
/** LM altitude / altitude-rate vertical tape meters. 0.12 x 0.16 m */
export function createAltTapes(opts = {}) { return placeholder('ALT/ALT RATE', 0.12, 0.16); }
/** LM range / range-rate tape meters (rendezvous radar). 0.12 x 0.16 m */
export function createRangeTapes(opts = {}) { return placeholder('RNG/RNG RATE', 0.12, 0.16); }
/** LM cross-pointer (forward & lateral velocity). opts: { size: 0.11 } */
export function createCrossPointer(opts = {}) { const s = opts.size || 0.11; return placeholder('X-POINTER', s, s); }
/** Mission timer: red 7-segment HHH:MM:SS. 0.20 x 0.055 m */
export function createMissionTimer(opts = {}) { return placeholder('MISSION TIMER', 0.2, 0.055); }
/** Event timer: red 7-segment MM:SS. 0.12 x 0.05 m */
export function createEventTimer(opts = {}) { return placeholder('EVENT TIMER', 0.12, 0.05); }
/**
 * Caution & warning annunciator matrix.
 * opts: { labels: [{ text: 'DES QTY', key: 'DES QTY', color: 'amber'|'red'|'white'|'blue' }], cols: 4, cellW: 0.04, cellH: 0.018 }
 * Light i is lit when vessel.cw.lights[labels[i].key] is truthy.
 */
export function createAnnunciatorPanel(opts = {}) { const c = opts.cols || 4, r = Math.ceil((opts.labels || []).length / c) || 1; return placeholder('C&W', c * (opts.cellW || 0.04), r * (opts.cellH || 0.018)); }
/** MASTER ALARM push-button light (lit while vessel.cw.masterAlarm). 0.045 x 0.045 m */
export function createMasterAlarm(opts = {}) { return placeholder('MASTER ALARM', 0.045, 0.045); }
/**
 * Generic analog meter. opts: { kind: 'vertical'|'round', label, min, max, units, getValue(vessel, game) -> number,
 *   width, height, ticks: [values], redline }
 */
export function createGauge(opts = {}) { return placeholder(opts.label || 'GAUGE', opts.width || 0.06, opts.height || 0.08); }
/** LM thrust/weight + thrust % indicator pair. 0.10 x 0.12 m */
export function createThrustIndicator(opts = {}) { return placeholder('THRUST', 0.1, 0.12); }
/** Pair of blue LUNAR CONTACT lights (lit on vessel.gear.probeContact / cw.lights['LUNAR CONTACT']). 0.09 x 0.03 m */
export function createContactLights(opts = {}) { return placeholder('LUNAR CONTACT', 0.09, 0.03); }
/** CSM Entry Monitor System (delta-V counter + scroll). 0.26 x 0.18 m */
export function createEMS(opts = {}) { return placeholder('EMS', 0.26, 0.18); }
/** CSM gimbal position / fuel pressure indicator (SPS). 0.14 x 0.12 m */
export function createGPI(opts = {}) { return placeholder('GPI', 0.14, 0.12); }
/** CSM SPS / RCS propellant quantity & pressure meters cluster. 0.18 x 0.10 m */
export function createPropellantGauges(opts = {}) { return placeholder('PROPELLANT', 0.18, 0.1); }
