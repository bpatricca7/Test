// The squishy toys' screens (the squish team doc §5): the present drop, the unwrap panel
// ('present'), the Squish Shelf panel ('squish', action 'squish'), the one-time tips, the Bag
// tab's Squish Shelf button and the pause menu's. Live 3D uses the shared stage through
// preview(game) (no new WebGL context); every press does something.

import * as THREE from 'three';
import { preview } from '../pets/preview.js';
import { lifeIcon } from '../pets/kit.js';
import { Kit } from '../furniture/kit.js';
import { sharedToy, presentModel } from './models.js';
import { presser } from './anim.js';
import { presentSvg, coinSvg, arrowSvg, fingerSvg, pressSvg, starSvg, crownSvg, sparkleSvg, shelfIcon } from './art.js';
import { blocked, confetti, rays, CSS as FX_CSS } from './fx.js';

const CSS = /* css */ `
/* ---------- the drop ---------- */
.sq-drop { position: absolute; left: 0; top: 0; z-index: 46; display: flex; flex-direction: column; align-items: center; pointer-events: none !important; will-change: transform; }
.sq-drop-box { position: relative; width: 132px; height: 154px; border: 0; padding: 0; background: none; cursor: pointer; pointer-events: auto !important; touch-action: manipulation; -webkit-tap-highlight-color: transparent;
  animation: sq-wiggle 1.2s ease-in-out .7s infinite; }
.sq-drop-box svg { width: 100%; height: 100%; overflow: visible; filter: drop-shadow(0 8px 14px rgba(58,31,77,.3)); }
.sq-drop-glow { position: absolute; left: 50%; top: 70px; width: 260px; height: 260px; margin: -130px 0 0 -130px; border-radius: 50%; pointer-events: none;
  background: radial-gradient(circle, rgba(232,221,255,.95) 0 30%, rgba(232,221,255,0) 68%); }
.sq-drop-label { position: relative; margin-top: 6px; padding: 8px 22px 10px; border-radius: 22px; background: #fff; border: 4px solid #C8B4FF; text-align: center; line-height: 1.05; box-shadow: 0 6px 16px rgba(58,31,77,.25); }
.sq-drop-label b { display: block; font-size: 26px; color: #6B45C8; }
.sq-drop-label span { display: block; font-size: 18px; font-weight: 700; color: var(--sw-ink); }
.sq-trail { position: absolute; width: 22px; height: 22px; margin: -11px 0 0 -11px; z-index: 46; pointer-events: none !important; animation: sq-trail .8s ease-out forwards; }
.sq-trail svg { width: 100%; height: 100%; }
@keyframes sq-trail { from { transform: scale(1); opacity: 1; } to { transform: scale(.2) translateY(-14px); opacity: 0; } }
@keyframes sq-wiggle { 0%, 100% { transform: rotate(0); } 20% { transform: rotate(-7deg); } 40% { transform: rotate(6deg); } 60% { transform: rotate(-3deg); } }
.lf-hud .sw-round.sq-bounce .sw-round-face { animation: sq-bounce .9s ease-out 1; }
@keyframes sq-bounce { 0%, 100% { transform: translateY(0); } 20% { transform: translateY(-14px); } 40% { transform: translateY(0); } 60% { transform: translateY(-8px); } 80% { transform: translateY(0); } }
.lf-hud .sq-badge { position: absolute; right: -4px; top: -4px; min-width: 22px; height: 22px; padding: 0 5px; border-radius: 11px; background: #FF5FA2; color: #fff; font-size: 14px; font-weight: 700; line-height: 22px; text-align: center; border: 2px solid #fff; }
.lf-hud .sq-badge[hidden] { display: none; }
.lf-hud .sw-round-face { position: relative; }

/* ---------- the stage (no callout or selection on a long press) ---------- */
.sq-stage { position: relative; width: 100%; height: 300px; border-radius: 22px; overflow: hidden; touch-action: none; -webkit-touch-callout: none; -webkit-user-select: none; user-select: none;
  background: radial-gradient(circle at 50% 70%, #FFFFFF 0 20%, #F3ECFF 60%, #E8DDFF 100%); cursor: pointer; }
.sq-stage > canvas:not(.sq-rays) { display: block; width: 100% !important; height: 100% !important; touch-action: none; -webkit-touch-callout: none; position: relative; z-index: 1; }
.sq-stage > .sq-rays { position: absolute; z-index: 0; left: 50%; top: 50%; margin: -170px 0 0 -170px; opacity: 0; transition: opacity .3s; }
.sq-stage.sq-revealed .sq-rays { opacity: 1; }
.sq-fallback { position: absolute; inset: 0; display: grid; place-items: center; z-index: 2; }
.sq-fallback img { width: 150px; height: 150px; transition: transform .25s; }
.sq-finger { position: absolute; left: 50%; top: 8px; width: 64px; height: 80px; margin-left: -32px; z-index: 3; pointer-events: none; animation: sq-finger .9s ease-in-out infinite; }
@keyframes sq-finger { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(16px); } }

/* ---------- the unwrap ---------- */
.sq-unwrap { display: flex; flex-direction: column; gap: 12px; align-items: stretch; }
.sq-say { text-align: center; min-height: 64px; }
.sq-say small { display: block; font-size: 16px; font-weight: 700; color: #E08A00; letter-spacing: .5px; }
.sq-say b { display: block; font-size: 30px; color: var(--sw-ink); line-height: 1.1; }
.sq-say .sq-step { font-size: 26px; font-weight: 700; color: #6B45C8; }
.sq-say .sq-kind { display: block; margin-top: 4px; font-size: 18px; font-weight: 600; color: var(--sw-ink); opacity: .85; }
.sq-say .sq-gstar { display: inline-block; width: 28px; height: 28px; vertical-align: -4px; margin-left: 6px; }
.sq-say .sq-gstar svg { width: 100%; height: 100%; }
.sq-banner { display: inline-block; padding: 6px 20px 8px; border-radius: 999px; background: linear-gradient(#FFFDF2, #FFF1C9); border: 4px solid var(--sw-sun); box-shadow: 0 6px 18px var(--sw-shadow); animation: sw-pop .45s var(--sw-bounce) both; }
.sq-btns { display: flex; flex-wrap: wrap; gap: 10px; justify-content: center; }
.sq-btns .sw-btn { min-height: 56px; }
.sq-btns .sw-btn svg { width: 26px; height: 26px; }
.sq-pickrow { display: grid; grid-template-columns: repeat(auto-fill, minmax(84px, 1fr)); gap: 8px; max-height: 210px; overflow-y: auto; padding: 4px; }
.sq-pickrow button { border: 3px solid #E8DDFF; border-radius: 16px; background: #fff; padding: 4px; min-height: 84px; cursor: pointer; }
.sq-pickrow img { width: 72px; height: 72px; display: block; margin: 0 auto; }

/* ---------- the Squish Shelf ---------- */
.sq-shelf { position: relative; display: flex; flex-direction: column; gap: 12px; }
.sq-path { position: relative; display: flex; align-items: flex-end; justify-content: center; gap: 6px; padding: 10px 8px 6px; border-radius: 22px; background: linear-gradient(#FFF7FB, #F6F0FF); border: 3px solid #EFE6FF; }
.sq-path-next { display: flex; flex-direction: column; align-items: center; gap: 6px; }
.sq-path-next .sq-pbox { width: 104px; height: 120px; }
.sq-path-next .sq-pbox svg { width: 100%; height: 100%; overflow: visible; }
.sq-path.sq-ready .sq-pbox { animation: sq-hop 1.4s ease-in-out infinite; }
@keyframes sq-hop { 0%, 60%, 100% { transform: translateY(0); } 30% { transform: translateY(-12px); } }
.sq-bar { width: 150px; height: 22px; border-radius: 11px; background: #EDE6F7; border: 3px solid #fff; box-shadow: inset 0 2px 4px rgba(58,31,77,.15); overflow: hidden; }
.sq-bar i { display: block; height: 100%; width: 0; border-radius: 9px; background: linear-gradient(90deg, #C8B4FF, #FF9CCB); transition: width .5s; }
.sq-togo { display: flex; align-items: center; gap: 6px; font-size: 20px; font-weight: 700; color: var(--sw-ink); }
.sq-togo svg { width: 24px; height: 24px; }
.sq-dots { align-self: center; width: 46px; height: 6px; margin-bottom: 60px; background: radial-gradient(circle, #D9CCF2 2.5px, transparent 3px) 0 0 / 11px 6px repeat-x; }
.sq-path-grey { width: 64px; height: 76px; margin-bottom: 40px; opacity: .8; }
.sq-path-grey svg { width: 100%; height: 100%; }
.sq-path-msg { position: absolute; left: 0; right: 0; bottom: 4px; text-align: center; font-size: 16px; font-weight: 600; color: #6B45C8; }
.sq-champ { display: flex; align-items: center; justify-content: center; gap: 12px; padding: 14px; border-radius: 22px; background: linear-gradient(#FFFDF2, #FFF1C9); border: 4px solid var(--sw-sun); font-size: 22px; font-weight: 700; color: var(--sw-ink); text-align: center; }
.sq-champ svg { width: 56px; height: 42px; flex: none; }
.sq-tip { position: absolute; left: 8px; right: 8px; top: 8px; margin: 0 auto; z-index: 4; max-width: 420px; box-sizing: border-box; padding: 14px 16px; border-radius: 22px; background: #fff; border: 4px solid #C8B4FF; box-shadow: 0 10px 26px rgba(58,31,77,.3); text-align: center; animation: sw-pop .4s var(--sw-bounce) both; }
.sq-tip-pics { display: flex; align-items: center; justify-content: center; gap: 8px; }
.sq-tip-pics svg { width: 54px; height: 54px; }
.sq-tip-pics .sq-arrow svg { width: 44px; height: 28px; }
.sq-tip b { display: block; margin-top: 6px; font-size: 22px; color: var(--sw-ink); }
.sq-tip span { display: block; margin: 2px 0 10px; font-size: 17px; font-weight: 600; color: var(--sw-ink); opacity: .85; }
.sq-counts { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; justify-content: center; }
.sq-count { display: flex; align-items: center; gap: 8px; padding: 6px 14px; border-radius: 999px; background: #fff; border: 3px solid #F1E8FF; font-size: 18px; font-weight: 700; color: var(--sw-ink); }
.sq-count svg { width: 22px; height: 22px; }
.sq-count .sq-cbar { width: 90px; height: 12px; border-radius: 6px; background: #EDE6F7; overflow: hidden; }
.sq-count .sq-cbar i { display: block; height: 100%; background: linear-gradient(90deg, #FFD43B, #FF9CCB); }
.sq-tabs { display: flex; gap: 8px; justify-content: center; }
.sq-tabs button { display: flex; align-items: center; gap: 6px; min-height: 48px; padding: 0 16px; border-radius: 999px; border: 3px solid #EFE6FF; background: #fff; font: 700 18px var(--sw-font); color: var(--sw-ink); cursor: pointer; }
.sq-tabs button.sq-sel { background: #FFE3F0; border-color: #FF9CCB; }
.sq-tabs button svg { width: 22px; height: 22px; }
.sq-wood { padding: 12px 10px 4px; border-radius: 18px; background: linear-gradient(#F7DDB8, #EBC48F); box-shadow: inset 0 -6px 0 rgba(150,95,40,.18); max-height: min(52vh, 560px); overflow-y: auto; overscroll-behavior: contain; }
.sq-grid { display: grid; grid-template-columns: repeat(6, minmax(72px, 1fr)); gap: 14px 8px; }
.sq-cubby { position: relative; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; min-height: 108px; padding: 4px 2px 10px; border: 0; background: transparent; cursor: pointer; font: inherit; color: var(--sw-ink);
  border-bottom: 8px solid #C98F55; border-radius: 4px; box-shadow: 0 6px 0 -2px rgba(120,70,30,.25); -webkit-tap-highlight-color: transparent; }
.sq-cubby img { width: 76px; height: 76px; }
.sq-cubby .sq-ph { width: 76px; height: 76px; border-radius: 50%; background: rgba(255,255,255,.35); }
.sq-cubby.sq-mystery img { filter: brightness(0) opacity(.22); }
.sq-cubby .sq-q { position: absolute; top: 28px; left: 50%; width: 30px; height: 30px; margin-left: -15px; border-radius: 50%; background: #C8B4FF; color: #fff; font-size: 20px; font-weight: 700; line-height: 30px; text-align: center; border: 3px solid #fff; }
.sq-cubby .sq-name { font-size: 13px; font-weight: 700; line-height: 1.05; text-align: center; max-width: 100%; }
.sq-cubby .sq-new { position: absolute; top: 0; left: 0; padding: 1px 6px; border-radius: 8px; background: #FF5FA2; color: #fff; font-size: 12px; font-weight: 700; }
.sq-cubby .sq-gbtn { position: absolute; top: -2px; right: -2px; width: 34px; height: 34px; border: 0; padding: 4px; background: none; cursor: pointer; }
.sq-cubby .sq-gbtn svg { width: 100%; height: 100%; }
.sq-cubby.sq-g img { filter: drop-shadow(0 0 6px #FFE27A); }
.sq-detail { position: absolute; inset: 0; z-index: 5; display: flex; flex-direction: column; gap: 10px; padding: 4px; border-radius: 22px; background: #FFF9FD; animation: sw-pop .3s var(--sw-bounce) both; }
.sq-detail h3 { margin: 0; text-align: center; font-size: 26px; color: var(--sw-ink); }
.sq-detail .sq-stage { flex: 1; min-height: 240px; }
.sq-press { display: flex; align-items: center; justify-content: center; gap: 8px; font-size: 20px; font-weight: 700; color: #6B45C8; }
.sq-press svg { width: 56px; height: 42px; }
.sq-bagbtn { display: flex; justify-content: center; margin: 4px 0 10px; }
.sq-btn-ic svg, .sw-btn .sq-btn-ic svg { width: 26px; height: 26px; }
@media (max-width: 760px) {
  .sq-grid { grid-template-columns: repeat(4, minmax(72px, 1fr)); }
  .sq-stage { height: 240px; }
  .sq-say b { font-size: 24px; }
  .sq-bar { width: 120px; }
@media (max-width: 480px) {
  .sq-path { gap: 2px; padding: 8px 4px 6px; }
  .sq-path-next .sq-pbox { width: 84px; height: 98px; }
  .sq-dots { width: 18px; margin-bottom: 44px; }
  .sq-path-grey { width: 44px; height: 52px; margin-bottom: 30px; }
  .sq-tabs { gap: 4px; flex-wrap: wrap; }
  .sq-tabs button { padding: 0 10px; font-size: 16px; min-height: 44px; }
  .sq-wood { padding: 10px 6px 4px; }
  .sq-grid { grid-template-columns: repeat(auto-fill, minmax(72px, 1fr)); gap: 12px 4px; }
}
}

/* ---------- the pill tip ---------- */
.sq-pilltip { position: absolute; z-index: 47; display: flex; flex-direction: column; align-items: flex-start; pointer-events: none !important; }
.sq-pilltip .sq-hand { width: 48px; height: 60px; animation: sq-finger .9s ease-in-out infinite; }
.sq-pilltip .sq-hand svg { width: 100%; height: 100%; transform: rotate(180deg); }
.sq-pilltip span { padding: 8px 16px; border-radius: 18px; background: #fff; border: 4px solid #C8B4FF; font-size: 20px; font-weight: 700; color: var(--sw-ink); box-shadow: 0 6px 16px rgba(58,31,77,.25); white-space: nowrap; }
`;

const CUSHION = { girl: '#FFB8D6', boy: '#A6D8FF', mix: '#D8C8FF' };
const GHOST_MS = 300;

export function installPanels(game, S) {
  const ui = game.ui;
  const D = S.D;
  const ev = game.events;
  if (!ui) return { tick() {}, showDrop() {}, hideDrop() {}, dropBlocked: () => true, openPresent() {}, tapPresent() {}, pick() {}, squeezeShown: async () => false, shelfButton: () => document.createElement('button') };
  ui.addStyles(FX_CSS + CSS);
  const pv = preview(game);
  const t = D.STRINGS;
  const now = () => performance.now();
  const store = game.store;
  const devGet = (k) => (store && store.deviceGet ? store.deviceGet(k) : null);
  const devSet = (k, v) => { if (store && store.deviceSet) store.deviceSet(k, v); };
  const presentIc = () => lifeIcon('present');

  const btn = (label, onClick, variant = 'pink', ic = null, cls = '') => {
    const b = ui.button({ label, onClick, variant, className: cls });
    if (ic) b.insertAdjacentHTML('afterbegin', `<span class="sq-btn-ic">${ic}</span>`);
    return b;
  };

  // ======================================================================================
  // the drop
  // ======================================================================================

  let drop = null; // { el, timer, away }
  const coinPillEl = () => document.querySelector('.sw-hud .sw-coins');
  const presentBtnEl = () => document.querySelector('.lf-hud .sw-round[data-action="present"]');
  const rootRect = () => ui.root.getBoundingClientRect();

  function showDrop() {
    hideDrop();
    const rr = rootRect();
    const el = ui.el('div', 'sq-drop');
    const glow = ui.el('div', 'sq-drop-glow');
    const box = ui.el('button', 'sq-drop-box');
    box.type = 'button';
    box.setAttribute('aria-label', t.dropBig);
    box.innerHTML = presentSvg();
    const label = ui.el('div', 'sq-drop-label');
    label.append(ui.el('b', '', t.dropBig), ui.el('span', '', t.dropSmall));
    el.append(glow, box, label);
    ui.root.appendChild(el);
    const w = el.offsetWidth || 260;
    const tx = rr.width / 2 - w / 2, ty = Math.max(70, rr.height * 0.14);
    const pill = coinPillEl();
    const pr = pill ? pill.getBoundingClientRect() : null;
    const fx = pr && pr.width ? pr.left - rr.left + pr.width / 2 - w / 2 : tx, fy = pr && pr.width ? pr.top - rr.top : 20;
    el.style.transform = `translate(${tx}px, ${ty}px)`;
    if (el.animate) {
      el.animate([
        { transform: `translate(${fx}px, ${fy}px) scale(.15)`, opacity: 0.4 },
        { transform: `translate(${(fx + tx) / 2}px, ${ty - 30}px) scale(.8)`, opacity: 1, offset: 0.6 },
        { transform: `translate(${tx}px, ${ty}px) scale(1)`, opacity: 1 },
      ], { duration: 750, easing: 'cubic-bezier(.3,.6,.4,1.2)' });
    }
    S.sfx('shake');
    game.audio.play('sparkle');
    const d = { el, x: tx, y: ty, timer: 0 };
    const open = (e) => {
      if (e) e.stopPropagation();
      if (drop !== d) return;
      hideDrop();
      openPresent();
    };
    box.addEventListener('pointerup', open);
    box.addEventListener('click', open);
    d.timer = setTimeout(() => flyToButton(d), 7000);
    drop = d;
    return true;
  }

  /** Left alone: shrink and fly to the Present button with a sparkle trail; it bounces twice. */
  function flyToButton(d) {
    if (drop !== d) return;
    drop = null;
    clearTimeout(d.timer);
    const rr = rootRect();
    const b = presentBtnEl();
    const br = b && !b.hidden ? b.getBoundingClientRect() : null;
    const w = d.el.offsetWidth || 260;
    const bx = br && br.width ? br.left - rr.left + br.width / 2 - w / 2 : 20, by = br && br.width ? br.top - rr.top - 40 : 120;
    if (d.el.animate) {
      const a = d.el.animate([
        { transform: `translate(${d.x}px, ${d.y}px) scale(1)`, opacity: 1 },
        { transform: `translate(${bx}px, ${by}px) scale(.12)`, opacity: 0.6 },
      ], { duration: 900, easing: 'cubic-bezier(.5,0,.6,1)', fill: 'forwards' });
      for (let i = 1; i <= 6; i++) {
        setTimeout(() => {
          const u = i / 7;
          const s = ui.el('div', 'sq-trail');
          s.innerHTML = sparkleSvg(i % 2 ? '#FFC94D' : '#C8B4FF');
          s.style.left = `${d.x + w / 2 + (bx - d.x) * u}px`;
          s.style.top = `${d.y + 70 + (by - d.y) * u}px`;
          ui.root.appendChild(s);
          setTimeout(() => s.remove(), 850);
        }, i * 120);
      }
      a.onfinish = () => {
        d.el.remove();
        bounceButton();
      };
    } else {
      d.el.remove();
      bounceButton();
    }
  }

  function bounceButton() {
    const b = presentBtnEl();
    if (!b) return;
    b.classList.remove('sq-bounce');
    void b.offsetWidth;
    b.classList.add('sq-bounce');
    setTimeout(() => b.classList.remove('sq-bounce'), 1000);
  }

  function hideDrop() {
    if (!drop) return;
    clearTimeout(drop.timer);
    drop.el.remove();
    drop = null;
  }

  // ======================================================================================
  // the unwrap (panel 'present')
  // ======================================================================================

  const U = {
    stage: null, say: null, btns: null, pick: null, finger: null, fallback: null,
    openedAt: 0, taps: 0, queue: 0, busy: 0, phase: 'tap', group: null, present: null, toy: null, toyPress: null,
    result: null, anim: null, lid: null, spinT: 0, n: 0,
  };

  ui.registerPanel('present', {
    title: t.presentTitle,
    icon: 'star',
    width: 640,
    back: () => null,
    build(container) {
      const wrap = ui.el('div', 'sq-unwrap');
      U.stage = ui.el('div', 'sq-stage');
      U.stage.appendChild(rays(340));
      U.say = ui.el('div', 'sq-say');
      U.pick = ui.el('div', 'sq-pickrow');
      U.pick.hidden = true;
      U.btns = ui.el('div', 'sq-btns');
      wrap.append(U.stage, U.say, U.pick, U.btns);
      container.appendChild(wrap);
      U.stage.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        stageDown(e);
      });
      for (const ty of ['pointerup', 'pointercancel', 'pointerleave']) U.stage.addEventListener(ty, () => stageUp());
      U.stage.addEventListener('contextmenu', (e) => e.preventDefault());
    },
    onOpen() {
      startUnwrap();
    },
    onClose() {
      endUnwrap();
    },
  });
  setTitleIcon('present', presentIc());

  function setTitleIcon(name, svg) {
    const p = ui.panels.get(name);
    const title = p && p.wrap.querySelector('.sw-card-title');
    const old = title && title.querySelector('svg');
    if (old) old.outerHTML = svg;
  }

  const keyTap = (e) => {
    if (ui.current !== 'present' || (e.key !== ' ' && e.key !== 'Enter') || (e.target && e.target.closest && e.target.closest('button'))) return;
    e.preventDefault();
    tapPresent(true);
  };
  window.addEventListener('keydown', keyTap);

  function cushionColor() {
    return CUSHION[S.style() || 'mix'];
  }

  function startUnwrap() {
    endUnwrap();
    U.openedAt = now();
    U.taps = 0;
    U.queue = 0;
    U.busy = 0;
    U.result = null;
    U.phase = S.ready > 0 ? 'tap' : 'none';
    U.stage.classList.remove('sq-revealed');
    U.pick.hidden = true;
    U.pick.innerHTML = '';
    U.btns.innerHTML = '';
    const p = S.profile();
    U.n = D.opened(p);
    U.next = D.nextItem(p, S.style());
    if (U.phase === 'none' || !U.next) {
      U.phase = 'none';
      setSay(null, t.btnShelf);
      U.btns.append(btn(t.btnShelf, () => ui.open('squish'), 'lav', shelfIcon()));
      return;
    }
    setSay(null, t.tap0, true);
    // the stage: present, toy (hidden), cushion, and a hitbox as high as the toy's spring
    const g = new THREE.Group();
    const k = new Kit();
    k.cyl(0.42, 0.08, cushionColor(), 0, 0, 0, 24);
    k.hitbox(-0.42, 0, -0.42, 0.42, 1.2, 0.42);
    const base = k.build();
    base.name = 'sq-cushion';
    g.add(base);
    const present = presentModel(U.n % 6);
    present.position.y = 0.08;
    g.add(present);
    U.present = present;
    U.group = g;
    U.toy = null;
    U.anim = null;
    U.lid = null;
    const shown = mountStage(U.stage, g, { spin: 0, dir: [0, 0.4, 1], lift: 0.45, zoom: 0.8 }, unwrapFrame);
    U.fallback = shown ? null : fallbackImg(U.stage, null);
    if (!shown) U.fallback.innerHTML = presentSvg();
    if (U.n === 0) {
      U.finger = ui.el('div', 'sq-finger');
      U.finger.innerHTML = fingerSvg();
      U.stage.appendChild(U.finger);
    }
  }

  function endUnwrap() {
    if (pv.host === U.stage) {
      pv.clear();
      pv.unmount();
    }
    if (U.finger) { U.finger.remove(); U.finger = null; }
    if (U.fallback) { U.fallback.remove(); U.fallback = null; }
    U.group = null;
    U.present = null;
    U.toy = null;
    U.toyPress = null;
    U.anim = null;
  }

  function setSay(small, big, step = false, kindLine = null, star = false) {
    U.say.innerHTML = '';
    if (step) {
      U.say.appendChild(ui.el('div', 'sq-step', big));
      return;
    }
    const banner = ui.el('div', 'sq-banner');
    if (small) banner.appendChild(ui.el('small', '', small));
    const b = ui.el('b', '', big);
    if (star) {
      const s = ui.el('span', 'sq-gstar');
      s.innerHTML = starSvg('#FFC94D');
      b.appendChild(s);
    }
    banner.appendChild(b);
    U.say.appendChild(banner);
    if (kindLine) U.say.appendChild(ui.el('span', 'sq-kind', kindLine));
  }

  /** Mount the shared stage in host and show obj; false when the stage cannot draw. */
  function mountStage(host, obj, opts, onFrame) {
    try {
      if (!pv.mount(host) || pv.failed) return false;
      pv.show(obj, { ...opts, onFrame });
      return true;
    } catch (err) {
      console.warn('[squish] stage unavailable', err);
      return false;
    }
  }

  function fallbackImg(host, url) {
    const f = ui.el('div', 'sq-fallback');
    if (url) {
      const img = ui.el('img');
      img.alt = '';
      img.src = url;
      f.appendChild(img);
    }
    host.appendChild(f);
    return f;
  }

  // taps: a pointerdown on the stage; queued while a wiggle plays (at most 2), never lost
  function stageDown(e) {
    if (U.phase === 'tap') return tapPresent(false);
    if (U.phase === 'shown' && U.toyPress) {
      U.toyPress.press();
      U.pressX = e.clientX;
      S.sfx('squish');
      S.squeezed(U.result.key, U.result.glitter, 'present');
    }
  }
  function stageUp() {
    if (U.toyPress && U.toyPress.held) {
      U.toyPress.release();
      S.sfx(D.item(U.result.key).kind === 'puff' ? 'rise' : 'stretch');
    }
  }

  function tapPresent(force = false) {
    if (ui.current !== 'present' || U.phase !== 'tap') return false;
    if (!force && now() - U.openedAt < GHOST_MS) return false; // the tap that opened the panel
    if (U.busy > now()) {
      if (U.queue < 2) U.queue++;
      return true;
    }
    doTap();
    return true;
  }

  /** A queued tap plays as soon as the wiggle before it is done (also checked by the panel's timer). */
  function pumpQueue() {
    if (U.busy && U.busy <= now()) {
      U.busy = 0;
      if (U.queue > 0 && U.phase === 'tap') {
        U.queue--;
        doTap();
      }
    }
  }

  function doTap() {
    U.taps++;
    if (U.finger) { U.finger.remove(); U.finger = null; }
    if (U.taps === 1) {
      S.sfx('shake');
      setSay(null, t.tap1, true);
      U.anim = { kind: 'wiggle', t: 0, len: 0.42, amp: 0.12 };
      U.busy = now() + 420;
      burstAt(0.5, 0.45, 6);
    } else if (U.taps === 2) {
      S.sfx('rustle');
      setSay(null, t.tap2, true);
      U.anim = { kind: 'wiggle', t: 0, len: 0.5, amp: 0.2, bow: true };
      U.busy = now() + 500;
      burstAt(0.5, 0.45, 8);
    } else {
      reveal();
    }
    if (U.fallback) {
      const img = U.fallback.firstElementChild || U.fallback;
      img.style.transform = `scale(${1 - U.taps * 0.04}) rotate(${U.taps % 2 ? -8 : 8}deg)`;
    }
  }

  function burstAt(fx, fy, n) {
    const r = U.stage.getBoundingClientRect(), rr = U.stage.getBoundingClientRect();
    confetti(ui, U.stage, r.width * fx, rr.height * fy, n);
  }

  async function reveal() {
    U.phase = 'reveal';
    const next = U.next;
    if (next.glitter) {
      // the Glitter round: POP, then she picks which toy to make sparkly
      openLid();
      setSay(null, t.pickGlitter, true);
      showPickRow();
      return;
    }
    const res = await S.commit(null);
    if (!res) { ui.close(); return; }
    showToy(res);
  }

  function openLid() {
    S.sfx('unwrap');
    U.stage.classList.add('sq-revealed');
    burstAt(0.5, 0.4, 26);
    U.lid = { t: 0, len: 0.7 };
    U.busy = 0;
  }

  function showPickRow() {
    U.pick.hidden = false;
    U.pick.innerHTML = '';
    for (const key of D.glitterChoices(S.profile())) {
      const b = ui.el('button');
      b.type = 'button';
      b.setAttribute('aria-label', D.item(key).name);
      const img = ui.el('img');
      img.alt = '';
      S.toyIcon(key).then((u) => { if (u) img.src = u; });
      b.appendChild(img);
      b.addEventListener('click', () => pick(key));
      U.pick.appendChild(b);
    }
  }

  async function pick(key) {
    if (ui.current !== 'present' || !U.next || !U.next.glitter || U.phase === 'shown') return false;
    if (U.phase === 'tap') { U.taps = 2; doTap(); }
    if (!key) key = U.next.key;
    U.pick.hidden = true;
    const res = await S.commit(key);
    if (!res) { ui.close(); return false; }
    showToy(res);
    return true;
  }

  function showToy(res) {
    U.result = res;
    U.phase = 'shown';
    const it = D.item(res.key);
    if (!res.glitter || !U.stage.classList.contains('sq-revealed')) openLid();
    game.audio.play('success');
    // the toy springs up out of the box, lands, rises / wobbles, spins
    if (U.group) {
      const toy = sharedToy(res.key, res.glitter);
      toy.position.y = 0.2;
      U.group.add(toy);
      U.toy = toy;
      U.toyPress = presser(it.kind);
      U.anim = { kind: 'spring', t: 0, len: 0.75, land: false };
    } else if (U.fallback) {
      U.fallback.innerHTML = '';
      S.toyIcon(res.key, res.glitter).then((u) => {
        if (!U.fallback) return;
        const img = ui.el('img');
        img.alt = '';
        img.src = u;
        U.fallback.appendChild(img);
      });
    }
    if (res.glitter) setSay(t.nowSparkles, D.fmt('revealName', { name: it.name }), false, null, true);
    else setSay(t.newTag, D.fmt('revealName', { name: it.name }), false, res.first ? (it.kind === 'puff' ? t.firstPuff : t.firstStretch) : null);
    if (game.speak) game.speak(it.name);
    // buttons: Squish it!, Hold it, Squish Shelf, Next present!
    U.btns.innerHTML = '';
    U.btns.append(
      btn(t.btnSquish, () => squishShown(), 'pink', lifeIcon('squish')),
      btn(t.btnHold, () => { ui.close(); S.hold(res.key, res.glitter); }, 'lav', lifeIcon('heart')),
      btn(t.btnShelf, () => ui.open('squish', { key: res.key, glitter: res.glitter }), 'sky', shelfIcon()),
    );
    if (S.ready > 0) {
      const more = S.ready > 1 ? ` ×${S.ready}` : '';
      U.btns.append(btn(t.btnNext + more, () => startUnwrap(), 'sun', presentIc(), 'sq-next'));
    }
  }

  function squishShown() {
    if (!U.toyPress || !U.result) return;
    U.toyPress.tap();
    S.sfx('squish');
    S.sfx(D.item(U.result.key).kind === 'puff' ? 'rise' : 'stretch');
    S.squeezed(U.result.key, U.result.glitter, 'present');
  }

  function unwrapFrame(dt) {
    pv.yaw = 0;
    pv.pivot.rotation.y = 0;
    const g = U.group;
    if (!g) return;
    pumpQueue();
    const a = U.anim;
    const pr = U.present;
    if (a) {
      a.t = (now() - (a.t0 || (a.t0 = now()))) / 1000; // wall clock: a slow page caps dt
      const u = Math.min(1, a.t / a.len);
      if (a.kind === 'wiggle' && pr) {
        const w = Math.sin(u * Math.PI * 4) * a.amp * (1 - u);
        pr.rotation.z = w;
        const sq = 1 - Math.sin(u * Math.PI) * 0.12;
        pr.scale.set(1 / Math.sqrt(sq), sq, 1 / Math.sqrt(sq));
        const bow = pr.userData.parts && pr.userData.parts.bow;
        if (bow && a.bow) bow.rotation.z = Math.sin(u * Math.PI * 3) * 0.3;
      } else if (a.kind === 'spring' && U.toy) {
        // up out of the box, then down onto its top (y 0.58), squash on landing
        const top = 0.58;
        const y = u < 1 ? 0.2 + (top - 0.2) * u + Math.sin(u * Math.PI) * 0.32 : top;
        U.toy.position.y = y;
        U.toy.rotation.y = u * Math.PI * 2;
        if (u >= 1 && !a.land) {
          a.land = true;
          U.toyPress.tap();
          U.anim = { kind: 'spin', t: 0, len: 1e9 };
        }
      }
      if (a.kind === 'wiggle' && u >= 1 && U.anim === a) U.anim = null;
    }
    if (U.lid && pr) {
      const l = U.lid;
      l.t = (now() - (l.t0 || (l.t0 = now()))) / 1000;
      const u = Math.min(1, l.t / l.len);
      const lid = pr.userData.parts && pr.userData.parts.lid;
      if (lid) {
        lid.position.set(u * 0.45, 0.5 + u * 0.7 - u * u * 0.3, 0);
        lid.rotation.z = -u * 1.2;
        lid.visible = u < 1;
      }
      pr.rotation.z = 0;
      pr.scale.set(1, 1, 1);
      if (u >= 1) U.lid = null;
    }
    if (U.toy) {
      if (U.anim && U.anim.kind === 'spin' && !(U.toyPress && U.toyPress.held)) U.toy.rotation.y += dt * 0.6;
      const c = U.toyPress && U.toyPress.step(dt);
      const part = U.toy.userData.parts && U.toy.userData.parts.toy;
      if (part) {
        if (c) part.scale.set(c.sx, c.sy, c.sx);
        else if (part.scale.y !== 1) part.scale.set(1, 1, 1);
      }
    }
    g.rotation.y = U.phase === 'tap' ? Math.sin(performance.now() / 1400) * 0.25 : g.rotation.y;
  }

  function openPresent() {
    if (S.ready <= 0) return ui.open('squish');
    hideDrop();
    return ui.open('present');
  }

  // after the first present closes: the pill tip (once per device), then the Bag tip
  let presentWasOpen = false;
  ev.on('ui:open', ({ panel }) => {
    if (panel === 'present') presentWasOpen = true;
    if (drop && panel !== 'present') flyToButton(drop);
  });
  ev.on('ui:close', ({ panel }) => {
    if (panel !== 'present' || !presentWasOpen) return;
    presentWasOpen = false;
    if (!U.result) return;
    tipWanted = now(); // shown by tick() once the world is clear (the First Present! pop goes first)
  });
  let tipWanted = 0;
  const toastUp = () => {
    for (const el of ui.root.querySelectorAll('.sw-toast')) if (!el.classList.contains('sw-leave')) return true;
    return false;
  };
  function pumpTips() {
    if (!tipWanted || game.mode !== 'play') return;
    // a toast up top (e.g. "You're holding ... Press Squish!") goes first: the pill tip sits
    // just under the coin pill, right where the toast stack is on an upright phone
    // a waiting sticker pop (First Present!) goes first too: its own 500 ms clock starts on the
    // first frame after the close, so on a slow device the tip's clock could run out first
    const popWaiting = !!(game.stickers && game.stickers.pending && game.stickers.pending());
    if (blocked(game) || drop || toastUp() || popWaiting) { tipWanted = now(); return; }
    if (now() - tipWanted < 600) return;
    tipWanted = 0;
    if (!devGet('squishPillTip')) {
      devSet('squishPillTip', 1);
      pillTip();
    } else if (!devGet('squishBagTip')) {
      devSet('squishBagTip', 1);
      game.toast(t.bagTip, { icon: 'bag', key: 'squish-bag' });
    }
  }

  let tipEl = null;
  function pillTip() {
    const pill = coinPillEl();
    if (!pill) return;
    const rr = rootRect(), pr = pill.getBoundingClientRect();
    if (!pr.width) return;
    if (tipEl) tipEl.remove();
    const el = ui.el('div', 'sq-pilltip');
    const hand = ui.el('div', 'sq-hand');
    hand.innerHTML = fingerSvg();
    el.append(hand, ui.el('span', '', t.pillTip));
    el.style.left = `${pr.left - rr.left + pr.width / 2 - 24}px`;
    el.style.top = `${pr.bottom - rr.top + 4}px`;
    ui.root.appendChild(el);
    tipEl = el;
    const gone = () => {
      if (tipEl === el) tipEl = null;
      el.remove();
      window.removeEventListener('pointerdown', gone, true);
    };
    setTimeout(() => window.addEventListener('pointerdown', gone, true), 50);
    setTimeout(gone, 6000);
  }

  // ======================================================================================
  // the Squish Shelf (panel 'squish')
  // ======================================================================================

  const SH = { root: null, path: null, counts: null, tabs: null, grid: null, wood: null, detail: null, tab: 'all', openedAt: 0, onScreen: new Set(), show: {}, dPress: null, dObj: null, dKey: null, dGlit: false };

  ui.registerPanel('squish', {
    title: t.shelfTitle,
    icon: 'heart',
    width: 1000,
    build(container) {
      const root = ui.el('div', 'sq-shelf');
      SH.root = root;
      SH.path = ui.el('div', 'sq-path');
      SH.counts = ui.el('div', 'sq-counts');
      SH.tabs = ui.el('div', 'sq-tabs');
      SH.wood = ui.el('div', 'sq-wood');
      SH.grid = ui.el('div', 'sq-grid');
      SH.wood.appendChild(SH.grid);
      for (const [id, label] of [['all', t.tabAll], ['puff', t.tabPuff], ['stretch', t.tabStretch]]) {
        const b = ui.el('button');
        b.type = 'button';
        b.dataset.tab = id;
        b.innerHTML = id === 'all' ? shelfIcon() : id === 'puff' ? lifeIcon('squish') : sparkleSvg('#FF9CCB');
        b.appendChild(ui.el('span', '', label));
        b.addEventListener('click', () => {
          game.audio.play('click');
          SH.tab = id;
          renderShelf();
        });
        SH.tabs.appendChild(b);
      }
      root.append(SH.path, SH.counts, SH.tabs, SH.wood);
      container.appendChild(root);
    },
    onOpen(args) {
      SH.openedAt = now();
      S.refresh();
      renderShelf();
      if (!devGet('squishPathTip')) showPathTip();
      if (args && args.key && D.has(S.profile(), args.key)) openDetail(args.key, !!args.glitter && D.has(S.profile(), args.key, true));
    },
    onClose() {
      closeDetail();
      // NEW! tags clear when the shelf was open for at least 2 s (every one on screen)
      if (now() - SH.openedAt >= 2000) markSeen([...SH.onScreen]);
    },
  });
  setTitleIcon('squish', shelfIcon());

  function markSeen(ids) {
    const s = S.sq();
    if (!s || !ids.length) return;
    if (!s.seen || typeof s.seen !== 'object') s.seen = {};
    let changed = false;
    for (const id of ids) if (!s.seen[id]) { s.seen[id] = 1; changed = true; }
    if (changed) game.saveProfile();
  }

  function showPathTip() {
    const card = ui.el('div', 'sq-tip');
    const pics = ui.el('div', 'sq-tip-pics');
    const a = ui.el('span'); a.innerHTML = coinSvg();
    const b = ui.el('span', 'sq-arrow'); b.innerHTML = arrowSvg();
    const c = ui.el('span'); c.innerHTML = presentSvg();
    pics.append(a, b, c);
    card.append(pics, ui.el('b', '', t.tipFill), ui.el('span', '', t.tipSpend));
    card.appendChild(btn(t.ok, () => { devSet('squishPathTip', 1); card.remove(); }, 'lav'));
    SH.root.appendChild(card);
  }

  function renderShelf() {
    const p = S.profile();
    renderPath(p);
    // counters
    SH.counts.innerHTML = '';
    const total = D.ITEMS.length;
    const owned = D.owned(p), glit = D.ownedGlitter(p);
    const cnt = (ic, text, frac) => {
      const c = ui.el('div', 'sq-count');
      c.innerHTML = ic;
      c.appendChild(ui.el('span', '', text));
      const bar = ui.el('span', 'sq-cbar');
      const fill = ui.el('i');
      fill.style.width = `${Math.round(frac * 100)}%`;
      bar.appendChild(fill);
      c.appendChild(bar);
      return c;
    };
    SH.counts.appendChild(cnt(shelfIcon(), D.fmt('counter', { n: owned, total }), owned / total));
    if (owned >= total) SH.counts.appendChild(cnt(sparkleSvg(), D.fmt('counterGlitter', { n: glit, total }), glit / total));
    for (const b of SH.tabs.children) b.classList.toggle('sq-sel', b.dataset.tab === SH.tab);
    renderGrid(p);
  }

  function renderPath(p) {
    const el = SH.path;
    el.innerHTML = '';
    el.className = 'sq-path';
    if (D.complete(p)) {
      el.className = 'sq-champ';
      el.innerHTML = crownSvg();
      el.appendChild(ui.el('span', '', t.complete));
      return;
    }
    const next = ui.el('div', 'sq-path-next');
    const box = ui.el('div', 'sq-pbox');
    const ready = S.ready > 0;
    box.innerHTML = presentSvg({ open: false });
    next.appendChild(box);
    if (ready) {
      el.classList.add('sq-ready');
      next.appendChild(ui.el('div', 'sq-togo', t.pathReady));
      const open = btn(t.openIt, () => openPresent(), 'pink', presentIc(), 'sq-openit');
      next.appendChild(open);
    } else {
      const bar = ui.el('div', 'sq-bar');
      const fill = ui.el('i');
      const r = game.squish.ring();
      fill.style.width = `${Math.round((typeof r.frac === 'number' ? r.frac : 0) * 100)}%`;
      bar.appendChild(fill);
      next.appendChild(bar);
      const togo = ui.el('div', 'sq-togo');
      togo.innerHTML = coinSvg();
      const n = D.hasValidBase(p) ? D.toNext(p) : Math.max(0, D.FIRST - D.earned(p));
      togo.appendChild(ui.el('span', '', D.fmt('toGo', { n: n === null ? 0 : n })));
      next.appendChild(togo);
    }
    el.appendChild(next);
    for (let i = 0; i < 2; i++) {
      el.appendChild(ui.el('div', 'sq-dots'));
      const g = ui.el('div', 'sq-path-grey');
      g.innerHTML = presentSvg({ grey: true });
      el.appendChild(g);
    }
    if (D.owned(p) >= D.ITEMS.length) el.appendChild(ui.el('div', 'sq-path-msg', t.nextGlitter));
  }

  function renderGrid(p) {
    SH.grid.innerHTML = '';
    SH.onScreen.clear();
    const s = S.sq() || {};
    const seen = s.seen || {};
    const list = D.ITEMS.filter((it) => SH.tab === 'all' || it.kind === SH.tab);
    // every picture the shelf shows (and the sparkly ones she owns), drawn in batches
    S.queuePics([
      ...list.map((it) => ({ key: it.key, glitter: D.has(p, it.key, true) && !!SH.show[it.key] })),
      ...list.filter((it) => D.has(p, it.key, true)).map((it) => ({ key: it.key, glitter: !SH.show[it.key] })),
    ]);
    for (const it of list) {
      const own = D.has(p, it.key);
      const ownG = D.has(p, it.key, true);
      const showG = ownG && !!SH.show[it.key];
      const c = ui.el('button', 'sq-cubby' + (own ? '' : ' sq-mystery') + (showG ? ' sq-g' : ''));
      c.type = 'button';
      c.dataset.key = it.key;
      const ph = ui.el('span', 'sq-ph');
      c.appendChild(ph);
      S.toyIcon(it.key, showG, 'high').then((u) => {
        if (!u || !c.isConnected) return;
        const img = ui.el('img');
        img.alt = '';
        img.src = u;
        ph.replaceWith(img);
      });
      if (!own) {
        c.setAttribute('aria-label', t.mystery);
        c.appendChild(ui.el('span', 'sq-q', '?'));
      } else {
        c.setAttribute('aria-label', it.name);
        c.appendChild(ui.el('span', 'sq-name', it.name));
        const id = showG ? it.key + ':g' : it.key;
        if (!seen[id]) {
          c.appendChild(ui.el('span', 'sq-new', t.newTag));
          SH.onScreen.add(id);
        }
        if (ownG) {
          const gb = ui.el('span', 'sq-gbtn');
          gb.setAttribute('role', 'button');
          gb.setAttribute('aria-label', t.glitter);
          gb.innerHTML = starSvg();
          gb.addEventListener('click', (e) => {
            e.stopPropagation();
            SH.show[it.key] = !SH.show[it.key];
            renderGrid(S.profile());
          });
          c.appendChild(gb);
        }
        c.addEventListener('click', () => {
          markSeen([id]);
          openDetail(it.key, showG);
        });
      }
      SH.grid.appendChild(c);
    }
  }

  // ---------- the detail card: press it ----------

  function openDetail(key, glitter = false) {
    closeDetail();
    const it = D.item(key);
    SH.dKey = key;
    SH.dGlit = glitter;
    const d = ui.el('div', 'sq-detail');
    d.appendChild(ui.el('h3', '', it.name));
    const stage = ui.el('div', 'sq-stage');
    d.appendChild(stage);
    const press = ui.el('div', 'sq-press');
    press.innerHTML = pressSvg();
    press.appendChild(ui.el('span', '', it.kind === 'puff' ? t.pressPuff : t.pressStretch));
    d.appendChild(press);
    const row = ui.el('div', 'sq-btns');
    row.appendChild(btn(t.btnHold, () => { ui.close(); S.hold(SH.dKey, SH.dGlit); }, 'lav', lifeIcon('heart')));
    if (D.has(S.profile(), key, true)) row.appendChild(btn(t.glitter, () => openDetail(SH.dKey, !SH.dGlit), 'sun', starSvg()));
    row.appendChild(btn(t.back, () => closeDetail(), 'white'));
    d.appendChild(row);
    SH.root.appendChild(d);
    SH.detail = d;
    SH.dPress = presser(it.kind);
    const obj = sharedToy(key, glitter);
    SH.dObj = obj;
    const ok = mountStage(stage, obj, { spin: 0, yaw: 0, dir: [0, 0.35, 1], lift: 0.45, zoom: 1.05 }, (dt) => {
      const c = SH.dPress && SH.dPress.step(dt);
      const part = obj.userData.parts && obj.userData.parts.toy;
      if (part) {
        if (c) part.scale.set(c.sx, c.sy, c.sx);
        else if (part.scale.y !== 1) part.scale.set(1, 1, 1);
      }
    });
    let fb = null;
    if (!ok) {
      fb = fallbackImg(stage, null);
      S.toyIcon(key, glitter).then((u) => {
        const img = ui.el('img');
        img.alt = '';
        img.src = u;
        fb.appendChild(img);
      });
    }
    // any press without a drag does something; a drag of more than 8 px spins instead
    let down = null;
    stage.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      down = { x: e.clientX, y: e.clientY };
      SH.dPress.press();
      S.sfx('squish');
      S.squeezed(SH.dKey, SH.dGlit, 'shelf');
      if (fb && fb.firstChild) fb.firstChild.style.transform = it.kind === 'puff' ? 'scale(1.2, .5)' : 'scale(.85, 1.4)';
    });
    stage.addEventListener('pointermove', (e) => {
      if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 8) {
        down = null;
        SH.dPress.release();
      }
    });
    const up = () => {
      if (!down && !SH.dPress.held) return;
      down = null;
      if (SH.dPress.held) {
        SH.dPress.release();
        S.sfx(it.kind === 'puff' ? 'rise' : 'stretch');
      }
      if (fb && fb.firstChild) fb.firstChild.style.transform = '';
    };
    for (const ty of ['pointerup', 'pointercancel', 'pointerleave']) stage.addEventListener(ty, up);
    stage.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  function closeDetail() {
    if (!SH.detail) return;
    const stage = SH.detail.querySelector('.sq-stage');
    if (pv.host === stage) {
      pv.clear();
      pv.unmount();
    }
    SH.detail.remove();
    SH.detail = null;
    SH.dPress = null;
    SH.dObj = null;
  }

  /** Press the toy on whichever stage is showing (probes): ms 0 = a tap. */
  async function squeezeShown(ms = 0) {
    const pr = ui.current === 'present' ? U.toyPress : SH.dPress;
    if (!pr) return false;
    if (!ms) {
      pr.tap();
      return true;
    }
    pr.press();
    await new Promise((r) => setTimeout(r, ms));
    pr.release();
    return true;
  }

  /** The probes read the shown toy's part scale. */
  const shownSy = () => {
    const pr = ui.current === 'present' ? U.toyPress : SH.dPress;
    return pr ? pr.peek() : null;
  };

  // ---------- the Bag tab's Squish Shelf button ----------

  function shelfButton({ variant = 'pink', onClick = null, className = '' } = {}) {
    const b = ui.button({ label: t.btnShelf, variant, className: 'sq-shelfbtn ' + className, onClick: onClick || (() => game.runAction('squish')) });
    b.insertAdjacentHTML('afterbegin', shelfIcon());
    return b;
  }
  ev.on('bag:tab', ({ tab, main }) => {
    if (tab !== 'squish' || !main) return;
    const row = ui.el('div', 'sq-bagbtn');
    row.appendChild(shelfButton({ variant: 'pink', onClick: () => ui.open('squish') }));
    main.appendChild(row); // right under the tab's heading (the grid comes after)
  });

  // ======================================================================================
  // per frame
  // ======================================================================================

  function tick() {
    if (ui.current === 'present') pumpQueue();
    pumpTips();
    if (drop && blocked(game) && !ui.current) {
      // a bubble or pop came up over it: it waits on the Present button instead
      flyToButton(drop);
    }
  }

  return {
    tick,
    showDrop,
    hideDrop,
    get dropShowing() { return !!drop; },
    dropBlocked: () => blocked(game) || !!drop,
    openPresent,
    tapPresent: () => tapPresent(true),
    pick,
    squeezeShown,
    shownSy,
    shelfButton,
    unwrapState: () => ({ phase: U.phase, taps: U.taps, queue: U.queue, result: U.result, finger: !!U.finger, cushion: cushionColor() }),
  };
}
