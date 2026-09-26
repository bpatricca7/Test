// Cooking (Pets/Garden/Cooking team): game.registry.recipes, the Cooking panel mini-game
// ('cooking', args { entity, station }), the basket (profile.basket food counts) with its
// panel ('basket') and HUD action ('basket'), eating, feeding pets and food on tables.
// Events: 'cook:done' { recipe }, 'food:eat' { food }, 'basket:change' { basket, key, delta }.
// API: game.cooking (see below). The furniture team opens the panel from stoves, ovens,
// fridges and counters: game.ui.open('cooking', { entity, station: 'stove'|'oven'|'fridge'|'counter' }).

import { RECIPES } from './cooking/recipes.js';
import { installCookingPanel } from './cooking/panel.js';
import { installBasket } from './cooking/basket.js';
import { lifeIcon, basketAdd, basketCount } from './pets/kit.js';
import { FOOD, foodIcon } from './food-models.js';

/** Swap a panel's title icon for one of ours (core icons have no basket / paw / book). */
function titleIcon(game, panel, name) {
  const wrap = game.ui.panelLayer.querySelector(`.sw-panel-wrap[data-panel="${panel}"] .sw-card-title`);
  const svg = wrap && wrap.querySelector('svg');
  if (svg) svg.outerHTML = lifeIcon(name);
}

export function install(game) {
  for (const r of RECIPES) game.registry.recipes.set(r.key, r);
  let panel = null;
  const basket = installBasket(game, { openCooking: (station) => panel && panel.open(station) });
  panel = installCookingPanel(game, { eatNow: (key) => basket.eatNow(key) });
  titleIcon(game, 'basket', 'basket');
  titleIcon(game, 'cooking', 'book');
  titleIcon(game, 'pets', 'paw');

  game.cooking = {
    recipes: RECIPES,
    open: (station = 'counter', entity = null) => panel.open(station, entity),
    eat: (key) => basket.eatNow(key),
    count: (key) => basketCount(game, key),
    add: (key, n = 1) => basketAdd(game, key, n),
  };

  // warm up the recipe pictures in the background so the book opens with them ready
  game.events.on('world:load', () => {
    const keys = new Set();
    for (const r of RECIPES) { keys.add(r.food); for (const s of r.steps) keys.add(s); }
    for (const k of keys) foodIcon(game, k);
  });

  if (game.debug) {
    game.debug.cooking = {
      give: (key, n = 1) => (FOOD[key] ? basketAdd(game, key, n) : 0),
      basket: () => ({ ...(game.profile.basket || {}) }),
      open: (station = 'counter') => panel.open(station),
      eat: (key) => basket.eatNow(key),
    };
  }
}
