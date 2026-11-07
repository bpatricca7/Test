// Body and clothes: head, face planes, neck, hands, torso, arms with sleeves, legs, skirts /
// dresses (deformable flares), and shoes. Everything is authored in avatar space; P (the
// build context from avatar.js) routes each piece to the bone and material it belongs to.

import { shade, mixHex, hexToRgb } from '../../core/util.js';

const WHITE = '#FFFFFF';
const GOLD = '#FFD54A';

const FABRIC = {
  top: { sweater: 'knit', sparkle_top: 'sparkle', santa_coat: 'velvet', holiday_sweater: 'knit' },
  bottom: { jeans: 'denim', overalls: 'denim', tutu: 'tulle', joggers: 'knit', santa_pants: 'velvet' },
  dress: { princess: 'satin', ballgown: 'satin', party: 'satin', mermaid: 'sparkle', overall_dress: 'denim', santa_dress: 'velvet' },
};
// wave 5 holiday clothes (docs/teams/holiday-looks.md): soft white fur trim, a black belt with a
// gold buckle, jingle bells
const FUR = '#FFFDF7';
const FUR_SHADE = '#F1ECE6';
const BELT = '#2B2233';
const STOCKING = '#E5383B';

const SLEEVES = {
  tshirt: 'short', tank: 'none', hoodie: 'long', sweater: 'long', blouse: 'puffy', crop: 'short', jacket: 'long',
  sparkle_top: 'cap', sundress: 'none', party: 'puffy', princess: 'puffy', ballgown: 'offpuff',
  overall_dress: 'tee', mermaid: 'none',
  polo: 'short', jersey: 'short', button_up: 'long', tee_dino: 'short', tee_rocket: 'short', tee_bolt: 'short',
  santa_coat: 'long', elf_tunic: 'long', holiday_sweater: 'long', santa_dress: 'long', elf_dress: 'puffy', // wave 5
};

const PANTS = new Set(['jeans', 'leggings', 'overalls', 'joggers', 'pants', 'santa_pants', 'holiday_tights']);
const LONG_TOPS = new Set(['hoodie', 'sweater', 'jacket', 'button_up', 'holiday_sweater']);
// tops and dresses with white fur cuffs at the wrists, and the ones with a holiday belt
const FUR_CUFFS = new Set(['santa_coat', 'santa_dress']);
const BUTTONED = new Set(['jeans', 'shorts', 'overalls', 'cargo_shorts', 'pants']);

// Pixel pictures on a shirt front: one string per row (top first), one character per pixel,
// '.' = no pixel. Colors come from the palette passed to pixelDecal.
const DECALS = {
  tee_dino: {
    rows: [
      '........GGGG.',
      '.......GGKGGG',
      '.......GGGGGG',
      '..S.S..GGG...',
      '.SGSGSGGGG...',
      'GGGGGGGGGG...',
      '..GGLLLLGG...',
      '...GLLLGG....',
      '...GG..GG....',
      '...GG..GG....',
    ],
    palette: { G: '#6BD68A', L: '#B8F2A0', K: '#3B2230', S: '#FFA94D' },
  },
  tee_rocket: {
    rows: [
      '....R....',
      '...RRR...',
      '...WWW...',
      '..WWWWW..',
      '..WBBBW..',
      '..WBBBW..',
      '..WWWWW..',
      '..WWWWW..',
      '.RWWWWWR.',
      'RRWWWWWRR',
      'RR.WWW.RR',
      '...Y.Y...',
      '..Y.Y.Y..',
      '...Y.Y...',
    ],
    palette: { W: '#FFFFFF', R: '#FF6B6B', B: '#6CC6FF', Y: '#FFD43B' }, // a sparkle puff, no flames
  },
  tee_bolt: {
    rows: [
      '...OYYO',
      '..OYYO.',
      '..OYYO.',
      '.OYYO..',
      '.OYYYYO',
      'OYYYYO.',
      '...OYO.',
      '..OYO..',
      '..OYO..',
      '.OYO...',
      '.OO....',
      'O......',
    ],
    palette: { Y: '#FFD43B', O: '#FFA94D' },
  },
  // wave 5: the holiday sweater's knitted tree (front) and snowflake (back)
  holiday_tree: {
    rows: [
      '....S....',
      '...SSS...',
      '....T....',
      '...TTT...',
      '..TPTTT..',
      '...TTT...',
      '..TTTBT..',
      '.TTTTTTT.',
      '..TBTTT..',
      '.TTTTTPT.',
      'TTPTTTTTT',
      '....K....',
      '....K....',
    ],
    palette: { S: '#FFD43B', T: '#2FA84F', P: '#FF5FA2', B: '#6CC6FF', K: '#8B5E3C' },
  },
  holiday_flake: {
    rows: [
      '...W...',
      '.W.W.W.',
      '..WWW..',
      'WWWWWWW',
      '..WWW..',
      '.W.W.W.',
      '...W...',
    ],
    palette: { W: '#FFFFFF' },
  },
};

// A 3x5 pixel font for jersey numbers.
const DIGITS = [
  ['###', '#.#', '#.#', '#.#', '###'], ['.#.', '##.', '.#.', '.#.', '###'], ['###', '..#', '###', '#..', '###'],
  ['###', '..#', '.##', '..#', '###'], ['#.#', '#.#', '###', '..#', '..#'], ['###', '#..', '###', '..#', '###'],
  ['###', '#..', '###', '#.#', '###'], ['###', '..#', '.#.', '.#.', '.#.'], ['###', '#.#', '###', '#.#', '###'],
  ['###', '#.#', '###', '..#', '###'],
];

// ---------- body ----------

export function buildBody(P) {
  const skin = P.skin;
  const head = P.B('head', 'plain');
  head.cbox(-0.31, 1.13, -0.27, 0.31, 1.71, 0.27, 0.06, skin);
  for (const s of [-1, 1]) head.cbox(s * 0.296, 1.32, -0.02, s * 0.33, 1.42, 0.06, 0.012, skin);
  // face: big eyes (+ brows, blush, freckles) and a mouth, painted on transparent planes
  const z = 0.2735;
  P.B('head', 'eyes').quad([-0.25, 1.235, z], [0.25, 1.235, z], [0.25, 1.485, z], [-0.25, 1.485, z], WHITE);
  P.B('head', 'mouth').quad([-0.055, 1.195, z + 0.001], [0.055, 1.195, z + 0.001], [0.055, 1.25, z + 0.001], [-0.055, 1.25, z + 0.001], WHITE);
  // a tiny nose highlight
  head.box(-0.012, 1.27, 0.269, 0.012, 1.285, 0.276, shade(skin, -0.12));
  P.B('torso', 'plain').box(-0.07, 1.04, -0.065, 0.07, 1.16, 0.06, shade(skin, -0.05));
  P.B('elbowL', 'plain').ccube(0.275, 0.61, 0.005, 0.125, 0.12, 0.13, 0.035, skin);
  P.B('elbowR', 'plain').ccube(-0.275, 0.61, 0.005, 0.125, 0.12, 0.13, 0.035, skin);
}

// ---------- clothes ----------

export function buildOutfit(P) {
  const L = P.look;
  const skin = P.skin;
  const dress = L.dress;
  const topType = dress ? dress.type : L.top.type;
  const topSrc = dress || L.top;
  const topFabric = (dress ? FABRIC.dress[dress.type] : FABRIC.top[L.top.type]) || 'cotton';
  const topSpec = { color: topSrc.color, pattern: topSrc.pattern, patternColor: topSrc.patternColor, fabric: topFabric };
  const topMat = P.cloth(topSpec);
  const topC = topSrc.color;
  const trim = shade(topC, -0.14);
  const trimLight = mixHex(topC, WHITE, 0.55);
  const bottomType = dress ? null : L.bottom.type;
  const bottomSrc = dress || L.bottom;
  const bottomFabric = (dress ? FABRIC.dress[dress.type] : FABRIC.bottom[L.bottom.type]) || 'cotton';
  const bottomSpec = { color: bottomSrc.color, pattern: bottomSrc.pattern, patternColor: bottomSrc.patternColor, fabric: bottomFabric };
  const bottomMat = P.cloth(bottomSpec);
  const bottomC = bottomSrc.color;

  const T = P.B('torso', topMat);
  const TP = P.B('torso', 'plain');

  // ----- chest -----
  if (topType === 'overall_dress') {
    // white tee under a pinafore bib
    TP.cbox(-0.21, 0.745, -0.12, 0.21, 1.085, 0.12, 0.035, WHITE);
    TP.box(-0.085, 1.07, -0.075, 0.085, 1.1, 0.075, '#F1ECF7');
    const bib = P.B('torso', bottomMat);
    bib.box(-0.15, 0.745, 0.118, 0.15, 0.99, 0.136, WHITE);
    for (const s of [-1, 1]) {
      bib.box(s * 0.07, 0.98, 0.118, s * 0.125, 1.088, 0.136, WHITE);
      bib.box(s * 0.07, 1.075, -0.132, s * 0.125, 1.094, 0.136, WHITE);
      bib.box(s * 0.07, 0.8, -0.136, s * 0.125, 1.09, -0.118, WHITE);
      TP.cube(s * 0.097, 0.975, 0.14, 0.035, 0.035, 0.012, GOLD);
    }
    TP.box(-0.06, 0.8, 0.135, 0.06, 0.88, 0.142, shade(bottomC, -0.12));
  } else if (topType === 'crop') {
    T.cbox(-0.21, 0.85, -0.12, 0.21, 1.085, 0.12, 0.03, WHITE);
    TP.box(-0.195, 0.745, -0.11, 0.195, 0.86, 0.11, skin);
    TP.box(-0.212, 0.845, -0.122, 0.212, 0.87, 0.122, trim);
  } else {
    T.cbox(-0.21, 0.745, -0.12, 0.21, 1.085, 0.12, 0.035, WHITE);
  }
  if (LONG_TOPS.has(topType)) {
    T.cbox(-0.216, 0.69, -0.126, 0.216, 0.8, 0.126, 0.02, WHITE);
    TP.box(-0.219, 0.685, -0.129, 0.219, 0.72, 0.129, trim);
  }
  // necklines & details
  const crew = () => TP.box(-0.088, 1.07, -0.078, 0.088, 1.1, 0.078, trim);
  const scoop = (w = 0.1, d = 0.06) => {
    TP.box(-w, 1.02, 0.118, w, 1.087, 0.127, skin);
    TP.box(-w * 0.6, 1.02 - d * 0.5, 0.118, w * 0.6, 1.03, 0.127, skin);
  };
  switch (topType) {
    case 'tshirt':
      crew();
      if (topSrc.pattern === 'none') heartDecal(TP, 0, 0.93, 0.121, topSrc.patternColor === topC ? WHITE : topSrc.patternColor);
      break;
    case 'crop':
    case 'sparkle_top':
      crew();
      break;
    case 'tank':
      scoop(0.085);
      for (const s of [-1, 1]) TP.box(s * 0.105, 1.062, -0.122, s * 0.214, 1.088, 0.122, skin);
      break;
    case 'hoodie': {
      crew();
      T.cbox(-0.17, 1.0, -0.26, 0.17, 1.2, -0.08, 0.05, WHITE); // hood bunched at the back
      P.B('torso', topMat).box(-0.13, 0.76, 0.119, 0.13, 0.9, 0.134, '#E4E4E4'); // pocket
      for (const s of [-1, 1]) TP.box(s * 0.035, 0.93, 0.12, s * 0.05, 1.07, 0.132, WHITE);
      break;
    }
    case 'sweater':
      TP.box(-0.092, 1.06, -0.082, 0.092, 1.105, 0.082, trim);
      break;
    case 'blouse':
      for (const s of [-1, 1]) TP.cbox(s * 0.005, 1.035, 0.098, s * 0.115, 1.09, 0.137, 0.02, WHITE);
      for (const y of [0.99, 0.92, 0.85]) TP.cube(0, y, 0.124, 0.03, 0.03, 0.012, trimLight);
      break;
    case 'jacket':
      TP.box(-0.07, 0.76, 0.119, 0.07, 1.086, 0.128, WHITE);
      for (const s of [-1, 1]) {
        TP.save().rotateAt(s * 0.09, 1.02, 0.13, 0, 0, s * 0.35);
        TP.box(s * 0.065, 0.93, 0.119, s * 0.115, 1.085, 0.134, trim);
        TP.restore();
        TP.box(s * 0.12, 0.78, 0.119, s * 0.19, 0.83, 0.133, trim);
      }
      TP.box(-0.004, 0.76, 0.128, 0.004, 1.0, 0.132, shade(topC, -0.3));
      break;
    case 'sundress':
    case 'mermaid':
      scoop(0.09);
      for (const s of [-1, 1]) TP.box(s * 0.1, 1.062, -0.122, s * 0.214, 1.088, 0.122, skin);
      if (topType === 'mermaid') shellTrim(TP, trimLight);
      break;
    case 'party':
      scoop(0.08);
      break;
    case 'princess':
      scoop(0.09);
      TP.box(-0.1, 1.006, 0.121, 0.1, 1.022, 0.13, GOLD);
      TP.cube(0, 1.0, 0.13, 0.04, 0.04, 0.012, '#FF7EB6');
      break;
    case 'ballgown':
      TP.box(-0.212, 1.03, -0.122, 0.212, 1.088, 0.122, skin);
      TP.box(-0.216, 1.0, -0.127, 0.216, 1.035, 0.127, trimLight);
      TP.cube(0, 0.97, 0.128, 0.05, 0.05, 0.012, '#FFFFFF');
      break;
    case 'polo':
      crew();
      for (const s of [-1, 1]) {
        TP.save().rotateAt(s * 0.05, 1.07, 0.13, 0, 0, s * 0.5);
        TP.box(s * 0.01, 1.04, 0.118, s * 0.1, 1.1, 0.136, trimLight); // collar flaps
        TP.restore();
      }
      TP.box(-0.022, 0.93, 0.119, 0.022, 1.06, 0.127, trim); // placket
      for (const y of [1.03, 0.97]) TP.cube(0, y, 0.129, 0.022, 0.022, 0.01, WHITE);
      break;
    case 'jersey': {
      scoop(0.07, 0.1); // V-neck
      TP.box(-0.072, 1.08, -0.12, 0.072, 1.092, 0.128, trim);
      const numC = numberColor(topC, topSrc.patternColor);
      jerseyNumber(TP, L.top.num, 0, 0.845, 0.121, 0.025, numC, 1); // low enough for a medal above it
      jerseyNumber(TP, L.top.num, 0, 0.86, -0.121, 0.04, numC, -1);
      break;
    }
    case 'button_up':
      for (const s of [-1, 1]) {
        TP.save().rotateAt(s * 0.04, 1.08, 0.13, 0, 0, s * 0.75);
        TP.box(s * 0.005, 1.03, 0.118, s * 0.11, 1.095, 0.138, trimLight); // pointed collar
        TP.restore();
      }
      TP.box(-0.024, 0.76, 0.119, 0.024, 1.04, 0.127, trim); // placket
      for (const y of [1.0, 0.92, 0.84, 0.77]) TP.cube(0, y, 0.129, 0.02, 0.02, 0.01, WHITE);
      TP.box(0.07, 0.9, 0.119, 0.16, 0.99, 0.128, trim); // chest pocket
      TP.box(0.07, 0.975, 0.119, 0.16, 0.99, 0.131, shade(topC, -0.25));
      break;
    case 'tee_dino':
    case 'tee_rocket':
    case 'tee_bolt': {
      crew();
      const d = DECALS[topType];
      pixelDecal(TP, d.rows, 0, topType === 'tee_rocket' ? 0.915 : 0.925, 0.121, 0.016, d.palette);
      break;
    }
    // wave 5 holiday clothes
    case 'santa_coat':
    case 'santa_dress':
      furCollar(TP);
      // fur down the front of the coat; three fluffy buttons on the dress
      if (topType === 'santa_coat') TP.cbox(-0.04, 0.745, 0.115, 0.04, 1.06, 0.142, 0.012, FUR);
      else for (const y of [1.0, 0.92, 0.84]) TP.ccube(0, y, 0.128, 0.04, 0.04, 0.03, 0.014, FUR);
      holidayBelt(TP, 0.775, 0.222, 0.132, BELT);
      break;
    case 'elf_tunic':
    case 'elf_dress':
      zigzagCollar(TP, topSrc.patternColor === topC ? FUR : topSrc.patternColor);
      holidayBelt(TP, 0.775, 0.222, 0.132, topType === 'elf_dress' ? STOCKING : BELT);
      break;
    case 'holiday_sweater': {
      TP.box(-0.092, 1.06, -0.082, 0.092, 1.105, 0.082, trim);
      // knitted bands at the top and the bottom, a tree in front and a snowflake on the back
      const band = numberColor(topC, topSrc.patternColor);
      knitBand(TP, 1.0, band, 0.214, 0.124);
      knitBand(TP, 0.735, band, 0.22, 0.13); // on the long hem
      const tree = DECALS.holiday_tree;
      const greenish = (() => { const [r, g, b] = hexToRgb(topC); return g > r && g > b; })();
      pixelDecal(TP, tree.rows, 0, 0.855, 0.121, 0.016, greenish ? { ...tree.palette, T: WHITE } : tree.palette);
      pixelDecal(TP, DECALS.holiday_flake.rows, 0, 0.86, -0.121, 0.024, { W: band }, -1);
      break;
    }
    default:
      crew();
  }

  // ----- hips / waist -----
  const H = P.B('hips', bottomMat);
  const HP = P.B('hips', 'plain');
  H.cbox(-0.19, 0.555, -0.115, 0.19, 0.775, 0.115, 0.02, WHITE);
  if (!dress) {
    HP.box(-0.196, 0.742, -0.121, 0.196, 0.778, 0.121, shade(bottomC, -0.15));
    if (BUTTONED.has(bottomType)) HP.cube(0, 0.76, 0.123, 0.03, 0.03, 0.01, GOLD);
    if (bottomType === 'joggers') for (const s of [-1, 1]) HP.box(s * 0.03 - 0.006, 0.68, 0.121, s * 0.03 + 0.006, 0.745, 0.127, WHITE); // drawstrings
  } else if (['party', 'princess', 'ballgown', 'sundress'].includes(dress.type)) {
    const sash = dress.type === 'sundress' ? trimLight : mixHex(topC, WHITE, 0.7);
    HP.box(-0.197, 0.735, -0.122, 0.197, 0.775, 0.122, sash);
    bow(HP, 0, 0.755, 0.125, 0.8, sash);
  }
  if (bottomType === 'overalls') {
    const bib = P.B('torso', bottomMat);
    bib.box(-0.14, 0.76, 0.118, 0.14, 0.99, 0.134, WHITE);
    for (const s of [-1, 1]) {
      bib.box(s * 0.07, 0.98, 0.118, s * 0.122, 1.088, 0.134, WHITE);
      bib.box(s * 0.07, 1.075, -0.132, s * 0.122, 1.093, 0.134, WHITE);
      bib.box(s * 0.07, 0.8, -0.135, s * 0.122, 1.09, -0.118, WHITE);
      TP.cube(s * 0.096, 0.975, 0.137, 0.034, 0.034, 0.012, GOLD);
    }
    TP.box(-0.06, 0.8, 0.133, 0.06, 0.88, 0.14, shade(bottomC, -0.12));
  }
  // wave 5: the Santa coat's skirt with a fur hem; the elf tunic's zigzag hem with bells
  if (topType === 'santa_coat') {
    P.B('hips', topMat).cbox(-0.222, 0.585, -0.136, 0.222, 0.79, 0.136, 0.025, WHITE);
    furBand(HP, 0.545, 0.615, 0.236, 0.15);
    HP.cbox(-0.04, 0.6, 0.13, 0.04, 0.79, 0.15, 0.012, FUR);
  } else if (topType === 'elf_tunic') {
    P.B('hips', topMat).cbox(-0.222, 0.6, -0.136, 0.222, 0.79, 0.136, 0.025, WHITE);
    zigzagHem(P.B('hips', topMat), HP, 0.6, 0.226, 0.14);
  }

  // ----- arms & sleeves -----
  const sleeve = SLEEVES[topType] || 'short';
  for (const side of [1, -1]) {
    const x = side * 0.275;
    const bone = side > 0 ? 'armL' : 'armR';
    const el = side > 0 ? 'elbowL' : 'elbowR';
    const up = P.B(bone, 'plain'), fo = P.B(el, 'plain');
    up.cbox(x - 0.062, 0.83, -0.068, x + 0.062, 1.075, 0.068, 0.02, skin);
    fo.cbox(x - 0.058, 0.665, -0.064, x + 0.058, 0.85, 0.064, 0.02, skin);
    if (sleeve === 'short') {
      P.B(bone, topMat).cbox(x - 0.073, 0.925, -0.079, x + 0.073, 1.092, 0.079, 0.022, WHITE);
      up.box(x - 0.075, 0.92, -0.081, x + 0.075, 0.94, 0.081, trim);
    } else if (sleeve === 'cap') {
      P.B(bone, topMat).cbox(x - 0.082, 0.965, -0.088, x + 0.082, 1.098, 0.088, 0.035, WHITE);
    } else if (sleeve === 'puffy') {
      P.B(bone, topMat).cbox(x - 0.097, 0.935, -0.102, x + 0.097, 1.105, 0.102, 0.05, WHITE);
      up.box(x - 0.07, 0.915, -0.076, x + 0.07, 0.94, 0.076, trimLight);
    } else if (sleeve === 'long') {
      P.B(bone, topMat).cbox(x - 0.069, 0.815, -0.075, x + 0.069, 1.092, 0.075, 0.02, WHITE);
      P.B(el, topMat).cbox(x - 0.065, 0.69, -0.071, x + 0.065, 0.862, 0.071, 0.02, WHITE);
      fo.box(x - 0.069, 0.665, -0.075, x + 0.069, 0.705, 0.075, trim);
    } else if (sleeve === 'offpuff') {
      P.B(bone, topMat).cbox(x - 0.09, 0.9, -0.096, x + 0.09, 1.005, 0.096, 0.04, WHITE);
    } else if (sleeve === 'tee') {
      up.cbox(x - 0.073, 0.925, -0.079, x + 0.073, 1.092, 0.079, 0.022, WHITE);
    }
    if (FUR_CUFFS.has(topType)) fo.cbox(x - 0.082, 0.655, -0.088, x + 0.082, 0.735, 0.088, 0.025, FUR); // fur cuffs
    else if (topType === 'holiday_sweater') fo.box(x - 0.071, 0.74, -0.077, x + 0.071, 0.77, 0.077, numberColor(topC, topSrc.patternColor));
    if (topType === 'jersey') {
      const sc = numberColor(topC, topSrc.patternColor);
      for (const y of [0.95, 0.98]) up.box(x - 0.076, y, -0.082, x + 0.076, y + 0.014, 0.082, sc); // sleeve stripes
    }
  }

  // ----- legs -----
  const pants = !dress && PANTS.has(bottomType);
  // wave 5: striped stockings (the stripy tights, and under the elf dress)
  const stripes = !dress && bottomType === 'holiday_tights' ? numberColor(bottomC, bottomSrc.patternColor)
    : dress && dress.type === 'elf_dress' ? WHITE : null;
  for (const side of [1, -1]) {
    const x = side * 0.1;
    const leg = side > 0 ? 'legL' : 'legR';
    const knee = side > 0 ? 'kneeL' : 'kneeR';
    if (pants) {
      P.B(leg, bottomMat).cbox(x - 0.093, 0.3, -0.098, x + 0.093, 0.665, 0.098, 0.02, WHITE);
      P.B(knee, bottomMat).cbox(x - 0.088, 0.06, -0.093, x + 0.088, 0.375, 0.093, 0.02, WHITE);
      if (bottomType === 'joggers') P.B(knee, 'plain').box(x - 0.093, 0.06, -0.098, x + 0.093, 0.12, 0.098, shade(bottomC, -0.15)); // ankle cuffs
      else if (bottomType === 'santa_pants') P.B(knee, 'plain').cbox(x - 0.1, 0.08, -0.105, x + 0.1, 0.15, 0.105, 0.02, FUR); // fur cuffs
      else if (bottomType !== 'leggings' && bottomType !== 'holiday_tights') P.B(knee, 'plain').box(x - 0.093, 0.085, -0.098, x + 0.093, 0.135, 0.098, shade(bottomC, 0.28));
      if (stripes) legStripes(P, leg, knee, x, stripes);
    } else if (stripes) {
      // the elf dress: red-and-white stockings instead of bare legs
      P.B(leg, 'plain').cbox(x - 0.09, 0.3, -0.095, x + 0.09, 0.66, 0.095, 0.02, STOCKING);
      P.B(knee, 'plain').cbox(x - 0.085, 0.06, -0.09, x + 0.085, 0.37, 0.09, 0.02, STOCKING);
      legStripes(P, leg, knee, x, stripes);
    } else {
      P.B(leg, 'plain').cbox(x - 0.09, 0.3, -0.095, x + 0.09, 0.66, 0.095, 0.02, skin);
      P.B(knee, 'plain').cbox(x - 0.085, 0.06, -0.09, x + 0.085, 0.37, 0.09, 0.02, skin);
      if (bottomType === 'shorts' || bottomType === 'cargo_shorts') {
        const end = bottomType === 'cargo_shorts' ? 0.4 : 0.46;
        P.B(leg, bottomMat).cbox(x - 0.1, end, -0.105, x + 0.1, 0.665, 0.105, 0.02, WHITE);
        P.B(leg, 'plain').box(x - 0.102, end - 0.005, -0.107, x + 0.102, end + 0.02, 0.107, shade(bottomC, 0.25));
        if (bottomType === 'cargo_shorts') {
          // a side pocket with a flap on each leg
          P.B(leg, bottomMat).box(x + side * 0.1, 0.46, -0.055, x + side * 0.122, 0.56, 0.055, WHITE);
          P.B(leg, 'plain').box(x + side * 0.1, 0.55, -0.06, x + side * 0.126, 0.575, 0.06, shade(bottomC, -0.15));
        }
      }
    }
  }

  // ----- skirts & dresses -----
  buildSkirt(P, dress ? dress.type : bottomType, dress ? topMat : bottomMat, dress ? topC : bottomC);

  // ----- shoes -----
  buildShoes(P, L.shoes, skin);
}

// ---------- wave 5 holiday trims ----------

/** A fluffy white fur ring around the body from y0 to y1 (half width w, half depth d). */
function furBand(b, y0, y1, w, d) {
  b.cbox(-w, y0, -d, w, y1, d, 0.03, FUR);
  // a few soft tufts so it reads as fur, not a plastic ring
  for (let i = 0; i < 5; i++) {
    const x = -w * 0.8 + (i * w * 1.6) / 4;
    b.ccube(x, (y0 + y1) / 2 - 0.004 * (i % 2), d + 0.004, 0.075, y1 - y0 + 0.012, 0.03, 0.014, i % 2 ? FUR_SHADE : FUR);
  }
}

/** The fur collar of a Santa coat or dress. */
function furCollar(b) {
  b.cbox(-0.13, 1.045, -0.105, 0.13, 1.115, 0.11, 0.03, FUR);
  for (const s of [-1, 1]) b.ccube(s * 0.065, 1.04, 0.113, 0.09, 0.06, 0.03, 0.014, FUR_SHADE);
}

/** A belt around the waist with a big gold buckle in front. */
function holidayBelt(b, y, w, d, color) {
  b.box(-w, y - 0.032, -d, w, y + 0.032, d, color);
  b.box(-0.055, y - 0.045, d - 0.002, 0.055, y + 0.045, d + 0.014, GOLD);
  b.box(-0.03, y - 0.022, d + 0.012, 0.03, y + 0.022, d + 0.016, color);
}

/** Pointed collar points around the neck (an elf's), each a turned square. */
function zigzagCollar(b, color) {
  const pts = [[-0.1, 0.122, 0], [0, 0.124, 0], [0.1, 0.122, 0], [-0.165, 0.07, 0.6], [0.165, 0.07, -0.6]];
  for (const [x, z, ry] of pts) {
    b.save().rotateAt(x, 1.05, z, 0, ry, Math.PI / 4);
    b.cube(x, 1.05, z, 0.075, 0.075, 0.016, color);
    b.restore();
  }
  b.box(-0.092, 1.07, -0.082, 0.092, 1.1, 0.082, color);
}

/** A zigzag hem (turned squares hanging below y) with a little gold bell on every point. */
function zigzagHem(b, bells, y, w, d) {
  const pts = [];
  for (const x of [-0.17, -0.057, 0.057, 0.17]) pts.push([x, d, 0], [x, -d, 0]);
  for (const z of [-0.06, 0.06]) pts.push([w, z, Math.PI / 2], [-w, z, Math.PI / 2]);
  for (const [x, z, ry] of pts) {
    b.save().rotateAt(x, y, z, 0, ry, Math.PI / 4);
    b.cube(x, y, z, 0.08, 0.08, 0.018, WHITE);
    b.restore();
    const out = ry ? [x + Math.sign(x) * 0.012, z] : [x, z + Math.sign(z) * 0.012];
    bells.sphere(out[0], y - 0.072, out[1], 0.019, 0.019, 0.019, GOLD, 7, 5);
    bells.cube(out[0], y - 0.08, out[1], 0.008, 0.008, 0.008, shade(GOLD, -0.4));
  }
}

/** A knitted zigzag band across the sweater (front, back and sides) at height y. */
function knitBand(b, y, color, w, d) {
  b.box(-w, y - 0.008, -d, w, y + 0.008, d, color);
  for (let i = 0; i < 9; i++) {
    const x = -0.19 + i * 0.0475;
    const yy = y + (i % 2 ? 0.02 : -0.02);
    for (const z of [d - 0.002, -d - 0.006]) b.box(x - 0.012, yy - 0.012, z, x + 0.012, yy + 0.012, z + 0.008, color);
  }
}

/** Stripes around one leg (thigh on `leg`, shin on `knee`), on top of the leg's own boxes. */
function legStripes(P, leg, knee, x, color) {
  for (let k = 0; k < 7; k++) {
    const y = 0.13 + k * 0.075;
    const b = P.B(y > 0.36 ? leg : knee, 'plain');
    b.box(x - 0.095, y, -0.1, x + 0.095, y + 0.036, 0.1, color);
  }
}

function heartDecal(b, x, y, z, color, s = 0.018) {
  const px = [[-2, 1], [-1, 2], [1, 2], [2, 1], [-2, 0], [-1, 0], [0, 0], [1, 0], [2, 0], [-1, 1], [0, 1], [1, 1], [-1, -1], [0, -1], [1, -1], [0, -2]];
  for (const [i, j] of px) b.box(x + i * s - s / 2, y + j * s - s / 2, z, x + i * s + s / 2, y + j * s + s / 2, z + 0.008, color);
}

/**
 * A pixel picture centred on (x, y) at depth z, s per pixel. rows: strings, top row first, one
 * character per pixel ('.' = none); palette: char -> hex. Runs of one color in a row become
 * one box. dir -1 draws it on the back (facing -Z, mirrored so it reads from behind).
 */
function pixelDecal(b, rows, x, y, z, s, palette, dir = 1) {
  const h = rows.length, w = rows[0].length;
  const z0 = dir > 0 ? z : z - 0.008, z1 = dir > 0 ? z + 0.008 : z;
  for (let j = 0; j < h; j++) {
    const row = rows[j];
    const yy = y + ((h - 1) / 2 - j) * s;
    let i = 0;
    while (i < w) { // bounded: i grows every pass
      const ch = row[i];
      let k = i + 1;
      while (k < w && row[k] === ch) k++;
      const color = palette[ch];
      if (color) {
        let xa = x + (i - w / 2) * s, xb = x + (k - w / 2) * s;
        if (dir < 0) [xa, xb] = [-xb + 2 * x, -xa + 2 * x];
        b.box(xa, yy - s / 2, z0, xb, yy + s / 2, z1, color);
      }
      i = k;
    }
  }
}

/** A jersey number (0..99) in the 3x5 pixel font, centred on (x, y). */
function jerseyNumber(b, num, x, y, z, s, color, dir) {
  const n = Number.isInteger(num) && num >= 0 && num <= 99 ? num : 7;
  const digits = String(n).split('').map((d) => DIGITS[+d]);
  const rows = [];
  for (let r = 0; r < 5; r++) rows.push(digits.map((d) => d[r]).join('.'));
  pixelDecal(b, rows, x, y, z, s, { '#': color }, dir);
}

/** The number / stripe color: the pattern color, or one that reads on the shirt. */
function numberColor(shirt, pc) {
  if (pc && pc !== shirt) return pc;
  const [r, g, bl] = hexToRgb(shirt);
  return (0.2126 * r + 0.7152 * g + 0.0722 * bl) / 255 > 0.6 ? shade(shirt, -0.5) : WHITE;
}

function shellTrim(b, color) {
  for (let i = -3; i <= 3; i++) b.cbox(i * 0.06 - 0.028, 1.0, 0.118, i * 0.06 + 0.028, 1.035, 0.134, 0.01, color);
}

/** A little bow (two loops + knot) centred at x,y,z facing +Z. */
export function bow(b, x, y, z, s, color) {
  const knot = shade(color, -0.12);
  for (const side of [-1, 1]) {
    b.save().rotateAt(x, y, z, 0, 0, side * 0.25);
    b.cbox(x + side * 0.018 * s, y - 0.032 * s, z, x + side * 0.085 * s, y + 0.032 * s, z + 0.03 * s, 0.012 * s, color);
    b.restore();
    b.save().rotateAt(x, y, z, 0, 0, side * 0.5);
    b.box(x + side * 0.008 * s, y - 0.07 * s, z + 0.004, x + side * 0.03 * s, y - 0.01 * s, z + 0.022 * s, color);
    b.restore();
  }
  b.cube(x, y, z + 0.018 * s, 0.03 * s, 0.035 * s, 0.035 * s, knot);
}

// ---------- skirts ----------

const SKIRTS = {
  skirt: { layers: [{ rings: [[0.745, 0.17, 0.1], [0.68, 0.27, 0.18], [0.43, 0.38, 0.3]], pleat: 0.035, seg: 16 }], hem: true, stride: 1 },
  pleated: { layers: [{ rings: [[0.745, 0.17, 0.1], [0.68, 0.27, 0.185], [0.44, 0.35, 0.27]], pleat: 0.14, seg: 20 }], stride: 1 },
  tutu: {
    layers: [
      { rings: [[0.7, 0.17, 0.1], [0.64, 0.27, 0.2], [0.52, 0.36, 0.3]], jag: 0.035, seg: 22, tone: 0.8 },
      { rings: [[0.72, 0.17, 0.1], [0.66, 0.29, 0.23], [0.555, 0.42, 0.36]], jag: 0.04, seg: 22, tone: 0.9 },
      { rings: [[0.745, 0.17, 0.1], [0.7, 0.3, 0.23], [0.6, 0.47, 0.41]], jag: 0.035, seg: 22, tone: 1 },
    ],
    stride: 1, stiff: true,
  },
  sundress: { layers: [{ rings: [[0.745, 0.17, 0.1], [0.68, 0.27, 0.18], [0.5, 0.34, 0.26], [0.34, 0.41, 0.33]], pleat: 0.03, seg: 18 }], hem: true, stride: 0.9 },
  party: {
    layers: [
      { rings: [[0.7, 0.17, 0.1], [0.66, 0.3, 0.22], [0.41, 0.45, 0.37]], jag: 0.03, seg: 22, plain: '#FFFFFF' },
      { rings: [[0.745, 0.17, 0.1], [0.69, 0.3, 0.21], [0.44, 0.47, 0.39]], pleat: 0.05, seg: 20, scallop: 0.03 },
    ],
    stride: 0.9,
  },
  princess: {
    layers: [{ rings: [[0.745, 0.17, 0.1], [0.68, 0.28, 0.19], [0.44, 0.4, 0.32], [0.2, 0.5, 0.42], [0.04, 0.56, 0.48]], pleat: 0.04, seg: 22 }],
    hem: true, hemColor: GOLD, stride: 0.55,
  },
  ballgown: {
    layers: [
      { rings: [[0.3, 0.47, 0.4], [0.02, 0.62, 0.55]], seg: 24, scallop: 0.045, tone: 0.84, trim: '#FFFFFF' },
      { rings: [[0.52, 0.38, 0.3], [0.22, 0.55, 0.48]], seg: 24, scallop: 0.045, tone: 0.92, trim: '#FFFFFF' },
      { rings: [[0.745, 0.17, 0.1], [0.68, 0.29, 0.2], [0.42, 0.47, 0.39]], seg: 24, scallop: 0.045, tone: 1, trim: '#FFFFFF' },
    ],
    stride: 0.45,
  },
  overall_dress: { layers: [{ rings: [[0.745, 0.17, 0.1], [0.68, 0.27, 0.18], [0.42, 0.36, 0.28]], pleat: 0.02, seg: 16 }], stride: 1 },
  mermaid: {
    layers: [{ rings: [[0.745, 0.17, 0.1], [0.68, 0.24, 0.165], [0.5, 0.245, 0.175], [0.3, 0.235, 0.175], [0.16, 0.27, 0.21], [0.02, 0.44, 0.36]], jag: 0.05, seg: 20 }],
    stride: 0.22,
  },
  // wave 5: a knee-length velvet dress with a deep fur hem; a zigzag elf dress
  santa_dress: { layers: [{ rings: [[0.745, 0.17, 0.1], [0.68, 0.27, 0.18], [0.46, 0.35, 0.27], [0.38, 0.375, 0.295]], pleat: 0.025, seg: 18 }], hem: true, hemColor: FUR, hemH: 0.075, stride: 0.9 },
  elf_dress: {
    layers: [
      { rings: [[0.7, 0.17, 0.1], [0.62, 0.3, 0.22], [0.41, 0.4, 0.32]], jag: 0.075, seg: 16, plain: FUR },
      { rings: [[0.745, 0.17, 0.1], [0.68, 0.28, 0.19], [0.46, 0.37, 0.29]], jag: 0.07, seg: 16 },
    ],
    stride: 0.9,
  },
};

function buildSkirt(P, type, mat, color) {
  const def = SKIRTS[type];
  if (!def) return;
  P.stride = def.stride;
  P.skirtStiff = !!def.stiff;
  const top = def.layers.reduce((m, l) => Math.max(m, l.rings[0][0]), 0);
  const bot = def.layers.reduce((m, l) => Math.min(m, l.rings[l.rings.length - 1][0]), 9);
  const range = [top, bot];
  const matKey = P.cloth(P.clothSpec(mat), true);
  for (const layer of def.layers) {
    const rings = layer.rings.map(([y, rx, rz]) => ({ y, rx, rz }));
    const tone = layer.tone ?? 1;
    const k = Math.round(255 * tone).toString(16).padStart(2, '0');
    const vcol = `#${k}${k}${k}`;
    if (layer.plain) P.flare('hips', 'plain2', rings, { seg: layer.seg, jag: layer.jag, pleat: layer.pleat, color: layer.plain, range });
    else P.flare('hips', matKey, rings, { seg: layer.seg, jag: layer.jag, pleat: layer.pleat, scallop: layer.scallop, color: vcol, range });
    if (layer.trim) {
      const last = rings[rings.length - 1];
      const hr = [{ y: last.y + 0.03, rx: last.rx * 0.965, rz: last.rz * 0.965 }, { y: last.y - 0.004, rx: last.rx * 1.02, rz: last.rz * 1.02 }];
      P.flare('hips', 'plain2', hr, { seg: layer.seg, scallop: layer.scallop, color: layer.trim, range });
    }
  }
  if (def.hem) {
    const layer = def.layers[def.layers.length - 1];
    const last = layer.rings[layer.rings.length - 1];
    const [y, rx, rz] = last;
    const top = def.hemH || 0.035; // a deep fur hem (wave 5) or the usual thin band
    const hr = [{ y: y + top, rx: rx * (def.hemH ? 1.0 : 0.975), rz: rz * (def.hemH ? 1.0 : 0.975) }, { y: y - 0.012, rx: rx * 1.02, rz: rz * 1.02 }];
    P.flare('hips', 'plain2', hr, { seg: layer.seg, scallop: 0.02, color: def.hemColor || mixHex(color, WHITE, 0.7), range });
  }
}

// ---------- shoes ----------

function buildShoes(P, shoes, skin) {
  const c = shoes.color;
  const type = shoes.type;
  const light = mixHex(c, WHITE, 0.6);
  const sparkleMat = type === 'sparkle' ? P.cloth({ color: c, pattern: 'none', patternColor: WHITE, fabric: 'sparkle' }) : null;
  if (type === 'roller_skates') P.lift = 0.07;
  for (const side of [1, -1]) {
    const x = side * 0.1;
    const b = P.B(side > 0 ? 'kneeL' : 'kneeR', 'plain');
    switch (type) {
      case 'sneakers':
        b.box(x - 0.1, 0, -0.105, x + 0.1, 0.038, 0.165, '#F4F1F8');
        b.cbox(x - 0.094, 0.03, -0.1, x + 0.094, 0.125, 0.155, 0.03, c);
        b.cbox(x - 0.09, 0.03, 0.105, x + 0.09, 0.085, 0.162, 0.02, WHITE);
        for (const z of [0.03, 0.07]) b.box(x - 0.05, 0.12, z, x + 0.05, 0.13, z + 0.018, WHITE);
        b.box(x - 0.095, 0.035, -0.101, x + 0.095, 0.05, 0.156, shade(c, -0.12));
        b.box(x - 0.088, 0.12, -0.093, x + 0.088, 0.16, 0.093, WHITE); // socks
        break;
      case 'boots':
        b.box(x - 0.1, 0, -0.105, x + 0.1, 0.035, 0.16, shade(c, -0.45));
        b.cbox(x - 0.096, 0.03, -0.1, x + 0.096, 0.13, 0.155, 0.03, c);
        b.cbox(x - 0.097, 0.03, -0.1, x + 0.097, 0.3, 0.1, 0.02, c);
        b.cbox(x - 0.106, 0.27, -0.108, x + 0.106, 0.335, 0.108, 0.02, light);
        break;
      case 'sandals':
        b.box(x - 0.1, 0, -0.105, x + 0.1, 0.045, 0.16, shade(c, 0.35));
        b.cbox(x - 0.084, 0.04, -0.09, x + 0.084, 0.1, 0.15, 0.03, skin);
        b.box(x - 0.088, 0.045, 0.07, x + 0.088, 0.1, 0.1, c);
        b.box(x - 0.09, 0.08, -0.095, x + 0.09, 0.105, 0.095, c);
        b.cube(x, 0.1, 0.09, 0.04, 0.035, 0.035, light);
        break;
      case 'sparkle': {
        b.box(x - 0.098, 0, -0.1, x + 0.098, 0.03, 0.16, shade(c, -0.3));
        P.B(side > 0 ? 'kneeL' : 'kneeR', sparkleMat).cbox(x - 0.093, 0.025, -0.095, x + 0.093, 0.105, 0.155, 0.035, WHITE);
        b.box(x - 0.094, 0.09, 0.0, x + 0.094, 0.108, 0.04, shade(c, -0.15));
        bow(b, x, 0.085, 0.155, 0.55, light);
        break;
      }
      case 'rainboots':
        b.box(x - 0.1, 0, -0.105, x + 0.1, 0.035, 0.165, shade(c, -0.4));
        b.cbox(x - 0.098, 0.03, -0.1, x + 0.098, 0.14, 0.16, 0.035, c);
        b.cbox(x - 0.1, 0.03, -0.102, x + 0.1, 0.32, 0.102, 0.025, c);
        b.box(x - 0.103, 0.3, -0.105, x + 0.103, 0.33, 0.105, WHITE);
        heartDecal(b, x, 0.2, 0.102, WHITE, 0.012);
        break;
      case 'ballet':
        b.box(x - 0.095, 0, -0.1, x + 0.095, 0.022, 0.155, shade(c, -0.2));
        b.cbox(x - 0.09, 0.018, -0.095, x + 0.09, 0.075, 0.152, 0.025, c);
        b.box(x - 0.08, 0.065, 0.01, x + 0.08, 0.08, 0.13, shade(skin, -0.02));
        for (const [y, a] of [[0.13, 0.3], [0.2, -0.3], [0.27, 0.3]]) {
          b.save().rotateAt(x, y, 0, a, 0, 0);
          b.box(x - 0.09, y - 0.012, -0.095, x + 0.09, y + 0.012, 0.095, c);
          b.restore();
        }
        bow(b, x, 0.08, 0.13, 0.4, light);
        break;
      case 'roller_skates': {
        // wheels sit under the boot; the whole avatar is lifted by P.lift
        const wheel = '#FFD43B';
        b.box(x - 0.08, -0.03, -0.11, x + 0.08, -0.005, 0.17, '#C9CED8');
        for (const z of [-0.07, 0.13]) {
          for (const s of [-1, 1]) {
            b.save().translate(x + s * 0.062, -0.045, z).rotate(0, 0, Math.PI / 2);
            b.cyl(0, -0.025, 0, 0.038, 0.05, s > 0 ? wheel : '#FF8CC6', 8);
            b.restore();
          }
        }
        b.cube(x, -0.02, 0.2, 0.05, 0.04, 0.04, '#FF5FA2');
        b.box(x - 0.1, 0, -0.105, x + 0.1, 0.03, 0.165, WHITE);
        b.cbox(x - 0.097, 0.025, -0.1, x + 0.097, 0.13, 0.16, 0.035, c);
        b.cbox(x - 0.097, 0.025, -0.1, x + 0.097, 0.25, 0.1, 0.03, c);
        for (const y of [0.1, 0.15, 0.2]) b.box(x - 0.045, y, 0.098, x + 0.045, y + 0.012, 0.106, WHITE);
        b.box(x - 0.1, 0.225, -0.103, x + 0.1, 0.26, 0.103, light);
        break;
      }
      case 'high_tops':
        // sneaker sole and toe cap, a tall shaft, white laces and a round star ankle patch
        b.box(x - 0.1, 0, -0.105, x + 0.1, 0.038, 0.165, '#F4F1F8');
        b.cbox(x - 0.094, 0.03, -0.1, x + 0.094, 0.125, 0.155, 0.03, c);
        b.cbox(x - 0.09, 0.03, 0.105, x + 0.09, 0.085, 0.162, 0.02, WHITE);
        b.cbox(x - 0.097, 0.03, -0.102, x + 0.097, 0.26, 0.1, 0.025, c);
        b.box(x - 0.1, 0.245, -0.104, x + 0.1, 0.27, 0.104, WHITE);
        for (let k = 0; k < 4; k++) b.box(x - 0.045, 0.135 + k * 0.03, 0.098, x + 0.045, 0.146 + k * 0.03, 0.108, WHITE);
        b.save().translate(x + side * 0.098, 0.19, 0).rotate(0, 0, Math.PI / 2);
        b.cyl(0, -0.006, 0, 0.04, 0.012, WHITE, 10);
        b.restore();
        for (const r of [0, Math.PI / 4]) { // a little star (two turned squares)
          b.save().rotateAt(x + side * 0.106, 0.19, 0, r, 0, 0);
          b.cube(x + side * 0.106, 0.19, 0, 0.004, 0.032, 0.032, c);
          b.restore();
        }
        break;
      case 'skate_shoes':
        // a chunky low shoe on a thick white sole, a side stripe and a white toe band
        b.box(x - 0.104, 0, -0.11, x + 0.104, 0.05, 0.17, WHITE);
        b.cbox(x - 0.097, 0.045, -0.104, x + 0.097, 0.15, 0.16, 0.035, c);
        b.box(x - 0.1, 0.07, -0.08, x + 0.1, 0.095, 0.11, shade(c, 0.4));
        b.cbox(x - 0.092, 0.045, 0.115, x + 0.092, 0.095, 0.167, 0.02, WHITE);
        for (const z of [0.03, 0.07]) b.box(x - 0.05, 0.145, z, x + 0.05, 0.155, z + 0.018, WHITE);
        b.box(x - 0.088, 0.145, -0.093, x + 0.088, 0.18, 0.093, WHITE); // socks
        break;
      case 'santa_boots':
        // tall shiny boots with a deep fur cuff and a gold buckle strap
        b.box(x - 0.102, 0, -0.108, x + 0.102, 0.04, 0.17, shade(c, -0.35));
        b.cbox(x - 0.097, 0.035, -0.102, x + 0.097, 0.14, 0.165, 0.035, c);
        b.cbox(x - 0.098, 0.035, -0.102, x + 0.098, 0.29, 0.102, 0.025, c);
        b.box(x - 0.1, 0.12, -0.104, x + 0.1, 0.15, 0.104, BELT);
        b.box(x - 0.025, 0.115, 0.102, x + 0.025, 0.155, 0.11, GOLD);
        b.cbox(x - 0.115, 0.27, -0.118, x + 0.115, 0.36, 0.118, 0.03, FUR);
        b.ccube(x, 0.315, 0.12, 0.13, 0.08, 0.02, 0.012, FUR_SHADE);
        break;
      case 'elf_shoes': {
        // a soft low shoe whose long pointed toe curls up to a jingle bell
        b.box(x - 0.096, 0, -0.1, x + 0.096, 0.03, 0.14, shade(c, -0.3));
        b.cbox(x - 0.094, 0.02, -0.1, x + 0.094, 0.13, 0.14, 0.035, c);
        b.cbox(x - 0.1, 0.12, -0.104, x + 0.1, 0.16, 0.104, 0.015, mixHex(c, WHITE, 0.55)); // cuff
        b.save().translate(x, 0.045, 0.12);
        for (let k = 0; k < 4; k++) { // each piece a little smaller, turned a little more upward
          const s = 0.15 - k * 0.03;
          b.rotate(-0.38, 0, 0);
          b.ccube(0, 0, 0.035, s, s * 0.6, 0.07, 0.015, c);
          b.translate(0, 0, 0.05);
        }
        b.sphere(0, 0.012, 0.03, 0.026, 0.026, 0.026, GOLD, 8, 6);
        b.restore();
        break;
      }
      default:
        b.cbox(x - 0.094, 0, -0.1, x + 0.094, 0.12, 0.155, 0.03, c);
    }
  }
}
