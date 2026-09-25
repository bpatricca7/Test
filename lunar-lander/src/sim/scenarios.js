// STUB — owned by the SIM-CORE agent. Scenario definitions (initial conditions).
// Contract: export SCENARIOS = [{ id, title, subtitle, description, difficulty, activeId, camera, met, setup(game, util) }]
import * as THREE from 'three';
import { MOON, MISSION } from '../core/constants.js';
import { SITE_DIR, localENU, quatFromUpForward, quatFromForwardUp, circularSpeed } from '../core/frames.js';
import { terrainHeight } from '../world/moon.js';

/** Point on the approach ground track: downrange d (m, negative = before the site), altitude h above terrain. */
export function approachState(d, h, hSpeed, vSpeed) {
  const { east } = localENU(SITE_DIR);
  const west = east.clone().negate();
  const th = d / MOON.radius;
  const dir = SITE_DIR.clone().multiplyScalar(Math.cos(th)).addScaledVector(west, Math.sin(th)).normalize();
  const travel = SITE_DIR.clone().multiplyScalar(-Math.sin(th)).addScaledVector(west, Math.cos(th)).normalize();
  const r = MOON.radius + terrainHeight(dir.x, dir.y, dir.z) + h;
  return {
    pos: dir.clone().multiplyScalar(r),
    vel: travel.clone().multiplyScalar(hSpeed).addScaledVector(dir, vSpeed),
    up: dir,
    travel,
  };
}

function lmAt(game, d, h, hs, vs, tiltBackDeg, windowsDown = false) {
  const lm = game.vessels.LM;
  const s = approachState(d, h, hs, vs);
  lm.pos.copy(s.pos);
  lm.vel.copy(s.vel);
  const t = (tiltBackDeg * Math.PI) / 180;
  const thrustAxis = s.up.clone().multiplyScalar(Math.cos(t)).addScaledVector(s.travel, -Math.sin(t));
  const fwd = windowsDown ? s.up.clone().negate() : s.travel.clone().multiplyScalar(Math.cos(t)).addScaledVector(s.up, -Math.sin(t));
  quatFromUpForward(thrustAxis, fwd, lm.quat);
  lm.angVel.set(0, 0, 0);
}

function csmInOrbit(game, leadAngleDeg) {
  const csm = game.vessels.CSM;
  const { east } = localENU(SITE_DIR);
  const west = east.clone().negate();
  const th = (leadAngleDeg * Math.PI) / 180;
  const dir = SITE_DIR.clone().multiplyScalar(Math.cos(th)).addScaledVector(west, Math.sin(th)).normalize();
  const travel = SITE_DIR.clone().multiplyScalar(-Math.sin(th)).addScaledVector(west, Math.cos(th)).normalize();
  const r = MOON.radius + MISSION.csmOrbitAltitude;
  csm.pos.copy(dir).multiplyScalar(r);
  csm.vel.copy(travel).multiplyScalar(circularSpeed(r));
  quatFromForwardUp(travel, dir, csm.quat);
  csm.angVel.set(0, 0, 0);
}

export const SCENARIOS = [
  {
    id: 'pdi', title: 'Powered Descent', subtitle: 'Apollo 11 · PDI to touchdown', difficulty: 'Hard', activeId: 'LM', camera: 'iva', met: 102 * 3600 + 32 * 60,
    description: 'Eagle, 15 km above the Moon at 1,695 m/s, seconds before Powered Descent Initiation.',
    setup(game) { lmAt(game, -480000, 15200, 1695, 0, 90, true); csmInOrbit(game, 3); },
  },
  {
    id: 'highgate', title: 'Approach Phase', subtitle: 'P64 · High Gate', difficulty: 'Medium', activeId: 'LM', camera: 'iva', met: 102 * 3600 + 41 * 60,
    description: 'Pitch-over at 2,300 m. The landing site comes into view.',
    setup(game) { lmAt(game, MISSION.highGate.downrange, MISSION.highGate.altitude, MISSION.highGate.hSpeed, MISSION.highGate.vSpeed, 45); csmInOrbit(game, 10); },
  },
  {
    id: 'lowgate', title: 'Final Descent', subtitle: 'P66 · Low Gate', difficulty: 'Easy', activeId: 'LM', camera: 'iva', met: 102 * 3600 + 44 * 60,
    description: '150 m above Tranquility Base. Take over manually and land.',
    setup(game) { lmAt(game, MISSION.lowGate.downrange, MISSION.lowGate.altitude, MISSION.lowGate.hSpeed, MISSION.lowGate.vSpeed, 12); csmInOrbit(game, 12); },
  },
  {
    id: 'hover', title: 'Landing Practice', subtitle: 'Hover at 60 m', difficulty: 'Beginner', activeId: 'LM', camera: 'chase', met: 102 * 3600 + 45 * 60,
    description: 'A gentle start: Eagle hovering 60 m above the surface.',
    setup(game) { lmAt(game, -120, 60, 3, 0, 0); csmInOrbit(game, 15); },
  },
  {
    id: 'undock', title: 'Lunar Orbit', subtitle: 'Undocking · 111 km', difficulty: 'Medium', activeId: 'LM', camera: 'chase', met: 100 * 3600 + 12 * 60,
    description: 'Columbia and Eagle, docked in lunar orbit. Undock and fly both spacecraft.',
    setup(game) {
      csmInOrbit(game, -40);
      const lm = game.vessels.LM, csm = game.vessels.CSM;
      const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, -1, 0)));
      lm.quat.copy(csm.quat).multiply(q);
      lm.pos.copy(csm.pos).add(new THREE.Vector3(0, 0, -2.95 - 6.45).applyQuaternion(csm.quat));
      lm.vel.copy(csm.vel);
      lm.docked = csm.docked = true; lm.dockedTo = 'CSM'; csm.dockedTo = 'LM';
    },
  },
  {
    id: 'landed', title: 'Lunar Liftoff', subtitle: 'Tranquility Base · Ascent', difficulty: 'Medium', activeId: 'LM', camera: 'chase', met: 124 * 3600 + 22 * 60,
    description: 'Eagle on the surface. Fire the ascent stage and return to Columbia.',
    setup(game) { lmAt(game, 0, 0, 0, 0, 0); game.vessels.LM.landed = true; csmInOrbit(game, -8); },
  },
  {
    id: 'csm', title: 'Columbia Solo', subtitle: 'Command Module Pilot', difficulty: 'Easy', activeId: 'CSM', camera: 'iva', met: 102 * 3600 + 20 * 60,
    description: 'Orbit the Moon in Columbia while Eagle descends.',
    setup(game) { csmInOrbit(game, -30); lmAt(game, -300000, 15500, 1690, 0, 90, true); },
  },
];
