// Placeholder avatar: a simple blocky chibi built from boxes colored by the look, with walk,
// swim, fly, sit, sleep and a few emote animations. Implements the full createAvatar API;
// the Avatar & Dress-up team replaces the model (outfits, hair styles, accessories).
//
// Conventions: origin at the feet, ~1.75 tall, faces +Z. When sitting, the group origin is
// the seat surface (hips rest there). When sleeping, the origin is the mattress top center
// and the body lies along local Z with the head toward -Z.

import * as THREE from 'three';
import { box, mat, disposeObject } from '../core/models.js';
import { shade } from '../core/util.js';
import { DEFAULT_LOOK, normalizeLook } from './wardrobe-data.js';

const HIP = 0.72;
const SHOULDER = 1.18;
const NECK = 1.22;

function faceTexture(look) {
  const c = document.createElement('canvas');
  c.width = 32;
  c.height = 32;
  const g = c.getContext('2d');
  g.fillStyle = look.skin;
  g.fillRect(0, 0, 32, 32);
  const eye = look.eyes.color;
  // big sparkly eyes
  for (const ex of [7, 19]) {
    g.fillStyle = '#FFFFFF';
    g.fillRect(ex, 13, 6, 8);
    g.fillStyle = eye;
    g.fillRect(ex + 1, 13, 5, 8);
    g.fillStyle = shade(eye, -0.45);
    g.fillRect(ex + 2, 15, 3, 5);
    g.fillStyle = '#FFFFFF';
    g.fillRect(ex + 2, 14, 2, 2);
    g.fillRect(ex + 4, 18, 1, 1);
    if (look.eyes.lashes) {
      g.fillStyle = '#2B1B24';
      g.fillRect(ex, 12, 6, 1);
      g.fillRect(ex === 7 ? ex - 1 : ex + 6, 12, 1, 2);
    }
  }
  if (look.face.blush) {
    g.fillStyle = 'rgba(255,120,160,0.55)';
    g.fillRect(4, 22, 4, 2);
    g.fillRect(24, 22, 4, 2);
  }
  if (look.face.freckles) {
    g.fillStyle = shade(look.skin, -0.25);
    for (const [x, y] of [[6, 21], [8, 22], [24, 21], [26, 22]]) g.fillRect(x, y, 1, 1);
  }
  // smile
  g.fillStyle = '#B03A5B';
  g.fillRect(14, 25, 4, 1);
  g.fillRect(13, 24, 1, 1);
  g.fillRect(18, 24, 1, 1);
  if (look.face.smile === 'open' || look.face.smile === 'grin') {
    g.fillStyle = '#FF7FA4';
    g.fillRect(14, 26, 4, 1);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  return t;
}

const LONG_HAIR = new Set(['long', 'wavy_long', 'braids', 'curly', 'side_pony']);

/** Hair material with soft strands and a shine band (shared per color). */
const hairMats = new Map();
function hairMaterial(color) {
  let m = hairMats.get(color);
  if (m) return m;
  const c = document.createElement('canvas');
  c.width = 16;
  c.height = 16;
  const g = c.getContext('2d');
  for (let x = 0; x < 16; x++) {
    g.fillStyle = shade(color, x % 3 === 0 ? -0.12 : x % 3 === 1 ? 0.04 : -0.03);
    g.fillRect(x, 0, 1, 16);
  }
  g.fillStyle = shade(color, 0.22);
  for (let x = 0; x < 16; x += 2) g.fillRect(x, 3 + (x % 4 === 0 ? 0 : 1), 1, 2);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.userData.shared = true;
  m = new THREE.MeshLambertMaterial({ map: t });
  m.userData.shared = true;
  hairMats.set(color, m);
  return m;
}

export function createAvatar(lookIn = DEFAULT_LOOK) {
  const group = new THREE.Group();
  group.name = 'avatar';
  const root = new THREE.Group(); // animated body root (bob, lie down, spin)
  group.add(root);
  let parts = null;
  let look = normalizeLook(lookIn);
  let t = 0;
  let emote = null; // { name, time, duration }

  function build() {
    if (parts) {
      root.remove(parts.body);
      disposeObject(parts.body);
    }
    const body = new THREE.Group();
    const dress = look.dress;
    const topColor = dress ? dress.color : look.top.color;
    const bottomColor = dress ? dress.color : look.bottom.color;
    const bare = dress || ['skirt', 'tutu', 'shorts', 'pleated'].includes(look.bottom.type);
    const legColor = bare ? look.skin : bottomColor;

    // legs hang from hip pivots
    const legs = [];
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(side * 0.12, HIP, 0);
      pivot.add(box(0.2, 0.6, 0.22, legColor, -0.1, -0.6, -0.11));
      pivot.add(box(0.22, 0.13, 0.3, look.shoes.color, -0.11, -0.72, -0.12));
      body.add(pivot);
      legs.push(pivot);
    }
    // torso + skirt
    body.add(box(0.46, 0.5, 0.26, topColor, -0.23, HIP, -0.13));
    if (dress || ['skirt', 'tutu', 'pleated'].includes(look.bottom.type)) {
      const flare = look.bottom.type === 'tutu' ? 0.72 : 0.6;
      body.add(box(flare, 0.26, 0.4, bottomColor, -flare / 2, HIP - 0.18, -0.2));
      body.add(box(flare - 0.1, 0.06, 0.34, shade(bottomColor, 0.25), -(flare - 0.1) / 2, HIP + 0.06, -0.17));
    } else if (look.bottom.type === 'shorts') {
      body.add(box(0.48, 0.2, 0.28, bottomColor, -0.24, HIP - 0.14, -0.14));
    }
    // arms hang from shoulder pivots
    const arms = [];
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(side * 0.31, SHOULDER, 0);
      pivot.add(box(0.15, 0.26, 0.17, topColor, -0.075, -0.26, -0.085));
      pivot.add(box(0.14, 0.22, 0.16, look.skin, -0.07, -0.47, -0.08));
      body.add(pivot);
      arms.push(pivot);
    }
    // head with a painted face on the front (+Z)
    const head = new THREE.Group();
    head.position.set(0, NECK, 0);
    const skinMat = mat(look.skin);
    const faceMat = new THREE.MeshLambertMaterial({ map: faceTexture(look) });
    const headMesh = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.52, 0.5), [skinMat, skinMat, skinMat, skinMat, faceMat, skinMat]);
    headMesh.position.set(0, 0.27, 0);
    head.add(headMesh);
    // hair: cap, bangs, and a back panel for long styles
    const hc = hairMaterial(look.hair.color);
    const long = LONG_HAIR.has(look.hair.style);
    head.add(box(0.6, 0.14, 0.54, hc, -0.3, 0.46, -0.27));
    head.add(box(0.6, 0.1, 0.06, hc, -0.3, 0.42, 0.22));
    head.add(box(0.06, 0.34, 0.54, hc, -0.31, 0.16, -0.27));
    head.add(box(0.06, 0.34, 0.54, hc, 0.25, 0.16, -0.27));
    // back of the head, then a narrower lower layer for long styles (reads as hair, not a slab)
    head.add(box(0.6, 0.44, 0.08, hc, -0.3, 0.1, -0.31));
    if (long) head.add(box(0.5, 0.42, 0.08, hc, -0.25, -0.32, -0.3));
    if (look.hair.style === 'ponytail' || look.hair.style === 'bun' || look.hair.style === 'space_buns') {
      head.add(box(0.2, 0.2, 0.2, hc, -0.1, 0.4, -0.42));
    }
    if (look.hair.style === 'pigtails') {
      head.add(box(0.14, 0.3, 0.14, hc, -0.42, 0.1, -0.1));
      head.add(box(0.14, 0.3, 0.14, hc, 0.28, 0.1, -0.1));
    }
    if (long) {
      const bow = look.acc.headColor || '#FF5FA2';
      head.add(box(0.12, 0.1, 0.05, bow, -0.13, 0.05, -0.36));
      head.add(box(0.12, 0.1, 0.05, bow, 0.01, 0.05, -0.36));
      head.add(box(0.06, 0.07, 0.06, shade(bow, -0.15), -0.03, 0.065, -0.37));
    }
    if (look.acc.head && look.acc.head !== 'none') {
      const ac = look.acc.headColor || '#FF5FA2';
      head.add(box(0.14, 0.12, 0.08, ac, 0.1, 0.5, 0.12));
      head.add(box(0.14, 0.12, 0.08, ac, 0.26, 0.5, 0.12));
      head.add(box(0.06, 0.08, 0.1, shade(ac, -0.15), 0.23, 0.52, 0.11));
    }
    body.add(head);
    root.add(body);
    parts = { body, legs, arms, head };
  }

  build();

  function resetPose() {
    root.position.set(0, 0, 0);
    root.rotation.set(0, 0, 0);
    for (const l of parts.legs) l.rotation.set(0, 0, 0);
    for (const a of parts.arms) a.rotation.set(0, 0, 0);
    parts.head.rotation.set(0, 0, 0);
  }

  return {
    group,
    get look() {
      return look;
    },
    setLook(newLook) {
      look = normalizeLook(newLook);
      build();
    },
    /** state: { speed, onGround, swimming, flying, sitting, sleeping, riding } */
    update(dt, state = {}) {
      t += dt;
      resetPose();
      const [legL, legR] = parts.legs;
      const [armL, armR] = parts.arms;
      const speed = state.speed || 0;
      if (state.sleeping) {
        root.rotation.x = -Math.PI / 2;
        root.position.set(0, 0.25, 0.875);
        armL.rotation.z = 0.15;
        armR.rotation.z = -0.15;
        root.position.y += Math.sin(t * 1.4) * 0.01;
        emote = null;
        return;
      }
      if (state.sitting || state.riding) {
        root.position.y = -HIP + (state.riding ? 0.05 : 0);
        legL.rotation.x = legR.rotation.x = -Math.PI / 2 + (state.riding ? 0.5 : 0);
        if (state.riding) { legL.rotation.z = 0.5; legR.rotation.z = -0.5; }
        armL.rotation.x = armR.rotation.x = -0.4;
        return;
      }
      if (state.flying) {
        root.rotation.x = 0.25 + Math.min(0.3, speed * 0.04);
        armL.rotation.z = 1.1 + Math.sin(t * 5) * 0.15;
        armR.rotation.z = -1.1 - Math.sin(t * 5) * 0.15;
        legL.rotation.x = 0.25 + Math.sin(t * 3) * 0.1;
        legR.rotation.x = 0.25 - Math.sin(t * 3) * 0.1;
        root.position.y = Math.sin(t * 2.2) * 0.05;
        return;
      }
      if (state.swimming) {
        root.rotation.x = 0.5;
        armL.rotation.x = Math.sin(t * 5) * 1.2 - 1.5;
        armR.rotation.x = -Math.sin(t * 5) * 1.2 - 1.5;
        legL.rotation.x = Math.sin(t * 7) * 0.4;
        legR.rotation.x = -Math.sin(t * 7) * 0.4;
        return;
      }
      if (emote) {
        emote.time += dt;
        const e = emote.time;
        if (emote.time >= emote.duration || speed > 0.5) emote = null;
        else {
          switch (emote.name) {
            case 'wave':
              armR.rotation.z = -2.5 + Math.sin(e * 10) * 0.35;
              break;
            case 'twirl':
              root.rotation.y = (e / emote.duration) * Math.PI * 2;
              armL.rotation.z = 1.2; armR.rotation.z = -1.2;
              break;
            case 'jump':
              root.position.y = Math.abs(Math.sin(e * 6)) * 0.45;
              armL.rotation.z = 2.6; armR.rotation.z = -2.6;
              break;
            case 'cartwheel':
              root.position.y = 0.9;
              root.rotation.z = (e / emote.duration) * Math.PI * 2;
              root.position.y = 0.9 - Math.cos(root.rotation.z) * 0.9;
              armL.rotation.z = 2.8; armR.rotation.z = -2.8;
              break;
            case 'heart':
              armL.rotation.x = armR.rotation.x = -2.6;
              armL.rotation.z = -0.4; armR.rotation.z = 0.4;
              break;
            case 'sit':
              root.position.y = -HIP + 0.1;
              legL.rotation.x = legR.rotation.x = -Math.PI / 2;
              break;
            default: // dance
              root.position.y = Math.abs(Math.sin(e * 8)) * 0.1;
              root.rotation.y = Math.sin(e * 4) * 0.4;
              armL.rotation.z = 2.2 + Math.sin(e * 8) * 0.5;
              armR.rotation.z = -2.2 + Math.sin(e * 8) * 0.5;
          }
          return;
        }
      }
      // walk cycle scaled by speed; gentle breathing when idle
      const amp = Math.min(1, speed / 4.3) * 0.75;
      const ph = t * (4 + speed * 1.6);
      legL.rotation.x = Math.sin(ph) * amp;
      legR.rotation.x = -Math.sin(ph) * amp;
      armL.rotation.x = -Math.sin(ph) * amp * 0.8;
      armR.rotation.x = Math.sin(ph) * amp * 0.8;
      if (!state.onGround && speed >= 0) {
        armL.rotation.z = 0.5; armR.rotation.z = -0.5;
      }
      root.position.y = amp > 0.05 ? Math.abs(Math.sin(ph)) * 0.05 : Math.sin(t * 2) * 0.012;
      parts.head.rotation.y = amp > 0.05 ? 0 : Math.sin(t * 0.7) * 0.12;
    },
    /** 'wave'|'dance'|'twirl'|'cartwheel'|'jump'|'heart'|'sit'. Returns duration (s). */
    playEmote(name) {
      const durations = { wave: 2, dance: 3, twirl: 1.2, cartwheel: 1.3, jump: 1.6, heart: 2, sit: 3 };
      const duration = durations[name] || 2;
      emote = { name, time: 0, duration };
      return duration;
    },
    dispose() {
      if (parts) disposeObject(parts.body);
      group.clear();
    },
  };
}

export function install(game) {
  game.createAvatar = createAvatar;
  game.defaultLook = DEFAULT_LOOK;
}
