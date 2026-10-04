// The five sea stickers with their own art (100 x 100 box, src/life/sticker-art.js), registered
// on 'game:ready' (the vehicles pattern, src/things/vehicles/stickers.js), and the small daily
// sea reward (docs/teams/ocean.md §8): +2 for the first hello to each kind each day, +5 for the
// first ride each day, at most 23 a day, through game.coins.add so it counts toward
// stats.coinsEarned. Nothing is bought; no text mentions coins.

import { SEA_KINDS } from './kinds.js';

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

/** A side-view dolphin (nose to the right) centred at (x, y), length L. */
function dolphin(g, x, y, L, body, belly, { tilt = 0, saddle = false } = {}) {
  g.save();
  g.translate(x, y);
  g.rotate(tilt);
  const s = L / 60;
  g.scale(s, s);
  // tail flukes
  g.beginPath(); g.moveTo(-24, -2); g.quadraticCurveTo(-34, -14, -38, -12); g.quadraticCurveTo(-33, -4, -34, 2); g.quadraticCurveTo(-33, 8, -38, 14); g.quadraticCurveTo(-32, 14, -24, 4); g.closePath(); paint(g, body);
  // dorsal fin
  g.beginPath(); g.moveTo(-6, -11); g.quadraticCurveTo(-2, -24, 6, -22); g.quadraticCurveTo(2, -16, 4, -10); g.closePath(); paint(g, body);
  // body
  g.beginPath(); g.moveTo(-26, 0); g.quadraticCurveTo(-14, -14, 8, -12); g.quadraticCurveTo(22, -11, 26, -3); g.quadraticCurveTo(32, -2, 34, 1); g.quadraticCurveTo(30, 5, 24, 5); g.quadraticCurveTo(8, 12, -10, 8); g.quadraticCurveTo(-20, 6, -26, 0); g.closePath(); paint(g, body);
  // belly
  g.beginPath(); g.moveTo(-14, 6); g.quadraticCurveTo(6, 11, 24, 4); g.quadraticCurveTo(10, 4, -14, 6); g.closePath(); paint(g, belly, false);
  // flipper
  g.beginPath(); g.moveTo(2, 4); g.quadraticCurveTo(-2, 14, -8, 15); g.quadraticCurveTo(-4, 8, -2, 4); g.closePath(); paint(g, body);
  // eye, shine, blush, smile
  g.beginPath(); g.arc(18, -4, 2.6, 0, Math.PI * 2); paint(g, '#2A1B33', false);
  g.beginPath(); g.arc(18.8, -4.9, 0.9, 0, Math.PI * 2); paint(g, '#FFFFFF', false);
  g.beginPath(); g.ellipse(17, 1.5, 3, 1.6, 0, 0, Math.PI * 2); paint(g, '#FF9EC4', false);
  g.beginPath(); g.moveTo(27, 2.5); g.quadraticCurveTo(30, 4, 32.5, 2.5); g.strokeStyle = '#5A4A6A'; g.lineWidth = 1.4; g.stroke();
  if (saddle) {
    g.beginPath(); g.ellipse(-2, -11, 8, 3.2, 0, 0, Math.PI * 2); paint(g, '#FFD84D');
    star(g, -2, -14, 4.2, '#FF5FA2');
  }
  g.restore();
}

function star(g, x, y, r, fill, stroke = 'rgba(58,31,77,0.45)') {
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? r * 0.48 : r;
    if (i) g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); else g.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  g.closePath();
  paint(g, fill, stroke, 1.6);
}

function heart(g, x, y, s, fill) {
  g.beginPath();
  g.moveTo(x, y + s * 0.38);
  g.bezierCurveTo(x - s * 0.62, y - s * 0.02, x - s * 0.3, y - s * 0.52, x, y - s * 0.2);
  g.bezierCurveTo(x + s * 0.3, y - s * 0.52, x + s * 0.62, y - s * 0.02, x, y + s * 0.38);
  g.closePath();
  paint(g, fill, 'rgba(58,31,77,0.45)', 1.8);
}

function wave(g, y, fill = '#8FD8FF') {
  g.beginPath();
  g.moveTo(8, y);
  for (let x = 8; x < 92; x += 14) g.quadraticCurveTo(x + 7, y - 7, x + 14, y);
  g.lineTo(92, 90); g.quadraticCurveTo(50, 96, 8, 90); g.closePath();
  paint(g, fill);
}

function bubble(g, x, y, r) {
  g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); paint(g, 'rgba(207,239,255,0.85)', 'rgba(58,31,77,0.35)', 1.6);
  g.beginPath(); g.arc(x - r * 0.35, y - r * 0.35, r * 0.25, 0, Math.PI * 2); paint(g, '#FFFFFF', false);
}

/** A lilac dolphin leaping over a wave, a heart. */
function friendArt(g) {
  wave(g, 70);
  dolphin(g, 50, 46, 62, '#B9A8F0', '#F6F2FF', { tilt: -0.35 });
  heart(g, 78, 20, 18, '#FF5FA2');
}

/** A sky dolphin with its little star saddle, splashing. */
function riderArt(g) {
  wave(g, 66);
  dolphin(g, 50, 58, 70, '#8EB8E0', '#F7FBFF', { saddle: true });
  for (const [x, y, r] of [[18, 52, 4], [24, 44, 3], [84, 50, 3.5], [90, 42, 2.6]]) { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); paint(g, '#BFE9FF', 'rgba(58,31,77,0.3)', 1.2); }
}

/** A fish, a starfish and a shell in bubbles. */
function explorerArt(g) {
  bubble(g, 30, 34, 20);
  bubble(g, 68, 30, 18);
  bubble(g, 50, 70, 22);
  // fish
  g.beginPath(); g.ellipse(30, 34, 11, 8, 0, 0, Math.PI * 2); paint(g, '#FF8FB1');
  g.beginPath(); g.moveTo(20, 34); g.lineTo(13, 28); g.lineTo(13, 40); g.closePath(); paint(g, '#FF8FB1');
  for (const [x, y] of [[29, 31], [33, 36], [26, 37]]) { g.beginPath(); g.arc(x, y, 1.4, 0, Math.PI * 2); paint(g, '#FFE3EC', false); }
  g.beginPath(); g.arc(36, 32, 1.6, 0, Math.PI * 2); paint(g, '#2A1B33', false);
  // starfish
  star(g, 68, 30, 12, '#FF9F5A');
  // shell
  g.beginPath(); g.moveTo(38, 78); g.quadraticCurveTo(50, 52, 62, 78); g.closePath(); paint(g, '#FFD6E8');
  for (let i = 0; i < 4; i++) { g.beginPath(); g.moveTo(50, 60); g.lineTo(41 + i * 6, 77); g.strokeStyle = 'rgba(58,31,77,0.35)'; g.lineWidth = 1.2; g.stroke(); }
}

/** An orange starfish with a little crown, sparkles. */
function starArt(g) {
  star(g, 50, 58, 34, '#FF9F5A');
  for (const [x, y] of [[50, 40], [38, 56], [62, 56], [44, 72], [56, 72]]) { g.beginPath(); g.arc(x, y, 2, 0, Math.PI * 2); paint(g, '#FFFFFF', false); }
  g.beginPath(); g.arc(45, 56, 2.4, 0, Math.PI * 2); paint(g, '#2A1B33', false);
  g.beginPath(); g.arc(55, 56, 2.4, 0, Math.PI * 2); paint(g, '#2A1B33', false);
  g.beginPath(); g.moveTo(47, 62); g.quadraticCurveTo(50, 64, 53, 62); g.strokeStyle = '#5A4A6A'; g.lineWidth = 1.4; g.stroke();
  // crown
  g.beginPath(); g.moveTo(38, 26); g.lineTo(40, 12); g.lineTo(46, 20); g.lineTo(50, 8); g.lineTo(54, 20); g.lineTo(60, 12); g.lineTo(62, 26); g.closePath(); paint(g, '#FFD43B');
  for (const [x, y, r] of [[18, 22, 5], [84, 30, 4], [80, 80, 5]]) star(g, x, y, r, '#FFF3B0');
}

/** A whale spouting a heart. */
function whaleArt(g) {
  wave(g, 74);
  g.save();
  g.translate(50, 64);
  g.beginPath(); g.moveTo(-36, 4); g.quadraticCurveTo(-30, -24, 4, -22); g.quadraticCurveTo(34, -20, 36, 2); g.quadraticCurveTo(30, 14, 0, 14); g.quadraticCurveTo(-24, 14, -36, 4); g.closePath(); paint(g, '#7FA7D6');
  g.beginPath(); g.moveTo(-34, 2); g.quadraticCurveTo(-46, -12, -48, -6); g.quadraticCurveTo(-44, 2, -48, 8); g.quadraticCurveTo(-42, 10, -34, 6); g.closePath(); paint(g, '#7FA7D6');
  g.beginPath(); g.moveTo(-16, 8); g.quadraticCurveTo(10, 16, 32, 4); g.quadraticCurveTo(8, 8, -16, 8); g.closePath(); paint(g, '#F2F6FA', false);
  g.beginPath(); g.arc(20, -6, 2.8, 0, Math.PI * 2); paint(g, '#2A1B33', false);
  g.beginPath(); g.ellipse(18, 0, 3.4, 1.8, 0, 0, Math.PI * 2); paint(g, '#FF9EC4', false);
  g.restore();
  // the spout and its heart
  g.beginPath(); g.moveTo(52, 42); g.quadraticCurveTo(48, 30, 42, 26); g.moveTo(52, 42); g.quadraticCurveTo(56, 30, 62, 26); g.strokeStyle = '#8FD8FF'; g.lineWidth = 3; g.stroke();
  heart(g, 52, 18, 20, '#FF5FA2');
}

export const OCEAN_STICKERS = [
  { id: 'dolphin_friend', name: 'Dolphin Friend', hint: 'Say hi to a dolphin', icon: 'star', art: friendArt },
  { id: 'dolphin_rider', name: 'Dolphin Rider', hint: 'Ride a dolphin', icon: 'star', art: riderArt },
  { id: 'sea_explorer', name: 'Sea Explorer', hint: 'Meet 5 kinds of sea animals', icon: 'star', art: explorerArt },
  { id: 'ocean_star', name: 'Ocean Star', hint: 'Fill all the Sea Friends', icon: 'star', art: starArt },
  { id: 'whale_hello', name: 'Whale Hello!', hint: 'See a whale say hello', icon: 'star', art: whaleArt },
];

/** Register on 'game:ready'; returns award(id) -> true when new (registers first, never twice). */
export function installOceanStickers(game) {
  const register = () => {
    const reg = game.registry.stickers;
    for (const s of OCEAN_STICKERS) if (!reg.has(s.id)) reg.set(s.id, { ...s });
  };
  game.events.on('game:ready', register);
  return (id) => {
    if (game.net && game.net.remoteApplying) return false;
    register();
    if (game.stickers && !game.stickers.has(id)) return !!game.award(id);
    return false;
  };
}

/** yyyymmdd of this device's today (a number that only grows). */
export function dayStamp(d = new Date()) {
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}

/**
 * The daily sea reward. what: a SEA_KINDS key (a hello, +2) or 'ride' (+5). Pays once per day
 * per kind / ride; returns the coins paid (0 when already paid today).
 */
export function dailySeaCoins(game, what, at = null, day = dayStamp()) {
  if (game.net && game.net.remoteApplying) return 0;
  const p = game.profile;
  if (!p) return 0;
  const s = p.stats || (p.stats = {});
  const bit = what === 'ride' ? 9 : SEA_KINDS.indexOf(what);
  if (bit < 0 || bit > 9) return 0;
  if (!(s.seaCoinDay >= day)) { s.seaCoinDay = day; s.seaCoinMask = 0; }
  if (s.seaCoinDay > day) return 0; // a clock that went backwards: pay nothing
  const mask = s.seaCoinMask | 0;
  if (mask & (1 << bit)) return 0;
  s.seaCoinMask = mask | (1 << bit);
  const n = what === 'ride' ? 5 : 2;
  if (game.coins && game.coins.add) game.coins.add(n, 'sea', { at });
  game.saveProfile();
  return n;
}
