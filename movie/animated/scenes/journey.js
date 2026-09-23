// ECHO (animated cut): "journey" (27.0 - 47.0 s)
//
// A powers-of-ten pull-back following the 1974 message out of the solar
// system, as three sub-scenes joined by matched cuts:
//   earth   27.0-33.0  night Earth from orbit, the beam leaving the Caribbean
//   solar   33.0-38.5  Earth a dot, the Moon passing, the Sun's glare, orbits
//   galaxy  38.5-47.0  the Sun a point; the Milky Way and M13 far above it
//
// Everything hangs off one continuous camera: a single log-distance curve
// (log10 km from the look target) and one yaw/pitch/roll spline, all in the
// same world axes (the camera frame at 38.5). Each stage only changes the
// unit of length (Earth radii, AU, light-years), so the cuts line up.

import { createEarth, createMoon, sph, CARIB_UV } from './lib_earth.js';
import {
  hermite, yprQuat, galDir, createGalaxySky, createRibbons, createGlowPoints, createGlare, makeGlareTexture,
  galaxyData, createGalaxyGlow, SUN_LOCAL, M13_LB,
} from './lib_space.js';

const GLOW_AMT = 0.07;
const KM_R = 6371, KM_AU = 1.495978707e8, KM_LY = 9.4607e12;
const R_AU = KM_R / KM_AU;

// galaxy orientation (world = camera frame at 38.5): a slight tilt toward the
// camera (so the Milky Way band is in frame at the cut; the camera then pitches
// down while it pulls out) and a spin about the galactic pole, chosen so the
// Sun sits on the left of the disc with M13 rising above it
const G_TILT = 8, G_SPIN = 235;
// final look target relative to the galactic centre (world, ly)
const TF_OFF = [1000, -3500, 0];

// log10(km) from the camera to its look target
const LOGD = [[27.0, 4.20, 0.09], [30.5, 4.64, 0.21], [33.0, 5.76, 0.45], [34.6, 6.62, 0.78], [38.5, 11.50, 1.75],
  [41.8, 17.40, 0.40], [47.0, 18.12, 0.02]];

/** Catmull-Rom style slopes for [[t, v], ...]; end slopes given */
function withSlopes(keys, m0, m1) {
  return keys.map((k, i) => {
    let m;
    if (i === 0) m = m0;
    else if (i === keys.length - 1) m = m1;
    else m = (keys[i + 1][1] - keys[i - 1][1]) / (keys[i + 1][0] - keys[i - 1][0]);
    return [k[0], k[1], m];
  });
}

/** pure geometry of the whole move; no DOM, so it can be checked in node */
export function journeyGeometry(THREE, U) {
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const G0 = new THREE.Matrix4().makeRotationX(G_TILT * Math.PI / 180)
    .multiply(new THREE.Matrix4().makeRotationY(G_SPIN * Math.PI / 180));
  const dL = galDir(M13_LB[0], M13_LB[1]);
  const d = V(...dL).applyMatrix4(G0).normalize();           // message direction (world)

  const yawPitch = f => [Math.atan2(-f.x, -f.z) * 180 / Math.PI, Math.asin(f.y) * 180 / Math.PI];

  // opening camera: looking back down the beam, which passes just by the
  // camera toward the upper right of frame
  const f0 = d.clone().negate();
  const R0 = new THREE.Vector3().crossVectors(f0, V(0, 1, 0)).normalize();
  const U0 = new THREE.Vector3().crossVectors(R0, f0).normalize();
  const off = 21 * Math.PI / 180;
  const c27 = d.clone().multiplyScalar(Math.cos(off))
    .addScaledVector(R0.clone().multiplyScalar(0.55).addScaledVector(U0, 0.83), -Math.sin(off)).normalize();
  const [y27, p27] = yawPitch(c27.clone().negate());

  const Y = withSlopes([[27, y27], [33, y27 * 0.30], [38.5, 0], [47, 3.5]], (y27 * 0.30 - y27) / 6 * 0.55, 0.35);
  const P = withSlopes([[27, p27], [33, p27 * 0.26], [38.5, 0], [42.5, -10.5], [47, -14.0]], (p27 * 0.26 - p27) / 6 * 0.55, -0.2);
  const RL = withSlopes([[27, 22], [33, 5], [38.5, 0], [47, 1.5]], -2.0, 0.15);

  const q = new THREE.Quaternion();
  const orient = (t, out) => yprQuat(THREE, hermite(Y, t), hermite(P, t), hermite(RL, t), out || q);
  const fwdAt = t => V(0, 0, -1).applyQuaternion(orient(t, new THREE.Quaternion()));
  const rightAt = t => V(1, 0, 0).applyQuaternion(orient(t, new THREE.Quaternion()));
  const upAt = t => V(0, 1, 0).applyQuaternion(orient(t, new THREE.Quaternion()));
  const logD = t => hermite(LOGD, t);

  // the Sun seen from Earth: ~55 deg off-axis to the upper left at t = 35,
  // so its glare slides in from the side as the camera pulls out
  const f35 = fwdAt(35), r35 = rightAt(35), u35 = upAt(35);
  const sa = 57 * Math.PI / 180, sb = 24 * Math.PI / 180;
  const s = f35.clone().multiplyScalar(Math.cos(sa))
    .addScaledVector(r35.clone().multiplyScalar(-Math.cos(sb)).addScaledVector(u35, Math.sin(sb)), Math.sin(sa)).normalize();

  // ecliptic: contains the Sun direction; turned about it so the beam leaves
  // the plane at ~59 degrees (M13's real ecliptic latitude is ~57), crosses
  // the Earth's orbit clearly on screen, and the orbits open into ellipses
  const perp = (a, b) => a.clone().addScaledVector(b, -a.dot(b)).normalize();
  const e1 = perp(V(0, 0, 1), s), e2 = new THREE.Vector3().crossVectors(e1, s).normalize();
  const ECL = -135 * Math.PI / 180;
  const n = e1.clone().multiplyScalar(Math.cos(ECL)).addScaledVector(e2, Math.sin(ECL)).normalize();

  // where on the globe the beam starts: facing the camera, just past dusk
  const c33 = fwdAt(33).negate();
  let best = null, bs = -1e9;
  for (let i = 0; i < 4000; i++) {
    const yy = 1 - 2 * (i + 0.5) / 4000, rr = Math.sqrt(1 - yy * yy), ph = i * 2.399963;
    const b = V(Math.cos(ph) * rr, yy, Math.sin(ph) * rr);
    const sc = -((b.dot(c27) - 0.72) ** 2) * 3 - ((b.dot(s) + 0.10) ** 2) * 12
      + Math.min(b.dot(d), 0.85) + Math.min(b.dot(c33), 0.45);
    if (sc > bs) { bs = sc; best = b; }
  }
  const bW = best;

  // Earth orientation: the Caribbean point onto bW, north as close as it gets
  // to the ecliptic pole tipped 23 degrees
  const pole = n.clone().applyAxisAngle(perp(s, n), 23.4 * Math.PI / 180).normalize();
  const bL = V(...sph(CARIB_UV[0], CARIB_UV[1]));
  const frame = (a, up) => {
    const x = a.clone().normalize();
    const y = perp(up, x);
    const z = new THREE.Vector3().crossVectors(x, y);
    return new THREE.Matrix4().makeBasis(x, y, z);
  };
  const ML = frame(bL, V(0, 1, 0)), MW = frame(bW, pole);
  const earthQ = new THREE.Quaternion().setFromRotationMatrix(MW.multiply(ML.transpose()));

  // galaxy stage (world units: light-years, Sun at the origin at the cut)
  const GAL = galaxyData(U);
  const sunL = V(...SUN_LOCAL), m13L = V(...GAL.m13);
  const centerW = sunL.clone().applyMatrix4(G0).negate();
  // slow rigid spin, easing in after the cut at 38.5 (journey.galaxy.start;
  // C1: rate 0 -> full over 2 s)
  const galAngle = t => {
    const x = Math.max(0, t - 38.5);
    return (x < 2 ? x * x / 4 : x - 1) * 2.4 * Math.PI / 180;
  };
  const galRot = (t, out) => out.copy(G0).multiply(new THREE.Matrix4().makeRotationY(-galAngle(t)));
  // what the camera settles on: a point just below the galactic centre
  const DF = Math.pow(10, LOGD[LOGD.length - 1][1]) / KM_LY;
  const TF = centerW.clone().add(V(TF_OFF[0], TF_OFF[1], TF_OFF[2]));
  const stage3Target = (sunW, D) => sunW.clone().lerp(TF, Math.pow(Math.min(D / DF, 1), 1.7));

  return {
    G0, d, s, n, bW, bL, earthQ, orient, fwdAt, rightAt, upAt, logD, c27, y27, p27,
    sunL, m13L, centerW, galAngle, galRot, TF, DF, stage3Target,
  };
}

export async function create(env) {
  const { THREE, TL, U, W, H } = env;
  const J = TL.journey;
  const geo = journeyGeometry(THREE, U);
  const { G0, d, s, n, bL, earthQ, orient, logD } = geo;
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const PX = (H / 2) / Math.tan(20 * Math.PI / 180);          // pixels per radian
  const BITS = TL.valley && TL.valley.bits ? TL.valley.bits : null;

  const camera = new THREE.PerspectiveCamera(40, W / H, 0.01, 100);
  const G0m3 = new THREE.Matrix3().setFromMatrix4(G0);
  const glareTex = makeGlareTexture(THREE, 256, 0);
  const sunTex = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 512;
    const x = c.getContext('2d');
    const g = x.createRadialGradient(256, 256, 0, 256, 256, 256);
    const st = [[0, 1], [0.018, 1], [0.035, 0.55], [0.07, 0.2], [0.14, 0.075], [0.28, 0.025], [0.5, 0.008], [1, 0]];
    for (const [o, a] of st) g.addColorStop(o, `rgba(255,255,255,${a})`);
    x.fillStyle = g;
    x.fillRect(0, 0, 512, 512);
    // faint six-point diffraction spikes
    x.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 3; i++) {
      x.save();
      x.translate(256, 256);
      x.rotate(i * Math.PI / 3 + 0.26);
      const sg = x.createLinearGradient(-256, 0, 256, 0);
      sg.addColorStop(0, 'rgba(255,255,255,0)');
      sg.addColorStop(0.5, 'rgba(255,255,255,0.10)');
      sg.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = sg;
      x.fillRect(-256, -1, 512, 2);
      x.restore();
    }
    return new THREE.CanvasTexture(c);
  })();
  const starTex = makeGlareTexture(THREE, 128, 0);
  const streakTex = (() => {
    const c = document.createElement('canvas');
    c.width = 512; c.height = 32;
    const x = c.getContext('2d');
    const g = x.createRadialGradient(256, 16, 0, 256, 16, 256);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.2, 'rgba(255,255,255,0.25)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, 512, 32);
    const vg = x.createLinearGradient(0, 0, 0, 32);
    vg.addColorStop(0, 'rgba(0,0,0,1)'); vg.addColorStop(0.5, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,1)');
    x.globalCompositeOperation = 'destination-out';
    x.fillStyle = vg;
    x.fillRect(0, 0, 512, 32);
    const t = new THREE.CanvasTexture(c);
    return t;
  })();

  // ---------------------------------------------------------------- sky ----
  const skyExp = { gal: 4.5e7, local: 260 };
  function skyFor(scene) {
    const sky = createGalaxySky(env);
    sky.uniforms.uRot.value.copy(G0m3);
    sky.uniforms.uEye.value.set(...SUN_LOCAL);
    sky.uniforms.uGal.value = skyExp.gal;
    sky.uniforms.uLocal.value = skyExp.local;
    scene.add(sky.points, sky.dust);
    return sky;
  }

  // shared: the message's bits as log-spaced particles flowing out of the beam
  const NB = 420;
  function bitsFor(scene) {
    const gp = createGlowPoints(env, NB, { sharp: 2.6 });
    gp.points.renderOrder = 12;
    scene.add(gp.points);
    return gp;
  }
  const S_MIN = 0.004, S_MAX = 2.0e5;          // Earth radii
  const LN = Math.log(S_MAX / S_MIN);
  const tmpV = V(0, 0, 0);
  /** origin + dir * s(units), unit = world units per Earth radius */
  function updateBits(gp, t, origin, unit, cam, gain) {
    const cp = cam.position;
    for (let i = 0; i < NB; i++) {
      const u = ((i * 0.6180339887 + (t - 20) * 0.075) % 1 + 1) % 1;
      const sR = S_MIN * Math.exp(u * LN);
      tmpV.copy(d).multiplyScalar(sR * unit).add(origin);
      gp.pos[i * 3] = tmpV.x; gp.pos[i * 3 + 1] = tmpV.y; gp.pos[i * 3 + 2] = tmpV.z;
      const dist = tmpV.distanceTo(cp);
      const px = 0.0035 * unit / dist * PX;
      gp.size[i] = Math.min(7.5, Math.max(2.8, px * 2.6));
      const bit = BITS ? BITS[i % BITS.length] : (i % 3 ? 1 : 0);
      // bits smaller than a pixel fade away instead of piling up on one spot
      const fade = U.smooth(0, 0.04, u) * (1 - U.smooth(0.9, 1, u)) * Math.min(1, px * 1.5);
      const k = (bit ? 3.4 : 0.7) * fade * gain;
      gp.rgba.set([0.72, 0.86, 1.0, k], i * 4);
    }
    gp.commit();
  }

  /** beam: log-spaced segments from origin out to beyond the camera */
  function updateBeam(rb, origin, unit, len, cam, gain) {
    rb.begin();
    const N = 48;
    let prev = origin.clone(), pc = [0.75, 0.88, 1.0, 1.9 * gain];
    const s0 = 0.002;
    for (let k = 1; k <= N; k++) {
      const sR = s0 * Math.pow(len / s0, k / N);
      const p = d.clone().multiplyScalar(sR * unit).add(origin);
      const inten = (0.62 + 1.0 * Math.exp(-sR / 0.6)) * gain;
      const c = [0.72, 0.86, 1.0, inten];
      rb.seg(prev, p, pc, c);
      prev = p; pc = c;
    }
    rb.end(cam);
  }

  // the Sun as a function of log10 km distance: [halo px, halo I, core px, core I]
  function sunLook(Lk) {
    const halo = (70 + 700 * Math.pow(10, -(Lk - 8.17) * 0.30)) * (1 - 0.55 * U.smooth(14, 17.5, Lk));
    return [Math.min(halo, 800), 1.5 - 0.5 * U.smooth(9, 17, Lk),
      9 - 1.5 * U.smooth(13, 17, Lk), 2.4 - 0.4 * U.smooth(12, 17, Lk)];
  }
  function placeSun(halo, core, p, Lk, gain = 1) {
    const [hp, hi, cp, ci] = sunLook(Lk);
    halo.set(camera, p, hp, hi * gain);
    core.set(camera, p, cp, ci * gain);
  }

  // the Moon: sweeps in from the upper left as the camera crosses its orbit,
  // straddling the Earth/solar cut. Its position is in Earth radii from Earth.
  const MOON_TE = 31.95;
  const moonOrbit = {};
  {
    const te = MOON_TE;
    const fe = geo.fwdAt(te), re = geo.rightAt(te), ue = geo.upAt(te);
    const De = Math.pow(10, logD(te)) / KM_R;
    const L = 8.5, depth = 14.5;
    const pos = fe.clone().multiplyScalar(-(De - depth)).addScaledVector(re, -0.78 * L).addScaledVector(ue, 0.62 * L);
    moonOrbit.pos = pos;
    moonOrbit.r = pos.length();
    moonOrbit.u = pos.clone().normalize();
    // the ring is tipped toward the camera so it opens into an ellipse
    const nn = geo.fwdAt(33).negate().multiplyScalar(0.8).addScaledVector(n, 0.45);
    const nr = nn.addScaledVector(moonOrbit.u, -nn.dot(moonOrbit.u)).normalize();
    moonOrbit.v = new THREE.Vector3().crossVectors(nr, moonOrbit.u).normalize();
  }
  /** Moon + its orbit ring in a scene whose Earth sits at `centre`, `unit` world units per Earth radius */
  function moonFor(scene, centre, unit) {
    const m = createMoon(env);
    // lit a little more toward the camera than strictly true, so the Moon
    // shows a half-lit face rather than a hairline crescent
    m.uniforms.uSun.value.copy(s).addScaledVector(geo.fwdAt(MOON_TE).negate(), 0.62).normalize();
    m.mesh.scale.setScalar(0.2727 * unit);
    m.mesh.position.copy(centre).addScaledVector(moonOrbit.pos, unit);
    const ring = createRibbons(env, 160, { core: 0.45, sigma: 1.5, glow: 0.3 });
    ring.mesh.renderOrder = 4;
    scene.add(m.mesh, ring.mesh);
    return {
      update(t) {
        ring.begin();
        const rpx = moonOrbit.r * unit / camera.position.distanceTo(centre) * PX;
        const al = U.smooth(MOON_TE - 0.5, MOON_TE, t) * U.smooth(18, 60, rpx) * 0.2;
        if (al > 0.002) {
          const N = 160, R = moonOrbit.r * unit;
          const pt = a => centre.clone().addScaledVector(moonOrbit.u, Math.cos(a) * R).addScaledVector(moonOrbit.v, Math.sin(a) * R);
          let prev = pt(0);
          for (let j = 1; j <= N; j++) {
            const p = pt(j / N * Math.PI * 2);
            ring.seg(prev, p, [0.55, 0.62, 0.75, al]);
            prev = p;
          }
        }
        ring.end(camera);
      },
    };
  }

  // =============================================================== EARTH ===
  const scene1 = new THREE.Scene();
  scene1.background = new THREE.Color(0x000000);
  const sky1 = skyFor(scene1);
  const earth1 = createEarth(env, { segments: [160, 80] });
  earth1.group.quaternion.copy(earthQ);
  earth1.setSun(s);
  scene1.add(earth1.group);
  const beam1 = createRibbons(env, 64, { core: 0.55, sigma: 2.2, glow: 0.4 });
  beam1.mesh.renderOrder = 10;
  scene1.add(beam1.mesh);
  const bits1 = bitsFor(scene1);
  const dish1 = createGlare(env, starTex, [0.75, 0.88, 1.0], { order: 13, depthTest: false });
  scene1.add(dish1.sprite);
  const moon1 = moonFor(scene1, V(0, 0, 0), 1);

  // =============================================================== SOLAR ===
  const scene2 = new THREE.Scene();
  scene2.background = new THREE.Color(0x000000);
  const sky2 = skyFor(scene2);
  const E2 = s.clone().negate();                  // Earth at 1 AU, Sun at the origin
  const earth2 = createEarth(env, { segments: [64, 32] });
  earth2.group.quaternion.copy(earthQ);
  earth2.group.scale.setScalar(R_AU);
  earth2.group.position.copy(E2);
  earth2.setSun(s);
  scene2.add(earth2.group);
  const moon2 = moonFor(scene2, E2, R_AU);
  const orbits = createRibbons(env, 8 * 200, { core: 0.45, sigma: 1.5, glow: 0.3 });
  orbits.mesh.renderOrder = 4;
  scene2.add(orbits.mesh);
  const eclX = s.clone().negate();                             // Earth's orbital angle 0
  const eclY = new THREE.Vector3().crossVectors(n, eclX).normalize();
  const PLANETS = [
    // a (AU), angle (rad, from Earth), colour, dot size
    [0.387, 2.2, [0.8, 0.75, 0.7], 2.2],
    [0.723, -1.1, [1.0, 0.9, 0.7], 3.0],
    [1.0, 0.0, [0.45, 0.65, 1.0], 0],
    [1.524, 0.9, [1.0, 0.5, 0.3], 2.4],
    [5.203, -2.4, [1.0, 0.85, 0.65], 3.6],
    [9.537, 1.9, [1.0, 0.88, 0.6], 3.2],
    [19.19, -0.5, [0.6, 0.9, 1.0], 2.6],
    [30.07, 2.9, [0.45, 0.6, 1.0], 2.6],
  ];
  const orbitPt = (a, ang) => eclX.clone().multiplyScalar(a * Math.cos(ang)).addScaledVector(eclY, a * Math.sin(ang));
  const planets = createGlowPoints(env, PLANETS.length + 2, { sharp: 2.4 });
  planets.points.renderOrder = 6;
  scene2.add(planets.points);
  const sun2 = createGlare(env, sunTex, [1.0, 0.86, 0.68], { order: 20 });
  const sunc2 = createGlare(env, starTex, [1.0, 0.93, 0.82], { order: 21 });
  scene2.add(sunc2.sprite);
  const streak2 = createGlare(env, streakTex, [0.55, 0.7, 1.0], { order: 21 });
  scene2.add(sun2.sprite, streak2.sprite);
  const beam2 = createRibbons(env, 64, { core: 0.45, sigma: 1.8, glow: 0.35 });
  beam2.mesh.renderOrder = 10;
  scene2.add(beam2.mesh);
  const bits2 = bitsFor(scene2);
  const dot2 = createGlare(env, starTex, [0.45, 0.65, 1.0], { order: 14 });
  scene2.add(dot2.sprite);

  // ============================================================== GALAXY ===
  const scene3 = new THREE.Scene();
  scene3.background = new THREE.Color(0x000000);
  const sky3 = createGalaxySky(env);
  const glow3 = createGalaxyGlow(env);
  scene3.add(sky3.points, glow3.mesh, sky3.dust);
  const { sunL, m13L, centerW, galRot, stage3Target } = geo;
  const sun3 = createGlare(env, sunTex, [1.0, 0.86, 0.68], { order: 20 });
  const sunc3 = createGlare(env, starTex, [1.0, 0.93, 0.82], { order: 21 });
  scene3.add(sun3.sprite, sunc3.sprite);
  const thread = createRibbons(env, 80, { core: 0.45, sigma: 1.8, glow: 0.35 });
  thread.mesh.renderOrder = 10;
  const path = createRibbons(env, 140, { core: 0.45, sigma: 1.4, glow: 0.3 });
  path.mesh.renderOrder = 9;
  scene3.add(thread.mesh, path.mesh);
  const head = createGlare(env, starTex, [0.75, 0.88, 1.0], { order: 22 });
  const m13glow = createGlare(env, glareTex, [1.0, 0.9, 0.75], { order: 8 });
  scene3.add(head.sprite, m13glow.sprite);

  const inst = { scene: scene1, camera };
  const mR = new THREE.Matrix4(), mRi = new THREE.Matrix4(), m3 = new THREE.Matrix3();
  const qq = new THREE.Quaternion();

  function placeCamera(t, target, D) {
    orient(t, qq);
    camera.quaternion.copy(qq);
    const f = V(0, 0, -1).applyQuaternion(qq);
    camera.position.copy(target).addScaledVector(f, -D);
    camera.near = D * 0.002;
    camera.far = D * 5e4;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    return f;
  }

  inst.update = function (t) {
    const Lk = logD(t);
    if (t < J.solar.start) {
      // ---------------------------------------------------------- earth
      inst.scene = scene1;
      const spinA = (t - 30) * 0.5 * Math.PI / 180;
      earth1.spin.quaternion.setFromAxisAngle(V(0, 1, 0), spinA);
      earth1.uniforms.uCloudShift.value = (t - 30) * 0.0006;
      earth1.sync();
      const B = earth1.worldOf(bL.toArray(), V());
      const D = Math.pow(10, Lk) / KM_R;
      const w = U.smooth(27.0, 31.8, t);
      const target = B.clone().multiplyScalar(0.62).lerp(V(0, 0, 0), w);
      placeCamera(t, target, D);
      sky1.fit(camera);
      const beamLen = D * 40;
      updateBeam(beam1, B, 1, beamLen, camera, 1);
      updateBits(bits1, t, B, 1, camera, 1);
      dish1.set(camera, B, 16, 1.4);
      moon1.update(t);
    } else if (t < J.galaxy.start) {
      // ---------------------------------------------------------- solar
      inst.scene = scene2;
      const spinA = (t - 30) * 0.5 * Math.PI / 180;
      earth2.spin.quaternion.setFromAxisAngle(V(0, 1, 0), spinA);
      earth2.uniforms.uCloudShift.value = (t - 30) * 0.0006;
      earth2.sync();
      const B = earth2.worldOf(bL.toArray(), V());
      const D = Math.pow(10, Lk) / KM_AU;
      const w = U.smooth(8.5, 10.4, Lk);
      const target = E2.clone().lerp(V(0, 0, 0), w);
      placeCamera(t, target, D);
      sky2.fit(camera);

      moon2.update(t);
      const earthDist = camera.position.distanceTo(E2);
      const earthPx = R_AU / earthDist * PX;
      dot2.set(camera, E2, 7, 0.9 * (1 - U.smooth(1.5, 5, earthPx)));

      // orbits fade in as they grow smaller than the frame
      orbits.begin();
      const camD = camera.position.length();
      for (let k = 0; k < PLANETS.length; k++) {
        const [a] = PLANETS[k];
        const rpx = a / camD * PX;
        const al = U.smooth(14, 60, rpx) * (1 - U.smooth(900, 2600, rpx)) * U.smooth(7.0, 7.9, Lk);
        if (al <= 0.001) continue;
        const col = k === 2 ? [0.45, 0.65, 1.0, 0.34 * al] : [0.55, 0.65, 0.85, 0.16 * al];
        const N = 200;
        let prev = orbitPt(a, 0);
        for (let j = 1; j <= N; j++) {
          const p = orbitPt(a, j / N * Math.PI * 2);
          orbits.seg(prev, p, col, col);
          prev = p;
        }
      }
      orbits.end(camera);
      for (let k = 0; k < PLANETS.length; k++) {
        const [a, ang, col, sz] = PLANETS[k];
        const p = orbitPt(a, ang);
        planets.pos.set([p.x, p.y, p.z], k * 3);
        const rpx = a / camD * PX;
        const al = sz ? U.smooth(10, 40, rpx) * U.smooth(7.2, 8.2, Lk) : 0;
        planets.size[k] = sz * 1.6;
        planets.rgba.set([col[0], col[1], col[2], 1.4 * al], k * 4);
      }
      planets.commit(PLANETS.length);

      const sunLk = Math.log10(camera.position.length() * KM_AU);
      placeSun(sun2, sunc2, V(0, 0, 0), sunLk);
      const [hp, hi] = sunLook(sunLk);
      streak2.set(camera, V(0, 0, 0), hp * 0.035, hi * 0.10 * (1 - U.smooth(10.2, 11.2, sunLk)), 60);

      const beamLen = D / R_AU * 60;
      updateBeam(beam2, B, R_AU, beamLen, camera, 0.8 + 0.2 * (1 - U.smooth(33, 35, t)));
      updateBits(bits2, t, B, R_AU, camera, 1);
    } else {
      // --------------------------------------------------------- galaxy
      inst.scene = scene3;
      galRot(t, mR);
      const sunW = sunL.clone().applyMatrix4(mR).add(centerW);
      const m13W = m13L.clone().applyMatrix4(mR).add(centerW);
      const D = Math.pow(10, Lk) / KM_LY;
      placeCamera(t, stage3Target(sunW, D), D);
      sky3.fit(camera);
      // eye in galaxy-local coordinates
      mRi.copy(mR).invert();
      const eyeL = camera.position.clone().sub(centerW).applyMatrix4(mRi);
      sky3.uniforms.uEye.value.copy(eyeL);
      sky3.uniforms.uRot.value.copy(m3.setFromMatrix4(mR));
      // exposure follows the pull-back so the far galaxy keeps its brightness
      const ramp = 1 + Math.pow(D / 9800, 2);
      sky3.uniforms.uGal.value = skyExp.gal * ramp;
      sky3.uniforms.uLocal.value = skyExp.local * ramp * (1 - U.smooth(3000, 12000, D));
      sky3.dustUniforms.uAmt.value = 1;
      // diffuse disc light once we are well above the plane
      glow3.mesh.matrix.makeTranslation(centerW.x, centerW.y, centerW.z).multiply(mR);
      glow3.mesh.matrixWorld.copy(glow3.mesh.matrix);
      const pole = V(0, 1, 0).transformDirection(mR);
      const hgt = Math.abs(camera.position.clone().sub(centerW).dot(pole));
      glow3.uniforms.uAmt.value = GLOW_AMT * U.smooth(350, 3500, hgt);

      placeSun(sun3, sunc3, sunW, Math.log10(camera.position.distanceTo(sunW) * KM_LY));

      // the message: a thread whose head falls back toward the Sun as the
      // camera outruns it, then crawls a little way toward M13
      const dirW = m13W.clone().sub(sunW);
      const total = dirW.length();
      dirW.normalize();
      const hLog = Math.pow(10, 0.5 + (t - J.galaxy.start) * 0.36);
      const crawl = U.smooth(41.8, 46.5, t) * 0.075 * total;
      const h = Math.max(hLog, crawl);
      thread.begin();
      const N = 60;
      const tip = U.smooth(40.5, 42.5, t);
      let prev = sunW.clone(), pc = [0.72, 0.86, 1.0, 0.52];
      for (let k = 1; k <= N; k++) {
        const f = k / N;
        const p = sunW.clone().addScaledVector(dirW, h * f);
        const c = [0.72, 0.86, 1.0, 0.52 + tip * 1.2 * Math.pow(f, 8)];
        thread.seg(prev, p, pc, c);
        prev = p; pc = c;
      }
      thread.end(camera);
      const headP = sunW.clone().addScaledVector(dirW, h);
      head.set(camera, headP, 10, 1.3 * tip);

      // the rest of the way: a faint dotted path, appearing with the galaxy
      path.begin();
      const pa = 0.22 * U.smooth(16.6, 17.8, Lk);
      if (pa > 0.001) {
        const M = 70;
        for (let k = 0; k < M; k++) {
          const f0 = (k + 0.15) / M, f1 = (k + 0.55) / M;
          if (f1 * total < h) continue;
          const p0 = sunW.clone().addScaledVector(dirW, Math.max(f0 * total, h));
          const p1 = sunW.clone().addScaledVector(dirW, f1 * total);
          path.seg(p0, p1, [0.6, 0.75, 1.0, pa], [0.6, 0.75, 1.0, pa]);
        }
      }
      path.end(camera);
      const mDist = camera.position.distanceTo(m13W);
      m13glow.set(camera, m13W, Math.min(300, 9000 / mDist * PX), 0.06 * U.smooth(16.2, 17.6, Lk));
    }
  };

  // a soft graduated filter keeps the lower third calm under the narration
  inst.overlay = function (t, g) {
    let a = 0;
    for (const cue of TL.text) {
      if (cue.slot !== 'lower') continue;
      a = Math.max(a, U.window01(t, cue.start - 0.5, cue.hold_until + cue.fade, 0.5, 0.6));
    }
    a *= t < 35 ? 0 : (t < J.galaxy.start ? 0.5 : 1);
    if (a <= 0.001) return;
    const gr = g.createLinearGradient(0, H * 0.66, 0, H);
    gr.addColorStop(0, 'rgba(0,0,0,0)');
    gr.addColorStop(0.45, `rgba(0,0,0,${0.42 * a})`);
    gr.addColorStop(1, `rgba(0,0,0,${0.62 * a})`);
    g.save();
    g.fillStyle = gr;
    g.fillRect(0, H * 0.66, W, H * 0.34);
    g.restore();
  };

  inst.bloom = function (t) {
    if (t < J.solar.start) return { strength: 0.62, radius: 0.45, threshold: 0.62 };
    if (t < J.galaxy.start) return { strength: 0.6, radius: 0.5, threshold: 0.6 };
    return { strength: 0.5, radius: 0.45, threshold: 0.7 };
  };

  return inst;
}
