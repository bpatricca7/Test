// Wave 5 (docs/teams/wave5-plan.md §4): things a biome asks to have placed when it makes a new
// world. A biome's generate() can only write blocks; furniture, rides, games, elves and
// animals are entities or systems that exist only once the world is loaded. So generate()
// leaves a list on the world (`world.features`, in memory only, never saved) and this module
// hands each record to the module that owns its kind, once, when that fresh world first loads.
//
// Record: { kind: string, x, y, z, rot?: 0..3, ...anything the kind's owner documents }
//   kind 'furn' is built in: { kind: 'furn', key, x, y, z, rot = 0, color = null, data = {} }
//   places an existing furniture key (bed_single, sofa, ice_cream_parlor, fireplace...).
//   Every other kind belongs to one team (wave5-plan.md §4.2) and is registered with
//   game.worldFeatures.on(kind, fn) during install. fn(game, record, world) places things.
//
// Placement happens on the host only (a friend's page mirrors the host's world), with no
// history entry, no sparkle, no sound and no 'entity:place' event (so a ready-made cabin's
// bed and door do not award Home Sweet Home). A record whose owner is missing, or whose
// placement throws, is skipped with one warning: a world is never lost to a decoration.

const PLACE_OPTS = { history: false, fx: false, events: false, players: false };

export function install(game) {
  const handlers = new Map();
  const warned = new Set();
  const warnOnce = (msg, err) => {
    if (warned.has(msg)) return;
    warned.add(msg);
    console.warn('[features] ' + msg, err || '');
  };

  game.worldFeatures = {
    /** Register the placer for one kind (one owner per kind; the first registration wins). */
    on(kind, fn) {
      if (typeof fn !== 'function') return;
      if (handlers.has(kind)) { warnOnce(`kind "${kind}" registered twice; keeping the first`); return; }
      handlers.set(kind, fn);
    },
    has(kind) { return handlers.has(kind); },
    /** The options every placer passes to game.entities.place (copy before changing). */
    placeOpts(extra = null) { return extra ? { ...PLACE_OPTS, ...extra } : { ...PLACE_OPTS }; },
    /** Place a list of records now (the 'world:load' listener; also used by probes). */
    run(world, list) {
      let placed = 0;
      for (const f of list) {
        if (!f || typeof f.kind !== 'string') continue;
        const fn = handlers.get(f.kind);
        // a ':spot' record only names a place (for a board or a hint); with no reader it is quietly skipped
        if (!fn) { if (!f.kind.endsWith(':spot')) warnOnce(`no owner for kind "${f.kind}"`); continue; }
        try {
          if (fn(game, f, world) !== false) placed++;
        } catch (err) {
          warnOnce(`placing "${f.kind}" failed`, err);
        }
      }
      return placed;
    },
  };

  game.worldFeatures.on('furn', (g, f) => {
    if (!g.entities) return false;
    const e = g.entities.place(f.key, f.x | 0, f.y | 0, f.z | 0, f.rot | 0, f.color ?? null, f.data || {}, PLACE_OPTS)
      || g.entities.place(f.key, f.x | 0, f.y | 0, f.z | 0, f.rot | 0, f.color ?? null, f.data || {}, { ...PLACE_OPTS, force: true });
    return !!e;
  });

  game.events.on('world:load', ({ world } = {}) => {
    if (!world) return;
    const list = world.features;
    world.features = null;
    if (!Array.isArray(list) || !list.length) return;
    if (game.net && game.net.isGuest) return;
    game.worldFeatures.run(world, list);
  });
}
