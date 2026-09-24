// Face rig: analytic deformers on the fixed head-mesh vertex set.
//
//  1. linear displacement fields (stored sparsely, like CPU morph targets),
//     one per facial control: pucker, funnel, stretch, smile, brows, ...
//  2. jaw: a true rotation about the TMJ axis, weighted by a smooth mask
//     that splits exactly along the lip line (the upper/lower lip rings)
//  3. lip seal: pulls the two lips' matching rings together after the jaw
//     (PP / M / B, silence) so they always meet, whatever the jaw does
//  4. lids: each lid vertex rotates about its eye centre, so the margins
//     slide over the eyeball and meet exactly when blink = 1
//
// Visemes and expressions are blended as control values first, then the
// deformers run once, so the jaw and lids stay rigid and exact.

import { clamp, mix, sstep } from './sdf.js';

const DEG = Math.PI / 180;

export const VISEMES = {
  sil: { seal: 0.7 },
  PP: { press: 1, seal: 1, jaw: 0.03 },
  FF: { jaw: 0.12, tuck: 1, upperUp: 0.35, stretch: 0.15 },
  TH: { jaw: 0.2, tongueOut: 1, upperUp: 0.15, lowerDown: 0.25 },
  DD: { jaw: 0.24, tipUp: 1, upperUp: 0.2, stretch: 0.2 },
  kk: { jaw: 0.3, back: 1, stretch: 0.15, upperUp: 0.1 },
  CH: { jaw: 0.12, funnel: 0.85, pucker: 0.25, upperUp: 0.35, lowerDown: 0.3 },
  SS: { jaw: 0.07, stretch: 0.5, upperUp: 0.3, lowerDown: 0.3, tipUp: 0.4 },
  nn: { jaw: 0.2, tipUp: 0.9, stretch: 0.15 },
  RR: { jaw: 0.16, pucker: 0.5, funnel: 0.35 },
  aa: { jaw: 0.9, upperUp: 0.2, lowerDown: 0.3 },
  E: { jaw: 0.42, stretch: 0.7, upperUp: 0.3, lowerDown: 0.25 },
  I: { jaw: 0.2, stretch: 1.0, upperUp: 0.35, lowerDown: 0.3, smile: 0.15 },
  O: { jaw: 0.52, funnel: 1, pucker: 0.5 },
  U: { jaw: 0.2, pucker: 1, funnel: 0.3 },
};

export function createFaceRig(hm, H, opt = {}) {
  const L = H.landmarks, mo = H.mouth, w = mo.w;
  const rest = Float32Array.from(hm.positions);
  const n = rest.length / 3;
  const M = hm.meta;
  const fields = {};
  const jawPivot = opt.jawPivot || [0, -0.015, 0.0];
  const JAW_MAX = (opt.jawMax || 17) * DEG;

  // ------------------------------------------------ per-vertex coordinates
  const isUpperV = new Float32Array(n);
  const ringM = new Float32Array(n).fill(99); // mouth ring (99 = not in the zone)
  for (let v = 0; v < n; v++) {
    const x = rest[3 * v], y = rest[3 * v + 1];
    const k = M.kind[v];
    if (k === 3 || k === 4 || k === 5) { isUpperV[v] = M.upper[v]; ringM[v] = M.ring[v]; }
    else isUpperV[v] = y >= mo.lineY(clamp(x, -w, w)) ? 1 : 0;
  }
  const frontMask = z => sstep(0.02, 0.05, z);
  // mouth-local measures
  const mc = v => {
    const x = rest[3 * v], y = rest[3 * v + 1], z = rest[3 * v + 2];
    const Xc = clamp(x, -w, w);
    const dy = y - mo.lineY(Xc);
    const ax = Math.abs(x);
    const dxo = Math.max(0, ax - w);
    const h = isUpperV[v] >= 0.5 ? mo.upH(Xc) : mo.loH(Xc);
    return { x, y, z, Xc, dy, ax, dxo, h, s: x / w, up: isUpperV[v] };
  };
  // how much a vertex belongs to the lips (1 on the vermilion and inner roll)
  const lipCore = v => {
    const r = ringM[v];
    if (r <= -1) return r >= -3 ? 1 : r === -4 ? 0.5 : r === -5 ? 0.12 : 0;
    if (r < 99) return r <= 5 ? 1 : Math.exp(-(((r - 5) / 2.2) ** 2));
    const q = mc(v);
    const d = Math.hypot(q.dxo, Math.max(0, Math.abs(q.dy) - q.h));
    return Math.exp(-((d / 0.004) ** 2)) * frontMask(q.z);
  };
  // wider perioral area
  const perioral = (v, sx = 0.016, syU = 0.016, syL = 0.02) => {
    const r = ringM[v];
    const q = mc(v);
    if (r <= -1) return lipCore(v);
    const sy = q.up >= 0.5 ? syU : syL;
    const d2 = (q.dxo / sx) ** 2 + (Math.max(0, Math.abs(q.dy) - q.h) / sy) ** 2;
    return Math.exp(-d2) * frontMask(q.z);
  };
  const addField = (name, fn) => {
    const idx = [], d = [];
    for (let v = 0; v < n; v++) {
      const r = fn(v);
      if (!r) continue;
      if (Math.abs(r[0]) + Math.abs(r[1]) + Math.abs(r[2]) < 1e-6) continue;
      idx.push(v); d.push(r[0], r[1], r[2]);
    }
    fields[name] = { idx: Int32Array.from(idx), d: Float32Array.from(d) };
  };
  const sideW = (x, sgn) => sstep(-0.006, 0.006, x * sgn);

  // ----------------------------------------------------------- lip fields
  addField('pucker', v => {
    const q = mc(v); const c = lipCore(v), p = perioral(v, 0.014, 0.012, 0.014);
    const bagDeep = ringM[v] < -3 ? 0.4 : 1;
    return [-q.x * 0.42 * p, -q.dy * 0.18 * c, (0.0055 * c + 0.0025 * p) * (1 - 0.35 * q.s * q.s) * bagDeep];
  });
  addField('funnel', v => {
    const q = mc(v); const c = lipCore(v), p = perioral(v, 0.014, 0.012, 0.014);
    const r = ringM[v];
    const flare = r >= 0 && r <= 5 ? 1 - r / 6 : r < 0 && r >= -3 ? 1 : 0;
    const sgn = q.up >= 0.5 ? 1 : q.up > 0 ? 0 : -1;
    const cen = 1 - Math.min(1, q.s * q.s);
    return [-q.x * 0.22 * p, sgn * (0.0026 * c * cen + 0.0012 * flare * cen), 0.0035 * c + 0.0018 * flare + 0.0015 * p];
  });
  for (const [nm, sgn] of [['stretchL', 1], ['stretchR', -1]]) {
    addField(nm, v => {
      const q = mc(v); const c = lipCore(v), p = perioral(v, 0.02, 0.012, 0.014);
      const sw = sideW(q.x, sgn);
      const lat = clamp(Math.abs(q.s), 0, 1.3);
      return [sgn * 0.0048 * lat * p * sw, -q.dy * 0.22 * c * sw, -0.0028 * Math.pow(lat, 1.5) * p * sw];
    });
  }
  for (const [nm, sgn] of [['smileL', 1], ['smileR', -1]]) {
    addField(nm, v => {
      const q = mc(v);
      const sw = sideW(q.x, sgn);
      const cx = sgn * w;
      const dyl = q.y - mo.lineY(clamp(q.x, -w, w));
      const dc2 = ((q.x - cx) / 0.021) ** 2 + (dyl / 0.019) ** 2;
      const corner = Math.exp(-dc2) * frontMask(q.z);
      const lat = clamp(Math.abs(q.s), 0, 1.3);
      const p = perioral(v, 0.022, 0.016, 0.018) * lat;
      const lipC = lipCore(v) * lat * lat;
      // cheek apple lifts and bunches up under the eye
      const ch = Math.exp(-(((q.x - sgn * 0.034) / 0.019) ** 2) - (((q.y + 0.022) / 0.018) ** 2)) * frontMask(q.z);
      return [
        sw * (sgn * 0.0042 * (corner + 0.5 * p)),
        sw * (0.0058 * corner + 0.0026 * p + 0.0022 * lipC + 0.0042 * ch),
        sw * (-0.0024 * corner + 0.002 * ch),
      ];
    });
  }
  for (const [nm, sgn] of [['frownL', 1], ['frownR', -1]]) {
    addField(nm, v => {
      const q = mc(v);
      const sw = sideW(q.x, sgn);
      const cx = sgn * w;
      const corner = Math.exp(-(((q.x - cx) / 0.019) ** 2) - (((q.y - mo.lineY(clamp(q.x, -w, w))) / 0.018) ** 2)) * frontMask(q.z);
      // mentalis: the chin bunches and pushes the lower lip up in the middle
      const chin = Math.exp(-((q.x / 0.014) ** 2) - (((q.dy + mo.loH(0) + 0.009) / 0.009) ** 2)) * frontMask(q.z) * (q.up < 0.5 ? 1 : 0);
      return [sw * sgn * 0.0014 * corner, -0.0068 * corner * sw + 0.0014 * chin, -0.0008 * corner * sw + 0.0012 * chin];
    });
  }
  addField('upperUp', v => {
    const q = mc(v);
    if (q.up < 0.5 && ringM[v] !== 99) return null;
    if (q.up < 0.5) return null;
    const c = lipCore(v);
    const above = Math.exp(-((Math.max(0, q.dy - q.h) / 0.008) ** 2)) * Math.exp(-((q.dxo / 0.008) ** 2)) * frontMask(q.z);
    const wgt = Math.max(c, above) * (1 - 0.35 * Math.min(1, q.s * q.s));
    return [0, 0.0032 * wgt, 0.0010 * wgt];
  });
  addField('lowerDown', v => {
    const q = mc(v);
    if (q.up >= 0.5) return null;
    const c = lipCore(v);
    const below = Math.exp(-((Math.max(0, -q.dy - q.h) / 0.009) ** 2)) * Math.exp(-((q.dxo / 0.008) ** 2)) * frontMask(q.z);
    const wgt = Math.max(c, below) * (1 - 0.4 * Math.min(1, q.s * q.s));
    return [0, -0.0036 * wgt, 0.0012 * wgt];
  });
  addField('tuck', v => {
    const q = mc(v);
    const r = ringM[v];
    if (q.up >= 0.5) {
      const c = lipCore(v) * (1 - 0.5 * Math.min(1, q.s * q.s));
      return [0, 0.0010 * c, 0.0004 * c];
    }
    const c = lipCore(v);
    const below = Math.exp(-((Math.max(0, -q.dy - q.h) / 0.008) ** 2)) * Math.exp(-((q.dxo / 0.007) ** 2)) * frontMask(q.z);
    const wgt = Math.max(c, 0.6 * below) * (1 - 0.55 * Math.min(1, q.s * q.s));
    const curl = r <= 3 && r >= -3 ? 1 - Math.max(0, r) / 4 : 0;
    return [0, 0.0048 * wgt + 0.0016 * curl, -0.0052 * wgt - 0.003 * curl];
  });
  addField('press', v => {
    const q = mc(v);
    const c = lipCore(v);
    const r = ringM[v];
    const roll = r >= 0 && r <= 4 ? 1 - r / 5 : r < 0 && r >= -3 ? 1 : 0;
    const sgn = q.up >= 0.5 ? 1 : q.up > 0 ? 0 : -1;
    const cen = 1 - 0.6 * Math.min(1, q.s * q.s);
    return [-q.x * 0.04 * c, -sgn * 0.0009 * c * cen, (-0.0010 * c - 0.0012 * roll) * cen];
  });
  // as the jaw drops the corners draw in and the lips round off
  addField('jawCorner', v => {
    const q = mc(v); const p = perioral(v, 0.014, 0.01, 0.012);
    const lat = Math.min(1.2, Math.abs(q.s));
    const nearLine = Math.exp(-((q.dy / 0.006) ** 2));
    return [-q.x * 0.16 * p * lat * lat, -0.0012 * p * nearLine * lat * lat, 0.0012 * p * lat];
  });
  addField('shift', v => {
    const p = perioral(v, 0.02, 0.016, 0.02);
    return [0.004 * p, 0, 0];
  });
  // ----------------------------------------------------------- mid face
  for (const [nm, sgn] of [['cheekL', 1], ['cheekR', -1]]) {
    addField(nm, v => {
      const x = rest[3 * v], y = rest[3 * v + 1], z = rest[3 * v + 2];
      const ch = Math.exp(-(((x - sgn * 0.036) / 0.017) ** 2) - (((y + 0.02) / 0.016) ** 2)) * frontMask(z);
      return [0, 0.0026 * ch, 0.0012 * ch];
    });
  }
  for (const [nm, sgn] of [['sneerL', 1], ['sneerR', -1]]) {
    addField(nm, v => {
      const x = rest[3 * v], y = rest[3 * v + 1], z = rest[3 * v + 2];
      const ns = Math.exp(-(((x - sgn * 0.014) / 0.009) ** 2) - (((y + 0.026) / 0.012) ** 2)) * frontMask(z);
      return [0, 0.0022 * ns, 0.0006 * ns];
    });
  }

  // --------------------------------------------------------------- lids
  const lidU = new Float32Array(n), lidL = new Float32Array(n), lidJ = new Int32Array(n).fill(-1), lidSide = new Int8Array(n);
  for (let v = 0; v < n; v++) {
    const k = M.kind[v];
    if (k !== 1 && k !== 2) continue;
    const r = M.ring[v], up = M.upper[v];
    const fu = r <= 0 ? 1 : sstep(6.5, 0.8, r);
    const fl = r <= 0 ? 1 : sstep(4.8, 0.4, r);
    lidU[v] = up >= 0.5 ? fu * (up === 0.5 ? 0.5 : 1) : 0;
    lidL[v] = up <= 0.5 ? fl * (up === 0.5 ? 0.5 : 1) : 0;
    lidJ[v] = M.seg[v];
    lidSide[v] = M.side[v];
  }
  // rest elevations of the margins in each eye's y-z plane, per angular index
  const eyes = {};
  for (const [key, side, rings] of [['L', 1, hm.eyeRings.L], ['R', -1, hm.eyeRings.R]]) {
    const C = side > 0 ? L.eyeL : L.eyeR;
    const ME = hm.ME;
    const psi = new Float32Array(ME);
    for (let j = 0; j < ME; j++) {
      const v = rings[0][j];
      psi[j] = Math.atan2(rest[3 * v + 1] - C[1], rest[3 * v + 2] - C[2]);
    }
    // partner index on the other lid (same t): j <-> ME - j
    eyes[key] = { C, side, psi, ME, dU: new Float32Array(ME), dL: new Float32Array(ME) };
  }

  // ------------------------------------------------------------- brows
  const browMask = v => (1 - Math.max(lidU[v], lidL[v]));
  for (const [sfx, sgn] of [['L', 1], ['R', -1]]) {
    addField('browInner' + sfx, v => {
      const x = rest[3 * v], y = rest[3 * v + 1], z = rest[3 * v + 2];
      const b = Math.exp(-(((x - sgn * 0.018) / 0.014) ** 2) - (((y - 0.027) / 0.018) ** 2)) * frontMask(z) * sstep(0.004, 0.016, y) * browMask(v);
      return [sgn * 0.0008 * b, 0.0075 * b, 0.0006 * b];
    });
    addField('browOuter' + sfx, v => {
      const x = rest[3 * v], y = rest[3 * v + 1], z = rest[3 * v + 2];
      const b = Math.exp(-(((x - sgn * 0.046) / 0.016) ** 2) - (((y - 0.025) / 0.017) ** 2)) * frontMask(z - 0.01) * sstep(0.004, 0.016, y) * browMask(v);
      return [0, 0.0062 * b, 0.0003 * b];
    });
    addField('browDown' + sfx, v => {
      const x = rest[3 * v], y = rest[3 * v + 1], z = rest[3 * v + 2];
      const b = Math.exp(-(((x - sgn * 0.024) / 0.016) ** 2) - (((y - 0.022) / 0.013) ** 2)) * frontMask(z) * sstep(0.002, 0.014, y) * browMask(v);
      const inner = Math.exp(-(((x - sgn * 0.012) / 0.01) ** 2) - (((y - 0.018) / 0.012) ** 2)) * frontMask(z);
      return [-sgn * 0.0036 * b, -0.0055 * b - 0.0012 * inner, 0.0016 * b + 0.001 * inner];
    });
  }

  // ---------------------------------------------------------------- jaw
  const wJaw = new Float32Array(n);
  for (let v = 0; v < n; v++) {
    const x = rest[3 * v], y = rest[3 * v + 1], z = rest[3 * v + 2];
    const ax = Math.abs(x);
    const Xc = clamp(x, -w, w);
    // separation curve rises from the mouth corners back toward the ear
    const lat = Math.max(0, ax - w);
    const sepY = mo.lineY(Xc) + lat * 0.45 - lat * lat * 2.0;
    const band = 0.003 + lat * 0.55;
    let wj = sstep(0.5, -0.5, (y - sepY) / band);
    // behind the ramus and down the neck the jaw lets go
    wj *= sstep(-0.03, 0.02, z) * sstep(-0.16, -0.105, y - 0.25 * Math.max(0, 0.02 - z));
    const r = ringM[v];
    if (r < 99) {
      // exact split along the lip rings; toward the corners both lips share the
      // jaw so the opening is a lens, not a box
      const j = M.seg[v], MM = hm.MM;
      const a = 2 * Math.PI * j / MM;
      const sa = Math.sin(a), ca = Math.cos(a);
      const sgn = Math.tanh(sa / 0.08);
      const cornerK = sstep(0.98, 0.42, Math.abs(ca)); // 0 at the corners, 1 in the middle
      const split = 0.5 - 0.5 * sgn * (r === -hm.bagRings - 1 ? 0 : 1) * (0.25 + 0.75 * cornerK);
      const g = r <= 3 ? 0 : sstep(3, 9, r);
      wj = mix(split, wj, g);
      if (M.kind[v] === 5) wj = 0.5;
    }
    wJaw[v] = clamp(wj);
  }

  // ------------------------------------------------------ per-frame deform
  const out = new Float32Array(rest.length);
  const lidAngle = new Float32Array(n);
  const mouthRings = hm.mouthRings, MM = hm.MM, nbag = hm.bagRings;

  function deform(c) {
    out.set(rest);
    // 1. linear fields
    const apply = (name, wgt) => {
      if (!wgt) return;
      const F = fields[name]; const I = F.idx, D = F.d;
      for (let i = 0; i < I.length; i++) {
        const o = 3 * I[i];
        out[o] += D[3 * i] * wgt; out[o + 1] += D[3 * i + 1] * wgt; out[o + 2] += D[3 * i + 2] * wgt;
      }
    };
    apply('pucker', c.pucker); apply('funnel', c.funnel);
    apply('stretchL', c.stretchL); apply('stretchR', c.stretchR);
    apply('smileL', c.smileL); apply('smileR', c.smileR);
    apply('frownL', c.frownL); apply('frownR', c.frownR);
    apply('upperUp', c.upperUp); apply('lowerDown', c.lowerDown);
    apply('tuck', c.tuck); apply('press', c.press); apply('shift', c.shift);
    apply('jawCorner', clamp(c.jaw || 0, 0, 1.2) * (1 - 0.6 * clamp((c.stretchL || 0) + (c.stretchR || 0), 0, 1)));
    apply('cheekL', c.cheekL); apply('cheekR', c.cheekR);
    apply('sneerL', c.sneerL); apply('sneerR', c.sneerR);
    apply('browInnerL', c.browInnerL); apply('browInnerR', c.browInnerR);
    apply('browOuterL', c.browOuterL); apply('browOuterR', c.browOuterR);
    apply('browDownL', c.browDownL); apply('browDownR', c.browDownR);

    // 2. jaw rotation about the TMJ axis (x), with a little forward slide
    const ang = clamp(c.jaw || 0, -0.1, 1.2) * JAW_MAX;
    if (Math.abs(ang) > 1e-5) {
      const ca = Math.cos(ang), sa = Math.sin(ang), slide = 0.002 * (c.jaw || 0);
      const py = jawPivot[1], pz = jawPivot[2];
      for (let v = 0; v < n; v++) {
        const wj = wJaw[v];
        if (wj <= 0) continue;
        const o = 3 * v;
        const y = out[o + 1] - py, z = out[o + 2] - pz;
        const ny = y * ca - z * sa, nz = y * sa + z * ca;
        out[o + 1] = py + mix(y, ny, wj);
        out[o + 2] = pz + mix(z, nz, wj) + slide * wj;
      }
    }

    // 3. seal: bring the two lips together along matching rings
    const seal = clamp(c.seal || 0);
    if (seal > 0) {
      const wk = { [-4]: 0.35, [-3]: 1, [-2]: 1, [-1]: 1, 0: 1, 1: 1, 2: 0.85, 3: 0.55, 4: 0.28, 5: 0.1 };
      const r0 = mouthRings[0];
      for (let j = 1; j < MM / 2; j++) {
        const jl = MM - j;
        const a = 3 * r0[j], b = 3 * r0[jl];
        // meet slightly toward the upper lip (the lower lip does more of the work)
        const gx = out[a] - out[b], gy = out[a + 1] - out[b + 1], gz = out[a + 2] - out[b + 2];
        for (const kk in wk) {
          const ring = mouthRings[kk]; if (!ring) continue;
          const f = seal * wk[kk];
          const u = 3 * ring[j], l = 3 * ring[jl];
          out[u] -= gx * f * 0.42; out[u + 1] -= gy * f * 0.42; out[u + 2] -= gz * f * 0.42;
          out[l] += gx * f * 0.58; out[l + 1] += gy * f * 0.58; out[l + 2] += gz * f * 0.58;
        }
      }
    }

    // 4. lids: rotate about each eye centre (x axis)
    for (const key of ['L', 'R']) {
      const E = eyes[key];
      const e = c.eyes[key];
      const ME = E.ME;
      const pitch = e.pitch || 0;
      const follU = pitch > 0 ? 0.7 : 0.95, follL = pitch > 0 ? 0.35 : 0.55;
      for (let j = 0; j <= ME / 2; j++) {
        const ju = j, jl = (ME - j) % ME;
        const pu = E.psi[ju], pl = E.psi[jl];
        const openU = pu + follU * pitch + e.wide * 9 * DEG - e.squint * 4 * DEG - (e.droop || 0) * 6 * DEG;
        const openL = pl + follL * pitch + e.squint * 9.5 * DEG - e.wide * 3 * DEG;
        const lo = Math.min(openL, openU);
        const meet = mix(lo, Math.max(openU, lo), 0.3);
        const b = clamp(e.blink);
        const tu = mix(Math.max(openU, lo), meet - 0.4 * DEG * b, b);
        const tl = mix(lo, meet, b);
        E.dU[ju] = tu - pu; E.dL[jl] = tl - pl;
        if (j === 0 || j === ME / 2) { E.dU[ju] = 0.5 * (tu - pu + tl - pl); E.dL[jl] = E.dU[ju]; }
      }
    }
    for (let v = 0; v < n; v++) {
      const s = lidSide[v];
      if (!s) { lidAngle[v] = 0; continue; }
      const E = s > 0 ? eyes.L : eyes.R;
      const j = lidJ[v];
      const a = lidU[v] * E.dU[j] + lidL[v] * E.dL[j];
      lidAngle[v] = a;
      if (Math.abs(a) < 1e-6) continue;
      const o = 3 * v;
      const y = out[o + 1] - E.C[1], z = out[o + 2] - E.C[2];
      const ca = Math.cos(a), sa = Math.sin(a);
      out[o + 1] = E.C[1] + y * ca + z * sa;
      out[o + 2] = E.C[2] - y * sa + z * ca;
    }
    return out;
  }

  return { deform, rest, out, wJaw, lidAngle, lidU, lidL, lidSide, eyes, fields, jawPivot, JAW_MAX, isUpperV, ringM };
}

/** blend viseme weights + expression layer into the rig's control values */
export function faceControls(st, persona = {}) {
  const c = {
    jaw: 0, seal: 0, press: 0, tuck: 0, upperUp: 0, lowerDown: 0, pucker: 0, funnel: 0,
    stretchL: 0, stretchR: 0, smileL: 0, smileR: 0, frownL: 0, frownR: 0, shift: 0,
    cheekL: 0, cheekR: 0, sneerL: 0, sneerR: 0,
    browInnerL: 0, browInnerR: 0, browOuterL: 0, browOuterR: 0, browDownL: 0, browDownR: 0,
    tipUp: 0, tongueOut: 0, back: 0,
    eyes: { L: { blink: 0, squint: 0, wide: 0, pitch: 0 }, R: { blink: 0, squint: 0, wide: 0, pitch: 0 } },
  };
  const vis = st.visemes || {};
  let sum = 0;
  for (const k in VISEMES) {
    const wv = vis[k] || 0;
    if (!wv) continue;
    sum += wv;
    const V = VISEMES[k];
    for (const p in V) {
      if (p === 'stretch') { c.stretchL += V[p] * wv; c.stretchR += V[p] * wv; }
      else if (p === 'smile') { c.smileL += V[p] * wv; c.smileR += V[p] * wv; }
      else c[p] += V[p] * wv;
    }
  }
  const mouth = st.mouth || {};
  const asym = persona.smileAsym ?? 0.15; // >0: the left corner lifts more
  const smile = mouth.smile || 0, frown = mouth.frown || 0;
  c.smileL += smile * (1 + asym); c.smileR += smile * (1 - asym);
  c.cheekL += smile * 0.8 * (1 + asym); c.cheekR += smile * 0.8 * (1 - asym);
  c.frownL += frown * (1 - asym * 0.5); c.frownR += frown * (1 + asym * 0.5);
  c.lowerDown += frown * 0.15;
  c.jaw += mouth.jaw || 0;
  // lips part a touch when smiling broadly, and the corners press less
  c.upperUp += smile * 0.12;
  // speaking lips keep a hint of the expression
  const br = st.brows || {};
  const raise = br.raise || 0, furrow = br.furrow || 0, sad = br.sad || 0;
  const bAsym = persona.browAsym ?? 0.1;
  const up = Math.max(0, raise), dn = Math.max(0, -raise);
  c.browInnerL += up * 0.9 + sad * 0.9; c.browInnerR += up * 0.9 + sad * 0.9;
  c.browOuterL += up * (1 + bAsym) - sad * 0.35; c.browOuterR += up * (1 - bAsym) - sad * 0.35;
  c.browDownL += dn + furrow * 0.9; c.browDownR += dn + furrow * 0.9;
  c.browInnerL -= furrow * 0.25; c.browInnerR -= furrow * 0.25;
  const ey = st.eyes || {};
  const blink = clamp(st.blink || 0);
  for (const s of ['L', 'R']) {
    const e = c.eyes[s];
    e.blink = blink;
    e.squint = clamp((ey.squint || 0) + smile * 0.35 * (s === 'L' ? 1 + asym : 1 - asym));
    e.wide = clamp((ey.wide || 0) + up * 0.25);
    e.droop = persona.lidDroop || 0;
  }
  c.cheekL += (ey.squint || 0) * 0.4; c.cheekR += (ey.squint || 0) * 0.4;
  c._visSum = sum;
  return c;
}
