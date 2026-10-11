// Shops & Sparkle Coins (wave 2, DESIGN.md section 4 item 2): "we want to be able to buy candy
// and ice cream, all different types".
//
//   candy_shop        striped-awning stall with glass candy jars: twenty candies
//   ice_cream_parlor  glass freezer with tubs, a big cone sign: build your own ice cream
//   ice_cream_truck   pastel truck with a serving window (3x2): build your own, favorites
//
// Hand-tap a shop -> the 'shop' panel. Sparkle Coins (coins.js) are earned from gems,
// harvests, cooking, stickers, pets and a daily gift. Bought treats are basket foods keyed
// 'treat_*' (treats.js): eat them, feed pets, give them to friends, put them on tables, or hold
// one in her hand. Emits 'coins:change', 'coins:shown', 'shop:buy'. Sticker: 'sweet_tooth'.
//
// install(game) is called from src/things/cooking.js BEFORE the basket installs (the candies
// must be in FOOD by then, like the s'more).

import { ITEM_CATEGORIES } from '../../core/registry.js';
import { basketCount, basketAdd } from '../pets/kit.js';
import { FOOD } from '../food-models.js';
import { registerCandy, installTreats, isTreatKey } from './treats.js';
import { installCoins } from './coins.js';
import { installShopPanel } from './panel.js';
import { candyShop, iceCreamParlor, iceCreamTruck, SHOP_COLORS, TRUCK_COLORS, STALL_COLLIDERS, TRUCK_COLLIDERS } from './models.js';
import { CANDY } from './candy.js';
import * as IC from './icecream.js';
import { shopSfx } from './sfx.js';

export const SHOP_TAB = 'shops';

// ---------- the Sweet Tooth sticker (100 x 100 art, like the other teams' stickers) ----------

function paint(g, fill, stroke = 'rgba(58,31,77,0.45)', w = 2.6) {
  g.fillStyle = fill;
  g.fill();
  if (stroke) {
    g.lineJoin = 'round';
    g.strokeStyle = stroke;
    g.lineWidth = w;
    g.stroke();
  }
}

function sweetToothArt(g) {
  // a waffle cone with pink and mint scoops, a cherry, and a swirl lollipop leaning on it
  g.save();
  g.translate(62, 58);
  g.rotate(0.28);
  g.beginPath(); g.moveTo(-6, 0); g.lineTo(-6, 40); g.lineTo(6, 40); g.lineTo(6, 0); g.closePath(); paint(g, '#FFFFFF');
  g.beginPath(); g.arc(0, -14, 22, 0, Math.PI * 2); paint(g, '#9C7BFF');
  for (let i = 0; i < 26; i++) {
    const a = i * 0.55, r = 2 + i * 0.75;
    g.beginPath(); g.arc(Math.cos(a) * r, -14 + Math.sin(a) * r, 2.4, 0, Math.PI * 2); g.fillStyle = '#FFFFFF'; g.fill();
  }
  g.restore();
  g.beginPath(); g.moveTo(22, 50); g.lineTo(58, 50); g.lineTo(40, 94); g.closePath(); paint(g, '#E9B26C');
  g.strokeStyle = '#C98A45'; g.lineWidth = 2;
  for (const [a, b] of [[[28, 58], [48, 86]], [[36, 52], [52, 72]], [[52, 58], [32, 86]], [[44, 52], [28, 72]]]) { g.beginPath(); g.moveTo(...a); g.lineTo(...b); g.stroke(); }
  g.beginPath(); g.arc(40, 44, 18, Math.PI * 0.95, Math.PI * 2.05); g.lineTo(58, 50); g.lineTo(22, 50); g.closePath(); paint(g, '#FFB3C7');
  g.beginPath(); g.arc(40, 27, 14, 0, Math.PI * 2); paint(g, '#BDF2DA');
  const cols = ['#FF5FA2', '#FFC94D', '#3FD8B0', '#6CC6FF', '#9C7BFF'];
  [[30, 40, 0.5], [46, 37, -0.4], [38, 46, 1.2], [34, 24, -0.8], [45, 22, 0.3], [50, 44, 1]].forEach(([x, y, r], i) => {
    g.save(); g.translate(x, y); g.rotate(r); g.fillStyle = cols[i % 5]; g.fillRect(-3, -1.2, 6, 2.4); g.restore();
  });
  g.beginPath(); g.moveTo(42, 12); g.quadraticCurveTo(46, 2, 54, 0); g.strokeStyle = '#4FA557'; g.lineWidth = 2.4; g.stroke();
  g.beginPath(); g.arc(41, 13, 6, 0, Math.PI * 2); paint(g, '#E8203F');
  g.beginPath(); g.arc(39, 11, 2, 0, Math.PI * 2); g.fillStyle = '#fff'; g.fill();
  // sparkles
  for (const [x, y, s] of [[14, 20, 6], [86, 86, 5], [18, 76, 4]]) {
    g.beginPath();
    g.moveTo(x, y - s); g.quadraticCurveTo(x + s * 0.2, y - s * 0.2, x + s, y); g.quadraticCurveTo(x + s * 0.2, y + s * 0.2, x, y + s);
    g.quadraticCurveTo(x - s * 0.2, y + s * 0.2, x - s, y); g.quadraticCurveTo(x - s * 0.2, y - s * 0.2, x, y - s);
    paint(g, '#FFE27A', '#F2A91F', 1.4);
  }
}

export function install(game) {
  if (game.shops) return;
  // candies must be foods before the basket defines its table pieces and Bag items
  registerCandy();
  const coins = installCoins(game);
  const treats = installTreats(game);
  game.treats = treats;

  // ---------- the sticker ----------
  const reg = game.registry.stickers;
  const addSticker = () => {
    if (reg && !reg.has('sweet_tooth')) reg.set('sweet_tooth', { id: 'sweet_tooth', name: 'Sweet Tooth', hint: 'Buy a treat at a shop', icon: 'heart', art: sweetToothArt });
  };
  // after the core stickers (so it comes later in the book), like the pals team's
  game.events.on('game:ready', addSticker);

  // ---------- the Bag tab ----------
  if (!ITEM_CATEGORIES.some(([id]) => id === SHOP_TAB)) {
    let at = ITEM_CATEGORIES.findIndex(([id]) => id === 'camping');
    if (at < 0) at = ITEM_CATEGORIES.findIndex(([id]) => id === 'fun');
    ITEM_CATEGORIES.splice(at >= 0 ? at + 1 : ITEM_CATEGORIES.length, 0, [SHOP_TAB, 'Shops']);
  }

  // ---------- the shops (furniture) ----------
  const E = game.entities;
  const panel = game.ui ? installShopPanel(game, { treats, coins }) : null;
  if (E) {
    const defs = [
      { key: 'candy_shop', name: 'Candy Shop', shop: 'candy', colors: SHOP_COLORS, build: (c) => candyShop(c), colliders: STALL_COLLIDERS },
      { key: 'ice_cream_parlor', name: 'Ice Cream Parlor', shop: 'parlor', colors: [SHOP_COLORS[2], ...SHOP_COLORS.filter((c) => c !== SHOP_COLORS[2])], build: (c) => iceCreamParlor(c), colliders: STALL_COLLIDERS },
      { key: 'ice_cream_truck', name: 'Ice Cream Truck', shop: 'truck', colors: TRUCK_COLORS, build: (c) => iceCreamTruck(c), colliders: TRUCK_COLLIDERS },
    ];
    for (const d of defs) E.define({ category: SHOP_TAB, size: [3, 3, 2], actions: ['shop'], ...d });
    E.registerAction('shop', {
      run(g, entity) {
        if (!panel) return false;
        shopSfx(g, 'chime');
        return panel.open(entity.def.shop || 'candy', entity);
      },
      hint: (g, entity) => (entity.def.shop === 'candy' ? 'Tap to buy candy!' : 'Tap for ice cream!'),
    });
  }

  game.shops = {
    coins,
    treats,
    panel,
    candy: CANDY,
    icecream: IC,
    open: (kind = 'candy') => (panel ? panel.open(kind) : false),
  };

  if (game.debug) {
    game.debug.shops = {
      coins: () => coins.value,
      shown: () => coins.shown,
      earn: (n = 10, reason = 'debug') => coins.add(n, reason),
      setCoins(n) {
        game.profile.coins = Math.max(0, Math.floor(n));
        game.saveProfile();
        game.events.emit('coins:change', { coins: game.profile.coins, delta: 0, reason: 'debug' });
        return game.profile.coins;
      },
      gift: (force = true) => coins.gift({ force }),
      giftShowing: () => coins.giftShowing,
      open: (kind = 'candy', view = null) => (panel ? panel.open(kind, null, view) : false),
      state: () => (panel ? { ...panel.state, spec: { ...panel.state.spec } } : null),
      /** Buy a treat key (or an ice cream spec) like the panel does (spends coins). */
      buy(keyOrSpec) {
        const key = typeof keyOrSpec === 'string' ? keyOrSpec : IC.encode(keyOrSpec);
        if (!key || !treats.ensureTreat(key)) return false;
        const price = FOOD[key].price || 0;
        if (panel) return panel.buy(key, price, null);
        if (!coins.spend(price)) return false;
        basketAdd(game, key, 1);
        game.events.emit('shop:buy', { item: key, price, shop: 'debug', name: FOOD[key].name });
        return true;
      },
      key: (spec) => IC.encode(spec),
      price: (keyOrSpec) => (typeof keyOrSpec === 'string' ? treats.price(keyOrSpec) : IC.price(keyOrSpec)),
      treats: () => Object.keys(game.profile.basket || {}).filter((k) => isTreatKey(k) && basketCount(game, k) > 0),
      hold: (key) => treats.hold(key),
      held: () => treats.held,
      eating: () => treats.eating,
      eat: (key) => treats.eat(key),
      putAway: () => treats.putAway(),
      candyKeys: () => CANDY.map((c) => c.key),
    };
  }
}
