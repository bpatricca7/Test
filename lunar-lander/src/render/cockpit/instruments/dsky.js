// DSKY — Apollo Guidance Computer Display & Keyboard (Block II, LM & CM layout).
//
// Upper half: caution-light matrix (left, 2 × 7 lamps behind a frosted mask) and the
// electroluminescent numeric display (right): COMP ACTY, PROG, VERB, NOUN, three signed 5-digit
// registers separated by EL bars. Lower half: the 19-key keyboard
//      VERB  +  7  8  9  CLR  ENTR
//            -  4  5  6  PRO
//      NOUN  0  1  2  3  KEY REL  RSET
// Driven by vessel.agc: {prog, verb, noun, r1, r2, r3 (sign + 5 chars, '' = blank),
// flashVerbNoun, lights{...}}. Keys animate when the crew presses them (PRO, V37 program changes,
// RSET on master-alarm reset), via game 'action' events.
import {
  THREE, createPanel, createCanvasTexture, drawText, createGlass, drawSegChar, createDisplay, limiter, finish,
} from './common.js';
import { createPainter, createPaintedMaterial, roundedSlab, COLORS } from '../kit/index.js';

const W = 0.203;
const H = 0.216;
// windows (centre x, centre y, w, h) in body coordinates
const LAMP_WIN = { x: -0.0495, y: 0.0535, w: 0.080, h: 0.095 };
const EL_WIN = { x: 0.0475, y: 0.0535, w: 0.086, h: 0.095 };
const KEY_Y = -0.0535; // keyboard centre line
const KEY_PITCH_X = 0.0268;
const KEY_PITCH_Y = 0.0272;
const KEY_SIZE = 0.0212;

const LAMPS_LM = [
  ['uplinkActy', 'UPLINK\nACTY', 'white'], ['temp', 'TEMP', 'amber'],
  ['noAtt', 'NO ATT', 'white'], ['gimbalLock', 'GIMBAL\nLOCK', 'amber'],
  ['stby', 'STBY', 'white'], ['prog', 'PROG', 'amber'],
  ['keyRel', 'KEY REL', 'white'], ['restart', 'RESTART', 'amber'],
  ['oprErr', 'OPR ERR', 'white'], ['tracker', 'TRACKER', 'amber'],
  [null, '', 'white'], ['alt', 'ALT', 'amber'],
  [null, '', 'white'], ['vel', 'VEL', 'amber'],
];

/** Keyboard layout: [label, column, row] with row in half-steps from the top (0, 1, 2 full rows; 0.5/1.5 offset). */
const KEYS = [
  ['VERB', 0, 0.5], ['NOUN', 0, 1.5],
  ['+', 1, 0], ['-', 1, 1], ['0', 1, 2],
  ['7', 2, 0], ['4', 2, 1], ['1', 2, 2],
  ['8', 3, 0], ['5', 3, 1], ['2', 3, 2],
  ['9', 4, 0], ['6', 4, 1], ['3', 4, 2],
  ['CLR', 5, 0], ['PRO', 5, 1], ['KEY\nREL', 5, 2],
  ['ENTR', 6, 0.5], ['RSET', 6, 1.5],
];
const keyPos = (col, row) => [(col - 3) * KEY_PITCH_X, KEY_Y + (1 - row) * KEY_PITCH_Y];

/**
 * DSKY — display & keyboard. Face 0.203 × 0.216 m.
 * @param {object} [opts] { keyboard=true, variant='LM'|'CM' (CM: ALT/VEL lamps blank) }
 * @returns {{object, width, height, update(vessel, game, dt), pressKey(label), keys}}
 */
export function createDSKY(opts = {}) {
  const variant = opts.variant || 'LM';
  const keyboard = opts.keyboard !== false;
  const group = new THREE.Group();
  group.name = 'DSKY';

  // ---- body: grey case front with the two display windows cut out
  const body = createPanel({
    name: 'DSKY',
    width: W,
    height: H,
    depth: 0.014,
    holes: [
      { x: LAMP_WIN.x, y: LAMP_WIN.y, w: LAMP_WIN.w, h: LAMP_WIN.h, corner: 0.002 },
      { x: EL_WIN.x, y: EL_WIN.y, w: EL_WIN.w, h: EL_WIN.h, corner: 0.002 },
    ],
    screws: [
      [-1, 1], [1, 1], [-1, -1], [1, -1], [0, 1], [0, -1],
    ].map(([sx, sy]) => ({ x: sx * (W / 2 - 0.0055), y: sy * (H / 2 - 0.0052), kind: 'phillips', r: 0.0021 })),
    wear: 0.55,
    pxPerM: 3000,
    cornerRadius: 0.004,
    bevel: 0.0016,
    draw(P) {
      // soft contact shadows / wells around every key
      if (!keyboard) return;
      for (const [, c, r] of KEYS) {
        const [x, y] = keyPos(c, r);
        P.rect(x, y - 0.0006, KEY_SIZE + 0.0034, KEY_SIZE + 0.0034, 'rgba(0,0,0,0.32)', { radius: 0.003 });
        P.rect(x, y - 0.0003, KEY_SIZE + 0.0016, KEY_SIZE + 0.0016, 'rgba(0,0,0,0.35)', { radius: 0.0025 });
      }
      // window frames: thin dark rebate around the display windows
      for (const wdw of [LAMP_WIN, EL_WIN]) P.rect(wdw.x, wdw.y, wdw.w + 0.003, wdw.h + 0.003, 'rgba(0,0,0,0.45)', { radius: 0.0025 });
    },
  });
  group.add(body);

  // dark wells behind the windows
  const wellMat = new THREE.MeshStandardMaterial({ color: 0x060607, roughness: 0.9, side: THREE.BackSide });
  for (const wdw of [LAMP_WIN, EL_WIN]) {
    const well = new THREE.Mesh(new THREE.BoxGeometry(wdw.w, wdw.h, 0.012).translate(wdw.x, wdw.y, -0.006), wellMat);
    group.add(well);
  }

  // ---- caution lamps (left window)
  const lampDisp = createDisplay(LAMP_WIN.w, LAMP_WIN.h, { pxPerM: 6000, roughness: 0.45, intensity: 1.9 });
  lampDisp.mesh.position.set(LAMP_WIN.x, LAMP_WIN.y, -0.0055);
  group.add(lampDisp.mesh);
  const lamps = LAMPS_LM.map(([k, t, c]) => (variant === 'CM' && (k === 'alt' || k === 'vel') ? [null, '', c] : [k, t, c]));
  const lampCell = (i, Wp, Hp) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const mx = Wp * 0.045;
    const my = Hp * 0.03;
    const cw = (Wp - 2 * mx - Wp * 0.04) / 2;
    const ch = (Hp - 2 * my - Hp * 0.012 * 6) / 7;
    const x = mx + col * (cw + Wp * 0.04);
    const y = my + row * (ch + Hp * 0.012);
    return [x, y, cw, ch];
  };
  {
    // unlit look: black mask with frosted pale lenses and dark legends
    const g = lampDisp.base.g;
    const Wp = lampDisp.base.canvas.width;
    const Hp = lampDisp.base.canvas.height;
    g.fillStyle = '#0b0b0c';
    g.fillRect(0, 0, Wp, Hp);
    lamps.forEach(([k, t], i) => {
      const [x, y, cw, ch] = lampCell(i, Wp, Hp);
      const gr = g.createLinearGradient(0, y, 0, y + ch);
      gr.addColorStop(0, '#b9b6ae');
      gr.addColorStop(1, '#a29f98');
      g.fillStyle = gr;
      g.fillRect(x, y, cw, ch);
      if (t) drawText(g, t, x + cw / 2, y + ch / 2, ch * 0.3, { color: '#2a2a2b', lineHeight: 1.05, condense: 0.8 });
      void k;
    });
    lampDisp.base.texture.needsUpdate = true;
  }
  const drawLamps = (state) => {
    lampDisp.redraw((g, Wp, Hp) => {
      lamps.forEach(([k, t, c], i) => {
        if (!k || !state[k]) return;
        const [x, y, cw, ch] = lampCell(i, Wp, Hp);
        g.fillStyle = c === 'amber' ? 'rgb(235,150,24)' : 'rgb(215,208,190)';
        g.fillRect(x, y, cw, ch);
        drawText(g, t, x + cw / 2, y + ch / 2, ch * 0.3, { color: 'rgba(0,0,0,0.85)', lineHeight: 1.05, condense: 0.8 });
      });
    });
  };

  // ---- EL display (right window)
  const el = createDisplay(EL_WIN.w, EL_WIN.h, { pxPerM: 6000, roughness: 0.4, intensity: 1.25 });
  el.mesh.position.set(EL_WIN.x, EL_WIN.y, -0.0055);
  group.add(el.mesh);
  const elW = el.base.canvas.width;
  const elH = el.base.canvas.height;
  const sx = elW / EL_WIN.w; // px per metre
  const M = (m) => m * sx;
  // layout in metres from the window's top-left
  const L = {
    comp: [0.0035, 0.0035, 0.0255, 0.0205],
    progLbl: [0.0545, 0.0035, 0.028, 0.0058],
    progDig: [0.0565, 0.0112],
    verbLbl: [0.0035, 0.0275, 0.028, 0.0058],
    verbDig: [0.0055, 0.0352],
    nounLbl: [0.0545, 0.0275, 0.028, 0.0058],
    nounDig: [0.0565, 0.0352],
    bars: [0.0503, 0.0653, 0.0803],
    regs: [0.0521, 0.0671, 0.0821],
  };
  const DIG_W = 0.0072;
  const DIG_H = 0.0112;
  const DIG_P = 0.0125; // pitch of register characters
  const segOpt = { t: M(0.0014), gap: M(0.00024) };
  const EL_ON = 'rgb(120,255,150)';
  const EL_OFF = '#18201a';
  const EL_LABEL = 'rgb(62,150,80)'; // label blocks are lit less brightly than the numerals
  const EL_LABEL_OFF = '#1d2820';
  const regX0 = 0.0052;
  {
    const g = el.base.g;
    g.fillStyle = '#0c0f0d';
    g.fillRect(0, 0, elW, elH);
    const rr = (r, col) => {
      g.fillStyle = col;
      g.fillRect(M(r[0]), M(r[1]), M(r[2]), M(r[3]));
    };
    rr(L.comp, EL_LABEL_OFF);
    rr(L.progLbl, EL_LABEL_OFF);
    rr(L.verbLbl, EL_LABEL_OFF);
    rr(L.nounLbl, EL_LABEL_OFF);
    for (const y of L.bars) rr([0.004, y, EL_WIN.w - 0.008, 0.0011], EL_LABEL_OFF);
    const off = { ...segOpt, off: EL_OFF };
    for (const [x, y] of [L.progDig, L.verbDig, L.nounDig]) for (let i = 0; i < 2; i++) drawSegChar(el.base.g, ' ', M(x + i * DIG_P), M(y), M(DIG_W), M(DIG_H), off);
    for (const y of L.regs) {
      drawSegChar(g, ' ', M(regX0), M(y), M(DIG_W), M(DIG_H), { ...off, sign: true });
      for (let i = 1; i < 6; i++) drawSegChar(g, ' ', M(regX0 + i * DIG_P), M(y), M(DIG_W), M(DIG_H), off);
    }
    el.base.texture.needsUpdate = true;
  }
  const drawEL = (s) => {
    el.redraw((g) => {
      g.shadowColor = 'rgba(120,255,150,0.45)';
      g.shadowBlur = M(0.00025);
      const lbl = (r, text) => {
        g.fillStyle = EL_LABEL;
        g.fillRect(M(r[0]), M(r[1]), M(r[2]), M(r[3]));
        g.save();
        g.shadowBlur = 0;
        drawText(g, text, M(r[0] + r[2] / 2), M(r[1] + r[3] / 2), M(Math.min(r[3] * 0.72, 0.0046)), { color: '#07100a', lineHeight: 1.1, condense: 0.86 });
        g.restore();
      };
      if (!s.power) return;
      lbl(L.progLbl, 'PROG');
      lbl(L.verbLbl, 'VERB');
      lbl(L.nounLbl, 'NOUN');
      g.fillStyle = EL_ON;
      for (const y of L.bars) g.fillRect(M(0.004), M(y), M(EL_WIN.w - 0.008), M(0.0011));
      const on = { ...segOpt, on: EL_ON };
      const pair = (str, [x, y]) => {
        const t = (str ?? '').padStart(2, ' ').slice(-2);
        for (let i = 0; i < 2; i++) drawSegChar(g, t[i], M(x + i * DIG_P), M(y), M(DIG_W), M(DIG_H), on);
      };
      pair(s.prog, L.progDig);
      if (s.vnOn) {
        pair(s.verb, L.verbDig);
        pair(s.noun, L.nounDig);
      }
      [s.r1, s.r2, s.r3].forEach((r, k) => {
        if (!r) return;
        const str = String(r).padEnd(6, ' ').slice(0, 6);
        const y = L.regs[k];
        const sign = str[0];
        if (sign === '+' || sign === '-') drawSegChar(g, sign, M(regX0), M(y), M(DIG_W), M(DIG_H), { ...on, sign: true });
        for (let i = 1; i < 6; i++) drawSegChar(g, str[i], M(regX0 + i * DIG_P), M(y), M(DIG_W), M(DIG_H), on);
      });
    });
  };

  // COMP ACTY: its own small EL element (it flickers at ~10 Hz while the computer is busy)
  const compW = L.comp[2];
  const compH = L.comp[3];
  const comp = createDisplay(compW, compH, { pxPerM: 6000, roughness: 0.4, intensity: 1.25 });
  comp.mesh.position.set(EL_WIN.x - EL_WIN.w / 2 + L.comp[0] + compW / 2, EL_WIN.y + EL_WIN.h / 2 - L.comp[1] - compH / 2, -0.0054);
  group.add(comp.mesh);
  {
    const g = comp.base.g;
    g.fillStyle = EL_LABEL_OFF;
    g.fillRect(0, 0, comp.base.canvas.width, comp.base.canvas.height);
    comp.base.texture.needsUpdate = true;
    comp.redraw((gg, Wc, Hc) => {
      gg.fillStyle = EL_LABEL;
      gg.fillRect(0, 0, Wc, Hc);
      drawText(gg, 'COMP\nACTY', Wc / 2, Hc / 2, Hc * 0.26, { color: '#07100a', lineHeight: 1.1, condense: 0.86 });
    });
    comp.setBrightness(0);
  }

  // glass over both windows
  for (const wdw of [LAMP_WIN, EL_WIN]) {
    const gl = createGlass(wdw.w, wdw.h, -0.0012);
    gl.position.set(wdw.x, wdw.y, -0.0012);
    group.add(gl);
  }

  // ---- keyboard
  const keys = new Map();
  if (keyboard) {
    const KW = 0.2;
    const KH = 0.098;
    const KP = createPainter(KW, KH, { pxPerM: 4000, color: 0x6c6f70, roughness: 0.5 });
    const kx = (x) => x;
    const ky = (y) => y - KEY_Y;
    for (const [label, c, r] of KEYS) {
      const [x, y] = keyPos(c, r);
      // slightly convex cap: light at the top edge, darker at the bottom
      const X0 = KP.X(kx(x) - KEY_SIZE / 2);
      const Y0 = KP.Y(ky(y) + KEY_SIZE / 2);
      const s = KP.px(KEY_SIZE);
      const gr = KP.g.createLinearGradient(0, Y0, 0, Y0 + s);
      gr.addColorStop(0, '#7b7e80');
      gr.addColorStop(0.5, '#6c6f70');
      gr.addColorStop(1, '#5d6061');
      KP.g.fillStyle = gr;
      KP.g.fillRect(X0, Y0, s, s);
      const digit = /^[0-9+-]$/.test(label);
      const txt = label === '-' ? '−' : label;
      KP.text(txt, kx(x), ky(y), digit ? 0.0096 : label.includes('\n') ? 0.0041 : 0.0046, { condense: digit ? 1 : 0.86, lineHeight: 1.15, weight: 'bold' });
    }
    KP.wear(0.4, 991, KEYS.map(([, c, r]) => keyPos(c, r)).map(([x, y]) => [x, y - KEY_Y]));
    KP.commit();
    const keyMat = createPaintedMaterial(KP, { bumpScale: 0.3 });
    for (const [label, c, r] of KEYS) {
      const [x, y] = keyPos(c, r);
      const geo = roundedSlab(KEY_SIZE, KEY_SIZE, 0.0075, 0.0022, 0.0011, 0.0075);
      // map planar UVs into the keyboard texture
      const uv = geo.attributes.uv;
      const p = geo.attributes.position;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, (p.getX(i) + x) / KW + 0.5, (p.getY(i) + y - KEY_Y) / KH + 0.5);
      const m = new THREE.Mesh(geo, keyMat);
      m.position.set(x, y, 0);
      m.castShadow = true;
      m.receiveShadow = true;
      m.name = 'key:' + label.replace('\n', ' ');
      group.add(m);
      keys.set(label.replace('\n', ' '), { mesh: m, t: 0 });
    }
  }

  // ---- behaviour
  const lim = limiter(30);
  let flashT = 0;
  let lastKey = '';
  let lastLamps = '';
  let lastComp = null;
  let sub = null;
  let myVessel = null;
  const queue = [];
  let queueT = 0;
  /** Animate a key press ('VERB', 'NOUN', '0'..'9', '+', '-', 'CLR', 'PRO', 'KEY REL', 'ENTR', 'RSET'). */
  const pressKey = (label) => {
    const k = keys.get(label);
    if (k) k.t = 0.14;
  };
  const typeSeq = (labels) => {
    queue.push(...labels);
  };
  function subscribe(game) {
    if (sub || !game?.events) return;
    sub = game.events.on('action', (a) => {
      if (!myVessel || game.activeId !== myVessel.id) return;
      if (a.name === 'PRO') pressKey('PRO');
      else if (a.name === 'MASTER_ALARM_RESET') pressKey('RSET');
      else if (a.name === 'PROGRAM' && a.program) {
        const nn = String(a.program).replace(/^P/, '').padStart(2, '0');
        typeSeq(['VERB', '3', '7', 'ENTR', nn[0], nn[1], 'ENTR']);
      }
    });
  }

  drawLamps({});
  drawEL({ power: true, prog: '', verb: '', noun: '', vnOn: true });

  function update(vessel, game, dt) {
    myVessel = vessel;
    subscribe(game);
    // key animation runs every frame (smooth)
    if (keys.size) {
      if (queue.length) {
        queueT -= dt;
        if (queueT <= 0) {
          pressKey(queue.shift());
          queueT = 0.17;
        }
      }
      for (const k of keys.values()) {
        if (k.t > 0) {
          k.t -= dt;
          k.mesh.position.z = -0.0022;
        } else if (k.mesh.position.z !== 0) k.mesh.position.z = 0;
      }
    }
    const e = lim.tick(dt);
    if (!e) return;
    flashT += e;
    const agc = vessel?.agc;
    if (!agc) return;
    const flash = !!agc.flashVerbNoun;
    const vnOn = !flash || flashT % 0.64 < 0.4; // ~1.5 Hz flash
    const L2 = agc.lights || {};
    const s = {
      power: true,
      compActy: !!L2.compActy,
      prog: agc.prog,
      verb: agc.verb,
      noun: agc.noun,
      r1: agc.r1,
      r2: agc.r2,
      r3: agc.r3,
      vnOn,
    };
    if (s.compActy !== lastComp) {
      lastComp = s.compActy;
      comp.setBrightness(s.compActy ? 1 : 0);
    }
    const key = `${s.prog}|${s.verb}|${s.noun}|${s.r1}|${s.r2}|${s.r3}|${vnOn}`;
    if (key !== lastKey) {
      lastKey = key;
      drawEL(s);
    }
    const lampKey = lamps.map(([k]) => (k && L2[k] ? 1 : 0)).join('');
    if (lampKey !== lastLamps) {
      lastLamps = lampKey;
      drawLamps(L2);
    }
  }

  void createCanvasTexture;
  void COLORS;
  return finish(group, W, H, update, { pressKey, keys });
}
