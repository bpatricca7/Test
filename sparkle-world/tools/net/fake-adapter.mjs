// FakeAdapter: an in-memory GameAdapter (docs/MULTIPLAYER.md §9.0, §15.1) over a Uint8Array
// of cells, an entity Map with the same place / remove / rotate / data rules as the game
// (footprint occupancy, table-top items, riders), a plant Map and actors. Every mutation calls
// the hooks exactly like the real game's World.set / entities.onChange / garden.onChange, so
// host.js and guest.js see what they would see in the browser.
//
// The `user*` methods are what a player does (they record through the hooks and keep a local,
// compare-and-set Undo stack); `sim()` is the host's systems (growth, drying, pets, time).

import { hashEntityRecords, hashPlantRecords, rleEncode, rleDecode, packLook } from '../../src/net/codec.js';

export const BLOCKS = [
  { key: 'air', solid: false, free: false },
  { key: 'grass', solid: true, free: true },
  { key: 'dirt', solid: true, free: true },
  { key: 'stone', solid: true, free: true },
  { key: 'planks', solid: true, free: false },
  { key: 'glass', solid: true, free: false },
  { key: 'flower', solid: false, free: true },
  { key: 'farmland', solid: true, free: false },
  { key: 'farmland_wet', solid: true, free: false },
  { key: 'water', solid: false, free: true },
  { key: 'wool', solid: true, free: false },
  { key: 'brick', solid: true, free: false },
];
export const B = Object.fromEntries(BLOCKS.map((b, i) => [b.key, i]));
const SOLID = BLOCKS.map((b) => b.solid);
const FREE = BLOCKS.map((b) => b.free);

export const FURNITURE = {
  table: { size: [2, 1, 1], surface: true },
  chair: { size: [1, 1, 1] },
  bed: { size: [1, 1, 2] },
  door: { size: [1, 2, 1], data: { open: false } },
  lamp: { size: [1, 1, 1], data: { on: false } },
  cup: { size: [1, 1, 1], placeOn: 'table' },
  cupcake: { size: [1, 1, 1], placeOn: 'table', edible: true },
  fence: { size: [1, 1, 1], data: { conn: 0 } },
  easel: { size: [1, 2, 1], data: { art: '' } },
  // a drivable vehicle (host custody tests, docs/teams/vehicles.md §10.2)
  kart_test: { size: [1, 1, 2], vehicle: true },
};
export const CROPS = ['carrot', 'tomato', 'strawberry'];
export const PREFABS = { hut: { name: 'Tiny Hut', w: 3, h: 3, d: 3 } };

const clone = (v) => (v && typeof v === 'object' ? JSON.parse(JSON.stringify(v)) : v);

export class FakeAdapter {
  /**
   * @param {object} o
   * @param {number[]} [o.size=[32,12,32]]
   * @param {string} [o.name='Lily']
   * @param {boolean} [o.empty=false]  a guest starts with no world
   * @param {() => number} [o.rand]
   */
  constructor(o = {}) {
    const [sx, sy, sz] = o.size || [32, 12, 32];
    this.name = o.name || 'Lily';
    this.rand = o.rand || Math.random;
    this.look = packLook({ name: this.name });
    this._alloc(o.empty ? [0, 0, 0] : [sx, sy, sz]);
    if (!o.empty) this._terrain();
    this.hooks = null;
    this.role = null;
    this._inSystems = false;
    this.pos = [sx / 2, 5, sz / 2, 0];
    this.st = 'w';
    this.time_ = [0.4, 1, 0];
    this.weather_ = 'sunny';
    this.toasts = [];
    this.undoStack = [];
    this.resolved = [];
    this.session = null; // set by tests: the NetSession, for guest intents
    this.appliedPayloads = 0;
  }

  _alloc([sx, sy, sz]) {
    this.sx = sx;
    this.sy = sy;
    this.sz = sz;
    this.cells = new Uint8Array(sx * sy * sz);
    this.ents = new Map();
    this.occ = new Map();
    this.plants = new Map();
    this.actors = new Map();
    this.uidBase ??= 0; // kept across enterSnapshot (the real adapter must re-apply it too)
    this.nextUid ??= 1;
  }

  _terrain() {
    const { sx, sz } = this;
    for (let z = 0; z < sz; z++) {
      for (let x = 0; x < sx; x++) {
        this.cells[this.idx(x, 0, z)] = B.stone;
        for (let y = 1; y <= 3; y++) this.cells[this.idx(x, y, z)] = B.dirt;
        this.cells[this.idx(x, 4, z)] = B.grass;
        if ((x * 7 + z * 13) % 11 === 0) this.cells[this.idx(x, 5, z)] = B.flower;
      }
    }
    this.actors.set('pet:rex', { name: 'Rex', species: 'puppy', mood: 0, h: 1 });
    this.actors.set('pet:mimi', { name: 'Mimi', species: 'kitty', mood: 0, h: 2 });
  }

  idx(x, y, z) {
    return (y * this.sz + z) * this.sx + x;
  }

  inBounds(x, y, z) {
    return x >= 0 && y >= 0 && z >= 0 && x < this.sx && y < this.sy && z < this.sz;
  }

  // ---------- GameAdapter: lifecycle ----------

  attach(role, hooks, info = {}) {
    this.role = role;
    this.hooks = hooks;
    this.uidBase = role === 'guest' ? (info.seat || 0) * 1e6 : 0;
    this._resetAlloc();
  }

  detach() {
    this.hooks = null;
    this.role = null;
    this.uidBase = 0;
    this._resetAlloc();
  }

  /**
   * Next uid: max(existing in my range) + 1, and never lower than before while the seat stays
   * the same (uids of my edits still in flight must not be handed out twice).
   */
  _resetAlloc() {
    const lo = this.uidBase + 1, hi = this.uidBase + 1e6 - 1;
    const keep = this.allocBase === this.uidBase ? this.nextUid : lo;
    this.allocBase = this.uidBase;
    this.nextUid = Math.max(lo, keep, this.maxUidInRange(lo, hi) + 1);
  }

  inSystems() {
    return this._inSystems;
  }

  // ---------- reading ----------

  size() {
    return { sx: this.sx, sy: this.sy, sz: this.sz };
  }

  getCell(i) {
    return this.cells[i];
  }

  coords(i) {
    const x = i % this.sx;
    const t = Math.floor(i / this.sx);
    return [x, Math.floor(t / this.sz), t % this.sz];
  }

  entityRecord(uid) {
    const e = this.ents.get(uid);
    return e ? [e.uid, e.key, e.x, e.y, e.z, e.rot, e.color || 0, e.data ? clone(e.data) : 0, e.yo, e.ro] : null;
  }

  plantRecord(i) {
    const p = this.plants.get(i);
    if (!p) return null;
    return [i, p.crop, p.stage, this.cells[i - this.sx * this.sz] === B.farmland_wet ? 1 : 0];
  }

  actorRecord(kind, id) {
    const r = this.actors.get(kind + ':' + id);
    return r ? [kind, id, clone(r)] : null;
  }

  actorSamples() {
    const pt = [];
    for (const [key, r] of this.actors) {
      if (key.startsWith('pet:')) pt.push([r.h || 0, 200 + (r.mood | 0), 100, 200, 0, 's']);
    }
    return { pt, nx: [] };
  }

  isFree(id) {
    return !!FREE[id];
  }

  isSolid(id) {
    return !!SOLID[id];
  }

  isWatering(before, after) {
    return before === B.farmland && after === B.farmland_wet;
  }

  isEdible(uid) {
    const e = this.ents.get(uid);
    return !!e && !!FURNITURE[e.key]?.edible;
  }

  occupied(i) {
    return this.occ.has(i);
  }

  entityHash() {
    const recs = [];
    for (const uid of this.ents.keys()) recs.push(this.entityRecord(uid));
    return hashEntityRecords(recs);
  }

  plantHash() {
    const recs = [];
    for (const [i, p] of this.plants) recs.push([i, p.crop, p.stage]);
    return hashPlantRecords(recs);
  }

  maxUidInRange(lo, hi) {
    let m = 0;
    for (const uid of this.ents.keys()) if (uid >= lo && uid <= hi && uid > m) m = uid;
    return m;
  }

  // ---------- snapshot ----------

  makeSnapshot() {
    const entities = [];
    for (const uid of this.ents.keys()) entities.push(this.entityRecord(uid));
    const plants = [];
    for (const [i, p] of this.plants) plants.push([i, p.crop, p.stage]);
    const actors = [];
    for (const [key, r] of this.actors) actors.push([key, clone(r)]);
    return {
      json: { v: 1, size: { x: this.sx, y: this.sy, z: this.sz }, entities, plants, actors, time: this.time_.slice(), weather: this.weather_ },
      rle: rleEncode(this.cells),
    };
  }

  async enterSnapshot(json, rle) {
    const s = json.size;
    if (!s) return false;
    this._alloc([s.x, s.y, s.z]);
    if (rleDecode(rle, this.cells) !== this.cells.length) return false;
    // tables first, then what stands on them
    const recs = json.entities.slice().sort((a, b) => (a[9] ? 1 : 0) - (b[9] ? 1 : 0));
    for (const r of recs) this._put(r);
    for (const [i, crop, stage] of json.plants) this.plants.set(i, { crop, stage });
    for (const [key, r] of json.actors) this.actors.set(key, r);
    this.time_ = json.time.slice();
    this.weather_ = json.weather;
    this._resetAlloc();
    this.undoStack = [];
    return true;
  }

  // ---------- guest: silent apply ----------

  applyPayload(p) {
    this.appliedPayloads++;
    let ents = 0;
    if (p.X) for (const uid of p.X) if (this._remove(uid, false)) ents++;
    const cells = p.cells || [];
    for (let k = 0; k < cells.length; k += 2) this._set(cells[k], cells[k + 1]);
    if (p.E) {
      const recs = p.E.slice().sort((a, b) => (a[9] ? 1 : 0) - (b[9] ? 1 : 0));
      for (const r of recs) {
        const cur = this.ents.get(r[0]);
        if (cur && cur.key === r[1] && cur.x === r[2] && cur.y === r[3] && cur.z === r[4] && cur.rot === r[5]) {
          cur.color = r[6] || 0;
          cur.data = r[7] ? clone(r[7]) : 0;
          cur.yo = r[8];
          cur.ro = r[9];
        } else {
          if (cur) this._remove(r[0], false);
          this._put(r);
          if (this.hooks) this.hooks.ent('add', r[0], null, this.entityRecord(r[0]));
        }
        ents++;
      }
    }
    if (p.P) {
      for (const [i, crop, stage] of p.P) {
        const before = this.plants.get(i);
        if (!crop) {
          if (before) {
            this.plants.delete(i);
            this.hooks?.plant('del', i, [before.crop, before.stage], null);
          }
        } else if (!before || before.crop !== crop || before.stage !== stage) {
          this.plants.set(i, { crop, stage });
          this.hooks?.plant(before ? 'stage' : 'add', i, before ? [before.crop, before.stage] : null, [crop, stage]);
        }
      }
    }
    if (p.K) {
      for (const [kind, id, rec] of p.K) {
        if (rec) this.actors.set(kind + ':' + id, clone(rec));
        else this.actors.delete(kind + ':' + id);
      }
    }
    return { cells: cells.length / 2, ents };
  }

  // ---------- host: execute validated guest ops ----------

  setCells(pairs) {
    for (let k = 0; k < pairs.length; k += 2) this._set(pairs[k], pairs[k + 1]);
  }

  canPlaceEntity(key, x, y, z, rot, ignoreUid) {
    return this._canPlace(key, x, y, z, rot, ignoreUid);
  }

  placeEntity(rec) {
    const [uid, key, x, y, z, rot, color, data] = rec;
    return !!this._place(key, x, y, z, rot, color, data, uid);
  }

  removeEntity(uid) {
    return this._remove(uid, true);
  }

  rotateEntity(uid, rot) {
    return this._rotate(uid, rot);
  }

  patchEntity(uid, patch) {
    return this._patch(uid, patch);
  }

  ridersOf(uid) {
    const out = [];
    for (const e of this.ents.values()) if (e.ro === uid) out.push(e.uid);
    return out;
  }

  plantAt(i) {
    const p = this.plants.get(i);
    return p ? [p.crop, p.stage] : null;
  }

  soilOk(i) {
    const below = i - this.sx * this.sz;
    return below >= 0 && (this.cells[below] === B.farmland || this.cells[below] === B.farmland_wet) && this.cells[i] === B.air && !this.occ.has(i);
  }

  addPlant(crop, x, y, z) {
    if (!CROPS.includes(crop) || !this.inBounds(x, y, z)) return false;
    const i = this.idx(x, y, z);
    if (this.plants.has(i) || !this.soilOk(i)) return false;
    this.plants.set(i, { crop, stage: 0 });
    this.hooks?.plant('add', i, null, [crop, 0]);
    return true;
  }

  removePlant(i) {
    const p = this.plants.get(i);
    if (!p) return false;
    this.plants.delete(i);
    this.hooks?.plant('del', i, [p.crop, p.stage], null);
    return true;
  }

  harvestPlant(i) {
    const p = this.plants.get(i);
    if (!p || p.stage !== 3) return false;
    const before = [p.crop, 3];
    if (p.crop === 'strawberry') {
      p.stage = 2;
      this.hooks?.plant('harvest', i, before, [p.crop, 2]);
    } else {
      this.plants.delete(i);
      this.hooks?.plant('harvest', i, before, null);
    }
    return true;
  }

  adoptWet() {}

  prefab(key, pl, policy) {
    const def = PREFABS[key];
    if (!def) return { ok: false, code: 5 };
    const plan = this._prefabPlan(def, pl.x, pl.y, pl.z);
    if (!plan) return { ok: false, code: 5 };
    const diff = { cells: [], ents: [] };
    for (let k = 0; k < plan.cells.length; k += 2) {
      const i = plan.cells[k];
      const cur = this.cells[i];
      if (cur !== plan.cells[k + 1]) diff.cells.push(i, cur, plan.cells[k + 1]);
      const u = this.occ.get(i);
      if (u !== undefined && !diff.ents.includes(u)) diff.ents.push(u);
    }
    const lampCell = this.idx(plan.lamp[0], plan.lamp[1], plan.lamp[2]);
    const lu = this.occ.get(lampCell);
    if (lu !== undefined && !diff.ents.includes(lu)) diff.ents.push(lu);
    for (const uid of diff.ents.slice()) for (const r of this.ridersOf(uid)) if (!diff.ents.includes(r)) diff.ents.push(r);
    if (!policy(diff)) return { ok: false, code: 2 };
    for (const uid of diff.ents) this._remove(uid, true);
    for (let k = 0; k < diff.cells.length; k += 3) this._set(diff.cells[k], diff.cells[k + 2]);
    this._place('lamp', plan.lamp[0], plan.lamp[1], plan.lamp[2], 0, 0, { on: true });
    return { ok: true, name: def.name };
  }

  _prefabPlan(def, ox, oy, oz) {
    const { w, h, d } = def;
    if (ox < 1 || oz < 1 || ox + w >= this.sx || oz + d >= this.sz || oy < 1 || oy + h >= this.sy) return null;
    const cells = [];
    for (let y = oy; y < oy + h; y++) {
      for (let z = oz; z < oz + d; z++) {
        for (let x = ox; x < ox + w; x++) {
          const edge = x === ox || x === ox + w - 1 || z === oz || z === oz + d - 1;
          let id = B.air;
          if (y === oy + h - 1) id = B.planks;
          else if (edge) id = x === ox + 1 && z === oz && y === oy ? B.air : B.brick;
          cells.push(this.idx(x, y, z), id);
        }
      }
    }
    return { cells, lamp: [ox + 1, oy, oz + 1] };
  }

  skipToMorning() {
    this.time_ = [0.25, this.time_[1] + 1, this.time_[2]];
  }

  // ---------- environment ----------

  local() {
    const out = { p: this.pos.slice(), st: this.st, nm: this.name, lk: this.look };
    // the vehicle she drives (presence vh), only when a test set one
    if (this.vh !== undefined) out.vh = this.vh;
    // the toy or treat in her hand (presence hi), only when a test set one
    if (this.hi !== undefined) out.hi = this.hi;
    return out;
  }

  // ---------- vehicles (optional extensions) ----------

  isVehicle(key) {
    return !!FURNITURE[key]?.vehicle;
  }

  vehicleNoun() {
    return 'go-kart';
  }

  /** Put a vehicle record back: its spot, else the nearest free one (rings 0..3), else forced. */
  parkVehicle(rec) {
    const [uid, key, x, y, z, rot, color, data] = rec;
    if (!FURNITURE[key]) return 0;
    const u = this.ents.has(uid) ? this._allocUid() : uid;
    for (let r = 0; r <= 3; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          for (const ro of [rot, (rot + 1) & 3, (rot + 2) & 3, (rot + 3) & 3]) {
            if (this._canPlace(key, x + dx, y, z + dz, ro)) {
              const e = this._place(key, x + dx, y, z + dz, ro, color, data || 0, u);
              if (e) return e.uid;
            }
          }
        }
      }
    }
    this._put([u, key, x, y, z, rot, color || 0, data || 0, 0, 0]);
    this.hooks?.ent('add', u, null, this.entityRecord(u));
    return u;
  }

  time() {
    return this.time_.slice();
  }

  applyTime(tm) {
    this.time_ = [tm[0], tm[1], tm[2] ? 1 : 0];
  }

  weather() {
    return this.weather_;
  }

  applyWeather(kind) {
    this.weather_ = kind;
  }

  toast(text, icon) {
    this.toasts.push([text, icon]);
    if (this.toasts.length > 50) this.toasts.shift();
  }

  celebrate() {}
  unstick() {}

  resolveIntent(kind, lseq, ok) {
    this.resolved.push([kind, lseq, ok]);
  }

  // ---------- primitive mutations (every one calls the hooks) ----------

  _set(i, id) {
    const prev = this.cells[i];
    if (prev === id) return;
    this.cells[i] = id;
    if (this.hooks) this.hooks.cell(i, prev, id);
  }

  _footprint(key, x, y, z, rot) {
    const def = FURNITURE[key];
    if (!def) return null;
    let [w, h, d] = def.size;
    if (rot & 1) [w, d] = [d, w];
    const out = [];
    for (let dy = 0; dy < h; dy++) {
      for (let dz = 0; dz < d; dz++) {
        for (let dx = 0; dx < w; dx++) {
          if (!this.inBounds(x + dx, y + dy, z + dz)) return null;
          out.push(this.idx(x + dx, y + dy, z + dz));
        }
      }
    }
    return out;
  }

  _canPlace(key, x, y, z, rot, ignoreUid = null) {
    const cells = this._footprint(key, x, y, z, rot);
    if (!cells) return false;
    for (const i of cells) {
      const id = this.cells[i];
      if (id !== B.air && id !== B.flower) return false;
      const u = this.occ.get(i);
      if (u !== undefined && u !== ignoreUid) return false;
      if (this.plants.has(i)) return false;
    }
    return true;
  }

  _tableBelow(x, y, z) {
    if (y < 1) return 0;
    const u = this.occ.get(this.idx(x, y - 1, z));
    return u !== undefined && this.ents.get(u)?.key === 'table' ? u : 0;
  }

  /** Put a record without checks or hooks (snapshot / forced apply). */
  _put(r) {
    const [uid, key, x, y, z, rot, color, data, yo, ro] = r;
    const e = { uid, key, x, y, z, rot, color: color || 0, data: data ? clone(data) : 0, yo: yo | 0, ro: ro | 0 };
    this.ents.set(uid, e);
    for (const i of this._footprint(key, x, y, z, rot) || []) this.occ.set(i, uid);
    return e;
  }

  _allocUid() {
    while (this.ents.has(this.nextUid)) this.nextUid++;
    return this.nextUid++;
  }

  _place(key, x, y, z, rot, color, data, uid = null) {
    if (!this._canPlace(key, x, y, z, rot)) return null;
    const u = uid ?? this._allocUid();
    if (this.ents.has(u)) return null;
    if (uid !== null && Math.floor(uid / 1e6) === Math.floor(this.uidBase / 1e6) && uid >= this.nextUid) this.nextUid = uid + 1;
    // placing clears flowers in the footprint (like grass cleared by furniture)
    for (const i of this._footprint(key, x, y, z, rot)) if (this.cells[i] === B.flower) this._set(i, B.air);
    const ro = FURNITURE[key].placeOn === 'table' ? this._tableBelow(x, y, z) : 0;
    const d = data ?? (FURNITURE[key].data ? clone(FURNITURE[key].data) : 0);
    const e = this._put([u, key, x, y, z, rot, color || 0, d, ro ? -200 : 0, ro]);
    this.hooks?.ent('add', u, null, this.entityRecord(u));
    return e;
  }

  _remove(uid, riders) {
    const e = this.ents.get(uid);
    if (!e) return false;
    if (riders) for (const r of this.ridersOf(uid)) this._remove(r, true);
    const rec = this.entityRecord(uid);
    this.ents.delete(uid);
    for (const i of this._footprint(e.key, e.x, e.y, e.z, e.rot) || []) if (this.occ.get(i) === uid) this.occ.delete(i);
    this.hooks?.ent('del', uid, rec, null);
    return true;
  }

  _rotate(uid, rot) {
    const e = this.ents.get(uid);
    if (!e || !this._canPlace(e.key, e.x, e.y, e.z, rot, uid)) return false;
    const before = e.rot;
    for (const i of this._footprint(e.key, e.x, e.y, e.z, e.rot) || []) if (this.occ.get(i) === uid) this.occ.delete(i);
    e.rot = rot;
    for (const i of this._footprint(e.key, e.x, e.y, e.z, e.rot) || []) this.occ.set(i, uid);
    this.hooks?.ent('rot', uid, before, rot);
    return true;
  }

  _patch(uid, patch) {
    const e = this.ents.get(uid);
    if (!e) return false;
    const before = e.data ? clone(e.data) : {};
    const next = { ...(e.data || {}) };
    for (const k in patch) {
      if (patch[k] === null) delete next[k];
      else next[k] = clone(patch[k]);
    }
    e.data = next;
    this.hooks?.ent('data', uid, before, clone(patch));
    return true;
  }

  // ---------- what a player does (tests) ----------

  /** A stroke: set cells (list of [x, y, z, id]); one Undo entry. */
  userCells(list) {
    const changed = [];
    for (const [x, y, z, id] of list) {
      if (!this.inBounds(x, y, z)) continue;
      const i = this.idx(x, y, z);
      if (y === 0 && SOLID[this.cells[i]] && !SOLID[id]) continue;
      if (SOLID[id] && this.occ.has(i)) continue;
      const before = this.cells[i];
      if (before === id) continue;
      this._set(i, id);
      changed.push([i, before, id]);
    }
    if (changed.length) this.undoStack.push({ t: 'cells', changed });
    return changed.length;
  }

  userPlace(key, x, y, z, rot = 0, color = 0) {
    const e = this._place(key, x, y, z, rot, color, null);
    if (e) this.undoStack.push({ t: 'place', uid: e.uid, key });
    return e ? e.uid : 0;
  }

  userRemove(uid) {
    const e = this.ents.get(uid);
    if (!e) return false;
    const recs = [];
    const collect = (u) => {
      for (const r of this.ridersOf(u)) collect(r);
      recs.push(this.entityRecord(u));
    };
    collect(uid);
    this._remove(uid, true);
    this.undoStack.push({ t: 'remove', recs });
    return true;
  }

  userRotate(uid) {
    const e = this.ents.get(uid);
    if (!e) return false;
    const before = e.rot;
    const rot = (e.rot + 1) & 3;
    if (!this._rotate(uid, rot)) return false;
    this.undoStack.push({ t: 'rot', uid, before, after: rot });
    return true;
  }

  userData(uid, patch) {
    const e = this.ents.get(uid);
    if (!e) return false;
    const before = {};
    for (const k in patch) before[k] = e.data && k in e.data ? clone(e.data[k]) : null;
    this._patch(uid, patch);
    this.undoStack.push({ t: 'data', uid, before, after: clone(patch) });
    return true;
  }

  userTill(x, y, z) {
    if (!this.inBounds(x, y, z)) return false;
    const i = this.idx(x, y, z);
    const id = this.cells[i];
    if (id !== B.grass && id !== B.dirt) return false;
    const above = i + this.sx * this.sz;
    if (above < this.cells.length && this.cells[above] === B.flower) this._set(above, B.air);
    this._set(i, B.farmland);
    this.undoStack.push({ t: 'cells', changed: [[i, id, B.farmland]] });
    return true;
  }

  userWater(x, y, z) {
    if (!this.inBounds(x, y, z)) return false;
    const i = this.idx(x, y, z);
    if (this.cells[i] !== B.farmland) return false;
    this._set(i, B.farmland_wet);
    return true;
  }

  userPlant(x, y, z, crop) {
    if (!this.addPlant(crop, x, y, z)) return false;
    this.undoStack.push({ t: 'plant', i: this.idx(x, y, z), crop });
    return true;
  }

  userHarvest(i) {
    return this.harvestPlant(i);
  }

  /** Guest Magic House: an intent (the pop-in is only visual). Host: applied directly. */
  userPrefab(key, x, y, z) {
    if (this.role === 'guest') {
      const lseq = this.session?.intent('pf', [key, x, y, z, 0]) || 0;
      if (lseq) this.undoStack.push({ t: 'pf', lseq });
      return lseq > 0;
    }
    const r = this.prefab(key, { x, y, z, rot: 0 }, () => true);
    return r.ok;
  }

  userSleep() {
    if (this.role === 'guest') {
      this.session?.intent('z', []);
      this.skipToMorning();
      return true;
    }
    this.skipToMorning();
    return true;
  }

  /** The player's own Undo: compare-and-set, like the game's closures while a session runs. */
  userUndo() {
    const u = this.undoStack.pop();
    if (!u) return false;
    switch (u.t) {
      case 'cells':
        for (let k = u.changed.length - 1; k >= 0; k--) {
          const [i, before, after] = u.changed[k];
          if (this.cells[i] === after && !(SOLID[before] && this.occ.has(i))) this._set(i, before);
        }
        break;
      case 'place': {
        const e = this.ents.get(u.uid);
        if (e && e.key === u.key) this._remove(u.uid, true);
        break;
      }
      case 'remove':
        for (let k = u.recs.length - 1; k >= 0; k--) {
          const r = u.recs[k];
          if (!this.ents.has(r[0]) && this._canPlace(r[1], r[2], r[3], r[4], r[5])) {
            this._place(r[1], r[2], r[3], r[4], r[5], r[6], r[7], r[0]);
          }
        }
        break;
      case 'rot': {
        const e = this.ents.get(u.uid);
        if (e && e.rot === u.after) this._rotate(u.uid, u.before);
        break;
      }
      case 'data':
        if (this.ents.has(u.uid)) this._patch(u.uid, u.before);
        break;
      case 'plant': {
        const p = this.plants.get(u.i);
        if (p && p.crop === u.crop) this.removePlant(u.i);
        break;
      }
      case 'pf':
        this.session?.intent('pu', [u.lseq]);
        break;
    }
    return true;
  }

  /** Host systems for one step: growth, drying, a pet's mood, the clock. */
  sim(rand = this.rand) {
    this._inSystems = true;
    try {
      for (const [i, p] of this.plants) {
        if (p.stage < 3 && rand() < 0.3) {
          const before = [p.crop, p.stage];
          p.stage++;
          this.hooks?.plant('stage', i, before, [p.crop, p.stage]);
        }
      }
      for (let k = 0; k < 4; k++) {
        const i = Math.floor(rand() * this.cells.length);
        if (this.cells[i] === B.farmland_wet) this._set(i, B.farmland);
      }
      const keys = Array.from(this.actors.keys());
      if (keys.length) {
        const key = keys[Math.floor(rand() * keys.length)];
        const r = this.actors.get(key);
        r.mood = ((r.mood | 0) + 1) % 7;
        const cut = key.indexOf(':');
        this.hooks?.actor(key.slice(0, cut), key.slice(cut + 1));
      }
      if (!this.time_[2]) this.time_[0] = (this.time_[0] + 0.001) % 1;
    } finally {
      this._inSystems = false;
    }
  }

  // ---------- test views ----------

  /** A comparable picture of the whole world. */
  view() {
    const ents = [];
    for (const uid of Array.from(this.ents.keys()).sort((a, b) => a - b)) ents.push(JSON.stringify(this.entityRecord(uid).slice(0, 8)));
    const plants = [];
    for (const i of Array.from(this.plants.keys()).sort((a, b) => a - b)) {
      const p = this.plants.get(i);
      plants.push(`${i}|${p.crop}|${p.stage}`);
    }
    const actors = [];
    for (const key of Array.from(this.actors.keys()).sort()) actors.push(key + JSON.stringify(this.actors.get(key)));
    return { cells: this.cells, ents, plants, actors };
  }
}
