// LM crew compartment panels (LM-CABIN agent): Apollo 11 LM-5 "Eagle" control & display panels
// built with the cockpit kit (grey panels, printed legends, instanced toggles & breakers) and the
// live instruments (FDAIs, tapes, X-pointers, timers, C&W, DSKY...).
//
//   1A/1B  CDR flight displays: X-POINTER, C&W, MASTER ALARM, LUNAR CONTACT, EVENT TIMER, T/W +
//          THRUST, PRPLNT QTY, ENGINE THRUST CONT; FDAI + ALT/ALT RATE tapes
//   ABORT  ABORT / ABORT STAGE guarded push buttons between panels 1 and 2
//   2A/2B  LMP: X-POINTER, C&W, MASTER ALARM, MISSION TIMER, LUNAR CONTACT, RCS meters, RCS
//          valves & talkbacks; FDAI + ECS meters
//   3L/3R  radar, stabilisation & control (ATTITUDE CONTROL, GUID CONT, MODE CONT, DEADBAND...)
//   4      DSKY
//   5      CDR: ENGINE STOP/START, +X, mission/event timer controls, lighting
//   6      LMP: AGS DEDA, AGS power, lighting
//   8      CDR left console: audio, EXPLOSIVE DEVICES (red guards)
//   11/16  circuit breakers (CDR overhead-left, LMP right)
//   12     LMP communications, S-band signal strength
//   14     EPS: volts/amps, battery switches with talkbacks
//   ECS    suit/cabin loop controls (aft right)
import * as THREE from 'three';
import * as KIT from '../kit/index.js';
import * as INS from '../instruments/index.js';
import { FT } from '../../../core/constants.js';
import { panelLayout } from './layout.js';
import { applyFrame } from './geom.js';

const T3 = (...p) => p; // positions helper for readability

/**
 * AGS DEDA keyboard: 16 keys (4 x 4) as ONE merged mesh with a legend texture (the kit's lit push
 * buttons would cost ~50 draw calls for keys that never light up).
 */
function dedaKeypad() {
  const keys = [['+', '7', '8', '9'], ['-', '4', '5', '6'], ['0', '1', '2', '3'], ['CLR', 'READ\nOUT', 'ENTR', 'HOLD']];
  const px = 0.033;
  const py = 0.029;
  const W = px * 4;
  const H = py * 4;
  const tex = KIT.createCanvasTexture(W, H, 4000);
  const g = tex.g;
  const s = tex.canvas.width / W;
  g.fillStyle = '#1b1c1d';
  g.fillRect(0, 0, tex.canvas.width, tex.canvas.height);
  const geos = [];
  keys.forEach((row, r) => row.forEach((k, c) => {
    const x = (c - 1.5) * px;
    const y = (1.5 - r) * py;
    const cap = new THREE.BoxGeometry(0.024, 0.02, 0.006, 1, 1, 1);
    cap.translate(x, y, 0.003);
    geos.push(cap);
    // key top: dark grey plastic, white engraved legend
    const cx = (x + W / 2) * s;
    const cy = (H / 2 - y) * s;
    g.fillStyle = '#35373a';
    g.fillRect(cx - 0.0115 * s, cy - 0.0095 * s, 0.023 * s, 0.019 * s);
    KIT.drawText(g, k, cx, cy, (k.length > 2 ? 0.0036 : 0.0068) * s, { color: '#eeeeea', lineHeight: 1.05 });
  }));
  tex.texture.needsUpdate = true;
  // planar UV over the keypad (front faces carry the legends)
  const merged = mergeBoxes(geos, W, H);
  const mat = new THREE.MeshStandardMaterial({ map: tex.texture, roughness: 0.55, metalness: 0.05, name: 'lmcabin:deda' });
  const mesh = new THREE.Mesh(merged, mat);
  mesh.name = 'DEDA keypad';
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}

function mergeBoxes(geos, W, H) {
  const pos = [];
  const nor = [];
  const uv = [];
  const idx = [];
  let base = 0;
  for (const g of geos) {
    const p = g.attributes.position;
    const n = g.attributes.normal;
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      nor.push(n.getX(i), n.getY(i), n.getZ(i));
      uv.push(p.getX(i) / W + 0.5, p.getY(i) / H + 0.5);
    }
    for (let i = 0; i < g.index.count; i++) idx.push(g.index.getX(i) + base);
    base += p.count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  out.setIndex(idx);
  return out;
}

/**
 * Build all panels and instruments.
 * @returns {{group: THREE.Group, instruments: Array<{update: Function}>, controls: Map<string, object>,
 *   panels: Object<string, THREE.Group>, buttons: object}}
 */
export function buildPanels() {
  const L = panelLayout();
  const group = new THREE.Group();
  group.name = 'LMCabin:panels';
  const instruments = [];
  const controls = new Map();
  const panels = {};

  /** Create a panel from spec at a layout slot, mount instruments ({inst, x, y}) through cut-outs. */
  function panel(id, spec, mounts = []) {
    const slot = L[id];
    const holes = [...(spec.holes || [])];
    for (const m of mounts) holes.push({ x: m.x, y: m.y, w: m.inst.mountHole.w, h: m.inst.mountHole.h, corner: 0.002 });
    const p = KIT.createPanel({ width: slot.w, height: slot.h, depth: 0.012, pxPerM: 2600, screws: 'dzus', name: `PANEL ${id}`, ...spec, holes });
    for (const m of mounts) {
      m.inst.object.position.set(m.x, m.y, 0);
      p.add(m.inst.object);
      instruments.push(m.inst);
    }
    applyFrame(p, slot.frame.matrix);
    group.add(p);
    panels[id] = p;
    for (const [k, v] of p.controls) controls.set(k, v);
    return p;
  }

  // ------------------------------------------------------------------ CDR C&W labels (panel 1) / LMP (panel 2)
  const cw1 = [
    ['ABORT', 'red'], ['ASC PRESS', 'red'], ['DES REG', 'red'], ['CES AC', 'red'],
    ['CES DC', 'red'], ['AGS', 'red'], ['LGC', 'red'], ['ISS', 'red'],
    ['ASC HI\nREG', 'red'], ['DES QTY', 'amber'], ['ENG FIRE', 'red'], ['RCS TCA', 'red'],
    ['PRE-\nAMPS', 'amber'], ['ASC QTY', 'amber'], ['INVERTER', 'amber'], ['DC BUS', 'red'],
  ].map(([text, color]) => ({ text, key: text.replace('\n', ' ').replace('- ', '-'), color }));
  const cw2 = [
    ['RCS', 'amber'], ['HEATER', 'amber'], ['C/W PWR', 'amber'], ['ECS', 'amber'],
    ['O2 QTY', 'amber'], ['GLYCOL', 'amber'], ['SUIT/FAN', 'amber'], ['CO2 HI', 'amber'],
    ['H2O SEP', 'amber'], ['ALT', 'amber'], ['VEL', 'amber'], ['RR', 'amber'],
    ['LDG RDR', 'amber'], ['S-BD RCVR', 'amber'], ['BATTERY', 'amber'], ['PGNS', 'amber'],
  ].map(([text, color]) => ({ text, key: text.replace('\n', ' '), color }));

  // ------------------------------------------------------------------ panel 1B: FDAI + tapes
  {
    const fdai = INS.createFDAI({ size: 0.19 });
    const tapes = INS.createAltTapes();
    panel('p1B', {
      labels: [{ text: 'RANGE/ALT', x: 0.105, y: 0.104, size: 0.0036 }, { text: 'PANEL 1', x: 0.105, y: -0.1, size: 0.003 }],
      screws: [T3(-0.176, 0.106), T3(0.176, 0.106), T3(-0.176, -0.106), T3(0.176, -0.106)].map(([x, y]) => ({ x, y, kind: 'dzus' })),
    }, [{ inst: fdai, x: -0.075, y: 0 }, { inst: tapes, x: 0.105, y: 0.012 }]);
  }

  // ------------------------------------------------------------------ panel 1A: CDR outboard
  {
    const xp = INS.createCrossPointer({ size: 0.11 });
    const ann = INS.createAnnunciatorPanel({ labels: cw1, cols: 4, cellW: 0.036, cellH: 0.017 });
    const ma = INS.createMasterAlarm({ size: 0.042 });
    const contact = INS.createContactLights();
    const et = INS.createEventTimer();
    const thr = INS.createThrustIndicator();
    const fuel = INS.createDigitalReadout({ digits: 2, label: 'FUEL %', getValue: (v) => (v.staged ? v.propellant.main / Math.max(1, v.propellant.mainMax) : v.propellant.main / Math.max(1, v.propellant.mainMax)) * 99, width: 0.06, height: 0.032 });
    const oxid = INS.createDigitalReadout({ digits: 2, label: 'OXID %', getValue: (v) => Math.max(0, (v.propellant.main / Math.max(1, v.propellant.mainMax)) * 99 - 0.6), width: 0.06, height: 0.032 });
    panel('p1A', {
      boxes: [
        { x: 0, y: 0.19, w: 0.29, h: 0.13, title: 'X-POINTER' },
        { x: 0, y: -0.215, w: 0.29, h: 0.085, title: 'ENGINE THRUST CONT' },
        { x: 0.085, y: -0.083, w: 0.09, h: 0.11, title: 'PRPLNT QTY' },
      ],
      switches: [
        { id: 'xpScaleCDR', x: -0.113, y: 0.175, label: 'SCALE', positions: ['HI\nMULT', 'LO\nMULT'], state: 1 },
        { id: 'rateErrCDR', x: 0.113, y: 0.175, label: 'RATE/ERR\nMON', positions: ['LDG\nRDR', 'RNDZ'], state: 0 },
        { id: 'engArm', x: -0.105, y: -0.225, label: 'ENG ARM', positions: ['ASC', 'OFF', 'DES'], state: 2, guard: 'grey' },
        { id: 'thrCont', x: -0.035, y: -0.225, label: 'THR CONT', positions: ['AUTO', 'MAN'], state: 0 },
        { id: 'manThrot', x: 0.035, y: -0.225, label: 'MAN THROT', positions: ['CDR', 'LMP'], state: 0 },
        { id: 'engGmbl', x: 0.105, y: -0.225, label: 'ENG GMBL', positions: ['ENABLE', 'OFF'], state: 0, guard: 'grey' },
      ],
    }, [
      { inst: xp, x: 0, y: 0.19 },
      { inst: ann, x: -0.045, y: 0.085 },
      { inst: ma, x: 0.105, y: 0.085 },
      { inst: contact, x: -0.075, y: 0.013 },
      { inst: et, x: 0.075, y: 0.013 },
      { inst: thr, x: -0.075, y: -0.085 },
      { inst: fuel, x: 0.085, y: -0.07 },
      { inst: oxid, x: 0.085, y: -0.115 },
    ]);
  }

  // ------------------------------------------------------------------ panel 2B: LMP FDAI + ECS meters
  {
    const fdai = INS.createFDAI({ size: 0.19 });
    const g = (label, min, max, ticks, get, redline, units) =>
      INS.createGauge({ kind: 'vertical', label, min, max, ticks, getValue: get, redline, units, width: 0.045, height: 0.16 });
    const suitP = g('SUIT\nPRESS', 0, 5, [0, 1, 2, 3, 4, 5], (v, gm) => 4.8 + 0.02 * Math.sin(gm.time.met * 0.1), [0, 3.5], 'PSIA');
    const cabP = g('CABIN\nPRESS', 0, 5, [0, 1, 2, 3, 4, 5], (v, gm) => 4.9 + 0.02 * Math.sin(gm.time.met * 0.07), [0, 4.2], 'PSIA');
    const suitT = g('SUIT\nTEMP', 20, 100, [20, 40, 60, 80, 100], (v, gm) => 52 + Math.sin(gm.time.met * 0.01), null, '°F');
    panel('p2B', {
      boxes: [{ x: -0.105, y: 0.004, w: 0.158, h: 0.212, title: 'ENVIRONMENTAL CONT' }],
      screws: [T3(-0.176, 0.106), T3(0.176, 0.106), T3(-0.176, -0.106), T3(0.176, -0.106)].map(([x, y]) => ({ x, y, kind: 'dzus' })),
    }, [
      { inst: fdai, x: 0.075, y: 0 },
      { inst: suitT, x: -0.155, y: -0.004 },
      { inst: suitP, x: -0.105, y: -0.004 },
      { inst: cabP, x: -0.055, y: -0.004 },
    ]);
  }

  // ------------------------------------------------------------------ panel 2A: LMP outboard
  {
    const xp = INS.createCrossPointer({ size: 0.11 });
    const ann = INS.createAnnunciatorPanel({ labels: cw2, cols: 4, cellW: 0.036, cellH: 0.017 });
    const ma = INS.createMasterAlarm({ size: 0.042 });
    const contact = INS.createContactLights();
    const mt = INS.createMissionTimer();
    const g = (label, min, max, ticks, get, redline, units) =>
      INS.createGauge({ kind: 'vertical', label, min, max, ticks, getValue: get, redline, units, width: 0.045, height: 0.1 });
    const rcsT = g('TEMP', 20, 100, [20, 60, 100], () => 68, [20, 30], '°F');
    const rcsP = g('PRESS', 0, 400, [0, 200, 400], (v) => (v.propellant.rcs > 1 ? 178 : 20), [0, 150], 'PSIA');
    const rcsQ = g('QTY', 0, 100, [0, 50, 100], (v) => (v.propellant.rcs / Math.max(1, v.propellant.rcsMax)) * 100, [0, 10], '%');
    panel('p2A', {
      boxes: [
        { x: 0, y: 0.19, w: 0.29, h: 0.13, title: 'X-POINTER' },
        { x: 0.05, y: -0.085, w: 0.17, h: 0.13, title: 'RCS A/B' },
        { x: 0, y: -0.215, w: 0.29, h: 0.085, title: 'RCS SYS A/B' },
      ],
      switches: [
        { id: 'xpScaleLMP', x: -0.113, y: 0.175, label: 'SCALE', positions: ['HI\nMULT', 'LO\nMULT'], state: 1 },
        { id: 'rateErrLMP', x: 0.113, y: 0.175, label: 'RATE/ERR\nMON', positions: ['LDG\nRDR', 'RNDZ'], state: 0 },
        { id: 'mainSovA', x: -0.105, y: -0.225, label: 'MAIN SOV A', positions: ['OPEN', 'CLOSE'], state: 0 },
        { id: 'mainSovB', x: -0.035, y: -0.225, label: 'MAIN SOV B', positions: ['OPEN', 'CLOSE'], state: 0 },
        { id: 'ascFeed', x: 0.035, y: -0.225, label: 'ASC FEED', positions: ['OPEN', 'CLOSE'], state: 1 },
        { id: 'crsfd', x: 0.105, y: -0.225, label: 'CRSFD', positions: ['OPEN', 'CLOSE'], state: 1 },
      ],
      talkbacks: [
        { id: 'tbSovA', x: -0.07, y: -0.2, state: 'grey', size: 0.01 },
        { id: 'tbSovB', x: 0.0, y: -0.2, state: 'grey', size: 0.01 },
        { id: 'tbCrsfd', x: 0.07, y: -0.2, state: 'barber', size: 0.01 },
      ],
    }, [
      { inst: xp, x: 0, y: 0.19 },
      { inst: ann, x: 0.045, y: 0.085 },
      { inst: ma, x: -0.105, y: 0.085 },
      { inst: mt, x: 0, y: 0.015 },
      { inst: contact, x: -0.095, y: -0.06 },
      { inst: rcsT, x: 0.0, y: -0.09 },
      { inst: rcsP, x: 0.05, y: -0.09 },
      { inst: rcsQ, x: 0.1, y: -0.09 },
    ]);
  }

  // ------------------------------------------------------------------ ABORT strip
  panel('abort', {
    screws: [T3(-0.05, 0.095), T3(0.05, 0.095), T3(-0.05, -0.095), T3(0.05, -0.095)].map(([x, y]) => ({ x, y, kind: 'phillips' })),
    labels: [{ text: 'ABORT', x: 0, y: 0.079, size: 0.0042 }, { text: 'ABORT STAGE', x: 0, y: -0.012, size: 0.0036 }],
    lines: [{ x1: -0.05, y1: 0.03, x2: 0.05, y2: 0.03, width: 0.0006 }],
    buttons: [
      { id: 'abortBtn', x: 0, y: 0.05, label: 'ABORT', color: 'red', size: 0.03, tone: 'light', guard: 'red' },
      { id: 'abortStageBtn', x: 0, y: -0.045, label: 'ABORT\nSTAGE', color: 'red', size: 0.03, tone: 'light', guard: 'red' },
    ],
  });

  // ------------------------------------------------------------------ panel 3 (two halves)
  panel('p3L', {
    boxes: [
      { x: -0.07, y: 0.036, w: 0.4, h: 0.07, title: 'STABILIZATION / CONTROL' },
      { x: -0.07, y: -0.042, w: 0.4, h: 0.064, title: 'RADAR' },
      { x: 0.205, y: -0.004, w: 0.12, h: 0.145, title: 'TEMP/PRESS MON' },
    ],
    switches: [
      { id: 'attRoll', x: -0.245, y: 0.028, label: 'ROLL', positions: ['PULSE', 'MODE\nCONT', 'DIR'], state: 1, labelSize: 0.0031 },
      { id: 'attPitch', x: -0.195, y: 0.028, label: 'PITCH', positions: ['PULSE', 'MODE\nCONT', 'DIR'], state: 1, labelSize: 0.0031 },
      { id: 'attYaw', x: -0.145, y: 0.028, label: 'YAW', positions: ['PULSE', 'MODE\nCONT', 'DIR'], state: 1, labelSize: 0.0031 },
      { id: 'guidCont', x: -0.09, y: 0.028, label: 'GUID CONT', positions: ['PGNS', 'AGS'], state: 0, guard: 'grey' },
      { id: 'modeContPGNS', x: -0.035, y: 0.028, label: 'MODE CONT\nPGNS', positions: ['AUTO', 'ATT\nHOLD', 'OFF'], state: 1, labelSize: 0.0031 },
      { id: 'modeContAGS', x: 0.02, y: 0.028, label: 'MODE CONT\nAGS', positions: ['AUTO', 'ATT\nHOLD', 'OFF'], state: 2, labelSize: 0.0031 },
      { id: 'deadband', x: 0.07, y: 0.028, label: 'DEADBAND', positions: ['MAX', 'MIN'], state: 1 },
      { id: 'rndzRdr', x: -0.245, y: -0.05, label: 'RNDZ RADAR', positions: ['AUTO\nTRACK', 'LGC', 'SLEW'], state: 1, labelSize: 0.0031 },
      { id: 'rdrTest', x: -0.18, y: -0.05, label: 'RADAR TEST', positions: ['LDG', 'OFF', 'RNDZ'], state: 1, labelSize: 0.0031 },
      { id: 'slewRate', x: -0.115, y: -0.05, label: 'SLEW RATE', positions: ['HI', 'LO'], state: 1 },
      { id: 'ldgAnt', x: -0.05, y: -0.05, label: 'LDG ANT', positions: ['AUTO', 'DESCENT', 'HOVER'], state: 0, labelSize: 0.0031 },
      { id: 'rdrHtr', x: 0.015, y: -0.05, label: 'ALT/ALT RT', positions: ['LDG\nRDR', 'PGNS'], state: 0 },
      { id: 'shiftTrun', x: 0.08, y: -0.05, label: 'SHIFT/\nTRUNNION', positions: ['+50°', '0', '-50°'], state: 1, labelSize: 0.0031 },
    ],
    rotaries: [
      { id: 'tempMon', x: 0.205, y: 0.0, positions: ['HELIUM', 'PRPLNT', 'FUEL', 'OXID'], index: 1, label: 'MON', size: 0.9 },
    ],
  });
  panel('p3R', {
    boxes: [
      { x: 0.07, y: 0.036, w: 0.4, h: 0.07, title: 'HEATERS / RCS' },
      { x: 0.07, y: -0.042, w: 0.4, h: 0.064, title: 'LIGHTING / TEST' },
      { x: -0.205, y: -0.004, w: 0.12, h: 0.145, title: 'LAMP/TONE TEST' },
    ],
    switches: [
      { id: 'htrRR', x: -0.07, y: 0.028, label: 'RR HTR', positions: ['ON', 'OFF'], state: 0 },
      { id: 'htrLR', x: -0.015, y: 0.028, label: 'LR HTR', positions: ['ON', 'OFF'], state: 0 },
      { id: 'quad14', x: 0.04, y: 0.028, label: 'QUAD 1&4', positions: ['AUTO', 'OFF', 'MAN'], state: 0, labelSize: 0.0031 },
      { id: 'quad23', x: 0.1, y: 0.028, label: 'QUAD 2&3', positions: ['AUTO', 'OFF', 'MAN'], state: 0, labelSize: 0.0031 },
      { id: 'rcsXfeed', x: 0.16, y: 0.028, label: 'RCS XFEED', positions: ['OPEN', 'CLOSE'], state: 1, guard: 'grey' },
      { id: 'isolA', x: 0.215, y: 0.028, label: 'ISOL', positions: ['OPEN', 'CLOSE'], state: 0 },
      { id: 'ltgAnun', x: -0.07, y: -0.05, label: 'ANUN/NUM', positions: ['BRT', 'DIM'], state: 0 },
      { id: 'ltgInteg', x: -0.015, y: -0.05, label: 'INTEG', positions: ['ON', 'OFF'], state: 0 },
      { id: 'sidePanel', x: 0.04, y: -0.05, label: 'SIDE PNL', positions: ['ON', 'OFF'], state: 1 },
      { id: 'ltgOvrd', x: 0.1, y: -0.05, label: 'LTG OVRD', positions: ['NORM', 'OVRD'], state: 0 },
      { id: 'tracker', x: 0.16, y: -0.05, label: 'TRACK', positions: ['ON', 'OFF'], state: 1 },
      { id: 'dockLt', x: 0.215, y: -0.05, label: 'DOCK LTS', positions: ['ON', 'OFF'], state: 1 },
    ],
    rotaries: [
      { id: 'lampTest', x: -0.205, y: 0.0, positions: ['OFF', '1', '2', '3', '4', '5', '6'], index: 0, label: 'TEST', size: 0.9, step: 30 },
    ],
  });

  // ------------------------------------------------------------------ panel 4: DSKY
  const dsky = INS.createDSKY({ variant: 'LM' });
  panel('p4', { screws: [T3(-0.125, 0.108), T3(0.125, 0.108), T3(-0.125, -0.108), T3(0.125, -0.108)].map(([x, y]) => ({ x, y, kind: 'phillips' })) }, [{ inst: dsky, x: 0, y: 0 }]);

  // ------------------------------------------------------------------ panel 5: CDR lower left
  panel('p5', {
    boxes: [
      { x: 0, y: 0.17, w: 0.27, h: 0.09, title: 'ENGINE' },
      { x: 0, y: 0.055, w: 0.27, h: 0.1, title: 'MISSION TIMER' },
      { x: 0, y: -0.055, w: 0.27, h: 0.09, title: 'EVENT TIMER' },
      { x: 0, y: -0.165, w: 0.27, h: 0.1, title: 'LIGHTING' },
    ],
    buttons: [
      { id: 'engStop', x: -0.075, y: 0.163, label: 'STOP', color: 'red', size: 0.026, tone: 'light', guard: 'red', caption: 'ENG STOP' },
      { id: 'engStart', x: 0.0, y: 0.163, label: 'START', color: 'white', size: 0.026, tone: 'light', caption: 'ENG START' },
      { id: 'plusX', x: 0.075, y: 0.163, label: '+X', color: 'white', size: 0.026, tone: 'light', caption: 'PLUS X' },
    ],
    switches: [
      { id: 'mtHours', x: -0.09, y: 0.045, label: 'HOURS', positions: ['+', '', '-'], state: 1 },
      { id: 'mtMin', x: -0.03, y: 0.045, label: 'MINUTES', positions: ['+', '', '-'], state: 1 },
      { id: 'mtSec', x: 0.03, y: 0.045, label: 'SECONDS', positions: ['+', '', '-'], state: 1 },
      { id: 'mtCont', x: 0.09, y: 0.045, label: 'TIMER', positions: ['START', 'STOP', 'RESET'], state: 0 },
      { id: 'etCount', x: -0.06, y: -0.065, label: 'RESET/CNT', positions: ['UP', 'SLEW', 'DOWN'], state: 0 },
      { id: 'etStart', x: 0.0, y: -0.065, label: 'START/STOP', positions: ['START', 'STOP'], state: 0 },
      { id: 'etSlew', x: 0.06, y: -0.065, label: 'SLEW', positions: ['MIN', '', 'SEC'], state: 1 },
    ],
    rotaries: [
      { id: 'flood', x: -0.08, y: -0.172, positions: ['OFF', 'POST\nLDG', 'ALL'], index: 2, label: 'FLOOD', size: 0.85 },
      { id: 'anunNum', x: 0.0, y: -0.172, positions: ['OFF', 'DIM', 'BRT'], index: 2, label: 'ANUN/NUM', size: 0.85 },
      { id: 'integral', x: 0.08, y: -0.172, positions: ['OFF', 'DIM', 'BRT'], index: 1, label: 'INTEGRAL', size: 0.85 },
    ],
  });

  // ------------------------------------------------------------------ panel 6: LMP lower right — AGS DEDA
  {
    const addr = INS.createDigitalReadout({ digits: 3, label: 'ADDRESS', getValue: () => 416, width: 0.06, height: 0.034 });
    const data = INS.createDigitalReadout({ digits: 5, sign: true, label: 'DATA', getValue: (v) => Math.max(-99999, Math.min(99999, (v.tel.altitude || 0) / FT)), width: 0.1, height: 0.034 });
    const buttons = [{ id: 'dedaOpr', x: 0.1, y: 0.105, label: 'OPR\nERR', color: 'amber', width: 0.024, height: 0.02, style: 'block' }];
    const p6 = panel('p6', {
      boxes: [
        { x: 0, y: 0.105, w: 0.27, h: 0.235, title: 'DATA ENTRY AND DISPLAY ASSY' },
        { x: 0, y: -0.075, w: 0.27, h: 0.07, title: 'AGS' },
        { x: 0, y: -0.175, w: 0.27, h: 0.09, title: 'LIGHTING' },
      ],
      buttons,
      switches: [
        { id: 'agsStatus', x: -0.07, y: -0.085, label: 'STATUS', positions: ['OPERATE', 'STBY', 'OFF'], state: 1, labelSize: 0.0031 },
        { id: 'agsWarm', x: 0.0, y: -0.085, label: 'WARMUP', positions: ['ON', 'OFF'], state: 0 },
        { id: 'agsDeda', x: 0.07, y: -0.085, label: 'DEDA', positions: ['ON', 'OFF'], state: 0 },
      ],
      rotaries: [
        { id: 'floodL', x: -0.07, y: -0.183, positions: ['OFF', 'DIM', 'BRT'], index: 2, label: 'FLOOD', size: 0.85 },
        { id: 'anunL', x: 0.0, y: -0.183, positions: ['OFF', 'DIM', 'BRT'], index: 2, label: 'ANUN', size: 0.85 },
        { id: 'integL', x: 0.07, y: -0.183, positions: ['OFF', 'DIM', 'BRT'], index: 1, label: 'INTEGRAL', size: 0.85 },
      ],
    }, [{ inst: addr, x: -0.075, y: 0.19 }, { inst: data, x: 0.05, y: 0.19 }]);
    const pad = dedaKeypad();
    pad.position.set(-0.0005, 0.0615, 0);
    p6.add(pad);
  }

  // ------------------------------------------------------------------ panel 8: CDR left console
  {
    const exp = [];
    const expNames = [
      ['LDG GEAR\nDEPLOY', ['FIRE', 'OFF'], 1],
      ['DES PRPLNT\nISOL VLV', ['FIRE', 'OFF'], 1],
      ['DES START\nHE PRESS', ['FIRE', 'OFF'], 1],
      ['ASC HE\nPRESS', ['FIRE', 'OFF'], 1],
      ['ASC PRPLNT\nISOL VLV', ['FIRE', 'OFF'], 1],
      ['DES VENT', ['FIRE', 'OFF'], 1],
      ['SYS A', ['ARM', 'OFF'], 1],
      ['SYS B', ['ARM', 'OFF'], 1],
    ];
    expNames.forEach(([label, positions, state], i) => {
      const col = i % 4;
      const row = Math.floor(i / 4);
      exp.push({ id: `exp${i}`, x: 0.035 + col * 0.045, y: 0.045 - row * 0.085, label, positions, state, cover: 'red', labelSize: 0.0029 });
    });
    const audio = [];
    ['S-BAND', 'ICS', 'RELAY', 'VHF A', 'VHF B'].forEach((t, i) => {
      audio.push({ id: `audC${i}`, x: -0.19 + i * 0.043, y: 0.055, label: t, positions: ['T/R', 'RCV', 'OFF'], state: i === 2 ? 2 : 0, labelSize: 0.003 });
    });
    panel('p8', {
      boxes: [
        { x: -0.105, y: 0.004, w: 0.2, h: 0.24, title: 'AUDIO — CDR' },
        { x: 0.1, y: 0.004, w: 0.2, h: 0.24, title: 'EXPLOSIVE DEVICES', style: 'bar' },
      ],
      switches: [
        ...audio,
        { id: 'audMode', x: -0.19, y: -0.075, label: 'MODE', positions: ['VOX', 'PTT', 'ICS/PTT'], state: 1, labelSize: 0.003 },
        { id: 'audVox', x: -0.02, y: -0.075, label: 'AUDIO\nCONT', positions: ['NORM', 'BU'], state: 0 },
        ...exp,
      ],
      rotaries: [
        { id: 'volMaster', x: -0.135, y: -0.075, positions: ['', '', '', '', ''], index: 3, label: 'MASTER\nVOL', size: 0.8, step: 36 },
        { id: 'volSband', x: -0.075, y: -0.075, positions: ['', '', '', '', ''], index: 2, label: 'S-BD VOL', size: 0.8, step: 36 },
      ],
      talkbacks: [
        { id: 'tbGear', x: 0.035, y: -0.1, state: 'grey', size: 0.01, label: 'LDG GEAR' },
        { id: 'tbStage', x: 0.17, y: -0.1, state: 'grey', size: 0.01, label: 'STAGE SEQ' },
      ],
    });
  }

  // ------------------------------------------------------------------ panel 12: LMP communications
  {
    const aud = ['S-BAND', 'ICS', 'RELAY', 'VHF A', 'VHF B'].map((t, i) => ({ id: `audL${i}`, x: -0.19 + i * 0.043, y: 0.055, label: t, positions: ['T/R', 'RCV', 'OFF'], state: i === 2 ? 2 : 0, labelSize: 0.003 }));
    const sig = INS.createGauge({ kind: 'round', label: 'SIG STR', min: 0, max: 5, ticks: [0, 1, 2, 3, 4, 5], getValue: (v, gm) => 3.4 + 0.15 * Math.sin(gm.time.met * 0.9), width: 0.07, height: 0.07 });
    panel('p12', {
      boxes: [
        { x: -0.105, y: 0.004, w: 0.2, h: 0.24, title: 'AUDIO — LMP' },
        { x: 0.1, y: 0.004, w: 0.2, h: 0.24, title: 'S-BAND / VHF' },
      ],
      switches: [
        ...aud,
        { id: 'sbXmtr', x: 0.035, y: -0.035, label: 'XMTR/RCVR', positions: ['PRIM', 'OFF', 'SEC'], state: 0, labelSize: 0.003 },
        { id: 'sbPwr', x: 0.08, y: -0.035, label: 'PWR AMPL', positions: ['PRIM', 'OFF', 'SEC'], state: 0, labelSize: 0.003 },
        { id: 'sbMode', x: 0.125, y: -0.035, label: 'VOICE', positions: ['VOICE', 'OFF', 'DN\nVOICE'], state: 0, labelSize: 0.003 },
        { id: 'sbPcm', x: 0.17, y: -0.035, label: 'PCM', positions: ['HI', 'LO'], state: 0 },
        { id: 'vhfA', x: 0.035, y: -0.1, label: 'VHF A XMTR', positions: ['VOICE', 'OFF', 'DATA'], state: 0, labelSize: 0.003 },
        { id: 'vhfB', x: 0.08, y: -0.1, label: 'VHF B RCVR', positions: ['ON', 'OFF'], state: 0 },
        { id: 'audModeL', x: -0.19, y: -0.075, label: 'MODE', positions: ['VOX', 'PTT', 'ICS/PTT'], state: 1, labelSize: 0.003 },
      ],
      rotaries: [
        { id: 'volMasterL', x: -0.135, y: -0.075, positions: ['', '', '', '', ''], index: 3, label: 'MASTER\nVOL', size: 0.8, step: 36 },
        { id: 'volVhfL', x: -0.075, y: -0.075, positions: ['', '', '', '', ''], index: 2, label: 'VHF VOL', size: 0.8, step: 36 },
      ],
    }, [{ inst: sig, x: 0.155, y: 0.045 }]);
  }

  // ------------------------------------------------------------------ panel 14: EPS
  {
    const volts = INS.createGauge({ kind: 'vertical', label: 'VOLTS', min: 20, max: 40, ticks: [20, 25, 30, 35, 40], getValue: (v, gm) => 32.4 - 0.4 * (v.mainEngine?.firing ? 1 : 0) + 0.05 * Math.sin(gm.time.met), redline: [20, 26], width: 0.05, height: 0.12 });
    const amps = INS.createGauge({ kind: 'vertical', label: 'AMPS', min: 0, max: 120, ticks: [0, 40, 80, 120], getValue: (v, gm) => 58 + (v.mainEngine?.firing ? 9 : 0) + 1.5 * Math.sin(gm.time.met * 0.3), width: 0.05, height: 0.12 });
    const bat = [1, 2, 3, 4].map((n, i) => ({ id: `desBat${n}`, x: -0.105 + i * 0.07, y: -0.055, label: `DES ${n}`, positions: ['HI V', 'OFF', 'LO V'], state: 0, labelSize: 0.0031 }));
    const tbs = [1, 2, 3, 4].map((n, i) => ({ id: `tbBat${n}`, x: -0.105 + i * 0.07, y: -0.1, state: 'grey', size: 0.01 }));
    panel('p14', {
      boxes: [
        { x: -0.05, y: 0.085, w: 0.17, h: 0.14, title: 'EPS' },
        { x: 0, y: -0.075, w: 0.27, h: 0.1, title: 'DES BATS' },
      ],
      switches: [
        ...bat,
        { id: 'ascBat5', x: -0.07, y: -0.14, label: 'ASC 5', positions: ['NORM', 'OFF', 'BACKUP'], state: 1, labelSize: 0.003 },
        { id: 'ascBat6', x: 0.0, y: -0.14, label: 'ASC 6', positions: ['NORM', 'OFF', 'BACKUP'], state: 1, labelSize: 0.003 },
        { id: 'inv', x: 0.07, y: -0.14, label: 'INVERTER', positions: ['1', 'OFF', '2'], state: 0, labelSize: 0.003 },
      ],
      rotaries: [{ id: 'epsMon', x: 0.095, y: 0.085, positions: ['BAT 1', 'BAT 2', 'BAT 3', 'BAT 4', 'CDR BUS', 'LMP BUS'], index: 4, label: 'PWR/TEMP MON', size: 0.9, step: 30 }],
      talkbacks: tbs,
    }, [{ inst: volts, x: -0.085, y: 0.08 }, { inst: amps, x: -0.02, y: 0.08 }]);
  }

  // ------------------------------------------------------------------ panels 11 & 16: circuit breakers
  const cb11Rows = ['FLIGHT\nDISPLAYS', 'STAB/\nCONT', 'HEATERS', 'COMM/\nINST', 'EPS'];
  const cb11 = [
    ['FDAI', 'X-PNTR', 'THRUST\nIND', 'ALT/ALT\nRATE', 'RNG/RNG\nRATE', 'EVENT\nTIMER', 'MSN\nTIMER', 'ORDEAL', 'TAPE\nMETER', 'ATT\nDIR CONT', 'ATCA', 'ATCA\n(PGNS)', 'ATCA\n(AGS)', 'AELD', 'ABORT\nSTAGE', 'ENG\nSTART', 'ENG\nSTOP', 'DES ENG\nCMD OVRD', 'GYRO\nTEST', 'RCS\nTCA', 'QUAD 1', 'QUAD 2', 'QUAD 3', 'QUAD 4'],
    ['ACA', 'TTCA', 'ENG ARM', 'DECA\nPWR', 'DECA\nGMBL', 'DES ENG\nOVRD', 'ASC ENG\nARM', 'ATT\nCONT', 'RATE\nGYRO', 'PGNS\nMODE', 'AGS\nMODE', 'GUID\nCONT', 'MODE\nCONT', 'DEAD\nBAND', 'IMU\nSTBY', 'IMU\nOPR', 'LGC/\nDSKY', 'SIGNAL\nSENSOR', 'AOT\nLAMP', 'RDR\nSEL', 'LR', 'RR', 'RR\nSTBY', 'RR\nOPR'],
    ['DOCK\nWINDOW', 'AOT', 'RR', 'LR', 'S-BAND\nANT', 'QUAD 1', 'QUAD 2', 'QUAD 3', 'QUAD 4', 'DISP', 'SBD\nANT', 'RCS\nSTBY', 'ASC\nH2O', 'DES\nH2O', 'CABIN\nFAN', 'SUIT\nFAN 1', 'SUIT\nFAN 2', 'GLYCOL\nPUMP', 'ECS\nDISP', 'CO2\nSENSOR', 'H2O\nSEP', 'O2 QTY\nMON', 'CABIN\nREPRESS', 'SUIT\nFLOW'],
    ['PCMTEA', 'PMP', 'UP\nDATA', 'TV', 'VHF A\nXMTR', 'VHF B\nXMTR', 'VHF A\nRCVR', 'VHF B\nRCVR', 'S-BAND\nPRIM', 'S-BAND\nSEC', 'PWR\nAMPL', 'CDR\nAUDIO', 'LMP\nAUDIO', 'CAUTION\nWARNING', 'C/W\nPWR', 'ANUN/\nDOCK', 'INTEG\nLTG', 'FLOOD', 'UTIL\nLTS', 'TRACK\nLT', 'DOCK\nLTS', 'SIDE\nPNL', 'NUM\nLTG', 'MSTR\nALARM'],
    ['DC BUS\nVOLT', 'INV 1', 'INV 2', 'BAT\nFEED', 'CROSS\nTIE BAL', 'CROSS\nTIE BUS', 'ASC\nECA', 'DES\nECA', 'XLUNAR\nBUS', 'ASC 5', 'ASC 6', 'DES 1', 'DES 2', 'DES 3', 'DES 4', 'CDR\nBUS', 'LMP\nBUS', 'AC BUS\nA', 'AC BUS\nB', 'ED\nSYS A', 'ED\nSYS B', 'LOGIC\nPWR A', 'LOGIC\nPWR B', 'HTR\nCONT'],
  ];
  const cbAmps = [2, 5, 7.5, 10, 3, 5, 2, 15, 5, 7.5, 3, 20, 2, 5, 10, 7.5];
  const cbPanel = (id, title, rowLabels, labels, popped, seed) => {
    const slot = L[id];
    const p = KIT.createCircuitBreakerPanel({
      name: `PANEL ${id}`,
      title,
      width: slot.w,
      height: slot.h,
      rows: 5,
      cols: 24,
      pitchX: 0.0213,
      pitchY: 0.057,
      x0: -slot.w / 2 + 0.058,
      y0: slot.h / 2 - 0.058,
      rowLabels,
      rowLabelWidth: 0.036,
      labels,
      labelSize: 0.0026,
      amps: (r, c) => cbAmps[(r * 7 + c * 3 + seed) % cbAmps.length],
      popped,
      pxPerM: 2600,
      screws: 'dzus',
      seed,
    });
    applyFrame(p, slot.frame.matrix);
    group.add(p);
    panels[id] = p;
    return p;
  };
  cbPanel('p11', 'PANEL 11 — CDR', cb11Rows, cb11, [[2, 9], [4, 23]], 11);
  const cb16Rows = ['FLIGHT\nDISPLAYS', 'ECS', 'PGNS/\nAGS', 'RCS\nSYS B', 'EPS'];
  const cb16 = [
    ['FDAI', 'X-PNTR', 'EVENT\nTIMER', 'RCS\nTEMP', 'RCS\nPRESS', 'RCS\nQTY', 'ECS\nDISP', 'ENG\nPRESS', 'PRPLNT\nQTY', 'HE\nMON', 'TEMP\nMON', 'ASC\nQTY', 'DES\nQTY', 'FUEL\nTEMP', 'OXID\nTEMP', 'ORDEAL', 'ANUN/\nNUM', 'MSN\nTIMER', 'C/W\nLTS', 'TAPE\nMTR', 'ALT/ALT\nRATE', 'THRUST', 'ATT\nIND', 'SIG\nSTR'],
    ['CABIN\nREPRESS', 'CABIN\nFAN', 'SUIT\nFAN 1', 'SUIT\nFAN 2', 'SUIT\nFAN dP', 'H2O\nSEP', 'GLYCOL\nPRI', 'GLYCOL\nSEC', 'DIVERT\nVLV', 'CO2\nSENSOR', 'O2\nDEMAND', 'SUIT\nTEMP', 'CABIN\nTEMP', 'LCG\nPUMP', 'ECS\nCAUTION', 'H2O\nQTY', 'O2\nQTY', 'PLSS\nFILL', 'OPS\nFILL', 'ECS\nHTR', 'SBL\nVLV', 'DES\nH2O', 'ASC\nH2O 1', 'ASC\nH2O 2'],
    ['PGNS\nLGC', 'PGNS\nDSKY', 'PGNS\nIMU', 'IMU\nSTBY', 'IMU\nHTR', 'AOT\nLAMP', 'RNDZ\nRDR', 'LDG\nRDR', 'AGS\nAEA', 'AGS\nASA', 'AGS\nDEDA', 'AGS\nSTBY', 'AGS\nOPR', 'AGS\nHTR', 'CDU', 'COUPL\nDATA', 'PTA', 'LGC\nWARN', 'ISS\nWARN', 'STAB\nCONT', 'ATCA', 'AELD', 'DECA', 'GASTA'],
    ['QUAD 1', 'QUAD 2', 'QUAD 3', 'QUAD 4', 'ISOL\nVLV', 'MAIN\nSOV', 'ASC\nFEED', 'CRSFD', 'TCA\nA', 'TCA\nB', 'HTR\nQ1', 'HTR\nQ2', 'HTR\nQ3', 'HTR\nQ4', 'RCS\nSTBY', 'ECA\nCONT', 'ECA\nPWR', 'PRPLNT\nXFEED', 'He\nPRESS', 'OXID\nVENT', 'FUEL\nVENT', 'ASC HE\nREG', 'DES HE\nREG', 'SOV\nIND'],
    ['DC BUS\nVOLT', 'AC BUS\nVOLT', 'INV 1', 'INV 2', 'BAT 5\nNORM', 'BAT 6\nNORM', 'BAT 5\nBU', 'BAT 6\nBU', 'CROSS\nTIE', 'ASC\nECA', 'DES\nECA', 'ED\nRELAYS', 'LMP\nBUS', 'CDR\nBUS', 'XLUNAR', 'BAT\nFAULT', 'REV\nCURR', 'HTR\nCONT', 'LTG\nFLOOD', 'LTG\nUTIL', 'LTG\nPNL', 'LTG\nANUN', 'TEMP\nMON', 'AMPS'],
  ];
  cbPanel('p16', 'PANEL 16 — LMP', cb16Rows, cb16, [[1, 14]], 16);

  // ------------------------------------------------------------------ ECS panel (aft right)
  {
    const o2 = INS.createGauge({ kind: 'vertical', label: 'O2\nQTY', min: 0, max: 100, ticks: [0, 50, 100], getValue: () => 88, redline: [0, 10], units: '%', width: 0.05, height: 0.12 });
    const h2o = INS.createGauge({ kind: 'vertical', label: 'H2O\nQTY', min: 0, max: 100, ticks: [0, 50, 100], getValue: () => 76, redline: [0, 10], units: '%', width: 0.05, height: 0.12 });
    const glyT = INS.createGauge({ kind: 'round', label: 'GLYCOL', min: 0, max: 80, ticks: [0, 20, 40, 60, 80], getValue: (v, gm) => 44 + Math.sin(gm.time.met * 0.02), width: 0.07, height: 0.07 });
    panel('ecs', {
      name: 'ECS',
      pxPerM: 2200,
      boxes: [
        { x: -0.19, y: 0.03, w: 0.2, h: 0.3, title: 'SUIT / CABIN' },
        { x: 0.03, y: 0.03, w: 0.2, h: 0.3, title: 'OXYGEN CONT' },
        { x: 0.225, y: 0.03, w: 0.15, h: 0.3, title: 'WATER / GLYCOL' },
      ],
      rotaries: [
        { id: 'suitGas', x: -0.24, y: 0.07, positions: ['EGRESS', 'CABIN'], index: 1, label: 'SUIT GAS\nDIVERTER', size: 1.7, step: 60, legendRadius: 0.03 },
        { id: 'cabinRep', x: -0.14, y: 0.07, positions: ['CLOSE', 'AUTO', 'MAN'], index: 1, label: 'CABIN\nREPRESS', size: 1.7, step: 45, legendRadius: 0.03 },
        { id: 'pressRegA', x: -0.24, y: -0.05, positions: ['EGRESS', 'CABIN', 'DIRECT O2', 'CLOSE'], index: 1, label: 'PRESS REG A', size: 1.5, step: 40, legendRadius: 0.028 },
        { id: 'pressRegB', x: -0.14, y: -0.05, positions: ['EGRESS', 'CABIN', 'DIRECT O2', 'CLOSE'], index: 1, label: 'PRESS REG B', size: 1.5, step: 40, legendRadius: 0.028 },
        { id: 'o2Plss', x: 0.03, y: -0.06, positions: ['OPEN', 'CLOSE'], index: 1, label: 'PLSS FILL', size: 1.5, step: 60, legendRadius: 0.028 },
        { id: 'o2Des', x: -0.03, y: 0.1, positions: ['OPEN', 'CLOSE'], index: 0, label: 'DES O2', size: 1.4, step: 60, legendRadius: 0.026 },
        { id: 'o2Asc', x: 0.09, y: 0.1, positions: ['OPEN', 'CLOSE'], index: 1, label: 'ASC O2 #1', size: 1.4, step: 60, legendRadius: 0.026 },
        { id: 'h2oSel', x: 0.19, y: -0.06, positions: ['DES', 'ASC'], index: 0, label: 'H2O SEL', size: 1.4, step: 60, legendRadius: 0.026 },
      ],
      switches: [
        { id: 'co2Sel', x: 0.26, y: -0.075, label: 'CO2 CANISTER', positions: ['PRIM', 'SEC'], state: 0 },
      ],
      lamps: [
        { id: 'ecsCO2', x: 0.26, y: -0.13, color: 'amber', label: 'CO2' },
        { id: 'ecsWS', x: 0.3, y: -0.13, color: 'amber', label: 'H2O SEP' },
      ],
    }, [{ inst: o2, x: 0.03, y: 0.02 }, { inst: h2o, x: 0.19, y: 0.07 }, { inst: glyT, x: 0.26, y: 0.07 }]);
  }

  KIT.setLayerRecursive(group);
  return { group, instruments, controls, panels, dsky };
}
