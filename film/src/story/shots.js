// BOLT & LUMA — the whole film as a list of shots. Each shot sets the camera,
// the lighting mood and every character pose as a pure function of time.
import * as THREE from 'three';
import { track, ease, clamp, smoothstep, pulse, lerp, spline, pathAt, noise1, angleLerp } from '../lib/anim.js';
import { LAYOUT } from '../world/common.js';
import { VOICE as V, BEAT } from './timeline.js';

export const FPS = 24;
export const DURATION = BEAT.end;

// ---------------------------------------------------------------- helpers
const TB = [-4.05, 3.2]; // tower base for the stacking gag
const BW = [-3.3, 3.25]; // where Bolt works
const PILE = LAYOUT.pile;
const BOLT_PILE = [-1.5, -4.05];
const HC = [-0.25, -5.75]; // hiding cubes
const HIDE = [-0.75, -5.12];
const HIDE_MID = [-1.0, -5.9];
const REVEAL = [-0.55, -6.62];
const P = LAYOUT.plant;
const SEAT = [-8.0, 8.75];
const SIT_B = [2.05, 0.6];
const SIT_L = [3.15, 0.6];
const GOLD_B = [2.2, 2.6];
const GOLD_L = [3.05, 2.6];

const v3 = new THREE.Vector3();
const spring = (x, amp, freq = 18, damp = 6) => (x <= 0 ? 0 : amp * Math.exp(-damp * x) * Math.sin(freq * x));
const win = (t, a, b) => t >= a && t < b;
const k01 = (t, a, b, e = 'inOutSine') => ease[e](clamp((t - a) / (b - a)));

function boltPose(S, p) {
  S.bolt.root.visible = true;
  S.bolt.pose({ y: S.ground(p.x, p.z), ...p, t: S.t });
  S.bolt.root.updateMatrixWorld(true);
}
function lumaPose(S, p) {
  S.luma.root.visible = true;
  S.luma.pose({ t: S.t, ...p });
  S.luma.root.updateMatrixWorld(true);
}
const handsPos = (S) => {
  const a = new THREE.Vector3(), b = new THREE.Vector3();
  S.bolt.arms[0].hand.getWorldPosition(a);
  S.bolt.arms[1].hand.getWorldPosition(b);
  return a.add(b).multiplyScalar(0.5);
};
const headPos = (S, lift = 0.32) => {
  const h = new THREE.Vector3();
  S.bolt.head.getWorldPosition(h);
  h.y += lift;
  return h;
};
const lumaWorld = (S) => S.luma.root.position.clone();
const heading = (from, to) => Math.atan2(to[0] - from[0], to[1] - from[1]);
function placeCube(S, i, x, y, z, rx = 0, ry = 0, rz = 0, sy = 1) {
  const c = S.heroCubes[i];
  c.visible = true;
  c.position.set(x, y, z);
  c.rotation.set(rx, ry, rz);
  c.scale.set(1 / Math.sqrt(sy), sy, 1 / Math.sqrt(sy));
}
function sproutInCan(S, canPos, rotY = 0, opts = {}) {
  S.can.root.visible = true;
  S.can.root.position.copy(canPos);
  S.can.root.rotation.set(opts.tiltX || 0, rotY, opts.tiltZ || 0);
  S.can.root.updateMatrixWorld(true);
  S.sprout.root.visible = true;
  S.can.sproutAnchor.getWorldPosition(S.sprout.root.position);
  S.sprout.root.rotation.set(opts.tiltX || 0, rotY, opts.tiltZ || 0);
  S.sprout.pose({ t: S.t, glow: opts.glow ?? 0.25, unfurl: opts.unfurl ?? 1, scale: opts.scale ?? 1, halo: opts.halo ?? 1 });
}
function sproutPlanted(S, opts = {}) {
  S.sprout.root.visible = true;
  S.sprout.root.position.set(P[0], S.ground(P[0], P[1]) - 0.01, P[1]);
  S.sprout.root.rotation.set(0, 0.4, 0);
  S.sprout.pose({ t: S.t, glow: opts.glow ?? 0.2, unfurl: opts.unfurl ?? 1, scale: opts.scale ?? 1.35, halo: opts.halo ?? 1 });
}

// Global continuity that depends only on time.
export function bloomRadiusAt(t) {
  if (t < 123.6) return -20;
  return track([[123.6, 0], [124.6, 2.5, 'outQuad'], [126, 7], [128, 17], [131, 40, 'inOutSine'], [135, 130, 'inQuad'], [138.5, 330, 'outQuad']], t);
}
const heroGrowth = (t) => k01(t, BEAT.treeGrow[0], BEAT.treeGrow[1], 'inOutCubic');
function worldState(S, t) {
  S.shared.uBloomRadius.value = bloomRadiusAt(t);
  S.shared.uFrontGlow.value = t > 123.4 ? 0.9 * (1 - smoothstep(128, 139, t)) + 0.8 * pulse(t, 123.4, 124.4, 0.1, 0.8) : 0;
  S.terrain.uniforms.uSoil.value.w = t < 102.5 ? 0 : smoothstep(102.5, 103.6, t) * (1 - smoothstep(125, 128, t));
  if (t >= BEAT.treeGrow[0]) S.nature.hero.pose({ grow: heroGrowth(t), t });
  if (t > 131) S.nature.butterflies.update(t, P, smoothstep(132, 136, t));
}

// Dust motes around the camera.
function motes(S, color = [1, 0.85, 0.6], alpha = 0.45, count = 450) {
  const c = S.camera.position;
  const f = S.camera.getWorldDirection(v3).multiplyScalar(5);
  S.fx.motes(S.t, [c.x + f.x, Math.max(S.ground(c.x, c.z), c.y - 2.5), c.z + f.z], { count, radius: 7, height: 4.5, color, alpha });
}

// Tossed-object arc (world space), returns [x,y,z, spin]
function arc(t, t0, dur, from, to, h) {
  const k = clamp((t - t0) / dur);
  return [lerp(from[0], to[0], k), lerp(from[1], to[1], k) + 4 * h * k * (1 - k), lerp(from[2], to[2], k), k];
}

// ---------------------------------------------------------------- shots
const SHOTS_RAW = [
  // A1 — The world. Sunrise over mountains of junk; title.
  {
    name: 'establish', end: 15.0,
    update(S, t) {
      S.setMood(S.mood('dustyMorning'));
      const k = ease.inOutSine(clamp(t / 15));
      const pos = spline([[3.5, 15, 47], [3.2, 10, 32], [2.2, 5.2, 19.5], [-0.8, 2.2, 11.5]], k);
      const tgt = spline([[-10, 9, -40], [-7, 5.5, -18], [-4.5, 2, -2], [-4.2, 0.7, 4.8]], k);
      S.cam(pos, tgt, 38);
      S.shake(0.5, 0.4);
      S.shadowFocus(-3, 2, 28);
      S.grade.uFade.value = 1 - smoothstep(0.2, 3.2, t);
      S.overlay.show('title', pulse(t, BEAT.titleIn, BEAT.titleOut, 0.9, 0.9), 0.96 + 0.05 * k01(t, BEAT.titleIn, BEAT.titleOut));
      // a tiny Bolt far below, trundling along
      if (t > 8) {
        const d = (t - 15) * 1.15 + 4.71;
        const pp = pathAt([[-12.5, 7.4], [-8.0, 6.0]], clamp(d / 4.71));
        boltPose(S, { x: pp.x, z: pp.z, rotY: pp.heading, odo: d, hop: Math.abs(Math.sin(d * 9)) * 0.006 });
      }
      motes(S, [1, 0.86, 0.62], 0.35, 500);
    },
  },

  // A2 — Meet Bolt.
  {
    name: 'meetBolt', end: 24.5,
    update(S, t) {
      S.setMood(S.mood('dustyMorning'));
      const L = 5.5, v = 1.15, t0 = 15.0, tLin = 19.38, tStop = 20.18;
      const dist = t < tLin ? (t - t0) * v : (tLin - t0) * v + v * (tStop - tLin) * (1 - Math.pow(1 - clamp((t - tLin) / (tStop - tLin)), 2)) / 2;
      const pp = pathAt([[-8.0, 6.0], [-2.8, 4.2]], clamp(dist / L));
      const faceCam = heading([-2.8, 4.2], [-2.35, 6.9]);
      const turn = k01(t, 20.45, 21.0, 'inOutCubic');
      const rotY = angleLerp(pp.heading, faceCam, turn);
      const odo = dist;
      const stopLean = spring(t - 20.1, 0.22, 11, 4.5);
      const wave = win(t, 21.0, 22.6) ? Math.sin((t - 21.0) * 14) * 0.35 : 0;
      const armUp = k01(t, 20.95, 21.2) * (1 - k01(t, 22.4, 22.8));
      const hop = Math.max(0, Math.sin(clamp((t - 21.85) / 0.35) * Math.PI)) * 0.14;
      const happy = k01(t, 21.0, 21.3) * (1 - k01(t, 23.4, 23.9));
      boltPose(S, {
        x: pp.x, z: pp.z, rotY, odo, odoL: odo - turn * 0.25, odoR: odo + turn * 0.25,
        lean: stopLean + (t < tLin ? -0.03 : 0), hop: hop + (t < tStop ? Math.abs(Math.sin(odo * 9)) * 0.006 : 0),
        squash: 1 - hop * 0.6 + spring(t - 22.2, 0.08, 20, 7),
        headYaw: t < 19.9 ? Math.sin(t * 1.3) * 0.25 : track([[19.9, Math.sin(19.9 * 1.3) * 0.25], [20.25, -1.1, 'outBack'], [20.45, -1.1], [21.0, 0.0, 'inOutCubic']], t),
        headRoll: 0.12 * k01(t, 22.6, 23.0) * (1 - k01(t, 24.0, 24.4)),
        armR: [lerp(-0.35, -2.7, armUp), lerp(0.1, 0.35, armUp) + wave * 0.4, lerp(-0.7, -0.5, armUp) + wave, lerp(0.2, 0.9, armUp)],
        armL: [-0.35 + Math.sin(t * 5) * 0.05 * (t < tStop ? 1 : 0), 0.1, -0.7, 0.2],
        lidBot: 0.42 * happy, lidTop: 0.1 - 0.1 * k01(t, 20.2, 20.4), pupil: 1 + 0.2 * pulse(t, 20.2, 21.0, 0.1, 0.3),
        lookX: t < 19.9 ? Math.sin(t * 0.9) * 0.3 : 0, antenna: 1 + 1.5 * happy, antennaWiggle: 0.4 * pulse(t, 20.1, 20.8) + 0.6 * pulse(t, 21.8, 22.6),
        blush: 0.5 * happy,
      });
      // camera: side tracking, then glide to a friendly 3/4 front
      const gB = S.ground(pp.x, pp.z);
      const fh = [Math.sin(pp.heading), Math.cos(pp.heading)], nh = [fh[1], -fh[0]];
      const track1 = [pp.x + fh[0] * 2.3 - nh[0] * 2.6, gB + 0.7, pp.z + fh[1] * 2.3 - nh[1] * 2.6];
      const look1 = [pp.x + fh[0] * 0.4, gB + 0.55, pp.z + fh[1] * 0.4];
      const k = k01(t, 19.5, 21.2, 'inOutCubic');
      const camEnd = [-2.3, 0.8, 7.25];
      const lookEnd = [-2.8, 0.6, 4.2];
      S.cam(track1.map((a, i) => lerp(a, camEnd[i], k)), look1.map((a, i) => lerp(a, lookEnd[i], k)), lerp(34, 30, k));
      S.shake(0.3, 0.5);
      S.shadowFocus(pp.x, pp.z, 8);
      motes(S);
      if (t < tStop) S.fx.puff(t, Math.floor(t * 6) / 6, [pp.x - Math.sin(pp.heading) * 0.35, S.ground(pp.x, pp.z), pp.z - Math.cos(pp.heading) * 0.35], { count: 6, size: 0.25, spread: 0.3, up: 0.15, life: 0.9, alpha: 0.3, seed: Math.floor(t * 6) });
    },
  },

  // B1 — "Every single day, Bolt had one very important job."
  {
    name: 'job', end: 28.3,
    update(S, t) {
      S.setMood(S.mood('dustyMorning'));
      baseTower(S, t);
      scrapsOnGround(S);
      const t0 = 24.5, tLin = 25.9, tStop = 26.5, v = 1.3;
      const dist = t < tLin ? (t - t0) * v : (tLin - t0) * v + v * (tStop - tLin) * (1 - Math.pow(1 - clamp((t - tLin) / (tStop - tLin)), 2)) / 2;
      const Ltot = (tLin - t0) * v + v * (tStop - tLin) / 2;
      const pp = pathAt([[-0.6, 3.35], [BW[0], BW[1]]], clamp(dist / Ltot));
      const turn = k01(t, 26.4, 27.0, 'inOutCubic');
      const rotY = angleLerp(pp.heading, 0, turn);
      const pump = win(t, 27.1, 28.1) ? Math.max(0, Math.sin((t - 27.1) * Math.PI * 3)) : 0;
      boltPose(S, {
        x: pp.x, z: pp.z, rotY, odo: dist, odoL: dist + turn * 0.3, odoR: dist - turn * 0.3,
        lean: spring(t - 26.45, 0.18, 11, 4.5), hop: pump * 0.05 + (t < tStop ? Math.abs(Math.sin(dist * 9)) * 0.006 : 0),
        armL: [-0.4 - pump * 1.9, 0.2, -0.8 - pump * 0.6, 0.2 + pump * 0.6], armR: [-0.4 - pump * 1.9, 0.2, -0.8 - pump * 0.6, 0.2 + pump * 0.6],
        brow: 0.18 * k01(t, 27.0, 27.2), lidTop: 0.18, headPitch: -0.1 * pump, antenna: 1 + pump * 2, antennaWiggle: pump * 0.5,
      });
      const k = k01(t, 24.5, 28.3);
      S.cam([lerp(-0.4, -0.9, k), lerp(1.25, 1.05, k), lerp(8.4, 7.4, k)], [-3.0, 0.62, 3.25], 34);
      S.shake(0.25);
      S.shadowFocus(-3, 3, 7);
      motes(S);
    },
  },

  // B2 — "Scoop the junk... squish the junk..."
  {
    name: 'scoop', end: 30.9,
    update(S, t) {
      S.setMood(S.mood('dustyMorning'));
      baseTower(S, t);
      const hatch = k01(t, 28.35, 28.55) * (1 - k01(t, 29.3, 29.42)) + k01(t, 30.32, 30.45) * (1 - k01(t, 30.62, 30.8));
      const lean = 0.34 * k01(t, 28.35, 28.6) * (1 - k01(t, 29.25, 29.5));
      const sweep = k01(t, 28.75, 29.2, 'inOutCubic');
      const squishT = t - 29.5;
      const squish = win(t, 29.5, 30.3) ? Math.abs(Math.sin(squishT * Math.PI / 0.4)) : 0;
      const pop = spring(t - 30.3, 0.14, 22, 6);
      const grab = k01(t, 30.45, 30.62);
      const arms = t < 29.3
        ? [lerp(-1.25, -0.95, sweep), lerp(0.75, -0.12, sweep), lerp(-0.35, -0.6, sweep), lerp(0.9, 0.1, sweep)]
        : t < 30.35 ? [-0.35 - squish * 0.2, 0.25, -0.9, 0.1] : [lerp(-0.6, -1.25, grab), lerp(0.35, -0.05, grab), lerp(-0.9, -0.35, grab), lerp(0.8, 0.15, grab)];
      boltPose(S, {
        x: BW[0], z: BW[1], rotY: 0, odo: 3.7,
        lean: lean + 0.03 * squish, squash: 1 - 0.2 * squish + pop, shake: squish * 0.035,
        hatch, armL: arms, armR: arms,
        lidTop: 0.12 + 0.45 * squish, lidBot: 0.35 * squish, brow: 0.25 * squish - 0.1 * lean, pupil: 1 - 0.2 * squish,
        headPitch: 0.25 * lean, antenna: 1 + squish, antennaWiggle: 0.5 * squish + 0.5 * pulse(t, 30.3, 30.8),
      });
      // scraps fly into the hatch
      const mouth = new THREE.Vector3(0, 0.42 + 0.2, 0.26).applyMatrix4(S.bolt.root.matrixWorld);
      scrapSpots.forEach((sp, i) => {
        const m = S.scraps[i];
        const ts = 28.75 + i * 0.06;
        const k = clamp((t - ts) / 0.32);
        if (k >= 1) return;
        m.visible = true;
        const from = [BW[0] + sp[0], S.ground(BW[0] + sp[0], BW[1] + sp[1]) + 0.05, BW[1] + sp[1]];
        const kk = ease.inQuad(k);
        m.position.set(lerp(from[0], mouth.x, kk), lerp(from[1], mouth.y, kk) + Math.sin(k * Math.PI) * 0.15, lerp(from[2], mouth.z, kk));
        m.rotation.set(sp[2] + k * 6, sp[2] * 2 + k * 4, 0);
        m.scale.setScalar(1 - 0.6 * kk);
      });
      // the new cube slides out of the hatch into Bolt's claws
      if (t > 30.33) {
        const k = k01(t, 30.33, 30.6, 'outBack');
        const p0 = new THREE.Vector3(0, 0.42, 0.05).applyMatrix4(S.bolt.root.matrixWorld);
        const p1 = new THREE.Vector3(0, 0.46, 0.46).applyMatrix4(S.bolt.root.matrixWorld);
        placeCube(S, 2, lerp(p0.x, p1.x, k), lerp(p0.y, p1.y, k), lerp(p0.z, p1.z, k), 0, 0.05, 0);
      }
      S.cam([-1.75, 0.95, 5.0], [-3.4, 0.55, 3.3], 36);
      S.shake(0.3);
      S.shadowFocus(BW[0], BW[1], 5);
      motes(S);
    },
  },

  // B3 — "...and stack, stack, stack!"
  {
    name: 'stack', end: 33.4,
    update(S, t) {
      S.setMood(S.mood('dustyMorning'));
      baseTower(S, t);
      const face = -1.05;
      const turnBack = k01(t, 32.55, 32.95, 'inOutCubic');
      let hop = 0, armRaise = -1.25, claw = 0.15, squash = 1;
      BEAT.stack.forEach((s) => {
        const up = pulse(t, s - 0.14, s + 0.2, 0.1, 0.18);
        armRaise = Math.min(armRaise, lerp(-1.25, -2.75, up));
        claw = Math.max(claw, 0.9 * pulse(t, s - 0.02, s + 0.25, 0.04, 0.1));
        hop += Math.max(0, Math.sin(clamp((t - s + 0.1) / 0.3) * Math.PI)) * 0.1;
        squash += spring(t - s - 0.2, 0.08, 24, 8);
      });
      const hips = k01(t, 32.6, 32.95);
      const arms = [lerp(armRaise, -0.15, hips), lerp(0.05, 0.95, hips), lerp(-0.35, -1.95, hips), lerp(claw, 0, hips)];
      boltPose(S, {
        x: BW[0], z: BW[1], rotY: lerp(face, -0.25, turnBack), odo: 3.7, odoL: 3.7 - turnBack * 0.2, odoR: 3.7 + turnBack * 0.2,
        hop, squash: squash - hop * 0.5, armL: arms, armR: arms,
        headPitch: -0.35 * (1 - hips) - 0.05, headRoll: 0.14 * hips, lidBot: 0.4 * hips, lidTop: 0.12, brow: -0.05 * hips + 0.15 * (1 - hips),
        antenna: 1 + 2 * hips, antennaWiggle: 0.4 + 0.3 * hips, hatch: BEAT.stack.reduce((a, s, i) => a + (i ? pulse(t, s - 0.45, s - 0.2, 0.05, 0.08) : 0), 0),
      });
      S.bolt.root.updateMatrixWorld(true);
      const hands = new THREE.Vector3(0, 0.62, 0.42).applyMatrix4(S.bolt.root.matrixWorld);
      const chest = new THREE.Vector3(0, 0.42, 0.1).applyMatrix4(S.bolt.root.matrixWorld);
      BEAT.stack.forEach((s, j) => {
        const i = 2 + j;
        const top = [TB[0], S.ground(TB[0], TB[1]) + 0.2 + 0.4 * i, TB[1]];
        if (t < s - 0.45 && j > 0) return;
        if (t < s - 0.1) {
          const k = j === 0 ? 1 : k01(t, s - 0.45, s - 0.15, 'outQuad');
          placeCube(S, i, lerp(chest.x, hands.x, k), lerp(chest.y, hands.y, k), lerp(chest.z, hands.z, k), 0, face, 0);
        } else if (t < s + 0.2) {
          const p = arc(t, s - 0.1, 0.3, [hands.x, hands.y + 0.2, hands.z], top, 0.35);
          placeCube(S, i, p[0], p[1], p[2], 0, face * (1 - p[3]), p[3] * Math.PI * 2 * 0);
        } else {
          placeCube(S, i, top[0], top[1] - spring(t - s - 0.2, 0.03, 30, 9), top[2], 0, 0, 0, 1 - spring(t - s - 0.2, 0.18, 30, 7));
        }
      });
      S.cam([-2.05, 1.15, 6.6], [-3.75, 1.05, 3.2], 38);
      S.shake(0.3);
      S.shadowFocus(-3.6, 3.2, 5);
      motes(S);
    },
  },

  // B4 — Wobble... BONK! "Oh no, oh no!" "Oopsie!"
  {
    name: 'wobble', end: 39.8,
    update(S, t) {
      S.setMood(S.mood('dustyMorning'));
      const amp = 0.065 * smoothstep(BEAT.wobble, 34.6, t) * (1 - smoothstep(BEAT.cubeFall, 36.4, t));
      const sway = amp * Math.sin((t - BEAT.wobble) * Math.PI * 2 * 1.35);
      const g = S.ground(TB[0], TB[1]);
      for (let i = 0; i < 5; i++) {
        if (i === 4 && t > BEAT.cubeFall) continue;
        const a = sway * (0.25 + 0.75 * (i / 4));
        const h = 0.2 + 0.4 * i;
        placeCube(S, i, TB[0] + Math.sin(a) * h, g + Math.cos(a) * h, TB[1], 0, 0, -a);
      }
      const shuffle = 0.16 * Math.sin((t - 33.6) * Math.PI * 2 * 1.35) * smoothstep(33.6, 34.0, t) * (1 - smoothstep(35.2, 35.6, t));
      const bonk = t - BEAT.bonk;
      const flat = bonk > 0 ? track([[0, 1], [0.08, 0.6, 'outQuad'], [0.3, 1.12, 'outQuad'], [0.55, 0.96], [0.8, 1.0]], bonk) : 1;
      const dizzy = smoothstep(35.9, 36.1, t) * (1 - smoothstep(38.3, 38.7, t));
      const shakeHead = win(t, 38.1, 38.7) ? Math.sin((t - 38.1) * 32) * 0.45 * (1 - (t - 38.1) / 0.6) : 0;
      const sheepish = k01(t, 38.7, 39.1);
      const scratch = sheepish * Math.sin(t * 16) * 0.2;
      const worried = smoothstep(33.3, 33.6, t) * (1 - smoothstep(35.75, 35.85, t));
      const armsUp = [lerp(-0.4, -2.55, worried), lerp(0.1, 0.45, worried), lerp(-0.7, -0.3, worried), 0.6 * worried];
      boltPose(S, {
        x: BW[0] - 0.12 + shuffle, z: BW[1], rotY: -0.25 - 0.35 * worried, odo: 3.7 + shuffle,
        squash: flat, roll: dizzy * 0.1 * Math.sin(t * 6.5), lean: dizzy * 0.05 * Math.cos(t * 5),
        neckExt: 0.08 * worried - 0.1 * pulse(t, 35.8, 36.6, 0.05, 0.4),
        headPitch: -0.55 * worried + 0.2 * pulse(t, 35.8, 36.5, 0.05, 0.3), headYaw: shakeHead + 0.35 * sheepish, headRoll: dizzy * 0.25 * Math.sin(t * 6.5 + 1) + 0.15 * sheepish,
        armL: dizzy > 0.1 ? [-0.6 + Math.sin(t * 6) * 0.3, 0.5, -0.4, 0.4] : armsUp,
        armR: sheepish > 0.01 ? [lerp(-0.4, -2.9, sheepish), 0.3, lerp(-0.7, -1.5, sheepish) + scratch, 0.5] : dizzy > 0.1 ? [-0.6 + Math.sin(t * 6 + 2) * 0.3, 0.5, -0.4, 0.4] : armsUp,
        pupil: lerp(1, 0.72, worried), lidTop: 0.12 * (1 - worried), dizzy, brow: -0.28 * worried, lidBot: 0.3 * sheepish,
        blush: 0.85 * sheepish, antennaWiggle: 0.3 + 1.2 * pulse(t, 35.8, 36.8, 0.02, 0.6), antenna: 1 - 0.6 * dizzy,
      });
      // falling cube: slides off, falls onto Bolt's head, bounces to the ground
      if (t > BEAT.cubeFall) {
        const top = [TB[0] + Math.sin(sway) * 1.8, g + 1.8, TB[1]];
        const head = headPos(S, 0.18);
        const land = [BW[0] + 0.62, g + 0.2, BW[1] + 0.5];
        if (t < BEAT.bonk) {
          const k = clamp((t - BEAT.cubeFall) / (BEAT.bonk - BEAT.cubeFall));
          placeCube(S, 4, lerp(top[0], head.x, k), lerp(top[1] + 0.1, head.y + 0.2, k * k) + Math.sin(k * Math.PI) * 0.25, lerp(top[2], head.z, k), 0, 0, -k * 2.2);
        } else if (t < BEAT.cubeLand) {
          const p = arc(t, BEAT.bonk, BEAT.cubeLand - BEAT.bonk, [head.x, head.y + 0.2, head.z], land, 0.3);
          placeCube(S, 4, p[0], p[1], p[2], p[3] * 1.5, 0, -2.2 - p[3] * 2.5);
        } else {
          const b = Math.max(0, Math.sin(clamp((t - BEAT.cubeLand) / 0.28) * Math.PI)) * 0.08;
          placeCube(S, 4, land[0], land[1] + b, land[2], 1.5708, 0, -1.5708 * 3);
        }
        S.fx.puff(t, BEAT.cubeLand, [land[0], g, land[2]], { count: 16, size: 0.22, spread: 0.6, up: 0.15, life: 1.4, seed: 3, alpha: 0.4 });
        S.fx.puff(t, BEAT.bonk, [BW[0], g, BW[1]], { count: 14, size: 0.2, spread: 0.6, up: 0.1, life: 1.2, seed: 4, alpha: 0.3 });
        S.fx.dizzyStars(t, headPos(S, 0.3).toArray(), dizzy);
        S.fx.sparkles(t, headPos(S, 0.2).toArray(), { count: 12, radius: 0.25, color: [1, 0.9, 0.5], size: 0.1, alpha: pulse(t, 35.8, 36.2, 0.02, 0.3), seed: 9 });
      }
      const k = k01(t, 33.4, 39.8);
      S.cam([lerp(-2.25, -2.45, k), 0.32, lerp(5.8, 5.4, k)], [-3.6, lerp(1.25, 0.9, smoothstep(35.8, 37, t)), 3.2], 42);
      S.shake(0.3 + 3 * pulse(t, 35.8, 36.2, 0.01, 0.35), 1.5);
      S.shadowFocus(-3.6, 3.2, 5);
      motes(S);
    },
  },

  // C1 — Sunset. "Bolt felt a little bit lonely."
  {
    name: 'sunsetWide', end: 47.6,
    update(S, t) {
      S.setMood(S.mood('sunset', { sunEl: 6.5, sunAz: 183 }));
      boltPose(S, {
        x: SEAT[0], z: SEAT[1], rotY: 0.05, odo: 1, headPitch: -0.28 + 0.12 * k01(t, 45.2, 46.4), headYaw: 0.08 * Math.sin(t * 0.4),
        squash: 1 - 0.05 * pulse(t, 45.0, 46.6, 0.6, 0.9), antenna: 0.5, armL: [-0.2, 0.05, -0.5, 0.1], armR: [-0.2, 0.05, -0.5, 0.1], idle: 0.6,
      });
      const k = k01(t, 39.8, 47.6, 'inOutSine');
      const gS = S.ground(SEAT[0], SEAT[1]);
      S.cam([lerp(-7.3, -7.6, k), gS + lerp(0.25, 0.45, k), lerp(2.6, 5.2, k)], [-7.95, gS + lerp(0.95, 0.9, k), 14], 32);
      S.shadowFocus(SEAT[0], SEAT[1], 10);
      motes(S, [1, 0.6, 0.35], 0.5, 400);
      S.grade.uSaturation.value = 1.02;
    },
  },

  // C2 — "Hello? ... Anybody?"
  {
    name: 'hello', end: 53.0,
    update(S, t) {
      const m = S.mixMood(S.mood('sunset', { sunEl: 6.5, sunAz: 183 }), S.mood('dusk', { sunEl: 1.5, sunAz: 183 }), k01(t, 47.6, 52.8));
      S.setMood(m);
      const call = pulse(t, 47.9, 50.4, 0.2, 0.5);
      const sad = k01(t, 50.9, 51.8);
      boltPose(S, {
        x: SEAT[0], z: SEAT[1], rotY: 0.05, odo: 1,
        lean: 0.12 * call - 0.04 * sad, neckExt: 0.07 * call - 0.04 * sad,
        headYaw: track([[48.7, 0], [49.1, 0.42], [49.9, -0.4], [50.6, 0.1], [51.2, 0]], t),
        headPitch: -0.18 * call + 0.32 * sad, headRoll: 0.18 * pulse(t, 50.3, 51.3, 0.2, 0.3),
        armR: [lerp(-0.3, -2.3, call), 0.2, lerp(-0.6, -1.7, call), 0.7 * call],
        armL: [-0.2 - 0.15 * sad, 0.05, -0.5, 0.1],
        brow: -0.12 * call - 0.3 * sad, lidTop: 0.1 + 0.28 * sad, lidAngle: -0.35 * sad, pupil: 1.12 - 0.1 * sad,
        antenna: 0.9 - 0.75 * sad, squash: 1 - 0.05 * sad, glow: 0.35,
      });
      const gS = S.ground(SEAT[0], SEAT[1]);
      S.cam([-7.6, gS + 1.08, 11.4], [-7.98, gS + 0.86, 8.7], 30);
      S.shake(0.2);
      S.shadowFocus(SEAT[0], SEAT[1], 4);
      S.grade.uFade.value = smoothstep(BEAT.sunsetFadeOut, 53.0, t);
      motes(S, [1, 0.6, 0.4], 0.35, 300);
    },
  },

  // D1 — Next morning, rummaging. "...something he had never, ever seen before."
  {
    name: 'rummage', end: 58.6,
    update(S, t) {
      S.setMood(S.mood('dustyDay'));
      const cyc = (t - 53.1) / 0.8;
      const ph = cyc - Math.floor(cyc);
      const digging = t < 56.2;
      const reach = digging ? Math.sin(ph * Math.PI) : 0;
      const fling = digging ? smoothstep(0.55, 0.85, ph) * (1 - smoothstep(0.9, 1.0, ph)) : 0;
      const alt = Math.floor(cyc) % 2;
      const armA = [lerp(-0.9, -3.0, fling) - reach * 0.2, 0.15, lerp(-0.2, -0.4, fling), 0.5];
      const armB = [-0.5, 0.2, -0.8, 0.2];
      const duckHold = k01(t, 56.2, 56.45) * (1 - k01(t, 56.95, 57.1));
      const squeeze = pulse(t, 56.55, 56.75, 0.04, 0.08);
      const freeze = k01(t, BEAT.glint, 57.7);
      const lean = digging ? 0.22 * reach : 0.12 * duckHold + 0.2 * freeze;
      const duckArms = [lerp(-0.5, -1.7, duckHold), lerp(0.2, -0.2, duckHold), -0.5, 0.35 - squeeze * 0.3];
      const tossArm = [lerp(-0.9, -3.0, pulse(t, 56.9, 57.3, 0.1, 0.15)), 0.15, -0.3, 0.5];
      boltPose(S, {
        x: BOLT_PILE[0], z: BOLT_PILE[1], rotY: Math.PI, odo: 0.5,
        lean, headPitch: 0.25 * reach + 0.2 * freeze - 0.1 * duckHold, headRoll: 0.25 * pulse(t, 56.5, 57.0, 0.1, 0.2),
        armL: digging ? (alt ? armA : armB) : t < 56.9 ? duckArms : tossArm, armR: digging ? (alt ? armB : armA) : duckArms,
        pupil: 1 + 0.35 * freeze - 0.15 * squeeze, lidTop: 0.12 * (1 - freeze) + 0.3 * squeeze, lookY: -0.4 * freeze, neckExt: 0.12 * freeze,
        antenna: 1 + freeze, antennaWiggle: 0.3 * reach + 0.6 * pulse(t, 56.5, 56.9),
      });
      // tossed objects fly back over his head
      const back = [BOLT_PILE[0], S.ground(BOLT_PILE[0], BOLT_PILE[1]), BOLT_PILE[1]];
      BEAT.tosses.forEach((s, i) => {
        const m = S.scraps[6 + i];
        if (t < s - 0.35) return;
        m.visible = true;
        const from = [PILE[0] + (i - 1) * 0.2, S.ground(PILE[0], PILE[1]) + 0.3, PILE[1] - 0.05];
        const to = [back[0] + (i - 1) * 1.1, back[1] + 0.05, back[2] + 2.3 + i * 0.4];
        if (t < s) {
          const k = k01(t, s - 0.35, s);
          m.position.set(from[0], from[1] + k * 0.9, lerp(from[2], back[2] + 0.2, k));
        } else {
          const p = arc(t, s, 0.75, [from[0], from[1] + 0.9, back[2] + 0.2], to, 0.9);
          m.position.set(p[0], p[1], p[2]);
          m.rotation.set(p[3] * 7, p[3] * 5, 0);
          if (p[3] >= 1) S.fx.puff(t, s + 0.75, to, { count: 10, size: 0.3, spread: 0.5, up: 0.15, life: 1.2, seed: 20 + i });
        }
      });
      // the rubber duck
      if (t > 56.1) {
        S.duck.visible = true;
        const hands = handsPos(S);
        if (t < BEAT.duckToss) {
          const k = k01(t, 56.1, 56.4);
          S.duck.position.set(lerp(PILE[0], hands.x, k), lerp(S.ground(PILE[0], PILE[1]) + 0.3, hands.y + 0.1, k), lerp(PILE[1], hands.z - 0.02, k));
          S.duck.rotation.set(0, Math.PI / 2, 0);
          S.duck.scale.set(1 + squeeze * 0.2, 1 - squeeze * 0.35, 1 + squeeze * 0.2);
        } else {
          const p = arc(t, BEAT.duckToss, 0.9, [hands.x, hands.y + 0.2, hands.z], [back[0] + 1.6, back[1] + 0.05, back[2] + 2.0], 1.0);
          S.duck.position.set(p[0], p[1], p[2]);
          S.duck.rotation.set(p[3] * 9, Math.PI / 2 + p[3] * 3, 0);
          S.duck.scale.setScalar(1);
        }
      }
      S.fx.sparkles(t, [PILE[0], S.ground(PILE[0], PILE[1]) + 0.3, PILE[1] + 0.1], { count: 8, radius: 0.08, color: [0.7, 1, 0.5], size: 0.12, alpha: smoothstep(BEAT.glint, 57.6, t), seed: 2 });
      const k = k01(t, 53.0, 58.6);
      S.cam([lerp(-0.45, -0.7, k), lerp(0.95, 0.85, k), lerp(-7.1, -6.6, k)], [-1.45, 0.58, -4.3], 34);
      S.shake(0.3);
      S.shadowFocus(PILE[0], PILE[1], 5);
      S.grade.uFade.value = 1 - smoothstep(53.0, 53.9, t);
      motes(S);
    },
  },

  // D2 — "Wow... so pretty!"
  {
    name: 'found', end: 63.3,
    update(S, t) {
      S.setMood(S.mood('dustyDay'));
      const lift = k01(t, BEAT.canLift, 59.4, 'inOutCubic');
      const wow = k01(t, 59.45, 59.8, 'outBack');
      const tilt = 0.2 * Math.sin((t - 61) * 2.2) * smoothstep(61, 61.6, t);
      const arms = [lerp(-0.9, -1.85, lift), lerp(0.15, -0.28, lift), lerp(-0.3, -0.65, lift), 0.25];
      boltPose(S, {
        x: BOLT_PILE[0], z: BOLT_PILE[1], rotY: Math.PI, odo: 0.5, lean: lerp(0.2, 0.02, lift), neckExt: 0.1 * wow,
        armL: arms, armR: arms, headPitch: lerp(0.25, 0.12, lift), headRoll: tilt,
        pupil: 1 + 0.38 * wow, lidTop: 0.08 * (1 - wow), sparkle: wow, lookY: -0.3,
        lidBot: 0.25 * k01(t, 60.3, 60.8), blush: 0.55 * k01(t, 60.2, 60.8), display: t > 60.4 ? 'heart' : 'battery',
        antenna: 1 + 2 * wow, antennaWiggle: 0.3 * pulse(t, 59.4, 60.4),
      });
      const hands = handsPos(S);
      const from = new THREE.Vector3(PILE[0], S.ground(PILE[0], PILE[1]) + 0.12, PILE[1] + 0.05);
      const canPos = from.clone().lerp(hands.clone().add(new THREE.Vector3(0, -0.05, 0)), lift);
      sproutInCan(S, canPos, Math.PI + 0.3 + tilt * 0.3, { glow: 0.2 + 0.3 * wow });
      S.fx.sparkles(t, [canPos.x, canPos.y + 0.22, canPos.z], { count: 26, radius: 0.18, color: [0.75, 1, 0.55], size: 0.07, alpha: 0.3 + 0.7 * wow, seed: 4 });
      if (t > 60.4) S.fx.hearts3(t, 60.6, [hands.x, hands.y + 0.6, hands.z], { count: 3, size: 0.09 });
      S.cam([-1.26, 1.0, -5.42], [-1.48, 0.9, -4.2], 30);
      S.dof(1.05, 0.012, 0.008);
      S.shake(0.25);
      S.shadowFocus(BOLT_PILE[0], BOLT_PILE[1], 3);
      motes(S, [1, 0.9, 0.7], 0.4, 300);
    },
  },

  // D3 — "Something small. Something green. Something... alive!"
  {
    name: 'macro', end: 67.4,
    update(S, t) {
      S.setMood(S.mood('dustyDay'));
      const alive = k01(t, BEAT.alive, BEAT.alive + 0.5, 'outBack');
      boltPose(S, {
        x: BOLT_PILE[0], z: BOLT_PILE[1], rotY: Math.PI, odo: 0.5, lean: 0.03, neckExt: 0.1,
        armL: [-1.85, -0.28, -0.65, 0.25], armR: [-1.85, -0.28, -0.65, 0.25], headPitch: 0.14, headRoll: 0.08 * Math.sin(t * 0.8),
        pupil: 1.35 + 0.1 * alive, sparkle: 1 + alive, lidTop: 0, lookY: -0.35, lidBot: 0.2, blush: 0.4, display: 'heart', antenna: 2.5,
      });
      const hands = handsPos(S);
      const canPos = hands.clone().add(new THREE.Vector3(0, -0.05, 0));
      sproutInCan(S, canPos, Math.PI + 0.3, { glow: 0.25 + 0.2 * smoothstep(64.4, 65.2, t) + 0.45 * alive, unfurl: 1 + 0.3 * alive, scale: 1 + 0.12 * alive, halo: 0.15 });
      const top = [canPos.x, canPos.y + 0.22, canPos.z];
      S.fx.sparkles(t, top, { count: 30, radius: 0.16, color: [0.75, 1, 0.55], size: 0.02, alpha: 0.4 + 0.5 * alive, seed: 5 });
      S.fx.sparkles(t, top, { count: 24, radius: 0.1 + 0.2 * alive, color: [1, 1, 0.7], size: 0.03, alpha: pulse(t, BEAT.alive, BEAT.alive + 1.2, 0.05, 0.8), rise: 0.3, seed: 12 });
      const k = k01(t, 63.3, 67.4);
      const cam = [canPos.x + lerp(0.2, 0.14, k), canPos.y + lerp(0.22, 0.2, k), canPos.z - lerp(0.52, 0.43, k)];
      S.cam(cam, [canPos.x, canPos.y + 0.16, canPos.z + 0.02], 30);
      S.dof(Math.hypot(cam[0] - canPos.x, cam[1] - canPos.y - 0.13, cam[2] - canPos.z), 0.03, 0.012);
      S.shake(0.15);
      S.shadowFocus(BOLT_PILE[0], BOLT_PILE[1], 2);
      S.fx.motes(t, [canPos.x, canPos.y - 0.3, canPos.z], { count: 200, radius: 0.8, height: 0.8, size: 0.012, alpha: 0.5 });
    },
  },

  // E1 — "...whoosh! Something came zooming down from the sky!"
  {
    name: 'whoosh', end: 73.2,
    update(S, t) {
      S.setMood(S.mood('dustyDay'));
      const look = k01(t, 69.95, 70.4);
      const startle = t > BEAT.impact ? Math.max(0, Math.sin(clamp((t - BEAT.impact) / 0.35) * Math.PI)) : 0;
      const fall = lumaFall(t);
      const dir = fall ? Math.atan2(fall[0] - BOLT_PILE[0], fall[2] - BOLT_PILE[1]) : 0;
      boltPose(S, {
        x: BOLT_PILE[0], z: BOLT_PILE[1], rotY: Math.PI + 0.35 + 0.3 * k01(t, 71.9, 72.5), odo: 0.5,
        hop: startle * 0.2, squash: 1 + startle * 0.15 + spring(t - BEAT.impact - 0.35, -0.1, 20, 7),
        headPitch: -0.45 * look * (1 - smoothstep(71.2, 71.6, t)) + 0.1 * startle, headYaw: look * clamp(angleLerp(0, dir - Math.PI - 0.35, 1), -1.2, 1.2) * 0.7,
        armL: [-1.85 + startle * 0.5, -0.35, -0.9, 0.2], armR: [-1.85 + startle * 0.5, -0.35, -0.9, 0.2],
        pupil: 1 - 0.3 * smoothstep(71.6, 71.8, t), lidTop: 0.12 * (1 - look), brow: -0.25 * smoothstep(71.6, 71.8, t), antennaWiggle: startle + 0.2,
      });
      sproutInCan(S, handsPos(S).add(new THREE.Vector3(0, -0.05, 0)), Math.PI + 0.3, { glow: 0.3 });
      // the falling star
      if (fall) {
        lumaPose(S, { x: fall[0], y: fall[1], z: fall[2], rotY: 0.5, scale: 0.9, glow: 2.2, light: 3, bob: 0, eyes: 'closed', blink: false, ring: 1 });
        S.fx.trail(t, (tt) => lumaFall(tt), { n: 60, dt: 0.012, size: 0.9, alpha: 1 });
        S.fx.glow.add(fall[0], fall[1], fall[2], 4.5, 0.6, 0.95, 1.2, 0.9);
      }
      const L = LAYOUT.lumaLand;
      const gy = S.ground(L[0], L[1]);
      const flash = pulse(t, BEAT.impact, BEAT.impact + 0.7, 0.02, 0.6);
      if (flash > 0) S.fx.glow.add(L[0], gy + 0.8, L[1], 9, 1.3, 1.2, 1.1, flash);
      S.fx.puff(t, BEAT.impact, [L[0], gy, L[1]], { count: 90, size: 1.3, spread: 5.5, up: 0.4, life: 4.0, ring: true, alpha: 0.6, seed: 30 });
      S.fx.puff(t, BEAT.impact, [L[0], gy, L[1]], { count: 60, size: 1.6, spread: 2.2, up: 2.4, life: 4.5, alpha: 0.55, seed: 31 });
      if (t > BEAT.impact) lumaPose(S, { x: L[0], y: gy + 0.9, z: L[1], glow: 1.5, light: 2, eyes: 'closed', blink: false });
      S.cam([-2.25, 0.58, -1.45], [0.7, lerp(2.4, 1.1, smoothstep(70.8, 71.8, t)), -7.2], 42);
      S.shake(0.35 + 4 * pulse(t, BEAT.impact, BEAT.impact + 0.8, 0.01, 0.75), 1.6);
      S.shadowFocus(-0.5, -6, 9);
      motes(S);
    },
  },

  // E2 — Hiding. "Scanning. Scanning."
  {
    name: 'scan', end: 79.0,
    update(S, t) {
      S.setMood(S.mood('dustyDay'));
      hideCubes(S);
      const duck = pulse(t, BEAT.duckHide, 78.2, 0.12, 0.35);
      const peek = smoothstep(73.4, 74.0, t) * (1 - duck);
      const toL = heading(HIDE, LAYOUT.lumaLand);
      boltPose(S, {
        x: HIDE[0], z: HIDE[1], rotY: toL - 0.25, odo: 0.8, squash: 0.9 - 0.08 * duck,
        neckExt: -0.08 + 0.3 * peek, headPitch: 0.05, headYaw: 0.25 * Math.sin(t * 0.7) * peek,
        pupil: 1.15, lidTop: 0.05, lookX: 0.3 * Math.sin(t * 1.4), brow: -0.18,
        armL: [-1.7, -0.3, -0.9, 0.2], armR: [-1.7, -0.3, -0.9, 0.2], antenna: 0.4 + 0.6 * peek,
      });
      sproutInCan(S, handsPos(S).add(new THREE.Vector3(0, -0.05, 0)), toL, { glow: 0.2 });
      const L = LAYOUT.lumaLand;
      const k = k01(t, 73.3, 78.6);
      const lp = [lerp(L[0], 2.0, k), lerp(S.ground(L[0], L[1]) + 0.9, 1.3, k01(t, 73.3, 74.4)), lerp(L[1], -7.4, k)];
      const scanYaw = heading([lp[0], lp[2]], HIDE) + Math.PI + Math.sin(t * 1.1) * 0.9 * (1 - pulse(t, 76.7, 77.9, 0.3, 0.3)) + Math.PI * (1 - pulse(t, 76.7, 77.9, 0.3, 0.3));
      lumaPose(S, {
        x: lp[0], y: lp[1], z: lp[2], rotY: scanYaw, eyes: 'scan', beam: smoothstep(73.8, 74.2, t), glow: 1, light: 1.2,
        pitch: 0.12, armL: [0.3, 0, 0], armR: [0.3, 0, 0],
      });
      S.fx.puff(t, BEAT.impact, [L[0], S.ground(L[0], L[1]), L[1]], { count: 60, size: 1.6, spread: 2.2, up: 2.4, life: 7.5, alpha: 0.3, seed: 31 });
      S.cam([-1.2, 1.15, -3.5], [1.6, 0.95, -7.2], 36);
      S.shake(0.3);
      S.shadowFocus(1, -6.5, 6);
      motes(S);
    },
  },

  // E3 — "Hello?" / "Oh! Hello there! I'm Luma!" / "Hi! I'm Bolt!"
  {
    name: 'meet', end: 86.0,
    update(S, t) {
      S.setMood(S.mood('dustyDay'));
      hideCubes(S);
      const out = k01(t, 79.0, 79.9, 'inOutCubic');
      const bp = spline([[HIDE[0], HIDE[1]], [HIDE_MID[0], HIDE_MID[1]], [REVEAL[0], REVEAL[1]]], out);
      const bx = bp[0], bz = bp[1];
      const lumaSpot = [lerp(2.0, 1.6, k01(t, 81.2, 82.0)) - 0.3 * k01(t, 84.8, 85.8), lerp(-7.4, -7.15, k01(t, 81.2, 82.0))];
      const toLuma = heading([bx, bz], lumaSpot);
      const waveB = win(t, 83.3, 84.6) ? Math.sin((t - 83.3) * 15) * 0.4 : 0;
      const bothUp = pulse(t, 83.3, 84.6, 0.15, 0.25);
      const hi = pulse(t, 79.2, 80.1, 0.15, 0.3);
      const hop = Math.max(0, Math.sin(clamp((t - BEAT.boltHop) / 0.35) * Math.PI)) * 0.15;
      const shy = k01(t, 84.7, 85.2);
      boltPose(S, {
        x: bx, z: bz, rotY: angleLerp(heading(HIDE, LAYOUT.lumaLand) - 0.25, toLuma, out), odo: 0.8 + out * 1.2, hop, squash: lerp(0.9, 1, out) - hop * 0.5,
        lean: -0.08 * (1 - k01(t, 80.5, 81.5)), neckExt: 0.04,
        armR: [lerp(-0.4, -2.3, Math.max(hi, bothUp)), 0.3 + waveB * 0.5, -0.6 + waveB, 0.7],
        armL: [lerp(-0.6, -2.3, bothUp), 0.3 - waveB * 0.5, -0.6 - waveB, 0.7 * bothUp],
        lidBot: 0.4 * k01(t, 83.2, 83.5), lidTop: 0.1, pupil: 1.12, blush: 0.8 * k01(t, 83.5, 84.0), lookX: -0.4 * shy, headPitch: 0.15 * shy, headRoll: 0.12 * shy,
        antenna: 1 + 2 * pulse(t, 84.0, 84.6, 0.05, 0.2), antennaWiggle: 0.2 + hop * 3, brow: -0.1,
      });
      const startle = t - BEAT.lumaStartle;
      const jump = startle > 0 ? Math.max(0, Math.sin(clamp(startle / 0.6) * Math.PI)) * 0.45 : 0;
      const spin = k01(t, BEAT.lumaStartle + 0.05, BEAT.lumaStartle + 0.6, 'inOutCubic') * Math.PI * 2;
      const twirl = k01(t, BEAT.lumaTwirl, BEAT.lumaTwirl + 0.55, 'inOutCubic') * Math.PI * 2;
      const giggle = win(t, 84.7, 86) ? Math.abs(Math.sin((t - 84.7) * 9)) * 0.05 : 0;
      const faceB = heading(lumaSpot, [bx, bz]);
      const awayYaw = faceB + Math.PI;
      const yaw = t < BEAT.lumaStartle ? awayYaw + Math.sin(t * 1.2) * 0.4 : angleLerp(awayYaw, faceB, k01(t, BEAT.lumaStartle, BEAT.lumaStartle + 0.6)) + spin + twirl;
      const happy = k01(t, 81.0, 81.3);
      lumaPose(S, {
        x: lumaSpot[0], y: 1.28 + jump + giggle + 0.08 * pulse(t, 81.2, 81.6, 0.1, 0.2), z: lumaSpot[1], rotY: yaw,
        squash: 1 + (startle > 0 ? spring(startle, 0.25, 16, 5) : 0),
        eyes: t < BEAT.lumaStartle ? 'scan' : t < 81.0 ? 'wide' : 'happy', eyes2: t < 81.0 ? null : null,
        beam: t < BEAT.lumaStartle ? 1 : 0,
        armL: [lerp(0.15, 1.1, pulse(t, 80.0, 81.0, 0.1, 0.3)) + 0.4 * pulse(t, BEAT.lumaTwirl, BEAT.lumaTwirl + 0.6), 0.3 * pulse(t, 80.0, 81.0), 0.05 * pulse(t, 80.0, 81.0)],
        armR: [lerp(0.15, 1.1, pulse(t, 80.0, 81.0, 0.1, 0.3)) + 0.8 * pulse(t, 81.5, 82.2, 0.1, 0.2) * (0.6 + 0.4 * Math.sin(t * 16)), 0.3 * pulse(t, 80.0, 81.0), 0.05 * pulse(t, 80.0, 81.0)],
        glow: 1 + 0.8 * pulse(t, BEAT.lumaTwirl, BEAT.lumaTwirl + 0.8) + 0.3 * happy, light: 1.2,
      });
      if (t > BEAT.lumaTwirl) S.fx.sparkles(t, [lumaSpot[0], 1.2, lumaSpot[1]], { count: 30, radius: 0.55, color: [0.6, 0.95, 1], size: 0.1, alpha: pulse(t, BEAT.lumaTwirl, BEAT.lumaTwirl + 1.2, 0.05, 0.6), seed: 7 });
      sproutInCan(S, handsPos(S).add(new THREE.Vector3(0, -0.05, 0)), toLuma, { glow: 0.2 });
      // Bolt holds the can in one claw while waving: keep the can at his left claw
      {
        const a = new THREE.Vector3();
        S.bolt.arms[0].hand.getWorldPosition(a);
        if (bothUp < 0.05) sproutInCan(S, a.add(new THREE.Vector3(0, -0.1, 0)), toLuma, { glow: 0.2 });
        else { S.can.root.visible = false; S.sprout.root.visible = false; }
      }
      const mid = [(bx + lumaSpot[0]) / 2, (bz + lumaSpot[1]) / 2];
      S.cam([mid[0] - 0.95, 1.08, mid[1] - 4.1], [mid[0], 0.98, mid[1]], 36);
      S.shake(0.3);
      S.shadowFocus(mid[0], mid[1], 5);
      motes(S);
    },
  },

  // E4 — "Wait... is that a plant? You found a real, live plant!"
  {
    name: 'plant', end: 91.5,
    update(S, t) {
      S.setMood(S.mood('dustyDay'));
      hideCubes(S);
      const LS = [1.35, -7.05];
      const toL = heading(REVEAL, LS);
      const offer = k01(t, 86.0, 86.6);
      const hug = k01(t, BEAT.hug, 90.4, 'inOutCubic');
      boltPose(S, {
        x: REVEAL[0], z: REVEAL[1], rotY: toL, odo: 2,
        armL: [lerp(-0.5, -1.45, offer), -0.28, lerp(-0.8, -0.2, offer), 0.25], armR: [lerp(-0.5, -1.45, offer), -0.28, lerp(-0.8, -0.2, offer), 0.25],
        lidBot: 0.2 + 0.3 * hug, pupil: 1.15, blush: 0.4 + 0.5 * hug, display: t > 90 ? 'heart' : 'battery', headRoll: -0.15 * hug, lookX: 0.2,
        antenna: 1 + 2 * hug, antennaWiggle: 0.2 + 0.5 * pulse(t, 88.3, 89.6),
      });
      const hands = handsPos(S);
      const canPos = hands.clone().add(new THREE.Vector3(0, -0.05, 0));
      sproutInCan(S, canPos, toL, { glow: 0.3 + 0.5 * k01(t, 87.4, 88.0) });
      // Luma: freeze, lean in, heart eyes, a joyful loop, then a hug
      const lean = k01(t, 86.8, 87.4, 'inOutCubic') * (1 - k01(t, BEAT.loopUp, BEAT.loopUp + 0.3));
      const loopK = k01(t, BEAT.loopUp, 89.7, 'inOutSine');
      const base = [lerp(LS[0], canPos.x + 0.42, lean), lerp(1.22, canPos.y + 0.35, lean), lerp(LS[1], canPos.z - 0.22, lean)];
      let pos = base;
      if (t > BEAT.loopUp) {
        const a = loopK * Math.PI * 2;
        const c = [(REVEAL[0] + LS[0]) / 2, 1.9, (REVEAL[1] + LS[1]) / 2];
        pos = [c[0] + Math.cos(a) * 1.35, c[1] + Math.sin(a * 2) * 0.35 + 0.2 * Math.sin(a), c[2] + Math.sin(a) * 1.35];
        const hp = headPos(S, 0.05);
        const hugPos = [hp.x + 0.33 * Math.sin(toL + 1.2), hp.y + 0.02, hp.z + 0.33 * Math.cos(toL + 1.2)];
        pos = pos.map((v, i) => lerp(v, hugPos[i], hug));
      }
      const heart = t > BEAT.heartEyes;
      lumaPose(S, {
        x: pos[0], y: pos[1], z: pos[2], rotY: heading([pos[0], pos[2]], [canPos.x, canPos.z]) + (t > BEAT.loopUp && t < BEAT.hug ? loopK * Math.PI * 4 : 0),
        pitch: 0.35 * lean, eyes: t < 86.3 ? 'happy' : heart ? (hug > 0.5 ? 'happy' : 'heart') : 'wide', blink: !heart,
        armL: [0.2 + 1.2 * hug, 0.8 * hug, 0], armR: [0.2 + 1.2 * hug, 0.8 * hug, 0], roll: -0.35 * hug,
        glow: 1 + 0.9 * k01(t, 88.0, 88.4), light: 1.4, bob: 1 - hug,
      });
      if (t > BEAT.loopUp && t < 89.9) S.fx.trail(t, (tt) => {
        if (tt < BEAT.loopUp) return null;
        const a = k01(tt, BEAT.loopUp, 89.7, 'inOutSine') * Math.PI * 2;
        const c = [(REVEAL[0] + LS[0]) / 2, 1.9, (REVEAL[1] + LS[1]) / 2];
        return [c[0] + Math.cos(a) * 1.35, c[1] + Math.sin(a * 2) * 0.35 + 0.2 * Math.sin(a) - 0.1, c[2] + Math.sin(a) * 1.35];
      }, { n: 40, dt: 0.02, size: 0.22, alpha: 0.9 });
      S.fx.hearts3(t, 88.3, [pos[0], pos[1] + 0.3, pos[2]], { count: 5, size: 0.12, life: 2.4 });
      S.fx.hearts3(t, 90.2, [hands.x, hands.y + 0.8, hands.z], { count: 4, size: 0.1, life: 2.0 });
      S.fx.sparkles(t, [canPos.x, canPos.y + 0.2, canPos.z], { count: 16, radius: 0.15, color: [0.75, 1, 0.55], size: 0.06, alpha: 0.8, seed: 8 });
      // over-the-shoulder close, then a wider view for the loop
      const f = [Math.sin(toL), Math.cos(toL)], rgt = [-f[1], f[0]];
      const osCam = [REVEAL[0] - f[0] * 1.15 - rgt[0] * 0.5, 1.12, REVEAL[1] - f[1] * 1.15 - rgt[1] * 0.5];
      const wide = [REVEAL[0] - f[0] * 2.4 - rgt[0] * 2.8, 1.45, REVEAL[1] - f[1] * 2.4 - rgt[1] * 2.8];
      const w = k01(t, 88.0, 88.9, 'inOutCubic');
      const tgt0 = [LS[0] - 0.1, 1.05, LS[1] + 0.05];
      const tgt1 = [(REVEAL[0] + LS[0]) / 2, 1.2, (REVEAL[1] + LS[1]) / 2];
      S.cam(osCam.map((v, i) => lerp(v, wide[i], w)), tgt0.map((v, i) => lerp(v, tgt1[i], w)), lerp(30, 38, w));
      S.shake(0.3);
      S.shadowFocus(0.6, -6.8, 5);
      motes(S);
    },
  },

  // F1 — Montage: loop-de-loops. "Luma had flown across the whole wide sky..."
  {
    name: 'loops', end: 96.4,
    update(S, t) {
      S.setMood(S.mood('dustyDay', { lightColor: '#ffe0b0' }));
      const C = [0.3, -1.8];
      const lp = loopPath(t, C);
      const face = heading(C, [lp[0], lp[2]]);
      const lag = angleLerp(face, face - 0.3, 1);
      boltPose(S, {
        x: C[0], z: C[1], rotY: lag, odoL: lag * 0.3, odoR: -lag * 0.3, hop: Math.abs(Math.sin(t * 5)) * 0.04,
        armL: [-2.5 + Math.sin(t * 6) * 0.2, 0.5, -0.3, 0.8], armR: [-2.5 + Math.sin(t * 6 + 1) * 0.2, 0.5, -0.3, 0.8],
        headPitch: -0.35 * (lp[1] - 1.1), lidBot: 0.4, pupil: 1.15, antenna: 2, antennaWiggle: 0.5, lookY: 0.3,
      });
      lumaPose(S, { x: lp[0], y: lp[1], z: lp[2], rotY: face + Math.PI / 2, roll: -0.5, eyes: 'happy', glow: 1.5, light: 1.2, bob: 0.3 });
      S.fx.trail(t, (tt) => (tt < 91.5 ? null : loopPath(tt, C)), { n: 70, dt: 0.015, size: 0.24, alpha: 0.9 });
      const a = lerp(0.9, 1.55, k01(t, 91.5, 96.4));
      S.cam([C[0] + Math.sin(a) * 5.6, 1.5, C[1] + Math.cos(a) * 5.6], [C[0], 1.0, C[1]], 40);
      S.shake(0.4);
      S.shadowFocus(C[0], C[1], 5);
      motes(S);
    },
  },

  // F2 — Chase!
  {
    name: 'chase', end: 99.0,
    update(S, t) {
      S.setMood(S.mood('dustyDay', { lightColor: '#ffe0b0' }));
      const path = [[-3.6, -0.6], [-0.2, 0.7], [3.1, 1.9], [4.2, 2.3]];
      const k = k01(t, BEAT.chase, 99.0, 'inOutSine');
      const pp = pathAt(path, k);
      const w = (t - BEAT.chase) * 7.5;
      const fwd = [Math.sin(pp.heading), Math.cos(pp.heading)], side = [-fwd[1], fwd[0]];
      boltPose(S, {
        x: pp.x, z: pp.z, rotY: pp.heading, odo: pp.dist, lean: -0.12, hop: Math.abs(Math.sin(pp.dist * 7)) * 0.03,
        armL: [-2.7, 0.6, -0.2, 0.9], armR: [-2.7, 0.6, -0.2, 0.9], lidBot: 0.45, antenna: 2.5, antennaWiggle: 0.8, headPitch: -0.1,
      });
      const lp = [pp.x + side[0] * Math.cos(w) * 0.95 + fwd[0] * 0.3, 1.25 + Math.sin(w) * 0.55, pp.z + side[1] * Math.cos(w) * 0.95 + fwd[1] * 0.3];
      lumaPose(S, { x: lp[0], y: lp[1], z: lp[2], rotY: pp.heading, roll: Math.sin(w) * 0.6, eyes: 'happy', glow: 1.5, light: 1, bob: 0 });
      S.fx.trail(t, (tt) => {
        if (tt < BEAT.chase) return null;
        const q = pathAt(path, k01(tt, BEAT.chase, 99.0, 'inOutSine'));
        const ww = (tt - BEAT.chase) * 7.5, f2 = [Math.sin(q.heading), Math.cos(q.heading)], s2 = [-f2[1], f2[0]];
        return [q.x + s2[0] * Math.cos(ww) * 0.95 + f2[0] * 0.3, 1.25 + Math.sin(ww) * 0.55, q.z + s2[1] * Math.cos(ww) * 0.95 + f2[1] * 0.3];
      }, { n: 50, dt: 0.012, size: 0.2 });
      for (let i = 0; i < 14; i++) {
        const tp = BEAT.chase + i * 0.18;
        const q = pathAt(path, k01(tp, BEAT.chase, 99.0, 'inOutSine'));
        S.fx.puff(t, tp, [q.x - Math.sin(q.heading) * 0.35, S.ground(q.x, q.z), q.z - Math.cos(q.heading) * 0.35], { count: 8, size: 0.35, spread: 0.45, up: 0.25, life: 1.3, alpha: 0.35, seed: 40 + i });
      }
      const cam = [pp.x - side[0] * 3.4 - fwd[0] * 0.8, 0.75, pp.z - side[1] * 3.4 - fwd[1] * 0.8];
      S.cam(cam, [pp.x + fwd[0] * 0.5, 0.75, pp.z + fwd[1] * 0.5], 40);
      S.shake(0.6, 1.2);
      S.shadowFocus(pp.x, pp.z, 6);
      motes(S);
    },
  },

  // F3 — "...waiting his whole life for a friend."
  {
    name: 'friends', end: 102.3,
    update(S, t) {
      S.setMood(S.mood('dustyDay', { lightColor: '#ffdcaa' }));
      const B = [4.2, 2.3];
      const nuz = k01(t, BEAT.nuzzle, 100.0, 'inOutCubic');
      const rub = nuz * Math.sin((t - BEAT.nuzzle) * 5) * 0.06;
      boltPose(S, {
        x: B[0], z: B[1], rotY: 0.15, odo: 7, headRoll: 0.18 * nuz + rub, headYaw: 0.15 * nuz,
        lidBot: 0.45 * nuz + 0.2, lidTop: 0.1, blush: 0.9 * nuz, display: t > 99.8 ? 'heart' : 'battery', antenna: 1 + 2 * nuz,
        armL: [-0.5, 0.1, -0.7, 0.2], armR: [lerp(-0.5, -1.2, nuz), lerp(0.1, 0.6, nuz), -0.9, 0.3],
      });
      const hp = headPos(S, 0);
      lumaPose(S, {
        x: lerp(B[0] + 0.95, hp.x + 0.36, nuz), y: lerp(1.2, hp.y + 0.12, nuz), z: lerp(B[1] - 0.1, hp.z + 0.02, nuz), rotY: 0.2 - 0.4 * nuz, roll: -0.35 * nuz + rub,
        eyes: 'happy', glow: 1.2 + 0.4 * nuz, light: 1.2, armL: [0.2 + 0.9 * nuz, 0.6 * nuz, 0], armR: [0.2, 0, 0], bob: 1 - nuz * 0.7,
      });
      S.fx.hearts3(t, 100.0, [B[0] + 0.25, 1.5, B[1]], { count: 5, size: 0.13, life: 2.5 });
      const k = k01(t, 99.0, 102.3);
      S.cam([B[0] + 0.5, 1.12, B[1] + lerp(2.9, 2.5, k)], [B[0] + 0.3, 1.02, B[1]], 34);
      S.shake(0.25);
      S.shadowFocus(B[0], B[1], 3);
      motes(S, [1, 0.9, 0.7], 0.45, 300);
    },
  },

  // G1 — "So together, they found the perfect spot... and planted the little sprout."
  {
    name: 'dig', end: 107.8,
    update(S, t) {
      S.setMood(S.mood('dustyDay', { sunEl: 26, lightColor: '#ffd9a8' }));
      const B = [P[0], P[1] - 0.58];
      const canG = [P[0] - 0.62, P[1] - 0.1];
      const digging = win(t, BEAT.dig[0], BEAT.dig[1]);
      const cyc = (t - BEAT.dig[0]) * 2.4;
      const toCan = heading(B, canG);
      const turn = k01(t, 104.75, 105.05) * (1 - k01(t, 105.3, 105.7));
      const lift = k01(t, 104.95, 105.3);
      const place = k01(t, 105.6, 106.1, 'inOutCubic');
      const pat = BEAT.pats.reduce((a, s) => a + pulse(t, s - 0.15, s + 0.1, 0.12, 0.1), 0);
      const dA = digging ? [-1.0 - 0.6 * Math.max(0, Math.sin(cyc * Math.PI)), 0.1, -0.2, 0.7] : null;
      const dB = digging ? [-1.0 - 0.6 * Math.max(0, Math.sin(cyc * Math.PI + Math.PI)), 0.1, -0.2, 0.7] : null;
      const carry = [-1.4 + 0.2 * place, -0.25, lerp(-0.6, -0.1, place), 0.1];
      const patArm = [-0.9 - 0.2 * pat, -0.05, -0.4 + 0.3 * pat, 0.1];
      const phase = digging ? 'dig' : t < 104.9 ? 'rest' : t < 106.2 ? 'carry' : 'pat';
      const arms = phase === 'dig' ? [dA, dB] : phase === 'carry' ? [carry, carry] : phase === 'pat' ? [patArm, patArm] : [[-0.6, 0.1, -0.6, 0.3], [-0.6, 0.1, -0.6, 0.3]];
      boltPose(S, {
        x: B[0], z: B[1], rotY: toCan * turn, odo: 9, odoL: 9 + turn * 0.2, odoR: 9 - turn * 0.2,
        lean: (digging ? 0.3 : 0.18) + 0.1 * pat, headPitch: 0.35, armL: arms[0], armR: arms[1],
        lidTop: 0.12, lidBot: 0.2 + 0.25 * pat, pupil: 1.1, brow: digging ? 0.12 : 0, antennaWiggle: digging ? 0.4 : 0.1,
        shake: digging ? 0.015 : 0,
      });
      const hole = [P[0], S.ground(P[0], P[1]), P[1]];
      S.fx.dirt(t, BEAT.dig[0], BEAT.dig[1], hole);
      BEAT.pats.forEach((s, i) => S.fx.puff(t, s, hole, { count: 10, size: 0.18, spread: 0.3, up: 0.1, life: 1.0, color: [0.5, 0.36, 0.25], seed: 60 + i }));
      // can on the ground; the sprout travels from can -> claws -> hole
      S.can.root.visible = true;
      S.can.root.position.set(canG[0], S.ground(canG[0], canG[1]), canG[1]);
      S.can.root.rotation.set(0, 0.8, 0);
      S.can.root.updateMatrixWorld(true);
      const inCan = new THREE.Vector3();
      S.can.sproutAnchor.getWorldPosition(inCan);
      const claws = handsPos(S).add(new THREE.Vector3(0, -0.1, 0));
      const planted = new THREE.Vector3(hole[0], hole[1] - 0.01, hole[2]);
      let sp = inCan;
      if (t > 104.95 && t < 106.1) sp = inCan.clone().lerp(claws, lift);
      if (t > 105.6) sp = claws.clone().lerp(planted, place);
      if (t >= 106.1) sp = planted;
      S.sprout.root.visible = true;
      S.sprout.root.position.copy(sp);
      S.sprout.root.rotation.set(0, 0.4, 0);
      S.sprout.pose({ t, glow: 0.25, scale: lerp(1, 1.35, place) });
      const clap = t > 106.3 ? Math.abs(Math.sin((t - 106.3) * 10)) : 0;
      lumaPose(S, {
        x: P[0] + 0.85, y: 1.08 - 0.08 * clap, z: P[1] - 0.25, rotY: heading([P[0] + 0.85, P[1] - 0.25], [P[0], P[1]]), pitch: 0.3,
        eyes: t > 106.2 ? 'happy' : 'open', lookY: -0.6, glow: 1.1, light: 1.3,
        armL: [0.25 - 0.35 * clap, 0.9 * (t > 106.3 ? 1 : 0), 0], armR: [0.25 - 0.35 * clap, 0.9 * (t > 106.3 ? 1 : 0), 0],
      });
      S.cam([P[0] + 1.15, 1.3, P[1] + 3.0], [P[0] + 0.3, 0.72, P[1] - 0.3], 38);
      S.shake(0.25);
      S.shadowFocus(P[0], P[1], 3);
      motes(S);
    },
  },

  // G2 — "Grow... please grow!"
  {
    name: 'water', end: 112.0,
    update(S, t) {
      S.setMood(S.mood('dustyDay', { sunEl: 20, lightColor: '#ffcf98' }));
      const B = [P[0] - 0.05, P[1] - 0.62];
      const tilt = k01(t, 107.9, 108.3) * (1 - k01(t, 110.9, 111.3));
      const hope = k01(t, 109.2, 109.6);
      boltPose(S, {
        x: B[0], z: B[1], rotY: 0.1, odo: 9, lean: 0.12 + 0.06 * tilt,
        armL: [-1.25 - 0.3 * tilt, -0.25, -0.35, 0.1], armR: [-1.25 - 0.3 * tilt, -0.25, -0.35, 0.1],
        headPitch: 0.35 - 0.2 * hope, pupil: 1.1 + 0.12 * hope, brow: -0.18 * hope, lidAngle: -0.12 * hope, lidTop: 0.1, sparkle: 0.5 * hope,
      });
      const hands = handsPos(S);
      S.wcan.root.visible = true;
      S.wcan.root.position.set(hands.x, hands.y - 0.2, hands.z - 0.04);
      S.wcan.root.rotation.set(0.75 * tilt, 0.1, 0);
      S.wcan.root.updateMatrixWorld(true);
      const tip = new THREE.Vector3();
      S.wcan.spoutTip.getWorldPosition(tip);
      const dir = new THREE.Vector3(0, 0.3, 1).applyEuler(S.wcan.root.rotation).normalize();
      S.fx.water(t, BEAT.pour[0], BEAT.pour[1], [tip.x, tip.y, tip.z, S.ground(P[0], P[1])], [dir.x * 0.6, dir.y * 0.6, dir.z * 0.6]);
      const wet = pulse(t, 108.6, 111.2, 0.3, 0.5);
      sproutPlanted(S, { glow: 0.2 + 0.25 * wet + 0.2 * Math.max(0, Math.sin(t * 6)) * wet });
      lumaPose(S, {
        x: P[0] + 0.72, y: 1.1, z: P[1] - 0.3, rotY: heading([P[0] + 0.72, P[1] - 0.3], [P[0], P[1]]), pitch: 0.35,
        eyes: 'open', lookY: -0.5, glow: 1.2, light: 1.4, beam: 0.35 * k01(t, 108.5, 109.0),
      });
      S.fx.sparkles(t, [P[0], S.ground(P[0], P[1]) + 0.15, P[1]], { count: 12, radius: 0.15, color: [0.7, 1, 0.6], size: 0.05, alpha: wet, seed: 13 });
      S.cam([P[0] + 0.75, 0.72, P[1] + 1.65], [P[0] - 0.05, 0.52, P[1] - 0.35], 38);
      S.shake(0.2);
      S.shadowFocus(P[0], P[1], 3);
      motes(S);
    },
  },

  // H1 — Night. "They waited, and waited, all through the long, starry night."
  {
    name: 'night', end: BEAT.dawnIn,
    update(S, t) {
      S.setMood(S.mood('night', { moonEl: 23, moonAz: -12 }));
      const sleepy = k01(t, 114.3, BEAT.asleep);
      const nod = 0.2 * pulse(t, 115.0, 115.4, 0.1, 0.25) + 0.25 * pulse(t, 115.8, 116.2, 0.1, 0.25);
      const asleep = k01(t, BEAT.asleep, 117.2);
      boltPose(S, {
        x: SIT_B[0], z: SIT_B[1], rotY: 0, odo: 10, glow: 0.8, light: 0.55,
        lidTop: lerp(0.15, 0.62, sleepy) + 0.38 * asleep, headPitch: nod + 0.25 * asleep, headRoll: -0.22 * asleep, roll: -0.07 * asleep,
        antenna: 1 - 0.85 * asleep, squash: 1 - 0.04 * asleep, armL: [-0.25, 0.05, -0.5, 0.1], armR: [-0.25, 0.05, -0.5, 0.1], idle: 1 - 0.5 * asleep, blink: sleepy < 0.5,
      });
      const nestle = k01(t, 116.9, 117.6, 'inOutCubic');
      lumaPose(S, {
        x: lerp(SIT_L[0], SIT_L[0] - 0.22, nestle), y: lerp(1.1, 1.0, nestle), z: SIT_L[1], rotY: -0.25 * nestle, roll: 0.12 * nestle,
        eyes: t < 116.8 ? 'open' : t < 117.8 ? 'happy' : 'closed', lookX: -0.4 * pulse(t, 116.4, 117.4, 0.2, 0.3),
        glow: 1 - 0.35 * nestle + 0.1 * Math.sin(t * 1.5), light: 1.6 - 0.4 * nestle, bob: 0.6,
      });
      sproutPlanted(S, { glow: 0.35 });
      S.fx.zzz(t, 117.1, 119.6, headPos(S, 0.25).toArray());
      // shooting star
      const ss = clamp((t - BEAT.shootingStar) / 0.9);
      if (ss > 0 && ss < 1) {
        const a = new THREE.Vector3(-30, 60, -90), b = new THREE.Vector3(-70, 42, -80);
        for (let i = 0; i < 20; i++) {
          const q = clamp(ss - i * 0.012);
          const p = a.clone().lerp(b, q);
          S.fx.glow.add(p.x, p.y, p.z, 1.6 * (1 - i / 20), 1, 1, 1.2, (1 - i / 20) * Math.sin(ss * Math.PI));
        }
      }
      const up = k01(t, 116.0, 118.9, 'inOutSine');
      S.cam([2.6, 0.55 + 0.2 * up, 5.6], [2.6, lerp(1.05, 4.8, up), lerp(0.2, -2, up)], 36);
      S.shake(0.15);
      S.shadowFocus(P[0], P[1], 4);
      S.grade.uFade.value = smoothstep(BEAT.nightFade, BEAT.dawnIn, t);
      S.fx.motes(t, [2.6, 0, 1], { count: 150, radius: 5, height: 3, color: [0.6, 0.7, 1], alpha: 0.3, size: 0.03 });
    },
  },

  // I1 — Dawn. "And when the sun came up... something magical happened!"
  {
    name: 'dawn', end: 124.6,
    update(S, t) {
      S.setMood(S.mood('dawn', { sunEl: lerp(-1.5, 5, k01(t, BEAT.dawnIn, 124.6, 'linear')) }));
      boltPose(S, {
        x: SIT_B[0], z: SIT_B[1], rotY: 0, odo: 10, lidTop: 1, blink: false, headPitch: 0.25, headRoll: -0.22, roll: -0.07, antenna: 0.15, idle: 0.5,
        armL: [-0.25, 0.05, -0.5, 0.1], armR: [-0.25, 0.05, -0.5, 0.1],
      });
      lumaPose(S, { x: SIT_L[0] - 0.22, y: 1.0, z: SIT_L[1], rotY: -0.25, roll: 0.12, eyes: 'closed', blink: false, glow: 0.6, light: 0.5, bob: 0.5 });
      S.fx.zzz(t, 117.1, 121.3, headPos(S, 0.25).toArray(), { size: 0.1 });
      const glow = smoothstep(BEAT.glowUp, BEAT.pulse, t);
      sproutPlanted(S, { glow: 0.3 + 2.2 * glow, scale: 1.35 + 0.25 * glow, unfurl: 1 + 0.25 * glow });
      const sp = [P[0], S.ground(P[0], P[1]) + 0.12, P[1]];
      S.fx.sparkles(t, sp, { count: 50, radius: 0.3 + 0.4 * glow, color: [0.7, 1, 0.5], size: 0.035, alpha: 0.8 * glow, rise: 0.5, seed: 21 });
      const flash = pulse(t, BEAT.pulse, BEAT.pulse + 0.9, 0.05, 0.8);
      if (flash > 0) S.fx.glow.add(sp[0], sp[1], sp[2], 0.6 + 1.6 * k01(t, BEAT.pulse, BEAT.pulse + 0.9), 0.5, 0.9, 0.35, flash * 0.8);
      const k = k01(t, BEAT.dawnIn, 124.6);
      S.cam([P[0] + 0.15, S.ground(P[0], P[1] + 1.6) + lerp(0.18, 0.22, k), P[1] + lerp(1.75, 1.55, k)], [P[0] - 0.05, lerp(0.5, 0.55, k), P[1] - 1.0], 34);
      S.shake(0.15 + 1.5 * flash, 1.2);
      S.dof(Math.hypot(0.15, lerp(1.75, 1.55, k)), 0.012, 0.01);
      S.shadowFocus(P[0], P[1], 3);
      S.grade.uFade.value = 1 - smoothstep(BEAT.dawnIn, 120.3, t);
      S.fx.motes(t, [P[0], 0, P[1]], { count: 200, radius: 3, height: 2, color: [1, 0.8, 0.6], alpha: 0.4, size: 0.02 });
    },
  },

  // I2 — The green wave. "Whoa, look!" "Yay! Hooray!"
  {
    name: 'wave', end: BEAT.aerial,
    update(S, t) {
      S.setMood(S.mixMood(S.mood('dawn', { sunEl: 5 }), S.mood('bloomDay'), k01(t, 124.6, 130.5)));
      S.shared.uWind.value = 1;
      const wake = k01(t, BEAT.wake, BEAT.wake + 0.12, 'outQuad');
      const jump = Math.max(0, Math.sin(clamp((t - BEAT.wake - 0.05) / 0.4) * Math.PI)) * 0.22;
      const point = pulse(t, 125.5, 127.2, 0.25, 0.4);
      const awe = k01(t, 127.4, 128.2);
      boltPose(S, {
        x: SIT_B[0] - 0.25 * awe, z: SIT_B[1] - 0.15 * awe, rotY: lerp(0, 0.35, awe), odo: 10 - 0.25 * awe,
        lidTop: 1 - wake, blink: wake > 0.9, hop: jump, squash: 1 + jump * 0.6 + spring(t - BEAT.wake - 0.45, -0.1, 20, 7),
        headPitch: lerp(0.25, -0.1, wake) - 0.45 * awe, headRoll: lerp(-0.22, 0, wake), roll: lerp(-0.07, 0, wake), lean: -0.08 * awe,
        headYaw: 0.35 * Math.sin((t - 125) * 1.6) * (1 - point) * (1 - awe) * wake,
        pupil: 1 + 0.35 * wake, sparkle: wake, lidBot: 0.3 * awe,
        armR: [lerp(-0.3, -1.65, point) - 1.0 * awe, 0.1 + 0.4 * awe, -0.2, 0.5], armL: [-0.4 - 2.0 * awe, 0.1 + 0.4 * awe, -0.3, 0.6],
        antenna: 1 + 2 * wake, antennaWiggle: jump * 3 + 0.3,
      });
      const lwake = k01(t, 125.2, 125.4);
      const hooray = k01(t, 127.0, 128.4, 'inOutCubic');
      const spin = hooray * Math.PI * 4;
      lumaPose(S, {
        x: lerp(SIT_L[0] - 0.22, SIT_L[0] + 0.7, hooray), y: lerp(1.0, 1.25, lwake) + 0.8 * Math.sin(hooray * Math.PI) + 0.35 * hooray, z: SIT_L[1] - 0.1 * hooray, rotY: -0.25 + spin, roll: lerp(0.12, 0, lwake),
        eyes: t < 125.3 ? 'closed' : t < 126.8 ? 'wide' : 'happy', glow: 1 + 0.8 * hooray, light: 1, bob: 1,
        armL: [0.2 + 1.3 * pulse(t, 127.0, 128.8), 0.2, 0.1], armR: [0.2 + 1.3 * pulse(t, 127.0, 128.8), 0.2, 0.1],
      });
      if (heroGrowth(t) < 0.12) sproutPlanted(S, { glow: 1.8 * (1 - smoothstep(125, 126.5, t)) + 0.4, scale: 1.6 + heroGrowth(t) * 4, halo: 0.6 });
      const hk = k01(t, 127.3, BEAT.aerial, 'inOutSine');
      S.cam([lerp(2.6, 2.6, hk), lerp(0.85, 2.7, hk), lerp(4.5, 8.2, hk)], [P[0], lerp(0.75, 1.7, hk), lerp(1.1, 1.3, hk)], lerp(38, 42, hk));
      S.shake(0.25);
      S.shadowFocus(P[0], P[1], 6);
      S.fx.petals(t, [P[0], S.ground(P[0], P[1]), P[1]], { count: 60, radius: 3, height: 3.2, alpha: smoothstep(129.5, 130.5, t) });
      S.fx.sparkles(t, [P[0], 1.2, P[1]], { count: 50, radius: 2.5, color: [1, 1, 0.7], size: 0.09, alpha: pulse(t, 125.5, 130.5, 0.5, 1), rise: 0.8, seed: 23 });
    },
  },

  // I3 — Aerial: the whole world turns green. "...it grows, and grows, and grows!"
  {
    name: 'aerial', end: BEAT.golden,
    update(S, t) {
      S.setMood(S.mood('bloomDay'));
      const k = k01(t, BEAT.aerial, BEAT.golden, 'inOutSine');
      const pos = spline([[2.6, 2.7, 8.2], [3.0, 8, 17], [3.2, 21, 33], [2.8, 15, 25], [2.0, 5, 11.5], [4.4, 1.1, 5.6]], k);
      const tgt = spline([[2.6, 1.7, 1.3], [2.5, 2, -6], [2, 0, -16], [2, 0, -8], [2.4, 0.9, 1.8], [2.35, 0.8, 2.75]], k);
      S.cam(pos, tgt, lerp(42, 36, k));
      S.shake(0.35, 0.5);
      S.shadowFocus(P[0], P[1] + 1, lerp(10, 5, k));
      // dancing
      const D = [2.2, 2.95];
      const dance = smoothstep(134.5, 135.3, t);
      boltPose(S, {
        x: D[0], z: D[1], rotY: 0.3 + (t - 131) * 2.2 * dance, odoL: t * 2 * dance, odoR: -t * 2 * dance, hop: Math.abs(Math.sin(t * 6)) * 0.08 * dance,
        armL: [-2.6 + Math.sin(t * 6) * 0.3, 0.6, -0.3, 0.9], armR: [-2.6 + Math.sin(t * 6 + 1.5) * 0.3, 0.6, -0.3, 0.9],
        lidBot: 0.45, antenna: 2.5, antennaWiggle: 0.6, headRoll: Math.sin(t * 3) * 0.15,
      });
      const a = (t - 131) * 2.4;
      const lx = D[0] + Math.cos(a) * 1.1, lz = D[1] + Math.sin(a) * 1.1;
      lumaPose(S, { x: lx, y: 1.2 + Math.sin(a * 2) * 0.25, z: lz, rotY: -a, roll: -0.45, eyes: 'happy', glow: 1.4, light: 0.6, bob: 0.3 });
      S.fx.trail(t, (tt) => [D[0] + Math.cos((tt - 131) * 2.4) * 1.1, 1.2 + Math.sin((tt - 131) * 4.8) * 0.25, D[1] + Math.sin((tt - 131) * 2.4) * 1.1], { n: 45, dt: 0.02, size: 0.2, alpha: 0.8 });
      S.fx.petals(t, [P[0], S.ground(P[0], P[1]), P[1]], { count: 90, radius: 3.5, height: 3.4 });
      S.fx.sparkles(t, [P[0], 1.2, P[1]], { count: 40, radius: 3, color: [1, 1, 0.7], size: 0.08, alpha: 0.6, rise: 0.8, seed: 24 });
    },
  },

  // J1 — Golden hour under the blossom tree. "And Bolt was never, ever lonely again." "Friend!" "Best friends!"
  {
    name: 'golden', end: 147.2,
    update(S, t) {
      S.setMood(S.mood('goldenHour'));
      S.shared.uWind.value = 0.6;
      const reach = k01(t, 143.1, 143.6);
      const hug = k01(t, 144.3, 144.8);
      const back = k01(t, 145.5, 146.3);
      boltPose(S, {
        x: GOLD_B[0], z: GOLD_B[1], rotY: 0, odo: 12, headYaw: 0.6 * reach * (1 - back) + 0.1 * back, headPitch: -0.1, headRoll: -0.1 * hug,
        lidBot: 0.25 + 0.2 * hug, pupil: 1.1, blush: 0.7 * hug, display: hug > 0.5 ? 'heart' : 'battery', antenna: 1.5 + hug,
        armR: [lerp(-0.35, -1.15, reach), lerp(0.1, 0.75, reach), -0.4, 0.3], armL: [-0.35, 0.1, -0.7, 0.2],
      });
      const hp = headPos(S, 0);
      lumaPose(S, {
        x: lerp(GOLD_L[0], GOLD_L[0] - 0.25, hug), y: lerp(1.08, 0.98, hug), z: GOLD_L[1], rotY: lerp(0, -0.9, reach) * (1 - back) + -0.2 * back, roll: 0.25 * hug,
        eyes: 'happy', glow: 1.1 + 0.4 * hug, light: 0.9, armL: [0.2 + 0.9 * hug, 0.6 * hug, 0.03 * hug], armR: [0.2, 0, 0], bob: 1 - 0.6 * hug,
      });
      S.fx.hearts3(t, 144.7, [(GOLD_B[0] + GOLD_L[0]) / 2, 1.35, GOLD_B[1]], { count: 5, size: 0.12, life: 2.4 });
      S.fx.fireflies(t, [P[0], S.ground(P[0], P[1]), P[1] + 1], { count: 45, radius: 6, alpha: smoothstep(140, 143, t) });
      S.fx.petals(t, [P[0], S.ground(P[0], P[1]), P[1]], { count: 70, radius: 3.2, height: 3.2 });
      S.nature.butterflies.update(t, P, 1 - smoothstep(141, 144, t));
      const orbit = k01(t, 141.4, 143.1, 'inOutSine');
      const cam = spline([[1.05, 0.72, 0.05], [-0.35, 0.85, 2.6], [1.3, 0.78, 5.1]], orbit);
      const look = spline([[3.4, 1.0, 6.5], [2.6, 0.85, 2.6], [2.62, 0.82, 2.55]], orbit);
      S.cam(cam, look, lerp(36, 32, orbit));
      S.shake(0.2);
      S.shadowFocus(P[0], P[1] + 0.6, 4);
      S.grade.uSaturation.value = 1.1;
    },
  },

  // J2 — Twilight, fireflies, iris out. "The End."
  {
    name: 'irisOut', end: 154.4,
    update(S, t) {
      S.setMood(S.mixMood(S.mood('goldenHour'), S.mood('twilightGarden'), k01(t, 147.2, 151.2)));
      S.shared.uWind.value = 0.5;
      const wave = pulse(t, 150.5, 151.5, 0.15, 0.2);
      boltPose(S, {
        x: GOLD_B[0], z: GOLD_B[1], rotY: 0, odo: 12, lidBot: 0.35, headRoll: -0.1 + 0.1 * wave, blush: 0.4, antenna: 2, glow: 0.6,
        armL: [-0.35, 0.1, -0.7, 0.2], armR: [lerp(-0.4, -2.6, wave), 0.4 + Math.sin(t * 16) * 0.3 * wave, -0.5, 0.8],
      });
      lumaPose(S, { x: GOLD_L[0] - 0.25, y: 0.98, z: GOLD_L[1], roll: 0.25, eyes: 'happy', glow: 1.4, light: 1.3, armL: [1.1, 0.6, 0.03], bob: 0.4 });
      S.fx.fireflies(t, [P[0], S.ground(P[0], P[1]), P[1] + 1], { count: 80, radius: 7 });
      S.fx.petals(t, [P[0], S.ground(P[0], P[1]), P[1]], { count: 40, radius: 3.2, height: 3.2, alpha: 0.7 });
      const k = k01(t, 147.2, 151.6, 'inOutSine');
      S.cam([2.62, lerp(1.35, 1.1, k), lerp(9.8, 6.2, k)], [2.62, lerp(1.6, 0.85, k), 2.2], lerp(38, 34, k));
      S.shake(0.15);
      S.shadowFocus(P[0], P[1] + 0.6, 5);
      // iris closes on the pair (with a little hold for Bolt's wave)
      S.camera.updateMatrixWorld(true);
      const c = new THREE.Vector3((GOLD_B[0] + GOLD_L[0]) / 2, 0.8, GOLD_B[1]).project(S.camera);
      S.grade.uIrisCenter.value.set(c.x * 0.5 + 0.5, c.y * 0.5 + 0.5);
      S.grade.uIris.value = track([[BEAT.iris[0], 1.3], [150.4, 0.24, 'inOutCubic'], [151.1, 0.22], [BEAT.iris[1], 0.0, 'inBack']], t);
      S.overlay.show('end', pulse(t, 151.7, 154.3, 0.5, 0.7), 0.95 + 0.05 * k01(t, 151.7, 154.3));
    },
  },

  // J3 — Credits.
  {
    name: 'credits', end: BEAT.end,
    update(S, t) {
      S.setMood(S.mood('twilightGarden'));
      S.cam([0, -50, 0], [0, -60, 1], 30);
      S.grade.uFade.value = 1;
      S.overlay.show('credit', pulse(t, 154.6, 158.6, 0.8, 0.9));
    },
  },
];

// ---------------------------------------------------------------- set pieces
const scrapSpots = [[-0.12, 0.62, 0.3], [0.14, 0.7, 1.1], [0.02, 0.85, 2.2], [-0.2, 0.8, 0.7], [0.22, 0.58, 1.7], [0.0, 0.66, 2.8]];
function scrapsOnGround(S) {
  scrapSpots.forEach((sp, i) => {
    const m = S.scraps[i];
    m.visible = true;
    const x = BW[0] + sp[0], z = BW[1] + sp[1];
    m.position.set(x, S.ground(x, z) + 0.05, z);
    m.rotation.set(sp[2], sp[2] * 2, 0);
    m.scale.setScalar(1);
  });
}
function baseTower(S) {
  const g = S.ground(TB[0], TB[1]);
  placeCube(S, 0, TB[0], g + 0.2, TB[1], 0, 0.05, 0);
  placeCube(S, 1, TB[0] + 0.02, g + 0.6, TB[1] - 0.01, 0, -0.04, 0);
}
function hideCubes(S) {
  const g = S.ground(HC[0], HC[1]);
  placeCube(S, 0, HC[0], g + 0.2, HC[1], 0, 0.3, 0);
  placeCube(S, 1, HC[0] + 0.02, g + 0.6, HC[1], 0, 0.25, 0);
  placeCube(S, 2, HC[0] - 0.02, g + 1.0, HC[1] + 0.01, 0, 0.36, 0);
}
function lumaFall(t) {
  if (t < BEAT.whoosh || t > BEAT.impact) return null;
  const k = ease.inQuad(clamp((t - BEAT.whoosh) / (BEAT.impact - BEAT.whoosh)));
  const L = LAYOUT.lumaLand;
  return spline([[34, 48, -62], [16, 20, -32], [7, 6, -14], [L[0], 0.9, L[1]]], k);
}
function loopPath(t, C) {
  const a = (t - 91.5) * 2.1;
  const loop = pulse(t, 93.3, 94.5, 0.01, 0.01);
  const la = k01(t, 93.3, 94.5) * Math.PI * 2;
  const r = 2.0;
  const base = [C[0] + Math.cos(a) * r, 1.15 + Math.sin(a * 2) * 0.35, C[1] + Math.sin(a) * r];
  if (loop > 0) {
    base[1] += (1 - Math.cos(la)) * 0.9;
    const out = Math.sin(la) * 0.9;
    base[0] += Math.cos(a) * out;
    base[2] += Math.sin(a) * out;
  }
  return base;
}

// Resolve start/end and add global continuity.
let start = 0;
export const SHOTS = SHOTS_RAW.map((s) => {
  const shot = {
    name: s.name, start, end: s.end,
    update(S, lt, t) {
      worldState(S, t);
      s.update(S, t);
    },
  };
  start = s.end;
  return shot;
});
