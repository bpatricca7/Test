// The basket: food you own (profile.basket counts). The 'basket' panel lets you Eat it,
// feed a pet, or put it on a table; the Bag's Food tab (and Garden tab for bouquets) lists
// what you own with counts. Food placed on tables is an entity ('food_<key>', placeOn
// 'table'): Hand-tap eats it, the Remove tool puts it back in the basket.

import * as THREE from 'three';
import { FOOD, foodModel, foodIcon, foodName } from '../food-models.js';
import { basketCount, basketAdd, basketTake, lifeButton, lifeHud, lifeIcon, Kit, VC_MAT } from '../pets/kit.js';
import { sfx } from '../pets/sfx.js';
import { disposeObject } from '../../core/models.js';

const CSS = /* css */ `
.lf-basket-top { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 6px; }
.lf-basket-top .lf-tipline { font-size: 16px; font-weight: 600; color: var(--sw-lav); flex: 1; min-width: 180px; }
.lf-foods { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px; }
.lf-food { position: relative; display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 10px 8px 10px; border-radius: 22px; background: #fff; border: 4px solid var(--sw-pink-soft); box-shadow: 0 4px 10px rgba(58,31,77,.1); }
.lf-food img.lf-pic { width: 84px; height: 84px; }
.lf-food-name { font-size: 18px; font-weight: 700; color: var(--sw-ink); text-align: center; line-height: 1.1; }
.lf-food .lf-count { position: absolute; top: 8px; right: 10px; min-width: 34px; height: 34px; padding: 0 8px; border-radius: 17px; background: var(--sw-pink); color: #fff; font-size: 17px; font-weight: 700; display: grid; place-items: center; border: 3px solid #fff; box-shadow: 0 2px 6px var(--sw-shadow); }
.lf-food-acts { display: flex; gap: 6px; flex-wrap: wrap; justify-content: center; }
.lf-food-acts .sw-btn { padding: 4px 12px; gap: 5px; min-height: 46px; font-size: 15px; }
.lf-empty-basket { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 18px; text-align: center; font-size: 20px; font-weight: 600; color: var(--sw-lav); }
.lf-empty-basket img { width: 110px; height: 110px; }
`;

const TABLE_SCALE = { meal: 1, crop: 0.95, flower: 1 };

function bookObject() {
  const g = new THREE.Group();
  const k = new Kit();
  k.cbox(0.62, 0.12, 0.48, '#FF8CC6', 0, 0.06, 0);
  k.cbox(0.58, 0.1, 0.44, '#FFFDF8', 0.02, 0.06, 0);
  k.cbox(0.62, 0.02, 0.48, '#FF6FB2', 0, 0.125, 0);
  k.cbox(0.06, 0.13, 0.48, '#FF6FB2', -0.3, 0.065, 0);
  // a cupcake on the cover
  k.cbox(0.16, 0.012, 0.1, '#FFB6D9', 0.04, 0.14, 0.05);
  k.cbox(0.2, 0.012, 0.1, '#FFFFFF', 0.04, 0.14, -0.04);
  k.cbox(0.05, 0.012, 0.05, '#FF3B5C', 0.04, 0.142, -0.1);
  k.cbox(0.04, 0.012, 0.3, '#FFC94D', 0.26, 0.14, 0.0);
  k.cbox(0.05, 0.01, 0.14, '#9C7BFF', -0.2, 0.135, 0.3);
  const m = new THREE.Mesh(k.geometry(), VC_MAT);
  m.rotation.set(0.5, -0.4, 0.1);
  g.add(m);
  return g;
}

export function installBasket(game, { openCooking }) {
  const ui = game.ui;
  const E = game.entities;
  ui.addStyles(CSS);
  const foodKeys = Object.keys(FOOD).filter((k) => FOOD[k].kind !== 'treat');

  // ---------- food on tables (entities) ----------
  if (E) {
    for (const key of foodKeys) {
      const f = FOOD[key];
      E.define({
        key: 'food_' + key,
        name: f.name,
        category: f.kind === 'flower' ? 'garden' : 'food',
        size: [1, 1, 1],
        colliders: 'none',
        placeOn: 'table',
        actions: [f.kind === 'flower' ? 'smell_flowers' : 'eat_food'],
        defaultData: { food: key },
        build: () => {
          const g = new THREE.Group();
          const m = foodModel(key);
          m.position.set(0.5, 0, 0.5);
          m.scale.setScalar(TABLE_SCALE[f.kind] || 1);
          g.add(m);
          return g;
        },
      });
      const auto = game.registry.items.get('furn:food_' + key);
      if (auto) auto.hidden = true;
    }
    E.registerAction('eat_food', {
      run(g, entity) {
        const key = entity.data.food;
        const p = E.localToWorld(entity, 0.5, 0.25, 0.5, new THREE.Vector3());
        E.remove(entity, { history: false, events: false, fx: false });
        eatEffect(key, p);
        g.events.emit('food:eat', { food: key });
        return true;
      },
      hint: (g, entity) => `Tap to eat the ${foodName(entity.data.food)}!`,
    });
    E.registerAction('smell_flowers', {
      run(g, entity) {
        const p = E.localToWorld(entity, 0.5, 0.5, 0.5, new THREE.Vector3());
        if (g.particles) {
          g.particles.emit('petal', p, { count: 10, spread: 0.6 });
          g.particles.emit('heart', p, { count: 4, spread: 0.3 });
        }
        sfx(g, 'chime');
        return true;
      },
      hint: () => 'Tap to smell the flowers',
    });
    // a placed dish came out of the basket; removing it puts it back
    // multiplayer: only this player's own placing / removing touches her basket (§9.11)
    game.events.on('entity:place', ({ entity }) => {
      if (game.net && game.net.remoteApplying) return;
      if (entity && entity.key.startsWith('food_') && entity.data && entity.data.food && basketCount(game, entity.data.food) > 0) {
        basketAdd(game, entity.data.food, -1);
      }
    });
    game.events.on('entity:remove', ({ entity }) => {
      if (game.net && game.net.remoteApplying) return;
      if (entity && entity.key.startsWith('food_') && entity.data && entity.data.food) basketAdd(game, entity.data.food, 1);
    });
  }

  // ---------- Bag items: food you own (with counts) ----------
  const items = new Map();
  for (const key of foodKeys) {
    const f = FOOD[key];
    const item = game.registry.items.register({
      key: 'food:' + key,
      name: f.name,
      category: f.kind === 'flower' ? 'garden' : 'food',
      kind: 'other',
      hidden: true,
      icon: () => foodIcon(game, key),
      use(g, hit) {
        if (basketCount(g, key) <= 0) {
          g.toast(f.kind === 'meal' ? `No more ${f.plural}! Cook some more!` : `No more ${f.plural}! Grow some more!`, { icon: 'sparkle' });
          return false;
        }
        if (!E || !hit) return false;
        const placed = E.placeFromHit('food_' + key, hit);
        return !!placed;
      },
    });
    items.set(key, item);
  }
  game.registry.items.register({
    key: 'food:recipe_book',
    name: 'Recipe Book',
    category: 'food',
    kind: 'other',
    icon: () => game.thumbs.get('item:recipe_book', () => bookObject(), { dir: [0.4, 1.1, 1.2], zoom: 0.85 }),
    use: () => {
      openCooking('counter');
      return true;
    },
  });
  const refreshItems = () => {
    for (const [key, item] of items) {
      const n = basketCount(game, key);
      item.hidden = n <= 0;
      item.name = n > 1 ? `${FOOD[key].plural || FOOD[key].name} ×${n}` : FOOD[key].name;
    }
  };
  refreshItems();
  game.events.on('basket:change', () => {
    refreshItems();
    if (ui.isOpen('basket')) render();
  });
  game.events.on('game:ready', refreshItems);
  game.events.on('profile:changed', refreshItems);

  // ---------- eating ----------
  const eaters = [];
  const _v = new THREE.Vector3();

  function eatEffect(key, at = null) {
    const pl = game.player;
    const m = foodModel(key);
    m.scale.setScalar(0.7);
    game.scene.add(m);
    eaters.push({ m, key, t: 0, dur: 1.7, at: at ? at.clone() : null, bites: 0 });
    sfx(game, 'pop', { pitch: 1.2 });
    if (pl && pl.state !== 'ride' && pl.state !== 'sleep' && pl.state !== 'sit') {
      pl.velocity.set(0, pl.velocity.y, 0);
    }
  }

  function eatNow(key) {
    if (!basketTake(game, key, 1)) {
      game.toast(`No ${foodName(key, 2)} in your basket!`, { icon: 'sparkle' });
      return false;
    }
    eatEffect(key);
    game.events.emit('food:eat', { food: key });
    return true;
  }

  game.addSystem({
    name: 'basket',
    update(dt) {
      if (!eaters.length) return;
      const pl = game.player;
      for (let i = eaters.length - 1; i >= 0; i--) {
        const e = eaters[i];
        e.t += dt;
        const u = Math.min(1, e.t / e.dur);
        if (e.at) {
          e.m.position.copy(e.at);
        } else if (pl) {
          // held up in her right hand, next to her face (visible over her shoulder)
          const yaw = pl.yaw;
          const up = pl.state === 'ride' && pl.mountPet ? 1.25 : pl.state === 'sit' ? 0.62 : 1.18;
          const fx = Math.sin(yaw), fz = Math.cos(yaw), rx = -Math.cos(yaw), rz = Math.sin(yaw);
          const bob = Math.abs(Math.sin(e.t * 5.5)) * 0.08;
          e.m.position.set(pl.position.x + fx * 0.3 + rx * 0.34, pl.position.y + up + bob, pl.position.z + fz * 0.3 + rz * 0.34);
          e.m.rotation.y = yaw + Math.PI + 0.6;
        }
        // three big bites
        const bites = Math.min(3, Math.floor(u * 3.4));
        if (bites > e.bites) {
          e.bites = bites;
          sfx(game, FOOD[e.key] && (e.key === 'smoothie' || e.key === 'carrot_soup' || e.key === 'ice_cream') ? 'slurp' : 'crunch');
          if (game.particles) {
            _v.copy(e.m.position);
            _v.y += 0.1;
            game.particles.emit('sparkle', _v, { count: 7, color: (FOOD[e.key] && FOOD[e.key].color) || '#FFFFFF', spread: 0.25, scale: 0.8 });
          }
        }
        const s = 0.7 * (1 - e.bites / 3.6) * (1 + Math.sin(e.t * 14) * 0.04);
        e.m.scale.setScalar(Math.max(0.05, s));
        if (u >= 1) {
          if (game.particles) {
            _v.copy(e.m.position);
            _v.y += 0.3;
            game.particles.emit('heart', _v, { count: 7 });
          }
          sfx(game, 'success', { volume: 0.6 });
          game.scene.remove(e.m);
          disposeObject(e.m);
          eaters.splice(i, 1);
          if (pl && pl.state !== 'ride' && pl.state !== 'sleep' && pl.state !== 'sit' && pl.emote) pl.emote('heart');
          game.toast(`Yummy ${FOOD[e.key] ? FOOD[e.key].name : 'treat'}!`, { icon: 'heart' });
        }
      }
    },
    onWorldUnload() {
      for (const e of eaters) { game.scene.remove(e.m); disposeObject(e.m); }
      eaters.length = 0;
    },
  });

  // ---------- the basket panel ----------
  let body;
  const section = (title, iconName) => {
    const s = ui.el('div', 'lf-section');
    s.innerHTML = lifeIcon(iconName);
    s.appendChild(document.createTextNode(title));
    return s;
  };

  const feedNearest = (key) => {
    const pl = game.player;
    const pets = game.pets;
    const pet = pl && pets ? pets.nearest(pl.position.x, pl.position.y, pl.position.z, 14) : null;
    if (!pet) {
      game.toast(pets && pets.pets.length ? 'Call a pet over first!' : 'Adopt a pet in the Bag to share food!', { icon: 'heart' });
      return;
    }
    ui.close();
    pets.feed(pet, key);
  };

  const toTable = (key) => {
    game.setSlot(game.hotbar.index, 'food:' + key);
    ui.close();
    game.toast(FOOD[key].kind === 'flower' ? 'Tap a table to put the flowers on it!' : `Tap a table to put the ${FOOD[key].name} on it!`, { icon: 'sparkle' });
  };

  const card = (key) => {
    const f = FOOD[key];
    const c = ui.el('div', 'lf-food');
    c.dataset.food = key;
    const img = ui.el('img', 'lf-pic');
    img.alt = '';
    img.style.visibility = 'hidden';
    foodIcon(game, key).then((u) => { if (u) { img.src = u; img.style.visibility = 'visible'; } });
    c.append(img, ui.el('div', 'lf-food-name', f.name), ui.el('span', 'lf-count', '×' + basketCount(game, key)));
    const acts = ui.el('div', 'lf-food-acts');
    if (f.kind === 'flower') {
      acts.append(
        lifeButton(ui, { icon: 'table', label: 'Vase', variant: 'lav', size: 'small', onClick: () => toTable(key) }),
        lifeButton(ui, { icon: 'heart', label: 'Smell', variant: 'pink', size: 'small', onClick: () => {
          const pl = game.player;
          if (pl && game.particles) {
            _v.set(pl.position.x, pl.position.y + 1.4, pl.position.z);
            game.particles.emit('petal', _v, { count: 12, spread: 0.8 });
            game.particles.emit('heart', _v, { count: 5 });
          }
          sfx(game, 'chime');
        } }),
      );
    } else {
      acts.append(
        lifeButton(ui, { icon: 'eat', label: 'Eat', variant: 'pink', size: 'small', className: 'lf-act-eat', onClick: () => { ui.close(); eatNow(key); } }),
        lifeButton(ui, { icon: 'paw', label: 'Pet', variant: 'mint', size: 'small', className: 'lf-act-pet', onClick: () => feedNearest(key) }),
        lifeButton(ui, { icon: 'table', label: 'Table', variant: 'lav', size: 'small', className: 'lf-act-table', onClick: () => toTable(key) }),
      );
    }
    c.appendChild(acts);
    return c;
  };

  const render = () => {
    body.innerHTML = '';
    const top = ui.el('div', 'lf-basket-top');
    top.append(
      lifeButton(ui, { icon: 'book', label: 'Cook', variant: 'sun', className: 'lf-open-cook', onClick: () => openCooking('counter') }),
      ui.el('div', 'lf-tipline', 'Cook yummy food, grow crops in the garden, and share with your pets!'),
    );
    body.appendChild(top);
    const owned = Object.keys(game.profile.basket || {}).filter((k) => FOOD[k] && basketCount(game, k) > 0);
    if (!owned.length) {
      const empty = ui.el('div', 'lf-empty-basket');
      const img = ui.el('img');
      img.alt = '';
      foodIcon(game, 'cupcake').then((u) => { img.src = u; });
      empty.append(img, ui.el('div', '', 'Your basket is empty! Cook something yummy or grow food in your garden.'));
      body.appendChild(empty);
      return;
    }
    const groups = [
      ['Yummy Food', 'cake', owned.filter((k) => FOOD[k].kind === 'meal')],
      ['From the Garden', 'leaf', owned.filter((k) => FOOD[k].kind === 'crop')],
      ['Flowers', 'sparkle', owned.filter((k) => FOOD[k].kind === 'flower')],
    ];
    for (const [title, ic, keys] of groups) {
      if (!keys.length) continue;
      body.appendChild(section(title, ic));
      const grid = ui.el('div', 'lf-foods');
      for (const k of keys) grid.appendChild(card(k));
      body.appendChild(grid);
    }
  };

  ui.registerPanel('basket', {
    title: 'My Basket',
    icon: 'star',
    width: 860,
    build(container) {
      body = ui.el('div', 'lf-basket');
      container.appendChild(body);
    },
    onOpen() {
      render();
    },
  });
  game.registerAction('basket', (g) => g.ui && g.ui.toggle('basket'));

  // HUD button (hidden when the HUD already shows its own Basket button)
  const hud = lifeHud(game);
  hud.add('basket', { icon: 'basket', label: 'Basket', color: 'var(--sw-sun)', order: 10, onClick: () => game.runAction('basket') });
  game.events.on('world:load', () => {
    hud.show('basket', true);
    setTimeout(() => {
      const other = ui.hudLayer.querySelector('.sw-hud [data-action="basket"], .sw-hud [aria-label="Basket"]');
      hud.show('basket', !other);
    }, 0);
  });

  return { eatNow, eatEffect, refreshItems };
}
