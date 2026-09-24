// Character department test bench (not part of the film).
// t selects a test shot:
//   1100+i  Maya face tests (i<15: viseme i; 20 front; 21 3/4; 22 side; 23 eye; 24 blink; 25.. expressions)
//   1150+i  Sam face tests (same layout)
//   1500+i  body poses, both characters (fraction of t drives walk/gesture phase)
import * as THREE from 'three';
import { createHuman } from '../lib/human.js';

const VIS = ['sil', 'PP', 'FF', 'TH', 'DD', 'kk', 'CH', 'SS', 'nn', 'RR', 'aa', 'E', 'I', 'O', 'U'];

export async function create(env) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x2a2d33);
  const camera = new THREE.PerspectiveCamera(20, 16 / 9, 0.02, 50);
  const key = new THREE.DirectionalLight(0xffe2c4, 2.6); key.position.set(0.9, 1.6, 1.6); scene.add(key);
  const fill = new THREE.DirectionalLight(0x9fc0ff, 0.7); fill.position.set(-1.6, 0.8, 1.0); scene.add(fill);
  const rim = new THREE.DirectionalLight(0xcfe0ff, 1.6); rim.position.set(-0.6, 1.5, -1.5); scene.add(rim);
  const hemi = new THREE.HemisphereLight(0x9aa6b8, 0x3a2e28, 0.55); scene.add(hemi);

  // GPU timing probe (test bench only): sync with a 1-pixel readPixels after each render call
  {
    const R = env.renderer, gl = R.getContext();
    const orig = R.render.bind(R);
    const px = new Uint8Array(4);
    R.render = (sc, cam) => {
      if (!window.__gpuProbe) return orig(sc, cam);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const a = performance.now();
      orig(sc, cam);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      window.__gpuLog.push((sc === scene ? 'SCENE ' : 'pass ') + (performance.now() - a).toFixed(0));
      window.__lastRenderEnd = performance.now();
    };
  }
  const t0 = performance.now();
  const maya = await createHuman(env, 'maya');
  const t1 = performance.now();
  const sam = await createHuman(env, 'sam');
  const t2 = performance.now();
  console.warn(`create maya ${(t1 - t0).toFixed(0)} ms, sam ${(t2 - t1).toFixed(0)} ms`);
  for (const h of [maya, sam]) {
    console.warn(`${h.id}: head ${h.stats.headTris} ears ${h.stats.earTris} body ${h.stats.bodyTris} hair ${h.stats.hairTris} heights ${JSON.stringify(h.heights)}`);
    scene.add(h.root);
  }
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), new THREE.MeshStandardMaterial({ color: 0x4a4440, roughness: 0.9 }));
  floor.rotation.x = -Math.PI / 2; scene.add(floor);
  const props = new THREE.Group(); scene.add(props);
  const desk = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.04, 0.7), new THREE.MeshStandardMaterial({ color: 0x6a5040, roughness: 0.7 }));
  props.add(desk);
  const seatA = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.06, 0.46), new THREE.MeshStandardMaterial({ color: 0x404850 }));
  const seatB = seatA.clone(); props.add(seatA, seatB);

  // ---- hut-like lighting (1800+): lamp, monitor glow, alarm, moon, hologram
  const hut = new THREE.Group(); hut.visible = false; scene.add(hut);
  const hutLights = new THREE.Group(); hut.add(hutLights);
  const lamp = new THREE.PointLight(0xffb46a, 3.2, 6, 1.6); lamp.position.set(0.35, 1.05, -1.62); hutLights.add(lamp);
  const lampShade = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.12, 16, 1, true), new THREE.MeshBasicMaterial({ color: 0xffd9a0, side: THREE.DoubleSide }));
  lampShade.position.set(0.35, 1.1, -1.62); hut.add(lampShade);
  const mon = new THREE.SpotLight(0x7fd8ff, 6, 5, 0.9, 0.6, 1.5); mon.position.set(-0.5, 1.02, -1.62); mon.target.position.set(-0.5, 1.2, 0.5); hutLights.add(mon, mon.target);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.35), new THREE.MeshBasicMaterial({ color: 0x4ab8e8 }));
  screen.position.set(-0.5, 1.12, -1.7); hut.add(screen);
  const alarm = new THREE.PointLight(0xff2a1a, 0, 7, 1.4); alarm.position.set(1.2, 2.1, -1.7); hutLights.add(alarm);
  const moon = new THREE.DirectionalLight(0x6f8cff, 0.35); moon.position.set(3, 2.2, 0.6); hutLights.add(moon);
  const holo = new THREE.PointLight(0x5ff0ff, 0, 5, 1.5); holo.position.set(1.3, 1.3, -0.5); hutLights.add(holo);
  const amb = new THREE.HemisphereLight(0x33405a, 0x1a1410, 0.25); hutLights.add(amb);
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(5, 2.6), new THREE.MeshStandardMaterial({ color: 0x3a3632, roughness: 0.9 }));
  wall.position.set(0, 1.3, -2.0); hut.add(wall);
  const deskTop = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.04, 0.75), new THREE.MeshStandardMaterial({ color: 0x5a4030, roughness: 0.6 }));
  deskTop.position.set(-0.5, 0.73, -1.625); hut.add(deskTop);
  const chairSeat = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.07, 0.46), new THREE.MeshStandardMaterial({ color: 0x2a2e36, roughness: 0.7 }));
  hut.add(chairSeat);
  const studio = [key, fill, rim, hemi];

  const face = (h, st, view) => {
    h.set(st);
    const e = h.getEye(new THREE.Vector3());
    const E = new THREE.Vector3(...h.head.L.eyeL).applyMatrix4(h.head.group.matrixWorld);
    if (view === 'front') { camera.position.set(e.x, e.y + 0.005, e.z + 0.7); camera.lookAt(e.x, e.y - 0.0, e.z); camera.fov = 22; }
    if (view === 'mouth') { camera.position.set(e.x, e.y - 0.045, e.z + 0.36); camera.lookAt(e.x, e.y - 0.058, e.z); camera.fov = 16; }
    if (view === 'eye') { camera.position.set(E.x + 0.02, E.y + 0.01, E.z + 0.25); camera.lookAt(E.x, E.y, E.z); camera.fov = 14; }
    if (view === '34') { camera.position.set(e.x + 0.4, e.y + 0.01, e.z + 0.56); camera.lookAt(e.x, e.y, e.z - 0.03); camera.fov = 22; }
    if (view === 'side') { camera.position.set(e.x + 0.7, e.y + 0.01, e.z - 0.03); camera.lookAt(e.x, e.y, e.z - 0.05); camera.fov = 24; }
    if (view === 'back') { camera.position.set(e.x - 0.45, e.y + 0.1, e.z - 0.6); camera.lookAt(e.x, e.y + 0.01, e.z - 0.05); camera.fov = 24; }
    camera.updateProjectionMatrix();
  };

  const POSES = [
    {}, // 0 stand
    { walk: { phase: 0, amount: 1, stride: 0.34 } }, // 1 walk (fraction = phase)
    { sit: 1, armL: { desk: 1 }, armR: { desk: 1 }, lean: 0.25 }, // 2
    { sit: 1, recline: 1, seatHeight: 0.42, armR: { overEyes: 1 } }, // 3
    { armR: { point: 1 }, pointAt: [0.8, 1.4, 2.0] }, // 4
    { armL: { gesture: 1 }, armR: { gesture: 0.6 } }, // 5
    { armR: { raise: 1 }, armL: { wave: 1 } }, // 6
    { armL: { pocket: 1 }, armR: { pocket: 1 } }, // 7
    { armR: { chin: 1 }, armL: { cross: 1 } }, // 8
    { armL: { shrug: 1 }, armR: { shrug: 1 } }, // 9
    { armL: { hips: 1 }, armR: { hips: 1 } }, // 10
    { armL: { cross: 1 }, armR: { cross: 1 } }, // 11
    { armR: { scratch: 1 }, armL: { beat: 1 } }, // 12
    { armL: { lean: 1 }, armR: { lean: 1 }, lean: 0.6 }, // 13
    { startle: 1 }, // 14
    { sit: 1, twist: 0.8, head: { yaw: 0.6 }, armL: { desk: 0.5 } }, // 15
    { armR: { reach: 1 }, reachAt: [0.3, 0.8, 0.5], lean: 0.3 }, // 16
    { sit: 0.5 }, // 17
  ];

  return {
    scene, camera,
    update(t) {
      const mode = Math.floor(t + 1e-6);
      const fr = t - mode;
      props.visible = false;
      if (mode >= 1100 && mode < 1200) {
        const who = mode < 1150 ? maya : sam;
        const other = who === maya ? sam : maya;
        other.set({ position: [5, 0, 5] });
        const i = (mode - 1100) % 50;
        const base = { t: 3.1 };
        if (i < 15) face(who, { ...base, visemes: { [VIS[i]]: 1 } }, 'mouth');
        else if (i === 20) face(who, base, 'front');
        else if (i === 21) face(who, base, '34');
        else if (i === 22) face(who, base, 'side');
        else if (i === 23) face(who, base, 'eye');
        else if (i === 24) face(who, { ...base, blink: fr }, 'eye');
        else if (i === 25) face(who, { ...base, mouth: { smile: 1 }, eyes: { squint: 0.2 } }, 'front');
        else if (i === 26) face(who, { ...base, mouth: { frown: 0.8 }, brows: { furrow: 1, sad: 0.2 } }, 'front');
        else if (i === 27) face(who, { ...base, brows: { raise: 1 }, eyes: { wide: 1 }, mouth: { jaw: 0.35 } }, 'front');
        else if (i === 28) face(who, { ...base, brows: { sad: 1 }, mouth: { frown: 0.4 } }, 'front');
        else if (i === 29) face(who, { ...base, lookAt: [0.4, 1.9, 1.0] }, 'front');
        else if (i === 30) face(who, { ...base, visemes: { aa: 1 } }, 'front');
        else if (i === 31) face(who, base, 'back');
        else face(who, base, 'front');
        return;
      }
      if (mode >= 1600 && mode < 1610) {
        // perf probes: 1600 none, 1601 maya, 1602 sam, 1603 both (medium shot), 1604 both CU maya
        const v = mode - 1600;
        const tA = performance.now();
        maya.set({ t: 2, position: [-0.35, 0, 0], lookAt: [0, 1.5, 2] });
        sam.set({ t: 2, position: [0.35, 0, 0], lookAt: [0, 1.5, 2] });
        window.__setMs = performance.now() - tA;
        if (window.__gpuLog && window.__gpuLog.length) console.warn('prev frame:', window.__gpuLog[0], 'last', window.__gpuLog[window.__gpuLog.length - 1], 'frame total', (window.__lastRenderEnd - window.__frameStart).toFixed(0));
        window.__frameStart = tA;
        window.__gpuLog = []; window.__gpuProbe = true;
        console.warn('set() both ms', window.__setMs.toFixed(1));
        maya.root.visible = v === 1 || v === 3 || v === 4 || v >= 5;
        sam.root.visible = v === 2 || v === 3 || v === 4;
        // component bisect on maya: 5 head only, 6 body only, 7 hair hidden, 8 head skin only
        maya.root.traverse(o => { if (o.isMesh) o.visible = true; });
        if (v === 5) maya.meshes.forEach(m => { m.visible = false; });
        if (v === 6) maya.head.group.visible = false; else maya.head.group.visible = true;
        if (v === 7) maya.hair.group.visible = false; else maya.hair.group.visible = true;
        if (v === 8) { maya.meshes.forEach(m => { m.visible = false; }); maya.head.group.traverse(o => { if (o.isMesh && o !== maya.head.skin) o.visible = false; }); }
        camera.position.set(0, 1.3, v === 4 ? 0.9 : 2.8); camera.lookAt(v === 4 ? -0.35 : 0, v === 4 ? 1.5 : 1.15, 0); camera.fov = 30;
        camera.updateProjectionMatrix();
        return;
      }
      window.__gpuProbe = false;
      const inHut = mode >= 1800 && mode < 1900;
      hut.visible = inHut; for (const l of studio) l.visible = !inHut;
      scene.background.set(inHut ? 0x0b0c10 : 0x2a2d33);
      if (inHut) {
        const v = mode - 1800;
        const samSt = { t: 20 + fr, position: [-0.5, 0, -0.85], yaw: Math.PI, sit: 1, seatHeight: 0.47, armL: { desk: 0.6 }, armR: { desk: 1 }, lean: 0.15, lookAt: [-0.5, 1.12, -1.7] };
        const mayaSt = { t: 20 + fr, position: [-0.05, 0, -0.42], yaw: Math.PI, lean: 0.2, lookAt: [-0.5, 1.12, -1.7], armL: { lean: 0.0 } };
        chairSeat.position.set(-0.5, 0.435, -0.85 - 0.1);
        alarm.intensity = (v === 3 || v === 7) ? 9 * (0.5 + 0.5 * Math.cos(fr * 6.28)) : 0;
        holo.intensity = (v === 4 || v === 8) ? 7 : 0;
        lamp.intensity = v === 6 ? 0 : 3.2;
        const e = new THREE.Vector3();
        // 0 sam MCU from the monitor side; 1 maya CU; 2 two-shot; 3 alarm on sam; 4 hologram on maya; 5 maya profile moonlight; 6 no lamp
        if (v === 0 || v === 3) {
          sam.set({ ...samSt, twist: v === 3 ? 0.7 : 0, head: { yaw: v === 3 ? 0.7 : 0 }, lookAt: v === 3 ? [-1.85, 1.0, 0.95] : samSt.lookAt, visemes: { E: 0.6 }, brows: { raise: v === 3 ? 0.6 : 0 } });
          maya.set({ position: [6, 0, 6] });
          sam.getEye(e);
          camera.position.set(e.x + 0.15, e.y - 0.05, e.z - 0.75); camera.lookAt(e.x, e.y - 0.12, e.z); camera.fov = 30;
        } else if (v === 1 || v === 4 || v === 6) {
          maya.set({ ...mayaSt, visemes: { aa: 0.3 }, brows: { raise: 0.4 }, eyes: { wide: 0.2 } });
          sam.set({ ...samSt });
          maya.getEye(e);
          camera.position.set(e.x - 0.12, e.y - 0.02, e.z - 0.5); camera.lookAt(e.x, e.y - 0.04, e.z); camera.fov = 26;
        } else if (v === 2 || v === 7 || v === 8) {
          sam.set({ ...samSt, twist: 0.5, head: { yaw: 0.4 }, lookAt: [0.3, 1.5, -0.3], armR: { point: 1 }, pointAt: [-0.5, 1.12, -1.7] });
          maya.set({ ...mayaSt, lookAt: [-0.5, 1.12, -1.7], armL: { chin: 1 } });
          camera.position.set(-0.3, 1.35, -1.45); camera.lookAt(-0.25, 1.25, -0.5); camera.fov = 38;
        } else if (v === 5) {
          maya.set({ position: [1.9, 0, 0.3], yaw: Math.PI * 0.5, lookAt: [3, 1.8, 0.3], mouth: { smile: 0.35 } });
          sam.set({ position: [6, 0, 6] });
          maya.getEye(e);
          lamp.intensity = 0.4;
          camera.position.set(e.x - 0.05, e.y - 0.02, e.z + 0.55); camera.lookAt(e.x, e.y - 0.03, e.z); camera.fov = 28;
        }
        camera.updateProjectionMatrix();
        return;
      }
      maya.root.traverse(o => { if (o.isMesh) o.visible = true; });
      maya.head.group.visible = true; maya.hair.group.visible = true;
      maya.root.visible = sam.root.visible = true;
      if (mode >= 1900 && mode < 1920) {
        // motion strips, with past(dt) for follow-through; fr = fraction through the clip
        const v = mode - 1900;
        const T = 2.0;
        const tt = fr * T;
        const stride = 0.36;
        const bump = (t, a, w) => { const x = (t - a) / w; return x < 0 ? 0 : Math.exp(1 - x) * x; };
        const st = {
          0: t => ({ t: 10 + t, walk: { phase: t / 1.2, amount: 1, stride }, position: [0, 0, (t / 1.2) * 2 * stride], energy: 0.6 }),
          1: t => ({ t: 10 + t, walk: { phase: t / 1.1, amount: 1, stride: 0.4 }, position: [0, 0, (t / 1.1) * 2 * 0.4], energy: 0.7 }),
          2: t => ({ t: 10 + t, armR: { gesture: 1 }, armL: { beat: 0.7 }, gesturePhase: t * 0.9, visemes: { aa: 0.5 + 0.5 * Math.sin(t * 9), E: 0.5 - 0.5 * Math.sin(t * 9) }, head: { yaw: 0.15 * Math.sin(t * 2) }, nod: 0.4, energy: 0.8 }),
          3: t => ({ t: 10 + t, startle: Math.min(1, 1.2 * bump(t, 0.4, 0.12)), energy: 0.9 }),
          4: t => ({ t: 10 + t, head: { yaw: t < 0.5 ? 0 : 0.9 * Math.min(1, (t - 0.5) / 0.18), pitch: 0 }, energy: 0.5 }),
          5: t => ({ t: 10 + t, walk: { phase: t / 1.1, amount: 1, stride: 0.4 }, position: [0, 0, (t / 1.1) * 2 * 0.4], energy: 0.7 }),
          6: t => ({ t: 10 + t, walk: { phase: t / 1.2, amount: 1, stride }, position: [0, 0, (t / 1.2) * 2 * stride], energy: 0.6 }),
        }[v];
        const who = [maya, sam, maya, sam, maya, sam, maya][v];
        const other = who === maya ? sam : maya;
        other.set({ position: [6, 0, 6] });
        const s0 = st(tt);
        s0.past = dt => st(tt - dt);
        who.set(s0);
        const e = who.getEye(new THREE.Vector3());
        if (v === 0 || v === 1) { camera.position.set(3.2, 1.0, e.z); camera.lookAt(0, 0.9, e.z); camera.fov = 34; }
        if (v === 5 || v === 6) { camera.position.set(0.4, 1.1, e.z + 3.2); camera.lookAt(0, 0.9, e.z); camera.fov = 34; }
        if (v === 2) { camera.position.set(0.2, e.y - 0.3, e.z + 2.0); camera.lookAt(0, e.y - 0.35, e.z); camera.fov = 30; }
        if (v === 3) { camera.position.set(0.6, e.y - 0.2, e.z + 2.0); camera.lookAt(0, e.y - 0.3, e.z); camera.fov = 30; }
        if (v === 4) { camera.position.set(-0.8, e.y + 0.1, e.z - 0.6); camera.lookAt(0, e.y, e.z); camera.fov = 30; }
        camera.updateProjectionMatrix();
        return;
      }
      if (mode >= 1700 && mode < 1720) {
        // close views of the upper bodies: 1700 sam 3/4, 1701 sam back, 1702 maya 3/4, 1703 maya back, 1704 hands close
        const v = mode - 1700;
        const who = v < 2 ? sam : maya, other = who === sam ? maya : sam;
        other.set({ position: [5, 0, 5] });
        who.set({ t: 2 + fr });
        const e = who.getEye(new THREE.Vector3());
        if (v === 0 || v === 2) { camera.position.set(0.55, e.y - 0.15, 0.95); camera.lookAt(0, e.y - 0.25, 0); }
        if (v === 1 || v === 3) { camera.position.set(-0.5, e.y, -1.0); camera.lookAt(0, e.y - 0.2, 0); }
        if (v === 5 || v === 6) { const w2 = v === 5 ? maya : sam; w2.set({ t: 2 }); (w2 === maya ? sam : maya).set({ position: [5, 0, 5] }); const e2 = w2.getEye(new THREE.Vector3()); camera.position.set(0.0, e2.y - 0.1, 1.0); camera.lookAt(0, e2.y - 0.22, 0); }
        if (v === 7 || v === 8) { const w2 = v === 7 ? maya : sam; w2.set({ t: 2, armL: { raise: 1 }, armR: { point: 1 }, pointAt: [2, 1.2, 0.5] }); (w2 === maya ? sam : maya).set({ position: [5, 0, 5] }); const e2 = w2.getEye(new THREE.Vector3()); camera.position.set(0.0, e2.y - 0.1, 1.3); camera.lookAt(0, e2.y - 0.15, 0); }
        if (v === 4) { who.set({ t: 2, armL: { gesture: 1 }, armR: { point: 1 }, pointAt: [0.5, 1.6, 2], gesturePhase: 0.2 }); camera.position.set(0.1, e.y - 0.35, 0.9); camera.lookAt(0.05, e.y - 0.4, 0.2); }
        camera.fov = 30; camera.updateProjectionMatrix();
        return;
      }
      if (mode >= 1500 && mode < 1550) {
        const i = mode - 1500;
        const st = JSON.parse(JSON.stringify(POSES[i] || {}));
        if (st.walk) st.walk.phase = fr;
        st.gesturePhase = fr; st.t = 2 + fr * 2;
        const sh = st.seatHeight ?? 0.47;
        maya.set({ ...st, position: [-0.45, 0, 0] });
        sam.set({ ...st, position: [0.45, 0, 0] });
        props.visible = !!st.sit || i === 13;
        desk.visible = i === 2 || i === 13 || i === 15;
        desk.position.set(0, 0.73, 0.75);
        seatA.position.set(-0.45, sh - 0.03, -0.2); seatB.position.set(0.45, sh - 0.03, -0.2);
        seatA.visible = seatB.visible = !!st.sit;
        let view = i === 1 ? 'side' : (i === 2 || i === 3 || i === 15) ? '34' : 'front';
        if (fr > 0.9) view = 'upper';
        if (view === 'upper') { camera.position.set(0.2, 1.25, 2.6); camera.lookAt(0, 1.2, 0); camera.fov = 30; }
        if (view === 'front') { camera.position.set(0.3, 1.2, 4.2); camera.lookAt(0, 0.95, 0); camera.fov = 30; }
        if (view === 'side') { camera.position.set(3.8, 1.0, 0.6); camera.lookAt(0, 0.9, 0); camera.fov = 30; }
        if (view === '34') { camera.position.set(2.4, 1.6, 3.0); camera.lookAt(0, 0.8, 0.2); camera.fov = 30; }
        camera.updateProjectionMatrix();
      }
    },
    bloom: () => ({ strength: 0.15, radius: 0.3, threshold: 0.9 }),
  };
}
