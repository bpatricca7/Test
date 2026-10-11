// Beach Island: one sunny island in a turquoise sea, with a shallow lagoon, palm trees,
// seashells and starfish on the sand, coral under the water, tiny palm islets, a sandcastle.

import { Gen, TREES, mound } from './gen.js';
import { driftKind, fieldAt, ahead, placeAt } from './common.js';
import { smoothstep, lerp, clamp } from '../../core/util.js';

const FLOWERS = ['flower_poppy', 'flower_tulip_red', 'flower_tulip_pink', 'flower_rose', 'flower_cosmos'];

export const region = {
  key: 'beach',
  /** Region height for Everything Land: low sandy dunes around sea level. */
  height(g, x, z) {
    const n = g.noise.fbm2(x / 50 + 9, z / 50 - 4, 3);
    const dunes = Math.max(0, g.noise.fbm2(x / 22 - 30, z / 22 + 8, 2));
    return g.sea + 1 + n * 3 + dunes * 4;
  },
  column(g, x, z, h) {
    const pinkPatch = g.noise.n2(x / 18 + 50, z / 18 - 50) > 0.45;
    if (h < g.sea) {
      const v = g.noise.n2(x / 9, z / 9);
      return [g.id(v > 0.55 ? 'gravel' : pinkPatch ? 'sand_pink' : 'sand'), g.id('sand'), g.id('stone')];
    }
    if (h <= g.sea + 2) return [g.id(pinkPatch ? 'sand_pink' : 'sand'), g.id('sand'), g.id('stone'), 4];
    return [g.id('grass'), g.id('dirt'), g.id('stone')];
  },
  surfaces: ['sand', 'sand_pink', 'grass'],
  forest(g, x, z) {
    return Math.max(0, g.noise.fbm2(x / 30 + 50, z / 30, 2));
  },
  tree(g, x, y, z) {
    TREES.palm(g, x, y, z);
  },
  flora(g, x, z, h, top) {
    const sand = top === g.id('sand') || top === g.id('sand_pink');
    const r = g.rand();
    if (sand) {
      if (r < 0.012) g.set(x, h + 1, z, g.id('seashell'));
      else if (r < 0.018) g.set(x, h + 1, z, g.id('starfish'));
      else if (r < 0.05 && h > g.sea + 1 && g.noise.n2(x / 7, z / 7) > 0.2) g.set(x, h + 1, z, g.id('grass_tall'));
      return;
    }
    if (top !== g.id('grass')) return;
    const field = fieldAt(g, x, z, 3);
    if (r < (field > 0.25 ? 0.14 : 0.02)) g.set(x, h + 1, z, g.id(driftKind(g, x, z, FLOWERS, 2)));
    else if (r < 0.2) g.set(x, h + 1, z, g.id(g.rand() < 0.2 ? 'fern' : 'grass_tall'));
  },
};

export function generate(world, rand, noise) {
  const g = new Gen(world, rand, noise, { sea: 20 });
  const { cx, cz, sea } = g;
  const R0 = g.sx * 0.33;
  // a few tiny islets around the main island
  const islets = [];
  const nIslets = g.big ? 5 : 3;
  for (let k = 0; k < nIslets; k++) {
    const a = (k / nIslets) * Math.PI * 2 + rand() * 0.8;
    const d = R0 * (1.18 + rand() * 0.1);
    islets.push([cx + Math.cos(a) * d, cz + Math.sin(a) * d, 3 + rand() * 2]);
  }
  // the lagoon: a shallow round bay joined to the sea by a narrow channel, ahead of the start
  const la = -Math.PI / 2 + (rand() < 0.5 ? -1 : 1) * (0.5 + rand() * 0.3);
  const lagoon = [cx + Math.cos(la) * R0 * 0.66, cz + Math.sin(la) * R0 * 0.66, R0 * 0.28];

  g.shape((x, z) => {
    const dx = x - cx, dz = z - cz;
    const ang = Math.atan2(dz, dx);
    const rr = R0 * (1 + 0.16 * noise.n2(Math.cos(ang) * 1.3 + 7, Math.sin(ang) * 1.3 - 3) + 0.07 * noise.n2(Math.cos(ang) * 3 + 1, Math.sin(ang) * 3));
    const d = Math.hypot(dx, dz) / rr;
    if (d < 1) {
      const hills = 0.7 + 0.5 * noise.fbm2(x / 30, z / 30, 2);
      return sea + 1.4 + smoothstep(0.8, 0.25, d) * 5 * hills + (1 - d) * 1.2;
    }
    // a wide sandy shelf keeps the sea shallow and turquoise near the island
    return clamp(sea + 1.4 - Math.min(3.6, (d - 1) * rr * 0.25) - Math.max(0, d - 1.35) * rr * 0.12, sea - 10, 50);
  });
  g.flattenSpawn(5, 13, 0.5);
  g.islandEdge(6);
  // islets and the lagoon go in after the shore so the sea edge cannot drown them
  const { sx, sz, hf } = g;
  for (let z = 0; z < sz; z++) {
    for (let x = 0; x < sx; x++) {
      const k = z * sx + x;
      let h = hf[k];
      for (const [ix, iz, ir] of islets) {
        const di = Math.hypot(x - ix, z - iz) / ir;
        if (di < 1.6) h = Math.max(h, sea + 1.6 - di * di * 2.4);
      }
      const dl = Math.hypot(x - lagoon[0], z - lagoon[1]) / lagoon[2];
      if (dl < 1) h = Math.min(h, lerp(sea - 2.2, sea + 1.5, dl * dl));
      const dx = x - cx, dz = z - cz;
      const along = (dx * Math.cos(la) + dz * Math.sin(la)) / R0, side = Math.abs(-dx * Math.sin(la) + dz * Math.cos(la));
      if (along > 0.66 && side < 1.8) h = Math.min(h, sea - 1.2);
      hf[k] = h;
    }
  }
  g.commit();
  g.fillColumns((x, z, h) => region.column(g, x, z, h));
  g.fillSea(g.id('water'));
  decorate(g, islets, lagoon);
  world.outside = { block: 'water', surface: g.sea + 0.875 };
  return g.finish();
}

function decorate(g, islets, lagoon) {
  const land = region.surfaces.map((k) => g.id(k));
  const sand = [g.id('sand'), g.id('sand_pink')];
  // palms: along the beach ring and here and there inland
  placeAt(g, ...ahead(g, -0.65, 14), TREES.palm, { force: true, surfaces: land });
  placeAt(g, ...ahead(g, 0.72, 15), TREES.palm, { force: true, surfaces: land });
  g.scatter(Math.floor((g.sx * g.sz) / 45), {
    spacing: 3,
    accept: (x, z) => {
      if (!g.dryLand(x, z, land)) return false;
      const onSand = sand.includes(g.top(x, z));
      return g.rand() < (onSand ? 0.35 : 0.08 + region.forest(g, x, z) * 0.5);
    },
    place: (x, z) => TREES.palm(g, x, g.h(x, z) + 1, z),
  });
  // tiny islets: one palm each and a gem
  for (const [ix, iz] of islets) {
    const x = Math.round(ix), z = Math.round(iz);
    if (g.dryLand(x, z)) {
      TREES.palm(g, x, g.h(x, z) + 1, z);
      g.gem(x + 1, g.h(x + 1, z) + 1, z + 1, 'island');
    }
  }
  // bushes on the grass
  const leaf = g.id('leaves_oak');
  g.scatter(Math.floor((g.sx * g.sz) / 400), {
    spacing: 2,
    accept: (x, z) => g.dryLand(x, z, [g.id('grass')]),
    place: (x, z) => mound(g, x, g.h(x, z) + 1, z, [leaf, g.id('hedge_flowers')], 1),
  });
  // coral gardens in the shallows
  const corals = ['coral', 'coral_purple', 'coral_yellow', 'coral_blue'].map((k) => g.id(k));
  const water = g.id('water');
  g.scatter(g.big ? 90 : 50, {
    spacing: 2, avoidSpawn: 0,
    accept: (x, z) => { const h = g.h(x, z); return h < g.sea - 1 && h > g.sea - 6; },
    place: (x, z) => {
      const n = 2 + Math.floor(g.rand() * 4);
      for (let k = 0; k < n; k++) {
        const xx = x + Math.floor(g.rand() * 3) - 1, zz = z + Math.floor(g.rand() * 3) - 1;
        const y = g.h(xx, zz) + 1;
        if (g.get(xx, y, zz) === water && y < g.sea) g.set(xx, y, zz, corals[Math.floor(g.rand() * 4)]);
        if (g.rand() < 0.35 && g.get(xx, y + 1, zz) === water && y + 1 < g.sea) g.set(xx, y + 1, zz, corals[Math.floor(g.rand() * 4)]);
      }
    },
  });
  // a sandcastle on the beach
  g.scatter(40, {
    spacing: 4,
    accept: (x, z) => {
      if (g.distSpawn(x, z) < 14) return false;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (!g.dryLand(x + dx, z + dz, sand) || g.h(x + dx, z + dz) !== g.h(x, z)) return false;
      return true;
    },
    place: (x, z) => {
      if (g._castle) return false;
      g._castle = true;
      sandcastle(g, x, g.h(x, z) + 1, z);
    },
  });
  // the lagoon: shells on its sandy rim
  for (let k = 0; k < 14; k++) {
    const a = g.rand() * Math.PI * 2;
    const x = Math.round(lagoon[0] + Math.cos(a) * lagoon[2] * 1.1), z = Math.round(lagoon[1] + Math.sin(a) * lagoon[2] * 1.1);
    if (g.dryLand(x, z, sand)) g.setAir(x, g.h(x, z) + 1, z, g.id(g.rand() < 0.6 ? 'seashell' : 'starfish'));
  }
  g.gem(Math.round(lagoon[0]), g.sea + 1, Math.round(lagoon[1]), 'lagoon');
  g.eachSurface((x, z, h, top) => {
    if (g.distSpawn(x, z) < 6) return;
    region.flora(g, x, z, h, top);
  });
  g.hilltopGems(4);
}

/** A little sandcastle: four towers, walls and a pink flag. */
function sandcastle(g, x, y, z) {
  const s = g.id('sand');
  for (let dz = -2; dz <= 2; dz++) {
    for (let dx = -2; dx <= 2; dx++) {
      const edge = Math.abs(dx) === 2 || Math.abs(dz) === 2;
      if (!edge) continue;
      g.set(x + dx, y, z + dz, s);
      if ((dx + dz) % 2 === 0) g.set(x + dx, y + 1, z + dz, s);
    }
  }
  for (const [dx, dz] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) {
    g.set(x + dx, y + 1, z + dz, s);
    g.set(x + dx, y + 2, z + dz, s);
  }
  g.set(x, y, z, s); g.set(x, y + 1, z, s); g.set(x, y + 2, z, s);
  g.set(x, y + 3, z, g.id('wool_pink'));
  g.gem(x + 1, y, z + 1, 'castle');
}

export const biome = {
  key: 'beach',
  name: 'Beach Island',
  description: 'Palm trees, seashells and a sparkly lagoon',
  iconBlock: 'shell',
  colors: ['#BDF1FF', '#FBE7B0'],
  sky: { top: '#3FB2FF', horizon: '#BDF3FF', fog: '#CBF6FF', sunset: '#FFB08A', nightTop: '#10245A', cloud: '#FFFFFF' },
  generate,
};

