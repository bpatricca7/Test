// Bodies and clothes: skinned lofts on the shared skeleton.
//   maya: cream shirt + moss knit cardigan (open front, rib hem/cuffs/bands,
//         buttons, patch pockets), dark wool trousers, leather flats
//   sam:  faded mustard hoodie (kangaroo pocket, rib hem/cuffs, hood,
//         drawstrings), jeans, white sneakers
import * as THREE from 'three';
import { BODY, bindJoints } from './rig.js';
import { loft, toGeometry, torsoShape, sgnpow } from './loft.js';

const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
const mix = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);

// torso sections: [y, a, bF, bB, cz, n, mat]
const TORSO = {
  maya: [
    [0.79, 0.07, 0.05, 0.055, -0.004, 2.1, 1],
    [0.815, 0.128, 0.078, 0.086, -0.006, 2.2, 1],
    [0.845, 0.166, 0.092, 0.108, -0.008, 2.35, 1],
    [0.875, 0.176, 0.098, 0.118, -0.01, 2.4, 1],
    [0.925, 0.180, 0.098, 0.118, -0.012, 2.4, 1],
    [0.975, 0.160, 0.094, 0.100, -0.012, 2.35, 1],
    [0.992, 0.156, 0.096, 0.098, -0.012, 2.35, 0],
    [1.05, 0.148, 0.098, 0.092, -0.012, 2.3, 0],
    [1.11, 0.150, 0.106, 0.090, -0.012, 2.3, 0],
    [1.17, 0.156, 0.120, 0.090, -0.010, 2.3, 0],
    [1.22, 0.163, 0.130, 0.092, -0.012, 2.4, 0],
    [1.27, 0.168, 0.116, 0.095, -0.018, 2.5, 0],
    [1.31, 0.178, 0.098, 0.098, -0.026, 2.8, 0],
    [1.345, 0.186, 0.082, 0.088, -0.030, 2.9, 0],
    [1.368, 0.178, 0.072, 0.078, -0.032, 2.9, 0],
    [1.385, 0.142, 0.066, 0.071, -0.034, 2.5, 0],
    [1.40, 0.078, 0.058, 0.062, -0.034, 2.0, 0],
  ],
  sam: [
    [0.86, 0.074, 0.056, 0.06, -0.006, 2.1, 1],
    [0.885, 0.135, 0.084, 0.09, -0.007, 2.2, 1],
    [0.915, 0.164, 0.098, 0.108, -0.008, 2.35, 1],
    [0.945, 0.172, 0.100, 0.112, -0.01, 2.4, 1],
    [0.965, 0.172, 0.100, 0.110, -0.01, 2.4, 1],
    [0.975, 0.168, 0.098, 0.106, -0.01, 2.4, 1],
    // hoodie hem: rolls out over the jeans
    [0.977, 0.176, 0.110, 0.114, -0.01, 2.5, 2],
    [0.992, 0.188, 0.118, 0.12, -0.01, 2.5, 2],
    [1.035, 0.188, 0.118, 0.118, -0.012, 2.5, 0],
    [1.10, 0.184, 0.120, 0.112, -0.014, 2.5, 0],
    [1.17, 0.182, 0.124, 0.108, -0.016, 2.5, 0],
    [1.24, 0.186, 0.128, 0.108, -0.018, 2.55, 0],
    [1.31, 0.192, 0.124, 0.110, -0.022, 2.7, 0],
    [1.37, 0.200, 0.114, 0.108, -0.026, 2.9, 0],
    [1.42, 0.204, 0.098, 0.100, -0.030, 3.0, 0],
    [1.452, 0.212, 0.090, 0.095, -0.034, 3.0, 0],
    [1.476, 0.204, 0.080, 0.088, -0.036, 3.0, 0],
    [1.494, 0.160, 0.074, 0.082, -0.038, 2.5, 0],
    [1.51, 0.088, 0.066, 0.072, -0.040, 2.0, 0],
  ],
};

export function buildBody(id, rig, mats, rnd) {
  const B = BODY[id];
  const J = rig.J;
  const bi = name => rig.list.indexOf(rig.bones[name]);
  const parts = { skin: [], cloth: {} };
  const addPart = (matKey, part) => { (parts.cloth[matKey] = parts.cloth[matKey] || []).push(part); };

  // ------------------------------------------------------------ torso
  const T = TORSO[id];
  const yHipJ = B.hip[1], yWaist = J.spine.y, yChest = J.chest.y, yNeck = J.neck.y;
  const shoulderL = J.upperL, shoulderR = J.upperR;
  const torsoWeights = (i, th, p) => {
    const y = p.y;
    const w = [];
    const wh = 1 - sstep(yWaist - 0.05, yWaist + 0.05, y);
    const wc = sstep(yChest - 0.08, yChest + 0.04, y);
    const wn = sstep(yNeck - 0.02, yNeck + 0.03, y);
    const ws = (1 - wh) * (1 - wc);
    // shoulders follow the clavicles and a bit of the upper arm
    const dL = p.distanceTo(shoulderL), dR = p.distanceTo(shoulderR);
    const sL = sstep(0.15, 0.05, dL) * sstep(yChest, yChest + 0.1, y), sR = sstep(0.15, 0.05, dR) * sstep(yChest, yChest + 0.1, y);
    const uL = sstep(0.11, 0.025, dL) * (p.x > shoulderL.x - 0.04 ? 1.5 : 0.4), uR = sstep(0.11, 0.025, dR) * (p.x < shoulderR.x + 0.04 ? 1.5 : 0.4);
    const core = 1 - Math.max(sL, sR);
    w.push([bi('hips'), wh * core], [bi('spine'), ws * core], [bi('chest'), wc * (1 - wn) * core], [bi('neck'), wn * core]);
    w.push([bi('clavL'), sL * (1 - uL * 0.5)], [bi('upperL'), sL * uL * 0.5], [bi('clavR'), sR * (1 - uR * 0.5)], [bi('upperR'), sR * uR * 0.5]);
    // thighs pull the crotch/buttocks a little
    if (y < yHipJ + 0.02) {
      const tl = sstep(yHipJ + 0.02, yHipJ - 0.07, y) * 0.35;
      w.push([bi(p.x > 0 ? 'thighL' : 'thighR'), tl]);
      w[0][1] *= 1 - tl;
    }
    // hem swing for loose tops
    return w;
  };
  const stations = T.map(r => ({ c: V3(0, r[0], r[4]), X: V3(1, 0, 0), Z: V3(0, 0, 1), shape: torsoShape(r[1], r[2], r[3], r[5]), mat: r[6], r }));
  // fabric folds: soft vertical drape + waist bunching
  const torsoOffset = (i, th) => {
    const r = T[i];
    let o = 0;
    if (id === 'sam' && r[6] === 0) o += 0.0025 * Math.sin(th * 7 + r[0] * 30) * sstep(1.3, 1.0, r[0]) + 0.002 * Math.sin(th * 3 + 1.1);
    if (id === 'maya' && r[6] === 0) o += 0.001 * Math.sin(th * 9 + r[0] * 20);
    return o;
  };
  const torsoColor = (i, th, p) => {
    const r = T[i];
    let k = 1;
    if (id === 'sam') {
      if (r[6] === 0 || r[6] === 2) k = 1.0 + 0.1 * sstep(1.25, 1.45, p.y) * Math.max(0, Math.cos(th)) - 0.05 * sstep(1.1, 0.98, p.y);
      else k = 1 + 0.12 * Math.exp(-(((p.y - 0.9) / 0.04) ** 2)) * Math.max(0, Math.cos(th)); // denim fade at the crotch/front
    }
    return [k, k, k];
  };
  const torso = loft(stations, { M: 64, rRef: 0.16, weights: torsoWeights, offset: torsoOffset, color: torsoColor, capStart: true });
  const torsoMatKeys = id === 'maya' ? ['shirt', 'trousers'] : ['hoodie', 'jeans', 'hoodieRib'];
  splitByMat(torso, torsoMatKeys, addPart);

  // --------------------------------------------------------- cardigan
  if (id === 'maya') {
    const off = 0.012;
    const cardRows = T.filter(r => r[0] >= 0.83 && r[0] <= 1.37);
    // hem sits at the hips, slightly flared
    const cst = [];
    const hemY = 0.855;
    const rowsY = [hemY, 0.875, 0.905, 0.94, 0.975, 1.01, 1.05, 1.1, 1.15, 1.2, 1.245, 1.285, 1.315, 1.345, 1.368, 1.388];
    void cardRows;
    const interp = y => {
      let k = 0; while (k < T.length - 2 && T[k + 1][0] < y) k++;
      const a = T[k], b = T[k + 1]; const f = clamp((y - a[0]) / (b[0] - a[0]));
      return a.map((q, i) => i === 6 ? a[6] : mix(q, b[i], f));
    };
    for (const y of rowsY) {
      const r = interp(y);
      const flare = y < 0.95 ? (0.95 - y) * 0.18 : 0;
      const slack = y > 1.1 ? 0.004 : 0.008;
      const isRib = y < hemY + 0.04 ? 1 : 0;
      cst.push({ c: V3(0, y, r[4]), X: V3(1, 0, 0), Z: V3(0, 0, 1),
        shape: torsoShape(r[1] + off + flare + slack, r[2] + off + flare * 0.6, r[3] + off + flare * 0.5 + slack, Math.min(r[5], 2.6)), mat: isRib, y });
    }
    // open front: the gap widens into a V at the neck
    const openAt = i => cardiganOpenAt(cst[i].y);
    const cardW = (i, th, p) => {
      const w = torsoWeights(i, th, p);
      // the lower cardigan hangs from the hem bone for follow-through
      const hs = sstep(1.02, 0.86, p.y) * (Math.cos(th) > 0 ? 0.85 : 0.5);
      for (const q of w) q[1] *= 1 - hs;
      w.push([bi('hem'), hs]);
      return w;
    };
    const card = loft(cst, {
      M: 58, rRef: 0.17, th0: i => openAt(i), th1: i => Math.PI * 2 - openAt(i),
      weights: cardW, offset: (i, th) => 0.0012 * Math.sin(th * 11 + i) * sstep(1.2, 0.9, cst[i].y),
      color: (i, th) => { const k = 0.97 + 0.03 * Math.sin(th * 3 + i); return [k, k, k]; },
    });
    splitByMat(card, ['knit', 'knitRib'], addPart);
    // button bands: thick rolled edges along both openings
    for (const side of [1, -1]) {
      const bst = cst.map((s, i) => {
        const th = side > 0 ? openAt(i) : Math.PI * 2 - openAt(i);
        const [dx, dz] = s.shape(th);
        const c = s.c.clone().add(V3(dx, 0, dz));
        const out = V3(dx, 0, dz).normalize();
        const X = V3(0, 1, 0).cross(out).normalize();
        return { c, X, Z: out, shape: (t) => [0.0065 * Math.sin(t), 0.0048 * Math.cos(t) - 0.001], mat: 0 };
      });
      const band = loft(bst, { M: 10, rRef: 0.006, weights: (i, th, p) => cardW(i, th, p), color: () => [0.93, 0.93, 0.93] });
      addPart('knitRib', band);
    }
  }

  // ------------------------------------------------------------ arms
  for (const [k, s] of [['L', 1], ['R', -1]]) {
    const sh = J['upper' + k], dir = J['armDir' + k];
    const Zs = V3(0, 0, 1);
    const Xs = new THREE.Vector3().crossVectors(dir, Zs).normalize().multiplyScalar(-s);
    // radii along the arm [s along from the shoulder joint, rx, rz, mat]
    const L1 = B.upper, L2 = B.fore;
    let prof;
    if (id === 'maya') {
      prof = [[-0.07, 0.028, 0.03, 0], [-0.035, 0.045, 0.05, 0], [0.0, 0.054, 0.056, 0], [0.04, 0.055, 0.056, 0], [0.09, 0.05, 0.052, 0], [0.16, 0.047, 0.048, 0],
        [L1 - 0.05, 0.044, 0.045, 0], [L1, 0.043, 0.043, 0], [L1 + 0.05, 0.044, 0.042, 0], [L1 + 0.11, 0.042, 0.039, 0],
        [L1 + L2 * 0.62, 0.036, 0.033, 0], [L1 + L2 - 0.035, 0.032, 0.029, 1], [L1 + L2 - 0.004, 0.029, 0.027, 1],
        [L1 + L2 + 0.004, 0.024, 0.022, 1], [L1 + L2 - 0.012, 0.022, 0.02, 1]];
    } else {
      prof = [[-0.075, 0.03, 0.032, 0], [-0.038, 0.05, 0.056, 0], [0.0, 0.06, 0.063, 0], [0.05, 0.061, 0.063, 0], [0.11, 0.057, 0.058, 0], [0.18, 0.054, 0.055, 0],
        [L1 - 0.05, 0.052, 0.052, 0], [L1, 0.05, 0.05, 0], [L1 + 0.05, 0.05, 0.048, 0], [L1 + 0.12, 0.047, 0.044, 0],
        [L1 + L2 * 0.65, 0.043, 0.04, 0], [L1 + L2 - 0.055, 0.042, 0.039, 0], [L1 + L2 - 0.04, 0.034, 0.031, 1],
        [L1 + L2 - 0.004, 0.031, 0.029, 1], [L1 + L2 + 0.004, 0.026, 0.024, 1], [L1 + L2 - 0.012, 0.024, 0.022, 1]];
    }
    const inward = V3(-s, 0, 0);
    const ast = prof.map(([a, rx, rz, m]) => ({
      c: a < 0 ? sh.clone().addScaledVector(inward, -a * 0.9).add(V3(0, a * 0.2, 0)) : sh.clone().addScaledVector(dir, a),
      X: Xs, Z: Zs, shape: th => [rx * Math.sin(th), rz * Math.cos(th)], mat: m, a }));
    const armW = (i, th, p) => {
      const a = ast[i].a;
      const w = [];
      const wIn = sstep(0.07, -0.06, a); // inside/over the shoulder: chest/clavicle
      const wf = sstep(L1 - 0.04, L1 + 0.04, a);
      const wt = sstep(L1 + L2 * 0.25, L1 + L2 * 0.85, a);
      const up = (1 - wf) * (1 - wIn);
      w.push([bi('clav' + k), wIn * 0.6], [bi('chest'), wIn * 0.4], [bi('upper' + k), up], [bi('fore' + k), wf * (1 - wt)], [bi('twist' + k), wf * wt]);
      return w;
    };
    // sleeve folds bunch at the inner elbow and above the cuff
    const armOff = (i, th) => {
      const a = ast[i].a;
      const inner = Math.max(0, Math.cos(th)) ;
      return 0.003 * Math.exp(-(((a - L1) / 0.05) ** 2)) * Math.sin(th * 4 + a * 40) * (0.4 + inner)
        + (id === 'sam' ? 0.0035 * Math.exp(-(((a - (L1 + L2 - 0.07)) / 0.03) ** 2)) * Math.sin(th * 5 + 1) : 0);
    };
    const arm = loft(ast, { M: 28, rRef: 0.05, weights: armW, offset: armOff, flip: s < 0,
      color: (i, th) => { const kk = id === 'sam' ? 1 + 0.08 * Math.max(0, Math.cos(th - Math.PI / 2 * s)) * sstep(L1, 0, ast[i].a) : 1; return [kk, kk, kk]; } });
    splitByMat(arm, id === 'maya' ? ['knit', 'knitRib'] : ['hoodie', 'hoodieRib'], addPart);
  }

  // ------------------------------------------------------------ legs
  for (const [k, s] of [['L', 1], ['R', -1]]) {
    const hip = J['thigh' + k], knee = J['shin' + k], ank = J['foot' + k];
    const d1 = knee.clone().sub(hip), d2 = ank.clone().sub(knee);
    const l1 = d1.length(), l2 = d2.length();
    d1.normalize(); d2.normalize();
    const X = V3(1, 0, 0), Z = V3(0, 0, 1);
    // [param 0..2 (0 hip, 1 knee, 2 ankle), rx, rzF, rzB, cx]
    const prof = id === 'maya'
      ? [[-0.12, 0.075, 0.08, 0.09, -0.01], [0.0, 0.09, 0.09, 0.102, 0.004], [0.15, 0.084, 0.082, 0.086, 0.0], [0.45, 0.074, 0.072, 0.072, 0.0], [0.8, 0.062, 0.06, 0.058, 0],
        [1.0, 0.058, 0.057, 0.055, 0], [1.2, 0.057, 0.055, 0.062, 0], [1.5, 0.056, 0.052, 0.058, 0], [1.85, 0.056, 0.055, 0.056, 0], [1.97, 0.057, 0.058, 0.058, 0], [1.99, 0.052, 0.052, 0.052, 0]]
      : [[-0.12, 0.078, 0.084, 0.094, -0.01], [0.0, 0.092, 0.092, 0.102, 0.004], [0.15, 0.084, 0.082, 0.084, 0.0], [0.45, 0.074, 0.07, 0.07, 0.0], [0.8, 0.064, 0.062, 0.06, 0],
        [1.0, 0.062, 0.062, 0.06, 0], [1.2, 0.06, 0.058, 0.062, 0], [1.5, 0.058, 0.055, 0.058, 0], [1.8, 0.058, 0.057, 0.058, 0], [1.92, 0.062, 0.064, 0.062, 0], [1.95, 0.056, 0.056, 0.056, 0]];
    const pos = u => u <= 1 ? hip.clone().addScaledVector(d1, u * l1) : knee.clone().addScaledVector(d2, (u - 1) * l2);
    const lst = prof.map(([u, rx, rzF, rzB, cx]) => ({ c: pos(u).add(V3(s * cx, 0, 0)), X, Z, shape: th => [rx * Math.sin(th) * (1 + (Math.sin(th) * s < 0 ? -0.05 : 0.02)), (Math.cos(th) >= 0 ? rzF : rzB) * Math.cos(th)], mat: 0, u }));
    const legW = (i, th, p) => {
      const u = lst[i].u;
      const wh = sstep(0.12, -0.1, u) * (Math.cos(th) < 0 ? 1.0 : 0.6);
      const ws = sstep(0.9, 1.1, u);
      return [[bi('hips'), wh], [bi('thigh' + k), (1 - wh) * (1 - ws)], [bi('shin' + k), (1 - wh) * ws]];
    };
    const legOff = (i, th) => {
      const u = lst[i].u;
      // knee folds and a break above the shoe
      return 0.0025 * Math.exp(-(((u - 1) / 0.08) ** 2)) * Math.sin(th * 5 + 0.7) * (Math.cos(th) < 0 ? 1 : 0.4)
        + 0.003 * Math.exp(-(((u - 1.85) / 0.06) ** 2)) * Math.sin(th * 3 + 2);
    };
    const legColor = (i, th) => {
      if (id !== 'sam') return [1, 1, 1];
      const u = lst[i].u;
      // denim wear: lighter on the thigh front and knee, whiskers at the hip
      const front = Math.max(0, Math.cos(th));
      const k = 1 + 0.16 * front * Math.exp(-(((u - 0.35) / 0.25) ** 2)) + 0.14 * front * Math.exp(-(((u - 1.0) / 0.12) ** 2)) - 0.06 * sstep(1.6, 1.95, u);
      return [k, k, k * 1.02];
    };
    const leg = loft(lst, { M: 30, rRef: 0.08, weights: legW, offset: legOff, color: legColor });
    addPart(id === 'maya' ? 'trousers' : 'jeans', leg);
  }

  // ------------------------------------------------------------ shoes
  for (const [k, s] of [['L', 1], ['R', -1]]) {
    const ank = J['foot' + k], toeTip = J['toeTip' + k];
    const heel = V3(ank.x, 0.0, ank.z - 0.055);
    const len = toeTip.z - heel.z;
    const sneaker = id === 'sam';
    // stations along the foot (z), cross-section in x/y
    const pr = sneaker
      ? [[0.0, 0.034, 0.075, 1], [0.12, 0.042, 0.085, 1], [0.35, 0.046, 0.08, 1], [0.55, 0.05, 0.062, 1], [0.75, 0.05, 0.048, 1], [0.9, 0.044, 0.038, 1], [1.0, 0.028, 0.03, 1]]
      : [[0.0, 0.03, 0.06, 1], [0.12, 0.037, 0.066, 1], [0.35, 0.041, 0.05, 1], [0.55, 0.045, 0.04, 1], [0.75, 0.044, 0.03, 1], [0.9, 0.037, 0.024, 1], [1.0, 0.022, 0.018, 1]];
    const ss = pr.map(([u, w, h]) => ({
      c: V3(heel.x + s * 0.004 * Math.sin(u * 3), 0, heel.z + u * len), X: V3(1, 0, 0), Z: V3(0, 1, 0), u, w, h,
      shape: th => {
        // flat sole, rounded upper; th=0 at the top
        const c = Math.cos(th), sn = Math.sin(th);
        const y = c > 0 ? h * Math.pow(c, 0.7) : 0.004 * c;
        return [w * sgnpow(sn, 0.55), y];
      }, mat: 0,
    }));
    const shoeW = (i) => { const u = ss[i].u; const wt = sstep(0.62, 0.8, u); return [[bi('foot' + k), 1 - wt], [bi('toe' + k), wt]]; };
    const shoe = loft(ss, { M: 24, rRef: 0.04, weights: shoeW, capStart: true, capEnd: true, flip: true });
    addPart(sneaker ? 'sneaker' : 'shoe', shoe);
    // soles
    const so = ss.map(st => ({ c: st.c.clone().add(V3(0, 0.0, 0)), X: st.X, Z: st.Z, u: st.u,
      shape: th => { const c = Math.cos(th), sn = Math.sin(th); return [(st.w + 0.003) * sgnpow(sn, 0.35), (sneaker ? 0.014 : 0.006) * (c * 0.5 + 0.5) - 0.002]; }, mat: 0 }));
    const sole = loft(so, { M: 20, rRef: 0.04, weights: shoeW, capStart: true, capEnd: true, flip: true });
    addPart(sneaker ? 'sole' : 'soleDark', sole);
  }

  // ------------------------------------------------------------ build
  const geoms = {};
  for (const key in parts.cloth) geoms[key] = toGeometry(parts.cloth[key], { keepGroups: false });
  return geoms;
}

function splitByMat(part, keys, addPart) {
  // split one loft part into per-material index subsets sharing the vertex arrays
  for (const g of part.groups) {
    const key = keys[g.materialIndex];
    addPart(key, { ...part, idx: part.idx, groups: [{ start: g.start, count: g.count, materialIndex: 0 }] });
  }
}

/** torso cross-section at height y and angle th (bind space): [dx, dz, cz] */
export function torsoSection(id, y, th, off = 0) {
  const T = TORSO[id];
  let k = 0; while (k < T.length - 2 && T[k + 1][0] < y) k++;
  const a = T[k], b = T[k + 1]; const f = clamp((y - a[0]) / (b[0] - a[0]));
  const r = a.map((q, i) => mix(q, b[i], f));
  const [dx, dz] = torsoShape(r[1] + off, r[2] + off, r[3] + off, r[5])(th);
  return [dx, dz, r[4]];
}
/** Maya's cardigan opening half-angle at height y */
export function cardiganOpenAt(y) { return 0.3 + 0.06 * sstep(1.0, 0.86, y) + 0.5 * sstep(1.16, 1.39, y); }
