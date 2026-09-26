// UI pure logic: display formatting and settings persistence.
import test from 'node:test';
import assert from 'node:assert/strict';
import { num, fmtMET, fmtClock, fmtDuration, fmtAlt, fmtSpeed, fmtDist, fmtOrbitAlt, fmtBearing, fmtAngle, fmtPct, fmtWarp, dskyPrompt, grade, MINUS } from '../src/ui/format.js';
import { ensureDefaults, loadSettings, saveSettings, qualityURL, STORAGE_KEY } from '../src/ui/settings.js';

test('num: grouping, decimals, typographic minus, no negative zero', () => {
  assert.equal(num(12500), '12,500');
  assert.equal(num(1234567.891, 2), '1,234,567.89');
  assert.equal(num(-42.25, 1), `${MINUS}42.3`);
  assert.equal(num(-0.04, 1), '0.0');
  assert.equal(num(3.2, 1, { plus: true }), '+3.2');
  assert.equal(num(0, 1, { plus: true }), '0.0');
  assert.equal(num(NaN), '—');
});

test('fmtMET: Apollo GET HHH:MM:SS', () => {
  assert.equal(fmtMET(102 * 3600 + 45 * 60 + 40), '102:45:40');
  assert.equal(fmtMET(59.9), '000:00:59');
  assert.equal(fmtMET(-65), `${MINUS}000:01:05`);
  assert.equal(fmtMET(Infinity), '---:--:--');
});

test('fmtClock', () => {
  assert.equal(fmtClock(39.7), '0:39');
  assert.equal(fmtClock(605), '10:05');
  assert.equal(fmtClock(3725), '1:02:05');
});

test('fmtDuration', () => {
  assert.equal(fmtDuration(42.7), '42');
  assert.equal(fmtDuration(65), '1:05');
  assert.equal(fmtDuration(3723), '1:02:03');
  assert.equal(fmtDuration(-5.5, { tenths: true }), `${MINUS}5.5`);
});

test('altitude units: feet then nmi (imperial), metres then km (metric)', () => {
  assert.deepEqual(fmtAlt(152.4), { v: '500', u: 'FT' });
  assert.deepEqual(fmtAlt(10), { v: '32.8', u: 'FT' });
  assert.deepEqual(fmtAlt(111000), { v: '59.9', u: 'NMI' });
  assert.deepEqual(fmtAlt(55.55, 'metric'), { v: '55.5', u: 'M' });
  assert.deepEqual(fmtAlt(15200, 'metric'), { v: '15.20', u: 'KM' });
});

test('speed and distance units', () => {
  assert.deepEqual(fmtSpeed(-0.9144), { v: `${MINUS}3.0`, u: 'FT/S' });
  assert.deepEqual(fmtSpeed(1690, 'imperial'), { v: '5,545', u: 'FT/S' });
  assert.deepEqual(fmtSpeed(1.25, 'metric', { plus: true }), { v: '+1.3', u: 'M/S' });
  assert.deepEqual(fmtDist(300), { v: '984', u: 'FT' });
  assert.deepEqual(fmtDist(480000), { v: '259', u: 'NMI' });
  assert.deepEqual(fmtDist(1852 * 7.25), { v: '7.25', u: 'NMI' });
  assert.deepEqual(fmtDist(2500, 'metric'), { v: '2.50', u: 'KM' });
  assert.deepEqual(fmtOrbitAlt(111000), { v: '59.9', u: 'NMI' });
  assert.deepEqual(fmtOrbitAlt(15200, 'metric'), { v: '15.2', u: 'KM' });
});

test('angles, bearings, percent, warp', () => {
  assert.equal(fmtBearing(274.4), '274°');
  assert.equal(fmtBearing(-10), '350°');
  assert.equal(fmtBearing(359.6), '000°');
  assert.equal(fmtAngle(12.34), '+12.3°');
  assert.equal(fmtPct(0.734), '73%');
  assert.equal(fmtPct(0.045, { fine: true }), '4.5%');
  assert.equal(fmtWarp({ paused: true, warpActual: 10 }), 'PAUSED');
  assert.equal(fmtWarp({ warpActual: 1 }), '1×');
  assert.equal(fmtWarp({ warpActual: 100, warpEffective: 37.2 }), '100× (37×)');
  assert.equal(fmtWarp({ warpActual: 10, warpEffective: 9.8 }), '10×');
  assert.equal(fmtWarp({ warp: 100, warpActual: 10, warpEffective: 10 }), '10× (req 100×)');
});

test('DSKY prompt and grade', () => {
  assert.equal(dskyPrompt({ flashVerbNoun: false, verb: '99' }), null);
  assert.equal(dskyPrompt({ flashVerbNoun: true, verb: '99', noun: '62' }).title, 'ENGINE ON ENABLE');
  assert.equal(dskyPrompt({ flashVerbNoun: true, verb: '05', noun: '09', alarmCode: '1202' }).title, 'PROGRAM ALARM 1202');
  assert.equal(dskyPrompt({ flashVerbNoun: true, verb: '50', noun: '18' }).title, 'V50 N18');
  assert.equal(grade(97), 'A+');
  assert.equal(grade(81), 'B');
  assert.equal(grade(10), 'F');
});

function memoryStorage(init = {}) {
  const m = new Map(Object.entries(init));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    map: m,
  };
}

test('settings: defaults, save/load round trip, URL parameters win, invalid values ignored', () => {
  const s = ensureDefaults({ hud: true, units: 'imperial' });
  assert.equal(s.filmGrain, true);
  assert.equal(s.exposureComp, 0);
  const store = memoryStorage();
  s.units = 'metric';
  s.hud = false;
  s.exposureComp = 1.2;
  s.volume = 7; // invalid: not persisted
  assert.equal(saveSettings(s, store), true);
  const saved = JSON.parse(store.getItem(STORAGE_KEY));
  assert.equal(saved.units, 'metric');
  assert.equal('volume' in saved, false);

  const fresh = { hud: true, units: 'imperial' };
  const applied = loadSettings(fresh, { hud: true }, store); // ?hud=1 given in the URL
  assert.equal(fresh.units, 'metric');
  assert.equal(fresh.exposureComp, 1.2);
  assert.equal(fresh.hud, true, 'URL parameter wins over the stored value');
  assert.ok(!applied.includes('hud'));

  const broken = memoryStorage({ [STORAGE_KEY]: '{not json' });
  assert.deepEqual(loadSettings({}, {}, broken), []);
  const throwing = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  assert.doesNotThrow(() => loadSettings({}, {}, throwing));
  assert.equal(saveSettings({}, throwing), false);
  assert.deepEqual(loadSettings({}, {}, null), []);
});

test('qualityURL keeps other parameters', () => {
  const u = new URL(qualityURL('https://x.test/index.html?scenario=hover&quality=high', 'low'));
  assert.equal(u.searchParams.get('quality'), 'low');
  assert.equal(u.searchParams.get('scenario'), 'hover');
});
