// Inline SVG icon set (24x24, drawn in currentColor). icon(name) -> '<svg ...>' string.
// Chunky, rounded shapes to match the toy-sticker UI. No emoji as UI icons.

function gearPath() {
  // eight rounded teeth around a ring, with a hole in the middle (evenodd)
  const pts = [];
  const teeth = 8;
  for (let i = 0; i < teeth * 2; i++) {
    const a0 = (i / (teeth * 2)) * Math.PI * 2;
    const a1 = ((i + 1) / (teeth * 2)) * Math.PI * 2;
    const r = i % 2 === 0 ? 10 : 7.6;
    pts.push(`${(12 + Math.cos(a0) * r).toFixed(2)} ${(12 + Math.sin(a0) * r).toFixed(2)}`);
    pts.push(`${(12 + Math.cos(a1) * r).toFixed(2)} ${(12 + Math.sin(a1) * r).toFixed(2)}`);
  }
  return `<path fill-rule="evenodd" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" d="M${pts.join(' L')} Z M12 8.6a3.4 3.4 0 1 0 0 6.8 3.4 3.4 0 1 0 0-6.8z"/>`;
}

function starPath(cx, cy, R, r) {
  const p = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i / 10) * Math.PI * 2;
    const rad = i % 2 === 0 ? R : r;
    p.push(`${(cx + Math.cos(a) * rad).toFixed(2)} ${(cy + Math.sin(a) * rad).toFixed(2)}`);
  }
  return `M${p.join(' L')} Z`;
}

/** Rounded rectangle as a path (so it can be combined with others under evenodd). */
function rr(x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  return `M${x + r} ${y}h${w - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}v${h - 2 * r}a${r} ${r} 0 0 1 -${r} ${r}h-${w - 2 * r}a${r} ${r} 0 0 1 -${r} -${r}v-${h - 2 * r}a${r} ${r} 0 0 1 ${r} -${r}Z`;
}

// details are cut out of the shape (evenodd) so icons read on any button color
const EO = 'fill-rule="evenodd" clip-rule="evenodd"';

const S = 'fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"';

const PATHS = {
  build: `<path d="M12 2.6 20.4 7.2 12 11.8 3.6 7.2Z"/><path opacity=".78" d="M3.4 8.7 11.2 13v8.6L3.4 17.3Z"/><path opacity=".55" d="M12.8 13l7.8-4.3v8.6l-7.8 4.3Z"/>`,
  remove: `<g transform="rotate(-38 12 12)"><path ${EO} d="${rr(2.5, 7.5, 19, 9.5, 3)} ${rr(9.4, 7.5, 1.9, 9.5, 0.2)}"/></g><path ${S} stroke-width="2.4" d="M5 21.5h14"/>`,
  hand: `<rect x="6" y="4.2" width="2.9" height="10" rx="1.45"/><rect x="9.2" y="2.4" width="2.9" height="11" rx="1.45"/><rect x="12.4" y="3" width="2.9" height="11" rx="1.45"/><rect x="15.6" y="5.2" width="2.9" height="9" rx="1.45"/><rect x="2.7" y="9.6" width="2.9" height="7.4" rx="1.45" transform="rotate(-32 4.2 13.3)"/><path d="M6 11h12.5v4.2a6.3 6.3 0 0 1-6.3 6.3h-.4A5.8 5.8 0 0 1 6 15.7Z"/>`,
  bag: `<path ${S} stroke-width="2.4" d="M8.3 10.5V7.2a3.7 3.7 0 0 1 7.4 0v3.3"/><path ${EO} d="M5.2 8.6h13.6l1.5 10.6a2.4 2.4 0 0 1-2.4 2.7H6.1a2.4 2.4 0 0 1-2.4-2.7Z M12 19.2s-3.6-2.2-3.6-4.6a1.9 1.9 0 0 1 3.6-1 1.9 1.9 0 0 1 3.6 1c0 2.4-3.6 4.6-3.6 4.6Z"/>`,
  fly: `<path d="M12 13.4C8 13.6 3.2 11.4 1.8 4.8c2.8 2 6 2.3 8.4 3.6 1.3.8 1.9 2.6 1.8 5Z"/><path d="M12 13.4c4 .2 8.8-2 10.2-8.6-2.8 2-6 2.3-8.4 3.6-1.3.8-1.9 2.6-1.8 5Z"/><path opacity=".7" d="M11.8 15C9 16.4 5.2 16.1 3.4 12.8c2.8.7 5.6.3 8.4 2.2Z"/><path opacity=".7" d="M12.2 15c2.8 1.4 6.6 1.1 8.4-2.2-2.8.7-5.6.3-8.4 2.2Z"/><circle cx="12" cy="14.6" r="2"/>`,
  emote: `<path fill-rule="evenodd" d="M12 2.5a9.5 9.5 0 1 0 0 19 9.5 9.5 0 1 0 0-19Zm-3.3 6a1.6 1.6 0 1 1 0 3.2 1.6 1.6 0 0 1 0-3.2Zm6.6 0a1.6 1.6 0 1 1 0 3.2 1.6 1.6 0 0 1 0-3.2ZM7.4 13.6h9.2a4.6 4.6 0 0 1-9.2 0Z"/>`,
  photo: `<path fill-rule="evenodd" d="M4.5 7.2h2.8l1.6-2.6h6.2l1.6 2.6h2.8a2.3 2.3 0 0 1 2.3 2.3v8.8a2.3 2.3 0 0 1-2.3 2.3h-15a2.3 2.3 0 0 1-2.3-2.3V9.5a2.3 2.3 0 0 1 2.3-2.3Zm7.5 3a3.9 3.9 0 1 0 0 7.8 3.9 3.9 0 0 0 0-7.8Z"/>`,
  dress: `<path ${EO} d="M8.4 2.4h1.9l1.7 3 1.7-3h1.9l-1.2 5.2 5.3 13.8H4.3L9.6 7.6Z ${rr(9.4, 7.6, 5.2, 1.7, 0.85)}"/>`,
  sticker: `<path ${EO} d="M5.5 2.8h13a2.7 2.7 0 0 1 2.7 2.7v8.8L14.3 21.2H5.5a2.7 2.7 0 0 1-2.7-2.7V5.5a2.7 2.7 0 0 1 2.7-2.7Z ${starPath(11, 10.6, 5, 2.2)}"/><path d="M15.8 21v-3.2a2 2 0 0 1 2-2H21Z"/>`,
  menu: `<rect x="3.5" y="5" width="17" height="3.2" rx="1.6"/><rect x="3.5" y="10.4" width="17" height="3.2" rx="1.6"/><rect x="3.5" y="15.8" width="17" height="3.2" rx="1.6"/>`,
  gem: `<path ${EO} d="M6.4 3.2h11.2l4 5.6L12 21 2.4 8.8Z M4.6 8.1h14.8l.6.9H4Z"/>`,
  sun: `<circle cx="12" cy="12" r="5"/><g ${S} stroke-width="2.4"><path d="M12 2.2v2.4M12 19.4v2.4M2.2 12h2.4M19.4 12h2.4M5.1 5.1l1.7 1.7M17.2 17.2l1.7 1.7M5.1 18.9l1.7-1.7M17.2 6.8l1.7-1.7"/></g>`,
  moon: `<path d="M20.6 14.6A8.8 8.8 0 1 1 9.4 3.4a7.1 7.1 0 0 0 11.2 11.2Z"/><circle cx="17" cy="5" r="1.1"/><circle cx="20.5" cy="8.6" r=".8"/>`,
  undo: `<path ${S} d="M9 14.5 4 9.5l5-5"/><path ${S} d="M4.5 9.5H14a6 6 0 0 1 0 12h-3"/>`,
  music: `<path d="M9.2 17.6A3.1 3.1 0 1 1 7.2 14.7V5.2L19 2.8v12.4a3.1 3.1 0 1 1-2-2.9V6.4l-7.8 1.6Z"/>`,
  close: `<path ${S} stroke-width="3.4" d="M6 6l12 12M18 6 6 18"/>`,
  check: `<path ${S} stroke-width="3.4" d="m4.5 12.5 5 5 10-11"/>`,
  play: `<path d="M7.6 4.2c0-1.3 1.4-2 2.4-1.3l10 7.1c.9.6.9 2 0 2.6l-10 7.1c-1 .7-2.4 0-2.4-1.3Z"/>`,
  plus: `<path ${S} stroke-width="3.4" d="M12 4.5v15M4.5 12h15"/>`,
  trash: `<path ${EO} d="M5 7.2h14l-1.2 12.6a2 2 0 0 1-2 1.8H8.2a2 2 0 0 1-2-1.8Z ${rr(9.2, 10, 1.6, 8, 0.8)} ${rr(13.2, 10, 1.6, 8, 0.8)}"/><path d="${rr(3.4, 4.2, 17.2, 2.4, 1.2)} ${rr(9.2, 2.2, 5.6, 2.6, 1.1)}"/>`,
  pencil: `<path ${EO} d="M15.6 3.6a2.3 2.3 0 0 1 3.2 0l1.6 1.6a2.3 2.3 0 0 1 0 3.2L9.3 19.5l-5.4 1.2 1.2-5.4Z M13.6 5.8l1-1 4.6 4.6-1 1Z"/>`,
  heart: `<path d="M12 21.2S3.2 15.6 3.2 9.4A4.8 4.8 0 0 1 12 6.6a4.8 4.8 0 0 1 8.8 2.8c0 6.2-8.8 11.8-8.8 11.8Z"/>`,
  star: `<path stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" d="${starPath(12, 12.6, 10, 4.4)}"/>`,
  home: `<path d="M3 11.2 12 3.4l9 7.8v8.6a1.6 1.6 0 0 1-1.6 1.6h-4.6v-6.2H9.2v6.2H4.6A1.6 1.6 0 0 1 3 19.8Z"/>`,
  settings: gearPath(),
  jump: `<path d="M12 2.8 19.4 10H15v5.2H9V10H4.6Z"/><rect x="4.5" y="18" width="15" height="3.2" rx="1.6"/>`,
  up: `<path ${S} stroke-width="3.6" d="M5 15.5 12 8.5l7 7"/>`,
  down: `<path ${S} stroke-width="3.6" d="m5 8.5 7 7 7-7"/>`,
  back: `<path ${S} stroke-width="3.4" d="M15 5 8 12l7 7"/>`,
  world: `<path ${EO} d="M12 2.5a9.5 9.5 0 1 0 0 19 9.5 9.5 0 1 0 0-19Z M6.2 6.6c2 .4 3.2 1.6 2.8 3.2-.3 1.4-2.1 1.4-2.4 3-.3 1.5 1.4 2.4 1 4.2-.2 1-.9 1.7-1.7 2.2A8.1 8.1 0 0 1 6.2 6.6Z M14.4 4.3c1 1.2 2.9 1.4 3.4 2.9.5 1.8-1.3 2.4-.9 4.1.4 1.5 2.3 1.4 3.1 2.6a8.1 8.1 0 0 0-5.6-9.6Z"/>`,
  sparkle: `<path d="M12 1.8c.6 4.8 2.6 7.4 8 8.2-5.4.8-7.4 3.4-8 8.2-.6-4.8-2.6-7.4-8-8.2 5.4-.8 7.4-3.4 8-8.2Z"/><path opacity=".7" d="M19 15.2c.3 2.2 1.2 3.2 3.2 3.5-2 .3-2.9 1.3-3.2 3.5-.3-2.2-1.2-3.2-3.2-3.5 2-.3 2.9-1.3 3.2-3.5Z"/>`,
  sound: `<path d="M3.5 9h3.8l5.2-4.4v14.8L7.3 15H3.5Z"/><path ${S} stroke-width="2.4" d="M16 8.5a5 5 0 0 1 0 7M18.8 5.8a9 9 0 0 1 0 12.4"/>`,
  mute: `<path d="M3.5 9h3.8l5.2-4.4v14.8L7.3 15H3.5Z"/><path ${S} stroke-width="2.6" d="m16 9 5 6M21 9l-5 6"/>`,
  camera3d: `<circle cx="12" cy="7.5" r="4"/><path d="M4.5 21c0-4.2 3.4-7.2 7.5-7.2s7.5 3 7.5 7.2Z"/>`,
  download: `<path ${S} d="M12 3.5v11M7 10l5 5 5-5M4.5 20h15"/>`,
};

/** SVG markup for an icon (unknown names give a star). */
export function icon(name, { size = null, cls = '' } = {}) {
  const body = PATHS[name] || PATHS.star;
  const dim = size ? ` width="${size}" height="${size}"` : '';
  return `<svg class="sw-icon ${cls}" viewBox="0 0 24 24"${dim} fill="currentColor" aria-hidden="true" focusable="false">${body}</svg>`;
}

export const ICON_NAMES = Object.keys(PATHS);
