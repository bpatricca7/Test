// UI stylesheet, injected once as a <style> element (system font stacks only — no web fonts, no
// network). Design language: black glass panels with hairline borders, white type, amber accents
// (Apollo panel lighting), tabular monospace numerals, generous letter-spacing for labels.
//
// Pointer events: index.html sets `#ui * { pointer-events: auto }`. Everything inside .aui is
// reset to `none` (so the 3D canvas keeps mouse drag / wheel), and only interactive surfaces
// (.pe) opt back in.

export const CSS = /* css */ `
.aui {
  --fg: #eef0f2;
  --fg-2: #c9ced4;
  --dim: #8f98a3;
  --faint: #5a636d;
  --line: rgba(255, 255, 255, 0.10);
  --line-2: rgba(255, 255, 255, 0.18);
  --amber: #ffb347;
  --amber-2: #ffd08a;
  --amber-bg: rgba(255, 179, 71, 0.12);
  --good: #79e0a3;
  --warn: #ffc94d;
  --alarm: #ff4d40;
  --contact: #62b9ff;
  --panel: rgba(9, 11, 15, 0.64);
  --panel-solid: rgba(10, 12, 16, 0.9);
  --sans: -apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue", Helvetica, Arial, "Liberation Sans", sans-serif;
  --display: "Helvetica Neue", "Avenir Next", "Segoe UI", Helvetica, Arial, "Liberation Sans", sans-serif;
  --mono: ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, "Liberation Mono", "DejaVu Sans Mono", monospace;
  --serif: "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, "Liberation Serif", serif;
  --hud: clamp(11px, calc(0.42vw + 0.42vh + 3px), 19px);
  --ease: cubic-bezier(0.2, 0.7, 0.2, 1);
  position: absolute;
  inset: 0;
  overflow: hidden;
  color: var(--fg);
  font-family: var(--sans);
  font-size: 14px;
  line-height: 1.4;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-rendering: optimizeLegibility;
}
#ui .aui, #ui .aui * { pointer-events: none; box-sizing: border-box; }
#ui .aui .pe, #ui .aui .pe * { pointer-events: auto; }
.aui button { font: inherit; color: inherit; background: none; border: 0; margin: 0; padding: 0; cursor: pointer; text-align: inherit; }
.aui :focus { outline: none; }
.aui :focus-visible { outline: 1px solid var(--amber); outline-offset: 2px; }
.aui .num { font-family: var(--mono); font-variant-numeric: tabular-nums slashed-zero; letter-spacing: 0; }
.aui .hidden { display: none !important; }
.aui kbd {
  display: inline-block; min-width: 1.9em; padding: 0.18em 0.5em 0.14em; margin: 0 0.12em 0.2em 0;
  border: 1px solid var(--line-2); border-bottom-width: 2px; border-radius: 4px;
  font: 600 0.78em/1.2 var(--mono); color: var(--fg); text-align: center; background: rgba(255,255,255,0.05);
  white-space: nowrap;
}

/* ================================================================ screens (title / menu) */
.aui .screen {
  position: absolute; inset: 0; z-index: 20; display: flex; flex-direction: column; isolation: isolate;
  opacity: 0; visibility: hidden; transition: opacity 0.45s var(--ease), visibility 0s linear 0.45s;
}
.aui .screen.open { opacity: 1; visibility: visible; transition: opacity 0.45s var(--ease), visibility 0s; }
.aui .screen .bd { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
.aui .screen .scrim { position: absolute; inset: 0; }
.aui .screen.title .scrim {
  background:
    linear-gradient(90deg, rgba(0,0,0,0.78) 0%, rgba(0,0,0,0.5) 34%, rgba(0,0,0,0) 62%),
    radial-gradient(120% 90% at 50% 40%, rgba(0,0,0,0) 55%, rgba(0,0,0,0.55) 100%);
}
.aui .screen.inflight .scrim {
  background:
    linear-gradient(90deg, rgba(3,4,6,0.9) 0%, rgba(3,4,6,0.72) 40%, rgba(3,4,6,0.35) 75%, rgba(3,4,6,0.25) 100%);
  backdrop-filter: blur(3px) saturate(0.8);
  -webkit-backdrop-filter: blur(3px) saturate(0.8);
}
.aui .shell {
  position: relative; z-index: 1; flex: 1; min-height: 0;
  display: flex; flex-direction: column;
  width: min(100%, 800px);
  padding: clamp(18px, 5vh, 56px) clamp(16px, 4.2vw, 64px) clamp(14px, 3.5vh, 36px);
}
.aui .brand { flex: none; }
.aui .overline {
  font: 600 11px/1.4 var(--sans); letter-spacing: 0.32em; text-transform: uppercase; color: var(--dim);
  display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
}
.aui .overline .dot { width: 4px; height: 4px; border-radius: 50%; background: var(--amber); display: inline-block; }
.aui .brand-row { display: flex; align-items: center; gap: clamp(14px, 2vw, 26px); margin: clamp(8px, 1.6vh, 16px) 0 0; }
.aui .brand .patch { color: var(--amber-2); flex: none; width: clamp(64px, 9vh, 104px); height: auto; filter: drop-shadow(0 0 18px rgba(255,179,71,0.12)); }
.aui .brand .patch-text { font-family: var(--sans); font-weight: 600; }
.aui .title-main {
  font: 300 clamp(36px, min(7vw, 9.6vh), 96px)/0.95 var(--display);
  letter-spacing: 0.16em; margin: 0; margin-right: -0.16em; white-space: nowrap;
  background: linear-gradient(180deg, #ffffff 0%, #e9e6df 55%, #b9b3a6 100%);
  -webkit-background-clip: text; background-clip: text; color: transparent;
}
.aui .title-sub {
  margin-top: clamp(6px, 1.2vh, 12px);
  font: 500 clamp(11px, 1.6vh, 14px)/1.2 var(--sans); letter-spacing: 0.62em; text-transform: uppercase; color: var(--amber);
}
.aui .tagline { margin: clamp(10px, 2vh, 18px) 0 0; max-width: 34em; color: var(--fg-2); font-size: clamp(13px, 1.9vh, 15px); line-height: 1.55; }
.aui .inflight .title-main { font-size: clamp(30px, min(5vw, 8vh), 60px); letter-spacing: 0.08em; margin-right: 0; }

/* tabs */
.aui .tabs { flex: none; display: flex; gap: clamp(14px, 2.4vw, 30px); margin: clamp(16px, 3.4vh, 34px) 0 clamp(10px, 1.8vh, 16px); border-bottom: 1px solid var(--line); flex-wrap: wrap; }
.aui .tab {
  position: relative; padding: 10px 0 11px; font: 600 11.5px/1 var(--sans); letter-spacing: 0.24em; text-transform: uppercase; color: var(--dim);
  transition: color 0.2s;
}
.aui .tab::after { content: ""; position: absolute; left: 0; right: 0; bottom: -1px; height: 2px; background: var(--amber); transform: scaleX(0); transform-origin: left; transition: transform 0.35s var(--ease); }
.aui .tab:hover { color: var(--fg); }
.aui .tab:focus-visible { color: var(--fg); outline: 1px solid rgba(255,179,71,0.7); outline-offset: 5px; border-radius: 2px; }
.aui .tab.on { color: var(--fg); }
.aui .tab.on::after { transform: scaleX(1); }
.aui .page { flex: 1; min-height: 0; display: none; }
.aui .page.on { display: flex; }
.aui .scroll { overflow-y: auto; overscroll-behavior: contain; scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.2) transparent; }
.aui .scroll::-webkit-scrollbar { width: 6px; }
.aui .scroll::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.18); border-radius: 3px; }
.aui .foot { flex: none; margin-top: 12px; font-size: 11.5px; color: var(--faint); letter-spacing: 0.04em; display: flex; gap: 18px; flex-wrap: wrap; }
.aui .foot kbd { font-size: 0.85em; }

/* missions: list + briefing */
.aui .missions { display: flex; align-items: flex-start; gap: clamp(12px, 1.6vw, 20px); width: 100%; min-height: 0; }
.aui .missions > * { max-height: 100%; }
.aui .mlist { flex: 0 0 clamp(210px, 36%, 280px); display: flex; flex-direction: column; gap: 2px; padding-right: 4px; }
.aui .mrow {
  display: grid; grid-template-columns: 22px minmax(0, 1fr) auto; align-items: center; gap: 1px 6px;
  padding: clamp(5px, 0.9vh, 8px) 10px clamp(5px, 0.9vh, 8px) 8px; border-radius: 6px; border: 1px solid transparent;
  transition: background 0.2s, border-color 0.2s;
}
.aui .mrow .idx { font: 500 10.5px/1 var(--mono); color: var(--faint); }
.aui .mrow .mt { grid-column: 2 / 4; font-weight: 600; font-size: 13.5px; color: var(--fg-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.aui .mrow .ms { grid-row: 2; grid-column: 2; font-size: 11px; color: var(--faint); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.aui .mrow .diff { grid-row: 2; grid-column: 3; }
.aui .mrow:hover { background: rgba(255,255,255,0.04); }
.aui .mrow.on { background: linear-gradient(90deg, rgba(255,179,71,0.14), rgba(255,179,71,0.03)); border-color: rgba(255,179,71,0.28); }
.aui .mrow.on .mt { color: #fff; }
.aui .mrow.on .idx { color: var(--amber); }
.aui .mrow.on .ms { color: var(--dim); }
.aui .diff { font: 700 8.5px/1 var(--sans); letter-spacing: 0.14em; text-transform: uppercase; padding: 3px 5px 2px; border-radius: 3px; border: 1px solid currentColor; opacity: 0.85; }
.aui .mrow .diff { border: 0; padding: 0; opacity: 0.9; }
.aui .diff.beginner { color: #8fd6ff; }
.aui .diff.easy { color: var(--good); }
.aui .diff.medium { color: var(--warn); }
.aui .diff.hard { color: #ff8a6b; }
.aui .brief {
  flex: 1; min-width: 0; min-height: 0; display: flex; flex-direction: column; padding: clamp(14px, 2.2vh, 22px) clamp(14px, 1.8vw, 22px);
  background: var(--panel); border: 1px solid var(--line); border-radius: 10px;
  backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
  box-shadow: 0 20px 60px rgba(0,0,0,0.45);
}
.aui .brief .bh { display: flex; align-items: center; gap: 10px; color: var(--dim); font: 600 10.5px/1 var(--sans); letter-spacing: 0.22em; text-transform: uppercase; }
.aui .brief h2 { margin: 10px 0 2px; font: 400 clamp(21px, 3.2vh, 28px)/1.15 var(--display); letter-spacing: 0.02em; color: #fff; }
.aui .brief .sub { color: var(--amber-2); font-size: 13px; letter-spacing: 0.04em; }
.aui .brief .desc { margin: 12px 0 0; color: var(--fg-2); font-size: 13.5px; line-height: 1.58; }
.aui .brief .facts { display: flex; gap: 18px; margin-top: 12px; flex-wrap: wrap; }
.aui .brief .fact { font-size: 10.5px; letter-spacing: 0.16em; text-transform: uppercase; color: var(--faint); }
.aui .brief .fact b { display: block; margin-top: 3px; font: 500 12.5px/1.2 var(--mono); letter-spacing: 0; color: var(--fg-2); text-transform: none; }
.aui .tips { list-style: none; margin: 14px 0 0; padding: 0; display: grid; gap: 7px; }
.aui .tips li { position: relative; padding-left: 16px; font-size: 12.5px; color: var(--dim); line-height: 1.45; }
.aui .tips li::before { content: ""; position: absolute; left: 1px; top: 0.62em; width: 6px; height: 1px; background: var(--amber); }
.aui .brief .bbody { flex: 1; min-height: 0; margin-right: -8px; padding-right: 8px; }
.aui .brief .actions { flex: none; padding-top: 14px; margin-top: 2px; border-top: 1px solid var(--line); }
.aui .brief .actions { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
.aui .kbnote { font-size: 11.5px; color: var(--faint); }
.aui .touchnote {
  display: none; margin-top: 10px; padding: 10px 12px; border-radius: 8px; border: 1px solid rgba(255,201,77,0.3);
  background: rgba(255,201,77,0.07); color: var(--warn); font-size: 12.5px; line-height: 1.45;
}
.aui.touch .touchnote { display: block; }

/* buttons */
.aui .btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 10px;
  padding: 12px 20px; border-radius: 7px; border: 1px solid var(--line-2);
  font: 600 12px/1 var(--sans); letter-spacing: 0.2em; text-transform: uppercase; color: var(--fg);
  background: rgba(255,255,255,0.04); transition: background 0.2s, border-color 0.2s, color 0.2s, transform 0.2s var(--ease);
  white-space: nowrap;
}
.aui .btn:hover { background: rgba(255,255,255,0.1); border-color: rgba(255,255,255,0.35); }
.aui .btn:focus-visible { background: rgba(255,255,255,0.1); border-color: rgba(255,255,255,0.6); outline: none; box-shadow: 0 0 0 3px rgba(255,179,71,0.35); }
.aui .btn:active { transform: translateY(1px); }
.aui .btn.primary { background: linear-gradient(180deg, #ffc266, #f39a2a); border-color: #ffc266; color: #1a1104; box-shadow: 0 8px 26px rgba(255,160,50,0.25); }
.aui .btn.primary:hover, .aui .btn.primary:focus-visible { background: linear-gradient(180deg, #ffd08a, #ffab45); border-color: #ffe0b0; box-shadow: 0 8px 30px rgba(255,160,50,0.4), 0 0 0 3px rgba(255,179,71,0.25); }
.aui .btn .arrow { font-size: 14px; letter-spacing: 0; margin-right: -4px; }
.aui .btn.small { padding: 8px 12px; font-size: 10.5px; }

/* in-flight menu (left list of large actions) */
.aui .fmenu { display: flex; flex-direction: column; gap: 4px; width: min(100%, 360px); }
.aui .fitem {
  display: flex; align-items: baseline; justify-content: space-between; gap: 16px;
  padding: 13px 16px; border-radius: 7px; border: 1px solid transparent;
  font: 400 clamp(17px, 2.6vh, 21px)/1.1 var(--display); letter-spacing: 0.04em; color: var(--fg-2);
  transition: background 0.2s, border-color 0.2s, color 0.2s;
}
.aui .fitem small { font: 500 10.5px/1 var(--sans); letter-spacing: 0.16em; text-transform: uppercase; color: var(--faint); }
.aui .fitem:hover, .aui .fitem:focus-visible { background: rgba(255,179,71,0.1); border-color: rgba(255,179,71,0.3); color: #fff; outline: none; }
.aui .fitem:hover small, .aui .fitem:focus-visible small { color: var(--amber-2); }
.aui .fstatus { margin-top: 22px; display: grid; grid-template-columns: repeat(3, auto); justify-content: start; gap: 6px 28px; }
.aui .fstatus div { font-size: 10px; letter-spacing: 0.18em; text-transform: uppercase; color: var(--faint); }
.aui .fstatus b { display: block; margin-top: 4px; font: 500 14px/1.1 var(--mono); letter-spacing: 0; color: var(--fg-2); }

/* settings */
.aui .settings { width: 100%; padding-right: 6px; }
.aui .sgroup { margin: 0 0 18px; }
.aui .sgroup h3 { margin: 0 0 6px; font: 600 10.5px/1 var(--sans); letter-spacing: 0.26em; text-transform: uppercase; color: var(--amber); }
.aui .srow { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 8px 18px; padding: 9px 0; border-bottom: 1px solid var(--line); }
.aui .srow .sl { font-size: 13.5px; color: var(--fg); }
.aui .srow .sd { display: block; margin-top: 2px; font-size: 11.5px; color: var(--faint); line-height: 1.35; }
.aui .seg { display: inline-flex; border: 1px solid var(--line-2); border-radius: 6px; overflow: hidden; }
.aui .seg button { padding: 7px 12px; font: 600 10.5px/1 var(--sans); letter-spacing: 0.14em; text-transform: uppercase; color: var(--dim); transition: background 0.2s, color 0.2s; }
.aui .seg button + button { border-left: 1px solid var(--line-2); }
.aui .seg button:hover { color: var(--fg); background: rgba(255,255,255,0.07); }
.aui .seg button:focus-visible { color: var(--fg); background: rgba(255,255,255,0.1); outline: none; box-shadow: inset 0 0 0 2px var(--amber-2); }
.aui .seg button.on:focus-visible { color: #1a1104; background: var(--amber-2); box-shadow: inset 0 0 0 2px #fff; }
.aui .seg button.on { color: #1a1104; background: var(--amber); }
.aui .rng { display: inline-flex; align-items: center; gap: 12px; }
.aui .rng output { min-width: 4.2em; text-align: right; font: 500 12px/1 var(--mono); color: var(--fg-2); }
.aui input[type=range] { -webkit-appearance: none; appearance: none; width: clamp(110px, 16vw, 180px); height: 22px; background: transparent; margin: 0; cursor: pointer; }
.aui input[type=range]::-webkit-slider-runnable-track { height: 2px; background: linear-gradient(90deg, var(--amber) var(--p, 50%), rgba(255,255,255,0.18) var(--p, 50%)); border-radius: 1px; }
.aui input[type=range]::-moz-range-track { height: 2px; background: rgba(255,255,255,0.18); }
.aui input[type=range]::-moz-range-progress { height: 2px; background: var(--amber); }
.aui input[type=range]::-webkit-slider-thumb { -webkit-appearance: none; width: 14px; height: 14px; margin-top: -6px; border-radius: 50%; background: #fff; border: 0; box-shadow: 0 0 0 4px rgba(255,179,71,0.0); transition: box-shadow 0.2s; }
.aui input[type=range]::-moz-range-thumb { width: 14px; height: 14px; border-radius: 50%; background: #fff; border: 0; }
.aui input[type=range]:focus-visible { outline: none; }
.aui input[type=range]:focus-visible::-webkit-slider-thumb { box-shadow: 0 0 0 4px rgba(255,179,71,0.45); }

/* controls reference */
.aui .controls { width: 100%; padding-right: 6px; }
.aui .cgrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(290px, 1fr)); gap: 4px 28px; }
.aui .cgroup { break-inside: avoid; margin-bottom: 14px; }
.aui .cgroup h3 { margin: 0 0 6px; font: 600 10.5px/1 var(--sans); letter-spacing: 0.26em; text-transform: uppercase; color: var(--amber); }
.aui .crow { display: grid; grid-template-columns: 112px 1fr; gap: 10px; padding: 5px 0; border-bottom: 1px solid rgba(255,255,255,0.06); align-items: baseline; }
.aui .crow .ck { line-height: 1.9; }
.aui .crow .ca { font-size: 12.5px; color: var(--fg-2); line-height: 1.4; }
.aui .crow .cg { display: block; font-size: 11px; color: var(--faint); margin-top: 2px; }

/* about */
.aui .about { width: 100%; padding-right: 6px; color: var(--fg-2); font-size: 13.5px; line-height: 1.6; }
.aui .about h3 { margin: 18px 0 6px; font: 600 10.5px/1 var(--sans); letter-spacing: 0.26em; text-transform: uppercase; color: var(--amber); }
.aui .about h3:first-child { margin-top: 0; }
.aui .about p { margin: 0 0 10px; }
.aui .about dl { display: grid; grid-template-columns: max-content 1fr; gap: 4px 18px; margin: 0 0 8px; font-size: 12.5px; }
.aui .about dt { color: var(--faint); }
.aui .about dd { margin: 0; color: var(--fg-2); }
.aui .about ul { margin: 0 0 8px; padding-left: 18px; }
.aui .about li { margin: 3px 0; }
.aui .about q { font-family: var(--serif); font-style: italic; color: #fff; }

/* ================================================================ modal cards (help, result) */
.aui .modal {
  position: absolute; inset: 0; z-index: 30; display: grid; place-items: center; padding: 16px;
  opacity: 0; visibility: hidden; transition: opacity 0.35s var(--ease), visibility 0s linear 0.35s;
}
.aui .modal.open { opacity: 1; visibility: visible; transition: opacity 0.35s var(--ease), visibility 0s; }
.aui .modal .veil { position: absolute; inset: 0; background: radial-gradient(120% 100% at 50% 50%, rgba(0,0,0,0.55), rgba(0,0,0,0.8)); }
.aui .card {
  position: relative; max-width: min(960px, 100%); max-height: calc(100% - 8px); display: flex; flex-direction: column;
  background: var(--panel-solid); border: 1px solid var(--line); border-radius: 12px;
  box-shadow: 0 30px 90px rgba(0,0,0,0.6); padding: clamp(16px, 3vh, 28px) clamp(16px, 2.6vw, 32px);
  transform: translateY(12px) scale(0.985); transition: transform 0.5s var(--ease);
}
.aui .modal.open .card { transform: none; }
.aui .card .chead { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 14px; flex: none; }
.aui .card .chead h2 { margin: 0; font: 400 22px/1.1 var(--display); letter-spacing: 0.06em; }
.aui .card .close { width: 34px; height: 34px; border-radius: 50%; border: 1px solid var(--line-2); display: grid; place-items: center; color: var(--dim); font-size: 18px; line-height: 1; }
.aui .card .close:hover, .aui .card .close:focus-visible { color: #fff; border-color: rgba(255,255,255,0.4); outline: none; }

/* result card */
.aui .result .card { width: min(720px, 100%); padding: 0; overflow: hidden; }
.aui .result .rhero { position: relative; padding: clamp(20px, 4vh, 36px) clamp(18px, 3vw, 36px) clamp(16px, 3vh, 26px); overflow: hidden; }
.aui .result .rhero::before {
  content: ""; position: absolute; inset: 0; opacity: 0.9;
  background: radial-gradient(90% 140% at 100% 0%, rgba(255,179,71,0.18), rgba(255,179,71,0) 60%);
}
.aui .result.bad .rhero::before { background: radial-gradient(90% 140% at 100% 0%, rgba(255,77,64,0.22), rgba(255,77,64,0) 60%); }
.aui .result .rhero > * { position: relative; }
.aui .result .rkicker { font: 600 10.5px/1 var(--sans); letter-spacing: 0.3em; text-transform: uppercase; color: var(--amber); }
.aui .result.bad .rkicker { color: var(--alarm); }
.aui .result h1 { margin: 12px 0 6px; font: italic 400 clamp(28px, 5vh, 44px)/1.08 var(--serif); letter-spacing: 0.005em; color: #fff; }
.aui .result .rsub { color: var(--dim); font-size: 13px; letter-spacing: 0.04em; }
.aui .result .rpatch { position: absolute; right: clamp(16px, 3vw, 30px); top: 50%; transform: translateY(-50%); color: var(--amber-2); width: clamp(70px, 12vh, 104px); height: auto; opacity: 0.95; }
.aui .result.bad .rpatch { display: none; }
.aui .result .rbody { display: grid; grid-template-columns: 1fr auto; gap: 18px 26px; padding: clamp(14px, 2.6vh, 22px) clamp(18px, 3vw, 36px); border-top: 1px solid var(--line); }
.aui .result .rstats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px 22px; }
.aui .result .rstat .k { font-size: 10px; letter-spacing: 0.2em; text-transform: uppercase; color: var(--faint); }
.aui .result .rstat .v { margin-top: 5px; font: 500 19px/1.1 var(--mono); color: #fff; white-space: nowrap; }
.aui .result .rstat .v small { font: 600 10px/1 var(--sans); letter-spacing: 0.12em; color: var(--dim); margin-left: 4px; }
.aui .result .rstat .lim { margin-top: 3px; font-size: 10.5px; color: var(--faint); }
.aui .result .rstat.ok .v { color: var(--good); }
.aui .result .rstat.bad .v { color: #ff8a6b; }
.aui .result .rscore { display: grid; place-items: center; align-content: center; gap: 4px; min-width: 124px; }
.aui .result .ring { position: relative; width: 112px; height: 112px; }
.aui .result .ring svg { position: absolute; inset: 0; transform: rotate(-90deg); }
.aui .result .ring .rv { position: absolute; inset: 0; display: grid; place-items: center; align-content: center; }
.aui .result .ring .rv b { font: 300 36px/1 var(--display); color: #fff; }
.aui .result .ring .rv span { font: 600 10px/1 var(--sans); letter-spacing: 0.2em; color: var(--dim); margin-top: 4px; }
.aui .result .rating { font: 600 10.5px/1 var(--sans); letter-spacing: 0.22em; text-transform: uppercase; color: var(--amber-2); text-align: center; }
.aui .result .reason { grid-column: 1 / -1; margin: -4px 0 0; padding: 10px 12px; border-radius: 8px; background: rgba(255,77,64,0.08); border: 1px solid rgba(255,77,64,0.25); color: #ffb3aa; font-size: 12.5px; }
.aui .result .rfoot { display: flex; gap: 12px; flex-wrap: wrap; justify-content: flex-end; padding: 14px clamp(18px, 3vw, 36px) clamp(16px, 3vh, 24px); border-top: 1px solid var(--line); background: rgba(255,255,255,0.02); }

/* help card (above the result card if both are open) */
.aui .modal.help { z-index: 32; }
.aui .help .card { width: min(1040px, 100%); }
.aui .help .controls { overflow-y: auto; }

/* ================================================================ HUD */
.aui .hud { position: absolute; inset: 0; z-index: 2; font-size: var(--hud); transition: opacity 0.3s; }
.aui .hud.off { opacity: 0; }
.aui .hp {
  position: absolute; padding: 0.7em 0.9em; border-radius: 0.55em;
  background: linear-gradient(180deg, rgba(8,10,14,0.58), rgba(8,10,14,0.42));
  border: 1px solid rgba(255,255,255,0.08);
  box-shadow: 0 0.6em 2em rgba(0,0,0,0.25);
  text-shadow: 0 1px 2px rgba(0,0,0,0.6);
}
.aui .hl { font: 600 0.66em/1.2 var(--sans); letter-spacing: 0.2em; text-transform: uppercase; color: var(--dim); }
.aui .hv { font-family: var(--mono); font-variant-numeric: tabular-nums slashed-zero; color: var(--fg); white-space: nowrap; }
.aui .hu { font: 600 0.62em/1 var(--sans); letter-spacing: 0.12em; color: var(--dim); margin-left: 0.35em; }
.aui .amber { color: var(--amber) !important; }
.aui .good { color: var(--good) !important; }
.aui .warn { color: var(--warn) !important; }
.aui .alarm { color: var(--alarm) !important; }

/* top-left: vessel & program */
.aui .h-id { left: 1.4em; top: 1.2em; min-width: 15em; }
.aui .h-id .vname { display: flex; align-items: baseline; gap: 0.6em; font: 600 0.72em/1 var(--sans); letter-spacing: 0.3em; text-transform: uppercase; color: var(--fg-2); }
.aui .h-id .vname i { font-style: normal; color: var(--faint); letter-spacing: 0.16em; }
.aui .h-id .prog { margin-top: 0.45em; display: flex; align-items: baseline; gap: 0.55em; white-space: nowrap; }
.aui .h-id .prog .pn { font: 600 1.45em/1 var(--mono); color: var(--amber); }
.aui .h-id .prog .pt { font: 600 0.8em/1 var(--sans); letter-spacing: 0.18em; color: var(--amber-2); }
.aui .chips { display: flex; flex-wrap: wrap; gap: 0.35em; margin-top: 0.65em; }
.aui .chip { font: 700 0.6em/1 var(--sans); letter-spacing: 0.14em; text-transform: uppercase; padding: 0.42em 0.6em 0.36em; border-radius: 0.35em; border: 1px solid rgba(255,255,255,0.16); color: var(--fg-2); white-space: nowrap; }
.aui .chip.a { color: #1a1104; background: var(--amber); border-color: var(--amber); }
.aui .chip.g { color: #06140c; background: var(--good); border-color: var(--good); }
.aui .chip.w { color: var(--warn); border-color: rgba(255,201,77,0.5); }
.aui .chip.dim { color: var(--faint); }

/* top-center: clock */
.aui .h-clock { left: 50%; top: 1.2em; transform: translateX(-50%); padding: 0.55em 1em 0.6em; text-align: center; min-width: 13em; }
.aui .h-clock .row { display: flex; align-items: baseline; justify-content: center; gap: 0.7em; }
.aui .h-clock .met { font: 500 1.3em/1 var(--mono); letter-spacing: 0.02em; }
.aui .h-clock .warp { font: 700 0.66em/1 var(--sans); letter-spacing: 0.14em; padding: 0.35em 0.5em 0.3em; border-radius: 0.3em; border: 1px solid rgba(255,255,255,0.2); color: var(--fg-2); }
.aui .h-clock .warp.fast { color: #1a1104; background: var(--amber); border-color: var(--amber); }
.aui .h-clock .warp.paused { color: #fff; background: rgba(255,255,255,0.18); }
.aui .h-clock .cam { margin-top: 0.4em; font: 600 0.6em/1 var(--sans); letter-spacing: 0.24em; text-transform: uppercase; color: var(--faint); }

/* ignition / PRO prompt */
.aui .h-prompt { left: 50%; top: 5.6em; transform: translateX(-50%); text-align: center; padding: 0.55em 1.1em; border-color: rgba(255,179,71,0.45); background: rgba(30,20,6,0.62); }
.aui .h-prompt .pt { font: 700 0.78em/1.2 var(--sans); letter-spacing: 0.22em; text-transform: uppercase; color: var(--amber); }
.aui .h-prompt .ph { margin-top: 0.3em; font-size: 0.78em; color: var(--fg-2); }
.aui .h-prompt .tig { font: 500 1.25em/1.1 var(--mono); color: #fff; margin-top: 0.15em; }
.aui .h-prompt.flash { animation: aui-pulse 1s steps(2, jump-none) infinite; }
.aui .h-prompt.alarmp { border-color: rgba(255,77,64,0.6); background: rgba(40,6,4,0.7); }
.aui .h-prompt.alarmp .pt { color: var(--alarm); }
@keyframes aui-pulse { 0% { box-shadow: 0 0 0 1px rgba(255,179,71,0.9), 0 0 24px rgba(255,179,71,0.35); } 100% { box-shadow: none; } }

/* top-right: caution & warning */
.aui .h-cw { right: 1.4em; top: 1.2em; display: flex; flex-direction: column; align-items: flex-end; gap: 0.4em; padding: 0; background: none; border: 0; box-shadow: none; }
.aui .lamp {
  font: 700 0.64em/1 var(--sans); letter-spacing: 0.16em; text-transform: uppercase; padding: 0.7em 0.9em 0.62em; border-radius: 0.35em;
  border: 1px solid rgba(255,255,255,0.12); color: var(--faint); background: rgba(8,10,14,0.5); white-space: nowrap;
}
.aui .lamp.ma { color: #fff; background: #d8281c; border-color: #ff7a6e; box-shadow: 0 0 1.6em rgba(255,60,40,0.6); }
.aui .lamp.ma.blink { animation: aui-blink 0.5s steps(2, jump-none) infinite; }
.aui .lamp.contact { color: #041424; background: var(--contact); border-color: #a9dcff; box-shadow: 0 0 1.4em rgba(98,185,255,0.55); }
.aui .lamp.caution { color: #1a1104; background: var(--warn); border-color: #ffe29a; }
@keyframes aui-blink { 0% { opacity: 1; } 100% { opacity: 0.35; } }

/* left-bottom: flight data */
.aui .h-flight { left: 1.4em; bottom: 1.4em; width: 17.5em; }
.aui .h-alt .hv { font-size: 2.3em; line-height: 1; letter-spacing: -0.01em; }
.aui .h-alt .hu { font-size: 0.66em; }
.aui .h-sep { height: 1px; background: rgba(255,255,255,0.08); margin: 0.65em 0; }
.aui .h-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.55em 1em; }
.aui .h-grid .val, .aui .h-att .val { margin-top: 0.25em; white-space: nowrap; }
.aui .h-grid .hv { font-size: 1.12em; }
.aui .h-grid .full { grid-column: 1 / -1; }
.aui .h-att { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.2em 0.8em; }
.aui .h-att .hv { font-size: 0.98em; }
.aui .vsarrow { display: inline-block; width: 0.9em; text-align: center; color: var(--dim); font-family: var(--sans); }

/* right-bottom: propulsion */
.aui .h-prop { right: 1.4em; bottom: 1.4em; width: 16.5em; }
.aui .h-eng { display: flex; align-items: baseline; justify-content: space-between; gap: 0.5em; }
.aui .h-eng .hv { font-size: 2em; line-height: 1; }
.aui .bar { position: relative; height: 0.42em; border-radius: 0.21em; background: rgba(255,255,255,0.1); margin-top: 0.45em; overflow: visible; }
.aui .bar i { position: absolute; left: 0; top: 0; bottom: 0; border-radius: inherit; background: var(--fg); width: 0; }
.aui .bar i.amber-f { background: var(--amber); }
.aui .bar .tick { position: absolute; top: -0.25em; bottom: -0.25em; width: 2px; margin-left: -1px; background: var(--good); border-radius: 1px; }
.aui .bar .cmd { position: absolute; top: -0.35em; width: 0; height: 0; margin-left: -0.3em; border-left: 0.3em solid transparent; border-right: 0.3em solid transparent; border-top: 0.32em solid var(--amber-2); }
.aui .h-row { display: flex; align-items: baseline; justify-content: space-between; gap: 0.6em; margin-top: 0.7em; }
.aui .h-row .hv { font-size: 1.05em; }

/* right-middle: orbit / navigation */
.aui .h-nav { right: 1.4em; top: 50%; transform: translateY(-58%); width: 15.5em; }
.aui .h-nav .h-kv { display: flex; align-items: baseline; justify-content: space-between; gap: 0.8em; padding: 0.24em 0; }
.aui .h-nav .h-kv .hv { font-size: 0.98em; }
.aui .h-nav h4 { margin: 0 0 0.35em; font: 600 0.62em/1 var(--sans); letter-spacing: 0.26em; text-transform: uppercase; color: var(--amber); }
.aui .h-nav .blk:not(.hidden) ~ .blk:not(.hidden) { margin-top: 0.7em; padding-top: 0.6em; border-top: 1px solid rgba(255,255,255,0.08); }

/* bottom-centre: landing guidance (ROD / LPD) */
.aui .h-guide { left: 50%; bottom: 1.4em; transform: translateX(-50%); display: flex; gap: 1.4em; align-items: center; padding: 0.6em 1.1em; }
.aui .h-guide .gk { text-align: center; }
.aui .h-guide .val { margin-top: 0.25em; white-space: nowrap; }
.aui .h-guide .hv { font-size: 1.35em; color: var(--amber-2); }

/* IVA compact strip */
.aui .h-strip {
  left: 50%; top: 0.9em; transform: translateX(-50%); display: flex; align-items: baseline; gap: 1.2em; padding: 0.45em 1em;
  font-size: 0.9em; white-space: nowrap; background: rgba(6,8,11,0.55);
}
.aui .h-strip .hl { margin-right: 0.45em; }
.aui .h-strip .hv { font-size: 1em; }
.aui .h-strip .sid { font: 600 0.8em/1 var(--sans); letter-spacing: 0.2em; color: var(--amber); }
.aui .h-strip .sep { width: 1px; align-self: stretch; background: rgba(255,255,255,0.12); }

/* 3D markers */
.aui .markers { position: absolute; inset: 0; z-index: 1; }
.aui .mk { position: absolute; left: 0; top: 0; will-change: transform; font-size: var(--hud); }
.aui .mk .ret { position: absolute; left: 0; top: 0; transform: translate(-50%, -50%); overflow: visible; }
.aui .mk .lbl {
  position: absolute; left: 1.3em; top: -0.35em; white-space: nowrap; padding: 0.3em 0.5em 0.32em; border-radius: 0.3em;
  background: rgba(6,8,11,0.5); text-shadow: 0 1px 2px rgba(0,0,0,0.8);
}
.aui .mk .lbl .n { font: 700 0.62em/1 var(--sans); letter-spacing: 0.2em; text-transform: uppercase; }
.aui .mk .lbl .d { display: block; margin-top: 0.28em; font: 500 0.78em/1 var(--mono); color: var(--fg); }
.aui .mk.site { color: var(--amber); }
.aui .mk.ves { color: #9fd3ff; }
.aui .mk.edge .ret { opacity: 0.9; }
.aui .mk.edge .lbl { left: auto; right: 1.3em; }
.aui .mk.edge.l .lbl { left: 1.3em; right: auto; }

/* message ticker & captions */
.aui .ticker { position: absolute; z-index: 10; left: 50%; bottom: 7.5em; transform: translateX(-50%); width: min(44em, calc(100% - 2em)); display: flex; flex-direction: column; align-items: center; gap: 0.4em; font-size: var(--hud); }
.aui .ticker.iva { bottom: 3.4em; }
.aui .tmsg {
  max-width: 100%; padding: 0.48em 0.9em 0.5em; border-radius: 0.45em; background: rgba(6,8,11,0.66); border: 1px solid rgba(255,255,255,0.08);
  font-size: 0.92em; color: var(--fg); text-align: center; text-shadow: 0 1px 2px rgba(0,0,0,0.6);
  animation: aui-in 0.35s var(--ease) both; transition: opacity 0.6s, transform 0.6s;
}
.aui .tmsg.out { opacity: 0; transform: translateY(-0.4em); }
.aui .tmsg.good { border-color: rgba(121,224,163,0.35); }
.aui .tmsg.warn { border-color: rgba(255,201,77,0.45); color: #ffe1a0 !important; }
.aui .tmsg.alarm { border-color: rgba(255,77,64,0.6); background: rgba(40,6,4,0.72); color: #ffc2bb !important; }
.aui .tmsg .cnt { margin-left: 0.5em; font: 600 0.8em/1 var(--mono); color: var(--dim); }
.aui .tcap { background: rgba(0,0,0,0.55); border-color: transparent; font-family: var(--serif); font-style: italic; font-size: 1.02em; }
.aui .tcap .who { font: 700 0.62em/1 var(--sans); font-style: normal; letter-spacing: 0.18em; padding: 0.3em 0.45em 0.25em; border-radius: 0.25em; margin-right: 0.7em; vertical-align: 0.18em; color: #0b0d10; background: var(--fg-2); }
.aui .tcap .who.CDR { background: #ffd08a; }
.aui .tcap .who.LMP { background: #9fd3ff; }
.aui .tcap .who.CMP { background: #c7b6ff; }
.aui .tcap .who.CAPCOM { background: #a8e6bf; }
@keyframes aui-in { from { opacity: 0; transform: translateY(0.5em); } to { opacity: 1; transform: none; } }

/* pause banner */
.aui .pausebar { position: absolute; z-index: 10; left: 50%; top: 42%; transform: translate(-50%, -50%); padding: 0.8em 1.6em; border-radius: 0.6em; background: rgba(6,8,11,0.6); border: 1px solid rgba(255,255,255,0.12); text-align: center; font-size: var(--hud); }
.aui .pausebar b { display: block; font: 300 2em/1 var(--display); letter-spacing: 0.4em; margin-right: -0.4em; }
.aui .pausebar span { display: block; margin-top: 0.6em; font-size: 0.8em; color: var(--dim); letter-spacing: 0.08em; }

/* ================================================================ responsive */
@media (max-width: 1100px) {
  .aui .shell { width: min(100%, 700px); }
}
@media (max-height: 820px) {
  .aui .tagline { display: none; }
}
@media (max-height: 640px) {
  .aui .brand .patch { width: 56px; }
  .aui .brief .desc { font-size: 12.5px; }
}
@media (max-width: 720px) {
  .aui .shell { width: 100%; padding: 22px 16px 14px; }
  .aui .screen.title .scrim { background: linear-gradient(180deg, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.4) 40%, rgba(0,0,0,0.82) 72%, rgba(0,0,0,0.88) 100%); }
  .aui .title-main { font-size: clamp(32px, 11.5vw, 52px); letter-spacing: 0.12em; margin-right: -0.12em; }
  .aui .title-sub { letter-spacing: 0.42em; font-size: 11px; }
  .aui .brand .patch { width: 58px; }
  .aui .tabs { gap: 16px; }
  .aui .tab { letter-spacing: 0.16em; font-size: 10.5px; }
  .aui .missions { flex-direction: column; align-items: stretch; overflow-y: auto; }
  .aui .mlist { flex: none; padding-right: 0; }
  .aui .brief { flex: none; }
  .aui .crow { grid-template-columns: 96px 1fr; }
  .aui .result .rbody { grid-template-columns: 1fr; }
  .aui .result .rstats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .aui .result .rpatch { display: none; }
  .aui .foot { display: none; }
  .aui .h-flight, .aui .h-prop { width: 13.5em; left: 0.8em; bottom: 0.8em; }
  .aui .h-prop { left: auto; right: 0.8em; }
  .aui .h-id { left: 0.8em; top: 0.8em; min-width: 0; max-width: calc(100% - 12em); }
  .aui .h-clock { left: auto; right: 0.8em; top: 0.8em; transform: none; min-width: 0; }
  .aui .h-cw { right: 0.8em; top: 5.2em; }
  .aui .h-prompt { top: 9em; }
  .aui .h-nav { display: none; }
  .aui .h-strip { top: 0.6em; font-size: 0.8em; gap: 0.8em; max-width: calc(100% - 1em); overflow: hidden; }
  .aui .ticker { bottom: 15em; }
}
@media (max-width: 900px) and (min-width: 721px) {
  .aui .h-nav { top: auto; bottom: 14em; transform: none; }
}
/* large screens: scale the menus and cards (the HUD scales through --hud) */
@media (min-width: 1680px) and (min-height: 940px) {
  .aui .shell, .aui .modal .card { zoom: 1.2; }
}
@media (min-width: 2300px) and (min-height: 1280px) {
  .aui .shell, .aui .modal .card { zoom: 1.55; }
}
@media (min-width: 3200px) and (min-height: 1760px) {
  .aui .shell, .aui .modal .card { zoom: 2; }
}
.aui .result.open h1 { animation: aui-rise 1.4s var(--ease) both 0.1s; }
.aui .result.open .rkicker, .aui .result.open .rsub { animation: aui-rise 1.2s var(--ease) both 0.35s; }
@keyframes aui-rise { from { opacity: 0; transform: translateY(0.35em); letter-spacing: 0.04em; } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) {
  .aui *, .aui *::before, .aui *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
}
`;

let injected = false;
/** Inject the stylesheet once. */
export function injectStyles() {
  if (injected || typeof document === 'undefined') return;
  injected = true;
  const el = document.createElement('style');
  el.id = 'apollo-ui-styles';
  el.textContent = CSS;
  document.head.appendChild(el);
}
