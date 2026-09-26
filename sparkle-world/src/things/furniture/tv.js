// TV shows: three cute procedural cartoon channels drawn on a small per-TV canvas.
//   1 Bunny Hop  - bunnies hopping over hills under a smiling sun
//   2 Rainbow Fish - rainbow fish, bubbles and waving seaweed
//   3 Star Dance - smiling stars dancing with the moon

export const CHANNELS = ['Off', 'Bunny Hop', 'Rainbow Fish', 'Star Dance'];
export const TV_W = 128;
export const TV_H = 72;

function face(ctx, x, y, s, color = '#3A1F4D') {
  ctx.fillStyle = color;
  ctx.fillRect(x - 3 * s, y - s, s * 1.4, s * 1.6);
  ctx.fillRect(x + 1.6 * s, y - s, s * 1.4, s * 1.6);
  ctx.fillRect(x - 1.5 * s, y + 1.6 * s, 3 * s, s * 0.8);
  ctx.fillStyle = 'rgba(255,120,160,0.7)';
  ctx.fillRect(x - 4.4 * s, y + 0.8 * s, 1.6 * s, s);
  ctx.fillRect(x + 2.8 * s, y + 0.8 * s, 1.6 * s, s);
}

function starPath(ctx, x, y, R, r, rot = 0) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + rot + (i / 10) * Math.PI * 2;
    const rad = i % 2 === 0 ? R : r;
    ctx.lineTo(x + Math.cos(a) * rad, y + Math.sin(a) * rad);
  }
  ctx.closePath();
}

function bunny(ctx, x, y, t, fur = '#FFFFFF') {
  const hop = Math.abs(Math.sin(t * 4)) * 10;
  const by = y - hop;
  ctx.fillStyle = fur;
  ctx.beginPath();
  ctx.ellipse(x, by, 8, 6.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x + 7, by - 5, 5.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(x + 3.5, by - 17, 2.6, 9);
  ctx.fillRect(x + 7.5, by - 18, 2.6, 10);
  ctx.fillStyle = '#FFB8D6';
  ctx.fillRect(x + 4.1, by - 15, 1.4, 6);
  ctx.fillRect(x + 8.1, by - 16, 1.4, 7);
  ctx.beginPath();
  ctx.arc(x - 8, by - 1, 2.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#3A1F4D';
  ctx.fillRect(x + 8, by - 7, 1.6, 2);
  ctx.fillStyle = '#FF7FA4';
  ctx.fillRect(x + 11, by - 4.5, 1.6, 1.4);
}

function fish(ctx, x, y, s, dir, t) {
  const bands = ['#FF8FA3', '#FFB870', '#FFE070', '#9BE38A', '#7CC8FF', '#B79BFF'];
  ctx.save();
  ctx.translate(x, y + Math.sin(t * 3 + x) * 2);
  ctx.scale(dir * s, s);
  ctx.beginPath();
  ctx.moveTo(-10, 0);
  ctx.lineTo(-16, -6 - Math.sin(t * 8) * 1.5);
  ctx.lineTo(-16, 6 + Math.sin(t * 8) * 1.5);
  ctx.closePath();
  ctx.fillStyle = '#FF8FB8';
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(0, 0, 11, 7, 0, 0, Math.PI * 2);
  ctx.save();
  ctx.clip();
  bands.forEach((c, i) => {
    ctx.fillStyle = c;
    ctx.fillRect(-11 + i * 3.8, -8, 3.9, 16);
  });
  ctx.restore();
  ctx.fillStyle = '#FFFFFF';
  ctx.beginPath();
  ctx.arc(5, -2, 2.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#3A1F4D';
  ctx.beginPath();
  ctx.arc(5.6, -2, 1.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** Draw channel ch (1..3) at time t seconds. label: show the show's name for a moment. */
export function drawChannel(ctx, ch, t, showLabel = false) {
  const W = TV_W, H = TV_H;
  if (ch === 1) {
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#8FD3FF');
    sky.addColorStop(1, '#E6F7FF');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);
    // sun with a smile
    ctx.fillStyle = '#FFE070';
    ctx.beginPath();
    ctx.arc(106, 15, 9, 0, Math.PI * 2);
    ctx.fill();
    for (let i = 0; i < 8; i++) {
      const a = t * 0.8 + (i / 8) * Math.PI * 2;
      ctx.fillRect(106 + Math.cos(a) * 12 - 1.5, 15 + Math.sin(a) * 12 - 1.5, 3, 3);
    }
    face(ctx, 106, 14, 1.2);
    // drifting clouds
    ctx.fillStyle = '#FFFFFF';
    for (let i = 0; i < 3; i++) {
      const cx = ((t * 6 + i * 50) % (W + 40)) - 20;
      const cy = 10 + i * 7;
      ctx.beginPath();
      ctx.arc(cx, cy, 5, 0, Math.PI * 2);
      ctx.arc(cx + 6, cy - 2, 6, 0, Math.PI * 2);
      ctx.arc(cx + 12, cy, 5, 0, Math.PI * 2);
      ctx.fill();
    }
    // hills
    ctx.fillStyle = '#A8E68F';
    ctx.beginPath();
    ctx.ellipse(30, H + 10, 60, 30, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#8FDB7E';
    ctx.beginPath();
    ctx.ellipse(100, H + 14, 60, 30, 0, 0, Math.PI * 2);
    ctx.fill();
    // flowers
    for (let i = 0; i < 7; i++) {
      const fx = 8 + i * 18, fy = 60 + (i % 2) * 5;
      ctx.fillStyle = ['#FF8FB8', '#FFFFFF', '#C8A6FF', '#FFE070'][i % 4];
      ctx.fillRect(fx - 2, fy - 2, 4, 4);
      ctx.fillStyle = '#FFE070';
      ctx.fillRect(fx - 0.8, fy - 0.8, 1.6, 1.6);
    }
    // carrots
    for (const cx of [44, 88]) {
      ctx.fillStyle = '#FFA54F';
      ctx.beginPath();
      ctx.moveTo(cx - 3, 54);
      ctx.lineTo(cx + 3, 54);
      ctx.lineTo(cx, 64);
      ctx.fill();
      ctx.fillStyle = '#6CC468';
      ctx.fillRect(cx - 2, 50, 1.5, 4);
      ctx.fillRect(cx + 0.5, 49, 1.5, 5);
    }
    const x1 = ((t * 22) % (W + 40)) - 20;
    bunny(ctx, x1, 52, t);
    bunny(ctx, ((t * 22 + 64) % (W + 40)) - 20, 56, t + 0.4, '#FFE3F0');
  } else if (ch === 2) {
    const sea = ctx.createLinearGradient(0, 0, 0, H);
    sea.addColorStop(0, '#7FD3F7');
    sea.addColorStop(1, '#3E8FD6');
    ctx.fillStyle = sea;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    for (let i = 0; i < 4; i++) ctx.fillRect(((i * 37 + t * 8) % (W + 20)) - 10, 4 + i * 3, 18, 2);
    // sand + seaweed + starfish
    ctx.fillStyle = '#FFE9B0';
    ctx.fillRect(0, H - 8, W, 8);
    for (let i = 0; i < 6; i++) {
      const sx = 10 + i * 22;
      ctx.fillStyle = i % 2 ? '#6CC468' : '#4FA84F';
      for (let j = 0; j < 6; j++) ctx.fillRect(sx + Math.sin(t * 2 + j * 0.8 + i) * 2.5, H - 10 - j * 4, 3, 5);
    }
    ctx.fillStyle = '#FF9EB8';
    starPath(ctx, 64, H - 7, 6, 3, Math.sin(t) * 0.2);
    ctx.fill();
    face(ctx, 64, H - 8, 0.6);
    // bubbles
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 9; i++) {
      const bx = (i * 29) % W + Math.sin(t * 2 + i) * 3;
      const by = H - ((t * 14 + i * 23) % (H + 10));
      ctx.beginPath();
      ctx.arc(bx, by, 1.5 + (i % 3), 0, Math.PI * 2);
      ctx.stroke();
    }
    fish(ctx, ((t * 18) % (W + 50)) - 25, 26, 1.1, 1, t);
    fish(ctx, W + 25 - ((t * 13 + 60) % (W + 50)), 44, 0.8, -1, t + 1);
    fish(ctx, ((t * 10 + 90) % (W + 50)) - 25, 14, 0.6, 1, t + 2);
  } else if (ch === 3) {
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#2A2766');
    sky.addColorStop(1, '#6B4FA8');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < 26; i++) {
      const tw = 0.5 + 0.5 * Math.sin(t * 3 + i * 1.7);
      ctx.fillStyle = `rgba(255,246,216,${0.3 + tw * 0.7})`;
      ctx.fillRect((i * 47) % W, (i * 23) % (H - 10), 1.5, 1.5);
    }
    // smiling moon
    ctx.fillStyle = '#FFF4B8';
    ctx.beginPath();
    ctx.arc(20, 18, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#2E2A6E';
    ctx.beginPath();
    ctx.arc(25, 15, 9, 0, Math.PI * 2);
    ctx.fill();
    // dancing stars
    const cols = ['#FFE070', '#FF9CCB', '#9FE0FF'];
    for (let i = 0; i < 3; i++) {
      const beat = t * 3 + i * 2.1;
      const x = 46 + i * 30 + Math.sin(beat * 0.5) * 4;
      const y = 44 - Math.abs(Math.sin(beat)) * 12;
      ctx.fillStyle = cols[i];
      starPath(ctx, x, y, 11, 5, Math.sin(beat) * 0.3);
      ctx.fill();
      face(ctx, x, y, 0.8);
    }
    // floating notes
    ctx.fillStyle = '#FFFFFF';
    for (let i = 0; i < 4; i++) {
      const nx = (i * 33 + t * 12) % W;
      const ny = 62 - ((t * 10 + i * 15) % 50);
      ctx.fillRect(nx, ny, 1.5, 6);
      ctx.beginPath();
      ctx.arc(nx - 1, ny + 6, 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#9BE8CF';
    ctx.fillRect(0, H - 5, W, 5);
  }
  if (showLabel && ch > 0) {
    const text = CHANNELS[ch] + '!';
    ctx.font = 'bold 11px sans-serif';
    const w = ctx.measureText(text).width + 12;
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.fillRect(4, 4, w, 15);
    ctx.fillStyle = '#FF5FA2';
    ctx.fillText(text, 10, 15);
  }
}
