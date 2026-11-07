// Giving a gift to a friend in her world (the gifts team doc, "Giving"): the wrapped gift flies
// from her hands to the friend ("For me?!"), wiggles, POPS in a burst of confetti in its own
// paper and ribbon colors, the toy rises spinning out of it and lands in the friend's hands.
// Timings: data.js givePose (3.2 s in all). Everything here is local and visual: the friend's
// side (the thank-you line, hearts, keeping the toy) is game.friends.receiveGift, called by
// the onHand callback.

import * as THREE from 'three';
import * as D from './data.js';
import * as M from './models.js';
import { giftSfx } from './sfx.js';
import { disposeObject } from '../../core/models.js';

const _t = new THREE.Vector3();

export function createGiver(game, { onHand = () => {}, onDone = () => {} } = {}) {
  let cur = null; // { f, entry, t, from, box, toy, popped, handed, wig }

  function clear() {
    if (!cur) return;
    for (const o of [cur.box, cur.toy]) {
      if (!o) continue;
      if (o.parent) o.parent.remove(o);
      disposeObject(o);
    }
    cur = null;
  }

  /** Where the friend holds things out: in front of the chest. */
  function handsOf(f, out) {
    const yaw = Number.isFinite(f.yaw) ? f.yaw : 0;
    const up = f.act === 'sit' ? 0.62 : 0.95;
    return out.set(f.pos.x + Math.sin(yaw) * 0.42, f.pos.y + up, f.pos.z + Math.cos(yaw) * 0.42);
  }

  function start(f, entry, from) {
    clear();
    if (!game.scene || !f || !f.pos) {
      onHand(f, entry);
      onDone();
      return;
    }
    const pl = game.player && game.player.position;
    const start = from ? from.clone() : pl ? new THREE.Vector3(pl.x, pl.y + 1.1, pl.z) : handsOf(f, new THREE.Vector3()).setY(f.pos.y + 1.6);
    const box = M.giftModel(entry, { parts: true, tag: false });
    box.scale.setScalar(0.62);
    box.position.copy(start);
    game.scene.add(box);
    cur = { f, entry, t: 0, from: start, box, toy: null, popped: false, handed: false, wig: 0, asked: false };
    f.faceT = Math.max(f.faceT || 0, 4);
    if (typeof f.stop === 'function' && !(game.friends && game.friends.remote)) f.stop();
    giftSfx(game, 'whoosh', { volume: 0.7 });
  }

  function update(dt) {
    if (!cur) return;
    const f = cur.f;
    const sys = game.friends;
    if (!sys || !Array.isArray(sys.friends) || !sys.friends.includes(f)) {
      // the friend left the world mid-way: the toy goes to them anyway (counted), quietly
      clear();
      onDone();
      return;
    }
    cur.t += Math.min(0.1, Math.max(0, Number.isFinite(dt) ? dt : 0));
    const p = D.givePose(cur.t);
    f.faceT = Math.max(f.faceT || 0, 1);
    const target = handsOf(f, _t);
    if (!cur.asked && cur.t > 0.35) {
      cur.asked = true;
      if (typeof sys.say === 'function') sys.say(f, 'giftAsk');
    }
    if (cur.box) {
      cur.box.position.lerpVectors(cur.from, target, p.fly);
      cur.box.position.y += p.arc;
      cur.box.rotation.set(0, (1 - p.fly) * 1.5, p.wiggle);
      cur.box.scale.setScalar(0.62 * p.boxS);
      // two little shakes while the friend holds it
      const w = cur.t > 0.75 ? (cur.t > 1.15 ? 2 : 1) : 0;
      if (w > cur.wig) {
        cur.wig = w;
        giftSfx(game, 'wiggle');
      }
      const bow = cur.box.userData.parts && cur.box.userData.parts.bow;
      if (bow) bow.scale.setScalar(1 + Math.max(0, Math.sin(cur.t * 18)) * 0.08 * (cur.t > 0.6 ? 1 : 0));
    }
    if (p.pop && !cur.popped) {
      cur.popped = true;
      const pap = D.paper(cur.entry.paper), rib = D.ribbon(cur.entry.ribbon);
      if (game.particles) {
        game.particles.emit('confetti', target, { count: 30, colors: [pap.color, pap.ink, pap.ink2, rib.color], spread: 0.35 });
        game.particles.emit('star', target, { count: 8, color: '#FFE38A' });
      }
      giftSfx(game, 'unwrap');
      if (cur.box) {
        cur.box.parent && cur.box.parent.remove(cur.box);
        disposeObject(cur.box);
        cur.box = null;
      }
      cur.toy = M.insideModel(cur.entry.inside);
      cur.toy.scale.setScalar(0.05);
      cur.toy.position.copy(target);
      game.scene.add(cur.toy);
      if (typeof f.emote === 'function' && f.act !== 'sit') f.emote('jump');
    }
    if (cur.toy && !cur.handed) {
      const s = D.popCurve(Math.min(1, p.rise * 1.3)) * 0.62;
      cur.toy.scale.setScalar(Math.max(0.05, s));
      cur.toy.position.set(target.x, target.y + p.rise * 0.5 - (p.hand ? 0 : 0.1), target.z);
      cur.toy.rotation.y = p.spin;
    }
    if (p.hand && !cur.handed) {
      cur.handed = true;
      if (cur.toy) {
        cur.toy.parent && cur.toy.parent.remove(cur.toy);
        disposeObject(cur.toy);
        cur.toy = null;
      }
      onHand(f, cur.entry);
    }
    if (p.done) {
      cur = null;
      onDone();
    }
  }

  return {
    start,
    update,
    clear,
    /** A gift is on its way (no other gift can be given meanwhile). */
    busy: () => !!cur,
    /** The gift is still in the air (her hands stay empty until it pops). */
    flying: () => !!cur && !cur.popped,
  };
}
