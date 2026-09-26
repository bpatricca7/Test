// Content views shared by the title screen, the in-flight menu and the help card:
// missions (list + briefing), settings, controls reference and about/credits.
// Each factory returns { el, refresh?() }.

import { h } from './dom.js';
import { fmtMET } from './format.js';
import { saveSettings, qualityURL } from './settings.js';
import * as Bindings from '../input/bindings.js';

// ---------------------------------------------------------------- controls reference data
/** Built-in key list (used if the input module's BINDINGS table is unavailable). */
const FALLBACK_BINDINGS = [
  { group: 'Attitude', keys: ['W', 'S'], action: 'Pitch nose down / nose up' },
  { group: 'Attitude', keys: ['A', 'D'], action: 'Yaw left / right' },
  { group: 'Attitude', keys: ['Q', 'E'], action: 'Roll left / right' },
  { group: 'Attitude', keys: ['Caps Lock'], action: 'Fine control' },
  { group: 'Attitude', keys: ['T'], action: 'RCS mode: RATE → PULSE → DIRECT' },
  { group: 'Attitude', keys: ['B'], action: 'Attitude hold on / off' },
  { group: 'Attitude', keys: ['G'], action: 'Kill rotation' },
  { group: 'Translation', keys: ['H', 'N'], action: 'Forward / back' },
  { group: 'Translation', keys: ['J', 'L'], action: 'Left / right' },
  { group: 'Translation', keys: ['I', 'K'], action: 'Up / down' },
  { group: 'Engine', keys: ['R', 'F'], action: 'Throttle up / down (P66: rate-of-descent clicks)' },
  { group: 'Engine', keys: ['Z'], action: 'Full throttle' },
  { group: 'Engine', keys: ['X'], action: 'ENGINE STOP (latches until ENGINE START)' },
  { group: 'Engine', keys: ['Shift+X'], action: 'ENGINE START — reset the ENGINE STOP latch' },
  { group: 'Engine', keys: ['Backspace ×2'], action: 'ABORT STAGE' },
  { group: 'Guidance computer', keys: ['Space'], action: 'PROCEED (DSKY PRO)' },
  { group: 'Guidance computer', keys: ['Y'], action: 'Auto / manual guidance' },
  { group: 'Guidance computer', keys: ['1–9', '0'], action: 'Attitude autopilots / guidance steering' },
  { group: 'Guidance computer', keys: ['↑', '↓', '←', '→'], action: 'P64: redesignate the landing point' },
  { group: 'Guidance computer', keys: ['Enter'], action: 'Master alarm reset' },
  { group: 'Spacecraft', keys: ['V'], action: 'Switch between Eagle and Columbia' },
  { group: 'Spacecraft', keys: ['U'], action: 'Undock' },
  { group: 'Views', keys: ['C'], action: 'Next camera' },
  { group: 'Views', keys: ['Shift+C'], action: 'Next crew station' },
  { group: 'Views', keys: ['Home'], action: 'Reset view' },
  { group: 'Simulation', keys: [',', '.'], action: 'Time warp slower / faster' },
  { group: 'Simulation', keys: ['/'], action: 'Time warp off' },
  { group: 'Simulation', keys: ['P'], action: 'Pause' },
  { group: 'Interface', keys: ['Esc'], action: 'Menu' },
  { group: 'Interface', keys: ['F1', '?'], action: 'Help' },
  { group: 'Interface', keys: ['Tab'], action: 'Show / hide the HUD' },
  { group: 'Interface', keys: ['F3'], action: 'Units' },
  { group: 'Interface', keys: ['M'], action: 'Sound on / off' },
];

export function getBindings() {
  const b = Bindings && Bindings.BINDINGS;
  return Array.isArray(b) && b.length ? b : FALLBACK_BINDINGS;
}

/** Controls reference grouped by `group`, keycaps + description (+ gamepad hint). */
export function createControlsView({ compact = false } = {}) {
  const groups = new Map();
  for (const b of getBindings()) {
    const g = b.group || 'Other';
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(b);
  }
  const grid = h('div.cgrid');
  for (const [name, list] of groups) {
    grid.appendChild(
      h('section.cgroup', null,
        h('h3', null, name.replace(/\s*\(.*\)\s*$/, '')),
        list.map((b) =>
          h('div.crow', null,
            h('div.ck', null, (b.keys || []).map((k) => h('kbd', null, k))),
            h('div.ca', null, b.action, b.gamepad ? h('span.cg', null, `Gamepad: ${b.gamepad}`) : null),
          ),
        ),
      ),
    );
  }
  const el = h(`div.controls${compact ? '' : '.scroll'}`, null,
    h('p.kbnote', { style: { margin: '0 0 14px' } }, 'Keys follow the physical keyboard layout (QWERTY positions). A standard gamepad works too: sticks fly the spacecraft, triggers move the throttle.'),
    grid,
  );
  return { el };
}

// ---------------------------------------------------------------- about / credits
export function createAboutView() {
  const el = h('div.about.scroll', null,
    h('h3', null, 'Apollo 11'),
    h('p', null,
      'On 20 July 1969 the Lunar Module ', h('b', null, 'Eagle'), ' landed in the Sea of Tranquility while the Command Module ',
      h('b', null, 'Columbia'), ' circled overhead. Neil Armstrong flew the final approach by hand in P66, steering past a boulder field while Buzz Aldrin called out altitude and speed. ',
      h('q', null, 'Houston, Tranquility Base here. The Eagle has landed.'),
    ),
    h('dl', null,
      h('dt', null, 'Crew'), h('dd', null, 'Neil A. Armstrong (CDR) · Michael Collins (CMP) · Edwin E. “Buzz” Aldrin Jr. (LMP)'),
      h('dt', null, 'Powered descent'), h('dd', null, 'PDI at GET 102:33:05, touchdown 102:45:40 — 12½ minutes'),
      h('dt', null, 'Landing site'), h('dd', null, '0.674° N, 23.473° E — Mare Tranquillitatis'),
      h('dt', null, 'Descent engine'), h('dd', null, '10,125 lbf (45.0 kN), throttleable, gimballed · Isp 311 s'),
      h('dt', null, 'Ascent engine'), h('dd', null, '3,500 lbf (15.6 kN), fixed thrust'),
      h('dt', null, 'Service engine'), h('dd', null, '20,500 lbf (91.2 kN)'),
      h('dt', null, 'RCS'), h('dd', null, '16 thrusters of 100 lbf on each spacecraft'),
      h('dt', null, 'Orbit'), h('dd', null, 'Columbia: ~60 nmi (111 km) circular · Eagle: 60 × 8 nmi descent orbit'),
    ),
    h('h3', null, 'What is simulated'),
    h('ul', null,
      h('li', null, 'Six-degree-of-freedom rigid-body flight with real masses, thrust, specific impulse and moments of inertia; propellant use shifts mass and centre of gravity.'),
      h('li', null, 'Individually simulated RCS jets driven by a digital autopilot with rate-command / attitude-hold, pulse and direct modes.'),
      h('li', null, 'Guidance programs P63 braking, P64 approach with landing-point redesignation, P66 rate of descent, P67 manual, P12 powered ascent, with a working DSKY and the 1201/1202 program alarms (optional).'),
      h('li', null, 'Landing gear with crushable struts, contact probes and the LUNAR CONTACT light; docking with probe capture and hard dock.'),
    ),
    h('h3', null, 'Simplifications'),
    h('ul', null,
      h('li', null, 'The Moon does not rotate, and its gravity is a point mass (no mascons).'),
      h('li', null, 'The terrain is procedural — craters and boulders in the style of the landing site, not surveyed topography.'),
      h('li', null, 'The guidance computers reproduce the programs’ behaviour and displays, not the original AGC software; there is no Abort Guidance System and systems such as power and life support are not modelled.'),
      h('li', null, 'Launch, translunar flight and entry are not part of the game.'),
    ),
    h('h3', null, 'Credits'),
    h('p', null, 'A fan-made simulator built with three.js. Every model, texture, sound and voice is generated in your browser — nothing is downloaded. Mission data from the Apollo 11 mission reports and press kit. Not affiliated with NASA.'),
  );
  return { el };
}

// ---------------------------------------------------------------- missions
const DIFF_ORDER = ['Beginner', 'Easy', 'Medium', 'Hard'];

const VESSEL_LABEL = { LM: 'Eagle · Lunar Module', CSM: 'Columbia · CSM' };
const CAMERA_LABEL = { iva: 'Cockpit', chase: 'Chase', locked: 'Locked', flyby: 'Fly-by', ground: 'Ground', target: 'Target' };

/**
 * Mission list + briefing.
 * @param {object[]} scenarios
 * @param {{onStart(id:string):void, isTouch():boolean}} cb
 */
export function createMissionsView(scenarios, cb) {
  let sel = Math.max(0, scenarios.findIndex((s) => s.id === 'hover'));
  const rows = [];
  const list = h('div.mlist.scroll', { role: 'listbox', 'aria-label': 'Missions' });
  scenarios.forEach((s, i) => {
    const diff = String(s.difficulty || '');
    const row = h('button.mrow', { type: 'button', role: 'option', dataset: { nav: 'mission', id: s.id } },
      h('span.idx', null, String(i + 1).padStart(2, '0')),
      h('span.mt', null, s.title),
      h(`span.diff.${diff.toLowerCase()}`, null, diff),
      h('span.ms', null, s.subtitle || ''),
    );
    row.addEventListener('focus', () => {
      if (row.matches(':focus-visible')) select(i);
    });
    row.addEventListener('click', (e) => {
      // keyboard Enter (detail 0) on the selected row starts it; a mouse click selects
      if (e.detail === 0 && sel === i) cb.onStart(s.id);
      else {
        select(i);
        // stacked (phone) layout: bring the briefing and its Start button into view
        // (scroll only the page's own scroll container: scrollIntoView would also scroll the
        // overflow-hidden UI layer and push the in-flight HUD off-screen)
        if (e.detail > 0 && window.innerWidth <= 720) revealBrief();
      }
    });
    row.addEventListener('dblclick', () => cb.onStart(s.id));
    rows.push(row);
    list.appendChild(row);
  });

  const bTitle = h('h2');
  const bSub = h('div.sub');
  const bDesc = h('p.desc');
  const bFacts = h('div.facts');
  const bTips = h('ul.tips');
  const bDiff = h('span.diff');
  const bNum = h('span');
  const start = h('button.btn.primary', { type: 'button', dataset: { nav: 'start' } }, 'Begin mission', h('span.arrow', null, '▸'));
  start.addEventListener('click', () => cb.onStart(scenarios[sel].id));
  const brief = h('article.brief', { 'aria-live': 'polite' },
    h('div.bbody.scroll', null,
      h('div.bh', null, bNum, bDiff),
      bTitle,
      bSub,
      bDesc,
      bFacts,
      bTips,
      h('div.touchnote', null, 'Flying needs a keyboard or a gamepad. On a phone or tablet you can browse the missions, but connect a keyboard or controller to fly.'),
    ),
    h('div.actions', null, start, h('span.kbnote.kbonly', null, h('kbd', null, 'Enter'), ' to start')),
  );

  function revealBrief() {
    const box = el;
    if (!box || box.scrollHeight <= box.clientHeight + 1) return;
    const top = box.scrollTop + brief.getBoundingClientRect().top - box.getBoundingClientRect().top - 8;
    try {
      box.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    } catch {
      box.scrollTop = Math.max(0, top);
    }
  }

  function select(i) {
    sel = (i + scenarios.length) % scenarios.length;
    const s = scenarios[sel];
    rows.forEach((r, k) => {
      r.classList.toggle('on', k === sel);
      r.setAttribute('aria-selected', k === sel ? 'true' : 'false');
    });
    bNum.textContent = `Mission ${String(sel + 1).padStart(2, '0')} / ${String(scenarios.length).padStart(2, '0')}`;
    const diff = String(s.difficulty || '');
    bDiff.className = `diff ${diff.toLowerCase()}`;
    bDiff.textContent = diff;
    bTitle.textContent = s.title;
    bSub.textContent = s.subtitle || '';
    bDesc.textContent = s.description || '';
    bFacts.replaceChildren(
      h('div.fact', null, 'Spacecraft', h('b', null, VESSEL_LABEL[s.activeId] || s.activeId)),
      h('div.fact', null, 'Starts at', h('b', null, `GET ${fmtMET(s.met)}`)),
      h('div.fact', null, 'View', h('b', null, `${CAMERA_LABEL[s.camera] || s.camera || 'Cockpit'}${s.camera === 'iva' && s.station ? ` · ${s.station}` : ''}`)),
    );
    bTips.replaceChildren(...(s.tips || []).map((t) => h('li', null, t)));
  }
  select(sel);

  const el = h('div.missions', null, list, brief);
  return {
    el,
    select,
    get selected() {
      return scenarios[sel];
    },
    /** Element to focus when the page opens. */
    focusTarget: () => rows[sel],
    difficultyRank: (d) => DIFF_ORDER.indexOf(d),
  };
}

// ---------------------------------------------------------------- settings
/**
 * Settings page. Writes game.settings immediately and persists it.
 * @param {object} game
 * @param {{onChange?(key:string, value:any):void}} cb
 */
export function createSettingsView(game, cb = {}) {
  const S = game.settings;
  const refreshers = [];
  const set = (k, v) => {
    S[k] = v;
    saveSettings(S);
    cb.onChange?.(k, v);
    refresh();
  };

  function seg(key, options, { onPick } = {}) {
    const wrap = h('div.seg', { role: 'radiogroup' });
    const btns = options.map(([value, label]) => {
      const b = h('button', { type: 'button', role: 'radio' }, label);
      b.addEventListener('click', () => (onPick ? onPick(value) : set(key, value)));
      wrap.appendChild(b);
      return [value, b];
    });
    refreshers.push(() => {
      for (const [value, b] of btns) {
        const on = S[key] === value;
        b.classList.toggle('on', on);
        b.setAttribute('aria-checked', on ? 'true' : 'false');
      }
    });
    return wrap;
  }

  function range(key, { min, max, step, fmt }) {
    const input = h('input', { type: 'range', min, max, step, 'aria-label': key });
    const out = h('output');
    const paint = () => {
      const p = ((S[key] - min) / (max - min)) * 100;
      input.style.setProperty('--p', `${p}%`);
      out.textContent = fmt(S[key]);
    };
    input.addEventListener('input', () => {
      S[key] = +input.value;
      paint();
      cb.onChange?.(key, S[key]);
    });
    input.addEventListener('change', () => saveSettings(S));
    refreshers.push(() => {
      if (document.activeElement !== input) input.value = String(S[key]);
      paint();
    });
    return h('div.rng', null, input, out);
  }

  const row = (label, desc, control) => h('div.srow', null, h('div', null, h('span.sl', null, label), desc ? h('span.sd', null, desc) : null), control);
  const onOff = (key, on = 'On', off = 'Off') => seg(key, [[true, on], [false, off]]);

  const qualityNote = h('span.sd');
  const el = h('div.settings.scroll', null,
    h('section.sgroup', null,
      h('h3', null, 'Display'),
      row('Units', 'Imperial feet and ft/s, as flown on Apollo — or metric.', seg('units', [['imperial', 'Imperial'], ['metric', 'Metric']])),
      row('Heads-up display', 'Tab toggles it in flight.', onOff('hud', 'Show', 'Hide')),
      row('Flight tips', 'The key card at the start of each mission and hints at key moments of the landing.', onOff('flightTips', 'Show', 'Hide')),
      row('Film grain & vignette', 'Subtle photographic grain and lens falloff.', onOff('filmGrain')),
      row('Exposure compensation', 'Brighter or darker than the automatic exposure.', range('exposureComp', { min: -2, max: 2, step: 0.1, fmt: (v) => `${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(v).toFixed(1)} EV` })),
      row('Graphics quality', h('span', null, 'Changing it reloads the page.', qualityNote), seg('quality', [['low', 'Low'], ['medium', 'Medium'], ['high', 'High']], {
        onPick(q) {
          if (q === S.quality) return;
          const prev = S.quality;
          S.quality = q;
          const stored = saveSettings(S);
          try {
            // a ?quality= parameter would override the stored value: rewrite it; otherwise just reload
            if (new URL(window.location.href).searchParams.has('quality')) window.location.replace(qualityURL(window.location.href, q));
            else if (stored) window.location.reload();
            else throw new Error('no storage');
          } catch {
            S.quality = prev;
            qualityNote.textContent = ` Could not reload here — add ?quality=${q} to the address.`;
          }
        },
      })),
    ),
    h('section.sgroup', null,
      h('h3', null, 'Sound'),
      row('Sound', 'M toggles it in flight.', onOff('audio')),
      row('Volume', null, range('volume', { min: 0, max: 1, step: 0.05, fmt: (v) => `${Math.round(v * 100)}%` })),
      row('Voice callouts', 'Crew and Mission Control callouts (spoken and captioned).', onOff('callouts')),
    ),
    h('section.sgroup', null,
      h('h3', null, 'Flight'),
      row('Invert pitch', 'Swap W / S (and the gamepad stick) for nose up / nose down.', onOff('invertPitch')),
      row('Mouse sensitivity', 'Cockpit head-look and camera orbit.', range('mouseSensitivity', { min: 0.2, max: 3, step: 0.1, fmt: (v) => `${v.toFixed(1)}×` })),
      row('Historical program alarms', 'The 1201 / 1202 executive-overflow alarms during the powered descent, as on Apollo 11.', onOff('historicalAlarms')),
    ),
    h('div', { style: { margin: '6px 0 4px' } },
      h('button.btn.small', { type: 'button', onclick: resetDefaults }, 'Reset to defaults'),
    ),
  );

  function resetDefaults() {
    Object.assign(S, { units: 'imperial', hud: true, audio: true, volume: 0.8, callouts: true, invertPitch: false, mouseSensitivity: 1, historicalAlarms: false, filmGrain: true, exposureComp: 0, flightTips: true });
    saveSettings(S);
    cb.onChange?.('*');
    refresh();
  }

  function refresh() {
    for (const r of refreshers) r();
  }
  refresh();
  return { el, refresh };
}
