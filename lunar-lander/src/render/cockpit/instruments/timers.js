// Mission timer (HHH:MM:SS) and event timer (MM:SS): red 7-segment readouts behind a dark red
// filter window in a grey bezel.
import { THREE, createCase, createDisplay, drawSegChar, drawColon, limiter, finish } from './common.js';
import { formatMET, formatMMSS } from './math.js';

const PALETTES = {
  red: { on: 'rgb(255,52,26)', off: '#2a0d0a', glow: 'rgba(255,40,20,0.7)', bg0: '#160605', bg1: '#0c0302', slant: 0.09 },
  el: { on: 'rgb(120,255,150)', off: '#18201a', glow: 'rgba(120,255,150,0.45)', bg0: '#0d100e', bg1: '#090b0a', slant: 0 },
};

/**
 * Build a digit-clock display. layout: string like 'DDD:DD:DD' (D = digit, ':' = colon).
 * Returns { group, set(text) } where text has the same layout with digits or spaces.
 */
function createClock(o) {
  const { width: W, height: H, layout, label } = o;
  const pal = PALETTES[o.color] || PALETTES.red;
  const RED_ON = pal.on;
  const RED_OFF = pal.off;
  const SLANT = pal.slant;
  const fr = 0.005;
  const winW = W - 2 * fr - 0.012;
  const winH = o.winH ?? H - 2 * fr - 0.012;
  const wy = o.winY ?? -0.0035;
  const { group } = createCase({
    width: W,
    height: H,
    frame: fr,
    holes: [{ x: 0, y: wy, w: winW, h: winH, corner: 0.0015 }],
    faceSpec: {
      draw(P) {
        if (label) P.text(label, 0, wy + winH / 2 + 0.0043, 0.0036);
      },
    },
    depth: 0.03,
  });
  const disp = createDisplay(winW, winH, { pxPerM: 6000, roughness: 0.25 });
  disp.mesh.position.set(0, wy, -0.003);
  group.add(disp.mesh);
  const Wp = disp.base.canvas.width;
  const Hp = disp.base.canvas.height;
  // character geometry
  const nd = [...layout].filter((c) => c === 'D').length;
  const nc = [...layout].filter((c) => c === ':').length;
  const dh = Hp * 0.66;
  const dw = dh * 0.56;
  const colW = dw * 0.55;
  const pitch = dw * 1.3;
  const total = nd * pitch + nc * colW - (pitch - dw);
  const x0 = (Wp - total) / 2 - dh * Math.tan(SLANT) * 0.5;
  const y0 = (Hp - dh) / 2;
  const segs = { t: dw * 0.17, gap: dw * 0.03, slant: SLANT };
  const drawAll = (g, text, on) => {
    let x = x0;
    let k = 0;
    for (const c of layout) {
      if (c === 'D') {
        drawSegChar(g, on ? text[k] ?? ' ' : '8', x, y0, dw, dh, on ? { ...segs, on: RED_ON } : { ...segs, off: RED_OFF });
        x += pitch;
      } else {
        drawColon(g, x + (colW - (pitch - dw)) / 2, y0, dh, dw * 0.1, on ? RED_ON : RED_OFF, SLANT);
        x += colW;
      }
      k++;
    }
  };
  // base: dark red filter glass with faint unlit segments
  {
    const g = disp.base.g;
    const gr = g.createLinearGradient(0, 0, 0, Hp);
    gr.addColorStop(0, pal.bg0);
    gr.addColorStop(1, pal.bg1);
    g.fillStyle = gr;
    g.fillRect(0, 0, Wp, Hp);
    drawAll(g, '', false);
    disp.base.texture.needsUpdate = true;
  }
  let last = null;
  return {
    group,
    set(text) {
      if (text === last) return;
      last = text;
      disp.redraw((g) => {
        g.shadowColor = pal.glow;
        g.shadowBlur = dw * 0.12;
        const t = [...text];
        let k = 0;
        let x = x0;
        for (const c of layout) {
          if (c === 'D') {
            drawSegChar(g, t[k] ?? ' ', x, y0, dw, dh, { ...segs, on: RED_ON });
            x += pitch;
          } else {
            drawColon(g, x + (colW - (pitch - dw)) / 2, y0, dh, dw * 0.1, RED_ON, SLANT);
            x += colW;
          }
          k++;
        }
      });
    },
  };
}

/**
 * Mission timer: red 7-segment HHH:MM:SS from game.time.met. 0.20 × 0.055 m.
 * opts: { label='MISSION TIMER' (false = none), color: 'red' | 'el' (green electroluminescent) }
 */
export function createMissionTimer(opts = {}) {
  const c = createClock({ width: 0.2, height: 0.055, layout: 'DDD:DD:DD', label: opts.label === false ? null : opts.label ?? 'MISSION TIMER', winH: 0.029, winY: -0.004, color: opts.color });
  const lim = limiter(30);
  function update(vessel, game, dt) {
    if (!lim.tick(dt)) return;
    c.set(formatMET(game?.time?.met ?? 0));
  }
  return finish(c.group, 0.2, 0.055, update);
}

/**
 * Event timer: red 7-segment MM:SS. 0.12 × 0.05 m.
 * Counts DOWN to the next ignition when vessel.gnc.tig (MET s) is in the future, otherwise UP from the
 * last main-engine ignition of this vessel (from 'engine' events / mainEngine.firing), otherwise from
 * the scenario start. vessel.eventTimer (s, if a module sets it) overrides everything.
 * opts: { label='EVENT TIMER' (false = none), color: 'red' | 'el' }
 */
export function createEventTimer(opts = {}) {
  const c = createClock({ width: 0.12, height: 0.05, layout: 'DD:DD', label: opts.label === false ? null : opts.label ?? 'EVENT TIMER', winH: 0.026, winY: -0.004, color: opts.color });
  const lim = limiter(30);
  let t0 = null;
  let wasFiring = false;
  let sub = null;
  let myId = null;
  function update(vessel, game, dt) {
    if (!lim.tick(dt) || !vessel) return;
    myId = vessel.id;
    const met = game?.time?.met ?? 0;
    if (!sub && game?.events) {
      sub = [
        game.events.on('engine', (e) => {
          if (e.vessel === myId && e.on) t0 = game.time.met;
        }),
        game.events.on('scenario', () => {
          t0 = game.time.met;
        }),
      ];
    }
    const firing = !!vessel.mainEngine?.firing;
    if (firing && !wasFiring) t0 = met;
    wasFiring = firing;
    if (t0 == null) t0 = met;
    let secs;
    const tig = vessel.gnc?.tig;
    if (Number.isFinite(vessel.eventTimer)) secs = vessel.eventTimer;
    else if (Number.isFinite(tig) && tig > met) secs = tig - met; // countdown to ignition
    else secs = met - t0;
    c.set(formatMMSS(secs));
  }
  return finish(c.group, 0.12, 0.05, update);
}

void THREE;
