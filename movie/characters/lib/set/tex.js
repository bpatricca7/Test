// Procedural textures for the hut interior, baked once into canvases in create():
// colour maps, normal maps (from baked height fields), printed and handwritten
// paper, book spines, rack panels, stains, smudges. Deterministic (U.mulberry32).

export function makeTextures(env) {
  const { THREE, U, renderer } = env;
  const maxAniso = 1;     // anisotropic filtering is very expensive on SwiftShader
  const SANS = '"DejaVu Sans", "Liberation Sans", sans-serif';
  const SERIF = '"DejaVu Serif", "Liberation Serif", serif';
  const MONO = '"DejaVu Sans Mono", "Liberation Mono", monospace';
  const HAND = '"FreeSans", "Liberation Sans", sans-serif';

  const canvas = (w, h) => {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return [c, c.getContext('2d')];
  };
  const tex = (c, { srgb = true, aniso = maxAniso, mips = true } = {}) => {
    const t = new THREE.CanvasTexture(c);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = aniso;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
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
    for (let j = 0; j < ch + 2; j++) for (let i = 0; i < cw + 2; i++) {
      const v = vals[((j - 1 + ch) % ch) * cw + ((i - 1 + cw) % cw)];
      const [r, gg, b, a] = paint(v);
      const k = (j * (cw + 2) + i) * 4;
      id.data[k] = r; id.data[k + 1] = gg; id.data[k + 2] = b; id.data[k + 3] = a;
    }
    sg.putImageData(id, 0, 0);
    g.save();
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
    const sx = w / cw, sy = h / ch;
    g.drawImage(s, -1.5 * sx, -1.5 * sy, (cw + 2) * sx, (ch + 2) * sy);
    g.restore();
  }
  function grain(g, w, h, amt, seed, mono = true) {
    const rnd = U.mulberry32(seed);
    const id = g.getImageData(0, 0, w, h), d = id.data;
    for (let i = 0; i < d.length; i += 4) {
      const n = (rnd() - 0.5) * amt;
      if (mono) { d[i] += n; d[i + 1] += n; d[i + 2] += n; }
      else { d[i] += n; d[i + 1] += (rnd() - 0.5) * amt; d[i + 2] += (rnd() - 0.5) * amt; }
    }
    g.putImageData(id, 0, 0);
  }
  /** tangent-space normal map from a grey height canvas (wraps at the edges) */
  function normalMap(src, strength = 2, blur = 0) {
    const w = src.width, h = src.height;
    let s = src;
    if (blur > 0) { const [b, bg] = canvas(w, h); bg.filter = `blur(${blur}px)`; bg.drawImage(src, 0, 0); s = b; }
    const d = s.getContext('2d').getImageData(0, 0, w, h).data;
    const [c, g] = canvas(w, h);
    const out = g.createImageData(w, h), o = out.data;
    const H = (x, y) => d[(((y + h) % h) * w + ((x + w) % w)) * 4] / 255;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const dx = (H(x + 1, y) - H(x - 1, y)) * strength, dy = (H(x, y + 1) - H(x, y - 1)) * strength;
      const l = Math.sqrt(dx * dx + dy * dy + 1);
      const k = (y * w + x) * 4;
      o[k] = (-dx / l * 0.5 + 0.5) * 255; o[k + 1] = (dy / l * 0.5 + 0.5) * 255; o[k + 2] = (1 / l * 0.5 + 0.5) * 255; o[k + 3] = 255;
    }
    g.putImageData(out, 0, 0);
    return tex(c, { srgb: false });
  }
  // handwriting: jittered italic glyphs
  function hand(g, rnd, s, x, y, size, col, slant = -0.15) {
    g.save();
    g.fillStyle = col;
    g.font = `italic ${size}px ${HAND}`;
    g.textBaseline = 'alphabetic';
    let xx = x;
    for (const ch of s) {
      g.save();
      g.translate(xx, y + (rnd() - 0.5) * size * 0.08);
      g.rotate(slant * 0.3 + (rnd() - 0.5) * 0.12);
      g.scale(1 + (rnd() - 0.5) * 0.1, 1 + (rnd() - 0.5) * 0.12);
      g.fillText(ch, 0, 0);
      g.restore();
      xx += g.measureText(ch).width * (0.92 + rnd() * 0.12);
    }
    g.restore();
    return xx;
  }
  function print(g, lines, x, y, lh, font, col) {
    g.fillStyle = col; g.font = font; g.textBaseline = 'alphabetic';
    lines.forEach((s, i) => g.fillText(s, x, y + i * lh));
  }
  const pad = (v, n) => String(v).padStart(n, ' ');
  const fx = (v, d) => v.toFixed(d);

  // -------------------------------------------------------------------------
  // wood boards: colour + height (grooves, grain relief, dents)
  // -------------------------------------------------------------------------
  function woodBoards({ w, h, boards, base, spread, seed, grooveDark = 0.55, knots = 3, joints = false, grainDark = 0.7, stain = 0, bevel = 3 }) {
    const [c, g] = canvas(w, h);
    const [cb, gb] = canvas(w, h);
    const rnd = U.mulberry32(seed);
    const bw = w / boards;
    gb.fillStyle = '#808080'; gb.fillRect(0, 0, w, h);
    for (let i = 0; i < boards; i++) {
      const x0 = i * bw;
      const cuts = [0];
      if (joints) { let y = rnd() * h * 0.6; while (y < h) { cuts.push(y); y += h * (0.35 + rnd() * 0.5); } }
      cuts.push(h);
      for (let p = 0; p < cuts.length - 1; p++) {
        const y0 = cuts[p], y1 = cuts[p + 1];
        const k = 1 + (rnd() - 0.5) * spread, hue = (rnd() - 0.5) * 0.12;
        const col = [base[0] * k * (1 + hue), base[1] * k, base[2] * k * (1 - hue)];
        g.fillStyle = rgb(...col);
        g.fillRect(x0, y0, bw + 1, y1 - y0);
        const nL = Math.round(bw / 2.0), ph = rnd() * 100;
        for (let l = 0; l < nL; l++) {
          const u = (l + rnd() * 0.8) / nL, dark = rnd() < 0.3;
          const st = rgb(col[0] * (dark ? grainDark * 0.8 : grainDark + 0.15), col[1] * (dark ? grainDark * 0.75 : grainDark + 0.1), col[2] * (dark ? grainDark * 0.7 : grainDark + 0.05), dark ? 0.55 : 0.22);
          const lw = dark ? 0.8 + rnd() * 1.4 : 0.6 + rnd();
          const amp = 1.5 + rnd() * 3.5, fr = 0.004 + rnd() * 0.01;
          g.strokeStyle = st; g.lineWidth = lw; g.beginPath();
          gb.strokeStyle = dark ? 'rgba(90,90,90,0.5)' : 'rgba(110,110,110,0.25)'; gb.lineWidth = lw;
          const path = [];
          for (let y = y0; y <= y1; y += 6) path.push([x0 + u * bw + amp * Math.sin(y * fr + ph + l * 0.3) + 2.0 * Math.sin(y * 0.031 + l), y]);
          path.forEach(([x, y], j) => (j ? g.lineTo(x, y) : g.moveTo(x, y)));
          g.stroke();
          gb.beginPath(); path.forEach(([x, y], j) => (j ? gb.lineTo(x, y) : gb.moveTo(x, y))); gb.stroke();
        }
        if (rnd() < 0.7) {
          const cx = x0 + bw * (0.3 + rnd() * 0.4), cy = y0 + (y1 - y0) * rnd();
          for (let r = 0; r < 7; r++) {
            g.strokeStyle = rgb(col[0] * 0.62, col[1] * 0.55, col[2] * 0.48, 0.18); g.lineWidth = 1 + rnd();
            g.beginPath(); g.ellipse(cx, cy, bw * (0.08 + r * 0.05), (y1 - y0) * (0.12 + r * 0.06) + 20, 0, 0, Math.PI * 2); g.stroke();
          }
        }
        for (let q = 0; q < knots; q++) {
          if (rnd() > 0.45) continue;
          const kx = x0 + bw * (0.2 + 0.6 * rnd()), ky = y0 + (y1 - y0) * rnd(), kr = 3 + rnd() * bw * 0.12;
          const gr = g.createRadialGradient(kx, ky, 0, kx, ky, kr * 2.2);
          gr.addColorStop(0, rgb(col[0] * 0.3, col[1] * 0.22, col[2] * 0.15, 0.95));
          gr.addColorStop(0.35, rgb(col[0] * 0.5, col[1] * 0.38, col[2] * 0.25, 0.8));
          gr.addColorStop(1, rgb(col[0] * 0.8, col[1] * 0.7, col[2] * 0.6, 0));
          g.fillStyle = gr; g.beginPath(); g.ellipse(kx, ky, kr * 1.4, kr * 2.4, 0, 0, Math.PI * 2); g.fill();
          gb.fillStyle = 'rgba(70,70,70,0.6)'; gb.beginPath(); gb.ellipse(kx, ky, kr * 0.9, kr * 1.6, 0, 0, Math.PI * 2); gb.fill();
        }
        if (joints && p > 0) {
          g.fillStyle = rgb(20, 12, 6, 0.8); g.fillRect(x0, y0 - 1, bw, 2.5);
          gb.fillStyle = '#202020'; gb.fillRect(x0, y0 - 1.5, bw, 3);
        }
      }
      // groove, bevelled and worn edges (lighter where the finish has rubbed off)
      g.fillStyle = rgb(base[0] * 0.2, base[1] * 0.15, base[2] * 0.1, grooveDark);
      g.fillRect(x0 - 1, 0, 3, h);
      g.fillStyle = rgb(255, 235, 200, 0.12); g.fillRect(x0 + 2, 0, 1.5, h);
      for (let y = 0; y < h; y += 4) {
        const wv = U.vnoise3(i * 3.1, y * 0.02, seed);
        if (wv > 0.62) { g.fillStyle = rgb(235, 205, 160, (wv - 0.62) * 0.9); g.fillRect(x0 + 1.5, y, 2 + (wv - 0.62) * 8, 4); g.fillRect(x0 - 3 - (wv - 0.62) * 6, y, 2 + (wv - 0.62) * 6, 4); }
      }
      const grd = gb.createLinearGradient(x0 - bevel - 1, 0, x0 + bevel + 1, 0);
      grd.addColorStop(0, '#808080'); grd.addColorStop(0.45, '#101010'); grd.addColorStop(0.55, '#101010'); grd.addColorStop(1, '#808080');
      gb.fillStyle = grd; gb.fillRect(x0 - bevel - 1, 0, 2 * bevel + 2, h);
      if (i === 0) { gb.fillRect(w - bevel - 1, 0, bevel + 1, h); }
    }
    // dents and dings
    for (let i = 0; i < w * h / 9000; i++) {
      const x = rnd() * w, y = rnd() * h, r = 1 + rnd() * 3;
      gb.fillStyle = 'rgba(40,40,40,0.5)'; gb.beginPath(); gb.arc(x, y, r, 0, 7); gb.fill();
      g.fillStyle = 'rgba(40,24,12,0.25)'; g.beginPath(); g.arc(x, y, r * 0.8, 0, 7); g.fill();
    }
    g.globalCompositeOperation = 'multiply';
    blob(g, w, h, 6, seed + 1, v => { const k = 205 + 50 * v; return [k, k * 0.97, k * 0.94, 255]; });
    g.globalCompositeOperation = 'source-over';
    if (stain > 0) blob(g, w, h, 14, seed + 2, v => [40, 25, 12, Math.max(0, v - 0.6) * 255 * stain]);
    grain(g, w, h, 10, seed + 3);
    return [c, cb];
  }

  const T = {};

  // wainscot: honey pine, vertical boards, 8 per metre; dirt and scuffs near the floor
  {
    const [c, b] = woodBoards({ w: 1024, h: 1024, boards: 8, base: [178, 124, 72], spread: 0.22, seed: 11, knots: 4 });
    const g = c.getContext('2d'), gb = b.getContext('2d');
    const gr = g.createLinearGradient(0, 1024, 0, 700);
    gr.addColorStop(0, 'rgba(40,28,16,0.45)'); gr.addColorStop(1, 'rgba(40,28,16,0)');
    g.fillStyle = gr; g.fillRect(0, 700, 1024, 324);
    const rnd = U.mulberry32(5);
    for (let i = 0; i < 70; i++) {       // shoe and chair scuffs
      const x = rnd() * 1024, y = 840 + rnd() * 170, l = 10 + rnd() * 70;
      g.strokeStyle = `rgba(30,20,10,${0.1 + rnd() * 0.3})`; g.lineWidth = 1 + rnd() * 3;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + (rnd() - 0.5) * l, y + (rnd() - 0.5) * 8); g.stroke();
      gb.strokeStyle = 'rgba(60,60,60,0.5)'; gb.lineWidth = 1; gb.beginPath(); gb.moveTo(x, y); gb.lineTo(x + (rnd() - 0.5) * l, y + (rnd() - 0.5) * 8); gb.stroke();
    }
    for (let i = 0; i < 12; i++) { const x = rnd() * 1024, y = rnd() * 600; g.fillStyle = 'rgba(20,14,8,0.8)'; g.beginPath(); g.arc(x, y, 1.6, 0, 7); g.fill(); gb.fillStyle = '#202020'; gb.beginPath(); gb.arc(x, y, 1.6, 0, 7); gb.fill(); }   // nail holes
    T.pine = tex(c); T.pineN = normalMap(b, 3.0, 0.6);
  }
  // floor: stained oak planks (14 cm) along X, 2 m tile; scuffs, caster swirls, worn varnish
  {
    const [c, b] = woodBoards({ w: 1024, h: 1024, boards: 14, base: [120, 78, 46], spread: 0.3, seed: 21, knots: 2, joints: true, grainDark: 0.62, stain: 0.6, bevel: 2 });
    const g = c.getContext('2d'), gb = b.getContext('2d');
    const rnd = U.mulberry32(22);
    for (let i = 0; i < 420; i++) {
      const light = rnd() < 0.5;
      g.strokeStyle = `rgba(${light ? '230,200,160' : '25,15,8'},${0.05 + rnd() * 0.13})`;
      g.lineWidth = 0.5 + rnd();
      const x = rnd() * 1024, y = rnd() * 1024, a = (rnd() - 0.5) * 0.6 + (rnd() < 0.5 ? Math.PI / 2 : 0), l = 10 + rnd() * 80;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
      if (light) { gb.strokeStyle = 'rgba(70,70,70,0.4)'; gb.lineWidth = 0.8; gb.beginPath(); gb.moveTo(x, y); gb.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); gb.stroke(); }
    }
    // rubber heel marks
    for (let i = 0; i < 40; i++) { const x = rnd() * 1024, y = rnd() * 1024; g.strokeStyle = `rgba(10,8,6,${0.2 + rnd() * 0.35})`; g.lineWidth = 2 + rnd() * 3; g.beginPath(); g.arc(x, y, 6 + rnd() * 18, rnd() * 6, rnd() * 6 + 0.5 + rnd()); g.stroke(); }
    // caster swirls (the chair lives on this floor)
    for (let i = 0; i < 12; i++) {
      const cx = rnd() * 1024, cy = rnd() * 1024;
      for (let k = 0; k < 14; k++) { g.strokeStyle = `rgba(215,190,150,${0.03 + rnd() * 0.05})`; g.lineWidth = 1.2; g.beginPath(); g.arc(cx + (rnd() - 0.5) * 30, cy + (rnd() - 0.5) * 30, 30 + rnd() * 90, rnd() * 6, rnd() * 6 + 1 + rnd() * 2); g.stroke(); }
    }
    // dust in the grooves
    g.fillStyle = 'rgba(150,140,120,0.08)';
    for (let y = 0; y < 1024; y += 1024 / 14) g.fillRect(0, y - 1, 1024, 3);
    T.floor = tex(c); T.floorN = normalMap(b, 2.5, 0.6);
    // separate roughness: worn varnish is rougher
    const [cr, gr2] = canvas(256, 256);
    gr2.fillStyle = 'rgb(120,120,120)'; gr2.fillRect(0, 0, 256, 256);
    blob(gr2, 256, 256, 8, 23, v => { const k = 90 + 110 * v; return [k, k, k, 255]; });
    grain(gr2, 256, 256, 30, 24);
    T.floorRough = tex(cr, { srgb: false });
  }
  // painted upper wall: warm grey-green, roller texture, faint marks
  {
    const [c, g] = canvas(1024, 1024);
    g.fillStyle = rgb(150, 156, 140); g.fillRect(0, 0, 1024, 1024);
    g.globalCompositeOperation = 'multiply';
    blob(g, 1024, 1024, 5, 31, v => { const k = 215 + 40 * v; return [k, k, k * 0.98, 255]; });
    blob(g, 1024, 1024, 24, 32, v => { const k = 236 + 19 * v; return [k, k, k, 255]; });
    g.globalCompositeOperation = 'source-over';
    const rnd = U.mulberry32(35);
    for (let i = 0; i < 20; i++) { const x = rnd() * 1024, y = rnd() * 1024; g.fillStyle = `rgba(90,85,70,${0.04 + rnd() * 0.06})`; g.beginPath(); g.ellipse(x, y, 10 + rnd() * 40, 6 + rnd() * 20, rnd() * 3, 0, 7); g.fill(); }
    for (let i = 0; i < 8; i++) { const x = rnd() * 1024, y = rnd() * 1024; g.fillStyle = 'rgba(40,40,35,0.5)'; g.fillRect(x, y, 2, 2); }      // old tack holes
    grain(g, 1024, 1024, 7, 33);
    T.paint = tex(c);
    const [cb, gb] = canvas(512, 512);
    gb.fillStyle = '#808080'; gb.fillRect(0, 0, 512, 512);
    blob(gb, 512, 512, 60, 34, v => { const k = 100 + 60 * v; return [k, k, k, 255]; });
    grain(gb, 512, 512, 30, 36);
    T.paintN = normalMap(cb, 1.2, 0.5);
  }
  // ceiling boards: painted off-white, 10 cm
  {
    const [c, b] = woodBoards({ w: 512, h: 512, boards: 10, base: [196, 190, 176], spread: 0.06, seed: 41, knots: 0, grooveDark: 0.5, grainDark: 0.93 });
    T.ceiling = tex(c); T.ceilingN = normalMap(b, 2.0, 0.5);
  }
  // beams / trim: dark stained, dinged
  {
    const [c, b] = woodBoards({ w: 256, h: 512, boards: 1, base: [86, 56, 34], spread: 0.1, seed: 51, knots: 2, grooveDark: 0 });
    T.beam = tex(c); T.beamN = normalMap(b, 2.0, 0.5);
  }
  // desk top: worn walnut laminate, rings, scratches, worn front edge
  {
    const [c, b] = woodBoards({ w: 512, h: 1024, boards: 1, base: [128, 90, 58], spread: 0.0, seed: 61, knots: 0, grooveDark: 0, grainDark: 0.72 });
    const [c2, g2] = canvas(1024, 512);
    g2.save(); g2.translate(1024, 0); g2.rotate(Math.PI / 2); g2.drawImage(c, 0, 0, 512, 1024); g2.restore();
    const [b2, gb2] = canvas(1024, 512);
    gb2.save(); gb2.translate(1024, 0); gb2.rotate(Math.PI / 2); gb2.drawImage(b, 0, 0, 512, 1024); gb2.restore();
    const rnd = U.mulberry32(62);
    for (let i = 0; i < 9; i++) {
      const x = rnd() * 1024, y = 80 + rnd() * 380, r = 20 + rnd() * 6;
      g2.strokeStyle = `rgba(60,34,16,${0.25 + rnd() * 0.25})`; g2.lineWidth = 2 + rnd() * 2;
      g2.beginPath(); g2.arc(x, y, r, rnd() * 3, rnd() * 3 + 4 + rnd() * 2); g2.stroke();
    }
    const wear = g2.createLinearGradient(0, 512, 0, 380);
    wear.addColorStop(0, 'rgba(210,180,140,0.22)'); wear.addColorStop(1, 'rgba(210,180,140,0)');
    g2.fillStyle = wear; g2.fillRect(0, 380, 1024, 132);
    for (let i = 0; i < 240; i++) {
      const x = rnd() * 1024, y = rnd() * 512, l = 20 + rnd() * 60;
      g2.strokeStyle = `rgba(230,210,180,${0.04 + rnd() * 0.08})`; g2.lineWidth = 0.6;
      g2.beginPath(); g2.moveTo(x, y); g2.lineTo(x + l, y + (rnd() - 0.5) * 8); g2.stroke();
      gb2.strokeStyle = 'rgba(80,80,80,0.5)'; gb2.lineWidth = 0.8; gb2.beginPath(); gb2.moveTo(x, y); gb2.lineTo(x + l, y + (rnd() - 0.5) * 8); gb2.stroke();
    }
    // a pen doodle and a burn mark
    g2.strokeStyle = 'rgba(30,40,110,0.35)'; g2.lineWidth = 1.2; g2.beginPath();
    for (let a = 0; a < 30; a += 0.2) g2.lineTo(700 + Math.cos(a) * (4 + a * 1.2), 420 + Math.sin(a) * (4 + a * 1.2));
    g2.stroke();
    const bgr = g2.createRadialGradient(300, 150, 1, 300, 150, 14); bgr.addColorStop(0, 'rgba(20,10,5,0.8)'); bgr.addColorStop(1, 'rgba(20,10,5,0)');
    g2.fillStyle = bgr; g2.beginPath(); g2.ellipse(300, 150, 18, 8, 0.3, 0, 7); g2.fill();
    T.desk = tex(c2); T.deskN = normalMap(b2, 2.0, 0.5);
  }

  // -------------------------------------------------------------------------
  // fabrics (colour + weave height)
  // -------------------------------------------------------------------------
  function fabric({ w = 512, h = 512, base, seed, wale = 0, weave = 2, wear = 0.3, fleck = 0 }) {
    const [c, g] = canvas(w, h);
    const [cb, gb] = canvas(w, h);
    g.fillStyle = rgb(...base); g.fillRect(0, 0, w, h);
    gb.fillStyle = '#808080'; gb.fillRect(0, 0, w, h);
    const rnd = U.mulberry32(seed);
    if (wale > 0) {
      for (let x = 0; x < w; x += wale) {
        const gr = g.createLinearGradient(x, 0, x + wale, 0);
        gr.addColorStop(0, 'rgba(0,0,0,0.35)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.10)'); gr.addColorStop(1, 'rgba(0,0,0,0.35)');
        g.fillStyle = gr; g.fillRect(x, 0, wale, h);
        const gh = gb.createLinearGradient(x, 0, x + wale, 0);
        gh.addColorStop(0, '#303030'); gh.addColorStop(0.5, '#d0d0d0'); gh.addColorStop(1, '#303030');
        gb.fillStyle = gh; gb.fillRect(x, 0, wale, h);
      }
    }
    if (weave > 0) {
      g.fillStyle = 'rgba(0,0,0,0.12)';
      for (let y = 0; y < h; y += weave * 2) g.fillRect(0, y, w, weave * 0.8);
      g.fillStyle = 'rgba(255,255,255,0.05)';
      for (let x = 0; x < w; x += weave * 2) g.fillRect(x, 0, weave * 0.8, h);
      gb.fillStyle = 'rgba(40,40,40,0.5)';
      for (let y = 0; y < h; y += weave * 2) gb.fillRect(0, y, w, weave * 0.8);
      gb.fillStyle = 'rgba(200,200,200,0.3)';
      for (let x = 0; x < w; x += weave * 2) gb.fillRect(x, 0, weave * 0.8, h);
    }
    g.globalCompositeOperation = 'multiply';
    blob(g, w, h, 5, seed + 1, v => { const k = 200 + 55 * v; return [k, k, k, 255]; });
    g.globalCompositeOperation = 'source-over';
    // worn, lighter and flattened patches
    blob(g, w, h, 8, seed + 2, v => [255, 240, 220, Math.max(0, v - 0.55) * 255 * wear]);
    blob(gb, w, h, 8, seed + 2, v => [128, 128, 128, Math.max(0, v - 0.55) * 255 * wear * 1.5]);
    if (fleck) for (let i = 0; i < fleck; i++) { g.fillStyle = `rgba(255,255,255,${rnd() * 0.12})`; g.fillRect(rnd() * w, rnd() * h, 1, 2); }
    // pilling / lint
    for (let i = 0; i < w * h / 1500; i++) { const x = rnd() * w, y = rnd() * h; g.fillStyle = `rgba(${base.map(v => Math.min(255, v + 40)).join(',')},0.4)`; g.beginPath(); g.arc(x, y, 0.8 + rnd(), 0, 7); g.fill(); gb.fillStyle = 'rgba(200,200,200,0.6)'; gb.beginPath(); gb.arc(x, y, 1, 0, 7); gb.fill(); }
    grain(g, w, h, 16, seed + 3);
    return [c, cb];
  }
  {
    // armchair: faded rust corduroy with rubbed-bare patches
    const [c, b] = fabric({ base: [128, 66, 42], seed: 71, wale: 6, weave: 0, wear: 0.65 });
    const g = c.getContext('2d');
    const rnd = U.mulberry32(73);
    for (let i = 0; i < 5; i++) { const x = rnd() * 512, y = rnd() * 512; const gr = g.createRadialGradient(x, y, 1, x, y, 40 + rnd() * 30); gr.addColorStop(0, 'rgba(70,40,25,0.35)'); gr.addColorStop(1, 'rgba(70,40,25,0)'); g.fillStyle = gr; g.fillRect(x - 80, y - 80, 160, 160); }   // old stains
    T.armFabric = tex(c); T.armFabricN = normalMap(b, 2.5, 0.8);
  }
  {
    const [c, b] = fabric({ w: 256, h: 256, base: [44, 46, 50], seed: 72, weave: 2, wear: 0.15, fleck: 800 });
    T.chairFabric = tex(c); T.chairFabricN = normalMap(b, 2.0, 0.4);
  }
  // rug: faded kilim with worn pile
  {
    const [c, g] = canvas(1024, 768);
    const cols = [[138, 48, 36], [178, 136, 88], [48, 60, 86], [200, 180, 150], [96, 70, 44]];
    g.fillStyle = rgb(...cols[0]); g.fillRect(0, 0, 1024, 768);
    g.fillStyle = rgb(...cols[3]); g.fillRect(40, 40, 944, 688);
    g.fillStyle = rgb(...cols[0]); g.fillRect(70, 70, 884, 628);
    for (let k = 0; k < 3; k++) {
      const cx = 512, cy = 384, sz = [300, 210, 120][k];
      g.fillStyle = rgb(...cols[[2, 1, 4][k]]);
      g.beginPath();
      for (let a = 0; a < 4; a++) { const ang = a * Math.PI / 2; g.lineTo(cx + Math.cos(ang) * sz * 1.4, cy + Math.sin(ang) * sz * 0.9); }
      g.fill();
    }
    for (let i = 0; i < 12; i++) {
      const x = 110 + (i % 6) * 160 + (i >= 6 ? 80 : 0), y = i < 6 ? 130 : 640;
      g.fillStyle = rgb(...cols[i % 2 ? 2 : 1]);
      g.beginPath(); g.moveTo(x, y - 30); g.lineTo(x + 30, y); g.lineTo(x, y + 30); g.lineTo(x - 30, y); g.fill();
    }
    g.fillStyle = 'rgba(0,0,0,0.10)';
    for (let y = 0; y < 768; y += 4) g.fillRect(0, y, 1024, 1.5);
    g.globalCompositeOperation = 'multiply';
    blob(g, 1024, 768, 7, 82, v => { const k = 170 + 85 * v; return [k, k, k, 255]; });
    g.globalCompositeOperation = 'source-over';
    blob(g, 1024, 768, 5, 83, v => [220, 200, 170, Math.max(0, v - 0.5) * 110]);
    grain(g, 1024, 768, 22, 84, false);
    T.rug = tex(c);
    const [cb, gb] = canvas(256, 256); gb.fillStyle = '#808080'; gb.fillRect(0, 0, 256, 256);
    for (let y = 0; y < 256; y += 4) { gb.fillStyle = '#404040'; gb.fillRect(0, y, 256, 1.5); }
    grain(gb, 256, 256, 60, 85);
    T.rugN = normalMap(cb, 1.5, 0.3);
  }
  // blanket: knitted tartan throw (stitches in the height map)
  {
    const [c, g] = canvas(512, 512);
    const [cb, gb] = canvas(512, 512);
    g.fillStyle = rgb(206, 192, 164); g.fillRect(0, 0, 512, 512);
    const bands = [[0, 60, [120, 36, 34]], [60, 14, [40, 64, 48]], [150, 90, [120, 36, 34]], [256, 20, [40, 64, 48]], [300, 60, [120, 36, 34]], [420, 30, [40, 64, 48]]];
    g.globalAlpha = 0.75;
    for (const [p, wdt, col] of bands) { g.fillStyle = rgb(...col); g.fillRect(p, 0, wdt, 512); }
    g.globalCompositeOperation = 'multiply';
    for (const [p, wdt, col] of bands) { g.fillStyle = rgb(col[0] + 90, col[1] + 90, col[2] + 90); g.fillRect(0, p, 512, wdt); }
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    gb.fillStyle = '#404040'; gb.fillRect(0, 0, 512, 512);
    for (let y = 0; y < 512; y += 8) for (let x = 0; x < 512; x += 8) {
      // knit "V" stitch
      for (const s of [-1, 1]) {
        const gr = gb.createLinearGradient(x + 4, y, x + 4 + s * 4, y + 8);
        gb.fillStyle = '#c0c0c0';
        gb.beginPath(); gb.ellipse(x + 4 + s * 1.8, y + 4, 1.8, 4, s * 0.5, 0, 7); gb.fill();
      }
      g.fillStyle = 'rgba(0,0,0,0.16)'; g.fillRect(x + 3.5, y, 1, 8);
      g.fillStyle = 'rgba(255,255,255,0.07)'; g.fillRect(x, y + 1, 3, 4);
    }
    grain(g, 512, 512, 18, 91);
    T.blanket = tex(c); T.blanketN = normalMap(cb, 2.5, 0.5);
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
    const [cb, gb] = canvas(256, 256); gb.fillStyle = '#808080'; gb.fillRect(0, 0, 256, 256); grain(gb, 256, 256, 90, 103);
    T.crinkleN = normalMap(cb, 1.2, 0.6);
  }
  {
    const [c, g] = canvas(256, 256);
    g.fillStyle = rgb(196, 188, 170); g.fillRect(0, 0, 256, 256);
    g.globalCompositeOperation = 'multiply';
    blob(g, 256, 256, 4, 111, v => { const k = 222 + 33 * v; return [k, k, k * 0.96, 255]; });
    g.globalCompositeOperation = 'source-over';
    const rnd = U.mulberry32(113);
    for (let i = 0; i < 25; i++) { g.fillStyle = `rgba(60,50,40,${0.05 + rnd() * 0.1})`; g.beginPath(); g.ellipse(rnd() * 256, rnd() * 256, 3 + rnd() * 6, 2 + rnd() * 4, rnd() * 3, 0, 7); g.fill(); }   // grubby finger marks
    grain(g, 256, 256, 8, 112);
    T.beige = tex(c);
  }
  {
    const [c, g] = canvas(256, 256);
    g.fillStyle = rgb(104, 114, 104); g.fillRect(0, 0, 256, 256);
    g.globalCompositeOperation = 'multiply';
    blob(g, 256, 256, 5, 121, v => { const k = 215 + 40 * v; return [k, k, k, 255]; });
    g.globalCompositeOperation = 'source-over';
    const rnd = U.mulberry32(122);
    for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(200,200,190,${0.1 + rnd() * 0.2})`; g.fillRect(rnd() * 256, rnd() * 256, 1 + rnd() * 8, 1); }  // scratches to primer
    for (let i = 0; i < 6; i++) { g.fillStyle = `rgba(120,70,40,${0.2 + rnd() * 0.2})`; g.beginPath(); g.arc(rnd() * 256, rnd() * 256, 1 + rnd() * 2.5, 0, 7); g.fill(); }  // rust spots
    grain(g, 256, 256, 8, 123);
    T.enamel = tex(c);
  }

  // -------------------------------------------------------------------------
  // paper atlas: 4 x 4 cells of 512 px, printed and handwritten, readable-looking
  // (cells indexed [col, row] from the top-left; see interior.js cellUV)
  // -------------------------------------------------------------------------
  {
    const S = 512, [c, g] = canvas(S * 4, S * 4);
    const rnd = U.mulberry32(131);
    const cell = (i, j, fn) => { g.save(); g.translate(i * S, j * S); g.beginPath(); g.rect(0, 0, S, S); g.clip(); fn(); g.restore(); };
    const paperBase = (r, gg, b) => { g.fillStyle = rgb(r, gg, b); g.fillRect(0, 0, S, S); g.globalCompositeOperation = 'multiply'; blob(g, S, S, 4, 131 + Math.floor(rnd() * 99), v => { const k = 235 + 20 * v; return [k, k, k * 0.98, 255]; }); g.globalCompositeOperation = 'source-over'; };
    const ink = 'rgba(25,25,30,0.9)', inkL = 'rgba(40,40,45,0.7)';
    // (0,0) observing log, typed table
    cell(0, 0, () => {
      paperBase(240, 238, 228);
      print(g, ['KESTREL RIDGE RADIO OBSERVATORY'], 36, 44, 20, `bold 17px ${SANS}`, ink);
      print(g, ['OBSERVING LOG  //  RX-3 L-BAND  //  NIGHT OF 22-23 SEP'], 36, 66, 16, `11px ${SANS}`, inkL);
      g.fillStyle = inkL; g.fillRect(36, 76, 440, 1.5);
      const rows = ['  UT    SOURCE       AZ     EL   TSYS  INT'];
      const srcs = ['CAL ND', 'J1745-29', 'J1745-29', 'W51', 'CAL ND', 'J1745-29', 'HI SURV', 'HI SURV', 'J1745-29', 'CAL ND', 'J1745-29', 'J1745-29', 'J1745-29'];
      srcs.forEach((s, k) => rows.push(` ${String(22 + Math.floor(k / 3)).slice(-2).replace('24', '00').replace('25', '01').replace('26', '02').replace('27', '03')}:${pad((k * 17) % 60, 2).replace(' ', '0')}  ${s.padEnd(10)} ${fx(141 + rnd() * 4, 1)}  ${fx(34 + rnd() * 4, 1)}  ${fx(34.5 + rnd(), 1)}  ${pad(60 * (1 + Math.floor(rnd() * 5)), 3)}`));
      print(g, rows, 36, 100, 17, `11.5px ${MONO}`, ink);
      g.strokeStyle = inkL; g.lineWidth = 1;
      for (let k = 0; k < 15; k++) { g.beginPath(); g.moveTo(36, 105 + k * 17); g.lineTo(476, 105 + k * 17); g.stroke(); }
      hand(g, rnd, 'LNA warm? recal at 01:30', 60, 380, 20, 'rgba(30,40,120,0.85)');
      hand(g, rnd, '- S.O.', 330, 410, 20, 'rgba(30,40,120,0.85)');
      g.strokeStyle = 'rgba(30,40,120,0.7)'; g.lineWidth = 2; g.beginPath(); g.ellipse(250, 223, 120, 14, -0.02, 0, 7); g.stroke();
    });
    // (1,0) printed spectrum plot
    cell(1, 0, () => {
      paperBase(238, 238, 232);
      print(g, ['FIG. 3  HI PROFILE, l = 30.0 deg, b = 0.0'], 40, 44, 16, `bold 13px ${SANS}`, ink);
      g.strokeStyle = ink; g.lineWidth = 1.2; g.strokeRect(60, 70, 400, 280);
      g.font = `10px ${SANS}`; g.fillStyle = ink;
      for (let k = 0; k <= 8; k++) { g.beginPath(); g.moveTo(60 + k * 50, 350); g.lineTo(60 + k * 50, 344); g.stroke(); g.fillText(String(-100 + k * 25), 52 + k * 50, 364); }
      for (let k = 0; k <= 5; k++) { g.beginPath(); g.moveTo(60, 350 - k * 56); g.lineTo(66, 350 - k * 56); g.stroke(); g.fillText(String(k * 20), 40, 354 - k * 56); }
      g.fillText('V_LSR (km/s)', 220, 385); g.save(); g.translate(22, 260); g.rotate(-Math.PI / 2); g.fillText('T_A (K)', 0, 0); g.restore();
      g.strokeStyle = 'rgba(20,40,150,0.95)'; g.lineWidth = 1.4; g.beginPath();
      for (let x = 0; x < 400; x++) g.lineTo(60 + x, 340 - 6 * rnd() - 190 * Math.exp(-Math.pow((x - 230) / 22, 2)) - 70 * Math.exp(-Math.pow((x - 290) / 35, 2)) - 40 * Math.exp(-Math.pow((x - 150) / 40, 2)));
      g.stroke();
      print(g, ['Tsys 34.8 K   t_int 600 s   dv 0.52 km/s', 'Baseline: 3rd order poly, rms 0.07 K'], 60, 410, 16, `10.5px ${MONO}`, inkL);
      hand(g, rnd, 'third component?!', 250, 120, 19, 'rgba(170,30,30,0.9)');
    });
    // (2,0) memo
    cell(2, 0, () => {
      paperBase(244, 242, 234);
      print(g, ['MEMORANDUM'], 40, 50, 20, `bold 20px ${SERIF}`, ink);
      print(g, ['TO:    All observing staff', 'FROM:  Site manager', 'RE:    Generator test, Sunday 06:00'], 40, 84, 18, `12px ${MONO}`, ink);
      g.fillStyle = ink; g.fillRect(40, 140, 430, 1.2);
      print(g, ['The backup generator will be tested on Sunday',
        'morning. Expect brief brown-outs. The receiver',
        'rack is on the UPS; the desk circuit is NOT.',
        'Save your work. Do not leave the kettle on.',
        '', 'Reminder: this is a radio-quiet site. Phones',
        'stay in the lockers. That includes you, Sam.'], 40, 170, 20, `12.5px ${SERIF}`, ink);
      hand(g, rnd, 'noted!!', 320, 360, 26, 'rgba(30,40,120,0.85)');
    });
    // (3,0) spectrum printout with a red circle
    cell(3, 0, () => {
      paperBase(236, 233, 222);
      print(g, ['RX-3 DUMP  2026-09-23  03:14:05 UT'], 30, 40, 16, `bold 12px ${MONO}`, ink);
      const hex = []; for (let k = 0; k < 22; k++) { let s = pad((k * 16).toString(16), 4).replace(/ /g, '0') + ' '; for (let q = 0; q < 8; q++) s += Math.floor(rnd() * 65536).toString(16).padStart(4, '0') + ' '; hex.push(s); }
      print(g, hex, 30, 66, 17, `10.5px ${MONO}`, inkL);
      g.strokeStyle = 'rgba(190,30,30,0.85)'; g.lineWidth = 2.5; g.beginPath(); g.ellipse(250, 210, 120, 22, -0.05, 0, 7); g.stroke();
      hand(g, rnd, '2 tones - not us', 300, 470, 22, 'rgba(190,30,30,0.9)');
    });
    // (0,1) yellow legal pad, handwritten
    cell(0, 1, () => {
      paperBase(246, 236, 150);
      g.strokeStyle = 'rgba(80,120,190,0.45)'; g.lineWidth = 1;
      for (let y = 60; y < S; y += 24) { g.beginPath(); g.moveTo(0, y); g.lineTo(S, y); g.stroke(); }
      g.strokeStyle = 'rgba(200,60,60,0.55)'; g.beginPath(); g.moveTo(68, 0); g.lineTo(68, S); g.moveTo(72, 0); g.lineTo(72, S); g.stroke();
      const L = ['to do:', '- recal noise diode', '- FFT 4096 -> 8192?', '- check LO drift (cold)', '- 1855 Hz spur = fridge??', '- email Maya the HI maps', '- BUY COFFEE', '', '1420.405 - 1418.905 = 1.5 MHz IF'];
      L.forEach((s, k) => hand(g, rnd, s, 82, 55 + k * 24, 19, 'rgba(30,40,110,0.85)'));
      g.strokeStyle = 'rgba(30,40,110,0.7)'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(84, 150); g.lineTo(250, 148); g.stroke();
    });
    // (1,1) graph paper with a hand plot
    cell(1, 1, () => {
      paperBase(236, 240, 232);
      g.strokeStyle = 'rgba(80,150,140,0.35)'; g.lineWidth = 1;
      for (let k = 0; k < S; k += 16) { g.beginPath(); g.moveTo(k, 0); g.lineTo(k, S); g.moveTo(0, k); g.lineTo(S, k); g.stroke(); }
      g.strokeStyle = 'rgba(80,150,140,0.6)';
      for (let k = 0; k < S; k += 80) { g.beginPath(); g.moveTo(k, 0); g.lineTo(k, S); g.moveTo(0, k); g.lineTo(S, k); g.stroke(); }
      g.strokeStyle = 'rgba(30,30,30,0.85)'; g.lineWidth = 2; g.beginPath();
      for (let x = 0; x < 400; x++) g.lineTo(56 + x, 360 - 140 * Math.exp(-Math.pow((x - 240) / 36, 2)) + 8 * Math.sin(x * 0.25) * (rnd() * 0.3 + 0.7));
      g.stroke();
      hand(g, rnd, 'drift scan  Cyg A', 60, 60, 22, 'rgba(20,20,20,0.85)');
      hand(g, rnd, 'HPBW ~ 0.6 deg', 280, 420, 19, 'rgba(20,20,20,0.85)');
    });
    // (2,1) index card
    cell(2, 1, () => {
      paperBase(244, 242, 236);
      g.strokeStyle = 'rgba(200,80,80,0.5)'; g.beginPath(); g.moveTo(0, 80); g.lineTo(S, 80); g.stroke();
      g.strokeStyle = 'rgba(100,140,200,0.35)';
      for (let y = 112; y < S; y += 32) { g.beginPath(); g.moveTo(0, y); g.lineTo(S, y); g.stroke(); }
      hand(g, rnd, 'Arecibo message', 30, 64, 28, 'rgba(20,20,20,0.9)');
      ['1974-11-16', '1679 bits = 23 x 73', 'aimed at M13 (25,000 ly)', 'nobody expected an answer', ''].forEach((s, k) => hand(g, rnd, s, 30, 104 + k * 32, 21, 'rgba(20,20,70,0.85)'));
    });
    // (3,1) photo print of the dish, white border
    cell(3, 1, () => {
      g.fillStyle = rgb(236, 234, 228); g.fillRect(0, 0, S, S);
      const gr = g.createLinearGradient(0, 28, 0, 400); gr.addColorStop(0, '#6d8fb5'); gr.addColorStop(1, '#e0c8a0');
      g.fillStyle = gr; g.fillRect(28, 28, S - 56, 380);
      g.fillStyle = '#4a5a3a'; g.fillRect(28, 340, S - 56, 68);
      g.fillStyle = '#e8e8ea'; g.save(); g.translate(256, 184); g.rotate(-0.5); g.beginPath(); g.ellipse(0, 0, 124, 48, 0, 0, Math.PI * 2); g.fill(); g.restore();
      g.fillStyle = '#aab'; g.fillRect(240, 220, 32, 124);
      g.fillStyle = '#334'; g.fillRect(360, 320, 30, 22); g.fillRect(370, 300, 10, 20);
      hand(g, rnd, 'first light, 1968', 60, 462, 26, 'rgba(20,20,20,0.75)');
    });
    // (0,2..3,2) sticky notes
    const notes = [['CHECK LO', 'before 04:00'], ['Tsys?', 'ask Maya'], ['back @ 6', 'S.'], ['DO NOT', 'TOUCH', 'RACK 2']];
    [[255, 234, 110], [255, 170, 190], [170, 236, 150], [150, 210, 250]].forEach((col, i) => cell(i, 2, () => {
      paperBase(...col);
      const gr = g.createLinearGradient(0, 0, 0, 80); gr.addColorStop(0, 'rgba(0,0,0,0.12)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(0, 0, S, 80);
      g.save(); g.translate(256, 256); g.rotate((rnd() - 0.5) * 0.15); g.translate(-256, -256);
      notes[i].forEach((s, k) => hand(g, rnd, s, 60, 170 + k * 110, 84 - notes[i].length * 6, 'rgba(20,20,40,0.9)'));
      g.restore();
    }));
    // (0,3) star chart sheet
    cell(0, 3, () => {
      g.fillStyle = rgb(18, 26, 58); g.fillRect(0, 0, S, S);
      g.strokeStyle = 'rgba(140,170,255,0.25)'; g.lineWidth = 1;
      for (let k = 1; k < 6; k++) { g.beginPath(); g.arc(256, 256, k * 48, 0, Math.PI * 2); g.stroke(); }
      for (let a = 0; a < 12; a++) { g.beginPath(); g.moveTo(256, 256); g.lineTo(256 + Math.cos(a * 0.5236) * 248, 256 + Math.sin(a * 0.5236) * 248); g.stroke(); }
      for (let i = 0; i < 500; i++) { const r = Math.pow(rnd(), 3) * 3.4 + 0.5; g.fillStyle = 'rgba(255,255,240,0.9)'; g.beginPath(); g.arc(rnd() * S, rnd() * S, r, 0, 7); g.fill(); }
      g.strokeStyle = 'rgba(255,220,120,0.6)'; g.lineWidth = 1.3;
      g.beginPath(); let x = 120, y = 140; g.moveTo(x, y); for (let k = 0; k < 6; k++) { x += 40 + rnd() * 40; y += (rnd() - 0.3) * 60; g.lineTo(x, y); } g.stroke();
      g.font = `italic 13px ${SERIF}`; g.fillStyle = 'rgba(220,230,255,0.85)';
      ['α Cyg', 'β', 'γ', 'DENEB', 'VEGA', 'M13'].forEach((s, k) => g.fillText(s, 60 + rnd() * 380, 60 + rnd() * 400));
    });
    // (1,3) HI plot on thermal paper
    cell(1, 3, () => {
      paperBase(240, 238, 230);
      g.strokeStyle = 'rgba(0,0,0,0.6)'; g.lineWidth = 1; g.strokeRect(60, 60, 400, 360);
      g.strokeStyle = 'rgba(20,60,160,0.85)'; g.lineWidth = 1.4; g.beginPath();
      for (let x = 0; x < 400; x++) g.lineTo(60 + x, 380 - 24 * rnd() - 260 * Math.exp(-Math.pow((x - 200) / 28, 2)) - 60 * Math.exp(-Math.pow((x - 260) / 60, 2)));
      g.stroke();
      print(g, ['CH  FREQ(MHz)    T(K)', '---  ----------  -----', '512  1420.4058   9.84', '513  1420.4097  11.02'], 70, 450, 15, `10.5px ${MONO}`, inkL);
    });
    // (2,3) calendar page
    cell(2, 3, () => {
      paperBase(246, 244, 238);
      g.fillStyle = rgb(170, 40, 40); g.fillRect(0, 0, S, 88);
      g.fillStyle = 'rgba(255,255,255,0.95)'; g.font = `bold 34px ${SANS}`; g.textAlign = 'center'; g.fillText('SEPTEMBER', 256, 58); g.textAlign = 'left';
      g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 1;
      for (let i = 0; i <= 7; i++) { g.beginPath(); g.moveTo(16 + i * 68, 112); g.lineTo(16 + i * 68, 496); g.stroke(); }
      for (let j = 0; j <= 5; j++) { g.beginPath(); g.moveTo(16, 112 + j * 76.8); g.lineTo(492, 112 + j * 76.8); g.stroke(); }
      g.font = `bold 11px ${SANS}`; g.fillStyle = 'rgba(0,0,0,0.6)';
      ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'].forEach((d, i) => g.fillText(d, 22 + i * 68, 106));
      g.font = `bold 20px ${SANS}`; g.fillStyle = 'rgba(0,0,0,0.75)';
      for (let d = 1; d <= 30; d++) { const k = d + 0; g.fillText(String(d), 22 + (k % 7) * 68, 136 + Math.floor(k / 7) * 76.8); }
      g.strokeStyle = 'rgba(200,30,30,0.85)'; g.lineWidth = 3; g.beginPath(); g.arc(22 + (23 % 7) * 68 + 12, 130 + Math.floor(23 / 7) * 76.8, 20, 0, 7); g.stroke();
      hand(g, rnd, 'night shift', 20 + (22 % 7) * 68, 170 + Math.floor(22 / 7) * 76.8, 13, 'rgba(30,40,120,0.85)');
      hand(g, rnd, 'gen test', 20 + (27 % 7) * 68, 170 + Math.floor(27 / 7) * 76.8, 13, 'rgba(30,40,120,0.85)');
    });
    // (3,3) manila folder
    cell(3, 3, () => {
      paperBase(214, 186, 128);
      g.fillStyle = 'rgba(0,0,0,0.08)'; g.fillRect(0, 0, S, 40);
      g.fillStyle = 'rgba(255,255,255,0.85)'; g.fillRect(300, 8, 180, 28);
      hand(g, rnd, 'RFI 2025-26', 310, 30, 20, 'rgba(0,0,0,0.85)');
      const gr = g.createRadialGradient(150, 300, 10, 150, 300, 60); gr.addColorStop(0.8, 'rgba(90,50,20,0)'); gr.addColorStop(0.9, 'rgba(90,50,20,0.35)'); gr.addColorStop(1, 'rgba(90,50,20,0)');
      g.fillStyle = gr; g.fillRect(80, 230, 140, 140);       // coffee ring
    });
    T.paper = tex(c);
  }
  // continuous-feed "greenbar" printout (512 x 1024 = one long sheet), dot-matrix text
  {
    const [c, g] = canvas(1024, 2048);
    const rnd = U.mulberry32(141);
    g.fillStyle = rgb(240, 242, 232); g.fillRect(0, 0, 1024, 2048);
    for (let y = 0; y < 2048; y += 96) { g.fillStyle = 'rgba(150,205,160,0.55)'; g.fillRect(68, y, 888, 48); }
    g.fillStyle = 'rgba(0,0,0,0.14)';
    for (let y = 16; y < 2048; y += 42) { g.beginPath(); g.arc(32, y, 9, 0, 7); g.arc(992, y, 9, 0, 7); g.fill(); }
    g.strokeStyle = 'rgba(0,0,0,0.15)'; g.setLineDash([5, 5]);
    g.beginPath(); g.moveTo(62, 0); g.lineTo(62, 2048); g.moveTo(962, 0); g.lineTo(962, 2048); g.stroke();
    g.beginPath(); g.moveTo(0, 1024); g.lineTo(1024, 1024); g.stroke(); g.setLineDash([]);
    const lines = [];
    for (let k = 0; k < 120; k++) {
      const t = 3 * 3600 + 13 * 60 + k * 0.5;
      const hh = Math.floor(t / 3600), mm = Math.floor(t / 60) % 60, ss = (t % 60).toFixed(1).padStart(4, '0');
      const on = k > 50 && k % 2 ? (k % 4 === 1 ? '1420' : '1000') : '----';
      lines.push(`${hh.toString().padStart(2, '0')}:${String(mm).padStart(2, '0')}:${ss}  CH2 ${fx(0.3 + rnd() * 0.6 + (on !== '----' ? 22 : 0), 2).padStart(6)} dB  TONE ${on}  FLAG ${on !== '----' ? '*' : '.'}`);
    }
    g.save(); g.scale(1, 1.25);
    print(g, lines, 84, 26, 13.3, `bold 12.5px ${MONO}`, 'rgba(30,30,60,0.62)');
    g.restore();
    T.greenbar = tex(c);
  }
  // cork board with pinned star charts, photos, index cards (pins are 3D in the scene)
  {
    const [c, g] = canvas(1024, 640);
    const [cb, gb] = canvas(512, 320);
    const rnd = U.mulberry32(151);
    g.fillStyle = rgb(170, 122, 78); g.fillRect(0, 0, 1024, 640);
    gb.fillStyle = '#808080'; gb.fillRect(0, 0, 512, 320);
    for (let i = 0; i < 30000; i++) {
      const k = rnd();
      g.fillStyle = k < 0.5 ? `rgba(90,56,30,${0.3 + rnd() * 0.4})` : `rgba(215,170,115,${0.2 + rnd() * 0.4})`;
      const x = rnd() * 1024, y = rnd() * 640, s = 1 + rnd() * 2.5;
      g.fillRect(x, y, s, s);
      if (i % 3 === 0) { gb.fillStyle = k < 0.5 ? '#505050' : '#b0b0b0'; gb.fillRect(x / 2, y / 2, s / 2 + 0.5, s / 2 + 0.5); }
    }
    // old pin holes
    for (let i = 0; i < 90; i++) { g.fillStyle = 'rgba(40,20,8,0.8)'; g.beginPath(); g.arc(rnd() * 1024, rnd() * 640, 1.3, 0, 7); g.fill(); }
    g.strokeStyle = rgb(120, 86, 52); g.lineWidth = 26; g.strokeRect(0, 0, 1024, 640);
    g.strokeStyle = 'rgba(0,0,0,0.3)'; g.lineWidth = 2; g.strokeRect(13, 13, 998, 614);
    const pins = [];
    const sheet = (x, y, w, h, rot, draw, pinCol = '#d22') => {
      g.save(); g.translate(x, y); g.rotate(rot);
      g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(-w / 2 + 6, -h / 2 + 8, w, h);
      g.beginPath(); g.rect(-w / 2, -h / 2, w, h); g.save(); g.clip(); g.translate(-w / 2, -h / 2); draw(w, h); g.restore();
      // curled corner shadow
      g.fillStyle = 'rgba(0,0,0,0.15)'; g.beginPath(); g.moveTo(w / 2, h / 2); g.lineTo(w / 2 - 22, h / 2); g.lineTo(w / 2, h / 2 - 22); g.fill();
      g.restore();
      const px = x + Math.sin(-rot) * (-h / 2 + 12), py = y + Math.cos(rot) * (-h / 2 + 12);
      pins.push([px / 1024, py / 640, pinCol]);
    };
    const starChart = (w, h) => {
      g.fillStyle = rgb(16, 24, 56); g.fillRect(0, 0, w, h);
      g.strokeStyle = 'rgba(140,170,255,0.3)'; g.lineWidth = 1;
      for (let k = 1; k < 8; k++) { g.beginPath(); g.ellipse(w / 2, h * 1.3, k * w * 0.16, k * h * 0.2, 0, Math.PI, 2 * Math.PI); g.stroke(); }
      for (let a = -4; a <= 4; a++) { g.beginPath(); g.moveTo(w / 2, h * 1.3); g.lineTo(w / 2 + a * w * 0.16, -10); g.stroke(); }
      g.save(); g.translate(w * 0.5, h * 0.5); g.rotate(-0.6);
      const mg = g.createLinearGradient(0, -h * 0.2, 0, h * 0.2); mg.addColorStop(0, 'rgba(180,190,255,0)'); mg.addColorStop(0.5, 'rgba(180,190,255,0.25)'); mg.addColorStop(1, 'rgba(180,190,255,0)');
      g.fillStyle = mg; g.fillRect(-w, -h * 0.2, 2 * w, h * 0.4); g.restore();
      for (let i = 0; i < w * h / 160; i++) { const r = Math.pow(rnd(), 4) * 3 + 0.5; g.fillStyle = `rgba(255,255,235,${0.6 + rnd() * 0.4})`; g.beginPath(); g.arc(rnd() * w, rnd() * h, r, 0, 7); g.fill(); }
      g.strokeStyle = 'rgba(255,210,120,0.6)'; g.lineWidth = 1.2;
      for (let q = 0; q < 3; q++) { g.beginPath(); let x = rnd() * w, y = rnd() * h; g.moveTo(x, y); for (let k = 0; k < 5; k++) { x += (rnd() - 0.4) * 60; y += (rnd() - 0.5) * 50; g.lineTo(x, y); } g.stroke(); }
      g.font = `italic 11px ${SERIF}`; g.fillStyle = 'rgba(220,230,255,0.85)';
      ['CYGNUS', 'LYRA', 'AQUILA', 'HERCULES', 'α', 'β', 'M13', 'M57'].forEach(s => g.fillText(s, 10 + rnd() * (w - 60), 20 + rnd() * (h - 30)));
      g.fillStyle = 'rgba(220,230,255,0.8)'; g.font = `bold 11px ${SANS}`; g.fillText('SUMMER TRIANGLE  //  EPOCH J2000', 8, h - 10);
    };
    sheet(210, 250, 330, 360, -0.04, starChart);
    sheet(560, 190, 260, 250, 0.05, starChart, '#2a6');
    sheet(820, 180, 220, 200, -0.06, (w, h) => {
      g.fillStyle = '#eee'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#05060a'; g.fillRect(10, 10, w - 20, h - 36);
      g.save(); g.translate(w / 2, h / 2 - 12); g.rotate(0.5); g.scale(1, 0.45);
      const gg = g.createRadialGradient(0, 0, 0, 0, 0, 70); gg.addColorStop(0, 'rgba(255,240,210,1)'); gg.addColorStop(0.2, 'rgba(230,200,170,0.7)'); gg.addColorStop(1, 'rgba(90,110,200,0)');
      g.fillStyle = gg; g.beginPath(); g.arc(0, 0, 70, 0, 7); g.fill(); g.restore();
      for (let i = 0; i < 40; i++) { g.fillStyle = 'rgba(255,255,255,0.8)'; g.fillRect(12 + rnd() * (w - 24), 12 + rnd() * (h - 40), 1.5, 1.5); }
      g.fillStyle = 'rgba(20,20,20,0.8)'; g.font = `italic 12px ${SANS}`; g.fillText('M31, 2019 (Sam)', 14, h - 10);
    }, '#26c');
    sheet(820, 440, 190, 150, 0.08, (w, h) => { g.fillStyle = rgb(250, 248, 240); g.fillRect(0, 0, w, h); g.fillStyle = 'rgba(200,60,60,0.6)'; g.fillRect(0, 22, w, 2); ['phone ext 214', 'site mgr 0417 ...', 'generator: Sun 6am'].forEach((s, k) => hand(g, rnd, s, 10, 50 + k * 30, 16, 'rgba(20,20,60,0.85)')); }, '#dd2');
    sheet(560, 470, 250, 190, -0.03, (w, h) => {
      g.fillStyle = rgb(238, 238, 232); g.fillRect(0, 0, w, h);
      g.strokeStyle = 'rgba(0,0,0,0.6)'; g.strokeRect(20, 30, w - 40, h - 60);
      g.strokeStyle = 'rgba(20,40,140,0.9)'; g.lineWidth = 1.3; g.beginPath();
      for (let x = 0; x < w - 40; x++) g.lineTo(20 + x, h - 34 - 8 * rnd() - 90 * Math.exp(-Math.pow((x - (w - 40) * 0.55) / 10, 2)));
      g.stroke();
      print(g, ['HI 21cm  -  GAL. PLANE'], 20, 20, 10, `bold 11px ${SANS}`, 'rgba(0,0,0,0.75)');
    }, '#d22');
    sheet(120, 520, 150, 110, 0.1, (w, h) => { g.fillStyle = rgb(255, 234, 110); g.fillRect(0, 0, w, h); hand(g, rnd, 'CAL every', 12, 45, 22, 'rgba(20,20,40,0.85)'); hand(g, rnd, '2 hrs!', 12, 80, 22, 'rgba(20,20,40,0.85)'); }, '#22d');
    sheet(360, 560, 130, 100, -0.12, (w, h) => { g.fillStyle = rgb(170, 236, 150); g.fillRect(0, 0, w, h); hand(g, rnd, 'wow?', 20, 60, 30, 'rgba(20,20,40,0.85)'); }, '#d22');
    T.cork = tex(c); T.corkN = normalMap(cb, 2.0, 0.3); T.corkPins = pins;
  }
  // books: 48 spines (42 x 512 px) + pages strip; titles in vertical text
  {
    const [c, g] = canvas(2048, 512);
    const rnd = U.mulberry32(161);
    const cols = [[120, 30, 30], [30, 50, 90], [40, 70, 50], [200, 170, 90], [60, 40, 30], [150, 120, 80], [30, 30, 32], [170, 70, 30], [90, 100, 110], [210, 200, 180], [80, 30, 60], [40, 90, 100], [230, 225, 210], [20, 60, 120]];
    const titles = ['RADIO ASTRONOMY', 'TOOLS OF RADIO ASTRONOMY', 'GALACTIC STRUCTURE', 'INTERFEROMETRY', 'SIGNAL PROCESSING', 'THE MILKY WAY', 'ANTENNA THEORY', 'SPECTROSCOPY', 'INTERSTELLAR MEDIUM', 'MICROWAVE ENGINEERING', 'PULSAR HANDBOOK', 'ASTROPHYSICAL JOURNAL 1998', 'ASTROPHYSICAL JOURNAL 1999', 'NUMERICAL METHODS', 'FOURIER ANALYSIS', 'LOW NOISE AMPLIFIERS', 'THE HYDROGEN LINE', 'STAR ATLAS 2000', 'CONTACT', 'COSMOS', 'RECEIVER MANUAL RX-3', 'DRIVE SYSTEM MAINT.', 'SETI: 50 YEARS', 'PROBABILITY', 'STATISTICS FOR ASTRONOMERS', 'RADIATIVE PROCESSES', 'OPTICS', 'CELESTIAL MECHANICS', 'OBSERVING LOG 2019', 'OBSERVING LOG 2020', 'OBSERVING LOG 2021', 'OBSERVING LOG 2022', 'THE FIRST THREE MINUTES', 'PHYSICAL CONSTANTS', 'BIRDS OF THE RIDGE', 'COOKING FOR ONE', 'MAPS & CHARTS', 'ELECTRONICS', 'THE ART OF WAITING', 'NIGHT SKY', 'VACUUM TUBES', 'DIGITAL FILTERS', 'WAVELETS', 'QUASARS', 'MASERS', 'THE SUN', 'RADIO NOISE', 'SPACE-TIME'];
    for (let i = 0; i < 48; i++) {
      const col = cols[Math.floor(rnd() * cols.length)], k = 0.75 + rnd() * 0.4;
      const x = i * 42;
      g.fillStyle = rgb(col[0] * k, col[1] * k, col[2] * k); g.fillRect(x, 0, 42, 512);
      const light = (col[0] + col[1] + col[2]) * k > 450;
      const fg = light ? 'rgba(30,30,30,0.9)' : (rnd() < 0.5 ? 'rgba(230,200,120,0.95)' : 'rgba(240,240,230,0.9)');
      g.fillStyle = fg;
      const style = Math.floor(rnd() * 3);
      if (style === 0) { g.fillRect(x + 4, 30, 34, 3); g.fillRect(x + 4, 470, 34, 3); g.fillRect(x + 4, 36, 34, 1.5); }
      if (style === 1) { g.fillStyle = light ? 'rgba(120,30,30,0.9)' : 'rgba(240,235,220,0.9)'; g.fillRect(x, 60, 42, 70); g.fillStyle = fg; }
      g.save(); g.translate(x + 26, 440); g.rotate(-Math.PI / 2);
      g.font = `${rnd() < 0.5 ? 'bold ' : ''}${rnd() < 0.3 ? 'italic ' : ''}${14 + Math.floor(rnd() * 5)}px ${rnd() < 0.5 ? SERIF : SANS}`;
      const t = titles[i % titles.length];
      const tw = g.measureText(t).width;
      g.scale(Math.min(1, 300 / tw), 1);
      g.fillText(t, 0, 0);
      g.restore();
      g.save(); g.translate(x + 26, 500); g.rotate(-Math.PI / 2); g.font = `9px ${SANS}`; g.fillText(['KR PRESS', 'OUP', 'SPRINGER', 'DOVER', 'WILEY'][i % 5].slice(0, 6), 0, 0); g.restore();
      const gr = g.createLinearGradient(x, 0, x + 42, 0);
      gr.addColorStop(0, 'rgba(0,0,0,0.45)'); gr.addColorStop(0.25, 'rgba(255,255,255,0.08)'); gr.addColorStop(0.7, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,0.4)');
      g.fillStyle = gr; g.fillRect(x, 0, 42, 512);
      // wear at the head and tail
      g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(x, 0, 42, 6); g.fillRect(x, 506, 42, 6);
    }
    g.fillStyle = rgb(176, 164, 138); g.fillRect(2016, 0, 32, 512);
    g.fillStyle = 'rgba(0,0,0,0.12)'; for (let y = 0; y < 512; y += 2) g.fillRect(2016, y, 32, 1);
    grain(g, 2048, 512, 10, 162);
    T.books = tex(c);
    T.bookCount = 48; T.bookU = 42 / 2048; T.pagesU0 = 2016 / 2048;
  }
  // wall clock face
  {
    const [c, g] = canvas(512, 512);
    g.fillStyle = rgb(236, 232, 218); g.beginPath(); g.arc(256, 256, 256, 0, 7); g.fill();
    g.fillStyle = 'rgba(0,0,0,0.08)'; g.beginPath(); g.arc(256, 256, 256, 0, 7); g.arc(256, 256, 236, 0, 7, true); g.fill();
    g.fillStyle = '#1a1a1a';
    for (let i = 0; i < 60; i++) {
      const a = i / 60 * Math.PI * 2, big = i % 5 === 0;
      g.save(); g.translate(256, 256); g.rotate(a); g.fillRect(-(big ? 5 : 1.5), -228, big ? 10 : 3, big ? 34 : 14); g.restore();
    }
    g.font = `bold 54px ${SANS}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (let h = 1; h <= 12; h++) { const a = h / 12 * Math.PI * 2; g.fillText(String(h), 256 + Math.sin(a) * 160, 256 - Math.cos(a) * 160); }
    g.font = `18px ${SANS}`; g.fillStyle = '#444'; g.fillText('QUARTZ', 256, 340);
    g.font = `italic 14px ${SERIF}`; g.fillText('Kestrel Ridge', 256, 180);
    T.clock = tex(c);
  }
  // keyboard keycaps with legends (0.46 x 0.165 m -> 1024 x 368)
  {
    const [c, g] = canvas(1024, 368);
    g.fillStyle = rgb(150, 142, 126); g.fillRect(0, 0, 1024, 368);
    const rnd = U.mulberry32(171);
    const u = 52;
    const key = (x, y, w, h, dark, label) => {
      g.fillStyle = 'rgba(0,0,0,0.55)'; g.fillRect(x, y, w, h);
      g.fillStyle = dark ? rgb(150, 144, 130) : rgb(214, 208, 192); g.fillRect(x + 2, y + 1, w - 4, h - 5);
      g.fillStyle = 'rgba(255,255,255,0.22)'; g.fillRect(x + 6, y + 4, w - 12, h - 14);
      // shine worn on the most used keys
      if ('ASDFJKL '.includes(label) || label === 'SPACE') { g.fillStyle = 'rgba(255,250,235,0.25)'; g.fillRect(x + 8, y + 6, w - 16, h - 18); }
      g.fillStyle = 'rgba(30,30,30,0.85)'; g.font = `bold ${label.length > 2 ? 11 : 15}px ${SANS}`; g.textBaseline = 'top';
      g.fillText(label, x + 8, y + 7);
    };
    const fk = ['ESC', 'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11'];
    for (let i = 0; i < 12; i++) key(20 + i * (u + 4) + (i > 0 ? 14 : 0) + (i > 4 ? 14 : 0) + (i > 8 ? 14 : 0), 16, u, 40, true, fk[i]);
    const rows = [[0, '`1234567890-='.split('').concat(['BS'])], [0.5, ['TAB'].concat('QWERTYUIOP[]'.split(''))], [0.75, ['CAPS'].concat('ASDFGHJKL;\''.split(''))], [1.25, ['SHIFT'].concat('ZXCVBNM,./'.split(''))]];
    rows.forEach(([off, labels], r) => labels.forEach((l, i) => key(20 + (off + i) * (u + 4) - (i > 0 && off > 0 ? 0 : 0), 76 + r * 58, u, 54, l.length > 1, l)));
    key(20 + 3.5 * (u + 4), 76 + 4 * 58, 6 * u, 50, false, 'SPACE');
    const pad2 = ['7', '8', '9', '4', '5', '6', '1', '2', '3', '0', '.', 'ENT'];
    for (let i = 0; i < 12; i++) key(840 + (i % 3) * (u + 4), 76 + Math.floor(i / 3) * 58, u, 54, true, pad2[i]);
    // crumbs and grime between the keys
    for (let i = 0; i < 80; i++) { g.fillStyle = `rgba(60,40,20,${0.3 + rnd() * 0.4})`; g.fillRect(rnd() * 1024, rnd() * 368, 1.5 + rnd() * 2, 1.5 + rnd() * 2); }
    T.keyboard = tex(c);
  }
  // window-glass dirt (alpha) and monitor-glass fingerprints/dust (grey)
  {
    const [c, g] = canvas(256, 256);
    g.fillStyle = '#000'; g.fillRect(0, 0, 256, 256);
    blob(g, 256, 256, 9, 181, v => { const k = Math.max(0, v - 0.45) * 255 * 1.4; return [k, k, k, 255]; });
    const rnd = U.mulberry32(182);
    for (let i = 0; i < 30; i++) { g.strokeStyle = `rgba(255,255,255,${0.05 + rnd() * 0.12})`; g.lineWidth = 1 + rnd() * 3; g.beginPath(); const x = rnd() * 256; g.moveTo(x, rnd() * 80); g.lineTo(x + (rnd() - 0.5) * 20, 150 + rnd() * 100); g.stroke(); }
    T.glassDirt = tex(c, { srgb: false });
  }
  {
    const [c, g] = canvas(800, 450);
    g.fillStyle = '#000'; g.fillRect(0, 0, 800, 450);
    const rnd = U.mulberry32(191);
    const print1 = (x, y, s, rot) => {
      g.save(); g.translate(x, y); g.rotate(rot); g.scale(1, 1.35);
      const ph = rnd() * 6;
      for (let r = 2; r < 17 * s; r += 2.3) {
        g.strokeStyle = `rgba(255,255,255,${0.05 + 0.04 * rnd()})`; g.lineWidth = 1.0;
        g.beginPath();
        for (let a = 0; a <= 6.3; a += 0.12) {
          const rr = r * (1 + 0.08 * Math.sin(a * 3 + ph + r * 0.3) + 0.05 * Math.sin(a * 7 - r));
          if (U.vnoise3(a * 2, r * 0.3, ph) < 0.3) { g.stroke(); g.beginPath(); continue; }
          g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr * (0.8 + 0.2 * Math.cos(a)));
        }
        g.stroke();
      }
      // smeared: the print is partly wiped
      g.globalCompositeOperation = 'destination-out'; g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(-20 * s, rnd() * 10 * s - 5 * s, 40 * s, 8 * s); g.globalCompositeOperation = 'source-over';
      g.restore();
    };
    print1(420, 300, 1.2, 0.4);
    // a wipe streak and dust
    g.strokeStyle = 'rgba(255,255,255,0.06)'; g.lineWidth = 40; g.beginPath(); g.moveTo(80, 380); g.quadraticCurveTo(400, 250, 760, 330); g.stroke();
    for (let i = 0; i < 1500; i++) { g.fillStyle = `rgba(255,255,255,${0.1 + rnd() * 0.35})`; g.fillRect(rnd() * 800, rnd() * 450, 1 + rnd() * 1.5, 1 + rnd() * 1.5); }
    const gr = g.createLinearGradient(0, 0, 0, 450); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(1, 'rgba(255,255,255,0.08)');
    g.fillStyle = gr; g.fillRect(0, 0, 800, 450);
    T.smudge = tex(c, { srgb: false });
  }
  // posters and signs
  {
    const [c, g] = canvas(512, 720);
    const gr = g.createLinearGradient(0, 0, 0, 720); gr.addColorStop(0, '#0b1733'); gr.addColorStop(0.7, '#2d3e66'); gr.addColorStop(1, '#c78a52');
    g.fillStyle = gr; g.fillRect(0, 0, 512, 720);
    const rnd = U.mulberry32(191);
    for (let i = 0; i < 300; i++) { g.fillStyle = `rgba(255,255,240,${rnd() * 0.9})`; g.fillRect(rnd() * 512, rnd() * 460, 1.5, 1.5); }
    g.fillStyle = '#10131a';
    g.beginPath(); g.moveTo(0, 620); g.quadraticCurveTo(200, 560, 512, 600); g.lineTo(512, 720); g.lineTo(0, 720); g.fill();
    g.save(); g.translate(300, 470); g.rotate(-0.55); g.beginPath(); g.ellipse(0, 0, 120, 42, 0, 0, Math.PI * 2); g.fill(); g.restore();
    g.fillRect(292, 480, 20, 110); g.fillRect(250, 580, 110, 20);
    g.fillStyle = '#f2ead8'; g.font = `bold 44px ${SANS}`; g.textAlign = 'center';
    g.fillText('KESTREL RIDGE', 256, 70);
    g.font = `24px ${SANS}`; g.fillText('RADIO OBSERVATORY', 256, 106);
    g.font = `16px ${SANS}`; g.fillStyle = 'rgba(242,234,216,0.7)'; g.fillText('LISTENING SINCE 1968', 256, 690);
    // sun-faded, a torn corner
    g.fillStyle = 'rgba(255,245,220,0.12)'; g.fillRect(0, 0, 512, 720);
    g.fillStyle = 'rgba(0,0,0,1)'; g.beginPath(); g.moveTo(512, 0); g.lineTo(470, 0); g.lineTo(512, 36); g.fill();
    T.poster = tex(c);
  }
  {
    // "the northern sky": planisphere poster on cream paper
    const [c, g] = canvas(768, 768);
    const rnd = U.mulberry32(195);
    g.fillStyle = rgb(232, 222, 196); g.fillRect(0, 0, 768, 768);
    g.globalCompositeOperation = 'multiply';
    blob(g, 768, 768, 5, 196, v => { const k = 220 + 35 * v; return [k, k * 0.98, k * 0.93, 255]; });
    g.globalCompositeOperation = 'source-over';
    const cx = 384, cy = 400, R = 300;
    g.fillStyle = rgb(26, 36, 70); g.beginPath(); g.arc(cx, cy, R, 0, 7); g.fill();
    g.strokeStyle = 'rgba(200,210,240,0.35)'; g.lineWidth = 1;
    for (let k = 1; k <= 5; k++) { g.beginPath(); g.arc(cx, cy, R * k / 6, 0, 7); g.stroke(); }
    for (let a = 0; a < 24; a++) { g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a * Math.PI / 12) * R, cy + Math.sin(a * Math.PI / 12) * R); g.stroke(); }
    // Milky Way band
    g.save(); g.beginPath(); g.arc(cx, cy, R, 0, 7); g.clip();
    g.translate(cx, cy); g.rotate(0.7);
    for (let i = 0; i < 400; i++) { const x = (rnd() - 0.5) * 2 * R, y = U.gauss(rnd) * 40; g.fillStyle = `rgba(210,215,240,${0.05 + rnd() * 0.08})`; g.beginPath(); g.arc(x, y, 6 + rnd() * 20, 0, 7); g.fill(); }
    g.restore();
    for (let i = 0; i < 700; i++) {
      const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * R, m = Math.pow(rnd(), 4);
      g.fillStyle = 'rgba(255,252,235,0.95)'; g.beginPath(); g.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 0.7 + m * 3.5, 0, 7); g.fill();
    }
    g.strokeStyle = 'rgba(255,215,130,0.75)'; g.lineWidth = 1.5;
    for (let q = 0; q < 9; q++) { const a0 = rnd() * 6.28, r0 = 40 + rnd() * 220; let x = cx + Math.cos(a0) * r0, y = cy + Math.sin(a0) * r0; g.beginPath(); g.moveTo(x, y); for (let k = 0; k < 4 + Math.floor(rnd() * 3); k++) { x += (rnd() - 0.5) * 70; y += (rnd() - 0.5) * 70; g.lineTo(x, y); g.fillStyle = 'rgba(255,250,230,1)'; g.fillRect(x - 2, y - 2, 4, 4); } g.stroke(); }
    g.font = `italic 15px ${SERIF}`; g.fillStyle = 'rgba(230,225,200,0.9)';
    ['URSA MAJOR', 'CASSIOPEIA', 'CYGNUS', 'LYRA', 'DRACO', 'CEPHEUS', 'PERSEUS', 'BO\u00d6TES', 'HERCULES', 'AURIGA'].forEach(s => { const a = rnd() * 6.28, r = 50 + rnd() * 220; g.fillText(s, cx + Math.cos(a) * r - 30, cy + Math.sin(a) * r); });
    g.strokeStyle = rgb(60, 50, 40); g.lineWidth = 3; g.beginPath(); g.arc(cx, cy, R + 4, 0, 7); g.stroke();
    g.font = `12px ${SANS}`; g.fillStyle = rgb(60, 50, 40); g.textAlign = 'center';
    for (let h = 0; h < 24; h++) { const a = h / 24 * Math.PI * 2 - Math.PI / 2; g.fillText(`${h}h`, cx + Math.cos(a) * (R + 20), cy + Math.sin(a) * (R + 20) + 4); }
    g.font = `bold 34px ${SERIF}`; g.fillText('THE NORTHERN SKY', cx, 60);
    g.font = `italic 15px ${SERIF}`; g.fillText('stars to magnitude 5  \u00b7  epoch J2000  \u00b7  equatorial projection', cx, 740);
    // tape at the corners, a curl of age
    g.fillStyle = 'rgba(240,230,190,0.6)'; for (const [x, y, r] of [[30, 20, 0.6], [738, 20, -0.6], [30, 748, -0.6], [738, 748, 0.6]]) { g.save(); g.translate(x, y); g.rotate(r); g.fillRect(-30, -10, 60, 20); g.restore(); }
    T.poster2 = tex(c);
  }
  {
    const [c, g] = canvas(256, 320);
    g.fillStyle = '#f0ece0'; g.fillRect(0, 0, 256, 320);
    g.fillStyle = '#c21d1d'; g.fillRect(0, 0, 256, 70);
    g.fillStyle = '#fff'; g.font = `bold 34px ${SANS}`; g.textAlign = 'center'; g.fillText('CAUTION', 128, 48);
    g.fillStyle = '#1a1a1a'; g.font = `bold 22px ${SANS}`;
    ['RADIO QUIET', 'ZONE', '', 'NO PHONES', 'NO WIFI', 'NO MICROWAVE'].forEach((s, i) => g.fillText(s, 128, 112 + i * 32));
    g.strokeStyle = '#1a1a1a'; g.lineWidth = 4; g.strokeRect(8, 78, 240, 234);
    T.sign = tex(c);
  }
  {
    // door sign
    const [c, g] = canvas(256, 128);
    g.fillStyle = '#1d4f8a'; g.fillRect(0, 0, 256, 128);
    g.strokeStyle = '#fff'; g.lineWidth = 4; g.strokeRect(6, 6, 244, 116);
    g.fillStyle = '#fff'; g.font = `bold 24px ${SANS}`; g.textAlign = 'center';
    g.fillText('SHIELDED ROOM', 128, 52); g.font = `bold 17px ${SANS}`; g.fillText('KEEP DOOR CLOSED', 128, 88);
    T.doorSign = tex(c);
  }
  {
    // whiteboard
    const [c, g] = canvas(1024, 640);
    g.fillStyle = '#eceeea'; g.fillRect(0, 0, 1024, 640);
    blob(g, 1024, 640, 6, 201, v => [150, 160, 170, v * 50]);
    const rnd = U.mulberry32(202);
    g.lineCap = 'round';
    const ink = ['rgba(30,50,140,0.85)', 'rgba(20,20,20,0.8)', 'rgba(170,30,30,0.8)', 'rgba(30,110,60,0.8)'];
    hand(g, rnd, 'HI  1420.405 MHz', 60, 90, 40, ink[0]); hand(g, rnd, 'λ = 21.1 cm', 60, 150, 40, ink[0]);
    hand(g, rnd, 'Tsys ~ 35 K', 620, 90, 38, ink[2]);
    hand(g, rnd, 'v = c (f0 - f) / f0', 60, 230, 30, ink[1]); hand(g, rnd, 'S/N = (Tsrc / Tsys) √(Δν τ)', 60, 290, 30, ink[1]);
    g.strokeStyle = ink[3]; g.lineWidth = 3; g.beginPath();
    for (let x = 0; x < 360; x++) g.lineTo(600 + x, 420 - 120 * Math.exp(-Math.pow((x - 180) / 40, 2)) - 20 * Math.sin(x * 0.05) - 4 * rnd());
    g.stroke();
    g.beginPath(); g.moveTo(600, 440); g.lineTo(970, 440); g.moveTo(600, 440); g.lineTo(600, 260); g.stroke();
    hand(g, rnd, 'ROTA:', 60, 380, 28, ink[1]);
    ['MON  Maya', 'TUE  Sam', 'WED  Sam', 'THU  Maya + Sam (!)'].forEach((s, k) => hand(g, rnd, s, 80, 420 + k * 42, 26, ink[k % 2]));
    g.strokeStyle = 'rgba(40,40,40,0.13)'; g.lineWidth = 34;
    g.beginPath(); g.moveTo(500, 560); g.quadraticCurveTo(700, 500, 960, 580); g.stroke();
    T.whiteboard = tex(c);
  }
  // rack front panels (0.55 x 1.74 m -> 512 x 1536): units, Dymo labels, vents
  {
    const [c, g] = canvas(512, 1536);
    const rnd = U.mulberry32(211);
    g.fillStyle = '#15171a'; g.fillRect(0, 0, 512, 1536);
    const units = [];
    const unit = (y, h, col, fn) => {
      g.fillStyle = col; g.fillRect(30, y, 452, h - 4);
      g.globalAlpha = 0.25; grainRect(30, y, 452, h - 4); g.globalAlpha = 1;
      g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(30, y, 452, 2);
      g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(30, y + h - 6, 452, 2);
      g.fillStyle = '#2a2c30'; g.fillRect(0, y, 30, h - 4); g.fillRect(482, y, 30, h - 4);
      g.fillStyle = '#8a8c90'; for (const x of [15, 497]) { g.beginPath(); g.arc(x, y + 12, 4, 0, 7); g.arc(x, y + h - 16, 4, 0, 7); g.fill(); }
      units.push([y, h]);
      fn(y, h);
    };
    function grainRect(x, y, w, h) { for (let i = 0; i < w * h / 40; i++) { g.fillStyle = rnd() < 0.5 ? '#000' : '#888'; g.fillRect(x + rnd() * w, y + rnd() * h, 1, 1); } }
    const label = (x, y, s, col = 'rgba(230,230,220,0.9)', size = 14) => { g.fillStyle = col; g.font = `bold ${size}px ${SANS}`; g.fillText(s, x, y); };
    const dymo = (x, y, s) => { g.font = `bold 11px ${MONO}`; const w = g.measureText(s).width + 10; g.fillStyle = '#111'; g.fillRect(x, y - 11, w, 15); g.fillStyle = 'rgba(245,245,245,0.95)'; g.fillText(s, x + 5, y); };
    const vents = (x, y, w, h) => { g.fillStyle = 'rgba(0,0,0,0.7)'; for (let k = 0; k < w; k += 10) g.fillRect(x + k, y, 5, h); };
    let y = 20;
    unit(y, 90, '#2b2e33', (y0) => { vents(60, y0 + 20, 250, 50); label(340, y0 + 40, 'PWR DIST'); label(340, y0 + 64, '230V 16A', 'rgba(200,200,190,0.7)', 12); }); y += 90;
    unit(y, 180, '#3a3f45', (y0) => {
      g.fillStyle = '#050807'; g.fillRect(60, y0 + 20, 200, 140);
      label(300, y0 + 30, 'OSCILLOSCOPE', 'rgba(220,220,210,0.8)', 12);
      ['VOLTS/DIV', 'TIME/DIV', 'TRIG'].forEach((s, i) => label(292 + i * 60, y0 + 90, s.slice(0, 7), 'rgba(220,220,210,0.7)', 8));
      label(300, y0 + 165, 'CH1   CH2   EXT', 'rgba(220,220,210,0.7)', 10);
    }); y += 180;
    unit(y, 120, '#1f2226', (y0) => { g.fillStyle = '#100404'; g.fillRect(60, y0 + 30, 260, 60); label(340, y0 + 50, 'FREQ CTR'); label(340, y0 + 74, 'LO 1418.905', 'rgba(200,200,190,0.7)', 12); dymo(340, y0 + 104, 'REF 10MHz EXT'); }); y += 120;
    unit(y, 150, '#43484f', (y0) => { label(60, y0 + 30, 'IF / BACKEND  RX-3'); vents(60, y0 + 90, 180, 40); dymo(60, y0 + 62, 'CH1 1000  CH2 1420'); ['GAIN', 'ATTN', 'BW', 'OFFS'].forEach((s, i) => label(290 + i * 45, y0 + 140, s, 'rgba(220,220,210,0.7)', 9)); }); y += 150;
    unit(y, 90, '#26292d', (y0) => { label(60, y0 + 34, 'PATCH'); g.fillStyle = '#0a0a0a'; for (let i = 0; i < 16; i++) { g.beginPath(); g.arc(150 + i * 20, y0 + 30, 6, 0, 7); g.arc(150 + i * 20, y0 + 60, 6, 0, 7); g.fill(); } for (let i = 0; i < 16; i++) label(145 + i * 20, y0 + 82, String(i + 1), 'rgba(220,220,210,0.6)', 7); }); y += 90;
    unit(y, 210, '#30343a', (y0) => {
      label(60, y0 + 30, 'DIGITAL BACKEND  FFT 4096');
      for (let i = 0; i < 4; i++) { g.fillStyle = '#1a1c20'; g.fillRect(60 + i * 105, y0 + 60, 95, 120); g.fillStyle = 'rgba(255,255,255,0.1)'; g.fillRect(64 + i * 105, y0 + 64, 87, 6); vents(70 + i * 105, y0 + 90, 70, 60); dymo(66 + i * 105, y0 + 196, `DISK ${i}`); }
    }); y += 210;
    unit(y, 150, '#2b2e33', (y0) => { label(60, y0 + 30, 'TIME / GPS  H-MASER REF'); g.fillStyle = '#0b1008'; g.fillRect(60, y0 + 50, 280, 50); g.fillStyle = 'rgba(120,255,140,0.9)'; g.font = `bold 26px ${MONO}`; g.fillText('03:14 UTC', 78, y0 + 85); dymo(60, y0 + 128, 'DO NOT POWER OFF'); }); y += 150;
    unit(y, 250, '#383c42', (y0) => {
      label(60, y0 + 30, 'DATA RECORDER');
      for (const x of [140, 360]) { g.fillStyle = '#0c0c0c'; g.beginPath(); g.arc(x, y0 + 140, 80, 0, 7); g.fill(); g.fillStyle = '#6a6a6a'; g.beginPath(); g.arc(x, y0 + 140, 30, 0, 7); g.fill(); g.fillStyle = '#0c0c0c'; g.beginPath(); g.arc(x, y0 + 140, 10, 0, 7); g.fill(); }
      dymo(200, y0 + 238, 'TAPE 0923-A');
    }); y += 250;
    unit(y, 250, '#1d2024', (y0) => { vents(60, y0 + 30, 390, 180); label(60, y0 + 235, 'UPS 3000', 'rgba(220,220,210,0.8)', 12); }); y += 250;
    // a stuck-on warning sticker
    g.save(); g.translate(400, 1440); g.rotate(-0.08); g.fillStyle = '#e8c21a'; g.fillRect(-50, -18, 100, 36); g.fillStyle = '#111'; g.font = `bold 11px ${SANS}`; g.textAlign = 'center'; g.fillText('HIGH VOLTAGE', 0, 4); g.restore();
    T.rack = tex(c);
    T.rackLayout = { oscope: [60, 20 + 90 + 20, 200, 140], counter: [60, 20 + 90 + 180 + 30, 260, 60], units };
  }
  // receiver front panel (0.42 x 0.2 m -> 512 x 244) and dial
  {
    const [c, g] = canvas(512, 244);
    const rnd = U.mulberry32(221);
    g.fillStyle = rgb(92, 98, 100); g.fillRect(0, 0, 512, 244);
    for (let i = 0; i < 9000; i++) { g.fillStyle = `rgba(${rnd() < 0.5 ? '0,0,0' : '255,255,255'},${rnd() * 0.08})`; g.fillRect(rnd() * 512, rnd() * 244, 2, 2); }
    g.fillStyle = '#1b1208'; g.fillRect(40, 30, 300, 80);
    g.fillStyle = '#120d06'; g.fillRect(370, 30, 110, 80);
    g.fillStyle = 'rgba(240,240,230,0.9)'; g.font = `bold 12px ${SANS}`;
    ['BAND', 'RF GAIN', 'AF GAIN', 'BFO', 'SELECT', 'AGC'].forEach((s, i) => g.fillText(s, 40 + i * 80 - (s.length * 3), 222));
    g.font = `bold 15px ${SANS}`; g.fillText('RX-60  COMMUNICATIONS RECEIVER', 40, 20);
    g.font = `10px ${SANS}`; g.fillText('S-METER', 400, 124); g.fillText('PHONES', 440, 150);
    // screw heads
    for (const [x, y] of [[12, 12], [500, 12], [12, 232], [500, 232]]) { g.fillStyle = '#bbb'; g.beginPath(); g.arc(x, y, 5, 0, 7); g.fill(); g.fillStyle = '#555'; g.fillRect(x - 4, y - 0.8, 8, 1.6); }
    T.receiver = tex(c);
    const [c2, g2] = canvas(512, 136);
    const gr = g2.createLinearGradient(0, 0, 0, 136); gr.addColorStop(0, '#f2c070'); gr.addColorStop(1, '#d08a3a');
    g2.fillStyle = gr; g2.fillRect(0, 0, 512, 136);
    g2.fillStyle = 'rgba(40,20,5,0.9)'; g2.font = `bold 13px ${SANS}`; g2.textAlign = 'center';
    for (let r = 0; r < 3; r++) {
      const y = 30 + r * 40;
      for (let i = 0; i <= 50; i++) g2.fillRect(12 + i * 9.7, y, 1.2, i % 5 ? 6 : 12);
      for (let i = 0; i <= 10; i++) g2.fillText(String(([2, 5, 14][r] + i * [0.3, 1, 2][r]).toFixed(r ? 0 : 1)), 12 + i * 48.5, y + 28);
    }
    g2.fillStyle = 'rgba(200,30,20,0.9)'; g2.fillRect(250, 4, 2.5, 128);      // the pointer
    T.dial = tex(c2);
  }
  // fridge door (magnets, notes, a photo)
  {
    const [c, g] = canvas(512, 512);
    g.fillStyle = '#e6e4dc'; g.fillRect(0, 0, 512, 512);
    g.globalCompositeOperation = 'multiply';
    blob(g, 512, 512, 4, 231, v => { const k = 228 + 27 * v; return [k, k, k * 0.97, 255]; });
    g.globalCompositeOperation = 'source-over';
    const rnd = U.mulberry32(232);
    const note = (x, y, w, h, col, r, lines) => { g.save(); g.translate(x, y); g.rotate(r); g.fillStyle = 'rgba(0,0,0,0.2)'; g.fillRect(3, 4, w, h); g.fillStyle = col; g.fillRect(0, 0, w, h); lines.forEach((s, k) => hand(g, rnd, s, 8, 28 + k * 22, 16, 'rgba(20,20,40,0.85)')); g.restore(); };
    note(60, 80, 150, 190, '#f7f3e8', -0.05, ['MILK', 'coffee (!!)', 'bread', 'batteries AA', 'fuse 13A']);
    note(260, 60, 120, 90, '#ffe970', 0.08, ['label your', 'food. -M']);
    note(250, 220, 180, 130, '#cfe8ff', -0.03, ['pizza place', 'closes 22:00', 'tel 5550 173']);
    const mag = (x, y, col) => { g.fillStyle = col; g.beginPath(); g.arc(x, y, 12, 0, 7); g.fill(); g.fillStyle = 'rgba(255,255,255,0.35)'; g.beginPath(); g.arc(x - 3, y - 4, 4, 0, 7); g.fill(); };
    mag(135, 84, '#d33'); mag(320, 64, '#36c'); mag(340, 224, '#3a3');
    g.fillStyle = '#b4b0a6'; g.fillRect(470, 150, 16, 200);
    T.fridge = tex(c);
  }
  // mug atlas: 4 mugs; each strip: outside print + drips (v 0..0.75), inside stain rings (v 0.75..1)
  {
    const [c, g] = canvas(1024, 512);
    const bases = ['#e9e4d8', '#2d4f7a', '#b8452f', '#3b3b3b'];
    const rnd = U.mulberry32(241);
    for (let i = 0; i < 4; i++) {
      const x = (i % 2) * 512, y = Math.floor(i / 2) * 256;
      g.fillStyle = bases[i]; g.fillRect(x, y, 512, 256);
      g.fillStyle = i === 0 ? '#27466e' : '#f0ece2';
      g.font = `bold 30px ${SANS}`; g.textAlign = 'center';
      if (i === 0) g.fillText('I ♥ 21cm', x + 128, y + 110);
      if (i === 1) { g.beginPath(); g.arc(x + 128, y + 100, 26, Math.PI, 0); g.lineTo(x + 128, y + 100); g.fill(); g.fillRect(x + 125, y + 100, 6, 34); }
      if (i === 2) { g.font = `bold 22px ${SANS}`; g.fillText('WORLD\'S OKAYEST', x + 128, y + 90); g.fillText('ASTRONOMER', x + 128, y + 118); }
      // coffee drips from the rim (top of the outside band = v 0.75 -> y + 64)
      for (let d = 0; d < 3; d++) {
        const dx = x + 300 + d * 60 + rnd() * 30, len = 30 + rnd() * 60;
        const gr = g.createLinearGradient(0, y + 64, 0, y + 64 + len); gr.addColorStop(0, 'rgba(80,45,20,0.75)'); gr.addColorStop(1, 'rgba(80,45,20,0)');
        g.fillStyle = gr; g.fillRect(dx, y + 64, 5 + rnd() * 4, len);
      }
      // inside: glaze with brown rings (y .. y+64)
      g.fillStyle = '#ece8de'; g.fillRect(x, y, 512, 64);
      for (let k = 0; k < 5; k++) { g.fillStyle = `rgba(90,50,20,${0.15 + rnd() * 0.3})`; g.fillRect(x, y + 14 + k * 9 + rnd() * 4, 512, 2 + rnd() * 3); }
    }
    T.mugs = tex(c);
  }
  // steam wisps (tileable vertically) and the beacon's fresnel lens ribs
  {
    const [c, g] = canvas(128, 256);
    g.fillStyle = '#000'; g.fillRect(0, 0, 128, 256);
    g.globalCompositeOperation = 'lighter';
    blob(g, 128, 256, 6, 301, v => { const k = Math.max(0, v - 0.35) * 255; return [k, k, k, 255]; });
    blob(g, 128, 256, 12, 302, v => { const k = Math.max(0, v - 0.5) * 180; return [k, k, k, 255]; });
    g.globalCompositeOperation = 'source-over';
    const [c2, g2] = canvas(128, 256);
    g2.filter = 'blur(3px)'; g2.drawImage(c, 0, 0);
    T.steam = tex(c2, { srgb: false });
  }
  {
    const [c, g] = canvas(256, 64);
    for (let x = 0; x < 256; x++) { const v = 0.55 + 0.45 * Math.pow(0.5 + 0.5 * Math.cos(x / 256 * Math.PI * 2 * 24), 3); g.fillStyle = `rgb(${v * 255},${v * 255},${v * 255})`; g.fillRect(x, 0, 1, 64); }
    for (let y = 0; y < 64; y += 8) { g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(0, y, 256, 1.5); }
    T.fresnel = tex(c, { srgb: false });
  }
  {
    const [c, g] = canvas(256, 96);
    g.fillStyle = '#062a12'; g.fillRect(0, 0, 256, 96);
    g.fillStyle = '#7dff9a'; g.font = `bold 60px ${SANS}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('EXIT', 140, 50);
    g.beginPath(); g.moveTo(22, 48); g.lineTo(52, 26); g.lineTo(52, 40); g.lineTo(70, 40); g.lineTo(70, 56); g.lineTo(52, 56); g.lineTo(52, 70); g.fill();
    T.exit = tex(c);
  }
  return T;
}
