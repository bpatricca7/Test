// The turtle: slow and sweet on land, a fast little swimmer in water, with a stacked dome
// shell in cute patterns (green scutes, rainbow layers, pink spots, ocean, starry). When
// tickled it pulls its head, legs and tail into the shell and peeks back out (anim 'hide').

import { shade } from '../../core/util.js';
import { BLUSH, RAINBOW, pivot, part, partL, eyeMesh } from './rig.js';

export const TURTLE = {
  name: 'Turtle', voice: 'bloop', happy: 'bloop', treat: 'strawberry', gait: 'crawl', trick: 'spin', swims: true,
  speed: 2.1, run: 3.4, swimBoost: 2.3, halfW: 0.3, height: 0.5, shadow: 0.95, tagY: 0.9, hop: 7.0, scale: 1.12,
  hideOnTickle: true,
  names: ['Shelly', 'Sheldon', 'Myrtle', 'Pebbles', 'Tiny', 'Squirt', 'Bubbles', 'Speedy'],
  variants: [
    { key: 'green', name: 'Leafy Green', skin: '#9FDF8C', shell: '#5FB86A', rim: '#4E9C57', belly: '#FFF1B8', pattern: 'scutes', mark: '#3E8A4C', accent: '#FF6FA5' },
    { key: 'rainbow', name: 'Rainbow', skin: '#A7E6B0', shell: '#FFE27A', rim: '#FF7A9A', belly: '#FFF6D8', pattern: 'rainbow', mark: '#FFFFFF', accent: '#9C7BFF' },
    { key: 'pinkspots', name: 'Pink Spots', skin: '#B8EFD2', shell: '#FF9CC8', rim: '#F07AB0', belly: '#FFF3F8', pattern: 'spots', mark: '#FFFFFF', mark2: '#FF5FA2', accent: '#3FD8B0' },
    { key: 'ocean', name: 'Ocean', skin: '#A6E3E0', shell: '#3FB8C8', rim: '#2F97A8', belly: '#FFF4D6', pattern: 'scutes', mark: '#FFD86B', accent: '#FFC94D' },
    { key: 'starry', name: 'Starry', skin: '#C9E8A8', shell: '#9C86E8', rim: '#7E68CC', belly: '#FFF6E0', pattern: 'stars', mark: '#FFE27A', accent: '#FF8CC6' },
  ],
};

function shellPattern(k, v) {
  const top = 0.527;
  switch (v.pattern) {
    case 'rainbow': {
      // every layer of the dome a different color, a white heart on top
      k.cbox(0.622, 0.121, 0.702, RAINBOW[1], 0, 0.27, 0);
      k.cbox(0.542, 0.101, 0.602, RAINBOW[2], 0, 0.37, 0);
      k.cbox(0.422, 0.081, 0.462, RAINBOW[3], 0, 0.45, 0);
      k.cbox(0.262, 0.051, 0.302, RAINBOW[4], 0, 0.5, 0);
      k.cbox(0.08, 0.012, 0.08, RAINBOW[5], -0.04, top, 0.02, [0, 0.785, 0]);
      k.cbox(0.08, 0.012, 0.08, RAINBOW[5], 0.04, top, 0.02, [0, 0.785, 0]);
      k.cbox(0.09, 0.012, 0.09, RAINBOW[5], 0, top, -0.03, [0, 0.785, 0]);
      break;
    }
    case 'spots': {
      const S = [[0, top, 0, 0.1], [-0.12, 0.476, 0.14, 0.07], [0.13, 0.476, -0.1, 0.07], [-0.1, 0.476, -0.16, 0.06], [0.12, 0.476, 0.15, 0.06]];
      S.forEach(([x, y, z, w], i) => k.cbox(w, 0.012, w, i % 2 ? v.mark2 : v.mark, x, y, z));
      for (const s of [-1, 1]) {
        k.cbox(0.012, 0.06, 0.06, v.mark, s * 0.311, 0.28, 0.12);
        k.cbox(0.012, 0.05, 0.05, v.mark2, s * 0.311, 0.29, -0.14);
        k.cbox(0.012, 0.045, 0.045, v.mark, s * 0.271, 0.38, -0.02);
      }
      k.cbox(0.06, 0.05, 0.012, v.mark2, 0.1, 0.29, 0.351);
      k.cbox(0.05, 0.045, 0.012, v.mark, -0.12, 0.3, 0.351);
      k.cbox(0.06, 0.05, 0.012, v.mark, 0, 0.29, -0.351);
      break;
    }
    case 'stars': {
      const star = (x, y, z, s) => {
        k.cbox(s, 0.012, s * 0.3, v.mark, x, y, z);
        k.cbox(s * 0.3, 0.012, s, v.mark, x, y, z);
        k.cbox(s * 0.62, 0.012, s * 0.62, v.mark, x, y, z, [0, 0.785, 0]);
      };
      star(0, top, 0, 0.14);
      star(-0.15, 0.476, 0.13, 0.08);
      star(0.14, 0.476, -0.12, 0.08);
      star(0.15, 0.476, 0.14, 0.06);
      star(-0.14, 0.476, -0.15, 0.06);
      for (const s of [-1, 1]) k.cbox(0.012, 0.05, 0.05, v.mark, s * 0.311, 0.28, 0.02, [0.785, 0, 0]);
      break;
    }
    default: {
      // scutes: a plate on top, a ring of plates around it and lines down the sides
      k.cbox(0.16, 0.012, 0.18, v.mark, 0, top, 0);
      k.cbox(0.12, 0.012, 0.14, shade(v.shell, 0.1), 0, top + 0.002, 0);
      for (const [x, z] of [[-0.14, 0.15], [0.14, 0.15], [-0.14, -0.15], [0.14, -0.15], [0, 0.22], [0, -0.22]]) {
        k.cbox(0.1, 0.012, 0.1, v.mark, x, 0.476, z);
        k.cbox(0.07, 0.012, 0.07, shade(v.shell, 0.08), x, 0.478, z);
      }
      for (const s of [-1, 1]) {
        for (const z of [-0.18, 0, 0.18]) k.cbox(0.012, 0.08, 0.016, v.mark, s * 0.311, 0.28, z);
        for (const z of [-0.12, 0.12]) k.cbox(0.012, 0.06, 0.016, v.mark, s * 0.271, 0.38, z);
      }
      for (const x of [-0.12, 0.12]) k.cbox(0.016, 0.08, 0.012, v.mark, x, 0.28, 0.351);
    }
  }
}

export function buildTurtle(rig, v) {
  const K = `turtle:${v.key}`;
  const hipY = 0.13;
  rig.legLen = 0.12;
  rig.canHide = true;
  rig.lashes = true;
  const B = rig.body = pivot(rig.jumper, [0, 0, 0], [0, hipY, 0]);
  rig.bodyY = B.position.y;
  // four stubby legs under the rim
  for (const [i, lx, lz] of [[0, -0.24, 0.2], [1, 0.24, 0.2], [2, -0.24, -0.2], [3, 0.24, -0.2]]) {
    const leg = pivot(B, B.userData.w, [lx, hipY, lz]);
    partL(leg, `${K}:leg`, (k) => {
      k.cbox(0.15, 0.14, 0.17, v.skin, 0, -0.06, 0);
      k.cbox(0.17, 0.04, 0.2, shade(v.skin, -0.08), 0, -0.11, 0.015);
      k.cbox(0.035, 0.02, 0.03, '#FFFFFF', -0.05, -0.12, 0.11);
      k.cbox(0.035, 0.02, 0.03, '#FFFFFF', 0.05, -0.12, 0.11);
    });
    rig.legs.push(leg);
    (i < 2 ? rig.front : rig.back).push(leg);
  }
  part(B, `${K}:shell`, (k) => {
    k.cbox(0.56, 0.06, 0.66, v.belly, 0, 0.14, 0); // plastron
    k.cbox(0.68, 0.07, 0.78, v.rim, 0, 0.2, 0); // rim
    k.cbox(0.62, 0.12, 0.7, v.shell, 0, 0.27, 0);
    k.cbox(0.54, 0.1, 0.6, shade(v.shell, 0.04), 0, 0.37, 0);
    k.cbox(0.42, 0.08, 0.46, shade(v.shell, 0.08), 0, 0.45, 0);
    k.cbox(0.26, 0.05, 0.3, shade(v.shell, 0.12), 0, 0.5, 0);
    // rim notches
    for (const s of [-1, 1]) for (const z of [-0.26, 0, 0.26]) k.cbox(0.012, 0.05, 0.1, shade(v.rim, 0.12), s * 0.341, 0.2, z);
    shellPattern(k, v);
  });
  rig.tail = pivot(B, B.userData.w, [0, 0.19, -0.36]);
  part(rig.tail, `${K}:tail`, (k) => {
    k.cbox(0.09, 0.07, 0.14, v.skin, 0, 0.17, -0.42, [0.35, 0, 0]);
    k.cbox(0.05, 0.045, 0.06, v.skin, 0, 0.14, -0.5, [0.5, 0, 0]);
  });
  const H = rig.head = pivot(B, B.userData.w, [0, 0.26, 0.36]);
  const hy = 0.1; // the head sits up on its neck, peeking over the rim
  part(H, `${K}:head`, (k) => {
    k.cbox(0.17, 0.2, 0.16, v.skin, 0, 0.3, 0.42, [-0.3, 0, 0]); // neck
    k.cbox(0.32, 0.28, 0.28, v.skin, 0, 0.34 + hy, 0.55); // a big, round head
    k.cbox(0.26, 0.05, 0.22, shade(v.skin, 0.1), 0, 0.49 + hy, 0.55);
    k.cbox(0.22, 0.09, 0.05, shade(v.skin, 0.14), 0, 0.26 + hy, 0.68); // snout
    k.cbox(0.024, 0.02, 0.01, '#3A5A3A', -0.035, 0.29 + hy, 0.707);
    k.cbox(0.024, 0.02, 0.01, '#3A5A3A', 0.035, 0.29 + hy, 0.707);
    k.cbox(0.05, 0.016, 0.01, '#3A2A33', -0.03, 0.247 + hy, 0.707, [0, 0, -0.4]);
    k.cbox(0.05, 0.016, 0.01, '#3A2A33', 0.03, 0.247 + hy, 0.707, [0, 0, 0.4]);
    k.cbox(0.07, 0.034, 0.012, BLUSH, -0.115, 0.3 + hy, 0.695);
    k.cbox(0.07, 0.034, 0.012, BLUSH, 0.115, 0.3 + hy, 0.695);
    // a little bow in the accent color on top of the head
    k.cbox(0.08, 0.06, 0.03, v.accent, -0.05, 0.515 + hy, 0.6, [0, 0, 0.3]);
    k.cbox(0.08, 0.06, 0.03, v.accent, 0.05, 0.515 + hy, 0.6, [0, 0, -0.3]);
    k.cbox(0.035, 0.04, 0.04, shade(v.accent, -0.15), 0, 0.515 + hy, 0.605);
  });
  rig.eyes.push(
    eyeMesh(H, K, -0.08, 0.375 + hy, 0.698, 0.085, 0.11, { lashes: -1 }),
    eyeMesh(H, K, 0.08, 0.375 + hy, 0.698, 0.085, 0.11, { lashes: 1 }),
  );
}
