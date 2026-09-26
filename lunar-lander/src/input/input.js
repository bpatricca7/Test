// Pilot input: keyboard + Gamepad API -> the active vessel's hand controllers and throttle lever,
// plus discrete crew commands as 'action' events (ARCHITECTURE.md §5).
//
// Contract: createInput(game, el) -> { update(realDt) }
//
// Every frame update() writes game.active.ctrl:
//   pitch / yaw / roll, transFwd / transRight / transUp   -1..1, keyboard axes ramp to full in
//                                                         0.12 s (proportional feel), gamepad sticks
//                                                         with deadzone + expo; the sum is clamped
//   fine                                                  Caps Lock / L3 toggles it
//   throttle                                              PERSISTENT lever: only moved by the throttle
//                                                         keys / triggers (GNC sets it on entering P67,
//                                                         the sim sets 1 on ABORT STAGE)
// The sim zeroes the inactive vessel's ctrl, so only the active one is written here.
//
// While the title menu is up (game.started false), a UI overlay captures the keyboard
// (game.uiCapture === true) or a text field has focus, game keys are ignored and not
// preventDefault-ed — except Esc (MENU) and F1/? (HELP) during an overlay, so the same key closes it.
// Ctrl/Meta/Alt combinations are always left to the browser.
//
// Also written: game.view.lookInput {x, y} (-1..1) — arrow-key camera look outside P64, read by
// render/cameras.js.
//
// Bindings: src/input/bindings.js (BINDINGS is the help-screen table).

import {
  AXIS_KEYS,
  THROTTLE_KEYS,
  LPD_KEYS,
  AUTOPILOT_KEYS,
  ACTION_KEYS,
  SHIFT_ACTION_KEYS,
  PASSTHROUGH_ACTIONS,
  STAGE_CONFIRM_TIME,
  GAME_CODES,
  GAMEPAD,
} from './bindings.js';
import { rampAxis, mix, clamp, repeatClicks, THROTTLE_RATE, THROTTLE_RATE_FINE } from './axes.js';
import { createGamepadReader } from './gamepad.js';

const AXES = ['pitch', 'yaw', 'roll', 'transFwd', 'transRight', 'transUp'];
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;

/** True if the element is a text-entry control (keys belong to it). */
function isTextField(t) {
  if (!t || t === document.body) return false;
  if (t.isContentEditable) return true;
  const tag = t.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') {
    const type = (t.type || 'text').toLowerCase();
    return !['button', 'checkbox', 'radio', 'range', 'submit', 'reset', 'color', 'image'].includes(type);
  }
  return false;
}

export function createInput(game, el) {
  const held = new Set(); // KeyboardEvent.code values currently down (game keys only)
  const tapped = new Set(); // pressed since the last update(): a tap shorter than a frame still counts
  let shiftHeld = false;
  const kb = { pitch: 0, yaw: 0, roll: 0, transFwd: 0, transRight: 0, transUp: 0 }; // ramped key axes
  let fine = false;
  let capsDownAt = -1e9;
  let stageArmedUntil = -1e9;
  const rodUp = { held: false, t: 0 };
  const rodDown = { held: false, t: 0 };
  const gpPrev = new Array(17).fill(false);
  const pad = createGamepadReader();
  const look = { x: 0, y: 0 };
  game.view.lookInput = look;

  const emit = (name, extra) => game.events.emit('action', extra ? { name, ...extra } : { name });
  const message = (text, level = 'info', duration) => game.events.emit('message', duration ? { text, level, duration } : { text, level });

  function playing() {
    return !!game.started && game.uiCapture !== true;
  }

  function releaseAll() {
    held.clear();
    tapped.clear();
    shiftHeld = false;
    for (const a of AXES) kb[a] = 0;
    look.x = look.y = 0;
  }

  function setFine(on, announce = true) {
    on = !!on;
    if (on === fine) return;
    fine = on;
    if (announce) message(fine ? 'Fine control ON — reduced rates' : 'Fine control OFF', 'info', 1.5);
  }

  /** P66 with the automatic throttle: the throttle keys become the rate-of-descent switch. */
  function rodMode(v) {
    return v && v.type === 'LM' && v.gnc?.program === 'P66' && v.gnc?.throttleMode === 'AUTO';
  }
  function lpdMode(v) {
    return v && v.type === 'LM' && v.gnc?.program === 'P64';
  }

  function stagePress() {
    const v = game.vessels.LM;
    if (!v || game.active !== v) {
      message('ABORT STAGE is a Lunar Module control — switch to Eagle (V)', 'warn', 2.5);
      return;
    }
    if (v.staged) {
      message('Ascent stage already separated', 'info', 2);
      return;
    }
    const t = now();
    if (t < stageArmedUntil) {
      stageArmedUntil = -1e9;
      emit('STAGE');
    } else {
      stageArmedUntil = t + STAGE_CONFIRM_TIME;
      message('ABORT STAGE armed — press Backspace again to fire the separation pyros', 'warn', STAGE_CONFIRM_TIME);
    }
  }

  function engineStop() {
    const v = game.active;
    if (v) v.ctrl.throttle = 0;
    emit('ENGINE_STOP');
  }

  /** Resolve a key press into a discrete action name, or null. */
  function actionFor(e) {
    if (e.key === '?' || e.code === 'F1') return 'HELP';
    if (e.shiftKey && SHIFT_ACTION_KEYS[e.code]) return SHIFT_ACTION_KEYS[e.code];
    return ACTION_KEYS[e.code] || null;
  }

  /** A clicked UI button keeps focus: Space/Enter would press it again. Hand focus to the canvas. */
  function reclaimFocus() {
    const a = document.activeElement;
    if (a && a !== el && a !== document.body && !isTextField(a) && typeof a.blur === 'function') {
      a.blur();
      try {
        el?.focus?.({ preventScroll: true });
      } catch {
        /* ignore */
      }
    }
  }

  function onKeyDown(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return; // browser shortcuts
    if (isTextField(e.target) || isTextField(document.activeElement)) return;
    // a focused slider (volume, sensitivity...) keeps its arrow / Home / End keys
    const ae = document.activeElement;
    if (ae && ae.tagName === 'INPUT' && ae.type === 'range' && /^(Arrow|Home|End|Page)/.test(e.code)) return;
    shiftHeld = e.shiftKey;
    const code = e.code;
    const name = actionFor(e);
    if (!game.started) return; // title menu: the UI owns the keyboard
    if (game.uiCapture === true) {
      if (name && PASSTHROUGH_ACTIONS.has(name)) {
        e.preventDefault();
        if (!e.repeat) emit(name);
      }
      return;
    }
    if (!GAME_CODES.has(code) && name !== 'HELP') return;
    e.preventDefault();
    reclaimFocus();
    held.add(code);
    tapped.add(code);
    if (e.repeat) return; // axes read the held set; discrete commands fire once per press

    const v = game.active;
    if (code === 'CapsLock') {
      // Caps Lock state is the fine-mode state where the browser reports it; otherwise toggle
      // (headless / platforms that report the old state on keydown).
      const s = typeof e.getModifierState === 'function' ? e.getModifierState('CapsLock') : undefined;
      capsDownAt = now();
      setFine(s !== undefined && s !== fine ? s : !fine);
      return;
    }
    if (code === 'Backspace') return stagePress();
    if (code === THROTTLE_KEYS.cut) return engineStop();
    if ((code === THROTTLE_KEYS.up || code === THROTTLE_KEYS.down) && rodMode(v)) {
      // rate-of-descent switch: one click right away, update() repeats it while held
      const st = code === THROTTLE_KEYS.up ? rodUp : rodDown;
      st.held = true;
      st.t = -0.35;
      emit(code === THROTTLE_KEYS.up ? 'ROD_UP' : 'ROD_DOWN');
      return;
    }
    if (code === THROTTLE_KEYS.full) {
      if (v) v.ctrl.throttle = 1;
      return;
    }
    if (LPD_KEYS[code]) {
      if (lpdMode(v)) {
        tapped.delete(code); // consumed as a click, not a camera-look tap
        emit('LPD', { ...LPD_KEYS[code] });
      }
      return;
    }
    if (AUTOPILOT_KEYS[code]) return emit('AUTOPILOT', { mode: AUTOPILOT_KEYS[code] });
    if (name) emit(name);
  }

  function onKeyUp(e) {
    shiftHeld = e.shiftKey;
    if (e.code === 'CapsLock' && held.has('CapsLock')) {
      // macOS reports Caps Lock "off" as a lone keyup: sync if this was not the end of our keydown
      const s = typeof e.getModifierState === 'function' ? e.getModifierState('CapsLock') : undefined;
      if (s === false && fine && now() - capsDownAt > 0.4) setFine(false);
    }
    if (held.has(e.code)) {
      held.delete(e.code);
      if (e.code === 'Space' || e.code === 'Enter') e.preventDefault(); // no button "click" on keyup
    }
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', releaseAll);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) releaseAll();
    });
    window.addEventListener('gamepadconnected', (e) => {
      const id = e.gamepad?.id || 'controller';
      message(`Controller connected: ${id.replace(/\s*\(.*\)\s*$/, '')}`, 'info', 3);
    });
    window.addEventListener('gamepaddisconnected', () => message('Controller disconnected', 'warn', 3));
  }

  game.events.on('vessel', () => {
    for (const a of AXES) kb[a] = 0;
  });
  game.events.on('scenario', () => {
    for (const a of AXES) kb[a] = 0;
    stageArmedUntil = -1e9;
    setFine(false, false);
  });

  const h = (code) => (held.has(code) || tapped.has(code) ? 1 : 0);

  return {
    /** Current fine-control state (for UI). */
    get fine() {
      return fine;
    },
    update(dt) {
      const v = game.active;
      if (!v) return;
      const c = v.ctrl;
      const live = playing();
      if (!live && held.size) releaseAll();

      // ---- keyboard axes: target from the held keys, then ramp
      const target = { pitch: 0, yaw: 0, roll: 0, transFwd: 0, transRight: 0, transUp: 0 };
      for (const code of new Set([...held, ...tapped])) {
        const m = AXIS_KEYS[code];
        if (m) target[m[0]] += m[1];
      }
      const inv = game.settings.invertPitch ? -1 : 1;
      target.pitch *= inv;
      for (const a of AXES) kb[a] = rampAxis(kb[a], clamp(target[a], -1, 1), dt);

      // ---- gamepad
      const gp = live ? pad.poll() : null;
      const B = GAMEPAD.buttons;
      const pressed = (i) => !!gp && gp.buttons[i];
      const edge = (i) => pressed(i) && !gpPrev[i];
      const gpTrans = { fwd: 0, right: 0 };
      if (gp) {
        for (const [i, name] of Object.entries(GAMEPAD.actions)) if (edge(+i)) emit(name);
        if (edge(B.L3)) setFine(!fine);
        const dpad = { UP: [0, 1], DOWN: [0, -1], LEFT: [-1, 0], RIGHT: [1, 0] };
        if (lpdMode(v)) {
          for (const [k, [dx, dy]] of Object.entries(dpad)) if (edge(B[k])) emit('LPD', { dx, dy });
        } else {
          gpTrans.fwd = (pressed(B.UP) ? 1 : 0) - (pressed(B.DOWN) ? 1 : 0);
          gpTrans.right = (pressed(B.RIGHT) ? 1 : 0) - (pressed(B.LEFT) ? 1 : 0);
        }
        gpTrans.right += (pressed(B.RB) ? 1 : 0) - (pressed(B.LB) ? 1 : 0);
      }
      for (let i = 0; i < gpPrev.length; i++) gpPrev[i] = pressed(i);

      c.pitch = mix(kb.pitch, gp ? gp.pitch * inv : 0);
      c.yaw = mix(kb.yaw, gp?.yaw);
      c.roll = mix(kb.roll, gp?.roll);
      c.transFwd = mix(kb.transFwd, gpTrans.fwd);
      c.transRight = mix(kb.transRight, gpTrans.right);
      c.transUp = mix(kb.transUp, gp?.transUp);
      c.fine = fine;

      // ---- throttle lever / rate-of-descent switch
      const upKey = h(THROTTLE_KEYS.up);
      const downKey = h(THROTTLE_KEYS.down);
      const upHeld = held.has(THROTTLE_KEYS.up);
      const downHeld = held.has(THROTTLE_KEYS.down);
      if (rodMode(v)) {
        // (the first click of a key press is emitted on keydown; this repeats it while held)
        const up = upHeld || (gp && gp.rt > 0.5);
        const down = downHeld || (gp && gp.lt > 0.5);
        for (let n = repeatClicks(rodUp, !!up && !down, dt); n > 0; n--) emit('ROD_UP');
        for (let n = repeatClicks(rodDown, !!down && !up, dt); n > 0; n--) emit('ROD_DOWN');
      } else {
        repeatClicks(rodUp, false, dt);
        repeatClicks(rodDown, false, dt);
        const rate = shiftHeld ? THROTTLE_RATE_FINE : THROTTLE_RATE;
        const d = (upKey - downKey) * rate + (gp ? (gp.rt - gp.lt) * THROTTLE_RATE : 0);
        if (d !== 0 && dt > 0) c.throttle = clamp((c.throttle || 0) + d * dt, 0, 1);
      }

      // ---- arrow-key camera look (outside P64, where the arrows are LPD clicks)
      if (live && !lpdMode(v)) {
        look.x = h('ArrowRight') - h('ArrowLeft');
        look.y = h('ArrowUp') - h('ArrowDown');
      } else look.x = look.y = 0;
      tapped.clear();
    },
  };
}
