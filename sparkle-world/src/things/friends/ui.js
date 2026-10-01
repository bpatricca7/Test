// Friends UI: pretty name tags (sprites), speech bubbles over the friends' heads, the bubble
// with big buttons when she taps a friend (Talk, Follow me / Stay here, Dance, Treat, Dress
// up), the "My Friends" panel (your friends here + invite a friend), portraits drawn on the
// shared avatar stage, and the Friends HUD button.

import * as THREE from 'three';
import { FONT, lifeHud, toScreen, basketCount } from '../pets/kit.js';
import { foodIcon } from '../food-models.js';
import { getStage } from '../../ui/dressup/stage.js';
import { friendIcon } from './icons.js';
import { FRIENDS, friendDef, BAG_FRIEND, outfitsFor, rosterFriends, pronouns } from './looks.js';

export const CSS = /* css */ `
.pl-say { position: absolute; left: 0; top: 0; transform: translate(-50%, -100%); width: max-content; max-width: min(260px, 60vw); padding: 7px 14px 9px;
  background: rgba(255,255,255,.97); border: 4px solid var(--c, var(--sw-pink)); border-radius: 20px; box-shadow: 0 6px 16px var(--sw-shadow);
  font: 700 17px/1.2 var(--sw-font); color: var(--sw-ink); text-align: center; pointer-events: none; z-index: 2; display: none; }
.pl-say.pl-on { display: block; animation: pl-say-in .32s var(--sw-bounce) both; }
.pl-say b { display: block; font-size: 13px; color: var(--c, var(--sw-pink)); letter-spacing: .3px; margin-bottom: 1px; }
.pl-say::after { content: ''; position: absolute; left: 50%; bottom: -12px; width: 16px; height: 16px; margin-left: -8px; background: #fff;
  border-right: 4px solid var(--c, var(--sw-pink)); border-bottom: 4px solid var(--c, var(--sw-pink)); transform: rotate(45deg); border-radius: 0 0 5px 0; }
@keyframes pl-say-in { 0% { transform: translate(-50%, -100%) scale(.4); opacity: 0; } 100% { transform: translate(-50%, -100%) scale(1); opacity: 1; } }

.pl-bubble { position: absolute; left: 0; top: 0; transform: translate(-50%, -100%); display: none; flex-direction: column; align-items: center; gap: 6px;
  padding: 8px 12px 10px; background: rgba(255,255,255,.97); border: 4px solid var(--c, var(--sw-pink)); border-radius: 28px;
  box-shadow: 0 8px 22px var(--sw-shadow); z-index: 3; width: max-content; max-width: min(560px, 94vw); }
.pl-bubble.pl-on { display: flex; }
.pl-bubble::after { content: ''; position: absolute; left: 50%; bottom: -14px; width: 20px; height: 20px; margin-left: -10px; background: #fff;
  border-right: 4px solid var(--c, var(--sw-pink)); border-bottom: 4px solid var(--c, var(--sw-pink)); transform: rotate(45deg); border-radius: 0 0 6px 0; }
.pl-bubble-name { font-size: 19px; font-weight: 700; color: var(--c, var(--sw-pink)); display: flex; align-items: center; gap: 6px; }
.pl-bubble-name svg { width: 22px; height: 22px; }
.pl-bubble-line { font-size: 18px; font-weight: 700; color: var(--sw-ink); text-align: center; max-width: 440px; line-height: 1.2; padding: 0 4px; }
.pl-bubble-line:empty { display: none; }
.pl-row { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px 10px; align-items: flex-start; }
.pl-bubble .sw-round-face { width: 60px; height: 60px; }
.pl-bubble .sw-round-face svg { width: 32px; height: 32px; }
.pl-bubble .sw-round-face img { width: 46px; height: 46px; }
.pl-bubble .sw-round-label { font-size: 14px; white-space: nowrap; }
.pl-bubble .sw-round { position: relative; min-width: 64px; }
.pl-bubble .pl-count { position: absolute; top: -4px; right: -2px; min-width: 24px; height: 24px; padding: 0 5px; border-radius: 12px; background: var(--sw-pink); color: #fff; font-size: 13px; font-weight: 700; display: grid; place-items: center; border: 2px solid #fff; }
@media (max-width: 600px) { .pl-bubble .sw-round-face { width: 50px; height: 50px; } .pl-bubble .sw-round { min-width: 54px; } .pl-bubble-line { font-size: 16px; } }

.pl-panel [hidden] { display: none !important; }
.pl-panel .pl-section { font-size: 20px; font-weight: 700; color: var(--sw-lav); margin: 6px 0 10px; display: flex; align-items: center; gap: 8px; }
.pl-panel .pl-section svg { width: 26px; height: 26px; }
.pl-panel .pl-section small { font-size: 16px; color: var(--sw-pink); margin-left: auto; }
.pl-mine { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px; margin-bottom: 16px; }
.pl-card { background: #fff; border-radius: 22px; border: 4px solid var(--c, var(--sw-pink-soft)); padding: 10px 12px 12px; display: flex; flex-direction: column; gap: 8px; box-shadow: 0 5px 14px var(--sw-shadow); }
.pl-card-top { display: flex; align-items: center; gap: 10px; }
.pl-pic { width: 76px; height: 76px; flex: none; border-radius: 18px; background: radial-gradient(circle at 50% 40%, #fff, #FFEAF4 70%, #EFE8FF); object-fit: cover; }
.pl-card-name { font-size: 22px; font-weight: 700; color: var(--sw-ink); line-height: 1.1; }
.pl-card-meta { font-size: 15px; font-weight: 600; color: var(--c, var(--sw-lav)); }
.pl-card-actions { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; }
.pl-card-actions .sw-btn { padding: 4px 6px; gap: 4px; min-height: 48px; font-size: 15px; min-width: 0; }
.pl-card-actions .sw-btn svg { width: 1.15em; height: 1.15em; }
.pl-roster { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 12px; }
.pl-invite { position: relative; display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 8px 6px 10px; border-radius: 24px; background: #fff;
  border: 4px solid var(--c); cursor: pointer; font-family: var(--sw-font); box-shadow: 0 5px 14px var(--sw-shadow); transition: transform .18s var(--sw-bounce); }
.pl-invite:hover { transform: translateY(-3px) scale(1.03); }
.pl-invite:active { transform: scale(.95); }
.pl-invite .pl-full { width: 100%; aspect-ratio: .8; border-radius: 18px; background: radial-gradient(circle at 50% 38%, #fff, #FFEAF4 62%, #E9E0FF); object-fit: contain; }
.pl-invite b { font-size: 20px; color: var(--sw-ink); line-height: 1.1; }
.pl-invite span { font-size: 15px; font-weight: 700; color: var(--c); display: flex; align-items: center; gap: 4px; }
.pl-invite span svg { width: 18px; height: 18px; }
.pl-invite .pl-here { position: absolute; top: -10px; right: -8px; padding: 3px 10px; border-radius: 14px; background: var(--sw-mint); color: #fff; font-size: 14px; font-weight: 700; border: 3px solid #fff; box-shadow: 0 3px 8px var(--sw-shadow); }
.pl-roster.pl-is-full .pl-invite:not(.pl-is-here) { opacity: .55; }
.pl-note { text-align: center; font-size: 18px; font-weight: 700; color: var(--sw-pink); margin: -2px 0 10px; }
@media (max-width: 600px) { .pl-roster { grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)); } .pl-mine { grid-template-columns: 1fr; } }
`;

// ---------- name tags ----------

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function star(g, cx, cy, r, color) {
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? r * 0.45 : r;
    const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
    if (i) g.lineTo(x, y); else g.moveTo(x, y);
  }
  g.closePath();
  g.fillStyle = color;
  g.fill();
}

/** A name-tag sprite: white pill, a gradient border in her color, a golden star. */
export function friendTag(text, color = '#FF5FA2') {
  const H = 80, font = `700 42px ${FONT}`;
  const c = document.createElement('canvas');
  let g = c.getContext('2d');
  g.font = font;
  const tw = Math.ceil(g.measureText(text).width);
  const W = Math.min(560, tw + 110);
  c.width = W;
  c.height = H;
  g = c.getContext('2d');
  roundRect(g, 5, 8, W - 10, H - 16, (H - 16) / 2);
  g.fillStyle = 'rgba(255,255,255,0.95)';
  g.fill();
  const grad = g.createLinearGradient(0, 0, W, 0);
  grad.addColorStop(0, color);
  grad.addColorStop(0.5, '#FF8CC6');
  grad.addColorStop(1, color);
  g.lineWidth = 7;
  g.strokeStyle = grad;
  g.stroke();
  star(g, 38, H / 2 + 1, 19, '#FFC94D');
  star(g, 38, H / 2 + 1, 9, '#FFF3B0');
  g.font = font;
  g.textBaseline = 'middle';
  g.fillStyle = '#3A1F4D';
  g.fillText(text, 64, H / 2 + 2, W - 80);
  // two tiny sparkles
  star(g, W - 20, 18, 7, color);
  star(g, W - 34, H - 14, 5, '#FFC94D');
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  const mat = new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true, fog: false });
  const s = new THREE.Sprite(mat);
  const h = 0.32;
  s.scale.set((h * W) / H, h, 1);
  s.renderOrder = 6;
  s.userData.w = s.scale.x;
  s.userData.h = s.scale.y;
  return s;
}

export function disposeTag(s) {
  if (!s) return;
  if (s.parent) s.parent.remove(s);
  if (s.material.map) s.material.map.dispose();
  s.material.dispose();
}

// ---------- portraits (the shared avatar stage) ----------

const pics = new Map(); // key -> Promise<dataURL|null>

/** A picture of a look (frame 'full' | 'head'), as a data URL; null when WebGL is missing. */
export function portrait(game, key, look, frame = 'full') {
  const sig = (game.lookSignature ? game.lookSignature(look) : JSON.stringify(look)).slice(0, 400);
  const k = `pals|${frame}|${key}|${sig}`;
  let p = pics.get(k);
  if (!p) {
    p = (async () => {
      try {
        const stage = getStage();
        const canvas = await stage.snapshot(k, look, frame === 'full'
          ? { frame: 'full', size: 224, aspect: 0.8, pose: { emote: 'wave', t: 0.7 } }
          : { frame: 'head', size: 160 });
        return canvas ? canvas.toDataURL('image/png') : null;
      } catch (err) {
        console.warn('[friends] portrait failed', err);
        return null;
      }
    })();
    pics.set(k, p);
  }
  return p;
}

/** The Bag icon of "Invite a Friend": a friend's face with a pink plus badge. */
export async function inviteIcon(game) {
  const face = await portrait(game, 'icon', (friendDef(BAG_FRIEND) || FRIENDS[3]).look, 'head');
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  if (face) {
    const img = await new Promise((resolve) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => resolve(null);
      i.src = face;
    });
    if (img) g.drawImage(img, 0, 0, 128, 128);
  } else {
    // no WebGL for pictures: a simple sweet face
    g.fillStyle = '#F6D2B8';
    g.beginPath(); g.arc(64, 70, 40, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#EACB86';
    g.beginPath(); g.arc(64, 56, 42, Math.PI, 0); g.fill();
    g.fillStyle = '#2A1B33';
    g.beginPath(); g.arc(50, 74, 6, 0, Math.PI * 2); g.arc(78, 74, 6, 0, Math.PI * 2); g.fill();
  }
  g.fillStyle = '#FF5FA2';
  g.strokeStyle = '#FFFFFF';
  g.lineWidth = 6;
  g.beginPath(); g.arc(100, 100, 22, 0, Math.PI * 2); g.fill(); g.stroke();
  g.fillStyle = '#FFFFFF';
  g.fillRect(90, 97, 20, 6);
  g.fillRect(97, 90, 6, 20);
  return c.toDataURL('image/png');
}

// ---------- the UI ----------

// a click this soon after the invite cards appear must have been pressed on the card itself
const GHOST_CLICK_MS = 700;
const MODE_TEXT = { follow: 'Following you', stay: 'Waiting here' };
/** What a friend is doing, for the My Friends card. */
const modeText = (mode, def) => (mode === 'home' ? `At ${pronouns(def).their} spot` : MODE_TEXT[mode] || '');

export function installFriendUI(game, sys) {
  const ui = game.ui;
  ui.addStyles(CSS);

  const el = (tag, cls, text) => ui.el(tag, cls, text);
  const img = (url, cls = '') => {
    const i = el('img', cls);
    i.alt = '';
    i.draggable = false;
    if (url) i.src = url;
    return i;
  };
  const at = { x: 0, y: 0 };

  // ----- speech bubbles -----
  const says = new Map(); // friend -> { el, left }

  function sayBubble(friend, line, seconds) {
    let s = says.get(friend);
    if (!s) {
      const e = el('div', 'pl-say');
      e.style.setProperty('--c', friend.def.color);
      ui.hudLayer.appendChild(e);
      s = { el: e, left: 0 };
      says.set(friend, s);
    }
    s.el.innerHTML = '';
    s.el.append(el('b', '', friend.name), document.createTextNode(line));
    s.el.classList.remove('pl-on');
    void s.el.offsetWidth;
    s.el.classList.add('pl-on');
    s.left = seconds;
    position(s.el, friend, 0.36);
  }

  function hideSay(friend) {
    const s = says.get(friend);
    if (s) {
      s.left = 0;
      s.el.classList.remove('pl-on');
    }
  }

  function dropFriend(friend) {
    const s = says.get(friend);
    if (s) {
      s.el.remove();
      says.delete(friend);
    }
    if (bub.friend === friend) hideBubble();
  }

  const rects = []; // speech bubbles placed this frame (so they never cover each other)
  const rectPool = [];
  function position(e, friend, extra, avoid = false) {
    const p = friend.pos;
    const top = friend.act === 'sleep' ? 0.8 : friend.act === 'sit' ? 1.5 : 1.95;
    const s = toScreen(game, p.x, p.y + top + extra, p.z, at);
    if (!s || !friend.group.visible) {
      e.style.visibility = 'hidden';
      return;
    }
    e.style.visibility = '';
    const w = e.offsetWidth || 200, h = e.offsetHeight || 60;
    const W = game.container.clientWidth, H = game.container.clientHeight;
    const x = Math.max(w / 2 + 8, Math.min(W - w / 2 - 8, s.x));
    let y = Math.max(h + 8, Math.min(H - 90, s.y));
    if (avoid) {
      // anchored at the bottom centre: step above any bubble already placed here
      for (const r of rects) {
        if (Math.abs(r.x - x) < (r.w + w) / 2 + 4 && y - h < r.y && r.y - r.h < y) y = r.y - r.h - 8;
      }
      const r = rectPool[rects.length] || (rectPool[rects.length] = { x: 0, y: 0, w: 0, h: 0 });
      r.x = x; r.y = y; r.w = w; r.h = h;
      rects.push(r);
    }
    e.style.left = Math.round(x) + 'px';
    e.style.top = Math.round(y) + 'px';
  }

  // ----- the bubble with buttons -----
  const bubble = el('div', 'pl-bubble');
  ui.hudLayer.appendChild(bubble);
  const bub = { friend: null, openedAt: 0, idle: 0, view: 'main', line: '' };

  const roundBtn = (label, color, face, onClick, count = null) => {
    const b = el('button', 'sw-round');
    b.type = 'button';
    b.setAttribute('aria-label', label);
    b.dataset.label = label;
    const f = el('span', 'sw-round-face');
    f.style.setProperty('--c', color);
    if (typeof face === 'string') f.innerHTML = face;
    else f.appendChild(face);
    b.append(f, el('span', 'sw-round-label', label));
    if (count !== null) b.appendChild(el('span', 'pl-count', String(count)));
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      game.audio.play('click');
      bub.idle = 0;
      onClick();
    });
    return b;
  };

  function renderBubble() {
    const f = bub.friend;
    if (!f) return;
    bubble.innerHTML = '';
    bubble.style.setProperty('--c', f.def.color);
    const name = el('div', 'pl-bubble-name');
    name.innerHTML = friendIcon(f.def.icon, ui);
    name.appendChild(document.createTextNode(f.name));
    const line = el('div', 'pl-bubble-line', bub.line);
    const row = el('div', 'pl-row');
    const I = (n) => friendIcon(n, ui);
    if (bub.view === 'treat') {
      const cookie = img('');
      foodIcon(game, 'star_cookie').then((u) => { cookie.src = u; });
      row.appendChild(roundBtn('Cookie', 'var(--sw-sun)', cookie, () => { sys.giveTreat(f, 'star_cookie', true); hideBubble(); }));
      for (const k of sys.basketTreats().slice(0, 5)) {
        const pic = img('');
        sys.treatIcon(k).then((u) => { if (u) pic.src = u; });
        row.appendChild(roundBtn(sys.treatName(k), 'var(--sw-pink-soft)', pic, () => { sys.giveTreat(f, k); hideBubble(); }, basketCount(game, k)));
      }
      row.appendChild(roundBtn('Back', 'var(--sw-lav)', ui.icon('back'), () => { bub.view = 'main'; renderBubble(); }));
    } else if (bub.view === 'style') {
      for (const o of outfitsFor(f.def)) {
        row.appendChild(roundBtn(o.name, f.def.color, I(o.icon), () => sys.style(f, 'outfit', o.key)));
      }
      row.appendChild(roundBtn('Surprise!', 'var(--sw-sun)', I('gift'), () => sys.style(f, 'surprise')));
      row.appendChild(roundBtn('New hair', 'var(--sw-lav)', I('hair'), () => sys.style(f, 'hair')));
      row.appendChild(roundBtn('Twins!', 'var(--sw-pink)', I('twins'), () => sys.style(f, 'twins')));
      row.appendChild(roundBtn('Back', 'var(--sw-lav)', ui.icon('back'), () => { bub.view = 'main'; renderBubble(); }));
    } else {
      row.appendChild(roundBtn('Talk', 'var(--sw-lav)', I('talk'), () => sys.talk(f)));
      if (f.mode === 'follow') row.appendChild(roundBtn('Stay here', 'var(--sw-sky)', I('stay'), () => sys.setMode(f, 'stay')));
      else row.appendChild(roundBtn('Follow me', 'var(--sw-mint)', I('follow'), () => sys.setMode(f, 'follow')));
      row.appendChild(roundBtn('Dance', 'var(--sw-pink)', I('music'), () => sys.danceTogether(f)));
      row.appendChild(roundBtn('Treat', 'var(--sw-sun)', I('treat'), () => { bub.view = 'treat'; renderBubble(); }));
      row.appendChild(roundBtn('Dress up', f.def.color, I('dress'), () => { bub.view = 'style'; bub.line = 'What should I wear?'; renderBubble(); }));
    }
    bubble.append(name, line, row);
  }

  function showBubble(friend, line = '', view = 'main') {
    bub.friend = friend;
    bub.view = view;
    bub.line = line;
    bub.openedAt = performance.now();
    bub.idle = 0;
    hideSay(friend);
    renderBubble();
    bubble.classList.add('pl-on');
    position(bubble, friend, 0.3);
  }

  function hideBubble() {
    bub.friend = null;
    bubble.classList.remove('pl-on');
  }

  /** Show a line in the open bubble (when it is this friend's), else a speech bubble. */
  function showLine(friend, line, seconds) {
    if (bub.friend === friend) {
      bub.line = line;
      const l = bubble.querySelector('.pl-bubble-line');
      if (l) l.textContent = line;
      position(bubble, friend, 0.3);
      return;
    }
    sayBubble(friend, line, seconds);
  }

  game.input.on('tap', () => {
    if (bub.friend && performance.now() - bub.openedAt > 120) hideBubble();
  });
  game.events.on('ui:open', hideBubble);

  // ----- the My Friends panel -----
  let mineEl, mineHead, rosterEl, rosterHead, noteEl, panelArgs = {};

  function card(friend) {
    const c = el('div', 'pl-card');
    c.style.setProperty('--c', friend.def.color);
    const top = el('div', 'pl-card-top');
    const pic = img('', 'pl-pic');
    portrait(game, friend.key, friend.look, 'head').then((u) => { if (u) pic.src = u; });
    const words = el('div');
    words.append(el('div', 'pl-card-name', friend.name), el('div', 'pl-card-meta', `${friend.def.style} · ${modeText(friend.mode, friend.def)}`));
    top.append(pic, words);
    const acts = el('div', 'pl-card-actions');
    const btn = (icon, label, variant, fn) => {
      const b = ui.button({ label, variant, size: 'small', onClick: fn });
      b.insertAdjacentHTML('afterbegin', friendIcon(icon, ui));
      return b;
    };
    acts.append(
      btn('bell', 'Call', 'mint', () => { ui.close(); sys.call(friend); }),
      friend.mode === 'follow'
        ? btn('stay', 'Stay', 'sky', () => { sys.setMode(friend, 'stay', { quiet: true }); renderPanel(); })
        : btn('follow', 'Follow', 'sky', () => { sys.setMode(friend, 'follow', { quiet: true }); renderPanel(); }),
      btn('home', 'Home', 'lav', () => { sys.sendHome(friend); renderPanel(); }),
      btn('wave', 'Bye', 'white', () => goodbye(friend)),
    );
    c.append(top, acts);
    return c;
  }

  function renderPanel() {
    const drawnAt = performance.now();
    const pressed = new WeakSet();
    const mine = sys.friends;
    mineEl.innerHTML = '';
    mineHead.hidden = !mine.length;
    mineEl.hidden = !mine.length;
    mineHead.querySelector('small').textContent = `${mine.length} of ${sys.max}`;
    for (const f of mine) mineEl.appendChild(card(f));
    rosterEl.innerHTML = '';
    const full = mine.length >= sys.max;
    rosterEl.classList.toggle('pl-is-full', full);
    noteEl.hidden = !full;
    for (const def of rosterFriends()) {
      const here = mine.find((f) => f.key === def.key) || null;
      const b = el('button', 'pl-invite' + (here ? ' pl-is-here' : ''));
      b.type = 'button';
      b.dataset.friend = def.key;
      b.style.setProperty('--c', def.color);
      b.setAttribute('aria-label', here ? `Call ${def.name}` : `Invite ${def.name}`);
      const pic = img('', 'pl-full');
      portrait(game, def.key, def.look, 'full').then((u) => { if (u) pic.src = u; });
      const style = el('span');
      style.innerHTML = friendIcon(def.icon, ui);
      style.appendChild(document.createTextNode(def.style));
      b.append(pic, el('b', '', def.name), style);
      if (here) b.appendChild(el('span', 'pl-here', 'Here!'));
      b.addEventListener('pointerdown', () => pressed.add(b));
      b.addEventListener('click', (e) => {
        // the tap on the ground that opened this panel must not also pick the card that
        // appeared under the finger (16 cards now fill the spot where it lands)
        if (e.detail !== 0 && !pressed.has(b) && performance.now() - drawnAt < GHOST_CLICK_MS) return;
        if (here) {
          ui.close();
          sys.call(here);
          return;
        }
        if (full) {
          game.audio.play('click', { pitch: 0.6 });
          game.toast(`Your world is full of friends! (${sys.max})`, { icon: 'heart', key: 'friends-full' });
          return;
        }
        const spot = panelArgs.spot || null;
        ui.close();
        sys.invite(def.key, spot);
      });
      rosterEl.appendChild(b);
    }
  }

  async function goodbye(friend) {
    const first = await ui.confirm({ title: `Say bye to ${friend.name}?`, text: `${friend.name} will go home for now. You can invite ${pronouns(friend.def).them} again!`, yes: 'Bye bye', no: 'Stay!', icon: 'heart' });
    if (!first) return;
    const second = await ui.confirm({ title: 'Are you sure?', text: `Give ${friend.name} a big hug first!`, yes: 'Yes, bye', no: 'No, stay!', icon: 'heart' });
    if (!second) return;
    sys.remove(friend, { fx: true });
    game.toast(`Bye bye, ${friend.name}! Come back soon!`, { icon: 'heart' });
    if (ui.isOpen('friends')) renderPanel();
  }

  ui.registerPanel('friends', {
    title: 'My Friends',
    icon: 'heart',
    width: 920,
    build(container) {
      const wrap = el('div', 'pl-panel');
      mineHead = el('div', 'pl-section');
      mineHead.innerHTML = friendIcon('friends', ui);
      mineHead.append(document.createTextNode('Friends in this world'), el('small'));
      mineEl = el('div', 'pl-mine');
      rosterHead = el('div', 'pl-section');
      rosterHead.innerHTML = friendIcon('invite', ui);
      rosterHead.appendChild(document.createTextNode('Invite a friend'));
      noteEl = el('div', 'pl-note', 'Your world is full of friends! Say bye to one to invite another.');
      noteEl.hidden = true;
      rosterEl = el('div', 'pl-roster');
      wrap.append(mineHead, mineEl, rosterHead, noteEl, rosterEl);
      container.appendChild(wrap);
    },
    onOpen(args = {}) {
      panelArgs = args || {};
      ui.setTitle('friends', panelArgs.spot ? 'Invite a Friend!' : 'My Friends');
      renderPanel();
      // invite first when she came from the Bag item
      if (panelArgs.spot) rosterHead.scrollIntoView({ block: 'start' });
    },
  });

  // ----- HUD button -----
  const hud = lifeHud(game);
  const hudBtn = hud.add('friends', { icon: 'sparkle', label: 'Friends', color: 'var(--sw-lav)', order: 25, onClick: () => ui.open('friends') });
  hudBtn.querySelector('.sw-round-face').innerHTML = friendIcon('friends', ui);

  return {
    showBubble,
    hideBubble,
    showLine,
    hideSay,
    dropFriend,
    get bubbleFriend() { return bub.friend; },
    refresh() {
      hud.show('friends', sys.friends.length > 0);
      if (ui.isOpen('friends')) renderPanel();
      if (bub.friend) renderBubble();
    },
    renderBubble,
    update(dt) {
      rects.length = 0;
      for (const [f, s] of says) {
        if (s.left <= 0) continue;
        s.left -= dt;
        if (s.left <= 0 || !sys.friends.includes(f)) s.el.classList.remove('pl-on');
        else position(s.el, f, 0.36, true);
      }
      const f = bub.friend;
      if (!f) return;
      bub.idle += dt;
      if (!sys.friends.includes(f) || game.paused || bub.idle > 12 || f.distToPlayer() > 10) {
        hideBubble();
        return;
      }
      f.attention = Math.max(f.attention, 0.4);
      position(bubble, f, 0.3);
    },
    clear() {
      for (const s of says.values()) s.el.remove();
      says.clear();
      hideBubble();
    },
  };
}
