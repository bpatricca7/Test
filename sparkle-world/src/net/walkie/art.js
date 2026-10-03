// Walkie-talkie pictures (inline SVG, drawn for a 7-year-old: a round pink walkie with a
// heart button, a lilac antenna with a sunny ball on top).

const INK = '#3A1F4D';

/** The full-color walkie-talkie. opts: { body, off } (off = grey with a sleepy face). */
export function walkieSvg({ body = '#FF5FA2', off = false } = {}) {
  const b = off ? '#C9C0D8' : body;
  const grille = off ? '#EDE8F4' : '#FFE3F0';
  const ant = off ? '#B3A8C8' : '#9C7BFF';
  const ball = off ? '#DDD5E8' : '#FFC94D';
  const heart = off ? '#F7F4FA' : '#FFFFFF';
  const slot = off ? '#B3A8C8' : '#FF7FB6';
  return `<svg class="sw-wk-art" viewBox="0 0 64 64" aria-hidden="true">
<rect x="39.5" y="5" width="7" height="19" rx="3.5" fill="${ant}" stroke="${INK}" stroke-width="2.6"/>
<circle cx="43" cy="6.5" r="5" fill="${ball}" stroke="${INK}" stroke-width="2.6"/>
<rect x="8.5" y="30" width="7" height="13" rx="3.5" fill="${ball}" stroke="${INK}" stroke-width="2.6"/>
<rect x="13" y="17" width="38" height="43" rx="12" fill="${b}" stroke="${INK}" stroke-width="3"/>
<path d="M19 26.5c0-3 1.6-4.4 4.6-4.4h5.4" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".75"/>
<rect x="19.5" y="27.5" width="25" height="13" rx="5.5" fill="${grille}" stroke="${INK}" stroke-width="2.4"/>
<path d="M24.5 32.2h15M24.5 36h15" stroke="${slot}" stroke-width="2.6" stroke-linecap="round"/>
<path d="M32 56.2l-6.3-6.1c-2.5-2.5-1.8-6.2 1.4-6.7 2-.3 3.9.8 4.9 2.5 1-1.7 2.9-2.8 4.9-2.5 3.2.5 3.9 4.2 1.4 6.7Z" fill="${heart}" stroke="${INK}" stroke-width="2.4" stroke-linejoin="round"/>
${off ? `<path d="M9 58L55 12" stroke="${INK}" stroke-width="4" stroke-linecap="round"/><path d="M9 58L55 12" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/>` : ''}
</svg>`;
}

/** Little sound waves (three arcs) for "talking". */
export const WAVES_SVG = `<svg class="sw-wk-wave" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 9.5a3.6 3.6 0 0 1 0 5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/><path d="M9.5 6.5a8 8 0 0 1 0 11" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/><path d="M14 3.5a12.4 12.4 0 0 1 0 17" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>`;

/** A sleepy moon with "z" (the walkies are resting). */
export const REST_SVG = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17.5 14.8A7.4 7.4 0 1 1 9.2 4.5a6 6 0 0 0 8.3 10.3Z" fill="currentColor"/><path d="M15 3.5h4l-4 4h4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
