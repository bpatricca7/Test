// Visual theme: CSS custom properties (palette tokens from DESIGN.md), the Fredoka font
// stack, and base styles for the chunky "toy sticker" UI: thick white outlines, candy colors,
// soft shadows and bouncy presses. Injected once at install (before ui.js exists).

export const FONT_STACK = "'Fredoka', ui-rounded, 'Arial Rounded MT Bold', 'Trebuchet MS', system-ui, sans-serif";

export const CSS = /* css */ `
:root {
  --sw-pink: #FF5FA2; --sw-pink-soft: #FFD1E6; --sw-lav: #9C7BFF; --sw-lav-soft: #E6DDFF;
  --sw-mint: #3FD8B0; --sw-sun: #FFC94D; --sw-sky: #6CC6FF; --sw-ink: #3A1F4D;
  --sw-cream: #FFF8FC; --sw-white: #FFFFFF; --sw-shadow: rgba(58,31,77,.25);
  --sw-font: ${FONT_STACK};
  --sw-radius: 24px;
  --sw-safe-t: env(safe-area-inset-top, 0px); --sw-safe-r: env(safe-area-inset-right, 0px);
  --sw-safe-b: env(safe-area-inset-bottom, 0px); --sw-safe-l: env(safe-area-inset-left, 0px);
  --sw-bounce: cubic-bezier(.34, 1.56, .64, 1);
}
html, body {
  margin: 0; height: 100%; overflow: hidden; background: #BDE6FF;
  font-family: var(--sw-font); color: var(--sw-ink);
  -webkit-tap-highlight-color: transparent; -webkit-user-select: none; user-select: none;
  overscroll-behavior: none; -webkit-text-size-adjust: 100%;
}
#app { position: fixed; inset: 0; overflow: hidden; background: #BDE6FF; }
.sw-canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; outline: none; }
.sw-app * { box-sizing: border-box; }
.sw-app button, .sw-app input { font-family: var(--sw-font); }

/* layers */
.sw-ui { position: absolute; inset: 0; pointer-events: none; z-index: 10; font-family: var(--sw-font); }
.sw-layer { position: absolute; inset: 0; pointer-events: none; }
.sw-layer > * { pointer-events: auto; }

/* chunky sticker buttons */
.sw-btn {
  --c: var(--sw-pink); --fg: #fff;
  position: relative; display: inline-flex; align-items: center; justify-content: center; gap: 10px;
  min-height: 52px; padding: 8px 22px; border: 4px solid #fff; border-radius: 999px;
  background: var(--c); color: var(--fg); font-size: 20px; font-weight: 600; letter-spacing: .2px;
  box-shadow: 0 5px 0 rgba(58,31,77,.16), 0 10px 22px var(--sw-shadow), inset 0 -5px 0 rgba(0,0,0,.08), inset 0 4px 0 rgba(255,255,255,.28);
  cursor: pointer; pointer-events: auto; white-space: nowrap; text-shadow: 0 2px 0 rgba(58,31,77,.15);
  transition: transform .18s var(--sw-bounce), box-shadow .18s, filter .18s;
  -webkit-user-select: none; user-select: none; touch-action: manipulation;
}
.sw-btn:hover { transform: translateY(-2px) scale(1.04); filter: brightness(1.04); }
.sw-btn:active, .sw-btn.sw-pressed { transform: translateY(3px) scale(.94); box-shadow: 0 2px 0 rgba(58,31,77,.16), 0 4px 10px var(--sw-shadow), inset 0 -3px 0 rgba(0,0,0,.08); }
.sw-btn:focus-visible { outline: 4px solid var(--sw-sun); outline-offset: 3px; }
.sw-btn svg { width: 1.35em; height: 1.35em; flex: none; filter: drop-shadow(0 2px 0 rgba(58,31,77,.15)); }
.sw-btn[disabled] { filter: grayscale(.6) opacity(.6); cursor: default; }
.sw-btn--pink { --c: var(--sw-pink); }
.sw-btn--lav { --c: var(--sw-lav); }
.sw-btn--mint { --c: var(--sw-mint); }
.sw-btn--sky { --c: var(--sw-sky); }
.sw-btn--sun { --c: var(--sw-sun); --fg: var(--sw-ink); text-shadow: none; }
.sw-btn--white { --c: #fff; --fg: var(--sw-ink); border-color: var(--sw-pink-soft); text-shadow: none; }
.sw-btn--white svg { color: var(--sw-pink); }
.sw-btn--big { min-height: 68px; font-size: 26px; padding: 10px 34px; }
.sw-btn--small { min-height: 42px; font-size: 16px; padding: 4px 14px; border-width: 3px; }
.sw-btn--icon { width: 52px; min-height: 52px; padding: 0; }

/* panels */
.sw-panel-wrap { position: absolute; inset: 0; display: none; align-items: center; justify-content: center; padding: calc(12px + var(--sw-safe-t)) calc(12px + var(--sw-safe-r)) calc(12px + var(--sw-safe-b)) calc(12px + var(--sw-safe-l)); }
.sw-panel-wrap.sw-open { display: flex; }
.sw-backdrop { position: absolute; inset: 0; background: rgba(58,31,77,.32); backdrop-filter: blur(3px); -webkit-backdrop-filter: blur(3px); animation: sw-fade .2s ease-out; }
.sw-card {
  position: relative; width: min(760px, 100%); max-height: 100%; display: flex; flex-direction: column;
  background: var(--sw-cream); border: 5px solid #fff; border-radius: 30px;
  box-shadow: 0 8px 0 rgba(58,31,77,.12), 0 22px 60px rgba(58,31,77,.35);
  animation: sw-pop .32s var(--sw-bounce);
}
.sw-card-head { display: flex; align-items: center; gap: 12px; padding: 16px 20px 6px 24px; }
.sw-card-title { flex: 1; margin: 0; font-size: 30px; font-weight: 700; color: var(--sw-pink); text-shadow: 0 3px 0 #fff, 0 4px 0 rgba(58,31,77,.08); display: flex; align-items: center; gap: 10px; }
.sw-card-title svg { width: 34px; height: 34px; }
.sw-card-body { padding: 8px 22px 22px; overflow: auto; -webkit-overflow-scrolling: touch; }
.sw-close { --c: var(--sw-lav-soft); --fg: var(--sw-lav); width: 50px; min-height: 50px; padding: 0; text-shadow: none; }
.sw-full { position: absolute; inset: 0; animation: sw-fade .25s ease-out; }

/* toasts */
.sw-toasts { position: absolute; top: calc(14px + var(--sw-safe-t)); left: 50%; transform: translateX(-50%); display: flex; flex-direction: column; align-items: center; gap: 8px; pointer-events: none !important; z-index: 40; width: max-content; max-width: 92vw; }
.sw-toast {
  display: flex; align-items: center; gap: 10px; padding: 10px 20px; border-radius: 999px;
  background: #fff; color: var(--sw-ink); border: 4px solid var(--sw-pink-soft); font-size: 19px; font-weight: 600;
  box-shadow: 0 6px 18px var(--sw-shadow); animation: sw-pop .35s var(--sw-bounce); pointer-events: none;
}
.sw-toast svg { width: 26px; height: 26px; color: var(--sw-pink); flex: none; }
.sw-toast--big { font-size: 24px; padding: 14px 26px; border-color: var(--sw-sun); background: linear-gradient(#FFFDF2, #FFF1C9); }
.sw-toast--big svg { width: 34px; height: 34px; color: #F5A300; }
.sw-toast.sw-leave { animation: sw-leave .3s ease-in forwards; }

/* hint bubble */
.sw-hint {
  position: absolute; left: 50%; top: calc(50% + 34px); transform: translateX(-50%);
  padding: 7px 16px; border-radius: 999px; background: rgba(255,255,255,.94); color: var(--sw-ink);
  border: 3px solid var(--sw-mint); font-size: 17px; font-weight: 600; box-shadow: 0 4px 12px var(--sw-shadow);
  pointer-events: none !important; white-space: nowrap; animation: sw-pop .25s var(--sw-bounce);
}
.sw-hint[hidden] { display: none; }

/* loading & fades */
.sw-loading {
  position: absolute; inset: 0; display: none; flex-direction: column; align-items: center; justify-content: center; gap: 22px;
  background: radial-gradient(circle at 50% 35%, #FFF1F8 0%, #FFD1E6 45%, #C9B8FF 100%); z-index: 60;
}
.sw-loading.sw-open { display: flex; }
.sw-loading-text { font-size: 30px; font-weight: 700; color: var(--sw-ink); text-shadow: 0 3px 0 #fff; text-align: center; padding: 0 20px; }
.sw-loading-bar { width: min(420px, 78vw); height: 28px; border-radius: 999px; background: #fff; border: 4px solid #fff; box-shadow: 0 6px 18px var(--sw-shadow); overflow: hidden; }
.sw-loading-fill { height: 100%; width: 0%; border-radius: 999px; background: repeating-linear-gradient(-45deg, var(--sw-pink) 0 14px, #FF7FB6 14px 28px); transition: width .25s ease-out; }
.sw-loading-cubes { display: flex; gap: 12px; }
.sw-loading-cubes span { width: 34px; height: 34px; border-radius: 9px; border: 4px solid #fff; box-shadow: 0 5px 12px var(--sw-shadow); animation: sw-hop 1s var(--sw-bounce) infinite; }
.sw-loading-cubes span:nth-child(1) { background: var(--sw-pink); }
.sw-loading-cubes span:nth-child(2) { background: var(--sw-sun); animation-delay: .12s; }
.sw-loading-cubes span:nth-child(3) { background: var(--sw-mint); animation-delay: .24s; }
.sw-loading-cubes span:nth-child(4) { background: var(--sw-sky); animation-delay: .36s; }
.sw-loading-cubes span:nth-child(5) { background: var(--sw-lav); animation-delay: .48s; }
.sw-fader { position: absolute; inset: 0; background: #1D1647; opacity: 0; pointer-events: none !important; transition: opacity .8s ease; z-index: 50; display: flex; align-items: center; justify-content: center; }
.sw-fader.sw-on { opacity: .92; pointer-events: auto !important; }
.sw-fader-text { font-size: 64px; font-weight: 700; color: #FFF6D8; text-shadow: 0 0 24px rgba(255,230,150,.7); animation: sw-float 2s ease-in-out infinite; }
.sw-star { position: absolute; width: 6px; height: 6px; border-radius: 50%; background: #FFF6D8; box-shadow: 0 0 10px #FFF6D8; animation: sw-twinkle 1.6s ease-in-out infinite; }

/* dialogs */
.sw-dialog-wrap { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; z-index: 70; padding: 16px; }
.sw-dialog { width: min(460px, 100%); background: #fff; border: 5px solid var(--sw-pink-soft); border-radius: 28px; padding: 22px; text-align: center; box-shadow: 0 22px 60px rgba(58,31,77,.4); animation: sw-pop .3s var(--sw-bounce); }
.sw-dialog h3 { margin: 0 0 8px; font-size: 28px; color: var(--sw-pink); }
.sw-dialog p { margin: 0 0 18px; font-size: 19px; }
.sw-dialog-buttons { display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; }
.sw-input { width: 100%; font-size: 22px; font-weight: 600; padding: 12px 16px; border-radius: 18px; border: 4px solid var(--sw-lav-soft); background: var(--sw-cream); color: var(--sw-ink); outline: none; -webkit-user-select: text; user-select: text; }
.sw-input:focus { border-color: var(--sw-lav); }
.sw-chips { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; margin: 12px 0 16px; }
.sw-chip { border: 3px solid var(--sw-lav-soft); background: #fff; color: var(--sw-lav); border-radius: 999px; padding: 6px 12px; font-size: 15px; font-weight: 600; cursor: pointer; }
.sw-chip:active { transform: scale(.94); }

@keyframes sw-pop { 0% { transform: scale(.6); opacity: 0; } 100% { transform: scale(1); opacity: 1; } }
@keyframes sw-leave { to { transform: translateY(-16px) scale(.8); opacity: 0; } }
@keyframes sw-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes sw-hop { 0%, 100% { transform: translateY(0) rotate(0); } 40% { transform: translateY(-18px) rotate(8deg); } }
@keyframes sw-float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-10px); } }
@keyframes sw-twinkle { 0%, 100% { opacity: .25; transform: scale(.7); } 50% { opacity: 1; transform: scale(1.2); } }
@keyframes sw-wiggle { 0%, 100% { transform: rotate(0); } 25% { transform: rotate(-4deg); } 75% { transform: rotate(4deg); } }
@keyframes sw-drift { from { transform: translateX(-30vw); } to { transform: translateX(130vw); } }

@media (prefers-reduced-motion: reduce) {
  .sw-app *, .sw-app *::before, .sw-app *::after { animation-duration: .01ms !important; animation-iteration-count: 1 !important; transition-duration: .01ms !important; }
}
@media (max-width: 600px) {
  .sw-btn { font-size: 18px; min-height: 48px; padding: 6px 18px; }
  .sw-btn--big { font-size: 22px; min-height: 60px; }
  .sw-card-title { font-size: 25px; }
  .sw-card-body { padding: 6px 14px 16px; }
  .sw-toast { font-size: 16px; }
  .sw-toast--big { font-size: 19px; }
}
`;

export function install() {
  if (typeof document === 'undefined' || document.getElementById('sw-theme')) return;
  const style = document.createElement('style');
  style.id = 'sw-theme';
  style.textContent = CSS;
  document.head.appendChild(style);
}
