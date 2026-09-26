// In-flight onboarding: the "flight card" shown at the start of every mission (the handful of keys
// that matter for it, plus the briefing tips), phase-triggered hints ("P66: R / F click the
// descent rate", "watch for LUNAR CONTACT, then X") and the "This mission" section of the F1 help.
//
// The card sits left-middle (clear of the HUD panels and of the spacecraft in the chase view),
// stays at least MIN_S seconds, fades FADE_AFTER_INPUT_S after the pilot's first flight input or
// after MAX_S seconds (real time) / MAX_MET_S seconds of mission time, and can be closed with ×.
// Hints appear in the same place, one at a time, each at most once per mission.
// Everything is suppressed while game.settings.flightTips is false (Settings › Flight tips).

import { h, setClass } from './dom.js';
import { FT } from './format.js';

const MIN_S = 8;
const MAX_S = 22;
const MAX_MET_S = 30;
const FADE_AFTER_INPUT_S = 7;
const HINT_S = 8;

/** Key rows per mission: [keys[], text]. */
export const MISSION_KEYS = {
  hover: [
    [['R', 'F'], 'Throttle up / down — hover is about 29 % (green tick on the thrust bar)'],
    [['W', 'S', 'A', 'D'], 'Tilt to move, tilt back to stop'],
    [['Q', 'E'], 'Roll left / right'],
    [['X'], 'ENGINE STOP when the blue LUNAR CONTACT light comes on'],
    [['C'], 'Change camera · F1 all controls'],
  ],
  lowgate: [
    [['W', 'S'], 'Pitch: level out (W) as the forward speed dies'],
    [['A', 'D', 'Q', 'E'], 'Yaw / roll to line up'],
    [['R', 'F'], 'Rate-of-descent switch: one click = 1 ft/s (F = faster)'],
    [['X'], 'ENGINE STOP at LUNAR CONTACT'],
    [['C'], 'Change camera · F1 all controls'],
  ],
  highgate: [
    [['↑', '↓', '←', '→'], 'P64: move the landing point (LPD)'],
    [['Y'], 'Take over: P66 rate-of-descent below about 500 ft'],
    [['R', 'F'], 'P66: descent rate ±1 ft/s per click'],
    [['X'], 'ENGINE STOP at LUNAR CONTACT'],
    [['C'], 'Change camera · F1 all controls'],
  ],
  pdi: [
    [['Space'], 'PRO when V99 flashes (5 s before ignition)'],
    [['Enter'], 'Master alarm reset (1201 / 1202)'],
    [['↑', '↓', '←', '→'], 'P64: move the landing point'],
    [['Y'], 'Take over in P66 · R / F descent rate'],
    [['.', ','], 'Time warp (limited while the engine burns) · C camera'],
  ],
  undock: [
    [['U'], 'Undock — “The Eagle has wings”'],
    [['V'], 'Switch between Eagle and Columbia'],
    [['H', 'N', 'J', 'L', 'I', 'K'], 'Translate: fwd / back, left / right, up / down'],
    [['W', 'S', 'A', 'D', 'Q', 'E'], 'Pitch, yaw, roll'],
    [['C'], 'Change camera · F1 all controls'],
  ],
  landed: [
    [['Space'], 'PRO when V99 flashes: ascent engine ignition'],
    [['.', ','], 'Time warp until ignition'],
    [['Backspace ×2'], 'Manual liftoff: stage, then R throttle'],
    [['C'], 'Change camera · F1 all controls'],
  ],
  csm: [
    [['V'], 'Switch to Eagle and take the controls'],
    [['W', 'S', 'A', 'D', 'Q', 'E'], 'Pitch, yaw, roll Columbia'],
    [['.', ','], 'Time warp (10× while an engine burns)'],
    [['C'], 'Change camera · Shift+C crew station'],
  ],
  docking: [
    [['H', 'N'], 'Close / open the range (about 0.1 ft/s per tap)'],
    [['J', 'L', 'I', 'K'], 'Translate left / right, up / down to centre the drogue'],
    [['Caps Lock'], 'Fine control'],
    [['B', 'G'], 'Attitude hold · kill rotation'],
    [['C'], 'Change camera · F1 all controls'],
  ],
};

const GENERIC_KEYS = [
  [['W', 'S', 'A', 'D', 'Q', 'E'], 'Pitch, yaw, roll'],
  [['R', 'F'], 'Throttle'],
  [['C'], 'Change camera · F1 all controls'],
];

/** Cockpit flight cards (the landing missions flown from the window) add the glance key. */
const GLANCE_MISSIONS = new Set(['pdi', 'highgate', 'lowgate', 'hover']);
const GLANCE_ROW = [['O'], 'Glance at the instruments / DSKY (again: back out of the window)'];

/**
 * Key rows of a mission's flight card. `iva`: flown from the cockpit — the landing missions add
 * O (glance at the instruments / DSKY) before the camera row.
 */
export function missionKeys(id, { iva = false } = {}) {
  const rows = MISSION_KEYS[id] || GENERIC_KEYS;
  if (!iva || !GLANCE_MISSIONS.has(id)) return rows;
  const i = rows.findIndex(([k]) => k.length === 1 && k[0] === 'C');
  const at = i < 0 ? rows.length : i;
  return [...rows.slice(0, at), GLANCE_ROW, ...rows.slice(at)];
}

function keyRow([keys, text]) {
  return h('div.fk', null, h('span.fkk', null, keys.map((k) => h('kbd', null, k))), h('span.fkt', null, text));
}

/** "This mission" block for the F1 help (null when no mission is loaded). */
export function missionHelp(sc, { iva = false } = {}) {
  if (!sc) return null;
  return h('section.mhelp', null,
    h('h3', null, `This mission · ${sc.title}`),
    h('div.fkeys', null, missionKeys(sc.id, { iva }).map(keyRow)),
    sc.tips?.length ? h('ul.tips', null, sc.tips.map((t) => h('li', null, t))) : null,
  );
}

/**
 * Phase hints: { id, test(v, game, {met}) -> bool, text | text(v, game) }. Checked a few times a second
 * for the active vessel; each fires at most once per mission.
 */
const HINTS = [
  {
    id: 'p64',
    test: (v) => v.type === 'LM' && !v.landed && v.gnc.program === 'P64',
    text: 'P64 — the LGC is flying to the landing point. Arrow keys move it (LPD); Y takes over in P66.',
  },
  {
    id: 'p66',
    test: (v) => v.type === 'LM' && !v.landed && v.gnc.program === 'P66' && v.gnc.throttleMode === 'AUTO',
    text: 'P66 — R / F click the rate of descent: F = 1 ft/s faster, R = 1 ft/s slower. Steer with W/S/A/D.',
  },
  {
    id: 'sink',
    test: (v) => v.type === 'LM' && !v.landed && !v.staged && v.gnc.throttleMode !== 'AUTO' && v.mainEngine.firing && gearAlt(v) < 55 && gearAlt(v) > 6 && v.tel.vSpeed < -2.4,
    text: (v) => `Sinking ${Math.round(-v.tel.vSpeed / FT)} ft/s — R adds throttle (hover ≈ ${Math.round((v.tel.hoverThrottle || 0.29) * 100)} %). Aim for 3 ft/s or less at contact.`,
  },
  {
    id: 'contact',
    test: (v) => v.type === 'LM' && !v.landed && !v.staged && v.mainEngine.firing && gearAlt(v) < 9.2 && v.tel.vSpeed < -0.1,
    text: 'Watch for the blue LUNAR CONTACT light, then X — ENGINE STOP.',
  },
  {
    id: 'undock',
    test: (v, game, c) => game.scenarioId === 'undock' && v.docked && c.met > 25,
    text: 'U undocks Eagle from Columbia. V switches spacecraft at any time.',
  },
];

function gearAlt(v) {
  const t = v.tel;
  if (Number.isFinite(t.radarAltitude) && t.altitude < 15000) return t.radarAltitude;
  return Number.isFinite(t.gearAltitude) ? t.gearAltitude : t.altitude;
}

/**
 * @param {object} game
 * @param {object[]} scenarios
 */
export function createFlightTips(game, scenarios) {
  const title = h('div.ftt');
  const sub = h('div.fts');
  const keys = h('div.fkeys');
  const tips = h('ul.tips');
  const close = h('button.fclose', { type: 'button', 'aria-label': 'Hide the flight card' }, '×');
  const card = h('div.fcard.pe.hidden', { role: 'note' },
    h('div.fch', null, h('span.fcl', null, 'Flight card'), close),
    title, sub, keys, tips,
    h('div.fcn', null, 'F1 shows this again · Settings › Flight tips'),
  );
  const hintText = h('span');
  const hint = h('div.fhint.hidden', { role: 'status' }, h('b', null, 'Tip'), hintText);
  const el = h('div.ftips', null, card, hint);

  const st = { open: false, t: 0, met0: 0, inputAt: null, fired: new Set(), hintT: 0, checkT: 0, first: true, id: null, iva: null };

  /** (Re)build the key rows for the current view (the cockpit adds the glance key). */
  function renderKeys() {
    st.iva = game.view?.mode === 'iva';
    keys.replaceChildren(...missionKeys(st.id, { iva: st.iva }).map(keyRow));
  }

  function fade() {
    if (!st.open) return;
    st.open = false;
    card.classList.add('out');
    setTimeout(() => {
      if (!st.open) setClass(card, 'hidden', true);
    }, 700);
  }
  close.addEventListener('click', fade);

  function onScenario(id) {
    const sc = scenarios.find((s) => s.id === id);
    st.fired.clear();
    st.first = true;
    st.checkT = 0;
    st.hintT = 0;
    setClass(hint, 'hidden', true);
    st.inputAt = null;
    st.t = 0;
    st.met0 = game.time.met;
    if (!sc || game.settings.flightTips === false) {
      st.open = false;
      setClass(card, 'hidden', true);
      return;
    }
    title.textContent = sc.title;
    sub.textContent = sc.subtitle || '';
    st.id = sc.id;
    renderKeys();
    // the briefing tips live in the briefing and the F1 help; the card only adds the ones the key
    // list does not already cover
    tips.replaceChildren(...(MISSION_KEYS[sc.id] ? [] : sc.tips || []).slice(0, 3).map((t) => h('li', null, t)));
    card.classList.remove('out');
    setClass(card, 'hidden', false);
    st.open = true;
  }

  /** The pilot pressed a flight key (not in a menu). */
  function onInput() {
    if (st.open && st.inputAt == null) st.inputAt = st.t;
  }

  function showHint(text) {
    hintText.textContent = text;
    hint.classList.remove('out');
    setClass(hint, 'hidden', false);
    // restart the entry animation
    hint.style.animation = 'none';
    void hint.offsetWidth;
    hint.style.animation = '';
    st.hintT = HINT_S;
  }

  /**
   * @param {number} dt real seconds
   * @param {{visible: boolean, running: boolean}} o visible: HUD on and no menu; running: sim not paused
   */
  function update(dt, o) {
    setClass(el, 'off', !o.visible);
    if (st.open && st.id && (game.view?.mode === 'iva') !== st.iva) renderKeys();
    if (o.running && o.visible) {
      st.t += dt;
      if (st.open) {
        const met = game.time.met - st.met0;
        const byInput = st.inputAt != null && st.t > Math.max(MIN_S, st.inputAt + FADE_AFTER_INPUT_S);
        if (byInput || st.t > MAX_S || met > MAX_MET_S) fade();
      }
      if (st.hintT > 0) {
        st.hintT -= dt;
        if (st.hintT <= 0) hint.classList.add('out');
      }
    }
    if (game.settings.flightTips === false) {
      if (st.open) fade();
      return;
    }
    st.checkT -= dt;
    if (st.checkT > 0 || !game.started) return;
    st.checkT = 0.25;
    const v = game.active;
    if (!v || !v.tel || v.crashed) return;
    const first = st.first;
    for (const hd of HINTS) {
      if (st.fired.has(hd.id)) continue;
      let ok = false;
      try {
        ok = hd.test(v, game, { met: game.time.met - st.met0 });
      } catch {
        ok = false;
      }
      if (!ok) continue;
      st.fired.add(hd.id);
      // true from the first check of the mission: the card already says it
      if (st.first) continue;
      if (st.open) fade();
      showHint(typeof hd.text === 'function' ? hd.text(v, game) : hd.text);
      break;
    }
    if (first) st.first = false;
  }

  return {
    el,
    onScenario,
    onInput,
    update,
    hide: fade,
    get open() {
      return st.open;
    },
    /** MET at which the current mission started. */
    get startMet() {
      return st.met0;
    },
  };
}
