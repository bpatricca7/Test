// Test bench for lib/visitor.js: renders the Visitor in a dark hut-like room.
// t selects the test (see PLAN below). Render with
//   node movie/characters/render.js --stills 0,1,2 --only test_visitor --out vis_
import { createVisitor } from '../lib/visitor.js';

export async function create(env) {
  const { THREE, U } = env;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x020306);
  const camera = new THREE.PerspectiveCamera(35, 16 / 9, 0.03, 100);

  // ---- a dark room with the monitor and window where API.md puts them ----
  const std = (c, r = 0.85) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: 0 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(5, 4), std(0x2a2520));
  floor.rotation.x = -Math.PI / 2; scene.add(floor);
  const wallM = std(0x3a342e);
  const back = new THREE.Mesh(new THREE.PlaneGeometry(5, 2.6), wallM); back.position.set(0, 1.3, -2); scene.add(back);
  const left = new THREE.Mesh(new THREE.PlaneGeometry(4, 2.6), wallM); left.position.set(-2.5, 1.3, 0); left.rotation.y = Math.PI / 2; scene.add(left);
  // right wall with a window hole (four pieces)
  const rw = (w, h, y, z) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), wallM); m.position.set(2.5, y, z); m.rotation.y = -Math.PI / 2; scene.add(m); };
  rw(4, 0.95, 0.475, 0); rw(4, 0.75, 2.225, 0); rw(1.45, 0.9, 1.4, -1.275); rw(1.15, 0.9, 1.4, 1.425);
  const sky = document.createElement('canvas'); sky.width = 256; sky.height = 256;
  { const x = sky.getContext('2d'); const gr = x.createLinearGradient(0, 0, 0, 256); gr.addColorStop(0, '#050a1c'); gr.addColorStop(1, '#101c34'); x.fillStyle = gr; x.fillRect(0, 0, 256, 256);
    const r = U.mulberry32(5); for (let i = 0; i < 140; i++) { x.fillStyle = `rgba(255,255,255,${0.3 + r() * 0.7})`; x.fillRect(r() * 256, r() * 200, 1.2, 1.2); } }
  const skyTex = new THREE.CanvasTexture(sky); skyTex.colorSpace = THREE.SRGBColorSpace;
  const win = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.9), new THREE.MeshBasicMaterial({ map: skyTex }));
  win.position.set(2.7, 1.4, 0.3); win.rotation.y = -Math.PI / 2; scene.add(win);
  const desk = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.05, 0.75), std(0x4a3524)); desk.position.set(-0.5, 0.725, -1.625); scene.add(desk);
  const deskLeg = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.7, 0.05), std(0x2a2018)); deskLeg.position.set(-0.5, 0.35, -1.95); scene.add(deskLeg);
  const mon = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.42, 0.05), std(0x151515, 0.5)); mon.position.set(-0.5, 1.12, -1.73); scene.add(mon);
  const stand = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.3, 0.06), std(0x151515, 0.5)); stand.position.set(-0.5, 0.9, -1.78); scene.add(stand);
  const scrMat = new THREE.MeshBasicMaterial({ color: 0x1b5a6a });
  const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.35), scrMat); scr.position.set(-0.5, 1.12, -1.704); scene.add(scr);
  const rack = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.8, 0.5), std(0x202226, 0.6)); rack.position.set(1.2, 0.9, -1.75); scene.add(rack);
  scene.add(new THREE.AmbientLight(0x30405a, 0.35));
  const lamp = new THREE.PointLight(0xffa860, 2.2, 8, 2); lamp.position.set(0.35, 1.2, -1.5); scene.add(lamp);
  const monL = new THREE.PointLight(0x60c0e0, 0.8, 4, 2); monL.position.set(-0.5, 1.12, -1.4); scene.add(monL);
  const moon = new THREE.DirectionalLight(0x8090c0, 0.25); moon.position.set(3, 2, 1); scene.add(moon);

  const v = await createVisitor(env);
  scene.add(v.root);
  scene.add(v.light);

  const MARK = { pos: [1.3, 0, -0.5], yaw: -Math.PI * 0.42 };
  const SCREEN = { center: [-0.5, 1.12, -1.70], width: 0.62, height: 0.35 };
  const WINDOW = [2.5, 1.4, 0.3];
  const VIS = ['sil', 'PP', 'FF', 'TH', 'DD', 'kk', 'CH', 'SS', 'nn', 'RR', 'aa', 'E', 'I', 'O', 'U'];
  const f = new THREE.Vector3(Math.sin(MARK.yaw), 0, Math.cos(MARK.yaw));
  const right = new THREE.Vector3(f.z, 0, -f.x);   // camera-right when looking at its face
  const eye = new THREE.Vector3(), head = new THREE.Vector3();

  function faceCam(dist, side, up, fov, lookFrom) {
    v.getEye(eye);
    camera.position.copy(eye).addScaledVector(f, dist).addScaledVector(right, side).add(new THREE.Vector3(0, up, 0));
    camera.lookAt(eye.x + right.x * side * 0.2, eye.y - 0.02, eye.z + right.z * side * 0.2);
    camera.fov = fov;
  }
  function orbit(ang, dist, h, ty, fov) {
    const c = new THREE.Vector3(MARK.pos[0], 0, MARK.pos[2]);
    const d = new THREE.Vector3(Math.sin(MARK.yaw + ang), 0, Math.cos(MARK.yaw + ang));
    camera.position.copy(c).addScaledVector(d, dist).setY(h);
    camera.lookAt(c.x, ty, c.z);
    camera.fov = fov;
  }
  const visOne = k => Object.fromEntries(VIS.map(x => [x, x === k ? 1 : 0]));
  // a fake talk loop: "We heard you."
  const TALK = ['U', 'E', 'sil', 'aa', 'RR', 'DD', 'sil', 'I', 'U', 'U', 'sil', 'PP', 'O', 'SS', 'E', 'FF', 'aa', 'sil'];
  function talkVis(t) {
    const r = t * 7.5, i = Math.floor(r), a = r - i;
    const w = Object.fromEntries(VIS.map(x => [x, 0]));
    const k0 = TALK[i % TALK.length], k1 = TALK[(i + 1) % TALK.length];
    const s = a < 0.6 ? 0 : (a - 0.6) / 0.4;
    w[k0] += 1 - s; w[k1] += s;
    return w;
  }

  function stateAt(t) {
    const s = { t, position: MARK.pos.slice(), yaw: MARK.yaw, materializeFrom: SCREEN, dissolveTo: WINDOW, flicker: 0.1, blink: 0 };
    let label = '';
    if (t < 9) {                                   // turntable
      const u = t / 8;
      s.yaw = MARK.yaw + u * Math.PI * 2;
      orbit(0, 2.9, 1.2, 1.06, 43);
      s.lookAt = [MARK.pos[0] + Math.sin(s.yaw) * 3, 1.85, MARK.pos[2] + Math.cos(s.yaw) * 3];
      s.headFollow = 0.5;
      label = 'turntable';
    } else if (t < 25) {                           // visemes, 1 s each
      const k = Math.min(14, Math.floor(t - 10));
      s.visemes = visOne(VIS[k]);
      s.glow = 0.5;
      s.headFollow = 0.5;
      faceCam(0.62, 0.12, -0.01, 28);
      s.lookAt = camera.position.toArray();
      label = 'viseme ' + VIS[k];
    } else if (t < 27) {                           // blink
      s.blink = U.clamp((t - 25) / 1.0);
      faceCam(0.62, 0.12, -0.01, 28);
      s.lookAt = camera.position.toArray();
      label = 'blink';
    } else if (t < 30) {                           // raise hand
      s.raiseHand = U.clamp((t - 27) / 2);
      orbit(0.35, 2.8, 1.35, 1.3, 40);
      s.lookAt = camera.position.toArray();
      s.past = dt => ({ t: t - dt, position: MARK.pos, yaw: MARK.yaw, raiseHand: U.clamp((t - dt - 27) / 2) });
      label = 'raise';
    } else if (t < 40) {                           // materialize (wide from the room)
      s.materialize = U.clamp((t - 30) / 8);
      s.flicker = 0.12 + 0.6 * (1 - s.materialize);
      camera.position.set(-1.6, 1.45, 1.5); camera.lookAt(0.3, 1.0, -0.8); camera.fov = 52;
      s.lookAt = [-1.1, 1.6, 0.15];
      label = 'materialize';
    } else if (t < 50) {                           // dissolve (wide)
      s.dissolve = U.clamp((t - 40) / 8);
      s.raiseHand = 1;
      s.flicker = 0.12 + 0.4 * s.dissolve;
      camera.position.set(-1.7, 1.45, -0.95); camera.lookAt(1.7, 1.25, -0.2); camera.fov = 52;
      s.lookAt = [-0.2, 1.55, -0.1];
      label = 'dissolve';
    } else if (t < 55) {                           // gait
      const u = (t - 50) / 4;
      const a = MARK.pos, dir = f.clone();
      const stride = 0.12;
      s.walk = { phase: u * 1.5 - 1 / 6, amount: U.smooth(0, 0.1, u) * (1 - U.smooth(0.9, 1, u)), stride };
      const dist = 3 * stride * (u * 1.5);
      s.position = [a[0] + dir.x * (dist - 0.3), 0, a[2] + dir.z * (dist - 0.3)];
      orbit(Math.PI / 2 + 0.25, 3.4, 1.2, 1.0, 40);
      const gp = (tt) => { const uu = (tt - 50) / 4; const dd = 3 * stride * (uu * 1.5); return { t: tt, position: [a[0] + dir.x * (dd - 0.3), 0, a[2] + dir.z * (dd - 0.3)], yaw: MARK.yaw, walk: { phase: uu * 1.5 - 1 / 6, amount: U.smooth(0, 0.1, uu) * (1 - U.smooth(0.9, 1, uu)), stride } }; };
      s.past = dt => gp(t - dt);
      s.lookAt = camera.position.toArray();
      label = 'gait';
    } else if (t < 60) {                           // crouch
      const cr = tt => U.smooth(55.3, 57.5, tt);
      s.crouch = cr(t); s.lean = 0.3 * s.crouch;
      s.past = dt => ({ t: t - dt, position: MARK.pos, yaw: MARK.yaw, crouch: cr(t - dt), lean: 0.3 * cr(t - dt) });
      orbit(Math.PI / 2 - 0.3, 3.0, 1.3, 1.1, 40);
      s.lookAt = [MARK.pos[0] + f.x * 1.2, 1.6, MARK.pos[2] + f.z * 1.2];
      label = 'crouch';
    } else if (t < 65) {                           // gesture
      const gw = tt => U.window01(tt, 60.2, 64.8, 0.8, 0.8);
      s.gesture = gw(t); s.gesturePhase = t * 0.9;
      s.past = dt => ({ t: t - dt, position: MARK.pos, yaw: MARK.yaw, gesture: gw(t - dt), gesturePhase: (t - dt) * 0.9 });
      orbit(0.5, 2.6, 1.4, 1.25, 40);
      s.lookAt = camera.position.toArray();
      label = 'gesture';
    } else if (t < 70) {                           // talk loop
      s.visemes = talkVis(t);
      s.glow = 0.3 + 0.5 * Math.abs(Math.sin(t * 5.3));
      faceCam(0.75, -0.14, -0.03, 29);
      s.lookAt = camera.position.toArray();
      s.head = { pitch: 0.04 * Math.sin(t * 2.3), yaw: 0.05 * Math.sin(t * 1.7), roll: 0 };
      label = 'talk';
    } else if (t < 72) {                           // hero portrait
      s.visemes = visOne('sil');
      s.tilt = 0.12;
      s.glow = 0.2;
      faceCam(0.9, 0.3, 0.02, 30);
      s.lookAt = camera.position.clone().add(new THREE.Vector3(0, 0.02, 0)).toArray();
      s.headFollow = 0.7;
      label = 'portrait';
    } else if (t < 80) {                           // reach + flicker
      s.reach = U.smooth(72, 74, t); s.reachAt = [MARK.pos[0] + f.x * 0.55 - right.x * 0.3, 1.25, MARK.pos[2] + f.z * 0.55 - right.z * 0.3];
      s.flicker = t > 76 ? 0.9 : 0.1;
      orbit(0.4, 2.8, 1.3, 1.1, 40);
      s.lookAt = s.reachAt;
      label = 'reach/flicker';
    } else if (t >= 90 && t < 95) {                // torso / chest detail
      v.getEye(eye);
      camera.position.set(MARK.pos[0], 1.3, MARK.pos[2]).addScaledVector(f, 1.0).addScaledVector(right, 0.25 * Math.sin(t));
      camera.lookAt(MARK.pos[0], 1.28, MARK.pos[2]);
      camera.fov = 38;
      s.glow = t > 92 ? 0.8 : 0;
      s.lookAt = camera.position.toArray();
      label = 'torso';
    } else if (t >= 95 && t < 100) {               // raised hand close-up
      s.raiseHand = 1;
      s.past = dt => ({ t: t - dt, position: MARK.pos, yaw: MARK.yaw, raiseHand: 1 });
      v.set(s);
      const hp = new THREE.Vector3(); v.getEye(hp);
      camera.position.set(MARK.pos[0], hp.y - 0.05, MARK.pos[2]).addScaledVector(f, 0.9).addScaledVector(right, -0.35);
      camera.lookAt(hp.x - right.x * 0.38, hp.y - 0.02, hp.z - right.z * 0.38);
      camera.fov = 30;
      s.lookAt = camera.position.toArray();
      label = 'hand';
    } else {                                       // side profile close-up
      faceCam(0.0, 0.0, 0.0, 30);
      v.getHead(head);
      camera.position.copy(head).addScaledVector(right, t < 85 ? -0.9 : 0.9).add(new THREE.Vector3(0, 0.05, 0));
      camera.lookAt(head.x, head.y - 0.05, head.z);
      s.lookAt = [MARK.pos[0] + f.x * 2, 1.8, MARK.pos[2] + f.z * 2];
      label = 'profile';
    }
    return { s, label };
  }

  function update(t) {
    // t >= 1000: same as t - 1000 with the Visitor hidden (for timing the rest of the frame)
    // t >= 1000: timing modes (1: hidden, 2: no colour pass, 3: no depth pass, 4: no eyes, 5: no bones)
    const mode = Math.floor(t / 1000);
    const hide = mode === 1;
    t -= mode * 1000;
    const a = performance.now();
    // two passes, like the director: the first positions the head for the camera
    let r = stateAt(t);
    v.set(r.s);
    r = stateAt(t);
    v.set(r.s);
    v.prepare();
    window.__visMs = performance.now() - a;
    v.root.visible = !hide;
    if (v._parts && mode >= 2) {
      const P = v._parts;
      if (mode === 2) P.mColor.visible = false;
      if (mode === 3) P.mDepth.visible = false;
      if (mode === 4) for (const e of P.eyes) { e[0].visible = false; e[1].visible = false; }
      if (mode === 5) P.mBones.visible = false;
    }
    camera.updateProjectionMatrix();
    scrMat.color.setRGB(0.1, 0.35, 0.42).multiplyScalar(1 - 0.7 * U.window01(t, 30, 40, 0.2, 0.5));
  }
  return { scene, camera, update, bloom: () => ({ strength: 0.8, radius: 0.45, threshold: 0.7 }) };
}
