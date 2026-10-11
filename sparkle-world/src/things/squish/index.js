// Squishy toys and mystery presents (wave 4, the squish team doc; docs/teams/wave4-integration.md).
//
// Puffums (slow-rise foam toys) and Stretchums (dough squeeze toys), 48 of them, come only from
// mystery presents. A present comes at milestones of coins EARNED over time (profile.stats.
// coinsEarned; spending never takes one away, opening one never costs coins). This module:
//   - 97 furniture defs: squish_<key>, squishg_<key> (the sparkly versions) and toy_shelf, in the
//     Bag's "Squish Toys" tab (right after Fun & Toys), hidden until owned; Hand tap squishes;
//   - holding: while the selected hotbar slot is a toy, the avatar holds it (the treats' rule);
//     the life HUD shows Squish! (press and hold) and Put away;
//   - the presents: a lazy milestone start (base), refresh() for everything derived, the drop
//     overlay, the Present button, the unwrap panel and the Squish Shelf (panel.js);
//   - 4 stickers, game.squish (the facade) and game.debug.squish.
// Nothing here is bought; no coin number ever sits next to a present.

import * as D from './data.js';
import { toyModel, heldToy, sharedToy, clearShared, toyShelf, SHELF_COLORS } from './models.js';
import { presser } from './anim.js';
import { squishSfx } from './sfx.js';
import { STICKER_ART } from './art.js';
import { addSquishTab, TAB } from './tab.js';
import { lifeHud } from '../pets/kit.js';
import { partsOf } from '../furniture/kit.js';
import { disposeObject } from '../../core/models.js';
import { installPanels } from './panel.js';
import { sheetRenderer } from './sheet.js';
import { preview } from '../pets/preview.js';

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const SHELF = 'toy_shelf';
const DROP_EVERY = 180; // seconds: at most one drop per 3 minutes
const AFTER_TIPS = 90; // seconds of play before a drop comes even if the tips are still going

export function install(game) {
  const E = game.entities;
  const items = game.registry.items;
  const ev = game.events;
  const bot = typeof navigator !== 'undefined' && !!navigator.webdriver;
  const remote = () => !!(game.net && game.net.remoteApplying);
  const profile = () => game.profile;
  /** profile.squish, read fresh every time (a 409 merge replaces the object). */
  const sq = () => (profile() && isObj(profile().squish) ? profile().squish : null);
  const style = () => {
    try {
      const s = typeof game.surpriseStyle === 'function' ? game.surpriseStyle() : null;
      return s === 'girl' || s === 'boy' ? s : null;
    } catch {
      return null;
    }
  };

  // the presents and the ring's moving bits are off on automated browsers unless asked
  let presentsOn = !bot;

  addSquishTab();

  // ---------------- furniture: 96 toys and the Toy Shelf ----------------

  // a placed toy rebuilds with its meshes in part `toy` while it is being squished (else batched)
  const LIVE = new WeakSet();
  if (E) {
    E.define({
      key: SHELF,
      name: D.STRINGS.shelfItem,
      category: TAB,
      size: [2, 1, 1],
      colors: SHELF_COLORS,
      placeOn: 'floor',
      surface: 0.98,
      colliders: [[0, 0, 0.05, 2, 0.98, 1]],
      build: (color) => toyShelf(color),
    });
    for (const glitter of [false, true]) {
      for (const it of D.ITEMS) {
        const key = D.defKey(it.key, glitter);
        E.define({
          key,
          name: it.name,
          category: TAB,
          size: [1, 1, 1],
          colliders: 'none',
          placeOn: 'table',
          actions: ['squish'],
          defaultData: {},
          build: (color, data) => toyModel(it.key, { glitter, live: !!data && LIVE.has(data) }),
          update: (entity) => tickWorldToy(entity),
        });
        const item = items.get('furn:' + key);
        if (item) {
          item.hidden = true;
          item.order = glitter ? 2 : 1;
          item.squish = { key: it.key, glitter };
          item.icon = () => toyIcon(it.key, glitter);
        }
      }
    }
    const shelfItem = items.get('furn:' + SHELF);
    if (shelfItem) {
      shelfItem.hidden = true;
      shelfItem.order = 0;
    }

    // a Hand tap on a placed toy plays the whole squash and rise
    E.registerAction('squish', {
      run(g, entity) {
        const it = D.parseDefKey(entity.key);
        const t = it && D.item(it.key);
        if (!t) return false;
        LIVE.add(entity.data);
        const press = presser(t.kind);
        press.tap();
        entity._squish = { press, kind: t.kind, at: performance.now() };
        E.refresh(entity);
        squishSfx(game, 'squish');
        squishSfx(game, t.kind === 'puff' ? 'rise' : 'stretch');
        const p = E.localToWorld(entity, 0.5, 0.5, 0.5);
        if (game.particles) game.particles.emit(t.kind === 'puff' ? 'heart' : 'sparkle', p, { count: t.kind === 'puff' ? 3 : 5, color: t.colors[0] });
        squeezed(it.key, it.glitter, 'world');
        return true;
      },
      hint: () => D.STRINGS.hint,
    });
  }

  function tickWorldToy(entity) {
    const s = entity._squish;
    if (!s) return;
    const c = s.press.step();
    const toy = partsOf(entity).toy;
    if (c && toy) toy.scale.set(c.sx, c.sy, c.sx);
    if (s.kind === 'stretch' && !s.snapped && s.press.busy && performance.now() - s.at > 1100) {
      s.snapped = true;
      squishSfx(game, 'snap');
    }
    if (!c) {
      entity._squish = null;
      LIVE.delete(entity.data);
      E.refresh(entity);
    }
  }

  /** The toy's 96 px picture (front view); priority 'high' for cubbies on screen (as the Bag asks). */
  function toyIcon(key, glitter = false, priority = undefined) {
    const id = key + (glitter ? ':g' : '');
    const p = pics.get(id);
    if (p) return p;
    return thumbIcon(key, glitter, priority);
  }
  const thumbIcon = (key, glitter, priority) => game.thumbs.get('squish:' + key + (glitter ? ':g' : ''), () => toyModel(key, { glitter, hitbox: false }), { dir: [0.4, 0.45, 1.5], priority });

  // the shelf's pictures in batches on the thumbnail renderer (sheet.js); the thumbnail queue
  // is the fallback
  const sheet = sheetRenderer(game.thumbs);
  const pics = new Map(); // 'key' | 'key:g' -> Promise<dataURL>
  const picQueue = [];
  let picBatch = 1;
  /** Ask for these pictures ([{ key, glitter }]) to be drawn in batches, soon. */
  function queuePics(list) {
    for (const { key, glitter } of list) {
      const id = key + (glitter ? ':g' : '');
      if (pics.has(id) || game.thumbs.has('squish:' + id) || !D.item(key)) continue;
      let resolve;
      pics.set(id, new Promise((r) => { resolve = r; }));
      picQueue.push({ key, glitter: !!glitter, id, resolve });
    }
  }
  function pumpPics() {
    // the batches that have come back first (sheet.collect never waits for the GPU)
    for (const { jobs, urls } of sheet.collect()) {
      jobs.forEach((j, i) => {
        if (urls[i]) j.resolve(urls[i]);
        else thumbIcon(j.key, j.glitter).then(j.resolve);
      });
    }
    if (!picQueue.length) return;
    if (!sheet.ready()) {
      // no thumbnail renderer yet (nothing pictured so far): the queue makes one
      for (const j of picQueue.splice(0)) thumbIcon(j.key, j.glitter).then(j.resolve);
      return;
    }
    // the first batch small (a see-through shell's shader may still compile), then 6 a frame,
    // with at most 3 batches on their way back at once (the GPU draws them alongside the game's frames)
    if (sheet.prepare(picQueue.slice(0, picBatch))) return;
    if (sheet.inFlight() >= 3) return;
    const batch = picQueue.splice(0, picBatch);
    let started = false;
    try {
      started = sheet.start(batch);
    } catch (err) {
      console.warn('[squish] shelf pictures failed', err && err.message);
    }
    picBatch = 6;
    if (!started) for (const j of batch) thumbIcon(j.key, j.glitter).then(j.resolve);
  }

  // The shelf's shaders before the shelf opens. A toy's new shader program links on demand the
  // first time it is used, in one go (on the GPU-less test machine the see-through shell's took
  // one frame of about 1.1 s, right after the shelf opened; it cannot be split, and there is no
  // parallel-compile extension there). So once she owns a toy, sheet.prepare() runs ahead of
  // time: behind the loading screen while a world loads, otherwise in play frames with no other
  // pictures or chunks waiting. Opening the shelf before it is done just carries on from there.
  let shelfWarm = false;
  function warmShelf() {
    if (shelfWarm || picQueue.length || !sheet.ready()) return;
    const p = profile();
    if (!p || !(D.owned(p) || D.ownedGlitter(p))) return;
    if (!game.loading && (game.mode !== 'play' || game.thumbs.pending > 0 || (game.chunks && game.chunks.pending > 0))) return;
    if (!sheet.prepare([])) shelfWarm = true;
  }

  // ---------------- counting squeezes ----------------

  function squeezed(key, glitter, where) {
    if (remote()) return;
    const p = profile();
    if (!p) return;
    p.stats = p.stats || {};
    p.stats.squishes = (Number.isFinite(p.stats.squishes) ? p.stats.squishes : 0) + 1;
    game.saveProfile();
    ev.emit('squish:squeeze', { key, glitter: !!glitter, where });
    checkStickers();
  }

  // ---------------- holding a toy ----------------

  let heldDef = null, heldObj = null, heldAv = null, seenAv = null;
  let dirtyHold = true;
  let handPress = null; // presser for the held toy
  const avatar = () => (game.player && game.player.avatar) || null;
  const canHold = (av) => !!av && typeof av.hold === 'function';

  /** The toy she should hold: the selected hotbar item, while she owns it. */
  function wanted() {
    if (game.mode !== 'play' || !game.player || !game.hotbar) return null;
    const key = game.hotbar.slots[game.hotbar.index];
    if (!key || !key.startsWith('furn:squish')) return null;
    const d = D.parseDefKey(key.slice(5));
    return d && D.item(d.key) && D.has(profile(), d.key, d.glitter) ? key.slice(5) : null;
  }

  function letGo() {
    if (heldAv && canHold(heldAv) && heldAv.held === heldObj) heldAv.hold(null);
    if (heldObj) disposeObject(heldObj);
    heldObj = null;
    heldDef = null;
    heldAv = null;
    handPress = null;
  }

  function syncHold() {
    dirtyHold = false;
    const av = avatar();
    seenAv = av;
    if (game.treats && game.treats.eating) return; // the treat takes the hand
    const k = canHold(av) ? wanted() : null;
    if (k === heldDef && av === heldAv && (!heldObj || av.held === heldObj)) return;
    letGo();
    if (!k) return;
    const d = D.parseDefKey(k);
    heldObj = heldToy(d.key, d.glitter);
    heldDef = k;
    heldAv = av;
    handPress = presser(D.item(d.key).kind);
    av.hold(heldObj, 'hold');
  }

  const inWater = () => {
    const pl = game.player;
    // on a dolphin without a tail (Just Me) she holds the toy, as on a pony (avatar.js heldBone);
    // player.swimming stays as it was while she rides, so it does not count there
    if (pl && pl.state === 'ride' && pl.mountPet && pl.mountPet.kind === 'dolphin' && !pl.seaForm) return false;
    return !!(pl && (pl.swimming || pl.seaForm));
  };

  /** "Hold it": the toy in a hotbar slot (its own, an empty one, or this one), then the Hand tool. */
  function hold(key, glitter = false, { quiet = false } = {}) {
    if (!D.has(profile(), key, glitter) || !game.hotbar) return false;
    const itemKey = 'furn:' + D.defKey(key, glitter);
    let slot = game.hotbar.slots.indexOf(itemKey);
    if (slot < 0) slot = game.hotbar.slots.indexOf(null);
    if (slot < 0) slot = game.hotbar.index;
    game.setSlot(slot, itemKey);
    game.setTool('hand');
    dirtyHold = true;
    syncHold();
    // Squish! and Put away show with the toast, not on the next frame (a slow frame on a big
    // screen without a GPU was 600-800 ms of no buttons)
    showHud();
    if (!quiet) {
      squishSfx(game, 'squish', { volume: 0.6 });
      // in the water the toy hides in her hand (wave-4 integration §1.2): the existing line
      if (inWater()) game.toast(D.STRINGS.holdWater, { icon: 'heart', key: 'squish-hold' });
      else game.toast(D.fmt('holding', { name: D.item(key).name }), { icon: 'heart', key: 'squish-hold' });
    }
    return true;
  }

  function putAway() {
    if (!heldDef || !game.hotbar) return false;
    const i = game.hotbar.index;
    if (game.hotbar.slots[i] === 'furn:' + heldDef) game.setSlot(i, null);
    letGo();
    dirtyHold = true;
    showHud();
    squishSfx(game, 'rustle');
    game.toast(D.STRINGS.away, { icon: 'check', key: 'squish-hold' });
    return true;
  }

  /** Is the held toy showing (not while she swims or has a tail; merfolk's avatar getter)? */
  const heldShows = () => {
    const av = avatar();
    return !!heldObj && !(av && av.heldShown === false);
  };

  const handDown = () => {
    if (!heldObj || !handPress || !heldShows()) return;
    handPress.press();
    const d = D.parseDefKey(heldDef);
    squishSfx(game, 'squish');
    squeezed(d.key, d.glitter, 'hand');
  };
  const handUp = () => {
    if (!handPress || !handPress.held) return;
    handPress.release();
    const d = heldDef && D.parseDefKey(heldDef);
    if (d) squishSfx(game, D.item(d.key).kind === 'puff' ? 'rise' : 'stretch');
  };
  const handTap = () => {
    if (!heldObj || !handPress || !heldShows()) return;
    const d = D.parseDefKey(heldDef);
    handPress.tap();
    squishSfx(game, 'squish');
    squeezed(d.key, d.glitter, 'hand');
  };

  // ---------------- the life HUD: Present, Squish!, Put away ----------------

  const hud = game.ui ? lifeHud(game) : null;
  let presentBtn = null, squishBtn = null, awayBtn = null;
  if (hud) {
    presentBtn = hud.add('present', { icon: 'present', label: D.STRINGS.hudPresent, color: 'var(--sw-lav)', order: 5, onClick: () => panels.openPresent() });
    presentBtn.classList.add('sq-hud-present');
    const badge = game.ui.el('span', 'sq-badge');
    badge.hidden = true;
    presentBtn.querySelector('.sw-round-face').appendChild(badge);
    squishBtn = hud.add('squish', { icon: 'squish', label: D.STRINGS.hudSquish, color: 'var(--sw-pink)', order: 32, onClick: (e) => { if (e && e.detail === 0) handTap(); } });
    awayBtn = hud.add('squish-away', { icon: 'shelf', label: D.STRINGS.hudAway, color: 'var(--sw-lav)', order: 33, onClick: () => putAway() });
    squishBtn.classList.add('sq-hud-squish');
    awayBtn.classList.add('sq-hud-away');
    // press and hold: a Puffum stays flat while held, a Stretchum stretches; let go to see it rise
    squishBtn.style.touchAction = 'none';
    squishBtn.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      try { squishBtn.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      handDown();
    });
    for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) squishBtn.addEventListener(t, () => handUp());
    squishBtn.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  const shown = { present: false, squish: false, away: false, count: -1 };
  function showHud() {
    if (!hud) return;
    const play = game.mode === 'play';
    const holding = !!heldObj && play;
    const sq1 = holding && heldShows();
    if (sq1 !== shown.squish) { shown.squish = sq1; hud.show('squish', sq1); }
    if (holding !== shown.away) { shown.away = holding; hud.show('squish-away', holding); }
    const n = play && presentsOn ? state.ready : 0;
    const on = n > 0;
    if (on !== shown.present) {
      shown.present = on;
      hud.show('present', on);
      presentBtn.classList.toggle('lf-pulse', on);
    }
    if (n !== shown.count) {
      shown.count = n;
      const b = presentBtn.querySelector('.sq-badge');
      b.hidden = n < 2;
      b.textContent = n > 1 ? String(n) : '';
    }
  }

  // ---------------- presents: base, refresh, drop ----------------

  const state = { ready: 0, sig: '', lastReady: 0 };
  let baseBusy = false;

  /** Create profile.squish (lazily, in play) with its milestone start. */
  async function ensureBase() {
    if (baseBusy || remote()) return;
    const p = profile();
    if (!p || game.mode !== 'play') return;
    if (sq() && D.hasValidBase(p)) return;
    baseBusy = true;
    try {
      if (game.store && game.store.reconciled) await game.store.reconciled;
    } catch { /* offline is fine: the base is then provisional */ }
    baseBusy = false;
    const q = profile();
    if (!q || game.mode !== 'play' || remote()) return;
    if (!isObj(q.squish)) q.squish = { v: 1, got: {}, glit: {}, seen: {} };
    const s = q.squish;
    for (const k of ['got', 'glit', 'seen']) if (!isObj(s[k])) s[k] = {};
    if (!D.hasValidBase(q)) s.base = D.makeBase(q, new Date().toISOString(), { prov: !!(game.store && game.store.profileStale) });
    game.saveProfile();
    refresh();
  }

  const knownSig = (p) => {
    const s = sq();
    const n = s ? (isObj(s.got) ? Object.keys(s.got).length : 0) + (isObj(s.glit) ? Object.keys(s.glit).length : 0) : -1;
    return `${n}|${D.earned(p)}|${s && s.base ? s.base.at + ':' + s.base.coins : ''}|${s && s.rest ? s.rest.n : ''}`;
  };

  /** Everything derived from profile.squish (the squish team doc §6.7). */
  function refresh() {
    const p = profile();
    if (!p) return;
    const s = sq();
    // the Bag: owned toys (and the Toy Shelf with the first toy) show; everything else hides
    const got = s && isObj(s.got) ? s.got : {};
    const glit = s && isObj(s.glit) ? s.glit : {};
    let any = false;
    for (const it of D.ITEMS) {
      const a = items.get('furn:' + D.defKey(it.key, false));
      const b = items.get('furn:' + D.defKey(it.key, true));
      if (a) a.hidden = !(it.key in got);
      if (b) b.hidden = !(it.key in glit);
      if (it.key in got) any = true;
    }
    const shelfItem = items.get('furn:' + SHELF);
    if (shelfItem) shelfItem.hidden = !any;
    // profile-changing parts: never from a friend's change
    if (s && !remote() && game.mode === 'play') {
      // a provisional base made real in an online session (capped: at most 3 ready)
      if (s.base && s.base.prov && game.store && game.store.profileStale === false && D.hasValidBase(p)) {
        s.base = D.promoteBase(p);
        game.saveProfile();
      }
      const rest = D.restFor(p);
      if (rest && (!isObj(s.rest) || s.rest.n !== rest.n || s.rest.coins !== rest.coins) && (!isObj(s.rest) || rest.n >= s.rest.n)) {
        s.rest = rest;
        game.saveProfile();
      }
    }
    const r = s && D.hasValidBase(p) ? D.ready(p) : 0;
    if (r > state.ready && r > 0) ev.emit('present:ready', { ready: r });
    if (r > state.ready) dropWanted = true;
    state.ready = r;
    state.sig = knownSig(p);
    checkStickers();
    showHud();
    ev.emit('squish:refresh', {});
  }

  function checkStickers() {
    if (remote() || game.mode !== 'play' || !game.stickers) return;
    const p = profile();
    if (!p) return;
    const owned = D.owned(p);
    if (owned >= 1) game.award('squish_first');
    if (owned >= 10) game.award('squish_ten');
    if (owned >= D.ITEMS.length) game.award('squish_all');
    if ((p.stats && p.stats.squishes) >= 25) game.award('squish_squeeze');
  }

  // ---------------- the drop ----------------

  // wall-clock times (ms): a slow page's frame time is capped, the kid's seconds are not
  let dropWanted = false, clearSince = 0, playFor = 0, lastDrop = -Infinity;
  const nowMs = () => performance.now();

  /** The present path's ring for the HUD: { frac, state: 'fill' | 'near' | 'ready' | 'done' }. */
  function ring() {
    const p = profile();
    if (!p || !sq() || !D.hasValidBase(p)) {
      // before the first world load the base is not made yet: the path starts at 0
      const e = p ? D.earned(p) : 0;
      return { frac: 0, state: 'fill', e };
    }
    const inFlight = Math.max(0, (p.coins || 0) - (game.coins ? game.coins.shown : p.coins || 0));
    const g = D.progress(p, inFlight);
    if (g === 'done') return { frac: 1, state: 'done' };
    if (g === 'ready') return { frac: 1, state: presentsOn ? 'ready' : 'fill' };
    return { frac: g, state: g >= 0.8 ? 'near' : 'fill' };
  }

  // ---------------- the facade and the panels ----------------

  const S = {
    game,
    D,
    sq,
    style,
    profile,
    refresh,
    hold,
    toyIcon,
    queuePics,
    squeezed,
    get presentsOn() { return presentsOn; },
    get ready() { return state.ready; },
    heldShows,
    commit,
    sfx: (name, o) => squishSfx(game, name, o),
  };
  const panels = installPanels(game, S);

  /**
   * Open the next present (the commit, §6.5): got[key] (or glit[pick]) = now, an immediate
   * save, refresh, 'squish:get'. Returns { key, glitter, n, first } or null.
   */
  async function commit(pickKey = null) {
    const p = profile();
    if (!p || remote()) return null;
    if (state.ready <= 0) return null;
    const next = D.nextItem(p, style());
    if (!next) return null;
    let key = next.key;
    if (next.glitter && pickKey && D.has(p, pickKey) && !D.has(p, pickKey, true)) key = pickKey;
    const s = p.squish;
    const first = next.glitter ? false : !D.ITEMS.some((it) => it.kind === D.item(key).kind && it.key in (s.got || {}));
    const at = new Date().toISOString();
    if (next.glitter) (s.glit || (s.glit = {}))[key] = at;
    else (s.got || (s.got = {}))[key] = at;
    const save = game.saveProfile(true);
    refresh();
    const n = D.opened(p);
    ev.emit('squish:get', { key, glitter: next.glitter, n });
    try { await save; } catch { /* saved again later */ }
    return { key, glitter: next.glitter, n, first };
  }

  game.squish = {
    /** The def key in her hand (presence `hi`), or null. */
    held: () => (heldObj ? heldDef : null),
    /** A new Object3D of a held toy for a def key (friends' hands), or null. */
    model(defk) {
      const d = D.parseDefKey(defk);
      if (!d || !D.item(d.key)) return null;
      try {
        return heldToy(d.key, d.glitter);
      } catch {
        return null;
      }
    },
    ring,
    /** The coin pill's aria-label. */
    pillLabel: (n) => D.fmt('pillLabel', { n }),
    /** May the ring wiggle, hop and sparkle (off on automated browsers unless asked)? */
    animOk: () => presentsOn,
    get ready() { return state.ready; },
    open: () => game.ui && game.ui.open('squish'),
    hold,
    putAway,
    toyIcon,
    shelfButton: (opts) => panels.shelfButton(opts),
    refresh,
  };
  game.registerAction('squish', (g) => g.ui && g.ui.toggle('squish'));

  // ---------------- stickers (book order: squish's 4 after the older teams') ----------------

  const reg = game.registry.stickers;
  ev.on('game:ready', () => {
    for (const [id, name, hint] of D.STICKERS) if (reg && !reg.has(id)) reg.set(id, { id, name, hint, icon: 'heart', art: STICKER_ART[id] });
  });

  // ---------------- events ----------------

  ev.on('game:ready', refresh);
  ev.on('profile:changed', () => { dirtyHold = true; refresh(); });
  ev.on('coins:change', refresh);
  ev.on('coins:shown', () => ev.emit('squish:refresh', {}));
  ev.on('squish:get', () => { dirtyHold = true; });
  ev.on('ui:open', ({ panel }) => { if (panel === 'bag' || panel === 'squish') refresh(); });
  ev.on('hotbar:change', () => { dirtyHold = true; });
  ev.on('world:load', () => {
    dirtyHold = true;
    playFor = 0;
    ensureBase();
    refresh();
  });
  ev.on('world:unload', () => {
    letGo();
    panels.hideDrop();
    clearShared();
  });
  ev.on('entity:place', ({ entity }) => {
    if (!entity || remote() || !/^squish/.test(entity.key)) return;
    if (game.mode !== 'play' || !game.store || game.store.deviceGet('squishPlaceTip')) return;
    game.store.deviceSet('squishPlaceTip', 1);
    game.toast(D.STRINGS.placeTip, { icon: 'heart', key: 'squish-place' });
  });

  game.addSystem({
    name: 'squish-presents',
    update(dt) {
      // the held toy (the treats' pattern)
      const av = avatar();
      if (dirtyHold || av !== seenAv || (heldObj && heldAv && heldAv.held !== heldObj)) syncHold();
      if (heldObj && handPress) {
        const c = handPress.step(dt);
        const toy = heldObj.userData.parts && heldObj.userData.parts.toy;
        if (toy) {
          if (c) toy.scale.set(c.sx, c.sy, c.sx);
          else if (toy.scale.y !== 1) toy.scale.set(1, 1, 1);
        }
      }
      // the 1 s signature check (a 409 merge replaces profile.squish without an event)
      if (performance.now() >= sigAt) {
        sigAt = performance.now() + 1000;
        const p = profile();
        if (p && knownSig(p) !== state.sig) refresh();
        if (game.mode === 'play' && !sq() && p) ensureBase();
      }
      showHud();
      panels.tick(dt);
      pumpPics();
      warmShelf();
      // the drop: one comparison unless one is wanted
      if (!dropWanted) return;
      if (game.mode === 'play' && !game.paused) playFor += dt;
      if (!presentsOn || state.ready <= 0) { if (state.ready <= 0) dropWanted = false; return; }
      const coinsBusy = game.coins && (game.coins.giftShowing || game.coins.shown !== game.coins.value);
      const tipsDone = (profile() && profile().tutorialDone) || playFor > AFTER_TIPS;
      const busy = panels.dropBlocked() || coinsBusy || !tipsDone || !game.world;
      const t = nowMs();
      if (busy) clearSince = 0;
      else if (!clearSince) clearSince = t;
      if (clearSince && t - clearSince >= 1500 && t - lastDrop >= DROP_EVERY * 1000) {
        dropWanted = false;
        lastDrop = t;
        clearSince = 0;
        panels.showDrop();
      }
    },
    onWorldUnload() {
      letGo();
    },
  });
  let sigAt = 0;

  // ---------------- debug (probes) ----------------

  if (game.debug) {
    game.debug.squish = {
      state() {
        const p = profile();
        const s = sq() || {};
        return {
          got: { ...(s.got || {}) },
          glit: { ...(s.glit || {}) },
          seen: { ...(s.seen || {}) },
          base: s.base ? { ...s.base } : null,
          rest: s.rest ? { ...s.rest } : null,
          earned: D.earned(p),
          reached: D.reached(p),
          opened: D.opened(p),
          ready: state.ready,
          toNext: D.toNext(p),
          progress: D.progress(p, Math.max(0, (p.coins || 0) - (game.coins ? game.coins.shown : 0))),
          held: game.squish.held(),
          squishes: (p.stats && p.stats.squishes) || 0,
        };
      },
      /** Allow the drop, the Present button and the ring animation on an automated browser. */
      presents(on = true) {
        presentsOn = !!on;
        lastDrop = -Infinity;
        if (on && state.ready > 0) dropWanted = true;
        refresh();
        return presentsOn;
      },
      /** A toy without a present (scenes only). */
      give(key, { glitter = false } = {}) {
        const p = profile();
        if (!D.item(key) || !p) return false;
        if (!isObj(p.squish)) p.squish = { v: 1, got: {}, glit: {}, seen: {} };
        const at = new Date().toISOString();
        p.squish.got[key] = p.squish.got[key] || at;
        if (glitter) (p.squish.glit || (p.squish.glit = {}))[key] = p.squish.glit[key] || at;
        game.saveProfile();
        refresh();
        return true;
      },
      giveAll({ glitter = false } = {}) {
        for (const it of D.ITEMS) game.debug.squish.give(it.key, { glitter });
        return D.owned(profile());
      },
      open: () => panels.openPresent(),
      tapPresent: () => panels.tapPresent(),
      pick: (key) => panels.pick(key),
      /** Press the held / first placed / shown toy for ms (0 = a tap). Resolves when let go. */
      async squeeze(where = 'hand', ms = 0) {
        if (where === 'world') {
          const e = E && E.all().find((x) => /^squishg?_/.test(x.key));
          if (!e) return false;
          return E.use(e, null);
        }
        if (where === 'shelf') return panels.squeezeShown(ms);
        if (!heldObj) return false;
        if (!ms) { handTap(); return true; }
        handDown();
        await new Promise((r) => setTimeout(r, ms));
        handUp();
        return true;
      },
      order: (st = null) => {
        const p = { squish: { got: {}, glit: {} } };
        const out = [];
        for (let i = 0; i < D.presentsTotal(); i++) {
          const n = D.nextItem(p, st);
          if (!n) break;
          out.push(n.key);
          (n.glitter ? p.squish.glit : p.squish.got)[n.key] = 1;
        }
        return out;
      },
      /** The held toy's part scale y (probes). */
      handSy: () => (heldObj && handPress ? handPress.peek() : null),
      /** The drop's clocks (probes). */
      dropState: () => ({ wanted: dropWanted, clearSince, lastDrop, presentsOn, playFor }),
      /** Meshes left under the shared stage's preview pivot (probes: 0 once panels close). */
      stagePivot() {
        let n = 0;
        preview(game).pivot.traverse((o) => { if (o.geometry) n++; });
        return n;
      },
      /** A toy's height in blocks (its model without the hitbox). */
      toyHeight(key) {
        const m = toyModel(key, { hitbox: false });
        let lo = Infinity, hi = -Infinity;
        m.updateMatrixWorld(true);
        m.traverse((o) => {
          if (!o.isMesh) return;
          o.geometry.computeBoundingBox();
          const b = o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld);
          lo = Math.min(lo, b.min.y);
          hi = Math.max(hi, b.max.y);
        });
        disposeObject(m);
        return hi - lo;
      },
      /** A squishable model (grids, probes). */
      model: (key, glitter = false) => sharedToy(key, glitter),
      panels,
    };
  }
}
