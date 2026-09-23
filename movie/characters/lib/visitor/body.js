// The Visitor: skin patches and the internal skeleton, written from the pose.

import { SkinBuffer } from './grid.js';
import { sweep, sweepTex, profile, bump } from './sweep.js';
import { deformHead, writeLid, LID } from './head.js';
import { mmul, mv } from './rig.js';

const TAU = Math.PI * 2;
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = a => Math.hypot(a[0], a[1], a[2]);
const norm = a => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const col = (M, c) => [M[c], M[3 + c], M[6 + c]];
const sm = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// ---------------------------------------------------------------------------
// cross-section profiles
// ---------------------------------------------------------------------------
const TORSO = [
  // u, r-front, r-side
  [0.0, 0.07, 0.1], [0.08, 0.083, 0.12], [0.17, 0.082, 0.118], [0.29, 0.068, 0.09], [0.38, 0.062, 0.08],
  [0.5, 0.07, 0.094], [0.62, 0.082, 0.112], [0.74, 0.086, 0.122], [0.85, 0.078, 0.138], [0.93, 0.064, 0.112], [1.0, 0.05, 0.07],
];
const NECK = [[0, 0.064, 0.082], [0.14, 0.05, 0.06], [0.3, 0.036, 0.041], [0.55, 0.032, 0.035], [0.8, 0.036, 0.039], [1.0, 0.04, 0.044]];
const PALM = [[0, 0.011, 0.016], [0.35, 0.0115, 0.022], [0.75, 0.0105, 0.026], [1.0, 0.0085, 0.024]];
const FINGER = [[0, 0.0074, 0.0082], [0.14, 0.0078, 0.0086], [0.36, 0.0063, 0.0069], [0.52, 0.0066, 0.0072], [0.7, 0.0054, 0.006], [0.87, 0.0064, 0.0071], [1.0, 0.006, 0.0066]];
const tmpR = [0, 0, 0, 0];

export function createBody(THREE, skull, hd) {
  const buf = new SkinBuffer();
  const P = {};
  P.head = buf.add(hd.NA, hd.nv, { wrap: true, flip: true, name: 'head' });
  P.lids = [];
  for (let e = 0; e < 2; e++) {
    P.lids.push(buf.add(LID.nu, LID.nv, { wrap: false, flip: true, name: 'lidU' }));
    P.lids.push(buf.add(LID.nu, LID.nv, { wrap: false, flip: false, name: 'lidL' }));
  }
  P.crest = [buf.add(10, 44, { name: 'crest' }), buf.add(8, 30, { name: 'crestL' }), buf.add(8, 30, { name: 'crestR' })];
  P.torso = buf.add(44, 46, { name: 'torso' });
  P.neck = buf.add(32, 30, { name: 'neck' });
  P.arms = [buf.add(20, 50, { name: 'armL' }), buf.add(20, 50, { name: 'armR' })];
  P.palms = [buf.add(18, 13, { name: 'palmL' }), buf.add(18, 13, { name: 'palmR' })];
  P.fingers = [];
  for (let a = 0; a < 2; a++) for (let f = 0; f < 3; f++) P.fingers.push(buf.add(12, 22, { name: 'finger' }));
  P.legs = [buf.add(18, 62, { name: 'legL' }), buf.add(18, 62, { name: 'legR' }), buf.add(18, 62, { name: 'legC' })];
  buf.build(THREE);

  // ---- static attributes ----
  {
    const p = P.head, { cols, nv, off } = p;
    for (let j = 0; j < nv; j++) for (let i = 0; i < cols; i++) {
      const k = j * cols + i, o = off + k;
      buf.tex[o * 3] = hd.rest[k * 3]; buf.tex[o * 3 + 1] = hd.rest[k * 3 + 1]; buf.tex[o * 3 + 2] = hd.rest[k * 3 + 2];
      const inner = j < hd.K;
      const b = j >= hd.K && j < hd.K + hd.NG ? hd.bs[j - hd.K] : 1;
      buf.info[o * 4] = inner ? 2 : b < 0.0045 ? 7 : 6;
      buf.info[o * 4 + 1] = j === hd.K ? 0.85 : j === hd.K + 1 ? 0.35 : 0;
      buf.info[o * 4 + 2] = hd.ao[k];
      buf.info[o * 4 + 3] = inner ? (hd.K - j) / hd.K : 0;
    }
  }
  for (const lp of P.lids) {
    sweepTexGrid(buf, lp, 0.09, 0.03, 3, (u, v) => 0, (u, v) => v > 0.93 ? 0.75 : v > 0.86 ? 0.2 : 0);
  }
  sweepTexGrid(buf, P.crest[0], 0.06, 0.3, 1, (u, v) => Math.pow(Math.max(0, Math.cos(u * TAU)), 2));
  sweepTexGrid(buf, P.crest[1], 0.03, 0.2, 1, (u, v) => Math.pow(Math.max(0, Math.cos(u * TAU)), 2));
  sweepTexGrid(buf, P.crest[2], 0.03, 0.2, 1, (u, v) => Math.pow(Math.max(0, Math.cos(u * TAU)), 2));
  sweepTex(buf, P.torso, 0.62, 0.7, 0.3, 0);
  sweepTex(buf, P.neck, 0.28, 0.4, 0.3, 0);
  for (const a of P.arms) sweepTex(buf, a, 0.2, 0.8, 0.3, 0);
  for (const a of P.palms) sweepTex(buf, a, 0.13, 0.1, 0.15, 4);
  for (const f of P.fingers) sweepTex(buf, f, 0.045, 0.14, 0.09, 4);
  for (const l of P.legs) sweepTex(buf, l, 0.3, 1.25, 0.3, 0);
  buf.texAttr.needsUpdate = true; buf.infoAttr.needsUpdate = true;

  // lid row distribution: dense toward the edge
  const lidRows = [];
  for (let j = 0; j < LID.nv; j++) { const x = j / (LID.nv - 1); lidRows.push(1 - Math.pow(1 - x, 1.7)); }

  // ---- crest paths (head space) ----
  const surfPt = (dir) => {
    const d = norm(dir);
    const t = skull.raycast(d[0], d[1], d[2]);
    const p = mul(d, t);
    const e = 0.0015;
    const n = norm([
      skull.sdf(p[0] + e, p[1], p[2]) - skull.sdf(p[0] - e, p[1], p[2]),
      skull.sdf(p[0], p[1] + e, p[2]) - skull.sdf(p[0], p[1] - e, p[2]),
      skull.sdf(p[0], p[1], p[2] + e) - skull.sdf(p[0], p[1], p[2] - e)]);
    return { p, n };
  };
  function crestPath(dirs, heights, thick, ext, embed) {
    const pts = [], fronts = [], hs = [], ts = [];
    for (let k = 0; k < dirs.length; k++) {
      const s = surfPt(dirs[k]);
      pts.push(add(s.p, mul(s.n, heights[k] - embed)));
      fronts.push(s.n); hs.push(heights[k]); ts.push(thick[k]);
    }
    // extension off the back of the skull, curving up a little
    let last = pts[pts.length - 1], prev = pts[pts.length - 2];
    let dir = norm(sub(last, prev));
    let fr = fronts[fronts.length - 1];
    for (const [dl, up, h, th] of ext) {
      dir = norm(add(dir, mul(fr, up)));
      last = add(last, mul(dir, dl));
      fr = norm(sub(fr, mul(dir, dot(fr, dir))));
      pts.push(last); fronts.push(fr); hs.push(h); ts.push(th);
    }
    // keyed profile by arc length
    let L = 0; const cum = [0];
    for (let k = 1; k < pts.length; k++) { L += len(sub(pts[k], pts[k - 1])); cum.push(L); }
    const keys = pts.map((_, k) => [cum[k] / L, hs[k], ts[k]]);
    return { pts, fronts, keys };
  }
  const deg = Math.PI / 180;
  const cDirs = [48, 60, 72, 84, 96, 108, 120, 131, 141].map(a => [0, Math.sin(a * deg), Math.cos(a * deg)]);
  const crestC = crestPath(cDirs,
    [0.0025, 0.005, 0.008, 0.011, 0.014, 0.017, 0.02, 0.022, 0.023],
    [0.003, 0.004, 0.005, 0.0058, 0.0064, 0.0068, 0.007, 0.0068, 0.0064],
    [[0.035, 0.12, 0.022, 0.006], [0.04, 0.16, 0.018, 0.005], [0.04, 0.2, 0.011, 0.0038], [0.03, 0.2, 0.003, 0.0018]], 0.006);
  const lDirs = [[0.056, 0.046, 0.058], [0.07, 0.064, 0.02], [0.076, 0.076, -0.03], [0.073, 0.086, -0.08], [0.064, 0.092, -0.125], [0.052, 0.098, -0.165]];
  const crestL = crestPath(lDirs, [0.0015, 0.004, 0.006, 0.0075, 0.0085, 0.009], [0.0022, 0.003, 0.0036, 0.004, 0.004, 0.0038],
    [[0.035, 0.1, 0.007, 0.0032], [0.03, 0.14, 0.002, 0.0016]], 0.004);
  const crestR = { pts: crestL.pts.map(p => [-p[0], p[1], p[2]]), fronts: crestL.fronts.map(p => [-p[0], p[1], p[2]]), keys: crestL.keys };

  // ---- internal skeleton (separate buffer, additive) ----
  const bones = new SkinBuffer();
  const B = {};
  B.spine = bones.add(6, 34, { name: 'spine' });
  B.ribs = [];
  for (let k = 0; k < 5; k++) for (let s = 0; s < 2; s++) B.ribs.push(bones.add(5, 16, { name: 'rib' }));
  B.limbs = [];
  for (let k = 0; k < 2; k++) B.limbs.push(bones.add(6, 30, { name: 'armbone' }));
  for (let k = 0; k < 3; k++) B.limbs.push(bones.add(6, 36, { name: 'legbone' }));
  B.fingers = [];
  for (let k = 0; k < 6; k++) B.fingers.push(bones.add(4, 10, { name: 'fbone' }));
  B.clav = [bones.add(5, 10, {}), bones.add(5, 10, {})];
  B.pelvis = bones.add(6, 24, { name: 'pelvis' });
  bones.build(THREE);

  // ---- per-frame writer ----
  const headWork = new Float32Array(hd.nVerts * 3);
  const jointCum = [];
  function chainCum(pts) {
    jointCum.length = 0; jointCum.push(0);
    for (let k = 1; k < pts.length; k++) jointCum.push(jointCum[k - 1] + len(sub(pts[k], pts[k - 1])));
    return jointCum;
  }
  const lerpK = (keys, s) => { // keys [[s, a, b]] absolute arc, piecewise smooth
    return profile(keys, s, tmpR);
  };

  function write(pose, face) {
    const { Rhead, headC } = pose;
    const pos = buf.pos;
    // --- head ---
    deformHead(hd, face.mouth, headWork);
    {
      const p = P.head, base = p.off * 3, n = hd.nVerts, R = Rhead;
      for (let k = 0; k < n; k++) {
        const x = headWork[k * 3], y = headWork[k * 3 + 1], z = headWork[k * 3 + 2];
        pos[base + k * 3] = headC[0] + R[0] * x + R[1] * y + R[2] * z;
        pos[base + k * 3 + 1] = headC[1] + R[3] * x + R[4] * y + R[5] * z;
        pos[base + k * 3 + 2] = headC[2] + R[6] * x + R[7] * y + R[8] * z;
      }
    }
    // --- lids ---
    face.eyes.forEach((e, ei) => {
      // eye matrix in root space: Rhead * (Reye * S), centre headC + Rhead * c
      const RS = [e.R[0] * e.r[0], e.R[1] * e.r[1], e.R[2] * e.r[2], e.R[3] * e.r[0], e.R[4] * e.r[1], e.R[5] * e.r[2], e.R[6] * e.r[0], e.R[7] * e.r[1], e.R[8] * e.r[2]];
      const M = mmul(Rhead, RS);
      const c = add(headC, mv(Rhead, e.c));
      const eyeM = M.concat(c);
      writeLid(buf, P.lids[ei * 2], eyeM, true, e.side, face.lids[ei], lidRows);
      writeLid(buf, P.lids[ei * 2 + 1], eyeM, false, e.side, face.lids[ei], lidRows);
    });
    // --- crest (head space, bent by follow-through, then to root space) ---
    const bend = pose.crestBend;
    [crestC, crestL, crestR].forEach((c, ci) => {
      const n = c.pts.length;
      const pts = [], fronts = [];
      for (let k = 0; k < n; k++) {
        const u = k / (n - 1);
        const w = u * u * (ci === 0 ? 1 : 0.6);
        const p = [c.pts[k][0] + bend[0] * w * 0.9, c.pts[k][1] + bend[1] * w * 0.9, c.pts[k][2]];
        pts.push(add(headC, mv(Rhead, p)));
        fronts.push(mv(Rhead, c.fronts[k]));
      }
      const keys = c.keys;
      sweep(buf, P.crest[ci], pts, fronts.slice(0, n - 1).map((f, k) => norm(add(f, fronts[k + 1]))),
        (u) => { profile(keys, u, tmpR); return tmpR; },
        (th) => 1 - 0.18 * Math.pow(Math.max(0, -Math.cos(th)), 2),
        { capStart: 3, capEnd: 3, capLenStart: 0.004, capLenEnd: 0.004, blend: 0.45 });
    });

    // --- torso ---
    const Rp = pose.Rpelvis, sp = pose.spine, sR = pose.spineR;
    const tPts = [add(sp[0], mv(Rp, [0, -0.095, -0.004])), ...sp];
    const tFr = [col(Rp, 2), ...sR.slice(1, sp.length).map(R => col(R, 2))];
    const br = pose.breathe;
    sweep(buf, P.torso, tPts, tFr,
      (u) => {
        profile(TORSO, u, tmpR);
        const b = 1 + 0.022 * br * sm(0.4, 0.62, u) * (1 - sm(0.8, 0.95, u));
        tmpR[0] *= b; tmpR[1] *= b * 0.996;
        return tmpR;
      },
      (th, u) => {
        const c = Math.cos(th), s = Math.sin(th);
        const n = 2.35;
        let r = Math.pow(Math.pow(Math.abs(c), n) + Math.pow(Math.abs(s), n), -1 / n);
        r *= 1 - 0.035 * bump(th, 0, 0.16) * sm(0.48, 0.6, u) * (1 - sm(0.84, 0.9, u));
        r *= 1 + 0.03 * (bump(th, 0.6, 0.34) + bump(th, -0.6, 0.34)) * sm(0.58, 0.68, u) * (1 - sm(0.8, 0.86, u));
        r *= 1 + 0.018 * bump(th, 0, 0.5) * sm(0.22, 0.3, u) * (1 - sm(0.4, 0.48, u));
        r *= 1 - 0.04 * bump(th, Math.PI, 0.14) * sm(0.15, 0.3, u) * (1 - sm(0.88, 0.95, u));
        r *= 1 + 0.035 * (bump(th, Math.PI - 0.72, 0.32) + bump(th, Math.PI + 0.72, 0.32)) * sm(0.64, 0.72, u) * (1 - sm(0.84, 0.9, u));
        r *= 1 + 0.03 * (bump(th, Math.PI / 2, 0.3) + bump(th, -Math.PI / 2, 0.3)) * sm(0.05, 0.12, u) * (1 - sm(0.18, 0.26, u));
        return r;
      },
      { capStart: 5, capEnd: 4 });

    // --- neck ---
    const nk = pose.neck;
    const into = add(headC, mv(Rhead, [0, -0.045, -0.03]));
    const nPts = [add(sp[4], mv(sR[4], [0, 0.0, -0.005])), nk[0], nk[1], nk[2], into];
    const nFr = [col(sR[4], 2), col(pose.neckR[0], 2), col(pose.neckR[1], 2), col(Rhead, 2)];
    sweep(buf, P.neck, nPts, nFr, (u) => profile(NECK, u, tmpR),
      (th, u) => {
        let r = 1 - 0.08 * bump(th, 0, 0.5) * sm(0.2, 0.35, u);
        r *= 1 + 0.12 * (bump(th, 0.8, 0.22) + bump(th, -0.8, 0.22)) * sm(0.2, 0.32, u) * (1 - sm(0.72, 0.85, u));
        r *= 1 - 0.05 * bump(th, Math.PI, 0.3) * sm(0.3, 0.5, u);
        r *= 1 + 0.06 * bump(th, 0, 0.18) * sm(0.55, 0.62, u) * (1 - sm(0.7, 0.76, u));   // a small larynx ridge
        return r;
      },
      { capStart: 0, capEnd: 4 });

    // --- arms, palms, fingers ---
    pose.arms.forEach((arm, ai) => {
      const { clav, S, E, W, hand } = arm;
      const palmEnd = add(W, mul(hand.Y, 0.03));
      const pts = [clav, S, E, W, palmEnd];
      const mid = mul(add(S, W), 0.5);
      let inside = sub(mid, E);
      const il = len(inside);
      const up = norm(sub(E, S)), fo = norm(sub(W, E));
      let fU, fF;
      if (il > 0.01) { inside = mul(inside, 1 / il); fU = norm(sub(inside, mul(up, dot(inside, up)))); fF = norm(sub(inside, mul(fo, dot(inside, fo)))); }
      else { fU = col(pose.spineR[4], 2); fF = fU; }
      const chest = col(pose.spineR[4], 2);
      const cum = chainCum(pts);
      const sS = cum[1], sE = cum[2], sW = cum[3];
      const keys = [[0, 0.034, 0.034], [sS, 0.044, 0.046], [sS + 0.08, 0.036, 0.038], [sS + 0.2, 0.03, 0.031], [sE - 0.02, 0.0245, 0.026],
        [sE + 0.06, 0.0272, 0.029], [sW - 0.06, 0.0195, 0.022], [sW, 0.0135, 0.0185], [cum[4], 0.012, 0.016]];
      const L = cum[4];
      sweep(buf, P.arms[ai], pts, [chest, fU, fF, hand.Z],
        (u, s) => profile(keys, s, tmpR),
        (th, u, s) => {
          let r = 1 + 0.06 * bump(th, 0, 0.9) * sm(sS + 0.08, sS + 0.14, s) * (1 - sm(sE - 0.1, sE - 0.03, s));   // biceps-ish
          r *= 1 + 0.07 * bump(th, Math.PI, 0.5) * sm(sE - 0.03, sE, s) * (1 - sm(sE + 0.02, sE + 0.05, s));  // elbow point
          return r;
        },
        { capStart: 0, capEnd: 3 });
      // palm
      const pp = [add(W, mul(hand.Y, -0.012)), add(W, mul(hand.Y, 0.028)), add(W, mul(hand.Y, 0.062)), add(W, mul(hand.Y, 0.09))];
      sweep(buf, P.palms[ai], pp, [hand.Z, hand.Z, hand.Z], (u) => profile(PALM, u, tmpR),
        (th) => 1 - 0.12 * bump(th, 0, 0.7), { capStart: 0, capEnd: 4, capLenEnd: 0.009 });
      arm.fingers.forEach((f, fi) => {
        sweep(buf, P.fingers[ai * 3 + fi], f.pts, f.fronts.slice(1),
          (u) => { profile(FINGER, u, tmpR); const sc = fi === 0 ? 0.92 : 1; tmpR[0] *= sc; tmpR[1] *= sc; return tmpR; },
          (th, u) => 1 + 0.1 * bump(th, Math.PI, 0.7) * (bump(u * 7, 1.9, 0.5) + bump(u * 7, 3.6, 0.5)),
          { capStart: 0, capEnd: 4, capLenEnd: 0.0065 });
      });
    });

    // --- legs ---
    pose.legs.forEach((lg, li) => {
      const pts = [lg.inner, lg.hip, lg.knee, lg.ankle, lg.ball, lg.toe];
      const f = lg.fwd;
      const fr = [f, f, f, f, [0, 1, 0]];
      const cum = chainCum(pts);
      const sH = cum[1], sK = cum[2], sA = cum[3], sB = cum[4], L = cum[5];
      const keys = [[0, 0.058, 0.064], [sH, 0.061, 0.066], [sH + 0.13, 0.054, 0.053], [sK - 0.09, 0.037, 0.036], [sK, 0.033, 0.034],
        [sK + 0.1, 0.031, 0.029], [sA - 0.12, 0.021, 0.02], [sA, 0.018, 0.019], [sA + 0.1, 0.0165, 0.017], [sB - 0.03, 0.019, 0.021],
        [sB, 0.017, 0.028], [sB + 0.04, 0.013, 0.025], [L, 0.009, 0.017]];
      sweep(buf, P.legs[li], pts, fr, (u, s) => profile(keys, s, tmpR),
        (th, u, s) => {
          let r = 1 + 0.06 * bump(th, 0, 0.7) * sm(sH + 0.05, sH + 0.12, s) * (1 - sm(sK - 0.15, sK - 0.05, s));     // thigh front
          r *= 1 + 0.12 * bump(th, 0, 0.35) * sm(sK - 0.03, sK, s) * (1 - sm(sK + 0.02, sK + 0.05, s));             // knee cap
          r *= 1 + 0.07 * bump(th, Math.PI, 0.7) * sm(sK + 0.04, sK + 0.1, s) * (1 - sm(sK + 0.2, sK + 0.28, s));   // calf
          r *= 1 + 0.1 * bump(th, Math.PI, 0.3) * sm(sA - 0.02, sA, s) * (1 - sm(sA + 0.01, sA + 0.03, s));         // heel spur
          return r;
        },
        { capStart: 0, capEnd: 4, capLenEnd: 0.012 });
    });

    for (const p of buf.patches) buf.normals(p);
    buf.touch();

    // --- internal skeleton ---
    writeBones(pose);
  }

  function writeBones(pose) {
    const sp = pose.spine, sR = pose.spineR;
    const bpts = [add(sp[0], [0, -0.05, -0.02]), ...sp.map((p, k) => add(p, mv(sR[k], [0, 0, -0.045]))), add(pose.neck[1], mv(pose.neckR[0], [0, 0, -0.01])), pose.neck[2]];
    const bfr = bpts.slice(1).map((_, k) => col(sR[Math.min(k, sR.length - 1)], 2));
    sweep(bones, B.spine, bpts, bfr, () => (tmpR[0] = 0.006, tmpR[1] = 0.009, tmpR),
      (th, u, s) => 1 + 0.45 * Math.pow(0.5 + 0.5 * Math.cos(s * TAU / 0.035), 6), { capStart: 0, capEnd: 0 });
    // ribs: arcs round the chest, sloping down to the front
    let ri = 0;
    for (let k = 0; k < 5; k++) {
      const a = k / 4;
      const segI = a < 0.5 ? 2 : 3;
      const base = add(sp[segI], mv(sR[segI], [0, (a % 0.5) * 0.2 - 0.02, -0.04]));
      const R = sR[segI];
      const rz = 0.068 + 0.012 * Math.sin(a * Math.PI), rx = 0.085 + 0.02 * Math.sin(a * Math.PI);
      for (const side of [1, -1]) {
        const pts = [], fr = [];
        for (let q = 0; q <= 6; q++) {
          const th = Math.PI - q / 6 * (Math.PI - 0.42);
          const lp = [side * Math.sin(th) * rx * 0.86, -0.045 * (q / 6) * (q / 6), Math.cos(th) * rz * 0.86 + 0.035];
          pts.push(add(base, mv(R, lp)));
          fr.push(col(R, 1));
        }
        sweep(bones, B.ribs[ri++], pts, fr.slice(1), () => (tmpR[0] = 0.0022, tmpR[1] = 0.0035, tmpR), null, { capStart: 0, capEnd: 0 });
      }
    }
    // limb bones
    pose.arms.forEach((arm, ai) => {
      const pts = [arm.S, arm.E, arm.W, add(arm.W, mul(arm.hand.Y, 0.07))];
      const f = norm(sub(mul(add(arm.S, arm.W), 0.5), arm.E));
      sweep(bones, B.limbs[ai], pts, [f, f, arm.hand.Z], (u, s) => (tmpR[0] = 0.0045, tmpR[1] = 0.0055, tmpR),
        (th, u) => 1 + 0.6 * (Math.exp(-(((u - 0.02) / 0.04) ** 2)) + Math.exp(-(((u - 0.47) / 0.04) ** 2))), { capStart: 0, capEnd: 0 });
      const clav = [add(pose.spine[4], [0, 0.02, 0.03]), arm.S];
      sweep(bones, B.clav[ai], clav, [col(pose.spineR[4], 1)], () => (tmpR[0] = 0.003, tmpR[1] = 0.004, tmpR), null, {});
      arm.fingers.forEach((fg, fi) => {
        sweep(bones, B.fingers[ai * 3 + fi], fg.pts.slice(1, 5), fg.fronts.slice(2, 5), () => (tmpR[0] = 0.0022, tmpR[1] = 0.0022, tmpR), null, {});
      });
    });
    pose.legs.forEach((lg, li) => {
      const pts = [lg.hip, lg.knee, lg.ankle, lg.ball];
      sweep(bones, B.limbs[2 + li], pts, [lg.fwd, lg.fwd, lg.fwd], () => (tmpR[0] = 0.006, tmpR[1] = 0.007, tmpR),
        (th, u) => 1 + 0.7 * (Math.exp(-(((u - 0.02) / 0.03) ** 2)) + Math.exp(-(((u - 0.38) / 0.03) ** 2)) + Math.exp(-(((u - 0.78) / 0.03) ** 2))), {});
    });
    // pelvis: a ring through the three hip sockets
    {
      const Rp = pose.Rpelvis, c = pose.pelvis;
      const pts = [];
      for (let q = 0; q <= 8; q++) {
        const a = q / 8 * TAU;
        pts.push(add(c, mv(Rp, [Math.sin(a) * 0.085, -0.03 + 0.012 * Math.cos(2 * a), Math.cos(a) * 0.06 - 0.01])));
      }
      sweep(bones, B.pelvis, pts, pts.slice(1).map(() => col(Rp, 1)), () => (tmpR[0] = 0.004, tmpR[1] = 0.006, tmpR), null, {});
    }
    for (const p of bones.patches) bones.normals(p);
    bones.touch();
  }

  return { buf, P, bones, write, triangles: buf.triangles + bones.triangles };
}

// texture coords for non-sweep grids (lids, crest): simple (u, v) in tiles, plus info
function sweepTexGrid(buf, p, circ, length, part, maskFn, creaseFn) {
  const { nu, nv, cols, off } = p;
  const tile = 0.12;
  for (let j = 0; j < nv; j++) for (let i = 0; i < cols; i++) {
    const o = off + j * cols + i, u = i / (p.wrap ? nu : nu - 1), v = j / (nv - 1);
    buf.tex[o * 3] = u * circ / tile; buf.tex[o * 3 + 1] = v * length / tile; buf.tex[o * 3 + 2] = 0;
    buf.info[o * 4] = part;
    buf.info[o * 4 + 1] = creaseFn ? creaseFn(u, v) : 0;
    buf.info[o * 4 + 2] = 1;
    buf.info[o * 4 + 3] = maskFn ? maskFn(u, v) : 0;
  }
}
