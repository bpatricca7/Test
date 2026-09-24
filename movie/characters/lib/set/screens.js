// The hut's screens, drawn from the timeline every frame:
//  - main monitor (1600 x 900 canvas, phosphor cyan-green instrument HUD, CRT shader)
//  - second monitor (amber telescope-control terminal)
//  - the rack's oscilloscope and frequency counter
// Every draw is a pure function of film time t.

export function makeScreens(env, T = {}) {
  const { THREE, TL, U, FONT } = env;
  const { clamp, lerp, smooth } = U;
  const B = TL.beats;
  const MONO = FONT || '"FreeMono", "Courier New", monospace';
  const PI = Math.PI;

  // ---------------------------------------------------------------- timeline
  const T_ALARM = B.alarm, PU = TL.pulses;
  const TIMES = PU.times, BITS = PU.bits, NP = TIMES.length;
  const T_P0 = B.pulses.start, T_P1 = B.pulses.end;
  const T_LAST = TIMES[NP - 1];
  const T_KEY = B.maya_reach_key ? B.maya_reach_key.end - 0.35 : B.fold.start - 0.6;
  const T_F0 = B.fold.start, T_F1 = B.fold.end;
  const T_Z0 = B.zoom_visitor.start, T_Z1 = B.zoom_visitor.end;
  const T_S0 = B.surge.start, T_S1 = B.surge.end;
  const T_M0 = B.materialize.start;
  const T_RET = B.lights_return;
  const T_MATCH = 56.9, T_DIFF = 62.4;
  const G = TL.grid, ROWS = G.rows, COLS = G.cols, RET = G.returned, SENT = G.sent, ROW_T = G.row_times, VB = G.visitor_box;
  const FREQ = [PU.freq_zero, PU.freq_one];

  const DUR = new Float64Array(NP);
  for (let i = 0; i < NP; i++) {
    const gap = i + 1 < NP ? TIMES[i + 1] - TIMES[i] : TIMES[i] - TIMES[i - 1];
    DUR[i] = Math.min(0.09, 0.6 * gap);
  }
  const lanes = [0, 1].map(b => {
    const idx = [];
    for (let i = 0; i < NP; i++) if (BITS[i] === b) idx.push(i);
    const n = idx.length, S = new Float64Array(n), E = new Float64Array(n), PRE = new Float64Array(n + 1);
    for (let j = 0; j < n; j++) { S[j] = TIMES[idx[j]]; E[j] = S[j] + DUR[idx[j]]; PRE[j + 1] = PRE[j] + DUR[idx[j]]; }
    return { S, E, PRE, n };
  });
  const countLE = (arr, n, x) => { let lo = 0, hi = n; while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] <= x) lo = m + 1; else hi = m; } return lo; };
  const onTime = (L, tau) => { const j = countLE(L.S, L.n, tau) - 1; if (j < 0) return 0; return L.PRE[j] + Math.min(L.E[j] - L.S[j], tau - L.S[j]); };
  const pulseAt = t => countLE(TIMES, NP, t) - 1;
  const RATE = t => (t < T_P0 || t > T_LAST + 0.002) ? 0 : PU.r0 * Math.exp(PU.k * (t - T_P0));
  // the carrier before the message: two tones alternating, on / off (period 1.6 s)
  const CAR = [[0.0, 0.5, 1], [0.8, 1.3, 0]];
  function carrierOn(lane, a, b) {       // on-time of lane in [a, b], clipped to [T_ALARM - 0.4, T_P0 - 0.3]
    const lo = Math.max(a, T_ALARM - 0.4), hi = Math.min(b, T_P0 - 0.3);
    if (hi <= lo) return 0;
    const [s0, s1] = CAR[lane === 1 ? 0 : 1];
    let sum = 0;
    for (let k = Math.floor(lo / 1.6) - 1; k <= Math.floor(hi / 1.6) + 1; k++) {
      const x0 = k * 1.6 + s0, x1 = k * 1.6 + s1;
      sum += Math.max(0, Math.min(hi, x1) - Math.max(lo, x0));
    }
    return sum;
  }
  const hashf = (i, k) => { const s = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453; return s - Math.floor(s); };
  const utc = t => {
    const s = 3 * 3600 + 14 * 60 + (t - 7);
    const hh = Math.floor(s / 3600), mm = Math.floor(s / 60) % 60, ss = s - Math.floor(s / 60) * 60;
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${ss.toFixed(1).padStart(4, '0')}`;
  };
  const utcS = t => utc(t).slice(0, 8);

  // --------------------------------------------------------------- canvases
  const MW = 1600, MH = 900;
  const mainC = document.createElement('canvas'); mainC.width = MW; mainC.height = MH;
  // level of detail: the full canvas (no mipmaps) when the screen is big on screen,
  // a half-size canvas (mipmapped) when it is small; a tiny copy feeds the phosphor glow
  const gBig = mainC.getContext('2d', { willReadFrequently: true });
  const mainCs = document.createElement('canvas'); mainCs.width = MW / 2; mainCs.height = MH / 2;
  const gSmall = mainCs.getContext('2d', { willReadFrequently: true });
  let g = gBig, curC = mainC;
  const scratch = document.createElement('canvas'); scratch.width = MW; scratch.height = MH;
  const sg = scratch.getContext('2d');
  const mainTex = new THREE.CanvasTexture(mainC);
  mainTex.colorSpace = THREE.SRGBColorSpace;
  mainTex.generateMipmaps = false; mainTex.minFilter = THREE.LinearFilter;
  const mainTexS = new THREE.CanvasTexture(mainCs);
  mainTexS.colorSpace = THREE.SRGBColorSpace;
  const glowC = document.createElement('canvas'); glowC.width = 200; glowC.height = 112;
  const glowG = glowC.getContext('2d', { willReadFrequently: true });
  glowG.imageSmoothingEnabled = true; glowG.imageSmoothingQuality = 'high';
  const glowTex = new THREE.CanvasTexture(glowC);
  glowTex.colorSpace = THREE.SRGBColorSpace; glowTex.generateMipmaps = false; glowTex.minFilter = THREE.LinearFilter;

  const SW = 640, SH = 480;
  const secC = document.createElement('canvas'); secC.width = SW; secC.height = SH;
  const g2 = secC.getContext('2d');
  const secTex = new THREE.CanvasTexture(secC);
  secTex.colorSpace = THREE.SRGBColorSpace;

  const scopeC = document.createElement('canvas'); scopeC.width = 256; scopeC.height = 180;
  const g3 = scopeC.getContext('2d');
  const scopeTex = new THREE.CanvasTexture(scopeC); scopeTex.colorSpace = THREE.SRGBColorSpace;
  const ctrC = document.createElement('canvas'); ctrC.width = 256; ctrC.height = 64;
  const g4 = ctrC.getContext('2d');
  const ctrTex = new THREE.CanvasTexture(ctrC); ctrTex.colorSpace = THREE.SRGBColorSpace;

  const PHr = [143, 247, 208];
  const ph = a => `rgba(143,247,208,${a})`;
  const hot = a => `rgba(225,255,245,${a})`;
  const ro = a => `rgba(255,118,56,${a})`;
  const AMB = a => `rgba(255,176,64,${a})`;

  // --------------------------------------------------------------- layout
  const WF = { x: 60, y: 292, w: 1030, h: 500 };      // waterfall
  const SP = { x: 60, y: 140, w: 1030, h: 136 };      // spectrum trace
  const RP = { x: 1122, y: 140, w: 418, h: 692 };     // right panel
  const F_MAX = 2400;
  const fx = f => WF.x + WF.w * f / F_MAX;
  const LANE_X = [fx(FREQ[0]), fx(FREQ[1])];
  const SPEED = 60;                                     // waterfall px per second

  // noise floor, tileable vertically: NC columns x NK rows (values), plus a canvas image
  const NC = 265, NK = 1024, CW = WF.w / NC;
  const NOISE = new Float32Array(NC * NK);
  const floorShape = new Float32Array(NC);
  {
    const rnd = U.mulberry32(1420);
    for (let c = 0; c < NC; c++) {
      const f = (c + 0.5) / NC * F_MAX;
      const band = 0.45 + 0.55 * smooth(120, 420, f) * (1 - smooth(2050, 2380, f));
      const hi = 0.35 * Math.exp(-Math.pow((f - 1210) / 260, 2));                    // HI hump
      const rfi = Math.exp(-Math.pow((f - 620) / 8, 2)) * 0.6 + Math.exp(-Math.pow((f - 1855) / 8, 2)) * 0.45 + Math.exp(-Math.pow((f - 2140) / 10, 2)) * 0.3;
      floorShape[c] = band * (0.55 + hi) + rfi;
    }
    for (let k = 0; k < NK; k++) {
      const a = k / NK * PI * 2, R = NK * 0.18 / (PI * 2);
      for (let c = 0; c < NC; c++) {
        const sm = U.vnoise3(c * 0.09, Math.cos(a) * R + 40, Math.sin(a) * R + 40);
        const fine = rnd();
        NOISE[k * NC + c] = (0.25 + 0.45 * sm * sm + 0.5 * fine * fine * fine) * floorShape[c];
      }
    }
  }
  const pal = v => {        // waterfall colour map: black -> deep teal -> phosphor -> white
    v = clamp(v);
    const r = v < 0.6 ? 10 * v : lerp(6, 143, (v - 0.6) / 0.4 * 0.8) + (v > 0.9 ? (v - 0.9) * 800 : 0);
    const gg = lerp(8, 247, Math.pow(v, 1.35));
    const b = lerp(10, 208, Math.pow(v, 1.5));
    return [Math.min(255, r), Math.min(255, gg + (v > 0.9 ? (v - 0.9) * 80 : 0)), Math.min(255, b + (v > 0.9 ? (v - 0.9) * 400 : 0))];
  };
  const noiseImg = document.createElement('canvas'); noiseImg.width = NC; noiseImg.height = NK;
  {
    const x = noiseImg.getContext('2d'), id = x.createImageData(NC, NK);
    for (let r = 0; r < NK; r++) {
      const k = NK - 1 - r;           // canvas row r holds noise index k (time runs upward)
      for (let c = 0; c < NC; c++) {
        const [R, Gg, Bb] = pal(NOISE[k * NC + c] * 0.62);
        const i = (r * NC + c) * 4;
        id.data[i] = R; id.data[i + 1] = Gg; id.data[i + 2] = Bb; id.data[i + 3] = 255;
      }
    }
    x.putImageData(id, 0, 0);
  }
  // static / snow tile for glitches and the dead screen
  const snow = document.createElement('canvas'); snow.width = 400; snow.height = 300;
  {
    const x = snow.getContext('2d'), id = x.createImageData(400, 300), rnd = U.mulberry32(66);
    for (let i = 0; i < 400 * 300; i++) { const v = Math.pow(rnd(), 2.2) * 255; id.data[i * 4] = v * 0.75; id.data[i * 4 + 1] = v; id.data[i * 4 + 2] = v * 0.92; id.data[i * 4 + 3] = 255; }
    x.putImageData(id, 0, 0);
  }

  // ---------------------------------------------------------------- helpers
  function text(s, x, y, size, col, align = 'left', weight = 'bold', halo = 0, ctx = g) {
    ctx.font = `${weight} ${size}px ${MONO}`;
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    if (halo > 0) {
      ctx.lineJoin = 'round';
      ctx.strokeStyle = col.replace(/[\d.]+\)$/, m => `${parseFloat(m) * 0.12 * halo})`);
      ctx.lineWidth = Math.min(size * 0.3, 9); ctx.strokeText(s, x, y);
    }
    ctx.fillStyle = col;
    ctx.fillText(s, x, y);
  }
  function bracket(x, y, w, h, s, col, ctx = g) {
    ctx.strokeStyle = col; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, y + s); ctx.lineTo(x, y); ctx.lineTo(x + s, y);
    ctx.moveTo(x + w - s, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + s);
    ctx.moveTo(x + w, y + h - s); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w - s, y + h);
    ctx.moveTo(x + s, y + h); ctx.lineTo(x, y + h); ctx.lineTo(x, y + h - s);
    ctx.stroke();
  }
  const typedN = (msg, t0, t, cps = 28) => clamp(Math.floor((t - t0) * cps) + 1, 0, msg.length);

  // ------------------------------------------------------------ main: parts
  function header(t, status, statusOn, fkey) {
    text('KESTREL RIDGE RO  //  RX-3  L-BAND 1420.405 MHz', 60, 50, 30, ph(0.92), 'left', 'bold', 1);
    text(`${utc(t)} UTC`, MW - 60, 50, 30, ph(0.92), 'right', 'bold', 1);
    const feed = 'FEED L1  //  AZ 141.2°  EL 36.4°  //  FFT 4096  //  ';
    text(feed, 60, 90, 19, ph(0.55), 'left', 'normal');
    g.font = `normal 19px ${MONO}`;
    const w = g.measureText(feed).width;
    text(status, 60 + w, 90, 19, ph(statusOn), 'left', 'bold');
    // REC dot
    const rec = Math.floor(t / 0.5) % 2 === 0;
    g.fillStyle = rec ? 'rgba(255,72,56,0.95)' : 'rgba(255,72,56,0.25)';
    g.beginPath(); g.arc(MW - 130, 90, 8, 0, 7); g.fill();
    text('REC', MW - 114, 90, 19, ph(0.8), 'left', 'bold');
    // ruler
    g.strokeStyle = ph(0.3); g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(60, 112.5); g.lineTo(MW - 60, 112.5);
    for (let i = 0; i <= 37; i++) { const xx = 60 + i * (MW - 120) / 37; g.moveTo(xx, 112); g.lineTo(xx, i % 5 ? 117 : 123); }
    g.stroke();
    // function keys
    const keys = ['F1 WFALL', 'F2 DEMOD', 'F3 FOLD', 'F4 LOG', 'F5 ARCH', 'F10 HALT'];
    for (let i = 0; i < keys.length; i++) {
      const x = 60 + i * 186, y = 856;
      const on = fkey === i;
      if (on) { g.fillStyle = ph(0.62); g.fillRect(x, y - 15, 170, 30); }
      else { g.strokeStyle = ph(0.3); g.lineWidth = 1.5; g.strokeRect(x + 0.5, y - 14.5, 169, 29); }
      text(keys[i], x + 10, y + 1, 18, on ? 'rgba(0,6,3,1)' : ph(0.55), 'left', 'bold');
    }
  }

  // lane intensity for the time slice [a, b]
  function laneVal(l, a, b) {
    let v = 0;
    const span = Math.max(b - a, 1e-6);
    if (b > T_ALARM - 0.5 && a < T_P0) v = Math.max(v, carrierOn(l, a, b) / span);
    if (b > T_P0 - 0.01 && a < T_LAST + 0.1) {
      const L = lanes[l];
      const dens = smooth(80, 320, RATE(Math.min((a + b) / 2, T_LAST)));
      let val = Math.min(1, (onTime(L, b) - onTime(L, a)) / span * (1 + (l ? 4 : 1.4) * dens));
      if (countLE(L.S, L.n, b) > countLE(L.S, L.n, a)) val = Math.max(val, 0.9);
      v = Math.max(v, val);
    }
    return v;
  }

  function waterfall(t, fade = 1) {
    const { x, y, w, h } = WF;
    // noise: rows scroll down; canvas row r of noiseImg <-> index NK-1-r
    const pos = t * SPEED;
    const kTop = Math.floor(pos), frac = pos - kTop;
    const rTop = ((NK - 1 - kTop) % NK + NK) % NK;
    g.save();
    g.beginPath(); g.rect(x, y, w, h); g.clip();
    g.imageSmoothingEnabled = false;
    g.globalAlpha = fade;
    let drawn = 0, r = rTop;
    while (drawn < h + 2) {
      const n = Math.min(NK - r, h + 2 - drawn);
      g.drawImage(noiseImg, 0, r, NC, n, x, y + drawn - frac, w, n);
      drawn += n; r = 0;
    }
    g.imageSmoothingEnabled = true;
    // signal lanes, one slice per 2 px row
    const tNow = t;
    for (let p = 0; p < h; p += 2) {
      const b = tNow - p / SPEED, a = b - 2 / SPEED;
      if (b < T_ALARM - 0.6) break;
      for (let l = 0; l < 2; l++) {
        const v = laneVal(l, a, b);
        if (v <= 0.01) continue;
        const age = tNow - b;
        const fresh = Math.exp(-age / 0.6);
        const X = LANE_X[l];
        g.fillStyle = ph(0.10 * v * fade); g.fillRect(X - 14, y + p, 28, 2);
        g.fillStyle = ph((0.35 + 0.3 * fresh) * v * fade); g.fillRect(X - 6, y + p, 12, 2);
        g.fillStyle = hot((0.55 + 0.45 * fresh) * v * fade); g.fillRect(X - 2.5, y + p, 5, 2);
      }
    }
    g.restore();
    // frame, axis
    g.strokeStyle = ph(0.4 * fade); g.lineWidth = 1.5; g.strokeRect(x + 0.5, y + 0.5, w, h);
    for (let f = 0; f <= F_MAX; f += 100) {
      const xx = fx(f);
      g.beginPath(); g.moveTo(xx, y + h); g.lineTo(xx, y + h + (f % 500 ? 5 : 10)); g.stroke();
      if (f % 500 === 0) text(`${f}`, xx, y + h + 22, 16, ph(0.6 * fade), 'center', 'normal');
    }
    text('Hz', x + w, y + h + 22, 16, ph(0.6 * fade), 'right', 'normal');
    // time ticks on the left
    for (let s = 0; s <= h / SPEED; s++) { const yy = y + s * SPEED; g.beginPath(); g.moveTo(x - 6, yy); g.lineTo(x, yy); g.stroke(); }
    text('-8 s', x - 4, y + h - 10, 13, ph(0.45 * fade), 'right', 'normal');
  }

  function spectrum(t, fade = 1) {
    const { x, y, w, h } = SP;
    g.strokeStyle = ph(0.3 * fade); g.lineWidth = 1.5; g.strokeRect(x + 0.5, y + 0.5, w, h);
    g.strokeStyle = ph(0.1 * fade); g.lineWidth = 1;
    g.beginPath();
    for (let i = 1; i < 4; i++) { g.moveTo(x, y + i * h / 4 + 0.5); g.lineTo(x + w, y + i * h / 4 + 0.5); }
    for (let f = 500; f < F_MAX; f += 500) { g.moveTo(fx(f) + 0.5, y); g.lineTo(fx(f) + 0.5, y + h); }
    g.stroke();
    // averaged spectrum over the last ~0.25 s of noise rows
    const k0 = Math.floor(t * SPEED);
    const v = new Float32Array(NC);
    for (let j = 0; j < 12; j++) { const k = ((k0 - j) % NK + NK) % NK; for (let c = 0; c < NC; c++) v[c] += NOISE[k * NC + c] / 12; }
    const lv = [laneVal(0, t - 0.06, t), laneVal(1, t - 0.06, t)];
    const yv = c => {
      const xx = x + (c + 0.5) * CW;
      let s = v[c] * 0.55;
      for (let l = 0; l < 2; l++) s += lv[l] * 0.95 * Math.exp(-Math.pow((xx - LANE_X[l]) / 5, 2));
      return y + h - 6 - clamp(s, 0, 1.05) * (h - 14);
    };
    g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip();
    g.beginPath();
    for (let c = 0; c < NC; c++) { const yy = yv(c); if (c === 0) g.moveTo(x, yy); else g.lineTo(x + (c + 0.5) * CW, yy); }
    // extra fine points at the lanes so the peaks are sharp
    g.lineJoin = 'round';
    g.strokeStyle = ph(0.18 * fade); g.lineWidth = 6; g.stroke();
    g.strokeStyle = ph(0.95 * fade); g.lineWidth = 1.6; g.stroke();
    for (let l = 0; l < 2; l++) if (lv[l] > 0.02) {
      const X = LANE_X[l];
      g.strokeStyle = hot(0.9 * lv[l] * fade); g.lineWidth = 2;
      g.beginPath(); g.moveTo(X - 7, y + h - 12); g.lineTo(X, y + h - 6 - lv[l] * 0.95 * (h - 14)); g.lineTo(X + 7, y + h - 12); g.stroke();
    }
    g.restore();
    // HI label on the hump
    text('H I  1420.405 MHz', fx(1210), y + 18, 15, ph(0.55 * fade), 'center', 'normal');
    text('dB', x + 6, y + 14, 14, ph(0.4 * fade), 'left', 'normal');
    // lane markers once the signal is up
    if (t > T_ALARM) {
      const a = smooth(T_ALARM, T_ALARM + 0.5, t) * fade;
      for (let l = 0; l < 2; l++) {
        const X = LANE_X[l];
        g.strokeStyle = ph(0.5 * a); g.setLineDash([4, 4]); g.lineWidth = 1;
        g.beginPath(); g.moveTo(X + 0.5, y + 22); g.lineTo(X + 0.5, WF.y); g.stroke(); g.setLineDash([]);
        text(`${FREQ[l].toFixed(0)} Hz`, X + (l ? 10 : -10), y + 34, 16, ph(0.85 * a), l ? 'left' : 'right', 'bold');
      }
    }
  }

  function scopeTrace(t, x, y, w, h, alpha, ctx = g, col = ph, lw = 1) {
    ctx.strokeStyle = col(0.35 * alpha); ctx.lineWidth = 1.5; ctx.strokeRect(x + 0.5, y + 0.5, w, h);
    ctx.strokeStyle = col(0.1 * alpha); ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 1; i < 8; i++) { ctx.moveTo(x + i * w / 8 + 0.5, y); ctx.lineTo(x + i * w / 8 + 0.5, y + h); }
    for (let i = 1; i < 4; i++) { ctx.moveTo(x, y + i * h / 4 + 0.5); ctx.lineTo(x + w, y + i * h / 4 + 0.5); }
    ctx.stroke();
    const win = 0.024, N = 260;
    const rnd = U.mulberry32(Math.floor(t * 24 + 0.5) * 7 + 3);
    const mid = y + h / 2;
    ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
    ctx.beginPath();
    for (let k = 0; k <= N; k++) {
      const tau = t - win + (k / N) * win;
      let v = 0;
      const i = pulseAt(tau);
      if (i >= 0 && tau <= T_LAST + 0.1) {
        const dt = tau - TIMES[i];
        if (dt < DUR[i]) { const e = Math.min(1, dt / 0.0004, (DUR[i] - dt) / 0.0004); v = e * Math.sin(2 * PI * FREQ[BITS[i]] * tau); }
      }
      if (tau > T_ALARM && tau < T_P0 - 0.3) {
        const ph0 = ((tau % 1.6) + 1.6) % 1.6;
        if (ph0 < 0.5) v = Math.sin(2 * PI * FREQ[1] * tau); else if (ph0 >= 0.8 && ph0 < 1.3) v = Math.sin(2 * PI * FREQ[0] * tau);
      }
      v = v * 0.78 + (rnd() - 0.5) * 0.12;
      const px = x + (k / N) * w, py = mid - v * h * 0.42;
      if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.lineJoin = 'round';
    ctx.strokeStyle = col(0.15 * alpha); ctx.lineWidth = 6 * lw; ctx.stroke();
    ctx.strokeStyle = col(0.95 * alpha); ctx.lineWidth = 1.5 * lw; ctx.stroke();
    ctx.restore();
  }

  function rightPanel(t) {
    const { x, y, w } = RP;
    const X2 = x + w;
    const alarmOn = t >= T_ALARM;
    // status box
    const blinkOn = Math.floor((t - T_ALARM) / 0.35) % 2 === 0;
    if (!alarmOn) {
      bracket(x, y, w, 70, 14, ph(0.4));
      const sp = '|/-\\'[Math.floor(t * 6) % 4];
      text(`SCANNING  ${sp}`, x + 20, y + 36, 30, ph(0.85), 'left', 'bold', 0.6);
    } else if (t < T_P1 + 0.2) {
      if (blinkOn || t > T_P0) { g.fillStyle = ph(0.6); g.fillRect(x, y, w, 70); text('▲ SIGNAL DETECTED', x + 16, y + 36, 32, 'rgba(0,5,3,1)', 'left', 'bold'); }
      else { bracket(x, y, w, 70, 14, ph(0.8)); text('▲ SIGNAL DETECTED', x + 16, y + 36, 32, ph(0.9), 'left', 'bold', 0.5); }
    } else {
      bracket(x, y, w, 70, 14, ph(0.6));
      text('LOCK LOST', x + 20, y + 36, 30, ph(Math.floor(t / 0.4) % 2 ? 0.45 : 0.95), 'left', 'bold', 1);
    }
    // readouts
    const jitter = (k, a) => (U.vnoise3(t * 3, k, 0.5) - 0.5) * a;
    const det = smooth(T_ALARM, T_ALARM + 1.2, t) * (1 - smooth(T_P1, T_P1 + 0.6, t));
    const rows = [
      ['SNR', `${(0.8 + jitter(1, 0.8) + det * (22.6 + jitter(2, 0.6))).toFixed(1)} dB`],
      ['DRIFT', det > 0.5 ? '0.000 Hz/s' : '  --'],
      ['BW', det > 0.5 ? '< 0.1 Hz' : '  --'],
      ['POL', det > 0.5 ? 'CIRC  R' : '  --'],
      ['RFI DB', det > 0.5 ? (t > T_ALARM + 6 ? 'NO MATCH' : 'CHECKING') : '  --'],
    ];
    rows.forEach(([k, v], i) => {
      const yy = y + 104 + i * 30;
      text(k, x + 4, yy, 19, ph(0.55), 'left', 'normal');
      text(v, X2, yy, 21, ph(0.92), 'right', 'bold');
    });
    // pulse counter
    const cy = y + 270;
    text('PULSES', x + 4, cy, 19, ph(0.6), 'left', 'normal');
    bracket(x - 6, cy - 18, w + 12, 150, 14, ph(0.4));
    const count = clamp(pulseAt(Math.min(t, T_P1 + 1)) + 1, 0, NP);
    const done = t > T_LAST + 0.05;
    const blink = !done || Math.floor((t - T_LAST) / 0.4) % 2 === 0;
    if (t < T_P0) text('----', X2 - 4, cy + 72, 108, ph(0.3), 'right', 'bold');
    else if (blink) text(String(count).padStart(4, '0'), X2 - 4, cy + 72, 108, hot(0.85), 'right', 'bold', 0.3);
    // rate
    const r = RATE(t);
    text('RATE', x + 4, cy + 160, 19, ph(0.6), 'left', 'normal');
    text((t < T_P0 || done ? '  0.0' : r.toFixed(1).padStart(5, ' ')) + ' /s', X2, cy + 160, 24, ph(0.92), 'right', 'bold');
    // demod tone
    const ip = pulseAt(t);
    const on = ip >= 0 && t <= T_LAST + 0.1 && t - TIMES[ip] < DUR[ip];
    text('CH-2 DEMOD', x + 4, cy + 194, 17, ph(0.5), 'left', 'normal');
    text(on ? `${FREQ[BITS[ip]].toFixed(0)} Hz` : (done ? 'NO CARRIER' : '--'), X2, cy + 194, 17, ph(0.8), 'right', 'normal');
    scopeTrace(t, x, cy + 214, w, 120, 1);
    // factorisation, typed after the end
    if (t > T_P1 + 0.35) {
      const m1 = '1679 = 23 × 73';
      const n = typedN(m1, T_P1 + 0.35, t, 18);
      text(m1.slice(0, n), x + 4, y + 640, 30, hot(0.95), 'left', 'bold', 0.4);
      if (t > T_P1 + 1.3) { const m2 = 'SEMIPRIME: 2-D RASTER?'; text(m2.slice(0, typedN(m2, T_P1 + 1.3, t, 26)), x + 4, y + 674, 18, ph(0.75), 'left', 'normal'); }
    }
  }

  function eot(t) {
    if (t < T_LAST + 0.25) return;
    const a = smooth(T_LAST + 0.25, T_LAST + 0.45, t);
    const msg = 'END OF TRANSMISSION';
    const n = typedN(msg, T_LAST + 0.25, t, 30);
    g.font = `bold 58px ${MONO}`;
    const fw = g.measureText(msg).width;
    const cx = WF.x + WF.w / 2, cy = WF.y + WF.h * 0.42;
    g.fillStyle = `rgba(0,0,0,${0.72 * a})`;
    g.fillRect(cx - fw / 2 - 40, cy - 60, fw + 80, 128);
    bracket(cx - fw / 2 - 40, cy - 60, fw + 80, 128, 18, ph(0.8 * a));
    text(msg.slice(0, n), cx - fw / 2, cy - 12, 58, hot(0.92 * a), 'left', 'bold', 0.35);
    const on2 = Math.floor((t - T_LAST - 0.25) / 0.5) % 2 === 0;
    if (on2 || n < msg.length) {
      g.font = `bold 58px ${MONO}`;
      const w2 = g.measureText(msg.slice(0, n)).width;
      g.fillStyle = ph(0.9 * a); g.fillRect(cx - fw / 2 + w2 + 6, cy - 38, 30, 54);
    }
    text(`1679 PULSES  //  ${(T_LAST - T_P0).toFixed(2)} s  //  LOCK LOST ${utcS(T_LAST)}`, cx, cy + 40, 18, ph(0.75 * smooth(T_LAST + 0.8, T_LAST + 1.1, t)), 'center', 'normal');
  }

  // ------------------------------------------------------------- the grid
  // cell geometry: grid centred at (GX, GY) with cell size cs
  function gridView(t) {
    // zoom toward the visitor box
    const z = U.easeInOut(clamp((t - T_Z0) / 1.5));
    const cs0 = 8.4, cs1 = 520 / (VB.r1 - VB.r0 + 1);
    const cs = cs0 * Math.pow(cs1 / cs0, z);
    // centre of the grid (col, row) that sits at the screen point (cx, cy)
    const c0 = COLS / 2, r0 = ROWS / 2;
    const cb = (VB.c0 + VB.c1 + 1) / 2, rb = (VB.r0 + VB.r1 + 1) / 2;
    const cc = lerp(c0, cb, z), rc = lerp(r0, rb, z);
    return { cs, cc, rc, cx: 800, cy: 452, z };
  }
  const inVB = (r, c) => r >= VB.r0 && r <= VB.r1 && c >= VB.c0 && c <= VB.c1;
  const isDiff = (r, c) => SENT[r][c] !== RET[r][c];
  let matchBits = 0;
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (SENT[r][c] === RET[r][c]) matchBits++;

  function drawGrid(t) {
    const V = gridView(t);
    const { cs, cc, rc, cx, cy, z } = V;
    const X = c => cx + (c - cc) * cs, Y = r => cy + (r - rc) * cs;
    // row progress
    let rowsDone = 0;
    while (rowsDone < ROWS && t >= ROW_T[rowsDone]) rowsDone++;
    const rowDur = (T_F1 - T_F0) / ROWS;
    const redA = smooth(T_Z0 - 0.1, T_Z0 + 0.5, t);
    const diffBlink = t > T_DIFF && t < T_Z0 ? (Math.floor((t - T_DIFF) / 0.3) % 2 === 0 ? 1 : 0.35) : 0;
    // faint cell lattice
    g.fillStyle = ph(0.07);
    const gap = Math.max(0.8, cs * 0.1);
    for (let r = 0; r < ROWS; r++) {
      const yy = Y(r);
      if (yy < -cs || yy > MH) continue;
      const rowAge = t - ROW_T[r];
      const written = r < rowsDone;
      const cellsVis = written ? (rowAge > rowDur ? COLS : Math.floor(COLS * clamp(rowAge / (rowDur * 0.9)) + 1)) : 0;
      for (let c = 0; c < COLS; c++) {
        const xx = X(c);
        if (xx < -cs || xx > MW) continue;
        if (c >= cellsVis) { g.fillStyle = ph(0.06); g.fillRect(xx + cs / 2 - 1, yy + cs / 2 - 1, 2, 2); continue; }
        const bit = RET[r][c];
        const vb = inVB(r, c);
        if (!bit) {
          g.fillStyle = vb && redA > 0 ? ro(0.12 * redA) : ph(0.08);
          g.fillRect(xx + cs * 0.42, yy + cs * 0.42, cs * 0.16, cs * 0.16);
          continue;
        }
        const flash = Math.exp(-Math.max(0, rowAge) / 0.35);
        if (vb && redA > 0) {
          g.fillStyle = ro(0.95);
          g.fillRect(xx + gap, yy + gap, cs - 2 * gap, cs - 2 * gap);
          if (cs > 20) { g.fillStyle = 'rgba(255,220,180,0.55)'; g.fillRect(xx + cs * 0.25, yy + cs * 0.25, cs * 0.5, cs * 0.5); }
        } else {
          const dim = z > 0 ? lerp(1, 0.45, z) : 1;
          g.fillStyle = flash > 0.05 ? hot((0.8 + 0.2 * flash) * dim) : ph(0.9 * dim);
          g.fillRect(xx + gap, yy + gap, cs - 2 * gap, cs - 2 * gap);
        }
      }
    }
    // write cursor
    if (rowsDone > 0 && rowsDone <= ROWS && t < T_F1 + 0.3) {
      const r = rowsDone - 1;
      g.strokeStyle = hot(0.9); g.lineWidth = 2;
      g.strokeRect(X(0) - 4, Y(r) - 2, COLS * cs + 8, cs + 4);
      text('▶', X(0) - 12, Y(r) + cs / 2, 16, hot(0.9), 'right', 'bold');
    }
    // frame
    if (z < 0.2) { g.strokeStyle = ph(0.35 * (1 - z * 5)); g.lineWidth = 1.5; g.strokeRect(X(0) - 8, Y(0) - 8, COLS * cs + 16, ROWS * cs + 16); }
    // diff region highlight (hold, before the zoom)
    if (diffBlink > 0 || (t >= T_Z0 && z < 1)) {
      const a = t >= T_Z0 ? 1 : diffBlink;
      g.strokeStyle = ro(0.95 * a); g.lineWidth = 2.5; g.setLineDash([8, 5]);
      g.strokeRect(X(VB.c0) - 5, Y(VB.r0) - 5, (VB.c1 - VB.c0 + 1) * cs + 10, (VB.r1 - VB.r0 + 1) * cs + 10);
      g.setLineDash([]);
    }
    return V;
  }

  function foldPanels(t) {
    // left: stats; right: the raw stream cut into 23-bit rows
    let rowsDone = 0;
    while (rowsDone < ROWS && t >= ROW_T[rowsDone]) rowsDone++;
    const bits = Math.min(1679, rowsDone * COLS);
    const a = smooth(T_KEY, T_KEY + 0.4, t);
    const LX = 250, RX = 640;
    text('FOLD', LX, 170, 44, hot(0.95 * a), 'left', 'bold', 0.4);
    text('1679 = 23 × 73', LX, 222, 30, ph(0.9 * a), 'left', 'bold');
    text('ROW', LX, 300, 20, ph(0.55 * a), 'left', 'normal');
    text(`${String(rowsDone).padStart(2, '0')} / 73`, RX, 300, 30, ph(0.95 * a), 'right', 'bold');
    text('BITS', LX, 340, 20, ph(0.55 * a), 'left', 'normal');
    text(`${String(bits).padStart(4, '0')} / 1679`, RX, 340, 30, ph(0.95 * a), 'right', 'bold');
    // the wrong fold, struck out
    const y0 = 420;
    text('73 × 23', LX, y0, 22, ph(0.6 * a), 'left', 'bold');
    const cs = 5;
    for (let r = 0; r < 23; r++) for (let c = 0; c < 73; c += 1) {
      const i = r * 73 + c;
      const b = RET[Math.floor(i / COLS)][i % COLS];
      if (b) { g.fillStyle = ph(0.35 * a); g.fillRect(LX + c * cs, y0 + 22 + r * cs, cs - 1, cs - 1); }
    }
    g.strokeStyle = ro(0.8 * a); g.lineWidth = 3;
    g.beginPath(); g.moveTo(LX - 6, y0 + 16); g.lineTo(LX + 73 * cs + 6, y0 + 22 + 23 * cs + 6); g.stroke();
    text('NOISE', LX + 40, y0 + 160, 18, ro(0.8 * a), 'left', 'bold');
    text('23 × 73', LX, y0 + 210, 22, ph(0.6 * a), 'left', 'bold');
    const good = rowsDone >= ROWS ? (Math.floor(t / 0.4) % 2 === 0 ? 0.95 : 0.6) : 0.4;
    text(rowsDone >= ROWS ? 'IMAGE  ✔' : 'IMAGE ?', LX, y0 + 244, 26, hot(good * a), 'left', 'bold', rowsDone >= ROWS ? 0.4 : 0);
    // right: stream rows (next rows to be folded)
    const sx = 960, sy = 170;
    text('STREAM', sx, sy, 20, ph(0.55 * a), 'left', 'normal');
    for (let k = 0; k < 20; k++) {
      const r = rowsDone + k;
      if (r >= ROWS) break;
      const s = RET[r].join('');
      const al = (k === 0 ? 0.95 : 0.6 - k * 0.025) * a;
      text(s, sx, sy + 38 + k * 30, 22, k === 0 ? hot(al) : ph(al), 'left', 'bold');
    }
    if (rowsDone < ROWS) text('◀', sx - 14, sy + 38, 20, hot(0.9 * a), 'right', 'bold');
  }

  function archivePanel(t) {
    // left: the 1974 outbound picture, differences in red-orange
    const a = smooth(T_MATCH, T_MATCH + 0.5, t);
    if (a <= 0) return;
    const cs = 5.0, x0 = 300, y0 = 470 - ROWS * cs / 2 + 40;
    const n = typedN('ARCHIVE MATCH', T_MATCH, t, 24);
    text('ARCHIVE MATCH'.slice(0, n), 250, 170, 34, hot(0.95 * a), 'left', 'bold', 0.4);
    text('OUTBOUND  1974-11-16', 250, 212, 20, ph(0.8 * a), 'left', 'normal');
    text(`${matchBits} / 1679 BITS`, 250, 246, 22, ph(0.9 * a), 'left', 'bold');
    text(`${(matchBits / 1679 * 100).toFixed(1)} %`, 250, 280, 30, hot(0.95 * a), 'left', 'bold');
    const reveal = clamp((t - T_MATCH) / 0.8);
    for (let r = 0; r < ROWS * reveal; r++) for (let c = 0; c < COLS; c++) {
      if (!SENT[r][c] && !isDiff(r, c)) continue;
      const d = isDiff(r, c) && t > T_DIFF - 0.8;
      g.fillStyle = d ? ro(0.9 * a) : ph(0.6 * a);
      if (SENT[r][c]) g.fillRect(x0 + c * cs + 0.6, y0 + 20 + r * cs + 0.6, cs - 1.2, cs - 1.2);
      else if (d) g.fillRect(x0 + c * cs + 1.8, y0 + 20 + r * cs + 1.8, cs - 3.6, cs - 3.6);
    }
    g.strokeStyle = ph(0.3 * a); g.lineWidth = 1; g.strokeRect(x0 - 5, y0 + 15, COLS * cs + 10, ROWS * cs + 10);
    text('TX 1974', x0 + COLS * cs / 2, y0 + 20 + ROWS * cs + 26, 16, ph(0.7 * a), 'center', 'bold');
    if (t > T_DIFF - 0.8) {
      const b = smooth(T_DIFF - 0.8, T_DIFF - 0.3, t);
      text('DIFF: 1 REGION', 960, 640, 24, ro(0.95 * b), 'left', 'bold', 0.4);
      text(`ROWS ${VB.r0}-${VB.r1}  COLS ${VB.c0}-${VB.c1}`, 960, 676, 18, ro(0.8 * b), 'left', 'normal');
      text('NOT IN ORIGINAL', 960, 708, 18, ro(0.8 * b), 'left', 'normal');
    }
    // right: RX picture label
    text('RX  TONIGHT', 960, 170, 22, ph(0.8 * a), 'left', 'bold');
    text(`${utcS(T_F1)} UTC  //  23 × 73`, 960, 204, 18, ph(0.6 * a), 'left', 'normal');
  }

  function zoomLabels(t, V) {
    const a = smooth(T_Z0 + 0.6, T_Z0 + 1.2, t);
    if (a <= 0) return;
    const { cs, cc, rc, cx, cy } = V;
    const X = c => cx + (c - cc) * cs, Y = r => cy + (r - rc) * cs;
    const bx = X(VB.c1 + 1) + 24, by = Y(VB.r0);
    g.strokeStyle = ro(0.9 * a); g.lineWidth = 2;
    g.beginPath(); g.moveTo(X(VB.c1 + 1) + 6, by + 20); g.lineTo(bx + 20, by + 20); g.stroke();
    text('UNKNOWN', bx + 28, by + 20, 34, ro(0.95 * a), 'left', 'bold', 0.4);
    text(`H ${VB.r1 - VB.r0 + 1} ROWS  //  3 LEGS`, bx + 28, by + 62, 20, ro(0.8 * a), 'left', 'normal');
    text('NOT IN TX 1974', bx + 28, by + 94, 20, ro(0.8 * a), 'left', 'normal');
    // the human for scale, at the left edge
    text('HUMAN', X(8.5), Y(46) - 18, 22, ph(0.7 * a), 'center', 'bold');
  }

  // --------------------------------------------------------------- glitches
  function glitch(t, amt) {
    if (amt <= 0) return;
    const f = Math.floor(t * 24);
    const rnd = U.mulberry32(9000 + f);
    sg.clearRect(0, 0, MW, MH);
    sg.drawImage(curC, 0, 0, MW, MH);
    // tearing bands
    const nb = 3 + Math.floor(rnd() * 6 * amt);
    for (let i = 0; i < nb; i++) {
      const y = rnd() * MH, h = 8 + rnd() * 90 * amt, dx = (rnd() - 0.5) * 220 * amt;
      g.drawImage(scratch, 0, y, MW, h, dx, y, MW, h);
    }
    // colour-shifted ghost
    g.globalAlpha = 0.35 * amt; g.globalCompositeOperation = 'lighter';
    g.drawImage(scratch, 14 * amt, -4 * amt);
    g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
    // snow bursts
    const ns = Math.floor(rnd() * 4 * amt);
    for (let i = 0; i < ns; i++) {
      const y = rnd() * MH, h = 20 + rnd() * 160;
      g.globalAlpha = 0.5 + 0.5 * rnd();
      g.drawImage(snow, rnd() * 200, rnd() * 150, 200, 150 * h / MH, 0, y, MW, h);
    }
    g.globalAlpha = 1;
    // rolling bar
    const yb = ((t * 700) % (MH + 200)) - 100;
    const gr = g.createLinearGradient(0, yb - 80, 0, yb + 80);
    gr.addColorStop(0, 'rgba(200,255,240,0)'); gr.addColorStop(0.5, `rgba(200,255,240,${0.25 * amt})`); gr.addColorStop(1, 'rgba(200,255,240,0)');
    g.fillStyle = gr; g.fillRect(0, yb - 80, MW, 160);
    // brown-out dips
    if (rnd() < 0.35 * amt) { g.fillStyle = `rgba(0,0,0,${0.4 + 0.5 * rnd()})`; g.fillRect(0, 0, MW, MH); }
  }
  function deadScreen(t, level) {
    const f = Math.floor(t * 24);
    const rnd = U.mulberry32(5000 + f);
    g.fillStyle = '#000'; g.fillRect(0, 0, MW, MH);
    g.imageSmoothingEnabled = false;
    g.globalAlpha = level;
    for (let i = 0; i < 4; i++) g.drawImage(snow, rnd() * 100, rnd() * 80, 300, 220, (i % 2) * MW / 2, Math.floor(i / 2) * MH / 2, MW / 2, MH / 2);
    g.globalAlpha = 1;
    g.imageSmoothingEnabled = true;
    const yb = ((t * 90) % (MH + 300)) - 150;
    const gr = g.createLinearGradient(0, yb - 120, 0, yb + 120);
    gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(0.5, `rgba(140,220,210,${0.06 * level * 4})`); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, yb - 120, MW, 240);
  }

  // ---------------------------------------------------------------- main
  const BOOT = ['RX-3 SPECTROMETER  v2.4.1', 'MEMORY TEST 65536K ....... OK', 'DSP LINK ................. OK', 'FEED L1  LNA  18.2 K ...... OK', 'RESUMING SCAN'];
  const T_BOOT = T_RET + 0.25, T_IDLE2 = T_RET + 1.6;
  let mode = 'idle', level = 0.4, color = new THREE.Color(0.55, 1.0, 0.85);

  function drawMain(t, surge, big = true) {
    g = big ? gBig : gSmall; curC = big ? mainC : mainCs;
    const sc = big ? 1 : 0.5;
    g.setTransform(sc, 0, 0, sc, 0, 0);
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
    g.fillStyle = '#020806'; g.fillRect(0, 0, MW, MH);
    const dark0 = T_S1, dark1 = T_RET;
    if (t >= dark0 - 0.001 && t < dark1) {
      // after the surge: dead screen with snow, and a bright wash as the Visitor pours out
      const pour = smooth(T_M0 - 0.1, T_M0 + 0.5, t) * (1 - smooth(T_M0 + 0.9, T_M0 + 2.6, t));
      deadScreen(t, 0.14 + 0.1 * (1 - smooth(dark0, dark0 + 3, t)));
      if (pour > 0) {
        const gr = g.createRadialGradient(MW / 2, MH / 2, 30, MW / 2, MH / 2, MW * 0.7);
        gr.addColorStop(0, `rgba(235,255,255,${pour})`); gr.addColorStop(0.5, `rgba(120,240,255,${0.8 * pour})`); gr.addColorStop(1, `rgba(40,160,200,${0.5 * pour})`);
        g.fillStyle = gr; g.fillRect(0, 0, MW, MH);
      }
      return;
    }
    if (t >= T_RET && t < T_IDLE2) {
      g.fillStyle = '#000'; g.fillRect(0, 0, MW, MH);
      if (t > T_BOOT) {
        let tt = T_BOOT + 0.2;
        BOOT.forEach((line, i) => {
          if (t < tt) return;
          const n = typedN(line, tt, t, 60);
          text(line.slice(0, n), 80, 120 + i * 44, 28, ph(0.9), 'left', 'bold');
          tt += line.length / 60 + 0.08;
        });
        if (Math.floor(t / 0.3) % 2 === 0) { g.fillStyle = ph(0.9); g.fillRect(80, 120 + BOOT.length * 44 - 16, 18, 32); }
      }
      return;
    }
    const fade = t >= T_IDLE2 ? smooth(T_IDLE2, T_IDLE2 + 0.4, t) : 1;
    const inFold = t >= T_KEY && t < T_RET;
    if (!inFold) {
      const status = t < T_ALARM ? 'SCANNING' : t < T_P0 ? 'CANDIDATE' : t <= T_LAST + 0.1 ? 'SIGNAL LOCK' : 'LOCK LOST';
      const sOn = t < T_ALARM ? (Math.floor(t / 0.5) % 2 ? 0.4 : 0.8) : Math.floor(t / 0.3) % 2 ? 0.5 : 1;
      header(t, status, sOn, 0);
      spectrum(t, fade);
      waterfall(t, fade);
      if (t >= T_IDLE2) {
        // after the reboot: idle, no signal
        const { x, y, w } = RP;
        bracket(x, y, w, 70, 14, ph(0.4 * fade));
        text(`SCANNING  ${'|/-\\'[Math.floor(t * 6) % 4]}`, x + 20, y + 36, 30, ph(0.85 * fade), 'left', 'bold', 0.6);
        text('LAST EVENT', x + 4, y + 110, 19, ph(0.55 * fade), 'left', 'normal');
        text(`${utcS(T_ALARM)} UTC`, x + w, y + 110, 21, ph(0.9 * fade), 'right', 'bold');
        text('NO CARRIER', x + 4, y + 150, 24, ph(0.8 * fade), 'left', 'bold');
      } else {
        rightPanel(t);
        eot(t);
      }
    } else {
      // key press flash
      const kf = Math.exp(-Math.max(0, t - T_KEY) / 0.12);
      if (kf > 0.02) { g.fillStyle = hot(0.25 * kf); g.fillRect(0, 0, MW, MH); }
      g.save(); g.beginPath(); g.rect(0, 126, MW, 708); g.clip();
      const V = drawGrid(t);
      if (t < T_MATCH) foldPanels(t);
      else if (t < T_Z0 + 0.3) archivePanel(t);
      if (t >= T_Z0) zoomLabels(t, V);
      g.restore();
      header(t, t < T_F1 ? 'DECODE' : t < T_Z0 ? 'DECODED' : 'DIFF', 1, t < T_MATCH ? 2 : 4);
    }
    glitch(t, surge);
  }

  // ---------------------------------------------------------------- second monitor (amber)
  const LOG = [
    [-99, 'TRACK J1745-29 START'], [-99, 'CAL NOISE DIODE  OK'], [-99, 'INTEGRATING 600 s'],
    [T_ALARM, '!! TRIGGER CH2 SNR 23.4'], [T_ALARM + 0.7, 'NARROWBAND 2-TONE'], [T_ALARM + 1.6, '1000 / 1420 Hz'], [T_ALARM + 3.0, 'DRIFT 0.000 Hz/s'],
    [T_ALARM + 7.0, 'NOT IN RFI DATABASE'], [T_ALARM + 9.5, 'SIDEREAL TRACK: FIXED'], [T_P0, 'PULSE TRAIN START'], [T_P1, 'PULSE TRAIN END N=1679'],
    [T_P1 + 0.8, '1679 = 23 x 73'], [T_KEY, 'FOLD 23 x 73'], [T_F1, 'FOLD COMPLETE'], [T_MATCH, 'ARCHIVE MATCH TX 1974'],
    [T_Z0 + 0.1, 'DIFF R46-58 C16-20'], [T_S0 + 0.1, '!! POWER FAULT'], [T_S0 + 0.5, '!! UPS ON BATTERY'],
    [T_RET + 0.5, 'SYSTEM RESTART'], [T_RET + 1.1, 'MAINS OK  UPS OK'], [T_RET + 1.8, 'DRIVE READY'], [T_RET + 2.6, 'NO CARRIER'],
  ];
  function textA(s, x, y, size, a, align = 'left', weight = 'bold') { text(s, x, y, size, AMB(a), align, weight, 0, g2); }
  function drawSecond(t, surge, dish) {
    g2.setTransform(1, 0, 0, 1, 0, 0);
    g2.globalAlpha = 1;
    g2.fillStyle = '#0a0500'; g2.fillRect(0, 0, SW, SH);
    if (t >= T_S0 + 0.9 && t < T_RET + 0.3) {
      const rnd = U.mulberry32(700 + Math.floor(t * 24));
      g2.globalAlpha = 0.1; g2.drawImage(snow, rnd() * 100, rnd() * 100, 200, 150, 0, 0, SW, SH); g2.globalAlpha = 1;
      return;
    }
    textA('KR-25  TELESCOPE CONTROL', 20, 26, 20, 0.95);
    textA(utc(t), SW - 20, 26, 20, 0.95, 'right');
    g2.fillStyle = AMB(0.5); g2.fillRect(20, 42, SW - 40, 2);
    // polar sky plot
    const cx = 150, cy = 170, R = 110;
    g2.strokeStyle = AMB(0.35); g2.lineWidth = 1.2;
    for (let k = 1; k <= 3; k++) { g2.beginPath(); g2.arc(cx, cy, R * k / 3, 0, 7); g2.stroke(); }
    g2.beginPath(); for (let k = 0; k < 8; k++) { g2.moveTo(cx, cy); g2.lineTo(cx + Math.cos(k * PI / 4) * R, cy + Math.sin(k * PI / 4) * R); } g2.stroke();
    textA('N', cx, cy - R - 10, 14, 0.7, 'center'); textA('E', cx + R + 10, cy, 14, 0.7, 'center');
    const az = 2.46 + (dish ? dish.az : 0), el = dish ? dish.el : 0.63;
    const pr = R * (1 - el / (PI / 2));
    const px = cx + Math.sin(az) * pr, py = cy - Math.cos(az) * pr;
    g2.strokeStyle = AMB(0.95); g2.lineWidth = 2;
    g2.beginPath(); g2.moveTo(px - 10, py); g2.lineTo(px + 10, py); g2.moveTo(px, py - 10); g2.lineTo(px, py + 10); g2.stroke();
    g2.beginPath(); g2.arc(px, py, 6, 0, 7); g2.stroke();
    if (t > T_ALARM) {
      const on = Math.floor(t / 0.4) % 2 === 0;
      g2.fillStyle = AMB(on ? 0.95 : 0.4);
      g2.beginPath(); g2.moveTo(px + 3, py - 16); g2.lineTo(px + 9, py - 10); g2.lineTo(px + 3, py - 4); g2.lineTo(px - 3, py - 10); g2.fill();
    }
    // readouts
    const deg = r => (r * 180 / PI);
    const rows = [['AZ', `${((deg(az) % 360 + 360) % 360).toFixed(2)}°`], ['EL', `${deg(el).toFixed(2)}°`], ['RA', '17h45m40s'], ['DEC', '-29°00\'28"'],
      ['DRIVE', t > B.dish_turns.start && t < B.dish_turns.end ? 'SLEW' : 'TRACK'], ['TSYS', `${(34.8 + (U.vnoise3(t * 2, 3, 1) - 0.5) * 0.6).toFixed(1)} K`], ['WIND', '4 km/h']];
    rows.forEach(([k, v], i) => { textA(k, 300, 70 + i * 26, 17, 0.6, 'left', 'normal'); textA(v, SW - 24, 70 + i * 26, 18, 0.95, 'right'); });
    // log
    g2.fillStyle = AMB(0.35); g2.fillRect(20, 296, SW - 40, 1.5);
    textA('EVENT LOG', 20, 312, 14, 0.6, 'left', 'normal');
    const vis = LOG.filter(e => e[0] <= t).slice(-6);
    vis.forEach(([te, s], i) => {
      const tt = te < 0 ? 12 - (3 - i) * 20 : te;
      const tag = te < 0 ? utcS(7 - 60 + i * 17) : utcS(tt);
      const alert = s.startsWith('!!');
      const blink = alert && t - te < 3 && Math.floor(t / 0.3) % 2 === 1;
      const n = te < 0 ? s.length : typedN(s, te, t, 40);
      textA(`${tag}  ${s.slice(0, n)}`, 20, 338 + i * 24, 16, blink ? 0.4 : (alert ? 1.0 : 0.85), 'left', alert ? 'bold' : 'normal');
    });
    // signal bar graph
    const lvl = t > T_ALARM && t < T_LAST + 0.3 ? 0.85 : 0.2;
    for (let i = 0; i < 12; i++) {
      const v = clamp(lvl * (0.6 + 0.4 * U.vnoise3(t * 4 + i * 0.7, i, 2)));
      g2.fillStyle = AMB(0.2); g2.fillRect(300 + i * 26, 270 - 70, 18, 70);
      g2.fillStyle = AMB(0.85); g2.fillRect(300 + i * 26, 270 - 70 * v, 18, 70 * v);
    }
    if (surge > 0) {
      const rnd = U.mulberry32(800 + Math.floor(t * 24));
      for (let i = 0; i < 4; i++) { const y = rnd() * SH, h = 6 + rnd() * 50; g2.drawImage(secC, 0, y, SW, h, (rnd() - 0.5) * 80 * surge, y, SW, h); }
      if (rnd() < 0.4 * surge) { g2.fillStyle = 'rgba(0,0,0,0.7)'; g2.fillRect(0, 0, SW, SH); }
    }
  }

  // ---------------------------------------------------------------- rack scope + counter
  function drawScope(t, alive) {
    g3.fillStyle = '#020604'; g3.fillRect(0, 0, 256, 180);
    if (alive <= 0) return;
    g3.globalAlpha = alive;
    g3.strokeStyle = 'rgba(120,255,160,0.18)'; g3.lineWidth = 1;
    g3.beginPath();
    for (let i = 1; i < 10; i++) { g3.moveTo(i * 25.6, 0); g3.lineTo(i * 25.6, 180); }
    for (let i = 1; i < 8; i++) { g3.moveTo(0, i * 22.5); g3.lineTo(256, i * 22.5); }
    g3.stroke();
    const sig = t > T_ALARM && t < T_LAST + 0.1;
    g3.beginPath();
    for (let k = 0; k <= 128; k++) {
      const x = k * 2;
      const v = sig ? Math.sin(k * 0.45 + t * 40) * 0.6 * (0.5 + 0.5 * Math.sin(t * 7)) : 0.06 * Math.sin(k * 2.1 + t * 90) + 0.04 * Math.sin(k * 0.3 - t * 5);
      const y = 90 - v * 60 + (hashf(k, Math.floor(t * 24)) - 0.5) * 5;
      if (k === 0) g3.moveTo(x, y); else g3.lineTo(x, y);
    }
    g3.strokeStyle = 'rgba(120,255,160,0.25)'; g3.lineWidth = 5; g3.stroke();
    g3.strokeStyle = 'rgba(170,255,190,0.95)'; g3.lineWidth = 1.6; g3.stroke();
    g3.globalAlpha = 1;
  }
  function seg7(ctx, s, x, y, h, col, off) {
    // simple 7-segment digits
    const S = { '0': 'abcdef', '1': 'bc', '2': 'abged', '3': 'abgcd', '4': 'fgbc', '5': 'afgcd', '6': 'afgedc', '7': 'abc', '8': 'abcdefg', '9': 'abcdfg', '-': 'g', ' ': '' };
    const w = h * 0.55, t = h * 0.12;
    let cx = x;
    for (const ch of s) {
      if (ch === '.') { ctx.fillStyle = col; ctx.fillRect(cx - w * 0.2, y + h - t, t, t); continue; }
      const segs = S[ch] || '';
      const draw = (k, sx, sy, sw, sh) => { ctx.fillStyle = segs.includes(k) ? col : off; ctx.fillRect(sx, sy, sw, sh); };
      draw('a', cx + t, y, w - 2 * t, t); draw('g', cx + t, y + h / 2 - t / 2, w - 2 * t, t); draw('d', cx + t, y + h - t, w - 2 * t, t);
      draw('f', cx, y + t, t, h / 2 - 1.5 * t); draw('b', cx + w - t, y + t, t, h / 2 - 1.5 * t);
      draw('e', cx, y + h / 2 + t / 2, t, h / 2 - 1.5 * t); draw('c', cx + w - t, y + h / 2 + t / 2, t, h / 2 - 1.5 * t);
      cx += w + h * 0.2;
    }
  }
  function drawCounter(t, alive) {
    g4.fillStyle = '#0c0202'; g4.fillRect(0, 0, 256, 64);
    const on = 'rgba(255,60,40,1)', off = 'rgba(60,8,6,1)';
    if (alive <= 0) { seg7(g4, '        ', 12, 12, 40, off, off); return; }
    const last = Math.floor(U.vnoise3(t * 5, 1, 1) * 10);
    seg7(g4, `1420.40${last}`, 12, 12, 40, alive < 1 ? `rgba(255,60,40,${alive})` : on, off);
  }

  // ---------------------------------------------------------------- materials
  const crtVert = /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
  const crtFrag = /* glsl */`
    uniform sampler2D map, tGlow;
    uniform float uBright, uCurv, uFlick, uRoll, uJit, uTime;
    uniform vec2 uLines, uGlow;
    uniform vec3 uBlack, uRefl, uSmudge;
    uniform sampler2D tSmudge;
    uniform vec4 uSmudgeUV;
    varying vec2 vUv;
    void main() {
      vec2 p = vUv * 2.0 - 1.0;
      p *= 1.0 + uCurv * (p.yx * p.yx);
      vec2 uv = p * 0.5 + 0.5;
      uv.y = fract(uv.y + uRoll);
      uv.x += uJit * sin(uv.y * 40.0 + uTime * 60.0) * 0.004;
      vec2 q = abs(p);
      float mask = (1.0 - smoothstep(0.985, 1.0, q.x)) * (1.0 - smoothstep(0.975, 1.0, q.y));
      vec3 c = texture2D(map, uv).rgb;
      vec3 g1 = texture2D(tGlow, uv).rgb;
      vec3 g2 = (texture2D(tGlow, uv + vec2(0.012, 0.0)).rgb + texture2D(tGlow, uv - vec2(0.012, 0.0)).rgb
               + texture2D(tGlow, uv + vec2(0.0, 0.02)).rgb + texture2D(tGlow, uv - vec2(0.0, 0.02)).rgb) * 0.25;
      c += g1 * uGlow.x + g2 * uGlow.y;
      float ln = uv.y * uLines.x;
      float w = fwidth(ln);
      float sl = 0.5 + 0.5 * cos(6.2831853 * ln);
      float amt = uLines.y * (1.0 - smoothstep(0.3, 0.7, w));
      c *= 1.0 - amt * (1.0 - sl);
      float vig = 1.0 - 0.28 * dot(p * 0.8, p * 0.8);
      c = c * vig * mask * uBright * uFlick + uBlack * mask;
      // glass: fingerprints and dust catch the room light; a soft warm sheen from the lamp
      float sm = texture2D(tSmudge, vUv * uSmudgeUV.xy + uSmudgeUV.zw).r;
      c = c * (1.0 - 0.1 * sm) + uSmudge * sm;
      vec2 r = vUv - vec2(0.78, 0.8);
      c += uRefl * exp(-dot(r, r) * 9.0) * (1.0 + 2.0 * sm);
      gl_FragColor = vec4(c, 1.0);
    }`;
  const crtMat = (tex, o) => new THREE.ShaderMaterial({
    uniforms: {
      map: { value: tex }, tGlow: { value: o.glowTex || tex }, uBright: { value: o.bright }, uCurv: { value: o.curv }, uFlick: { value: 1 }, uRoll: { value: 0 }, uJit: { value: 0 }, uTime: { value: 0 },
      uLines: { value: new THREE.Vector2(o.lines, o.scan) }, uGlow: { value: new THREE.Vector2(o.glow1, o.glow2) },
      uBlack: { value: new THREE.Vector3(...o.black) }, uRefl: { value: new THREE.Vector3(0, 0, 0) },
      tSmudge: { value: T.smudge || null }, uSmudge: { value: new THREE.Vector3(0, 0, 0) }, uSmudgeUV: { value: new THREE.Vector4(...(o.smudgeUV || [1, 1, 0, 0])) },
    },
    vertexShader: crtVert, fragmentShader: crtFrag,
  });
  const mainMaterial = crtMat(mainTex, { glowTex, bright: 1.25, curv: 0.03, lines: 330, scan: 0.35, glow1: 0.3, glow2: 0.38, black: [0.004, 0.009, 0.008] });
  const secondMaterial = crtMat(secTex, { bright: 1.1, curv: 0.06, lines: 240, scan: 0.4, glow1: 0.12, glow2: 0.12, black: [0.008, 0.005, 0.002], smudgeUV: [0.55, 0.7, 0.3, 0.2] });
  const scopeMaterial = new THREE.MeshBasicMaterial({ map: scopeTex, color: new THREE.Color(1.3, 1.3, 1.3) });
  const counterMaterial = new THREE.MeshBasicMaterial({ map: ctrTex, color: new THREE.Color(1.6, 1.6, 1.6) });

  // ---------------------------------------------------------------- per frame
  let pendingT = null, drawnT = null, pendingState = null;
  function computeLevel(t) {
    // approximate screen brightness + colour for the monitor spill light
    let lv = 0.38, col = [0.55, 1.0, 0.86];
    if (t >= T_ALARM && t < T_KEY) lv = 0.42 + 0.08 * (Math.floor((t - T_ALARM) / 0.35) % 2 === 0 && t < T_P0 ? 1 : 0);
    if (t >= T_P0 && t < T_LAST) lv = 0.45 + 0.15 * smooth(T_P0, T_LAST, t);
    if (t >= T_LAST && t < T_KEY) lv = 0.4;
    if (t >= T_KEY) lv = 0.36 + 0.3 * Math.exp(-Math.max(0, t - T_KEY) / 0.15);
    if (t >= T_Z0) { const z = smooth(T_Z0, T_Z0 + 1.2, t); lv = lerp(0.4, 0.55, z); col = [lerp(0.55, 1.0, z), lerp(1.0, 0.5, z), lerp(0.86, 0.25, z)]; }
    if (t >= T_S1 && t < T_RET) {
      const pour = smooth(T_M0 - 0.1, T_M0 + 0.5, t) * (1 - smooth(T_M0 + 0.9, T_M0 + 2.6, t));
      lv = 0.05 + 2.2 * pour; col = [lerp(0.5, 0.75, pour), 1.0, 1.0];
    }
    if (t >= T_RET && t < T_IDLE2) { lv = 0.08; col = [0.55, 1.0, 0.86]; }
    return { lv, col };
  }

  return {
    mainMaterial, secondMaterial, scopeMaterial, counterMaterial, mainTex, secTex,
    /** called from the set's update: records the state; the canvases draw lazily */
    update(t, st) {
      pendingT = t; pendingState = st;
      const surge = st.surge || 0;
      const L = computeLevel(t);
      // glitch in the shader too
      const f = Math.floor(t * 24);
      const rj = hashf(f, 3);
      mainMaterial.uniforms.uTime.value = t;
      mainMaterial.uniforms.uJit.value = surge * (0.5 + rj);
      mainMaterial.uniforms.uRoll.value = surge > 0.3 && rj > 0.7 ? (rj - 0.7) * 0.8 * surge : 0;
      const flick = surge > 0 ? 1 - surge * (hashf(f, 5) < 0.3 ? 0.8 : 0.15 * hashf(f, 6)) : 1;
      mainMaterial.uniforms.uFlick.value = flick;
      secondMaterial.uniforms.uFlick.value = flick;
      const refl = 0.012 * (st.lights ?? 1);
      mainMaterial.uniforms.uRefl.value.set(refl * 1.0, refl * 0.75, refl * 0.5);
      secondMaterial.uniforms.uRefl.value.set(refl * 1.0, refl * 0.75, refl * 0.5);
      const smg = 0.05 * (st.lights ?? 1) + 0.02;
      mainMaterial.uniforms.uSmudge.value.set(smg * 0.95, smg * 0.9, smg * 0.8);
      secondMaterial.uniforms.uSmudge.value.set(smg * 0.95, smg * 0.9, smg * 0.8);
      this.level = L.lv * flick;
      this.color.setRGB(...L.col);
      this.secondLevel = (t >= T_S0 + 0.9 && t < T_RET + 0.3) ? 0.03 : 0.3 * flick;
    },
    level: 0.4, color: new THREE.Color(0.55, 1.0, 0.86), secondLevel: 0.3,
    /** draw the main canvas for the pending time (idempotent) */
    drawMainIfNeeded(big = true) {
      const key = pendingT + (big ? 'B' : 'S');
      if (pendingT === null || drawnT === key) return;
      drawnT = key;
      drawMain(pendingT, pendingState.surge || 0, big);
      (big ? mainTex : mainTexS).needsUpdate = true;
      mainMaterial.uniforms.map.value = big ? mainTex : mainTexS;
      glowG.clearRect(0, 0, 200, 112);
      glowG.drawImage(curC, 0, 0, 200, 112);
      glowTex.needsUpdate = true;
    },
    _second: null,
    drawSecondIfNeeded() {
      if (pendingT === null || this._second === pendingT) return;
      this._second = pendingT;
      drawSecond(pendingT, pendingState.surge || 0, pendingState.dish);
      secTex.needsUpdate = true;
    },
    _rack: null,
    drawRackIfNeeded() {
      if (pendingT === null || this._rack === pendingT) return;
      this._rack = pendingT;
      const t = pendingT;
      const alive = t >= T_S0 + 0.6 && t < T_RET + 0.5 ? 0 : 1;
      drawScope(t, alive); drawCounter(t, alive);
      scopeTex.needsUpdate = true; ctrTex.needsUpdate = true;
    },
    canvases: { main: mainC, second: secC },
  };
}
