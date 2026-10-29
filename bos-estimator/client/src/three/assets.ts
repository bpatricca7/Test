// Shared GPU assets (UI spec §9.5): module-level, lazily created singletons, disposed only when the Canvas unmounts.
// Nothing here is created per building: 3 facade styles × (diffuse + emissive) in one array texture, the 8
// grounds-kind patterns in another, one AO blob, and materials shared by key. Array textures (one GPU texture,
// one layer per pattern, native repeat wrapping and mipmaps) keep the GPU texture count inside the §10 budget
// of 24 with the High tier's Live post-processing chain.
import * as THREE from 'three';
import type { FacilityCategory, GroundsKind } from '@shared/types';

export type FacadeStyle = 'office' | 'barracks' | 'industrial';
export const STYLES: FacadeStyle[] = ['office', 'barracks', 'industrial'];
const INDUSTRIAL: FacilityCategory[] = ['warehouse', 'maintenance', 'hangar'];
export const styleOf = (c: FacilityCategory): FacadeStyle => (INDUSTRIAL.includes(c) ? 'industrial' : c === 'barracks' ? 'barracks' : 'office');
/** bay width (scene units) and bays per texture tile, per style */
export const BAYS: Record<FacadeStyle, { bayW: number; bays: number }> = { office: { bayW: 1.6, bays: 8 }, barracks: { bayW: 1.2, bays: 10 }, industrial: { bayW: 2.4, bays: 8 } };

export const seeded = (seed: string) => { let h = 2166136261; for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); } return () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; }; };

const disposables = new Set<{ dispose(): void }>();
const track = <T extends { dispose(): void }>(x: T): T => { disposables.add(x); return x; };

function canvasTex(c: HTMLCanvasElement, srgb = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 1;
  return track(t);
}

/** Copies canvases into the layers of one sRGB, mipmapped, repeat-wrapped array texture (rows flipped like a CanvasTexture). */
function arrayTexture(canvases: HTMLCanvasElement[]): THREE.DataArrayTexture {
  const w = canvases[0].width, h = canvases[0].height, layer = w * h * 4, stride = w * 4;
  const data = new Uint8Array(layer * canvases.length);
  canvases.forEach((c, i) => {
    const px = c.getContext('2d')!.getImageData(0, 0, w, h).data;
    for (let y = 0; y < h; y++) data.set(px.subarray((h - 1 - y) * stride, (h - y) * stride), i * layer + y * stride);
  });
  const t = new THREE.DataArrayTexture(data, w, h, canvases.length);
  t.format = THREE.RGBAFormat; t.type = THREE.UnsignedByteType; t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
  t.needsUpdate = true;
  return track(t);
}

/** Facade tile on a neutral white base (the wall tint comes from instance colour): 4 floors × N bays. */
function makeFacade(style: FacadeStyle) {
  const W = 256, H = 256, { bays } = BAYS[style], floors = 4;
  const diffuse = document.createElement('canvas'); diffuse.width = W; diffuse.height = H;
  const emis = document.createElement('canvas'); emis.width = W; emis.height = H;
  const d = diffuse.getContext('2d')!; const e = emis.getContext('2d')!;
  const rnd = seeded(`facade-${style}`);
  d.fillStyle = '#ffffff'; d.fillRect(0, 0, W, H);
  d.strokeStyle = 'rgba(0,0,0,0.22)'; d.lineWidth = 2;
  for (let f = 0; f <= floors; f++) { d.beginPath(); d.moveTo(0, (H / floors) * f); d.lineTo(W, (H / floors) * f); d.stroke(); }
  e.fillStyle = '#000'; e.fillRect(0, 0, W, H);
  const fh = H / floors, bw = W / bays;
  const glass = (x: number, y: number, w: number, h: number) => {
    // obsidian glazing: smoked, neutral glass with a hairline sill highlight
    const g = d.createLinearGradient(x, y, x + w, y + h); g.addColorStop(0, '#0f0f0f'); g.addColorStop(1, '#2a2a2a');
    d.fillStyle = g; d.fillRect(x, y, w, h);
    d.fillStyle = 'rgba(255,255,255,0.18)'; d.fillRect(x, y, w, 1);
    if (rnd() < 0.6) {
      // night: warm tungsten / sodium rooms against the cold massing, a few neutral-white offices
      const warm = rnd();
      e.fillStyle = warm < 0.86 ? `rgba(255,${168 + Math.floor(rnd() * 46)},${78 + Math.floor(rnd() * 52)},${0.82 + rnd() * 0.18})` : `rgba(255,${238 + Math.floor(rnd() * 14)},${214 + Math.floor(rnd() * 24)},${0.75 + rnd() * 0.25})`;
      e.fillRect(x + 1, y + 1, w - 2, h - 2);
    }
  };
  for (let f = 0; f < floors; f++) {
    for (let b = 0; b < bays; b++) {
      const x = b * bw, y = f * fh;
      if (style === 'industrial') {
        glass(x + 3, y + fh * 0.12, bw - 6, fh * 0.16); // clerestory strip
        if (b % 4 === 1) { // roll-up bay door at grade of each floor row
          const wx = x + 3, wy = y + fh * 0.42, ww = bw * 2 - 6, wh = fh * 0.58;
          d.fillStyle = '#8a8a8a'; d.fillRect(wx, wy, ww, wh);
          d.strokeStyle = 'rgba(0,0,0,.28)'; d.lineWidth = 1;
          for (let k = 1; k < 6; k++) { d.beginPath(); d.moveTo(wx, wy + (wh / 6) * k); d.lineTo(wx + ww, wy + (wh / 6) * k); d.stroke(); }
        }
      } else if (style === 'barracks') glass(x + bw * 0.27, y + fh * 0.24, bw * 0.46, fh * 0.48);
      else glass(x + bw * 0.12, y + fh * 0.2, bw * 0.76, fh * 0.56);
    }
  }
  return { diffuse, emis };
}

let facades: THREE.DataArrayTexture | null = null;
/** One array texture: layers 0–2 are the office / barracks / industrial diffuse tiles, layers 3–5 their lit windows. */
export function facadeTextures(): THREE.DataArrayTexture {
  if (!facades) { const f = STYLES.map(makeFacade); facades = arrayTexture([...f.map((x) => x.diffuse), ...f.map((x) => x.emis)]); }
  return facades;
}

/** 128² white-based pattern per grounds kind; tinted by the material colour, tiled per zone via UV scale. */
function patternCanvas(kind: GroundsKind): HTMLCanvasElement {
  const c = document.createElement('canvas'); c.width = 128; c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 128, 128);
  const rnd = seeded(`pattern-${kind}`);
  if (kind === 'improved_turf' || kind === 'athletic_field') {
    ctx.fillStyle = 'rgba(0,0,0,0.09)'; for (let i = 0; i < 128; i += 32) ctx.fillRect(0, i, 128, 16);
    if (kind === 'athletic_field') { ctx.strokeStyle = 'rgba(255,255,255,0.95)'; ctx.lineWidth = 3; ctx.strokeRect(10, 10, 108, 108); ctx.beginPath(); ctx.moveTo(64, 10); ctx.lineTo(64, 118); ctx.stroke(); ctx.beginPath(); ctx.arc(64, 64, 14, 0, Math.PI * 2); ctx.stroke(); }
  } else if (kind === 'parking') {
    ctx.fillStyle = 'rgba(0,0,0,0.08)'; ctx.fillRect(0, 56, 128, 16);
    ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 2;
    for (let x = 8; x < 128; x += 16) { ctx.beginPath(); ctx.moveTo(x, 6); ctx.lineTo(x, 50); ctx.moveTo(x, 78); ctx.lineTo(x, 122); ctx.stroke(); }
  } else if (kind === 'shrub_bed') {
    for (let i = 0; i < 46; i++) { ctx.fillStyle = `rgba(${90 + rnd() * 80},${170 + rnd() * 60},90,0.9)`; ctx.beginPath(); ctx.arc(rnd() * 128, rnd() * 128, 5 + rnd() * 7, 0, Math.PI * 2); ctx.fill(); }
  } else if (kind === 'tree_canopy') {
    ctx.fillStyle = 'rgba(0,0,0,0.12)'; ctx.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 20; i++) { ctx.fillStyle = `rgba(${40 + rnd() * 40},${140 + rnd() * 80},60,0.95)`; ctx.beginPath(); ctx.arc(rnd() * 128, rnd() * 128, 10 + rnd() * 9, 0, Math.PI * 2); ctx.fill(); }
  } else if (kind === 'semi_improved' || kind === 'unimproved') {
    for (let i = 0; i < 260; i++) { ctx.fillStyle = `rgba(0,0,0,${0.06 + rnd() * 0.16})`; ctx.fillRect(rnd() * 128, rnd() * 128, 2, 5); }
  } else if (kind === 'sidewalk') {
    ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 2; for (let x = 0; x < 128; x += 32) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 128); ctx.stroke(); }
  }
  return c;
}
export const PAD_KINDS: GroundsKind[] = ['improved_turf', 'semi_improved', 'unimproved', 'athletic_field', 'shrub_bed', 'parking', 'sidewalk', 'tree_canopy'];
let patterns: THREE.DataArrayTexture | null = null;
/** All grounds-kind patterns in one array texture; the layer of a kind is PAD_KINDS.indexOf(kind). */
export function kindTextures(): THREE.DataArrayTexture {
  if (!patterns) patterns = arrayTexture(PAD_KINDS.map(patternCanvas));
  return patterns;
}

let aoBlob: THREE.Texture | null = null;
/** Soft contact-shadow blob (alpha in the red channel is fine: used as alphaMap). */
export function aoTexture(): THREE.Texture {
  if (aoBlob) return aoBlob;
  const c = document.createElement('canvas'); c.width = 64; c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 64, 64);
  // rounded-rectangle falloff: draw blurred rect
  ctx.filter = 'blur(7px)'; ctx.fillStyle = '#fff'; ctx.fillRect(14, 14, 36, 36); ctx.filter = 'none';
  aoBlob = canvasTex(c, false);
  aoBlob.wrapS = aoBlob.wrapT = THREE.ClampToEdgeWrapping;
  return aoBlob;
}

// ---------------------------------------------------------------- materials (shared by key)
const mats = new Map<string, THREE.Material>();
export function mat<T extends THREE.Material>(key: string, make: () => T): T {
  let m = mats.get(key) as T | undefined;
  if (!m) { m = make(); mats.set(key, m); }
  return m;
}
/** Shaded material shared by key. Lambert: the scene has no glossy surfaces, and it is far cheaper per pixel. */
export const std = (key: string, p: THREE.MeshLambertMaterialParameters & { roughness?: number; metalness?: number }) => mat(key, () => {
  const { roughness: _r, metalness: _m, ...rest } = p; void _r; void _m;
  return new THREE.MeshLambertMaterial(rest);
});

/**
 * Irradiance / π for a horizontal surface (normal +y) under the current lights, written by Lighting every frame.
 * Flat surfaces in the Fast tier use unlit materials multiplied by it: identical to Lambert without shadows,
 * at a fraction of the per-pixel cost.
 */
export const flatLight = { value: new THREE.Color(1, 1, 1) };
/**
 * After dark a grounds pad keeps a little of its own colour on top of the scene's light: padFloor (written by Lighting,
 * 0.2 × the night factor) × the pad's colour, added by the pad shader in both tiers. A site-wide area takes it over its
 * whole face, so the large unimproved areas still read on the night board; a pad on a building lot only on its rim (the
 * hairline and the hover / selection / "just found" highlight): its turf is lit like the lot it covers and goes dark with
 * the rest of the campus. padNight is the strength of the faint night rim of every pad.
 */
export const padFloor = { value: 0 };
export const padNight = { value: 0 };
/** uPadFace: how much of the night floor a pad's face takes (1 site-wide area, 0 pad on a lot) */
const PAD_FACE_FLOOR = { value: 1 }, LOT_FACE_FLOOR = { value: 0 };

type Patch = (sh: THREE.WebGLProgramParametersWithUniforms) => void;
/** Flat-surface material: Lambert (receives shadows) in High, unlit × flatLight in Fast. */
export function surfaceMat(key: string, fast: boolean, p: { color: THREE.ColorRepresentation; map?: THREE.Texture | null; transparent?: boolean; opacity?: number; depthWrite?: boolean; polygonOffset?: boolean; polygonOffsetFactor?: number; polygonOffsetUnits?: number }, patch?: Patch, cacheKey?: string) {
  return mat(`${key}-${fast ? 'fast' : 'lit'}`, () => {
    const m: THREE.MeshBasicMaterial | THREE.MeshLambertMaterial = fast ? new THREE.MeshBasicMaterial(p) : new THREE.MeshLambertMaterial(p);
    m.onBeforeCompile = (sh) => {
      patch?.(sh);
      if (fast) {
        sh.uniforms.uFlatLight = sh.uniforms.uFlatLight ?? flatLight; // a patch may bring its own light term
        sh.fragmentShader = sh.fragmentShader
          .replace('#include <common>', '#include <common>\nuniform vec3 uFlatLight;')
          .replace('#include <alphamap_fragment>', 'diffuseColor.rgb *= uFlatLight;\n#include <alphamap_fragment>');
      }
    };
    if (cacheKey) m.customProgramCacheKey = () => `${cacheKey}-${fast ? 'fast' : 'lit'}`;
    else if (fast) m.customProgramCacheKey = () => 'flat-unlit';
    return m;
  });
}
export const basic = (key: string, p: THREE.MeshBasicMaterialParameters) => mat(key, () => new THREE.MeshBasicMaterial(p));

/** Uniforms shared by every field material: night factor, time, ground colour, edge light and selection. Written by Lighting. */
export const fieldUniforms = {
  uNight: { value: 0 },
  uTime: { value: 0 },
  /** the colour dimmed buildings sink toward (the site board) */
  uGround: { value: new THREE.Color('#191919') },
  // obsidian: box edges catch a LIGHT hairline (a chamfered scale-model edge), not a dark outline
  uEdge: { value: new THREE.Color('#e2e2e2') },
  /** emissive edge light (Live dusk / night): the chamfer hairlines draw the campus after dark */
  uEdgeGlow: { value: new THREE.Color(0, 0, 0) },
  /** "just found" (reader streaming): a white hairline flash, never blue, never the acid of selection */
  uRecent: { value: new THREE.Color('#ffffff') },
  uGhost: { value: new THREE.Color('#8a8a8a') },
  uOk: { value: new THREE.Color('#2fcf8e') },
  /** the acid accent: the selected building's edges */
  uSel: { value: new THREE.Color('#c6f43c') },
};

/**
 * Building field material (one per facade style): face-local world-unit UVs so windows keep their size on every
 * building, roof from `aRoof`, a light fwidth chamfer edge (replaces per-building <Edges>), lit windows and emissive
 * edges scaled by the night factor, and per-instance state: 1 hover, 2 hidden (hero), 3 dimmed, 4 superseded,
 * 5 recent, 6 re-found, 7 selected (the hero).
 *
 * Every edge is measured in screen pixels (fwidth of the face UV), so a hairline is the same 1–2 px on a hangar
 * and on a shed; faces only a few pixels across (the 350-building site from afar) thin their edge out so the roof
 * keeps its category colour, and their night glow fades so a dense site never turns into a white mesh.
 */
export function fieldMaterial(style: FacadeStyle): THREE.MeshLambertMaterial {
  return mat(`field-${style}`, () => {
    const tex = facadeTextures();
    const layer = STYLES.indexOf(style);
    const { bayW, bays } = BAYS[style];
    const m = new THREE.MeshLambertMaterial({ color: '#ffffff' });
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, fieldUniforms, { uFacade: { value: tex }, uFacLayer: { value: layer }, uTileW: { value: bayW * bays } });
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
          attribute vec3 aRoof; attribute vec3 aDims; attribute float aFloors; attribute float aState; attribute float aSeed; attribute float aBorn;
          uniform float uTileW; uniform float uTime;
          varying vec3 vRoof; varying vec2 vFacUv; varying vec2 vFace; varying float vTop; varying float vState;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          {
            vec3 pp = position + 0.5;
            vec3 an = abs(normal);
            vec2 f; vec2 fs;
            if (an.x > 0.5) { f = vec2(pp.z, pp.y); fs = vec2(aDims.z, aDims.y); }
            else if (an.z > 0.5) { f = vec2(pp.x, pp.y); fs = vec2(aDims.x, aDims.y); }
            else { f = vec2(pp.x, pp.z); fs = vec2(aDims.x, aDims.z); }
            vFace = f;
            vTop = step(0.5, normal.y);
            vFacUv = vec2(f.x * fs.x / uTileW + aSeed, f.y * aFloors / 4.0);
            vRoof = aRoof; vState = aState;
            float rise = clamp((uTime - aBorn) / 0.6, 0.0, 1.0);
            rise = 1.0 - pow(1.0 - rise, 3.0);
            transformed.y = (transformed.y + 0.5) * max(rise, 0.001) - 0.5;
          }`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
          uniform highp sampler2DArray uFacade; uniform float uFacLayer; uniform float uNight; uniform float uTime;
          uniform vec3 uGround; uniform vec3 uEdge; uniform vec3 uEdgeGlow; uniform vec3 uRecent; uniform vec3 uGhost; uniform vec3 uOk; uniform vec3 uSel;
          varying vec3 vRoof; varying vec2 vFacUv; varying vec2 vFace; varying float vTop; varying float vState;
          float bayer4(vec2 p) { ivec2 i = ivec2(mod(p, 4.0)); int k = i.x + i.y * 4;
            float m[16] = float[16](0.,8.,2.,10.,12.,4.,14.,6.,3.,11.,1.,9.,15.,7.,13.,5.); return (m[k] + 0.5) / 16.0; }`)
        .replace('#include <map_fragment>', `
          if (vState > 3.5 && vState < 4.5 && bayer4(gl_FragCoord.xy) > 0.4) discard;
          vec3 facade = texture(uFacade, vec3(vFacUv, uFacLayer)).rgb;`)
        .replace('#include <color_fragment>', `#include <color_fragment>
          if (vTop > 0.5) diffuseColor.rgb = vRoof; else diffuseColor.rgb *= facade;
          // obsidian night: the massing goes cold and dark (roofs keep their colour), so warm windows carry the scene
          if (vTop < 0.5) diffuseColor.rgb *= mix(vec3(1.0), vec3(0.40, 0.43, 0.48), uNight);
          vec2 fw = max(fwidth(vFace), vec2(1e-5));
          vec2 dpx = min(vFace, 1.0 - vFace) / fw;          // px to this face's edges
          float fpx = min(1.0 / fw.x, 1.0 / fw.y);          // the face's smaller side, in px
          float dmin = min(dpx.x, dpx.y);
          float edge = 1.0 - smoothstep(0.6, 1.9, dmin);
          // a roof only a few px across keeps its category colour: its hairline thins out
          float big = smoothstep(5.0, 28.0, fpx);
          diffuseColor.rgb = mix(diffuseColor.rgb, uEdge, edge * (vTop > 0.5 ? mix(0.10, 0.34, big) : mix(0.24, 0.42, big)));
          float recentE = 0.0; float selE = 0.0;
          if (vState > 0.5 && vState < 1.5) diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0), 0.08) * 1.06;
          else if (vState > 2.5 && vState < 3.5) diffuseColor.rgb = mix(diffuseColor.rgb, uGround, 0.7);
          else if (vState > 3.5 && vState < 4.5) diffuseColor.rgb = mix(diffuseColor.rgb, uGhost, 0.6);
          else if (vState > 4.5 && vState < 5.5) { recentE = 1.0 - smoothstep(0.9, 2.8, dmin); diffuseColor.rgb = mix(mix(diffuseColor.rgb, uRecent, 0.10), uRecent, recentE * 0.9); }
          else if (vState > 5.5 && vState < 6.5) diffuseColor.rgb = mix(diffuseColor.rgb, uOk, edge * 0.95);
          else if (vState > 6.5) { selE = 1.0 - smoothstep(1.4, 3.0, dmin); diffuseColor.rgb = mix(diffuseColor.rgb, uSel, selE * 0.95); }`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          {
            vec3 win = texture(uFacade, vec3(vFacUv, uFacLayer + 3.0)).rgb * (1.0 - vTop);
            float dimK = (vState > 2.5 && vState < 4.5) ? 0.2 : 1.0;
            totalEmissiveRadiance += win * uNight * 2.3 * dimK;
            // night edge light: a ~1 px core on the vertical corners and the parapet line (the ground line and the
            // roof rim at a fraction), white, fading out on faces too small to carry it
            float eV = 1.0 - smoothstep(0.3, 1.2, dpx.x);
            float eH = 1.0 - smoothstep(0.3, 1.2, dpx.y);
            float wallE = max(eV, eH * (vFace.y > 0.5 ? 1.0 : 0.3));
            float roofE = (1.0 - smoothstep(0.3, 1.2, dmin)) * 0.6;
            float glowE = mix(wallE, roofE, vTop) * smoothstep(4.0, 24.0, fpx);
            totalEmissiveRadiance += uEdgeGlow * glowE * dimK;
            // moonlit roofs: after dark a roof keeps a little of its own colour, so categories still read
            totalEmissiveRadiance += vRoof * vTop * uNight * 0.2 * dimK;
            if (vState > 4.5 && vState < 5.5) totalEmissiveRadiance += uRecent * recentE * (0.55 + 0.45 * sin(uTime * 6.0)) * 0.9;
            if (vState > 5.5 && vState < 6.5) totalEmissiveRadiance += uOk * edge * 1.2;
            if (vState > 6.5) totalEmissiveRadiance += uSel * selE * (0.3 + uNight * 1.1);
          }`);
    };
    m.customProgramCacheKey = () => `field-${style}`;
    return m;
  });
}

/**
 * The site's flat palette, written by Lighting every frame and applied by SiteProps: the colours the flat surfaces
 * should show (linear). Lit materials take `colour / exposure` as albedo, so Review, Live day and Live night are
 * art-directed palettes rather than accidents of the light rig; kerbGlow is added after lighting (sodium street light).
 */
export const sitePalette = {
  road: new THREE.Color('#2e2e2e'), kerb: new THREE.Color('#6c6c6c'), lot: new THREE.Color('#222222'), lotEdge: new THREE.Color('#3e3e3e'),
  dash: new THREE.Color('#7a7a7a'), kerbGlow: new THREE.Color(0, 0, 0), crown: new THREE.Color('#3a3f3a'),
  /** luminance of flatLight (irradiance / π on a horizontal surface) */
  exposure: 1,
};

/**
 * Ground: the black table the model sits on. Inside a rounded board one margin outside the campus bounds: the
 * board colour, a 100-ft (10 unit) / 500-ft grid that fades where perspective packs it tight, and a crisp rim. Around it,
 * a table that falls off into the room (uVoid); in the High tier, faint stepped contour rings on that table. Every
 * colour is final (the open ground is unlit), set per lighting mode by Lighting; uGlow lights the grid, the rim and
 * the rings after dark.
 */
export const groundUniforms = {
  uGrid1: { value: new THREE.Color('#202020') },
  uGrid2: { value: new THREE.Color('#2b2b2b') },
  uGridAmt: { value: 1 },
  uCenter: { value: new THREE.Vector2(0, 0) },
  uHalf: { value: new THREE.Vector2(60, 40) },
  uSiteR: { value: 80 },
  uBoardM: { value: 8 },
  /** derived from uSiteR on the CPU (Lighting): 1 / site radius and 1 / the contour ring spacing */
  uInvS: { value: 1 / 80 },
  uInvSp: { value: 1 / 24 },
  uBoard: { value: new THREE.Color('#191919') },
  uBoardEdge: { value: new THREE.Color('#333333') },
  uTable: { value: new THREE.Color('#101010') },
  uVoid: { value: new THREE.Color('#080808') },
  uContour: { value: new THREE.Color('#1a1a1a') },
  uGlow: { value: new THREE.Color(0, 0, 0) },
};
export const groundColor = new THREE.Color('#191919');
/**
 * The ground covers most of the viewport, and a software rasterizer (SwiftShader) runs every instruction of its
 * fragment shader for every ground pixel, branches included. So this shader is branch-free and lean: one derivative
 * pair serves every line, ramps are clamps, the board, the table pool and the rim share one signed distance, and the
 * contour rings (a sin warp and two more line evaluations cost as much as the whole grid) are kept to the High tier
 * as one set of unwarped rings. Fast-tier cost is within ~2 ms of the plain review grid it replaced (1920 × 1080).
 */
export function groundMaterial(fast: boolean, contours = false): THREE.MeshBasicMaterial | THREE.MeshLambertMaterial {
  const m = surfaceMat(contours ? 'ground-rings' : 'ground', fast, { color: '#191919' }, (sh) => {
    Object.assign(sh.uniforms, groundUniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGWorld;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        ${contours ? '#define GROUND_RINGS' : ''}
        uniform vec3 uGrid1; uniform vec3 uGrid2; uniform float uGridAmt; varying vec3 vGWorld;
        uniform vec2 uCenter; uniform vec2 uHalf; uniform float uSiteR; uniform float uBoardM; uniform float uInvS; uniform float uInvSp;
        uniform vec3 uBoard; uniform vec3 uBoardEdge; uniform vec3 uTable; uniform vec3 uVoid; uniform vec3 uContour; uniform vec3 uGlow;
        // a grid line of unit spacing in q, one pixel wide (w = fwidth(q)), fading out where the lines pack tight
        float gLine(vec2 q, vec2 w) { vec2 c = abs(fract(q - 0.5) - 0.5) / max(w, vec2(1e-5));
          return (1.0 - min(min(c.x, c.y), 1.0)) * clamp(1.52 - 4.35 * max(w.x, w.y), 0.0, 1.0); }`)
      // after the flat-light multiply: the ground's colours are final (art-directed per lighting mode)
      .replace('#include <alphamap_fragment>', `#include <alphamap_fragment>
        {
          vec2 p = vGWorld.xz - uCenter;
          float e = length(max(abs(p) - uHalf, 0.0)) - uBoardM;   // signed distance to the board's edge (< 0 on it)
          vec2 q1 = vGWorld.xz * 0.1; vec2 w1 = fwidth(q1);
          // pixels per world unit; |grad e| <= 1, so 1 / ipx bounds fwidth(e) (within 1.4x at the corners)
          float ipx = 0.1 / max(max(w1.x, w1.y), 1e-5);
          float t = e * uInvS;                                       // in site radii beyond the board's edge
          // the table: a pool of light around the board, falling off into the room
          float pool = clamp(1.0 - t * 0.74, 0.0, 1.0); pool *= pool;
          vec3 gc = mix(uVoid, uTable, pool);
          float k = 0.0;
          #ifdef GROUND_RINGS
          // stepped contour rings on the table, thinning out where perspective packs them tight
          float ring = clamp((t - 0.04) * 6.0, 0.0, 1.0) * clamp((1.25 - t) * 1.4, 0.0, 1.0) * uGridAmt;
          float wr = uInvSp / ipx;
          k = (1.0 - min(abs(fract(e * uInvSp - 0.5) - 0.5) / max(wr, 1e-5), 1.0)) * clamp(2.0 - wr * 7.0, 0.0, 1.0) * ring;
          gc = mix(gc, uContour, k);
          #endif
          // the board and its anti-aliased edge (the pool is 1 wherever the board shows), the survey grid (100-ft
          // lines on the board, 500-ft lines a little beyond it) and the crisp rim
          float board = clamp(0.5 - 0.5 * e * ipx, 0.0, 1.0);
          gc += (uBoard - gc) * board;
          float l1 = gLine(q1, w1) * board * uGridAmt;
          float l2 = gLine(q1 * 0.2, w1 * 0.2) * clamp(1.0 - t * 5.5, 0.0, 1.0) * uGridAmt;
          gc = mix(gc, uGrid1, l1);
          gc = mix(gc, uGrid2, l2);
          float rim = clamp(1.6 - abs(e) * ipx, 0.0, 1.0);
          gc = mix(gc, uBoardEdge, rim);
          // after dark only the 500-ft lines, the rim and the rings glow (faint blueprint hairlines)
          diffuseColor.rgb = gc + uGlow * max(max(k * 0.25, rim), max(l1 * 0.12, l2 * 0.8));
        }`);
  }, contours ? 'ground-table-rings' : 'ground-table');
  m.color.copy(groundColor);
  return m;
}

/**
 * Grounds pad material per kind: shared pattern, per-instance UV scale and highlight state. The rim is a 1 px
 * hairline of the pad's own turf tint; selection draws it acid, "just found" white (never the selection's acid,
 * never blue), hover lifts it. `lot`: a pad on a building lot, whose face takes no night floor (see padFloor); the
 * same shader either way, only a uniform differs.
 */
export function padMaterial(kind: GroundsKind, color: string, fast: boolean, border = color, lot = false): THREE.MeshBasicMaterial | THREE.MeshLambertMaterial {
  return surfaceMat(`pad-${kind}${lot ? '-lot' : ''}`, fast, { color, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }, (sh) => {
    sh.uniforms.uZone = { value: new THREE.Color(border) };
    sh.uniforms.uPadTex = { value: kindTextures() };
    sh.uniforms.uPadLayer = { value: Math.max(0, PAD_KINDS.indexOf(kind)) };
    sh.uniforms.uTime = fieldUniforms.uTime;
    sh.uniforms.uSel = fieldUniforms.uSel;
    sh.uniforms.uPadFloor = padFloor;
    sh.uniforms.uPadFace = lot ? LOT_FACE_FLOOR : PAD_FACE_FLOOR;
    sh.uniforms.uPadNight = padNight;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aUvScale; attribute float aPadState; varying float vPadState; varying vec2 vPadUv; varying vec2 vPadMapUv;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvPadState = aPadState; vPadUv = uv; vPadMapUv = uv * aUvScale;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uZone; uniform vec3 uSel; uniform float uTime; uniform float uPadFloor; uniform float uPadFace; uniform float uPadNight; uniform highp sampler2DArray uPadTex; uniform float uPadLayer; varying float vPadState; varying vec2 vPadUv; varying vec2 vPadMapUv;')
      .replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor *= texture(uPadTex, vec3(vPadMapUv, uPadLayer));')
      .replace('#include <color_fragment>', `#include <color_fragment>
        float padEdge = 0.0; vec3 padGlow;
        {
          vec2 fw = max(fwidth(vPadUv), vec2(1e-5));
          vec2 dpx = min(vPadUv, 1.0 - vPadUv) / fw;
          float edge = 1.0 - smoothstep(0.5, 1.5, min(dpx.x, dpx.y));
          float wide = 1.0 - smoothstep(1.0, 2.6, min(dpx.x, dpx.y));
          // the rim: the pad's own turf tint, lifted toward white (a graphite-model hairline, no cyan)
          vec3 border = mix(uZone, vec3(1.0), 0.32); float bk = edge * 0.55;
          if (vPadState > 0.5 && vPadState < 1.5) { diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0), 0.1); border = mix(uZone, vec3(1.0), 0.6); bk = edge * 0.8; }
          else if (vPadState > 1.5 && vPadState < 2.5) { diffuseColor.rgb = mix(diffuseColor.rgb, uSel, 0.16); border = uSel; bk = wide * 0.95; }
          else if (vPadState > 2.5 && vPadState < 3.5) diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.006), 0.6);
          else if (vPadState > 3.5) { float pulse = 0.75 + 0.25 * sin(uTime * 6.0); diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0), 0.10 * pulse); border = vec3(1.0); bk = wide * 0.9 * pulse; }
          diffuseColor.rgb = mix(diffuseColor.rgb, border, bk);
          padEdge = edge;
          // what keeps the night floor: the whole colour of a site-wide area, only the rim's share of it on a lot pad
          padGlow = mix(border * bk, diffuseColor.rgb, uPadFace);
        }`)
      // after dark (padFloor) a pad keeps a little of its own colour on top of the scene's light, the same term in
      // both tiers (see padFloor), and every pad a faint rim of its tint (padNight)
      .replace('#include <opaque_fragment>', '#include <opaque_fragment>\ngl_FragColor.rgb += padGlow * uPadFloor + uZone * (padEdge * uPadNight);');
  }, 'pad-instanced');
}

export function disposeAssets() {
  for (const m of mats.values()) m.dispose();
  mats.clear();
  for (const d of disposables) d.dispose();
  disposables.clear();
  facades = null; patterns = null; aoBlob = null;
}
