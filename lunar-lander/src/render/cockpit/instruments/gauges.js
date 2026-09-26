// Analog meters: generic vertical edge meter / round dial, LM thrust & thrust-to-weight indicator,
// CSM SPS gimbal position / fuel pressure indicator (GPI), CSM propellant quantity cluster (drum
// counters, UNBAL meter, RCS quantity), and generic digital (7-segment) readouts.
import {
  THREE, createCase, createDisplay, drawSegChar, limiter, finish, needleMesh, trianglePointer, barNeedle, approach, DEG,
  createCanvasTexture, drawText,
} from './common.js';

// ------------------------------------------------------------------------------ scale helpers
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/**
 * Vertical scale printed on a face painter. Returns map(value) -> y (m).
 * o: { x, yLo, yHi, min, max, ticks (major values), minor=4 (subdivisions), side=1 (ticks extend
 *   toward +x; numbers on the other side), fmt, size=0.0034, redline:[a,b], yellow:[a,b], labels=true }
 */
function vScale(P, o) {
  const { x, yLo, yHi, min, max } = o;
  const side = o.side ?? 1;
  const map = (v) => yLo + ((clamp(v, min, max) - min) / (max - min)) * (yHi - yLo);
  const band = (r, col) => {
    if (!r) return;
    const a = map(r[0]);
    const b = map(r[1]);
    P.rect(x + side * 0.0019, (a + b) / 2, 0.0028, Math.abs(b - a), col, { glow: false });
  };
  band(o.redline, '#c42016');
  band(o.yellow, '#d8a414');
  P.line(x, yLo, x, yHi, 0.0006);
  const ticks = o.ticks || [min, max];
  const minor = o.minor ?? 4;
  ticks.forEach((t, i) => {
    const y = map(t);
    P.line(x, y, x + side * 0.0042, y, 0.0007);
    if (o.labels !== false) P.text(o.fmt ? o.fmt(t) : String(t), x - side * 0.0022, y, o.size ?? 0.0034, { align: side > 0 ? 'right' : 'left' });
    if (i < ticks.length - 1 && minor > 1) {
      for (let k = 1; k < minor; k++) {
        const v = t + ((ticks[i + 1] - t) * k) / minor;
        const yy = map(v);
        P.line(x, yy, x + side * 0.0024, yy, 0.0005);
      }
    }
  });
  return map;
}

/** Horizontal scale; returns map(value) -> x. o: { y, xLo, xHi, min, max, ticks, minor, fmt, size } */
function hScale(P, o) {
  const { y, xLo, xHi, min, max } = o;
  const map = (v) => xLo + ((clamp(v, min, max) - min) / (max - min)) * (xHi - xLo);
  P.line(xLo, y, xHi, y, 0.0006);
  const ticks = o.ticks || [min, max];
  const minor = o.minor ?? 4;
  ticks.forEach((t, i) => {
    const x = map(t);
    P.line(x, y, x, y - 0.004, 0.0007);
    if (o.labels !== false) P.text(o.fmt ? o.fmt(t) : String(t), x, y + 0.0032, o.size ?? 0.0032);
    if (i < ticks.length - 1) {
      for (let k = 1; k < minor; k++) {
        const xx = map(t + ((ticks[i + 1] - t) * k) / minor);
        P.line(xx, y, xx, y - 0.0024, 0.0005);
      }
    }
  });
  return map;
}

/** Pointer (triangle) pointing toward -x (side 1: sits right of a scale) or +x (side -1). */
function sidePointer(color = 0xdad9d0, size = 0.0042) {
  const m = needleMesh(trianglePointer(size, size * 1.35), color, 0);
  return m;
}

function orientPointer(m, dir) {
  // trianglePointer tip points -Y; rotate so the tip points along dir ('-x', '+x', '-y', '+y')
  m.rotation.z = { '-x': -Math.PI / 2, '+x': Math.PI / 2, '-y': 0, '+y': Math.PI }[dir];
  return m;
}

// ------------------------------------------------------------------------------ generic gauge
/**
 * Generic analog meter.
 * opts: { kind: 'vertical'|'round', label, min=0, max=100, units, getValue(vessel, game) -> number,
 *   width=0.06, height=0.08 (round default 0.07 square), ticks: [values], minor, redline: [a,b] | a
 *   (a number = from a to max), yellow: [a,b] | a, fmt(v) -> string, color (pointer) }
 * @returns {{object, width, height, update}}
 */
export function createGauge(opts = {}) {
  const kind = opts.kind || 'vertical';
  const W = opts.width || (kind === 'round' ? 0.07 : 0.06);
  const H = opts.height || (kind === 'round' ? 0.07 : 0.08);
  const min = opts.min ?? 0;
  const max = opts.max ?? 100;
  const ticks = opts.ticks || [min, (min + max) / 2, max];
  const getValue = opts.getValue || (() => min);
  // redline / yellow: [from, to] or a single value (band from it to max)
  const band2 = (r) => (typeof r === 'number' ? [r, max] : r);
  opts = { ...opts, redline: band2(opts.redline), yellow: band2(opts.yellow) };
  const fr = 0.005;
  let map = null;
  let R = 0;
  const cy = kind === 'round' ? -0.001 : 0;
  const A0 = -135 * DEG;
  const A1 = 135 * DEG;
  const { group, faceWidth: fw, faceHeight: fh } = createCase({
    width: W,
    height: H,
    frame: fr,
    faceSpec: {
      draw(P) {
        const fwx = W - 2 * fr;
        const fhx = H - 2 * fr;
        if (kind === 'vertical') {
          const nl = String(opts.label || '').split('\n').length;
          const top = fhx / 2 - 0.004 - nl * 0.0045;
          const bot = -fhx / 2 + 0.0085;
          map = vScale(P, { x: 0.001, yLo: bot, yHi: top, min, max, ticks, minor: opts.minor ?? 4, redline: opts.redline, yellow: opts.yellow, fmt: opts.fmt, size: 0.0033 });
          if (opts.label) P.text(opts.label, 0, fhx / 2 - 0.0035 - (nl * 0.0045) / 2, 0.0036, { lineHeight: 1.15 });
          if (opts.units) P.text(opts.units, 0, -fhx / 2 + 0.0038, 0.003);
        } else {
          R = Math.min(fwx, fhx) * 0.4;
          const amap = (v) => A0 + ((clamp(v, min, max) - min) / (max - min)) * (A1 - A0);
          map = amap;
          const band = (r, col) => {
            if (!r) return;
            P.ring(0, cy, R * 0.93, R * 0.09, col, amap(r[0]) - Math.PI / 2, amap(r[1]) - Math.PI / 2, false);
          };
          band(opts.redline, '#c42016');
          band(opts.yellow, '#d8a414');
          P.ring(0, cy, R, 0.0006, '#f0f0ea', A0 - Math.PI / 2, A1 - Math.PI / 2);
          ticks.forEach((t, i) => {
            const a = amap(t);
            P.line(Math.sin(a) * R, cy + Math.cos(a) * R, Math.sin(a) * R * 0.84, cy + Math.cos(a) * R * 0.84, 0.0008);
            P.text(opts.fmt ? opts.fmt(t) : String(t), Math.sin(a) * R * 0.66, cy + Math.cos(a) * R * 0.66, R * 0.15);
            if (i < ticks.length - 1) {
              for (let k = 1; k < (opts.minor ?? 5); k++) {
                const aa = amap(t + ((ticks[i + 1] - t) * k) / (opts.minor ?? 5));
                P.line(Math.sin(aa) * R, cy + Math.cos(aa) * R, Math.sin(aa) * R * 0.91, cy + Math.cos(aa) * R * 0.91, 0.0005);
              }
            }
          });
          if (opts.label) P.text(opts.label, 0, cy - R * 0.42, R * 0.15, { lineHeight: 1.15 });
          if (opts.units) P.text(opts.units, 0, cy - R * 0.85, R * 0.13);
        }
      },
    },
    depth: 0.03,
  });
  let ptr;
  if (kind === 'vertical') {
    ptr = orientPointer(sidePointer(opts.color ?? 0xdad9d0), '-x');
    ptr.position.set(0.001 + 0.0048, 0, 0.0006);
  } else {
    ptr = needleMesh(barNeedle(R * 0.9, 0.0016), opts.color ?? 0xdad9d0, 0);
    ptr.position.set(0, cy, 0.0006);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.1, R * 0.12, 0.002, 20).rotateX(Math.PI / 2).translate(0, 0, 0.001), new THREE.MeshStandardMaterial({ color: 0x0b0b0b, roughness: 0.4 }));
    cap.position.set(0, cy, 0.0006);
    group.add(cap);
  }
  group.add(ptr);
  const lim = limiter(30);
  let val = NaN;
  function update(vessel, game, dt) {
    const e = lim.tick(dt);
    if (!e || !vessel) return;
    val = approach(val, getValue(vessel, game), e, 6);
    if (!Number.isFinite(val)) return;
    if (kind === 'vertical') ptr.position.y = map(val);
    else ptr.rotation.z = -map(val);
  }
  void fw;
  void fh;
  return finish(group, W, H, update);
}

// ------------------------------------------------------------------------------ LM thrust / T-W
/**
 * LM thrust indicator pair (0.10 × 0.12 m): T/W (thrust-to-weight in lunar g, 0-5, tel.twr) and
 * THRUST % (0-100) with two pointers — CMD (mainEngine.throttleCmd, left of the scale, white) and
 * ACT (mainEngine.throttle, right, orange).
 */
export function createThrustIndicator(opts = {}) {
  const W = 0.1;
  const H = 0.12;
  const fr = 0.006;
  const maps = {};
  const xs = { tw: -0.018, th: 0.02 };
  const yLo = -0.036;
  const yHi = 0.031;
  const { group } = createCase({
    width: W,
    height: H,
    frame: fr,
    faceSpec: {
      draw(P) {
        maps.tw = vScale(P, { x: xs.tw, yLo, yHi, min: 0, max: 5, ticks: [0, 1, 2, 3, 4, 5], minor: 2, size: 0.0036 });
        maps.th = vScale(P, { x: xs.th, yLo, yHi, min: 0, max: 100, ticks: [0, 20, 40, 60, 80, 100], minor: 4, size: 0.0032, yellow: [60, 92.5] });
        P.text('T/W', xs.tw - 0.002, 0.041, 0.0046);
        P.text('THRUST', xs.th - 0.002, 0.041, 0.0046);
        P.text('LUNAR G', xs.tw - 0.002, -0.0435, 0.003);
        P.text('PERCENT', xs.th - 0.002, -0.0435, 0.003);
        P.text('CMD', xs.th - 0.0125, yHi + 0.0045, 0.0026);
        P.text('ACT', xs.th + 0.0105, yHi + 0.0045, 0.0026);
      },
    },
  });
  const pTW = orientPointer(sidePointer(0xdad9d0), '-x');
  pTW.position.set(xs.tw + 0.0048, 0, 0.0006);
  const pAct = orientPointer(sidePointer(0xff9b1a), '-x');
  pAct.position.set(xs.th + 0.0048, 0, 0.0006);
  // CMD pointer sits left of the scale, among the numbers: a slim white bar marker
  const pCmd = orientPointer(sidePointer(0xdad9d0, 0.0036), '+x');
  pCmd.position.set(xs.th - 0.0098, 0, 0.0008);
  group.add(pTW, pAct, pCmd);
  const lim = limiter(30);
  const st = { tw: 0, act: 0, cmd: 0 };
  function update(vessel, game, dt) {
    const e = lim.tick(dt);
    if (!e || !vessel) return;
    const me = vessel.mainEngine || {};
    st.tw = approach(st.tw, vessel.tel?.twr ?? 0, e, 5);
    st.act = approach(st.act, (me.firing ? me.throttle : 0) * 100, e, 6);
    st.cmd = approach(st.cmd, (me.throttleCmd ?? 0) * 100, e, 8);
    pTW.position.y = maps.tw(st.tw);
    pAct.position.y = maps.th(st.act);
    pCmd.position.y = maps.th(st.cmd);
    void game;
    void opts;
  }
  return finish(group, W, H, update);
}

// ------------------------------------------------------------------------------ CSM GPI
/**
 * CSM SPS gimbal position / fuel pressure indicator (0.14 × 0.12 m): four edgewise meters —
 * PITCH and YAW gimbal (±6°, pointers 1 & 2 for the two servo loops, from mainEngine.gimbal x/y rad)
 * and SPS FUEL / OXID pressure (0-250 psia; ~175 psia when pressurised).
 */
export function createGPI(opts = {}) {
  const W = 0.14;
  const H = 0.12;
  const fr = 0.006;
  const xs = [-0.043, -0.012, 0.024, 0.052];
  const yLo = -0.034;
  const yHi = 0.03;
  const maps = [];
  const { group } = createCase({
    width: W,
    height: H,
    frame: fr,
    faceSpec: {
      draw(P) {
        const gFmt = (v) => (v > 0 ? `+${v}` : `${v}`);
        maps[0] = vScale(P, { x: xs[0], yLo, yHi, min: -6, max: 6, ticks: [-6, -4, -2, 0, 2, 4, 6], minor: 2, fmt: gFmt, size: 0.003 });
        maps[1] = vScale(P, { x: xs[1], yLo, yHi, min: -6, max: 6, ticks: [-6, -4, -2, 0, 2, 4, 6], minor: 2, fmt: gFmt, size: 0.003 });
        maps[2] = vScale(P, { x: xs[2], yLo, yHi, min: 0, max: 250, ticks: [0, 50, 100, 150, 200, 250], minor: 5, size: 0.0029, redline: [0, 150] });
        maps[3] = vScale(P, { x: xs[3], yLo, yHi, min: 0, max: 250, ticks: [0, 50, 100, 150, 200, 250], minor: 5, size: 0.0029, redline: [0, 150] });
        P.text('PITCH', xs[0], 0.0365, 0.0034);
        P.text('YAW', xs[1], 0.0365, 0.0034);
        P.text('FUEL', xs[2], 0.0365, 0.0034);
        P.text('OXID', xs[3], 0.0365, 0.0034);
        P.box({ x: (xs[0] + xs[1]) / 2 - 0.003, y: 0.004, w: 0.058, h: 0.093, title: 'GIMBAL POS', titleSize: 0.003 });
        P.box({ x: (xs[2] + xs[3]) / 2 - 0.003, y: 0.004, w: 0.056, h: 0.093, title: 'SPS PRESS', titleSize: 0.003 });
        P.text('DEG', (xs[0] + xs[1]) / 2, -0.0405, 0.0029);
        P.text('PSIA', (xs[2] + xs[3]) / 2, -0.0405, 0.0029);
      },
    },
  });
  const ptrs = xs.map((x, i) => {
    const arr = [];
    if (i < 2) {
      const a = orientPointer(sidePointer(0xdad9d0, 0.0036), '-x');
      a.position.set(x + 0.0046, 0, 0.0006);
      const b = orientPointer(sidePointer(0xff9b1a, 0.0036), '-x');
      b.position.set(x + 0.0046 + 0.0036, 0, 0.0009);
      arr.push(a, b);
    } else {
      const a = orientPointer(sidePointer(0xdad9d0), '-x');
      a.position.set(x + 0.0048, 0, 0.0006);
      arr.push(a);
    }
    group.add(...arr);
    return arr;
  });
  const lim = limiter(30);
  const st = [0, 0, 170, 170];
  function update(vessel, game, dt) {
    const e = lim.tick(dt);
    if (!e || !vessel) return;
    const gim = vessel.mainEngine?.gimbal;
    const firing = !!vessel.mainEngine?.firing;
    const tgt = [gim ? gim.x / DEG : 0, gim ? gim.y / DEG : 0, firing ? 172 : 178, firing ? 168 : 176];
    for (let i = 0; i < 4; i++) st[i] = approach(st[i], tgt[i], e, i < 2 ? 8 : 2);
    ptrs[0][0].position.y = maps[0](st[0]);
    ptrs[0][1].position.y = maps[0](st[0] * 0.98 + 0.05);
    ptrs[1][0].position.y = maps[1](st[1]);
    ptrs[1][1].position.y = maps[1](st[1] * 0.98 - 0.05);
    ptrs[2][0].position.y = maps[2](st[2]);
    ptrs[3][0].position.y = maps[3](st[3]);
    void game;
    void opts;
  }
  return finish(group, W, H, update);
}

// ------------------------------------------------------------------------------ drum counters
/**
 * Mechanical drum counter (odometer): white digits on black drums, the last drum rolls smoothly.
 * Returns { mesh, set(value) }. digits includes decimals (e.g. 3 digits, 1 decimal -> '63.5').
 */
function createDrumCounter(wM, hM, digits, decimals = 0) {
  const t = createCanvasTexture(wM, hM, 7000);
  const g = t.g;
  const Wp = t.canvas.width;
  const Hp = t.canvas.height;
  const mat = new THREE.MeshStandardMaterial({ map: t.texture, roughness: 0.5 });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(wM, hM), mat);
  mesh.receiveShadow = true;
  let last = null;
  const cellW = Wp / (digits + (decimals ? 0.35 : 0));
  const draw = (value) => {
    g.fillStyle = '#050505';
    g.fillRect(0, 0, Wp, Hp);
    const scaled = Math.max(0, value) * 10 ** decimals;
    let x = 0;
    for (let i = 0; i < digits; i++) {
      const place = 10 ** (digits - 1 - i);
      const raw = scaled / place;
      const d = Math.floor(raw) % 10;
      let frac = 0;
      if (i === digits - 1) frac = raw - Math.floor(raw);
      else {
        // carry: roll this drum while the lower drums pass 9 -> 0
        const lower = scaled % place;
        if (lower > place - 1) frac = lower - (place - 1);
      }
      const cx = x + cellW / 2;
      g.save();
      g.beginPath();
      g.rect(x + cellW * 0.06, 0, cellW * 0.88, Hp);
      g.clip();
      g.fillStyle = '#121212';
      g.fillRect(x + cellW * 0.06, 0, cellW * 0.88, Hp);
      for (const k of [0, 1]) {
        const dd = (d + k) % 10;
        const y = Hp / 2 + (k - frac) * Hp * 0.9; // current digit rolls up, next comes from below
        drawText(g, String(dd), cx, y, Hp * 0.72, { color: '#eeede6', condense: 0.8, caps: false, tracking: 0 });
      }
      // drum curvature shading
      const gr = g.createLinearGradient(0, 0, 0, Hp);
      gr.addColorStop(0, 'rgba(0,0,0,0.8)');
      gr.addColorStop(0.3, 'rgba(0,0,0,0)');
      gr.addColorStop(0.7, 'rgba(0,0,0,0)');
      gr.addColorStop(1, 'rgba(0,0,0,0.8)');
      g.fillStyle = gr;
      g.fillRect(x, 0, cellW, Hp);
      g.restore();
      x += cellW;
      if (decimals && i === digits - 1 - decimals) {
        g.fillStyle = '#eeede6';
        g.beginPath();
        g.arc(x + cellW * 0.17, Hp * 0.8, Hp * 0.06, 0, Math.PI * 2);
        g.fill();
        x += cellW * 0.35;
      }
    }
    t.texture.needsUpdate = true;
  };
  draw(0);
  return {
    mesh,
    set(v) {
      const q = Math.round(v * 10 ** decimals * 20) / 20;
      if (q === last) return;
      last = q;
      draw(v);
    },
  };
}

/**
 * CSM propellant quantity cluster (0.18 × 0.10 m): SPS OXID % and FUEL % drum counters, UNBAL meter
 * (oxidiser − fuel, lb: DEC/INC ±600) and SM RCS quantity meter (%).
 */
export function createPropellantGauges(opts = {}) {
  const W = 0.18;
  const H = 0.1;
  const fr = 0.006;
  let unbalMap = null;
  let rcsMap = null;
  const cx = -0.05;
  const rows = [0.0215, 0.0015];
  const { group } = createCase({
    width: W,
    height: H,
    frame: fr,
    holes: rows.map((y) => ({ x: cx + 0.006, y, w: 0.036, h: 0.0125, corner: 0.001 })),
    faceSpec: {
      draw(P) {
        P.box({ x: cx - 0.003, y: 0.0125, w: 0.068, h: 0.05, title: 'SPS QUANTITY', titleSize: 0.0033 });
        P.text('OXID', cx - 0.0255, rows[0], 0.0034, { align: 'center' });
        P.text('FUEL', cx - 0.0255, rows[1], 0.0034, { align: 'center' });
        P.text('%', cx + 0.029, rows[0], 0.0034);
        P.text('%', cx + 0.029, rows[1], 0.0034);
        unbalMap = hScale(P, { y: -0.0255, xLo: cx - 0.025, xHi: cx + 0.025, min: -600, max: 600, ticks: [-600, -300, 0, 300, 600], minor: 3, size: 0.0026, fmt: (v) => (v ? `${Math.abs(v)}` : '0') });
        P.text('DECR', cx - 0.0285, -0.0275, 0.0027, { align: 'right' });
        P.text('INCR', cx + 0.0285, -0.0275, 0.0027, { align: 'left' });
        P.text('UNBALANCE  LB', cx, -0.0385, 0.0028);
        rcsMap = vScale(P, { x: 0.052, yLo: -0.03, yHi: 0.026, min: 0, max: 100, ticks: [0, 25, 50, 75, 100], minor: 5, size: 0.0031, redline: [0, 10] });
        P.text('SM RCS', 0.052, 0.0365, 0.0034);
        P.text('QTY %', 0.052, -0.0372, 0.0029);
        P.box({ x: 0.051, y: 0.001, w: 0.05, h: 0.07, sides: 'lrb' });
      },
    },
  });
  const counters = rows.map((y) => {
    const c = createDrumCounter(0.036, 0.0125, 3, 1);
    c.mesh.position.set(cx + 0.006, y, -0.0022);
    group.add(c.mesh);
    return c;
  });
  const pU = orientPointer(sidePointer(0xdad9d0, 0.0036), '+y');
  pU.position.set(cx, -0.0305, 0.0006);
  const pR = orientPointer(sidePointer(0xdad9d0), '-x');
  pR.position.set(0.052 + 0.0048, 0, 0.0006);
  group.add(pU, pR);
  const lim = limiter(30);
  const st = { u: 0, r: 0 };
  function update(vessel, game, dt) {
    const e = lim.tick(dt);
    if (!e || !vessel) return;
    const p = vessel.propellant || {};
    const frac = p.mainMax ? p.main / p.mainMax : 0;
    const ox = clamp(frac * 100 + 0.35, 0, 99.9);
    const fu = clamp(frac * 100 - 0.2, 0, 99.9);
    counters[0].set(ox);
    counters[1].set(fu);
    st.u = approach(st.u, ((ox - fu) / 100) * 11200, e, 3);
    st.r = approach(st.r, p.rcsMax ? (p.rcs / p.rcsMax) * 100 : 0, e, 4);
    pU.position.x = unbalMap(st.u);
    pR.position.y = rcsMap(st.r);
    void game;
    void opts;
  }
  return finish(group, W, H, update);
}

// ------------------------------------------------------------------------------ digital readouts
/**
 * Generic 7-segment digital readout in a bezel (e.g. LM PRPLNT QTY, CSM counters).
 * opts: { digits=3, decimals=0, sign=false, color: 'el'|'red', label, getValue(vessel, game),
 *   width=0.07, height=0.035 }
 */
export function createDigitalReadout(opts = {}) {
  const W = opts.width || 0.07;
  const H = opts.height || 0.035;
  const nd = opts.digits || 3;
  const dec = opts.decimals || 0;
  const sign = !!opts.sign;
  const fr = 0.004;
  const winW = W - 2 * fr - 0.006;
  const winH = H - 2 * fr - (opts.label ? 0.009 : 0.004);
  const wy = opts.label ? -0.0025 : 0;
  const ON = opts.color === 'red' ? 'rgb(255,52,26)' : 'rgb(120,255,150)';
  const OFF = opts.color === 'red' ? '#2a0d0a' : '#18201a';
  const { group } = createCase({
    width: W,
    height: H,
    frame: fr,
    holes: [{ x: 0, y: wy, w: winW, h: winH, corner: 0.001 }],
    faceSpec: { draw(P) { if (opts.label) P.text(opts.label, 0, wy + winH / 2 + 0.0038, 0.0032); } },
    depth: 0.02,
  });
  const disp = createDisplay(winW, winH, { pxPerM: 7000 });
  disp.mesh.position.set(0, wy, -0.0025);
  group.add(disp.mesh);
  const Wp = disp.base.canvas.width;
  const Hp = disp.base.canvas.height;
  const n = nd + (sign ? 1 : 0);
  const dh = Hp * 0.72;
  const dw = Math.min(dh * 0.56, (Wp * 0.9) / (n * 1.3));
  const pitch = dw * 1.3;
  const x0 = (Wp - n * pitch + (pitch - dw)) / 2;
  const y0 = (Hp - dh) / 2;
  const seg = { t: dw * 0.16, gap: dw * 0.03, slant: opts.color === 'red' ? 0.09 : 0 };
  {
    const g = disp.base.g;
    g.fillStyle = opts.color === 'red' ? '#120404' : '#0c0f0d';
    g.fillRect(0, 0, Wp, Hp);
    for (let i = 0; i < n; i++) drawSegChar(g, ' ', x0 + i * pitch, y0, dw, dh, { ...seg, off: OFF, sign: sign && i === 0 });
    disp.base.texture.needsUpdate = true;
  }
  let last = null;
  const lim = limiter(20);
  function update(vessel, game, dt) {
    if (!lim.tick(dt) || !vessel) return;
    const v = opts.getValue ? opts.getValue(vessel, game) : 0;
    let s;
    if (!Number.isFinite(v)) s = ' '.repeat(n);
    else {
      const a = Math.round(Math.abs(v) * 10 ** dec);
      s = String(Math.min(a, 10 ** nd - 1)).padStart(nd, '0');
      if (sign) s = (v < 0 ? '-' : '+') + s;
    }
    if (s === last) return;
    last = s;
    disp.redraw((g) => {
      g.shadowColor = ON;
      g.shadowBlur = dw * 0.1;
      for (let i = 0; i < n; i++) drawSegChar(g, s[i], x0 + i * pitch, y0, dw, dh, { ...seg, on: ON, sign: sign && i === 0 });
      if (dec) {
        g.fillStyle = ON;
        const xi = x0 + (n - dec) * pitch - (pitch - dw) / 2;
        g.beginPath();
        g.arc(xi, y0 + dh - dw * 0.08, dw * 0.1, 0, Math.PI * 2);
        g.fill();
      }
    });
  }
  return finish(group, W, H, update);
}
