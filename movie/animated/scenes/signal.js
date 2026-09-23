// ECHO (animated cut) — "signal" (film 74.0 – 96.0 s)
//
// The signal itself: a 3D spectrogram ("waterfall") in phosphor green on black.
// X is audio frequency (0 – 2.4 kHz), Z is time. New data is written at a
// glowing "head" line ahead of the camera and the whole terrain rolls toward
// us like a conveyor that speeds up as the pulse rate climbs.
//
// Every one of the 1,679 pulses in TL.pulses is a ridge on its lane (1420 Hz
// for a 1, 1000 Hz for a 0) that appears at the head on exactly the frame its
// beep starts. Heights are computed from the pulse schedule for time t alone
// (binary searches + prefix sums), never incrementally, so frames can render
// in any order. At 93.0 the pulses stop dead, the terrain freezes and decays,
// and the HUD reads END OF TRANSMISSION.

import { makeAA } from './echo_aa.js';

export async function create(env) {
  const { THREE, TL, W, H, renderer, U, FONT } = env;
  const V3 = THREE.Vector3;
  const { clamp, lerp, smooth, prog } = U;
  const ease = U.easeInOut;
  const deg = d => d * Math.PI / 180;

  // ------------------------------------------------------------------ pulses
  const PU = TL.pulses;
  const TIMES = PU.times, BITS = PU.bits, NP = TIMES.length;
  const T_START = PU.start;                           // 76.0
  const DUR = new Float64Array(NP);
  for (let i = 0; i < NP; i++) {
    const gap = i + 1 < NP ? TIMES[i + 1] - TIMES[i] : TIMES[i] - TIMES[i - 1];
    DUR[i] = Math.min(0.09, 0.6 * gap);
  }
  const T_LAST = TIMES[NP - 1];
  const T_STOP = 93.0;                                // the stream stops dead
  const FREQ = [PU.freq_zero, PU.freq_one];           // lane 0 = bit 0, lane 1 = bit 1

  // per lane: sorted starts, ends and prefix sums of on-time
  const lanes = [0, 1].map(b => {
    const idx = [];
    for (let i = 0; i < NP; i++) if (BITS[i] === b) idx.push(i);
    const n = idx.length;
    const S = new Float64Array(n), E = new Float64Array(n), PRE = new Float64Array(n + 1);
    for (let j = 0; j < n; j++) { S[j] = TIMES[idx[j]]; E[j] = S[j] + DUR[idx[j]]; PRE[j + 1] = PRE[j] + DUR[idx[j]]; }
    return { S, E, PRE, n };
  });
  /** number of entries of sorted arr that are <= x */
  const countLE = (arr, n, x) => { let lo = 0, hi = n; while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] <= x) lo = m + 1; else hi = m; } return lo; };
  /** total on-time of a lane up to time tau */
  const onTime = (L, tau) => {
    const j = countLE(L.S, L.n, tau) - 1;
    if (j < 0) return 0;
    return L.PRE[j] + Math.min(L.E[j] - L.S[j], tau - L.S[j]);
  };
  /** index of the last pulse starting at or before t (-1 if none) */
  const pulseAt = t => countLE(TIMES, NP, t) - 1;

  // ------------------------------------------------------------ the conveyor
  // Data emitted at time tau sits at distance P(t) - P(tau) behind the head.
  // Speed grows exponentially with the pulse rate; it stops dead at T_STOP.
  const S0 = 12.0, AL = 0.1, T0 = T_START;
  const E0 = Math.exp(AL * (74.0 - T0));
  const Praw = t => S0 / AL * (Math.exp(AL * (t - T0)) - E0);
  const P = t => Praw(Math.min(t, T_STOP));
  const Pinv = p => T0 + Math.log(Math.max(p * AL / S0 + E0, 1e-6)) / AL;

  // --------------------------------------------------------------- geometry
  const KX = 1 / 30;                                   // world units per Hz
  const F_MID = 1210;
  const fx = f => (f - F_MID) * KX;                    // 1000 Hz -> -7, 1420 Hz -> +7
  const LX = [fx(FREQ[0]), fx(FREQ[1])];
  const X_MIN = fx(0), X_MAX = fx(2420);
  const Z_HEAD = -30, Z_NEAR = 14, DZ = 0.1;
  const NR = Math.ceil((Z_NEAR - Z_HEAD) / DZ) + 2;    // rows, head first
  // columns: fine near the two lanes, coarse elsewhere
  const XS = [];
  for (let x = X_MIN; x <= X_MAX + 1e-6;) {
    XS.push(x);
    const dl = Math.min(Math.abs(x - LX[0]), Math.abs(x - LX[1]));
    x += dl < 1.3 ? 0.07 : dl < 3.2 ? 0.2 : dl < 9 ? 0.55 : 0.85;
  }
  const NC = XS.length;
  const NV = NR * NC;
  const SIG = 0.2;                                     // ridge half-width (world units)
  const prof = [new Float32Array(NC), new Float32Array(NC)];
  const skirt = [new Float32Array(NC), new Float32Array(NC)];
  const band = new Float32Array(NC), rfi = new Float32Array(NC);
  for (let c = 0; c < NC; c++) {
    const x = XS[c];
    for (let l = 0; l < 2; l++) {
      const d = x - LX[l];
      prof[l][c] = Math.exp(-(d / SIG) * (d / SIG));
      skirt[l][c] = Math.exp(-(d / 1.3) * (d / 1.3));
    }
    const f = F_MID + x / KX;
    band[c] = 0.35 + 0.65 * smooth(150, 450, f) * (1 - smooth(1900, 2350, f));   // receiver passband
    rfi[c] = Math.exp(-Math.pow((f - 620) / 7, 2)) * 0.55 + Math.exp(-Math.pow((f - 1855) / 7, 2)) * 0.4 + Math.exp(-Math.pow((f - 2140) / 9, 2)) * 0.25;
  }
  // noise floor, fixed per data row (so history stays put as it scrolls)
  const NK = 1024;
  const NOISE = new Float32Array(NK * NC);
  {
    const rnd = U.mulberry32(1420);
    for (let k = 0; k < NK; k++) {
      for (let c = 0; c < NC; c++) {
        const x = XS[c];
        // sampled on a circle in the row direction so the table wraps seamlessly
        const a = k / NK * Math.PI * 2, R = NK * 0.21 / (Math.PI * 2);
        const smoothN = U.vnoise3(x * 0.55, Math.cos(a) * R + 40, Math.sin(a) * R + 40);
        const fine = rnd();
        NOISE[k * NC + c] = (0.55 * smoothN * smoothN + 0.45 * fine * fine * fine) * band[c];
      }
    }
  }

  const pos = new Float32Array(NV * 3);
  const glowA = new Float32Array(NV), litA = new Float32Array(NV), tauA = new Float32Array(NV);
  for (let r = 0; r < NR; r++) for (let c = 0; c < NC; c++) pos[(r * NC + c) * 3] = XS[c];
  // triangles are stored nearest row first, so early depth testing can reject
  // far terrain hidden behind near ridges
  const idx = new Uint32Array((NR - 1) * (NC - 1) * 6);
  const ROW_TRIS = (NC - 1) * 6;
  {
    let q = 0;
    for (let r = NR - 2; r >= 0; r--) {
      for (let c = 0; c < NC - 1; c++) {
        const a = r * NC + c, b = a + 1, d = a + NC, e = d + 1;
        idx[q++] = a; idx[q++] = d; idx[q++] = b;
        idx[q++] = b; idx[q++] = d; idx[q++] = e;
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(pos, 3);
  posAttr.setUsage(THREE.DynamicDrawUsage);
  const glowAttr = new THREE.BufferAttribute(glowA, 1);
  glowAttr.setUsage(THREE.DynamicDrawUsage);
  const litAttr = new THREE.BufferAttribute(litA, 1).setUsage(THREE.DynamicDrawUsage);
  const tauAttr = new THREE.BufferAttribute(tauA, 1).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', posAttr);
  geo.setAttribute('aG', glowAttr);
  geo.setAttribute('aL', litAttr);
  geo.setAttribute('aTau', tauAttr);
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.boundingSphere = new THREE.Sphere(new V3(0, 0, 0), 200);

  const PH = new THREE.Color(143 / 255, 247 / 255, 208 / 255).convertSRGBToLinear();   // phosphor
  const PHV = new V3(PH.r, PH.g, PH.b);
  const terrU = {
    uHeadZ: { value: Z_HEAD }, uCol: { value: PHV }, uFade: { value: 1 }, uLine: { value: 1 },
    uXMin: { value: X_MIN }, uXStep: { value: 100 * KX },
  };
  const GRID_GLSL = /* glsl */`
    // anti-aliased grid line; w = fwidth(v) (passed in so callers can share it)
    float gridLineW(float v, float w, float wpx) {
      return (1.0 - smoothstep(0.0, wpx * w, abs(fract(v + 0.5) - 0.5))) * (1.0 - smoothstep(0.25, 0.5, w));
    }
    float gridLine(float v, float wpx) { return gridLineW(v, fwidth(v), wpx); }`;
  const terrain = new THREE.Mesh(geo, new THREE.ShaderMaterial({
    uniforms: terrU,
    vertexShader: /* glsl */`
      uniform float uFade;
      attribute float aG, aL, aTau;
      varying vec3 vW; varying float vG, vL, vTau, vFade;
      void main() {
        vW = position; vG = aG; vL = aL; vTau = aTau;
        vFade = exp(-max(length(position - cameraPosition) - 22.0, 0.0) * 0.02) * uFade;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform float uLine, uXMin, uXStep;
      uniform vec3 uCol;
      varying vec3 vW; varying float vG, vL, vTau, vFade;
      ${GRID_GLSL}
      float gl1(float v, float w) { return clamp(1.0 - abs(fract(v + 0.5) - 0.5) / w, 0.0, 1.0) * clamp(2.0 - 4.0 * w, 0.0, 1.0); }
      void main() {
        float f100 = (vW.x - uXMin) / uXStep;
        float wx = fwidth(f100) * 1.3;
        float t4 = vTau * 4.0;
        float wt = fwidth(t4) * 1.3;
        float lines = (gl1(f100, wx) * 0.55 + gl1(f100 * 0.2, wx * 0.25)) * 0.10 + (gl1(t4, wt) * 0.6 + gl1(vTau, wt * 0.3)) * 0.07;
        float hN = clamp(vW.y * 0.22, 0.0, 1.0);
        float gh = vG * hN;
        vec3 col = uCol * ((0.006 + 0.10 * clamp(vW.y * 2.3 - 0.05, 0.0, 1.0)) * vL + lines * uLine + vG * (0.4 + 1.25 * hN) * (0.55 + 0.45 * vL))
                 + vec3(0.85, 1.0, 0.95) * (gh * gh * gh * 1.1);
        gl_FragColor = vec4(col * vFade, 1.0);
      }`,
  }));
  terrain.frustumCulled = false;

  // the unwritten future beyond the head: a flat, dim frequency grid
  const future = new THREE.Mesh(new THREE.PlaneGeometry(X_MAX - X_MIN, 180).rotateX(-Math.PI / 2).translate((X_MIN + X_MAX) / 2, 0, Z_HEAD - 90),
    new THREE.ShaderMaterial({
      uniforms: terrU,
      vertexShader: 'varying vec3 vW; void main(){ vW = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: /* glsl */`
        uniform vec3 uCol; uniform float uHeadZ, uFade, uXMin, uXStep;
        varying vec3 vW;
        ${GRID_GLSL}
        void main() {
          float f100 = (vW.x - uXMin) / uXStep;
          float lx = gridLine(f100 / 5.0, 1.4) * 0.8 + gridLine(f100, 1.0) * 0.3;
          float lz = gridLine(vW.z / 4.0, 1.2) * 0.35;
          float d = length(vW - cameraPosition);
          vec3 col = uCol * (0.003 + (lx + lz) * 0.035) * exp(-max(d - 30.0, 0.0) * 0.025) * uFade;
          col *= smoothstep(uHeadZ - 150.0, uHeadZ - 2.0, vW.z);
          gl_FragColor = vec4(col, 1.0);
        }`,
    }));
  future.frustumCulled = false;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0, 0, 0);
  scene.add(terrain, future);
  const camera = new THREE.PerspectiveCamera(46, W / H, 0.1, 600);
  const aa = makeAA(THREE, renderer, W, H, { dither: 0.0006, scan: 0.08 });

  // the write head: a bright bar across the terrain + a faint curtain above it
  const glowTex = U.makeGlowTexture(THREE, 128, 0.2);
  const headU = { uA: { value: 1 }, uCol: { value: PHV }, uAct: { value: new THREE.Vector2() }, uL0: { value: LX[0] }, uL1: { value: LX[1] } };
  const head = new THREE.Mesh(new THREE.PlaneGeometry(X_MAX - X_MIN, 9, 1, 1).translate((X_MIN + X_MAX) / 2, 4.5, 0), new THREE.ShaderMaterial({
    uniforms: headU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: /* glsl */`
      uniform float uA, uL0, uL1; uniform vec3 uCol; uniform vec2 uAct;
      varying vec3 vP;
      void main() {
        float y = vP.y;
        float edge = 1.0 - smoothstep(0.0, 1.0, abs(vP.x) / 41.0);
        float bar = exp(-y * y / 0.004) * 1.4 + exp(-y / 0.35) * 0.25;
        float curtain = exp(-y / 2.8) * 0.035 * (1.0 - smoothstep(5.0, 8.8, y));
        float l0 = exp(-pow((vP.x - uL0) / 0.9, 2.0)), l1 = exp(-pow((vP.x - uL1) / 0.9, 2.0));
        float act = (l0 * uAct.x + l1 * uAct.y);
        float a = (bar + curtain * (1.0 + 4.0 * act) + act * exp(-y / 1.6) * 0.25 * (1.0 - smoothstep(5.0, 8.8, y))) * edge * uA;
        gl_FragColor = vec4(mix(uCol, vec3(1.0), 0.25) * a, 1.0);
      }`,
  }));
  head.position.z = Z_HEAD;
  head.renderOrder = 2;
  scene.add(head);
  const flares = [0, 1].map(l => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: new THREE.Color(0.7, 1.0, 0.9), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    s.position.set(LX[l], 0.6, Z_HEAD + 0.2);
    s.renderOrder = 3;
    scene.add(s);
    return s;
  });

  // sparks thrown up by each onset, riding with the data
  const SPK_PER = 3, SPK_MAX = 1800, SPK_LIFE = 0.55;
  const spkPos = new Float32Array(SPK_MAX * 3), spkA = new Float32Array(SPK_MAX);
  const spkGeo = new THREE.BufferGeometry();
  spkGeo.setAttribute('position', new THREE.BufferAttribute(spkPos, 3).setUsage(THREE.DynamicDrawUsage));
  spkGeo.setAttribute('aA', new THREE.BufferAttribute(spkA, 1).setUsage(THREE.DynamicDrawUsage));
  const sparks = new THREE.Points(spkGeo, new THREE.ShaderMaterial({
    uniforms: { uCol: { value: PHV } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */`
      attribute float aA; varying float vA;
      void main() { vA = aA; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
        gl_PointSize = clamp(90.0 / -mv.z, 1.5, 6.0); }`,
    fragmentShader: /* glsl */`
      uniform vec3 uCol; varying float vA;
      void main() { vec2 p = gl_PointCoord - 0.5; float a = exp(-dot(p, p) * 14.0) * vA;
        gl_FragColor = vec4(mix(uCol, vec3(1.0), 0.4) * a * 1.6, 1.0); }`,
  }));
  sparks.frustumCulled = false;
  sparks.renderOrder = 4;
  scene.add(sparks);
  const hashf = (i, k) => { const s = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453; return s - Math.floor(s); };

  // ----------------------------------------------------------- per-frame data
  const RATE = t => (t < T_START || t > T_LAST + 0.002) ? 0 : PU.r0 * Math.exp(PU.k * (t - T_START));
  const G_LANE = [2.2, 5.0];          // lane 1 carries fewer pulses; both become walls
  const A_H = 4.2;                    // ridge height when fresh
  const DECAY = t => 1 - 0.72 * smooth(93.3, 95.2, t);

  let rowsUsed = NR;
  function writeTerrain(t, camZ) {
    const Pn = P(t);
    // rows behind the camera are never seen: skip them entirely
    rowsUsed = Math.max(2, Math.min(NR, Math.ceil((camZ + 3 - Z_HEAD) / DZ) + 3));
    geo.setDrawRange((NR - rowsUsed) * ROW_TRIS, (rowsUsed - 1) * ROW_TRIS);
    const tNow = Math.min(t, T_STOP);
    const kH = Math.floor(Pn / DZ);
    const dec = DECAY(t);
    const hScale = dec, gScale = 0.25 + 0.75 * dec;
    for (let r = 0; r < rowsUsed; r++) {
      let pc, pa, pb, k;
      if (r === 0) { pc = Pn; pa = Pn - DZ * 0.5; pb = Pn; k = kH + 1; }
      else { k = kH - (r - 1); pc = k * DZ; pa = pc - DZ * 0.5; pb = Math.min(pc + DZ * 0.5, Pn); }
      const z = Z_HEAD + (Pn - pc);
      const ta = Pinv(pa), tb = Math.min(Pinv(pb), tNow);
      const tc = 0.5 * (ta + tb);
      const age = t - tc;
      const fresh = Math.exp(-Math.max(age, 0) / 0.3);
      const hF = (0.66 + 0.34 * fresh) * hScale;
      const gF = (0.45 + 0.55 * fresh) * gScale;
      const v = [0, 0];
      let dens = 0;
      if (tb > T_START - 0.01 && ta < T_LAST + 0.1) {
        dens = smooth(80, 300, RATE(Math.min(tc, T_LAST)));
        for (let l = 0; l < 2; l++) {
          const L = lanes[l];
          const span = Math.max(tb - ta, 1e-6);
          const gain = 1 + (G_LANE[l] - 1) * dens;
          let val = Math.min(1, (onTime(L, tb) - onTime(L, ta)) / span * gain);
          if (countLE(L.S, L.n, tb) > countLE(L.S, L.n, ta)) val = Math.max(val, 0.9);   // an onset in this row
          v[l] = val;
        }
      }
      const noiseRow = ((k % NK) + NK) % NK * NC;
      const base = r * NC;
      tauA.fill(tc, base, base + NC);
      const nAmp = 0.38 * (0.8 + 0.2 * dec);
      for (let c = 0; c < NC; c++) {
        const i = base + c;
        const lane = v[0] * prof[0][c] + v[1] * prof[1][c];
        const sk = v[0] * skirt[0][c] + v[1] * skirt[1][c];
        pos[i * 3 + 1] = NOISE[noiseRow + c] * nAmp + rfi[c] * (0.6 + 0.4 * NOISE[noiseRow + c]) + (lane * A_H + sk * 0.35) * hF;
        pos[i * 3 + 2] = z;
        glowA[i] = (lane + sk * 0.06) * gF * (1 - 0.4 * dens) + rfi[c] * 0.12 + NOISE[noiseRow + c] * 0.05 * dec;
      }
    }
    // per-vertex relief lighting from the height field
    const LXn = -0.35, LYn = 1.0, LZn = 0.55, Ln = Math.hypot(LXn, LYn, LZn);
    for (let r = 0; r < rowsUsed; r++) {
      const r0 = Math.max(0, r - 1), r1 = Math.min(rowsUsed - 1, r + 1);
      const dz = pos[(r1 * NC) * 3 + 2] - pos[(r0 * NC) * 3 + 2] || DZ;
      for (let c = 0; c < NC; c++) {
        const c0 = c > 0 ? c - 1 : c, c1 = c < NC - 1 ? c + 1 : c;
        const gx = (pos[(r * NC + c1) * 3 + 1] - pos[(r * NC + c0) * 3 + 1]) / (XS[c1] - XS[c0]);
        const gz = (pos[(r1 * NC + c) * 3 + 1] - pos[(r0 * NC + c) * 3 + 1]) / dz;
        const d = (-gx * LXn + LYn - gz * LZn) / (Math.sqrt(gx * gx + 1 + gz * gz) * Ln);
        litA[r * NC + c] = 0.35 + 0.65 * (d > 0 ? d : 0);
      }
    }
    const nU = rowsUsed * NC;
    for (const [attr, k] of [[posAttr, 3], [glowAttr, 1], [litAttr, 1], [tauAttr, 1]]) {
      attr.clearUpdateRanges(); attr.addUpdateRange(0, nU * k); attr.needsUpdate = true;
    }
  }

  function writeSparks(t) {
    let n = 0;
    const tNow = Math.min(t, T_STOP + 0.4);
    const Pn = P(t);
    for (let i = pulseAt(tNow); i >= 0 && n < SPK_MAX - SPK_PER; i--) {
      const age = t - TIMES[i];
      if (age > SPK_LIFE) break;
      const lx = LX[BITS[i]];
      const dz = Pn - P(TIMES[i]);
      // fewer sparks per pulse once the stream is dense
      const keep = RATE(TIMES[i]) > 150 ? (hashf(i, 9) < 150 / RATE(TIMES[i]) * 1.5 ? 1 : 0) : 1;
      if (!keep) continue;
      for (let s = 0; s < SPK_PER; s++) {
        const vx = (hashf(i, s) - 0.5) * 3.0, vy = 3.5 + 5.0 * hashf(i, s + 3), vz = (hashf(i, s + 6) - 0.2) * 3.0;
        const a = Math.max(0, age);
        spkPos[n * 3] = lx + vx * a;
        spkPos[n * 3 + 1] = 1.0 + vy * a - 9.0 * a * a;
        spkPos[n * 3 + 2] = Z_HEAD + dz + vz * a;
        spkA[n] = (1 - a / SPK_LIFE) * (spkPos[n * 3 + 1] > 0 ? 1 : 0) * (t > T_STOP ? 1 - smooth(T_STOP, T_STOP + 0.3, t) : 1);
        n++;
      }
    }
    spkGeo.setDrawRange(0, n);
    spkGeo.attributes.position.needsUpdate = true;
    spkGeo.attributes.aA.needsUpdate = true;
  }

  // lane activity at the head: a flash on every onset, sustained while on
  function laneActivity(t) {
    const out = [0, 0];
    if (t > T_STOP) return out;
    const i0 = pulseAt(t);
    for (let i = i0; i >= 0; i--) {
      const age = t - TIMES[i];
      if (age > 0.35) break;
      const l = BITS[i];
      out[l] += Math.exp(-age / 0.06) * (age < DUR[i] ? 1.0 : 0.7);
    }
    return out.map(v => Math.min(1.6, v));
  }

  // ------------------------------------------------------------------ camera
  const camPos = new V3(), camTgt = new V3();
  function cameraAt(t) {
    const tc = Math.min(t, T_STOP) + 0.25 * (1 - Math.exp(-Math.max(0, t - T_STOP) / 0.25));   // stops dead, with a tiny settle
    const a = ease(prog(tc, 74, 83)), b = ease(prog(tc, 81.5, 88)), c = ease(prog(tc, 87.5, 91.5)), d = U.easeIn(prog(tc, 89.5, 93.0));
    // glide low between the lanes, climb and bank out to the left, swoop back
    // down into the canyon between the two walls, then push in at the head
    let x = lerp(-2.4, -2.6, a), y = lerp(1.9, 3.3, a), z = lerp(3, 1.5, a);
    x = lerp(x, -13.0, b); y = lerp(y, 9.5, b); z = lerp(z, 2, b);
    x = lerp(x, -0.6, c); y = lerp(y, 2.6, c); z = lerp(z, 0, c);
    z = lerp(z, -13, d); y = lerp(y, 2.1, d);
    camPos.set(x, y, z);
    camTgt.set(lerp(lerp(lerp(-3.2, -0.8, a), 3.5, b), 0.2, c), lerp(lerp(0.5, -2.2, b), 1.3, c), -30);
    // shake grows with the rate; nothing after the stop
    const sh = t < T_STOP ? 0.012 * smooth(80, 84, t) + 0.20 * Math.pow(smooth(86.5, 93.0, t), 2) : 0;
    if (sh > 0) {
      const f = 13;
      camPos.x += (U.vnoise3(t * f, 1.1, 0.3) - 0.5) * sh;
      camPos.y += (U.vnoise3(t * f, 5.3, 0.7) - 0.5) * sh;
      camTgt.x += (U.vnoise3(t * f, 8.2, 1.9) - 0.5) * sh * 3;
      camTgt.y += (U.vnoise3(t * f, 3.7, 4.4) - 0.5) * sh * 3;
    }
    // slow drift keeps it alive
    camTgt.x += (U.vnoise3(tc * 0.3, 2.0, 9.0) - 0.5) * 0.8;
    camTgt.y += (U.vnoise3(tc * 0.3, 7.0, 9.0) - 0.5) * 0.4;
    const roll = deg(lerp(lerp(0, -7, b), 0, c)) + (sh > 0 ? (U.vnoise3(t * 11, 0.0, 6.0) - 0.5) * sh * 0.1 : 0);
    return roll;
  }

  // ------------------------------------------------------------------ update
  const hudProj = { l0: new V3(), l1: new V3() };
  function update(t) {
    const roll = cameraAt(t);
    writeTerrain(t, camPos.z);
    writeSparks(t);
    const act = laneActivity(t);
    const dec = DECAY(t);
    headU.uAct.value.set(act[0], act[1]);
    const stopFlick = t > T_STOP ? (t < T_STOP + 0.35 ? (Math.floor((t - T_STOP) * 30) % 2 ? 0.25 : 0.9) : 0.12 * dec) : 1;
    headU.uA.value = (0.8 + 0.25 * Math.min(1, (act[0] + act[1]) * 0.5)) * stopFlick;
    for (let l = 0; l < 2; l++) {
      flares[l].material.opacity = Math.min(0.75, act[l] * 0.6);
      flares[l].scale.setScalar(1.0 + 1.4 * Math.min(1, act[l]));
    }
    terrU.uFade.value = 0.35 + 0.65 * dec;
    terrU.uLine.value = 1.0;

    camera.position.copy(camPos);
    camera.up.set(0, 1, 0);
    camera.lookAt(camTgt);
    camera.rotateZ(roll);
    camera.updateMatrixWorld(true);
    hudProj.l0.set(LX[0], A_H + 0.6, Z_HEAD).project(camera);
    hudProj.l1.set(LX[1], A_H + 0.6, Z_HEAD).project(camera);

    aa.uniforms.uLow.value.set(0.74, 0.55);
    aa.render(scene, camera, t);
  }

  // --------------------------------------------------------------------- HUD
  const PHS = a => `rgba(143,247,208,${a})`;
  const utcString = t => {
    const s = 3 * 3600 + 14 * 60 + 7 + (t - T_START);
    const hh = Math.floor(s / 3600), mm = Math.floor(s / 60) % 60, ss = s - Math.floor(s / 60) * 60;
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${ss.toFixed(2).padStart(5, '0')} UTC`;
  };
  function text(g, s, x, y, size, a, align = 'left', weight = 'bold', glow = 0) {
    g.font = `${weight} ${size}px ${FONT}`;
    g.textAlign = align;
    if (glow > 0) {
      g.lineJoin = 'round';
      g.strokeStyle = PHS(a * 0.10 * glow); g.lineWidth = size * 0.28; g.strokeText(s, x, y);
      g.strokeStyle = PHS(a * 0.16 * glow); g.lineWidth = size * 0.12; g.strokeText(s, x, y);
    }
    g.fillStyle = PHS(a);
    g.fillText(s, x, y);
  }
  const SCOPE = { x: 1452, y: 392, w: 388, h: 128 };
  function scopeTrace(t, g, alpha) {
    const { x, y, w, h } = SCOPE;
    g.strokeStyle = PHS(0.35 * alpha);
    g.lineWidth = 1;
    g.strokeRect(x + 0.5, y + 0.5, w, h);
    g.strokeStyle = PHS(0.09 * alpha);
    g.beginPath();
    for (let i = 1; i < 8; i++) { g.moveTo(x + i * w / 8 + 0.5, y); g.lineTo(x + i * w / 8 + 0.5, y + h); }
    for (let i = 1; i < 4; i++) { g.moveTo(x, y + i * h / 4 + 0.5); g.lineTo(x + w, y + i * h / 4 + 0.5); }
    g.stroke();
    // the last 24 ms of demodulated audio
    const win = 0.024, N = 300;
    const tv = t;
    const rnd = U.mulberry32(Math.floor(t * 24 + 0.5) * 7 + 3);
    const mid = y + h / 2;
    g.save();
    g.beginPath(); g.rect(x, y, w, h); g.clip();
    g.beginPath();
    for (let k = 0; k <= N; k++) {
      const tau = tv - win + (k / N) * win;
      let v = 0;
      const i = pulseAt(tau);
      if (i >= 0 && tau <= T_STOP) {
        const dt = tau - TIMES[i];
        if (dt < DUR[i]) {
          const env = Math.min(1, dt / 0.0004, (DUR[i] - dt) / 0.0004);
          v = env * Math.sin(2 * Math.PI * FREQ[BITS[i]] * tau);
        }
      }
      v = v * 0.78 + (rnd() - 0.5) * 0.10;
      const px = x + (k / N) * w, py = mid - v * h * 0.42;
      if (k === 0) g.moveTo(px, py); else g.lineTo(px, py);
    }
    g.lineJoin = 'round';
    g.strokeStyle = PHS(0.12 * alpha); g.lineWidth = 6; g.stroke();
    g.strokeStyle = PHS(0.3 * alpha); g.lineWidth = 2.8; g.stroke();
    g.strokeStyle = PHS(0.95 * alpha); g.lineWidth = 1.3; g.stroke();
    g.restore();
  }
  function bracket(g, x, y, w, h, s, a) {
    g.strokeStyle = PHS(a);
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(x, y + s); g.lineTo(x, y); g.lineTo(x + s, y);
    g.moveTo(x + w - s, y); g.lineTo(x + w, y); g.lineTo(x + w, y + s);
    g.moveTo(x + w, y + h - s); g.lineTo(x + w, y + h); g.lineTo(x + w - s, y + h);
    g.moveTo(x + s, y + h); g.lineTo(x, y + h); g.lineTo(x, y + h - s);
    g.stroke();
  }

  function overlay(t, g) {
    // power-on flicker
    const boot = t < 74.9 ? ((Math.floor((t - 74) * 26) % 3) === 1 ? 0.3 : 1) * smooth(74.0, 74.7, t) : 1;
    const A = boot;
    g.save();
    g.textBaseline = 'middle';

    // dark glass behind the header and the right-hand panel keeps the HUD legible
    const hg = g.createLinearGradient(0, 0, 0, 170);
    hg.addColorStop(0, `rgba(0,0,0,${0.75 * A})`); hg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = hg; g.fillRect(0, 0, W, 170);
    g.fillStyle = `rgba(0,6,4,${0.62 * A})`;
    g.fillRect(1430, 142, 430, 396);
    // header + clock
    text(g, 'RX-3 // L-BAND 1420.405 MHz // BW 2.0 kHz', 80, 66, 26, 0.9 * A, 'left', 'bold', 1);
    const FEED = 'FEED L1  //  AZ 141.2\u00b0  EL 36.4\u00b0  //  FFT 4096  //  ';
    text(g, FEED, 80, 100, 17, 0.5 * A, 'left', 'normal');
    g.font = `normal 17px ${FONT}`;
    const sx = 80 + g.measureText(FEED).width;
    const status = t < T_START ? 'SCANNING' : t <= T_STOP ? 'SIGNAL LOCK' : 'LOCK LOST';
    const sOn = t < T_START ? (Math.floor(t / 0.4) % 2 === 0 ? 0.75 : 0.3) : t <= T_STOP ? 0.95 : (Math.floor(t / 0.4) % 2 === 0 ? 0.95 : 0.4);
    text(g, status, sx, 100, 17, sOn * A, 'left', 'bold');
    text(g, utcString(t), 1840, 66, 28, 0.9 * A, 'right', 'bold', 1);
    g.strokeStyle = PHS(0.28 * A);
    g.lineWidth = 1;
    g.beginPath(); g.moveTo(80, 124.5); g.lineTo(1840, 124.5);
    for (let i = 0; i <= 44; i++) { const xx = 80 + i * 40 + 0.5; g.moveTo(xx, 124); g.lineTo(xx, i % 5 ? 129 : 134); }
    g.stroke();

    // REC
    const recOn = Math.floor(t / 0.5) % 2 === 0;
    g.fillStyle = `rgba(255,64,52,${(recOn ? 0.95 : 0.25) * A})`;
    g.beginPath(); g.arc(1700, 100, 7, 0, Math.PI * 2); g.fill();
    text(g, 'REC', 1716, 100, 18, 0.8 * A, 'left');

    // counter + rate
    const count = clamp(pulseAt(Math.min(t, T_STOP)) + 1, 0, NP);
    const done = t > T_STOP;
    const blink = !done || Math.floor((t - T_STOP) / 0.4) % 2 === 0;
    text(g, 'PULSES', 1452, 176, 18, 0.6 * A);
    bracket(g, 1440, 150, 412, 160, 14, 0.4 * A);
    if (blink) text(g, String(count).padStart(4, '0'), 1840, 244, 104, 0.97 * A, 'right', 'bold', 1);
    const r = RATE(t);
    text(g, 'RATE', 1452, 336, 20, 0.6 * A);
    text(g, (done ? '  0.0' : r.toFixed(1).padStart(5, ' ')) + ' /s', 1840, 336, 26, 0.9 * A, 'right');
    text(g, 'CH-2 DEMOD', 1452, 372, 16, 0.5 * A, 'left', 'normal');
    // current tone readout
    const ip = pulseAt(t);
    const on = ip >= 0 && t <= T_STOP && t - TIMES[ip] < DUR[ip];
    text(g, on ? `${FREQ[BITS[ip]].toFixed(0)} Hz` : (done ? 'NO CARRIER' : '—'), 1840, 372, 16, 0.75 * A, 'right', 'normal');
    scopeTrace(t, g, A);

    // lane labels hang over the lanes at the head
    const lab = [['1000 Hz', hudProj.l0, 'right'], ['1420 Hz', hudProj.l1, 'left']];
    for (let [s, p, al] of lab) {
      if (p.z > 1) continue;
      const px = (p.x * 0.5 + 0.5) * W, py = (-p.y * 0.5 + 0.5) * H;
      if (py > H * 0.76 || py < 150 || px < 40 || px > 1415) continue;
      // keep clear of the right-hand panel: hang the label to the left instead
      const flip = al === 'left' && px > 1250 && py - 42 < 560;
      const dx = al === 'left' && !flip ? 1 : -1;
      al = dx > 0 ? 'left' : 'right';
      g.strokeStyle = PHS(0.5 * A);
      g.lineWidth = 1;
      g.beginPath(); g.moveTo(px, py); g.lineTo(px + dx * 26, py - 26); g.lineTo(px + dx * 96, py - 26); g.stroke();
      g.fillStyle = PHS(0.9 * A);
      g.fillRect(px - 2, py - 2, 4, 4);
      text(g, s, px + dx * 32, py - 42, 20, 0.9 * A, al);
    }

    // end of transmission
    if (t > T_STOP + 0.25) {
      const a = smooth(T_STOP + 0.25, T_STOP + 0.5, t);
      const on2 = Math.floor((t - T_STOP - 0.25) / 0.5) % 2 === 0;
      const msg = 'END OF TRANSMISSION';
      const n = Math.min(msg.length, Math.floor((t - T_STOP - 0.25) / 0.035) + 1);
      g.font = `bold 64px ${FONT}`;
      const fw = g.measureText(msg).width;
      const x0 = W / 2 - fw / 2, y0 = H * 0.40;
      g.fillStyle = 'rgba(0,0,0,0.55)';
      g.fillRect(x0 - 40, y0 - 58, fw + 80, 116);
      bracket(g, x0 - 40, y0 - 58, fw + 80, 116, 18, 0.7 * a);
      text(g, msg.slice(0, n), x0, y0 - 6, 64, a, 'left', 'bold', 1.2);
      if (on2 || n < msg.length) {
        g.font = `bold 64px ${FONT}`;
        const w2 = g.measureText(msg.slice(0, n)).width;
        g.fillStyle = PHS(0.9 * a);
        g.fillRect(x0 + w2 + 6, y0 - 34, 30, 56);
      }
      text(g, `${NP} PULSES  //  ${(T_LAST - T_START).toFixed(2)} s  //  LOCK LOST ${utcString(T_STOP).slice(0, 8)}`, W / 2, y0 + 40, 18, 0.7 * smooth(T_STOP + 0.9, T_STOP + 1.2, t), 'center', 'normal');
    }
    g.restore();
  }

  return {
    scene: aa.scene, camera: aa.camera, update, overlay,
    bloom(t) {
      const b = smooth(84, 93, t) * (1 - smooth(93.1, 94.5, t));
      return { strength: 0.75 + 0.25 * b, radius: 0.5 + 0.1 * b, threshold: 0.36 + 0.12 * b };
    },
  };
}
