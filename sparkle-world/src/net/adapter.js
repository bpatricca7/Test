// GameAdapter over the real game (docs/MULTIPLAYER.md §9.0, docs/teams/net.md): the only
// bridge between the net core (host.js / guest.js, which reach the game through nothing else)
// and Sparkle World's modules. It
//   - installs the hooks: world.onCell, entities.onChange, garden.onChange, the actor touch
//     (re-installed on the new World after a snapshot);
//   - reads current values as wire records (cells, entities, plants, actors) and hashes;
//   - makes and enters snapshots (serializeWorld + raw block bytes / enterSharedWorld);
//   - applies the host's data silently on a guest (applyPayload) and executes a friend's
//     validated ops on the host (setCells, placeEntity, ..., prefab);
//   - follows the host's clock and weather on a guest.
//
// Entity record: [uid, key, x, y, z, rot, color|0, data|0, yo, ro] (yo = yOffset * 1000).
// Plant record: [i, crop, stage, wet 0/1] for the plant's own cell i.

import { hashEntityRecords, hashPlantRecords, packLook, stableStringify } from './codec.js';
import { classify } from '../things/prefabs/place.js';
import { ActorRegistry, basicSanitizeName } from './actors.js';

const NET_APPLIED_CELLS = 2048; // 'net:applied' lists at most this many cells (else null)
const SEAT_SPAN = 1e6;
const ST = { walk: 'w', swim: 'i', fly: 'f', sit: 's', sleep: 'z', ride: 'h', emote: 'e', hold: 'l' };

const clone = (v) => (v === undefined || v === null ? v : JSON.parse(JSON.stringify(v)));

export class GameAdapter {
  /**
   * @param {object} game
   * @param {object} [opts]
   * @param {(s:string, fallback?:string) => string} [opts.sanitizeName]  names shown to others
   *   (src/net/names.js sanitizeName when the UI module has it; a basic one otherwise)
   */
  constructor(game, opts = {}) {
    this.game = game;
    this.sanitizeName = opts.sanitizeName || basicSanitizeName;
    this.actors = new ActorRegistry(game, { sanitizeName: this.sanitizeName });
    this.role = null;
    this.hooks = null;
    this.seat = 0;
    this._alloc = { base: -1, next: 1 };
    this._weatherAuto = null;
    this._lk = null;
    this._tmAt = 0;
    this._hooked = { world: null };
    const dropLook = () => { this._lk = null; };
    game.events.on('avatar:changed', dropLook);
    game.events.on('outfit:changed', dropLook);
    game.events.on('profile:changed', dropLook);
  }

  // ---------- lifecycle ----------

  attach(role, hooks, info = {}) {
    this.role = role;
    this.hooks = hooks;
    this.seat = role === 'guest' ? info.seat | 0 : 0;
    this._install();
    this.actors.attach(role, hooks);
    const w = this.game.weather;
    if (role === 'guest' && w) {
      if (this._weatherAuto === null) this._weatherAuto = w.auto;
      w.auto = false;
    }
    this._setUidBase(null);
  }

  detach() {
    const g = this.game;
    if (this._hooked.world) this._hooked.world.onCell = null;
    this._hooked.world = null;
    if (g.entities) {
      g.entities.onChange = null;
      if (this.role === 'guest') g.entities.uidBase = 0;
    }
    if (g.garden) g.garden.onChange = null;
    this.actors.detach();
    if (g.weather && this._weatherAuto !== null) g.weather.auto = this._weatherAuto;
    this._weatherAuto = null;
    this.role = null;
    this.hooks = null;
    this.seat = 0;
    this._alloc = { base: -1, next: 1 };
  }

  /** Hooks on the current world, entities and garden (again after a new World). */
  _install() {
    const g = this.game, hooks = this.hooks;
    if (!hooks) return;
    const w = g.world;
    if (this._hooked.world && this._hooked.world !== w) this._hooked.world.onCell = null;
    if (w) {
      w.onCell = (i, prev, id) => hooks.cell(i, prev, id);
      this._hooked.world = w;
    }
    const E = g.entities;
    if (E) {
      E.onChange = (kind, e, a, b) => {
        if (kind === 'add') hooks.ent('add', e.uid, null, E._record(e));
        else if (kind === 'del') hooks.ent('del', e[0], e, null);
        else if (kind === 'rot') hooks.ent('rot', e.uid, a, e.rot);
        else if (kind === 'data') hooks.ent('data', e.uid, b, clone(a) || {});
      };
    }
    if (g.garden) g.garden.onChange = (kind, i, before, after) => hooks.plant(kind, i, before, after);
  }

  /**
   * Entity uid range of this seat (§5.2): the host keeps its own; a guest allocates from
   * seat * 1e6 + 1, after the highest uid of her range in the world, and never lower than
   * before while the seat stays the same (her edits still in flight keep their uids).
   */
  _setUidBase(prev) {
    const E = this.game.entities;
    if (!E) return;
    const base = this.seat * SEAT_SPAN;
    const lo = base + 1, hi = base + SEAT_SPAN - 1;
    let keep = lo;
    if (this._alloc.base === base) keep = this._alloc.next;
    if (prev && prev.base === base) keep = Math.max(keep, prev.next);
    if (E.uidBase === base) keep = Math.max(keep, E.nextUid);
    E.uidBase = base;
    E.nextUid = Math.max(lo, keep, this.maxUidInRange(lo, hi) + 1);
    this._alloc = { base, next: E.nextUid };
  }

  inSystems() {
    return !!this.game._inSystems;
  }

  // ---------- reading ----------

  size() {
    const w = this.game.world;
    return w ? { sx: w.sx, sy: w.sy, sz: w.sz } : { sx: 0, sy: 0, sz: 0 };
  }

  getCell(i) {
    return this.game.world.blocks[i];
  }

  coords(i) {
    const w = this.game.world;
    const x = i % w.sx;
    const t = Math.floor(i / w.sx);
    return [x, Math.floor(t / w.sz), t % w.sz];
  }

  entityRecord(uid) {
    const E = this.game.entities;
    const e = E && E.byUid(uid);
    return e ? E._record(e) : null;
  }

  plantRecord(i) {
    const g = this.game;
    const p = g.garden && g.garden.plants.get(i);
    if (!p) return null;
    const w = g.world;
    const below = i - w.sx * w.sz;
    const wet = below >= 0 && w.blocks[below] === this._wetId() ? 1 : 0;
    return [i, p.crop, p.stage, wet];
  }

  _wetId() {
    if (this._wet === undefined) this._wet = this.game.registry.blocks.idOf('farmland_wet');
    return this._wet;
  }

  actorRecord(kind, id) {
    return this.actors.record(kind, id);
  }

  actorSamples() {
    return this.actors.samples();
  }

  isFree(id) {
    const c = classify(this.game);
    return !!(c.natural[id] || c.tree[id] || c.leaves[id] || c.plant[id] || c.liquid[id]);
  }

  isSolid(id) {
    return this.game.registry.blocks.props.solid[id] === 1;
  }

  occupied(i) {
    const E = this.game.entities;
    return !!E && (E.occupied.has(i) || E.flats.has(i));
  }

  entityHash() {
    const E = this.game.entities;
    const recs = [];
    if (E) for (const e of E.map.values()) recs.push(E._record(e));
    return hashEntityRecords(recs);
  }

  plantHash() {
    const G = this.game.garden;
    const recs = [];
    if (G) for (const [i, p] of G.plants) recs.push([i, p.crop, p.stage]);
    return hashPlantRecords(recs);
  }

  maxUidInRange(lo, hi) {
    const E = this.game.entities;
    let m = 0;
    if (E) for (const uid of E.map.keys()) if (uid >= lo && uid <= hi && uid > m) m = uid;
    return m;
  }

  // ---------- snapshot ----------

  /** The host's world now: its save (no blocks, player, hotbar or picture) + raw block bytes. */
  makeSnapshot() {
    const g = this.game;
    const json = g.serializeWorld({ thumbnail: false, blocks: false });
    delete json.player;
    delete json.hotbar;
    delete json.thumbnail;
    json.blocks = '';
    json.actors = this.actors.handles();
    return { json, rle: g.world.encodeBlocksBytes() };
  }

  /** Guest: enter the host's world (game.enterSharedWorld). Resolves true when she is in. */
  async enterSnapshot(json, rle) {
    const g = this.game;
    if (!json || !json.size || !(rle instanceof Uint8Array)) return false;
    const E = g.entities;
    const prev = E ? { base: E.uidBase, next: E.nextUid } : null;
    this._cleanSnapshot(json);
    const ok = await g.enterSharedWorld(json, rle);
    if (!ok) return false;
    this._install();
    if (this.role) this.actors.attach(this.role, this.hooks);
    this.actors.adoptHandles(json.actors || {});
    if (g.weather && this.role === 'guest') g.weather.auto = false;
    this._setUidBase(prev);
    return true;
  }

  /** Names shown here pass the sanitizer; gems are her own copy (none found yet). */
  _cleanSnapshot(json) {
    const s = json.systems || {};
    if (Array.isArray(s.pets)) {
      for (const p of s.pets) {
        if (!p || typeof p !== 'object') continue;
        const spec = this.game.registry.pets && this.game.registry.pets.get(p.species);
        p.name = this.sanitizeName(p.name, (spec && spec.name) || 'Pet');
      }
    }
    const fl = s.friends && Array.isArray(s.friends.list) ? s.friends.list : null;
    if (fl) for (const f of fl) if (f && typeof f === 'object') f.name = this.sanitizeName(f.name, 'Friend');
    if (s.collectibles && Array.isArray(s.collectibles.gems)) {
      s.collectibles.gems = s.collectibles.gems.map((gm) => (Array.isArray(gm) ? [gm[0], gm[1], gm[2], gm[3], 0] : gm));
    }
    if (typeof json.name === 'string') {
      const m = /^(.*)'s World$/.exec(json.name);
      json.name = m ? `${this.sanitizeName(m[1], 'Friend')}'s World` : this.sanitizeName(json.name, 'Friend') + "'s World";
    }
  }

  // ---------- guest: silent apply of host data (inside remoteApplying) ----------

  /**
   * Order: X (removed uids), cells (one world.batch), E (tables first), P, K; then one
   * 'net:applied' { cells: [x,y,z,...] | null, entities, placed, removed } and unstick.
   */
  applyPayload(p) {
    const g = this.game;
    const w = g.world, E = g.entities;
    if (!w || !E) return { cells: 0, ents: 0 };
    const placed = [], removed = [];
    let ents = 0;
    if (p.X) {
      for (const uid of p.X) {
        const e = E.byUid(uid);
        if (!e) continue;
        E.remove(e, { history: false, events: false, fx: false, riders: false });
        removed.push(e);
        ents++;
      }
    }
    const cells = p.cells || [];
    let list = null;
    if (cells.length) {
      const n = cells.length >> 1;
      if (n <= NET_APPLIED_CELLS) list = [];
      const sx = w.sx, layer = w.sx * w.sz;
      const run = () => {
        for (let k = 0; k < cells.length; k += 2) {
          const i = cells[k];
          const y = Math.floor(i / layer), r = i - y * layer, z = Math.floor(r / sx), x = r - z * sx;
          w.set(x, y, z, cells[k + 1], { record: false });
          if (list) list.push(x, y, z);
        }
      };
      if (n > 8) w.batch(run);
      else run();
    }
    if (p.E && p.E.length) {
      const recs = p.E.slice().sort((a, b) => (a[9] ? 1 : 0) - (b[9] ? 1 : 0));
      for (const rec of recs) {
        this._applyEntity(rec, placed, removed);
        ents++;
      }
    }
    if (p.P && g.garden) for (const rec of p.P) g.garden.applyRemote(rec);
    if (p.K) for (const k of p.K) this.actors.applyRecord(k[0], k[1], k[2]);
    this.actors.afterApply({ placed, removed });
    g.events.emit('net:applied', { cells: list, entities: ents, placed, removed });
    if (cells.length || placed.length) g.unstickPlayer();
    return { cells: cells.length >> 1, ents };
  }

  /** One entity record from the host: same piece in place (data / color only) or placed anew. */
  _applyEntity(rec, placed, removed) {
    const E = this.game.entities;
    const [uid, key, x, y, z, rot, color, data, yo, ro] = rec;
    const def = E.defs.get(key);
    if (!def) return;
    const dataObj = data && typeof data === 'object' ? data : {};
    const yOffset = (yo | 0) / 1000;
    const restsOn = ro || null;
    const cur = E.byUid(uid);
    if (cur && cur.key === key && cur.x === x && cur.y === y && cur.z === z && cur.rot === rot) {
      const col = color || (def.colors ? def.colors[0] : null);
      const same = cur.color === col && Math.abs((cur.yOffset || 0) - yOffset) < 1e-6 && stableStringify(cur.data || {}) === stableStringify(dataObj);
      cur.restsOn = restsOn;
      if (!same) {
        // her own change came back as it was: nothing to rebuild (a door keeps swinging)
        cur.color = col;
        cur.data = clone(dataObj);
        cur.yOffset = yOffset;
        E.refresh(cur);
      }
      return;
    }
    if (cur) {
      E.remove(cur, { history: false, events: false, fx: false, riders: false });
      removed.push(cur);
    }
    const e = E.place(key, x, y, z, rot, color || null, clone(dataObj), {
      history: false, events: false, fx: false, uid, force: true, yOffset, restsOn,
    });
    if (e) placed.push(e);
  }

  // ---------- host: execute a friend's validated ops (inside net.exec(seat)) ----------
  //
  // While a friend's op runs, noHistory makes every history call a no-op. "Undo building"
  // (host.undoSeat) calls these same methods in the host's normal scope inside one
  // historyGroup, so the entries below make it undoable by the host's own Undo.

  setCells(pairs) {
    const g = this.game, w = g.world;
    const layer = w.sx * w.sz, sx = w.sx;
    const changed = [];
    const solid = g.registry.blocks.props.solid;
    let solidNew = false;
    const run = () => {
      for (let k = 0; k < pairs.length; k += 2) {
        const i = pairs[k], id = pairs[k + 1];
        const y = Math.floor(i / layer), r = i - y * layer, z = Math.floor(r / sx), x = r - z * sx;
        const prev = w.blocks[i];
        if (w.set(x, y, z, id, { record: true })) {
          changed.push(i, prev, id);
          if (solid[id] && g.player && g.player.overlapsCell(x, y, z)) solidNew = true;
        }
      }
    };
    if (pairs.length > 16) w.batch(run);
    else run();
    if (changed.length) {
      const cas = (from, to) => () => {
        if (g.world !== w) return;
        w.batch(() => {
          for (let k = changed.length - 3; k >= 0; k -= 3) {
            const i = changed[k];
            if (w.blocks[i] !== changed[k + from]) continue;
            const y = Math.floor(i / layer), r = i - y * layer, z = Math.floor(r / sx);
            w.set(r - z * sx, y, z, changed[k + to], { record: false });
          }
        });
      };
      g.pushHistory({ undo: cas(2, 1), redo: cas(1, 2) });
    }
    if (solidNew) g.unstickPlayer();
  }

  canPlaceEntity(key, x, y, z, rot, ignoreUid) {
    const E = this.game.entities;
    const def = E && E.defs.get(key);
    if (!def || !this.game.world) return false;
    return E.canPlace(def, x, y, z, rot, ignoreUid ? E.byUid(ignoreUid) : null, { players: false });
  }

  placeEntity(rec) {
    const E = this.game.entities;
    const [uid, key, x, y, z, rot, color, data] = rec;
    const e = E.place(key, x, y, z, rot, color || null, data && typeof data === 'object' ? clone(data) : {}, {
      uid, history: true, events: true, fx: true, players: false,
    });
    return !!e;
  }

  removeEntity(uid) {
    const E = this.game.entities;
    const e = E.byUid(uid);
    return e ? E.remove(e, { history: true, events: true, fx: true }) : false;
  }

  rotateEntity(uid, rot) {
    const g = this.game, E = g.entities;
    const e = E.byUid(uid);
    if (!e) return false;
    const before = e.rot;
    E._setRot(e, rot & 3);
    g.pushHistory({
      undo: () => { const c = E.byUid(uid); if (c && c.rot === (rot & 3)) E._setRot(c, before); },
      redo: () => { const c = E.byUid(uid); if (c && c.rot === before) E._setRot(c, rot & 3); },
    });
    return true;
  }

  patchEntity(uid, patch) {
    const g = this.game, E = g.entities;
    const e = E.byUid(uid);
    if (!e || !patch || typeof patch !== 'object') return false;
    const p = clone(patch);
    const before = {};
    for (const k in p) before[k] = e.data && k in e.data ? clone(e.data[k]) : null;
    E.setData(e, p);
    g.pushHistory({
      undo: () => { const c = E.byUid(uid); if (c) E.setData(c, clone(before)); },
      redo: () => { const c = E.byUid(uid); if (c) E.setData(c, clone(p)); },
    });
    return true;
  }

  ridersOf(uid) {
    const E = this.game.entities;
    const e = E.byUid(uid);
    return e ? E.itemsOnTop(e).map((r) => r.uid) : [];
  }

  plantAt(i) {
    const G = this.game.garden;
    const p = G && G.plants.get(i);
    return p ? [p.crop, p.stage] : null;
  }

  soilOk(i) {
    const g = this.game, w = g.world;
    if (!g.garden || !w) return false;
    const below = i - w.sx * w.sz;
    if (below < 0 || w.blocks[i] !== 0 || g.garden.plants.has(i) || this.occupied(i)) return false;
    const key = g.registry.blocks.byId(w.blocks[below])?.key;
    return key === 'farmland' || key === 'farmland_wet';
  }

  addPlant(crop, x, y, z) {
    const g = this.game, G = g.garden;
    if (!G) return false;
    const p = G.addPlant(crop, x, y, z, 0, G._wetAt(x, y - 1, z));
    if (!p) return false;
    g.pushHistory({
      undo: () => { const c = G.plantAt(x, y, z); if (c && c.crop === crop) G.removePlant(c); },
      redo: () => { if (!G.plantAt(x, y, z)) G.addPlant(crop, x, y, z, 0, 0); },
    });
    return true;
  }

  removePlant(i) {
    const g = this.game, G = g.garden;
    const p = G && G.plants.get(i);
    if (!p) return false;
    G.removePlant(p, { history: true });
    return true;
  }

  harvestPlant(i) {
    const G = this.game.garden;
    const p = G && G.plants.get(i);
    if (!p || p.stage !== 3) return false;
    G.harvestState(p);
    return true;
  }

  adoptWet(i) {
    const G = this.game.garden;
    if (!G || this.getCell(i) !== this._wetId()) return;
    const [x, y, z] = this.coords(i);
    G.adoptWet(x, y, z);
  }

  prefab(key, pl, policy) {
    const P = this.game.prefabs;
    if (!P || typeof P.applyRemote !== 'function') return { ok: false, code: 5 };
    const r = P.applyRemote(key, pl, policy);
    return r && r.ok ? { ok: true, name: r.name } : { ok: false, code: (r && r.code) || 1 };
  }

  skipToMorning() {
    this.game.skipToMorning();
  }

  historyGroup(fn) {
    this.game.historyGroup(fn);
  }

  // ---------- environment (both roles) ----------

  /** My presence: p [x, y, z, yaw] (feet; seat when sitting), st, nm, lk. */
  local() {
    const g = this.game, pl = g.player;
    const p = pl && g.mode === 'play' ? [pl.position.x, pl.position.y, pl.position.z, pl.yaw] : null;
    const st = pl ? ST[pl.state] || 'w' : 'w';
    const prof = g.profile || {};
    const nm = this.sanitizeName(prof.playerName || (prof.look && prof.look.name) || '', 'Friend');
    if (this._lk === null) {
      try {
        this._lk = packLook(prof.look || {});
      } catch {
        this._lk = '';
      }
    }
    return { p, st, nm, lk: this._lk };
  }

  time() {
    const g = this.game;
    return [g.time.dayTime, g.time.day, g.profile.settings.timeFrozen ? 1 : 0];
  }

  /**
   * Guest: follow the host's clock [dayTime, day, frozen] seen ageMs ago. More than 0.01 day
   * apart: snap (a forward snap over a morning is a quiet night: time:morning, no time:night);
   * otherwise ease 10% of the gap per second.
   */
  applyTime(tm, ageMs) {
    const t = this.game.time;
    if (!Array.isArray(tm) || !Number.isFinite(tm[0]) || !Number.isFinite(tm[1])) return;
    const len = t.dayLength || 720;
    const target = tm[1] + tm[0] + (tm[2] ? 0 : Math.max(0, ageMs) / 1000 / len);
    const mine = t.day + t.dayTime;
    const diff = target - mine;
    const now = performance.now();
    const dt = Math.min(1, Math.max(0, (now - this._tmAt) / 1000));
    this._tmAt = now;
    if (Math.abs(diff) > 0.01) {
      if (diff > 0 && Math.floor(target - 0.25) > Math.floor(mine - 0.25)) t.quietNight = true;
      t.day = Math.floor(target);
      t.dayTime = target - t.day;
    } else if (diff !== 0) {
      const v = mine + diff * (1 - Math.pow(0.9, dt));
      t.day = Math.floor(v);
      t.dayTime = v - t.day;
    }
  }

  weather() {
    const w = this.game.weather;
    return w ? w.current : 'sunny';
  }

  applyWeather(kind) {
    const w = this.game.weather;
    if (!w) return;
    w.auto = false;
    if (kind !== w.current) w.set(kind, { manual: false, announce: true });
  }

  toast(text, icon) {
    if (text) this.game.toast(text, { icon: icon || 'sparkle' });
  }

  celebrate(kind, x, y, z) {
    this.game.celebrate([x, y, z], kind || 'sparkle');
  }

  unstick() {
    this.game.unstickPlayer();
  }

  // ---------- optional extensions ----------

  applySamples(samples) {
    this.actors.applySamples(samples || {});
  }

  resolveIntent(kind, lseq, ok) {
    const P = this.game.prefabs;
    if (kind === 'pf' && P && typeof P.resolveRemote === 'function') P.resolveRemote(lseq, ok);
  }
}

export function createGameAdapter(game, opts) {
  return new GameAdapter(game, opts);
}
