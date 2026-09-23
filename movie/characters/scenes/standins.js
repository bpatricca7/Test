// Grey-box stand-ins with the same API as lib/human.js, lib/visitor.js and
// lib/set.js, so shots can be blocked before the real pieces exist.

function lambert(THREE, color, emissive = 0x000000) {
  return new THREE.MeshStandardMaterial({ color, emissive, roughness: 0.8 });
}

export function createStandInHuman({ THREE }, id) {
  const tall = id === 'sam' ? 1.8 : 1.66;
  const root = new THREE.Group();
  const hips = new THREE.Group(); root.add(hips);
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, tall * 0.28, 4, 12), lambert(THREE, id === 'sam' ? 0xc9a13a : 0x4d6b3c));
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.11, 24, 16), lambert(THREE, 0x6b4630));
  const legs = new THREE.Mesh(new THREE.CapsuleGeometry(0.12, tall * 0.4, 4, 12), lambert(THREE, 0x2d3440));
  hips.add(torso, head, legs);
  const eye = new THREE.Object3D(); head.add(eye); eye.position.set(0, 0.02, 0.1);
  const heights = { standEye: tall - 0.11, sitEye: tall - 0.11 - 0.42 };
  return {
    root, heights,
    set(s) {
      root.position.fromArray(s.position || [0, 0, 0]);
      root.rotation.y = s.yaw || 0;
      const sit = s.sit || 0, rec = s.recline || 0;
      const legH = tall * 0.47;
      legs.position.set(0, legH / 2 * (1 - sit) + (s.seatHeight || 0.47) * 0.5 * sit, 0.2 * sit);
      legs.rotation.x = -Math.PI / 2 * sit;
      const hipY = legH * (1 - sit) + (s.seatHeight || 0.47) * sit;
      torso.position.set(0, hipY + tall * 0.2, -0.1 * sit);
      torso.rotation.x = 0.4 * (s.lean || 0) - 0.5 * rec;
      head.position.set(0, hipY + tall * 0.4 - 0.1 * rec, 0.15 * (s.lean || 0) - 0.2 * rec - 0.05 * sit);
      if (s.walk && s.walk.amount) legs.rotation.z = 0.15 * Math.sin(s.walk.phase * Math.PI * 2) * s.walk.amount;
    },
    getEye(out) { eye.updateWorldMatrix(true, false); return out.setFromMatrixPosition(eye.matrixWorld); },
    getHead(out) { head.updateWorldMatrix(true, false); return out.setFromMatrixPosition(head.matrixWorld); },
  };
}

export function createStandInVisitor({ THREE }) {
  const root = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: 0x7fe8ff, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 1.4, 4, 16), mat); body.position.y = 1.0;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 24, 16), mat); head.scale.set(1, 1.4, 1.2); head.position.y = 1.95;
  root.add(body, head);
  const eye = new THREE.Object3D(); head.add(eye); eye.position.set(0, 0.0, 0.14);
  const light = new THREE.PointLight(0x7fe8ff, 0, 5, 2);
  return {
    root, light, lightLevel: 0,
    set(s) {
      root.position.fromArray(s.position || [0, 0, 0]);
      root.rotation.y = s.yaw || 0;
      const a = (s.materialize || 0) * (1 - (s.dissolve || 0));
      mat.opacity = 0.5 * a; root.visible = a > 0.01;
      light.position.copy(root.position).add(new THREE.Vector3(0, 1.6, 0));
      light.intensity = 3 * a; this.lightLevel = a;
    },
    getEye(out) { eye.updateWorldMatrix(true, false); return out.setFromMatrixPosition(eye.matrixWorld); },
    getHead(out) { head.updateWorldMatrix(true, false); return out.setFromMatrixPosition(head.matrixWorld); },
  };
}

export function createStandInSet({ THREE }) {
  const iroot = new THREE.Group();
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(5, 4), lambert(THREE, 0x3a2e24)); floor.rotation.x = -Math.PI / 2; iroot.add(floor);
  const wallMat = lambert(THREE, 0x5b5146);
  for (const [w, h, x, z, ry] of [[5, 2.6, 0, -2, 0], [4, 2.6, -2.5, 0, Math.PI / 2], [4, 2.6, 2.5, 0, -Math.PI / 2], [5, 2.6, 0, 2, Math.PI]]) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), wallMat); m.position.set(x, 1.3, z); m.rotation.y = ry; iroot.add(m);
  }
  const desk = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.05, 0.75), lambert(THREE, 0x6b4a2e)); desk.position.set(-0.5, 0.75, -1.625); iroot.add(desk);
  const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.35), new THREE.MeshBasicMaterial({ color: 0x2a8a70 })); scr.position.set(-0.5, 1.12, -1.7); iroot.add(scr);
  const chair = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.08, 0.5), lambert(THREE, 0x222222)); iroot.add(chair);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.42, 0.8), lambert(THREE, 0x6b3b2a)); arm.position.set(-1.85, 0.21, 1.1); iroot.add(arm);
  const win = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.9), new THREE.MeshBasicMaterial({ color: 0x0a1330 })); win.position.set(2.49, 1.4, 0.3); win.rotation.y = -Math.PI / 2; iroot.add(win);
  const lamp = new THREE.PointLight(0xffb070, 2.5, 8, 2); lamp.position.set(0.35, 1.2, -1.5); iroot.add(lamp);
  iroot.add(new THREE.AmbientLight(0x404a60, 0.6));
  const mon = new THREE.PointLight(0x60e0c0, 1.2, 4, 2); mon.position.set(-0.5, 1.12, -1.4); iroot.add(mon);
  const eroot = new THREE.Group();
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), lambert(THREE, 0x0b0f14)); ground.rotation.x = -Math.PI / 2; eroot.add(ground);
  const hut = new THREE.Mesh(new THREE.BoxGeometry(5, 2.6, 4), lambert(THREE, 0x1a1a1a)); hut.position.set(0, 1.3, 0); eroot.add(hut);
  const dish = new THREE.Mesh(new THREE.SphereGeometry(6, 32, 12, 0, Math.PI * 2, 0, 0.8), lambert(THREE, 0x8090a0)); dish.position.set(20, 12, -10); eroot.add(dish);
  eroot.add(new THREE.AmbientLight(0x304060, 0.8));
  return {
    interior: { root: iroot, anchors: {} }, exterior: { root: eroot, anchors: { hutWindow: [2.5, 1.4, 0.3], dish: [20, 12, -10], lookAt: [8, 4, -4] } },
    anchors: { screen: { center: [-0.5, 1.12, -1.7], width: 0.62, height: 0.35 }, window: { center: [2.5, 1.4, 0.3] } },
    update(t, s) {
      if (s.samChair) { chair.position.set(s.samChair.pos[0], 0.45, s.samChair.pos[2] + 0.15); chair.rotation.y = s.samChair.yaw; }
      lamp.intensity = 2.5 * (s.lights ?? 1);
    },
  };
}
