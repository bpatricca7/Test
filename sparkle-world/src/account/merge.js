// Two copies of one player's profile (docs/ACCOUNTS.md §7.4): this device's and the server's,
// after a 409 or at boot. The newer `updatedAt` gives the base (look, outfits, settings, basket,
// lastWorldId...); stickers are the union (the earliest date kept); every `stats` number and
// each recipesCooked count takes the maximum; coins take the maximum (coins are earned-only,
// never summed, so nothing can be farmed). Device-local parts are always this device's and
// never uploaded: `net` ("Keep playing" / "Join Lily"), `keepsafe` (this browser's storage)
// and `settings.walkie*` (the old per-device grown-up check).

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const when = (v) => (typeof v === 'number' ? v : Date.parse(String(v)) || 0);
const LOCAL_KEYS = ['net', 'keepsafe'];

function maxNumbers(a, b) {
  const out = { ...(isObj(a) ? a : {}) };
  for (const [k, v] of Object.entries(isObj(b) ? b : {})) {
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = typeof out[k] === 'number' && out[k] >= v ? out[k] : v;
    else if (isObj(v)) out[k] = maxNumbers(out[k], v);
    else if (!(k in out)) out[k] = v;
  }
  return out;
}

function union(a, b) {
  const out = { ...(isObj(a) ? a : {}) };
  for (const [k, v] of Object.entries(isObj(b) ? b : {})) if (!(k in out) || when(v) < when(out[k])) out[k] = v;
  return out;
}

/** What goes to the server: the profile without its device-local parts. */
export function cloudProfile(p) {
  const out = { ...p };
  for (const k of LOCAL_KEYS) delete out[k];
  delete out._rev;
  if (isObj(out.settings)) {
    out.settings = { ...out.settings };
    for (const k of Object.keys(out.settings)) if (k.startsWith('walkie')) delete out.settings[k];
  }
  return out;
}

export function mergeProfile(local, server) {
  if (!isObj(server)) return local;
  if (!isObj(local)) return server;
  const lt = local.updatedAt || 0;
  const st = server.updatedAt || 0;
  const out = JSON.parse(JSON.stringify(cloudProfile(st > lt ? server : local)));
  out.stickers = union(local.stickers, server.stickers);
  if (isObj(local.stickersSeen) || isObj(server.stickersSeen)) out.stickersSeen = union(local.stickersSeen, server.stickersSeen);
  out.stats = maxNumbers(local.stats, server.stats);
  const coins = Math.max(Number(local.coins) || 0, Number(server.coins) || 0);
  if (coins || 'coins' in local || 'coins' in server) out.coins = coins;
  for (const k of LOCAL_KEYS) if (local[k] !== undefined) out[k] = JSON.parse(JSON.stringify(local[k]));
  if (isObj(local.settings)) {
    out.settings = { ...(out.settings || {}) };
    for (const [k, v] of Object.entries(local.settings)) if (k.startsWith('walkie')) out.settings[k] = v;
  }
  out.updatedAt = Math.max(lt, st);
  return out;
}
