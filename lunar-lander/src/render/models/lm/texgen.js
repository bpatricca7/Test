// Pure procedural texture generators for the LM exterior (no three.js, no DOM) — run in a Web
// Worker in the browser (texgen.worker.js) and synchronously in node tests.
//
//   genFoil  — crinkled aluminized Kapton / Mylar thermal blankets. Crumpled foil is a mosaic of
//              flat facets with sharp creases, so the normal field is built from three scales of
//              tileable Voronoi cells, each cell carrying a random tilt, plus long fold lines and a
//              gentle low-frequency undulation. Colour/roughness vary per facet, which is what makes
//              the foil sparkle and flicker between dark (reflecting black sky) and bright gold
//              (reflecting the sunlit lunar ground) — the signature LM look.
//   genQuilt — stitched multi-layer blankets: pillows + seams + fabric wrinkles.
//   genPanel — ascent-stage micrometeoroid-shield skin: random rectangular panels, seams, rivets.
//
// Every generator returns RGBA Uint8Arrays of size*size*4 (tileable). Normal maps are tangent space
// (row 0 = v 0), roughness in G (B = 255), tint is sRGB.

/** Small deterministic PRNG (mulberry32). Returns a function -> [0,1). */
export function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Gaussian-ish random (sum of 3 uniforms, centred, unit-ish variance). */
function gauss(r) {
  return (r() + r() + r() - 1.5) * 2.0;
}

// ------------------------------------------------------------------ tileable noise helpers

/** Periodic value noise on an n x n lattice (smooth, tileable over [0,1)). */
function makeValueNoise(n, r) {
  const g = new Float32Array(n * n);
  for (let i = 0; i < g.length; i++) g[i] = r() * 2 - 1;
  return function (u, v) {
    const x = u * n;
    const y = v * n;
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const fx = x - xi;
    const fy = y - yi;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const x0 = ((xi % n) + n) % n;
    const y0 = ((yi % n) + n) % n;
    const x1 = (x0 + 1) % n;
    const y1 = (y0 + 1) % n;
    const a = g[y0 * n + x0];
    const b = g[y0 * n + x1];
    const c = g[y1 * n + x0];
    const d = g[y1 * n + x1];
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
}

/**
 * Tileable Voronoi: returns for every pixel the index of the nearest feature point and the
 * distance difference to the second nearest (edge proximity). `cells` feature points per side,
 * `sy` stretches cells vertically (<1 = taller cells).
 */
function voronoi(size, cells, r, sy = 1) {
  const n = cells;
  const px = new Float32Array(n * n);
  const py = new Float32Array(n * n);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      px[j * n + i] = (i + 0.1 + 0.8 * r()) / n;
      py[j * n + i] = (j + 0.1 + 0.8 * r()) / n;
    }
  }
  const id = new Int32Array(size * size);
  const edge = new Float32Array(size * size);
  const cx = new Float32Array(9);
  const cy = new Float32Array(9);
  const ck = new Int32Array(9);
  // iterate block by block: all pixels of a lattice cell share the same 3x3 candidate set
  for (let cj = 0; cj < n; cj++) {
    const y0 = Math.floor((cj * size) / n);
    const y1 = Math.floor(((cj + 1) * size) / n);
    for (let ci = 0; ci < n; ci++) {
      const x0 = Math.floor((ci * size) / n);
      const x1 = Math.floor(((ci + 1) * size) / n);
      let m = 0;
      for (let dj = -1; dj <= 1; dj++) {
        const jj = cj + dj;
        const wj = (jj + n) % n;
        const oy = (jj - wj) / n;
        for (let di = -1; di <= 1; di++) {
          const ii = ci + di;
          const wi = (ii + n) % n;
          const ox = (ii - wi) / n;
          const k = wj * n + wi;
          cx[m] = px[k] + ox;
          cy[m] = py[k] + oy;
          ck[m] = k;
          m++;
        }
      }
      for (let y = y0; y < y1; y++) {
        const v = (y + 0.5) / size;
        for (let x = x0; x < x1; x++) {
          const u = (x + 0.5) / size;
          let d1 = 1e9;
          let d2 = 1e9;
          let best = 0;
          for (let q = 0; q < 9; q++) {
            const dx = cx[q] - u;
            const dy = (cy[q] - v) * sy;
            const d = dx * dx + dy * dy;
            if (d < d1) {
              d2 = d1;
              d1 = d;
              best = ck[q];
            } else if (d < d2) d2 = d;
          }
          const o = y * size + x;
          id[o] = best;
          edge[o] = (Math.sqrt(d2) - Math.sqrt(d1)) * n; // 0 on the crease, ~0.5 in the cell middle
        }
      }
    }
  }
  return { id, edge, count: n * n };
}

/** Height field (Float32Array size^2, tileable) -> tangent-space normal map bytes. */
function heightToNormal(h, size, strength, out, tiltX = null, tiltY = null) {
  for (let y = 0; y < size; y++) {
    const ym = ((y - 1 + size) % size) * size;
    const yp = ((y + 1) % size) * size;
    const yc = y * size;
    for (let x = 0; x < size; x++) {
      const xm = (x - 1 + size) % size;
      const xp = (x + 1) % size;
      let dx = (h[yc + xp] - h[yc + xm]) * 0.5 * strength;
      let dy = (h[yp + x] - h[ym + x]) * 0.5 * strength;
      if (tiltX) {
        dx += tiltX[yc + x];
        dy += tiltY[yc + x];
      }
      // texture v grows downward in memory but UV v grows up (flipY=false for DataTexture:
      // row 0 = v 0), so +y in memory == +v: normal = (-dh/du, -dh/dv, 1)
      const nx = -dx;
      const ny = -dy;
      const inv = 1 / Math.sqrt(nx * nx + ny * ny + 1);
      const o = (yc + x) * 4;
      out[o] = Math.round((nx * inv * 0.5 + 0.5) * 255);
      out[o + 1] = Math.round((ny * inv * 0.5 + 0.5) * 255);
      out[o + 2] = Math.round((inv * 0.5 + 0.5) * 255);
      out[o + 3] = 255;
    }
  }
  return out;
}

// ------------------------------------------------------------------ periodic gradient noise

/**
 * Tileable 2D Perlin (gradient) noise with nx x ny lattice cells over [0,1)^2. Returns f(u,v) ~ [-1,1].
 */
function makePerlin(nx, ny, r) {
  const gx = new Float32Array(nx * ny);
  const gy = new Float32Array(nx * ny);
  for (let i = 0; i < nx * ny; i++) {
    const a = r() * Math.PI * 2;
    gx[i] = Math.cos(a);
    gy[i] = Math.sin(a);
  }
  return function (u, v) {
    const x = u * nx;
    const y = v * ny;
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const fx = x - xi;
    const fy = y - yi;
    const x0 = ((xi % nx) + nx) % nx;
    const y0 = ((yi % ny) + ny) % ny;
    const x1 = (x0 + 1) % nx;
    const y1 = (y0 + 1) % ny;
    const k00 = y0 * nx + x0;
    const k10 = y0 * nx + x1;
    const k01 = y1 * nx + x0;
    const k11 = y1 * nx + x1;
    const n00 = gx[k00] * fx + gy[k00] * fy;
    const n10 = gx[k10] * (fx - 1) + gy[k10] * fy;
    const n01 = gx[k01] * fx + gy[k01] * (fy - 1);
    const n11 = gx[k11] * (fx - 1) + gy[k11] * (fy - 1);
    const sx = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
    const sy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
    const a = n00 + (n10 - n00) * sx;
    const b = n01 + (n11 - n01) * sx;
    return (a + (b - a) * sy) * 1.41;
  };
}

// ------------------------------------------------------------------ crinkled foil

/**
 * Crinkled foil set: { normal, rough, tint } tileable RGBA arrays. One tile is meant to cover
 * ~2.4 m of blanket (see materials.js). Reference: the Apollo 11 LM (AS11-40-5863, -5927) — the
 * Kapton is creased into facets of ~5-30 cm between long sags and fold lines, which gives broad
 * amber-to-brown gradients and a few large highlights, not centimetre-scale glitter. So:
 *   - height: domain-warped RIDGED noise (1-|n|)^k for the long sags (~1 m) and secondary ridges
 *     (~40 cm), stretched vertically because blankets hang, plus short straight creases where the
 *     film was folded flat once and opened again;
 *   - facets: two tileable Voronoi mosaics carrying random tilts — the main crumple (~15 cm cells,
 *     5-30 cm range) and a much weaker fine octave (~6 cm, ~0.2x the tilt) that only breaks up
 *     the flat facets without turning them into mirrors;
 *   - roughness never below 0.3 (micro-wrinkles below the texel scale), rougher along creases;
 *   - tint varies per large facet and in broad patches (luminance mostly, a little hue), darker
 *     in the creases.
 */
export function genFoil(size = 1024, seed = 7) {
  const r = rng(seed);
  const N = size * size;
  const warpA = makePerlin(4, 4, r);
  const warpB = makePerlin(4, 4, r);
  const n1 = makePerlin(3, 2, r); // long sags (~0.8-1.2 m), vertical bias
  const n2 = makePerlin(7, 5, r); // secondary ridges (~35-50 cm)
  const n3 = makePerlin(19, 15, r); // gentle ripple (~15 cm), low weight
  const n4 = makePerlin(3, 3, r); // film colour patches
  const n5 = makePerlin(5, 4, r); // broad tone (amber <-> brown)
  // straight creases (tent profile): 12-50 cm long, 1.5-4 cm wide
  const lines = [];
  for (let i = 0; i < 30; i++) {
    const a = (r() - 0.5) * Math.PI * (r() < 0.6 ? 0.5 : 1.0) + Math.PI / 2; // mostly near-vertical
    const w = 0.006 + r() * 0.011;
    lines.push({ cx: r(), cy: r(), ux: Math.cos(a), uy: Math.sin(a), len: 0.05 + r() * 0.16, w, amp: w * (0.25 + r() * 0.45) * (r() < 0.5 ? -1 : 1) });
  }
  const h = new Float32Array(N);
  const crease = new Float32Array(N);
  const patch = new Float32Array(N);
  const tone = new Float32Array(N);
  for (let y = 0; y < size; y++) {
    const v = (y + 0.5) / size;
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size;
      const wu = u + 0.05 * warpA(u, v);
      const wv = v + 0.05 * warpB(u, v);
      const a1 = 1 - Math.abs(n1(wu, wv));
      const a2 = 1 - Math.abs(n2(wu, wv));
      const a3 = n3(wu, wv);
      const i = y * size + x;
      let hh = 0.03 * a1 * a1 + 0.008 * a2 * a2 * a2 + 0.0008 * a3;
      let cr = Math.max(Math.pow(a1, 40), 0.6 * Math.pow(a2, 50));
      for (const L of lines) {
        let dx = u - L.cx;
        let dy = v - L.cy;
        dx -= Math.round(dx);
        dy -= Math.round(dy);
        const s2 = -dx * L.uy + dy * L.ux;
        if (s2 > L.w || s2 < -L.w) continue;
        const along = dx * L.ux + dy * L.uy;
        if (along > L.len || along < -L.len) continue;
        const fade = 1 - Math.pow(Math.abs(along) / L.len, 2);
        const t = 1 - Math.abs(s2) / L.w;
        hh += L.amp * fade * t * t;
        cr = Math.max(cr, fade * Math.pow(t, 12) * 0.8);
      }
      h[i] = hh;
      crease[i] = cr;
      patch[i] = n4(u, v);
      tone[i] = n5(wu, wv);
    }
  }
  // crumpled facets as additive tilts: main mosaic + weak fine octave
  const tx = new Float32Array(N);
  const ty = new Float32Array(N);
  const facet = new Float32Array(N);
  const vA = voronoi(size, 15, r, 0.65); // taller cells: the blankets hang
  const vB = voronoi(size, 40, r, 0.8);
  const aX = new Float32Array(vA.count);
  const aY = new Float32Array(vA.count);
  const aV = new Float32Array(vA.count);
  for (let k = 0; k < vA.count; k++) {
    aX[k] = gauss(r) * 0.1;
    aY[k] = gauss(r) * 0.13;
    aV[k] = r();
  }
  const bX = new Float32Array(vB.count);
  const bY = new Float32Array(vB.count);
  for (let k = 0; k < vB.count; k++) {
    bX[k] = gauss(r) * 0.02;
    bY[k] = gauss(r) * 0.026;
  }
  for (let i = 0; i < N; i++) {
    const a = vA.id[i];
    const b = vB.id[i];
    tx[i] = aX[a] + bX[b];
    ty[i] = aY[a] + bY[b];
    facet[i] = aV[a];
    // the facet boundaries of the main mosaic are creases too (thin, darker, rougher)
    const e = vA.edge[i];
    if (e < 0.018) crease[i] = Math.max(crease[i], 0.3 * (1 - e / 0.018));
  }
  const nrm = new Uint8Array(N * 4);
  heightToNormal(h, size, size * 1.0, nrm, tx, ty);
  const rough = new Uint8Array(N * 4);
  const tint = new Uint8Array(N * 4);
  for (let i = 0; i < N; i++) {
    const o = i * 4;
    const f = facet[i];
    const c = crease[i];
    const p = patch[i];
    const ro = 0.3 + 0.1 * f * f + 0.06 * (p * 0.5 + 0.5) + 0.22 * c;
    rough[o + 1] = Math.round(Math.max(0.3, Math.min(0.8, ro)) * 255);
    rough[o + 2] = 255;
    rough[o + 3] = 255;
    // tint: broad tone gradients, per-facet shade, darker creases; a little hue (warmer = browner)
    const tn = tone[i];
    const bb = 0.84 + 0.1 * (f - 0.5) + 0.1 * tn + 0.04 * p - 0.16 * c;
    const warm = 0.05 * p + 0.03 * tn;
    tint[o] = Math.round(Math.max(0, Math.min(1, bb * (1 + warm))) * 255);
    tint[o + 1] = Math.round(Math.max(0, Math.min(1, bb)) * 255);
    tint[o + 2] = Math.round(Math.max(0, Math.min(1, bb * (1 - 1.8 * warm))) * 255);
    tint[o + 3] = 255;
  }
  return { normal: nrm, rough, tint };
}

// ------------------------------------------------------------------ quilted blankets

/**
 * Stitched blanket quilting: { normal, rough } — rectangular pillows (tile = 4 x 4 pillows)
 * separated by stitched seams, with fine random wrinkles in the fabric.
 */
export function genQuilt(size = 512, seed = 11) {
  {
    const r = rng(seed);
    const N = size * size;
    const h = new Float32Array(N);
    const ro = new Float32Array(N);
    const n = 4;
    const vor = voronoi(size, 30, r, 1);
    const tilt = new Float32Array(vor.count * 2);
    for (let k = 0; k < vor.count * 2; k++) tilt[k] = gauss(r) * 0.08;
    const wob = makeValueNoise(8, r);
    for (let y = 0; y < size; y++) {
      const v = (y + 0.5) / size;
      for (let x = 0; x < size; x++) {
        const u = (x + 0.5) / size;
        const i = y * size + x;
        const fu = (u * n) % 1;
        const fv = (v * n) % 1;
        // pillow: rounded bulge, flat-ish top
        const pu = Math.sin(Math.PI * fu);
        const pv = Math.sin(Math.PI * fv);
        let hh = Math.pow(pu * pv, 0.45) * 0.9;
        // stitches: tiny dimples along the seams
        const su = Math.min(fu, 1 - fu);
        const sv = Math.min(fv, 1 - fv);
        const seam = Math.min(su, sv);
        const along = su < sv ? fv : fu;
        if (seam < 0.03) hh -= 0.15 * (0.5 + 0.5 * Math.cos(along * Math.PI * 2 * 14));
        hh += wob(u, v) * 0.12;
        h[i] = hh;
        ro[i] = 0.5 + 0.15 * wob(u * 2 % 1, v * 2 % 1) + (seam < 0.03 ? 0.15 : 0);
      }
    }
    const nrm = new Uint8Array(N * 4);
    const tX = new Float32Array(N);
    const tY = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const k = vor.id[i];
      tX[i] = tilt[k * 2];
      tY[i] = tilt[k * 2 + 1];
    }
    heightToNormal(h, size, size / n * 0.09, nrm, tX, tY);
    const rough = new Uint8Array(N * 4);
    for (let i = 0; i < N; i++) {
      const o = i * 4;
      rough[o + 1] = Math.round(Math.min(1, Math.max(0, ro[i])) * 255);
      rough[o + 2] = 255;
      rough[o + 3] = 255;
    }
    return { normal: nrm, rough };
  }
}

// ------------------------------------------------------------------ ascent-stage panels

/**
 * Riveted panel skin: { normal, rough, tint }. One tile ~ 2 m x 2 m of skin. Panels are made by
 * recursive rectangle splitting; seams are grooves with rivet rows on both sides.
 */
export function genPanel(size = 1024, seed = 23) {
  {
    const r = rng(seed);
    const N = size * size;
    const h = new Float32Array(N);
    const pid = new Float32Array(N);
    const rects = [];
    (function split(x0, y0, x1, y1, depth) {
      const w = x1 - x0;
      const hgt = y1 - y0;
      if ((w < 0.3 && hgt < 0.3) || depth > 5 || (depth > 2 && r() < 0.25)) {
        rects.push([x0, y0, x1, y1, r()]);
        return;
      }
      if (w > hgt) {
        const s = x0 + w * (0.3 + 0.4 * r());
        split(x0, y0, s, y1, depth + 1);
        split(s, y0, x1, y1, depth + 1);
      } else {
        const s = y0 + hgt * (0.3 + 0.4 * r());
        split(x0, y0, x1, s, depth + 1);
        split(x0, s, x1, y1, depth + 1);
      }
    })(0, 0, 1, 1, 0);
    const px = 1 / size;
    const seamW = 1.6 * px;
    const rivOff = 7 * px;
    const rivStep = 14 * px;
    const rivR = 2.2 * px;
    const wob = makeValueNoise(6, r);
    for (const [x0, y0, x1, y1, id] of rects) {
      const i0 = Math.floor(x0 * size);
      const i1 = Math.ceil(x1 * size);
      const j0 = Math.floor(y0 * size);
      const j1 = Math.ceil(y1 * size);
      const oil = 0.2 + 0.6 * r(); // "oil-can" dishing of thin panels
      for (let j = j0; j < j1; j++) {
        const v = (j + 0.5) / size;
        if (v < y0 || v >= y1) continue;
        for (let i = i0; i < i1; i++) {
          const u = (i + 0.5) / size;
          if (u < x0 || u >= x1) continue;
          const o = j * size + i;
          const dx = Math.min(u - x0, x1 - u);
          const dy = Math.min(v - y0, y1 - v);
          const d = Math.min(dx, dy);
          let hh = 0;
          // slight pillowing of the thin skin between stiffeners
          const fu = (u - x0) / (x1 - x0);
          const fv = (v - y0) / (y1 - y0);
          hh += oil * 0.006 * Math.pow(Math.sin(Math.PI * fu) * Math.sin(Math.PI * fv), 0.7) * size * px * 2;
          hh += wob(u, v) * 0.0015;
          if (d < seamW) hh -= 0.004 * (1 - d / seamW);
          // rivet rows
          if (Math.abs(d - rivOff) < rivR * 2) {
            const along = dx < dy ? v : u;
            const k = Math.round(along / rivStep);
            const dd = Math.hypot(along - k * rivStep, d - rivOff);
            if (dd < rivR) hh += 0.0022 * Math.sqrt(1 - (dd / rivR) ** 2);
          }
          h[o] = hh;
          pid[o] = id;
        }
      }
    }
    const nrm = new Uint8Array(N * 4);
    // every panel is slightly warped/tilted (thin sheet on standoffs): uniform random tilt per panel
    const ptx = new Float32Array(N);
    const pty = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const id = pid[i];
      ptx[i] = (((id * 91.7) % 1) - 0.5) * 0.09;
      pty[i] = (((id * 57.3) % 1) - 0.5) * 0.09;
    }
    heightToNormal(h, size, size * 0.9, nrm, ptx, pty);
    const rough = new Uint8Array(N * 4);
    const tint = new Uint8Array(N * 4);
    for (let i = 0; i < N; i++) {
      const o = i * 4;
      const id = pid[i];
      const seam = h[i] < -0.001 ? 1 : 0;
      rough[o + 1] = Math.round((0.36 + 0.22 * id + seam * 0.2) * 255);
      rough[o + 2] = 255;
      rough[o + 3] = 255;
      const b = (0.78 + 0.34 * id) * (seam ? 0.55 : 1);
      tint[o] = Math.round(Math.min(1, b * (0.985 + 0.03 * ((id * 7.3) % 1))) * 255);
      tint[o + 1] = Math.round(Math.min(1, b) * 255);
      tint[o + 2] = Math.round(Math.min(1, b * (0.99 + 0.035 * ((id * 3.1) % 1))) * 255);
      tint[o + 3] = 255;
    }
    return { normal: nrm, rough, tint };
  }
}


/** Run a generator by name (used by the worker and the synchronous fallback). */
export function generate(kind, size, seed) {
  if (kind === 'foil') return genFoil(size, seed);
  if (kind === 'quilt') return genQuilt(size, seed);
  if (kind === 'panel') return genPanel(size, seed);
  throw new Error(`texgen: unknown kind ${kind}`);
}
