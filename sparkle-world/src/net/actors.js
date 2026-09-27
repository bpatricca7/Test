// Host-owned actors (docs/MULTIPLAYER.md §9.8, docs/teams/net.md): things that belong to the
// host's world but are not blocks, furniture or plants. They travel as actor records
// `a:<kind>:<id>` -> [kind, id, rec | 0] in batches (K) and, when they move, as motion samples
// in the host's presence (pets `pt`, NPC friends `nx`).
//
// Built in:
//   'pet'  game.pets    record = the pet's save entry without its position, plus h (handle)
//   'npc'  game.friends the wave-2 NPC friend girls (same shape); puppets on guests
//   'zip'  game.outdoor.zip  one record 'links' = { l: [[towerUidA, towerUidB, parkedAtB]] }:
//          which zip towers are linked (links are made by the host when towers are placed;
//          a guest's own tower links locally at once and is corrected by the host's list)
//
// Game modules never import this file: they expose a callback property (`onChange`) that
// the registry sets while a session runs, a `remote` flag (guest: puppets, refusals) and
// small methods (setNetTarget / netSample / setLinks). Other modules may add kinds with
// register(kind, handler); see the handler shape below.

const NAME_MAX = 12;

/**
 * A small stand-in for src/net/names.js sanitizeName (docs/MULTIPLAYER.md §11.8): NFKC,
 * letters, spaces, '-' and '\'' only, collapsed and cut to 12 characters; fallback when empty.
 * The UI module (Agent C) passes the reviewed sanitizeName (with its blocklist) instead.
 */
export function basicSanitizeName(s, fallback = 'Friend') {
  let t = typeof s === 'string' ? s : '';
  try {
    t = t.normalize('NFKC');
  } catch {}
  t = t.replace(/[^\p{L}\p{M} '\-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX).trim();
  return t || fallback;
}

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

function withoutPosition(saved, h) {
  const out = { ...saved, h };
  delete out.x;
  delete out.y;
  delete out.z;
  delete out.yaw;
  return clone(out);
}

/**
 * Handler shape for register(kind, handler):
 *   list() -> actors (host) ; idOf(a) -> string ; find(id) -> actor | null
 *   record(a) -> plain object (no position) ; channel: 'pt' | 'nx' | null ; sample(a) -> array
 *   applyRecord(id, rec | null) (guest, inside remoteApplying) ; applySample(sample) (guest)
 *   setRemote(on) ; bind(touch | null)  (touch(id): this actor's record changed)
 *   handles() -> [[id, h], ...] ; adoptHandles(pairs) ; afterApply({ placed, removed })
 */
export class ActorRegistry {
  constructor(game, { sanitizeName = basicSanitizeName } = {}) {
    this.game = game;
    this.sanitizeName = sanitizeName;
    this.kinds = new Map();
    this.role = null;
    this.hooks = null;
    this.registerBuiltins();
  }

  register(kind, handler) {
    this.kinds.set(kind, handler);
    if (this.role) this._bindOne(kind, handler);
    return handler;
  }

  /** An actor's record changed (host): it goes into the next batch. */
  touch(kind, id) {
    if (this.role === 'host' && this.hooks) this.hooks.actor(kind, String(id));
  }

  attach(role, hooks) {
    this.role = role;
    this.hooks = hooks;
    for (const [kind, h] of this.kinds) this._bindOne(kind, h);
  }

  detach() {
    for (const h of this.kinds.values()) {
      try {
        h.bind(null);
        h.setRemote(false);
      } catch (err) {
        console.warn('[net] actor detach failed', err);
      }
    }
    this.role = null;
    this.hooks = null;
  }

  _bindOne(kind, h) {
    try {
      h.setRemote(this.role === 'guest');
      h.bind(this.role === 'host' ? (id) => this.touch(kind, id) : null);
    } catch (err) {
      console.warn('[net] actor attach failed', kind, err);
    }
  }

  record(kind, id) {
    const h = this.kinds.get(kind);
    if (!h) return null;
    const a = h.find(id);
    if (!a) return null;
    const rec = h.record(a);
    return rec ? [kind, id, rec] : null;
  }

  /** Host: motion samples for presence { pt, nx } (at most 12 each). */
  samples() {
    const out = { pt: [], nx: [] };
    for (const h of this.kinds.values()) {
      if (!h.channel) continue;
      const list = out[h.channel];
      for (const a of h.list()) {
        if (list.length >= 12) break;
        const s = h.sample(a);
        if (s) list.push(s);
      }
    }
    return out;
  }

  /** Guest: a record from the host (rec 0 = removed). */
  applyRecord(kind, id, rec) {
    const h = this.kinds.get(kind);
    if (!h) return;
    try {
      h.applyRecord(id, rec && typeof rec === 'object' ? rec : null);
    } catch (err) {
      console.warn('[net] actor record failed', kind, err);
    }
  }

  /** Guest: the host's latest motion samples. */
  applySamples({ pt, nx } = {}) {
    for (const h of this.kinds.values()) {
      const list = h.channel === 'pt' ? pt : h.channel === 'nx' ? nx : null;
      if (!Array.isArray(list)) continue;
      for (const s of list) {
        if (!Array.isArray(s) || s.length < 6 || !s.slice(0, 5).every((v) => typeof v === 'number' && Number.isFinite(v))) continue;
        try {
          h.applySample(s);
        } catch (err) {
          console.warn('[net] actor sample failed', err);
        }
      }
    }
  }

  /** Host snapshot: { kind: [[id, h], ...] } so a guest can match samples to actors. */
  handles() {
    const out = {};
    for (const [kind, h] of this.kinds) if (h.handles) out[kind] = h.handles();
    return out;
  }

  /** Guest, after entering a snapshot. */
  adoptHandles(map) {
    for (const [kind, h] of this.kinds) {
      try {
        if (h.adoptHandles) h.adoptHandles(map && Array.isArray(map[kind]) ? map[kind] : []);
      } catch (err) {
        console.warn('[net] actor handles failed', kind, err);
      }
    }
  }

  /** Guest, after every applied payload (entities placed / removed silently). */
  afterApply(info) {
    for (const h of this.kinds.values()) {
      try {
        if (h.afterApply) h.afterApply(info);
      } catch (err) {
        console.warn('[net] actor refresh failed', err);
      }
    }
  }

  // ---------- built-in kinds ----------

  registerBuiltins() {
    const game = this.game;
    const reg = this;

    // pets and NPC friends share the puppet pattern
    const puppets = (kind, sysOf, channel, fallbackName) => {
      const byH = (sys, hh) => {
        for (const a of sys.list()) if (a.h === hh) return a;
        return null;
      };
      const listOf = (sys) => (kind === 'pet' ? sys.pets : sys.friends);
      return {
        channel,
        list() {
          const sys = sysOf();
          return sys ? listOf(sys) : [];
        },
        idOf: (a) => a.id,
        find(id) {
          const sys = sysOf();
          return sys ? sys.byId(id) : null;
        },
        record(a) {
          return withoutPosition(a.serialize(), a.h | 0);
        },
        sample: (a) => (typeof a.netSample === 'function' ? a.netSample() : null),
        applyRecord(id, rec) {
          const sys = sysOf();
          if (!sys) return;
          const cur = sys.byId(id);
          if (!rec) {
            if (cur) sys.remove(cur);
            return;
          }
          const name = reg.sanitizeName(rec.name, fallbackName(rec));
          if (!cur) {
            const home = Array.isArray(rec.home) ? rec.home : [0, 0, 0];
            const data = { ...rec, id, name, x: home[0], y: home[1], z: home[2] };
            if (kind === 'npc' && typeof sys.byKey === 'function' && sys.byKey(rec.key)) return;
            sys._add(data);
            return;
          }
          if (rec.h > 0) cur.h = rec.h | 0;
          if (kind === 'pet') {
            if (cur.name !== name) cur.setName(name);
            if (rec.mode) cur.mode = rec.mode;
            if (Number.isFinite(rec.love)) cur.love = rec.love | 0;
          } else {
            if (rec.look && JSON.stringify(rec.look) !== JSON.stringify(cur.look)) cur.setLook(rec.look);
            if (rec.mode) cur.mode = rec.mode;
          }
          if (Array.isArray(rec.home)) cur.home = rec.home.slice(0, 3);
          if (typeof sys._changed === 'function') sys._changed();
        },
        applySample(s) {
          const sys = sysOf();
          const a = sys ? byH({ list: () => listOf(sys) }, s[0]) : null;
          if (a && typeof a.setNetTarget === 'function') a.setNetTarget(s);
        },
        setRemote(on) {
          const sys = sysOf();
          if (sys) sys.remote = !!on;
        },
        bind(touch) {
          const sys = sysOf();
          if (sys) sys.onChange = touch ? (a) => touch(a.id) : null;
        },
        handles() {
          const sys = sysOf();
          return sys ? listOf(sys).map((a) => [a.id, a.h | 0]) : [];
        },
        adoptHandles(pairs) {
          const sys = sysOf();
          if (!sys) return;
          for (const [id, hh] of pairs) {
            const a = sys.byId(id);
            if (a && hh > 0) a.h = hh | 0;
          }
        },
      };
    };

    this.kinds.set('pet', puppets('pet', () => game.pets || null, 'pt', (rec) => {
      const spec = game.registry.pets && game.registry.pets.get(rec.species);
      return (spec && spec.name) || 'Pet';
    }));
    this.kinds.set('npc', puppets('npc', () => game.friends || null, 'nx', () => 'Friend'));

    // zip-line links: one record with the whole list
    let lastLinks = null;
    const zipOf = () => (game.outdoor && game.outdoor.zip) || null;
    this.kinds.set('zip', {
      channel: null,
      list: () => [],
      idOf: () => 'links',
      find: (id) => (id === 'links' && zipOf() ? zipOf() : null),
      record: (zip) => ({ l: zip.links.map((l) => [l.a, l.b, l.parked === 'b' ? 1 : 0]) }),
      sample: () => null,
      applyRecord(id, rec) {
        const zip = zipOf();
        if (id !== 'links' || !zip || typeof zip.setLinks !== 'function') return;
        lastLinks = rec && Array.isArray(rec.l) ? rec.l : [];
        zip.setLinks(lastLinks);
      },
      applySample() {},
      setRemote(on) {
        if (!on) lastLinks = null;
      },
      bind(touch) {
        const zip = zipOf();
        if (zip) zip.onChange = touch ? () => touch('links') : null;
      },
      adoptHandles() {
        // the snapshot's links (outdoor system) are the host's list at s0
        const zip = zipOf();
        lastLinks = zip ? zip.links.map((l) => [l.a, l.b, l.parked === 'b' ? 1 : 0]) : null;
      },
      afterApply({ placed, removed }) {
        const zip = zipOf();
        if (!zip || !lastLinks || typeof zip.setLinks !== 'function') return;
        const tower = (e) => e && e.key === 'zipline_tower';
        if ((placed && placed.some(tower)) || (removed && removed.some(tower))) zip.setLinks(lastLinks);
      },
    });
  }
}
