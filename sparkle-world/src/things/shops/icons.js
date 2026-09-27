// Little SVG pictures for the shops: 24x24 currentColor icons for buttons, plus full-color
// flavor scoops and topping pictures for the ice cream builder, and the daily gift box.

const EO = 'fill-rule="evenodd" clip-rule="evenodd"';

const PATHS = {
  coin: `<path ${EO} d="M12 2.5a9.5 9.5 0 1 0 0 19 9.5 9.5 0 1 0 0-19Z M12 5.4a6.6 6.6 0 1 0 0 13.2 6.6 6.6 0 1 0 0-13.2Z"/><path d="M12 7.6l1.3 2.8 3 .3-2.3 2 .7 3-2.7-1.6-2.7 1.6.7-3-2.3-2 3-.3Z"/>`,
  candy: `<path d="M8.2 8.2a5.4 5.4 0 1 1 7.6 7.6 5.4 5.4 0 0 1-7.6-7.6Z"/><path d="M8.6 7.8 3 5.2 4.4 9.6 2.2 12l5 .4ZM15.4 16.2l5.6 2.6-1.4-4.4 2.2-2.4-5-.4Z"/><path fill="#fff" opacity=".5" d="M10.2 9.4a2.8 2.8 0 0 1 3.6-.4c.5.3.1 1.1-.4.8a1.8 1.8 0 0 0-2.4.3c-.4.4-1.1-.2-.8-.7Z"/>`,
  cone: `<path d="M7 11.2h10L12.8 22a.9.9 0 0 1-1.6 0Z"/><path d="M6.2 11.4a3.4 3.4 0 0 1 1-5.8 5 5 0 0 1 9.6 0 3.4 3.4 0 0 1 1 5.8Z"/><circle cx="12" cy="2.6" r="1.9"/>`,
  truck: `<path ${EO} d="M2 7.6A1.6 1.6 0 0 1 3.6 6h11.2A1.6 1.6 0 0 1 16.4 7.6V9h2.4a1.6 1.6 0 0 1 1.3.7l1.6 2.4c.2.3.3.6.3.9v3.4a1.6 1.6 0 0 1-1.6 1.6h-1a2.6 2.6 0 0 1-5.2 0H9.4a2.6 2.6 0 0 1-5.2 0H3.6A1.6 1.6 0 0 1 2 16.4Z M4.4 8.4v4.2h9.8V8.4Z M16.6 11v2.2h3.2l-1.4-2.2Z"/><circle cx="6.8" cy="18" r="1.4"/><circle cx="16.8" cy="18" r="1.4"/>`,
  gift: `<path d="M3 9.4h18v3.4H3Z M4.4 13.8h6.6v7.6H5.6a1.2 1.2 0 0 1-1.2-1.2Z M13 13.8h6.6v6.4a1.2 1.2 0 0 1-1.2 1.2H13Z"/><path d="M11.2 8.6C8.4 8.8 6 8 6 5.8c0-2.6 3.8-2.4 5.2 1.4ZM12.8 8.6c2.8.2 5.2-.6 5.2-2.8 0-2.6-3.8-2.4-5.2 1.4Z"/>`,
  hold: `<path d="M8.4 9.6h7.2L12.8 17a.9.9 0 0 1-1.6 0Z"/><path d="M7.8 9.8a2.6 2.6 0 0 1 .7-4.4 3.6 3.6 0 0 1 7 0 2.6 2.6 0 0 1 .7 4.4Z"/><path d="M6 15.2c1.6-.8 3.6-1 5 0h2c1.4-1 3.4-.8 5 0l.6 3.4c.3 1.6-.8 3-2.4 3H7.8c-1.6 0-2.7-1.4-2.4-3Z"/>`,
  away: `<path ${EO} d="M3 9.6h18l-2 10a2 2 0 0 1-2 1.6H7a2 2 0 0 1-2-1.6Z M8 12.2h1.8v6.4H8Z M11.1 12.2h1.8v6.4h-1.8Z M14.2 12.2H16v6.4h-1.8Z"/><path fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" d="M7 9.4 10 3.8M17 9.4 14 3.8"/>`,
  bite: `<path d="M12 21.2S3.2 15.6 3.2 9.4A4.8 4.8 0 0 1 12 6.6a4.8 4.8 0 0 1 8.8 2.8c0 6.2-8.8 11.8-8.8 11.8Z"/><path fill="#fff" opacity=".5" d="M7.4 9.2a2 2 0 0 1 2-2c.6 0 .6.9 0 1a1.2 1.2 0 0 0-1 1c-.1.6-1 .6-1 0Z"/>`,
  shop: `<path d="M3 4h18l1 5.4a2.6 2.6 0 0 1-5 .8 2.6 2.6 0 0 1-5 0 2.6 2.6 0 0 1-5 0 2.6 2.6 0 0 1-5-.8Z"/><path ${EO} d="M4 12.8a4 4 0 0 0 4 .4 4 4 0 0 0 4 0 4 4 0 0 0 4 0 4 4 0 0 0 4-.4V20a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1Z M9.6 15.4v5.6h4.8v-5.6Z"/>`,
  star: `<path d="M12 2.2l2.9 6 6.6.8-4.9 4.6 1.3 6.6L12 17l-5.9 3.2 1.3-6.6L2.5 9l6.6-.8Z"/>`,
  build: `<path d="M5.2 3.4h13.6l-1.6 5H6.8Z"/><path d="M6.4 10h11.2l-1 11.2H7.4Z"/><path fill="#fff" opacity=".5" d="M9 12.2h1.8l.4 7H9.4Z"/>`,
  ok: `<path fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round" d="m4.6 12.6 4.6 4.6 10.2-10.4"/>`,
  back: `<path fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round" d="M14.8 5.2 8 12l6.8 6.8"/>`,
  x: `<path fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>`,
};

export function shopIcon(name) {
  return `<svg class="sw-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">${PATHS[name] || PATHS.star}</svg>`;
}

/** ui.button with one of our icons. */
export function shopButton(ui, { icon, label, onClick, variant = 'pink', size = null, className = '', title = null }) {
  const b = ui.button({ label, onClick, variant, size, className, title });
  if (icon) b.insertAdjacentHTML('afterbegin', shopIcon(icon));
  return b;
}

/** A full-color scoop of a flavor (for the flavor buttons and the scoop slots). */
export function scoopSvg(f, size = 48) {
  const bits = [];
  const spots = [[16, 20], [28, 16], [33, 25], [21, 27], [12, 26], [26, 22], [30, 12], [18, 13], [36, 19], [23, 18], [14, 17], [31, 29]];
  for (let i = 0; i < Math.min(f.nbits, spots.length); i++) {
    const [x, y] = spots[i];
    const c = f.bits[i % f.bits.length];
    bits.push(f.swirl ? `<ellipse cx="${x}" cy="${y}" rx="4" ry="2.4" fill="${c}"/>` : `<rect x="${x - 1.6}" y="${y - 1.6}" width="3.2" height="3.2" rx="0.8" fill="${c}" transform="rotate(${i * 37} ${x} ${y})"/>`);
  }
  return `<svg viewBox="0 0 48 48" width="${size}" height="${size}" aria-hidden="true">
    <ellipse cx="24" cy="42" rx="14" ry="3.2" fill="rgba(58,31,77,.12)"/>
    <path d="M7 30c0-10 7.6-18 17-18s17 8 17 18c0 2-1.6 3-3 2.2-1 2.6-4 2.8-5.2.8-1.4 2.6-4.8 2.6-6 0-1.4 2.6-4.8 2.6-6 0-1.2 2-4.2 1.8-5.2-.8C8.6 33 7 32 7 30Z" fill="${f.color}" stroke="rgba(58,31,77,.18)" stroke-width="1.4"/>
    <path d="M14 30c-1 3 0 6 2 7.6h16c2-1.6 3-4.6 2-7.6Z" fill="${f.light}" opacity=".0"/>
    <ellipse cx="17" cy="19" rx="5" ry="3" fill="#fff" opacity=".55" transform="rotate(-24 17 19)"/>
    ${bits.join('')}
  </svg>`;
}

/** Topping pictures (full color). */
export function toppingSvg(id, size = 48) {
  const s = (body) => `<svg viewBox="0 0 48 48" width="${size}" height="${size}" aria-hidden="true">${body}</svg>`;
  switch (id) {
    case 's': {
      const cols = ['#FF5FA2', '#FFC94D', '#3FD8B0', '#6CC6FF', '#9C7BFF', '#FF9F43'];
      const r = [[10, 14, 30], [22, 10, -20], [34, 14, 60], [14, 26, -50], [27, 23, 15], [38, 28, -35], [11, 37, 40], [24, 36, -10], [35, 39, 70], [19, 18, 80]];
      return s(r.map(([x, y, a], i) => `<rect x="${x - 5}" y="${y - 2}" width="10" height="4" rx="2" fill="${cols[i % 6]}" transform="rotate(${a} ${x} ${y})"/>`).join(''));
    }
    case 'c':
      return s(`<path d="M26 22c2-8 6-13 12-15" fill="none" stroke="#4FA557" stroke-width="3" stroke-linecap="round"/><path d="M33 9c4-3 8-2 9 0-3 3-6 3-9 0Z" fill="#6BD968"/><circle cx="23" cy="31" r="11" fill="#E8203F"/><circle cx="19" cy="27" r="3.4" fill="#fff" opacity=".7"/>`);
    case 'w':
      return s(`<path d="M8 36c-4 0-4-7 1-7-2-6 5-9 8-5 0-7 10-8 11-1 4-3 10 1 7 6 5 0 5 7 1 7Z" fill="#fff" stroke="#E6DDFF" stroke-width="2"/><path d="M18 18c1-6 7-8 10-4 3-3 7 1 4 4" fill="#fff" stroke="#E6DDFF" stroke-width="2"/><path d="M21 12c1-3 5-4 6-1" fill="none" stroke="#E6DDFF" stroke-width="2" stroke-linecap="round"/>`);
    case 'h':
      return s(`<path d="M6 12h36v6c0 2-2 3-3 1v10c0 3-4 3-4 0V19c-1 2-3 2-3 0v5c0 3-4 3-4 0v-6c-1 2-3 2-3 0v14c0 3-4 3-4 0V18c-1 2-3 2-3 0v4c0 3-4 3-4 0v-4c-1 2-3 2-3-1Z" fill="#5A3220"/><rect x="9" y="13" width="14" height="2.4" rx="1.2" fill="#fff" opacity=".35"/>`);
    case 'g': {
      const bear = (x, y, c) => `<g fill="${c}"><circle cx="${x - 4.5}" cy="${y - 9}" r="3"/><circle cx="${x + 4.5}" cy="${y - 9}" r="3"/><circle cx="${x}" cy="${y - 5}" r="6"/><ellipse cx="${x}" cy="${y + 5}" rx="6.4" ry="7.4"/><circle cx="${x - 6}" cy="${y + 1}" r="2.6"/><circle cx="${x + 6}" cy="${y + 1}" r="2.6"/><circle cx="${x - 3.6}" cy="${y + 11}" r="2.8"/><circle cx="${x + 3.6}" cy="${y + 11}" r="2.8"/></g>`;
      return s(bear(15, 22, '#FF5A7A') + bear(33, 26, '#6BD968'));
    }
    default:
      return s('');
  }
}

/** The daily gift: a pink polka-dot present with a lavender ribbon (lid is its own group). */
export function giftSvg() {
  return `<svg viewBox="0 0 120 120" aria-hidden="true">
    <ellipse cx="60" cy="110" rx="40" ry="6" fill="rgba(58,31,77,.18)"/>
    <g class="sh-gift-body">
      <rect x="18" y="52" width="84" height="56" rx="8" fill="#FF8CC6" stroke="#fff" stroke-width="4"/>
      <g fill="#fff" opacity=".85"><circle cx="32" cy="66" r="4"/><circle cx="84" cy="70" r="4"/><circle cx="40" cy="92" r="4"/><circle cx="90" cy="96" r="4"/><circle cx="72" cy="88" r="3"/><circle cx="30" cy="100" r="3"/></g>
      <rect x="52" y="52" width="16" height="56" fill="#B69CFF"/>
      <rect x="55" y="52" width="4" height="56" fill="#fff" opacity=".35"/>
    </g>
    <g class="sh-gift-lid">
      <rect x="12" y="38" width="96" height="18" rx="6" fill="#FF6FB0" stroke="#fff" stroke-width="4"/>
      <rect x="52" y="38" width="16" height="18" fill="#9C7BFF"/>
      <path d="M58 38c-10-16-30-18-30-6 0 8 16 8 30 6Z" fill="#B69CFF" stroke="#fff" stroke-width="3"/>
      <path d="M62 38c10-16 30-18 30-6 0 8-16 8-30 6Z" fill="#B69CFF" stroke="#fff" stroke-width="3"/>
      <circle cx="60" cy="37" r="7" fill="#9C7BFF" stroke="#fff" stroke-width="3"/>
    </g>
  </svg>`;
}
