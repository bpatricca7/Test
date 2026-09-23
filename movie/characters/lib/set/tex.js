// Procedural textures for the hut interior, baked once into canvases in create().
// Everything is deterministic (U.mulberry32), no downloaded assets.

export function makeTextures(env) {
  const { THREE, U, renderer } = env;
  const maxAniso = renderer ? Math.min(8, renderer.capabilities.getMaxAnisotropy()) : 4;

  const canvas = (w, h) => {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return [c, c.getContext('2d')];
  };
  const tex = (c, { srgb = true, repeat = null, aniso = maxAniso, mips = true } = {}) => {
    const t = new THREE.CanvasTexture(c);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = aniso;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    if (repeat) t.repeat.set(repeat[0], repeat[1]);
    if (!mips) { t.generateMipmaps = false; t.minFilter = THREE.LinearFilter; }
    return t;
  };
  const rgb = (r, g, b, a = 1) => `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${a})`;

  // smooth random field (tileable) by upscaling a tiny random canvas
  function blob(g, w, h, cells, seed, paint) {
    const rnd = U.mulberry32(seed);
    const cw = cells, ch = Math.max(1, Math.round(cells * h / w));
    const [s, sg] = canvas(cw + 2, ch + 2);
    const id = sg.createImageData(cw + 2, ch + 2);
    const vals = [];
    for (let j = 0; j < ch; j++) for (let i = 0; i < cw; i++) vals.push(rnd());
    for (let j = 0; j < ch + 2; j++) {
      for (let i = 0; i < cw + 2; i++) {
        const v = vals[((j - 1 + ch) % ch) * cw + ((i - 1 + cw) % cw)];
        const [r, gg, b, a] = paint(v);
        const k = (j * (cw + 2) + i) * 4;
        id.data[k] = r; id.data[k + 1] = gg; id.data[k + 2] = b; id.data[k + 3] = a;
      }
    }
    sg.putImageData(id, 0, 0);
    g.save();
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    const sx = w / cw, sy = h / ch;
    g.drawImage(s, -1.5 * sx, -1.5 * sy, (cw + 2) * sx, (ch + 2) * sy);
    g.restore();
  }
  // per-pixel grain
  function grain(g, w, h, amt, seed, mono = true) {
    const rnd = U.mulberry32(seed);
    const id = g.getImageData(0, 0, w, h);
    const d = id.data;
    for (let i = 0; i < d.length; i += 4) {
      const n = (rnd() - 0.5) * amt;
      if (mono) { d[i] += n; d[i + 1] += n; d[i + 2] += n; }
      else { d[i] += n; d[i + 1] += (rnd() - 0.5) * amt; d[i + 2] += (rnd() - 0.5) * amt; }
    }
    g.putImageData(id, 0, 0);
  }
  function scribble(g, rnd, x, y, w, lines, lh, col, lw = 1.2) {
    g.strokeStyle = col; g.lineWidth = lw; g.lineCap = 'round';
    for (let l = 0; l < lines; l++) {
      let xx = x, yy = y + l * lh;
      const len = w * (0.45 + 0.55 * rnd());
      g.beginPath(); g.moveTo(xx, yy);
      while (xx < x + len) {
        const step = 2 + rnd() * 4;
        xx += step; g.lineTo(xx, yy + (rnd() - 0.5) * lh * 0.5);
        if (rnd() < 0.12) { xx += 3 + rnd() * 5; g.moveTo(xx, yy); }
      }
      g.stroke();
    }
  }
  function textLines(g, rnd, x, y, w, lines, lh, col, h = 2) {
    g.fillStyle = col;
    for (let l = 0; l < lines; l++) {
      let xx = x;
      const end = x + w * (l % 7 === 6 ? 0.3 + 0.4 * rnd() : 0.8 + 0.2 * rnd());
      while (xx < end) { const ww = 4 + rnd() * 18; g.fillRect(xx, y + l * lh, Math.min(ww, end - xx), h); xx += ww + 3 + rnd() * 2; }
    }
  }

  // -------------------------------------------------------------------------
  // wood: vertical tongue-and-groove boards (wainscot) or floor planks
  // -------------------------------------------------------------------------
  function woodBoards({ w, h, boards, base, spread, seed, grooveDark = 0.55, knots = 3, joints = false, grainDark = 0.7, stain = 0 }) {
    const [c, g] = canvas(w, h);
    const [cb, gb] = canvas(w, h);             // bump
    const rnd = U.mulberry32(seed);
    const bw = w / boards;
    gb.fillStyle = '#808080'; gb.fillRect(0, 0, w, h);
    for (let i = 0; i < boards; i++) {
      const x0 = i * bw;
      // pieces along the board (floor planks have staggered end joints)
      const cuts = [0];
      if (joints) { let y = rnd() * h * 0.6; while (y < h) { cuts.push(y); y += h * (0.35 + rnd() * 0.5); } }
      cuts.push(h);
      for (let p = 0; p < cuts.length - 1; p++) {
        const y0 = cuts[p], y1 = cuts[p + 1];
        const k = 1 + (rnd() - 0.5) * spread;
        const hue = (rnd() - 0.5) * 0.12;
        const col = [base[0] * k * (1 + hue), base[1] * k, base[2] * k * (1 - hue)];
        g.fillStyle = rgb(...col);
        g.fillRect(x0, y0, bw + 1, y1 - y0);
        // grain: long wobbly lines
        const nL = Math.round(bw / 2.2);
        const ph = rnd() * 100;
        for (let l = 0; l < nL; l++) {
          const u = (l + rnd() * 0.8) / nL;
          const dark = rnd() < 0.3;
          g.strokeStyle = rgb(col[0] * (dark ? grainDark * 0.8 : grainDark + 0.15), col[1] * (dark ? grainDark * 0.75 : grainDark + 0.1), col[2] * (dark ? grainDark * 0.7 : grainDark + 0.05), dark ? 0.55 : 0.22);
          g.lineWidth = dark ? 0.8 + rnd() * 1.4 : 0.6 + rnd();
          g.beginPath();
          const amp = 1.5 + rnd() * 3.5, fr = 0.004 + rnd() * 0.01;
          for (let y = y0; y <= y1; y += 6) {
            const x = x0 + u * bw + amp * Math.sin(y * fr + ph + l * 0.3) + 2.0 * Math.sin(y * 0.031 + l);
            if (y === y0) g.moveTo(x, y); else g.lineTo(x, y);
          }
          g.stroke();
        }
        // cathedral arcs (flat-sawn figure)
        if (rnd() < 0.7) {
          const cx = x0 + bw * (0.3 + rnd() * 0.4), cy = y0 + (y1 - y0) * rnd();
          for (let r = 0; r < 7; r++) {
            g.strokeStyle = rgb(col[0] * 0.62, col[1] * 0.55, col[2] * 0.48, 0.18);
            g.lineWidth = 1 + rnd();
            g.beginPath();
            g.ellipse(cx, cy, bw * (0.08 + r * 0.05), (y1 - y0) * (0.12 + r * 0.06) + 20, 0, 0, Math.PI * 2);
            g.stroke();
          }
        }
        // knots
        for (let q = 0; q < knots; q++) {
          if (rnd() > 0.45) continue;
          const kx = x0 + bw * (0.2 + 0.6 * rnd()), ky = y0 + (y1 - y0) * rnd(), kr = 3 + rnd() * bw * 0.12;
          const gr = g.createRadialGradient(kx, ky, 0, kx, ky, kr * 2.2);
          gr.addColorStop(0, rgb(col[0] * 0.3, col[1] * 0.22, col[2] * 0.15, 0.95));
          gr.addColorStop(0.35, rgb(col[0] * 0.5, col[1] * 0.38, col[2] * 0.25, 0.8));
          gr.addColorStop(1, rgb(col[0] * 0.8, col[1] * 0.7, col[2] * 0.6, 0));
          g.fillStyle = gr;
          g.beginPath(); g.ellipse(kx, ky, kr * 1.4, kr * 2.4, 0, 0, Math.PI * 2); g.fill();
        }
        if (joints && p > 0) {
          g.fillStyle = rgb(20, 12, 6, 0.8); g.fillRect(x0, y0 - 1, bw, 2.5);
          gb.fillStyle = '#303030'; gb.fillRect(x0, y0 - 1, bw, 3);
        }
      }
      // groove + tongue highlight
      g.fillStyle = rgb(base[0] * 0.2, base[1] * 0.15, base[2] * 0.1, grooveDark);
      g.fillRect(x0 - 1, 0, 3, h);
      g.fillStyle = rgb(255, 235, 200, 0.12);
      g.fillRect(x0 + 2, 0, 1.5, h);
      gb.fillStyle = '#202020'; gb.fillRect(x0 - 1.5, 0, 4, h);
      gb.fillStyle = '#9a9a9a'; gb.fillRect(x0 + 2.5, 0, 2, h);
    }
    // large-scale colour variation + wear
    g.globalCompositeOperation = 'multiply';
    blob(g, w, h, 6, seed + 1, v => { const k = 205 + 50 * v; return [k, k * 0.97, k * 0.94, 255]; });
    g.globalCompositeOperation = 'source-over';
    if (stain > 0) blob(g, w, h, 14, seed + 2, v => [40, 25, 12, Math.max(0, v - 0.6) * 255 * stain]);
    grain(g, w, h, 10, seed + 3);
    return [c, cb];
  }

  // -------------------------------------------------------------------------
  const T = {};

  // wainscot: honey pine, vertical boards, 8 boards per metre
  {
    const [c, b] = woodBoards({ w: 1024, h: 1024, boards: 8, base: [178, 124, 72], spread: 0.22, seed: 11, knots: 4 });
    // dirt and scuffs near the bottom (the texture is mapped 1 m tall, 0 at the floor)
    const g = c.getContext('2d');
    const gr = g.createLinearGradient(0, 1024, 0, 700);
    gr.addColorStop(0, 'rgba(40,28,16,0.45)'); gr.addColorStop(1, 'rgba(40,28,16,0)');
    g.fillStyle = gr; g.fillRect(0, 700, 1024, 324);
    const rnd = U.mulberry32(5);
    for (let i = 0; i < 40; i++) {
      g.strokeStyle = `rgba(30,20,10,${0.1 + rnd() * 0.25})`; g.lineWidth = 1 + rnd() * 2;
      const x = rnd() * 1024, y = 860 + rnd() * 150;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + (rnd() - 0.5) * 60, y + (rnd() - 0.5) * 10); g.stroke();
    }
    T.pine = tex(c); T.pineBump = tex(b, { srgb: false });
  }
  // floor: stained oak planks, 14 cm, running along X; 2 m x 2 m per tile
  {
    const [c, b] = woodBoards({ w: 1024, h: 1024, boards: 14, base: [120, 78, 46], spread: 0.3, seed: 21, knots: 2, joints: true, grainDark: 0.62, stain: 0.6 });
    const g = c.getContext('2d');
    // scratches and traffic wear
    const rnd = U.mulberry32(22);
    for (let i = 0; i < 260; i++) {
      g.strokeStyle = `rgba(${rnd() < 0.5 ? '230,200,160' : '25,15,8'},${0.05 + rnd() * 0.12})`;
      g.lineWidth = 0.5 + rnd();
      const x = rnd() * 1024, y = rnd() * 1024, a = (rnd() - 0.5) * 0.6 + (rnd() < 0.5 ? Math.PI / 2 : 0), l = 10 + rnd() * 80;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
    }
    T.floor = tex(c); T.floorBump = tex(b, { srgb: false });
  }
  // painted upper wall: warm grey-green institutional paint, mottled, a few marks
  {
    const [c, g] = canvas(512, 512);
    g.fillStyle = rgb(150, 156, 140); g.fillRect(0, 0, 512, 512);
    g.globalCompositeOperation = 'multiply';
    blob(g, 512, 512, 5, 31, v => { const k = 215 + 40 * v; return [k, k, k * 0.98, 255]; });
    blob(g, 512, 512, 24, 32, v => { const k = 236 + 19 * v; return [k, k, k, 255]; });
    g.globalCompositeOperation = 'source-over';
    // roller texture
    grain(g, 512, 512, 7, 33);
    T.paint = tex(c);
    const [cb, gb] = canvas(256, 256);
    gb.fillStyle = '#808080'; gb.fillRect(0, 0, 256, 256);
    grain(gb, 256, 256, 40, 34);
    T.paintBump = tex(cb, { srgb: false });
  }
  // ceiling boards: painted off-white, 10 cm
  {
    const [c, b] = woodBoards({ w: 512, h: 512, boards: 10, base: [196, 190, 176], spread: 0.06, seed: 41, knots: 0, grooveDark: 0.5, grainDark: 0.93 });
    T.ceiling = tex(c); T.ceilingBump = tex(b, { srgb: false });
  }
  // dark stained beams / trim
  {
    const [c] = woodBoards({ w: 256, h: 512, boards: 1, base: [86, 56, 34], spread: 0.1, seed: 51, knots: 2, grooveDark: 0 });
    T.beam = tex(c);
  }
  // desk top: worn walnut-look laminate
  {
    const [c] = woodBoards({ w: 1024, h: 512, boards: 1, base: [128, 90, 58], spread: 0.0, seed: 61, knots: 0, grooveDark: 0, grainDark: 0.72 });
    const g = c.getContext('2d');
    // rotate the grain to run along the desk: we draw rotated into a new canvas
    const [c2, g2] = canvas(1024, 512);
    g2.save(); g2.translate(1024, 0); g2.rotate(Math.PI / 2); g2.drawImage(c, 0, 0, 512, 1024); g2.restore();
    // coffee rings, wear where the hands rest (front edge = bottom of the texture)
    const rnd = U.mulberry32(62);
    for (let i = 0; i < 7; i++) {
      const x = rnd() * 1024, y = 80 + rnd() * 380, r = 20 + rnd() * 6;
      g2.strokeStyle = `rgba(60,34,16,${0.25 + rnd() * 0.25})`; g2.lineWidth = 2 + rnd() * 2;
      g2.beginPath(); g2.arc(x, y, r, rnd() * 3, rnd() * 3 + 4 + rnd() * 2); g2.stroke();
    }
    const wear = g2.createLinearGradient(0, 512, 0, 380);
    wear.addColorStop(0, 'rgba(210,180,140,0.18)'); wear.addColorStop(1, 'rgba(210,180,140,0)');
    g2.fillStyle = wear; g2.fillRect(0, 380, 1024, 132);
    for (let i = 0; i < 120; i++) {
      g2.strokeStyle = `rgba(230,210,180,${0.04 + rnd() * 0.08})`; g2.lineWidth = 0.6;
      const x = rnd() * 1024, y = rnd() * 512;
      g2.beginPath(); g2.moveTo(x, y); g2.lineTo(x + 20 + rnd() * 60, y + (rnd() - 0.5) * 8); g2.stroke();
    }
    T.desk = tex(c2);
  }

  // -------------------------------------------------------------------------
  // fabrics
  // -------------------------------------------------------------------------
  function fabric({ w = 512, h = 512, base, seed, wale = 0, weave = 2, wear = 0.3, fleck = 0 }) {
    const [c, g] = canvas(w, h);
    g.fillStyle = rgb(...base); g.fillRect(0, 0, w, h);
    const rnd = U.mulberry32(seed);
    if (wale > 0) {
      for (let x = 0; x < w; x += wale) {
        const gr = g.createLinearGradient(x, 0, x + wale, 0);
        gr.addColorStop(0, 'rgba(0,0,0,0.35)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.10)'); gr.addColorStop(1, 'rgba(0,0,0,0.35)');
        g.fillStyle = gr; g.fillRect(x, 0, wale, h);
      }
    }
    if (weave > 0) {
      g.fillStyle = 'rgba(0,0,0,0.12)';
      for (let y = 0; y < h; y += weave * 2) g.fillRect(0, y, w, weave * 0.8);
      g.fillStyle = 'rgba(255,255,255,0.05)';
      for (let x = 0; x < w; x += weave * 2) g.fillRect(x, 0, weave * 0.8, h);
    }
    g.globalCompositeOperation = 'multiply';
    blob(g, w, h, 5, seed + 1, v => { const k = 200 + 55 * v; return [k, k, k, 255]; });
    g.globalCompositeOperation = 'source-over';
    // worn, lighter patches
    blob(g, w, h, 8, seed + 2, v => [255, 240, 220, Math.max(0, v - 0.55) * 255 * wear]);
    if (fleck) for (let i = 0; i < fleck; i++) { g.fillStyle = `rgba(255,255,255,${rnd() * 0.12})`; g.fillRect(rnd() * w, rnd() * h, 1, 2); }
    grain(g, w, h, 16, seed + 3);
    return c;
  }
  // armchair: faded rust corduroy
  T.armFabric = tex(fabric({ base: [128, 66, 42], seed: 71, wale: 6, weave: 0, wear: 0.5 }));
  // office chair: charcoal weave
  T.chairFabric = tex(fabric({ w: 256, h: 256, base: [44, 46, 50], seed: 72, weave: 2, wear: 0.15, fleck: 800 }));
  // rug: faded kilim
  {
    const [c, g] = canvas(1024, 768);
    const rnd = U.mulberry32(81);
    const cols = [[138, 48, 36], [178, 136, 88], [48, 60, 86], [200, 180, 150], [96, 70, 44]];
    g.fillStyle = rgb(...cols[0]); g.fillRect(0, 0, 1024, 768);
    g.fillStyle = rgb(...cols[3]); g.fillRect(40, 40, 944, 688);
    g.fillStyle = rgb(...cols[0]); g.fillRect(70, 70, 884, 628);
    // stepped diamonds
    for (let k = 0; k < 3; k++) {
      const cx = 512, cy = 384;
      const sz = [300, 210, 120][k];
      g.fillStyle = rgb(...cols[[2, 1, 4][k]]);
      g.beginPath();
      for (let a = 0; a < 4; a++) {
        const ang = a * Math.PI / 2;
        g.lineTo(cx + Math.cos(ang) * sz * 1.4, cy + Math.sin(ang) * sz * 0.9);
      }
      g.fill();
    }
    for (let i = 0; i < 12; i++) {
      const x = 110 + (i % 6) * 160 + (i >= 6 ? 80 : 0), y = i < 6 ? 130 : 640;
      g.fillStyle = rgb(...cols[i % 2 ? 2 : 1]);
      g.beginPath(); g.moveTo(x, y - 30); g.lineTo(x + 30, y); g.lineTo(x, y + 30); g.lineTo(x - 30, y); g.fill();
    }
    // weave and fringe wear
    g.fillStyle = 'rgba(0,0,0,0.10)';
    for (let y = 0; y < 768; y += 4) g.fillRect(0, y, 1024, 1.5);
    g.globalCompositeOperation = 'multiply';
    blob(g, 1024, 768, 7, 82, v => { const k = 170 + 85 * v; return [k, k, k, 255]; });
    g.globalCompositeOperation = 'source-over';
    blob(g, 1024, 768, 5, 83, v => [220, 200, 170, Math.max(0, v - 0.5) * 110]);
    grain(g, 1024, 768, 22, 84, false);
    T.rug = tex(c);
  }
  // blanket: knitted tartan throw, cream / oxblood / forest
  {
    const [c, g] = canvas(512, 512);
    g.fillStyle = rgb(206, 192, 164); g.fillRect(0, 0, 512, 512);
    const bands = [[0, 60, [120, 36, 34]], [60, 14, [40, 64, 48]], [150, 90, [120, 36, 34]], [256, 20, [40, 64, 48]], [300, 60, [120, 36, 34]], [420, 30, [40, 64, 48]]];
    g.globalAlpha = 0.75;
    for (const [p, wdt, col] of bands) { g.fillStyle = rgb(...col); g.fillRect(p, 0, wdt, 512); }
    g.globalCompositeOperation = 'multiply';
    for (const [p, wdt, col] of bands) { g.fillStyle = rgb(col[0] + 90, col[1] + 90, col[2] + 90); g.fillRect(0, p, 512, wdt); }
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    // knit stitches: little chevrons
    for (let y = 0; y < 512; y += 6) {
      for (let x = 0; x < 512; x += 6) {
        g.fillStyle = 'rgba(0,0,0,0.16)'; g.fillRect(x + 2.5, y, 1, 6);
        g.fillStyle = 'rgba(255,255,255,0.07)'; g.fillRect(x, y + 1, 2, 3);
      }
    }
    grain(g, 512, 512, 18, 91);
    T.blanket = tex(c);
  }

  // -------------------------------------------------------------------------
  // metal, plastic
  // -------------------------------------------------------------------------
  {
    const [c, g] = canvas(256, 256);
    g.fillStyle = rgb(34, 36, 40); g.fillRect(0, 0, 256, 256);
    grain(g, 256, 256, 22, 101);
    g.globalCompositeOperation = 'multiply';
    blob(g, 256, 256, 6, 102, v => { const k = 205 + 50 * v; return [k, k, k, 255]; });
    T.rackMetal = tex(c);
  }
  {
    const [c, g] = canvas(256, 256);
    g.fillStyle = rgb(196, 188, 170); g.fillRect(0, 0, 256, 256);
    g.globalCompositeOperation = 'multiply';
    blob(g, 256, 256, 4, 111, v => { const k = 222 + 33 * v; return [k, k, k * 0.96, 255]; });
    g.globalCompositeOperation = 'source-over';
    grain(g, 256, 256, 8, 112);
    T.beige = tex(c);
  }
  {
    // institutional green-grey enamel steel (filing cabinet, desk pedestal, radiator)
    const [c, g] = canvas(256, 256);
    g.fillStyle = rgb(104, 114, 104); g.fillRect(0, 0, 256, 256);
    g.globalCompositeOperation = 'multiply';
    blob(g, 256, 256, 5, 121, v => { const k = 215 + 40 * v; return [k, k, k, 255]; });
    g.globalCompositeOperation = 'source-over';
    const rnd = U.mulberry32(122);
    for (let i = 0; i < 30; i++) { g.fillStyle = `rgba(200,200,190,${0.1 + rnd() * 0.15})`; g.fillRect(rnd() * 256, rnd() * 256, 1 + rnd() * 6, 1); }
    grain(g, 256, 256, 8, 123);
    T.enamel = tex(c);
  }

  // -------------------------------------------------------------------------
  // paper atlas: 4 x 4 cells of 256 px: printouts, notes, sticky notes, photos
  // -------------------------------------------------------------------------
  {
    const S = 256, [c, g] = canvas(S * 4, S * 4);
    const rnd = U.mulberry32(131);
    const cell = (i, j, fn) => { g.save(); g.translate(i * S, j * S); g.beginPath(); g.rect(0, 0, S, S); g.clip(); fn(); g.restore(); };
    // row 0: typed printouts
    for (let i = 0; i < 4; i++) cell(i, 0, () => {
      g.fillStyle = rgb(236 - i * 4, 232 - i * 3, 220 - i * 6); g.fillRect(0, 0, S, S);
      textLines(g, rnd, 22, 26, S - 44, 2, 10, 'rgba(30,30,30,0.85)', 3);
      textLines(g, rnd, 22, 56, S - 44, 18, 9, 'rgba(40,40,40,0.55)', 2);
      if (i === 1) { g.strokeStyle = 'rgba(30,30,30,0.7)'; g.lineWidth = 1.2; g.beginPath(); for (let x = 0; x < 180; x++) g.lineTo(38 + x, 200 - 40 * Math.exp(-Math.pow((x - 90) / 12, 2)) - 6 * rnd()); g.stroke(); }
      if (i === 3) { g.strokeStyle = 'rgba(180,30,30,0.7)'; g.lineWidth = 2; g.beginPath(); g.ellipse(120, 130, 50, 16, -0.1, 0, 6.2); g.stroke(); }
    });
    // row 1: handwritten notes (yellow legal pad, graph paper, index card, envelope)
    cell(0, 1, () => {
      g.fillStyle = rgb(246, 236, 150); g.fillRect(0, 0, S, S);
      g.strokeStyle = 'rgba(80,120,190,0.45)'; g.lineWidth = 1;
      for (let y = 30; y < S; y += 12) { g.beginPath(); g.moveTo(0, y); g.lineTo(S, y); g.stroke(); }
      g.strokeStyle = 'rgba(200,60,60,0.5)'; g.beginPath(); g.moveTo(34, 0); g.lineTo(34, S); g.stroke();
      scribble(g, rnd, 40, 27, S - 60, 17, 12, 'rgba(30,40,110,0.75)');
    });
    cell(1, 1, () => {
      g.fillStyle = rgb(236, 240, 232); g.fillRect(0, 0, S, S);
      g.strokeStyle = 'rgba(80,150,140,0.35)'; g.lineWidth = 1;
      for (let k = 0; k < S; k += 8) { g.beginPath(); g.moveTo(k, 0); g.lineTo(k, S); g.moveTo(0, k); g.lineTo(S, k); g.stroke(); }
      g.strokeStyle = 'rgba(30,30,30,0.8)'; g.lineWidth = 1.5; g.beginPath();
      for (let x = 0; x < 200; x++) g.lineTo(28 + x, 170 - 60 * Math.exp(-Math.pow((x - 120) / 18, 2)) + 5 * Math.sin(x * 0.5));
      g.stroke();
      scribble(g, rnd, 24, 30, 180, 4, 14, 'rgba(20,20,20,0.75)');
    });
    cell(2, 1, () => {
      g.fillStyle = rgb(244, 242, 236); g.fillRect(0, 0, S, S);
      g.strokeStyle = 'rgba(200,80,80,0.5)'; g.beginPath(); g.moveTo(0, 40); g.lineTo(S, 40); g.stroke();
      g.strokeStyle = 'rgba(100,140,200,0.35)';
      for (let y = 60; y < S; y += 16) { g.beginPath(); g.moveTo(0, y); g.lineTo(S, y); g.stroke(); }
      scribble(g, rnd, 16, 24, 120, 1, 12, 'rgba(20,20,20,0.85)', 2);
      scribble(g, rnd, 16, 58, S - 40, 11, 16, 'rgba(20,20,60,0.7)');
    });
    cell(3, 1, () => {   // a photo print of the dish, white border
      g.fillStyle = rgb(236, 234, 228); g.fillRect(0, 0, S, S);
      const gr = g.createLinearGradient(0, 16, 0, 200); gr.addColorStop(0, '#6d8fb5'); gr.addColorStop(1, '#d9c9a6');
      g.fillStyle = gr; g.fillRect(14, 14, S - 28, 190);
      g.fillStyle = '#4a5a3a'; g.fillRect(14, 170, S - 28, 34);
      g.strokeStyle = '#f2f2f2'; g.fillStyle = '#e8e8ea'; g.lineWidth = 3;
      g.beginPath(); g.ellipse(128, 92, 62, 24, -0.5, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#aab'; g.fillRect(120, 110, 16, 62);
      scribble(g, rnd, 20, 222, 150, 1, 12, 'rgba(20,20,20,0.7)', 1.5);
    });
    // row 2: sticky notes (yellow, pink, green, blue)
    [[255, 234, 110], [255, 170, 190], [170, 236, 150], [150, 210, 250]].forEach((col, i) => cell(i, 2, () => {
      g.fillStyle = rgb(...col); g.fillRect(0, 0, S, S);
      const gr = g.createLinearGradient(0, 0, 0, 40); gr.addColorStop(0, 'rgba(0,0,0,0.10)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(0, 0, S, 40);
      g.save(); g.translate(128, 128); g.rotate((rnd() - 0.5) * 0.2); g.translate(-128, -128);
      scribble(g, rnd, 28, 60 + rnd() * 20, 190, 3 + Math.floor(rnd() * 3), 34, 'rgba(20,20,40,0.85)', 4.5);
      g.restore();
    }));
    // row 3: star chart sheet, hydrogen-line plot, calendar page, manila folder
    cell(0, 3, () => {
      g.fillStyle = rgb(18, 26, 58); g.fillRect(0, 0, S, S);
      g.strokeStyle = 'rgba(140,170,255,0.25)'; g.lineWidth = 1;
      for (let k = 1; k < 6; k++) { g.beginPath(); g.arc(128, 128, k * 24, 0, Math.PI * 2); g.stroke(); }
      for (let a = 0; a < 12; a++) { g.beginPath(); g.moveTo(128, 128); g.lineTo(128 + Math.cos(a * 0.5236) * 124, 128 + Math.sin(a * 0.5236) * 124); g.stroke(); }
      for (let i = 0; i < 260; i++) { const r = Math.pow(rnd(), 3) * 2.6 + 0.4; g.fillStyle = 'rgba(255,255,240,0.9)'; g.beginPath(); g.arc(rnd() * S, rnd() * S, r, 0, 7); g.fill(); }
      g.strokeStyle = 'rgba(255,220,120,0.55)'; g.beginPath();
      let x = 60, y = 70; g.moveTo(x, y); for (let k = 0; k < 6; k++) { x += 20 + rnd() * 20; y += (rnd() - 0.3) * 30; g.lineTo(x, y); } g.stroke();
    });
    cell(1, 3, () => {
      g.fillStyle = rgb(240, 238, 230); g.fillRect(0, 0, S, S);
      g.strokeStyle = 'rgba(0,0,0,0.6)'; g.lineWidth = 1; g.strokeRect(30, 30, 200, 180);
      g.strokeStyle = 'rgba(20,60,160,0.85)'; g.lineWidth = 1.4; g.beginPath();
      for (let x = 0; x < 200; x++) g.lineTo(30 + x, 190 - 12 * rnd() - 130 * Math.exp(-Math.pow((x - 100) / 14, 2)) - 30 * Math.exp(-Math.pow((x - 130) / 30, 2)));
      g.stroke();
      textLines(g, rnd, 40, 222, 160, 2, 10, 'rgba(0,0,0,0.6)', 2);
    });
    cell(2, 3, () => {
      g.fillStyle = rgb(246, 244, 238); g.fillRect(0, 0, S, S);
      g.fillStyle = rgb(170, 40, 40); g.fillRect(0, 0, S, 44);
      g.fillStyle = 'rgba(255,255,255,0.9)'; g.fillRect(70, 16, 116, 12);
      g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 1;
      for (let i = 0; i <= 7; i++) { g.beginPath(); g.moveTo(8 + i * 34, 56); g.lineTo(8 + i * 34, 246); g.stroke(); }
      for (let j = 0; j <= 5; j++) { g.beginPath(); g.moveTo(8, 56 + j * 38); g.lineTo(246, 56 + j * 38); g.stroke(); }
      g.fillStyle = 'rgba(0,0,0,0.6)';
      for (let d = 0; d < 30; d++) g.fillRect(12 + ((d + 3) % 7) * 34, 60 + Math.floor((d + 3) / 7) * 38, 8, 6);
      g.strokeStyle = 'rgba(200,30,30,0.8)'; g.lineWidth = 2; g.beginPath(); g.arc(12 + 4 * 34 + 14, 60 + 3 * 38 + 14, 15, 0, 7); g.stroke();
    });
    cell(3, 3, () => {
      g.fillStyle = rgb(214, 186, 128); g.fillRect(0, 0, S, S);
      g.fillStyle = 'rgba(0,0,0,0.08)'; g.fillRect(0, 0, S, 20);
      g.fillStyle = 'rgba(255,255,255,0.8)'; g.fillRect(150, 4, 90, 14);
      scribble(g, rnd, 156, 10, 70, 1, 10, 'rgba(0,0,0,0.8)', 1.5);
    });
    T.paper = tex(c);
  }
  // continuous-feed "greenbar" printout (512 x 1024 = one long sheet)
  {
    const [c, g] = canvas(512, 1024);
    const rnd = U.mulberry32(141);
    g.fillStyle = rgb(240, 242, 232); g.fillRect(0, 0, 512, 1024);
    for (let y = 0; y < 1024; y += 64) { g.fillStyle = 'rgba(150,205,160,0.55)'; g.fillRect(34, y, 444, 32); }
    g.fillStyle = 'rgba(0,0,0,0.12)';
    for (let y = 8; y < 1024; y += 21) { g.beginPath(); g.arc(16, y, 5, 0, 7); g.arc(496, y, 5, 0, 7); g.fill(); }
    g.strokeStyle = 'rgba(0,0,0,0.15)'; g.setLineDash([3, 3]);
    g.beginPath(); g.moveTo(31, 0); g.lineTo(31, 1024); g.moveTo(481, 0); g.lineTo(481, 1024); g.stroke();
    g.beginPath(); g.moveTo(0, 512); g.lineTo(512, 512); g.stroke(); g.setLineDash([]);
    textLines(g, rnd, 44, 10, 420, 128, 8, 'rgba(30,30,50,0.55)', 2);
    T.greenbar = tex(c);
  }
  // cork board with pinned star charts, photos, index cards (1.0 x 0.62 m)
  {
    const [c, g] = canvas(1024, 640);
    const rnd = U.mulberry32(151);
    g.fillStyle = rgb(170, 122, 78); g.fillRect(0, 0, 1024, 640);
    for (let i = 0; i < 26000; i++) {
      const k = rnd();
      g.fillStyle = k < 0.5 ? `rgba(90,56,30,${0.3 + rnd() * 0.4})` : `rgba(215,170,115,${0.2 + rnd() * 0.4})`;
      g.fillRect(rnd() * 1024, rnd() * 640, 1 + rnd() * 2.5, 1 + rnd() * 2.5);
    }
    // frame
    g.strokeStyle = rgb(120, 86, 52); g.lineWidth = 26; g.strokeRect(0, 0, 1024, 640);
    g.strokeStyle = 'rgba(0,0,0,0.3)'; g.lineWidth = 2; g.strokeRect(13, 13, 998, 614);
    const pin = (x, y, col) => {
      g.fillStyle = 'rgba(0,0,0,0.3)'; g.beginPath(); g.arc(x + 3, y + 4, 7, 0, 7); g.fill();
      const gr = g.createRadialGradient(x - 2, y - 2, 1, x, y, 7); gr.addColorStop(0, '#fff'); gr.addColorStop(0.3, col); gr.addColorStop(1, 'rgba(0,0,0,0.8)');
      g.fillStyle = gr; g.beginPath(); g.arc(x, y, 7, 0, 7); g.fill();
    };
    const sheet = (x, y, w, h, rot, draw, pinCol = '#d22') => {
      g.save(); g.translate(x, y); g.rotate(rot);
      g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(-w / 2 + 6, -h / 2 + 8, w, h);
      g.beginPath(); g.rect(-w / 2, -h / 2, w, h); g.save(); g.clip(); g.translate(-w / 2, -h / 2); draw(w, h); g.restore();
      pin(0, -h / 2 + 12, pinCol);
      g.restore();
    };
    const starChart = (w, h) => {
      g.fillStyle = rgb(16, 24, 56); g.fillRect(0, 0, w, h);
      g.strokeStyle = 'rgba(140,170,255,0.3)'; g.lineWidth = 1;
      for (let k = 1; k < 8; k++) { g.beginPath(); g.ellipse(w / 2, h * 1.3, k * w * 0.16, k * h * 0.2, 0, Math.PI, 2 * Math.PI); g.stroke(); }
      for (let a = -4; a <= 4; a++) { g.beginPath(); g.moveTo(w / 2, h * 1.3); g.lineTo(w / 2 + a * w * 0.16, -10); g.stroke(); }
      // milky way smear
      g.save(); g.translate(w * 0.5, h * 0.5); g.rotate(-0.6);
      const mg = g.createLinearGradient(0, -h * 0.2, 0, h * 0.2); mg.addColorStop(0, 'rgba(180,190,255,0)'); mg.addColorStop(0.5, 'rgba(180,190,255,0.25)'); mg.addColorStop(1, 'rgba(180,190,255,0)');
      g.fillStyle = mg; g.fillRect(-w, -h * 0.2, 2 * w, h * 0.4); g.restore();
      for (let i = 0; i < w * h / 180; i++) { const r = Math.pow(rnd(), 4) * 3 + 0.5; g.fillStyle = `rgba(255,255,235,${0.6 + rnd() * 0.4})`; g.beginPath(); g.arc(rnd() * w, rnd() * h, r, 0, 7); g.fill(); }
      g.strokeStyle = 'rgba(255,210,120,0.6)'; g.lineWidth = 1.2;
      for (let q = 0; q < 3; q++) { g.beginPath(); let x = rnd() * w, y = rnd() * h; g.moveTo(x, y); for (let k = 0; k < 5; k++) { x += (rnd() - 0.4) * 60; y += (rnd() - 0.5) * 50; g.lineTo(x, y); } g.stroke(); }
      g.fillStyle = 'rgba(220,230,255,0.8)'; g.fillRect(8, h - 16, w * 0.4, 6);
    };
    sheet(210, 250, 330, 360, -0.04, starChart);
    sheet(560, 190, 260, 250, 0.05, starChart, '#2a6');
    sheet(820, 180, 220, 200, -0.06, (w, h) => {  // photo of a galaxy
      g.fillStyle = '#eee'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#05060a'; g.fillRect(10, 10, w - 20, h - 36);
      g.save(); g.translate(w / 2, h / 2 - 12); g.rotate(0.5); g.scale(1, 0.45);
      const gg = g.createRadialGradient(0, 0, 0, 0, 0, 70); gg.addColorStop(0, 'rgba(255,240,210,1)'); gg.addColorStop(0.2, 'rgba(230,200,170,0.7)'); gg.addColorStop(1, 'rgba(90,110,200,0)');
      g.fillStyle = gg; g.beginPath(); g.arc(0, 0, 70, 0, 7); g.fill(); g.restore();
      for (let i = 0; i < 40; i++) { g.fillStyle = 'rgba(255,255,255,0.8)'; g.fillRect(12 + rnd() * (w - 24), 12 + rnd() * (h - 40), 1.5, 1.5); }
    }, '#26c');
    sheet(820, 440, 190, 150, 0.08, (w, h) => { g.fillStyle = rgb(250, 248, 240); g.fillRect(0, 0, w, h); g.fillStyle = 'rgba(200,60,60,0.6)'; g.fillRect(0, 22, w, 2); scribble(g, rnd, 10, 40, w - 20, 6, 16, 'rgba(20,20,60,0.8)', 1.6); }, '#dd2');
    sheet(560, 470, 250, 190, -0.03, (w, h) => { // printed spectrum
      g.fillStyle = rgb(238, 238, 232); g.fillRect(0, 0, w, h);
      g.strokeStyle = 'rgba(0,0,0,0.6)'; g.strokeRect(20, 30, w - 40, h - 60);
      g.strokeStyle = 'rgba(20,40,140,0.9)'; g.lineWidth = 1.3; g.beginPath();
      for (let x = 0; x < w - 40; x++) g.lineTo(20 + x, h - 34 - 8 * rnd() - 90 * Math.exp(-Math.pow((x - (w - 40) * 0.55) / 10, 2)));
      g.stroke();
      textLines(g, rnd, 20, 10, w - 40, 1, 8, 'rgba(0,0,0,0.6)', 3);
    }, '#d22');
    sheet(120, 520, 150, 110, 0.1, (w, h) => { g.fillStyle = rgb(255, 234, 110); g.fillRect(0, 0, w, h); scribble(g, rnd, 12, 30, w - 24, 3, 22, 'rgba(20,20,40,0.85)', 3); }, '#22d');
    sheet(360, 560, 130, 100, -0.12, (w, h) => { g.fillStyle = rgb(170, 236, 150); g.fillRect(0, 0, w, h); scribble(g, rnd, 12, 30, w - 24, 2, 26, 'rgba(20,20,40,0.85)', 3); }, '#d22');
    T.cork = tex(c);
  }
  // books: atlas of 32 spines (each 32 x 256 px), last column pages
  {
    const [c, g] = canvas(1024, 256);
    const rnd = U.mulberry32(161);
    const cols = [[120, 30, 30], [30, 50, 90], [40, 70, 50], [200, 170, 90], [60, 40, 30], [150, 120, 80], [30, 30, 32], [170, 70, 30], [90, 100, 110], [210, 200, 180], [80, 30, 60], [40, 90, 100]];
    for (let i = 0; i < 31; i++) {
      const col = cols[Math.floor(rnd() * cols.length)], k = 0.75 + rnd() * 0.4;
      const x = i * 32;
      g.fillStyle = rgb(col[0] * k, col[1] * k, col[2] * k); g.fillRect(x, 0, 32, 256);
      const gr = g.createLinearGradient(x, 0, x + 32, 0);
      gr.addColorStop(0, 'rgba(0,0,0,0.45)'); gr.addColorStop(0.25, 'rgba(255,255,255,0.08)'); gr.addColorStop(0.7, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,0.4)');
      g.fillStyle = gr; g.fillRect(x, 0, 32, 256);
      const gold = rnd() < 0.5 ? 'rgba(230,200,120,0.85)' : 'rgba(240,240,230,0.8)';
      g.fillStyle = gold;
      if (rnd() < 0.6) { g.fillRect(x + 3, 24, 26, 2); g.fillRect(x + 3, 230, 26, 2); }
      for (let l = 0; l < 2 + Math.floor(rnd() * 2); l++) g.fillRect(x + 10 + l * 5, 60 + rnd() * 20, 2.5, 60 + rnd() * 70);
      g.fillRect(x + 8, 200, 16, 8);
    }
    g.fillStyle = rgb(226, 214, 186); g.fillRect(992, 0, 32, 256);
    g.fillStyle = 'rgba(0,0,0,0.12)'; for (let y = 0; y < 256; y += 2) g.fillRect(992, y, 32, 1);
    T.books = tex(c);
  }
  // wall clock face
  {
    const [c, g] = canvas(512, 512);
    g.fillStyle = rgb(236, 232, 218); g.beginPath(); g.arc(256, 256, 256, 0, 7); g.fill();
    g.fillStyle = 'rgba(0,0,0,0.08)'; g.beginPath(); g.arc(256, 256, 256, 0, 7); g.arc(256, 256, 236, 0, 7, true); g.fill();
    g.fillStyle = '#1a1a1a';
    for (let i = 0; i < 60; i++) {
      const a = i / 60 * Math.PI * 2, big = i % 5 === 0;
      g.save(); g.translate(256, 256); g.rotate(a);
      g.fillRect(-(big ? 5 : 1.5), -228, big ? 10 : 3, big ? 34 : 14);
      g.restore();
    }
    g.font = 'bold 54px "DejaVu Sans", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (let h = 1; h <= 12; h++) { const a = h / 12 * Math.PI * 2; g.fillText(String(h), 256 + Math.sin(a) * 160, 256 - Math.cos(a) * 160); }
    g.font = '18px "DejaVu Sans", sans-serif'; g.fillStyle = '#444'; g.fillText('QUARTZ', 256, 340);
    T.clock = tex(c);
  }
  // keyboard keycaps (0.45 x 0.16 m -> 1024 x 364)
  {
    const [c, g] = canvas(1024, 364);
    g.fillStyle = rgb(160, 152, 136); g.fillRect(0, 0, 1024, 364);
    const rnd = U.mulberry32(171);
    const key = (x, y, w, h, dark) => {
      g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(x, y, w, h);
      g.fillStyle = dark ? rgb(150, 144, 130) : rgb(214, 208, 192); g.fillRect(x + 2, y + 1, w - 4, h - 5);
      g.fillStyle = 'rgba(255,255,255,0.25)'; g.fillRect(x + 5, y + 4, w - 10, h - 13);
      g.fillStyle = 'rgba(40,40,40,0.75)'; g.fillRect(x + 8, y + 8, 6 + rnd() * 5, 7);
    };
    const u = 52;
    for (let i = 0; i < 12; i++) key(20 + i * (u + 4) + (i > 3 ? 14 : 0) + (i > 7 ? 14 : 0), 16, u, 40, true);
    const rows = [[0, 14], [0.5, 13], [0.75, 12], [1.25, 11]];
    rows.forEach(([off, n], r) => { for (let i = 0; i < n; i++) key(20 + (off + i) * (u + 4), 76 + r * 58, u, 54, false); });
    key(20 + 3.5 * (u + 4), 76 + 4 * 58, 6 * u, 50, false);
    for (let i = 0; i < 12; i++) key(840 + (i % 3) * (u + 4), 76 + Math.floor(i / 3) * 58, u, 54, true);
    T.keyboard = tex(c);
  }
  // window-glass smudges (alpha)
  {
    const [c, g] = canvas(256, 256);
    g.fillStyle = '#000'; g.fillRect(0, 0, 256, 256);
    blob(g, 256, 256, 9, 181, v => { const k = Math.max(0, v - 0.45) * 255 * 1.4; return [k, k, k, 255]; });
    const rnd = U.mulberry32(182);
    for (let i = 0; i < 30; i++) { g.strokeStyle = `rgba(255,255,255,${0.05 + rnd() * 0.12})`; g.lineWidth = 1 + rnd() * 3; g.beginPath(); const x = rnd() * 256; g.moveTo(x, rnd() * 80); g.lineTo(x + (rnd() - 0.5) * 20, 150 + rnd() * 100); g.stroke(); }
    T.glassDirt = tex(c, { srgb: false });
  }
  // posters: 0 = observatory poster, 1 = safety sign, 2 = hydrogen spectrum chart
  {
    const [c, g] = canvas(512, 720);
    const gr = g.createLinearGradient(0, 0, 0, 720); gr.addColorStop(0, '#0b1733'); gr.addColorStop(0.7, '#2d3e66'); gr.addColorStop(1, '#c78a52');
    g.fillStyle = gr; g.fillRect(0, 0, 512, 720);
    const rnd = U.mulberry32(191);
    for (let i = 0; i < 300; i++) { g.fillStyle = `rgba(255,255,240,${rnd() * 0.9})`; g.fillRect(rnd() * 512, rnd() * 460, 1.5, 1.5); }
    g.fillStyle = '#10131a';
    g.beginPath(); g.moveTo(0, 620); g.quadraticCurveTo(200, 560, 512, 600); g.lineTo(512, 720); g.lineTo(0, 720); g.fill();
    g.save(); g.translate(300, 470); g.rotate(-0.55);
    g.beginPath(); g.ellipse(0, 0, 120, 42, 0, 0, Math.PI * 2); g.fill(); g.restore();
    g.fillRect(292, 480, 20, 110); g.fillRect(250, 580, 110, 20);
    g.fillStyle = '#f2ead8'; g.font = 'bold 44px "DejaVu Sans", sans-serif'; g.textAlign = 'center';
    g.fillText('KESTREL RIDGE', 256, 70);
    g.font = '24px "DejaVu Sans", sans-serif'; g.fillText('RADIO OBSERVATORY', 256, 106);
    g.font = '16px "DejaVu Sans", sans-serif'; g.fillStyle = 'rgba(242,234,216,0.7)'; g.fillText('LISTENING SINCE 1968', 256, 690);
    T.poster = tex(c);
  }
  {
    const [c, g] = canvas(256, 320);
    g.fillStyle = '#f0ece0'; g.fillRect(0, 0, 256, 320);
    g.fillStyle = '#c21d1d'; g.fillRect(0, 0, 256, 70);
    g.fillStyle = '#fff'; g.font = 'bold 34px "DejaVu Sans", sans-serif'; g.textAlign = 'center'; g.fillText('CAUTION', 128, 48);
    g.fillStyle = '#1a1a1a'; g.font = 'bold 22px "DejaVu Sans", sans-serif';
    ['RADIO QUIET', 'ZONE', '', 'NO PHONES', 'NO WIFI', 'NO MICROWAVE'].forEach((s, i) => g.fillText(s, 128, 112 + i * 32));
    g.strokeStyle = '#1a1a1a'; g.lineWidth = 4; g.strokeRect(8, 78, 240, 234);
    T.sign = tex(c);
  }
  {
    // whiteboard with marker scribbles
    const [c, g] = canvas(1024, 640);
    g.fillStyle = '#eceeea'; g.fillRect(0, 0, 1024, 640);
    blob(g, 1024, 640, 6, 201, v => [150, 160, 170, v * 40]);
    const rnd = U.mulberry32(202);
    g.lineCap = 'round';
    const ink = ['rgba(30,50,140,0.85)', 'rgba(20,20,20,0.8)', 'rgba(170,30,30,0.8)', 'rgba(30,110,60,0.8)'];
    g.font = 'italic 40px "DejaVu Sans", sans-serif'; g.fillStyle = ink[0];
    g.fillText('HI  1420.405 MHz', 60, 90); g.fillText('λ = 21.1 cm', 60, 150);
    g.fillStyle = ink[2]; g.fillText('Tsys ~ 35 K', 600, 90);
    g.fillStyle = ink[1]; g.font = 'italic 30px "DejaVu Sans", sans-serif';
    g.fillText('v = c (f₀ - f) / f₀', 60, 230); g.fillText('S/N = Tsrc/Tsys √(Δν τ)', 60, 290);
    g.strokeStyle = ink[3]; g.lineWidth = 3; g.beginPath();
    for (let x = 0; x < 360; x++) g.lineTo(600 + x, 420 - 120 * Math.exp(-Math.pow((x - 180) / 40, 2)) - 20 * Math.sin(x * 0.05) - 4 * rnd());
    g.stroke();
    g.beginPath(); g.moveTo(600, 440); g.lineTo(970, 440); g.moveTo(600, 440); g.lineTo(600, 260); g.stroke();
    for (let i = 0; i < 5; i++) scribble(g, rnd, 60, 380 + i * 44, 420, 1, 10, ink[i % 2], 3);
    g.strokeStyle = 'rgba(40,40,40,0.15)'; g.lineWidth = 30;
    g.beginPath(); g.moveTo(500, 520); g.quadraticCurveTo(700, 480, 900, 560); g.stroke();
    T.whiteboard = tex(c);
  }
  // rack front panels (0.6 x 1.8 m -> 512 x 1536): units with labels, vents, dials
  {
    const [c, g] = canvas(512, 1536);
    const rnd = U.mulberry32(211);
    g.fillStyle = '#15171a'; g.fillRect(0, 0, 512, 1536);
    const unit = (y, h, col, fn) => {
      g.fillStyle = col; g.fillRect(30, y, 452, h - 4);
      g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(30, y, 452, 2);
      g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(30, y + h - 6, 452, 2);
      // rack ears + screws
      g.fillStyle = '#2a2c30'; g.fillRect(0, y, 30, h - 4); g.fillRect(482, y, 30, h - 4);
      g.fillStyle = '#8a8c90'; for (const x of [15, 497]) { g.beginPath(); g.arc(x, y + 12, 4, 0, 7); g.arc(x, y + h - 16, 4, 0, 7); g.fill(); }
      fn(y, h);
    };
    const label = (x, y, s, col = 'rgba(230,230,220,0.85)', size = 14) => { g.fillStyle = col; g.font = `bold ${size}px "DejaVu Sans Mono", monospace`; g.fillText(s, x, y); };
    const vents = (x, y, w, h) => { g.fillStyle = 'rgba(0,0,0,0.7)'; for (let k = 0; k < w; k += 10) g.fillRect(x + k, y, 5, h); };
    const knob = (x, y, r) => { const gr = g.createRadialGradient(x - r * 0.3, y - r * 0.3, 1, x, y, r); gr.addColorStop(0, '#666'); gr.addColorStop(1, '#111'); g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); g.fillStyle = '#ddd'; g.fillRect(x - 1, y - r, 2, r * 0.6); };
    let y = 20;
    unit(y, 90, '#2b2e33', (y0) => { vents(60, y0 + 20, 250, 50); label(340, y0 + 40, 'PWR DIST'); label(340, y0 + 64, '230V 16A', 'rgba(200,200,190,0.6)', 12); }); y += 90;
    unit(y, 180, '#3a3f45', (y0, h) => {   // oscilloscope (screen drawn in the scene)
      g.fillStyle = '#050807'; g.fillRect(60, y0 + 20, 200, 140);
      for (let i = 0; i < 6; i++) knob(300 + (i % 3) * 55, y0 + 50 + Math.floor(i / 3) * 70, 14);
      label(300, y0 + 165, 'SCOPE  CH1 CH2', 'rgba(220,220,210,0.7)', 11);
    }); y += 180;
    unit(y, 120, '#1f2226', (y0) => {    // frequency counter: 7-seg digits drawn in the scene
      g.fillStyle = '#100404'; g.fillRect(60, y0 + 30, 260, 60);
      label(340, y0 + 50, 'FREQ CTR'); label(340, y0 + 74, 'LO 1418.905', 'rgba(200,200,190,0.6)', 12);
    }); y += 120;
    unit(y, 150, '#43484f', (y0) => {    // receiver back-end with LED columns
      label(60, y0 + 30, 'IF / BACKEND  RX-3'); vents(60, y0 + 90, 180, 40);
      for (let i = 0; i < 4; i++) knob(300 + i * 45, y0 + 110, 12);
    }); y += 150;
    unit(y, 90, '#26292d', (y0) => { label(60, y0 + 34, 'PATCH'); g.fillStyle = '#0a0a0a'; for (let i = 0; i < 16; i++) { g.beginPath(); g.arc(150 + i * 20, y0 + 30, 6, 0, 7); g.arc(150 + i * 20, y0 + 60, 6, 0, 7); g.fill(); } }); y += 90;
    unit(y, 210, '#30343a', (y0) => {    // digital backend / correlator with drive bays
      label(60, y0 + 30, 'DIGITAL BACKEND  FFT 4096');
      for (let i = 0; i < 4; i++) { g.fillStyle = '#1a1c20'; g.fillRect(60 + i * 105, y0 + 60, 95, 120); g.fillStyle = 'rgba(255,255,255,0.1)'; g.fillRect(64 + i * 105, y0 + 64, 87, 6); vents(70 + i * 105, y0 + 90, 70, 60); }
    }); y += 210;
    unit(y, 150, '#2b2e33', (y0) => { label(60, y0 + 30, 'TIME / GPS  H-MASER REF'); g.fillStyle = '#0b1008'; g.fillRect(60, y0 + 50, 280, 50); }); y += 150;
    unit(y, 250, '#383c42', (y0) => {    // tape drive
      label(60, y0 + 30, 'DATA RECORDER');
      for (const x of [140, 360]) { g.fillStyle = '#0c0c0c'; g.beginPath(); g.arc(x, y0 + 140, 80, 0, 7); g.fill(); g.fillStyle = '#6a6a6a'; g.beginPath(); g.arc(x, y0 + 140, 30, 0, 7); g.fill(); g.fillStyle = '#0c0c0c'; g.beginPath(); g.arc(x, y0 + 140, 10, 0, 7); g.fill(); }
    }); y += 250;
    unit(y, 250, '#1d2024', (y0) => { vents(60, y0 + 30, 390, 180); label(60, y0 + 235, 'UPS 3000', 'rgba(220,220,210,0.7)', 12); }); y += 250;
    T.rack = tex(c);
    T.rackLayout = { oscope: [60, 20 + 90 + 20, 200, 140], counter: [60, 20 + 90 + 180 + 30, 260, 60] };
  }
  // receiver front panel (0.46 x 0.22 m -> 512 x 245)
  {
    const [c, g] = canvas(512, 245);
    const rnd = U.mulberry32(221);
    g.fillStyle = rgb(92, 98, 100); g.fillRect(0, 0, 512, 245);
    for (let i = 0; i < 9000; i++) { g.fillStyle = `rgba(${rnd() < 0.5 ? '0,0,0' : '255,255,255'},${rnd() * 0.08})`; g.fillRect(rnd() * 512, rnd() * 245, 2, 2); }
    // dial window (lit in the scene), meter window
    g.fillStyle = '#1b1208'; g.fillRect(40, 30, 300, 80);
    g.fillStyle = '#120d06'; g.fillRect(370, 30, 110, 80);
    g.fillStyle = 'rgba(240,240,230,0.85)'; g.font = 'bold 13px "DejaVu Sans", sans-serif';
    ['BAND', 'RF GAIN', 'AF GAIN', 'BFO', 'SELECT', 'AGC'].forEach((s, i) => g.fillText(s, 34 + i * 80, 225));
    g.font = 'bold 16px "DejaVu Sans", sans-serif'; g.fillText('RX-60  COMMUNICATIONS RECEIVER', 40, 20);
    T.receiver = tex(c);
  }
  // receiver dial (emissive): frequency scales
  {
    const [c, g] = canvas(512, 136);
    const gr = g.createLinearGradient(0, 0, 0, 136); gr.addColorStop(0, '#f2c070'); gr.addColorStop(1, '#d08a3a');
    g.fillStyle = gr; g.fillRect(0, 0, 512, 136);
    g.fillStyle = 'rgba(40,20,5,0.9)'; g.font = 'bold 15px "DejaVu Sans", sans-serif'; g.textAlign = 'center';
    for (let r = 0; r < 3; r++) {
      const y = 30 + r * 40;
      for (let i = 0; i <= 50; i++) g.fillRect(12 + i * 9.7, y, 1.2, i % 5 ? 6 : 12);
      for (let i = 0; i <= 10; i++) g.fillText(String([2, 5, 14][r] + i * [0.3, 1, 2][r]).slice(0, 4), 12 + i * 48.5, y + 28);
    }
    T.dial = tex(c);
  }
  // fridge magnets / stickers (on white): 256 x 256
  {
    const [c, g] = canvas(512, 512);
    g.fillStyle = '#e6e4dc'; g.fillRect(0, 0, 512, 512);
    g.globalCompositeOperation = 'multiply';
    blob(g, 512, 512, 4, 231, v => { const k = 228 + 27 * v; return [k, k, k * 0.97, 255]; });
    g.globalCompositeOperation = 'source-over';
    const rnd = U.mulberry32(232);
    const note = (x, y, w, h, col, r) => { g.save(); g.translate(x, y); g.rotate(r); g.fillStyle = 'rgba(0,0,0,0.2)'; g.fillRect(3, 4, w, h); g.fillStyle = col; g.fillRect(0, 0, w, h); scribble(g, rnd, 8, 22, w - 16, Math.floor(h / 22), 18, 'rgba(20,20,40,0.8)', 1.8); g.restore(); };
    note(60, 80, 150, 190, '#f7f3e8', -0.05);
    note(260, 60, 120, 90, '#ffe970', 0.08);
    note(250, 220, 180, 130, '#cfe8ff', -0.03);
    const mag = (x, y, col) => { g.fillStyle = col; g.beginPath(); g.arc(x, y, 12, 0, 7); g.fill(); g.fillStyle = 'rgba(255,255,255,0.35)'; g.beginPath(); g.arc(x - 3, y - 4, 4, 0, 7); g.fill(); };
    mag(135, 84, '#d33'); mag(320, 64, '#36c'); mag(340, 224, '#3a3');
    g.fillStyle = '#b4b0a6'; g.fillRect(470, 150, 16, 200);
    T.fridge = tex(c);
  }
  // mug print atlas: 4 mugs (512 x 128 each strip)
  {
    const [c, g] = canvas(1024, 256);
    const bases = ['#e9e4d8', '#2d4f7a', '#b8452f', '#3b3b3b'];
    for (let i = 0; i < 4; i++) {
      const x = (i % 2) * 512, y = Math.floor(i / 2) * 128;
      g.fillStyle = bases[i]; g.fillRect(x, y, 512, 128);
      g.fillStyle = i === 0 ? '#27466e' : '#f0ece2';
      g.font = 'bold 30px "DejaVu Sans", sans-serif'; g.textAlign = 'center';
      if (i === 0) { g.fillText('I ♥ 21cm', x + 128, y + 76); }
      if (i === 1) { g.beginPath(); g.arc(x + 128, y + 64, 26, Math.PI, 0); g.lineTo(x + 128, y + 64); g.fill(); g.fillRect(x + 125, y + 64, 6, 34); }
      if (i === 2) { g.font = 'bold 24px "DejaVu Sans", sans-serif'; g.fillText('WORLD\'S OKAYEST', x + 128, y + 58); g.fillText('ASTRONOMER', x + 128, y + 88); }
    }
    T.mugs = tex(c);
  }
  return T;
}
