// Draw-call / texture budget of the LM crew compartment (LM-CABIN agent).
//
// The cockpit kit builds every panel plate, instrument face, bezel, placard, cover glass and
// fastener as its own mesh, most with their own canvas-textured material: ~510 meshes, ~250
// materials, ~240 canvas textures (34 Mpx) for one cabin. three.js issues one draw per mesh per pass
// (main view + sun shadow), so the cabin alone cost ~500 draws per frame. Two passes fix that after
// the build:
//
// 1. Texture atlas. Painted materials that differ only by their canvases (panel plates, instrument
//    faces and bezels, placards, DSKY keys: albedo map + the kit's aux map = bump / roughness /
//    integral-lighting mask) are regrouped by their remaining parameters; each group's canvases are
//    packed into shared atlas pages (with edge-extended gutters against mip bleeding) and the meshes'
//    UVs are remapped, so the whole group uses ONE material. Per quality the canvases are resampled
//    (quality=low: half resolution per axis = a quarter of the texture memory).
//
// 2. Static merge. Everything that does not move after the build is baked into cabin space and
//    merged into ONE mesh per (material, shadow flags, render order, vertex layout). Plain map-less
//    materials with identical parameters are shared first. Additive cover glass is merged too (its
//    blending is order independent).
//
// Safety net: which parts move is not declared anywhere (needles, FDAI balls, talkback flags, push
// buttons, DSKY keys, tape flags... are animated by the kit and instrument code), so the merged
// originals stay in the scene graph on an empty layer mask and are WATCHED every frame: if a merged
// part (or any of its ancestors) moves, changes visibility or gets another material, or a deduplicated
// material is edited, the part is taken out of its batch and drawn on its own again; if an atlased
// canvas is redrawn or swapped, the meshes using it get their original material and UVs back. Known
// movers are excluded up front (`dynamic`), so this normally never fires.
import * as THREE from 'three';

/** Per-quality build settings: atlas resampling, smallest shadow caster (bounding radius, m). */
export const CABIN_QUALITY = {
  low: { tex: 0.5, castMin: 0.05, castInstanced: false },
  medium: { tex: 0.75, castMin: 0.03, castInstanced: true },
  high: { tex: 1, castMin: 0.03, castInstanced: true },
};

const _baseOnBeforeCompile = THREE.Material.prototype.onBeforeCompile;
const _baseOnBeforeRender = new THREE.Object3D().onBeforeRender;
const MAP_SLOTS = ['map', 'emissiveMap', 'roughnessMap', 'metalnessMap', 'normalMap', 'bumpMap', 'aoMap', 'alphaMap', 'lightMap', 'displacementMap'];
const AUX_SLOTS = ['roughnessMap', 'bumpMap', 'emissiveMap'];

// ------------------------------------------------------------------------------------ helpers

const isCanvas = (img) => !!img && typeof img.getContext === 'function' && img.width > 0 && img.height > 0;
const identityUV = (t) => t.offset.x === 0 && t.offset.y === 0 && t.repeat.x === 1 && t.repeat.y === 1 && t.rotation === 0;
const clamped = (t) => t.wrapS === THREE.ClampToEdgeWrapping && t.wrapT === THREE.ClampToEdgeWrapping;

/** Canvas textures an atlas may replace: {map, aux} or null. */
function atlasTextures(m, maxDim) {
  if (!m || !m.isMeshStandardMaterial || m.isMeshPhysicalMaterial) return 'type';
  if (m.transparent || m.blending !== THREE.NormalBlending || m.alphaTest > 0 || m.vertexColors) return 'blend';
  if (m.userData.lampBase != null || m.userData.noAtlas || m.userData.noMerge) return 'lamp';
  if (m.onBeforeCompile !== _baseOnBeforeCompile && m.customProgramCacheKey?.() !== 'kit-integral') return 'shader';
  const map = m.map;
  if (!map) return 'nomap';
  if (!isCanvas(map.image) || !identityUV(map) || !clamped(map)) return 'map';
  if (map.image.width > maxDim || map.image.height > maxDim) return 'big';
  for (const k of ['normalMap', 'alphaMap', 'aoMap', 'metalnessMap', 'lightMap', 'displacementMap', 'envMap']) if (m[k]) return 'slot';
  let aux = null;
  for (const k of AUX_SLOTS) {
    if (!m[k]) continue;
    if (aux && m[k] !== aux) return 'aux';
    aux = m[k];
  }
  let ratio = 1;
  if (aux) {
    if (!isCanvas(aux.image) || !identityUV(aux) || !clamped(aux) || aux.flipY !== map.flipY) return 'aux';
    // the kit paints its aux maps at half resolution: the aux pages are then half-size copies
    ratio = aux.image.width / map.image.width;
    ratio = Math.abs(ratio - 0.5) < 0.03 ? 0.5 : Math.abs(ratio - 1) < 0.03 ? 1 : 0;
    if (!ratio || Math.abs(aux.image.height / map.image.height - ratio) > 0.03) return 'aux';
  }
  return { map, aux, ratio };
}

/** Everything but the textures that decides how an atlased material renders. */
function atlasSignature(m, t) {
  const c = (x) => x.getHexString();
  return [m.type, c(m.color), c(m.emissive), m.emissiveIntensity, m.roughness, m.metalness, m.bumpScale, m.side, m.flatShading,
    m.envMapIntensity, m.polygonOffset, m.polygonOffsetFactor, m.polygonOffsetUnits, m.depthTest, m.depthWrite, m.colorWrite,
    m.toneMapped, m.fog, m.wireframe, JSON.stringify(m.userData), m.customProgramCacheKey?.() === 'kit-integral',
    AUX_SLOTS.map((k) => (m[k] ? 1 : 0)).join(''), t.ratio, t.map.colorSpace, t.aux?.colorSpace, t.map.flipY, t.map.premultiplyAlpha,
    t.map.magFilter, t.map.minFilter, t.aux?.magFilter].join('|');
}

/** UVs of a geometry stay within the texture (clamped atlas tiles cannot wrap). */
function uvInside(g, eps = 0.002) {
  const uv = g.attributes.uv;
  if (!uv || uv.isInterleavedBufferAttribute) return false;
  for (let i = 0; i < uv.count; i++) {
    const u = uv.getX(i);
    const v = uv.getY(i);
    if (!(u >= -eps && u <= 1 + eps && v >= -eps && v <= 1 + eps)) return false;
  }
  return true;
}

/**
 * Pack rectangles ({w, h}, gutters included) into pages of at most `size` × `size` (skyline,
 * bottom-left: tallest first, each at the lowest then leftmost free spot; typically > 85 % filled).
 * @returns {Array<{w: number, h: number, rects: Array}>} rects get {page, x, y}
 */
export function packShelves(rects, size) {
  const order = rects.slice().sort((a, b) => b.h - a.h || b.w - a.w);
  const pages = [];
  const newPage = () => {
    const p = { w: 0, h: 0, rects: [], sky: [{ x: 0, y: 0, w: size }] };
    pages.push(p);
    return p;
  };
  /** Lowest y at which a w-wide rect fits starting at skyline segment i (or Infinity). */
  const fitAt = (sky, i, w) => {
    if (sky[i].x + w > size) return Infinity;
    let y = 0;
    let left = w;
    for (let j = i; left > 0; j++) {
      if (j >= sky.length) return Infinity;
      y = Math.max(y, sky[j].y);
      left -= sky[j].w;
    }
    return y;
  };
  const place = (p, r) => {
    let best = null;
    for (let i = 0; i < p.sky.length; i++) {
      const y = fitAt(p.sky, i, r.w);
      if (y + r.h > size) continue;
      if (!best || y < best.y || (y === best.y && p.sky[i].x < best.x)) best = { i, x: p.sky[i].x, y };
    }
    if (!best) return false;
    r.x = best.x;
    r.y = best.y;
    // raise the skyline under the new rect
    const seg = { x: r.x, y: r.y + r.h, w: r.w };
    const out = [];
    for (const s of p.sky) {
      const s0 = s.x;
      const s1 = s.x + s.w;
      if (s1 <= seg.x || s0 >= seg.x + seg.w) out.push(s);
      else {
        if (s0 < seg.x) out.push({ x: s0, y: s.y, w: seg.x - s0 });
        if (s1 > seg.x + seg.w) out.push({ x: seg.x + seg.w, y: s.y, w: s1 - seg.x - seg.w });
      }
    }
    out.push(seg);
    out.sort((a, b) => a.x - b.x);
    // merge neighbours at the same height
    p.sky = out.reduce((acc, s) => {
      const l = acc[acc.length - 1];
      if (l && l.y === s.y && l.x + l.w === s.x) l.w += s.w;
      else acc.push({ ...s });
      return acc;
    }, []);
    p.w = Math.max(p.w, r.x + r.w);
    p.h = Math.max(p.h, r.y + r.h);
    p.rects.push(r);
    return true;
  };
  for (const r of order) {
    if (r.w > size || r.h > size) throw new Error(`atlas tile ${r.w}x${r.h} larger than the page`);
    let ok = false;
    for (let k = 0; k < pages.length && !ok; k++) {
      ok = place(pages[k], r);
      if (ok) r.page = k;
    }
    if (!ok) {
      const p = newPage();
      place(p, r);
      r.page = pages.length - 1;
    }
  }
  for (const p of pages) {
    delete p.sky;
    p.w = Math.ceil(p.w / 8) * 8;
    p.h = Math.ceil(p.h / 8) * 8;
  }
  return pages;
}

/** Map a tile-local uv (0..1, flipY canvas convention) into the atlas page. */
export function atlasUV(u, v, r, pw, ph, gutter) {
  const iw = r.w - 2 * gutter;
  const ih = r.h - 2 * gutter;
  return [(r.x + gutter + u * iw) / pw, 1 - (r.y + gutter + ih) / ph + (v * ih) / ph];
}

/**
 * Draw `src` into `g` at the tile (inner size) and extend its edges into the gutter. The gutter is
 * drawn from the SOURCE's border pixels (drawing the page onto itself would copy the whole page per
 * call).
 */
function blit(g, src, r, gutter) {
  const iw = r.w - 2 * gutter;
  const ih = r.h - 2 * gutter;
  const x = r.x + gutter;
  const y = r.y + gutter;
  const W = src.width;
  const H = src.height;
  g.imageSmoothingEnabled = true;
  if ('imageSmoothingQuality' in g) g.imageSmoothingQuality = 'high';
  g.drawImage(src, 0, 0, W, H, x, y, iw, ih);
  if (!gutter) return;
  g.drawImage(src, 0, 0, 1, H, r.x, y, gutter, ih); // left
  g.drawImage(src, W - 1, 0, 1, H, x + iw, y, gutter, ih); // right
  g.drawImage(src, 0, 0, W, 1, x, r.y, iw, gutter); // top
  g.drawImage(src, 0, H - 1, W, 1, x, y + ih, iw, gutter); // bottom
  g.drawImage(src, 0, 0, 1, 1, r.x, r.y, gutter, gutter); // corners
  g.drawImage(src, W - 1, 0, 1, 1, x + iw, r.y, gutter, gutter);
  g.drawImage(src, 0, H - 1, 1, 1, r.x, y + ih, gutter, gutter);
  g.drawImage(src, W - 1, H - 1, 1, 1, x + iw, y + ih, gutter, gutter);
}

function atlasTexture(canvas, like) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = like.colorSpace;
  t.flipY = like.flipY;
  t.premultiplyAlpha = like.premultiplyAlpha;
  t.anisotropy = like.anisotropy;
  t.magFilter = like.magFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.name = 'lmcabin:atlas';
  return t;
}

// ------------------------------------------------------------------------------------ atlas

/**
 * Pack the static painted canvases under `root` into shared atlas pages (see the file comment).
 * @param {THREE.Object3D} root
 * @param {object} o { scale=1 (canvas resampling), pageSize=4096, maxDim=1600 (bigger canvases stay
 *   alone), gutter=8 (px at scale 1), createCanvas(w,h), registerIntegral(mat), skip: Set<Object3D> }
 * @returns {{materials: THREE.Material[], pages: number, tiles: number, pxBefore: number, pxAfter: number,
 *   records: Array<{mesh, material, geometry, source: THREE.Material}>, sources: Array}}
 */
export function buildAtlas(root, o = {}) {
  const scale = o.scale ?? 1;
  const size = o.pageSize ?? 4096;
  const maxDim = o.maxDim ?? 1600;
  // even sizes / gutters / positions everywhere, so half-size aux pages map exactly onto the colour pages
  const gutter = Math.max(2, Math.round(((o.gutter ?? 8) * scale) / 2) * 2);
  const even = (x) => Math.max(2, Math.round(x / 2) * 2);
  const mk = o.createCanvas || ((w, h) => Object.assign(document.createElement('canvas'), { width: w, height: h }));
  const skip = o.skip || new Set();
  // candidate materials and their meshes
  const cand = new Map(); // material -> {t, meshes}
  const bad = new Set();
  const reasons = {};
  const visit = (obj) => {
    if (skip.has(obj)) return;
    if (obj.isMesh && !bad.has(obj.material) && !Array.isArray(obj.material)) {
      const m = obj.material;
      let c = cand.get(m);
      if (!c) {
        const t = atlasTextures(m, maxDim);
        if (typeof t === 'string') {
          bad.add(m);
          reasons[t] = (reasons[t] || 0) + 1;
        } else cand.set(m, (c = { t, meshes: [] }));
      }
      if (c) {
        if (!obj.geometry?.attributes?.position || !uvInside(obj.geometry)) {
          bad.add(m);
          cand.delete(m);
          reasons.uv = (reasons.uv || 0) + 1;
        } else c.meshes.push(obj);
      }
    }
    for (const ch of obj.children) visit(ch);
  };
  visit(root);
  // a material also used by a skipped / unsuitable mesh stays as it is
  root.traverse((obj) => {
    if (!obj.isMesh || !cand.has(obj.material)) return;
    if (!cand.get(obj.material).meshes.includes(obj)) {
      cand.delete(obj.material);
      reasons.shared = (reasons.shared || 0) + 1;
    }
  });

  const groups = new Map(); // signature -> {rep, mats: [], tiles: Map(texKey -> tile)}
  for (const [m, c] of cand) {
    const sig = atlasSignature(m, c.t);
    let grp = groups.get(sig);
    if (!grp) groups.set(sig, (grp = { rep: m, mats: [], tiles: new Map() }));
    grp.mats.push(m);
    const key = c.t.map.uuid + '|' + (c.t.aux?.uuid ?? '');
    if (!grp.tiles.has(key)) {
      const w = even(c.t.map.image.width * scale) + 2 * gutter;
      const h = even(c.t.map.image.height * scale) + 2 * gutter;
      grp.tiles.set(key, { key, map: c.t.map, aux: c.t.aux, ratio: c.t.ratio, w, h });
    }
    c.key = key;
  }

  const out = { materials: [], pages: 0, tiles: 0, pxBefore: 0, pxAfter: 0, records: [], sources: [], reasons };
  const geoCache = new Map();
  for (const grp of groups.values()) {
    // a single canvas at full scale gains nothing
    if (grp.tiles.size < 2 && scale === 1) continue;
    const tiles = [...grp.tiles.values()];
    const pages = packShelves(tiles, size);
    const pageMats = pages.map((p) => {
      const cc = mk(p.w, p.h);
      const gc = cc.getContext('2d');
      let ca = null;
      let ga = null;
      const k = tiles[0].ratio;
      if (tiles[0].aux) {
        ca = mk(p.w * k, p.h * k);
        ga = ca.getContext('2d');
      }
      for (const r of p.rects) {
        blit(gc, r.map.image, r, gutter);
        if (ga) blit(ga, r.aux.image, { x: r.x * k, y: r.y * k, w: r.w * k, h: r.h * k }, gutter * k);
        out.pxBefore += r.map.image.width * r.map.image.height + (r.aux ? r.aux.image.width * r.aux.image.height : 0);
      }
      out.pxAfter += p.w * p.h + (ca ? ca.width * ca.height : 0);
      const rep = grp.rep;
      const mat = rep.clone();
      mat.name = `lmcabin:atlas${out.materials.length}`;
      mat.userData = { ...rep.userData, atlas: true };
      mat.onBeforeCompile = rep.onBeforeCompile;
      if (Object.prototype.hasOwnProperty.call(rep, 'customProgramCacheKey')) mat.customProgramCacheKey = rep.customProgramCacheKey;
      mat.map = atlasTexture(cc, rep.map);
      if (ca) {
        const at = atlasTexture(ca, AUX_SLOTS.map((k) => rep[k]).find(Boolean));
        for (const k of AUX_SLOTS) if (rep[k]) mat[k] = at;
      }
      if (rep.userData.integralScale != null) o.registerIntegral?.(mat);
      out.materials.push(mat);
      return { mat, w: p.w, h: p.h };
    });
    out.pages += pages.length;
    out.tiles += tiles.length;
    for (const m of grp.mats) {
      const c = cand.get(m);
      const r = grp.tiles.get(c.key);
      const pm = pageMats[r.page];
      out.sources.push({ material: m, map: c.t.map, mapVersion: c.t.map.version, aux: c.t.aux, auxVersion: c.t.aux?.version ?? 0 });
      for (const mesh of c.meshes) {
        const gk = mesh.geometry.uuid + '|' + r.page + '|' + r.x + '|' + r.y;
        let g = geoCache.get(gk);
        if (!g) {
          g = mesh.geometry.clone();
          const uv = g.attributes.uv;
          for (let i = 0; i < uv.count; i++) {
            const [u, v] = atlasUV(Math.min(1, Math.max(0, uv.getX(i))), Math.min(1, Math.max(0, uv.getY(i))), r, pm.w, pm.h, gutter);
            uv.setXY(i, u, v);
          }
          uv.needsUpdate = true;
          g.name = (mesh.geometry.name || 'geo') + ':atlas';
          geoCache.set(gk, g);
        }
        out.records.push({ mesh, material: m, geometry: mesh.geometry, source: m });
        mesh.material = pm.mat;
        mesh.geometry = g;
      }
    }
  }
  return out;
}

// ------------------------------------------------------------------------------------ merge

/** Parameter fingerprint of a plain (map-less, callback-free) material, or null if it must stay unique. */
function plainMaterialKey(m) {
  if (!m.isMeshStandardMaterial || m.isMeshPhysicalMaterial || m.isShaderMaterial) return null;
  if (m.onBeforeCompile !== _baseOnBeforeCompile) return null;
  const ud = Object.keys(m.userData);
  if (ud.some((k) => k !== 'integralScale' && k !== 'keepEmissive')) return null; // lamps, noShadow...
  for (const k of MAP_SLOTS) if (m[k]) return null;
  if (m.envMap) return null;
  const c = (x) => x.getHexString();
  return [m.type, c(m.color), c(m.emissive), m.emissiveIntensity, m.roughness, m.metalness, m.side, m.shadowSide, m.flatShading, m.vertexColors,
    m.envMapIntensity, m.opacity, m.transparent, m.blending, m.alphaTest, m.polygonOffset, m.polygonOffsetFactor, m.polygonOffsetUnits,
    m.depthTest, m.depthWrite, m.colorWrite, m.wireframe, m.fog, m.toneMapped, JSON.stringify(m.userData)].join('|');
}

/** Material state that a runtime edit would change (compared against the shared representative). */
const sameLook = (a, b) =>
  a.color.equals(b.color) && a.emissive.equals(b.emissive) && a.emissiveIntensity === b.emissiveIntensity &&
  a.opacity === b.opacity && a.visible === b.visible && a.roughness === b.roughness && a.metalness === b.metalness && !a.map;

/** Attributes a material needs (others are dropped so more batches share a vertex layout). */
function neededAttributes(m) {
  const need = new Set(['position', 'normal']);
  if (MAP_SLOTS.some((k) => m[k])) need.add('uv');
  if (m.vertexColors) need.add('color');
  if (m.normalMap || m.bumpMap) need.add('uv');
  return need;
}

function layoutKey(g, need) {
  return Object.keys(g.attributes).filter((k) => need.has(k)).sort().map((k) => {
    const a = g.attributes[k];
    const arr = a.isInterleavedBufferAttribute ? a.data.array : a.array;
    return `${k}${a.itemSize}${a.normalized ? 'n' : ''}${arr.constructor.name}`;
  }).join(',');
}

/** Can this mesh be baked into a static batch? true, or the reason why not. */
function mergeable(o) {
  if (!o.isMesh || o.isSkinnedMesh || o.isLOD || o.isPoints || o.isLine) return 'type';
  // instanced banks (switch nuts / washers / bushings, breaker collars...) are expanded into the batch;
  // per-instance colours would need a vertex colour attribute: those banks stay instanced
  if (o.isInstancedMesh && (o.instanceColor || o.morphTexture || o.count < 1 || o.count > 1024)) return 'instanced';
  if (o.userData.noMerge || o.userData.dynamic) return 'flagged';
  if (o.onBeforeRender !== _baseOnBeforeRender) return 'callback';
  const m = o.material;
  if (!m || Array.isArray(m) || m.userData?.noMerge || m.isShaderMaterial) return 'material';
  // opaque, or additive cover glass (order independent, no depth write)
  if (m.transparent && !(m.blending === THREE.AdditiveBlending && !m.depthWrite)) return 'transparent';
  if (!m.transparent && m.blending !== THREE.NormalBlending) return 'blending';
  const g = o.geometry;
  if (!g?.attributes?.position || !g.attributes.normal || g.drawRange.start !== 0 || g.drawRange.count !== Infinity) return 'geometry';
  if (Object.keys(g.morphAttributes).length) return 'morph';
  // (geometry groups are ignored with a single material: the whole index is drawn)
  return true;
}

/** Copy of `g` (only the `need` attributes) baked by `m`: indexed, de-interleaved, winding kept for mirrors. */
function bakedCopy(g, m, need) {
  const out = new THREE.BufferGeometry();
  for (const k of Object.keys(g.attributes)) {
    if (!need.has(k)) continue;
    const a = g.attributes[k];
    if (a.isInterleavedBufferAttribute) {
      const arr = new a.data.array.constructor(a.count * a.itemSize);
      for (let i = 0; i < a.count; i++) for (let c = 0; c < a.itemSize; c++) arr[i * a.itemSize + c] = a.data.array[i * a.data.stride + a.offset + c];
      out.setAttribute(k, new THREE.BufferAttribute(arr, a.itemSize, a.normalized));
    } else out.setAttribute(k, a.clone());
  }
  if (g.index) out.setIndex(g.index.clone());
  else {
    const n = g.attributes.position.count;
    const idx = n > 65535 ? new Uint32Array(n) : new Uint16Array(n);
    for (let i = 0; i < n; i++) idx[i] = i;
    out.setIndex(new THREE.BufferAttribute(idx, 1));
  }
  out.applyMatrix4(m);
  if (m.determinant() < 0) {
    const ix = out.index;
    for (let i = 0; i + 2 < ix.count; i += 3) {
      const b = ix.getX(i + 1);
      ix.setX(i + 1, ix.getX(i + 2));
      ix.setX(i + 2, b);
    }
  }
  return out;
}

/** Concatenate indexed geometries with identical layouts. */
function concat(list) {
  const out = new THREE.BufferGeometry();
  let nv = 0;
  let ni = 0;
  for (const g of list) {
    nv += g.attributes.position.count;
    ni += g.index.count;
  }
  for (const k of Object.keys(list[0].attributes)) {
    const a0 = list[0].attributes[k];
    const arr = new a0.array.constructor(nv * a0.itemSize);
    let off = 0;
    for (const g of list) {
      const a = g.attributes[k];
      arr.set(a.array.subarray(0, a.count * a.itemSize), off);
      off += a.count * a.itemSize;
    }
    out.setAttribute(k, new THREE.BufferAttribute(arr, a0.itemSize, a0.normalized));
  }
  const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
  let vo = 0;
  let io = 0;
  for (const g of list) {
    const ix = g.index;
    for (let i = 0; i < ix.count; i++) idx[io++] = ix.getX(i) + vo;
    vo += g.attributes.position.count;
  }
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingSphere();
  out.computeBoundingBox();
  return out;
}

/** Transform of `obj` relative to `root` from the local matrices (root excluded). */
function relMatrix(obj, root, out) {
  obj.updateMatrix();
  out.copy(obj.matrix);
  for (let p = obj.parent; p && p !== root; p = p.parent) {
    p.updateMatrix();
    out.premultiply(p.matrix);
  }
  return out;
}

const SNAP = 11;
function snap(obj, arr, i) {
  const o = i * SNAP;
  arr[o] = obj.position.x;
  arr[o + 1] = obj.position.y;
  arr[o + 2] = obj.position.z;
  arr[o + 3] = obj.quaternion.x;
  arr[o + 4] = obj.quaternion.y;
  arr[o + 5] = obj.quaternion.z;
  arr[o + 6] = obj.quaternion.w;
  arr[o + 7] = obj.scale.x;
  arr[o + 8] = obj.scale.y;
  arr[o + 9] = obj.scale.z;
  arr[o + 10] = obj.visible ? 1 : 0;
}
function moved(obj, arr, i) {
  const o = i * SNAP;
  return arr[o] !== obj.position.x || arr[o + 1] !== obj.position.y || arr[o + 2] !== obj.position.z ||
    arr[o + 3] !== obj.quaternion.x || arr[o + 4] !== obj.quaternion.y || arr[o + 5] !== obj.quaternion.z || arr[o + 6] !== obj.quaternion.w ||
    arr[o + 7] !== obj.scale.x || arr[o + 8] !== obj.scale.y || arr[o + 9] !== obj.scale.z || arr[o + 10] !== (obj.visible ? 1 : 0);
}

/**
 * Merge the static meshes under `root` and keep watching them (see the file comment). Call once after
 * the build (layers and shadow flags final), with the root at its build transform.
 * @param {THREE.Object3D} root
 * @param {{dynamic?: Set<THREE.Object3D>, onChange?: Function}} [o] subtrees never merged; callback
 *   after a batch was rebuilt at runtime
 */
export function mergeStatic(root, o = {}) {
  const dynamic = o.dynamic || new Set();
  root.updateMatrixWorld(true);
  const plain = new Map(); // fingerprint -> representative material
  const groups = new Map(); // key -> group
  const recs = new Map(); // mesh -> record
  const stats = { released: 0, releasedNames: [], rebuilds: 0, skipped: {} };
  let meshesBefore = 0;
  let shared = 0;
  const visit = (obj) => {
    if (dynamic.has(obj) || !obj.visible) {
      obj.traverse((x) => { if (x.isMesh) meshesBefore++; });
      return;
    }
    if (obj.isMesh) meshesBefore++;
    const ok = obj.isMesh ? mergeable(obj) : false;
    if (obj.isMesh && ok !== true) stats.skipped[ok] = (stats.skipped[ok] || 0) + 1;
    if (ok === true) {
      let mat = obj.material;
      const fp = plainMaterialKey(mat);
      if (fp) {
        const rep = plain.get(fp);
        if (!rep) plain.set(fp, mat);
        else if (rep !== mat) {
          mat = rep;
          shared++;
        }
      }
      const need = neededAttributes(mat);
      // (shadow casting is decided per batch: small parts that would not cast on their own add a few
      // triangles to a casting batch rather than a draw call of their own)
      const key = `${mat.uuid}|${obj.receiveShadow ? 1 : 0}|${obj.renderOrder}|${obj.layers.mask}|${layoutKey(obj.geometry, need)}`;
      let grp = groups.get(key);
      if (!grp) groups.set(key, (grp = { key, mat, need, members: new Set(), mesh: null, dirty: false }));
      grp.members.add(obj);
      recs.set(obj, {
        mesh: obj, group: grp, material: obj.material, geometry: obj.geometry, mask: obj.layers.mask,
        bake: relMatrix(obj, root, new THREE.Matrix4()),
        instVersion: obj.isInstancedMesh ? obj.instanceMatrix.version : 0, instCount: obj.isInstancedMesh ? obj.count : 0,
      });
    }
    for (const c of obj.children) visit(c);
  };
  for (const c of root.children) visit(c);

  const build = (grp) => {
    if (grp.mesh) {
      grp.mesh.geometry.dispose();
      grp.mesh.removeFromParent();
      grp.mesh = null;
    }
    if (grp.members.size < 2) {
      // a batch of one gains nothing: the part is drawn on its own
      for (const m of [...grp.members]) {
        m.layers.mask = recs.get(m).mask;
        recs.delete(m);
        grp.members.delete(m);
      }
      return;
    }
    const geos = [];
    const mi = new THREE.Matrix4();
    let cast = false;
    let culled = true;
    for (const m of grp.members) {
      const r = recs.get(m);
      cast ||= m.castShadow;
      culled &&= m.frustumCulled;
      if (m.isInstancedMesh) {
        for (let i = 0; i < m.count; i++) {
          m.getMatrixAt(i, mi);
          geos.push(bakedCopy(m.geometry, mi.premultiply(r.bake), grp.need));
        }
      } else geos.push(bakedCopy(m.geometry, r.bake, grp.need));
    }
    const g = concat(geos);
    for (const x of geos) x.dispose();
    const first = grp.members.values().next().value;
    const mesh = new THREE.Mesh(g, grp.mat);
    mesh.name = `LMCabin:static:${grp.mat.name || grp.mat.type}`;
    mesh.castShadow = cast;
    mesh.receiveShadow = first.receiveShadow;
    mesh.renderOrder = first.renderOrder;
    mesh.layers.mask = recs.get(first).mask;
    mesh.frustumCulled = culled;
    mesh.userData.mergedFrom = grp.members.size;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    root.add(mesh);
    mesh.updateMatrixWorld(true);
    grp.mesh = mesh;
    for (const m of grp.members) m.layers.mask = 0; // hidden, still watched
  };
  /** Take a mesh out of its batch (drawn on its own again). */
  const release = (mesh) => {
    const r = recs.get(mesh);
    if (!r) return;
    recs.delete(mesh);
    mesh.layers.mask = r.mask;
    r.group.members.delete(mesh);
    r.group.dirty = true;
    stats.released++;
    stats.releasedNames.push(`${mesh.name || mesh.type}<${mesh.parent?.name || ''}<${mesh.parent?.parent?.name || ''}`);
    if (stats.releasedNames.length > 40) stats.releasedNames.shift();
  };

  for (const grp of groups.values()) build(grp);

  // ---- watch list: every merged mesh and its ancestors below the root
  let watchObjs = [];
  let watchSnap = null;
  let watchMeshes = new Map(); // watched object -> merged meshes below it (incl. itself)
  const rewatch = () => {
    const map = new Map();
    for (const mesh of recs.keys()) {
      for (let p = mesh; p && p !== root; p = p.parent) {
        let l = map.get(p);
        if (!l) map.set(p, (l = []));
        l.push(mesh);
      }
    }
    watchMeshes = map;
    watchObjs = [...map.keys()];
    watchSnap = new Float64Array(watchObjs.length * SNAP);
    watchObjs.forEach((obj, i) => snap(obj, watchSnap, i));
  };
  rewatch();

  const api = {
    groups,
    stats,
    meshesBefore,
    materialsShared: shared,
    get batches() {
      return [...groups.values()].filter((g) => g.mesh).map((g) => g.mesh);
    },
    /** Is `mesh` currently drawn through a batch? */
    isMerged: (mesh) => recs.has(mesh),
    /** Release meshes from their batches (e.g. their material/geometry is about to change). */
    release(meshes) {
      let n = 0;
      for (const m of meshes) if (recs.has(m)) {
        release(m);
        n++;
      }
      if (n) api.flush();
      return n;
    },
    /** Rebuild dirty batches and refresh the watch list. */
    flush() {
      let any = false;
      for (const grp of groups.values()) {
        if (!grp.dirty) continue;
        grp.dirty = false;
        build(grp);
        stats.rebuilds++;
        any = true;
      }
      rewatch();
      if (any) o.onChange?.();
      return any;
    },
    /**
     * Per-frame check (cheap: a few hundred number compares). Releases merged parts that moved,
     * changed visibility or material, or whose shared material was edited. Returns true if batches
     * were rebuilt.
     */
    check() {
      const hit = new Set();
      for (let i = 0; i < watchObjs.length; i++) {
        const obj = watchObjs[i];
        if (moved(obj, watchSnap, i)) for (const m of watchMeshes.get(obj)) hit.add(m);
      }
      for (const [mesh, r] of recs) {
        if (mesh.material !== r.material || mesh.geometry !== r.geometry || mesh.parent == null) hit.add(mesh);
        else if (r.instCount && (mesh.instanceMatrix.version !== r.instVersion || mesh.count !== r.instCount)) hit.add(mesh);
        else if (r.material !== r.group.mat && !sameLook(r.material, r.group.mat)) hit.add(mesh);
      }
      if (!hit.size) return false;
      for (const m of hit) release(m);
      return api.flush();
    },
  };
  return api;
}

/**
 * Atlas + merge + watch for a cabin root (see the file comment).
 * @param {THREE.Object3D} root
 * @param {object} o { quality: CABIN_QUALITY entry, dynamic: Set<Object3D>, pageSize, createCanvas,
 *   registerIntegral, onChange(): called after a runtime rebuild / revert (re-collect materials) }
 */
export function optimizeCabin(root, o = {}) {
  const Q = o.quality || CABIN_QUALITY.high;
  const tb = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const atlas = buildAtlas(root, { scale: Q.tex, pageSize: o.pageSize, createCanvas: o.createCanvas, registerIntegral: o.registerIntegral, skip: o.dynamic });
  const merge = mergeStatic(root, { dynamic: o.dynamic, onChange: o.onChange });
  const byMaterial = new Map();
  for (const r of atlas.records) {
    let l = byMaterial.get(r.source);
    if (!l) byMaterial.set(r.source, (l = []));
    l.push(r);
  }
  const stats = { reverted: 0, maxUpdateMs: 0, buildMs: (typeof performance !== 'undefined' ? performance.now() : Date.now()) - tb };
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  return {
    atlas,
    merge,
    stats,
    /** Per-frame watch: batches follow runtime edits; atlased canvases that get redrawn are restored. */
    update() {
      const t0 = now();
      const r = this._update();
      stats.maxUpdateMs = Math.max(stats.maxUpdateMs, now() - t0);
      return r;
    },
    _update() {
      let changed = false;
      for (const s of atlas.sources) {
        if (s.done) continue;
        const m = s.material;
        const edited = m.map !== s.map || s.map.version !== s.mapVersion || (s.aux && s.aux.version !== s.auxVersion) ||
          AUX_SLOTS.some((k) => m[k] && m[k] !== s.aux);
        if (!edited) continue;
        s.done = true;
        const list = byMaterial.get(m) || [];
        merge.release(list.map((r) => r.mesh));
        for (const r of list) {
          r.mesh.material = r.material;
          r.mesh.geometry = r.geometry;
        }
        stats.reverted += list.length;
        changed = true;
      }
      if (changed) o.onChange?.();
      return merge.check() || changed;
    },
  };
}
