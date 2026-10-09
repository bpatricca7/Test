// Furniture & home life: registers every canonical furniture piece (see DESIGN.md) with
// detailed voxel-style models, color swatches, sizes, colliders, surfaces and placement
// modes, plus all Hand-tool actions (sit, sleep, doors, lamps, piano, TV, cooking, dress-up,
// bath, toys...), their animations and the Piano, Storybook, Easel and Letter panels.
//
// Files: furniture/catalog.js (defs), furniture/life.js (actions, animations, ladders,
// trampolines, swing, slide), furniture/models-*.js (models, via furniture-models.js),
// furniture/kit.js (merged-geometry model builder), furniture/paint.js (textures),
// furniture/sfx.js (synthesized sounds), furniture/panel-*.js (UI panels), furniture/tv.js.

import { furnitureDefs } from './furniture/catalog.js';
import { installLife } from './furniture/life.js';
import { createSfx } from './furniture/sfx.js';
import { installPiano } from './furniture/panel-piano.js';
import { installBook } from './furniture/panel-book.js';
import { installEasel } from './furniture/panel-easel.js';
import { SHAPES } from '../core/registry.js';
import { install as installOutdoor } from './outdoor/index.js';

/** Pool floats bob at the water line when placed on water (Build aims through water). */
function patchPoolFloat(game) {
  const E = game.entities;
  const item = game.registry.items.get('furn:pool_float');
  if (!item) return;
  item.use = (g, hit, opts) => {
    const color = (opts && opts.color) || null;
    if (hit && hit.type === 'block' && hit.place && g.world) {
      const w = g.world;
      const props = g.registry.blocks.props;
      let [x, y, z] = hit.place;
      const wet = (yy) => w.inBounds(x, yy, z) && props.shape[w.get(x, yy, z)] === SHAPES.liquid;
      if (wet(y)) {
        while (wet(y + 1)) y++;
        const p = g.player ? g.player.position : g.camera.position;
        const dx = p.x - (x + 0.5), dz = p.z - (z + 0.5);
        const rot = Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? 1 : 3) : dz > 0 ? 0 : 2;
        const e = E.place('pool_float', x, y, z, rot, color, { water: true });
        if (e) return true;
      }
    }
    return !!E.placeFromHit('pool_float', hit, color);
  };
}

export function install(game) {
  const E = game.entities;
  if (!E) return;
  const sfx = createSfx(game);
  const life = installLife(game, sfx);
  for (const def of furnitureDefs()) {
    if (life.updates[def.key]) def.update = life.updates[def.key];
    E.define(def);
  }
  patchPoolFloat(game);
  let panels = {};
  if (game.ui) {
    panels = {
      piano: installPiano(game),
      book: installBook(game),
    };
    installEasel(game);
  }
  // a small handle for other modules and tests
  game.furniture = { sfx, panels, timeWords: life.timeWords, spawnToy: life.spawnToy };
  // wave 2: zip lines, treehouse parts, camping & the salon chair (src/things/outdoor)
  installOutdoor(game);
}
