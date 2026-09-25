// STUB — owned by the TERRAIN agent. Replace with the full implementation.
// Contract: createTerrain(ctx) -> { update(frame), isReady() }   (adds its objects to ctx.scene, layer WORLD)
import * as THREE from 'three';
import { MOON } from '../../core/constants.js';
import { terrainHeight } from '../../world/moon.js';

export function createTerrain(ctx) {
  const mat = new THREE.MeshStandardMaterial({ color: 0x8a8a88, roughness: 1, metalness: 0 });
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(MOON.radius - 50, 256, 128), mat);
  ctx.scene.add(sphere);
  const disc = new THREE.Mesh(new THREE.CircleGeometry(20000, 64), mat);
  ctx.scene.add(disc);
  const d = new THREE.Vector3();
  return {
    isReady: () => true,
    update(frame) {
      sphere.position.set(0, 0, 0).sub(frame.origin);
      d.copy(frame.active.pos).normalize();
      const r = MOON.radius + terrainHeight(d.x, d.y, d.z);
      disc.position.copy(d).multiplyScalar(r).sub(frame.origin);
      disc.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), d);
      disc.visible = frame.active.tel.altitude < 30000;
    },
  };
}
