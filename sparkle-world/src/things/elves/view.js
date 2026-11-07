// The world as the hiding-place picker (spots.js) sees it: blocks from the world, furniture
// from game.entities. Reads only; nothing here changes the world.

import { furnitureTop, localCell } from './spots.js';

const SHAPE_CUBE = 1, SHAPE_SLAB = 3, SHAPE_LIQUID = 5; // core/registry.js SHAPES

// furniture an elf never perches on: play things the player uses, hot or wet things, doors, vehicles
const NO_PERCH = /^(elf_|gift_box)|toilet|stove|oven|campfire|grill|trampoline|swing|slide|well|fountain|ladder|zip|pool|hot_tub|tub_hot/;

/** Can an elf stand on top of this piece? */
export function perchable(e) {
  const def = e && e.def;
  if (!def || def.flat || def.vehicle || def.colliders === 'none' || def.placeOn === 'ceiling' || def.placeOn === 'wall') return false;
  if (NO_PERCH.test(e.key)) return false;
  if (Array.isArray(def.actions) && (def.actions.includes('door') || def.actions.includes('drive') || def.actions.includes('climb'))) return false;
  return true;
}

/**
 * opts.village: a world team's record may stand where a plant or a snow tuft is (the world
 * is brand new; nothing built is there yet). Player worlds: plain air only.
 */
export function makeView(game, { village = false } = {}) {
  const w = game.world;
  const E = game.entities;
  const props = game.registry.blocks.props;
  const reg = game.registry.blocks;
  const net = game.net;
  const keyOf = (id) => {
    const def = reg.byId ? reg.byId(id) : null;
    return def ? def.key : '';
  };
  const solidId = (id) => id !== 0 && props.solid[id] === 1 && !props.replaceable[id];
  const entityAt = (x, y, z) => {
    const e = E ? E.at(x, y, z) : null;
    return e && !e.def.flat ? e : null;
  };
  return {
    inBounds: (x, y, z) => !!w && w.inBounds(x, y, z),
    solid(x, y, z) {
      if (!w) return true;
      if (!w.inBounds(x, y, z)) return y < 0;
      return solidId(w.get(x, y, z));
    },
    liquid(x, y, z) {
      if (!w || !w.inBounds(x, y, z)) return false;
      return props.shape[w.get(x, y, z)] === SHAPE_LIQUID;
    },
    open(x, y, z) {
      if (!w || !w.inBounds(x, y, z)) return false;
      const id = w.get(x, y, z);
      if (id !== 0 && !(village && props.replaceable[id] && props.shape[id] !== SHAPE_LIQUID)) return false;
      if (entityAt(x, y, z)) return false;
      if (net && net.active && typeof net.cellHasFriend === 'function' && net.cellHasFriend(x, y, z)) return false;
      return true;
    },
    support(x, y, z) {
      if (!w || !w.inBounds(x, y - 1, z)) return null;
      const id = w.get(x, y - 1, z);
      if (id !== 0) {
        if (!solidId(id)) return null;
        const shape = props.shape[id];
        if (shape === SHAPE_CUBE) return { dy: 0, kind: 'block', key: keyOf(id) };
        if (shape === SHAPE_SLAB) return { dy: -0.5, kind: 'block', key: keyOf(id) };
        return null;
      }
      const e = entityAt(x, y - 1, z);
      if (!e || !perchable(e)) return null;
      const h = Math.max(1, e.def.size[1] | 0);
      if (y - 1 !== e.y + h - 1) return null; // only on the top of a piece
      const lc = localCell(e, x, z);
      if (!lc) return null;
      const top = furnitureTop(e.def, lc[0], lc[1], e.data, e);
      if (top === null) return null;
      const dy = (e.yOffset || 0) + top - h;
      if (!(dy > -1 && dy <= 0.05)) return null;
      return { dy, kind: 'furn', key: e.key, uid: e.uid, bath: /bath/.test(e.key) && !/mat|sink/.test(e.key) };
    },
    standable(x, y, z) {
      if (!w || !w.inBounds(x, y, z)) return false;
      for (let k = 0; k < 2; k++) {
        const id = w.get(x, y + k, z);
        if (solidId(id) || (k === 1 && props.shape[id] === SHAPE_LIQUID)) return false;
        const e = entityAt(x, y + k, z);
        if (e && e.def.colliders !== 'none' && !e.key.startsWith('elf_')) return false;
      }
      const below = w.inBounds(x, y - 1, z) ? w.get(x, y - 1, z) : 0;
      if (solidId(below)) return true;
      const e = entityAt(x, y - 1, z);
      return !!(e && e.def.colliders !== 'none');
    },
  };
}
