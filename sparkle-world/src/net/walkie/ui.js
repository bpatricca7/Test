// What a child sees of the walkie-talkie (docs/teams/walkie.md):
//   - the big walkie button in the HUD (hold to talk; a ring counts the 15 s down), shown only
//     while playing together on the Railway site with this device's walkie turned on;
//   - "Mia is talking" on the button and a speaking badge over Mia's avatar;
//   - a small "Walkie off" badge when friends use walkies but this device's is off;
//   - the microphone card before the first press;
//   - Players panel: a walkie badge per player, Mute per player, and for the host "Mute
//     everyone";
//   - Settings: "Walkie-talkie (grown-ups)" (the grown-up check turns it on).

import { icon2, button2 } from '../../ui/menus/icons2.js';
import { toScreen } from '../../things/pets/kit.js';
import { walkieSvg, WAVES_SVG, REST_SVG } from './art.js';
import { openGate, GATE_NOTE } from './gate.js';
import { W } from './wire.js';

const RING_C = 2 * Math.PI * 46; // countdown ring circumference (r = 46 in a 100 box)

const CSS = /* css */ `
/* ---------- the HUD button ---------- */
.sw-wk { position: absolute; left: calc(20px + var(--sw-safe-l)); bottom: calc(20px + var(--sw-safe-b)); display: flex; flex-direction: column; align-items: center; gap: 4px; pointer-events: none !important; z-index: 3; }
.sw-wk[hidden], .sw-wk-off[hidden] { display: none !important; }
.sw-wk > * { pointer-events: auto; }
.sw-wk-btn { position: relative; width: 108px; height: 108px; border-radius: 50%; border: 0; padding: 0; margin: 0; background: none; cursor: pointer; touch-action: none; -webkit-touch-callout: none; -webkit-user-select: none; user-select: none; -webkit-tap-highlight-color: transparent; font-family: var(--sw-font); }
.sw-wk-btn:focus { outline: none; }
.sw-wk-btn:focus-visible .sw-wk-face { box-shadow: 0 0 0 5px var(--sw-sky), 0 10px 22px var(--sw-shadow); }
.sw-wk-face { position: absolute; inset: 9px; border-radius: 50%; display: grid; place-items: center; background: radial-gradient(circle at 34% 28%, #FFF9DA 0%, #FFDF7E 45%, #FFC94D 100%); border: 5px solid #fff; box-shadow: 0 6px 0 rgba(58,31,77,.16), 0 10px 22px var(--sw-shadow), inset 0 -6px 0 rgba(0,0,0,.06); transition: transform .18s var(--sw-bounce), background .2s; }
.sw-wk-face .sw-wk-art { width: 66px; height: 66px; filter: drop-shadow(0 3px 0 rgba(58,31,77,.15)); transition: transform .2s var(--sw-bounce); }
.sw-wk-btn:hover .sw-wk-face { transform: scale(1.05); }
.sw-wk-ring { position: absolute; inset: 0; width: 100%; height: 100%; transform: rotate(-90deg); pointer-events: none; overflow: visible; }
.sw-wk-ring circle { fill: none; stroke-width: 8; }
.sw-wk-ring-bg { stroke: transparent; }
.sw-wk-ring-fg { stroke: var(--sw-mint); stroke-linecap: round; stroke-dasharray: ${RING_C.toFixed(1)}; stroke-dashoffset: 0; opacity: 0; transition: stroke .3s; }
.sw-wk-waves { position: absolute; inset: 0; pointer-events: none; opacity: 0; }
.sw-wk-waves i { position: absolute; inset: 4px; border-radius: 50%; border: 5px solid var(--sw-pink); opacity: 0; }
.sw-wk-secs { position: absolute; right: -6px; top: -6px; min-width: 38px; height: 38px; padding: 0 6px; border-radius: 999px; background: #fff; border: 4px solid var(--sw-mint); color: var(--sw-ink); font-size: 19px; font-weight: 700; line-height: 30px; text-align: center; box-shadow: 0 3px 8px var(--sw-shadow); opacity: 0; transform: scale(.4); transition: opacity .15s, transform .2s var(--sw-bounce), border-color .3s; pointer-events: none; font-variant-numeric: tabular-nums; }
.sw-wk-label { display: inline-flex; align-items: center; gap: 6px; max-width: 220px; font-size: 16px; font-weight: 700; color: var(--sw-ink); background: rgba(255,255,255,.95); padding: 2px 10px; border-radius: 999px; box-shadow: 0 2px 6px var(--sw-shadow); white-space: nowrap; pointer-events: none !important; }
.sw-wk-label span { overflow: hidden; text-overflow: ellipsis; }
.sw-wk-label .sw-wk-key { flex: none; font-size: 13px; line-height: 18px; min-width: 20px; padding: 0 5px; border-radius: 6px; background: var(--sw-lav-soft); color: var(--sw-lav); border-bottom: 2px solid #CDBDFF; }
.sw-wk-label svg { width: 20px; height: 20px; flex: none; }
.sw-app:not(.sw-touch-hud) .sw-wk-label .sw-wk-key { display: inline-block; }
.sw-app.sw-touch-hud .sw-wk-label .sw-wk-key { display: none; }

/* talking: a pink glow, the waves ripple out, the ring counts down */
.sw-wk[data-state="asking"] .sw-wk-face, .sw-wk[data-state="talking"] .sw-wk-face { transform: scale(1.08); background: radial-gradient(circle at 34% 28%, #FFF1F8 0%, #FFB3D6 55%, #FF7FB6 100%); box-shadow: 0 0 0 5px rgba(255,95,162,.35), 0 0 30px 10px rgba(255,95,162,.5), inset 0 -6px 0 rgba(0,0,0,.06); }
.sw-wk[data-state="talking"] .sw-wk-face .sw-wk-art { animation: sw-wk-talk .5s ease-in-out infinite; }
.sw-wk[data-state="talking"] .sw-wk-ring-bg { stroke: rgba(255,255,255,.9); }
.sw-wk[data-state="talking"] .sw-wk-ring-fg { opacity: 1; }
.sw-wk[data-state="talking"] .sw-wk-waves { opacity: 1; }
.sw-wk[data-state="talking"] .sw-wk-waves i { animation: sw-wk-ripple 1.4s ease-out infinite; }
.sw-wk[data-state="talking"] .sw-wk-waves i:nth-child(2) { animation-delay: .46s; }
.sw-wk[data-state="talking"] .sw-wk-waves i:nth-child(3) { animation-delay: .93s; }
.sw-wk[data-state="talking"] .sw-wk-secs { opacity: 1; transform: scale(1); }
.sw-wk[data-state="talking"] .sw-wk-label { background: var(--sw-pink); color: #fff; }
.sw-wk.sw-wk-late .sw-wk-ring-fg { stroke: var(--sw-sun); }
.sw-wk.sw-wk-last .sw-wk-ring-fg { stroke: var(--sw-pink); }
.sw-wk.sw-wk-late .sw-wk-secs { border-color: var(--sw-sun); }
.sw-wk.sw-wk-last .sw-wk-secs { border-color: var(--sw-pink); }
/* someone else is talking: her color around the walkie, "Mia is talking" */
.sw-wk[data-state="busy"] .sw-wk-face { background: radial-gradient(circle at 34% 28%, #FFFFFF 0%, #F3EEFF 60%, #E6DDFF 100%); border-color: var(--who, var(--sw-lav)); }
.sw-wk[data-state="busy"] .sw-wk-face .sw-wk-art { animation: sw-wk-listen 1.1s ease-in-out infinite; }
.sw-wk[data-state="busy"] .sw-wk-label { border: 3px solid var(--who, var(--sw-lav)); padding: 0 9px; }
.sw-wk[data-state="busy"] .sw-wk-label svg { color: var(--who, var(--sw-lav)); animation: sw-twinkle 1s ease-in-out infinite; }
/* resting (the host said "Mute everyone", or muted this player) / no microphone */
.sw-wk[data-state="quiet"] .sw-wk-face, .sw-wk[data-state="muted"] .sw-wk-face, .sw-wk[data-state="nomic"] .sw-wk-face { background: radial-gradient(circle at 34% 28%, #FFFFFF 0%, #EFEAF6 70%, #DCD3EE 100%); }
.sw-wk[data-state="quiet"] .sw-wk-label svg, .sw-wk[data-state="muted"] .sw-wk-label svg { color: var(--sw-lav); }
.sw-wk[data-state="capped"] .sw-wk-face { background: radial-gradient(circle at 34% 28%, #FFFFFF 0%, #FFF1C9 60%, #FFDF7E 100%); }
.sw-wk[data-state="capped"] .sw-wk-label { background: var(--sw-sun); }
.sw-wk.sw-wk-nudge .sw-wk-face { animation: sw-wk-nope .45s ease-in-out; }
@keyframes sw-wk-ripple { 0% { transform: scale(.85); opacity: .75; } 100% { transform: scale(1.55); opacity: 0; } }
@keyframes sw-wk-talk { 0%, 100% { transform: rotate(-4deg) scale(1); } 50% { transform: rotate(4deg) scale(1.06); } }
@keyframes sw-wk-listen { 0%, 100% { transform: translateY(0) rotate(0); } 50% { transform: translateY(-3px) rotate(-6deg); } }
@keyframes sw-wk-nope { 0%, 100% { transform: translateX(0); } 25% { transform: translateX(-7px) rotate(-5deg); } 75% { transform: translateX(7px) rotate(5deg); } }

/* the small "Walkie off" badge (friends use walkies; this device's is off) */
.sw-wk-off { position: absolute; left: calc(20px + var(--sw-safe-l)); bottom: calc(24px + var(--sw-safe-b)); display: flex; align-items: center; gap: 6px; padding: 4px 12px 4px 4px; border-radius: 999px; background: rgba(255,255,255,.92); border: 3px solid #fff; box-shadow: 0 3px 10px var(--sw-shadow); font-family: var(--sw-font); font-size: 15px; font-weight: 700; color: #8F7BBF; cursor: pointer; z-index: 3; }
.sw-wk-off .sw-wk-art { width: 34px; height: 34px; }

/* touch screens: beside Jump (or Up / Down), where the right thumb is */
.sw-app.sw-touch-hud .sw-wk { left: auto; right: calc(176px + var(--sw-safe-r)); bottom: calc(100px + var(--sw-safe-b)); }
.sw-app.sw-touch-hud .sw-wk-btn { width: 100px; height: 100px; }
.sw-app.sw-touch-hud .sw-wk-face .sw-wk-art { width: 60px; height: 60px; }
.sw-app.sw-touch-hud .sw-wk-off { left: auto; right: calc(180px + var(--sw-safe-r)); bottom: calc(124px + var(--sw-safe-b)); }
/* phones held upright: in the middle above the hotbar, between Bag and Undo; the label on top */
@media (max-width: 480px) {
  .sw-wk, .sw-app.sw-touch-hud .sw-wk { left: 50%; right: auto; transform: translateX(-50%); bottom: calc(58px + var(--sw-safe-b)); flex-direction: column-reverse; gap: 2px; }
  .sw-wk-btn, .sw-app.sw-touch-hud .sw-wk-btn { width: 92px; height: 92px; }
  .sw-wk-face .sw-wk-art, .sw-app.sw-touch-hud .sw-wk-face .sw-wk-art { width: 54px; height: 54px; }
  .sw-wk-label { font-size: 14px; max-width: 170px; }
  .sw-wk-secs { min-width: 32px; height: 32px; line-height: 24px; font-size: 16px; }
  .sw-wk-off, .sw-app.sw-touch-hud .sw-wk-off { left: 50%; right: auto; transform: translateX(-50%); bottom: calc(76px + var(--sw-safe-b)); }
}
/* phones held sideways: left of the tools column, above the hotbar */
@media (max-height: 520px) and (min-width: 481px) {
  .sw-wk, .sw-app.sw-touch-hud .sw-wk { left: auto; right: calc(150px + var(--sw-safe-r)); bottom: calc(66px + var(--sw-safe-b)); gap: 2px; }
  .sw-wk-btn, .sw-app.sw-touch-hud .sw-wk-btn { width: 84px; height: 84px; }
  .sw-wk-face .sw-wk-art, .sw-app.sw-touch-hud .sw-wk-face .sw-wk-art { width: 48px; height: 48px; }
  .sw-wk-label { font-size: 13px; max-width: 150px; }
  .sw-wk-secs { min-width: 30px; height: 30px; line-height: 22px; font-size: 15px; }
  .sw-wk-off, .sw-app.sw-touch-hud .sw-wk-off { left: auto; right: calc(150px + var(--sw-safe-r)); bottom: calc(80px + var(--sw-safe-b)); }
}

/* ---------- the speaking badge over a friend's avatar ---------- */
.sw-wk-speak { position: absolute; left: 0; top: 0; display: flex; align-items: center; gap: 2px; padding: 3px 10px 3px 3px; border-radius: 999px; background: #fff; border: 4px solid var(--c, var(--sw-pink)); box-shadow: 0 5px 14px var(--sw-shadow); pointer-events: none !important; will-change: transform; z-index: 2; }
.sw-wk-speak[hidden] { display: none; }
.sw-wk-speak .sw-wk-art { width: 38px; height: 38px; animation: sw-wk-talk .5s ease-in-out infinite; }
.sw-wk-speak .sw-wk-wave { width: 28px; height: 28px; color: var(--c, var(--sw-pink)); animation: sw-wk-pulse .7s ease-in-out infinite; }
.sw-wk-speak::after { content: ''; position: absolute; left: 50%; bottom: -12px; margin-left: -8px; border: 8px solid transparent; border-top: 10px solid var(--c, var(--sw-pink)); border-bottom: 0; }
@keyframes sw-wk-pulse { 0%, 100% { opacity: .45; transform: scale(.85); } 50% { opacity: 1; transform: scale(1.1); } }

/* ---------- microphone card ---------- */
.sw-wk-card.sw-dialog { width: min(440px, 100%); border-color: #FFE3A3; }
.sw-wk-card-art { width: 104px; height: 104px; margin: -64px auto 6px; border-radius: 50%; display: grid; place-items: center; background: radial-gradient(circle at 34% 28%, #FFF9DA 0%, #FFDF7E 45%, #FFC94D 100%); border: 5px solid #fff; box-shadow: 0 6px 16px var(--sw-shadow); }
.sw-wk-card-art .sw-wk-art { width: 66px; height: 66px; }
.sw-wk-card.sw-dialog { margin-top: 48px; }
.sw-wk-card h3 { color: var(--sw-pink); }
.sw-wk-card .sw-wk-small { font-size: 15px; font-weight: 600; color: var(--sw-lav); margin: -6px 0 16px; line-height: 1.3; }

/* ---------- Players panel ---------- */
.sw-wk-badge { flex: none; display: inline-flex; align-items: center; gap: 2px; height: 26px; padding: 0 8px 0 2px; border-radius: 999px; background: #FFF4D1; color: #7A5B00; font-size: 12px; font-weight: 700; }
.sw-wk-badge .sw-wk-art { width: 24px; height: 24px; }
.sw-wk-badge .sw-wk-wave { width: 18px; height: 18px; color: var(--sw-pink); animation: sw-wk-pulse .7s ease-in-out infinite; }
.sw-wk-badge.sw-wk-badge-off { background: #F1EDF7; color: #8F7BBF; }
.sw-wk-badge.sw-wk-badge-muted { background: #FFE3F0; color: #C2266F; }
.sw-net-row-btns .sw-wk-mute.sw-btn { min-width: 84px; }
.sw-net-row-btns .sw-wk-mute.sw-btn--sun svg { color: var(--sw-ink); }
.sw-wk-rules { grid-template-columns: 1fr; }
.sw-wk-rules .sw-net-rule .sw-wk-art { width: 44px; height: 44px; flex: none; }
.sw-wk-note { font-size: 13px; font-weight: 600; color: var(--sw-lav); text-align: center; line-height: 1.25; }

/* ---------- Settings row ---------- */
.sw-set-row.sw-wk-setrow .sw-set-ic { background: radial-gradient(circle at 34% 28%, #FFF9DA 0%, #FFDF7E 45%, #FFC94D 100%); }
.sw-set-row.sw-wk-setrow .sw-set-ic .sw-wk-art { width: 38px; height: 38px; }
.sw-wk-setrow .sw-wk-status { font-size: 14px; font-weight: 700; color: #14A37C; }
.sw-wk-setrow .sw-wk-status.sw-off { color: #8F7BBF; }
`;

export class WalkieUI {
  constructor(game, wk) {
    this.game = game;
    this.wk = wk;
    const ui = game.ui;
    ui.addStyles(CSS);
    this.nudgeUntil = 0;
    this.nudgeText = '';
    this.lastKey = '';
    this.speakEls = new Map(); // peer -> element
    this._at = { x: 0, y: 0 };

    // the big button
    const root = ui.el('div', 'sw-wk');
    root.hidden = true;
    root.dataset.state = 'idle';
    const btn = ui.el('button', 'sw-wk-btn');
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Walkie-talkie: hold to talk');
    btn.innerHTML = `<svg class="sw-wk-ring" viewBox="0 0 100 100" aria-hidden="true"><circle class="sw-wk-ring-bg" cx="50" cy="50" r="46"/><circle class="sw-wk-ring-fg" cx="50" cy="50" r="46"/></svg>`;
    const waves = ui.el('span', 'sw-wk-waves');
    waves.append(ui.el('i'), ui.el('i'), ui.el('i'));
    const face = ui.el('span', 'sw-wk-face');
    face.innerHTML = walkieSvg();
    const secs = ui.el('span', 'sw-wk-secs', '15');
    btn.append(waves, face, secs);
    const label = ui.el('span', 'sw-wk-label');
    root.append(btn, label);
    ui.hudLayer.appendChild(root);
    this.root = root;
    this.btn = btn;
    this.face = face;
    this.secs = secs;
    this.label = label;
    this.ringFg = btn.querySelector('.sw-wk-ring-fg');
    this._faceOff = null;

    // hold to talk (pointer: mouse, pen, finger)
    const down = (e) => {
      if (e.button !== undefined && e.button !== 0 && e.pointerType === 'mouse') return;
      e.preventDefault();
      e.stopPropagation();
      try {
        btn.setPointerCapture(e.pointerId);
      } catch {}
      this.pointerId = e.pointerId;
      wk.press('pointer');
    };
    const up = (e) => {
      if (this.pointerId !== undefined && e.pointerId !== this.pointerId) return;
      this.pointerId = undefined;
      wk.release('pointer');
    };
    btn.addEventListener('pointerdown', down);
    btn.addEventListener('pointerup', up);
    btn.addEventListener('pointercancel', up);
    btn.addEventListener('lostpointercapture', up);
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
    // keyboard users: Space / Enter on the focused button also hold to talk
    btn.addEventListener('keydown', (e) => {
      if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) {
        e.preventDefault();
        wk.press('button-key');
      }
    });
    btn.addEventListener('keyup', (e) => {
      if (e.key === ' ' || e.key === 'Enter') wk.release('button-key');
    });
    btn.addEventListener('blur', () => wk.release('button-key'));

    // the small "Walkie off" badge
    const off = ui.el('button', 'sw-wk-off');
    off.type = 'button';
    off.hidden = true;
    off.innerHTML = walkieSvg({ off: true });
    off.appendChild(ui.el('span', '', 'Walkie off'));
    off.setAttribute('aria-label', 'Walkie-talkie is off on this device');
    off.addEventListener('click', () => {
      game.audio.play('click');
      game.toast('A grown-up can turn on the walkie-talkie in Settings.', { icon: 'settings', key: 'walkie-off' });
    });
    ui.hudLayer.appendChild(off);
    this.off = off;
  }

  // ---------- per frame ----------

  update() {
    const v = this.wk.view();
    const g = this.game;
    const show = v.show === 'button';
    if (this.root.hidden === show) this.root.hidden = !show;
    const badge = v.show === 'badge';
    if (this.off.hidden === badge) this.off.hidden = !badge;
    if (show) this._paint(v);
    this._speakBadges(v);
    if (!show && this.root.dataset.state !== 'idle') this.root.dataset.state = 'idle';
    void g;
  }

  _paint(v) {
    const now = performance.now();
    const nudging = now < this.nudgeUntil;
    const state = v.state;
    if (this.root.dataset.state !== state) this.root.dataset.state = state;
    // the face: grey walkie while resting
    const offArt = state === 'quiet' || state === 'muted' || state === 'nomic';
    if (this._faceOff !== offArt) {
      this._faceOff = offArt;
      this.face.innerHTML = walkieSvg({ off: offArt });
    }
    // who is talking: her color
    if (v.who) this.root.style.setProperty('--who', v.who.color);
    // the countdown
    if (state === 'talking') {
      const left = Math.max(0, v.left);
      const frac = Math.min(1, Math.max(0, 1 - left / (W.BURST_MS / 1000)));
      this.ringFg.style.strokeDashoffset = String((RING_C * frac).toFixed(1));
      const s = String(Math.ceil(left));
      if (this.secs.textContent !== s) this.secs.textContent = s;
      this.root.classList.toggle('sw-wk-late', left <= 6 && left > 3);
      this.root.classList.toggle('sw-wk-last', left <= 3);
    } else {
      this.ringFg.style.strokeDashoffset = '0';
      this.root.classList.remove('sw-wk-late', 'sw-wk-last');
    }
    // the label
    let html = null;
    let text = '';
    if (nudging) text = this.nudgeText;
    else if (state === 'talking' || state === 'asking') text = 'Talking!';
    else if (state === 'busy') {
      text = `${v.who ? v.who.name : 'A friend'} is talking`;
      html = WAVES_SVG;
    } else if (state === 'quiet') {
      text = 'Walkies resting';
      html = REST_SVG;
    } else if (state === 'muted') {
      text = 'Walkie resting';
      html = REST_SVG;
    } else if (state === 'nomic') text = 'Microphone off';
    else if (state === 'capped') text = 'Let go, then press again';
    else text = 'Hold to talk';
    const key = `${text}|${html ? 1 : 0}|${state}`;
    if (key !== this.lastKey) {
      this.lastKey = key;
      this.label.innerHTML = html || '';
      this.label.appendChild(this.game.ui.el('span', '', text));
      if (state === 'idle' && !nudging) this.label.appendChild(this.game.ui.el('b', 'sw-wk-key', 'M'));
      this.btn.setAttribute('aria-label', state === 'idle' ? 'Walkie-talkie: hold to talk' : `Walkie-talkie: ${text}`);
    }
  }

  /** A short note on the button (and a wiggle): why pressing did not start talking. */
  nudge(text, ms = 1800) {
    this.nudgeText = text;
    this.nudgeUntil = performance.now() + ms;
    this.lastKey = '';
    this.root.classList.remove('sw-wk-nudge');
    void this.root.offsetWidth;
    this.root.classList.add('sw-wk-nudge');
  }

  _speakBadges(v) {
    const g = this.game;
    const talkers = v.speaking || [];
    const remote = this.wk.net.remote;
    for (const [peer, e] of this.speakEls) {
      if (!talkers.includes(peer)) {
        e.hidden = true;
      }
    }
    for (const peer of talkers) {
      const f = remote && remote.get(peer);
      let e = this.speakEls.get(peer);
      if (!e) {
        e = g.ui.el('div', 'sw-wk-speak');
        e.innerHTML = walkieSvg() + WAVES_SVG;
        e.dataset.peer = peer;
        g.ui.hudLayer.appendChild(e);
        this.speakEls.set(peer, e);
      }
      if (f) e.style.setProperty('--c', f.color);
      const st = f ? f.st : 'w';
      const top = st === 'z' ? 1.55 : st === 's' || st === 'h' ? 2.25 : 2.8;
      const s = f && f.visible && !g.paused ? toScreen(g, f.pos.x, f.pos.y + top, f.pos.z, this._at) : null;
      if (!s) {
        e.hidden = true;
        continue;
      }
      e.hidden = false;
      const Wd = g.container.clientWidth;
      const Hd = g.container.clientHeight;
      const w = e.offsetWidth || 80;
      const h = e.offsetHeight || 48;
      const x = Math.max(w / 2 + 8, Math.min(Wd - w / 2 - 8, s.x));
      const y = Math.max(h + 8, Math.min(Hd - 90, s.y));
      e.style.transform = `translate(${Math.round(x - w / 2)}px, ${Math.round(y - h)}px)`;
    }
  }

  clearSpeak() {
    for (const e of this.speakEls.values()) e.hidden = true;
  }

  // ---------- the microphone card ----------

  /**
   * Before the first press: what the microphone is for. kind: 'ask' | 'denied'.
   * Resolves true when the child tapped OK / Try again.
   */
  micCard(kind = 'ask') {
    const g = this.game;
    const ui = g.ui;
    if (this._card) return this._card;
    this._card = new Promise((resolve) => {
      const wrap = ui.el('div', 'sw-dialog-wrap sw-wk-cardwrap');
      const dim = ui.el('div', 'sw-backdrop');
      const card = ui.el('div', 'sw-dialog sw-wk-card');
      card.setAttribute('role', 'dialog');
      card.setAttribute('aria-modal', 'true');
      const art = ui.el('div', 'sw-wk-card-art');
      art.innerHTML = walkieSvg();
      card.appendChild(art);
      if (kind === 'denied') {
        card.append(
          ui.el('h3', '', 'The microphone is off'),
          ui.el('p', '', 'Ask a grown-up to help you turn it on.'),
          ui.el('div', 'sw-wk-small', 'Grown-ups: allow the microphone for this website in the browser settings (iPad: Settings → Safari → Microphone), then tap Try again.'),
        );
      } else {
        card.append(
          ui.el('h3', '', 'Your walkie needs the microphone!'),
          ui.el('p', '', 'Tap OK. If you are asked, tap Allow.'),
          ui.el('div', 'sw-wk-small', 'Your voice goes only to your friends in this game, and only while you hold the button.'),
        );
      }
      const row = ui.el('div', 'sw-dialog-buttons');
      let done = false;
      const close = (v) => {
        if (done) return;
        done = true;
        window.removeEventListener('keydown', onKey, true);
        wrap.remove();
        ui.dialogOpen = ui.dialogLayer.childElementCount > 0;
        this._card = null;
        resolve(v);
      };
      const onKey = (e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          close(false);
        }
      };
      row.append(
        ui.button({ label: 'Not now', variant: 'white', icon: 'close', className: 'sw-wk-card-no', onClick: () => close(false) }),
        ui.button({ label: kind === 'denied' ? 'Try again' : 'OK!', variant: 'pink', icon: 'check', className: 'sw-wk-card-ok', onClick: () => close(true) }),
      );
      card.appendChild(row);
      wrap.append(dim, card);
      dim.addEventListener('pointerdown', () => close(false));
      window.addEventListener('keydown', onKey, true);
      ui.dialogLayer.appendChild(wrap);
      ui.dialogOpen = true;
    });
    return this._card;
  }

  // ---------- Settings ----------

  settingsRow(list) {
    const wk = this.wk;
    if (!wk.exists) return;
    const g = this.game;
    const ui = g.ui;
    const r = ui.el('div', 'sw-set-row sw-wk-setrow');
    const ic = ui.el('div', 'sw-set-ic');
    ic.innerHTML = walkieSvg();
    const main = ui.el('div', 'sw-set-main');
    main.appendChild(ui.el('div', 'sw-set-title', 'Walkie-talkie (grown-ups)'));
    main.appendChild(ui.el('div', 'sw-set-note', GATE_NOTE));
    const status = ui.el('div', 'sw-wk-status');
    main.appendChild(status);
    const sw = ui.el('button', 'sw-switch sw-wk-switch');
    sw.type = 'button';
    sw.setAttribute('role', 'switch');
    sw.setAttribute('aria-label', 'Walkie-talkie');
    sw.append(ui.el('span', 'sw-on-t', 'On'), ui.el('span', 'sw-off-t', 'Off'));
    const paint = () => {
      const on = wk.enabled;
      sw.classList.toggle('sw-on', on);
      sw.setAttribute('aria-checked', String(on));
      status.textContent = on ? 'On for this device. Hold the walkie button to talk when you play with friends.' : 'Off. A grown-up turns it on with a quick math question.';
      status.classList.toggle('sw-off', !on);
    };
    paint();
    let busy = false;
    sw.addEventListener('click', async () => {
      if (busy) return;
      if (wk.enabled) {
        g.audio.play('pop', { pitch: 0.8 });
        wk.setEnabled(false);
        paint();
        g.toast('Walkie-talkie is off.', { icon: 'mute' });
        return;
      }
      busy = true;
      g.audio.play('pop', { pitch: 1.2 });
      const ok = await openGate(g);
      busy = false;
      if (ok) {
        wk.setEnabled(true);
        g.toast('Walkie-talkie is on for this device!', { icon: 'sound', color: 'mint' });
      }
      paint();
    });
    r.append(ic, main, sw);
    list.appendChild(r);
  }

  // ---------- Players panel ----------

  decorateRow(row, pl, isHostView) {
    const wk = this.wk;
    if (!wk.exists) return;
    const ui = this.game.ui;
    const st = pl.state || {};
    const on = pl.you ? wk.enabled : st.wk === 1;
    const nameLine = row.querySelector('.sw-net-who-name');
    const badge = ui.el('span', 'sw-wk-badge');
    badge.dataset.peer = pl.peer || '';
    const hostMuted = wk.isHostMuted(pl);
    if (!on) {
      badge.classList.add('sw-wk-badge-off');
      badge.innerHTML = walkieSvg({ off: true });
      badge.appendChild(ui.el('span', '', 'walkie off'));
    } else if (hostMuted) {
      badge.classList.add('sw-wk-badge-muted');
      badge.innerHTML = walkieSvg({ off: true });
      badge.appendChild(ui.el('span', '', 'muted'));
    } else {
      badge.innerHTML = walkieSvg();
      if (!pl.you && wk.floorBy === pl.peer) {
        badge.insertAdjacentHTML('beforeend', WAVES_SVG);
        badge.classList.add('sw-wk-badge-talk');
        badge.appendChild(ui.el('span', '', 'talking'));
      } else badge.appendChild(ui.el('span', '', 'walkie'));
    }
    if (nameLine) nameLine.appendChild(badge);
    if (pl.you) return;
    // Mute: the host's mutes are for everyone; a friend's are for herself
    const forAll = isHostView;
    if (!forAll && !wk.enabled) return;
    const muted = forAll ? hostMuted : wk.isLocalMuted(pl);
    let btns = row.querySelector('.sw-net-row-btns');
    if (!btns) {
      btns = ui.el('div', 'sw-net-row-btns');
      row.appendChild(btns);
    }
    const b = button2(ui, {
      icon: muted ? 'sound' : 'mute',
      label: muted ? 'Unmute' : 'Mute',
      variant: muted ? 'sun' : 'white',
      className: 'sw-wk-mute',
      onClick: () => {
        if (forAll) wk.toggleHostMute(pl);
        else wk.toggleLocalMute(pl);
        const now = forAll ? wk.isHostMuted(pl) : wk.isLocalMuted(pl);
        b.classList.toggle('sw-btn--sun', now);
        b.classList.toggle('sw-btn--white', !now);
        b.querySelector('svg').outerHTML = icon2(now ? 'sound' : 'mute');
        b.querySelector('.sw-btn-label').textContent = now ? 'Unmute' : 'Mute';
        b.setAttribute('aria-label', now ? 'Unmute' : 'Mute');
      },
    });
    b.dataset.peer = pl.peer || '';
    btns.prepend(b);
  }

  decoratePanel(col, isHost) {
    const wk = this.wk;
    if (!wk.exists) return;
    const ui = this.game.ui;
    if (isHost) {
      const box = ui.el('div', 'sw-net-rules sw-wk-rules');
      const on = wk.muteAll;
      const b = ui.el('button', 'sw-net-rule sw-wk-muteall' + (on ? ' sw-on' : ''));
      b.type = 'button';
      b.setAttribute('role', 'switch');
      b.setAttribute('aria-checked', String(on));
      b.insertAdjacentHTML('afterbegin', walkieSvg({ off: on }));
      const t = ui.el('span', 'sw-net-rule-text');
      t.append(ui.el('div', 'sw-net-rule-name', 'Mute everyone'), ui.el('div', 'sw-net-rule-sub', 'All walkie-talkies rest (yours too)'));
      b.append(t, ui.el('span', 'sw-net-switch'));
      b.addEventListener('click', () => {
        const v = !b.classList.contains('sw-on');
        this.game.audio.play('pop', { pitch: v ? 0.85 : 1.2 });
        wk.setMuteAll(v);
        b.classList.toggle('sw-on', v);
        b.setAttribute('aria-checked', String(v));
        b.querySelector('.sw-wk-art').outerHTML = walkieSvg({ off: v });
      });
      box.appendChild(b);
      box.appendChild(ui.el('div', 'sw-wk-note', 'Mute next to a friend turns her walkie off for everyone.'));
      col.appendChild(box);
    } else if (wk.hostWm().all) {
      col.appendChild(ui.el('div', 'sw-wk-note', `${wk.hostName()} turned the walkie-talkies off for now.`));
    }
  }
}
