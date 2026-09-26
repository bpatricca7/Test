// Procedural textures for the Command Module interior (CSM-CABIN agent). Canvas 2D only.
//
//   wallTexture()      painted inner-structure close-out panels: seams, rivet rows, Dzus fasteners,
//                      scuffs (tiles 1 m x 1 m)
//   betaTexture()      Beta-cloth weave with faint stitching (tiles 0.1 m)
//   strapTexture()     restraint-harness webbing (tiles 0.05 m along the strap)
//   pocketTexture()    window-pocket wall: grey paint at the cabin end -> dark heat-shield
//                      ablator/frame at the glass (v = 0 inner .. 1 outer)
//   createLockerAtlas()  stowage locker doors: 4 x 4 cells, each painted by paintLocker()
//   noiseTexture()     grey noise for roughness variation
import * as THREE from 'three';
import { drawText, rng, MONO_STACK } from '../kit/index.js';

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function tex(c, { srgb = true, repeat = true, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = aniso;
  return t;
}

/** Sprinkle fine paint grain / mottling onto a 2D context. */
function grain(g, w, h, seed, amount = 14, blobs = 40) {
  const r = rng(seed);
  const img = g.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (r() - 0.5) * amount;
    d[i] += n;
    d[i + 1] += n;
    d[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
  // large soft mottling (uneven paint / grime)
  for (let i = 0; i < blobs; i++) {
    const x = r() * w;
    const y = r() * h;
    const rad = (0.03 + r() * 0.12) * w;
    const gr = g.createRadialGradient(x, y, 0, x, y, rad);
    const dark = r() < 0.6;
    gr.addColorStop(0, dark ? 'rgba(40,38,34,0.06)' : 'rgba(255,255,250,0.05)');
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr;
    g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
}

let _wall = null;
/**
 * Inner close-out panels: medium-light grey paint (the CM crew compartment structure was painted a
 * light "Apollo grey"), seams every 0.5 m / 0.25 m, rivet rows, a few Dzus fasteners, scuffs.
 * Returns {map, rough} (rough: G channel = roughness, R = bump height).
 */
export function wallTexture() {
  if (_wall) return _wall;
  const N = 1024;
  const c = canvas(N, N);
  const g = c.getContext('2d');
  const a = canvas(N / 2, N / 2);
  const ga = a.getContext('2d');
  g.fillStyle = '#9a9c98';
  g.fillRect(0, 0, N, N);
  grain(g, N, N, 11, 10, 60);
  ga.fillStyle = 'rgb(128,190,0)';
  ga.fillRect(0, 0, N / 2, N / 2);
  const r = rng(31);
  // seams (px per metre = N)
  const seam = (x0, y0, x1, y1) => {
    g.strokeStyle = 'rgba(35,35,33,0.75)';
    g.lineWidth = 2.2;
    g.beginPath();
    g.moveTo(x0, y0);
    g.lineTo(x1, y1);
    g.stroke();
    g.strokeStyle = 'rgba(255,255,250,0.18)';
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(x0 + 1.5, y0 + 1.5);
    g.lineTo(x1 + 1.5, y1 + 1.5);
    g.stroke();
    ga.strokeStyle = 'rgb(70,210,0)';
    ga.lineWidth = 1.5;
    ga.beginPath();
    ga.moveTo(x0 / 2, y0 / 2);
    ga.lineTo(x1 / 2, y1 / 2);
    ga.stroke();
  };
  const rivet = (x, y) => {
    g.fillStyle = 'rgba(60,60,58,0.55)';
    g.beginPath();
    g.arc(x, y, 2.4, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = 'rgba(230,230,225,0.35)';
    g.beginPath();
    g.arc(x - 0.6, y - 0.6, 1.3, 0, Math.PI * 2);
    g.fill();
    ga.fillStyle = 'rgb(175,150,0)';
    ga.beginPath();
    ga.arc(x / 2, y / 2, 1.3, 0, Math.PI * 2);
    ga.fill();
  };
  for (const x of [0, N / 2]) seam(x + 1, 0, x + 1, N);
  for (const y of [0, N / 4, N / 2, (3 * N) / 4]) seam(0, y + 1, N, y + 1);
  for (const x of [0, N / 2]) for (let y = 12; y < N; y += 26) { rivet(x + 12, y); rivet(x + N / 2 - 10, y); }
  for (const y of [0, N / 2]) for (let x = 12; x < N; x += 26) rivet(x, y + 12);
  // Dzus fasteners on the half-height panels
  for (let k = 0; k < 10; k++) {
    const x = (Math.floor(r() * 4) + 0.5) * (N / 4);
    const y = (Math.floor(r() * 4) + 0.12) * (N / 4);
    g.fillStyle = '#6d6f6c';
    g.beginPath();
    g.arc(x, y, 7, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#2f302e';
    g.lineWidth = 1.6;
    g.beginPath();
    g.moveTo(x - 5, y - 1);
    g.lineTo(x + 5, y + 1);
    g.stroke();
  }
  // scuffs & handling marks
  for (let k = 0; k < 90; k++) {
    const x = r() * N;
    const y = r() * N;
    const l = 5 + r() * 40;
    const ang = r() * Math.PI;
    g.strokeStyle = r() < 0.7 ? `rgba(50,50,48,${0.05 + r() * 0.12})` : `rgba(255,255,255,${0.05 + r() * 0.1})`;
    g.lineWidth = 0.6 + r() * 1.6;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(ang) * l, y + Math.sin(ang) * l);
    g.stroke();
  }
  // Velcro pile patches (off-white, fuzzy): the crew stuck checklists, pencils, cameras and food
  // packs all over the cabin; the real walls are dotted with them
  for (let k = 0; k < 5; k++) {
    const w = 30 + r() * 60;
    const h = 18 + r() * 22;
    const x = 40 + r() * (N - 80 - w);
    const y = 40 + r() * (N - 80 - h);
    g.fillStyle = 'rgba(0,0,0,0.25)';
    g.fillRect(x + 1.5, y + 2, w, h);
    g.fillStyle = r() < 0.5 ? '#cdc7b5' : '#c2bdad';
    g.fillRect(x, y, w, h);
    for (let q = 0; q < w * h * 0.25; q++) {
      g.fillStyle = r() < 0.5 ? 'rgba(90,85,70,0.18)' : 'rgba(255,255,248,0.25)';
      g.fillRect(x + r() * w, y + r() * h, 1.2, 1.2);
    }
    ga.fillStyle = 'rgb(200,255,0)'; // raised (bump) and fully rough
    ga.fillRect(x / 2, y / 2, w / 2, h / 2);
  }
  // small stencilled part numbers
  g.globalAlpha = 0.55;
  for (let k = 0; k < 6; k++) drawText(g, `V36-${Math.floor(100 + r() * 800)}-${Math.floor(r() * 90)}`, 60 + r() * (N - 120), 40 + r() * (N - 80), 11, { color: '#303030', font: MONO_STACK, weight: 'normal' });
  g.globalAlpha = 1;
  _wall = { map: tex(c), rough: tex(a, { srgb: false }) };
  return _wall;
}

let _beta = null;
/** Beta-cloth weave (fibreglass cloth, off-white, soft sheen), 256 px tile = 0.1 m. */
export function betaTexture() {
  if (_beta) return _beta;
  const N = 256;
  const c = canvas(N, N);
  const g = c.getContext('2d');
  g.fillStyle = '#dcd8cb';
  g.fillRect(0, 0, N, N);
  const r = rng(5);
  // basket weave
  for (let y = 0; y < N; y += 4) {
    for (let x = 0; x < N; x += 4) {
      const odd = ((x + y) / 4) % 2;
      g.fillStyle = odd ? `rgba(255,255,250,${0.12 + r() * 0.08})` : `rgba(90,85,70,${0.07 + r() * 0.06})`;
      g.fillRect(x, y, odd ? 4 : 3, odd ? 3 : 4);
    }
  }
  grain(g, N, N, 6, 8, 8);
  _beta = tex(c);
  return _beta;
}

let _strap = null;
/**
 * Harness webbing: u ALONG the strap (0.05 m per tile, see couches.ribbon), v across it (0..1).
 * Fine twill ribs across the length, darker woven selvedges along both edges.
 */
export function strapTexture() {
  if (_strap) return _strap;
  const c = canvas(128, 64);
  const g = c.getContext('2d');
  g.fillStyle = '#cdc7b4';
  g.fillRect(0, 0, 128, 64);
  for (let x = 0; x < 128; x += 2) {
    g.fillStyle = `rgba(80,70,50,${x % 4 ? 0.07 : 0.13})`;
    g.fillRect(x, 0, 1, 64);
  }
  // selvedges
  g.fillStyle = 'rgba(70,60,45,0.28)';
  g.fillRect(0, 0, 128, 4);
  g.fillRect(0, 60, 128, 4);
  grain(g, 128, 64, 21, 10, 0);
  _strap = tex(c);
  return _strap;
}

let _pocket = null;
/** Window pocket wall gradient: v 0 (cabin end, grey) -> 1 (glass end, dark ablator frame). */
export function pocketTexture() {
  if (_pocket) return _pocket;
  const c = canvas(64, 256);
  const g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 256, 0, 0);
  gr.addColorStop(0, '#7e807d');
  gr.addColorStop(0.18, '#6f716e');
  gr.addColorStop(0.24, '#2c2c2b');
  gr.addColorStop(0.75, '#262422');
  gr.addColorStop(0.92, '#3a2c20');
  gr.addColorStop(1, '#1b1612');
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 256);
  grain(g, 64, 256, 9, 10, 4);
  _pocket = tex(c);
  _pocket.wrapT = THREE.ClampToEdgeWrapping;
  return _pocket;
}

let _noise = null;
/** Soft grey noise (roughness variation / grime), 256 px. */
export function noiseTexture() {
  if (_noise) return _noise;
  const c = canvas(256, 256);
  const g = c.getContext('2d');
  g.fillStyle = 'rgb(128,150,128)';
  g.fillRect(0, 0, 256, 256);
  grain(g, 256, 256, 3, 30, 30);
  _noise = tex(c, { srgb: false });
  return _noise;
}

// ------------------------------------------------------------------------------ locker atlas
/**
 * Stowage locker door atlas: `cols` x `rows` cells on a 2048 canvas. Each door is painted with its
 * stencilled locker number, contents placard, latch recesses, hinge line and wear.
 * Returns { texture, cell(i) -> {u0, v0, du, dv}, paint(i, spec), commit() }.
 */
export function createLockerAtlas(cols = 6, rows = 6) {
  const N = 2048;
  const c = canvas(N, N);
  const g = c.getContext('2d');
  g.fillStyle = '#8f928e';
  g.fillRect(0, 0, N, N);
  const cw = N / cols;
  const ch = N / rows;
  const texture = tex(c, { repeat: false });
  let used = 0;
  const api = {
    texture,
    cols,
    rows,
    /** Allocate the next free cell and paint it. spec: {label, content, aspect (w/h), color, seed, latches} */
    alloc(spec = {}) {
      const i = used++ % (cols * rows);
      api.paint(i, spec);
      return api.cell(i);
    },
    cell(i) {
      const cx = i % cols;
      const cy = Math.floor(i / cols);
      // small inset so mip-mapping does not bleed neighbours
      const inset = 4 / N;
      return { u0: cx / cols + inset, v0: 1 - (cy + 1) / rows + inset, du: 1 / cols - 2 * inset, dv: 1 / rows - 2 * inset };
    },
    paint(i, spec) {
      const x0 = (i % cols) * cw;
      const y0 = Math.floor(i / cols) * ch;
      const r = rng(spec.seed ?? i * 7 + 3);
      g.save();
      g.beginPath();
      g.rect(x0, y0, cw, ch);
      g.clip();
      g.fillStyle = spec.color || '#949791';
      g.fillRect(x0, y0, cw, ch);
      // paint mottling
      for (let k = 0; k < 18; k++) {
        const x = x0 + r() * cw;
        const y = y0 + r() * ch;
        const rad = 20 + r() * 90;
        const gr = g.createRadialGradient(x, y, 0, x, y, rad);
        gr.addColorStop(0, r() < 0.5 ? 'rgba(40,40,36,0.07)' : 'rgba(255,255,250,0.06)');
        gr.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = gr;
        g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
      }
      // door edge shadow & highlight
      g.strokeStyle = 'rgba(20,20,20,0.55)';
      g.lineWidth = 6;
      g.strokeRect(x0 + 3, y0 + 3, cw - 6, ch - 6);
      g.strokeStyle = 'rgba(255,255,255,0.18)';
      g.lineWidth = 2;
      g.strokeRect(x0 + 9, y0 + 9, cw - 18, ch - 18);
      // stencilled locker number (black, top-left) and white placard with the contents
      if (spec.label) drawText(g, spec.label, x0 + 22, y0 + 44, 34, { align: 'left', color: '#1c1c1c', condense: 0.8 });
      if (spec.content) {
        const lines = String(spec.content).split('\n');
        const pw = cw * 0.62;
        const ph = 16 + lines.length * 22;
        const px = x0 + cw / 2 - pw / 2;
        const py = y0 + ch * 0.36 - ph / 2;
        g.fillStyle = '#e8e4d6';
        g.fillRect(px, py, pw, ph);
        g.strokeStyle = 'rgba(0,0,0,0.35)';
        g.lineWidth = 1.5;
        g.strokeRect(px, py, pw, ph);
        lines.forEach((l, k) => drawText(g, l, px + pw / 2, py + 19 + k * 22, 17, { color: '#161616', font: MONO_STACK, weight: 'bold', condense: 0.9 }));
      }
      // velcro patches (white-beige felt) on some doors, for the checklists & food packs
      if (spec.velcro) {
        for (let k = 0; k < spec.velcro; k++) {
          const vx = x0 + 30 + r() * (cw - 110);
          const vy = y0 + ch * 0.55 + r() * (ch * 0.3);
          g.fillStyle = '#d9d3c1';
          g.fillRect(vx, vy, 50 + r() * 30, 22);
          g.fillStyle = 'rgba(0,0,0,0.12)';
          for (let q = 0; q < 30; q++) g.fillRect(vx + r() * 70, vy + r() * 22, 1.5, 1.5);
        }
      }
      // scuffs near the latches / edges
      for (let k = 0; k < 25; k++) {
        const x = x0 + r() * cw;
        const y = y0 + (r() < 0.5 ? r() * 0.2 : 0.8 + r() * 0.2) * ch;
        g.strokeStyle = `rgba(40,40,38,${0.08 + r() * 0.12})`;
        g.lineWidth = 1 + r() * 2;
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x + (r() - 0.5) * 40, y + (r() - 0.5) * 12);
        g.stroke();
      }
      g.restore();
      texture.needsUpdate = true;
    },
    commit() {
      texture.needsUpdate = true;
    },
  };
  return api;
}

/** Remap a geometry's 0..1 UVs into an atlas cell. */
export function remapUV(geom, cell) {
  const uv = geom.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, cell.u0 + Math.min(1, Math.max(0, uv.getX(i))) * cell.du, cell.v0 + Math.min(1, Math.max(0, uv.getY(i))) * cell.dv);
  }
  uv.needsUpdate = true;
  return geom;
}
