// Holiday looks (docs/teams/holiday-looks.md): the `holiday-looks` system. The clothes live in
// the look lists (src/player/wardrobe-data.js) and the avatar parts; this module adds:
//   - the Holiday Dress-Up booth (holiday_booth furniture, Bag tab Holiday, placed in Holiday
//     Village by the world feature `holiday:dressup`): tap it and big buttons come up over her
//     head: Be an Elf / Be Santa / (Santa Dress) / Back to me. A sparkle puff and she is
//     changed; her own clothes are kept and come back with "Back to me" (rules.js), one Undo
//     takes a change back, and the look reaches friends like any look change.
//   - friends invited in Holiday Village put on a holiday outfit (host only; friends start from
//     their own look in every world, so it is theirs again once they go home)
//   - the stickers Little Helper and Ho Ho Ho! (the booth and the Studio both earn them)
//   - game.holidayLooks (the facade) and game.debug.holidayLooks (probes)
// Events: 'holidaylook:wear' { outfit, look }, 'holidaylook:back' { look }.

import { normalizeLook, cloneLook } from '../wardrobe-data.js';
import { picture } from '../../ui/dressup/pictures.js';
import { friendDef } from '../../things/friends/looks.js';
import { holidayBooth, BOOTH_COLORS, BOOTH_COLLIDERS, BOOTH_SIZE } from './booth.js';
import { installHolidayStickers } from './stickers.js';
import {
  normState, buttonsFor, sideFor, wearCostume, backToMe, afterOutsideChange, costumeShown,
  isHolidayWorld, friendHolidayKey, STICKER_FOR, EMPTY_STATE,
} from './rules.js';

const BUBBLE_LIFE = 25; // s the booth's buttons stay up untouched
const BUBBLE_AWAY = 6; // blocks from the booth: she walked off, the buttons go
const FRIEND_DRESS_DELAY = 1600; // ms after a friend arrives (after the hello line)

const CSS = `
.lf-bubble[data-owner="holiday-looks"] .lf-bubble-name { color: #C0392B; }
.lf-bubble[data-owner="holiday-looks"] .lf-bubble-name svg { width: 24px; height: 24px; }
.lf-bubble[data-owner="holiday-looks"] .lf-bubble-row { gap: 10px; flex-wrap: wrap; justify-content: center; row-gap: 8px; }
.lf-bubble[data-owner="holiday-looks"] .sw-round-face { width: 70px; height: 70px; background: var(--c); }
.lf-bubble[data-owner="holiday-looks"] .sw-round-face svg { width: 50px; height: 50px; }
.lf-bubble[data-owner="holiday-looks"] .sw-round.hl-on .sw-round-face { border-color: #FFD54A; box-shadow: 0 0 0 4px rgba(255,213,74,.55), 0 8px 18px var(--sw-shadow); }
.lf-bubble[data-owner="holiday-looks"] .sw-round.hl-off { opacity: .45; cursor: default; }
.lf-bubble[data-owner="holiday-looks"] .sw-round.hl-off:hover .sw-round-face { transform: none; }
@media (max-width: 420px) {
  .lf-bubble[data-owner="holiday-looks"] .lf-bubble-row { gap: 6px; }
  .lf-bubble[data-owner="holiday-looks"] .sw-round-face { width: 56px; height: 56px; }
  .lf-bubble[data-owner="holiday-looks"] .sw-round-face svg { width: 40px; height: 40px; }
  .lf-bubble[data-owner="holiday-looks"] .sw-round-label { font-size: 13px; padding: 1px 5px; }
}
`;

export function install(game) {
  const ui = game.ui;
  const award = installHolidayStickers(game);
  const E = game.entities;
  let applying = false; // our own look change is going out (our listeners skip it)

  // ---------- the booth ----------
  if (E) {
    E.define({
      key: 'holiday_booth', name: 'Holiday Dress-Up', category: 'holiday', size: BOOTH_SIZE, colors: BOOTH_COLORS,
      build: (c) => holidayBooth(c || BOOTH_COLORS[0]), colliders: BOOTH_COLLIDERS, actions: ['holiday_booth'],
      light: 8, lightPos: [1, 2.2, 0.9],
    });
    E.registerAction('holiday_booth', {
      run: (g, e) => openBubble(e),
      hint: () => 'Tap to dress up!',
    });
  }
  if (game.worldFeatures) {
    // { kind: 'holiday:dressup', x, y, z, rot? } (wave5-plan.md §4.2); features.js runs it on the host
    game.worldFeatures.on('holiday:dressup', (g, f) => {
      if (!g.entities) return false;
      const at = ['holiday_booth', f.x | 0, f.y | 0, f.z | 0, f.rot | 0, null, {}];
      const e = g.entities.place(...at, g.worldFeatures.placeOpts()) || g.entities.place(...at, g.worldFeatures.placeOpts({ force: true }));
      return !!e;
    });
  }

  // ---------- her look ----------
  const state = () => normState(game.profile.holidayLooks);
  const style = () => (typeof game.surpriseStyle === 'function' ? game.surpriseStyle() : null);
  /** 'g' | 'b' | 'n': the Studio's Girl / Boy choice, else what her own clothes say. */
  const side = () => {
    const s = state();
    return sideFor(s.own ? { ...normalizeLook(game.profile.look), ...s.own } : game.profile.look, style());
  };
  const sig = (l) => JSON.stringify(normalizeLook(l));

  const checkStickers = (look) => {
    const shown = costumeShown(look);
    if (shown) award(STICKER_FOR[shown]);
  };

  /** Put a look on (saved, drawn, sent to friends) and keep the booth state with it. */
  const setLook = (look, st) => {
    const next = normalizeLook(look);
    game.profile.look = next;
    game.profile.holidayLooks = st && (st.own || st.wearing) ? st : { ...EMPTY_STATE };
    game.saveProfile(true);
    applying = true;
    try {
      game.events.emit('avatar:changed', { look: cloneLook(next) });
      game.events.emit('outfit:changed', { look: cloneLook(next) });
    } finally {
      applying = false;
    }
    checkStickers(next);
  };

  /** The sparkle puff around her (and a little twirl). */
  const puff = (kind) => {
    const p = game.player;
    game.audio.play('magic', { pitch: kind === 'me' ? 1.0 : 1.25, volume: 0.7 });
    if (!p) return;
    const x = p.position.x, y = p.position.y, z = p.position.z;
    game.celebrate([x, y + 1, z], 'sparkle', { quiet: true, count: 34 });
    game.celebrate([x, y + 1.6, z], 'star', { quiet: true, count: 10 });
    if (kind !== 'me') game.celebrate([x, y + 2.2, z], 'snowflake', { quiet: true, count: 12 });
    setTimeout(() => { if (game.player === p && p.state === 'walk') p.emote('twirl'); }, 120);
  };

  /** A booth change: puff, look, one Undo step (skipped if her look changed again since). */
  const change = (res, kind) => {
    if (!res) return false;
    const before = { look: cloneLook(normalizeLook(game.profile.look)), st: state() };
    puff(kind);
    setLook(res.look, res.state);
    const after = { look: cloneLook(normalizeLook(res.look)), st: normState(res.state) };
    const swap = (from, to) => () => {
      if (sig(game.profile.look) !== sig(from.look)) return false; // changed in the Studio since
      setLook(to.look, to.st);
      return true;
    };
    game.pushHistory({ undo: swap(after, before), redo: swap(before, after) });
    return true;
  };

  /** Wear a costume: a button id ('elf', 'santa', 'santa_dress') or a HOLIDAY_OUTFITS key. */
  const dress = (id) => {
    const btn = buttonsFor(side(), state()).find((b) => b.id === id);
    const outfit = btn ? btn.outfit : id;
    const res = wearCostume(game.profile.look, state(), outfit);
    if (!change(res, outfit)) return false;
    game.events.emit('holidaylook:wear', { outfit, look: cloneLook(res.look) });
    return true;
  };

  /** "Back to me": her own clothes back on. */
  const back = () => {
    const res = backToMe(game.profile.look, state());
    if (!change(res, 'me')) return false;
    game.events.emit('holidaylook:back', { look: cloneLook(res.look) });
    return true;
  };

  // a look change from anywhere else (the Studio, Settings, a sea form): keep the state honest
  // (no holiday piece left: "Back to me" has nothing to go back to), and dressing up from the
  // Studio's Holiday looks earns the stickers too
  const outside = ({ look } = {}) => {
    if (game.net?.remoteApplying) return; // a friend's change on this page is never hers (DESIGN.md §5)
    if (applying || !look) return;
    const st = game.profile.holidayLooks;
    if (st && (st.own || st.wearing)) {
      const next = afterOutsideChange(st, look);
      if (!next.own && !next.wearing) game.profile.holidayLooks = { ...EMPTY_STATE };
    }
    checkStickers(look);
  };
  game.events.on('outfit:changed', outside);
  game.events.on('avatar:changed', outside);

  // ---------- the bubble: big buttons over her head ----------
  let bubble = null, booth = null, life = 0, openedAt = 0;
  if (ui && typeof document !== 'undefined') ui.addStyles(CSS);

  function closeBubble() {
    if (!bubble) return;
    bubble.classList.remove('lf-on');
    bubble.remove();
    bubble = null;
    booth = null;
  }

  const roundBtn = (b) => {
    const el = ui.el('button', 'sw-round');
    el.type = 'button';
    el.dataset.hl = b.id;
    el.setAttribute('aria-label', b.label);
    if (b.on) el.classList.add('hl-on');
    if (b.off) {
      el.classList.add('hl-off');
      el.setAttribute('aria-disabled', 'true');
    }
    const f = ui.el('span', 'sw-round-face');
    f.style.setProperty('--c', b.color);
    f.innerHTML = picture(b.pic, 50);
    el.append(f, ui.el('span', 'sw-round-label', b.label));
    el.addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (b.off) {
        game.audio.play('click', { pitch: 0.8 });
        game.toast('You are you already!', { icon: 'heart', key: 'holiday-looks-me' });
        return;
      }
      game.audio.play('click');
      closeBubble();
      if (b.id === 'me') back();
      else dress(b.id);
    });
    return el;
  };

  /** Project a world point to container px; null when behind the camera or not a number. */
  const screenAt = (pos, up, cam, W, H) => {
    const v = pos.clone();
    v.y += up;
    v.project(cam);
    if (!(v.z <= 1) || !Number.isFinite(v.x) || !Number.isFinite(v.y)) return null;
    return { x: ((v.x + 1) / 2) * W, y: ((1 - v.y) / 2) * H };
  };

  const place = () => {
    const p = game.player, cam = game.camera;
    if (!bubble || !p || !cam || !game.container) return;
    const W = game.container.clientWidth, H = game.container.clientHeight;
    // over her head; seen through her own eyes (camera 'first') her head is the camera, so
    // over the booth instead; and if neither shows, in the middle: the buttons never vanish
    const first = !!(game.cameraRig && game.cameraRig.mode === 'first');
    const o = booth && booth.object3d ? booth.object3d.position : null;
    const s = (!first && screenAt(p.position, 2.3, cam, W, H)) || (o && screenAt(o, 3.1, cam, W, H)) || { x: W / 2, y: H * 0.45 };
    const x = s.x, y = s.y;
    bubble.style.visibility = '';
    const w = bubble.offsetWidth || 340, h = bubble.offsetHeight || 150;
    bubble.style.left = Math.round(Math.max(w / 2 + 8, Math.min(W - w / 2 - 8, x))) + 'px';
    bubble.style.top = Math.round(Math.max(h + 8, Math.min(H - 90, y))) + 'px';
  };

  function openBubble(entity) {
    if (!ui || typeof document === 'undefined' || game.mode !== 'play') return false;
    if (ui.current) return false; // a panel is up: one thing at a time
    // a choice bubble that came up by itself (merfolk's) gives way to a tap, as ocean's does
    if (ui.hudLayer.querySelector('.lf-bubble.lf-on[data-owner="merfolk"]')) game.events.emit('ui:bubble-closed', { owner: 'merfolk', by: 'holiday-looks' });
    if (!bubble) {
      bubble = ui.el('div', 'lf-bubble');
      bubble.dataset.owner = 'holiday-looks';
      ui.hudLayer.appendChild(bubble);
    }
    booth = entity || null;
    life = 0;
    openedAt = typeof performance !== 'undefined' ? performance.now() : 0;
    bubble.textContent = '';
    const name = ui.el('div', 'lf-bubble-name');
    name.innerHTML = picture('holiday', 24);
    name.appendChild(document.createTextNode('Holiday Dress-Up!'));
    const row = ui.el('div', 'lf-bubble-row');
    for (const b of buttonsFor(side(), state())) row.appendChild(roundBtn(b));
    bubble.append(name, row);
    bubble.classList.add('lf-on');
    place();
    game.audio.play('pop', { pitch: 1.2 });
    const o = entity && entity.object3d ? entity.object3d.position : null;
    if (o) game.celebrate([o.x, o.y + 2.4, o.z], 'sparkle', { quiet: true, count: 12 });
    return true;
  }

  const boothGone = () => !!(booth && E && !E.byUid(booth.uid));
  const farFromBooth = () => {
    if (!booth || !booth.object3d || !game.player) return false;
    const a = booth.object3d.position, b = game.player.position;
    return Math.hypot(a.x - b.x, a.z - b.z) > BUBBLE_AWAY;
  };

  // a tap anywhere else in the world puts the buttons away (like a pet's or a friend's bubble);
  // the tap that opened them is not that tap
  if (game.input && typeof game.input.on === 'function') {
    game.input.on('tap', () => {
      if (bubble && performance.now() - openedAt > 120) closeBubble();
    });
  }
  game.events.on('ui:open', closeBubble);
  game.events.on('world:unload', closeBubble);
  game.events.on('ui:bubble-closed', ({ owner } = {}) => { if (owner === 'holiday-looks') closeBubble(); });

  // ---------- friends in Holiday Village ----------
  game.events.on('friend:invite', ({ friend } = {}) => {
    const sys = game.friends, net = game.net;
    if (!friend || !sys || sys.remote || (net && (net.isGuest || net.remoteApplying))) return;
    if (!isHolidayWorld(game.world)) return;
    const world = game.world;
    setTimeout(() => {
      if (game.world !== world || !sys.friends.includes(friend)) return;
      const key = friendHolidayKey(friend.def || friendDef(friend.key));
      if (key) sys.style(friend, 'outfit', key);
    }, FRIEND_DRESS_DELAY);
  });

  // ---------- the system, the facade and the debug hooks ----------
  game.addSystem({
    name: 'holiday-looks',
    update(dt) {
      if (!bubble) return;
      life += dt;
      if (life > BUBBLE_LIFE || game.mode !== 'play' || boothGone() || farFromBooth()) {
        closeBubble();
        return;
      }
      place();
    },
  });

  game.holidayLooks = {
    /** Wear a costume (a button id or a HOLIDAY_OUTFITS key); false if unknown. */
    dress,
    /** Her own clothes back on; false when nothing is kept. */
    back,
    state,
    /** The buttons the booth shows now. */
    buttons: () => buttonsFor(side(), state()),
    open: (entity = null) => openBubble(entity),
    close: closeBubble,
  };
  game.debug.holidayLooks = {
    state,
    side,
    dress,
    back,
    open: (entity = null) => openBubble(entity),
    close: closeBubble,
    /** The button ids on the bubble now, or null when it is not up. */
    bubble: () => (bubble ? [...bubble.querySelectorAll('[data-hl]')].map((b) => b.dataset.hl) : null),
    friendKey: (key) => friendHolidayKey(friendDef(key)),
    /** Dress every friend in this world now (as if each had just come to Holiday Village). */
    dressFriends: () => {
      const sys = game.friends;
      if (!sys || sys.remote) return 0;
      let n = 0;
      for (const f of sys.friends) {
        const key = friendHolidayKey(f.def || friendDef(f.key));
        if (key && sys.style(f, 'outfit', key)) n++;
      }
      return n;
    },
  };
}
