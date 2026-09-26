// The Bag (catalog): every registered item by Bag tab. Tap an item to put it in the selected
// hotbar slot. Items with color swatches (furniture) open a "pick a color" step with a big
// picture of the item in every color. Core keeps this simple; the Menus team makes it
// gorgeous (search, favorites...).

import { ITEM_CATEGORIES } from '../core/registry.js';
import { hexToRgb } from '../core/util.js';
import { icon } from './icons.js';

const isLight = (hex) => {
  const [r, g, b] = hexToRgb(hex);
  return 0.299 * r + 0.587 * g + 0.114 * b > 225;
};

const CSS = /* css */ `
.sw-bag-tabs { display: flex; gap: 8px; overflow-x: auto; padding: 4px 2px 12px; scrollbar-width: none; }
.sw-bag-tabs::-webkit-scrollbar { display: none; }
.sw-tab { flex: none; display: inline-flex; align-items: center; gap: 6px; border: 3px solid #fff; background: var(--sw-lav-soft); color: var(--sw-ink); border-radius: 999px; padding: 5px 16px 5px 8px; font-size: 17px; font-weight: 600; cursor: pointer; box-shadow: 0 3px 8px var(--sw-shadow); transition: transform .15s var(--sw-bounce); font-family: var(--sw-font); }
.sw-tab img { width: 30px; height: 30px; pointer-events: none; }
.sw-tab.sw-sel { background: var(--sw-pink); color: #fff; transform: scale(1.06); }
.sw-bag-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(112px, 1fr)); gap: 12px; }
.sw-item { position: relative; display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 10px 6px 8px; border-radius: 20px; background: #fff; border: 3px solid var(--sw-pink-soft); cursor: pointer; transition: transform .18s var(--sw-bounce), border-color .15s; font-family: var(--sw-font); }
.sw-item:hover { transform: translateY(-3px) scale(1.03); border-color: var(--sw-pink); }
.sw-item:active { transform: scale(.94); }
.sw-item img { width: 64px; height: 64px; pointer-events: none; }
.sw-item-name { font-size: 15px; font-weight: 600; text-align: center; line-height: 1.1; color: var(--sw-ink); }
/* a little row of dots on the card says "comes in colors" (the picker has the real buttons) */
.sw-dots { display: flex; gap: 3px; justify-content: center; margin-top: 1px; pointer-events: none; }
.sw-dots span { width: 10px; height: 10px; border-radius: 50%; border: 2px solid #fff; box-shadow: 0 0 0 1px rgba(58,31,77,.2); }
.sw-colors-head { display: flex; align-items: center; gap: 14px; margin-bottom: 14px; }
.sw-colors-head img { width: 72px; height: 72px; }
.sw-colors-title { font-size: 24px; font-weight: 700; color: var(--sw-pink); line-height: 1.1; }
.sw-colors-sub { font-size: 17px; font-weight: 600; color: var(--sw-lav); }
.sw-colors-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(104px, 1fr)); gap: 12px; }
.sw-color-opt { position: relative; display: grid; place-items: center; aspect-ratio: 1; min-height: 88px; border-radius: 24px; border: 5px solid var(--c); background: #fff; cursor: pointer; padding: 6px; box-shadow: 0 5px 12px var(--sw-shadow); transition: transform .18s var(--sw-bounce); font-family: var(--sw-font); }
.sw-color-opt:hover { transform: translateY(-3px) scale(1.04); }
.sw-color-opt:active { transform: scale(.92); }
.sw-color-opt img { width: 78%; height: 78%; pointer-events: none; }
.sw-color-opt .sw-color-dot { position: absolute; right: 6px; bottom: 6px; width: 24px; height: 24px; border-radius: 50%; background: var(--c); border: 3px solid #fff; box-shadow: 0 2px 5px var(--sw-shadow); }
/* very light colors (white, cream) get a lavender edge so they still read on the white card */
.sw-color-opt.sw-light { border-color: var(--sw-lav-soft); }
.sw-color-opt.sw-light .sw-color-dot { border-color: var(--sw-lav-soft); }
.sw-color-opt.sw-sel { box-shadow: 0 0 0 5px var(--sw-sun), 0 8px 18px var(--sw-shadow); transform: scale(1.05); }
.sw-color-opt .sw-color-check { position: absolute; top: -10px; right: -10px; width: 32px; height: 32px; border-radius: 50%; background: var(--sw-sun); color: var(--sw-ink); border: 3px solid #fff; display: none; place-items: center; }
.sw-color-opt.sw-sel .sw-color-check { display: grid; }
.sw-color-check svg { width: 18px; height: 18px; }
.sw-bag-empty { padding: 30px; text-align: center; font-size: 19px; color: var(--sw-lav); }
@media (max-width: 600px) {
  .sw-bag-grid { grid-template-columns: repeat(auto-fill, minmax(92px, 1fr)); gap: 8px; }
  .sw-item img { width: 52px; height: 52px; }
  .sw-item-name { font-size: 13px; }
  .sw-colors-grid { grid-template-columns: repeat(3, 1fr); gap: 10px; }
  .sw-tab { font-size: 15px; }
}
`;

export function install(game) {
  const ui = game.ui;
  ui.addStyles(CSS);
  let tab = 'nature';
  let tabsEl, gridEl;

  const give = (item, color) => {
    game.setSlot(game.hotbar.index, item.key, color || null);
    game.audio.play('pop');
    game.toast(`${item.name} is ready!`, { icon: 'check' });
    ui.close();
  };

  const renderTabs = () => {
    tabsEl.innerHTML = '';
    for (const [id, label] of ITEM_CATEGORIES) {
      if (!game.registry.items.byCategory(id).length) continue;
      const t = ui.el('button', 'sw-tab' + (id === tab ? ' sw-sel' : ''));
      t.type = 'button';
      // the tab's picture is its first item
      const pic = ui.el('img');
      pic.alt = '';
      pic.style.visibility = 'hidden';
      game.registry.items.iconFor(game.registry.items.byCategory(id)[0].key).then((url) => {
        if (url) { pic.src = url; pic.style.visibility = 'visible'; }
      });
      t.append(pic, ui.el('span', '', label));
      t.addEventListener('click', () => {
        tab = id;
        game.audio.play('click');
        renderTabs();
        renderGrid();
      });
      tabsEl.appendChild(t);
      if (id === tab) requestAnimationFrame(() => t.scrollIntoView({ block: 'nearest', inline: 'center' }));
    }
  };

  const renderGrid = () => {
    gridEl.innerHTML = '';
    gridEl.className = 'sw-bag-grid';
    const items = game.registry.items.byCategory(tab);
    if (!items.length) {
      gridEl.appendChild(ui.el('div', 'sw-bag-empty', 'Nothing here yet!'));
      return;
    }
    for (const item of items) {
      const card = ui.el('div', 'sw-item');
      card.setAttribute('role', 'button');
      card.tabIndex = 0;
      const img = ui.el('img');
      img.alt = '';
      img.draggable = false;
      img.style.visibility = 'hidden';
      game.registry.items.iconFor(item.key).then((url) => {
        if (url) { img.src = url; img.style.visibility = 'visible'; }
      });
      card.append(img, ui.el('div', 'sw-item-name', item.name));
      const colorful = item.colors && item.colors.length > 1;
      const choose = () => (colorful ? renderColors(item) : give(item, null));
      card.addEventListener('click', choose);
      card.addEventListener('keydown', (e) => { if (e.key === 'Enter') choose(); });
      if (colorful) {
        const dots = ui.el('div', 'sw-dots');
        for (const c of item.colors.slice(0, 6)) {
          const d = ui.el('span');
          d.style.background = c;
          dots.appendChild(d);
        }
        card.appendChild(dots);
      }
      gridEl.appendChild(card);
    }
  };

  /** Second step for colorful items: the item pictured in every color, big and tappable. */
  const renderColors = (item) => {
    game.audio.play('pop');
    gridEl.innerHTML = '';
    gridEl.className = 'sw-bag-colors';
    const head = ui.el('div', 'sw-colors-head');
    const back = ui.button({ icon: 'back', variant: 'white', size: 'icon', title: 'Back', onClick: () => renderGrid() });
    const pic = ui.el('img');
    pic.alt = '';
    game.registry.items.iconFor(item.key).then((url) => { if (url) pic.src = url; });
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
      game.registry.items.iconFor(item.key, c).then((url) => {
        if (url) { img.src = url; img.style.visibility = 'visible'; }
      });
      const check = ui.el('span', 'sw-color-check');
      check.innerHTML = icon('check');
      b.append(img, ui.el('span', 'sw-color-dot'), check);
      b.addEventListener('click', () => give(item, c));
      grid.appendChild(b);
    }
    gridEl.append(head, grid);
  };

  ui.registerPanel('bag', {
    title: 'My Bag',
    icon: 'bag',
    width: 820,
    build(container) {
      tabsEl = ui.el('div', 'sw-bag-tabs');
      gridEl = ui.el('div', 'sw-bag-grid');
      container.append(tabsEl, gridEl);
    },
    onOpen() {
      const cur = game.selectedItem();
      if (cur && game.registry.items.byCategory(cur.category).length) tab = cur.category;
      if (!game.registry.items.byCategory(tab).length) tab = ITEM_CATEGORIES.find(([id]) => game.registry.items.byCategory(id).length)?.[0] || tab;
      renderTabs();
      renderGrid();
    },
  });
}
