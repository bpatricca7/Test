// Voxel meshes for Magic Houses that look like the real blocks (same texture array, face
// shading and ambient occlusion as the chunk mesher): the see-through ghost preview, the
// "pop in" build animation (per-block scale bounce driven in the vertex shader) and the Bag
// thumbnails.

import * as THREE from 'three';
import { SHAPES } from '../../core/registry.js';

// Face order: 0 +X, 1 -X, 2 +Y, 3 -Y, 4 +Z, 5 -Z (same as the chunk mesher).
const FACES = [
  { n: [1, 0, 0], axis: 0, t: [1, 2], c: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]], uv: [[1, 0], [1, 1], [0, 1], [0, 0]] },
  { n: [-1, 0, 0], axis: 0, t: [1, 2], c: [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]], uv: [[1, 0], [1, 1], [0, 1], [0, 0]] },
  { n: [0, 1, 0], axis: 1, t: [0, 2], c: [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]], uv: [[0, 1], [0, 0], [1, 0], [1, 1]] },
  { n: [0, -1, 0], axis: 1, t: [0, 2], c: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], uv: [[0, 0], [1, 0], [1, 1], [0, 1]] },
  { n: [0, 0, 1], axis: 2, t: [0, 1], c: [[1, 0, 1], [1, 1, 1], [0, 1, 1], [0, 0, 1]], uv: [[1, 0], [1, 1], [0, 1], [0, 0]] },
  { n: [0, 0, -1], axis: 2, t: [0, 1], c: [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]], uv: [[1, 0], [1, 1], [0, 1], [0, 0]] },
];
const AO_OFFSETS = FACES.map((f) =>
  f.c.map((corner) => {
    const s1 = [0, 0, 0], s2 = [0, 0, 0];
    s1[f.t[0]] = corner[f.t[0]] ? 1 : -1;
    s2[f.t[1]] = corner[f.t[1]] ? 1 : -1;
    return [s1, s2, [s1[0] + s2[0], s1[1] + s2[1], s1[2] + s2[2]]];
  }),
);
const FACE_SHADE = [0.78, 0.78, 1.0, 0.6, 0.88, 0.88];
const AO_CURVE = [0.52, 0.7, 0.85, 1.0];

/**
 * Build a BufferGeometry from voxels.
 * src = { each(cb(x, y, z, id)), idAt(x, y, z) -> id (opaque-ish lookups; -1 = treat as
 *         solid ground) }, props = registry props, opts = { offset: [x, y, z] subtracted
 * from positions, start(x, y, z) -> seconds (adds the 'anim' attribute) }.
 */
export function voxelGeometry(src, props, opts = {}) {
  const [offX, offY, offZ] = opts.offset || [0, 0, 0];
  const anim = typeof opts.start === 'function';
  const pos = [], uv = [], layer = [], shade = [], animA = [], index = [];
  const opaqueAt = (x, y, z) => {
    const id = src.idAt(x, y, z);
    return id < 0 || props.opaque[id] === 1;
  };
  const ao = [0, 0, 0, 0];
  let vc = 0;
  const vertex = (x, y, z, u, v, L, s, cx, cy, cz, t0) => {
    pos.push(x - offX, y - offY, z - offZ);
    uv.push(u, v);
    layer.push(L);
    shade.push(s);
    if (anim) animA.push(cx - offX, cy - offY, cz - offZ, t0);
    vc++;
  };
  const quad = (flip) => {
    const b = vc - 4;
    if (!flip) index.push(b, b + 1, b + 2, b, b + 2, b + 3);
    else index.push(b + 1, b + 2, b + 3, b + 1, b + 3, b);
  };

  src.each((x, y, z, id) => {
    const shape = props.shape[id];
    if (!shape) return;
    const t0 = anim ? opts.start(x, y, z) : 0;
    const cx = x + 0.5, cy = y + 0.5, cz = z + 0.5;
    if (shape === SHAPES.cross) {
      let L = props.faceLayer[id * 6];
      if (L >= 1024) L -= 1024;
      const a = 0.15, b = 0.85;
      for (const [x0, z0, x1, z1] of [[x + a, z + a, x + b, z + b], [x + a, z + b, x + b, z + a]]) {
        vertex(x0, y, z0, 0, 0, L, 0.75, cx, cy, cz, t0);
        vertex(x1, y, z1, 1, 0, L, 0.75, cx, cy, cz, t0);
        vertex(x1, y + 1, z1, 1, 1, L, 1, cx, cy, cz, t0);
        vertex(x0, y + 1, z0, 0, 1, L, 1, cx, cy, cz, t0);
        quad(false);
      }
      return;
    }
    let height = 1;
    if (shape === SHAPES.slab) height = 0.5;
    else if (shape === SHAPES.carpet) height = 1 / 16;
    else if (shape === SHAPES.liquid && src.idAt(x, y + 1, z) !== id) height = 0.875;
    const selfOpaque = props.opaque[id] === 1;
    for (let f = 0; f < 6; f++) {
      const face = FACES[f];
      const nx = x + face.n[0], ny = y + face.n[1], nz = z + face.n[2];
      const nid = src.idAt(nx, ny, nz);
      if (!(f === 2 && height < 1)) {
        if (nid < 0 || props.opaque[nid]) continue;
        if (!selfOpaque && nid === id) continue;
      }
      const oy = f === 2 && shape === SHAPES.carpet ? y : ny;
      const offs = AO_OFFSETS[f];
      for (let v = 0; v < 4; v++) {
        const o = offs[v];
        const s1 = opaqueAt(nx + o[0][0], oy + o[0][1], nz + o[0][2]) ? 1 : 0;
        const s2 = opaqueAt(nx + o[1][0], oy + o[1][1], nz + o[1][2]) ? 1 : 0;
        const c = s1 && s2 ? 1 : opaqueAt(nx + o[2][0], oy + o[2][1], nz + o[2][2]) ? 1 : 0;
        ao[v] = s1 && s2 ? 0 : 3 - (s1 + s2 + c);
      }
      let L = props.faceLayer[id * 6 + f];
      if (L >= 1024) L -= 1024;
      const fs = FACE_SHADE[f];
      for (let v = 0; v < 4; v++) {
        const cc = face.c[v];
        const uvv = face.uv[v];
        const tv = face.axis === 1 ? uvv[1] : uvv[1] * height;
        vertex(x + cc[0], y + (cc[1] ? height : 0), z + cc[2], uvv[0], tv, L, fs * AO_CURVE[ao[v]], cx, cy, cz, t0);
      }
      quad(ao[0] + ao[2] < ao[1] + ao[3]);
    }
  });

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('layer', new THREE.Float32BufferAttribute(layer, 1));
  geo.setAttribute('shade', new THREE.Float32BufferAttribute(shade, 1));
  if (anim) geo.setAttribute('anim', new THREE.Float32BufferAttribute(animA, 4));
  geo.setIndex(vc > 65535 ? new THREE.Uint32BufferAttribute(index, 1) : new THREE.Uint16BufferAttribute(index, 1));
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  geo.userData.vertexCount = vc;
  return geo;
}

const vertexShader = /* glsl */ `
in float layer;
in float shade;
#ifdef BUILD
in vec4 anim;
uniform float uClock;
#endif
out vec2 vUv;
flat out float vLayer;
out float vShade;
out float vGlow;
out float vFogDepth;
void main() {
  vec3 p = position;
  float glow = 0.0;
#ifdef BUILD
  // each block pops in at its own time: drops in, overshoots a little, settles
  float t = clamp((uClock - anim.w) / 0.38, 0.0, 1.0);
  float s = 0.0;
  if (t > 0.0) {
    float u = t - 1.0;
    s = 1.0 + 2.70158 * u * u * u + 1.70158 * u * u;
  }
  p = anim.xyz + (p - anim.xyz) * s;
  p.y += (1.0 - t) * 0.9;
  glow = t > 0.0 ? 1.0 - t : 0.0;
#endif
  vLayer = layer;
  vUv = uv;
  vShade = shade;
  vGlow = glow;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vFogDepth = length(mv.xyz);
  gl_Position = projectionMatrix * mv;
}
`;

const fragmentShader = /* glsl */ `
precision highp float;
precision highp sampler2DArray;
uniform sampler2DArray uAtlas;
uniform float uDaylight;
uniform float uAmbient;
uniform vec3 uSkyColor;
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;
uniform float uOpacity;
uniform vec3 uTint;
uniform float uTintAmt;
in vec2 vUv;
flat in float vLayer;
in float vShade;
in float vGlow;
in float vFogDepth;
out vec4 fragColor;
void main() {
  vec4 tex = texture(uAtlas, vec3(vUv, vLayer));
  if (tex.a < 0.5) discard;
  vec3 lightCol = max(uSkyColor * uDaylight, vec3(uAmbient));
  vec3 color = tex.rgb * vShade * lightCol;
  color = mix(color, uTint, uTintAmt);
  color = mix(color, vec3(1.0, 0.96, 1.0), vGlow * 0.75);
  float fog = smoothstep(uFogNear, uFogFar, vFogDepth);
  color = mix(color, uFogColor, fog);
  fragColor = vec4(color, uOpacity);
}
`;

/**
 * Materials sharing the world's block texture and daylight/fog uniforms.
 * mode: 'ghost' (see-through colour pass), 'ghostDepth' (depth pre-pass so only the nearest
 * surface of the ghost shows), 'build' (pop-in animation) or 'thumb' (fixed daylight, for the
 * offscreen thumbnail renderer).
 */
export function prefabMaterial(game, mode) {
  const U = game.blockUniforms;
  const thumb = mode === 'thumb';
  const uniforms = {
    uAtlas: U.uAtlas,
    uDaylight: thumb ? { value: 1 } : U.uDaylight,
    uAmbient: thumb ? { value: 0.6 } : U.uAmbient,
    uSkyColor: thumb ? { value: new THREE.Color(1, 1, 1) } : U.uSkyColor,
    uFogColor: U.uFogColor,
    uFogNear: thumb ? { value: 1e5 } : U.uFogNear,
    uFogFar: thumb ? { value: 2e5 } : U.uFogFar,
    uOpacity: { value: 1 },
    uTint: { value: new THREE.Color(1, 0.9, 0.97) },
    uTintAmt: { value: 0 },
  };
  const params = {
    glslVersion: THREE.GLSL3,
    vertexShader,
    fragmentShader,
    uniforms,
    side: THREE.DoubleSide,
  };
  if (mode === 'build') {
    uniforms.uClock = { value: 0 };
    params.defines = { BUILD: 1 };
    // the real blocks win where both are drawn for a frame while chunks re-mesh
    params.polygonOffset = true;
    params.polygonOffsetFactor = 1;
    params.polygonOffsetUnits = 1;
  } else if (mode === 'ghost') {
    params.transparent = true;
    params.depthWrite = false;
    params.depthFunc = THREE.LessEqualDepth;
    uniforms.uOpacity.value = 0.55;
    uniforms.uTintAmt.value = 0.28;
  } else if (mode === 'ghostDepth') {
    params.colorWrite = false;
  }
  const m = new THREE.ShaderMaterial(params);
  m.userData.shared = true;
  return m;
}

/** Soft pink footprint marker (dashed border + faint fill), sized with uSize. */
export function footprintMaterial() {
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    uniforms: { uSize: { value: new THREE.Vector2(1, 1) }, uTime: { value: 0 }, uColor: { value: new THREE.Color('#FF5FA2') } },
    vertexShader: /* glsl */ `
      out vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform vec2 uSize;
      uniform float uTime;
      uniform vec3 uColor;
      in vec2 vUv;
      out vec4 fragColor;
      void main() {
        vec2 p = vUv * uSize;
        float edge = min(min(p.x, uSize.x - p.x), min(p.y, uSize.y - p.y));
        float along = (p.x < 0.3 || p.x > uSize.x - 0.3) ? p.y : p.x;
        float dash = step(0.5, fract(along * 0.75 - uTime * 0.8));
        float border = 1.0 - smoothstep(0.16, 0.24, edge);
        vec3 col = mix(uColor, vec3(1.0), dash * 0.85);
        float a = border * 0.95 + (1.0 - border) * 0.13;
        fragColor = vec4(border > 0.5 ? col : uColor, a);
      }`,
  });
}
