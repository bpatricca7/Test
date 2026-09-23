// Character department test bench (not part of the film).
// t selects a test shot; see update() below.
import * as THREE from 'three';
import { createHead } from '../lib/human/head.js';
import { faceControls, VISEMES } from '../lib/human/face.js';

const VIS = ['sil', 'PP', 'FF', 'TH', 'DD', 'kk', 'CH', 'SS', 'nn', 'RR', 'aa', 'E', 'I', 'O', 'U'];

export async function create(env) {
  const { U } = env;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x2a2d33);
  const camera = new THREE.PerspectiveCamera(20, 16 / 9, 0.02, 50);
  const key = new THREE.DirectionalLight(0xffe2c4, 2.6); key.position.set(0.9, 1.1, 1.6); scene.add(key);
  const fill = new THREE.DirectionalLight(0x9fc0ff, 0.7); fill.position.set(-1.6, 0.3, 1.0); scene.add(fill);
  const rim = new THREE.DirectionalLight(0xcfe0ff, 1.6); rim.position.set(-0.6, 0.8, -1.5); scene.add(rim);
  scene.add(new THREE.HemisphereLight(0x9aa6b8, 0x3a2e28, 0.55));

  const heads = {};
  for (const id of ['maya', 'sam']) {
    const rnd = U.mulberry32(id === 'maya' ? 7 : 11);
    const h = createHead(id, { rnd, log: m => console.warn(m) });
    console.warn(`${id}: head tris ${h.tris}, ears ${h.ears.tris}`);
    h.group.visible = false;
    scene.add(h.group);
    heads[id] = h;
  }

  function faceShot(h, st, view = 'front') {
    const c = faceControls(st, h.persona);
    const gz = st.gaze || { yaw: 0, pitch: 0 };
    h.setFace(c, { L: gz, R: gz }, null);
    h.group.visible = true;
    const E = h.L.eyeL;
    if (view === 'front') { camera.position.set(0.0, -0.01, 0.62); camera.lookAt(0, -0.025, 0.05); camera.fov = 20; }
    if (view === 'mouth') { camera.position.set(0.0, -0.045, 0.36); camera.lookAt(0, -0.055, 0.07); camera.fov = 16; }
    if (view === 'eye') { camera.position.set(0.05, 0.01, 0.30); camera.lookAt(E[0], E[1], E[2]); camera.fov = 14; }
    if (view === '34') { camera.position.set(0.36, 0.0, 0.52); camera.lookAt(0, -0.02, 0.03); camera.fov = 20; }
    if (view === 'side') { camera.position.set(0.62, 0.0, 0.05); camera.lookAt(0, -0.02, 0.0); camera.fov = 22; }
    camera.updateProjectionMatrix();
  }

  return {
    scene, camera,
    update(t) {
      for (const k in heads) heads[k].group.visible = false;
      const mode = Math.floor(t + 1e-6);
      const fr = t - mode;
      if (mode >= 1100 && mode < 1200) {
        const who = mode < 1150 ? 'maya' : 'sam';
        const i = (mode - 1100) % 50;
        if (i < 15) faceShot(heads[who], { visemes: { [VIS[i]]: 1 } }, 'mouth');
        else if (i === 20) faceShot(heads[who], {}, 'front');
        else if (i === 21) faceShot(heads[who], {}, '34');
        else if (i === 22) faceShot(heads[who], {}, 'side');
        else if (i === 23) faceShot(heads[who], {}, 'eye');
        else if (i === 24) faceShot(heads[who], { blink: fr * 2 > 1 ? 1 : fr * 2 }, 'eye');
        else if (i === 25) faceShot(heads[who], { mouth: { smile: 1 }, eyes: { squint: 0.2 } }, 'front');
        else if (i === 26) faceShot(heads[who], { mouth: { frown: 0.8 }, brows: { furrow: 1, sad: 0.2 } }, 'front');
        else if (i === 27) faceShot(heads[who], { brows: { raise: 1 }, eyes: { wide: 1 }, mouth: { jaw: 0.35 } }, 'front');
        else if (i === 28) faceShot(heads[who], { brows: { sad: 1 }, mouth: { frown: 0.4 } }, 'front');
        else if (i === 29) faceShot(heads[who], { gaze: { yaw: 0.35, pitch: 0.2 } }, 'front');
        else if (i === 30) faceShot(heads[who], { visemes: { aa: 1 } }, 'front');
        else faceShot(heads[who], {}, 'front');
      }
    },
    bloom: () => ({ strength: 0.15, radius: 0.3, threshold: 0.9 }),
  };
}
