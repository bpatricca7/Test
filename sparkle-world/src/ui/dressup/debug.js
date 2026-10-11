// Debug helpers for automated checks (window.__game.debug.avatar): render avatars through the
// shared stage into one labelled grid image.

import { getStage, FRAMES } from './stage.js';
import * as W from '../../player/wardrobe-data.js';
import { normalizeLook, randomLook, applyOutfit, STARTER_OUTFITS, HAIR_STYLES } from '../../player/wardrobe-data.js';
import { mulberry32 } from '../../core/util.js';
import { cacheStats } from '../../player/avatar/textures.js';

let uid = 0;
const OPTION_LISTS = [
  'HAIR_STYLES', 'HAIR_MIXES', 'TOPS', 'BOTTOMS', 'DRESSES', 'SHOES', 'HEAD_ACC', 'FACE_ACC', 'BACK_ACC', 'NECK_ACC',
  'HAND_ACC', 'PATTERNS', 'SMILES', 'BROWS', 'SEA_FORMS',
];

/**
 * items: [{ look, label, frame?, pose? }] -> Promise<dataURL> of a grid (cols x rows).
 * Every cell is rendered fresh (not cached).
 */
export async function renderGrid(items, { cols = 4, size = 256, bg = '#FFF3FA', aspect = 0.8 } = {}) {
  const stage = getStage();
  const rows = Math.ceil(items.length / cols);
  const cw = size, ch = Math.round(size / aspect), lab = 30;
  const out = document.createElement('canvas');
  out.width = cols * cw;
  out.height = rows * (ch + lab);
  const g = out.getContext('2d');
  g.fillStyle = bg;
  g.fillRect(0, 0, out.width, out.height);
  const jobs = items.map((it, i) => stage.snapshot(`debug:${uid++}`, normalizeLook(it.look), { frame: it.frame || 'full', pose: it.pose, size: cw, aspect }).then((c) => ({ c, i, it })));
  const done = await Promise.all(jobs);
  for (const { c, i, it } of done) {
    const x = (i % cols) * cw, y = Math.floor(i / cols) * (ch + lab);
    const grd = g.createRadialGradient(x + cw / 2, y + ch * 0.55, 10, x + cw / 2, y + ch * 0.55, cw * 0.7);
    grd.addColorStop(0, '#FFFFFF');
    grd.addColorStop(1, '#F6E6FF');
    g.fillStyle = grd;
    g.fillRect(x + 2, y + 2, cw - 4, ch - 4);
    if (c) g.drawImage(c, x, y, cw, ch);
    g.fillStyle = '#3A1F4D';
    g.font = '600 18px sans-serif';
    g.textAlign = 'center';
    g.fillText(it.label || '', x + cw / 2, y + ch + 21);
  }
  return out.toDataURL('image/png');
}

export function installDebug(game) {
  if (!game.debug) return;
  game.debug.avatar = {
    renderGrid,
    frames: Object.keys(FRAMES),
    starters: () => STARTER_OUTFITS.map((o) => ({ key: o.key, name: o.name, tag: o.tag, look: applyOutfit(game.profile.look, o) })),
    random: (seed, base = null, style = 'girl') => randomLook(mulberry32(seed), 'Lily', base ? normalizeLook(base) : null, style),
    hairStyles: () => HAIR_STYLES.map((h) => h.key),
    // every option list's keys and surprise tags (probes check the lists stay append-only)
    options: () => Object.fromEntries(OPTION_LISTS.map((k) => [k, W[k].map((o) => ({ key: o.key, tag: o.tag }))])),
    textures: cacheStats,
    look: () => normalizeLook(game.profile.look),
    stage: () => getStage(), // snapshot queue + stats for probes
  };
}
