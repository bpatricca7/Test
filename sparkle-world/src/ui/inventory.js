// The Bag (catalog): every registered item by Bag tab. Tap an item to put it in the selected
// hotbar slot; items with color swatches show a swatch row. Core keeps this simple; the
// Menus team makes it gorgeous (search, favorites, pictures on the tabs...).

import { ITEM_CATEGORIES } from '../core/registry.js';

const CSS = /* css */ `
.sw-bag-tabs { display: flex; gap: 8px; overflow-x: auto; padding: 4px 2px 12px; scrollbar-width: none; }
.sw-bag-tabs::-webkit-scrollbar { display: none; }
.sw-tab { flex: none; border: 3px solid #fff; background: var(--sw-lav-soft); color: var(--sw-ink); border-radius: 999px; padding: 8px 16px; font-size: 17px; font-weight: 600; cursor: pointer; box-shadow: 0 3px 8px var(--sw-shadow); transition: transform .15s var(--sw-bounce); font-family: var(--sw-font); }
.sw-tab.sw-sel { background: var(--sw-pink); color: #fff; transform: scale(1.06); }
.sw-bag-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(112px, 1fr)); gap: 12px; }
.sw-item { position: relative; display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 10px 6px 8px; border-radius: 20px; background: #fff; border: 3px solid var(--sw-pink-soft); cursor: pointer; transition: transform .18s var(--sw-bounce), border-color .15s; font-family: var(--sw-font); }
.sw-item:hover { transform: translateY(-3px) scale(1.03); border-color: var(--sw-pink); }
.sw-item:active { transform: scale(.94); }
.sw-item img { width: 64px; height: 64px; pointer-events: none; }
.sw-item-name { font-size: 15px; font-weight: 600; text-align: center; line-height: 1.1; color: var(--sw-ink); }
.sw-swatches { display: flex; gap: 4px; flex-wrap: wrap; justify-content: center; margin-top: 2px; }
.sw-swatches button { width: 20px; height: 20px; border-radius: 50%; border: 3px solid #fff; box-shadow: 0 0 0 1.5px rgba(58,31,77,.2); cursor: pointer; padding: 0; }
.sw-swatches button:active { transform: scale(.85); }
.sw-bag-empty { padding: 30px; text-align: center; font-size: 19px; color: var(--sw-lav); }
@media (max-width: 600px) {
  .sw-bag-grid { grid-template-columns: repeat(auto-fill, minmax(92px, 1fr)); gap: 8px; }
  .sw-item img { width: 52px; height: 52px; }
  .sw-item-name { font-size: 13px; }
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
      const t = ui.el('button', 'sw-tab' + (id === tab ? ' sw-sel' : ''), label);
      t.type = 'button';
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
      card.addEventListener('click', () => give(item, null));
      card.addEventListener('keydown', (e) => { if (e.key === 'Enter') give(item, null); });
      if (item.colors && item.colors.length > 1) {
        const row = ui.el('div', 'sw-swatches');
        for (const c of item.colors) {
          const sw = ui.el('button');
          sw.type = 'button';
          sw.style.background = c;
          sw.setAttribute('aria-label', 'color');
          sw.addEventListener('click', (e) => {
            e.stopPropagation();
            give(item, c);
          });
          row.appendChild(sw);
        }
        card.appendChild(row);
      }
      gridEl.appendChild(card);
    }
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
