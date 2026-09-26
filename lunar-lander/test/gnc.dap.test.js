// GNC — digital autopilot: jet selection, RATE / PULSE / DIRECT modes, attitude hold, autopilots.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createGameState, createLM, createCSM } from '../src/core/state.js';
import { LM, CSM } from '../src/core/constants.js';
import { createSim } from '../src/sim/sim.js';
import { updateVesselMassProps } from '../src/sim/massprops.js';
import { createGNC } from '../src/gnc/gnc.js';
import { buildJetSets, createDAPState, dapStep, commandedTorque, quatError, DAP_CONFIG } from '../src/gnc/dap.js';

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

// ------------------------------------------------------------------ helpers

function lmFull() {
  const v = createLM();
  updateVesselMassProps(v);
  return v;
}
function lmStaged() {
  const v = createLM();
  v.staged = true;
  v.propellant.main = v.propellant.ascent;
  updateVesselMassProps(v);
  return v;
}
function csm() {
  const v = createCSM();
  updateVesselMassProps(v);
  return v;
}

/** Commanded body torque for one stick input in a given RCS mode (first substep). */
function torqueFor(v, mode, stick) {
  v.gnc.rcsMode = mode;
  v.angVel.set(0, 0, 0);
  const st = createDAPState();
  const io = { stick: new THREE.Vector3(...stick), trans: new THREE.Vector3(), transDuty: 1, fine: false, target: null, targetRate: 0, enabled: true };
  dapStep(v, st, 0.02, io);
  return commandedTorque(v);
}

function makeSim(scenario) {
  const game = createGameState({ scenario: null, warp: 1 });
  const gnc = createGNC(game);
  const sim = createSim(game, { gnc });
  sim.loadScenario(scenario);
  return { game, gnc, sim };
}

function run(sim, seconds, each) {
  const n = Math.round(seconds * 60);
  for (let i = 0; i < n; i++) {
    sim.step(1 / 60, { ignoreWarp: true });
    if (each) each(i / 60);
  }
}

// ------------------------------------------------------------------ jet selection

for (const [name, make, type] of [
  ['LM (descent stage attached)', lmFull, 'LM'],
  ['LM ascent stage', lmStaged, 'LM'],
  ['CSM', csm, 'CSM'],
]) {
  test(`jet couples of the ${name}: pure couples with the right signs`, () => {
    const v = make();
    const sets = buildJetSets(type, v.rcs.jets, v.cg);
    for (let a = 0; a < 3; a++) {
      for (let si = 0; si < 2; si++) {
        const sign = si === 0 ? 1 : -1;
        for (const couple of [sets.rot[a][si].four, ...sets.rot[a][si].two]) {
          assert.ok(couple.idx.length >= 2, `axis ${a} sign ${sign}: at least a jet pair`);
          const t = couple.torque;
          const on = t.getComponent(a) * sign;
          assert.ok(on > 0, `axis ${a} sign ${sign}: torque in the commanded direction`);
          const cross = Math.hypot(...[0, 1, 2].filter((k) => k !== a).map((k) => t.getComponent(k)));
          assert.ok(cross < 0.2 * on, `axis ${a} sign ${sign}: cross-coupling ${(cross / on).toFixed(2)} < 0.2`);
          const f = couple.idx.reduce((s, i) => s.add(sets.force[i]), new THREE.Vector3());
          assert.ok(f.length() < 1, `axis ${a}: couple has no net force (${f.length().toFixed(2)} N)`);
        }
      }
    }
  });

  test(`hand-controller signs of the ${name}: +pitch -> +wx, +yaw -> -wy, +roll -> -wz`, () => {
    const v = make();
    for (const mode of ['DIRECT', 'RATE']) {
      const tp = torqueFor(v, mode, [1, 0, 0]);
      const ty = torqueFor(v, mode, [0, 1, 0]);
      const tr = torqueFor(v, mode, [0, 0, 1]);
      assert.ok(tp.x > 0 && Math.abs(tp.y) < 0.2 * tp.x && Math.abs(tp.z) < 0.2 * tp.x, `${mode} pitch torque ${tp.toArray()}`);
      assert.ok(ty.y < 0 && Math.abs(ty.x) < 0.2 * -ty.y && Math.abs(ty.z) < 0.2 * -ty.y, `${mode} yaw torque ${ty.toArray()}`);
      assert.ok(tr.z < 0 && Math.abs(tr.x) < 0.2 * -tr.z && Math.abs(tr.y) < 0.2 * -tr.z, `${mode} roll torque ${tr.toArray()}`);
    }
  });
}

test('LM jet families mimic the real vehicle (pitch/roll up-down jets, yaw horizontal jets)', () => {
  const v = lmFull();
  const sets = buildJetSets('LM', v.rcs.jets, v.cg);
  const idsOf = (veh) => (c) => c.idx.map((i) => veh.rcs.jets[i].id);
  let ids = idsOf(v);
  for (const a of [0, 2]) for (const s of [0, 1]) for (const id of ids(sets.rot[a][s].four)) assert.match(id, /[UD]$/);
  for (const s of [0, 1]) for (const id of ids(sets.rot[1][s].four)) assert.match(id, /[XZ]$/);
  // two A/B pairs for each LM axis
  for (let a = 0; a < 3; a++) assert.equal(sets.rot[a][0].two.length, 2);
  // CSM: pitch/yaw axial jets on opposite quads, roll tangential
  const c = csm();
  const cs = buildJetSets('CSM', c.rcs.jets, c.cg);
  ids = idsOf(c);
  assert.deepEqual(ids(cs.rot[0][0].four).map((s) => s[0]).sort(), ['A', 'C']);
  assert.deepEqual(ids(cs.rot[1][0].four).map((s) => s[0]).sort(), ['B', 'D']);
  for (const id of ids(cs.rot[2][0].four)) assert.match(id, /[PM]$/);
});

test('control authority matches the jet geometry (LM 2-jet pitch couple ~1,380 N m)', () => {
  const v = lmFull();
  const sets = buildJetSets('LM', v.rcs.jets, v.cg);
  const expected = 2 * LM.rcs.thrust * LM.rcs.quadRadius;
  const two = sets.rot[0][0].two[0].torque.x;
  assert.ok(Math.abs(two - expected) / expected < 0.02, `2-jet pitch ${two.toFixed(0)} vs ${expected}`);
  assert.ok(Math.abs(sets.rot[0][0].four.torque.x - 2 * expected) / expected < 0.04);
  // full LM pitch acceleration (4 jets) ~ 5 deg/s^2; ascent stage ~ 4x more agile
  const accFull = (sets.rot[0][0].four.torque.x / v.inertia.x) * R2D;
  const s = lmStaged();
  const accAsc = (buildJetSets('LM', s.rcs.jets, s.cg).rot[0][0].four.torque.x / s.inertia.x) * R2D;
  assert.ok(accFull > 3 && accFull < 8, `full LM pitch accel ${accFull.toFixed(1)} deg/s^2`);
  assert.ok(accAsc > 2.5 * accFull, `ascent stage ${accAsc.toFixed(1)} deg/s^2`);
  // CSM pitch (2 axial jets at 2.1 m) ~ 0.5-1 deg/s^2
  const c = csm();
  const accCsm = (buildJetSets('CSM', c.rcs.jets, c.cg).rot[0][0].four.torque.x / c.inertia.x) * R2D;
  assert.ok(accCsm > 0.4 && accCsm < 1.5, `CSM pitch accel ${accCsm.toFixed(2)} deg/s^2`);
});

test('translation jets: +Y (ullage) uses the four down-firing LM jets', () => {
  const v = lmFull();
  const sets = buildJetSets('LM', v.rcs.jets, v.cg);
  assert.deepEqual(sets.trans['+y'].idx.map((i) => v.rcs.jets[i].id).sort(), ['Q1D', 'Q2D', 'Q3D', 'Q4D']);
  assert.equal(sets.trans['-z'].idx.length, 2);
  const c = csm();
  const cs = buildJetSets('CSM', c.rcs.jets, c.cg);
  assert.equal(cs.trans['-z'].idx.length, 4, 'CSM +X translation: four aft-firing jets');
  assert.ok(cs.trans['+x'].force.x > 0.95 * 2 * CSM.rcs.thrust);
});

// ------------------------------------------------------------------ closed loop (sim physics)

test('RATE mode: stick step gives the commanded rate without overshoot, release nulls and holds (60 s, no drift)', () => {
  for (const [scenario, who, fullRate] of [
    ['docking', 'LM', 20],
    ['csm', 'CSM', 7],
  ]) {
    const { game, gnc, sim } = makeSim(scenario);
    game.events.emit('action', { name: 'SWITCH_VESSEL', to: who });
    const v = game.vessels[who];
    game.events.emit('action', { name: 'AUTOPILOT', mode: 'OFF' });
    const cmd = (0.5 - DAP_CONFIG[who].detent) / (1 - DAP_CONFIG[who].detent) * fullRate;
    let peak = 0;
    v.ctrl.pitch = 0.5;
    const hold = scenario === 'csm' ? 12 : 3;
    run(sim, hold, () => (peak = Math.max(peak, v.angVel.x * R2D)));
    assert.ok(Math.abs(v.angVel.x * R2D - cmd) < 0.05 * cmd, `${who}: rate ${(v.angVel.x * R2D).toFixed(2)} vs cmd ${cmd.toFixed(2)} deg/s`);
    assert.ok(peak < cmd * 1.05, `${who}: overshoot ${peak.toFixed(2)}`);
    v.ctrl.pitch = 0;
    run(sim, scenario === 'csm' ? 20 : 8);
    assert.equal(v.gnc.dapPhase, 'HOLD', `${who}: attitude hold captured`);
    const ref = gnc.stateOf(v).dap.hold.clone(); // attitude captured at release
    let maxErr = 0;
    let maxRate = 0;
    const e = new THREE.Vector3();
    run(sim, 60, () => {
      quatError(ref, v.quat, e);
      maxErr = Math.max(maxErr, Math.abs(e.x), Math.abs(e.y), Math.abs(e.z));
      maxRate = Math.max(maxRate, v.angVel.length() * R2D);
    });
    maxErr *= R2D;
    const db = DAP_CONFIG[who].deadband * R2D;
    assert.ok(gnc.stateOf(v).dap.hold.angleTo(ref) < 1e-9, `${who}: the hold reference did not move`);
    assert.ok(maxErr < db + 0.1, `${who}: attitude error ${maxErr.toFixed(3)} deg per axis over 60 s (deadband ${db})`);
    assert.ok(maxRate < 0.25, `${who}: limit-cycle rate ${maxRate.toFixed(3)} deg/s`);
  }
});

test('RATE mode works for the full LM (descent stage) and the docked stack', () => {
  // full LM in its descent orbit (P00, engine off)
  {
    const { game, sim } = makeSim('pdi');
    game.events.emit('action', { name: 'PROGRAM', program: 'P00' });
    const v = game.vessels.LM;
    v.ctrl.yaw = 1;
    run(sim, 6);
    assert.ok(Math.abs(v.angVel.y * R2D + 20) < 1, `full LM yaw rate ${(v.angVel.y * R2D).toFixed(2)} (want -20)`);
    v.ctrl.yaw = 0;
    run(sim, 10);
    assert.ok(v.angVel.length() * R2D < 0.1, 'rates nulled');
    assert.equal(v.gnc.dapPhase, 'HOLD');
  }
  // docked stack flown from the LM: slow but correct
  {
    const { game, sim } = makeSim('undock');
    const lm = game.vessels.LM;
    const c = game.vessels.CSM;
    lm.ctrl.pitch = 1;
    run(sim, 3);
    assert.ok(lm.angVel.x > 0, 'stack pitches up in the LM frame');
    assert.ok(lm.angVel.x * R2D < 2, 'stack is sluggish (huge inertia)');
    for (const j of c.rcs.jets) assert.equal(j.cmd, 0, 'only the active vehicle fires jets when docked');
    lm.ctrl.pitch = 0;
    run(sim, 30);
    assert.ok(lm.angVel.length() * R2D < 0.1, `stack rates nulled (${(lm.angVel.length() * R2D).toFixed(3)})`);
  }
});

test('PULSE mode: one minimum-impulse bit per deflection, repeating at 4 Hz after 0.5 s', () => {
  const v = lmStaged();
  v.gnc.rcsMode = 'PULSE';
  const st = createDAPState();
  const io = { stick: new THREE.Vector3(), trans: new THREE.Vector3(), transDuty: 1, fine: false, target: null, targetRate: 0, enabled: true };
  const h = 1 / 120;
  let onTime = 0;
  const step = (sx) => {
    io.stick.set(sx, 0, 0);
    dapStep(v, st, h, io);
    for (const j of v.rcs.jets) onTime += j.cmd * h;
  };
  step(1); // new deflection
  for (let i = 0; i < 20; i++) step(1); // held 0.175 s: no repeat yet
  const bit = 2 * LM.rcs.minImpulseBit;
  assert.ok(Math.abs(onTime - bit) < 1e-6, `one bit: ${onTime} jet-seconds`);
  for (let i = 0; i < 20; i++) step(0);
  for (let i = 0; i < 4; i++) step(1);
  assert.ok(Math.abs(onTime - 2 * bit) < 1e-6, 'second deflection, second bit');
  for (let i = 0; i < 120; i++) step(1); // held ~1.03 s -> repeats at 0.5, 0.75, 1.0
  assert.ok(Math.abs(onTime - 5 * bit) < 1e-6, `repeats while held: ${(onTime / bit).toFixed(2)} bits`);
});

test('DIRECT mode: all four jets of the axis full on while deflected, nothing when released', () => {
  const v = lmFull();
  v.gnc.rcsMode = 'DIRECT';
  const st = createDAPState();
  const io = { stick: new THREE.Vector3(0, 0, -1), trans: new THREE.Vector3(), transDuty: 1, fine: false, target: null, targetRate: 0, enabled: true };
  dapStep(v, st, 0.02, io);
  const on = v.rcs.jets.filter((j) => j.cmd === 1).map((j) => j.id);
  assert.equal(on.length, 4);
  io.stick.set(0, 0, 0);
  v.angVel.set(0.1, 0, 0);
  dapStep(v, st, 0.02, io);
  assert.equal(v.rcs.jets.filter((j) => j.cmd > 0).length, 0, 'no rate damping in DIRECT');
});

test('attitude autopilots converge: CSM prograde, LM radial-out and local-vertical', () => {
  {
    const { game, sim } = makeSim('csm');
    game.events.emit('action', { name: 'AUTOPILOT', mode: 'PROGRADE' });
    const c = game.vessels.CSM;
    run(sim, 150);
    const nose = new THREE.Vector3(0, 0, -1).applyQuaternion(c.quat);
    const ang = nose.angleTo(c.vel) * R2D;
    assert.ok(ang < 1.0, `CSM nose ${ang.toFixed(2)} deg from prograde`);
    assert.ok(c.angVel.length() * R2D < 0.2);
  }
  {
    const { game, sim } = makeSim('docking');
    game.events.emit('action', { name: 'SWITCH_VESSEL', to: 'LM' });
    game.events.emit('action', { name: 'AUTOPILOT', mode: 'RADIAL_OUT' });
    const v = game.vessels.LM;
    run(sim, 40);
    const upB = new THREE.Vector3(0, 1, 0).applyQuaternion(v.quat);
    assert.ok(upB.angleTo(v.pos) * R2D < 1, `LM +Y ${(upB.angleTo(v.pos) * R2D).toFixed(2)} deg from radial`);
    game.events.emit('action', { name: 'AUTOPILOT', mode: 'LOCAL_VERTICAL' });
    run(sim, 40);
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(v.quat);
    const along = v.vel.clone().addScaledVector(v.pos.clone().normalize(), -v.vel.dot(v.pos) / v.pos.length());
    assert.ok(fwd.angleTo(along) * R2D < 1.5, `windows along-track (${(fwd.angleTo(along) * R2D).toFixed(2)} deg)`);
    // stick input drops the autopilot to attitude hold
    v.ctrl.roll = 0.5;
    run(sim, 0.2);
    assert.equal(v.gnc.autopilot, 'OFF');
  }
});

test('KILL_ROT nulls the rates and leaves attitude hold', () => {
  const { game, sim } = makeSim('docking');
  const c = game.vessels.CSM;
  c.angVel.set(0.02, -0.01, 0.03);
  game.events.emit('action', { name: 'KILL_ROT' });
  run(sim, 30);
  assert.ok(c.angVel.length() * R2D < 0.1);
  assert.equal(c.gnc.autopilot, 'OFF');
});
