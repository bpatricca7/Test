// ECHO (characters cut) — the Visitor: a detailed, talking hologram creature.
//
// A tall (2.1 m), slender, three-legged being with an elongated skull, a
// swept-back crest, very large dark almond eyes with a faint inner glow, real
// eyelids, a small articulated mouth and long three-fingered hands. Built
// entirely procedurally in create(): an SDF skull polygonised on a
// mouth-centred grid, generalized-cylinder limbs regenerated from the pose each
// frame, a baked skin-detail texture, and ~30k voxels of light for
// materialize/dissolve. Rendered as a hologram: depth pre-pass + premultiplied
// transparent colour pass (so it is see-through but never shows its own far
// side), fresnel rim, scanlines, interference, faint internal skeleton.
//
// API: see API.md ("The Visitor"). Extras: state.eyes {squint, wide},
// state.mouth {smile, jaw}, state.autoBlink (default: on when state.blink is
// undefined). v.light is NOT parented to v.root: add it to the scene; set()
// writes its world position.

import { makeSkull, buildHead, mouthParams, HEAD } from './visitor/head.js';
import { createBody } from './visitor/body.js';
import { solvePose, followThrough, mv } from './visitor/rig.js';
import { bakeDetailTexture } from './visitor/textures.js';
import { SKIN_VERT, SKIN_FRAG, EYE_VERT, EYE_FRAG, BONE_VERT, BONE_FRAG } from './visitor/shaders.js';
import { createParticles, buildFrontY, MAT, DIS } from './visitor/particles.js';

const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const hash1 = n => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };

export async function createVisitor(env) {
  const { THREE, U } = env;
  const root = new THREE.Group();
  root.name = 'visitor';

  // ---- geometry ----
  const skull = makeSkull();
  const hd = buildHead(skull, 112);
  const body = createBody(THREE, skull, hd);
  const detail = bakeDetailTexture(THREE, U);

  // ---- shared uniforms ----
  const uni = {
    uTime: { value: 0 }, uFlicker: { value: 0 }, uFlick: { value: 1 }, uPresence: { value: 1 },
    uBuildY: { value: 100 }, uBuildBand: { value: MAT.band }, uVoxAmt: { value: 0 }, uVoxQ: { value: 1 },
    uDissT: { value: -100 }, uDissBand: { value: DIS.band }, uDissO: { value: new THREE.Vector3() }, uDissD: { value: new THREE.Vector3(0, -1, 0) },
    uGlow: { value: 0 }, uPulse: { value: 0 },
  };
  const skinUni = Object.assign({}, uni, {
    uDetail: { value: detail },
    uCore: { value: new THREE.Vector3(0, 1.32, 0.03) }, uThroat: { value: new THREE.Vector3(0, 1.75, 0.05) },
    uHeadRot: { value: new THREE.Matrix3() },
  });
  const PREMUL = { blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendEquation: THREE.AddEquation,
    blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor };
  const skinDepth = new THREE.ShaderMaterial({ vertexShader: SKIN_VERT, fragmentShader: SKIN_FRAG, uniforms: skinUni, defines: { DEPTH_ONLY: 1 },
    transparent: true, colorWrite: false, depthWrite: true, side: THREE.FrontSide });
  const skinColor = new THREE.ShaderMaterial(Object.assign({ vertexShader: SKIN_VERT, fragmentShader: SKIN_FRAG, uniforms: skinUni,
    transparent: true, depthWrite: false, depthFunc: THREE.LessEqualDepth, side: THREE.FrontSide }, PREMUL));
  const boneMat = new THREE.ShaderMaterial({ vertexShader: BONE_VERT, fragmentShader: BONE_FRAG, uniforms: uni,
    transparent: true, depthWrite: false, side: THREE.FrontSide,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendEquation: THREE.AddEquation });

  const g = body.buf.geometry;
  const mDepth = new THREE.Mesh(g, skinDepth); mDepth.renderOrder = 11; mDepth.frustumCulled = false;
  const mColor = new THREE.Mesh(g, skinColor); mColor.renderOrder = 12; mColor.frustumCulled = false;
  const mBones = new THREE.Mesh(body.bones.geometry, boneMat); mBones.renderOrder = 10; mBones.frustumCulled = false;
  root.add(mBones, mDepth, mColor);

  // ---- eyes ----
  const headGroup = new THREE.Group();
  headGroup.matrixAutoUpdate = false;
  root.add(headGroup);
  const eyeGeo = new THREE.SphereGeometry(1, 48, 32);
  const eyes = skull.eyes.map(e => {
    const eu = Object.assign({}, uni, { uGaze: { value: new THREE.Vector3(0, 0, 1) }, uIris: { value: 0.5 }, uPupil: { value: 0.2 }, uRootInv: { value: new THREE.Matrix4() } });
    const dm = new THREE.ShaderMaterial({ vertexShader: EYE_VERT, fragmentShader: EYE_FRAG, uniforms: eu, defines: { DEPTH_ONLY: 1 },
      transparent: true, colorWrite: false, depthWrite: true });
    const cm = new THREE.ShaderMaterial(Object.assign({ vertexShader: EYE_VERT, fragmentShader: EYE_FRAG, uniforms: eu,
      transparent: true, depthWrite: false, depthFunc: THREE.LessEqualDepth }, PREMUL));
    const R = e.R;
    const m4 = new THREE.Matrix4().set(R[0] * e.r[0], R[1] * e.r[1], R[2] * e.r[2], e.c[0], R[3] * e.r[0], R[4] * e.r[1], R[5] * e.r[2], e.c[1],
      R[6] * e.r[0], R[7] * e.r[1], R[8] * e.r[2], e.c[2], 0, 0, 0, 1);
    const md = new THREE.Mesh(eyeGeo, dm), mc = new THREE.Mesh(eyeGeo, cm);
    for (const m of [md, mc]) { m.matrixAutoUpdate = false; m.matrix.copy(m4); m.frustumCulled = false; headGroup.add(m); }
    md.renderOrder = 11; mc.renderOrder = 12;
    return { e, uni: eu, md, mc };
  });

  // ---- light ----
  const light = new THREE.PointLight(new THREE.Color(0.45, 0.88, 1.0), 0, 6.5, 2);
  light.name = 'visitorLight';

  // ---- state ----
  let pose = null, face = null, dirty = true, cur = { m: 1, d: 0, t: 0 };
  let partFrame = null;
  const rootPos = [0, 0, 0];
  let yaw = 0;
  const toLocal = w => { const dx = w[0] - rootPos[0], dy = w[1] - rootPos[1], dz = w[2] - rootPos[2], c = Math.cos(yaw), s = Math.sin(yaw); return [dx * c - dz * s, dy, dx * s + dz * c]; };
  const toWorld = l => { const c = Math.cos(yaw), s = Math.sin(yaw); return [rootPos[0] + l[0] * c + l[2] * s, rootPos[1] + l[1], rootPos[2] - l[0] * s + l[2] * c]; };

  function autoBlink(t) {
    // slow, calm blinks every ~3.5-6.5 s (deterministic)
    const P = 5.0;
    const k = Math.floor(t / P);
    let b = 0;
    for (const kk of [k - 1, k]) {
      const bt = kk * P + 0.6 + hash1(kk) * 3.2;
      const d = t - bt;
      if (d > -0.12 && d < 0.34) b = Math.max(b, d < 0 ? 1 + d / 0.12 : d < 0.08 ? 1 : 1 - (d - 0.08) / 0.26);
    }
    return clamp(b);
  }

  function set(s = {}) {
    const t = s.t || 0;
    const p = s.position || [0, 0, 0];
    rootPos[0] = p[0]; rootPos[1] = p[1]; rootPos[2] = p[2];
    yaw = s.yaw || 0;
    root.position.set(p[0], p[1], p[2]);
    root.rotation.set(0, yaw, 0);
    root.updateMatrixWorld(true);

    const ft = followThrough(s);
    pose = solvePose(s, ft, toLocal);
    const glow = clamp(s.glow || 0);
    const vis = s.visemes || null;
    const mouthX = s.mouth || {};
    const eyesX = s.eyes || {};
    const mouth = mouthParams(vis, { smile: (mouthX.smile || 0) + 0.12, jaw: mouthX.jaw || 0 });
    // talking: the face stays alive (a hint of lid lift on loud syllables)
    const blink = s.blink !== undefined && s.autoBlink !== true ? clamp(s.blink) : Math.max(clamp(s.blink || 0), s.autoBlink === false ? 0 : autoBlink(t));
    // gaze (head space) per eye
    const Rh = pose.Rhead, hc = pose.headC;
    let tgt;
    if (pose.lookLocal) {
      const d = [pose.lookLocal[0] - hc[0], pose.lookLocal[1] - hc[1], pose.lookLocal[2] - hc[2]];
      tgt = [Rh[0] * d[0] + Rh[3] * d[1] + Rh[6] * d[2], Rh[1] * d[0] + Rh[4] * d[1] + Rh[7] * d[2], Rh[2] * d[0] + Rh[5] * d[1] + Rh[8] * d[2]];
    } else tgt = [0, 0, 3];
    // micro-saccade drift (small, deterministic)
    const sk = Math.floor(t / 0.9);
    tgt = [tgt[0] + (hash1(sk * 3.1) - 0.5) * 0.012 * Math.hypot(...tgt), tgt[1] + (hash1(sk * 7.7) - 0.5) * 0.008 * Math.hypot(...tgt), tgt[2]];
    const lidsArr = [];
    let gazePitchAvg = 0;
    const gazes = skull.eyes.map(e => {
      const d = [tgt[0] - e.c[0], tgt[1] - e.c[1], tgt[2] - e.c[2]];
      const yawG = clamp(Math.atan2(d[0], d[2]), -0.55, 0.55);
      const pitchG = clamp(Math.atan2(d[1], Math.hypot(d[0], d[2])), -0.4, 0.4);
      gazePitchAvg += pitchG * 0.5;
      const r = e.side * HEAD.eye.roll;
      const ph = yawG * 1.25, el = pitchG * 1.1;
      const phi = ph * Math.cos(r) + el * Math.sin(r), eps = -ph * Math.sin(r) + el * Math.cos(r);
      return [Math.sin(phi) * Math.cos(eps), Math.sin(eps), Math.cos(phi) * Math.cos(eps)];
    });
    for (const e of skull.eyes) {
      lidsArr.push({
        upper: 0.16 * (eyesX.wide || 0) - 0.14 * (eyesX.squint || 0) + 0.55 * gazePitchAvg + 0.05 * glow - 0.03 * pose.crouch,
        lower: 0.14 * (eyesX.squint || 0) + 0.1 * (mouthX.smile || 0) + 0.2 * Math.min(0, gazePitchAvg) + 0.04,
        blink,
      });
    }
    face = { mouth, lids: lidsArr, eyes: skull.eyes };

    // ---- eyes ----
    const Mh = new THREE.Matrix4().set(Rh[0], Rh[1], Rh[2], hc[0], Rh[3], Rh[4], Rh[5], hc[1], Rh[6], Rh[7], Rh[8], hc[2], 0, 0, 0, 1);
    headGroup.matrix.copy(Mh);
    headGroup.matrixWorldNeedsUpdate = true;
    root.updateMatrixWorld(true);
    const rootInv = root.matrixWorld.clone().invert();
    eyes.forEach((E, i) => { E.uni.uGaze.value.set(...gazes[i]); E.uni.uRootInv.value.copy(rootInv); E.uni.uPupil.value = 0.19 + 0.02 * Math.sin(t * 0.7 + i); });
    // head rotation in world for triplanar weights
    const c = Math.cos(yaw), sn = Math.sin(yaw);
    const Ry = [c, 0, sn, 0, 1, 0, -sn, 0, c];
    const W = [
      Ry[0] * Rh[0] + Ry[2] * Rh[6], Ry[0] * Rh[1] + Ry[2] * Rh[7], Ry[0] * Rh[2] + Ry[2] * Rh[8],
      Rh[3], Rh[4], Rh[5],
      Ry[6] * Rh[0] + Ry[8] * Rh[6], Ry[6] * Rh[1] + Ry[8] * Rh[7], Ry[6] * Rh[2] + Ry[8] * Rh[8]];
    skinUni.uHeadRot.value.set(W[0], W[1], W[2], W[3], W[4], W[5], W[6], W[7], W[8]);

    // ---- hologram state ----
    const m = s.materialize ?? 1, d = s.dissolve ?? 0;
    const flicker = clamp(s.flicker ?? 0.1);
    uni.uTime.value = t;
    uni.uFlicker.value = flicker;
    const fr = Math.floor(t * 24);
    const jit = hash1(fr * 0.37 + 1.3);
    uni.uFlick.value = 1 - flicker * (jit < 0.25 ? 0.4 * (1 - jit * 4) : 0.06 * jit) - 0.03 * Math.sin(t * 17.3) * flicker;
    uni.uGlow.value = glow;
    uni.uPulse.value = 0.5 + 0.5 * Math.sin(t * 2 * Math.PI / 5.3 - 0.7);
    uni.uBuildY.value = m >= 1 ? 100 : buildFrontY(m);
    uni.uVoxAmt.value = Math.max(m < 1 ? 1 - sstep(0.86, 0.985, m) : 0, 0.5 * sstep(0.0, 0.1, d));
    uni.uPresence.value = m <= 0 ? 0 : (0.62 + 0.38 * sstep(0.7, 1.0, m)) * (1 - 0.25 * d);
    // dissolve ordering: from the top and the side facing the window, down to the feet
    const winW = s.dissolveTo || [rootPos[0] + 1.2, 1.4, rootPos[2] + 0.8];
    const wl = toLocal(winW);
    const wh = Math.hypot(wl[0], wl[2]) || 1;
    const wx = wl[0] / wh, wz = wl[2] / wh;
    const D = [-0.42 * wx, -0.86, -0.42 * wz];
    const dl = Math.hypot(...D);
    D[0] /= dl; D[1] /= dl; D[2] /= dl;
    uni.uDissO.value.set(0, 0, 0);
    uni.uDissD.value.set(D[0], D[1], D[2]);
    const omin = D[1] * 2.25 - 0.3, omax = 0.3;
    const range = omax - omin + 2 * DIS.band;
    const dissT = x => omin - DIS.band + (x - DIS.d0) / (DIS.d1 - DIS.d0) * range;
    uni.uDissT.value = d <= 0 ? -100 : dissT(d);
    const dissLaunch = o => DIS.d0 + (o - omin + DIS.band) / range * (DIS.d1 - DIS.d0);
    // chest core & throat (object space)
    const core = pose.spine[3], thr = [hc[0] + Rh[1] * -0.06 + Rh[2] * 0.02, hc[1] + Rh[4] * -0.06 + Rh[5] * 0.02, hc[2] + Rh[7] * -0.06 + Rh[8] * 0.02];
    skinUni.uCore.value.set(core[0], core[1] + 0.02, core[2] + 0.02);
    skinUni.uThroat.value.set(thr[0], thr[1], thr[2]);

    const visible = m > 0 && d < 1;
    mDepth.visible = mColor.visible = mBones.visible = headGroup.visible = visible;

    // ---- light ----
    const pres = sstep(0.25, 0.95, m) * (1 - sstep(0.05, 0.85, d));
    const level = pres * (0.78 + 0.32 * glow + 0.06 * uni.uPulse.value) * uni.uFlick.value;
    v.lightLevel = level;
    light.intensity = 2.4 * level;
    const lp = toWorld([pose.spine[3][0], pose.spine[3][1] + 0.08, pose.spine[3][2] + 0.25]);
    if (light.parent && !light.parent.isScene) {
      light.parent.updateWorldMatrix(true, false);
      light.position.set(...lp).applyMatrix4(light.parent.matrixWorld.clone().invert());
    } else light.position.set(...lp);

    // ---- particles (built with the geometry) ----
    const scr = s.materializeFrom || { center: [-0.5, 1.12, -1.7], width: 0.62, height: 0.35 };
    const sc = toLocal(scr.center);
    const n = scr.normal ? scr.normal : [0, 0, 1];
    const nl = toLocal([rootPos[0] + n[0], rootPos[1] + n[1], rootPos[2] + n[2]]);
    const upL = [0, 1, 0];
    const rightL = [nl[1] * upL[2] - nl[2] * upL[1], nl[2] * upL[0] - nl[0] * upL[2], nl[0] * upL[1] - nl[1] * upL[0]].map(x => -x);
    // window frame: normal points out of the room (from the Visitor toward the window)
    const wc = toLocal(winW);
    const wn = [wx, 0, wz];
    partFrame = {
      m, d, t, presence: pres, flicker, glow,
      screen: { c: sc, n: nl, up: upL, right: rightL, w: scr.width || 0.62, h: scr.height || 0.35 },
      win: { c: wc, n: wn, up: [0, 1, 0], right: [-wz, 0, wx], w: 1.1, h: 0.9 },
      axis: [pose.pelvis[0], pose.pelvis[2]],
      dissO: [0, 0, 0], dissD: D, dissLaunch,
    };
    cur = { m, d, t };
    dirty = true;
    return v;
  }

  function build() {
    if (!dirty || !pose) return;
    dirty = false;
    if (cur.m > 0 && cur.d < 1) body.write(pose, face);
    else if ((cur.m > 0 && cur.m < 1) || (cur.d > 0 && cur.d < 1)) body.write(pose, face);
    if (particles && partFrame) {
      if ((partFrame.m > 0 && partFrame.m < 1) || (partFrame.d > 0 && partFrame.d < 1) || partFrame.presence > 0.02) particles.update(partFrame);
      else particles.points.visible = false;
    }
  }

  // build geometry right before the scene is projected (so the upload is this frame)
  function hookScene(obj) {
    let sc = obj;
    while (sc && !sc.isScene) sc = sc.parent;
    if (!sc || sc.__visitorHooked) return;
    sc.__visitorHooked = true;
    const prev = sc.onBeforeRender;
    sc.onBeforeRender = function (...a) { build(); if (prev) prev.apply(this, a); };
  }
  root.addEventListener('added', () => hookScene(root));
  // fallback if the root was not added directly to a scene
  mBones.onBeforeRender = () => { if (dirty) build(); };

  const v = {
    root, light, lightLevel: 0,
    heights: { eye: 1.9, top: 2.1, crouchEye: 1.6 },
    set,
    prepare: build,
    getEye(out) {
      const e = pose ? [pose.headC[0] + pose.Rhead[1] * 0.004 + pose.Rhead[2] * 0.062, pose.headC[1] + pose.Rhead[4] * 0.004 + pose.Rhead[5] * 0.062, pose.headC[2] + pose.Rhead[7] * 0.004 + pose.Rhead[8] * 0.062] : [0, 1.9, 0.06];
      const w = toWorld(e);
      return out.set(w[0], w[1], w[2]);
    },
    getHead(out) {
      const w = toWorld(pose ? pose.headC : [0, 1.9, 0]);
      return out.set(w[0], w[1], w[2]);
    },
  };

  // rest pose once, then sample particle targets on it
  set({ t: 0 });
  dirty = true;
  body.write(pose, face);
  const particles = createParticles(THREE, U, body.buf, { surface: 24000, free: 5000, motes: 500, uniforms: uni });
  root.add(particles.points);
  v.triangles = body.triangles + eyeGeo.index.count / 3 * 2;
  v.particleCount = particles.count;
  return v;
}
