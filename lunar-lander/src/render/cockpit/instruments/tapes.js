// LM moving-tape meters: ALT / ALT RATE (landing radar or PGNS) and RANGE / RANGE RATE
// (rendezvous radar). Each window shows a black tape on a drum (curved mesh) with white ticks
// and numbers, read against a fixed orange index; scales are piecewise linear (fine near zero,
// compressed at large values) like the real tapes. An OFF flag drops into the window when the data
// source is invalid.
import { THREE, createCase, createCanvasTexture, drawText, limiter, finish, FT } from './common.js';
import { talkbackTexture } from '../kit/index.js';
import { registerIntegral } from '../kit/materials.js';
import { TAPES } from './math.js';

export { TAPES };

/** Curved tape (drum) mesh of visible width w, height h (arc length), drum radius R, front at z=0. */
function drumGeometry(w, h, R, ny = 24) {
  const arc = h / R;
  const pos = [];
  const nor = [];
  const uv = [];
  const idx = [];
  for (let j = 0; j <= ny; j++) {
    const a = (j / ny - 0.5) * arc;
    for (let i = 0; i <= 1; i++) {
      pos.push((i - 0.5) * w, R * Math.sin(a), R * Math.cos(a) - R);
      nor.push(0, Math.sin(a), Math.cos(a));
      uv.push(i, j / ny);
    }
  }
  for (let j = 0; j < ny; j++) {
    const a = j * 2;
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const col = [];
  for (let j = 0; j <= ny; j++) {
    const d = Math.abs(j / ny - 0.5);
    const k = 1 - 0.8 * Math.min(1, Math.max(0, (d - 0.24) / 0.26)) ** 1.5;
    col.push(k, k, k, k, k, k);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/**
 * One tape window: returns { mesh, set(value | NaN) } — value in the scale's units.
 */
function createTape(scale, w, h, o = {}) {
  // The canvas holds 2x the visible tape length; the window shows its middle half and small
  // motions are pure UV scrolling. The canvas is only redrawn (re-centred) after the tape has moved
  // 40 % of a window height, so a moving tape costs almost nothing.
  const hMm = h * 1000;
  const tex = createCanvasTexture(w, h * 2, 4600);
  const Wp = tex.canvas.width;
  const Hp = tex.canvas.height;
  const Hw = Hp / 2; // window height in px
  const pxPerMm = Hp / (2 * hMm);
  tex.texture.repeat.set(1, 0.5);
  tex.texture.offset.set(0, 0.25);
  const mat = new THREE.MeshStandardMaterial({ map: tex.texture, roughness: 0.55, metalness: 0, emissive: 0xffffff, emissiveMap: tex.texture, emissiveIntensity: 0.0, vertexColors: true });
  mat.userData.integralScale = 0.3;
  registerIntegral(mat);
  const mesh = new THREE.Mesh(drumGeometry(w, h * 1.1, o.radius ?? 0.085), mat);
  mesh.receiveShadow = true;
  let Tdrawn = Infinity;
  const g = tex.g;
  const draw = (Tc) => {
    Tdrawn = Tc;
    g.fillStyle = '#0d0e0f';
    g.fillRect(0, 0, Wp, Hp);
    const halfMm = hMm + 3;
    const tickX = Wp * 0.1;
    g.fillStyle = '#ecebe4';
    for (const [from, to, , minor, major, every, fmt] of scale.segs) {
      for (const sign of o.signed ? [1, -1] : [1]) {
        const i0 = Math.ceil(from / minor);
        const i1 = Math.floor(to / minor);
        for (let i = i0; i <= i1; i++) {
          const val = i * minor;
          if (sign < 0 && val === 0) continue;
          const sv = val * sign;
          const dT = scale.T(sv) - Tc;
          if (dT < -halfMm || dT > halfMm) continue;
          const y = Hp / 2 - dT * pxPerMm;
          const isMajor = Math.abs(val / major - Math.round(val / major)) < 1e-6;
          const isLabel = Math.abs(val / every - Math.round(val / every)) < 1e-6;
          const len = isMajor ? Wp * 0.26 : Wp * 0.14;
          const lw = isMajor ? Math.max(1.5, Hw * 0.006) : Math.max(1, Hw * 0.0035);
          g.fillRect(tickX - Wp * 0.1, y - lw / 2, len + Wp * 0.1, lw);
          if (isLabel) {
            const txt = (sign < 0 ? '-' : '') + fmt(Math.round(val * 1000) / 1000);
            drawText(g, txt, Wp * 0.94, y, Math.min(Hw * 0.06, Wp * 0.34), { align: 'right', color: '#ecebe4', condense: 0.8, caps: true, tracking: 0 });
          }
        }
      }
    }
    tex.texture.needsUpdate = true;
  };
  draw(0);
  return {
    mesh,
    set(v) {
      if (!Number.isFinite(v)) return;
      const T = scale.T(v);
      if (Math.abs(T - Tdrawn) > 0.4 * hMm) draw(T);
      tex.texture.offset.y = 0.25 + (T - Tdrawn) / (2 * hMm);
    },
  };
}

/** Barber-pole OFF flag that drops into a window when data is invalid. */
function offFlag(w, h) {
  const tex = talkbackTexture('barber');
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 64;
  const g = c.getContext('2d');
  g.drawImage(tex.image, 0, 0, 128, 64);
  g.fillStyle = '#111';
  g.fillRect(24, 18, 80, 28);
  drawText(g, 'OFF', 64, 32, 24, { color: '#f0f0ea' });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: t, roughness: 0.6 }));
  return m;
}

/**
 * Generic twin-tape instrument.
 * o: { width, height, tapes: [{label, units, scale, signed}], title, getValues(vessel) -> [a, b] (NaN = OFF) }
 */
function createTwinTapes(o) {
  const W = o.width;
  const H = o.height;
  const fr = 0.006;
  const winW = 0.033;
  const winH = 0.098;
  const xs = [-0.022, 0.022];
  const wy = -0.006;
  const { group } = createCase({
    width: W,
    height: H,
    frame: fr,
    holes: xs.map((x) => ({ x, y: wy, w: winW, h: winH, corner: 0.0015 })),
    faceSpec: {
      draw(P) {
        o.tapes.forEach((t, i) => {
          P.text(t.label, xs[i], wy + winH / 2 + 0.0075, 0.0052);
          P.text(t.units, xs[i], wy - winH / 2 - 0.0062, 0.0042);
          // index marks at the window sides
          for (const sx of [-1, 1]) {
            const x = xs[i] + sx * (winW / 2 + 0.0018);
            P.polyline([[x + sx * 0.0022, wy + 0.0022], [x, wy], [x + sx * 0.0022, wy - 0.0022]], 0.0008, '#ff9b1a', false, true);
          }
        });
        if (o.title) P.text(o.title, 0, H / 2 - fr - 0.004, 0.0034);
      },
    },
    depth: 0.05,
  });
  const tapes = o.tapes.map((t, i) => {
    const tp = createTape(t.scale, winW + 0.002, winH, { signed: t.signed });
    tp.mesh.position.set(xs[i], wy, -0.0045);
    group.add(tp.mesh);
    // fixed orange index hairline in front of the tape
    const idx = new THREE.Mesh(new THREE.PlaneGeometry(winW, 0.0009), new THREE.MeshStandardMaterial({ color: 0xff9b1a, emissive: 0xff9b1a, emissiveIntensity: 0.2, roughness: 0.5 }));
    idx.position.set(xs[i], wy, -0.0022);
    group.add(idx);
    const flag = offFlag(winW * 0.96, winH * 0.32);
    flag.position.set(xs[i], wy + winH * 0.62, -0.0028);
    flag.userData.hiddenY = wy + winH * 0.7;
    flag.userData.shownY = wy + winH * 0.2;
    group.add(flag);
    return { tp, flag, off: 0 };
  });
  const lim = limiter(30);
  function update(vessel, game, dt) {
    if (!vessel) return;
    const e = lim.tick(dt);
    if (!e) return;
    const vals = o.getValues(vessel, game);
    tapes.forEach((t, i) => {
      const v = vals[i];
      const valid = Number.isFinite(v);
      if (valid) t.tp.set(v);
      t.off += ((valid ? 0 : 1) - t.off) * Math.min(1, e * 6);
      t.flag.position.y = t.flag.userData.hiddenY + (t.flag.userData.shownY - t.flag.userData.hiddenY) * t.off;
      t.flag.visible = t.off > 0.02;
    });
  }
  return finish(group, W, H, update);
}

/**
 * LM altitude / altitude-rate tape meters (0.12 × 0.16 m).
 * ALT = tel.radarAltitude when the landing radar has lock, else tel.altitude (PGNS), in feet;
 * ALT RATE = tel.vSpeed in ft/s. opts: { source: 'auto'|'radar'|'pgns' }
 */
export function createAltTapes(opts = {}) {
  const source = opts.source || 'auto';
  return createTwinTapes({
    width: 0.12,
    height: 0.16,
    title: 'ALT / ALT RATE',
    tapes: [
      { label: 'ALT', units: 'FEET', scale: TAPES.alt },
      { label: 'ALT RATE', units: 'FT/SEC', scale: TAPES.rate, signed: true },
    ],
    getValues(v) {
      const t = v.tel;
      let alt;
      if (source === 'radar') alt = t.radarAltitude;
      else if (source === 'pgns') alt = t.altitude;
      else alt = Number.isFinite(t.radarAltitude) ? t.radarAltitude : t.altitude;
      if (v.landed) alt = 0;
      return [Number.isFinite(alt) ? Math.max(0, alt) / FT : NaN, Number.isFinite(alt) ? t.vSpeed / FT : NaN];
    },
  });
}

/**
 * LM range / range-rate tape meters (rendezvous radar), 0.12 × 0.16 m: RANGE in nautical miles,
 * RANGE RATE in ft/s (negative = closing), from tel.relTarget; OFF flags without a target.
 */
export function createRangeTapes(opts = {}) {
  void opts;
  return createTwinTapes({
    width: 0.12,
    height: 0.16,
    title: 'RANGE / RANGE RATE',
    tapes: [
      { label: 'RANGE', units: 'N MI', scale: TAPES.range },
      { label: 'RNG RATE', units: 'FT/SEC', scale: TAPES.rate, signed: true },
    ],
    getValues(v) {
      const r = v.tel.relTarget;
      if (!r || !Number.isFinite(r.range)) return [NaN, NaN];
      return [r.range / 1852, r.rangeRate / FT];
    },
  });
}
