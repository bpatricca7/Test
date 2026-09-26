// LM-CABIN: draw-call / texture budget pass (src/render/cockpit/lm/optimize.js): atlas packing and
// UV remapping, static merging, and the watch that releases merged parts when they move.
// Run: node --test test/lmcabin-optimize.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { packShelves, atlasUV, buildAtlas, mergeStatic, optimizeCabin, CABIN_QUALITY } from '../src/render/cockpit/lm/optimize.js';

/** Minimal canvas stand-in (node has no DOM): records drawImage calls. */
function fakeCanvas(w, h) {
  const calls = [];
  const g = { drawImage: (...a) => calls.push(a), imageSmoothingEnabled: true, imageSmoothingQuality: 'low' };
  return { width: w, height: h, calls, getContext: () => g };
}
function paintedMaterial(w, h, auxRatio = 0.5, o = {}) {
  const map = new THREE.Texture(fakeCanvas(w, h));
  const aux = new THREE.Texture(fakeCanvas(Math.round(w * auxRatio), Math.round(h * auxRatio)));
  const m = new THREE.MeshStandardMaterial({ map, roughnessMap: aux, bumpMap: aux, emissiveMap: aux, roughness: 1, ...o });
  m.userData.integralScale = 1;
  m.onBeforeCompile = () => {};
  m.customProgramCacheKey = () => 'kit-integral';
  return m;
}
const plane = (w = 0.1, h = 0.05) => new THREE.PlaneGeometry(w, h);

test('packer: no overlaps, inside the page, well filled', () => {
  const rects = [];
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 120; i++) rects.push({ id: i, w: 2 * Math.round(10 + rnd() * 300), h: 2 * Math.round(10 + rnd() * 300) });
  const pages = packShelves(rects, 1024);
  let area = 0;
  for (const r of rects) {
    area += r.w * r.h;
    const p = pages[r.page];
    assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= p.w && r.y + r.h <= p.h && p.w <= 1024 && p.h <= 1024);
    assert.equal(r.x % 2, 0);
    assert.equal(r.y % 2, 0);
  }
  for (const p of pages) {
    for (let i = 0; i < p.rects.length; i++) {
      for (let j = i + 1; j < p.rects.length; j++) {
        const a = p.rects[i];
        const b = p.rects[j];
        const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        assert.ok(!overlap, `rects ${a.id} and ${b.id} overlap`);
      }
    }
  }
  const used = pages.reduce((s, p) => s + p.w * p.h, 0);
  assert.ok(area / used > 0.75, `fill ${(area / used).toFixed(2)}`);
});

test('atlasUV maps the tile corners onto the tile (flipY canvas convention)', () => {
  const r = { x: 100, y: 40, w: 220, h: 120 };
  const g = 10;
  const [u0, v0] = atlasUV(0, 0, r, 1000, 500, g);
  const [u1, v1] = atlasUV(1, 1, r, 1000, 500, g);
  // canvas pixel = (u * W, (1 - v) * H)
  assert.ok(Math.abs(u0 * 1000 - 110) < 1e-9 && Math.abs((1 - v0) * 500 - 150) < 1e-9, 'uv (0,0) -> bottom-left of the tile');
  assert.ok(Math.abs(u1 * 1000 - 310) < 1e-9 && Math.abs((1 - v1) * 500 - 50) < 1e-9, 'uv (1,1) -> top-right of the tile');
});

test('atlas: painted materials of one kind share one material; UVs remapped; tiles resampled per quality', () => {
  const root = new THREE.Group();
  const mats = [paintedMaterial(400, 200), paintedMaterial(300, 300), paintedMaterial(128, 64)];
  const meshes = mats.map((m, i) => {
    const mesh = new THREE.Mesh(plane(), m);
    mesh.position.x = i * 0.2;
    root.add(mesh);
    return mesh;
  });
  // a material with repeating UVs and a lamp must be left alone
  const tiled = paintedMaterial(64, 64);
  const g = plane();
  g.attributes.uv.setX(0, 3);
  const tiledMesh = new THREE.Mesh(g, tiled);
  root.add(tiledMesh);
  const lamp = paintedMaterial(64, 64);
  lamp.userData.lampBase = 1.2;
  const lampMesh = new THREE.Mesh(plane(), lamp);
  root.add(lampMesh);
  const registered = [];
  const before = meshes.map((m) => m.geometry.attributes.uv.array.slice());
  const a = buildAtlas(root, { scale: 0.5, pageSize: 1024, createCanvas: fakeCanvas, registerIntegral: (m) => registered.push(m) });
  assert.equal(a.materials.length, 1);
  assert.equal(registered.length, 1, 'atlas material joins integral lighting');
  const am = meshes[0].material;
  assert.ok(meshes.every((m) => m.material === am));
  assert.ok(am.map.image !== am.roughnessMap.image && am.roughnessMap === am.bumpMap && am.bumpMap === am.emissiveMap);
  assert.equal(am.roughnessMap.image.width, am.map.image.width / 2, 'aux page at half size');
  assert.equal(tiledMesh.material, tiled);
  assert.equal(lampMesh.material, lamp);
  assert.equal(a.reasons.uv, 1);
  assert.equal(a.reasons.lamp, 1);
  // UVs: inside the page, different tiles for different meshes, original geometry untouched
  const boxes = meshes.map((m) => {
    const uv = m.geometry.attributes.uv;
    const b = new THREE.Box2();
    for (let i = 0; i < uv.count; i++) b.expandByPoint(new THREE.Vector2(uv.getX(i), uv.getY(i)));
    assert.ok(b.min.x >= 0 && b.min.y >= 0 && b.max.x <= 1 && b.max.y <= 1);
    return b;
  });
  assert.ok(!boxes[0].intersectsBox(boxes[1]) || boxes[0].intersect(boxes[1]).isEmpty());
  // tile sizes follow the canvases at half scale (400 x 200 px -> 200 x 100 px of the page)
  const s = boxes[0].getSize(new THREE.Vector2());
  assert.ok(Math.abs(s.x * am.map.image.width - 200) < 1 && Math.abs(s.y * am.map.image.height - 100) < 1, `${s.x * am.map.image.width} x ${s.y * am.map.image.height}`);
  assert.deepEqual(a.records[0].geometry.attributes.uv.array, before[0]);
  assert.ok(a.pxAfter < a.pxBefore, 'quality low: less texture memory');
});

test('merge: static meshes become one batch per material; movers are released and redrawn alone', () => {
  const root = new THREE.Group();
  const matA = new THREE.MeshStandardMaterial({ color: 0x808080 });
  const matA2 = new THREE.MeshStandardMaterial({ color: 0x808080 }); // identical parameters: shared
  const matB = new THREE.MeshStandardMaterial({ color: 0x202020 });
  const parts = [];
  for (let i = 0; i < 6; i++) {
    const grp = new THREE.Group();
    grp.position.set(i * 0.1, 0, 0);
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 0.02), i % 2 ? matA : matA2);
    grp.add(m);
    root.add(grp);
    parts.push(m);
  }
  const needle = new THREE.Mesh(new THREE.BoxGeometry(0.001, 0.03, 0.001), matB);
  const n2 = new THREE.Mesh(new THREE.BoxGeometry(0.001, 0.03, 0.001), matB);
  root.add(needle, n2);
  // an instanced bank (expanded into the batch) and a mover declared up front
  const bank = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.003, 0.003, 0.004, 8), matB, 5);
  for (let i = 0; i < 5; i++) bank.setMatrixAt(i, new THREE.Matrix4().makeTranslation(i * 0.01, 0.2, 0));
  root.add(bank);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.1, 0.03), matB);
  root.add(grip);
  root.position.set(1000, 2000, 3000); // world placement must not leak into the batch
  const tris = (g) => g.index.count / 3;
  const m = mergeStatic(root, { dynamic: new Set([grip]) });
  const drawn = () => {
    const l = [];
    root.traverseVisible((o) => { if (o.isMesh && o.layers.mask) l.push(o); });
    return l;
  };
  assert.equal(m.materialsShared, 3);
  assert.equal(m.batches.length, 2);
  assert.equal(drawn().length, 3, 'two batches + the declared mover');
  const batchA = m.batches.find((b) => b.material === matA || b.material === matA2);
  assert.equal(tris(batchA.geometry), 6 * 12);
  const batchB = m.batches.find((b) => b.material === matB);
  assert.equal(tris(batchB.geometry), 2 * 12 + 5 * new THREE.CylinderGeometry(0.003, 0.003, 0.004, 8).index.count / 3);
  // baked in root space: first box centred at the origin
  batchA.geometry.computeBoundingBox();
  assert.ok(Math.abs(batchA.geometry.boundingBox.min.x + 0.01) < 1e-6 && batchA.geometry.boundingBox.max.x < 0.52);
  assert.equal(m.check(), false, 'nothing moved');
  // the needle moves: released from its batch, drawn on its own at its new place
  needle.rotation.z = 0.3;
  assert.equal(m.check(), true);
  assert.equal(needle.layers.mask, 1);
  assert.ok(!m.isMerged(needle) && m.isMerged(n2));
  assert.equal(tris(m.batches.find((b) => b.material === matB).geometry), 12 + 5 * 32);
  // a group that holds a merged part is hidden -> released (drawn state follows the graph again)
  parts[2].parent.visible = false;
  m.check();
  assert.ok(!m.isMerged(parts[2]));
  // a shared (deduplicated) material edited at runtime -> its meshes are released
  const edited = parts.find((p) => p.material !== batchA.material);
  edited.material.color.set(0xff0000);
  m.check();
  assert.ok(!m.isMerged(edited));
  // an instanced bank whose instances change is released
  bank.setMatrixAt(0, new THREE.Matrix4().makeTranslation(0, 0.25, 0));
  bank.instanceMatrix.needsUpdate = true;
  m.check();
  assert.ok(!m.isMerged(bank) && bank.layers.mask === 1);
});

test('optimizeCabin: an atlased canvas that is redrawn later gets its own material and UVs back', () => {
  const root = new THREE.Group();
  const mats = [paintedMaterial(200, 100), paintedMaterial(100, 100)];
  const meshes = mats.map((mt) => {
    const mesh = new THREE.Mesh(plane(), mt);
    root.add(mesh);
    return mesh;
  });
  const geos = meshes.map((x) => x.geometry);
  const opt = optimizeCabin(root, { quality: CABIN_QUALITY.medium, createCanvas: fakeCanvas });
  assert.ok(meshes[0].material !== mats[0] && meshes[0].material === meshes[1].material);
  assert.ok(opt.merge.isMerged(meshes[0]));
  assert.equal(opt.update(), false);
  mats[1].map.needsUpdate = true; // the instrument redraws its canvas
  assert.equal(opt.update(), true);
  assert.equal(meshes[1].material, mats[1]);
  assert.equal(meshes[1].geometry, geos[1]);
  assert.ok(!opt.merge.isMerged(meshes[1]) && meshes[1].layers.mask === 1);
  assert.equal(opt.stats.reverted, 1);
});
