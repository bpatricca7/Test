// The gifts' drawings: the three stickers' art (100 x 100 canvas, the vehicles' style) and the
// small SVG icons of the Workshop panel and the life HUD (24 x 24, currentColor unless colored).

const EO = 'fill-rule="evenodd" clip-rule="evenodd"';
const svg = (body, cls = 'sw-icon', vb = '0 0 24 24') => `<svg class="${cls}" viewBox="${vb}" fill="currentColor" aria-hidden="true" focusable="false">${body}</svg>`;

/** A wrapped present with a bow (24 x 24 path). */
const PRESENT = `<path ${EO} d="M3.6 10.2h16.8v10.4a1.6 1.6 0 0 1-1.6 1.6H5.2a1.6 1.6 0 0 1-1.6-1.6Z M10.8 10.2v12h2.4v-12Z"/><path d="M2.6 6.8h18.8v3.4H2.6Z"/><path d="M12 6.6C10.4 3 6.6 2.4 6.4 4.6c-.2 1.8 3 2.2 5.6 2Zm0 0c1.6-3.6 5.4-4.2 5.6-2 .2 1.8-3 2.2-5.6 2Z"/>`;

export const ICONS = {
  // the HUD: Give (a present held out with a heart over it)
  give: svg(`<path ${EO} d="M4.6 12.4h12.8v8a1.4 1.4 0 0 1-1.4 1.4H6a1.4 1.4 0 0 1-1.4-1.4Z M9.9 12.4v9.4h2.2v-9.4Z"/><path d="M3.8 9.6h14.4v2.8H3.8Z"/><path d="M11 9.4C9.6 6.6 6.6 6.2 6.4 8c-.2 1.4 2.4 1.7 4.6 1.4Zm0 0c1.4-2.8 4.4-3.2 4.6-1.4.2 1.4-2.4 1.7-4.6 1.4Z"/><path d="M19.6 1.6c.9-1 2.6-.6 2.8.8.2 1.2-.8 2.2-2.8 3.6-2-1.4-3-2.4-2.8-3.6.2-1.4 1.9-1.8 2.8-.8Z"/>`),
  // Put down: a present over a little floor with an arrow down
  down: svg(`<path ${EO} d="M6 9.6h12v7.8a1.2 1.2 0 0 1-1.2 1.2H7.2A1.2 1.2 0 0 1 6 17.4Z M11 9.6v9h2v-9Z"/><path d="M5.2 7h13.6v2.6H5.2Z"/><path d="M12 6.8c-1.2-2.6-4-3-4.2-1.4-.2 1.3 2.2 1.6 4.2 1.4Zm0 0c1.2-2.6 4-3 4.2-1.4.2 1.3-2.2 1.6-4.2 1.4Z"/><rect x="2" y="20.4" width="20" height="2.2" rx="1.1"/><path d="M20.2 2.4v4.4h1.8l-2.8 3.4-2.8-3.4h1.8V2.4Z"/>`),
  // Put away: a present going onto a shelf
  away: svg(`<path ${EO} d="M7 4.6h10v7a1.2 1.2 0 0 1-1.2 1.2H8.2A1.2 1.2 0 0 1 7 11.6Z M11 4.6v8.2h2V4.6Z"/><path d="M6.2 2.4h11.6v2.2H6.2Z"/><path d="M2.5 14.4h19v2.6h-19Z M3.4 17h2.4v4.6H3.4Z M18.2 17h2.4v4.6h-2.4Z"/>`),
  present: svg(PRESENT),
  // the four steps
  toy: svg(`<circle cx="12" cy="13.2" r="6.4"/><circle cx="6.2" cy="6.8" r="2.8"/><circle cx="17.8" cy="6.8" r="2.8"/><circle fill="#fff" cx="9.6" cy="12" r="1.2"/><circle fill="#fff" cx="14.4" cy="12" r="1.2"/><ellipse fill="#fff" opacity=".8" cx="12" cy="15.6" rx="2.4" ry="1.6"/>`),
  box: svg(`<path d="M12 2.6 21 7v10.4L12 21.8 3 17.4V7Z" opacity=".55"/><path d="M12 11.4 21 7v10.4L12 21.8Z"/><path d="M12 11.4 3 7l9-4.4L21 7Z" opacity=".8"/>`),
  paper: svg(`<path ${EO} d="M4 3h13.4a2.6 2.6 0 0 1 2.6 2.6V18H6.6A2.6 2.6 0 0 1 4 15.4Z M7 6.2l1 2 2 .3-1.5 1.4.4 2-1.9-1-1.9 1 .4-2L4 8.5l2-.3Z M14.6 9.4a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2Z M9.8 13.4a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4Z"/><path d="M20 18a3 3 0 0 1-3 3H6.6a2.6 2.6 0 0 1 0-5.2H20Z" opacity=".6"/>`),
  ribbon: svg(`<path d="M12 10.6C9.6 4.6 3 3.4 2.6 7.2c-.3 3.2 5.6 3.8 9.4 3.4Zm0 0c2.4-6 9-7.2 9.4-3.4.3 3.2-5.6 3.8-9.4 3.4Z"/><path d="M10.4 10.4 5.6 21l3-1 1.8 2.6 2.8-9.8Z M13.6 10.4 18.4 21l-3-1-1.8 2.6-2.8-9.8Z" opacity=".8"/><circle cx="12" cy="10.4" r="2.2"/>`),
  dice: svg(`<path ${EO} d="M5.4 2.8h13.2a2.6 2.6 0 0 1 2.6 2.6v13.2a2.6 2.6 0 0 1-2.6 2.6H5.4a2.6 2.6 0 0 1-2.6-2.6V5.4a2.6 2.6 0 0 1 2.6-2.6Z M8 6.4a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2Z M16 6.4a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2Z M12 10.4a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2Z M8 14.4a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2Z M16 14.4a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2Z"/>`),
  tag: svg(`<path ${EO} d="M3 5.4A2.4 2.4 0 0 1 5.4 3h7.2l8.6 8.6a2 2 0 0 1 0 2.8l-6.8 6.8a2 2 0 0 1-2.8 0L3 12.6Z M7.6 6a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2Z"/><path fill="#fff" d="M13.4 11.8c.6-.7 1.8-.4 1.9.5.1.8-.5 1.4-1.9 2.4-1.4-1-2-1.6-1.9-2.4.1-.9 1.3-1.2 1.9-.5Z"/>`),
  heart: svg(`<path d="M12 21.2S3.2 15.6 3.2 9.4A4.8 4.8 0 0 1 12 6.6a4.8 4.8 0 0 1 8.8 2.8c0 6.2-8.8 11.8-8.8 11.8Z"/>`),
  friend: svg(`<circle cx="12" cy="7.4" r="4.4"/><path d="M3.8 21.4c0-4.8 3.6-8 8.2-8s8.2 3.2 8.2 8Z"/>`),
  everyone: svg(`<circle cx="7.4" cy="8" r="3.4"/><circle cx="16.6" cy="8" r="3.4"/><path d="M1.4 20.6c0-3.8 2.6-6.4 6-6.4s6 2.6 6 6.4Z M10.6 20.6c0-3.8 2.6-6.4 6-6.4s6 2.6 6 6.4Z"/>`),
  wand: svg(`<path d="M15.6 2.2l1.5 3.1 3.4.5-2.5 2.4.6 3.4-3-1.6-3 1.6.6-3.4-2.5-2.4 3.4-.5Z"/><path d="M11.4 11.2 13 12.8 4.2 21.6a1.1 1.1 0 0 1-1.6-1.6Z"/>`),
};

/** A box shape choice (colored, 64 x 64 view): 'small' | 'tall' | 'round', in a paper color. */
export function boxSvg(kind, color = '#E23B4E', ribbon = '#FFD34D') {
  const dark = 'rgba(58,31,77,.18)';
  let body;
  if (kind === 'tall') {
    body = `<rect x="20" y="12" width="24" height="42" rx="3" fill="${color}"/><rect x="18" y="8" width="28" height="9" rx="3" fill="${color}"/><rect x="18" y="14" width="28" height="3" fill="${dark}"/><rect x="29.5" y="8" width="5" height="46" fill="${ribbon}"/>`;
  } else if (kind === 'round') {
    body = `<path d="M10 26v20c0 5 10 9 22 9s22-4 22-9V26Z" fill="${color}"/><ellipse cx="32" cy="26" rx="23" ry="8.6" fill="${color}"/><path d="M9 22v4.6c0 4.6 10.3 8.4 23 8.4s23-3.8 23-8.4V22" fill="${dark}"/><ellipse cx="32" cy="22" rx="23" ry="8.4" fill="${color}"/><rect x="29.5" y="14" width="5" height="41" fill="${ribbon}"/>`;
  } else {
    body = `<rect x="11" y="24" width="42" height="30" rx="3" fill="${color}"/><rect x="8" y="17" width="48" height="10" rx="3" fill="${color}"/><rect x="8" y="24" width="48" height="3" fill="${dark}"/><rect x="29.5" y="17" width="5" height="37" fill="${ribbon}"/>`;
  }
  const top = kind === 'tall' ? 8 : kind === 'round' ? 14 : 17;
  const bow = `<path d="M32 ${top}c-3-6-10-7-10.4-3.2-.4 3.2 5.6 3.8 10.4 3.2Zm0 0c3-6 10-7 10.4-3.2.4 3.2-5.6 3.8-10.4 3.2Z" fill="${ribbon}"/><circle cx="32" cy="${top}" r="2.6" fill="${ribbon}"/>`;
  return `<svg class="gf-pic" viewBox="0 0 64 64" aria-hidden="true">${body}${bow}</svg>`;
}

/** A bow choice (colored, 64 x 64): 'bow' | 'puff' | 'star'. */
export function bowSvg(kind, color = '#FFD34D') {
  const dark = 'rgba(58,31,77,.2)';
  let b;
  if (kind === 'puff') {
    b = '';
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const x = 32 + Math.cos(a) * 12, y = 34 + Math.sin(a) * 10;
      b += `<ellipse cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="9" ry="6" transform="rotate(${((a * 180) / Math.PI).toFixed(0)} ${x.toFixed(1)} ${y.toFixed(1)})" fill="${color}" stroke="${dark}" stroke-width="1.4"/>`;
    }
    b += `<circle cx="32" cy="34" r="8" fill="${color}" stroke="${dark}" stroke-width="1.4"/>`;
  } else if (kind === 'star') {
    b = `<path d="M32 8l6.4 13 14.4 2.1-10.4 10.1 2.4 14.3L32 40.8l-12.8 6.7 2.4-14.3L11.2 23.1 25.6 21Z" fill="${color}" stroke="${dark}" stroke-width="1.6" stroke-linejoin="round"/><circle cx="32" cy="29" r="5" fill="#fff" opacity=".55"/>`;
  } else {
    b = `<path d="M32 30C27 18 13 16 12.4 24c-.6 6.6 11.4 7.6 19.6 6Zm0 0c5-12 19-14 19.6-6 .6 6.6-11.4 7.6-19.6 6Z" fill="${color}" stroke="${dark}" stroke-width="1.6"/><path d="M29 32 20 52l6-2 3.4 5L34 33Z M35 32l9 20-6-2-3.4 5L30 33Z" fill="${color}" stroke="${dark}" stroke-width="1.4"/><circle cx="32" cy="30" r="5.2" fill="${color}" stroke="${dark}" stroke-width="1.6"/>`;
  }
  return `<svg class="gf-pic" viewBox="0 0 64 64" aria-hidden="true">${b}</svg>`;
}

// ---------------- sticker art (100 x 100) ----------------

function paint(g, fill, stroke = 'rgba(58,31,77,0.55)', w = 2.6) {
  g.fillStyle = fill;
  g.fill();
  if (stroke) {
    g.lineJoin = 'round';
    g.lineCap = 'round';
    g.strokeStyle = stroke;
    g.lineWidth = w;
    g.stroke();
  }
}
function rounded(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
/** A present (x, y = top-left of the box body, w x h) with a lid, ribbon and a bow. */
function present(g, x, y, w, h, paper, ribbon, dots = '#FFFFFF') {
  rounded(g, x, y, w, h, 5); paint(g, paper);
  g.fillStyle = dots;
  for (let i = 0; i < 6; i++) {
    g.beginPath();
    g.arc(x + w * (0.2 + (i % 3) * 0.3), y + h * (0.3 + Math.floor(i / 3) * 0.42), Math.max(1.6, w * 0.045), 0, Math.PI * 2);
    g.fill();
  }
  rounded(g, x - 4, y - h * 0.22, w + 8, h * 0.26, 4); paint(g, paper);
  g.fillStyle = ribbon;
  g.fillRect(x + w / 2 - w * 0.07, y - h * 0.22, w * 0.14, h * 1.22);
  const bx = x + w / 2, by = y - h * 0.22;
  g.beginPath(); g.moveTo(bx, by); g.bezierCurveTo(bx - w * 0.15, by - h * 0.5, bx - w * 0.42, by - h * 0.3, bx, by); paint(g, ribbon, 'rgba(58,31,77,0.45)', 2);
  g.beginPath(); g.moveTo(bx, by); g.bezierCurveTo(bx + w * 0.15, by - h * 0.5, bx + w * 0.42, by - h * 0.3, bx, by); paint(g, ribbon, 'rgba(58,31,77,0.45)', 2);
  g.beginPath(); g.arc(bx, by, Math.max(2.4, w * 0.06), 0, Math.PI * 2); paint(g, ribbon, 'rgba(58,31,77,0.45)', 2);
}
function heart(g, x, y, s, color) {
  g.beginPath();
  g.moveTo(x, y + s * 0.9);
  g.bezierCurveTo(x - s * 1.4, y - s * 0.1, x - s * 0.7, y - s * 1.1, x, y - s * 0.35);
  g.bezierCurveTo(x + s * 0.7, y - s * 1.1, x + s * 1.4, y - s * 0.1, x, y + s * 0.9);
  paint(g, color, 'rgba(58,31,77,0.45)', 2);
}
function sparkle(g, x, y, s, color = '#FFE38F') {
  g.beginPath();
  g.moveTo(x, y - s);
  g.quadraticCurveTo(x, y, x + s, y);
  g.quadraticCurveTo(x, y, x, y + s);
  g.quadraticCurveTo(x, y, x - s, y);
  g.quadraticCurveTo(x, y, x, y - s);
  paint(g, color, false);
}

/** Gift Maker: a present on a sheet of starry paper, scissors beside it. */
function makerArt(g) {
  g.beginPath(); g.moveTo(8, 70); g.lineTo(60, 58); g.lineTo(92, 74); g.lineTo(40, 90); g.closePath(); paint(g, '#9BE8CF');
  g.fillStyle = '#FFFFFF';
  for (const [x, y] of [[30, 72], [50, 66], [64, 78], [44, 82], [76, 72]]) { g.beginPath(); g.arc(x, y, 2.2, 0, Math.PI * 2); g.fill(); }
  present(g, 30, 40, 38, 30, '#FF6B8A', '#FFD34D');
  // scissors
  g.save(); g.translate(80, 40); g.rotate(-0.6);
  g.beginPath(); g.ellipse(-6, 10, 5, 4, 0, 0, Math.PI * 2); paint(g, '#FFFFFF', '#6B45C8', 3);
  g.beginPath(); g.ellipse(6, 10, 5, 4, 0, 0, Math.PI * 2); paint(g, '#FFFFFF', '#6B45C8', 3);
  g.beginPath(); g.moveTo(-3, 6); g.lineTo(4, -18); g.lineTo(6, -17); g.lineTo(1, 6); paint(g, '#D5DCEB');
  g.beginPath(); g.moveTo(3, 6); g.lineTo(-4, -18); g.lineTo(-6, -17); g.lineTo(-1, 6); paint(g, '#E9EEF8');
  g.restore();
  sparkle(g, 18, 22, 7);
  sparkle(g, 86, 16, 5, '#FFB3D6');
}

/** Gift Giver: a present held up with hearts floating out of it. */
function giverArt(g) {
  present(g, 26, 46, 48, 36, '#6CC6FF', '#FF6FA8');
  heart(g, 30, 20, 9, '#FF6FA8');
  heart(g, 52, 12, 7, '#FFB3D6');
  heart(g, 72, 22, 8, '#FF8CC6');
  // two little hands under the box
  g.beginPath(); g.ellipse(24, 82, 9, 6, -0.4, 0, Math.PI * 2); paint(g, '#FFD7B5');
  g.beginPath(); g.ellipse(76, 82, 9, 6, 0.4, 0, Math.PI * 2); paint(g, '#FFD7B5');
}

/** Holiday Helper: a big pile of presents with sparkles. */
function tenArt(g) {
  present(g, 10, 60, 30, 26, '#2FA866', '#FFFFFF');
  present(g, 60, 58, 32, 28, '#9C7BFF', '#FFD34D');
  present(g, 34, 40, 34, 46, '#E8424F', '#FFD34D', '#FFE38F');
  sparkle(g, 14, 30, 7);
  sparkle(g, 86, 34, 6, '#9BE8CF');
  sparkle(g, 50, 10, 5, '#FFB3D6');
}

export const STICKER_ART = { gift_maker: makerArt, gift_giver: giverArt, gift_ten: tenArt };
