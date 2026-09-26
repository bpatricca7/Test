// Placards, decals, stowage labels and crew checklist / cue cards.
import * as THREE from 'three';
import { createCanvasTexture, drawText, measureText, css, MONO_STACK, rng, hashString } from './canvas.js';
import { COLORS } from './materials.js';

/**
 * Text placard: thin plate (or decal when depth = 0) with one or more lines of text.
 * opts: { text, width, height, fg='#f2f2ee', bg=COLORS.panelGray (or 'transparent'), font (CSS
 *   family), size (em, m; default fits the height), align='center', depth=0.0006, border (colour),
 *   borderWidth=0.0005, condense, weight, radius=0.0008, pxPerM=3000, roughness=0.5 }
 * @returns {THREE.Group} with .mesh and .userData.canvasTexture
 */
export function createPlacard(opts = {}) {
  const width = opts.width || 0.06;
  const height = opts.height || 0.015;
  const t = createCanvasTexture(width, height, opts.pxPerM || 3000);
  const g = t.g;
  const W = t.canvas.width;
  const H = t.canvas.height;
  const s = W / width;
  const transparent = opts.bg === 'transparent' || opts.bg === null;
  if (transparent) g.clearRect(0, 0, W, H);
  else {
    g.fillStyle = css(opts.bg ?? COLORS.panelGray);
    g.fillRect(0, 0, W, H);
  }
  if (opts.border) {
    g.strokeStyle = css(opts.border);
    g.lineWidth = (opts.borderWidth ?? 0.0005) * s;
    const o = (opts.borderInset ?? 0.0008) * s;
    g.strokeRect(o, o, W - 2 * o, H - 2 * o);
  }
  const lines = String(opts.text ?? '').split('\n');
  let size = (opts.size ?? Math.min((height * 0.62) / lines.length / 1.1, 0.012)) * s;
  const tOpts = { font: opts.font, condense: opts.condense ?? 0.84, weight: opts.weight ?? 'bold', caps: opts.caps ?? true };
  // shrink to fit the width (keeps a small margin)
  const avail = W - 2 * (opts.padding ?? 0.002) * s;
  const tw = measureText(g, lines.join('\n'), size, tOpts);
  if (tw > avail) size *= avail / tw;
  const align = opts.align || 'center';
  const x = align === 'left' ? (opts.padding ?? 0.002) * s : align === 'right' ? W - (opts.padding ?? 0.002) * s : W / 2;
  drawText(g, lines.join('\n'), x, H / 2, size, {
    align,
    color: css(opts.fg ?? '#f2f2ee'),
    font: opts.font,
    condense: opts.condense ?? 0.84,
    weight: opts.weight ?? 'bold',
    lineHeight: opts.lineHeight ?? 1.18,
    caps: opts.caps ?? true,
  });
  t.texture.needsUpdate = true;
  const depth = opts.depth ?? 0.0006;
  const mat = new THREE.MeshStandardMaterial({ map: t.texture, roughness: opts.roughness ?? 0.5, metalness: 0.02, transparent, alphaTest: transparent ? 0.05 : 0 });
  let mesh;
  if (depth > 0 && !transparent) {
    const geo = new THREE.BoxGeometry(width, height, depth).translate(0, 0, depth / 2);
    // side faces show the edge colour of the map; front face UVs are standard
    mesh = new THREE.Mesh(geo, mat);
  } else {
    mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), mat);
    mesh.position.z = 0.0002;
    mat.polygonOffset = true;
    mat.polygonOffsetFactor = -2;
    mat.polygonOffsetUnits = -2;
  }
  mesh.castShadow = depth > 0.001;
  mesh.receiveShadow = true;
  const grp = new THREE.Group();
  grp.name = 'Placard';
  grp.add(mesh);
  grp.mesh = mesh;
  grp.userData.canvasTexture = t;
  return grp;
}

/**
 * Crew checklist / cue card: off-white paper card with a typed title, ruled lines and entries,
 * slightly worn, attached with Velcro (dark strip on the back edge is implied). Pages bend a little.
 * opts: { title, lines: [string | {text, bold, indent}], width=0.105, height=0.14, paper='#efe9d6',
 *   ink='#1d1d22', fontSize=0.0032 (m), curl=0.004 (m sag), seed, pxPerM=3600 }
 * @returns {THREE.Group}
 */
export function createChecklistCard(opts = {}) {
  const width = opts.width || 0.105;
  const height = opts.height || 0.14;
  const t = createCanvasTexture(width, height, opts.pxPerM || 3600);
  const g = t.g;
  const W = t.canvas.width;
  const H = t.canvas.height;
  const s = W / width;
  const r = rng(opts.seed ?? hashString(String(opts.title || '') + (opts.lines || []).length));
  // paper
  g.fillStyle = opts.paper || '#efe9d6';
  g.fillRect(0, 0, W, H);
  // paper fibres / handling
  for (let i = 0; i < 900; i++) {
    g.fillStyle = `rgba(${r() < 0.5 ? '120,110,90' : '255,255,245'},${0.03 + r() * 0.05})`;
    g.fillRect(r() * W, r() * H, 1 + r() * 3, 1);
  }
  const grd = g.createRadialGradient(W * 0.5, H * 0.45, Math.min(W, H) * 0.2, W * 0.5, H * 0.5, Math.max(W, H) * 0.75);
  grd.addColorStop(0, 'rgba(0,0,0,0)');
  grd.addColorStop(1, 'rgba(90,70,40,0.16)');
  g.fillStyle = grd;
  g.fillRect(0, 0, W, H);
  // punched binder holes along the top
  g.fillStyle = 'rgba(30,30,30,0.85)';
  for (const fx of [0.25, 0.75]) {
    g.beginPath();
    g.arc(W * fx, 0.006 * s, 0.0022 * s, 0, Math.PI * 2);
    g.fill();
  }
  const ink = opts.ink || '#1d1d22';
  const fs = (opts.fontSize || 0.0032) * s;
  let y = 0.014 * s;
  if (opts.title) {
    drawText(g, opts.title, W / 2, y, fs * 1.25, { color: ink, font: MONO_STACK, condense: 0.95, baseline: 'top', tracking: 0.02 });
    y += fs * 1.9;
    g.fillStyle = ink;
    g.fillRect(0.006 * s, y, W - 0.012 * s, Math.max(1, 0.0003 * s));
    y += fs * 0.9;
  }
  for (const l of opts.lines || []) {
    const e = typeof l === 'string' ? { text: l } : l;
    if (y > H - fs * 1.5) break;
    if (e.rule) {
      g.fillStyle = 'rgba(40,40,60,0.55)';
      g.fillRect(0.006 * s, y + fs * 0.4, W - 0.012 * s, Math.max(1, 0.0002 * s));
      y += fs * 1.0;
      continue;
    }
    drawText(g, e.text, 0.006 * s + (e.indent || 0) * s, y, fs, {
      color: e.color || ink,
      font: MONO_STACK,
      weight: e.bold ? 'bold' : 'normal',
      condense: 0.9,
      align: 'left',
      baseline: 'top',
      tracking: 0,
      caps: e.caps ?? true,
    });
    y += fs * 1.38;
  }
  // a pencil tick or two (crew annotations)
  g.strokeStyle = 'rgba(60,60,70,0.55)';
  g.lineWidth = 0.0003 * s;
  for (let i = 0; i < 2; i++) {
    const yy = (0.03 + r() * 0.08) * s;
    g.beginPath();
    g.moveTo(W - 0.012 * s, yy);
    g.lineTo(W - 0.010 * s, yy + 0.002 * s);
    g.lineTo(W - 0.006 * s, yy - 0.003 * s);
    g.stroke();
  }
  t.texture.needsUpdate = true;
  // slightly bowed card (paper sag)
  const geo = new THREE.PlaneGeometry(width, height, 6, 8);
  const p = geo.attributes.position;
  const curl = opts.curl ?? 0.004;
  for (let i = 0; i < p.count; i++) {
    const u = p.getX(i) / width;
    const v = p.getY(i) / height;
    p.setZ(i, curl * (1 - 4 * u * u) * 0.35 + curl * Math.max(0, -v - 0.2) * 0.9);
  }
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ map: t.texture, roughness: 0.88, metalness: 0, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.z = 0.0008;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const grp = new THREE.Group();
  grp.name = 'ChecklistCard';
  grp.add(mesh);
  grp.mesh = mesh;
  return grp;
}

/**
 * Stowage / Velcro label strip: white (or given colour) strip with black typed text, e.g.
 * 'ORDEAL', 'FLIGHT DATA FILE', 'U/V FILTER'. opts: { text, width=0.05, height=0.009, bg='#e8e4d8',
 * fg='#151515' }
 */
export function createLabelStrip(opts = {}) {
  return createPlacard({ width: 0.05, height: 0.009, bg: '#e8e4d8', fg: '#151515', depth: 0.0004, ...opts });
}
