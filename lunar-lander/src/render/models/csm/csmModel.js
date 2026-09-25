// STUB — owned by the CSM-MODEL agent. Contract: createCSMModel(ctx) -> { root, update(frame, vessel), setIVA(bool) }
import * as THREE from 'three';
import { LAYERS } from '../../../core/constants.js';

export function createCSMModel(ctx) {
  const root = new THREE.Group();
  root.name = 'CSM';
  const silver = new THREE.MeshStandardMaterial({ color: 0xdddddd, metalness: 0.9, roughness: 0.25 });
  const cm = new THREE.Mesh(new THREE.ConeGeometry(1.955, 2.95, 48), silver);
  cm.rotation.x = -Math.PI / 2;
  cm.position.z = -1.475;
  const sm = new THREE.Mesh(new THREE.CylinderGeometry(1.955, 1.955, 4.95, 48), silver);
  sm.rotation.x = Math.PI / 2;
  sm.position.z = 2.525;
  const nz = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 1.25, 2.8, 32, 1, true), new THREE.MeshStandardMaterial({ color: 0x333333, side: THREE.DoubleSide }));
  nz.rotation.x = Math.PI / 2;
  nz.position.z = 6.4;
  root.add(cm, sm, nz);
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
