// The sea animals' screens (docs/teams/ocean.md §7): the dolphin's Ride / Trick bubble (the pets
// bubble look, data-owner="ocean"), the Hop off button in the life column, toasts with the
// animal's picture, the whale pointer at the screen edge and the Sticker Book's Sea Friends
// strip. Every string comes from SEA_TEXT.

import { lifeHud, lifeIcon, toScreen } from '../../things/pets/kit.js';
import { SEA_KINDS, SEA_NAMES, SEA_TEXT, OCEAN_STAR_KINDS } from './kinds.js';
import { thumbFor } from './models.js';

const CSS = /* css */ `
.sw-toast .sw-toast-img { width: 36px; height: 36px; border-radius: 50%; flex: none; background: #EAF7FF; object-fit: contain; box-shadow: 0 0 0 3px #fff; }
.oc-bubble { border-color: #9FDBFF; }
.oc-bubble::after { border-color: #9FDBFF; }
.oc-bubble .lf-bubble-name { color: #3F7FBF; }
.oc-bubble .oc-ride { transform: scale(1.15); transform-origin: 50% 40%; margin: 0 6px 2px; }
.oc-bubble .oc-ride .sw-round-face { animation: lf-pulse 1.4s ease-in-out infinite; }
.oc-bubble .oc-ride.oc-pressed .sw-round-face { animation: none; filter: brightness(.9); transform: scale(.94); }
.oc-pointer { position: absolute; width: 56px; height: 56px; margin: -28px 0 0 -28px; border-radius: 50%; background: rgba(255,255,255,.92); box-shadow: 0 4px 14px var(--sw-shadow); display: none; z-index: 2; pointer-events: none !important; transition: opacity .4s; }
.oc-pointer img { width: 48px; height: 48px; margin: 4px; }
.oc-pointer.oc-on { display: block; }
.oc-friends { margin: 10px auto 2px; padding: 8px 10px 10px; max-width: 760px; background: rgba(234,247,255,.85); border: 3px solid #BFE6FF; border-radius: 22px; text-align: center; position: relative; }
.oc-friends-title { font-size: 18px; font-weight: 700; color: #3F7FBF; margin-bottom: 4px; }
.oc-friends-row { display: flex; flex-wrap: wrap; justify-content: center; gap: 6px 8px; }
.oc-slot { width: 68px; display: flex; flex-direction: column; align-items: center; gap: 2px; background: none; border: 0; padding: 0; cursor: pointer; font: inherit; color: var(--sw-ink); }
.oc-slot-pic { width: 56px; height: 56px; border-radius: 50%; background: #fff; box-shadow: 0 0 0 3px #CFEFFF; display: grid; place-items: center; overflow: hidden; }
.oc-slot-pic img { width: 52px; height: 52px; }
.oc-slot.oc-unmet .oc-slot-pic img { filter: brightness(0) opacity(.22); }
.oc-slot.oc-unmet { cursor: default; }
.oc-slot-name { font-size: 12px; font-weight: 700; line-height: 1.05; min-height: 13px; }
.oc-big { position: absolute; inset: 0; display: none; place-items: center; background: rgba(234,247,255,.94); border-radius: 20px; z-index: 2; }
.oc-big.oc-on { display: grid; }
.oc-big img { width: 120px; height: 120px; animation: oc-wobble 3s ease-in-out infinite; }
.oc-big b { display: block; font-size: 20px; color: #3F7FBF; }
@keyframes oc-wobble { 0%, 100% { transform: perspective(300px) rotateY(-25deg); } 50% { transform: perspective(300px) rotateY(25deg); } }
@media (max-width: 480px) { .oc-slot { width: 58px; } .oc-slot-pic { width: 48px; height: 48px; } .oc-slot-pic img { width: 44px; height: 44px; } }
`;

// what the dolphin bubble keeps clear of (besides the screen edges)
const AVOID = [
  '.sw-stkpop', '.sw-toasts .sw-toast', '.sw-hud .sw-round:not([hidden]) .sw-round-face', '.sw-hud .sw-round:not([hidden]) .sw-round-label',
  '.sw-hud .sw-pill', '.sw-hud .sw-hotbar', '.lf-hud .sw-round:not([hidden])', '.sw-joy', '.sw-wk:not([hidden]) .sw-wk-btn', '.sw-wk:not([hidden]) .sw-wk-label', '.sw-wk-off:not([hidden])',
].join(', ');

export function createSeaUi(game, sys) {
  const ui = game.ui;
  if (!ui) return null;
  ui.addStyles(CSS);
  const urls = new Map();

  /** The picture's data URL if ready, else '' (and it gets ready for next time). */
  const pictureNow = (kind, variant = 0) => {
    const key = kind + ':' + variant;
    if (urls.has(key)) return urls.get(key);
    thumbFor(game, kind, variant).then((u) => { if (u) urls.set(key, u); });
    return '';
  };
  const picture = (kind, variant = 0) => thumbFor(game, kind, variant).then((u) => { if (u) urls.set(kind + ':' + variant, u); return u; });

  /** A toast with the animal's picture (the sparkle icon until the picture is ready). */
  const toast = (text, kind, variant = 0, opts = {}) => {
    // its own colors when that picture is ready, else the kind's default picture
    const img = kind ? pictureNow(kind, variant) || pictureNow(kind, 0) : '';
    ui.toast(text, { icon: 'sparkle', color: 'sky', ...opts, ...(img ? { img } : {}) });
  };

  // ---------------- the dolphin bubble ----------------
  const bubble = ui.el('div', 'lf-bubble oc-bubble');
  bubble.dataset.owner = 'ocean';
  ui.hudLayer.appendChild(bubble);
  const bub = { rec: null, from: 'water', openedAt: 0, idle: 0, pressed: false };
  const at = { x: 0, y: 0 };

  const roundBtn = (label, color, face, onClick, cls = '') => {
    const b = ui.el('button', 'sw-round' + (cls ? ' ' + cls : ''));
    b.type = 'button';
    b.setAttribute('aria-label', label);
    const f = ui.el('span', 'sw-round-face');
    f.style.setProperty('--c', color);
    f.innerHTML = face;
    b.append(f, ui.el('span', 'sw-round-label', label));
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      game.audio.play('click');
      bub.idle = 0;
      onClick(b);
    });
    return b;
  };

  function render() {
    const r = bub.rec;
    bubble.innerHTML = '';
    if (!r) return;
    const name = ui.el('div', 'lf-bubble-name');
    name.innerHTML = lifeIcon('dolphin');
    name.appendChild(document.createTextNode(r.name || SEA_NAMES.dolphin));
    const row = ui.el('div', 'lf-bubble-row');
    row.appendChild(roundBtn(SEA_TEXT.ride, 'var(--sw-pink)', lifeIcon('dolphin'), (b) => {
      if (bub.pressed) return;
      bub.pressed = true;
      b.classList.add('oc-pressed');
      sys.askRide(r, bub.from);
    }, 'oc-ride'));
    row.appendChild(roundBtn(SEA_TEXT.trick, 'var(--sw-lav)', lifeIcon('sparkle'), () => sys.askTrick(r)));
    bubble.append(name, row);
  }

  function showBubble(rec, from = 'water') {
    // merfolk's first-turn choice bubble closes (counted as one showing; §1.4)
    const other = ui.hudLayer.querySelector('.lf-bubble.lf-on[data-owner="merfolk"]');
    if (other) {
      other.classList.remove('lf-on');
      game.events.emit('ui:bubble-closed', { owner: 'merfolk', by: 'ocean' });
    }
    bub.rec = rec;
    bub.from = from;
    bub.openedAt = performance.now();
    bub.idle = 0;
    bub.pressed = false;
    render();
    bubble.classList.add('lf-on');
    position();
  }

  function hideBubble() {
    if (!bub.rec) return;
    const r = bub.rec;
    bub.rec = null;
    bubble.classList.remove('lf-on');
    sys.bubbleClosed(r);
  }

  function position() {
    const r = bub.rec;
    if (!r) return;
    const s = toScreen(game, r.x, r.y + 1.15, r.z, at);
    if (!s) {
      bubble.style.visibility = 'hidden';
      return;
    }
    bubble.style.visibility = '';
    const w = bubble.offsetWidth || 200, h = bubble.offsetHeight || 120;
    const W = game.container.clientWidth, H = game.container.clientHeight;
    // clear of the toasts at the top, the life column on the left, the joystick and the
    // Jump button at the bottom
    let x = Math.max(w / 2 + 96, Math.min(W - w / 2 - 96, s.x));
    let y = Math.max(h + 92, Math.min(H - 190, s.y));
    // never over a sticker pop, a toast or a HUD control (the tools, Fly / Emotes / Say / Photo,
    // Jump or Up / Down, the walkie, the life column, the joystick; on a phone some of them sit
    // inside the margins above): the free spot nearest to where it wants to be, above, below or
    // beside what is in the way
    const base = game.container.getBoundingClientRect();
    const boxes = [];
    for (const el of document.querySelectorAll(AVOID)) {
      if (!el.offsetParent) continue;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const L = r.left - base.left, T = r.top - base.top;
      boxes.push({ L, T, R: L + r.width, B: T + r.height });
    }
    const over = (cx, cy) => boxes.some((b) => cx - w / 2 < b.R + 6 && cx + w / 2 > b.L - 6 && cy - h < b.B + 6 && cy > b.T - 6);
    if (over(x, y)) {
      const fitX = (v) => Math.max(w / 2 + 8, Math.min(W - w / 2 - 8, v)), fitY = (v) => Math.max(h + 8, Math.min(H - 8, v));
      const tries = [];
      for (const b of boxes) tries.push([x, b.T - 10], [x, b.B + 10 + h], [b.R + 10 + w / 2, y], [b.L - 10 - w / 2, y]);
      const pick = (list) => {
        let best = null, bestD = Infinity;
        for (const [tx, ty] of list) {
          const cx = fitX(tx), cy = fitY(ty);
          if (over(cx, cy)) continue;
          const d = Math.hypot(cx - x, cy - y);
          if (d < bestD) { bestD = d; best = [cx, cy]; }
        }
        return best;
      };
      // else a corner of two boxes (each try above moves only one way)
      let best = pick(tries);
      if (!best) {
        const two = [];
        for (const [tx, ty] of tries) for (const b of boxes) two.push([tx, b.T - 10], [tx, b.B + 10 + h], [b.R + 10 + w / 2, ty], [b.L - 10 - w / 2, ty]);
        best = pick(two);
      }
      if (best) [x, y] = best;
    }
    bubble.style.left = Math.round(x) + 'px';
    bubble.style.top = Math.round(y) + 'px';
  }

  game.input.on('tap', () => {
    if (bub.rec && performance.now() - bub.openedAt > 120) hideBubble();
  });
  game.events.on('ui:open', hideBubble);
  game.events.on('world:unload', hideBubble);

  // ---------------- Hop off ----------------
  const hud = lifeHud(game);
  const hop = hud.add('seahop', { icon: 'hopoff', label: SEA_TEXT.hopOff, color: 'var(--sw-pink)', order: 0, onClick: () => sys.hopOff('button') });
  hop.classList.add('lf-pulse');
  const refreshHop = () => hud.show('seahop', !!sys.riding);
  for (const ev of ['sea:ride', 'sea:hopoff', 'world:load', 'world:unload']) game.events.on(ev, refreshHop);

  // ---------------- the whale pointer ----------------
  const pointer = ui.el('div', 'oc-pointer');
  const pImg = ui.el('img');
  pImg.alt = '';
  pointer.appendChild(pImg);
  ui.hudLayer.appendChild(pointer);
  const pointerAt = (on, x = 0, y = 0) => {
    if (!on) { pointer.classList.remove('oc-on'); return; }
    const src = pictureNow('whale', 0);
    if (src && pImg.src !== src) pImg.src = src;
    pointer.classList.add('oc-on');
    pointer.style.left = Math.round(x) + 'px';
    pointer.style.top = Math.round(y) + 'px';
  };

  // ---------------- Sea Friends (Sticker Book) ----------------
  let stripRow = null, big = null;
  const friendsEntry = {
    key: 'sea-friends',
    build(el) {
      const box = ui.el('div', 'oc-friends');
      box.appendChild(ui.el('div', 'oc-friends-title', SEA_TEXT.friends));
      stripRow = ui.el('div', 'oc-friends-row');
      box.appendChild(stripRow);
      big = ui.el('div', 'oc-big');
      big.addEventListener('click', () => big.classList.remove('oc-on'));
      box.appendChild(big);
      el.appendChild(box);
    },
    refresh() {
      if (!stripRow) return;
      stripRow.innerHTML = '';
      big.classList.remove('oc-on');
      for (let i = 0; i < OCEAN_STAR_KINDS; i++) {
        const kind = SEA_KINDS[i];
        const met = sys.met(kind) > 0;
        const b = ui.el('button', 'oc-slot' + (met ? ' oc-met' : ' oc-unmet'));
        b.type = 'button';
        b.dataset.kind = kind;
        b.setAttribute('aria-label', met ? SEA_NAMES[kind] : '?');
        const pic = ui.el('span', 'oc-slot-pic');
        const im = ui.el('img');
        im.alt = '';
        picture(kind, 0).then((u) => { if (u) im.src = u; });
        pic.appendChild(im);
        b.append(pic, ui.el('span', 'oc-slot-name', met ? SEA_NAMES[kind] : ''));
        if (met) {
          b.addEventListener('click', () => {
            game.audio.play('click');
            big.innerHTML = '';
            const bi = ui.el('img');
            bi.alt = '';
            picture(kind, 0).then((u) => { if (u) bi.src = u; });
            const wrap = ui.el('div');
            wrap.append(bi, ui.el('b', '', SEA_NAMES[kind]));
            big.appendChild(wrap);
            big.classList.add('oc-on');
            sys.playSound(kind);
          });
        }
        stripRow.appendChild(b);
      }
    },
  };
  game.events.on('game:ready', () => {
    const list = game.stickerBookExtras || (game.stickerBookExtras = []);
    if (!list.includes(friendsEntry)) list.push(friendsEntry);
    // the nine default pictures, ready before the first meet
    if (game.thumbs) game.thumbs.withPriority('low', () => { for (const k of SEA_KINDS) picture(k, 0); });
  });

  return {
    toast,
    picture,
    pictureNow,
    showBubble,
    hideBubble,
    get bubbleRec() { return bub.rec; },
    get bubbleFrom() { return bub.from; },
    bubbleEl: bubble,
    refreshHop,
    pointerAt,
    pointerEl: pointer,
    update(dt) {
      if (!bub.rec) return;
      // the idle timer pauses while a sticker pop shows
      if (!document.querySelector('.sw-stkpop')) bub.idle += dt;
      const r = bub.rec;
      if (!sys.bubbleValid(r, bub.from) || bub.idle > 9 || game.paused) { hideBubble(); return; }
      position();
    },
  };
}
