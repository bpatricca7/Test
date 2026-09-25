// STUB — owned by the SIM-CORE agent. Replace with the full implementation.
// Contract: createSim(game, { gnc }) -> { scenarios, loadScenario(id), step(realDt, opts) -> simDt }
import * as THREE from 'three';
import { MOON } from '../core/constants.js';
import { createLM, createCSM } from '../core/state.js';
import { vecToLatLon, localENU, horizonAttitude, orbitSummary } from '../core/frames.js';
import { terrainHeight } from '../world/moon.js';
import { SCENARIOS } from './scenarios.js';

export function createSim(game, { gnc }) {
  const tmp = new THREE.Vector3();
  function loadScenario(id) {
    const sc = SCENARIOS.find((s) => s.id === id) || SCENARIOS[0];
    game.vessels.LM = createLM();
    game.vessels.CSM = createCSM();
    sc.setup(game);
    game.activeId = sc.activeId;
    game.time.met = sc.met;
    game.scenarioId = sc.id;
    game.result = null;
    if (sc.camera) game.view.mode = game.params.camera || sc.camera;
    gnc.reset?.();
    for (const v of Object.values(game.vessels)) updateTelemetry(v);
    game.events.emit('scenario', { id: sc.id });
  }
  function updateTelemetry(v) {
    const ll = vecToLatLon(v.pos);
    const d = tmp.copy(v.pos).normalize();
    const th = terrainHeight(d.x, d.y, d.z);
    const t = v.tel;
    t.lat = ll.lat; t.lon = ll.lon;
    t.altitudeRef = ll.r - MOON.radius;
    t.terrainHeight = th;
    t.altitude = ll.r - MOON.radius - th;
    const { east, north, up } = localENU(v.pos);
    t.velENU.set(v.vel.dot(east), v.vel.dot(north), v.vel.dot(up));
    t.vSpeed = t.velENU.z;
    t.hSpeed = Math.hypot(t.velENU.x, t.velENU.y);
    t.attitude = horizonAttitude(v.pos, v.quat);
    const o = orbitSummary(v.pos, v.vel);
    t.periapsisAlt = o.periapsisAlt; t.apoapsisAlt = o.apoapsisAlt; t.period = o.period; t.orbitalSpeed = o.speed;
    t.fuelFraction = v.propellant.main / v.propellant.mainMax;
  }
  function stepVessel(v, h) {
    if (v.landed && v.mainEngine.throttleCmd <= 0) return;
    const r2 = v.pos.lengthSq();
    const g = tmp.copy(v.pos).multiplyScalar(-MOON.mu / (r2 * Math.sqrt(r2)));
    v.mass = v.type === 'LM' ? 15000 : 16000;
    const e = v.mainEngine;
    e.throttle = e.throttleCmd > 0 && v.propellant.main > 0 ? Math.max(e.minThrottle, e.throttleCmd) : 0;
    e.firing = e.throttle > 0;
    const acc = g.clone();
    if (e.firing) {
      const F = e.maxThrust * e.throttle;
      acc.addScaledVector(e.thrustDir.clone().applyQuaternion(v.quat), F / v.mass);
      v.propellant.main -= (F / (e.isp * 9.80665)) * h;
      v.landed = false;
    }
    v.vel.addScaledVector(acc, h);
    v.pos.addScaledVector(v.vel, h);
    // angular: gnc stub writes v.debugAngAcc
    if (v.debugAngAcc) v.angVel.addScaledVector(v.debugAngAcc, h);
    const w = v.angVel.length();
    if (w > 1e-9) v.quat.multiply(new THREE.Quaternion().setFromAxisAngle(v.angVel.clone().divideScalar(w), w * h)).normalize();
    // crude ground clamp
    const d = v.pos.clone().normalize();
    const rs = MOON.radius + terrainHeight(d.x, d.y, d.z);
    if (v.pos.length() < rs) {
      v.pos.copy(d).multiplyScalar(rs);
      v.vel.set(0, 0, 0);
      v.angVel.set(0, 0, 0);
      if (!v.landed) { v.landed = true; game.events.emit('touchdown', { vessel: v.id, vSpeed: 0, hSpeed: 0, tiltDeg: 0, rating: 'good' }); }
    }
  }
  function step(realDt, opts = {}) {
    const warp = opts.ignoreWarp ? 1 : game.time.warp;
    const simDt = realDt * warp;
    const n = Math.max(1, Math.ceil(simDt / 0.02));
    const h = simDt / n;
    for (let i = 0; i < n; i++) {
      gnc.update(h);
      for (const v of Object.values(game.vessels)) {
        if (v.docked && v.id === 'LM') continue;
        stepVessel(v, h);
      }
      const lm = game.vessels.LM, csm = game.vessels.CSM;
      if (lm.docked) { lm.pos.copy(csm.pos).add(new THREE.Vector3(0, 0, -9.4).applyQuaternion(csm.quat)); lm.vel.copy(csm.vel); }
      game.time.met += h;
    }
    for (const v of Object.values(game.vessels)) updateTelemetry(v);
    game.time.warpActual = warp;
    return simDt;
  }
  return { scenarios: SCENARIOS, loadScenario, step, updateTelemetry };
}
