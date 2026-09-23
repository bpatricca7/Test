// The Visitor: voxels of light.
//
// materialize: voxels pour out of the monitor screen, swirl round the spot
// where the Visitor will stand and land on its body from the feet up; each
// lands exactly on a point of the current (posed) skin, so the swarm assembles
// the real figure. dissolve: the skin breaks up in the same cell order as the
// shader and every voxel streams, in twisting lanes, out through the window.
// Everything is a pure function of (materialize, dissolve, t, pose).

import { PART_VERT, PART_FRAG } from './shaders.js';

const TAU = Math.PI * 2;
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };

// the materialize schedule shared with the shader's build front
export const MAT = { a0: 0.28, a1: 0.86, top: 2.18, band: 0.3 };
export function buildFrontY(m) {
  // height reached by the arriving voxels at materialize m
  return (m - MAT.a0) / (MAT.a1 - MAT.a0) * MAT.top;
}
export const DIS = { d0: 0.04, d1: 0.72, band: 0.12 };

export function createParticles(THREE, U, buf, opts) {
  const NS = opts.surface || 24000, NF = opts.free || 5000, NM = opts.motes || 500;
  const N = NS + NF + NM;
  const rnd = U.mulberry32(4242);
  // --- targets: area-weighted triangles of the rest pose (skipping the mouth cavity) ---
  const idx = buf.idx, P = buf.pos, info = buf.info;
  const nt = idx.length / 3;
  const cdf = new Float64Array(nt);
  let acc = 0;
  for (let t = 0; t < nt; t++) {
    const a = idx[t * 3], b = idx[t * 3 + 1], c = idx[t * 3 + 2];
    let w = 0;
    const part = info[a * 4];
    if (part !== 2) {
      const ux = P[b * 3] - P[a * 3], uy = P[b * 3 + 1] - P[a * 3 + 1], uz = P[b * 3 + 2] - P[a * 3 + 2];
      const vx = P[c * 3] - P[a * 3], vy = P[c * 3 + 1] - P[a * 3 + 1], vz = P[c * 3 + 2] - P[a * 3 + 2];
      w = 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
      if (part >= 6) w *= 2.2;          // denser on the face
      if (part === 4) w *= 1.6;         // and the hands
    }
    acc += w; cdf[t] = acc;
  }
  const tA = new Uint32Array(NS), tB = new Uint32Array(NS), tC = new Uint32Array(NS);
  const bu = new Float32Array(NS), bv = new Float32Array(NS), off = new Float32Array(NS);
  const restY = new Float32Array(N);
  for (let i = 0; i < NS; i++) {
    const r = rnd() * acc;
    let lo = 0, hi = nt - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (cdf[m] < r) lo = m + 1; else hi = m; }
    tA[i] = idx[lo * 3]; tB[i] = idx[lo * 3 + 1]; tC[i] = idx[lo * 3 + 2];
    let u = rnd(), v = rnd();
    if (u + v > 1) { u = 1 - u; v = 1 - v; }
    bu[i] = u; bv[i] = v;
    off[i] = 0.002 + rnd() * 0.004;
    restY[i] = P[tA[i] * 3 + 1];
  }
  // --- per-particle randoms ---
  const R1 = new Float32Array(N), R2 = new Float32Array(N), R3 = new Float32Array(N), R4 = new Float32Array(N);
  const SU = new Float32Array(N), SV = new Float32Array(N), LANE = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    R1[i] = rnd(); R2[i] = rnd(); R3[i] = rnd(); R4[i] = rnd();
    SU[i] = rnd() - 0.5; SV[i] = rnd() - 0.5;
    LANE[i] = Math.floor(rnd() * 11);
    if (i >= NS) restY[i] = rnd() * 2.1;
  }
  const laneAng = [], laneRad = [];
  for (let l = 0; l < 11; l++) { laneAng.push(rnd() * TAU); laneRad.push(0.03 + rnd() * 0.16); }

  const pos = new Float32Array(N * 3), data = new Float32Array(N * 2);
  const g = new THREE.BufferGeometry();
  const pa = new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage);
  const da = new THREE.BufferAttribute(data, 2).setUsage(THREE.DynamicDrawUsage);
  g.setAttribute('position', pa);
  g.setAttribute('aData', da);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1, 0), 50);
  const mat = new THREE.ShaderMaterial({
    vertexShader: PART_VERT, fragmentShader: PART_FRAG,
    uniforms: { uPx: { value: 1000 }, uFlick: opts.uniforms.uFlick },
    transparent: true, depthWrite: false, depthTest: true,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(g, mat);
  points.frustumCulled = false;
  points.renderOrder = 13;
  points.onBeforeRender = (renderer, scene, camera) => {
    const h = renderer.getDrawingBufferSize ? renderer.getDrawingBufferSize(new THREE.Vector2()).y : 1080;
    mat.uniforms.uPx.value = camera.projectionMatrix.elements[5] * h * 0.5;
  };

  // scratch
  const tgt = [0, 0, 0], nrm = [0, 0, 0];
  function target(i) {
    const a = tA[i] * 3, b = tB[i] * 3, c = tC[i] * 3, u = bu[i], v = bv[i], w = 1 - u - v;
    const Pn = buf.pos, Nn = buf.nrm;
    nrm[0] = Nn[a] * w + Nn[b] * u + Nn[c] * v; nrm[1] = Nn[a + 1] * w + Nn[b + 1] * u + Nn[c + 1] * v; nrm[2] = Nn[a + 2] * w + Nn[b + 2] * u + Nn[c + 2] * v;
    const o = off[i];
    tgt[0] = Pn[a] * w + Pn[b] * u + Pn[c] * v + nrm[0] * o;
    tgt[1] = Pn[a + 1] * w + Pn[b + 1] * u + Pn[c + 1] * v + nrm[1] * o;
    tgt[2] = Pn[a + 2] * w + Pn[b + 2] * u + Pn[c + 2] * v + nrm[2] * o;
  }
  function bez(p0, p1, p2, p3, s, k) {
    const q = 1 - s;
    return q * q * q * p0[k] + 3 * q * q * s * p1[k] + 3 * q * s * s * p2[k] + s * s * s * p3[k];
  }
  const B0 = [0, 0, 0], B1 = [0, 0, 0], B2 = [0, 0, 0], B3 = [0, 0, 0];

  /**
   * f: { m, d, t, screen: {c, right, up, n, w, h} (object space), win: {c, n, right, up, w, h} (object space),
   *      axis: [x, z] body axis (object space), dissO, dissD, dissT(d) fn, presence, flicker, glow }
   */
  function update(f) {
    const { m, d, t } = f;
    const active = (m > 0 && m < 1) || (d > 0 && d < 1);
    const presence = f.presence;
    let any = false;
    const fr = Math.floor(t * 24);
    for (let i = 0; i < N; i++) {
      const o3 = i * 3, o2 = i * 2;
      let bright = 0, size = 0.006;
      const isFree = i >= NS && i < NS + NF, isMote = i >= NS + NF;
      if (isMote) {
        // ambient motes rising around the formed hologram
        if (presence > 0.02 && d < 0.9) {
          const life = 5 + 4 * R1[i];
          const ph = ((t + R2[i] * 50) / life) % 1;
          const ang = R3[i] * TAU + t * 0.1 * (R4[i] - 0.5);
          const rad = 0.12 + 0.3 * R4[i];
          pos[o3] = f.axis[0] + Math.cos(ang) * rad;
          pos[o3 + 1] = 0.05 + ph * 2.3;
          pos[o3 + 2] = f.axis[1] + Math.sin(ang) * rad;
          bright = presence * (1 - d) * 0.5 * Math.sin(Math.PI * ph) * (0.5 + 0.5 * Math.sin(t * 3 + i));
          size = 0.004;
        }
        data[o2] = size; data[o2 + 1] = bright;
        if (bright > 0) any = true;
        continue;
      }
      if (!active) { data[o2 + 1] = 0; continue; }
      const hn = clamp(restY[i] / MAT.top);
      // ------ materialize ------
      if (m > 0 && m < 1) {
        const arrive = MAT.a0 + (MAT.a1 - MAT.a0) * hn + 0.05 * (R1[i] - 0.5);
        const flight = 0.2 + 0.14 * R2[i];
        const emit = Math.max(0.01 + 0.04 * R3[i], arrive - flight);
        if (m < emit) { data[o2 + 1] = 0; continue; }
        // target (on the skin, or a free point on a column round the body)
        if (!isFree) target(i);
        else {
          const a = R3[i] * TAU + t * 0.8, r = 0.25 + 0.3 * R4[i];
          tgt[0] = f.axis[0] + Math.cos(a) * r; tgt[1] = restY[i]; tgt[2] = f.axis[1] + Math.sin(a) * r;
        }
        const s = clamp((m - emit) / (arrive - emit));
        if (s < 1) {
          const S = f.screen;
          // off the screen: a pixel of the image lifting off
          for (let k = 0; k < 3; k++) B0[k] = S.c[k] + S.right[k] * SU[i] * S.w + S.up[k] * SV[i] * S.h;
          for (let k = 0; k < 3; k++) B1[k] = B0[k] + S.n[k] * (0.35 + 0.3 * R4[i]) + (k === 1 ? 0.12 * (R1[i] - 0.3) : 0);
          // round the column where it will stand
          const ta = Math.atan2(tgt[2] - f.axis[1], tgt[0] - f.axis[0]) + (1.2 + 1.5 * R2[i]);
          const rr = 0.4 + 0.3 * R3[i];
          B2[0] = f.axis[0] + Math.cos(ta) * rr; B2[1] = tgt[1] + 0.35 * (R4[i] - 0.3); B2[2] = f.axis[1] + Math.sin(ta) * rr;
          B3[0] = tgt[0]; B3[1] = tgt[1]; B3[2] = tgt[2];
          const se = s < 0.5 ? 2 * s * s : 1 - 2 * (1 - s) * (1 - s);
          let x = bez(B0, B1, B2, B3, se, 0), y = bez(B0, B1, B2, B3, se, 1), z = bez(B0, B1, B2, B3, se, 2);
          // swirl about the body axis, unwinding onto the target
          const sw = (1 - se) * (1 - se) * (1.6 + 1.2 * R1[i]) * se * 2.2;
          const dx = x - f.axis[0], dz = z - f.axis[1];
          const cs = Math.cos(sw), sn = Math.sin(sw);
          x = f.axis[0] + dx * cs - dz * sn; z = f.axis[1] + dx * sn + dz * cs;
          pos[o3] = x; pos[o3 + 1] = y; pos[o3 + 2] = z;
          bright = (1.1 + 0.9 * R3[i]) * sstep(0, 0.06, s) * (isFree ? 1 - sstep(0.6, 0.95, s) : 1);
          size = 0.007 + 0.006 * R4[i];
        } else if (!isFree) {
          // landed: a flash, then it becomes the surface
          const since = m - arrive;
          pos[o3] = tgt[0]; pos[o3 + 1] = tgt[1]; pos[o3 + 2] = tgt[2];
          bright = 2.4 * Math.exp(-since / 0.025) + 0.55 * (1 - sstep(0.0, 0.16, since));
          bright *= 1 - sstep(0.9, 1.0, m);
          size = 0.006 + 0.003 * R4[i];
        }
        // flicker: some voxels blink
        if (((fr * 13 + i * 7) % 29) === 0) bright *= 0.3;
      }
      // ------ dissolve ------
      if (d > 0 && d < 1) {
        let order;
        if (!isFree) { target(i); order = (tgt[0] - f.dissO[0]) * f.dissD[0] + (tgt[1] - f.dissO[1]) * f.dissD[1] + (tgt[2] - f.dissO[2]) * f.dissD[2] + (R1[i] - 0.5) * 0.18; }
        else { const a = R3[i] * TAU; tgt[0] = f.axis[0] + Math.cos(a) * 0.3 * R4[i]; tgt[1] = restY[i]; tgt[2] = f.axis[1] + Math.sin(a) * 0.3 * R4[i]; order = (tgt[1] - f.dissO[1]) * f.dissD[1] + R1[i] * 0.3; nrm[0] = Math.cos(a); nrm[1] = 0; nrm[2] = Math.sin(a); }
        const launch = f.dissLaunch(order);
        const flight = 0.24 + 0.14 * R2[i];
        if (d < launch) {
          // still part of the body: a few sparkle near the front
          const near = launch - d;
          bright = near < 0.05 && !isFree ? 0.9 * (1 - near / 0.05) : 0;
          pos[o3] = tgt[0]; pos[o3 + 1] = tgt[1]; pos[o3 + 2] = tgt[2];
          size = 0.005;
        } else {
          const s = clamp((d - launch) / flight);
          const W = f.win;
          const lane = LANE[i];
          // lane cross offset, twisting along the path
          const la = laneAng[lane] + s * 5.0 + R3[i] * 0.6;
          const lr = laneRad[lane] * (0.35 + 0.65 * Math.abs(1 - 2 * s)) + 0.04 * R4[i];
          const ox = Math.cos(la) * lr, oy = Math.sin(la) * lr;
          for (let k = 0; k < 3; k++) {
            B0[k] = tgt[k];
            B1[k] = tgt[k] + nrm[k] * (0.12 + 0.1 * R4[i]) + (k === 1 ? 0.15 + 0.2 * R2[i] : 0);
            B2[k] = W.c[k] - W.n[k] * (0.55 + 0.3 * R1[i]) + W.right[k] * ox * 1.6 + W.up[k] * (oy * 1.6 + 0.12);
            B3[k] = W.c[k] + W.n[k] * (0.9 + 1.6 * R2[i]) + W.right[k] * ox * 2.5 + W.up[k] * (oy * 2.5 + 0.55 + 0.4 * R3[i]);
          }
          const se = s * s * (3 - 2 * s) * 0.6 + s * 0.4;
          pos[o3] = bez(B0, B1, B2, B3, se, 0); pos[o3 + 1] = bez(B0, B1, B2, B3, se, 1); pos[o3 + 2] = bez(B0, B1, B2, B3, se, 2);
          bright = (1.3 + 0.8 * R3[i]) * (1 + 1.2 * Math.exp(-(d - launch) / 0.02)) * (1 - sstep(0.7, 1.0, s));
          size = 0.006 + 0.006 * R4[i];
        }
      }
      data[o2] = size; data[o2 + 1] = bright;
      if (bright > 0) any = true;
    }
    pa.needsUpdate = true; da.needsUpdate = true;
    points.visible = any;
  }
  return { points, update, count: N };
}
