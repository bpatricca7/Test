// ECHO (characters cut): the two humans, Maya and Sam.
//
//   const maya = await createHuman(env, 'maya');  // or 'sam'
//   scene.add(maya.root); maya.set(state); maya.getEye(v); maya.getHead(v); maya.heights
//
// Everything is procedural and deterministic. See lib/human/* for the parts:
// headsdf/headmesh (sculpt + face topology), face (rig), skintex (baked skin),
// eyes, mouth, brows, ears, rig/pose (skeleton + solver), body/hand/loft
// (skinned clothes), fabric (baked cloth), hair, props (glasses, headphones...).

import * as THREE from 'three';
import { createHead } from './human/head.js';
import { faceControls } from './human/face.js';
import { createSkeleton, handBindInfo, BODY } from './human/rig.js';
import { solvePose, applyPose, normalizeState } from './human/pose.js';
import { buildBody, torsoSection, cardiganOpenAt } from './human/body.js';
import { buildHands } from './human/hand.js';
import { makeSkinMaterial } from './human/materials.js';
import { createMayaHair, createSamHair } from './human/hair.js';
import { createGlasses, createHeadphones, createHood, createKangaroo, createCardiganBits, createWatch, skinFromNearest } from './human/props.js';
import { computeSecondary } from './human/secondary.js';
import { knitTexture, weaveTexture, twillTexture, fleeceTexture, leatherTexture, plainTexture, makeClothMaterial } from './human/fabric.js';

const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);

const WARDROBE = {
  maya: rnd => ({
    shirt: makeClothMaterial(weaveTexture({ color: 0xe6dcc6, rnd }), { roughness: 0.8, sheen: 0x1a1612 }),
    knit: makeClothMaterial(knitTexture({ color: 0x5f6e3a, color2: 0x4f5c30, heather: 0.18, rnd }), { roughness: 0.95, sheen: 0x303820, normalScale: 1.4 }),
    knitRib: makeClothMaterial(knitTexture({ color: 0x566433, color2: 0x4a572c, heather: 0.15, rib: true, rnd }), { roughness: 0.95, sheen: 0x303820, normalScale: 1.4 }),
    trousers: makeClothMaterial(twillTexture({ warp: 0x2e2a2c, weft: 0x3a3436, tile: 0.02, threads: 80, rnd }), { roughness: 0.82, sheen: 0x141216 }),
    shoe: makeClothMaterial(leatherTexture({ color: 0x3a2418, rnd }), { roughness: 0.45 }),
    soleDark: makeClothMaterial(plainTexture({ color: 0x1c1512, rnd }), { roughness: 0.7 }),
  }),
  sam: rnd => ({
    hoodie: makeClothMaterial(fleeceTexture({ color: 0xc9a04a, rnd }), { roughness: 0.92, sheen: 0x3a3018 }),
    hoodieRib: makeClothMaterial(fleeceTexture({ color: 0xbd9442, rnd, rib: true }), { roughness: 0.92, sheen: 0x3a3018, normalScale: 1.4 }),
    jeans: makeClothMaterial(twillTexture({ warp: 0x21375e, weft: 0x8a93a6, tile: 0.025, threads: 56, denim: true, rnd }), { roughness: 0.85, sheen: 0x101826, normalScale: 1.3 }),
    sneaker: makeClothMaterial(leatherTexture({ color: 0xeceae4, rnd, grain: 0.6 }), { roughness: 0.6 }),
    sole: makeClothMaterial(plainTexture({ color: 0xf2efe8, rnd }), { roughness: 0.75 }),
  }),
};

export async function createHuman(env, id) {
  const U = env.U;
  const rnd = U.mulberry32(id === 'maya' ? 1977 : 2024);
  const B = BODY[id];
  const root = new THREE.Group();
  root.name = 'human_' + id;

  // ---------------------------------------------------------- skeleton
  const rig = createSkeleton(id);
  root.add(rig.bones.root);
  rig.bones.root.updateMatrixWorld(true);
  rig.skeleton.calculateInverses();
  const handBind = handBindInfo(id);

  // -------------------------------------------------------------- head
  const head = createHead(id, { rnd });
  head.group.position.set(B.headOrigin[0] - B.headBone[0], B.headOrigin[1] - B.headBone[1], B.headOrigin[2] - B.headBone[2]);
  rig.bones.head.add(head.group);
  const hair = id === 'maya' ? createMayaHair(head.H, rnd) : createSamHair(head.H, rnd);
  head.group.add(hair.group);

  // -------------------------------------------------------- body + clothes
  const mats = WARDROBE[id](rnd);
  const geoms = buildBody(id, rig, mats, rnd);
  const meshes = [];
  const bindM = new THREE.Matrix4();
  let bodyTris = 0;
  for (const key in geoms) {
    const m = new THREE.SkinnedMesh(geoms[key], mats[key]);
    m.name = key;
    m.bind(rig.skeleton, bindM);
    m.frustumCulled = false;
    m.castShadow = true; m.receiveShadow = true;
    root.add(m);
    meshes.push(m);
    bodyTris += geoms[key].index.count / 3;
  }
  // hands
  const hc = head.C;
  const sk = hc.base;
  const toByte = c => c.map(q => 255 * Math.pow(q, 1 / 2.2));
  const hands = buildHands(id, rig, { dorsal: toByte(sk), palm: toByte([sk[0] * 1.7 + 0.05, sk[1] * 1.9 + 0.04, sk[2] * 2.0 + 0.03]) }, rnd);
  const handMat = makeSkinMaterial({ wrap: [0.45, 0.2, 0.13], map: hands.tex.map, normalMap: hands.tex.normalMap });
  const handMesh = new THREE.SkinnedMesh(hands.geometry, handMat);
  handMesh.bind(rig.skeleton, bindM); handMesh.frustumCulled = false; handMesh.castShadow = true; handMesh.receiveShadow = true;
  root.add(handMesh);
  const nailMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(id === 'maya' ? 0xc9a090 : 0xb58a78), roughness: 0.25 });
  const nailMesh = new THREE.SkinnedMesh(hands.nails, nailMat);
  nailMesh.bind(rig.skeleton, bindM); nailMesh.frustumCulled = false;
  root.add(nailMesh);
  bodyTris += hands.geometry.index.count / 3 + hands.nails.index.count / 3;

  // ------------------------------------------------------------- props
  const addSkinned = (geo, mat, name) => {
    const m = new THREE.SkinnedMesh(geo, mat);
    m.name = name; m.bind(rig.skeleton, bindM); m.frustumCulled = false; m.castShadow = true; m.receiveShadow = true;
    root.add(m); meshes.push(m);
    bodyTris += (geo.index ? geo.index.count : geo.attributes.position.count) / 3;
    return m;
  };
  let glasses = null, phones = null, hood = null, propTris = 0;
  const chestPivot = new THREE.Group(); // secondary-motion pivots ride on the chest bone
  chestPivot.position.set(0, 0, 0);
  rig.bones.chest.add(chestPivot);
  if (id === 'maya') {
    glasses = createGlasses(head.L, rnd);
    head.group.add(glasses.group);
    propTris += glasses.tris;
    const bits = createCardiganBits(cardiganOpenAt, (y, th, off) => torsoSection('maya', y, th, off));
    const btnMat = new THREE.MeshStandardMaterial({ color: 0x4a3222, roughness: 0.35 });
    const btn = mergeGeoms(bits.buttons);
    skinFromNearest(btn, [geoms.knitRib]);
    addSkinned(btn, btnMat, 'buttons');
    for (const pg of bits.pockets) { skinFromNearest(pg, [geoms.knit]); addSkinned(pg, mats.knit, 'pocket'); }
    const w = createWatch(rig.J, rig.list.indexOf(rig.bones.twistL));
    addSkinned(w.band, new THREE.MeshStandardMaterial({ color: 0x3a2217, roughness: 0.55 }), 'watchBand');
    addSkinned(w.face, new THREE.MeshStandardMaterial({ color: 0xc9a45a, roughness: 0.25, metalness: 0.8 }), 'watchFace');
  } else {
    phones = createHeadphones(id, rnd);
    chestPivot.add(phones.group);
    propTris += phones.tris;
    hood = createHood(id, mats);
    chestPivot.add(hood.group);
    propTris += hood.tris;
    const kg = createKangaroo(id, (y, th) => torsoSection('sam', y, th, 0));
    skinFromNearest(kg, [geoms.hoodie]);
    addSkinned(kg, mats.hoodie, 'kangaroo');
  }

  // ------------------------------------------------------------- state
  const seed = id === 'maya' ? 1.37 : 2.71;
  const ctx = { id, rig, seed, handBind };
  const tmpQ = new THREE.Quaternion(), tmpM = new THREE.Matrix4();
  const eyeLocal = { L: new THREE.Vector3(...head.L.eyeL), R: new THREE.Vector3(...head.L.eyeR) };
  const eyeMidLocal = eyeLocal.L.clone().add(eyeLocal.R).multiplyScalar(0.5);
  const headCenterLocal = new THREE.Vector3(0, 0.0, -0.01);
  let last = null;

  function set(state = {}) {
    const S = normalizeState(state);
    const pose = solvePose(S, ctx);
    // ---- secondary motion (springs over sampled past poses, or procedural)
    const sec = computeSecondary(state, S, pose, ctx);
    // hem follow-through: rotate the hem bone against the hips' lag
    {
      const l = sec.hips;
      pose.L.hem.q.setFromEuler(new THREE.Euler(clamp(-l.z * 4.5, -0.25, 0.25), 0, clamp(l.x * 4.5, -0.2, 0.2)));
    }
    applyPose(pose, rig);
    root.position.set(S.position[0], S.position[1], S.position[2]);
    root.rotation.set(0, S.yaw, 0);
    // chest-borne props swing with the chest spring
    {
      const l = sec.chest;
      chestPivot.rotation.set(0, 0, 0);
      if (phones) phones.group.rotation.set(clamp(l.z * 3.0, -0.2, 0.2), 0, clamp(-l.x * 3.0, -0.2, 0.2));
      if (hood) {
        hood.group.rotation.set(clamp(l.z * 1.2, -0.08, 0.08), 0, clamp(-l.x * 1.2, -0.08, 0.08));
        hood.strings.forEach((sp, i) => sp.rotation.set(clamp(l.z * 9 + 0.05, -0.6, 0.6), 0, clamp(-l.x * 9 + (i ? 0.03 : -0.03), -0.6, 0.6)));
      }
    }
    // hair follow-through
    {
      const l = sec.head;
      hair.bunSway(clamp(l.z * 5, -0.35, 0.35), clamp(-l.x * 5, -0.35, 0.35));
      hair.sway(clamp(l.x * 0.8, -0.02, 0.02), clamp(l.y * 0.8, -0.02, 0.02), clamp(l.z * 0.8, -0.02, 0.02));
    }
    root.updateMatrixWorld(true);
    // ---- face
    const st2 = { ...state };
    // startle widens the eyes and lifts the brows
    if (S.startle > 0) {
      st2.eyes = { ...(state.eyes || {}), wide: clamp((state.eyes?.wide || 0) + S.startle) };
      st2.brows = { ...(state.brows || {}), raise: clamp((state.brows?.raise || 0) + S.startle * 0.8, -1, 1) };
      st2.mouth = { ...(state.mouth || {}), jaw: (state.mouth?.jaw || 0) + S.startle * 0.25 };
    }
    const c = faceControls(st2, head.persona);
    // gaze: eyes aim at lookAt (world), else straight ahead
    const inv = tmpM.copy(head.group.matrixWorld).invert();
    const gaze = { L: { yaw: 0, pitch: 0 }, R: { yaw: 0, pitch: 0 } };
    if (S.lookAt) {
      const tgt = new THREE.Vector3(...S.lookAt).applyMatrix4(inv);
      for (const k of ['L', 'R']) {
        const d = tgt.clone().sub(eyeLocal[k]);
        gaze[k].yaw = Math.atan2(d.x, d.z);
        gaze[k].pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
      }
    }
    // the neck: rotation of the head relative to the chest (for the neck skin blend)
    const neckQ = new THREE.Quaternion();
    rig.bones.chest.getWorldQuaternion(tmpQ);
    const hq = new THREE.Quaternion(); rig.bones.head.getWorldQuaternion(hq);
    neckQ.copy(tmpQ).invert().multiply(hq);
    head.setFace(c, gaze, neckQ);
    last = { S, pose, sec };
  }

  /** where the glasses find the monitor to reflect (world); texture optional */
  function setScreen({ center, right, up, width, height, color, texture, intensity } = {}) {
    if (!glasses) return;
    for (const l of glasses.lenses) {
      const U = l.material.userData.uniforms;
      if (center) U.uScrC.value.set(...center);
      if (right) U.uScrR.value.set(...right).normalize();
      if (up) U.uScrU.value.set(...up).normalize();
      if (width) U.uScrSize.value.x = width;
      if (height) U.uScrSize.value.y = height;
      if (color) U.uScrColor.value.set(color);
      if (intensity !== undefined) U.uScrI.value = intensity;
      if (texture !== undefined) { U.uScrTex.value = texture; U.uUseTex.value = texture ? 1 : 0; }
    }
  }
  /** the artificial eye catchlight strength (0..1+) */
  function setEyeLight(v) { for (const k of ['L', 'R']) head.eyes.eyes[k].cornea.material.userData.uniforms.uCatch.value = v; }

  set({});
  const eyeW = new THREE.Vector3();
  function getEye(out = new THREE.Vector3()) { return out.copy(eyeMidLocal).applyMatrix4(head.group.matrixWorld); }
  function getHead(out = new THREE.Vector3()) { return out.copy(headCenterLocal).applyMatrix4(head.group.matrixWorld); }
  const heights = {};
  set({}); heights.standEye = getEye(eyeW).y;
  set({ sit: 1, seatHeight: 0.47 }); heights.sitEye = getEye(eyeW).y;
  set({});

  const stats = { headTris: head.tris, earTris: head.ears.tris * 2, bodyTris, hairTris: hair.tris, propTris };
  return { root, set, getEye, getHead, heights, setScreen, setEyeLight, head, hair, rig, meshes, stats, id, get last() { return last; } };
}

function mergeGeoms(list) {
  const P = [], N = [], idx = [];
  let base = 0;
  for (const g of list) {
    const gi = g.index ? g : g;
    P.push(...gi.attributes.position.array); N.push(...gi.attributes.normal.array);
    if (gi.index) for (const i of gi.index.array) idx.push(i + base);
    base += gi.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  out.setIndex(idx);
  return out;
}
