// Vehicle stickers with their own art (100 x 100 box, src/life/sticker-art.js): "Beep Beep!"
// (her first drive in a car, a go-kart or a van) and "Ahoy!" (her first boat ride). Registered
// once the game is ready, so they come after the core ones in the Sticker Book.

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

/** A round pink car with a big smile and two "beep" bubbles. */
function beepArt(g) {
  // body and roof
  rounded(g, 12, 46, 76, 28, 12); paint(g, '#FF8CC6');
  g.beginPath(); g.moveTo(28, 48); g.quadraticCurveTo(34, 24, 52, 24); g.quadraticCurveTo(70, 24, 74, 48); g.closePath(); paint(g, '#FFB3D6');
  g.beginPath(); g.moveTo(35, 47); g.quadraticCurveTo(39, 31, 51, 31); g.quadraticCurveTo(63, 31, 66, 47); g.closePath(); paint(g, '#CFEFFF');
  // wheels
  for (const x of [30, 70]) {
    g.beginPath(); g.arc(x, 75, 10, 0, Math.PI * 2); paint(g, '#4B3F5E');
    g.beginPath(); g.arc(x, 75, 4.5, 0, Math.PI * 2); paint(g, '#FFFFFF', false);
  }
  // headlamp and a smile
  g.beginPath(); g.arc(83, 56, 5, 0, Math.PI * 2); paint(g, '#FFF3B0');
  g.beginPath(); g.arc(50, 58, 7, 0.2, Math.PI - 0.2); g.strokeStyle = '#3A1F4D'; g.lineWidth = 2.4; g.stroke();
  // "beep beep" bubbles
  g.font = "700 13px 'Fredoka', ui-rounded, 'Arial Rounded MT Bold', sans-serif";
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (const [x, y, c] of [[22, 18, '#FFE38F'], [80, 14, '#9BE8CF']]) {
    rounded(g, x - 17, y - 9, 34, 18, 9); paint(g, c);
    g.fillStyle = '#3A1F4D';
    g.fillText('beep', x, y + 1);
  }
}

/** A little boat with a striped sail on blue waves. */
function ahoyArt(g) {
  // waves
  g.beginPath();
  g.moveTo(6, 74);
  for (let i = 0; i < 6; i++) g.quadraticCurveTo(14 + i * 15, 66, 21 + i * 15, 74);
  g.lineTo(96, 92); g.lineTo(6, 92); g.closePath();
  paint(g, '#8FD8FF');
  // hull
  g.beginPath(); g.moveTo(18, 62); g.lineTo(84, 62); g.lineTo(74, 78); g.lineTo(28, 78); g.closePath(); paint(g, '#FF8CC6');
  g.beginPath(); g.moveTo(22, 62); g.lineTo(80, 62); g.lineTo(78, 66); g.lineTo(24, 66); g.closePath(); paint(g, '#FFFFFF', false);
  // mast and the striped sail
  g.beginPath(); g.moveTo(50, 62); g.lineTo(50, 12); g.lineWidth = 3.4; g.strokeStyle = '#B98A5E'; g.stroke();
  g.save();
  g.beginPath(); g.moveTo(53, 14); g.lineTo(53, 58); g.lineTo(82, 58); g.closePath(); g.clip();
  for (let i = 0; i < 6; i++) { g.fillStyle = i % 2 ? '#FFFFFF' : '#C8B4FF'; g.fillRect(50, 14 + i * 8, 36, 8); }
  g.restore();
  g.beginPath(); g.moveTo(53, 14); g.lineTo(53, 58); g.lineTo(82, 58); g.closePath(); paint(g, 'rgba(0,0,0,0)');
  g.beginPath(); g.moveTo(47, 22); g.lineTo(47, 56); g.lineTo(24, 56); g.closePath(); paint(g, '#FFE38F');
  // pennant
  g.beginPath(); g.moveTo(50, 12); g.lineTo(62, 15); g.lineTo(50, 18); g.closePath(); paint(g, '#FF5FA2', false);
}

export const VEHICLE_STICKERS = [
  { id: 'beep_beep', name: 'Beep Beep!', hint: 'Drive a car or van', icon: 'star', art: beepArt },
  { id: 'ahoy', name: 'Ahoy!', hint: 'Steer a boat', icon: 'star', art: ahoyArt },
];

/** Register on 'game:ready'; returns award(id) (registers first, never twice). */
export function installVehicleStickers(game) {
  const register = () => {
    const reg = game.registry.stickers;
    for (const s of VEHICLE_STICKERS) if (!reg.has(s.id)) reg.set(s.id, { ...s });
  };
  game.events.on('game:ready', register);
  return (id) => {
    register();
    if (game.stickers && !game.stickers.has(id)) game.award(id);
  };
}
