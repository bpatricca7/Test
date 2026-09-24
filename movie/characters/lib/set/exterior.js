// The ridge at night: sky (baked Milky Way + stars), terrain, distant ranges,
// the 25 m dish (from the animated cut's observatory scene), the hut built to
// the interior's dimensions (its window is the interior window), a mast with
// obstruction beacons. Returned as a Group so it can live in any scene.
//
// Sky, stars and ranges are drawn at a fixed depth near the far plane so they
// work with any camera far distance >= ~40 m.

import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export function buildExterior(env) {
  const { THREE, TL, U, renderer } = env;
  const V3 = THREE.Vector3;
  const { clamp, lerp, smooth } = U;
  const deg = d => d * Math.PI / 180;
  const PI = Math.PI;
  const B = TL.beats;

  const root = new THREE.Group();
  root.name = 'set.exterior';
  const HAZE = new THREE.Color(0.016, 0.023, 0.036);

  // =========================================================================
  // layout: the ridge runs along RIDGE (azimuth 45 deg, i.e. +x+z); the dish
  // sits on it at the origin, the hut 62 m down the ridge with its window
  // (interior +x) looking back at the dish.
  // =========================================================================
  const dirAzEl = (az, el) => new V3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
  const RIDGE_AZ = deg(45);
  const RIDGE = dirAzEl(RIDGE_AZ, 0);
  const HUT_DIST = 75;
  const HUT_POS = RIDGE.clone().multiplyScalar(-HUT_DIST);
  // window normal: the dish appears ~16 deg to the right (toward interior +z) of straight out
  const WIN_OFF = deg(16);

  // =========================================================================
  // sky frame (galactic -> world), slowly wheeling
  // =========================================================================
  const LAT = deg(38);
  const POLE = new V3(0, Math.sin(LAT), -Math.cos(LAT));
  const OMEGA = 0.0022;
  const T_REF = 60.0;
  const spinQ = t => new THREE.Quaternion().setFromAxisAngle(POLE, OMEGA * (t - T_REF));
  // galactic centre low behind the hut as seen from the dish (azimuth ~225), the band arching overhead
  const GC = dirAzEl(deg(228), deg(9));
  const band2 = dirAzEl(deg(190), deg(48));
  const GP = new V3().crossVectors(GC, band2).normalize();
  const GZ = new V3().crossVectors(GC, GP).normalize();
  const qB = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(GC, GP, GZ));
  const skyQ = t => spinQ(t).multiply(qB);

  // bake the Milky Way into a cube map (galactic frame)
  const mwRT = new THREE.WebGLCubeRenderTarget(1024, { type: THREE.UnsignedByteType, generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
  {
    const bakeScene = new THREE.Scene();
    const m = new THREE.Mesh(new THREE.SphereGeometry(10, 96, 48), new THREE.ShaderMaterial({
      side: THREE.BackSide, depthTest: false, depthWrite: false,
      vertexShader: 'varying vec3 vD; void main(){ vD = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: /* glsl */`
        varying vec3 vD;
        ${U.GLSL_NOISE}
        void main() {
          vec3 c = normalize(vD);
          float b = asin(clamp(c.y, -1.0, 1.0));
          float l = atan(c.z, c.x);
          float n1 = fbm(c * 3.2 + vec3(1.3, 0.2, 4.1));
          float n2 = fbm(c * 9.0 + vec3(7.3, 2.2, 0.4));
          float bw = b + (n1 - 0.5) * 0.16;
          float width = 0.12 + 0.05 * sin(l * 1.7 + 0.6) + 0.10 * exp(-l * l / 0.45);
          float band = exp(-bw * bw / (width * width));
          float bulge = exp(-l * l / 0.30) * exp(-b * b / 0.035);
          float halo = exp(-bw * bw / (width * width * 6.0)) * 0.22;
          float cl = band * (0.25 + 1.25 * smoothstep(0.32, 0.78, n1) + 0.55 * n2) + bulge * (1.5 + 0.8 * n2) + halo;
          float grain = vnoise(c * 70.0) * 0.6 + vnoise(c * 160.0) * 0.4;
          cl *= 0.55 + 0.9 * grain;
          float laneC = 0.012 + 0.035 * sin(l * 2.3 + 1.0);
          float lane = exp(-pow((b - laneC) / (0.030 + 0.03 * n2), 2.0));
          float dust = lane * smoothstep(0.30, 0.62, fbm(c * 6.5 + vec3(2.0, 5.0, 1.0)));
          dust += band * 0.75 * smoothstep(0.50, 0.74, fbm(c * 14.0 + vec3(9.0, 1.0, 3.0)));
          cl *= 1.0 - clamp(dust, 0.0, 0.93);
          vec3 warm = vec3(1.0, 0.80, 0.58), cool = vec3(0.60, 0.70, 1.0);
          vec3 col = mix(cool, warm, clamp(bulge * 1.6 + 0.35 * n2 - 0.1, 0.0, 1.0)) * cl;
          float hii = smoothstep(0.80, 0.93, vnoise(c * 24.0 + vec3(3.0))) * band;
          col += vec3(0.9, 0.25, 0.35) * hii * 0.8;
          vec3 q = floor(c * 900.0);
          float h = hash13(q);
          float thr = 0.9965 - 0.012 * band * (1.0 - clamp(dust, 0.0, 1.0));
          if (h > thr) col += vec3(0.9, 0.93, 1.0) * (0.6 + 5.0 * pow(hash13(q + 7.0), 5.0));
          gl_FragColor = vec4(sqrt(clamp(col / 8.0, 0.0, 1.0)), 1.0);
        }`,
    }));
    bakeScene.add(m);
    const cubeCam = new THREE.CubeCamera(0.1, 100, mwRT);
    cubeCam.update(renderer, bakeScene);
    m.geometry.dispose(); m.material.dispose();
  }
  // sky dome: unit sphere around the camera, depth pinned to the far plane
  const FAR_SKY = '0.999999', FAR_MTN = '0.99999';
  const skyU = { tMW: { value: mwRT.texture }, uW2G: { value: new THREE.Matrix3() }, uMW: { value: 0.055 }, uTown: { value: dirAzEl(deg(160), 0) }, uHaze: { value: new V3(HAZE.r, HAZE.g, HAZE.b) } };
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 64), new THREE.ShaderMaterial({
    uniforms: skyU, side: THREE.BackSide, depthWrite: false, fog: false,
    vertexShader: /* glsl */`
      uniform vec3 uTown, uHaze;
      varying vec3 vDir; varying vec3 vBase; varying float vAlt;
      void main() {
        vDir = position;
        vec3 d = normalize(position);
        float alt = d.y, h = max(alt, 0.0);
        vec3 zen = vec3(0.0016, 0.0026, 0.0068);
        vec3 col = mix(uHaze, zen, pow(smoothstep(0.0, 1.0, h), 0.42));
        col += vec3(0.004, 0.012, 0.009) * exp(-pow((alt - 0.07) / 0.07, 2.0));
        vec3 hd = normalize(vec3(d.x, 0.0, d.z) + 1e-5);
        float town = max(dot(hd, uTown), 0.0);
        col += vec3(0.040, 0.017, 0.006) * pow(town, 5.0) * exp(-h / 0.09);
        vBase = col; vAlt = alt;
        gl_Position = projectionMatrix * viewMatrix * vec4(cameraPosition + d * 1000.0, 1.0);
        gl_Position.z = gl_Position.w * ${FAR_SKY};
      }`,
    fragmentShader: /* glsl */`
      uniform samplerCube tMW; uniform mat3 uW2G; uniform float uMW;
      varying vec3 vDir; varying vec3 vBase; varying float vAlt;
      void main() {
        vec3 mw = textureCube(tMW, uW2G * vDir).rgb;
        gl_FragColor = vec4(vBase + mw * mw * (8.0 * uMW * smoothstep(-0.02, 0.30, vAlt)), 1.0);
      }`,
  }));
  sky.renderOrder = -10;
  sky.frustumCulled = false;
  root.add(sky);

  // stars
  const starGroup = new THREE.Group();
  starGroup.matrixAutoUpdate = false;
  root.add(starGroup);
  const starU = { uTime: { value: 0 }, uScale: { value: 1 } };
  {
    const rnd = U.mulberry32(1974);
    const N_ALL = 5200, N_BAND = 7000;
    const N = N_ALL + N_BAND;
    const pos = new Float32Array(N * 3), col = new Float32Array(N * 3), sz = new Float32Array(N), ph = new Float32Array(N);
    const tints = [[0.62, 0.74, 1.0], [0.8, 0.87, 1.0], [1.0, 1.0, 1.0], [1.0, 0.94, 0.82], [1.0, 0.82, 0.6], [1.0, 0.68, 0.48]];
    const tmp = new V3();
    let i = 0;
    const put = (v, bright, size, tint) => {
      pos[i * 3] = v.x; pos[i * 3 + 1] = v.y; pos[i * 3 + 2] = v.z;
      col[i * 3] = tint[0] * bright; col[i * 3 + 1] = tint[1] * bright; col[i * 3 + 2] = tint[2] * bright;
      sz[i] = size; ph[i] = rnd(); i++;
    };
    for (let k = 0; k < N_ALL; k++) {
      const u = rnd() * 2 - 1, a = rnd() * PI * 2, s = Math.sqrt(1 - u * u);
      tmp.set(s * Math.cos(a), u, s * Math.sin(a));
      const m = Math.pow(rnd(), 7);
      put(tmp, 0.07 + 3.4 * m, 2.2 + 3.6 * Math.pow(m, 0.6), tints[Math.floor(rnd() * tints.length)]);
    }
    for (let k = 0; k < N_BAND; k++) {
      const l = rnd() * PI * 2 - PI;
      const w = 0.10 + 0.08 * Math.exp(-l * l / 0.5);
      const b = U.gauss(rnd) * w * 0.8;
      tmp.set(Math.cos(b) * Math.cos(l), Math.sin(b), Math.cos(b) * Math.sin(l));
      const m = Math.pow(rnd(), 10);
      put(tmp, 0.06 + 1.4 * m, 2.0 + 1.8 * Math.pow(m, 0.5), tints[1 + Math.floor(rnd() * 4)]);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(sz, 1));
    g.setAttribute('aPhase', new THREE.BufferAttribute(ph, 1));
    const pts = new THREE.Points(g, new THREE.ShaderMaterial({
      uniforms: starU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
      vertexShader: /* glsl */`
        attribute vec3 aColor; attribute float aSize; attribute float aPhase;
        uniform float uTime, uScale;
        varying vec3 vCol;
        void main() {
          vec3 wd = normalize(mat3(modelMatrix) * position);
          float ext = smoothstep(-0.01, 0.28, wd.y);
          float tw = 1.0 + (0.12 + 0.45 * (1.0 - ext)) * sin(uTime * (2.0 + aPhase * 5.0) + aPhase * 60.0);
          vCol = aColor * ext * tw;
          gl_Position = projectionMatrix * viewMatrix * vec4(cameraPosition + wd * 1000.0, 1.0);
          gl_Position.z = gl_Position.w * ${FAR_SKY};
          gl_PointSize = aSize * uScale;
        }`,
      fragmentShader: /* glsl */`
        varying vec3 vCol;
        void main() { vec2 p = gl_PointCoord - 0.5; gl_FragColor = vec4(vCol * exp(-dot(p, p) * 18.0), 1.0); }`,
    }));
    pts.frustumCulled = false;
    pts.renderOrder = 1;
    starGroup.add(pts);
  }

  // =========================================================================
  // terrain: the ridge, running along RIDGE
  // =========================================================================
  const ca = Math.cos(RIDGE_AZ), sa = Math.sin(RIDGE_AZ);
  function groundH(x, z) {
    // ridge-aligned coordinates: u along the ridge, v across it
    const u = x * sa + z * ca, v = x * ca - z * sa;
    const r = Math.hypot(x, z);
    const ra = Math.hypot(u / 2.6, v * 1.1);
    const d = Math.max(0, ra - 44);
    let h = -0.0042 * d * d - 0.06 * d;
    h = Math.max(h, -480 + 60 * U.fbm3(x * 0.002, 3.0, z * 0.002, 3));
    h += (U.fbm3(x * 0.006, 0.5, z * 0.006, 5) - 0.5) * 80 * smooth(30, 260, r);
    h += (U.fbm3(x * 0.06, 2.5, z * 0.06, 4) - 0.5) * 1.6 * smooth(16, 34, r);
    h += (U.fbm3(x * 0.3, 7.5, z * 0.3, 2) - 0.5) * 0.25 * smooth(12, 20, r);
    // the hut's pad and the track between hut and dish are levelled
    const hr = Math.hypot(x - HUT_POS.x, z - HUT_POS.z);
    // the hut sits on a shoulder of the ridge a few metres above the dish
    const padH = 2.0;
    h += 2.0 * smooth(18, HUT_DIST - 6, -u) * (1 - smooth(6, 14, hr));
    h = lerp(h, padH, 1 - smooth(6, 14, hr));
    return h;
  }
  const HUT_Y = groundH(HUT_POS.x, HUT_POS.z) + 0.3;          // hut floor, on a low plinth
  {
    const NR = 150, NS = 256, RMAX = 1150;
    const pos = [], colr = [], idx = [];
    const cGrass = new THREE.Color(0.06, 0.066, 0.045), cRock = new THREE.Color(0.09, 0.09, 0.092), cPad = new THREE.Color(0.14, 0.14, 0.13);
    const c = new THREE.Color();
    // rings centred between dish and hut so both have fine detail
    const CEN = HUT_POS.clone().multiplyScalar(0.5);
    pos.push(CEN.x, groundH(CEN.x, CEN.z), CEN.z); colr.push(cGrass.r, cGrass.g, cGrass.b);
    for (let j = 1; j <= NR; j++) {
      const r = RMAX * Math.pow(j / NR, 2.1);
      for (let k = 0; k < NS; k++) {
        const a = k / NS * PI * 2;
        const x = CEN.x + Math.cos(a) * r, z = CEN.z + Math.sin(a) * r;
        pos.push(x, groundH(x, z), z);
        const n = U.fbm3(x * 0.05, 1.1, z * 0.05, 3);
        c.copy(cGrass).lerp(cRock, clamp(n * 1.6 - 0.4));
        c.lerp(cPad, 1 - smooth(11, 15, Math.hypot(x, z)));
        c.lerp(cPad, 0.6 * (1 - smooth(5, 8, Math.hypot(x - HUT_POS.x, z - HUT_POS.z))));
        colr.push(c.r, c.g, c.b);
      }
    }
    for (let k = 0; k < NS; k++) idx.push(0, 1 + k, 1 + (k + 1) % NS);
    for (let j = 1; j < NR; j++) for (let k = 0; k < NS; k++) {
      const a = 1 + (j - 1) * NS + k, b = 1 + (j - 1) * NS + (k + 1) % NS;
      idx.push(a, a + NS, b, b, a + NS, b + NS);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(colr, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const ground = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true }));
    ground.receiveShadow = false;
    root.add(ground);
  }
  {
    const rnd = U.mulberry32(77);
    const base = new THREE.IcosahedronGeometry(1, 1);
    const p = base.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const v = new V3().fromBufferAttribute(p, i);
      v.multiplyScalar(0.75 + 0.5 * U.fbm3(v.x * 1.7 + 3, v.y * 1.7, v.z * 1.7, 3));
      p.setXYZ(i, v.x, v.y * 0.6, v.z);
    }
    base.computeVertexNormals();
    const N = 140;
    const rocks = new THREE.InstancedMesh(base, new THREE.MeshLambertMaterial({ color: 0x2c2c2e, flatShading: true }), N);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new V3();
    for (let i = 0; i < N; i++) {
      const a = rnd() * PI * 2, r = 20 + 180 * Math.pow(rnd(), 1.6);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (Math.hypot(x - HUT_POS.x, z - HUT_POS.z) < 12) { m.makeScale(0, 0, 0); rocks.setMatrixAt(i, m); continue; }
      const sc = (0.3 + 1.4 * Math.pow(rnd(), 3)) * (1 + r / 120);
      q.setFromEuler(new THREE.Euler(rnd() * 0.4, rnd() * 6.3, rnd() * 0.4));
      s.set(sc * (0.8 + rnd() * 0.6), sc, sc * (0.8 + rnd() * 0.6));
      m.compose(new V3(x, groundH(x, z) - sc * 0.15, z), q, s);
      rocks.setMatrixAt(i, m);
    }
    root.add(rocks);
  }

  // distant ranges (drawn near the far plane, far layers first)
  const mountainMat = (colTop, y0, y1, li) => new THREE.ShaderMaterial({
    uniforms: { uCol: { value: colTop }, uMist: { value: new V3(HAZE.r, HAZE.g, HAZE.b) }, uY0: { value: y0 }, uY1: { value: y1 } },
    fog: false, side: THREE.DoubleSide,
    vertexShader: /* glsl */`
      attribute float aN; varying float vY; varying float vN;
      void main() {
        vY = position.y; vN = aN;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uCol, uMist; uniform float uY0, uY1;
      varying float vY; varying float vN;
      void main() {
        float m = 1.0 - smoothstep(uY0, uY1, vY + vN * (uY1 - uY0) * 0.5);
        gl_FragColor = vec4(mix(uCol, uMist, m * m), 1.0);
      }`,
  });
  const LAYERS = [
    { r: 1100, base: -300, amp: 260, seed: 1, col: [0.0045, 0.0055, 0.0075], mist: [-380, -60] },
    { r: 1900, base: -180, amp: 380, seed: 2, col: [0.0065, 0.0085, 0.012], mist: [-240, 120] },
    { r: 3200, base: -60, amp: 620, seed: 3, col: [0.009, 0.012, 0.018], mist: [-100, 360] },
    { r: 5400, base: 60, amp: 1100, seed: 4, col: [0.012, 0.016, 0.025], mist: [0, 800] },
    { r: 9000, base: 200, amp: 1700, seed: 5, col: [0.014, 0.020, 0.031], mist: [100, 1500] },
  ];
  // real geometry, compressed to 1.25 - 3.5 km (angles seen from the ridge are kept)
  const RADII = [1250, 1700, 2250, 2850, 3500];
  LAYERS.forEach((L, li) => {
    const R = RADII[li], S = R / L.r;
    const N = 900, pos = [], an = [], idx = [];
    for (let i = 0; i <= N; i++) {
      const a = i / N * PI * 2;
      const cx = Math.cos(a), cz = Math.sin(a);
      let hh = 0, amp = 1, f = 2.2, norm = 0;
      for (let o = 0; o < 6; o++) {
        const n = U.vnoise3(cx * f + L.seed * 7.1, cz * f + L.seed * 3.3, L.seed * 1.9 + o * 5.0);
        const rdg = 1 - Math.abs(2 * n - 1);
        hh += amp * rdg * rdg; norm += amp;
        amp *= 0.5; f *= 2.05;
      }
      hh /= norm;
      const top = (L.base + L.amp * Math.pow(hh, 1.5)) * S;
      const nn = U.vnoise3(cx * 9 + L.seed, cz * 9, 2.0) - 0.5;
      pos.push(cx * R, top, cz * R, cx * R, -900 * S, cz * R);
      an.push(nn, nn);
    }
    for (let i = 0; i < N; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 2, a + 1, a + 3); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aN', new THREE.Float32BufferAttribute(an, 1));
    g.setIndex(idx);
    const mesh = new THREE.Mesh(g, mountainMat(new V3(...L.col), L.mist[0] * S, L.mist[1] * S, li));
    mesh.frustumCulled = false;
    mesh.renderOrder = -5 + li;       // near first so far ones fail the depth test
    root.add(mesh);
  });

  // =========================================================================
  // lights: night sky fill, moonlight (matches the light through the hut window), rim
  // =========================================================================
  const hemi = new THREE.HemisphereLight(0x4a5f8f, 0x1a1d24, 0.8);
  root.add(hemi);
  const MOON_DIR = new V3();       // set once the hut transform is known (below)
  const moon = new THREE.DirectionalLight(0x8fa4d8, 0.45);
  root.add(moon, moon.target);
  const rim = new THREE.DirectionalLight(0x9db2ff, 0.4);
  rim.position.set(-80, 120, -80);
  root.add(rim);

  // =========================================================================
  // struts
  // =========================================================================
  const UP = new V3(0, 1, 0);
  function strut(a, b, r, seg = 6) {
    const len = a.distanceTo(b);
    const g = new THREE.CylinderGeometry(r, r, len, seg, 1, true);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, b.clone().sub(a).normalize()));
    const mid = a.clone().add(b).multiplyScalar(0.5);
    g.translate(mid.x, mid.y, mid.z);
    return g;
  }
  const box = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y, z).toNonIndexed();
  const merge = parts => mergeGeometries(parts.map(g => (g.index ? g.toNonIndexed() : g)));

  // =========================================================================
  // the telescope
  // =========================================================================
  const F = 10.0, RD = 12.5, AXIS_Y = 15.5, VERTEX_OFF = 3.4;
  const paintMat = new THREE.MeshStandardMaterial({ color: 0xc9ccd2, roughness: 0.55, metalness: 0.25 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x3b3e44, roughness: 0.7, metalness: 0.4 });
  // weathered concrete: formwork pour lines, rain streaks, bolt holes
  const concreteTex = (() => {
    const c = document.createElement('canvas'); c.width = 512; c.height = 512;
    const x = c.getContext('2d', { willReadFrequently: true });
    const rnd = U.mulberry32(404);
    x.fillStyle = '#8a8b8c'; x.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 9000; i++) { const v = 110 + rnd() * 60; x.fillStyle = `rgba(${v},${v},${v * 1.02},0.35)`; x.fillRect(rnd() * 512, rnd() * 512, 1 + rnd() * 3, 1 + rnd() * 3); }
    for (let y = 0; y < 512; y += 64) { x.fillStyle = 'rgba(40,40,40,0.35)'; x.fillRect(0, y, 512, 2); x.fillStyle = 'rgba(255,255,255,0.08)'; x.fillRect(0, y + 2, 512, 1); }
    for (let k = 0; k < 40; k++) { const px = rnd() * 512, py = rnd() * 512, l = 40 + rnd() * 200; const gr = x.createLinearGradient(0, py, 0, py + l); gr.addColorStop(0, 'rgba(50,45,40,0.25)'); gr.addColorStop(1, 'rgba(50,45,40,0)'); x.fillStyle = gr; x.fillRect(px, py, 3 + rnd() * 10, l); }
    for (let y = 32; y < 512; y += 64) for (let px = 16; px < 512; px += 64) { x.fillStyle = 'rgba(30,30,30,0.6)'; x.beginPath(); x.arc(px + (y % 128 ? 32 : 0), y, 3, 0, 7); x.fill(); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(6, 2);
    return t;
  })();
  const concreteMat = new THREE.MeshLambertMaterial({ color: 0x9a9b9d, map: concreteTex });
  const trussMat = new THREE.MeshStandardMaterial({ color: 0xa8acb3, roughness: 0.6, metalness: 0.35 });
  const glowTex = U.makeGlowTexture(THREE, 128, 0.18);
  const additive = (color, extra = {}) => new THREE.SpriteMaterial(Object.assign({ map: glowTex, color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }, extra));

  const DISH_BASE = new V3(0, groundH(0, 0), 0);
  const dishRoot = new THREE.Group();
  dishRoot.position.copy(DISH_BASE);
  root.add(dishRoot);
  const doorDir = Math.atan2(HUT_POS.x, HUT_POS.z);
  dishRoot.add(new THREE.Mesh(merge([
    new THREE.CylinderGeometry(2.5, 3.3, 10.6, 40).translate(0, 5.3, 0),
    new THREE.CylinderGeometry(4.6, 4.8, 0.5, 40).translate(0, 0.2, 0),
  ]), concreteMat));
  {
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.2, 2.2, 0.3), darkMat);
    door.position.set(Math.sin(doorDir) * 3.12, 1.55, Math.cos(doorDir) * 3.12);
    door.rotation.y = doorDir;
    dishRoot.add(door);
  }
  {
    const a = doorDir + 1.9, parts = [];
    for (const s of [-0.25, 0.25]) {
      const p0 = new V3(Math.sin(a) * 3.35 + Math.cos(a) * s, 0.4, Math.cos(a) * 3.35 - Math.sin(a) * s);
      const p1 = new V3(Math.sin(a) * 2.6 + Math.cos(a) * s, 10.6, Math.cos(a) * 2.6 - Math.sin(a) * s);
      parts.push(strut(p0, p1, 0.035, 5));
    }
    for (let k = 0; k < 30; k++) {
      const f = k / 29, rr = lerp(3.35, 2.6, f), y = lerp(0.4, 10.6, f);
      parts.push(strut(new V3(Math.sin(a) * rr + Math.cos(a) * -0.25, y, Math.cos(a) * rr - Math.sin(a) * -0.25), new V3(Math.sin(a) * rr + Math.cos(a) * 0.25, y, Math.cos(a) * rr - Math.sin(a) * 0.25), 0.02, 4));
    }
    for (let k = 0; k < 12; k++) {
      const f = (k + 3) / 32, rr = lerp(3.35, 2.6, f) + 0.45, y = lerp(0.4, 10.6, f);
      parts.push(new THREE.TorusGeometry(0.4, 0.02, 4, 12, Math.PI).rotateX(PI / 2).rotateY(a + PI / 2).translate(Math.sin(a) * (rr - 0.4), y + 1.2, Math.cos(a) * (rr - 0.4)));
    }
    // conduits and a junction box on the pedestal
    parts.push(box(0.6, 0.8, 0.25, Math.sin(doorDir - 0.7) * 3.2, 1.8, Math.cos(doorDir - 0.7) * 3.2));
    dishRoot.add(new THREE.Mesh(merge(parts), darkMat));
  }
  const lampPos = new V3(Math.sin(doorDir) * 3.3, 3.1, Math.cos(doorDir) * 3.3);
  const lampSprite = new THREE.Sprite(additive(new THREE.Color(1.0, 0.55, 0.2).multiplyScalar(0.5)));
  lampSprite.position.copy(lampPos);
  lampSprite.scale.setScalar(1.0);
  dishRoot.add(lampSprite);
  const pedLamp = new THREE.PointLight(0xff9a48, 14, 30, 2);
  pedLamp.position.copy(lampPos).add(new V3(Math.sin(doorDir) * 0.6, 0, Math.cos(doorDir) * 0.6));
  dishRoot.add(pedLamp);

  const azG = new THREE.Group();
  dishRoot.add(azG);
  {
    const parts = [new THREE.CylinderGeometry(3.3, 3.3, 1.4, 40).translate(0, 11.3, 0)];
    for (const sx of [-1, 1]) {
      parts.push(box(1.0, 4.4, 2.8, sx * 4.4, 13.9, 0));
      parts.push(new THREE.CylinderGeometry(0.95, 0.95, 1.3, 20).rotateZ(PI / 2).translate(sx * 4.4, AXIS_Y, 0));
    }
    parts.push(box(2.2, 1.6, 1.8, 0, 12.8, -2.0));
    azG.add(new THREE.Mesh(merge(parts), paintMat));
    const rail = [];
    for (let k = 0; k < 20; k++) {
      const a = k / 20 * PI * 2, a2 = (k + 1) / 20 * PI * 2;
      rail.push(strut(new V3(Math.cos(a) * 3.15, 12.0, Math.sin(a) * 3.15), new V3(Math.cos(a) * 3.15, 13.05, Math.sin(a) * 3.15), 0.04, 4));
      rail.push(strut(new V3(Math.cos(a) * 3.15, 13.05, Math.sin(a) * 3.15), new V3(Math.cos(a2) * 3.15, 13.05, Math.sin(a2) * 3.15), 0.04, 4));
    }
    azG.add(new THREE.Mesh(merge(rail), darkMat));
  }
  const elG = new THREE.Group();
  elG.position.y = AXIS_Y;
  azG.add(elG);
  const dishG = new THREE.Group();
  dishG.position.y = VERTEX_OFF;
  elG.add(dishG);
  {
    const prof = [];
    for (let i = 0; i <= 40; i++) { const r = 1.1 + (RD - 1.1) * i / 40; prof.push(new THREE.Vector2(r, r * r / (4 * F))); }
    const geo = new THREE.LatheGeometry(prof, 160);
    const c = document.createElement('canvas');
    c.width = 2048; c.height = 512;
    const x = c.getContext('2d');
    const rnd = U.mulberry32(9);
    for (let gi = 0; gi < 48; gi++) for (let ri = 0; ri < 6; ri++) {
      const v = 196 + Math.floor(rnd() * 38);
      x.fillStyle = `rgb(${v},${v},${v + 3})`;
      x.fillRect(gi * 2048 / 48, ri * 512 / 6, 2048 / 48 + 1, 512 / 6 + 1);
    }
    x.strokeStyle = 'rgba(40,42,48,0.9)'; x.lineWidth = 2;
    for (let gi = 0; gi <= 48; gi++) { x.beginPath(); x.moveTo(gi * 2048 / 48, 0); x.lineTo(gi * 2048 / 48, 512); x.stroke(); }
    for (let ri = 0; ri <= 6; ri++) { x.beginPath(); x.moveTo(0, ri * 512 / 6); x.lineTo(2048, ri * 512 / 6); x.stroke(); }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 2;
    dishG.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xd5d8de, map: tex, roughness: 0.5, metalness: 0.3, side: THREE.DoubleSide })));
    dishG.add(new THREE.Mesh(new THREE.TorusGeometry(RD, 0.16, 8, 160).rotateX(PI / 2).translate(0, RD * RD / (4 * F), 0), paintMat));
  }
  {
    const parts = [];
    const NRIB = 24;
    const yS = r => r * r / (4 * F) - 0.12;
    const yB = r => lerp(-2.3, RD * RD / (4 * F) - 0.45, (r - 1.8) / (RD - 0.2 - 1.8));
    const pt = (a, r, y) => new V3(Math.cos(a) * r, y, Math.sin(a) * r);
    for (let k = 0; k < NRIB; k++) {
      const a = (k + 0.5) / NRIB * PI * 2;
      const NS = 7;
      let prevT = null, prevB = null;
      for (let s = 0; s <= NS; s++) {
        const r = 1.8 + (RD - 0.2 - 1.8) * s / NS;
        const T = pt(a, r, yS(r)), Bt = pt(a, r, yB(r));
        if (prevT) {
          parts.push(strut(prevT, T, 0.08, 4));
          parts.push(strut(prevB, Bt, 0.1, 4));
          parts.push(strut(s % 2 ? prevT : prevB, s % 2 ? Bt : T, 0.06, 4));
        }
        parts.push(strut(T, Bt, 0.06, 4));
        prevT = T; prevB = Bt;
      }
    }
    for (const r of [4.6, 8.2, 11.4]) for (let k = 0; k < NRIB; k++) {
      const a = (k + 0.5) / NRIB * PI * 2, a2 = (k + 1.5) / NRIB * PI * 2;
      parts.push(strut(pt(a, r, yB(r)), pt(a2, r, yB(r)), 0.08, 4));
    }
    dishG.add(new THREE.Mesh(mergeGeometries(parts), trussMat));
    dishG.add(new THREE.Mesh(new THREE.CylinderGeometry(2.0, 2.3, 2.6, 28).translate(0, -1.3, 0), paintMat));
  }
  elG.add(new THREE.Mesh(merge([
    new THREE.CylinderGeometry(0.5, 0.5, 8.0, 16).rotateZ(PI / 2),
    box(6.0, 1.4, 2.4, 0, 0.9, 0), box(0.6, 3.2, 0.6, -1.8, -1.2, 0), box(0.6, 3.2, 0.6, 1.8, -1.2, 0),
    box(4.8, 2.2, 2.6, 0, -3.1, 0),
  ]), paintMat));
  {
    const parts = [], legs = [];
    for (let k = 0; k < 4; k++) {
      const a = PI / 4 + k * PI / 2, rr = RD - 0.35;
      const bot = new V3(Math.cos(a) * rr, rr * rr / (4 * F), Math.sin(a) * rr);
      const top = new V3(Math.cos(a) * 0.75, F + 0.25, Math.sin(a) * 0.75);
      parts.push(strut(bot, top, 0.18, 8));
      legs.push({ bot, top });
    }
    for (let k = 0; k < 4; k++) { const L1 = legs[k], L2 = legs[(k + 1) % 4]; parts.push(strut(L1.bot.clone().lerp(L1.top, 0.55), L2.bot.clone().lerp(L2.top, 0.55), 0.08, 5)); }
    dishG.add(new THREE.Mesh(mergeGeometries(parts), paintMat));
    dishG.add(new THREE.Mesh(merge([
      new THREE.CylinderGeometry(0.95, 0.95, 1.9, 20).translate(0, F + 1.05, 0),
      new THREE.CylinderGeometry(1.15, 1.15, 0.2, 20).translate(0, F + 2.05, 0),
    ]), paintMat));
    dishG.add(new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.72, 0.8, 20, 1, true).translate(0, F - 0.3, 0), new THREE.MeshStandardMaterial({ color: 0x9aa0a8, roughness: 0.4, metalness: 0.6, side: THREE.DoubleSide })));
  }
  const led = new THREE.Sprite(additive(new THREE.Color(0.2, 1.0, 0.3)));
  led.position.set(0.0, F + 2.3, 0);
  led.scale.setScalar(0.6);
  dishG.add(led);
  const dishBeacon = new THREE.Sprite(additive(new THREE.Color(1.0, 0.1, 0.05).multiplyScalar(2.4)));
  dishBeacon.position.set(0, F + 2.45, 0);
  dishBeacon.scale.setScalar(1.6);
  dishBeacon.renderOrder = 6;
  dishG.add(dishBeacon);

  // =========================================================================
  // the hut: the interior's room (5 x 4 x 2.6 m) with 0.16 m walls, window on
  // local +x at (2.5, 1.4, 0.3), door on local +z at x 1.5
  // =========================================================================
  const hutG = new THREE.Group();
  root.add(hutG);
  // orientation: local +x (window normal) points at the dish, turned by WIN_OFF so the
  // dish sits to the right of straight-out (toward local +z)
  const toDish = new V3().subVectors(new V3(0, 0, 0), HUT_POS).setY(0).normalize();
  const azToDish = Math.atan2(toDish.x, toDish.z);
  // local +x maps to azimuth (yaw + 90deg); we want it at azToDish - WIN_OFF
  const HUT_YAW = azToDish - WIN_OFF - PI / 2;
  hutG.position.set(HUT_POS.x, HUT_Y, HUT_POS.z);
  hutG.rotation.y = HUT_YAW;
  const hutExterior = new THREE.Group();       // hidden when rendering the view through the window
  hutG.add(hutExterior);
  let winMat, winGlowS, winLight, porchLight, porchSprite;
  {
    // corrugated cladding
    const c = document.createElement('canvas'); c.width = 256; c.height = 64;
    const x = c.getContext('2d');
    for (let i = 0; i < 256; i++) { const v = 118 + 60 * (0.5 + 0.5 * Math.sin(i / 256 * PI * 2 * 16)); x.fillStyle = `rgb(${v},${v + 4},${v + 2})`; x.fillRect(i, 0, 1, 64); }
    const rnd = U.mulberry32(5);
    for (let i = 0; i < 80; i++) { x.fillStyle = `rgba(90,60,40,${rnd() * 0.15})`; x.fillRect(rnd() * 256, rnd() * 64, 2 + rnd() * 10, 1 + rnd() * 30); }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace; tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    const clad = new THREE.MeshLambertMaterial({ color: 0x8c978f, map: tex });
    const T = 0.16, X = 2.5 + T, Z = 2.0 + T, H0 = -0.3, H1 = 3.0;
    const wallH = H1 - H0, cy = (H0 + H1) / 2;
    const wall = (w, h, px, py, pz, ry, rep) => {
      const g = new THREE.PlaneGeometry(w, h);
      const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * rep, uv.getY(i));
      const m = new THREE.Mesh(g, clad); m.position.set(px, py, pz); m.rotation.y = ry; hutExterior.add(m);
    };
    // +x wall with the window hole (z -0.25..0.85, y 0.95..1.85)
    const zw0 = -0.25, zw1 = 0.85, yw0 = 0.95, yw1 = 1.85;
    wall(zw0 + Z, wallH, X, cy, (-Z + zw0) / 2, PI / 2, 4);
    wall(Z - zw1, wallH, X, cy, (zw1 + Z) / 2, PI / 2, 3);
    wall(zw1 - zw0, yw0 - H0, X, (H0 + yw0) / 2, (zw0 + zw1) / 2, PI / 2, 1.5);
    wall(zw1 - zw0, H1 - yw1, X, (yw1 + H1) / 2, (zw0 + zw1) / 2, PI / 2, 1.5);
    wall(2 * Z, wallH, -X, cy, 0, -PI / 2, 10);
    wall(2 * X, wallH, 0, cy, -Z, PI, 12);
    // +z wall with the door hole (x 1.075..1.925, y 0..2.05)
    const dx0 = 1.075, dx1 = 1.925, dy1 = 2.05;
    wall(dx0 + X, wallH, (-X + dx0) / 2, cy, Z, 0, 8);
    wall(X - dx1, wallH, (dx1 + X) / 2, cy, Z, 0, 2);
    wall(dx1 - dx0, H1 - dy1, (dx0 + dx1) / 2, (dy1 + H1) / 2, Z, 0, 2);
    wall(dx1 - dx0, 0.3, (dx0 + dx1) / 2, -0.15, Z, 0, 2);
    // plinth, roof (mono-pitch, falls toward -z), fascia
    hutExterior.add(new THREE.Mesh(new THREE.BoxGeometry(2 * X + 0.3, 0.4, 2 * Z + 0.3).translate(0, -0.45, 0), concreteMat));
    const roof = new THREE.Mesh(new THREE.BoxGeometry(2 * X + 0.6, 0.18, 2 * Z + 0.7), darkMat);
    roof.position.set(0, H1 + 0.15, 0); roof.rotation.x = deg(4);
    hutExterior.add(roof);
    // window: reveal, sill, frame (matches the interior frame)
    const ref = new THREE.MeshStandardMaterial({ color: 0xdedbd2, roughness: 0.5 });
    const frame = merge([
      box(0.06, 0.05, zw1 - zw0, 0, yw1 - 0.025, (zw0 + zw1) / 2), box(0.06, 0.05, zw1 - zw0, 0, yw0 + 0.025, (zw0 + zw1) / 2),
      box(0.06, yw1 - yw0, 0.05, 0, (yw0 + yw1) / 2, zw0 + 0.025), box(0.06, yw1 - yw0, 0.05, 0, (yw0 + yw1) / 2, zw1 - 0.025),
      box(0.05, yw1 - yw0, 0.035, 0, (yw0 + yw1) / 2, (zw0 + zw1) / 2), box(0.05, 0.035, zw1 - zw0, 0, (yw0 + yw1) / 2, (zw0 + zw1) / 2),
      box(0.22, 0.05, zw1 - zw0 + 0.16, 0.08, yw0 - 0.03, (zw0 + zw1) / 2),
    ]);
    const fm = new THREE.Mesh(frame, ref); fm.position.x = 2.6; hutExterior.add(fm);
    // the lit window: warm interior matte + the alarm beacon sweeping inside
    const mc = document.createElement('canvas'); mc.width = 256; mc.height = 210;
    const mx = mc.getContext('2d');
    const gr = mx.createLinearGradient(0, 0, 0, 210); gr.addColorStop(0, '#4a3222'); gr.addColorStop(0.55, '#8a5a34'); gr.addColorStop(1, '#3a2618');
    mx.fillStyle = gr; mx.fillRect(0, 0, 256, 210);
    const lg = mx.createRadialGradient(200, 150, 5, 200, 150, 120); lg.addColorStop(0, 'rgba(255,220,160,1)'); lg.addColorStop(1, 'rgba(255,200,140,0)');
    mx.fillStyle = lg; mx.fillRect(0, 0, 256, 210);
    mx.fillStyle = 'rgba(20,14,10,0.85)'; mx.fillRect(20, 40, 70, 170);                    // bookshelf silhouette
    mx.fillStyle = 'rgba(25,18,12,0.8)'; mx.fillRect(95, 150, 160, 16);                     // desk edge
    mx.fillStyle = 'rgba(120,240,210,0.9)'; mx.fillRect(228, 110, 28, 22);                  // monitor glow
    mx.fillStyle = 'rgba(30,20,14,0.9)'; for (let i = 0; i < 4; i++) mx.fillRect(0, 8 + i * 3, 256, 1.5);
    const winTex = new THREE.CanvasTexture(mc); winTex.colorSpace = THREE.SRGBColorSpace;
    winMat = new THREE.ShaderMaterial({
      uniforms: { map: { value: winTex }, uWarm: { value: 1 }, uRed: { value: 0 }, uPh: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: /* glsl */`
        uniform sampler2D map; uniform float uWarm, uRed, uPh; varying vec2 vUv;
        void main() {
          vec3 c = texture2D(map, vUv).rgb * uWarm * 0.95;
          float sweep = pow(0.5 + 0.5 * cos((vUv.x - 0.5) * 3.0 + uPh), 6.0);
          c += vec3(1.0, 0.07, 0.03) * uRed * (0.12 + 0.9 * sweep) * (0.6 + 0.4 * vUv.y);
          vec2 q = abs(vUv - 0.5) * 2.0;
          c += vec3(0.02, 0.03, 0.05) * (1.0 - q.y);
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(zw1 - zw0, yw1 - yw0), winMat);
    pane.position.set(2.58, (yw0 + yw1) / 2, (zw0 + zw1) / 2); pane.rotation.y = PI / 2;
    hutExterior.add(pane);
    winGlowS = new THREE.Sprite(additive(new THREE.Color(1.0, 0.55, 0.22), { opacity: 0.2 }));
    winGlowS.position.set(2.9, 1.4, 0.3); winGlowS.scale.set(2.4, 1.7, 1);
    hutExterior.add(winGlowS);
    winLight = new THREE.PointLight(0xffa04a, 5, 14, 2);
    winLight.position.set(3.4, 1.4, 0.3);
    hutG.add(winLight);
    // door, steps, porch lamp
    const doorM = new THREE.Mesh(new THREE.BoxGeometry(0.85, 2.05, 0.05), new THREE.MeshStandardMaterial({ color: 0x5f6b63, roughness: 0.6 }));
    doorM.position.set(1.5, 1.025, Z - 0.03); hutExterior.add(doorM);
    hutExterior.add(new THREE.Mesh(merge([box(1.1, 0.15, 0.5, 1.5, -0.08, Z + 0.3), box(1.1, 0.15, 0.3, 1.5, -0.23, Z + 0.6)]), concreteMat));
    hutExterior.add(new THREE.Mesh(merge([box(0.14, 0.1, 0.1, 1.5, 2.3, Z + 0.05)]), darkMat));
    porchSprite = new THREE.Sprite(additive(new THREE.Color(1.0, 0.65, 0.3).multiplyScalar(1.6)));
    porchSprite.position.set(1.5, 2.22, Z + 0.14); porchSprite.scale.setScalar(0.9);
    hutExterior.add(porchSprite);
    porchLight = new THREE.PointLight(0xffa860, 6, 12, 2);
    porchLight.position.set(1.5, 2.1, Z + 0.5);
    hutG.add(porchLight);
    // weathering details: gutter and downpipes, a vent, conduit and meter box, a sign
    {
      const galv = new THREE.MeshStandardMaterial({ color: 0x8a8f93, roughness: 0.5, metalness: 0.6 });
      const parts = [];
      parts.push(new THREE.CylinderGeometry(0.06, 0.06, 2 * X + 0.4, 10, 1, false).rotateZ(PI / 2).translate(0, H1 - 0.05, -Z - 0.22));
      for (const x of [-X + 0.1, X - 0.1]) parts.push(new THREE.CylinderGeometry(0.04, 0.04, H1 - H0, 8).translate(x, (H1 + H0) / 2 - 0.1, -Z - 0.08));
      parts.push(box(0.05, 0.4, 0.4, X + 0.03, 2.3, -1.3));
      parts.push(box(0.12, 0.34, 0.26, X + 0.06, 0.9, -1.6));
      parts.push(new THREE.CylinderGeometry(0.02, 0.02, 1.1, 6).translate(X + 0.05, 0.3, -1.6));
      parts.push(new THREE.CylinderGeometry(0.018, 0.018, 1.8, 6).rotateX(PI / 2).translate(X + 0.04, 1.08, -0.8));
      hutExterior.add(new THREE.Mesh(merge(parts), galv));
      for (let k = 0; k < 6; k++) hutExterior.add(new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.012, 0.36).translate(X + 0.06, 2.14 + k * 0.05, -1.3), darkMat));
      const sc = document.createElement('canvas'); sc.width = 256; sc.height = 128;
      const sx = sc.getContext('2d');
      sx.fillStyle = '#e8e4d8'; sx.fillRect(0, 0, 256, 128); sx.fillStyle = '#1d4f8a'; sx.fillRect(0, 0, 256, 34);
      sx.fillStyle = '#fff'; sx.font = 'bold 22px "DejaVu Sans", sans-serif'; sx.textAlign = 'center'; sx.fillText('KRRO  HUT 1', 128, 25);
      sx.fillStyle = '#222'; sx.font = 'bold 15px "DejaVu Sans", sans-serif'; sx.fillText('CONTROL ROOM', 128, 64); sx.fillText('RADIO QUIET ZONE', 128, 92);
      const st = new THREE.CanvasTexture(sc); st.colorSpace = THREE.SRGBColorSpace;
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.25), new THREE.MeshLambertMaterial({ map: st }));
      sign.position.set(X + 0.005, 1.55, -1.0); sign.rotation.y = PI / 2;
      hutExterior.add(sign);
      // gravel apron (darker, speckled) around the plinth
      const gc = document.createElement('canvas'); gc.width = gc.height = 256;
      const gx = gc.getContext('2d'); const rr = U.mulberry32(88);
      gx.fillStyle = '#403c38'; gx.fillRect(0, 0, 256, 256);
      for (let i = 0; i < 5000; i++) { const v = 40 + rr() * 80; gx.fillStyle = `rgb(${v},${v * 0.96},${v * 0.9})`; gx.fillRect(rr() * 256, rr() * 256, 1 + rr() * 2, 1 + rr() * 2); }
      const gt = new THREE.CanvasTexture(gc); gt.colorSpace = THREE.SRGBColorSpace; gt.wrapS = gt.wrapT = THREE.RepeatWrapping; gt.repeat.set(4, 4);
      const apron = new THREE.Mesh(new THREE.PlaneGeometry(2 * X + 3, 2 * Z + 3).rotateX(-PI / 2).translate(0, -0.27, 0), new THREE.MeshLambertMaterial({ map: gt, color: 0x9a9a9a, polygonOffset: true, polygonOffsetFactor: -1 }));
      hutExterior.add(apron);
    }
    // rooftop details: small dish, AC unit, antenna
    const p2 = [];
    for (let i = 0; i <= 8; i++) { const r = 0.05 + 0.45 * i / 8; p2.push(new THREE.Vector2(r, r * r / 0.8)); }
    const sd = paintMat.clone(); sd.side = THREE.DoubleSide;
    const sdish = new THREE.Mesh(new THREE.LatheGeometry(p2, 24), sd);
    sdish.position.set(-1.6, 3.8, -1.2); sdish.rotation.set(deg(-50), deg(30), 0);
    hutExterior.add(sdish);
    hutExterior.add(new THREE.Mesh(merge([box(0.06, 0.7, 0.06, -1.6, 3.45, -1.2), box(0.9, 0.7, 0.5, -3.0, 0.35, -1.0), box(0.03, 2.2, 0.03, -2.2, 4.1, 1.6)]), darkMat));
  }

  // mast with two red obstruction lights, beside the hut
  const MAST = HUT_POS.clone().addScaledVector(new V3(-RIDGE.z, 0, RIDGE.x), 9).addScaledVector(RIDGE, -4);
  const MAST_H = 16.0;
  {
    const parts = [];
    MAST.y = groundH(MAST.x, MAST.z);
    const w = 0.6;
    const leg = k => { const a = k / 3 * PI * 2; return [Math.cos(a) * w, Math.sin(a) * w]; };
    for (let k = 0; k < 3; k++) {
      const [x1, z1] = leg(k), [x2, z2] = leg((k + 1) % 3);
      parts.push(strut(new V3(x1, 0, z1), new V3(x1 * 0.6, MAST_H, z1 * 0.6), 0.06, 4));
      for (let s = 0; s < 14; s++) {
        const f0 = s / 14, f1 = (s + 1) / 14, s0 = 1 - 0.4 * f0, s1 = 1 - 0.4 * f1;
        parts.push(strut(new V3(x1 * s0, f0 * MAST_H, z1 * s0), new V3(x2 * s1, f1 * MAST_H, z2 * s1), 0.035, 3));
      }
    }
    parts.push(strut(new V3(0, MAST_H, 0), new V3(0, MAST_H + 3.2, 0), 0.04, 4));
    const m = new THREE.Mesh(mergeGeometries(parts), darkMat);
    m.position.copy(MAST);
    root.add(m);
  }
  const beacons = [];
  for (const [hgt, s] of [[MAST_H + 0.15, 2.4], [MAST_H * 0.5, 1.4]]) {
    const sp = new THREE.Sprite(additive(new THREE.Color(1.0, 0.1, 0.05).multiplyScalar(2.4)));
    sp.position.set(MAST.x, MAST.y + hgt, MAST.z);
    sp.scale.setScalar(s);
    sp.renderOrder = 6;
    root.add(sp);
    beacons.push(sp);
  }
  // cable tray from the back of the hut (behind the rack) to the pedestal, clear of the window view
  {
    const parts = [];
    const hutPt = (x, z) => new V3(x, 0, z).applyAxisAngle(new V3(0, 1, 0), HUT_YAW).add(HUT_POS);
    const pts = [hutPt(1.2, -2.5), hutPt(5.5, -6.0), RIDGE.clone().multiplyScalar(-3.6).addScaledVector(new V3(RIDGE.z, 0, -RIDGE.x), -3.5)];
    const segs = [];
    for (let k = 0; k < pts.length - 1; k++) { const n = Math.max(2, Math.round(pts[k].distanceTo(pts[k + 1]) / 5)); for (let i = 0; i < n; i++) segs.push(pts[k].clone().lerp(pts[k + 1], i / n)); }
    segs.push(pts[pts.length - 1]);
    for (const p of segs) parts.push(box(0.12, 0.7, 0.12, p.x, groundH(p.x, p.z) + 0.35, p.z));
    for (let i = 0; i < segs.length - 1; i++) {
      const p = segs[i], q = segs[i + 1];
      parts.push(strut(new V3(p.x, groundH(p.x, p.z) + 0.72, p.z), new V3(q.x, groundH(q.x, q.z) + 0.72, q.z), 0.12, 4));
    }
    root.add(new THREE.Mesh(merge(parts), darkMat));
  }

  // =========================================================================
  // moonlight direction: fixed in the hut frame (comes in through the window,
  // from local +x, 36 deg up, angled toward local +z, so the pane pattern lands by the rack)
  // =========================================================================
  const MOON_LOCAL = new V3(Math.cos(deg(30)) * Math.cos(deg(36)), Math.sin(deg(36)), Math.sin(deg(30)) * Math.cos(deg(36)));
  root.updateMatrixWorld(true);
  MOON_DIR.copy(MOON_LOCAL).applyQuaternion(hutG.quaternion);
  moon.position.copy(MOON_DIR).multiplyScalar(200);
  moon.target.position.set(0, 0, 0);

  // =========================================================================
  // anchors
  // =========================================================================
  const hutMatrix = hutG.matrixWorld.clone();
  const toWorld = (x, y, z) => new V3(x, y, z).applyMatrix4(hutMatrix);
  const winCenter = toWorld(2.66, 1.4, 0.3);
  const winNormal = new V3(1, 0, 0).applyQuaternion(hutG.quaternion);
  const AZ_REST = azToDish + deg(8);        // dish faces away from the hut, a little off the ridge line
  const EL_REST = 0.55;
  const anchors = {
    dish: DISH_BASE.toArray(),                               // foot of the pedestal
    dishAxis: DISH_BASE.clone().add(new V3(0, AXIS_Y, 0)).toArray(),
    dishCenter: [0, 0, 0],                                   // reflector centre (updated per frame)
    hutWindow: winCenter.toArray(),
    hutWindowNormal: winNormal.toArray(),
    hut: [HUT_POS.x, HUT_Y, HUT_POS.z],
    hutDoor: toWorld(1.5, 1.0, 2.2).toArray(),
    beacon: [MAST.x, MAST.y + MAST_H + 0.15, MAST.z],
    // ext_push: start beyond the dish (its back and the Milky Way ahead), looking up at it,
    // then push toward the lit window (see anchors.shots for a full suggested move)
    lookAt: DISH_BASE.clone().add(new V3(0, 17, 0)).toArray(),
    pushFrom: DISH_BASE.clone().addScaledVector(RIDGE, 36).addScaledVector(new V3(RIDGE.z, 0, -RIDGE.x), 11).add(new V3(0, 2.6, 0)).toArray(),
    moonDir: MOON_DIR.toArray(),
    dishRest: { az: 0, el: EL_REST },                        // state.dish is relative: az 0 = rest heading
  };
  {
    const side = new V3(RIDGE.z, 0, -RIDGE.x);
    const wn = winNormal.clone();
    anchors.shots = {
      ext_push: {   // position lerps from -> to (ease in-out), target lerps lookFrom -> lookTo
        from: anchors.pushFrom, to: winCenter.clone().addScaledVector(wn, 8.5).add(new V3(0, 0.35, 0)).addScaledVector(side, 1.2).toArray(),
        lookFrom: anchors.lookAt, lookTo: winCenter.clone().add(new V3(0, 0.1, 0)).toArray(), fov: 40,
      },
      ext_dish: {   // crane up in front of the dish while it turns to the sky; the hut glows behind it
        from: DISH_BASE.clone().addScaledVector(RIDGE, 34).addScaledVector(side, -14).add(new V3(0, 3, 0)).toArray(),
        to: DISH_BASE.clone().addScaledVector(RIDGE, 30).addScaledVector(side, -12).add(new V3(0, 13, 0)).toArray(),
        lookFrom: DISH_BASE.clone().add(new V3(0, 12, 0)).toArray(), lookTo: DISH_BASE.clone().add(new V3(0, 21, 0)).toArray(), fov: 42,
      },
    };
  }

  // =========================================================================
  // update
  // =========================================================================
  const tmpM = new THREE.Matrix4();
  const hash1 = n => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
  const dishCenter = new V3();
  function defaultDish(t) {
    const u = U.easeInOut(U.prog(t, B.dish_turns.start, B.dish_turns.end));
    return { az: lerp(0, 0.35, u), el: lerp(EL_REST, 1.2, u) };
  }
  function update(t, st) {
    tmpM.makeRotationFromQuaternion(skyQ(t));
    starGroup.matrix.copy(tmpM);
    starGroup.matrixWorldNeedsUpdate = true;
    skyU.uW2G.value.setFromMatrix4(tmpM).transpose();
    starU.uTime.value = t;
    // dish (az relative to the rest heading; el from the horizon; radians, degrees tolerated)
    let d = st.dish || defaultDish(t);
    let az = +d.az || 0, el = d.el === undefined ? EL_REST : +d.el;
    if (Math.abs(az) > 2 * PI + 0.1 || el > PI / 2 + 0.1) { az = deg(az); el = deg(el); }
    azG.rotation.y = AZ_REST + az;
    elG.rotation.x = PI / 2 - el;
    dishG.updateMatrixWorld(true);
    dishCenter.set(0, RD * RD / (4 * F), 0).applyMatrix4(dishG.matrixWorld);
    anchors.dishCenter[0] = dishCenter.x; anchors.dishCenter[1] = dishCenter.y; anchors.dishCenter[2] = dishCenter.z;
    // hut window: warm; flickers at the alarm, then the beacon sweeps red inside
    const lights = st.lights ?? 1;
    const alarm = st.alarm ?? (t >= B.alarm && t < B.lights_return ? 1 : 0);
    let win = lights;
    if (t >= B.alarm && t < B.alarm + 1.8) {
      const h = hash1(Math.floor((t - B.alarm) * 20));
      win = lerp(win, h < 0.45 ? 0.1 + 0.25 * h : 1.1 + 0.5 * h, 1 - smooth(B.alarm + 1.0, B.alarm + 1.8, t));
    }
    const ph = (t - B.alarm) * PI * 2 * 0.75;
    const sweep = alarm * Math.pow(0.5 + 0.5 * Math.cos(ph), 4);
    winMat.uniforms.uWarm.value = win;
    winMat.uniforms.uRed.value = alarm * 0.8;
    winMat.uniforms.uPh.value = ph;
    winGlowS.material.opacity = 0.14 * win + 0.22 * sweep;
    winGlowS.material.color.setRGB(1.0, lerp(0.55, 0.1, sweep / (win + sweep + 1e-3)), lerp(0.22, 0.06, sweep / (win + sweep + 1e-3)));
    winLight.intensity = 5 * win + 7 * sweep;
    winLight.color.setRGB(1.0, lerp(0.63, 0.12, sweep / (win + sweep + 1e-3)), lerp(0.29, 0.08, sweep / (win + sweep + 1e-3)));
    // mast beacons: slow obstruction blink
    const phase = t / 1.5;
    const fr = phase - Math.floor(phase), fr2 = (phase + 0.5) - Math.floor(phase + 0.5);
    beacons[0].material.opacity = smooth(0.0, 0.05, fr) * (1 - smooth(0.16, 0.34, fr));
    beacons[1].material.opacity = 0.8 * smooth(0.0, 0.05, fr2) * (1 - smooth(0.16, 0.34, fr2));
    dishBeacon.material.opacity = beacons[0].material.opacity;
    const idle = (Math.floor(t / 0.9) % 2 === 0) ? 1 : 0.2;
    led.material.color.setRGB(0.2 * idle, 1.2 * idle, 0.3 * idle);
  }

  return {
    root, anchors, update, hutG, hutExterior, hutMatrix, groundH, moonDir: MOON_DIR.clone(), moonLocal: MOON_LOCAL.clone(),
    starU, sky, HAZE,
  };
}
