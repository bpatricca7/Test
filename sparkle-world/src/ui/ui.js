// game.ui: the DOM overlay. Layers (bottom to top): hud, panels, hint, toasts, fader,
// loading, dialogs. One modal panel at a time; opening one sets game.paused.

import { icon } from './icons.js';
import { confirmDialog, textInputDialog } from './dialogs.js';

const TOAST_MS = 2600;
const MAX_TOASTS = 3;

export class UI {
  constructor(game) {
    this.game = game;
    this.root = this.el('div', 'sw-ui');
    game.container.appendChild(this.root);
    this.hudLayer = this.el('div', 'sw-layer sw-layer-hud');
    this.panelLayer = this.el('div', 'sw-layer sw-layer-panels');
    this.hintEl = this.el('div', 'sw-hint');
    this.hintEl.hidden = true;
    this.toastLayer = this.el('div', 'sw-toasts');
    this.fader = this.el('div', 'sw-fader');
    this.loadingEl = this._buildLoading();
    this.dialogLayer = this.el('div', 'sw-layer sw-layer-dialogs');
    this.root.append(this.hudLayer, this.panelLayer, this.hintEl, this.toastLayer, this.fader, this.loadingEl, this.dialogLayer);
    this.panels = new Map();
    this.current = null;
    this.dialogOpen = false;
    this._toastQueue = [];
    this._toastCount = 0;
    this._hintText = null;
    this._hintX = this._hintY = null;
    this._hintW = 0;
  }

  /** Create an element with optional class and text. */
  el(tag, className = '', text) {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }

  icon(name, opts) {
    return icon(name, opts);
  }

  /** Inject a <style> block; returns the element. */
  addStyles(css) {
    const s = document.createElement('style');
    s.textContent = css;
    document.head.appendChild(s);
    return s;
  }

  /**
   * Consistent chunky button. variant: pink | lav | mint | sky | sun | white.
   * size: 'big' | 'small' | 'icon'. Plays a click and bounces on press.
   */
  button({ icon: ic = null, label = '', onClick = null, variant = 'pink', size = null, title = null, className = '' } = {}) {
    const b = this.el('button', `sw-btn sw-btn--${variant}${size ? ' sw-btn--' + size : ''}${className ? ' ' + className : ''}`);
    b.type = 'button';
    if (ic) b.innerHTML = icon(ic);
    if (label) b.appendChild(this.el('span', 'sw-btn-label', label));
    if (title || label) b.setAttribute('aria-label', title || label);
    if (title) b.title = title;
    b.addEventListener('click', (e) => {
      this.game.audio.play('click');
      if (onClick) onClick(e);
    });
    return b;
  }

  // ---------- toasts & hint ----------

  /** Bouncy message at the top. opts: { icon, color: 'pink'|'sun'|..., big, duration } */
  toast(text, opts = {}) {
    this._toastQueue.push({ text, opts });
    this._pumpToasts();
  }

  _pumpToasts() {
    while (this._toastQueue.length && this._toastCount < MAX_TOASTS) {
      const { text, opts } = this._toastQueue.shift();
      const t = this.el('div', 'sw-toast' + (opts.big ? ' sw-toast--big' : ''));
      if (opts.color) t.style.borderColor = `var(--sw-${opts.color})`;
      t.innerHTML = icon(opts.icon || (opts.big ? 'star' : 'sparkle'));
      t.appendChild(this.el('span', '', text));
      this.toastLayer.appendChild(t);
      this._toastCount++;
      const life = opts.duration || (opts.big ? TOAST_MS + 900 : TOAST_MS);
      setTimeout(() => {
        t.classList.add('sw-leave');
        setTimeout(() => {
          t.remove();
          this._toastCount--;
          this._pumpToasts();
        }, 300);
      }, life);
    }
  }

  /**
   * Context bubble ("Tap to sleep") just below `at` ({ x, y } CSS px in the game area, e.g.
   * the projected target point), or below the screen centre when `at` is null. null hides it.
   */
  hint(text, at = null) {
    const el = this.hintEl;
    if (text !== this._hintText) {
      this._hintText = text;
      if (!text) {
        el.hidden = true;
        return;
      }
      el.textContent = text;
      el.hidden = false;
      this._hintW = el.offsetWidth;
      // restart the pop animation
      el.style.animation = 'none';
      void el.offsetWidth;
      el.style.animation = '';
    }
    if (!text) return;
    if (!at) {
      if (this._hintX !== null) {
        el.style.left = el.style.top = '';
        this._hintX = this._hintY = null;
      }
      return;
    }
    const w = this.root.clientWidth, h = this.root.clientHeight;
    const half = (this._hintW || 160) / 2 + 10;
    const x = Math.round(Math.min(Math.max(at.x, half), w - half));
    const y = Math.round(Math.min(Math.max(at.y + 30, 70), h - 160));
    if (x === this._hintX && y === this._hintY) return;
    this._hintX = x;
    this._hintY = y;
    el.style.left = x + 'px';
    el.style.top = y + 'px';
  }

  // ---------- panels ----------

  /**
   * def = { build(container, game), onOpen?(args), onClose?(), fullscreen?, title?, icon?,
   *         closable? (default true), back?(game) -> panel name to return to, width? }
   */
  registerPanel(name, def) {
    const wrap = this.el('div', 'sw-panel-wrap');
    wrap.dataset.panel = name;
    let container;
    if (def.fullscreen) {
      container = this.el('div', 'sw-full');
      wrap.appendChild(container);
    } else {
      const backdrop = this.el('div', 'sw-backdrop');
      backdrop.addEventListener('pointerdown', () => { if (def.closable !== false) this.back(); });
      const card = this.el('div', 'sw-card');
      if (def.width) card.style.width = `min(${def.width}px, 100%)`;
      const head = this.el('div', 'sw-card-head');
      const title = this.el('h2', 'sw-card-title');
      if (def.icon) title.innerHTML = icon(def.icon);
      title.appendChild(this.el('span', '', def.title || name));
      head.appendChild(title);
      if (def.closable !== false) {
        const close = this.button({ icon: 'close', variant: 'white', className: 'sw-close', title: 'Close', onClick: () => this.back() });
        head.appendChild(close);
      }
      container = this.el('div', 'sw-card-body');
      card.append(head, container);
      wrap.append(backdrop, card);
      def._titleEl = title.lastChild;
    }
    this.panelLayer.appendChild(wrap);
    this.panels.set(name, { def, wrap, container, built: false });
  }

  hasPanel(name) {
    return this.panels.has(name);
  }

  isOpen(name) {
    return this.current === name;
  }

  /** Change a (non-fullscreen) panel's title text. */
  setTitle(name, text) {
    const p = this.panels.get(name);
    if (p && p.def._titleEl) p.def._titleEl.textContent = text;
  }

  open(name, args) {
    const p = this.panels.get(name);
    if (!p) {
      console.warn(`[ui] no panel "${name}"`);
      return false;
    }
    if (this.current && this.current !== name) this._hide(this.current);
    if (!p.built) {
      p.def.build(p.container, this.game);
      p.built = true;
    }
    p.wrap.classList.add('sw-open');
    const card = p.wrap.querySelector('.sw-card, .sw-full');
    if (card) { card.style.animation = 'none'; void card.offsetWidth; card.style.animation = ''; }
    const reopened = this.current === name;
    this.current = name;
    this.game.paused = true;
    this.hint(null);
    if (p.def.onOpen) p.def.onOpen(args);
    if (!reopened) {
      if (!p.def.fullscreen) this.game.audio.play('page');
      this.game.events.emit('ui:open', { panel: name });
    }
    return true;
  }

  _hide(name) {
    const p = this.panels.get(name);
    if (!p) return;
    p.wrap.classList.remove('sw-open');
    if (p.def.onClose) p.def.onClose();
    this.game.events.emit('ui:close', { panel: name });
  }

  /** Close the open panel. */
  close() {
    if (!this.current) return;
    const name = this.current;
    this.current = null;
    this._hide(name);
    this.game.paused = false;
  }

  closeAll() {
    this.close();
  }

  /** Close button / Esc: go to the panel's `back` target, or just close. */
  back() {
    if (!this.current) return;
    const p = this.panels.get(this.current);
    if (p.def.closable === false) return;
    const target = p.def.back ? p.def.back(this.game) : null;
    if (target && this.panels.has(target)) this.open(target);
    else this.close();
  }

  toggle(name) {
    if (this.current === name) this.back();
    else this.open(name);
  }

  // ---------- dialogs ----------

  confirm(opts) {
    return confirmDialog(this, opts);
  }

  textInput(opts) {
    return textInputDialog(this, opts);
  }

  // ---------- loading & transitions ----------

  _buildLoading() {
    const l = this.el('div', 'sw-loading');
    const cubes = this.el('div', 'sw-loading-cubes');
    for (let i = 0; i < 5; i++) cubes.appendChild(this.el('span'));
    this._loadingText = this.el('div', 'sw-loading-text', 'Loading…');
    const bar = this.el('div', 'sw-loading-bar');
    this._loadingFill = this.el('div', 'sw-loading-fill');
    bar.appendChild(this._loadingFill);
    l.append(cubes, this._loadingText, bar);
    return l;
  }

  /** Full-screen loading card. text null (with no progress) hides it; undefined keeps text. */
  loading(text, progress) {
    if (text === null && progress === undefined) {
      this.loadingEl.classList.remove('sw-open');
      return;
    }
    this.loadingEl.classList.add('sw-open');
    if (typeof text === 'string') this._loadingText.textContent = text;
    if (typeof progress === 'number') this._loadingFill.style.width = `${Math.round(Math.max(0, Math.min(1, progress)) * 100)}%`;
  }

  /**
   * Fade to a dreamy night screen, run mid() at the darkest moment, fade back.
   * opts: { text, stars, hold (ms) }. Resolves when faded back in.
   */
  transition({ text = '', stars = false, hold = 1200 } = {}, mid = null) {
    const f = this.fader;
    f.innerHTML = '';
    if (stars) {
      for (let i = 0; i < 40; i++) {
        const s = this.el('div', 'sw-star');
        s.style.left = `${Math.random() * 100}%`;
        s.style.top = `${Math.random() * 100}%`;
        s.style.animationDelay = `${Math.random() * 1.6}s`;
        f.appendChild(s);
      }
    }
    if (text) f.appendChild(this.el('div', 'sw-fader-text', text));
    return new Promise((resolve) => {
      requestAnimationFrame(() => f.classList.add('sw-on'));
      setTimeout(() => {
        try { if (mid) mid(); } catch (err) { console.error('[ui] transition step failed', err); }
        setTimeout(() => {
          f.classList.remove('sw-on');
          setTimeout(resolve, 800);
        }, hold);
      }, 850);
    });
  }
}

export function install(game) {
  game.ui = new UI(game);
}
