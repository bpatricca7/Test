// Sparkle Coins: profile.coins (100 to start, for new and older profiles), earned generously
// from things she already does, never lost (only spent in the shops). Every gain flies into
// the HUD coins pill as little coins with a jingle, and the pill counts up as they land.
//
//   game.coins = { value, shown, add(n, reason, { at }), spend(n, reason) -> bool,
//                  canAfford(n), gift({ force }) }
//   'coins:change' { coins, delta, reason }   'coins:shown' { shown } (the pill's number)
//
// Earning (each listener skips friends' actions applied from the network, MULTIPLAYER §9.11):
// gem +10, harvest +3, cooking +5, a new sticker +20, the first pat of each pet each day +2,
// and a daily gift box (+25) the first time she plays each day.

import { toScreen } from '../pets/kit.js';
import { shopSfx } from './sfx.js';
import { giftSvg, shopIcon } from './icons.js';

export const START_COINS = 100;
export const EARN = { gem: 10, harvest: 3, cook: 5, sticker: 20, pet: 2, gift: 25 };
const STICKER_WAIT = 1.0; // seconds of clear world before a sticker's coins fly (its pop is up)

const CSS = /* css */ `
.sh-fly-layer { position: absolute; inset: 0; pointer-events: none !important; z-index: 62; overflow: hidden; }
.sh-coin { position: absolute; left: 0; top: 0; width: 30px; height: 30px; margin: -15px 0 0 -15px; border-radius: 50%; color: #F5A300; will-change: transform, opacity;
  background: radial-gradient(circle at 35% 30%, #FFF6C8 0 22%, #FFD84D 23% 62%, #F2A900 63%); box-shadow: 0 0 0 2.5px #fff, 0 3px 8px rgba(58,31,77,.3); }
.sh-coin svg { position: absolute; inset: 5px; width: 20px; height: 20px; color: #E08A00; opacity: .85; }
.sh-plus { position: absolute; left: 0; top: 0; transform: translate(-50%, -50%); padding: 4px 14px 5px 10px; border-radius: 999px; background: #FFF6C8; border: 3px solid #fff;
  box-shadow: 0 4px 12px rgba(58,31,77,.25); font-size: 24px; font-weight: 700; color: #C77800; white-space: nowrap; display: flex; align-items: center; gap: 4px; }
.sh-plus svg { width: 24px; height: 24px; color: #F5A300; }

.sh-gift { position: absolute; left: 50%; top: calc(14% + var(--sw-safe-t)); transform: translateX(-50%); z-index: 46; display: flex; flex-direction: column; align-items: center; pointer-events: none !important; }
.sh-gift-rays { position: absolute; left: 50%; top: 80px; width: 340px; height: 340px; margin: -170px 0 0 -170px; border-radius: 50%; pointer-events: none;
  background: repeating-conic-gradient(from 0deg, rgba(255,226,120,.55) 0 11deg, rgba(255,255,255,0) 11deg 22deg);
  -webkit-mask: radial-gradient(circle, #000 18%, transparent 64%); mask: radial-gradient(circle, #000 18%, transparent 64%); animation: sh-spin 9s linear infinite; opacity: 0; transition: opacity .4s; }
.sh-gift.sh-open .sh-gift-rays { opacity: 1; }
.sh-gift-box { position: relative; width: 150px; height: 150px; border: 0; padding: 0; background: none; cursor: pointer; pointer-events: auto !important; touch-action: manipulation;
  animation: sh-drop .7s var(--sw-bounce) both, sh-wiggle 1.1s ease-in-out .8s infinite; -webkit-tap-highlight-color: transparent; }
.sh-gift-box svg { width: 100%; height: 100%; overflow: visible; filter: drop-shadow(0 8px 14px rgba(58,31,77,.3)); }
.sh-gift-lid { transform-box: fill-box; transform-origin: 50% 100%; transition: transform .55s var(--sw-bounce); }
.sh-gift.sh-open .sh-gift-box { animation: sh-pop .5s var(--sw-bounce); pointer-events: none !important; }
.sh-gift.sh-open .sh-gift-lid { transform: translate(18px, -46px) rotate(24deg); }
.sh-gift-label { position: relative; margin-top: 8px; padding: 8px 22px 10px; border-radius: 999px; background: #fff; border: 4px solid #FFE27A; text-align: center; line-height: 1.05;
  box-shadow: 0 6px 16px rgba(58,31,77,.25); animation: sw-pop .4s var(--sw-bounce) .25s both; }
.sh-gift-label small { display: block; font-size: 14px; font-weight: 700; color: #E08A00; letter-spacing: .6px; }
.sh-gift-label b { display: block; font-size: 25px; color: var(--sw-ink); }
.sh-gift-label span { display: block; font-size: 16px; font-weight: 700; color: var(--sw-pink); margin-top: 2px; }
.sh-gift.sh-away { animation: sh-away .5s ease-in forwards; }
@keyframes sh-spin { to { transform: rotate(360deg); } }
@keyframes sh-drop { 0% { transform: translateY(-120px) scale(.4); opacity: 0; } 100% { transform: none; opacity: 1; } }
@keyframes sh-wiggle { 0%, 100% { transform: rotate(0); } 20% { transform: rotate(-7deg) scale(1.03); } 40% { transform: rotate(6deg); } 60% { transform: rotate(-3deg); } 80% { transform: rotate(0) scale(1.04); } }
@keyframes sh-pop { 0% { transform: scale(1); } 40% { transform: scale(1.18, .88); } 100% { transform: scale(1); } }
@keyframes sh-away { to { transform: translateX(-50%) translateY(-30px) scale(.7); opacity: 0; } }
@media (max-width: 600px) { .sh-gift { top: calc(18% + var(--sw-safe-t)); } .sh-gift-box { width: 120px; height: 120px; } .sh-gift-label b { font-size: 21px; } }
`;

/** Today's date on this device ('YYYY-MM-DD'). */
export function today() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function installCoins(game) {
  const ui = game.ui;
  const ev = game.events;
  const remote = () => !!(game.net && game.net.remoteApplying);
  const bot = typeof navigator !== 'undefined' && !!navigator.webdriver;
  if (ui) ui.addStyles(CSS);

  const profile = () => game.profile;
  let shown = null; // what the HUD pill says (catches up as flying coins land)

  /** Older profiles and new ones start with 100 coins; a broken number is fixed kindly. */
  function ensure() {
    const p = profile();
    if (!p) return;
    if (typeof p.coins !== 'number' || !Number.isFinite(p.coins) || p.coins < 0) {
      p.coins = typeof p.coins === 'number' && p.coins > 0 ? Math.floor(p.coins) : START_COINS;
      game.saveProfile();
    }
    shown = p.coins;
  }
  ev.on('game:ready', ensure);
  ev.on('profile:changed', ensure);

  const setShown = (v) => {
    shown = v;
    ev.emit('coins:shown', { shown });
  };

  function add(n, reason = 'gift', { at = null, fly = true } = {}) {
    n = Math.floor(n);
    const p = profile();
    if (!p || !(n > 0)) return p ? p.coins : 0;
    ensure();
    p.coins += n;
    p.stats = p.stats || {};
    p.stats.coinsEarned = (p.stats.coinsEarned || 0) + n;
    game.saveProfile();
    ev.emit('coins:change', { coins: p.coins, delta: n, reason });
    if (!fly || game.mode !== 'play' || document.hidden) setShown(p.coins);
    // a sticker's coins fly out of its "New sticker!" pop (it shows once the world is clear)
    else if (reason === 'sticker') queued.push({ n, wait: STICKER_WAIT });
    else flyIn(n, at);
    return p.coins;
  }

  function spend(n, reason = 'shop') {
    n = Math.floor(n);
    const p = profile();
    if (!p || !(n >= 0)) return false;
    ensure();
    if (p.coins < n) return false;
    p.coins -= n;
    game.saveProfile();
    setShown(p.coins);
    ev.emit('coins:change', { coins: p.coins, delta: -n, reason });
    return true;
  }

  // ---------- flying coins ----------
  let layer = null;
  const flights = new Set();
  const queued = []; // gains waiting for a clear world before they fly ({ n, wait })
  const rootRect = () => ui.root.getBoundingClientRect();
  const pillEl = () => ui.hudLayer.querySelector('.sw-hud .sw-coins');

  /** Screen point (CSS px in the UI root) above her head, else the middle of the screen. */
  function sourcePoint(at) {
    if (at && typeof at.x === 'number' && typeof at.y === 'number' && at.screen) return { x: at.x, y: at.y };
    const pl = game.player;
    const w = ui.root.clientWidth, h = ui.root.clientHeight;
    if (!ui.current) {
      const p = at && typeof at.x === 'number' ? at : pl ? { x: pl.position.x, y: pl.position.y + 1.9, z: pl.position.z } : null;
      const s = p ? toScreen(game, p.x, p.y, p.z) : null;
      if (s && s.x > 0 && s.y > 0 && s.x < w && s.y < h) return s;
    }
    return { x: w / 2, y: h * 0.42 };
  }

  function flyIn(n, at) {
    const pill = pillEl();
    if (!ui || !pill || pill.hidden || !pill.getBoundingClientRect().width || typeof Element.prototype.animate !== 'function') {
      setShown(profile().coins);
      return;
    }
    if (!layer || !layer.isConnected) {
      layer = ui.el('div', 'sh-fly-layer');
      ui.root.appendChild(layer);
    }
    const rr = rootRect(), pr = pill.getBoundingClientRect();
    const tx = pr.left - rr.left + 24, ty = pr.top - rr.top + pr.height / 2;
    const src = sourcePoint(at);
    const count = Math.max(3, Math.min(10, Math.round(n / 2.5)));
    const flight = { n, count, landed: 0, given: 0 };
    flights.add(flight);
    shopSfx(game, 'jingle');
    // "+10" bubble at the source
    const plus = ui.el('div', 'sh-plus');
    plus.innerHTML = `+${n} ${shopIcon('coin')}`;
    plus.style.left = `${src.x}px`;
    plus.style.top = `${src.y}px`;
    layer.appendChild(plus);
    plus.animate([
      { transform: 'translate(-50%, -50%) scale(.4)', opacity: 0 },
      { transform: 'translate(-50%, -90%) scale(1.1)', opacity: 1, offset: 0.2 },
      { transform: 'translate(-50%, -120%) scale(1)', opacity: 1, offset: 0.75 },
      { transform: 'translate(-50%, -160%) scale(.9)', opacity: 0 },
    ], { duration: 1300, easing: 'ease-out' }).onfinish = () => plus.remove();
    for (let i = 0; i < count; i++) {
      const c = ui.el('div', 'sh-coin');
      c.innerHTML = shopIcon('star');
      layer.appendChild(c);
      const ang = (i / count) * Math.PI * 2 + Math.random() * 0.6;
      const burst = 46 + Math.random() * 40;
      const bx = src.x + Math.cos(ang) * burst, by = src.y + Math.sin(ang) * burst * 0.7 - 20;
      const mx = (bx + tx) / 2 + (Math.random() - 0.5) * 80, my = Math.min(by, ty) - 60 - Math.random() * 60;
      const anim = c.animate([
        { transform: `translate(${src.x}px, ${src.y}px) scale(.3)`, opacity: 0 },
        { transform: `translate(${bx}px, ${by}px) scale(1.15) rotate(40deg)`, opacity: 1, offset: 0.28 },
        { transform: `translate(${mx}px, ${my}px) scale(1) rotate(120deg)`, opacity: 1, offset: 0.62 },
        { transform: `translate(${tx}px, ${ty}px) scale(.55) rotate(200deg)`, opacity: 0.9 },
      ], { duration: 900 + i * 25, delay: i * 70, easing: 'cubic-bezier(.3,.1,.5,1)', fill: 'both' });
      anim.onfinish = () => {
        c.remove();
        land(flight, i);
      };
    }
  }

  function land(flight, i) {
    // the pill counts up a little with every coin, and to the exact total with the last one
    flight.landed++;
    const give = Math.round((flight.n * flight.landed) / flight.count);
    const delta = give - flight.given;
    flight.given = give;
    const p = profile();
    if (flight.landed >= flight.count) flights.delete(flight);
    setShown(flights.size ? Math.min(p.coins, shown + delta) : p.coins);
    shopSfx(game, 'tink', { pitch: 1 + Math.min(0.5, i * 0.06) });
  }

  // a missed landing (tab hidden, world left) never leaves the pill behind
  const catchUp = () => {
    flights.clear();
    queued.length = 0;
    if (layer) layer.innerHTML = '';
    if (profile()) setShown(profile().coins);
  };
  ev.on('world:unload', catchUp);
  document.addEventListener('visibilitychange', () => { if (document.hidden) catchUp(); });

  // ---------- earning ----------
  const headOf = (o) => (o && o.pos ? { x: o.pos.x, y: o.pos.y + 1.1, z: o.pos.z } : null);
  ev.on('gem:collect', () => {
    if (remote()) return;
    add(EARN.gem, 'gem');
  });
  ev.on('garden:harvest', ({ plant } = {}) => {
    if (remote()) return;
    const at = plant && typeof plant.x === 'number' ? { x: plant.x + 0.5, y: plant.y + 1.2, z: plant.z + 0.5 } : null;
    add(EARN.harvest, 'harvest', { at });
  });
  ev.on('cook:done', () => {
    if (remote()) return;
    add(EARN.cook, 'cook');
  });
  ev.on('sticker:earned', () => {
    if (remote()) return;
    add(EARN.sticker, 'sticker');
  });
  ev.on('pet:pet', ({ pet } = {}) => {
    if (remote() || !pet) return;
    const p = profile();
    const day = today();
    if (!p.coinPets || p.coinPets.day !== day) p.coinPets = { day, ids: [] };
    const id = `${(game.world && game.world.meta && game.world.meta.id) || 'w'}:${pet.id}`;
    if (p.coinPets.ids.includes(id)) return;
    p.coinPets.ids.push(id);
    if (p.coinPets.ids.length > 60) p.coinPets.ids.splice(0, p.coinPets.ids.length - 60);
    add(EARN.pet, 'pet', { at: headOf(pet) });
  });

  // ---------- the daily gift ----------
  let giftWanted = false, giftEl = null, clearFor = 0;
  /** Something covers the world (a panel, dialog, fade...); popsOk: a sticker pop does not count. */
  const blocked = (popsOk = false) => !!(ui.current || ui.dialogOpen || document.hidden || game.loading || game.mode !== 'play' ||
    (game.container && game.container.classList.contains('sw-photo-mode')) ||
    (ui.fader && ui.fader.classList.contains('sw-on')) ||
    (!popsOk && (ui.root.querySelector(':scope > .sw-stkpop') || ui.root.classList.contains('sw-tut-on'))));

  // automated test browsers (navigator.webdriver) get it only when asked (debug / probe), like
  // the tutorial's tips, so other scenario scripts are never covered by a surprise present
  ev.on('world:load', () => {
    if (remote()) return;
    if (profile() && profile().coinGiftDay !== today() && !bot) giftWanted = true;
  });
  ev.on('world:unload', () => { giftWanted = false; if (giftEl) { giftEl.remove(); giftEl = null; } });

  function showGift() {
    giftWanted = false;
    if (giftEl) giftEl.remove();
    const el = ui.el('div', 'sh-gift');
    const rays = ui.el('div', 'sh-gift-rays');
    const box = ui.el('button', 'sh-gift-box');
    box.type = 'button';
    box.setAttribute('aria-label', 'Open your gift');
    box.innerHTML = giftSvg();
    const label = ui.el('div', 'sh-gift-label');
    label.innerHTML = '<small>DAILY GIFT</small><b>A present for you!</b><span>Tap to open!</span>';
    el.append(rays, box, label);
    ui.root.appendChild(el);
    giftEl = el;
    shopSfx(game, 'chime');
    let opened = false;
    const open = () => {
      if (opened || giftEl !== el) return;
      opened = true;
      clearTimeout(auto);
      el.classList.add('sh-open');
      shopSfx(game, 'gift');
      const p = profile();
      p.coinGiftDay = today();
      label.innerHTML = `<small>DAILY GIFT</small><b>+${EARN.gift} Sparkle Coins!</b><span>Come back tomorrow for more!</span>`;
      const r = box.getBoundingClientRect(), rr = rootRect();
      setTimeout(() => add(EARN.gift, 'gift', { at: { x: r.left - rr.left + r.width / 2, y: r.top - rr.top + r.height * 0.3, screen: true } }), 260);
      setTimeout(() => {
        el.classList.add('sh-away');
        setTimeout(() => { el.remove(); if (giftEl === el) giftEl = null; }, 520);
      }, 2600);
    };
    box.addEventListener('pointerup', (e) => { e.stopPropagation(); open(); });
    box.addEventListener('click', (e) => { e.stopPropagation(); open(); });
    const auto = setTimeout(open, 4200);
    return true;
  }

  const stickerPoint = () => {
    const pop = ui.root.querySelector(':scope > .sw-stkpop');
    const rr = rootRect();
    if (pop) {
      const r = pop.getBoundingClientRect();
      if (r.width) return { x: r.left - rr.left + r.width / 2, y: r.top - rr.top + r.height * 0.4, screen: true };
    }
    return { x: rr.width / 2, y: rr.height * 0.28, screen: true };
  };

  game.addSystem({
    name: 'coins',
    update(dt) {
      if (!ui) return;
      const busy = blocked(true);
      clearFor = busy ? 0 : clearFor + dt;
      if (queued.length && !busy) {
        const q = queued[0];
        if ((q.wait -= dt) <= 0) {
          queued.shift();
          flyIn(q.n, stickerPoint());
        }
      }
      if (giftWanted && clearFor > 1.2 && !queued.length && !blocked()) showGift();
    },
  });

  // keep the pill honest if something odd happened (never more than a moment behind)
  let lag = 0;
  game.addSystem({
    name: 'coins-pill',
    update(dt) {
      const p = profile();
      if (!p || typeof p.coins !== 'number') return;
      if (shown === null || (shown !== p.coins && !flights.size && !queued.length)) {
        lag += dt;
        if (lag > 0.5 || shown === null) { lag = 0; setShown(p.coins); }
      } else lag = 0;
    },
  });

  const api = {
    get value() { return (profile() && profile().coins) || 0; },
    get shown() { return shown === null ? api.value : shown; },
    add,
    spend,
    canAfford: (n) => api.value >= n,
    /** Show the daily gift now (force: even if today's was opened). */
    gift({ force = false } = {}) {
      if (!force && profile().coinGiftDay === today()) return false;
      return showGift();
    },
    get giftShowing() { return !!giftEl; },
  };
  game.coins = api;
  return api;
}
