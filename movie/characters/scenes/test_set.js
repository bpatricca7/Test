// Test harness for lib/set.js: `render.js --only test_set --stills 0,1,2,...`
// Each integer t picks a camera view (and the film time it shows). Capsule
// stand-ins sit at the character marks to check scale.

import { createSet } from '../lib/set.js';

export async function create(env) {
  const { THREE, TL, U } = env;
  const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
  const MK = TL.marks, B = TL.beats;
  const t0 = performance.now();
  const set = await createSet(env);
  const buildMs = performance.now() - t0;
  console.warn(`test_set: createSet ${buildMs.toFixed(0)} ms`);

  const interior = new THREE.Scene();
  interior.background = new THREE.Color(0, 0, 0);
  interior.add(set.interior.root);
  const exterior = new THREE.Scene();
  exterior.background = new THREE.Color(0, 0, 0);
  exterior.add(set.exterior.root);

  // stand-ins: capsules at the marks
  const skin = new THREE.MeshStandardMaterial({ color: 0x8a5a40, roughness: 0.6 });
  const cloth = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.85 });
  function person(h, col, sit, seatH = 0.47, recline = 0) {
    const g = new THREE.Group();
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, h * 0.26, 4, 12), cloth(col));
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.105, 20, 14), skin);
    const legs = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, h * 0.36, 4, 12), cloth(0x2d3440));
    g.add(torso, head, legs);
    torso.castShadow = head.castShadow = legs.castShadow = true;
    if (!sit) {
      legs.position.y = h * 0.25; torso.position.y = h * 0.62; head.position.y = h - 0.11;
    } else {
      legs.rotation.x = -Math.PI / 2; legs.position.set(0, seatH + 0.05, 0.02);
      torso.position.set(0, seatH + h * 0.2, -0.3 - recline * 0.12); torso.rotation.x = -0.15 - recline * 0.45;
      head.position.set(0, seatH + h * 0.4 - recline * 0.08, -0.3 - recline * 0.34);
    }
    return g;
  }
  const sam = person(1.8, 0xc9a13a, true, 0.47);
  sam.position.set(...MK.sam_chair.pos); sam.rotation.y = MK.sam_chair.yaw;
  const maya = person(1.66, 0x4d6b3c, true, 0.42, 1);
  maya.position.set(...MK.maya_armchair.pos); maya.rotation.y = MK.maya_armchair.yaw;
  const mayaStand = person(1.66, 0x4d6b3c, false);
  const vis = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 1.6, 4, 16), new THREE.MeshBasicMaterial({ color: 0x6fe6ff, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }));
  vis.position.set(MK.visitor.pos[0], 1.05, MK.visitor.pos[2]);
  interior.add(sam, maya, mayaStand, vis);

  const camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.03, 4000);
  const out = { scene: interior, camera, update, bloom };
  const scr = set.anchors.screen.center;
  const A = set.exterior.anchors;

  // views: [film time, scene, camera position, target, fov, (who stands where)]
  const ext = (t, P, T, fov) => ({ t, ext: true, P, T, fov });
  const VIEWS = [
    { t: 16.0, P: [2.15, 1.72, 1.75], T: [-0.95, 0.95, -0.55], fov: 52 },                                 // 0 int_wide
    { t: 42.6, P: [scr[0], scr[1], scr[2] + 0.48], T: scr, fov: 40, hide: true },                         // 1 screen insert: pulses
    { t: 51.6, P: [scr[0], scr[1], scr[2] + 0.42], T: scr, fov: 40, hide: true },                         // 2 fold insert
    { t: 65.9, P: [scr[0], scr[1], scr[2] + 0.46], T: scr, fov: 40, hide: true },                         // 3 zoom to the visitor
    { t: 36.0, P: [0.5, 1.55, 0.42], T: [scr[0] + 0.05, scr[1] + 0.02, scr[2]], fov: 38, maya: 'maya_desk' }, // 4 screen_ots
    { t: 106.5, P: [0.7, 1.5, 1.2], T: [2.5, 1.55, 0.05], fov: 45, maya: 'maya_window' },               // 5 window view
    { t: 67.3, P: [-1.9, 1.5, 1.5], T: [0.2, 1.15, -0.75], fov: 48 },                                    // 6 surge
    { t: 85.0, P: [-1.85, 1.45, -0.9], T: [1.5, 1.3, -0.2], fov: 50, maya: 'maya_forward' },             // 7 hologram fill
    { t: 8.0, ext: true, shot: 'ext_push', u: 0.0 },                                                      // 8 ext push start
    { t: 13.5, ext: true, shot: 'ext_push', u: 0.8 },                                                     // 9 ext push, near the end (alarm)
    { t: 110.5, ext: true, shot: 'ext_dish', u: 0.3 },                                                    // 10 ext dish turn
    { t: 22.0, P: [-1.2, 1.2, 0.2], T: [-1.9, 0.75, 1.1], fov: 34 },                                     // 11 armchair CU
    { t: 64.0, P: [0.1, 1.28, -1.3], T: [-0.35, 1.18, -0.55], fov: 44, maya: 'maya_desk' },              // 12 two_shot (front wall behind)
    { t: 107.0, P: [1.55, 1.52, 0.95], T: [2.6, 1.55, 0.1], fov: 36, maya: 'maya_window' },              // 13 maya at the window
    { t: 45.5, P: [-0.35, 1.35, -1.25], T: [0.0, 1.35, 1.5], fov: 42, maya: 'maya_desk' },               // 14 reverse: front wall
    { t: 75.0, P: [0.45, 1.75, -0.2], T: [1.6, 1.6, -0.75], fov: 34, maya: 'maya_forward' },             // 15 visitor CU background
    { t: 99.8, P: [2.1, 1.6, 1.7], T: [-0.6, 1.0, -1.0], fov: 55 },                                      // 16 lights return, wide
    { t: 112.9, ext: true, shot: 'ext_dish', u: 1.0 },                                                    // 17 ext dish end
    ext(14.9, null, null, 40),                                                                            // 18 director's current ext_push formula, u = 1
    { t: 104.0, P: [2.05, 1.58, 0.45], T: [3.5, 1.75, 0.55], fov: 50 },                                   // 19 through the window, Maya's eyeline
    { t: 20.0, P: [-0.9, 1.25, 0.55], T: [-1.95, 0.6, 1.2], fov: 40, hide: true },                       // 20 armchair, empty, 3/4
    { t: 36.0, P: [-0.45, 1.3, -0.95], T: [-0.3, 0.9, -1.75], fov: 50, hide: true },                     // 21 desk close, from Sam's seat
    { t: 16.0, P: [0.6, 1.5, -0.6], T: [1.25, 1.6, -1.7], fov: 45, hide: true },                         // 22 rack + beacon + kitchenette
    { t: 30.0, P: [0.3, 1.45, -0.3], T: [1.0, 1.2, 1.95], fov: 50, hide: true },                         // 23 front wall: door, printer, whiteboard
    { t: 24.0, P: [-1.2, 1.25, 0.0], T: [-2.4, 1.2, -1.0], fov: 45, hide: true },                        // 24 bookshelf + back-left corner
    { t: 16.0, P: [-0.55, 1.2, -1.2], T: [-0.5, 1.12, -1.7], fov: 55, hide: true },                     // 25 main monitor, bezel and glass
  ];

  function update(t) {
    const vi = Math.max(0, Math.min(VIEWS.length - 1, Math.floor(t)));
    const v = VIEWS[vi];
    const ft = v.t + (t - vi);          // fractional part = seconds after the view's film time
    set.update(ft, {});
    const hide = !!v.hide;
    sam.visible = maya.visible = !hide && ft < B.sam_backs_off.start;
    maya.visible = !hide && ft < B.maya_stands.start;
    mayaStand.visible = !hide && !!v.maya;
    if (v.maya) { mayaStand.position.set(...MK[v.maya].pos); mayaStand.rotation.y = MK[v.maya].yaw; }
    const holo = U.smooth(B.materialize.start, B.materialize.end, ft) * (1 - U.smooth(B.dematerialize.start, B.dematerialize.end, ft));
    vis.visible = holo > 0.01 && !hide;
    vis.material.opacity = 0.35 * holo;
    if (v.ext) {
      out.scene = exterior;
      let P = v.P, T = v.T;
      if (v.shot) {
        const S = A.shots[v.shot], e = U.easeInOut(v.u + (t - vi) * 0.1);
        P = new THREE.Vector3(...S.from).lerp(new THREE.Vector3(...S.to), e).toArray();
        T = new THREE.Vector3(...S.lookFrom).lerp(new THREE.Vector3(...S.lookTo), e).toArray();
      }
      if (vi === 18) { // the director's push formula at u = 1
        const w = new THREE.Vector3(...A.hutWindow), from = new THREE.Vector3(...A.pushFrom);
        P = from.clone().lerp(w.clone().add(V3(6, 1.2, 6)), 0.8).toArray(); T = A.hutWindow;
      }
      if (false) {
        const d = new THREE.Vector3(...A.dish), u = vi === 10 ? 0.86 : 1;
        P = d.clone().add(V3(U.lerp(34, 30, u), U.lerp(4, 14, U.easeInOut(u)), U.lerp(22, 18, u))).toArray();
        T = d.clone().add(V3(0, U.lerp(2, 12, U.easeInOut(u)), 0)).toArray();
      }
      camera.position.set(...P); camera.lookAt(...T);
    } else {
      out.scene = interior;
      camera.position.set(...v.P); camera.lookAt(...v.T);
    }
    camera.fov = v.fov || (v.shot ? A.shots[v.shot].fov : 40);
    camera.updateProjectionMatrix();
  }
  function bloom(t) {
    const v = VIEWS[Math.max(0, Math.min(VIEWS.length - 1, Math.floor(t)))];
    const ft = v.t + (t - Math.floor(t));
    const holo = U.smooth(B.materialize.start, B.materialize.end, ft) * (1 - U.smooth(B.dematerialize.start, B.dematerialize.end, ft));
    return { strength: 0.45 + 0.35 * holo, radius: 0.45, threshold: 0.78 - 0.1 * holo };
  }
  window.__T = { set, interior, exterior, camera, renderer: env.renderer, THREE, update, out };
  return out;
}
