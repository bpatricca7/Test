// Friend stickers with their own art: "Best Friends Forever" (invite a friend), "Dance Party"
// (dance with two friends at once) and "Sleepover" (sleep while a friend sleeps nearby).
// Registered once the game is ready, so they come after the core ones in the Sticker Book.

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

function heart(g, cx, cy, s, fill) {
  g.beginPath();
  g.moveTo(cx, cy + s * 0.38);
  g.bezierCurveTo(cx - s * 0.62, cy - s * 0.02, cx - s * 0.3, cy - s * 0.52, cx, cy - s * 0.2);
  g.bezierCurveTo(cx + s * 0.3, cy - s * 0.52, cx + s * 0.62, cy - s * 0.02, cx, cy + s * 0.38);
  g.closePath();
  paint(g, fill);
}

function girl(g, cx, cy, skin, hair, top, flip = 1) {
  // hair behind
  g.beginPath(); g.ellipse(cx, cy + 4, 21, 24, 0, 0, Math.PI * 2); paint(g, hair);
  // body
  g.beginPath(); g.moveTo(cx - 16, cy + 50); g.quadraticCurveTo(cx - 14, cy + 22, cx, cy + 22); g.quadraticCurveTo(cx + 14, cy + 22, cx + 16, cy + 50); g.closePath(); paint(g, top);
  // face
  g.beginPath(); g.ellipse(cx, cy + 2, 16, 17, 0, 0, Math.PI * 2); paint(g, skin);
  // bangs
  g.beginPath(); g.moveTo(cx - 17, cy); g.quadraticCurveTo(cx - 6 * flip, cy - 24, cx + 17, cy - 2); g.quadraticCurveTo(cx + 4 * flip, cy - 10, cx - 17, cy); paint(g, hair, false);
  // eyes + smile + blush
  g.fillStyle = '#2A1B33';
  for (const x of [cx - 6, cx + 6]) { g.beginPath(); g.ellipse(x, cy + 3, 2.6, 3.4, 0, 0, Math.PI * 2); g.fill(); }
  g.fillStyle = '#FFFFFF';
  for (const x of [cx - 7, cx + 5]) { g.beginPath(); g.arc(x, cy + 1.8, 1, 0, Math.PI * 2); g.fill(); }
  g.beginPath(); g.arc(cx, cy + 8, 4, 0.2, Math.PI - 0.2); g.strokeStyle = '#7A3E5A'; g.lineWidth = 1.8; g.stroke();
  g.fillStyle = 'rgba(255,120,170,0.55)';
  for (const x of [cx - 10, cx + 10]) { g.beginPath(); g.ellipse(x, cy + 8, 3.4, 2, 0, 0, Math.PI * 2); g.fill(); }
}

function bffArt(g) {
  heart(g, 50, 44, 92, '#FFD1E6');
  girl(g, 32, 38, '#8C5535', '#1F1614', '#9C7BFF', 1);
  girl(g, 68, 38, '#F6D2B8', '#EACB86', '#FF8CC6', -1);
  heart(g, 50, 82, 22, '#FF5FA2');
}

function note(g, x, y, fill) {
  g.beginPath(); g.ellipse(x, y, 7, 5.4, -0.4, 0, Math.PI * 2); paint(g, fill);
  g.beginPath(); g.moveTo(x + 5.6, y - 2); g.lineTo(x + 5.6, y - 26); g.lineTo(x + 16, y - 20); g.lineWidth = 3.4; g.strokeStyle = fill; g.stroke();
}

function danceArt(g) {
  // a disco ball of little squares
  g.beginPath(); g.arc(50, 48, 30, 0, Math.PI * 2); paint(g, '#C9C4E8');
  const cols = ['#FF8CC6', '#7CC7FF', '#FFE27A', '#B79CFF', '#8FE3A0', '#FFFFFF'];
  for (let y = 22; y < 76; y += 9) {
    for (let x = 22; x < 80; x += 9) {
      if ((x + 4 - 50) ** 2 + (y + 4 - 48) ** 2 > 27 * 27) continue;
      g.fillStyle = cols[(x * 7 + y * 3) % cols.length];
      g.fillRect(x, y, 7.5, 7.5);
    }
  }
  g.beginPath(); g.arc(50, 48, 30, 0, Math.PI * 2); g.strokeStyle = 'rgba(58,31,77,0.5)'; g.lineWidth = 2.6; g.stroke();
  g.beginPath(); g.moveTo(50, 18); g.lineTo(50, 4); g.strokeStyle = '#9C7BFF'; g.lineWidth = 3; g.stroke();
  note(g, 16, 86, '#FF5FA2');
  note(g, 76, 92, '#9C7BFF');
}

function sleepoverArt(g) {
  // a moon over two pillows with little z's
  g.beginPath(); g.arc(34, 30, 22, 0, Math.PI * 2); paint(g, '#FFF1A8');
  g.beginPath(); g.arc(44, 24, 20, 0, Math.PI * 2); g.fillStyle = '#FFFFFF'; g.globalCompositeOperation = 'destination-out'; g.fill(); g.globalCompositeOperation = 'source-over';
  for (const [x, c] of [[30, '#FFD1E6'], [70, '#E6DDFF']]) {
    g.beginPath(); g.moveTo(x - 24, 62); g.quadraticCurveTo(x, 50, x + 24, 62); g.quadraticCurveTo(x + 28, 76, x + 24, 88); g.quadraticCurveTo(x, 96, x - 24, 88); g.quadraticCurveTo(x - 28, 76, x - 24, 62); paint(g, c);
  }
  g.fillStyle = '#9C7BFF';
  g.font = '700 22px sans-serif';
  g.fillText('z', 68, 34);
  g.font = '700 16px sans-serif';
  g.fillText('z', 82, 20);
}

export const FRIEND_STICKERS = [
  { id: 'bff', name: 'Best Friends Forever', hint: 'Invite a friend to your world', icon: 'heart', art: bffArt },
  { id: 'dance_party', name: 'Dance Party', hint: 'Dance with two friends at once', icon: 'music', art: danceArt },
  { id: 'sleepover', name: 'Sleepover', hint: 'Sleep while a friend sleeps nearby', icon: 'moon', art: sleepoverArt },
];

export function installFriendStickers(game, sys) {
  const register = () => {
    const reg = game.registry.stickers;
    for (const s of FRIEND_STICKERS) if (!reg.has(s.id)) reg.set(s.id, { ...s });
  };
  game.events.on('game:ready', register);
  const award = (id) => {
    register();
    if (game.stickers && !game.stickers.has(id)) game.award(id);
  };
  game.events.on('friend:invite', () => award('bff'));
  game.events.on('friends:dance', ({ count }) => { if (count >= 2) award('dance_party'); });
  game.events.on('player:sleep', () => {
    // friends tuck in right after her (see index.js), so look a moment later
    setTimeout(() => {
      const pl = game.player;
      if (!pl) return;
      const any = sys.friends.some((f) => f.act === 'sleep' && f.bed && !f.bed.ground && f.distToPlayer() < 24);
      if (any) award('sleepover');
    }, 200);
  });
}
