// STUB — owned by the INSTRUMENTS agent. Reusable cockpit construction kit.
// Contract (see ARCHITECTURE.md §Cockpit kit). Local frames: panel faces lie in the XY plane facing +Z,
// centred on the origin, depth toward -Z. Units: metres. All meshes should be put on LAYERS.CABIN by
// the cabin that uses them (use setLayerRecursive).
import * as THREE from 'three';
import { LAYERS } from '../../../core/constants.js';

export const COLORS = {
  panelGray: 0x5d6062, // Apollo instrument panel grey (LM & CM panels)
  panelDark: 0x2e3032,
  structure: 0x8c8f8a,
  label: 0xf2f2ee, // white panel lettering
  amber: 0xffb000,
  red: 0xff3020,
  green7seg: 0x6dff8a, // DSKY electroluminescent green
  red7seg: 0xff2a1a, // timers
};

export function setLayerRecursive(obj, layer = LAYERS.CABIN) {
  obj.traverse((o) => o.layers.set(layer));
  return obj;
}

/** Canvas-backed texture helper: returns {canvas, g (2D context), texture, pxPerM}. */
export function createCanvasTexture(widthM, heightM, pxPerM = 2000) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(4, Math.round(widthM * pxPerM));
  canvas.height = Math.max(4, Math.round(heightM * pxPerM));
  const g = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return { canvas, g, texture, pxPerM };
}

/**
 * Flat instrument panel with printed labels.
 * spec: { width, height, depth=0.012, color=COLORS.panelGray, labels:[{text, x, y, size=0.008, align='center'}],
 *         lines:[{x1,y1,x2,y2}], screws: true }
 * Label/line coordinates are metres from the panel centre (+x right, +y up).
 */
export function createPanel(spec) {
  const { width, height, depth = 0.012, color = COLORS.panelGray } = spec;
  const t = createCanvasTexture(width, height, spec.pxPerM || 1500);
  const g = t.g;
  g.fillStyle = '#' + new THREE.Color(color).getHexString();
  g.fillRect(0, 0, t.canvas.width, t.canvas.height);
  g.fillStyle = '#f2f2ee';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (const l of spec.labels || []) {
    g.font = `bold ${Math.round((l.size || 0.008) * t.pxPerM)}px Helvetica, Arial, sans-serif`;
    g.textAlign = l.align || 'center';
    g.fillText(l.text, (l.x + width / 2) * t.pxPerM, (height / 2 - l.y) * t.pxPerM);
  }
  t.texture.needsUpdate = true;
  const mat = new THREE.MeshStandardMaterial({ map: t.texture, roughness: 0.7, metalness: 0.1 });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), [mat, mat, mat, mat, mat, mat]);
  mesh.position.z = -depth / 2;
  const grp = new THREE.Group();
  grp.add(mesh);
  grp.userData.canvasTexture = t;
  return grp;
}

/** Toggle switch (bat-handle lever). opts: { state: 'up'|'center'|'down', guard: false, color } */
export function createToggleSwitch(opts = {}) {
  const grp = new THREE.Group();
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.004, 12), new THREE.MeshStandardMaterial({ color: 0x222222 }));
  base.rotation.x = Math.PI / 2;
  const lever = new THREE.Mesh(new THREE.CylinderGeometry(0.0022, 0.0018, 0.02, 8), new THREE.MeshStandardMaterial({ color: 0xcccccc, metalness: 1, roughness: 0.3 }));
  lever.position.set(0, 0, 0.01);
  lever.rotation.x = Math.PI / 2;
  grp.add(base, lever);
  grp.setState = () => {};
  return grp;
}

/** Circuit breaker panel. opts: { rows, cols, pitchX=0.02, pitchY=0.03, width, height, rowLabels:[], colLabels:[] } */
export function createCircuitBreakerPanel(opts) {
  return createPanel({ width: opts.width || 0.4, height: opts.height || 0.3, color: COLORS.panelGray, labels: [{ text: 'CIRCUIT BREAKERS', x: 0, y: 0 }] });
}

/** Rotary selector switch. opts: { positions: ['OFF','ON'], index: 0 } */
export function createRotarySwitch(opts = {}) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.012, 0.012, 16), new THREE.MeshStandardMaterial({ color: 0x111111 }));
  m.rotation.x = Math.PI / 2;
  const g = new THREE.Group();
  g.add(m);
  return g;
}

/** Push button (optionally lit). opts: { label, color: 'red'|'amber'|'white'|'green', lit: false, size: 0.02 } */
export function createPushButton(opts = {}) {
  const s = opts.size || 0.02;
  const m = new THREE.Mesh(new THREE.BoxGeometry(s, s, 0.01), new THREE.MeshStandardMaterial({ color: 0x333333, emissive: 0x000000 }));
  const g = new THREE.Group();
  g.add(m);
  g.setLit = (on) => m.material.emissive.set(on ? (opts.color === 'red' ? 0xff2020 : 0xffaa00) : 0x000000);
  return g;
}

/** Text placard (decal plane). opts: { text, width, height, fg='#f2f2ee', bg='#5d6062', font } */
export function createPlacard(opts) {
  return createPanel({ width: opts.width, height: opts.height, depth: 0.001, color: opts.bg || COLORS.panelGray, labels: [{ text: opts.text, x: 0, y: 0, size: opts.height * 0.5 }] });
}
