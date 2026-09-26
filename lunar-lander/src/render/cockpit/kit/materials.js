// Shared cockpit materials (both cabins) + global lamp / integral-lighting brightness control.
//
// Materials are cached by name: getMaterial('chrome') always returns the same instance, so
// hundreds of switches share a handful of programs. Never mutate a cached material for one
// object — clone it (createMaterial(name, overrides) returns a fresh, uncached copy).
import * as THREE from 'three';
import { rng } from './canvas.js';

/** Apollo cockpit colour palette (sRGB hex). */
export const COLORS = {
  panelGray: 0x5d6062, // Apollo instrument panel grey (LM & CM panels)
  panelDark: 0x2e3032,
  structure: 0x8c8f8a,
  label: 0xf2f2ee, // white panel lettering
  amber: 0xffb000,
  red: 0xff3020,
  green7seg: 0x6dff8a, // DSKY electroluminescent green
  red7seg: 0xff2a1a, // timers
  bezelBlack: 0x141516, // instrument bezels / faces
  guardRed: 0x9e1b16, // red switch covers
  knobBlack: 0x0d0d0e,
  cbWhite: 0xeae8e0, // circuit-breaker collar band
  betaCloth: 0xe7e3d6,
  lampBlue: 0x5aa8ff,
  lampWhite: 0xfff4dc,
  lampGreen: 0x7dff9a,
};

/** Emissive colours of lamps by name (linear-ish, chosen to read right after ACES). */
export const LAMP_COLORS = {
  red: new THREE.Color(1.0, 0.07, 0.035),
  amber: new THREE.Color(1.0, 0.55, 0.06),
  yellow: new THREE.Color(1.0, 0.78, 0.16),
  white: new THREE.Color(1.0, 0.93, 0.8),
  blue: new THREE.Color(0.25, 0.55, 1.0),
  green: new THREE.Color(0.38, 1.0, 0.52),
  el: new THREE.Color(0.42, 1.0, 0.55), // electroluminescent segment green
};

// ------------------------------------------------------------------------------ global lighting
/**
 * Global cockpit brightness knobs. `lamps` scales every indicator lamp / display (1 = nominal),
 * `integral` is the panel integral (lettering) lighting level 0..1 (the real LM/CM panels had
 * electroluminescent/incandescent lettering lighting dimmed by the crew).
 */
export const LIGHTING = {
  lamps: 1,
  integral: 0,
  integralColor: new THREE.Color(0.78, 0.9, 0.82),
  /** Auto-exposure compensation of every lamp / display (see setLampExposure); 1 = uncompensated. */
  exposureGain: 1,
};
/** Base emissive intensity of a lit lamp at LIGHTING.lamps = 1. */
export const LAMP_INTENSITY = 1.2;
const lampMats = new Set();
const integralMats = new Set();

const lampIntensity = (m) => (m.userData.lampBase ?? LAMP_INTENSITY) * LIGHTING.lamps * LIGHTING.exposureGain * (m.userData.lampOn ?? 1);

/** Register a material whose emissiveIntensity should follow LIGHTING.lamps (base * lamps * on). */
export function registerLamp(mat, base = LAMP_INTENSITY) {
  mat.userData.lampBase = base;
  if (mat.userData.lampOn == null) mat.userData.lampOn = 1;
  mat.emissiveIntensity = lampIntensity(mat);
  lampMats.add(mat);
  return mat;
}
/** Set a registered lamp material on (1) / off (0) / partial. */
export function setLampLevel(mat, level) {
  mat.userData.lampOn = level;
  mat.emissiveIntensity = lampIntensity(mat);
}
/** Scale all lamps and displays (e.g. from the cabin's exposure or a dimmer knob). */
export function setLampBrightness(k) {
  LIGHTING.lamps = k;
  for (const m of lampMats) m.emissiveIntensity = lampIntensity(m);
}

/** Exposure multiplier at which lamps / displays show their nominal (tuned) brightness: a sunlit cabin. */
export const LAMP_EXPOSURE_REF = 5;
/**
 * Auto-exposure compensation for self-luminous panel lights (ARCHITECTURE 7b: radiance ~ E^-0.5).
 * The post chain opens the exposure up to ~120x in a dark cabin; uncompensated, every lamp and display
 * then clips to a desaturated white/salmon blob. Scaling by sqrt(REF / multiplier) keeps them
 * brighter the darker the cabin (as the dark-adapted eye sees them) without burning out.
 * Cheap: only touches the materials when the gain moves by more than 1 %.
 * @param {{multiplier: number, valid?: boolean}|null} info  ctx.exposureInfo
 * @returns {number} the current gain
 */
export function setLampExposure(info) {
  if (!info || info.valid === false || !(info.multiplier > 0)) return LIGHTING.exposureGain;
  const g = Math.min(2, Math.max(0.12, Math.sqrt(LAMP_EXPOSURE_REF / info.multiplier)));
  if (Math.abs(g - LIGHTING.exposureGain) <= 0.01 * LIGHTING.exposureGain) return LIGHTING.exposureGain;
  LIGHTING.exposureGain = g;
  for (const m of lampMats) m.emissiveIntensity = lampIntensity(m);
  return g;
}
/**
 * Register a material for integral lighting: emissiveIntensity = LIGHTING.integral * userData.integralScale.
 * The emissive colour becomes the integral-lighting colour unless userData.keepEmissive is set.
 * (Panels made by createPaintedMaterial mask it with their aux map B channel = lettering.)
 */
export function registerIntegral(mat) {
  integralMats.add(mat);
  if (!mat.userData.keepEmissive) mat.emissive.copy(LIGHTING.integralColor);
  mat.emissiveIntensity = LIGHTING.integral * (mat.userData.integralScale ?? 1);
  return mat;
}
/**
 * Panel integral lighting (lettering glows). level 0..1 (~0.35 looks like a dimmed night cabin),
 * optional colour.
 */
export function setIntegralLighting(level, color) {
  LIGHTING.integral = level;
  if (color != null) LIGHTING.integralColor.set(color);
  for (const m of integralMats) {
    if (!m.userData.keepEmissive) m.emissive.copy(LIGHTING.integralColor);
    m.emissiveIntensity = level * (m.userData.integralScale ?? 1);
  }
}

// ------------------------------------------------------------------------------ glass smudges
let _smudge = null;
/** Shared roughness map for cover glass: mostly polished with faint wipes, dust and a fingerprint. */
export function glassSmudgeTexture() {
  if (_smudge) return _smudge;
  // G = roughness. Polished glass (0.06) with faint wipe marks and a fingerprint (<= ~0.12) and a
  // few dust specks. Keep it low: in direct sunlight a rough texel spreads the Sun's specular over a
  // wide cone and the whole window turns milky.
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = 'rgb(0,15,0)';
  g.fillRect(0, 0, 256, 256);
  const r = rng(4242);
  g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 5; i++) {
    g.strokeStyle = `rgba(0,${6 + r() * 8},0,0.5)`;
    g.lineWidth = 6 + r() * 14;
    g.beginPath();
    g.arc(r() * 256, r() * 256, 40 + r() * 120, r() * 6, r() * 6 + 1 + r());
    g.stroke();
  }
  for (let i = 0; i < 90; i++) {
    g.fillStyle = `rgba(0,${20 + r() * 30},0,${0.4 + r() * 0.5})`;
    g.fillRect(r() * 256, r() * 256, 1, 1);
  }
  const fx = 60 + r() * 140;
  const fy = 60 + r() * 140;
  for (let k = 0; k < 14; k++) {
    g.strokeStyle = 'rgba(0,14,0,0.5)';
    g.lineWidth = 1.2;
    g.beginPath();
    g.ellipse(fx, fy, 4 + k * 1.6, 6 + k * 2.0, 0.4, 0, Math.PI * 2);
    g.stroke();
  }
  _smudge = new THREE.CanvasTexture(c);
  _smudge.wrapS = _smudge.wrapT = THREE.RepeatWrapping;
  return _smudge;
}

// ------------------------------------------------------------------------------ material table
const DEFS = {
  // satin chrome toggle levers (stainless "bat handles")
  chrome: () => new THREE.MeshStandardMaterial({ color: 0xe4e4e2, metalness: 1, roughness: 0.22, envMapIntensity: 0.7 }),
  // cadmium/nickel plated hardware: nuts, bushings, washers
  satinMetal: () => new THREE.MeshStandardMaterial({ color: 0xb4b4ae, metalness: 1, roughness: 0.36 }),
  darkMetal: () => new THREE.MeshStandardMaterial({ color: 0x4a4b4c, metalness: 0.85, roughness: 0.42 }),
  aluminium: () => new THREE.MeshStandardMaterial({ color: 0xc7c8c5, metalness: 1, roughness: 0.34 }),
  // black anodised / painted parts
  blackKnob: () => new THREE.MeshStandardMaterial({ color: COLORS.knobBlack, roughness: 0.38, metalness: 0.0 }),
  blackPaint: () => new THREE.MeshStandardMaterial({ color: COLORS.bezelBlack, roughness: 0.72, metalness: 0.05 }),
  blackGloss: () => new THREE.MeshStandardMaterial({ color: 0x0a0a0b, roughness: 0.18, metalness: 0.0 }),
  white: () => new THREE.MeshStandardMaterial({ color: COLORS.cbWhite, roughness: 0.45 }),
  // grey paint (guards, brackets) matches the panels
  panelGray: () => new THREE.MeshStandardMaterial({ color: COLORS.panelGray, roughness: 0.55, metalness: 0.05 }),
  guardGray: () => new THREE.MeshStandardMaterial({ color: 0x6a6d6f, roughness: 0.5, metalness: 0.1 }),
  guardRed: () => new THREE.MeshStandardMaterial({ color: COLORS.guardRed, roughness: 0.42, metalness: 0.0 }),
  // instanced parts coloured per instance (instanceColor) — base colour must stay white
  instancePaint: () => new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, metalness: 0.08 }),
  structure: () => new THREE.MeshStandardMaterial({ color: COLORS.structure, roughness: 0.6, metalness: 0.3 }),
  betaCloth: () => new THREE.MeshStandardMaterial({ color: COLORS.betaCloth, roughness: 0.95, metalness: 0 }),
  rubber: () => new THREE.MeshStandardMaterial({ color: 0x1b1b1b, roughness: 0.92, metalness: 0 }),
  wire: () => new THREE.MeshStandardMaterial({ color: 0xd9d4c4, roughness: 0.55, metalness: 0 }),
  // cover glass: additive, so only the reflection (Fresnel env + Sun glint) is added on top
  glass: () =>
    new THREE.MeshStandardMaterial({
      color: 0x000000,
      roughness: 1,
      roughnessMap: glassSmudgeTexture(),
      metalness: 0,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      // scene.environment is the OUTSIDE world (bright ground, the Sun) and knows nothing about the
      // cabin walls: by default the glass ignores it and only shows (shadowed) sunLight glints. A cabin
      // environment (setCabinEnvironment) re-enables soft interior reflections.
      envMapIntensity: 0.0,
    }),
  // slight dark tint behind the cover glass (normal blending, no reflections)
  glassTint: () => new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.12, depthWrite: false }),
};
const cache = new Map();

/**
 * Shared cockpit material by name: chrome, satinMetal, darkMetal, aluminium, blackKnob, blackPaint,
 * blackGloss, white, panelGray, guardGray, guardRed, instancePaint, structure, betaCloth, rubber,
 * wire, glass, glassTint. Returned instances are SHARED — do not modify; use createMaterial().
 * @param {string} name
 * @returns {THREE.Material}
 */
export function getMaterial(name) {
  let m = cache.get(name);
  if (!m) {
    const f = DEFS[name];
    if (!f) throw new Error(`cockpit kit: unknown material '${name}'`);
    m = f();
    m.name = 'kit:' + name;
    cache.set(name, m);
  }
  return m;
}

/** Depth materials reserved for instanced shadow casters (see useInstancedShadowDepth). */
let _instDepth = null;

/**
 * Give an InstancedMesh its own shadow depth material. Without it, three renders every shadow caster
 * with ONE shared MeshDepthMaterial and re-checks/switches its program whenever consecutive casters
 * differ in "instanced" or "has instanceColor" — which, with the kit's hundreds of instanced switch
 * and breaker banks interleaved with ordinary meshes, happens on nearly every draw (more than half of
 * the IVA shadow pass CPU). Two dedicated materials (plain / instanceColor) keep each program stable.
 * The choice is made per render (getter), so instanceColor added later is handled.
 * @param {THREE.InstancedMesh} mesh
 * @returns {THREE.InstancedMesh} the same mesh
 */
export function useInstancedShadowDepth(mesh) {
  if (!mesh?.isInstancedMesh) return mesh;
  if (!_instDepth) {
    _instDepth = [new THREE.MeshDepthMaterial(), new THREE.MeshDepthMaterial()];
    _instDepth[0].name = 'kit:instancedDepth';
    _instDepth[1].name = 'kit:instancedDepthColor';
  }
  const [plain, colored] = _instDepth;
  Object.defineProperty(mesh, 'customDepthMaterial', {
    configurable: true,
    enumerable: false,
    get() {
      return this.instanceColor ? colored : plain;
    },
    set(v) {
      // an explicit assignment (e.g. by a cabin) replaces the automatic choice
      Object.defineProperty(this, 'customDepthMaterial', { value: v, writable: true, configurable: true });
    },
  });
  return mesh;
}

/** Fresh (uncached) copy of a named material with property overrides. */
export function createMaterial(name, overrides = {}) {
  const m = DEFS[name]();
  m.name = 'kit:' + name;
  for (const [k, v] of Object.entries(overrides)) {
    if (m[k] && m[k].isColor) m[k].set(v);
    else m[k] = v;
  }
  return m;
}

/** Shared materials whose look is dominated by reflections (see setCabinEnvironment). */
const REFLECTIVE = ['chrome', 'satinMetal', 'darkMetal', 'aluminium', 'blackGloss', 'glass'];

/**
 * Give the kit's reflective materials (chrome levers, plated nuts, cover glass...) a dedicated
 * environment map instead of scene.environment. The scene environment is the OUTSIDE world (black
 * sky + Sun + lunar ground); inside a closed cabin it makes every lever and glass show the Sun even
 * in shadow. A cabin can render a PMREM of its own interior (grey panels, window patches) and pass it
 * here. Pass null to fall back to scene.environment.
 * @param {THREE.Texture|null} envMap
 * @param {{intensity?: number, glassIntensity?: number}} [o]
 */
export function setCabinEnvironment(envMap, o = {}) {
  for (const name of REFLECTIVE) {
    const m = getMaterial(name);
    m.envMap = envMap || null;
    m.envMapIntensity = name === 'glass' ? o.glassIntensity ?? (envMap ? 0.8 : 0.0) : o.intensity ?? (envMap ? 1 : name === 'chrome' ? 0.7 : 1);
    m.needsUpdate = true;
  }
}

/**
 * Procedural cabin-interior environment (PMREM) for the kit's reflective materials: medium-grey
 * panels all round, a darker floor, dim structure above, and optional bright window patches
 * (sunlit lunar surface seen through the windows). Returns the PMREM texture; pass it to
 * setCabinEnvironment(). Directions are in the space of `object` (cabin root) — give the window
 * directions in that frame and re-create it if the cabin's world orientation matters to you
 * (reflections are subtle, a fixed interior is usually fine).
 * @param {THREE.WebGLRenderer} renderer
 * @param {{windows?: Array<{dir: THREE.Vector3, size?: number, radiance?: number}>, panel?: number,
 *   up?: THREE.Vector3}} [o] panel = grey radiance (default 0.3), up = cabin up (default +Y)
 * @returns {THREE.Texture}
 */
export function createCabinEnvironment(renderer, o = {}) {
  const scene = new THREE.Scene();
  const up = (o.up || new THREE.Vector3(0, 1, 0)).clone().normalize();
  const panel = o.panel ?? 0.3;
  const room = new THREE.Mesh(
    new THREE.SphereGeometry(5, 48, 24),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: { uUp: { value: up }, uPanel: { value: panel } },
      vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: `uniform vec3 uUp; uniform float uPanel; varying vec3 vD;
        void main(){
          float h = dot(normalize(vD), uUp);
          // grey panels around, darker floor, dim structure overhead, fine banding like panel rows
          float c = uPanel * mix(0.45, 1.0, smoothstep(-0.6, -0.1, h)) * mix(1.0, 0.6, smoothstep(0.5, 0.95, h));
          c *= 0.85 + 0.15 * step(0.5, fract(h * 9.0));
          gl_FragColor = vec4(vec3(c) * vec3(1.0, 0.99, 0.97), 1.0);
        }`,
    }),
  );
  scene.add(room);
  for (const w of o.windows || []) {
    const m = new THREE.Mesh(new THREE.CircleGeometry(w.size ?? 1.2, 3), new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.98, 0.95).multiplyScalar(w.radiance ?? 1.2), side: THREE.DoubleSide }));
    m.position.copy(w.dir).normalize().multiplyScalar(4.5);
    m.lookAt(0, 0, 0);
    scene.add(m);
  }
  const pm = new THREE.PMREMGenerator(renderer);
  const tex = pm.fromScene(scene, 0.03).texture;
  pm.dispose();
  room.geometry.dispose();
  return tex;
}

/** Names of all shared materials (documentation / debugging). */
export const MATERIAL_NAMES = Object.keys(DEFS);

/**
 * Material for a painted panel / instrument face made by a painter: albedo map + aux map
 * (R bump, G roughness, B integral-lighting mask).
 * @param {{color: {texture}, aux?: {texture}}} painter
 * @param {object} [o] { bumpScale=0.6, metalness=0.05, integral=true, integralScale=1 }
 */
export function createPaintedMaterial(painter, o = {}) {
  const aux = painter.aux?.texture;
  const mat = new THREE.MeshStandardMaterial({
    map: painter.color.texture,
    roughness: aux ? 1 : o.roughness ?? 0.55,
    roughnessMap: aux || null,
    bumpMap: aux || null,
    bumpScale: o.bumpScale ?? 0.6,
    metalness: o.metalness ?? 0.05,
  });
  if (aux && o.integral !== false) {
    // integral lighting: emissive masked by the aux B channel
    mat.emissiveMap = aux;
    mat.userData.integralScale = o.integralScale ?? 1;
    mat.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace(
        '#include <emissivemap_fragment>',
        `#ifdef USE_EMISSIVEMAP
          totalEmissiveRadiance *= texture2D( emissiveMap, vEmissiveMapUv ).b;
        #endif`,
      );
    };
    mat.customProgramCacheKey = () => 'kit-integral';
    registerIntegral(mat);
  }
  return mat;
}
