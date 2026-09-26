// Unified input: keyboard, mouse and touch. Gameplay code reads the per-frame state
// (move, look, zoom, turn, jump, down, run, pointer) and listens for 'tap', 'hold', 'key',
// 'gesture' and 'touchmode' events. No pointer lock: drag to look, click/tap to act.

import { Emitter } from './events.js';

const DRAG_THRESHOLD = 6; // px before a press becomes a look-drag
const HOLD_MS = 420; // press-and-hold (without moving) starts a hold
const TAP_MAX_MS = 600;
const JOY_RADIUS = 52;
const JOY_TAP_MS = 280; // a touch in the joystick zone this quick and still acts as a tap...
const JOY_TAP_SLOP = 10; // ...if it moved less than this many px
const JOY_BASE_MARGIN = 36; // ...and did not start on the joystick itself (base radius + this)

export class Input {
  /**
   * @param {HTMLElement} element the canvas (pointer events)
   * @param {HTMLElement} overlay where the touch joystick is drawn
   */
  constructor(element, overlay) {
    this.el = element;
    this.overlay = overlay;
    this.events = new Emitter();
    this.enabled = true;

    // per-frame state
    this.move = { x: 0, z: 0 }; // x: +1 right, z: +1 forward
    this.look = { dx: 0, dy: 0 }; // pixels dragged this frame
    this.zoom = 0; // + zooms out (wheel/pinch), consumed per frame
    this.turn = 0; // -1..1 from arrow keys (camera yaw)
    this.jump = false;
    this.down = false;
    this.run = false;
    this.pointer = null; // {x, y} NDC of last tap/cursor, null = screen centre

    this.keys = new Set();
    this.virtual = { jump: false, down: false, run: false };
    // a HUD press shorter than one frame still counts for the next frame
    this._latch = { jump: false, down: false, run: false };
    this.pointers = new Map();
    this.joy = { active: false, id: -1, cx: 0, cy: 0, x: 0, z: 0 };
    this.touchMode = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
    this._pinchDist = 0;

    this._buildJoystick();
    this._bind();
  }

  on(name, fn) {
    return this.events.on(name, fn);
  }

  /** Virtual buttons from the touch HUD: 'jump' | 'down' | 'run'. */
  press(name, isDown) {
    if (!(name in this.virtual)) return;
    this.virtual[name] = !!isDown;
    if (isDown) this._latch[name] = true;
  }

  /** Normalized device coords of a client point on the canvas. */
  toNDC(clientX, clientY) {
    const r = this.el.getBoundingClientRect();
    return {
      x: ((clientX - r.left) / Math.max(1, r.width)) * 2 - 1,
      y: -(((clientY - r.top) / Math.max(1, r.height)) * 2 - 1),
    };
  }

  /** Recompute held-state each frame (called by the game loop before the player). */
  update() {
    const k = this.keys;
    let x = 0, z = 0, turn = 0;
    if (k.has('KeyW') || k.has('ArrowUp')) z += 1;
    if (k.has('KeyS') || k.has('ArrowDown')) z -= 1;
    if (k.has('KeyA')) x -= 1;
    if (k.has('KeyD')) x += 1;
    if (k.has('ArrowLeft')) turn -= 1;
    if (k.has('ArrowRight')) turn += 1;
    if (x && z) { x *= Math.SQRT1_2; z *= Math.SQRT1_2; }
    let joyRun = false;
    if (this.joy.active) {
      x = this.joy.x;
      z = this.joy.z;
      joyRun = Math.hypot(x, z) > 0.92;
    }
    const on = this.enabled;
    const shift = k.has('ShiftLeft') || k.has('ShiftRight');
    const v = this.virtual, latch = this._latch;
    this.move.x = on ? x : 0;
    this.move.z = on ? z : 0;
    this.turn = on ? turn : 0;
    this.jump = on && (k.has('Space') || v.jump || latch.jump);
    this.down = on && (shift || k.has('KeyC') || v.down || latch.down);
    this.run = on && (shift || joyRun || v.run || latch.run);
    latch.jump = latch.down = latch.run = false;
    if (!on) {
      this.look.dx = 0;
      this.look.dy = 0;
    }
  }

  /** Clear the per-frame accumulators (after the camera consumed them). */
  endFrame() {
    this.look.dx = 0;
    this.look.dy = 0;
    this.zoom = 0;
  }

  _setTouchMode(on) {
    if (this.touchMode === on) return;
    this.touchMode = on;
    this.joyBase.style.display = on ? 'block' : 'none';
    this.events.emit('touchmode', { touch: on });
  }

  // ---------- DOM ----------

  _buildJoystick() {
    const base = document.createElement('div');
    base.className = 'sw-joy';
    const thumb = document.createElement('div');
    thumb.className = 'sw-joy-thumb';
    base.appendChild(thumb);
    this.overlay.appendChild(base);
    this.joyBase = base;
    this.joyThumb = thumb;
    base.style.display = this.touchMode ? 'block' : 'none';
    this._placeJoystick(null, null);
  }

  /** Put the joystick at the finger (or back at its resting spot when x is null). */
  _placeJoystick(x, y) {
    const b = this.joyBase;
    if (x === null) {
      b.classList.remove('active');
      b.style.left = '';
      b.style.top = '';
      this.joyThumb.style.transform = 'translate(-50%, -50%)';
    } else {
      const r = this.overlay.getBoundingClientRect();
      b.classList.add('active');
      b.style.left = x - r.left + 'px';
      b.style.top = y - r.top + 'px';
    }
  }

  _bind() {
    const el = this.el;
    el.style.touchAction = 'none';
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('pointerdown', (e) => this._down(e));
    window.addEventListener('pointermove', (e) => this._move(e), { passive: true });
    window.addEventListener('pointerup', (e) => this._up(e, false));
    window.addEventListener('pointercancel', (e) => this._up(e, true));
    el.addEventListener('pointerleave', (e) => {
      if (e.pointerType === 'mouse' && this.pointers.size === 0) this.pointer = null;
    });
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.zoom += Math.sign(e.deltaY) * Math.min(3, Math.abs(e.deltaY) / 60);
    }, { passive: false });

    const isTyping = (e) => {
      const t = e.target;
      return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
    };
    window.addEventListener('keydown', (e) => {
      this.events.emit('gesture', {});
      if (isTyping(e)) return;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
      this.keys.add(e.code);
      this.events.emit('key', { code: e.code, key: e.key, down: true, repeat: e.repeat, ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey });
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      if (isTyping(e)) return;
      this.events.emit('key', { code: e.code, key: e.key, down: false, repeat: false, ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey });
    });
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.virtual.jump = this.virtual.down = this.virtual.run = false;
      this._latch.jump = this._latch.down = this._latch.run = false;
    });
    window.addEventListener('pointerdown', () => this.events.emit('gesture', {}), true);
  }

  _down(e) {
    const touch = e.pointerType === 'touch' || e.pointerType === 'pen';
    this._setTouchMode(touch);
    try { this.el.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
    const r = this.el.getBoundingClientRect();
    let role = 'mouse';
    if (touch) {
      role = !this.joy.active && e.clientX - r.left < r.width * 0.4 ? 'joystick' : 'look';
    }
    const p = {
      id: e.pointerId, type: e.pointerType, role, button: e.button,
      sx: e.clientX, sy: e.clientY, x: e.clientX, y: e.clientY,
      t0: performance.now(), moved: false, hold: false, holdTimer: 0,
      hx: 0, hy: 0, holdDragged: false, onJoystick: false,
    };
    this.pointers.set(e.pointerId, p);
    if (role === 'joystick') {
      // touches that start on the resting joystick are always steering, never taps
      const b = this.joyBase.getBoundingClientRect();
      if (b.width > 0) {
        const r0 = b.width / 2 + JOY_BASE_MARGIN;
        p.onJoystick = Math.hypot(e.clientX - (b.left + b.width / 2), e.clientY - (b.top + b.height / 2)) <= r0;
      }
      this.joy.active = true;
      this.joy.id = e.pointerId;
      this.joy.cx = e.clientX;
      this.joy.cy = e.clientY;
      this.joy.x = this.joy.z = 0;
      this._placeJoystick(e.clientX, e.clientY);
      return;
    }
    if (this._lookPointers().length === 2) {
      const [a, b] = this._lookPointers();
      this._pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
      for (const q of this._lookPointers()) { q.moved = true; clearTimeout(q.holdTimer); }
      return;
    }
    if (e.button === 0) {
      p.holdTimer = setTimeout(() => {
        if (p.moved || !this.pointers.has(p.id)) return;
        p.hold = true;
        p.hx = p.x;
        p.hy = p.y;
        this.pointer = this.toNDC(p.x, p.y);
        this.events.emit('hold', { phase: 'start', ...this.pointer, pointerType: p.type });
      }, HOLD_MS);
    }
  }

  _lookPointers() {
    const out = [];
    for (const p of this.pointers.values()) if (p.role === 'look') out.push(p);
    return out;
  }

  _move(e) {
    const p = this.pointers.get(e.pointerId);
    if (!p) {
      // hovering mouse: aim where the cursor is
      if (e.pointerType === 'mouse' && e.target === this.el) {
        if (Math.abs(e.movementX) + Math.abs(e.movementY) > 0) this._setTouchMode(false);
        this.pointer = this.toNDC(e.clientX, e.clientY);
      }
      return;
    }
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    if (p.role === 'joystick') {
      let jx = e.clientX - this.joy.cx, jy = e.clientY - this.joy.cy;
      const len = Math.hypot(jx, jy);
      if (len > JOY_RADIUS) { jx *= JOY_RADIUS / len; jy *= JOY_RADIUS / len; }
      this.joy.x = jx / JOY_RADIUS;
      this.joy.z = -jy / JOY_RADIUS;
      this.joyThumb.style.transform = `translate(calc(-50% + ${jx}px), calc(-50% + ${jy}px))`;
      return;
    }
    const looks = this._lookPointers();
    if (p.role === 'look' && looks.length >= 2) {
      const [a, b] = looks;
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (this._pinchDist > 0) this.zoom += (this._pinchDist - d) / 40;
      this._pinchDist = d;
      return;
    }
    if (!p.moved && Math.hypot(p.x - p.sx, p.y - p.sy) > DRAG_THRESHOLD && !p.hold) {
      p.moved = true;
      clearTimeout(p.holdTimer);
    }
    if (p.hold) {
      if (!p.holdDragged && Math.hypot(p.x - p.hx, p.y - p.hy) > DRAG_THRESHOLD) p.holdDragged = true;
      this.pointer = this.toNDC(p.x, p.y);
      this.events.emit('hold', { phase: 'move', ...this.pointer, pointerType: p.type });
    } else if (p.moved && this.enabled) {
      this.look.dx += dx;
      this.look.dy += dy;
    }
    if (p.type === 'mouse') this.pointer = this.toNDC(e.clientX, e.clientY);
  }

  _up(e, cancelled) {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    this.pointers.delete(e.pointerId);
    clearTimeout(p.holdTimer);
    if (p.role === 'joystick') {
      this.joy.active = false;
      this.joy.x = this.joy.z = 0;
      this._placeJoystick(null, null);
      // a quick, still touch in the joystick zone (but not on the joystick) acts at that point
      const quick = performance.now() - p.t0 < JOY_TAP_MS && Math.hypot(p.x - p.sx, p.y - p.sy) < JOY_TAP_SLOP;
      if (!cancelled && quick && !p.onJoystick) {
        this.pointer = this.toNDC(p.x, p.y);
        this.events.emit('tap', { ...this.pointer, button: 0, pointerType: p.type });
      }
      return;
    }
    if (this._lookPointers().length < 2) this._pinchDist = 0;
    if (p.hold) {
      // dragged: false means a slow, still press; the game treats that like a tap
      this.events.emit('hold', { phase: 'end', ...this.toNDC(p.x, p.y), pointerType: p.type, dragged: p.holdDragged, cancelled });
      return;
    }
    if (cancelled || p.moved) return;
    if (performance.now() - p.t0 > TAP_MAX_MS) return;
    this.pointer = this.toNDC(p.x, p.y);
    this.events.emit('tap', { ...this.pointer, button: p.button, pointerType: p.type });
  }
}
