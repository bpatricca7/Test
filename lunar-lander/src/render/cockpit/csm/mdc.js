// Main Display Console of the Block II Command Module (CSM-CABIN agent): Apollo 11 CSM-107
// "Columbia" panels 1, 2 and 3, built with the cockpit kit (grey panels, printed legends,
// instanced toggles with guards & covers, talkbacks, rotaries, thumbwheels) and the live
// instruments (FDAIs, DSKY, EMS, GPI, timers, C&W matrix, MASTER ALARMs, meters).
//
//   Panel 1 (CDR, left wing)   FDAI 1, MASTER ALARM, LV/ABORT lights, EVENT TIMER, altimeter,
//                              accelerometer, attitude-set thumbwheels, FDAI/SCS/manual-attitude
//                              switches; EMS (roll display, scroll, ΔV counter), GPI, EMS & TVC
//                              controls, SPS gimbal trim thumbwheels
//   Panel 2 (centre)           caution & warning matrix, MISSION TIMER, SM RCS helium/propellant
//                              talkbacks & switches, FDAI 2, sequential events (red covers), docking
//                              probe, SM RCS meters, DSKY, SPS quantity, ECS meters, SPS / TVC switches
//   Panel 3 (LMP, right wing)  MASTER ALARM, fuel-cell & cryogenic meters, EPS switches with
//                              talkbacks, DC/AC meters, batteries & inverters, S-band/HGA, comms
//
// Each MDC section is a console box (hollow, so instrument cases fit behind the cut-outs) whose
// face is tiled with sub-panels (the real MDC was assembled from separate panel plates too).
import * as THREE from 'three';
import * as KIT from '../kit/index.js';
import * as INS from '../instruments/index.js';
import { FT } from '../../../core/constants.js';
import { mdcSections, MDC } from './layout.js';
import { V, Batch, placeOnFrame, onFrame } from './geom.js';
import { createMeterCluster } from './meters.js';

const DEG = Math.PI / 180;

/** Switch spec helper. */
const S = (id, label, positions, state = 0, extra = {}) => ({ id, label, positions, state, ...extra });
/** Lay a row of switch specs from x0 with pitch dx at height y. */
function row(y, x0, dx, specs) {
  return specs.filter(Boolean).map((s, i) => ({ ...s, x: s.x ?? x0 + i * dx, y: s.y ?? y }));
}
const ONOFF = ['ON', 'OFF'];
const TB = (id, x, y, state = 'grey', label) => ({ id, x, y, state, size: 0.0105, label, labelSize: 0.0026 });

/**
 * Build the MDC.
 * @param {(key: string) => THREE.Material} mat cabin materials
 * @param {object} ctx { systems: () => systems state }
 * @returns {{group: THREE.Group, instruments: Array<{update: Function}>, controls: Map<string, object>,
 *   panels: object, sections: object}}
 */
export function buildMDC(mat, ctx = {}) {
  const sections = mdcSections();
  const group = new THREE.Group();
  group.name = 'CSMCabin:MDC';
  const instruments = [];
  const controls = new Map();
  const panels = {};
  const sys = ctx.systems || (() => null);

  /** Sub-panel on a section at (cx, cy) with size w × h and instrument mounts [{inst, x, y}]. */
  function panel(id, F, cx, cy, w, h, spec = {}, mounts = []) {
    const holes = [...(spec.holes || [])];
    for (const m of mounts) holes.push({ x: m.x, y: m.y, w: m.inst.mountHole.w, h: m.inst.mountHole.h, corner: 0.002 });
    const p = KIT.createPanel({
      width: w - 0.003, height: h - 0.003, depth: 0.01, pxPerM: Math.round(2600 * (ctx.texScale ?? 1)), screws: 'dzus', screwInset: 0.006, name: `CM PANEL ${id}`, wear: 0.45, ...spec, holes,
    });
    for (const m of mounts) {
      m.inst.object.position.set(m.x, m.y, 0);
      p.add(m.inst.object);
      instruments.push(m.inst);
    }
    placeOnFrame(p, F, cx, cy, 0);
    group.add(p);
    panels[id] = p;
    for (const [k, v] of p.controls) controls.set(k, v);
    return p;
  }

  const { P1, P2, P3 } = sections;

  // ================================================================== PANEL 1 — CDR
  {
    const fdai = INS.createFDAI({ size: 0.19 });
    const ma = INS.createMasterAlarm({ size: 0.042 });
    const lv = INS.createAnnunciatorPanel({
      cols: 2, cellW: 0.03, cellH: 0.016, style: 'legend',
      labels: [
        ['ENG 1', 'white'], ['ENG 2', 'white'], ['ENG 3', 'white'], ['ENG 4', 'white'], ['ENG 5', 'white'],
        ['LV GUID', 'red'], ['LV RATE', 'red'], ['LIFT OFF', 'white'], ['NO AUTO\nABORT', 'white'], ['ABORT', 'red'],
      ].map(([text, color]) => ({ text, key: 'LV ' + text.replace('\n', ' '), color })),
    });
    const et = INS.createEventTimer();
    const alt = INS.createGauge({ kind: 'round', label: 'ALT\nx1000 FT', min: 0, max: 50, ticks: [0, 10, 20, 30, 40, 50], width: 0.07, height: 0.07, getValue: (v) => Math.min(50, (v.tel.altitude || 0) / FT / 1000) });
    const acc = INS.createGauge({ kind: 'round', label: 'G', min: -1, max: 10, ticks: [-1, 0, 2, 4, 6, 8, 10], width: 0.07, height: 0.07, getValue: (v) => (v.tel.accel || 0) / 9.80665 });
    const p1top = [
      ...row(-0.108, -0.238, 0.034, [
        S('fdaiScale', 'FDAI SCALE', ['5/1', '50/15', '50/5'], 0),
        S('fdaiSelect', 'FDAI SELECT', ['1/2', '2', '1'], 0),
        S('fdaiSource', 'FDAI SOURCE', ['CMC', 'ATT SET', 'GDC'], 0),
        S('attSet', 'ATT SET', ['IMU', 'GDC'], 1),
        S('manRoll', 'MAN ATT\nROLL', ['ACCEL\nCMD', 'RATE\nCMD', 'MIN\nIMP'], 1),
        S('manPitch', 'MAN ATT\nPITCH', ['ACCEL\nCMD', 'RATE\nCMD', 'MIN\nIMP'], 1),
        S('manYaw', 'MAN ATT\nYAW', ['ACCEL\nCMD', 'RATE\nCMD', 'MIN\nIMP'], 1),
        S('limitCycle', 'LIMIT\nCYCLE', ONOFF, 1),
        S('attDb', 'ATT\nDEADBAND', ['MAX', 'MIN'], 1),
        S('rate', 'RATE', ['HIGH', 'LOW'], 1),
        S('transPwr', 'TRANS\nCONTR', ['PWR', 'OFF'], 0),
        S('rotNorm1', 'ROT CONTR\nNORMAL 1', ['AC/DC', 'AC', 'OFF'], 0),
        S('rotNorm2', 'NORMAL 2', ['AC/DC', 'AC', 'OFF'], 0),
        S('rotDir1', 'DIRECT 1', ['MNA/MNB', 'OFF', 'MNA'], 1),
        S('rotDir2', 'DIRECT 2', ['MNA/MNB', 'OFF', 'MNB'], 1),
      ]),
      ...row(-0.168, -0.238, 0.034, [
        S('scCont', 'SC CONT', ['CMC', 'SCS'], 0),
        S('cmcMode', 'CMC MODE', ['AUTO', 'HOLD', 'FREE'], 1),
        S('bmagRoll', 'BMAG MODE\nROLL', ['ATT 1/\nRATE 2', '', 'RATE 2'], 0),
        S('bmagPitch', 'PITCH', ['ATT 1/\nRATE 2', '', 'RATE 2'], 0),
        S('bmagYaw', 'YAW', ['ATT 1/\nRATE 2', '', 'RATE 2'], 0),
        S('spsThrust', 'SPS THRUST', ['DIRECT\nON', 'NORMAL'], 1, { cover: 'red' }),
        S('dvThrustA', 'ΔV THRUST\nA', ['NORMAL', 'OFF'], 1, { cover: 'red' }),
        S('dvThrustB', 'B', ['NORMAL', 'OFF'], 1, { cover: 'red' }),
        S('tvcPitch', 'TVC GMBL\nDRIVE P', ['AUTO', '1', '2'], 0),
        S('tvcYaw', 'Y', ['AUTO', '1', '2'], 0),
        S('fdaiGpiPwr', 'FDAI/GPI\nPOWER', ['BOTH', '1', '2'], 0),
        S('logic1', 'LOGIC\nPWR', ['1', 'OFF'], 0),
        S('attImp', 'SCS\nELECT PWR', ['GDC/\nECA', 'ECA', 'OFF'], 0),
        S('bmag1', 'BMAG PWR\n1', ['ON', 'WARM\nUP', 'OFF'], 0),
        S('bmag2', '2', ['ON', 'WARM\nUP', 'OFF'], 0),
      ]),
    ];
    panel('1A', P1, 0, 0.17, P1.w, 0.4, {
      switches: p1top,
      boxes: [
        { x: -0.205, y: 0.07, w: 0.08, h: 0.12, title: 'LV' },
        { x: -0.069, y: -0.13, w: 0.27, h: 0.132, title: 'ATTITUDE CONTROL' },
        { x: 0.169, y: -0.13, w: 0.19, h: 0.132, title: 'ROTATION CONTROL POWER' },
      ],
      thumbwheels: [
        { id: 'attSetR', x: -0.215, y: -0.028, digits: 3, value: 0, label: 'ROLL' },
        { id: 'attSetP', x: -0.165, y: -0.028, digits: 3, value: 0, label: 'PITCH' },
        { id: 'attSetY', x: -0.115, y: -0.028, digits: 3, value: 0, label: 'YAW' },
      ],
      labels: [
        { text: 'ATTITUDE SET', x: -0.165, y: 0.005, size: 0.0034 },
        { text: 'FDAI 1', x: 0.005, y: 0.168, size: 0.0036 },
        { text: '1', x: -0.25, y: 0.187, size: 0.005 },
      ],
    }, [
      { inst: fdai, x: 0.005, y: 0.055 },
      { inst: ma, x: -0.215, y: 0.16 },
      { inst: lv, x: -0.205, y: 0.065 },
      { inst: et, x: 0.19, y: 0.162 },
      { inst: alt, x: 0.205, y: 0.08 },
      { inst: acc, x: 0.205, y: 0.0 },
    ]);

    const ems = INS.createEMS({ deltaV: 0 });
    const gpi = INS.createGPI();
    panel('1B', P1, 0, -0.2, P1.w, 0.34, {
      switches: [
        ...row(-0.09, -0.238, 0.034, [
          S('emsRoll', 'EMS ROLL', ONOFF, 1),
          S('ems05g', '.05 G', ONOFF, 1, { cover: 'grey' }),
          S('gta', 'GTA', ONOFF, 1, { cover: 'red' }),
          S('emsMode', 'EMS MODE', ['AUTO', 'NORMAL', 'MAN'], 2),
          S('gmblP1', 'GMBL MOT\nPITCH 1', ['START', 'ON', 'OFF'], 1),
          S('gmblY1', 'YAW 1', ['START', 'ON', 'OFF'], 1),
          S('gmblP2', 'PITCH 2', ['START', 'ON', 'OFF'], 1),
          S('gmblY2', 'YAW 2', ['START', 'ON', 'OFF'], 1),
        ]),
        ...row(-0.148, -0.238, 0.034, [
          S('entryEms', 'ENTRY\nEMS', ['ON', 'OFF'], 1),
          S('lvSpsInd', 'LV/SPS IND\nα/Pc', ['α', 'Pc'], 1),
          S('tvcServo1', 'TVC SERVO\nPWR 1', ['AC1/\nMNA', 'OFF', 'AC2/\nMNB'], 0),
          S('tvcServo2', '2', ['AC1/\nMNA', 'OFF', 'AC2/\nMNB'], 2),
          S('tvcCheck', 'TVC\nCHECK', ['PITCH', 'OFF', 'YAW'], 1),
          S('lvGuid', 'LV\nGUID', ['IU', 'CMC'], 0, { cover: 'red' }),
          S('sIIsIVB', 'S II/\nS IVB', ['LV\nSTAGE', 'OFF'], 1, { cover: 'red' }),
          S('xlunar', 'XLUNAR', ['INJECT', 'SAFE'], 1),
        ]),
      ],
      rotaries: [
        { id: 'emsFunc', x: 0.08, y: -0.07, positions: ['ΔV', 'ΔV SET', 'ΔV TEST', 'RNG SET', 'VHF RNG', 'OFF', 'ENTRY'], index: 5, angles: [-90, -60, -30, 0, 30, 60, 90], label: 'EMS FUNCTION', size: 1.1 },
      ],
      thumbwheels: [
        { id: 'trimP', x: 0.165, y: -0.13, digits: 2, value: 0, label: 'PITCH TRIM' },
        { id: 'trimY', x: 0.225, y: -0.13, digits: 2, value: 0, label: 'YAW TRIM' },
      ],
      boxes: [
        { x: 0.195, y: -0.12, w: 0.125, h: 0.07, title: 'SPS GMBL TRIM' },
      ],
    }, [
      { inst: ems, x: -0.125, y: 0.065 },
      { inst: gpi, x: 0.175, y: 0.09 },
    ]);
  }

  // ================================================================== PANEL 2 — centre
  {
    const cwLabels = [
      'SM RCS A', 'SM RCS B', 'SM RCS C', 'SM RCS D', 'CRYO PRESS', 'GLYCOL TEMP LOW', 'CM RCS 1', 'CM RCS 2',
      'SPS PRESS', 'SPS ROUGH ECO', 'O2 FLOW HI', 'SUIT COMP', 'FC BUS DISCONNECT', 'FUEL CELL 1', 'FUEL CELL 2', 'FUEL CELL 3',
      'CMC', 'ISS', 'MAIN BUS A', 'MAIN BUS B', 'AC BUS 1', 'AC BUS 2', 'AC BUS 1 OVERLOAD', 'AC BUS 2 OVERLOAD',
      'BMAG 1 TEMP', 'BMAG 2 TEMP', 'PITCH GMBL 1', 'PITCH GMBL 2', 'YAW GMBL 1', 'YAW GMBL 2', 'CO2 PP HI', 'SUIT',
      'C/W', 'CREW ALERT', 'UPTLM CM', 'UPTLM IU', 'HIGH GAIN ANT\nSCAN LIMIT', 'SPS QTY', 'MN BUS A\nUNDERVOLT', 'MN BUS B\nUNDERVOLT',
    ];
    const cw = INS.createAnnunciatorPanel({
      cols: 8, cellW: 0.036, cellH: 0.015, style: 'legend',
      labels: cwLabels.map((t) => ({ text: t, key: t.replace('\n', ' '), color: /CMC|ISS|SPS PRESS|CM RCS|CRYO|MAIN BUS|MN BUS|AC BUS|FUEL CELL|SUIT COMP|O2 FLOW|CO2|GLYCOL|C\/W|SPS ROUGH|FC BUS/.test(t) ? 'red' : 'amber' })),
    });
    const mt = INS.createMissionTimer();
    const p2top = panel('2T', P2, 0, 0.32, P2.w, 0.16, {
      talkbacks: [
        ...['A', 'B', 'C', 'D'].map((q, i) => TB(`tbHe1${q}`, -0.385 + i * 0.026, 0.05, 'grey', q)),
        ...['A', 'B', 'C', 'D'].map((q, i) => TB(`tbHe2${q}`, -0.265 + i * 0.026, 0.05, 'grey', q)),
      ],
      switches: [
        ...row(-0.012, -0.385, 0.026, ['A', 'B', 'C', 'D'].map((q) => S(`he1${q}`, '', ['OPEN', 'CLOSE'], 0, { labelSize: 0.0028 }))),
        ...row(-0.012, -0.265, 0.026, ['A', 'B', 'C', 'D'].map((q) => S(`he2${q}`, '', ['OPEN', 'CLOSE'], 0, { labelSize: 0.0028 }))),
        ...row(-0.058, -0.1, 0.05, [
          S('cwMode', 'C/W MODE', ['BOOST', 'CM', 'CSM'], 2),
          S('cwCsmCm', 'CSM/CM', ['CSM', 'CM'], 0),
          S('cwPower', 'C/W POWER', ['1', 'OFF', '2'], 0),
          S('lampTest', 'LAMP TEST', ['1', 'OFF', '2'], 1),
          S('cwAck', 'C/W ACK', ['NORMAL', 'ACK'], 0),
        ]),
        ...row(-0.048, 0.225, 0.034, [
          S('mtStart', 'MISSION TIMER', ['START', 'STOP', 'RESET'], 0),
          S('mtHrs', 'HRS', ['UP', '', 'DN'], 1),
          S('mtMin', 'MIN', ['UP', '', 'DN'], 1),
          S('mtSec', 'SEC', ['UP', '', 'DN'], 1),
          S('etStart', 'EVENT TIMER', ['START', 'STOP', 'RESET'], 0),
        ]),
      ],
      boxes: [
        { x: -0.346, y: 0.03, w: 0.1, h: 0.105, title: 'SM RCS HELIUM 1' },
        { x: -0.226, y: 0.03, w: 0.1, h: 0.105, title: 'HELIUM 2' },
        { x: 0, y: 0.022, w: 0.3, h: 0.1, title: '' },
      ],
      labels: [{ text: 'CAUTION / WARNING', x: 0, y: 0.068, size: 0.0036 }],
    }, [
      { inst: cw, x: 0, y: 0.018 },
      { inst: mt, x: 0.29, y: 0.035 },
    ]);
    void p2top;

    // left column: FDAI 2, SM RCS propellant, sequential events, docking probe
    const fdai2 = INS.createFDAI({ size: 0.17 });
    panel('2L', P2, -0.27, -0.08, 0.3, 0.64, {
      talkbacks: [
        ...['A', 'B', 'C', 'D'].map((q, i) => TB(`tbPrp${q}`, -0.115 + i * 0.026, 0.083, 'grey', q)),
        ...['A', 'B', 'C', 'D'].map((q, i) => TB(`tbSec${q}`, 0.025 + i * 0.026, 0.083, 'grey', q)),
        TB('tbProbe1', -0.1, -0.198, 'grey'),
        TB('tbProbe2', -0.066, -0.198, 'grey'),
      ],
      switches: [
        ...row(0.028, -0.115, 0.026, ['A', 'B', 'C', 'D'].map((q) => S(`prp${q}`, '', ['OPEN', 'CLOSE'], 0))),
        ...row(0.028, 0.025, 0.026, ['A', 'B', 'C', 'D'].map((q) => S(`sec${q}`, '', ['OPEN', 'CLOSE'], 0))),
        ...row(-0.045, -0.12, 0.034, [
          S('rcsCmd', 'RCS CMD', ['ON', 'OFF'], 0),
          S('rcsTrnfr', 'RCS TRNFR', ['CM', 'SM'], 1),
          S('cmRcsHtrs', 'CM RCS\nHTRS', ONOFF, 1),
          S('smRcsHtrA', 'SM RCS HTR\nA', ['PRIM', 'OFF', 'SEC'], 0),
          S('smRcsHtrB', 'B', ['PRIM', 'OFF', 'SEC'], 0),
          S('smRcsHtrC', 'C', ['PRIM', 'OFF', 'SEC'], 0),
          S('smRcsHtrD', 'D', ['PRIM', 'OFF', 'SEC'], 0),
          S('prplntIsol', 'PRPLNT\nISOL', ['OPEN', 'CLOSE'], 1),
        ]),
        ...row(-0.125, -0.12, 0.034, [
          S('csmLmSep1', 'CSM/LM\nFINAL SEP', ['ON', 'OFF'], 1, { cover: 'red' }),
          S('csmLmSep2', '', ['ON', 'OFF'], 1, { cover: 'red' }),
          S('cmSmSep1', 'CM/SM\nSEP', ['ON', 'OFF'], 1, { cover: 'red' }),
          S('cmSmSep2', '', ['ON', 'OFF'], 1, { cover: 'red' }),
          S('sivbLmSep', 'S IVB/LM\nSEP', ['ON', 'OFF'], 1, { cover: 'red' }),
          S('apexCover', 'APEX\nCOVER JETT', ['ON', 'OFF'], 1, { cover: 'red' }),
          S('drogue', 'DROGUE\nDEPLOY', ['ON', 'OFF'], 1, { cover: 'red' }),
          S('mainDeploy', 'MAIN\nDEPLOY', ['ON', 'OFF'], 1, { cover: 'red' }),
        ]),
        ...row(-0.245, -0.12, 0.034, [
          S('probe1', 'DOCK PROBE', ['EXTD/\nREL', 'OFF', 'RETRACT'], 1, { guard: 'grey' }),
          S('probe2', '', ['EXTD/\nREL', 'OFF', 'RETRACT'], 1, { guard: 'grey' }),
          S('pyroA', 'PYRO\nARM A', ['ARM', 'SAFE'], 1, { cover: 'red' }),
          S('pyroB', 'B', ['ARM', 'SAFE'], 1, { cover: 'red' }),
          S('seqLogic1', 'SECS LOGIC\n1', ['ON', 'OFF'], 1, { cover: 'red' }),
          S('seqLogic2', '2', ['ON', 'OFF'], 1, { cover: 'red' }),
          S('seqArm1', 'SECS ARM\n1', ['ARM', 'OFF'], 1, { cover: 'red' }),
          S('seqArm2', '2', ['ARM', 'OFF'], 1, { cover: 'red' }),
        ]),
      ],
      boxes: [
        { x: -0.076, y: 0.058, w: 0.118, h: 0.078, title: 'SM RCS PRIM PRPLNT' },
        { x: 0.064, y: 0.058, w: 0.118, h: 0.078, title: 'SEC PRPLNT FUEL PRESS' },
        { x: 0, y: -0.108, w: 0.285, h: 0.075, title: 'SEQUENTIAL EVENTS CONTROL' },
      ],
      labels: [{ text: 'FDAI 2', x: 0, y: 0.305, size: 0.0036 }, { text: 'PANEL 2', x: 0.125, y: -0.308, size: 0.003 }],
    }, [{ inst: fdai2, x: 0, y: 0.205 }]);

    // centre column: SM RCS meters, CMC switches, DSKY
    const rcsMeters = createMeterCluster({
      title: 'SM RCS',
      systems: sys,
      height: 0.095,
      meters: [
        { label: 'He TK\nPRESS', min: 0, max: 5, ticks: [0, 1, 2, 3, 4, 5], pointers: [{ get: (v, g, s) => (s ? s.rcsHePress[0] / 1000 : 3) }] },
        { label: 'PRPLNT\nQTY', min: 0, max: 100, ticks: [0, 20, 40, 60, 80, 100], red: [0, 10], pointers: [{ get: (v, g, s) => (s ? s.rcsQty[0] : 70) }] },
        { label: 'MFLD\nPRESS', min: 0, max: 400, ticks: [0, 100, 200, 300, 400], pointers: [{ get: (v, g, s) => (s ? s.rcsMfldPress[0] : 181) }] },
      ],
    });
    const dsky = INS.createDSKY({ variant: 'CM' });
    panel('2C', P2, 0, -0.08, 0.24, 0.64, {
      rotaries: [{ id: 'rcsInd', x: 0.085, y: 0.235, positions: ['A', 'B', 'C', 'D'], index: 0, angles: [-45, -15, 15, 45], label: 'RCS IND', size: 0.9 }],
      switches: [
        ...row(0.13, -0.09, 0.045, [
          S('cmcAtt', 'CMC ATT', ['IMU', 'GDC'], 0),
          S('upTlmCmc', 'UP TLM\nCMC', ['ACCEPT', 'BLOCK'], 0),
          S('imuCage', 'IMU CAGE', ['ON', 'OFF'], 1, { cover: 'red' }),
          S('cmRcsPress', 'CM RCS\nPRESS', ['ON', 'OFF'], 1, { cover: 'red' }),
          S('ullage', 'DIRECT\nULLAGE', ['ON', 'OFF'], 1),
        ]),
        ...row(0.052, -0.09, 0.045, [
          S('edsAuto', 'EDS\nAUTO', ['ON', 'OFF'], 1),
          S('lvRate', 'LV RATE\nAUTO', ['ON', 'OFF'], 1),
          S('twrJett1', 'TWR JETT\n1', ['AUTO', 'OFF', 'ON'], 1, { cover: 'red' }),
          S('twrJett2', '2', ['AUTO', 'OFF', 'ON'], 1, { cover: 'red' }),
          S('elsLogic', 'ELS LOGIC', ['ON', 'OFF'], 1, { cover: 'red' }),
        ]),
        ...row(-0.285, -0.09, 0.045, [
          S('dskyPwr', 'CMC\nPOWER', ['ON', 'OFF'], 0, { guard: 'grey' }),
          S('optZero', 'OPT\nZERO', ['ZERO', 'OFF'], 1),
          S('imuPwr', 'IMU PWR', ['ON', 'OFF'], 0, { guard: 'grey' }),
          S('rndzXpndr', 'RNDZ\nXPNDR', ['OPERATE', 'OFF', 'HEAT'], 1),
          S('abortSys', 'CM RCS\nLOGIC', ['ON', 'OFF'], 1, { cover: 'red' }),
        ]),
      ],
      labels: [{ text: 'COMMAND MODULE COMPUTER', x: 0, y: -0.008, size: 0.0033 }],
    }, [
      { inst: rcsMeters, x: -0.045, y: 0.235 },
      { inst: dsky, x: 0, y: -0.132 },
    ]);

    // right column: SPS quantity, ECS meters, SPS & ECS switches
    const prop = INS.createPropellantGauges();
    const spsPress = createMeterCluster({
      systems: sys, height: 0.1, pitch: 0.036,
      meters: [{ label: 'SPS\nHe', min: 0, max: 5, ticks: [0, 1, 2, 3, 4, 5], pointers: [{ get: (v, g, s) => (s ? s.spsHe / 1000 : 3.6) }] }],
    });
    const ecs = createMeterCluster({
      title: 'ENVIRONMENTAL CONTROL',
      systems: sys, height: 0.1, pitch: 0.037,
      meters: [
        { label: 'PRESS\nSUIT CAB', min: 0, max: 16, ticks: [0, 4, 8, 12, 16], pointers: [{ get: (v, g, s) => (s ? s.suitPress : 4.8) }, { get: (v, g, s) => (s ? s.cabinPress : 5) }] },
        { label: 'PART\nPRESS CO2', min: 0, max: 30, ticks: [0, 5, 10, 15, 30], red: [7.6, 30], pointers: [{ get: (v, g, s) => (s ? s.co2 : 1.2) }] },
        { label: 'TEMP °F\nSUIT CAB', min: 20, max: 100, ticks: [20, 40, 60, 80, 100], pointers: [{ get: (v, g, s) => (s ? s.suitTemp : 55) }, { get: (v, g, s) => (s ? s.cabinTemp : 71) }] },
        { label: 'O2 FLOW\nLB/HR', min: 0.2, max: 1.0, ticks: [0.2, 0.4, 0.6, 0.8, 1.0], fmt: (x) => x.toFixed(1), pointers: [{ get: (v, g, s) => (s ? Math.max(0.2, s.o2Flow) : 0.25) }] },
        { label: 'GLY EVAP\nOUT TEMP', min: 25, max: 75, ticks: [25, 35, 45, 55, 65, 75], pointers: [{ get: (v, g, s) => (s ? s.glycolTemp : 45) }] },
        { label: 'ECS RAD\nOUT TEMP', min: -50, max: 100, ticks: [-50, 0, 50, 100], pointers: [{ get: (v, g, s) => (s ? 38 + 3 * Math.sin(g.time.met * 0.001) : 40) }] },
      ],
    });
    panel('2R', P2, 0.27, -0.08, 0.3, 0.64, {
      talkbacks: [
        TB('tbSpsHe1', -0.115, 0.005, 'grey'), TB('tbSpsHe2', -0.081, 0.005, 'grey'),
        TB('tbGlyRad', 0.045, 0.005, 'grey'), TB('tbSuitCompr', 0.079, 0.005, 'grey'),
      ],
      switches: [
        ...row(-0.045, -0.115, 0.034, [
          S('spsHe1', 'SPS He\nVLV 1', ['AUTO', 'OFF'], 0),
          S('spsHe2', '2', ['AUTO', 'OFF'], 0),
          S('spsLine', 'SPS LINE\nHTRS', ['A/B', 'OFF', 'A'], 1),
          S('spsPugs', 'PUGS\nMODE', ['PRIM', 'NORM', 'AUX'], 1),
          S('glyRad', 'GLY TO\nRAD', ['BYPASS', 'OFF'], 1),
          S('suitCompr1', 'SUIT\nCOMPR 1', ['AC1', 'OFF', 'AC2'], 0),
          S('suitCompr2', '2', ['AC1', 'OFF', 'AC2'], 1),
          S('cabinFan1', 'CABIN FAN\n1', ONOFF, 1),
        ]),
        ...row(-0.125, -0.115, 0.034, [
          S('cabinFan2', 'CABIN FAN\n2', ONOFF, 1),
          S('h2oAccum', 'H2O\nACCUM', ['AUTO 1', 'OFF', 'AUTO 2'], 0),
          S('primGly', 'PRIM GLY\nPUMPS', ['AC1', 'OFF', 'AC2'], 0),
          S('secGly', 'SEC\nCOOLANT', ['AC1', 'OFF', 'AC2'], 1),
          S('ecsRad', 'ECS RAD\nFLOW', ['AUTO', 'PWR 1', 'PWR 2'], 0),
          S('evapH2o', 'EVAP\nH2O', ['AUTO', 'OFF', 'ON'], 1),
          S('evapStm', 'EVAP\nSTEAM', ['AUTO', 'OFF', 'ON'], 1),
          S('potH2o', 'POT H2O\nHTR', ['MNA', 'OFF', 'MNB'], 0),
        ]),
        ...row(-0.205, -0.115, 0.034, [
          S('sBandNorm', 'S BAND\nNORMAL', ['VOICE', 'RELAY', 'OFF'], 0),
          S('pcm', 'PCM', ['HIGH', 'LOW'], 0),
          S('rngCmd', 'RANGE', ['RANGE', 'OFF'], 0),
          S('vhfAmA', 'VHF AM\nA', ['SIMPLEX', 'DUPLEX', 'OFF'], 0),
          S('vhfAmB', 'B', ['SIMPLEX', 'DUPLEX', 'OFF'], 2),
          S('vhfBcn', 'VHF\nBEACON', ONOFF, 1),
          S('vhfRng', 'VHF\nRANGING', ['RANGING', 'OFF'], 1),
          S('tapeRec', 'TAPE REC', ['RECORD', 'OFF', 'PLAY'], 1),
        ]),
        ...row(-0.275, -0.115, 0.034, [
          S('mnA', 'SIG CONDR\nMNA', ['ON', 'OFF'], 0),
          S('mnB', 'MNB', ['ON', 'OFF'], 0),
          S('upTlmCm', 'UP TLM\nCM', ['DATA', 'OFF', 'RESET'], 0),
          S('upTlmIu', 'IU', ['ACCEPT', 'BLOCK'], 1),
          S('pmp', 'PMP', ['PWR', 'OFF'], 0),
          S('sBandAux', 'S BAND\nAUX', ['TAPE', 'OFF', 'TV'], 1),
          S('ants', 'ANT', ['OMNI', 'HGA'], 0),
          S('omni', 'OMNI', ['A', 'B', 'C', 'D'].slice(0, 3), 1),
        ]),
      ],
      boxes: [
        { x: -0.098, y: -0.03, w: 0.075, h: 0.07, title: 'SPS' },
        { x: 0.0, y: -0.24, w: 0.285, h: 0.15, title: 'TELECOMMUNICATIONS' },
      ],
    }, [
      { inst: prop, x: -0.03, y: 0.245 },
      { inst: spsPress, x: 0.105, y: 0.245 },
      { inst: ecs, x: -0.015, y: 0.115 },
    ]);
  }

  // ================================================================== PANEL 3 — LMP
  {
    const ma = INS.createMasterAlarm({ size: 0.042 });
    const fc = createMeterCluster({
      title: 'FUEL CELL',
      systems: sys, height: 0.11, pitch: 0.036,
      meters: [
        { label: 'H2 FLOW\nLB/HR', min: 0, max: 0.2, ticks: [0, 0.05, 0.1, 0.15, 0.2], fmt: (x) => x.toFixed(2).replace(/^0/, ''), pointers: [{ get: (v, g, s) => (s ? s.fc[0].h2Flow : 0.06) }] },
        { label: 'O2 FLOW\nLB/HR', min: 0, max: 1.6, ticks: [0, 0.4, 0.8, 1.2, 1.6], fmt: (x) => x.toFixed(1), pointers: [{ get: (v, g, s) => (s ? s.fc[0].o2Flow : 0.45) }] },
        { label: 'MODULE\nTEMP °F', min: 100, max: 500, ticks: [100, 200, 300, 400, 500], red: [475, 500], pointers: [{ get: (v, g, s) => (s ? s.fc[0].skinTemp : 405) }] },
        { label: 'COND EXH\nTEMP °F', min: 145, max: 250, ticks: [145, 175, 200, 225, 250], red: [145, 150], pointers: [{ get: (v, g, s) => (s ? s.fc[0].condTemp : 162) }] },
      ],
    });
    const cryo = createMeterCluster({
      title: 'CRYOGENIC TANKS',
      systems: sys, height: 0.11, pitch: 0.036,
      meters: [
        { label: 'H2\nPRESS', min: 0, max: 400, ticks: [0, 100, 200, 300, 400], pointers: [{ get: (v, g, s) => (s ? s.h2Press[0] : 235) }, { get: (v, g, s) => (s ? s.h2Press[1] : 237) }] },
        { label: 'O2\nPRESS', min: 50, max: 1050, ticks: [50, 300, 550, 800, 1050], pointers: [{ get: (v, g, s) => (s ? s.o2Press[0] : 900) }, { get: (v, g, s) => (s ? s.o2Press[1] : 900) }] },
        { label: 'H2\nQTY', min: 0, max: 100, ticks: [0, 25, 50, 75, 100], pointers: [{ get: (v, g, s) => (s ? s.h2Qty[0] : 55) }, { get: (v, g, s) => (s ? s.h2Qty[1] : 56) }] },
        { label: 'O2\nQTY', min: 0, max: 100, ticks: [0, 25, 50, 75, 100], pointers: [{ get: (v, g, s) => (s ? s.o2Qty[0] : 60) }, { get: (v, g, s) => (s ? s.o2Qty[1] : 61) }] },
      ],
    });
    panel('3A', P3, 0, 0.17, P3.w, 0.4, {
      rotaries: [{ id: 'fcInd', x: -0.155, y: 0.013, positions: ['1', '2', '3'], index: 0, angles: [-30, 0, 30], label: 'FC IND SEL', size: 0.9 }],
      talkbacks: [
        ...[1, 2, 3].map((k, i) => TB(`tbFcRad${k}`, 0.02 + i * 0.03, 0.02, 'grey')),
        ...[1, 2, 3].map((k, i) => TB(`tbFcReac${k}`, 0.13 + i * 0.03, 0.02, 'grey')),
      ],
      switches: [
        ...row(-0.035, 0.02, 0.03, [1, 2, 3].map((k) => S(`fcRad${k}`, k === 1 ? 'FC RAD' : '', ['NORM', 'BYPASS'], 0))),
        ...row(-0.035, 0.13, 0.03, [1, 2, 3].map((k) => S(`fcReac${k}`, k === 1 ? 'FC REACS' : '', ['ON', 'OFF'], 0))),
        ...row(-0.035, -0.235, 0.034, [
          S('fcPurge1', 'FC PURGE\n1', ['H2', 'OFF', 'O2'], 1),
          S('fcPurge2', '2', ['H2', 'OFF', 'O2'], 1),
          S('fcPurge3', '3', ['H2', 'OFF', 'O2'], 1),
        ]),
        ...row(-0.105, -0.235, 0.034, [
          S('h2Htr1', 'H2 HTRS\n1', ['AUTO', 'OFF', 'ON'], 0),
          S('h2Htr2', '2', ['AUTO', 'OFF', 'ON'], 0),
          S('o2Htr1', 'O2 HTRS\n1', ['AUTO', 'OFF', 'ON'], 0),
          S('o2Htr2', '2', ['AUTO', 'OFF', 'ON'], 0),
          S('h2Fan1', 'H2 FANS\n1', ['AUTO', 'OFF', 'ON'], 0),
          S('h2Fan2', '2', ['AUTO', 'OFF', 'ON'], 0),
          S('o2Fan1', 'O2 FANS\n1', ['AUTO', 'OFF', 'ON'], 0),
          S('o2Fan2', '2', ['AUTO', 'OFF', 'ON'], 0),
          S('cryoPress', 'CRYO\nPRESS IND', ['SURGE\nTK', 'OFF', '3'], 1),
          S('fcHtr1', 'FC HTR\n1', ONOFF, 1),
          S('fcHtr2', '2', ONOFF, 1),
          S('fcHtr3', '3', ONOFF, 1),
          S('fcPump1', 'FC PUMP\n1', ['AC1', 'OFF', 'AC2'], 0),
          S('fcPump2', '2', ['AC1', 'OFF', 'AC2'], 2),
        ]),
        ...row(-0.168, -0.235, 0.034, [
          S('invCtl1', 'INV CTL\n1', ['MNA', 'OFF', 'MNB'], 0),
          S('invCtl2', '2', ['MNA', 'OFF', 'MNB'], 2),
          S('invCtl3', '3', ['MNA', 'OFF', 'MNB'], 1),
          S('acB1', 'AC BUS 1\nINV', ['1', '2', '3'], 0),
          S('acB2', 'AC BUS 2\nINV', ['1', '2', '3'], 1),
          S('acReset', 'AC BUS\nRESET', ['RESET', 'OFF'], 1),
          S('nonEss', 'NON ESS\nBUS', ['MNA', 'OFF', 'MNB'], 0),
          S('batChg', 'BAT\nCHARGER', ['A', 'B', 'C'], 1),
          S('batBusA', 'MN BUS TIE\nBAT A/C', ['ON', 'OFF'], 1),
          S('batBusB', 'BAT B/C', ['ON', 'OFF'], 1),
          S('sps1', 'SPS\nGAUGING', ['AC1', 'OFF', 'AC2'], 0),
          S('lampInt', 'TELCOM\nGRP 1', ['AC1', 'OFF', 'AC2'], 0),
          S('lampInt2', 'GRP 2', ['AC1', 'OFF', 'AC2'], 2),
          S('ptt', 'ACK', ['NORM', 'ACK'], 0),
        ]),
      ],
      boxes: [
        { x: 0.05, y: 0.0, w: 0.1, h: 0.075, title: 'FC RADIATORS' },
        { x: 0.16, y: 0.0, w: 0.1, h: 0.075, title: 'FC REACTANTS' },
        { x: -0.02, y: -0.12, w: 0.495, h: 0.035, title: '' },
      ],
      labels: [{ text: '3', x: 0.25, y: 0.187, size: 0.005 }, { text: 'ELECTRICAL POWER', x: -0.02, y: 0.186, size: 0.0038 }],
    }, [
      { inst: ma, x: 0.215, y: 0.16 },
      { inst: fc, x: -0.155, y: 0.105 },
      { inst: cryo, x: 0.04, y: 0.105 },
    ]);

    const dcac = createMeterCluster({
      title: 'DC / AC',
      systems: sys, height: 0.105, pitch: 0.038,
      meters: [
        { label: 'DC\nVOLTS', min: 20, max: 45, ticks: [20, 25, 30, 35, 40, 45], red: [20, 26.2], pointers: [{ get: (v, g, s) => (s ? s.busA : 28.8) }] },
        { label: 'DC\nAMPS', min: 0, max: 100, ticks: [0, 25, 50, 75, 100], pointers: [{ get: (v, g, s) => (s ? s.dcAmps : 66) }] },
        { label: 'AC\nVOLTS', min: 90, max: 130, ticks: [90, 100, 110, 120, 130], red: [90, 95], pointers: [{ get: (v, g, s) => (s ? s.acVolts : 116) }] },
        { label: 'FC\nAMPS', min: 0, max: 100, ticks: [0, 25, 50, 75, 100], pointers: [{ get: (v, g, s) => (s ? s.fc[0].amps : 22) }] },
      ],
    });
    const sig = createMeterCluster({
      systems: sys, height: 0.105, pitch: 0.036,
      meters: [{ label: 'S BAND\nSIG STR', min: 0, max: 5, ticks: [0, 1, 2, 3, 4, 5], pointers: [{ get: (v, g, s) => (s ? s.sbandSignal * 5 : 3.5) }] }],
    });
    panel('3B', P3, 0, -0.2, P3.w, 0.34, {
      rotaries: [
        { id: 'dcInd', x: -0.235, y: 0.02, positions: ['FC1', 'FC2', 'FC3', 'MNA', 'MNB', 'BAT C'], index: 3, angles: [-75, -45, -15, 15, 45, 75], label: 'DC IND', size: 0.9 },
        { id: 'acInd', x: -0.07, y: 0.02, positions: ['1ΦA', '1ΦB', '1ΦC', '2ΦA', '2ΦB', '2ΦC'], index: 0, angles: [-75, -45, -15, 15, 45, 75], label: 'AC IND', size: 0.9 },
      ],
      thumbwheels: [
        { id: 'hgaP', x: 0.13, y: 0.035, digits: 2, value: 45, label: 'HGA PITCH' },
        { id: 'hgaY', x: 0.2, y: 0.035, digits: 3, value: 180, label: 'YAW' },
      ],
      talkbacks: [
        ...[1, 2, 3].map((k, i) => TB(`tbFcMnA${k}`, -0.235 + i * 0.034, -0.045, 'grey')),
        ...[1, 2, 3].map((k, i) => TB(`tbFcMnB${k}`, -0.13 + i * 0.034, -0.045, 'grey')),
        TB('tbBatA', 0.0, -0.045, 'grey'), TB('tbBatB', 0.034, -0.045, 'grey'),
      ],
      switches: [
        ...row(-0.085, -0.235, 0.034, [1, 2, 3].map((k) => S(`fcMnA${k}`, k === 1 ? 'FC → MN A' : '', ['ON', '', 'OFF'], 0))),
        ...row(-0.085, -0.13, 0.034, [1, 2, 3].map((k) => S(`fcMnB${k}`, k === 1 ? 'FC → MN B' : '', ['ON', '', 'OFF'], k === 2 ? 0 : 2))),
        ...row(-0.085, 0.0, 0.034, [S('mnBatA', 'MAIN A\nBAT', ['ON', '', 'OFF'], 2), S('mnBatB', 'MAIN B\nBAT', ['ON', '', 'OFF'], 2)]),
        ...row(-0.085, 0.09, 0.034, [
          S('hgaPwr', 'HGA\nPWR', ['PWR', 'OFF'], 0),
          S('hgaTrack', 'TRACK', ['AUTO', 'REACQ', 'MAN'], 1),
          S('hgaBeam', 'BEAM', ['WIDE', 'MED', 'NAR'], 2),
          S('hgaServo', 'SERVO\nELEC', ['PRIM', 'SEC'], 0),
        ]),
        ...row(-0.148, -0.235, 0.034, [
          S('audioCtl', 'AUDIO\nCONTROL', ['NORM', 'BACKUP'], 0),
          S('suitPwr', 'SUIT\nPOWER', ONOFF, 0),
          S('vhfAntL', 'VHF\nANTENNA', ['LEFT', 'RIGHT', 'RCVY'], 0),
          S('gmtLight', 'FLOOD\nLMP', ['DIM 1', 'OFF', 'DIM 2'], 0),
          S('psmMode', 'PWR\nAMPL', ['PRIM', 'SEC'], 0),
          S('psmPwr', 'MODE', ['HIGH', 'LOW'], 0),
          S('sBandSq', 'S BAND\nSQUELCH', ['ENABLE', 'OFF'], 0),
          S('dataStr', 'DATA\nSTORAGE', ['TAPE', 'OFF'], 1),
          S('tapeSpd', 'TAPE\nSPEED', ['HI', 'LO'], 1),
          S('tvCam', 'TV\nCAMERA', ONOFF, 1),
          S('sceTel', 'SCE\nPWR', ['NORM', 'OFF', 'AUX'], 0),
          S('pcmBit', 'PCM\nBIT', ['HI', 'LO'], 0),
          S('xpndr', 'S BAND\nXPNDR', ['PRIM', 'SEC'], 0),
          S('ipp', 'IPU', ['PRIM', 'SEC'], 0),
        ]),
      ],
      boxes: [
        { x: 0.1, y: 0.02, w: 0.155, h: 0.1, title: 'HIGH GAIN ANTENNA' },
      ],
    }, [
      { inst: dcac, x: -0.155, y: 0.1 },
      { inst: sig, x: 0.205, y: 0.1 },
    ]);
  }

  // ================================================================== console structure
  const B = new Batch('CSMCabin:mdcBody');
  const D = MDC.depth;
  for (const [k, F] of Object.entries(sections)) {
    const hw = F.w / 2;
    const hh = F.h / 2;
    const t = 0.012;
    // hollow box: top, bottom, back, sides (no front — instruments sit in the cut-outs)
    const mk = (g, u, v, n) => B.add('structure', onFrame(g, F, u, v, n));
    mk(new THREE.BoxGeometry(F.w + 0.02, t, D), 0, hh + t / 2 + 0.001, -D / 2 + 0.006);
    // painted top cover (seams, fastener rows, access cover, wear) — seen from the rendezvous station
    if (ctx.coaming) {
      const top = new THREE.PlaneGeometry(F.w + 0.02, D);
      top.rotateX(-Math.PI / 2); // faces the panel's +y; uv v = 1 at the back edge
      const row = ctx.coaming.row(['P1', 'P2', 'P3'].indexOf(k));
      const uv = top.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * row.u1, row.v0 + uv.getY(i) * row.dv);
      B.add('coaming', onFrame(top, F, 0, hh + t + 0.0016, -D / 2 + 0.006));
    }
    mk(new THREE.BoxGeometry(F.w + 0.02, t, D), 0, -hh - t / 2 - 0.001, -D / 2 + 0.006);
    B.add('structDark', onFrame(new THREE.BoxGeometry(F.w, F.h, 0.01), F, 0, 0, -D + 0.01));
    if (k !== 'P2') mk(new THREE.BoxGeometry(t, F.h + 0.024, D), (k === 'P1' ? -1 : 1) * (hw + t / 2), 0, -D / 2 + 0.006);
    // raised trim rail around the face
    const r = 0.014;
    const rd = 0.012;
    B.add('structure', onFrame(new THREE.BoxGeometry(F.w + 0.02, r, rd), F, 0, hh + r / 2 - 0.004, rd / 2 - 0.004));
    B.add('structure', onFrame(new THREE.BoxGeometry(F.w + 0.02, r, rd), F, 0, -hh - r / 2 + 0.004, rd / 2 - 0.004));
  }
  // corner posts between the sections (hinge lines) and outer end caps
  for (const side of [-1, 1]) {
    const F = sections.P2;
    const a = F.point(side * (F.w / 2 + 0.004), -F.h / 2 - 0.008, 0.004);
    const b = F.point(side * (F.w / 2 + 0.004), F.h / 2 + 0.008, 0.004);
    const g = new THREE.CylinderGeometry(0.009, 0.009, a.distanceTo(b), 10);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), V().subVectors(b, a).normalize()));
    g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    B.add('structure', g);
  }
  group.add(B.build(mat));

  void DEG;
  return { group, instruments, controls, panels, sections };
}
