// Menus: the title screen (live 3D island backdrop with the player's avatar waving), the New
// World wizard (painted biome cards), My Worlds (thumbnails, rename, delete, save to a file,
// open a file), the pause panel and the cute loading messages.

import { icon2, button2 } from './menus/icons2.js';
import { TitleBackdrop } from './menus/backdrop.js';
import { paintBiomeArt, sizeArt } from './menus/biome-art.js';
import { prepareDownloads, saveFile, safeFileName } from './menus/files.js';
// "Open a file" (one world or a whole backup) and "Save all": keepsafe.js
import { openWorldFile, saveAllWorlds } from './keepsafe.js';
import { nameUnset, freshLook } from '../player/wardrobe-data.js';

const CSS = /* css */ `
/* ---------- title ---------- */
.sw-title2 { position: absolute; inset: 0; overflow: hidden; pointer-events: none; }
.sw-title2 > * { pointer-events: auto; }
.sw-title2.sw-flat { background: linear-gradient(180deg, #6EC3FF 0%, #A9DEFF 45%, #FFE0F0 80%, #FFD1E6 100%); }
.sw-title-glow { position: absolute; inset: 0; pointer-events: none !important; background: radial-gradient(ellipse 46% 70% at 21% 52%, rgba(255,255,255,.62), rgba(255,255,255,.18) 60%, rgba(255,255,255,0) 78%); }
.sw-title-col { position: absolute; top: 0; bottom: 0; left: calc(max(20px, 3.5vw) + var(--sw-safe-l)); width: min(460px, 42vw); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: clamp(8px, 1.8vh, 16px); padding: calc(12px + var(--sw-safe-t)) 0 calc(12px + var(--sw-safe-b)); pointer-events: none !important; }
.sw-title-col > * { pointer-events: auto; }
.sw-logo { position: relative; text-align: center; line-height: .9; margin: 0 0 4px; font-weight: 700; font-size: clamp(44px, min(6.6vw, 12vh), 104px); letter-spacing: 1px; animation: sw-pop .6s var(--sw-bounce); pointer-events: none; }
.sw-logo .sw-word { display: block; white-space: nowrap; }
.sw-logo .sw-l { display: inline-block; -webkit-text-stroke: .13em #fff; paint-order: stroke fill; text-shadow: 0 .09em 0 rgba(58,31,77,.18); animation: sw-float 3s ease-in-out infinite; }
.sw-logo-sparkle { position: absolute; color: var(--sw-sun); width: .42em; height: .42em; animation: sw-twinkle 1.8s ease-in-out infinite; filter: drop-shadow(0 3px 0 #fff); }
.sw-logo-sparkle svg { width: 100%; height: 100%; }
.sw-title-buttons { display: flex; flex-direction: column; align-items: stretch; gap: clamp(8px, 1.4vh, 12px); width: min(360px, 100%); }
.sw-title-buttons .sw-btn { width: 100%; }
.sw-title-last { margin: -4px auto 0; max-width: 100%; font-size: 15px; font-weight: 600; color: var(--sw-ink); background: rgba(255,255,255,.88); border-radius: 999px; padding: 2px 14px; box-shadow: 0 3px 8px var(--sw-shadow); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sw-title-last[hidden], .sw-app .sw-btn[hidden] { display: none; }
.sw-title-tiles { display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; margin-top: 2px; }
.sw-tile.sw-btn { flex-direction: column; gap: 2px; width: 96px; min-height: 90px; padding: 8px 4px 6px; border-radius: 26px; font-size: 16px; }
.sw-tile.sw-btn svg { width: 38px; height: 38px; }
.sw-tile.sw-tile--lav svg { color: var(--sw-lav); }
.sw-tile.sw-tile--sun svg { color: #F5A300; }
.sw-tile.sw-tile--sky svg { color: #3AAEF0; }
.sw-tile.sw-tile--mint svg { color: #22BF95; }
/* a look never changed: Dress Up wiggles now and then with a sparkle badge (CSS only, so the
   layout does not move; the press bounce still works because only rotate/scale animate) */
.sw-tile.sw-tile--nudge { position: relative; animation: sw-nudge 4s ease-in-out infinite; }
.sw-tile.sw-tile--nudge::after { content: ''; position: absolute; top: -9px; right: -9px; width: 28px; height: 28px; pointer-events: none; background: var(--sw-sun);
  clip-path: polygon(50% 0, 61% 39%, 100% 50%, 61% 61%, 50% 100%, 39% 61%, 0 50%, 39% 39%); animation: sw-twinkle 1.6s ease-in-out infinite; }
@keyframes sw-nudge { 0%, 82%, 100% { rotate: 0deg; scale: 1; } 86% { rotate: -7deg; scale: 1.06; } 90% { rotate: 6deg; scale: 1.06; } 94% { rotate: -3deg; scale: 1.03; } }
@media (prefers-reduced-motion: reduce) { .sw-tile.sw-tile--nudge, .sw-tile.sw-tile--nudge::after { animation: none; } }
.sw-hello { position: absolute; left: 0; top: 0; transform: translate(-9999px, 0); padding: 8px 18px 8px 14px; border-radius: 22px; background: #fff; color: var(--sw-ink); font-size: clamp(18px, 2.4vw, 26px); font-weight: 700; white-space: nowrap; box-shadow: 0 6px 16px var(--sw-shadow); border: 4px solid var(--sw-pink-soft); display: flex; align-items: center; gap: 8px; pointer-events: none !important; will-change: transform; }
.sw-hello svg { width: 1.1em; height: 1.1em; color: var(--sw-pink); animation: sw-beat 1.2s ease-in-out infinite; }
.sw-hello::after { content: ''; position: absolute; left: 50%; bottom: -13px; margin-left: -10px; border: 10px solid transparent; border-top: 11px solid #fff; border-bottom: 0; filter: drop-shadow(0 3px 0 var(--sw-pink-soft)); }
.sw-hello-in { display: inline-block; animation: sw-pop .5s var(--sw-bounce) both; }
@keyframes sw-beat { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.22); } }

@media (max-aspect-ratio: 1/1) {
  .sw-title-glow { background: linear-gradient(180deg, rgba(255,255,255,.55) 0%, rgba(255,255,255,0) 26%, rgba(255,255,255,0) 58%, rgba(255,255,255,.55) 100%); }
  .sw-title-col { left: 0; right: 0; width: auto; justify-content: space-between; padding: calc(4vh + var(--sw-safe-t)) 16px calc(3vh + var(--sw-safe-b)); }
  .sw-logo { font-size: clamp(48px, 13vw, 110px); }
  .sw-title-bottom { display: flex; flex-direction: column; align-items: center; gap: 12px; width: 100%; }
  .sw-title-buttons { width: min(440px, 100%); display: grid; grid-template-columns: 1fr 1fr; }
  .sw-title-buttons .sw-btn--big, .sw-title-buttons .sw-title-last { grid-column: 1 / -1; }
  .sw-title-buttons .sw-btn:not(.sw-btn--big) { font-size: 18px; padding: 6px 10px; }
}
@media (min-aspect-ratio: 1/1) { .sw-title-bottom { display: contents; } }
@media (max-height: 520px) and (min-aspect-ratio: 1/1) {
  .sw-tile.sw-btn { width: 78px; min-height: 64px; font-size: 13px; border-radius: 20px; }
  .sw-tile.sw-btn svg { width: 26px; height: 26px; }
  .sw-title-buttons .sw-btn { min-height: 44px; font-size: 17px; }
  .sw-title-buttons .sw-btn--big { min-height: 52px; font-size: 21px; }
  .sw-title-last { display: none; }
}
@media (max-width: 420px) {
  .sw-tile.sw-btn { width: 84px; min-height: 78px; font-size: 14px; }
  .sw-tile.sw-btn svg { width: 30px; height: 30px; }
  .sw-four { gap: 8px; }
  .sw-four .sw-tile.sw-btn { width: 78px; font-size: 13px; }
}
/* family accounts: "Not Lily?" (switch player) */
.sw-title-switch.sw-btn { min-height: 40px; font-size: 15px; padding: 2px 14px; }
/* playing with friends (src/net/ui.js): the title button and the resume chips */
.sw-title-friends.sw-btn[hidden], .sw-title-chips[hidden] { display: none; }
.sw-title-chips { display: flex; flex-direction: column; gap: 8px; width: 100%; }
.sw-title-chips .sw-net-chip.sw-btn { width: 100%; justify-content: flex-start; }
/* "Keep playing" (her friends are waiting) is the big first button; Play comes second */
.sw-title-chips .sw-net-chip--host.sw-btn { min-height: 78px; font-size: 25px; box-shadow: 0 0 0 4px rgba(255,255,255,.9), 0 8px 18px var(--sw-shadow); }
.sw-title-chips .sw-net-chip--host .sw-net-chip-pics .sw-pic { width: 30px; height: 30px; }
@media (max-aspect-ratio: 1/1) {
  .sw-title-buttons .sw-title-friends, .sw-title-buttons .sw-title-chips { grid-column: 1 / -1; }
}
.sw-pause-net:empty { display: none; }
.sw-world-before { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 4px 8px; padding: 0 12px 10px; margin-top: -4px; }
.sw-world-before-when { font-size: 13px; font-weight: 600; color: var(--sw-lav); white-space: nowrap; }
.sw-world-before .sw-btn { min-height: 38px; font-size: 14px; padding: 4px 12px; }
.sw-world-before .sw-btn svg { width: 20px; height: 20px; }

/* ---------- shared form bits ---------- */
.sw-field-label { font-size: 20px; font-weight: 700; color: var(--sw-lav); margin: 14px 0 8px; display: flex; align-items: center; gap: 8px; }
.sw-field-label:first-child { margin-top: 2px; }
.sw-field-label svg { width: 24px; height: 24px; }

/* ---------- new world ---------- */
.sw-nw-name { display: flex; gap: 10px; align-items: stretch; }
.sw-nw-name .sw-input { flex: 1; min-width: 0; font-size: 24px; }
.sw-biomes { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 14px; }
.sw-biome { position: relative; display: flex; flex-direction: column; align-items: stretch; justify-content: flex-start; border-radius: 24px; border: 5px solid #fff; padding: 0 0 10px; cursor: pointer; text-align: center; box-shadow: 0 6px 14px var(--sw-shadow); transition: transform .18s var(--sw-bounce), box-shadow .18s; font-family: var(--sw-font); color: var(--sw-ink); overflow: visible; }
.sw-biome:hover { transform: translateY(-3px); }
.sw-biome:active { transform: scale(.96); }
.sw-biome-art { display: block; width: 100%; aspect-ratio: 288 / 176; border-radius: 19px 19px 12px 12px; image-rendering: pixelated; image-rendering: crisp-edges; background: #DDF4FF; margin-bottom: 6px; }
.sw-biome-name { font-size: 19px; font-weight: 700; padding: 0 8px; }
.sw-biome-desc { font-size: 14px; opacity: .8; line-height: 1.15; margin-top: 2px; padding: 0 10px; }
.sw-biome.sw-sel { border-color: var(--sw-pink); transform: scale(1.04); box-shadow: 0 0 0 4px #fff, 0 10px 24px rgba(255,95,162,.45); z-index: 1; }
.sw-biome .sw-check { position: absolute; top: -12px; right: -12px; width: 38px; height: 38px; border-radius: 50%; background: var(--sw-pink); color: #fff; border: 4px solid #fff; display: none; place-items: center; box-shadow: 0 3px 8px var(--sw-shadow); }
.sw-biome.sw-sel .sw-check { display: grid; animation: sw-pop .3s var(--sw-bounce); }
.sw-biome .sw-check svg { width: 20px; height: 20px; }
.sw-sizes { display: flex; gap: 14px; flex-wrap: wrap; }
.sw-size { display: flex; align-items: center; gap: 12px; padding: 8px 18px 8px 8px; border-radius: 22px; border: 5px solid #fff; background: #fff; box-shadow: 0 5px 12px var(--sw-shadow); cursor: pointer; font-family: var(--sw-font); color: var(--sw-ink); transition: transform .18s var(--sw-bounce); min-height: 88px; }
.sw-size svg { width: 96px; height: 76px; border-radius: 14px; }
.sw-size-name { font-size: 22px; font-weight: 700; text-align: left; }
.sw-size-sub { font-size: 14px; font-weight: 600; color: var(--sw-lav); text-align: left; }
.sw-size.sw-sel { border-color: var(--sw-lav); box-shadow: 0 0 0 4px #fff, 0 8px 20px rgba(156,123,255,.45); transform: scale(1.03); }
/* Create! stays in view at the bottom of the card while the world cards scroll under it
   (on a landscape iPad the wizard is taller than the screen) */
.sw-create-row { position: sticky; bottom: -22px; z-index: 2; display: flex; justify-content: center; margin: 14px -22px -22px; padding: 18px 22px 16px; border-radius: 0 0 25px 25px; background: linear-gradient(rgba(255,248,252,0), var(--sw-cream) 38%); pointer-events: none; }
.sw-create-row > * { pointer-events: auto; }
.sw-create.sw-btn { min-width: 260px; }
@media (max-height: 520px) {
  .sw-create-row { padding-top: 12px; padding-bottom: 8px; }
  .sw-create.sw-btn { min-height: 54px; font-size: 22px; }
}

/* ---------- my worlds ---------- */
.sw-worlds-bar { display: flex; gap: 10px; justify-content: flex-end; flex-wrap: wrap; margin: 0 0 12px; }
.sw-worlds-bar[hidden] { display: none; }
.sw-worlds { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 16px; }
.sw-world { background: #fff; border-radius: 24px; border: 4px solid var(--sw-pink-soft); overflow: hidden; box-shadow: 0 5px 14px var(--sw-shadow); display: flex; flex-direction: column; animation: sw-pop .35s var(--sw-bounce) both; }
.sw-world.sw-new { border-color: var(--sw-mint); box-shadow: 0 0 0 4px #fff, 0 0 0 8px rgba(63,216,176,.5), 0 8px 20px var(--sw-shadow); }
.sw-world-thumb { position: relative; aspect-ratio: 16 / 10; background: linear-gradient(135deg, #BDF5C6, #9FD8FF); overflow: hidden; }
.sw-world-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.sw-world-thumb img.sw-art { image-rendering: pixelated; }
.sw-world-badge { position: absolute; left: 8px; top: 8px; display: inline-flex; align-items: center; gap: 5px; padding: 3px 11px 3px 4px; border-radius: 999px; border: 3px solid #fff; font-size: 14px; font-weight: 700; color: var(--sw-ink); box-shadow: 0 3px 8px var(--sw-shadow); }
.sw-world-badge img { width: 22px !important; height: 22px !important; object-fit: contain; }
.sw-world-info { padding: 8px 14px 2px; }
.sw-world-name { font-size: 20px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sw-world-meta { font-size: 14px; color: var(--sw-lav); font-weight: 600; display: flex; align-items: center; gap: 5px; }
.sw-world-meta svg { width: 16px; height: 16px; }
.sw-world-actions { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; padding: 8px 12px 12px; }
.sw-world-actions .sw-btn--pink { grid-column: 1 / -1; min-height: 50px; }
.sw-mini.sw-btn { flex-direction: column; gap: 1px; min-width: 0; min-height: 54px; padding: 3px 4px; border-radius: 16px; border-width: 3px; font-size: 13px; font-weight: 700; }
.sw-mini.sw-btn svg { width: 22px; height: 22px; }
.sw-mini.sw-btn .sw-btn-label { line-height: 1.05; }
.sw-empty { text-align: center; padding: 10px 16px 24px; font-size: 21px; font-weight: 600; color: var(--sw-lav); display: flex; flex-direction: column; align-items: center; gap: 14px; }
.sw-empty img { width: min(320px, 80%); border-radius: 24px; border: 5px solid #fff; box-shadow: 0 8px 20px var(--sw-shadow); image-rendering: pixelated; }
.sw-empty-row { display: flex; gap: 12px; flex-wrap: wrap; justify-content: center; }

/* ---------- pause ---------- */
.sw-pause { display: flex; flex-direction: column; gap: 12px; align-items: stretch; width: min(400px, 100%); margin: 0 auto; }
.sw-pause-row { display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; }
.sw-pause-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.sw-pause-grid .sw-btn { font-size: 18px; padding: 6px 10px; min-width: 0; }
.sw-pause-grid .sw-btn:only-child { grid-column: 1 / -1; }

/* ---------- loading ---------- */
.sw-loading-sub { font-size: 21px; font-weight: 600; color: var(--sw-lav); background: rgba(255,255,255,.85); padding: 6px 20px; border-radius: 999px; box-shadow: 0 4px 12px var(--sw-shadow); min-height: 1.4em; text-align: center; }
.sw-loading-sub span { display: inline-block; animation: sw-msg .35s var(--sw-bounce); }
@keyframes sw-msg { from { transform: translateY(6px) scale(.85); opacity: .35; } to { transform: none; opacity: 1; } }
.sw-loading-hearts { position: absolute; inset: 0; overflow: hidden; pointer-events: none; }
.sw-loading-hearts span { position: absolute; bottom: -40px; width: 30px; height: 30px; color: #fff; opacity: .8; animation: sw-rise linear infinite; }
.sw-loading-hearts svg { width: 100%; height: 100%; }
@keyframes sw-rise { from { transform: translateY(0) rotate(-10deg); } to { transform: translateY(-115vh) rotate(14deg); } }

@media (max-width: 600px) {
  .sw-biomes { grid-template-columns: repeat(2, 1fr); gap: 10px; }
  .sw-biome-name { font-size: 16px; }
  .sw-biome-desc { display: none; }
  .sw-nw-name { flex-wrap: wrap; justify-content: flex-end; }
  .sw-nw-name .sw-input { font-size: 20px; flex-basis: 100%; }
  .sw-nw-name .sw-dice.sw-btn { min-height: 44px; font-size: 17px; padding: 4px 16px; }
  .sw-sizes { flex-wrap: nowrap; gap: 10px; }
  .sw-size { flex: 1 1 0; min-width: 0; flex-direction: column; gap: 4px; padding: 6px 6px 8px; min-height: 0; }
  .sw-size svg { width: 100%; max-width: 110px; height: 64px; }
  .sw-size-name, .sw-size-sub { text-align: center; }
  .sw-size-name { font-size: 19px; }
  .sw-worlds { grid-template-columns: 1fr; }
  .sw-create-row { bottom: -16px; margin: 10px -14px -16px; padding: 14px 14px 12px; }
}
`;

const LOGO_COLORS = ['#FF5FA2', '#FFA43B', '#FFC94D', '#3FD8B0', '#6CC6FF', '#9C7BFF', '#FF7EB6'];

const NAME_IDEAS = {
  meadow: ['Rainbow Meadow', 'Flower Valley', 'Bunny Hill', 'Blossom Park', 'Buttercup Fields', 'Petal Hollow'],
  flat: ['Dream Town', 'Sparkle City', 'Happy Street', 'Cupcake Village', 'Starlight Town', 'Sunny Square'],
  candy: ['Candy Land', 'Cupcake Kingdom', 'Lollipop Hills', 'Gumdrop Valley', 'Sugar Castle', 'Sprinkle Town'],
  beach: ['Seashell Island', 'Sunny Beach', 'Mermaid Lagoon', 'Coconut Cove', 'Starfish Bay', 'Sandcastle Shore'],
  snow: ['Snowflake Village', 'Frosty Peaks', 'Winter Wonderland', 'Cocoa Mountain', 'Twinkle Snow', 'Igloo Hills'],
  fairy: ['Fairy Forest', 'Glow Garden', 'Moonlight Woods', 'Pixie Hollow', 'Crystal Glade', 'Firefly Grove'],
  mix: ['Everything Land', 'Wonder Island', 'Rainbow Kingdom', 'Dream Island', 'Surprise Valley', 'Patchwork Paradise'],
};
const ADJECTIVES = ['Rainbow', 'Sparkly', 'Sunny', 'Dreamy', 'Cozy', 'Magic', 'Twinkle', 'Bubblegum', 'Starlight', 'Honey', 'Glitter', 'Happy'];
const NOUNS = ['Meadow', 'Island', 'Valley', 'Garden', 'Kingdom', 'Village', 'Hills', 'Paradise', 'Land', 'Castle', 'Town', 'Park'];

const NEW_WORLD_MSGS = ['Planting flowers…', 'Painting the sky…', 'Fluffing the clouds…', 'Growing cherry trees…', 'Hiding sparkly gems…', 'Filling the pond…', 'Sprinkling glitter…', 'Waking up the butterflies…'];
const OPEN_WORLD_MSGS = ['Waking up your world…', 'Watering the flowers…', 'Fluffing the pillows…', 'Finding your things…', 'Saying hello to the butterflies…'];

function relativeDay(ms) {
  if (!ms) return 'New!';
  const days = Math.floor((Date.now() - ms) / 86400000);
  if (days <= 0) return 'Played today';
  if (days === 1) return 'Played yesterday';
  if (days < 14) return `Played ${days} days ago`;
  return `Played ${Math.round(days / 7)} weeks ago`;
}

function hillsSvg() {
  return `<svg viewBox="0 0 1200 300" preserveAspectRatio="none" aria-hidden="true" style="position:absolute;left:0;right:0;bottom:0;width:100%;height:34%">
    <path d="M0 150 C 180 60 360 60 520 130 C 700 210 860 70 1040 90 C 1120 100 1170 130 1200 140 V300 H0Z" fill="#A6E7A0"/>
    <path d="M0 210 C 220 130 420 170 600 200 C 800 235 980 150 1200 190 V300 H0Z" fill="#86D67A"/>
  </svg>`;
}

export function install(game) {
  const ui = game.ui;
  ui.addStyles(CSS);
  prepareDownloads();
  const playerName = () => {
    const p = game.profile;
    return (p.playerName && String(p.playerName).trim()) || (p.look && p.look.name) || 'friend';
  };
  // a Boy surprise style while the name is still the unset default: not "Lily" (boys.md)
  const boyUnset = () => !!game.surpriseStyle && game.surpriseStyle() === 'boy' && nameUnset(game.profile);
  const greetName = () => (boyUnset() ? 'friend' : playerName());
  const tallQuery = typeof matchMedia === 'function' ? matchMedia('(max-aspect-ratio: 1/1)') : null;
  const isTall = () => (tallQuery ? tallQuery.matches : window.innerHeight > window.innerWidth);

  // =====================================================================================
  // title
  // =====================================================================================
  let backdrop = null;
  let titleEl, playBtn, lastChip, tilesRow, hello, helloText, friendsBtn, netChips, newBtn, worldsBtn, switchChip;
  const helloAt = { x: 0, y: 0 };

  const loadingOpen = () => ui.loadingEl && ui.loadingEl.classList.contains('sw-open');

  let backdropFailed = false;
  function ensureBackdrop() {
    if (backdrop || backdropFailed || game.world || game.mode !== 'title' || loadingOpen() || !game.blockMaterials) return;
    try {
      backdrop = new TitleBackdrop(game);
      backdrop.setLayout(isTall() ? 'tall' : 'wide');
      if (titleEl) titleEl.classList.remove('sw-flat');
      // a pleasant morning for the title island
      game.time.dayTime = 0.31;
    } catch (err) {
      console.error('[menus] title backdrop failed', err);
      backdropFailed = true; // the painted sky and hills stand in; do not retry every frame
      backdrop = null;
      if (titleEl) titleEl.classList.add('sw-flat');
    }
  }

  function dropBackdrop() {
    if (!backdrop) return;
    try { backdrop.dispose(); } catch (err) { console.warn('[menus] backdrop dispose failed', err); }
    backdrop = null;
  }

  game.addSystem({
    name: 'menus-title',
    update(dt) {
      if (game.world || game.mode === 'play' || loadingOpen()) {
        dropBackdrop();
        return;
      }
      if (!backdrop && ui.current && (ui.current === 'title' || ['newworld', 'worlds', 'settings', 'dressup', 'stickers', 'help', 'mp-start', 'mp-join'].includes(ui.current))) ensureBackdrop();
      if (!backdrop) return;
      backdrop.setLayout(isTall() ? 'tall' : 'wide');
      backdrop.update(dt);
      if (hello && ui.current === 'title') {
        const at = backdrop.headScreen(helloAt);
        if (at) hello.style.transform = `translate(calc(${Math.round(at.x)}px - 50%), calc(${Math.round(at.y)}px - 100%))`;
      }
    },
    onWorldLoad() {
      dropBackdrop();
    },
  });

  const refreshLook = () => {
    if (backdrop) backdrop.setLook(game.profile.look);
    if (helloText) helloText.textContent = `Hi, ${greetName()}!`;
  };
  game.events.on('avatar:changed', refreshLook);
  game.events.on('outfit:changed', refreshLook);
  game.events.on('profile:changed', () => { refreshLook(); refreshTitle(); });
  // family accounts: a conflict made "(copy)" of a world; her switches changed
  for (const ev of ['world:forked', 'account:changed']) game.events.on(ev, () => { if (ui.isOpen('title')) refreshTitle(); if (ui.isOpen('worlds')) renderWorlds(); });
  // playing with friends: availability is known a moment after start; a session ending
  // (or starting) changes the resume chips
  game.events.on('net:state', () => { if (game.mode === 'title' && ui.isOpen('title')) refreshTitle(); });
  // "Before friends" (or its Undo) changed a world, or its copy went: the list shows it
  game.events.on('net:restored', () => { if (ui.isOpen('worlds')) renderWorlds(); });
  game.events.on('net:backup-dropped', () => { if (ui.isOpen('worlds')) renderWorlds(); });
  game.events.on('ui:close', ({ panel }) => { if (panel === 'dressup' && game.mode === 'title') { refreshLook(); if (backdrop) backdrop.cheer('twirl'); } });

  ui.registerPanel('title', {
    fullscreen: true,
    closable: false,
    build(container) {
      titleEl = ui.el('div', 'sw-title2');
      titleEl.appendChild(ui.el('div', 'sw-title-glow'));
      const col = ui.el('div', 'sw-title-col');

      const logo = ui.el('h1', 'sw-logo');
      logo.setAttribute('aria-label', 'Sparkle World');
      let n = 0;
      for (const word of ['Sparkle', 'World']) {
        const w = ui.el('span', 'sw-word');
        for (const ch of word) {
          const l = ui.el('span', 'sw-l', ch);
          l.style.color = LOGO_COLORS[n % LOGO_COLORS.length];
          l.style.animationDelay = `${-n * 0.18}s`;
          n++;
          w.appendChild(l);
        }
        logo.appendChild(w);
      }
      for (const [x, y, d] of [[-8, 4, 0], [96, 36, 0.6], [40, 90, 1.1]]) {
        const s = ui.el('span', 'sw-logo-sparkle');
        s.innerHTML = icon2('sparkle');
        s.style.left = `${x}%`;
        s.style.top = `${y}%`;
        s.style.animationDelay = `${d}s`;
        logo.appendChild(s);
      }

      const bottom = ui.el('div', 'sw-title-bottom');
      const buttons = ui.el('div', 'sw-title-buttons');
      playBtn = button2(ui, { icon: 'play', label: 'Play', variant: 'pink', size: 'big', className: 'sw-title-play', onClick: () => continueLast() });
      lastChip = ui.el('div', 'sw-title-last');
      lastChip.hidden = true;
      newBtn = button2(ui, { icon: 'plus', label: 'New World', variant: 'mint', onClick: () => ui.open('newworld') });
      worldsBtn = button2(ui, { icon: 'world', label: 'My Worlds', variant: 'lav', onClick: () => ui.open('worlds') });
      // playing with friends (src/net/ui.js): "Keep playing" / "Join Lily" chips and the button
      netChips = ui.el('div', 'sw-title-chips');
      netChips.hidden = true;
      friendsBtn = button2(ui, { icon: 'players', label: 'Play with Friends', variant: 'sky', className: 'sw-title-friends sw-tile--friends', onClick: () => game.runAction('mp-start') });
      friendsBtn.hidden = true;
      buttons.append(netChips, playBtn, lastChip, newBtn, worldsBtn, friendsBtn);
      // .sw-title-small (no styles) is the core title's hook for this row; probes still use it
      tilesRow = ui.el('div', 'sw-title-tiles sw-title-small');
      // family accounts: "Not Lily?" with 2+ players on a device not locked to one
      switchChip = button2(ui, { icon: 'players', label: 'Not me?', variant: 'white', className: 'sw-title-switch', onClick: () => game.account.switchPlayer() });
      switchChip.hidden = true;
      bottom.append(buttons, tilesRow, switchChip);
      col.append(logo, bottom);

      hello = ui.el('div', 'sw-hello');
      hello.innerHTML = icon2('heart');
      helloText = ui.el('span', 'sw-hello-in', `Hi, ${greetName()}!`);
      hello.prepend(helloText);

      titleEl.append(col, hello);
      container.appendChild(titleEl);
    },
    onOpen() {
      ensureBackdrop();
      if (!backdrop) titleEl.classList.add('sw-flat');
      if (titleEl.classList.contains('sw-flat') && !titleEl.querySelector('svg[preserveAspectRatio]')) titleEl.insertAdjacentHTML('afterbegin', hillsSvg());
      hello.style.transform = 'translate(-9999px, 0)';
      helloText.textContent = `Hi, ${greetName()}!`;
      // restart the pop so the greeting bounces in every time
      helloText.style.animation = 'none';
      void helloText.offsetWidth;
      helloText.style.animation = '';
      if (backdrop) backdrop.cheer('wave');
      if (game.audio.setMood) game.audio.setMood('menu');
      refreshTitle();
    },
  });

  async function refreshTitle() {
    if (!playBtn) return;
    tilesRow.innerHTML = '';
    if (game.actions.has('dressup')) {
      // a look never changed: the tile wiggles with a sparkle and opens on the ready-made
      // looks (girls' and boys'); one Studio visit turns it off (profile.lookPicked)
      const fresh = freshLook(game.profile);
      tilesRow.appendChild(button2(ui, {
        icon: 'dress', label: 'Dress Up', variant: 'white', className: 'sw-tile sw-tile--lav' + (fresh ? ' sw-tile--nudge' : ''),
        onClick: () => game.runAction('dressup', freshLook(game.profile) ? { tab: 'outfits' } : undefined),
      }));
    }
    if (game.actions.has('stickers')) tilesRow.appendChild(button2(ui, { icon: 'sticker', label: 'Stickers', variant: 'white', className: 'sw-tile sw-tile--sun', onClick: () => game.runAction('stickers') }));
    if (ui.hasPanel('settings')) tilesRow.appendChild(button2(ui, { icon: 'settings', label: 'Settings', variant: 'white', className: 'sw-tile sw-tile--sky', onClick: () => ui.open('settings') }));
    if (game.actions.has('help') && tilesRow.childElementCount < 3) tilesRow.appendChild(button2(ui, { icon: 'help', label: 'Help', variant: 'white', className: 'sw-tile sw-tile--mint', onClick: () => game.runAction('help') }));
    // family accounts (docs/ACCOUNTS.md §7.1, §7.7): Grown-ups, "Not Lily?", a visitor's title
    // (Play with Friends, Dress Up, Settings)
    const acct = game.account || {};
    const visitor = acct.mode === 'visitor';
    if (visitor) tilesRow.querySelector('.sw-tile--sun')?.remove();
    if (acct.grownups) tilesRow.appendChild(button2(ui, { icon: 'home', label: 'Grown-ups', variant: 'white', className: 'sw-tile sw-tile--mint sw-title-grownups', onClick: () => acct.openGrownups() }));
    tilesRow.classList.toggle('sw-four', tilesRow.childElementCount > 3);
    switchChip.hidden = !acct.canSwitch;
    switchChip.lastChild.textContent = acct.canSwitch ? `Not ${acct.player.nickname}?` : '';
    newBtn.hidden = worldsBtn.hidden = visitor;
    const net = game.net;
    const canPlayTogether = !!(net && net.available && game.actions.has('mp-start'));
    friendsBtn.hidden = !canPlayTogether;
    netChips.innerHTML = '';
    const chips = canPlayTogether && net.ui ? net.ui.resumeChips() : [];
    for (const c of chips) netChips.appendChild(net.ui.chipButton(c));
    netChips.hidden = chips.length === 0;
    const worlds = visitor ? [] : await game.store.listWorlds();
    const last = worlds.find((w) => w.id === game.profile.lastWorldId) || worlds[0];
    playBtn.hidden = !last;
    lastChip.hidden = !last;
    if (last) lastChip.textContent = last.name;
  }

  async function continueLast() {
    const worlds = await game.store.listWorlds();
    if (!worlds.length) {
      ui.open('newworld');
      return;
    }
    const last = worlds.find((w) => w.id === game.profile.lastWorldId) || worlds[0];
    await game.loadWorld(last.id);
  }

  // =====================================================================================
  // loading card: rotating cute messages + rising hearts
  // =====================================================================================
  if (ui.loadingEl) {
    const sub = ui.el('div', 'sw-loading-sub');
    const hearts = ui.el('div', 'sw-loading-hearts');
    for (let i = 0; i < 12; i++) {
      const h = ui.el('span');
      h.innerHTML = icon2(i % 3 === 0 ? 'star' : 'heart');
      h.style.left = `${4 + ((i * 37) % 92)}%`;
      h.style.animationDuration = `${6 + (i % 4) * 1.6}s`;
      h.style.animationDelay = `${-i * 0.9}s`;
      h.style.transform = `scale(${0.7 + (i % 3) * 0.25})`;
      h.style.color = ['#FFFFFF', '#FFB8D6', '#FFE38A', '#C9B8FF'][i % 4];
      hearts.appendChild(h);
    }
    ui.loadingEl.prepend(hearts);
    const bar = ui.loadingEl.querySelector('.sw-loading-bar');
    if (bar) bar.after(sub);
    else ui.loadingEl.appendChild(sub);
    let timer = 0, idx = 0, list = NEW_WORLD_MSGS;
    const show = () => {
      sub.innerHTML = '';
      sub.appendChild(ui.el('span', '', list[idx++ % list.length]));
    };
    const obs = new MutationObserver(() => {
      const open = ui.loadingEl.classList.contains('sw-open');
      if (open && !timer) {
        const text = (ui._loadingText && ui._loadingText.textContent) || '';
        list = /open/i.test(text) ? OPEN_WORLD_MSGS : NEW_WORLD_MSGS;
        idx = Math.floor(Math.random() * 3);
        show();
        timer = setInterval(show, 1100);
      } else if (!open && timer) {
        clearInterval(timer);
        timer = 0;
      }
    });
    obs.observe(ui.loadingEl, { attributes: true, attributeFilter: ['class'] });
  }

  // =====================================================================================
  // new world wizard
  // =====================================================================================
  let nameInput, biomeGrid, sizeRow, nwBody;
  const choice = { biome: 'meadow', size: 'cozy' };
  let nameTouched = false;
  let lastIdea = '';
  const artCache = new Map();
  const biomeArt = (key, def) => {
    let url = artCache.get(key);
    if (!url) {
      try { url = paintBiomeArt(game, key, def); } catch (err) { console.warn('[menus] biome art failed', key, err); url = ''; }
      artCache.set(key, url);
    }
    return url;
  };

  const ideasFor = (biome) => NAME_IDEAS[biome] || NAME_IDEAS.meadow;
  const suggestName = (fresh = false) => {
    const ideas = ideasFor(choice.biome);
    let idea = ideas[0];
    if (fresh) {
      for (let i = 0; i < 8; i++) {
        idea = Math.random() < 0.6
          ? ideas[Math.floor(Math.random() * ideas.length)]
          : `${ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)]} ${NOUNS[Math.floor(Math.random() * NOUNS.length)]}`;
        if (idea !== lastIdea) break;
      }
    }
    lastIdea = idea;
    return boyUnset() ? `My ${idea}` : `${playerName()}'s ${idea}`;
  };

  const renderBiomes = () => {
    biomeGrid.innerHTML = '';
    for (const [key, b] of game.registry.biomes) {
      const card = ui.el('button', 'sw-biome' + (key === choice.biome ? ' sw-sel' : ''));
      card.type = 'button';
      card.dataset.biome = key;
      const colors = b.colors || ['#FFFFFF', '#FFD1E6'];
      card.style.background = `linear-gradient(170deg, ${colors[0]}, ${colors[1]})`;
      const img = ui.el('img', 'sw-biome-art');
      img.alt = '';
      img.draggable = false;
      const url = biomeArt(key, b);
      if (url) img.src = url;
      else if (b.iconBlock && game.registry.blocks.has(b.iconBlock)) game.registry.blocks.iconFor(b.iconBlock).then((u) => { img.src = u; });
      const check = ui.el('span', 'sw-check');
      check.innerHTML = icon2('check');
      card.append(check, img, ui.el('div', 'sw-biome-name', b.name || key), ui.el('div', 'sw-biome-desc', b.description || ''));
      card.addEventListener('click', () => {
        if (choice.biome === key) return;
        choice.biome = key;
        game.audio.play('pop');
        if (!nameTouched) nameInput.value = suggestName();
        for (const el of biomeGrid.children) el.classList.toggle('sw-sel', el.dataset.biome === key);
      });
      biomeGrid.appendChild(card);
    }
  };

  const renderSizes = () => {
    sizeRow.innerHTML = '';
    for (const [key, label, sub] of [['cozy', 'Cozy', 'Just right'], ['big', 'Big', 'Lots of room']]) {
      const b = ui.el('button', 'sw-size' + (choice.size === key ? ' sw-sel' : ''));
      b.type = 'button';
      b.setAttribute('aria-label', label);
      b.innerHTML = sizeArt(key === 'big');
      const words = ui.el('div');
      words.append(ui.el('div', 'sw-size-name', label), ui.el('div', 'sw-size-sub', sub));
      b.appendChild(words);
      b.addEventListener('click', () => {
        choice.size = key;
        game.audio.play('pop', { pitch: key === 'big' ? 0.8 : 1.15 });
        renderSizes();
      });
      sizeRow.appendChild(b);
    }
  };

  const label = (ic, text) => {
    const l = ui.el('div', 'sw-field-label');
    l.innerHTML = icon2(ic);
    l.appendChild(document.createTextNode(text));
    return l;
  };

  ui.registerPanel('newworld', {
    title: 'New World',
    icon: 'sparkle',
    width: 900,
    back: (g) => (g.mode === 'title' ? 'title' : null),
    build(container) {
      nameInput = ui.el('input', 'sw-input');
      nameInput.maxLength = 40;
      nameInput.autocomplete = 'off';
      nameInput.spellcheck = false;
      nameInput.setAttribute('aria-label', 'World name');
      nameInput.addEventListener('input', () => { nameTouched = true; });
      // The suggestion is selected when she taps the field, so typing her own name replaces it
      // instead of being added to the end (or the middle). A click places the caret on mouse-up,
      // so select again then (once) and once more after the tap has settled.
      let selectOnUp = false;
      const selectSuggestion = () => {
        if (nameTouched || document.activeElement !== nameInput) return;
        try { nameInput.setSelectionRange(0, nameInput.value.length); } catch { nameInput.select(); }
      };
      nameInput.addEventListener('focus', () => {
        if (nameTouched) return;
        selectOnUp = true;
        selectSuggestion();
        setTimeout(selectSuggestion, 0);
      });
      nameInput.addEventListener('mouseup', (e) => {
        if (!selectOnUp) return;
        selectOnUp = false;
        if (!nameTouched) { e.preventDefault(); selectSuggestion(); }
      });
      nameInput.addEventListener('blur', () => { selectOnUp = false; });
      nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); nameInput.blur(); } });
      const dice = button2(ui, {
        icon: 'dice', label: 'New idea', variant: 'sun', className: 'sw-dice',
        onClick: () => {
          nameInput.value = suggestName(true);
          nameTouched = true; // her pick now: changing the world type keeps it
          game.audio.play('sparkle');
          dice.animate([{ transform: 'rotate(0)' }, { transform: 'rotate(-14deg) scale(1.08)' }, { transform: 'rotate(10deg)' }, { transform: 'rotate(0)' }], { duration: 380 });
        },
      });
      const nameRow = ui.el('div', 'sw-nw-name');
      nameRow.append(nameInput, dice);
      biomeGrid = ui.el('div', 'sw-biomes');
      sizeRow = ui.el('div', 'sw-sizes');
      const row = ui.el('div', 'sw-create-row');
      const create = button2(ui, {
        icon: 'sparkle', label: 'Create!', variant: 'pink', size: 'big', className: 'sw-create',
        onClick: () => {
          const name = nameInput.value.trim() || suggestName();
          game.audio.play('magic');
          game.newWorld({ name, biome: choice.biome, size: choice.size });
        },
      });
      row.appendChild(create);
      container.append(label('pencil', 'Name your world'), nameRow, label('world', 'Pick a world'), biomeGrid, label('island', 'How big?'), sizeRow, row);
      nwBody = container;
    },
    onOpen() {
      if (!game.registry.biomes.has(choice.biome)) choice.biome = game.registry.biomes.keys().next().value;
      nameTouched = false;
      nameInput.value = suggestName();
      renderBiomes();
      renderSizes();
      nwBody.scrollTop = 0; // start at the name field every time
    },
  });

  // =====================================================================================
  // my worlds
  // =====================================================================================
  let worldsList, worldsBar;
  let highlightId = null;

  const renderWorlds = async () => {
    const worlds = await game.store.listWorlds();
    // "Before friends": worlds with a copy from before friends came (less than 7 days old)
    const befores = game.net && game.net.ui ? await game.net.ui.backups() : new Map();
    worldsList.innerHTML = '';
    worldsBar.hidden = worlds.length === 0;
    if (!worlds.length) {
      worldsList.className = '';
      const empty = ui.el('div', 'sw-empty');
      const pic = ui.el('img');
      pic.alt = '';
      pic.src = biomeArt('meadow', game.registry.biomes.get('meadow') || {});
      const row = ui.el('div', 'sw-empty-row');
      row.append(
        button2(ui, { icon: 'plus', label: 'New World', variant: 'mint', onClick: () => ui.open('newworld') }),
        button2(ui, { icon: 'open', label: 'Open a file', variant: 'sky', onClick: () => importWorld() }),
      );
      empty.append(pic, ui.el('div', '', 'No worlds yet. Let\'s make one!'), row);
      worldsList.appendChild(empty);
      return;
    }
    worldsList.className = 'sw-worlds';
    worlds.forEach((w, i) => {
      const card = ui.el('div', 'sw-world' + (w.id === highlightId ? ' sw-new' : ''));
      card.style.animationDelay = `${Math.min(i, 8) * 0.04}s`;
      card.dataset.world = w.id;
      const thumb = ui.el('div', 'sw-world-thumb');
      const biome = game.registry.biomes.get(w.biome);
      const img = ui.el('img');
      img.alt = '';
      img.draggable = false;
      if (w.thumbnail) img.src = w.thumbnail;
      else {
        img.className = 'sw-art';
        img.src = biomeArt(w.biome, biome || {});
      }
      thumb.appendChild(img);
      const badge = ui.el('div', 'sw-world-badge');
      const colors = (biome && biome.colors) || ['#FFFFFF', '#FFD1E6'];
      badge.style.background = `linear-gradient(135deg, ${colors[0]}, ${colors[1]})`;
      if (biome && biome.iconBlock && game.registry.blocks.has(biome.iconBlock)) {
        const bi = ui.el('img');
        bi.alt = '';
        game.registry.blocks.iconFor(biome.iconBlock).then((u) => { bi.src = u; });
        badge.appendChild(bi);
      }
      badge.appendChild(ui.el('span', '', biome ? biome.name : (w.biome || 'World')));
      thumb.appendChild(badge);
      const info = ui.el('div', 'sw-world-info');
      const meta = ui.el('div', 'sw-world-meta');
      meta.innerHTML = icon2('clock');
      meta.appendChild(document.createTextNode(relativeDay(w.updatedAt)));
      info.append(ui.el('div', 'sw-world-name', w.name), meta);
      const actions = ui.el('div', 'sw-world-actions');
      actions.append(
        button2(ui, { icon: 'play', label: 'Play', variant: 'pink', onClick: () => game.loadWorld(w.id) }),
        button2(ui, { icon: 'pencil', label: 'Rename', variant: 'white', className: 'sw-mini', onClick: () => renameWorld(w) }),
        button2(ui, { icon: 'download', label: 'Save', title: 'Save to a file', variant: 'white', className: 'sw-mini', onClick: () => exportWorld(w) }),
        button2(ui, { icon: 'trash', label: 'Delete', variant: 'white', className: 'sw-mini', onClick: () => deleteWorld(w) }),
      );
      card.append(thumb, info, actions);
      if (befores.has(w.id)) {
        // a small grown-ups' button (not a second Play): "Before friends" asks twice and says
        // what goes away; it is only here while nothing was built alone since friends came
        const row = ui.el('div', 'sw-world-before');
        const b = befores.get(w.id);
        row.appendChild(ui.el('span', 'sw-world-before-when', 'Copy from ' + (game.net.ui.dayWord ? game.net.ui.dayWord(b.backupAt || b.updatedAt) : 'before')));
        row.appendChild(button2(ui, {
          icon: 'undo', label: 'Before friends', variant: 'white', size: 'small', className: 'sw-net-before',
          title: 'Go back to how it was before friends came',
          onClick: async () => { if (await game.net.ui.restoreBefore(w.id)) renderWorlds(); },
        }));
        card.appendChild(row);
      }
      worldsList.appendChild(card);
    });
    if (highlightId) {
      const el = worldsList.querySelector('.sw-new');
      if (el) requestAnimationFrame(() => el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
      highlightId = null;
    }
  };

  async function renameWorld(meta) {
    const name = await ui.textInput({ title: 'Rename world', value: meta.name, suggestions: ideasFor(meta.biome).slice(0, 3).map((s) => (boyUnset() ? `My ${s}` : `${playerName()}'s ${s}`)), ok: 'Save' });
    if (!name) return;
    const save = await game.store.loadWorld(meta.id);
    if (!save) return;
    save.name = name;
    save.updatedAt = Date.now();
    await game.store.saveWorld(save);
    game.toast('Renamed!', { icon: 'pencil' });
    renderWorlds();
  }

  async function deleteWorld(meta) {
    const first = await ui.confirm({ title: 'Delete this world?', text: `"${meta.name}" will be gone.`, yes: 'Yes, delete', no: 'No, keep it', icon: 'trash' });
    if (!first) return;
    const second = await ui.confirm({ title: 'Are you really sure?', text: 'You can\'t get it back!', yes: 'Yes, delete', no: 'No, keep it', icon: 'trash' });
    if (!second) return;
    await game.store.deleteWorld(meta.id);
    if (game.profile.lastWorldId === meta.id) {
      game.profile.lastWorldId = null;
      game.saveProfile();
    }
    game.toast('World deleted', { icon: 'trash' });
    renderWorlds();
  }

  async function exportWorld(meta) {
    const text = await game.store.exportWorld(meta.id);
    if (!text) {
      game.toast('Oops! Could not find that world.', { icon: 'sparkle' });
      return;
    }
    const res = await saveFile({ filename: `${safeFileName(meta.name)}.json`, data: text, mime: 'application/json' });
    if (res === 'saved') {
      game.toast('Saved to a file!', { icon: 'download', color: 'mint' });
      game.audio.play('success');
      game.events.emit('files:saved', { what: 'world', id: meta.id });
    } else if (res === 'failed') {
      game.toast('Oops! Saving a file does not work here.', { icon: 'sparkle' });
    }
  }

  // "Save to a file" for the world she is in (the core offers it when this device can't keep
  // her world): save it first so the file has everything, then hand it to the device
  game.registerAction('saveToFile', async (g) => {
    const w = g.world;
    if (!w) return false;
    await g.saveWorld({ thumbnail: false });
    await exportWorld({ id: w.meta.id, name: w.meta.name });
    return true;
  });

  async function importWorld() {
    // one world or a whole backup; a world already here is only replaced if she says so
    const res = await openWorldFile(game);
    if (!res) return;
    if (res.ok) {
      const brought = [...res.added, ...res.replaced, ...res.copies];
      highlightId = brought[0] || null;
      if (brought.length) {
        game.toast(res.kind === 'backup' ? 'Your worlds are back!' : 'Your world is here!', { icon: 'world', color: 'mint', big: true });
        game.audio.play('magic');
      } else {
        game.toast(res.kind === 'backup' ? 'You have all these worlds already!' : 'You kept your world.', { icon: 'world', color: 'mint' });
      }
      if (ui.isOpen('worlds')) renderWorlds();
      else ui.open('worlds');
      refreshTitle();
    } else {
      game.toast('Hmm, that file is not a Sparkle World.', { icon: 'sparkle', color: 'pink' });
      game.audio.play('click', { pitch: 0.6 });
    }
  }

  ui.registerPanel('worlds', {
    title: 'My Worlds',
    icon: 'world',
    width: 900,
    back: (g) => (g.mode === 'title' ? 'title' : null),
    build(container) {
      worldsBar = ui.el('div', 'sw-worlds-bar');
      worldsBar.append(
        button2(ui, { icon: 'plus', label: 'New World', variant: 'mint', size: 'small', onClick: () => ui.open('newworld') }),
        button2(ui, { icon: 'open', label: 'Open a file', variant: 'sky', size: 'small', className: 'sw-open-file', onClick: () => importWorld() }),
      );
      // the website keeps worlds only in this browser: one file with all of them (keepsafe.js)
      if (game.keepsafe && game.keepsafe.active) {
        worldsBar.append(button2(ui, { icon: 'download', label: 'Save all', title: 'Save all my worlds to a file', variant: 'sun', size: 'small', className: 'sw-save-all', onClick: () => saveAllWorlds(game) }));
      }
      worldsList = ui.el('div', 'sw-worlds');
      container.append(worldsBar, worldsList);
    },
    onOpen() {
      renderWorlds();
    },
  });

  // =====================================================================================
  // pause
  // =====================================================================================
  let pauseToggles;
  const renderToggles = () => {
    pauseToggles.innerHTML = '';
    const s = game.profile.settings;
    const musicOn = s.music > 0;
    const sfxOn = s.sfx > 0;
    pauseToggles.append(
      button2(ui, {
        icon: musicOn ? 'music' : 'mute', label: musicOn ? 'Music on' : 'Music off', variant: 'white', size: 'small',
        onClick: () => {
          s.music = musicOn ? 0 : 0.5;
          // volumes only: game.applySettings() would also reset the pixel ratio that Auto
          // quality lowered on a slow tablet
          game.audio.setVolumes({ music: s.music });
          game.audio.music(s.music > 0);
          game.saveProfile();
          renderToggles();
        },
      }),
      button2(ui, {
        icon: sfxOn ? 'sound' : 'mute', label: sfxOn ? 'Sounds on' : 'Sounds off', variant: 'white', size: 'small',
        onClick: () => {
          s.sfx = sfxOn ? 0 : 0.8;
          game.audio.setVolumes({ sfx: s.sfx });
          game.saveProfile();
          renderToggles();
        },
      }),
      button2(ui, {
        icon: 'camera3d', label: game.cameraRig && game.cameraRig.mode === 'first' ? 'My eyes' : 'Behind me', variant: 'white', size: 'small',
        onClick: () => {
          game.runAction('camera');
          renderToggles();
        },
      }),
    );
  };

  // playing with friends: Play Together (not in a session: the Play with Friends card, never
  // a code at once), Players (in one); a visiting
  // friend's Save & Exit is "Go home" (nothing of her friend's world is saved on her device);
  // the host's Save & Exit says goodbye to her friends kindly first
  let pauseNet, exitBtn;
  const renderPauseNet = () => {
    pauseNet.innerHTML = '';
    const net = game.net;
    const guest = !!(net && net.isGuest);
    exitBtn.querySelector('.sw-btn-label').textContent = guest ? 'Go home' : 'Save & Exit';
    exitBtn.setAttribute('aria-label', guest ? 'Go home' : 'Save & Exit');
    if (!net || !net.ui) return;
    if (net.active) {
      if (game.actions.has('mp-players')) pauseNet.appendChild(button2(ui, { icon: 'players', label: 'Players', variant: 'mint', className: 'sw-pause-players', onClick: () => game.runAction('mp-players') }));
    } else if (net.available && game.actions.has('mp-start') && game.world && !(game.world.meta && game.world.meta.shared)) {
      pauseNet.appendChild(button2(ui, { icon: 'players', label: 'Play Together', variant: 'sky', className: 'sw-pause-invite', onClick: () => { ui.close(); game.runAction('mp-start'); } }));
    }
  };
  const exitNow = () => {
    const net = game.net;
    if (net && net.isHost && net.ui) return net.ui.hostSaveAndExit();
    return game.exitToTitle();
  };

  ui.registerPanel('pause', {
    title: 'Paused',
    icon: 'menu',
    width: 480,
    build(container) {
      const col = ui.el('div', 'sw-pause');
      exitBtn = button2(ui, { icon: 'home', label: 'Save & Exit', variant: 'lav', className: 'sw-pause-exit', onClick: () => exitNow() });
      pauseNet = ui.el('div', 'sw-pause-net sw-pause-grid');
      col.append(
        button2(ui, { icon: 'play', label: 'Resume', variant: 'pink', size: 'big', onClick: () => ui.close() }),
        pauseNet,
        exitBtn,
      );
      const row = ui.el('div', 'sw-pause-grid');
      if (ui.hasPanel('settings')) row.appendChild(button2(ui, { icon: 'settings', label: 'Settings', variant: 'sky', onClick: () => ui.open('settings') }));
      if (game.actions.has('help')) row.appendChild(button2(ui, { icon: 'help', label: 'How to play', variant: 'mint', onClick: () => game.runAction('help') }));
      if (row.childElementCount) col.appendChild(row);
      pauseToggles = ui.el('div', 'sw-pause-row');
      col.appendChild(pauseToggles);
      container.appendChild(col);
    },
    onOpen() {
      renderToggles();
      renderPauseNet();
    },
  });
}
