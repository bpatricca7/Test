// ECHO (animated cut) — "observatory" (film 54.0 – 74.0 s)
//
// A lone 25 m radio dish on a dark ridge at night. The camera circles low
// around it, looking up against a wheeling Milky Way. The dish slews to a new
// patch of sky (56.0 – 60.5): a faint globular cluster. Then rings of cyan
// light fall out of that point in the sky into the dish (64.0 – 67.0); the
// hut window flickers and the mast beacon speeds up (65.2).
//
// Everything is a pure function of film time t (frames render out of order).

import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeAA } from './echo_aa.js';

export async function create(env) {
  const { THREE, TL, W, H, renderer, U } = env;
  const V3 = THREE.Vector3;
  const OB = TL.observatory;
  const SLEW = OB.slew, ARR = OB.arrival, ALARM = OB.alarm;
  const deg = d => d * Math.PI / 180;
  const { clamp, lerp, smooth, prog } = U;
  const ease = U.easeInOut;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0, 0, 0);
  const HAZE = new THREE.Color(0.016, 0.023, 0.036);          // linear; horizon mist
  scene.fog = new THREE.FogExp2(HAZE.clone(), 0.0008);
  const camera = new THREE.PerspectiveCamera(54, W / H, 0.5, 40000);
  const aa = makeAA(THREE, renderer, W, H, { dither: 0.0005 });

  // =========================================================================
  // sky frame: galactic frame -> world, wheeling about the celestial pole
  // =========================================================================
  const LAT = deg(38);
  const POLE = new V3(0, Math.sin(LAT), -Math.cos(LAT));      // north is -Z
  const OMEGA = 0.0085;                                         // rad/s (exaggerated)
  const T_REF = 65.0;
  const spinQ = t => new THREE.Quaternion().setFromAxisAngle(POLE, OMEGA * (t - T_REF));

  const GC = new V3(-0.80, 0.08, -0.60).normalize();           // galactic centre, low in the south-west
  const band2 = new V3(0.05, 0.36, -0.93).normalize();          // the band arches behind the dish
  const GP = new V3().crossVectors(GC, band2).normalize();
  const GZ = new V3().crossVectors(GC, GP).normalize();
  const qB = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(GC, GP, GZ));
  const skyQ = t => spinQ(t).multiply(qB);

  // where the dish ends up pointing (at T_REF): the cluster
  const AZ_F = deg(141), EL_F = deg(36);
  const dirAzEl = (az, el) => new V3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
  const TARGET_REF = dirAzEl(AZ_F, EL_F);
  const CLUSTER_GAL = TARGET_REF.clone().applyQuaternion(qB.clone().invert());
  const targetAt = t => TARGET_REF.clone().applyQuaternion(spinQ(t));

  // =========================================================================
  // bake the Milky Way (+ faint stars) once into a cube map, galactic frame
  // =========================================================================
  const mwRT = new THREE.WebGLCubeRenderTarget(1280, {
    type: THREE.UnsignedByteType, generateMipmaps: false,
    minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
  });
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
          // unresolved faint stars, denser in the band
          vec3 q = floor(c * 900.0);
          float h = hash13(q);
          float thr = 0.9965 - 0.012 * band * (1.0 - clamp(dust, 0.0, 1.0));
          if (h > thr) col += vec3(0.9, 0.93, 1.0) * (0.6 + 5.0 * pow(hash13(q + 7.0), 5.0));
          gl_FragColor = vec4(sqrt(clamp(col / 8.0, 0.0, 1.0)), 1.0);   // 8-bit, sqrt-encoded
        }`,
    }));
    bakeScene.add(m);
    const cubeCam = new THREE.CubeCamera(0.1, 100, mwRT);
    cubeCam.update(renderer, bakeScene);
    m.geometry.dispose(); m.material.dispose();
  }

  // cirrus texture: tileable (four-corner blend), baked on the GPU
  const clRT = new THREE.WebGLRenderTarget(1024, 1024, {
    type: THREE.UnsignedByteType, depthBuffer: false, wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping,
    minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: true,
  });
  {
    const bakeScene = new THREE.Scene();
    const bakeCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: /* glsl */`
        varying vec2 vUv;
        ${U.GLSL_NOISE}
        vec3 cl(vec2 uv) {
          vec2 p = uv * vec2(4.0, 10.0);
          float w = fbm(vec3(p * 0.4, 1.7));
          float d = fbm(vec3(p.x + w * 2.5, p.y * 0.8 + w * 1.5, 4.2));
          float s = fbm(vec3(p.x * 0.5 + w, p.y * 3.0, 8.1));
          return vec3(d, s, w);
        }
        vec3 tile(vec2 u) {
          u = fract(u);
          vec3 a = cl(u), b = cl(u - vec2(1.0, 0.0)), c = cl(u - vec2(0.0, 1.0)), d = cl(u - vec2(1.0, 1.0));
          vec3 v = mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
          // restore contrast lost in the blend
          float k = 1.0 / sqrt(pow(1.0 - u.x, 2.0) + u.x * u.x) / sqrt(pow(1.0 - u.y, 2.0) + u.y * u.y);
          return 0.5 + (v - 0.5) * k;
        }
        void main() {
          vec3 c1 = tile(vUv), c2 = tile(vUv * 2.0 + vec2(0.37, 0.11));
          float den = smoothstep(0.44, 0.80, c1.r * 0.72 + c2.g * 0.45) * (0.45 + 0.55 * c1.b);
          gl_FragColor = vec4(den, den, den, 1.0);
        }`,
    }));
    bakeScene.add(m);
    renderer.setRenderTarget(clRT);
    renderer.render(bakeScene, bakeCam);
    renderer.setRenderTarget(null);
    m.geometry.dispose(); m.material.dispose();
  }

  // =========================================================================
  // sky dome: gradient (per vertex), Milky Way cube, cirrus, arrival glow
  // =========================================================================
  const CLOUD_GLSL = /* glsl */`
    uniform sampler2D tC; uniform vec2 uCloudOff; uniform float uCloudH, uCloudScale;
    float cloudDen(vec4 c, vec3 d) { return c.r * smoothstep(0.04, 0.2, d.y); }
    vec2 cloudUV(vec3 d, vec3 cam) { return (cam.xz + d.xz * (uCloudH / max(d.y, 0.02))) * uCloudScale + uCloudOff; }
    // vertex shaders: explicit lod
    float cloudAtLod(vec3 d, vec3 cam, float lod) {
      if (d.y < 0.04) return 0.0;
      vec2 p = cloudUV(d, cam);
      return cloudDen(textureLod(tC, p, lod), d);
    }`;
  const skyU = {
    tMW: { value: mwRT.texture }, uW2G: { value: new THREE.Matrix3() }, uMW: { value: 0.05 },
    uTown: { value: new V3(-0.25, 0, 1).normalize() }, uHaze: { value: new V3(HAZE.r, HAZE.g, HAZE.b) },
    uFlash: { value: 0 }, uFlashDir: { value: new V3(0, 1, 0) }, uCloudLit: { value: 0 },
    tC: { value: clRT.texture }, uCloudOff: { value: new THREE.Vector2() },
    uCloudH: { value: 1500 }, uCloudScale: { value: 1 / 16000 },
  };
  const sky = new THREE.Mesh(new THREE.SphereGeometry(20000, 128, 96), new THREE.ShaderMaterial({
    uniforms: skyU, side: THREE.BackSide, depthWrite: false, fog: false,
    // everything smooth is done per vertex; the fragment shader only samples
    vertexShader: /* glsl */`
      uniform vec3 uTown, uHaze;
      varying vec3 vDir; varying vec3 vBase; varying float vAlt, vTownC;
      void main() {
        vDir = position;
        vec3 d = normalize(position);
        float alt = d.y, h = max(alt, 0.0);
        vec3 zen = vec3(0.0016, 0.0026, 0.0068);
        vec3 col = mix(uHaze, zen, pow(smoothstep(0.0, 1.0, h), 0.42));
        col += vec3(0.004, 0.012, 0.009) * exp(-pow((alt - 0.07) / 0.07, 2.0));   // airglow
        vec3 hd = normalize(vec3(d.x, 0.0, d.z) + 1e-5);
        float town = max(dot(hd, uTown), 0.0);
        col += vec3(0.040, 0.017, 0.006) * pow(town, 5.0) * exp(-h / 0.09);      // distant town
        vBase = col;
        vAlt = alt;
        vTownC = pow(town, 3.0) * (1.0 - smoothstep(0.05, 0.4, alt));
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform samplerCube tMW; uniform mat3 uW2G; uniform float uMW, uFlash, uCloudLit;
      uniform vec3 uFlashDir;
      uniform sampler2D tC; uniform vec2 uCloudOff; uniform float uCloudH, uCloudScale;
      varying vec3 vDir; varying vec3 vBase; varying float vAlt, vTownC;
      void main() {
        vec3 mw = textureCube(tMW, uW2G * vDir).rgb;
        vec3 col = vBase + mw * mw * (8.0 * uMW * smoothstep(-0.02, 0.30, vAlt));
        float den = 0.0;
        if (vAlt > 0.04) {
          vec2 p = (cameraPosition.xz + vDir.xz * (uCloudH / vDir.y)) * uCloudScale + uCloudOff;
          den = texture2D(tC, p).r * smoothstep(0.04, 0.2, vAlt);
        }
        vec3 cc = vec3(0.011, 0.014, 0.021) * (0.7 + 0.6 * den) + vec3(0.026, 0.012, 0.005) * vTownC;
        vec3 fl = vec3(0.0);
        if (uFlash > 0.0) {
          float q = 1.0 - max(dot(normalize(vDir), uFlashDir), 0.0);
          fl = vec3(0.30, 0.85, 1.0) * uFlash * (exp(-300.0 * q) * 0.5 + exp(-40.0 * q) * 0.04 + exp(-12.0 * q) * 0.004);
          cc += vec3(0.2, 0.7, 0.8) * uCloudLit * exp(-3.0 * q);
        }
        gl_FragColor = vec4(mix(col, cc, den * 0.8) + fl * (1.0 - den * 0.6), 1.0);
      }`,
  }));
  sky.renderOrder = -10;
  sky.frustumCulled = false;
  scene.add(sky);

  // =========================================================================
  // stars (galactic frame, rotated with the sky, dimmed by the cirrus)
  // =========================================================================
  const starGroup = new THREE.Group();
  starGroup.matrixAutoUpdate = false;
  scene.add(starGroup);
  const starU = { uTime: { value: 0 }, uR: { value: 18000 }, tC: skyU.tC, uCloudOff: skyU.uCloudOff, uCloudH: skyU.uCloudH, uCloudScale: skyU.uCloudScale };
  {
    const rnd = U.mulberry32(1974);
    const N_ALL = 5200, N_BAND = 7000, N_CL = 700;
    const N = N_ALL + N_BAND + N_CL;
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
      const u = rnd() * 2 - 1, a = rnd() * Math.PI * 2, s = Math.sqrt(1 - u * u);
      tmp.set(s * Math.cos(a), u, s * Math.sin(a));
      const m = Math.pow(rnd(), 7);
      put(tmp, 0.07 + 3.4 * m, 2.2 + 3.6 * Math.pow(m, 0.6), tints[Math.floor(rnd() * tints.length)]);
    }
    for (let k = 0; k < N_BAND; k++) {
      const l = rnd() * Math.PI * 2 - Math.PI;
      const w = 0.10 + 0.08 * Math.exp(-l * l / 0.5);
      const b = U.gauss(rnd) * w * 0.8;
      tmp.set(Math.cos(b) * Math.cos(l), Math.sin(b), Math.cos(b) * Math.sin(l));
      const m = Math.pow(rnd(), 10);
      put(tmp, 0.06 + 1.4 * m, 2.0 + 1.8 * Math.pow(m, 0.5), tints[1 + Math.floor(rnd() * 4)]);
    }
    // the globular cluster the dish turns to
    const cl = CLUSTER_GAL.clone();
    const e1 = new V3().crossVectors(cl, new V3(0, 1, 0)).normalize();
    const e2 = new V3().crossVectors(cl, e1).normalize();
    for (let k = 0; k < N_CL; k++) {
      const rr = 0.006 * Math.pow(rnd(), 1.7) / (0.25 + rnd() * 0.75);
      const a = rnd() * Math.PI * 2;
      tmp.copy(cl).addScaledVector(e1, Math.cos(a) * rr).addScaledVector(e2, Math.sin(a) * rr).normalize();
      put(tmp, 0.14 + 0.6 * Math.pow(rnd(), 4), 2.0 + 0.8 * rnd(), tints[3 + Math.floor(rnd() * 2)]);
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
        uniform float uTime, uR;
        varying vec3 vCol;
        ${CLOUD_GLSL}
        void main() {
          vec3 wd = normalize(mat3(modelMatrix) * position);
          float ext = smoothstep(-0.01, 0.28, wd.y);
          float tw = 1.0 + (0.12 + 0.45 * (1.0 - ext)) * sin(uTime * (2.0 + aPhase * 5.0) + aPhase * 60.0);
          float den = cloudAtLod(wd, cameraPosition, 2.0);
          vCol = aColor * ext * tw * (1.0 - 0.9 * den);
          gl_Position = projectionMatrix * viewMatrix * vec4(cameraPosition + wd * uR, 1.0);
          gl_PointSize = aSize;
        }`,
      fragmentShader: /* glsl */`
        varying vec3 vCol;
        void main() {
          vec2 p = gl_PointCoord - 0.5;
          gl_FragColor = vec4(vCol * exp(-dot(p, p) * 18.0), 1.0);
        }`,
    }));
    pts.frustumCulled = false;
    pts.renderOrder = 1;
    starGroup.add(pts);
  }
  const glowTex = U.makeGlowTexture(THREE, 128, 0.18);
  const additive = (color, extra = {}) => new THREE.SpriteMaterial(Object.assign({
    map: glowTex, color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false,
  }, extra));
  const clusterGlow = new THREE.Sprite(additive(new THREE.Color(0.3, 0.29, 0.25)));
  clusterGlow.renderOrder = 1;
  scene.add(clusterGlow);

  // =========================================================================
  // terrain: the ridge
  // =========================================================================
  function groundH(x, z) {
    const r = Math.hypot(x, z);
    const ra = Math.hypot(x / 2.4, z * 1.1);
    const d = Math.max(0, ra - 48);
    let h = -0.0042 * d * d - 0.06 * d;
    h = Math.max(h, -480 + 60 * U.fbm3(x * 0.002, 3.0, z * 0.002, 3));
    h += (U.fbm3(x * 0.006, 0.5, z * 0.006, 5) - 0.5) * 80 * smooth(30, 260, r);
    h += (U.fbm3(x * 0.06, 2.5, z * 0.06, 4) - 0.5) * 1.6 * smooth(16, 34, r);
    h += (U.fbm3(x * 0.3, 7.5, z * 0.3, 2) - 0.5) * 0.25 * smooth(12, 20, r);
    return h;
  }
  const terrainMeshes = [];
  {
    const NR = 150, NS = 256, RMAX = 2400;
    const pos = [], colr = [], idx = [];
    const cGrass = new THREE.Color(0.034, 0.038, 0.027), cRock = new THREE.Color(0.06, 0.06, 0.062);
    const cPad = new THREE.Color(0.12, 0.12, 0.115);
    const c = new THREE.Color();
    pos.push(0, groundH(0, 0), 0); colr.push(cPad.r, cPad.g, cPad.b);
    for (let j = 1; j <= NR; j++) {
      const r = RMAX * Math.pow(j / NR, 2.3);
      for (let k = 0; k < NS; k++) {
        const a = k / NS * Math.PI * 2;
        const x = Math.cos(a) * r, z = Math.sin(a) * r;
        pos.push(x, groundH(x, z), z);
        const n = U.fbm3(x * 0.05, 1.1, z * 0.05, 3);
        c.copy(cGrass).lerp(cRock, clamp(n * 1.6 - 0.4));
        c.lerp(cPad, 1 - smooth(11, 15, r));
        colr.push(c.r, c.g, c.b);
      }
    }
    for (let k = 0; k < NS; k++) idx.push(0, 1 + k, 1 + (k + 1) % NS);
    for (let j = 1; j < NR; j++) {
      for (let k = 0; k < NS; k++) {
        const a = 1 + (j - 1) * NS + k, b = 1 + (j - 1) * NS + (k + 1) % NS;
        idx.push(a, a + NS, b, b, a + NS, b + NS);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(colr, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const ground = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true }));
    scene.add(ground);
    terrainMeshes.push(ground);
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
    const N = 120;
    const rocks = new THREE.InstancedMesh(base, new THREE.MeshLambertMaterial({ color: 0x2c2c2e, flatShading: true }), N);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new V3();
    for (let i = 0; i < N; i++) {
      const a = rnd() * Math.PI * 2, r = 20 + 180 * Math.pow(rnd(), 1.6);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const sc = (0.3 + 1.4 * Math.pow(rnd(), 3)) * (1 + r / 120);
      q.setFromEuler(new THREE.Euler(rnd() * 0.4, rnd() * 6.3, rnd() * 0.4));
      s.set(sc * (0.8 + rnd() * 0.6), sc, sc * (0.8 + rnd() * 0.6));
      m.compose(new V3(x, groundH(x, z) - sc * 0.15, z), q, s);
      rocks.setMatrixAt(i, m);
    }
    scene.add(rocks);
    terrainMeshes.push(rocks);
  }

  // =========================================================================
  // distant mountains, layer by layer into the mist
  // =========================================================================
  const mountainMat = (colTop, y0, y1) => new THREE.ShaderMaterial({
    uniforms: { uCol: { value: colTop }, uMist: { value: new V3(HAZE.r, HAZE.g, HAZE.b) }, uY0: { value: y0 }, uY1: { value: y1 } },
    fog: false, side: THREE.DoubleSide,
    vertexShader: /* glsl */`
      attribute float aN; varying float vY; varying float vN;
      void main() { vec4 w = modelMatrix * vec4(position, 1.0); vY = w.y; vN = aN;
        gl_Position = projectionMatrix * viewMatrix * w; }`,
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
  const mountainMeshes = [];
  LAYERS.forEach((L, li) => {
    const N = 900, pos = [], an = [], idx = [];
    for (let i = 0; i <= N; i++) {
      const a = i / N * Math.PI * 2;
      const cx = Math.cos(a), cz = Math.sin(a);
      let hh = 0, amp = 1, f = 2.2, norm = 0;
      for (let o = 0; o < 6; o++) {
        const n = U.vnoise3(cx * f + L.seed * 7.1, cz * f + L.seed * 3.3, L.seed * 1.9 + o * 5.0);
        const rdg = 1 - Math.abs(2 * n - 1);
        hh += amp * rdg * rdg; norm += amp;
        amp *= 0.5; f *= 2.05;
      }
      hh /= norm;
      const top = L.base + L.amp * Math.pow(hh, 1.5);
      const nn = U.vnoise3(cx * 9 + L.seed, cz * 9, 2.0) - 0.5;
      pos.push(cx * L.r, top, cz * L.r, cx * L.r, -900, cz * L.r);
      an.push(nn, nn);
    }
    for (let i = 0; i < N; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 2, a + 1, a + 3); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aN', new THREE.Float32BufferAttribute(an, 1));
    g.setIndex(idx);
    const mesh = new THREE.Mesh(g, mountainMat(new V3(...L.col), L.mist[0], L.mist[1]));
    mesh.frustumCulled = false;
    mesh.renderOrder = -5 + li;       // near layers first so far ones fail the depth test
    scene.add(mesh);
    mountainMeshes.push(mesh);
  });

  // =========================================================================
  // lights: sky fill, a faint rim, and three practicals
  // =========================================================================
  const hemi = new THREE.HemisphereLight(0x4a5f8f, 0x1a1d24, 0.8);
  scene.add(hemi);
  const fill = new THREE.DirectionalLight(0x6f86c4, 0.32);      // cool night fill from the camera side
  scene.add(fill);
  scene.add(fill.target);
  const rim = new THREE.DirectionalLight(0x9db2ff, 0.55);
  scene.add(rim);
  scene.add(rim.target);

  // =========================================================================
  // helpers for struts
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
  const concreteMat = new THREE.MeshLambertMaterial({ color: 0x7a7b7d });
  const trussMat = new THREE.MeshStandardMaterial({ color: 0xa8acb3, roughness: 0.6, metalness: 0.35 });
  const dishU = { uGlow: { value: 0 }, uBack: { value: 0 }, uWave: { value: 0 }, uWavePh: { value: 0 } };
  // struts and truss pick up the arrival glow too
  const glowable = mat => {
    mat.onBeforeCompile = sh => {
      sh.uniforms.uGlow = dishU.uGlow;
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uGlow;')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3(0.35, 0.95, 0.88) * uGlow * 0.10;');
    };
    return mat;
  };
  glowable(trussMat);

  // pedestal
  const HUT = new V3(-19, 0, 12);
  const doorDir = Math.atan2(HUT.x, HUT.z);
  scene.add(new THREE.Mesh(merge([
    new THREE.CylinderGeometry(2.5, 3.3, 10.6, 40).translate(0, 5.3, 0),
    new THREE.CylinderGeometry(4.6, 4.8, 0.5, 40).translate(0, 0.2, 0),
  ]), concreteMat));
  {
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.2, 2.2, 0.3), darkMat);
    door.position.set(Math.sin(doorDir) * 3.12, 1.55, Math.cos(doorDir) * 3.12);
    door.rotation.y = doorDir;
    scene.add(door);
  }
  const lampPos = new V3(Math.sin(doorDir) * 3.3, 3.1, Math.cos(doorDir) * 3.3);
  const lampSprite = new THREE.Sprite(additive(new THREE.Color(1.0, 0.55, 0.2).multiplyScalar(2.0)));
  lampSprite.position.copy(lampPos);
  lampSprite.scale.setScalar(1.5);
  scene.add(lampSprite);
  const lampLight = new THREE.PointLight(0xff9a48, 34, 30, 2);
  lampLight.position.copy(lampPos).add(new V3(Math.sin(doorDir) * 0.6, 0, Math.cos(doorDir) * 0.6));
  scene.add(lampLight);

  // azimuth turret + yoke
  const azG = new THREE.Group();
  scene.add(azG);
  {
    const parts = [new THREE.CylinderGeometry(3.3, 3.3, 1.4, 40).translate(0, 11.3, 0)];
    for (const sx of [-1, 1]) {
      parts.push(box(1.0, 4.4, 2.8, sx * 4.4, 13.9, 0));
      parts.push(new THREE.CylinderGeometry(0.95, 0.95, 1.3, 20).rotateZ(Math.PI / 2).translate(sx * 4.4, AXIS_Y, 0));
    }
    parts.push(box(2.2, 1.6, 1.8, 0, 12.8, -2.0));
    azG.add(new THREE.Mesh(merge(parts), paintMat));
    const rail = [];
    for (let k = 0; k < 20; k++) {
      const a = k / 20 * Math.PI * 2, a2 = (k + 1) / 20 * Math.PI * 2;
      rail.push(strut(new V3(Math.cos(a) * 3.15, 12.0, Math.sin(a) * 3.15), new V3(Math.cos(a) * 3.15, 13.05, Math.sin(a) * 3.15), 0.04, 4));
      rail.push(strut(new V3(Math.cos(a) * 3.15, 13.05, Math.sin(a) * 3.15), new V3(Math.cos(a2) * 3.15, 13.05, Math.sin(a2) * 3.15), 0.04, 4));
    }
    azG.add(new THREE.Mesh(merge(rail), darkMat));
  }
  // elevation group: local +Y is the boresight; origin on the elevation axis
  const elG = new THREE.Group();
  elG.position.y = AXIS_Y;
  azG.add(elG);
  const dishG = new THREE.Group();
  dishG.position.y = VERTEX_OFF;
  elG.add(dishG);

  // reflector: 48 gores x 6 rings of panels
  let rimMesh;
  {
    const prof = [];
    const NP = 40;
    for (let i = 0; i <= NP; i++) {
      const r = 1.1 + (RD - 1.1) * i / NP;
      prof.push(new THREE.Vector2(r, r * r / (4 * F)));
    }
    const geo = new THREE.LatheGeometry(prof, 160);
    const c = document.createElement('canvas');
    c.width = 2048; c.height = 512;
    const x = c.getContext('2d');
    const rnd = U.mulberry32(9);
    for (let gi = 0; gi < 48; gi++) {
      for (let ri = 0; ri < 6; ri++) {
        const v = 196 + Math.floor(rnd() * 38);
        x.fillStyle = `rgb(${v},${v},${v + 3})`;
        x.fillRect(gi * 2048 / 48, ri * 512 / 6, 2048 / 48 + 1, 512 / 6 + 1);
      }
    }
    x.strokeStyle = 'rgba(40,42,48,0.9)';
    x.lineWidth = 2;
    for (let gi = 0; gi <= 48; gi++) { x.beginPath(); x.moveTo(gi * 2048 / 48, 0); x.lineTo(gi * 2048 / 48, 512); x.stroke(); }
    for (let ri = 0; ri <= 6; ri++) { x.beginPath(); x.moveTo(0, ri * 512 / 6); x.lineTo(2048, ri * 512 / 6); x.stroke(); }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const mat = new THREE.MeshStandardMaterial({ color: 0xd5d8de, map: tex, roughness: 0.5, metalness: 0.3, side: THREE.DoubleSide });
    mat.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, dishU);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying float vRad;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRad = length(position.xz) / 12.5;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uGlow, uBack, uWave, uWavePh; varying float vRad;')
        .replace('#include <emissivemap_fragment>', /* glsl */`#include <emissivemap_fragment>
          {
            float w = pow(0.5 + 0.5 * sin(vRad * 30.0 + uWavePh), 5.0);
            vec2 sg = vec2(vMapUv.x * 48.0, vMapUv.y * 6.0);
            vec2 sd = abs(fract(sg + 0.5) - 0.5) / max(fwidth(sg), vec2(1e-4));
            float seam = 1.0 - clamp(min(sd.x, sd.y) - 0.3, 0.0, 1.0);
            vec3 gc = vec3(0.42, 1.0, 0.92);
            float inside = gl_FrontFacing ? 0.0 : 1.0;
            vec3 e = gc * inside * (uGlow * (0.45 + 0.55 * (1.0 - vRad)) + uWave * w * (0.4 + 0.8 * vRad));
            e += gc * (1.0 - inside) * (uBack * (0.10 + 0.55 * seam) + uWave * w * 0.05);
            totalEmissiveRadiance += e;
          }`);
    };
    dishG.add(new THREE.Mesh(geo, mat));
    const rimMat = paintMat.clone();
    rimMesh = new THREE.Mesh(new THREE.TorusGeometry(RD, 0.16, 8, 160).rotateX(Math.PI / 2).translate(0, RD * RD / (4 * F), 0), rimMat);
    dishG.add(rimMesh);
  }
  // back structure: 24 radial trusses, 3 hoops, hub
  {
    const parts = [];
    const NRIB = 24;
    const yS = r => r * r / (4 * F) - 0.12;
    const yB = r => lerp(-2.3, RD * RD / (4 * F) - 0.45, (r - 1.8) / (RD - 0.2 - 1.8));
    const pt = (a, r, y) => new V3(Math.cos(a) * r, y, Math.sin(a) * r);
    for (let k = 0; k < NRIB; k++) {
      const a = (k + 0.5) / NRIB * Math.PI * 2;
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
    for (const r of [4.6, 8.2, 11.4]) {
      for (let k = 0; k < NRIB; k++) {
        const a = (k + 0.5) / NRIB * Math.PI * 2, a2 = (k + 1.5) / NRIB * Math.PI * 2;
        parts.push(strut(pt(a, r, yB(r)), pt(a2, r, yB(r)), 0.08, 4));
      }
    }
    dishG.add(new THREE.Mesh(mergeGeometries(parts), trussMat));
    dishG.add(new THREE.Mesh(new THREE.CylinderGeometry(2.0, 2.3, 2.6, 28).translate(0, -1.3, 0), paintMat));
  }
  // cradle, elevation shaft, counterweight
  elG.add(new THREE.Mesh(merge([
    new THREE.CylinderGeometry(0.5, 0.5, 8.0, 16).rotateZ(Math.PI / 2),
    box(6.0, 1.4, 2.4, 0, 0.9, 0), box(0.6, 3.2, 0.6, -1.8, -1.2, 0), box(0.6, 3.2, 0.6, 1.8, -1.2, 0),
    box(4.8, 2.2, 2.6, 0, -3.1, 0),
  ]), paintMat));
  // quadripod + feed cabin
  const FOCUS = new V3(0, F, 0);
  let horn;
  {
    const parts = [], legs = [];
    for (let k = 0; k < 4; k++) {
      const a = Math.PI / 4 + k * Math.PI / 2;
      const rr = RD - 0.35;
      const bot = new V3(Math.cos(a) * rr, rr * rr / (4 * F), Math.sin(a) * rr);
      const top = new V3(Math.cos(a) * 0.75, F + 0.25, Math.sin(a) * 0.75);
      parts.push(strut(bot, top, 0.18, 8));
      legs.push({ bot, top });
    }
    for (let k = 0; k < 4; k++) {
      const L1 = legs[k], L2 = legs[(k + 1) % 4];
      parts.push(strut(L1.bot.clone().lerp(L1.top, 0.55), L2.bot.clone().lerp(L2.top, 0.55), 0.08, 5));
    }
    const legMat = glowable(paintMat.clone());
    dishG.add(new THREE.Mesh(mergeGeometries(parts), legMat));
    dishG.add(new THREE.Mesh(merge([
      new THREE.CylinderGeometry(0.95, 0.95, 1.9, 20).translate(0, F + 1.05, 0),
      new THREE.CylinderGeometry(1.15, 1.15, 0.2, 20).translate(0, F + 2.05, 0),
    ]), legMat));
    const hornMat = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, roughness: 0.4, metalness: 0.6, emissive: new THREE.Color(0.4, 1.0, 0.95), emissiveIntensity: 0, side: THREE.DoubleSide });
    horn = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.72, 0.8, 20, 1, true).translate(0, F - 0.3, 0), hornMat);
    dishG.add(horn);
  }
  const feedGlow = new THREE.Sprite(additive(new THREE.Color(0.5, 1.0, 0.95)));
  feedGlow.position.copy(FOCUS).add(new V3(0, 0.6, 0));
  feedGlow.renderOrder = 5;
  dishG.add(feedGlow);
  const led = new THREE.Sprite(additive(new THREE.Color(0.2, 1.0, 0.3)));
  led.position.set(0.0, F + 2.3, 0);
  led.scale.setScalar(0.6);
  dishG.add(led);
  // red obstruction light on top of the feed cabin, in step with the mast
  const dishBeacon = new THREE.Sprite(additive(new THREE.Color(1.0, 0.1, 0.05).multiplyScalar(2.4)));
  dishBeacon.position.set(0, F + 2.45, 0);
  dishBeacon.scale.setScalar(1.6);
  dishBeacon.renderOrder = 6;
  dishG.add(dishBeacon);
  const feedLight = new THREE.PointLight(0x7ff7e8, 0, 150, 2);
  feedLight.position.copy(FOCUS).add(new V3(0, -2.0, 0));
  dishG.add(feedLight);

  // =========================================================================
  // control hut + mast
  // =========================================================================
  const hutG = new THREE.Group();
  hutG.position.set(HUT.x, groundH(HUT.x, HUT.z), HUT.z);
  hutG.rotation.y = deg(-28);
  scene.add(hutG);
  let blindMat;
  {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 64;
    const x = c.getContext('2d');
    for (let i = 0; i < 256; i++) {
      const v = 130 + 60 * (0.5 + 0.5 * Math.sin(i / 256 * Math.PI * 2 * 24));
      x.fillStyle = `rgb(${v},${v + 3},${v + 6})`;
      x.fillRect(i, 0, 1, 64);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(2, 1);
    hutG.add(new THREE.Mesh(new THREE.BoxGeometry(7.5, 3.0, 4.6).translate(0, 1.5, 0),
      new THREE.MeshLambertMaterial({ color: 0x9aa1a8, map: tex })));
    const roof = new THREE.Mesh(new THREE.BoxGeometry(8.1, 0.22, 5.3).translate(0, 3.12, 0), darkMat);
    roof.rotation.x = deg(-3);
    hutG.add(roof);
    hutG.add(new THREE.Mesh(merge([box(1.3, 0.9, 0.9, -2.4, 0.45, -2.75), box(1.0, 2.1, 0.08, -3.76, 1.05, 0.6)]), darkMat));
    const p2 = [];
    for (let i = 0; i <= 8; i++) { const r = 0.05 + 0.55 * i / 8; p2.push(new THREE.Vector2(r, r * r / 0.9)); }
    const sd = paintMat.clone();
    sd.side = THREE.DoubleSide;
    const sdish = new THREE.Mesh(new THREE.LatheGeometry(p2, 24), sd);
    sdish.position.set(2.6, 3.9, -1.2);
    sdish.rotation.set(deg(-50), deg(30), 0);
    hutG.add(sdish);
    hutG.add(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.8).translate(2.6, 3.5, -1.2), darkMat));
    hutG.add(new THREE.Mesh(merge([
      box(1.9, 0.1, 0.12, 1.4, 2.25, 2.33), box(1.9, 0.12, 0.2, 1.4, 1.15, 2.36),
      box(0.1, 1.1, 0.12, 0.5, 1.7, 2.33), box(0.1, 1.1, 0.12, 2.3, 1.7, 2.33),
      box(0.05, 1.0, 0.06, 1.4, 1.7, 2.33), box(1.7, 0.05, 0.06, 1.4, 1.85, 2.33),
    ]), darkMat));
    blindMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.35, 0.18, 0.08), fog: false });
    const blind = new THREE.Mesh(new THREE.PlaneGeometry(1.66, 0.3), blindMat);
    blind.position.set(1.4, 2.03, 2.315);
    hutG.add(blind);
  }
  const winMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.62, 0.28), fog: false });
  const winMesh = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 1.0), winMat);
  winMesh.position.set(1.4, 1.7, 2.31);
  hutG.add(winMesh);
  const winGlow = new THREE.Sprite(additive(new THREE.Color(1.0, 0.55, 0.22), { opacity: 0.35 }));
  winGlow.position.set(1.4, 1.7, 2.6);
  winGlow.scale.set(5.5, 3.6, 1);
  hutG.add(winGlow);
  const winLight = new THREE.PointLight(0xffa04a, 24, 32, 2);
  winLight.position.set(1.4, 1.7, 3.4);
  hutG.add(winLight);

  // mast: triangular lattice with two red obstruction lights
  const MAST = new V3(HUT.x - 6.5, 0, HUT.z + 4.5);
  const MAST_H = 17.0;
  {
    const parts = [];
    MAST.y = groundH(MAST.x, MAST.z);
    const w = 0.6;
    const leg = k => { const a = k / 3 * Math.PI * 2; return [Math.cos(a) * w, Math.sin(a) * w]; };
    for (let k = 0; k < 3; k++) {
      const [x1, z1] = leg(k), [x2, z2] = leg((k + 1) % 3);
      parts.push(strut(new V3(x1, 0, z1), new V3(x1 * 0.6, MAST_H, z1 * 0.6), 0.06, 4));
      const NSEG = 14;
      for (let s = 0; s < NSEG; s++) {
        const f0 = s / NSEG, f1 = (s + 1) / NSEG;
        const s0 = 1 - 0.4 * f0, s1 = 1 - 0.4 * f1;
        parts.push(strut(new V3(x1 * s0, f0 * MAST_H, z1 * s0), new V3(x2 * s1, f1 * MAST_H, z2 * s1), 0.035, 3));
      }
    }
    parts.push(strut(new V3(0, MAST_H, 0), new V3(0, MAST_H + 3.2, 0), 0.04, 4));
    parts.push(strut(new V3(0.2, MAST_H - 1, 0), new V3(0.2, MAST_H + 1.8, 0.1), 0.03, 3));
    const m = new THREE.Mesh(mergeGeometries(parts), darkMat);
    m.position.copy(MAST);
    scene.add(m);
  }
  const beacons = [];
  for (const [hgt, s] of [[MAST_H + 0.15, 2.6], [MAST_H * 0.5, 1.5]]) {
    const sp = new THREE.Sprite(additive(new THREE.Color(1.0, 0.1, 0.05).multiplyScalar(2.4)));
    sp.position.set(MAST.x, MAST.y + hgt, MAST.z);
    sp.scale.setScalar(s);
    sp.renderOrder = 6;
    scene.add(sp);
    beacons.push(sp);
  }
  // cable tray from the hut to the pedestal
  {
    const parts = [];
    const a = new V3(HUT.x + 2.8, 0, HUT.z - 1.0), b = new V3(-2.6, 0, 1.8);
    for (let i = 0; i <= 9; i++) {
      const p = a.clone().lerp(b, i / 9);
      parts.push(box(0.12, 0.7, 0.12, p.x, groundH(p.x, p.z) + 0.35, p.z));
    }
    parts.push(strut(new V3(a.x, groundH(a.x, a.z) + 0.72, a.z), new V3(b.x, groundH(b.x, b.z) + 0.72, b.z), 0.12, 4));
    scene.add(new THREE.Mesh(merge(parts), darkMat));
  }

  // =========================================================================
  // arrival: wavefronts falling out of the cluster, a faint shaft, sparks
  // =========================================================================
  const RING_N = 9, RING_GAP = 0.26, RING_TRAVEL = 1.12, RING_D0 = 900;
  const ringGeo = new THREE.RingGeometry(0.80, 1.0, 192, 1);
  const rings = [];
  for (let i = 0; i < RING_N; i++) {
    const mat = new THREE.ShaderMaterial({
      uniforms: { uA: { value: 0 } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
      vertexShader: 'varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: /* glsl */`
        uniform float uA; varying vec2 vP;
        void main() {
          float r = length(vP);
          float a = exp(-pow((r - 0.955) / 0.012, 2.0)) * 1.3
                  + exp(-pow((r - 0.90) / 0.008, 2.0)) * 0.45
                  + exp(-pow((r - 0.94) / 0.05, 2.0)) * 0.22;
          a *= smoothstep(0.80, 0.84, r) * (1.0 - smoothstep(0.99, 1.0, r));
          gl_FragColor = vec4(vec3(0.55, 1.0, 0.94) * a * uA * 0.75, 1.0);
        }`,
    });
    const m = new THREE.Mesh(ringGeo, mat);
    m.renderOrder = 4;
    m.frustumCulled = false;
    m.visible = false;
    scene.add(m);
    rings.push(m);
  }
  const beamU = { uA: { value: 0 }, uT: { value: 0 } };
  const BEAM_LEN = 900;
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(RD * 3.0, RD * 0.95, BEAM_LEN, 64, 1, true).translate(0, BEAM_LEN / 2, 0),
    new THREE.ShaderMaterial({
      uniforms: beamU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
      vertexShader: 'varying float vY; varying vec3 vN; varying vec3 vV; void main(){ vY = position.y; vec4 w = modelMatrix * vec4(position,1.0); vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - w.xyz); gl_Position = projectionMatrix * viewMatrix * w; }',
      fragmentShader: /* glsl */`
        uniform float uA, uT; varying float vY; varying vec3 vN; varying vec3 vV;
        void main() {
          float f = vY / ${BEAM_LEN.toFixed(1)};
          float facing = abs(dot(normalize(vN), normalize(vV)));
          float stripes = 0.6 + 0.4 * sin(vY * 0.07 + uT * 24.0);
          float a = uA * pow(facing, 3.0) * exp(-f * 3.0) * stripes * smoothstep(0.0, 0.03, f);
          gl_FragColor = vec4(vec3(0.4, 0.95, 0.9) * a * 0.05, 1.0);
        }`,
    }));
  beam.renderOrder = 3;
  beam.frustumCulled = false;
  scene.add(beam);
  const SPARK_N = 500;
  const sparkPos = new Float32Array(SPARK_N * 3);
  const sparkSeed = [];
  {
    const rnd = U.mulberry32(2026);
    for (let i = 0; i < SPARK_N; i++) sparkSeed.push({ a: rnd() * Math.PI * 2, r: Math.sqrt(rnd()), ph: rnd(), sp: 0.7 + 0.6 * rnd() });
  }
  const sparkGeo = new THREE.BufferGeometry();
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3));
  const sparkMat = new THREE.PointsMaterial({
    map: glowTex, color: new THREE.Color(0.5, 1.0, 0.95), size: 4, sizeAttenuation: false,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, opacity: 0,
  });
  const sparks = new THREE.Points(sparkGeo, sparkMat);
  sparks.frustumCulled = false;
  sparks.renderOrder = 4;
  scene.add(sparks);

  // =========================================================================
  // animation curves
  // =========================================================================
  // jerk-limited slew profile: velocity ramps up and down smoothly
  const PROF = new Float32Array(1001);
  {
    let s = 0;
    for (let i = 0; i <= 1000; i++) {
      const p = i / 1000;
      PROF[i] = s;
      s += smooth(0, 0.3, p) * (1 - smooth(0.7, 1, p));
    }
    for (let i = 0; i <= 1000; i++) PROF[i] /= PROF[1000];
  }
  const slewP = p => { const f = clamp(p) * 1000, i = Math.min(999, Math.floor(f)); return lerp(PROF[i], PROF[i + 1], f - i); };
  const wrapPi = a => Math.atan2(Math.sin(a), Math.cos(a));
  const AZ0 = deg(64), EL0 = deg(24);
  function dishPose(t) {
    const tg = targetAt(t);
    const tAz = Math.atan2(tg.x, tg.z), tEl = Math.asin(tg.y);
    const pAz = AZ0 + 0.004 * (t - SLEW.start), pEl = EL0 + 0.0015 * (t - SLEW.start);   // still tracking an earlier source
    const sa = slewP(prog(t, SLEW.start, SLEW.end));
    const se = slewP(prog(t, SLEW.start + 0.35, SLEW.end - 0.3));
    let az = pAz + wrapPi(tAz - pAz) * sa;
    let el = lerp(pEl, tEl, se);
    // the structure rings down when the brakes bite, and shudders as the drives engage
    const ring = (dt, amp, tau, hz) => dt > 0 ? amp * (1 - Math.exp(-dt / 0.12)) * Math.exp(-dt / tau) * Math.sin(dt * 2 * Math.PI * hz) : 0;
    el += ring(t - (SLEW.end - 0.3), deg(0.3), 0.5, 1.6);
    az += ring(t - (SLEW.end - 0.25), deg(0.22), 0.55, 1.3);
    el += ring(t - SLEW.start, deg(0.1), 0.3, 4.0);
    return { az, el };
  }
  const hash1 = n => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
  const FIRST_HIT = ARR.start + RING_TRAVEL;

  // C1 keyframe spline (Catmull-Rom tangents): keys = [[t, v], ...]
  function spline(keys) {
    const n = keys.length;
    const m = keys.map((k, i) => {
      const a = keys[Math.max(0, i - 1)], b = keys[Math.min(n - 1, i + 1)];
      return (b[1] - a[1]) / (b[0] - a[0]);
    });
    return t => {
      if (t <= keys[0][0]) return keys[0][1] + m[0] * (t - keys[0][0]);
      if (t >= keys[n - 1][0]) return keys[n - 1][1] + m[n - 1] * (t - keys[n - 1][0]);
      let i = 0;
      while (t > keys[i + 1][0]) i++;
      const [t0, v0] = keys[i], [t1, v1] = keys[i + 1], h = t1 - t0, u = (t - t0) / h;
      const u2 = u * u, u3 = u2 * u;
      return (2 * u3 - 3 * u2 + 1) * v0 + (u3 - 2 * u2 + u) * h * m[i] + (-2 * u3 + 3 * u2) * v1 + (u3 - u2) * h * m[i + 1];
    };
  }
  // camera: a low, slow orbit, looking up at the dish; always moving
  const camTh = spline([[54, 16], [58, 10], [62, 2], [65, -5], [68, -13], [71, -23], [74.8, -36]]);
  const camR = spline([[54, 62], [60, 60], [65, 60], [68, 61], [71, 64], [74.8, 66]]);
  const camH = spline([[54, 2.0], [60, 1.9], [65, 2.2], [68, 3.0], [71, 4.8], [74.8, 6.5]]);
  const camLook = spline([[54, 21], [59, 21.5], [62, 23], [64.5, 25], [66.5, 24.5], [68.5, 19.5], [71, 16], [74.8, 14]]);
  const camPos = new V3(), camTgt = new V3();
  function cameraAt(t) {
    const th = deg(camTh(t)), R = camR(t);
    camPos.set(Math.sin(th) * R, camH(t), Math.cos(th) * R);
    camPos.y += groundH(camPos.x, camPos.z);
    camTgt.set(-1.5, camLook(t), 0);
    // shake: a hit when the first wavefront lands, then a rumble
    const amp = smooth(FIRST_HIT - 0.04, FIRST_HIT + 0.04, t) * (0.7 * Math.exp(-(t - FIRST_HIT) / 0.3) + 0.22 * (1 - smooth(FIRST_HIT + 0.4, ARR.end + 0.4, t)))
      + 0.03 * smooth(ARR.start - 0.2, ARR.start + 0.5, t) * (1 - smooth(ARR.end, ARR.end + 1, t));
    if (amp > 0) {
      const f = 17;
      camPos.x += (U.vnoise3(t * f, 0.5, 1.2) - 0.5) * amp * 1.0;
      camPos.y += (U.vnoise3(t * f, 4.5, 2.7) - 0.5) * amp * 0.8;
      camTgt.x += (U.vnoise3(t * f, 7.5, 5.1) - 0.5) * amp * 2.0;
      camTgt.y += (U.vnoise3(t * f, 9.5, 8.3) - 0.5) * amp * 2.0;
    }
    camTgt.x += (U.vnoise3(t * 0.35, 11.0, 0) - 0.5) * 0.6;       // hand-held breathing
    camTgt.y += (U.vnoise3(t * 0.3, 13.0, 0) - 0.5) * 0.5;
  }

  // =========================================================================
  // per-frame update
  // =========================================================================
  const tmpM = new THREE.Matrix4(), tmpV = new V3(), tmpV2 = new V3(), Z = new V3(0, 0, 1);
  const boreW = new V3(), apertureW = new V3(), focusW = new V3();

  function update(t) {
    // --- sky
    tmpM.makeRotationFromQuaternion(skyQ(t));
    starGroup.matrix.copy(tmpM);
    starGroup.matrixWorldNeedsUpdate = true;
    skyU.uW2G.value.setFromMatrix4(tmpM).transpose();
    starU.uTime.value = t;
    skyU.uCloudOff.value.set(0.31 + t * 0.0009, 0.57 + t * 0.00028);
    const clDir = targetAt(t);
    clusterGlow.position.copy(clDir).multiplyScalar(18000);
    clusterGlow.scale.setScalar(18000 * 0.03);

    // --- dish
    const { az, el } = dishPose(t);
    azG.rotation.y = az;
    elG.rotation.x = Math.PI / 2 - el;
    scene.updateMatrixWorld(true);
    boreW.set(0, 1, 0).transformDirection(dishG.matrixWorld);
    apertureW.set(0, RD * RD / (4 * F), 0).applyMatrix4(dishG.matrixWorld);
    focusW.copy(FOCUS).applyMatrix4(dishG.matrixWorld);

    // --- arrival
    const a0 = ARR.start;
    let hits = 0;
    for (let i = 0; i < RING_N; i++) {
      const s = a0 + i * RING_GAP;
      const u = (t - s) / RING_TRAVEL;
      const m = rings[i];
      m.visible = u >= 0 && u <= 1.02;
      if (m.visible) {
        const uu = clamp(u);
        const dd = RING_D0 * Math.pow(1 - uu, 2.4) + 1.0;
        m.position.copy(apertureW).addScaledVector(boreW, dd);
        m.quaternion.setFromUnitVectors(Z, boreW);
        m.scale.setScalar(lerp(RD * 3.2, RD * 0.98, Math.pow(uu, 0.7)));
        m.material.uniforms.uA.value = smooth(0, 0.15, u) * (1 - smooth(0.93, 1.02, u)) * (0.5 + 0.7 * uu);
      }
      if (t >= s + RING_TRAVEL) hits += Math.exp(-(t - s - RING_TRAVEL) / 0.22);
    }
    const lastArrive = a0 + (RING_N - 1) * RING_GAP + RING_TRAVEL;
    const glow = smooth(FIRST_HIT - 0.3, FIRST_HIT + 0.2, t) * (1 - 0.82 * smooth(lastArrive, lastArrive + 2.4, t)) + 0.22 * Math.min(1.5, hits);
    const wave = smooth(FIRST_HIT - 0.1, FIRST_HIT + 0.2, t) * (1 - smooth(lastArrive - 0.2, lastArrive + 1.2, t));
    const hum = smooth(lastArrive, lastArrive + 1.5, t) * (0.05 + 0.02 * Math.sin(t * 5.1));   // it keeps listening
    const G = glow + hum;
    dishU.uGlow.value = G * 0.8;
    dishU.uBack.value = G * 0.3;
    dishU.uWave.value = wave * 0.9;
    dishU.uWavePh.value = t * 13.0;
    rimMesh.material.emissive.setRGB(0.4, 1.0, 0.92).multiplyScalar(G * 1.3);
    horn.material.emissiveIntensity = G * 2.5;
    feedGlow.material.opacity = clamp(G * 1.2);
    feedGlow.scale.setScalar(2.5 + 7 * G + 3 * Math.min(1, hits));
    feedLight.intensity = 1600 * G;
    const pre = smooth(62.8, 64.2, t) * (1 - 0.65 * smooth(66.5, 70, t));
    skyU.uFlash.value = pre * 0.4 + wave * 0.8 + 0.3 * Math.min(1, hits);
    skyU.uFlashDir.value.copy(clDir);
    skyU.uCloudLit.value = 0.03 * (pre + wave);
    clusterGlow.material.color.setRGB(0.3, 0.29, 0.25).multiplyScalar(1 + 2.5 * pre + 4 * wave);
    // receiver LED: idle green blink, then solid cyan
    const idle = (Math.floor(t / 0.9) % 2 === 0) ? 1 : 0.2;
    const armed = smooth(FIRST_HIT - 0.1, FIRST_HIT, t);
    led.material.color.setRGB(lerp(0.2 * idle, 0.8, armed), lerp(1.2 * idle, 2.0, armed), lerp(0.3 * idle, 1.9, armed));

    const beamA = smooth(a0 - 0.2, a0 + 0.6, t) * (1 - smooth(lastArrive - 0.3, lastArrive + 1.0, t));
    beam.visible = beamA > 0.001;
    beamU.uA.value = beamA;
    beamU.uT.value = t;
    beam.position.copy(apertureW);
    beam.quaternion.setFromUnitVectors(UP, boreW);
    sparks.visible = beamA > 0.001;
    if (sparks.visible) {
      const e1 = tmpV.crossVectors(boreW, UP).normalize();
      const e2 = tmpV2.crossVectors(boreW, e1).normalize();
      for (let i = 0; i < SPARK_N; i++) {
        const s = sparkSeed[i];
        const u = ((s.ph - (t - a0) * 0.9 * s.sp) % 1 + 1) % 1;
        const d = 600 * Math.pow(u, 1.8) + 2;
        const rr = s.r * RD * lerp(0.9, 3.0, u);
        const ca = Math.cos(s.a) * rr, sa = Math.sin(s.a) * rr;
        sparkPos[i * 3] = apertureW.x + boreW.x * d + e1.x * ca + e2.x * sa;
        sparkPos[i * 3 + 1] = apertureW.y + boreW.y * d + e1.y * ca + e2.y * sa;
        sparkPos[i * 3 + 2] = apertureW.z + boreW.z * d + e1.z * ca + e2.z * sa;
      }
      sparkGeo.attributes.position.needsUpdate = true;
      sparkMat.opacity = beamA * 0.8;
    }

    // --- hut window: fluorescent flicker at the alarm, then a red strobe
    let win = 1.0;
    if (t >= ALARM) {
      const h = hash1(Math.floor((t - ALARM) * 20));
      win = lerp(1.0, h < 0.45 ? 0.08 + 0.25 * h : 1.1 + 0.8 * h, 1 - smooth(ALARM + 1.2, ALARM + 1.8, t));
    }
    const strobe = (t >= ALARM ? smooth(ALARM, ALARM + 0.3, t) : 0) * Math.pow(0.5 + 0.5 * Math.sin((t - ALARM) * Math.PI * 2 * 1.25), 3);
    winMat.color.setRGB(1.0 * win + 1.3 * strobe, 0.62 * win + 0.07 * strobe, 0.28 * win + 0.05 * strobe).multiplyScalar(2.4);
    blindMat.color.setRGB(0.35 * win + 0.3 * strobe, 0.18 * win, 0.08 * win);
    winGlow.material.opacity = 0.35 * win + 0.35 * strobe;
    winGlow.material.color.setRGB(1.0, 0.55 * win / (win + strobe + 1e-3) + 0.05, 0.22 * win / (win + strobe + 1e-3));
    winLight.intensity = 24 * win + 30 * strobe;
    winLight.color.setRGB(1.0, lerp(0.63, 0.12, strobe / (win + strobe + 1e-3)), lerp(0.29, 0.08, strobe / (win + strobe + 1e-3)));

    // --- beacon (period 1.5 s, then 0.42 s after the alarm)
    const phase = t < ALARM ? (t - 40) / 1.5 : (ALARM - 40) / 1.5 + (t - ALARM) / 0.42;
    const fr = phase - Math.floor(phase), fr2 = (phase + 0.5) - Math.floor(phase + 0.5);
    beacons[0].material.opacity = smooth(0.0, 0.05, fr) * (1 - smooth(0.16, 0.34, fr));
    beacons[1].material.opacity = 0.8 * smooth(0.0, 0.05, fr2) * (1 - smooth(0.16, 0.34, fr2));
    dishBeacon.material.opacity = beacons[0].material.opacity;

    // --- camera
    cameraAt(t);
    camera.position.copy(camPos);
    camera.up.set(0, 1, 0);
    camera.lookAt(camTgt);
    camera.rotateZ((U.vnoise3(t * 0.25, 21.0, 0) - 0.5) * deg(1.2));
    sky.position.copy(camera.position);
    // rim light from behind the dish, relative to the camera
    rim.position.set(-camPos.x * 0.6 + 40, 120, -camPos.z * 0.6 - 60);
    rim.target.position.set(0, 12, 0);
    fill.position.set(camPos.x * 0.8 + 30, 25, camPos.z * 0.8);
    fill.target.position.set(0, 16, 0);

    // --- the lower third calms down while narration is up
    const narr = Math.max(U.window01(t, 55.3, 62.4, 0.6, 0.8), U.window01(t, 67.3, 73.2, 0.6, 0.8));
    aa.uniforms.uLow.value.set(0.70, 0.45 + 0.25 * narr);

    aa.render(scene, camera, t);
  }

  return {
    scene: aa.scene, camera: aa.camera, update,
    bloom(t) {
      const b = smooth(FIRST_HIT - 0.3, FIRST_HIT + 0.2, t) * (1 - 0.75 * smooth(ARR.end, ARR.end + 2.5, t));
      return { strength: 0.7 + 0.35 * b, radius: 0.55 + 0.1 * b, threshold: 0.55 - 0.05 * b };
    },
  };
}
