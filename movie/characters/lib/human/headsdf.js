// The head sculpt: a signed distance field built from smooth unions of
// ellipsoids and round cones, with carved eye sockets, lid shells around the
// eyeballs, swept lip profiles and a knife-thin mouth groove.
// Head-local frame: metres, +Y up, +Z forward (the face), +X = character's left.
// Origin: between the eyes at eye-centre height, roughly above the ear canals.

import { ellipsoid, ellipsoidR, roundCone, sphere, smin, smax, clamp, sstep, mix } from './sdf.js';

export const HEAD_PARAMS = {
  maya: {
    scale: 1.0,
    cranium: [0, 0.030, -0.020, 0.071, 0.088, 0.091],
    forehead: [0, 0.036, 0.020, 0.062, 0.060, 0.063],
    brow: { y: 0.027, z: 0.064, x: 0.029, r: [0.026, 0.009, 0.0155], k: 0.012 },
    midface: [0, -0.030, 0.030, 0.058, 0.054, 0.051],
    cheek: { x: 0.039, y: -0.029, z: 0.055, r: [0.025, 0.021, 0.024], k: 0.014 },
    zyg: { a: [0.050, -0.012, 0.034], b: [0.060, -0.010, 0.000], r: 0.009 },
    jaw: [0, -0.068, 0.034, 0.046, 0.034, 0.050],
    chin: [0, -0.093, 0.069, 0.017, 0.015, 0.016],
    tmj: [0.054, -0.022, -0.014], jawAngle: [0.047, -0.066, -0.006], chinSide: [0.016, -0.097, 0.058], jawR: [0.011, 0.013, 0.011],
    neck: { top: [0, -0.055, -0.028], bot: [0, -0.215, -0.034], r: [0.048, 0.053] },
    eye: { x: 0.0325, y: 0.0, z: 0.058, R: 0.0145, lid: 0.0017 },
    socket: { c: [0.034, 0.003, 0.071], r: [0.0175, 0.0125, 0.0135], k: 0.005 },
    pad: [0.034, 0.0128, 0.0635, 0.0165, 0.0062, 0.0085], medial: [0.0132, 0.002, 0.0668, 0.0048, 0.0105, 0.0072],
    nose: { bridgeTop: [0, 0.009, 0.073], tip: [0, -0.022, 0.097], rb: 0.0068, rt: 0.0088, tipR: 0.0108,
      alaX: 0.0122, alaY: -0.0295, alaZ: 0.0865, alaR: 0.0082, bottom: -0.0355 },
    mouth: { w: 0.0235, y: -0.0585, z: 0.0915, wrap: 0.013, cornerUp: 0.0012,
      upH: 0.0068, upBow: 0.0010, upT: 0.0070, loH: 0.0092, loT: 0.0082 },
    muzzle: [0, -0.057, 0.062, 0.032, 0.028, 0.027],
    earPos: [0.070, -0.012, -0.012],
    age: 1,
  },
  sam: {
    scale: 1.035,
    cranium: [0, 0.029, -0.022, 0.069, 0.088, 0.093],
    forehead: [0, 0.036, 0.018, 0.060, 0.062, 0.063],
    brow: { y: 0.028, z: 0.065, x: 0.029, r: [0.027, 0.0095, 0.0155], k: 0.012 },
    midface: [0, -0.034, 0.029, 0.057, 0.060, 0.051],
    cheek: { x: 0.041, y: -0.026, z: 0.051, r: [0.024, 0.019, 0.022], k: 0.012 },
    zyg: { a: [0.052, -0.010, 0.034], b: [0.061, -0.008, 0.000], r: 0.010 },
    jaw: [0, -0.076, 0.032, 0.049, 0.038, 0.052],
    chin: [0, -0.105, 0.067, 0.019, 0.016, 0.017],
    tmj: [0.057, -0.022, -0.014], jawAngle: [0.052, -0.074, -0.008], chinSide: [0.020, -0.108, 0.056], jawR: [0.013, 0.016, 0.013],
    neck: { top: [0, -0.055, -0.030], bot: [0, -0.235, -0.036], r: [0.052, 0.057] },
    eye: { x: 0.0330, y: 0.0, z: 0.058, R: 0.0150, lid: 0.0016 },
    socket: { c: [0.0345, 0.003, 0.071], r: [0.018, 0.013, 0.0135], k: 0.005 },
    pad: [0.0345, 0.0135, 0.0632, 0.017, 0.0062, 0.0085], medial: [0.0134, 0.002, 0.0666, 0.005, 0.011, 0.0072],
    nose: { bridgeTop: [0, 0.009, 0.072], tip: [0, -0.026, 0.096], rb: 0.0068, rt: 0.0102, tipR: 0.0118,
      alaX: 0.0148, alaY: -0.0335, alaZ: 0.0850, alaR: 0.0094, bottom: -0.0395 },
    mouth: { w: 0.0255, y: -0.0635, z: 0.0915, wrap: 0.013, cornerUp: 0.0008,
      upH: 0.0076, upBow: 0.0010, upT: 0.0076, loH: 0.0100, loT: 0.0088 },
    muzzle: [0, -0.062, 0.061, 0.034, 0.030, 0.028],
    earPos: [0.068, -0.014, -0.014],
    age: 0,
  },
};

/**
 * Lip-line geometry shared by the SDF and the face mesh builder.
 * s in [-1, 1] across the mouth; returns y/z of the crease and the
 * vermilion heights.
 */
export function makeMouth(M) {
  const lineY = x => {
    const s = x / M.w;
    return M.y + M.cornerUp * s * s * s * s - 0.0007 * Math.exp(-((x / 0.0055) ** 2));
  };
  const lineZ = x => { const s = clamp(Math.abs(x) / M.w, 0, 1.4); return M.z - M.wrap * s * s; };
  // vermilion heights (upper lip has the cupid's bow)
  const upH = x => {
    const s = clamp(Math.abs(x) / M.w);
    const bow = M.upBow * Math.exp(-(((Math.abs(x) - 0.0055) / 0.0035) ** 2)) - M.upBow * 0.9 * Math.exp(-((x / 0.0022) ** 2));
    return (M.upH * (1 - s * s * 0.72) + bow) * Math.sqrt(1 - Math.min(0.999, s ** 6));
  };
  const loH = x => {
    const s = clamp(Math.abs(x) / M.w);
    return M.loH * (1 - s * s * 0.62) * Math.sqrt(1 - Math.min(0.999, s ** 5));
  };
  return { lineY, lineZ, upH, loH, w: M.w };
}

export function buildHeadSDF(P) {
  const E = P.eye, M = P.mouth, N = P.nose;
  const mouth = makeMouth(M);
  const e = a => ellipsoid(a[0], a[1], a[2], a[3], a[4], a[5]);
  const cranium = e(P.cranium), forehead = e(P.forehead), midface = e(P.midface);
  const jaw = e(P.jaw), chin = e(P.chin), muzzle = e(P.muzzle);
  const browL = ellipsoid(P.brow.x, P.brow.y, P.brow.z, ...P.brow.r);
  const browR = ellipsoid(-P.brow.x, P.brow.y, P.brow.z, ...P.brow.r);
  const cheekL = ellipsoidR(P.cheek.x, P.cheek.y, P.cheek.z, ...P.cheek.r, 0.35, 0, 0);
  const cheekR = ellipsoidR(-P.cheek.x, P.cheek.y, P.cheek.z, ...P.cheek.r, -0.35, 0, 0);
  const ja = P.jawAngle, cs = P.chinSide, tj = P.tmj, jr = P.jawR;
  const ramusL = roundCone(tj[0], tj[1], tj[2], ja[0], ja[1], ja[2], jr[0], jr[1]);
  const ramusR = roundCone(-tj[0], tj[1], tj[2], -ja[0], ja[1], ja[2], jr[0], jr[1]);
  const jawL = roundCone(ja[0], ja[1], ja[2], cs[0], cs[1], cs[2], jr[1], jr[2]);
  const jawR = roundCone(-ja[0], ja[1], ja[2], -cs[0], cs[1], cs[2], jr[1], jr[2]);
  const Z = P.zyg;
  const zygL = roundCone(Z.a[0], Z.a[1], Z.a[2], Z.b[0], Z.b[1], Z.b[2], Z.r, Z.r * 0.8);
  const zygR = roundCone(-Z.a[0], Z.a[1], Z.a[2], -Z.b[0], Z.b[1], Z.b[2], Z.r, Z.r * 0.8);
  const nk = P.neck;
  const neck = roundCone(nk.top[0], nk.top[1], nk.top[2], nk.bot[0], nk.bot[1], nk.bot[2], nk.r[0], nk.r[1]);
  // throat / sternocleidomastoid hints
  const scmL = roundCone(0.040, -0.05, -0.035, 0.012, -0.2, 0.010, 0.012, 0.011);
  const scmR = roundCone(-0.040, -0.05, -0.035, -0.012, -0.2, 0.010, 0.012, 0.011);
  // nose
  const bt = N.bridgeTop, tp = N.tip;
  const bridge = roundCone(bt[0], bt[1], bt[2], tp[0], tp[1] + 0.004, tp[2] - 0.004, N.rb, N.rt);
  const tip = sphere(tp[0], tp[1], tp[2], N.tipR);
  const alaL = ellipsoidR(N.alaX, N.alaY, N.alaZ, N.alaR * 0.8, N.alaR * 0.8, N.alaR * 1.15, 0.55, 0, 0);
  const alaR = ellipsoidR(-N.alaX, N.alaY, N.alaZ, N.alaR * 0.8, N.alaR * 0.8, N.alaR * 1.15, -0.55, 0, 0);
  const nostrilL = ellipsoidR(N.alaX * 0.52, N.bottom - 0.0005, tp[2] - 0.006, 0.0042, 0.0026, 0.0056, 0.35, 0.25, 0);
  const nostrilR = ellipsoidR(-N.alaX * 0.52, N.bottom - 0.0005, tp[2] - 0.006, 0.0042, 0.0026, 0.0056, -0.35, 0.25, 0);
  // philtrum ridges
  const mz = y0 => { const m = P.muzzle; const q = 1 - ((y0 - m[1]) / m[4]) ** 2; return m[2] + m[5] * Math.sqrt(Math.max(0, q)); };
  const phY0 = M.y + M.upH * 0.95, phY1 = mix(phY0, N.bottom, 0.62);
  const phL = roundCone(0.0043, phY0, mz(phY0) - 0.0012, 0.0036, phY1, mz(phY1) - 0.0014, 0.0019, 0.0016);
  const phR = roundCone(-0.0043, phY0, mz(phY0) - 0.0012, -0.0036, phY1, mz(phY1) - 0.0014, 0.0019, 0.0016);
  // eyes
  const shellR = E.R + E.lid;
  const eyeShellL = sphere(E.x, E.y, E.z, shellR);
  const eyeShellR = sphere(-E.x, E.y, E.z, shellR);
  const S = P.socket;
  const socketL = ellipsoid(S.c[0], S.c[1], S.c[2], ...S.r);
  const socketR = ellipsoid(-S.c[0], S.c[1], S.c[2], ...S.r);
  const pd = P.pad, md = P.medial;
  const padEL = ellipsoidR(pd[0], pd[1], pd[2], pd[3], pd[4], pd[5], -0.1, 0.2, -0.1);
  const padER = ellipsoidR(-pd[0], pd[1], pd[2], pd[3], pd[4], pd[5], 0.1, 0.2, 0.1);
  const medL = ellipsoid(md[0], md[1], md[2], md[3], md[4], md[5]);
  const medR = ellipsoid(-md[0], md[1], md[2], md[3], md[4], md[5]);

  // swept lip profile: an ellipse in the (y,z) plane at each x
  const lipUpper = (x, y, z) => {
    const ax = Math.abs(x);
    const h = mouth.upH(x);
    if (ax > M.w * 1.02) return 0.02;
    const ly = mouth.lineY(x), lz = mouth.lineZ(x);
    const s = clamp(ax / M.w);
    const t = M.upT * (1 - 0.55 * s * s);
    const cy = ly + h * 0.46, cz = lz - t * 0.25;
    const ry = Math.max(h * 0.62, 0.0006), rz = Math.max(t, 0.0008);
    const py = (y - cy) / ry, pz = (z - cz) / rz;
    const k0 = Math.hypot(py, pz), k1 = Math.hypot(py / ry, pz / rz);
    const d2 = k0 * (k0 - 1) / k1;
    return Math.max(d2, ax - M.w * 1.02);
  };
  const lipLower = (x, y, z) => {
    const ax = Math.abs(x);
    if (ax > M.w * 1.02) return 0.02;
    const h = mouth.loH(x);
    const ly = mouth.lineY(x), lz = mouth.lineZ(x);
    const s = clamp(ax / M.w);
    const t = M.loT * (1 - 0.5 * s * s);
    const cy = ly - h * 0.47, cz = lz - t * 0.32;
    const ry = Math.max(h * 0.62, 0.0006), rz = Math.max(t, 0.0008);
    const py = (y - cy) / ry, pz = (z - cz) / rz;
    const k0 = Math.hypot(py, pz), k1 = Math.hypot(py / ry, pz / rz);
    const d2 = k0 * (k0 - 1) / k1;
    return Math.max(d2, ax - M.w * 1.02);
  };
  // the knife-thin groove between the lips, from the front down to the crease
  const groove = (x, y, z) => {
    const ax = Math.abs(x);
    const ly = mouth.lineY(x), lz = mouth.lineZ(x);
    const open = Math.max(0, z - lz);
    const half = 0.00012 + 0.32 * open;
    return Math.max(Math.abs(y - ly) - half, lz - z, ax - M.w * 0.995);
  };

  const age = P.age || 0;
  // Maya: soft under-eye fullness and cheek pads that make gentle smile folds
  const bagL = ellipsoidR(E.x + 0.002, E.y - 0.0145, E.z + 0.009, 0.012, 0.0045, 0.009, 0.1, 0.35, 0);
  const bagR = ellipsoidR(-E.x - 0.002, E.y - 0.0145, E.z + 0.009, 0.012, 0.0045, 0.009, -0.1, 0.35, 0);
  const padL = ellipsoidR(0.030, -0.046, 0.068, 0.014, 0.017, 0.013, 0.5, 0.2, -0.3);
  const padR = ellipsoidR(-0.030, -0.046, 0.068, 0.014, 0.017, 0.013, -0.5, 0.2, 0.3);

  // conservative culling: a group only changes the field where its bounding
  // sphere comes within reach of the current value (+ blend radius)
  const bs = (c, r) => ({ c, r });
  const gEyes = bs([0, E.y, E.z + 0.006], E.x + shellR + 0.012);
  const gNose = bs([0, (bt[1] + N.bottom) / 2, (bt[2] + tp[2]) / 2 + 0.004], 0.036);
  const gMouth = bs([0, M.y, M.z - 0.004], M.w + 0.016);
  const gBrow = bs([0, P.brow.y, P.brow.z], P.brow.x + P.brow.r[0] + 0.004);
  const gCheek = bs([0, P.cheek.y, P.cheek.z], P.cheek.x + P.cheek.r[0] + 0.01);
  const lb = (g, x, y, z) => Math.hypot(x - g.c[0], y - g.c[1], z - g.c[2]) - g.r;

  const f = (x, y, z) => {
    // skull + face masses
    let d = smin(cranium(x, y, z), forehead(x, y, z), 0.03);
    d = smin(d, midface(x, y, z), 0.028);
    d = smin(d, jaw(x, y, z), 0.024);
    d = smin(d, Math.min(ramusL(x, y, z), ramusR(x, y, z)), 0.03);
    d = smin(d, Math.min(jawL(x, y, z), jawR(x, y, z)), 0.022);
    d = smin(d, chin(x, y, z), 0.016);
    d = smin(d, neck(x, y, z), 0.028);
    d = smin(d, Math.min(scmL(x, y, z), scmR(x, y, z)), 0.02);
    d = smin(d, Math.min(zygL(x, y, z), zygR(x, y, z)), 0.03);
    d = smin(d, muzzle(x, y, z), 0.016);
    if (lb(gBrow, x, y, z) < d + P.brow.k) d = smin(d, Math.min(browL(x, y, z), browR(x, y, z)), P.brow.k);
    if (lb(gCheek, x, y, z) < d + P.cheek.k) d = smin(d, Math.min(cheekL(x, y, z), cheekR(x, y, z)), P.cheek.k);
    if (age > 0 && lb(gMouth, x, y, z) < d + 0.03) d = smin(d, Math.min(padL(x, y, z), padR(x, y, z)), 0.008);
    // eye sockets, then the lid shells around the eyeballs
    const le = lb(gEyes, x, y, z);
    if (le < S.k - d) d = smax(d, -Math.min(socketL(x, y, z), socketR(x, y, z)), S.k);
    if (le < d + 0.0032) d = smin(d, Math.min(eyeShellL(x, y, z), eyeShellR(x, y, z)), 0.0032);
    if (le < d + 0.005) {
      d = smin(d, Math.min(padEL(x, y, z), padER(x, y, z)), 0.005);
      d = smin(d, Math.min(medL(x, y, z), medR(x, y, z)), 0.004);
    }
    if (age > 0 && le < d + 0.004) d = smin(d, Math.min(bagL(x, y, z), bagR(x, y, z)), 0.004);
    // nose
    const ln = lb(gNose, x, y, z);
    if (ln < d + 0.011) {
      d = smin(d, bridge(x, y, z), 0.011);
      d = smin(d, tip(x, y, z), 0.008);
      d = smin(d, Math.min(alaL(x, y, z), alaR(x, y, z)), 0.006);
    }
    if (ln < 0.002 - d) d = smax(d, -Math.min(nostrilL(x, y, z), nostrilR(x, y, z)), 0.002);
    // lips: hard union between them keeps the crease crisp
    const lm = lb(gMouth, x, y, z);
    if (lm < d + 0.003) {
      d = smin(d, Math.min(phL(x, y, z), phR(x, y, z)), 0.003);
      const lips = Math.min(lipUpper(x, y, z), lipLower(x, y, z));
      d = smin(d, lips, 0.0024);
    }
    if (lm < 0.0004 - d) d = smax(d, -groove(x, y, z), 0.0004);
    return d;
  };

  const landmarks = {
    eyeL: [E.x, E.y, E.z], eyeR: [-E.x, E.y, E.z], eyeRadius: E.R, shellR,
    mouth, mouthW: M.w, mouthY: M.y, mouthZ: M.z,
    noseTip: [tp[0], tp[1], tp[2] + N.tipR], noseBottom: N.bottom,
    chin: [P.chin[0], P.chin[1] - P.chin[4], P.chin[2]],
    crown: [0, P.cranium[1] + P.cranium[4], P.cranium[2]],
    ear: P.earPos,
    jawPivot: [0, -0.012, -0.012],
    neckTop: nk.top, neckBot: nk.bot, neckR: nk.r,
  };
  return { f, landmarks, mouth, lipUpper, lipLower };
}
