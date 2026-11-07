// The Gift Workshop panel ('gift-workshop', the gifts team doc, "The Workshop"): four big steps
// (Toy, Box, Paper, Ribbon) beside a live 3D stage that changes with every tap, "Surprise me!",
// then "Wrap it!": the toy hops into its box, the lid shuts, the paper folds up round it, the
// ribbon zips on, the bow pops, ta-da (rays, confetti). Last, "Who is it for?" fills in the gift
// tag (a friend in the world, a player, or Anyone) and Done puts the gift in her hands.
// Closing the panel after Wrap it! never loses the gift: it is wrapped for Anyone.
// The stage is the shared one (pets/preview.js: no new WebGL context); without WebGL a thumbnail
// stands in and every step still works.

import { preview } from '../pets/preview.js';
import { basketCount } from '../pets/kit.js';
import { foodIcon, foodName } from '../food-models.js';
import { mulberry32 } from '../../core/util.js';
import { ICONS, boxSvg, bowSvg } from './art.js';
import { FX_CSS, confetti, rays } from './fx.js';
import { giftSfx } from './sfx.js';
import { icon as uiIcon } from '../../ui/icons.js';

const CSS = /* css */ `
.gf-ws { display: flex; flex-direction: column; gap: 12px; }
.gf-steps { display: flex; justify-content: center; gap: 6px; }
.gf-steps button { position: relative; display: flex; align-items: center; gap: 6px; min-height: 52px; padding: 0 14px 0 8px; border-radius: 999px; border: 4px solid #F3E6FF; background: #fff; color: var(--sw-ink);
  font: 700 18px var(--sw-font); cursor: pointer; touch-action: manipulation; transition: transform .16s var(--sw-bounce), background .16s; }
.gf-steps button i { display: grid; place-items: center; width: 34px; height: 34px; border-radius: 50%; background: #F3E6FF; color: #8A5CF0; font-style: normal; }
.gf-steps button i svg { width: 22px; height: 22px; }
.gf-steps button.gf-on { background: #FFE3F0; border-color: #FF8CC6; transform: scale(1.06); }
.gf-steps button.gf-on i { background: #FF5FA2; color: #fff; }
.gf-steps button.gf-done i { background: #3FD8B0; color: #fff; }
.gf-steps button:disabled { cursor: default; opacity: .55; }
.gf-steps .gf-dot { align-self: center; width: 14px; height: 4px; border-radius: 2px; background: #F3E6FF; }

.gf-main { display: grid; grid-template-columns: minmax(250px, 1fr) minmax(280px, 1.15fr); gap: 14px; align-items: stretch; }
.gf-stage { position: relative; min-height: 320px; border-radius: 24px; overflow: hidden; touch-action: none; -webkit-touch-callout: none; -webkit-user-select: none; user-select: none; cursor: grab;
  background: radial-gradient(circle at 50% 72%, #FFFFFF 0 18%, #FFF0F6 55%, #FFDDEB 100%); box-shadow: inset 0 -6px 0 rgba(255,140,198,.18); }
.gf-stage > canvas:not(.gf-rays) { display: block; width: 100% !important; height: 100% !important; position: relative; z-index: 1; touch-action: none; }
.gf-stage > .gf-rays { position: absolute; z-index: 0; left: 50%; top: 46%; margin: -180px 0 0 -180px; opacity: 0; transition: opacity .5s; }
.gf-stage.gf-ready > .gf-rays { opacity: 1; }
.gf-stage .gf-say { position: absolute; z-index: 3; left: 0; right: 0; top: 10px; display: flex; justify-content: center; pointer-events: none; }
.gf-stage .gf-say span { padding: 6px 18px 8px; border-radius: 999px; background: rgba(255,255,255,.92); border: 4px solid #FFC94D; font-size: 20px; font-weight: 700; color: var(--sw-ink); box-shadow: 0 4px 12px var(--sw-shadow); animation: sw-pop .4s var(--sw-bounce) both; }
.gf-stage .gf-say span:empty { display: none; }
.gf-stage .gf-fall { position: absolute; inset: 0; z-index: 2; display: grid; place-items: center; }
.gf-stage .gf-fall img { width: 170px; height: 170px; }
.gf-stage .gf-drag { position: absolute; z-index: 3; right: 10px; bottom: 8px; font-size: 14px; font-weight: 700; color: #C0659A; opacity: .8; pointer-events: none; }

.gf-side { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.gf-head { margin: 0; text-align: center; font-size: 26px; color: var(--sw-ink); line-height: 1.1; }
.gf-choices { display: flex; flex-direction: column; gap: 10px; max-height: min(46vh, 420px); overflow-y: auto; overscroll-behavior: contain; padding: 4px 4px 8px; }
.gf-label { font-size: 16px; font-weight: 700; color: #8A5CF0; margin: 2px 2px -4px; }
.gf-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(82px, 1fr)); gap: 8px; }
.gf-grid.gf-big { grid-template-columns: repeat(3, 1fr); }
.gf-grid.gf-dots { grid-template-columns: repeat(auto-fill, minmax(58px, 1fr)); }
.gf-tile { position: relative; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; min-height: 92px; padding: 6px 4px; border-radius: 20px; border: 4px solid #fff; background: #fff; color: var(--sw-ink);
  box-shadow: 0 3px 0 rgba(58,31,77,.08), 0 5px 12px var(--sw-shadow); cursor: pointer; font: 700 14px var(--sw-font); line-height: 1.05; text-align: center; touch-action: manipulation; -webkit-tap-highlight-color: transparent; transition: transform .16s var(--sw-bounce), border-color .16s; }
.gf-tile:active { transform: scale(.94); }
.gf-tile.gf-sel { border-color: #FF5FA2; background: #FFF4F9; transform: scale(1.04); }
.gf-tile.gf-sel::after { content: ''; position: absolute; right: -6px; top: -6px; width: 26px; height: 26px; border-radius: 50%; border: 3px solid #fff;
  background: #FF5FA2 url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M5 12.5l4.2 4.2L19 7' fill='none' stroke='%23fff' stroke-width='3.4' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") center / 18px no-repeat; }
.gf-tile img { width: 64px; height: 64px; display: block; }
.gf-tile .gf-ph { width: 64px; height: 64px; border-radius: 50%; background: #F6F0FF; }
.gf-tile .gf-pic { width: 70px; height: 70px; }
.gf-grid.gf-big .gf-tile { min-height: 120px; font-size: 16px; }
.gf-grid.gf-big .gf-pic { width: 84px; height: 84px; }
.gf-tile .gf-n { position: absolute; left: 4px; top: 4px; min-width: 22px; height: 22px; padding: 0 5px; border-radius: 11px; background: #FFC94D; color: var(--sw-ink); font-size: 13px; line-height: 22px; }
.gf-swatch { width: 52px; height: 52px; border-radius: 16px; image-rendering: pixelated; box-shadow: inset 0 -4px 0 rgba(0,0,0,.12); background-size: cover; }
.gf-grid.gf-dots .gf-tile { min-height: 66px; padding: 5px; border-radius: 22px; }
.gf-ribbon { width: 46px; height: 46px; border-radius: 50%; display: grid; place-items: center; box-shadow: inset 0 -4px 0 rgba(0,0,0,.14), 0 0 0 2px rgba(58,31,77,.08); }
.gf-ribbon svg { width: 30px; height: 30px; color: #fff; filter: drop-shadow(0 1px 1px rgba(58,31,77,.35)); }

.gf-shelf { display: flex; flex-direction: column; gap: 6px; padding: 10px; border-radius: 20px; background: linear-gradient(#FFF7E3, #FFEBC2); border: 3px solid #FFE1A0; }
.gf-shelf-row { display: flex; gap: 8px; overflow-x: auto; padding-bottom: 2px; }
.gf-shelf .gf-tile { flex: none; width: 86px; min-height: 96px; }
.gf-shelf .gf-tile img { width: 58px; height: 58px; }
.gf-full { padding: 10px 14px; border-radius: 18px; background: #FFF1C9; border: 3px solid #FFC94D; font-size: 17px; font-weight: 700; color: var(--sw-ink); text-align: center; }

.gf-btns { display: flex; flex-wrap: wrap; gap: 10px; justify-content: center; }
.gf-btns .sw-btn { min-height: 58px; }
.gf-btns .gf-ic { display: inline-grid; place-items: center; margin-right: 2px; }
.gf-btns .gf-ic svg { width: 26px; height: 26px; }
.gf-btns .gf-go { font-size: 24px; padding-left: 26px; padding-right: 26px; animation: gf-glow 1.6s ease-in-out infinite; }
@keyframes gf-glow { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.06); } }
.gf-btns .sw-btn:disabled { opacity: .5; animation: none; }

.gf-tag { position: relative; align-self: center; display: flex; align-items: center; gap: 12px; min-width: 240px; padding: 10px 22px 10px 40px; border-radius: 14px 34px 34px 14px; background: #FFFDF5; border: 4px solid #FFC94D; box-shadow: 0 5px 14px var(--sw-shadow); }
.gf-tag::before { content: ''; position: absolute; left: 12px; top: 50%; width: 14px; height: 14px; margin-top: -7px; border-radius: 50%; background: #FFE9B0; border: 3px solid #FFC94D; }
.gf-tag b { display: block; font-size: 26px; color: #E0457F; line-height: 1.1; }
.gf-tag span { display: block; font-size: 16px; font-weight: 700; color: var(--sw-ink); opacity: .8; }
.gf-tag.gf-pop { animation: sw-pop .4s var(--sw-bounce) both; }
.gf-tile .gf-face { width: 54px; height: 54px; border-radius: 50%; display: grid; place-items: center; color: #fff; }
.gf-tile .gf-face svg { width: 32px; height: 32px; }

@media (max-width: 760px) {
  .gf-main { grid-template-columns: 1fr; }
  .gf-stage { min-height: 230px; height: 34vh; }
  .gf-choices { max-height: none; overflow: visible; }
  .gf-steps button { padding: 0 10px 0 6px; font-size: 16px; min-height: 48px; }
  .gf-steps .gf-dot { display: none; }
  .gf-head { font-size: 22px; }
}
@media (max-width: 420px) {
  .gf-steps button span { display: none; }
  .gf-steps button { padding: 0 6px; }
}
`;

const POSES = ['toy', 'box', 'paper', 'ribbon'];
const UNWRAP_MS = 380; // Wrap it!: the preview paper whisks off before the real wrapping
const FACE = { npc: '#FF7EB6', boy: '#4FB3F6', player: '#9C7BFF', anyone: '#F2B93B' };
const WRAP_CUES = [
  [0.05, 'pick', { pitch: 0.7 }],
  [0.5, 'pick', { pitch: 0.5, volume: 1.2 }],
  [0.95, 'crinkle'],
  [1.15, 'fold'],
  [1.6, 'zip'],
  [2.05, 'bow'],
];

/**
 * api: { D, M, gifts() (the profile's gift state), wrap(spec, to), hold(id), myName(),
 * toyName(inside), npcs() [{ name, boy }], players() [names], treats() [basket food keys] }.
 * Returns { refresh(), open(), state() }.
 */
export function installPanel(game, api) {
  const ui = game.ui;
  const D = api.D, M = api.M;
  const S = D.STRINGS;
  if (!ui) return { refresh() {}, open: () => false, state: () => null };
  ui.addStyles(FX_CSS + CSS);
  const pv = preview(game);
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  let rand = mulberry32((Math.floor(now()) ^ 0x6a17) >>> 0);

  // ---------------- state ----------------

  const st = {
    phase: 'choose', // 'choose' | 'wrapping' | 'who' | 'done'
    step: 0,
    spec: { ...D.DEFAULT_GIFT },
    to: D.ANYONE,
    built: '', // the stage model's spec key
    anim: null, // { t0, t1, start, dur } over data.js wrapPose time (t1 < t0 plays it backwards)
    bump: 0, // the stage's little hop after a choice (seconds left)
    spinT: 0, // the ta-da spin (seconds left)
    spinLen: 1.1,
    timers: [],
    fallback: null,
    live: false,
  };
  const el = {};

  const later = (ms, fn) => {
    const id = setTimeout(() => {
      st.timers = st.timers.filter((x) => x !== id);
      fn();
    }, ms);
    st.timers.push(id);
  };
  const clearTimers = () => {
    for (const id of st.timers) clearTimeout(id);
    st.timers = [];
  };

  const sack = () => { const g = api.gifts(); return g && Array.isArray(g.sack) ? g.sack : []; };
  const full = () => sack().length >= D.SACK_MAX;
  const look = () => D.normalizeGift(st.spec);
  const specKey = () => { const g = look(); return [g.inside, g.box, g.paper, g.pattern, g.ribbon, g.bow].join('|'); };

  const icon = (svg, cls = 'gf-ic') => `<span class="${cls}">${svg}</span>`;
  const btn = (label, onClick, variant, svg = null, cls = '') => {
    const b = ui.button({ label, onClick, variant, className: cls });
    if (svg) b.insertAdjacentHTML('afterbegin', icon(svg));
    return b;
  };
  const img = (promise, size = 64) => {
    const i = ui.el('img');
    i.alt = '';
    i.width = i.height = size;
    i.draggable = false;
    Promise.resolve(promise).then((url) => { if (url) i.src = url; }).catch(() => {});
    return i;
  };
  const toyIcon = (key) => game.thumbs.get('gift:toy:' + key, () => M.toyModel(key), { dir: [0.45, 0.42, 1] });
  const giftIcon = (g) => game.thumbs.get('gift:w:' + D.heldKeyOf(g), () => M.giftModel(g, { tag: false }), { dir: [0.5, 0.45, 1] });

  // the paper swatches: a 16 x 16 tile of a paper color in a pattern (painted once each)
  const swatches = new Map();
  function swatch(paperKey, patternKey) {
    const k = paperKey + '|' + patternKey;
    if (swatches.has(k)) return swatches.get(k);
    let url = null;
    try {
      const p = D.paper(paperKey), pat = D.pattern(patternKey);
      const c = document.createElement('canvas');
      c.width = c.height = 16;
      const g = c.getContext('2d');
      if (g) {
        for (let y = 0; y < 16; y++) {
          const row = pat.rows[y] || '';
          for (let x = 0; x < 16; x++) {
            const ch = row[x];
            g.fillStyle = ch === 'x' ? p.ink : ch === 'o' ? p.ink2 : p.color;
            g.fillRect(x, y, 1, 1);
          }
        }
        url = c.toDataURL();
      }
    } catch { url = null; }
    swatches.set(k, url);
    return url;
  }

  // ---------------- the panel ----------------

  ui.registerPanel('gift-workshop', {
    title: S.title,
    icon: 'star',
    width: 860,
    build(container) {
      const root = ui.el('div', 'gf-ws');
      el.shelf = ui.el('div', 'gf-shelf');
      el.steps = ui.el('div', 'gf-steps');
      const main = ui.el('div', 'gf-main');
      el.stage = ui.el('div', 'gf-stage');
      el.stage.appendChild(rays(360));
      el.say = ui.el('div', 'gf-say');
      el.sayText = ui.el('span');
      el.say.appendChild(el.sayText);
      el.stage.appendChild(el.say);
      el.stage.addEventListener('contextmenu', (e) => e.preventDefault());
      const side = ui.el('div', 'gf-side');
      el.head = ui.el('h3', 'gf-head');
      el.tag = ui.el('div', 'gf-tag');
      el.choices = ui.el('div', 'gf-choices');
      side.append(el.head, el.tag, el.choices);
      main.append(el.stage, side);
      el.btns = ui.el('div', 'gf-btns');
      root.append(el.shelf, el.steps, main, el.btns);
      container.appendChild(root);
    },
    onOpen() {
      start();
    },
    onClose() {
      // after Wrap it! the gift is never lost: closing wraps it (for whoever the tag says)
      if (st.phase === 'wrapping' || st.phase === 'who') commit(false);
      stop();
    },
  });
  setTitleIcon();

  function setTitleIcon() {
    const p = ui.panels && ui.panels.get('gift-workshop');
    const title = p && p.wrap && p.wrap.querySelector('.sw-card-title');
    const old = title && title.querySelector('svg');
    if (old) old.outerHTML = ICONS.present;
  }

  function start() {
    clearTimers();
    const g = api.gifts();
    const last = g && g.last && typeof g.last === 'object' ? g.last : null;
    st.spec = D.normalizeGift({ ...D.DEFAULT_GIFT, ...(last || {}) });
    // a treat that has run out starts as the teddy
    const t = D.treatOf(st.spec.inside);
    if (t && basketCount(game, t) <= 0) st.spec.inside = D.DEFAULT_GIFT.inside;
    st.phase = 'choose';
    st.step = 0;
    st.to = D.ANYONE;
    st.anim = null;
    st.bump = 0;
    st.spinT = 0;
    st.built = '';
    el.stage.classList.remove('gf-ready');
    render();
  }

  function stop() {
    clearTimers();
    st.anim = null;
    if (pv.host === el.stage) {
      pv.clear();
      pv.unmount();
    }
    st.built = '';
    st.live = false;
    if (st.fallback) { st.fallback.remove(); st.fallback = null; }
    if (st.phase !== 'done') st.phase = 'choose';
  }

  // ---------------- the stage ----------------

  /** wrapPose time at which each step's still picture sits. */
  const STILL = { paper: 1.62, ribbon: 2.8 };

  function stagePose(t) {
    if (st.anim) {
      const a = st.anim;
      const s = Math.max(0, Math.min(1, (now() - a.start) / 1000 / a.dur));
      return D.wrapPose(a.t0 + (a.t1 - a.t0) * s);
    }
    if (st.phase === 'wrapping' || st.phase === 'who' || st.phase === 'done') return 'done';
    void t;
    return POSES[st.step] || 'toy';
  }

  function onFrame(dt, t, obj) {
    const pose = stagePose(t);
    if (st.anim && !st.anim.hold && now() - st.anim.start > st.anim.dur * 1000 + 30) st.anim = null;
    M.poseStage(obj, pose, t);
    // a little hop after every choice, and the ta-da spin
    let s = 1;
    if (st.bump > 0) {
      st.bump = Math.max(0, st.bump - dt);
      s = 1 + Math.sin((1 - st.bump / 0.32) * Math.PI) * 0.09;
    }
    obj.scale.setScalar(s);
    if (obj.userData.gfY === undefined) obj.userData.gfY = obj.position.y;
    let up = 0;
    if (st.spinT > 0) {
      const len = st.spinLen || 1.1;
      st.spinT = Math.max(0, st.spinT - dt);
      pv.yaw += dt * 9 * (st.spinT / len);
      up = Math.sin((1 - st.spinT / len) * Math.PI) * 0.12;
    }
    obj.position.y = obj.userData.gfY + up;
  }

  /** (Re)build the stage model when the gift changed; keep the camera and the spin where they are. */
  function updateStage(force = false) {
    const key = specKey();
    if (!force && key === st.built && (st.live || st.fallback)) {
      updateFallback();
      return;
    }
    st.built = key;
    let shown = false;
    try {
      if (pv.mount(el.stage) && !pv.failed) {
        const g = look();
        const obj = M.stageModel(g);
        M.putInside(obj, g.inside);
        M.poseStage(obj, stagePose(0), 0);
        const yaw = st.live && Number.isFinite(pv.yaw) ? pv.yaw : 0.5;
        pv.show(obj, { spin: 0.35, yaw, dir: [0, 0.48, 1], zoom: 0.92, lift: 0.36, onFrame });
        shown = true;
      }
    } catch (err) {
      console.warn('[gifts] stage unavailable', err);
      shown = false;
    }
    st.live = shown;
    if (!shown) updateFallback();
    else if (st.fallback) { st.fallback.remove(); st.fallback = null; }
  }

  function updateFallback() {
    if (st.live) return;
    if (!st.fallback) {
      st.fallback = ui.el('div', 'gf-fall');
      el.stage.appendChild(st.fallback);
    }
    st.fallback.innerHTML = '';
    const g = look();
    const p = st.phase === 'choose' && st.step === 0
      ? (D.treatOf(g.inside) ? foodIcon(game, D.treatOf(g.inside)) : toyIcon(g.inside))
      : giftIcon(g);
    st.fallback.appendChild(img(p, 170));
  }

  function hop() {
    st.bump = 0.32;
  }

  /** Play the wrapping curve from t0 to t1 (seconds of data.js wrapPose) at `speed`. hold: stay on t1. */
  function play(t0, t1, speed = 1, hold = false) {
    st.anim = { t0, t1, start: now(), dur: Math.max(0.05, Math.abs(t1 - t0) / Math.max(0.1, speed)), hold };
  }

  // ---------------- rendering ----------------

  function render() {
    renderShelf();
    renderSteps();
    renderHead();
    renderChoices();
    renderButtons();
    updateStage();
  }

  function renderShelf() {
    el.shelf.innerHTML = '';
    const list = sack();
    el.shelf.hidden = !(st.phase === 'choose' && st.step === 0 && list.length);
    if (el.shelf.hidden) return;
    el.shelf.appendChild(ui.el('div', 'gf-label', S.shelf));
    const row = ui.el('div', 'gf-shelf-row');
    for (const e of list.slice(0, D.SACK_MAX)) {
      const b = ui.el('button', 'gf-tile');
      b.type = 'button';
      b.appendChild(img(giftIcon(e), 58));
      b.appendChild(ui.el('span', '', e.to ? `${S.to} ${e.to}` : S.anyone));
      b.setAttribute('aria-label', `${S.holdIt}: ${e.to || S.anyone}`);
      b.addEventListener('click', () => {
        game.audio.play('click');
        st.phase = 'done';
        ui.close();
        api.hold(e.id);
      });
      row.appendChild(b);
    }
    el.shelf.appendChild(row);
  }

  function renderSteps() {
    el.steps.innerHTML = '';
    const choosing = st.phase === 'choose';
    S.steps.forEach((name, i) => {
      if (i) el.steps.appendChild(ui.el('span', 'gf-dot'));
      const b = ui.el('button');
      b.type = 'button';
      b.innerHTML = `<i>${ICONS[POSES[i]]}</i>`;
      b.appendChild(ui.el('span', '', name));
      if (choosing && i === st.step) b.classList.add('gf-on');
      if (!choosing || i < st.step) b.classList.add('gf-done');
      b.disabled = !choosing;
      b.setAttribute('aria-label', name);
      b.addEventListener('click', () => {
        if (st.phase !== 'choose' || i === st.step) return;
        game.audio.play('click');
        go(i);
      });
      el.steps.appendChild(b);
    });
  }

  function renderHead() {
    const g = look();
    el.tag.hidden = st.phase !== 'who';
    if (st.phase === 'wrapping') {
      el.head.textContent = S.wrapping;
      say(S.wrapping);
    } else if (st.phase === 'who') {
      el.head.textContent = S.forWho;
      say(S.ready);
      renderTag(false);
    } else {
      el.head.textContent = S.heads[st.step] || '';
      say(st.step === 0 ? insideName(g.inside) : '');
    }
  }

  function say(text) {
    if (el.sayText.textContent === text) return;
    const s = ui.el('span', '', text || '');
    el.say.replaceChildren(s);
    el.sayText = s;
  }

  function insideName(inside) {
    const t = D.treatOf(inside);
    return t ? foodName(t) : api.toyName(inside);
  }

  function renderTag(pop) {
    el.tag.innerHTML = '';
    el.tag.innerHTML = ICONS.tag.replace('class="sw-icon"', 'class="sw-icon" style="width:34px;height:34px;color:#FF7EB6;flex:none"');
    const txt = ui.el('div');
    txt.append(ui.el('b', '', `${S.to} ${st.to || S.anyone}`), ui.el('span', '', `${S.from} ${api.myName()}`));
    el.tag.appendChild(txt);
    if (pop) {
      el.tag.classList.remove('gf-pop');
      void el.tag.offsetWidth;
      el.tag.classList.add('gf-pop');
    }
  }

  function tile(content, label, selected, onPick, cls = '') {
    const b = ui.el('button', 'gf-tile' + (cls ? ' ' + cls : ''));
    b.type = 'button';
    if (typeof content === 'string') b.insertAdjacentHTML('beforeend', content);
    else if (content) b.appendChild(content);
    if (label) b.appendChild(ui.el('span', '', label));
    b.setAttribute('aria-label', label || '');
    if (selected) b.classList.add('gf-sel');
    b.addEventListener('click', () => onPick(b));
    return b;
  }

  function grid(cls = '') {
    return ui.el('div', 'gf-grid' + (cls ? ' ' + cls : ''));
  }

  function choose(field, value, sound = 'pick') {
    if (st.phase !== 'choose') return;
    st.spec = D.normalizeGift({ ...st.spec, [field]: value });
    giftSfx(game, sound);
    hop();
    renderChoices();
    renderHead();
    updateStage();
  }

  function renderChoices() {
    const box = el.choices;
    const scroll = box.scrollTop;
    box.innerHTML = '';
    const g = look();
    if (st.phase === 'wrapping') return;
    if (st.phase === 'who') return renderWho();
    if (full()) box.appendChild(ui.el('div', 'gf-full', S.shelfFull));
    if (st.step === 0) {
      const toys = grid();
      for (const t of D.TOYS) {
        toys.appendChild(tile(img(toyIcon(t.key)), t.name, g.inside === t.key, () => {
          choose('inside', t.key);
          giftSfx(game, t.sound, { volume: 0.8 });
        }));
      }
      box.appendChild(toys);
      const treats = (api.treats() || []).filter((k) => basketCount(game, k) > 0);
      if (treats.length) {
        box.appendChild(ui.el('div', 'gf-label', S.treats));
        const tg = grid();
        for (const k of treats) {
          const n = basketCount(game, k);
          const b = tile(img(foodIcon(game, k)), foodName(k), g.inside === 't:' + k, () => choose('inside', 't:' + k, 'crinkle'));
          b.appendChild(ui.el('span', 'gf-n', String(Math.min(99, n))));
          tg.appendChild(b);
        }
        box.appendChild(tg);
      }
    } else if (st.step === 1) {
      const p = D.paper(g.paper), r = D.ribbon(g.ribbon);
      const bx = grid('gf-big');
      for (const b of D.BOXES) bx.appendChild(tile(boxSvg(b.key, p.color, r.color), b.name, g.box === b.key, () => choose('box', b.key)));
      box.appendChild(bx);
    } else if (st.step === 2) {
      box.appendChild(ui.el('div', 'gf-label', S.colors));
      const cg = grid('gf-dots');
      for (const p of D.PAPERS) cg.appendChild(tile(swatchEl(p.key, g.pattern), '', g.paper === p.key, () => choose('paper', p.key, 'crinkle')));
      cg.querySelectorAll('.gf-tile').forEach((b, i) => b.setAttribute('aria-label', D.PAPERS[i].name));
      box.appendChild(cg);
      box.appendChild(ui.el('div', 'gf-label', S.patterns));
      const pg = grid();
      for (const pt of D.PATTERNS) pg.appendChild(tile(swatchEl(g.paper, pt.key), pt.name, g.pattern === pt.key, () => choose('pattern', pt.key, 'crinkle')));
      box.appendChild(pg);
    } else {
      box.appendChild(ui.el('div', 'gf-label', S.steps[3]));
      const rg = grid('gf-dots');
      D.RIBBONS.forEach((r) => {
        const dot = ui.el('span', 'gf-ribbon');
        dot.style.background = r.color;
        dot.innerHTML = ICONS.ribbon;
        const sv = dot.querySelector('svg');
        if (sv && (r.key === 'white' || r.key === 'silver')) sv.style.color = '#C9A8FF';
        const b = tile(dot, '', g.ribbon === r.key, () => choose('ribbon', r.key, 'zip'));
        b.setAttribute('aria-label', r.name);
        rg.appendChild(b);
      });
      box.appendChild(rg);
      box.appendChild(ui.el('div', 'gf-label', S.bows));
      const bg = grid('gf-big');
      const rc = D.ribbon(g.ribbon).color;
      for (const b of D.BOWS) bg.appendChild(tile(bowSvg(b.key, rc), b.name, g.bow === b.key, () => choose('bow', b.key, 'bow')));
      box.appendChild(bg);
    }
    box.scrollTop = scroll;
  }

  function swatchEl(paperKey, patternKey) {
    const s = ui.el('span', 'gf-swatch');
    const url = swatch(paperKey, patternKey);
    if (url) s.style.backgroundImage = `url(${url})`;
    else s.style.background = D.paper(paperKey).color;
    return s;
  }

  function renderWho() {
    const box = el.choices;
    const seen = new Set();
    const g = grid();
    const add = (name, kind, svg) => {
      const key = name.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      const face = ui.el('span', 'gf-face');
      face.style.background = FACE[kind];
      face.innerHTML = svg;
      g.appendChild(tile(face, name || S.anyone, st.to === name, () => {
        st.to = name;
        giftSfx(game, 'pick');
        giftSfx(game, 'bow', { volume: 0.5, pitch: 1.3 });
        hop();
        renderTag(true);
        renderChoices();
      }));
    };
    add(D.ANYONE, 'anyone', ICONS.everyone);
    for (const n of (api.npcs() || []).slice(0, 10)) if (n && n.name) add(n.name, n.boy ? 'boy' : 'npc', ICONS.friend);
    for (const n of (api.players() || []).slice(0, 7)) if (n) add(n, 'player', ICONS.heart);
    box.appendChild(g);
  }

  function renderButtons() {
    el.btns.innerHTML = '';
    if (st.phase === 'wrapping') return;
    if (st.phase === 'who') {
      el.btns.appendChild(btn(S.done, () => commit(true), 'sun', ICONS.present, 'gf-go'));
      return;
    }
    if (st.step > 0) el.btns.appendChild(btn(S.back, () => go(st.step - 1), 'white', uiIcon('back')));
    el.btns.appendChild(btn(S.random, () => surprise(), 'lav', ICONS.dice));
    if (st.step < 3) {
      el.btns.appendChild(btn(S.next, () => go(st.step + 1), 'mint', ICONS[POSES[st.step + 1]]));
    } else {
      const w = btn(S.wrap, () => wrapIt(), 'pink', ICONS.wand, 'gf-go');
      w.disabled = full();
      el.btns.appendChild(w);
    }
  }

  // ---------------- actions ----------------

  function go(step) {
    const from = st.step;
    st.step = Math.max(0, Math.min(3, step));
    // little previews of the wrap between the steps: into the box, the paper, the ribbon
    if (st.step === 2 && from === 1) { play(0, STILL.paper); giftSfx(game, 'fold'); }
    else if (st.step === 3 && from === 2) { play(1.55, STILL.ribbon, 1.2); later(80, () => giftSfx(game, 'zip')); later(500, () => giftSfx(game, 'bow')); }
    else { st.anim = null; hop(); giftSfx(game, 'pick', { pitch: st.step > from ? 1.1 : 0.85 }); }
    render();
    el.choices.scrollTop = 0;
  }

  function surprise() {
    if (st.phase !== 'choose') return;
    rand = mulberry32((Math.floor(now() * 7) ^ 0x51f3) >>> 0);
    const r = D.randomGift(rand);
    if (st.step > 0) r.inside = st.spec.inside; // the toy stays once it is chosen
    r.ribbon = D.ribbonFor(r.paper, rand) || r.ribbon;
    st.spec = D.normalizeGift(r);
    giftSfx(game, 'magic');
    hop();
    st.spinT = st.spinLen = 0.6;
    if (st.step === 0) { const t = D.toy(st.spec.inside); if (t) later(180, () => giftSfx(game, t.sound, { volume: 0.7 })); }
    render();
  }

  function wrapIt() {
    if (st.phase !== 'choose') return;
    if (full()) {
      game.toast(S.shelfFull, { icon: 'heart', key: 'gift-hint' });
      return;
    }
    const t = D.treatOf(st.spec.inside);
    if (t && basketCount(game, t) <= 0) {
      st.spec.inside = D.DEFAULT_GIFT.inside;
      go(0);
      return;
    }
    st.phase = 'wrapping';
    clearTimers();
    // the preview paper whisks off (a snip and a whoosh), then the real wrapping from the start
    play(D.WRAP_SECONDS, 0, D.WRAP_SECONDS / (UNWRAP_MS / 1000), true);
    giftSfx(game, 'snip');
    giftSfx(game, 'whoosh', { volume: 0.6 });
    later(UNWRAP_MS, () => play(0, D.WRAP_SECONDS, 1, true));
    for (const [at, name, o] of WRAP_CUES) later(UNWRAP_MS + at * 1000, () => giftSfx(game, name, o || {}));
    later(UNWRAP_MS + D.WRAP_SECONDS * 1000, () => taDa());
    render();
  }

  function taDa() {
    if (st.phase !== 'wrapping') return;
    st.phase = 'who';
    st.anim = null;
    st.spinT = st.spinLen = 1.1;
    giftSfx(game, 'tada');
    game.audio.play('sparkle');
    el.stage.classList.add('gf-ready');
    const g = look(), p = D.paper(g.paper), r = D.ribbon(g.ribbon);
    const rr = el.stage.getBoundingClientRect();
    confetti(ui, el.stage, rr.width / 2 || 150, (rr.height || 300) * 0.55, 40, [p.color, p.ink, p.ink2, r.color, '#FFE38A']);
    render();
  }

  /** Make the gift: it goes in her hands with its tag. */
  function commit(close) {
    if (st.phase !== 'wrapping' && st.phase !== 'who') return null;
    clearTimers();
    st.phase = 'done';
    const entry = api.wrap(look(), st.to);
    if (!entry) {
      // the shelf filled up or the treat is gone: back to choosing (the toast says why)
      st.phase = 'choose';
      if (ui.current === 'gift-workshop') {
        el.stage.classList.remove('gf-ready');
        render();
      }
      return null;
    }
    if (close && ui.current === 'gift-workshop') ui.close();
    return entry;
  }

  return {
    /** The basket or the shelf changed: redraw the open panel's lists. */
    refresh() {
      if (ui.current !== 'gift-workshop' || st.phase !== 'choose') return;
      renderShelf();
      renderChoices();
      renderButtons();
    },
    open: () => ui.open('gift-workshop'),
    /** For probes: where the panel is. */
    state: () => ({ phase: st.phase, step: st.step, spec: look(), to: st.to, live: st.live }),
    /** For probes: drive the panel without taps. */
    pick: (field, value) => choose(field, value),
    step: (i) => go(i),
    wrap: () => wrapIt(),
    to: (name) => { if (st.phase === 'who') { st.to = D.cleanName(name); renderTag(true); renderChoices(); } },
    done: () => commit(true),
  };
}
