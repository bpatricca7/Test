// Block and item registries. Blocks get numeric ids (0 = air) and are auto-registered as
// items 'block:<key>' so every block is reachable from the Bag and the hotbar.

import { paintTileCanvas, drawBlockIcon } from '../world/textures.js';

export const SHAPES = { air: 0, cube: 1, cross: 2, slab: 3, carpet: 4, liquid: 5 };
export const PASS = { none: 0, opaque: 1, cutout: 2, translucent: 3 };

/** Bag tabs in display order (id -> label). */
export const ITEM_CATEGORIES = [
  ['nature', 'Nature'], ['building', 'Building'], ['colors', 'Colors'], ['candy', 'Candy'],
  ['glass', 'Glass & Windows'], ['lights', 'Lights'], ['bedroom', 'Bedroom'], ['living', 'Living Room'],
  ['kitchen', 'Kitchen'], ['bathroom', 'Bathroom'], ['garden', 'Garden'], ['fun', 'Fun & Toys'],
  ['pets', 'Pets'], ['food', 'Food'], ['houses', 'Magic Houses'],
];

function titleCase(key) {
  return key.replace(/[_:]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export class BlockRegistry {
  constructor(items) {
    this.items = items;
    this.defs = [];
    this.keyToId = new Map();
    this.painters = new Map();
    this.tileOptions = new Map();
    this.frozen = false;
    this.register({ key: 'air', name: 'Air', shape: 'air', solid: false, hidden: true, tiles: null });
  }

  /**
   * Register a tile painter: painter(ctx, rand) paints a 16x16 tile.
   * opts.animated: the block shader gently wobbles this tile (water).
   */
  tile(key, painter, opts = null) {
    if (this.frozen) console.warn(`[blocks] tile "${key}" registered after textures were built`);
    this.painters.set(key, painter);
    if (opts) this.tileOptions.set(key, opts);
  }

  register(input) {
    if (!input || !input.key) throw new Error('block needs a key');
    if (this.keyToId.has(input.key)) {
      console.warn(`[blocks] "${input.key}" registered twice; keeping the first`);
      return this.byKey(input.key);
    }
    if (this.defs.length >= 256) throw new Error('too many block types (max 255)');
    if (this.frozen) console.warn(`[blocks] "${input.key}" registered after textures were built`);
    const shape = input.shape || 'cube';
    const transparent = !!input.transparent || shape === 'cross';
    const translucent = !!input.translucent || shape === 'liquid';
    const fullOpaque = shape === 'cube' && !transparent && !translucent;
    const def = {
      name: titleCase(input.key),
      category: 'building',
      tiles: { all: input.key },
      solid: shape !== 'cross' && shape !== 'liquid' && shape !== 'air',
      light: 0,
      tint: null,
      onUse: null,
      hidden: false,
      // sprites (flowers, tall grass) give way to blocks and furniture placed on them
      replaceable: shape === 'air' || shape === 'liquid' || shape === 'cross',
      lightOpacity: fullOpaque ? 15 : translucent ? 1 : 0,
      sound: 'place',
      ...input,
      shape,
      transparent,
      translucent,
      id: this.defs.length,
    };
    def.opaque = fullOpaque;
    this.defs.push(def);
    this.keyToId.set(def.key, def.id);

    if (def.id !== 0 && !def.hidden && this.items) {
      const reg = this;
      this.items.register({
        key: 'block:' + def.key,
        name: def.name,
        category: def.category,
        kind: 'block',
        block: def.key,
        icon: () => reg.iconFor(def.key),
        use: (game, hit, opts) => game.placeBlockFromHit(hit, def.key, opts),
      });
    }
    return def;
  }

  byKey(key) {
    const id = this.keyToId.get(key);
    return id === undefined ? null : this.defs[id];
  }

  byId(id) {
    return this.defs[id] || null;
  }

  /** Numeric id for a key, or -1 when unknown. */
  idOf(key) {
    const id = this.keyToId.get(key);
    return id === undefined ? -1 : id;
  }

  has(key) {
    return this.keyToId.has(key);
  }

  all() {
    return this.defs.slice(1);
  }

  get count() {
    return this.defs.length;
  }

  /** Tile key for one face of a block. face: 0 +X, 1 -X, 2 +Y (top), 3 -Y (bottom), 4 +Z (front), 5 -Z. */
  faceTile(def, face) {
    const t = def.tiles || {};
    if (t.all) return t.all;
    if (face === 2) return t.top || t.sides || t.side;
    if (face === 3) return t.bottom || t.top || t.sides || t.side;
    if (face === 4 && t.front) return t.front;
    return t.sides || t.side || t.top;
  }

  /**
   * Called by the texture builder once all tiles have layers. Builds flat typed arrays that
   * the mesher, lighting and physics read in their hot loops.
   * layerOf(tileKey, tint) -> layer index; animated(tileKey) -> bool.
   */
  finalize(layerOf, animated) {
    const n = this.defs.length;
    const p = {
      shape: new Uint8Array(256),
      pass: new Uint8Array(256),
      opaque: new Uint8Array(256),
      solid: new Uint8Array(256),
      emit: new Uint8Array(256),
      opacity: new Uint8Array(256),
      replaceable: new Uint8Array(256),
      selectable: new Uint8Array(256),
      faceLayer: new Uint16Array(256 * 6),
    };
    for (let id = 0; id < n; id++) {
      const d = this.defs[id];
      const shape = SHAPES[d.shape] ?? 1;
      p.shape[id] = shape;
      p.pass[id] = shape === 0 ? PASS.none : d.translucent ? PASS.translucent : d.transparent ? PASS.cutout : PASS.opaque;
      p.opaque[id] = d.opaque ? 1 : 0;
      p.solid[id] = d.solid ? 1 : 0;
      p.emit[id] = Math.max(0, Math.min(15, d.light | 0));
      p.opacity[id] = Math.max(0, Math.min(15, d.lightOpacity | 0));
      p.replaceable[id] = d.replaceable ? 1 : 0;
      p.selectable[id] = shape !== 0 && shape !== SHAPES.liquid ? 1 : 0;
      if (shape !== 0) {
        for (let f = 0; f < 6; f++) {
          const tileKey = this.faceTile(d, f);
          let layer = layerOf(tileKey, d.tint);
          if (animated(tileKey)) layer += 1024;
          p.faceLayer[id * 6 + f] = layer;
        }
      }
    }
    this.props = p;
    this.frozen = true;
  }

  /** Isometric (or flat, for sprites) icon for a block, as a PNG data URL. Cached. */
  iconFor(key) {
    if (!this._icons) this._icons = new Map();
    let p = this._icons.get(key);
    if (!p) {
      const def = this.byKey(key);
      p = Promise.resolve(def ? drawBlockIcon(this, def) : '');
      this._icons.set(key, p);
    }
    return p;
  }

  /** 16x16 canvas of a tile (tinted if requested), for UI previews. */
  tileCanvas(tileKey, tint = null) {
    return paintTileCanvas(this, tileKey, tint);
  }
}

export class ItemRegistry {
  constructor() {
    this.map = new Map();
    this._icons = new Map();
  }

  /**
   * item = { key, name, category, icon: () => Promise<dataURL>, colors?, use(game, hit, opts) -> bool,
   *          kind?: 'block'|'furniture'|'other', hidden? }
   */
  register(item) {
    if (!item || !item.key) throw new Error('item needs a key');
    const full = {
      name: titleCase(item.key.split(':').pop()),
      category: 'fun',
      colors: null,
      kind: 'other',
      hidden: false,
      icon: null,
      use: null,
      ...item,
    };
    this.map.set(full.key, full);
    this._icons.delete(full.key);
    return full;
  }

  get(key) {
    return this.map.get(key) || null;
  }

  has(key) {
    return this.map.has(key);
  }

  all() {
    return [...this.map.values()];
  }

  /** Visible items of one Bag tab, in registration order. */
  byCategory(category) {
    const out = [];
    for (const it of this.map.values()) if (it.category === category && !it.hidden) out.push(it);
    return out;
  }

  /** Cached icon data URL for an item ('' when it has none). Never rejects. */
  iconFor(key) {
    let p = this._icons.get(key);
    if (!p) {
      const it = this.get(key);
      p = Promise.resolve()
        .then(() => (it && it.icon ? it.icon() : ''))
        .catch((err) => {
          console.warn('[items] icon failed for', key, err);
          return '';
        });
      this._icons.set(key, p);
    }
    return p;
  }
}
