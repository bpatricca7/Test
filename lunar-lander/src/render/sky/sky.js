// STUB — owned by the SKY-FX agent. Contract: createSky(ctx) -> { update(frame) }
import * as THREE from 'three';
import { EARTH } from '../../core/constants.js';

export function createSky(ctx) {
  const n = 3000, pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const u = Math.random() * 2 - 1, t = Math.random() * Math.PI * 2, s = Math.sqrt(1 - u * u);
    pos.set([s * Math.cos(t) * 1e8, s * Math.sin(t) * 1e8, u * 1e8], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const stars = new THREE.Points(g, new THREE.PointsMaterial({ color: 0x888888, size: 1.5, sizeAttenuation: false }));
  stars.frustumCulled = false;
  ctx.scene.add(stars);
  const earth = new THREE.Mesh(new THREE.SphereGeometry(EARTH.radius / 38.44, 32, 16), new THREE.MeshStandardMaterial({ color: 0x3366aa }));
  ctx.scene.add(earth);
  return {
    update(frame) {
      earth.position.set(1e7, 0, 0);
    },
  };
}
