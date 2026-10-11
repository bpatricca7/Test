// Dog and cat breeds: extra variants of the puppy and the kitty shown under "Breeds" in the
// adoption panel. Dogs get their own builder (ear shapes, leg length, fluff, markings, tails);
// the cat breeds reuse the kitty builder (see species.js) plus the fluffy extras here.

import { shade } from '../../core/util.js';
import { BLUSH, GOLD, pivot, part, partL, eyeMesh } from './rig.js';

// ---------- the variant tables ----------

export const DOG_BREEDS = [
  { key: 'retriever', name: 'Golden Retriever', group: 'breeds', breed: 'retriever', body: '#E9B15E', light: '#FCE5B8', ear: '#D69442', accent: '#FF6FA5', ears: 'feather', tail: 'plume', ruff: true },
  { key: 'dalmatian', name: 'Dalmatian', group: 'breeds', breed: 'dalmatian', body: '#FFFFFF', light: '#FFFFFF', ear: '#2E2A33', accent: '#FF5A5A', spots: '#2E2A33', ears: 'flop', tail: 'wag', dots: true },
  { key: 'corgi', name: 'Corgi', group: 'breeds', breed: 'corgi', body: '#F2A457', light: '#FFFFFF', ear: '#F2A457', inner: '#FFC4D0', accent: '#9C7BFF', ears: 'big', tail: 'fluffbutt', short: true, blaze: true, tagY: 1.3 },
  { key: 'poodle', name: 'Poodle', group: 'breeds', breed: 'poodle', body: '#FFF3F7', light: '#FFFFFF', ear: '#FFFFFF', fluff: '#FFFFFF', accent: '#FF5FA2', ears: 'pom', tail: 'pom', poms: true, tagY: 1.34 },
  { key: 'husky', name: 'Husky', group: 'breeds', breed: 'husky', body: '#8E98AE', light: '#FFFFFF', ear: '#7C869C', inner: '#FFFFFF', accent: '#3FD8B0', ears: 'pointy', tail: 'curl', mask: true, eye: '#58B6FF', tagY: 1.2 },
];

export const CAT_BREEDS = [
  { key: 'tabby', name: 'Tabby', group: 'breeds', body: '#C9A27E', light: '#F6EBDD', ear: '#C9A27E', stripes: '#8A6446', eye: '#7FD36B', accent: '#FF6FA5' },
  { key: 'siamese', name: 'Siamese', group: 'breeds', body: '#FFF0DC', light: '#FFFAF2', ear: '#6E4B3B', points: '#6E4B3B', eye: '#5FB0FF', accent: '#9C7BFF' },
  { key: 'persian', name: 'Fluffy Persian', group: 'breeds', body: '#FFFFFF', light: '#FFF6FA', ear: '#FFFFFF', fluffy: '#FFFFFF', eye: '#FF9F43', accent: '#FF8CC6', bow: '#FF5FA2', tagY: 1.06 },
  { key: 'black', name: 'Black Cat', group: 'breeds', body: '#2C2833', light: '#3E3947', ear: '#2C2833', eye: '#FFD23F', whisker: '#FFFFFF', accent: '#FF6FA5' },
];

// ---------- dogs ----------

/** A puppy of a breed: v.ears flop|feather|big|pointy|pom, v.tail wag|plume|curl|pom|fluffbutt. */
export function buildBreedDog(rig, v) {
  const K = `puppy:${v.key}`;
  const hipY = v.short ? 0.16 : 0.27;
  const dy = hipY - 0.27; // everything above the legs sits this much lower (corgi)
  const Y = (y) => y + dy;
  const long = v.short ? 0.08 : 0; // corgis are long
  rig.legLen = hipY;
  rig.body = pivot(rig.jumper, [0, 0, 0], [0, hipY, -0.18 - long]);
  rig.bodyY = rig.body.position.y;
  const B = rig.body;
  const legs = [[0, -0.12, 0.16 + long * 0.6], [1, 0.12, 0.16 + long * 0.6], [2, -0.12, -0.18 - long], [3, 0.12, -0.18 - long]];
  for (const [i, lx, lz] of legs) {
    const leg = pivot(B, B.userData.w, [lx, hipY, lz]);
    partL(leg, `${K}:leg`, (k) => {
      const lw = v.poms ? 0.1 : 0.13;
      k.cbox(lw, hipY, lw + 0.01, v.body, 0, -hipY / 2, 0);
      if (v.dots) k.cbox(lw + 0.004, 0.05, 0.05, v.spots, 0, -hipY * 0.45, 0.03);
      if (v.mask) k.cbox(lw + 0.006, hipY * 0.5, lw + 0.016, v.light, 0, -hipY * 0.72, 0);
      if (v.poms) k.ball(0.095, v.fluff, 0, -hipY + 0.092, 0.005, 10);
      else k.cbox(0.15, 0.065, 0.17, v.light, 0, -hipY + 0.032, 0.012);
    });
    rig.legs.push(leg);
    (i < 2 ? rig.front : rig.back).push(leg);
  }
  part(B, `${K}:body`, (k) => {
    const bl = 0.6 + long * 2;
    k.cbox(0.42, 0.3, bl, v.body, 0, Y(0.4), -0.01 - long * 0.5);
    k.cbox(0.3, 0.02, bl - 0.16, v.light, 0, Y(0.245), -long * 0.5);
    k.cbox(0.26, 0.2, 0.02, v.light, 0, Y(0.42), 0.29);
    if (v.ruff || v.blaze || v.mask) k.cbox(0.3, 0.2, 0.08, v.light, 0, Y(0.36), 0.28); // fluffy chest
    if (v.ruff) {
      k.ball(0.1, v.light, -0.09, Y(0.3), 0.3, 10);
      k.ball(0.1, v.light, 0.09, Y(0.3), 0.3, 10);
    }
    if (v.poms) {
      // the poodle's fluffy coat: a big pom on the chest and a puffy back
      k.ball(0.23, v.fluff, 0, Y(0.44), 0.16, 14, [1, 0.95, 0.9]);
      k.ball(0.17, v.fluff, 0, Y(0.42), -0.24, 12);
    }
    // collar with a golden tag
    k.cbox(0.37, 0.075, 0.2, v.accent, 0, Y(0.535), 0.22);
    k.cbox(0.075, 0.085, 0.03, GOLD, 0, Y(0.47), 0.33);
    if (v.dots) {
      const s = v.spots;
      for (const [x, y, z, w, h] of [[-0.214, 0.43, -0.12, 0.12, 0.1], [0.214, 0.37, 0.1, 0.09, 0.08], [-0.214, 0.34, 0.12, 0.07, 0.06], [0.214, 0.47, -0.2, 0.08, 0.07], [0.214, 0.35, -0.08, 0.06, 0.05], [-0.214, 0.48, 0.02, 0.06, 0.06]]) {
        k.cbox(0.012, h, w, s, x, Y(y), z);
      }
      for (const [x, z, w] of [[0.05, -0.16, 0.1], [-0.1, 0.05, 0.07], [0.1, 0.12, 0.06], [-0.06, -0.24, 0.06]]) k.cbox(w, 0.012, w, s, x, Y(0.556), z);
    }
    if (v.mask) k.cbox(0.3, 0.02, 0.5, shade(v.body, -0.1), 0, Y(0.556), -0.05); // darker saddle
  });
  // tail
  rig.tail = pivot(B, B.userData.w, [0, Y(0.5), -0.3 - long * 2]);
  const tz = -0.3 - long * 2;
  part(rig.tail, `${K}:tail`, (k) => {
    switch (v.tail) {
      case 'plume':
        k.cbox(0.1, 0.1, 0.3, v.body, 0, Y(0.58), tz - 0.12, [0.6, 0, 0]);
        k.cbox(0.13, 0.08, 0.26, v.light, 0, Y(0.53), tz - 0.13, [0.6, 0, 0]);
        k.ball(0.075, v.light, 0, Y(0.69), tz - 0.24, 10);
        break;
      case 'curl':
        // curled up over the back, white tip
        k.cbox(0.11, 0.2, 0.11, v.body, 0, Y(0.62), tz - 0.02, [-0.3, 0, 0]);
        k.cbox(0.12, 0.11, 0.18, v.body, 0, Y(0.74), tz + 0.04);
        k.ball(0.075, v.light, 0, Y(0.72), tz + 0.14, 10);
        break;
      case 'pom':
        k.cbox(0.05, 0.05, 0.18, v.body, 0, Y(0.58), tz - 0.06, [0.8, 0, 0]);
        k.ball(0.09, v.fluff || v.light, 0, Y(0.66), tz - 0.12, 10);
        break;
      case 'fluffbutt':
        k.ball(0.11, v.light, 0, Y(0.45), tz + 0.02, 10);
        k.cbox(0.07, 0.07, 0.06, v.body, 0, Y(0.52), tz - 0.02);
        break;
      default:
        k.cbox(0.085, 0.085, 0.24, v.body, 0, Y(0.577), tz - 0.09, [0.7, 0, 0]);
        k.cbox(0.09, 0.09, 0.06, v.dots ? v.spots : v.light, 0, Y(0.64), tz - 0.165, [0.7, 0, 0]);
    }
  });
  // head
  const H = rig.head = pivot(B, B.userData.w, [0, Y(0.52), 0.2]);
  part(H, `${K}:head`, (k) => {
    const hw = v.ears === 'pointy' || v.ears === 'big' ? 0.48 : 0.5;
    k.cbox(hw, 0.44, 0.42, v.body, 0, Y(0.73), 0.27);
    if (v.mask) {
      // husky mask: white face below the eyes and a white stripe up the middle
      k.cbox(0.36, 0.2, 0.012, v.light, 0, Y(0.64), 0.484);
      k.cbox(0.1, 0.18, 0.012, v.light, 0, Y(0.84), 0.484);
      k.cbox(0.13, 0.05, 0.012, v.light, -0.14, Y(0.87), 0.484);
      k.cbox(0.13, 0.05, 0.012, v.light, 0.14, Y(0.87), 0.484);
    }
    if (v.blaze) {
      k.cbox(0.1, 0.2, 0.012, v.light, 0, Y(0.84), 0.484);
      k.cbox(0.28, 0.14, 0.012, v.light, 0, Y(0.64), 0.484);
    }
    k.cbox(0.24, 0.15, 0.11, v.light, 0, Y(0.625), 0.535);
    k.cbox(0.1, 0.065, 0.05, '#3A2A33', 0, Y(0.685), 0.588);
    k.cbox(0.03, 0.02, 0.01, '#FFFFFF', -0.022, Y(0.702), 0.614);
    k.cbox(0.018, 0.05, 0.01, '#3A2A33', 0, Y(0.635), 0.592);
    k.cbox(0.05, 0.018, 0.01, '#3A2A33', -0.03, Y(0.605), 0.592, [0, 0, -0.45]);
    k.cbox(0.05, 0.018, 0.01, '#3A2A33', 0.03, Y(0.605), 0.592, [0, 0, 0.45]);
    k.cbox(0.085, 0.042, 0.012, BLUSH, -0.175, Y(0.645), 0.486);
    k.cbox(0.085, 0.042, 0.012, BLUSH, 0.175, Y(0.645), 0.486);
    if (v.poms) {
      // top knot with a bow
      k.ball(0.16, v.fluff, 0, Y(0.99), 0.24, 12);
      k.cbox(0.2, 0.08, 0.05, v.accent, 0, Y(1.1), 0.33, [0, 0, 0]);
      k.cbox(0.05, 0.06, 0.06, shade(v.accent, -0.15), 0, Y(1.1), 0.35);
    } else if (v.ears === 'feather') {
      k.cbox(0.2, 0.08, 0.06, v.light, 0, Y(0.91), 0.42);
    }
    if (v.dots) {
      k.cbox(0.13, 0.12, 0.012, v.spots, 0.14, Y(0.8), 0.483);
      k.cbox(0.06, 0.06, 0.012, v.spots, -0.17, Y(0.9), 0.483);
      k.cbox(0.012, 0.1, 0.1, v.spots, -0.251, Y(0.78), 0.2);
      k.cbox(0.012, 0.08, 0.08, v.spots, 0.251, Y(0.7), 0.3);
    }
  });
  rig.tongue = part(H, `${K}:tongue`, (k) => k.cbox(0.075, 0.02, 0.075, '#FF7FA4', 0, Y(0.565), 0.572));
  const iris = v.eye || null;
  rig.eyes.push(
    eyeMesh(H, K, -0.12, Y(0.775), 0.49, 0.1, 0.13, { iris }),
    eyeMesh(H, K, 0.12, Y(0.775), 0.49, 0.1, 0.13, { iris }),
  );
  for (const s of [-1, 1]) {
    const pointy = v.ears === 'pointy' || v.ears === 'big';
    const ear = pivot(H, H.userData.w, [s * (pointy ? 0.16 : 0.25), Y(pointy ? 0.94 : 0.9), pointy ? 0.26 : 0.3]);
    part(ear, `${K}:ear${s}`, (k) => {
      const ex = s * (pointy ? 0.16 : 0.285);
      switch (v.ears) {
        case 'pointy':
          k.cyl(0.12, 0.2, v.ear, ex, Y(0.94), 0.26, 4, [0, Math.PI / 4, 0], 0);
          k.cyl(0.07, 0.12, v.inner, ex, Y(0.94), 0.3, 4, [0, Math.PI / 4, 0], 0);
          break;
        case 'big':
          k.cyl(0.15, 0.3, v.ear, ex, Y(0.93), 0.26, 4, [0, Math.PI / 4, s * -0.18], 0);
          k.cyl(0.09, 0.2, v.inner, ex, Y(0.94), 0.305, 4, [0, Math.PI / 4, s * -0.18], 0);
          break;
        case 'pom':
          k.ball(0.12, v.fluff, s * 0.29, Y(0.7), 0.3, 10, [0.9, 1.25, 1]);
          k.ball(0.09, v.fluff, s * 0.3, Y(0.56), 0.3, 10);
          break;
        case 'feather':
          k.cbox(0.1, 0.32, 0.2, v.ear, ex, Y(0.76), 0.3, [0, 0, s * 0.16]);
          k.cbox(0.12, 0.12, 0.22, shade(v.ear, 0.12), s * 0.305, Y(0.6), 0.3, [0, 0, s * 0.16]);
          k.cbox(0.02, 0.2, 0.14, shade(v.ear, -0.08), s * 0.24, Y(0.8), 0.3, [0, 0, s * 0.16]);
          break;
        default:
          k.cbox(0.09, 0.28, 0.2, v.ear, ex, Y(0.79), 0.3, [0, 0, s * 0.16]);
          k.cbox(0.02, 0.2, 0.14, shade(v.ear, -0.08), s * 0.24, Y(0.8), 0.3, [0, 0, s * 0.16]);
      }
    });
    rig.ears.push(ear);
  }
}

// ---------- cats ----------

/** Extras for the kitty builder: the Persian's fluffy ruff, cheeks and bow. */
export function buildBreedCatExtras(rig, v, K) {
  const B = rig.body, H = rig.head;
  if (v.fluffy) {
    part(B, `${K}:fluff`, (k) => {
      // a fluffy ruff around the neck and puffy sides
      for (const [x, y, z, r] of [[-0.14, 0.4, 0.22, 0.11], [0.14, 0.4, 0.22, 0.11], [0, 0.36, 0.26, 0.12], [-0.16, 0.5, 0.17, 0.09], [0.16, 0.5, 0.17, 0.09], [-0.17, 0.33, -0.06, 0.1], [0.17, 0.33, -0.06, 0.1], [0, 0.46, -0.2, 0.12]]) {
        k.ball(r, v.fluffy, x, y, z, 10);
      }
    });
    part(rig.tail, `${K}:fluffTail`, (k) => {
      k.ball(0.1, v.fluffy, 0, 0.52, -0.35, 10, [1, 1, 1.5]);
    });
    part(rig.tail2, `${K}:fluffTail2`, (k) => {
      k.ball(0.1, v.fluffy, 0, 0.74, -0.43, 10, [1, 1.5, 1]);
    });
    part(H, `${K}:cheeks`, (k) => {
      k.ball(0.1, v.fluffy, -0.22, 0.5, 0.26, 10);
      k.ball(0.1, v.fluffy, 0.22, 0.5, 0.26, 10);
    });
  }
  if (v.bow) {
    part(H, `${K}:bow`, (k) => {
      k.cbox(0.1, 0.08, 0.04, v.bow, -0.2, 0.83, 0.3, [0, 0, 0.35]);
      k.cbox(0.1, 0.08, 0.04, v.bow, -0.1, 0.83, 0.3, [0, 0, -0.35]);
      k.cbox(0.045, 0.05, 0.05, shade(v.bow, -0.15), -0.15, 0.83, 0.31);
    });
  }
}
