// Caution & warning annunciator matrix, MASTER ALARM push-button light, LUNAR CONTACT lights.
import { THREE, createDisplay, drawText, limiter, finish, createGlass, getMaterial, createPanel } from './common.js';
import { createLampFace, roundedSlab, LAMP_COLORS } from '../kit/index.js';

const rgb = (name, k = 1) => {
  const c = LAMP_COLORS[name] || LAMP_COLORS.white;
  return `rgb(${Math.round(Math.min(1, c.r * k) * 255)},${Math.round(Math.min(1, c.g * k) * 255)},${Math.round(Math.min(1, c.b * k) * 255)})`;
};

/**
 * Caution & warning annunciator matrix.
 * opts: { labels: [{ text: 'DES QTY', key: 'DES QTY', color: 'amber'|'red'|'white'|'blue'|'green' }],
 *   cols=4, cellW=0.04, cellH=0.018, style: 'legend' (lit letters on black, LM C&W) | 'block' (whole
 *   lens glows, dark letters), getLit(key, vessel) optional override }
 * Size: cols*cellW × rows*cellH. Light i is lit when vessel.cw.lights[labels[i].key] is truthy.
 * @returns {{object, width, height, update, setTest(on)}}
 */
export function createAnnunciatorPanel(opts = {}) {
  const labels = opts.labels || [];
  const cols = opts.cols || 4;
  const rows = Math.max(1, Math.ceil(labels.length / cols));
  const cw = opts.cellW || 0.04;
  const ch = opts.cellH || 0.018;
  const W = cols * cw;
  const H = rows * ch;
  const style = opts.style || 'legend';
  const group = new THREE.Group();
  group.name = 'Annunciator';
  // black housing (slightly larger face plate, front at z = 0)
  const face = createPanel({ width: W, height: H, depth: 0.008, color: 0x111213, roughness: 0.7, wear: 0.1, screws: [], bevel: 0.0008, cornerRadius: 0.0015, pxPerM: 1500 });
  group.add(face);
  const inset = 0.0022;
  const disp = createDisplay(W - 2 * inset, H - 2 * inset, { pxPerM: 7000, roughness: 0.35 });
  disp.mesh.position.z = 0.0003;
  group.add(disp.mesh);
  const Wp = disp.base.canvas.width;
  const Hp = disp.base.canvas.height;
  const cWp = Wp / cols;
  const cHp = Hp / rows;
  const sep = Math.max(2, cHp * 0.08);
  const cell = (i) => [(i % cols) * cWp + sep / 2, Math.floor(i / cols) * cHp + sep / 2, cWp - sep, cHp - sep];
  const fontFor = (text) => {
    const n = String(text).split('\n').length;
    return Math.min((cHp * 0.62) / n / 1.05, cWp * 0.16);
  };
  {
    const g = disp.base.g;
    g.fillStyle = '#050505';
    g.fillRect(0, 0, Wp, Hp);
    labels.forEach((l, i) => {
      const [x, y, w, h] = cell(i);
      const gr = g.createLinearGradient(0, y, 0, y + h);
      if (style === 'block') {
        gr.addColorStop(0, '#b8b5ad');
        gr.addColorStop(1, '#a19e97');
      } else {
        gr.addColorStop(0, '#1b1b1c');
        gr.addColorStop(1, '#121213');
      }
      g.fillStyle = gr;
      g.fillRect(x, y, w, h);
      if (l.text) drawText(g, l.text, x + w / 2, y + h / 2, fontFor(l.text), { color: style === 'block' ? '#2a2a2a' : 'rgba(135,132,126,0.55)', lineHeight: 1.05, condense: 0.8 });
    });
    disp.base.texture.needsUpdate = true;
  }
  const draw = (lit) => {
    disp.redraw((g) => {
      labels.forEach((l, i) => {
        if (!lit[i]) return;
        const [x, y, w, h] = cell(i);
        const col = l.color || 'amber';
        if (style === 'block') {
          g.fillStyle = rgb(col, 1.1);
          g.fillRect(x, y, w, h);
          drawText(g, l.text, x + w / 2, y + h / 2, fontFor(l.text), { color: 'rgba(0,0,0,0.85)', lineHeight: 1.05, condense: 0.8 });
        } else {
          g.fillStyle = rgb(col, 0.14);
          g.fillRect(x, y, w, h);
          g.shadowColor = rgb(col);
          g.shadowBlur = cHp * 0.08;
          drawText(g, l.text, x + w / 2, y + h / 2, fontFor(l.text), { color: rgb(col, 1.25), lineHeight: 1.05, condense: 0.8 });
          g.shadowBlur = 0;
        }
      });
    });
  };
  const glass = createGlass(W - 2 * inset, H - 2 * inset, 0.0012);
  group.add(glass);
  const lim = limiter(30);
  let lastKey = null;
  let test = false;
  draw([]);
  function update(vessel, game, dt) {
    if (!lim.tick(dt) || !vessel) return;
    const L = vessel.cw?.lights || {};
    const lit = labels.map((l) => test || !!(opts.getLit ? opts.getLit(l.key ?? l.text, vessel) : L[l.key ?? l.text]));
    const key = lit.map((b) => (b ? 1 : 0)).join('');
    if (key !== lastKey) {
      lastKey = key;
      draw(lit);
    }
    void game;
  }
  return finish(group, W, H, update, { setTest: (on) => { test = !!on; lastKey = null; } });
}

/**
 * Square lit push-button light (MASTER ALARM / other). Returns { object, setLit, press(down) }.
 */
function lampButton(label, size, color, tone = 'light') {
  const group = new THREE.Group();
  const bez = new THREE.Mesh(roundedSlab(size, size, 0.005, 0.003, 0.0008, 0.005), getMaterial('blackPaint'));
  bez.castShadow = bez.receiveShadow = true;
  group.add(bez);
  const cs = size * 0.78;
  const face = createLampFace(label, cs, cs, { style: 'block', color, tone, pxPerM: 7000 });
  const cap = new THREE.Mesh(roundedSlab(cs, cs, 0.005, 0.0015, 0.0008, 0.0085), face.material);
  cap.castShadow = cap.receiveShadow = true;
  group.add(cap);
  group.add(createGlass(cs * 0.98, cs * 0.98, 0.00855));
  return {
    object: group,
    setLit: face.setLit,
    press(down) {
      cap.position.z = down ? -0.0018 : 0;
    },
  };
}

/**
 * MASTER ALARM push-button light: red, lit while vessel.cw.masterAlarm. 0.045 × 0.045 m.
 * The cap depresses when the crew resets it (MASTER_ALARM_RESET action).
 * opts: { flash=false (flash at 2 Hz instead of steady), size=0.045 }
 */
export function createMasterAlarm(opts = {}) {
  const size = opts.size || 0.045;
  const b = lampButton('MASTER\nALARM', size, 'red', 'light');
  const lim = limiter(30);
  let t = 0;
  let pressT = 0;
  let sub = null;
  let myId = null;
  let last = null;
  function update(vessel, game, dt) {
    if (pressT > 0) {
      pressT -= dt;
      b.press(pressT > 0);
    }
    const e = lim.tick(dt);
    if (!e || !vessel) return;
    myId = vessel.id;
    if (!sub && game?.events) {
      sub = game.events.on('action', (a) => {
        if (a.name === 'MASTER_ALARM_RESET' && game.activeId === myId) pressT = 0.18;
      });
    }
    t += e;
    const on = !!vessel.cw?.masterAlarm && (!opts.flash || t % 0.5 < 0.3);
    if (on !== last) {
      last = on;
      b.setLit(on);
    }
  }
  return finish(b.object, size, size, update);
}

/**
 * Pair of blue LUNAR CONTACT lights, lit on probe contact (vessel.gear.probeContact or
 * cw.lights['LUNAR CONTACT']). 0.09 × 0.03 m.
 */
export function createContactLights(opts = {}) {
  const W = 0.09;
  const H = 0.03;
  const group = new THREE.Group();
  group.name = 'ContactLights';
  const plate = createPanel({ width: W, height: H, depth: 0.004, screws: [], wear: 0.3, pxPerM: 2400, bevel: 0.0008 });
  group.add(plate);
  const faces = [];
  for (const sx of [-1, 1]) {
    const bez = new THREE.Mesh(roundedSlab(0.04, 0.024, 0.004, 0.002, 0.0006, 0.004), getMaterial('blackPaint'));
    bez.position.x = sx * 0.0215;
    bez.castShadow = bez.receiveShadow = true;
    group.add(bez);
    const f = createLampFace(opts.label || 'LUNAR\nCONTACT', 0.034, 0.018, { style: 'block', color: 'blue', tone: 'light', pxPerM: 7000 });
    const cap = new THREE.Mesh(roundedSlab(0.034, 0.018, 0.003, 0.001, 0.0006, 0.0062), f.material);
    cap.position.x = sx * 0.0215;
    group.add(cap);
    const gl = createGlass(0.0335, 0.0175, 0.00625);
    gl.position.x = sx * 0.0215;
    group.add(gl);
    faces.push(f);
  }
  const lim = limiter(30);
  let last = null;
  function update(vessel, game, dt) {
    if (!lim.tick(dt) || !vessel) return;
    const on = !!(vessel.gear?.probeContact || vessel.cw?.lights?.['LUNAR CONTACT']);
    if (on !== last) {
      last = on;
      for (const f of faces) f.setLit(on);
    }
    void game;
  }
  return finish(group, W, H, update);
}
