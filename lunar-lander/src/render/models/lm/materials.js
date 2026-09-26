// PBR material set for the Lunar Module exterior.
//
// All UVs produced by geom.js are in metres, so each material decides how many metres one texture
// tile covers (cloned textures share the same GPU image — three.js dedupes by Source).
// Lighting comes from ctx.sunLight (with shadows), ctx.fillLight (lunar-surface bounce) and
// scene.environment (black sky + bright lunar ground) — the foil's look depends on the latter:
// facets tilted toward the ground glow gold, facets reflecting the sky go dark brown.

import * as THREE from 'three';
import { foilTextures, quiltTextures, panelTextures, flagPanelTexture, plaqueTexture, markingsTexture, cloneTex } from './textures.js';

function rep(tex, metresPerTile, rot = 0) {
  if (!tex) return null;
  const t = cloneTex(tex);
  t.repeat.set(1 / metresPerTile, 1 / metresPerTile);
  t.rotation = rot;
  t.needsUpdate = true;
  return t;
}

/**
 * Create every material used by the LM model.
 * @param {object} [opts]
 * @param {'low'|'medium'|'high'} [opts.quality]
 * @returns {Object<string, THREE.Material>}
 */
export function createLMMaterials({ quality = 'high' } = {}) {
  const big = quality === 'low' ? 512 : 1024;
  const foil = foilTextures(big, 7);
  const foil2 = foilTextures(quality === 'low' ? 256 : 512, 19);
  const quilt = quiltTextures(quality === 'low' ? 256 : 512, 11);
  const panel = panelTextures(big, 23);

  const M = {};
  const std = (p) => new THREE.MeshStandardMaterial(p);

  // ---- thermal blankets (descent stage, struts, ascent-stage underside) ----
  // Aluminized Kapton: an amber polyimide film over vapour-deposited aluminium. Metallic, amber
  // specular colour, mostly glossy — the crinkles do the rest.
  M.gold = std({
    name: 'LM gold Kapton',
    color: new THREE.Color(0.96, 0.58, 0.2),
    map: rep(foil.tint, 1.1),
    metalness: 0.92,
    roughness: 1.0,
    roughnessMap: rep(foil.rough, 1.1),
    normalMap: rep(foil.normal, 1.1),
    normalScale: new THREE.Vector2(1.0, 1.0),
  });
  // deeper, browner Kapton layers (thicker film / different lot) used on some panels
  M.bronze = std({
    name: 'LM bronze Kapton',
    color: new THREE.Color(0.78, 0.42, 0.14),
    map: rep(foil.tint, 0.95, 1.3),
    metalness: 0.92,
    roughness: 1.0,
    roughnessMap: rep(foil.rough, 0.95, 1.3),
    normalMap: rep(foil.normal, 0.95, 1.3),
    normalScale: new THREE.Vector2(1.0, 1.0),
  });
  // gold wrap on the landing-gear struts: tighter crinkles
  M.goldWrap = std({
    name: 'LM strut gold wrap',
    color: new THREE.Color(0.95, 0.57, 0.19),
    map: rep(foil2.tint, 0.35),
    metalness: 0.92,
    roughness: 1.0,
    roughnessMap: rep(foil2.rough, 0.35),
    normalMap: rep(foil2.normal, 0.35),
    normalScale: new THREE.Vector2(0.9, 0.9),
  });
  // footpad foil: same Kapton, but dulled (scuffed, dusty) so it does not flare
  M.padFoil = std({
    name: 'LM footpad foil',
    color: new THREE.Color(0.8, 0.5, 0.2),
    map: rep(foil2.tint, 0.3),
    metalness: 0.85,
    roughness: 1.6,
    roughnessMap: rep(foil2.rough, 0.3),
    normalMap: rep(foil2.normal, 0.3),
    normalScale: new THREE.Vector2(0.8, 0.8),
  });
  // aluminized Mylar (silver) — MESA, quadrant bays
  M.silver = std({
    name: 'LM silver Mylar',
    color: new THREE.Color(0.86, 0.87, 0.88),
    map: rep(foil.tint, 0.8, 0.7),
    metalness: 0.9,
    roughness: 1.0,
    roughnessMap: rep(foil.rough, 0.8, 0.7),
    normalMap: rep(foil.normal, 0.8, 0.7),
    normalScale: new THREE.Vector2(0.9, 0.9),
  });
  // black H-film (Kapton) outer layers on the lower descent stage: glossy black dielectric
  M.blackFoil = std({
    name: 'LM black H-film',
    color: new THREE.Color(0.018, 0.017, 0.016),
    metalness: 0.0,
    roughness: 1.0,
    roughnessMap: rep(foil.rough, 0.9, 2.1),
    normalMap: rep(foil.normal, 0.9, 2.1),
    normalScale: new THREE.Vector2(0.9, 0.9),
  });
  // Inconel foil (charcoal, metallic) around the descent-engine base heat shield
  M.inconel = std({
    name: 'LM Inconel foil',
    color: new THREE.Color(0.24, 0.22, 0.2),
    map: rep(foil.tint, 0.7, 0.4),
    metalness: 0.9,
    roughness: 1.0,
    roughnessMap: rep(foil.rough, 0.7, 0.4),
    normalMap: rep(foil.normal, 0.7, 0.4),
    normalScale: new THREE.Vector2(0.8, 0.8),
  });
  // quilted black blankets (ascent stage top & aft, quad housings)
  M.blackQuilt = std({
    name: 'LM black quilted blanket',
    color: new THREE.Color(0.03, 0.03, 0.032),
    metalness: 0.0,
    roughness: 1.0,
    roughnessMap: rep(quilt.rough, 0.6),
    normalMap: rep(quilt.normal, 0.6),
    normalScale: new THREE.Vector2(1.0, 1.0),
  });

  // ---- ascent stage skin ----
  // Micrometeoroid-shield panels: grey anodized / Inconel-coloured thin aluminium, riveted.
  M.asGrey = std({
    name: 'LM ascent grey panels',
    color: new THREE.Color(0.3, 0.305, 0.31),
    map: rep(panel.tint, 2.0),
    metalness: 0.3,
    roughness: 1.0,
    roughnessMap: rep(panel.rough, 2.0),
    normalMap: rep(panel.normal, 2.0),
    normalScale: new THREE.Vector2(1.0, 1.0),
  });
  // black-anodized panels (around the windows, upper deck, docking tunnel)
  M.asBlack = std({
    name: 'LM ascent black panels',
    color: new THREE.Color(0.045, 0.045, 0.048),
    map: rep(panel.tint, 1.7, 0.2),
    metalness: 0.35,
    roughness: 1.0,
    roughnessMap: rep(panel.rough, 1.7, 0.2),
    normalMap: rep(panel.normal, 1.7, 0.2),
    normalScale: new THREE.Vector2(1.0, 1.0),
  });

  // ---- hardware ----
  M.metal = std({ name: 'LM bare aluminium', color: new THREE.Color(0.78, 0.79, 0.8), metalness: 1.0, roughness: 0.34 });
  M.steel = std({ name: 'LM stainless', color: new THREE.Color(0.66, 0.66, 0.67), metalness: 1.0, roughness: 0.25 });
  M.darkMetal = std({ name: 'LM dark metal', color: new THREE.Color(0.16, 0.16, 0.17), metalness: 0.8, roughness: 0.42 });
  M.white = std({ name: 'LM white paint', color: new THREE.Color(0.82, 0.81, 0.78), metalness: 0.0, roughness: 0.55 });
  M.black = std({ name: 'LM flat black', color: new THREE.Color(0.02, 0.02, 0.022), metalness: 0.0, roughness: 0.7 });
  // radiation-cooled niobium (columbium) nozzle extensions with silicide coating: dark, faintly metallic
  M.nozzleExt = std({ name: 'LM columbium nozzle', color: new THREE.Color(0.09, 0.085, 0.095), metalness: 0.6, roughness: 0.55 });
  M.nozzleInner = std({ name: 'LM nozzle interior', color: new THREE.Color(0.035, 0.032, 0.03), metalness: 0.2, roughness: 0.8 });
  M.rcsNozzle = std({ name: 'LM RCS nozzle', color: new THREE.Color(0.3, 0.29, 0.3), metalness: 0.85, roughness: 0.35 });

  // window glass: dark, very smooth — reflections are the whole look
  M.glass = new THREE.MeshPhysicalMaterial({
    name: 'LM window glass',
    color: new THREE.Color(0.004, 0.006, 0.008),
    metalness: 0.0,
    roughness: 0.02,
    ior: 1.52,
    envMapIntensity: 2.0,
    specularIntensity: 1.0,
    transparent: true,
    opacity: 0.62,
  });
  M.glass.userData.noShadow = true;
  // dim cabin cavity seen through the windows from outside (the real cabin is the LM-CABIN module)
  M.cabinInt = std({ name: 'LM cabin cavity', color: new THREE.Color(0.1, 0.1, 0.1), metalness: 0.0, roughness: 0.85, normalMap: rep(panel.normal, 0.8), side: THREE.FrontSide });
  M.cabinPanel = std({ name: 'LM cabin panel hint', color: new THREE.Color(0.2, 0.2, 0.21), metalness: 0.1, roughness: 0.6, map: rep(panel.tint, 0.5), normalMap: rep(panel.normal, 0.5) });
  M.cabinInt.userData.noShadow = true; // pokes outside the shell near the window tops (culled there)
  M.cabinPanel.userData.noShadow = true;

  // decals
  const flag = flagPanelTexture();
  M.flagPanel = std({ name: 'LM flag panel', color: 0xffffff, map: flag, metalness: 0.0, roughness: 0.6 });
  const plaque = plaqueTexture();
  M.plaque = std({ name: 'LM plaque', color: plaque ? 0xffffff : 0xb8bbbe, map: plaque, metalness: 0.9, roughness: 0.3 });
  const mk = markingsTexture();
  M.markings = std({ name: 'LM markings', color: mk ? 0xffffff : 0x222222, map: mk ? mk.tex : null, metalness: 0.0, roughness: 0.6 });
  M.markings.userData.rects = mk ? mk.rects : null;

  // self-luminous lights (tracking light flash, docking lights) — no shadows
  const lum = (c, name) => {
    const m = new THREE.MeshBasicMaterial({ name, color: c, toneMapped: true });
    m.userData.noShadow = true;
    return m;
  };
  M.lightWhite = lum(new THREE.Color(40, 40, 44), 'LM tracking light');
  M.lightRed = lum(new THREE.Color(6, 0.2, 0.15), 'LM docking light red');
  M.lightGreen = lum(new THREE.Color(0.2, 5, 0.6), 'LM docking light green');
  M.lightAmber = lum(new THREE.Color(6, 3.2, 0.3), 'LM docking light amber');
  M.lensOff = std({ name: 'LM lamp lens', color: new THREE.Color(0.3, 0.3, 0.32), metalness: 0.0, roughness: 0.15 });

  for (const m of Object.values(M)) {
    m.shadowSide = THREE.FrontSide;
  }
  return M;
}
