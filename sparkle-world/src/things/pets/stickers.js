// Two new pet stickers with their own art: "Giddy Up!" (ride a horse) and "Shell Buddy"
// (adopt a turtle). Registered once the game is ready, so they come after the core ones in
// the Sticker Book.

function blob(g, fill, stroke = null, w = 2.6) {
  g.fillStyle = fill;
  g.fill();
  g.lineJoin = 'round';
  g.lineCap = 'round';
  g.strokeStyle = stroke || 'rgba(58,31,77,0.55)';
  g.lineWidth = w;
  g.stroke();
}

function rr(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function eyes(g, x1, x2, y, r = 4.6) {
  for (const x of [x1, x2]) {
    g.beginPath();
    g.ellipse(x, y, r * 0.8, r, 0, 0, Math.PI * 2);
    g.fillStyle = '#2A1B33';
    g.fill();
    g.beginPath();
    g.arc(x - r * 0.3, y - r * 0.35, r * 0.34, 0, Math.PI * 2);
    g.fillStyle = '#FFFFFF';
    g.fill();
  }
}

function horseArt(g) {
  // mane behind the head
  g.beginPath();
  g.moveTo(30, 18); g.quadraticCurveTo(12, 40, 22, 80); g.lineTo(44, 74); g.quadraticCurveTo(38, 44, 50, 20); g.closePath();
  blob(g, '#6B3A24');
  // head
  rr(g, 30, 16, 42, 50, 18);
  blob(g, '#C77A4A');
  // muzzle
  rr(g, 34, 52, 38, 30, 14);
  blob(g, '#E7B48E');
  // ears
  for (const x of [36, 62]) {
    g.beginPath(); g.moveTo(x - 6, 22); g.lineTo(x, 4); g.lineTo(x + 7, 22); g.closePath();
    blob(g, '#C77A4A');
  }
  // blaze + forelock
  rr(g, 47, 24, 8, 26, 4); blob(g, '#FFFFFF', false);
  g.beginPath(); g.moveTo(40, 18); g.quadraticCurveTo(52, 30, 60, 16); g.quadraticCurveTo(52, 10, 40, 18); blob(g, '#83492D');
  eyes(g, 41, 61, 40);
  for (const x of [45, 61]) { g.beginPath(); g.ellipse(x, 66, 3, 2.2, 0, 0, Math.PI * 2); g.fillStyle = '#8A4A2E'; g.fill(); }
  g.beginPath(); g.arc(53, 72, 5, 0.2, Math.PI - 0.2); g.strokeStyle = '#7A3E5A'; g.lineWidth = 2.4; g.stroke();
  // pink bridle
  rr(g, 32, 56, 42, 6, 3); blob(g, '#FF6FA5');
  // a little golden horseshoe
  g.beginPath(); g.arc(80, 82, 12, Math.PI * 0.1, Math.PI * 0.9, true); g.strokeStyle = '#FFC94D'; g.lineWidth = 7; g.stroke();
}

function turtleArt(g) {
  // flippers + head
  for (const [x, y] of [[20, 70], [80, 70], [24, 44], [76, 44]]) {
    g.beginPath(); g.ellipse(x, y, 10, 7, 0, 0, Math.PI * 2); blob(g, '#9FDF8C');
  }
  g.beginPath(); g.ellipse(50, 26, 16, 14, 0, 0, Math.PI * 2); blob(g, '#9FDF8C');
  eyes(g, 44, 56, 25, 3.6);
  g.beginPath(); g.arc(50, 29, 4, 0.3, Math.PI - 0.3); g.strokeStyle = '#3A2A33'; g.lineWidth = 2; g.stroke();
  // shell: a rainbow dome
  const cols = ['#FF7A9A', '#FFB36B', '#FFE27A', '#8FE3A0', '#7CC7FF', '#B79CFF'];
  cols.forEach((c, i) => {
    g.beginPath(); g.ellipse(50, 62, 34 - i * 5, 26 - i * 4, 0, 0, Math.PI * 2);
    blob(g, c, i === 0 ? null : false);
  });
  g.beginPath(); g.moveTo(50, 56); g.bezierCurveTo(44, 50, 40, 58, 50, 66); g.bezierCurveTo(60, 58, 56, 50, 50, 56);
  g.fillStyle = '#FFFFFF'; g.fill();
}

export const PET_STICKERS = [
  { id: 'giddy_up', name: 'Giddy Up!', hint: 'Ride a horse', icon: 'star', art: horseArt },
  { id: 'shell_buddy', name: 'Shell Buddy', hint: 'Adopt a turtle', icon: 'heart', art: turtleArt },
];

export function installPetStickers(game) {
  const register = () => {
    const reg = game.registry.stickers;
    for (const s of PET_STICKERS) if (!reg.has(s.id)) reg.set(s.id, { ...s });
  };
  game.events.on('game:ready', register);
  const award = (id) => {
    register();
    if (game.stickers && !game.stickers.has(id)) game.award(id);
  };
  const remote = () => !!(game.net && game.net.remoteApplying);
  game.events.on('pet:ride', ({ pet }) => { if (!remote() && pet && pet.species === 'horse') award('giddy_up'); });
  game.events.on('pet:adopt', ({ pet }) => { if (!remote() && pet && pet.species === 'turtle') award('shell_buddy'); });
}
