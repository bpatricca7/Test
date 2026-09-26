// Entities: furniture and other placed objects that live on the block grid.
//
// Furniture def (game.registry.furniture, register with game.entities.define(def)):
//   { key, name, category, size: [w, h, d], colors: [...] | null,
//     build(color, data) -> THREE.Group   model in block units spanning [0,w]x[0,h]x[0,d]
//                                         (origin = footprint min corner), front faces +Z
//     colliders: 'full' | 'none' | [[minx,miny,minz,maxx,maxy,maxz], ...] (model units)
//     light: 0..15 (while data.on !== false), lightPos?: [x,y,z] model units
//     actions: ['sit'] ... first one runs on Hand-tap, seat?: [x,y,z], sleepPos?: [x,y,z],
//     placeOn?: 'floor' | 'wall' | 'ceiling', defaultData?: {}, update?(entity, dt, game) }
// Placement: the tapped cell is the anchor (front row, middle); the rest of the footprint
// extends away from the front. rot 0..3 turns the front to +Z, +X, -Z, -X.

import * as THREE from 'three';
import { disposeObject } from '../core/models.js';
import { SHAPES } from '../core/registry.js';

// integer rotation of a grid offset (x, z) by rot quarter turns (same as rotation.y = rot*PI/2)
function rotXZ(x, z, rot) {
  switch (rot & 3) {
    case 1: return [z, -x];
    case 2: return [-x, -z];
    case 3: return [-z, x];
    default: return [x, z];
  }
}

const LIGHT_POOL = 4;

export class EntityManager {
  constructor(game) {
    this.game = game;
    this.defs = new Map();
    game.registry.furniture = this.defs;
    this.map = new Map(); // uid -> entity
    this.occupied = new Map(); // voxel index -> entity
    this.nextUid = 1;
    this.group = new THREE.Group();
    this.group.name = 'entities';
    this.actions = new Map();
    this.updaters = new Set();
    this.lights = [];
    for (let i = 0; i < LIGHT_POOL; i++) {
      const l = new THREE.PointLight(0xffc98a, 0, 9, 1.4);
      l.visible = true;
      this.lights.push(l);
      game.scene.add(l);
    }
    this._lightTimer = 0;
    this._tmp = new THREE.Vector3();
  }

  // ---------- definitions & actions ----------

  /** Register a furniture def and its Bag item 'furn:<key>'. Returns the def. */
  define(input) {
    const def = {
      category: 'living',
      size: [1, 1, 1],
      colors: null,
      colliders: 'full',
      light: 0,
      actions: [],
      placeOn: 'floor',
      defaultData: {},
      ...input,
    };
    if (!def.key || typeof def.build !== 'function') throw new Error('furniture needs key and build()');
    this.defs.set(def.key, def);
    const game = this.game;
    game.registry.items.register({
      key: 'furn:' + def.key,
      name: def.name || def.key,
      category: def.category,
      kind: 'furniture',
      furniture: def.key,
      colors: def.colors,
      icon: () => {
        const c = def.colors ? def.colors[0] : null;
        return game.thumbs.get(`furn:${def.key}:${c}`, () => def.build(c, { ...def.defaultData }));
      },
      use: (g, hit, opts) => !!this.placeFromHit(def.key, hit, opts && opts.color),
    });
    return def;
  }

  /** handler = { run(game, entity, hit) -> bool, hint?(game, entity) -> string|null } */
  registerAction(name, handler) {
    this.actions.set(name, handler);
  }

  // ---------- geometry helpers ----------

  _dims(def) {
    const [w, h, d] = def.size;
    return { w: Math.max(1, w | 0), h: Math.max(1, h | 0), d: Math.max(1, d | 0), ai: Math.floor((Math.max(1, w | 0) - 1) / 2) };
  }

  /** Grid cells covered by def at anchor (x,y,z) with rotation rot. */
  footprint(def, x, y, z, rot) {
    const { w, h, d, ai } = this._dims(def);
    const cells = [];
    for (let i = 0; i < w; i++) {
      for (let k = 0; k < d; k++) {
        const [ox, oz] = rotXZ(i - ai, k - (d - 1), rot);
        for (let j = 0; j < h; j++) cells.push([x + ox, y + j, z + oz]);
      }
    }
    return cells;
  }

  /** Model-space point -> world position for an entity (writes into out). */
  localToWorld(entity, lx, ly, lz, out = new THREE.Vector3()) {
    const { d, ai } = this._dims(entity.def);
    const [ox, oz] = rotXZ(lx - (ai + 0.5), lz - (d - 0.5), entity.rot);
    return out.set(entity.x + 0.5 + ox, entity.y + (entity.yOffset || 0) + ly, entity.z + 0.5 + oz);
  }

  /** Can def go at this anchor/rotation? (inside the world, not in blocks, entities or you) */
  canPlace(def, x, y, z, rot, ignore = null) {
    const game = this.game;
    const w = game.world;
    if (!w) return false;
    const props = game.registry.blocks.props;
    for (const [cx, cy, cz] of this.footprint(def, x, y, z, rot)) {
      if (!w.inBounds(cx, cy, cz)) return false;
      const id = w.get(cx, cy, cz);
      // furniture may stand on a carpet that shares its bottom cell
      const thinFloor = cy === y && props.shape[id] === SHAPES.carpet;
      if (id !== 0 && !props.replaceable[id] && !thinFloor) return false;
      const other = this.occupied.get(w.index(cx, cy, cz));
      if (other && other !== ignore) return false;
      if (def.colliders !== 'none' && game.player && game.player.overlapsCell(cx, cy, cz) && def.placeOn === 'floor') return false;
    }
    return true;
  }

  // ---------- placing & removing ----------

  /**
   * Place furniture. opts: { history = true, events = true, uid, fx = true, force = false }.
   * force skips the fit check (used when loading a saved world). Returns the entity or null.
   */
  place(key, x, y, z, rot = 0, color = null, data = {}, opts = {}) {
    const { history = true, events = true, fx = true, uid = null, force = false } = opts;
    const game = this.game;
    const def = this.defs.get(key);
    if (!def || !game.world) return null;
    rot = ((rot | 0) % 4 + 4) % 4;
    if (!force && !this.canPlace(def, x, y, z, rot)) return null;
    const w = game.world;
    const props = game.registry.blocks.props;
    // clear replaceable blocks (tall grass) out of the way
    for (const [cx, cy, cz] of this.footprint(def, x, y, z, rot)) {
      const id = w.get(cx, cy, cz);
      if (id !== 0 && props.replaceable[id] && props.shape[id] !== SHAPES.liquid) w.set(cx, cy, cz, 0, { record: false });
    }
    const entity = {
      uid: uid || this.nextUid++,
      key, x, y, z, rot,
      color: color || (def.colors ? def.colors[0] : null),
      data: { ...def.defaultData, ...data },
      def,
      object3d: null,
      cells: [],
      colliders: [],
      pickable: null,
      lightCell: null,
      yOffset: props.shape[w.get(x, y, z)] === SHAPES.carpet ? 1 / 16 : 0,
    };
    if (entity.uid >= this.nextUid) this.nextUid = entity.uid + 1;
    entity.frontCell = () => {
      const [ox, oz] = rotXZ(0, 1, entity.rot);
      return [entity.x + ox, entity.y, entity.z + oz];
    };
    this._attach(entity);
    this.map.set(entity.uid, entity);
    if (history) {
      const snapshot = { key, x, y, z, rot, color: entity.color, data: { ...entity.data }, uid: entity.uid };
      game.pushHistory({
        undo: () => { const e = this.byUid(snapshot.uid); if (e) this.remove(e, { history: false, fx: false }); },
        redo: () => this.place(snapshot.key, snapshot.x, snapshot.y, snapshot.z, snapshot.rot, snapshot.color, snapshot.data, { history: false, fx: false, uid: snapshot.uid }),
      });
    }
    if (fx) {
      game.audio.play('pop');
      game.celebrate(this.localToWorld(entity, this._dims(def).w / 2, 0.5, this._dims(def).d / 2), 'sparkle', { quiet: true });
    }
    if (events) game.events.emit('entity:place', { entity });
    return entity;
  }

  /** Build the model and register cells, colliders, pickable and light. */
  _attach(entity) {
    const game = this.game;
    const def = entity.def;
    const { w, h, d } = this._dims(def);
    const model = def.build(entity.color, entity.data);
    model.position.set(-w / 2, 0, -d / 2);
    const pivot = new THREE.Group();
    pivot.add(model);
    pivot.rotation.y = entity.rot * (Math.PI / 2);
    pivot.position.copy(this.localToWorld(entity, w / 2, 0, d / 2));
    pivot.userData.entity = entity;
    this.group.add(pivot);
    pivot.updateMatrixWorld(true);
    entity.object3d = pivot;

    entity.cells = this.footprint(def, entity.x, entity.y, entity.z, entity.rot);
    for (const [cx, cy, cz] of entity.cells) this.occupied.set(game.world.index(cx, cy, cz), entity);

    const boxes = def.colliders === 'full' ? [[0, 0, 0, w, h, d]] : def.colliders === 'none' ? [] : def.colliders || [];
    entity.colliders = boxes.map((b) => {
      const a = this.localToWorld(entity, b[0], b[1], b[2]);
      const c = this.localToWorld(entity, b[3], b[4], b[5]);
      const box3 = new THREE.Box3(a.clone().min(c), a.clone().max(c));
      game.colliders.add(box3);
      return box3;
    });

    const pickBox = new THREE.Box3().setFromObject(pivot).expandByScalar(0.02);
    if (pickBox.isEmpty()) pickBox.set(this.localToWorld(entity, 0, 0, 0), this.localToWorld(entity, w, h, d));
    entity.pickable = {
      object3d: pivot,
      kind: 'entity',
      ref: entity,
      box: pickBox,
      onUse: (g, hit) => this.use(entity, hit),
      onRemove: () => this.remove(entity, { history: true }),
      onBuild: (g, hit, item) => {
        if (item && item.key === 'furn:' + entity.key) {
          this.rotate(entity);
          return true;
        }
        return false;
      },
      hint: (g) => this.hintFor(entity, g),
    };
    game.pickables.add(entity.pickable);

    if (def.light > 0 && entity.data.on !== false) {
      const lp = def.lightPos || [w / 2, Math.min(h, 1) * 0.5, d / 2];
      const p = this.localToWorld(entity, lp[0], lp[1], lp[2]);
      entity.lightCell = [Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)];
      game.world.addLightSource(entity.lightCell[0], entity.lightCell[1], entity.lightCell[2], def.light);
    }
    if (def.update) this.updaters.add(entity);
  }

  _detach(entity) {
    const game = this.game;
    if (entity.object3d) {
      this.group.remove(entity.object3d);
      disposeObject(entity.object3d);
      entity.object3d = null;
    }
    for (const [cx, cy, cz] of entity.cells) {
      const k = game.world.index(cx, cy, cz);
      if (this.occupied.get(k) === entity) this.occupied.delete(k);
    }
    entity.cells = [];
    for (const b of entity.colliders) game.colliders.delete(b);
    entity.colliders = [];
    if (entity.pickable) game.pickables.delete(entity.pickable);
    entity.pickable = null;
    if (entity.lightCell) {
      const [lx, ly, lz] = entity.lightCell;
      game.world.removeLightSource(lx, ly, lz, entity.def.light);
      entity.lightCell = null;
    }
    this.updaters.delete(entity);
  }

  remove(entity, opts = {}) {
    const { history = true, events = true, fx = true } = opts;
    if (!entity || !this.map.has(entity.uid)) return false;
    const game = this.game;
    const player = game.player;
    if (player && player.seatEntity === entity) player.stand();
    const center = this.localToWorld(entity, this._dims(entity.def).w / 2, 0.5, this._dims(entity.def).d / 2);
    this._detach(entity);
    this.map.delete(entity.uid);
    if (history) {
      const s = { key: entity.key, x: entity.x, y: entity.y, z: entity.z, rot: entity.rot, color: entity.color, data: { ...entity.data }, uid: entity.uid };
      game.pushHistory({
        undo: () => this.place(s.key, s.x, s.y, s.z, s.rot, s.color, s.data, { history: false, fx: false, uid: s.uid, force: true }),
        redo: () => { const e = this.byUid(s.uid); if (e) this.remove(e, { history: false, fx: false }); },
      });
    }
    if (fx) {
      game.audio.play('remove');
      game.celebrate(center, 'sparkle', { quiet: true });
    }
    if (events) game.events.emit('entity:remove', { entity });
    return true;
  }

  /** Turn an entity a quarter turn (keeps its anchor if it still fits). */
  rotate(entity, dir = 1, { history = true } = {}) {
    const def = entity.def;
    for (let tries = 1; tries <= 3; tries++) {
      const rot = (entity.rot + dir * tries + 8) % 4;
      if (!this.canPlace(def, entity.x, entity.y, entity.z, rot, entity)) continue;
      const before = entity.rot;
      this._detach(entity);
      entity.rot = rot;
      this._attach(entity);
      this.game.audio.play('pop', { pitch: 1.2 });
      if (history) {
        const uid = entity.uid;
        this.game.pushHistory({
          undo: () => { const e = this.byUid(uid); if (e) this._setRot(e, before); },
          redo: () => { const e = this.byUid(uid); if (e) this._setRot(e, rot); },
        });
      }
      return true;
    }
    return false;
  }

  _setRot(entity, rot) {
    this._detach(entity);
    entity.rot = rot;
    this._attach(entity);
  }

  /** Rebuild the model (after color/data changes). */
  refresh(entity) {
    if (!this.map.has(entity.uid)) return;
    this._detach(entity);
    this._attach(entity);
  }

  /** Merge data into an entity and rebuild it (lamps on/off, doors open/closed...). */
  setData(entity, patch) {
    Object.assign(entity.data, patch);
    this.refresh(entity);
  }

  /**
   * Build-tool placement from a pick result: chooses the anchor cell and turns the front
   * toward the player (or out of the wall for wall items). Tries other rotations if needed.
   */
  placeFromHit(key, hit, color = null) {
    const game = this.game;
    const def = this.defs.get(key);
    if (!def || !hit || !hit.place) return null;
    const props = game.registry.blocks.props;
    let [x, y, z] = hit.place;
    if (hit.type === 'block' && (props.replaceable[hit.id] || (props.shape[hit.id] === SHAPES.carpet && hit.face[1] === 1))) {
      [x, y, z] = [hit.x, hit.y, hit.z];
    }
    let rot;
    if (def.placeOn === 'wall' && hit.face[1] === 0) {
      const [nx, nz] = [hit.face[0], hit.face[2]];
      rot = nz === 1 ? 0 : nx === 1 ? 1 : nz === -1 ? 2 : 3;
    } else {
      const p = game.player ? game.player.position : game.camera.position;
      const dx = p.x - (x + 0.5), dz = p.z - (z + 0.5);
      rot = Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? 1 : 3) : dz > 0 ? 0 : 2;
    }
    for (const r of [rot, (rot + 1) % 4, (rot + 3) % 4, (rot + 2) % 4]) {
      if (this.canPlace(def, x, y, z, r)) return this.place(key, x, y, z, r, color);
      if (def.placeOn === 'wall') break;
    }
    game.toast('No room there!');
    return null;
  }

  at(x, y, z) {
    const w = this.game.world;
    if (!w || !w.inBounds(x, y, z)) return null;
    return this.occupied.get(w.index(x, y, z)) || null;
  }

  byUid(uid) {
    return this.map.get(uid) || null;
  }

  all() {
    return [...this.map.values()];
  }

  // ---------- use & hints ----------

  use(entity, hit) {
    const action = entity.def.actions && entity.def.actions[0];
    const handler = action && this.actions.get(action);
    if (!handler) return false;
    const res = handler.run(this.game, entity, hit);
    this.game.events.emit('entity:use', { entity, action });
    return res !== false;
  }

  hintFor(entity, game) {
    if (game.selectedTool === 'remove') return 'Tap to remove';
    if (game.selectedTool === 'build') {
      const item = game.selectedItem();
      return item && item.key === 'furn:' + entity.key ? 'Tap to turn it' : null;
    }
    const action = entity.def.actions && entity.def.actions[0];
    const handler = action && this.actions.get(action);
    if (!handler) return null;
    return handler.hint ? handler.hint(game, entity) : 'Tap to use';
  }

  // ---------- per-frame ----------

  update(dt) {
    const game = this.game;
    for (const e of this.updaters) {
      try {
        e.def.update(e, dt, game);
      } catch (err) {
        this.updaters.delete(e);
        console.error('[entities] update failed', e.key, err);
      }
    }
    this._lightTimer -= dt;
    if (this._lightTimer > 0) return;
    this._lightTimer = 0.25;
    // give the few real point lights to the lit entities nearest the camera
    const cam = game.camera.position;
    const lit = [];
    for (const e of this.map.values()) if (e.lightCell) lit.push(e);
    lit.sort((a, b) => cam.distanceToSquared(a.object3d.position) - cam.distanceToSquared(b.object3d.position));
    const daylight = game.blockUniforms ? game.blockUniforms.uDaylight.value : 1;
    const strength = 2.2 * (1.15 - Math.min(1, daylight));
    for (let i = 0; i < this.lights.length; i++) {
      const l = this.lights[i];
      const e = lit[i];
      if (!e) {
        l.intensity = 0;
        continue;
      }
      const [lx, ly, lz] = e.lightCell;
      l.position.set(lx + 0.5, ly + 0.6, lz + 0.5);
      l.intensity = strength;
    }
  }

  // ---------- world lifecycle ----------

  clear() {
    for (const e of this.map.values()) this._detach(e);
    this.map.clear();
    this.occupied.clear();
    this.updaters.clear();
    this.nextUid = 1;
    for (const l of this.lights) l.intensity = 0;
  }

  serialize() {
    return this.all().map((e) => ({ uid: e.uid, key: e.key, x: e.x, y: e.y, z: e.z, rot: e.rot, color: e.color, data: e.data }));
  }

  deserialize(list) {
    if (!Array.isArray(list)) return;
    for (const s of list) {
      if (!this.defs.has(s.key)) continue;
      this.place(s.key, s.x, s.y, s.z, s.rot, s.color, s.data || {}, { history: false, events: false, fx: false, uid: s.uid, force: true });
    }
  }
}

export function install(game) {
  const manager = new EntityManager(game);
  game.entities = manager;
  game.addSystem({
    name: 'entities',
    onWorldLoad() {
      manager.clear();
      game.scene.add(manager.group);
    },
    onWorldUnload() {
      manager.clear();
      game.scene.remove(manager.group);
    },
    update: (dt) => {
      if (game.world) manager.update(dt);
    },
    serialize: () => manager.serialize(),
    deserialize: (data) => manager.deserialize(data),
  });
}
