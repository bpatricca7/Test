// Mountains of compacted junk cubes, scattered debris and a ruined skyline.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { rng } from '../lib/anim.js';
import { junkCubeTexture } from '../lib/textures.js';
import { heightAt } from './terrain.js';
import { LAYOUT, KEEP_CLEAR, CAMERA_CORRIDOR, patchMaterial } from './common.js';

export const CUBE = 0.5;

// Moss creeps over junk once the bloom reaches it.
function junkMaterial(tex, key, extra = {}) {
  const mat = new THREE.MeshLambertMaterial({ map: tex, bumpMap: tex, bumpScale: 1.5, ...extra });
  return patchMaterial(mat, {
    key,
    vertexHead: 'attribute vec2 aUvOff;',
    vertexBody: `
      #ifdef USE_INSTANCING
        #ifdef USE_MAP
          vMapUv = vMapUv * 0.5 + aUvOff;
        #endif
        #ifdef USE_BUMPMAP
          vBumpMapUv = vBumpMapUv * 0.5 + aUvOff;
        #endif
      #endif`,
    fragReplace: {
      '#include <map_fragment>': `#include <map_fragment>
        if (uBloomRadius > -10.0) {
        float mossN = gNoise(vWPos.xz * 1.7 + vWPos.y * 1.3) * 0.6 + gNoise(vWPos.xy * 3.1) * 0.4;
        float top = smoothstep(0.3, 0.8, vWNormal.y);
        float moss = bloomMask(vWPos, 4.0) * clamp(top * 0.9 + smoothstep(0.45, 0.7, mossN) * (1.0 - smoothstep(2.0, 14.0, vWPos.y)), 0.0, 1.0);
        diffuseColor.rgb = mix(diffuseColor.rgb, mix(vec3(0.16, 0.4, 0.09), vec3(0.4, 0.62, 0.16), mossN), moss * 0.92);
        }`,
    },
  });
}

export function buildJunk(scene) {
  const r = rng(42);
  const texA = junkCubeTexture(1);
  const texB = junkCubeTexture(2);
  const matA = junkMaterial(texA, 'junkA');
  const matB = junkMaterial(texB, 'junkB');
  const group = new THREE.Group();
  scene.add(group);

  // ---- near towers of individual cubes -----------------------------------
  const towers = [];
  const clear = [
    { x: 0, z: 0, r: 10.5 },
    { x: LAYOUT.seat[0], z: LAYOUT.seat[1], r: 4 },
    { x: -1, z: 13, r: 5 },
  ];
  for (const [x, z, rr] of CAMERA_CORRIDOR) clear.push({ x, z, r: rr });
  const isClear = (x, z, pad = 0) => clear.every((c) => Math.hypot(x - c.x, z - c.z) > c.r + pad);
  const isFree = (x, z, pad = 0.4) => KEEP_CLEAR.every(([cx, cz, rr]) => Math.hypot(x - cx, z - cz) > rr + pad);
  let tries = 0;
  while (towers.length < 58 && tries++ < 4000) {
    const a = r() * Math.PI * 2;
    const d = 11 + Math.pow(r(), 1.15) * 50;
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    const n = d < 18 ? 2 + Math.floor(r() * 2) : 3 + Math.floor(r() * 2);
    if (!isClear(x, z, n * CUBE)) continue;
    if (towers.some((t) => Math.hypot(t.x - x, t.z - z) < 3.2 + t.n * 0.3)) continue;
    const layers = Math.floor((d < 18 ? 5 : 10) + r() * (d < 18 ? 16 : 45));
    towers.push({ x, z, n, layers, rot: r() * Math.PI, lean: [(r() - 0.5) * 0.012, (r() - 0.5) * 0.012] });
  }
  // a couple of hand-placed hero towers framing the work area
  towers.push({ x: -8.5, z: -3.0, n: 2, layers: 14, rot: 0.3, lean: [0.006, 0.0] });
  towers.push({ x: -10.5, z: 1.5, n: 3, layers: 26, rot: 0.1, lean: [0.0, 0.004] });
  towers.push({ x: 8.0, z: -6.5, n: 3, layers: 30, rot: 0.6, lean: [-0.003, 0.004] });
  towers.push({ x: 9.2, z: 4.5, n: 2, layers: 18, rot: 0.9, lean: [0.004, -0.004] });
  towers.push({ x: -3.5, z: -11.5, n: 3, layers: 34, rot: 0.2, lean: [0.0, 0.0] });

  const mats = [[], []];
  const cols = [[], []];
  const offs = [[], []];
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3();
  const tint = new THREE.Color();
  const addCube = (x, y, z, ry, tilt, size = CUBE) => {
    const k = r() < 0.5 ? 0 : 1;
    e.set((r() - 0.5) * tilt, ry, (r() - 0.5) * tilt);
    q.setFromEuler(e);
    p.set(x, y, z);
    s.setScalar(size * (0.94 + r() * 0.08));
    m4.compose(p, q, s);
    mats[k].push(m4.clone());
    tint.setHSL(0.06 + (r() - 0.5) * 0.08, 0.2 + r() * 0.3, 0.45 + r() * 0.25);
    const v = 0.75 + r() * 0.4;
    cols[k].push(tint.r * 0 + v * (0.9 + tint.r * 0.25), v * (0.9 + tint.g * 0.2), v * (0.85 + tint.b * 0.2));
    offs[k].push(Math.floor(r() * 4) * 0.25, Math.floor(r() * 4) * 0.25);
  };
  for (const t of towers) {
    const base = heightAt(t.x, t.z) - 0.1;
    const cos = Math.cos(t.rot), sin = Math.sin(t.rot);
    for (let L = 0; L < t.layers; L++) {
      const shrink = L > t.layers * 0.6 ? 1 : 0;
      const n = Math.max(1, t.n - shrink);
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          if (L > 2 && r() < 0.08 + (L / t.layers) * 0.15) continue;
          const lx = (i - (n - 1) / 2) * CUBE * 1.02 + (r() - 0.5) * 0.05 + t.lean[0] * L * L * 0.5;
          const lz = (j - (n - 1) / 2) * CUBE * 1.02 + (r() - 0.5) * 0.05 + t.lean[1] * L * L * 0.5;
          const x = t.x + lx * cos - lz * sin;
          const z = t.z + lx * sin + lz * cos;
          addCube(x, base + CUBE * 0.5 + L * CUBE * 0.99, z, t.rot + (r() - 0.5) * 0.12, 0.05);
        }
      }
    }
  }
  // loose cubes and little piles in the play area
  const loose = [
    [-5.6, 1.2], [-6.2, 1.8], [-5.9, 1.5, 1], [-2.8, -6.1], [-1.9, -6.6], [-2.4, -6.3, 1], [5.8, -3.8], [6.1, -3.2],
    [6.4, 6.5], [-2.9, -9.2], [-8.8, 4.5], [-9.1, 9.6],
  ];
  for (const [x, z, stack] of loose) {
    const y = heightAt(x, z) + CUBE * 0.45 + (stack ? CUBE * 0.97 : 0);
    addCube(x, y, z, r() * Math.PI, 0.12);
  }
  for (let i = 0; i < 70; i++) {
    const a = r() * Math.PI * 2, d = 8 + r() * 20;
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    if (!isClear(x, z, -3) || !isFree(x, z, 0.6)) continue;
    addCube(x, heightAt(x, z) + CUBE * 0.4, z, r() * Math.PI, 0.3);
  }
  const box = new THREE.BoxGeometry(1, 1, 1);
  for (const k of [0, 1]) {
    const im = new THREE.InstancedMesh(box, k ? matB : matA, mats[k].length);
    mats[k].forEach((m, i) => im.setMatrixAt(i, m));
    im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cols[k]), 3);
    im.geometry = box.clone();
    im.geometry.setAttribute('aUvOff', new THREE.InstancedBufferAttribute(new Float32Array(offs[k]), 2));
    im.castShadow = true;
    im.receiveShadow = true;
    im.computeBoundingSphere();
    group.add(im);
  }

  // ---- far towers: merged boxes whose UVs tile the junk texture -----------
  const farGeos = [];
  const tiled = (w, h, d, cube) => {
    const g = new THREE.BoxGeometry(w, h, d);
    const uv = g.attributes.uv;
    const faces = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
    for (let f = 0; f < 6; f++) {
      for (let v = 0; v < 4; v++) {
        const i = f * 4 + v;
        uv.setXY(i, uv.getX(i) * (faces[f][0] / cube), uv.getY(i) * (faces[f][1] / cube));
      }
    }
    return g;
  };
  for (let i = 0; i < 150; i++) {
    const a = r() * Math.PI * 2;
    const d = 55 + Math.pow(r(), 0.8) * 260;
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    const base = heightAt(x, z) - 1;
    const w = 4 + r() * 8;
    let h = 12 + Math.pow(r(), 1.5) * (d > 120 ? 90 : 55);
    let y = base, cw = w, ox = 0, oz = 0;
    const rot = r() * Math.PI;
    const segs = 2 + Math.floor(r() * 3);
    for (let sgi = 0; sgi < segs; sgi++) {
      const sh = h / segs * (0.8 + r() * 0.4);
      const g = tiled(cw, sh, cw * (0.8 + r() * 0.3), 2);
      g.rotateY(rot + (r() - 0.5) * 0.3);
      g.translate(x + ox, y + sh / 2, z + oz);
      farGeos.push(g);
      y += sh;
      cw *= 0.6 + r() * 0.3;
      ox += (r() - 0.5) * cw * 0.5;
      oz += (r() - 0.5) * cw * 0.5;
    }
  }
  const farMat = junkMaterial(texA.clone(), 'junkFar', { bumpScale: 0.6 });
  const far = new THREE.Mesh(mergeGeometries(farGeos), farMat);
  far.receiveShadow = true;
  far.castShadow = true;
  group.add(far);

  // ---- ruined skyline in the haze ----------------------------------------
  const skyGeos = [];
  for (let i = 0; i < 60; i++) {
    const a = r() * Math.PI * 2, d = 380 + r() * 250;
    const w = 10 + r() * 25, h = 40 + Math.pow(r(), 1.6) * 170;
    const g = new THREE.BoxGeometry(w, h, w * (0.6 + r() * 0.6));
    g.rotateY(r() * Math.PI);
    g.translate(Math.cos(a) * d, h / 2 - 3, Math.sin(a) * d);
    skyGeos.push(g);
    if (r() < 0.35) {
      const g2 = new THREE.BoxGeometry(w * 0.4, h * 0.4, w * 0.4);
      g2.translate(Math.cos(a) * d + (r() - 0.5) * w * 0.5, h + h * 0.2 - 3, Math.sin(a) * d);
      skyGeos.push(g2);
    }
  }
  const skyline = new THREE.Mesh(mergeGeometries(skyGeos), new THREE.MeshLambertMaterial({ color: '#6a5a50' }));
  group.add(skyline);

  // ---- debris --------------------------------------------------------------
  const debris = buildDebris(r, (x, z, pad) => isClear(x, z, pad) && isFree(x, z, 0.3));
  group.add(debris);

  const heap = buildHeap(rng(5), LAYOUT.pile[0], LAYOUT.pile[1] - 0.2);
  group.add(heap);

  return { group, towers, matA, texA, heap };
}

// The little junk pile where Bolt finds the sprout.
function buildHeap(r, cx, cz) {
  const g = new THREE.Group();
  const geos = [new THREE.BoxGeometry(0.14, 0.09, 0.11), new THREE.CylinderGeometry(0.04, 0.04, 0.12, 10), new THREE.TorusGeometry(0.1, 0.03, 8, 14), new THREE.BoxGeometry(0.2, 0.015, 0.12), new THREE.CylinderGeometry(0.015, 0.015, 0.35, 6)];
  const cols = ['#7a5a44', '#8f8a80', '#3a3634', '#56687a', '#9a8250', '#6a7258', '#8a4a3a', '#6a5e52'];
  const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.6, metalness: 0.45 });
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1);
  const c = new THREE.Color();
  for (let k = 0; k < geos.length; k++) {
    const n = k === 2 ? 18 : 50;
    const im = new THREE.InstancedMesh(geos[k], mat, n);
    for (let i = 0; i < n; i++) {
      const a = r() * Math.PI * 2, rad = 0.62 * Math.sqrt(r());
      const x = cx + Math.cos(a) * rad * 1.2, z = cz + Math.sin(a) * rad;
      const y = heightAt(x, z) + (1 - rad / 0.62) * 0.38 * (0.6 + r() * 0.5) + 0.02;
      e.set(r() * 6, r() * 6, r() * 6);
      q.setFromEuler(e);
      p.set(x, y, z);
      s.setScalar(0.8 + r() * 0.6);
      m4.compose(p, q, s);
      im.setMatrixAt(i, m4);
      c.set(k === 2 ? '#2a2624' : cols[Math.floor(r() * cols.length)]).multiplyScalar(0.7 + r() * 0.4);
      im.setColorAt(i, c);
    }
    im.castShadow = true;
    im.receiveShadow = true;
    g.add(im);
  }
  const mound = new THREE.Mesh(new THREE.SphereGeometry(0.6, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshLambertMaterial({ color: '#6a5040' }));
  mound.scale.set(1.2, 0.45, 1);
  mound.position.set(cx, heightAt(cx, cz) - 0.03, cz);
  mound.receiveShadow = true;
  g.add(mound);
  return g;
}

function buildDebris(r, isClear) {
  const g = new THREE.Group();
  const kinds = [
    { geo: new THREE.TorusGeometry(0.2, 0.085, 10, 20), mat: new THREE.MeshLambertMaterial({ color: '#1f1c1b' }), n: 55, flat: true, y: 0.07 },
    { geo: new THREE.CylinderGeometry(0.2, 0.2, 0.62, 18), mat: new THREE.MeshLambertMaterial({ color: '#ffffff' }), n: 26, colors: ['#8a3a28', '#3f5f7a', '#6a6a60', '#a86a2a'], y: 0.31 },
    { geo: new THREE.CylinderGeometry(0.05, 0.05, 0.14, 12), mat: new THREE.MeshLambertMaterial({ color: '#ffffff' }), n: 140, colors: ['#c8c8c0', '#b84a3a', '#d8b050', '#5a8ab0', '#7a9a5a'], lying: true, y: 0.05 },
    { geo: new THREE.BoxGeometry(0.34, 0.26, 0.3), mat: new THREE.MeshLambertMaterial({ color: '#ffffff' }), n: 40, colors: ['#8a6a4a', '#6a5038', '#9a7a5a'], y: 0.13 },
    { geo: new THREE.CylinderGeometry(0.04, 0.04, 1.4, 10), mat: new THREE.MeshLambertMaterial({ color: '#8a5a3a' }), n: 30, lying: true, y: 0.04 },
    { geo: new THREE.BoxGeometry(0.9, 0.02, 0.6), mat: new THREE.MeshLambertMaterial({ color: '#ffffff' }), n: 35, colors: ['#9a5a3a', '#7a7a70', '#5a6a70'], sheet: true, y: 0.05 },
  ];
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1);
  const c = new THREE.Color();
  for (const k of kinds) {
    const im = new THREE.InstancedMesh(k.geo, k.mat, k.n);
    let placed = 0, guard = 0;
    while (placed < k.n && guard++ < 5000) {
      const a = r() * Math.PI * 2, d = 3 + Math.pow(r(), 0.7) * 34;
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      if (d < 7.5 && r() < 0.85) continue;
      if (!isClear(x, z, -6)) continue;
      const lying = k.lying || (k.flat && r() < 0.8);
      e.set(lying ? Math.PI / 2 : k.sheet ? (r() - 0.5) * 0.5 : (r() - 0.5) * 0.2, r() * Math.PI * 2, k.sheet ? (r() - 0.5) * 0.6 : 0);
      if (k.flat && lying) e.set(Math.PI / 2 + (r() - 0.5) * 0.3, 0, r() * Math.PI);
      q.setFromEuler(e);
      p.set(x, heightAt(x, z) + k.y * (lying && !k.flat ? 1 : 1), z);
      s.setScalar(0.8 + r() * 0.5);
      m4.compose(p, q, s);
      im.setMatrixAt(placed, m4);
      if (k.colors) {
        c.set(k.colors[Math.floor(r() * k.colors.length)]).multiplyScalar(0.8 + r() * 0.35);
        im.setColorAt(placed, c);
      }
      placed++;
    }
    im.count = placed;
    im.castShadow = true;
    im.receiveShadow = true;
    im.computeBoundingSphere();
    g.add(im);
  }
  return g;
}
