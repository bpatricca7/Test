// Star catalogue: the ~150 brightest real stars (so the constellations are right) plus a procedural
// fill down to magnitude 6.5 with the real magnitude distribution, colour distribution and
// concentration toward the galactic plane. Pure data/logic (no scene) — unit-tested.
//
// Owned by the SKY-FX agent.

import * as THREE from 'three';
import { raDecToMCI, galToMCI, galacticLatDeg } from './celestial.js';

// [name, RA (h, J2000), Dec (deg), V mag, B-V]
// prettier-ignore
export const BRIGHT_STARS = [
  ['Sirius', 6.7525, -16.716, -1.46, 0.00], ['Canopus', 6.3992, -52.696, -0.74, 0.15],
  ['Rigil Kentaurus', 14.6600, -60.835, -0.27, 0.71], ['Arcturus', 14.2610, 19.182, -0.05, 1.23],
  ['Vega', 18.6156, 38.784, 0.03, 0.00], ['Capella', 5.2782, 45.998, 0.08, 0.80],
  ['Rigel', 5.2423, -8.202, 0.13, -0.03], ['Procyon', 7.6550, 5.225, 0.34, 0.42],
  ['Achernar', 1.6286, -57.237, 0.46, -0.16], ['Betelgeuse', 5.9195, 7.407, 0.50, 1.85],
  ['Hadar', 14.0637, -60.373, 0.61, -0.23], ['Altair', 19.8464, 8.868, 0.76, 0.22],
  ['Acrux', 12.4433, -63.099, 0.76, -0.24], ['Aldebaran', 4.5987, 16.509, 0.86, 1.54],
  ['Antares', 16.4901, -26.432, 0.96, 1.83], ['Spica', 13.4199, -11.161, 0.97, -0.23],
  ['Pollux', 7.7553, 28.026, 1.14, 1.00], ['Fomalhaut', 22.9608, -29.622, 1.16, 0.09],
  ['Deneb', 20.6905, 45.280, 1.25, 0.09], ['Mimosa', 12.7954, -59.689, 1.25, -0.24],
  ['Regulus', 10.1395, 11.967, 1.40, -0.11], ['Adhara', 6.9771, -28.972, 1.50, -0.21],
  ['Castor', 7.5767, 31.888, 1.58, 0.03], ['Shaula', 17.5601, -37.104, 1.62, -0.22],
  ['Gacrux', 12.5194, -57.113, 1.63, 1.59], ['Bellatrix', 5.4189, 6.350, 1.64, -0.22],
  ['Elnath', 5.4382, 28.608, 1.65, -0.13], ['Miaplacidus', 9.2200, -69.717, 1.67, 0.07],
  ['Alnilam', 5.6036, -1.202, 1.69, -0.18], ['Regor', 8.1589, -47.337, 1.83, -0.22],
  ['Alnair', 22.1372, -46.961, 1.73, -0.13], ['Alnitak', 5.6793, -1.943, 1.77, -0.21],
  ['Alioth', 12.9005, 55.960, 1.77, -0.02], ['Dubhe', 11.0621, 61.751, 1.79, 1.07],
  ['Mirfak', 3.4054, 49.861, 1.80, 0.48], ['Wezen', 7.1399, -26.393, 1.83, 0.68],
  ['Sargas', 17.6219, -42.998, 1.86, 0.40], ['Kaus Australis', 18.4029, -34.385, 1.85, -0.03],
  ['Avior', 8.3752, -59.510, 1.86, 1.28], ['Alkaid', 13.7923, 49.313, 1.86, -0.10],
  ['Menkalinan', 5.9921, 44.948, 1.90, 0.08], ['Atria', 16.8111, -69.028, 1.92, 1.44],
  ['Alhena', 6.6285, 16.399, 1.93, 0.00], ['Peacock', 20.4275, -56.735, 1.94, -0.20],
  ['Alsephina', 8.7451, -54.709, 1.96, 0.04], ['Mirzam', 6.3783, -17.956, 1.98, -0.23],
  ['Alphard', 9.4598, -8.659, 1.98, 1.44], ['Polaris', 2.5303, 89.264, 1.98, 0.60],
  ['Hamal', 2.1196, 23.463, 2.00, 1.15], ['Algieba', 10.3329, 19.842, 2.08, 1.13],
  ['Diphda', 0.7265, -17.987, 2.04, 1.02], ['Nunki', 18.9211, -26.297, 2.05, -0.13],
  ['Menkent', 14.1114, -36.370, 2.06, 1.01], ['Mirach', 1.1622, 35.621, 2.05, 1.58],
  ['Alpheratz', 0.1398, 29.091, 2.06, -0.11], ['Rasalhague', 17.5822, 12.560, 2.08, 0.15],
  ['Kochab', 14.8451, 74.156, 2.08, 1.47], ['Saiph', 5.7959, -9.670, 2.09, -0.17],
  ['Denebola', 11.8177, 14.572, 2.14, 0.09], ['Algol', 3.1361, 40.956, 2.12, -0.05],
  ['Tiaki', 22.7111, -46.885, 2.07, 1.60], ['Muhlifain', 12.6919, -48.960, 2.17, -0.01],
  ['Aspidiske', 9.2848, -59.275, 2.21, 0.19], ['Suhail', 9.1333, -43.433, 2.21, 1.66],
  ['Alphecca', 15.5781, 26.715, 2.23, -0.02], ['Mintaka', 5.5334, -0.299, 2.23, -0.22],
  ['Sadr', 20.3705, 40.257, 2.23, 0.67], ['Eltanin', 17.9434, 51.489, 2.24, 1.52],
  ['Schedar', 0.6751, 56.537, 2.24, 1.17], ['Naos', 8.0597, -40.003, 2.25, -0.27],
  ['Almach', 2.0650, 42.330, 2.26, 1.37], ['Caph', 0.1529, 59.150, 2.28, 0.34],
  ['Izar', 14.7498, 27.074, 2.37, 0.97], ['Dschubba', 16.0056, -22.622, 2.29, -0.12],
  ['Merak', 11.0307, 56.382, 2.37, -0.02], ['Ankaa', 0.4381, -42.306, 2.40, 1.09],
  ['Enif', 21.7364, 9.875, 2.39, 1.52], ['Scheat', 23.0629, 28.083, 2.42, 1.67],
  ['Sabik', 17.1730, -15.725, 2.43, 0.06], ['Phecda', 11.8972, 53.695, 2.44, 0.04],
  ['Aludra', 7.4016, -29.303, 2.45, -0.08], ['Markab', 23.0793, 15.205, 2.49, -0.04],
  ['Navi', 0.9451, 60.717, 2.47, -0.15], ['Aljanah', 20.7702, 33.970, 2.48, 1.03],
  ['Mizar', 13.3988, 54.925, 2.23, 0.02], ['Epsilon Sco', 16.8361, -34.293, 2.29, 1.15],
  ['Epsilon Cen', 13.6648, -53.466, 2.30, -0.22], ['Alpha Lup', 14.6988, -47.388, 2.30, -0.20],
  ['Eta Cen', 14.5918, -42.158, 2.35, -0.19], ['Kappa Sco', 17.7081, -39.030, 2.39, -0.17],
  ['Alderamin', 21.3097, 62.585, 2.45, 0.26], ['Kappa Vel', 9.3685, -55.011, 2.47, -0.18],
  ['Zeta Cen', 13.9258, -47.288, 2.55, -0.22], ['Zeta Oph', 16.6193, -10.567, 2.56, 0.02],
  ['Menkar', 3.0380, 4.090, 2.54, 1.64], ['Zosma', 11.2351, 20.524, 2.56, 0.12],
  ['Arneb', 5.5455, -17.822, 2.58, 0.21], ['Gienah', 12.2634, -17.542, 2.59, -0.11],
  ['Ascella', 19.0435, -29.880, 2.60, 0.08], ['Zubeneschamali', 15.2835, -9.383, 2.61, -0.11],
  ['Unukalhai', 15.7378, 6.426, 2.63, 1.17], ['Theta Aur', 5.9954, 37.213, 2.62, -0.08],
  ['Sheratan', 1.9107, 20.808, 2.64, 0.13], ['Kraz', 12.5731, -23.397, 2.65, 0.89],
  ['Phact', 5.6613, -34.074, 2.65, -0.12], ['Acrab', 16.0906, -19.806, 2.62, -0.07],
  ['Ruchbah', 1.4303, 60.235, 2.68, 0.13], ['Muphrid', 13.9114, 18.398, 2.68, 0.58],
  ['Lesath', 17.5127, -37.296, 2.70, -0.22], ['Kaus Media', 18.3499, -29.828, 2.70, 1.38],
  ['Tarazed', 19.7710, 10.613, 2.72, 1.52], ['Porrima', 12.6943, -1.449, 2.74, 0.36],
  ['Zubenelgenubi', 14.8480, -16.042, 2.75, 0.15], ['Theta Car', 10.7159, -64.394, 2.76, -0.22],
  ['Kornephoros', 16.5037, 21.490, 2.77, 0.94], ['Hatysa', 5.5906, -5.910, 2.77, -0.24],
  ['Rastaban', 17.5072, 52.301, 2.79, 0.98], ['Delta Cru', 12.2524, -58.749, 2.79, -0.23],
  ['Cursa', 5.1308, -5.086, 2.79, 0.13], ['Beta Hyi', 0.4291, -77.254, 2.80, 0.62],
  ['Kaus Borealis', 18.4662, -25.421, 2.81, 1.04], ['Zeta Her', 16.6881, 31.603, 2.81, 0.65],
  ['Tau Sco', 16.5980, -28.216, 2.82, -0.25], ['Algenib', 0.2206, 15.184, 2.83, -0.23],
  ['Vindemiatrix', 13.0363, 10.959, 2.83, 0.94], ['Nihal', 5.4708, -20.759, 2.84, 0.82],
  ['Beta Ara', 17.4217, -55.530, 2.85, 1.46], ['Deneb Algedi', 21.7840, -16.127, 2.85, 0.29],
  ['Alpha Tuc', 22.3085, -60.260, 2.86, 1.39], ['Tejat', 6.3827, 22.514, 2.87, 1.64],
  ['Delta Cyg', 19.7496, 45.131, 2.87, -0.03], ['Alcyone', 3.7914, 24.105, 2.87, -0.09],
  ['Sigma Sco', 16.3531, -25.593, 2.89, 0.13], ['Gomeisa', 7.4525, 8.289, 2.89, -0.10],
  ['Sadalsuud', 21.5260, -5.571, 2.90, 0.83], ['Mebsuta', 6.7322, 25.131, 2.98, 1.40],
  ['Epsilon Leo', 9.7642, 23.774, 2.98, 0.81], ['Pherkad', 15.3455, 71.834, 3.00, 0.05],
  ['Albireo', 19.5120, 27.960, 3.05, 1.13], ['Sulafat', 18.9824, 32.690, 3.24, -0.05],
  ['Megrez', 12.2571, 57.033, 3.31, 0.08], ['Chertan', 11.2373, 15.430, 3.33, -0.01],
  ['Meissa', 5.5855, 9.934, 3.39, -0.16], ['Theta2 Tau', 4.4776, 15.871, 3.40, 0.18],
  ['Sheliak', 18.8347, 33.363, 3.52, 0.00], ['Epsilon Tau', 4.4769, 19.180, 3.53, 1.01],
  ['Epsilon Cru', 12.3564, -60.401, 3.59, 1.42], ['Atlas', 3.8193, 24.053, 3.62, -0.07],
  ['Gamma Tau', 4.3299, 15.628, 3.65, 0.99], ['Electra', 3.7479, 24.113, 3.70, -0.11],
  ['Delta Tau', 4.3822, 17.543, 3.76, 0.98], ['Maia', 3.7639, 24.368, 3.87, -0.07],
  ['Omega Cen', 13.4461, -47.479, 3.90, 0.60], ['Merope', 3.7721, 23.948, 4.18, -0.06],
  ['Taygeta', 3.7535, 24.467, 4.30, -0.11], ['Pleione', 3.8197, 24.137, 5.05, -0.08],
];

// Open clusters that read as tight knots of faint stars: [RA h, Dec deg, radius deg, count, mag range]
// prettier-ignore
const CLUSTERS = [
  [8.67, 19.98, 0.8, 22, [6.3, 7.4]], // Praesepe (M44)
  [2.33, 57.13, 0.35, 12, [6.4, 7.5]], // h Persei
  [2.37, 57.13, 0.35, 12, [6.4, 7.5]], // chi Persei
  [17.90, -34.79, 0.6, 16, [5.6, 7.3]], // Ptolemy's cluster (M7)
  [7.60, -14.48, 0.4, 10, [6.2, 7.4]], // M47 area
  [10.72, -64.39, 0.7, 14, [4.8, 7.0]], // Southern Pleiades (IC 2602)
  [16.90, -41.80, 0.4, 10, [5.8, 7.3]], // NGC 6231
];

/** Deterministic PRNG (mulberry32). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(rnd) {
  const u = Math.max(1e-9, rnd());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd());
}

/** Effective temperature (K) from B-V colour index (Ballesteros 2012). */
export function bvToKelvin(bv) {
  return 4600 * (1 / (0.92 * bv + 1.7) + 1 / (0.92 * bv + 0.62));
}

// CIE 1931 colour-matching functions, multi-lobe Gaussian fit (Wyman, Sloan & Shirley 2013).
function cie(l) {
  const g = (x, m, s1, s2) => {
    const t = (x - m) / (x < m ? s1 : s2);
    return Math.exp(-0.5 * t * t);
  };
  const x = 1.056 * g(l, 599.8, 37.9, 31.0) + 0.362 * g(l, 442.0, 16.0, 26.7) - 0.065 * g(l, 501.1, 20.4, 26.2);
  const y = 0.821 * g(l, 568.8, 46.9, 40.5) + 0.286 * g(l, 530.9, 16.3, 31.1);
  const z = 1.217 * g(l, 437.0, 11.8, 36.0) + 0.681 * g(l, 459.0, 26.0, 13.8);
  return [x, y, z];
}

/**
 * Linear-sRGB chromaticity of a black body at temperature T (K), normalised to unit luminance (Y=1).
 * @returns {number[]} [r, g, b]
 */
export function blackbodyRGB(T) {
  let X = 0;
  let Y = 0;
  let Z = 0;
  for (let l = 380; l <= 780; l += 5) {
    const lm = l * 1e-9;
    const B = 1 / (lm ** 5 * (Math.exp(1.4388e-2 / (lm * T)) - 1));
    const [x, y, z] = cie(l);
    X += B * x;
    Y += B * y;
    Z += B * z;
  }
  X /= Y;
  Z /= Y;
  Y = 1;
  const r = 3.2406 * X - 1.5372 * Y - 0.4986 * Z;
  const g = -0.9689 * X + 1.8758 * Y + 0.0415 * Z;
  const b = 0.0557 * X - 0.204 * Y + 1.057 * Z;
  return [Math.max(0, r), Math.max(0, g), Math.max(0, b)];
}

/**
 * Colour of a star of index B-V as seen by a camera: black-body chromaticity, partly desaturated
 * (star colours are pale to the eye and on film), unit luminance.
 */
export function starColor(bv, saturation = 0.75) {
  const [r, g, b] = blackbodyRGB(bvToKelvin(bv));
  // desaturate toward the luminance (Rec.709 weights), keep Y = 1
  const Y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const k = saturation;
  return [(Y + (r - Y) * k) / Y, (Y + (g - Y) * k) / Y, (Y + (b - Y) * k) / Y];
}

/** Draw a B-V index from the colour distribution of naked-eye stars. */
function randomBV(rnd) {
  const u = rnd();
  if (u < 0.3) return -0.1 + 0.13 * gauss(rnd); // B / A dwarfs
  if (u < 0.58) return 0.45 + 0.18 * gauss(rnd); // F / G
  if (u < 0.92) return 1.1 + 0.18 * gauss(rnd); // K giants (the red clump)
  return 1.6 + 0.1 * gauss(rnd); // M giants
}

/**
 * Build the star catalogue.
 * @param {object} [opts]
 * @param {number} [opts.count=9000] total stars
 * @param {number} [opts.limitMag=6.5] faintest magnitude
 * @param {number} [opts.seed=1969]
 * @returns {{count:number, dir:Float32Array, mag:Float32Array, color:Float32Array}} MCI unit
 *   directions, V magnitudes and linear colours (unit luminance), brightest first.
 */
export function buildStarCatalog({ count = 9000, limitMag = 6.5, seed = 1969 } = {}) {
  const rnd = mulberry32(seed);
  const stars = [];
  const v = new THREE.Vector3();
  for (const [, ra, dec, mag, bv] of BRIGHT_STARS) {
    raDecToMCI(ra, dec, v);
    stars.push([v.x, v.y, v.z, mag, bv]);
  }
  // clusters
  const c = new THREE.Vector3();
  const t1 = new THREE.Vector3();
  const t2 = new THREE.Vector3();
  for (const [ra, dec, rad, n, [m0, m1]] of CLUSTERS) {
    raDecToMCI(ra, dec, c);
    t1.set(-c.y, c.x, 0).normalize();
    t2.crossVectors(c, t1);
    for (let i = 0; i < n; i++) {
      const r = rad * Math.sqrt(rnd()) * (Math.PI / 180);
      const a = rnd() * Math.PI * 2;
      v.copy(c).addScaledVector(t1, r * Math.cos(a)).addScaledVector(t2, r * Math.sin(a)).normalize();
      stars.push([v.x, v.y, v.z, m0 + (m1 - m0) * rnd(), randomBV(rnd)]);
    }
  }
  // procedural fill: cumulative counts N(<m) ~ 10^(0.49 m) (Seares/Allen, naked-eye range)
  const brightLimit = 2.9; // everything brighter is in the real table
  const slope = 0.49;
  const nFill = Math.max(0, count - stars.length);
  const a0 = Math.pow(10, slope * brightLimit);
  const a1 = Math.pow(10, slope * limitMag);
  let made = 0;
  let guard = 0;
  while (made < nFill && guard++ < nFill * 50) {
    const mag = Math.log10(a0 + (a1 - a0) * rnd()) / slope;
    // uniform direction
    const z = rnd() * 2 - 1;
    const phi = rnd() * Math.PI * 2;
    const s = Math.sqrt(1 - z * z);
    v.set(s * Math.cos(phi), s * Math.sin(phi), z);
    // galactic concentration grows for fainter stars (disc stars dominate the faint counts)
    const b = Math.abs(galacticLatDeg(v));
    const A = 0.4 + 2.2 * (mag - brightLimit) / (limitMag - brightLimit);
    const p = (1 + A * Math.exp(-b / 12)) / (1 + A);
    if (rnd() > p) continue;
    stars.push([v.x, v.y, v.z, mag, randomBV(rnd)]);
    made++;
  }
  stars.sort((p, q) => p[3] - q[3]);
  const N = stars.length;
  const dir = new Float32Array(N * 3);
  const mag = new Float32Array(N);
  const color = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const s = stars[i];
    dir[i * 3] = s[0];
    dir[i * 3 + 1] = s[1];
    dir[i * 3 + 2] = s[2];
    mag[i] = s[3];
    const col = starColor(s[4]);
    color.set(col, i * 3);
  }
  return { count: N, dir, mag, color };
}

/** Sky glow centres that are not stars: [name, RA h, Dec deg, major deg, minor deg, PA deg, V mag]. */
// prettier-ignore
export const DEEP_SKY = [
  ['M31', 0.712, 41.27, 3.0, 1.0, 35, 3.4],
  ['LMC', 5.39, -69.76, 5.5, 4.5, 0, 0.9],
  ['SMC', 0.88, -72.83, 3.0, 1.8, 45, 2.7],
  ['Omega Cen', 13.446, -47.48, 0.35, 0.35, 0, 3.9],
  ['M42', 5.588, -5.39, 0.6, 0.5, 0, 4.0],
];

/** MCI direction of a named DEEP_SKY object (helper for the Milky Way generator/tests). */
export function deepSkyDir(name, out = new THREE.Vector3()) {
  const o = DEEP_SKY.find((d) => d[0] === name);
  return o ? raDecToMCI(o[1], o[2], out) : null;
}

export { galToMCI };
