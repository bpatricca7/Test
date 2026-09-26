// Lower-polygon replacements for the kit's instanced switch / circuit-breaker parts (LM-CABIN agent).
//
// The LM cabin carries ~240 circuit breakers and ~180 toggles; with the kit's show-quality lathes
// they alone cost ~250k triangles. At cabin viewing distances (0.3–0.8 m) 10–12 sided parts are
// indistinguishable, so after the panels are built this swaps the geometry of the cabin's OWN
// InstancedMeshes (instance matrices, materials and the kit's handles are untouched; the kit's
// shared geometry used by other cabins is not modified). Dimensions follow kit/breakers.js and
// kit/switches.js exactly.
import * as THREE from 'three';
import { CB_POP } from '../kit/index.js';

let _g = null;
function geos() {
  if (_g) return _g;
  const toZ = (g) => g.rotateX(Math.PI / 2);
  const lathe = (pts, seg) => new THREE.LatheGeometry(pts.map(([r, h]) => new THREE.Vector2(r, h)), seg);
  // circuit breaker (kit/breakers.js)
  const collar = toZ(lathe([[0.0028, 0], [0.0059, 0], [0.0059, 0.0006], [0.0046, 0.0016], [0.0046, 0.0008], [0.0028, 0.0008]], 10));
  const cap = toZ(lathe([[0.0001, 0.0069], [0.0036, 0.0068], [0.0042, 0.0058], [0.0042, 0.0008], [0.0001, 0.0008]].reverse(), 10));
  const band = toZ(new THREE.CylinderGeometry(0.0041, 0.0041, CB_POP + 0.0006, 10, 1, true)).translate(0, 0, 0.0008 + (CB_POP + 0.0006) / 2 - 0.0004);
  // toggle switch (kit/switches.js)
  const washer = toZ(new THREE.CylinderGeometry(0.0064, 0.0064, 0.0006, 12)).translate(0, 0, 0.0003);
  const bushing = toZ(lathe([[0.0001, 0.0024], [0.003, 0.0024], [0.003, 0.0068], [0.0024, 0.0074], [0.0001, 0.0074]], 10));
  const L = [
    [0.0001, -0.0012], [0.0011, -0.0012], [0.0011, 0.0022], [0.0017, 0.0026], [0.0017, 0.0045], [0.00118, 0.0048],
    [0.00118, 0.0072], [0.0017, 0.0132], [0.00218, 0.0172], [0.0019, 0.019], [0.0006, 0.0201], [0.0001, 0.0202],
  ];
  const lever = toZ(lathe(L, 10));
  lever.scale(1.12, 0.86, 1);
  _g = { collar, cap, band, washer, bushing, lever };
  return _g;
}

/**
 * Replace the geometry of the kit's breaker / switch InstancedMeshes found under `root`.
 * @param {THREE.Object3D} root
 * @returns {{before: number, after: number}} triangle counts of the replaced meshes
 */
export function lowPolyKitHardware(root) {
  const G = geos();
  let before = 0;
  let after = 0;
  const tri = (g) => (g.index ? g.index.count : g.attributes.position.count) / 3;
  const swap = (mesh, g) => {
    before += tri(mesh.geometry) * mesh.count;
    mesh.geometry = g;
    after += tri(g) * mesh.count;
  };
  root.traverse((o) => {
    if (o.name === 'BreakerBank') {
      const [collar, cap, band] = o.children;
      if (collar?.isInstancedMesh && collar.material?.name === 'kit:darkMetal') swap(collar, G.collar);
      if (cap?.isInstancedMesh && cap.material?.name === 'kit:blackKnob') swap(cap, G.cap);
      if (band?.isInstancedMesh && band.material?.name === 'kit:white') swap(band, G.band);
    } else if (o.name === 'SwitchBank') {
      const [, washer, bushing, lever] = o.children;
      if (washer?.isInstancedMesh && washer.material?.name === 'kit:darkMetal') swap(washer, G.washer);
      if (bushing?.isInstancedMesh && bushing.material?.name === 'kit:satinMetal') swap(bushing, G.bushing);
      if (lever?.isInstancedMesh && lever.material?.name === 'kit:chrome') swap(lever, G.lever);
    }
  });
  return { before: Math.round(before), after: Math.round(after) };
}
