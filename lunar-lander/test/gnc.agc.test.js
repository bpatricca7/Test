// GNC — DSKY register formatting, nouns, and the Aldrin-style landing callouts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { reg, regMinSec, regPair, regOctal } from '../src/gnc/agc.js';
import { buildCallout, spokenRate, roundAltitude, createCalloutState } from '../src/gnc/callouts.js';

test('DSKY registers: sign + 5 digits, scaling, clamping, blanks', () => {
  assert.equal(reg(350), '+00350');
  assert.equal(reg(-12.5, 10), '-00125');
  assert.equal(reg(5535, 10), '+55350');
  assert.equal(reg(1234567), '+99999');
  assert.equal(reg(-1e9), '-99999');
  assert.equal(reg(NaN), '');
  assert.equal(reg(null), '');
  assert.equal(reg(-0.2), '-00000');
});

test('DSKY two-field registers: minutes/seconds and TTAA', () => {
  assert.equal(regMinSec(-40), '-00 40');
  assert.equal(regMinSec(334), '+05 34');
  assert.equal(regMinSec(7200), '+59 59');
  assert.equal(regPair(47, 35), '+47 35');
  assert.equal(regPair(120, 3.4), '+99 03');
  assert.equal(regOctal('1202'), ' 01202');
});

test('spoken rates and rounded altitudes', () => {
  assert.equal(spokenRate(23.2), '23');
  assert.equal(spokenRate(9.1), '9');
  assert.equal(spokenRate(4.4), '4 1/2');
  assert.equal(spokenRate(0.6), 'a half');
  assert.equal(roundAltitude(752), '750' * 1);
  assert.equal(roundAltitude(1234), 1200);
  assert.equal(roundAltitude(103), 100);
  assert.equal(roundAltitude(42), 40);
});

test('Aldrin-style callouts are built from the telemetry (and only say what is true)', () => {
  const C = createCalloutState();
  assert.equal(buildCallout({ altFt: 752, downFps: 23, fwdFps: 60, rightFps: 0, n: 1 }, C), '750, coming down at 23.');
  assert.equal(buildCallout({ altFt: 398, downFps: 9.2, fwdFps: 0.2, rightFps: 0, n: 0 }, C), '400 feet, down at 9.');
  assert.equal(buildCallout({ altFt: 101, downFps: 3.4, fwdFps: 9, rightFps: 0, n: 2 }, C), '100 feet, 3 1/2 down, 9 forward.');
  assert.equal(buildCallout({ altFt: 76, downFps: 0.5, fwdFps: 6, rightFps: 0, n: 0 }, C), '75 feet, looking good, down a half, 6 forward.');
  assert.equal(buildCallout({ altFt: 41, downFps: 2.5, fwdFps: 0, rightFps: 0, n: 3, dust: true }, C), '40, down 2 1/2, picking up some dust.');
  assert.equal(buildCallout({ altFt: 30, downFps: 2.5, fwdFps: 4, rightFps: 2, n: 2, shadow: true }, C), '30 feet, 2 1/2 down, 4 forward, faint shadow, drifting to the right a little.');
  // no drift remark without drift, no dust remark twice
  const s = buildCallout({ altFt: 20, downFps: 1, fwdFps: 0, rightFps: 0.2, n: 0, dust: true }, C);
  assert.ok(!/drifting|dust/.test(s), s);
});
