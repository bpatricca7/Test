// Styles for the Dress-Up Studio (full screen) and the emote wheel.

export const CSS = /* css */ `
.sw-dress { position: absolute; inset: 0; display: flex; flex-direction: column; overflow: hidden; color: var(--sw-ink); font-family: var(--sw-font);
  background: radial-gradient(circle at 18% 12%, #FFF6FB 0 8%, transparent 30%), radial-gradient(circle at 85% 80%, #E3F5FF 0 10%, transparent 35%), linear-gradient(155deg, #FFE1F0 0%, #F1E3FF 48%, #DCF1FF 100%); }
.sw-dress-bg { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
.sw-dress-bg span { position: absolute; color: #fff; filter: drop-shadow(0 2px 3px rgba(156,123,255,.35)); animation: sw-twinkle 2.4s ease-in-out infinite; }
.sw-dress-bg span svg { width: 100%; height: 100%; display: block; }
.sw-dress-bg i { position: absolute; border-radius: 50%; background: rgba(255,255,255,.45); animation: sw-float 6s ease-in-out infinite; }

.sw-dress-top { position: relative; z-index: 2; display: flex; align-items: center; gap: 12px; padding: calc(10px + var(--sw-safe-t)) calc(14px + var(--sw-safe-r)) 6px calc(14px + var(--sw-safe-l)); }
.sw-dress-title { margin: 0; font-size: 32px; font-weight: 700; color: var(--sw-pink); white-space: nowrap; display: flex; align-items: center; gap: 8px;
  -webkit-text-stroke: 7px #fff; paint-order: stroke fill; text-shadow: 0 4px 0 rgba(58,31,77,.12); }
.sw-dress-title svg { width: 40px; height: 40px; flex: none; }
.sw-dress-name { flex: 1; max-width: 380px; min-width: 0; display: flex; align-items: center; gap: 8px; height: 54px; padding: 0 16px 0 12px; background: #fff; border: 4px solid var(--sw-lav-soft); border-radius: 999px; box-shadow: 0 4px 12px var(--sw-shadow); cursor: text; }
.sw-dress-name:focus-within { border-color: var(--sw-lav); }
.sw-dress-name svg { width: 26px; height: 26px; color: var(--sw-lav); flex: none; }
.sw-dress-name span { font-size: 15px; font-weight: 700; color: var(--sw-lav); white-space: nowrap; }
.sw-dress-name input { flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; font: 700 22px var(--sw-font); color: var(--sw-ink); -webkit-user-select: text; user-select: text; }
.sw-dress-spacer { flex: 1; }
.sw-dress-done { flex: none; }

.sw-dress-main { position: relative; z-index: 1; flex: 1; min-height: 0; display: flex; gap: 14px; padding: 6px calc(14px + var(--sw-safe-r)) calc(14px + var(--sw-safe-b)) calc(14px + var(--sw-safe-l)); }
.sw-dress-stage { flex: 0 0 40%; min-width: 0; display: flex; flex-direction: column; gap: 10px; }
.sw-dress-view { position: relative; flex: 1; min-height: 0; border-radius: 32px; border: 5px solid #fff; overflow: hidden; touch-action: none; cursor: grab;
  background: radial-gradient(ellipse at 50% 38%, #FFFFFF 0%, #FFF0F8 38%, #F3E4FF 72%, #E4D6FF 100%); box-shadow: 0 8px 0 rgba(58,31,77,.08), 0 16px 34px rgba(58,31,77,.2), inset 0 -30px 60px rgba(255,255,255,.5); }
.sw-dress-view:active { cursor: grabbing; }
.sw-dress-view::before { content: ''; position: absolute; left: 12%; right: 12%; bottom: 6%; height: 18%; border-radius: 50%; background: radial-gradient(closest-side, rgba(255,255,255,.9), rgba(255,255,255,0)); pointer-events: none; }
.sw-dress-view canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
.sw-dress-view .sw-dress-sparkle { position: absolute; width: 22px; height: 22px; color: #FFD54A; pointer-events: none; animation: sw-twinkle 1.9s ease-in-out infinite; filter: drop-shadow(0 0 4px #fff); }
.sw-dress-hint { position: absolute; left: 50%; bottom: 14px; transform: translateX(-50%); display: flex; align-items: center; gap: 6px; padding: 6px 14px; border-radius: 999px; background: rgba(255,255,255,.92); font-size: 16px; font-weight: 700; color: var(--sw-lav); box-shadow: 0 3px 10px var(--sw-shadow); pointer-events: none; white-space: nowrap; transition: opacity .5s; }
.sw-dress-hint svg { width: 22px; height: 22px; }
.sw-dress-hint.sw-gone { opacity: 0; }
.sw-dress-turn { position: absolute; right: 12px; bottom: 10px; z-index: 2; display: flex; flex-direction: column; align-items: center; gap: 0; width: 64px; padding: 6px 0 4px; border-radius: 22px; border: 4px solid #fff; background: rgba(255,255,255,.9); color: var(--sw-pink); font: 700 13px var(--sw-font); box-shadow: 0 4px 10px var(--sw-shadow); cursor: pointer; touch-action: manipulation; transition: transform .18s var(--sw-bounce); }
.sw-dress-turn span { color: var(--sw-ink); }
.sw-dress-turn:hover { transform: scale(1.06); }
.sw-dress-turn:active { transform: scale(.9); }
.sw-dress-fallback { position: absolute; inset: 0; display: grid; place-items: center; font-size: 20px; font-weight: 700; color: var(--sw-lav); text-align: center; padding: 20px; }
.sw-dress-actions { display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; }
.sw-dress-actions .sw-btn svg { width: 1.4em; height: 1.4em; }

.sw-dress-side { flex: 1; min-width: 0; display: flex; flex-direction: column; background: rgba(255,255,255,.78); border: 5px solid #fff; border-radius: 32px; box-shadow: 0 8px 0 rgba(58,31,77,.08), 0 16px 34px rgba(58,31,77,.18); overflow: hidden; }
.sw-dress-tabs { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 6px; padding: 10px 10px 8px; background: linear-gradient(#FFFFFF, #FFF3FA); border-bottom: 3px solid var(--sw-pink-soft); }
.sw-dtab { position: relative; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; min-height: 70px; padding: 5px 2px 4px; border-radius: 18px; border: 3px solid transparent; background: transparent; cursor: pointer; font: 700 13px/1.05 var(--sw-font); color: var(--sw-ink); text-align: center; transition: transform .18s var(--sw-bounce), background .15s; -webkit-user-select: none; user-select: none; touch-action: manipulation; }
.sw-dtab svg { width: 40px; height: 40px; flex: none; filter: drop-shadow(0 2px 0 rgba(58,31,77,.12)); }
.sw-dtab:hover { transform: translateY(-2px); background: #FFF6FB; }
.sw-dtab:active { transform: scale(.93); }
.sw-dtab.sw-on { background: var(--sw-pink-soft); border-color: var(--sw-pink); box-shadow: 0 4px 10px rgba(255,95,162,.25); }
.sw-dtab.sw-on svg { animation: sw-wiggle .5s ease-in-out; }
.sw-dress-content { flex: 1; min-height: 0; overflow-y: auto; -webkit-overflow-scrolling: touch; overscroll-behavior: contain; padding: 6px 16px 22px; }
.sw-dsec { margin-top: 8px; }
.sw-dsec[hidden] { display: none; }
.sw-dsec-title { display: flex; align-items: center; gap: 8px; margin: 8px 2px 8px; font-size: 20px; font-weight: 700; color: var(--sw-lav); }
.sw-dsec-title svg { width: 24px; height: 24px; }
.sw-dsec-note { font-size: 15px; font-weight: 600; color: var(--sw-ink); opacity: .7; margin: -2px 2px 8px; }

.sw-dgrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(108px, 1fr)); gap: 10px; }
.sw-dgrid--big { grid-template-columns: repeat(auto-fill, minmax(128px, 1fr)); }
.sw-dtile { position: relative; display: flex; flex-direction: column; align-items: center; gap: 3px; padding: 6px 5px 8px; border-radius: 22px; background: #fff; border: 4px solid #fff; box-shadow: 0 4px 0 rgba(58,31,77,.06), 0 6px 14px rgba(58,31,77,.14); cursor: pointer; font: 700 15px/1.1 var(--sw-font); color: var(--sw-ink); text-align: center; transition: transform .18s var(--sw-bounce), box-shadow .18s; -webkit-user-select: none; user-select: none; touch-action: manipulation; }
.sw-dtile:hover { transform: translateY(-3px) scale(1.03); }
.sw-dtile:active { transform: scale(.94); }
.sw-dtile .sw-dpic { position: relative; width: 100%; aspect-ratio: 1; border-radius: 17px; overflow: hidden; background: radial-gradient(circle at 50% 42%, #FFFFFF 0%, #FFF0F8 55%, #F0E4FF 100%); }
.sw-dtile .sw-dpic canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
.sw-dtile .sw-dpic .sw-dwait { position: absolute; inset: 0; display: grid; place-items: center; color: #E3D5FF; }
.sw-dtile .sw-dpic .sw-dwait svg { width: 46%; height: 46%; animation: sw-twinkle 1.2s ease-in-out infinite; }
.sw-dtile .sw-dpic.sw-ready .sw-dwait { display: none; }
.sw-dtile .sw-dnone { position: absolute; right: 4px; bottom: 4px; width: 30px; height: 30px; }
.sw-dtile.sw-on { border-color: var(--sw-pink); box-shadow: 0 0 0 3px #fff, 0 0 18px 2px rgba(255,95,162,.5); }
.sw-dcheck { position: absolute; top: -9px; right: -9px; width: 32px; height: 32px; border-radius: 50%; background: var(--sw-pink); color: #fff; border: 3px solid #fff; display: none; place-items: center; box-shadow: 0 3px 8px var(--sw-shadow); z-index: 2; }
.sw-dcheck svg { width: 18px; height: 18px; }
.sw-dtile.sw-on .sw-dcheck, .sw-sw.sw-on .sw-dcheck { display: grid; }

.sw-swatches { display: flex; flex-wrap: wrap; gap: 9px; }
.sw-sw { position: relative; width: 48px; height: 48px; flex: none; border-radius: 50%; border: 4px solid #fff; background: var(--c); cursor: pointer; padding: 0; box-shadow: 0 3px 8px var(--sw-shadow), inset 0 -5px 0 rgba(0,0,0,.08), inset 0 4px 0 rgba(255,255,255,.35); transition: transform .18s var(--sw-bounce); touch-action: manipulation; }
.sw-sw:hover { transform: scale(1.1); }
.sw-sw:active { transform: scale(.9); }
.sw-sw.sw-on { transform: scale(1.1); box-shadow: 0 0 0 4px var(--sw-pink), 0 4px 10px var(--sw-shadow); }
.sw-sw .sw-dcheck { top: -8px; right: -8px; width: 24px; height: 24px; border-width: 2px; }
.sw-sw .sw-dcheck svg { width: 13px; height: 13px; }
.sw-sw--big { width: 60px; height: 60px; }
.sw-sw--none { background: #fff; display: grid; place-items: center; }
.sw-sw--none svg { width: 34px; height: 34px; }
.sw-sw--rainbow { background: conic-gradient(#FF8A8A, #FFB86B, #FFE27A, #9BE58A, #7FD3FF, #A99BFF, #E59BFF, #FF8A8A); }

.sw-patterns { display: flex; flex-wrap: wrap; gap: 10px; }
.sw-pat { position: relative; display: flex; flex-direction: column; align-items: center; gap: 3px; width: 82px; padding: 5px 4px 6px; border-radius: 18px; border: 4px solid #fff; background: #fff; cursor: pointer; font: 700 13px var(--sw-font); color: var(--sw-ink); box-shadow: 0 4px 10px rgba(58,31,77,.14); transition: transform .18s var(--sw-bounce); touch-action: manipulation; }
.sw-pat canvas { width: 62px; height: 62px; border-radius: 14px; display: block; box-shadow: inset 0 0 0 2px rgba(58,31,77,.06); }
.sw-pat:hover { transform: translateY(-2px); }
.sw-pat.sw-on { border-color: var(--sw-pink); box-shadow: 0 0 0 3px #fff, 0 0 14px rgba(255,95,162,.45); }

.sw-dslot { position: relative; }
.sw-dslot .sw-dslot-save { position: absolute; top: -10px; left: -10px; z-index: 2; width: 44px; height: 44px; border-radius: 50%; border: 3px solid #fff; background: var(--sw-lav); color: #fff; display: grid; place-items: center; box-shadow: 0 3px 8px var(--sw-shadow); cursor: pointer; padding: 0; }
.sw-dslot .sw-dslot-save svg { width: 22px; height: 22px; }
.sw-dtile.sw-empty { background: rgba(255,255,255,.6); border: 4px dashed var(--sw-lav-soft); box-shadow: none; color: var(--sw-lav); }
.sw-dtile.sw-empty .sw-dpic { background: transparent; display: grid; place-items: center; }
.sw-dtile.sw-empty .sw-dpic svg { width: 44%; height: 44%; color: var(--sw-lav); }

@keyframes sw-dress-pop { 0% { transform: scale(1); } 40% { transform: scale(1.12); } 100% { transform: scale(1); } }
.sw-dpop { animation: sw-dress-pop .35s var(--sw-bounce); }

/* phones & portrait tablets: preview on top, tabs as a scrolling strip */
@media (max-width: 760px), (orientation: portrait) and (max-width: 900px) {
  .sw-dress-top { gap: 8px; padding-left: calc(10px + var(--sw-safe-l)); padding-right: calc(10px + var(--sw-safe-r)); }
  .sw-dress-title { display: none; }
  .sw-dress-spacer { display: none; }
  .sw-dress-hint { top: 10px; bottom: auto; font-size: 14px; }
  .sw-dress-name { height: 50px; max-width: none; }
  .sw-dress-name span { display: none; }
  .sw-dress-name input { font-size: 20px; }
  .sw-dress-main { flex-direction: column; gap: 8px; padding: 4px calc(10px + var(--sw-safe-r)) calc(10px + var(--sw-safe-b)) calc(10px + var(--sw-safe-l)); }
  .sw-dress-stage { flex: 0 0 auto; height: min(40vh, 400px); gap: 8px; }
  .sw-dress-actions { gap: 8px; flex-wrap: nowrap; }
  .sw-dress-actions .sw-btn { min-height: 46px; font-size: 17px; padding: 4px 14px; }
  .sw-dress-side { border-radius: 26px; }
  .sw-dress-tabs { display: flex; overflow-x: auto; overscroll-behavior: contain; -webkit-overflow-scrolling: touch; scrollbar-width: none; padding: 8px; gap: 4px; }
  .sw-dress-tabs::-webkit-scrollbar { display: none; }
  .sw-dtab { flex: 0 0 74px; min-height: 66px; font-size: 12px; }
  .sw-dtab svg { width: 36px; height: 36px; }
  .sw-dress-content { padding: 4px 12px 18px; }
  .sw-dgrid { grid-template-columns: repeat(auto-fill, minmax(92px, 1fr)); gap: 8px; }
  .sw-dgrid--big { grid-template-columns: repeat(auto-fill, minmax(104px, 1fr)); }
  .sw-dtile { font-size: 13px; border-radius: 18px; }
  .sw-dsec-title { font-size: 18px; }
  .sw-sw { width: 46px; height: 46px; }
  .sw-sw--big { width: 54px; height: 54px; }
}
@media (max-height: 560px) and (orientation: landscape) {
  .sw-dress-title { font-size: 24px; }
  .sw-dress-title svg { width: 30px; height: 30px; }
  .sw-dress-name { height: 46px; }
  .sw-dtab { min-height: 56px; font-size: 11px; }
  .sw-dtab svg { width: 30px; height: 30px; }
}

/* ---------- emote wheel ---------- */
.sw-emo { position: absolute; inset: 0; display: grid; place-items: center; }
.sw-emo-dim { position: absolute; inset: 0; background: radial-gradient(circle, rgba(58,31,77,.18), rgba(58,31,77,.42)); backdrop-filter: blur(2px); -webkit-backdrop-filter: blur(2px); animation: sw-fade .2s ease-out; }
.sw-emo-wheel { --r: min(190px, 36vw, 30vh); position: relative; width: calc(var(--r) * 2 + 130px); height: calc(var(--r) * 2 + 140px); animation: sw-pop .32s var(--sw-bounce); pointer-events: none; }
.sw-emo-ring { pointer-events: auto; position: absolute; left: 50%; top: 50%; width: calc(var(--r) * 2 + 20px); height: calc(var(--r) * 2 + 20px); transform: translate(-50%, -50%); border-radius: 50%; background: radial-gradient(circle, rgba(255,255,255,.95) 0 34%, rgba(255,241,248,.9) 35% 60%, rgba(236,225,255,.85) 61%); border: 6px solid #fff; box-shadow: 0 16px 40px rgba(58,31,77,.35); }
.sw-emo-title { position: absolute; left: 50%; top: -34px; transform: translateX(-50%); font-size: 28px; font-weight: 700; color: #fff; white-space: nowrap; text-shadow: 0 3px 0 rgba(58,31,77,.35); -webkit-text-stroke: 6px var(--sw-pink); paint-order: stroke fill; }
.sw-emo-btn { position: absolute; left: 50%; top: 50%; width: 104px; display: flex; flex-direction: column; align-items: center; gap: 2px; margin: -60px 0 0 -52px; background: none; border: 0; padding: 0; cursor: pointer; pointer-events: auto; font-family: var(--sw-font); touch-action: manipulation; }
.sw-emo-face { position: relative; width: 96px; height: 96px; border-radius: 50%; overflow: hidden; border: 5px solid #fff; background: radial-gradient(circle at 50% 40%, #FFFFFF, #FFE3F1 70%, #EBDDFF); box-shadow: 0 6px 0 rgba(58,31,77,.12), 0 8px 18px var(--sw-shadow); transition: transform .18s var(--sw-bounce); }
.sw-emo-face canvas, .sw-emo-face svg { position: absolute; inset: 0; width: 100%; height: 100%; }
.sw-emo-face svg { inset: 18%; width: 64%; height: 64%; }
.sw-emo-btn:hover .sw-emo-face { transform: scale(1.1); }
.sw-emo-btn:active .sw-emo-face { transform: scale(.9); }
.sw-emo-label { position: relative; font-size: 16px; font-weight: 700; color: var(--sw-ink); background: #fff; padding: 2px 12px; border-radius: 999px; box-shadow: 0 2px 6px var(--sw-shadow); white-space: nowrap; }
.sw-emo-key { position: absolute; top: -4px; left: 2px; width: 24px; height: 24px; border-radius: 50%; background: var(--sw-sun); color: var(--sw-ink); font-size: 13px; font-weight: 700; display: grid; place-items: center; border: 2px solid #fff; }
.sw-app.sw-touch-ui .sw-emo-key { display: none; }
.sw-emo-close { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); pointer-events: auto; }
@media (max-width: 480px) {
  .sw-emo-btn { width: 88px; margin: -52px 0 0 -44px; }
  .sw-emo-face { width: 80px; height: 80px; }
  .sw-emo-label { font-size: 14px; }
  .sw-emo-title { font-size: 24px; }
}
`;
