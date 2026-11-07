// Holiday look stickers with their own art (100 x 100 box), registered once the game is ready
// (so they come after the older ones in the Sticker Book): "Little Helper" (dressed up as an
// elf) and "Ho Ho Ho!" (dressed up as Santa, the coat or the dress). The Studio's Holiday looks
// and the Dress-Up booth both earn them. Each pays +20 through the existing sticker listener.

const INK = 'rgba(58,31,77,0.55)';

function paint(g, fill, stroke = INK, w = 2.6) {
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

function circle(g, x, y, r, fill, stroke = INK, w = 2.4) {
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.closePath();
  paint(g, fill, stroke, w);
}

function sparkle(g, x, y, r, fill = '#FFE38F') {
  g.beginPath();
  g.moveTo(x, y - r);
  g.quadraticCurveTo(x + r * 0.18, y - r * 0.18, x + r, y);
  g.quadraticCurveTo(x + r * 0.18, y + r * 0.18, x, y + r);
  g.quadraticCurveTo(x - r * 0.18, y + r * 0.18, x - r, y);
  g.quadraticCurveTo(x - r * 0.18, y - r * 0.18, x, y - r);
  g.closePath();
  paint(g, fill, 'rgba(58,31,77,0.4)', 1.6);
}

/** A soft white band with rounded ends from x0 to x1 (the hats' fur trim). */
function band(g, x0, x1, y, h, fill = '#FFFFFF') {
  const r = h / 2;
  g.beginPath();
  g.moveTo(x0 + r, y);
  g.lineTo(x1 - r, y);
  g.arc(x1 - r, y + r, r, -Math.PI / 2, Math.PI / 2);
  g.lineTo(x0 + r, y + h);
  g.arc(x0 + r, y + r, r, Math.PI / 2, Math.PI * 1.5);
  g.closePath();
  paint(g, fill);
}

/** A striped candy cane: the stick from (x, y1) up to y0, the hook curling right. */
function candyCane(g, x, y0, y1) {
  g.lineCap = 'round';
  const path = () => {
    g.beginPath();
    g.moveTo(x, y1);
    g.lineTo(x, y0 + 8);
    g.arc(x + 8, y0 + 8, 8, Math.PI, 0);
    g.lineTo(x + 16, y0 + 14);
  };
  path();
  g.strokeStyle = 'rgba(58,31,77,0.55)';
  g.lineWidth = 10;
  g.stroke();
  path();
  g.strokeStyle = '#FFFFFF';
  g.lineWidth = 6.4;
  g.stroke();
  path();
  g.strokeStyle = '#E5383B';
  g.setLineDash([4.5, 4.5]);
  g.stroke();
  g.setLineDash([]);
}

/** A green elf hat with a zigzag brim, a bent tip and a gold bell, a candy cane beside it. */
function littleHelperArt(g) {
  // the snowy ground and a candy cane
  g.beginPath();
  g.moveTo(4, 84);
  g.quadraticCurveTo(50, 74, 96, 84);
  g.lineTo(96, 96);
  g.lineTo(4, 96);
  g.closePath();
  paint(g, '#EAF6FF');
  candyCane(g, 76, 40, 84);
  // the hat: a tall cone bending over to the right
  g.beginPath();
  g.moveTo(18, 70);
  g.quadraticCurveTo(30, 40, 44, 22);
  g.quadraticCurveTo(54, 12, 66, 16);
  g.quadraticCurveTo(58, 22, 56, 30);
  g.quadraticCurveTo(62, 50, 66, 70);
  g.closePath();
  paint(g, '#2FA84F');
  g.beginPath(); // a lighter fold
  g.moveTo(40, 62);
  g.quadraticCurveTo(44, 44, 52, 30);
  g.strokeStyle = 'rgba(255,255,255,0.35)';
  g.lineWidth = 3;
  g.stroke();
  circle(g, 68, 17, 5.5, '#FFD54A');
  g.beginPath();
  g.moveTo(65, 18);
  g.lineTo(71, 18);
  g.strokeStyle = INK;
  g.lineWidth = 1.6;
  g.stroke();
  // the zigzag brim in red with gold bells on the points
  g.beginPath();
  g.moveTo(12, 66);
  g.lineTo(72, 66);
  g.lineTo(72, 74);
  for (let i = 0; i < 6; i++) {
    const x = 72 - i * 10;
    g.lineTo(x - 5, 82);
    g.lineTo(x - 10, 74);
  }
  g.lineTo(12, 66);
  g.closePath();
  paint(g, '#E5383B');
  for (let i = 0; i < 6; i++) circle(g, 67 - i * 10, 83, 2.6, '#FFD54A', INK, 1.4);
  sparkle(g, 18, 22, 7);
  sparkle(g, 88, 26, 5, '#FFB8D6');
  sparkle(g, 26, 44, 4, '#D9C8FF');
}

/** A Santa hat flopping over a big fluffy beard with rosy cheeks, and a gold star. */
function hoHoHoArt(g) {
  // the beard: puffs around a round face
  circle(g, 50, 58, 22, '#F6D2B8');
  const puffs = [[30, 62, 10], [34, 74, 11], [44, 82, 11], [56, 82, 11], [66, 74, 11], [70, 62, 10], [50, 88, 9]];
  for (const [x, y, r] of puffs) circle(g, x, y, r, '#FFFFFF', INK, 2.2);
  g.beginPath(); // the mustache
  g.moveTo(50, 66);
  g.quadraticCurveTo(40, 60, 34, 68);
  g.quadraticCurveTo(42, 72, 50, 68);
  g.quadraticCurveTo(58, 72, 66, 68);
  g.quadraticCurveTo(60, 60, 50, 66);
  g.closePath();
  paint(g, '#FFFFFF', INK, 2);
  circle(g, 50, 61, 3.4, '#FF8C8C', null);
  circle(g, 38, 58, 4, 'rgba(255,120,140,0.45)', null);
  circle(g, 62, 58, 4, 'rgba(255,120,140,0.45)', null);
  for (const x of [42, 58]) circle(g, x, 52, 2.6, '#3A1F4D', null);
  // the hat
  g.beginPath();
  g.moveTo(26, 44);
  g.quadraticCurveTo(30, 14, 56, 12);
  g.quadraticCurveTo(76, 12, 84, 34);
  g.lineTo(76, 38);
  g.quadraticCurveTo(70, 26, 62, 26);
  g.quadraticCurveTo(70, 34, 74, 44);
  g.closePath();
  paint(g, '#E5383B');
  circle(g, 82, 40, 7, '#FFFFFF');
  band(g, 22, 78, 40, 12);
  sparkle(g, 14, 20, 7);
  sparkle(g, 90, 70, 6, '#FFB8D6');
  sparkle(g, 14, 76, 4.5, '#B8E1FF');
}

export const HOLIDAY_STICKERS = [
  { id: 'look_elf', name: 'Little Helper', hint: 'Dress up as an elf', icon: 'star', art: littleHelperArt },
  { id: 'look_santa', name: 'Ho Ho Ho!', hint: 'Dress up as Santa', icon: 'star', art: hoHoHoArt },
];

/** Register on 'game:ready'; returns award(id) -> true when new (registers first, never twice). */
export function installHolidayStickers(game) {
  const register = () => {
    const reg = game.registry.stickers;
    for (const s of HOLIDAY_STICKERS) if (!reg.has(s.id)) reg.set(s.id, { ...s });
  };
  game.events.on('game:ready', register);
  return (id) => {
    register();
    if (game.stickers && !game.stickers.has(id)) return !!game.award(id);
    return false;
  };
}
