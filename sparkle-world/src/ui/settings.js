// Settings panel ('settings'): music & sound sliders, a Quiet switch, "Read words out loud"
// (speechSynthesis for toasts and hints), camera (behind me / my eyes), look speed, picture
// quality (Pretty / Fast; the picture is never made less sharp unless she picks Fast),
// the weather wand (game.weather, when present), time of day + freeze time, and the player's
// name. Everything is saved in profile.settings (the name in profile.playerName + look.name).
// Also runs the music mood: menu on the title, cozy under a roof, else day / night.

import { clamp } from '../core/util.js';
import { icon2, button2 } from './menus/icons2.js';

const CSS = /* css */ `
.sw-set { display: flex; flex-direction: column; gap: 12px; }
.sw-set-row { display: flex; align-items: center; gap: 14px; padding: 10px 14px; border-radius: 22px; background: #fff; border: 3px solid var(--sw-lav-soft); box-shadow: 0 3px 8px rgba(58,31,77,.08); }
.sw-set-row[hidden] { display: none; }
.sw-set-ic { flex: none; width: 52px; height: 52px; border-radius: 50%; display: grid; place-items: center; color: #fff; background: var(--c, var(--sw-pink)); border: 3px solid #fff; box-shadow: 0 3px 8px var(--sw-shadow); }
.sw-set-ic svg { width: 30px; height: 30px; }
.sw-set-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6px; }
.sw-set-title { font-size: 19px; font-weight: 700; color: var(--sw-ink); display: flex; align-items: center; gap: 8px; }
.sw-set-note { font-size: 14px; font-weight: 600; color: var(--sw-lav); }
.sw-set-line { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.sw-range-wrap { display: flex; align-items: center; gap: 10px; }
.sw-range-wrap > svg { width: 24px; height: 24px; color: var(--sw-lav); flex: none; }
.sw-range { -webkit-appearance: none; appearance: none; flex: 1; min-width: 80px; height: 44px; background: transparent; cursor: pointer; margin: 0; touch-action: pan-y; }
.sw-range:focus { outline: none; }
.sw-range::-webkit-slider-runnable-track { height: 18px; border-radius: 999px; background: linear-gradient(90deg, var(--fill, var(--sw-pink)) 0 var(--v, 50%), var(--sw-lav-soft) var(--v, 50%) 100%); box-shadow: inset 0 2px 0 rgba(58,31,77,.08); }
.sw-range::-moz-range-track { height: 18px; border-radius: 999px; background: var(--sw-lav-soft); }
.sw-range::-moz-range-progress { height: 18px; border-radius: 999px; background: var(--fill, var(--sw-pink)); }
.sw-range::-webkit-slider-thumb { -webkit-appearance: none; width: 40px; height: 40px; margin-top: -11px; border-radius: 50%; background: #fff; border: 5px solid var(--fill, var(--sw-pink)); box-shadow: 0 3px 8px var(--sw-shadow); }
.sw-range::-moz-range-thumb { width: 32px; height: 32px; border-radius: 50%; background: #fff; border: 5px solid var(--fill, var(--sw-pink)); box-shadow: 0 3px 8px var(--sw-shadow); }
.sw-range:focus-visible::-webkit-slider-thumb { box-shadow: 0 0 0 4px var(--sw-sun); }
.sw-seg { display: flex; gap: 8px; flex-wrap: wrap; }
.sw-seg-btn { display: inline-flex; align-items: center; gap: 6px; min-height: 48px; padding: 4px 14px 4px 10px; border-radius: 999px; border: 3px solid var(--sw-lav-soft); background: var(--sw-cream); color: var(--sw-ink); font-family: var(--sw-font); font-size: 17px; font-weight: 700; cursor: pointer; transition: transform .16s var(--sw-bounce); touch-action: manipulation; }
.sw-seg-btn svg { width: 24px; height: 24px; color: var(--sw-lav); }
.sw-seg-btn:active { transform: scale(.93); }
.sw-seg-btn.sw-sel { background: var(--c, var(--sw-lav)); border-color: #fff; color: #fff; box-shadow: 0 0 0 3px var(--c, var(--sw-lav)), 0 4px 10px var(--sw-shadow); text-shadow: 0 2px 0 rgba(58,31,77,.15); }
.sw-seg-btn.sw-sel svg { color: #fff; }
.sw-switch { position: relative; flex: none; width: 92px; height: 48px; border-radius: 999px; border: 4px solid #fff; background: #DCD3EE; cursor: pointer; box-shadow: 0 3px 8px var(--sw-shadow), inset 0 3px 0 rgba(58,31,77,.08); transition: background .2s; padding: 0; font-family: var(--sw-font); }
.sw-switch::after { content: ''; position: absolute; top: 3px; left: 3px; width: 34px; height: 34px; border-radius: 50%; background: #fff; box-shadow: 0 2px 5px var(--sw-shadow); transition: transform .25s var(--sw-bounce); }
.sw-switch span { position: absolute; top: 50%; transform: translateY(-50%); font-size: 13px; font-weight: 700; color: #fff; }
.sw-switch .sw-on-t { left: 12px; opacity: 0; }
.sw-switch .sw-off-t { right: 10px; color: #8F7BBF; }
.sw-switch.sw-on { background: var(--sw-mint); }
.sw-switch.sw-on::after { transform: translateX(44px); }
.sw-switch.sw-on .sw-on-t { opacity: 1; }
.sw-switch.sw-on .sw-off-t { opacity: 0; }
.sw-set-name { font-size: 22px; font-weight: 700; color: var(--sw-pink); }
@media (max-width: 600px) {
  .sw-set-row { padding: 8px 10px; gap: 10px; align-items: flex-start; }
  .sw-set-ic { width: 42px; height: 42px; }
  .sw-set-ic svg { width: 24px; height: 24px; }
  .sw-seg-btn { font-size: 15px; min-height: 44px; padding: 3px 11px 3px 8px; }
}
`;

const WEATHER_ICONS = { sunny: 'sunny', sun: 'sunny', clear: 'sunny', cloudy: 'cloud', clouds: 'cloud', rain: 'rain', rainy: 'rain', snow: 'snow', snowy: 'snow', rainbow: 'rainbow' };
const WEATHER_LABELS = { sunny: 'Sunny', sun: 'Sunny', clear: 'Sunny', cloudy: 'Cloudy', clouds: 'Cloudy', rain: 'Rain', rainy: 'Rain', snow: 'Snow', snowy: 'Snow', rainbow: 'Rainbow' };
const TIMES = [['morning', 'Morning', 0.3], ['noon', 'Noon', 0.5], ['sunset', 'Sunset', 0.73], ['night', 'Night', 0.9]];

export function install(game) {
  const ui = game.ui;
  ui.addStyles(CSS);
  const S = () => game.profile.settings;

  // =====================================================================================
  // read words out loud
  // =====================================================================================
  const synth = typeof window !== 'undefined' && 'speechSynthesis' in window && typeof window.SpeechSynthesisUtterance === 'function' ? window.speechSynthesis : null;
  let voice = null;
  const pickVoice = () => {
    if (!synth) return;
    try {
      const voices = synth.getVoices() || [];
      const en = voices.filter((v) => /^en(-|_|$)/i.test(v.lang));
      const pref = /samantha|karen|moira|tessa|fiona|victoria|serena|zira|google us english|female/i;
      voice = en.find((v) => pref.test(v.name)) || en.find((v) => v.default) || en[0] || voices[0] || null;
    } catch { voice = null; }
  };
  if (synth) {
    pickVoice();
    try { synth.addEventListener('voiceschanged', pickVoice); } catch { /* old browsers */ }
  }
  const speak = (text, force = false) => {
    if (!synth || (!force && !S().readAloud) || !text) return;
    const clean = String(text).replace(/[^\p{L}\p{N}\s.,!?'’-]/gu, ' ').replace(/\s+/g, ' ').trim();
    if (!clean) return;
    try {
      if (synth.pending) synth.cancel();
      const u = new SpeechSynthesisUtterance(clean);
      u.rate = 0.95;
      u.pitch = 1.2;
      u.volume = clamp((S().sfx ?? 0.8) + 0.2, 0.2, 1);
      if (voice) u.voice = voice;
      synth.speak(u);
    } catch (err) {
      console.warn('[settings] speech failed', err);
    }
  };
  game.speak = speak;
  const origToast = ui.toast.bind(ui);
  ui.toast = (text, opts) => {
    origToast(text, opts);
    speak(text);
  };
  const origHint = ui.hint.bind(ui);
  let lastHint = null, lastHintAt = 0;
  ui.hint = (text, at) => {
    origHint(text, at);
    if (text === lastHint) return;
    lastHint = text;
    if (!text || !S().readAloud) return;
    const now = performance.now();
    if (now - lastHintAt < 1400) return;
    lastHintAt = now;
    speak(text);
  };

  // =====================================================================================
  // audio: mute + music mood
  // =====================================================================================
  const applyMute = () => { if (game.audio.setMuted) game.audio.setMuted(!!S().muted); };
  game.events.on('game:ready', applyMute);
  let moodTimer = 0;
  const roofed = () => {
    const p = game.player, w = game.world;
    if (!p || !w) return false;
    const x = Math.floor(p.position.x), z = Math.floor(p.position.z);
    const y0 = Math.floor(p.position.y + 1.8);
    const props = game.registry.blocks.props;
    for (let y = y0; y < Math.min(w.sy, y0 + 14); y++) {
      const id = w.get(x, y, z);
      // a real roof (opaque blocks), not the leaves of a tree
      if (id && props && props.opaque[id]) return true;
    }
    return false;
  };

  game.addSystem({
    name: 'settings',
    update(dt) {
      // music mood
      moodTimer -= dt;
      if (moodTimer <= 0 && game.audio.setMood) {
        moodTimer = 1;
        if (game.mode !== 'play' || !game.world) game.audio.setMood('menu');
        else game.audio.setMood(roofed() ? 'cozy' : null);
      }
    },
  });

  // =====================================================================================
  // panel
  // =====================================================================================
  let body;
  const save = () => game.saveProfile();

  const row = (ic, color, title, note = '') => {
    const r = ui.el('div', 'sw-set-row');
    const i = ui.el('div', 'sw-set-ic');
    i.style.setProperty('--c', color);
    i.innerHTML = icon2(ic);
    const main = ui.el('div', 'sw-set-main');
    const t = ui.el('div', 'sw-set-title', title);
    main.appendChild(t);
    if (note) main.appendChild(ui.el('div', 'sw-set-note', note));
    r.append(i, main);
    return { row: r, main };
  };

  const slider = ({ value, min = 0, max = 1, step = 0.05, fill, left = null, right = null, label, onInput, onChange }) => {
    const wrap = ui.el('div', 'sw-range-wrap');
    const input = ui.el('input', 'sw-range');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(value);
    input.setAttribute('aria-label', label);
    if (fill) input.style.setProperty('--fill', fill);
    const paint = () => input.style.setProperty('--v', `${((Number(input.value) - min) / (max - min)) * 100}%`);
    paint();
    input.addEventListener('input', () => { paint(); onInput(Number(input.value)); });
    input.addEventListener('change', () => { if (onChange) onChange(Number(input.value)); save(); });
    if (left) wrap.insertAdjacentHTML('beforeend', icon2(left));
    wrap.appendChild(input);
    if (right) wrap.insertAdjacentHTML('beforeend', icon2(right));
    return wrap;
  };

  const seg = (options, current, onPick, color) => {
    const box = ui.el('div', 'sw-seg');
    for (const [value, label, ic] of options) {
      const b = ui.el('button', 'sw-seg-btn' + (value === current ? ' sw-sel' : ''));
      b.type = 'button';
      b.dataset.value = value;
      if (color) b.style.setProperty('--c', color);
      if (ic) b.innerHTML = icon2(ic);
      b.appendChild(ui.el('span', '', label));
      b.addEventListener('click', () => {
        game.audio.play('click');
        for (const el of box.children) el.classList.toggle('sw-sel', el === b);
        onPick(value);
      });
      box.appendChild(b);
    }
    return box;
  };

  const toggle = (on, label, onFlip) => {
    const b = ui.el('button', 'sw-switch' + (on ? ' sw-on' : ''));
    b.type = 'button';
    b.setAttribute('role', 'switch');
    b.setAttribute('aria-checked', String(!!on));
    b.setAttribute('aria-label', label);
    b.append(ui.el('span', 'sw-on-t', 'On'), ui.el('span', 'sw-off-t', 'Off'));
    b.addEventListener('click', () => {
      const v = !b.classList.contains('sw-on');
      b.classList.toggle('sw-on', v);
      b.setAttribute('aria-checked', String(v));
      game.audio.play('pop', { pitch: v ? 1.2 : 0.8 });
      onFlip(v);
      save();
    });
    return b;
  };

  const render = () => {
    const s = S();
    body.innerHTML = '';
    const list = ui.el('div', 'sw-set');

    // music
    {
      const { row: r, main } = row('music', 'var(--sw-pink)', 'Music');
      main.appendChild(slider({
        value: s.music ?? 0.5, fill: 'var(--sw-pink)', left: 'mute', right: 'music', label: 'Music volume',
        onInput: (v) => {
          const was = s.music > 0;
          s.music = v;
          game.audio.setVolumes({ music: v });
          if ((v > 0) !== was) game.audio.music(v > 0);
        },
      }));
      list.appendChild(r);
    }
    // sounds
    {
      const { row: r, main } = row('sound', 'var(--sw-sky)', 'Sounds');
      main.appendChild(slider({
        value: s.sfx ?? 0.8, fill: 'var(--sw-sky)', left: 'mute', right: 'sound', label: 'Sound volume',
        onInput: (v) => { s.sfx = v; game.audio.setVolumes({ sfx: v }); },
        onChange: () => game.audio.play('pop'),
      }));
      list.appendChild(r);
    }
    // quiet
    {
      const { row: r } = row('mute', '#B9A9D9', 'Quiet', 'Turn off all sounds');
      r.appendChild(toggle(!!s.muted, 'Quiet', (v) => { s.muted = v; applyMute(); }));
      list.appendChild(r);
    }
    // read aloud
    if (synth) {
      const { row: r } = row('speak', 'var(--sw-mint)', 'Read words out loud');
      r.appendChild(toggle(!!s.readAloud, 'Read words out loud', (v) => {
        s.readAloud = v;
        if (v) speak(`Hi ${game.profile.playerName || 'friend'}! I will read the words for you.`, true);
        else synth.cancel();
      }));
      list.appendChild(r);
    }
    // camera
    {
      const { row: r, main } = row('camera3d', 'var(--sw-lav)', 'Camera');
      const mode = game.cameraRig ? game.cameraRig.mode : s.camera || 'third';
      main.appendChild(seg([['third', 'Behind me', 'person'], ['first', 'My eyes', 'eyes']], mode, (v) => {
        s.camera = v;
        if (game.cameraRig && game.cameraRig.setMode) game.cameraRig.setMode(v);
        save();
      }));
      list.appendChild(r);
    }
    // look speed
    {
      const { row: r, main } = row('eye', '#FF9F8A', 'Look speed');
      main.appendChild(slider({
        value: s.lookSpeed ?? 1, min: 0.4, max: 2.2, step: 0.1, fill: '#FF9F8A', left: 'slow', right: 'run', label: 'Look speed',
        onInput: (v) => { s.lookSpeed = v; },
      }));
      list.appendChild(r);
    }
    // quality
    {
      const { row: r, main } = row('sparkles', 'var(--sw-sun)', 'Pretty or fast?', 'Fast helps on older tablets');
      // 'auto' (the default) and 'high' both keep full sharpness; only Fast lowers it
      const q = s.quality === 'low' ? 'low' : 'high';
      main.appendChild(seg([['high', 'Pretty', 'quality'], ['low', 'Fast', 'fast']], q, (v) => {
        s.quality = v;
        game.applySettings();
        save();
      }, '#F5A300'));
      list.appendChild(r);
    }
    // weather wand (a friend visiting another world follows her friend's weather and clock:
    // docs/MULTIPLAYER.md §7, so these controls are hidden for her)
    const visiting = !!(game.net && game.net.isGuest);
    const W = game.weather;
    if (!visiting && W && Array.isArray(W.kinds) && typeof W.set === 'function' && W.kinds.length) {
      const { row: r, main } = row('rainbow', '#6CC6FF', 'Weather wand');
      const opts = W.kinds.map((k) => {
        const key = typeof k === 'string' ? k : k.key || k.id;
        const label = (typeof k === 'object' && k.name) || WEATHER_LABELS[key] || String(key).replace(/^\w/, (c) => c.toUpperCase());
        return [key, label, WEATHER_ICONS[key] || 'sparkle'];
      });
      main.appendChild(seg(opts, W.current, (v) => {
        try { W.set(v); } catch (err) { console.warn('[settings] weather failed', err); }
        game.audio.play('magic');
      }, '#3AAEF0'));
      if (!game.world) main.appendChild(ui.el('div', 'sw-set-note', 'Works inside a world'));
      list.appendChild(r);
    }
    // time of day
    if (!visiting) {
      const { row: r, main } = row('clock', '#9C7BFF', 'Time of day');
      const d = game.time.dayTime;
      const cur = d < 0.4 && d > 0.2 ? 'morning' : d >= 0.4 && d < 0.62 ? 'noon' : d >= 0.62 && d < 0.8 ? 'sunset' : 'night';
      const picker = seg(TIMES.map(([k, label]) => [k, label, k === 'noon' ? 'sunny' : k]), game.world ? cur : null, (v) => {
        const t = TIMES.find(([k]) => k === v);
        if (t && game.world) game.setDayTime(t[2]);
        game.audio.play('chime');
      }, '#9C7BFF');
      main.appendChild(picker);
      const line = ui.el('div', 'sw-set-line');
      line.appendChild(toggle(!!s.timeFrozen, 'Freeze time', (v) => { s.timeFrozen = v; }));
      const lab = ui.el('div', 'sw-set-note');
      lab.innerHTML = icon2('freeze', { size: 18 });
      lab.appendChild(document.createTextNode(' Freeze time'));
      lab.style.display = 'flex';
      lab.style.alignItems = 'center';
      lab.style.gap = '4px';
      line.appendChild(lab);
      main.appendChild(line);
      r.hidden = !game.world;
      list.appendChild(r);
    }
    // name (family accounts: the nickname her grown-up chose, read only here)
    const acct = game.account || {};
    {
      const { row: r, main } = row('pencil', 'var(--sw-pink)', 'Your name', acct.active ? 'A grown-up can change it on the Family page' : '');
      const line = ui.el('div', 'sw-set-line');
      const name = ui.el('div', 'sw-set-name', game.profile.playerName || (game.profile.look && game.profile.look.name) || 'Lily');
      line.append(name);
      if (!acct.active) line.append(button2(ui, {
        icon: 'pencil', label: 'Change', variant: 'white', size: 'small',
        onClick: async () => {
          const cur = game.profile.playerName || (game.profile.look && game.profile.look.name) || '';
          const v = await ui.textInput({ title: 'What is your name?', value: cur, ok: 'Save', maxLength: 20 });
          if (!v) return;
          game.profile.playerName = v;
          game.profile.nameSet = true;
          if (game.profile.look) game.profile.look.name = v;
          game.saveProfile();
          name.textContent = v;
          game.events.emit('avatar:changed', { look: game.profile.look });
          game.events.emit('profile:changed', { profile: game.profile });
          game.toast(`Hi, ${v}!`, { icon: 'heart' });
        },
      }));
      main.appendChild(line);
      list.appendChild(r);
    }
    // family accounts: the Grown-ups card, behind the grown-up check (src/account/cards.js)
    if (acct.grownups) {
      const { row: r, main } = row('home', 'var(--sw-lav)', 'Grown-ups', 'The Family page, this device, switching players');
      main.appendChild(button2(ui, { icon: 'home', label: 'Open', variant: 'white', size: 'small', className: 'sw-set-grownups', onClick: () => acct.openGrownups() }));
      list.appendChild(r);
    }
    // rows other modules add (the walkie-talkie's grown-up switch: src/net/walkie/ui.js)
    for (const add of game.settingsRows || []) add(list);
    // help
    if (game.actions.has('help') || game.actions.has('tutorial')) {
      const { row: r, main } = row('help', 'var(--sw-mint)', 'How to play');
      const line = ui.el('div', 'sw-set-line');
      if (game.actions.has('help')) line.appendChild(button2(ui, { icon: 'keyboard', label: 'Keys & taps', variant: 'mint', size: 'small', onClick: () => game.runAction('help') }));
      if (game.actions.has('tutorial') && game.world) line.appendChild(button2(ui, { icon: 'sparkles', label: 'Show tips', variant: 'white', size: 'small', onClick: () => { ui.close(); game.runAction('tutorial'); } }));
      main.appendChild(line);
      list.appendChild(r);
    }
    body.appendChild(list);
  };

  ui.registerPanel('settings', {
    title: 'Settings',
    icon: 'settings',
    width: 720,
    back: (g) => (g.mode === 'title' ? 'title' : 'pause'),
    build(container) {
      body = container;
    },
    onOpen() {
      render();
    },
    onClose() {
      save();
    },
  });
  game.registerAction('settings', (g) => g.ui.open('settings'));
}
