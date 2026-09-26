// Cabin vibration for the IVA camera: the crew's head riding on the structure.
//
//  - Main engine: continuous broadband buzz scaled by thrust (DPS gentle rumble, APS a faster but
//    light buzz — "very smooth, very quiet ride" — SPS a strong shudder), with an ignition
//    transient (chamber-pressure build-up jolt) and a small shutdown kick.
//  - RCS: every jet that lights gives the structure a short "thump" in the direction of its
//    reaction force — the familiar bang of the LM's 100-lbf jets through the cabin wall.
//  - Events (touchdown, staging, docking) kick the same spring.
//
// Output: small rotation offsets (rad, camera pitch/yaw/roll) and a translation (m, camera frame).
// The model is a damped 3-axis spring driven by impulses and filtered noise, so motion is smooth
// and physically plausible rather than random jitter.

import * as THREE from 'three';

const ENGINE = {
  DPS: { rumble: 0.0011, freq: 9, ignite: 0.006 },
  APS: { rumble: 0.0007, freq: 14, ignite: 0.0055 },
  SPS: { rumble: 0.0024, freq: 7, ignite: 0.014 },
};
const RCS_KICK = 0.0011; // rad of head rotation per jet firing (LM-size vehicle)
const SPRING_HZ = 5.5;
const DAMPING = 0.32;

/** Smooth 1-D value noise (deterministic). */
function vnoise(t, seed) {
  const i = Math.floor(t);
  const f = t - i;
  const h = (n) => {
    const s = Math.sin((n + seed * 57.13) * 127.1) * 43758.5453;
    return (s - Math.floor(s)) * 2 - 1;
  };
  const u = f * f * (3 - 2 * f);
  return h(i) * (1 - u) + h(i + 1) * u;
}

export function createShake() {
  const pos = new THREE.Vector3(); // spring state: rotation offset (rad), x pitch, y yaw, z roll
  const vel = new THREE.Vector3();
  const rot = new THREE.Vector3(); // output: spring + high-frequency buzz
  const trans = new THREE.Vector3();
  const prevLevels = new Map(); // vessel -> Float32Array of jet levels
  const prevThrust = new Map(); // vessel -> last thrust fraction
  const igniteT = new Map(); // vessel -> time since ignition (s)
  let t = 0;
  const _v = new THREE.Vector3();
  const _q = new THREE.Quaternion();

  function impulse(x, y, z) {
    vel.x += x;
    vel.y += y;
    vel.z += z;
  }

  return {
    rotation: rot,
    translation: trans,
    /** Kick the spring (rad/s); used for touchdown, staging, docking. */
    kick(strength = 0.02) {
      impulse((Math.random() * 2 - 1) * strength * 0.4 - strength, (Math.random() * 2 - 1) * strength * 0.5, (Math.random() * 2 - 1) * strength * 0.5);
    },
    reset() {
      pos.set(0, 0, 0);
      vel.set(0, 0, 0);
      rot.set(0, 0, 0);
      trans.set(0, 0, 0);
      prevLevels.clear();
      prevThrust.clear();
      igniteT.clear();
    },
    /**
     * @param {number} dt real seconds
     * @param {object[]} vessels vessels whose structure carries vibration to the eye (the cabin's
     *                   vessel, plus the docked partner)
     * @param {THREE.Quaternion} camInBody camera orientation relative to the cabin vessel body
     * @param {boolean} paused sim paused (engines keep their state but nothing new happens)
     */
    update(dt, vessels, camInBody, paused = false) {
      if (!(dt > 0)) return;
      dt = Math.min(dt, 0.1);
      t += dt;
      let rumble = 0;
      let freq = 9;
      _q.copy(camInBody).invert();
      for (const v of vessels) {
        const e = v.mainEngine;
        const spec = ENGINE[e?.name] || ENGINE.DPS;
        const thr = e && e.firing ? e.throttle || 0 : 0;
        // vehicle mass matters: the same jet shakes the light ascent stage much harder than the stack
        const massScale = Math.min(2.5, Math.max(0.35, 7000 / Math.max(1000, v.mass || 15000)));
        const prev = prevThrust.get(v) ?? thr;
        if (thr > 0.02 && prev <= 0.02) igniteT.set(v, 0);
        if (thr <= 0.02 && prev > 0.2 && !paused) {
          // shutdown: the deceleration pulse nods the head forward
          impulse(-spec.ignite * 14 * massScale * prev, 0, 0);
        }
        prevThrust.set(v, thr);
        let ig = igniteT.get(v);
        if (ig !== undefined) {
          ig += dt;
          igniteT.set(v, ig);
          if (ig > 1.2) igniteT.delete(v);
          else if (!paused) {
            // chamber pressure build-up: a jolt, then a decaying shudder
            const env = Math.exp(-ig * 3.5);
            rumble += spec.ignite * env * massScale;
            if (ig < dt * 1.5) impulse(-spec.ignite * 17 * massScale, 0, 0);
          }
        }
        if (thr > 0 && !paused) {
          rumble += spec.rumble * Math.sqrt(thr) * massScale;
          freq = spec.freq;
        }
        // RCS thumps: a jet lighting up this frame
        const jets = v.rcs?.jets || [];
        let lv = prevLevels.get(v);
        if (!lv || lv.length !== jets.length) {
          lv = new Float32Array(jets.length);
          prevLevels.set(v, lv);
        }
        if (!paused) {
          for (let i = 0; i < jets.length; i++) {
            const j = jets[i];
            const now = j.level || 0;
            if (now > 0.05 && lv[i] <= 0.05) {
              // reaction force direction (body) -> camera frame; the head rotates away from the push
              _v.copy(j.forceDir).applyQuaternion(_q);
              const k = RCS_KICK * massScale * (0.7 + 0.6 * Math.random());
              impulse(_v.y * k * 60, -_v.x * k * 60, (Math.random() - 0.5) * k * 30);
            }
            lv[i] = now;
          }
        }
      }
      // filtered-noise drive for the continuous rumble
      if (rumble > 0) {
        const a = rumble * 60;
        impulse(vnoise(t * freq, 1) * a * dt * 60, vnoise(t * freq * 1.37, 2) * a * dt * 45, vnoise(t * freq * 0.83, 3) * a * dt * 30);
      }
      // integrate the damped spring (sub-stepped for stability)
      const w = 2 * Math.PI * SPRING_HZ;
      const n = Math.ceil(dt / 0.004);
      const h = dt / n;
      for (let i = 0; i < n; i++) {
        vel.x += (-w * w * pos.x - 2 * DAMPING * w * vel.x) * h;
        vel.y += (-w * w * pos.y - 2 * DAMPING * w * vel.y) * h;
        vel.z += (-w * w * pos.z - 2 * DAMPING * w * vel.z) * h;
        pos.addScaledVector(vel, h);
      }
      // keep it sane whatever happens
      pos.clampScalar(-0.03, 0.03);
      // head translation follows the rotation (neck pivot ~0.12 m below the eyes)
      trans.set(-pos.y * 0.12, pos.x * 0.12, 0);
      // high-frequency buzz on top (not integrated: fine grain the spring would smooth away)
      rot.copy(pos);
      if (rumble > 0) {
        const b = rumble * 0.25;
        rot.x += vnoise(t * 31, 4) * b;
        rot.y += vnoise(t * 27, 5) * b;
      }
    },
  };
}
