// Fun & toys: rainbow, clouds, glitter, jelly, gems, gold, presents, toy blocks, a snowman
// head and a music block that plays a note when tapped with the Hand.

import { tone, ramp, natural, sparkle, inCircle, rgb } from './kit.js';

export const RAINBOW = ['#FF8C9E', '#FFB578', '#FFE278', '#9EE58E', '#7ED3F2', '#8FA8FF', '#BE98FF', '#FF9FDB'];

const GLITTER = [
  ['glitter_pink', '#FF9CC8', 'Pink Glitter'],
  ['glitter_gold', '#FFD66B', 'Gold Glitter'],
  ['glitter_blue', '#8CC8FF', 'Blue Glitter'],
  ['glitter_purple', '#BC9BFF', 'Purple Glitter'],
];
const JELLY = [
  ['jelly_pink', '#FF8CC0', 'Pink Jelly'],
  ['jelly_blue', '#7FC2FF', 'Blue Jelly'],
  ['jelly_green', '#86E39A', 'Green Jelly'],
  ['jelly_purple', '#B58CFF', 'Purple Jelly'],
];
const GEMS = [
  ['gem_pink', '#FF78B4', 'Pink Gem Block'],
  ['gem_blue', '#66B3FF', 'Blue Gem Block'],
  ['gem_purple', '#A67CFF', 'Purple Gem Block'],
];

const LETTER_A = [
  '..XXXX..',
  '.XXddXX.',
  'XXd..dXX',
  'XX....XX',
  'XXXXXXXX',
  'XXddddXX',
  'XX....XX',
  'dd....dd',
];
const NOTE = ['...XX', '...XX', '...X.', '...X.', '...X.', '.XXX.', 'XXXX.', '.XX..'];

function gem(p, rand, base) {
  const c = rgb(base);
  p.fill(tone(c, -0.22));
  // brilliant cut: octagon table, star facets and a girdle
  p.each((x, y) => {
    const dx = x + 0.5 - 8, dy = y + 0.5 - 8;
    const oct = Math.max(Math.abs(dx), Math.abs(dy), (Math.abs(dx) + Math.abs(dy)) * 0.72);
    let t;
    if (oct < 3.4) t = 0.3;
    else if (oct < 6.2) {
      const a = Math.atan2(dy, dx);
      const s = Math.floor(((a / (Math.PI * 2)) + 1) * 8) % 2;
      t = (s ? 0.1 : -0.04) + (dy < 0 ? 0.06 : -0.06);
    } else if (oct < 7.1) t = -0.05;
    else t = -0.25;
    p.set(x, y, tone(c, t));
  });
  sparkle(p, 6, 6, '#FFFFFF', 1);
  p.set(10, 5, '#FFFFFF');
  p.set(4, 11, tone(c, 0.4));
}

export function install(L) {
  const { tile, block } = L;
  const fun = { category: 'fun', sound: 'pop' };

  tile('rainbow', (p) => {
    p.each((x, y) => {
      const b = RAINBOW[y >> 1];
      p.set(x, y, (y & 1) === 0 ? tone(b, 0.12) : b);
    });
    for (let x = 0; x < 16; x += 5) p.blend(x + 1, (x >> 1) + 1, '#FFFFFF', 0.7);
  });
  tile('cloud', (p, r) => {
    natural(p, r, ['#E3EAF8', '#ECF1FB', '#F4F7FD', '#FBFCFF', '#FFFFFF'], { oct: [[2, 0.6], [4, 0.4]], dither: 0.15 });
    p.pillow(0.08);
  });
  for (const [key, color] of GLITTER) {
    tile(key, (p, r) => {
      natural(p, r, ramp(color, [-0.12, -0.04, 0.04, 0.12]), { dither: 0.8, oct: [[4, 0.5], [8, 0.5]] });
      for (let i = 0; i < 22; i++) p.blend(Math.floor(r() * 16), Math.floor(r() * 16), '#FFFFFF', 0.5 + r() * 0.5);
      for (let i = 0; i < 3; i++) sparkle(p, Math.floor(r() * 16), Math.floor(r() * 16), '#FFFFFF', 1);
    });
  }
  for (const [key, color] of JELLY) {
    tile(key, (p, r) => {
      const c = rgb(color);
      p.each((x, y) => {
        const edge = Math.min(x, y, 15 - x, 15 - y);
        const a = edge === 0 ? 235 : 170;
        const t = edge === 0 ? -0.16 : edge === 1 ? 0.12 : (r() - 0.5) * 0.04;
        p.set(x, y, tone(c, t), a);
      });
      for (const [x, y] of [[3, 3], [4, 3], [5, 3], [3, 4], [3, 5], [4, 4]]) p.set(x, y, tone(c, 0.65), 225);
      for (const [x, y, rr] of [[10, 10, 1.2], [12, 6, 0.8], [6, 12, 0.8]]) {
        p.each((xx, yy) => { if (inCircle(xx, yy, x, y, rr)) p.set(xx, yy, tone(c, 0.4), 200); });
      }
    });
  }
  for (const [key, color] of GEMS) tile(key, (p, r) => gem(p, r, color));
  tile('gold_block', (p, r) => {
    natural(p, r, ['#F5C542', '#FAD158', '#FDDC6E', '#FFE588'], { dither: 0.25 });
    p.bevel(0.35, -0.22, 2);
    for (let k = 0; k < 6; k++) p.blend(4 + k, 9 - k, '#FFF6CC', 0.7);
    for (let k = 0; k < 3; k++) p.blend(9 + k, 12 - k, '#FFF6CC', 0.6);
  });
  tile('gift_side', (p, r) => {
    p.fill('#FF9CC6');
    for (let gy = 0; gy < 16; gy += 4) for (let gx = (gy & 4) ? 2 : 0; gx < 16; gx += 4) p.set(gx, gy + 1, '#FFD9EA');
    for (let y = 0; y < 16; y++) { p.set(6, y, '#FFE59A'); p.set(7, y, '#FFF3C4'); p.set(8, y, '#FFE59A'); p.set(9, y, '#F2C95E'); }
    for (let x = 0; x < 16; x++) { p.set(x, 0, '#FFB3D2'); p.set(x, 15, '#E97FAF'); }
  });
  tile('gift_top', (p, r) => {
    p.fill('#FF9CC6');
    for (let gy = 0; gy < 16; gy += 4) for (let gx = (gy & 4) ? 2 : 0; gx < 16; gx += 4) p.set(gx, gy + 1, '#FFD9EA');
    for (let t = 0; t < 16; t++) { p.set(6, t, '#FFE59A'); p.set(7, t, '#FFF3C4'); p.set(8, t, '#FFE59A'); p.set(9, t, '#F2C95E'); }
    for (let t = 0; t < 16; t++) { p.set(t, 6, '#FFE59A'); p.set(t, 7, '#FFF3C4'); p.set(t, 8, '#FFE59A'); p.set(t, 9, '#F2C95E'); }
    // bow loops
    const bow = ['.XXX....XXX.', 'XXXXX..XXXXX', 'XXX.XXXX.XXX', 'XXXXX..XXXXX', '.XXX....XXX.'];
    p.glyph(bow, '#FFD65C', 2, 5);
    p.glyph(['XX', 'XX'], '#FFF3C4', 7, 6);
    p.set(3, 5, '#FFF3C4'); p.set(10, 5, '#FFF3C4');
  });
  tile('toy_block_side', (p) => {
    p.fill('#FFF7EA');
    for (let t = 0; t < 16; t++) { p.set(t, 0, '#8FC3FF'); p.set(0, t, '#8FC3FF'); p.set(t, 15, '#6FA6EE'); p.set(15, t, '#6FA6EE'); p.set(t, 1, '#B3D7FF'); p.set(1, t, '#B3D7FF'); p.set(t, 14, '#8FC3FF'); p.set(14, t, '#8FC3FF'); }
    p.art(LETTER_A, { X: '#FF6FA6', d: '#E0508A' }, 4, 4);
  });
  tile('toy_block_top', (p) => {
    p.fill('#FFF7EA');
    for (let t = 0; t < 16; t++) { p.set(t, 0, '#FFD66B'); p.set(0, t, '#FFD66B'); p.set(t, 15, '#EDB84A'); p.set(15, t, '#EDB84A'); p.set(t, 1, '#FFE69A'); p.set(1, t, '#FFE69A'); p.set(t, 14, '#FFD66B'); p.set(14, t, '#FFD66B'); }
    const S = ['....X....', '...XXX...', 'XXXXXXXXX', '.XXXXXXX.', '..XXXXX..', '.XXX.XXX.', '.XX...XX.'];
    p.glyph(S, '#8FD8A8', 4, 4);
  });
  tile('snowman_face', (p, r) => {
    natural(p, r, ['#EAF1FB', '#F2F6FD', '#F9FBFF', '#FFFFFF'], { dither: 0.3 });
    // eyes
    for (const ex of [4, 10]) { p.rect(ex, 5, 2, 2, '#4A3E5C'); p.set(ex, 5, '#8E82A6'); }
    // rosy cheeks
    p.set(3, 8, '#FFB3C7'); p.set(4, 8, '#FFC7D6'); p.set(12, 8, '#FFB3C7'); p.set(11, 8, '#FFC7D6');
    // carrot nose
    p.set(7, 8, '#FF9A3D'); p.set(8, 8, '#FF9A3D'); p.set(7, 9, '#F28A2E'); p.set(8, 9, '#FFB36B'); p.set(9, 9, '#FFB36B');
    // smile
    for (const [x, y] of [[4, 11], [6, 12], [8, 12], [10, 12], [12, 11]]) p.set(x, y, '#5A4E6C');
  });
  tile('music_block', (p, r) => {
    p.fill('#C8B2FF');
    p.each((x, y) => { if ((x + y) % 7 === 0) p.set(x, y, '#D3C0FF'); });
    p.bevel(0.3, -0.22, 2);
    p.glyph(NOTE, '#FFFFFF', 5, 4);
    p.glyph(['X'], '#FFE3F2', 8, 4);
  });
  tile('music_block_top', (p) => {
    p.fill('#C8B2FF');
    p.bevel(0.3, -0.22, 2);
    p.each((x, y) => {
      const d = Math.hypot(x + 0.5 - 8, y + 0.5 - 8);
      if (d < 5) p.set(x, y, Math.floor(d) % 2 ? '#A994F0' : '#B8A4F8');
      if (d < 1.5) p.set(x, y, '#FFFFFF');
    });
  });

  block({ key: 'rainbow', name: 'Rainbow', ...fun, sound: 'sparkle' });
  block({ key: 'cloud', name: 'Cloud', ...fun });
  for (const [key, , name] of GLITTER) block({ key, name, ...fun, sound: 'sparkle' });
  for (const [key, , name] of JELLY) block({ key, name, ...fun, translucent: true, lightOpacity: 1 });
  for (const [key, , name] of GEMS) block({ key, name, ...fun, sound: 'chime' });
  block({ key: 'gold_block', name: 'Gold Block', ...fun, sound: 'chime' });
  block({ key: 'gift', name: 'Present', ...fun, tiles: { top: 'gift_top', side: 'gift_side', bottom: 'gift_side' } });
  block({ key: 'toy_block', name: 'Toy Block', ...fun, tiles: { top: 'toy_block_top', side: 'toy_block_side', bottom: 'toy_block_top' } });
  block({ key: 'snowman_head', name: 'Snowman Head', ...fun, tiles: { top: 'snow', sides: 'snow', bottom: 'snow', front: 'snowman_face' } });
  const notes = [60, 62, 64, 65, 67, 69, 71, 72, 74, 76];
  let noteIx = 0;
  block({
    key: 'music_block', name: 'Music Block', ...fun, tiles: { top: 'music_block_top', side: 'music_block', bottom: 'music_block_top' },
    hint: 'Tap to play a note',
    onUse(game, hit) {
      // a happy little walk up and down the scale
      const note = notes[noteIx % notes.length];
      noteIx = (noteIx + 1 + Math.floor(Math.random() * 2)) % notes.length;
      game.audio.play('note:' + note);
      if (game.particles) game.particles.emit('note', { x: hit.x + 0.5, y: hit.y + 1.2, z: hit.z + 0.5 }, { count: 3 });
      game.events.emit('piano:note', { note, source: 'music_block' });
      return true;
    },
  });
}
