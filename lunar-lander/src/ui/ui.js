// User interface: title screen & main menu, in-flight HUD, 3D markers, messages & captions,
// pause / help / settings overlays and the landing result card. Owned by the UI agent.
//
// Contract: createUI(game, rootEl, api) -> { update(frame) }
//   api = { scenarios, startScenario(id), ctx, cameras, sim }
//
// Actions handled ('action' events): TOGGLE_HUD, HELP, MENU, TOGGLE_UNITS.
// Sets game.uiCapture = true while a modal overlay is open (title, menu, help, result) so the
// input module ignores flight keys; Esc / F1 still reach us as MENU / HELP actions.
// Settings added to game.settings (with defaults): filmGrain, exposureComp (read by render/post.js).
// Settings are remembered in localStorage (see settings.js); render quality changes reload the page.
//
// Keyboard in menus: arrow keys move the focus spatially, Enter activates, Esc goes back.
//
// Extra methods on the returned object (tests / QA): openMenu(tab), closeMenu(), openHelp(),
// showResult(), finishBackdrop().

import { h, slot, setClass } from './dom.js';
import { injectStyles } from './styles.js';
import { ensureDefaults, loadSettings, saveSettings } from './settings.js';
import { createBackdrop } from './backdrop.js';
import { createPatch } from './patch.js';
import { createMissionsView, createSettingsView, createControlsView, createAboutView } from './views.js';
import { createHUD } from './hud.js';
import { createMarkers } from './markers.js';
import { createTicker } from './ticker.js';
import { createResultCard } from './result.js';
import { fmtMET, fmtAlt, fmtPct, fmtWarp, PROGRAM_NAMES } from './format.js';

const RESULT_DELAY_MS = { landed: 5200, hard: 3200, crashed: 2400, tipped: 3000 };

export function createUI(game, rootEl, api) {
  injectStyles();
  ensureDefaults(game.settings);
  loadSettings(game.settings, game.params || {});

  const root = h('div.aui');
  rootEl.appendChild(root);

  // phones / tablets: note that flying needs a keyboard or a gamepad
  const touchQuery = () => {
    try {
      return window.matchMedia('(pointer: coarse)').matches || window.innerWidth < 640;
    } catch {
      return window.innerWidth < 640;
    }
  };
  const updateTouch = () => setClass(root, 'touch', touchQuery());
  updateTouch();
  window.addEventListener('resize', updateTouch);

  // ---------------------------------------------------------------- HUD layers
  const hud = createHUD(game);
  const markers = api.ctx ? createMarkers(game, api.ctx) : null;
  const ticker = createTicker();
  const pauseBar = h('div.pausebar.hidden', null, h('b', null, 'PAUSED'), h('span', null, 'P to resume · Esc for the menu'));
  root.append(...[markers?.el, hud.el, ticker.el, pauseBar].filter(Boolean));

  // ---------------------------------------------------------------- title / menu screen
  const bdCanvas = h('canvas.bd');
  const backdrop = createBackdrop(bdCanvas);
  const overline = h('div.overline');
  const titleMain = h('h1.title-main');
  const titleSub = h('div.title-sub');
  const tagline = h('p.tagline', null, 'Fly the Command Module Columbia and the Lunar Module Eagle. Ride the guidance computer down from orbit, take over for the last few hundred feet, and set her down in the Sea of Tranquility.');
  const brand = h('header.brand', null, overline, h('div.brand-row', null, createPatch({ size: 96 }), h('div', null, titleMain, titleSub)), tagline);

  const TABS = [
    ['flight', 'Flight'],
    ['missions', 'Missions'],
    ['settings', 'Settings'],
    ['controls', 'Controls'],
    ['about', 'About'],
  ];
  const tabBtns = {};
  const tabsEl = h('nav.tabs', { role: 'tablist' });
  for (const [id, label] of TABS) {
    const b = h('button.tab', { type: 'button', role: 'tab', dataset: { tab: id } }, label);
    b.addEventListener('click', () => setTab(id, { focus: false }));
    b.addEventListener('focus', () => {
      if (b.matches(':focus-visible')) setTab(id, { focus: false });
    });
    tabBtns[id] = b;
    tabsEl.appendChild(b);
  }

  // pages
  const missions = createMissionsView(api.scenarios || [], { onStart: startScenario });
  const settingsView = createSettingsView(game, { onChange: onSettingChanged });
  const controlsView = createControlsView();
  const aboutView = createAboutView();

  const fStatus = {};
  const fItem = (label, hint, fn) => {
    const b = h('button.fitem', { type: 'button' }, h('span', null, label), h('small', null, hint));
    b.addEventListener('click', fn);
    return b;
  };
  const fResume = fItem('Resume', 'Esc', () => closeMenu());
  const fRestartHint = slot(h('small'));
  const fRestart = h('button.fitem', { type: 'button' }, h('span', null, 'Restart mission'), fRestartHint.el);
  fRestart.addEventListener('click', () => restart());
  const flightPage = h('div.fmenu', null,
    fResume,
    fRestart,
    fItem('Change mission', `${(api.scenarios || []).length} missions`, () => setTab('missions')),
    fItem('Settings', 'Units · sound · display', () => setTab('settings')),
    fItem('Controls', 'F1', () => setTab('controls')),
    h('div.fstatus', null,
      ...['Vessel', 'Program', 'Altitude', 'Propellant', 'GET', 'Warp'].map((k) => {
        const b = h('b');
        fStatus[k] = slot(b);
        return h('div', null, k, b);
      }),
    ),
  );

  const pages = {
    flight: h('section.page', null, flightPage),
    missions: h('section.page', null, missions.el),
    settings: h('section.page', null, settingsView.el),
    controls: h('section.page', null, controlsView.el),
    about: h('section.page', null, aboutView.el),
  };
  const foot = h('footer.foot', null,
    h('span', null, h('kbd', null, '↑'), h('kbd', null, '↓'), ' select'),
    h('span', null, h('kbd', null, 'Enter'), ' confirm'),
    h('span', null, h('kbd', null, 'Esc'), ' back'),
    h('span', null, h('kbd', null, 'F1'), ' controls'),
  );
  const shell = h('div.shell', null, brand, tabsEl, ...Object.values(pages), foot);
  const screen = h('div.screen.pe', null, bdCanvas, h('div.scrim'), shell);
  root.appendChild(screen);

  // ---------------------------------------------------------------- help & result modals
  const helpClose = h('button.close', { type: 'button', 'aria-label': 'Close' }, '×');
  const helpControls = createControlsView({ compact: true });
  helpControls.el.classList.add('scroll');
  const help = h('div.modal.help.pe', null,
    h('div.veil'),
    h('div.card', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Controls' },
      h('div.chead', null, h('h2', null, 'Flight controls'), h('span.kbnote', null, h('kbd', null, 'F1'), ' or ', h('kbd', null, 'Esc'), ' to close'), helpClose),
      helpControls.el,
    ),
  );
  helpClose.addEventListener('click', () => closeHelp());
  help.querySelector('.veil').addEventListener('click', () => closeHelp());

  const result = createResultCard({
    onContinue: () => closeResult(),
    onRetry: () => {
      closeResult();
      restart();
    },
    onMissions: () => {
      closeResult();
      openMenu('missions');
    },
  });
  root.append(help, result.el);

  // ---------------------------------------------------------------- state
  const st = {
    screen: null, // 'title' | 'menu' | null
    tab: 'missions',
    help: false,
    result: false,
    pausedByUI: false,
    pendingResult: null, // {at, token}
    resultToken: 0, // bumps on every scenario load
    resultShown: -1,
    statusT: 0,
  };

  function anyModal() {
    return !!(st.screen || st.help || st.result);
  }

  /** Pause the sim while a modal menu/help is open (remember whether we did it). */
  function syncPause() {
    const want = game.started && (st.screen === 'menu' || st.help);
    if (want && !game.time.paused) {
      game.time.paused = true;
      st.pausedByUI = true;
    } else if (!want && st.pausedByUI) {
      game.time.paused = false;
      st.pausedByUI = false;
    }
  }

  function syncCapture() {
    game.uiCapture = !game.started || anyModal();
  }

  // ---------------------------------------------------------------- screen control
  function renderBrand() {
    const inflight = st.screen === 'menu';
    setClass(screen, 'title', !inflight);
    setClass(screen, 'inflight', inflight);
    setClass(bdCanvas, 'hidden', inflight);
    setClass(tabBtns.flight, 'hidden', !inflight);
    setClass(tagline, 'hidden', inflight);
    if (inflight) {
      const sc = (api.scenarios || []).find((s) => s.id === game.scenarioId);
      overline.replaceChildren(h('span.dot'), 'Paused', h('span', null, `GET ${fmtMET(game.time.met)}`));
      titleMain.textContent = sc ? sc.title : 'Apollo 11';
      titleSub.textContent = sc ? sc.subtitle : '';
      fRestartHint.set(sc ? sc.title : '');
    } else {
      overline.replaceChildren(h('span.dot'), 'NASA', h('span', null, 'July 1969'), h('span', null, 'Mare Tranquillitatis'));
      titleMain.textContent = 'APOLLO 11';
      titleSub.textContent = 'Tranquility Base';
    }
  }

  function openScreen(kind, tab) {
    st.screen = kind;
    renderBrand();
    setClass(screen, 'open', true);
    if (kind === 'title') backdrop.start();
    else backdrop.stop();
    setTab(tab || (kind === 'menu' ? 'flight' : 'missions'), { focus: true });
    syncPause();
    syncCapture();
    if (kind === 'menu') refreshStatus();
  }

  function closeScreen() {
    if (!st.screen) return;
    st.screen = null;
    setClass(screen, 'open', false);
    backdrop.stop();
    blurUI();
    syncPause();
    syncCapture();
  }

  function setTab(id, { focus = true } = {}) {
    if (id === 'flight' && st.screen !== 'menu') id = 'missions';
    st.tab = id;
    for (const [k, b] of Object.entries(tabBtns)) {
      setClass(b, 'on', k === id);
      b.setAttribute('aria-selected', k === id ? 'true' : 'false');
    }
    for (const [k, p] of Object.entries(pages)) setClass(p, 'on', k === id);
    if (id === 'settings') settingsView.refresh();
    if (focus) {
      const target = id === 'missions' ? missions.focusTarget() : id === 'flight' ? fResume : firstFocusable(pages[id]) || tabBtns[id];
      focusEl(target);
    }
  }

  function openMenu(tab) {
    if (!game.started) return openScreen('title', tab);
    closeHelp(true);
    if (st.result) closeResult();
    openScreen('menu', tab);
  }

  function closeMenu() {
    if (st.screen === 'menu') closeScreen();
  }

  function openHelp() {
    st.help = true;
    setClass(help, 'open', true);
    syncPause();
    syncCapture();
    focusEl(helpClose);
  }

  function closeHelp(silent) {
    if (!st.help) return;
    st.help = false;
    setClass(help, 'open', false);
    syncPause();
    syncCapture();
    if (!silent && st.screen) setTab(st.tab);
    else if (!silent) blurUI();
  }

  function showResult() {
    const res = game.result;
    if (!res) return;
    st.pendingResult = null;
    st.resultShown = st.resultToken;
    if (st.screen === 'menu') closeScreen();
    closeHelp(true);
    const focusBtn = result.fill(res, game);
    st.result = true;
    setClass(result.el, 'open', true);
    syncCapture();
    focusEl(focusBtn);
  }

  function closeResult() {
    if (!st.result) return;
    st.result = false;
    setClass(result.el, 'open', false);
    syncCapture();
    blurUI();
  }

  function startScenario(id) {
    // let the sim own the pause state of the new mission
    st.pausedByUI = false;
    closeHelp(true);
    closeResult();
    api.startScenario(id);
    closeScreen();
  }

  function restart() {
    st.pausedByUI = false;
    closeScreen();
    closeResult();
    if (game.scenarioId) game.events.emit('action', { name: 'RESTART' });
  }

  function onSettingChanged(key) {
    if (key === 'hud' || key === '*') hud.el.classList.toggle('off', !game.settings.hud);
  }

  // ---------------------------------------------------------------- focus & keyboard navigation
  function focusable(container) {
    return [...container.querySelectorAll('button, input[type=range], [tabindex="0"]')].filter((e) => !e.disabled && e.offsetParent !== null && getComputedStyle(e).visibility !== 'hidden');
  }
  function firstFocusable(container) {
    return focusable(container)[0] || null;
  }
  function focusEl(el) {
    if (!el) return;
    try {
      el.focus({ preventScroll: false });
    } catch {
      /* ignore */
    }
  }
  function blurUI() {
    const a = document.activeElement;
    if (a && root.contains(a) && typeof a.blur === 'function') a.blur();
    try {
      document.getElementById('scene')?.focus({ preventScroll: true });
    } catch {
      /* ignore */
    }
  }

  function activeLayer() {
    if (st.help) return help;
    if (st.result) return result.el;
    if (st.screen) return screen;
    return null;
  }

  /** Move the focus to the nearest focusable element in direction (dx, dy). */
  function spatialNav(layer, dx, dy) {
    const items = focusable(layer);
    if (!items.length) return;
    const cur = document.activeElement;
    // nothing (visible) focused in this layer yet: start from the active tab / first control
    if (!cur || cur === document.body || !layer.contains(cur) || cur.offsetParent === null) {
      focusEl(layer === screen ? (st.tab === 'missions' ? missions.focusTarget() : tabBtns[st.tab]) : items[0]);
      return;
    }
    const a = cur.getBoundingClientRect();
    const ax = a.left + a.width / 2;
    const ay = a.top + a.height / 2;
    // pass 0: only elements entirely beyond the current one in the travel direction;
    // pass 1 (fallback): any element whose centre lies that way
    let best = null;
    for (let pass = 0; pass < 2 && !best; pass++) {
      let bestScore = Infinity;
      for (const el of items) {
        if (el === cur) continue;
        const b = el.getBoundingClientRect();
        const bx = b.left + b.width / 2;
        const by = b.top + b.height / 2;
        let along; // edge-to-edge gap along the travel direction
        let across; // misalignment across it
        if (dy) {
          along = dy > 0 ? b.top - a.bottom : a.top - b.bottom;
          if (pass === 0 ? along < -4 : (dy > 0 ? by - ay : ay - by) <= 2) continue;
          const overlap = Math.min(a.right, b.right) - Math.max(a.left, b.left);
          across = overlap > 0 ? 0 : Math.abs(bx - ax);
        } else {
          along = dx > 0 ? b.left - a.right : a.left - b.right;
          if (pass === 0 ? along < -4 : (dx > 0 ? bx - ax : ax - bx) <= 2) continue;
          const overlap = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
          across = overlap > 0 ? 0 : Math.abs(by - ay);
        }
        const score = Math.max(0, along) + across * 2.5;
        if (score < bestScore) {
          bestScore = score;
          best = el;
        }
      }
    }
    // entering the tab row from the page lands on the active tab (focusing a tab switches pages)
    if (best && best.dataset.tab && !cur.dataset.tab && tabBtns[st.tab] && !tabBtns[st.tab].classList.contains('hidden')) best = tabBtns[st.tab];
    if (best) focusEl(best);
  }

  function onKeyDown(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const layer = activeLayer();
    if (!layer) return;
    const code = e.code;
    if (!game.started) {
      // the input module ignores keys on the title screen: Esc / F1 are ours
      if (code === 'Escape') {
        e.preventDefault();
        if (st.help) closeHelp();
        else if (st.tab !== 'missions') setTab('missions');
        return;
      }
      if (code === 'F1' || e.key === '?') {
        e.preventDefault();
        if (st.help) closeHelp();
        else openHelp();
        return;
      }
    }
    const ae = document.activeElement;
    const onRange = ae && ae.tagName === 'INPUT' && ae.type === 'range';
    const dirs = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
    if (dirs[code]) {
      if (onRange && (code === 'ArrowLeft' || code === 'ArrowRight')) return; // slider adjusts itself
      e.preventDefault();
      spatialNav(layer, ...dirs[code]);
    }
  }
  window.addEventListener('keydown', onKeyDown);

  // ---------------------------------------------------------------- events
  game.events.on('action', (a) => {
    switch (a?.name) {
      case 'MENU':
        if (st.help) closeHelp();
        else if (st.result) closeResult();
        else if (st.screen === 'menu') {
          if (st.tab !== 'flight') setTab('flight');
          else closeMenu();
        } else if (st.screen === 'title') {
          if (st.tab !== 'missions') setTab('missions');
        } else openMenu('flight');
        break;
      case 'HELP':
        if (st.help) closeHelp();
        else openHelp();
        break;
      case 'TOGGLE_HUD':
        game.settings.hud = !game.settings.hud;
        saveSettings(game.settings);
        settingsView.refresh();
        ticker.message({ text: game.settings.hud ? 'HUD on' : 'HUD off — Tab to show it again', level: 'info', duration: 1.8 });
        break;
      case 'TOGGLE_UNITS':
        game.settings.units = game.settings.units === 'metric' ? 'imperial' : 'metric';
        saveSettings(game.settings);
        settingsView.refresh();
        ticker.message({ text: game.settings.units === 'metric' ? 'Units: metric (m, m/s)' : 'Units: imperial (ft, ft/s — as on Apollo)', level: 'info', duration: 2 });
        break;
      default:
        break;
    }
  });

  game.events.on('message', (m) => {
    // the pause banner and the clock already say it
    if (m && (m.text === 'Paused' || m.text === 'Resumed')) return;
    ticker.message(m);
  });
  game.events.on('callout', (c) => ticker.callout(c));

  const scheduleResult = (outcome) => {
    if (st.resultShown === st.resultToken) return;
    st.pendingResult = { at: performance.now() + (RESULT_DELAY_MS[outcome] ?? 3000), token: st.resultToken };
  };
  game.events.on('touchdown', (p) => scheduleResult(p?.outcome || game.result?.outcome || 'landed'));
  game.events.on('crash', (p) => scheduleResult(p?.outcome || 'crashed'));
  game.events.on('scenario', () => {
    st.resultToken++;
    st.pendingResult = null;
    st.pausedByUI = false;
    closeResult();
    ticker.clear();
    if (st.screen === 'title') closeScreen();
  });

  // ---------------------------------------------------------------- in-flight menu status
  function refreshStatus() {
    const v = game.active;
    if (!v) return;
    const units = game.settings.units;
    const a = fmtAlt(v.type === 'LM' && Number.isFinite(v.tel.gearAltitude) ? v.tel.gearAltitude : v.tel.altitude, units);
    fStatus.Vessel.set(v.name);
    fStatus.Program.set(`${v.gnc.program} ${PROGRAM_NAMES[v.gnc.program] ? '· ' + PROGRAM_NAMES[v.gnc.program].toLowerCase() : ''}`.trim());
    fStatus.Altitude.set(`${a.v} ${a.u.toLowerCase()}`);
    fStatus.Propellant.set(fmtPct(v.tel.fuelFraction));
    fStatus.GET.set(fmtMET(game.time.met));
    fStatus.Warp.set(st.pausedByUI ? `${game.time.warp}×` : fmtWarp(game.time));
  }

  // initial screen
  if (!game.started) openScreen('title', 'missions');
  syncCapture();

  // ---------------------------------------------------------------- per-frame update
  function update(frame) {
    const now = performance.now();
    if (game.started && st.screen === 'title') closeScreen();
    if (!game.started && !st.screen) openScreen('title', 'missions');

    // a landing/crash result waits a moment so the pilot sees (and hears) it happen
    if (st.pendingResult && now >= st.pendingResult.at) {
      if (st.pendingResult.token !== st.resultToken || !game.result) st.pendingResult = null;
      else if (!st.screen && !st.help) showResult();
    }

    const iva = game.view.mode === 'iva';
    const hudOn = game.started && !!game.settings.hud && !st.screen;
    hud.update(frame, hudOn);
    markers?.update(hudOn && !iva);
    ticker.update();
    setClass(ticker.el, 'hidden', !game.started || st.screen === 'title');
    setClass(ticker.el, 'iva', iva || !game.settings.hud);
    setClass(pauseBar, 'hidden', !(game.started && game.time.paused && !anyModal()));

    if (st.screen === 'menu') {
      st.statusT -= frame?.dt ?? 0.016;
      if (st.statusT <= 0) {
        st.statusT = 0.25;
        refreshStatus();
      }
    }
    syncCapture();
  }

  return {
    update,
    openMenu,
    closeMenu,
    openHelp,
    closeHelp,
    showResult,
    /** Finish the title backdrop synchronously (screenshots). */
    finishBackdrop: () => backdrop.finish(),
    get state() {
      return { ...st };
    },
  };
}
