// Cruise Ship blocks (docs/teams/cruise-world.md §3): the Glimmer Star's own paints and parts.
// 14 blocks, the wave-5 budget (docs/teams/wave5-plan.md §5.1): hull plates in navy-plum and
// white, the pink-and-gold stripe, lit portholes and cabin windows, teak deck planks, a glass
// railing, pool mosaic, a light-up dance floor, the star emblem of the funnels, two water-slide
// plastics, a lifebuoy and a string of party flags. Everything else on the ship reuses the
// block library (quartz, wool, glass, lanterns, sea lanterns...).
//
// All painters are deterministic (only the seeded `rand`), pastel, and follow the kit's
// shading (shadows lean plum, highlights lean white).

import { tone, rgb, natural, sparkle } from './kit.js';

const NAVY = '#4A4489'; // deep navy-plum hull
const PINK = '#FF8DBA';
const GOLD = '#FFC94D';

/** Riveted steel plates: horizontal seams every 8 px, staggered upright seams, rivet dots. */
function plates(p, rand, base, { seam = -0.16, rivet = 0.2, grain = 0.03 } = {}) {
  p.each((x, y) => {
    // a soft vertical sheen, like painted steel catching the sun
    const t = (rand() - 0.5) * grain + Math.sin((x + 3) * 0.4) * 0.015;
    p.set(x, y, tone(base, t));
  });
  for (let row = 0; row < 2; row++) {
    const y0 = row * 8;
    for (let x = 0; x < 16; x++) { p.shade(x, y0 + 7, seam); p.shade(x, y0, 0.06); }
    const cut = row ? 11 : 3;
    for (let y = y0; y < y0 + 7; y++) p.shade(cut, y, seam * 0.8);
    for (let x = 1; x < 16; x += 3) if (x !== cut) p.shade(x, y0 + 5, rivet);
  }
}

/** Smooth painted white for the upper hull and the superstructure. */
function whitePaint(p, rand) {
  natural(p, rand, ['#ECE8F2', '#F2EFF6', '#F7F5FA', '#FCFBFD'], { dither: 0.14, oct: [[2, 0.6], [4, 0.4]] });
  for (let x = 0; x < 16; x++) { p.shade(x, 15, -0.07); p.shade(x, 0, 0.12); }
  for (let y = 0; y < 15; y++) p.shade(7, y, -0.035);
}

/** Glossy slide plastic: a bright body with long white shine streaks and a darker lip. */
function slidePlastic(p, rand, base) {
  p.each((x, y) => {
    const band = Math.sin((x + y * 0.35) * 0.55) * 0.5 + 0.5;
    p.set(x, y, tone(base, -0.08 + band * 0.16 + (rand() - 0.5) * 0.03));
  });
  for (let k = 0; k < 10; k++) { p.blend(2 + k, 3, '#FFFFFF', 0.75); p.blend(3 + k, 4, '#FFFFFF', 0.35); }
  for (let k = 0; k < 5; k++) p.blend(8 + k, 10, '#FFFFFF', 0.55);
  for (let x = 0; x < 16; x++) { p.shade(x, 15, -0.22); p.shade(x, 14, -0.1); p.shade(x, 0, 0.18); }
  sparkle(p, 4, 3, '#FFFFFF', 1);
}

const FLAG_COLORS = ['#FF8DBA', '#FFD45C', '#7FD8F0', '#B79CFF', '#8EE3A9', '#FFA77A'];

const STAR9 = [
  '....X....',
  '....X....',
  '...XXX...',
  'XXXXXXXXX',
  '.XXXXXXX.',
  '..XXXXX..',
  '..XXXXX..',
  '.XXX.XXX.',
  '.X.....X.',
];

export function install(L) {
  const { tile, block } = L;

  // --- lifebuoy (registered first: a Bag tab without a picture shows its first item) ---
  tile('cruise_lifebuoy', (p, r) => {
    whitePaint(p, r);
    p.each((x, y) => {
      const d = Math.hypot(x + 0.5 - 8, y + 0.5 - 8);
      if (d > 6.6 || d < 3.1) return;
      const a = Math.atan2(y + 0.5 - 8, x + 0.5 - 8);
      const seg = Math.floor(((a / (Math.PI * 2)) + 1.0625) * 8) % 2;
      let c = seg ? '#FFFFFF' : '#FF7FAE';
      if (d > 5.9) c = tone(c, -0.18);
      else if (d < 3.8) c = tone(c, -0.1);
      else if (d < 4.6) c = tone(c, 0.12);
      p.set(x, y, c);
    });
    // the rope loops round the outside
    for (const [x, y] of [[1, 5], [1, 10], [14, 5], [14, 10], [5, 1], [10, 1], [5, 14], [10, 14]]) p.set(x, y, '#E8C58A');
    p.set(5, 5, '#FFFFFF');
  });

  // --- hull ---
  tile('cruise_hull', (p, r) => plates(p, r, NAVY, { seam: -0.22, rivet: 0.16 }));
  tile('cruise_white', (p, r) => whitePaint(p, r));
  tile('cruise_stripe', (p, r) => {
    p.each((x, y) => {
      let c;
      if (y < 7) c = tone(PINK, y === 0 ? 0.2 : (r() - 0.5) * 0.05);
      else if (y < 9) c = y === 7 ? '#FFFFFF' : '#FFF3D0';
      else c = tone(GOLD, y === 15 ? -0.2 : (r() - 0.5) * 0.05 + (y === 9 ? 0.15 : 0));
      p.set(x, y, c);
    });
    // little stars ride along the pink band
    p.glyph(['.X.', 'XXX', '.X.'], '#FFF0B8', 2, 2);
    p.glyph(['.X.', 'XXX', '.X.'], '#FFF0B8', 10, 2);
    sparkle(p, 6, 12, '#FFFBEA', 0);
    sparkle(p, 14, 11, '#FFFBEA', 0);
  });
  tile('cruise_porthole', (p, r) => {
    whitePaint(p, r);
    p.each((x, y) => {
      const d = Math.hypot(x + 0.5 - 8, y + 0.5 - 8);
      if (d <= 5.7 && d > 4.2) p.set(x, y, d > 5.1 ? '#C9962E' : x + y < 15 ? '#FFE69A' : '#E8B648');
      else if (d <= 4.2) {
        p.set(x, y, tone('#FFD98A', (1 - d / 4.2) * 0.6));
        if (y > 9) p.blend(x, y, '#FFB37A', 0.35);
      }
    });
    // the round window's shine, and four little bolts on the rim
    p.set(6, 5, '#FFFFFF'); p.set(5, 6, '#FFFFFF'); p.set(6, 6, '#FFFBEA');
    for (const [x, y] of [[8, 2], [8, 13], [2, 8], [13, 8]]) p.set(x, y, '#FFF3C4');
  });
  tile('cruise_window', (p, r) => {
    whitePaint(p, r);
    // a tall rounded window: warm light inside and a peek of pink curtain at each side
    p.each((x, y) => {
      if (x < 2 || x > 13 || y < 2 || y > 13) return;
      if ((x === 2 || x === 13) && (y === 2 || y === 13)) return;
      if (x === 2 || x === 13 || y === 2 || y === 13) { p.set(x, y, '#9AA8D6'); return; }
      const glow = 1 - Math.abs(x - 7.5) / 6;
      let c = tone('#FFD98A', 0.25 + glow * 0.45);
      if (x <= 4 || x >= 11) c = '#FFB3CF';
      if (y === 8 && x > 4 && x < 11) c = tone(c, -0.08);
      p.set(x, y, c);
    });
    for (let y = 3; y < 13; y++) { p.shade(4, y, -0.12); p.shade(11, y, -0.12); }
    p.set(6, 4, '#FFFFFF'); p.set(7, 4, '#FFFBEA'); p.set(6, 5, '#FFFBEA');
  });

  // --- decks ---
  tile('cruise_deck', (p, r) => {
    // long narrow teak boards with dark caulking, the classic ship's deck
    const base = '#E6B887';
    for (let row = 0; row < 4; row++) {
      const y0 = row * 4;
      const cut = (row * 7 + 2 + Math.floor(r() * 3)) % 16;
      const bt = (r() - 0.5) * 0.1;
      for (let y = y0; y < y0 + 4; y++) {
        for (let x = 0; x < 16; x++) {
          let c = tone(base, bt + (r() < 0.14 ? -0.07 : r() < 0.1 ? 0.07 : 0));
          if (y === y0 + 3) c = rgb('#9A7A66');
          else if (y === y0) c = tone(c, 0.1);
          p.set(x, y, c);
        }
      }
      for (let y = y0; y < y0 + 3; y++) p.set(cut, y, '#9A7A66');
      const gx = Math.floor(r() * 16), gy = y0 + 1 + Math.floor(r() * 2);
      for (let k = 0; k < 4; k++) if (((gx + k) & 15) !== cut) p.shade(gx + k, gy, -0.06);
    }
  });
  tile('cruise_rail', (p) => {
    p.clear();
    // clear glass with a soft blue tint, a white handrail along the top and slim posts
    p.fill('#DDF3FF', 70);
    for (let x = 0; x < 16; x++) {
      p.set(x, 0, '#FFFFFF'); p.set(x, 1, '#F2F0F8'); p.set(x, 2, '#C9C3DA');
      p.set(x, 15, '#E6E2EE'); p.set(x, 14, '#FFFFFF', 200);
    }
    for (let y = 2; y < 15; y++) { p.set(0, y, '#F2F0F8'); p.set(15, y, '#D6D0E3'); }
    for (let k = 0; k < 5; k++) p.set(4 + k, 10 - k, '#FFFFFF', 220);
    for (let k = 0; k < 3; k++) p.set(5 + k, 12 - k, '#FFFFFF', 170);
  });
  tile('cruise_pool', (p, r) => {
    // aqua mosaic: little 4 px tiles with white grout, a few deeper blue and bright ones
    p.each((x, y) => {
      if ((x & 3) === 3 || (y & 3) === 3) { p.set(x, y, '#EFFFFD'); return; }
      const cell = (x >> 2) * 5 + (y >> 2) * 3;
      const pick = (cell * 7 + 3) % 9;
      const c = pick === 0 ? '#58C9E0' : pick === 4 ? '#A8F0EE' : pick === 7 ? '#6FD8D2' : '#86E3E6';
      p.set(x, y, tone(c, (r() - 0.5) * 0.04));
      if ((x & 3) === 0 && (y & 3) === 0) p.shade(x, y, 0.3);
    });
  });
  tile('cruise_dance', (p, r) => {
    // four glowing squares (pink, aqua, sun, lilac): a floor of them is a bright checker
    const cols = ['#FF9CCB', '#8FE6F0', '#FFE27A', '#C4A6FF'];
    p.each((x, y) => {
      const c = cols[(x >> 3) + (y >> 3) * 2];
      const lx = x & 7, ly = y & 7;
      const d = Math.max(Math.abs(lx - 3.5), Math.abs(ly - 3.5));
      let col = d > 3 ? tone(c, -0.25) : d > 2.2 ? c : tone(c, 0.45 - d * 0.1);
      if (lx + ly < 2) col = tone(c, 0.6);
      p.set(x, y, col);
      if (r() < 0.03 && d <= 2.2) p.set(x, y, '#FFFFFF');
    });
  });

  // --- the funnels' star ---
  tile('cruise_emblem', (p, r) => {
    p.each((x, y) => p.set(x, y, tone(PINK, (r() - 0.5) * 0.04 + (y < 2 ? 0.12 : y > 13 ? -0.12 : 0))));
    p.each((x, y) => {
      if (Math.abs(Math.hypot(x + 0.5 - 8, y + 0.5 - 8) - 6.3) < 0.7) p.set(x, y, '#FFFFFF');
    });
    for (let ry = 0; ry < STAR9.length; ry++) {
      for (let cx = 0; cx < 9; cx++) {
        if (STAR9[ry][cx] !== 'X') continue;
        const edge = STAR9[ry][cx - 1] !== 'X' || STAR9[ry - 1]?.[cx] !== 'X';
        p.set(4 + cx, 3 + ry, edge ? '#FFF2B0' : ry > 5 ? '#F2B53A' : GOLD);
      }
    }
    sparkle(p, 2, 2, '#FFFFFF', 0);
    sparkle(p, 13, 13, '#FFFFFF', 0);
  });

  // --- water slides ---
  tile('cruise_slide', (p, r) => slidePlastic(p, r, '#5FD3E6'));
  tile('cruise_slide_pink', (p, r) => slidePlastic(p, r, '#FF8DC0'));

  // --- party flags (a sprite: two strings of little pennants) ---
  const PENNANT = ['XXX', 'XXX', 'XXX', '.X.', '.X.'];
  tile('cruise_flags', (p) => {
    p.clear();
    const sag = (x) => Math.round(1 + Math.sin((x / 15) * Math.PI) * 1.6);
    for (let line = 0; line < 2; line++) {
      const dy = line * 8, shift = line * 2;
      for (let x = 0; x < 16; x++) p.set(x, sag(x) + dy, '#8C7AA3');
      for (let k = 0; k < 4; k++) {
        const x0 = k * 4 + shift, c = rgb(FLAG_COLORS[(k + line * 3) % FLAG_COLORS.length]);
        const top = sag((x0 + 1) & 15) + dy + 1;
        PENNANT.forEach((row, ry) => {
          for (let x = 0; x < row.length; x++) {
            if (row[x] !== 'X' || top + ry > 15) continue;
            p.set((x0 + x) & 15, top + ry, ry === 0 ? tone(c, 0.22) : x === 2 ? tone(c, -0.1) : c);
          }
        });
      }
    }
  });

  const cat = { category: 'cruise' };
  const white = { top: 'cruise_white', bottom: 'cruise_white' };
  block({ key: 'cruise_lifebuoy', name: 'Lifebuoy', ...cat, tiles: { ...white, side: 'cruise_lifebuoy' } });
  block({ key: 'cruise_hull', name: 'Ship Hull', ...cat, sound: 'chime' });
  block({ key: 'cruise_white', name: 'Ship White', ...cat, sound: 'chime' });
  block({ key: 'cruise_stripe', name: 'Ship Stripe', ...cat, tiles: { ...white, side: 'cruise_stripe' }, sound: 'chime' });
  block({ key: 'cruise_porthole', name: 'Porthole', ...cat, light: 9, tiles: { ...white, side: 'cruise_porthole' }, sound: 'chime' });
  block({ key: 'cruise_window', name: 'Cabin Window', ...cat, light: 8, tiles: { ...white, side: 'cruise_window' }, sound: 'chime' });
  block({ key: 'cruise_deck', name: 'Ship Deck', ...cat });
  block({ key: 'cruise_rail', name: 'Glass Railing', ...cat, transparent: true, sound: 'chime' });
  block({ key: 'cruise_pool', name: 'Pool Tiles', ...cat });
  block({ key: 'cruise_dance', name: 'Dance Floor', ...cat, light: 12, sound: 'chime' });
  block({ key: 'cruise_emblem', name: 'Star Emblem', ...cat, light: 10, sound: 'chime' });
  block({ key: 'cruise_slide', name: 'Aqua Slide', ...cat, sound: 'pop' });
  block({ key: 'cruise_slide_pink', name: 'Pink Slide', ...cat, sound: 'pop' });
  block({ key: 'cruise_flags', name: 'Party Flags', ...cat, shape: 'cross', sound: 'pop' });
}
