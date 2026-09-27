// Shop treats in the life team's food system, and holding one in her hand.
//
// Every treat is a basket food keyed 'treat_*' with FOOD[key].kind = 'sweet':
//  - candies: fixed keys registered at install (before the basket installs, like the s'more),
//    so the basket defines their table pieces ('food_treat_*') and Bag items ('food:treat_*');
//  - ice creams: self-describing keys ('treat_ic_<style>_<flavors>_<toppings>', icecream.js)
//    registered on demand by ensureTreat(key) (FOOD entry, baked model, Bag item). They stand
//    on tables as one shared piece, 'food_treat_ic', whose data.food is the key.
// The model of each treat is baked under 'food:<key>' in the pets kit cache, so foodModel(),
// foodIcon(), pets' snacks and friends' treats all draw it.
//
// Holding: a treat she selects in the hotbar is in her right hand (the avatar's hold() hook).
// "Hold" (shop, basket) puts it in a hotbar slot; the HUD shows Eat and Put away while she
// holds one. Build-tap a pet, a friend or a table uses the held treat as any food item does.

import * as THREE from 'three';
import { FOOD, foodModel, foodIcon } from '../food-models.js';
import { baked, basketCount, basketTake, lifeHud } from '../pets/kit.js';
import { disposeObject } from '../../core/models.js';
import { CANDY, CANDY_DRAW } from './candy.js';
import * as IC from './icecream.js';
import { shopSfx } from './sfx.js';
import { shopIcon } from './icons.js';

export const SWEET = 'sweet';
export const CUSTOM_TABLE = 'food_treat_ic';
const HAND = { rot: [0, 0, 0], y: -0.05, s: 0.9 };
const CANDY_BY_KEY = new Map(CANDY.map((c) => [c.key, c]));

/** FOOD entries + baked models for the candies (call before the basket installs). */
export function registerCandy() {
  for (const c of CANDY) {
    if (!FOOD[c.key]) FOOD[c.key] = { name: c.name, plural: c.plural, kind: SWEET, color: c.color, price: c.price, shop: 'candy' };
    baked('food:' + c.key, CANDY_DRAW[c.key]);
  }
}

export const isTreatKey = (key) => typeof key === 'string' && key.startsWith('treat_');

export function installTreats(game) {
  const items = game.registry.items;
  const E = game.entities;
  const dynamic = new Map(); // ice cream key -> Bag item
  let placeCustom = () => null; // (set below when there are entities)
  let dirty = true; // the held treat needs a look (hotbar, basket, world changed)

  const setItemName = (key, item) => {
    const f = FOOD[key], n = basketCount(game, key);
    item.hidden = n <= 0;
    item.name = n > 1 ? `${f.plural || f.name} ×${n}` : f.name;
  };

  /** Make sure a treat key is known (ice creams are registered the first time they show up). */
  function ensureTreat(key) {
    if (!isTreatKey(key)) return false;
    if (FOOD[key]) return true;
    const spec = IC.decode(key);
    if (!spec) return false;
    FOOD[key] = { name: IC.name(spec), plural: IC.plural(spec), kind: SWEET, color: IC.colorOf(spec), price: IC.price(spec), shop: 'icecream', slurp: true };
    baked('food:' + key, IC.drawIceCream(spec));
    const item = items.register({
      key: 'food:' + key,
      name: FOOD[key].name,
      category: 'food',
      kind: 'other',
      hidden: true,
      icon: () => foodIcon(game, key),
      use(g, hit) {
        if (basketCount(g, key) <= 0) {
          g.toast(`No more ${FOOD[key].plural}! Visit an ice cream shop!`, { icon: 'sparkle' });
          return false;
        }
        return !!placeCustom(key, hit);
      },
    });
    dynamic.set(key, item);
    setItemName(key, item);
    return true;
  }

  // ---------- ice creams on tables: one piece, data.food = the key ----------
  if (E) {
    const def = E.define({
      key: CUSTOM_TABLE,
      name: 'Ice Cream',
      category: 'food',
      size: [1, 1, 1],
      colliders: 'none',
      placeOn: 'table',
      actions: ['eat_food'],
      defaultData: { food: '' },
      build: (color, data) => {
        const g = new THREE.Group();
        const key = data && data.food;
        const m = ensureTreat(key) ? foodModel(key) : foodModel(IC.encode(IC.FAVORITES[1].spec) || 'ice_cream');
        m.position.set(0.5, 0, 0.5);
        g.add(m);
        return g;
      },
    });
    const it = items.get('furn:' + CUSTOM_TABLE);
    if (it) it.hidden = true;
    // placeFromHit takes no data: this piece's default data names the treat just for that call
    placeCustom = (key, hit) => {
      const was = def.defaultData;
      def.defaultData = { food: key };
      try {
        return E.placeFromHit(CUSTOM_TABLE, hit);
      } finally {
        def.defaultData = was;
      }
    };
    // a saved ice cream on a table knows its treat before the basket asks for its name
    game.events.on('entity:place', ({ entity }) => {
      if (entity && entity.key === CUSTOM_TABLE && entity.data) ensureTreat(entity.data.food);
    });
  }

  const refreshDynamic = () => {
    for (const [key, item] of dynamic) setItemName(key, item);
  };
  // treats she already owns (ice creams from earlier days) are known before anything asks
  const scanProfile = () => {
    const b = (game.profile && game.profile.basket) || {};
    for (const k of Object.keys(b)) if (isTreatKey(k)) ensureTreat(k);
    refreshDynamic();
  };
  game.events.on('game:ready', scanProfile);
  game.events.on('profile:changed', scanProfile);
  game.events.on('basket:change', ({ key }) => {
    if (isTreatKey(key)) ensureTreat(key);
    refreshDynamic();
    dirty = true;
  });

  /** A new Object3D of the treat as she holds it (friends use it too; the caller disposes it). */
  function model(key) {
    if (!ensureTreat(key)) return null;
    const c = CANDY_BY_KEY.get(key);
    const spec = c ? null : IC.decode(key);
    const h = { ...HAND, ...((c && c.hand) || (spec && IC.handOf(spec)) || {}) };
    const inner = foodModel(key);
    inner.rotation.set(h.rot[0], h.rot[1], h.rot[2]);
    inner.position.y = h.y;
    const g = new THREE.Group();
    g.name = 'treat:' + key;
    g.scale.setScalar(h.s);
    g.add(inner);
    g.userData.inner = inner;
    return g;
  }

  // ---------- holding ----------

  let heldKey = null, heldObj = null, heldAv = null; // what is in her hand, on which avatar
  let eating = null; // { key, t, dur, bites, obj }
  const _v = new THREE.Vector3();

  const avatar = () => (game.player && game.player.avatar) || null;
  const canHold = (av) => !!av && typeof av.hold === 'function';

  /** The treat she should be holding: the selected hotbar item, while she has one. */
  function wanted() {
    if (game.mode !== 'play' || !game.player || !game.hotbar) return null;
    const key = game.hotbar.slots[game.hotbar.index];
    if (!key || !key.startsWith('food:treat_')) return null;
    const k = key.slice(5);
    return basketCount(game, k) > 0 && ensureTreat(k) ? k : null;
  }

  function letGo() {
    if (heldAv && canHold(heldAv) && heldAv.held === heldObj) heldAv.hold(null);
    if (heldObj) disposeObject(heldObj);
    heldObj = null;
    heldKey = null;
    heldAv = null;
  }

  function sync() {
    dirty = false;
    const av = avatar();
    if (eating) return;
    const k = canHold(av) ? wanted() : null;
    if (k === heldKey && av === heldAv) return;
    letGo();
    if (!k) return;
    heldObj = model(k);
    if (!heldObj) return;
    heldKey = k;
    heldAv = av;
    av.hold(heldObj, 'hold');
  }

  /** Put a treat in her hand (a hotbar slot: the one holding it, an empty one, or this one). */
  function hold(key, { quiet = false } = {}) {
    if (!ensureTreat(key) || basketCount(game, key) <= 0 || !game.hotbar) return false;
    const itemKey = 'food:' + key;
    let slot = game.hotbar.slots.indexOf(itemKey);
    if (slot < 0) slot = game.hotbar.slots.indexOf(null);
    if (slot < 0) slot = game.hotbar.index;
    game.setSlot(slot, itemKey);
    dirty = true;
    sync();
    if (!quiet) {
      shopSfx(game, 'pop', { pitch: 1.2 });
      game.toast(`You're holding a ${FOOD[key].name}! Tap Eat, or share it!`, { icon: 'heart', key: 'treat-hold' });
    }
    return true;
  }

  /** Put the held treat away (it stays in the basket). */
  function putAway() {
    const key = heldKey;
    if (!key || !game.hotbar) return false;
    const i = game.hotbar.index;
    if (game.hotbar.slots[i] === 'food:' + key) game.setSlot(i, null);
    letGo();
    dirty = true;
    shopSfx(game, 'pop', { pitch: 0.9 });
    const pl = game.player;
    if (pl && game.particles) game.particles.emit('sparkle', _v.set(pl.position.x, pl.position.y + 1, pl.position.z), { count: 8, spread: 0.3 });
    game.toast(`${FOOD[key].name} is back in your basket!`, { icon: 'check', key: 'treat-hold' });
    return true;
  }

  /** Eat one (from her hand, three big bites); falls back to the basket's eating elsewhere. */
  function eat(key = heldKey) {
    if (!key || !ensureTreat(key)) return false;
    if (eating) return false;
    const av = avatar();
    const pl = game.player;
    const busy = !pl || pl.state === 'sleep' || pl.state === 'swim' || !canHold(av);
    if (busy) return game.cooking ? game.cooking.eat(key) : false;
    if (!basketTake(game, key, 1)) {
      game.toast(`No ${FOOD[key].plural} in your basket!`, { icon: 'heart' });
      return false;
    }
    letGo();
    const obj = model(key);
    av.hold(obj, 'eat');
    eating = { key, t: 0, dur: 2.1, bites: 0, obj, av };
    shopSfx(game, 'pop', { pitch: 1.2 });
    if (pl.state === 'walk' && pl.velocity) pl.velocity.set(0, pl.velocity.y, 0);
    game.events.emit('food:eat', { food: key });
    return true;
  }

  function stopEating(finished) {
    const e = eating;
    if (!e) return;
    eating = null;
    if (e.av && canHold(e.av) && e.av.held === e.obj) e.av.hold(null);
    const pl = game.player;
    if (finished && pl) {
      e.obj.getWorldPosition(_v);
      if (game.particles) game.particles.emit('heart', _v.set(pl.position.x, pl.position.y + 1.9, pl.position.z), { count: 8 });
      shopSfx(game, 'success', { volume: 0.6 });
      shopSfx(game, 'mmm');
      game.toast(`Yummy ${FOOD[e.key].name}!`, { icon: 'heart' });
      if (pl.state === 'walk' && pl.emote) pl.emote('heart');
    }
    disposeObject(e.obj);
    dirty = true;
  }

  function tickEating(dt) {
    const e = eating;
    if (!e) return;
    if (!game.player || avatar() !== e.av) return stopEating(false);
    e.t += dt;
    const u = e.t / e.dur;
    const bites = Math.min(3, Math.floor(u * 3.4 + 0.15));
    if (bites > e.bites) {
      e.bites = bites;
      shopSfx(game, FOOD[e.key].slurp ? 'slurp' : 'crunch');
      const inner = e.obj.userData.inner;
      if (inner) inner.scale.setScalar(Math.max(0.05, 1 - bites * 0.3));
      if (game.particles) {
        e.obj.getWorldPosition(_v);
        _v.y += 0.15;
        game.particles.emit('sparkle', _v, { count: 7, color: FOOD[e.key].color || '#FFFFFF', spread: 0.2, scale: 0.8 });
      }
    }
    if (u >= 1) stopEating(true);
  }

  // ---------- HUD: Eat / Put away while she holds a treat ----------
  const hud = game.ui ? lifeHud(game) : null;
  if (hud) {
    const eatBtn = hud.add('treat-eat', { icon: 'eat', label: 'Eat', color: 'var(--sw-pink)', order: 30, onClick: () => eat() });
    const awayBtn = hud.add('treat-away', { icon: 'basket', label: 'Put away', color: 'var(--sw-lav)', order: 31, onClick: () => putAway() });
    eatBtn.querySelector('.sw-round-face').innerHTML = shopIcon('bite');
    awayBtn.querySelector('.sw-round-face').innerHTML = shopIcon('away');
    eatBtn.classList.add('sh-hud-eat');
    awayBtn.classList.add('sh-hud-away');
  }
  let shown = false;
  const showHud = (on) => {
    if (!hud || on === shown) return;
    shown = on;
    hud.show('treat-eat', on);
    hud.show('treat-away', on);
  };

  game.events.on('hotbar:change', () => { dirty = true; });
  game.events.on('world:load', () => { dirty = true; });
  game.events.on('world:unload', () => { stopEating(false); letGo(); showHud(false); });

  game.addSystem({
    name: 'treats',
    update(dt) {
      if (eating) tickEating(dt);
      const av = avatar();
      if (dirty || av !== heldAv || (heldKey && basketCount(game, heldKey) <= 0)) sync();
      showHud(!!heldKey && !eating && game.mode === 'play');
    },
    onWorldUnload() {
      stopEating(false);
      letGo();
    },
  });

  return {
    ensureTreat,
    model,
    hold,
    putAway,
    eat,
    isTreat: isTreatKey,
    get held() { return eating ? eating.key : heldKey; },
    get eating() { return !!eating; },
    name: (key) => (ensureTreat(key) ? FOOD[key].name : key),
    price: (key) => (ensureTreat(key) ? FOOD[key].price || 0 : 0),
    icon: (key) => (ensureTreat(key) ? foodIcon(game, key) : Promise.resolve('')),
  };
}
