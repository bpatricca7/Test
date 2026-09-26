// IVA crew stations: eye points (vessel body frame, from core/constants.js), base view orientation,
// default head-look and field of view. Head-look angles are applied on top of the base orientation.
//
// LM   CDR       Commander, standing at the left window, looking out and ~25 deg down: the
//                horizon and the LPD scale in the window, the X-pointer at the bottom left
//      LMP       LM Pilot at the right window
//      OVERHEAD  CDR looking up through the overhead docking window (COAS), image-up = aft
// CSM  CDR       left couch, looking at the Main Display Console
//      CMP       centre couch
//      LMP       right couch
//      RV        at the left rendezvous window, looking forward along the docking axis (-Z)

import * as THREE from 'three';
import { LM, CSM } from '../../core/constants.js';
import { lookQuat, headLookQuat } from './math.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

/** Eye 0.42 m behind the left rendezvous window, on the line through the window centre along -Z. */
function rendezvousEye() {
  const w = CSM.windows.rendezvousLeft;
  return w.center.clone().add(V(0, 0, 0.42));
}

/** Eye below the LM overhead window (head tilted back). */
function overheadEye() {
  const w = LM.windows.overhead;
  return w.center.clone().add(V(0, -0.5, 0.04));
}

const IDENTITY = new THREE.Quaternion();

/**
 * Head-look angles (deg, + right / + up, relative to a base-identity station looking along -Z)
 * that aim from `eye` at the body-frame point `target`.
 */
export function aimAt(eye, target) {
  const d = target.clone().sub(eye);
  return {
    yaw: Math.atan2(d.x, -d.z) * (180 / Math.PI),
    pitch: Math.atan2(d.y, Math.hypot(d.x, d.z)) * (180 / Math.PI),
  };
}

/**
 * Head roll (deg, + = counter-clockwise image rotation) that makes the body-frame direction `up`
 * point straight up in a head-look view (yaw, pitch deg): the crewman tilts his head to read a
 * panel he looks at from the side.
 */
export function uprightRoll(yaw, pitch, up) {
  const q = headLookQuat((yaw * Math.PI) / 180, (pitch * Math.PI) / 180).invert();
  const u = up.clone().applyQuaternion(q);
  return (Math.atan2(-u.x, u.y) * 180) / Math.PI;
}

// LM panel 4 (DSKY) centre and its "up" direction (face tilted 35 deg back), body frame — from the
// cabin's panel layout (src/render/cockpit/lm/layout.js; checked by test/io.cameras.test.js).
const LM_DSKY = V(0, 4.43, -1.0);
const LM_DSKY_UP = V(0, Math.cos(0.61), -Math.sin(0.61));

/**
 * Glances (key O cycles them): look presets of a station. The first entry is the station's
 * straight-ahead view. Each: { id, label, yaw, pitch, fov, roll? (deg), lean? (eye offset, body
 * frame, m) }.
 * A glance may lean the head (the Commander bends toward the DSKY); the eye returns to the design
 * eye point on the window view, where the LPD scale lines up.
 */
function lmGlances(side, eye) {
  const s = side; // -1 = CDR (left), +1 = LMP (right)
  const lean = V(-s * 0.08, -0.06, 0);
  const dsky = aimAt(eye.clone().add(lean), LM_DSKY);
  return [
    { id: 'OUT', label: 'Out the window', yaw: 0, pitch: -25, fov: 66 },
    // FDAI, ALT/ALT RATE tapes, X-pointer, C&W, MASTER ALARM, event timer and the DSKY
    { id: 'PANEL', label: 'Flight displays', yaw: -s * 25, pitch: -62, fov: 80 },
    { id: 'DSKY', label: 'DSKY', yaw: dsky.yaw, pitch: dsky.pitch, roll: uprightRoll(dsky.yaw, dsky.pitch, LM_DSKY_UP), fov: 34, lean },
  ];
}

function withGlances(def) {
  const g = def.glances?.[0];
  return g ? { ...def, yaw: g.yaw, pitch: g.pitch, fov: g.fov } : def;
}

export const STATIONS = {
  LM: [
    withGlances({ id: 'CDR', label: "Commander's station", eye: LM.eyeCDR.clone(), base: IDENTITY, glances: lmGlances(-1, LM.eyeCDR) }),
    withGlances({ id: 'LMP', label: "LM Pilot's station", eye: LM.eyeLMP.clone(), base: IDENTITY, glances: lmGlances(1, LM.eyeLMP) }),
    {
      id: 'OVERHEAD',
      label: 'Overhead docking window',
      eye: overheadEye(),
      // look up (+Y body) with the top of the image toward the aft cabin (+Z)
      base: lookQuat(V(0, 1, 0), V(0, 0, 1)),
      yaw: 0,
      pitch: 0,
      fov: 62,
    },
  ],
  CSM: [
    withGlances({
      id: 'CDR',
      label: "Commander's couch",
      eye: CSM.eyeCDR.clone(),
      base: IDENTITY,
      glances: [
        { id: 'MDC', label: 'Main display console', yaw: 0, pitch: -12, fov: 70 },
        // up past the MDC to the left rendezvous window (the CDR's line of sight is kept clear)
        { id: 'WINDOW', label: 'Rendezvous window', ...aimAt(CSM.eyeCDR, CSM.windows.rendezvousLeft.center), fov: 38 },
      ],
    }),
    { id: 'CMP', label: "Command Module Pilot's couch", eye: CSM.eyeCMP.clone(), base: IDENTITY, yaw: 0, pitch: -10, fov: 70 },
    { id: 'LMP', label: "LM Pilot's couch", eye: CSM.eyeLMP.clone(), base: IDENTITY, yaw: 0, pitch: -12, fov: 70 },
    { id: 'RV', label: 'Rendezvous window (COAS)', eye: rendezvousEye(), base: IDENTITY, yaw: 0, pitch: 0, fov: 50 },
  ],
};

/** Head-look limits (deg) relative to the station base orientation. */
export const LOOK_LIMITS = { yaw: 150, pitch: 80, fovMin: 25, fovMax: 100 };

/** Station definition for a vessel type ('LM' | 'CSM') and id; falls back to the first (CDR). */
export function getStation(type, id) {
  const list = STATIONS[type] || STATIONS.LM;
  return list.find((s) => s.id === id) || list[0];
}

/** Look presets of a station (at least the straight-ahead view). */
export function glancesOf(st) {
  return st.glances && st.glances.length ? st.glances : [{ id: 'OUT', label: 'Ahead', yaw: st.yaw, pitch: st.pitch, fov: st.fov }];
}

/** Next station id in the vessel's list. */
export function nextStation(type, id) {
  const list = STATIONS[type] || STATIONS.LM;
  const i = list.findIndex((s) => s.id === id);
  return list[(i + 1) % list.length].id;
}

/**
 * Equivalent station when switching vessel type (docking views map to each other; a station that
 * does not exist on the other vehicle falls back to the Commander).
 */
export function mapStation(toType, id) {
  if (toType === 'LM') return id === 'RV' ? 'OVERHEAD' : id === 'LMP' ? 'LMP' : 'CDR';
  return id === 'OVERHEAD' ? 'RV' : id === 'LMP' ? 'LMP' : id === 'CMP' ? 'CMP' : 'CDR';
}
