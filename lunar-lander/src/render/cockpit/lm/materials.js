// Materials of the LM crew compartment (LM-CABIN agent).
//
// All are MeshStandardMaterial (PBR, lit by ctx.sunLight through the windows, the cabin floods and
// the window bounce lights). They do NOT use scene.environment (the OUTSIDE world: bright ground and
// the Sun would light the closed cabin through its walls); instead every material gets the cabin's
// own interior environment map (see lighting.js), rotated with the vessel each frame.
import * as THREE from 'three';
import { COLORS } from '../kit/index.js';
import { liningTextures, quiltTextures, clothTextures, floorTextures, hoseTextures, wireTextures, velcroTextures, anodizedTextures } from './textures.js';

/**
 * Create the cabin material set.
 * @returns {{get(key: string): THREE.Material, all: THREE.Material[], setEnv(tex: THREE.Texture|null, intensity?: number): void,
 *   setEnvRotation(q: THREE.Quaternion): void}}
 */
export function createCabinMaterials() {
  const mats = new Map();
  const std = (key, o, extra = {}) => {
    const m = new THREE.MeshStandardMaterial(o);
    m.name = 'lmcabin:' + key;
    m.userData.envScale = extra.envScale ?? 1;
    if (extra.noShadow) m.userData.noShadow = true;
    mats.set(key, m);
    return m;
  };
  const lin = liningTextures();
  std('lining', { color: 0xffffff, map: lin.map, bumpMap: lin.bump, bumpScale: 1.2, roughness: 0.62, metalness: 0.15 });
  std('liningDark', { color: 0x8e908b, map: lin.map, bumpMap: lin.bump, bumpScale: 1.2, roughness: 0.66, metalness: 0.12 });
  const q = quiltTextures();
  std('quilt', { color: 0xffffff, map: q.map, bumpMap: q.bump, bumpScale: 3.0, roughness: 0.95, metalness: 0 });
  const cl = clothTextures('#d6cfbd');
  std('beta', { color: 0xffffff, map: cl.map, bumpMap: cl.bump, bumpScale: 1.5, roughness: 0.93, metalness: 0 });
  const cw = clothTextures('#dcd9d0', 37);
  std('betaWhite', { color: 0xffffff, map: cw.map, bumpMap: cw.bump, bumpScale: 1.5, roughness: 0.9, metalness: 0 });
  const fl = floorTextures();
  std('floor', { color: 0xffffff, map: fl.map, bumpMap: fl.bump, bumpScale: 0.8, roughness: 0.78, metalness: 0.2 });
  std('structure', { color: 0x80837f, roughness: 0.55, metalness: 0.35 });
  std('structureDark', { color: 0x4c4e4c, roughness: 0.6, metalness: 0.3 });
  const an = anodizedTextures();
  std('frame', { color: 0xffffff, map: an.map, roughness: 0.72, metalness: 0.2 });
  std('console', { color: COLORS.panelGray, roughness: 0.58, metalness: 0.08 });
  std('metal', { color: 0xc9cac6, roughness: 0.3, metalness: 1.0 });
  std('darkMetal', { color: 0x505254, roughness: 0.42, metalness: 0.85 });
  std('rubber', { color: 0x1c1c1c, roughness: 0.9, metalness: 0 });
  std('black', { color: 0x151516, roughness: 0.7, metalness: 0.05 });
  const vc = velcroTextures();
  std('velcro', { color: 0xffffff, map: vc.map, bumpMap: vc.bump, bumpScale: 2, roughness: 1, metalness: 0 });
  const hb = hoseTextures('#3f6391');
  std('hoseBlue', { color: 0xffffff, map: hb.map, bumpMap: hb.bump, bumpScale: 2.5, roughness: 0.55, metalness: 0 });
  const hg = hoseTextures('#9da3a7');
  std('hoseGrey', { color: 0xffffff, map: hg.map, bumpMap: hg.bump, bumpScale: 2.5, roughness: 0.55, metalness: 0 });
  const wr = wireTextures();
  std('wire', { color: 0xcbc6b8, map: wr.map, bumpMap: wr.bump, bumpScale: 1.5, roughness: 0.6, metalness: 0 });
  std('cable', { color: 0x2a2b2c, roughness: 0.6, metalness: 0 });
  std('strap', { color: 0xd8d2bf, map: cl.map, roughness: 0.9, metalness: 0 });
  std('pad', { color: 0x55575a, map: cl.map, bumpMap: cl.bump, bumpScale: 1.2, roughness: 0.9, metalness: 0 });
  std('red', { color: 0xa3231b, roughness: 0.45, metalness: 0 });
  std('yellow', { color: 0xd8a818, roughness: 0.5, metalness: 0 });
  std('shade', { color: 0xc9c6bc, map: cl.map, roughness: 0.6, metalness: 0.3 });
  std('white', { color: 0xecebe6, roughness: 0.5, metalness: 0 });
  std('connector', { color: 0x9a8a5a, roughness: 0.35, metalness: 0.9 }); // gold-anodised/cadmium fittings
  // floodlight lens: emissive, driven by lighting.js
  std('floodLens', { color: 0x9a978e, emissive: 0xfff1d6, emissiveIntensity: 0, roughness: 0.4 }, { noShadow: true });
  // window glass (inner pane): reflective only (additive), smudged
  const glass = std(
    'glass',
    {
      color: 0x000000,
      roughness: 0.28,
      metalness: 0,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    },
    { envScale: 0.9, noShadow: true },
  );
  glass.userData.glass = true;
  // The panes only show the (rough, Fresnel-weighted) interior environment: point-light glints of
  // the floods would appear as haze orbs over the black sky, and there is no planar reflection.
  glass.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace(
      '#include <lights_fragment_end>',
      '#include <lights_fragment_end>\n  reflectedLight.directSpecular = vec3(0.0);\n  reflectedLight.directDiffuse = vec3(0.0);',
    );
  };
  glass.customProgramCacheKey = () => 'lmcabin-glass';
  // pane edge tint (the thick fused-silica panes look faintly green-blue at their edges)
  std('paneEdge', { color: 0x2f4a48, roughness: 0.1, metalness: 0.2, transparent: true, opacity: 0.55, depthWrite: false }, { noShadow: true });
  // LPD reticle marks (etched, dark)
  std('lpdMark', { color: 0x0b0b0c, roughness: 0.6, metalness: 0, transparent: true, opacity: 0.88, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }, { noShadow: true });

  const all = [...mats.values()];
  return {
    get(key) {
      const m = mats.get(key);
      if (!m) throw new Error(`lmCabin: unknown material '${key}'`);
      return m;
    },
    has: (key) => mats.has(key),
    all,
    /** Give every cabin material the interior environment map. */
    setEnv(tex, intensity = 1) {
      for (const m of all) {
        m.envMap = tex;
        m.envMapIntensity = intensity * (m.userData.envScale ?? 1);
        m.needsUpdate = true;
      }
    },
    /** Scale env intensity (per frame, cheap). */
    setEnvIntensity(intensity) {
      for (const m of all) m.envMapIntensity = intensity * (m.userData.envScale ?? 1);
    },
    /** Rotate the env lookup so the cabin-space env map follows the vessel attitude. */
    setEnvRotation(q) {
      for (const m of all) m.envMapRotation.setFromQuaternion(q);
    },
  };
}
