// Side consoles of the Command Module (CSM-CABIN agent).
//
//   Panel 8  (CDR, left)   circuit breakers (SCS, ELS, SECS, EDS...), the floodlight / integral /
//                          numerics dimmers, float bag and ELS switches
//   Panel 15 (CDR, left, aft of 8)  COAS & utility power, UP TLM, EMS / ELS switches
//   Panel 5  (LMP, right)  circuit breakers (fuel cells, inverters, ECS, cryo), fuel-cell pumps,
//                          LMP floodlight dimmers
//   Panel 16 (LMP, right, aft of 5)  batteries & SM RCS circuit breakers
// Each sits on a closed console box reaching back to the pressure vessel.
import * as THREE from 'three';
import * as KIT from '../kit/index.js';
import { sidePanels } from './layout.js';
import { Batch, placeOnFrame, onFrame } from './geom.js';

const S = (id, label, positions, state = 0, extra = {}) => ({ id, label, positions, state, ...extra });
const row = (y, x0, dx, specs) => specs.map((s, i) => ({ ...s, x: x0 + i * dx, y }));

/**
 * @param {(key: string) => THREE.Material} mat
 * @returns {{group: THREE.Group, controls: Map, panels: object, frames: object}}
 */
export function buildSidePanels(mat, opts = {}) {
  const F = sidePanels();
  const group = new THREE.Group();
  group.name = 'CSMCabin:sidePanels';
  const controls = new Map();
  const panels = {};
  const B = new Batch('CSMCabin:sideBody');

  function panel(id, frame, spec) {
    const p = KIT.createPanel({ width: frame.w, height: frame.h, depth: 0.01, pxPerM: Math.round(2600 * (opts.texScale ?? 1)), screws: 'dzus', name: `CM PANEL ${id}`, wear: 0.5, ...spec });
    placeOnFrame(p, frame, 0, 0, 0);
    group.add(p);
    panels[id] = p;
    for (const [k, v] of p.controls) controls.set(k, v);
    // console box behind the panel (to the wall) and a raised rim
    const d = 0.26;
    B.add('structure', onFrame(new THREE.BoxGeometry(frame.w + 0.02, frame.h + 0.02, d), frame, 0, 0, -d / 2 - 0.011));
    return p;
  }

  // ---------------------------------------------------------------- panel 8 (CDR left)
  {
    const rowsCB = ['SCS', 'ELS/SECS', 'EDS', 'FLOAT BAG', 'LTG'];
    const cbLabels = [
      ['LOGIC\nBUS 1', 'LOGIC\nBUS 2', 'BMAG 1', 'BMAG 2', 'ECA\nAUTO', 'ECA\nRATE', 'DIRECT\nRCS 1', 'DIRECT\nRCS 2', 'SIG\nCONDR', 'TVC\nAC1', 'TVC\nAC2', 'FDAI'],
      ['ELS A', 'ELS B', 'SECS\nARM A', 'SECS\nARM B', 'LOGIC\nA', 'LOGIC\nB', 'PYRO\nA', 'PYRO\nB', 'SEQ\nA', 'SEQ\nB', 'ELS\nBAT A', 'ELS\nBAT B'],
      ['EDS 1', 'EDS 2', 'EDS 3', 'LV\nIND', 'ABORT\nA', 'ABORT\nB', 'UPLM\nMNA', 'UPLM\nMNB', 'CW\nMNA', 'CW\nMNB', 'EMS\nMNA', 'EMS\nMNB'],
      ['FLOAT\nBAG 1', 'FLOAT\nBAG 2', 'FLOAT\nBAG 3', 'UTIL\nMNA', 'UTIL\nMNB', 'SPS\nGAUGE', 'CM RCS\nHTR', 'SM RCS\nHTR A', 'SM RCS\nHTR B', 'SM RCS\nHTR C', 'SM RCS\nHTR D', 'DOCK\nPROBE'],
      ['FLOOD\nMNA', 'FLOOD\nMNB', 'INTEG\nMNA', 'INTEG\nMNB', 'NUMER\nMNA', 'NUMER\nMNB', 'DOCK\nTGT', 'RNDZ\nLT', 'RUN\nEVA', 'COAS', 'MISSION\nTIMER', 'EVENT\nTIMER'],
    ];
    panel('8', F.P8, {
      breakers: { rows: 5, cols: 12, pitchX: 0.0305, pitchY: 0.06, y0: 0.095, rowLabels: rowsCB, rowLabelWidth: 0.05, labels: cbLabels, amps: (r, c) => [5, 7.5, 10, 15][(r * 3 + c) % 4], popped: 0.02, labelSize: 0.0023 },
      rotaries: [
        { id: 'numerics', x: -0.155, y: 0.178, positions: ['OFF', '', '', 'BRT'], index: 2, angles: [-120, -40, 40, 120], label: 'NUMERICS', size: 0.9 },
        { id: 'integral', x: -0.08, y: 0.178, positions: ['OFF', '', '', 'BRT'], index: 2, angles: [-120, -40, 40, 120], label: 'INTEGRAL', size: 0.9 },
        { id: 'flood', x: -0.005, y: 0.178, positions: ['OFF', 'DIM', '', 'BRT'], index: 2, angles: [-120, -40, 40, 120], label: 'FLOOD', size: 0.9 },
      ],
      switches: [
        ...row(0.185, 0.06, 0.03, [
          S('floodDim', 'FLOOD\nDIM', ['DIM 1', 'OFF', 'DIM 2'], 0),
          S('floodFixed', 'FLOOD\nFIXED', ['FIXED', 'OFF'], 1),
          S('postLdg', 'POST\nLDG VENT', ['HIGH', 'OFF', 'LOW'], 1),
          S('floatBag', 'FLOAT BAG\n1 L', ['FILL', 'OFF', 'VENT'], 1),
          S('floatBag2', '2 R', ['FILL', 'OFF', 'VENT'], 1),
        ]),
      ],
      boxes: [{ x: -0.08, y: 0.17, w: 0.24, h: 0.08, title: 'LIGHTING' }],
      labels: [{ text: 'PANEL 8', x: 0.185, y: -0.208, size: 0.003 }],
    });
  }

  // ---------------------------------------------------------------- panel 5 (LMP right)
  {
    const rowsCB = ['FUEL CELL', 'INVERTER', 'ECS', 'CRYO', 'LTG'];
    const cbLabels = [
      ['FC 1\nPUMPS', 'FC 2\nPUMPS', 'FC 3\nPUMPS', 'FC 1\nHTR', 'FC 2\nHTR', 'FC 3\nHTR', 'FC 1\nRAD', 'FC 2\nRAD', 'FC 3\nRAD', 'FC 1\nREACS', 'FC 2\nREACS', 'FC 3\nREACS'],
      ['INV 1\nPWR', 'INV 2\nPWR', 'INV 3\nPWR', 'INV 1\nCTL', 'INV 2\nCTL', 'INV 3\nCTL', 'AC 1\nΦA', 'AC 1\nΦB', 'AC 1\nΦC', 'AC 2\nΦA', 'AC 2\nΦB', 'AC 2\nΦC'],
      ['SUIT\nCOMPR', 'CABIN\nFAN 1', 'CABIN\nFAN 2', 'GLY\nPUMP 1', 'GLY\nPUMP 2', 'H2O\nACCUM', 'STEAM\nDUCT', 'RAD\nHTR', 'ECS\nIND', 'O2\nVLV', 'CO2\nSENSOR', 'WASTE\nH2O'],
      ['H2 HTR\n1', 'H2 HTR\n2', 'O2 HTR\n1', 'O2 HTR\n2', 'H2 FAN\n1', 'H2 FAN\n2', 'O2 FAN\n1', 'O2 FAN\n2', 'CRYO\nIND', 'QTY\nAMPL', 'PRESS\nIND', 'VAC ION'],
      ['FLOOD\nMNA', 'FLOOD\nMNB', 'INTEG\nMNA', 'INTEG\nMNB', 'UTIL\nMNA', 'UTIL\nMNB', 'TAPE\nRCDR', 'TV\nCAM', 'DSE', 'PCM', 'SCE', 'UP TLM'],
    ];
    panel('5', F.P5, {
      breakers: { rows: 5, cols: 12, pitchX: 0.0305, pitchY: 0.06, y0: 0.095, rowLabels: rowsCB, rowLabelWidth: 0.05, labels: cbLabels, amps: (r, c) => [5, 7.5, 10, 15][(r + c * 3) % 4], popped: 0.02, labelSize: 0.0023 },
      rotaries: [
        { id: 'integralR', x: 0.075, y: 0.178, positions: ['OFF', '', '', 'BRT'], index: 2, angles: [-120, -40, 40, 120], label: 'INTEGRAL', size: 0.9 },
        { id: 'floodR', x: 0.15, y: 0.178, positions: ['OFF', 'DIM', '', 'BRT'], index: 2, angles: [-120, -40, 40, 120], label: 'FLOOD', size: 0.9 },
      ],
      switches: [
        ...row(0.185, -0.2, 0.03, [
          S('fcPumpA', 'FC PUMPS\n1', ['AC1', 'OFF', 'AC2'], 0),
          S('fcPumpB', '2', ['AC1', 'OFF', 'AC2'], 2),
          S('fcPumpC', '3', ['AC1', 'OFF', 'AC2'], 0),
          S('glyEvap', 'GLY EVAP\nTEMP IN', ['AUTO', 'MAN'], 0),
          S('h2oQty', 'H2O QTY\nIND', ['POT', 'WASTE'], 0),
        ]),
      ],
      boxes: [{ x: 0.11, y: 0.17, w: 0.17, h: 0.08, title: 'LIGHTING' }],
      labels: [{ text: 'PANEL 5', x: -0.185, y: -0.208, size: 0.003 }],
    });
  }

  // ---------------------------------------------------------------- panels 15 / 16 (aft of the consoles)
  panel('15', F.P15, {
    switches: [
      ...row(0.1, -0.1, 0.05, [
        S('coasPwr', 'COAS\nPWR', ONOFF(), 1),
        S('utilPwr', 'UTILITY\nPWR', ONOFF(), 0),
        S('uptlm', 'UP TLM\nCMD', ['NORM', 'OFF'], 0),
        S('elsAuto', 'ELS\nAUTO', ['AUTO', 'MAN'], 0),
        S('cmRcsLogic', 'CM RCS\nLOGIC', ONOFF(), 1),
      ]),
      ...row(0.02, -0.1, 0.05, [
        S('emsPwr', 'EMS\nPWR', ONOFF(), 0),
        S('audioLt', 'AUDIO\nCDR', ['NORM', 'BACKUP'], 0),
        S('vox', 'VOX', ['VOX', 'PTT'], 1),
        S('intercom', 'INTERCOM', ['T/R', 'RCV', 'OFF'], 0),
        S('sBandT', 'S BAND\nT/R', ['T/R', 'RCV', 'OFF'], 0),
      ]),
    ],
    thumbwheels: [
      { id: 'volCdr', x: -0.07, y: -0.085, digits: 1, value: 7, label: 'VOL' },
      { id: 'squelch', x: 0.0, y: -0.085, digits: 1, value: 4, label: 'SQUELCH' },
    ],
    breakers: { rows: 1, cols: 7, pitchX: 0.034, pitchY: 0.04, y0: -0.14, labels: [['COAS', 'UTIL', 'AUDIO\nCDR', 'EMS', 'ELS', 'LOGIC', 'LTG']], popped: 0 },
    labels: [{ text: 'PANEL 15', x: 0.09, y: 0.155, size: 0.003 }, { text: 'CDR AUDIO', x: -0.035, y: -0.055, size: 0.0034 }],
  });
  panel('16', F.P16, {
    switches: [
      ...row(0.1, -0.1, 0.05, [
        S('batAPwr', 'BAT A\nPWR', ONOFF(), 0),
        S('batBPwr', 'BAT B\nPWR', ONOFF(), 0),
        S('batCPwr', 'BAT C\nPWR', ONOFF(), 0),
        S('pyroBatA', 'PYRO\nBAT A', ['ON', 'OFF'], 1),
        S('pyroBatB', 'PYRO\nBAT B', ['ON', 'OFF'], 1),
      ]),
      ...row(0.02, -0.1, 0.05, [
        S('audioLmp', 'AUDIO\nLMP', ['NORM', 'BACKUP'], 0),
        S('voxL', 'VOX', ['VOX', 'PTT'], 1),
        S('intercomL', 'INTERCOM', ['T/R', 'RCV', 'OFF'], 0),
        S('sBandTL', 'S BAND\nT/R', ['T/R', 'RCV', 'OFF'], 0),
        S('vhfL', 'VHF AM\nT/R', ['T/R', 'RCV', 'OFF'], 0),
      ]),
    ],
    thumbwheels: [
      { id: 'volLmp', x: -0.07, y: -0.085, digits: 1, value: 6, label: 'VOL' },
      { id: 'squelchL', x: 0.0, y: -0.085, digits: 1, value: 3, label: 'SQUELCH' },
    ],
    breakers: { rows: 1, cols: 7, pitchX: 0.034, pitchY: 0.04, y0: -0.14, labels: [['BAT A', 'BAT B', 'BAT C', 'PYRO A', 'PYRO B', 'AUDIO\nLMP', 'BAT\nCHGR']], popped: 0 },
    labels: [{ text: 'PANEL 16', x: 0.09, y: 0.155, size: 0.003 }, { text: 'LMP AUDIO', x: -0.035, y: -0.055, size: 0.0034 }],
  });

  group.add(B.build(mat));
  return { group, controls, panels, frames: F };
}

function ONOFF() {
  return ['ON', 'OFF'];
}
