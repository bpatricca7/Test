// ECHO (characters cut) — the set: the observatory hut interior and the ridge
// exterior. See API.md ("The set: lib/set.js").
//
//   const set = await createSet(env);
//   set.interior.root, set.exterior.root, set.anchors
//   set.update(t, { alarm, surge, lights, hologram, samChair: {pos, yaw}, dish: {az, el} })
//
// Any state field left out is derived from the timeline (TL.beats / TL.marks),
// so the set also plays on its own.
//
// The interior window looks out at the real exterior: when the window glass is
// drawn, the exterior is rendered (scissored to the window) from the matching
// camera in the hut frame. The set owns all the room lights.

import { makeTextures } from './set/tex.js';
import { makeScreens } from './set/screens.js';
import { buildInterior } from './set/interior.js';
import { buildExterior } from './set/exterior.js';

export async function createSet(env) {
  const { THREE, TL, U, renderer } = env;
  const V3 = THREE.Vector3;
  const { clamp, lerp, smooth } = U;
  const B = TL.beats, MK = TL.marks;
  const PI = Math.PI;

  const T = makeTextures(env);
  const screens = makeScreens(env);
  const ext = buildExterior(env);
  const int = buildInterior(env, T, screens);
  const { W, D, WIN, SCR } = int.dims;

  // own scene for the exterior until someone else adopts the root
  const extScene = new THREE.Scene();
  extScene.background = new THREE.Color(0, 0, 0);
  extScene.add(ext.root);

  // -------------------------------------------------------------------------
  // the window glass: shows the exterior (a portal render)
  // -------------------------------------------------------------------------
  const winW = WIN.z1 - WIN.z0, winH = WIN.y1 - WIN.y0;
  const winC = new V3(W + 0.1, (WIN.y0 + WIN.y1) / 2, (WIN.z0 + WIN.z1) / 2);
  let portalRT = null;
  const glassU = {
    tView: { value: null }, uRes: { value: new THREE.Vector2(1, 1) }, uOk: { value: 0 },
    tDirt: { value: T.glassDirt }, uRefl: { value: new V3() },
  };
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(winW, winH), new THREE.ShaderMaterial({
    uniforms: glassU,
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: /* glsl */`
      uniform sampler2D tView, tDirt; uniform vec2 uRes; uniform float uOk; uniform vec3 uRefl;
      varying vec2 vUv;
      void main() {
        vec3 c = uOk > 0.5 ? texture2D(tView, gl_FragCoord.xy / uRes).rgb : vec3(0.004, 0.006, 0.014);
        float d = texture2D(tDirt, vUv * vec2(1.2, 1.0)).r;
        c = c * (0.93 - 0.12 * d) + uRefl * (0.25 + 1.5 * d) * (0.6 + 0.4 * vUv.y);
        gl_FragColor = vec4(c, 1.0);
      }`,
  }));
  glass.position.copy(winC);
  glass.rotation.y = -PI / 2;
  glass.name = 'windowGlass';
  int.root.add(glass);

  const extCam = new THREE.PerspectiveCamera();
  const camRoom = new THREE.Matrix4(), tmpM = new THREE.Matrix4(), invRoot = new THREE.Matrix4();
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => new V3(winC.x, winC.y + b * winH / 2, winC.z + a * winW / 2));
  const pv = new V3(), dbs = new THREE.Vector2();
  let inPortal = false;
  glass.onBeforeRender = (rdr, scene, camera) => {
    if (inPortal) return;
    const target = rdr.getRenderTarget();
    let w, h;
    if (target) { w = target.width; h = target.height; } else { rdr.getDrawingBufferSize(dbs); w = dbs.x; h = dbs.y; }
    if (!portalRT || portalRT.width !== w || portalRT.height !== h) {
      if (portalRT) portalRT.dispose();
      portalRT = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, depthBuffer: true, generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    }
    // camera in the room frame -> hut frame in the exterior
    int.root.updateWorldMatrix(true, false);
    invRoot.copy(int.root.matrixWorld).invert();
    camRoom.multiplyMatrices(invRoot, camera.matrixWorld);
    ext.hutG.updateWorldMatrix(true, false);
    tmpM.multiplyMatrices(ext.hutG.matrixWorld, camRoom);
    tmpM.decompose(extCam.position, extCam.quaternion, extCam.scale);
    extCam.projectionMatrix.copy(camera.projectionMatrix);
    extCam.projectionMatrixInverse.copy(camera.projectionMatrixInverse);
    // scissor to the window's screen rectangle
    let x0 = w, y0 = h, x1 = 0, y1 = 0, behind = false;
    for (const c of corners) {
      pv.copy(c).applyMatrix4(int.root.matrixWorld).applyMatrix4(camera.matrixWorldInverse);
      if (pv.z > -1e-3) { behind = true; break; }
      pv.applyMatrix4(camera.projectionMatrix);
      const sx = (pv.x * 0.5 + 0.5) * w, sy = (pv.y * 0.5 + 0.5) * h;
      x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
    }
    if (behind) { x0 = 0; y0 = 0; x1 = w; y1 = h; }
    x0 = Math.max(0, Math.floor(x0) - 2); y0 = Math.max(0, Math.floor(y0) - 2);
    x1 = Math.min(w, Math.ceil(x1) + 2); y1 = Math.min(h, Math.ceil(y1) + 2);
    if (x1 <= x0 || y1 <= y0) return;
    // render the exterior (whatever scene now holds its root)
    let es = ext.root;
    while (es.parent) es = es.parent;
    inPortal = true;
    const prevTarget = rdr.getRenderTarget();
    const prevAuto = rdr.shadowMap.autoUpdate;
    const prevClear = rdr.autoClear;
    rdr.shadowMap.autoUpdate = false;
    ext.hutExterior.visible = false;
    ext.starU.uScale.value = Math.max(0.6, h / 1080);
    portalRT.scissor.set(x0, y0, x1 - x0, y1 - y0);
    portalRT.scissorTest = true;
    rdr.setRenderTarget(portalRT);
    rdr.autoClear = true;
    rdr.render(es, extCam);
    portalRT.scissorTest = false;
    rdr.setRenderTarget(prevTarget);
    rdr.autoClear = prevClear;
    ext.hutExterior.visible = true;
    rdr.shadowMap.autoUpdate = prevAuto;
    inPortal = false;
    glassU.tView.value = portalRT.texture;
    glassU.uRes.value.set(w, h);
    glassU.uOk.value = 1;
  };

  // -------------------------------------------------------------------------
  // moonlight through the window: a spot far outside with a cookie of the panes
  // -------------------------------------------------------------------------
  const moonLocal = ext.moonLocal;              // hut frame == room frame
  const moon = new THREE.SpotLight(0x9fb4ff, 0.9, 0, 0.09, 0.0, 0);
  moon.position.copy(winC).addScaledVector(moonLocal, 14);
  moon.target.position.copy(winC);
  moon.shadow.mapSize.set(512, 512);
  int.root.add(moon, moon.target);
  {
    int.root.updateMatrixWorld(true);
    moon.updateMatrixWorld(true); moon.target.updateMatrixWorld(true);
    moon.shadow.updateMatrices(moon);
    const S = 512, c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d');
    g.fillStyle = '#000'; g.fillRect(0, 0, S, S);
    const proj = (y, z) => { const v = new THREE.Vector4(winC.x, y, z, 1).applyMatrix4(moon.shadow.matrix); return [v.x / v.w * S, (1 - v.y / v.w) * S]; };
    const pane = (za, zb, ya, yb) => {
      g.beginPath();
      [[za, ya], [zb, ya], [zb, yb], [za, yb]].forEach(([z, y], i) => { const [px, py] = proj(y, z); if (i) g.lineTo(px, py); else g.moveTo(px, py); });
      g.fill();
    };
    const zm = (WIN.z0 + WIN.z1) / 2, ym = (WIN.y0 + WIN.y1) / 2, f = 0.05, m = 0.0175;
    g.fillStyle = '#fff';
    g.filter = 'blur(2px)';
    pane(WIN.z0 + f, zm - m, WIN.y0 + f, ym - m); pane(zm + m, WIN.z1 - f, WIN.y0 + f, ym - m);
    pane(WIN.z0 + f, zm - m, ym + m, WIN.y1 - f); pane(zm + m, WIN.z1 - f, ym + m, WIN.y1 - f);
    g.filter = 'none';
    const tex = new THREE.CanvasTexture(c);
    moon.map = tex;
  }

  // -------------------------------------------------------------------------
  // anchors
  // -------------------------------------------------------------------------
  const hutInv = ext.hutMatrix.clone().invert();
  const dishView = new V3(...ext.anchors.dishAxis).add(new V3(0, 3, 0)).applyMatrix4(hutInv);
  const L = int.dims;
  const anchors = {
    screen: { center: SCR.c.toArray(), normal: [0, 0, 1], width: SCR.w, height: SCR.h },
    secondScreen: { center: new V3().setFromMatrixPosition(int.parts.secondScreen.matrixWorld).toArray(), normal: [Math.sin(0.46), 0, Math.cos(0.46)], width: 0.335, height: 0.25 },
    window: { center: [W, winC.y, winC.z], glass: winC.toArray(), normal: [-1, 0, 0], width: winW, height: winH },
    door: { center: [(L.DOOR.x0 + L.DOOR.x1) / 2, 1.02, D], normal: [0, 0, -1] },
    desk: { top: L.DESK.y, x: [L.DESK.x0, L.DESK.x1], z: [L.DESK.z0, L.DESK.z1] },
    keyboard: [-0.5, L.DESK.y + 0.035, -1.43],
    keyF3: [-0.5 - 0.46 / 2 + (20 + 2 * 56 + 26) / 1024 * 0.46, L.DESK.y + 0.04, -1.43 - 0.165 / 2 + 36 / 364 * 0.165],
    mug: [0.06, L.DESK.y + 0.09, -1.47],
    lamp: { bulb: L.bulbPos.toArray(), aim: L.LAMP.aim.toArray() },
    beacon: [L.BEACON.x, L.BEACON.y + 0.13, L.BEACON.z],
    clock: L.CLOCK.toArray(),
    receiver: L.RX.c.toArray(),
    samChair: { seatHeight: 0.47, note: 'samChair.pos is the floor point under the front edge of the seat (same as the seated human root); +z local is forward' },
    armchair: { pos: L.ARM.pos.toArray(), yaw: L.ARM.yaw, seatHeight: 0.42 },
    dishView: dishView.toArray(),            // the dish (reflector) as seen out of the window, room coords
    moonDir: moonLocal.toArray(),            // toward the moon, room coords
  };
  int.anchors = anchors;

  // -------------------------------------------------------------------------
  // per frame
  // -------------------------------------------------------------------------
  const { lamp, monitor, alarm, holo, hemi } = int.lights;
  const P = int.parts;
  const lampWarm = new THREE.Color(1.0, 0.70, 0.40), lampDim = new THREE.Color(1.0, 0.45, 0.16);
  const tmpC = new THREE.Color(), tmpC2 = new THREE.Color();
  const hash = (i, k) => { const s = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453; return s - Math.floor(s); };
  const ang = (a, b, u) => { const d = ((b - a + PI) % (2 * PI) + 2 * PI) % (2 * PI) - PI; return a + d * u; };
  const roomCentreAz = Math.atan2(0 - L.BEACON.x, 0.3 - L.BEACON.z);

  function defaults(t, s) {
    const st = Object.assign({}, s);
    if (st.alarm === undefined) st.alarm = t >= B.alarm && t < B.lights_return ? 1 : 0;
    if (st.surge === undefined) st.surge = U.window01(t, B.surge.start, B.surge.end, 0.15, 0.6);
    if (st.lights === undefined) st.lights = 1 - 0.65 * smooth(B.surge.start, B.surge.end, t) * (1 - smooth(B.lights_return - 0.4, B.lights_return + 0.6, t));
    if (st.hologram === undefined) st.hologram = smooth(B.materialize.start, B.materialize.end, t) * (1 - smooth(B.dematerialize.start, B.dematerialize.end, t));
    if (!st.samChair) {
      const u = smooth(B.sam_backs_off.start, B.sam_backs_off.start + 0.6, t);
      const a = MK.sam_chair, b = MK.sam_chair_back;
      st.samChair = { pos: [lerp(a.pos[0], b.pos[0], u), 0, lerp(a.pos[2], b.pos[2], u)], yaw: ang(a.yaw, b.yaw, u) };
    }
    return st;
  }

  function update(t, s = {}) {
    const st = defaults(t, s);
    const lights = clamp(st.lights), surge = clamp(st.surge), holoA = Math.max(0, st.hologram), alarmA = clamp(st.alarm);
    screens.update(t, st);
    ext.update(t, st);

    // brown-out flicker (deterministic, 30 Hz buckets)
    const f = Math.floor(t * 30);
    let flick = 1;
    if (surge > 0) { const h = hash(f, 1); flick = 1 - surge * (h < 0.35 ? 0.85 : 0.35 * hash(f, 2)); }
    const lampF = lights * flick;
    tmpC.copy(lampWarm).lerp(lampDim, clamp(1 - lampF));
    lamp.color.copy(tmpC);
    lamp.intensity = 5.5 * lampF;
    int.E.bulb.color.copy(tmpC).multiplyScalar(8 * lampF + 0.02);
    int.E.lampInner.color.copy(tmpC).multiplyScalar(2.2 * lampF);
    int.E.dial.color.setScalar(1.3 * (0.25 + 0.75 * lampF) * (t >= B.surge.start + 0.3 && t < B.lights_return ? 0.15 : 1));
    int.E.meter.color.setRGB(1.0, 0.72, 0.38).multiplyScalar(1.1 * (0.3 + 0.7 * lampF));

    // monitor spill
    monitor.color.copy(screens.color);
    monitor.intensity = 1.6 * screens.level;

    // alarm beacon: rotating reflector + red spot sweeping the room
    const spin = (t - B.alarm) * PI * 2 * 0.75;
    const dir = new V3(Math.sin(spin), -0.28, Math.cos(spin));
    alarm.target.position.copy(alarm.position).add(dir);
    alarm.target.updateMatrixWorld();
    alarm.intensity = 14 * alarmA;
    P.beaconSpin.rotation.y = spin;
    const facing = Math.pow(Math.max(0, Math.cos(spin - roomCentreAz)), 2);
    int.E.beaconDome.emissiveIntensity = alarmA * (0.8 + 5 * facing);
    P.beaconSpin.children[1].material.color.setRGB(1, 0.35, 0.25).multiplyScalar(alarmA * (2 + 12 * facing) + 0.05);

    // hologram fill
    holo.intensity = 3.2 * holoA;

    // bounce / ambient
    const sky = tmpC.setRGB(0.050, 0.060, 0.090).multiplyScalar(0.5 + 0.5 * lights);
    sky.r += 0.07 * lampF; sky.g += 0.045 * lampF; sky.b += 0.022 * lampF;
    sky.r += 0.02 * screens.level; sky.g += 0.05 * screens.level; sky.b += 0.045 * screens.level;
    sky.r += 0.10 * alarmA * (0.3 + facing); sky.g += 0.008 * alarmA; sky.b += 0.005 * alarmA;
    sky.r += 0.03 * holoA; sky.g += 0.11 * holoA; sky.b += 0.13 * holoA;
    hemi.color.copy(sky);
    hemi.groundColor.copy(sky).multiplyScalar(0.55);
    hemi.intensity = 1.0;
    for (const m of int.glossy) m.envMapIntensity = m.userData.env * (0.25 + 0.75 * lampF) + 0.1 * holoA;
    glassU.uRefl.value.set(0.020, 0.013, 0.008).multiplyScalar(lampF);

    // chair
    const ch = st.samChair;
    P.chair.position.set(ch.pos[0], 0, ch.pos[2]);
    P.chair.rotation.y = ch.yaw;
    P.chairBase.rotation.y = 0.35 - ch.yaw + 0.8 * (ch.pos[2] - MK.sam_chair.pos[2]);

    // clock: 03:14:00 at t = 7, real time
    const secs = 3 * 3600 + 14 * 60 + (t - 7);
    const sTick = Math.floor(secs) + smooth(0, 0.08, secs - Math.floor(secs));
    P.hSec.rotation.z = -(sTick % 60) / 60 * PI * 2;
    P.hMin.rotation.z = -((secs / 60) % 60) / 60 * PI * 2;
    P.hHour.rotation.z = -((secs / 3600) % 12) / 12 * PI * 2;

    // rack LEDs
    const dead = t >= B.surge.start + 0.6 && t < B.lights_return;
    const col = new THREE.Color();
    P.leds.forEach((l, i) => {
      let on = l.rate === 0 ? 1 : ((t * l.rate + l.phase) % 1 < l.duty ? 1 : 0.06);
      if (surge > 0 && hash(f, i + 7) < surge * 0.5) on *= 0.1;
      if (dead) on = (i % 9 === 0) ? ((t * 1.3 + l.phase) % 1 < 0.5 ? 1 : 0.1) : 0.03;
      col.copy(l.col).multiplyScalar(2.2 * on + 0.02);
      P.ledMesh.setColorAt(i, col);
    });
    P.ledMesh.instanceColor.needsUpdate = true;
    // receiver S-meter
    const sig = t > B.alarm && t < TL.pulses.times[TL.pulses.times.length - 1] + 0.3 ? 0.7 + 0.2 * U.vnoise3(t * 6, 1, 0) : 0.12 + 0.1 * U.vnoise3(t * 3, 2, 0);
    P.meterNeedle.rotation.z = lerp(0.8, -0.8, sig * lampF);
  }

  // lazily draw the canvases only when their screens are actually rendered
  P.mainScreen.onBeforeRender = () => screens.drawMainIfNeeded();
  P.secondScreen.onBeforeRender = () => screens.drawSecondIfNeeded();
  P.scopeMesh.onBeforeRender = () => screens.drawRackIfNeeded();
  P.counterMesh.onBeforeRender = () => screens.drawRackIfNeeded();

  update(0, {});

  return {
    interior: { root: int.root, anchors },
    exterior: { root: ext.root, anchors: ext.anchors, scene: extScene },
    anchors,
    update,
    // internals, for tests
    _: { int, ext, screens, T },
  };
}
