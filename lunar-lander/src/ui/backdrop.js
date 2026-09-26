// Title-screen backdrop: a procedural starfield, the lunar limb seen from orbit in low sunlight,
// and the Earth hanging above the horizon — drawn on a 2D canvas (the 3D canvas is still black
// before a scenario is loaded, and the title must be beautiful on its own).
//
// The Moon is shaded per pixel from a procedural crater field: several octaves of craters living
// in 3D grid cells around the unit sphere (a crater is a sphere around a random point in its cell;
// where that sphere cuts the lunar surface it leaves a circular bowl with a raised rim and ejecta
// apron, so depth-in-cell gives natural size variety). The crater profile's analytic gradient bends
// the surface normal; lighting uses Lommel–Seeliger lunar photometry (no Lambert limb darkening:
// the full Moon's limb stays bright), so the terminator side shows long, crisp crater relief.
// The Moon is computed once per canvas size, time-sliced (~6 ms per frame) and faded in.
//
// createBackdrop(canvas) -> { start(), stop(), resize() }


// ---------------------------------------------------------------- hashing & noise
function hash(x, y, z, s) {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(z | 0, 0x9e3779b1) ^ Math.imul(s | 0, 0x85ebca6b);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

const fade = (t) => t * t * (3 - 2 * t);

/** Smooth 3D value noise in [0,1). */
function vnoise(x, y, z, s) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = fade(x - ix), fy = fade(y - iy), fz = fade(z - iz);
  const a = hash(ix, iy, iz, s), b = hash(ix + 1, iy, iz, s);
  const c = hash(ix, iy + 1, iz, s), d = hash(ix + 1, iy + 1, iz, s);
  const e = hash(ix, iy, iz + 1, s), f = hash(ix + 1, iy, iz + 1, s);
  const g = hash(ix, iy + 1, iz + 1, s), k = hash(ix + 1, iy + 1, iz + 1, s);
  const x1 = a + (b - a) * fx, x2 = c + (d - c) * fx, x3 = e + (f - e) * fx, x4 = g + (k - g) * fx;
  const y1 = x1 + (x2 - x1) * fy, y2 = x3 + (x4 - x3) * fy;
  return y1 + (y2 - y1) * fz;
}

// ---------------------------------------------------------------- crater field
// Octaves: cells per unit radius, probability of a crater in a cell, max radius (cells), depth/radius.
const OCTAVES = [
  { f: 4, p: 0.3, r: 0.5, d: 0.14 },
  { f: 9, p: 0.4, r: 0.5, d: 0.2 },
  { f: 20, p: 0.45, r: 0.48, d: 0.28 },
  { f: 45, p: 0.55, r: 0.46, d: 0.34 },
  { f: 100, p: 0.6, r: 0.45, d: 0.4 },
  { f: 220, p: 0.65, r: 0.42, d: 0.42 },
  { f: 480, p: 0.7, r: 0.4, d: 0.42 },
];

let _shadow = 1; // crater self-shadowing factor of the last craters() call (1 = lit)

/**
 * Crater relief at unit-sphere point p: accumulates the height gradient (in the same units as p)
 * into g[0..2] and returns an albedo modifier (fresh craters are bright, old floors darker).
 * (sx, sy, sz) is the Sun direction projected on the local horizontal plane (unit) and tanE the
 * tangent of the Sun elevation: points of a bowl whose line toward the Sun passes below the
 * up-Sun rim are in shadow (sets _shadow) — the long crater shadows of a low Sun.
 */
function craters(px, py, pz, g, maxOct, sx, sy, sz, tanE) {
  let alb = 0;
  _shadow = 1;
  for (let o = 0; o < maxOct; o++) {
    const O = OCTAVES[o];
    const qx = px * O.f, qy = py * O.f, qz = pz * O.f;
    const bx = Math.floor(qx - 0.5), by = Math.floor(qy - 0.5), bz = Math.floor(qz - 0.5);
    for (let i = 0; i < 8; i++) {
      const cx = bx + (i & 1), cy = by + ((i >> 1) & 1), cz = bz + ((i >> 2) & 1);
      if (hash(cx, cy, cz, o * 7 + 1) > O.p) continue;
      // crater sphere centre inside the cell and its radius
      const ox = cx + hash(cx, cy, cz, o * 7 + 2), oy = cy + hash(cx, cy, cz, o * 7 + 3), oz = cz + hash(cx, cy, cz, o * 7 + 4);
      const rr = hash(cx, cy, cz, o * 7 + 5);
      const R = O.r * (0.35 + 0.65 * rr * rr);
      const dx = qx - ox, dy = qy - oy, dz = qz - oz;
      const d2 = dx * dx + dy * dy + dz * dz;
      const reach = R * 1.7;
      if (d2 >= reach * reach) continue;
      const d = Math.sqrt(d2) + 1e-9;
      const t = d / R;
      const depth = O.d * R;
      const rim = depth * 0.28;
      // dP/dt of the radial profile (bowl + rim + ejecta apron), P in cell units
      let dPdt;
      if (t < 1) {
        dPdt = 2 * depth * t + 6 * rim * t * t * t * t * t; // P = -depth(1-t^2) + rim t^6
        // self-shadow: height of the ray toward the Sun where it crosses the up-Sun rim
        const a = (dx * sx + dy * sy + dz * sz) / R; // along-Sun coordinate (crater radii)
        const w2 = Math.max(0, t * t - a * a);
        const D = Math.sqrt(Math.max(0, 1 - w2)) - a; // distance to the rim toward the Sun
        const t2 = t * t;
        const Pn = -O.d * (1 - t2) + O.d * 0.28 * t2 * t2 * t2; // height / R
        const below = O.d * 0.28 - (Pn + tanE * D);
        if (below > 0) _shadow = Math.min(_shadow, 1 - Math.min(1, below / (0.015 + 0.02 * O.d)));
      } else {
        const u = (t - 1) / 0.7; // apron falls to zero at t = 1.7
        dPdt = (-2 * rim * (1 - u)) / 0.7;
      }
      // gradient in world units: dP/dq = dPdt / R * (q - c)/d; q = p * f  =>  dP/dp = f * dP/dq;
      // height in world units = P / f, so the f's cancel.
      const k = dPdt / (R * d);
      g[0] += k * dx;
      g[1] += k * dy;
      g[2] += k * dz;
      const fresh = hash(cx, cy, cz, o * 7 + 6);
      if (fresh < 0.1 && t < 1.5) alb += (0.35 - fresh) * (1 - t / 1.5) * (o >= 2 ? 1 : 0.4);
      else if (t < 0.8 && o < 3) alb -= 0.06;
    }
  }
  return alb;
}

/** Rolling terrain: gradient of two octaves of value noise (forward differences). */
function hills(qx, qy, qz, g) {
  const e = 0.004;
  for (let k = 0; k < 2; k++) {
    const F = k === 0 ? 13 : 34;
    const A = k === 0 ? 0.011 : 0.0035;
    const x = qx * F, y = qy * F, z = qz * F;
    const h0 = vnoise(x, y, z, 21 + k);
    const ef = e * F;
    g[0] += (A * (vnoise(x + ef, y, z, 21 + k) - h0)) / e;
    g[1] += (A * (vnoise(x, y + ef, z, 21 + k) - h0)) / e;
    g[2] += (A * (vnoise(x, y, z + ef, 21 + k) - h0)) / e;
  }
}

// ---------------------------------------------------------------- the backdrop
export function createBackdrop(canvas) {
  const ctx2d = canvas.getContext('2d');
  let W = 0, H = 0, dpr = 1;
  let stars = [];
  let moon = null; // {canvas, ctx, img, row, done, geom, fadeT}
  let earth = null;
  let raf = 0;
  let running = false;
  let t0 = performance.now();
  let lastDraw = 0;
  let sprite = null;
  let glow = null;

  // Sun direction for the scene (x right, y up, z toward the viewer): low from the right.
  const L = normalize([0.66, 0.2, 0.16]);
  const Lq = [L[0] * 0.8 + L[2] * 0.6, L[1], -L[0] * 0.6 + L[2] * 0.8]; // same rotation as the crater lookup

  function normalize(v) {
    const l = Math.hypot(v[0], v[1], v[2]);
    return [v[0] / l, v[1] / l, v[2] / l];
  }

  function layout() {
    // Lunar limb: a huge disc whose top edge sits ~64% down the screen (a bit lower on phones).
    const portrait = H > W * 1.1;
    const R = Math.max(W, H) * (portrait ? 1.1 : 1.45);
    const top = H * (portrait ? 0.7 : 0.62);
    return {
      R,
      cx: W * (portrait ? 0.62 : 0.56),
      cy: top + R,
      top,
      earth: { x: W * (portrait ? 0.74 : 0.78), y: top - H * (portrait ? 0.13 : 0.2), r: Math.max(9, Math.min(W, H) * 0.034) },
    };
  }

  function makeSprite() {
    const c = document.createElement('canvas');
    c.width = c.height = 32;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.12, 'rgba(255,255,255,0.8)');
    gr.addColorStop(0.35, 'rgba(200,215,255,0.16)');
    gr.addColorStop(1, 'rgba(200,215,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 32, 32);
    return c;
  }

  /** Soft Milky-Way glow along the star band, prerendered at low resolution. */
  function makeGlow() {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = Math.max(16, Math.round((256 * H) / W));
    const g = c.getContext('2d');
    const sx = c.width / W, sy = c.height / H;
    for (let i = 0; i < 9; i++) {
      const u = (i + 0.5) / 9;
      const x = u * W * sx, y = (H * 0.9 - u * H * 0.75) * sy;
      const r = (0.18 + 0.1 * hash(i, 3, 3, 7)) * H * sy * 1.6;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      const a = 0.05 + 0.04 * hash(i, 5, 5, 7);
      gr.addColorStop(0, `rgba(150,160,190,${a})`);
      gr.addColorStop(1, 'rgba(150,160,190,0)');
      g.fillStyle = gr;
      g.fillRect(0, 0, c.width, c.height);
    }
    return c;
  }

  function makeStars() {
    // deterministic star field; density scales with area, Milky-Way band gets extra faint stars
    const n = Math.round((W * H) / 520);
    const out = [];
    let seed = 1;
    const rnd = () => hash(seed++, 17, 3, 99);
    for (let i = 0; i < n; i++) {
      let x = rnd() * W, y = rnd() * H;
      const band = rnd() < 0.3; // concentrate part of the stars in a diagonal band
      if (band) {
        const u = rnd();
        const off = (rnd() + rnd() + rnd() + rnd() - 2) * H * 0.16;
        x = u * W;
        y = H * 0.9 - u * H * 0.75 + off;
      }
      const m = Math.pow(rnd(), band ? 7 : 5); // brightness distribution: many faint, few bright
      const temp = rnd();
      const col = temp < 0.15 ? [255, 214, 170] : temp < 0.3 ? [190, 210, 255] : temp < 0.4 ? [255, 240, 220] : [236, 240, 255];
      const a = Math.min(1, m * 1.6 + 0.08);
      out.push({ x, y, m, a, fill: `rgba(${col[0]},${col[1]},${col[2]},${a.toFixed(3)})`, size: m > 0.15 ? 1.4 : 1, par: 0.4 + rnd() * 0.6 });
    }
    return out;
  }

  // ---------------------------------------------------------------- Moon (time-sliced)
  function startMoon() {
    const geom = layout();
    // compute at up to 1x CSS pixels (the limb is still crisp; interior detail is procedural)
    const scale = Math.min(1, 2000 / Math.max(W, 1));
    const mw = Math.max(1, Math.round(W * scale));
    const y0 = Math.max(0, Math.floor(geom.top * scale) - 2);
    const mh = Math.max(1, Math.round(H * scale) - y0);
    const c = document.createElement('canvas');
    c.width = mw;
    c.height = mh;
    const cx = c.getContext('2d');
    const img = cx.createImageData(mw, mh);
    moon = { canvas: c, ctx: cx, img, row: 0, done: false, geom, scale, y0, mw, mh, fadeT: 0 };
  }

  function stepMoon(budgetMs) {
    const m = moon;
    if (!m || m.done) return;
    const t1 = performance.now() + budgetMs;
    const { R, cx, cy } = m.geom;
    const s = m.scale;
    const data = m.img.data;
    const g = [0, 0, 0];
    const Rs = R * s;
    // octaves finer than ~1.5 px are skipped (they would only alias)
    let maxOct = 0;
    for (const O of OCTAVES) if ((Rs / O.f) * O.r * 2 > 1.5) maxOct++;
    while (m.row < m.mh) {
      const py = m.row + m.y0 + 0.5;
      const dyv = (py / s - cy) / R;
      for (let px = 0; px < m.mw; px++) {
        const dxv = ((px + 0.5) / s - cx) / R;
        const r2 = dxv * dxv + dyv * dyv;
        const i4 = (m.row * m.mw + px) * 4;
        if (r2 >= 1) {
          data[i4 + 3] = 0;
          continue;
        }
        const nx = dxv, ny = -dyv, nz = Math.sqrt(1 - r2);
        // limb anti-aliasing: coverage from the distance to the edge in pixels
        const edge = (1 - Math.sqrt(r2)) * Rs;
        const cov = edge < 1 ? Math.max(0, edge) : 1;
        // rotate the lookup so the visible limb region is not aligned with the noise axes
        const qx = nx * 0.8 + nz * 0.6, qy = ny, qz = -nx * 0.6 + nz * 0.8;
        g[0] = g[1] = g[2] = 0;
        // Sun in the rotated lookup frame, split into horizontal direction + elevation
        const lu = Lq[0] * qx + Lq[1] * qy + Lq[2] * qz;
        let hx = Lq[0] - lu * qx, hy = Lq[1] - lu * qy, hz = Lq[2] - lu * qz;
        const hl = Math.hypot(hx, hy, hz) || 1;
        hx /= hl; hy /= hl; hz /= hl;
        const albC = craters(qx, qy, qz, g, maxOct, hx, hy, hz, lu / hl);
        const sh = _shadow;
        hills(qx, qy, qz, g);
        // gradient back into view space
        const gx = g[0] * 0.8 - g[2] * 0.6, gy = g[1], gz = g[0] * 0.6 + g[2] * 0.8;
        // tangential part of the gradient tilts the normal
        const gn = gx * nx + gy * ny + gz * nz;
        let Nx = nx - (gx - gn * nx), Ny = ny - (gy - gn * ny), Nz = nz - (gz - gn * nz);
        const nl = Math.hypot(Nx, Ny, Nz);
        Nx /= nl; Ny /= nl; Nz /= nl;
        // albedo: maria (dark, smooth) vs highlands, plus fine mottling
        const mare = vnoise(qx * 2.3 + 4, qy * 2.3, qz * 2.3, 5) * 0.7 + vnoise(qx * 6, qy * 6, qz * 6, 6) * 0.3;
        let alb = 0.55 + 0.6 * Math.min(1, Math.max(0, (mare - 0.45) * 3.2));
        alb *= 0.9 + 0.2 * vnoise(qx * 90, qy * 90, qz * 90, 8);
        alb += albC;
        // Lommel–Seeliger photometry (+ a little Lambert), incidence from the bumped normal
        const mu0 = Nx * L[0] + Ny * L[1] + Nz * L[2];
        const mu = Math.max(0.02, Nz);
        let I = 0;
        if (mu0 > 0) I = sh * alb * (1.55 * (mu0 / (mu0 + mu)) + 0.25 * mu0);
        // smooth terminator on the unbumped sphere (no light where the sphere itself is dark)
        const muS = nx * L[0] + ny * L[1] + nz * L[2];
        I *= Math.min(1, Math.max(0, (muS + 0.02) * 9));
        // tone map (filmic-ish), warm-grey tint, faint bluish earthshine in the night
        const e = 1 - Math.exp(-I * 1.0);
        const es = 0.012 * alb;
        data[i4] = Math.min(255, (e * 1.0 + es * 0.8) * 255);
        data[i4 + 1] = Math.min(255, (e * 0.965 + es * 0.9) * 255);
        data[i4 + 2] = Math.min(255, (e * 0.9 + es * 1.25) * 255);
        data[i4 + 3] = cov * 255;
      }
      m.row++;
      if ((m.row & 3) === 0 && performance.now() > t1) break;
    }
    if (m.row >= m.mh) {
      m.ctx.putImageData(m.img, 0, 0);
      m.img = null;
      m.done = true;
    }
  }

  // ---------------------------------------------------------------- Earth
  function makeEarth() {
    const e = layout().earth;
    const r = e.r * dpr;
    const size = Math.ceil(r * 2 + 8 * dpr);
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    const img = g.createImageData(size, size);
    const d = img.data;
    const o = size / 2;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const nx = (x + 0.5 - o) / r, ny = -(y + 0.5 - o) / r;
        const r2 = nx * nx + ny * ny;
        const i4 = (y * size + x) * 4;
        const rr = Math.sqrt(r2);
        if (r2 >= 1) {
          // thin atmosphere glow just outside the lit limb
          const a = Math.max(0, 1 - (rr - 1) * r / (3.2 * dpr));
          const lit = Math.max(0, (nx * L[0] + ny * L[1]) / (rr || 1));
          d[i4] = 110; d[i4 + 1] = 170; d[i4 + 2] = 255; d[i4 + 3] = 255 * a * a * 0.55 * lit;
          continue;
        }
        const nz = Math.sqrt(1 - r2);
        // texture coordinates on the globe (slightly rotated so continents are not centred)
        const lon = Math.atan2(nx, nz) + 0.9, lat = Math.asin(ny);
        const sx = Math.cos(lat) * Math.cos(lon), sy = Math.sin(lat), sz = Math.cos(lat) * Math.sin(lon);
        const land = vnoise(sx * 2.2 + 10, sy * 2.2, sz * 2.2, 11) * 0.65 + vnoise(sx * 5, sy * 5, sz * 5, 12) * 0.35;
        const cloud = vnoise(sx * 3.5 + sy * 2, sy * 7, sz * 3.5, 13) * 0.6 + vnoise(sx * 9, sy * 12, sz * 9, 14) * 0.4;
        let cr = 0.04, cg = 0.1, cb = 0.3; // ocean
        if (land > 0.56) { cr = 0.36; cg = 0.3; cb = 0.18; }
        const cl = Math.min(1, Math.max(0, (cloud - 0.5) * 3.2)) + (Math.abs(lat) > 1.2 ? 0.8 : 0);
        cr += (0.95 - cr) * Math.min(1, cl);
        cg += (0.96 - cg) * Math.min(1, cl);
        cb += (1.0 - cb) * Math.min(1, cl);
        const mu0 = nx * L[0] + ny * L[1] + nz * L[2];
        const lit = Math.min(1, Math.max(0, mu0 * 1.1 + 0.05));
        // Rayleigh-ish blue limb brightening on the day side
        const rim = Math.pow(1 - nz, 3) * lit;
        const I = lit * 1.6;
        const edge = Math.min(1, (1 - rr) * r);
        d[i4] = Math.min(255, (1 - Math.exp(-(cr * I + rim * 0.25))) * 255);
        d[i4 + 1] = Math.min(255, (1 - Math.exp(-(cg * I + rim * 0.45))) * 255);
        d[i4 + 2] = Math.min(255, (1 - Math.exp(-(cb * I + rim * 0.9))) * 255);
        d[i4 + 3] = 255 * Math.max(0, edge);
      }
    }
    g.putImageData(img, 0, 0);
    earth = { canvas: c, x: e.x, y: e.y, size: size / dpr };
  }

  // ---------------------------------------------------------------- drawing
  function draw(now) {
    const t = (now - t0) / 1000;
    const g = ctx2d;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#000';
    g.fillRect(0, 0, W, H);

    // faint galactic glow along the star band (a few soft blobs)
    if (glow) g.drawImage(glow, 0, 0, W, H);

    // stars drift slowly (orbital motion), bright ones get a soft sprite
    const drift = t * 2.2;
    for (const s of stars) {
      let x = (s.x - drift * s.par) % W;
      if (x < 0) x += W;
      if (s.m > 0.7) {
        const sz = 2.5 + s.m * 7;
        g.globalAlpha = s.a;
        g.drawImage(sprite, x - sz / 2, s.y - sz / 2, sz, sz);
        g.globalAlpha = 1;
      } else {
        g.fillStyle = s.fill;
        g.fillRect(x, s.y, s.size, s.size);
      }
    }

    // Earth (left out on portrait screens, where the menu covers the sky)
    if (earth && W > H) g.drawImage(earth.canvas, earth.x - earth.size / 2, earth.y - earth.size / 2, earth.size, earth.size);

    // Moon (fades in once computed)
    if (moon) {
      if (!moon.done) stepMoon(9);
      if (moon.done) {
        moon.fadeT = Math.min(1, moon.fadeT + 0.03);
        g.globalAlpha = fade(moon.fadeT);
        g.imageSmoothingEnabled = true;
        g.imageSmoothingQuality = 'high';
        g.drawImage(moon.canvas, 0, moon.y0 / moon.scale, W, moon.mh / moon.scale);
        g.globalAlpha = 1;
      }
    }

    // sun glare off-frame upper right
    const sg = g.createRadialGradient(W * 1.02, H * 0.08, 0, W * 1.02, H * 0.08, Math.max(W, H) * 0.55);
    sg.addColorStop(0, 'rgba(255,236,205,0.16)');
    sg.addColorStop(0.25, 'rgba(255,225,190,0.05)');
    sg.addColorStop(1, 'rgba(255,220,180,0)');
    g.fillStyle = sg;
    g.fillRect(0, 0, W, H);
  }

  function loop(now) {
    if (!running) return;
    raf = requestAnimationFrame(loop);
    // ~30 fps is plenty for a slow drift; the moon computation still gets every frame
    if (now - lastDraw < 30 && moon?.done && moon.fadeT >= 1) return;
    lastDraw = now;
    draw(now);
  }

  function resize() {
    const w = Math.max(1, canvas.clientWidth || window.innerWidth);
    const h = Math.max(1, canvas.clientHeight || window.innerHeight);
    // crisp on HiDPI, but keep the backing store under ~6 Mpx (4K screens)
    const d = Math.max(1, Math.min(2, window.devicePixelRatio || 1, Math.sqrt(6e6 / (w * h))));
    if (w === W && h === H && d === dpr && moon) return;
    W = w;
    H = h;
    dpr = d;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    stars = makeStars();
    glow = makeGlow();
    startMoon();
    makeEarth();
    if (running) draw(performance.now());
  }

  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => running && resize(), 150);
  });

  return {
    start() {
      if (running) return;
      running = true;
      sprite = sprite || makeSprite();
      resize();
      raf = requestAnimationFrame(loop);
    },
    stop() {
      running = false;
      cancelAnimationFrame(raf);
    },
    resize,
    /** Finish the Moon synchronously (tests / screenshots). */
    finish() {
      while (moon && !moon.done) stepMoon(1000);
      if (moon) moon.fadeT = 1;
      if (running) draw(performance.now());
    },
  };
}
