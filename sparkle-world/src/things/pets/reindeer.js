// wave 5 (reindeer team, docs/teams/reindeer.md): the reindeer, a rideable pet like the pony,
// a little taller, with branching antlers, ears out to the side, a fluffy cream chest ruff, a
// white tail flash, a dark nose (every coat: nothing borrowed), a holiday saddle blanket with
// gold bells and a soft bell collar in the accent color. Face +Z, origin at the hooves.
//
// Flying: the spec's `flies` is a getter that asks the sky check the reindeer module sets
// (setReindeerSky: true in Holiday Village). pet.js reads spec.flies while she rides, so a
// ridden reindeer glides and flies like the unicorn there, and hops like the pony elsewhere.
// A broken or missing check never flies.

import { shade } from '../../core/util.js';
import { BLUSH, GOLD, pivot, part, partL, eyeMesh } from './rig.js';

let skyCheck = null;

/** The reindeer module's "may a reindeer fly here?" (a function, or null: never). */
export function setReindeerSky(fn) {
  skyCheck = typeof fn === 'function' ? fn : null;
}

function skyNow() {
  if (!skyCheck) return false;
  try {
    return skyCheck() === true;
  } catch {
    return false;
  }
}

export const REINDEER = {
  name: 'Reindeer', voice: 'reindeer', happy: 'jingle', treat: 'carrot', gait: 'trot', trick: 'rear', rideable: true,
  speed: 5.0, run: 8.2, halfW: 0.36, height: 1.3, shadow: 1.35, tagY: 2.3, hop: 8.8, seat: 1.1, scale: 1,
  get flies() { return skyNow(); },
  names: ['Snowberry', 'Pinecone', 'Flurry', 'Hazel', 'Bramble', 'Aspen', 'Clementine', 'Juniper'],
  variants: [
    { key: 'cocoa', name: 'Cocoa', body: '#A9734B', light: '#F2DCC2', ruff: '#FFF4E6', antler: '#E8D2A6', nose: '#4A332A', hoof: '#4E3326', accent: '#E8304A' },
    { key: 'snowy', name: 'Snowy', body: '#F4EFE8', light: '#FFFFFF', ruff: '#FFFFFF', antler: '#D9C29A', nose: '#5A4A55', hoof: '#9C8E86', accent: '#2FA36B' },
    { key: 'caramel', name: 'Caramel', body: '#D49A62', light: '#FFEBD2', ruff: '#FFF6E8', antler: '#F0DDB5', nose: '#4A332A', hoof: '#6B4A33', accent: '#3B6FD8' },
    { key: 'chocolate', name: 'Chocolate', body: '#6E4A36', light: '#C9A487', ruff: '#EBD8C2', antler: '#E8D2A6', nose: '#2E2026', hoof: '#3A2820', accent: '#FFC94D' },
    { key: 'frost', name: 'Frost', body: '#C9D6E8', light: '#F2F7FF', ruff: '#FFFFFF', antler: '#BFE6FF', nose: '#56607E', hoof: '#7F8FB0', accent: '#9C5BD6' },
    { key: 'rosy', name: 'Rosy', body: '#E8B4A8', light: '#FFF0EC', ruff: '#FFFFFF', antler: '#F6E0B8', nose: '#6E4656', hoof: '#8A5A60', accent: '#FF6FA5' },
  ],
};

const HIP = 0.56; // leg pivot height

export function buildReindeer(rig, v) {
  const K = `reindeer:${v.key}`;
  rig.legLen = HIP;
  rig.lashes = true;
  const B = rig.body = pivot(rig.jumper, [0, 0, 0], [0, HIP, -0.32]);
  rig.bodyY = B.position.y;
  // slender legs with a pale band and dark hooves
  for (const [i, lx, lz] of [[0, -0.14, 0.3], [1, 0.14, 0.3], [2, -0.14, -0.32], [3, 0.14, -0.32]]) {
    const leg = pivot(B, B.userData.w, [lx, HIP, lz]);
    partL(leg, `${K}:leg`, (k) => {
      k.cbox(0.14, 0.4, 0.15, v.body, 0, -0.2, 0);
      k.cbox(0.12, 0.14, 0.13, shade(v.body, -0.08), 0, -0.44, 0);
      k.cbox(0.15, 0.04, 0.16, v.light, 0, -0.39, 0.002);
      k.cbox(0.16, 0.07, 0.17, v.hoof, 0, -0.525, 0.006);
    });
    rig.legs.push(leg);
    (i < 2 ? rig.front : rig.back).push(leg);
  }
  part(B, `${K}:body`, (k) => {
    k.cbox(0.52, 0.42, 0.88, v.body, 0, 0.78, -0.02);
    k.cbox(0.4, 0.02, 0.6, v.light, 0, 0.565, -0.02);
    // the fluffy chest ruff: a bib and a few tufts hanging down
    k.cbox(0.42, 0.34, 0.12, v.ruff, 0, 0.86, 0.44);
    for (const [x, y] of [[-0.12, 0.66], [0, 0.63], [0.12, 0.66]]) k.cbox(0.12, 0.1, 0.1, v.ruff, x, y, 0.46, [0, 0, 0.785]);
    // neck, rising forward, with a cream throat
    k.cbox(0.3, 0.42, 0.3, v.body, 0, 1.06, 0.36, [0.3, 0, 0]);
    k.cbox(0.22, 0.3, 0.04, v.ruff, 0, 1.0, 0.52, [0.3, 0, 0]);
    // a holiday saddle: blanket with gold trim and little bells, seat, pommel, stirrups
    k.cbox(0.62, 0.03, 0.46, v.accent, 0, 1.0, -0.08);
    for (const s of [-1, 1]) {
      k.cbox(0.02, 0.24, 0.42, v.accent, s * 0.272, 0.88, -0.08);
      k.cbox(0.024, 0.03, 0.42, GOLD, s * 0.274, 0.77, -0.08);
      for (const z of [-0.24, -0.08, 0.08]) k.ball(0.035, GOLD, s * 0.285, 0.74, z, 8);
      k.cbox(0.018, 0.13, 0.018, '#C9A94A', s * 0.288, 0.7, -0.06);
      k.cbox(0.05, 0.022, 0.08, GOLD, s * 0.288, 0.63, -0.06);
    }
    k.cbox(0.46, 0.07, 0.34, shade(v.accent, -0.12), 0, 1.04, -0.08);
    k.cbox(0.14, 0.09, 0.07, shade(v.accent, -0.2), 0, 1.1, 0.08);
    k.cbox(0.34, 0.07, 0.06, shade(v.accent, -0.2), 0, 1.09, -0.24);
    // the bell collar round the neck and its gold bell
    k.cbox(0.36, 0.08, 0.34, v.accent, 0, 1.0, 0.4, [0.3, 0, 0]);
    k.ball(0.065, GOLD, 0, 0.9, 0.58, 10);
    k.cbox(0.05, 0.016, 0.012, shade(GOLD, -0.4), 0, 0.875, 0.645);
    for (const s of [-1, 1]) k.ball(0.035, GOLD, s * 0.15, 0.97, 0.5, 8);
  });
  // a short tail with a white flash under it
  rig.tail = pivot(B, B.userData.w, [0, 0.92, -0.46]);
  part(rig.tail, `${K}:tail`, (k) => {
    k.cbox(0.16, 0.16, 0.1, v.body, 0, 0.94, -0.5, [0.5, 0, 0]);
    k.cbox(0.14, 0.12, 0.06, '#FFFFFF', 0, 0.88, -0.53, [0.5, 0, 0]);
  });
  // head: a soft square face, a pale muzzle, a dark nose, blush, a forehead tuft, antlers
  const H = rig.head = pivot(B, B.userData.w, [0, 1.18, 0.44]);
  part(H, `${K}:head`, (k) => {
    k.cbox(0.44, 0.42, 0.42, v.body, 0, 1.33, 0.58);
    k.cbox(0.3, 0.2, 0.17, v.light, 0, 1.2, 0.84);
    k.cbox(0.15, 0.09, 0.04, v.nose, 0, 1.27, 0.93);
    k.cbox(0.06, 0.03, 0.012, '#FFFFFF', -0.035, 1.295, 0.952);
    k.cbox(0.1, 0.018, 0.012, shade(v.nose, 0.15), 0, 1.15, 0.926);
    k.cbox(0.08, 0.04, 0.012, BLUSH, -0.17, 1.27, 0.792);
    k.cbox(0.08, 0.04, 0.012, BLUSH, 0.17, 1.27, 0.792);
    k.cbox(0.2, 0.08, 0.12, v.ruff, 0, 1.56, 0.66);
    // antlers: a beam up and out each side, tines forward, out and up, round tips
    const a = v.antler;
    for (const s of [-1, 1]) {
      k.cbox(0.07, 0.26, 0.07, a, s * 0.13, 1.66, 0.5, [0, 0, -s * 0.35]);
      k.cbox(0.06, 0.24, 0.06, a, s * 0.22, 1.88, 0.47, [0, 0, -s * 0.12]);
      k.cbox(0.05, 0.14, 0.05, a, s * 0.29, 1.74, 0.5, [0, 0, -s * 1.0]);
      k.cbox(0.05, 0.13, 0.05, a, s * 0.17, 1.8, 0.58, [0.75, 0, 0]);
      k.cbox(0.05, 0.13, 0.05, a, s * 0.3, 1.96, 0.45, [0, 0, -s * 0.75]);
      k.ball(0.035, a, s * 0.24, 2.0, 0.47, 8);
      k.ball(0.03, a, s * 0.36, 1.78, 0.5, 8);
      k.ball(0.03, a, s * 0.36, 2.0, 0.45, 8);
    }
  });
  rig.eyes.push(
    eyeMesh(H, K, -0.11, 1.38, 0.797, 0.11, 0.145, { lashes: -1 }),
    eyeMesh(H, K, 0.11, 1.38, 0.797, 0.11, 0.145, { lashes: 1 }),
  );
  // ears out to the side (they flick like every pet's)
  for (const s of [-1, 1]) {
    const ear = pivot(H, H.userData.w, [s * 0.22, 1.46, 0.52]);
    part(ear, `${K}:ear${s}`, (k) => {
      k.cbox(0.2, 0.08, 0.11, v.body, s * 0.3, 1.47, 0.52, [0, 0, s * 0.35]);
      k.cbox(0.13, 0.02, 0.07, '#F7B8A8', s * 0.31, 1.5, 0.535, [0, 0, s * 0.35]);
    });
    rig.ears.push(ear);
  }
  rig.seatHeight = REINDEER.seat;
}
