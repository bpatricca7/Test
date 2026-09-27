// Dress-Up Studio: the full-screen 'dressup' panel (+ the 'dressup' action). A big 3D avatar
// on a turntable (drag to spin, tap for a happy emote), picture tabs, item grids rendered on
// a mini "you", color swatches and a pattern picker, a name field, "Surprise me!", Undo,
// ready-made looks and six saved outfit slots. Every change is saved to game.profile.look and
// emits 'avatar:changed'; closing after a change emits 'outfit:changed' { look }.

import * as THREE from 'three';
import { icon } from './icons.js';
import { picture } from './dressup/pictures.js';
import { CSS } from './dressup/css.js';
import { getStage } from './dressup/stage.js';
import { Sparkles } from './dressup/sparkles.js';
import { installDebug } from './dressup/debug.js';
import { createAvatar } from '../player/avatar.js';
import { GeoBuilder } from '../player/avatar/geo.js';
import { paintCloth } from '../player/avatar/textures.js';
import * as W from '../player/wardrobe-data.js';

const TABS = [
  { key: 'skin', label: 'Skin', zoom: 'full' },
  { key: 'hair', label: 'Hair', zoom: 'head' },
  { key: 'face', label: 'Face', zoom: 'face' },
  { key: 'tops', label: 'Tops', zoom: 'upper' },
  { key: 'bottoms', label: 'Bottoms', zoom: 'full' },
  { key: 'dresses', label: 'Dresses', zoom: 'full' },
  { key: 'shoes', label: 'Shoes', zoom: 'full' },
  { key: 'hats', label: 'Hats & Ears', zoom: 'head' },
  { key: 'glasses', label: 'Glasses', zoom: 'face' },
  { key: 'back', label: 'Wings & Bags', zoom: 'full' },
  { key: 'neck', label: 'Necklaces', zoom: 'upper' },
  { key: 'hand', label: 'In My Hand', zoom: 'full' },
  { key: 'outfits', label: 'Outfits', zoom: 'full' },
];

// the Studio's own stage picture keys start with one of these (`<tab>|...`, `outfits|slot|...`)
const STUDIO_KEYS = new Set(TABS.map((t) => t.key));

const ZOOMS = {
  full: { cy: 0.98, span: 2.4 },
  upper: { cy: 1.12, span: 1.9 },
  head: { cy: 1.36, span: 1.6 },
  face: { cy: 1.4, span: 1.3 },
};

// nice first colors when an item is picked (the child's later color choice sticks)
const COLOR_HINTS = {
  head: { tiara: '#FFD54A', crown: '#FFD54A', halo: '#FFD54A', witch_hat: '#9C7BFF', beanie: '#FFFFFF', bunny_ears: '#FFFFFF', cat_ears: '#FFD1E6', flower_crown: '#FF8CC6', unicorn_horn: '#FFE58A', sun_hat: '#FF8CC6' },
  neck: { necklace: '#FFD54A', pearls: '#FFFFFF', scarf: '#FF8CC6', bowtie: '#FF5FA2' },
  back: { angel_wings: '#FFD1E6', fairy_wings: '#A5F0E6', butterfly_wings: '#6CC6FF', cape: '#9C7BFF', backpack: '#FFD43B' },
};

const EMOTE_FOR = {
  skin: 'wave', hair: 'twirl', face: 'heart', tops: 'wave', bottoms: 'twirl', dresses: 'twirl', shoes: 'jump',
  hats: 'heart', glasses: 'wave', back: 'twirl', neck: 'heart', hand: 'wave', outfits: 'dance',
};

const THUMB = 192;
const LONG_DRESSES = new Set(['princess', 'ballgown', 'mermaid']);
const IDLE = { speed: 0, onGround: true };
const sig = (l) => JSON.stringify(l);

export function install(game) {
  const ui = game.ui;
  const stage = getStage();
  game.addSystem({ name: 'dressup-stage', update: (dt) => stage.frame(dt) });
  installDebug(game);
  if (!ui) return;
  ui.addStyles(CSS);
  const studio = new Studio(game, stage);
  ui.registerPanel('dressup', {
    fullscreen: true,
    title: 'Dress Up',
    build: (container) => studio.build(container),
    onOpen: (args) => studio.open(args || {}),
    onClose: () => studio.close(),
    back: (g) => (g.mode === 'title' && ui.hasPanel('title') ? 'title' : null),
  });
  game.registerAction('dressup', (g, args) => {
    if (g.ui.dialogOpen) return false;
    return g.ui.open('dressup', args);
  });
  game.dressup = studio;
}

class Studio {
  constructor(game, stage) {
    this.game = game;
    this.ui = game.ui;
    this.stage = stage;
    this.look = W.normalizeLook(game.profile.look);
    this.undoStack = [];
    this.views = new Map();
    this.tab = 'hair';
    this.isOpen = false;
    this.preview = null;
    this._emitTimer = 0;
  }

  // ---------- DOM ----------

  build(container) {
    const el = (tag, cls, text) => this.ui.el(tag, cls, text);
    const root = el('div', 'sw-dress');
    // floating sparkles in the background
    const bg = el('div', 'sw-dress-bg');
    const spots = [[6, 18, 26], [92, 12, 20], [48, 6, 16], [88, 70, 28], [4, 78, 18], [30, 92, 14], [70, 94, 22], [60, 30, 12]];
    spots.forEach(([x, y, s], i) => {
      const sp = el('span');
      sp.innerHTML = icon('sparkle');
      Object.assign(sp.style, { left: `${x}%`, top: `${y}%`, width: `${s}px`, height: `${s}px`, animationDelay: `${-i * 0.4}s` });
      bg.appendChild(sp);
    });
    for (let i = 0; i < 6; i++) {
      const b = el('i');
      const s = 40 + (i * 37) % 90;
      Object.assign(b.style, { left: `${(i * 23) % 100}%`, top: `${(i * 41) % 100}%`, width: `${s}px`, height: `${s}px`, animationDelay: `${-i}s` });
      bg.appendChild(b);
    }
    root.appendChild(bg);

    // top bar: title, name, done
    const top = el('div', 'sw-dress-top');
    const title = el('h2', 'sw-dress-title');
    title.innerHTML = picture('dresses');
    title.appendChild(el('span', '', 'Dress Up!'));
    const nameWrap = el('label', 'sw-dress-name');
    nameWrap.innerHTML = icon('pencil');
    nameWrap.appendChild(el('span', '', 'My name'));
    const name = el('input');
    name.type = 'text';
    name.maxLength = 16;
    name.autocomplete = 'off';
    name.spellcheck = false;
    name.setAttribute('aria-label', 'My name');
    name.placeholder = 'Your name';
    name.addEventListener('input', () => this.setName(name.value));
    name.addEventListener('blur', () => { name.value = this.look.name; });
    name.addEventListener('keydown', (e) => { if (e.key === 'Enter') name.blur(); });
    nameWrap.appendChild(name);
    this.nameInput = name;
    const done = this.ui.button({ icon: 'check', label: 'Done', variant: 'mint', className: 'sw-dress-done', onClick: () => this.ui.back() });
    top.append(title, nameWrap, el('div', 'sw-dress-spacer'), done);

    // main: preview + side panel
    const main = el('div', 'sw-dress-main');
    const stageBox = el('section', 'sw-dress-stage');
    const view = el('div', 'sw-dress-view');
    view.setAttribute('aria-label', 'Your avatar. Drag to spin.');
    for (const [x, y, d] of [[14, 20, 0], [84, 28, 0.7], [20, 64, 1.2], [80, 70, 0.4]]) {
      const s = el('span', 'sw-dress-sparkle');
      s.innerHTML = icon('sparkle');
      Object.assign(s.style, { left: `${x}%`, top: `${y}%`, animationDelay: `${d}s` });
      view.appendChild(s);
    }
    const hint = el('div', 'sw-dress-hint');
    hint.innerHTML = picture('turn', 22);
    hint.appendChild(el('span', '', 'Drag to spin me!'));
    view.appendChild(hint);
    this.hint = hint;
    this.view = view;
    const actions = el('div', 'sw-dress-actions');
    const surprise = this.ui.button({ icon: 'sparkle', label: 'Surprise me!', variant: 'sun', className: 'sw-dress-surprise', onClick: () => this.surprise() });
    const undo = this.ui.button({ icon: 'undo', label: 'Undo', variant: 'white', className: 'sw-dress-undo', onClick: () => this.undo() });
    const turn = this.ui.el('button', 'sw-dress-turn');
    turn.type = 'button';
    turn.setAttribute('aria-label', 'Turn around');
    turn.innerHTML = picture('turn', 30);
    turn.appendChild(this.ui.el('span', '', 'Turn'));
    turn.addEventListener('pointerdown', (e) => e.stopPropagation());
    turn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.game.audio.play('click');
      this.turn();
    });
    view.appendChild(turn);
    actions.append(surprise, undo);
    this.undoBtn = undo;
    stageBox.append(view, actions);

    const side = el('section', 'sw-dress-side');
    const tabs = el('nav', 'sw-dress-tabs');
    tabs.setAttribute('role', 'tablist');
    this.tabButtons = new Map();
    for (const t of TABS) {
      const b = el('button', 'sw-dtab');
      b.type = 'button';
      b.dataset.tab = t.key;
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-label', t.label);
      b.innerHTML = picture(t.key);
      b.appendChild(el('span', '', t.label));
      b.addEventListener('click', () => {
        this.game.audio.play('page');
        this.showTab(t.key);
      });
      tabs.appendChild(b);
      this.tabButtons.set(t.key, b);
    }
    const content = el('div', 'sw-dress-content');
    this.content = content;
    side.append(tabs, content);
    main.append(stageBox, side);
    root.append(top, main);
    container.appendChild(root);
    this.root = root;
    this._bindDrag(view);
  }

  // ---------- open / close ----------

  open(args) {
    this.isOpen = true;
    this.look = W.normalizeLook(this.game.profile.look);
    this.openSig = sig(this.look);
    this.undoStack = [];
    this.nameInput.value = this.look.name;
    this.hint.classList.remove('sw-gone');
    this._setupPreview();
    this.showTab(args.tab && TABS.some((t) => t.key === args.tab) ? args.tab : this.tab, true);
    this._updateUndo();
    if (this.preview) this.preview.avatar.playEmote('wave');
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    clearTimeout(this._emitTimer);
    this._emitTimer = 0;
    const changed = sig(this.look) !== this.openSig;
    // drop the Studio's own queued thumbnails first, and only those: 'outfit:changed' below
    // makes the emote wheel queue pictures of the new look on the same stage
    this.stage.prune((k) => !STUDIO_KEYS.has(k.slice(0, k.indexOf('|'))));
    this._commit(true);
    if (changed) {
      const look = W.cloneLook(this.look);
      this.game.events.emit('outfit:changed', { look });
      if (this.game.mode === 'play') this.game.toast('Looking great!', { icon: 'dress', color: 'pink' });
    }
    this._teardownPreview();
  }

  // ---------- look changes ----------

  /** Change the look with mut(draft). kind: 'item' (plays an emote) | 'color' | 'quiet'. */
  change(mut, { kind = 'item', emote = null, sound = null } = {}) {
    const before = sig(this.look);
    const draft = W.cloneLook(this.look);
    mut(draft);
    const next = W.normalizeLook(draft);
    const after = sig(next);
    if (after === before) return false;
    this.undoStack.push(before);
    if (this.undoStack.length > 40) this.undoStack.shift();
    this.look = next;
    this._applied(kind, emote, sound);
    return true;
  }

  _applied(kind, emote, sound) {
    const p = this.preview;
    if (p) {
      p.avatar.setLook(this.look);
      if (kind === 'item' || kind === 'big') {
        p.avatar.playEmote(emote || EMOTE_FOR[this.tab] || 'wave');
        p.sparkles.emit('sparkle', p.v.set(0, 1.0, 0.3), { count: 16, spread: 1.0 });
      } else if (kind === 'color') {
        p.sparkles.emit('sparkle', p.v.set(0, 1.1, 0.35), { count: 8, spread: 0.7, scale: 0.8 });
      }
      if (kind === 'big') p.sparkles.emit('star', p.v.set(0, 1.4, 0.2), { count: 12, spread: 1.1 });
    }
    this.game.audio.play(sound || (kind === 'color' ? 'pop' : kind === 'big' ? 'magic' : 'sparkle'), { pitch: 0.95 + Math.random() * 0.15 });
    this.refresh();
    this._updateUndo();
    this._commit(false);
  }

  setName(value) {
    const v = String(value || '').replace(/\s+/g, ' ').trimStart().slice(0, 16);
    if (!v.trim()) return;
    this.look = W.normalizeLook({ ...this.look, name: v });
    this.game.profile.nameSet = true; // she typed it: others may see it (src/net)
    this._commit(false);
  }

  undo() {
    const prev = this.undoStack.pop();
    if (!prev) {
      this.game.audio.play('click', { pitch: 0.6 });
      return;
    }
    this.look = W.normalizeLook({ ...JSON.parse(prev), name: this.look.name });
    this._applied('color', null, 'whoosh');
  }

  surprise() {
    this.change((d) => Object.assign(d, W.randomLook(Math.random, this.look.name, this.look)), { kind: 'big', emote: 'jump' });
  }

  turn() {
    if (!this.preview) return;
    this.preview.spinTarget = (this.preview.spinTarget ?? this.preview.spin) + Math.PI;
    this.preview.idle = 0;
    this.game.audio.play('whoosh', { volume: 0.6 });
  }

  _updateUndo() {
    if (this.undoBtn) this.undoBtn.disabled = this.undoStack.length === 0;
  }

  /** Save to the profile; tell the world (throttled while clicking around). */
  _commit(now) {
    const g = this.game;
    g.profile.look = W.cloneLook(this.look);
    g.profile.playerName = this.look.name;
    g.saveProfile(now);
    const fire = () => {
      this._emitTimer = 0;
      g.events.emit('avatar:changed', { look: W.cloneLook(this.look) });
    };
    if (now) {
      clearTimeout(this._emitTimer);
      fire();
    } else if (!this._emitTimer) this._emitTimer = setTimeout(fire, 180);
  }

  // ---------- tabs ----------

  showTab(key, force = false) {
    if (key === this.tab && !force && this.views.has(key)) return;
    this.tab = key;
    for (const [k, b] of this.tabButtons) {
      b.classList.toggle('sw-on', k === key);
      b.setAttribute('aria-selected', k === key ? 'true' : 'false');
    }
    const btn = this.tabButtons.get(key);
    if (btn && btn.scrollIntoView && this.root.clientWidth < 760) btn.scrollIntoView({ block: 'nearest', inline: 'center' });
    let view = this.views.get(key);
    if (!view) {
      view = this._buildTab(key);
      this.views.set(key, view);
    }
    this.content.innerHTML = '';
    this.content.appendChild(view.el);
    this.content.scrollTop = 0;
    this.stage.prune((k) => k.startsWith(key + '|'));
    view.refresh();
    if (this.preview) this.preview.zoom = TABS.find((t) => t.key === key).zoom;
  }

  refresh() {
    const v = this.views.get(this.tab);
    if (v) v.refresh();
  }

  _buildTab(key) {
    const root = this.ui.el('div', 'sw-dtab-view');
    const parts = [];
    const add = (p) => {
      parts.push(p);
      root.appendChild(p.el);
      return p;
    };
    const L = () => this.look;
    const acc = (slot, colorKey, list, frame, colors = W.ACC_COLORS) => {
      add(this._grid(key, list, {
        title: 'Pick one',
        frame,
        thumb: (o) => withAcc(L(), slot, colorKey, o.key),
        on: (o) => L().acc[slot] === o.key,
        pick: (o) => this.change((d) => { Object.assign(d, withAcc(d, slot, colorKey, o.key)); }),
      }));
      add(this._swatches(colors, {
        title: 'Color',
        hidden: () => L().acc[slot] === 'none',
        on: (c) => (L().acc[colorKey] || '').toUpperCase() === c.toUpperCase(),
        pick: (c) => this.change((d) => { d.acc[colorKey] = c; }, { kind: 'color' }),
      }));
    };
    switch (key) {
      case 'skin':
        add(this._swatches(W.SKIN_TONES, {
          title: 'Skin', big: true, pic: 'skin',
          on: (c) => L().skin === c,
          pick: (c) => this.change((d) => { d.skin = c; }, { kind: 'color' }),
        }));
        add(this._swatches(W.EYE_COLORS, {
          title: 'Eye color',
          on: (c) => L().eyes.color === c,
          pick: (c) => this.change((d) => { d.eyes.color = c; }, { kind: 'color' }),
        }));
        break;
      case 'hair':
        add(this._grid(key, W.HAIR_STYLES, {
          title: 'Hair style', frame: 'hair',
          thumb: (o) => ({ ...L(), hair: { ...L().hair, style: o.key } }),
          on: (o) => L().hair.style === o.key,
          pick: (o) => this.change((d) => { d.hair.style = o.key; }),
        }));
        add(this._swatches([...W.HAIR_COLORS_NATURAL, ...W.HAIR_COLORS_FANTASY], {
          title: 'Hair color',
          on: (c) => L().hair.color === c,
          pick: (c) => this.change((d) => { d.hair.color = c; if (d.hair.color2 === c) d.hair.color2 = null; }, { kind: 'color' }),
        }));
        add(this._swatches([...W.HAIR_COLORS_FANTASY, ...W.HAIR_COLORS_NATURAL.slice(4)], {
          title: 'Second color', none: true, rainbow: true,
          on: (c) => (c === null ? L().hair.color2 === null : L().hair.color2 === c),
          pick: (c) => this.change((d) => { d.hair.color2 = c; }, { kind: 'color' }),
        }));
        add(this._grid(key + '-mix', W.HAIR_MIXES, {
          title: 'Color style', frame: 'hair',
          hidden: () => !L().hair.color2,
          thumb: (o) => ({ ...L(), hair: { ...L().hair, mix: o.key } }),
          on: (o) => L().hair.mix === o.key,
          pick: (o) => this.change((d) => { d.hair.mix = o.key; }, { kind: 'color' }),
        }));
        break;
      case 'face':
        add(this._grid(key, W.SMILES, {
          title: 'Smile', frame: 'face',
          thumb: (o) => ({ ...L(), face: { ...L().face, smile: o.key } }),
          on: (o) => L().face.smile === o.key,
          pick: (o) => this.change((d) => { d.face.smile = o.key; }),
        }));
        add(this._swatches(W.EYE_COLORS, {
          title: 'Eye color',
          on: (c) => L().eyes.color === c,
          pick: (c) => this.change((d) => { d.eyes.color = c; }, { kind: 'color' }),
        }));
        for (const [field, label, path] of [['lashes', 'Eyelashes', 'eyes'], ['blush', 'Rosy cheeks', 'face'], ['freckles', 'Freckles', 'face']]) {
          const opts = [{ key: true, name: 'Yes' }, { key: false, name: 'No' }];
          add(this._grid(`${key}-${field}`, opts, {
            title: label, frame: 'face', small: true,
            thumb: (o) => ({ ...L(), [path]: { ...L()[path], [field]: o.key } }),
            on: (o) => L()[path][field] === o.key,
            pick: (o) => this.change((d) => { d[path][field] = o.key; }, { kind: 'color' }),
          }));
        }
        break;
      case 'tops':
        add(this._grid(key, W.TOPS, {
          title: 'Tops', frame: 'torso',
          note: () => (L().dress ? 'Picking a top takes off your dress.' : ''),
          thumb: (o) => ({ ...L(), dress: null, top: { ...L().top, type: o.key } }),
          on: (o) => !L().dress && L().top.type === o.key,
          pick: (o) => this.change((d) => { d.dress = null; d.top.type = o.key; }),
        }));
        this._garmentColors(add, 'top', () => !!L().dress);
        break;
      case 'bottoms':
        add(this._grid(key, W.BOTTOMS, {
          title: 'Bottoms', frame: 'legs',
          note: () => (L().dress ? 'Picking these takes off your dress.' : ''),
          thumb: (o) => ({ ...L(), dress: null, bottom: { ...L().bottom, type: o.key } }),
          on: (o) => !L().dress && L().bottom.type === o.key,
          pick: (o) => this.change((d) => { d.dress = null; d.bottom.type = o.key; }),
        }));
        this._garmentColors(add, 'bottom', () => !!L().dress);
        break;
      case 'dresses': {
        const list = [{ key: 'none', name: 'No Dress' }, ...W.DRESSES];
        add(this._grid(key, list, {
          title: 'Dresses', frame: 'dress',
          thumb: (o) => withDress(L(), o.key),
          on: (o) => (o.key === 'none' ? !L().dress : !!L().dress && L().dress.type === o.key),
          pick: (o) => this.change((d) => { Object.assign(d, withDress(d, o.key)); }),
        }));
        this._garmentColors(add, 'dress', () => !L().dress);
        break;
      }
      case 'shoes':
        add(this._grid(key, W.SHOES, {
          title: 'Shoes', frame: 'feet',
          // long gowns would hide the shoes, so their pictures show them without the gown
          thumb: (o) => ({ ...L(), dress: L().dress && LONG_DRESSES.has(L().dress.type) ? null : L().dress, shoes: { ...L().shoes, type: o.key } }),
          on: (o) => L().shoes.type === o.key,
          pick: (o) => this.change((d) => { d.shoes.type = o.key; }),
        }));
        add(this._swatches(W.CLOTH_COLORS, {
          title: 'Color',
          on: (c) => L().shoes.color === c,
          pick: (c) => this.change((d) => { d.shoes.color = c; }, { kind: 'color' }),
        }));
        break;
      case 'hats':
        acc('head', 'headColor', W.HEAD_ACC, 'head');
        break;
      case 'glasses':
        acc('face', 'faceColor', W.FACE_ACC, 'face');
        break;
      case 'back':
        acc('back', 'backColor', W.BACK_ACC, 'back', W.CLOTH_COLORS);
        break;
      case 'neck':
        acc('neck', 'neckColor', W.NECK_ACC, 'neck');
        break;
      case 'hand':
        acc('hand', 'handColor', W.HAND_ACC, 'hand');
        break;
      case 'outfits':
        add(this._grid(key, W.STARTER_OUTFITS, {
          title: 'Ready-made looks', frame: 'full', big: true, pic: 'outfits',
          thumb: (o) => W.applyOutfit(L(), o),
          on: (o) => sig(W.applyOutfit(L(), o)) === sig(L()),
          pick: (o) => this.change((d) => { Object.assign(d, W.applyOutfit(d, o)); }, { kind: 'big', emote: 'dance' }),
        }));
        add(this._slots());
        break;
      default:
        break;
    }
    return { el: root, refresh: () => { for (const p of parts) p.refresh(); } };
  }

  /** Color + pattern + pattern color for top / bottom / dress. */
  _garmentColors(add, part, hidden) {
    const L = () => this.look;
    const g = () => L()[part] || L().top;
    add(this._swatches(W.CLOTH_COLORS, {
      title: 'Color', hidden,
      on: (c) => g().color === c,
      pick: (c) => this.change((d) => { d[part].color = c; }, { kind: 'color' }),
    }));
    add(this._patterns({
      hidden,
      garment: g,
      pick: (p) => this.change((d) => { d[part].pattern = p; }, { kind: 'color' }),
    }));
    add(this._swatches(W.CLOTH_COLORS, {
      title: 'Pattern color',
      hidden: () => hidden() || g().pattern === 'none',
      on: (c) => g().patternColor === c,
      pick: (c) => this.change((d) => { d[part].patternColor = c; }, { kind: 'color' }),
    }));
  }

  // ---------- controls ----------

  _section(title, pic) {
    const el = this.ui.el('div', 'sw-dsec');
    if (title) {
      const h = this.ui.el('h3', 'sw-dsec-title');
      h.innerHTML = pic ? picture(pic, 26) : icon('sparkle');
      h.appendChild(this.ui.el('span', '', title));
      el.appendChild(h);
    }
    return el;
  }

  /** A grid of item tiles, each pictured on a mini avatar wearing that item. */
  _grid(tabKey, options, cfg) {
    const el = this._section(cfg.title, cfg.pic);
    const note = this.ui.el('div', 'sw-dsec-note');
    el.appendChild(note);
    const grid = this.ui.el('div', 'sw-dgrid' + (cfg.big ? ' sw-dgrid--big' : ''));
    el.appendChild(grid);
    const tiles = options.map((o) => {
      const b = this.ui.el('button', 'sw-dtile');
      b.type = 'button';
      b.setAttribute('aria-label', o.name);
      const check = this.ui.el('span', 'sw-dcheck');
      check.innerHTML = icon('check');
      const pic = this.ui.el('span', 'sw-dpic');
      const c = document.createElement('canvas');
      c.width = c.height = THUMB;
      const wait = this.ui.el('span', 'sw-dwait');
      wait.innerHTML = icon('sparkle');
      pic.append(c, wait);
      if (o.key === 'none') {
        const n = this.ui.el('span', 'sw-dnone');
        n.innerHTML = picture('none', 30);
        pic.appendChild(n);
      }
      b.append(check, pic, this.ui.el('span', '', o.name));
      b.addEventListener('click', () => {
        b.classList.remove('sw-dpop');
        void b.offsetWidth;
        b.classList.add('sw-dpop');
        cfg.pick(o);
      });
      grid.appendChild(b);
      return { o, b, c, pic, key: null };
    });
    const refresh = () => {
      const hide = cfg.hidden ? cfg.hidden() : false;
      el.hidden = hide;
      if (hide) return;
      const n = cfg.note ? cfg.note() : '';
      note.textContent = n;
      note.hidden = !n;
      for (const t of tiles) {
        const on = cfg.on(t.o);
        t.b.classList.toggle('sw-on', on);
        t.b.setAttribute('aria-pressed', on ? 'true' : 'false');
        const look = W.normalizeLook(cfg.thumb(t.o));
        const key = `${tabKey}|${String(t.o.key)}|${sig(look)}`;
        if (key === t.key) continue;
        t.key = key;
        const ready = this.stage.cached(key);
        if (ready) {
          draw(t, ready);
          continue;
        }
        this.stage.snapshot(key, look, { frame: cfg.frame, size: THUMB }).then((canvas) => {
          if (t.key !== key) return;
          if (!canvas) {
            t.key = null;
            return;
          }
          draw(t, canvas);
        });
      }
    };
    const draw = (t, canvas) => {
      const g = t.c.getContext('2d');
      g.clearRect(0, 0, THUMB, THUMB);
      g.drawImage(canvas, 0, 0, THUMB, THUMB);
      t.pic.classList.add('sw-ready');
    };
    return { el, refresh };
  }

  _swatches(colors, cfg) {
    const el = this._section(cfg.title, cfg.pic);
    const row = this.ui.el('div', 'sw-swatches');
    el.appendChild(row);
    const items = [];
    const mk = (value, cls, label) => {
      const b = this.ui.el('button', 'sw-sw' + (cfg.big ? ' sw-sw--big' : '') + (cls ? ' ' + cls : ''));
      b.type = 'button';
      b.setAttribute('aria-label', label);
      if (typeof value === 'string' && value !== 'rainbow') b.style.setProperty('--c', value);
      const check = this.ui.el('span', 'sw-dcheck');
      check.innerHTML = icon('check');
      b.appendChild(check);
      b.addEventListener('click', () => cfg.pick(value));
      row.appendChild(b);
      items.push({ value, b });
      return b;
    };
    if (cfg.none) mk(null, 'sw-sw--none', 'None').insertAdjacentHTML('beforeend', picture('none', 34));
    if (cfg.rainbow) mk('rainbow', 'sw-sw--rainbow', 'Rainbow');
    for (const c of colors) mk(c, '', c);
    const refresh = () => {
      const hide = cfg.hidden ? cfg.hidden() : false;
      el.hidden = hide;
      if (hide) return;
      for (const it of items) {
        const on = cfg.on(it.value);
        it.b.classList.toggle('sw-on', on);
        it.b.setAttribute('aria-pressed', on ? 'true' : 'false');
      }
    };
    return { el, refresh };
  }

  _patterns(cfg) {
    const el = this._section('Pattern');
    const row = this.ui.el('div', 'sw-patterns');
    el.appendChild(row);
    const items = W.PATTERNS.map((p) => {
      const b = this.ui.el('button', 'sw-pat');
      b.type = 'button';
      b.setAttribute('aria-label', p.name);
      const c = document.createElement('canvas');
      c.width = c.height = 96;
      b.append(c, this.ui.el('span', '', p.name));
      b.addEventListener('click', () => cfg.pick(p.key));
      row.appendChild(b);
      return { p, b, c, key: '' };
    });
    const refresh = () => {
      const hide = cfg.hidden ? cfg.hidden() : false;
      el.hidden = hide;
      if (hide) return;
      const g = cfg.garment();
      for (const it of items) {
        it.b.classList.toggle('sw-on', g.pattern === it.p.key);
        const pc = g.patternColor === g.color ? '#FFFFFF' : g.patternColor;
        const key = `${g.color}|${pc}`;
        if (key === it.key) continue;
        it.key = key;
        const ctx = it.c.getContext('2d');
        paintCloth(ctx, 96, 96, { color: g.color, pattern: it.p.key, patternColor: pc, fabric: 'cotton' });
      }
    };
    return { el, refresh };
  }

  /** Six saved outfit slots: tap an empty one to save, a full one to wear it. */
  _slots() {
    const el = this._section('My outfits', 'heart');
    const noteEl = this.ui.el('div', 'sw-dsec-note', 'Tap an empty spot to save what you are wearing!');
    el.appendChild(noteEl);
    const grid = this.ui.el('div', 'sw-dgrid sw-dgrid--big');
    el.appendChild(grid);
    const slots = [];
    for (let i = 0; i < 6; i++) {
      const wrap = this.ui.el('div', 'sw-dslot');
      const b = this.ui.el('button', 'sw-dtile');
      b.type = 'button';
      const check = this.ui.el('span', 'sw-dcheck');
      check.innerHTML = icon('check');
      const pic = this.ui.el('span', 'sw-dpic');
      const c = document.createElement('canvas');
      c.width = c.height = THUMB;
      const wait = this.ui.el('span', 'sw-dwait');
      pic.append(c, wait);
      const label = this.ui.el('span', '', '');
      b.append(check, pic, label);
      const save = this.ui.el('button', 'sw-dslot-save');
      save.type = 'button';
      save.setAttribute('aria-label', `Save outfit ${i + 1} again`);
      save.title = 'Save here';
      save.innerHTML = icon('heart');
      save.addEventListener('click', (e) => {
        e.stopPropagation();
        this._saveSlot(i, true);
      });
      b.addEventListener('click', () => {
        const saved = this._outfits()[i];
        if (saved) this._wearSlot(i);
        else this._saveSlot(i, false);
      });
      wrap.append(b, save);
      grid.appendChild(wrap);
      slots.push({ b, c, pic, wait, label, save, key: null });
    }
    const refresh = () => {
      const outfits = this._outfits();
      slots.forEach((s, i) => {
        const saved = outfits[i];
        s.b.classList.toggle('sw-empty', !saved);
        s.save.hidden = !saved;
        s.label.textContent = saved ? `Outfit ${i + 1}` : 'Save here';
        s.b.setAttribute('aria-label', saved ? `Wear outfit ${i + 1}` : `Save outfit ${i + 1}`);
        const on = !!saved && sig({ ...W.normalizeLook(saved), name: this.look.name }) === sig(this.look);
        s.b.classList.toggle('sw-on', on);
        if (!saved) {
          s.key = null;
          s.pic.classList.remove('sw-ready');
          s.wait.innerHTML = icon('plus');
          s.c.getContext('2d').clearRect(0, 0, THUMB, THUMB);
          return;
        }
        s.wait.innerHTML = icon('sparkle');
        const look = W.normalizeLook(saved);
        const key = `outfits|slot|${sig(look)}`;
        if (key === s.key) return;
        s.key = key;
        s.pic.classList.remove('sw-ready');
        this.stage.snapshot(key, look, { frame: 'full', size: THUMB }).then((canvas) => {
          if (s.key !== key) return;
          if (!canvas) {
            s.key = null;
            return;
          }
          const g = s.c.getContext('2d');
          g.clearRect(0, 0, THUMB, THUMB);
          g.drawImage(canvas, 0, 0);
          s.pic.classList.add('sw-ready');
        });
      });
    };
    return { el, refresh };
  }

  _outfits() {
    const p = this.game.profile;
    if (!Array.isArray(p.outfits) || p.outfits.length !== 6) p.outfits = [null, null, null, null, null, null];
    return p.outfits;
  }

  async _saveSlot(i, replace) {
    const outfits = this._outfits();
    if (replace && outfits[i]) {
      const yes = await this.ui.confirm({ title: 'Save here?', text: 'This will replace the outfit in this spot.', yes: 'Yes, save', no: 'No, keep it', icon: 'heart' });
      if (!yes) return;
    }
    outfits[i] = W.cloneLook(this.look);
    this.game.saveProfile(true);
    this.game.audio.play('success');
    this.ui.toast('Outfit saved!', { icon: 'heart', color: 'pink' });
    if (this.preview) {
      this.preview.avatar.playEmote('heart');
      this.preview.sparkles.emit('heart', this.preview.v.set(0, 1.3, 0.3), { count: 10, spread: 0.8 });
    }
    this.refresh();
  }

  _wearSlot(i) {
    const saved = this._outfits()[i];
    if (!saved) return;
    this.change((d) => Object.assign(d, W.normalizeLook({ ...saved, name: d.name })), { kind: 'big', emote: 'dance', sound: 'chime' });
  }

  // ---------- 3D preview ----------

  _setupPreview() {
    const stage = this.stage;
    const canvas = stage.attach(this.view);
    if (!canvas) {
      if (!this.view.querySelector('.sw-dress-fallback')) this.view.appendChild(this.ui.el('div', 'sw-dress-fallback', 'Your outfit is saved! (3D preview is not available here.)'));
      return;
    }
    this.view.insertBefore(canvas, this.view.firstChild);
    const scene = stage.previewScene;
    const sparkles = new Sparkles(scene);
    const avatar = createAvatar(this.look, { fx: (kind, pos, o) => sparkles.emit(kind, pos, o) });
    scene.add(avatar.group);
    const table = buildTurntable();
    scene.add(table.group);
    const zoom = TABS.find((t) => t.key === this.tab).zoom;
    this.preview = {
      avatar, sparkles, table, spin: 0, spinVel: 0, spinTarget: null, idle: 0, t: 0, dragging: false,
      zoom, cy: ZOOMS[zoom].cy, span: ZOOMS[zoom].span, v: new THREE.Vector3(), ambient: 0,
    };
    stage.onPreviewFrame = (dt) => this._frame(dt);
  }

  _teardownPreview() {
    const p = this.preview;
    this.stage.onPreviewFrame = null;
    this.stage.detach();
    if (!p) return;
    p.avatar.dispose();
    p.sparkles.dispose();
    p.table.dispose();
    this.preview = null;
  }

  _frame(dt) {
    const p = this.preview;
    if (!p) return;
    p.t += dt;
    p.idle += dt;
    if (!p.dragging) {
      if (p.spinTarget !== null) {
        p.spin += (p.spinTarget - p.spin) * Math.min(1, dt * 5);
        if (Math.abs(p.spinTarget - p.spin) < 0.01) {
          p.spin = p.spinTarget;
          p.spinTarget = null;
          p.idle = 0;
        }
      } else {
        p.spin += p.spinVel * dt;
        p.spinVel *= Math.exp(-2.6 * dt);
        if (p.idle > 4 && Math.abs(p.spinVel) < 0.15) {
          // drift back to facing front (the nearest whole turn)
          const front = Math.round(p.spin / (Math.PI * 2)) * Math.PI * 2;
          p.spin += (front - p.spin) * Math.min(1, dt * 2);
        }
      }
    }
    const sway = p.idle > 4 ? Math.sin(p.t * 0.6) * 0.18 : 0;
    p.avatar.group.rotation.y = p.spin + sway;
    p.table.group.rotation.y = p.spin * 0.999;
    p.avatar.update(dt, IDLE);
    p.table.update(p.t);
    // camera eases between full body / upper body / face
    const z = ZOOMS[p.zoom] || ZOOMS.full;
    const k = Math.min(1, dt * 4);
    p.cy += (z.cy - p.cy) * k;
    p.span += (z.span - p.span) * k;
    const cam = this.stage.previewCamera;
    const tan = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
    const d = Math.max(p.span / 2 / tan, (p.span * 0.62) / 2 / tan / Math.max(0.3, cam.aspect));
    cam.position.set(0, p.cy + d * 0.1, d);
    cam.lookAt(0, p.cy, 0);
    // a little ambient twinkle
    p.ambient -= dt;
    if (p.ambient <= 0) {
      p.ambient = 0.7 + Math.random() * 0.8;
      p.sparkles.emit('sparkle', p.v.set((Math.random() - 0.5) * 1.4, 0.2 + Math.random() * 1.6, (Math.random() - 0.5) * 0.8), { count: 1, scale: 0.8 });
    }
    p.sparkles.update(dt, this.stage.pixelHeight, cam.fov);
  }

  _bindDrag(view) {
    let id = null, sx = 0, lx = 0, lt = 0, moved = 0, t0 = 0;
    view.addEventListener('pointerdown', (e) => {
      if (!this.preview) return;
      id = e.pointerId;
      sx = lx = e.clientX;
      lt = t0 = performance.now();
      moved = 0;
      this.preview.dragging = true;
      this.preview.spinTarget = null;
      this.preview.spinVel = 0;
      try { view.setPointerCapture(id); } catch { /* ignore */ }
    });
    view.addEventListener('pointermove', (e) => {
      const p = this.preview;
      if (!p || e.pointerId !== id) return;
      const dx = e.clientX - lx;
      const now = performance.now();
      lx = e.clientX;
      moved = Math.max(moved, Math.abs(e.clientX - sx));
      p.spin += dx * 0.012;
      const dt = Math.max(1, now - lt) / 1000;
      p.spinVel = p.spinVel * 0.5 + (dx * 0.012 / dt) * 0.5;
      lt = now;
      p.idle = 0;
      if (moved > 8) this.hint.classList.add('sw-gone');
    });
    const up = (e, cancelled = false) => {
      const p = this.preview;
      if (!p || e.pointerId !== id) return;
      id = null;
      p.dragging = false;
      p.idle = 0;
      if (performance.now() - lt > 80) p.spinVel = 0;
      if (!cancelled && moved < 8 && performance.now() - t0 < 500) {
        // a tap: a happy little reaction
        const list = ['wave', 'heart', 'dance', 'twirl', 'jump'];
        p.avatar.playEmote(list[Math.floor(Math.random() * list.length)]);
        this.game.audio.play('sparkle');
      }
    };
    view.addEventListener('pointerup', (e) => up(e));
    view.addEventListener('pointercancel', (e) => up(e, true));
    view.addEventListener('lostpointercapture', (e) => up(e, true)); // never stuck by a swallowed release
  }
}

// ---------- look helpers ----------

function withAcc(look, slot, colorKey, key) {
  const l = W.normalizeLook(look);
  const was = l.acc[slot];
  l.acc[slot] = key;
  const hints = COLOR_HINTS[slot];
  if (hints && key !== was && hints[key]) l.acc[colorKey] = hints[key];
  return l;
}

function withDress(look, key) {
  const l = W.normalizeLook(look);
  if (key === 'none') {
    l.dress = null;
    return l;
  }
  const base = l.dress || { color: l.top.color, pattern: l.top.pattern, patternColor: l.top.patternColor };
  l.dress = { ...base, type: key };
  return l;
}

// ---------- turntable ----------

function buildTurntable() {
  const group = new THREE.Group();
  const b = new GeoBuilder([0, 0, 0]);
  b.cyl(0, -0.16, 0, 0.86, 0.14, '#FFB6D9', 28);
  b.cyl(0, -0.03, 0, 0.8, 0.03, '#FFF3FA', 28);
  b.cyl(0, -0.19, 0, 0.9, 0.04, '#E6DDFF', 28);
  const glow = new GeoBuilder([0, 0, 0]);
  const cols = ['#FFE27A', '#FF8CC6', '#7FD3FF', '#C9A2FF'];
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    glow.save().translate(Math.sin(a) * 0.865, -0.09, Math.cos(a) * 0.865).rotate(0, a, Math.PI / 4);
    glow.cube(0, 0, 0, 0.05, 0.05, 0.02, cols[i % 4]);
    glow.restore();
  }
  const m1 = new THREE.MeshLambertMaterial({ vertexColors: true });
  const m2 = new THREE.MeshBasicMaterial({ vertexColors: true });
  const g1 = b.build(), g2 = glow.build();
  group.add(new THREE.Mesh(g1, m1), new THREE.Mesh(g2, m2));
  // soft shadow under her feet
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const grd = ctx.createRadialGradient(32, 32, 2, 32, 32, 31);
  grd.addColorStop(0, 'rgba(90,50,140,0.35)');
  grd.addColorStop(1, 'rgba(90,50,140,0)');
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sm = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false });
  const sg = new THREE.PlaneGeometry(1.1, 0.8);
  const shadow = new THREE.Mesh(sg, sm);
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.003;
  group.add(shadow);
  return {
    group,
    update(t) {
      m2.color.setScalar(0.85 + 0.15 * Math.sin(t * 3));
    },
    dispose() {
      if (group.parent) group.parent.remove(group);
      g1.dispose(); g2.dispose(); sg.dispose();
      m1.dispose(); m2.dispose(); sm.dispose(); tex.dispose();
    },
  };
}
