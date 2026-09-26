// Tests for the procedural Moon (src/world/moon.js): determinism, continuity, the landing site,
// West crater, boulders, normals and performance.   Run: node --test test/moon.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  terrainHeight,
  terrainHeightLOD,
  surfaceRadius,
  surfaceNormal,
  albedo,
  mareMask,
  evalSurface,
  createSample,
  siteOffsetDir,
  SITE,
  enumerateBoulders,
  boulderProfile,
  BOULDER_OCTAVES,
  BOULDER_MAX_SIZE,
} from '../src/world/moon.js';
import { MOON } from '../src/core/constants.js';

const R = MOON.radius;
const DEG = 180 / Math.PI;

// deterministic pseudo-random directions
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x9e3779b9) >>> 0;
    return s / 4294967296;
  };
}
function randomDir(r) {
  const z = r() * 2 - 1;
  const a = r() * Math.PI * 2;
  const c = Math.sqrt(1 - z * z);
  return [c * Math.cos(a), c * Math.sin(a), z];
}
// offset a unit direction by (de, dn) metres in its local tangent plane
function offset(d, de, dn) {
  let ex = -d[1];
  let ey = d[0];
  const el = Math.hypot(ex, ey) || 1;
  ex /= el;
  ey /= el;
  const nx = -d[2] * ey;
  const ny = d[2] * ex;
  const nz = d[0] * ey - d[1] * ex;
  const x = d[0] * R + ex * de + nx * dn;
  const y = d[1] * R + ey * de + ny * dn;
  const z = d[2] * R + nz * dn;
  const l = Math.hypot(x, y, z);
  return [x / l, y / l, z / l];
}

test('deterministic: identical inputs give identical outputs', () => {
  const r = rng(1);
  const a = createSample();
  const b = createSample();
  for (let i = 0; i < 300; i++) {
    const d = randomDir(r);
    const h1 = terrainHeight(...d);
    // interleave other evaluations to catch hidden state
    albedo(...randomDir(r));
    terrainHeightLOD(...randomDir(r), 500);
    const h2 = terrainHeight(...d);
    assert.equal(h1, h2);
    evalSurface(...d, 0, 1, a);
    evalSurface(...d, 0, 1, b);
    assert.equal(a.albedo, b.albedo);
    assert.equal(a.h, b.h);
  }
});

test('heights are finite and within lunar range; surfaceRadius is consistent', () => {
  const r = rng(2);
  let mn = Infinity;
  let mx = -Infinity;
  for (let i = 0; i < 3000; i++) {
    const d = randomDir(r);
    const h = terrainHeight(...d);
    assert.ok(Number.isFinite(h));
    mn = Math.min(mn, h);
    mx = Math.max(mx, h);
    if (i < 50) assert.equal(surfaceRadius(...d), R + h);
  }
  // real Moon: about -9.1 km .. +10.8 km relative to 1737.4 km
  assert.ok(mn > -12000 && mn < -2000, `min ${mn}`);
  assert.ok(mx < 11000 && mx > 1000, `max ${mx}`);
});

test('continuity: no cliffs between neighbouring samples (features >= 3 m, i.e. excluding boulders)', () => {
  const r = rng(3);
  let worst = 0;
  const step = 0.25; // m
  for (let i = 0; i < 4000; i++) {
    // half near the landing site region (dense small craters), half global
    const d = i % 2 ? randomDir(r) : siteOffsetDir((r() - 0.5) * 40000, (r() - 0.5) * 40000);
    const ang = r() * Math.PI * 2;
    const e = offset(d, Math.cos(ang) * step, Math.sin(ang) * step);
    const dh = Math.abs(terrainHeightLOD(...d, BOULDER_MAX_SIZE) - terrainHeightLOD(...e, BOULDER_MAX_SIZE));
    worst = Math.max(worst, dh / step);
  }
  // steepest natural slopes: fresh crater walls (~35-45 deg) and terraced scarps; a cliff would be >> 2
  assert.ok(worst < 2.0, `max gradient ${worst.toFixed(3)} (${(Math.atan(worst) * DEG).toFixed(1)} deg)`);
});

test('continuity across mare shorelines (existence weights are smooth)', () => {
  // walk a line across the Tranquillitatis shore south of the site in 20 m steps
  let prev = null;
  let worst = 0;
  for (let n = -300000; n <= -50000; n += 20) {
    const d = siteOffsetDir(20000, n);
    const h = terrainHeightLOD(...d, 30);
    if (prev !== null) worst = Math.max(worst, Math.abs(h - prev) / 20);
    prev = h;
  }
  assert.ok(worst < 1.5, `max gradient ${worst.toFixed(3)}`);
});

test('landing site: smooth dark mare, slope < 5 deg within 30 m', () => {
  assert.ok(mareMask(...SITE.dir) > 0.99, 'site is in mare');
  assert.ok(albedo(...SITE.dir) < 0.1, `site albedo ${albedo(...SITE.dir)}`);
  const up = SITE.dir;
  const n = { x: 0, y: 0, z: 0 };
  let worst = 0;
  for (let e = -30; e <= 30; e += 2) {
    for (let k = -30; k <= 30; k += 2) {
      if (e * e + k * k > 900) continue;
      const d = siteOffsetDir(e, k);
      surfaceNormal(...d, n);
      const c = n.x * d[0] + n.y * d[1] + n.z * d[2];
      worst = Math.max(worst, Math.acos(Math.min(1, c)) * DEG);
    }
  }
  assert.ok(worst < 5, `max slope within 30 m: ${worst.toFixed(2)} deg`);
  // the exact site
  surfaceNormal(...up, n);
  const c0 = Math.acos(n.x * up[0] + n.y * up[1] + n.z * up[2]) * DEG;
  assert.ok(c0 < 3, `slope at the site ${c0.toFixed(2)} deg`);
  // site elevation near the real Tranquility Base value (~ -1.9 km)
  const h = terrainHeight(...up);
  assert.ok(h < -1500 && h > -2400, `site height ${h}`);
});

test('West crater: ~190 m, fresh, about 450 m uprange (east) of the site', () => {
  const rim = terrainHeight(...siteOffsetDir(450 - 100, -25));
  const floor = terrainHeight(...siteOffsetDir(450, -25));
  const site = terrainHeight(...SITE.dir);
  assert.ok(rim - floor > 25, `depth ${rim - floor}`);
  assert.ok(site - floor > 20);
  // bright fresh ejecta
  assert.ok(albedo(...siteOffsetDir(450 + 115, -25)) > albedo(...siteOffsetDir(0, 0)));
});

test('surfaceNormal: unit length, points outward', () => {
  const r = rng(4);
  const n = { x: 0, y: 0, z: 0 };
  for (let i = 0; i < 200; i++) {
    const d = randomDir(r);
    surfaceNormal(...d, n);
    assert.ok(Math.abs(Math.hypot(n.x, n.y, n.z) - 1) < 1e-9);
    assert.ok(n.x * d[0] + n.y * d[1] + n.z * d[2] > 0.3);
  }
});

test('terrainHeightLOD: coarse versions stay close to full detail at large scale', () => {
  const r = rng(5);
  for (let i = 0; i < 200; i++) {
    const d = randomDir(r);
    const full = terrainHeightLOD(...d, 0);
    const coarse = terrainHeightLOD(...d, 1000);
    // features < 1-2 km dropped: at most a few hundred metres of difference (a 2 km crater is ~400 m deep)
    assert.ok(Math.abs(full - coarse) < 900, `${full} vs ${coarse}`);
  }
});

test('boulders are collidable where they are rendered, and none lie within 30 m of the site', () => {
  // boulder-rich area: the rim of West crater
  const samples = [];
  for (let e = 300; e <= 600; e += 2.5) for (let k = -170; k <= 120; k += 2.5) samples.push(...siteOffsetDir(e, k));
  const found = [];
  enumerateBoulders(1, Float64Array.from(samples), () => true, (b) => found.push({ ...b }));
  assert.ok(found.length > 20, `boulders found near West crater: ${found.length}`);
  const s = createSample();
  let checked = 0;
  for (const b of found.slice(0, 40)) {
    // top of the rock = base surface + H * profile(0)
    evalSurface(b.x, b.y, b.z, 0, 0, s);
    const base = s.h;
    const top = terrainHeight(b.x, b.y, b.z);
    const expect = b.H * boulderProfile(b.vi, 0, 1, 0);
    assert.ok(Math.abs(top - base - expect) < 0.02 + 0.02 * b.H, `rock top ${top - base} vs ${expect}`);
    assert.ok(2 * b.r <= BOULDER_OCTAVES[1].maxSize + 1e-9);
    checked++;
  }
  assert.ok(checked > 0);
  // keep-out disc: no boulder (any size) centred within 30 m of the site
  const near = [];
  for (let e = -45; e <= 45; e += 1) for (let k = -45; k <= 45; k += 1) near.push(...siteOffsetDir(e, k));
  for (let oi = 0; oi < BOULDER_OCTAVES.length; oi++) {
    enumerateBoulders(oi, Float64Array.from(near), () => true, (b) => {
      const dx = (b.x - SITE.dir[0]) * R;
      const dy = (b.y - SITE.dir[1]) * R;
      const dz = (b.z - SITE.dir[2]) * R;
      assert.ok(Math.hypot(dx, dy, dz) > 30, 'boulder inside the site keep-out');
    });
  }
});

test('performance: terrainHeight full detail', () => {
  const r = rng(6);
  const N = 60000;
  const dirs = new Float64Array(N * 3);
  for (let i = 0; i < N; i++) dirs.set(i % 2 ? randomDir(r) : siteOffsetDir((r() - 0.5) * 20000, (r() - 0.5) * 20000), i * 3);
  let acc = 0;
  for (let i = 0; i < 5000; i++) acc += terrainHeight(dirs[i * 3], dirs[i * 3 + 1], dirs[i * 3 + 2]); // warm-up
  const t0 = performance.now();
  for (let i = 0; i < N; i++) acc += terrainHeight(dirs[i * 3], dirs[i * 3 + 1], dirs[i * 3 + 2]);
  const us = ((performance.now() - t0) * 1000) / N;
  console.log(`terrainHeight: ${us.toFixed(2)} us/call (goal ~3 us on a desktop CPU)`);
  assert.ok(Number.isFinite(acc));
  // generous bound so the test is robust on slow/shared CI machines
  assert.ok(us < 20, `${us} us/call`);
});

test('mare surfaces carry long wrinkle ridges (dorsa), but not at the landing site', () => {
  // E-W traverses across northern Mare Tranquillitatis / Serenitatis: a ridge is a 100+ m rise above the
  // local plain that is only a few km wide
  const D2R = Math.PI / 180;
  const dirLL = (la, lo) => [Math.cos(la * D2R) * Math.cos(lo * D2R), Math.cos(la * D2R) * Math.sin(lo * D2R), Math.sin(la * D2R)];
  let ridges = 0;
  for (let lat = 4; lat <= 26; lat += 2) {
    const hs = [];
    for (let lon = 20; lon <= 36; lon += 0.02) {
      const d = dirLL(lat, lon);
      if (mareMask(...d) < 0.99) {
        hs.push(NaN);
        continue;
      }
      hs.push(terrainHeightLOD(...d, 600));
    }
    // local prominence against the plain 12 km (~0.4 deg) to either side
    for (let i = 20; i < hs.length - 20; i++) {
      const p = hs[i] - 0.5 * (hs[i - 20] + hs[i + 20]);
      if (p > 100) {
        ridges++;
        i += 40;
      }
    }
  }
  assert.ok(ridges >= 3, `ridge crossings found: ${ridges}`);
});
