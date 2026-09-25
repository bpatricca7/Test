// The meadow that bursts out of the dust: grass, flowers, bushes, trees, the
// grown-up "hero" tree and a few butterflies.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { rng, clamp, ease, noise2, smoothstep, lerp } from '../lib/anim.js';
import { barkTexture } from '../lib/textures.js';
import { heightAt } from './terrain.js';
import { LAYOUT, patchMaterial, shared } from './common.js';

// Growth factor used on the CPU for trees (mirrors bloomMask in GLSL).
export function bloomGrowth(x, z, delay = 0) {
  const c = shared.uBloomCenter.value;
  const d = Math.hypot(x - c.x, z - c.y);
  const edge = shared.uBloomRadius.value + (noise2(x * 0.22, z * 0.22) - 0.5) * 5.0;
  return clamp((edge - d - delay) / 4.0);
}

const GROW_GLSL = /* glsl */ `
  vec3 iPos = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
  float d = length(iPos.xz - uBloomCenter);
  float edge = uBloomRadius + (gNoise(iPos.xz * 0.22) - 0.5) * 5.0;
  float gk = clamp((edge - d - aGrow.y) / aGrow.x, 0.0, 1.0);
  float c1 = 1.70158, c3 = c1 + 1.0;
  float grow = gk <= 0.0 ? 0.0 : 1.0 + c3 * pow(gk - 1.0, 3.0) + c1 * pow(gk - 1.0, 2.0);
`;

function grassBlade() {
  const segs = 3, w = 0.04;
  const pos = [], col = [], idx = [];
  for (let i = 0; i <= segs; i++) {
    const k = i / segs;
    const hw = w * (1 - k) * 0.5 + 0.001;
    pos.push(-hw, k, k * k * 0.18, hw, k, k * k * 0.18);
    const c0 = [0.12, 0.3, 0.07], c1 = [0.55, 0.78, 0.28];
    const c = c0.map((v, j) => lerp(v, c1[j], Math.pow(k, 0.8)));
    col.push(...c, ...c);
    if (i < segs) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // point normals mostly up so blades light softly like a lawn
  const n = g.attributes.normal;
  for (let i = 0; i < n.count; i++) n.setXYZ(i, n.getX(i) * 0.3, 0.9, n.getZ(i) * 0.3);
  return g;
}

function flowerHead() {
  // Low-poly flower: 5 flat petals (2 triangles each) + a little pyramid center.
  const pos = [], col = [];
  const petals = 5;
  for (let i = 0; i < petals; i++) {
    const a = (i / petals) * Math.PI * 2;
    const ca = Math.cos(a), sa = Math.sin(a);
    const px = (x, z, y = 0) => [x * ca - z * sa, y, x * sa + z * ca];
    const quad = [px(0.05, 0, 0.02), px(0.45, -0.2, 0.08), px(0.8, 0, 0.12), px(0.45, 0.2, 0.08)];
    for (const tri of [[0, 2, 1], [0, 3, 2]]) for (const k of tri) { pos.push(...quad[k]); col.push(1, 1, 1); }
  }
  const c = [[0, 0.14, 0], [0.16, 0.03, 0], [0, 0.03, 0.16], [-0.16, 0.03, 0], [0, 0.03, -0.16]];
  for (const tri of [[0, 2, 1], [0, 3, 2], [0, 4, 3], [0, 1, 4]]) for (const k of tri) { pos.push(...c[k]); col.push(1.0, 0.8, 0.15); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  const n = g.attributes.normal;
  for (let i = 0; i < n.count; i++) n.setXYZ(i, n.getX(i) * 0.3, 1, n.getZ(i) * 0.3);
  return g;
}

export function buildNature(scene) {
  const r = rng(99);
  const group = new THREE.Group();
  scene.add(group);
  const [cx, cz] = LAYOUT.plant;

  // ---------------- grass
  const blade = grassBlade();
  const N = 30000;
  const grassMat = patchMaterial(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }), {
    key: 'grass',
    vertexHead: 'attribute vec2 aGrow;',
    vertexBody: `
      ${GROW_GLSL}
      float hk = position.y;
      transformed.y *= max(grow, 0.0001);
      transformed.x *= min(1.0, gk * 3.0);
      float sway = sin(uTime * 1.8 + iPos.x * 0.35 + iPos.z * 0.27) * 0.5 + sin(uTime * 3.1 + iPos.x * 1.3) * 0.2;
      transformed.z += hk * hk * (0.12 + sway * 0.1) * uWind;
      transformed.x += hk * hk * sway * 0.05 * uWind;`,
    fragReplace: {
      '#include <normal_fragment_begin>': `float faceDirection = gl_FrontFacing ? 1.0 : -1.0;
        vec3 normal = normalize(vNormal);
        vec3 nonPerturbedNormal = normal;`,
    },
  });
  const grass = new THREE.InstancedMesh(blade, grassMat, N);
  const grow = new Float32Array(N * 2);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3();
  const col = new THREE.Color();
  for (let i = 0; i < N; i++) {
    const rad = 38 * Math.pow(r(), 0.62);
    const a = r() * Math.PI * 2;
    const x = cx + Math.cos(a) * rad, z = cz + Math.sin(a) * rad;
    e.set((r() - 0.5) * 0.3, r() * Math.PI * 2, (r() - 0.5) * 0.3);
    q.setFromEuler(e);
    const near = Math.min(1, Math.hypot(x - cx, z - cz) / 6);
    const h = (0.1 + r() * 0.22 + noise2(x * 0.3, z * 0.3) * 0.16) * (0.55 + 0.45 * near);
    p.set(x, heightAt(x, z) - 0.01, z);
    s.set(1 + r() * 0.8, h, 1);
    m4.compose(p, q, s);
    grass.setMatrixAt(i, m4);
    col.setHSL(0.24 + (r() - 0.5) * 0.06, 0.6, 0.45 + r() * 0.2);
    grass.setColorAt(i, col.multiplyScalar(1.9));
    grow[i * 2] = 1.5 + r() * 2;
    grow[i * 2 + 1] = r() * 1.5;
  }
  grass.geometry = blade.clone();
  grass.geometry.setAttribute('aGrow', new THREE.InstancedBufferAttribute(grow, 2));
  grass.receiveShadow = true;
  grass.frustumCulled = false;
  group.add(grass);

  // ---------------- flowers
  const FN = 2600;
  const flowerMat = patchMaterial(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }), {
    key: 'flowers',
    vertexHead: 'attribute vec2 aGrow;',
    vertexBody: `
      ${GROW_GLSL}
      transformed *= max(grow, 0.0001);
      float fs = sin(uTime * 1.6 + iPos.x * 0.5 + iPos.z * 0.4);
      transformed.x += fs * 0.25 * uWind;`,
    fragReplace: {
      '#include <normal_fragment_begin>': `float faceDirection = gl_FrontFacing ? 1.0 : -1.0;
        vec3 normal = normalize(vNormal);
        vec3 nonPerturbedNormal = normal;`,
    },
  });
  const flowers = new THREE.InstancedMesh(flowerHead(), flowerMat, FN);
  const fgrow = new Float32Array(FN * 2);
  const palette = ['#ff6fa8', '#ffd84a', '#ffffff', '#b58cff', '#ff8a3d', '#ff5a5a', '#7fd7ff'];
  for (let i = 0; i < FN; i++) {
    const rad = 34 * Math.pow(r(), 0.7);
    const a = r() * Math.PI * 2;
    const x = cx + Math.cos(a) * rad, z = cz + Math.sin(a) * rad;
    e.set((r() - 0.5) * 0.5, r() * Math.PI * 2, (r() - 0.5) * 0.5);
    q.setFromEuler(e);
    const sc = 0.1 + r() * 0.1;
    p.set(x, heightAt(x, z) + 0.12 + r() * 0.16, z);
    s.setScalar(sc);
    m4.compose(p, q, s);
    flowers.setMatrixAt(i, m4);
    col.set(palette[Math.floor(r() * palette.length)]);
    flowers.setColorAt(i, col);
    fgrow[i * 2] = 1.2 + r();
    fgrow[i * 2 + 1] = 0.5 + r() * 2.5;
  }
  flowers.geometry.setAttribute('aGrow', new THREE.InstancedBufferAttribute(fgrow, 2));
  flowers.frustumCulled = false;
  flowers.castShadow = false;
  flowers.receiveShadow = true;
  group.add(flowers);

  // ---------------- bushes
  const BN = 420;
  const bushGeo = new THREE.IcosahedronGeometry(0.5, 1);
  {
    const pp = bushGeo.attributes.position;
    for (let i = 0; i < pp.count; i++) {
      const v = new THREE.Vector3().fromBufferAttribute(pp, i);
      const k = 1 + (noise2(v.x * 3 + 1, v.y * 3 + v.z * 2) - 0.5) * 0.35;
      pp.setXYZ(i, v.x * k, v.y * k * 0.8, v.z * k);
    }
    bushGeo.computeVertexNormals();
  }
  const bushMat = patchMaterial(new THREE.MeshLambertMaterial({ color: '#ffffff' }), {
    key: 'bush',
    vertexHead: 'attribute vec2 aGrow;',
    vertexBody: `${GROW_GLSL}\n transformed *= max(grow, 0.0001);`,
  });
  const bushes = new THREE.InstancedMesh(bushGeo, bushMat, BN);
  const bgrow = new Float32Array(BN * 2);
  let bi = 0;
  for (let guard = 0; bi < BN && guard < 5000; guard++) {
    const rad = 7 + 110 * Math.pow(r(), 0.8);
    const a = r() * Math.PI * 2;
    const x = cx + Math.cos(a) * rad, z = cz + Math.sin(a) * rad;
    if (Math.hypot(x, z) < 10) continue;
    e.set(0, r() * Math.PI, 0);
    q.setFromEuler(e);
    const sc = 0.5 + r() * 1.2 + rad * 0.01;
    p.set(x, heightAt(x, z) + sc * 0.15, z);
    s.set(sc * (1 + r() * 0.5), sc, sc * (1 + r() * 0.5));
    m4.compose(p, q, s);
    bushes.setMatrixAt(bi, m4);
    col.setHSL(0.26 + (r() - 0.5) * 0.08, 0.55, 0.3 + r() * 0.12);
    if (r() < 0.12) col.set(r() < 0.5 ? '#e86aa0' : '#f0c040');
    bushes.setColorAt(bi, col);
    bgrow[bi * 2] = 2.5;
    bgrow[bi * 2 + 1] = r() * 3;
    bi++;
  }
  bushes.count = bi;
  bushes.geometry = bushGeo.clone();
  bushes.geometry.setAttribute('aGrow', new THREE.InstancedBufferAttribute(bgrow, 2));
  bushes.castShadow = true;
  bushes.receiveShadow = true;
  bushes.frustumCulled = false;
  group.add(bushes);

  // ---------------- trees
  const trees = [];
  const bark = barkTexture();
  const trunkMat = new THREE.MeshLambertMaterial({ map: bark });
  const leafCols = ['#3f8f2f', '#58a83a', '#2f7a3a', '#7ab840', '#e87aa8', '#f2a93b'];
  for (let guard = 0; trees.length < 70 && guard < 4000; guard++) {
    const rad = 9 + 130 * Math.pow(r(), 0.9);
    const a = r() * Math.PI * 2;
    const x = cx + Math.cos(a) * rad, z = cz + Math.sin(a) * rad;
    if (Math.hypot(x, z) < 11) continue;
    if (trees.some((t) => Math.hypot(t.x - x, t.z - z) < 5)) continue;
    const size = 1.6 + r() * 1.6 + rad * 0.012;
    const tree = makeTree(r, size, trunkMat, leafCols[r() < 0.8 ? Math.floor(r() * 4) : 4 + Math.floor(r() * 2)], rad < 30 ? 2 : 1);
    tree.position.set(x, heightAt(x, z) - 0.05, z);
    tree.rotation.y = r() * Math.PI * 2;
    tree.userData = { x, z, delay: r() * 2, size };
    group.add(tree);
    trees.push({ obj: tree, x, z, delay: tree.userData.delay });
  }

  const hero = makeHeroTree(trunkMat);
  hero.root.position.set(cx, heightAt(cx, cz) - 0.02, cz);
  group.add(hero.root);

  const butterflies = makeButterflies(group);

  return {
    group,
    grass,
    flowers,
    bushes,
    trees,
    hero,
    butterflies,
    update(t) {
      for (const tr of trees) {
        const g = bloomGrowth(tr.x, tr.z, tr.delay);
        const s = g <= 0 ? 0.0001 : ease.outElastic(g) * 0.9 + g * 0.1;
        tr.obj.scale.set(s, Math.max(0.0001, ease.outBack(g)), s);
        tr.obj.visible = g > 0;
        tr.obj.children[1].rotation.z = Math.sin(t * 0.9 + tr.x) * 0.02;
      }
      const any = shared.uBloomRadius.value > -5;
      grass.visible = flowers.visible = bushes.visible = any;
    },
  };
}

function makeTree(r, size, trunkMat, leafColor, detail = 2) {
  const g = new THREE.Group();
  const h = size * 1.3;
  const trunkGeo = new THREE.CylinderGeometry(size * 0.06, size * 0.11, h, 8, 4);
  trunkGeo.translate(0, h / 2, 0);
  const tp = trunkGeo.attributes.position;
  for (let i = 0; i < tp.count; i++) tp.setX(i, tp.getX(i) + Math.sin(tp.getY(i) * 1.3) * size * 0.04);
  trunkGeo.computeVertexNormals();
  const trunk = new THREE.Mesh(trunkGeo, trunkMat);
  trunk.castShadow = true;
  g.add(trunk);
  const blobs = [];
  const n = 4 + Math.floor(r() * 3);
  for (let i = 0; i < n; i++) {
    const b = new THREE.IcosahedronGeometry(size * (0.45 + r() * 0.3), detail);
    const bp = b.attributes.position;
    for (let k = 0; k < bp.count; k++) {
      const v = new THREE.Vector3().fromBufferAttribute(bp, k);
      const f = 1 + (noise2(v.x * 2.3 + i, v.y * 2.3 + v.z * 1.7) - 0.5) * 0.3;
      bp.setXYZ(k, v.x * f, v.y * f, v.z * f);
    }
    const a = (i / n) * Math.PI * 2 + r();
    const rr = i === 0 ? 0 : size * (0.35 + r() * 0.25);
    b.translate(Math.cos(a) * rr, h + size * (0.1 + r() * 0.5) - (i === 0 ? 0 : size * 0.2), Math.sin(a) * rr);
    blobs.push(b);
  }
  const foliageGeo = mergeGeometries(blobs);
  foliageGeo.computeVertexNormals();
  const foliage = new THREE.Mesh(foliageGeo, new THREE.MeshLambertMaterial({ color: leafColor }));
  foliage.castShadow = true;
  foliage.receiveShadow = true;
  g.add(foliage);
  return g;
}

// The sprout, all grown up: a curvy young tree with pink blossoms.
function makeHeroTree(trunkMat) {
  const root = new THREE.Group();
  const r = rng(314);
  const trunkCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.15, 0.8, 0.05), new THREE.Vector3(-0.1, 1.6, -0.05), new THREE.Vector3(0.1, 2.4, 0.05),
  ]);
  const trunkGeo = new THREE.TubeGeometry(trunkCurve, 32, 0.12, 12, false);
  const tp = trunkGeo.attributes.position;
  for (let i = 0; i < tp.count; i++) {
    const y = tp.getY(i);
    const k = 1 - (y / 2.4) * 0.55;
    const c = trunkCurve.getPointAt(clamp(y / 2.45));
    tp.setX(i, c.x + (tp.getX(i) - c.x) * k);
    tp.setZ(i, c.z + (tp.getZ(i) - c.z) * k);
  }
  trunkGeo.computeVertexNormals();
  const trunk = new THREE.Mesh(trunkGeo, trunkMat);
  trunk.castShadow = true;
  const trunkG = new THREE.Group();
  trunkG.add(trunk);
  root.add(trunkG);
  const branches = [];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    const y0 = 1.5 + i * 0.22;
    const c = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, y0, 0), new THREE.Vector3(Math.cos(a) * 0.5, y0 + 0.4, Math.sin(a) * 0.5), new THREE.Vector3(Math.cos(a) * 0.9, y0 + 0.65, Math.sin(a) * 0.9),
    ]);
    const bg = new THREE.TubeGeometry(c, 12, 0.045, 8, false);
    const b = new THREE.Mesh(bg, trunkMat);
    b.castShadow = true;
    trunkG.add(b);
    branches.push({ mesh: b, end: c.getPoint(1) });
  }
  const pink = new THREE.MeshStandardMaterial({ color: '#ff9cc8', roughness: 0.7, emissive: new THREE.Color('#ff4f9a'), emissiveIntensity: 0.12 });
  const green = new THREE.MeshStandardMaterial({ color: '#5fb040', roughness: 0.75 });
  const blobs = [];
  const spots = [new THREE.Vector3(0.1, 2.55, 0.05), ...branches.map((b) => b.end)];
  spots.forEach((sp, i) => {
    for (let k = 0; k < 3; k++) {
      const geo = new THREE.IcosahedronGeometry(0.42 + r() * 0.25, 3);
      const bp = geo.attributes.position;
      for (let j = 0; j < bp.count; j++) {
        const v = new THREE.Vector3().fromBufferAttribute(bp, j);
        const f = 1 + (noise2(v.x * 3 + i + k, v.y * 3 + v.z * 2) - 0.5) * 0.35;
        bp.setXYZ(j, v.x * f, v.y * f * 0.85, v.z * f);
      }
      geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, (i + k) % 3 === 0 ? green : pink);
      m.position.copy(sp).add(new THREE.Vector3((r() - 0.5) * 0.5, (r() - 0.2) * 0.35, (r() - 0.5) * 0.5));
      m.castShadow = true;
      m.receiveShadow = true;
      root.add(m);
      blobs.push({ mesh: m, delay: 0.3 + r() * 0.5 });
    }
  });
  return {
    root,
    pink,
    pose({ grow = 1, t = 0 }) {
      const g = clamp(grow);
      root.visible = g > 0.001;
      const tg = ease.outCubic(clamp(g / 0.6));
      trunkG.scale.set(0.3 + 0.7 * tg, Math.max(0.001, tg), 0.3 + 0.7 * tg);
      for (const b of blobs) {
        const k = clamp((g - b.delay) / 0.45);
        const s = k <= 0 ? 0.0001 : ease.outBack(k, 2.2);
        b.mesh.scale.setScalar(s);
        b.mesh.visible = k > 0;
        b.mesh.rotation.z = Math.sin(t * 0.8 + b.delay * 10) * 0.03;
      }
      root.rotation.z = Math.sin(t * 0.6) * 0.01;
    },
  };
}

function makeButterflies(group) {
  const list = [];
  const r = rng(77);
  const cols = ['#ffb13b', '#6fc3ff', '#ff7ac0', '#fff27a'];
  for (let i = 0; i < 10; i++) {
    const b = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: cols[i % cols.length], side: THREE.DoubleSide, roughness: 0.6, emissive: new THREE.Color(cols[i % cols.length]), emissiveIntensity: 0.25 });
    const wingShape = new THREE.Shape();
    wingShape.moveTo(0, 0);
    wingShape.bezierCurveTo(0.05, 0.06, 0.1, 0.05, 0.09, 0.0);
    wingShape.bezierCurveTo(0.1, -0.05, 0.04, -0.06, 0, 0);
    const wg = new THREE.ShapeGeometry(wingShape, 8);
    wg.rotateX(-Math.PI / 2);
    const wings = [];
    for (const side of [-1, 1]) {
      const w = new THREE.Mesh(wg, mat);
      w.scale.x = side;
      const piv = new THREE.Group();
      piv.add(w);
      b.add(piv);
      wings.push({ piv, side });
    }
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.006, 0.05, 4, 6), new THREE.MeshStandardMaterial({ color: '#2a2020' }));
    body.rotation.x = Math.PI / 2;
    b.add(body);
    b.visible = false;
    group.add(b);
    list.push({ obj: b, wings, seed: r() * 100, rad: 1.5 + r() * 4, h: 0.6 + r() * 1.2, speed: 0.25 + r() * 0.3, cx: (r() - 0.5) * 6, cz: (r() - 0.5) * 6 });
  }
  return {
    list,
    update(t, center, amount = 1) {
      list.forEach((bf, i) => {
        bf.obj.visible = amount > 0 && i < Math.round(amount * list.length);
        if (!bf.obj.visible) return;
        const a = t * bf.speed + bf.seed;
        const x = center[0] + bf.cx + Math.cos(a) * bf.rad + Math.sin(a * 2.3) * 0.4;
        const z = center[1] + bf.cz + Math.sin(a * 1.3) * bf.rad;
        const y = heightAt(x, z) + bf.h + Math.sin(a * 5.1) * 0.25;
        const nx = center[0] + bf.cx + Math.cos(a + 0.05) * bf.rad + Math.sin((a + 0.05) * 2.3) * 0.4;
        const nz = center[1] + bf.cz + Math.sin((a + 0.05) * 1.3) * bf.rad;
        bf.obj.position.set(x, y, z);
        bf.obj.rotation.y = Math.atan2(nx - x, nz - z) - Math.PI / 2;
        const flap = Math.sin(t * 22 + bf.seed) * 0.9;
        for (const w of bf.wings) w.piv.rotation.x = 0, w.piv.rotation.z = w.side * flap;
      });
    },
  };
}

export { smoothstep };
