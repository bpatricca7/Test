// Lower Equipment Bay of the Command Module (CSM-CABIN agent): the guidance & navigation station
// at the crew's feet.
//
//   G&N console (angled along the cone):
//     left   DSKY #2 (the navigator's DSKY), second mission timer, LEB lighting
//     centre panel 122: the optics — sextant (SXT) and scanning telescope (SCT) eyepieces with
//            rubber eyecups in their shroud, G&N MASTER ALARM, optics mode/speed/coupling switches,
//            condition lamps
//     right  panel 121: optics hand controller & minimum-impulse controller, optics zero,
//            IMU/CMC power, trunnion/shaft counters
//   closeout panels 100/101 between the G&N console and the underside of the MDC: SYSTEMS TEST
//   meter & selectors, utility power outlets, rendezvous transponder, LEB floodlight
import * as THREE from 'three';
import * as KIT from '../kit/index.js';
import * as INS from '../instruments/index.js';
import { lebFrames, Frame } from './layout.js';
import { V, Batch, placeOnFrame, onFrame, roundBox, cylBetween, lathe } from './geom.js';
import { createMeterCluster } from './meters.js';

const S = (id, label, positions, state = 0, extra = {}) => ({ id, label, positions, state, ...extra });
const row = (y, x0, dx, specs) => specs.map((s, i) => ({ ...s, x: x0 + i * dx, y }));

/** Sub-frame of a frame: centre at local (u, v), same axes, size w × h. */
const sub = (F, u, v, w, h) => new Frame(F.point(u, v, 0), F.x, F.y, w, h);

/**
 * @param {(key: string) => THREE.Material} mat
 * @param {object} ctx { systems }
 * @returns {{group, instruments, controls, frames}}
 */
export function buildLEB(mat, ctx = {}) {
  const { GN, CL } = lebFrames();
  const group = new THREE.Group();
  group.name = 'CSMCabin:LEB';
  const instruments = [];
  const controls = new Map();
  const B = new Batch('CSMCabin:lebBody');

  function panel(id, F, spec, mounts = []) {
    const holes = [...(spec.holes || [])];
    for (const m of mounts) holes.push({ x: m.x, y: m.y, w: m.inst.mountHole.w, h: m.inst.mountHole.h, corner: 0.002 });
    const p = KIT.createPanel({ width: F.w - 0.004, height: F.h - 0.004, depth: 0.01, pxPerM: Math.round(2400 * (ctx.texScale ?? 1)), screws: 'dzus', name: `CM PANEL ${id}`, wear: 0.55, ...spec, holes });
    for (const m of mounts) {
      m.inst.object.position.set(m.x, m.y, 0);
      p.add(m.inst.object);
      instruments.push(m.inst);
    }
    placeOnFrame(p, F, 0, 0, 0);
    group.add(p);
    for (const [k, v] of p.controls) controls.set(k, v);
    return p;
  }

  // ---------------------------------------------------------------- console body (hollow box)
  const D = 0.22;
  const hollow = (F) => {
    B.add('structure', onFrame(new THREE.BoxGeometry(F.w + 0.02, 0.012, D), F, 0, F.h / 2 + 0.006, -D / 2));
    B.add('structure', onFrame(new THREE.BoxGeometry(F.w + 0.02, 0.012, D), F, 0, -F.h / 2 - 0.006, -D / 2));
    B.add('structDark', onFrame(new THREE.BoxGeometry(F.w, F.h, 0.01), F, 0, 0, -D));
    for (const s of [-1, 1]) B.add('structure', onFrame(new THREE.BoxGeometry(0.012, F.h + 0.024, D), F, s * (F.w / 2 + 0.006), 0, -D / 2));
  };
  hollow(GN);
  hollow(CL);

  // ---------------------------------------------------------------- G&N console: left (DSKY 2)
  const L = sub(GN, -0.36, 0, 0.36, GN.h);
  const dsky2 = INS.createDSKY({ variant: 'CM' });
  const mt2 = INS.createMissionTimer({ label: 'MISSION TIMER' });
  panel('LEB-L', L, {
    switches: [
      ...row(-0.215, -0.1, 0.05, [
        S('lebFlood', 'LEB FLOOD', ['BRT', 'OFF', 'DIM'], 0),
        S('lebNum', 'NUMERICS', ['BRT', 'OFF', 'DIM'], 0),
        S('lebInt', 'INTEGRAL', ['BRT', 'OFF', 'DIM'], 0),
        S('mt2Start', 'TIMER', ['START', 'STOP', 'RESET'], 0),
        S('lebDsky', 'DSKY', ['ON', 'OFF'], 0),
      ]),
    ],
    labels: [{ text: 'PANEL 140', x: 0.13, y: -0.285, size: 0.003 }],
  }, [
    { inst: dsky2, x: 0, y: 0.13 },
    { inst: mt2, x: 0, y: -0.07 },
  ]);

  // ---------------------------------------------------------------- centre: optics (panel 122)
  const Cf = sub(GN, 0, 0, 0.36, GN.h);
  const ma3 = INS.createMasterAlarm({ size: 0.04 });
  panel('122', Cf, {
    switches: [
      ...row(-0.12, -0.14, 0.047, [
        S('optMode', 'OPTICS\nMODE', ['MANUAL', 'ZERO', 'CMC'], 0),
        S('optZero', 'ZERO\nOPTICS', ['ZERO', 'OFF'], 1),
        S('optSpeed', 'SPEED', ['HI', 'MED', 'LO'], 1),
        S('optCoupl', 'COUPLING', ['DIRECT', 'RESOLVED'], 1),
        S('condLamps', 'CONDITION\nLAMPS', ['ON', 'OFF'], 0),
      ]),
      ...row(-0.2, -0.14, 0.047, [
        S('gnPwr', 'G&N\nPOWER', ['AC1', 'AC2'], 0),
        S('gnImu', 'G&N\nIMU', ['ON', 'OFF'], 0, { guard: 'grey' }),
        S('gnCmc', 'G&N\nCMC', ['ON', 'OFF'], 0, { guard: 'grey' }),
        S('gnOpt', 'G&N\nOPTICS', ['ON', 'OFF'], 0),
        S('upTlmLeb', 'UP TLM', ['ACCEPT', 'BLOCK'], 0),
      ]),
    ],
    lamps: [
      { id: 'lpIsol', x: -0.14, y: -0.05, color: 'amber', label: 'CMC' },
      { id: 'lpIss', x: -0.1, y: -0.05, color: 'amber', label: 'ISS' },
      { id: 'lpOpt', x: -0.06, y: -0.05, color: 'amber', label: 'OPT' },
    ],
    labels: [{ text: 'PANEL 122  —  GUIDANCE & NAVIGATION', x: 0, y: -0.28, size: 0.003 }],
  }, [{ inst: ma3, x: 0.12, y: -0.05 }]);

  // optics shroud & eyepieces (stand proud of panel 122)
  {
    const shroud = roundBox(0.28, 0.17, 0.1, 0.03, 0.012, 4);
    B.add('structure', onFrame(shroud, Cf, 0, 0.14, 0.05));
    B.add('structDark', onFrame(roundBox(0.24, 0.12, 0.012, 0.02), Cf, 0, 0.14, 0.1));
    for (const [u, name] of [[-0.06, 'SCT'], [0.06, 'SXT']]) {
      // eyepiece barrel along the panel normal, tilted a little toward the navigator's head (+v)
      const base = Cf.point(u, 0.14, 0.1);
      const dir = Cf.z.clone().multiplyScalar(0.94).addScaledVector(Cf.y, 0.34).normalize();
      const a = base.clone();
      const b = base.clone().addScaledVector(dir, 0.085);
      const c = base.clone().addScaledVector(dir, 0.115);
      B.add('black', cylBetween(a, b, 0.023, 0.02, 20));
      B.add('alu', cylBetween(b.clone().addScaledVector(dir, -0.012), b.clone().addScaledVector(dir, -0.004), 0.0225, 0.0225, 20));
      // soft rubber eyecup (flared)
      const cup = lathe([[0.012, 0], [0.021, 0], [0.024, 0.012], [0.028, 0.028], [0.026, 0.03], [0.018, 0.012], [0.012, 0.004]], 20);
      cup.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), dir));
      cup.translate(b.x, b.y, b.z);
      B.add('rubber', cup);
      // diopter ring
      B.add('black', cylBetween(b.clone().addScaledVector(dir, -0.035), b.clone().addScaledVector(dir, -0.025), 0.026, 0.026, 20));
      void c;
      void name;
    }
  }

  // ---------------------------------------------------------------- right: panel 121 & hand controllers
  const Rf = sub(GN, 0.36, 0, 0.36, GN.h);
  panel('121', Rf, {
    switches: [
      ...row(0.2, -0.12, 0.048, [
        S('optHc', 'OPT HAND\nCONTR', ['ON', 'OFF'], 0),
        S('mic', 'MIN IMP\nCONTR', ['ON', 'OFF'], 0),
        S('attCtl', 'ATT\nCONTROL', ['LEB', 'MDC'], 1),
        S('lebCmc', 'CMC\nMODE', ['FREE', 'HOLD'], 1),
        S('lebUtil', 'UTILITY\nPWR', ['ON', 'OFF'], 1),
      ]),
      ...row(0.12, -0.12, 0.048, [
        S('trunnion', 'TRUNNION', ['FAST', 'SLOW'], 1),
        S('shaft', 'SHAFT', ['FAST', 'SLOW'], 1),
        S('reticle', 'RETICLE\nBRT', ['BRT', 'DIM'], 0),
        S('lebAudio', 'AUDIO\nCMP', ['NORM', 'BACKUP'], 0),
        S('lebPtt', 'PTT', ['ON', 'OFF'], 1),
      ]),
    ],
    thumbwheels: [
      { id: 'shaftCtr', x: -0.07, y: 0.045, digits: 3, value: 124, label: 'SHAFT' },
      { id: 'trunCtr', x: 0.02, y: 0.045, digits: 2, value: 37, label: 'TRUNNION' },
    ],
    labels: [{ text: 'OPTICS', x: -0.1, y: -0.065, size: 0.0034 }, { text: 'MIN IMPULSE', x: 0.08, y: -0.065, size: 0.0034 }, { text: 'PANEL 121', x: 0.125, y: -0.285, size: 0.003 }],
  });
  // optics hand controller (left) and minimum impulse controller (right): small black T-grips
  for (const [u, kind] of [[-0.1, 'ohc'], [0.08, 'mic']]) {
    const base = Rf.point(u, -0.14, 0.005);
    B.add('structure', onFrame(roundBox(0.06, 0.07, 0.03, 0.008), Rf, u, -0.14, 0.015));
    B.add('rubber', onFrame(new THREE.CylinderGeometry(0.018, 0.022, 0.02, 16).rotateX(Math.PI / 2), Rf, u, -0.14, 0.04));
    const top = base.clone().addScaledVector(Rf.z, 0.1);
    B.add('black', cylBetween(base.clone().addScaledVector(Rf.z, 0.04), top, 0.007, 0.007, 10));
    if (kind === 'ohc') {
      B.add('black', cylBetween(top.clone().addScaledVector(Rf.x, -0.03), top.clone().addScaledVector(Rf.x, 0.03), 0.01, 0.01, 12));
    } else {
      B.add('black', new THREE.SphereGeometry(0.014, 14, 10).translate(top.x, top.y, top.z));
    }
  }

  // ---------------------------------------------------------------- closeout panels 100/101
  const sysTest = createMeterCluster({
    systems: ctx.systems, height: 0.1, pitch: 0.042,
    meters: [{ label: 'SYSTEMS\nTEST', min: 0, max: 5, ticks: [0, 1, 2, 3, 4, 5], pointers: [{ get: (v, g, s) => (s ? 2.6 + 0.4 * Math.sin(g.time.met * 0.05) : 2.5) }] }],
  });
  panel('101', CL, {
    rotaries: [
      { id: 'sysTestL', x: -0.28, y: 0.19, positions: ['1', '2', '3', '4', '5'], index: 2, angles: [-60, -30, 0, 30, 60], label: 'SYSTEM TEST', size: 1 },
      { id: 'sysTestR', x: -0.2, y: 0.19, positions: ['A', 'B', 'C', 'D'], index: 1, angles: [-45, -15, 15, 45], label: '', size: 1 },
    ],
    switches: [
      ...row(0.2, 0.08, 0.05, [
        S('rndzXp', 'RNDZ\nXPNDR', ['OPERATE', 'OFF', 'HEAT'], 1),
        S('lebLtg', 'LEB\nLIGHTS', ['ON', 'OFF'], 0),
        S('dockLt', 'DOCKING\nLIGHTS', ['HI', 'OFF', 'LO'], 1),
        S('runEva', 'RUN/EVA\nLIGHTS', ['EVA', 'OFF', 'RUN'], 1),
        S('rndzLt', 'RNDZ\nLIGHTS', ['ON', 'OFF'], 1),
      ]),
      ...row(0.1, 0.08, 0.05, [
        S('cmRcsHtr2', 'CM RCS\nHTRS', ['ON', 'OFF'], 1),
        S('wasteDump', 'WASTE H2O\nDUMP HTR', ['A', 'OFF', 'B'], 1),
        S('urineDump', 'URINE\nDUMP HTR', ['A', 'OFF', 'B'], 1),
        S('cabinTemp', 'CABIN\nTEMP', ['AUTO', 'MAN'], 0),
        S('suitCircuit', 'SUIT CKT\nRETURN', ['OPEN', 'CLOSE'], 0),
      ]),
    ],
    labels: [{ text: 'PANEL 101', x: 0.36, y: -0.28, size: 0.003 }, { text: 'PANEL 100', x: -0.36, y: -0.28, size: 0.003 }],
    lines: [{ x1: 0, y1: -0.3, x2: 0, y2: 0.3, width: 0.0012 }],
  }, [{ inst: sysTest, x: -0.36, y: 0.19 }]);
  // utility power outlets (round connectors) on panel 100
  for (const [u, v] of [[-0.33, 0.02], [-0.25, 0.02], [-0.33, -0.08], [-0.25, -0.08]]) {
    B.add('alu', onFrame(new THREE.CylinderGeometry(0.016, 0.016, 0.012, 18).rotateX(Math.PI / 2), CL, u, v, 0.006));
    B.add('black', onFrame(new THREE.CylinderGeometry(0.011, 0.011, 0.014, 18).rotateX(Math.PI / 2), CL, u, v, 0.008));
  }
  group.add(B.build(mat));
  return { group, instruments, controls, frames: { GN, CL, L, C: Cf, R: Rf } };
}
