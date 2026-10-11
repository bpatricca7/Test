// The 12 code pictures (docs/MULTIPLAYER.md §5.1, §11.2) and the 16 quick phrases (§11.6).
//
// A code is 4 pictures; the picture's word is also its code token (protocol CODE_WORDS), so
// the order and the words here must match protocol.js. Pictures are colorful 64x64 SVG
// "stickers" with a dark outline so they read on any button; pictureSvg() returns markup for
// innerHTML, pictureUrl() a data: URL for <img> and canvas drawing.
//
// Phrases travel as ids 0..15 only (presence `ph`); every page shows the text from its own
// table, so nothing typed ever reaches another player.

import { CODE_WORDS } from './protocol.js';

const INK = '#3A1F4D';
const O = `stroke="${INK}" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round"`;
const HI = 'fill="#fff" opacity=".75"';

/** Outer arc of circle 1 minus circle 2 (a crescent), as a path. */
function crescent(x1, y1, r1, x2, y2, r2) {
  const dx = x2 - x1, dy = y2 - y1, d = Math.hypot(dx, dy);
  const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, r1 * r1 - a * a));
  const mx = x1 + (a * dx) / d, my = y1 + (a * dy) / d;
  const p1 = [mx + (h * dy) / d, my - (h * dx) / d];
  const p2 = [mx - (h * dy) / d, my + (h * dx) / d];
  const f = (p) => `${p[0].toFixed(2)} ${p[1].toFixed(2)}`;
  return `M${f(p1)} A${r1} ${r1} 0 1 0 ${f(p2)} A${r2} ${r2} 0 0 1 ${f(p1)} Z`;
}

function starPoints(cx, cy, R, r, n = 5, rot = -Math.PI / 2) {
  const p = [];
  for (let i = 0; i < n * 2; i++) {
    const a = rot + (i / (n * 2)) * Math.PI * 2;
    const rad = i % 2 === 0 ? R : r;
    p.push(`${(cx + Math.cos(a) * rad).toFixed(2)},${(cy + Math.sin(a) * rad).toFixed(2)}`);
  }
  return p.join(' ');
}

function sunRays(cx, cy, r0, r1, n) {
  let s = '';
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const b = a + Math.PI / n / 1.6, c = a - Math.PI / n / 1.6;
    const pt = (ang, r) => `${(cx + Math.cos(ang) * r).toFixed(2)} ${(cy + Math.sin(ang) * r).toFixed(2)}`;
    s += `M${pt(b, r0)} L${pt(a, r1)} L${pt(c, r0)} Z `;
  }
  return s;
}

function petals(cx, cy, r, pr, n, fill) {
  let s = '';
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
    s += `<circle cx="${(cx + Math.cos(a) * r).toFixed(2)}" cy="${(cy + Math.sin(a) * r).toFixed(2)}" r="${pr}" fill="${fill}" ${O}/>`;
  }
  return s;
}

const face = (x, y, gap = 7, eye = 2.4) =>
  `<circle cx="${x - gap}" cy="${y}" r="${eye}" fill="${INK}"/><circle cx="${x + gap}" cy="${y}" r="${eye}" fill="${INK}"/>` +
  `<path d="M${x - 3.5} ${y + 5} q3.5 3.2 7 0" fill="none" stroke="${INK}" stroke-width="2.2" stroke-linecap="round"/>`;

const BODIES = {
  heart: `<path d="M32 55C18 46 7 36 7 23.5 7 15.5 13 10 20 10c5 0 9.3 2.8 12 7 2.7-4.2 7-7 12-7 7 0 13 5.5 13 13.5C57 36 46 46 32 55Z" fill="#FF5FA2" ${O}/>
    <ellipse cx="19" cy="21" rx="5" ry="3.4" transform="rotate(-35 19 21)" ${HI}/>`,
  star: `<polygon points="${starPoints(32, 34, 26, 11.5)}" fill="#FFC94D" ${O}/>
    <ellipse cx="25" cy="27" rx="3.6" ry="2.4" transform="rotate(-30 25 27)" ${HI}/>
    ${face(32, 35, 5.5, 2)}`,
  moon: `<path d="${crescent(30, 33, 23, 43, 24, 18.5)}" fill="#FFE38A" ${O}/>
    <polygon points="${starPoints(49, 45, 6.5, 2.8)}" fill="#9C7BFF" ${O} stroke-width="1.8"/>
    <polygon points="${starPoints(52, 12, 4.2, 1.8)}" fill="#FF8CC6" ${O} stroke-width="1.6"/>
    <circle cx="19" cy="38" r="2.2" fill="${INK}"/><path d="M14 44q4 3 8 0" fill="none" stroke="${INK}" stroke-width="2.2" stroke-linecap="round"/>`,
  sun: `<path d="${sunRays(32, 32, 17, 29, 10)}" fill="#FFA43B" ${O} stroke-width="2.2"/>
    <circle cx="32" cy="32" r="17" fill="#FFD23F" ${O}/>
    <circle cx="23.5" cy="36.5" r="2.6" fill="#FF9FC4"/><circle cx="40.5" cy="36.5" r="2.6" fill="#FF9FC4"/>
    ${face(32, 30, 6, 2.2)}`,
  flower: `<path d="M32 42v17" stroke="#2FB36B" stroke-width="5" stroke-linecap="round"/>
    <path d="M32 52c-7-1-11-6-11-6 6-2 10 1 11 6Z" fill="#3FD8B0" ${O} stroke-width="2"/>
    ${petals(32, 26, 12, 9, 5, '#FF8CC6')}
    <circle cx="32" cy="26" r="8" fill="#FFC94D" ${O}/>
    <circle cx="29" cy="23.5" r="2" ${HI}/>`,
  rainbow: `<path d="M6 46a26 26 0 0 1 52 0" fill="none" stroke="${INK}" stroke-width="22.5"/>
    <path d="M6 46a26 26 0 0 1 52 0" fill="none" stroke="#FF5A6E" stroke-width="5"/>
    <path d="M10.5 46a21.5 21.5 0 0 1 43 0" fill="none" stroke="#FFA43B" stroke-width="5"/>
    <path d="M15 46a17 17 0 0 1 34 0" fill="none" stroke="#FFD23F" stroke-width="5"/>
    <path d="M19.5 46a12.5 12.5 0 0 1 25 0" fill="none" stroke="#3FD8B0" stroke-width="5"/>
    <path d="M24 46a8 8 0 0 1 16 0" fill="none" stroke="#6CC6FF" stroke-width="4.6"/>
    <path d="M5 50c-3 0-4-6 1-7 0-5 7-6 9-2 4-1 7 3 5 6 0 2-2 3-4 3Z" fill="#fff" ${O}/>
    <path d="M44 50c-3 0-4-6 1-7 0-5 7-6 9-2 4-1 7 3 5 6 0 2-2 3-4 3Z" fill="#fff" ${O}/>`,
  cat: `<path d="M12 25 11 8l14 9ZM52 25l1-17-14 9Z" fill="#FFA43B" ${O}/>
    <path d="M14.5 19 14 12l6 4ZM49.5 19l.5-7-6 4Z" fill="#FFB8D6"/>
    <ellipse cx="32" cy="35" rx="22" ry="19" fill="#FFA43B" ${O}/>
    <path d="M28 18c1 3 1 6 0 8M36 18c-1 3-1 6 0 8" stroke="#E07F1A" stroke-width="2.4" stroke-linecap="round" fill="none"/>
    <circle cx="23.5" cy="34" r="3" fill="${INK}"/><circle cx="40.5" cy="34" r="3" fill="${INK}"/>
    <circle cx="24.5" cy="33" r="1" fill="#fff"/><circle cx="41.5" cy="33" r="1" fill="#fff"/>
    <path d="M29.5 39.5h5l-2.5 2.6Z" fill="#FF5FA2" stroke="#FF5FA2" stroke-width="1.5" stroke-linejoin="round"/>
    <path d="M32 42c-1 3-5 3-6 1M32 42c1 3 5 3 6 1" fill="none" stroke="${INK}" stroke-width="2" stroke-linecap="round"/>
    <path d="M6 37l10 1M6 43l10-2M58 37l-10 1M58 43l-10-2" stroke="${INK}" stroke-width="1.8" stroke-linecap="round"/>`,
  bunny: `<ellipse cx="23" cy="16" rx="6.5" ry="15" transform="rotate(-10 23 16)" fill="#fff" ${O}/>
    <ellipse cx="41" cy="16" rx="6.5" ry="15" transform="rotate(10 41 16)" fill="#fff" ${O}/>
    <ellipse cx="23" cy="17" rx="3" ry="10" transform="rotate(-10 23 17)" fill="#FFB8D6"/>
    <ellipse cx="41" cy="17" rx="3" ry="10" transform="rotate(10 41 17)" fill="#FFB8D6"/>
    <ellipse cx="32" cy="41" rx="20" ry="17" fill="#fff" ${O}/>
    <circle cx="24.5" cy="39" r="3" fill="${INK}"/><circle cx="39.5" cy="39" r="3" fill="${INK}"/>
    <circle cx="25.5" cy="38" r="1" fill="#fff"/><circle cx="40.5" cy="38" r="1" fill="#fff"/>
    <circle cx="19" cy="46" r="3" fill="#FFB8D6"/><circle cx="45" cy="46" r="3" fill="#FFB8D6"/>
    <path d="M29.5 44h5l-2.5 2.6Z" fill="#FF5FA2" stroke="#FF5FA2" stroke-width="1.5" stroke-linejoin="round"/>
    <path d="M32 47v2.5M32 49.5c-1.5 2-4 2-5 0M32 49.5c1.5 2 4 2 5 0" fill="none" stroke="${INK}" stroke-width="1.9" stroke-linecap="round"/>`,
  fish: `<path d="M44 32 60 20v24Z" fill="#3AAEF0" ${O}/>
    <path d="M6 32C12 18 24 13 34 14c8 .6 13 8 14 18-1 10-6 17.4-14 18C24 51 12 46 6 32Z" fill="#6CC6FF" ${O}/>
    <path d="M26 16c3 5 3 27 0 32" fill="none" stroke="#3AAEF0" stroke-width="2.6" stroke-linecap="round"/>
    <path d="M32 15c2 4 3 10 3 13" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" opacity=".7"/>
    <circle cx="16" cy="29" r="3.2" fill="${INK}"/><circle cx="17" cy="28" r="1.1" fill="#fff"/>
    <path d="M10 37q3 2 6 0" fill="none" stroke="${INK}" stroke-width="2" stroke-linecap="round"/>
    <circle cx="8" cy="12" r="3" fill="#E6F6FF" ${O} stroke-width="1.8"/><circle cx="15" cy="6" r="2" fill="#E6F6FF" ${O} stroke-width="1.6"/>`,
  cupcake: `<path d="M14 36h36l-5 22H19Z" fill="#9C7BFF" ${O}/>
    <path d="M22 36l2 22M32 36v22M42 36l-2 22" stroke="#C9B8FF" stroke-width="2.6"/>
    <path d="M11 37c-3-7 3-12 8-11 0-7 7-10 13-8 6-2 13 1 13 8 5-1 11 4 8 11Z" fill="#FF8CC6" ${O}/>
    <circle cx="32" cy="12" r="5.5" fill="#FF3B5C" ${O}/>
    <path d="M33 7c1-3 3-4 5-4" fill="none" stroke="${INK}" stroke-width="2.2" stroke-linecap="round"/>
    <rect x="20" y="27" width="4" height="2" rx="1" fill="#FFE38A" transform="rotate(30 22 28)"/>
    <rect x="37" y="24" width="4" height="2" rx="1" fill="#6CC6FF" transform="rotate(-25 39 25)"/>
    <rect x="28" y="30" width="4" height="2" rx="1" fill="#3FD8B0"/>
    <rect x="43" y="31" width="4" height="2" rx="1" fill="#fff" transform="rotate(20 45 32)"/>`,
  crown: `<path d="M8 48 6 18l13 12 13-18 13 18 13-12-2 30Z" fill="#FFC94D" ${O}/>
    <rect x="8" y="46" width="48" height="10" rx="3" fill="#FFB300" ${O}/>
    <circle cx="32" cy="36" r="4.5" fill="#FF5FA2" ${O} stroke-width="2"/>
    <circle cx="18" cy="39" r="3.4" fill="#6CC6FF" ${O} stroke-width="2"/>
    <circle cx="46" cy="39" r="3.4" fill="#3FD8B0" ${O} stroke-width="2"/>
    <circle cx="6" cy="17" r="3" fill="#FFC94D" ${O} stroke-width="2"/><circle cx="32" cy="11" r="3" fill="#FFC94D" ${O} stroke-width="2"/><circle cx="58" cy="17" r="3" fill="#FFC94D" ${O} stroke-width="2"/>`,
  gem: `<path d="M17 10h30l12 15-27 32L5 25Z" fill="#3FD8B0" ${O}/>
    <path d="M5 25h54M17 10l7 15 8-15 8 15 7-15M24 25l8 32 8-32" fill="none" stroke="${INK}" stroke-width="2" stroke-linejoin="round"/>
    <path d="M17 10l7 15H5Z" fill="#7FF0D2"/><path d="M32 10l-8 15h16Z" fill="#A8F7E3"/>
    <path d="M24 25l8 32L5 25Z" fill="#2BBF97"/>
    <path d="M17 10h30l12 15-27 32L5 25Z" fill="none" ${O}/>
    <path d="M12 21l4-6" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/>`,
};

const NAMES = {
  heart: 'Heart', star: 'Star', moon: 'Moon', sun: 'Sun', flower: 'Flower', rainbow: 'Rainbow',
  cat: 'Cat', bunny: 'Bunny', fish: 'Fish', cupcake: 'Cupcake', crown: 'Crown', gem: 'Gem',
};

/** Soft background color of each picture's key on the keypad. */
const TINTS = {
  heart: '#FFE3EF', star: '#FFF4CC', moon: '#EFE9FF', sun: '#FFEBD1', flower: '#FFE8F3', rainbow: '#E6F6FF',
  cat: '#FFEEDB', bunny: '#FFF0F6', fish: '#E3F4FF', cupcake: '#F1ECFF', crown: '#FFF6D6', gem: '#DDFBF2',
};

/** The 12 pictures in keypad order (the protocol's order). */
export const CODE_PICTURES = Object.freeze(CODE_WORDS.map((word) => Object.freeze({ word, name: NAMES[word] || word, tint: TINTS[word] || '#fff' })));

/** SVG markup of one code picture. */
export function pictureSvg(word, { size = null, cls = '' } = {}) {
  const body = BODIES[word] || BODIES.star;
  const dim = size ? ` width="${size}" height="${size}"` : '';
  return `<svg class="sw-pic ${cls}" viewBox="0 0 64 64"${dim} aria-hidden="true" focusable="false">${body}</svg>`;
}

const urlCache = new Map();
/** data: URL of one code picture (for <img> and canvas). */
export function pictureUrl(word) {
  let u = urlCache.get(word);
  if (!u) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="128" height="128">${BODIES[word] || BODIES.star}</svg>`;
    u = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    urlCache.set(word, u);
  }
  return u;
}

/** "Heart" for 'heart'. */
export function pictureName(word) {
  return NAMES[word] || String(word || '');
}

/** "Heart, Star, Moon and Cat" (read aloud and shown to grown-ups). */
export function codeWords(code) {
  const names = (code || []).map(pictureName);
  if (names.length < 2) return names.join('');
  return names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
}

// ---------------------------------------------------------------------------------------
// quick phrases (ids 0..15; presence `ph` carries only the id)
// ---------------------------------------------------------------------------------------

const S = `fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"`;
const PHRASE_ICONS = {
  hi: `<circle cx="12" cy="12" r="9.5" fill="currentColor"/><circle cx="8.8" cy="10" r="1.4" fill="#fff"/><circle cx="15.2" cy="10" r="1.4" fill="#fff"/><path d="M8 14q4 4 8 0" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"/>`,
  here: `<path d="M12 22s-7-6.6-7-12a7 7 0 0 1 14 0c0 5.4-7 12-7 12Z" fill="currentColor"/><circle cx="12" cy="10" r="2.6" fill="#fff"/>`,
  look: `<path d="M1.8 12S5.8 5 12 5s10.2 7 10.2 7-4 7-10.2 7S1.8 12 1.8 12Z" fill="currentColor"/><circle cx="12" cy="12" r="4" fill="#fff"/><circle cx="12" cy="12" r="2" fill="currentColor"/>`,
  follow: `<ellipse cx="7.5" cy="15" rx="3" ry="4.4" fill="currentColor"/><ellipse cx="16.5" cy="8" rx="3" ry="4.4" fill="currentColor"/><circle cx="7.5" cy="21" r="1.6" fill="currentColor"/><circle cx="16.5" cy="14" r="1.6" fill="currentColor"/>`,
  build: `<path d="M12 2.6 20.4 7.2 12 11.8 3.6 7.2Z" fill="currentColor"/><path opacity=".78" d="M3.4 8.7 11.2 13v8.6L3.4 17.3Z" fill="currentColor"/><path opacity=".55" d="M12.8 13l7.8-4.3v8.6l-7.8 4.3Z" fill="currentColor"/>`,
  wow: `<path d="M12 1.5l2.6 6.3 6.8.6-5.2 4.4 1.6 6.6L12 16l-5.8 3.4 1.6-6.6-5.2-4.4 6.8-.6Z" fill="currentColor"/><path d="M3 3l2 2M21 3l-2 2" ${S} stroke-width="2"/>`,
  pretty: `<path d="M12 1.8c.6 4.8 2.6 7.4 8 8.2-5.4.8-7.4 3.4-8 8.2-.6-4.8-2.6-7.4-8-8.2 5.4-.8 7.4-3.4 8-8.2Z" fill="currentColor"/><path d="M19 15.2c.3 2.2 1.2 3.2 3.2 3.5-2 .3-2.9 1.3-3.2 3.5-.3-2.2-1.2-3.2-3.2-3.5 2-.3 2.9-1.3 3.2-3.5Z" fill="currentColor" opacity=".7"/>`,
  thanks: `<path d="M12 21.2S3.2 15.6 3.2 9.4A4.8 4.8 0 0 1 12 6.6a4.8 4.8 0 0 1 8.8 2.8c0 6.2-8.8 11.8-8.8 11.8Z" fill="currentColor"/>`,
  help: `<circle cx="12" cy="12" r="9.5" fill="currentColor"/><path d="M9 9.2a3 3 0 1 1 4.3 2.7c-.9.5-1.3 1.1-1.3 2.1" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/><circle cx="12" cy="17.2" r="1.4" fill="#fff"/>`,
  dance: `<path d="M9.2 17.6A3.1 3.1 0 1 1 7.2 14.7V5.2L19 2.8v12.4a3.1 3.1 0 1 1-2-2.9V6.4l-7.8 1.6Z" fill="currentColor"/>`,
  race: `<path d="M5 22V3" ${S}/><path d="M5 3.5h14l-3 4.2 3 4.3H5Z" fill="currentColor"/><path d="M8.5 3.5v8.5M12 3.5v8.5M15.5 3.5v8.5" stroke="#fff" stroke-width="1.6" opacity=".8"/>`,
  yes: `<circle cx="12" cy="12" r="9.5" fill="currentColor"/><path d="m7.5 12.4 3 3 6-6.6" fill="none" stroke="#fff" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/>`,
  no: `<circle cx="12" cy="12" r="9.5" fill="currentColor"/><path d="M8.5 12h7" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round"/>`,
  oops: `<circle cx="12" cy="12" r="9.5" fill="currentColor"/><circle cx="8.8" cy="9.6" r="1.4" fill="#fff"/><circle cx="15.2" cy="9.6" r="1.4" fill="#fff"/><ellipse cx="12" cy="15.4" rx="2.2" ry="2.6" fill="#fff"/>`,
  night: `<path d="M20.6 14.6A8.8 8.8 0 1 1 9.4 3.4a7.1 7.1 0 0 0 11.2 11.2Z" fill="currentColor"/><circle cx="17" cy="5" r="1.1" fill="currentColor"/><circle cx="20.5" cy="8.6" r=".8" fill="currentColor"/>`,
  bye: `<rect x="6" y="4.2" width="2.9" height="10" rx="1.45" fill="currentColor"/><rect x="9.2" y="2.4" width="2.9" height="11" rx="1.45" fill="currentColor"/><rect x="12.4" y="3" width="2.9" height="11" rx="1.45" fill="currentColor"/><rect x="15.6" y="5.2" width="2.9" height="9" rx="1.45" fill="currentColor"/><path d="M6 11h12.5v4.2a6.3 6.3 0 0 1-6.3 6.3h-.4A5.8 5.8 0 0 1 6 15.7Z" fill="currentColor"/><path d="M20.5 3.5c1 1 1.5 2.2 1.5 3.5M2 3.5C1 4.5.5 5.7.5 7" ${S} stroke-width="1.8"/>`,
};

/** The 16 quick phrases (id = index). */
export const PHRASES = Object.freeze([
  { text: 'Hi!', icon: 'hi', color: '#FF5FA2' },
  { text: 'Come here!', icon: 'here', color: '#FF7A7A' },
  { text: 'Look!', icon: 'look', color: '#3AAEF0' },
  { text: 'Follow me!', icon: 'follow', color: '#9C7BFF' },
  { text: "Let's build!", icon: 'build', color: '#FF8C42' },
  { text: 'Wow!', icon: 'wow', color: '#F5A300' },
  { text: 'So pretty!', icon: 'pretty', color: '#E76BD8' },
  { text: 'Thank you!', icon: 'thanks', color: '#FF5FA2' },
  { text: 'Help please!', icon: 'help', color: '#3AAEF0' },
  { text: "Let's dance!", icon: 'dance', color: '#9C7BFF' },
  { text: 'Race you!', icon: 'race', color: '#22BF95' },
  { text: 'Yes!', icon: 'yes', color: '#22BF95' },
  { text: 'No thanks', icon: 'no', color: '#8E86A6' },
  { text: 'Oops!', icon: 'oops', color: '#FF8C42' },
  { text: 'Good night!', icon: 'night', color: '#7B68D9' },
  { text: 'Bye!', icon: 'bye', color: '#FF5FA2' },
].map((p, id) => Object.freeze({ id, ...p })));

/** SVG markup of a phrase's little icon (drawn in currentColor). */
export function phraseIcon(id, { size = null } = {}) {
  const p = PHRASES[id];
  const body = PHRASE_ICONS[p ? p.icon : 'hi'];
  const dim = size ? ` width="${size}" height="${size}"` : '';
  return `<svg class="sw-icon" viewBox="0 0 24 24"${dim} aria-hidden="true" focusable="false">${body}</svg>`;
}

/** The text of phrase `id`, or '' for an id outside 0..15. */
export function phraseText(id) {
  return Number.isInteger(id) && PHRASES[id] ? PHRASES[id].text : '';
}
