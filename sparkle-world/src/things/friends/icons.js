// Little 24x24 icons (currentColor) for the friends UI: talk, follow, stay, treat, hair,
// surprise, twins, the outfit and style pictures (rocket, dino, ...) and the Friends button.
// Unknown names fall back to the core icon set and then to the life icons.

import { lifeIcon } from '../pets/kit.js';

const EO = 'fill-rule="evenodd" clip-rule="evenodd"';
const S = 'fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"';

const PATHS = {
  talk: `<path ${EO} d="M4.2 3.4h15.6a2.6 2.6 0 0 1 2.6 2.6v8.8a2.6 2.6 0 0 1-2.6 2.6h-7.6l-5.4 4.2v-4.2H4.2a2.6 2.6 0 0 1-2.6-2.6V6a2.6 2.6 0 0 1 2.6-2.6Z M7.6 9a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2Z M12 9a1.6 1.6 0 1 0 0 3.2A1.6 1.6 0 0 0 12 9Z M16.4 9a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2Z"/>`,
  follow: `<ellipse cx="7.4" cy="15.6" rx="3.2" ry="4.6" transform="rotate(-12 7.4 15.6)"/><circle cx="4.6" cy="9.2" r="1.1"/><circle cx="6.6" cy="8.4" r="1.1"/><circle cx="8.8" cy="8.6" r="1.1"/><ellipse cx="16.6" cy="10.2" rx="3.2" ry="4.6" transform="rotate(12 16.6 10.2)"/><circle cx="15.2" cy="3.2" r="1.1"/><circle cx="17.4" cy="3" r="1.1"/><circle cx="19.4" cy="3.8" r="1.1"/>`,
  stay: `<path ${EO} d="M12 1.8a7.4 7.4 0 0 1 7.4 7.4c0 5.4-7.4 13-7.4 13S4.6 14.6 4.6 9.2A7.4 7.4 0 0 1 12 1.8Z M12 5.6a3.4 3.4 0 1 0 0 6.8 3.4 3.4 0 0 0 0-6.8Z"/>`,
  treat: `<path d="M6.2 11.6h11.6L12.8 22a.9.9 0 0 1-1.6 0Z"/><path fill="#fff" opacity=".45" d="m8.4 13.4 1.2-.6 3.6 6.6-.8 1.6Z M14.4 12.8l1.2.6-2.4 5-.8-1.6Z"/><path d="M5.4 11.2a3.2 3.2 0 0 1 .8-5.4 5.8 5.8 0 0 1 11.6 0 3.2 3.2 0 0 1 .8 5.4Z"/><circle cx="12" cy="2.4" r="1.8"/><path fill="#fff" opacity=".6" d="M8.6 7.2h1.6v1.2H8.6Z M13.2 6h1.6v1.2h-1.6Z M15 8.6h1.6v1.2H15Z"/>`,
  hair: `<path d="M12 2.4c5.4 0 8.6 3.8 8.6 8.6v9.4c0 .9-.8 1.4-1.6 1l-2-1.2V11c0-2.6-1.2-4.4-3.2-5.2-.8 2.4-3.4 4-6.8 4.2V19l-2.4 1.6c-.8.5-1.8 0-1.8-1V11c0-4.8 3.8-8.6 9.2-8.6Z"/><path d="M15.4 2.6c1.4-1.4 3.6-1.4 4.6 0-.4 1.6-2 2.4-3.6 2.2Z"/>`,
  gift: `<path d="M3 9.4h18v3.8H3Z M4.4 13.2h6.6v8.4H4.4Z M13 13.2h6.6v8.4H13Z"/><path opacity=".7" d="M11 9.4h2v12.2h-2Z"/><path d="M12 9c-2.2-.2-5.6-1-5.6-3.6 0-1.6 1.4-2.6 2.8-2.2C11 3.6 11.6 6.4 12 9Zm0 0c.4-2.6 1-5.4 2.8-5.8 1.4-.4 2.8.6 2.8 2.2C17.6 8 14.2 8.8 12 9Z"/>`,
  twins: `<path d="M7.6 19.4S1.4 15.4 1.4 11a3.4 3.4 0 0 1 6.2-1.9A3.4 3.4 0 0 1 13.8 11c0 4.4-6.2 8.4-6.2 8.4Z"/><path opacity=".75" d="M16.4 15.4s-6.2-4-6.2-8.4a3.4 3.4 0 0 1 6.2-1.9A3.4 3.4 0 0 1 22.6 7c0 4.4-6.2 8.4-6.2 8.4Z"/>`,
  crown: `<path d="M2.6 7.6 7.4 11.4 12 4.2l4.6 7.2 4.8-3.8-1.8 10.6H4.4Z"/><path d="M4.4 19.6h15.2v2.2H4.4Z"/><circle cx="2.6" cy="6.6" r="1.6"/><circle cx="12" cy="3.2" r="1.6"/><circle cx="21.4" cy="6.6" r="1.6"/>`,
  ball: `<path ${EO} d="M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20Z M12 7.4l-3.8 2.8 1.4 4.4h4.8l1.4-4.4Z"/><path fill="#fff" opacity=".35" d="M4.2 8.4a8.6 8.6 0 0 1 4.2-4.6l.4 2.6-3 2.4Z M15.2 3.8a8.6 8.6 0 0 1 4.6 4.6l-2.2.4-2.8-2.4Z"/>`,
  wand: `<path d="m3 19.6 11-11 1.8 1.8-11 11Z"/><path d="M17 1.8c.4 2.4 1.4 3.4 3.6 3.8-2.2.4-3.2 1.4-3.6 3.8-.4-2.4-1.4-3.4-3.6-3.8 2.2-.4 3.2-1.4 3.6-3.8Z"/><circle cx="21" cy="11" r="1.2"/><circle cx="11.6" cy="2.8" r="1"/>`,
  snow: `<path ${S} stroke-width="2.2" d="M12 2v20M3.4 7l17.2 10M3.4 17 20.6 7M9.4 3.6 12 6l2.6-2.4M9.4 20.4 12 18l2.6 2.4M3.6 10.8l3.4-.8-.8-3.4M20.4 13.2l-3.4.8.8 3.4M6.2 17.2l.8-3.4-3.4-.8M17.8 6.8l-.8 3.4 3.4.8"/>`,
  guitar: `<path d="M13.4 8.6 20 2l2 2-6.6 6.6Z"/><path d="M11.8 7.6c1.4-.2 2.8.4 3.4 1.4 1 1.2.8 2.8-.4 3.8.6 3-1.4 6.8-5.4 8.2-3.4 1.2-6.2-.4-6.8-3.2-.6-2.6 1-4.8 3.4-5.6.4-2.2 3-4.4 5.8-4.6Z"/><circle cx="9.4" cy="14.6" r="1.8" fill="#fff" opacity=".6"/>`,
  shell: `<path d="M12 3.4c5 0 9 3.6 9.6 8.6.2 1.2-.8 2.2-2 2.2H4.4c-1.2 0-2.2-1-2-2.2C3 7 7 3.4 12 3.4Z"/><path d="M7.4 14.2h9.2l-1.6 5.2a1.8 1.8 0 0 1-1.8 1.4h-2.4a1.8 1.8 0 0 1-1.8-1.4Z"/><path ${S} stroke="#fff" stroke-opacity=".6" stroke-width="1.4" d="M12 4.4v9.4M7.8 5.6l2.2 8.2M16.2 5.6 14 13.8"/>`,
  skate: `<path d="M5.2 3.4h5.4v8.2h5.8a4.2 4.2 0 0 1 4.2 4.2v.8H3.4V5.2a1.8 1.8 0 0 1 1.8-1.8Z"/><circle cx="6.4" cy="19.8" r="2.2"/><circle cx="17.4" cy="19.8" r="2.2"/><path fill="#fff" opacity=".5" d="M5.4 7.4h3.4v1.4H5.4Z"/>`,
  palette: `<path ${EO} d="M12 2.2c5.6 0 10 3.8 10 8.6 0 3.2-2.6 4.8-5.2 4.2-1.6-.4-2.8.8-2.2 2.4.8 2.2-.4 4.4-3.2 4.4C6 21.8 2 17.4 2 12 2 6.6 6.4 2.2 12 2.2Z M7 8a1.8 1.8 0 1 0 0 3.6A1.8 1.8 0 0 0 7 8Z M11.6 5a1.8 1.8 0 1 0 0 3.6 1.8 1.8 0 0 0 0-3.6Z M16.6 6.8a1.8 1.8 0 1 0 0 3.6 1.8 1.8 0 0 0 0-3.6Z M7.8 13.4a1.8 1.8 0 1 0 0 3.6 1.8 1.8 0 0 0 0-3.6Z"/>`,
  friends: `<circle cx="8" cy="7.4" r="4.2"/><path d="M1.4 20.6c0-4 3-6.6 6.6-6.6s6.6 2.6 6.6 6.6Z"/><path d="M3.6 6.4c.4-3 2.4-4.6 4.4-4.6 2.4 0 4.2 1.6 4.6 4.4-1.8-.4-3.4-1.2-4.4-2.6-1 1.4-2.6 2.4-4.6 2.8Z"/><circle opacity=".75" cx="16.6" cy="8.6" r="3.6"/><path opacity=".75" d="M15.8 13.6c3.8-.4 6.8 2.2 6.8 7h-6.4c0-2.6-.8-4.8-2.2-6.4.6-.4 1.2-.6 1.8-.6Z"/><path opacity=".75" d="M20.4 4.8a2.2 2.2 0 1 1 1 4.2 2.2 2.2 0 0 1-1-4.2Z"/>`,
  rocket: `<path ${EO} d="M12 1.6c3.4 2.4 5 6 5 10.2v4.6H7v-4.6c0-4.2 1.6-7.8 5-10.2Z M12 6.8a2.2 2.2 0 1 0 0 4.4 2.2 2.2 0 0 0 0-4.4Z"/><path d="M7 11.8 3.4 15.6v3.6L7 16.4Z M17 11.8l3.6 3.8v3.6L17 16.4Z"/><path opacity=".7" d="M9.4 17.6h5.2L12 22.4Z"/>`,
  dino: `<path d="M15.4 2.6h4.2a2.6 2.6 0 0 1 2.6 2.6v.6a1.6 1.6 0 0 1-1.6 1.6h-2v5c0 3.4-2.2 5.8-5.2 6.4v2.6h-2.6v-2.4H8.4v2.4H5.8v-3c-1.4-.8-2.4-2-3-3.6L1 13.2l2.6-.6c.6-2.6 2.6-4.4 5.4-4.4h3.6V5.4a2.8 2.8 0 0 1 2.8-2.8Z"/><circle cx="17.4" cy="4.6" r=".9" fill="#fff"/><path opacity=".6" d="M6.6 6.2l1.4-2 1.4 2Z M10 6l1.2-1.8L12.4 6Z"/>`,
  invite: `<circle cx="9" cy="7.4" r="4.4"/><path d="M1.8 21c0-4.4 3.2-7.2 7.2-7.2s7.2 2.8 7.2 7.2Z"/><path d="M18.2 7.6h2v3h3v2h-3v3h-2v-3h-3v-2h3Z"/>`,
};

export function friendIcon(name, ui = null) {
  if (PATHS[name]) return `<svg class="sw-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">${PATHS[name]}</svg>`;
  if (ui && ['heart', 'star', 'sun', 'moon', 'music', 'dress', 'sparkle', 'home', 'check', 'back', 'close', 'emote', 'jump', 'plus', 'build'].includes(name)) return ui.icon(name);
  return lifeIcon(name);
}
