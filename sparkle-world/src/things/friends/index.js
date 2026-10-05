// Friends ("really cool girls"): NPC friends built with game.createAvatar and curated looks.
// Invite one from the Bag (Fun & Toys -> Invite a Friend, tap the ground, pick a friend card)
// or the Friends HUD button; at most 6 per world, saved per world (system 'friends').
// Hand-tap a friend: Talk, Follow me / Stay here, Dance, Treat, Dress up. They wander near
// their spot, wave hello, chat about what is around, mirror her emotes, sit on sofas and
// chairs, sleep in free beds at night and eat the treats she gives them.
//
// Events: 'friend:invite' { friend }, 'friend:talk' { friend, line, kind }, 'friend:treat'
// { friend, food }. API: game.friends (see FriendSystem). See docs/teams/pals.md.

import * as THREE from 'three';
import { makeId } from '../../core/util.js';
import { FOOD, foodModel, foodIcon, foodName, hasFoodModel } from '../food-models.js';
import { basketTake } from '../pets/kit.js';
import { sfx } from '../pets/sfx.js';
import { Friend, HALF_W, HEIGHT } from './friend.js';
import { FRIENDS, FRIEND_KEYS, friendDef, wearOutfit, nextHair, surpriseLook, twinLook, OUTFITS, pronouns, rosterFriends } from './looks.js';
import { pickLine, lineCount } from './chat.js';
import { installFriendUI, friendTag, disposeTag, inviteIcon } from './ui.js';
import { installFriendStickers } from './stickers.js';

export const MAX_FRIENDS = 6;
const LOD_DIST = 40;
const TAG_DIST = 22;

const _pm = new THREE.Matrix4();
const _frustum = new THREE.Frustum();
const _sphere = new THREE.Sphere(new THREE.Vector3(), 1.3);
const _w = new THREE.Vector3();
const _v = new THREE.Vector3();

class FriendSystem {
  constructor(game) {
    this.game = game;
    this.max = MAX_FRIENDS;
    this.friends = [];
    this.group = new THREE.Group();
    this.group.name = 'friends';
    this.tags = new Map(); // friend -> sprite
    this.claims = new Map(); // 'uid:s0' / 'uid:b1' -> friend
    this.chatT = 10;
    this.eventT = 0;
    this.lastGreetAt = 0;
    this.ui = null;
    this.danceParty = { at: 0, n: 0 };
    // multiplayer (docs/teams/net.md "NPC friends"): the host owns the friends. On a
    // friend's page (remote) they are puppets that follow the host's motion samples
    // (friend.netTarget) and still chat with her locally; inviting, dressing up, treats and
    // Follow / Stay / Home / Bye ask the host. onChange(friend) is called when a friend is
    // added, removed, restyled or changes mode (src/net/actors.js).
    this.remote = false;
    this.onChange = null;
    this._hSeq = 0; // friend.h: a small per-session handle (motion samples use it)
  }

  _touch(f) {
    if (this.onChange !== null) this.onChange(f);
  }

  /** On a friend's page (remote): "That's Lily's friend! ..." and true when the action must stop. */
  _refused() {
    const net = this.game.net;
    if (!this.remote || (net && net.remoteApplying)) return false;
    if (net && typeof net.refuse === 'function') net.refuse('npc');
    else this.game.toast("That's your friend's friend! Ask your friend to help.", { icon: 'heart' });
    return true;
  }

  // ---------- inviting & saying bye ----------

  invite(key, spot = null, { fx = true, data = null } = {}) {
    const g = this.game;
    const def = friendDef(key);
    if (!g.world || !def) return null;
    if (this._refused()) return null;
    if (this.friends.length >= MAX_FRIENDS) {
      g.toast(`Your world is full of friends! (${MAX_FRIENDS})`, { icon: 'heart', key: 'friends-full' });
      return null;
    }
    const here = this.friends.find((f) => f.key === key);
    if (here) {
      this.call(here);
      return here;
    }
    let pos = spot;
    const pl = g.player;
    if (!pos && pl) {
      const p = pl.position;
      pos = this.findSpot(p.x + Math.sin(pl.yaw) * 2.2, p.y, p.z + Math.cos(pl.yaw) * 2.2, 0, 1.6) || [p.x + Math.sin(pl.yaw) * 2, p.y, p.z + Math.cos(pl.yaw) * 2];
    }
    if (!pos) return null;
    const f = this._add({
      id: makeId('friend'), key, name: def.name, look: def.look, mode: 'home',
      x: pos[0], y: pos[1], z: pos[2], home: [pos[0], pos[1], pos[2]], metAt: Date.now(), ...(data || {}),
    });
    if (pl) f.yaw = Math.atan2(pl.position.x - pos[0], pl.position.z - pos[2]);
    if (fx) {
      g.celebrate([pos[0], pos[1] + 1.2, pos[2]], 'confetti', { quiet: true });
      g.celebrate([pos[0], pos[1] + 1, pos[2]], 'sparkle', { quiet: true, count: 24 });
      g.celebrate([pos[0], pos[1] + 1.6, pos[2]], 'heart', { quiet: true, count: 8 });
      sfx(g, 'hello', { pitch: def.pitch });
      f.emote('wave', 0.25);
      f.greetT = 0;
      setTimeout(() => { if (this.friends.includes(f)) this.say(f, 'arrive'); }, 450);
      g.toast(`${def.name} is here! Tap ${pronouns(def).them} to play!`, { icon: 'heart', big: true, color: 'pink', key: 'friend-invite' });
    }
    g.events.emit('friend:invite', { friend: f });
    return f;
  }

  _add(data) {
    const f = new Friend(this, data);
    f.h = data.h > 0 ? data.h | 0 : ++this._hSeq;
    this.friends.push(f);
    this.group.add(f.group);
    const tag = friendTag(f.name, f.def.color);
    this.tags.set(f, tag);
    this.group.add(tag);
    this.game.pickables.add(f.pickable);
    this._slots();
    this._changed();
    this._touch(f);
    return f;
  }

  remove(f, { fx = false } = {}) {
    const i = this.friends.indexOf(f);
    if (i < 0) return false;
    if (this._refused()) return false;
    this.friends.splice(i, 1);
    this.game.pickables.delete(f.pickable);
    if (fx) {
      const p = f.pos;
      this.game.celebrate([p.x, p.y + 1, p.z], 'sparkle', { count: 20 });
      this.game.celebrate([p.x, p.y + 1.5, p.z], 'heart', { quiet: true });
    }
    if (this.ui) this.ui.dropFriend(f);
    disposeTag(this.tags.get(f));
    this.tags.delete(f);
    f.dispose();
    this._slots();
    this._changed();
    this._touch(f);
    return true;
  }

  _slots() {
    let n = 0;
    for (const f of this.friends) if (f.mode === 'follow') f.slot = n++;
  }

  _changed() {
    if (this.ui) this.ui.refresh();
  }

  byId(id) {
    return this.friends.find((f) => f.id === id) || null;
  }

  byKey(key) {
    return this.friends.find((f) => f.key === key) || null;
  }

  nearest(x, y, z, maxDist = 8, awake = true) {
    let best = null, bd = maxDist * maxDist;
    for (const f of this.friends) {
      if (awake && f.act === 'sleep') continue;
      const d = (f.pos.x - x) ** 2 + (f.pos.y - y) ** 2 + (f.pos.z - z) ** 2;
      if (d < bd) { bd = d; best = f; }
    }
    return best;
  }

  // ---------- talking ----------

  /**
   * She says a line (kind: see chat.js). Shows a bubble, babbles, and reads it aloud when the
   * Read Aloud setting is on (opts.speak: false for background chatter, so the voice is kept
   * for lines she asked for and for the game's own tips).
   */
  say(f, kind = 'chat', opts = {}) {
    const g = this.game;
    const line = pickLine(g, f, kind, opts.extra);
    const secs = Math.min(6.5, 2.6 + line.length * 0.055);
    if (this.ui) this.ui.showLine(f, line, secs);
    const d = f.distToPlayer();
    const vol = Math.max(0, 1 - d / 18);
    if (vol > 0.05) sfx(g, 'babble', { pitch: f.def.pitch, volume: vol });
    if (g.speak && d < 10 && opts.speak !== false) g.speak(line);
    g.events.emit('friend:talk', { friend: f, line, kind });
    return line;
  }

  talk(f) {
    if (f.act === 'sleep') return null;
    f.faceT = 3;
    if (f.act !== 'sit' && Math.random() < 0.35) f.emote(Math.random() < 0.5 ? 'heart' : 'twirl');
    return this.say(f, 'chat');
  }

  /** A friend gives a pet nearby some love (hearts, a happy hop, a sweet word). */
  lovePet(f, pet) {
    const g = this.game;
    f.yaw = Math.atan2(pet.pos.x - f.pos.x, pet.pos.z - f.pos.z);
    f.emote('heart');
    pet.headPoint(_v);
    g.celebrate([_v.x, _v.y + 0.3, _v.z], 'heart', { quiet: true, count: 6 });
    pet.anim.happy = 2.5;
    if (Math.random() < 0.5) pet.trick('hop');
    if (f.distToPlayer() < 9) this.say(f, 'pet', { speak: false, extra: { pet: pet.name } });
  }

  // ---------- hand tap, tickles, Build-tool taps ----------

  tap(f) {
    const g = this.game;
    if (this.remote && f.act !== 'sleep') {
      // a friend visiting: the host's friend waves and says hi to her (here only)
      f.faceT = 4;
      if (f.act !== 'sit' && f.emoteLeft <= 0) f.emote('wave');
      g.celebrate([f.pos.x, f.pos.y + (f.act === 'sit' ? 1.4 : 1.9), f.pos.z], 'heart', { quiet: true, count: 5 });
      sfx(g, 'babble', { pitch: f.def.pitch, volume: 0.8 });
      this.say(f, 'greet');
      return true;
    }
    if (f.act === 'sleep') {
      g.celebrate([f.pos.x, f.pos.y + 0.9, f.pos.z], 'zzz', { quiet: true, count: 2 });
      g.toast(`Shh... ${f.name} is fast asleep!`, { icon: 'moon', key: 'friend-sleep' });
      return true;
    }
    if (f.act === 'toBed') {
      g.toast(`${f.name} is going to bed. Night night!`, { icon: 'moon', key: 'friend-sleep' });
      return true;
    }
    f.faceT = 4;
    if (f.act !== 'sit' && f.emoteLeft <= 0 && f.eatT <= 0) f.emote('wave');
    g.celebrate([f.pos.x, f.pos.y + (f.act === 'sit' ? 1.4 : 1.9), f.pos.z], 'heart', { quiet: true, count: 5 });
    sfx(g, 'babble', { pitch: f.def.pitch, volume: 0.8 });
    if (this.ui) this.ui.showBubble(f, pickLine(g, f, 'greet'));
    return true;
  }

  tickle(f) {
    const g = this.game;
    if (f.act === 'sleep') return this.tap(f);
    sfx(g, 'giggle', { pitch: f.def.pitch });
    g.celebrate([f.pos.x, f.pos.y + 1.5, f.pos.z], 'heart', { quiet: true, count: 6 });
    if (f.act !== 'sit') f.emote('jump');
    this.say(f, 'tickle');
    return true;
  }

  onBuild(f, item) {
    if (item && item.key === 'friend:invite') return false;
    if (item && item.key && item.key.startsWith('food:')) {
      const k = item.key.slice(5);
      if (this.isTreat(k)) return this.giveTreat(f, k);
    }
    return this.tap(f);
  }

  hintFor(f, g) {
    const tool = g.selectedTool;
    if (f.act === 'sleep') return `${f.name} is sleeping`;
    if (tool === 'remove') return `Tap to tickle ${f.name}`;
    if (tool === 'build') {
      const item = g.selectedItem();
      if (item && item.key.startsWith('food:') && this.isTreat(item.key.slice(5))) return `Tap to give ${f.name} a treat`;
    }
    return `Tap to play with ${f.name}`;
  }

  // ---------- modes ----------

  setMode(f, mode, { quiet = false } = {}) {
    if (this._refused()) return;
    if (mode === 'follow' || mode === 'stay') {
      if (f.act === 'sit' || f.act === 'sleep' || f.act === 'toSeat' || f.act === 'toBed') f.standUp(true);
    }
    f.mode = mode;
    if (mode === 'stay') f.home = [f.pos.x, f.pos.y, f.pos.z];
    f.idleLeft = 2;
    if (!quiet) {
      this.say(f, mode === 'follow' ? 'follow' : mode === 'stay' ? 'stay' : 'home');
      if (mode === 'follow' && f.act !== 'sit') f.emote('jump');
    }
    this._slots();
    this._changed();
    this._touch(f);
  }

  call(f) {
    const pl = this.game.player;
    if (!pl) return;
    if (this._refused()) return;
    if (f.act === 'sit' || f.act === 'sleep' || f.act === 'toSeat' || f.act === 'toBed') f.standUp(false);
    const p = pl.position;
    f.teleportNear(p.x, p.y, p.z, 1.3, 2.3);
    f.yaw = Math.atan2(p.x - f.pos.x, p.z - f.pos.z);
    f.greetT = 0;
    f.emote('wave', 0.2);
    this.say(f, 'greet');
    this._changed();
  }

  sendHome(f) {
    if (this._refused()) return;
    if (f.act === 'sit' || f.act === 'sleep' || f.act === 'toSeat' || f.act === 'toBed') f.standUp(false);
    f.mode = 'home';
    const [x, y, z] = f.home;
    f.teleportNear(x, y, z, 0, 1.4);
    this.game.toast(`${f.name} went back to ${pronouns(f.def).their} spot!`, { icon: 'home' });
    this._slots();
    this._changed();
    this._touch(f);
  }

  // ---------- dancing & emotes ----------

  danceTogether(f) {
    const pl = this.game.player;
    if (f.act === 'sit' && !this.remote) f.standUp(true);
    f.faceT = 4;
    f.emote('dance', 0.1);
    // she dances too (and every friend nearby joins in through the 'emote' event)
    if (pl && pl.state !== 'sit' && pl.state !== 'sleep' && pl.state !== 'ride') pl.emote('dance');
    else this._mirror('dance', f);
    this.say(f, 'dance');
  }

  /** Friends near her copy her emote (a dance party!). */
  _mirror(name, except = null) {
    const g = this.game, pl = g.player;
    if (!pl) return;
    let n = 0, first = true;
    for (const f of this.friends) {
      if (f.act === 'sleep' || f.act === 'toBed' || f.eatT > 0) continue;
      const d = f.distToPlayer();
      if (d > 10) continue;
      if (this.remote && f.act === 'sit') continue; // the host's friend stays in her seat
      if (f.act === 'sit') {
        if (name !== 'dance' || d > 7) continue;
        f.standUp(true);
      }
      if (f.act === 'toSeat') f.standUp(false);
      f.faceT = 5;
      if (f !== except) f.emote(name, 0.15 + Math.random() * 0.45);
      n++;
      if (first && f !== except && !(this.ui && this.ui.bubbleFriend === f)) {
        first = false;
        const kind = ['dance', 'wave', 'heart', 'twirl', 'cartwheel', 'jump', 'sit'].includes(name) ? name : 'dance';
        setTimeout(() => { if (this.friends.includes(f)) this.say(f, kind); }, 500);
      }
    }
    if (name === 'dance' && n >= 2) this.game.events.emit('friends:dance', { count: n });
  }

  // ---------- treats ----------

  isTreat(k) {
    if (!k) return false;
    if (k.startsWith('treat_')) return true;
    return !!FOOD[k] && FOOD[k].kind !== 'flower';
  }

  /** Food keys in the basket she can share (treats from the shops first). */
  basketTreats() {
    const b = this.game.profile.basket || {};
    const keys = Object.keys(b).filter((k) => (b[k] | 0) > 0 && this.isTreat(k));
    keys.sort((a, c) => (c.startsWith('treat_') ? 1 : 0) - (a.startsWith('treat_') ? 1 : 0));
    return keys;
  }

  treatName(k) {
    const item = this.game.registry.items.get('food:' + k);
    if (item && item.name) return String(item.name).replace(/\s*[x×]\s*\d+$/, '').slice(0, 14);
    if (FOOD[k]) return FOOD[k].name;
    return k.replace(/^treat_/, '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 14);
  }

  treatIcon(k) {
    const items = this.game.registry.items;
    if (items.get('food:' + k)) return items.iconFor('food:' + k);
    return foodIcon(this.game, FOOD[k] ? k : 'cupcake');
  }

  _treatModel(k) {
    const g = this.game;
    // a shop treat may bring its own model (Shops team: game.treats.model(key))
    try {
      if (g.treats && typeof g.treats.model === 'function') {
        const m = g.treats.model(k);
        if (m) return m;
      }
    } catch (err) {
      console.warn('[friends] treat model failed', k, err);
    }
    if (hasFoodModel(k)) return foodModel(k);
    return foodModel(/ice|cream|sundae|shake|pop/.test(k) ? 'ice_cream' : 'cupcake');
  }

  /** Give a friend a treat: free (the cookie) or one from the basket. */
  giveTreat(f, k, free = false) {
    const g = this.game;
    if (this._refused()) return false;
    if (!free && !basketTake(g, k, 1)) {
      g.toast(`No ${foodName(k, 2)} in your basket!`, { icon: 'heart' });
      return false;
    }
    if (f.act === 'sleep') f.wake();
    if (f.act === 'toSeat' || f.act === 'toBed') f.standUp(false);
    f.eat(k, this._treatModel(k));
    f.faceT = 4;
    sfx(g, 'pop', { pitch: 1.2 });
    g.celebrate([f.pos.x, f.pos.y + 1.4, f.pos.z], 'sparkle', { quiet: true, count: 8 });
    g.events.emit('friend:treat', { friend: f, food: k });
    return true;
  }

  bite(f) {
    const g = this.game;
    if (!f.food) return;
    sfx(g, 'crunch', { volume: Math.max(0.1, 1 - f.distToPlayer() / 14) });
    f.food.scale.multiplyScalar(0.8);
    f.food.getWorldPosition(_v);
    const k = f.food.userData.key;
    g.particles && g.particles.emit('sparkle', _v, { count: 4, color: (FOOD[k] && FOOD[k].color) || '#FFB6D9', spread: 0.15, scale: 0.6 });
  }

  doneEating(f) {
    const g = this.game;
    f.dropFood();
    g.celebrate([f.pos.x, f.pos.y + 1.7, f.pos.z], 'heart', { quiet: true, count: 10 });
    sfx(g, 'giggle', { pitch: f.def.pitch, volume: 0.8 });
    this.say(f, 'treat');
    if (f.act !== 'sit') f.emote('heart', 0.1);
  }

  // ---------- dress up ----------

  style(f, how, key = null) {
    const g = this.game;
    if (this._refused()) return false;
    let look;
    if (how === 'outfit') look = wearOutfit(f.look, key);
    else if (how === 'hair') look = nextHair(f.look, f.def.kind);
    else if (how === 'twins') look = twinLook(f.look, g.profile.look);
    else look = surpriseLook(f.look, f.def.kind);
    f.setLook(look);
    g.celebrate([f.pos.x, f.pos.y + 1, f.pos.z], 'sparkle', { quiet: true, count: 22 });
    g.celebrate([f.pos.x, f.pos.y + 1.7, f.pos.z], 'star', { quiet: true, count: 8 });
    g.audio.play('magic', { pitch: 1.1 });
    if (f.act !== 'sit' && f.act !== 'sleep') f.emote(how === 'hair' ? 'heart' : 'twirl');
    this.say(f, how === 'twins' ? 'twins' : how === 'hair' ? 'hair' : 'style');
    this.game.events.emit('friend:style', { friend: f, look: f.look });
    this._touch(f);
    return true;
  }

  // ---------- seats & beds ----------

  isNight() {
    const d = this.game.time.dayTime;
    return d < 0.23 || d > 0.8;
  }

  release(spot) {
    if (spot && spot.key && this.claims.get(spot.key)) this.claims.delete(spot.key);
  }

  spotValid(spot) {
    if (!spot) return false;
    if (spot.ground) return true;
    const E = this.game.entities;
    return !!(E && E.byUid(spot.uid));
  }

  /** Is the player sitting / lying on this seat or bed spot? */
  playerOn(spot) {
    const pl = this.game.player;
    if (!pl || !spot || spot.ground || !pl.seatEntity) return false;
    if (pl.state !== 'sit' && pl.state !== 'sleep') return false;
    if (pl.seatEntity.uid !== spot.uid) return false;
    const dx = pl.position.x - spot.x, dz = pl.position.z - spot.z;
    return dx * dx + dz * dz < 0.3;
  }

  _spots(f, action, maxDist, cx, cy, cz) {
    const E = this.game.entities;
    if (!E) return null;
    let best = null, bd = maxDist * maxDist;
    for (const e of E.all()) {
      const def = e.def;
      if (!def || !def.actions || def.actions[0] !== action) continue;
      if (e.key === 'crib') continue;
      const list = action === 'sit' ? def.seats || (def.seat ? [def.seat] : null) : def.sleepSpots || (def.sleepPos ? [def.sleepPos] : [[0.5, 0.45, 1]]);
      if (!list) continue;
      for (let i = 0; i < list.length; i++) {
        const key = `${e.uid}:${action === 'sit' ? 's' : 'b'}${i}`;
        const owner = this.claims.get(key);
        if (owner && owner !== f && this.friends.includes(owner)) continue;
        E.localToWorld(e, list[i][0], list[i][1], list[i][2], _w);
        const spot = { key, uid: e.uid, idx: i, x: _w.x, y: _w.y, z: _w.z, yaw: e.rot * (Math.PI / 2), front: e.frontCell() };
        if (this.playerOn(spot)) continue;
        const d = (_w.x - cx) ** 2 + (_w.z - cz) ** 2 + ((_w.y - cy) * 2) ** 2;
        if (d < bd) { bd = d; best = spot; }
      }
    }
    if (best) this.claims.set(best.key, f);
    return best;
  }

  findSeat(f, maxDist = 8) {
    const [x, y, z] = f.mode === 'home' ? f.home : [f.pos.x, f.pos.y, f.pos.z];
    return this._spots(f, 'sit', maxDist, x, y, z);
  }

  findBed(f) {
    const pl = this.game.player;
    const near = pl && pl.state === 'sleep' ? pl.position : f.pos;
    return this._spots(f, 'sleep', 32, near.x, near.y, near.z);
  }

  /** No bed free: a spot on the grass near home to nap under the stars. */
  groundBed(f) {
    const [x, y, z] = f.mode === 'home' ? f.home : [f.pos.x, f.pos.y, f.pos.z];
    const s = this.findSpot(x, y, z, 0.3, 2.5);
    if (!s) return null;
    return { ground: true, x: s[0], y: s[1] + 0.1, z: s[2], yaw: Math.random() * Math.PI * 2, front: [Math.floor(s[0]), Math.floor(s[1]), Math.floor(s[2])] };
  }

  onFriendSleep(f) {
    const g = this.game;
    g.celebrate([f.pos.x, f.pos.y + 0.8, f.pos.z], 'zzz', { quiet: true, count: 2 });
    if (f.distToPlayer() < 8 && Math.random() < 0.6) this.say(f, 'bed');
  }

  zzz(f, dt) {
    f.zzzT = (f.zzzT || 1) - dt;
    if (f.zzzT > 0) return;
    f.zzzT = 1.5 + Math.random() * 0.8;
    if (!f.inView || !this.game.particles) return;
    _v.set(f.pos.x - Math.sin(f.yaw) * 0.55, f.pos.y + 0.55, f.pos.z - Math.cos(f.yaw) * 0.55);
    this.game.particles.emit('zzz', _v, { count: 1, spread: 0.1 });
  }

  // ---------- spots ----------

  /** A free standing spot for a friend near (x, y, z), between rMin and rMax away. */
  findSpot(x, y, z, rMin = 1, rMax = 2.5) {
    const g = this.game, ph = g.physics, w = g.world;
    if (!ph || !w) return null;
    const tries = 30;
    for (let i = 0; i < tries; i++) {
      const a = (i / tries) * Math.PI * 2 * 3.1 + Math.random() * 0.3;
      const r = i === 0 && rMin === 0 ? 0 : rMin + (rMax - rMin) * ((i % 5) / 4);
      const px = x + Math.sin(a) * r, pz = z + Math.cos(a) * r;
      if (px < 1 || pz < 1 || px > w.sx - 1 || pz > w.sz - 1) continue;
      const y0 = Math.floor(y);
      for (let yy = y0 + 3; yy >= y0 - 8; yy--) {
        if (yy < 0) break;
        if (ph.bodyBlocked(px, yy + 0.01, pz, HALF_W, HEIGHT)) continue;
        if (!ph.bodyBlocked(px, yy - 0.25, pz, HALF_W, 0.25)) continue;
        if (ph.liquidAt(px, yy + 0.2, pz)) break;
        return [px, yy + 0.01, pz];
      }
    }
    return null;
  }

  // ---------- frame ----------

  update(dt) {
    const g = this.game;
    if (!g.world || g.mode !== 'play' || g.loading) return;
    if (g.paused) {
      if (this.ui) this.ui.update(dt);
      return;
    }
    const cam = g.camera;
    _pm.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    _frustum.setFromProjectionMatrix(_pm);
    const cp = cam.position;
    for (let i = 0; i < this.friends.length; i++) {
      const f = this.friends[i];
      const d2 = cp.distanceToSquared(f.pos);
      const far = d2 > LOD_DIST * LOD_DIST;
      f.group.visible = !far;
      _sphere.center.set(f.pos.x, f.pos.y + 0.9, f.pos.z);
      f.inView = !far && _frustum.intersectsSphere(_sphere);
      if (this.remote) f.puppet(dt, f.inView);
      else f.update(dt, f.inView);
      const tag = this.tags.get(f);
      if (tag) {
        tag.visible = f.inView && d2 < TAG_DIST * TAG_DIST && d2 > 1.4;
        if (tag.visible) {
          const k = Math.min(1, Math.max(0.42, Math.sqrt(d2) / 6));
          tag.scale.set(tag.userData.w * k, tag.userData.h * k, 1);
          const top = f.act === 'sleep' ? 0.95 : f.act === 'sit' ? 1.62 : 2.02;
          tag.position.set(f.pos.x, f.pos.y + top, f.pos.z);
        }
      }
    }
    // now and then someone near her says something
    this.chatT -= dt;
    if (this.eventT > 0) this.eventT -= dt;
    if (this.chatT <= 0) {
      this.chatT = 9 + Math.random() * 9;
      const pl = g.player;
      if (pl && pl.state !== 'sleep') {
        const f = this.nearest(pl.position.x, pl.position.y, pl.position.z, 7);
        if (f && f.eatT <= 0 && f.act !== 'toBed' && !(this.ui && this.ui.bubbleFriend === f)) this.say(f, 'chat', { speak: false });
      }
    }
    if (this.ui) this.ui.update(dt);
  }

  /** A friend near her reacts to something that just happened. */
  react(eventName) {
    const g = this.game, pl = g.player;
    if (!pl || this.eventT > 0 || !this.friends.length) return;
    const f = this.nearest(pl.position.x, pl.position.y, pl.position.z, 12);
    if (!f || f.eatT > 0) return;
    this.eventT = 5;
    f.faceT = 3;
    setTimeout(() => {
      if (!this.friends.includes(f)) return;
      this.say(f, 'event:' + eventName, { speak: false });
      if (f.act !== 'sit' && f.act !== 'sleep' && Math.random() < 0.6) f.emote(Math.random() < 0.5 ? 'jump' : 'heart');
    }, 700);
    this.chatT = Math.max(this.chatT, 6);
  }

  // ---------- world lifecycle ----------

  clear() {
    if (this.ui) this.ui.clear();
    for (const f of this.friends) {
      this.game.pickables.delete(f.pickable);
      f.dispose();
    }
    for (const t of this.tags.values()) disposeTag(t);
    this.tags.clear();
    this.friends = [];
    this.claims.clear();
    this.chatT = 10;
    this._changed();
  }

  serialize() {
    return { v: 1, list: this.friends.map((f) => f.serialize()) };
  }

  deserialize(data) {
    const list = Array.isArray(data) ? data : data && Array.isArray(data.list) ? data.list : [];
    for (const d of list.slice(0, MAX_FRIENDS)) {
      if (!d || !friendDef(d.key) || this.byKey(d.key)) continue;
      const f = this._add(d);
      const ph = this.game.physics;
      if (ph && ph.bodyBlocked(f.pos.x, f.pos.y + 0.01, f.pos.z, HALF_W, HEIGHT)) {
        const s = this.findSpot(f.pos.x, f.pos.y, f.pos.z, 0.5, 3);
        if (s) f.pos.set(s[0], s[1], s[2]);
      }
    }
  }
}

// ---------- the Bag item ----------

function spotFromHit(game, sys, hit) {
  const props = game.registry.blocks.props;
  let cell = hit.place;
  if (hit.type === 'block' && props.replaceable[hit.id]) cell = [hit.x, hit.y, hit.z];
  const x = cell[0] + 0.5, y = cell[1], z = cell[2] + 0.5;
  const ph = game.physics;
  if (ph && !ph.bodyBlocked(x, y + 0.01, z, HALF_W, HEIGHT) && ph.bodyBlocked(x, y - 0.25, z, HALF_W, 0.25)) return [x, y + 0.01, z];
  return sys.findSpot(x, y + 1, z, 0, 2.2);
}

export function install(game) {
  const sys = new FriendSystem(game);
  game.friends = sys;

  game.registry.items.register({
    key: 'friend:invite',
    name: 'Invite a Friend',
    category: 'fun',
    kind: 'other',
    order: -20,
    icon: () => inviteIcon(game),
    use(g, hit) {
      if (!hit) return false;
      if (sys._refused()) return false;
      if (sys.friends.length >= MAX_FRIENDS) {
        g.toast(`Your world is full of friends! (${MAX_FRIENDS})`, { icon: 'heart', key: 'friends-full' });
        g.ui.open('friends');
        return true;
      }
      const spot = spotFromHit(g, sys, hit);
      if (!spot) {
        g.toast('Tap on the ground!', { icon: 'heart' });
        return false;
      }
      g.ui.open('friends', { spot });
      return true;
    },
  });

  game.addSystem({
    name: 'friends',
    onWorldLoad() {
      sys.clear();
      game.scene.add(sys.group);
    },
    onWorldUnload() {
      sys.clear();
      game.scene.remove(sys.group);
    },
    update: (dt) => sys.update(dt),
    serialize: () => sys.serialize(),
    deserialize: (data) => sys.deserialize(data),
  });

  sys.ui = installFriendUI(game, sys);
  game.registerAction('friends', (g) => g.ui && g.ui.open('friends'));
  installFriendStickers(game, sys);

  // she emotes: friends nearby join in
  game.events.on('emote', ({ name }) => sys._mirror(name));
  // morning: everyone wakes up, one of them says good morning
  game.events.on('time:morning', () => {
    if (sys.remote) return; // the host's friends wake up at the host's
    let said = false;
    for (const f of sys.friends) {
      if (f.wake()) {
        f.emote(Math.random() < 0.5 ? 'jump' : 'wave', 0.4 + Math.random() * 0.8);
        if (!said && f.distToPlayer() < 14) {
          said = true;
          setTimeout(() => { if (sys.friends.includes(f)) sys.say(f, 'morning'); }, 1200);
        }
      }
    }
  });
  // she goes to sleep: friends nearby tuck into free beds too (a sleepover!)
  game.events.on('player:sleep', () => {
    if (sys.remote) return;
    for (const f of sys.friends) {
      if (f.act === 'sleep' || f.distToPlayer() > 30) continue;
      if (f.act === 'sit' || f.act === 'toSeat') f.standUp(false);
      f.dropFood();
      f.eatT = 0;
      const bed = f.bed && f.act === 'toBed' ? f.bed : sys.findBed(f);
      if (bed) {
        f.bed = bed;
        f.sleepNow();
      }
    }
  });
  // things that happen around her
  for (const n of ['shop:buy', 'zipline:ride', 'camp:marshmallow', 'photo:taken', 'sticker:earned', 'pet:adopt', 'cook:done', 'garden:harvest', 'prefab:place']) {
    game.events.on(n, () => sys.react(n));
  }
  // her tail appears (merfolk): one line the first time in each world visit, never on turning
  // back and never again at every shore hop
  let seaReacted = false;
  game.events.on('world:load', () => { seaReacted = false; });
  game.events.on('player:seaform', ({ form } = {}) => {
    if (!form || seaReacted || sys.remote) return;
    seaReacted = true;
    // her tail is the big news: it wins over a reaction a moment ago (her first swim's sticker)
    sys.eventT = 0;
    sys.react('player:seaform');
  });
  game.events.on('entity:remove', ({ entity }) => {
    // her seat or bed was taken away: stand up right now
    if (!entity || sys.remote) return;
    for (const f of sys.friends) {
      const s = f.seat || f.bed;
      if (s && !s.ground && s.uid === entity.uid) f.standUp(true);
    }
  });

  if (game.debug) {
    game.debug.friends = {
      keys: () => FRIEND_KEYS.slice(),
      list: () => sys.friends.map((f) => ({ id: f.id, key: f.key, name: f.name, mode: f.mode, act: f.act, x: f.pos.x, y: f.pos.y, z: f.pos.z, visible: f.group.visible, inView: f.inView, emote: f.avatar.emoting, eating: f.eatT > 0, seat: f.seat ? f.seat.uid : null, bed: f.bed ? (f.bed.ground ? 'ground' : f.bed.uid) : null, look: f.look })),
      invite: (key, x, y, z) => {
        const f = sys.invite(key, x === undefined || x === null ? null : [x, y, z]);
        return f ? f.id : null;
      },
      talk: (id) => { const f = sys.byId(id); return f ? sys.talk(f) : null; },
      tap: (id) => { const f = sys.byId(id); return f ? sys.tap(f) : false; },
      dance: (id) => { const f = sys.byId(id); if (f) sys.danceTogether(f); return !!f; },
      setMode: (id, mode) => { const f = sys.byId(id); if (f) sys.setMode(f, mode, { quiet: true }); return !!f; },
      treat: (id, key = 'star_cookie', free = true) => { const f = sys.byId(id); return f ? sys.giveTreat(f, key, free) : false; },
      style: (id, how, key) => { const f = sys.byId(id); return f ? sys.style(f, how, key) : false; },
      sit: (id) => {
        const f = sys.byId(id);
        if (!f) return false;
        f.home = [f.pos.x, f.pos.y, f.pos.z];
        const s = sys.findSeat(f, 12);
        if (s) f.goSit(s);
        return !!s;
      },
      bed: (id) => {
        const f = sys.byId(id);
        if (!f) return false;
        const b = sys.findBed(f);
        if (b) f.goBed(b);
        return !!b;
      },
      remove: (id) => { const f = sys.byId(id); return f ? sys.remove(f) : false; },
      lines: () => lineCount(),
      outfits: () => OUTFITS.map((o) => o.key),
      roster: () => FRIENDS.map((f) => ({ key: f.key, name: f.name, style: f.style, pronoun: f.pronoun, kind: f.kind })),
      order: () => rosterFriends().map((f) => f.key), // the invite panel's order
      drawCalls: () => {
        let n = 0;
        sys.group.traverseVisible((o) => { if (o.isMesh || o.isSprite) n++; });
        return n;
      },
    };
  }
}
