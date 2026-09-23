// The Visitor: textures baked once in create() (no per-pixel noise at render time).
//
// detail texture (tileable, linear data, RGBA):
//   R  fine cellular skin (height: domes with creases between them)
//   G  veins (branching glowing channels under the skin)
//   B  circuit-like traces with small pads (the hologram's "data" structure)
//   A  medium cellular plates (height)

function worley(N, size, rnd, jitter = 0.85) {
  // one feature point per grid cell, wrapped; returns {f1, f2, id} per pixel
  const px = new Float32Array(N * N), py = new Float32Array(N * N), pid = new Float32Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const k = j * N + i;
    px[k] = i + 0.5 + (rnd() - 0.5) * jitter;
    py[k] = j + 0.5 + (rnd() - 0.5) * jitter;
    pid[k] = rnd();
  }
  const f1 = new Float32Array(size * size), f2 = new Float32Array(size * size), id = new Float32Array(size * size);
  const s = N / size;
  for (let y = 0; y < size; y++) {
    const gy = (y + 0.5) * s, cy = Math.floor(gy);
    for (let x = 0; x < size; x++) {
      const gx = (x + 0.5) * s, cx = Math.floor(gx);
      let d1 = 1e9, d2 = 1e9, best = 0;
      for (let dj = -1; dj <= 1; dj++) {
        const jj = cy + dj, wj = ((jj % N) + N) % N, oy = jj - wj;
        for (let di = -1; di <= 1; di++) {
          const ii = cx + di, wi = ((ii % N) + N) % N, ox = ii - wi;
          const k = wj * N + wi;
          const dx = px[k] + ox - gx, dy = py[k] + oy - gy;
          const d = dx * dx + dy * dy;
          if (d < d1) { d2 = d1; d1 = d; best = pid[k]; } else if (d < d2) d2 = d;
        }
      }
      const o = y * size + x;
      f1[o] = Math.sqrt(d1); f2[o] = Math.sqrt(d2); id[o] = best;
    }
  }
  return { f1, f2, id };
}

function drawWrapped(ctx, size, fn) {
  for (const oy of [-size, 0, size]) for (const ox of [-size, 0, size]) {
    ctx.save(); ctx.translate(ox, oy); fn(ctx); ctx.restore();
  }
}

export function bakeDetailTexture(THREE, U, size = 1024) {
  const rnd = U.mulberry32(9001);
  const fine = worley(46, size, rnd);
  const med = worley(13, size, rnd, 0.9);

  // veins: branching random walks, drawn soft
  const vc = document.createElement('canvas');
  vc.width = vc.height = size;
  const vx = vc.getContext('2d');
  vx.fillStyle = '#000'; vx.fillRect(0, 0, size, size);
  vx.lineCap = 'round'; vx.lineJoin = 'round';
  const segs = [];
  function walk(x, y, ang, w, len, depth) {
    let px = x, py = y;
    for (let i = 0; i < len; i++) {
      ang += (rnd() - 0.5) * 0.5;
      const step = 6 + rnd() * 6;
      const nx = px + Math.cos(ang) * step, ny = py + Math.sin(ang) * step;
      segs.push([px, py, nx, ny, w]);
      px = nx; py = ny;
      w *= 0.985;
      if (depth < 3 && rnd() < 0.06) walk(px, py, ang + (rnd() < 0.5 ? -1 : 1) * (0.5 + rnd() * 0.6), w * 0.7, Math.floor(len * 0.55), depth + 1);
      if (w < 0.6) break;
    }
  }
  for (let i = 0; i < 16; i++) walk(rnd() * size, rnd() * size, rnd() * Math.PI * 2, 3.2 + rnd() * 2.5, 60 + Math.floor(rnd() * 50), 0);
  // soft wide pass, blurred once, then a sharp core on top
  const wc = document.createElement('canvas');
  wc.width = wc.height = size;
  const wx = wc.getContext('2d');
  wx.lineCap = 'round'; wx.lineJoin = 'round';
  drawWrapped(wx, size, c => {
    for (const [a, b, cc, d, w] of segs) {
      c.strokeStyle = `rgba(255,255,255,${Math.min(1, 0.35 + w * 0.12)})`;
      c.lineWidth = w * 2.2;
      c.beginPath(); c.moveTo(a, b); c.lineTo(cc, d); c.stroke();
    }
  });
  vx.filter = 'blur(2.5px)';
  vx.drawImage(wc, 0, 0);
  vx.filter = 'none';
  drawWrapped(vx, size, c => {
    c.strokeStyle = 'rgba(255,255,255,0.9)';
    c.beginPath();
    for (const [a, b, cc, d, w] of segs) { c.moveTo(a, b); c.lineTo(cc, d); }
    c.lineWidth = 1.1;
    c.stroke();
  });
  const veins = vx.getImageData(0, 0, size, size).data;

  // circuit traces: manhattan / 45-degree runs ending in pads
  const cc = document.createElement('canvas');
  cc.width = cc.height = size;
  const cx = cc.getContext('2d');
  cx.fillStyle = '#000'; cx.fillRect(0, 0, size, size);
  const traces = [];
  const G = size / 64;
  for (let i = 0; i < 70; i++) {
    let x = Math.floor(rnd() * 64) * G, y = Math.floor(rnd() * 64) * G;
    let dir = Math.floor(rnd() * 8);
    const pts = [[x, y]];
    const n = 2 + Math.floor(rnd() * 4);
    for (let k = 0; k < n; k++) {
      const L = (2 + Math.floor(rnd() * 7)) * G;
      const a = dir * Math.PI / 4;
      x += Math.round(Math.cos(a)) * L; y += Math.round(Math.sin(a)) * L;
      pts.push([x, y]);
      dir = (dir + (rnd() < 0.5 ? 1 : 7) * (rnd() < 0.7 ? 1 : 2)) % 8;
      if (dir % 2 === 1 && rnd() < 0.5) dir = (dir + 1) % 8;
    }
    traces.push(pts);
  }
  drawWrapped(cx, size, c => {
    c.strokeStyle = 'rgba(255,255,255,0.85)';
    c.fillStyle = 'rgba(255,255,255,0.95)';
    c.lineWidth = 1.6;
    for (const pts of traces) {
      c.beginPath(); c.moveTo(pts[0][0], pts[0][1]);
      for (const p of pts) c.lineTo(p[0], p[1]);
      c.stroke();
      const e = pts[pts.length - 1];
      c.beginPath(); c.arc(e[0], e[1], 3.2, 0, Math.PI * 2); c.fill();
      c.beginPath(); c.arc(pts[0][0], pts[0][1], 2.2, 0, Math.PI * 2); c.stroke();
    }
  });
  const circ = cx.getImageData(0, 0, size, size).data;

  const data = new Uint8Array(size * size * 4);
  for (let o = 0; o < size * size; o++) {
    // fine cells: rounded domes, dark creases at the borders
    const e1 = fine.f2[o] - fine.f1[o];
    const dome = Math.min(1, e1 * 2.6);
    const hF = Math.sqrt(dome) * (0.75 + 0.25 * fine.id[o]);
    const e2 = med.f2[o] - med.f1[o];
    const hM = Math.min(1, e2 * 3.2);
    data[o * 4] = Math.round(255 * hF);
    data[o * 4 + 1] = veins[o * 4];
    data[o * 4 + 2] = circ[o * 4];
    data[o * 4 + 3] = Math.round(255 * Math.sqrt(hM) * (0.7 + 0.3 * med.id[o]));
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}
