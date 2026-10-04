// Sea-form stickers with their own art (100 x 100 box): "Sea Magic!" (the first time she turns
// into a mermaid or a sea dragon) and "Big Leap!" (the first dolphin leap; Just Me earns it too).
// Registered once the game is ready, so they come after the older ones in the Sticker Book.

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

function waves(g, y, fill) {
  g.beginPath();
  g.moveTo(4, y);
  for (let i = 0; i < 6; i++) g.quadraticCurveTo(12 + i * 16, y - 9, 20 + i * 16, y);
  g.lineTo(96, 94);
  g.lineTo(4, 94);
  g.closePath();
  paint(g, fill);
}

/** A two-lobed fin (the mermaid's) at x, y (the root), w wide. */
function fin(g, x, y, w, fill) {
  g.beginPath();
  g.moveTo(x, y);
  g.quadraticCurveTo(x - w * 0.2, y - w * 0.35, x - w * 0.55, y - w * 0.5);
  g.quadraticCurveTo(x - w * 0.42, y - w * 0.12, x, y);
  g.quadraticCurveTo(x + w * 0.42, y - w * 0.12, x + w * 0.55, y - w * 0.5);
  g.quadraticCurveTo(x + w * 0.2, y - w * 0.35, x, y);
  g.closePath();
  paint(g, fill);
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

/** A teal mermaid tail rising from a wave, its fin up, with three sparkles. */
function seaMagicArt(g) {
  waves(g, 70, '#8FD8FF');
  // the tail, curving up out of the water
  g.beginPath();
  g.moveTo(38, 74);
  g.quadraticCurveTo(36, 50, 50, 36);
  g.lineTo(58, 40);
  g.quadraticCurveTo(48, 54, 52, 74);
  g.closePath();
  paint(g, '#3FD8B0');
  // scale arcs
  g.strokeStyle = 'rgba(255,255,255,0.75)';
  g.lineWidth = 1.8;
  for (const [x, y] of [[44, 64], [46, 54], [50, 46]]) {
    g.beginPath();
    g.arc(x, y, 4, 0.2, Math.PI - 0.2);
    g.stroke();
  }
  // the fin at the top
  g.save();
  g.translate(54, 38);
  g.rotate(0.55);
  fin(g, 0, 0, 40, '#A5F0E6');
  g.restore();
  sparkle(g, 20, 30, 8);
  sparkle(g, 80, 22, 6, '#FFB8D6');
  sparkle(g, 78, 56, 7, '#D9C8FF');
}

/** An arc of droplets over a wave with a fin at the top of the arc. */
function bigLeapArt(g) {
  waves(g, 76, '#8FD8FF');
  // the arc of droplets
  for (let i = 0; i <= 8; i++) {
    const a = Math.PI * (1 - i / 8);
    const x = 50 + Math.cos(a) * 36, y = 74 - Math.sin(a) * 50;
    if (i === 4) continue;
    g.beginPath();
    g.moveTo(x, y - 5);
    g.quadraticCurveTo(x + 4.5, y + 1, x, y + 4);
    g.quadraticCurveTo(x - 4.5, y + 1, x, y - 5);
    g.closePath();
    paint(g, '#CFEFFF', 'rgba(58,31,77,0.45)', 1.6);
  }
  // the fin at the top of the arc
  g.save();
  g.translate(50, 30);
  g.rotate(Math.PI);
  fin(g, 0, 0, 38, '#9C7BFF');
  g.restore();
  g.beginPath();
  g.moveTo(47, 30); g.lineTo(53, 30); g.lineTo(51, 40); g.lineTo(49, 40); g.closePath();
  paint(g, '#9C7BFF');
  sparkle(g, 82, 18, 6);
  sparkle(g, 18, 20, 5, '#FFB8D6');
}

export const SEA_STICKERS = [
  { id: 'sea_magic', name: 'Sea Magic!', hint: 'Swim in water 2 blocks deep as a mermaid or sea dragon', icon: 'star', art: seaMagicArt },
  { id: 'big_leap', name: 'Big Leap!', hint: 'Swim fast and leap out of the water', icon: 'star', art: bigLeapArt },
];

/** Register on 'game:ready'; returns award(id) -> true when new (registers first, never twice). */
export function installMerfolkStickers(game) {
  const register = () => {
    const reg = game.registry.stickers;
    for (const s of SEA_STICKERS) if (!reg.has(s.id)) reg.set(s.id, { ...s });
  };
  game.events.on('game:ready', register);
  return (id) => {
    register();
    if (game.stickers && !game.stickers.has(id)) return !!game.award(id);
    return false;
  };
}
