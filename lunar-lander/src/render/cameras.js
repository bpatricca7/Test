// STUB — owned by the IO agent (input, cameras, audio). Replace with the full implementation.
// Contract: createCameras(game, ctx) -> { update(realDt), setMode(mode), cycle(), modes }
// Writes game.view.{mode, cameraMCI, quat, fov, near, far, ivaVessel, station} every frame.
import * as THREE from 'three';
import { LM, CSM } from '../core/constants.js';
import { localENU, quatFromForwardUp } from '../core/frames.js';

const MODES = ['iva', 'chase'];

export function createCameras(game, ctx) {
  let yaw = 0, pitch = -0.1, dist = 30, dragging = false, lx = 0, ly = 0;
  const el = ctx.renderer.domElement;
  el.addEventListener('mousedown', (e) => { dragging = true; lx = e.clientX; ly = e.clientY; });
  window.addEventListener('mouseup', () => (dragging = false));
  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    yaw -= (e.clientX - lx) * 0.005; pitch -= (e.clientY - ly) * 0.005; lx = e.clientX; ly = e.clientY;
    pitch = Math.max(-1.5, Math.min(1.5, pitch));
  });
  el.addEventListener('wheel', (e) => { dist *= Math.exp(e.deltaY * 0.001); dist = Math.max(8, Math.min(5000, dist)); });
  game.events.on('action', (a) => { if (a.name === 'CYCLE_CAMERA') api.cycle(); });
  const api = {
    modes: MODES,
    setMode(m) { game.view.mode = m; yaw = 0; pitch = m === 'iva' ? 0 : -0.1; game.events.emit('camera', { mode: m }); },
    cycle() { api.setMode(MODES[(MODES.indexOf(game.view.mode) + 1) % MODES.length]); },
    update(dt) {
      const v = game.active;
      const view = game.view;
      if (view.mode === 'iva') {
        const eye = v.type === 'LM' ? LM.eyeCDR : CSM.eyeCDR;
        view.cameraMCI.copy(eye).applyQuaternion(v.quat).add(v.pos);
        const look = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ'));
        view.quat.copy(v.quat).multiply(look);
        view.ivaVessel = v.id;
        view.near = 0.01;
        view.fov = 70;
      } else {
        const { up } = localENU(v.pos);
        const back = new THREE.Vector3().subVectors(v.pos.clone().normalize().multiplyScalar(0), v.vel).normalize();
        if (!isFinite(back.x) || back.lengthSq() < 0.5) back.set(1, 0, 0);
        const q = quatFromForwardUp(back.clone().negate(), up);
        const off = new THREE.Vector3(0, 0, dist).applyEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ')).applyQuaternion(q);
        const center = v.pos.clone().add(new THREE.Vector3(0, v.type === 'LM' ? 3.5 : 0, 0).applyQuaternion(v.quat));
        view.cameraMCI.copy(center).add(off);
        view.quat.copy(quatFromForwardUp(off.clone().negate(), up));
        view.ivaVessel = null;
        view.near = 0.1;
        view.fov = 55;
      }
    },
  };
  return api;
}
