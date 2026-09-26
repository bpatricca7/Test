// IVA crew stations: eye points (vessel body frame, from core/constants.js), base view orientation,
// default head-look and field of view. Head-look angles are applied on top of the base orientation.
//
// LM   CDR       Commander, standing at the left window, looking out and ~15 deg down (LPD view)
//      LMP       LM Pilot at the right window
//      OVERHEAD  CDR looking up through the overhead docking window (COAS), image-up = aft
// CSM  CDR       left couch, looking at the Main Display Console
//      CMP       centre couch
//      LMP       right couch
//      RV        at the left rendezvous window, looking forward along the docking axis (-Z)

import * as THREE from 'three';
import { LM, CSM } from '../../core/constants.js';
import { lookQuat } from './math.js';

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

export const STATIONS = {
  LM: [
    { id: 'CDR', label: "Commander's station", eye: LM.eyeCDR.clone(), base: IDENTITY, yaw: 0, pitch: -15, fov: 66 },
    { id: 'LMP', label: "LM Pilot's station", eye: LM.eyeLMP.clone(), base: IDENTITY, yaw: 0, pitch: -15, fov: 66 },
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
    { id: 'CDR', label: "Commander's couch", eye: CSM.eyeCDR.clone(), base: IDENTITY, yaw: 0, pitch: -12, fov: 70 },
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
