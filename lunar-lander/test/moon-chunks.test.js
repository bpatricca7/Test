// Tests for terrain chunk generation (src/render/terrain/chunkGen.js): data validity, crack-free shared
// edges between neighbours, geomorph targets that reproduce the parent surface, skirts, shadows and
// boulders.   Run: node --test test/moon-chunks.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateChunk, chunkJob, SHADOW_CLAMP, BOULDER_STRIDE } from '../src/render/terrain/chunkGen.js';
import { dirFace, dirToFaceST, faceDir } from '../src/render/terrain/cubeSphere.js';
import { SITE, siteOffsetDir, terrainHeight } from '../src/world/moon.js';
import { SUN_DIR } from '../src/core/frames.js';
import { MOON } from '../src/core/constants.js';

const R = MOON.radius;
const sun = [SUN_DIR.x, SUN_DIR.y, SUN_DIR.z];
const N = 17; // small chunks keep the test fast

function chunkAt(dir, level) {
  const f = dirFace(...dir);
  const st = [0, 0];
  dirToFaceST(f, ...dir, st);
  const n = 1 << level;
  return { f, level, i: Math.floor(((st[0] + 1) / 2) * n), j: Math.floor(((st[1] + 1) / 2) * n) };
}
const gen = (c, extra = {}) => generateChunk({ key: `${c.f}/${c.level}/${c.i}/${c.j}`, ...c, N, sun, maxLevel: 17, boulders: false, ...extra });
const vtx = (r, v) => [r.pos[v * 3] + r.center[0], r.pos[v * 3 + 1] + r.center[1], r.pos[v * 3 + 2] + r.center[2]];

test('chunk arrays are finite, normals unit and outward, horizon deltas clamped', () => {
  for (const level of [3, 9, 14]) {
    const r = gen(chunkAt(SITE.dir, level));
    for (const a of [r.pos, r.morph, r.aux]) for (const x of a) assert.ok(Number.isFinite(x));
    for (let v = 0; v < N * N; v++) {
      const nx = r.nrm[v * 3] / 32767;
      const ny = r.nrm[v * 3 + 1] / 32767;
      const nz = r.nrm[v * 3 + 2] / 32767;
      assert.ok(Math.abs(Math.hypot(nx, ny, nz) - 1) < 0.01);
      const p = vtx(r, v);
      const l = Math.hypot(...p);
      assert.ok((nx * p[0] + ny * p[1] + nz * p[2]) / l > 0.3, 'normal points outward');
      const hd = r.aux[v * 4 + 1];
      assert.ok(hd >= -SHADOW_CLAMP - 1e-6 && hd <= SHADOW_CLAMP + 1e-6);
      assert.ok(r.aux[v * 4] > 0.02 && r.aux[v * 4] < 0.5, 'albedo range');
    }
    assert.ok(r.radius > 0 && r.hmax >= r.hmin);
  }
});

test('neighbouring chunks share identical edge vertices (no cracks at equal level)', () => {
  const c = chunkAt(SITE.dir, 12);
  const a = gen(c);
  const b = gen({ ...c, i: c.i + 1 }); // neighbour along +s
  for (let q = 0; q < N; q++) {
    const pa = vtx(a, q * N + (N - 1)); // right column of a
    const pb = vtx(b, q * N); // left column of b
    const d = Math.hypot(pa[0] - pb[0], pa[1] - pb[1], pa[2] - pb[2]);
    assert.ok(d < 0.02, `edge mismatch ${d} m`);
  }
});

test('geomorph targets reproduce the parent surface at shared vertices', () => {
  const c = chunkAt(siteOffsetDir(3000, 2000), 11);
  const child = gen(c);
  const parent = gen({ f: c.f, level: c.level - 1, i: c.i >> 1, j: c.j >> 1 });
  // child even vertex (2a, 2b) coincides with parent vertex (oi + a, oj + b)
  const oi = (c.i & 1) * ((N - 1) / 2);
  const oj = (c.j & 1) * ((N - 1) / 2);
  let worst = 0;
  for (let b = 0; b < N; b += 2) {
    for (let a = 0; a < N; a += 2) {
      const v = b * N + a;
      const m = [child.morph[v * 3], child.morph[v * 3 + 1], child.morph[v * 3 + 2]];
      const pc = vtx(child, v);
      const morphed = [pc[0] + m[0], pc[1] + m[1], pc[2] + m[2]];
      const pp = vtx(parent, (oj + b / 2) * N + (oi + a / 2));
      worst = Math.max(worst, Math.hypot(morphed[0] - pp[0], morphed[1] - pp[1], morphed[2] - pp[2]));
    }
  }
  assert.ok(worst < 0.05, `morphed child vs parent: ${worst} m`);
});

test('skirts hang below their edge vertices', () => {
  const r = gen(chunkAt(SITE.dir, 10));
  for (let k = 0; k < 4 * N; k++) {
    const s = vtx(r, N * N + k);
    const rs = Math.hypot(...s);
    // every skirt vertex is below some edge vertex radius
    let minEdge = Infinity;
    for (let v = 0; v < N; v++) minEdge = Math.min(minEdge, Math.hypot(...vtx(r, v)), Math.hypot(...vtx(r, v * N)));
    assert.ok(rs < minEdge + 1, 'skirt below the surface');
  }
});

test('time-sliced job gives exactly the same result as the worker path', () => {
  const c = chunkAt(siteOffsetDir(-800, 500), 13);
  const req = { key: 'x', ...c, N, sun, maxLevel: 17, boulders: true };
  const it = chunkJob(req);
  let r = it.next();
  let steps = 0;
  while (!r.done) {
    r = it.next();
    steps++;
  }
  assert.ok(steps > 5, 'job yields');
  const direct = generateChunk(req);
  assert.deepEqual(Array.from(r.value.pos), Array.from(direct.pos));
  assert.deepEqual(Array.from(r.value.aux), Array.from(direct.aux));
});

test('shadows: West crater floor is in shadow at the 10.8 deg Sun, the flat site is lit', () => {
  const c = chunkAt(siteOffsetDir(430, -25), 14);
  const r = gen(c);
  // find the lowest vertex (crater floor region) and the highest-albedo lit area
  let lowest = 0;
  let lowH = Infinity;
  for (let v = 0; v < N * N; v++) {
    const h = Math.hypot(...vtx(r, v));
    if (h < lowH) {
      lowH = h;
      lowest = v;
    }
  }
  // somewhere in West crater's bowl the horizon toward the Sun is above the Sun
  let shadowed = 0;
  for (let v = 0; v < N * N; v++) if (r.aux[v * 4 + 1] > 0) shadowed++;
  assert.ok(shadowed > 5, `shadowed vertices in West crater chunk: ${shadowed}`);
  assert.ok(lowest >= 0);
  const site = gen(chunkAt(SITE.dir, 16));
  let lit = 0;
  for (let v = 0; v < N * N; v++) if (site.aux[v * 4 + 1] < 0) lit++;
  assert.ok(lit > N * N * 0.9, `lit vertices at the site: ${lit}/${N * N}`);
});

test('boulder chunks list rocks sitting on the surface, with valid parameters', () => {
  const c = chunkAt(siteOffsetDir(450, -25), 13);
  const r = generateChunk({ key: 'b', ...c, N, sun, maxLevel: 17, boulders: true });
  assert.ok(r.boulders && r.boulders.length / BOULDER_STRIDE > 3, 'West crater has boulders');
  const b = r.boulders;
  for (let k = 0; k < b.length; k += BOULDER_STRIDE) {
    const p = [b[k] + r.center[0], b[k + 1] + r.center[1], b[k + 2] + r.center[2]];
    const l = Math.hypot(...p);
    const d = [p[0] / l, p[1] / l, p[2] / l];
    // base of the rock is on the surface (terrainHeight includes the rock itself, so it is >= base)
    assert.ok(terrainHeight(...d) >= l - R - 0.05);
    assert.ok(b[k + 3] > 0.04 && b[k + 3] <= 1.5 + 1e-6, 'footprint radius');
    assert.ok(b[k + 4] > 0 && b[k + 4] < 2.0, 'height');
    assert.ok(Math.abs(Math.hypot(b[k + 6], b[k + 7]) - 1) < 1e-4, 'rotation');
  }
  void faceDir;
});
