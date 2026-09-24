// The observatory hut, interior: shell, furniture, dressing and practical lights.
// Room: x -2.5..2.5, z -2..2, y 0..2.6 (API.md). All numbers in metres.

import { makeKit } from './kit.js';

export function buildInterior(env, T, screens) {
  const { THREE, U, renderer } = env;
  const V3 = THREE.Vector3;
  const K = makeKit(THREE);
  const { add, at, box, rbox, cyl, rod, quad } = K;
  const PI = Math.PI;
  const root = new THREE.Group();
  root.name = 'set.interior';
  const rnd = U.mulberry32(2718);
  const tube = (pts, r, seg = 40) => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map(p => new V3(...p))), seg, r, 6, false);

  // -------------------------------------------------------------------------
  // environment map for glossy things: a dim warm room with a lamp, a cyan
  // screen and a blue window, baked once through PMREM
  // -------------------------------------------------------------------------
  let envMap = null;
  {
    const es = new THREE.Scene();
    const roomM = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.018, 0.016, 0.014), side: THREE.BackSide });
    es.add(new THREE.Mesh(new THREE.BoxGeometry(5, 2.6, 4), roomM));
    const patch = (w, h, col, pos, ry) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: col, side: THREE.DoubleSide })); m.position.set(...pos); m.rotation.y = ry; es.add(m); };
    patch(0.5, 0.35, new THREE.Color(2.2, 1.4, 0.7), [0.8, 0.2, -1.2], 0.3);        // lamp pool
    patch(0.6, 0.35, new THREE.Color(0.25, 0.8, 0.65), [-0.5, 0.0, -1.95], 0);      // monitor
    patch(1.1, 0.9, new THREE.Color(0.05, 0.08, 0.16), [2.45, 0.1, 0.3], PI / 2);   // window
    patch(2.0, 1.0, new THREE.Color(0.06, 0.045, 0.03), [0, -1.25, 0], 0);           // floor bounce
    const pm = new THREE.PMREMGenerator(renderer);
    envMap = pm.fromScene(es, 0.02).texture;
    pm.dispose();
  }

  // -------------------------------------------------------------------------
  // materials
  // -------------------------------------------------------------------------
  const glossy = [];     // materials whose envMapIntensity follows the room light
  // SwiftShader shades every rasterized fragment, so most surfaces are Lambert (diffuse)
  // or Phong (a lamp highlight); only small metal parts get a PBR material + env map.
  const met = (o, env = 0.8) => { const m = new THREE.MeshStandardMaterial(o); m.envMap = envMap; m.envMapIntensity = env; m.userData.env = env; glossy.push(m); return m; };
  const lam = o => new THREE.MeshLambertMaterial(o);
  const pho = (o, shininess = 30, spec = 0x222222) => new THREE.MeshPhongMaterial(Object.assign({ shininess, specular: new THREE.Color(spec) }, o));
  const N = (tex, s = 1) => ({ normalMap: tex, normalScale: new THREE.Vector2(s, s) });
  // moonlight through the window panes, computed analytically (used by the floor)
  const moonU = { uMoonDir: { value: new V3(1, 0.5, 0).normalize() }, uMoonCol: { value: new THREE.Color(0, 0, 0) }, uWin: { value: new THREE.Vector4(-0.2, 0.8, 1.0, 1.8) }, uWinX: { value: 2.6 }, uWinM: { value: new THREE.Vector2(0.3, 1.4) } };
  const withMoon = m => {
    m.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, moonU);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vMoonP;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvMoonP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
        varying vec3 vMoonP;
        uniform vec3 uMoonDir, uMoonCol; uniform vec4 uWin; uniform float uWinX; uniform vec2 uWinM;
        float moonMask(vec3 p) {
          float t = (uWinX - p.x) / uMoonDir.x;
          vec3 q = p + uMoonDir * t;
          float e = 0.012;
          float m = smoothstep(uWin.x - e, uWin.x + e, q.z) * (1.0 - smoothstep(uWin.y - e, uWin.y + e, q.z))
                  * smoothstep(uWin.z - e, uWin.z + e, q.y) * (1.0 - smoothstep(uWin.w - e, uWin.w + e, q.y));
          m *= smoothstep(0.016, 0.03, abs(q.z - uWinM.x)) * smoothstep(0.016, 0.03, abs(q.y - uWinM.y));
          return t > 0.0 ? m : 0.0;
        }`).replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        reflectedLight.directDiffuse += BRDF_Lambert(diffuseColor.rgb) * uMoonCol * moonMask(vMoonP) * max(dot(normal, uMoonDir), 0.0);`);
    };
    return m;
  };
  const M = {
    pine: lam({ map: T.pine, ...N(T.pineN, 0.8) }),
    paint: lam({ map: T.paint }),
    floor: withMoon(pho({ map: T.floor, ...N(T.floorN, 0.7), specularMap: T.floorRough }, 24, 0x3a3228)),
    ceiling: lam({ map: T.ceiling }),
    beam: lam({ map: T.beam, ...N(T.beamN, 0.8) }),
    trim: lam({ map: T.beam, color: 0xd8c0a0 }),
    desk: pho({ map: T.desk, ...N(T.deskN, 0.5) }, 40, 0x2a2622),
    enamel: pho({ map: T.enamel }, 30, 0x1a1a1a),
    enamelDark: pho({ map: T.enamel, color: 0x6a7068 }, 30, 0x1a1a1a),
    rackMetal: lam({ map: T.rackMetal, ...N(T.crinkleN, 0.6) }),
    rackFront: pho({ map: T.rack }, 30, 0x161616),
    black: pho({ color: 0x19191b }, 40, 0x202020),
    rubber: lam({ color: 0x121212 }),
    charcoal: pho({ color: 0x2a2b2e }, 50, 0x262626),
    beige: pho({ map: T.beige }, 30, 0x1c1c1a),
    chrome: met({ color: 0xc8c8cc, roughness: 0.22, metalness: 1.0 }, 1.0),
    steel: met({ color: 0x9a9ca0, roughness: 0.4, metalness: 0.9 }, 0.8),
    brass: met({ color: 0xb08a48, roughness: 0.35, metalness: 1.0 }, 0.8),
    lampGreen: pho({ color: 0x24493a }, 70, 0x303030),
    armFabric: lam({ map: T.armFabric, ...N(T.armFabricN, 0.9) }),
    chairFabric: lam({ map: T.chairFabric }),
    blanket: lam({ map: T.blanket, ...N(T.blanketN, 1.0), side: THREE.DoubleSide }),
    rug: lam({ map: T.rug }),
    darkWood: lam({ map: T.beam, color: 0x8a6a50 }),
    paper: lam({ map: T.paper, side: THREE.DoubleSide }),
    greenbar: lam({ map: T.greenbar, side: THREE.DoubleSide }),
    cork: lam({ map: T.cork, ...N(T.corkN, 0.8) }),
    books: lam({ map: T.books }),
    keyboard: pho({ map: T.keyboard }, 30, 0x181818),
    mugs: pho({ map: T.mugs }, 90, 0x404040),
    coffee: pho({ color: 0x1a0d06 }, 120, 0x505050),
    whiteboard: pho({ map: T.whiteboard }, 80, 0x404040),
    poster: lam({ map: T.poster }),
    poster2: lam({ map: T.poster2 }),
    sign: lam({ map: T.sign }),
    doorSign: pho({ map: T.doorSign }, 40, 0x222222),
    fridge: pho({ map: T.fridge }, 50, 0x2a2a2a),
    white: pho({ color: 0xdedbd2 }, 30, 0x1a1a1a),
    door: lam({ map: T.enamel, color: 0x8f9a92 }),
    cardboard: lam({ color: 0x9a7650 }),
    receiver: pho({ map: T.receiver }, 30, 0x1c1c1c),
    red: pho({ color: 0xa3221c }, 40, 0x222222),
    plant: lam({ color: 0x3f6a34 }),
    terracotta: lam({ color: 0x9c5a3a }),
    coat: lam({ color: 0x7a2e22 }),
    coat2: lam({ color: 0x2e3b4a }),
    clock: pho({ map: T.clock }, 60, 0x2a2a2a),
    navy: lam({ color: 0x1f2c48 }),
    yellow: pho({ color: 0xd8b02a }, 40, 0x222222),
    glassGreen: pho({ color: 0x2b4a36 }, 100, 0x606060),
    beige2: pho({ map: T.beige, color: 0x9a9284 }, 20, 0x111111),
  };
  const E = {   // emissive / unlit practicals (values set in update)
    shade: new THREE.MeshBasicMaterial({ color: 0xffb070 }),
    shadeIn: new THREE.MeshBasicMaterial({ color: 0xffc890, side: THREE.BackSide }),
    bulb2: new THREE.MeshBasicMaterial({ color: 0xffffff }),
    lampInner: new THREE.MeshBasicMaterial({ color: 0xffd9a0, side: THREE.BackSide }),
    bulb: new THREE.MeshBasicMaterial({ color: 0xffffff }),
    dial: new THREE.MeshBasicMaterial({ map: T.dial }),
    meter: new THREE.MeshBasicMaterial({ color: 0xffc070 }),
    led: new THREE.MeshBasicMaterial({ color: 0xffffff }),
    beaconDome: new THREE.MeshPhongMaterial({ color: 0x7a0c06, emissive: 0xff1a0a, emissiveMap: T.fresnel, map: T.fresnel, emissiveIntensity: 0, shininess: 110, specular: 0x886666, transparent: true, opacity: 0.62, depthWrite: false }),
    exit: new THREE.MeshBasicMaterial({ map: T.exit, color: new THREE.Color(1.4, 1.4, 1.4) }),
    fluoro: new THREE.MeshLambertMaterial({ color: 0xd8d8d0 }),
  };

  // -------------------------------------------------------------------------
  // the shell
  // -------------------------------------------------------------------------
  const W = 2.5, D = 2.0, H = 2.6, WAIN = 0.95;
  const WIN = { z0: -0.25, z1: 0.85, y0: 0.95, y1: 1.85, x: 2.5 };
  const DOOR = { x0: 1.075, x1: 1.925, y1: 2.05, z: 2.0 };
  // a wall rectangle: plane facing n (one of +x,-x,+z,-z), spanning a..b along the wall, y0..y1
  function wallRect(mat, face, a, b, y0, y1, tile, depth = 0) {
    const w = b - a, h = y1 - y0;
    if (w <= 1e-4 || h <= 1e-4) return;
    const g = new THREE.PlaneGeometry(w, h);
    const c = (a + b) / 2, cy = (y0 + y1) / 2;
    const off = { tile, uv: 'world' };
    if (face === '+z') add(mat, g, [c, cy, -D + depth], [0, 0, 0], 1, off);
    if (face === '-z') add(mat, g, [c, cy, D - depth], [0, PI, 0], 1, off);
    if (face === '+x') add(mat, g, [-W + depth, cy, c], [0, PI / 2, 0], 1, off);
    if (face === '-x') add(mat, g, [W - depth, cy, c], [0, -PI / 2, 0], 1, off);
  }
  // back wall (faces +z), left wall (+x)
  wallRect(M.pine, '+z', -W, W, 0, WAIN, [1, 1]);
  wallRect(M.paint, '+z', -W, W, WAIN, H, [2, 2]);
  wallRect(M.pine, '+x', -D, D, 0, WAIN, [1, 1]);
  wallRect(M.paint, '+x', -D, D, WAIN, H, [2, 2]);
  // front wall (faces -z) with the door opening
  wallRect(M.pine, '-z', -W, DOOR.x0, 0, WAIN, [1, 1]);
  wallRect(M.pine, '-z', DOOR.x1, W, 0, WAIN, [1, 1]);
  wallRect(M.paint, '-z', -W, DOOR.x0, WAIN, H, [2, 2]);
  wallRect(M.paint, '-z', DOOR.x1, W, WAIN, H, [2, 2]);
  wallRect(M.paint, '-z', DOOR.x0, DOOR.x1, DOOR.y1, H, [2, 2]);
  // right wall (faces -x) with the window opening
  wallRect(M.pine, '-x', -D, D, 0, WAIN, [1, 1]);
  wallRect(M.paint, '-x', -D, WIN.z0, WAIN, H, [2, 2]);
  wallRect(M.paint, '-x', WIN.z1, D, WAIN, H, [2, 2]);
  wallRect(M.paint, '-x', WIN.z0, WIN.z1, WIN.y1, H, [2, 2]);
  // floor and ceiling
  add(M.floor, new THREE.PlaneGeometry(2 * W, 2 * D), [0, 0, 0], [-PI / 2, 0, 0], 1, { uv: 'world', tile: [2, 2] });
  add(M.ceiling, new THREE.PlaneGeometry(2 * W, 2 * D), [0, H, 0], [PI / 2, 0, 0], 1, { uv: 'world', tile: [1, 1] });
  // skirting, chair rail
  for (const [face, a, b] of [['+z', -W, W], ['+x', -D, D], ['-x', -D, D], ['-z', -W, DOOR.x0], ['-z', DOOR.x1, W]]) {
    const len = b - a, c = (a + b) / 2;
    const place = (h, y, d) => {
      const g = box(len, h, d);
      if (face === '+z') add(M.trim, g, [c, y, -D + d / 2]);
      if (face === '-z') add(M.trim, g, [c, y, D - d / 2]);
      if (face === '+x') add(M.trim, g, [-W + d / 2, y, c], [0, PI / 2, 0]);
      if (face === '-x') add(M.trim, g, [W - d / 2, y, c], [0, PI / 2, 0]);
    };
    place(0.1, 0.05, 0.018);
    if (face === '-x') {   // the chair rail doubles as the window stool: split around it
      const g1 = box(WIN.z0 + D, 0.035, 0.03), g2 = box(D - WIN.z1, 0.035, 0.03);
      add(M.trim, g1, [W - 0.015, WAIN, (-D + WIN.z0) / 2], [0, PI / 2, 0]);
      add(M.trim, g2, [W - 0.015, WAIN, (WIN.z1 + D) / 2], [0, PI / 2, 0]);
    } else place(0.035, WAIN, 0.03);
  }
  // ceiling beams (span z), wall plates
  for (const x of [-1.8, -0.6, 0.6, 1.8]) add(M.beam, box(0.11, 0.16, 2 * D), [x, H - 0.08, 0], [0, 0, 0], 1, { uv: 'world', tile: [0.25, 0.5] });
  add(M.beam, box(2 * W, 0.1, 0.1), [0, H - 0.05, -D + 0.05], [0, 0, 0], 1, { uv: 'world', tile: [0.5, 0.25] });
  add(M.beam, box(2 * W, 0.1, 0.1), [0, H - 0.05, D - 0.05], [0, 0, 0], 1, { uv: 'world', tile: [0.5, 0.25] });
  // fluorescent fitting (off) and smoke detector
  add(M.white, box(1.26, 0.06, 0.16), [0, H - 0.03, 0.15]);
  add(E.fluoro, box(1.2, 0.02, 0.12), [0, H - 0.07, 0.15]);
  add(M.white, cyl(0.06, 0.065, 0.035, 20), [-1.2, H - 0.018, 0.9]);

  // window: reveal, sill, frame with a cross mullion (four panes), glass is the portal (set.js)
  {
    const t = 0.16, xm = W + t / 2;
    const zc = (WIN.z0 + WIN.z1) / 2, yc = (WIN.y0 + WIN.y1) / 2, ww = WIN.z1 - WIN.z0, wh = WIN.y1 - WIN.y0;
    add(M.paint, new THREE.PlaneGeometry(t, ww), [xm, WIN.y1, zc], [PI / 2, 0, 0]);                  // head (faces down)
    add(M.paint, new THREE.PlaneGeometry(t, wh), [xm, yc, WIN.z0], [0, 0, 0]);                        // jambs
    add(M.paint, new THREE.PlaneGeometry(t, wh), [xm, yc, WIN.z1], [0, PI, 0]);
    add(M.trim, box(0.22, 0.03, ww + 0.14), [W - 0.02, WIN.y0 - 0.005, zc]);                            // stool
    add(M.trim, box(0.03, 0.06, ww + 0.1), [W - 0.012, WIN.y0 - 0.05, zc]);                             // apron
    // architrave
    add(M.trim, box(0.02, 0.07, ww + 0.14), [W - 0.01, WIN.y1 + 0.035, zc]);
    add(M.trim, box(0.02, wh, 0.07), [W - 0.01, yc, WIN.z0 - 0.035]);
    add(M.trim, box(0.02, wh, 0.07), [W - 0.01, yc, WIN.z1 + 0.035]);
    // sash frame at x = 2.60
    const fx = W + 0.1, fw = 0.05;
    add(M.white, box(0.05, fw, ww), [fx, WIN.y1 - fw / 2, zc]);
    add(M.white, box(0.05, fw, ww), [fx, WIN.y0 + fw / 2, zc]);
    add(M.white, box(0.05, wh, fw), [fx, yc, WIN.z0 + fw / 2]);
    add(M.white, box(0.05, wh, fw), [fx, yc, WIN.z1 - fw / 2]);
    add(M.white, box(0.04, wh, 0.035), [fx, yc, zc]);
    add(M.white, box(0.04, 0.035, ww), [fx, yc, zc]);
    add(M.brass, box(0.03, 0.015, 0.05), [fx - 0.035, yc + 0.03, zc + 0.12]);
    // below-sill outside of the reveal (bottom): the sill board inside the reveal
    add(M.white, new THREE.PlaneGeometry(t, ww), [xm, WIN.y0 + 0.001, zc], [-PI / 2, 0, 0]);
  }
  // door: frame, leaf, handle, kick plate, a sign
  {
    const dw = DOOR.x1 - DOOR.x0, dc = (DOOR.x0 + DOOR.x1) / 2;
    add(M.trim, box(0.07, DOOR.y1 + 0.07, 0.02), [DOOR.x0 - 0.035, (DOOR.y1 + 0.07) / 2, D - 0.01]);
    add(M.trim, box(0.07, DOOR.y1 + 0.07, 0.02), [DOOR.x1 + 0.035, (DOOR.y1 + 0.07) / 2, D - 0.01]);
    add(M.trim, box(dw + 0.14, 0.07, 0.02), [dc, DOOR.y1 + 0.035, D - 0.01]);
    // reveal
    add(M.paint, new THREE.PlaneGeometry(0.16, DOOR.y1), [DOOR.x0, DOOR.y1 / 2, D + 0.08], [0, PI / 2, 0]);
    add(M.paint, new THREE.PlaneGeometry(0.16, DOOR.y1), [DOOR.x1, DOOR.y1 / 2, D + 0.08], [0, -PI / 2, 0]);
    add(M.paint, new THREE.PlaneGeometry(dw, 0.16), [dc, DOOR.y1, D + 0.08], [PI / 2, 0, 0]);
    // the leaf, with raised panels
    add(M.door, box(dw - 0.01, DOOR.y1 - 0.01, 0.045), [dc, DOOR.y1 / 2, D + 0.04], [0, 0, 0], 1, { uv: 'world', tile: [1, 1] });
    for (const [py, ph] of [[1.45, 0.8], [0.55, 0.75]]) {
      add(M.door, rbox(dw - 0.22, ph, 0.012, 0.004), [dc, py, D + 0.012], [0, 0, 0], 1, { uv: 'world', tile: [1, 1] });
    }
    add(M.steel, box(dw - 0.06, 0.2, 0.004), [dc, 0.12, D + 0.016]);
    add(M.steel, cyl(0.03, 0.03, 0.012, 16), [DOOR.x1 - 0.09, 1.0, D + 0.012], [PI / 2, 0, 0]);
    add(M.steel, rbox(0.12, 0.02, 0.02, 0.008), [DOOR.x1 - 0.14, 1.0, D - 0.03]);
    add(M.steel, cyl(0.009, 0.009, 0.05, 8), [DOOR.x1 - 0.09, 1.0, D - 0.005], [PI / 2, 0, 0]);
    add(M.sign, quad(0.2, 0.25), [dc, 1.58, D + 0.0115], [0, PI, 0]);
    // light switch
    add(M.white, rbox(0.08, 0.12, 0.012, 0.004), [DOOR.x0 - 0.2, 1.2, D - 0.006]);
  }

  // -------------------------------------------------------------------------
  // desk (top y 0.75, x -1.7..0.7, z -2..-1.25)
  // -------------------------------------------------------------------------
  const DESK = { x0: -1.7, x1: 0.7, z0: -2.0, z1: -1.25, y: 0.75 };
  {
    const dw = DESK.x1 - DESK.x0, dd = DESK.z1 - DESK.z0, cx = (DESK.x0 + DESK.x1) / 2, cz = (DESK.z0 + DESK.z1) / 2;
    const top = box(dw, 0.035, dd);
    add(M.desk, top, [cx, DESK.y - 0.0175, cz], [0, 0, 0], 1, { uv: 'world', tile: [2.4, 1.2] });
    add(M.black, box(dw, 0.036, 0.004), [cx, DESK.y - 0.0175, DESK.z1 + 0.002]);          // edge band
    // left pedestal with three drawers
    const px0 = -1.68, px1 = -1.24, pc = (px0 + px1) / 2, pw = px1 - px0;
    add(M.enamel, box(pw, 0.7, 0.68), [pc, 0.36, -1.62], [0, 0, 0], 1, { uv: 'world', tile: [0.6, 0.6] });
    for (let i = 0; i < 3; i++) {
      const y = 0.6 - i * 0.215;
      add(M.enamel, rbox(pw - 0.03, 0.2, 0.02, 0.006), [pc, y, -1.275], [0, 0, 0], 1, { uv: 'world', tile: [0.6, 0.6] });
      add(M.steel, rbox(0.12, 0.018, 0.025, 0.006), [pc, y + 0.05, -1.255]);
      add(M.white, box(0.07, 0.03, 0.002), [pc, y - 0.02, -1.264]);
    }
    add(M.black, box(pw, 0.03, 0.66), [pc, 0.015, -1.62]);
    // right side panel + modesty panel
    add(M.enamel, box(0.035, 0.715, 0.7), [0.665, 0.3575, -1.62], [0, 0, 0], 1, { uv: 'world', tile: [0.6, 0.6] });
    add(M.enamel, box(1.9, 0.45, 0.02), [-0.29, 0.48, -1.96], [0, 0, 0], 1, { uv: 'world', tile: [0.6, 0.6] });
    add(M.black, box(0.05, 0.02, 0.7), [0.665, 0.01, -1.62]);
  }

  // -------------------------------------------------------------------------
  // monitors (screens come from screens.js)
  // -------------------------------------------------------------------------
  const SCR = { c: new V3(-0.5, 1.12, -1.70), w: 0.62, h: 0.35 };
  {
    // main: charcoal widescreen, deep tapered back (CRT-ish)
    at([SCR.c.x, SCR.c.y, SCR.c.z], [0, 0, 0], () => {
      const bw = SCR.w + 0.1, bh = SCR.h + 0.1, bd = 0.055;
      // bezel: four rounded bars
      add(M.charcoal, rbox(bw, 0.05, bd, 0.012), [0, SCR.h / 2 + 0.025, -0.02]);
      add(M.charcoal, rbox(bw, 0.05, bd, 0.012), [0, -SCR.h / 2 - 0.025, -0.02]);
      add(M.charcoal, rbox(0.05, bh, bd, 0.012), [-SCR.w / 2 - 0.025, 0, -0.02]);
      add(M.charcoal, rbox(0.05, bh, bd, 0.012), [SCR.w / 2 + 0.025, 0, -0.02]);
      // inner bevel (dark)
      add(M.black, box(SCR.w + 0.012, SCR.h + 0.012, 0.01), [0, 0, -0.022]);
      // tapered housing
      const g = box(bw - 0.02, bh - 0.02, 0.24);
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) if (p.getZ(i) < 0) { p.setX(i, p.getX(i) * 0.6); p.setY(i, p.getY(i) * 0.62 + 0.02); }
      g.computeVertexNormals();
      add(M.charcoal, g, [0, 0, -0.165]);
      // vents on the back
      for (let k = 0; k < 8; k++) add(M.black, box(0.3, 0.006, 0.002), [0, 0.1 - k * 0.02, -0.282], [0.35, 0, 0]);
      // neck + base
      add(M.charcoal, rbox(0.08, 0.16, 0.06, 0.01), [0, -0.29, -0.12]);
      add(M.charcoal, rbox(0.3, 0.022, 0.22, 0.008), [0, -SCR.c.y + DESK.y + 0.011, -0.1]);
      // buttons + badge
      for (let k = 0; k < 4; k++) add(M.black, rbox(0.014, 0.008, 0.006, 0.002), [SCR.w / 2 - 0.02 - k * 0.025, -SCR.h / 2 - 0.03, 0.009]);
      add(M.steel, box(0.06, 0.008, 0.002), [0, -SCR.h / 2 - 0.028, 0.008]);
    });
    // second: beige 4:3 CRT on two binders, angled toward the chair
    at([-1.3, DESK.y, -1.7], [0, 0.46, 0], () => {
      add(M.navy, rbox(0.34, 0.035, 0.28, 0.004), [0, 0.0175, 0]);
      add(M.red, rbox(0.33, 0.03, 0.27, 0.004), [0.005, 0.05, 0.005], [0, 0.03, 0]);
      const y0 = 0.065;
      add(M.beige, rbox(0.3, 0.025, 0.26, 0.01), [0, y0 + 0.0125, -0.02]);
      add(M.beige, cyl(0.1, 0.12, 0.03, 20), [0, y0 + 0.035, -0.04]);
      const cy = y0 + 0.23;
      add(M.beige, rbox(0.43, 0.35, 0.05, 0.02), [0, cy, 0.0]);
      const g = box(0.4, 0.32, 0.32);
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) if (p.getZ(i) < 0) { p.setX(i, p.getX(i) * 0.55); p.setY(i, p.getY(i) * 0.6 - 0.02); }
      g.computeVertexNormals();
      add(M.beige, g, [0, cy, -0.18]);
      add(M.black, box(0.36, 0.27, 0.004), [0, cy + 0.01, 0.024]);
      add(M.black, rbox(0.025, 0.012, 0.008, 0.003), [0.16, cy - 0.155, 0.026]);
    });
  }
  // screen meshes
  const mainScreen = new THREE.Mesh((() => {
    const g = new THREE.PlaneGeometry(SCR.w, SCR.h, 24, 14);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { const u = p.getX(i) / (SCR.w / 2), v = p.getY(i) / (SCR.h / 2); p.setZ(i, -0.012 * (u * u + v * v) * 0.5); }
    g.computeVertexNormals();
    return g;
  })(), screens.mainMaterial);
  mainScreen.position.copy(SCR.c);
  mainScreen.name = 'mainScreen';
  root.add(mainScreen);
  const secondScreen = new THREE.Mesh((() => {
    const g = new THREE.PlaneGeometry(0.335, 0.25, 12, 10);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { const u = p.getX(i) / 0.17, v = p.getY(i) / 0.125; p.setZ(i, 0.012 * (1 - 0.5 * (u * u + v * v))); }
    g.computeVertexNormals();
    return g;
  })(), screens.secondMaterial);
  {
    const m = K.mat4([-1.3, DESK.y, -1.7], [0, 0.46, 0]).multiply(K.mat4([0, 0.065 + 0.23 + 0.01, 0.026]));
    secondScreen.applyMatrix4(m);
  }
  root.add(secondScreen);

  // -------------------------------------------------------------------------
  // desk dressing: keyboard, mouse, papers, mugs, lamp, receiver
  // -------------------------------------------------------------------------
  // keyboard
  at([-0.5, DESK.y, -1.43], [0.07, 0, 0], () => {
    const g = box(0.46, 0.028, 0.165);
    K.boxUVAll(g, 0.0, 0.0, 0.02, 0.02);
    K.boxFaceUV(g, 2, 0, 0, 1, 1);
    add(M.keyboard, g, [0, 0.016, 0]);
    add(M.beige, rbox(0.47, 0.018, 0.175, 0.006), [0, 0.006, 0]);
  });
  // mouse + pad
  add(M.navy, rbox(0.23, 0.004, 0.19, 0.002), [-0.1, DESK.y + 0.002, -1.42], [0, 0.08, 0]);
  {
    const g = new THREE.SphereGeometry(0.05, 16, 10);
    g.scale(0.62, 0.38, 1.0);
    add(M.beige, g, [-0.085, DESK.y + 0.02, -1.41], [0, 0.25, 0]);
  }
  // papers: loose sheets (atlas cells are 0.25 x 0.25 in uv)
  const cellUV = (i, j) => [i * 0.25 + 0.004, 1 - (j + 1) * 0.25 + 0.004, (i + 1) * 0.25 - 0.004, 1 - j * 0.25 - 0.004];
  // a sheet of paper with a slight curl (lies in xz, faces up)
  const sheetGeo = (w, h, uvr, curl = 0.006, seed = 1) => {
    const g = quad(w, h, uvr, [6, 8]);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i) / (w / 2), y = p.getY(i) / (h / 2);
      p.setZ(i, curl * (Math.pow(Math.abs(x), 3) * (0.6 + 0.4 * Math.sin(seed * 3.1)) + Math.pow(Math.max(0, y * Math.cos(seed)), 4) + 0.3 * Math.max(0, x * y * Math.sin(seed * 1.7))));
    }
    g.computeVertexNormals();
    return g;
  };
  const sheet = (i, j, pos, rot, w = 0.21, h = 0.297, curl = 0.006) => add(M.paper, sheetGeo(w, h, cellUV(i, j), curl, i * 7 + j * 3 + rot), pos, [-PI / 2, 0, rot]);
  sheet(0, 0, [-0.98, DESK.y + 0.031, -1.5], 0.12, 0.21, 0.297, 0.004);          // observing log on the stack
  sheet(2, 0, [-1.02, DESK.y + 0.034, -1.47], -0.06, 0.21, 0.297, 0.008);        // memo
  { const g = box(0.215, 0.028, 0.3); K.boxUVAll(g, 0.005, 0.76, 0.06, 0.99); add(M.paper, g, [-1.0, DESK.y + 0.015, -1.49], [0, 0.03, 0]); }   // the stack under them
  sheet(0, 1, [0.14, DESK.y + 0.003, -1.36], -0.35, 0.216, 0.28, 0.01);          // legal pad by the mug
  sheet(1, 0, [-0.3, DESK.y + 0.003, -1.33], 0.25, 0.21, 0.297, 0.012);          // spectrum plot
  sheet(3, 0, [-0.72, DESK.y + 0.005, -1.34], 1.3, 0.21, 0.297, 0.01);           // the hex dump with the red circle
  sheet(1, 1, [-1.5, DESK.y + 0.002, -1.33], -0.2, 0.21, 0.297, 0.01);           // graph paper
  sheet(2, 1, [0.47, DESK.y + 0.063, -1.62], 0.2, 0.127, 0.076, 0.002);          // index card on the manuals
  // sticky notes on the main bezel and the desk
  for (const [i, x, y, r] of [[0, SCR.w / 2 + 0.03, 0.08, 0.1], [2, SCR.w / 2 + 0.028, -0.03, -0.12], [1, -SCR.w / 2 - 0.02, SCR.h / 2 + 0.02, 0.15]]) {
    add(M.paper, quad(0.065, 0.065, cellUV(i, 2)), [SCR.c.x + x, SCR.c.y + y, SCR.c.z + 0.012], [0, 0, r]);
  }
  add(M.paper, box(0.075, 0.02, 0.075), [0.3, DESK.y + 0.01, -1.33], [0, 0.3, 0]);
  sheet(3, 2, [0.3, DESK.y + 0.0205, -1.33], 0.3, 0.075, 0.075);
  // greenbar printout: a stack, and a run spilling over the desk edge to the floor
  {
    add(M.greenbar, box(0.3, 0.05, 0.24), [-1.47, DESK.y + 0.025, -1.52], [0, -0.1, 0]);
    const N = 60, w = 0.28;
    const pts = [];
    // along the desk toward the front edge, over it, down in a sagging loop to the floor, folded pile
    const path = new THREE.CatmullRomCurve3([
      new V3(-1.47, DESK.y + 0.052, -1.6), new V3(-1.44, DESK.y + 0.012, -1.38), new V3(-1.42, DESK.y + 0.004, -1.28),
      new V3(-1.41, DESK.y - 0.03, -1.215), new V3(-1.39, 0.45, -1.15), new V3(-1.35, 0.15, -1.02), new V3(-1.3, 0.02, -0.86),
      new V3(-1.26, 0.01, -0.7),
    ]);
    const pos = [], uv = [], idx = [];
    for (let i = 0; i <= N; i++) {
      const u = i / N, p = path.getPoint(u), tg = path.getTangent(u);
      const side = new V3(1, 0, 0.12).normalize();
      const wav = 0.006 * Math.sin(u * 40);
      for (const s of [-1, 1]) {
        pos.push(p.x + side.x * s * w / 2, p.y + wav * s, p.z + side.z * s * w / 2);
        uv.push(s < 0 ? 0 : 1, u * 3.2);
      }
      if (i < N) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    add(M.greenbar, g);
    // folded pile on the floor
    for (let k = 0; k < 6; k++) add(M.greenbar, quad(0.28, 0.3, [0, 0.1 * k, 1, 0.1 * k + 0.3]), [-1.26 + (k % 2) * 0.01, 0.004 + k * 0.004, -0.55 + (k % 2) * 0.02], [-PI / 2, 0, 0.05 * (k % 3)]);
  }
  // mugs
  // mug atlas: 4 cells of 0.5 x 0.5 (uv); in each, the top 1/8 of the atlas height is the stained inside
  function mugGeo(which, seg = 24) {
    const prof = [[0, 0], [0.036, 0], [0.039, 0.004], [0.041, 0.09], [0.0405, 0.096], [0.037, 0.096], [0.036, 0.09], [0.035, 0.01], [0, 0.01]].map(([r, y]) => new THREE.Vector2(r, y));
    const g = new THREE.LatheGeometry(prof, seg);
    const uv = g.attributes.uv;
    const u0 = (which % 2) * 0.5, vTop = 1 - Math.floor(which / 2) * 0.5, vBot = vTop - 0.5, vIn = vTop - 0.125;
    for (let i = 0; i < uv.count; i++) {
      const v = uv.getY(i);
      const vv = v <= 3 / 8 + 1e-3 ? vBot + 0.01 + (v / (3 / 8)) * (vIn - vBot - 0.02) : vTop - 0.005 - (v - 4 / 8) / (4 / 8) * 0.115;
      uv.setXY(i, u0 + uv.getX(i) * 0.5, vv);
    }
    return { g, u0, vBot };
  }
  function mug(x, z, which, fill = 0.07, handleRot = 0, y = DESK.y) {
    const { g, u0, vBot } = mugGeo(which);
    at([x, y, z], [0, handleRot, 0], () => {
      add(M.mugs, g);
      const h = new THREE.TorusGeometry(0.024, 0.0065, 6, 12, PI);
      const uvh = h.attributes.uv; for (let i = 0; i < uvh.count; i++) uvh.setXY(i, u0 + 0.01, vBot + 0.02);
      add(M.mugs, h, [0.041, 0.05, 0], [0, 0, -PI / 2]);
      if (fill > 0) add(M.coffee, new THREE.CircleGeometry(0.035, 20), [0, fill, 0], [-PI / 2, 0, 0]);
    });
  }
  mug(0.06, -1.47, 0, 0.078, 0.4);           // Sam's, steaming
  mug(-1.58, -1.36, 2, 0.04, 2.2);           // cold one by the second monitor
  mug(-0.94, -1.86, 1, 0, 1.0);              // pen pot
  for (let k = 0; k < 5; k++) add(k % 2 ? M.red : M.black, cyl(0.004, 0.004, 0.15, 6), [-0.94 + (k - 2) * 0.008, DESK.y + 0.1, -1.86 + ((k * 7) % 3 - 1) * 0.008], [0.12 * (k - 2), 0, 0.1 * ((k * 3) % 4 - 1.5)]);
  // a calculator and a pencil
  add(M.charcoal, rbox(0.085, 0.015, 0.15, 0.004), [0.35, DESK.y + 0.008, -1.55], [0, -0.2, 0]);
  add(M.beige, box(0.07, 0.002, 0.04), [0.35, DESK.y + 0.017, -1.6], [0, -0.2, 0]);
  add(M.darkWood, cyl(0.0035, 0.0035, 0.17, 6), [-0.2, DESK.y + 0.004, -1.3], [0, 0, PI / 2 - 0.4]);
  // headphones? (Sam wears them). A set of manuals and a coiled cable instead.
  add(M.navy, rbox(0.22, 0.04, 0.29, 0.004), [0.52, DESK.y + 0.02, -1.62], [0, 0.15, 0]);
  add(M.white, rbox(0.21, 0.03, 0.28, 0.004), [0.52, DESK.y + 0.055, -1.62], [0, 0.1, 0]);

  // desk lamp (anglepoise): base on the desk, head over the keyboard/mug area
  const LAMP = { base: new V3(0.48, DESK.y, -1.8), elbow: new V3(0.45, 1.34, -1.74), head: new V3(0.2, 1.3, -1.52), aim: new V3(-0.32, DESK.y, -1.4) };
  const lampAxis = LAMP.aim.clone().sub(LAMP.head).normalize();
  {
    add(M.lampGreen, cyl(0.07, 0.08, 0.025, 28), [LAMP.base.x, DESK.y + 0.0125, LAMP.base.z]);
    add(M.lampGreen, cyl(0.025, 0.03, 0.04, 16), [LAMP.base.x, DESK.y + 0.045, LAMP.base.z]);
    const pivot = [LAMP.base.x, DESK.y + 0.06, LAMP.base.z];
    for (const s of [-1, 1]) {
      add(M.steel, rod([pivot[0] + 0.012 * s, pivot[1], pivot[2]], [LAMP.elbow.x + 0.012 * s, LAMP.elbow.y, LAMP.elbow.z], 0.005));
      add(M.steel, rod([LAMP.elbow.x + 0.012 * s, LAMP.elbow.y, LAMP.elbow.z], [LAMP.head.x + 0.012 * s, LAMP.head.y + 0.03, LAMP.head.z], 0.005));
    }
    add(M.chrome, rod([pivot[0] - 0.03, pivot[1] + 0.05, pivot[2] + 0.01], [LAMP.elbow.x - 0.03, LAMP.elbow.y - 0.12, LAMP.elbow.z - 0.01], 0.006));   // spring
    add(M.lampGreen, cyl(0.016, 0.016, 0.04, 12), [LAMP.elbow.x, LAMP.elbow.y, LAMP.elbow.z], [0, 0, PI / 2]);
    // shade: a cone opening along the lamp axis
    const q = new THREE.Quaternion().setFromUnitVectors(new V3(0, -1, 0), lampAxis);
    const e = new THREE.Euler().setFromQuaternion(q);
    const prof = [[0.078, -0.13], [0.07, -0.11], [0.05, -0.05], [0.03, 0.0], [0.018, 0.02]].map(([r, y]) => new THREE.Vector2(r, y));
    add(M.lampGreen, new THREE.LatheGeometry(prof, 28), [LAMP.head.x, LAMP.head.y, LAMP.head.z], [e.x, e.y, e.z]);
    add(E.lampInner, new THREE.LatheGeometry(prof.map(v => new THREE.Vector2(v.x * 0.97, v.y)), 28), [LAMP.head.x, LAMP.head.y, LAMP.head.z], [e.x, e.y, e.z]);
    add(E.bulb, new THREE.SphereGeometry(0.026, 16, 10), [LAMP.head.x + lampAxis.x * 0.06, LAMP.head.y + lampAxis.y * 0.06, LAMP.head.z + lampAxis.z * 0.06]);
  }
  const bulbPos = LAMP.head.clone().addScaledVector(lampAxis, 0.06);

  // receiver: old valve communications set, right of the main monitor
  const RX = { c: new V3(0.12, DESK.y + 0.1, -1.83), w: 0.42, h: 0.2, d: 0.28 };
  let meterNeedle;
  {
    at([RX.c.x, RX.c.y, RX.c.z], [0, 0, 0], () => {
      const g = box(RX.w, RX.h, RX.d);
      K.boxUVAll(g, 0.02, 0.9, 0.05, 0.95);
      K.boxFaceUV(g, 4, 0, 0, 1, 1);
      add(M.receiver, g);
      add(M.rackMetal, box(RX.w + 0.01, 0.012, RX.d + 0.01), [0, RX.h / 2 + 0.006, 0]);
      for (const s of [-1, 1]) add(M.steel, rbox(0.02, 0.012, 0.06, 0.005), [s * 0.17, -RX.h / 2 - 0.006, 0.08]);
      // dial window: 40..340 x 30..110 on the 512x245 panel
      const fx = x => (x / 512 - 0.5) * RX.w, fy = y => (0.5 - y / 245) * RX.h;
      add(E.dial, quad(fx(340) - fx(40), fy(30) - fy(110)), [(fx(40) + fx(340)) / 2, (fy(30) + fy(110)) / 2, RX.d / 2 + 0.001]);
      add(E.meter, quad(fx(480) - fx(370), fy(30) - fy(110)), [(fx(370) + fx(480)) / 2, (fy(30) + fy(110)) / 2, RX.d / 2 + 0.001]);
      add(M.steel, box(fx(345) - fx(35), 0.004, 0.006), [(fx(40) + fx(340)) / 2, fy(114), RX.d / 2 + 0.003]);
      // knobs
      for (let i = 0; i < 6; i++) {
        const x = fx(62 + i * 80), y = fy(170);
        add(M.black, cyl(0.016, 0.018, 0.02, 18), [x, y, RX.d / 2 + 0.01], [PI / 2, 0, 0]);
        add(M.steel, cyl(0.012, 0.012, 0.003, 18), [x, y, RX.d / 2 + 0.021], [PI / 2, 0, 0]);
        add(M.white, box(0.002, 0.012, 0.002), [x, y + 0.006, RX.d / 2 + 0.0225], [0, 0, (i * 1.7) % 2 - 1]);
      }
      add(M.black, cyl(0.028, 0.03, 0.03, 24), [fx(420), fy(170), RX.d / 2 + 0.015], [PI / 2, 0, 0]);
      for (let i = 0; i < 3; i++) add(M.chrome, cyl(0.003, 0.003, 0.02, 6), [fx(360) + i * 0.02, fy(130), RX.d / 2 + 0.01], [PI / 2 - 0.4, 0, 0]);
    });
    meterNeedle = new THREE.Mesh(new THREE.BoxGeometry(0.0015, 0.05, 0.001).translate(0, 0.025, 0), new THREE.MeshBasicMaterial({ color: 0x201008 }));
    meterNeedle.position.set(RX.c.x + ((425 / 512) - 0.5) * RX.w, RX.c.y + (0.5 - 105 / 245) * RX.h, RX.c.z + RX.d / 2 + 0.003);
    root.add(meterNeedle);
  }

  // shelf above the monitors with binders, books, tape reels, a plant
  {
    const sy = 1.62, sz = -1.89;
    add(M.darkWood, box(1.6, 0.025, 0.22), [-0.2, sy, sz], [0, 0, 0], 1, { uv: 'world', tile: [0.5, 0.5] });
    for (const x of [-0.85, 0.45]) add(M.black, box(0.02, 0.12, 0.18), [x, sy - 0.07, sz]);
    // binders
    const bcols = [M.navy, M.red, M.black, M.navy, M.lampGreen, M.white, M.red];
    let x = -0.95;
    for (let i = 0; i < 7; i++) {
      const w = 0.05 + (i % 3) * 0.01;
      add(bcols[i], rbox(w, 0.3, 0.2, 0.004), [x + w / 2, sy + 0.1625, sz + 0.005], [0, 0, i === 6 ? -0.22 : 0]);
      add(M.white, box(0.022, 0.08, 0.002), [x + w / 2, sy + 0.2, sz + 0.106], [0, 0, i === 6 ? -0.22 : 0]);
      x += w + 0.003;
    }
    // books standing
    x = -0.45;
    for (let i = 0; i < 9; i++) {
      const w = 0.025 + ((i * 7) % 5) * 0.007, h = 0.18 + ((i * 3) % 4) * 0.025, s = (i * 5 + 3) % T.bookCount;
      const g = box(w, h, 0.16);
      K.boxUVAll(g, T.pagesU0 + 0.002, 0.05, 1 - 0.002, 0.95);
      K.boxFaceUV(g, 4, s * T.bookU + 0.001, 0.02, (s + 1) * T.bookU - 0.001, 0.98);
      for (const f of [0, 1]) K.boxFaceUV(g, f, (s + 0.24) * T.bookU, 0.3, (s + 0.33) * T.bookU, 0.6);
      add(M.books, g, [x + w / 2, sy + 0.0125 + h / 2, sz + 0.02]);
      x += w + 0.002;
    }
    // tape reels
    for (let i = 0; i < 4; i++) add(i % 2 ? M.black : M.charcoal, cyl(0.09, 0.09, 0.018, 28), [0.0 + 0.004 * i, sy + 0.022 + i * 0.019, sz], [0, i * 0.3, 0]);
    add(M.brass, cyl(0.03, 0.03, 0.08, 16), [0.0, sy + 0.1, sz]);
    // plant in a pot
    add(M.terracotta, cyl(0.055, 0.042, 0.09, 16), [0.3, sy + 0.057, sz]);
    for (let k = 0; k < 9; k++) {
      const a = k * 2.4, r = 0.02 + (k % 3) * 0.012;
      const g = new THREE.SphereGeometry(0.03, 8, 6); g.scale(0.6, 1.4, 0.6);
      add(M.plant, g, [0.3 + Math.cos(a) * r, sy + 0.14 + (k % 4) * 0.018, sz + Math.sin(a) * r], [Math.cos(a) * 0.4, 0, Math.sin(a) * 0.4]);
    }
  }

  // cork board on the back wall, above the second monitor; a calendar
  add(M.cork, quad(0.8, 0.5), [-1.36, 1.64, -D + 0.012]);
  add(M.darkWood, box(0.82, 0.52, 0.018), [-1.36, 1.64, -D + 0.002]);
  add(M.paper, quad(0.26, 0.26, cellUV(2, 3)), [0.72, 1.4, -D + 0.005], [0, 0, 0.02]);
  add(M.paper, quad(0.21, 0.297, cellUV(1, 3)), [-2.12, 1.45, -D + 0.004], [0, 0, -0.03]);

  // wall clock (hands animated)
  const CLOCK = new V3(0.72, 2.02, -D + 0.03);
  add(M.clock, new THREE.CircleGeometry(0.15, 40), [CLOCK.x, CLOCK.y, CLOCK.z]);
  add(M.black, new THREE.TorusGeometry(0.155, 0.012, 8, 40), [CLOCK.x, CLOCK.y, CLOCK.z]);
  add(M.black, cyl(0.155, 0.155, 0.03, 40, true), [CLOCK.x, CLOCK.y, CLOCK.z - 0.015], [PI / 2, 0, 0]);
  const hand = (len, w, mat, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, len, 0.002).translate(0, len / 2 - 0.02, 0), mat); m.position.set(CLOCK.x, CLOCK.y, CLOCK.z + z); root.add(m); return m; };
  const hHour = hand(0.085, 0.009, M.black, 0.004), hMin = hand(0.125, 0.006, M.black, 0.007), hSec = hand(0.135, 0.002, M.red, 0.01);

  // -------------------------------------------------------------------------
  // equipment rack with the alarm beacon (x 0.9..1.5, back wall)
  // -------------------------------------------------------------------------
  const RACK = { x0: 0.9, x1: 1.5, z0: -2.0, z1: -1.42, h: 1.86 };
  const RACK_TOP = () => RACK.h + 0.01;
  const leds = [];
  let scopeMesh, counterMesh;
  {
    const cx = (RACK.x0 + RACK.x1) / 2, w = RACK.x1 - RACK.x0, d = RACK.z1 - RACK.z0, cz = (RACK.z0 + RACK.z1) / 2;
    add(M.rackMetal, box(0.025, RACK.h, d), [RACK.x0 + 0.0125, RACK.h / 2, cz], [0, 0, 0], 1, { uv: 'world', tile: [0.5, 0.5] });
    add(M.rackMetal, box(0.025, RACK.h, d), [RACK.x1 - 0.0125, RACK.h / 2, cz], [0, 0, 0], 1, { uv: 'world', tile: [0.5, 0.5] });
    add(M.rackMetal, box(w, 0.03, d), [cx, RACK.h - 0.015, cz], [0, 0, 0], 1, { uv: 'world', tile: [0.5, 0.5] });
    add(M.black, box(w, 0.06, d), [cx, 0.03, cz]);
    add(M.rackFront, quad(w - 0.05, RACK.h - 0.12), [cx, 0.06 + (RACK.h - 0.12) / 2 + 0.0, RACK.z1 - 0.03]);
    // side vents
    for (let k = 0; k < 14; k++) add(M.black, box(0.002, 0.012, 0.3), [RACK.x0 - 0.001, 0.4 + k * 0.08, cz]);
    // units stand proud a little: handles
    const ys = [0.06 + (RACK.h - 0.12)];
    for (const [yy, hh] of [[20, 90], [110, 180], [290, 120], [410, 150], [560, 90], [650, 210], [860, 150], [1010, 250], [1260, 250]]) {
      const y = ys[0] - (yy + hh / 2) / 1536 * (RACK.h - 0.12);
      for (const s of [-1, 1]) add(M.steel, rbox(0.012, Math.min(0.1, hh / 1536 * 1.6), 0.03, 0.004), [cx + s * (w / 2 - 0.05), y, RACK.z1 - 0.012]);
    }
    const u2y = v => 0.06 + (RACK.h - 0.12) * (1 - v / 1536), u2x = u => cx + (u / 512 - 0.5) * (w - 0.05);
    // LEDs
    const addLed = (u, v, col, rate, duty, phase) => leds.push({ p: new V3(u2x(u), u2y(v), RACK.z1 - 0.026), col: new THREE.Color(col), rate, duty, phase });
    const lr = U.mulberry32(77);
    for (let i = 0; i < 12; i++) addLed(80 + i * 22, 520 + 60, i < 3 ? 0x30ff40 : i < 9 ? 0xffb020 : 0xff3020, 0.5 + lr() * 4, 0.3 + lr() * 0.5, lr());
    for (let i = 0; i < 8; i++) addLed(80 + i * 30, 660 + 10 + 200, 0x30ff40, 1 + lr() * 6, 0.5, lr());
    for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) addLed(90 + i * 105 + j * 20, 680 + 170, j ? 0x30ff40 : 0xffb020, 2 + lr() * 8, 0.4 + lr() * 0.4, lr());
    for (let i = 0; i < 6; i++) addLed(380 + (i % 3) * 25, 900 + Math.floor(i / 3) * 25, i === 0 ? 0xff3020 : 0x30ff40, 0.25 + lr(), 0.5, lr());
    for (let i = 0; i < 3; i++) addLed(60 + i * 30, 60, [0x30ff40, 0x30ff40, 0xffb020][i], 0, 1, 0);
    addLed(460, 1480, 0x30ff40, 0, 1, 0);
    addLed(430, 1480, 0xffb020, 0.5, 0.5, 0);
    // 3D controls on the units: knobs, toggles, BNC jacks and patch cords, tape reels
    const zf = RACK.z1 - 0.03;
    const knob = (u, v, r, mat = M.black) => { add(mat, cyl(r, r * 1.1, 0.014, 16), [u2x(u), u2y(v), zf + 0.007], [PI / 2, 0, 0]); add(M.chrome, cyl(r * 0.45, r * 0.45, 0.004, 12), [u2x(u), u2y(v), zf + 0.0155], [PI / 2, 0, 0]); add(M.white, box(0.0015, r * 0.8, 0.001), [u2x(u), u2y(v) + r * 0.45, zf + 0.016], [0, 0, (u * 0.37) % 2 - 1]); };
    for (let i = 0; i < 6; i++) knob(300 + (i % 3) * 60, 110 + 50 + Math.floor(i / 3) * 60, 0.011);
    for (let i = 0; i < 4; i++) knob(300 + i * 45, 410 + 115, 0.009);
    const toggle = (u, v, up) => { add(M.chrome, cyl(0.005, 0.005, 0.006, 10), [u2x(u), u2y(v), zf + 0.003], [PI / 2, 0, 0]); add(M.chrome, rod([u2x(u), u2y(v), zf + 0.005], [u2x(u), u2y(v) + (up ? 0.008 : -0.008), zf + 0.02], 0.0018, 6)); };
    for (let i = 0; i < 4; i++) toggle(360 + i * 30, 20 + 76, i !== 2);
    for (let i = 0; i < 3; i++) toggle(380 + i * 30, 290 + 104, i === 0);
    for (let i = 0; i < 16; i++) for (const vv of [560 + 30, 560 + 60]) add(M.chrome, cyl(0.0045, 0.0045, 0.012, 10), [u2x(150 + i * 20), u2y(vv), zf + 0.006], [PI / 2, 0, 0]);
    const cordCols = [M.red, M.navy, M.black, M.yellow, M.plant];
    for (let k = 0; k < 5; k++) {
      const a = 2 + ((k * 5) % 14), b = 3 + ((k * 7 + 3) % 13);
      const p0 = new V3(u2x(150 + a * 20), u2y(k % 2 ? 590 : 620), zf + 0.012), p1 = new V3(u2x(150 + b * 20), u2y(k % 2 ? 620 : 590), zf + 0.012);
      const mid = p0.clone().lerp(p1, 0.5).add(new V3(0, -0.05 - 0.02 * k, 0.03));
      add(cordCols[k], tube([p0.toArray(), [p0.x, p0.y - 0.01, p0.z + 0.012], mid.toArray(), [p1.x, p1.y - 0.01, p1.z + 0.012], p1.toArray()], 0.0028, 20));
    }
    add(M.black, rbox(0.02, 0.012, 0.008, 0.003), [u2x(440), u2y(1300), zf + 0.004]);
    add(M.red, rbox(0.028, 0.016, 0.01, 0.003), [u2x(440), u2y(1330), zf + 0.005]);
    // tape reels (turn while recording)
    const reels = [];
    for (const u of [140, 360]) {
      const g = new THREE.Group();
      g.position.set(u2x(u), u2y(1010 + 140), zf + 0.012);
      const rm = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.004, 40).rotateX(PI / 2), M.black);
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.034, 0.012, 20).rotateX(PI / 2), M.charcoal);
      const tape = new THREE.Mesh(new THREE.CylinderGeometry(u === 140 ? 0.07 : 0.05, u === 140 ? 0.07 : 0.05, 0.008, 36).rotateX(PI / 2), M.navy);
      g.add(rm, hub, tape);
      for (let k = 0; k < 3; k++) { const w = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.05, 0.006), M.steel); w.position.set(Math.cos(k * 2.094) * 0.055, Math.sin(k * 2.094) * 0.055, 0.004); w.rotation.z = k * 2.094 + PI / 2; g.add(w); }
      root.add(g);
      reels.push(g);
    }
    RACK.reels = reels;
    // scope + counter screens (canvas textures from screens.js)
    const [sx, sy, sw, sh] = T.rackLayout.oscope;
    scopeMesh = new THREE.Mesh(quad((sw / 512) * (w - 0.05), (sh / 1536) * (RACK.h - 0.12)), screens.scopeMaterial);
    scopeMesh.position.set(u2x(sx + sw / 2), u2y(sy + sh / 2), RACK.z1 - 0.028);
    root.add(scopeMesh);
    const [qx, qy, qw, qh] = T.rackLayout.counter;
    counterMesh = new THREE.Mesh(quad((qw / 512) * (w - 0.05), (qh / 1536) * (RACK.h - 0.12)), screens.counterMaterial);
    counterMesh.position.set(u2x(qx + qw / 2), u2y(qy + qh / 2), RACK.z1 - 0.028);
    root.add(counterMesh);
    // cables out of the top to a tray under the ceiling
    for (let k = 0; k < 3; k++) add(M.rubber, rod([cx - 0.1 + k * 0.05, RACK.h, RACK.z0 + 0.1], [cx - 0.1 + k * 0.05, H - 0.2, RACK.z0 + 0.1], 0.008));
    add(M.steel, box(0.2, 0.03, 2.3), [cx - 0.05, H - 0.22, -D + 0.1], [0, PI / 2, 0]);
  }
  const BEACON = new V3((RACK.x0 + RACK.x1) / 2, RACK.h, (RACK.z0 + RACK.z1) / 2 + 0.05);
  const beaconSpin = new THREE.Group();
  let beaconFlare;
  {
    // ribbed black base, clear red fresnel dome, a rotating mirror and bulb inside
    add(M.black, cyl(0.072, 0.078, 0.035, 28), [BEACON.x, BEACON.y + 0.0175, BEACON.z]);
    add(M.black, cyl(0.064, 0.068, 0.012, 28), [BEACON.x, BEACON.y + 0.041, BEACON.z]);
    for (let k = 0; k < 4; k++) add(M.steel, cyl(0.004, 0.004, 0.006, 8), [BEACON.x + Math.cos(k * 1.57 + 0.4) * 0.066, BEACON.y + 0.047, BEACON.z + Math.sin(k * 1.57 + 0.4) * 0.066]);
    const prof = [];
    for (let i = 0; i <= 12; i++) { const a = i / 12 * Math.PI / 2; prof.push(new THREE.Vector2(0.058 * Math.cos(a) + 0.0001, 0.085 + 0.058 * Math.sin(a))); }
    prof.unshift(new THREE.Vector2(0.058, 0.0));
    const dome = new THREE.Mesh(new THREE.LatheGeometry(prof, 36), E.beaconDome);
    dome.position.set(BEACON.x, BEACON.y + 0.047, BEACON.z);
    dome.renderOrder = 2;
    root.add(dome);
    beaconSpin.position.set(BEACON.x, BEACON.y + 0.047 + 0.07, BEACON.z);
    const refl = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.042, 0.075, 18, 1, true, -PI / 2, PI), new THREE.MeshPhongMaterial({ color: 0x802010, emissive: 0x401008, shininess: 120, specular: 0xffc0a0, side: THREE.DoubleSide }));
    beaconSpin.add(refl);
    const lampS = new THREE.Mesh(new THREE.SphereGeometry(0.013, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    lampS.name = 'beaconBulb';
    beaconSpin.add(lampS);
    root.add(beaconSpin);
    beaconFlare = new THREE.Sprite(new THREE.SpriteMaterial({ map: U.makeGlowTexture(THREE, 64, 0.2), color: 0xff2010, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }));
    beaconFlare.position.set(BEACON.x, BEACON.y + 0.12, BEACON.z);
    beaconFlare.scale.setScalar(0.35);
    beaconFlare.renderOrder = 5;
    root.add(beaconFlare);
  }
  const ledMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.0035, 8, 6), E.led, leds.length);
  {
    const m = new THREE.Matrix4();
    leds.forEach((l, i) => { m.makeTranslation(l.p.x, l.p.y, l.p.z); ledMesh.setMatrixAt(i, m); ledMesh.setColorAt(i, l.col); });
    root.add(ledMesh);
  }

  // back-right corner: the kitchenette — small fridge, kettle, coffee, mugs, a bin
  {
    const fx = 1.9, fz = -1.71;
    const g = box(0.55, 0.86, 0.56);
    K.boxUVAll(g, 0.9, 0.9, 0.95, 0.95);
    K.boxFaceUV(g, 4, 0, 0, 1, 1);
    add(M.fridge, g, [fx, 0.45, fz]);
    add(M.black, box(0.52, 0.02, 0.54), [fx, 0.01, fz]);
    add(M.steel, rbox(0.025, 0.25, 0.03, 0.01), [fx - 0.23, 0.62, fz + 0.29]);
    add(M.black, box(0.53, 0.005, 0.005), [fx, 0.75, fz + 0.281]);            // door gasket line
    // a tea towel over the handle
    add(M.navy, rbox(0.05, 0.22, 0.012, 0.004), [fx - 0.2, 0.52, fz + 0.305], [0, 0, 0.05]);
    add(M.white, box(0.052, 0.012, 0.013), [fx - 0.2, 0.48, fz + 0.306], [0, 0, 0.05]);
    // kettle on its base
    at([fx - 0.1, 0.88, fz + 0.02], [0, 2.3, 0], () => {
      const prof = [[0, 0], [0.08, 0], [0.085, 0.02], [0.085, 0.16], [0.065, 0.2], [0.03, 0.21], [0, 0.21]].map(([r, y]) => new THREE.Vector2(r, y));
      add(M.steel, new THREE.LatheGeometry(prof, 24));
      add(M.black, new THREE.TorusGeometry(0.07, 0.012, 8, 16, PI), [0, 0.19, 0], [0, PI / 2, 0]);
      add(M.steel, rod([0.08, 0.06, 0], [0.13, 0.17, 0], 0.012));
      add(M.black, cyl(0.1, 0.1, 0.015, 20), [0, -0.008, 0]);
      add(M.black, rod([-0.1, -0.008, 0], [-0.16, -0.012, 0.05], 0.004));
    });
    // coffee jar, sugar, a box of tea, two upturned mugs, a spoon
    add(M.glassGreen, cyl(0.045, 0.045, 0.12, 16), [fx + 0.1, 0.94, fz - 0.06]);
    add(M.brass, cyl(0.047, 0.047, 0.02, 16), [fx + 0.1, 1.01, fz - 0.06]);
    add(M.white, cyl(0.04, 0.04, 0.09, 16), [fx + 0.2, 0.925, fz + 0.03]);
    add(M.cardboard, box(0.16, 0.08, 0.08), [fx + 0.16, 0.92, fz + 0.16], [0, 0.3, 0]);
    mug(fx + 0.06, fz + 0.14, 1, 0, 0.7, 0.88);
    mug(fx - 0.2, fz - 0.16, 0, 0, 2.6, 0.88);
    add(M.steel, box(0.12, 0.003, 0.012), [fx + 0.02, 0.882, fz + 0.2], [0, 0.4, 0]);
    // bin with crumpled paper
    add(M.charcoal, cyl(0.13, 0.11, 0.32, 20, true), [2.33, 0.16, -1.25]);
    add(M.charcoal, cyl(0.11, 0.11, 0.01, 20), [2.33, 0.005, -1.25]);
    for (let k = 0; k < 4; k++) { const g2 = new THREE.IcosahedronGeometry(0.045, 1); const p2 = g2.attributes.position; for (let i = 0; i < p2.count; i++) { const f = 0.75 + 0.5 * U.vnoise3(p2.getX(i) * 60 + k, p2.getY(i) * 60, p2.getZ(i) * 60); p2.setXYZ(i, p2.getX(i) * f, p2.getY(i) * f, p2.getZ(i) * f); } g2.computeVertexNormals(); add(M.white, g2, [2.33 + (k % 2 - 0.5) * 0.08, 0.26 + (k > 1 ? 0.05 : 0), -1.25 + (k - 1.5) * 0.04], [k, k * 2, 0]); }
  }

  // back-left corner: filing cabinet with boxes and an old desk fan on top
  {
    const fx = -2.19, fz = -1.69, fw = 0.54;
    add(M.enamel, box(fw, 1.32, 0.6), [fx, 0.66, fz], [0, 0, 0], 1, { uv: 'world', tile: [0.6, 0.6] });
    for (let i = 0; i < 4; i++) {
      const y = 1.16 - i * 0.31;
      add(M.enamel, rbox(fw - 0.03, 0.29, 0.02, 0.006), [fx, y, fz + 0.305], [0, 0, 0], 1, { uv: 'world', tile: [0.6, 0.6] });
      add(M.steel, rbox(0.14, 0.02, 0.03, 0.008), [fx, y + 0.06, fz + 0.325]);
      add(M.white, box(0.09, 0.04, 0.002), [fx, y + 0.1, fz + 0.316]);
    }
    add(M.cardboard, box(0.4, 0.26, 0.34), [fx + 0.02, 1.45, fz - 0.05], [0, 0.12, 0]);
    add(M.cardboard, box(0.3, 0.16, 0.26), [fx - 0.02, 1.66, fz - 0.06], [0, -0.1, 0]);
    // fan
    at([fx + 0.05, 1.32, fz + 0.2], [0, 0.6, 0], () => {
      add(M.lampGreen, cyl(0.07, 0.08, 0.03, 20), [0, 0.015, 0]);
      add(M.lampGreen, cyl(0.012, 0.012, 0.15, 8), [0, 0.1, 0]);
      add(M.lampGreen, cyl(0.045, 0.04, 0.09, 16), [0, 0.2, -0.03], [PI / 2, 0, 0]);
      add(M.steel, new THREE.TorusGeometry(0.12, 0.004, 6, 32), [0, 0.2, 0.04]);
      for (let k = 0; k < 8; k++) add(M.steel, rod([0, 0.2, 0.045], [Math.cos(k * PI / 4) * 0.12, 0.2 + Math.sin(k * PI / 4) * 0.12, 0.04], 0.0015, 4));
      for (let k = 0; k < 3; k++) { const g = new THREE.CircleGeometry(0.05, 10, 0, 0.9); add(M.brass, g, [0, 0.2, 0.03], [0, 0, k * 2.094]); }
    });
  }

  // left wall bookshelf (x -2.5..-2.2, z -1.15..-0.15)
  {
    const bx = -2.33, z0 = -1.15, z1 = -0.15, bd = 0.3, hh = 1.9;
    const shelves = [0.08, 0.44, 0.8, 1.16, 1.52, 1.88];
    add(M.darkWood, box(bd, hh, 0.02), [bx, hh / 2, z0 + 0.01], [0, 0, 0], 1, { uv: 'world', tile: [0.5, 0.5] });
    add(M.darkWood, box(bd, hh, 0.02), [bx, hh / 2, z1 - 0.01], [0, 0, 0], 1, { uv: 'world', tile: [0.5, 0.5] });
    add(M.darkWood, box(0.01, hh, z1 - z0), [-W + 0.005, hh / 2, (z0 + z1) / 2]);
    for (const y of shelves) add(M.darkWood, box(bd, 0.02, z1 - z0 - 0.04), [bx, y, (z0 + z1) / 2], [0, 0, 0], 1, { uv: 'world', tile: [0.5, 0.5] });
    const br = U.mulberry32(99);
    for (let s = 0; s < 5; s++) {
      const y = shelves[s] + 0.01;
      let z = z0 + 0.03;
      const lim = z1 - 0.03;
      while (z < lim - 0.03) {
        const r = br();
        if (r < 0.06) { z += 0.04 + br() * 0.06; continue; }
        if (r < 0.14 && lim - z > 0.25) {       // a lying stack
          let yy = y;
          for (let k = 0; k < 2 + Math.floor(br() * 3); k++) {
            const th = 0.025 + br() * 0.025, s2 = Math.floor(br() * T.bookCount);
            const g = box(0.2 + br() * 0.04, th, 0.15 + br() * 0.05);
            K.boxUVAll(g, T.pagesU0 + 0.002, 0.05, 1 - 0.002, 0.95);
            // spine faces the room (+x): rotate the spine strip to run along the lying book
            { const uv = g.attributes.uv; const u0 = s2 * T.bookU + 0.001, u1 = (s2 + 1) * T.bookU - 0.001; uv.setXY(0, u0, 0.02); uv.setXY(1, u0, 0.98); uv.setXY(2, u1, 0.02); uv.setXY(3, u1, 0.98); }
            for (const f of [2, 3]) K.boxFaceUV(g, f, (s2 + 0.24) * T.bookU, 0.3, (s2 + 0.33) * T.bookU, 0.6);
            add(M.books, g, [bx + 0.01, yy + th / 2, z + 0.1], [0, (br() - 0.5) * 0.3, 0]);
            yy += th;
          }
          z += 0.24;
          continue;
        }
        const t = 0.02 + br() * 0.045, h = 0.17 + br() * 0.14, dd = 0.14 + br() * 0.1, s2 = Math.floor(br() * T.bookCount);
        const g = box(dd, h, t);
        K.boxUVAll(g, T.pagesU0 + 0.002, 0.05, 1 - 0.002, 0.95);
        // +x face: u runs along -z, v along y; rotate so the spine text runs up the book
        { const uv = g.attributes.uv; const u0 = s2 * T.bookU + 0.001, u1 = (s2 + 1) * T.bookU - 0.001; uv.setXY(0, u0, 0.98); uv.setXY(1, u1, 0.98); uv.setXY(2, u0, 0.02); uv.setXY(3, u1, 0.02); }
        for (const f of [4, 5]) K.boxFaceUV(g, f, (s2 + 0.24) * T.bookU, 0.3, (s2 + 0.33) * T.bookU, 0.6);
        const lean = (z + t > lim - 0.05 || br() < 0.05) ? 0.25 : 0;
        add(M.books, g, [-W + 0.02 + (bd - 0.02) - dd / 2 - 0.005, y + h / 2 * Math.cos(lean), z + t / 2 + (lean ? h * 0.12 : 0)], [lean, 0, 0]);
        z += t + 0.002 + (lean ? h * 0.25 : 0);
      }
    }
    // a small globe and a framed photo on top
    add(M.navy, new THREE.SphereGeometry(0.1, 20, 14), [bx, 1.89 + 0.18, -0.4]);
    add(M.brass, new THREE.TorusGeometry(0.11, 0.004, 6, 30, PI * 1.2), [bx, 1.89 + 0.18, -0.4], [0, PI / 2, 0.3]);
    add(M.darkWood, cyl(0.05, 0.06, 0.03, 16), [bx, 1.905, -0.4]);
    add(M.darkWood, box(0.02, 0.2, 0.26), [bx - 0.05, 1.99, -0.85], [0, 0, 0.08]);
    add(M.paper, quad(0.22, 0.17, cellUV(3, 1)), [bx - 0.038, 1.995, -0.85], [0, PI / 2, 0.08]);
  }
  // left wall: poster above the armchair side, and a framed star chart
  add(M.poster2, quad(0.6, 0.6), [-W + 0.012, 1.62, 0.55], [0, PI / 2, 0]);
  add(M.black, box(0.016, 0.63, 0.63), [-W + 0.004, 1.62, 0.55]);

  // -------------------------------------------------------------------------
  // Maya's corner: armchair (static), blanket, side table, rug, floor lamp
  // -------------------------------------------------------------------------
  const ARM = { pos: new V3(-1.85, 0, 0.95), yaw: PI * 0.78 };
  at([ARM.pos.x, 0, ARM.pos.z], [0, ARM.yaw, 0], () => {
    const fab = { uv: 'world', tile: [0.4, 0.4] };
    for (const [x, z] of [[0.29, -0.02], [-0.29, -0.02], [0.24, -0.52], [-0.24, -0.52]]) add(M.darkWood, cyl(0.018, 0.012, 0.09, 8), [x, 0.045, z]);
    add(M.armFabric, rbox(0.72, 0.24, 0.58, 0.05, 3), [0, 0.2, -0.27], [0, 0, 0], 1, fab);
    // seat cushion with a sag where she sits
    {
      const g = rbox(0.5, 0.13, 0.55, 0.05, 3);
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i) / 0.25, z = p.getZ(i) / 0.275, y = p.getY(i);
        if (y > 0) p.setY(i, y - 0.018 * Math.max(0, 1 - x * x) * Math.max(0, 1 - z * z) - 0.01 * Math.max(0, z));
      }
      g.computeVertexNormals();
      add(M.armFabric, g, [0, 0.355, -0.235], [0, 0, 0], 1, fab);
    }
    // arms, toed in at the back (tub shape)
    for (const s of [-1, 1]) add(M.armFabric, rbox(0.11, 0.36, 0.6, 0.05, 3), [s * 0.305, 0.44, -0.26], [0, s * -0.16, 0], 1, fab);
    // curved tub back, reclined, with a rolled top edge and a loose back cushion
    at([0, 0.28, -0.16], [-0.24, 0, 0], () => {
      const th0 = -1.28, th1 = 1.28, hB = 0.62;
      for (const [r, side] of [[0.33, THREE.BackSide], [0.43, THREE.FrontSide]]) {
        const g = new THREE.CylinderGeometry(r, r, hB, 28, 3, true, Math.PI + th0, th1 - th0);
        const p = g.attributes.position;
        for (let i = 0; i < p.count; i++) { const y = p.getY(i); const k = 1 + 0.06 * (y / hB) + 0.03 * Math.sin(Math.atan2(p.getX(i), p.getZ(i)) * 6) * (r > 0.4 ? 1 : 0); p.setX(i, p.getX(i) * k); p.setZ(i, p.getZ(i) * k); }
        if (side === THREE.BackSide) { const idx = g.index.array; for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; } }
        g.computeVertexNormals();
        add(M.armFabric, g, [0, hB / 2, 0], [0, 0, 0], 1, fab);
      }
      // rolled top
      const tg = new THREE.TorusGeometry(0.38, 0.058, 10, 28, th1 - th0);
      add(M.armFabric, tg, [0, hB, 0], [PI / 2, 0, PI / 2 + th0 + PI], 1, fab);
      // end caps
      for (const s of [-1, 1]) {
        const a = s > 0 ? th1 : th0;
        add(M.armFabric, rbox(0.12, hB, 0.07, 0.03, 2), [Math.sin(a) * 0.38, hB / 2, -Math.cos(a) * 0.38], [0, -a, 0], 1, fab);
      }
      // loose back cushion
      const cg = rbox(0.46, 0.44, 0.13, 0.055, 3);
      const cp = cg.attributes.position;
      for (let i = 0; i < cp.count; i++) { const x = cp.getX(i) / 0.23, y = cp.getY(i) / 0.22; cp.setZ(i, cp.getZ(i) * (0.55 + 0.45 * (1 - 0.5 * x * x) * (1 - 0.5 * y * y)) - 0.05 * x * x); }
      cg.computeVertexNormals();
      add(M.armFabric, cg, [0, 0.3, -0.26], [0.04, 0, 0], 1, fab);
      for (const [x, y] of [[-0.1, 0.42], [0.1, 0.42], [0, 0.26]]) add(M.armFabric, new THREE.SphereGeometry(0.011, 8, 6), [x, y, -0.2]);
    });
    // piping along the cushion's front edge and the arm fronts; tufting buttons on the back
    const pipe = (pts, r = 0.007) => add(M.armFabric, tube(pts, r, 24));
    pipe([[-0.25, 0.405, 0.035], [0, 0.4, 0.045], [0.25, 0.405, 0.035]]);
    for (const s of [-1, 1]) pipe([[s * 0.305 + s * 0.045, 0.3, 0.045], [s * 0.305 + s * 0.05, 0.55, 0.045], [s * 0.305, 0.625, 0.045], [s * 0.305 - s * 0.05, 0.55, 0.045], [s * 0.305 - s * 0.045, 0.32, 0.045]], 0.006);
    // a squashed cushion against the left arm
    {
      const g = rbox(0.38, 0.34, 0.12, 0.06, 3);
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) { const x = p.getX(i) / 0.19, y = p.getY(i) / 0.17; p.setZ(i, p.getZ(i) * (0.35 + 0.65 * (1 - x * x * 0.6) * (1 - y * y * 0.6))); p.setY(i, p.getY(i) - 0.02 * x * x); }
      g.computeVertexNormals();
      add(M.blanket, g, [0.2, 0.56, -0.38], [-0.35, -1.0, 0.25], 1);
    }
    // crumpled knit throw, dumped over the right arm and spilling to the floor
    {
      const nx = 40, nz = 34, pos = [], uv = [], idx = [];
      const fb = (a, b, c) => U.fbm3(a, b, c, 3) - 0.5;
      for (let j = 0; j <= nz; j++) {
        for (let i = 0; i <= nx; i++) {
          const u = i / nx, v = j / nz;
          const s = (u - 0.38) * 1.05;          // across the arm (outward = +s)
          const zz = -0.52 + v * 0.7;
          const top = 0.64;
          let x = -0.305 - s, y = top + 0.014;
          const out = Math.max(0, s - 0.06), inn = Math.max(0, -s - 0.06);
          if (out > 0) { x = -0.305 - 0.06 - Math.min(out, 0.3) * 0.18 - 0.018 - Math.max(0, out - 0.3) * 0.5; y = top + 0.014 - Math.min(out, 0.62) * 0.95; }
          if (y < 0.012) y = 0.012 + 0.01 * Math.max(0, out - 0.62);
          if (inn > 0) { x = -0.305 + 0.06 + inn * 0.4; y = top + 0.014 - inn * 0.55; y = Math.max(y, 0.44 + 0.02 * Math.sin(v * 9)); }
          // folds and crumples
          const cr = fb(u * 5, v * 5, 1.3), cr2 = fb(u * 13, v * 11, 4.1);
          y += 0.045 * cr + 0.014 * cr2 + 0.014 * Math.sin(v * 17 + u * 6) * (0.4 + out * 3);
          x += 0.022 * fb(u * 4 + 7, v * 6, 2.2) * (0.3 + out * 3) + (0.012 + 0.03 * Math.min(out, 0.5)) * Math.sin(v * 26 + 1.3 * Math.sin(u * 5)) + 0.004 * Math.sin(v * 21);
          const zzz = zz + 0.03 * fb(u * 3, v * 3 + 5, 9.0) * (0.2 + out * 2);
          pos.push(x, y, zzz); uv.push(u * 1.6, v * 1.3);
          if (i < nx && j < nz) { const a = j * (nx + 1) + i; idx.push(a, a + nx + 1, a + 1, a + 1, a + nx + 1, a + nx + 2); }
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx); g.computeVertexNormals();
      add(M.blanket, g, [0, 0, 0], [0, -0.16, 0]);
    }
  });
  // side table with a book and glasses case; floor lamp (off); rug
  {
    const tx = -2.18, tz = 0.28;
    add(M.darkWood, cyl(0.2, 0.2, 0.025, 28), [tx, 0.55, tz]);
    add(M.darkWood, cyl(0.02, 0.025, 0.54, 10), [tx, 0.27, tz]);
    add(M.darkWood, cyl(0.14, 0.16, 0.02, 20), [tx, 0.01, tz]);
    add(M.red, rbox(0.15, 0.03, 0.22, 0.004), [tx + 0.02, 0.578, tz + 0.02], [0, 0.4, 0]);
    add(M.white, box(0.14, 0.022, 0.2), [tx + 0.02, 0.582, tz + 0.02], [0, 0.4, 0]);
    mugAt(tx - 0.08, tz - 0.08);
    add(M.brass, new THREE.TorusGeometry(0.03, 0.003, 6, 16), [tx + 0.1, 0.567, tz - 0.08], [PI / 2, 0, 0]);   // reading glasses (folded)
    add(M.brass, new THREE.TorusGeometry(0.03, 0.003, 6, 16), [tx + 0.1, 0.567, tz - 0.02], [PI / 2, 0, 0]);
    // floor lamp (on, low): brass stand, fabric drum shade
    add(M.brass, cyl(0.1, 0.12, 0.02, 20), [-2.28, 0.01, 1.78]);
    add(M.brass, cyl(0.01, 0.01, 1.45, 8), [-2.28, 0.74, 1.78]);
    add(M.brass, rod([-2.28, 1.38, 1.78], [-2.28, 1.4, 1.78], 0.012));
    add(E.shade, cyl(0.16, 0.2, 0.25, 28, true), [-2.28, 1.5, 1.78]);
    add(E.shadeIn, cyl(0.158, 0.198, 0.25, 28, true), [-2.28, 1.5, 1.78]);
    add(E.bulb2, new THREE.SphereGeometry(0.03, 12, 8), [-2.28, 1.44, 1.78]);
  }
  function mugAt(x, z) { mug(x, z, 3, 0.03, 2.0, 0.5625); }
  add(M.rug, box(1.7, 0.008, 1.25), [-1.55, 0.004, 0.95], [0, 0.12, 0]);

  // -------------------------------------------------------------------------
  // front wall: printer table with the dot-matrix printer; whiteboard, poster, coats; right wall: radiator, extinguisher, sign
  // -------------------------------------------------------------------------
  {
    const tx = 0.15, tz = 1.73;
    add(M.darkWood, box(0.8, 0.03, 0.46), [tx, 0.7, tz], [0, 0, 0], 1, { uv: 'world', tile: [0.5, 0.5] });
    for (const [dx, dz] of [[-0.37, -0.2], [0.37, -0.2], [-0.37, 0.2], [0.37, 0.2]]) add(M.steel, cyl(0.014, 0.014, 0.69, 8), [tx + dx, 0.345, tz + dz]);
    add(M.steel, box(0.76, 0.02, 0.42), [tx, 0.18, tz]);
    at([tx - 0.02, 0.715, tz], [0, PI + 0.05, 0], () => {
      add(M.beige2, rbox(0.5, 0.13, 0.34, 0.02), [0, 0.065, 0]);
      add(M.black, box(0.36, 0.012, 0.07), [0, 0.13, 0.06]);
      add(M.beige, cyl(0.022, 0.022, 0.03, 12), [0.27, 0.08, 0.05], [0, 0, PI / 2]);
      for (let k = 0; k < 3; k++) add(M.black, rbox(0.015, 0.008, 0.01, 0.002), [-0.17 + k * 0.025, 0.1, 0.171]);
      add(M.greenbar, quad(0.3, 0.26, [0, 0.2, 1, 0.45]), [0, 0.2, 0.1], [-0.25, 0, 0]);
    });
    add(M.cardboard, box(0.4, 0.2, 0.3), [tx + 0.05, 0.29, tz], [0, 0.1, 0]);
    add(M.greenbar, box(0.34, 0.1, 0.25), [tx + 0.05, 0.4, tz], [0, 0.1, 0]);
  }
  add(M.whiteboard, quad(0.9, 0.56), [-0.9, 1.4, D - 0.012], [0, PI, 0]);
  add(M.steel, box(0.94, 0.6, 0.012), [-0.9, 1.4, D - 0.005]);
  add(M.steel, box(0.9, 0.02, 0.05), [-0.9, 1.1, D - 0.03]);
  for (let k = 0; k < 3; k++) add([M.red, M.navy, M.black][k], cyl(0.008, 0.008, 0.11, 8), [-1.1 + k * 0.05, 1.12, D - 0.035], [0, 0, PI / 2]);
  add(M.poster, quad(0.4, 0.56), [0.6, 1.5, D - 0.004], [0, PI, 0]);
  // coats on hooks, right wall by the door
  add(M.darkWood, box(0.02, 0.08, 0.5), [W - 0.01, 1.72, 1.55]);
  for (const [z, mat, len] of [[1.4, M.coat, 0.92], [1.66, M.coat2, 0.78]]) {
    add(M.steel, rod([W - 0.02, 1.72, z], [W - 0.07, 1.74, z], 0.006));
    const prof = [[0.02, 0], [0.12, -0.08], [0.2, -0.18], [0.22, -0.4], [0.23, -len + 0.05], [0.2, -len]].map(([r, y]) => new THREE.Vector2(r, y));
    const g = new THREE.LatheGeometry(prof, 20);
    g.scale(0.55, 1, 1.0);
    add(mat, g, [W - 0.14, 1.74, z], [0, PI / 2, 0]);
  }
  // radiator under the window
  {
    const rz0 = -0.12, rz1 = 0.72;
    for (let z = rz0; z <= rz1; z += 0.045) add(M.white, rbox(0.07, 0.5, 0.03, 0.012), [W - 0.075, 0.38, z]);
    add(M.white, cyl(0.012, 0.012, rz1 - rz0 + 0.05, 8), [W - 0.075, 0.63, (rz0 + rz1) / 2], [PI / 2, 0, 0]);
    add(M.white, cyl(0.012, 0.012, rz1 - rz0 + 0.05, 8), [W - 0.075, 0.14, (rz0 + rz1) / 2], [PI / 2, 0, 0]);
    add(M.steel, cyl(0.01, 0.01, 0.13, 8), [W - 0.075, 0.065, rz0 - 0.03]);
  }
  add(M.sign, quad(0.2, 0.25), [W - 0.006, 1.5, -0.75], [0, -PI / 2, 0]);
  // fire extinguisher
  at([W - 0.12, 0, 1.05], [0, 0, 0], () => {
    add(M.red, cyl(0.07, 0.07, 0.42, 20), [0, 0.35, 0]);
    add(M.red, new THREE.SphereGeometry(0.07, 20, 8, 0, PI * 2, 0, PI / 2), [0, 0.56, 0]);
    add(M.black, rbox(0.05, 0.08, 0.04, 0.01), [0, 0.64, 0]);
    add(M.black, rod([0.02, 0.62, 0.05], [0.08, 0.35, 0.07], 0.008));
    add(M.white, quad(0.08, 0.14), [0, 0.35, 0.0705]);
    add(M.steel, box(0.06, 0.04, 0.02), [0.06, 0.62, 0], [0, 0, 0]);
  });

  // -------------------------------------------------------------------------
  // cables: bundles with ties, single runs, a power strip
  // -------------------------------------------------------------------------
  const tieMat = M.black;
  function bundle(pts, n = 4, r = 0.005, spread = 0.011, ties = 0.22, mats = [M.rubber, M.rubber, M.navy, M.rubber, M.white]) {
    const curve = new THREE.CatmullRomCurve3(pts.map(p => new V3(...p)));
    const len = curve.getLength(), N = Math.max(12, Math.round(len / 0.03));
    const frames = curve.computeFrenetFrames(N, false);
    for (let k = 0; k < n; k++) {
      const a = k / n * PI * 2 + 0.3, rr = k === 0 ? 0 : spread;
      const off = [];
      for (let i = 0; i <= N; i++) {
        const tw = a + i * 0.08;
        const pnt = curve.getPointAt(i / N).clone().addScaledVector(frames.normals[i], Math.cos(tw) * rr).addScaledVector(frames.binormals[i], Math.sin(tw) * rr);
        off.push([pnt.x, pnt.y, pnt.z]);
      }
      add(mats[k % mats.length], tube(off, r * (k === 0 ? 1.3 : 1), N));
    }
    for (let d = ties * 0.5; d < len; d += ties) {
      const u = d / len, pnt = curve.getPointAt(u), tg = curve.getTangentAt(u);
      const q = new THREE.Quaternion().setFromUnitVectors(new V3(0, 0, 1), tg);
      const e = new THREE.Euler().setFromQuaternion(q);
      add(tieMat, new THREE.TorusGeometry(spread + r + 0.002, 0.0022, 4, 10), [pnt.x, pnt.y, pnt.z], [e.x, e.y, e.z]);
      add(tieMat, box(0.006, 0.006, 0.008), [pnt.x + 0.0, pnt.y + spread + r + 0.004, pnt.z], [e.x, e.y, e.z]);
    }
  }
  bundle([[0.93, 0.08, -1.93], [0.8, 0.02, -1.95], [0.4, 0.02, -1.96], [0.0, 0.05, -1.965], [-0.2, 0.35, -1.97], [-0.3, 0.72, -1.96]], 5, 0.005, 0.012, 0.2);
  bundle([[-1.2, 0.72, -1.97], [-1.0, 0.42, -1.98], [-0.6, 0.34, -1.985], [-0.15, 0.4, -1.98], [0.15, 0.72, -1.97]], 4, 0.004, 0.009, 0.18);
  bundle([[1.2, RACK_TOP(), -1.9], [1.2, H - 0.24, -1.9], [0.2, H - 0.24, -1.9], [-1.2, H - 0.24, -1.9]], 3, 0.006, 0.013, 0.3);
  add(M.rubber, tube([[-0.5, 0.77, -1.5], [-0.52, 0.76, -1.62], [-0.55, 0.755, -1.75], [-0.6, 0.76, -1.9]], 0.003));
  add(M.rubber, tube([[0.48, 0.76, -1.85], [0.55, 0.74, -1.95], [0.62, 0.3, -1.98], [0.66, 0.02, -1.95], [0.8, 0.01, -1.9]], 0.004));
  add(M.rubber, tube([[-0.07, 0.76, -1.4], [-0.1, 0.755, -1.6], [-0.2, 0.76, -1.75], [-0.35, 0.76, -1.9]], 0.0025));
  add(M.white, rbox(0.35, 0.04, 0.06, 0.01), [-0.1, 0.02, -1.85], [0, 0.2, 0]);
  for (let k = 0; k < 4; k++) add(M.black, rbox(0.035, 0.03, 0.04, 0.006), [-0.2 + k * 0.07, 0.05, -1.85 + k * 0.014], [0, 0.2, 0]);
  add(M.red, box(0.012, 0.012, 0.012), [-0.29, 0.042, -1.87]);
  // an extension lead snaking to the printer
  add(M.charcoal, tube([[0.66, 0.012, -1.3], [0.9, 0.01, -0.6], [0.6, 0.01, 0.3], [0.5, 0.01, 1.2], [0.4, 0.01, 1.6]], 0.004, 60));

  // outlets: double socket plates, some with plugs
  function outlet(pos, ry, plugs = 0) {
    at(pos, [0, ry, 0], () => {
      add(M.white, rbox(0.15, 0.085, 0.012, 0.004), [0, 0, 0.006]);
      for (const sx of [-0.037, 0.037]) {
        add(M.black, box(0.022, 0.03, 0.002), [sx, 0.004, 0.0125]);
        add(M.white, rbox(0.012, 0.008, 0.004, 0.002), [sx + 0.02, -0.022, 0.013]);
      }
      for (let k = 0; k < plugs; k++) {
        const sx = k ? 0.037 : -0.037;
        add(M.black, rbox(0.03, 0.045, 0.026, 0.006), [sx, 0.0, 0.026]);
        add(M.rubber, tube([[sx, -0.02, 0.03], [sx + 0.005, -0.06, 0.035], [sx + 0.01, -0.2, 0.02]], 0.0035, 10));
      }
    });
  }
  outlet([-1.03, 0.9, -D], 0, 2);
  outlet([-W, 0.3, 0.05], PI / 2, 0);
  outlet([W, 0.3, -1.1], -PI / 2, 1);
  outlet([0.72, 0.3, D], PI, 1);
  outlet([2.25, 0.3, -D], 0, 1);
  // light switch toggle, thermostat, first-aid box
  add(M.white, box(0.012, 0.03, 0.012), [DOOR.x0 - 0.2, 1.2, D - 0.016], [0.3, 0, 0]);
  at([DOOR.x0 - 0.2, 1.5, D], [0, PI, 0], () => {
    add(M.beige, rbox(0.1, 0.13, 0.03, 0.01), [0, 0, 0.015]);
    add(M.white, cyl(0.03, 0.03, 0.012, 20), [0, 0.01, 0.034], [PI / 2, 0, 0]);
    add(M.red, box(0.002, 0.02, 0.002), [0, 0.02, 0.041], [0, 0, 0.6]);
  });
  at([2.2, 1.45, D], [0, PI, 0], () => {
    add(M.plant, rbox(0.26, 0.2, 0.09, 0.012), [0, 0, 0.045]);
    add(M.white, box(0.08, 0.025, 0.003), [0, 0, 0.091]); add(M.white, box(0.025, 0.08, 0.003), [0, 0, 0.091]);
  });
  // framed photos above the desk shelf
  for (const [x, y, w, h, cu] of [[-0.18, 1.98, 0.24, 0.19, [3, 1]], [-0.58, 1.97, 0.2, 0.26, [2, 0]]]) {
    add(M.black, box(w + 0.03, h + 0.03, 0.015), [x, y, -D + 0.008]);
    add(M.white, box(w, h, 0.002), [x, y, -D + 0.016]);
    add(M.paper, quad(w - 0.03, h - 0.03, cellUV(...cu)), [x, y, -D + 0.018]);
  }

  // cork board pins (3D) at the pin points baked with the texture
  {
    const pinMats = { '#d22': M.red, '#2a6': M.plant, '#26c': M.navy, '#dd2': M.yellow, '#22d': M.navy };
    for (const [u, v, col] of T.corkPins) {
      const x = -1.36 + (u - 0.5) * 0.8, y = 1.64 + (0.5 - v) * 0.5;
      add(M.steel, cyl(0.0012, 0.0012, 0.012, 4), [x, y, -D + 0.018], [PI / 2, 0, 0]);
      add(pinMats[col] || M.red, cyl(0.0055, 0.0045, 0.012, 10), [x, y, -D + 0.026], [PI / 2, 0, 0]);
      add(pinMats[col] || M.red, new THREE.SphereGeometry(0.0062, 10, 6), [x, y, -D + 0.034]);
    }
  }

  // door hardware: hinges, deadbolt, closer, sign
  {
    for (const y of [0.25, 1.02, 1.8]) {
      add(M.brass, cyl(0.008, 0.008, 0.1, 10), [DOOR.x0 + 0.012, y, D - 0.004]);
      add(M.brass, box(0.03, 0.09, 0.002), [DOOR.x0 + 0.03, y, D + 0.0165]);
    }
    add(M.steel, cyl(0.028, 0.028, 0.01, 20), [DOOR.x1 - 0.09, 1.25, D + 0.011], [PI / 2, 0, 0]);
    add(M.steel, rbox(0.012, 0.035, 0.014, 0.004), [DOOR.x1 - 0.09, 1.25, D + 0.0], [0, 0, 0.0]);
    add(M.charcoal, rbox(0.26, 0.055, 0.06, 0.01), [DOOR.x0 + 0.2, DOOR.y1 - 0.06, D + 0.0]);
    add(M.charcoal, box(0.25, 0.015, 0.02), [DOOR.x0 + 0.3, DOOR.y1 + 0.01, D - 0.02], [0, 0.4, 0]);
    add(M.doorSign, quad(0.22, 0.11), [(DOOR.x0 + DOOR.x1) / 2, 1.62, D + 0.0115], [0, PI, 0]);
  }

  // window: sash latch on the meeting rail, pull handles, rolled-up blind, things on the sill
  {
    const fx = W + 0.1 - 0.032, zc = (WIN.z0 + WIN.z1) / 2, yc = (WIN.y0 + WIN.y1) / 2;
    at([fx, yc + 0.02, zc], [0, -PI / 2, 0], () => {
      add(M.brass, rbox(0.07, 0.018, 0.02, 0.004), [0, 0, 0.005]);
      add(M.brass, cyl(0.009, 0.009, 0.012, 12), [0.015, 0, 0.018], [PI / 2, 0, 0]);
      add(M.brass, rbox(0.05, 0.008, 0.006, 0.003), [-0.005, 0.0, 0.026], [0, 0, 0.35]);
      add(M.brass, rbox(0.03, 0.014, 0.018, 0.004), [0.055, -0.03, 0.004]);
    });
    for (const z of [WIN.z0 + 0.2, WIN.z1 - 0.2]) {
      add(M.brass, rod([fx, WIN.y0 + 0.07, z - 0.03], [fx - 0.025, WIN.y0 + 0.07, z - 0.03], 0.003));
      add(M.brass, rod([fx, WIN.y0 + 0.07, z + 0.03], [fx - 0.025, WIN.y0 + 0.07, z + 0.03], 0.003));
      add(M.brass, rod([fx - 0.025, WIN.y0 + 0.07, z - 0.03], [fx - 0.025, WIN.y0 + 0.07, z + 0.03], 0.003));
    }
    // roller blind rolled up under the head
    add(M.white, cyl(0.022, 0.022, WIN.z1 - WIN.z0 + 0.04, 16), [W + 0.04, WIN.y1 - 0.03, zc], [PI / 2, 0, 0]);
    add(M.beige, cyl(0.03, 0.03, WIN.z1 - WIN.z0 - 0.02, 16), [W + 0.04, WIN.y1 - 0.035, zc], [PI / 2, 0, 0]);
    add(M.white, box(0.006, 0.01, WIN.z1 - WIN.z0 - 0.02), [W + 0.012, WIN.y1 - 0.07, zc]);
    add(M.white, rod([W + 0.012, WIN.y1 - 0.075, WIN.z1 - 0.12], [W + 0.01, WIN.y1 - 0.3, WIN.z1 - 0.12], 0.0012, 4));
    add(M.white, new THREE.TorusGeometry(0.012, 0.0025, 6, 12), [W + 0.01, WIN.y1 - 0.315, WIN.z1 - 0.12], [0, PI / 2, 0]);
    // binoculars and a small cactus on the stool
    at([W - 0.07, WIN.y0 + 0.01, WIN.z0 + 0.22], [0, 0.4, 0], () => {
      for (const s of [-1, 1]) {
        add(M.black, cyl(0.022, 0.022, 0.1, 14), [s * 0.028, 0.022, 0], [PI / 2, 0, 0]);
        add(M.black, cyl(0.026, 0.026, 0.035, 14), [s * 0.028, 0.026, 0.055], [PI / 2, 0, 0]);
        add(M.glassGreen, new THREE.CircleGeometry(0.02, 14), [s * 0.028, 0.026, 0.0735]);
      }
      add(M.black, box(0.03, 0.012, 0.05), [0, 0.03, 0.0]);
      add(M.rubber, tube([[-0.05, 0.02, -0.03], [-0.09, 0.005, 0.02], [-0.04, 0.003, 0.09], [0.05, 0.004, 0.08]], 0.0025, 16));
    });
    add(M.terracotta, cyl(0.035, 0.028, 0.06, 14), [W - 0.08, WIN.y0 + 0.04, WIN.z1 - 0.12]);
    { const g = new THREE.SphereGeometry(0.03, 12, 10); const p = g.attributes.position; for (let i = 0; i < p.count; i++) { const a = Math.atan2(p.getZ(i), p.getX(i)); const f = 1 + 0.12 * Math.cos(a * 8); p.setX(i, p.getX(i) * f); p.setZ(i, p.getZ(i) * f); p.setY(i, p.getY(i) * 1.4); } g.computeVertexNormals(); add(M.plant, g, [W - 0.08, WIN.y0 + 0.1, WIN.z1 - 0.12]); }
  }

  // desk clutter: telephone, stapler, tape dispenser, notebook + pen, crumpled paper, a thumb drive
  {
    at([-1.58, DESK.y, -1.86], [0, 0.35, 0], () => {
      const g = box(0.19, 0.07, 0.21);
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) if (p.getY(i) > 0 && p.getZ(i) > 0) p.setY(i, p.getY(i) - 0.03);
      g.computeVertexNormals();
      add(M.beige, g, [0, 0.035, 0]);
      for (let k = 0; k < 12; k++) add(M.white, rbox(0.022, 0.006, 0.018, 0.003), [-0.035 + (k % 3) * 0.035, 0.058 - Math.floor(k / 3) * 0.006, 0.065 - Math.floor(k / 3) * 0.022], [-0.28, 0, 0]);
      add(M.beige, rbox(0.21, 0.035, 0.05, 0.015), [0, 0.085, -0.05]);
      add(M.beige, rbox(0.05, 0.03, 0.055, 0.012), [-0.08, 0.1, -0.05]); add(M.beige, rbox(0.05, 0.03, 0.055, 0.012), [0.08, 0.1, -0.05]);
      const coil = [];
      for (let i = 0; i <= 160; i++) { const u = i / 160; coil.push([-0.12 - 0.08 * u + 0.012 * Math.cos(u * 70), 0.012 + 0.012 * Math.sin(u * 70), -0.05 + 0.25 * u]); }
      add(M.beige, tube(coil, 0.0025, 200));
    });
    at([-0.02, DESK.y, -1.61], [0, -0.4, 0], () => {
      add(M.black, rbox(0.035, 0.022, 0.15, 0.008), [0, 0.011, 0]);
      add(M.black, rbox(0.032, 0.02, 0.14, 0.008), [0, 0.036, 0.004], [-0.06, 0, 0]);
      add(M.chrome, box(0.02, 0.003, 0.03), [0, 0.047, 0.06]);
    });
    at([0.6, DESK.y, -1.36], [0, 0.6, 0], () => {
      add(M.charcoal, rbox(0.07, 0.045, 0.13, 0.015), [0, 0.022, 0]);
      add(M.white, cyl(0.03, 0.03, 0.02, 20), [0, 0.04, 0.01], [0, 0, PI / 2]);
    });
    at([-0.97, DESK.y + 0.058, -1.47], [0, -0.1, 0], () => { add(M.navy, cyl(0.004, 0.004, 0.14, 8), [0.06, 0.004, 0.02], [PI / 2, 0.3, 0]); add(M.chrome, box(0.003, 0.004, 0.03), [0.07, 0.009, -0.03], [0, 0.3, 0]); });
    add(M.red, rbox(0.018, 0.008, 0.05, 0.003), [0.3, DESK.y + 0.004, -1.48], [0, 1.1, 0]);
    for (const [x, y, z, sc] of [[-0.25, DESK.y + 0.03, -1.3, 1], [-1.2, 0.035, -0.9, 1.1], [0.95, 0.03, -1.1, 0.9]]) {
      const g2 = new THREE.IcosahedronGeometry(0.035 * sc, 1);
      const p2 = g2.attributes.position;
      for (let i = 0; i < p2.count; i++) { const f = 0.7 + 0.55 * U.vnoise3(p2.getX(i) * 80 + x * 9, p2.getY(i) * 80, p2.getZ(i) * 80); p2.setXYZ(i, p2.getX(i) * f, p2.getY(i) * f, p2.getZ(i) * f); }
      g2.computeVertexNormals();
      add(M.white, g2, [x, y, z], [x, z, 0]);
    }
    // Sam's backpack slumped against the desk pedestal
    at([-1.55, 0, -1.12], [0, 0.35, 0], () => {
      const g = K.rbox(0.3, 0.42, 0.18, 0.07, 3);
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) { const y = p.getY(i); p.setZ(i, p.getZ(i) * (1 + 0.25 * Math.sin((y + 0.2) * 5))); p.setX(i, p.getX(i) * (1 - 0.15 * Math.max(0, y) * 4)); }
      g.computeVertexNormals();
      add(M.coat2, g, [0, 0.2, 0], [-0.22, 0, 0.05]);
      add(M.coat2, K.rbox(0.22, 0.16, 0.06, 0.03, 2), [0, 0.12, 0.11], [-0.22, 0, 0.05]);
      add(M.black, tube([[-0.1, 0.4, -0.05], [-0.12, 0.2, -0.14], [-0.1, 0.02, -0.12]], 0.012, 12));
      add(M.black, tube([[0.1, 0.4, -0.05], [0.13, 0.2, -0.16], [0.12, 0.02, -0.1]], 0.012, 12));
      add(M.yellow, box(0.02, 0.05, 0.01), [0.05, 0.3, 0.1], [-0.22, 0, 0.3]);
    });
    // a little green alien toy on the shelf (someone's joke)
    at([0.16, 1.6325, -1.86], [0, -0.5, 0], () => {
      add(M.plant, cyl(0.012, 0.016, 0.04, 10), [0, 0.02, 0]);
      const hg = new THREE.SphereGeometry(0.02, 14, 10); hg.scale(1, 1.25, 1); add(M.plant, hg, [0, 0.06, 0]);
      for (const s of [-1, 1]) { const eg = new THREE.SphereGeometry(0.008, 10, 6); eg.scale(1, 1.5, 0.6); add(M.black, eg, [s * 0.009, 0.064, 0.016], [0, 0, s * 0.4]); }
    });
  }

  // EXIT sign over the door (on the battery circuit), sheets taped to the wall by the monitor
  add(M.white, rbox(0.36, 0.15, 0.06, 0.01), [(DOOR.x0 + DOOR.x1) / 2, DOOR.y1 + 0.2, D - 0.03]);
  add(E.exit, quad(0.32, 0.12), [(DOOR.x0 + DOOR.x1) / 2, DOOR.y1 + 0.2, D - 0.061], [0, PI, 0]);
  for (const [x, y, r, cu] of [[0.2, 1.3, 0.03, [2, 0]], [0.46, 1.24, -0.05, [0, 0]]]) {
    add(M.paper, sheetGeo(0.21, 0.297, cellUV(...cu), 0.004, x * 10), [x, y, -D + 0.006], [0, 0, r]);
    for (const [dx, dy] of [[-0.09, 0.14], [0.09, 0.14]]) add(M.paper, quad(0.04, 0.015, [0.005, 0.76, 0.05, 0.99]), [x + dx, y + dy, -D + 0.009], [0, 0, r + 0.3 * dx]);
  }

  // -------------------------------------------------------------------------
  // merge everything static
  // -------------------------------------------------------------------------
  // shadow casters for the desk lamp (things on and around the desk); big surfaces
  // are drawn last so early depth testing rejects what the furniture hides
  const castMats = new Set([M.black, M.charcoal, M.beige, M.keyboard, M.paper, M.greenbar, M.mugs, M.lampGreen, M.steel, M.chrome, M.receiver, M.navy, M.red, M.desk, M.brass, M.coffee, M.white, M.rubber, M.yellow, M.plant, M.terracotta]);
  const shellMats = new Set([M.pine, M.paint, M.floor, M.ceiling]);
  const flags = new Map();
  for (const m of Object.values(M)) flags.set(m, { cast: castMats.has(m), receive: true, renderOrder: shellMats.has(m) ? 3 : 0 });
  for (const m of Object.values(E)) flags.set(m, { cast: false, receive: false });
  const meshes = K.build(root, flags);

  // steam off Sam's coffee: a camera-facing sheet of scrolling wisps, glowing in the lamp light
  const steamU = { tNoise: { value: T.steam }, uTime: { value: 0 }, uAmt: { value: 1 } };
  const steam = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.26).translate(0, 0.13, 0), new THREE.ShaderMaterial({
    uniforms: steamU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: /* glsl */`
      uniform sampler2D tNoise; uniform float uTime, uAmt; varying vec2 vUv;
      void main() {
        vec2 uv = vUv;
        float sway = 0.12 * sin(uv.y * 5.0 + uTime * 1.1) * uv.y;
        float n = texture2D(tNoise, vec2(uv.x * 0.7 + sway + 0.1, uv.y * 0.6 - uTime * 0.11)).r;
        float n2 = texture2D(tNoise, vec2(uv.x * 1.2 - sway * 0.6 + 0.43, uv.y * 0.9 - uTime * 0.17)).r;
        float w = smoothstep(0.0, 0.3, uv.x) * smoothstep(1.0, 0.7, uv.x) * pow(1.0 - uv.y, 1.6) * smoothstep(0.0, 0.08, uv.y);
        float a = max(0.0, n * n2 * 2.6 - 0.12) * w * uAmt;
        gl_FragColor = vec4(vec3(1.0, 0.93, 0.85) * a * 0.22, 1.0);
      }`,
  }));
  steam.position.set(0.06, DESK.y + 0.085, -1.47);
  steam.renderOrder = 6;
  steam.onBeforeRender = (r, sc, cam) => {
    const cp = new V3().setFromMatrixPosition(cam.matrixWorld);
    steam.rotation.set(0, Math.atan2(cp.x - steam.position.x, cp.z - steam.position.z), 0);
    steam.updateMatrixWorld(true);
  };
  steam.userData.u = steamU;
  root.add(steam);

  // -------------------------------------------------------------------------
  // Sam's office chair (moves): origin under the front edge of the seat, +z forward
  // -------------------------------------------------------------------------
  const chair = new THREE.Group();
  chair.name = 'samChair';
  const chairBase = new THREE.Group();
  chair.add(chairBase);
  {
    const Kc = makeKit(THREE);
    const seatZ = -0.22;
    // star base around the column (column at the seat centre)
    Kc.at([0, 0, seatZ], [0, 0, 0], () => {
      for (let k = 0; k < 5; k++) {
        const a = k / 5 * PI * 2;
        const g = Kc.rbox(0.05, 0.035, 0.3, 0.012);
        Kc.add(M.black, g, [Math.sin(a) * 0.15, 0.085, Math.cos(a) * 0.15], [0.12, a, 0]);
        Kc.add(M.black, Kc.cyl(0.012, 0.012, 0.03, 8), [Math.sin(a) * 0.29, 0.055, Math.cos(a) * 0.29]);
        Kc.add(M.rubber, Kc.cyl(0.025, 0.025, 0.022, 14), [Math.sin(a) * 0.3, 0.025, Math.cos(a) * 0.3], [0, a + PI / 2, PI / 2]);
      }
      Kc.add(M.black, Kc.cyl(0.045, 0.05, 0.06, 16), [0, 0.1, 0]);
    });
    Kc.build(chairBase, new Map([[M.black, { cast: true }], [M.rubber, { cast: true }]]));
    const Ku = makeKit(THREE);
    Ku.add(M.chrome, Ku.cyl(0.022, 0.022, 0.22, 14), [0, 0.24, seatZ]);
    Ku.add(M.black, Ku.cyl(0.03, 0.04, 0.1, 14), [0, 0.18, seatZ]);
    Ku.add(M.black, Ku.rbox(0.24, 0.04, 0.24, 0.01), [0, 0.37, seatZ]);
    const fab = { uv: 'world', tile: [0.3, 0.3] };
    {
      const g = Ku.rbox(0.5, 0.085, 0.47, 0.035, 3);
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) { const x = p.getX(i) / 0.25, z = p.getZ(i) / 0.235; if (p.getY(i) > 0) p.setY(i, p.getY(i) - 0.01 * Math.max(0, 1 - x * x) * Math.max(0, 1 - z * z) + 0.008 * Math.max(0, z) * (1 - x * x)); }
      g.computeVertexNormals();
      Ku.add(M.chairFabric, g, [0, 0.47 - 0.0425, seatZ], [0, 0, 0], 1, fab);
    }
    Ku.add(M.black, Ku.rbox(0.07, 0.3, 0.025, 0.01), [0, 0.52, -0.47], [-0.12, 0, 0]);
    Ku.at([0, 0.62, -0.49], [-0.14, 0, 0], () => {
      const g = Ku.rbox(0.46, 0.5, 0.075, 0.03, 3);
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) { const x = p.getX(i) / 0.23; p.setZ(i, p.getZ(i) + 0.04 * x * x); }
      g.computeVertexNormals();
      Ku.add(M.chairFabric, g, [0, 0.25, 0], [0, 0, 0], 1, fab);
      Ku.add(M.black, Ku.rbox(0.44, 0.48, 0.02, 0.01), [0, 0.25, -0.045]);
    });
    for (const s of [-1, 1]) {
      Ku.add(M.black, Ku.rbox(0.03, 0.2, 0.05, 0.01), [s * 0.24, 0.52, seatZ - 0.04]);
      Ku.add(M.black, Ku.rbox(0.07, 0.03, 0.26, 0.012), [s * 0.245, 0.635, seatZ - 0.02]);
      Ku.add(M.black, Ku.rbox(0.04, 0.02, 0.08, 0.006), [s * 0.2, 0.43, seatZ - 0.04]);
    }
    Ku.build(chair, new Map([[M.black, { cast: true }], [M.chairFabric, { cast: true }], [M.chrome, { cast: true }]]));
  }
  root.add(chair);

  // -------------------------------------------------------------------------
  // AO strips and contact shadows (black, alpha gradient)
  // -------------------------------------------------------------------------
  {
    const c = document.createElement('canvas');
    c.width = 4; c.height = 128;
    const x = c.getContext('2d');
    const gr = x.createLinearGradient(0, 0, 0, 128);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = gr; x.fillRect(0, 0, 4, 128);
    const lin = new THREE.CanvasTexture(c);
    const c2 = document.createElement('canvas'); c2.width = c2.height = 64;
    const x2 = c2.getContext('2d');
    const rg = x2.createRadialGradient(32, 32, 0, 32, 32, 32);
    rg.addColorStop(0, 'rgba(255,255,255,1)'); rg.addColorStop(0.5, 'rgba(255,255,255,0.5)'); rg.addColorStop(1, 'rgba(255,255,255,0)');
    x2.fillStyle = rg; x2.fillRect(0, 0, 64, 64);
    const rad = new THREE.CanvasTexture(c2);
    const aoMat = new THREE.MeshBasicMaterial({ color: 0x000000, alphaMap: lin, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
    const csMat = new THREE.MeshBasicMaterial({ color: 0x000000, alphaMap: rad, transparent: true, opacity: 0.75, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
    const Ka = makeKit(THREE);
    // strip: plane with v=1 at the corner edge
    const strip = (len, wid) => { const g = new THREE.PlaneGeometry(len, wid); const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i), 1 - uv.getY(i)); return g; };
    const e = 0.003;
    // floor along walls (v=1 at the wall)
    Ka.add(aoMat, strip(2 * W, 0.35), [0, e, -D + 0.175], [-PI / 2, 0, 0]);
    Ka.add(aoMat, strip(2 * W, 0.35), [0, e, D - 0.175], [-PI / 2, 0, PI]);
    Ka.add(aoMat, strip(2 * D, 0.35), [-W + 0.175, e, 0], [-PI / 2, 0, -PI / 2]);
    Ka.add(aoMat, strip(2 * D, 0.35), [W - 0.175, e, 0], [-PI / 2, 0, PI / 2]);
    // walls at the floor and the ceiling
    for (const [face, len] of [['+z', 2 * W], ['-z', 2 * W], ['+x', 2 * D], ['-x', 2 * D]]) {
      const rot = { '+z': [0, 0, 0], '-z': [0, PI, 0], '+x': [0, PI / 2, 0], '-x': [0, -PI / 2, 0] }[face];
      const p = { '+z': [0, 0, -D + e], '-z': [0, 0, D - e], '+x': [-W + e, 0, 0], '-x': [W - e, 0, 0] }[face];
      Ka.at(p, rot, () => {
        Ka.add(aoMat, strip(len, 0.3), [0, 0.15, 0.02], [0, 0, PI]);
        Ka.add(aoMat, strip(len, 0.4), [0, H - 0.2, 0], [0, 0, 0]);
      });
    }
    // ceiling edges
    Ka.add(aoMat, strip(2 * W, 0.4), [0, H - e, -D + 0.2], [PI / 2, 0, 0]);
    Ka.add(aoMat, strip(2 * W, 0.4), [0, H - e, D - 0.2], [PI / 2, 0, PI]);
    Ka.add(aoMat, strip(2 * D, 0.4), [-W + 0.2, H - e, 0], [PI / 2, 0, -PI / 2]);
    Ka.add(aoMat, strip(2 * D, 0.4), [W - 0.2, H - e, 0], [PI / 2, 0, PI / 2]);
    // vertical corners
    for (const [x, z, ry] of [[-W, -D, 0], [W, -D, -PI / 2], [W, D, PI], [-W, D, PI / 2]]) {
      Ka.at([x, H / 2, z], [0, ry, 0], () => {
        Ka.add(aoMat, strip(H, 0.25), [0.125, 0, e], [0, 0, -PI / 2]);
        Ka.add(aoMat, strip(H, 0.25), [e, 0, 0.125], [0, -PI / 2, -PI / 2]);
      });
    }
    // contact shadows on the floor under furniture
    const blobAt = (x, z, w, d, ry = 0, o = 1) => Ka.add(csMat, new THREE.PlaneGeometry(w, d), [x, e + 0.001 * o, z], [-PI / 2, 0, ry]);
    blobAt(-1.46, -1.62, 0.8, 1.0);            // desk pedestal
    blobAt(-0.5, -1.7, 2.4, 0.9);              // under the desk
    blobAt(1.2, -1.7, 0.9, 0.9);               // rack
    blobAt(-2.19, -1.69, 0.8, 0.85);           // filing cabinet
    blobAt(-2.33, -0.65, 0.5, 1.3);            // bookshelf
    blobAt(1.9, -1.71, 0.8, 0.8);              // fridge
    blobAt(0.15, 1.73, 1.0, 0.65);             // printer table
    blobAt(-2.02, 1.17, 1.0, 1.0, 0.7);        // armchair
    // under the desk: dark wall behind the knee space
    Ka.add(aoMat, strip(1.9, 0.6), [-0.29, 0.44, -D + 0.02], [0, 0, 0]);
    Ka.build(root, new Map([[aoMat, { cast: false, receive: false, renderOrder: 1 }], [csMat, { cast: false, receive: false, renderOrder: 1 }]]));
    // chair contact shadow (moves with the chair)
    const cs = new THREE.Mesh(new THREE.PlaneGeometry(0.75, 0.75), csMat);
    cs.rotation.x = -PI / 2; cs.position.set(0, 0.004, -0.22); cs.renderOrder = 1;
    chair.add(cs);
  }

  // -------------------------------------------------------------------------
  // lights
  // -------------------------------------------------------------------------
  const lamp = new THREE.SpotLight(0xffb46b, 4, 0, 0.78, 0.55, 2);
  lamp.position.copy(bulbPos);
  lamp.target.position.copy(bulbPos).addScaledVector(lampAxis, 1);
  lamp.castShadow = true;
  lamp.shadow.mapSize.set(1024, 1024);
  lamp.shadow.bias = -0.0006;
  lamp.shadow.normalBias = 0.012;
  lamp.shadow.radius = 4;
  lamp.shadow.camera.near = 0.05;
  lamp.shadow.camera.far = 4;
  root.add(lamp, lamp.target);

  const monitor = new THREE.SpotLight(0x7fe8d0, 1.0, 0, 1.15, 1.0, 2);
  monitor.position.set(SCR.c.x, SCR.c.y, SCR.c.z + 0.02);
  monitor.target.position.set(SCR.c.x, SCR.c.y - 0.15, SCR.c.z + 2.0);
  root.add(monitor, monitor.target);

  const alarm = new THREE.SpotLight(0xff1808, 0, 0, 0.42, 0.55, 1.6);
  alarm.position.set(BEACON.x, BEACON.y + 0.12, BEACON.z);
  root.add(alarm, alarm.target);

  // one light, three roles over the film (set.js): Maya's reading lamp, the hologram's
  // cyan fill, then moonlight through the window once the Visitor has gone
  const aux = new THREE.PointLight(0xffb070, 0.8, 0, 2);
  aux.position.set(-2.28, 1.42, 1.78);
  root.add(aux);

  const hemi = new THREE.HemisphereLight(0x1a2233, 0x120c08, 1.0);
  root.add(hemi);

  return {
    root, M, E, meshes, envMap, glossy,
    parts: { steam, beaconFlare, reels: RACK.reels, mainScreen, secondScreen, chair, chairBase, hHour, hMin, hSec, beaconSpin, ledMesh, leds, meterNeedle, scopeMesh, counterMesh },
    lights: { lamp, monitor, alarm, aux, hemi }, moonU,
    dims: { W, D, H, WIN, DOOR, DESK, SCR, LAMP, bulbPos, lampAxis, BEACON, CLOCK, RX, RACK, ARM },
  };
}
