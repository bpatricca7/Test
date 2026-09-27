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

const WARM_START = 6; // seconds of play before the recipe pictures start warming up
const WARM_GAP = 0.6; // seconds between two warm-up pictures
const WARM_STILL = 0.5; // seconds the view must be still before a warm-up picture renders

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

  // Warm up the recipe pictures in the background so the book opens with them ready, gently:
  // a few seconds into play, one picture at a time, only while the thumbnail queue is empty
  // (the hotbar / Bag icons she can see always go first) and only while the view is still
  // (she stands and the camera does not turn, or a panel is open), so a picture's render never
  // shows as a hitch while she moves. The Basket and the Recipe Book still ask for their own
  // pictures when they open; the thumbnail cache lives for the whole session.
  const warm = [];
  for (const r of RECIPES) for (const k of [r.food, ...r.steps]) if (!warm.includes(k)) warm.push(k);
  let warmIn = WARM_START, stillT = 0, lastYaw = 0, lastPitch = 0;
  game.events.on('world:load', () => { warmIn = Math.max(warmIn, WARM_START); });
  game.addSystem({
    name: 'cooking-warmup',
    update(dt) {
      if (!warm.length || game.mode !== 'play' || game.loading || !game.thumbs) return;
      const pl = game.player, rig = game.cameraRig;
      let still = true;
      if (rig) {
        still = Math.abs(rig.yaw - lastYaw) < 1e-3 && Math.abs(rig.pitch - lastPitch) < 1e-3;
        lastYaw = rig.yaw;
        lastPitch = rig.pitch;
      }
      const v = pl && pl.velocity;
      if (v && (Math.hypot(v.x, v.z) > 0.2 || Math.abs(v.y) > 0.5 || pl.state === 'ride')) still = false;
      stillT = still || game.paused ? stillT + dt : 0;
      if ((warmIn -= dt) > 0 || stillT < WARM_STILL) return;
      const th = game.thumbs;
      if (th.queue && th.queue.length) { warmIn = WARM_GAP; return; }
      while (warm.length && th.has('food:' + warm[0])) warm.shift();
      // 'low': if the Basket or the Recipe Book asks for it meanwhile, their request moves it up
      if (warm.length) {
        const key = warm.shift();
        if (th.withPriority) th.withPriority('low', () => foodIcon(game, key));
        else foodIcon(game, key);
      }
      warmIn = WARM_GAP;
    },
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
