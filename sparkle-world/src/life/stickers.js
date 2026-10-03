// Stickers (achievements): the sticker registry (game.registry.stickers), progress counters in
// profile.stats and game.stickers.award(id). Every sticker in DESIGN.md is wired to its event
// here. Awarding pops a big glossy sticker picture ("New sticker!") that flies off toward the
// Sticker Book, plays a jingle with confetti, and emits 'sticker:earned' { sticker }.
// game.stickers: { has, award, count, total, all(), canvas(id, { locked }), shape(id),
// image(id, { locked, size }), unseen(), markSeen() }. Other modules may add stickers:
// registry.stickers.set(id, { id, name, hint, icon, art?(ctx) }) and call game.award(id).

import { stickerImage, stickerCanvas, stickerShape } from './sticker-art.js';

const STICKERS = [
  ['first_block', 'First Block', 'Place your very first block', 'star'],
  ['builder', 'Super Builder', 'Place 100 blocks', 'build'],
  ['home_sweet_home', 'Home Sweet Home', 'Put a bed and a door in the same world', 'home'],
  ['sweet_dreams', 'Sweet Dreams', 'Sleep in a bed', 'moon'],
  ['best_friends', 'Best Friends', 'Adopt a pet', 'heart'],
  ['pet_lover', 'Pet Lover', 'Pet your pets 10 times', 'heart'],
  ['little_chef', 'Little Chef', 'Cook something yummy', 'star'],
  ['master_chef', 'Master Chef', 'Cook every recipe', 'star'],
  ['green_thumb', 'Green Thumb', 'Harvest a plant', 'star'],
  ['fashionista', 'Fashionista', 'Change your outfit 5 times', 'dress'],
  ['gem_hunter', 'Gem Hunter', 'Find 10 gems', 'gem'],
  ['gem_master', 'Gem Master', 'Find all the gems in a world', 'gem'],
  ['rainbow_maker', 'Rainbow Maker', 'Place all 7 rainbow colors', 'star'],
  ['night_owl', 'Night Owl', 'See the stars at night', 'moon'],
  ['musician', 'Musician', 'Play 20 piano notes', 'music'],
  ['photographer', 'Photographer', 'Take a photo', 'photo'],
  ['unicorn_rider', 'Unicorn Rider', 'Ride a unicorn', 'star'],
  ['magic_builder', 'Magic Builder', 'Place a Magic House', 'home'],
  ['world_maker', 'World Maker', 'Create 3 worlds', 'star'],
  ['splash', 'Splash!', 'Go swimming', 'star'],
  ['sky_high', 'Sky High', 'Fly above the clouds', 'fly'],
];

const CSS = /* css */ `
.sw-stkpop { position: absolute; left: 50%; top: calc(16% + var(--sw-safe-t)); z-index: 45; pointer-events: none !important;
  display: flex; flex-direction: column; align-items: center; transform: translateX(-50%); }
.sw-stkpop-art { position: relative; width: 170px; height: 170px; display: grid; place-items: center; animation: sw-stkpop-in .7s var(--sw-bounce) both; }
/* rays + a soft glow; only transform / opacity animate, so the compositor does the work */
.sw-stkpop-rays { position: absolute; left: -46px; top: -46px; width: calc(100% + 92px); height: calc(100% + 92px); will-change: transform; animation: sw-stkpop-spin 8s linear infinite; }
.sw-stkpop-art .sw-stk-art { position: relative; width: 170px; height: 170px; will-change: transform; animation: sw-stkpop-wiggle 1.6s ease-in-out .7s infinite; }
.sw-stkpop-label { margin-top: 2px; padding: 8px 22px 10px; border-radius: 999px; text-align: center; line-height: 1.05;
  background: linear-gradient(#FFFDF2, #FFF1C9); border: 4px solid var(--sw-sun); box-shadow: 0 6px 18px var(--sw-shadow);
  animation: sw-pop .45s var(--sw-bounce) .25s both; }
.sw-stkpop-label small { display: block; font-size: 15px; font-weight: 700; color: #E08A00; letter-spacing: .5px; }
.sw-stkpop-label b { display: block; font-size: 27px; color: var(--sw-ink); font-weight: 700; }
.sw-stkpop.sw-away { animation: sw-stkpop-away .75s cubic-bezier(.6,-0.3,.7,.4) forwards; }
@keyframes sw-stkpop-in { 0% { transform: scale(.1) rotate(-30deg); opacity: 0; } 70% { transform: scale(1.12) rotate(6deg); opacity: 1; } 100% { transform: scale(1) rotate(-3deg); } }
@keyframes sw-stkpop-spin { to { transform: rotate(360deg); } }
@keyframes sw-stkpop-wiggle { 0%, 100% { transform: rotate(-3deg) scale(1); } 50% { transform: rotate(3deg) scale(1.04); } }
@keyframes sw-stkpop-away { 0% { transform: translateX(-50%) scale(1); opacity: 1; } 100% { transform: translate(34vw, -22vh) scale(.12); opacity: 0; } }
@media (max-width: 600px) {
  .sw-stkpop { top: calc(20% + var(--sw-safe-t)); }
  .sw-stkpop-art, .sw-stkpop-art .sw-stk-art { width: 130px; height: 130px; }
  .sw-stkpop-label b { font-size: 22px; }
}
`;

export function install(game) {
  const reg = game.registry.stickers;
  for (const [id, name, hint, icon] of STICKERS) {
    if (!reg.has(id)) reg.set(id, { id, name, hint, icon });
  }

  const stats = () => game.profile.stats;
  const bump = (key, by = 1) => {
    const s = stats();
    s[key] = (s[key] || 0) + by;
    return s[key];
  };

  // ---------- the "New sticker!" pop ----------
  const queue = [];
  let showing = false;
  let rays = null;
  /** Soft pastel sun rays behind the sticker, painted once (a canvas: no pixel read-back). */
  const raysCanvas = () => {
    if (!rays) {
      const S = 256;
      rays = document.createElement('canvas');
      rays.width = rays.height = S;
      const g = rays.getContext('2d');
      const cols = ['rgba(255,226,120,0.8)', 'rgba(200,184,255,0.7)', 'rgba(255,190,225,0.75)'];
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        g.fillStyle = cols[i % 3];
        g.beginPath();
        g.moveTo(S / 2, S / 2);
        g.arc(S / 2, S / 2, S / 2, a - 0.13, a + 0.13);
        g.closePath();
        g.fill();
      }
      // fade the rays out toward the edge and add a warm glow in the middle
      g.globalCompositeOperation = 'destination-in';
      const fade = g.createRadialGradient(S / 2, S / 2, S * 0.1, S / 2, S / 2, S / 2);
      fade.addColorStop(0, 'rgba(0,0,0,1)');
      fade.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = fade;
      g.fillRect(0, 0, S, S);
      g.globalCompositeOperation = 'source-over';
      const glow = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S * 0.36);
      glow.addColorStop(0, 'rgba(255,252,230,0.95)');
      glow.addColorStop(1, 'rgba(255,245,210,0)');
      g.fillStyle = glow;
      g.fillRect(0, 0, S, S);
    }
    const c = document.createElement('canvas');
    c.width = c.height = rays.width;
    c.className = 'sw-stkpop-rays';
    c.getContext('2d').drawImage(rays, 0, 0);
    return c;
  };
  // The pop waits while anything covers the world (a panel such as the photo polaroid, the
  // piano or the Bag, a dialog, the camera countdown, the loading card or a fade), then shows
  // once the world has been clear for a moment, so it never sits on top of what she is looking
  // at. Its jingle and confetti come with it. If a panel opens while it is up, it steps aside
  // (and comes back later if she hardly saw it).
  const SETTLE_MS = 500; // the world must be clear this long before a pop shows
  const HOLD_MS = 2900; // how long a pop stays before it flies to the Sticker Book
  const AWAY_MS = 760;
  let cur = null; // { el, def, at, timer }
  let clearSince = null;
  const blocked = () => {
    const ui = game.ui;
    if (!ui) return true;
    return !!(ui.current || ui.dialogOpen || document.hidden ||
      (game.container && game.container.classList.contains('sw-photo-mode')) ||
      (ui.loadingEl && ui.loadingEl.classList.contains('sw-open')) ||
      (ui.fader && ui.fader.classList.contains('sw-on')));
  };
  const finishPop = (pop) => {
    clearTimeout(pop.timer);
    if (pop.el) pop.el.remove();
    if (cur === pop) {
      cur = null;
      showing = false;
    }
  };
  const flyAway = (pop) => {
    clearTimeout(pop.timer);
    if (!pop.el) return finishPop(pop);
    pop.el.classList.add('sw-away');
    pop.timer = setTimeout(() => finishPop(pop), AWAY_MS);
  };
  const showNext = () => {
    const ui = game.ui;
    if (showing || !queue.length || !ui) return;
    const def = queue.shift();
    // already admired in the Sticker Book (she opened it while the pop was waiting)
    const seen = game.profile.stickersSeen || {};
    if (seen[def.id]) return showNext();
    showing = true;
    let el = null;
    try {
      el = ui.el('div', 'sw-stkpop');
      const art = ui.el('div', 'sw-stkpop-art');
      art.appendChild(raysCanvas());
      const img = stickerCanvas(def.id, def);
      art.appendChild(img);
      const label = ui.el('div', 'sw-stkpop-label');
      label.append(ui.el('small', '', 'NEW STICKER!'), ui.el('b', '', def.name));
      el.append(art, label);
      ui.root.appendChild(el);
    } catch (err) {
      console.warn('[stickers] popup failed', err);
      el = null;
      const bang = /[!?.]$/.test(def.name) ? '' : '!';
      ui.toast(`New sticker: ${def.name}${bang}`, { icon: def.icon || 'sticker', big: true, color: 'sun' });
    }
    game.audio.play('success');
    if (game.player && game.mode === 'play') {
      const p = game.player.position;
      game.celebrate([p.x, p.y + 2, p.z], 'confetti', { quiet: true });
    }
    const pop = { el, def, at: performance.now(), timer: 0 };
    cur = pop;
    pop.timer = setTimeout(() => flyAway(pop), HOLD_MS);
  };
  /** Every frame: show the next pop when the world is clear; step aside when it is not. */
  const pumpPops = () => {
    const now = performance.now();
    if (blocked()) {
      clearSince = null;
      if (cur && cur.el && !cur.el.classList.contains('sw-away')) {
        const pop = cur;
        if (now - pop.at < 1200) {
          // she hardly saw it: take it down and show it again later
          finishPop(pop);
          queue.unshift(pop.def);
        } else {
          flyAway(pop);
        }
      }
      return;
    }
    if (clearSince === null) clearSince = now;
    if (!showing && queue.length && now - clearSince >= SETTLE_MS) showNext();
  };

  const all = () => [...reg.values()].map((d) => ({ id: d.id, name: d.name, hint: d.hint, icon: d.icon, earned: game.profile.stickers[d.id] || null }));

  game.stickers = {
    has: (id) => !!game.profile.stickers[id],
    /** Give a sticker once. Returns true when it is new. */
    award(id) {
      const def = reg.get(id);
      if (!def || game.profile.stickers[id]) return false;
      game.profile.stickers[id] = new Date().toISOString();
      game.saveProfile();
      // paint the picture now (not later, in the middle of whatever she is doing then)
      try { stickerCanvas(def.id, def); } catch { /* the pop falls back to a toast */ }
      // the pop (with its jingle and confetti) shows as soon as the world is clear
      queue.push(def);
      pumpPops();
      game.events.emit('sticker:earned', { sticker: def });
      return true;
    },
    count: () => Object.keys(game.profile.stickers).filter((id) => reg.has(id)).length,
    total: () => reg.size,
    all,
    /** Sticker picture (glossy die-cut, or a silhouette when locked) as a data URL. */
    /** A new <canvas> with the sticker (or its locked silhouette): quick, never stalls. */
    canvas: (id, opts = {}) => stickerCanvas(id, reg.get(id) || null, opts),
    /** A new <canvas> with the sticker's outline in white (shine effects). */
    shape: (id, opts = {}) => stickerShape(id, reg.get(id) || null, opts),
    /** The sticker as a PNG data URL (reads pixels back: fine in menus, avoid mid-play). */
    image: (id, opts = {}) => stickerImage(id, reg.get(id) || null, opts),
    /** Earned stickers the Sticker Book has not shown yet. */
    unseen() {
      const seen = game.profile.stickersSeen || {};
      return all().filter((s) => s.earned && !seen[s.id]).map((s) => s.id);
    },
    markSeen() {
      const seen = (game.profile.stickersSeen = game.profile.stickersSeen || {});
      let changed = false;
      for (const s of all()) if (s.earned && !seen[s.id]) { seen[s.id] = 1; changed = true; }
      if (changed) game.saveProfile();
    },
  };

  if (game.ui) game.ui.addStyles(CSS);

  const ev = game.events;
  // multiplayer (docs/MULTIPLAYER.md §9.11): world events caused by a friend's change (the
  // host executing her op) never count toward this player's stickers and stats
  const remote = () => !!(game.net && game.net.remoteApplying);
  ev.on('block:place', ({ key }) => {
    if (remote()) return;
    const n = bump('blocksPlaced');
    if (n >= 1) game.award('first_block');
    if (n >= 100) game.award('builder');
    const rainbow = ['wool_red', 'wool_orange', 'wool_yellow', 'wool_lime', 'wool_sky', 'wool_blue', 'wool_purple'];
    if (rainbow.includes(key)) {
      const s = stats();
      s.rainbow = s.rainbow || {};
      s.rainbow[key] = 1;
      if (rainbow.every((k) => s.rainbow[k])) game.award('rainbow_maker');
    }
  });
  ev.on('world:created', () => {
    if ((stats().worldsCreated || 0) >= 3) game.award('world_maker');
  });
  ev.on('player:sleep', () => bump('sleeps'));
  ev.on('player:swim', () => game.award('splash'));
  // Night Owl: when night falls (time:night), she earns it after a few seconds out under the
  // stars (awake, playing, with a clear enough sky), so the sticker comes while stars twinkle
  let stargazing = -1;
  ev.on('time:night', () => { if (game.mode === 'play' && !game.stickers.has('night_owl')) stargazing = 0; });
  ev.on('world:unload', () => { stargazing = -1; });
  ev.on('pet:adopt', () => { if (!remote()) game.award('best_friends'); });
  ev.on('pet:pet', () => { if (!remote() && bump('petsPetted') >= 10) game.award('pet_lover'); });
  ev.on('pet:ride', ({ pet }) => { if (!remote() && pet && (pet.species === 'unicorn' || pet.kind === 'unicorn')) game.award('unicorn_rider'); });
  ev.on('cook:done', ({ recipe }) => {
    const s = stats();
    s.recipesCooked = s.recipesCooked || {};
    const key = recipe && (recipe.key || recipe);
    if (key) s.recipesCooked[key] = (s.recipesCooked[key] || 0) + 1;
    game.award('little_chef');
    const allRecipes = [...game.registry.recipes.keys()];
    if (allRecipes.length && allRecipes.every((k) => s.recipesCooked[k])) game.award('master_chef');
  });
  ev.on('garden:harvest', () => { if (!remote()) game.award('green_thumb'); });
  ev.on('outfit:changed', () => { if (bump('outfitChanges') >= 5) game.award('fashionista'); });
  // gem:collect { count: found in this world, total: gems in this world }
  ev.on('gem:collect', ({ count, total }) => {
    const n = bump('gems');
    if (n >= 10) game.award('gem_hunter');
    const allGems = total || (game.world && game.world.gemTotal) || 0;
    if (allGems && count >= allGems) game.award('gem_master');
  });
  ev.on('piano:note', () => { if (bump('notesPlayed') >= 20) game.award('musician'); });
  ev.on('photo:taken', () => game.award('photographer'));
  ev.on('prefab:place', () => { if (!remote()) game.award('magic_builder'); });
  ev.on('entity:place', ({ entity }) => {
    if (!game.entities || remote()) return;
    // visiting a friend's world (multiplayer guest): only the pieces she placed herself count
    const E = game.entities;
    const mine = game.net && game.net.isGuest ? E.all().filter((e) => E._ownUid(e.uid)) : E.all();
    const keys = new Set(mine.map((e) => e.key));
    const hasBed = [...keys].some((k) => k.startsWith('bed_'));
    const hasDoor = [...keys].some((k) => k.startsWith('door'));
    if (entity && hasBed && hasDoor) game.award('home_sweet_home');
  });

  // flying above the cloud layer
  let check = 0;
  game.addSystem({
    name: 'stickers',
    update(dt) {
      pumpPops(); // cheap: a few flags, so the settle clock is always current
      if (stargazing >= 0 && game.mode === 'play' && !game.paused && game.player) {
        const tod = game.timeOfDay;
        const dark = tod ? tod.night > 0.5 : true;
        const clear = !game.weather || game.weather.fx.overcast < 0.7;
        const awake = game.player.state !== 'sleep';
        if (!dark) stargazing = -1; // morning came first
        else if (awake && clear && (stargazing += dt) >= 4) {
          stargazing = -1;
          game.award('night_owl');
        }
      }
      check -= dt;
      if (check > 0 || !game.player || !game.world) return;
      check = 1;
      if (game.player.flying && game.player.position.y > game.world.sy + 9) game.award('sky_high');
    },
  });
}
