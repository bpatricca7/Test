// Settings persistence (localStorage, remembered between sessions) and defaults for the settings
// the UI adds to game.settings. Every storage access is wrapped in try/catch: the game may run in
// a sandboxed frame where merely touching `window.localStorage` throws.
//
// URL parameters win over stored values (?hud=0, ?audio=0, ?quality=...), so tests and shared
// links behave predictably. The render quality cannot change at run time (the renderer is built
// with it), so the UI reloads the page with ?quality=<q> instead — see qualityURL().

export const STORAGE_KEY = 'apollo-lunar-landing.settings.v1';

/** Settings the UI persists, with their defaults and validators. */
export const PERSISTED = {
  units: { def: 'imperial', ok: (v) => v === 'imperial' || v === 'metric' },
  hud: { def: true, ok: (v) => typeof v === 'boolean', param: 'hud' },
  audio: { def: true, ok: (v) => typeof v === 'boolean', param: 'audio' },
  volume: { def: 0.8, ok: (v) => Number.isFinite(v) && v >= 0 && v <= 1 },
  callouts: { def: true, ok: (v) => typeof v === 'boolean' },
  invertPitch: { def: false, ok: (v) => typeof v === 'boolean' },
  mouseSensitivity: { def: 1, ok: (v) => Number.isFinite(v) && v >= 0.2 && v <= 3 },
  historicalAlarms: { def: false, ok: (v) => typeof v === 'boolean' },
  filmGrain: { def: true, ok: (v) => typeof v === 'boolean' },
  exposureComp: { def: 0, ok: (v) => Number.isFinite(v) && v >= -2 && v <= 2 },
};

/** Safe localStorage handle (null when unavailable). */
export function getStorage() {
  try {
    const s = typeof window !== 'undefined' ? window.localStorage : null;
    if (!s) return null;
    const k = '__apollo_probe__';
    s.setItem(k, '1');
    s.removeItem(k);
    return s;
  } catch {
    return null;
  }
}

/** Add any missing UI-owned settings (filmGrain, exposureComp) with their defaults. */
export function ensureDefaults(settings) {
  for (const [k, d] of Object.entries(PERSISTED)) if (settings[k] === undefined) settings[k] = d.def;
  return settings;
}

/**
 * Merge stored settings into `settings`. Values given by URL parameters (params[name] !== null)
 * are left alone. Returns the list of keys that were applied.
 */
export function loadSettings(settings, params = {}, storage = getStorage()) {
  ensureDefaults(settings);
  if (!storage) return [];
  let data = null;
  try {
    data = JSON.parse(storage.getItem(STORAGE_KEY) || 'null');
  } catch {
    data = null;
  }
  if (!data || typeof data !== 'object') return [];
  const applied = [];
  for (const [k, d] of Object.entries(PERSISTED)) {
    if (!(k in data) || !d.ok(data[k])) continue;
    if (d.param && params[d.param] != null) continue; // URL parameter wins
    settings[k] = data[k];
    applied.push(k);
  }
  return applied;
}

/** Persist the UI-managed settings. Silently does nothing when storage is unavailable. */
export function saveSettings(settings, storage = getStorage()) {
  if (!storage) return false;
  const out = {};
  for (const [k, d] of Object.entries(PERSISTED)) if (d.ok(settings[k])) out[k] = settings[k];
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(out));
    return true;
  } catch {
    return false;
  }
}

/** URL of the current page with ?quality=<q> (other parameters kept). */
export function qualityURL(href, quality) {
  const u = new URL(href);
  u.searchParams.set('quality', quality);
  return u.toString();
}
