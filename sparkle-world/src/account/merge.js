// Two copies of one player's profile (docs/ACCOUNTS.md §7.4): this device's and the server's,
// after a 409 or at boot. The newer `updatedAt` gives the base (look, outfits, settings, basket,
// lastWorldId...); stickers are the union (the earliest date kept); every `stats` number and
// each recipesCooked count takes the maximum; coins take the maximum (coins are earned-only,
// never summed, so nothing can be farmed). Device-local parts are always this device's and
// never uploaded: `net` ("Keep playing" / "Join Lily"), `keepsafe` (this browser's storage)
// and `settings.walkie*` (the old per-device grown-up check).
// squish: union of toys; a real base beats a provisional one, then the earliest
// (src/core/squish-merge.js).

import { mergeSquish } from '../core/squish-merge.js';

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const when = (v) => (typeof v === 'number' ? v : Date.parse(v) || 0);
const LOCAL = /^(net|keepsafe|_rev)$/;
const WALKIE = /^walkie/;

function maxNumbers(a, b) {
  const out = { ...a };
  for (const [k, v] of Object.entries(isObj(b) ? b : {})) {
    if (typeof v === 'number') out[k] = out[k] >= v ? out[k] : v;
    else if (isObj(v)) out[k] = maxNumbers(out[k], v);
    else if (!(k in out)) out[k] = v;
  }
  return out;
}

function union(a, b) {
  const out = { ...a };
  for (const [k, v] of Object.entries(isObj(b) ? b : {})) if (!(k in out) || when(v) < when(out[k])) out[k] = v;
  return out;
}

/** p's own keys that match `re` (or all others with keep = false), copied. */
const pick = (p, re, keep) => Object.fromEntries(Object.entries(isObj(p) ? p : {}).filter(([k]) => re.test(k) === keep));

/** What goes to the server: the profile without its device-local parts. */
export function cloudProfile(p) {
  const out = pick(p, LOCAL, false);
  if (isObj(out.settings)) out.settings = pick(out.settings, WALKIE, false);
  return out;
}

export function mergeProfile(local, server) {
  if (!isObj(server)) return local;
  if (!isObj(local)) return server;
  const lt = local.updatedAt || 0;
  const st = server.updatedAt || 0;
  const out = JSON.parse(JSON.stringify({ ...cloudProfile(st > lt ? server : local), ...pick(local, LOCAL, true) }));
  delete out._rev;
  out.stickers = union(local.stickers, server.stickers);
  if (local.stickersSeen || server.stickersSeen) out.stickersSeen = union(local.stickersSeen, server.stickersSeen);
  out.stats = maxNumbers(local.stats, server.stats);
  if (isObj(local.squish) || isObj(server.squish)) out.squish = mergeSquish(local.squish, server.squish);
  if ('coins' in local || 'coins' in server) out.coins = Math.max(local.coins || 0, server.coins || 0);
  // the Dress Up nudge stays gone once she opened the Studio on any device (one way, like a backup)
  if (local.lookPicked === true || server.lookPicked === true) out.lookPicked = true;
  if (isObj(local.settings)) out.settings = { ...out.settings, ...pick(local.settings, WALKIE, true) };
  out.updatedAt = Math.max(lt, st);
  return out;
}
