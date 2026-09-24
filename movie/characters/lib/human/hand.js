// Hands: palm + five fingers as skinned lofts along the finger bones, nail
// plates, and a baked atlas texture (lighter palms, knuckle wrinkles, palmar
// creases, nail beds). Built in the bind pose from rig.handLayout.

import * as THREE from 'three';
import { BODY, handLayout, FINGER_NAMES } from './rig.js';
import { loft, sgnpow } from './loft.js';

const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const COLS = 6; // atlas columns: palm, thumb, index, middle, ring, pinky

export function buildHands(id, rig, skinCols, rnd) {
  const B = BODY[id];
  const bi = name => rig.list.indexOf(rig.bones[name]);
  const P = [], UV = [], SI = [], SW = [], C = [], idx = [];
  const nailP = [], nailN = [], nailSI = [], nailSW = [], nailIdx = [];
  const add = (part, col) => {
    const base = P.length / 3;
    P.push(...part.P); SI.push(...part.SI); SW.push(...part.SW); C.push(...part.C);
    // remap uv to the atlas column: u in [col/COLS, (col+1)/COLS] by ring angle, v by length
    for (let i = 0; i < part.UV.length; i += 2) UV.push((col + clamp(part.UV[i])) / COLS, clamp(part.UV[i + 1]));
    for (const g of part.groups) for (let i = g.start; i < g.start + g.count; i++) idx.push(part.idx[i] + base);
  };
  for (const [k, s] of [['L', 1], ['R', -1]]) {
    const H = handLayout(id, s);
    const { F, T, P: Pn, W } = H;
    const D = Pn.clone().negate(); // dorsal
    const at = (f, t, p) => W.clone().addScaledVector(F, f).addScaledVector(T, t).addScaledVector(Pn, p);
    const hw = B.fingers.palmW * 0.5;
    // ---- palm: stations along F; X = T (thumb side), Z = D (back of the hand)
    const pr = [[-0.012, 0.8, 0.95, 1.0], [0.0, 0.84, 0.95, 1.0], [0.02, 0.92, 1.0, 1.1], [0.045, 1.0, 1.0, 1.08], [0.068, 1.03, 0.95, 1.0], [B.handLen - 0.008, 1.02, 0.85, 0.92], [B.handLen + 0.004, 0.94, 0.7, 0.75]];
    const tD = 0.0125 * (id === 'sam' ? 1.08 : 1), tP = 0.0135 * (id === 'sam' ? 1.08 : 1);
    const pst = pr.map(([f, ws, sd, sp]) => ({
      c: at(f, -0.002, 0), X: T.clone().multiplyScalar(1), Z: D.clone(), f,
      shape: th => {
        const sn = Math.sin(th), c = Math.cos(th);
        // thenar bulge on the thumb side of the palm near the wrist
        const thenar = sn > 0 && c < 0.2 ? 0.004 * sstep(0.07, 0.03, f) * sstep(-0.01, 0.02, f) : 0;
        return [hw * ws * sgnpow(sn, 0.55) + thenar * sn, (c >= 0 ? tD * sd : tP * sp) * sgnpow(c, 0.8)];
      },
    }));
    const palmW = (i, th, p) => {
      const f = pst[i].f;
      const wt = sstep(0.012, -0.012, f);
      const w = [[bi('hand' + k), 1 - wt], [bi('twist' + k), wt]];
      // knuckle end: blend into the nearest finger's first bone
      const kb = sstep(B.handLen - 0.02, B.handLen + 0.004, f);
      if (kb > 0) {
        const tt = p.clone().sub(W).dot(T);
        let best = 0, bd = 1e9;
        H.fingers.forEach((fg, fi) => { const d = Math.abs(fg.base.clone().sub(W).dot(T) - tt); if (d < bd) { bd = d; best = fi; } });
        w[0][1] *= 1 - kb * 0.5;
        w.push([bi(FINGER_NAMES[best] + 0 + k), kb * 0.5]);
      }
      return w;
    };
    const palm = loft(pst, { M: 24, rRef: 1 / (2 * Math.PI), weights: palmW, flip: s < 0, capStart: false });
    // normalise v to 0..1
    for (let i = 1; i < palm.UV.length; i += 2) palm.UV[i] = palm.UV[i] / 0.1;
    add(palm, 0);
    // ---- fingers + thumb
    const chains = [...H.fingers.map((fg, i) => ({ ...fg, name: FINGER_NAMES[i], col: 2 + i })), { ...H.thumb, name: 'thumb', col: 1 }];
    for (const fg of chains) {
      const L = fg.segs[0] + fg.segs[1] + fg.segs[2];
      const j1 = fg.segs[0], j2 = fg.segs[0] + fg.segs[1];
      const isThumb = fg.name === 'thumb';
      const r0 = fg.r;
      // local frame: X across the finger (T-ish), Z dorsal
      let Xf = new THREE.Vector3().crossVectors(fg.dir, D).normalize();
      if (Xf.dot(T) < 0) Xf.negate();
      const Zf = new THREE.Vector3().crossVectors(Xf, fg.dir).normalize();
      if (Zf.dot(D) < 0) Zf.negate();
      const start = isThumb ? -0.004 : -0.014;
      const along = [start, 0.004, j1 * 0.5, j1 - 0.004, j1, j1 + 0.004, j1 + (j2 - j1) * 0.5, j2 - 0.003, j2, j2 + 0.003, L - 0.012, L - 0.006, L - 0.0025, L - 0.0005];
      const fst = along.map(a => {
        const u = clamp(a / L);
        let r = r0 * (1 - 0.2 * u);
        const tipIn = a > L - 0.013 ? (a - (L - 0.013)) / 0.013 : 0;
        const tip = Math.sqrt(Math.max(0, 1 - tipIn * tipIn));
        r *= a > L - 0.013 ? Math.max(0.12, tip) : 1;
        // knuckle bumps on the dorsal side
        const kn = Math.exp(-(((a - j1) / 0.005) ** 2)) * 0.13 + Math.exp(-(((a - j2) / 0.004) ** 2)) * 0.08 + Math.exp(-(((a - 0) / 0.006) ** 2)) * 0.1;
        return { c: fg.base.clone().addScaledVector(fg.dir, a), X: Xf, Z: Zf, a, kn,
          shape: th => { const c = Math.cos(th), sn = Math.sin(th); return [r * sn, r * (c >= 0 ? 0.86 + kn * Math.max(0, c) * 3 : 0.96) * c]; } };
      });
      const fw = (i) => {
        const a = fst[i].a;
        const b1 = sstep(j1 - 0.005, j1 + 0.005, a), b2 = sstep(j2 - 0.004, j2 + 0.004, a), b0 = sstep(-0.008, 0.004, a);
        const n0 = fg.name + 0 + k, n1 = fg.name + 1 + k, n2 = fg.name + 2 + k;
        return [[bi('hand' + k), 1 - b0], [bi(n0), b0 * (1 - b1)], [bi(n1), b1 * (1 - b2)], [bi(n2), b2]];
      };
      const fl = loft(fst, { M: 14, rRef: 1 / (2 * Math.PI), weights: fw, flip: s < 0, capEnd: true });
      for (let i = 1; i < fl.UV.length; i += 2) fl.UV[i] = clamp(fl.UV[i] / L);
      add(fl, fg.col);
      // nail plate on the distal dorsal
      const nb = nailP.length / 3;
      const nw = r0 * 0.72, nl = Math.min(fg.segs[2] * 0.62, 0.012);
      const a0 = L - nl - 0.0025;
      for (let yy = 0; yy <= 3; yy++) for (let xx = 0; xx <= 4; xx++) {
        const a = a0 + nl * yy / 3;
        const xn = (xx / 4 - 0.5) * 2;
        const rr = r0 * (1 - 0.2 * clamp(a / L));
        const ang = xn * 0.95;
        const lift = 0.00035 + 0.0002 * (1 - xn * xn);
        const tipIn = a > L - 0.013 ? (a - (L - 0.013)) / 0.013 : 0;
        const rad = rr * Math.max(0.3, Math.sqrt(Math.max(0, 1 - tipIn * tipIn))) * 0.88 + lift;
        const p = fg.base.clone().addScaledVector(fg.dir, a).addScaledVector(Xf, Math.sin(ang) * rad * 1.1).addScaledVector(Zf, Math.cos(ang) * rad);
        nailP.push(p.x, p.y, p.z);
        const n = Xf.clone().multiplyScalar(Math.sin(ang)).addScaledVector(Zf, Math.cos(ang)).normalize();
        nailN.push(n.x, n.y, n.z);
        nailSI.push(bi(fg.name + 2 + k), 0, 0, 0); nailSW.push(1, 0, 0, 0);
      }
      for (let yy = 0; yy < 3; yy++) for (let xx = 0; xx < 4; xx++) {
        const a = nb + yy * 5 + xx, b = a + 1, c = a + 6, d = a + 5;
        if (s > 0) nailIdx.push(a, c, b, a, d, c); else nailIdx.push(a, b, c, a, c, d);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(SI, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(SW, 4));
  g.setAttribute('color', new THREE.Float32BufferAttribute(C.map(() => 1), 3));
  const n = P.length / 3;
  g.setAttribute('wet', new THREE.Float32BufferAttribute(new Float32Array(n), 1));
  g.setAttribute('ao', new THREE.Float32BufferAttribute(new Float32Array(n).fill(1), 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  const ng = new THREE.BufferGeometry();
  ng.setAttribute('position', new THREE.Float32BufferAttribute(nailP, 3));
  ng.setAttribute('normal', new THREE.Float32BufferAttribute(nailN, 3));
  ng.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(nailSI, 4));
  ng.setAttribute('skinWeight', new THREE.Float32BufferAttribute(nailSW, 4));
  ng.setIndex(nailIdx);
  const tex = bakeHandAtlas(id, skinCols, rnd);
  return { geometry: g, nails: ng, tex };
}

/** hand atlas: columns palm/thumb/index/middle/ring/pinky; u = ring angle (0 = dorsal), v = along */
function bakeHandAtlas(id, sc, rnd) {
  const Wd = 768, Ht = 256;
  const cv = document.createElement('canvas'); cv.width = Wd; cv.height = Ht;
  const g = cv.getContext('2d');
  const hv = document.createElement('canvas'); hv.width = Wd; hv.height = Ht;
  const gh = hv.getContext('2d');
  gh.fillStyle = '#808080'; gh.fillRect(0, 0, Wd, Ht);
  const cw = Wd / COLS;
  const rgb = (c, k = 1) => `rgb(${Math.round(c[0] * k)},${Math.round(c[1] * k)},${Math.round(c[2] * k)})`;
  const dorsal = sc.dorsal, palm = sc.palm;
  for (let col = 0; col < COLS; col++) {
    const x0 = col * cw;
    // u: 0..1 around, with the dorsal side at u = 0.5 (th = pi from the loft's back seam) -> use a gradient
    for (let x = 0; x < cw; x++) {
      const u = x / cw;
      const th = Math.PI + u * Math.PI * 2; // loft seams at the back (th0 = pi)
      const dorsalAmt = Math.max(0, Math.cos(th)) ** 0.7; // cos(th) = 1 on the dorsal side (Z = dorsal)
      const c = [0, 1, 2].map(i => palm[i] + (dorsal[i] - palm[i]) * sstep(-0.35, 0.35, Math.cos(th)));
      g.fillStyle = rgb(c); g.fillRect(x0 + x, 0, 1, Ht);
      void dorsalAmt;
    }
    // creases and knuckle wrinkles
    const joints = col === 0 ? [] : col === 1 ? [0.36, 0.64] : [0.46, 0.76];
    for (const jv of joints) {
      const y = Ht - jv * Ht; // canvas y is flipped
      // dorsal knuckle wrinkles: several short arcs around the dorsal side
      for (let w = 0; w < 5; w++) {
        const yy = y + (w - 2) * 2.4;
        g.strokeStyle = `rgba(40,20,10,${0.2 + 0.1 * rnd()})`; g.lineWidth = 1;
        g.beginPath(); g.moveTo(x0 + cw * 0.3, yy + rnd()); g.quadraticCurveTo(x0 + cw * 0.5, yy + 1.5, x0 + cw * 0.7, yy + rnd()); g.stroke();
        gh.strokeStyle = 'rgba(40,40,40,0.8)'; gh.lineWidth = 1.2;
        gh.beginPath(); gh.moveTo(x0 + cw * 0.3, yy); gh.quadraticCurveTo(x0 + cw * 0.5, yy + 1.5, x0 + cw * 0.7, yy); gh.stroke();
      }
      // palmar flexion crease (deep, one or two lines on the palm side)
      for (const dy of [-2, 2]) {
        g.strokeStyle = 'rgba(90,50,40,0.45)'; g.lineWidth = 1.4;
        g.beginPath(); g.moveTo(x0, y + dy); g.lineTo(x0 + cw * 0.18, y + dy); g.moveTo(x0 + cw * 0.82, y + dy); g.lineTo(x0 + cw, y + dy); g.stroke();
        gh.strokeStyle = 'rgba(20,20,20,1)'; gh.lineWidth = 2;
        gh.beginPath(); gh.moveTo(x0, y + dy); gh.lineTo(x0 + cw * 0.2, y + dy); gh.moveTo(x0 + cw * 0.8, y + dy); gh.lineTo(x0 + cw, y + dy); gh.stroke();
      }
    }
    if (col === 0) {
      // palm lines: heart, head, life lines on the palm side (u near 0 / 1)
      g.strokeStyle = 'rgba(90,50,40,0.5)'; g.lineWidth = 1.5;
      gh.strokeStyle = 'rgba(10,10,10,1)'; gh.lineWidth = 2.2;
      for (const [a, b] of [[0.72, 0.62], [0.55, 0.5], [0.3, 0.45]]) {
        for (const ctx of [g, gh]) { ctx.beginPath(); ctx.moveTo(x0 + cw * 0.02, Ht - a * Ht); ctx.quadraticCurveTo(x0 + cw * 0.1, Ht - (a + b) / 2 * Ht - 6, x0 + cw * 0.2, Ht - b * Ht); ctx.stroke(); }
      }
      // knuckle knobs on the back of the hand
      g.fillStyle = 'rgba(30,15,8,0.18)';
      for (let i = 0; i < 4; i++) { g.beginPath(); g.ellipse(x0 + cw * (0.38 + i * 0.08), Ht * 0.12, 4, 6, 0, 0, Math.PI * 2); g.fill(); }
    } else {
      // nail bed (dorsal distal) handled by the nail mesh; darken the cuticle area
      g.fillStyle = 'rgba(40,20,12,0.25)';
      g.fillRect(x0 + cw * 0.36, Ht * 0.12, cw * 0.28, 3);
      // fingertip pads lighter on the palm side
      g.fillStyle = 'rgba(255,220,200,0.12)';
      g.fillRect(x0, 0, cw * 0.2, Ht * 0.12); g.fillRect(x0 + cw * 0.8, 0, cw * 0.2, Ht * 0.12);
    }
  }
  // speckle
  const id2 = g.getImageData(0, 0, Wd, Ht);
  for (let i = 0; i < id2.data.length; i += 4) {
    const n = (rnd() - 0.5) * 10;
    id2.data[i] += n; id2.data[i + 1] += n; id2.data[i + 2] += n;
  }
  g.putImageData(id2, 0, 0);
  const hd = gh.getImageData(0, 0, Wd, Ht).data;
  const nd = new Uint8Array(Wd * Ht * 4);
  for (let y = 0; y < Ht; y++) for (let x = 0; x < Wd; x++) {
    const hh = (xx, yy) => hd[4 * (Math.min(Ht - 1, Math.max(0, yy)) * Wd + Math.min(Wd - 1, Math.max(0, xx)))] / 255;
    const nx = -(hh(x + 1, y) - hh(x - 1, y)) * 1.4, ny = (hh(x, y + 1) - hh(x, y - 1)) * 1.4;
    const l = Math.hypot(nx, ny, 1);
    const i = 4 * ((Ht - 1 - y) * Wd + x);
    nd[i] = (nx / l * 0.5 + 0.5) * 255; nd[i + 1] = (ny / l * 0.5 + 0.5) * 255; nd[i + 2] = (1 / l * 0.5 + 0.5) * 255; nd[i + 3] = 255;
  }
  const map = new THREE.CanvasTexture(cv);
  map.colorSpace = THREE.SRGBColorSpace;
  const normalMap = new THREE.DataTexture(nd, Wd, Ht, THREE.RGBAFormat);
  normalMap.generateMipmaps = true; normalMap.minFilter = THREE.LinearMipmapLinearFilter; normalMap.magFilter = THREE.LinearFilter; normalMap.needsUpdate = true;
  return { map, normalMap };
}
