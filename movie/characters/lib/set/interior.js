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
  const std = (o, env = 0) => { const m = new THREE.MeshStandardMaterial(o); if (env > 0) { m.envMap = envMap; m.envMapIntensity = env; m.userData.env = env; glossy.push(m); } return m; };
  const lam = o => new THREE.MeshLambertMaterial(o);
  const M = {
    pine: std({ map: T.pine, bumpMap: T.pineBump, bumpScale: 1.2, roughness: 0.62, color: 0xffffff }, 0.25),
    paint: lam({ map: T.paint, color: 0xffffff }),
    floor: std({ map: T.floor, bumpMap: T.floorBump, bumpScale: 1.0, roughness: 0.5, color: 0xffffff }, 0.35),
    ceiling: lam({ map: T.ceiling, color: 0xffffff }),
    beam: std({ map: T.beam, roughness: 0.7 }),
    trim: std({ map: T.beam, roughness: 0.55, color: 0xd8c0a0 }, 0.2),
    desk: std({ map: T.desk, roughness: 0.42 }, 0.4),
    enamel: std({ map: T.enamel, roughness: 0.42, metalness: 0.25 }, 0.5),
    enamelDark: std({ map: T.enamel, color: 0x6a7068, roughness: 0.45, metalness: 0.3 }, 0.5),
    rackMetal: std({ map: T.rackMetal, roughness: 0.55, metalness: 0.4 }, 0.4),
    rackFront: std({ map: T.rack, roughness: 0.5, metalness: 0.3 }, 0.35),
    black: std({ color: 0x19191b, roughness: 0.42, metalness: 0.0 }, 0.5),
    rubber: std({ color: 0x121212, roughness: 0.6 }),
    charcoal: std({ color: 0x2a2b2e, roughness: 0.38, metalness: 0.05 }, 0.6),
    beige: std({ map: T.beige, roughness: 0.5 }, 0.35),
    chrome: std({ color: 0xc8c8cc, roughness: 0.22, metalness: 1.0 }, 1.0),
    steel: std({ color: 0x9a9ca0, roughness: 0.4, metalness: 0.9 }, 0.8),
    brass: std({ color: 0xb08a48, roughness: 0.35, metalness: 1.0 }, 0.8),
    lampGreen: std({ color: 0x24493a, roughness: 0.35, metalness: 0.4 }, 0.8),
    armFabric: std({ map: T.armFabric, roughness: 0.9 }),
    chairFabric: std({ map: T.chairFabric, roughness: 0.85 }),
    blanket: std({ map: T.blanket, roughness: 0.95, side: THREE.DoubleSide }),
    rug: std({ map: T.rug, roughness: 0.95 }),
    darkWood: std({ map: T.beam, color: 0x8a6a50, roughness: 0.5 }, 0.3),
    paper: std({ map: T.paper, roughness: 0.85, side: THREE.DoubleSide }),
    greenbar: std({ map: T.greenbar, roughness: 0.85, side: THREE.DoubleSide }),
    cork: std({ map: T.cork, roughness: 0.85 }),
    books: std({ map: T.books, roughness: 0.7 }, 0.15),
    keyboard: std({ map: T.keyboard, roughness: 0.55 }, 0.3),
    mugs: std({ map: T.mugs, roughness: 0.25 }, 0.8),
    coffee: std({ color: 0x1a0d06, roughness: 0.1 }, 1.0),
    whiteboard: std({ map: T.whiteboard, roughness: 0.25 }, 0.6),
    poster: std({ map: T.poster, roughness: 0.6 }),
    sign: std({ map: T.sign, roughness: 0.6 }),
    fridge: std({ map: T.fridge, roughness: 0.35 }, 0.6),
    white: std({ color: 0xdedbd2, roughness: 0.4 }, 0.5),
    door: std({ map: T.enamel, color: 0x8f9a92, roughness: 0.5 }, 0.3),
    cardboard: std({ color: 0x9a7650, roughness: 0.9 }),
    receiver: std({ map: T.receiver, roughness: 0.55, metalness: 0.3 }, 0.4),
    red: std({ color: 0xa3221c, roughness: 0.35 }, 0.5),
    plant: std({ color: 0x3f6a34, roughness: 0.7 }),
    terracotta: std({ color: 0x9c5a3a, roughness: 0.8 }),
    coat: std({ color: 0x7a2e22, roughness: 0.8 }),
    coat2: std({ color: 0x2e3b4a, roughness: 0.85 }),
    clock: std({ map: T.clock, roughness: 0.3 }, 0.5),
    navy: std({ color: 0x1f2c48, roughness: 0.6 }),
  };
  const E = {   // emissive / unlit practicals (values set in update)
    lampInner: new THREE.MeshBasicMaterial({ color: 0xffd9a0, side: THREE.BackSide }),
    bulb: new THREE.MeshBasicMaterial({ color: 0xffffff }),
    dial: new THREE.MeshBasicMaterial({ map: T.dial }),
    meter: new THREE.MeshBasicMaterial({ color: 0xffc070 }),
    led: new THREE.MeshBasicMaterial({ color: 0xffffff }),
    beaconDome: new THREE.MeshStandardMaterial({ color: 0x5a0a06, emissive: 0xff1a0a, emissiveIntensity: 0, roughness: 0.2, transparent: true, opacity: 0.88 }),
    fluoro: new THREE.MeshStandardMaterial({ color: 0xd8d8d0, roughness: 0.6, emissive: 0xc8e0ff, emissiveIntensity: 0 }),
  };
  E.beaconDome.envMap = envMap; E.beaconDome.envMapIntensity = 0.6;

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
  const sheet = (i, j, pos, rot, w = 0.21, h = 0.297) => add(M.paper, quad(w, h, cellUV(i, j)), pos, [-PI / 2, 0, rot]);
  sheet(0, 0, [-0.98, DESK.y + 0.031, -1.5], 0.12);
  sheet(1, 0, [-1.02, DESK.y + 0.033, -1.48], -0.06);
  { const g = box(0.215, 0.028, 0.3); K.boxUVAll(g, 0.005, 0.76, 0.06, 0.99); add(M.paper, g, [-1.0, DESK.y + 0.015, -1.49], [0, 0.03, 0]); }   // the stack under them
  sheet(0, 1, [0.12, DESK.y + 0.002, -1.43], -0.35);                                          // legal pad by the mug
  sheet(1, 1, [-0.28, DESK.y + 0.003, -1.33], 0.25);
  sheet(2, 3, [0.5, DESK.y + 0.002, -1.4], 0.5, 0.18, 0.18);
  sheet(1, 3, [-1.52, DESK.y + 0.002, -1.35], -0.2);
  sheet(3, 0, [-0.7, DESK.y + 0.004, -1.33], 1.3);
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
  function mug(x, z, which, fill = 0.07, handleRot = 0) {
    const prof = [[0, 0], [0.036, 0], [0.039, 0.004], [0.041, 0.09], [0.0405, 0.096], [0.037, 0.096], [0.036, 0.09], [0.035, 0.01], [0, 0.01]].map(([r, y]) => new THREE.Vector2(r, y));
    const g = new THREE.LatheGeometry(prof, 24);
    const uv = g.attributes.uv;
    const u0 = (which % 2) * 0.5, v0 = 1 - (Math.floor(which / 2) + 1) * 0.5;
    for (let i = 0; i < uv.count; i++) {
      const v = uv.getY(i);
      const vv = v <= 3 / 8 + 1e-3 ? v / (3 / 8) : 0.02;
      uv.setXY(i, u0 + uv.getX(i) * 0.5, v0 + vv * 0.5);
    }
    at([x, DESK.y, z], [0, handleRot, 0], () => {
      add(M.mugs, g);
      const h = new THREE.TorusGeometry(0.024, 0.0065, 6, 12, PI);
      const uvh = h.attributes.uv; for (let i = 0; i < uvh.count; i++) uvh.setXY(i, u0 + 0.01, v0 + 0.01);
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
  const LAMP = { base: new V3(0.48, DESK.y, -1.8), elbow: new V3(0.44, 1.3, -1.72), head: new V3(0.24, 1.22, -1.5), aim: new V3(-0.12, DESK.y, -1.38) };
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
    const prof = [[0.018, 0.02], [0.03, 0.0], [0.05, -0.05], [0.07, -0.11], [0.078, -0.13]].map(([r, y]) => new THREE.Vector2(r, y));
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
      const w = 0.025 + ((i * 7) % 5) * 0.007, h = 0.18 + ((i * 3) % 4) * 0.025, s = (i * 5 + 3) % 31;
      const g = box(w, h, 0.16);
      K.boxUVAll(g, 31 / 32 + 0.002, 0.05, 1 - 0.002, 0.95);
      K.boxFaceUV(g, 4, s / 32 + 0.002, 0.03, (s + 1) / 32 - 0.002, 0.97);
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
  {
    add(M.black, cyl(0.07, 0.075, 0.04, 24), [BEACON.x, BEACON.y + 0.02, BEACON.z]);
    const dome = new THREE.Mesh(new THREE.CapsuleGeometry(0.058, 0.07, 6, 20), E.beaconDome);
    dome.position.set(BEACON.x, BEACON.y + 0.04 + 0.093, BEACON.z);
    dome.scale.set(1, 1, 1);
    root.add(dome);
    beaconSpin.position.set(BEACON.x, BEACON.y + 0.12, BEACON.z);
    const refl = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.06, 16, 1, true, -PI / 2, PI), new THREE.MeshStandardMaterial({ color: 0xffd0c0, metalness: 1, roughness: 0.15, envMap, envMapIntensity: 1.5, side: THREE.DoubleSide }));
    beaconSpin.add(refl);
    const lampS = new THREE.Mesh(new THREE.SphereGeometry(0.014, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    lampS.name = 'beaconBulb';
    beaconSpin.add(lampS);
    root.add(beaconSpin);
  }
  const ledMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.0035, 8, 6), E.led, leds.length);
  {
    const m = new THREE.Matrix4();
    leds.forEach((l, i) => { m.makeTranslation(l.p.x, l.p.y, l.p.z); ledMesh.setMatrixAt(i, m); ledMesh.setColorAt(i, l.col); });
    root.add(ledMesh);
  }

  // back-right corner: printer table, dot-matrix printer, a box of paper, UPS
  {
    const tx = 2.0, tz = -1.72;
    add(M.darkWood, box(0.9, 0.03, 0.5), [tx, 0.7, tz], [0, 0, 0], 1, { uv: 'world', tile: [0.5, 0.5] });
    for (const [dx, dz] of [[-0.42, -0.22], [0.42, -0.22], [-0.42, 0.22], [0.42, 0.22]]) add(M.steel, cyl(0.014, 0.014, 0.69, 8), [tx + dx, 0.345, tz + dz]);
    add(M.beige, rbox(0.5, 0.14, 0.34, 0.02), [tx - 0.05, 0.785, tz], [0, 0.05, 0]);
    add(M.black, box(0.36, 0.01, 0.06), [tx - 0.05, 0.86, tz - 0.08], [0, 0.05, 0]);
    add(M.greenbar, quad(0.3, 0.3, [0, 0.2, 1, 0.5]), [tx - 0.05, 0.93, tz - 0.13], [-0.3, 0.05, 0]);
    add(M.cardboard, box(0.4, 0.25, 0.3), [tx + 0.1, 0.125, tz], [0, -0.1, 0]);
    add(M.greenbar, box(0.34, 0.12, 0.25), [tx + 0.1, 0.26, tz], [0, -0.1, 0]);
    add(M.black, rbox(0.2, 0.3, 0.42, 0.01), [tx - 0.3, 0.15, tz], [0, 0.05, 0]);
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
            const th = 0.025 + br() * 0.025, s2 = Math.floor(br() * 31);
            const g = box(0.2 + br() * 0.04, th, 0.15 + br() * 0.05);
            K.boxUVAll(g, 31 / 32 + 0.002, 0.05, 1 - 0.002, 0.95);
            K.boxFaceUV(g, 1, s2 / 32 + 0.002, 0.2, (s2 + 1) / 32 - 0.002, 0.8);
            add(M.books, g, [bx + 0.01, yy + th / 2, z + 0.1], [0, (br() - 0.5) * 0.3, 0]);
            yy += th;
          }
          z += 0.24;
          continue;
        }
        const t = 0.02 + br() * 0.045, h = 0.17 + br() * 0.14, dd = 0.14 + br() * 0.1, s2 = Math.floor(br() * 31);
        const g = box(dd, h, t);
        K.boxUVAll(g, 31 / 32 + 0.002, 0.05, 1 - 0.002, 0.95);
        K.boxFaceUV(g, 0, s2 / 32 + 0.002, 0.03, (s2 + 1) / 32 - 0.002, 0.97);
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
  add(M.poster, quad(0.46, 0.646), [-W + 0.006, 1.62, 0.55], [0, PI / 2, 0]);
  add(M.darkWood, box(0.012, 0.67, 0.48), [-W + 0.004, 1.62, 0.55]);

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
    // curved, reclined back: three panels
    at([0, 0.3, -0.53], [-0.3, 0, 0], () => {
      add(M.armFabric, rbox(0.44, 0.66, 0.13, 0.05, 3), [0, 0.33, -0.02], [0, 0, 0], 1, fab);
      for (const s of [-1, 1]) add(M.armFabric, rbox(0.2, 0.58, 0.12, 0.05, 3), [s * 0.27, 0.29, 0.06], [0, s * 0.75, 0], 1, fab);
      add(M.armFabric, rbox(0.4, 0.42, 0.12, 0.055, 3), [0, 0.3, 0.1], [0.05, 0, 0], 1, fab);
    });
    // blanket folded over the right arm (local -x), knit throw
    {
      const nx = 26, nz = 22, pos = [], uv = [], idx = [];
      for (let j = 0; j <= nz; j++) {
        for (let i = 0; i <= nx; i++) {
          const u = i / nx, v = j / nz;
          const s = (u - 0.42) * 0.8;          // across the arm (outward = +s)
          const zz = -0.5 + v * 0.62;
          const top = 0.64;
          let x = -0.305 - s, y = top + 0.012;
          const out = Math.max(0, s - 0.055), inn = Math.max(0, -s - 0.055);
          if (out > 0) { x = -0.305 - 0.055 - out * 0.22 - 0.015; y = top + 0.012 - out * 0.95; }
          if (inn > 0) { x = -0.305 + 0.055 + inn * 0.35; y = top + 0.012 - inn * 0.6; y = Math.max(y, 0.44); }
          y += 0.008 * Math.sin(v * 13 + u * 4) + 0.006 * Math.sin(v * 31);
          x += 0.004 * Math.sin(v * 17);
          pos.push(x, y, zz); uv.push(u * 1.2, v * 1.0);
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
    add(M.paper, quad(0.14, 0.2, [0.985, 0.1, 0.995, 0.9]), [tx + 0.02, 0.5935, tz + 0.02], [-PI / 2, 0, 0.4]);
    mugAt(tx - 0.08, tz - 0.08);
    add(M.brass, cyl(0.1, 0.12, 0.02, 20), [-2.28, 0.01, 1.78]);
    add(M.brass, cyl(0.01, 0.01, 1.45, 8), [-2.28, 0.74, 1.78]);
    add(M.white, cyl(0.16, 0.2, 0.25, 24, true), [-2.28, 1.5, 1.78]);
  }
  function mugAt(x, z) {
    const prof = [[0, 0], [0.036, 0], [0.039, 0.004], [0.041, 0.09], [0.0405, 0.096], [0.037, 0.096], [0.036, 0.09], [0.035, 0.01], [0, 0.01]].map(([r, y]) => new THREE.Vector2(r, y));
    const g = new THREE.LatheGeometry(prof, 20);
    const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, 0.51 + uv.getX(i) * 0.48, 0.02);
    add(M.mugs, g, [x, 0.5625, z]);
  }
  add(M.rug, box(1.7, 0.008, 1.25), [-1.55, 0.004, 0.95], [0, 0.12, 0]);

  // -------------------------------------------------------------------------
  // front wall: fridge + kettle, whiteboard, poster, coats; right wall: radiator, extinguisher, sign
  // -------------------------------------------------------------------------
  {
    const fx = -0.05, fz = 1.71;
    const g = box(0.55, 0.86, 0.56);
    K.boxUVAll(g, 0.9, 0.9, 0.95, 0.95);
    K.boxFaceUV(g, 5, 0, 0, 1, 1);
    add(M.fridge, g, [fx, 0.43 + 0.02, fz]);
    add(M.black, box(0.52, 0.02, 0.54), [fx, 0.01, fz]);
    add(M.steel, rbox(0.025, 0.25, 0.03, 0.01), [fx + 0.23, 0.62, fz - 0.29]);
    // kettle
    at([fx - 0.12, 0.88, fz - 0.05], [0, 0.4, 0], () => {
      const prof = [[0, 0], [0.08, 0], [0.085, 0.02], [0.085, 0.16], [0.065, 0.2], [0.03, 0.21], [0, 0.21]].map(([r, y]) => new THREE.Vector2(r, y));
      add(M.steel, new THREE.LatheGeometry(prof, 24));
      add(M.black, new THREE.TorusGeometry(0.07, 0.012, 8, 16, PI), [0, 0.19, 0], [0, PI / 2, 0]);
      add(M.steel, rod([0.08, 0.06, 0], [0.13, 0.17, 0], 0.012));
      add(M.black, cyl(0.1, 0.1, 0.015, 20), [0, -0.008, 0]);
    });
    add(M.brass, cyl(0.05, 0.05, 0.13, 16), [fx + 0.08, 0.945, fz + 0.05]);
    add(M.cardboard, box(0.16, 0.08, 0.08), [fx + 0.14, 0.92, fz - 0.14], [0, 0.3, 0]);
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
  // cables
  // -------------------------------------------------------------------------
  {
    const tube = (pts, r, seg = 40) => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map(p => new V3(...p))), seg, r, 6, false);
    add(M.rubber, tube([[0.92, 0.05, -1.95], [0.7, 0.012, -1.97], [0.3, 0.012, -1.98], [-0.2, 0.3, -1.98], [-0.5, 0.74, -1.97]], 0.008));
    add(M.rubber, tube([[0.92, 0.12, -1.9], [0.75, 0.015, -1.9], [0.2, 0.015, -1.94], [-0.3, 0.25, -1.97], [-0.4, 0.74, -1.96]], 0.006));
    add(M.rubber, tube([[-1.1, 0.74, -1.97], [-0.9, 0.4, -1.98], [-0.5, 0.33, -1.985], [-0.1, 0.4, -1.985], [0.2, 0.74, -1.97]], 0.007));
    add(M.rubber, tube([[-1.3, 0.74, -1.97], [-1.1, 0.5, -1.99], [-0.8, 0.45, -1.99], [-0.6, 0.6, -1.98]], 0.005));
    add(M.rubber, tube([[-0.5, 0.77, -1.5], [-0.52, 0.76, -1.62], [-0.55, 0.755, -1.75], [-0.6, 0.76, -1.9]], 0.003));
    add(M.rubber, tube([[0.48, 0.76, -1.85], [0.55, 0.74, -1.95], [0.62, 0.3, -1.98], [0.66, 0.02, -1.95], [0.8, 0.01, -1.9]], 0.004));
    // power strip on the floor under the desk
    add(M.white, rbox(0.35, 0.04, 0.06, 0.01), [-0.1, 0.02, -1.85], [0, 0.2, 0]);
    for (let k = 0; k < 4; k++) add(M.black, rbox(0.035, 0.03, 0.04, 0.006), [-0.2 + k * 0.07, 0.05, -1.85 + k * 0.014], [0, 0.2, 0]);
  }

  // -------------------------------------------------------------------------
  // merge everything static
  // -------------------------------------------------------------------------
  const castMats = new Set([M.black, M.charcoal, M.beige, M.keyboard, M.paper, M.greenbar, M.mugs, M.lampGreen, M.steel, M.chrome, M.receiver, M.navy, M.red, M.darkWood, M.desk, M.enamel, M.rackMetal, M.armFabric, M.blanket, M.books, M.plant, M.terracotta, M.brass, M.coffee, M.white, M.cardboard]);
  const flags = new Map();
  for (const m of Object.values(M)) flags.set(m, { cast: castMats.has(m), receive: true });
  for (const m of Object.values(E)) flags.set(m, { cast: false, receive: false });
  const meshes = K.build(root, flags);

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
    blobAt(-0.05, 1.71, 0.8, 0.8);             // fridge
    blobAt(2.0, -1.72, 1.1, 0.7);              // printer table
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

  const holo = new THREE.PointLight(0x5fe6ff, 0, 0, 2);
  holo.position.set(1.2, 1.35, -0.45);
  root.add(holo);

  const hemi = new THREE.HemisphereLight(0x1a2233, 0x120c08, 1.0);
  root.add(hemi);

  return {
    root, M, E, meshes, envMap, glossy,
    parts: { mainScreen, secondScreen, chair, chairBase, hHour, hMin, hSec, beaconSpin, ledMesh, leds, meterNeedle, scopeMesh, counterMesh },
    lights: { lamp, monitor, alarm, holo, hemi },
    dims: { W, D, H, WIN, DOOR, DESK, SCR, LAMP, bulbPos, lampAxis, BEACON, CLOCK, RX, RACK, ARM },
  };
}
