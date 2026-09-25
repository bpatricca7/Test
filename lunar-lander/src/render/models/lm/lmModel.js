// STUB — owned by the LM-MODEL agent. Contract: createLMModel(ctx) -> { root, update(frame, vessel), setIVA(bool) }
import * as THREE from 'three';
import { LAYERS, LM } from '../../../core/constants.js';

export function createLMModel(ctx) {
  const root = new THREE.Group();
  root.name = 'LM';
  const gold = new THREE.MeshStandardMaterial({ color: 0xc8962a, metalness: 0.9, roughness: 0.35 });
  const grey = new THREE.MeshStandardMaterial({ color: 0x777777, metalness: 0.3, roughness: 0.6 });
  const ds = new THREE.Mesh(new THREE.CylinderGeometry(2.25, 2.25, 1.75, 8), gold);
  ds.position.y = 2.22;
  const as = new THREE.Mesh(new THREE.BoxGeometry(3.2, 2.8, 2.6), grey);
  as.position.y = 4.6;
  root.add(ds, as);
  for (const l of LM.gear.legs) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 3.6), grey);
    const top = l.dir.clone().multiplyScalar(2.05).setY(2.85);
    const pad = l.dir.clone().multiplyScalar(4.55).setY(0.1);
    leg.position.copy(top).add(pad).multiplyScalar(0.5);
    leg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), top.clone().sub(pad).normalize());
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.47, 0.47, 0.18, 16), grey);
    p.position.copy(pad);
    root.add(leg, p);
  }
  root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.layers.set(LAYERS.VESSEL); } });
  return {
    root,
    setIVA(on) { root.traverse((o) => { if (o.isMesh) o.layers.set(on ? LAYERS.GHOST : LAYERS.VESSEL); }); },
    update(frame, v) {
      root.position.copy(v.pos).sub(frame.origin);
      root.quaternion.copy(v.quat);
    },
  };
}
