// Cameras: cockpit (IVA) crew stations, horizon-locked chase, body-locked, cinematic fly-by,
// ground tripod and target views. Owned by the IO agent.
//
// Contract: createCameras(game, ctx) -> { update(realDt), setMode(mode), cycle(), modes, setLook(yawDeg, pitchDeg) }
// Writes game.view every frame: mode, cameraMCI (MCI, doubles), quat (MCI; camera looks along its
// local -Z), fov (vertical, deg), near, far, ivaVessel, station. Adds game.view.label (display name).
//
// Modes
//   iva     at the crew-station eye point of the active vessel (camera/stations.js) with mouse
//           head-look (yaw ±150°, pitch ±80°), wheel FOV zoom 25–100°, cabin vibration from the
//           engines and RCS jets (camera/shake.js). Shift+C / CYCLE_STATION changes station.
//   chase   orbits the vessel in a horizon-locked frame (never rolls or flips): default behind
//           (opposite the horizontal velocity; the vessel's forward axis when hovering / landed)
//           and ~16° above, wheel zoom 6 m .. 50 km, stays above the terrain.
//   locked  fixed in the vessel body frame (rotates with the spacecraft), orbitable.
//   flyby   a stationary cinematic camera placed ahead along the trajectory with a lateral offset,
//           telephoto framing, re-placed once the vessel has gone by.
//   ground  a tripod 1.7 m above the surface ~170 m from Eagle (LM below 3 km and within 5 km of the
//           site only; skipped by cycle() otherwise).
//   target  over the shoulder of the active vessel, looking at the other one (not when docked).
// Switching between exterior modes (or vessels) blends smoothly (~0.9 s) in vessel-relative space.
//
// Actions: CYCLE_CAMERA, SET_CAMERA {mode}, CYCLE_STATION, RESET_VIEW.
// Events emitted: 'camera' {mode, station, label}.

import * as THREE from 'three';
import { MOON } from '../core/constants.js';
import { localENU } from '../core/frames.js';
import { terrainHeight } from '../world/moon.js';
import { D2R, R2D, smoothK, smoothstep, lookQuat, horizontalDir, slerpAboutAxis, orbitOffset, framingFov, headLookQuat } from './camera/math.js';
import { LOOK_LIMITS, getStation, nextStation, mapStation, STATIONS } from './camera/stations.js';
import { createShake } from './camera/shake.js';
import { createPointer } from './camera/pointer.js';

export const CAMERA_MODES = ['iva', 'chase', 'locked', 'flyby', 'ground', 'target'];
const LABELS = { iva: 'Cockpit', chase: 'Chase', locked: 'Locked', flyby: 'Fly-by', ground: 'Ground', target: 'Target' };
const ALIASES = { orbit: 'chase', cockpit: 'iva', ext: 'chase', free: 'chase' };

const CHASE = {
  elevation: 16, // deg above the horizontal
  fov: 55,
  minDist: 6,
  maxDist: 50000,
  minClearance: 2.0, // m above the terrain
  angleTau: 0.07, // s smoothing of mouse orbit
  distTau: 0.16, // s smoothing of the zoom
  headingTau: 1.4, // s smoothing of the "behind" direction
};
const BLEND_TIME = 0.9;
const DEG_PER_PX = 0.22;

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _e = new THREE.Euler();
const _enu = { east: new THREE.Vector3(), north: new THREE.Vector3(), up: new THREE.Vector3() };

/**
 * What the exterior cameras look at for a vessel: the visual centre of the spacecraft (or of the
 * docked stack), a framing radius and a default chase distance.
 */
function focusFor(game, v, out) {
  const csm = game.vessels.CSM;
  if (v.docked && csm) {
    // docked stack: centre ~3 m ahead of the CM/SM interface along the CSM axis
    out.pos.set(0, 0, -3.0).applyQuaternion(csm.quat).add(csm.pos);
    out.radius = 10;
    out.dist = 40;
  } else if (v.type === 'LM') {
    out.pos.set(0, v.staged ? 4.6 : 3.2, 0).applyQuaternion(v.quat).add(v.pos);
    out.radius = v.staged ? 3 : 5;
    out.dist = v.staged ? 16 : 25;
  } else {
    out.pos.set(0, 0, 1.5).applyQuaternion(v.quat).add(v.pos);
    out.radius = 6;
    out.dist = 30;
  }
  out.vessel = v;
  return out;
}

/** Terrain clearance of an MCI point (m); +Infinity far above the surface. */
function clearance(p) {
  const r = p.length();
  const alt = r - MOON.radius;
  if (alt > 30000) return alt;
  return alt - terrainHeight(p.x / r, p.y / r, p.z / r);
}

/** Push an MCI point radially up so it is at least `min` m above the terrain. */
function keepAbove(p, min) {
  const c = clearance(p);
  if (c < min) p.addScaledVector(_v3.copy(p).normalize(), min - c);
  return p;
}

export function createCameras(game, ctx) {
  const view = game.view;
  const el = ctx?.renderer?.domElement || null;
  const pointer = createPointer(game, el);
  const shake = createShake();
  const input = { dx: 0, dy: 0, wheel: 0, reset: false };

  let mode = normalizeMode(view.mode) || 'iva';
  const stations = { LM: 'CDR', CSM: 'CDR' };
  const focus = { pos: new THREE.Vector3(), radius: 5, dist: 25, vessel: null };

  // ---- per-mode state
  const iva = { yaw: 0, pitch: -15, yawT: 0, pitchT: -15, fov: 66, fovT: 66 };
  const chase = { az: 0, el: CHASE.elevation, azT: 0, elT: CHASE.elevation, dist: 25, distT: 25, back: new THREE.Vector3(), backOk: false };
  const locked = { az: 0, el: 14, azT: 0, elT: 14, dist: 25, distT: 25 };
  const flyby = { pos: null, side: 1, zoom: 1, fov: 30 };
  const ground = { pos: null, zoom: 1, fov: 20 };
  const target = { az: 14, el: 10, azT: 14, elT: 10, zoom: 1, zoomT: 1 };
  const blend = { active: false, t: 0, fromOff: new THREE.Vector3(), fromQuat: new THREE.Quaternion(), fromFov: 60 };
  let fresh = true; // no blend on the first frame after a scenario load
  let lastVesselId = game.activeId;

  // per-frame result
  const cam = { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), fov: 60, near: 0.05 };

  function normalizeMode(m) {
    if (!m) return null;
    m = ALIASES[m] || m;
    return CAMERA_MODES.includes(m) ? m : null;
  }

  function station() {
    const v = game.active;
    return getStation(v.type, stations[v.type]);
  }

  // ------------------------------------------------------------------ availability
  function groundAvailable() {
    const lm = game.vessels.LM;
    if (!lm || game.active !== lm || lm.docked) return false;
    const t = lm.tel;
    return t.altitude < 3000 && t.rangeToSite < 5000;
  }

  function available(m) {
    if (m === 'ground') return groundAvailable();
    if (m === 'target') return !game.active.docked && !!game.inactive;
    return CAMERA_MODES.includes(m);
  }

  // ------------------------------------------------------------------ defaults
  function resetIVA() {
    const s = station();
    iva.yaw = iva.yawT = s.yaw;
    iva.pitch = iva.pitchT = s.pitch;
    iva.fov = iva.fovT = s.fov;
  }
  function resetChase() {
    focusFor(game, game.active, focus);
    chase.az = chase.azT = 0;
    chase.el = chase.elT = CHASE.elevation;
    chase.dist = chase.distT = focus.dist;
    chase.backOk = false;
  }
  function resetLocked() {
    focusFor(game, game.active, focus);
    locked.az = locked.azT = 0;
    locked.el = locked.elT = 14;
    locked.dist = locked.distT = focus.dist;
  }
  function resetView(m = mode) {
    if (m === 'iva') resetIVA();
    else if (m === 'chase') resetChase();
    else if (m === 'locked') resetLocked();
    else if (m === 'flyby') {
      flyby.pos = null;
      flyby.zoom = 1;
    } else if (m === 'ground') {
      ground.pos = null;
      ground.zoom = 1;
    } else if (m === 'target') {
      target.az = target.azT = 14;
      target.el = target.elT = 10;
      target.zoom = target.zoomT = 1;
    }
  }

  function announce() {
    view.label = mode === 'iva' ? `${LABELS.iva} — ${station().label}` : LABELS[mode];
    game.events.emit('camera', { mode, station: view.station, label: view.label });
  }

  function startBlend() {
    if (fresh) return;
    blend.active = true;
    blend.t = 0;
    blend.fromOff.copy(view.cameraMCI).sub(focus.pos);
    blend.fromQuat.copy(view.quat);
    blend.fromFov = view.fov;
    if (blend.fromOff.length() > 20000) blend.active = false; // too far: cut
  }

  // ------------------------------------------------------------------ public API
  const api = {
    modes: CAMERA_MODES,
    labels: LABELS,
    get mode() {
      return mode;
    },
    get station() {
      return view.station;
    },
    stations: STATIONS,
    available,
    setMode(m, opts = {}) {
      const next = normalizeMode(m);
      if (!next) return false;
      const prev = mode;
      focusFor(game, game.active, focus);
      if (next !== prev && prev !== 'iva' && next !== 'iva' && opts.blend !== false) startBlend();
      else blend.active = false;
      mode = next;
      view.mode = next;
      if (next === 'flyby') flyby.pos = null;
      if (next === 'ground') ground.pos = null;
      if (next === 'chase' && prev !== 'chase') chase.backOk = false;
      if (next === 'iva') view.station = station().id;
      announce();
      return true;
    },
    cycle() {
      const i = CAMERA_MODES.indexOf(mode);
      for (let k = 1; k <= CAMERA_MODES.length; k++) {
        const m = CAMERA_MODES[(i + k) % CAMERA_MODES.length];
        if (available(m)) return api.setMode(m);
      }
      return false;
    },
    /** Select a crew station of the active vessel (switches to the cockpit view). */
    setStation(id) {
      const v = game.active;
      if (!(STATIONS[v.type] || []).some((s) => s.id === id)) return false;
      stations[v.type] = id;
      view.station = id;
      resetIVA();
      if (mode !== 'iva') api.setMode('iva');
      else announce();
      return true;
    },
    cycleStation() {
      if (mode !== 'iva') return api.setMode('iva');
      const v = game.active;
      return api.setStation(nextStation(v.type, stations[v.type]));
    },
    resetView() {
      resetView(mode);
    },
    /**
     * Set the look angles immediately (tests / QA). IVA: head yaw (+ right) / pitch (+ up) relative
     * to the station's straight-ahead; chase / locked / target: orbit azimuth (0 = behind,
     * + = toward the vessel's right) and elevation.
     */
    setLook(yawDeg = 0, pitchDeg = 0) {
      if (mode === 'iva') {
        iva.yaw = iva.yawT = THREE.MathUtils.clamp(yawDeg, -LOOK_LIMITS.yaw, LOOK_LIMITS.yaw);
        iva.pitch = iva.pitchT = THREE.MathUtils.clamp(pitchDeg, -LOOK_LIMITS.pitch, LOOK_LIMITS.pitch);
      } else {
        const o = mode === 'locked' ? locked : mode === 'target' ? target : chase;
        o.az = o.azT = yawDeg;
        o.el = o.elT = THREE.MathUtils.clamp(pitchDeg, -85, 85);
      }
    },
    /** Zoom: IVA field of view (deg) or exterior distance (m) / zoom factor. */
    setZoom(value) {
      if (mode === 'iva') iva.fov = iva.fovT = THREE.MathUtils.clamp(value, LOOK_LIMITS.fovMin, LOOK_LIMITS.fovMax);
      else if (mode === 'chase') chase.dist = chase.distT = THREE.MathUtils.clamp(value, CHASE.minDist, CHASE.maxDist);
      else if (mode === 'locked') locked.dist = locked.distT = THREE.MathUtils.clamp(value, CHASE.minDist, CHASE.maxDist);
      else if (mode === 'flyby') flyby.zoom = value;
      else if (mode === 'ground') ground.zoom = value;
      else if (mode === 'target') target.zoom = target.zoomT = value;
    },
    /** Current cabin-vibration offset (deg, magnitude) — QA hook. */
    get shakeDeg() {
      return shake.rotation.length() * R2D;
    },
    update,
  };

  // ------------------------------------------------------------------ events
  game.events.on('action', (a) => {
    switch (a?.name) {
      case 'CYCLE_CAMERA':
        api.cycle();
        break;
      case 'SET_CAMERA':
        api.setMode(a.mode);
        break;
      case 'CYCLE_STATION':
        api.cycleStation();
        break;
      case 'RESET_VIEW':
        api.resetView();
        break;
      default:
        break;
    }
  });

  game.events.on('scenario', () => {
    const v = game.active;
    const other = v.type === 'LM' ? 'CSM' : 'LM';
    const want = view.station;
    stations[v.type] = (STATIONS[v.type] || []).some((s) => s.id === want) ? want : 'CDR';
    stations[other] = mapStation(other, stations[v.type]);
    view.station = stations[v.type];
    mode = normalizeMode(view.mode) || 'iva';
    view.mode = mode;
    fresh = true;
    blend.active = false;
    shake.reset();
    lastVesselId = game.activeId;
    for (const m of CAMERA_MODES) resetView(m);
    announce();
  });

  game.events.on('vessel', () => {
    const v = game.active;
    // keep the mode; exterior views glide over to the new vessel. A docking view carries over to
    // the other spacecraft's docking view (LM overhead window <-> CSM rendezvous window).
    const prevType = v.type === 'LM' ? 'CSM' : 'LM';
    if (stations[prevType] === 'OVERHEAD' || stations[prevType] === 'RV') stations[v.type] = mapStation(v.type, stations[prevType]);
    if (!stations[v.type]) stations[v.type] = 'CDR';
    if (mode === 'iva') resetIVA();
    view.station = stations[v.type];
    focusFor(game, v, focus);
    if (mode !== 'iva') startBlend();
    chase.backOk = false;
    chase.dist = chase.distT = Math.max(chase.distT, focus.dist * 0.6);
    locked.dist = locked.distT = focus.dist;
    flyby.pos = null;
    if (mode === 'target' && !available('target')) mode = view.mode = 'chase';
    if (mode === 'ground' && !available('ground')) mode = view.mode = 'chase';
    shake.reset();
    lastVesselId = game.activeId;
    announce();
  });

  // docking / undocking moves the exterior aim point between the stack centre and the vessel:
  // glide instead of jumping
  const regroup = () => {
    if (mode === 'iva') return;
    focusFor(game, game.active, focus);
    startBlend();
  };
  game.events.on('touchdown', (e) => shake.kick(0.05 + 0.06 * Math.min(4, Math.abs(e?.vSpeed || 0))));
  game.events.on('stage', () => shake.kick(0.12));
  game.events.on('dock', () => {
    shake.kick(0.06);
    regroup();
  });
  game.events.on('undock', () => {
    shake.kick(0.025);
    regroup();
  });
  game.events.on('crash', () => shake.kick(0.3));
  game.events.on('contact', () => shake.kick(0.01));

  // ------------------------------------------------------------------ per-mode cameras
  function updateIVA(dt, v) {
    const s = station();
    const sens = DEG_PER_PX * (game.settings.mouseSensitivity || 1) * (iva.fov / 66);
    iva.yawT += input.dx * sens;
    iva.pitchT -= input.dy * sens;
    const look = view.lookInput;
    if (look) {
      iva.yawT += (look.x || 0) * 70 * dt * (iva.fov / 66);
      iva.pitchT += (look.y || 0) * 70 * dt * (iva.fov / 66);
    }
    iva.yawT = THREE.MathUtils.clamp(iva.yawT, -LOOK_LIMITS.yaw, LOOK_LIMITS.yaw);
    iva.pitchT = THREE.MathUtils.clamp(iva.pitchT, -LOOK_LIMITS.pitch, LOOK_LIMITS.pitch);
    if (input.wheel) iva.fovT = THREE.MathUtils.clamp(iva.fovT * Math.exp(input.wheel * 0.0012), LOOK_LIMITS.fovMin, LOOK_LIMITS.fovMax);
    const k = smoothK(dt, pointer.dragging || pointer.locked ? 0.03 : 0.06);
    iva.yaw += (iva.yawT - iva.yaw) * k;
    iva.pitch += (iva.pitchT - iva.pitch) * k;
    iva.fov += (iva.fovT - iva.fov) * smoothK(dt, 0.1);

    // camera orientation relative to the body: station base * head look * vibration
    headLookQuat(iva.yaw * D2R, iva.pitch * D2R, _q1);
    _q2.copy(s.base).multiply(_q1);
    const partner = v.docked ? game.vessels[v.dockedTo] : null;
    shake.update(dt, partner ? [v, partner] : [v], _q2, game.time.paused);
    const r = shake.rotation;
    _q1.setFromEuler(_e.set(r.x, r.y, r.z, 'YXZ'));
    _q2.multiply(_q1);
    // eye + head translation (camera frame -> body)
    _v1.copy(shake.translation).applyQuaternion(_q2).add(s.eye);
    cam.pos.copy(_v1).applyQuaternion(v.quat).add(v.pos);
    cam.quat.copy(v.quat).multiply(_q2).normalize();
    cam.fov = iva.fov;
    cam.near = 0.01;
  }

  function applyOrbitInput(o, dt, distKey) {
    const sens = DEG_PER_PX * 1.3 * (game.settings.mouseSensitivity || 1);
    o.azT += input.dx * sens;
    o.elT = THREE.MathUtils.clamp(o.elT + input.dy * sens, -85, 85);
    const look = view.lookInput;
    if (look) {
      o.azT += (look.x || 0) * 60 * dt;
      o.elT = THREE.MathUtils.clamp(o.elT - (look.y || 0) * 45 * dt, -85, 85);
    }
    const k = smoothK(dt, CHASE.angleTau);
    o.az += (o.azT - o.az) * k;
    o.el += (o.elT - o.el) * k;
    if (distKey) {
      if (input.wheel) o[distKey + 'T'] = THREE.MathUtils.clamp(o[distKey + 'T'] * Math.exp(input.wheel * 0.0012), CHASE.minDist, CHASE.maxDist);
      // smooth in log space so a 10 km zoom-out feels the same as a 10 m one
      const kd = smoothK(dt, CHASE.distTau);
      o[distKey] = Math.exp(Math.log(o[distKey]) + (Math.log(o[distKey + 'T']) - Math.log(o[distKey])) * kd);
    }
  }

  function updateChase(dt, v) {
    applyOrbitInput(chase, dt, 'dist');
    const up = _enu.up.copy(focus.pos).normalize();
    // desired forward direction on the horizon: horizontal velocity when moving, else the nose
    const fwd = _v1;
    const hvel = _v2.copy(v.docked ? game.vessels.CSM.vel : v.vel);
    const hs = Math.sqrt(Math.max(0, hvel.lengthSq() - hvel.dot(up) ** 2));
    let haveFwd = horizontalDir(_v3.set(0, 0, -1).applyQuaternion(v.quat), up, fwd);
    if (!haveFwd) haveFwd = horizontalDir(_v3.set(0, 1, 0).applyQuaternion(v.quat), up, fwd);
    if (!haveFwd) fwd.copy(chase.back).negate();
    if (hs > 1 && horizontalDir(hvel, up, _v3)) {
      const w = smoothstep((hs - 1) / 5);
      fwd.multiplyScalar(1 - w).addScaledVector(_v3, w);
      if (fwd.lengthSq() < 1e-8) fwd.copy(_v3);
      fwd.normalize();
    }
    const desiredBack = fwd.negate();
    if (!chase.backOk || !horizontalDir(chase.back, up, chase.back)) {
      chase.back.copy(desiredBack);
      chase.backOk = true;
    } else {
      slerpAboutAxis(chase.back, desiredBack, up, smoothK(dt, CHASE.headingTau));
      chase.back.normalize();
    }
    orbitOffset(chase.back, up, chase.az * D2R, chase.el * D2R, chase.dist, cam.pos).add(focus.pos);
    cam.fov = CHASE.fov;
    cam.near = 0.05;
    lookAtFocus(up);
  }

  function lookAtFocus(up) {
    keepAbove(cam.pos, CHASE.minClearance);
    lookQuat(_v1.subVectors(focus.pos, cam.pos), up, cam.quat);
  }

  function updateLocked(dt, v) {
    applyOrbitInput(locked, dt, 'dist');
    // everything in the vessel body frame
    _q1.copy(v.quat).invert();
    const aimB = _v1.subVectors(focus.pos, v.pos).applyQuaternion(_q1);
    const az = locked.az * D2R;
    const el = locked.el * D2R;
    const posB = _v2.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).multiplyScalar(locked.dist).add(aimB);
    lookQuat(_v3.subVectors(aimB, posB), _enu.up.set(0, 1, 0), _q2);
    cam.pos.copy(posB).applyQuaternion(v.quat).add(v.pos);
    cam.quat.copy(v.quat).multiply(_q2).normalize();
    cam.fov = CHASE.fov;
    cam.near = 0.05;
    // the body-fixed camera may dip under the ground: lift it and re-aim
    if (clearance(cam.pos) < CHASE.minClearance) lookAtFocus(_enu.up.copy(focus.pos).normalize());
  }

  function placeFlyby(v) {
    const up = _enu.up.copy(focus.pos).normalize();
    const vel = v.docked ? game.vessels.CSM.vel : v.vel;
    const speed = vel.length();
    const ahead = THREE.MathUtils.clamp(speed * 3, 150, 3000);
    const p = new THREE.Vector3().copy(focus.pos);
    const dir = _v1;
    if (speed > 3) {
      p.addScaledVector(vel, ahead / speed);
      dir.copy(vel).normalize();
    } else {
      if (!horizontalDir(_v2.set(0, 0, -1).applyQuaternion(v.quat), up, dir)) dir.copy(localENU(focus.pos, _v2, _v3, new THREE.Vector3()).east);
      p.addScaledVector(dir, 150);
    }
    const side = _v2.crossVectors(dir, up);
    if (side.lengthSq() < 1e-8) side.set(1, 0, 0).cross(up);
    side.normalize();
    flyby.side = -flyby.side;
    p.addScaledVector(side, flyby.side * (0.12 * ahead + 22));
    p.addScaledVector(up, 0.04 * ahead + 6);
    keepAbove(p, 3);
    flyby.pos = p;
    flyby.ahead = ahead;
    flyby.fov = null;
  }

  function updateFlyby(dt, v) {
    if (input.wheel) flyby.zoom = THREE.MathUtils.clamp(flyby.zoom * Math.exp(-input.wheel * 0.0012), 0.25, 6);
    if (input.dx || input.dy) {
      // a drag re-places the camera on the other side
      if (Math.abs(input.dx) > 40) flyby.pos = null;
    }
    if (!flyby.pos) placeFlyby(v);
    const d = flyby.pos.distanceTo(focus.pos);
    const vel = v.docked ? game.vessels.CSM.vel : v.vel;
    const receding = _v1.subVectors(focus.pos, flyby.pos).dot(vel) > 0;
    if (d > Math.max(400, flyby.ahead * 1.6) || (receding && d > Math.max(300, flyby.ahead * 1.15))) {
      placeFlyby(v);
      blend.active = false; // a cut, like a real film edit
    }
    cam.pos.copy(flyby.pos);
    const dist = cam.pos.distanceTo(focus.pos);
    const want = framingFov(focus.radius, dist, 0.32, 0.8, 60) / flyby.zoom;
    flyby.fov = flyby.fov == null ? want : flyby.fov + (want - flyby.fov) * smoothK(dt, 0.25);
    cam.fov = THREE.MathUtils.clamp(flyby.fov, 0.5, 75);
    cam.near = 0.1;
    lookAtFocus(_enu.up.copy(cam.pos).normalize());
  }

  function placeGround() {
    const lm = game.vessels.LM;
    const { east, north, up } = localENU(lm.pos, _enu.east, _enu.north, _enu.up);
    const anchor = new THREE.Vector3().copy(lm.pos);
    const hv = _v1.copy(lm.vel).addScaledVector(up, -lm.vel.dot(up));
    const hs = hv.length();
    if (hs > 2) anchor.addScaledVector(hv, Math.min(15, 300 / hs)); // where Eagle will be soon
    // south-south-east of Eagle: the low Sun (east) side-lights the spacecraft, shadows fall left
    const az = 155 * D2R;
    const dir = _v2.copy(north).multiplyScalar(Math.cos(az)).addScaledVector(east, Math.sin(az));
    const p = anchor.addScaledVector(dir, 170);
    const r = p.length();
    const h = terrainHeight(p.x / r, p.y / r, p.z / r);
    p.multiplyScalar((MOON.radius + h + 1.7) / r);
    ground.pos = p;
    ground.fov = null;
  }

  function updateGround(dt) {
    const lm = game.vessels.LM;
    focusFor(game, lm, focus);
    if (input.wheel) ground.zoom = THREE.MathUtils.clamp(ground.zoom * Math.exp(-input.wheel * 0.0012), 0.25, 6);
    if (!ground.pos) placeGround();
    // re-place when Eagle has moved far along (horizontal distance)
    const up = _enu.up.copy(ground.pos).normalize();
    const d = _v1.subVectors(focus.pos, ground.pos);
    const horiz = Math.sqrt(Math.max(0, d.lengthSq() - d.dot(up) ** 2));
    if (horiz > 900 && lm.tel.altitude < 3000) {
      placeGround();
      blend.active = false;
    }
    cam.pos.copy(ground.pos);
    const dist = cam.pos.distanceTo(focus.pos);
    const want = framingFov(focus.radius, dist, 0.3, 3, 60) / ground.zoom;
    ground.fov = ground.fov == null ? want : ground.fov + (want - ground.fov) * smoothK(dt, 0.3);
    cam.fov = THREE.MathUtils.clamp(ground.fov, 1, 75);
    cam.near = 0.1;
    lookQuat(_v1.subVectors(focus.pos, cam.pos), up, cam.quat);
    return dist;
  }

  const otherFocus = { pos: new THREE.Vector3(), radius: 5, dist: 25, vessel: null };
  function updateTarget(dt, v) {
    const o = game.inactive;
    focusFor(game, o, otherFocus);
    applyOrbitInput(target, dt, null);
    if (input.wheel) target.zoomT = THREE.MathUtils.clamp(target.zoomT * Math.exp(input.wheel * 0.0012), 0.3, 20);
    target.zoom += (target.zoomT - target.zoom) * smoothK(dt, CHASE.distTau);
    const dHat = _v1.subVectors(otherFocus.pos, focus.pos);
    const L = dHat.length();
    if (L < 1e-3) return updateChase(dt, v);
    dHat.multiplyScalar(1 / L);
    const up = _enu.up.copy(focus.pos).normalize();
    const upP = _v2.copy(up).addScaledVector(dHat, -up.dot(dHat));
    if (upP.lengthSq() < 1e-6) upP.set(0, 1, 0).applyQuaternion(v.quat).addScaledVector(dHat, -_v3.set(0, 1, 0).applyQuaternion(v.quat).dot(dHat));
    upP.normalize();
    const back = _v3.copy(dHat).negate();
    const dist = focus.radius * 3.2 * target.zoom;
    orbitOffset(back, upP, target.az * D2R, target.el * D2R, dist, cam.pos).add(focus.pos);
    keepAbove(cam.pos, CHASE.minClearance);
    // aim a little short of the target when it is close, so both spacecraft stay in frame
    const aim = _v3.copy(otherFocus.pos);
    lookQuat(aim.sub(cam.pos), upP, cam.quat);
    cam.fov = 50;
    cam.near = 0.05;
  }

  // ------------------------------------------------------------------ frame update
  function update(dt) {
    dt = Math.max(0, Math.min(0.25, dt || 0));
    const v = game.active;
    if (!v) return;
    pointer.take(input);
    if (!game.started) input.dx = input.dy = input.wheel = 0;

    // the sim (scenario load) or another module may have written view.mode directly
    const ext = normalizeMode(view.mode);
    if (ext && ext !== mode) api.setMode(ext, { blend: false });
    else if (!ext) view.mode = mode;
    if (game.activeId !== lastVesselId) {
      lastVesselId = game.activeId; // switched without a 'vessel' event
      chase.backOk = false;
    }
    if (input.reset) resetView(mode);

    // automatic fall-backs when a view stops making sense
    if (mode === 'target' && !available('target')) api.setMode('chase');
    if (mode === 'ground') {
      const lm = game.vessels.LM;
      if (!lm || lm.pos.distanceTo(ground.pos || lm.pos) > 12000) api.setMode('chase');
    }

    focusFor(game, v, focus);
    switch (mode) {
      case 'iva':
        updateIVA(dt, v);
        break;
      case 'locked':
        updateLocked(dt, v);
        break;
      case 'flyby':
        updateFlyby(dt, v);
        break;
      case 'ground':
        updateGround(dt);
        break;
      case 'target':
        updateTarget(dt, v);
        break;
      default:
        updateChase(dt, v);
        break;
    }

    // smooth transition between exterior views (in vessel-relative space: the spacecraft may be
    // doing 1.6 km/s, so absolute-space blending would leave it behind)
    if (blend.active) {
      blend.t += dt;
      const s = smoothstep(blend.t / BLEND_TIME);
      _v1.subVectors(cam.pos, focus.pos);
      _v1.lerpVectors(blend.fromOff, _v1, s);
      cam.pos.copy(focus.pos).add(_v1);
      keepAbove(cam.pos, 1.0);
      cam.quat.slerpQuaternions(blend.fromQuat, cam.quat, s);
      cam.fov = blend.fromFov + (cam.fov - blend.fromFov) * s;
      if (blend.t >= BLEND_TIME) blend.active = false;
    }

    view.cameraMCI.copy(cam.pos);
    view.quat.copy(cam.quat);
    view.fov = cam.fov;
    view.near = cam.near;
    view.far = 1e9;
    view.mode = mode;
    view.ivaVessel = mode === 'iva' ? v.id : null;
    view.station = stations[v.type];
    if (!view.label) view.label = LABELS[mode];
    fresh = false;
  }

  announce();
  return api;
}

