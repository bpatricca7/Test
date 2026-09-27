// The horse: bigger and faster than the pony, rideable, with real horse coats (chestnut,
// palomino, black with white socks, dapple gray, pinto) and a flowing or braided mane
// (pet option `braids`, picked in the adoption panel). Face +Z, origin at the hooves.

import { shade } from '../../core/util.js';
import { BLUSH, GOLD, pivot, part, partL, eyeMesh } from './rig.js';

export const HORSE = {
  name: 'Horse', voice: 'neigh', happy: 'whinny', treat: 'carrot', gait: 'trot', trick: 'rear', rideable: true,
  speed: 5.6, run: 8.8, halfW: 0.42, height: 1.7, shadow: 1.7, tagY: 2.56, hop: 9.4, seat: 1.4, scale: 1,
  big: true,
  names: ['Thunder', 'Honey', 'Duchess', 'Spirit', 'Clover', 'Starlight', 'Butterscotch', 'Willow'],
  variants: [
    { key: 'chestnut', name: 'Chestnut', body: '#B8683E', light: '#E7B48E', muzzle: '#9E5634', mane: '#6B3A24', mane2: '#83492D', hoof: '#3F2A22', blaze: '#FFFFFF', accent: '#FF6FA5' },
    { key: 'palomino', name: 'Palomino', body: '#EABF68', light: '#FFF0C8', muzzle: '#D9A955', mane: '#FFF8E8', mane2: '#FFEFD0', hoof: '#8C6A45', accent: '#9C7BFF' },
    { key: 'socks', name: 'Black Beauty', body: '#35303B', light: '#4B4554', muzzle: '#2A2630', mane: '#1E1A22', mane2: '#2C2731', hoof: '#6B6570', socks: '#FFFFFF', blaze: '#FFFFFF', accent: '#3FD8B0' },
    { key: 'dapple', name: 'Dapple Gray', body: '#B9BAC6', light: '#E8E9F0', muzzle: '#8F909E', mane: '#6F7080', mane2: '#8A8B9A', hoof: '#55566A', dapples: ['#D9DAE3', '#A2A3B2'], accent: '#FF8CC6' },
    { key: 'pinto', name: 'Pinto', body: '#FFFCF6', light: '#FFFFFF', muzzle: '#F2DCCB', mane: '#8A5A3C', mane2: '#FFFFFF', hoof: '#8C7A6A', patch: '#8A5A3C', accent: '#FFC94D' },
  ],
};

const HIP = 0.78; // leg pivot height

export function buildBigHorse(rig, v, opts = {}) {
  const braids = !!opts.braids;
  const K = `horse:${v.key}:${braids ? 'b' : 'f'}`;
  rig.legLen = HIP;
  rig.lashes = true;
  const B = rig.body = pivot(rig.jumper, [0, 0, 0], [0, HIP, -0.42]);
  rig.bodyY = B.position.y;
  const legs = [[0, -0.18, 0.42], [1, 0.18, 0.42], [2, -0.18, -0.42], [3, 0.18, -0.42]];
  for (const [i, lx, lz] of legs) {
    const leg = pivot(B, B.userData.w, [lx, HIP, lz]);
    // black horses get white socks on the front left and both back legs
    const sock = v.socks && i !== 1 ? v.socks : null;
    partL(leg, `${K}:leg${sock ? 's' : ''}`, (k) => {
      k.cbox(0.19, 0.5, 0.2, v.body, 0, -0.25, 0);
      k.cbox(0.15, 0.22, 0.16, sock || shade(v.body, -0.04), 0, -0.6, 0);
      k.cbox(0.17, 0.05, 0.18, sock || shade(v.body, -0.08), 0, -0.53, 0.004);
      k.cbox(0.18, 0.08, 0.19, v.hoof, 0, -0.74, 0.012);
    });
    rig.legs.push(leg);
    (i < 2 ? rig.front : rig.back).push(leg);
  }
  part(B, `${K}:body`, (k) => {
    k.cbox(0.62, 0.52, 1.24, v.body, 0, 1.03, 0);
    k.cbox(0.5, 0.02, 0.9, v.light, 0, 0.765, 0);
    k.cbox(0.52, 0.42, 0.12, v.body, 0, 1.02, 0.64); // chest
    k.cbox(0.56, 0.44, 0.1, shade(v.body, -0.03), 0, 1.06, -0.64); // hindquarters
    // neck, rising forward
    k.cbox(0.34, 0.66, 0.38, v.body, 0, 1.44, 0.62, [0.52, 0, 0]);
    if (v.patch) {
      for (const s of [-1, 1]) {
        k.cbox(0.012, 0.3, 0.4, v.patch, s * 0.311, 1.06, -0.3);
        k.cbox(0.012, 0.22, 0.26, v.patch, s * 0.311, 1.1, 0.34);
      }
      k.cbox(0.36, 0.012, 0.36, v.patch, 0, 1.291, -0.3);
      k.cbox(0.2, 0.24, 0.012, v.patch, 0.06, 1.5, 0.83, [0.52, 0, 0]);
    }
    if (v.dapples) {
      const [d1, d2] = v.dapples;
      for (const s of [-1, 1]) {
        for (const [y, z, w, c] of [[1.12, -0.38, 0.1, d1], [0.98, -0.2, 0.08, d1], [1.14, -0.05, 0.07, d2], [0.94, 0.12, 0.08, d1], [1.1, 0.26, 0.07, d1], [0.96, -0.45, 0.07, d2], [1.2, 0.1, 0.06, d1]]) {
          k.cbox(0.012, w, w, c, s * 0.311, y, z);
        }
      }
      for (const [x, z] of [[-0.12, -0.3], [0.1, -0.1], [-0.08, 0.2], [0.14, 0.34]]) k.cbox(0.08, 0.012, 0.08, d1, x, 1.291, z);
    }
    // saddle: blanket, seat, pommel, cantle, flaps and stirrups
    k.cbox(0.66, 0.03, 0.5, shade(v.accent, 0.55), 0, 1.3, 0.04);
    k.cbox(0.52, 0.08, 0.4, v.accent, 0, 1.34, 0.04);
    k.cbox(0.16, 0.1, 0.08, shade(v.accent, -0.12), 0, 1.41, 0.23);
    k.cbox(0.4, 0.08, 0.07, shade(v.accent, -0.12), 0, 1.4, -0.14);
    for (const s of [-1, 1]) {
      k.cbox(0.02, 0.26, 0.3, v.accent, s * 0.322, 1.16, 0.04);
      k.cbox(0.02, 0.08, 0.08, '#FFFFFF', s * 0.334, 1.17, 0.04, [0.785, 0, 0]);
      k.cbox(0.018, 0.2, 0.018, '#C9A94A', s * 0.336, 0.97, 0.04);
      k.cbox(0.06, 0.024, 0.09, GOLD, s * 0.336, 0.86, 0.04);
    }
  });
  // mane along the neck crest (flowing locks, or a row of braided knots with ribbons)
  rig.mane = pivot(B, B.userData.w, [0, 1.62, 0.56]);
  part(rig.mane, `${K}:mane`, (k) => {
    if (braids) {
      const knots = [[1.9, 0.83], [1.78, 0.74], [1.66, 0.65], [1.54, 0.56], [1.42, 0.47], [1.31, 0.39]];
      knots.forEach(([y, z], i) => {
        k.ball(0.075, i % 2 ? v.mane2 : v.mane, 0, y + 0.06, z - 0.06, 8);
        k.ball(0.05, v.mane, 0.02, y - 0.02, z - 0.05, 8);
        k.cbox(0.08, 0.035, 0.035, v.accent, 0, y - 0.07, z - 0.04, [0.52, 0, 0]);
      });
    } else {
      const locks = [[1.92, 0.8, 0.2], [1.78, 0.7, 0.24], [1.64, 0.6, 0.26], [1.5, 0.5, 0.26], [1.36, 0.41, 0.24], [1.24, 0.33, 0.2]];
      locks.forEach(([y, z, h], i) => k.cbox(0.2, h, 0.17, i % 2 ? v.mane2 : v.mane, 0, y, z - 0.1, [0.52, 0, 0]));
      k.cbox(0.05, 0.36, 0.16, v.mane, 0.19, 1.6, 0.58, [0.52, 0, 0.12]);
      k.cbox(0.05, 0.3, 0.14, v.mane2, 0.2, 1.4, 0.44, [0.52, 0, 0.1]);
    }
  });
  // tail
  rig.tail = pivot(B, B.userData.w, [0, 1.2, -0.66]);
  part(rig.tail, `${K}:tail`, (k) => {
    if (braids) {
      for (let i = 0; i < 6; i++) {
        const y = 1.16 - i * 0.12, z = -0.74 - Math.min(i, 3) * 0.04;
        k.ball(0.075 - i * 0.004, i % 2 ? v.mane2 : v.mane, 0, y, z, 8);
      }
      k.cbox(0.16, 0.08, 0.05, v.accent, -0.06, 0.52, -0.86, [0, 0, 0.4]);
      k.cbox(0.16, 0.08, 0.05, v.accent, 0.06, 0.52, -0.86, [0, 0, -0.4]);
      k.cbox(0.05, 0.05, 0.06, shade(v.accent, -0.15), 0, 0.52, -0.865);
      k.cbox(0.16, 0.18, 0.12, v.mane, 0, 0.39, -0.86);
    } else {
      k.cbox(0.2, 0.18, 0.22, v.mane, 0, 1.18, -0.76, [0.4, 0, 0]);
      k.cbox(0.24, 0.3, 0.2, v.mane2, 0, 0.98, -0.84, [0.25, 0, 0]);
      k.cbox(0.24, 0.26, 0.18, v.mane, 0, 0.74, -0.88, [0.12, 0, 0]);
      k.cbox(0.2, 0.22, 0.16, v.mane2, 0, 0.52, -0.9);
      k.cbox(0.14, 0.12, 0.12, v.mane, 0, 0.38, -0.9);
    }
  });
  // head
  const H = rig.head = pivot(B, B.userData.w, [0, 1.74, 0.84]);
  part(H, `${K}:head`, (k) => {
    k.cbox(0.4, 0.42, 0.42, v.body, 0, 1.9, 0.92);
    k.cbox(0.32, 0.3, 0.4, v.muzzle || v.body, 0, 1.73, 1.2); // long muzzle
    k.cbox(0.3, 0.1, 0.3, v.body, 0, 1.87, 1.16);
    k.cbox(0.055, 0.04, 0.012, shade(v.muzzle || v.body, -0.35), -0.08, 1.77, 1.405);
    k.cbox(0.055, 0.04, 0.012, shade(v.muzzle || v.body, -0.35), 0.08, 1.77, 1.405);
    k.cbox(0.13, 0.018, 0.012, '#7A3E5A', 0, 1.64, 1.405);
    k.cbox(0.05, 0.018, 0.012, '#7A3E5A', -0.075, 1.652, 1.405, [0, 0, -0.45]);
    k.cbox(0.05, 0.018, 0.012, '#7A3E5A', 0.075, 1.652, 1.405, [0, 0, 0.45]);
    k.cbox(0.012, 0.06, 0.1, BLUSH, -0.161, 1.74, 1.26);
    k.cbox(0.012, 0.06, 0.1, BLUSH, 0.161, 1.74, 1.26);
    if (v.blaze) {
      k.cbox(0.09, 0.2, 0.012, v.blaze, 0, 2.02, 1.134);
      k.cbox(0.08, 0.012, 0.36, v.blaze, 0, 1.925, 1.16);
      k.cbox(0.1, 0.12, 0.012, v.blaze, 0, 1.8, 1.405);
    }
    if (v.patch) k.cbox(0.012, 0.2, 0.24, v.patch, 0.201, 1.95, 0.9);
    // bridle in the accent color
    k.cbox(0.34, 0.04, 0.42, shade(v.accent, -0.05), 0, 1.845, 1.2);
    for (const s of [-1, 1]) {
      k.cbox(0.02, 0.28, 0.04, shade(v.accent, -0.05), s * 0.205, 1.9, 0.98);
      k.ball(0.03, GOLD, s * 0.172, 1.845, 1.3, 8);
    }
    // forelock
    k.cbox(0.24, 0.16, 0.1, v.mane, 0, 2.12, 1.1, [0.2, 0, 0]);
    k.cbox(0.1, 0.18, 0.08, v.mane2, -0.08, 2.04, 1.13, [0.2, 0, 0.25]);
    if (braids) k.ball(0.05, v.accent, 0.1, 2.16, 1.1, 8);
  });
  rig.eyes.push(
    eyeMesh(H, K, -0.11, 1.98, 1.137, 0.11, 0.14, { lashes: -1 }),
    eyeMesh(H, K, 0.11, 1.98, 1.137, 0.11, 0.14, { lashes: 1 }),
  );
  for (const s of [-1, 1]) {
    const ear = pivot(H, H.userData.w, [s * 0.14, 2.1, 0.84]);
    part(ear, `${K}:ear${s}`, (k) => {
      k.cyl(0.08, 0.2, v.body, s * 0.14, 2.1, 0.84, 4, [0, Math.PI / 4, 0], 0);
      k.cyl(0.045, 0.12, '#FFB6CB', s * 0.14, 2.1, 0.868, 4, [0, Math.PI / 4, 0], 0);
    });
    rig.ears.push(ear);
  }
  H.scale.setScalar(1.16); // a big, sweet chibi head
  rig.seatHeight = HORSE.seat;
}
