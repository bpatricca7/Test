// In-world HUD: hotbar (1-9 / tap), Bag + Undo, tool buttons (Build / Remove / Hand), Fly,
// Emotes, Photo, top-left world name + time icon + gems, top-right Dress Up / Stickers /
// Menu, touch Jump / Up / Down buttons, crosshair, and the sparkly 3D target outline.

import * as THREE from 'three';
import { icon2 as icon } from './menus/icons2.js';

const CSS = /* css */ `
.sw-hud { position: absolute; inset: 0; pointer-events: none !important; display: none; }
.sw-hud.sw-on { display: block; }
.sw-hud * { pointer-events: auto; }
.sw-hud .sw-passive, .sw-hud .sw-passive * { pointer-events: none; }
/* layout containers let touches through their empty space; only what is inside them is tappable */
.sw-hud .sw-hud-right, .sw-hud .sw-hud-extras, .sw-hud .sw-hud-tr, .sw-hud .sw-hud-tl, .sw-hud .sw-hud-counts, .sw-hud .sw-hud-bottom { pointer-events: none; }

/* top-left: the world name, then the counts (gems, Sparkle Coins); the name gives way (it
   ends in "…") so the row never runs under the top-right buttons */
.sw-hud-tl { position: absolute; top: calc(12px + var(--sw-safe-t)); left: calc(12px + var(--sw-safe-l)); display: flex; gap: 8px; align-items: center; max-width: min(52vw, calc(100vw - 460px)); }
.sw-hud-counts { display: flex; gap: 8px; align-items: center; flex: none; }
.sw-hud-counts .sw-pill { flex: none; }
.sw-pill { display: inline-flex; align-items: center; gap: 8px; height: 46px; padding: 0 16px 0 10px; border-radius: 999px; background: rgba(255,255,255,.92); border: 4px solid #fff; box-shadow: 0 5px 14px var(--sw-shadow); font-size: 19px; font-weight: 600; color: var(--sw-ink); white-space: nowrap; min-width: 0; }
.sw-pill svg { width: 28px; height: 28px; flex: none; }
.sw-pill .sw-name { overflow: hidden; text-overflow: ellipsis; }
.sw-time svg { color: #FFB300; }
.sw-time.sw-night svg { color: var(--sw-lav); }
.sw-gems svg { color: var(--sw-mint); }
.sw-coins svg { color: #F5A300; }
.sw-pill[hidden], .sw-hud [hidden] { display: none !important; }
.sw-round--small .sw-round-face { width: 46px; height: 46px; }
.sw-round--small .sw-round-face svg { width: 26px; height: 26px; }
/* playing with friends: Players count badge and the connection pill */
.sw-round .sw-count { position: absolute; top: -6px; right: -8px; min-width: 28px; height: 28px; padding: 0 6px; border-radius: 999px; background: var(--sw-pink); color: #fff; border: 3px solid #fff; font-size: 16px; font-weight: 700; line-height: 22px; text-align: center; box-shadow: 0 2px 6px var(--sw-shadow); pointer-events: none; }
.sw-round.sw-playersbtn { position: relative; }
/* with Say in a session the extras sit two by two (mouse layout), so the column stays clear of
   the top-right buttons on a 800 px tall screen */
.sw-hud.sw-in-session:not(.sw-touchmode) .sw-hud-extras { display: grid; grid-template-columns: repeat(2, auto); gap: 8px 6px; justify-items: center; }
.sw-net-pill svg { color: var(--sw-sky); }
/* "Reconnecting…" / "Sending…" takes the counts' place for a moment (the corner never grows) */
.sw-hud.sw-net-trouble .sw-hud-counts .sw-gems, .sw-hud.sw-net-trouble .sw-hud-counts .sw-coins { display: none !important; }
.sw-net-pill.sw-sending svg { color: var(--sw-pink); animation: sw-twinkle 1.2s ease-in-out infinite; }

.sw-hud-tr { position: absolute; top: calc(10px + var(--sw-safe-t)); right: calc(12px + var(--sw-safe-r)); display: flex; gap: 10px; }
.sw-round { display: flex; flex-direction: column; align-items: center; gap: 3px; background: none; border: 0; padding: 0; cursor: pointer; font-family: var(--sw-font); -webkit-user-select: none; user-select: none; touch-action: manipulation; }
.sw-round-face { width: 58px; height: 58px; border-radius: 50%; display: grid; place-items: center; background: var(--c, var(--sw-pink)); color: #fff; border: 4px solid #fff; box-shadow: 0 5px 0 rgba(58,31,77,.14), 0 8px 18px var(--sw-shadow), inset 0 -5px 0 rgba(0,0,0,.08), inset 0 4px 0 rgba(255,255,255,.3); transition: transform .18s var(--sw-bounce); }
.sw-round-face svg { width: 32px; height: 32px; filter: drop-shadow(0 2px 0 rgba(58,31,77,.15)); }
/* positioned (no z-index) so it paints after the face, which gets a transform when active */
.sw-round-label { position: relative; font-size: 15px; font-weight: 700; color: var(--sw-ink); background: rgba(255,255,255,.92); padding: 1px 8px; border-radius: 999px; box-shadow: 0 2px 6px var(--sw-shadow); }
.sw-round:hover .sw-round-face { transform: scale(1.06); }
.sw-round:active .sw-round-face { transform: scale(.9); }
.sw-round.sw-active .sw-round-face { box-shadow: 0 0 0 5px var(--sw-sun), 0 8px 22px var(--sw-shadow), inset 0 -5px 0 rgba(0,0,0,.08); transform: scale(1.1); }
.sw-round.sw-active .sw-round-label { background: var(--sw-sun); }
.sw-round--big .sw-round-face { width: 70px; height: 70px; }
.sw-round--big .sw-round-face svg { width: 38px; height: 38px; }
.sw-round[hidden] { display: none; }

.sw-hud-right { position: absolute; right: calc(14px + var(--sw-safe-r)); top: 50%; transform: translateY(-50%); display: flex; flex-direction: column; gap: 10px; align-items: center; }
.sw-hud-right .sw-sep { height: 4px; width: 36px; border-radius: 4px; background: rgba(255,255,255,.7); margin: 2px 0; }
.sw-hud-extras { display: flex; flex-direction: column; gap: 10px; align-items: center; }

/* touch: the tools hang from the top so the Jump button has the bottom-right corner; the
   extra buttons sit in a row and Up / Down (while flying) side by side */
.sw-hud.sw-touchmode .sw-hud-right { top: calc(100px + var(--sw-safe-t)); transform: none; gap: 8px; align-items: flex-end; }
.sw-hud.sw-touchmode .sw-hud-right > .sw-round { min-width: 72px; }
.sw-hud.sw-touchmode .sw-hud-right .sw-sep { align-self: flex-end; margin-right: 18px; }
.sw-hud.sw-touchmode .sw-hud-extras { flex-direction: row; gap: 6px; align-items: flex-start; }
.sw-hud.sw-touchmode .sw-hud-extras .sw-round-face { width: 52px; height: 52px; }
.sw-hud.sw-touchmode .sw-hud-extras .sw-round-face svg { width: 28px; height: 28px; }
.sw-hud.sw-touchmode .sw-hud-extras .sw-round-label { font-size: 13px; padding: 0 6px; }
.sw-hud.sw-touchmode .sw-touch { flex-direction: row; align-items: flex-end; bottom: calc(104px + var(--sw-safe-b)); }
.sw-hud.sw-touchmode .sw-touch .sw-flybtn .sw-round-face { width: 64px; height: 64px; }

.sw-hud-bottom { position: absolute; left: 50%; bottom: calc(12px + var(--sw-safe-b)); transform: translateX(-50%); display: flex; align-items: flex-end; gap: 12px; }
.sw-hotbar { display: flex; gap: 6px; padding: 7px; border-radius: 26px; background: rgba(255,255,255,.55); border: 4px solid rgba(255,255,255,.9); box-shadow: 0 8px 22px var(--sw-shadow); backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px); }
.sw-slot { position: relative; width: 60px; height: 60px; border-radius: 18px; background: var(--sw-cream); border: 3px solid #fff; box-shadow: inset 0 -4px 0 rgba(58,31,77,.08); display: grid; place-items: center; cursor: pointer; padding: 0; transition: transform .18s var(--sw-bounce), box-shadow .18s; touch-action: manipulation; }
.sw-slot img { width: 46px; height: 46px; image-rendering: auto; pointer-events: none; }
.sw-slot .sw-num { position: absolute; top: 2px; left: 6px; font-size: 12px; font-weight: 700; color: rgba(58,31,77,.45); pointer-events: none; }
.sw-slot .sw-swatch { position: absolute; bottom: 4px; right: 4px; width: 12px; height: 12px; border-radius: 50%; border: 2px solid #fff; pointer-events: none; }
.sw-slot.sw-sel { transform: translateY(-8px) scale(1.12); background: #fff; border-color: var(--sw-pink); box-shadow: 0 0 0 4px #fff, 0 0 18px 6px rgba(255,95,162,.55), 0 8px 16px var(--sw-shadow); }
.sw-slot:active { transform: scale(.92); }

.sw-crosshair { position: absolute; left: 50%; top: 50%; width: 22px; height: 22px; margin: -11px 0 0 -11px; pointer-events: none !important; display: none; }
.sw-crosshair::before, .sw-crosshair::after { content: ''; position: absolute; background: #fff; border-radius: 3px; box-shadow: 0 0 0 1.5px rgba(58,31,77,.35); }
.sw-crosshair::before { left: 9px; top: 2px; width: 4px; height: 18px; }
.sw-crosshair::after { top: 9px; left: 2px; height: 4px; width: 18px; }
.sw-crosshair.sw-show { display: block; }

.sw-touch { position: absolute; right: calc(16px + var(--sw-safe-r)); bottom: calc(112px + var(--sw-safe-b)); display: none; flex-direction: column; gap: 10px; align-items: center; }
.sw-touch.sw-show { display: flex; }
.sw-touch .sw-round-face { width: 78px; height: 78px; }
.sw-touch .sw-round-face svg { width: 40px; height: 40px; }
.sw-touch .sw-flybtn .sw-round-face { width: 60px; height: 60px; }
.sw-touch .sw-flybtn[hidden] { display: none; }

.sw-app:not(.sw-playing) .sw-joy { display: none !important; }
.sw-joy { position: absolute; left: calc(84px + var(--sw-safe-l)); bottom: calc(190px + var(--sw-safe-b)); width: 124px; height: 124px; margin: -62px 0 0 -62px; transform: translate(0, 50%); border-radius: 50%; background: rgba(255,255,255,.28); border: 4px solid rgba(255,255,255,.75); box-shadow: 0 6px 18px var(--sw-shadow); pointer-events: none; z-index: 5; }
.sw-joy.active { bottom: auto; transform: none; background: rgba(255,255,255,.36); }
.sw-joy-thumb { position: absolute; left: 50%; top: 50%; width: 56px; height: 56px; border-radius: 50%; background: var(--sw-pink); border: 4px solid #fff; box-shadow: 0 4px 12px var(--sw-shadow); transform: translate(-50%, -50%); }

/* the spacer only matters on phones (it pushes Bag / Undo apart above the hotbar) */
.sw-hud-bottom .sw-spacer { display: none; }
/* narrow tablets (iPad portrait 768 / 810 / 820 wide): slightly smaller slots and gaps so Bag
   and Undo stay on screen next to the hotbar (the desktop row is ~764 px wide) */
@media (max-width: 860px) {
  .sw-slot { width: 54px; height: 54px; border-radius: 16px; }
  .sw-slot img { width: 42px; height: 42px; }
  .sw-hotbar { gap: 4px; padding: 6px; }
  .sw-hud-bottom { gap: 8px; }
}
@media (max-width: 760px), (max-height: 520px) {
  .sw-slot { width: 44px; height: 44px; border-radius: 14px; border-width: 2px; }
  .sw-slot img { width: 34px; height: 34px; }
  .sw-slot .sw-num { display: none; }
  .sw-hotbar { gap: 3px; padding: 4px; border-radius: 20px; border-width: 3px; }
  .sw-hud-bottom { gap: 6px; }
  .sw-round-face { width: 50px; height: 50px; border-width: 3px; }
  .sw-round-face svg { width: 27px; height: 27px; }
  .sw-round--big .sw-round-face { width: 58px; height: 58px; }
  .sw-round--big .sw-round-face svg { width: 32px; height: 32px; }
  .sw-round-label { font-size: 13px; }
  .sw-pill { height: 40px; font-size: 16px; padding: 0 12px 0 8px; }
  .sw-pill svg { width: 24px; height: 24px; }
  .sw-hud-right { gap: 6px; }
}
@media (max-width: 480px) {
  .sw-hud-bottom { left: 0; right: 0; transform: none; justify-content: center; flex-wrap: wrap; bottom: calc(8px + var(--sw-safe-b)); }
  .sw-hud-bottom .sw-hotbar { order: 3; width: 100%; max-width: 380px; justify-content: space-between; margin: 0 8px; }
  .sw-slot { width: calc((100vw - 56px) / 9); height: calc((100vw - 56px) / 9); max-width: 44px; max-height: 44px; }
  .sw-slot img { width: 78%; height: 78%; }
  .sw-hud-bottom .sw-bagbtn, .sw-hud-bottom .sw-undobtn { order: 1; }
  .sw-hud-bottom .sw-undobtn { order: 2; }
  .sw-hud-bottom .sw-spacer { display: block; order: 1; flex: 1; }
  .sw-hud-tr .sw-round-label { display: none; }
  .sw-hud-tr { gap: 6px; }
  .sw-hud-tr .sw-round-face { width: 46px; height: 46px; }
  .sw-hud-tl { max-width: 48vw; flex-direction: column; align-items: flex-start; gap: 6px; }
  .sw-touch { bottom: calc(150px + var(--sw-safe-b)); }
  .sw-joy { bottom: calc(230px + var(--sw-safe-b)); left: calc(78px + var(--sw-safe-l)); }
  .sw-hud-right { top: auto; bottom: calc(300px + var(--sw-safe-b)); transform: none; }
  .sw-hud.sw-touchmode .sw-hud-right { top: auto; bottom: calc(296px + var(--sw-safe-b)); gap: 6px; }
  .sw-hud.sw-touchmode .sw-touch { bottom: calc(150px + var(--sw-safe-b)); }
  .sw-hud.sw-touchmode .sw-hud-extras .sw-round-face { width: 46px; height: 46px; }
  .sw-hud.sw-touchmode .sw-hud-extras .sw-round-face svg { width: 25px; height: 25px; }
  .sw-hud-tl { max-width: 40vw; }
  .sw-hud-tl .sw-pill { max-width: 100%; }
  /* the counts share one row under the name, below the top-right buttons */
  .sw-hud-counts { gap: 6px; }
  .sw-hud-tl .sw-hud-counts .sw-pill { max-width: none; }
  .sw-hud-tr .sw-round--small .sw-round-face { width: 38px; height: 38px; }
  .sw-hud-tr .sw-round--small .sw-round-face svg { width: 22px; height: 22px; }
  /* playing together on a phone: Players takes Help's place (Help stays in the Menu) */
  .sw-hud.sw-in-session .sw-hud-tr .sw-helpbtn { display: none; }
  .sw-round .sw-count { min-width: 24px; height: 24px; font-size: 14px; line-height: 18px; top: -5px; right: -6px; }
}
/* shorter phones (375x667): the tools a little smaller so the column stays under the top row */
@media (max-width: 480px) and (max-height: 740px) {
  .sw-hud-right .sw-round--big .sw-round-face { width: 50px; height: 50px; }
  .sw-hud-right .sw-round--big .sw-round-face svg { width: 27px; height: 27px; }
}
/* portrait tablets (iPad 768 / 810 / 820 / 834 wide): the name on its own row, the counts
   under it, so neither runs under the five top-right buttons */
@media (min-width: 481px) and (max-width: 900px) and (min-height: 521px) {
  .sw-hud-tl { flex-direction: column; align-items: flex-start; max-width: calc(100vw - 450px); }
  .sw-hud-tl .sw-time { max-width: 100%; }
}
/* phones held sideways (844x390) and other short screens: one top row, the life column and
   the joystick on the left, the tools in a column at the right edge with Fly / Emotes / Say /
   Photo two by two beside them, Jump (or Up / Down) under the tools, and Bag / hotbar / Undo
   along the bottom between the joystick and Jump */
@media (max-height: 520px) and (min-width: 481px) {
  .sw-hud-tl { max-width: min(52vw, calc(100vw - 300px)); }
  .sw-hud-tr { gap: 6px; }
  .sw-hud-tr .sw-round-label { display: none; }
  .sw-hud-tr .sw-round-face { width: 46px; height: 46px; }
  .sw-hud-tr .sw-round--small .sw-round-face { width: 38px; height: 38px; }
  .sw-hud-tr .sw-round--small .sw-round-face svg { width: 22px; height: 22px; }
  .sw-round .sw-count { min-width: 24px; height: 24px; font-size: 14px; line-height: 18px; top: -5px; right: -6px; }
  .sw-hud .sw-hud-right, .sw-hud.sw-touchmode .sw-hud-right { top: calc(62px + var(--sw-safe-t)); bottom: auto; transform: none; flex-direction: column; flex-wrap: wrap-reverse; align-content: flex-start; align-items: center; max-height: 240px; gap: 6px 8px; }
  .sw-hud .sw-hud-right .sw-sep { display: none; }
  .sw-hud-right .sw-round--big .sw-round-face { width: 50px; height: 50px; }
  .sw-hud-right .sw-round--big .sw-round-face svg { width: 27px; height: 27px; }
  .sw-hud .sw-hud-extras, .sw-hud.sw-touchmode .sw-hud-extras, .sw-hud.sw-in-session:not(.sw-touchmode) .sw-hud-extras { display: grid; grid-template-columns: repeat(2, auto); gap: 6px; justify-items: center; align-items: start; }
  .sw-hud.sw-touchmode .sw-hud-extras .sw-round-face { width: 46px; height: 46px; }
  .sw-hud.sw-touchmode .sw-hud-extras .sw-round-face svg { width: 25px; height: 25px; }
  .sw-hud.sw-touchmode .sw-touch { right: calc(14px + var(--sw-safe-r)); bottom: calc(8px + var(--sw-safe-b)); }
  .sw-touch .sw-round-face { width: 56px; height: 56px; }
  .sw-touch .sw-round-face svg { width: 30px; height: 30px; }
  .sw-hud.sw-touchmode .sw-touch .sw-flybtn .sw-round-face { width: 54px; height: 54px; }
  .sw-hud.sw-touchmode .sw-hud-bottom { left: calc(150px + var(--sw-safe-l)); transform: none; bottom: calc(8px + var(--sw-safe-b)); }
  .sw-hud.sw-touchmode .sw-slot { width: clamp(28px, calc((100vw - 460px) / 9), 44px); height: clamp(28px, calc((100vw - 460px) / 9), 44px); }
  .sw-hud.sw-touchmode .sw-slot img { width: 78%; height: 78%; }
  .sw-joy { bottom: calc(92px + var(--sw-safe-b)); left: calc(78px + var(--sw-safe-l)); }
}
/* very short screens (740x360): the tool and Fly / Emotes labels give way to the pictures */
@media (max-height: 380px) and (min-width: 481px) {
  .sw-hud-right .sw-round-label { display: none; }
  .sw-hud .sw-hud-right, .sw-hud.sw-touchmode .sw-hud-right { max-height: 180px; }
}
/* narrow short screens (667x375): Up and Down one above the other at the right edge */
@media (max-height: 520px) and (min-width: 481px) and (max-width: 720px) {
  .sw-hud.sw-touchmode .sw-touch { flex-direction: column; align-items: flex-end; gap: 6px; }
  .sw-hud.sw-touchmode .sw-touch .sw-flybtn .sw-round-label { display: none; }
}
`;

const TOOL_COLORS = { build: '#FF5FA2', remove: '#FF7A7A', hand: '#3FD8B0' };

/** Round icon button with a sticker label underneath. */
function roundButton(ui, { icon: ic, label, color, big = false, onClick }) {
  const b = ui.el('button', 'sw-round' + (big ? ' sw-round--big' : ''));
  b.type = 'button';
  b.setAttribute('aria-label', label);
  const face = ui.el('span', 'sw-round-face');
  face.style.setProperty('--c', color);
  face.innerHTML = icon(ic);
  b.append(face, ui.el('span', 'sw-round-label', label));
  if (onClick) {
    b.addEventListener('click', (e) => {
      ui.game.audio.play('click');
      onClick(e);
    });
  }
  return b;
}

/** Hold-able touch button feeding input.press(name). */
function holdButton(ui, { icon: ic, label, color, name, className = '' }) {
  const b = roundButton(ui, { icon: ic, label, color });
  if (className) b.classList.add(className);
  const input = ui.game.input;
  const down = (e) => { e.preventDefault(); input.press(name, true); ui.game.audio.unlock(); };
  const up = () => input.press(name, false);
  b.addEventListener('pointerdown', down);
  b.addEventListener('pointerup', up);
  b.addEventListener('pointercancel', up);
  b.addEventListener('pointerleave', up);
  b.addEventListener('contextmenu', (e) => e.preventDefault());
  return b;
}

/** Sparkly outline around the targeted block/pickable plus a glow on the targeted face. */
class TargetOutline {
  constructor(game) {
    this.game = game;
    this.group = new THREE.Group();
    this.group.name = 'target-outline';
    this.group.visible = false;
    this.group.renderOrder = 5;
    this.mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false });
    const unit = new THREE.BoxGeometry(1, 1, 1);
    this.edges = [];
    for (let i = 0; i < 12; i++) {
      const m = new THREE.Mesh(unit, this.mat);
      this.edges.push(m);
      this.group.add(m);
    }
    this.faceMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.face = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.faceMat);
    this.group.add(this.face);
    // what the outline was last built for (numbers only: update() runs every frame and must
    // not allocate): [kind (0 none, 1 block, 2 pickable), six numbers], plus the tool
    this._last = new Float64Array(7);
    this._lastTool = null;
    this._min = new THREE.Vector3();
    this._max = new THREE.Vector3();
    this._t = 0;
    this._white = new THREE.Color(1, 1, 1);
    // parsed once: Color.set('#hex') runs regexes, too costly for every frame
    this._toolColors = {};
    for (const [k, v] of Object.entries(TOOL_COLORS)) this._toolColors[k] = new THREE.Color(v);
    game.scene.add(this.group);
  }

  setBox(min, max, faceNormal) {
    const e = 0.012, th = 0.035;
    const x0 = min.x - e, y0 = min.y - e, z0 = min.z - e;
    const x1 = max.x + e, y1 = max.y + e, z1 = max.z + e;
    const sx = x1 - x0, sy = y1 - y0, sz = z1 - z0;
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, cz = (z0 + z1) / 2;
    let i = 0;
    const put = (px, py, pz, w, h, d) => {
      const m = this.edges[i++];
      m.position.set(px, py, pz);
      m.scale.set(w, h, d);
    };
    for (const y of [y0, y1]) for (const z of [z0, z1]) put(cx, y, z, sx + th, th, th);
    for (const x of [x0, x1]) for (const z of [z0, z1]) put(x, cy, z, th, sy + th, th);
    for (const x of [x0, x1]) for (const y of [y0, y1]) put(x, y, cz, th, th, sz + th);
    if (faceNormal) {
      const [nx, ny, nz] = faceNormal;
      this.face.visible = true;
      this.face.position.set(nx ? (nx > 0 ? x1 : x0) : cx, ny ? (ny > 0 ? y1 : y0) : cy, nz ? (nz > 0 ? z1 : z0) : cz);
      this.face.rotation.set(0, 0, 0);
      if (nx) { this.face.rotation.y = Math.PI / 2; this.face.scale.set(sz, sy, 1); }
      else if (ny) { this.face.rotation.x = -Math.PI / 2; this.face.scale.set(sx, sz, 1); }
      else this.face.scale.set(sx, sy, 1);
    } else {
      this.face.visible = false;
    }
  }

  /** True when the outline already shows this target; otherwise remembers it and returns false. */
  _same(kind, a, b, c, d, e, f, tool) {
    const k = this._last;
    if (k[0] === kind && k[1] === a && k[2] === b && k[3] === c && k[4] === d && k[5] === e && k[6] === f && this._lastTool === tool) return true;
    k[0] = kind; k[1] = a; k[2] = b; k[3] = c; k[4] = d; k[5] = e; k[6] = f;
    this._lastTool = tool;
    return false;
  }

  update(dt) {
    const g = this.game;
    const t = g.mode === 'play' && !g.paused ? g.target : null;
    if (!t || this.hidden) {
      this.group.visible = false;
      this._last[0] = 0;
      return;
    }
    this._t += dt;
    const tool = g.selectedTool;
    if (t.type === 'block') {
      const f = t.face;
      const faceCode = f ? (f[0] + 1) * 9 + (f[1] + 1) * 3 + (f[2] + 1) : -1;
      if (!this._same(1, t.x, t.y, t.z, faceCode, t.id, 0, tool)) {
        const box = g.registry.blocks.byId(t.id);
        const shape = box ? box.shape : 'cube';
        const h = shape === 'slab' ? 0.5 : shape === 'carpet' ? 1 / 16 : 1;
        const inset = shape === 'cross' ? 0.15 : 0;
        this._min.set(t.x + inset, t.y, t.z + inset);
        this._max.set(t.x + 1 - inset, t.y + h * (shape === 'cross' ? 0.9 : 1), t.z + 1 - inset);
        this.setBox(this._min, this._max, tool === 'build' ? f : null);
      }
    } else {
      const b = t.pickable.box;
      if (!this._same(2, b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z, tool)) this.setBox(b.min, b.max, null);
    }
    this.mat.color.copy(this._toolColors[tool] || this._white).lerp(this._white, 0.35 + 0.25 * Math.sin(this._t * 5));
    this.mat.opacity = 0.75 + 0.2 * Math.sin(this._t * 5);
    this.group.visible = true;
  }
}

export function install(game) {
  const ui = game.ui;
  ui.addStyles(CSS);
  const hud = ui.el('div', 'sw-hud');
  ui.hudLayer.appendChild(hud);

  // top-left: world name + time of day, gems, Sparkle Coins
  const tl = ui.el('div', 'sw-hud-tl');
  const namePill = ui.el('div', 'sw-pill sw-time sw-passive');
  const nameText = ui.el('span', 'sw-name', '');
  namePill.innerHTML = icon('sun');
  namePill.appendChild(nameText);
  const gemPill = ui.el('div', 'sw-pill sw-gems sw-passive');
  gemPill.innerHTML = icon('gem');
  const gemText = ui.el('span', '', '0');
  gemPill.appendChild(gemText);
  const coinPill = ui.el('div', 'sw-pill sw-coins sw-passive');
  coinPill.innerHTML = icon('coin');
  const coinText = ui.el('span', '', '0');
  coinPill.appendChild(coinText);
  coinPill.hidden = true;
  // playing with friends: "Reconnecting…" / "Sending…" while it matters
  const netPill = ui.el('div', 'sw-pill sw-net-pill sw-passive');
  netPill.innerHTML = icon('cloud');
  const netText = ui.el('span', '', 'Reconnecting…');
  netPill.appendChild(netText);
  netPill.hidden = true;
  // the counts sit together (one row under the name on phones and portrait tablets, beside it
  // on wide screens); "Reconnecting…" takes their place for a moment
  const counts = ui.el('div', 'sw-hud-counts');
  counts.append(gemPill, coinPill, netPill);
  tl.append(namePill, counts);

  // top-right: Dress Up, Stickers, Menu
  const tr = ui.el('div', 'sw-hud-tr');
  const dressBtn = roundButton(ui, { icon: 'dress', label: 'Dress Up', color: 'var(--sw-lav)', onClick: () => game.runAction('dressup') });
  const stickerBtn = roundButton(ui, { icon: 'sticker', label: 'Stickers', color: 'var(--sw-sun)', onClick: () => game.runAction('stickers') });
  const menuBtn = roundButton(ui, { icon: 'menu', label: 'Menu', color: 'var(--sw-sky)', onClick: () => game.runAction('menu') });
  const helpBtn = roundButton(ui, { icon: 'help', label: 'Help', color: 'var(--sw-mint)', onClick: () => game.runAction('help') });
  helpBtn.classList.add('sw-round--small', 'sw-helpbtn');
  // Players (real friends playing together; never "Friends", which are the NPC girls)
  const playersBtn = roundButton(ui, { icon: 'players', label: 'Players', color: 'var(--sw-mint)', onClick: () => game.runAction('mp-players') });
  playersBtn.classList.add('sw-playersbtn');
  playersBtn.dataset.action = 'mp-players';
  const playersCount = ui.el('span', 'sw-count', '1');
  playersBtn.appendChild(playersCount);
  playersBtn.hidden = true;
  tr.append(helpBtn, dressBtn, stickerBtn, playersBtn, menuBtn);

  // right: tools, then fly / emotes / photo
  const right = ui.el('div', 'sw-hud-right');
  const tools = {
    build: roundButton(ui, { icon: 'build', label: 'Build', color: TOOL_COLORS.build, big: true, onClick: () => game.setTool('build') }),
    remove: roundButton(ui, { icon: 'remove', label: 'Remove', color: TOOL_COLORS.remove, big: true, onClick: () => game.setTool('remove') }),
    hand: roundButton(ui, { icon: 'hand', label: 'Hand', color: TOOL_COLORS.hand, big: true, onClick: () => game.setTool('hand') }),
  };
  const flyBtn = roundButton(ui, { icon: 'fly', label: 'Fly', color: 'var(--sw-sky)', onClick: () => game.runAction('fly') });
  const emoteBtn = roundButton(ui, { icon: 'emote', label: 'Emotes', color: 'var(--sw-sun)', onClick: () => game.runAction('emotes') });
  const photoBtn = roundButton(ui, { icon: 'photo', label: 'Photo', color: 'var(--sw-lav)', onClick: () => game.runAction('photo') });
  const sayBtn = roundButton(ui, { icon: 'talk', label: 'Say', color: 'var(--sw-pink)', onClick: () => game.runAction('mp-say') });
  sayBtn.dataset.action = 'mp-say';
  sayBtn.classList.add('sw-saybtn');
  sayBtn.hidden = true;
  const extras = ui.el('div', 'sw-hud-extras');
  extras.append(flyBtn, emoteBtn, sayBtn, photoBtn);
  right.append(tools.build, tools.remove, tools.hand, ui.el('div', 'sw-sep'), extras);

  // bottom: bag, hotbar, undo
  const bottom = ui.el('div', 'sw-hud-bottom');
  const bagBtn = roundButton(ui, { icon: 'bag', label: 'Bag', color: 'var(--sw-pink)', big: true, onClick: () => game.runAction('bag') });
  bagBtn.classList.add('sw-bagbtn');
  const undoBtn = roundButton(ui, { icon: 'undo', label: 'Undo', color: 'var(--sw-lav)', onClick: () => game.undo() });
  undoBtn.classList.add('sw-undobtn');
  const hotbar = ui.el('div', 'sw-hotbar');
  const slots = [];
  for (let i = 0; i < 9; i++) {
    const s = ui.el('button', 'sw-slot');
    s.type = 'button';
    s.setAttribute('aria-label', `Slot ${i + 1}`);
    s.appendChild(ui.el('span', 'sw-num', String(i + 1)));
    const img = ui.el('img');
    img.alt = '';
    img.draggable = false;
    s.appendChild(img);
    const sw = ui.el('span', 'sw-swatch');
    s.appendChild(sw);
    s.addEventListener('click', () => {
      if (game.hotbar.index === i && game.selectedTool === 'build' && !game.hotbar.slots[i]) game.runAction('bag');
      game.selectSlot(i);
    });
    hotbar.appendChild(s);
    slots.push({ el: s, img, sw, key: undefined });
  }
  const spacer = ui.el('div', 'sw-spacer sw-passive');
  bottom.append(bagBtn, spacer, hotbar, undoBtn);

  const cross = ui.el('div', 'sw-crosshair');

  // touch: jump + fly up/down
  const touch = ui.el('div', 'sw-touch');
  const upBtn = holdButton(ui, { icon: 'up', label: 'Up', color: 'var(--sw-sky)', name: 'jump', className: 'sw-flybtn' });
  const downBtn = holdButton(ui, { icon: 'down', label: 'Down', color: 'var(--sw-sky)', name: 'down', className: 'sw-flybtn' });
  const jumpBtn = holdButton(ui, { icon: 'jump', label: 'Jump', color: 'var(--sw-mint)', name: 'jump' });
  touch.append(upBtn, downBtn, jumpBtn);

  hud.append(tl, tr, right, bottom, cross, touch);

  const outline = new TargetOutline(game);
  game.events.on('thumbnail:before', () => { outline.hidden = true; outline.group.visible = false; });
  game.events.on('thumbnail:after', () => { outline.hidden = false; });

  // ----- refreshers -----
  const refreshHotbar = () => {
    slots.forEach((s, i) => {
      const key = game.hotbar.slots[i];
      s.el.classList.toggle('sw-sel', i === game.hotbar.index);
      const color = game.hotbar.colors[i];
      s.sw.style.display = color ? 'block' : 'none';
      if (color) s.sw.style.background = color;
      const item = key ? game.registry.items.get(key) : null;
      // the slot shows the item in the color she picked (a new color alone refreshes it too)
      const tint = color && item && item.colors ? color : null;
      const k = item ? `${key}|${tint || ''}` : null;
      if (s.key === k) return;
      s.key = k;
      s.el.title = item ? item.name : 'Empty';
      s.img.style.visibility = 'hidden';
      if (!item) return;
      game.registry.items.iconFor(key, tint).then((url) => {
        if (s.key !== k) return;
        if (url) { s.img.src = url; s.img.style.visibility = 'visible'; }
      });
    });
  };
  const refreshTools = () => {
    for (const [name, b] of Object.entries(tools)) b.classList.toggle('sw-active', game.selectedTool === name);
  };
  // while she drives a car or sails a boat, Jump becomes Honk (same spot, same 'jump' press:
  // the vehicles module honks on it) and Fly hides
  const jumpFace = jumpBtn.querySelector('.sw-round-face');
  const jumpLabel = jumpBtn.querySelector('.sw-round-label');
  let honkShown = false;
  const refreshFly = () => {
    const flying = !!(game.player && game.player.flying);
    const driving = !!(game.player && game.player.mountPet && game.player.mountPet.kind === 'vehicle');
    flyBtn.classList.toggle('sw-active', flying);
    flyBtn.hidden = driving;
    upBtn.hidden = downBtn.hidden = !flying;
    jumpBtn.hidden = flying;
    if (driving !== honkShown) {
      honkShown = driving;
      jumpFace.innerHTML = icon(driving ? 'honk' : 'jump');
      jumpLabel.textContent = driving ? 'Honk' : 'Jump';
      jumpBtn.setAttribute('aria-label', driving ? 'Honk' : 'Jump');
      jumpBtn.classList.toggle('sw-honkbtn', driving);
    }
  };
  const refreshActions = () => {
    dressBtn.hidden = !game.actions.has('dressup');
    stickerBtn.hidden = !game.actions.has('stickers');
    emoteBtn.hidden = !game.actions.has('emotes');
    photoBtn.hidden = !game.actions.has('photo');
    helpBtn.hidden = !game.actions.has('help');
  };
  const refreshTouch = () => {
    touch.classList.toggle('sw-show', game.input.touchMode);
    hud.classList.toggle('sw-touchmode', !!game.input.touchMode);
    // the life column (outside this HUD) keeps clear of the joystick in touch mode
    game.container.classList.toggle('sw-touch-hud', !!game.input.touchMode);
  };
  const refreshGems = () => { gemText.textContent = String(game.profile.stats.gems || 0); };
  // Sparkle Coins (wave 2): shown once profile.coins is a number; 'coins:change' refreshes now.
  // The Shops module's flying coins count the pill up as they land (game.coins.shown).
  let lastCoins = null;
  const refreshCoins = () => {
    const real = game.profile.coins;
    const has = typeof real === 'number' && Number.isFinite(real);
    coinPill.hidden = !has;
    const shown = has && game.coins && typeof game.coins.shown === 'number' ? game.coins.shown : real;
    const c = Number.isFinite(shown) ? shown : real;
    if (!has || c === lastCoins) return;
    if (lastCoins !== null && c > lastCoins) {
      coinPill.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.18)' }, { transform: 'scale(1)' }], { duration: 380, easing: 'ease-out' });
    }
    lastCoins = c;
    coinText.textContent = String(Math.floor(c));
  };
  game.events.on('coins:change', refreshCoins);
  game.events.on('coins:shown', refreshCoins);
  // playing with friends: Players (with how many are here) and Say show only in a session
  let netUp = true;
  let pillKind = null;
  const refreshNet = () => {
    const net = game.net;
    const on = !!(net && net.active && game.mode === 'play');
    playersBtn.hidden = !on || !game.actions.has('mp-players');
    sayBtn.hidden = !on || !game.actions.has('mp-say');
    hud.classList.toggle('sw-in-session', on);
    if (on) {
      const n = String(Math.max(1, net.players().length));
      if (playersCount.textContent !== n) {
        playersCount.textContent = n;
        playersBtn.setAttribute('aria-label', `Players: ${n}`);
      }
    }
    let kind = null;
    if (on && !netUp) kind = 'up';
    else if (on && net.isGuest && typeof net.session?.sending === 'function' && net.session.sending() > 20) kind = 'send';
    netPill.hidden = !kind;
    hud.classList.toggle('sw-net-trouble', !!kind);
    if (kind !== pillKind) {
      pillKind = kind;
      if (kind) {
        netPill.querySelector('svg').outerHTML = icon(kind === 'up' ? 'cloud' : 'sparkle');
        netText.textContent = kind === 'up' ? 'Reconnecting…' : 'Sending…';
        netPill.classList.toggle('sw-sending', kind === 'send');
      }
    }
  };
  game.events.on('net:state', (s) => {
    if (!s || s.state === 'idle') netUp = true;
    refreshNet();
  });
  game.events.on('net:players', refreshNet);
  game.events.on('net:status', (s) => {
    netUp = !s || s.connected !== false;
    refreshNet();
  });
  let lastNight = null;
  const refreshTime = () => {
    const d = game.time.dayTime;
    const night = d < 0.23 || d > 0.77;
    // game.timeOfDay (daynight.js, optional) gives a richer icon: sunrise, sunset, weather
    const tod = game.timeOfDay;
    const key = tod && tod.key ? tod.key : night;
    if (key === lastNight) return;
    lastNight = key;
    namePill.classList.toggle('sw-night', night);
    if (tod && tod.phase) namePill.dataset.phase = tod.phase;
    namePill.querySelector('svg').outerHTML = tod && tod.icon ? tod.icon() : icon(night ? 'moon' : 'sun');
  };

  game.events.on('hotbar:change', refreshHotbar);
  game.events.on('tool:change', refreshTools);
  game.events.on('player:fly', refreshFly);
  // sitting, lying down, standing up or riding can end a flight too: never leave Fly lit or
  // Up / Down showing in place of Jump
  for (const ev of ['player:sit', 'player:sleep', 'player:stand', 'pet:ride', 'vehicle:drive', 'vehicle:park', 'world:unload']) game.events.on(ev, refreshFly);
  game.events.on('gem:collect', refreshGems);
  game.input.on('touchmode', refreshTouch);
  game.events.on('world:load', ({ world }) => {
    nameText.textContent = world.meta.name;
    lastNight = null;
    refreshActions();
    refreshHotbar();
    refreshTools();
    refreshFly();
    refreshGems();
    lastCoins = null;
    refreshCoins();
    refreshNet();
    refreshTouch();
    refreshTime();
    hud.classList.add('sw-on');
    game.container.classList.add('sw-playing');
  });
  game.events.on('world:unload', () => {
    hud.classList.remove('sw-on');
    game.container.classList.remove('sw-playing');
  });
  game.events.on('ui:open', () => cross.classList.remove('sw-show'));

  let timer = 0;
  game.addSystem({
    name: 'hud',
    update(dt) {
      outline.update(dt);
      if (game.mode !== 'play') return;
      cross.classList.toggle('sw-show', !game.paused && !game.input.touchMode && game.input.pointer === null);
      timer -= dt;
      if (timer <= 0) {
        timer = 0.25;
        refreshTime();
        refreshCoins();
        refreshNet();
      }
    },
  });
}
