// Extra UI icons for the Menus team (title, wizard, Bag, settings, photo, help). Same style as
// src/ui/icons.js: 24x24, drawn in currentColor, chunky and rounded. icon2(name) falls back to
// the core set, so any core icon name works too.

import { icon as coreIcon } from '../icons.js';

const S = 'fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"';
const EO = 'fill-rule="evenodd" clip-rule="evenodd"';

function rr(x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  return `M${x + r} ${y}h${w - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}v${h - 2 * r}a${r} ${r} 0 0 1 -${r} ${r}h-${w - 2 * r}a${r} ${r} 0 0 1 -${r} -${r}v-${h - 2 * r}a${r} ${r} 0 0 1 ${r} -${r}Z`;
}

function circ(cx, cy, r) {
  return `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`;
}

function starPath(cx, cy, R, r, n = 5) {
  const p = [];
  for (let i = 0; i < n * 2; i++) {
    const a = -Math.PI / 2 + (i / (n * 2)) * Math.PI * 2;
    const rad = i % 2 === 0 ? R : r;
    p.push(`${(cx + Math.cos(a) * rad).toFixed(2)} ${(cy + Math.sin(a) * rad).toFixed(2)}`);
  }
  return `M${p.join(' L')} Z`;
}

const PATHS = {
  search: `<circle ${S} stroke-width="3.2" cx="10.2" cy="10.2" r="6.2"/><path ${S} stroke-width="3.8" d="M15 15l5.5 5.5"/>`,
  dice: `<path ${EO} d="${rr(3, 3, 18, 18, 4.5)} ${circ(8, 8, 1.8)} ${circ(16, 8, 1.8)} ${circ(12, 12, 1.8)} ${circ(8, 16, 1.8)} ${circ(16, 16, 1.8)}"/>`,
  help: `<path ${S} stroke-width="3.4" d="M8.2 8.6a3.9 3.9 0 1 1 5.6 3.5c-1.2.6-1.8 1.4-1.8 2.7v.7"/><circle cx="12" cy="19.6" r="2"/>`,
  keyboard: `<path ${EO} d="${rr(1.8, 5.5, 20.4, 13, 3)} ${rr(4.6, 8.4, 2.4, 2.2, .6)} ${rr(8.2, 8.4, 2.4, 2.2, .6)} ${rr(11.8, 8.4, 2.4, 2.2, .6)} ${rr(15.4, 8.4, 2.4, 2.2, .6)} ${rr(4.6, 11.8, 2.4, 2.2, .6)} ${rr(17, 11.8, 2.4, 2.2, .6)} ${rr(7.8, 11.8, 8.4, 2.2, .6)} ${rr(7, 15.1, 10, 1.7, .6)}"/>`,
  open: `<path d="M2.8 7.2a2.2 2.2 0 0 1 2.2-2.2h4.4l2 2.2h7.6a2.2 2.2 0 0 1 2.2 2.2v1.2H2.8Z"/><path d="M2.4 11.6h19.2l-1.3 7.2a2.2 2.2 0 0 1-2.2 1.8H5.9a2.2 2.2 0 0 1-2.2-1.8Z"/>`,
  upload: `<path ${S} d="M12 16V5.5M7 10l5-5 5 5M4.5 20h15"/>`,
  download: `<path ${S} d="M12 3.5v11M7 10l5 5 5-5M4.5 20h15"/>`,
  flash: `<path d="M13.6 1.8 4.6 13.4h6.2L9.4 22.2l10-12.4h-6.4Z"/>`,
  frame: `<path ${EO} d="${rr(2.5, 3.5, 19, 17, 3)} ${rr(5.6, 6.6, 12.8, 10.8, 1.2)}"/><path d="M6.8 16.2l3.6-4.4 2.6 3 1.8-2 2.4 3.4Z"/>`,
  cloud: `<path d="M6.8 19.2a4.6 4.6 0 0 1-.6-9.2 6.2 6.2 0 0 1 11.9 1.2 4 4 0 0 1-.3 8Z"/>`,
  rain: `<path d="M6.8 14.6a4.1 4.1 0 0 1-.6-8.2 5.6 5.6 0 0 1 10.8 1 3.6 3.6 0 0 1-.3 7.2Z"/><path ${S} stroke-width="2.4" d="M8 17.4l-1 3M12.4 17.4l-1 3M16.8 17.4l-1 3"/>`,
  snow: `<g ${S} stroke-width="2.4"><path d="M12 2.5v19M3.8 7.2l16.4 9.6M3.8 16.8l16.4-9.6"/><path d="M9.4 3.9 12 6.5l2.6-2.6M9.4 20.1 12 17.5l2.6 2.6"/></g>`,
  rainbow: `<g fill="none" stroke-linecap="round" stroke="currentColor"><path stroke-width="2.6" d="M2.8 18.5a9.2 9.2 0 0 1 18.4 0"/><path stroke-width="2.6" opacity=".72" d="M6.4 18.5a5.6 5.6 0 0 1 11.2 0"/><path stroke-width="2.6" opacity=".45" d="M9.8 18.5a2.2 2.2 0 0 1 4.4 0"/></g>`,
  sunny: `<circle cx="12" cy="12" r="5.2"/><g ${S} stroke-width="2.4"><path d="M12 1.9v2.4M12 19.7v2.4M1.9 12h2.4M19.7 12h2.4M4.9 4.9l1.7 1.7M17.4 17.4l1.7 1.7M4.9 19.1l1.7-1.7M17.4 6.6l1.7-1.7"/></g>`,
  morning: `<path d="M5.5 16.6a6.5 6.5 0 0 1 13 0Z"/><g ${S} stroke-width="2.4"><path d="M2.5 19.8h19M12 4.6v2.2M4.8 8.4l1.6 1.4M19.2 8.4l-1.6 1.4"/></g>`,
  sunset: `<path d="M6 15.2a6 6 0 0 1 12 0Z"/><g ${S} stroke-width="2.4"><path d="M2.5 18.4h19M6.5 21.4h11M12 4.5v2.2M4.8 8l1.6 1.4M19.2 8l-1.6 1.4"/></g>`,
  night: `<path d="M20.6 14.6A8.8 8.8 0 1 1 9.4 3.4a7.1 7.1 0 0 0 11.2 11.2Z"/><path d="M17.2 3.2l.6 1.6 1.6.6-1.6.6-.6 1.6-.6-1.6-1.6-.6 1.6-.6Z"/>`,
  freeze: `<g ${S} stroke-width="2.4"><path d="M12 2.5v19M3.8 7.2l16.4 9.6M3.8 16.8l16.4-9.6"/><path d="M9.4 3.9 12 6.5l2.6-2.6M9.4 20.1 12 17.5l2.6 2.6M4.3 11.1l3.6.9-1 3.5M19.7 12.9l-3.6-.9 1-3.5"/></g>`,
  speak: `<path ${EO} d="M4.8 3.5h14.4a2.6 2.6 0 0 1 2.6 2.6v8.6a2.6 2.6 0 0 1-2.6 2.6H11l-4.8 3.9v-3.9H4.8a2.6 2.6 0 0 1-2.6-2.6V6.1a2.6 2.6 0 0 1 2.6-2.6Z ${rr(6, 7.1, 1.9, 6.2, .95)} ${rr(9.6, 5.9, 1.9, 8.6, .95)} ${rr(13.2, 7.6, 1.9, 5.2, .95)} ${rr(16.6, 8.8, 1.9, 2.8, .95)}"/>`,
  eye: `<path ${EO} d="M12 5c5.2 0 8.8 4.3 10 7-1.2 2.7-4.8 7-10 7S3.2 14.7 2 12c1.2-2.7 4.8-7 10-7Z ${circ(12, 12, 3.6)}"/><circle cx="12" cy="12" r="1.7"/>`,
  quality: `<path d="M6.4 3.2h11.2l4 5.6L12 21 2.4 8.8Z"/>`,
  fast: `<path d="M13.6 1.8 4.6 13.4h6.2L9.4 22.2l10-12.4h-6.4Z"/>`,
  auto: `<path ${EO} d="M12 2.5a9.5 9.5 0 1 0 0 19 9.5 9.5 0 1 0 0-19Z M10.2 7.4h3.6l3.6 9.8h-3l-.7-2.1h-3.4l-.7 2.1h-3Zm1.8 3-1 3h2Z"/>`,
  person: `<circle cx="12" cy="7.2" r="4.2"/><path d="M4.2 21.2c0-4.4 3.5-7.6 7.8-7.6s7.8 3.2 7.8 7.6Z"/>`,
  eyes: `<path ${EO} d="M2 12c1.6-3.6 5.2-6.6 10-6.6s8.4 3 10 6.6c-1.6 3.6-5.2 6.6-10 6.6S3.6 15.6 2 12Z ${circ(12, 12, 3.2)}"/>`,
  clock: `<path ${EO} d="M12 2.5a9.5 9.5 0 1 0 0 19 9.5 9.5 0 1 0 0-19Z M10.7 6.6h2.6v5l3.4 2.2-1.4 2.2-4.6-3Z"/>`,
  recent: `<path ${EO} d="M12 2.5a9.5 9.5 0 1 0 0 19 9.5 9.5 0 1 0 0-19Z M10.7 6.6h2.6v5l3.4 2.2-1.4 2.2-4.6-3Z"/>`,
  again: `<path ${S} stroke-width="3" d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M20.6 3.4v6.4h-6.4Z"/>`,
  tap: `<path d="M10.2 3.2a1.8 1.8 0 0 1 3.6 0v7.4l4.4.9a2.6 2.6 0 0 1 2 2.9l-.9 5.5a2.6 2.6 0 0 1-2.6 2.2h-6a2.6 2.6 0 0 1-2.1-1.1L4.6 15.8a1.7 1.7 0 0 1 2.7-2l2.9 2.8Z"/>`,
  pinch: `<g ${S} stroke-width="2.6"><path d="M4 4l5 5M20 20l-5-5M4 4h4.2M4 4v4.2M20 20h-4.2M20 20v-4.2"/></g><circle cx="12" cy="12" r="2.2"/>`,
  joystick: `<path ${EO} d="M12 2.2a9.8 9.8 0 1 0 0 19.6 9.8 9.8 0 1 0 0-19.6Z ${circ(12, 12, 7.4)}"/><circle cx="12" cy="12" r="4.4"/>`,
  mouse: `<path ${EO} d="M12 2.2c4 0 6.8 3 6.8 6.8v6.2c0 3.8-2.8 6.6-6.8 6.6s-6.8-2.8-6.8-6.6V9c0-3.8 2.8-6.8 6.8-6.8Z ${rr(10.9, 5.4, 2.2, 4.6, 1.1)}"/>`,
  grid: `<rect x="3" y="3" width="8" height="8" rx="2.2"/><rect x="13" y="3" width="8" height="8" rx="2.2"/><rect x="3" y="13" width="8" height="8" rx="2.2"/><rect x="13" y="13" width="8" height="8" rx="2.2"/>`,
  arrow: `<path ${S} stroke-width="3.4" d="M5 12h13M13 6l6 6-6 6"/>`,
  shutter: `<path ${EO} d="M4.5 7.2h2.8l1.6-2.6h6.2l1.6 2.6h2.8a2.3 2.3 0 0 1 2.3 2.3v8.8a2.3 2.3 0 0 1-2.3 2.3h-15a2.3 2.3 0 0 1-2.3-2.3V9.5a2.3 2.3 0 0 1 2.3-2.3Zm7.5 3a3.9 3.9 0 1 0 0 7.8 3.9 3.9 0 0 0 0-7.8Z"/>`,
  hearts: `<path d="M9 19.8S2 15.3 2 10.3a3.9 3.9 0 0 1 7-2.3 3.9 3.9 0 0 1 7 2.3c0 5-7 9.5-7 9.5Z"/><path opacity=".7" d="M18 10.4s-3.6-2.3-3.6-4.9a2 2 0 0 1 3.6-1.2 2 2 0 0 1 3.6 1.2c0 2.6-3.6 4.9-3.6 4.9Z"/>`,
  stars: `<path d="${starPath(9.5, 13.5, 8, 3.6)}"/><path opacity=".7" d="${starPath(18.5, 6, 4, 1.8)}"/>`,
  flower: `<path ${EO} d="M12 2.4a3.4 3.4 0 0 1 3.3 4.3 3.4 3.4 0 0 1 3.1 5.3 3.4 3.4 0 0 1-3.1 5.3A3.4 3.4 0 0 1 12 21.6a3.4 3.4 0 0 1-3.3-4.3A3.4 3.4 0 0 1 5.6 12a3.4 3.4 0 0 1 3.1-5.3A3.4 3.4 0 0 1 12 2.4Z ${circ(12, 12, 2.6)}"/>`,
  none: `<path ${EO} d="M12 2.5a9.5 9.5 0 1 0 0 19 9.5 9.5 0 1 0 0-19Z M17.5 8.2 8.2 17.5a6.6 6.6 0 0 0 9.3-9.3Z M15.8 6.5A6.6 6.6 0 0 0 6.5 15.8Z"/>`,
  coin: `<path ${EO} d="M12 2.5a9.5 9.5 0 1 0 0 19 9.5 9.5 0 1 0 0-19Z M12 5.4a6.6 6.6 0 1 0 0 13.2 6.6 6.6 0 1 0 0-13.2Z"/><path d="${starPath(12, 12.3, 4.4, 2)}"/>`,
  island: `<path d="M3 16.5c2-3.4 5.4-5 9-5s7 1.6 9 5Z"/><path opacity=".55" d="M1.5 19.5h21v1.8h-21Z"/><path d="M11 11.6V6.4h2v5.2Z"/><path d="M12 7c-2-2.6-5.2-2.8-7-1.6 2.4-.2 4.4.6 5.6 2.4ZM12 7c2-2.6 5.2-2.8 7-1.6-2.4-.2-4.4.6-5.6 2.4Z"/>`,
  sparkles: `<path d="M12 1.8c.6 4.8 2.6 7.4 8 8.2-5.4.8-7.4 3.4-8 8.2-.6-4.8-2.6-7.4-8-8.2 5.4-.8 7.4-3.4 8-8.2Z"/><path opacity=".7" d="M19 15.2c.3 2.2 1.2 3.2 3.2 3.5-2 .3-2.9 1.3-3.2 3.5-.3-2.2-1.2-3.2-3.2-3.5 2-.3 2.9-1.3 3.2-3.5Z"/>`,
  slow: `<path d="M3 17.5c0-4.6 3.6-8.2 8.2-8.2s7.2 3 7.2 6.4v1.8Z"/><circle cx="19.4" cy="12" r="2.2"/><path ${S} stroke-width="2" d="M19.6 9.8l.8-3M21 10.6l1.6-2"/><path opacity=".6" d="M2 18.6h19.4v2H2Z"/>`,
  run: `<path ${S} stroke-width="2.8" d="M2.5 8h6M1.5 12h5M2.5 16h6"/><path d="M15.8 3.2a2.4 2.4 0 1 1 0 4.8 2.4 2.4 0 0 1 0-4.8ZM12 9.4l4.2-.4 2.6 3.6 2.8.6-.4 2-4-.8-1.2-1.6-1.4 3.4 2.8 2.6-.6 4.6-2.2-.2.4-3.6-3.4-2.6-1.6 3.4-3.6.2.2-2.2 2.2-.2Z"/>`,
};

/** SVG markup for an icon; unknown names use the core set (which falls back to a star). */
export function icon2(name, opts = {}) {
  const body = PATHS[name];
  if (!body) return coreIcon(name, opts);
  const dim = opts.size ? ` width="${opts.size}" height="${opts.size}"` : '';
  return `<svg class="sw-icon ${opts.cls || ''}" viewBox="0 0 24 24"${dim} fill="currentColor" aria-hidden="true" focusable="false">${body}</svg>`;
}

/** ui.button() with an icon from this set (or the core set). */
export function button2(ui, opts = {}) {
  const { icon, ...rest } = opts;
  const b = ui.button({ ...rest, icon: null });
  if (icon) b.insertAdjacentHTML('afterbegin', icon2(icon));
  return b;
}
