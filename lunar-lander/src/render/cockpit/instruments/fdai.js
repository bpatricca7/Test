// FDAI — Flight Director Attitude Indicator ("8-ball").
//
// A real 3D ball (64 × 32 segments) behind a black face with a round window. The ball carries the
// Apollo attitude grid: light upper hemisphere / black lower hemisphere, meridians & parallels every
// 10° (heavier every 30°), 5° ticks, attitude numbers in tens of degrees (0, 3, 6 ... 33) along the
// equator and along the principal meridians, pole marks. It is oriented to show the vehicle attitude
// relative to the LOCAL VERTICAL frame at vessel.pos (east/north/up): the ball point in the centre of
// the window is the direction the vehicle's forward axis (-Z body) points; up on the face is body +Y.
//
// Around the window: roll scale & rotating roll index, three rate indicators on edge scales
//   top = roll rate, right = pitch rate, bottom = yaw rate (vessel.angVel, full scale opts.rateScale °/s)
// and three attitude-error needles over the ball (vessel.gnc.attError, deg, full scale opts.errorScale):
//   roll error hangs from the top, pitch error enters from the right, yaw error rises from the bottom.
import { THREE, createCase, limiter, finish, needleMesh, trianglePointer, barNeedle, approach, DEG, drawText } from './common.js';
import { fdaiBallQuaternion } from './math.js';
import { registerIntegral } from '../kit/materials.js';
import { createCanvasTexture } from '../kit/index.js';

let _ballTex = null;
/**
 * Equirectangular ball texture (2048 × 1024). SphereGeometry u -> azimuth az = 360u - 90 (deg from
 * north toward east), v -> elevation el = 180v - 90.
 */
function ballTexture() {
  if (_ballTex) return _ballTex;
  const W = 2048;
  const H = 1024;
  const t = createCanvasTexture(W / 1000, H / 1000, 1000);
  const g = t.g;
  const X = (az) => ((((az + 90) % 360) + 360) % 360) / 360 * W;
  const Y = (el) => (1 - (el + 90) / 180) * H;
  const light = '#dcdbd4';
  const dark = '#1d1e20';
  const inkL = '#161616'; // markings on the light hemisphere
  const inkD = '#e9e8e2'; // markings on the dark hemisphere
  g.fillStyle = light;
  g.fillRect(0, 0, W, H / 2);
  g.fillStyle = dark;
  g.fillRect(0, H / 2, W, H / 2);
  const ink = (el) => (el >= 0 ? inkL : inkD);
  // parallels every 10° (30° heavier)
  for (let el = -80; el <= 80; el += 10) {
    if (el === 0) continue;
    g.fillStyle = ink(el);
    const lw = el % 30 === 0 ? 3.2 : 1.6;
    g.fillRect(0, Y(el) - lw / 2, W, lw);
  }
  // meridians every 10° (30° heavier); they converge at the poles (drawn full height)
  for (let az = 0; az < 360; az += 10) {
    const lw = az % 30 === 0 ? 3.4 : 1.4;
    const x = X(az);
    g.fillStyle = inkL;
    g.fillRect(x - lw / 2, 0, lw, H / 2);
    g.fillStyle = inkD;
    g.fillRect(x - lw / 2, H / 2, lw, H / 2);
  }
  // horizon: a crisp double line on the boundary
  g.fillStyle = '#0a0a0a';
  g.fillRect(0, H / 2 - 3, W, 3);
  g.fillStyle = '#f2f1ec';
  g.fillRect(0, H / 2, W, 2);
  // 5° ticks along the principal meridians and along the equator
  for (let az = 0; az < 360; az += 30) {
    for (let el = -85; el <= 85; el += 5) {
      if (el % 10 === 0) continue;
      g.fillStyle = ink(el);
      const len = 14 / Math.max(0.2, Math.cos(el * DEG));
      g.fillRect(X(az) - len / 2, Y(el) - 1, len, 2);
    }
  }
  for (let az = 5; az < 360; az += 10) {
    g.fillStyle = inkL;
    g.fillRect(X(az) - 1, Y(0) - 12, 2, 12);
    g.fillStyle = inkD;
    g.fillRect(X(az) - 1, Y(0), 2, 12);
  }
  // numbers: text is stretched 1/cos(el) horizontally so it looks right on the sphere
  const label = (text, az, el, size) => {
    const k = 1 / Math.max(0.12, Math.cos(el * DEG));
    for (const off of [0, W, -W]) {
      const x = X(az) + off;
      if (x < -200 || x > W + 200) continue;
      g.save();
      g.translate(x, Y(el));
      g.scale(k, 1);
      // knock the grid out behind the number
      g.fillStyle = el >= 0 ? light : dark;
      const w = size * 0.62 * text.length + size * 0.25;
      g.fillRect(-w / 2, -size * 0.52, w, size * 1.04);
      drawText(g, text, 0, 0, size, { color: ink(el), condense: 0.9, caps: false, tracking: 0.02 });
      g.restore();
    }
  };
  // heading numbers along the equator, both just above and below the horizon
  for (let az = 0; az < 360; az += 30) {
    const n = String(az / 10);
    label(n, az + 5, 4.5, 40);
    label(n, az + 5, -4.5, 40);
  }
  // pitch numbers along every 30° meridian at every 30° of elevation: 3, 6 above; 33, 30 below
  for (let az = 0; az < 360; az += 30) {
    for (const el of [-60, -30, 30, 60]) {
      const n = String((el < 0 ? 360 + el : el) / 10);
      label(n, az + 4.5 / Math.cos(el * DEG), el + 4, 38);
    }
  }
  // pole caps: zenith (light) & nadir (dark) with a small cross
  for (const el of [90, -90]) {
    const y = el > 0 ? 0 : H;
    g.fillStyle = el > 0 ? inkL : inkD;
    g.fillRect(0, el > 0 ? y : y - 10, W, 10);
  }
  // subtle print texture
  const img = g.getImageData(0, 0, W, H);
  let s = 12345;
  for (let i = 0; i < img.data.length; i += 4) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const n = ((s >> 16) & 15) - 7;
    img.data[i] += n;
    img.data[i + 1] += n;
    img.data[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
  t.texture.needsUpdate = true;
  t.texture.anisotropy = 8;
  _ballTex = t.texture;
  return _ballTex;
}

/**
 * FDAI attitude ball with rate and error needles.
 * @param {object} [opts] { size=0.19 (square bezel, m), rateScale=5 (°/s full scale),
 *   errorScale=5 (° full scale) }
 * @returns {{object, width, height, update(vessel, game, dt)}}
 */
export function createFDAI(opts = {}) {
  const s = opts.size || 0.19;
  const rateFS = opts.rateScale || 5;
  const errFS = opts.errorScale || 5;
  const fr = s * 0.045; // bezel border
  const rw = s * 0.31; // window radius
  const rb = rw / 0.8; // ball radius: the window shows the front ~53° cap of the ball
  const ringR = rw + s * 0.012;
  const scaleR = s * 0.44; // rate scales distance from centre

  const fw = s - 2 * fr + 0.002; // face width (see createCase)
  const { group, face } = createCase({
    width: s,
    height: s,
    frame: fr,
    corner: s * 0.03,
    holes: [{ x: 0, y: 0, radius: rw }],
    depth: rb * 2 + 0.01,
    faceSpec: {
      draw(P) {
        // roll scale: ticks every 10°, long every 30°, numbers every 30° (tens of degrees)
        for (let a = 0; a < 360; a += 10) {
          const r0 = ringR;
          const r1 = ringR + (a % 30 === 0 ? s * 0.022 : s * 0.012);
          const an = a * DEG;
          P.line(Math.sin(an) * r0, Math.cos(an) * r0, Math.sin(an) * r1, Math.cos(an) * r1, a % 30 === 0 ? s * 0.0042 : s * 0.0026);
          if (a % 30 === 0 && a % 90 !== 0) {
            const rn = ringR + s * 0.034;
            P.text(String((360 - a) % 360 / 10), Math.sin(an) * rn, Math.cos(an) * rn, s * 0.026, { condense: 0.9 });
          }
        }
        // rate scales: top (roll), right (pitch), bottom (yaw)
        const half = s * 0.2;
        const tk = (x1, y1, x2, y2, w = s * 0.0035) => P.line(x1, y1, x2, y2, w);
        for (let i = -4; i <= 4; i++) {
          const f = (i / 4) * half;
          const len = i % 2 === 0 ? s * 0.018 : s * 0.01;
          tk(f, scaleR, f, scaleR - len, i === 0 ? s * 0.005 : s * 0.0032); // top
          tk(scaleR, f, scaleR - len, f, i === 0 ? s * 0.005 : s * 0.0032); // right
          tk(f, -scaleR, f, -scaleR + len, i === 0 ? s * 0.005 : s * 0.0032); // bottom
        }
        // corner legends
        const c = fw / 2 - s * 0.05;
        P.text('RATE', -c + s * 0.01, c, s * 0.022, { align: 'left' });
        P.text('ERROR', c - s * 0.01, c, s * 0.022, { align: 'right' });
        P.text(`${rateFS}`, -c + s * 0.01, c - s * 0.03, s * 0.022, { align: 'left' });
        P.text(`${errFS}`, c - s * 0.01, c - s * 0.03, s * 0.022, { align: 'right' });
        P.text('ROLL', -c + s * 0.01, -c, s * 0.02, { align: 'left' });
        P.text('YAW', c - s * 0.01, -c, s * 0.02, { align: 'right' });
        P.text('PITCH', scaleR + s * 0.02, -s * 0.28, s * 0.02, { rotate: -Math.PI / 2 });
      },
    },
  });

  // ---- the ball
  const ballMat = new THREE.MeshStandardMaterial({ map: ballTexture(), roughness: 0.5, metalness: 0, emissiveMap: ballTexture() });
  ballMat.userData.integralScale = 0.25;
  registerIntegral(ballMat);
  const ball = new THREE.Mesh(new THREE.SphereGeometry(rb, 64, 32), ballMat);
  ball.position.z = -rb - 0.003;
  ball.receiveShadow = true;
  ball.castShadow = false;
  group.add(ball);
  // black shroud hugging the ball behind the window (no gap visible around the ball)
  const shD = 0.4 * rb + 0.004;
  const shroud = new THREE.Mesh(
    new THREE.CylinderGeometry(rw + 0.0004, rw + 0.0004, shD, 64, 1, true).rotateX(Math.PI / 2).translate(0, 0, -shD / 2),
    new THREE.MeshStandardMaterial({ color: 0x030303, roughness: 0.9, side: THREE.BackSide }),
  );
  group.add(shroud);

  // ---- needles & indices (between face and glass, or just in front of the ball)
  const NEEDLE = 0xff9b1a; // day-glo orange error needles
  const ix = new THREE.Group();
  group.add(ix);
  // fixed centre reference: small orange "wings" with a centre dot
  const wings = new THREE.Shape();
  const ww = rw * 0.5;
  const wt = s * 0.006;
  wings.moveTo(-ww, -wt / 2);
  wings.lineTo(-ww * 0.25, -wt / 2);
  wings.lineTo(-ww * 0.25, -wt * 2.2);
  wings.lineTo(-ww * 0.25 + wt, -wt * 2.2);
  wings.lineTo(-ww * 0.25 + wt, wt / 2);
  wings.lineTo(-ww, wt / 2);
  wings.closePath();
  const wl = needleMesh(wings, NEEDLE, 0);
  const wr = needleMesh(wings, NEEDLE, 0);
  wr.scale.x = -1;
  wr.geometry = wr.geometry.clone();
  wl.position.z = wr.position.z = -0.0021;
  ix.add(wl, wr);
  const dot = new THREE.Mesh(new THREE.CircleGeometry(s * 0.0055, 16), new THREE.MeshStandardMaterial({ color: NEEDLE, emissive: NEEDLE, emissiveIntensity: 0.15, roughness: 0.5 }));
  dot.position.z = -0.0019;
  ix.add(dot);
  // error needles
  const errLen = rw * 0.72;
  const errW = s * 0.008;
  const rollErr = needleMesh(barNeedle(errLen, errW), NEEDLE, 0);
  rollErr.rotation.z = Math.PI; // hangs down from the top
  rollErr.position.set(0, rw, -0.0014);
  const pitchErr = needleMesh(barNeedle(errLen, errW), NEEDLE, 0);
  pitchErr.rotation.z = Math.PI / 2; // points left from the right side
  pitchErr.position.set(rw, 0, -0.0012);
  const yawErr = needleMesh(barNeedle(errLen, errW), NEEDLE, 0);
  yawErr.position.set(0, -rw, -0.0014);
  ix.add(rollErr, pitchErr, yawErr);
  // rate pointers (white triangles on the edge scales, in front of the face)
  const rp = (rot) => {
    const m = needleMesh(trianglePointer(s * 0.03, s * 0.028), 0xdad9d0, 0);
    m.rotation.z = rot;
    return m;
  };
  const rollRate = rp(Math.PI); // tip up, toward the top scale
  rollRate.position.set(0, scaleR - s * 0.02, 0.0004);
  const pitchRate = rp(Math.PI / 2); // tip right
  pitchRate.position.set(scaleR - s * 0.02, 0, 0.0004);
  const yawRate = rp(0); // tip down
  yawRate.position.set(0, -scaleR + s * 0.02, 0.0004);
  ix.add(rollRate, pitchRate, yawRate);
  // rotating roll index: white triangle riding just outside the window edge
  const rollIdxG = new THREE.Group();
  const rollIdx = needleMesh(trianglePointer(s * 0.028, s * 0.026), 0xdad9d0, 0);
  rollIdx.rotation.z = Math.PI;
  rollIdx.position.set(0, ringR - 0.0005, 0.0004);
  rollIdxG.add(rollIdx);
  ix.add(rollIdxG);
  // inner shadow ring: the face is thick; darken the ball's rim (vignette)
  const vign = new THREE.Mesh(
    new THREE.RingGeometry(rw * 0.78, rw * 1.001, 64),
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uR0: { value: rw * 0.78 }, uR1: { value: rw } },
      vertexShader: '#include <common>\n#include <logdepthbuf_pars_vertex>\nvarying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0);\n#include <logdepthbuf_vertex>\n}',
      fragmentShader: '#include <logdepthbuf_pars_fragment>\nuniform float uR0; uniform float uR1; varying vec2 vP; void main(){\n#include <logdepthbuf_fragment>\nfloat r = length(vP); float a = smoothstep(uR0, uR1, r); gl_FragColor = vec4(0.0,0.0,0.0, a*a*0.75); }',
    }),
  );
  vign.position.z = -0.0026;
  group.add(vign);

  // ---- behaviour
  const lim = limiter(30);
  const qBall = new THREE.Quaternion();
  const tgtQ = new THREE.Quaternion();
  const st = { rr: 0, pr: 0, yr: 0, re: 0, pe: 0, ye: 0 };
  let init = false;
  const clampFS = (v) => Math.max(-1.08, Math.min(1.08, v));

  function update(vessel, game, dt) {
    if (!vessel) return;
    const e = lim.tick(dt);
    if (!e) return;
    // --- ball orientation relative to the local vertical frame (see math.fdaiBallQuaternion)
    const { up: U } = fdaiBallQuaternion(vessel.pos, vessel.quat, tgtQ);
    // the ball is servo-driven: follow quickly but not instantly
    if (!init) {
      qBall.copy(tgtQ);
      init = true;
    } else qBall.slerp(tgtQ, Math.min(1, e * 18));
    ball.quaternion.copy(qBall);
    // roll index: angle of the ball's "up" (U) projected on the face
    const upx = U.x;
    const upy = U.y;
    if (upx * upx + upy * upy > 1e-6) rollIdxG.rotation.z = Math.atan2(-upx, upy);
    // --- rates (deg/s): roll right +, pitch up +, yaw right +
    const w = vessel.angVel;
    st.rr = approach(st.rr, clampFS((-w.z / DEG) / rateFS), e, 12);
    st.pr = approach(st.pr, clampFS((w.x / DEG) / rateFS), e, 12);
    st.yr = approach(st.yr, clampFS((-w.y / DEG) / rateFS), e, 12);
    const half = s * 0.2;
    rollRate.position.x = st.rr * half;
    pitchRate.position.y = st.pr * half;
    yawRate.position.x = st.yr * half;
    // --- attitude errors (deg): needle deflects toward the required correction
    const ae = vessel.gnc?.attError;
    const tre = ae ? clampFS(ae.z / errFS) : 0;
    const tpe = ae ? clampFS(ae.x / errFS) : 0;
    const tye = ae ? clampFS(ae.y / errFS) : 0;
    st.re = approach(st.re, tre, e, 10);
    st.pe = approach(st.pe, tpe, e, 10);
    st.ye = approach(st.ye, tye, e, 10);
    const span = rw * 0.62;
    rollErr.position.x = st.re * span;
    pitchErr.position.y = st.pe * span;
    yawErr.position.x = st.ye * span;
    void game;
  }

  void face;
  return finish(group, s, s, update);
}
