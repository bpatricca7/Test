// Procedural Moon: pure, deterministic functions of a unit MCI direction.
//
// Owned by the TERRAIN agent. Shared by physics (collision, altitude), guidance (radar), terrain
// rendering (main thread AND Web Workers) and rocks. NO three.js scene access, NO DOM.
//
// Contract (ARCHITECTURE.md §Terrain):
//   terrainHeight(x, y, z)              metres above MOON.radius at unit direction (x,y,z), full detail
//                                       (craters + collidable boulders — everything physics hits)
//   terrainHeightLOD(x, y, z, minSize)  same, skipping features smaller than minSize metres
//   surfaceRadius(x, y, z)              MOON.radius + terrainHeight
//   surfaceNormal(x, y, z, out)         unit MCI surface normal (full detail)
//   albedo(x, y, z)                     normal albedo 0..1 (mature mare ~0.07, highlands ~0.15, fresh ejecta more)
//
// How the surface is built (all in one pass, see evalSurface):
//   1. Global shape: far-side highland bulge, South Pole–Aitken basin, highland relief (gradient noise).
//   2. Maria: dark, smooth, low basalt plains at the real near-side positions. Each basin is a spherical
//      cap whose shore is warped by noise down to ~2 km (fractal embayments, highland islands); long,
//      sinuous wrinkle ridges (dorsa) on the mare surface; raised, rugged basin rims (Montes Apenninus,
//      Haemus, ...).
//   3. Named craters (Theophilus, Copernicus, Tycho, Maskelyne, Moltke, West crater ...) with real
//      positions/diameters, ray systems for the young ones.
//   4. Random craters from 150 km down to ~1.7 m in hash cells ("octaves" shrinking 2.4x in size;
//      the saturated highlands get extra candidate layers for the large octaves). Candidate points live
//      in a 3D grid; a crater exists where the ball of radius rho around the candidate intersects the
//      sphere, which gives seamless placement everywhere on the sphere without any cube-face seams, a
//      natural spread of sizes, and an 8-cell lookup per octave. Size-frequency is N(>D) ~ D^-2 (lunar
//      equilibrium), with far fewer large craters on the maria (they post-date the basalt).
//      Morphology: simple bowls (depth ~0.2 D, rim ~0.04 D, ejecta ~r^-3) below 15 km, complex craters
//      (flat floor, terraced walls, central peak, Pike depth/diameter laws) above; slightly irregular
//      outlines; freshness 0..1 blends from sharp young craters (bright ejecta, boulders) to softened,
//      shallow old ones (most craters are old).
//   5. Boulders (0.2–3 m) — COLLIDABLE: they are part of terrainHeight, so a footpad landing on one
//      tilts the LM. They are scattered thinly everywhere and densely around the rims of fresh craters
//      that punched through the regolith. The rock renderer draws each boulder with exactly the
//      same footprint/profile (see boulderProfile / enumerateBoulders).
//   6. Tranquility Base: a 30 m keep-out disc around LANDING_SITE (no crater or boulder reaches it) so
//      the target is flat, plus the historical West crater (~190 m, fresh, boulder field) ~450 m
//      uprange (east) and Little West (33 m) 60 m east.

import { MOON, LANDING_SITE } from '../core/constants.js';

const R = MOON.radius;
const D2R = Math.PI / 180;
const INV_2_16 = 1 / 65536;
const INV_2_10 = 1 / 1024;

// ------------------------------------------------------------------------------------ hashing
/** 32-bit integer hash of three integer cell coordinates and a seed (deterministic, well mixed). */
function hash3(ix, iy, iz, seed) {
  let h = cmix(cmix(cmix(Math.imul(ix, 0x9e3779b1) ^ seed) ^ Math.imul(iy, 0x85ebca6b)) ^ Math.imul(iz, 0xc2b2ae35));
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return (h ^ (h >>> 15)) >>> 0;
}
/** One multiply-xorshift mixing step (used to chain cell coordinates into a hash). */
function cmix(h) {
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  return h ^ (h >>> 15);
}
/** Re-mix a hash to get the next independent 32 random bits. */
function remix(h) {
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return (h ^ (h >>> 16)) >>> 0;
}

// ------------------------------------------------------------------------------------ gradient noise
// Improved-Perlin style 3D gradient noise with a fixed permutation table (deterministic).
const PERM = new Uint8Array(512);
(() => {
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  let s = 0x9e3779b9;
  for (let i = 255; i > 0; i--) {
    s = remix(s + i);
    const j = s % (i + 1);
    const t = p[i];
    p[i] = p[j];
    p[j] = t;
  }
  for (let i = 0; i < 512; i++) PERM[i] = p[i & 255];
})();
// 16 gradient directions (12 cube edges + 4 repeats), stored as components
const GX = new Float64Array([1, -1, 1, -1, 1, -1, 1, -1, 0, 0, 0, 0, 1, 0, -1, 0]);
const GY = new Float64Array([1, 1, -1, -1, 0, 0, 0, 0, 1, -1, 1, -1, 1, -1, 1, -1]);
const GZ = new Float64Array([0, 0, 0, 0, 1, 1, -1, -1, 1, 1, -1, -1, 0, 1, 0, -1]);

/** 3D gradient noise, roughly in [-1, 1]. */
export function noise3(x, y, z) {
  const fx = Math.floor(x);
  const fy = Math.floor(y);
  const fz = Math.floor(z);
  const X = fx & 255;
  const Y = fy & 255;
  const Z = fz & 255;
  x -= fx;
  y -= fy;
  z -= fz;
  const u = x * x * x * (x * (x * 6 - 15) + 10);
  const v = y * y * y * (y * (y * 6 - 15) + 10);
  const w = z * z * z * (z * (z * 6 - 15) + 10);
  const A = PERM[X] + Y;
  const AA = PERM[A] + Z;
  const AB = PERM[A + 1] + Z;
  const B = PERM[X + 1] + Y;
  const BA = PERM[B] + Z;
  const BB = PERM[B + 1] + Z;
  let g = PERM[AA] & 15;
  const n000 = GX[g] * x + GY[g] * y + GZ[g] * z;
  g = PERM[BA] & 15;
  const n100 = GX[g] * (x - 1) + GY[g] * y + GZ[g] * z;
  g = PERM[AB] & 15;
  const n010 = GX[g] * x + GY[g] * (y - 1) + GZ[g] * z;
  g = PERM[BB] & 15;
  const n110 = GX[g] * (x - 1) + GY[g] * (y - 1) + GZ[g] * z;
  g = PERM[AA + 1] & 15;
  const n001 = GX[g] * x + GY[g] * y + GZ[g] * (z - 1);
  g = PERM[BA + 1] & 15;
  const n101 = GX[g] * (x - 1) + GY[g] * y + GZ[g] * (z - 1);
  g = PERM[AB + 1] & 15;
  const n011 = GX[g] * x + GY[g] * (y - 1) + GZ[g] * (z - 1);
  g = PERM[BB + 1] & 15;
  const n111 = GX[g] * (x - 1) + GY[g] * (y - 1) + GZ[g] * (z - 1);
  const x00 = n000 + u * (n100 - n000);
  const x10 = n010 + u * (n110 - n010);
  const x01 = n001 + u * (n101 - n001);
  const x11 = n011 + u * (n111 - n011);
  const y0 = x00 + v * (x10 - x00);
  const y1 = x01 + v * (x11 - x01);
  return y0 + w * (y1 - y0);
}

const smooth01 = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

// ------------------------------------------------------------------------------------ geography
function dirLL(latDeg, lonDeg) {
  const la = latDeg * D2R;
  const lo = lonDeg * D2R;
  const c = Math.cos(la);
  return [c * Math.cos(lo), c * Math.sin(lo), Math.sin(la)];
}

/** Landing site unit direction and local east/north unit vectors (plain arrays). */
export const SITE = (() => {
  const d = dirLL(LANDING_SITE.latDeg, LANDING_SITE.lonDeg);
  let ex = -d[1];
  let ey = d[0];
  const el = Math.hypot(ex, ey);
  ex /= el;
  ey /= el;
  const east = [ex, ey, 0];
  const north = [d[1] * 0 - d[2] * ey, d[2] * ex - d[0] * 0, d[0] * ey - d[1] * ex];
  return { dir: d, east, north };
})();
/** Unit direction at `eastM`/`northM` metres from the landing site (tangent-plane offset). */
export function siteOffsetDir(eastM, northM) {
  const s = SITE;
  const x = s.dir[0] * R + s.east[0] * eastM + s.north[0] * northM;
  const y = s.dir[1] * R + s.east[1] * eastM + s.north[1] * northM;
  const z = s.dir[2] * R + s.east[2] * eastM + s.north[2] * northM;
  const l = Math.hypot(x, y, z);
  return [x / l, y / l, z / l];
}
const SITE_KEEPOUT = 30; // m: no crater or boulder reaches inside this radius around the landing site
const SITE_P = [SITE.dir[0] * R, SITE.dir[1] * R, SITE.dir[2] * R];

// Mare basins: [lat, lon, radius km, floor height m (rel. MOON.radius), shore warp km]
// Near-side positions/sizes approximately as mapped (Irregular shapes use several caps.)
const MARIA_DEF = [
  // Tranquillitatis (irregular; several caps). The site (0.67N 23.47E) lies in its SW part.
  [8.0, 31.0, 270, -1900, 40],
  [15.0, 28.0, 150, -1850, 35],
  [2.5, 26.5, 170, -1920, 25],
  [1.0, 23.6, 95, -1920, 6],
  [-4.0, 25.8, 95, -1850, 25], // Sinus Asperitatis
  [5.0, 38.0, 190, -1900, 40],
  [12.0, 40.0, 140, -1850, 35],
  [0.5, 43.5, 110, -1900, 30],
  [19.0, 26.0, 90, -2000, 25], // toward Serenitatis
  [22.0, 34.0, 110, -1800, 35], // Palus Somni / Lacus Somniorum
  // Serenitatis
  [28.0, 17.5, 310, -2800, 35],
  [32.0, 23.0, 170, -2700, 30],
  // Crisium (E-W elongated)
  [17.0, 56.0, 195, -3500, 25],
  [17.0, 62.0, 190, -3500, 25],
  // Fecunditatis
  [-4.0, 51.0, 210, -1900, 45],
  [-12.0, 53.0, 170, -1900, 40],
  [2.0, 52.0, 120, -1900, 35],
  [-18.0, 49.5, 100, -1950, 30],
  // Nectaris
  [-15.2, 35.5, 155, -2400, 20],
  // Imbrium
  [34.0, -17.0, 500, -2600, 45],
  [42.0, -25.0, 320, -2500, 40],
  [26.0, -7.0, 230, -2500, 35],
  // Procellarum (vast, irregular)
  [10.0, -50.0, 430, -1800, 70],
  [28.0, -56.0, 390, -1700, 70],
  [-3.0, -42.0, 320, -1700, 60],
  [42.0, -45.0, 270, -1600, 55],
  [17.0, -66.0, 250, -1600, 55],
  [-1.0, -58.0, 230, -1700, 50],
  [-9.0, -34.0, 190, -1700, 40],
  [-10.0, -23.0, 180, -1500, 40], // Cognitum
  [7.5, -30.9, 220, -1600, 45], // Insularum
  [6.0, -18.5, 190, -1600, 40], // Insularum (east, around Copernicus)
  [13.5, -27.0, 150, -1700, 35], // between Kepler/Copernicus and Imbrium
  [-21.0, -17.0, 290, -2200, 50], // Nubium
  [-16.0, -9.0, 140, -2100, 35],
  [-24.4, -38.6, 185, -2800, 25], // Humorum
  [13.3, 3.6, 115, -1500, 30], // Vaporum
  [2.4, 1.7, 130, -1500, 35], // Sinus Medii
  [10.9, -8.8, 150, -1600, 35], // Sinus Aestuum
  [44.0, 27.0, 85, -1700, 25], // Lacus Somniorum (N)
  [13.3, 86.1, 150, -1800, 40], // Marginis
  [1.3, 87.5, 160, -2500, 30], // Smythii
  [6.8, 68.4, 90, -1800, 35], // Undarum
  [1.1, 65.1, 65, -1800, 25], // Spumans
  [-38.9, 93.0, 150, -1800, 60], // Australe (patchy)
  [-19.4, -92.8, 140, -2800, 20], // Orientale (inner)
  [27.3, 147.9, 130, -3200, 20], // Moscoviense (far side)
  [-33.7, 163.5, 110, -2200, 40], // Ingenii (far side, patchy)
];
const NMARE = MARIA_DEF.length;
const MARE_X = new Float64Array(NMARE);
const MARE_Y = new Float64Array(NMARE);
const MARE_Z = new Float64Array(NMARE);
const MARE_COSR = new Float64Array(NMARE); // cos(radius + warp margin) for early rejection
const MARE_R = new Float64Array(NMARE); // radius (rad)
const MARE_W = new Float64Array(NMARE); // shore warp (rad)
const MARE_H = new Float64Array(NMARE);
MARIA_DEF.forEach((m, i) => {
  const d = dirLL(m[0], m[1]);
  MARE_X[i] = d[0];
  MARE_Y[i] = d[1];
  MARE_Z[i] = d[2];
  MARE_R[i] = (m[2] * 1000) / R;
  MARE_W[i] = (m[4] * 1000) / R;
  MARE_COSR[i] = Math.cos(Math.min(Math.PI, MARE_R[i] * 1.4 + MARE_W[i] * 1.9 + 0.005));
  MARE_H[i] = m[3];
});

// Multi-ring basins: raised, rugged rim massifs (and broad basin depressions).
// [lat, lon, ring radius km, ring amplitude m, ring width km, depression depth m]
const BASINS_DEF = [
  [32.8, -15.6, 600, 2600, 90, 1200], // Imbrium: Montes Apenninus / Carpatus / Caucasus / Alpes
  [28.0, 17.5, 350, 1700, 60, 900], // Serenitatis: Montes Haemus
  [17.0, 59.1, 300, 2200, 55, 800], // Crisium
  [-15.2, 35.5, 430, 1500, 50, 700], // Nectaris: Rupes Altai
  [-24.4, -38.6, 220, 1300, 45, 600], // Humorum
  [-19.4, -92.8, 465, 2800, 60, 1600], // Orientale: Montes Cordillera
  [-19.4, -92.8, 310, 1800, 40, 0], // Orientale: Montes Rook
  [-53.0, -169.0, 1100, 2500, 250, 5500], // South Pole–Aitken
];
const BASINS = BASINS_DEF.map((b) => {
  const d = dirLL(b[0], b[1]);
  return {
    x: d[0], y: d[1], z: d[2],
    ring: (b[2] * 1000) / R,
    amp: b[3],
    width: (b[4] * 1000) / R,
    depth: b[5],
    cosMax: Math.cos(Math.min(Math.PI, ((b[2] + 3 * b[4]) * 1000) / R)),
  };
});

// ------------------------------------------------------------------------------------ craters
// Named craters: [name, lat, lon, D km, freshness 0..1, rays 0..1, flooded 0..1]
const NAMED_DEF = [
  // Apollo 11 approach & Mare Tranquillitatis
  ['Maskelyne', 2.2, 30.08, 23, 0.8, 0.15, 0],
  ['Moltke', -0.58, 24.16, 6.5, 0.95, 0.35, 0],
  ['Sabine', 1.4, 20.1, 30, 0.35, 0, 0.45],
  ['Ritter', 2.0, 19.2, 29, 0.35, 0, 0.45],
  ['Arago', 6.2, 21.4, 26, 0.6, 0, 0],
  ['Censorinus', -0.4, 32.7, 3.8, 1.0, 0.6, 0],
  ['Dionysius', 2.8, 17.3, 18, 0.85, 0.5, 0],
  ['Manners', 4.6, 20.0, 15, 0.7, 0.1, 0],
  ['Schmidt', 1.0, 18.8, 11, 0.8, 0.1, 0],
  ['Delambre', -1.9, 17.5, 51, 0.4, 0, 0],
  ['Theon Senior', -0.8, 15.4, 18, 0.7, 0, 0],
  ['Theon Junior', -2.4, 15.8, 18, 0.7, 0, 0],
  ['Torricelli', -4.6, 28.5, 22, 0.5, 0, 0],
  ['Hypatia', -4.3, 22.6, 40, 0.3, 0, 0],
  ['Jansen', 13.5, 28.7, 23, 0.15, 0, 0.7],
  ['Plinius', 15.4, 23.7, 43, 0.75, 0, 0],
  ['Vitruvius', 17.6, 31.3, 29, 0.5, 0, 0],
  ['Cauchy', 9.6, 38.6, 12, 0.9, 0.2, 0],
  ['Taruntius', 5.6, 46.5, 56, 0.6, 0.1, 0.3],
  ['Secchi', 2.4, 43.5, 24, 0.4, 0, 0],
  ['Messier', -1.9, 47.6, 11, 1.0, 0.6, 0],
  ['Messier A', -2.0, 47.0, 13, 1.0, 0.8, 0],
  ['Langrenus', -8.9, 61.1, 132, 0.8, 0.3, 0],
  ['Petavius', -25.3, 60.4, 177, 0.55, 0, 0],
  ['Theophilus', -11.4, 26.4, 100, 0.85, 0.05, 0],
  ['Cyrillus', -13.2, 24.0, 98, 0.4, 0, 0],
  ['Catharina', -18.1, 23.4, 100, 0.3, 0, 0],
  ['Fracastorius', -21.5, 33.2, 124, 0.15, 0, 0.8],
  ['Posidonius', 31.8, 29.9, 95, 0.3, 0, 0.5],
  ['Proclus', 16.1, 46.8, 28, 1.0, 1.0, 0],
  ['Menelaus', 16.3, 16.0, 26, 0.9, 0.3, 0],
  ['Manilius', 14.5, 9.1, 38, 0.8, 0.2, 0],
  ['Eratosthenes', 14.5, -11.3, 58, 0.7, 0, 0],
  ['Copernicus', 9.6, -20.1, 93, 1.0, 1.0, 0],
  ['Kepler', 8.1, -38.0, 31, 1.0, 1.0, 0],
  ['Aristarchus', 23.7, -47.4, 40, 1.0, 1.0, 0],
  ['Tycho', -43.3, -11.4, 86, 1.0, 1.0, 0],
  ['Plato', 51.6, -9.4, 101, 0.2, 0, 1.0],
  ['Archimedes', 29.7, -4.0, 81, 0.25, 0, 1.0],
  ['Ptolemaeus', -9.3, -1.9, 154, 0.15, 0, 0.8],
  ['Alphonsus', -13.4, -2.8, 108, 0.3, 0, 0.3],
  ['Arzachel', -18.2, -1.9, 97, 0.6, 0, 0],
  ['Clavius', -58.4, -14.4, 225, 0.3, 0, 0],
  ['Grimaldi', -5.5, -68.3, 172, 0.15, 0, 1.0],
  ['Gassendi', -17.6, -40.1, 110, 0.4, 0, 0.3],
  ['Bullialdus', -20.7, -22.2, 61, 0.8, 0.1, 0],
  ['Stevinus', -32.5, 54.2, 74, 0.9, 0.6, 0],
  ['Tsiolkovskiy', -20.4, 129.1, 185, 0.6, 0, 0.9],
  ['Giordano Bruno', 36.0, 102.9, 22, 1.0, 1.0, 0],
  ['Daedalus', -5.9, 179.4, 93, 0.5, 0, 0],
  ['Korolev', -4.4, -157.4, 437, 0.2, 0, 0],
  ['Hertzsprung', 2.6, -128.7, 570, 0.2, 0, 0],
  ['Apollo', -36.1, -151.8, 537, 0.2, 0, 0.2],
];
// Historic features at Tranquility Base (positions as metres east/north of LANDING_SITE).
// West crater: ~190 m, fresh, with a boulder field — the hazard the P64 auto-targeting was heading into.
// Little West: ~33 m, 60 m east of the LM (Armstrong's EVA excursion).
const LOCAL_DEF = [
  ['West', 450, -25, 0.19, 1.0, 0.25, 0],
  ['Little West', 60, 0, 0.033, 0.8, 0, 0],
];

// Crater parameter record (plain object, precomputed)
function makeCrater(dx, dy, dz, D, fresh, rays, flooded, seed) {
  const a = D / 2;
  const c = { x: dx, y: dy, z: dz, D, a, fresh, rays, flooded, seed, local: 0, complex: 0, dep: 0, rim: 0, floorT: 0, peak: 0, terraces: 3, cosInf: 0, cosGeo: 0 };
  craterShape(c, seed);
  c.cosInf = Math.cos(Math.min(Math.PI, (a * (rays > 0 ? 9.2 : 1.9)) / R));
  c.cosGeo = Math.cos(Math.min(Math.PI, (a * 1.9) / R));
  return c;
}
/** Depth/rim/floor/peak parameters from diameter & freshness (Pike 1977 laws for complex craters). */
function craterShape(c, h) {
  const D = c.D;
  const f = c.fresh;
  const Dk = D / 1000;
  if (D < 15000) {
    // simple bowl: d/D 0.2 fresh .. ~0.07 degraded; rim 0.04 D
    c.complex = 0;
    c.dep = D * 0.19 * (0.35 + 0.65 * f);
    c.rim = D * 0.036 * (0.3 + 0.7 * f);
    c.floorT = 0;
    c.peak = 0;
    // small craters: a slightly flat floor for larger simple ones (D > 5 km)
    c.floorT = D > 5000 ? 0.15 : 0;
  } else {
    c.complex = 1;
    const dep = 1044 * Math.pow(Dk, 0.301);
    const rim = 236 * Math.pow(Dk, 0.399);
    c.dep = dep * (0.45 + 0.55 * f) * (1 - 0.55 * c.flooded);
    c.rim = rim * (0.5 + 0.5 * f);
    c.floorT = 0.3 + 0.25 * smooth01((Dk - 15) / 110);
    c.peak = D < 180000 ? c.dep * (0.25 + 0.2 * ((h >>> 3) & 7) / 7) * (1 - c.flooded) : 0;
    c.terraces = 2 + ((h >>> 7) & 3);
  }
}
const NAMED = [];
for (const [, lat, lon, Dk, f, rays, fl] of NAMED_DEF) {
  const d = dirLL(lat, lon);
  NAMED.push(makeCrater(d[0], d[1], d[2], Dk * 1000, f, rays, fl, hash3(Math.round(lat * 100), Math.round(lon * 100), 7, 11)));
}
for (const [, e, n, Dk, f, rays, fl] of LOCAL_DEF) {
  const d = siteOffsetDir(e, n);
  const c = makeCrater(d[0], d[1], d[2], Dk * 1000, f, rays, fl, hash3(e, n, 3, 5));
  c.local = 1;
  NAMED.push(c);
}
const NNAMED = NAMED.length;
const NAMED_X = Float64Array.from(NAMED, (c) => c.x);
const NAMED_Y = Float64Array.from(NAMED, (c) => c.y);
const NAMED_Z = Float64Array.from(NAMED, (c) => c.z);
const NAMED_COS = Float64Array.from(NAMED, (c) => c.cosInf);

// Random crater octaves: cell size shrinks by 2.4x per octave. Candidate ball radius rho = s * cell/2
// (s in {0.38, 0.55, 0.75, 1} per candidate, filling the size gaps between octaves), so the crater rim
// radius a = sqrt(rho^2 - d^2)/2 <= cell/4, i.e. D <= cell/2 and ejecta reach 1.9a < rho.
const OCT_RATIO = 2.4;
const OCT_CELL = [];
{
  let c = 300000;
  while (c >= 3.0) {
    OCT_CELL.push(c);
    c /= OCT_RATIO;
  }
}
// Highlands are near saturation for large craters: extra candidate layers (different seeds) for the
// large octaves, evaluated only where there is no mare (the landing-site path stays fast).
const OCT_LIST = [];
OCT_CELL.forEach((c, i) => {
  const D = 0.5 * c;
  const layers = D > 15000 ? 3 : D > 800 ? 2 : 1;
  for (let l = 0; l < layers; l++) OCT_LIST.push({ c, layer: l, idx: i });
});
const NOCT = OCT_LIST.length;
const OCT_INV = new Float64Array(NOCT);
const OCT_CELLV = new Float64Array(NOCT);
const OCT_RHO2 = new Float64Array(NOCT);
const OCT_MAXD = new Float64Array(NOCT);
const OCT_SEED = new Int32Array(NOCT);
const OCT_DH = new Float64Array(NOCT); // density highlands (0..1)
const OCT_DM = new Float64Array(NOCT); // density maria
const OCT_HLONLY = new Uint8Array(NOCT); // 1 = extra highland layer (skipped on maria)
// (a steep spread inside each octave: many small craters beside a few large ones, not one size per octave)
const RHO_SCALE2 = new Float64Array([0.38 * 0.38, 0.55 * 0.55, 0.75 * 0.75, 1]);
for (let o = 0; o < NOCT; o++) {
  const { c, layer, idx } = OCT_LIST[o];
  OCT_INV[o] = 1 / c;
  OCT_CELLV[o] = c;
  OCT_RHO2[o] = 0.25 * c * c;
  OCT_MAXD[o] = 0.5 * c;
  OCT_SEED[o] = (0x51ed27 * (idx + 1) + 0x3c6ef372 * layer) | 0;
  OCT_HLONLY[o] = layer > 0 ? 1 : 0;
  const D = 0.5 * c;
  // maria have few large craters (they post-date the basalt flooding)
  OCT_DH[o] = layer > 0 ? 0.9 : D > 20000 ? 0.97 : D > 1000 ? 0.95 : D > 100 ? 0.9 : 0.85;
  // (mare values follow the crater size-frequency of ~3.6 Gyr basalt, e.g. Mare Tranquillitatis:
  // N(>1 km) ~ 1e-2 per km^2, i.e. sparse large craters but a well cratered plain at the km scale)
  OCT_DM[o] = layer > 0 ? 0 : D > 20000 ? 0.06 : D > 3000 ? 0.16 : D > 600 ? 0.3 : D > 150 ? 0.42 : D > 40 ? 0.62 : 0.78;
}
// Cache of the mare mask at large-crater centres, keyed by the exact (octave, cell) so a hit is always
// the same crater: deterministic, a cached value is exactly what a fresh evaluation returns.
const MC_SIZE = 512; // slot index = top 9 bits of a 32-bit mix
const MC_O = new Int32Array(MC_SIZE);
const MC_X = new Int32Array(MC_SIZE);
const MC_Y = new Int32Array(MC_SIZE);
const MC_Z = new Int32Array(MC_SIZE);
const MC_VAL = new Float64Array(MC_SIZE);
const MC_OK = new Uint8Array(MC_SIZE);

/** Diameter above which craters excavate blocks (bedrock below the ~4-6 m mare regolith). */
const BLOCKY_D = 22;

// Boulder octaves (collidable): cell size, max footprint radius rho (m), seed, background density.
const BOULDER_OCT = [
  { cell: 12, rho: 1.5, seed: 0x3a1f11, bg: 0.035, dens: 0.9 },
  { cell: 5, rho: 0.6, seed: 0x6b2c37, bg: 0.06, dens: 0.85 },
  { cell: 2.2, rho: 0.26, seed: 0x1d9e4b, bg: 0.08, dens: 0.75 },
];
/** Largest boulder feature size (diameter, m); LOD evaluations above this skip boulders. */
export const BOULDER_MAX_SIZE = 3.0;

// Boulder shape variants. Real lunar blocks (Apollo surface photography) are sub-rounded to angular with
// rounded edges, lumpy, often flat slabs, and partly buried with a small regolith fillet banked against
// their base. Each variant is a height field over the (irregular) footprint:
//   outline  1 + a2 cos 2(th-phi2) + a3 cos 3(..) + a5 cos 5(..) + a7 cos 7(..)
//   dome     (1 - q^p)^ex            p ~2 rounded ... 5 flat-topped block; ex < 1: steep sides that emerge
//                                     from the soil (a partly buried rock, not a cone standing on it)
//   tilt     one side higher;  lumps: three low-frequency undulations (knobbly surfaces)
//   cuts     smooth-min with tilted planes: flat fracture faces joined by ROUNDED edges (k = edge radius)
//   fillet   regolith banked against the base out to q = 1 + FILLET_W (part of the collision shape)
// Variants are generated deterministically from a class and a seed; the profile is normalised so that its
// maximum is exactly 1 (H is the true height of the rock). The class also scales the height (slabs).
const FILLET_W = 0.12; // fillet reach beyond the outline (x outline radius)
const FILLET_IN = 0.06; // the fillet starts this far inside the outline (a concave crease)
const FILLET_H = 0.05; // fillet height (x rock height)
const BOULDER_CLASSES = [
  // p, ex: base dome (a superellipsoid the fracture faces are carved from); lump amplitude/frequency;
  // cuts: number of planar fracture faces; k: edge rounding radius; hs: height scale (slabs are low)
  { name: 'subrounded', p: 2.2, ex: 0.55, lump: 0.08, lf: 2.2, cuts: 3, k: 0.2, hs: 0.9 },
  { name: 'block', p: 3.0, ex: 0.42, lump: 0.04, lf: 2.6, cuts: 6, k: 0.08, hs: 1.0 },
  { name: 'slab', p: 4.0, ex: 0.32, lump: 0.03, lf: 2.0, cuts: 4, k: 0.06, hs: 0.55 },
  { name: 'knobbly', p: 2.6, ex: 0.5, lump: 0.13, lf: 3.2, cuts: 4, k: 0.14, hs: 0.85 },
];
function variantRand(seed) {
  let h = seed >>> 0;
  return () => {
    h = remix(h + 0x9e3779b9);
    return h / 4294967296;
  };
}
const BOULDER_VARIANTS = [];
for (let vi = 0; vi < 12; vi++) {
  const cls = BOULDER_CLASSES[[0, 1, 0, 2, 1, 3, 0, 1, 2, 3, 1, 1][vi]];
  const rnd = variantRand(0x5eed + vi * 7919);
  const v = {
    cls: cls.name,
    a2: 0.08 + 0.14 * rnd(), p2: rnd() * 6.2832,
    a3: 0.04 + 0.09 * rnd(), p3: rnd() * 6.2832,
    a5: 0.02 + 0.05 * rnd(), p5: rnd() * 6.2832,
    a7: 0.01 + 0.025 * rnd(), p7: rnd() * 6.2832,
    p: cls.p * (0.9 + 0.2 * rnd()),
    ex: cls.ex * (0.9 + 0.2 * rnd()),
    tilt: 0.05 + 0.25 * rnd(), pt: rnd() * 6.2832,
    lumps: [],
    cuts: [],
    k: cls.k,
    hs: cls.hs,
    norm: 1,
  };
  v.c2 = Math.cos(v.p2); v.s2 = Math.sin(v.p2);
  v.c3 = Math.cos(v.p3); v.s3 = Math.sin(v.p3);
  v.c5 = Math.cos(v.p5); v.s5 = Math.sin(v.p5);
  v.c7 = Math.cos(v.p7); v.s7 = Math.sin(v.p7);
  v.ct = Math.cos(v.pt); v.st = Math.sin(v.pt);
  for (let l = 0; l < 3; l++) {
    const a = rnd() * 6.2832;
    const f = cls.lf * (0.7 + 0.8 * rnd()) * (l + 1) * 0.75;
    v.lumps.push({ kx: f * Math.cos(a), ky: f * Math.sin(a), ph: rnd() * 6.2832, amp: (cls.lump * (1.2 - 0.3 * l)) * (0.6 + 0.8 * rnd()) });
  }
  // fracture faces: planes h = c0 + g . (u, w) sloping down toward azimuth a; each passes through a point
  // at radius r0 along a, somewhat below the dome there, so it shaves a corner/flank off the dome.
  // Low slopes near the centre make tilted top faces, steep ones make the sides; together they give
  // the irregular polyhedral blocks of the Apollo photographs, rounded by the smooth minimum.
  const a0 = rnd() * 6.2832;
  for (let c = 0; c < cls.cuts; c++) {
    const a = a0 + (c / cls.cuts) * 6.2832 + (rnd() - 0.5) * 1.3;
    const top = c === 0 || (c === 3 && cls.cuts > 4);
    const sl = top ? 0.1 + 0.5 * rnd() : 0.8 + 1.6 * rnd();
    const r0 = top ? 0.15 + 0.3 * rnd() : 0.45 + 0.4 * rnd();
    const hd = Math.pow(1 - Math.pow(r0, v.p), v.ex);
    const c0 = hd * (top ? 0.7 + 0.2 * rnd() : 0.5 + 0.3 * rnd()) + sl * r0;
    v.cuts.push({ gx: -sl * Math.cos(a), gy: -sl * Math.sin(a), c0 });
  }
  BOULDER_VARIANTS.push(v);
}
const NVAR = BOULDER_VARIANTS.length;
/** Boulder shape variants shared by collision and rendering (see boulderProfile). */
export { BOULDER_VARIANTS };

/** Outline radius (x footprint radius) of variant `vi` in polar direction (cosT, sinT). */
export function boulderEdge(vi, cosT, sinT) {
  const v = BOULDER_VARIANTS[vi];
  const c2 = cosT * cosT - sinT * sinT;
  const s2 = 2 * cosT * sinT;
  const c3 = cosT * (4 * cosT * cosT - 3);
  const s3 = sinT * (3 - 4 * sinT * sinT);
  const c5 = c2 * c3 - s2 * s3;
  const s5 = s2 * c3 + c2 * s3;
  const c7 = c2 * c5 - s2 * s5;
  const s7 = s2 * c5 + c2 * s5;
  return 1 + v.a2 * (c2 * v.c2 + s2 * v.s2) + v.a3 * (c3 * v.c3 + s3 * v.s3) + v.a5 * (c5 * v.c5 + s5 * v.s5) + v.a7 * (c7 * v.c7 + s7 * v.s7);
}
/** Largest outline radius of any variant incl. the fillet (x footprint radius). */
let BOULDER_EDGE_MAX = 0;

// Rock body (without fillet) at edge-normalised radius q and position (u, w) = q (cos, sin), unnormalised.
function rockBody(v, q, u, w) {
  if (q >= 1) return 0;
  let h = Math.pow(1 - Math.pow(q, v.p), v.ex);
  h *= 1 + v.tilt * (u * v.ct + w * v.st) - v.tilt * 0.5;
  const L = v.lumps;
  h *= 1 + L[0].amp * Math.cos(L[0].kx * u + L[0].ky * w + L[0].ph) + L[1].amp * Math.cos(L[1].kx * u + L[1].ky * w + L[1].ph) + L[2].amp * Math.cos(L[2].kx * u + L[2].ky * w + L[2].ph);
  const k = v.k;
  for (let i = 0; i < v.cuts.length; i++) {
    const c = v.cuts[i];
    const b = c.c0 + c.gx * u + c.gy * w;
    // polynomial smooth minimum: rounded edge of radius ~k between dome and fracture face
    const d = k - Math.abs(h - b);
    h = (h < b ? h : b) - (d > 0 ? (d * d) / (4 * k) : 0);
  }
  return h > 0 ? h : 0;
}
for (const v of BOULDER_VARIANTS) {
  let mx = 0;
  for (let i = 0; i <= 40; i++) {
    const q = i / 40;
    for (let j = 0; j < 72; j++) {
      const a = (j / 72) * Math.PI * 2;
      const hb = rockBody(v, q, q * Math.cos(a), q * Math.sin(a));
      if (hb > mx) mx = hb;
    }
    for (let j = 0; j < 72; j++) {
      const a = (j / 72) * Math.PI * 2;
      const e = boulderEdge(BOULDER_VARIANTS.indexOf(v), Math.cos(a), Math.sin(a));
      if (e > BOULDER_EDGE_MAX) BOULDER_EDGE_MAX = e;
    }
  }
  v.norm = 1 / mx;
}
BOULDER_EDGE_MAX *= 1 + FILLET_W;
/** Fillet geometry (for the renderer): reach beyond the outline and height, in rock units. */
export const BOULDER_FILLET = { reach: FILLET_W, inset: FILLET_IN, height: FILLET_H };

/**
 * Normalised boulder height profile (0..1) for variant `vi` at normalised radius `rr` (distance /
 * footprint radius) and polar angle given by (cosT, sinT) in the boulder's own frame (theta from the
 * boulder's x axis toward its y axis). Includes the regolith fillet around the base.
 * The rock renderer builds its meshes from exactly this function.
 */
export function boulderProfile(vi, rr, cosT, sinT) {
  const v = BOULDER_VARIANTS[vi];
  const q = rr / boulderEdge(vi, cosT, sinT);
  if (q >= 1 + FILLET_W) return 0;
  const hb = q < 1 ? rockBody(v, q, q * cosT, q * sinT) * v.norm : 0;
  let f = 1 - (q - 1 + FILLET_IN) / (FILLET_W + FILLET_IN);
  f = f >= 1 ? FILLET_H : FILLET_H * f * f;
  return hb > f ? hb : f;
}

// ------------------------------------------------------------------------------------ evaluation
/** Output record of evalSurface. */
export function createSample() {
  return { h: 0, albedo: 0.1, mare: 0, fresh: 0, block: 0, hNoBoulder: 0 };
}

const F_ALBEDO = 1; // compute albedo / freshness
const F_BOULDERS = 2; // include collidable boulders in h
const F_BLOCK = 4; // compute the "blockiness" field (boulder density driver) only

// scratch for the mare evaluation (returned via module-level vars for speed)
// [0] mare fraction, [1] mare floor height, [2] landing-site proximity, [3] distance inside the
// fully-mare region (m, conservative), [4] wide mare mask (gentle height contacts), [5] albedo mare mask
// (sharper, fractal shoreline) — typed array: no boxing
const SCR = new Float64Array(6);

function evalMaria(x, y, z, lod) {
  // shore warp noise: lobate, irregular shorelines (relative to each basin's radius)
  const px = x * 2.3 + 17.1;
  const py = y * 2.3 - 3.3;
  const pz = z * 2.3 + 9.7;
  let warp = noise3(px, py, pz) * 0.55 + noise3(px * 2.7, py * 2.7, pz * 2.7) * 0.3;
  let fine = 0;
  if (lod < 60000) fine = noise3(px * 8.3, py * 8.3, pz * 8.3) * 0.5;
  if (lod < 15000) fine += noise3(px * 23, py * 23, pz * 23) * 0.3;
  if (lod < 5000) fine += noise3(px * 61, py * 61, pz * 61) * 0.15;
  // fractal shoreline down to ~2 km: embayments, lobes and highland "islands" (kipukas)
  let shore = 0;
  if (lod < 4000) shore = noise3(px * 157 + 3.1, py * 157, pz * 157 - 1.7) * 0.9;
  if (lod < 1500) shore += noise3(px * 409 - 0.3, py * 409 + 5.2, pz * 409) * 0.4;
  let m = 0;
  let hs = 0;
  let ws = 0;
  let mg = -1; // how far inside the fully-mare region (rad); < 0 outside
  let ma = 0; // like m but with a ~3x wider shore transition (gradational height contacts)
  let mb = 0; // albedo mask: ~1.6x wider than m
  for (let i = 0; i < NMARE; i++) {
    const d = x * MARE_X[i] + y * MARE_Y[i] + z * MARE_Z[i];
    if (d < MARE_COSR[i]) continue;
    const ang = Math.acos(d > 1 ? 1 : d);
    const r = MARE_R[i];
    const sw = 0.1 * MARE_W[i] + 0.002;
    const edge = r * (1 + 0.36 * warp) + MARE_W[i] * fine * 1.8 + sw * shore;
    const k = smooth01((edge - ang) / sw + 0.5);
    const margin = edge - ang - 0.5 * sw;
    if (margin > mg) mg = margin;
    const ka = smooth01((edge - ang) / (3 * sw) + 0.5);
    if (ka <= 0) continue;
    if (ka > ma) ma = ka;
    const kb = smooth01((edge - ang) / (1.6 * sw) + 0.5);
    if (kb > mb) mb = kb;
    // floor height: weighted by the wide mask so it is defined wherever the basalt surface blends in
    hs += ka * MARE_H[i];
    ws += ka;
    if (k > m) m = k;
  }
  // Mare Frigoris: a long, meandering band along ~56 N from ~45 W to ~45 E
  if (z > 0.72 && z < 0.92) {
    const lat = Math.asin(z);
    const lon = Math.atan2(y, x);
    if (lon > -1.15 && lon < 1.15) {
      const meander = 0.035 * Math.sin(lon * 2.3 + 0.7) + 0.02 * Math.sin(lon * 5.1 - 1.2) + 0.03 * warp;
      const width = 0.055 * (1 + 0.45 * warp + 0.35 * Math.sin(lon * 3.7 + 2.0)) + 0.025 * fine;
      const band = width - Math.abs(lat - 0.98 - meander);
      const ends = 1 - smooth01((Math.abs(lon) - 0.68 - 0.12 * fine) / 0.18);
      const k = smooth01(band / 0.006 + 0.5) * ends;
      const ka = smooth01(band / 0.018 + 0.5) * ends;
      if (ka > ma) ma = ka;
      const kb = smooth01(band / 0.01 + 0.5) * ends;
      if (kb > mb) mb = kb;
      if (ka > 0) {
        if (k > m) m = k;
        hs += ka * -1500;
        ws += ka;
      }
    }
  }
  SCR[0] = m;
  SCR[1] = ws > 0 ? hs / ws : 0;
  SCR[3] = mg * R;
  SCR[4] = ma;
  SCR[5] = mb;
}

// Global relief (highland topography, basins, far-side bulge) — no craters.
function evalBase(x, y, z, lod, m, mareH) {
  // far-side highland bulge (+~2 km on the far side, ~0 near side)
  let h = -1200 * x + 400 * z * z;
  // basins: broad depressions and rugged rim massifs
  for (let i = 0; i < BASINS.length; i++) {
    const b = BASINS[i];
    const d = x * b.x + y * b.y + z * b.z;
    if (d < b.cosMax) continue;
    const ang = Math.acos(d > 1 ? 1 : d);
    const r = ang / b.ring;
    if (b.depth > 0 && r < 1.1) {
      const k = 1 - smooth01(r / 1.1);
      h -= b.depth * k;
    }
    const q = (ang - b.ring) / b.width;
    if (q > -3 && q < 3) {
      // massifs: ridged noise modulating the ring
      const n = 1 - Math.abs(noise3(x * 90 + i, y * 90, z * 90));
      const n2 = 1 - Math.abs(noise3(x * 260, y * 260 + i, z * 260));
      const ring = Math.exp(-q * q * 0.9);
      h += b.amp * ring * (0.25 + 0.75 * n * n) * (0.7 + 0.3 * n2) * (1 - 0.85 * m);
    }
  }
  // highland relief: fBm, weaker on the maria
  const hl = 1 - 0.92 * m;
  let amp = 1400;
  let f = 3.1; // 1/f of the radius ~ 560 km wavelength
  for (let o = 0; o < 6; o++) {
    const wl = (R / f) * 1.0;
    if (wl < lod) break;
    const fade = lod > 0 ? smooth01(wl / lod - 1) : 1;
    h += amp * hl * noise3(x * f + o * 7.3, y * f - o * 3.1, z * f + o * 1.7) * fade;
    amp *= 0.47;
    f *= 2.3;
  }
  // mare fill: the basalt surface is nearly level
  if (m > 0 || SCR[4] > 0) {
    // wrinkle ridges (dorsa): long (50-300 km), sinuous ridge systems, 100-250 m high: a broad arch
    // (~10 km) carrying a narrow, crenulated crest. Crests follow the zero contour of a low-frequency,
    // domain-warped noise, stretched north-south (the dominant trend of near-side mare ridges), so they
    // form long winding lines instead of closed loops; distance to the crest ~ |noise| / gradient.
    let ridge = 0;
    if (lod < 8000) {
      const f = 21;
      const wa = noise3(x * 9.3 + 4.1, y * 9.3, z * 9.3 - 2.3);
      const wb = noise3(x * 9.3 - 1.9, y * 9.3 + 6.6, z * 9.3);
      const rn = noise3(x * f + wa * 2.2, y * f + wb * 2.2, z * f * 0.45 + wa * 0.8);
      const dm = (Math.abs(rn) / 1.1) * (R / f); // ~metres from the crest line
      const q1 = dm / 8500;
      if (q1 < 3) {
        // crenulation: the crest wanders from side to side of the arch and varies in height
        let cren = 1;
        let off = 0;
        if (lod < 3000) {
          const cn = noise3(x * 190 + 1.3, y * 190, z * 190 - 0.7);
          cren = 0.6 + 0.6 * Math.abs(cn);
          off = 900 * cn;
        }
        const q2 = (dm + off) / 2300;
        ridge = 120 * Math.exp(-q1 * q1) + (q2 < 3 && q2 > -3 ? 170 * cren * Math.exp(-q2 * q2) : 0);
        // ridge systems: gated regionally (not every contour carries a ridge)
        ridge *= smooth01((noise3(x * 9 + 2.2, y * 9, z * 9 - 1.4) + 0.12) * 2.6);
      }
    }
    // gentle undulation of the lava plains
    let und = 0;
    if (lod < 3000) und = 25 * noise3(x * 900, y * 900 + 3.3, z * 900);
    if (lod < 600) und += 6 * noise3(x * 4300 - 1.1, y * 4300, z * 4300);
    // keep Tranquility Base itself level (no dorsum through the target)
    ridge *= 1 - 0.85 * SCR[2];
    const mh = mareH + ridge + und + 0.024 * (h - mareH);
    // the basalt surface laps onto the highlands over a wider zone than the mare mask (gentle contacts)
    const mw = SCR[4];
    h = h + (mh - h) * (mw > m ? 0.35 * m + 0.65 * mw : m);
  }
  // highland massifs & hummocky ejecta terrain (ridged noise, 8-60 km), absent on the maria
  if (m < 1) {
    const hl2 = (1 - m) * (1 - m);
    let amp2 = 700;
    let f2 = 29; // ~60 km wavelength
    for (let o = 0; o < 3; o++) {
      const wl = R / f2;
      if (wl < lod) break;
      const r = 1 - Math.abs(noise3(x * f2 + 11.3 * o, y * f2 - 7.7, z * f2 + 3.1 * o));
      h += hl2 * amp2 * (r * r - 0.4);
      amp2 *= 0.5;
      f2 *= 2.6;
    }
    // small-scale roughness (hummocky ejecta)
    if (lod < 2500) h += (1 - m) * 60 * noise3(x * 2600 + 5.5, y * 2600, z * 2600 - 2.1);
  }
  return h;
}

// Crater cross-section: height (m) relative to the pre-impact surface at normalised radius t = s/a.
// Zero for t >= 1.9. Fresh craters: sharp rim crest; degraded: softened, shallower.
function craterProfile(t, dep, rim, fresh, complex, floorT, peak, terraces) {
  if (t >= 1.9) return 0;
  let hf;
  if (t < 1) {
    if (complex) {
      if (t < floorT) {
        hf = -dep;
        if (peak > 0) {
          const pt = t / (0.17 * (1 - floorT) + 0.08);
          hf += peak * Math.exp(-pt * pt * 2.2);
        }
      } else {
        const w = (t - floorT) / (1 - floorT);
        const k = w * terraces;
        const kf = Math.floor(k);
        const fr = k - kf;
        // terraces: flatter benches separated by steeper scarps (peak slope ~1.5x the mean wall slope)
        const terr = (kf + fr * fr * (3 - 2 * fr)) / terraces;
        const ww = 0.6 * w + 0.4 * terr;
        hf = -dep + (dep + rim) * Math.pow(ww, 1.25);
      }
    } else {
      const t2 = t * t;
      let g = t2 * (1.5 - 0.5 * t2);
      if (floorT > 0) g = t < floorT ? 0 : ((t - floorT) / (1 - floorT)) ** 2 * (1.5 - 0.5 * ((t - floorT) / (1 - floorT)) ** 2);
      hf = -dep + (dep + rim) * g;
    }
  } else {
    // continuous ejecta blanket ~ r^-3, faded to exactly 0 at t = 1.9
    const it = 1 / t;
    let e = rim * it * it * it;
    if (t > 1.45) {
      const q = (t - 1.45) / 0.45;
      e *= 1 - q * q * (3 - 2 * q);
    }
    hf = e;
  }
  if (fresh >= 0.999) return hf;
  // degraded form: a smooth, shallower depression with a subdued broad rim
  const sd = t < 1.15 ? 1 - smooth01(t / 1.15) : 0;
  const q2 = (t - 1.02) / 0.38;
  let bump = 1 - q2 * q2 * 0.4;
  bump = bump > 0 ? bump * bump : 0; // ~exp(-q2^2)
  let hd = -dep * sd + rim * 0.85 * bump;
  if (t > 1.5) hd *= 1 - smooth01((t - 1.5) / 0.4);
  const k = fresh * fresh * (3 - 2 * fresh);
  return hd + (hf - hd) * k;
}

// Normalised brightness of fresh ejecta / interior at t (albedo multiplier contribution 0..1).
function craterBright(t) {
  if (t < 1) return 0.55 + 0.45 * t * t;
  if (t >= 1.9) return 0;
  const q = (t - 1) / 0.9;
  return (1 - q) * (1 - q) * 1.0;
}

// Ray pattern of a young crater: a diffuse bright halo plus many rays of varying width and length that
// are clumpy along their length (chains of secondary-crater ejecta). t is the distance in crater radii.
function rayPattern(c, x, y, z, t, wmul = 1) {
  // local tangent frame at the crater
  let ex = -c.y;
  let ey = c.x;
  const el = Math.hypot(ex, ey) || 1;
  ex /= el;
  ey /= el;
  const nx = -c.z * ey;
  const ny = c.z * ex;
  const nz = c.x * ey - c.y * ex;
  const u = x * ex + y * ey;
  const v = x * nx + y * ny + z * nz;
  const ang = Math.atan2(v, u);
  let s = 0;
  let h = c.seed;
  for (let k = 0; k < 26; k++) {
    h = remix(h + k);
    const a0 = (h & 0xffff) * INV_2_16 * Math.PI * 2;
    const len = 2.5 + (((h >>> 24) & 15) / 15) * 6.5; // ray length in crater radii
    if (t > len) continue;
    let da = ang - a0;
    da -= Math.PI * 2 * Math.round(da / (Math.PI * 2));
    // rays widen slightly with distance and taper toward their ends
    const wdt = (0.012 + (((h >>> 16) & 255) / 255) * 0.05) * (0.7 + 0.12 * t) * wmul;
    const g = Math.exp(-(da * da) / (wdt * wdt));
    if (g < 0.01) continue;
    const taper = 1 - t / len;
    s += g * taper * taper * (0.5 + 0.5 * (((h >>> 8) & 255) / 255));
  }
  // clumpy along the rays (secondary crater clusters) and a diffuse halo near the crater
  const clump = 0.55 + 0.45 * noise3(x * 2600 + c.x * 50, y * 2600, z * 2600);
  const halo = t < 3.5 ? 0.45 * Math.exp(-(t - 1) * 1.2) : 0;
  return Math.min(1, s * clump + (t > 1 ? halo : 0.45));
}

// Young rayed craters (Copernican, 1.2-6 km): one candidate per 3D cell of RAY_CELL metres, existing with
// probability RAY_P; each makes a fresh bowl (height) and a bright halo & ray system out to RAY_REACH
// crater radii (albedo) - the sprinkling of small bright-rayed craters of LROC/Apollo orbital images.
// As for the crater octaves, a candidate only exists when its whole reach lies inside the ball of radius
// RAY_CELL/2 around it, so the 8-cell lookup around any point finds every crater that touches it.
const RAY_CELL = 60000;
const RAY_P = 0.55;
const RAY_REACH = 7;
const RAY_OUT = new Float64Array(2);
const _rc = { x: 0, y: 0, z: 0, seed: 0 };
function rayLayer(x, y, z, px, py, pz, lod, wantAlb) {
  const inv = 1 / RAY_CELL;
  const rho = 0.5 * RAY_CELL;
  const fx = px * inv;
  const fy = py * inv;
  const fz = pz * inv;
  let bx = Math.floor(fx);
  let by = Math.floor(fy);
  let bz = Math.floor(fz);
  if (fx - bx < 0.5) bx--;
  if (fy - by < 0.5) by--;
  if (fz - bz < 0.5) bz--;
  let h = 0;
  let alb = 0;
  let fresh = 0;
  for (let k = 0; k < 8; k++) {
    const cx = bx + (k & 1);
    const cy = by + ((k >> 1) & 1);
    const cz = bz + (k >> 2);
    let hh = hash3(cx, cy, cz, 0x7a11c3);
    if ((hh & 0xffff) * INV_2_16 >= RAY_P) continue;
    hh = remix(hh);
    const qx = (cx + (hh & 1023) * INV_2_10) * RAY_CELL;
    const qy = (cy + ((hh >>> 10) & 1023) * INV_2_10) * RAY_CELL;
    const qz = (cz + ((hh >>> 20) & 1023) * INV_2_10) * RAY_CELL;
    // cheap reject: p must be within the ball
    const ex = qx - px;
    const ey = qy - py;
    const ez = qz - pz;
    if (ex * ex + ey * ey + ez * ez >= rho * rho) continue;
    const ql = Math.sqrt(qx * qx + qy * qy + qz * qz);
    const d0 = ql - R;
    hh = remix(hh);
    const u = (hh & 0xffff) * INV_2_16;
    const a = 0.5 * (1200 + 4800 * u * u * u);
    const reach = RAY_REACH * a;
    if (reach * reach + d0 * d0 >= rho * rho) continue;
    const ux = qx / ql;
    const uy = qy / ql;
    const uz = qz / ql;
    const sx = x - ux;
    const sy = y - uy;
    const sz = z - uz;
    const t = (Math.sqrt(sx * sx + sy * sy + sz * sz) * R) / a;
    if (t >= RAY_REACH) continue;
    // keep the landing-site region clear
    const kx = ux * R - SITE_P[0];
    const ky = uy * R - SITE_P[1];
    const kz = uz * R - SITE_P[2];
    const kl = reach + 20000;
    if (kx * kx + ky * ky + kz * kz < kl * kl) continue;
    if (t < 1.9 && 2 * a >= lod) h += craterProfile(t, 2 * a * 0.19, 2 * a * 0.036, 1, 0, 0, 0, 3);
    if (wantAlb) {
      _rc.x = ux;
      _rc.y = uy;
      _rc.z = uz;
      _rc.seed = hh;
      const k2 = 0.5 + 0.5 * (((hh >>> 16) & 255) / 255);
      const rp = rayPattern(_rc, x, y, z, t * (9 / RAY_REACH), 2.2) * k2 * (1 - smooth01((t - 0.7 * RAY_REACH) / (0.3 * RAY_REACH)));
      alb += 0.06 * rp + (t < 1.9 ? 0.05 * craterBright(t) : 0);
      if (rp > fresh) fresh = rp;
    }
  }
  RAY_OUT[0] = alb;
  RAY_OUT[1] = fresh;
  return h;
}

// Random crater octaves (large -> small). Returns the height contribution; albedo/freshness/blockiness
// accumulate into OCT_ACC [alb, fresh, block] (a separate function keeps the hot loop small for V8).
const OCT_ACC = new Float64Array(3);
function craterOctaves(x, y, z, px, py, pz, lod, flags, m, mareInside, nearSite, siteD2) {
  const wantAlb = (flags & F_ALBEDO) !== 0;
  const wantBlock = (flags & (F_BLOCK | F_ALBEDO)) !== 0 || (flags & F_BOULDERS) !== 0;
  const blockOnly = flags === F_BLOCK;
  let h = 0;
  let alb = OCT_ACC[0];
  let fresh = OCT_ACC[1];
  let block = OCT_ACC[2];
  // ---- random crater octaves (large -> small)
  // Per cell: the first hash gives the candidate position (distance test rejects ~94% of cells
  // right away); only candidates inside the ball draw more random numbers.
  const lodW = lod > 0 ? lod : 0;
  const onlyBlock = blockOnly;
  // local tangent frame for crater outline irregularity (rotates negligibly across any one crater)
  let fe1x = -y;
  let fe1y = x;
  let fe1z = 0;
  if (z > 0.9 || z < -0.9) {
    fe1x = 0;
    fe1y = -z;
    fe1z = y;
  }
  const fl = 1 / Math.sqrt(fe1x * fe1x + fe1y * fe1y + fe1z * fe1z);
  fe1x *= fl;
  fe1y *= fl;
  fe1z *= fl;
  const fe2x = y * fe1z - z * fe1y;
  const fe2y = z * fe1x - x * fe1z;
  const fe2z = x * fe1y - y * fe1x;
  for (let o = 0; o < NOCT; o++) {
    const maxD = OCT_MAXD[o];
    if (maxD < lodW) break;
    // extra highland layers: no weight where the mask is 1 (small craters use p's mask), and no
    // highland crater can reach p when p is deeper inside the mare than the crater's reach
    if (OCT_HLONLY[o] && m >= 1 && (maxD <= 2000 || mareInside > 0.75 * OCT_CELLV[o])) continue;
    const inv = OCT_INV[o];
    const cell = OCT_CELLV[o];
    const dens = OCT_DH[o] + (OCT_DM[o] - OCT_DH[o]) * m;
    const seed = OCT_SEED[o];
    const fx = px * inv;
    const fy = py * inv;
    const fz = pz * inv;
    let bx = Math.floor(fx);
    let by = Math.floor(fy);
    let bz = Math.floor(fz);
    if (fx - bx < 0.5) bx--;
    if (fy - by < 0.5) by--;
    if (fz - bz < 0.5) bz--;
    // local cell-space coordinates of p relative to the base cell (small numbers: precise)
    const lx = fx - bx;
    const ly = fy - by;
    const lz = fz - bz;
    // chained cell hash (x, then y, then z, each followed by a mixing step): no structural collisions
    // between mirrored cells; shared prefixes are computed once for the 2 x 2 x 2 neighbourhood
    const hx0 = cmix(Math.imul(bx, 0x9e3779b1) ^ seed);
    const hx1 = cmix(Math.imul(bx + 1, 0x9e3779b1) ^ seed);
    const hy0 = Math.imul(by, 0x85ebca6b);
    const hy1 = Math.imul(by + 1, 0x85ebca6b);
    const hxy00 = cmix(hx0 ^ hy0);
    const hxy10 = cmix(hx1 ^ hy0);
    const hxy01 = cmix(hx0 ^ hy1);
    const hxy11 = cmix(hx1 ^ hy1);
    const hz0 = Math.imul(bz, 0xc2b2ae35);
    const hz1 = Math.imul(bz + 1, 0xc2b2ae35);
    // squared minimum distance from p to cell 0 / cell 1 along each axis (lx in [0.5, 1.5))
    const mx0 = lx > 1 ? (lx - 1) * (lx - 1) : 0;
    const mx1 = lx < 1 ? (1 - lx) * (1 - lx) : 0;
    const my0 = ly > 1 ? (ly - 1) * (ly - 1) : 0;
    const my1 = ly < 1 ? (1 - ly) * (1 - ly) : 0;
    const mz0 = lz > 1 ? (lz - 1) * (lz - 1) : 0;
    const mz1 = lz < 1 ? (1 - lz) * (1 - lz) : 0;
    const exact = cell > 20000;
    const keepCheck = nearSite && siteD2 < (SITE_KEEPOUT + maxD * 2) * (SITE_KEEPOUT + maxD * 2);
    for (let k = 0; k < 8; k++) {
      const ox = k & 1;
      const oy = (k >> 1) & 1;
      const oz = k >> 2;
      if ((ox ? mx1 : mx0) + (oy ? my1 : my0) + (oz ? mz1 : mz0) >= 0.25) continue;
      let hh = (oy ? (ox ? hxy11 : hxy01) : ox ? hxy10 : hxy00) ^ (oz ? hz1 : hz0);
      hh = Math.imul(hh ^ (hh >>> 15), 0x2c1b3c6d);
      hh = Math.imul(hh ^ (hh >>> 12), 0x297a2d39);
      hh ^= hh >>> 15;
      // candidate offset from p in cell units; the top 2 bits pick the ball radius scale
      const dx = ox + (hh & 1023) * INV_2_10 - lx;
      const dy = oy + ((hh >>> 10) & 1023) * INV_2_10 - ly;
      const dz = oz + ((hh >>> 20) & 1023) * INV_2_10 - lz;
      const ddc = dx * dx + dy * dy + dz * dz;
      const sc2 = RHO_SCALE2[hh >>> 30];
      if (ddc >= 0.25 * sc2) continue;
      const rho2 = OCT_RHO2[o] * sc2;
      hh = remix(hh);
      const u0 = (hh & 0xffff) * INV_2_16;
      // existence weight: small craters use the mare mask at p (smooth, varies slowly across a crater);
      // large ones (> ~2 km) use the mask at their centre so a big rim never ramps across a shoreline
      let w;
      if (maxD > 2000) {
        if (u0 >= OCT_DH[o] && u0 >= OCT_DM[o]) continue;
        // mare mask at the crater centre (cached: neighbouring samples keep hitting the same craters)
        const ccx = bx + ox;
        const ccy = by + oy;
        const ccz = bz + oz;
        const slot = (Math.imul(ccx, 0x9e3779b1) ^ Math.imul(ccy, 0x85ebca77) ^ Math.imul(ccz, 0xc2b2ae3d) ^ (o * 0x27d4eb2f)) >>> 23;
        let mc;
        if (MC_OK[slot] && MC_O[slot] === o && MC_X[slot] === ccx && MC_Y[slot] === ccy && MC_Z[slot] === ccz) mc = MC_VAL[slot];
        else {
          const cxq = px + dx * cell;
          const cyq = py + dy * cell;
          const czq = pz + dz * cell;
          const ql = Math.sqrt(cxq * cxq + cyq * cyq + czq * czq);
          evalMaria(cxq / ql, cyq / ql, czq / ql, 60000);
          mc = SCR[0];
          MC_O[slot] = o;
          MC_X[slot] = ccx;
          MC_Y[slot] = ccy;
          MC_Z[slot] = ccz;
          MC_VAL[slot] = mc;
          MC_OK[slot] = 1;
        }
        w = (OCT_DH[o] + (OCT_DM[o] - OCT_DH[o]) * mc - u0) * 14;
      } else {
        w = (dens - u0) * 14;
      }
      if (w <= 0) continue;
      if (w > 1) w = 1;
      // crater centre offset from the sphere (along the normal) and lateral distance
      const dpc = dx * x + dy * y + dz * z;
      let d0 = dpc * cell;
      if (exact) {
        const qx = px + dx * cell;
        const qy = py + dy * cell;
        const qz = pz + dz * cell;
        d0 = Math.sqrt(qx * qx + qy * qy + qz * qz) - R;
      }
      const a2 = (rho2 - d0 * d0) * 0.25;
      if (a2 <= 0) continue;
      const s2 = (ddc - dpc * dpc) * cell * cell;
      const a = Math.sqrt(a2);
      const D = 2 * a;
      if (D < lodW) continue;
      if (lodW > 0 && D < 2 * lodW) w *= (D - lodW) / lodW;
      if (keepCheck) {
        // drop any crater whose ejecta would reach the landing-site keep-out disc
        const kx = px + (dx - dpc * x) * cell - SITE_P[0];
        const ky = py + (dy - dpc * y) * cell - SITE_P[1];
        const kz = pz + (dz - dpc * z) * cell - SITE_P[2];
        const lim = SITE_KEEPOUT + 1.9 * a;
        if (kx * kx + ky * ky + kz * kz < lim * lim) continue;
      }
      const t2 = s2 / a2;
      if (t2 >= 3.61) continue;
      let t = Math.sqrt(t2);
      if (t < 1.6 && s2 > 1e-12) {
        // irregular (non-circular) outline: 2nd & 3rd angular harmonics, up to ~7%, fading out by 1.6 a
        const lx = dpc * x - dx;
        const ly = dpc * y - dy;
        const lz = dpc * z - dz;
        const il = 1 / Math.sqrt(lx * lx + ly * ly + lz * lz);
        const ct = (lx * fe1x + ly * fe1y + lz * fe1z) * il;
        const st = (lx * fe2x + ly * fe2y + lz * fe2z) * il;
        const hw = remix(hh ^ 0x5bd1e995);
        const c2 = ct * ct - st * st;
        const s2h = 2 * ct * st;
        const c3 = ct * (4 * ct * ct - 3);
        const s3 = st * (3 - 4 * st * st);
        const wob =
          ((hw & 255) / 255 - 0.5) * 0.08 * c2 +
          (((hw >>> 8) & 255) / 255 - 0.5) * 0.08 * s2h +
          (((hw >>> 16) & 255) / 255 - 0.5) * 0.06 * c3 +
          ((hw >>> 24) / 255 - 0.5) * 0.06 * s3;
        const fade = t < 1 ? 1 : 1 - smooth01((t - 1) / 0.6);
        t /= 1 + wob * fade;
      }
      const uf = (hh >>> 16) * INV_2_16;
      // freshness: most craters are old and subdued (u^5: ~13% have fr > 0.5); large ones older still,
      // and small ones (< 300 m, eroded fastest) mostly soft: only ~1 in 6 keeps a steep, shadowed bowl
      const u2 = uf * uf;
      const fr = u2 * u2 * uf * (D > 5000 ? uf : D < 300 ? u2 : 1);
      if (onlyBlock) {
        if (fr > 0.45 && D >= BLOCKY_D) {
          const q = (t - 1.02) / (0.35 + 0.25 * fr);
          const b = w * fr * fr * Math.exp(-q * q) * (D < 2000 ? 1 : 0.6);
          if (b > block) block = b;
        }
        continue;
      }
      let dep;
      let rim;
      let complex = 0;
      let floorT = 0;
      let peak = 0;
      let terr = 3;
      if (D < 15000) {
        dep = D * 0.19 * (0.22 + 0.78 * fr);
        rim = D * 0.036 * (0.25 + 0.75 * fr);
        if (D > 5000) floorT = 0.15;
      } else {
        const h2 = remix(hh);
        complex = 1;
        const Dk = D * 0.001;
        dep = 1044 * Math.pow(Dk, 0.301) * (0.45 + 0.55 * fr);
        rim = 236 * Math.pow(Dk, 0.399) * (0.5 + 0.5 * fr);
        floorT = 0.3 + 0.25 * smooth01((Dk - 15) / 110);
        peak = dep * (0.2 + 0.25 * (h2 & 7) / 7);
        terr = 2 + ((h2 >>> 3) & 3);
      }
      h += w * craterProfile(t, dep, rim, fr, complex, floorT, peak, terr);
      if (wantBlock && fr > 0.45 && D >= BLOCKY_D) {
        const q = (t - 1.02) / (0.35 + 0.25 * fr);
        const b = w * fr * fr * Math.exp(-q * q) * (D < 2000 ? 1 : 0.6);
        if (b > block) block = b;
      }
      if (wantAlb && fr > 0.35) {
        const fb = (fr - 0.35) / 0.65;
        const br = fb * fb * craterBright(t) * w;
        // brightness of small fresh craters is stronger on the dark maria (contrast of immature soil)
        alb += br * (0.026 + 0.014 * m);
        if (br > fresh) fresh = br;
      }
    }
  }
  OCT_ACC[0] = alb;
  OCT_ACC[1] = fresh;
  OCT_ACC[2] = block;
  return h;
}

/**
 * Evaluate the lunar surface at unit direction (x,y,z).
 * @param {number} x unit direction (MCI)
 * @param {number} y
 * @param {number} z
 * @param {number} lod smallest feature size to include (m); 0 = full detail
 * @param {number} flags bit 1: albedo/freshness, bit 2: include boulders, bit 4: blockiness field
 * @param {object} out createSample() record: h (m above MOON.radius), albedo, mare, fresh, block, hNoBoulder
 * @returns {object} out
 */
export function evalSurface(x, y, z, lod, flags, out) {
  const wantAlb = (flags & F_ALBEDO) !== 0;
  const wantBlock = (flags & (F_BLOCK | F_ALBEDO)) !== 0 || (flags & F_BOULDERS) !== 0;
  const px = x * R;
  const py = y * R;
  const pz = z * R;
  // distance to the landing site (m) -> keep-out logic only evaluated near it
  const sdx = px - SITE_P[0];
  const sdy = py - SITE_P[1];
  const sdz = pz - SITE_P[2];
  const siteD2 = sdx * sdx + sdy * sdy + sdz * sdz;
  SCR[2] = siteD2 < 9e6 ? 1 - smooth01(Math.sqrt(siteD2) / 3000) : 0;
  const nearSite = siteD2 < 4e8; // within 20 km

  evalMaria(x, y, z, lod);
  const m = SCR[0];
  const blockOnly = flags === F_BLOCK;
  let h = blockOnly ? 0 : evalBase(x, y, z, lod, m, SCR[1]);

  let alb = 0;
  let fresh = 0;
  let block = 0;

  // ---- named craters
  for (let i = 0; i < NNAMED; i++) {
    const d = x * NAMED_X[i] + y * NAMED_Y[i] + z * NAMED_Z[i];
    if (d < NAMED_COS[i]) continue;
    const c = NAMED[i];
    if (c.D < lod) continue;
    // lateral distance on the sphere (chord ~ arc at these scales)
    const cx = x - c.x;
    const cy = y - c.y;
    const cz = z - c.z;
    const s = Math.sqrt(cx * cx + cy * cy + cz * cz) * R;
    const t = s / c.a;
    if (d >= c.cosGeo && blockOnly) {
      if (c.fresh > 0.5 && c.D >= BLOCKY_D) {
        const q = (t - 1.02) / (0.35 + 0.2 * c.fresh);
        const b = c.fresh * c.fresh * Math.exp(-q * q) * (c.local ? 1.6 : 1);
        if (b > block) block = b;
      }
    } else if (d >= c.cosGeo) {
      let hc = craterProfile(t, c.dep, c.rim, c.fresh, c.complex, c.floorT, c.peak, c.terraces);
      if (c.flooded > 0 && t < 1) {
        // lava-flooded floor: level, dark
        const lvl = -c.dep * (1 - c.flooded * 0.6);
        if (hc < lvl) hc = lvl + (hc - lvl) * 0.05;
      }
      h += hc;
      if (wantBlock && c.fresh > 0.5 && c.D >= BLOCKY_D) {
        const q = (t - 1.02) / (0.35 + 0.2 * c.fresh);
        const b = c.fresh * c.fresh * Math.exp(-q * q) * (c.local ? 1.6 : 1);
        if (b > block) block = b;
      }
    }
    if (wantAlb) {
      const fr = c.fresh * c.fresh * c.fresh;
      if (t < 1.9) {
        alb += (c.local ? 0.045 : 0.09) * fr * craterBright(t);
        if (c.flooded > 0.5 && t < 0.95) alb -= 0.05 * c.flooded;
        if (fr * craterBright(t) > fresh) fresh = fr * craterBright(t);
      }
      if (c.rays > 0 && t < 9.2) {
        const rp = rayPattern(c, x, y, z, t) * c.rays;
        alb += 0.12 * rp;
        if (rp * 0.7 > fresh) fresh = rp * 0.7;
      }
    }
  }

  // ---- young rayed craters
  if (!blockOnly) {
    h += rayLayer(x, y, z, px, py, pz, lod, wantAlb);
    if (wantAlb) {
      alb += RAY_OUT[0];
      if (RAY_OUT[1] > fresh) fresh = RAY_OUT[1];
    }
  }

  // ---- random crater octaves
  const mareInside = SCR[3];
  const mAlb = SCR[5]; // read before craterOctaves re-uses evalMaria for crater centres
  const lodW = lod > 0 ? lod : 0;
  OCT_ACC[0] = alb;
  OCT_ACC[1] = fresh;
  OCT_ACC[2] = block;
  h += craterOctaves(x, y, z, px, py, pz, lod, flags, m, mareInside, nearSite, siteD2);
  alb = OCT_ACC[0];
  fresh = OCT_ACC[1];
  block = OCT_ACC[2];
  out.hNoBoulder = h;

  // ---- boulders (collidable)
  if ((flags & F_BOULDERS) && lodW < BOULDER_MAX_SIZE) {
    h += boulderHeight(x, y, z, px, py, pz, lodW, nearSite, siteD2);
  }

  out.h = h;
  out.mare = m;
  out.block = block;
  if (wantAlb) {
    // base albedo: mature mare ~0.07 (Tranquillitatis is among the darkest), highlands ~0.15
    const n1 = noise3(x * 55 + 3.3, y * 55, z * 55 - 7.1);
    const n2 = lod < 20000 ? noise3(x * 400, y * 400 + 1.7, z * 400) : 0;
    const n3 = lod < 5000 ? noise3(x * 1700 - 2.2, y * 1700, z * 1700 + 0.4) : 0;
    // mare basalt units differ in maturity/titanium: regional variations of ~+-25%
    const n4 = noise3(x * 140 - 5.1, y * 140 + 2.9, z * 140);
    // highland mottling from overlapping ejecta blankets of different maturity (10-30 km patches)
    const n5 = lod < 30000 ? noise3(x * 170 + 1.9, y * 170 - 4.4, z * 170) : 0;
    const high = 0.15 + 0.03 * n1 + 0.03 * n2 + 0.016 * n3 + 0.034 * n5;
    const mare = 0.069 + 0.012 * n1 + 0.015 * n4 + 0.01 * n2 + 0.006 * n3;
    let A = high + (mare - high) * mAlb + alb;
    // South Pole–Aitken floor is slightly darker (mafic)
    A = A < 0.035 ? 0.035 : A > 0.45 ? 0.45 : A;
    out.albedo = A;
    out.fresh = fresh > 1 ? 1 : fresh;
  }
  return out;
}

// Blockiness at a boulder centre (needs the crater stack, but only octaves that can excavate blocks).
const _bs = createSample();
function blockinessAt(x, y, z) {
  evalSurface(x, y, z, BLOCKY_D * 0.999, F_BLOCK, _bs);
  return _bs.block;
}

// Boulder candidate decode shared by terrainHeight and enumerateBoulders.
// Returns false if the candidate does not produce a boulder; otherwise fills _bd.
const _bd = { x: 0, y: 0, z: 0, r: 0, H: 0, vi: 0, cps: 1, sps: 0, ex: 0, ey: 0, ez: 0, nx: 0, ny: 0, nz: 0, w: 0 };
function cellHash(cx, cy, cz, seed) {
  let h = cmix(cmix(cmix(Math.imul(cx, 0x9e3779b1) ^ seed) ^ Math.imul(cy, 0x85ebca6b)) ^ Math.imul(cz, 0xc2b2ae35));
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return h ^ (h >>> 15);
}
function decodeBoulder(oi, cx, cy, cz, px = 0, py = 0, pz = 0, lateral = false) {
  const bo = BOULDER_OCT[oi];
  let hh = cellHash(cx, cy, cz, bo.seed);
  const cell = bo.cell;
  const qx = (cx + (hh & 1023) * INV_2_10) * cell;
  const qy = (cy + ((hh >>> 10) & 1023) * INV_2_10) * cell;
  const qz = (cz + ((hh >>> 20) & 1023) * INV_2_10) * cell;
  const ql = Math.sqrt(qx * qx + qy * qy + qz * qz);
  const d0 = ql - R;
  const rho = bo.rho;
  if (d0 >= rho || d0 <= -rho) return false;
  hh = remix(hh);
  const u0 = (hh & 0xffff) * INV_2_16;
  if (u0 >= bo.dens) return false; // never a boulder even at maximum blockiness
  if (lateral) {
    // cheap reject before the (expensive) blockiness evaluation: p outside the largest outline
    const k = R / ql;
    const lx = qx * k - px;
    const ly = qy * k - py;
    const lz = qz * k - pz;
    const rmax = (rho * rho - d0 * d0) * BOULDER_EDGE_MAX * BOULDER_EDGE_MAX;
    if (lx * lx + ly * ly + lz * lz >= rmax) return false;
  }
  const ux = qx / ql;
  const uy = qy / ql;
  const uz = qz / ql;
  // keep-out around the landing site
  const kx = ux * R - SITE_P[0];
  const ky = uy * R - SITE_P[1];
  const kz = uz * R - SITE_P[2];
  const k2 = kx * kx + ky * ky + kz * kz;
  if (k2 < (SITE_KEEPOUT + rho) * (SITE_KEEPOUT + rho)) return false;
  // density: background + blockiness near fresh craters (evaluated at the boulder centre -> exact)
  const blk = blockinessAt(ux, uy, uz);
  const dens = bo.bg + (bo.dens - bo.bg) * (blk > 1 ? 1 : blk);
  let w = (dens - u0) * 30;
  if (w <= 0) return false;
  if (w > 1) w = 1;
  hh = remix(hh);
  // size inside the octave: steep power law (many cobbles, few large blocks)
  const us = ((hh >>> 24) & 255) / 255;
  const r = Math.sqrt(rho * rho - d0 * d0) * w * (0.32 + 0.68 * us * us);
  if (r < 0.05) return false;
  _bd.x = ux;
  _bd.y = uy;
  _bd.z = uz;
  _bd.r = r;
  _bd.vi = ((hh >>> 8) & 255) % NVAR;
  _bd.H = r * (0.75 + 0.65 * ((hh & 255) / 255)) * BOULDER_VARIANTS[_bd.vi].hs;
  const psi = ((hh >>> 16) & 1023) * INV_2_10 * Math.PI * 2;
  _bd.cps = Math.cos(psi);
  _bd.sps = Math.sin(psi);
  // local tangent frame (east, north) at the boulder
  let ex = -uy;
  let ey = ux;
  const el = Math.hypot(ex, ey) || 1;
  ex /= el;
  ey /= el;
  _bd.ex = ex;
  _bd.ey = ey;
  _bd.ez = 0;
  _bd.nx = -uz * ey;
  _bd.ny = uz * ex;
  _bd.nz = ux * ey - uy * ex;
  _bd.w = w;
  return true;
}

function boulderHeight(x, y, z, px, py, pz, lodW, nearSite, siteD2) {
  let hmax = 0;
  if (nearSite && siteD2 < SITE_KEEPOUT * SITE_KEEPOUT) return 0;
  for (let oi = 0; oi < BOULDER_OCT.length; oi++) {
    const bo = BOULDER_OCT[oi];
    if (2 * bo.rho < lodW) continue;
    const inv = 1 / bo.cell;
    const fx = px * inv;
    const fy = py * inv;
    const fz = pz * inv;
    let bx = Math.floor(fx);
    let by = Math.floor(fy);
    let bz = Math.floor(fz);
    if (fx - bx < 0.5) bx--;
    if (fy - by < 0.5) by--;
    if (fz - bz < 0.5) bz--;
    const lx = fx - bx;
    const ly = fy - by;
    const lz = fz - bz;
    // relevance radius in cell units: lateral outline (1.42 r) combined with the vertical offset
    const rr = bo.rho * BOULDER_EDGE_MAX * 1.01 * inv;
    const rr2 = rr * rr;
    const mx0 = lx > 1 ? (lx - 1) * (lx - 1) : 0;
    const mx1 = lx < 1 ? (1 - lx) * (1 - lx) : 0;
    const my0 = ly > 1 ? (ly - 1) * (ly - 1) : 0;
    const my1 = ly < 1 ? (1 - ly) * (1 - ly) : 0;
    const mz0 = lz > 1 ? (lz - 1) * (lz - 1) : 0;
    const mz1 = lz < 1 ? (1 - lz) * (1 - lz) : 0;
    for (let k = 0; k < 8; k++) {
      const ox = k & 1;
      const oy = (k >> 1) & 1;
      const oz = k >> 2;
      if ((ox ? mx1 : mx0) + (oy ? my1 : my0) + (oz ? mz1 : mz0) >= rr2) continue;
      const cx = bx + ox;
      const cy = by + oy;
      const cz = bz + oz;
      const hh = cellHash(cx, cy, cz, bo.seed);
      const dx = ox + (hh & 1023) * INV_2_10 - lx;
      const dy = oy + ((hh >>> 10) & 1023) * INV_2_10 - ly;
      const dz = oz + ((hh >>> 20) & 1023) * INV_2_10 - lz;
      if (dx * dx + dy * dy + dz * dz >= rr2) continue;
      if (!decodeBoulder(oi, cx, cy, cz, px, py, pz, true)) continue;
      // offset of p from the boulder centre in the boulder's tangent frame (m)
      const ex = (x - _bd.x) * R;
      const ey = (y - _bd.y) * R;
      const ez = (z - _bd.z) * R;
      const e = ex * _bd.ex + ey * _bd.ey + ez * _bd.ez;
      const n = ex * _bd.nx + ey * _bd.ny + ez * _bd.nz;
      const s = Math.sqrt(e * e + n * n);
      if (s >= _bd.r * BOULDER_EDGE_MAX) continue;
      let ct = 1;
      let st = 0;
      if (s > 1e-9) {
        ct = e / s;
        st = n / s;
      }
      // rotate into the boulder's own frame by -psi
      const c1 = ct * _bd.cps + st * _bd.sps;
      const s1 = st * _bd.cps - ct * _bd.sps;
      const hb = _bd.H * boulderProfile(_bd.vi, s / _bd.r, c1, s1);
      if (hb > hmax) hmax = hb;
    }
  }
  return hmax;
}

/**
 * Enumerate the boulders of boulder-octave `oi` whose centres lie in the patch spanned by a grid of
 * sample directions. `samples` is a Float64Array of unit directions (xyz triples) spaced no more than
 * half a boulder cell apart; `inside(x,y,z)` decides ownership (so each boulder belongs to one patch).
 * Calls cb(b) with b = {x,y,z (unit dir), r (footprint radius m), H (height m), vi (variant), cps, sps
 * (cos/sin of the rotation from local east toward north), ex..nz (local east/north unit vectors)}.
 */
export function enumerateBoulders(oi, samples, inside, cb) {
  const bo = BOULDER_OCT[oi];
  const inv = 1 / bo.cell;
  const seen = new Set();
  // numeric cell keys relative to the first sample's cell (patches span far fewer than 2^12 cells)
  const ox0 = Math.floor(samples[0] * R * inv) - 2048;
  const oy0 = Math.floor(samples[1] * R * inv) - 2048;
  const oz0 = Math.floor(samples[2] * R * inv) - 2048;
  for (let i = 0; i < samples.length; i += 3) {
    const px = samples[i] * R;
    const py = samples[i + 1] * R;
    const pz = samples[i + 2] * R;
    const fx = px * inv;
    const fy = py * inv;
    const fz = pz * inv;
    let bx = Math.floor(fx);
    let by = Math.floor(fy);
    let bz = Math.floor(fz);
    if (fx - bx < 0.5) bx--;
    if (fy - by < 0.5) by--;
    if (fz - bz < 0.5) bz--;
    for (let k = 0; k < 8; k++) {
      const cx = bx + (k & 1);
      const cy = by + ((k >> 1) & 1);
      const cz = bz + (k >> 2);
      const key = ((cx - ox0) * 4096 + (cy - oy0)) * 4096 + (cz - oz0);
      if (seen.has(key)) continue;
      seen.add(key);
      if (!decodeBoulder(oi, cx, cy, cz)) continue;
      if (!inside(_bd.x, _bd.y, _bd.z)) continue;
      cb(_bd);
    }
  }
}
/** Number of boulder octaves and their cell sizes / max diameters (for the renderer). */
export const BOULDER_OCTAVES = BOULDER_OCT.map((b) => ({ cell: b.cell, maxSize: 2 * b.rho }));

// ------------------------------------------------------------------------------------ public API
const _s = createSample();

/**
 * Terrain height (m above MOON.radius) at unit direction (x,y,z), full detail incl. boulders.
 * @param {number} x @param {number} y @param {number} z unit MCI direction
 * @returns {number}
 */
export function terrainHeight(x, y, z) {
  return evalSurface(x, y, z, 0, F_BOULDERS, _s).h;
}

/**
 * Terrain height skipping features smaller than `minFeatureSize` metres (distant chunks, shadow rays).
 * Features between minFeatureSize and 2x fade in smoothly.
 */
export function terrainHeightLOD(x, y, z, minFeatureSize) {
  return evalSurface(x, y, z, minFeatureSize > 0 ? minFeatureSize : 0, minFeatureSize < BOULDER_MAX_SIZE ? F_BOULDERS : 0, _s).h;
}

/** MOON.radius + terrainHeight. */
export function surfaceRadius(x, y, z) {
  return R + terrainHeight(x, y, z);
}

/**
 * Unit MCI surface normal at direction (x,y,z) from full-detail heights (finite differences, 0.25 m).
 * @param {{x:number,y:number,z:number}} out
 */
export function surfaceNormal(x, y, z, out = { x: 0, y: 0, z: 0 }) {
  const l = Math.hypot(x, y, z) || 1;
  x /= l;
  y /= l;
  z /= l;
  // tangent basis
  let ex = -y;
  let ey = x;
  let ez = 0;
  let el = Math.hypot(ex, ey);
  if (el < 1e-9) {
    ex = 1;
    ey = 0;
    el = 1;
  }
  ex /= el;
  ey /= el;
  const nx = y * ez - z * ey;
  const ny = z * ex - x * ez;
  const nz = x * ey - y * ex;
  const e = 0.25;
  const k = e / R;
  const h0 = terrainHeight(x, y, z);
  const r0 = R + h0;
  let ax = x + ex * k;
  let ay = y + ey * k;
  let az = z + ez * k;
  let al = Math.hypot(ax, ay, az);
  const r1 = R + terrainHeight(ax / al, ay / al, az / al);
  const p1x = (ax / al) * r1 - x * r0;
  const p1y = (ay / al) * r1 - y * r0;
  const p1z = (az / al) * r1 - z * r0;
  ax = x + nx * k;
  ay = y + ny * k;
  az = z + nz * k;
  al = Math.hypot(ax, ay, az);
  const r2 = R + terrainHeight(ax / al, ay / al, az / al);
  const p2x = (ax / al) * r2 - x * r0;
  const p2y = (ay / al) * r2 - y * r0;
  const p2z = (az / al) * r2 - z * r0;
  let cx = p1y * p2z - p1z * p2y;
  let cy = p1z * p2x - p1x * p2z;
  let cz = p1x * p2y - p1y * p2x;
  const cl = Math.hypot(cx, cy, cz) || 1;
  cx /= cl;
  cy /= cl;
  cz /= cl;
  if (cx * x + cy * y + cz * z < 0) {
    cx = -cx;
    cy = -cy;
    cz = -cz;
  }
  out.x = cx;
  out.y = cy;
  out.z = cz;
  return out;
}

/** Normal albedo (0..1) at unit direction (x,y,z): maria ~0.07, highlands ~0.15, fresh ejecta/rays brighter. */
export function albedo(x, y, z) {
  return evalSurface(x, y, z, 0, F_ALBEDO, _s).albedo;
}

/** Mare fraction 0 (highlands) .. 1 (mare basalt) at unit direction. */
export function mareMask(x, y, z) {
  evalMaria(x, y, z, 0);
  return SCR[0];
}

/** evalSurface flags: ALBEDO (albedo/freshness), BOULDERS (collidable rocks in h), BLOCK (blockiness only). */
export const SURFACE_FLAGS = { ALBEDO: F_ALBEDO, BOULDERS: F_BOULDERS, BLOCK: F_BLOCK };
/** Largest random-crater diameter (m) of each crater octave (for tools and tests). */
export const CRATER_OCTAVES = OCT_CELL.map((c) => c / 2);
