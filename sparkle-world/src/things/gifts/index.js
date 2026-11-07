// The Gift Workshop (wave 5, docs/teams/gifts.md; plan: docs/teams/wave5-plan.md §7.5).
//
// She makes a gift at the Workshop bench (a 4-step panel with a live 3D preview: a toy of our
// own or a treat from her basket, a box, paper and pattern, ribbon and bow, then "Wrap it!"),
// tags it for someone and holds it in her hands (the treats' and squishy toys' hold contract: the
// selected hotbar slot holds 'gift:hand'). Then she:
//   - gives it to a friend in her world (tap the friend, or the Give button): the friend unwraps
//     it, says thank you and keeps the toy a while; or
//   - puts it down (tap the floor, or Put down): a `gift_box` that anyone, a friend playing with
//     her too, taps to open: confetti, "From <name>!", the toy for the opener's Bag.
// Surprise presents round the holiday tree (holiday:presents) open to a toy and come back
// wrapped every new game day. Three stickers, a little coin for giving (10 a day at most).
// Nothing is bought; nobody loses anything.

import * as THREE from 'three';
import * as D from './data.js';
import * as M from './models.js';
import { giftSfx } from './sfx.js';
import { STICKER_ART, ICONS } from './art.js';
import { installPanel } from './panel.js';
import { createGiver } from './give.js';
import { lifeHud, basketAdd, basketTake, basketCount } from '../pets/kit.js';
import { partsOf } from '../furniture/kit.js';
import { disposeObject } from '../../core/models.js';
import { nameUnset } from '../../player/wardrobe-data.js';
import { FOOD } from '../food-models.js';

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const HAND = 'gift:hand'; // the Bag / hotbar item that is "the gift in her hands"
const TAB = 'holiday';
const BOX = 'gift_box';
const BENCH = 'gift_workshop';
const TOY_PREFIX = 'gift_toy_';
const GIVE_RANGE = 5; // blocks: the Give button shows with a friend this near

export function install(game) {
  const E = game.entities;
  const items = game.registry.items;
  const ev = game.events;
  const remote = () => !!(game.net && game.net.remoteApplying);
  const guest = () => !!(game.net && game.net.isGuest);
  const profile = () => game.profile;

  /** profile.gifts, repaired (created when missing). Call before changing it. */
  const ensure = () => (profile() ? D.ensureGifts(profile()) : null);
  /** profile.gifts as it is (no repair, no allocation): for per-frame reads. */
  const rd = () => {
    const p = profile();
    const s = p && p.gifts;
    return isObj(s) && Array.isArray(s.sack) ? s : null;
  };
  const sackSize = () => { const s = rd(); return s ? s.sack.length : 0; };
  const front = () => { const s = rd(); return s && s.sack.length ? s.sack[0] : null; };
  const save = () => { if (game.saveProfile) game.saveProfile(); };

  /** Her name on a gift's From: (the name friends see when playing together). */
  function myName() {
    try {
      if (game.net && game.net.active && typeof game.net.players === 'function') {
        const me = game.net.players().find((pl) => pl && pl.you);
        const n = me && D.cleanName(me.name);
        if (n) return n;
      }
    } catch { /* fall back to the profile */ }
    const p = profile();
    const unset = !!game.surpriseStyle && game.surpriseStyle() === 'boy' && nameUnset(p);
    const n = unset ? '' : D.cleanName((p && p.look && p.look.name) || (p && p.playerName) || '');
    return n || 'a friend';
  }

  const toyName = (inside) => {
    if (D.treatOf(inside)) return 'treat';
    const it = D.toy(inside);
    return it ? it.name : 'toy';
  };

  let idSeq = 0;
  const newId = () => D.newId(D.seeded((Date.now() ^ (++idSeq * 2654435761)) >>> 0));

  // ---------------- furniture: the Workshop, presents, the toys ----------------

  // a placed piece rebuilds with its moving parts while it animates (else it batches)
  const LIVE = new WeakSet();
  let boxDef = null;
  if (E) {
    E.define({
      key: BENCH,
      name: D.STRINGS.workshop,
      category: TAB,
      size: [2, 2, 1],
      colors: M.WORKSHOP_COLORS,
      placeOn: 'floor',
      colliders: [[0, 0, 0.05, 2, 0.92, 1], [0, 0.92, 0, 2, 2, 0.2]],
      light: 9,
      lightPos: [1, 1.7, 0.6],
      actions: ['gift-workshop'],
      build: (color) => M.workshopModel(color),
    });
    E.registerAction('gift-workshop', {
      run(g) {
        if (!g.ui) return false;
        giftSfx(g, 'crinkle', { volume: 0.7 });
        return g.ui.open('gift-workshop');
      },
      hint: () => D.STRINGS.hintWorkshop,
    });

    boxDef = E.define({
      key: BOX,
      name: D.STRINGS.surprise,
      category: TAB,
      size: [1, 1, 1],
      colliders: 'none',
      placeOn: 'table',
      actions: ['gift-open'],
      defaultData: D.giftData(D.DEFAULT_GIFT),
      build: (color, data) => (data && data.open ? M.openedModel(data, { live: LIVE.has(data) }) : M.giftModel(data, { cell: true })),
      update: (entity, dt) => tickPiece(entity, dt),
    });
    // the Bag's Surprise Present: a random wrapped toy from her, for anyone to open
    const boxItem = items.get('furn:' + BOX);
    if (boxItem) {
      boxItem.order = 2;
      boxItem.use = (g, hit) => {
        const rand = D.seeded((Date.now() ^ (++idSeq * 40503)) >>> 0);
        const gift = D.randomGift(rand, { from: myName(), to: D.ANYONE });
        gift.ribbon = D.ribbonFor(gift.paper, rand);
        return !!placeWith(D.giftData(gift), () => E.placeFromHit(BOX, hit));
      };
    }
    D.TOYS.forEach((t, i) => {
      const key = TOY_PREFIX + t.key;
      E.define({
        key,
        name: t.name,
        category: TAB,
        size: [1, 1, 1],
        colliders: 'none',
        placeOn: 'table',
        actions: ['gift-toy'],
        defaultData: {},
        build: (color, data) => M.toyModel(t.key, { cell: true, part: !!data && LIVE.has(data), hitbox: true }),
        update: (entity, dt) => tickPiece(entity, dt),
      });
      const it = items.get('furn:' + key);
      if (it) {
        it.hidden = true; // in the Bag once a present gave it to her
        it.order = 10 + i;
        it.icon = () => game.thumbs.get('gift:toy:' + t.key, () => M.toyModel(t.key), { dir: [0.45, 0.42, 1] });
      }
    });

    E.registerAction('gift-open', {
      run: (g, entity) => openBox(entity),
      hint: (g, entity) => {
        const d = entity.data || {};
        return d.open ? D.fmt('hintPlay', { toy: toyName(d.inside) }) : D.STRINGS.hintOpen;
      },
    });
    E.registerAction('gift-toy', {
      run: (g, entity) => {
        hop(entity, entity.key.slice(TOY_PREFIX.length));
        return true;
      },
      hint: (g, entity) => D.fmt('hintPlay', { toy: toyName(entity.key.slice(TOY_PREFIX.length)) }),
    });
  }

  /** Place a gift_box with these data through place() (placeFromHit or place). */
  function placeWith(data, place) {
    if (!boxDef) return null;
    const was = boxDef.defaultData;
    boxDef.defaultData = data; // placeFromHit takes no data (the treats' way)
    try {
      return place();
    } finally {
      boxDef.defaultData = was;
    }
  }

  // ---------------- animations of placed pieces ----------------

  function animate(entity, kind, secs) {
    entity._gift = { kind, t: 0, secs };
    if (!LIVE.has(entity.data)) {
      LIVE.add(entity.data);
      E.refresh(entity);
    }
  }
  function settle(entity) {
    entity._gift = null;
    if (LIVE.has(entity.data)) {
      LIVE.delete(entity.data);
      E.refresh(entity);
    }
  }
  function tickPiece(entity, dt) {
    const a = entity._gift;
    if (!a) return;
    a.t += Math.min(0.1, Math.max(0, Number.isFinite(dt) ? dt : 0));
    const toy = partsOf(entity).toy;
    const k = D.clamp01(a.t / a.secs);
    if (toy) {
      if (toy.userData.baseY === undefined) toy.userData.baseY = toy.position.y;
      const base = toy.userData.baseY;
      if (a.kind === 'open') {
        // up out of the box with a pop and a spin
        toy.scale.setScalar(Math.max(0.05, D.popCurve(Math.min(1, k * 1.4))));
        toy.position.y = base - 0.18 * (1 - Math.min(1, k * 1.6)) + Math.sin(k * Math.PI) * 0.22;
        toy.rotation.y = (1 - k) * Math.PI * 2;
      } else {
        const sq = Math.sin(k * Math.PI * 4) * 0.06;
        toy.position.y = base + Math.abs(Math.sin(k * Math.PI * 2)) * 0.16 * (1 - k * 0.5);
        toy.rotation.y = Math.sin(k * Math.PI * 2) * 0.3;
        toy.scale.set(1 + sq, 1 - sq, 1 + sq);
      }
    }
    if (a.t >= a.secs) settle(entity);
  }

  function hop(entity, toyKey) {
    animate(entity, 'hop', 0.7);
    const t = D.toy(toyKey);
    giftSfx(game, t ? t.sound : 'pop');
    const p = E.localToWorld(entity, 0.5, 0.6, 0.5);
    if (game.particles) game.particles.emit('sparkle', p, { count: 6, color: t ? t.color : '#FFD43B' });
  }

  // ---------------- opening a present ----------------

  const forMe = (name) => !!name && name.toLowerCase() === myName().toLowerCase();

  /** The name of another player here now that this present is tagged for, or null. */
  function forSomeoneElse(d) {
    if (!d || !d.to || d.tree || forMe(d.to) || !game.net || !game.net.active || typeof game.net.players !== 'function') return null;
    const to = d.to.toLowerCase();
    const there = game.net.players().find((pl) => pl && !pl.you && D.cleanName(pl.name).toLowerCase() === to);
    return there ? d.to : null;
  }

  function openBox(entity) {
    const d = entity.data || {};
    if (d.open) {
      hop(entity, D.treatOf(d.inside) ? null : D.toy(d.inside) ? d.inside : 'teddy');
      return true;
    }
    const other = forSomeoneElse(d);
    if (other) {
      // tagged for a friend playing here: a little wiggle, the friend opens it
      giftSfx(game, 'wiggle');
      if (game.particles) game.particles.emit('heart', E.localToWorld(entity, 0.5, 0.6, 0.5), { count: 4 });
      game.toast(D.fmt('placed', { to: other }), { icon: 'heart', key: 'gift-hint' });
      return true;
    }
    E.setData(entity, { open: 1 }); // 'open' may be patched by anyone (multiplayer ANY_FIELDS)
    animate(entity, 'open', 0.9);
    // the burst: confetti in the paper's and ribbon's colors, stars, the unwrap sound
    const pap = D.paper(d.paper), rib = D.ribbon(d.ribbon);
    const at = E.localToWorld(entity, 0.5, 0.45, 0.5);
    if (game.particles) {
      game.particles.emit('confetti', at, { count: 26, colors: [pap.color, pap.ink, pap.ink2, rib.color], spread: 0.3 });
      game.particles.emit('star', at, { count: 8, color: '#FFE38A' });
    }
    giftSfx(game, 'unwrap');
    // what was inside goes to the opener: a toy for the Bag (decor), a treat for the basket
    const t = D.treatOf(d.inside);
    const s = ensure();
    let firstToy = false;
    if (s) {
      s.opened = (s.opened || 0) + 1;
      if (!t && D.toy(d.inside)) {
        firstToy = !s.toys[d.inside];
        s.toys[d.inside] = 1;
      }
    }
    if (t) basketAdd(game, t, 1);
    save();
    refreshBag();
    const from = d.from || (d.tree ? D.TREE_FROM : 'a friend');
    const msg = t ? D.fmt('openedTreat', { from }) : D.fmt(d.to && !forMe(d.to) ? 'openedTo' : 'opened', { toy: toyName(d.inside), from, to: d.to });
    game.toast(msg, { icon: 'star', big: true, color: 'pink', key: 'gift-open' });
    if (firstToy) setTimeout(() => game.toast(D.fmt('newToy', { toy: toyName(d.inside) }), { icon: 'bag', key: 'gift-newtoy' }), 900);
    ev.emit('gift:open', { inside: d.inside, from: d.from || '', to: d.to || '', tree: !!d.tree });
    return true;
  }

  // ---------------- the Bag: the gift in her hands, toys she got ----------------

  const handItem = items.register({
    key: HAND,
    name: D.STRINGS.myGifts,
    category: TAB,
    kind: 'other',
    hidden: true,
    order: 1,
    icon: () => game.thumbs.get('gift:hand', () => M.giftModel(D.DEFAULT_GIFT), { dir: [0.5, 0.45, 1] }),
    use: (g, hit) => !!putDownAt(hit),
  });

  function refreshBag() {
    const n = sackSize();
    handItem.hidden = n <= 0;
    handItem.name = n > 1 ? `${D.STRINGS.myGifts} ×${n}` : D.STRINGS.myGifts;
    const s = rd();
    for (const t of D.TOYS) {
      const it = items.get('furn:' + TOY_PREFIX + t.key);
      if (it) it.hidden = !(s && isObj(s.toys) && s.toys[t.key]);
    }
  }

  // ---------------- holding the gift (the treats' and squishy toys' hold contract) ----------------

  let heldObj = null, heldSig = null, heldAv = null, seenAv = null, heldEntry = null;
  let dirtyHold = true;
  const avatar = () => (game.player && game.player.avatar) || null;
  const canHold = (av) => !!av && typeof av.hold === 'function';

  /** The gift she should hold: the front of her shelf while the selected slot is My Gifts. */
  function wanted() {
    if (game.mode !== 'play' || !game.player || !game.hotbar) return null;
    if (game.hotbar.slots[game.hotbar.index] !== HAND) return null;
    return front();
  }

  function letGo() {
    if (heldAv && canHold(heldAv) && heldAv.held === heldObj) heldAv.hold(null);
    if (heldObj) disposeObject(heldObj);
    heldObj = null;
    heldSig = null;
    heldAv = null;
    heldEntry = null;
  }

  // the giving animation (give.js); its callbacks below
  const giver = createGiver(game, {
    onHand: (f, entry) => {
      // the friend has it now: the toy (or the treat) in the friend's hands
      const sys = game.friends;
      const t = D.treatOf(entry.inside);
      const model = t ? M.insideModel(entry.inside) : M.heldToyModel(entry.inside);
      if (sys && typeof sys.receiveGift === 'function') sys.receiveGift(f, { toy: toyName(entry.inside), treat: t, model, secs: D.TOY_LIFE });
      else disposeObject(model);
    },
    onDone: () => { dirtyHold = true; },
  });

  function syncHold() {
    dirtyHold = false;
    const av = avatar();
    seenAv = av;
    if (game.treats && game.treats.eating) return; // the treat takes the hand
    const e = canHold(av) && !giver.flying() ? wanted() : null;
    const sig = e ? e.id + '|' + D.heldKeyOf(e) : null;
    if (sig === heldSig && av === heldAv && (!heldObj || av.held === heldObj)) return;
    letGo();
    if (!e) return;
    heldObj = M.heldGiftModel(e);
    heldSig = sig;
    heldEntry = e;
    heldAv = av;
    av.hold(heldObj, 'hold');
  }

  /** Is the gift showing in her hand (not while she swims or has a tail)? */
  const heldShows = () => {
    const av = avatar();
    return !!heldObj && !(av && av.heldShown === false);
  };

  /** Put a gift from her shelf in her hands (My Gifts in a hotbar slot, the Build tool). */
  function hold(id = null, { quiet = false } = {}) {
    const s = ensure();
    if (!s || !s.sack.length || !game.hotbar) return false;
    if (id) D.sackFront(s, id);
    save();
    let slot = game.hotbar.slots.indexOf(HAND);
    if (slot < 0) slot = game.hotbar.slots.indexOf(null);
    if (slot < 0) slot = game.hotbar.index;
    game.setSlot(slot, HAND);
    refreshBag();
    dirtyHold = true;
    syncHold();
    showHud(true);
    if (!quiet) giftSfx(game, 'crinkle', { volume: 0.6 });
    const e = s.sack[0];
    const npc = e.to && npcNamed(e.to);
    game.toast(e.to ? D.fmt(npc ? 'holdNpc' : 'holdPlayer', { to: e.to }) : D.STRINGS.holdAnyone, { icon: 'heart', key: 'gift-hold' });
    return true;
  }

  function putAway({ quiet = false } = {}) {
    if (!game.hotbar) return false;
    const i = game.hotbar.slots.indexOf(HAND);
    if (i < 0) return false;
    game.setSlot(i, null);
    letGo();
    dirtyHold = true;
    showHud(true);
    if (!quiet) {
      giftSfx(game, 'fold');
      game.toast(D.STRINGS.away, { icon: 'check', key: 'gift-hold' });
    }
    return true;
  }

  /** After a gift leaves her hands: the next one comes up, or My Gifts leaves the hotbar. */
  function nextOrEmpty() {
    refreshBag();
    dirtyHold = true;
    if (sackSize() > 0) {
      setTimeout(() => {
        if (game.hotbar && game.hotbar.slots[game.hotbar.index] === HAND && sackSize() > 0) game.toast(D.STRINGS.nextGift, { icon: 'heart', key: 'gift-hold' });
      }, 3400);
    } else if (game.hotbar) {
      const i = game.hotbar.slots.indexOf(HAND);
      if (i >= 0) game.setSlot(i, null);
    }
    showHud(true);
  }

  // ---------------- giving and putting down ----------------

  const friendsList = () => (game.friends && Array.isArray(game.friends.friends) ? game.friends.friends : []);
  const npcNamed = (name) => {
    const n = D.cleanName(String(name || '')).toLowerCase();
    return n ? friendsList().find((f) => f && D.cleanName(String(f.name || '')).toLowerCase() === n) || null : null;
  };

  /** Coins, counters, stickers and the event for one gift given (to a friend or put down). */
  function gave(entry, { npc = null, placed = false } = {}) {
    const s = ensure();
    if (!s) return;
    s.given = (s.given || 0) + 1;
    const pay = D.payForGift(s, D.dayStamp(new Date()), D.GIVE_COINS, D.DAY_CAP);
    save();
    if (pay > 0 && game.coins && typeof game.coins.add === 'function') {
      const pl = game.player && game.player.position;
      game.coins.add(pay, 'gift', pl ? { at: { x: pl.x, y: pl.y + 1.8, z: pl.z } } : undefined);
    }
    if (npc || (placed && entry.to)) game.award('gift_giver');
    if (s.given >= 10) game.award('gift_ten');
    ev.emit('gift:give', { to: entry.to || '', npc: npc ? npc.name : null, placed: !!placed, inside: entry.inside });
  }

  /** Give the gift in her hands to a friend in her world (tap, or the Give button). */
  function giveTo(f) {
    const e = heldEntry || wanted();
    if (!e || !f) return false;
    // one gift in the air at a time; a tap on the friend meanwhile does nothing (it must not
    // fall through to the Build tap and put the next gift down beside the friend)
    if (giver.busy()) return true;
    if (f.act === 'sleep' || f.act === 'toBed') {
      game.toast(D.fmt('sleeping', { friend: f.name }), { icon: 'moon', key: 'gift-hint' });
      return true;
    }
    // a gift tagged for someone else: the friend points it out, nothing is given
    if (e.to && e.to.toLowerCase() !== D.cleanName(String(f.name || '')).toLowerCase()) {
      if (game.friends && typeof game.friends.say === 'function') {
        f.faceT = 3;
        game.friends.say(f, 'giftOther', { extra: { to: e.to } });
      }
      return true;
    }
    const s = ensure();
    const taken = s && D.sackTake(s, e.id);
    if (!taken) return false;
    save();
    // the gift leaves her hands and flies to the friend
    const from = heldObj ? heldObj.getWorldPosition(new THREE.Vector3()) : null;
    letGo();
    giver.start(f, taken, from);
    gave(taken, { npc: f });
    nextOrEmpty();
    return true;
  }

  /** A history entry that puts the gift back on her shelf when its present is taken back. */
  function shelfHistory(entry, entity) {
    const uid = entity.uid;
    game.pushHistory({
      undo: () => {
        const e = E.byUid(uid);
        if (e && e.data && e.data.open) return; // opened already: the toy is out
        const s = ensure();
        if (s && D.sackReturn(s, entry)) {
          s.given = Math.max(0, (s.given || 0) - 1);
          save();
          refreshBag();
          dirtyHold = true;
        }
      },
      redo: () => {
        const s = ensure();
        if (s && D.sackTake(s, entry.id)) {
          s.given = (s.given || 0) + 1;
          save();
          refreshBag();
          dirtyHold = true;
        }
      },
    });
  }

  /** Put the gift in her hands down as a present: from a pick (a tap) or in front of her. */
  function putDownAt(hit) {
    const e = heldEntry || wanted() || front();
    if (!e || !E) return null;
    // the Put down button skips the Build tap's check: a friend's world that is not open for
    // building would refuse the present, and the gift would already be off her shelf
    if (!hit && typeof game._netRefuses === 'function' && game._netRefuses('build')) return null;
    const data = D.giftData({ ...e, from: e.from || myName() });
    game.beginHistoryGroup();
    let entity = null;
    try {
      entity = placeWith(data, () => (hit ? E.placeFromHit(BOX, hit) : placeInFront(data)));
      if (entity) shelfHistory(e, entity);
    } finally {
      game.endHistoryGroup();
    }
    if (!entity) return null;
    D.sackTake(ensure(), e.id);
    save();
    letGo();
    giftSfx(game, 'bow');
    const at = E.localToWorld(entity, 0.5, 0.5, 0.5);
    if (game.particles) game.particles.emit('sparkle', at, { count: 10, colors: [D.paper(e.paper).color, D.ribbon(e.ribbon).color, '#FFFFFF'] });
    game.toast(e.to ? D.fmt('placed', { to: e.to }) : D.STRINGS.placedAnyone, { icon: 'heart', key: 'gift-hint' });
    gave(e, { placed: true });
    ev.emit('gift:place', { to: e.to || '', uid: entity.uid });
    nextOrEmpty();
    return entity;
  }

  /** A free cell 1-2 blocks in front of her, the present facing her (Put down). */
  function placeInFront(data) {
    const pl = game.player;
    if (!pl || !boxDef) return null;
    const yaw = Number.isFinite(pl.yaw) ? pl.yaw : 0;
    const p = pl.position;
    for (const dist of [1.3, 1.9, 0.9]) {
      for (const da of [0, 0.6, -0.6, 1.2, -1.2]) {
        const x = Math.floor(p.x + Math.sin(yaw + da) * dist), z = Math.floor(p.z + Math.cos(yaw + da) * dist);
        if (x === Math.floor(p.x) && z === Math.floor(p.z)) continue; // never inside her own feet
        const dx = p.x - (x + 0.5), dz = p.z - (z + 0.5);
        const rot = Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? 1 : 3) : dz > 0 ? 0 : 2;
        for (const dy of [0, -1, 1]) {
          const y = Math.floor(p.y + 0.05) + dy;
          if (!E.canPlace(boxDef, x, y, z, rot)) continue;
          if (!E._solidAt(x, y - 1, z) && !E.surfaceBelow(x, y, z)) continue;
          return E.place(BOX, x, y, z, rot, null, data);
        }
      }
    }
    game.toast(D.STRINGS.noRoom, { icon: 'heart', key: 'gift-hint' });
    return null;
  }

  // ---------------- wrapping (from the Workshop panel) ----------------

  /**
   * Wrap a gift and put it in her hands. spec: the look and what is inside; to: a name or ''.
   * A treat comes out of her basket now. Returns the shelf entry, or null (shelf full, no treat).
   */
  function wrap(spec, to = '', { holdIt = true } = {}) {
    const s = ensure();
    if (!s) return null;
    if (s.sack.length >= D.SACK_MAX) {
      game.toast(D.STRINGS.shelfFull, { icon: 'heart', key: 'gift-hint' });
      return null;
    }
    const g = D.normalizeGift({ ...spec, to, from: myName() });
    const t = D.treatOf(g.inside);
    if (t && !basketTake(game, t, 1)) return null;
    const id = newId();
    if (!D.sackAdd(s, g, id)) return null;
    s.made = (s.made || 0) + 1;
    s.last = { inside: g.inside, box: g.box, paper: g.paper, pattern: g.pattern, ribbon: g.ribbon, bow: g.bow };
    save();
    refreshBag();
    game.award('gift_maker');
    ev.emit('gift:wrap', { gift: { ...g } });
    if (holdIt) hold(id, { quiet: true });
    return s.sack.find((x) => x.id === id) || null;
  }

  // ---------------- the life HUD: Give, Put down, Put away ----------------

  const hud = game.ui ? lifeHud(game) : null;
  const shown = { give: false, down: false, away: false };
  let nearT = 0, nearF = null;
  if (hud) {
    const face = (b, svg) => { const f = b.querySelector('.sw-round-face'); if (f) f.innerHTML = svg; };
    face(hud.add('gift-give', { icon: 'present', label: D.STRINGS.hudGive, color: 'var(--sw-pink)', order: 34, onClick: () => { if (nearF) giveTo(nearF); } }), ICONS.give);
    face(hud.add('gift-down', { icon: 'present', label: D.STRINGS.hudDown, color: 'var(--sw-mint)', order: 35, onClick: () => putDownAt(null) }), ICONS.down);
    face(hud.add('gift-away', { icon: 'present', label: D.STRINGS.hudAway, color: 'var(--sw-lav)', order: 36, onClick: () => putAway() }), ICONS.away);
  }
  function showHud(now = false) {
    if (!hud) return;
    const holding = !!heldObj && game.mode === 'play' && heldShows() && !giver.busy();
    if (holding && (now || nearT <= 0)) {
      nearT = 0.25;
      const p = game.player && game.player.position;
      nearF = p && game.friends && typeof game.friends.nearest === 'function' ? game.friends.nearest(p.x, p.y, p.z, GIVE_RANGE, false) : null;
    }
    const give = holding && !!nearF;
    if (give !== shown.give) { shown.give = give; hud.show('gift-give', give); }
    if (holding !== shown.down) { shown.down = holding; hud.show('gift-down', holding); }
    const away = !!heldObj && game.mode === 'play';
    if (away !== shown.away) { shown.away = away; hud.show('gift-away', away); }
  }

  // ---------------- the Workshop panel ----------------

  const panel = installPanel(game, {
    D, M,
    gifts: () => rd(),
    wrap,
    hold: (id) => hold(id),
    myName,
    toyName,
    npcs: () => friendsList().map((f) => ({ name: D.cleanName(f.name), boy: !!(f.def && f.def.kind === 'boy') })).filter((f) => f.name),
    players: () => {
      try {
        if (!game.net || !game.net.active || typeof game.net.players !== 'function') return [];
        return game.net.players().filter((pl) => pl && !pl.you).map((pl) => D.cleanName(pl.name)).filter(Boolean);
      } catch {
        return [];
      }
    },
    treats: () => {
      const b = profile() && profile().basket;
      if (!isObj(b)) return [];
      // the treats a friend would eat (the friends' isTreat rule): no flowers, no bare ingredients
      const edible = (k) => k.startsWith('treat_') || (!!FOOD[k] && FOOD[k].kind !== 'flower');
      return Object.keys(b).filter((k) => basketCount(game, k) > 0 && D.isInside('t:' + k) && edible(k)).slice(0, 24);
    },
  });

  // ---------------- surprise presents round the tree ----------------

  let wrapDay = null; // the game day the tree's presents were last wrapped (world save)
  const treePresents = () => (E ? E.all().filter((e) => e.key === BOX && e.data && e.data.tree).sort((a, b) => a.uid - b.uid) : []);
  const seedOf = () => (game.world && game.world.meta && Number.isFinite(game.world.meta.seed) ? game.world.meta.seed : 1);
  const today = () => (game.time && Number.isFinite(game.time.day) ? Math.max(1, Math.floor(game.time.day)) : 1);

  /** Host: the opened presents round the tree come back wrapped, a new toy in each. */
  function rewrapTree(day = today()) {
    if (guest() || !E || !game.world) return 0;
    let n = 0;
    treePresents().forEach((e, i) => {
      if (!e.data.open) return;
      E.setData(e, D.giftData(D.treeGift(seedOf(), day, i), { tree: 1 }));
      n++;
    });
    wrapDay = day;
    return n;
  }

  if (game.worldFeatures && E) {
    game.worldFeatures.on('holiday:workshop', (g, rec) => {
      const o = g.worldFeatures.placeOpts();
      const x = rec.x | 0, y = rec.y | 0, z = rec.z | 0, r0 = ((rec.rot | 0) % 4 + 4) % 4;
      const color = M.WORKSHOP_COLORS.includes(rec.color) ? rec.color : null;
      for (let k = 0; k < 4; k++) if (E.place(BENCH, x, y, z, (r0 + k) % 4, color, {}, o)) return true;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (E.place(BENCH, x + dx, y, z + dz, r0, color, {}, o)) return true;
      return !!E.place(BENCH, x, y, z, r0, color, {}, g.worldFeatures.placeOpts({ force: true }));
    });
    game.worldFeatures.on('holiday:presents', (g, rec) => {
      const given = Array.isArray(rec.spots) && rec.spots.length
        ? rec.spots.slice(0, 8).filter((s) => Array.isArray(s) && s.length >= 3 && s.every((v) => Number.isFinite(v))).map((s) => [s[0] | 0, s[1] | 0, s[2] | 0])
        : null;
      const n = Math.max(3, Math.min(8, Number.isFinite(rec.n) ? rec.n | 0 : given ? given.length : 5));
      const o = g.worldFeatures.placeOpts();
      let cx = rec.x | 0, cz = rec.z | 0;
      const cy = rec.y | 0;
      // the tree the presents face away from: the record's `tree: [x, z]` (holiday-world puts
      // the record's own x, y, z on its first spot), else the middle of the given spots
      if (Array.isArray(rec.tree) && Number.isFinite(rec.tree[0]) && Number.isFinite(rec.tree[1])) {
        cx = Math.floor(rec.tree[0]);
        cz = Math.floor(rec.tree[1]);
      } else if (given && given.length > 1) {
        cx = Math.round(given.reduce((a, s) => a + s[0], 0) / given.length);
        cz = Math.round(given.reduce((a, s) => a + s[2], 0) / given.length);
      }
      const free = (x, y, z) => !!boxDef && E.canPlace(boxDef, x, y, z, 0, null, { players: false }) && (E._solidAt(x, y - 1, z) || !!E.surfaceBelow(x, y, z));
      const spots = given || D.presentSpots(cx, cy, cz, n, free);
      const day = today();
      let placed = 0;
      spots.slice(0, n).forEach((s, i) => {
        const dx = s[0] - cx, dz = s[2] - cz;
        // the front (the tag) faces away from the tree, toward whoever walks up
        const rot = Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? 1 : 3) : dz > 0 ? 0 : 2;
        const data = D.giftData(D.treeGift(seedOf(), day, i), { tree: 1 });
        if (E.place(BOX, s[0], s[1], s[2], rot, null, data, o)) placed++;
      });
      wrapDay = day;
      return placed > 0;
    });
  }

  // ---------------- stickers ----------------

  const reg = game.registry.stickers;
  ev.on('game:ready', () => {
    for (const [id, name, hint] of D.STICKERS) if (reg && !reg.has(id)) reg.set(id, { id, name, hint, icon: 'heart', art: STICKER_ART[id] });
  });

  // ---------------- events ----------------

  const repair = () => {
    if (profile()) D.ensureGifts(profile());
    refreshBag();
    dirtyHold = true;
  };
  ev.on('game:ready', repair);
  ev.on('profile:changed', repair);
  ev.on('hotbar:change', () => { dirtyHold = true; });
  ev.on('basket:change', () => panel.refresh());
  ev.on('time:morning', ({ day } = {}) => {
    if (remote() || guest()) return;
    rewrapTree(Number.isFinite(day) ? Math.max(1, Math.floor(day)) : today());
  });
  ev.on('world:load', () => {
    repair();
    if (guest()) return;
    // a new day since this world last wrapped its tree's presents (or an old save)
    const d = today();
    if (wrapDay !== d && treePresents().some((e) => e.data.open)) rewrapTree(d);
    else if (wrapDay === null) wrapDay = d;
  });

  game.addSystem({
    name: 'gifts',
    onWorldLoad() {
      wrapDay = null;
    },
    serialize: () => ({ v: 1, day: wrapDay }),
    deserialize(data) {
      wrapDay = isObj(data) && Number.isFinite(data.day) ? Math.floor(data.day) : null;
    },
    update(dt) {
      const av = avatar();
      if (dirtyHold || av !== seenAv || (heldObj && heldAv && heldAv.held !== heldObj)) syncHold();
      if (nearT > 0) nearT -= dt;
      giver.update(dt);
      showHud();
    },
    onWorldUnload() {
      letGo();
      giver.clear();
    },
  });

  // ---------------- the facade (the net adapter and friends read it) ----------------

  game.gifts = {
    /** The held gift's look as a presence key ('gift_w' + 5 base-36 digits), or null. */
    held: () => (heldObj && heldEntry && heldShows() ? D.heldKeyOf(heldEntry) : null),
    /** A model for a held key (friends' pages draw her gift with it), or null. */
    model: (key) => {
      const g = D.parseHeldKey(key);
      return g ? M.heldGiftModel(g) : null;
    },
    holding: () => !!heldObj,
    giveTo,
    hold: (id = null) => hold(id),
    putAway: () => putAway(),
    putDown: () => !!putDownAt(null),
    wrap: (spec, to = '') => wrap(spec, to),
    sack: () => (rd() ? rd().sack.map((e) => ({ ...e })) : []),
    toyName,
    openWorkshop: () => (game.ui ? game.ui.open('gift-workshop') : false),
  };

  // ---------------- debug (probes) ----------------

  if (game.debug) {
    game.debug.gifts = {
      state() {
        const s = rd() || {};
        return {
          sack: (s.sack || []).map((e) => ({ ...e })),
          toys: { ...(s.toys || {}) },
          made: s.made || 0, given: s.given || 0, opened: s.opened || 0,
          coinDay: s.coinDay || 0, coinsToday: s.coinsToday || 0,
          held: game.gifts.held(), holding: !!heldObj, wrapDay,
          tree: treePresents().map((e) => ({ uid: e.uid, open: !!e.data.open, inside: e.data.inside })),
          giving: giver.busy(),
        };
      },
      /** Wrap a gift without the panel (scenes): spec fields as in data.js. */
      wrap: (spec = {}, to = '') => wrap({ ...D.DEFAULT_GIFT, ...spec }, to),
      hold: (id = null) => hold(id),
      /** Give the held gift to the nearest friend in the world. */
      give: () => {
        const p = game.player && game.player.position;
        const f = p && game.friends ? game.friends.nearest(p.x, p.y, p.z, 30, false) : null;
        return f ? giveTo(f) : false;
      },
      putDown: () => !!putDownAt(null),
      /** Open the present with this uid (or the first wrapped one). */
      open(uid = null) {
        const list = E ? E.all().filter((e) => e.key === BOX) : [];
        const e = uid !== null ? list.find((x) => x.uid === uid) : list.find((x) => !x.data.open);
        return e ? openBox(e) : false;
      },
      rewrap: (day) => rewrapTree(Number.isFinite(day) ? day : today()),
      /** Place n tree presents round (x, y, z) as the holiday world would. */
      presents: (x, y, z, n = 5) => (game.worldFeatures ? game.worldFeatures.run(game.world, [{ kind: 'holiday:presents', x, y, z, n }]) : 0),
      workshop: (x, y, z, rot = 0) => (game.worldFeatures ? game.worldFeatures.run(game.world, [{ kind: 'holiday:workshop', x, y, z, rot }]) : 0),
      panel,
    };
  }
}
