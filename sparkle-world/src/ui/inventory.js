// The Bag: a full-screen catalog of every registered item. Picture tabs for every Bag tab
// (plus "More" for tabs other teams invent), a search box with big letters, a "Recently used"
// row, big item cards with rendered icons, the "Pick a color!" step for colorful furniture and
// a mini hotbar at the bottom.
//   tap         -> put it in the selected hotbar slot and close
//   long-press  -> put it in the slot, move to the next slot and keep browsing (mouse: at once;
//                  touch: when the finger lets go, so resting on a card and then swiping only scrolls)
//   mouse drag  -> drop it on any hotbar slot (desktop)

import { ITEM_CATEGORIES } from '../core/registry.js';
import { hexToRgb } from '../core/util.js';
import { icon2, button2 } from './menus/icons2.js';

const LONG_PRESS_MS = 460;
const MAX_RECENT = 10;

const TAB_COLORS = {
  nature: '#7FD37A', building: '#FFAA6B', colors: '#FF7EB6', candy: '#FF94CF', glass: '#7FCBFF', lights: '#FFC94D',
  bedroom: '#AE92FF', living: '#FF9F8A', kitchen: '#4FD4AE', bathroom: '#6CC6FF', garden: '#8FD45F', fun: '#FFB84D',
  pets: '#FF8FB1', food: '#FFA85C', houses: '#9C7BFF', more: '#B9A9D9',
};
// the picture on each tab: the first of these that exists, else the tab's first item
const TAB_PICS = {
  nature: ['block:leaves_cherry', 'block:flower_rose', 'block:grass'],
  building: ['block:brick_pink', 'block:planks_pink'],
  colors: ['block:wool_pink', 'block:wool_purple'],
  candy: ['block:lollipop_block', 'block:candy_cane', 'block:gumdrop_pink', 'block:frosting_pink'],
  glass: ['block:glass_heart', 'block:glass_pink'],
  lights: ['block:lantern', 'block:lamp_block'],
  bedroom: ['furn:bed_canopy', 'furn:bed_heart', 'furn:bed_single'],
  living: ['furn:sofa', 'furn:armchair', 'furn:tv'],
  kitchen: ['furn:stove', 'furn:fridge', 'furn:table_round'],
  bathroom: ['furn:bathtub', 'furn:toilet'],
  garden: ['furn:swing', 'furn:fountain'],
  fun: ['furn:trampoline', 'furn:teddy_bear', 'furn:slide'],
};

const isLight = (hex) => {
  try {
    const [r, g, b] = hexToRgb(hex);
    return 0.299 * r + 0.587 * g + 0.114 * b > 225;
  } catch {
    return false;
  }
};

const CSS = /* css */ `
.sw-bag { position: absolute; inset: 0; display: flex; flex-direction: column; color: var(--sw-ink);
  background: radial-gradient(circle at 12px 12px, rgba(255,255,255,.55) 3px, transparent 4px) 0 0 / 34px 34px, linear-gradient(160deg, #FFE6F3 0%, #F1E8FF 55%, #E1F4FF 100%);
  padding: var(--sw-safe-t) var(--sw-safe-r) var(--sw-safe-b) var(--sw-safe-l); }
.sw-bag-head { display: flex; align-items: center; gap: 14px; padding: 12px 18px 8px; }
.sw-bag-title { display: flex; align-items: center; gap: 10px; margin: 0; font-size: 32px; font-weight: 700; color: var(--sw-pink); text-shadow: 0 3px 0 #fff; white-space: nowrap; }
.sw-bag-title svg { width: 40px; height: 40px; }
.sw-bag-search { flex: 1; min-width: 0; display: flex; align-items: center; gap: 8px; max-width: 560px; margin-left: auto; height: 58px; padding: 0 8px 0 16px; border-radius: 999px; background: #fff; border: 4px solid var(--sw-lav-soft); box-shadow: 0 4px 12px var(--sw-shadow); }
.sw-bag-search:focus-within { border-color: var(--sw-lav); }
.sw-bag-search > svg { width: 28px; height: 28px; color: var(--sw-lav); flex: none; }
.sw-bag-search input { flex: 1; min-width: 0; width: 100%; border: 0; outline: none; background: transparent; font-size: 24px; font-weight: 600; color: var(--sw-ink); font-family: var(--sw-font); -webkit-user-select: text; user-select: text; }
.sw-bag-search input::placeholder { color: #B9A9D9; }
.sw-bag-clear { width: 40px; height: 40px; border-radius: 50%; border: 0; background: var(--sw-lav-soft); color: var(--sw-lav); display: grid; place-items: center; cursor: pointer; flex: none; }
.sw-bag-clear svg { width: 20px; height: 20px; }
.sw-bag-clear[hidden] { display: none; }
.sw-bag-close.sw-btn { flex: none; }
.sw-bag-body { flex: 1; min-height: 0; display: flex; gap: 14px; padding: 4px 18px 0; }
.sw-bag-tabs { flex: none; width: 200px; display: flex; flex-direction: column; gap: 8px; overflow-y: auto; padding: 6px 6px 14px 2px; scrollbar-width: none; -webkit-overflow-scrolling: touch; }
.sw-bag-tabs::-webkit-scrollbar { display: none; }
.sw-tab2 { flex: none; display: flex; align-items: center; gap: 10px; min-height: 56px; padding: 6px 14px 6px 6px; border-radius: 20px; border: 4px solid #fff; background: rgba(255,255,255,.75); color: var(--sw-ink); font-family: var(--sw-font); font-size: 18px; font-weight: 700; text-align: left; line-height: 1.05; cursor: pointer; box-shadow: 0 3px 8px var(--sw-shadow); transition: transform .16s var(--sw-bounce), background .16s; touch-action: manipulation; }
.sw-tab2 .sw-tab-pic { width: 42px; height: 42px; flex: none; border-radius: 14px; background: var(--tc); display: grid; place-items: center; box-shadow: inset 0 -3px 0 rgba(0,0,0,.1); }
.sw-tab2 .sw-tab-pic img { width: 36px; height: 36px; pointer-events: none; }
.sw-tab2:hover { transform: translateX(3px); }
.sw-tab2.sw-sel { background: var(--tc); color: #fff; text-shadow: 0 2px 0 rgba(58,31,77,.18); transform: scale(1.03); box-shadow: 0 0 0 3px var(--tc), 0 6px 14px var(--sw-shadow); }
.sw-tab2.sw-sel .sw-tab-pic { background: #fff; }
.sw-bag-main { flex: 1; min-width: 0; overflow-y: auto; padding: 6px 6px 18px; -webkit-overflow-scrolling: touch; overscroll-behavior: contain; }
.sw-bag-h { display: flex; align-items: center; gap: 8px; font-size: 20px; font-weight: 700; color: var(--sw-lav); margin: 2px 2px 10px; }
.sw-bag-h svg { width: 24px; height: 24px; }
.sw-bag-recent { margin-bottom: 16px; }
.sw-bag-recent-row { display: flex; gap: 10px; overflow-x: auto; padding: 4px 4px 8px; scrollbar-width: none; }
.sw-bag-recent-row::-webkit-scrollbar { display: none; }
.sw-bag-recent-row .sw-item { flex: none; width: 96px; padding: 8px 4px 6px; }
.sw-bag-recent-row .sw-item img { width: 52px; height: 52px; }
.sw-bag-recent-row .sw-item-name { font-size: 13px; }
.sw-bag-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(128px, 1fr)); gap: 14px; }
.sw-item { position: relative; display: flex; flex-direction: column; align-items: center; justify-content: flex-start; gap: 4px; padding: 12px 6px 10px; border-radius: 24px; background: #fff; border: 4px solid #fff; box-shadow: 0 4px 0 rgba(58,31,77,.08), 0 6px 14px var(--sw-shadow); cursor: pointer; transition: transform .18s var(--sw-bounce), box-shadow .18s; font-family: var(--sw-font); -webkit-touch-callout: none; touch-action: pan-x pan-y; -webkit-user-select: none; user-select: none; }
.sw-item:hover { transform: translateY(-3px) scale(1.03); box-shadow: 0 0 0 3px var(--sw-pink-soft), 0 10px 18px var(--sw-shadow); }
.sw-item.sw-press { transform: scale(.93); }
.sw-item.sw-ready { transform: scale(1.06); box-shadow: 0 0 0 5px var(--sw-sun), 0 8px 18px var(--sw-shadow); }
.sw-item.sw-holding::after { content: ''; position: absolute; inset: -4px; border-radius: 26px; border: 4px solid var(--sw-sun); animation: sw-hold ${LONG_PRESS_MS}ms linear forwards; pointer-events: none; }
@keyframes sw-hold { from { clip-path: inset(0 100% 0 0); } to { clip-path: inset(0 0 0 0); } }
.sw-item img { width: 80px; height: 80px; pointer-events: none; -webkit-user-drag: none; }
.sw-item-name { font-size: 16px; font-weight: 700; text-align: center; line-height: 1.1; color: var(--sw-ink); }
.sw-item .sw-in-slot { position: absolute; top: 6px; right: 8px; min-width: 24px; height: 24px; border-radius: 12px; background: var(--sw-pink); color: #fff; font-size: 14px; font-weight: 700; display: grid; place-items: center; border: 2px solid #fff; padding: 0 5px; }
.sw-dots { display: flex; gap: 3px; justify-content: center; margin-top: 1px; pointer-events: none; }
.sw-dots span { width: 11px; height: 11px; border-radius: 50%; border: 2px solid #fff; box-shadow: 0 0 0 1px rgba(58,31,77,.2); }
.sw-bag-empty { padding: 40px 20px; text-align: center; font-size: 21px; font-weight: 600; color: var(--sw-lav); }
.sw-bag-empty svg { width: 64px; height: 64px; display: block; margin: 0 auto 10px; color: var(--sw-pink-soft); }
.sw-colors-head { display: flex; align-items: center; gap: 14px; margin-bottom: 16px; }
.sw-colors-head img { width: 84px; height: 84px; }
.sw-colors-title { font-size: 26px; font-weight: 700; color: var(--sw-pink); line-height: 1.1; }
.sw-colors-sub { font-size: 19px; font-weight: 700; color: var(--sw-lav); }
.sw-colors-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(112px, 1fr)); gap: 14px; }
.sw-color-opt { position: relative; display: grid; place-items: center; aspect-ratio: 1; min-height: 92px; border-radius: 26px; border: 6px solid var(--c); background: #fff; cursor: pointer; padding: 6px; box-shadow: 0 5px 12px var(--sw-shadow); transition: transform .18s var(--sw-bounce); font-family: var(--sw-font); }
.sw-color-opt:hover { transform: translateY(-3px) scale(1.04); }
.sw-color-opt:active { transform: scale(.92); }
.sw-color-opt img { width: 80%; height: 80%; pointer-events: none; }
.sw-color-opt .sw-color-dot { position: absolute; right: 6px; bottom: 6px; width: 26px; height: 26px; border-radius: 50%; background: var(--c); border: 3px solid #fff; box-shadow: 0 2px 5px var(--sw-shadow); }
.sw-color-opt.sw-light { border-color: var(--sw-lav-soft); }
.sw-color-opt.sw-light .sw-color-dot { border-color: var(--sw-lav-soft); }
.sw-color-opt.sw-sel { box-shadow: 0 0 0 5px var(--sw-sun), 0 8px 18px var(--sw-shadow); transform: scale(1.05); }
.sw-color-opt .sw-color-check { position: absolute; top: -10px; right: -10px; width: 34px; height: 34px; border-radius: 50%; background: var(--sw-sun); color: var(--sw-ink); border: 3px solid #fff; display: none; place-items: center; }
.sw-color-opt.sw-sel .sw-color-check { display: grid; }
.sw-color-check svg { width: 18px; height: 18px; }
.sw-bag-foot { display: flex; align-items: center; justify-content: center; gap: 12px; padding: 8px 14px 12px; }
.sw-bag-foot-label { font-size: 16px; font-weight: 700; color: var(--sw-lav); line-height: 1.1; text-align: right; max-width: 150px; }
.sw-bag-hotbar { display: flex; gap: 6px; padding: 6px; border-radius: 24px; background: rgba(255,255,255,.7); border: 4px solid #fff; box-shadow: 0 6px 16px var(--sw-shadow); }
.sw-bag-slot { position: relative; width: 56px; height: 56px; border-radius: 17px; background: var(--sw-cream); border: 3px solid #fff; box-shadow: inset 0 -4px 0 rgba(58,31,77,.08); display: grid; place-items: center; cursor: pointer; padding: 0; transition: transform .18s var(--sw-bounce); touch-action: manipulation; }
.sw-bag-slot img { width: 42px; height: 42px; pointer-events: none; }
.sw-bag-slot .sw-num { position: absolute; top: 1px; left: 5px; font-size: 11px; font-weight: 700; color: rgba(58,31,77,.4); pointer-events: none; }
.sw-bag-slot .sw-swatch { position: absolute; bottom: 3px; right: 3px; width: 11px; height: 11px; border-radius: 50%; border: 2px solid #fff; pointer-events: none; }
.sw-bag-slot.sw-sel { transform: translateY(-5px) scale(1.1); background: #fff; border-color: var(--sw-pink); box-shadow: 0 0 0 3px #fff, 0 0 14px 4px rgba(255,95,162,.5); }
.sw-bag-slot.sw-over { transform: scale(1.18); border-color: var(--sw-mint); box-shadow: 0 0 0 3px #fff, 0 0 16px 6px rgba(63,216,176,.6); }
.sw-bag-slot.sw-bump { animation: sw-bump .45s var(--sw-bounce); }
@keyframes sw-bump { 0% { transform: scale(1.35); } 100% { transform: scale(1); } }
.sw-bag-ghost { position: fixed; left: 0; top: 0; width: 84px; height: 84px; margin: -42px 0 0 -42px; pointer-events: none; z-index: 90; filter: drop-shadow(0 8px 12px rgba(58,31,77,.35)); }
.sw-bag-fly { position: fixed; z-index: 90; pointer-events: none; transition: transform .38s cubic-bezier(.5,-0.3,.6,1), opacity .38s; }
.sw-bag-tip { font-size: 14px; font-weight: 600; color: #8F7BBF; text-align: left; max-width: 170px; line-height: 1.15; }

@media (max-width: 820px), (max-aspect-ratio: 1/1) {
  .sw-bag-head { flex-wrap: wrap; gap: 10px; padding: 10px 12px 6px; }
  .sw-bag-title { font-size: 26px; }
  .sw-bag-title svg { width: 32px; height: 32px; }
  .sw-bag-search { order: 3; flex-basis: 100%; max-width: none; height: 52px; }
  .sw-bag-close.sw-btn { margin-left: auto; }
  .sw-bag-body { flex-direction: column; gap: 6px; padding: 0 10px; }
  .sw-bag-tabs { width: auto; flex-direction: row; overflow-x: auto; overflow-y: hidden; padding: 4px 2px 10px; gap: 8px; }
  .sw-tab2 { flex-direction: column; gap: 3px; min-height: 0; padding: 5px 8px 6px; font-size: 13px; text-align: center; min-width: 76px; max-width: 96px; border-radius: 18px; }
  .sw-tab2 .sw-tab-pic { width: 40px; height: 40px; }
  .sw-tab2:hover { transform: none; }
  .sw-bag-tip { display: none; }
}
@media (max-width: 600px) {
  .sw-bag-grid { grid-template-columns: repeat(3, 1fr); gap: 10px; }
  .sw-item { padding: 8px 4px 8px; border-radius: 20px; }
  .sw-item img { width: 60px; height: 60px; }
  .sw-item-name { font-size: 14px; }
  .sw-colors-grid { grid-template-columns: repeat(3, 1fr); gap: 10px; }
  .sw-bag-foot { padding: 6px 6px 10px; }
  .sw-bag-foot-label { display: none; }
  .sw-bag-hotbar { gap: 3px; padding: 4px; border-radius: 18px; }
  .sw-bag-slot { width: calc((100vw - 60px) / 9); height: calc((100vw - 60px) / 9); max-width: 44px; max-height: 44px; border-radius: 12px; border-width: 2px; }
  .sw-bag-slot img { width: 80%; height: 80%; }
  .sw-bag-slot .sw-num { display: none; }
  .sw-bag-close.sw-btn { font-size: 17px; padding: 4px 14px; min-height: 48px; }
}
@media (max-height: 520px) and (min-aspect-ratio: 1/1) {
  .sw-bag-head { padding: 6px 12px 4px; flex-wrap: nowrap; }
  .sw-bag-search { order: 0; flex-basis: auto; height: 46px; }
  .sw-bag-title { font-size: 22px; }
  .sw-bag-body { flex-direction: row; }
  .sw-bag-tabs { width: 160px; flex-direction: column; overflow-y: auto; overflow-x: hidden; }
  .sw-tab2 { flex-direction: row; font-size: 14px; min-height: 44px; padding: 3px 8px 3px 3px; max-width: none; text-align: left; }
  .sw-tab2 .sw-tab-pic { width: 34px; height: 34px; }
  .sw-bag-foot { padding: 4px 8px 6px; }
  .sw-bag-slot { width: 42px; height: 42px; }
  .sw-bag-slot img { width: 32px; height: 32px; }
}
`;

export function install(game) {
  const ui = game.ui;
  ui.addStyles(CSS);
  const items = game.registry.items;
  let tab = 'nature';
  let query = '';
  let colorItem = null; // the item whose "Pick a color!" step is showing
  let root, tabsEl, mainEl, searchInput, clearBtn, hotbarEl;
  const slotEls = [];
  let searchTimer = 0;

  const known = new Set(ITEM_CATEGORIES.map(([id]) => id));
  const tabList = () => {
    const list = ITEM_CATEGORIES.map(([id, label]) => [id, label]).filter(([id]) => items.byCategory(id).length);
    // tabs other teams invent (not in the core list) all go under "More"
    if (items.all().some((it) => !it.hidden && !known.has(it.category))) list.push(['more', 'More']);
    return list;
  };
  // Items come in registration order; an optional numeric `order` (lower first, default 0) moves
  // things up. Seed packets and tools (the watering can) lead their tab: they are how gardening
  // starts, and would otherwise sit below dozens of flower blocks.
  const orderOf = (it) => (typeof it.order === 'number' ? it.order : /^(seed|tool):/.test(it.key) ? -10 : 0);
  const sorted = (list) => (list.some((it) => orderOf(it) !== 0) ? list.sort((a, b) => orderOf(a) - orderOf(b)) : list);
  const tabItems = (id) => sorted(id === 'more' ? items.all().filter((it) => !it.hidden && !known.has(it.category)) : items.byCategory(id));
  const tabLabel = (id) => (tabList().find(([k]) => k === id) || [id, id])[1];

  const recent = () => {
    const r = game.profile.bagRecent;
    return Array.isArray(r) ? r.filter((e) => e && items.has(e.key) && !items.get(e.key).hidden) : [];
  };
  const remember = (key, color) => {
    const list = recent().filter((e) => e.key !== key);
    list.unshift({ key, color: color || null });
    game.profile.bagRecent = list.slice(0, MAX_RECENT);
    game.saveProfile();
  };

  // ---------- giving ----------

  const flyToSlot = (fromImg, slot) => {
    const target = slotEls[slot];
    if (!fromImg || !target || !fromImg.src) return;
    const a = fromImg.getBoundingClientRect(), b = target.el.getBoundingClientRect();
    if (!a.width || !b.width) return;
    const f = ui.el('img', 'sw-bag-fly');
    f.src = fromImg.src;
    f.alt = '';
    f.style.left = `${a.left}px`;
    f.style.top = `${a.top}px`;
    f.style.width = `${a.width}px`;
    f.style.height = `${a.height}px`;
    document.body.appendChild(f);
    const dx = b.left + b.width / 2 - (a.left + a.width / 2), dy = b.top + b.height / 2 - (a.top + a.height / 2);
    requestAnimationFrame(() => {
      f.style.transform = `translate(${dx}px, ${dy}px) scale(${Math.max(0.3, b.width / a.width)})`;
      f.style.opacity = '0.4';
    });
    setTimeout(() => f.remove(), 420);
  };

  /** Put an item into a hotbar slot. keep: stay in the Bag (long-press / drag). */
  const give = (item, color, { keep = false, slot = game.hotbar.index, from = null } = {}) => {
    const c = color || null;
    game.setSlot(slot, item.key, c);
    remember(item.key, c);
    game.audio.play('pop', { pitch: 1 + Math.random() * 0.1 });
    flyToSlot(from, slot);
    if (keep) {
      setTimeout(() => {
        const s = slotEls[slot];
        if (s) { s.el.classList.remove('sw-bump'); void s.el.offsetWidth; s.el.classList.add('sw-bump'); }
      }, 330);
      game.selectSlot((slot + 1) % 9);
      renderHotbar();
      markInSlots();
      return;
    }
    renderHotbar();
    setTimeout(() => {
      if (!ui.isOpen('bag')) return;
      ui.close();
      game.toast(`${item.name} is ready!`, { icon: 'check' });
    }, 300);
  };

  // ---------- cards ----------

  let ghost = null;
  const cardFor = (item, { color = null, small = false } = {}) => {
    const card = ui.el('div', 'sw-item');
    card.setAttribute('role', 'button');
    card.tabIndex = 0;
    card.dataset.key = item.key;
    card.setAttribute('aria-label', item.name);
    const img = ui.el('img');
    img.alt = '';
    img.draggable = false;
    img.style.visibility = 'hidden';
    items.iconFor(item.key, color || null).then((url) => {
      if (url) { img.src = url; img.style.visibility = 'visible'; }
    });
    card.append(img, ui.el('div', 'sw-item-name', item.name));
    const colorful = !color && item.colors && item.colors.length > 1;
    if (colorful && !small) {
      const dots = ui.el('div', 'sw-dots');
      for (const c of item.colors.slice(0, 6)) {
        const d = ui.el('span');
        d.style.background = c;
        dots.appendChild(d);
      }
      card.appendChild(dots);
    }
    const choose = () => (colorful ? renderColors(item) : give(item, color, { from: img }));
    const keepGive = () => give(item, color || (colorful ? item.colors[0] : null), { keep: true, from: img });

    let press = null;
    const clearPress = () => {
      if (!press) return;
      clearTimeout(press.timer);
      card.classList.remove('sw-press', 'sw-holding', 'sw-ready');
      press = null;
    };
    // where the card's centre is on screen (press / hover scaling keeps the centre): if it moved
    // between press and release, the list scrolled under the finger
    const cardSpot = () => { const r = card.getBoundingClientRect(); return [(r.left + r.right) / 2, (r.top + r.bottom) / 2]; };
    card.addEventListener('contextmenu', (e) => e.preventDefault());
    card.addEventListener('pointerdown', (e) => {
      if (e.button !== undefined && e.button !== 0) return;
      clearPress();
      press = { id: e.pointerId, x: e.clientX, y: e.clientY, type: e.pointerType, long: false, drag: false, spot: cardSpot() };
      card.classList.add('sw-press');
      if (e.pointerType === 'mouse') { try { card.setPointerCapture(e.pointerId); } catch { /* ignore */ } }
      const p = press;
      setTimeout(() => { if (press === p && !p.drag) card.classList.add('sw-holding'); }, 120);
      p.timer = setTimeout(() => {
        if (press !== p || p.drag) return;
        p.long = true;
        card.classList.remove('sw-holding', 'sw-press');
        // mouse: give now. Touch: only mark it ready and give on release: a finger that rests
        // still and then swipes is scrolling (the browser cancels the pointer), not picking
        if (p.type === 'mouse') keepGive();
        else card.classList.add('sw-ready');
      }, LONG_PRESS_MS);
    });
    card.addEventListener('pointermove', (e) => {
      const p = press;
      if (!p || p.id !== e.pointerId) return;
      const d = Math.hypot(e.clientX - p.x, e.clientY - p.y);
      if (p.type === 'mouse' && !p.long && (p.drag || d > 8)) {
        if (!p.drag) {
          p.drag = true;
          clearTimeout(p.timer);
          card.classList.remove('sw-holding', 'sw-press');
          ghost = ui.el('img', 'sw-bag-ghost');
          ghost.src = img.src;
          ghost.alt = '';
          document.body.appendChild(ghost);
        }
        ghost.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
        const over = slotAt(e.clientX, e.clientY);
        slotEls.forEach((s, i) => s.el.classList.toggle('sw-over', i === over));
        return;
      }
      if (d > 10) clearPress();
    });
    const end = (e, cancelled) => {
      const p = press;
      if (!p || p.id !== e.pointerId) return;
      if (p.drag) {
        const over = cancelled ? -1 : slotAt(e.clientX, e.clientY);
        if (ghost) { ghost.remove(); ghost = null; }
        slotEls.forEach((s) => s.el.classList.remove('sw-over'));
        if (over >= 0) give(item, color || (colorful ? item.colors[0] : null), { keep: true, slot: over, from: img });
        clearPress();
        return;
      }
      const spot = cardSpot();
      const scrolled = Math.abs(spot[0] - p.spot[0]) > 8 || Math.abs(spot[1] - p.spot[1]) > 8;
      const tap = !cancelled && !p.long && !scrolled;
      const held = !cancelled && p.long && p.type !== 'mouse' && !scrolled;
      clearPress();
      if (tap) choose();
      else if (held) keepGive();
    };
    card.addEventListener('pointerup', (e) => end(e, false));
    card.addEventListener('pointercancel', (e) => end(e, true));
    card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(); } });
    return card;
  };

  const slotAt = (x, y) => {
    for (let i = 0; i < slotEls.length; i++) {
      const r = slotEls[i].el.getBoundingClientRect();
      if (x >= r.left - 4 && x <= r.right + 4 && y >= r.top - 6 && y <= r.bottom + 6) return i;
    }
    return -1;
  };

  // little number badges: which hotbar slot already holds this item
  const markInSlots = () => {
    if (!mainEl) return;
    for (const card of mainEl.querySelectorAll('.sw-item')) {
      const i = game.hotbar.slots.indexOf(card.dataset.key);
      let badge = card.querySelector('.sw-in-slot');
      if (i < 0) { if (badge) badge.remove(); continue; }
      if (!badge) { badge = ui.el('span', 'sw-in-slot'); card.appendChild(badge); }
      badge.textContent = String(i + 1);
    }
  };

  // ---------- rendering ----------

  const renderTabs = () => {
    tabsEl.innerHTML = '';
    for (const [id, label] of tabList()) {
      // .sw-tab (no styles of its own) is the stable hook other teams' probes use for Bag tabs
      const t = ui.el('button', 'sw-tab2 sw-tab' + (id === tab && !query ? ' sw-sel' : ''));
      t.type = 'button';
      t.dataset.tab = id;
      t.style.setProperty('--tc', TAB_COLORS[id] || TAB_COLORS.more);
      const picWrap = ui.el('span', 'sw-tab-pic');
      const pic = ui.el('img');
      pic.alt = '';
      pic.style.visibility = 'hidden';
      const list = tabItems(id);
      const key = (TAB_PICS[id] || []).find((k) => items.has(k)) || (list[0] && list[0].key);
      if (key) items.iconFor(key).then((url) => { if (url) { pic.src = url; pic.style.visibility = 'visible'; } });
      picWrap.appendChild(pic);
      t.append(picWrap, ui.el('span', '', label));
      t.addEventListener('click', () => {
        game.audio.play('click');
        tab = id;
        colorItem = null;
        if (query) { query = ''; searchInput.value = ''; clearBtn.hidden = true; }
        for (const el of tabsEl.children) el.classList.toggle('sw-sel', el.dataset.tab === id);
        renderMain();
        mainEl.scrollTop = 0;
      });
      tabsEl.appendChild(t);
    }
  };

  const heading = (ic, text) => {
    const h = ui.el('div', 'sw-bag-h');
    h.innerHTML = icon2(ic);
    h.appendChild(document.createTextNode(text));
    return h;
  };

  const renderMain = () => {
    mainEl.innerHTML = '';
    if (colorItem) return renderColors(colorItem);
    if (query) {
      const q = query.toLowerCase();
      const found = items.all().filter((it) => !it.hidden && (it.name.toLowerCase().includes(q) || it.key.toLowerCase().includes(q)));
      if (!found.length) {
        const e = ui.el('div', 'sw-bag-empty');
        e.innerHTML = icon2('search');
        e.appendChild(document.createTextNode(`Nothing called "${query}". Try another word!`));
        mainEl.appendChild(e);
        return;
      }
      mainEl.appendChild(heading('search', found.length === 1 ? 'Found 1 thing' : `Found ${found.length} things`));
      const grid = ui.el('div', 'sw-bag-grid');
      for (const it of found.slice(0, 120)) grid.appendChild(cardFor(it));
      mainEl.appendChild(grid);
      markInSlots();
      return;
    }
    const rec = recent();
    if (rec.length) {
      const box = ui.el('div', 'sw-bag-recent');
      box.appendChild(heading('recent', 'Recently used'));
      const row = ui.el('div', 'sw-bag-recent-row');
      for (const r of rec) row.appendChild(cardFor(items.get(r.key), { color: r.color, small: true }));
      box.appendChild(row);
      mainEl.appendChild(box);
    }
    const list = tabItems(tab);
    mainEl.appendChild(heading('grid', tabLabel(tab)));
    if (!list.length) {
      const e = ui.el('div', 'sw-bag-empty');
      e.innerHTML = icon2('sparkles');
      e.appendChild(document.createTextNode('Nothing here yet. Come back soon!'));
      mainEl.appendChild(e);
      return;
    }
    const grid = ui.el('div', 'sw-bag-grid');
    for (const it of list) grid.appendChild(cardFor(it));
    mainEl.appendChild(grid);
    markInSlots();
  };

  /** "Pick a color!": the item pictured in every color, big and tappable. */
  const renderColors = (item) => {
    if (colorItem !== item) game.audio.play('pop');
    colorItem = item;
    mainEl.innerHTML = '';
    const head = ui.el('div', 'sw-colors-head');
    const back = button2(ui, { icon: 'back', label: 'Back', variant: 'white', size: 'small', onClick: () => { colorItem = null; renderMain(); } });
    const pic = ui.el('img');
    pic.alt = '';
    items.iconFor(item.key).then((url) => { if (url) pic.src = url; });
    const words = ui.el('div');
    words.append(ui.el('div', 'sw-colors-title', item.name), ui.el('div', 'sw-colors-sub', 'Pick a color!'));
    head.append(back, pic, words);
    const grid = ui.el('div', 'sw-colors-grid');
    const slot = game.hotbar.index;
    const current = game.hotbar.slots[slot] === item.key ? (game.hotbar.colors[slot] || item.colors[0]) : null;
    for (const c of item.colors) {
      const b = ui.el('button', 'sw-color-opt' + (c === current ? ' sw-sel' : '') + (isLight(c) ? ' sw-light' : ''));
      b.type = 'button';
      b.style.setProperty('--c', c);
      b.setAttribute('aria-label', `${item.name} in ${c}`);
      const img = ui.el('img');
      img.alt = '';
      img.style.visibility = 'hidden';
      items.iconFor(item.key, c).then((url) => {
        if (url) { img.src = url; img.style.visibility = 'visible'; }
      });
      const check = ui.el('span', 'sw-color-check');
      check.innerHTML = icon2('check');
      b.append(img, ui.el('span', 'sw-color-dot'), check);
      b.addEventListener('click', () => { colorItem = null; give(item, c, { from: img }); });
      grid.appendChild(b);
    }
    mainEl.append(head, grid);
    mainEl.scrollTop = 0;
  };

  const renderHotbar = () => {
    if (!hotbarEl) return;
    slotEls.forEach((s, i) => {
      const key = game.hotbar.slots[i];
      s.el.classList.toggle('sw-sel', i === game.hotbar.index);
      const color = game.hotbar.colors[i];
      s.sw.style.display = color ? 'block' : 'none';
      if (color) s.sw.style.background = color;
      const k = `${key}|${color || ''}`;
      if (s.key === k) return;
      s.key = k;
      s.img.style.visibility = 'hidden';
      if (!key) return;
      items.iconFor(key, color && items.get(key)?.colors ? color : null).then((url) => {
        if (s.key !== k || !url) return;
        s.img.src = url;
        s.img.style.visibility = 'visible';
      });
    });
  };

  // ---------- panel ----------

  ui.registerPanel('bag', {
    fullscreen: true,
    build(container) {
      root = ui.el('div', 'sw-bag');
      const head = ui.el('div', 'sw-bag-head');
      const title = ui.el('h2', 'sw-bag-title');
      title.innerHTML = icon2('bag');
      title.appendChild(ui.el('span', '', 'My Bag'));
      const search = ui.el('label', 'sw-bag-search');
      search.innerHTML = icon2('search');
      searchInput = ui.el('input');
      searchInput.type = 'text';
      searchInput.inputMode = 'search';
      searchInput.placeholder = 'Find…';
      searchInput.autocomplete = 'off';
      searchInput.spellcheck = false;
      searchInput.setAttribute('aria-label', 'Find things');
      searchInput.enterKeyHint = 'search';
      clearBtn = ui.el('button', 'sw-bag-clear');
      clearBtn.type = 'button';
      clearBtn.hidden = true;
      clearBtn.setAttribute('aria-label', 'Clear');
      clearBtn.innerHTML = icon2('close');
      clearBtn.addEventListener('click', (e) => {
        e.preventDefault();
        searchInput.value = '';
        setQuery('');
        searchInput.focus();
      });
      search.append(searchInput, clearBtn);
      const setQuery = (q) => {
        query = q.trim();
        clearBtn.hidden = !searchInput.value;
        colorItem = null;
        for (const el of tabsEl.children) el.classList.toggle('sw-sel', !query && el.dataset.tab === tab);
        renderMain();
        mainEl.scrollTop = 0;
      };
      searchInput.addEventListener('input', () => {
        clearTimeout(searchTimer);
        clearBtn.hidden = !searchInput.value;
        searchTimer = setTimeout(() => setQuery(searchInput.value), 140);
      });
      searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          if (searchInput.value) { searchInput.value = ''; setQuery(''); } else { searchInput.blur(); ui.back(); }
        } else if (e.key === 'Enter') {
          searchInput.blur();
        }
      });
      const close = button2(ui, { icon: 'close', label: 'Close', variant: 'white', className: 'sw-bag-close', onClick: () => ui.back() });
      head.append(title, search, close);

      const body = ui.el('div', 'sw-bag-body');
      tabsEl = ui.el('div', 'sw-bag-tabs');
      tabsEl.setAttribute('role', 'tablist');
      mainEl = ui.el('div', 'sw-bag-main');
      body.append(tabsEl, mainEl);

      const foot = ui.el('div', 'sw-bag-foot');
      const lab = ui.el('div', 'sw-bag-foot-label', 'Your hotbar');
      hotbarEl = ui.el('div', 'sw-bag-hotbar');
      for (let i = 0; i < 9; i++) {
        const s = ui.el('button', 'sw-bag-slot');
        s.type = 'button';
        s.setAttribute('aria-label', `Slot ${i + 1}`);
        s.appendChild(ui.el('span', 'sw-num', String(i + 1)));
        const img = ui.el('img');
        img.alt = '';
        img.draggable = false;
        s.appendChild(img);
        const sw = ui.el('span', 'sw-swatch');
        s.appendChild(sw);
        s.addEventListener('click', () => {
          game.selectSlot(i);
          renderHotbar();
          if (colorItem) renderColors(colorItem);
        });
        hotbarEl.appendChild(s);
        slotEls.push({ el: s, img, sw, key: undefined });
      }
      const tip = ui.el('div', 'sw-bag-tip', 'Hold a thing to pick lots!');
      foot.append(lab, hotbarEl, tip);
      root.append(head, body, foot);
      container.appendChild(root);
    },
    onOpen() {
      const cur = game.selectedItem();
      if (cur) {
        const t = known.has(cur.category) ? cur.category : 'more';
        if (tabItems(t).length) tab = t;
      }
      if (!tabItems(tab).length) tab = (tabList()[0] || ['nature'])[0];
      colorItem = null;
      query = '';
      searchInput.value = '';
      clearBtn.hidden = true;
      renderTabs();
      renderMain();
      renderHotbar();
      mainEl.scrollTop = 0;
      const sel = tabsEl.querySelector('.sw-sel');
      if (sel) requestAnimationFrame(() => sel.scrollIntoView({ block: 'nearest', inline: 'center' }));
    },
    onClose() {
      clearTimeout(searchTimer);
      if (ghost) { ghost.remove(); ghost = null; }
      if (document.activeElement === searchInput) searchInput.blur();
    },
  });
  game.events.on('hotbar:change', () => { if (ui.isOpen('bag')) renderHotbar(); });
}
