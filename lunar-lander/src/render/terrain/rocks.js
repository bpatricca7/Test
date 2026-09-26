// Boulders: instanced rock meshes placed EXACTLY where moon.js makes them collidable.
//
// Each boulder variant's mesh is built from moon.js boulderProfile()/boulderEdge() (the same function
// terrainHeight() uses for collision, including the regolith fillet banked against the base), so a
// footpad resting on a rock touches what you see. Only a skirt below ground is render-only.
// Rocks are draped onto the local slope of the ground (per-instance gradient), as the collision
// profile is added on top of the terrain height.
//
// Look (Apollo surface photography): dust-mantled, dark grey-brown basalt/breccia blocks, sub-rounded to
// angular with rounded edges, smooth-shaded with fine pitted (vesicular) texture, a slightly darker
// albedo than the mature soil around them, a fillet of soil at the base; they cast long shadows on the
// ground and on each other through rockShadow.js.
//
// Instances come from the terrain chunks that own boulders (quadtree levels BOULDER_LEVELS; chunks only
// exist near the camera, so rocks appear within ~0.3–1.5 km depending on size). Instance matrices are
// relative to a double-precision anchor near the camera (float32-safe), re-anchored as the camera moves.

import * as THREE from 'three';
import { LAYERS } from '../../core/constants.js';
import { boulderProfile, boulderEdge, BOULDER_VARIANTS, BOULDER_FILLET } from '../../world/moon.js';
import { BOULDER_STRIDE, SHADOW_CLAMP } from './chunkGen.js';
import { LUNAR_GLSL } from './terrainMaterial.js';

const NVAR = BOULDER_VARIANTS.length;

/**
 * Rock mesh for one variant in normalised units: footprint radius 1 (x/z), height 1 (y).
 * Local polar angle theta runs from +X toward -Z (the boulder's own x axis toward its y axis).
 * Rings: apex, NR rings over the rock body (denser toward the steep base), NF fillet rings out to the
 * fillet's end (slightly sunk into the ground), then a skirt ring well below ground.
 * Attribute `fil`: 1 on the soil fillet, 0 on rock (the shader shades the fillet as regolith).
 */
function buildRockGeometry(vi, NR, NF, NS) {
  const F = BOULDER_FILLET;
  const qs = [];
  for (let k = 1; k <= NR; k++) qs.push(0.985 * Math.pow(k / NR, 0.62));
  for (let k = 1; k <= NF; k++) qs.push(1 + (F.reach * k) / NF);
  const pos = [0, boulderProfile(vi, 0, 1, 0), 0];
  const fil = [0];
  for (let k = 0; k <= qs.length; k++) {
    for (let m = 0; m < NS; m++) {
      const th = (m / NS) * Math.PI * 2;
      const c = Math.cos(th);
      const s = Math.sin(th);
      const e = boulderEdge(vi, c, s);
      if (k < qs.length) {
        const q = qs[k];
        const rr = q * e;
        let h = boulderProfile(vi, rr, c, s);
        if (k === qs.length - 1) h = -0.05; // outermost fillet ring: just under the soil
        pos.push(rr * c, h, -rr * s);
        // fillet where the profile is the fillet's (outside the rock body)
        fil.push(q >= 1 ? 1 : q > 0.9 && h <= F.height * 1.05 ? 1 : 0);
      } else {
        pos.push(1.02 * e * c, -0.6, -1.02 * e * s); // skirt under the soil (hides gaps on uneven ground)
        fil.push(1);
      }
    }
  }
  const ring = (k) => 1 + (k - 1) * NS; // first vertex of ring k (k >= 1); 0 = apex
  const nRings = qs.length + 1;
  const idx = [];
  for (let m = 0; m < NS; m++) idx.push(0, ring(1) + m, ring(1) + ((m + 1) % NS));
  for (let k = 1; k < nRings; k++) {
    for (let m = 0; m < NS; m++) {
      const a = ring(k) + m;
      const b = ring(k) + ((m + 1) % NS);
      const c = ring(k + 1) + m;
      const d = ring(k + 1) + ((m + 1) % NS);
      idx.push(a, c, b);
      idx.push(b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('fil', new THREE.Float32BufferAttribute(fil, 1));
  g.setIndex(idx);
  g.computeVertexNormals(); // smooth: rounded, weathered blocks (fine texture comes from the shader)
  return g;
}

// Shared vertex stage (also used by the shadow-map pass so shadows match the draped meshes).
const ROCK_VERT = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  attribute vec4 aRock;   // x: sun-horizon delta, y: tint, z: footprint radius r (m), w: height H (m)
  attribute vec4 aRock2;  // xy: ground slope along the instance x / z axes, z: ground albedo, w: curvature (1/m)
  attribute float fil;
  varying vec3 vPos;
  varying vec3 vObj;
  varying vec3 vNrm;
  varying vec4 vRock;
  varying vec4 vRock2;
  varying float vFil;
  varying float vUpY;
  void main() {
    mat3 m = mat3(instanceMatrix);
    vec3 ax = normalize(m[1]);                  // local up
    // drape onto the local ground slope (the collision profile rides on the terrain height)
    vec2 lm = position.xz * aRock.z;            // metres from the centre
    float dh = dot(aRock2.xy, lm) + 0.5 * aRock2.w * dot(lm, lm);
    vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
    wp.xyz += ax * dh;
    vPos = wp.xyz;
    vObj = vec3(position.x * aRock.z, position.y * aRock.w, position.z * aRock.z) + aRock.y * 37.0;
    // normal: inverse-transpose of (rotation x scale), then the shear of the drape
    vec3 sc = vec3(aRock.z, aRock.w, aRock.z);
    vec3 nm = normal / sc;                      // object -> metres (inverse-transpose of the scale)
    nm.x -= (aRock2.x + aRock2.w * lm.x) * nm.y;
    nm.z -= (aRock2.y + aRock2.w * lm.y) * nm.y;
    vec3 nw = m * (nm / sc);                    // m / scale = the instance rotation
    vNrm = mat3(modelMatrix) * nw;
    vUpY = normal.y;
    vRock = aRock;
    vRock2 = aRock2;
    vFil = fil;
    gl_Position = projectionMatrix * viewMatrix * wp;
    #include <logdepthbuf_vertex>
  }
`;

function rockFrag(vesselGLSL, shadowGLSL) {
  return /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_fragment>
  ${vesselGLSL}
  ${shadowGLSL}
  ${LUNAR_GLSL}
  uniform float uFill;
  // vesicles: small round pits (cellular), 0..1 inside a pit
  float pits(vec3 x) {
    vec3 b = floor(x - 0.5);
    vec3 l = x - b;
    float d = 4.0;
    for (int k = 0; k < 8; k++) {
      vec3 o = vec3(float(k & 1), float((k >> 1) & 1), float(k >> 2));
      vec4 r = cellRand(b + o + 41.0);
      vec3 q = o + r.xyz - l;
      float rr = 0.12 + 0.22 * r.w * r.w;
      d = min(d, dot(q, q) / (rr * rr));
    }
    return 1.0 - smoothstep(0.55, 1.0, d);
  }
  varying vec3 vPos;
  varying vec3 vObj;
  varying vec3 vNrm;
  varying vec4 vRock;
  varying vec4 vRock2;
  varying float vFil;
  varying float vUpY;
  void main() {
    #include <logdepthbuf_fragment>
    vec3 up = normalize(uCamMCI + vPos);
    vec3 V = normalize(-vPos);
    vec3 L = uSunDir;
    vec3 N = safeNormalize(vNrm, up);
    float fil = clamp(vFil, 0.0, 1.0);
    // fine texture: knobs, pits and grain (metres), faded with the pixel footprint (no aliasing)
    float fw = max(length(fwidth(vObj)), 1e-5);
    float Hb = 0.0;
    float a1 = 1.0 - smoothstep(0.02, 0.06, fw);
    float a2 = 1.0 - smoothstep(0.008, 0.025, fw);
    float a3 = 1.0 - smoothstep(0.003, 0.01, fw);
    Hb += 0.035 * (valueNoise(vObj * 4.0) - 0.5) * (1.0 - smoothstep(0.08, 0.25, fw));
    Hb += 0.012 * (valueNoise(vObj * 13.0 + 3.1) - 0.5) * a1;
    // vesicles: small round pits (vesicular basalt)
    float ves = a1 > 0.0 ? pits(vObj * 14.0) * smoothstep(0.55, 0.8, valueNoise(vObj * 2.5 + 5.0)) : 0.0;
    Hb -= 0.008 * ves * a1;
    Hb += 0.0015 * (valueNoise(vObj * 95.0 + 1.9) - 0.5) * a3;
    N = bumpNormal(vPos, N, Hb * (1.0 - fil));
    if (dot(N, V) < 0.0) N = normalize(N + V * (0.02 - dot(N, V)));
    float nUp = dot(N, up);
    // albedo: slightly darker than the mature soil, grey-brown, per-rock and mottled variation
    float Ag = vRock2.z;                         // ground albedo at the rock
    float mott = valueNoise(vObj * 2.3 + 11.0) - 0.5;
    float mott2 = valueNoise(vObj * 9.0 + 4.0) - 0.5;
    float Ar = Ag * (0.72 + 0.3 * vRock.y) * (1.0 + 0.28 * mott + 0.16 * mott2 * a1 - 0.18 * ves * a1);
    // bright plagioclase specks / dark pyroxene grains (only while resolved)
    float spk = valueNoise(vObj * 140.0 + 2.2);
    Ar *= 1.0 + a3 * (0.35 * smoothstep(0.78, 0.92, spk) - 0.15 * smoothstep(0.35, 0.15, spk));
    vec3 tintR = mix(vec3(0.93, 0.93, 0.93), vec3(1.0, 0.93, 0.84), 0.5 + 0.5 * vRock.y);
    // dust mantle on upward-facing parts: soil-coloured, like the ground
    float dusty = smoothstep(0.55, 0.92, nUp) * (0.55 + 0.45 * valueNoise(vObj * 6.0 + 2.0));
    vec3 tintSoil = vec3(1.0, 0.955, 0.9);
    float A = mix(Ar, Ag * 0.95, dusty * 0.7);
    vec3 tint = mix(tintR, tintSoil, dusty * 0.7);
    // soil fillet at the base: regolith (albedo & tint of the ground)
    A = mix(A, Ag, fil);
    tint = mix(tint, tintSoil, fil);
    // terrain shadow at the rock (baked horizon), vessel shadow, other rocks' shadows
    float vis = clamp(0.5 - vRock.x / 0.012, 0.0, 1.0) * vesselShadow(vPos) * rockShadow(vPos + N * 0.06, 0.3);
    // rock faces scatter less backward than fluffy regolith: blend lunar & Lambert (the fillet is soil)
    float mu0 = max(dot(N, L), 0.0);
    float direct = mix(lunarReflectance(N, L, V), mu0 * 0.8, 0.5 * (1.0 - fil)) * vis;
    // light from the sunlit ground (lower faces) + faint surroundings; crevices near the base occluded
    float sinE = max(dot(L, up), 0.0);
    float occl = mix(0.55, 1.0, smoothstep(-0.2, 0.6, vUpY));
    float ground = 0.08 * sinE * 0.6 * clamp(0.5 - 0.5 * nUp, 0.0, 1.0);
    float fill = uFill * sinE * (0.5 + 0.5 * nUp);
    vec3 col = max(uSunColor * (uSunI / PI) * A * tint * (direct + (ground + fill) * occl), vec3(0.0));
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;
}

const DEPTH_FRAG = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_fragment>
  void main() {
    #include <logdepthbuf_fragment>
    gl_FragColor = vec4(1.0);
  }
`;

/**
 * Rock instances manager.
 * @param {object} ctx RenderContext
 * @param {object} lunar shared lighting uniforms
 * @param {object} shadow rockShadow.js instance (its scene receives the shadow-casting twins)
 */
export function createRocks(ctx, lunar, shadow) {
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...lunar, ...ctx.vesselShadow.uniforms, ...shadow.uniforms },
    vertexShader: ROCK_VERT,
    fragmentShader: rockFrag(ctx.vesselShadow.glsl, shadow.glsl),
    extensions: { derivatives: true },
  });
  mat.name = 'LunarRock';
  const depthMat = new THREE.ShaderMaterial({ vertexShader: ROCK_VERT, fragmentShader: DEPTH_FRAG, colorWrite: false });
  depthMat.name = 'LunarRockDepth';
  depthMat.side = THREE.DoubleSide;
  const group = new THREE.Group();
  group.name = 'rocks';
  ctx.scene.add(group);
  // two levels of detail per variant: ~1300 triangles near the camera, ~170 further away
  const LODS = 2;
  const geos = [];
  for (let v = 0; v < NVAR; v++) geos.push([buildRockGeometry(v, 14, 3, 36), buildRockGeometry(v, 5, 1, 12)]);
  const meshes = []; // [variant * LODS + lod]
  const twins = [];
  const anchor = new THREE.Vector3(Infinity, 0, 0);
  const lastBuildCam = new THREE.Vector3(Infinity, 0, 0);
  let lastBuildT = 0;
  let signature = NaN;
  let count = 0;
  let version = 0;

  const _m = new THREE.Matrix4();
  const _x = new THREE.Vector3();
  const _y = new THREE.Vector3();
  const _z = new THREE.Vector3();
  const _e = new THREE.Vector3();
  const _n = new THREE.Vector3();
  const _p = new THREE.Vector3();

  function ensureMesh(slot, n) {
    let m = meshes[slot];
    if (m && m.instanceMatrix.count >= n) return m;
    if (m) {
      group.remove(m);
      shadow.group.remove(twins[slot]);
      m.geometry.dispose();
      m.dispose();
    }
    const cap = Math.max(128, Math.ceil(n * 1.5));
    const g = geos[Math.floor(slot / LODS)][slot % LODS].clone(); // own copy carries the instanced attributes
    g.setAttribute('aRock', new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4));
    g.setAttribute('aRock2', new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4));
    m = new THREE.InstancedMesh(g, mat, cap);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.frustumCulled = false;
    m.layers.set(LAYERS.WORLD);
    m.count = 0;
    meshes[slot] = m;
    group.add(m);
    // shadow-casting twin: same geometry & instance buffers, depth-only material, private scene
    const t = new THREE.InstancedMesh(g, depthMat, cap);
    t.instanceMatrix = m.instanceMatrix;
    t.frustumCulled = false;
    t.count = 0;
    twins[slot] = t;
    shadow.group.add(t);
    return m;
  }

  // Visible range grows with rock size (a 3 m block matters at 1.2 km, a 0.4 m one only nearby).
  const maxDist = (r) => 120 + 750 * r;
  const lod0Dist = (r) => 25 + 90 * r;

  /** Rebuild all instances from the boulder chunks `chunks` ([{key, center: Vector3 (MCI), boulders}]). */
  function rebuild(chunks, camMCI) {
    anchor.copy(camMCI);
    lastBuildCam.copy(camMCI);
    const nSlots = NVAR * LODS;
    const slotOf = [];
    const per = new Array(nSlots).fill(0);
    for (const c of chunks) {
      const b = c.boulders;
      for (let k = 0; k < b.length; k += BOULDER_STRIDE) {
        const dx = c.center.x + b[k] - camMCI.x;
        const dy = c.center.y + b[k + 1] - camMCI.y;
        const dz = c.center.z + b[k + 2] - camMCI.z;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        const r = b[k + 3];
        let slot = -1;
        if (d < maxDist(r)) slot = (b[k + 5] | 0) * LODS + (d < lod0Dist(r) ? 0 : 1);
        slotOf.push(slot);
        if (slot >= 0) per[slot]++;
      }
    }
    const fill = new Array(nSlots).fill(0);
    for (let q = 0; q < nSlots; q++) if (per[q]) ensureMesh(q, per[q]);
    count = 0;
    let si = 0;
    for (const c of chunks) {
      const b = c.boulders;
      for (let k = 0; k < b.length; k += BOULDER_STRIDE) {
        const slot = slotOf[si++];
        if (slot < 0) continue;
        const m = meshes[slot];
        // MCI base centre -> anchor-relative; local frame = east/up/north rotated by psi (as moon.js)
        _p.set(c.center.x + b[k], c.center.y + b[k + 1], c.center.z + b[k + 2]);
        _y.copy(_p).normalize(); // local up
        _e.set(-_y.y, _y.x, 0);
        if (_e.lengthSq() < 1e-12) _e.set(0, 1, 0);
        _e.normalize();
        _n.crossVectors(_y, _e); // north
        const cps = b[k + 6];
        const sps = b[k + 7];
        _x.copy(_e).multiplyScalar(cps).addScaledVector(_n, sps); // rotated "east"
        _z.crossVectors(_x, _y); // = -(rotated north)
        const r = b[k + 3];
        const H = b[k + 4];
        _m.makeBasis(_x.multiplyScalar(r), _y.multiplyScalar(H), _z.multiplyScalar(r));
        _m.setPosition(_p.sub(anchor));
        const i = fill[slot]++;
        m.setMatrixAt(i, _m);
        const a = m.geometry.attributes.aRock.array;
        a[i * 4] = Math.min(SHADOW_CLAMP, Math.max(-SHADOW_CLAMP, b[k + 8]));
        a[i * 4 + 1] = b[k + 9];
        a[i * 4 + 2] = r;
        a[i * 4 + 3] = H;
        const a2 = m.geometry.attributes.aRock2.array;
        // ground gradient in the rotated frame: along instance x (rotated east) and instance z (-north')
        const ge = b[k + 10];
        const gn = b[k + 11];
        a2[i * 4] = ge * cps + gn * sps;
        a2[i * 4 + 1] = -(-ge * sps + gn * cps);
        a2[i * 4 + 2] = b[k + 12];
        a2[i * 4 + 3] = b[k + 13];
        count++;
      }
    }
    for (let q = 0; q < nSlots; q++) {
      const m = meshes[q];
      if (!m) continue;
      m.count = fill[q];
      twins[q].count = fill[q];
      m.instanceMatrix.needsUpdate = true;
      m.geometry.attributes.aRock.needsUpdate = true;
      m.geometry.attributes.aRock2.needsUpdate = true;
    }
    version++;
  }

  return {
    group,
    /** @returns {number} number of rock instances currently drawn */
    get count() {
      return count;
    },
    /** MCI anchor of the instance matrices. */
    anchor,
    /** Increments whenever the instances are rebuilt. */
    get version() {
      return version;
    },
    /**
     * @param {object} frame FrameContext
     * @param {Array} chunks boulder-owning chunks in use this frame
     * @param {number} [sig] numeric signature of the chunk set (rebuild when it changes)
     */
    update(frame, chunks, sig) {
      if (sig === undefined) {
        sig = chunks.length;
        for (const c of chunks) sig = (Math.imul(sig ^ (c.id | 0), 0x9e3779b1) + (c.id | 0)) | 0;
      }
      const now = performance.now();
      const moved = lastBuildCam.distanceTo(frame.cameraMCI);
      // rebuild when the set of rock chunks changes, or (throttled) when the camera has moved enough
      // for distance culling / LOD to change
      if (sig !== signature || (moved > 12 && now - lastBuildT > 250) || moved > 1500) {
        signature = sig;
        lastBuildT = now;
        rebuild(chunks, frame.cameraMCI);
      }
      group.position.copy(anchor).sub(frame.origin);
    },
  };
}
