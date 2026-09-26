// Tests for the SKY-FX pure logic: celestial frames, star catalogue, procedural sky textures.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  earthLatLonOf,
  LANDING_MET,
  raDecToMCI,
  galToMCI,
  gmstDeg,
  jdFromMET,
  sunEclipticLonDeg,
  mciToGalacticMatrix,
  mciVecToEq,
  eqVecToMCI,
} from '../src/render/sky/celestial.js';
import { buildStarCatalog, BRIGHT_STARS, blackbodyRGB, bvToKelvin, starColor } from '../src/render/sky/starCatalog.js';
import { buildLandMask, generateMilkyWayRows } from '../src/render/sky/skyGen.js';
import { SUN_DIR, SITE_DIR, localENU } from '../src/core/frames.js';

const R2D = 180 / Math.PI;

test('GMST and solar longitude at the Apollo 11 landing', () => {
  const jd = jdFromMET(LANDING_MET);
  // 1969-07-20 20:17:40 UTC
  assert.ok(Math.abs(jd - 2440423.3456) < 1e-3, `JD ${jd}`);
  const g = gmstDeg(jd);
  assert.ok(g > 240 && g < 246, `GMST ${g}`); // ~16h11m sidereal
  const ls = sunEclipticLonDeg(jd);
  assert.ok(Math.abs(ls - 117.9) < 0.3, `Sun longitude ${ls}`); // Sun in Cancer on 20 July
});

test('the real Sun (RA/Dec of date) lies along SUN_DIR in MCI', () => {
  // 20 July 1969: RA ~7h56.6m, Dec ~+20.6 deg
  const s = raDecToMCI(7.943, 20.6);
  assert.ok(s.dot(SUN_DIR) > 0.9998, `dot ${s.dot(SUN_DIR)}`);
});

test('equatorial <-> MCI round trip', () => {
  const v = eqVecToMCI(0.3, -0.5, 0.81, new THREE.Vector3()).normalize();
  const e = mciVecToEq(v);
  const back = eqVecToMCI(e.x, e.y, e.z);
  assert.ok(back.distanceTo(v) < 1e-12);
});

test('Earth faces the Moon with the Atlantic, lit over the eastern Pacific at landing time', () => {
  const subLunar = earthLatLonOf(new THREE.Vector3(-1, 0, 0), LANDING_MET);
  assert.ok(subLunar.lat > -8 && subLunar.lat < -4, `sub-lunar lat ${subLunar.lat}`);
  assert.ok(subLunar.lon > -55 && subLunar.lon < -42, `sub-lunar lon ${subLunar.lon}`);
  const subSolar = earthLatLonOf(SUN_DIR, LANDING_MET);
  assert.ok(Math.abs(subSolar.lat - 20.5) < 1.5, `sub-solar lat ${subSolar.lat}`);
  assert.ok(subSolar.lon > -127 && subSolar.lon < -119, `sub-solar lon ${subSolar.lon}`);
  // the Earth spins eastward: one hour later the sub-solar longitude is 15 deg further west
  const later = earthLatLonOf(SUN_DIR, LANDING_MET + 3600);
  let d = later.lon - subSolar.lon;
  if (d < -180) d += 360;
  assert.ok(Math.abs(d + 15.04) < 0.2, `dlon/h ${d}`);
});

test('Earth hangs high in the western sky at Tranquility Base, ~1.9 deg across', () => {
  const { east, north, up } = localENU(SITE_DIR);
  const e = new THREE.Vector3(1, 0, 0);
  const elev = Math.asin(e.dot(up)) * R2D;
  const az = Math.atan2(e.dot(east), e.dot(north)) * R2D;
  assert.ok(elev > 60 && elev < 70, `elev ${elev}`);
  assert.ok(az < -80 && az > -100, `az ${az}`); // west
  const ang = 2 * Math.asin(6371 / 384400) * R2D;
  assert.ok(Math.abs(ang - 1.9) < 0.02);
});

test('galactic frame: centre in Sagittarius, matrix consistent with galToMCI', () => {
  const gc = galToMCI(0, 0);
  const sgr = raDecToMCI(17.7611, -28.936);
  assert.ok(gc.dot(sgr) > 0.99999, `GC dot ${gc.dot(sgr)}`);
  const m = mciToGalacticMatrix();
  const p = galToMCI(123, -31).applyMatrix3(m);
  const l = Math.atan2(p.y, p.x) * R2D;
  const b = Math.asin(p.z) * R2D;
  assert.ok(Math.abs(l - 123) < 1e-6 && Math.abs(b + 31) < 1e-6, `${l} ${b}`);
});

test('star catalogue: size, brightest star, magnitude distribution', () => {
  const cat = buildStarCatalog({ count: 9000 });
  assert.equal(cat.count, 9000);
  assert.ok(Math.abs(cat.mag[0] + 1.46) < 1e-6, 'Sirius is the brightest');
  // sorted and within limits
  for (let i = 1; i < cat.count; i++) assert.ok(cat.mag[i] >= cat.mag[i - 1]);
  assert.ok(cat.mag[cat.count - 1] <= 7.5);
  // counts per magnitude grow ~x3 per magnitude (log N ~ 0.49 m) in the procedural range
  const n = (m) => cat.mag.filter((x) => x < m).length;
  const r1 = n(5.5) / n(4.5);
  const r2 = n(6.5) / n(5.5);
  assert.ok(r1 > 2.3 && r1 < 3.8, `N(<5.5)/N(<4.5) = ${r1}`);
  assert.ok(r2 > 2.3 && r2 < 3.8, `N(<6.5)/N(<5.5) = ${r2}`);
  assert.ok(n(1.5) >= 20 && n(1.5) <= 24, `N(<1.5) = ${n(1.5)}`);
  // unit directions
  for (let i = 0; i < cat.count; i += 97) {
    const l = Math.hypot(cat.dir[i * 3], cat.dir[i * 3 + 1], cat.dir[i * 3 + 2]);
    assert.ok(Math.abs(l - 1) < 1e-5);
  }
  // deterministic
  const cat2 = buildStarCatalog({ count: 9000 });
  assert.deepEqual(Array.from(cat2.dir.slice(0, 300)), Array.from(cat.dir.slice(0, 300)));
});

test('faint stars concentrate toward the galactic plane', () => {
  const cat = buildStarCatalog({ count: 9000 });
  const m = mciToGalacticMatrix();
  const v = new THREE.Vector3();
  let low = 0;
  let faint = 0;
  for (let i = 0; i < cat.count; i++) {
    if (cat.mag[i] < 5.5) continue;
    faint++;
    v.fromArray(cat.dir, i * 3).applyMatrix3(m);
    if (Math.abs(Math.asin(v.z)) < (20 * Math.PI) / 180) low++;
  }
  // an isotropic sky has sin(20 deg) = 34 % within |b| < 20 deg
  assert.ok(low / faint > 0.42, `fraction near the plane ${low / faint}`);
});

test('star colours: hot stars blue-white, cool stars orange; unit luminance', () => {
  assert.ok(Math.abs(bvToKelvin(0.65) - 5800) < 250);
  const hot = starColor(-0.2);
  const cool = starColor(1.6);
  assert.ok(hot[2] > hot[0], 'B star is bluer than red');
  assert.ok(cool[0] > cool[2] * 1.5, 'M star is red');
  for (const c of [hot, cool, starColor(0.6)]) {
    const Y = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    assert.ok(Math.abs(Y - 1) < 1e-6);
  }
  const sun = blackbodyRGB(5778);
  assert.ok(sun[0] > sun[2] && sun[2] > 0.6 * sun[0], 'the Sun is nearly white, slightly warm');
  assert.ok(BRIGHT_STARS.length > 140);
});

test('Earth land mask: continents where they belong', () => {
  const W = 720;
  const H = 360;
  const m = buildLandMask(W, H);
  const at = (lat, lon) => m[Math.floor(((90 - lat) / 180) * H) * W + Math.floor(((lon + 180) / 360) * W)];
  // land
  for (const [lat, lon, name] of [[23, 10, 'Sahara'], [-10, -55, 'Amazon'], [45, 100, 'Mongolia'], [-25, 134, 'Australia'], [40, -100, 'Great Plains'], [72, -40, 'Greenland'], [-80, 0, 'Antarctica'], [50, 10, 'Germany'], [20, 78, 'India'], [-20, 47, 'Madagascar']]) {
    assert.equal(at(lat, lon), 1, `${name} should be land`);
  }
  // water
  for (const [lat, lon, name] of [[0, -150, 'Pacific'], [30, -40, 'Atlantic'], [-30, 80, 'Indian Ocean'], [35, 18, 'Mediterranean'], [43, 35, 'Black Sea'], [60, -85, 'Hudson Bay'], [42, 50.5, 'Caspian'], [15, 60, 'Arabian Sea'], [-50, -30, 'South Atlantic']]) {
    assert.equal(at(lat, lon), 0, `${name} should be water`);
  }
  let land = 0;
  for (let y = 0; y < H; y++) {
    const w = Math.cos((((y + 0.5) / H) * 180 - 90) * (Math.PI / 180));
    for (let x = 0; x < W; x++) land += m[y * W + x] * w;
  }
  let tot = 0;
  for (let y = 0; y < H; y++) tot += Math.cos((((y + 0.5) / H) * 180 - 90) * (Math.PI / 180)) * W;
  const f = land / tot;
  assert.ok(f > 0.25 && f < 0.34, `land fraction ${f} (Earth: 0.29)`);
});

test('Milky Way texture: bright centre, dark poles', () => {
  const W = 128;
  const H = 64;
  const out = new Uint8Array(W * H * 4);
  generateMilkyWayRows(W, H, 0, H, out);
  const px = (l, b) => {
    const x = Math.floor(((l + 180) / 360) * W);
    const y = Math.floor(((90 - b) / 180) * H);
    return out[(y * W + x) * 4 + 1];
  };
  assert.ok(px(0, -5) > 3 * px(0, 80), `centre ${px(0, -5)} vs pole ${px(0, 80)}`);
  assert.ok(px(10, -3) > px(170, -3), 'centre brighter than anticentre');
});
