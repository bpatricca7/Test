// One material for (almost) every furniture surface, so the world can draw a whole furnished
// house in one or two draw calls (see the static batching in src/things/entities.js).
//
// Plain colors are vertex colors (as before). The small 16x16 pixel-art textures from
// paint.js (wood, fabric, quilts, tiles, bricks...) are copied into layers of ONE texture
// array; each vertex carries its layer (-1 = no texture) and a glow amount (emissive =
// color x glow, how glow() / lamp shades / the piano light themselves). Anything that does not
// fit (see-through, per-piece textures such as TV screens and easel pictures, bigger images
// such as paintings and mirrors) keeps its own material, exactly as before.

import * as THREE from 'three';

const SIZE = 16; // texel size of every layer
const FIRST_CAP = 64; // layers allocated up front (grows by doubling)
const MAX_CAP = 256; // WebGL2 guarantees at least 256 array layers

const layers = new Map(); // texture -> layer index (-1 = cannot be used)
let count = 0;
let cap = 0;
let data = null;
const uniform = { value: null };

function grow(next) {
  const nd = new Uint8Array(SIZE * SIZE * 4 * next);
  if (data) nd.set(data);
  const tex = new THREE.DataArrayTexture(nd, SIZE, SIZE, next);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.generateMipmaps = true;
  tex.userData.shared = true;
  tex.needsUpdate = true;
  const old = uniform.value;
  data = nd;
  cap = next;
  uniform.value = tex;
  if (old) old.dispose();
}

/** Layer of a paint.js texture in the shared array, or -1 when it cannot go there. */
export function layerOf(texture) {
  if (!texture) return -1;
  let l = layers.get(texture);
  if (l !== undefined) return l;
  l = -1;
  const img = texture.image;
  const ok = texture.isTexture && !texture.isDataTexture && img && img.width === SIZE && img.height === SIZE &&
    typeof img.getContext === 'function' && texture.userData && texture.userData.shared &&
    texture.magFilter === THREE.NearestFilter && texture.flipY !== false;
  if (ok && (count < cap || cap < MAX_CAP)) {
    try {
      const px = img.getContext('2d').getImageData(0, 0, SIZE, SIZE).data;
      if (count >= cap) grow(cap ? Math.min(MAX_CAP, cap * 2) : FIRST_CAP);
      l = count++;
      // canvas row 0 is the top of the picture; texture rows start at the bottom (flipY)
      const base = l * SIZE * SIZE * 4, row = SIZE * 4;
      for (let y = 0; y < SIZE; y++) data.set(px.subarray((SIZE - 1 - y) * row, (SIZE - y) * row), base + y * row);
      uniform.value.needsUpdate = true;
    } catch (err) {
      l = -1;
    }
  }
  layers.set(texture, l);
  return l;
}

function makeMaterial(side) {
  const m = new THREE.MeshLambertMaterial({ vertexColors: true, side });
  m.name = side === THREE.DoubleSide ? 'furniture|double' : 'furniture';
  m.userData.shared = true;
  m.userData.atlas = true;
  m.onBeforeCompile = (shader) => {
    shader.uniforms.fAtlas = uniform;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 fLook;\nvarying vec2 vFLook;\nvarying vec2 vFUv;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvFLook = fLook;\n\tvFUv = uv;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform highp sampler2DArray fAtlas;\nvarying vec2 vFLook;\nvarying vec2 vFUv;')
      // sampled outside any branch (implicit derivatives), then used only for textured faces
      .replace('#include <map_fragment>', 'vec4 fTexel = texture( fAtlas, vec3( vFUv, max( floor( vFLook.x + 0.5 ), 0.0 ) ) );\n\tif ( vFLook.x > -0.5 ) diffuseColor *= fTexel;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n\ttotalEmissiveRadiance += vColor.rgb * vFLook.y;');
  };
  m.customProgramCacheKey = () => 'sw-furniture-atlas';
  return m;
}

/** The shared materials: front faces only, and both sides (lamp shades). */
export const ATLAS_MAT = makeMaterial(THREE.FrontSide);
export const ATLAS_MAT_2 = makeMaterial(THREE.DoubleSide);

/**
 * How a paint.js / Kit material maps onto the atlas: { mat, color: '#rrggbb'|Color, layer,
 * glow } or null when the material has to stay on its own.
 */
export function atlasLook(m) {
  if (!m || !m.isMeshLambertMaterial || m.userData.atlas) return null;
  if (m.transparent || m.opacity < 1 || m.alphaTest > 0 || m.alphaMap || m.emissiveMap || m.lightMap || m.aoMap || m.envMap) return null;
  if (!m.userData || !m.userData.shared || !m.visible) return null;
  if (m.side !== THREE.FrontSide && m.side !== THREE.DoubleSide) return null;
  let glow = 0;
  const e = m.emissive;
  if (e && (e.r || e.g || e.b)) {
    // emissive must be the surface color itself (glow(), lamp shades, piano, balloons...)
    const c = m.color;
    if (Math.abs(e.r - c.r) > 1e-3 || Math.abs(e.g - c.g) > 1e-3 || Math.abs(e.b - c.b) > 1e-3 || m.map) return null;
    glow = m.emissiveIntensity;
  }
  const layer = m.map ? layerOf(m.map) : -1;
  if (m.map && layer < 0) return null;
  return { mat: m.side === THREE.DoubleSide ? ATLAS_MAT_2 : ATLAS_MAT, color: m.color, layer, glow };
}
