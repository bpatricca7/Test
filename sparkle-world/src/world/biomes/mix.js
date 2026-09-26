// Everything Land: regions of every world type on one island, blended with smooth borders.
// A jittered grid of region seeds (the middle one is always Flower Meadow) is assigned
// biomes so neighbours differ; each column mixes the regions' heights by soft distance
// weights over domain-warped coordinates, and takes its ground, trees and flowers from the
// region that dominates it.

import { Gen, TREES, puffCloud } from './gen.js';
import { ahead, placeAt, path } from './common.js';
import { region as meadow } from './meadow.js';
import { region as candy } from './candy.js';
import { region as beach } from './beach.js';
import { region as snow } from './snow.js';
import { region as fairy } from './fairy.js';

const REGIONS = [meadow, candy, beach, snow, fairy];
const DENSITY = {
  meadow: (g, x, z) => 0.05 + meadow.forest(g, x, z) * 0.8,
  candy: (g, x, z) => 0.05 + candy.forest(g, x, z) * 0.7,
  beach: () => 0.14,
  snow: (g, x, z) => 0.06 + snow.forest(g, x, z) * 1.0,
  fairy: (g, x, z) => 0.08 + fairy.forest(g, x, z) * 0.9,
};

export function generate(world, rand, noise) {
  const g = new Gen(world, rand, noise, { sea: 20 });
  const { sx, sz } = g;
  const NB = REGIONS.length;
  const cell = g.big ? 50 : 46;
  // region seeds on a jittered grid (one ring of cells beyond the world so edges blend too)
  const gx = Math.ceil(sx / cell) + 2, gz = Math.ceil(sz / cell) + 2;
  const seeds = [];
  for (let j = 0; j < gz; j++) {
    for (let i = 0; i < gx; i++) {
      seeds.push({ i, j, x: (i - 1 + 0.2 + rand() * 0.6) * cell, z: (j - 1 + 0.2 + rand() * 0.6) * cell, b: -1 });
    }
  }
  // the seed nearest the middle becomes the meadow start region, right under the spawn
  let mid = seeds[0], best = Infinity;
  for (const s of seeds) {
    const d = Math.hypot(s.x - g.cx, s.z - g.cz);
    if (d < best) { best = d; mid = s; }
  }
  mid.x = g.cx; mid.z = g.cz; mid.b = 0;
  // assign the rest: never the same as a neighbour, balancing how often each appears
  const used = new Array(NB).fill(0);
  used[0] = 1;
  const at = (i, j) => (i < 0 || j < 0 || i >= gx || j >= gz ? null : seeds[j * gx + i]);
  const order = seeds.slice().sort((a, b) => Math.hypot(a.x - g.cx, a.z - g.cz) - Math.hypot(b.x - g.cx, b.z - g.cz));
  for (const s of order) {
    if (s.b >= 0) continue;
    const near = new Set();
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const n = at(s.i + di, s.j + dj); if (n && n.b >= 0) near.add(n.b); }
    let pickB = -1, pickUse = Infinity;
    const start = Math.floor(rand() * NB);
    for (let k = 0; k < NB; k++) {
      const b = (start + k) % NB;
      if (near.has(b)) continue;
      if (used[b] < pickUse) { pickUse = used[b]; pickB = b; }
    }
    if (pickB < 0) pickB = start;
    s.b = pickB;
    used[pickB]++;
  }

  // per-column blend weights and the dominant region
  const W = new Float32Array(sx * sz * NB);
  const dom = new Uint8Array(sx * sz);
  const wsum = new Float32Array(NB);
  const T = 5.5;
  for (let z = 0; z < sz; z++) {
    for (let x = 0; x < sx; x++) {
      const wx = x + noise.fbm2(x / 42, z / 42, 2) * 16, wz = z + noise.fbm2(x / 42 + 50, z / 42 - 50, 2) * 16;
      const ci = Math.floor(wx / cell) + 1, cj = Math.floor(wz / cell) + 1;
      wsum.fill(0);
      let dmin = Infinity;
      const cand = [];
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          const s = at(ci + di, cj + dj);
          if (!s) continue;
          const d = Math.hypot(wx - s.x, wz - s.z);
          cand.push(d, s.b);
          if (d < dmin) dmin = d;
        }
      }
      let tot = 0;
      for (let k = 0; k < cand.length; k += 2) {
        const w = Math.exp(-(cand[k] - dmin) / T);
        wsum[cand[k + 1]] += w;
        tot += w;
      }
      const k0 = (z * sx + x) * NB;
      let bb = 0, bw = -1;
      const jit = (noise.n2(x / 3.1, z / 3.1)) * 0.12;
      for (let b = 0; b < NB; b++) {
        const w = wsum[b] / tot;
        W[k0 + b] = w;
        if (w + (b % 2 ? jit : -jit) > bw) { bw = w + (b % 2 ? jit : -jit); bb = b; }
      }
      dom[z * sx + x] = bb;
    }
  }
  g.dominant = (x, z) => REGIONS[dom[Math.max(0, Math.min(sz - 1, z)) * sx + Math.max(0, Math.min(sx - 1, x))]];

  g.shape((x, z) => {
    const k0 = (z * sx + x) * NB;
    let h = 0, tw = 0;
    for (let b = 0; b < NB; b++) {
      const w = W[k0 + b];
      if (w < 0.015) continue;
      h += w * REGIONS[b].height(g, x, z);
      tw += w;
    }
    return h / tw;
  });
  g.flattenSpawn(6, 15);
  g.islandEdge();
  const [px, pz] = ahead(g, (rand() - 0.5) * 0.8, 20 + rand() * 3);
  const pond = g.carvePond(px, pz, 6 + rand() * 1.5, { depth: 3, bed: 'sand', lilies: 0.08 });
  g.commit();
  g.fillColumns((x, z, h) => REGIONS[dom[z * sx + x]].column(g, x, z, h));
  g.fillSea(g.id('water'));
  g.pourPonds();
  decorate(g, dom);
  path(g, g.cx, g.cz - 3, pond.x, pond.z, 'path', { surfaces: [g.id('grass')], stopAt: pond.r });
  world.outside = { block: 'water', surface: g.sea + 0.875 };
  return g.finish();
}

function decorate(g, dom) {
  const surfIds = new Map(REGIONS.map((r) => [r.key, r.surfaces.map((k) => g.id(k))]));
  placeAt(g, ...ahead(g, -0.62, 15), TREES.cherry, { force: true, surfaces: surfIds.get('meadow') });
  placeAt(g, ...ahead(g, 0.7, 16), TREES.oak, { force: true, surfaces: surfIds.get('meadow') });
  g.scatter(Math.floor((g.sx * g.sz) / 26), {
    spacing: 3,
    accept: (x, z) => {
      const r = g.dominant(x, z);
      return g.dryLand(x, z, surfIds.get(r.key)) && g.rand() < DENSITY[r.key](g, x, z);
    },
    place: (x, z) => g.dominant(x, z).tree(g, x, g.h(x, z) + 1, z),
  });
  // a few biome touches: snowmen, gumdrop bushes, puff clouds over candy, coral by the beach
  g.scatter(g.big ? 70 : 40, {
    spacing: 4,
    accept: (x, z) => { const r = g.dominant(x, z); return g.dryLand(x, z, surfIds.get(r.key)); },
    place: (x, z) => {
      const r = g.dominant(x, z), y = g.h(x, z) + 1;
      if (r.key === 'snow') TREES.snowman(g, x, y, z);
      else if (r.key === 'candy') TREES.gumdropBush(g, x, y, z);
      else if (r.key === 'fairy') TREES.crystals(g, x, y, z);
      else return false;
    },
  });
  const cotton = g.id('cotton_candy');
  let clouds = 0;
  for (let t = 0; t < 400 && clouds < (g.big ? 8 : 5); t++) {
    const x = 10 + Math.floor(g.rand() * (g.sx - 20)), z = 10 + Math.floor(g.rand() * (g.sz - 20));
    if (g.dominant(x, z).key !== 'candy') continue;
    puffCloud(g, x, Math.min(g.sy - 6, Math.max(g.h(x, z) + 10, 42 + Math.floor(g.rand() * 8))), z, cotton);
    clouds++;
  }
  const corals = ['coral', 'coral_purple', 'coral_yellow', 'coral_blue'].map((k) => g.id(k));
  const water = g.id('water');
  g.scatter(g.big ? 80 : 45, {
    spacing: 2, avoidSpawn: 0,
    accept: (x, z) => { const h = g.h(x, z); return h < g.sea - 1 && h > g.sea - 6; },
    place: (x, z) => {
      const y = g.h(x, z) + 1;
      if (g.get(x, y, z) === water) g.set(x, y, z, corals[Math.floor(g.rand() * 4)]);
    },
  });
  g.eachSurface((x, z, h, top) => {
    if (g.distSpawn(x, z) < 7) return;
    g.dominant(x, z).flora(g, x, z, h, top);
  });
  g.hilltopGems();
}

export const biome = {
  key: 'mix',
  name: 'Everything Land',
  description: 'A little bit of every world, all together!',
  iconBlock: 'rainbow',
  colors: ['#FFE1F1', '#C9F0FF'],
  sky: { top: '#78B8FF', horizon: '#FFE2F2', fog: '#FBE6F6', sunset: '#FFB7B0', nightTop: '#1C1A55', cloud: '#FFFFFF' },
  generate,
};
