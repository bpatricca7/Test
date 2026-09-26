// CSM Entry Monitor System (Main Display Console panel 1): scroll assembly (Mylar strip with the
// printed entry-corridor pattern and the scribed trace), ΔV/RANGE counter (EL digits), G meter,
// Roll Stability Indicator and the SPS THRUST / .05 G / CORRIDOR VERIFY lights.
//
// The ΔV counter is the real thing's integrating accelerometer: it counts DOWN by the sensed
// velocity change (tel.accel over sim time) while the SPS fires. It lives in `vessel.ems.dv`
// (ft/s; added field) so other modules/UI can preset it before a burn; default 0.
import { THREE, createCase, createDisplay, drawSegChar, limiter, finish, needleMesh, barNeedle, trianglePointer, approach, DEG, FT, createCanvasTexture, drawText } from './common.js';
import { createLampFace, roundedSlab, createGlass } from '../kit/index.js';
import { horizonAttitude } from '../../../core/frames.js';

const EL_ON = 'rgb(120,255,150)';
const EL_OFF = '#18201a';

function scrollTexture(w, h) {
  const t = createCanvasTexture(w, h, 4200);
  const g = t.g;
  const W = t.canvas.width;
  const H = t.canvas.height;
  g.fillStyle = '#1b1d1c';
  g.fillRect(0, 0, W, H);
  // printed grid: velocity (vertical, kft/s) vs g (horizontal)
  const gx = (gv) => W * (0.1 + (gv / 10) * 0.82);
  const vy = (v) => H * (0.06 + ((37 - v) / 16) * 0.9);
  g.strokeStyle = 'rgba(210,214,205,0.55)';
  g.lineWidth = 1.2;
  for (let gv = 0; gv <= 10; gv++) {
    g.beginPath();
    g.moveTo(gx(gv), vy(37));
    g.lineTo(gx(gv), vy(21));
    g.stroke();
  }
  for (let v = 21; v <= 37; v++) {
    g.lineWidth = v % 5 === 0 ? 1.8 : 0.9;
    g.beginPath();
    g.moveTo(gx(0), vy(v));
    g.lineTo(gx(10), vy(v));
    g.stroke();
    if (v % 2 === 1) drawText(g, String(v), W * 0.05, vy(v), H * 0.024, { color: 'rgba(225,228,220,0.8)', caps: false });
  }
  for (let gv = 0; gv <= 10; gv += 2) drawText(g, String(gv), gx(gv), H * 0.985, H * 0.024, { color: 'rgba(225,228,220,0.8)', caps: false });
  // printed exit / g-limit curves
  g.strokeStyle = 'rgba(235,238,230,0.85)';
  g.lineWidth = 2.2;
  for (const k of [0.2, 0.45, 0.8]) {
    g.beginPath();
    for (let i = 0; i <= 40; i++) {
      const v = 37 - (i / 40) * 16;
      const gg = Math.min(10, k * Math.exp((37 - v) / 5.5));
      if (i) g.lineTo(gx(gg), vy(v));
      else g.moveTo(gx(gg), vy(v));
    }
    g.stroke();
  }
  // scribed trace (bright, through the coating) from a previous test pattern
  g.strokeStyle = 'rgba(245,250,240,0.95)';
  g.lineWidth = 2.6;
  g.beginPath();
  for (let i = 0; i <= 60; i++) {
    const v = 36.8 - (i / 60) * 4.2;
    const gg = 0.2 + 1.4 * Math.sin(i / 11) ** 2 + i * 0.03;
    if (i) g.lineTo(gx(gg), vy(v));
    else g.moveTo(gx(gg), vy(v));
  }
  g.stroke();
  t.texture.needsUpdate = true;
  return t.texture;
}

/**
 * CSM Entry Monitor System (0.26 × 0.18 m).
 * opts: { deltaV (ft/s initial counter value if vessel.ems is not set) }
 */
export function createEMS(opts = {}) {
  const W = 0.26;
  const H = 0.18;
  const fr = 0.007;
  const scroll = { x: -0.066, y: -0.006, w: 0.1, h: 0.128 };
  const ctr = { x: 0.062, y: 0.052, w: 0.104, h: 0.026 };
  const gm = { x: 0.034, y: -0.034, r: 0.029 };
  const rsi = { x: 0.097, y: -0.034, r: 0.0215 };
  const lampY = 0.017;
  const lampXs = [0.022, 0.062, 0.102];
  const gMin = -1;
  const gMax = 10;
  const A0 = -135 * DEG;
  const A1 = 135 * DEG;
  const gmap = (v) => A0 + ((Math.max(gMin, Math.min(gMax, v)) - gMin) / (gMax - gMin)) * (A1 - A0);
  const { group } = createCase({
    width: W,
    height: H,
    frame: fr,
    holes: [
      { x: scroll.x, y: scroll.y, w: scroll.w, h: scroll.h, corner: 0.002 },
      { x: ctr.x, y: ctr.y, w: ctr.w, h: ctr.h, corner: 0.0015 },
      { x: rsi.x, y: rsi.y, radius: rsi.r },
    ],
    faceSpec: {
      draw(P) {
        P.text('ENTRY MONITOR', scroll.x, scroll.y + scroll.h / 2 + 0.0055, 0.0042);
        P.text('ΔV / RANGE', ctr.x, ctr.y + ctr.h / 2 + 0.005, 0.0042);
        P.text('FPS / NM', ctr.x + ctr.w / 2, ctr.y - ctr.h / 2 - 0.0045, 0.0031, { align: 'right' });
        // G meter dial (printed)
        P.ring(gm.x, gm.y, gm.r, 0.0006, '#f0f0ea', A0 - Math.PI / 2, A1 - Math.PI / 2);
        for (let v = gMin; v <= gMax; v++) {
          const a = gmap(v);
          const l = v % 5 === 0 || v === gMin ? 0.2 : 0.12;
          P.line(gm.x + Math.sin(a) * gm.r, gm.y + Math.cos(a) * gm.r, gm.x + Math.sin(a) * gm.r * (1 - l), gm.y + Math.cos(a) * gm.r * (1 - l), 0.0007);
          if (v % 2 === 0 || v === gMin) P.text(String(v), gm.x + Math.sin(a) * gm.r * 0.66, gm.y + Math.cos(a) * gm.r * 0.66, 0.0038);
        }
        P.text('G', gm.x, gm.y - gm.r * 0.45, 0.0048);
        // RSI legends
        P.text('RSI', rsi.x, rsi.y + rsi.r + 0.0055, 0.0038);
        for (let a = 0; a < 360; a += 45) {
          const an = a * DEG;
          P.line(rsi.x + Math.sin(an) * (rsi.r + 0.0008), rsi.y + Math.cos(an) * (rsi.r + 0.0008), rsi.x + Math.sin(an) * (rsi.r + 0.0032), rsi.y + Math.cos(an) * (rsi.r + 0.0032), 0.0007);
        }
        P.text('CORRIDOR VERIFY', lampXs[2], lampY + 0.0098, 0.0026);
        P.text('SPS', lampXs[0], lampY + 0.0098, 0.0026);
        P.text('ENTRY', lampXs[1], lampY + 0.0098, 0.0026);
      },
    },
    depth: 0.045,
  });
  // ---- scroll
  const scrollMesh = new THREE.Mesh(new THREE.PlaneGeometry(scroll.w, scroll.h), new THREE.MeshStandardMaterial({ map: scrollTexture(scroll.w, scroll.h), roughness: 0.35, emissive: 0xffffff, emissiveIntensity: 0.0 }));
  scrollMesh.material.emissiveMap = scrollMesh.material.map;
  scrollMesh.position.set(scroll.x, scroll.y, -0.004);
  group.add(scrollMesh);
  const stylus = needleMesh(trianglePointer(0.004, 0.006), 0x111111, 0);
  stylus.rotation.z = -Math.PI / 2;
  stylus.position.set(scroll.x - scroll.w * 0.24, scroll.y + scroll.h * 0.18, -0.0025);
  group.add(stylus);
  // ---- ΔV counter (EL)
  const disp = createDisplay(ctr.w, ctr.h, { pxPerM: 6000 });
  disp.mesh.position.set(ctr.x, ctr.y, -0.0025);
  group.add(disp.mesh);
  const Wp = disp.base.canvas.width;
  const Hp = disp.base.canvas.height;
  const n = 6; // sign + 5 digits (last is tenths)
  const dh = Hp * 0.72;
  const dw = dh * 0.56;
  const pitch = dw * 1.34;
  const x0 = (Wp - n * pitch) / 2 + (pitch - dw) / 2;
  const y0 = (Hp - dh) / 2;
  const seg = { t: dw * 0.16, gap: dw * 0.03 };
  {
    const g = disp.base.g;
    g.fillStyle = '#0c0f0d';
    g.fillRect(0, 0, Wp, Hp);
    for (let i = 0; i < n; i++) drawSegChar(g, ' ', x0 + i * pitch, y0, dw, dh, { ...seg, off: EL_OFF, sign: i === 0 });
    disp.base.texture.needsUpdate = true;
  }
  let lastStr = null;
  const drawCounter = (ftps) => {
    const a = Math.min(99999, Math.round(Math.abs(ftps) * 10));
    const s = (ftps < -0.05 ? '-' : '+') + String(a).padStart(5, '0');
    if (s === lastStr) return;
    lastStr = s;
    disp.redraw((g) => {
      g.shadowColor = EL_ON;
      g.shadowBlur = dw * 0.1;
      for (let i = 0; i < n; i++) drawSegChar(g, s[i], x0 + i * pitch, y0, dw, dh, { ...seg, on: EL_ON, sign: i === 0 });
      g.fillStyle = EL_ON;
      g.beginPath();
      g.arc(x0 + 5 * pitch - (pitch - dw) / 2, y0 + dh - dw * 0.06, dw * 0.1, 0, Math.PI * 2);
      g.fill();
    });
  };
  // ---- G needle
  const gNeedle = needleMesh(barNeedle(gm.r * 0.86, 0.0014), 0xdad9d0, 0);
  gNeedle.position.set(gm.x, gm.y, 0.0006);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.0035, 0.002, 20).rotateX(Math.PI / 2).translate(0, 0, 0.001), new THREE.MeshStandardMaterial({ color: 0x0b0b0b, roughness: 0.4 }));
  cap.position.set(gm.x, gm.y, 0.0006);
  group.add(gNeedle, cap);
  // ---- RSI: black ball-like disc with a rotating lit lift-vector triangle
  const rsiDisc = new THREE.Mesh(new THREE.CircleGeometry(rsi.r, 40), new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.3 }));
  rsiDisc.position.set(rsi.x, rsi.y, -0.003);
  group.add(rsiDisc);
  const rsiG = new THREE.Group();
  rsiG.position.set(rsi.x, rsi.y, -0.0025);
  const rsiMat = new THREE.MeshStandardMaterial({ color: 0xdad9d0, emissive: 0xdad9d0, emissiveIntensity: 0.25, roughness: 0.4 });
  const tri = new THREE.Mesh(new THREE.ShapeGeometry(trianglePointer(rsi.r * 0.45, rsi.r * 0.5)), rsiMat);
  tri.rotation.z = Math.PI;
  tri.position.y = rsi.r * 0.88;
  rsiG.add(tri);
  group.add(rsiG);
  // ---- lights
  const lampFaces = [
    createLampFace('SPS\nTHRUST', 0.027, 0.012, { style: 'block', color: 'white', tone: 'light', pxPerM: 9000 }),
    createLampFace('.05 G', 0.027, 0.012, { style: 'block', color: 'white', tone: 'light', pxPerM: 9000 }),
    createLampFace('UPPER\nLOWER', 0.027, 0.012, { style: 'block', color: 'red', tone: 'light', pxPerM: 9000 }),
  ];
  lampFaces.forEach((f, i) => {
    const m = new THREE.Mesh(roundedSlab(0.027, 0.012, 0.003, 0.001, 0.0004, 0.0012), f.material);
    m.position.set(lampXs[i], lampY, 0);
    group.add(m);
    const gl = createGlass(0.027, 0.012, 0.00125);
    gl.position.set(lampXs[i], lampY, 0);
    group.add(gl);
  });
  // ---- behaviour
  const lim = limiter(30);
  const st = { g: 0, roll: 0 };
  let lastLamps = '';
  drawCounter(opts.deltaV ?? 0);
  function update(vessel, game, dt) {
    const e = lim.tick(dt);
    if (!e || !vessel) return;
    const ems = vessel.ems || (vessel.ems = { dv: opts.deltaV ?? 0, lastMet: null });
    const met = game?.time?.met ?? 0;
    const firing = !!vessel.mainEngine?.firing;
    if (ems.lastMet != null && met > ems.lastMet && firing) ems.dv -= ((vessel.tel?.accel ?? 0) * (met - ems.lastMet)) / FT;
    ems.lastMet = met;
    drawCounter(ems.dv);
    const gees = (vessel.tel?.accel ?? 0) / 9.80665;
    st.g = approach(st.g, gees, e, 5);
    gNeedle.rotation.z = -gmap(st.g);
    const att = horizonAttitude(vessel.pos, vessel.quat);
    st.roll = approach(st.roll, att.roll, e, 6);
    rsiG.rotation.z = -st.roll * DEG;
    const lamps = `${firing ? 1 : 0}${gees > 0.05 ? 1 : 0}0`;
    if (lamps !== lastLamps) {
      lastLamps = lamps;
      lampFaces.forEach((f, i) => f.setLit(lamps[i] === '1'));
    }
  }
  return finish(group, W, H, update);
}
