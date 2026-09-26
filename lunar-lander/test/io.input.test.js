// IO agent: input helpers and bindings.
import test from 'node:test';
import assert from 'node:assert/strict';
import { rampAxis, stickDeadzone, axisDeadzone, expo, mix, repeatClicks, KEY_RAMP_TIME } from '../src/input/axes.js';
import { AXIS_KEYS, ACTION_KEYS, SHIFT_ACTION_KEYS, AUTOPILOT_KEYS, LPD_KEYS, THROTTLE_KEYS, BINDINGS, GAME_CODES } from '../src/input/bindings.js';

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);

test('keyboard axis reaches full deflection in KEY_RAMP_TIME', () => {
  let v = 0;
  const dt = 1 / 120;
  let t = 0;
  while (v < 1 && t < 1) {
    v = rampAxis(v, 1, dt);
    t += dt;
  }
  assert.equal(v, 1);
  near(t, KEY_RAMP_TIME, dt + 1e-9);
  // proportional: half way after half the time
  near(rampAxis(0, 1, KEY_RAMP_TIME / 2), 0.5, 1e-12);
});

test('release returns to exactly zero, reversal passes through zero', () => {
  let v = 1;
  for (let i = 0; i < 20; i++) v = rampAxis(v, 0, 1 / 60);
  assert.equal(v, 0);
  const r = rampAxis(0.2, -1, 0.1); // 0.2 -> 0 takes 0.012 s at the release rate, then outward
  assert.ok(r < 0 && r > -1, `reversal ${r}`);
  assert.equal(rampAxis(0.5, 0.5, 0.1), 0.5);
  assert.equal(rampAxis(0.3, 0.3, 0), 0.3);
});

test('deadzones rescale smoothly and expo keeps the end points', () => {
  assert.deepEqual(stickDeadzone(0.05, 0.05), [0, 0]);
  const [x] = stickDeadzone(1, 0);
  near(x, 1);
  const [a] = stickDeadzone(0.13, 0);
  assert.ok(a > 0 && a < 0.02);
  assert.equal(axisDeadzone(0.1), 0);
  near(axisDeadzone(-1), -1);
  near(expo(1), 1);
  near(expo(-1), -1);
  assert.ok(expo(0.3) < 0.3 && expo(0.3) > 0);
  assert.equal(mix(0.8, 0.8), 1);
  assert.equal(mix(-0.5, undefined, 0.2), -0.3);
});

test('repeatClicks: one on press, then ~4 Hz while held', () => {
  const s = { held: false, t: 0 };
  let n = repeatClicks(s, true, 1 / 60);
  assert.equal(n, 1);
  let total = 0;
  for (let i = 0; i < 60; i++) total += repeatClicks(s, true, 1 / 60); // one more second held
  assert.ok(total >= 2 && total <= 4, `repeats ${total}`);
  assert.equal(repeatClicks(s, false, 1 / 60), 0);
  assert.equal(repeatClicks(s, true, 1 / 60), 1);
});

test('bindings are conflict-free and avoid browser keys', () => {
  const maps = [AXIS_KEYS, ACTION_KEYS, AUTOPILOT_KEYS, LPD_KEYS];
  const seen = new Map();
  for (const m of maps) {
    for (const code of Object.keys(m)) {
      assert.ok(!seen.has(code) || seen.get(code) === m, `key ${code} bound twice`);
      seen.set(code, m);
    }
  }
  for (const code of Object.values(THROTTLE_KEYS)) assert.ok(!seen.has(code), `throttle key ${code} also bound elsewhere`);
  for (const code of Object.keys(SHIFT_ACTION_KEYS)) assert.ok(ACTION_KEYS[code] || code === THROTTLE_KEYS.cut, 'shift variants extend a plain key');
  // X = ENGINE STOP (latching), Shift+X = ENGINE START (resets the latch)
  assert.equal(THROTTLE_KEYS.cut, 'KeyX');
  assert.equal(SHIFT_ACTION_KEYS.KeyX, 'ENGINE_START');
  assert.ok(BINDINGS.some((b) => b.keys.includes('Shift+X') && /ENGINE START/.test(b.action)));
  assert.ok(BINDINGS.some((b) => b.keys.includes('X') && /latch/i.test(b.action)));
  for (const bad of ['F5', 'F11', 'F12', 'ControlLeft', 'MetaLeft', 'AltLeft']) assert.ok(!GAME_CODES.has(bad), `${bad} must stay with the browser`);
  // the required layout
  assert.deepEqual(AXIS_KEYS.KeyW, ['pitch', -1]);
  assert.deepEqual(AXIS_KEYS.KeyS, ['pitch', 1]);
  assert.deepEqual(AXIS_KEYS.KeyD, ['yaw', 1]);
  assert.deepEqual(AXIS_KEYS.KeyE, ['roll', 1]);
  assert.deepEqual(AXIS_KEYS.KeyH, ['transFwd', 1]);
  assert.deepEqual(AXIS_KEYS.KeyL, ['transRight', 1]);
  assert.deepEqual(AXIS_KEYS.KeyI, ['transUp', 1]);
  assert.equal(ACTION_KEYS.KeyV, 'SWITCH_VESSEL');
  assert.equal(ACTION_KEYS.KeyP, 'PAUSE');
  assert.equal(AUTOPILOT_KEYS.Digit0, 'GUIDANCE');
  assert.equal(AUTOPILOT_KEYS.Digit9, 'TARGET');
  assert.deepEqual(LPD_KEYS.ArrowUp, { dx: 0, dy: 1 });
});

test('BINDINGS help table is well formed', () => {
  assert.ok(BINDINGS.length > 20);
  for (const b of BINDINGS) {
    assert.equal(typeof b.group, 'string');
    assert.ok(Array.isArray(b.keys) && b.keys.length > 0);
    assert.equal(typeof b.action, 'string');
  }
});
