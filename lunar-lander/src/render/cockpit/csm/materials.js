// Command Module interior materials (CSM-CABIN agent).
//
// Keys used by the Batch builders (see geom.js):
//   wall        painted inner structure / close-out panels (seams, rivets)
//   structure   grey painted brackets, frames, console boxes
//   structDark  darker grey (console interiors, recesses)
//   locker      stowage locker doors (atlas, see textures.createLockerAtlas)
//   beta        Beta-cloth covers (couch pads, hatch cover, harness covers)
//   betaShade   slightly darker, grimier Beta cloth (window shades, bags)
//   frame       couch frames & struts: satin anodised aluminium
//   alu         bright machined aluminium (handholds, hatch mechanism, fittings)
//   black       black anodise / paint (hand-controller grips, knobs, eyepieces)
//   rubber      rubber (eyecups, grips, seals)
//   hose        suit-umbilical hoses (light grey, corrugated)
//   strap       harness webbing
//   velcro      Velcro patches (off-white felt)
//   pocket      window-pocket walls (grey -> ablator dark)
//   ablator     heat-shield window frames seen through the glass
//   gold        gold-coloured anodise (optics housing, strut collars)
//   red         red paint (T-handles, caps)
//   lens        floodlight lens (emissive, driven by lighting.js)
//   paper       checklist pages
import * as THREE from 'three';
import { getMaterial } from '../kit/index.js';
import { wallTexture, betaTexture, strapTexture, pocketTexture, noiseTexture, createLockerAtlas } from './textures.js';

/**
 * Create the cabin material set.
 * @returns {{get(key: string): THREE.Material, atlas: object, all(): THREE.Material[]}}
 */
export function createCabinMaterials() {
  const M = new Map();
  const std = (o) => new THREE.MeshStandardMaterial(o);
  const wall = wallTexture();
  const noise = noiseTexture();
  M.set('wall', std({ color: 0xc6c7c4, map: wall.map, roughnessMap: wall.rough, roughness: 1, bumpMap: wall.rough, bumpScale: 0.5, metalness: 0.02 }));
  M.set('structure', std({ color: 0x8c8f8b, roughness: 0.7, roughnessMap: noise, metalness: 0.08 }));
  M.set('structDark', std({ color: 0x2d2e2e, roughness: 0.8, metalness: 0.05 }));
  const atlas = createLockerAtlas(6, 6);
  M.set('locker', std({ color: 0xffffff, map: atlas.texture, roughness: 0.66, metalness: 0.06 }));
  const beta = betaTexture();
  M.set('beta', std({ color: 0xe4dfd2, map: beta, roughness: 0.92, metalness: 0 }));
  M.set('betaShade', std({ color: 0xc9c2b0, map: beta, roughness: 0.95, metalness: 0 }));
  M.set('frame', std({ color: 0xa9abaa, roughness: 0.42, roughnessMap: noise, metalness: 0.75 }));
  M.set('alu', std({ color: 0xc9cac8, roughness: 0.3, metalness: 1 }));
  M.set('black', std({ color: 0x151516, roughness: 0.55, metalness: 0.1 }));
  M.set('rubber', getMaterial('rubber'));
  M.set('hose', std({ color: 0xb8bbb8, roughness: 0.55, metalness: 0.15 }));
  M.set('strap', std({ color: 0xffffff, map: strapTexture(), roughness: 0.9, metalness: 0 }));
  M.set('velcro', std({ color: 0xd4cebd, roughness: 1, metalness: 0 }));
  M.set('pocket', std({ color: 0xffffff, map: pocketTexture(), roughness: 0.85, metalness: 0.05, side: THREE.DoubleSide }));
  M.set('ablator', std({ color: 0x2a211a, roughness: 0.95, metalness: 0 }));
  M.set('gold', std({ color: 0xc9a650, roughness: 0.35, metalness: 1 }));
  M.set('red', std({ color: 0x9e1b16, roughness: 0.45, metalness: 0 }));
  const lens = std({ color: 0xf4efe2, emissive: new THREE.Color(1, 0.9, 0.72), emissiveIntensity: 1.5, roughness: 0.3 });
  lens.userData.noShadow = true;
  M.set('lens', lens);
  M.set('paper', std({ color: 0xeee8d6, roughness: 0.9, metalness: 0 }));
  for (const [k, m] of M) if (!m.name) m.name = 'csm:' + k;
  return {
    atlas,
    get(key) {
      const m = M.get(key);
      if (!m) throw new Error(`csm cabin: unknown material '${key}'`);
      return m;
    },
    all: () => [...M.values()],
  };
}
