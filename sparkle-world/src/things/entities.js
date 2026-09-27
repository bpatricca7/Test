// Entities: furniture and other placed objects that live on the block grid.
//
// Furniture def (game.registry.furniture, register with game.entities.define(def)):
//   { key, name, category, size: [w, h, d], colors: [...] | null,
//     build(color, data) -> THREE.Group   model in block units spanning [0,w]x[0,h]x[0,d]
//                                         (origin = footprint min corner), front faces +Z
//     colliders: 'full' | 'none' | [[minx,miny,minz,maxx,maxy,maxz], ...] (model units), or a
//                function (data, entity) returning one of those (doors: open ones let you pass)
//     flat?: true  rugs & mats: other furniture may stand on the same cells (they only block
//                  blocks and other flat pieces)
//     light: 0..15 (while data.on !== false), lightPos?: [x,y,z] model units
//     actions: ['sit'] ... first one runs on Hand-tap, seat?: [x,y,z], sleepPos?: [x,y,z],
//     placeOn?: 'floor' | 'wall' | 'ceiling' | 'table', surface?: number,
//     defaultData?: {}, update?(entity, dt, game) }
// Placement: the tapped cell is the anchor (front row, middle); the rest of the footprint
// extends away from the front. rot 0..3 turns the front to +Z, +X, -Z, -X.
//   'wall'    tapped on a wall face: faces out of the wall.
//   'ceiling' hangs in the cell under a solid block (tap the ceiling, or the floor below it);
//             the model hangs from the top of its box.
//   'table'   stands on top of furniture that declares `surface` (the height of its top in
//             model units, e.g. 0.82 for a table); on the floor otherwise.

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
const CEILING_SEARCH = 8; // a ceiling item tapped on the floor looks this far up for a ceiling
const BATCH = 16; // side (in blocks) of the squares whose static furniture shares draw calls

const _bm = new THREE.Matrix4();
const _bn = new THREE.Matrix3();

// batch attribute arrays are only needed until the GPU has them (a batch is rebuilt from the
// pieces' baked copies whenever it changes, and after a lost WebGL context comes back)
function releaseArray() {
  this.array = null;
}

/**
 * Static batching. The furniture Kit merges a piece's static bits into one mesh per material
 * (almost everything shares the atlas material, see furniture/atlas.js) and marks those
 * meshes userData.batch. When a piece is placed, those meshes are baked into world space and
 * taken out of its model; the baked copies of every piece in a BATCH x BATCH square of the
 * world are merged into ONE mesh per material, so a furnished house costs a couple of draw
 * calls instead of hundreds. Moving parts (doors, swings, flames...), see-through and
 * per-piece materials (TV screens, easel pictures) stay in the piece's model, and so does the
 * whole model of a def with `batch: false` (beanbag, trampoline: the whole model squishes).
 * Batches rebuild lazily, right before the next render of the scene (frame, thumbnail,
 * photo), when a piece in their square is placed, removed or rebuilt.
 */
class StaticBatcher {
  constructor(manager) {
    this.manager = manager;
    this.group = new THREE.Group();
    this.group.name = 'furniture-batches';
    manager.group.add(this.group);
    this.regions = new Map(); // "rx,rz" -> { key, items: Set<entity>, meshes: Map<material, Mesh>, dirty: Set<material> }
    this.dirty = new Set(); // regions with dirty materials
    this.stale = new WeakSet(); // batch geometries from before a lost WebGL context
    this.failed = false;
  }

  /** Bake an attached entity's static meshes and queue them for its square's batches. */
  add(entity) {
    if (this.failed || entity.def.batch === false) return;
    const pivot = entity.object3d;
    const model = pivot && pivot.children[0];
    if (!model) return;
    let list = null;
    for (const o of model.children) {
      if (!o.isMesh || !o.userData.batch || !o.visible || !o.geometry || !o.geometry.attributes.position) continue;
      const m = o.material;
      if (!m || Array.isArray(m) || m.transparent || !(m.userData && m.userData.shared)) continue;
      (list || (list = [])).push(o);
    }
    if (!list) return;
    pivot.updateMatrix();
    model.updateMatrix();
    const pieces = [];
    for (const o of list) {
      pieces.push(this._bake(pivot, model, o));
      model.remove(o);
      o.geometry.dispose();
    }
    const key = Math.floor(entity.x / BATCH) + ',' + Math.floor(entity.z / BATCH);
    let rec = this.regions.get(key);
    if (!rec) {
      rec = { key, items: new Set(), meshes: new Map(), dirty: new Set() };
      this.regions.set(key, rec);
    }
    rec.items.add(entity);
    entity._batch = { rec, pieces };
    for (const pc of pieces) rec.dirty.add(pc.mat);
    this.dirty.add(rec);
  }

  /** One static mesh in the entities group's space: positions and normals transformed; the
   * other attributes (uv, color, atlas look) and the index are shared with the Kit geometry. */
  _bake(pivot, model, o) {
    o.updateMatrix();
    _bm.multiplyMatrices(pivot.matrix, model.matrix).multiply(o.matrix);
    _bn.getNormalMatrix(_bm);
    const m = _bm.elements, q = _bn.elements;
    const g = o.geometry;
    const P = g.attributes.position, N = g.attributes.normal;
    const n = P.count;
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3);
    for (let k = 0; k < n; k++) {
      const x = P.getX(k), y = P.getY(k), z = P.getZ(k);
      const i = k * 3;
      pos[i] = m[0] * x + m[4] * y + m[8] * z + m[12];
      pos[i + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
      pos[i + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
      if (N) {
        const a = N.getX(k), b = N.getY(k), c = N.getZ(k);
        const nx = q[0] * a + q[3] * b + q[6] * c;
        const ny = q[1] * a + q[4] * b + q[7] * c;
        const nz = q[2] * a + q[5] * b + q[8] * c;
        const l = Math.hypot(nx, ny, nz) || 1;
        nor[i] = nx / l; nor[i + 1] = ny / l; nor[i + 2] = nz / l;
      } else {
        nor[i + 1] = 1;
      }
    }
    const attrs = { position: { size: 3, array: pos }, normal: { size: 3, array: nor } };
    for (const name in g.attributes) {
      if (name === 'position' || name === 'normal') continue;
      const a = g.attributes[name];
      if (a.isInterleavedBufferAttribute || !a.array) continue;
      attrs[name] = { size: a.itemSize, array: a.array };
    }
    return { mat: o.material, n, attrs, index: g.index ? g.index.array : null };
  }

  /** Take a (detaching) entity out of its batches. */
  remove(entity) {
    const b = entity._batch;
    if (!b) return;
    entity._batch = null;
    b.rec.items.delete(entity);
    for (const pc of b.pieces) b.rec.dirty.add(pc.mat);
    this.dirty.add(b.rec);
  }

  /** Rebuild every batch that changed (called just before the scene renders). */
  flush() {
    if (!this.dirty.size) return;
    try {
      for (const rec of this.dirty) {
        for (const mat of rec.dirty) this._rebuild(rec, mat);
        rec.dirty.clear();
        if (!rec.items.size && !rec.meshes.size) this.regions.delete(rec.key);
      }
      this.dirty.clear();
    } catch (err) {
      // never lose furniture over this: rebuild every piece whole and draw them one by one
      console.error('[entities] static batching failed; drawing pieces one by one', err);
      this.failed = true;
      const items = [];
      for (const rec of this.regions.values()) for (const e of rec.items) items.push(e);
      this.clear();
      for (const e of items) {
        e._batch = null;
        this.manager.refresh(e);
      }
    }
  }

  /** Rebuild every batch (after a lost WebGL context came back: the GPU copies are gone). */
  rebuildAll() {
    for (const rec of this.regions.values()) {
      for (const [mat, mesh] of rec.meshes) {
        this.stale.add(mesh.geometry); // its buffers died with the old context
        rec.dirty.add(mat);
      }
      this.dirty.add(rec);
    }
  }

  _drop(geometry) {
    if (!this.stale.has(geometry)) geometry.dispose();
  }

  _rebuild(rec, mat) {
    let verts = 0, indices = 0, first = null;
    for (const e of rec.items) {
      for (const pc of e._batch.pieces) {
        if (pc.mat !== mat) continue;
        if (!first) first = pc;
        verts += pc.n;
        indices += pc.index ? pc.index.length : pc.n;
      }
    }
    let mesh = rec.meshes.get(mat);
    if (!verts) {
      if (mesh) {
        this.group.remove(mesh);
        this._drop(mesh.geometry);
        rec.meshes.delete(mat);
      }
      return;
    }
    const out = {};
    for (const name in first.attrs) out[name] = new Float32Array(verts * first.attrs[name].size);
    const index = verts > 65535 ? new Uint32Array(indices) : new Uint16Array(indices);
    let v = 0, ii = 0;
    for (const e of rec.items) {
      for (const pc of e._batch.pieces) {
        if (pc.mat !== mat) continue;
        for (const name in out) {
          const size = first.attrs[name].size;
          const a = pc.attrs[name];
          if (a && a.size === size) out[name].set(a.array.length > pc.n * size ? a.array.subarray(0, pc.n * size) : a.array, v * size);
          else if (name === 'color') out[name].fill(1, v * size, (v + pc.n) * size);
          else if (name === 'fLook') for (let k = 0; k < pc.n; k++) out[name][(v + k) * 2] = -1;
        }
        if (pc.index) {
          const I = pc.index;
          for (let k = 0; k < I.length; k++) index[ii++] = v + I[k];
        } else {
          for (let k = 0; k < pc.n; k++) index[ii++] = v + k;
        }
        v += pc.n;
      }
    }
    const geo = new THREE.BufferGeometry();
    for (const name in out) geo.setAttribute(name, new THREE.BufferAttribute(out[name], first.attrs[name].size).onUpload(releaseArray));
    geo.setIndex(new THREE.BufferAttribute(index, 1).onUpload(releaseArray));
    geo.computeBoundingSphere();
    if (mesh) {
      this._drop(mesh.geometry);
      mesh.geometry = geo;
    } else {
      mesh = new THREE.Mesh(geo, mat);
      mesh.name = 'furniture-batch';
      mesh.matrixAutoUpdate = false;
      rec.meshes.set(mat, mesh);
      this.group.add(mesh);
    }
  }

  /** Numbers for probes: squares, batch meshes and pieces drawn through them. */
  info() {
    let meshes = 0, pieces = 0;
    for (const rec of this.regions.values()) {
      meshes += rec.meshes.size;
      pieces += rec.items.size;
    }
    return { regions: this.regions.size, meshes, pieces, failed: this.failed };
  }

  clear() {
    for (const rec of this.regions.values()) {
      for (const mesh of rec.meshes.values()) {
        this.group.remove(mesh);
        this._drop(mesh.geometry);
      }
    }
    this.regions.clear();
    this.dirty.clear();
  }
}

export class EntityManager {
  constructor(game) {
    this.game = game;
    this.defs = new Map();
    game.registry.furniture = this.defs;
    this.map = new Map(); // uid -> entity
    this.occupied = new Map(); // voxel index -> entity
    this.flats = new Map(); // voxel index -> flat entity (rugs, mats) that others may stand on
    this.nextUid = 1;
    // multiplayer (docs/MULTIPLAYER.md §5.2, §9.4): seat s allocates uids in
    // [s * 1e6 + 1, (s + 1) * 1e6); nextUid only follows uids of its own range. 0 = solo / host.
    this.uidBase = 0;
    // multiplayer hook (src/net/adapter.js), called after every change:
    //   ('add', e) | ('del', record) | ('rot', e, rotBefore) | ('data', e, patch, dataBefore)
    this.onChange = null;
    this.group = new THREE.Group();
    this.group.name = 'entities';
    this.actions = new Map();
    this.updaters = new Set();
    this.lights = [];
    for (let i = 0; i < LIGHT_POOL; i++) {
      // decay 1 with a generous range so Lambert furniture near a lamp warms up like the
      // block-lit walls do (physical units: intensity is set per frame from the daylight)
      const l = new THREE.PointLight(0xffc98a, 0, 10, 1);
      l.visible = true;
      this.lights.push(l);
      game.scene.add(l);
    }
    this._lightTimer = 0;
    this._lit = new Array(LIGHT_POOL).fill(null); // entity lit by each pool light
    this._tmp = new THREE.Vector3();
    this.batcher = new StaticBatcher(this);
    // batches catch up right before every render of the scene (frame, thumbnail, photo), so a
    // piece placed or removed from anywhere never shows twice or goes missing for a frame
    const batcher = this.batcher;
    const scene = game.scene;
    const before = scene.onBeforeRender;
    scene.onBeforeRender = function (renderer, sc, camera, target) {
      before.call(this, renderer, sc, camera, target);
      batcher.flush();
    };
    const canvas = game.renderer && game.renderer.domElement;
    if (canvas) canvas.addEventListener('webglcontextrestored', () => batcher.rebuildAll());
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
      icon: (color) => {
        const c = color || (def.colors ? def.colors[0] : null);
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

  /** The next free uid of this page's range. */
  allocUid() {
    if (this.nextUid <= this.uidBase) this.nextUid = this.uidBase + 1;
    while (this.map.has(this.nextUid)) this.nextUid++;
    return this.nextUid++;
  }

  /** Does uid belong to this page's range (so it may move nextUid)? */
  _ownUid(uid) {
    return Math.floor(uid / 1e6) === Math.floor(this.uidBase / 1e6);
  }

  /**
   * Can def go at this anchor/rotation? (inside the world, not in blocks, entities or you)
   * opts.players === false skips the player-overlap test (multiplayer: the host placing a
   * friend's furniture where the host happens to stand).
   */
  canPlace(def, x, y, z, rot, ignore = null, opts = {}) {
    const players = opts.players !== false;
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
      // flat pieces (rugs) only clash with other flat pieces; everything else ignores them
      const other = (def.flat ? this.flats : this.occupied).get(w.index(cx, cy, cz));
      if (other && other !== ignore) return false;
      const standing = def.placeOn !== 'wall' && def.placeOn !== 'ceiling';
      if (players && def.colliders !== 'none' && standing && game.player && game.player.overlapsCell(cx, cy, cz)) return false;
    }
    if (def.placeOn === 'ceiling' && !this._solidAt(x, y + this._dims(def).h, z)) return false;
    return true;
  }

  _solidAt(x, y, z) {
    const w = this.game.world;
    const id = w.get(x, y, z);
    const props = this.game.registry.blocks.props;
    return id !== 0 && props.solid[id] === 1 && !props.replaceable[id];
  }

  /** Furniture with a top surface (def.surface) directly under cell (x,y,z), or null. */
  surfaceBelow(x, y, z) {
    const below = this.at(x, y - 1, z);
    return below && typeof below.def.surface === 'number' ? below : null;
  }

  /** Entities with placeOn 'table' standing on top of this one. */
  itemsOnTop(entity) {
    if (typeof entity.def.surface !== 'number') return [];
    const out = new Set();
    for (const [cx, cy, cz] of entity.cells) {
      const e = this.at(cx, cy + 1, cz);
      if (e && e !== entity && e.def.placeOn === 'table' && e.restsOn === entity.uid) out.add(e);
    }
    return [...out];
  }

  // ---------- placing & removing ----------

  /**
   * Place furniture. opts: { history = true, events = true, uid, fx = true, force = false,
   * players, yOffset, restsOn }. force skips the fit check (used when loading a saved world);
   * players: false ignores the player in the fit check; yOffset / restsOn override the
   * computed ones (multiplayer: a record from the host). Returns the entity or null.
   */
  place(key, x, y, z, rot = 0, color = null, data = {}, opts = {}) {
    const { history = true, events = true, fx = true, uid = null, force = false } = opts;
    const game = this.game;
    const def = this.defs.get(key);
    if (!def || !game.world) return null;
    rot = ((rot | 0) % 4 + 4) % 4;
    if (!force && !this.canPlace(def, x, y, z, rot, null, { players: opts.players })) return null;
    const w = game.world;
    const props = game.registry.blocks.props;
    // clear replaceable blocks (tall grass) out of the way
    for (const [cx, cy, cz] of this.footprint(def, x, y, z, rot)) {
      const id = w.get(cx, cy, cz);
      if (id !== 0 && props.replaceable[id] && props.shape[id] !== SHAPES.liquid) w.set(cx, cy, cz, 0, { record: false });
    }
    // table-top items sit on the surface of the furniture below them
    const table = def.placeOn === 'table' ? this.surfaceBelow(x, y, z) : null;
    let yOffset = props.shape[w.get(x, y, z)] === SHAPES.carpet ? 1 / 16 : 0;
    if (table) yOffset = table.y + (table.yOffset || 0) + table.def.surface - y;
    if (typeof opts.yOffset === 'number') yOffset = opts.yOffset;
    let restsOn = table ? table.uid : null;
    if (opts.restsOn !== undefined) restsOn = opts.restsOn || null;
    const entity = {
      uid: uid || this.allocUid(),
      key, x, y, z, rot,
      color: color || (def.colors ? def.colors[0] : null),
      data: { ...def.defaultData, ...data },
      def,
      object3d: null,
      cells: [],
      colliders: [],
      pickable: null,
      lightCell: null,
      lightPoint: null,
      yOffset,
      restsOn,
    };
    if (entity.uid >= this.nextUid && this._ownUid(entity.uid)) this.nextUid = entity.uid + 1;
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
    if (this.onChange !== null) this.onChange('add', entity);
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
    const cellMap = def.flat ? this.flats : this.occupied;
    for (const [cx, cy, cz] of entity.cells) cellMap.set(game.world.index(cx, cy, cz), entity);

    const spec = typeof def.colliders === 'function' ? def.colliders(entity.data || {}, entity) : def.colliders;
    const boxes = spec === 'full' ? [[0, 0, 0, w, h, d]] : spec === 'none' ? [] : spec || [];
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
      entity.lightPoint = [p.x, p.y, p.z];
      game.world.addLightSource(entity.lightCell[0], entity.lightCell[1], entity.lightCell[2], def.light);
    }
    if (def.update) this.updaters.add(entity);
    this.batcher.add(entity);
  }

  _detach(entity) {
    const game = this.game;
    this.batcher.remove(entity);
    if (entity.object3d) {
      this.group.remove(entity.object3d);
      disposeObject(entity.object3d);
      entity.object3d = null;
    }
    const cellMap = entity.def.flat ? this.flats : this.occupied;
    for (const [cx, cy, cz] of entity.cells) {
      const k = game.world.index(cx, cy, cz);
      if (cellMap.get(k) === entity) cellMap.delete(k);
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
      entity.lightPoint = null;
    }
    this.updaters.delete(entity);
  }

  /**
   * Remove an entity. opts: { history = true, events = true, fx = true, riders }: riders:
   * false leaves the items standing on it (multiplayer apply: the host sends their own removals).
   */
  remove(entity, opts = {}) {
    const { history = true, events = true, fx = true } = opts;
    if (!entity || !this.map.has(entity.uid)) return false;
    const game = this.game;
    const riders = opts.riders === false ? [] : this.itemsOnTop(entity);
    if (riders.length) {
      // a lamp on a table goes with the table; one Undo brings both back
      game.beginHistoryGroup();
      try {
        for (const r of riders) this.remove(r, { history, events, fx: false });
        return this.remove(entity, opts);
      } finally {
        game.endHistoryGroup();
      }
    }
    const player = game.player;
    if (player && player.seatEntity === entity) player.stand();
    const center = this.localToWorld(entity, this._dims(entity.def).w / 2, 0.5, this._dims(entity.def).d / 2);
    const record = this.onChange !== null ? this._record(entity) : null;
    this._detach(entity);
    this.map.delete(entity.uid);
    if (history) {
      const s = { key: entity.key, x: entity.x, y: entity.y, z: entity.z, rot: entity.rot, color: entity.color, data: { ...entity.data }, uid: entity.uid };
      game.pushHistory({
        undo: () => this._placeBack(s),
        redo: () => { const e = this.byUid(s.uid); if (e) this.remove(e, { history: false, fx: false }); },
      });
    }
    if (fx) {
      game.audio.play('remove');
      game.celebrate(center, 'sparkle', { quiet: true });
    }
    if (this.onChange !== null) this.onChange('del', record);
    if (events) game.events.emit('entity:remove', { entity });
    return true;
  }

  /**
   * Undo of a removal: put the piece back. Solo: forced, exactly as it was (LIFO undo means
   * nothing else can be there). While playing with friends someone may have built there
   * since, so it comes back only if it fits (players ignored), else the Undo skips it; and a
   * friend (guest) gives a piece that is not from her own uid range a fresh uid of her own
   * (the host only accepts her uids), which later redo / undo entries then follow.
   */
  _placeBack(s) {
    const net = this.game.net;
    if (!net || !net.active) return this.place(s.key, s.x, s.y, s.z, s.rot, s.color, s.data, { history: false, fx: false, uid: s.uid, force: true });
    if (this.byUid(s.uid)) return null;
    const def = this.defs.get(s.key);
    if (!def || !this.canPlace(def, s.x, s.y, s.z, s.rot, null, { players: false })) return null;
    const uid = net.isGuest && !this._ownUid(s.uid) ? null : s.uid;
    const e = this.place(s.key, s.x, s.y, s.z, s.rot, s.color, s.data, { history: false, fx: false, uid, players: false });
    if (e) s.uid = e.uid;
    return e;
  }

  /** [uid,key,x,y,z,rot,color|0,data|0,yo,ro] (the multiplayer wire record, data copied). */
  _record(e) {
    return [e.uid, e.key, e.x, e.y, e.z, e.rot, e.color || 0, e.data ? JSON.parse(JSON.stringify(e.data)) : 0,
      Math.round((e.yOffset || 0) * 1000), e.restsOn || 0];
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
      if (this.onChange !== null) this.onChange('rot', entity, before);
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
    const before = entity.rot;
    this._detach(entity);
    entity.rot = rot;
    this._attach(entity);
    if (this.onChange !== null && before !== rot) this.onChange('rot', entity, before);
  }

  /** Rebuild the model (after color/data changes). */
  refresh(entity) {
    if (!this.map.has(entity.uid)) return;
    this._detach(entity);
    this._attach(entity);
  }

  /** Merge data into an entity and rebuild it (lamps on/off, doors open/closed...). */
  setData(entity, patch) {
    const before = this.onChange !== null ? JSON.parse(JSON.stringify(entity.data || {})) : null;
    Object.assign(entity.data, patch);
    this.refresh(entity);
    if (this.onChange !== null) this.onChange('data', entity, patch, before);
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
    const top = def.placeOn === 'table' ? this._tableTopCell(hit) : null;
    if (top) [x, y, z] = top;
    if (def.placeOn === 'ceiling') {
      const h = this._dims(def).h;
      let top = -1;
      if (hit.face[1] === -1) top = y; // tapped the underside of a block
      else {
        for (let k = 0; k < CEILING_SEARCH; k++) {
          if (this._solidAt(x, y + k, z)) break;
          if (this._solidAt(x, y + k + 1, z)) { top = y + k; break; }
        }
      }
      if (top < 0) {
        game.toast('Hang it under a ceiling!', { icon: 'home' });
        return null;
      }
      y = top - (h - 1);
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

  /**
   * A 'table' item tapped onto the top of furniture with a surface goes in the cell right
   * above that piece, under the tapped spot. (The generic pick cell, floor(point.y + 0.5),
   * is the piece's own cell for low tops like the coffee table, and its upper cell for tall
   * pieces with a top inside them: the piano and the fireplace mantel.)
   */
  _tableTopCell(hit) {
    if (!hit || hit.type !== 'pickable' || !hit.face || hit.face[1] !== 1) return null;
    const ref = hit.pickable && hit.pickable.kind === 'entity' ? hit.pickable.ref : null;
    if (!ref || typeof ref.def.surface !== 'number' || !this.map.has(ref.uid) || !ref.cells.length) return null;
    const px = Math.floor(hit.point.x), pz = Math.floor(hit.point.z);
    const y = ref.y + this._dims(ref.def).h;
    let best = null, bestD = Infinity;
    for (const [cx, cy, cz] of ref.cells) {
      if (cy !== ref.y) continue;
      const d = Math.abs(cx - px) + Math.abs(cz - pz);
      if (d < bestD) { bestD = d; best = [cx, y, cz]; }
    }
    return best;
  }

  /** The entity in a cell (a rug only when nothing else stands there). */
  at(x, y, z) {
    const w = this.game.world;
    if (!w || !w.inBounds(x, y, z)) return null;
    const i = w.index(x, y, z);
    return this.occupied.get(i) || this.flats.get(i) || null;
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
    const daylight = game.blockUniforms ? game.blockUniforms.uDaylight.value : 1;
    const strength = 6.5 * (1.15 - Math.min(1, daylight)); // ~4.9 at night, ~1 by day
    this._lightTimer -= dt;
    if (this._lightTimer <= 0) {
      this._lightTimer = 0.25;
      // give the few real point lights to the lit entities nearest the camera
      const cam = game.camera.position;
      const lit = [];
      for (const e of this.map.values()) if (e.lightCell) lit.push(e);
      lit.sort((a, b) => cam.distanceToSquared(a.object3d.position) - cam.distanceToSquared(b.object3d.position));
      for (let i = 0; i < this.lights.length; i++) {
        const e = lit[i] || null;
        this._lit[i] = e;
        if (e) {
          const [lx, ly, lz] = e.lightPoint;
          this.lights[i].position.set(lx, ly + 0.1, lz);
        }
      }
    }
    // every frame, so flickering lights (entity.lightScale: fireplaces, candles) look alive
    for (let i = 0; i < this.lights.length; i++) {
      const e = this._lit[i];
      this.lights[i].intensity = e && e.lightCell ? strength * (e.lightScale ?? 1) : 0;
    }
  }

  // ---------- world lifecycle ----------

  clear() {
    for (const e of this.map.values()) this._detach(e);
    this.map.clear();
    this.occupied.clear();
    this.flats.clear();
    this.updaters.clear();
    this.batcher.clear();
    this._lit.fill(null);
    this.nextUid = 1;
    this.uidBase = 0;
    for (const l of this.lights) l.intensity = 0;
  }

  serialize() {
    return this.all().map((e) => ({ uid: e.uid, key: e.key, x: e.x, y: e.y, z: e.z, rot: e.rot, color: e.color, data: e.data }));
  }

  deserialize(list) {
    if (!Array.isArray(list)) return;
    // tables before the lamps and cakes that stand on them
    const order = list.slice().sort((a, b) => {
      const ta = this.defs.get(a.key)?.placeOn === 'table' ? 1 : 0;
      const tb = this.defs.get(b.key)?.placeOn === 'table' ? 1 : 0;
      return ta - tb;
    });
    for (const s of order) {
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
