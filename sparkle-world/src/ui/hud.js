// In-world HUD: hotbar (1-9 / tap), Bag + Undo, tool buttons (Build / Remove / Hand), Fly,
// Emotes, Photo, top-left world name + time icon + gems, top-right Dress Up / Stickers /
// Menu, touch Jump / Up / Down buttons, crosshair, and the sparkly 3D target outline.

import * as THREE from 'three';
import { icon } from './icons.js';

const CSS = /* css */ `
.sw-hud { position: absolute; inset: 0; pointer-events: none !important; display: none; }
.sw-hud.sw-on { display: block; }
.sw-hud * { pointer-events: auto; }
.sw-hud .sw-passive, .sw-hud .sw-passive * { pointer-events: none; }

.sw-hud-tl { position: absolute; top: calc(12px + var(--sw-safe-t)); left: calc(12px + var(--sw-safe-l)); display: flex; gap: 8px; align-items: center; max-width: 52vw; }
.sw-pill { display: inline-flex; align-items: center; gap: 8px; height: 46px; padding: 0 16px 0 10px; border-radius: 999px; background: rgba(255,255,255,.92); border: 4px solid #fff; box-shadow: 0 5px 14px var(--sw-shadow); font-size: 19px; font-weight: 600; color: var(--sw-ink); white-space: nowrap; min-width: 0; }
.sw-pill svg { width: 28px; height: 28px; flex: none; }
.sw-pill .sw-name { overflow: hidden; text-overflow: ellipsis; }
.sw-time svg { color: #FFB300; }
.sw-time.sw-night svg { color: var(--sw-lav); }
.sw-gems svg { color: var(--sw-mint); }

.sw-hud-tr { position: absolute; top: calc(10px + var(--sw-safe-t)); right: calc(12px + var(--sw-safe-r)); display: flex; gap: 10px; }
.sw-round { display: flex; flex-direction: column; align-items: center; gap: 3px; background: none; border: 0; padding: 0; cursor: pointer; font-family: var(--sw-font); -webkit-user-select: none; user-select: none; touch-action: manipulation; }
.sw-round-face { width: 58px; height: 58px; border-radius: 50%; display: grid; place-items: center; background: var(--c, var(--sw-pink)); color: #fff; border: 4px solid #fff; box-shadow: 0 5px 0 rgba(58,31,77,.14), 0 8px 18px var(--sw-shadow), inset 0 -5px 0 rgba(0,0,0,.08), inset 0 4px 0 rgba(255,255,255,.3); transition: transform .18s var(--sw-bounce); }
.sw-round-face svg { width: 32px; height: 32px; filter: drop-shadow(0 2px 0 rgba(58,31,77,.15)); }
/* positioned (no z-index) so it paints after the face, which gets a transform when active */
.sw-round-label { position: relative; font-size: 15px; font-weight: 700; color: var(--sw-ink); background: rgba(255,255,255,.92); padding: 1px 8px; border-radius: 999px; box-shadow: 0 2px 6px var(--sw-shadow); }
.sw-round:hover .sw-round-face { transform: scale(1.06); }
.sw-round:active .sw-round-face { transform: scale(.9); }
.sw-round.sw-active .sw-round-face { box-shadow: 0 0 0 5px var(--sw-sun), 0 8px 22px var(--sw-shadow), inset 0 -5px 0 rgba(0,0,0,.08); transform: scale(1.1); }
.sw-round.sw-active .sw-round-label { background: var(--sw-sun); }
.sw-round--big .sw-round-face { width: 70px; height: 70px; }
.sw-round--big .sw-round-face svg { width: 38px; height: 38px; }
.sw-round[hidden] { display: none; }

.sw-hud-right { position: absolute; right: calc(14px + var(--sw-safe-r)); top: 50%; transform: translateY(-50%); display: flex; flex-direction: column; gap: 10px; align-items: center; }
.sw-hud-right .sw-sep { height: 4px; width: 36px; border-radius: 4px; background: rgba(255,255,255,.7); margin: 2px 0; }

.sw-hud-bottom { position: absolute; left: 50%; bottom: calc(12px + var(--sw-safe-b)); transform: translateX(-50%); display: flex; align-items: flex-end; gap: 12px; }
.sw-hotbar { display: flex; gap: 6px; padding: 7px; border-radius: 26px; background: rgba(255,255,255,.55); border: 4px solid rgba(255,255,255,.9); box-shadow: 0 8px 22px var(--sw-shadow); backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px); }
.sw-slot { position: relative; width: 60px; height: 60px; border-radius: 18px; background: var(--sw-cream); border: 3px solid #fff; box-shadow: inset 0 -4px 0 rgba(58,31,77,.08); display: grid; place-items: center; cursor: pointer; padding: 0; transition: transform .18s var(--sw-bounce), box-shadow .18s; touch-action: manipulation; }
.sw-slot img { width: 46px; height: 46px; image-rendering: auto; pointer-events: none; }
.sw-slot .sw-num { position: absolute; top: 2px; left: 6px; font-size: 12px; font-weight: 700; color: rgba(58,31,77,.45); pointer-events: none; }
.sw-slot .sw-swatch { position: absolute; bottom: 4px; right: 4px; width: 12px; height: 12px; border-radius: 50%; border: 2px solid #fff; pointer-events: none; }
.sw-slot.sw-sel { transform: translateY(-8px) scale(1.12); background: #fff; border-color: var(--sw-pink); box-shadow: 0 0 0 4px #fff, 0 0 18px 6px rgba(255,95,162,.55), 0 8px 16px var(--sw-shadow); }
.sw-slot:active { transform: scale(.92); }

.sw-crosshair { position: absolute; left: 50%; top: 50%; width: 22px; height: 22px; margin: -11px 0 0 -11px; pointer-events: none !important; display: none; }
.sw-crosshair::before, .sw-crosshair::after { content: ''; position: absolute; background: #fff; border-radius: 3px; box-shadow: 0 0 0 1.5px rgba(58,31,77,.35); }
.sw-crosshair::before { left: 9px; top: 2px; width: 4px; height: 18px; }
.sw-crosshair::after { top: 9px; left: 2px; height: 4px; width: 18px; }
.sw-crosshair.sw-show { display: block; }

.sw-touch { position: absolute; right: calc(16px + var(--sw-safe-r)); bottom: calc(112px + var(--sw-safe-b)); display: none; flex-direction: column; gap: 10px; align-items: center; }
.sw-touch.sw-show { display: flex; }
.sw-touch .sw-round-face { width: 78px; height: 78px; }
.sw-touch .sw-round-face svg { width: 40px; height: 40px; }
.sw-touch .sw-flybtn .sw-round-face { width: 60px; height: 60px; }
.sw-touch .sw-flybtn[hidden] { display: none; }

.sw-app:not(.sw-playing) .sw-joy { display: none !important; }
.sw-joy { position: absolute; left: calc(84px + var(--sw-safe-l)); bottom: calc(190px + var(--sw-safe-b)); width: 124px; height: 124px; margin: -62px 0 0 -62px; transform: translate(0, 50%); border-radius: 50%; background: rgba(255,255,255,.28); border: 4px solid rgba(255,255,255,.75); box-shadow: 0 6px 18px var(--sw-shadow); pointer-events: none; z-index: 5; }
.sw-joy.active { bottom: auto; transform: none; background: rgba(255,255,255,.36); }
.sw-joy-thumb { position: absolute; left: 50%; top: 50%; width: 56px; height: 56px; border-radius: 50%; background: var(--sw-pink); border: 4px solid #fff; box-shadow: 0 4px 12px var(--sw-shadow); transform: translate(-50%, -50%); }

@media (max-width: 760px), (max-height: 520px) {
  .sw-slot { width: 44px; height: 44px; border-radius: 14px; border-width: 2px; }
  .sw-slot img { width: 34px; height: 34px; }
  .sw-slot .sw-num { display: none; }
  .sw-hotbar { gap: 3px; padding: 4px; border-radius: 20px; border-width: 3px; }
  .sw-hud-bottom { gap: 6px; }
  .sw-round-face { width: 50px; height: 50px; border-width: 3px; }
  .sw-round-face svg { width: 27px; height: 27px; }
  .sw-round--big .sw-round-face { width: 58px; height: 58px; }
  .sw-round--big .sw-round-face svg { width: 32px; height: 32px; }
  .sw-round-label { font-size: 13px; }
  .sw-pill { height: 40px; font-size: 16px; padding: 0 12px 0 8px; }
  .sw-pill svg { width: 24px; height: 24px; }
  .sw-hud-right { gap: 6px; }
}
@media (max-width: 480px) {
  .sw-hud-bottom { left: 0; right: 0; transform: none; justify-content: center; flex-wrap: wrap; bottom: calc(8px + var(--sw-safe-b)); }
  .sw-hud-bottom .sw-hotbar { order: 3; width: 100%; max-width: 380px; justify-content: space-between; margin: 0 8px; }
  .sw-slot { width: calc((100vw - 56px) / 9); height: calc((100vw - 56px) / 9); max-width: 44px; max-height: 44px; }
  .sw-slot img { width: 78%; height: 78%; }
  .sw-hud-bottom .sw-bagbtn, .sw-hud-bottom .sw-undobtn { order: 1; }
  .sw-hud-bottom .sw-undobtn { order: 2; }
  .sw-hud-bottom .sw-spacer { order: 1; flex: 1; }
  .sw-hud-tr .sw-round-label { display: none; }
  .sw-hud-tr { gap: 6px; }
  .sw-hud-tr .sw-round-face { width: 46px; height: 46px; }
  .sw-hud-tl { max-width: 48vw; flex-direction: column; align-items: flex-start; gap: 6px; }
  .sw-touch { bottom: calc(150px + var(--sw-safe-b)); }
  .sw-joy { bottom: calc(230px + var(--sw-safe-b)); left: calc(78px + var(--sw-safe-l)); }
  .sw-hud-right { top: auto; bottom: calc(300px + var(--sw-safe-b)); transform: none; }
}
`;

const TOOL_COLORS = { build: '#FF5FA2', remove: '#FF7A7A', hand: '#3FD8B0' };

/** Round icon button with a sticker label underneath. */
function roundButton(ui, { icon: ic, label, color, big = false, onClick }) {
  const b = ui.el('button', 'sw-round' + (big ? ' sw-round--big' : ''));
  b.type = 'button';
  b.setAttribute('aria-label', label);
  const face = ui.el('span', 'sw-round-face');
  face.style.setProperty('--c', color);
  face.innerHTML = icon(ic);
  b.append(face, ui.el('span', 'sw-round-label', label));
  if (onClick) {
    b.addEventListener('click', (e) => {
      ui.game.audio.play('click');
      onClick(e);
    });
  }
  return b;
}

/** Hold-able touch button feeding input.press(name). */
function holdButton(ui, { icon: ic, label, color, name, className = '' }) {
  const b = roundButton(ui, { icon: ic, label, color });
  if (className) b.classList.add(className);
  const input = ui.game.input;
  const down = (e) => { e.preventDefault(); input.press(name, true); ui.game.audio.unlock(); };
  const up = () => input.press(name, false);
  b.addEventListener('pointerdown', down);
  b.addEventListener('pointerup', up);
  b.addEventListener('pointercancel', up);
  b.addEventListener('pointerleave', up);
  b.addEventListener('contextmenu', (e) => e.preventDefault());
  return b;
}

/** Sparkly outline around the targeted block/pickable plus a glow on the targeted face. */
class TargetOutline {
  constructor(game) {
    this.game = game;
    this.group = new THREE.Group();
    this.group.name = 'target-outline';
    this.group.visible = false;
    this.group.renderOrder = 5;
    this.mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false });
    const unit = new THREE.BoxGeometry(1, 1, 1);
    this.edges = [];
    for (let i = 0; i < 12; i++) {
      const m = new THREE.Mesh(unit, this.mat);
      this.edges.push(m);
      this.group.add(m);
    }
    this.faceMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.face = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.faceMat);
    this.group.add(this.face);
    this._key = '';
    this._min = new THREE.Vector3();
    this._max = new THREE.Vector3();
    this._t = 0;
    this._white = new THREE.Color(1, 1, 1);
    game.scene.add(this.group);
  }

  setBox(min, max, faceNormal) {
    const e = 0.012, th = 0.035;
    const x0 = min.x - e, y0 = min.y - e, z0 = min.z - e;
    const x1 = max.x + e, y1 = max.y + e, z1 = max.z + e;
    const sx = x1 - x0, sy = y1 - y0, sz = z1 - z0;
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, cz = (z0 + z1) / 2;
    let i = 0;
    const put = (px, py, pz, w, h, d) => {
      const m = this.edges[i++];
      m.position.set(px, py, pz);
      m.scale.set(w, h, d);
    };
    for (const y of [y0, y1]) for (const z of [z0, z1]) put(cx, y, z, sx + th, th, th);
    for (const x of [x0, x1]) for (const z of [z0, z1]) put(x, cy, z, th, sy + th, th);
    for (const x of [x0, x1]) for (const y of [y0, y1]) put(x, y, cz, th, th, sz + th);
    if (faceNormal) {
      const [nx, ny, nz] = faceNormal;
      this.face.visible = true;
      this.face.position.set(nx ? (nx > 0 ? x1 : x0) : cx, ny ? (ny > 0 ? y1 : y0) : cy, nz ? (nz > 0 ? z1 : z0) : cz);
      this.face.rotation.set(0, 0, 0);
      if (nx) { this.face.rotation.y = Math.PI / 2; this.face.scale.set(sz, sy, 1); }
      else if (ny) { this.face.rotation.x = -Math.PI / 2; this.face.scale.set(sx, sz, 1); }
      else this.face.scale.set(sx, sy, 1);
    } else {
      this.face.visible = false;
    }
  }

  update(dt) {
    const g = this.game;
    const t = g.mode === 'play' && !g.paused ? g.target : null;
    if (!t || this.hidden) {
      this.group.visible = false;
      this._key = '';
      return;
    }
    this._t += dt;
    const tool = g.selectedTool;
    let key;
    if (t.type === 'block') {
      key = `b${t.x},${t.y},${t.z},${t.face.join('')},${tool}`;
      if (key !== this._key) {
        const box = g.registry.blocks.byId(t.id);
        const shape = box ? box.shape : 'cube';
        const h = shape === 'slab' ? 0.5 : shape === 'carpet' ? 1 / 16 : 1;
        const inset = shape === 'cross' ? 0.15 : 0;
        this._min.set(t.x + inset, t.y, t.z + inset);
        this._max.set(t.x + 1 - inset, t.y + h * (shape === 'cross' ? 0.9 : 1), t.z + 1 - inset);
        this.setBox(this._min, this._max, tool === 'build' ? t.face : null);
      }
    } else {
      const b = t.pickable.box;
      key = `p${b.min.x},${b.min.y},${b.min.z},${b.max.x},${b.max.y},${tool}`;
      if (key !== this._key) this.setBox(b.min, b.max, null);
    }
    this._key = key;
    this.mat.color.set(TOOL_COLORS[tool] || '#ffffff').lerp(this._white, 0.35 + 0.25 * Math.sin(this._t * 5));
    this.mat.opacity = 0.75 + 0.2 * Math.sin(this._t * 5);
    this.group.visible = true;
  }
}

export function install(game) {
  const ui = game.ui;
  ui.addStyles(CSS);
  const hud = ui.el('div', 'sw-hud');
  ui.hudLayer.appendChild(hud);

  // top-left: world name + time of day, gems
  const tl = ui.el('div', 'sw-hud-tl');
  const namePill = ui.el('div', 'sw-pill sw-time sw-passive');
  const nameText = ui.el('span', 'sw-name', '');
  namePill.innerHTML = icon('sun');
  namePill.appendChild(nameText);
  const gemPill = ui.el('div', 'sw-pill sw-gems sw-passive');
  gemPill.innerHTML = icon('gem');
  const gemText = ui.el('span', '', '0');
  gemPill.appendChild(gemText);
  tl.append(namePill, gemPill);

  // top-right: Dress Up, Stickers, Menu
  const tr = ui.el('div', 'sw-hud-tr');
  const dressBtn = roundButton(ui, { icon: 'dress', label: 'Dress Up', color: 'var(--sw-lav)', onClick: () => game.runAction('dressup') });
  const stickerBtn = roundButton(ui, { icon: 'sticker', label: 'Stickers', color: 'var(--sw-sun)', onClick: () => game.runAction('stickers') });
  const menuBtn = roundButton(ui, { icon: 'menu', label: 'Menu', color: 'var(--sw-sky)', onClick: () => game.runAction('menu') });
  tr.append(dressBtn, stickerBtn, menuBtn);

  // right: tools, then fly / emotes / photo
  const right = ui.el('div', 'sw-hud-right');
  const tools = {
    build: roundButton(ui, { icon: 'build', label: 'Build', color: TOOL_COLORS.build, big: true, onClick: () => game.setTool('build') }),
    remove: roundButton(ui, { icon: 'remove', label: 'Remove', color: TOOL_COLORS.remove, big: true, onClick: () => game.setTool('remove') }),
    hand: roundButton(ui, { icon: 'hand', label: 'Hand', color: TOOL_COLORS.hand, big: true, onClick: () => game.setTool('hand') }),
  };
  const flyBtn = roundButton(ui, { icon: 'fly', label: 'Fly', color: 'var(--sw-sky)', onClick: () => game.runAction('fly') });
  const emoteBtn = roundButton(ui, { icon: 'emote', label: 'Emotes', color: 'var(--sw-sun)', onClick: () => game.runAction('emotes') });
  const photoBtn = roundButton(ui, { icon: 'photo', label: 'Photo', color: 'var(--sw-lav)', onClick: () => game.runAction('photo') });
  right.append(tools.build, tools.remove, tools.hand, ui.el('div', 'sw-sep'), flyBtn, emoteBtn, photoBtn);

  // bottom: bag, hotbar, undo
  const bottom = ui.el('div', 'sw-hud-bottom');
  const bagBtn = roundButton(ui, { icon: 'bag', label: 'Bag', color: 'var(--sw-pink)', big: true, onClick: () => game.runAction('bag') });
  bagBtn.classList.add('sw-bagbtn');
  const undoBtn = roundButton(ui, { icon: 'undo', label: 'Undo', color: 'var(--sw-lav)', onClick: () => game.undo() });
  undoBtn.classList.add('sw-undobtn');
  const hotbar = ui.el('div', 'sw-hotbar');
  const slots = [];
  for (let i = 0; i < 9; i++) {
    const s = ui.el('button', 'sw-slot');
    s.type = 'button';
    s.setAttribute('aria-label', `Slot ${i + 1}`);
    s.appendChild(ui.el('span', 'sw-num', String(i + 1)));
    const img = ui.el('img');
    img.alt = '';
    img.draggable = false;
    s.appendChild(img);
    const sw = ui.el('span', 'sw-swatch');
    s.appendChild(sw);
    s.addEventListener('click', () => {
      if (game.hotbar.index === i && game.selectedTool === 'build' && !game.hotbar.slots[i]) game.runAction('bag');
      game.selectSlot(i);
    });
    hotbar.appendChild(s);
    slots.push({ el: s, img, sw, key: undefined });
  }
  const spacer = ui.el('div', 'sw-spacer sw-passive');
  bottom.append(bagBtn, spacer, hotbar, undoBtn);

  const cross = ui.el('div', 'sw-crosshair');

  // touch: jump + fly up/down
  const touch = ui.el('div', 'sw-touch');
  const upBtn = holdButton(ui, { icon: 'up', label: 'Up', color: 'var(--sw-sky)', name: 'jump', className: 'sw-flybtn' });
  const downBtn = holdButton(ui, { icon: 'down', label: 'Down', color: 'var(--sw-sky)', name: 'down', className: 'sw-flybtn' });
  const jumpBtn = holdButton(ui, { icon: 'jump', label: 'Jump', color: 'var(--sw-mint)', name: 'jump' });
  touch.append(upBtn, downBtn, jumpBtn);

  hud.append(tl, tr, right, bottom, cross, touch);

  const outline = new TargetOutline(game);
  game.events.on('thumbnail:before', () => { outline.hidden = true; outline.group.visible = false; });
  game.events.on('thumbnail:after', () => { outline.hidden = false; });

  // ----- refreshers -----
  const refreshHotbar = () => {
    slots.forEach((s, i) => {
      const key = game.hotbar.slots[i];
      s.el.classList.toggle('sw-sel', i === game.hotbar.index);
      const color = game.hotbar.colors[i];
      s.sw.style.display = color ? 'block' : 'none';
      if (color) s.sw.style.background = color;
      if (s.key === key) return;
      s.key = key;
      const item = key ? game.registry.items.get(key) : null;
      s.el.title = item ? item.name : 'Empty';
      s.img.style.visibility = 'hidden';
      if (!item) return;
      game.registry.items.iconFor(key).then((url) => {
        if (s.key !== key) return;
        if (url) { s.img.src = url; s.img.style.visibility = 'visible'; }
      });
    });
  };
  const refreshTools = () => {
    for (const [name, b] of Object.entries(tools)) b.classList.toggle('sw-active', game.selectedTool === name);
  };
  const refreshFly = () => {
    const flying = !!(game.player && game.player.flying);
    flyBtn.classList.toggle('sw-active', flying);
    upBtn.hidden = downBtn.hidden = !flying;
    jumpBtn.hidden = flying;
  };
  const refreshActions = () => {
    dressBtn.hidden = !game.actions.has('dressup');
    stickerBtn.hidden = !game.actions.has('stickers');
    emoteBtn.hidden = !game.actions.has('emotes');
    photoBtn.hidden = !game.actions.has('photo');
  };
  const refreshTouch = () => {
    touch.classList.toggle('sw-show', game.input.touchMode);
  };
  const refreshGems = () => { gemText.textContent = String(game.profile.stats.gems || 0); };
  let lastNight = null;
  const refreshTime = () => {
    const d = game.time.dayTime;
    const night = d < 0.23 || d > 0.77;
    if (night === lastNight) return;
    lastNight = night;
    namePill.classList.toggle('sw-night', night);
    namePill.querySelector('svg').outerHTML = icon(night ? 'moon' : 'sun');
  };

  game.events.on('hotbar:change', refreshHotbar);
  game.events.on('tool:change', refreshTools);
  game.events.on('player:fly', refreshFly);
  game.events.on('gem:collect', refreshGems);
  game.input.on('touchmode', refreshTouch);
  game.events.on('world:load', ({ world }) => {
    nameText.textContent = world.meta.name;
    lastNight = null;
    refreshActions();
    refreshHotbar();
    refreshTools();
    refreshFly();
    refreshGems();
    refreshTouch();
    refreshTime();
    hud.classList.add('sw-on');
    game.container.classList.add('sw-playing');
  });
  game.events.on('world:unload', () => {
    hud.classList.remove('sw-on');
    game.container.classList.remove('sw-playing');
  });
  game.events.on('ui:open', () => cross.classList.remove('sw-show'));

  let timer = 0;
  game.addSystem({
    name: 'hud',
    update(dt) {
      outline.update(dt);
      if (game.mode !== 'play') return;
      cross.classList.toggle('sw-show', !game.paused && !game.input.touchMode && game.input.pointer === null);
      timer -= dt;
      if (timer <= 0) {
        timer = 0.25;
        refreshTime();
      }
    },
  });
}
