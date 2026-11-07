// Cruise art: little SVG pictures for the "What's On" board, the lift and the game panel, and
// the six stickers' hand-drawn art (100 x 100 canvas, the vehicles stickers' pattern). All
// drawn here, our own designs.

const S = 'fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"';

// 24 x 24 pictures, one color (currentColor) with soft see-through bits
const PICS = {
  pool: `<path d="M2 15.6c1.7 0 1.7-1.4 3.3-1.4s1.7 1.4 3.3 1.4 1.7-1.4 3.4-1.4 1.7 1.4 3.3 1.4 1.7-1.4 3.4-1.4 1.6 1.4 3.3 1.4v2.2c-1.7 0-1.7-1.4-3.3-1.4s-1.7 1.4-3.4 1.4-1.7-1.4-3.3-1.4-1.7 1.4-3.4 1.4-1.7-1.4-3.3-1.4S3.7 17.8 2 17.8Z"/><path opacity=".55" d="M2 19.6c1.7 0 1.7-1.4 3.3-1.4s1.7 1.4 3.3 1.4 1.7-1.4 3.4-1.4 1.7 1.4 3.3 1.4 1.7-1.4 3.4-1.4 1.6 1.4 3.3 1.4v2.2H2Z"/><path ${S} stroke-width="2.2" d="M7 13V4.6a2 2 0 0 1 4 0M14 13V4.6a2 2 0 0 1 4 0M7 7.6h7M7 10.6h7"/>`,
  slide: `<path ${S} stroke-width="3" d="M4 4.6c3.2 0 4.4 2 5 5 .7 3.6 2.4 6 6.4 6.6 2.4.4 3.8 1.4 5 3.2"/><path ${S} stroke-width="2" d="M3 4.6v15.6M6.4 7.4v12.8"/><path opacity=".6" d="M15 21.8c1-1.8 2.6-2.6 4.6-2.6s2.4.8 3.4 2.6Z"/><circle cx="20.6" cy="16.4" r="1.2"/><circle cx="22.4" cy="13.8" r=".8"/>`,
  arcade: `<path d="M6 2.4h12a1.6 1.6 0 0 1 1.6 1.6v6.4H4.4V4A1.6 1.6 0 0 1 6 2.4Z"/><path opacity=".55" d="M4.4 11.6h15.2l1.4 3.6H3Z"/><path d="M4.4 16.4h15.2v5.2H4.4Z"/><circle fill="#fff" cx="9" cy="6.4" r="1.6"/><path fill="#fff" d="M13.6 5.2h3.4v2.4h-3.4Z"/>`,
  hoops: `<circle cx="9" cy="14.6" r="6.4"/><path ${S} stroke-width="1.4" stroke="#fff" d="M2.8 14.6h12.4M9 8.2v12.8M4.6 10c2 1.6 2 7.6 0 9.2M13.4 10c-2 1.6-2 7.6 0 9.2"/><path opacity=".6" d="M13.6 3h8.2v6.2h-8.2Z"/><path ${S} stroke-width="1.8" d="M15.2 9.6l1 4.2h3.8l1-4.2"/>`,
  golf: `<path d="M11 2.6h1.8v15H11Z"/><path d="M12.8 2.6 21 6.2l-8.2 3.6Z"/><ellipse opacity=".55" cx="12" cy="19.6" rx="9" ry="2.6"/><circle cx="6.4" cy="17.6" r="2"/>`,
  dance: `<circle cx="12" cy="7.4" r="5"/><path opacity=".55" d="M2.4 18.6h19.2v3H2.4Z"/><path ${S} stroke-width="1.6" d="M12 2.4v-.8M7.4 7.4h9.2M12 2.6c-1.6 1.6-1.6 8 0 9.6M12 2.6c1.6 1.6 1.6 8 0 9.6"/><path ${S} stroke-width="2" opacity=".75" d="M7.6 12.8 4.6 18M16.4 12.8l3 5.2M12 13v5"/>`,
  movie: `<path d="M2.4 4.6h19.2v11.8H2.4Z"/><path fill="#fff" d="M10 7.6v6l5-3Z"/><path opacity=".6" d="M7 16.4h2v4.6H7Z M15 16.4h2v4.6h-2Z"/>`,
  wheel: `<circle ${S} stroke-width="2.4" cx="12" cy="12" r="6.6"/><circle cx="12" cy="12" r="2.2"/><path ${S} stroke-width="2.2" d="M12 1.8v20.4M1.8 12h20.4M4.8 4.8l14.4 14.4M19.2 4.8 4.8 19.2"/>`,
  bed: `<path d="M2.4 9.4h3v4.2h16.2v6.6h-2.4v-2.4H4.8v2.4H2.4Z"/><path opacity=".6" d="M6.6 10.2h5.4v3.4H6.6Z"/><path d="M12.6 11.2a3 3 0 0 1 3-3h3a3 3 0 0 1 3 3v2.4h-9Z"/>`,
  palm: `<path d="M11.2 10.6c.6 4 .6 7.6-.6 11.2h2.2c1-3.6 1.2-7.2.6-11.2Z"/><path d="M12 9.4C9.6 6 5.6 5.6 2.6 7.6c3.2-.2 5.8.8 8 3.2ZM12 9.4c2.4-3.4 6.4-3.8 9.4-1.8-3.2-.2-5.8.8-8 3.2ZM12 9.6c-1-3.6.4-6.4 3.6-7.6-1.8 2.4-2.4 4.8-2 7.4Z"/><path opacity=".55" d="M2 21.8c2.6-2.6 6.2-3.6 10-3.6s7.4 1 10 3.6Z"/>`,
  lift: `<path opacity=".5" d="M4.4 2.4h15.2v19.2H4.4Z"/><path d="M8 9.8 12 4.6l4 5.2Z M8 14.2h8l-4 5.2Z"/>`,
  star: `<path d="M12 2.2l2.9 6.2 6.7.8-5 4.6 1.4 6.6L12 17.1l-6 3.3 1.4-6.6-5-4.6 6.7-.8Z"/>`,
  bubble: `<circle ${S} stroke-width="2.2" cx="11" cy="12" r="7.6"/><circle ${S} stroke-width="1.8" cx="19.4" cy="5" r="2.6"/><path ${S} stroke-width="1.8" opacity=".7" d="M7.4 9.2a4 4 0 0 1 3-2"/>`,
  fish: `<path d="M2.6 12c3-4.4 8.6-5.4 12.8-2.6L21.4 6v12l-6-3.4C11.2 17.4 5.6 16.4 2.6 12Z"/><circle fill="#fff" cx="7.6" cy="11" r="1.3"/>`,
  ring: `<ellipse ${S} stroke-width="2.6" cx="12" cy="8.4" rx="7" ry="3.4"/><path opacity=".6" d="M10 12.6h4l1 9.2H9Z"/><path d="M10.8 9.8h2.4v3h-2.4Z"/>`,
  puck: `<ellipse cx="12" cy="15" rx="7.6" ry="3.4"/><path opacity=".55" d="M4.4 12.6h15.2V15H4.4Z"/><ellipse fill="#fff" opacity=".6" cx="12" cy="12.6" rx="7.6" ry="3.4"/><path ${S} stroke-width="2.2" d="M12 2.4v6.4M9 5.6l3 3.2 3-3.2"/>`,
  throw: `<path ${S} stroke-width="2.4" d="M3 19c3-9 9-14 18-15"/><path d="m16.6 2.2 5.2 1.6-2.6 4.8Z"/><circle cx="4.4" cy="19.4" r="2.6"/>`,
  putt: `<path ${S} stroke-width="2.4" d="M6 2.6l7 15.4"/><path d="M11.2 17.4h6.4v2.6h-6.4Z"/><circle cx="20.4" cy="18.6" r="2"/>`,
  again: `<path ${S} stroke-width="2.6" d="M19 8.6A7.6 7.6 0 1 0 19.6 15"/><path d="m21.6 3.4-.4 7-6.8-1.4Z"/>`,
  done: `<path ${S} stroke-width="3" d="m4.4 12.6 4.6 4.6 10.6-10.6"/>`,
  next: `<path d="M5 3.6 17 12 5 20.4Z"/><path d="M17.4 3.6h2.4v16.8h-2.4Z"/>`,
  go: `<path d="M6.4 3.4 20 12 6.4 20.6Z"/>`,
  horn: `<path d="M3 9.6h5l8-5.2v15.2l-8-5.2H3Z"/><path ${S} stroke-width="2" d="M18.6 8.4a5 5 0 0 1 0 7.2M20.8 6a8.4 8.4 0 0 1 0 12"/>`,
};

/** An inline SVG picture (falls back to a star). */
export function crIcon(name, cls = '') {
  return `<svg class="cr-icon ${cls}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">${PICS[name] || PICS.star}</svg>`;
}

// ---------- sticker art (100 x 100) ----------

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

function starPath(g, x, y, R, r, rot = 0) {
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + rot + (i / 10) * Math.PI * 2;
    const d = i % 2 === 0 ? R : r;
    g.lineTo(x + Math.cos(a) * d, y + Math.sin(a) * d);
  }
  g.closePath();
}

const FONT = "700 13px 'Fredoka', ui-rounded, 'Arial Rounded MT Bold', sans-serif";

/** A swirly blue slide ending in a big splash. */
function splashArt(g) {
  g.beginPath();
  g.moveTo(14, 12); g.bezierCurveTo(70, 14, 20, 50, 62, 58); g.lineTo(70, 66); g.bezierCurveTo(10, 56, 58, 24, 8, 22); g.closePath();
  paint(g, '#7CC8FF');
  g.beginPath(); g.moveTo(16, 15); g.bezierCurveTo(56, 18, 22, 46, 60, 57); g.strokeStyle = '#FFFFFF'; g.lineWidth = 2.4; g.stroke();
  // splash
  g.beginPath(); g.ellipse(70, 82, 26, 9, 0, 0, Math.PI * 2); paint(g, '#9FE0FF');
  for (const [x, y, r] of [[52, 68, 5], [62, 60, 6], [76, 58, 6.5], [88, 66, 5], [70, 70, 4]]) { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); paint(g, '#CFEFFF'); }
  g.font = FONT; g.textAlign = 'center'; g.textBaseline = 'middle';
  rounded(g, 8, 72, 38, 18, 9); paint(g, '#FFE38F');
  g.fillStyle = '#3A1F4D'; g.fillText('splash', 27, 81);
}

/** An arcade cabinet with a star on its screen. */
function arcadeArt(g) {
  rounded(g, 26, 10, 48, 82, 8); paint(g, '#9C7BFF');
  rounded(g, 32, 22, 36, 30, 5); paint(g, '#2A2766');
  starPath(g, 50, 37, 11, 5); paint(g, '#FFE070', false);
  rounded(g, 28, 56, 44, 10, 4); paint(g, '#7A5AD6');
  g.beginPath(); g.arc(40, 61, 3.6, 0, Math.PI * 2); paint(g, '#FF5FA2', false);
  for (const [x, c] of [[54, '#7CC8FF'], [63, '#7CFFB0']]) { g.beginPath(); g.arc(x, 61, 3, 0, Math.PI * 2); paint(g, c, false); }
  rounded(g, 24, 4, 52, 12, 5); paint(g, '#FFC94D');
  for (const [x, y] of [[14, 26], [86, 18], [88, 70], [12, 76]]) { starPath(g, x, y, 6, 2.6); paint(g, '#FFE070', false); }
}

/** A gold trophy with a ball, a ring and a puck. */
function champArt(g) {
  g.beginPath(); g.moveTo(30, 14); g.lineTo(70, 14); g.quadraticCurveTo(70, 52, 50, 56); g.quadraticCurveTo(30, 52, 30, 14); g.closePath(); paint(g, '#FFC94D');
  g.beginPath(); g.arc(30, 26, 9, Math.PI * 0.5, Math.PI * 1.5); g.strokeStyle = '#F2A93B'; g.lineWidth = 4; g.stroke();
  g.beginPath(); g.arc(70, 26, 9, -Math.PI * 0.5, Math.PI * 0.5); g.stroke();
  rounded(g, 44, 56, 12, 12, 2); paint(g, '#F2A93B');
  rounded(g, 34, 66, 32, 10, 4); paint(g, '#C98F55');
  starPath(g, 50, 30, 9, 4); paint(g, '#FFFFFF', false);
  g.beginPath(); g.arc(16, 84, 9, 0, Math.PI * 2); paint(g, '#FF8A3D');
  g.beginPath(); g.ellipse(50, 88, 10, 4, 0, 0, Math.PI * 2); g.strokeStyle = '#FF5FA2'; g.lineWidth = 3.4; g.stroke();
  g.beginPath(); g.ellipse(84, 86, 9, 4.5, 0, 0, Math.PI * 2); paint(g, '#4FB8FF');
}

/** A flag in a hole on a green, a ball rolling in. */
function golfArt(g) {
  g.beginPath(); g.ellipse(50, 72, 42, 20, 0, 0, Math.PI * 2); paint(g, '#7FD37A');
  g.beginPath(); g.ellipse(58, 72, 8, 3.4, 0, 0, Math.PI * 2); paint(g, '#3A1F4D', false);
  g.beginPath(); g.moveTo(58, 72); g.lineTo(58, 16); g.strokeStyle = '#FFFFFF'; g.lineWidth = 3; g.stroke();
  g.beginPath(); g.moveTo(59, 16); g.lineTo(84, 24); g.lineTo(59, 32); g.closePath(); paint(g, '#FF5FA2');
  g.beginPath(); g.arc(34, 74, 6, 0, Math.PI * 2); paint(g, '#FFFFFF');
  g.setLineDash([3, 5]);
  g.beginPath(); g.moveTo(10, 80); g.quadraticCurveTo(20, 76, 27, 75); g.strokeStyle = '#FFFFFF'; g.lineWidth = 2; g.stroke();
  g.setLineDash([]);
  starPath(g, 22, 22, 8, 3.5); paint(g, '#FFE070', false);
}

/** A captain's hat over a ship's wheel. */
function captainArt(g) {
  g.beginPath(); g.arc(50, 60, 28, 0, Math.PI * 2); g.strokeStyle = '#C98F55'; g.lineWidth = 6; g.stroke();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    g.beginPath(); g.moveTo(50, 60); g.lineTo(50 + Math.cos(a) * 38, 60 + Math.sin(a) * 38); g.strokeStyle = '#C98F55'; g.lineWidth = 4.4; g.stroke();
    g.beginPath(); g.arc(50 + Math.cos(a) * 39, 60 + Math.sin(a) * 39, 4, 0, Math.PI * 2); paint(g, '#FFC94D', false);
  }
  g.beginPath(); g.arc(50, 60, 7, 0, Math.PI * 2); paint(g, '#FFC94D');
  // the hat
  g.beginPath(); g.moveTo(18, 30); g.quadraticCurveTo(50, 2, 82, 30); g.closePath(); paint(g, '#FFFFFF');
  rounded(g, 16, 28, 68, 10, 5); paint(g, '#3B4F8C');
  starPath(g, 50, 22, 6, 2.6); paint(g, '#FFC94D', false);
}

/** A disco ball with music notes. */
function partyArt(g) {
  g.beginPath(); g.moveTo(50, 4); g.lineTo(50, 18); g.strokeStyle = '#C8B4FF'; g.lineWidth = 2; g.stroke();
  g.beginPath(); g.arc(50, 42, 24, 0, Math.PI * 2); paint(g, '#E2E6F4');
  g.save();
  g.beginPath(); g.arc(50, 42, 24, 0, Math.PI * 2); g.clip();
  for (let y = 18; y < 68; y += 8) for (let x = 26; x < 76; x += 8) { g.fillStyle = ((x + y) / 8) % 2 ? '#C9D0EA' : '#FFFFFF'; g.fillRect(x, y, 7, 7); }
  g.restore();
  for (const [x, y, c] of [[16, 76, '#FF5FA2'], [82, 72, '#4FB8FF']]) {
    g.beginPath(); g.ellipse(x, y, 6, 4.6, -0.4, 0, Math.PI * 2); paint(g, c, false);
    g.beginPath(); g.moveTo(x + 5, y - 2); g.lineTo(x + 5, y - 22); g.lineTo(x + 13, y - 18); g.strokeStyle = c; g.lineWidth = 3; g.stroke();
  }
  for (const [x, y, c] of [[50, 84, '#FFC94D'], [30, 92, '#3FD8B0'], [70, 92, '#9C7BFF']]) { starPath(g, x, y, 6, 2.6); paint(g, c, false); }
}

export const STICKERS = [
  { id: 'cruise_splash', name: 'Splashdown!', hint: 'Ride a water slide', icon: 'star', art: splashArt },
  { id: 'cruise_arcade', name: 'Arcade Star', hint: 'Play an arcade game', icon: 'star', art: arcadeArt },
  { id: 'cruise_champ', name: 'Deck Champ', hint: 'Play hoops, ring toss and shuffleboard', icon: 'star', art: champArt },
  { id: 'cruise_golf', name: 'Putt Putt!', hint: 'Finish a mini golf course', icon: 'star', art: golfArt },
  { id: 'cruise_captain', name: 'Captain!', hint: "Take the captain's wheel", icon: 'star', art: captainArt },
  { id: 'cruise_party', name: 'Disco Deck', hint: 'Start a party at the DJ booth', icon: 'star', art: partyArt },
];
