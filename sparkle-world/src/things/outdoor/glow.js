// Soft glowing halos for outdoor lights (string-light bulbs, camp fires): one additive
// Points object per piece, sharing two materials whose brightness follows the night
// (setNightGlow is called once per frame by the outdoor system: one uniform write each).

import * as THREE from 'three';

let tex = null;
function haloTexture() {
  if (tex) return tex;
  const S = 64;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.22, 'rgba(255,255,255,0.75)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.22)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);
  tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.userData.shared = true;
  return tex;
}

const mats = new Map();
const matList = []; // [size, material] pairs, walked every frame without allocating
/** Shared additive halo material of a given world size. */
export function haloMaterial(size) {
  let m = mats.get(size);
  if (!m) {
    m = new THREE.PointsMaterial({
      size,
      map: haloTexture(),
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      opacity: 0.35,
      sizeAttenuation: true,
    });
    m.name = 'outdoor|halo|' + size;
    m.userData.shared = true;
    mats.set(size, m);
    matList.push(size, m);
  }
  return m;
}

/** Points at [[x, y, z, '#rrggbb'], ...] (model units) with a halo of `size` blocks. */
export function haloPoints(list, size = 0.6) {
  const pos = new Float32Array(list.length * 3);
  const col = new Float32Array(list.length * 3);
  const c = new THREE.Color();
  list.forEach(([x, y, z, color], i) => {
    pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
    c.set(color);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeBoundingSphere();
  const pts = new THREE.Points(geo, haloMaterial(size));
  pts.name = 'halo';
  pts.renderOrder = 3;
  return pts;
}

/** 0 by day .. 1 at night: halos fade in as it gets dark. */
export function setNightGlow(night, flicker = 1) {
  for (let i = 0; i < matList.length; i += 2) {
    const size = matList[i], m = matList[i + 1];
    const base = size > 1.5 ? 0.18 + night * 0.62 : 0.1 + night * 0.8;
    m.opacity = Math.min(1, base * (size > 1.5 ? flicker : 1));
  }
}
