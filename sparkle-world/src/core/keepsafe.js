// Keeping her worlds safe on the website version (docs/teams/keepsafe.md).
//
// On the Railway website her worlds live only in this browser (IndexedDB, see storage.js).
// A browser may clear a site's storage when the device runs short of space, and Safari on
// iPhone/iPad clears what a website stored after about 7 days without a visit. So, on the
// website only (never inside claude.ai, where worlds also save to her account, and never on
// file://), this:
//  - asks the browser to keep this site's storage (navigator.storage.persist()), once at boot
//    and again at her first tap or key press (browsers say yes more readily after one);
//  - remembers the answer in profile.keepsafe and reports it in diag (game.diag.report());
//  - says when a copy in a file is due (backupDue): the storage is not kept for sure (or this is
//    an iPhone/iPad browser tab, where the 7-day rule applies anyway), she has worlds, and there
//    has been no copy for 7 days. The title card that offers it is src/ui/keepsafe.js.
// Everything is feature-detected and nothing here throws.

const DAY = 86400000;
export const BACKUP_EVERY_MS = 7 * DAY; // no copy in a file for this long: offer one
export const SNOOZE_MS = 7 * DAY; // "Not now" waits this long

/** Where the game runs: 'claude' (a claude.ai Artifact), 'web' (http/https), 'file' or 'other'. */
export function hostKind(win = typeof window !== 'undefined' ? window : null) {
  try {
    if (!win) return 'other';
    if (win.claude && typeof win.claude.use === 'function') return 'claude';
    const p = win.location && win.location.protocol;
    if (p === 'http:' || p === 'https:') return 'web';
    return p === 'file:' ? 'file' : 'other';
  } catch {
    return 'other';
  }
}

/**
 * { ios, standalone }: an iPhone/iPad (iPadOS Safari says "Macintosh" but has a touch screen),
 * and whether the page runs as a Home Screen web app (then Safari's 7-day rule does not apply).
 */
export function deviceInfo(win = typeof window !== 'undefined' ? window : null) {
  const out = { ios: false, standalone: false };
  try {
    const nav = (win && win.navigator) || {};
    const ua = String(nav.userAgent || '');
    out.ios = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && (nav.maxTouchPoints || 0) > 1);
    out.standalone = nav.standalone === true;
    if (!out.standalone && win && typeof win.matchMedia === 'function') {
      out.standalone = ['standalone', 'fullscreen', 'minimal-ui'].some((m) => win.matchMedia(`(display-mode: ${m})`).matches);
    }
  } catch {
    // unknown: an ordinary browser tab
  }
  return out;
}

function storageApi() {
  try {
    const s = typeof navigator !== 'undefined' ? navigator.storage : null;
    return s && typeof s.persisted === 'function' ? s : null;
  } catch {
    return null;
  }
}

export class KeepSafe {
  constructor(game) {
    this.game = game;
    this.persisted = null; // the browser's answer: true / false, null = unknown (no Storage API)
    this.asks = 0; // persist() calls this session
    this.estimate = null; // { usageMB, quotaMB } at boot
    this.error = null;
    this._inflight = null;
    this.ready = Promise.resolve(null); // the boot check (the title card waits for it)
  }

  /** The website version (not claude.ai, not file://): the only place any of this runs. */
  get active() {
    return hostKind() === 'web';
  }

  /** profile.keepsafe, made on first use. */
  get state() {
    const p = this.game.profile;
    if (!p.keepsafe || typeof p.keepsafe !== 'object') {
      p.keepsafe = { persisted: null, askedAt: 0, grantedAt: 0, installed: false, lastBackupAt: 0, snoozeUntil: 0, remindedAt: 0 };
    }
    return p.keepsafe;
  }

  /** At boot (game:ready): ask once, and again at the first tap or key press. */
  start() {
    if (!this.active) return;
    this.ready = this.check(true).catch(() => null);
    this._estimate();
    if (typeof window === 'undefined') return;
    const events = ['pointerdown', 'keydown', 'touchend'];
    const onGesture = () => {
      for (const e of events) window.removeEventListener(e, onGesture, true);
      // persist() is called right here, inside the gesture (not after an await)
      if (this.persisted !== true && !this._inflight) this.ready = this.check(true, { now: true }).catch(() => null);
    };
    for (const e of events) window.addEventListener(e, onGesture, { capture: true, passive: true });
  }

  /**
   * Read (and when `ask`, request) persistent storage; remember the answer. Resolves the answer
   * (true / false / null). now: call persist() at once (inside a user gesture).
   */
  check(ask = false, { now = false } = {}) {
    const s = storageApi();
    if (!s) {
      this._record(null, false);
      return Promise.resolve(null);
    }
    let asked = false;
    const persist = () => {
      if (typeof s.persist !== 'function') return Promise.resolve(false);
      asked = true;
      this.asks++;
      return Promise.resolve(s.persist());
    };
    const run = (now && ask ? persist() : Promise.resolve(s.persisted()))
      .then((kept) => (!kept && ask && !asked ? persist() : kept))
      .then((kept) => {
        this._record(kept === true, asked);
        return this.persisted;
      })
      .catch((err) => {
        this.error = String((err && err.message) || err).slice(0, 120);
        this._record(this.persisted, asked);
        return this.persisted;
      })
      .finally(() => {
        if (this._inflight === run) this._inflight = null;
      });
    this._inflight = run;
    return run;
  }

  _record(persisted, asked) {
    if (!this.active) return;
    this.persisted = persisted;
    const st = this.state;
    const before = JSON.stringify(st);
    st.persisted = persisted;
    st.installed = deviceInfo().standalone;
    if (asked) st.askedAt = Date.now();
    if (persisted && !st.grantedAt) st.grantedAt = Date.now();
    if (JSON.stringify(st) !== before) this.game.saveProfile();
  }

  _estimate() {
    try {
      const s = typeof navigator !== 'undefined' ? navigator.storage : null;
      if (!s || typeof s.estimate !== 'function') return;
      Promise.resolve(s.estimate())
        .then((e) => {
          if (e) this.estimate = { usageMB: +((e.usage || 0) / 1048576).toFixed(1), quotaMB: Math.round((e.quota || 0) / 1048576) };
        })
        .catch(() => {});
    } catch {
      // diagnostics only
    }
  }

  /** Storage that may be cleared: not kept for sure, or an iPhone/iPad browser tab. */
  get atRisk() {
    const d = deviceInfo();
    return this.persisted !== true || (d.ios && !d.standalone);
  }

  /**
   * Is a "Save a copy of your worlds" card due? `worlds` = store.listWorlds() metas. Due on the
   * website when the storage is at risk, she has worlds, "Not now" is over and the last copy
   * (or, before the first one, her oldest world) is 7 days old or more.
   */
  backupDue(worlds, now = Date.now()) {
    if (!this.active || !Array.isArray(worlds) || !worlds.length || !this.atRisk) return false;
    const st = this.state;
    if (now < (st.snoozeUntil || 0)) return false;
    let oldest = now;
    for (const w of worlds) oldest = Math.min(oldest, w.createdAt || w.updatedAt || now);
    return now - (st.lastBackupAt || oldest) >= BACKUP_EVERY_MS;
  }

  /** A world (or all of them) went into a file: the next reminder is 7 days away. */
  noteBackup(at = Date.now()) {
    if (!this.active) return;
    const st = this.state;
    st.lastBackupAt = at;
    st.snoozeUntil = 0;
    this.game.saveProfile(true);
  }

  /** "Not now": ask again in 7 days (or `ms`). */
  snooze(ms = SNOOZE_MS) {
    if (!this.active) return;
    this.state.snoozeUntil = Date.now() + ms;
    this.game.saveProfile(true);
  }

  /** The card was shown (diag and the probes read it). */
  noteReminded() {
    if (!this.active) return;
    this.state.remindedAt = Date.now();
    this.game.saveProfile();
  }

  /** For game.diag.report(). */
  report() {
    const host = hostKind();
    if (host !== 'web') return { host };
    const d = deviceInfo();
    const st = this.state;
    const day = (t) => (t ? new Date(t).toISOString().slice(0, 10) : null);
    return {
      host, ios: d.ios, standalone: d.standalone, persisted: this.persisted, asks: this.asks,
      askedAt: day(st.askedAt), lastBackupAt: day(st.lastBackupAt), snoozeUntil: day(st.snoozeUntil),
      estimate: this.estimate, error: this.error,
    };
  }
}
