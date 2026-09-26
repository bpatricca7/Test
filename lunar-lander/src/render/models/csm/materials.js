// PBR material set for the Apollo CSM exterior.
//
// Lighting comes from ctx.sunLight (with shadows), ctx.fillLight (lunar-surface bounce) and
// scene.environment (black sky + bright lunar ground + a Sun spot). The Command Module's
// aluminized-Mylar tape is essentially a mirror (metalness 1, roughness ~0.05-0.15): its look is
// entirely the environment — the Moon below, the black sky above — broken up by the gore tilts and
// wrinkles in the normal map. The Service Module is bare / lightly finished aluminium with white Z-93
// radiator paint.

import * as THREE from 'three';
import { skinAtlas, flagDecalTexture, spsNozzleTextures, aftBulkheadTextures } from './textures.js';
import { SM_LAYOUT } from './profile.js';

/**
 * @param {object} opts
 * @param {'low'|'medium'|'high'} [opts.quality]
 * @param {number[][][]} [opts.holes] window footprints in CM foil UV
 * @param {number[]} [opts.quadAzimuthsDeg]
 * @returns {{M: Object<string, THREE.Material>, ready: Promise<void>}}
 */
export function createCSMMaterials({ quality = 'high', holes = [], quadAzimuthsDeg = [] } = {}) {
  const big = quality === 'low' ? [1024, 512] : [2048, 1024];
  const cmAtlas = skinAtlas('cmFoil', { width: big[0], height: big[1], seed: 11, holes }, { albedo: [236, 236, 236, 255], orm: [255, 30, 255, 255] });
  const smAtlas = skinAtlas('smSkin', { width: big[0], height: big[1], seed: 5, quadAzimuths: quadAzimuthsDeg }, { albedo: [200, 200, 204, 255], orm: [255, 90, 200, 255] });
  const std = (p) => new THREE.MeshStandardMaterial(p);
  const M = {};

  // ---- Command Module: aluminized Mylar tape over the ablative heat shield
  M.foil = std({
    name: 'CM Mylar foil',
    color: 0xffffff,
    map: cmAtlas.map,
    metalness: 1,
    roughness: 1,
    roughnessMap: cmAtlas.orm,
    metalnessMap: cmAtlas.orm,
    aoMap: cmAtlas.orm,
    aoMapIntensity: 1,
    normalMap: cmAtlas.normal,
    normalScale: new THREE.Vector2(1, 1),
    alphaTest: 0.5,
    envMapIntensity: 1.0,
  });
  // Avcoat ablator (aft heat-shield rim, window pockets): bronze-brown, satin
  M.ablator = std({ name: 'CM ablator', color: new THREE.Color(0.2, 0.12, 0.065), metalness: 0.35, roughness: 0.55 });
  M.ablatorDark = std({ name: 'CM pocket wall', color: new THREE.Color(0.09, 0.07, 0.055), metalness: 0.2, roughness: 0.7 });
  // outer heat-shield window panes: black glass with a faint blue anti-reflection cast
  M.glass = new THREE.MeshPhysicalMaterial({
    name: 'CM window glass',
    color: new THREE.Color(0.004, 0.005, 0.007),
    metalness: 0,
    roughness: 0.035,
    ior: 1.46,
    specularColor: new THREE.Color(0.75, 0.85, 1.0),
    specularIntensity: 1,
    envMapIntensity: 1.6,
  });
  M.windowFrame = std({ name: 'CM window frame', color: new THREE.Color(0.035, 0.032, 0.03), metalness: 0.5, roughness: 0.45 });

  // ---- docking hardware
  M.ring = std({ name: 'docking ring', color: new THREE.Color(0.62, 0.62, 0.64), metalness: 0.9, roughness: 0.32 });
  M.metal = std({ name: 'bright metal', color: new THREE.Color(0.75, 0.75, 0.77), metalness: 1, roughness: 0.22 });
  M.darkMetal = std({ name: 'dark metal', color: new THREE.Color(0.1, 0.1, 0.11), metalness: 0.6, roughness: 0.5 });
  M.black = std({ name: 'black', color: new THREE.Color(0.012, 0.012, 0.012), metalness: 0, roughness: 0.85 });
  M.probe = std({ name: 'probe', color: new THREE.Color(0.7, 0.7, 0.71), metalness: 0.85, roughness: 0.3 });
  M.gold = std({ name: 'gold anodize', color: new THREE.Color(0.85, 0.6, 0.25), metalness: 1, roughness: 0.3 });

  // ---- Service Module
  M.sm = std({
    name: 'SM skin',
    color: 0xffffff,
    map: smAtlas.map,
    metalness: 1,
    roughness: 1,
    roughnessMap: smAtlas.orm,
    metalnessMap: smAtlas.orm,
    aoMap: smAtlas.orm,
    normalMap: smAtlas.normal,
    normalScale: new THREE.Vector2(1, 1),
  });
  M.smInner = std({ name: 'SM interior', color: new THREE.Color(0.05, 0.05, 0.05), metalness: 0.3, roughness: 0.8, side: THREE.DoubleSide });
  M.white = std({ name: 'white paint', color: new THREE.Color(0.72, 0.72, 0.7), metalness: 0, roughness: 0.62 });
  M.quad = std({ name: 'RCS quad housing', color: new THREE.Color(0.72, 0.72, 0.71), metalness: 0.2, roughness: 0.5 });
  M.nozzle = std({ name: 'RCS nozzle', color: new THREE.Color(0.46, 0.46, 0.5), metalness: 0.6, roughness: 0.42 });
  M.nozzleIn = std({ name: 'nozzle interior', color: new THREE.Color(0.03, 0.028, 0.026), metalness: 0.4, roughness: 0.7, side: THREE.DoubleSide });

  // "UNITED STATES" + flag decal (painted on the SM skin)
  const decalTex = flagDecalTexture(SM_LAYOUT.decals.halfWidthM * 2, SM_LAYOUT.decals.z1 - SM_LAYOUT.decals.z0);
  M.decal = std({
    name: 'SM decal',
    map: decalTex,
    transparent: true,
    alphaTest: 0.02,
    metalness: 0,
    roughness: 0.8,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  M.decal.userData.noShadow = true;

  // ---- SPS engine
  const spsTex = spsNozzleTextures(0.3);
  M.spsOuter = std({
    name: 'SPS nozzle extension',
    color: 0xffffff,
    map: spsTex?.map ?? null,
    roughnessMap: spsTex?.rough ?? null,
    metalness: 0.55,
    roughness: 1,
    emissive: new THREE.Color(1.0, 0.22, 0.04),
    emissiveMap: spsTex?.emissive ?? null,
    emissiveIntensity: 0,
  });
  M.spsInner = std({ name: 'SPS nozzle interior', color: new THREE.Color(0.1, 0.095, 0.1), metalness: 0.55, roughness: 0.42, emissive: new THREE.Color(1.0, 0.3, 0.07), emissiveIntensity: 0 });
  M.spsRing = std({ name: 'SPS stiffener', color: new THREE.Color(0.52, 0.51, 0.5), metalness: 0.4, roughness: 0.42 });
  M.spsThroat = std({ name: 'SPS chamber', color: new THREE.Color(0.015, 0.014, 0.014), metalness: 0.2, roughness: 0.9 });
  const aft = aftBulkheadTextures();
  M.aftShield = std({
    name: 'SM aft heat shield',
    color: 0xffffff,
    map: aft?.map ?? null,
    bumpMap: aft?.bump ?? null,
    bumpScale: 1.5,
    metalness: 0.35,
    roughness: 0.62,
  });
  M.boot = std({ name: 'SPS flexible heat shield', color: new THREE.Color(0.5, 0.5, 0.49), metalness: 0.5, roughness: 0.6 });

  // ---- antennas
  M.dish = std({ name: 'HGA dish', color: new THREE.Color(0.7, 0.7, 0.68), metalness: 0.05, roughness: 0.45, side: THREE.DoubleSide });

  // ---- lights (emissive; they do not cast shadows)
  const light = (name, c, i) => {
    const m = std({ name, color: new THREE.Color(c).multiplyScalar(0.3), emissive: new THREE.Color(c), emissiveIntensity: i, roughness: 0.3, metalness: 0 });
    m.userData.noShadow = true;
    m.userData.baseIntensity = i;
    return m;
  };
  M.lightRed = light('running light red', 0xff2a1a, 7);
  M.lightGreen = light('running light green', 0x33ff66, 7);
  M.lightAmber = light('docking light amber', 0xffb030, 6);
  M.lightBeacon = light('rendezvous beacon', 0xeef4ff, 0);
  M.lightLens = std({ name: 'light lens', color: new THREE.Color(0.2, 0.2, 0.22), metalness: 0.2, roughness: 0.2 });

  const ready = Promise.all([cmAtlas.ready, smAtlas.ready]).then(() => undefined);
  return { M, ready };
}
