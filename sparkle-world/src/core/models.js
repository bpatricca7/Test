// Helpers for building blocky 3D models (furniture, avatars, pets, food) from boxes.
// Materials and the unit box geometry are cached and shared; they are marked
// userData.shared so disposeObject() leaves them alone.

import * as THREE from 'three';

const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);
UNIT_BOX.userData.shared = true;
const matCache = new Map();
const geoCache = new Map();

/**
 * Cached MeshLambertMaterial. opts: { emissive, emissiveIntensity, transparent, opacity,
 * map (not cached when given), side }.
 */
export function mat(color, opts = {}) {
  if (opts.map) {
    return new THREE.MeshLambertMaterial({ color, ...opts });
  }
  const key = `${color}|${opts.emissive || ''}|${opts.emissiveIntensity ?? ''}|${opts.opacity ?? ''}|${opts.side ?? ''}`;
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshLambertMaterial({
      color,
      emissive: opts.emissive || 0x000000,
      emissiveIntensity: opts.emissiveIntensity ?? 1,
      transparent: opts.opacity !== undefined && opts.opacity < 1,
      opacity: opts.opacity ?? 1,
      side: opts.side ?? THREE.FrontSide,
    });
    m.userData.shared = true;
    matCache.set(key, m);
  }
  return m;
}

/**
 * A box mesh whose MIN corner is at (x, y, z) in the parent's units (blocks).
 * Uses one shared unit geometry scaled per mesh.
 */
export function box(w, h, d, color, x = 0, y = 0, z = 0, opts = {}) {
  const material = color && color.isMaterial ? color : mat(color, opts);
  const m = new THREE.Mesh(UNIT_BOX, material);
  m.scale.set(w, h, d);
  m.position.set(x + w / 2, y + h / 2, z + d / 2);
  return m;
}

/** A vertical cylinder whose base centre is at (x, y, z). */
export function cyl(radius, height, color, x = 0, y = 0, z = 0, segments = 12, opts = {}) {
  const key = `cyl|${segments}`;
  let g = geoCache.get(key);
  if (!g) {
    g = new THREE.CylinderGeometry(1, 1, 1, segments);
    g.userData.shared = true;
    geoCache.set(key, g);
  }
  const material = color && color.isMaterial ? color : mat(color, opts);
  const m = new THREE.Mesh(g, material);
  m.scale.set(radius, height, radius);
  m.position.set(x, y + height / 2, z);
  return m;
}

/** A sphere centred at (x, y, z). */
export function ball(radius, color, x = 0, y = 0, z = 0, opts = {}) {
  let g = geoCache.get('ball');
  if (!g) {
    g = new THREE.SphereGeometry(1, 16, 12);
    g.userData.shared = true;
    geoCache.set('ball', g);
  }
  const material = color && color.isMaterial ? color : mat(color, opts);
  const m = new THREE.Mesh(g, material);
  m.scale.setScalar(radius);
  m.position.set(x, y, z);
  return m;
}

/** CanvasTexture painted by paint(ctx, w, h); crisp pixels, sRGB. */
export function canvasTexture(w, h, paint) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  paint(ctx, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

/** Dispose geometries, materials and textures of an object tree (skipping shared ones). */
export function disposeObject(root) {
  root.traverse((o) => {
    if (o.geometry && !o.geometry.userData.shared) o.geometry.dispose();
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) {
      if (m.userData && m.userData.shared) continue;
      for (const k of ['map', 'emissiveMap', 'alphaMap']) if (m[k] && !m[k].userData?.shared) m[k].dispose();
      m.dispose();
    }
  });
}
