// Flight dynamics & mission state for Eagle (LM) and Columbia (CSM).
//
// Contract: createSim(game, { gnc }) -> { scenarios, loadScenario(id), step(realDt, {ignoreWarp}) -> simDt }
//
// Each frame main.js calls step(realDt). The sim applies the time-warp factor (automatically
// limited while engines fire, near the ground and in ground contact), splits the simulated
// interval into substeps and for each substep:
//     gnc.update(h)  ->  propulsion, RCS, contact, 6-DOF integration  ->  telemetry, C&W, callouts
// Substep length adapts to what is happening: <= 5 ms while the landing gear is in contact,
// <= 20 ms while thrusting / firing RCS / below 5 km / near the other vehicle, and up to 1 s
// for a quiet orbital coast (velocity-Verlet keeps a 111-km orbit within metres at 1000x).
// Warp ceilings: 10x while an engine fires, an ignition is < 45 s away, a vessel is below 5 km
// or the two vehicles are within 1 km; 1x in active ground contact / docking capture, and 1x
// from 10 s before a guidance ignition of the flown vessel until it lights (or 60 s after a
// missed TIG) — the requested warp is then reset to 1x so it is never restored behind the
// player's back. A landed, sleeping LM does not limit warp. game.time.warpEffective reports the
// achieved rate when the per-frame CPU budget truncates a very high warp.
//
// Actions handled here: PAUSE, WARP_UP, WARP_DOWN, WARP_RESET, SWITCH_VESSEL {to?}, UNDOCK,
// DOCK, STAGE, RESTART. See ARCHITECTURE.md §5.

import * as THREE from 'three';
import { createLM, createCSM } from '../core/state.js';
import { SCENARIOS } from './scenarios.js';
import { createPhysState, updateEngine, applyRcs, integrateRigid, setDiagInertia, localG } from './physics.js';
import { updateVesselMassProps, apsThrustLineCg } from './massprops.js';
import { initContactState, lmContact, hullBelowGround } from './contact.js';
import { updateLanding, crashVessel, stageLM, updateDescentStage, impactReason } from './landing.js';
import { fmtSpeed, fmtLen } from './units.js';
import { createStack, updateStackProps, slaveLM, dockingGeometry, mergeStack, advanceCapture, splitStack, bounce, DOCK } from './docking.js';
import { updateTelemetry, updateCaution } from './telemetry.js';

export const WARP_LEVELS = [1, 2, 5, 10, 50, 100, 1000];
/** Time-warp handling around a guidance-program ignition (P63 PDI, P12/P70/P71 ascent). */
export const WARP_IGN = {
  STOP: 10, // s before TIG: warp drops to 1x (and the request is reset) for the active vessel
  LATE: 60, // s after a missed TIG the late-PRO window keeps real time
};
export const STEP = {
  COAST: 1.0, // s, max substep for a quiet orbital coast
  ACTIVE: 0.02, // s, thrusting / RCS / low altitude / proximity operations
  CONTACT: 0.005, // s, landing gear in contact with the ground
  MAX_SUBSTEPS: 4000, // per step() call (guards against runaway loops)
  BUDGET_MS: 8, // wall-clock budget per step() call; high warp degrades gracefully beyond it
  RCS_HOLD: 1.0, // s of fine steps after any RCS firing
};

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const _Fc = new THREE.Vector3();
const _Tc = new THREE.Vector3();
const _t = new THREE.Vector3();
const _up = new THREE.Vector3();
const APS_LINE = apsThrustLineCg();

/**
 * Create the simulation.
 * @param {object} game game state (core/state.js)
 * @param {{gnc: {update(h:number):void, reset?():void}}} deps
 */
export function createSim(game, { gnc } = {}) {
  gnc = gnc || { update() {}, reset() {} };
  const S = {
    game,
    silent: false,
    ev: {
      emit(type, payload) {
        if (!S.silent) game.events.emit(type, payload);
      },
    },
    stack: null,
    stackBody: null,
    timeline: [],
    thrPrev: {}, // per vessel {mode, cmd} before the GNC cycle (throttle handover)
    rcsTimer: 0,
    noDockTimer: 0,
    lastBounceMsg: -1e9,
    loadedOnce: false,
    lastWarpActual: 1,
    schedule(met, fn) {
      S.timeline.push({ met, fn });
      S.timeline.sort((a, b) => a.met - b.met);
    },
  };

  // ------------------------------------------------------------ vessel setup
  function initVessel(v) {
    v.phys = createPhysState();
    initContactState(v);
    updateVesselMassProps(v);
    setDiagInertia(v.phys, v.inertia);
    v.phys.body = { pos: v.pos, quat: v.quat, angVel: v.angVel, vel: v.vel, cg: v.cg, mass: v.mass, I: v.phys.I, Iinv: v.phys.Iinv, F: v.phys.force, T: v.phys.torque };
  }

  /** Adopt engine state preset by a scenario (engine already running, e.g. 'hover'). */
  function adoptEngineState(v) {
    const e = v.mainEngine;
    const s = v.phys.eng;
    if (e.firing && e.throttle > 0) {
      s.state = 'running';
      s.f = 1;
      s.thr = Math.max(e.minThrottle, Math.min(e.maxThrottle, e.throttle));
      v.phys.thrust = e.maxThrust * s.thr;
    } else {
      s.state = 'off';
      s.f = 0;
      e.throttle = 0;
      e.firing = false;
    }
  }

  function buildStack() {
    const { LM: lm, CSM: csm } = game.vessels;
    S.stack = createStack();
    updateStackProps(S.stack, csm, lm);
    // scenarios give the stack CG state on the CSM: shift the CSM origin so the CG sits there
    S.stack.vel.copy(csm.vel);
    _t.copy(S.stack.cg).applyQuaternion(csm.quat);
    csm.pos.sub(_t);
    csm.docked = lm.docked = true;
    csm.dockedTo = 'LM';
    lm.dockedTo = 'CSM';
    makeStackBody();
    slaveLM(S.stack, csm, lm);
  }

  function makeStackBody() {
    const csm = game.vessels.CSM;
    S.stackBody = { pos: csm.pos, quat: csm.quat, angVel: csm.angVel, vel: S.stack.vel, cg: S.stack.cg, mass: S.stack.mass, I: S.stack.I, Iinv: S.stack.Iinv, F: new THREE.Vector3(), T: new THREE.Vector3() };
  }

  // ------------------------------------------------------------ scenarios
  function loadScenario(id) {
    const sc = SCENARIOS.find((s) => s.id === id) || SCENARIOS.find((s) => s.id === 'hover') || SCENARIOS[0];
    game.vessels.LM = createLM();
    game.vessels.CSM = createCSM();
    S.stack = null;
    S.stackBody = null;
    S.timeline = [];
    S.rcsTimer = 0;
    S.noDockTimer = 0;
    S.thrPrev = {};
    game.time.met = sc.met;
    game.time.paused = false;
    game.result = null;
    game.scenarioId = sc.id;
    if (!S.loadedOnce) {
      const w = +game.params?.warp || 1;
      game.time.warp = WARP_LEVELS.reduce((best, l) => (Math.abs(l - w) < Math.abs(best - w) ? l : best), 1);
    } else game.time.warp = 1;
    game.time.warpActual = 1;
    S.lastWarpActual = 1;
    for (const v of Object.values(game.vessels)) initVessel(v);

    S.silent = true;
    sc.setup(game, util);
    for (const v of Object.values(game.vessels)) {
      updateVesselMassProps(v);
      setDiagInertia(v.phys, v.inertia);
      adoptEngineState(v);
    }
    if (game.vessels.LM.docked) buildStack();
    if (sc.settleLM) settleLM(game.vessels.LM, 15);
    refreshTelemetry();
    updateCaution(game.vessels.LM, S.ev, true); // initial light states without alarms
    updateCaution(game.vessels.CSM, S.ev, true);
    S.silent = false;

    const pv = !S.loadedOnce ? game.params?.vessel : null;
    game.activeId = pv === 'LM' || pv === 'CSM' ? pv : sc.activeId;
    if (sc.camera && !game.params?.camera) game.view.mode = sc.camera;
    if (sc.station) game.view.station = sc.station;
    S.loadedOnce = true;
    gnc.reset?.();
    S.gncInit = sc.gncInit ? () => sc.gncInit(game, gnc) : null;
    refreshTelemetry();
    game.events.emit('scenario', { id: sc.id });
  }

  /** Let the LM come to rest on its gear (scenario setup, events muted). */
  function settleLM(lm, maxSeconds) {
    const h = STEP.CONTACT;
    for (let t = 0; t < maxSeconds && !lm.phys.sleeping; t += h) {
      stepFreeVessel(lm, h); // settling happens "before" the scenario starts (MET not advanced)
    }
    lm.vel.set(0, 0, 0);
    lm.angVel.set(0, 0, 0);
    lm.phys.sleeping = true;
    lm.landed = true;
    lm.phys.td.phase = 'settled';
    lm.phys.td.resultDone = true;
    lm.gear.probeContact = true;
    lm.cw.lights['LUNAR CONTACT'] = true;
    game.result = null; // the settling pass is not a landing
    S.timeline = [];
  }

  const util = {
    /** Mark the two vessels as hard-docked (the sim places the LM on the CSM). */
    dock() {
      const { LM: lm, CSM: csm } = game.vessels;
      lm.docked = csm.docked = true;
      lm.dockedTo = 'CSM';
      csm.dockedTo = 'LM';
    },
    initVessel,
  };

  // ------------------------------------------------------------ actions
  function message(text, level = 'info', duration) {
    game.events.emit('message', duration ? { text, level, duration } : { text, level });
  }

  function setWarp(level) {
    const w = WARP_LEVELS.includes(level) ? level : 1;
    game.time.warp = w;
    const { lim, reason, ignition } = warpLimit();
    if (w > 1 && ignition) {
      game.time.warp = 1; // not stored: nothing may restore a high warp after the ignition window
      message(`Time warp held at 1× — ${reason}`, 'warn');
    } else if (w > lim) message(`Time warp ${w}× requested — limited to ${lim}× (${reason})`, 'warn');
    else message(w === 1 ? 'Time warp off (1×)' : `Time warp ${w}×`, 'info');
  }

  function switchVessel(to) {
    const target = to === 'LM' || to === 'CSM' ? to : game.activeId === 'LM' ? 'CSM' : 'LM';
    if (target === game.activeId) return;
    const prev = game.vessels[game.activeId];
    const handover = leaveVessel(prev);
    zeroCtrl(prev.ctrl);
    game.activeId = target;
    game.events.emit('vessel', { id: target });
    const v = game.vessels[target];
    message(`Now flying ${v.name} (${target === 'LM' ? 'Lunar Module' : 'Command/Service Module'})`, 'info');
    if (handover) message(handover.text, handover.level, 7);
  }

  /**
   * The crew of the vessel the player leaves keeps it flying. A powered LM descent in P66/P67
   * (pilot flying attitude and/or throttle) is handed to the LGC's hands-off P66 AUTO, which
   * nulls the drift and lets down to a landing; any other burn keeps its throttle lever setting.
   * Must run while `prev` is still the active vessel (the actions below address game.active).
   * @returns {{text:string, level:string}|null} message for the player
   */
  function leaveVessel(prev) {
    const g = prev.gnc;
    const e = prev.mainEngine;
    const airborne = !prev.landed && !prev.crashed && !prev.docked && !prev.phys?.sleeping;
    if (!airborne) return null;
    if (prev.type === 'LM' && !prev.staged && e.firing && (g.program === 'P66' || g.program === 'P67') && !(g.program === 'P66' && g.autopilot === 'GUIDANCE')) {
      if (g.program === 'P67') game.events.emit('action', { name: 'AUTO_TOGGLE' }); // P67 -> P66
      if (g.program === 'P66') game.events.emit('action', { name: 'AUTOPILOT', mode: 'GUIDANCE' }); // hands-off ROD + attitude
      if (g.program === 'P66' && g.autopilot === 'GUIDANCE') {
        return { text: `${prev.name}: the LGC is flying P66 AUTO down to the surface while you are away`, level: 'warn' };
      }
    }
    if (e.firing && g.throttleMode === 'MANUAL' && (prev.ctrl.throttle || 0) > 0) {
      return { text: `${prev.name}: ${e.name} still firing at ${Math.round((e.throttle || prev.ctrl.throttle) * 100)} % — nobody is flying her now`, level: 'warn' };
    }
    return null;
  }

  /** Spring-loaded hand controllers return to detent; the throttle lever is a friction lever and stays put. */
  function zeroCtrl(c) {
    c.pitch = c.yaw = c.roll = 0;
    c.transFwd = c.transRight = c.transUp = 0;
    c.fine = false;
  }

  function undock() {
    const { LM: lm, CSM: csm } = game.vessels;
    if (!S.stack) return message('Not docked', 'info');
    if (S.stack.capture) return message('Probe retraction in progress — wait for hard dock', 'warn');
    splitStack(S.stack, csm, lm);
    S.stack = null;
    S.stackBody = null;
    S.noDockTimer = 8;
    game.events.emit('undock', { a: 'CSM', b: 'LM' });
    message(`Undocked — probe spring separation ${fmtSpeed(game, DOCK.SEP_SPEED, 1)}`, 'good');
    if (!lm.staged) game.events.emit('callout', { text: 'The Eagle has wings.', voice: true, who: 'CDR' });
  }

  function capture() {
    const { LM: lm, CSM: csm } = game.vessels;
    S.stack = mergeStack(csm, lm, true);
    makeStackBody();
    for (const v of [lm, csm]) {
      v.phys.sleeping = false;
      v.landed = false;
    }
    game.events.emit('message', { text: 'Capture — probe latches engaged, retracting', level: 'good' });
    game.events.emit('callout', { text: 'Capture.', voice: true, who: 'CMP' });
  }

  function dockManual() {
    const { LM: lm, CSM: csm } = game.vessels;
    if (S.stack) return message('Already docked', 'info');
    if (lm.crashed || csm.crashed) return;
    const g = dockingGeometry(csm, lm, {});
    if (g.range < 1.0 && g.lateral < 0.5 && g.closing < 2 * DOCK.CAPTURE_CLOSING && g.closing > -0.3 && g.misalignDeg < 15) capture();
    else message(`Docking out of tolerance — probe ${fmtLen(game, g.range, 1)} from the drogue, ${fmtLen(game, g.lateral, 1)} off-centre, closing ${fmtSpeed(game, g.closing, 2)}, misalignment ${g.misalignDeg.toFixed(0)}°`, 'warn', 6);
  }

  function stage() {
    const lm = game.vessels.LM;
    const inFlight = !lm.landed && !lm.phys.sleeping;
    if (stageLM(S, lm) && inFlight) {
      // ABORT STAGE also arms and starts the ascent engine; from now on P71 throttles it (AUTO).
      // The TTCA lever only ever set the DPS: put it to OFF so the APS cannot relight at the old
      // hover setting when P71 hands over to P00 (manual throttle) after insertion.
      lm.ctrl.throttle = 0;
      lm.mainEngine.throttleCmd = 1;
    }
  }

  game.events.on('action', (a) => {
    switch (a?.name) {
      case 'PAUSE':
        game.time.paused = !game.time.paused;
        message(game.time.paused ? 'Paused' : 'Resumed', 'info');
        break;
      case 'WARP_UP': {
        const i = WARP_LEVELS.indexOf(game.time.warp);
        setWarp(WARP_LEVELS[Math.min(WARP_LEVELS.length - 1, (i < 0 ? 0 : i) + 1)]);
        break;
      }
      case 'WARP_DOWN': {
        const i = WARP_LEVELS.indexOf(game.time.warp);
        setWarp(WARP_LEVELS[Math.max(0, (i < 0 ? 1 : i) - 1)]);
        break;
      }
      case 'WARP_RESET':
        setWarp(1);
        break;
      case 'SWITCH_VESSEL':
        switchVessel(a.to);
        break;
      case 'UNDOCK':
        undock();
        break;
      case 'DOCK':
        dockManual();
        break;
      case 'STAGE':
        stage();
        break;
      case 'RESTART':
        if (game.scenarioId) loadScenario(game.scenarioId);
        break;
      default:
        break;
    }
  });

  // ------------------------------------------------------------ warp & step size
  function engineWanted(v) {
    const e = v.mainEngine;
    return (e.throttleCmd || 0) > 1e-4 && e.armed && v.propellant.main > 0 && !v.crashed;
  }

  function ctrlActive(c) {
    return c.pitch !== 0 || c.yaw !== 0 || c.roll !== 0 || c.transFwd !== 0 || c.transRight !== 0 || c.transUp !== 0 || c.throttle > 0;
  }

  /** Current warp ceiling and the reason for it. */
  function warpLimit() {
    let lim = Infinity;
    let reason = null;
    let ign = false;
    const met = game.time.met;
    for (const v of Object.values(game.vessels)) {
      const ph = v.phys;
      if (!ph || ph.frozen) continue;
      if (v.mainEngine.firing || engineWanted(v)) {
        if (lim > 10) {
          lim = 10;
          reason = `${v.mainEngine.name} firing`;
        }
      }
      const tig = v.gnc.tig; // set by the GNC only while an ignition is still pending
      if (typeof tig === 'number' && Number.isFinite(tig)) {
        const dt = tig - met;
        if (v === game.active && dt < WARP_IGN.STOP && dt > -WARP_IGN.LATE) {
          // real time for the V99 "please perform engine on" (flashes at TIG-5 s) and for a late
          // PRO after a missed TIG: at any warp the window would last a fraction of a second
          if (lim > 1) {
            lim = 1;
            ign = true;
            reason = dt > 0 ? `${v.mainEngine.name} ignition in ${Math.ceil(dt)} s` : `${v.mainEngine.name} ignition pending (V99)`;
          }
        } else if (dt < 45 && dt > -WARP_IGN.LATE && lim > 10) {
          lim = 10;
          reason = 'ignition coming up';
        }
      }
      if (!ph.sleeping && v.tel.altitude < 5000 && lim > 10) {
        lim = 10;
        reason = `${v.name} below 5 km`;
      }
      if (!ph.sleeping && ph.anyContact) {
        lim = 1;
        reason = 'ground contact';
      }
    }
    const { LM: lm, CSM: csm } = game.vessels;
    if (!S.stack && !lm.crashed && !csm.crashed && lm.pos.distanceToSquared(csm.pos) < 1e6 && lim > 10) {
      lim = 10;
      reason = 'proximity operations';
    }
    const ds = lm.descentStage;
    if (ds && ds.falling && lim > 10) {
      lim = 10;
      reason = 'descent stage falling';
    }
    if (S.stack?.capture && lim > 1) {
      lim = 1;
      reason = 'docking capture';
    }
    return { lim, reason, ignition: ign };
  }

  function chooseH() {
    let h = STEP.COAST;
    const { LM: lm, CSM: csm } = game.vessels;
    for (const v of [lm, csm]) {
      const ph = v.phys;
      if (ph.frozen) continue;
      const wants = engineWanted(v) || v.mainEngine.firing;
      if (ph.sleeping && !wants) continue;
      if (wants || ctrlActive(v.ctrl) || v.tel.altitude < 5000) h = Math.min(h, STEP.ACTIVE);
      if (ph.anyContact) h = STEP.CONTACT;
      else if (v.type === 'LM' && !v.docked) {
        const ga = v.tel.gearAltitude;
        const sink = Math.max(0, -v.tel.vSpeed);
        if (ga < 0.3 + 0.12 * sink || (v.staged && v.tel.altitude < 6)) h = STEP.CONTACT;
      }
    }
    if (S.rcsTimer > 0 || S.stack?.capture) h = Math.min(h, STEP.ACTIVE);
    if (!S.stack && lm.tel.relTarget && lm.tel.relTarget.range < 500) h = Math.min(h, STEP.ACTIVE);
    const ds = lm.descentStage;
    if (ds && ds.falling) h = Math.min(h, STEP.ACTIVE);
    return h;
  }

  function jetsCommanded() {
    for (const v of Object.values(game.vessels)) for (const j of v.rcs.jets) if (j.cmd > 0) return true;
    return false;
  }

  // ------------------------------------------------------------ physics
  /** One physics step of a free (undocked) vessel. */
  function stepFreeVessel(v, h) {
    const ph = v.phys;
    const ev = S.ev;
    if (ph.frozen) {
      for (const j of v.rcs.jets) j.level = 0;
      v.mainEngine.throttle = 0;
      v.mainEngine.firing = false;
      return;
    }
    updateVesselMassProps(v);
    setDiagInertia(ph, v.inertia);
    const body = ph.body;
    body.mass = v.mass;
    if (ph.sleeping && !ph.onPad && engineWanted(v)) ph.sleeping = false; // wake on thrust
    const thrust = updateEngine(v, h, ev, v.cg);
    _Fc.set(0, 0, 0);
    _Tc.set(0, 0, 0);
    applyRcs(v, h, 1, v.cg, _Fc, _Tc);
    if (ph.onPad) {
      // ascent stage sitting on the descent stage: released once the APS out-lifts its weight
      _up.copy(v.pos).normalize();
      _t.copy(v.mainEngine.thrustDir).applyQuaternion(v.quat);
      const lift = thrust * _t.dot(_up);
      if (lift > v.mass * localG(v.pos.length())) {
        ph.onPad = false;
        ph.sleeping = false;
        v.landed = false;
        game.events.emit('message', { text: 'Liftoff — ascent stage clear of the descent stage', level: 'good' });
        S.schedule(game.time.met + 2.5, () => S.ev.emit('callout', { text: 'Beautiful. Very smooth... very quiet ride.', voice: true, who: 'LMP' }));
      }
    }
    ph.contactForce.set(0, 0, 0);
    ph.anyContact = false;
    if (ph.sleeping) {
      v.vel.set(0, 0, 0);
      v.angVel.set(0, 0, 0);
      ph.force.set(0, 0, 0);
      return;
    }
    const me = v.mainEngine;
    _Fc.addScaledVector(me.thrustDir, thrust); // DPS / SPS: through the CG (trim gimbal)
    if (thrust > 0 && me.minThrottle >= me.maxThrottle - 1e-6) {
      // the APS is fixed (no gimbal): its thrust line misses the moving CG by a few cm, a
      // disturbance torque the RCS fights all the way to orbit (the ascent-stage "wallow")
      const ax = APS_LINE; // the thrust line: parallel to +Y through the mid-burn CG (x, z)
      _t.set(ax.x, me.nozzleThroat.y, ax.z).sub(v.cg); // lever arm from the CG to the thrust line
      _Tc.add(_up.crossVectors(_t, me.thrustDir).multiplyScalar(thrust)); // r x F
    }
    ph.force.copy(_Fc.applyQuaternion(v.quat));
    ph.torque.copy(_Tc);
    let c = null;
    if (v.type === 'LM') {
      c = lmContact(v, h, ev);
      if (c.crash) {
        crashVessel(S, v, c.crash.outcome, impactReason(S, v, c.crash), true);
        return;
      }
    } else {
      const why = hullBelowGround(v);
      if (why) {
        crashVessel(S, v, 'crashed', why, true);
        return;
      }
    }
    integrateRigid(body, h, ph.anyContact);
    if (v.type === 'LM' && (c.near || ph.td.phase !== 'air' || v.crashed)) updateLanding(S, v, h, c);
  }

  /** One physics step of the docked stack (CSM carrier + slaved LM). */
  function stepStack(h) {
    const { LM: lm, CSM: csm } = game.vessels;
    const st = S.stack;
    const ev = S.ev;
    updateVesselMassProps(lm);
    updateVesselMassProps(csm);
    updateStackProps(st, csm, lm);
    const b = S.stackBody;
    b.mass = st.mass;
    // engines (thrust through the stack CG)
    const tC = updateEngine(csm, h, ev, stackCgIn(csm));
    const tL = updateEngine(lm, h, ev, stackCgIn(lm));
    _Fc.set(0, 0, 0);
    _Tc.set(0, 0, 0);
    applyRcs(csm, h, 1, st.cg, _Fc, _Tc);
    const rcsC = csm.phys.rcsForce;
    applyRcs(lm, h, 1, st.cg, _Fc, _Tc, relMat(st), st.relT);
    csm.phys.rcsForce = rcsC;
    _Fc.addScaledVector(csm.mainEngine.thrustDir, tC);
    b.F.copy(_Fc.applyQuaternion(csm.quat));
    _t.copy(lm.mainEngine.thrustDir).applyQuaternion(lm.quat);
    b.F.addScaledVector(_t, tL);
    b.T.copy(_Tc);
    csm.phys.force.copy(b.F);
    lm.phys.force.copy(b.F);
    integrateRigid(b, h, false);
    if (advanceCapture(st, h)) {
      game.events.emit('dock', { a: 'CSM', b: 'LM' });
      game.events.emit('message', { text: 'Hard dock — docking latches engaged', level: 'good' });
    }
    slaveLM(st, csm, lm);
    for (const v of [csm, lm]) {
      const why = hullBelowGround(v);
      if (why) {
        crashVessel(S, csm, 'crashed', why, true);
        crashVessel(S, lm, 'crashed', why, true);
        break;
      }
    }
  }

  const _relM = new THREE.Matrix3();
  const _m4 = new THREE.Matrix4();
  function relMat(st) {
    return _relM.setFromMatrix4(_m4.makeRotationFromQuaternion(st.relQ));
  }
  const _scg = { CSM: new THREE.Vector3(), LM: new THREE.Vector3() };
  function stackCgIn(v) {
    return _scg[v.id].copy(v.stack ? v.stack.cg : v.cg);
  }

  function checkAutoDock(h) {
    const { LM: lm, CSM: csm } = game.vessels;
    if (S.stack || lm.crashed || csm.crashed) return;
    if (S.noDockTimer > 0) {
      S.noDockTimer -= h;
      return;
    }
    if (lm.pos.distanceToSquared(csm.pos) > 400) return;
    const g = dockingGeometry(csm, lm, S.dockGeom || (S.dockGeom = {}));
    const ok = Math.abs(g.axial) < DOCK.CAPTURE_AXIAL && g.lateral < DOCK.CAPTURE_LATERAL && g.closing < DOCK.CAPTURE_CLOSING && g.closing > -0.05 && g.misalignDeg < DOCK.CAPTURE_MISALIGN_DEG;
    if (ok) {
      capture();
      return;
    }
    // probe hits the drogue / docking ring outside the capture envelope: bounce off
    if (g.axial < 0 && g.axial > -1.0 && g.lateral < 0.8 && g.closing > 0) {
      const c = bounce(csm, lm);
      if (c > 0 && game.time.met - S.lastBounceMsg > 2) {
        S.lastBounceMsg = game.time.met;
        const why =
          g.closing >= DOCK.CAPTURE_CLOSING
            ? `closing ${fmtSpeed(game, g.closing, 2)} > ${fmtSpeed(game, DOCK.CAPTURE_CLOSING, 2)}`
            : g.misalignDeg >= DOCK.CAPTURE_MISALIGN_DEG
              ? `misaligned ${g.misalignDeg.toFixed(0)}° > ${DOCK.CAPTURE_MISALIGN_DEG}°`
              : `off-centre ${fmtLen(game, g.lateral, 1)}`;
        game.events.emit('message', { text: `Probe contact — no capture (${why})`, level: 'warn' });
      }
    }
  }

  function autoStage() {
    const lm = game.vessels.LM;
    if (lm.staged || lm.docked || lm.crashed) return;
    if ((lm.landed || lm.phys.sleeping) && lm.gnc.program === 'P12' && (lm.mainEngine.throttleCmd || 0) > 0) stageLM(S, lm);
  }

  function physicsStep(h) {
    const { LM: lm, CSM: csm } = game.vessels;
    if (S.stack) stepStack(h);
    else {
      stepFreeVessel(lm, h);
      stepFreeVessel(csm, h);
      checkAutoDock(h);
    }
    updateDescentStage(S, lm.descentStage, h);
    if (lm.phys.rcsActive || csm.phys.rcsActive) S.rcsTimer = STEP.RCS_HOLD;
    else S.rcsTimer = Math.max(0, S.rcsTimer - h);
  }

  function refreshTelemetry() {
    const { LM: lm, CSM: csm } = game.vessels;
    csm.probeExtension = S.stack ? S.stack.probeExtension ?? 0 : 1;
    updateTelemetry(lm, csm, S.stack);
    updateTelemetry(csm, lm, S.stack);
  }

  /**
   * Bumpless AUTO -> MANUAL throttle handover (P66 -> P67, P63 -> P00 / P47, P66 -> P68 after
   * ENGINE STOP, P12/P71 -> P00 after insertion), for BOTH vessels whether flown or not: the
   * throttle lever takes the throttle the computer commanded last, i.e. 0 after an engine stop
   * or cut-off. Without this the first manual-throttle cycle would relight the engine at
   * whatever the lever held before the automatic phase (e.g. an old hover setting).
   */
  function throttleHandover(v) {
    const pv = S.thrPrev[v.id];
    const mode = v.gnc.throttleMode;
    if (pv.mode === 'AUTO' && mode === 'MANUAL') {
      const lever = pv.cmd > 1e-4 && v.mainEngine.firing ? Math.min(1, pv.cmd) : 0;
      v.ctrl.throttle = lever;
      v.mainEngine.throttleCmd = lever;
    }
  }
  function recordThrottle(v) {
    const pv = S.thrPrev[v.id] || (S.thrPrev[v.id] = {});
    pv.mode = v.gnc.throttleMode;
    pv.cmd = v.mainEngine.throttleCmd || 0;
  }

  function substep(h) {
    const { LM: lm0, CSM: csm0 } = game.vessels;
    recordThrottle(lm0);
    recordThrottle(csm0);
    gnc.update(h);
    if (S.gncInit) {
      const f = S.gncInit;
      S.gncInit = null;
      f();
    }
    throttleHandover(lm0);
    throttleHandover(csm0);
    autoStage();
    if (h > STEP.ACTIVE + 1e-9 && (jetsCommanded() || engineWanted(game.vessels.LM) || engineWanted(game.vessels.CSM))) {
      // something woke up during a long coast step: integrate it finely with the same commands
      const n = Math.ceil(h / STEP.ACTIVE);
      for (let i = 0; i < n; i++) physicsStep(h / n);
    } else physicsStep(h);
    game.time.met += h;
    refreshTelemetry();
    updateCaution(game.vessels.LM, S.ev);
    updateCaution(game.vessels.CSM, S.ev);
    while (S.timeline.length && S.timeline[0].met <= game.time.met) S.timeline.shift().fn();
  }

  /**
   * Advance the simulation by realDt seconds of wall-clock time (times the warp factor).
   * @param {number} realDt seconds
   * @param {{ignoreWarp?: boolean}} [opts]
   * @returns {number} simulated seconds actually advanced
   */
  function step(realDt, opts = {}) {
    if (!(realDt > 0)) return 0;
    const ignoreWarp = !!opts.ignoreWarp;
    let actual = 1;
    if (!ignoreWarp) {
      const { lim, reason, ignition } = warpLimit();
      if (ignition && game.time.warp > 1) {
        // drop the REQUEST too: a missed ignition must not bring 1000x back a moment later
        game.time.warp = 1;
        message(`Time warp stopped — ${reason}`, 'warn', 5);
      }
      const req = Math.max(1, game.time.warp || 1);
      actual = Math.min(req, lim);
      if (actual !== S.lastWarpActual) {
        if (actual < req) message(`Time warp limited to ${actual}× — ${reason}`, 'warn');
        else if (S.lastWarpActual < req || actual > S.lastWarpActual) message(`Time warp ${actual}× restored`, 'info');
        S.lastWarpActual = actual;
      }
      game.time.warpActual = actual;
    }
    let remaining = realDt * actual;
    let elapsed = 0;
    let count = 0;
    const t0 = actual > 10 ? now() : 0;
    while (remaining > 1e-9) {
      const hMax = chooseH();
      const n = Math.ceil(remaining / hMax - 1e-9);
      const h = remaining / n;
      substep(h);
      remaining -= h;
      elapsed += h;
      if (actual > 1 && remaining > 1e-9 && warpLimit().lim < actual) break; // limit applies at once
      if (++count >= STEP.MAX_SUBSTEPS) break;
      if (t0 && (count & 31) === 0 && now() - t0 > STEP.BUDGET_MS) break; // keep the frame rate
    }
    game.time.warpEffective = realDt > 0 ? elapsed / realDt : 1;
    return elapsed;
  }

  return {
    scenarios: SCENARIOS,
    loadScenario,
    step,
    updateTelemetry: refreshTelemetry,
    switchVessel,
    undock,
    dock: dockManual,
    stage,
    setWarp,
    warpLimit,
    WARP_LEVELS,
    internals: S,
  };
}
