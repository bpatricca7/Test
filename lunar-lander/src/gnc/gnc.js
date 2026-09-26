// Guidance, Navigation & Control for Eagle and Columbia — the Apollo Guidance Computers
// (LGC / CMC) and their digital autopilots.
//
// Contract: createGNC(game) -> { reset(), update(h) }. update(h) runs once per physics substep
// (before the physics) for BOTH vessels and writes:
//   vessel.rcs.jets[i].cmd        RCS jet duty for the substep (DAP, gnc/dap.js)
//   vessel.mainEngine.throttleCmd main engine command (guidance or the manual lever)
//   vessel.gnc.*                  modes, program, attError (FDAI needles), rodCmd, lpd...
//                                 attError (deg) = rotation still needed to reach the autopilot /
//                                 guidance / hold attitude, pilot convention: x pitch (+ = nose up),
//                                 y yaw (+ = nose right), z roll (+ = right wing down); 0 while the
//                                 pilot is commanding rates.
//   vessel.agc                    DSKY (gnc/agc.js)
// and emits 'program', 'callout', 'message', 'alarm' events.
//
// Crew actions ('action' events, applied to game.active): RCS_MODE_CYCLE, ATT_HOLD_TOGGLE,
// KILL_ROT, AUTOPILOT {mode}, PRO, AUTO_TOGGLE, PROGRAM {program}, ROD_UP, ROD_DOWN,
// LPD {dx, dy}, MASTER_ALARM_RESET, ENGINE_STOP (latching: a second press with the engine off,
// or ENGINE_START, resets it).
//
// Added vessel.gnc fields: tig (ignition MET, when a burn is scheduled), rateCmd (deg/s, body
// pitch/yaw/roll in pilot convention), dapPhase ('RATE'|'DAMP'|'HOLD'|'AUTO'|'FREE'), tgo (s),
// lpdAzimuth (deg), throttleState ('FTP'|'THROTTLE'), navDeltaH (m), radarLock (bool),
// guidanceTarget ('HIGH GATE'|'LOW GATE'|'ORBIT'|null).

import * as THREE from 'three';
import { FT, MISSION } from '../core/constants.js';
import { createDAPState, dapStep, DAP_CONFIG } from './dap.js';
import { autopilotTarget, AUTOPILOT_MODES } from './attitude.js';
import { createAGCState, updateAGC, resetAlarms, operatorError, compBurst } from './agc.js';
import { createCalloutState } from './callouts.js';
import * as P from './programs.js';

const R2D = 180 / Math.PI;
const RCS_MODES = ['RATE', 'PULSE', 'DIRECT'];

/** Fresh per-vessel GNC state. */
function createState(v) {
  return {
    vessel: v,
    dap: createDAPState(),
    agc: createAGCState(),
    callouts: createCalloutState(),
    target: {},
    guid: { quat: new THREE.Quaternion(), cmd: new THREE.Quaternion(), valid: false, step: Infinity, rate: null },
    disp: { verb: '16', noun: '44', flash: false, blank: false },
    descent: null,
    ascent: null,
    burn: null, // P40 DOI burn
    pdi: null, // {tig}: PDI planned after DOI (P63 is loaded 10 min before)
    engineStopLatched: false, // ENGINE STOP pushbutton latched (manual throttle ignored)
    latchWarned: false,
    sepHint: false,
    throttle: null,
    ullage: false,
    powered: false,
    stick: new THREE.Vector3(),
    trans: new THREE.Vector3(),
    p47Idle: 0,
  };
}

/**
 * Create the GNC module.
 * @param {object} game global game state
 * @returns {{reset(): void, update(h: number): void, states: object}}
 */
export function createGNC(game) {
  const states = new Map(); // vessel object -> state
  const timeline = []; // delayed callouts {met, fn}
  const faulted = new WeakSet();

  const ctx = {
    game,
    /** Crew / MCC voice callout, optionally delayed (s of MET). */
    say(text, who = 'CDR', delay = 0) {
      const fire = () => {
        if (game.settings.callouts !== false) game.events.emit('callout', { text, voice: true, who });
      };
      if (delay > 0) later(delay, fire);
      else fire();
    },
    message(text, level = 'info', duration) {
      game.events.emit('message', duration ? { text, level, duration } : { text, level });
    },
    later,
  };

  function later(delay, fn) {
    timeline.push({ met: game.time.met + delay, fn });
    timeline.sort((a, b) => a.met - b.met);
  }

  function stateOf(v) {
    let S = states.get(v);
    if (!S) {
      S = createState(v);
      states.set(v, S);
      P.initPrograms(v, S, ctx);
    }
    return S;
  }

  // ---------------------------------------------------------------- crew actions
  game.events.on('action', (a) => {
    const v = game.active;
    if (!v || !a) return;
    const S = stateOf(v);
    const g = v.gnc;
    switch (a.name) {
      case 'RCS_MODE_CYCLE': {
        g.rcsMode = RCS_MODES[(RCS_MODES.indexOf(g.rcsMode) + 1) % RCS_MODES.length];
        S.dap.hold = null;
        S.dap.phase = 'FREE';
        const txt = { RATE: 'RATE — rate command / attitude hold', PULSE: 'PULSE — minimum impulse', DIRECT: 'DIRECT — jets full on while deflected' };
        ctx.message(`RCS: ${txt[g.rcsMode]}`, 'info');
        break;
      }
      case 'ATT_HOLD_TOGGLE':
        g.attHold = !g.attHold;
        S.dap.hold = null;
        if (S.dap.phase === 'HOLD') S.dap.phase = 'DAMP';
        ctx.message(g.attHold ? 'Attitude hold ON' : 'Attitude hold OFF — rate damping only', 'info');
        break;
      case 'KILL_ROT':
        setAutopilot(v, S, 'KILLROT');
        break;
      case 'AUTOPILOT':
        setAutopilot(v, S, a.mode || 'OFF');
        break;
      case 'PRO':
        compBurst(S.agc, 0.3);
        P.proKey(v, S, ctx);
        break;
      case 'AUTO_TOGGLE':
        autoToggle(v, S);
        break;
      case 'PROGRAM':
        selectProgram(v, S, String(a.program || '').toUpperCase());
        break;
      case 'ROD_UP':
      case 'ROD_DOWN': {
        if (v.type !== 'LM' || g.program !== 'P66') {
          ctx.message('ROD switch is active in P66 only', 'warn');
          break;
        }
        g.rodCmd += (a.name === 'ROD_UP' ? 1 : -1) * FT;
        if (Math.abs(g.rodCmd) < 1e-6) g.rodCmd = 0;
        if (S.descent) S.descent.rodAuto = false;
        ctx.message(`ROD ${g.rodCmd <= 0 ? 'down' : 'up'} ${Math.abs(g.rodCmd / FT).toFixed(0)} ft/s`, 'info', 1.2);
        break;
      }
      case 'LPD':
        if (v.type === 'LM') P.lpdRedesignate(v, S, ctx, a.dx || 0, a.dy || 0);
        break;
      case 'MASTER_ALARM_RESET':
        resetAlarms(v, S.agc);
        for (const o of Object.values(game.vessels)) if (o !== v && o.cw.masterAlarm) resetAlarms(o, stateOf(o).agc);
        break;
      case 'ENGINE_STOP':
        engineStop(v, S);
        break;
      case 'ENGINE_START':
        if (S.engineStopLatched) {
          S.engineStopLatched = false;
          ctx.message('ENGINE STOP reset — throttle up to restart the engine', 'info');
        }
        break;
      default:
        break;
    }
  });

  game.events.on('stage', (e) => {
    const v = game.vessels[e?.vessel || 'LM'];
    if (!v) return;
    const S = stateOf(v);
    const p = v.gnc.program;
    S.engineStopLatched = false; // ABORT STAGE / ascent: the APS must be able to fire
    // staging commanded by our own ignition sequence (P12 at TIG, P71 selection)
    if ((p === 'P12' || p === 'P71') && S.ascent && (S.ascent.ignited || p === 'P71')) return;
    if (v.landed || v.phys?.sleeping || v.phys?.onPad) {
      // manual staging on the surface (also before a P12 TIG): the crew lifts off with the throttle
      const hadP12 = p === 'P12';
      S.ascent = null;
      P.startP00(v, S, ctx);
      v.gnc.autopilot = 'OFF';
      ctx.message(`Ascent stage free${hadP12 ? ' — P12 cancelled' : ''}: throttle up (Z) for a manual liftoff, or PRO (Space) to load P12 guided ascent`, 'info', 7);
    } else {
      // ABORT STAGE in flight: P71 ascent guidance with the APS already lit by the sim
      P.startAscent(v, S, ctx, 'P71');
      S.ascent.proAck = true;
    }
  });

  game.events.on('undock', () => {
    const lm = game.vessels.LM;
    if (lm && !lm.staged) stateOf(lm).sepHint = true;
  });
  game.events.on('dock', () => {
    const lm = game.vessels.LM;
    if (!lm) return;
    const S = stateOf(lm);
    S.sepHint = false;
    S.pdi = null;
  });

  function setAutopilot(v, S, mode) {
    if (!AUTOPILOT_MODES.includes(mode)) {
      operatorError(v, S.agc, game, `unknown autopilot mode ${mode}`);
      return;
    }
    const g = v.gnc;
    if (mode === 'GUIDANCE') {
      const guided = ['P40', 'P63', 'P64', 'P66', 'P12', 'P70', 'P71'].includes(g.program);
      if (!guided) {
        operatorError(v, S.agc, game, 'no guidance program running');
        return;
      }
      if (g.program === 'P66' && S.descent) S.descent.rodAuto = true;
    }
    if (mode !== 'OFF' && g.rcsMode !== 'RATE') {
      g.rcsMode = 'RATE';
      ctx.message('RCS mode set to RATE for the autopilot', 'info');
    }
    g.autopilot = mode;
    S.dap.lastTarget = null;
    S.dap.lastDir = null;
    const names = { OFF: 'Autopilot OFF — attitude hold', KILLROT: 'Kill rotation', LOCAL_VERTICAL: 'Autopilot: local vertical', GUIDANCE: 'Autopilot: guidance steering' };
    ctx.message(names[mode] || `Autopilot: ${mode.replace('_', ' ').toLowerCase()}`, 'info');
  }

  function autoToggle(v, S) {
    const g = v.gnc;
    if (v.type !== 'LM' || v.staged || v.landed) {
      operatorError(v, S.agc, game, 'AUTO/MANUAL throttle: LM descent only');
      return;
    }
    const p = g.program;
    if (p === 'P63' || p === 'P64') {
      if (p === 'P63' && S.descent && !S.descent.ignited) {
        operatorError(v, S.agc, game, 'engine not ignited');
        return;
      }
      P.startP66(v, S, ctx, false);
    } else if (p === 'P66') P.startP67(v, S, ctx);
    else if (p === 'P67' || p === 'P00' || p === 'P47') {
      if (v.tel.altitude > MISSION.highGate.altitude + 700) {
        operatorError(v, S.agc, game, 'P66 needs to be below High Gate');
        return;
      }
      P.startP66(v, S, ctx, false);
    } else operatorError(v, S.agc, game, `no throttle mode change in ${p}`);
  }

  function selectProgram(v, S, prog) {
    const g = v.gnc;
    const p = g.program;
    const ok = () => true;
    const flying = !v.landed && !v.crashed;
    const lm = v.type === 'LM';
    const table = {
      P00: ok,
      P47: () => !v.landed,
      P40: () => lm && !P.doiUnavailable(v, S, game) && (p === 'P00' || p === 'P47'),
      P63: () => lm && !!S.pdi && !v.docked && !v.staged,
      P64: () => lm && p === 'P63' && S.descent?.ignited,
      P66: () => lm && flying && !v.staged && (p === 'P63' || p === 'P64' || p === 'P67' || v.tel.altitude < MISSION.highGate.altitude + 700),
      P67: () => lm && flying && !v.staged,
      P68: () => lm && v.landed,
      P12: () => lm && v.landed && !v.crashed,
      P70: () => lm && flying && !v.staged && !v.docked,
      P71: () => lm && flying && !v.docked,
    };
    const check = table[prog];
    if (!check || !check()) {
      const why = prog === 'P40' ? P.doiUnavailable(v, S, game) : prog === 'P63' && lm && !S.pdi ? 'fly DOI (P40) first' : null;
      operatorError(v, S.agc, game, `${prog || 'program'} not available now${why ? ` — ${why}` : ''}`);
      return;
    }
    if (prog === 'P00') P.startP00(v, S, ctx);
    else if (prog === 'P47') {
      S.agc.dv.set(0, 0, 0);
      S.p47Idle = 0;
      g.throttleMode = 'MANUAL';
      P.setProgram(v, S, ctx, 'P47');
    } else if (prog === 'P40') P.startDOI(v, S, ctx);
    else if (prog === 'P63') {
      const tig = S.pdi.tig;
      S.pdi = null;
      P.startP63(v, S, ctx, tig);
      S.descent.fromDOI = true;
    } else if (prog === 'P64') P.startP64(v, S, ctx, true);
    else if (prog === 'P66') P.startP66(v, S, ctx, false);
    else if (prog === 'P67') P.startP67(v, S, ctx);
    else if (prog === 'P68') P.startP68(v, S, ctx);
    else if (prog === 'P12') P.startAscent(v, S, ctx, 'P12', game.time.met + 12);
    else if (prog === 'P70') P.startAscent(v, S, ctx, 'P70');
    else if (prog === 'P71') {
      if (!v.staged) game.events.emit('action', { name: 'STAGE' });
      if (g.program !== 'P71') P.startAscent(v, S, ctx, 'P71');
    }
  }

  function engineStop(v, S) {
    const p = v.gnc.program;
    // the ENGINE STOP pushbutton latches; pushing it again (engine off) resets it
    if (S.engineStopLatched && !v.mainEngine.firing) {
      S.engineStopLatched = false;
      ctx.message('ENGINE STOP reset — throttle up to restart the engine', 'info');
      return;
    }
    S.engineStopLatched = true;
    S.latchWarned = false;
    if (S.descent && (p === 'P63' || p === 'P64' || p === 'P66')) {
      S.descent.engineStop = true;
      if (p !== 'P66') P.startP67(v, S, ctx);
    }
    if (S.ascent && !S.ascent.cutoff && S.ascent.ignited) {
      S.ascent.cutoff = true;
      S.ascent.cutTime = game.time.met;
    }
    if (v.gnc.throttleMode === 'MANUAL' && game.active === v) v.ctrl.throttle = 0;
  }

  /** Stick out of detent while an autopilot flies: the pilot takes over (CSS / ATT HOLD). */
  function stickOverride(v, S) {
    const g = v.gnc;
    if (g.autopilot === 'OFF') return;
    if (g.autopilot === 'GUIDANCE') {
      if (g.program === 'P64') {
        P.startP66(v, S, ctx, false);
        ctx.message('P66 — manual attitude: the hand controller took over from P64', 'info');
        return;
      }
      if (g.program === 'P66') {
        g.autopilot = 'OFF';
        ctx.message('P66 — attitude by hand (ROD switch still automatic until clicked)', 'info');
        return;
      }
      g.autopilot = 'OFF';
      ctx.message(`${g.program}: attitude hold by hand — the guidance still flies the throttle. PRO re-engages steering`, 'warn', 6);
      return;
    }
    g.autopilot = 'OFF';
  }

  // ---------------------------------------------------------------- per-substep update
  const _io = { stick: null, trans: null, transDuty: 1, fine: false, target: null, targetRate: 0, enabled: true };

  function stepVessel(v, h) {
    const S = stateOf(v);
    const g = v.gnc;
    const c = v.ctrl;
    const cfg = DAP_CONFIG[v.type];

    if (v.crashed) {
      for (const j of v.rcs.jets) j.cmd = 0;
      v.mainEngine.throttleCmd = 0;
      updateAGC(v, S, game, h, false);
      return;
    }
    S.stick.set(c.pitch || 0, c.yaw || 0, c.roll || 0);
    const stickOn = Math.abs(S.stick.x) > cfg.detent || Math.abs(S.stick.y) > cfg.detent || Math.abs(S.stick.z) > cfg.detent;
    if (stickOn) stickOverride(v, S);

    // ---- program / guidance
    P.runProgram(v, S, ctx, h);
    P.stepGuid(S, h);

    // ---- main engine
    const auto = g.throttleMode === 'AUTO' && S.throttle != null;
    let manual = Math.max(0, Math.min(1, c.throttle || 0));
    if (S.engineStopLatched && !auto) {
      if (manual > 0.05 && !S.latchWarned && game.active === v) {
        S.latchWarned = true;
        ctx.message('ENGINE STOP is latched — press X again to reset it, then throttle up', 'warn', 5);
      }
      manual = 0;
    }
    v.mainEngine.throttleCmd = auto ? Math.max(0, S.throttle) : manual;

    // ---- DAP
    const docked = v.docked && v.dockedTo;
    const enabled = !(v.landed || v.phys?.sleeping) && !(docked && game.active !== v);
    S.trans.set(c.transRight || 0, c.transUp || 0, -(c.transFwd || 0));
    let transDuty = c.fine ? 0.25 : 1;
    if (S.ullage) {
      S.trans.y = 1;
      transDuty = 1;
    }
    let target = null;
    let rate = cfg.autoRate;
    if (g.rcsMode === 'RATE' && g.autopilot !== 'OFF') {
      if (g.autopilot === 'GUIDANCE') {
        if (S.guid.valid) {
          S.target.quat = S.guid.quat;
          S.target.axis = null;
          S.target.rate = null;
          S.target.deadband = undefined;
          target = S.target;
          rate = S.guid.rate || rate;
        }
      } else {
        const other = v.id === 'LM' ? game.vessels.CSM : game.vessels.LM;
        target = autopilotTarget(g.autopilot, v, other, S.target);
      }
    }
    _io.stick = S.stick;
    _io.trans = S.trans;
    _io.transDuty = transDuty;
    _io.fine = !!c.fine;
    _io.target = stickOn ? null : target;
    _io.targetRate = rate;
    _io.enabled = enabled;
    dapStep(v, S.dap, h, _io);

    if (g.autopilot === 'KILLROT' && v.angVel.length() < cfg.captureRate) {
      g.autopilot = 'OFF';
      S.dap.phase = 'DAMP';
    }

    // ---- outputs for instruments / UI
    const e = S.dap.err; // rotation current -> target (body, rad)
    g.attError.set(e.x * R2D, -e.y * R2D, -e.z * R2D);
    const rc = S.dap.rateCmd;
    g.rateCmd = g.rateCmd || new THREE.Vector3();
    g.rateCmd.set(nz(rc.x) * R2D, -nz(rc.y) * R2D, -nz(rc.z) * R2D);
    g.dapPhase = S.dap.phase;
    const d = S.descent;
    g.tgo = d && (g.program === 'P63' || g.program === 'P64') ? d.tgo : S.ascent && !S.ascent.cutoff ? S.ascent.steer.tgo ?? null : null;
    g.throttleState = d && (g.program === 'P63' || g.program === 'P64') ? (d.thr.ftp ? 'FTP' : 'THROTTLE') : null;
    g.navDeltaH = d ? d.deltaH : 0;
    g.radarLock = !!d?.radarLock;
    g.guidanceTarget = g.program === 'P63' ? 'HIGH GATE' : g.program === 'P64' ? 'LOW GATE' : S.ascent && !S.ascent.cutoff ? 'ORBIT' : null;
    if (d && d.tig != null && !d.ignited && g.program === 'P63') g.tig = d.tig;
    else if (S.ascent && !S.ascent.ignited) g.tig = S.ascent.tig;
    else if (S.burn && !S.burn.ignited) g.tig = S.burn.tig;
    else if (S.pdi) g.tig = S.pdi.tig;
    else g.tig = null;
    if (S.burn && g.program === 'P40') {
      const b = S.burn;
      const aF = (P.DOI.highThrottle * v.mainEngine.maxThrust) / Math.max(1, v.mass || 1);
      g.tgo = b.ignited && !b.cutoff ? b.vgo.length() / aF : null;
    }

    // after undocking: tell the crew how to start the descent once they are clear of Columbia
    if (v.type === 'LM' && S.sepHint && !v.docked && game.active === v) {
      const csm = game.vessels.CSM;
      if (csm && csm.pos.distanceTo(v.pos) > P.DOI.minSep && !P.doiUnavailable(v, S, game) && (g.program === 'P00' || g.program === 'P47')) {
        S.sepHint = false;
        ctx.message(`Eagle is ${P.DOI.minSep} m clear of Columbia. PRO (Space) loads P40 — the DOI burn that starts the descent to Tranquility Base`, 'info', 9);
      }
    }

    updateAGC(v, S, game, h, S.powered);
  }

  return {
    states,
    reset() {
      states.clear();
      timeline.length = 0;
      for (const v of Object.values(game.vessels)) stateOf(v);
    },
    update(h) {
      if (!(h > 0)) return;
      for (const v of Object.values(game.vessels)) {
        try {
          stepVessel(v, h);
        } catch (e) {
          // never let a GNC fault freeze the simulation: safe the vehicle and report once
          for (const j of v.rcs.jets) j.cmd = 0;
          if (!faulted.has(v)) {
            faulted.add(v);
            console.error(`GNC fault on ${v.id}`, e);
            ctx.message(`${v.name}: guidance computer fault — ${e.message}`, 'alarm');
          }
        }
      }
      while (timeline.length && timeline[0].met <= game.time.met) timeline.shift().fn();
    },
    /** Test hook: per-vessel private state. */
    stateOf,
  };
}

function nz(x) {
  return Number.isNaN(x) ? 0 : x;
}
