// Blocky furniture models. Each builder returns a THREE.Group in block units whose footprint
// spans [0,w] x [0,h] x [0,d] (origin = footprint min corner) with the front facing +Z.
// The Furniture team grows this into the full catalog.

import * as THREE from 'three';
import { box, cyl, mat } from '../core/models.js';
import { shade } from '../core/util.js';

const WOOD = '#E0B07A';
const WOOD_DARK = '#B68657';
const WHITE = '#FFF8FC';

export function bedSingle(color = '#FF8CC6') {
  const g = new THREE.Group();
  const frame = shade(color, 0.55);
  // legs + base
  for (const [x, z] of [[0.04, 0.04], [0.84, 0.04], [0.04, 1.84], [0.84, 1.84]]) g.add(box(0.12, 0.2, 0.12, WOOD_DARK, x, 0, z));
  g.add(box(0.96, 0.16, 1.96, WOOD, 0.02, 0.14, 0.02));
  // mattress, blanket with a folded stripe, pillow
  g.add(box(0.9, 0.16, 1.86, WHITE, 0.05, 0.3, 0.08));
  g.add(box(0.94, 0.1, 1.28, color, 0.03, 0.4, 0.7));
  g.add(box(0.94, 0.11, 0.16, shade(color, 0.45), 0.03, 0.4, 0.62));
  g.add(box(0.96, 0.24, 0.06, color, 0.02, 0.2, 1.94));
  g.add(box(0.64, 0.14, 0.34, WHITE, 0.18, 0.46, 0.14));
  g.add(box(0.5, 0.04, 0.2, '#FFE3F0', 0.25, 0.6, 0.21));
  // headboard with a heart cut-out look, footboard
  g.add(box(1.0, 0.95, 0.1, frame, 0, 0, 0));
  g.add(box(0.9, 0.1, 0.12, shade(frame, -0.08), 0.05, 0.9, -0.01));
  g.add(box(0.2, 0.16, 0.02, color, 0.3, 0.62, 0.1));
  g.add(box(0.2, 0.16, 0.02, color, 0.5, 0.62, 0.1));
  g.add(box(0.16, 0.1, 0.02, color, 0.42, 0.54, 0.1));
  g.add(box(1.0, 0.55, 0.08, frame, 0, 0, 1.92));
  return g;
}

export function chair(color = '#FFB7D2') {
  const g = new THREE.Group();
  for (const [x, z] of [[0.18, 0.18], [0.74, 0.18], [0.18, 0.74], [0.74, 0.74]]) g.add(box(0.08, 0.45, 0.08, WOOD, x, 0, z));
  g.add(box(0.7, 0.08, 0.7, WOOD, 0.15, 0.43, 0.15));
  g.add(box(0.64, 0.07, 0.64, color, 0.18, 0.51, 0.18));
  g.add(box(0.08, 0.55, 0.08, WOOD, 0.18, 0.5, 0.15));
  g.add(box(0.08, 0.55, 0.08, WOOD, 0.74, 0.5, 0.15));
  g.add(box(0.7, 0.28, 0.07, color, 0.15, 0.74, 0.15));
  g.add(box(0.7, 0.06, 0.08, WOOD, 0.15, 1.02, 0.14));
  return g;
}

export function tableRound(color = WOOD) {
  const g = new THREE.Group();
  g.add(cyl(0.26, 0.05, shade(color, -0.12), 0.5, 0, 0.5, 16));
  g.add(cyl(0.07, 0.7, shade(color, -0.08), 0.5, 0.04, 0.5, 10));
  g.add(cyl(0.47, 0.08, color, 0.5, 0.72, 0.5, 20));
  g.add(cyl(0.44, 0.02, shade(color, 0.2), 0.5, 0.8, 0.5, 20));
  return g;
}

export function tableLamp(color = '#FF8CC6', data = {}) {
  const on = data.on !== false;
  const g = new THREE.Group();
  g.add(cyl(0.15, 0.06, WOOD_DARK, 0.5, 0, 0.5, 12));
  g.add(cyl(0.035, 0.34, '#F3E3C9', 0.5, 0.06, 0.5, 8));
  const shadeGeo = new THREE.CylinderGeometry(0.15, 0.24, 0.26, 14, 1, true);
  const shadeMat = on ? mat(color, { emissive: color, emissiveIntensity: 0.4, side: THREE.DoubleSide }) : mat(color, { side: THREE.DoubleSide });
  const lampShade = new THREE.Mesh(shadeGeo, shadeMat);
  lampShade.position.set(0.5, 0.52, 0.5);
  g.add(lampShade);
  const bulbColor = on ? '#FFF6D8' : '#E8E0D0';
  g.add(cyl(0.07, 0.1, on ? mat(bulbColor, { emissive: '#FFE9A8', emissiveIntensity: 1 }) : bulbColor, 0.5, 0.4, 0.5, 10));
  return g;
}
