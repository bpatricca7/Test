// Colorful little pictures for the Dress-Up tabs and buttons (inline SVG, 48x48). Unlike the
// one-color UI icons these are illustrations: kids "read" the tab by its picture.

const INK = '#3A1F4D';
const O = `stroke="${INK}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"`;

const P = {
  skin: `<path ${O} fill="#FFF4E0" d="M24 6c11 0 19 7 19 16 0 6-4 8-8 8-3 0-5 2-4 5 1 4-2 7-7 7C13 42 5 34 5 23 5 13 13 6 24 6Z"/>
    <circle cx="15" cy="17" r="4" fill="#F6D2B8" ${O}/><circle cx="25" cy="13" r="4" fill="#C3845A" ${O}/><circle cx="34" cy="18" r="4" fill="#8C5535" ${O}/><circle cx="14" cy="29" r="4" fill="#E4AE86" ${O}/>`,
  hair: `<path ${O} fill="#8A5230" d="M8 40V21C8 11 15 5 24 5s16 6 16 16v19h-7V26H15v14Z"/>
    <rect x="14" y="15" width="20" height="19" rx="5" fill="#F6D2B8" ${O}/>
    <path ${O} fill="#8A5230" d="M12 20c3-7 8-10 16-9 5 1 8 4 9 8-6-1-12-3-15-7-2 4-6 7-10 8Z"/>
    <circle cx="20" cy="25" r="1.8" fill="${INK}"/><circle cx="28" cy="25" r="1.8" fill="${INK}"/><path d="M36 9l3-3 2 4-3 2Z" fill="#FF5FA2" ${O}/>`,
  face: `<circle cx="24" cy="24" r="17" fill="#F6D2B8" ${O}/>
    <ellipse cx="18" cy="22" rx="3.2" ry="4.2" fill="${INK}"/><ellipse cx="30" cy="22" rx="3.2" ry="4.2" fill="${INK}"/>
    <circle cx="19" cy="20.5" r="1.3" fill="#fff"/><circle cx="31" cy="20.5" r="1.3" fill="#fff"/>
    <ellipse cx="13.5" cy="29" rx="3.5" ry="2" fill="#FF8CC6"/><ellipse cx="34.5" cy="29" rx="3.5" ry="2" fill="#FF8CC6"/>
    <path d="M20 30q4 4 8 0" fill="none" ${O}/>`,
  tops: `<path ${O} fill="#FF8CC6" d="M17 7h14l10 7-4 8-5-3v22H16V19l-5 3-4-8Z"/><path ${O} fill="#fff" d="M24 30s-5-3-5-6a2.5 2.5 0 0 1 5-1 2.5 2.5 0 0 1 5 1c0 3-5 6-5 6Z"/>`,
  bottoms: `<path ${O} fill="#9C7BFF" d="M15 8h18l7 30c-5 3-27 3-32 0Z"/><path ${O} fill="#C3A6FF" d="M15 8h18v5H15Z"/><path d="M20 16l-3 20M28 16l3 20M24 16v21" stroke="#7B5BE0" stroke-width="2"/>`,
  dresses: `<path ${O} fill="#FF8CC6" d="M18 5h4l2 5 2-5h4l-1 10 12 25c-8 4-26 4-34 0l12-25Z"/><path ${O} fill="#FFD1E6" d="M17 17h14v4H17Z"/><circle cx="24" cy="19" r="2.5" fill="#FF5FA2" ${O}/>`,
  shoes: `<path ${O} fill="#6CC6FF" d="M6 20c0-4 3-7 7-7h6c2 5 7 9 16 10 5 1 8 3 8 7v3H6Z"/><path ${O} fill="#fff" d="M6 33h37v5H6Z"/><path d="M17 17l5 2M19 21l5 2" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/>`,
  hats: `<path ${O} fill="#FFD54A" d="M7 37 5 13l10 9 9-14 9 14 10-9-2 24Z"/><circle cx="24" cy="27" r="4" fill="#FF5FA2" ${O}/><circle cx="13" cy="29" r="2.5" fill="#7FD3FF" ${O}/><circle cx="35" cy="29" r="2.5" fill="#9BE58A" ${O}/>`,
  glasses: `<path ${O} fill="#FFB6D9" d="M13 32S4 26 4 20a5 5 0 0 1 9-3 5 5 0 0 1 9 3c0 6-9 12-9 12Z"/><path ${O} fill="#FFB6D9" d="M35 32s-9-6-9-12a5 5 0 0 1 9-3 5 5 0 0 1 9 3c0 6-9 12-9 12Z"/><path d="M21 19q3-3 6 0" fill="none" ${O}/><circle cx="10" cy="20" r="1.8" fill="#fff"/><circle cx="32" cy="20" r="1.8" fill="#fff"/>`,
  back: `<path ${O} fill="#7FD3FF" d="M23 22C17 8 9 5 5 8c-3 4 2 13 9 16-6 2-8 9-4 12 4 3 10-2 13-10Z"/><path ${O} fill="#FF8CC6" d="M25 22c6-14 14-17 18-14 3 4-2 13-9 16 6 2 8 9 4 12-4 3-10-2-13-10Z"/><rect x="22" y="15" width="4" height="20" rx="2" fill="${INK}"/>`,
  // a necklace with a heart next to a little tie
  neck: `<path d="M4 7c1 13 5 19 12 19S27 20 28 7" fill="none" stroke="#FFD54A" stroke-width="3.2" stroke-linecap="round"/><path d="M4 7c1 13 5 19 12 19S27 20 28 7" fill="none" stroke="${INK}" stroke-width="1" stroke-dasharray="1 4" stroke-linecap="round"/><path ${O} fill="#FF5FA2" d="M16 40s-7-4-7-9a3.5 3.5 0 0 1 7-2 3.5 3.5 0 0 1 7 2c0 5-7 9-7 9Z"/>
    <path ${O} fill="#4D7CFF" d="M35 6h7l-1.5 5h-4Z"/><path ${O} fill="#4D7CFF" d="M36.5 11h4l3 24-5 6-5-6Z"/><path d="M35.5 22l7-3M35 30l8-3" stroke="#B8E1FF" stroke-width="2"/>`,
  // the Studio's surprise style button: a bow (Girl), a cap (Boy), both (Mix)
  girl: `<path ${O} fill="#FF8CC6" d="M24 24 9 14c-4-2-6 1-6 4v12c0 3 2 6 6 4Z"/><path ${O} fill="#FF8CC6" d="M24 24l15-10c4-2 6 1 6 4v12c0 3-2 6-6 4Z"/><rect x="19" y="19" width="10" height="10" rx="3" fill="#FF5FA2" ${O}/>`,
  boy: `<path ${O} fill="#4D7CFF" d="M8 30c0-11 7-19 16-19s16 8 16 19Z"/><path ${O} fill="#3A63D9" d="M30 30h14c2 0 3 2 2 4l-1 2H30Z"/><path d="M24 11v19" stroke="#B8E1FF" stroke-width="2"/><circle cx="24" cy="11" r="2.6" fill="#FF6B6B" ${O}/><path d="M15 22l2 2 3-4" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"/>`,
  mix: `<path ${O} fill="#4D7CFF" d="M14 30c0-9 5-15 12-15s12 6 12 15Z"/><path ${O} fill="#3A63D9" d="M34 30h9c2 0 2 2 1 3l-1 2H34Z"/><circle cx="26" cy="15" r="2.2" fill="#FF6B6B" ${O}/>
    <path ${O} fill="#FF8CC6" d="M12 14 4 9c-2-1-3 0-3 2v6c0 2 1 3 3 2Z"/><path ${O} fill="#FF8CC6" d="M12 14l8-5c2-1 3 0 3 2v6c0 2-1 3-3 2Z"/><rect x="9.5" y="11.5" width="5" height="5" rx="1.5" fill="#FF5FA2" ${O}/>`,
  brows: `<path d="M6 20q8-8 16-2M26 18q8-6 16 2" fill="none" stroke="${INK}" stroke-width="5" stroke-linecap="round"/><ellipse cx="14" cy="31" rx="4" ry="5" fill="${INK}"/><ellipse cx="34" cy="31" rx="4" ry="5" fill="${INK}"/><circle cx="15.3" cy="29" r="1.5" fill="#fff"/><circle cx="35.3" cy="29" r="1.5" fill="#fff"/>`,
  number: `<path ${O} fill="#4D7CFF" d="M15 6h18l9 7-4 7-4-2v24H14V18l-4 2-4-7Z"/><path d="M19 22h4v14M27 22h5v6h-5v8h5" fill="none" stroke="#fff" stroke-width="2.6" stroke-linejoin="round"/>`,
  hand: `<path ${O} fill="#fff" d="m9 42 17-17 3 3-17 17Z"/><path ${O} fill="#FFD54A" d="M31 4l3 7 8 1-6 5 2 8-7-4-7 4 2-8-6-5 8-1Z"/><circle cx="41" cy="30" r="2" fill="#FF8CC6"/><circle cx="14" cy="10" r="1.6" fill="#9C7BFF"/>`,
  outfits: `<path ${O} fill="none" d="M24 13a4 4 0 1 1 4-4"/><path ${O} fill="#E6DDFF" d="M24 13 5 30c-2 2-1 5 2 5h34c3 0 4-3 2-5Z"/><path ${O} fill="#FF5FA2" d="M24 32s-6-4-6-8a3 3 0 0 1 6-1 3 3 0 0 1 6 1c0 4-6 8-6 8Z"/>`,
  turn: `<path d="M38 20A15 15 0 1 0 38 30" fill="none" stroke="currentColor" stroke-width="4.5" stroke-linecap="round"/><path d="M41 10v11H30Z" fill="currentColor"/>`,
  none: `<circle cx="24" cy="24" r="15" fill="none" stroke="#FF7EB6" stroke-width="5"/><path d="M13 35 35 13" stroke="#FF7EB6" stroke-width="5" stroke-linecap="round"/>`,
  rainbow: `<path d="M6 34a18 18 0 0 1 36 0" fill="none" stroke="#FF8A8A" stroke-width="4"/><path d="M10 34a14 14 0 0 1 28 0" fill="none" stroke="#FFE27A" stroke-width="4"/><path d="M14 34a10 10 0 0 1 20 0" fill="none" stroke="#9BE58A" stroke-width="4"/><path d="M18 34a6 6 0 0 1 12 0" fill="none" stroke="#7FD3FF" stroke-width="4"/>`,
};

// sea forms (merfolk): the Water tab, its Match swatch, and the three choices
P.sea = `<path ${O} fill="#8FD8FF" d="M3 34c4 0 4-4 8.5-4s4.5 4 8.5 4 4-4 8.5-4 4.5 4 8.5 4 4-4 8-4v14H3Z"/><path ${O} fill="#3FD8B0" d="M22 34l1.5-14h3L28 34Z"/><path ${O} fill="#3FD8B0" d="M25 21C21 13 15 9 7 10c2 6 9 11 18 11Zm0 0c4-8 10-12 18-11-2 6-9 11-18 11Z"/>`;
P.match = `<path ${O} fill="#FF8CC6" d="M9 9h8l5 4-2 4-3-2v13H8V15l-3 2-2-4Z"/><path ${O} fill="#FF8CC6" d="M33 41l1-16h3l1 16Z"/><path ${O} fill="#FF8CC6" d="M35.5 26c-3-6-7-9-13-8 2 5 7 8 13 8Zm0 0c3-6 7-9 12-8-1 5-6 8-12 8Z"/><path d="M22 30h7" stroke="${INK}" stroke-width="2.2" stroke-linecap="round" stroke-dasharray="2 3"/>`;
P.mermaid = `<circle cx="24" cy="11" r="7" fill="#F6D2B8" ${O}/><path ${O} fill="#A0592D" d="M16 12c0-6 4-9 8-9s8 3 8 9c-2-3-5-4-8-4s-6 1-8 4Z"/><path ${O} fill="#FF8CC6" d="M18 18h12l1 8H17Z"/><path ${O} fill="#3FD8B0" d="M17 26h14c0 8-3 12-6 15h-2c-3-3-6-7-6-15Z"/><path ${O} fill="#A5F0E6" d="M24 40c-4 1-8 4-10 7 4 0 8-1 10-4 2 3 6 4 10 4-2-3-6-6-10-7Z"/>`;
P.sea_dragon = `<circle cx="24" cy="11" r="7" fill="#F6D2B8" ${O}/><path ${O} fill="#3B2419" d="M17 10c1-5 4-7 7-7s6 2 7 7c-2-2-4-2-7-2s-5 0-7 2Z"/><circle cx="20" cy="4" r="2.2" fill="#FFD43B" ${O}/><circle cx="28" cy="4" r="2.2" fill="#FFD43B" ${O}/><path ${O} fill="#4D7CFF" d="M18 18h12l1 8H17Z"/><path ${O} fill="#2FB5B0" d="M17 26h14c0 8-3 12-6 15h-2c-3-3-6-7-6-15Z"/><circle cx="31.5" cy="30" r="2" fill="#FFD43B" ${O}/><circle cx="30" cy="36" r="1.6" fill="#FFD43B" ${O}/><path ${O} fill="#9BE8CF" d="M24 40c-5 0-9 3-10 7h20c-1-4-5-7-10-7Z"/>`;
P.me = `<circle cx="24" cy="11" r="7" fill="#F6D2B8" ${O}/><path ${O} fill="#A0592D" d="M16 12c0-6 4-9 8-9s8 3 8 9c-2-3-5-4-8-4s-6 1-8 4Z"/><path ${O} fill="#FFD43B" d="M17 18h14l1 12H16Z"/><path ${O} fill="#9C7BFF" d="M17 30h6v8h-6ZM25 30h6v8h-6Z"/><path ${O} fill="#F6D2B8" d="M18 38h4v4h-4ZM26 38h4v4h-4Z"/><path d="M3 44c4 0 4-3 8-3s4 3 8 3 4-3 8-3 4 3 8 3 4-3 8-3" fill="none" stroke="#6CC6FF" stroke-width="3" stroke-linecap="round"/>`;

// emote pictures (used while the 3D snapshots render, or if they cannot)
P.wave = `<path ${O} fill="#F6D2B8" d="M16 40V20a3 3 0 0 1 6 0v8-14a3 3 0 0 1 6 0v14-11a3 3 0 0 1 6 0v12-7a3 3 0 0 1 6 0v12c0 9-6 15-14 15s-16-6-16-9Z"/><path d="M8 12q-3 4 0 8M4 9q-4 7 0 14" fill="none" stroke="#FF5FA2" stroke-width="3" stroke-linecap="round"/>`;
P.dance = `<path ${O} fill="#9C7BFF" d="M20 38a5 5 0 1 1-2-4V10l18-4v24a5 5 0 1 1-2-4V13l-14 3Z"/>`;
P.twirl = `<path d="M24 6c10 0 17 8 17 17S34 38 24 38c-7 0-12-5-12-12s5-10 10-10 8 4 8 8-3 6-6 6" fill="none" stroke="#FF5FA2" stroke-width="4" stroke-linecap="round"/><circle cx="40" cy="8" r="3" fill="#FFD54A"/>`;
P.cartwheel = `<circle cx="24" cy="24" r="16" fill="none" stroke="#3FD8B0" stroke-width="4" stroke-dasharray="7 5"/><path ${O} fill="#FFD54A" d="M24 14l3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1Z"/>`;
P.jump = `<path ${O} fill="#FFD54A" d="M24 4l5 10 11 2-8 8 2 11-10-5-10 5 2-11-8-8 11-2Z"/><path d="M12 42h24" stroke="#6CC6FF" stroke-width="4" stroke-linecap="round"/>`;
P.heart = `<path ${O} fill="#FF5FA2" d="M24 42S6 31 6 18a9 9 0 0 1 18-4 9 9 0 0 1 18 4c0 13-18 24-18 24Z"/><circle cx="16" cy="17" r="3" fill="#fff" opacity=".8"/>`;
P.sit = `<path ${O} fill="#C3A6FF" d="M10 22h28v8H10Z"/><path ${O} fill="#9C7BFF" d="M12 30v12M36 30v12M10 22V8h6v14"/><circle cx="26" cy="12" r="5" fill="#F6D2B8" ${O}/>`;

export function picture(name, size = 48) {
  const body = P[name] || P.hats;
  return `<svg viewBox="0 0 48 48" width="${size}" height="${size}" aria-hidden="true" focusable="false">${body}</svg>`;
}
