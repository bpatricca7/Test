// Touch & controls helpers:
//  - joystick feel: a dead zone and a smooth response curve, look speed from Settings
//    (profile.settings.lookSpeed) for mouse and touch alike, a decorated joystick ring
//  - "How to play" panel ('help', action 'help', H or ? key): pictures of keys, mouse and taps
//  - a friendly first-time tutorial (5 bubbles, once per profile; action 'tutorial' replays it)

import { icon2, button2 } from './menus/icons2.js';

const DEAD_ZONE = 0.16; // share of the joystick radius that does nothing
const CURVE = 1.35; // >1: gentle near the middle, full speed at the rim

const CSS = /* css */ `
/* joystick decoration */
.sw-joy::before { content: ''; position: absolute; inset: 14px; border-radius: 50%; border: 3px dashed rgba(255,255,255,.7); }
.sw-joy-arrow { position: absolute; width: 0; height: 0; border: 9px solid transparent; opacity: .85; }
.sw-joy-arrow.sw-up { left: 50%; top: 3px; margin-left: -9px; border-bottom: 11px solid #fff; border-top: 0; }
.sw-joy-arrow.sw-down { left: 50%; bottom: 3px; margin-left: -9px; border-top: 11px solid #fff; border-bottom: 0; }
.sw-joy-arrow.sw-left { top: 50%; left: 3px; margin-top: -9px; border-right: 11px solid #fff; border-left: 0; }
.sw-joy-arrow.sw-right { top: 50%; right: 3px; margin-top: -9px; border-left: 11px solid #fff; border-right: 0; }
.sw-joy-label { position: absolute; left: 50%; top: calc(100% + 6px); transform: translateX(-50%); font: 700 15px var(--sw-font); color: var(--sw-ink); background: rgba(255,255,255,.9); padding: 1px 10px; border-radius: 999px; box-shadow: 0 2px 6px var(--sw-shadow); white-space: nowrap; }
.sw-joy.active .sw-joy-label { opacity: 0; }
.sw-joy.active { border-color: #fff; box-shadow: 0 0 0 6px rgba(255,95,162,.25), 0 6px 18px var(--sw-shadow); }
.sw-joy-thumb { transition: box-shadow .15s; }
.sw-joy.active .sw-joy-thumb { box-shadow: 0 0 16px 4px rgba(255,95,162,.55), 0 4px 12px var(--sw-shadow); }

/* help panel */
.sw-help-tabs { display: flex; gap: 10px; justify-content: center; margin-bottom: 14px; flex-wrap: wrap; }
.sw-help-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px; }
.sw-help-card { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; padding: 12px 8px 10px; border-radius: 22px; background: #fff; border: 3px solid var(--sw-lav-soft); box-shadow: 0 3px 8px rgba(58,31,77,.08); min-height: 112px; }
.sw-help-keys { display: flex; gap: 5px; align-items: center; justify-content: center; flex-wrap: wrap; min-height: 48px; }
.sw-help-keys .sw-or { font-size: 14px; font-weight: 700; color: var(--sw-lav); }
.sw-key { display: inline-grid; place-items: center; min-width: 42px; height: 42px; padding: 0 8px; border-radius: 11px; background: linear-gradient(#FFFFFF, #F4EFFF); border: 3px solid #D9CCFF; border-bottom-width: 6px; font: 700 18px var(--sw-font); color: var(--sw-ink); box-shadow: 0 2px 4px rgba(58,31,77,.12); }
.sw-key.sw-wide { min-width: 110px; font-size: 16px; }
.sw-wasd { display: grid; grid-template-columns: repeat(3, 42px); gap: 4px; }
.sw-wasd .sw-key { height: 36px; min-width: 0; }
.sw-key.sw-mid { min-width: 64px; font-size: 15px; }
.sw-help-pic { width: 64px; height: 64px; }
.sw-help-label { font-size: 18px; font-weight: 700; color: var(--sw-ink); text-align: center; line-height: 1.1; }
.sw-help-foot { display: flex; justify-content: center; gap: 10px; margin-top: 16px; flex-wrap: wrap; }

/* tutorial */
.sw-tut { position: absolute; inset: 0; pointer-events: none !important; z-index: 6; }
.sw-tut[hidden] { display: none; }
.sw-tut-card { position: absolute; left: 0; right: 0; margin: 0 auto; top: calc(86px + var(--sw-safe-t)); width: min(430px, calc(100vw - 32px)); display: flex; align-items: center; gap: 12px; padding: 12px 14px 12px 12px; border-radius: 26px; background: #fff; border: 5px solid var(--sw-sun); box-shadow: 0 8px 24px rgba(58,31,77,.3); pointer-events: auto; animation: sw-pop .4s var(--sw-bounce); }
.sw-tut-card.sw-yay { animation: sw-yay .6s var(--sw-bounce); border-color: var(--sw-mint); }
@keyframes sw-yay { 0% { transform: scale(1); } 35% { transform: scale(1.08) rotate(-2deg); } 100% { transform: scale(1); } }
.sw-tut-ic { flex: none; width: 58px; height: 58px; border-radius: 50%; display: grid; place-items: center; background: var(--sw-pink); color: #fff; border: 4px solid #fff; box-shadow: 0 3px 8px var(--sw-shadow); }
.sw-tut-ic svg { width: 32px; height: 32px; }
.sw-tut-main { flex: 1; min-width: 0; }
.sw-tut-text { font-size: 21px; font-weight: 700; color: var(--sw-ink); line-height: 1.15; }
.sw-tut-keys { display: flex; gap: 4px; margin-top: 6px; }
.sw-tut-keys .sw-key { min-width: 34px; height: 34px; font-size: 16px; border-radius: 9px; }
.sw-tut-dots { display: flex; gap: 5px; margin-top: 7px; }
.sw-tut-dots span { width: 10px; height: 10px; border-radius: 50%; background: var(--sw-lav-soft); }
.sw-tut-dots span.sw-on { background: var(--sw-pink); }
.sw-tut-btns { display: flex; flex-direction: column; gap: 6px; flex: none; }
.sw-tut-btns .sw-btn { min-height: 44px; padding: 4px 14px; font-size: 16px; border-width: 3px; }
.sw-tut-skip.sw-btn { min-height: 34px; font-size: 13px; padding: 2px 10px; }
.sw-tut-ring { position: absolute; border-radius: 50%; border: 5px solid var(--sw-sun); box-shadow: 0 0 0 5px rgba(255,201,77,.35), 0 0 22px 6px rgba(255,201,77,.6); pointer-events: none; animation: sw-ring 1.1s ease-in-out infinite; }
.sw-tut-ring[hidden] { display: none; }
@keyframes sw-ring { 0%, 100% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.12); opacity: .75; } }
@media (max-width: 480px) {
  /* phones: keep clear of the tool buttons on the right; buttons go under the words */
  .sw-tut-card { top: calc(112px + var(--sw-safe-t)); left: 10px; right: auto; margin: 0; width: calc(100vw - 112px); flex-wrap: wrap; gap: 8px; padding: 9px 10px 9px 9px; border-width: 4px; }
  .sw-tut-main { flex-basis: calc(100% - 56px); }
  .sw-tut-btns { flex-basis: 100%; flex-direction: row; justify-content: flex-end; }
  .sw-tut-btns .sw-btn { min-height: 40px; font-size: 15px; padding: 3px 12px; }
  .sw-tut-ic { width: 46px; height: 46px; }
  .sw-tut-ic svg { width: 26px; height: 26px; }
  .sw-tut-text { font-size: 17px; }
  .sw-help-grid { grid-template-columns: 1fr 1fr; gap: 8px; }
  .sw-help-label { font-size: 15px; }
  .sw-key.sw-wide { min-width: 80px; }
}
`;

// small pictures for the help cards (SVG, 64x64)
const PICS = {
  mouseLeft: '<svg viewBox="0 0 64 64" class="sw-help-pic"><rect x="16" y="6" width="32" height="52" rx="16" fill="#fff" stroke="#9C7BFF" stroke-width="4"/><path d="M18 26V22a14 14 0 0 1 14-14v18Z" fill="#FF5FA2"/><path d="M32 8v18M18 26h28" stroke="#9C7BFF" stroke-width="3"/></svg>',
  mouseRight: '<svg viewBox="0 0 64 64" class="sw-help-pic"><rect x="16" y="6" width="32" height="52" rx="16" fill="#fff" stroke="#9C7BFF" stroke-width="4"/><path d="M46 26V22a14 14 0 0 0-14-14v18Z" fill="#FF7A7A"/><path d="M32 8v18M18 26h28" stroke="#9C7BFF" stroke-width="3"/></svg>',
  mouseDrag: '<svg viewBox="0 0 64 64" class="sw-help-pic"><rect x="20" y="12" width="24" height="40" rx="12" fill="#fff" stroke="#9C7BFF" stroke-width="4"/><path d="M32 13v13M21 26h22" stroke="#9C7BFF" stroke-width="3"/><path d="M4 32h10M50 32h10M8 27l-5 5 5 5M56 27l5 5-5 5" fill="none" stroke="#FF5FA2" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  mouseWheel: '<svg viewBox="0 0 64 64" class="sw-help-pic"><rect x="16" y="6" width="32" height="52" rx="16" fill="#fff" stroke="#9C7BFF" stroke-width="4"/><rect x="28" y="14" width="8" height="14" rx="4" fill="#3FD8B0"/><path d="M32 4v-2M32 36v4" stroke="#9C7BFF" stroke-width="3"/></svg>',
  joystick: '<svg viewBox="0 0 64 64" class="sw-help-pic"><circle cx="32" cy="32" r="27" fill="#FFE6F3" stroke="#fff" stroke-width="4"/><circle cx="32" cy="32" r="19" fill="none" stroke="#FFB8D6" stroke-width="3" stroke-dasharray="5 5"/><circle cx="40" cy="26" r="11" fill="#FF5FA2" stroke="#fff" stroke-width="4"/></svg>',
  swipe: '<svg viewBox="0 0 64 64" class="sw-help-pic"><path d="M8 20h44M44 12l8 8-8 8" fill="none" stroke="#6CC6FF" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/><path d="M27 60c-4-6-9-9-9-13 0-2 2-4 5-3l5 4V30a3.5 3.5 0 0 1 7 0v10l9 2c3 .7 5 3 4.5 6L47 60Z" fill="#FFD9C2" stroke="#3A1F4D" stroke-width="2.5" stroke-linejoin="round"/></svg>',
  tap: '<svg viewBox="0 0 64 64" class="sw-help-pic"><circle cx="31" cy="18" r="12" fill="none" stroke="#FFC94D" stroke-width="4"/><circle cx="31" cy="18" r="5" fill="#FFC94D"/><path d="M26 62c-4-6-9-9-9-13 0-2 2-4 5-3l5 4V20a3.5 3.5 0 0 1 7 0v16l9 2c3 .7 5 3 4.5 6L46 62Z" fill="#FFD9C2" stroke="#3A1F4D" stroke-width="2.5" stroke-linejoin="round"/></svg>',
  hold: '<svg viewBox="0 0 64 64" class="sw-help-pic"><rect x="6" y="8" width="11" height="11" rx="2" fill="#FF8CC6"/><rect x="19" y="8" width="11" height="11" rx="2" fill="#FF8CC6"/><rect x="32" y="8" width="11" height="11" rx="2" fill="#FF8CC6" opacity=".6"/><rect x="45" y="8" width="11" height="11" rx="2" fill="#FF8CC6" opacity=".3"/><path d="M24 62c-4-6-9-9-9-13 0-2 2-4 5-3l5 4V28a3.5 3.5 0 0 1 7 0v12l9 2c3 .7 5 3 4.5 6L44 62Z" fill="#FFD9C2" stroke="#3A1F4D" stroke-width="2.5" stroke-linejoin="round"/></svg>',
  pinch: '<svg viewBox="0 0 64 64" class="sw-help-pic"><path d="M6 6l14 14M58 58L44 44M6 6h9M6 6v9M58 58h-9M58 58v-9" fill="none" stroke="#3FD8B0" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="24" cy="24" r="7" fill="#FFD9C2" stroke="#3A1F4D" stroke-width="2.5"/><circle cx="40" cy="40" r="7" fill="#FFD9C2" stroke="#3A1F4D" stroke-width="2.5"/></svg>',
};

export function install(game) {
  const ui = game.ui;
  const input = game.input;
  ui.addStyles(CSS);

  // =====================================================================================
  // joystick feel + look speed (post-process the input state every frame, before the
  // player and camera read it)
  // =====================================================================================
  const origUpdate = input.update.bind(input);
  input.update = function updateWithFeel() {
    origUpdate();
    if (!input.enabled) return;
    const s = game.profile.settings;
    const k = typeof s.lookSpeed === 'number' ? s.lookSpeed : 1;
    if (k !== 1) {
      input.look.dx *= k;
      input.look.dy *= k;
    }
    const j = input.joy;
    if (j && j.active) {
      const r = Math.hypot(j.x, j.z);
      if (r < DEAD_ZONE) {
        input.move.x = 0;
        input.move.z = 0;
      } else {
        const m = Math.min(1, (r - DEAD_ZONE) / (0.9 - DEAD_ZONE));
        const out = Math.pow(m, CURVE);
        input.move.x = (j.x / r) * out;
        input.move.z = (j.z / r) * out;
      }
    }
  };

  // joystick decoration (the ring itself is built by core input.js)
  if (input.joyBase) {
    for (const dir of ['up', 'down', 'left', 'right']) input.joyBase.appendChild(ui.el('span', `sw-joy-arrow sw-${dir}`));
    input.joyBase.appendChild(ui.el('span', 'sw-joy-label', 'Walk'));
  }

  // =====================================================================================
  // help panel
  // =====================================================================================
  let helpBody, helpMode = 'keys', helpFromPause = false;
  const key = (t, cls = '') => `<span class="sw-key ${cls}">${t}</span>`;
  const KEY_CARDS = [
    [[`<span class="sw-wasd"><span></span>${key('W')}<span></span>${key('A')}${key('S')}${key('D')}</span>`], 'Walk'],
    [[key('Space', 'sw-wide')], 'Jump'],
    [[key('Shift', 'sw-mid')], 'Run or go down'],
    [[key('F')], 'Fly on / off'],
    [[key('1'), '<span class="sw-or">to</span>', key('9')], 'Pick from your hotbar'],
    [[key('B')], 'Open the Bag'],
    [[key('R')], 'Build'],
    [[key('Q')], 'Remove'],
    [[key('E')], 'Use it (Hand)'],
    [[key('Z')], 'Undo'],
    [[key('V')], 'Camera'],
    [[key('P')], 'Take a photo'],
    [[key('G')], 'Dance and wave'],
    [[key('←'), key('→')], 'Turn around'],
    [[key('Esc', 'sw-mid')], 'Menu'],
    [[PICS.mouseLeft], 'Click to build or use'],
    [[PICS.mouseRight], 'Right click to remove'],
    [[PICS.mouseDrag], 'Drag to look around'],
    [[PICS.mouseWheel], 'Scroll to zoom'],
  ];
  const TOUCH_CARDS = [
    [PICS.joystick, 'Walk with the joystick'],
    [PICS.swipe, 'Slide to look around'],
    [PICS.tap, 'Tap to build or use'],
    [PICS.hold, 'Hold still, then slide to build a line'],
    [PICS.pinch, 'Pinch to zoom'],
    [`<span class="sw-help-pic" style="display:grid;place-items:center;color:#3FD8B0">${icon2('jump', { size: 56 })}</span>`, 'Jump button'],
    [`<span class="sw-help-pic" style="display:grid;place-items:center;color:#6CC6FF">${icon2('fly', { size: 56 })}</span>`, 'Fly button, then Up and Down'],
    [`<span class="sw-help-pic" style="display:grid;place-items:center;color:#FF5FA2">${icon2('bag', { size: 56 })}</span>`, 'Bag: pick what to build'],
  ];

  const renderHelp = () => {
    helpBody.innerHTML = '';
    const tabs = ui.el('div', 'sw-help-tabs');
    tabs.append(
      button2(ui, { icon: 'keyboard', label: 'Keys & mouse', variant: helpMode === 'keys' ? 'lav' : 'white', size: 'small', onClick: () => { helpMode = 'keys'; renderHelp(); } }),
      button2(ui, { icon: 'tap', label: 'Touch', variant: helpMode === 'touch' ? 'lav' : 'white', size: 'small', onClick: () => { helpMode = 'touch'; renderHelp(); } }),
    );
    const grid = ui.el('div', 'sw-help-grid');
    if (helpMode === 'keys') {
      for (const [keys, label] of KEY_CARDS) {
        const c = ui.el('div', 'sw-help-card');
        const k = ui.el('div', 'sw-help-keys');
        k.innerHTML = keys.join('');
        c.append(k, ui.el('div', 'sw-help-label', label));
        grid.appendChild(c);
      }
    } else {
      for (const [pic, label] of TOUCH_CARDS) {
        const c = ui.el('div', 'sw-help-card');
        const k = ui.el('div', 'sw-help-keys');
        k.innerHTML = pic;
        c.append(k, ui.el('div', 'sw-help-label', label));
        grid.appendChild(c);
      }
    }
    const foot = ui.el('div', 'sw-help-foot');
    if (game.world) foot.appendChild(button2(ui, { icon: 'sparkles', label: 'Show tips again', variant: 'sun', size: 'small', onClick: () => { ui.close(); startTutorial(true); } }));
    foot.appendChild(button2(ui, { icon: 'check', label: 'Got it!', variant: 'mint', size: 'small', onClick: () => ui.back() }));
    helpBody.append(tabs, grid, foot);
  };

  ui.registerPanel('help', {
    title: 'How to play',
    icon: 'help',
    width: 900,
    back: (g) => (g.mode === 'title' ? 'title' : helpFromPause ? 'pause' : null),
    build(container) { helpBody = container; },
    onOpen() {
      helpMode = input.touchMode ? 'touch' : 'keys';
      renderHelp();
    },
  });
  game.registerAction('help', (g) => {
    helpFromPause = g.ui.current === 'pause';
    if (g.ui.isOpen('help')) g.ui.back();
    else g.ui.open('help');
  });
  input.on('key', (e) => {
    if (!e.down || e.repeat || ui.dialogOpen) return;
    if (e.code === 'KeyH' || e.key === '?') {
      if (ui.current && ui.current !== 'help' && ui.current !== 'title' && ui.current !== 'pause') return;
      game.runAction('help');
    }
  });

  // =====================================================================================
  // first-time tutorial
  // =====================================================================================
  const tut = ui.el('div', 'sw-tut');
  tut.hidden = true;
  const ring = ui.el('div', 'sw-tut-ring');
  ring.hidden = true;
  const card = ui.el('div', 'sw-tut-card');
  const cardIc = ui.el('div', 'sw-tut-ic');
  const cardMain = ui.el('div', 'sw-tut-main');
  const cardText = ui.el('div', 'sw-tut-text');
  const cardKeys = ui.el('div', 'sw-tut-keys');
  const cardDots = ui.el('div', 'sw-tut-dots');
  cardMain.append(cardText, cardKeys, cardDots);
  const btns = ui.el('div', 'sw-tut-btns');
  const nextBtn = button2(ui, { icon: 'arrow', label: 'Next', variant: 'pink', className: 'sw-tut-next', onClick: () => advance(true) });
  const skipBtn = button2(ui, { icon: 'close', label: 'Skip tips', variant: 'white', className: 'sw-tut-skip', onClick: () => finishTutorial() });
  btns.append(nextBtn, skipBtn);
  card.append(cardIc, cardMain, btns);
  tut.append(ring, card);
  ui.hudLayer.appendChild(tut);

  const hudBtn = (label) => ui.hudLayer.querySelector(`.sw-hud .sw-round[aria-label="${label}"]`);
  const STEPS = [
    {
      id: 'walk', icon: 'joystick', color: 'var(--sw-pink)',
      text: () => (input.touchMode ? 'Walk with the joystick!' : 'Walk with these keys!'),
      keys: () => (input.touchMode ? null : ['W', 'A', 'S', 'D']),
      target: () => (input.touchMode ? input.joyBase : null),
    },
    {
      id: 'build', icon: 'build', color: '#FF5FA2',
      text: () => (input.touchMode ? 'Tap the ground to build!' : 'Click the ground to build!'),
      target: () => hudBtn('Build'),
    },
    { id: 'bag', icon: 'bag', color: 'var(--sw-lav)', text: () => 'Pick new things in your Bag!', target: () => ui.hudLayer.querySelector('.sw-bagbtn') },
    { id: 'hand', icon: 'hand', color: 'var(--sw-mint)', text: () => 'Use the Hand to sit, sleep and play!', target: () => hudBtn('Hand') },
    { id: 'save', icon: 'heart', color: 'var(--sw-sun)', text: () => 'Your world saves by itself!', target: () => null, last: true },
  ];
  let stepIdx = -1, stepDone = false, walkFrom = null, ringTimer = 0, running = false, doneTimer = 0;

  const showStep = () => {
    const st = STEPS[stepIdx];
    stepDone = false;
    card.classList.remove('sw-yay');
    card.style.animation = 'none';
    void card.offsetWidth;
    card.style.animation = '';
    cardIc.style.background = st.color;
    cardIc.innerHTML = icon2(st.icon);
    cardText.textContent = st.text();
    const keys = st.keys ? st.keys() : null;
    cardKeys.innerHTML = keys ? keys.map((k) => key(k)).join('') : '';
    cardKeys.hidden = !keys;
    cardDots.innerHTML = STEPS.map((_, i) => `<span class="${i <= stepIdx ? 'sw-on' : ''}"></span>`).join('');
    nextBtn.querySelector('.sw-btn-label').textContent = st.last ? 'Got it!' : 'Next';
    skipBtn.hidden = !!st.last;
    if (st.id === 'walk' && game.player) walkFrom = game.player.position.clone();
    ringTimer = 0;
    if (game.speak) game.speak(st.text());
  };

  const advance = (manual = false) => {
    clearTimeout(doneTimer);
    if (stepIdx >= STEPS.length - 1) { finishTutorial(); return; }
    if (!manual) game.audio.play('sparkle');
    stepIdx++;
    showStep();
  };

  /** The player did the thing: a happy wiggle, then the next bubble. */
  const complete = (id) => {
    if (!running || stepDone || STEPS[stepIdx].id !== id) return;
    stepDone = true;
    card.classList.add('sw-yay');
    cardText.textContent = ['Yay!', 'Great job!', 'You did it!', 'Super!'][stepIdx % 4];
    game.audio.play('chime');
    doneTimer = setTimeout(() => advance(false), 1100);
  };

  function startTutorial(force = false) {
    if (!game.world || (!force && game.profile.tutorialDone)) return;
    running = true;
    stepIdx = -1;
    tut.hidden = false;
    advance(true);
  }

  function finishTutorial() {
    clearTimeout(doneTimer);
    running = false;
    tut.hidden = true;
    ring.hidden = true;
    if (!game.profile.tutorialDone) {
      game.profile.tutorialDone = true;
      game.saveProfile();
    }
  }

  game.registerAction('tutorial', () => startTutorial(true));
  game.events.on('world:load', () => {
    // automated test browsers (navigator.webdriver) skip the automatic tips; the 'tutorial'
    // action still shows them
    const bot = typeof navigator !== 'undefined' && navigator.webdriver;
    if (!game.profile.tutorialDone && !bot) setTimeout(() => { if (game.mode === 'play' && !running) startTutorial(); }, 1400);
  });
  game.events.on('world:unload', () => { running = false; tut.hidden = true; clearTimeout(doneTimer); });
  game.events.on('block:place', () => complete('build'));
  game.events.on('entity:place', () => complete('build'));
  game.events.on('ui:open', ({ panel }) => { if (panel === 'bag') complete('bag'); });
  game.events.on('tool:change', ({ tool }) => { if (tool === 'hand') complete('hand'); });
  game.events.on('entity:use', () => complete('hand'));

  game.addSystem({
    name: 'tutorial',
    update(dt) {
      if (!running) return;
      const show = game.mode === 'play' && !game.paused;
      tut.hidden = !show;
      if (!show) return;
      const st = STEPS[stepIdx];
      if (st.id === 'walk' && walkFrom && game.player && !stepDone) {
        const p = game.player.position;
        if (Math.hypot(p.x - walkFrom.x, p.z - walkFrom.z) > 2.5) complete('walk');
      }
      ringTimer -= dt;
      if (ringTimer > 0) return;
      ringTimer = 0.25;
      const el = st.target();
      if (!el || !el.offsetParent) {
        ring.hidden = true;
        return;
      }
      const face = el.querySelector('.sw-round-face') || el;
      const r = face.getBoundingClientRect();
      const root = ui.root.getBoundingClientRect();
      const size = Math.max(r.width, r.height) + 22;
      ring.hidden = false;
      ring.style.width = ring.style.height = `${size}px`;
      ring.style.left = `${r.left - root.left + r.width / 2 - size / 2}px`;
      ring.style.top = `${r.top - root.top + r.height / 2 - size / 2}px`;
    },
  });
}
