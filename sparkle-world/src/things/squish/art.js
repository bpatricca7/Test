// Pictures for the squishy toys: the mystery present (the drop, the shelf path, the button),
// the tip card's coin-arrow-present, the pointing finger, the pressing hand, the glitter star,
// the crown, the Squish Shelf icon, and the 4 stickers' art (100 x 100 canvas units).

const INK = '#3A1F4D';

/** The lilac mystery present: taller than wide, a swirl ribbon and a big "?" tag. */
export function presentSvg({ ribbon = '#FF6FA8', grey = false, open = false } = {}) {
  const box = grey ? '#D9D3E6' : '#C8B4FF';
  const lid = grey ? '#E6E1EF' : '#DCCDFF';
  const rib = grey ? '#C2BAD3' : ribbon;
  const dot = grey ? '#ECE8F3' : '#FFFFFF';
  const tag = grey ? '#F4F1F8' : '#FFFFFF';
  const q = grey ? '#B3A9C6' : '#8E5BD6';
  const lidT = open ? 'translate(16 -30) rotate(22 60 40)' : '';
  return `<svg viewBox="0 0 120 140" aria-hidden="true" focusable="false">
<ellipse cx="60" cy="134" rx="40" ry="5" fill="rgba(58,31,77,.18)"/>
<rect x="18" y="52" width="84" height="80" rx="9" fill="${box}"/>
<g fill="${dot}" opacity=".85"><circle cx="34" cy="70" r="4"/><circle cx="86" cy="72" r="4"/><circle cx="32" cy="112" r="4"/><circle cx="88" cy="114" r="4"/><circle cx="48" cy="92" r="3"/><circle cx="76" cy="96" r="3"/></g>
<path d="M54 52h12v80H54Z" fill="${rib}"/>
<path d="M18 86c22-8 62 8 84 0v12c-22 8-62-8-84 0Z" fill="${rib}" opacity=".9"/>
<g transform="${lidT}">
<rect x="12" y="36" width="96" height="20" rx="7" fill="${lid}"/>
<path d="M53 36h14v20H53Z" fill="${rib}"/>
<path d="M60 36c-16-22-34-14-28-2 4 7 18 4 28 2Z M60 36c16-22 34-14 28-2-4 7-18 4-28 2Z" fill="${rib}"/>
<path d="M60 36c-8-14-24-22-30-10M60 36c8-14 24-22 30-10" fill="none" stroke="${grey ? '#B3A9C6' : '#fff'}" stroke-width="2.5" opacity=".6" stroke-linecap="round"/>
<circle cx="60" cy="36" r="6" fill="${rib}"/>
</g>
<g transform="rotate(-8 84 104)"><rect x="70" y="92" width="28" height="32" rx="6" fill="${tag}" stroke="${grey ? '#D9D3E6' : '#E8DDFF'}" stroke-width="2"/>
<path d="M78 103c0-5 4-7 6-7s6 2 6 6c0 5-6 5-6 9" fill="none" stroke="${q}" stroke-width="3.5" stroke-linecap="round"/><circle cx="84" cy="118" r="2.3" fill="${q}"/></g>
</svg>`;
}

export function coinSvg() {
  return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="10" fill="#FFD84D" stroke="#F2A900" stroke-width="2"/><path d="M12 6.5c.4 3 1.6 4.4 4.6 4.8-3 .5-4.2 1.8-4.6 4.8-.4-3-1.6-4.3-4.6-4.8 3-.4 4.2-1.8 4.6-4.8Z" fill="#FFF6C8"/></svg>`;
}

export function arrowSvg() {
  return `<svg viewBox="0 0 40 24" aria-hidden="true" focusable="false"><path d="M2 12h28" stroke="#C8B4FF" stroke-width="5" stroke-linecap="round"/><path d="m26 4 10 8-10 8Z" fill="#C8B4FF"/></svg>`;
}

/** A bouncing pointing finger (points down). */
export function fingerSvg() {
  return `<svg viewBox="0 0 64 80" aria-hidden="true" focusable="false">
<path d="M26 74V44c0-4 6-4 6 0v-6c0-4 6-4 6 0v4c0-4 6-4 6 0v6c0-4 6-4 6 0v14c0 8-6 14-14 14h-4c-4 0-6-2-6-2Z" fill="#FFE0CC" stroke="${INK}" stroke-width="3" stroke-linejoin="round" transform="rotate(180 38 52)"/>
</svg>`;
}

/** A little hand pressing down on a blob (the shelf's "Press it!"). */
export function pressSvg() {
  return `<svg viewBox="0 0 64 48" aria-hidden="true" focusable="false">
<ellipse cx="32" cy="38" rx="22" ry="8" fill="#FF9CCB"/>
<path d="M22 4h20v14c0 6-4 10-10 10s-10-4-10-10Z" fill="#FFE0CC" stroke="${INK}" stroke-width="2.5"/>
<path d="M32 30v4M24 30l-2 3M40 30l2 3" stroke="${INK}" stroke-width="2.5" stroke-linecap="round"/>
</svg>`;
}

export function starSvg(color = '#FFC94D') {
  return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 2.5l2.8 6 6.5.7-4.9 4.4 1.4 6.4L12 16.8 6.2 20l1.4-6.4L2.7 9.2l6.5-.7Z" fill="${color}" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg>`;
}

export function crownSvg() {
  return `<svg viewBox="0 0 48 36" aria-hidden="true" focusable="false"><path d="M4 30 2 8l12 10L24 2l10 16L46 8l-2 22Z" fill="#FFD43B" stroke="#F2A900" stroke-width="2.5" stroke-linejoin="round"/><circle cx="24" cy="22" r="3.5" fill="#FF6FA8"/><circle cx="12" cy="24" r="2.5" fill="#6CC6FF"/><circle cx="36" cy="24" r="2.5" fill="#3FD8B0"/></svg>`;
}

export function sparkleSvg(color = '#FFC94D') {
  return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 1.8c.6 4.8 2.6 7.4 8 8.2-5.4.8-7.4 3.4-8 8.2-.6-4.8-2.6-7.4-8-8.2 5.4-.8 7.4-3.4 8-8.2Z" fill="${color}"/></svg>`;
}

/** The Squish Shelf's icon (a little shelf with two blobs), for buttons (currentColor). */
export function shelfIcon() {
  return `<svg class="sw-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><path d="M2.5 13.6h19v2.6h-19Z M3.4 16.2h2.4v5H3.4Z M18.2 16.2h2.4v5h-2.4Z"/><ellipse cx="8" cy="10.2" rx="4" ry="3.4"/><path d="M13.6 13.6c0-4 1.4-7.6 3.8-7.6s3.6 3.6 3.6 7.6Z"/><circle cx="7" cy="9.4" r=".9" fill="#fff"/><circle cx="9.2" cy="9.4" r=".9" fill="#fff"/></svg>`;
}

// ---------------- sticker art (100 x 100) ----------------

function blob(g, x, y, rx, ry, fill) {
  g.fillStyle = fill;
  g.beginPath();
  g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  g.fill();
}
function face(g, x, y, s = 1) {
  g.fillStyle = INK;
  g.fillRect(x - 9 * s, y - 3 * s, 4 * s, 5 * s);
  g.fillRect(x + 5 * s, y - 3 * s, 4 * s, 5 * s);
  g.strokeStyle = INK;
  g.lineWidth = 2.2 * s;
  g.lineCap = 'round';
  g.beginPath();
  g.arc(x, y + 3 * s, 4 * s, 0.2 * Math.PI, 0.8 * Math.PI);
  g.stroke();
  g.fillStyle = 'rgba(255,120,170,.6)';
  g.fillRect(x - 15 * s, y + 4 * s, 5 * s, 3 * s);
  g.fillRect(x + 10 * s, y + 4 * s, 5 * s, 3 * s);
}
function star(g, x, y, r, fill) {
  g.fillStyle = fill;
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.45 : r;
    g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  g.closePath();
  g.fill();
}
function heartPath(g, x, y, s) {
  g.beginPath();
  g.moveTo(x, y + s * 0.9);
  g.bezierCurveTo(x - s * 1.4, y, x - s * 0.7, y - s, x, y - s * 0.35);
  g.bezierCurveTo(x + s * 0.7, y - s, x + s * 1.4, y, x, y + s * 0.9);
  g.closePath();
}

export const STICKER_ART = {
  // an open lilac present with a Puffum popping out, stars
  squish_first(g) {
    star(g, 18, 20, 8, '#FFD43B');
    star(g, 84, 26, 6, '#FF9CCB');
    blob(g, 50, 40, 20, 17, '#FF5F7E');
    g.fillStyle = '#4FB860';
    for (let i = 0; i < 5; i++) blob(g, 38 + i * 6, 24, 4, 3, '#4FB860');
    face(g, 50, 40, 0.9);
    g.fillStyle = '#C8B4FF';
    g.fillRect(22, 56, 56, 34);
    g.fillStyle = '#FF6FA8';
    g.fillRect(45, 56, 10, 34);
    g.fillStyle = '#DCCDFF';
    g.save();
    g.translate(70, 46);
    g.rotate(0.5);
    g.fillRect(-10, -6, 34, 10);
    g.restore();
  },
  // three toys on a little shelf
  squish_ten(g) {
    g.fillStyle = '#E7BE8C';
    g.fillRect(10, 66, 80, 8);
    g.fillRect(14, 74, 6, 16);
    g.fillRect(80, 74, 6, 16);
    blob(g, 28, 54, 13, 12, '#FF8FC8');
    face(g, 28, 54, 0.6);
    blob(g, 50, 50, 12, 16, '#7FD37A');
    face(g, 50, 48, 0.6);
    blob(g, 72, 54, 13, 12, '#6CC6FF');
    face(g, 72, 54, 0.6);
    star(g, 50, 18, 9, '#FFD43B');
  },
  // a crown over a heart-shaped Stretchum
  squish_all(g) {
    g.fillStyle = '#FF5F7E';
    heartPath(g, 50, 60, 26);
    g.fill();
    face(g, 50, 58, 0.9);
    g.fillStyle = '#FFD43B';
    g.beginPath();
    g.moveTo(30, 30);
    g.lineTo(28, 10);
    g.lineTo(40, 20);
    g.lineTo(50, 6);
    g.lineTo(60, 20);
    g.lineTo(72, 10);
    g.lineTo(70, 30);
    g.closePath();
    g.fill();
    blob(g, 50, 22, 3, 3, '#FF6FA8');
  },
  // a blob squashed flat with motion lines
  squish_squeeze(g) {
    blob(g, 50, 66, 32, 14, '#C8B4FF');
    face(g, 50, 64, 0.8);
    g.strokeStyle = '#FF9CCB';
    g.lineWidth = 4;
    g.lineCap = 'round';
    for (const [x0, x1, y] of [[12, 22, 46], [78, 88, 46], [8, 18, 60], [82, 92, 60]]) {
      g.beginPath();
      g.moveTo(x0, y);
      g.lineTo(x1, y);
      g.stroke();
    }
    g.fillStyle = '#FFE0CC';
    g.fillRect(40, 18, 20, 26);
    g.strokeStyle = INK;
    g.lineWidth = 2;
    g.strokeRect(40, 18, 20, 26);
  },
};
