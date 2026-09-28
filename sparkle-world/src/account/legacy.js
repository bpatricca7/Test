// Worlds already on this device from before accounts (docs/ACCOUNTS.md §7.5): at the first
// sign-in they are copied into a player's store (and so into her cloud copy). Everything a
// "keep her worlds safe" backup file carries comes along: every world with its "Before
// friends" side copies, her look, outfits, stickers, counters, coins and basket.
//
// localStorage['sparkle-world:legacy'] = { state: 'imported' | 'dismissed', to, at }. The old
// copies stay 30 days after an import, then a later boot removes them (only the
// 'sparkle-world' database and the sparkle-world:metas / profile / world:* keys).

import { SaveStore, isSideCopyId, backupProfile, mergeBackupProfile } from '../core/storage.js';

export const LEGACY_KEY = 'sparkle-world:legacy';
const KEEP_MS = 30 * 86400000;

export function legacyState() {
  try {
    return JSON.parse(localStorage.getItem(LEGACY_KEY) || 'null');
  } catch {
    return null;
  }
}

export function setLegacyState(v) {
  try {
    localStorage.setItem(LEGACY_KEY, JSON.stringify(v));
  } catch {}
}

/** A profile with something of hers in it (not the game's starting one). */
export function profileHasPlay(p) {
  if (!p || typeof p !== 'object') return false;
  const s = p.stats || {};
  return Object.keys(p.stickers || {}).length > 0 || (p.coins || 0) > 0 || (s.blocksPlaced || 0) > 0 || (s.worldsCreated || 0) > 0 ||
    (Array.isArray(p.outfits) && p.outfits.some(Boolean));
}

/** Might there be old saves? (no database is created just to look) */
async function mayHaveLegacy() {
  try {
    if (localStorage.getItem('sparkle-world:metas') || localStorage.getItem('sparkle-world:profile')) return true;
  } catch {}
  try {
    const idb = globalThis.indexedDB;
    if (!idb) return false;
    if (typeof idb.databases !== 'function') return true;
    return (await idb.databases()).some((d) => d && d.name === 'sparkle-world');
  } catch {
    return true;
  }
}

/**
 * The old saves: { store, worlds: [meta] (main worlds), all: [meta], profile } or null when
 * there are none. The caller closes store when done.
 */
export async function findLegacy() {
  if (!(await mayHaveLegacy())) return null;
  const store = SaveStore.legacy();
  await store.init();
  const all = await store._listAll();
  const profile = await store.loadProfile();
  const worlds = all.filter((m) => !isSideCopyId(m.id));
  if (!worlds.length && !profileHasPlay(profile)) {
    store.close();
    return null;
  }
  return { store, worlds, all, profile };
}

function newId() {
  return 'w' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
}

/**
 * Copy the old saves into `target` (a player's SaveStore) and her things into `profile`
 * (changed in place; the caller saves it). An id she already has gets a new one (like
 * importWorld); side copies follow their world. Importing again adds no coins or stickers:
 * those take the bigger number / the union, never a sum. → { worlds: n, failed }.
 */
export async function importLegacy(legacy, target, profile) {
  const list = await target._listAll();
  const had = new Map(list.map((m) => [m.id, m]));
  const mine = new Set(had.keys());
  // a world brought in before (maybe under a new id) is the same name, birth and last play
  const key = (m) => `${m.name}|${m.createdAt || 0}|${m.updatedAt || 0}`;
  const seen = new Set(list.map(key));
  const renamed = new Map();
  let worlds = 0;
  let failed = 0;
  const order = [...legacy.all].sort((a, b) => Number(isSideCopyId(a.id)) - Number(isSideCopyId(b.id)));
  for (const m of order) {
    const save = await legacy.store.loadWorld(m.id);
    if (!save || typeof save.blocks !== 'string') continue;
    let id = save.id;
    const side = /\.(before|undo)$/.exec(id);
    if (side) {
      const of = id.slice(0, -side[0].length);
      id = (renamed.get(of) || of) + side[0];
      if (mine.has(id)) continue; // her own side copy wins
    } else if (seen.has(key(save))) {
      continue; // brought in before: the very same world
    } else if (mine.has(id)) {
      id = newId();
      renamed.set(save.id, id);
    }
    const copy = { ...save, id };
    if (copy.backupOf) copy.backupOf = renamed.get(copy.backupOf) || copy.backupOf;
    if (copy.undoOf) copy.undoOf = renamed.get(copy.undoOf) || copy.undoOf;
    const res = await target.saveWorld(copy);
    if (res.ok) {
      mine.add(id);
      if (!side) worlds++;
    } else failed++;
  }
  if (legacy.profile && profile) {
    const fresh = !profileHasPlay(profile);
    mergeBackupProfile(profile, backupProfile(legacy.profile), { fresh });
  }
  await target.flush();
  return { worlds, failed };
}

/** Remove the old copies (the grown-up's "Remove old copies", or 30 days after an import). */
export async function removeLegacy(legacyStore = null) {
  if (legacyStore) legacyStore.close();
  await SaveStore.wipe('');
}

/** A later boot: old copies imported more than 30 days ago go. */
export async function expireLegacy(now = Date.now()) {
  const st = legacyState();
  if (!st || st.state !== 'imported' || !(now - (st.at || 0) > KEEP_MS) || st.removed) return false;
  await removeLegacy();
  setLegacyState({ ...st, removed: now });
  return true;
}
