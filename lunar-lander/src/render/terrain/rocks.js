// Boulders: instanced, faceted rock meshes placed EXACTLY where moon.js makes them collidable.
//
// Each boulder variant's mesh is built from moon.js boulderProfile()/boulderEdge() (the same function
// terrainHeight() uses for collision), so a footpad resting on a rock touches what you see. Only
// a thin skirt below ground and a few percent of facet jitter are render-only.
//
// Instances come from the terrain chunks that own boulders (quadtree levels BOULDER_LEVELS; chunks only
// exist near the camera, so rocks appear within ~0.3–1.5 km depending on size). Instance matrices are
// relative to a double-precision anchor near the camera (float32-safe), re-anchored as the camera moves.

import * as THREE from 'three';
import { LAYERS } from '../../core/constants.js';
import { boulderProfile, boulderEdge, BOULDER_VARIANTS } from '../../world/moon.js';
import { BOULDER_STRIDE, SHADOW_CLAMP } from './chunkGen.js';
import { LUNAR_GLSL } from './terrainMaterial.js';

const NVAR = BOULDER_VARIANTS.length;

// Deterministic small hash for mesh jitter.
function jitter(a, b, c) {
  let h = Math.imul(a + 1, 0x9e3779b1) ^ Math.imul(b + 7, 0x85ebca77) ^ Math.imul(c + 3, 0xc2b2ae3d);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h ^= h >>> 13;
  return ((h >>> 0) / 4294967296) * 2 - 1;
}

/**
 * Rock mesh for one variant in normalised units: footprint radius 1 (x/z), height 1 (y).
 * Local polar angle theta runs from +X toward -Z (east -> north once instanced).
 * The dome follows moon.js boulderProfile()/boulderEdge() exactly (the collision shape), then a few
 * deterministic planar cuts give the flat fracture faces and sharp edges of real blocks (the cuts only
 * remove material, so the collision profile stays an upper bound, within ~15%, of the visible rock).
 */
function buildRockGeometry(vi, NR = 9, NS = 22) {
  const pos = [];
  const ring = (k) => 1 + (k - 1) * NS; // first vertex index of ring k (k >= 1); 0 = apex
  pos.push(0, boulderProfile(vi, 0, 1, 0), 0);
  for (let k = 1; k <= NR + 1; k++) {
    for (let m = 0; m < NS; m++) {
      const th = (m / NS) * Math.PI * 2;
      const c = Math.cos(th);
      const s = Math.sin(th);
      const e = boulderEdge(vi, c, s);
      if (k <= NR) {
        const q = Math.pow(k / NR, 0.75);
        const rr = q * e;
        pos.push(rr * c, boulderProfile(vi, rr, c, s), -rr * s);
      } else {
        // skirt: slightly inside the outline, below ground (hides gaps on slopes)
        pos.push(0.93 * e * c, -0.45, -0.93 * e * s);
      }
    }
  }
  // fracture faces: planar cuts (normals mostly sideways/upward), each shaving 6-18% off the block
  const nCuts = 9 + (vi % 3);
  for (let cI = 0; cI < nCuts; cI++) {
    const az = (cI / nCuts) * Math.PI * 2 + jitter(vi, cI, 1) * 0.6;
    const el = 0.12 + 0.75 * (0.5 + 0.5 * jitter(vi, cI, 2)); // elevation of the cut normal (rad)
    const nx = Math.cos(el) * Math.cos(az);
    const ny = Math.sin(el);
    const nz = -Math.cos(el) * Math.sin(az);
    // plane offset: a fraction below the dome's extent along n
    let ext = 0;
    for (let i = 0; i < pos.length; i += 3) ext = Math.max(ext, pos[i] * nx + pos[i + 1] * ny + pos[i + 2] * nz);
    const d = ext * (0.74 + 0.14 * (0.5 + 0.5 * jitter(vi, cI, 3)));
    for (let i = 0; i < pos.length; i += 3) {
      if (pos[i + 1] < 0) continue; // keep the buried skirt
      const t = pos[i] * nx + pos[i + 1] * ny + pos[i + 2] * nz - d;
      if (t > 0) {
        pos[i] -= t * nx;
        pos[i + 1] = Math.max(0, pos[i + 1] - t * ny);
        pos[i + 2] -= t * nz;
      }
    }
  }
  const idx = [];
  for (let m = 0; m < NS; m++) idx.push(0, ring(1) + m, ring(1) + ((m + 1) % NS));
  for (let k = 1; k <= NR; k++) {
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
  g.setIndex(idx);
  // non-indexed -> hard facets (normals come from screen-space derivatives in the shader)
  return g.toNonIndexed();
}

const ROCK_VERT = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  attribute vec4 aRock;   // x: sun-horizon delta, y: tint, z: size, w: unused
  varying vec3 vPos;
  varying vec3 vObj;
  varying vec4 vRock;
  void main() {
    vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
    vPos = wp.xyz;
    vObj = position * vec3(aRock.z, aRock.z * 0.8, aRock.z); // ~metres, so texture scale is size-independent
    vRock = aRock;
    gl_Position = projectionMatrix * viewMatrix * wp;
    #include <logdepthbuf_vertex>
  }
`;

function rockFrag(vesselGLSL) {
  return /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_fragment>
  ${vesselGLSL}
  ${LUNAR_GLSL}
  uniform float uFill;
  varying vec3 vPos;
  varying vec3 vObj;
  varying vec4 vRock;
  void main() {
    #include <logdepthbuf_fragment>
    vec3 up = normalize(uCamMCI + vPos);
    vec3 V = normalize(-vPos);
    vec3 fn = cross(dFdx(vPos), dFdy(vPos));
    float fl = dot(fn, fn);
    vec3 N = fl > 1e-30 ? fn * inversesqrt(fl) : V; // degenerate derivatives at silhouettes
    if (dot(N, V) < 0.0) N = -N;
    vec3 L = uSunDir;
    // vesicular, dust-coated basalt: fine pits/grain on the normal, speckled albedo
    float n1 = valueNoise(vObj * 7.0);
    float n2 = valueNoise(vObj * 23.0 + 5.0);
    float n3 = valueNoise(vObj * 61.0 + 9.0);
    vec3 bump = vec3(valueNoise(vObj * 19.0 + 1.3), valueNoise(vObj * 19.0 + 7.1), valueNoise(vObj * 19.0 + 3.7)) - 0.5;
    N = normalize(N + bump * 0.22 + 1e-6 * up);
    float A = 0.15 * (0.85 + 0.3 * vRock.y) * (0.88 + 0.12 * n1 + 0.14 * n2 + 0.16 * (n3 - 0.5));
    // dust mantle on upward-facing facets (a touch darker/browner like the surrounding soil)
    float dusty = smoothstep(0.55, 0.95, dot(N, up));
    vec3 tint = mix(vec3(0.97, 0.965, 0.95), vec3(1.0, 0.94, 0.87), dusty);
    A *= mix(1.0, 0.82, dusty);
    // terrain shadow at the rock (baked horizon), vessel shadow
    float vis = clamp(0.5 - vRock.x / 0.012, 0.0, 1.0) * vesselShadow(vPos);
    // rock faces scatter less backward than fluffy regolith: blend lunar & Lambert
    float mu0 = max(dot(N, L), 0.0);
    float direct = mix(lunarReflectance(N, L, V), mu0 * 0.75, 0.45) * vis;
    // light from the sunlit ground below (rocks' lower faces) + faint surroundings
    float sinE = max(dot(L, up), 0.0);
    float ground = 0.08 * sinE * 0.55 * clamp(0.5 - 0.5 * dot(N, up), 0.0, 1.0);
    float fill = uFill * sinE;
    vec3 col = max(uSunColor * (uSunI / PI) * A * tint * (direct + ground + fill), vec3(0.0));
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;
}

/**
 * Rock instances manager.
 * @param {object} ctx RenderContext
 * @param {object} lunar shared lighting uniforms
 */
export function createRocks(ctx, lunar) {
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...lunar, ...ctx.vesselShadow.uniforms },
    vertexShader: ROCK_VERT,
    fragmentShader: rockFrag(ctx.vesselShadow.glsl),
    extensions: { derivatives: true },
  });
  mat.name = 'LunarRock';
  const group = new THREE.Group();
  group.name = 'rocks';
  ctx.scene.add(group);
  // two levels of detail per variant: ~420 triangles near the camera, ~70 further away
  const LODS = 2;
  const geos = [];
  for (let v = 0; v < NVAR; v++) geos.push([buildRockGeometry(v, 9, 22), buildRockGeometry(v, 4, 9)]);
  const meshes = []; // [variant * LODS + lod]
  const anchor = new THREE.Vector3(Infinity, 0, 0);
  const lastBuildCam = new THREE.Vector3(Infinity, 0, 0);
  let lastBuildT = 0;
  let signature = '';
  let count = 0;

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
      m.geometry.dispose();
      m.dispose();
    }
    const cap = Math.max(128, Math.ceil(n * 1.5));
    const g = geos[Math.floor(slot / LODS)][slot % LODS].clone(); // own copy carries the instanced attribute
    g.setAttribute('aRock', new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4));
    m = new THREE.InstancedMesh(g, mat, cap);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.frustumCulled = false;
    m.layers.set(LAYERS.WORLD);
    m.count = 0;
    meshes[slot] = m;
    group.add(m);
    return m;
  }

  // Visible range grows with rock size (a 3 m block matters at 1.2 km, a 0.4 m one only nearby).
  const maxDist = (r) => 120 + 750 * r;
  const lod0Dist = (r) => 20 + 70 * r;

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
        const a = m.geometry.attributes.aRock;
        a.array[i * 4] = Math.min(SHADOW_CLAMP, Math.max(-SHADOW_CLAMP, b[k + 8]));
        a.array[i * 4 + 1] = b[k + 9];
        a.array[i * 4 + 2] = r;
        a.array[i * 4 + 3] = 0;
        count++;
      }
    }
    for (let q = 0; q < nSlots; q++) {
      const m = meshes[q];
      if (!m) continue;
      m.count = fill[q];
      m.instanceMatrix.needsUpdate = true;
      m.geometry.attributes.aRock.needsUpdate = true;
    }
  }

  return {
    group,
    /** @returns {number} number of rock instances currently drawn */
    get count() {
      return count;
    },
    /**
     * @param {object} frame FrameContext
     * @param {Array} chunks boulder-owning chunks in use this frame
     */
    update(frame, chunks) {
      let sig = '';
      for (const c of chunks) sig += c.key + ';';
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
