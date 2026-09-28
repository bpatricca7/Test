// Billing tests (docs/ACCOUNTS.md §12.6, owner B): `npm run test:billing` (node:test, no network).
// This first part is the entitlementOf() table of §6.5: every Stripe status × where "now" is
// × a free pass × the consent tiers. B adds checkout, sync, Portal, Start now, the webhooks
// over fixtures and the Stripe fake, reconcile and the shape contract below it.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { entitlementOf, countingSub, consentOf, toMs } from '../server/entitlement.mjs';

const HOUR = 3600e3;
const DAY = 24 * HOUR;
const T = Date.UTC(2026, 9, 1, 12, 0, 0); // "now" in most rows
const cfg = { graceDays: 7, mpConsent: 'verified' };
const fam = (extra = {}) => ({ id: 'f', consent_at: new Date(T - 30 * DAY), verified_at: null, comp_until: null, lapsed_at: null, ...extra });
const sub = (status, extra = {}) => ({
  id: 'sub_' + status,
  status,
  trial_end: null,
  current_period_end: null,
  cancel_at_period_end: false,
  first_failed_at: null,
  synced_at: new Date(T - HOUR),
  ...extra,
});
const at = (subs, now = T, family = fam(), c = cfg) => entitlementOf({ family, subs, now, cfg: c });

describe('entitlementOf: status × time (§6.5)', () => {
  const rows = [
    // [name, subs, now, state, entitled, until]
    ['no plan at all', [], T, 'none', false, null],
    ['trialing, 3 days left', [sub('trialing', { trial_end: T + 3 * DAY, current_period_end: T + 3 * DAY })], T, 'trialing', true, T + 4 * DAY],
    ['trialing, trial ended 23 h ago (1 day of slack)', [sub('trialing', { trial_end: T - 23 * HOUR })], T, 'trialing', true, T + HOUR],
    ['trialing, trial ended a day ago', [sub('trialing', { trial_end: T - DAY })], T, 'lapsed', false, null],
    ['active, renews in 10 days', [sub('active', { current_period_end: T + 10 * DAY })], T, 'active', true, T + 13 * DAY],
    ['active, period ended 2 days ago (renewal webhook late)', [sub('active', { current_period_end: T - 2 * DAY })], T, 'active', true, T + DAY],
    ['active, period ended 3 days ago', [sub('active', { current_period_end: T - 3 * DAY })], T, 'lapsed', false, null],
    ['canceling, ends in 5 days', [sub('active', { current_period_end: T + 5 * DAY, cancel_at_period_end: true })], T, 'canceling', true, T + 5 * DAY],
    ['canceling, ended 59 minutes ago', [sub('active', { current_period_end: T - 59 * 60e3, cancel_at_period_end: true })], T, 'canceling', true, T - 59 * 60e3],
    ['canceling, ended an hour ago', [sub('active', { current_period_end: T - HOUR, cancel_at_period_end: true })], T, 'lapsed', false, null],
    ['past_due, failed 2 days ago (grace 7)', [sub('past_due', { current_period_end: T - 2 * DAY, first_failed_at: T - 2 * DAY })], T, 'past_due', true, T + 5 * DAY],
    ['past_due, failed 7 days ago', [sub('past_due', { current_period_end: T - 7 * DAY, first_failed_at: T - 7 * DAY })], T, 'lapsed', false, null],
    ['incomplete (3-D Secure pending), never had a plan', [sub('incomplete')], T, 'none', false, null],
    ['incomplete_expired, never had a plan', [sub('incomplete_expired')], T, 'none', false, null],
    ['unpaid', [sub('unpaid', { current_period_end: T + 5 * DAY })], T, 'lapsed', false, null],
    ['canceled', [sub('canceled', { current_period_end: T - 5 * DAY })], T, 'lapsed', false, null],
    ['paused', [sub('paused')], T, 'lapsed', false, null],
    ['an unknown status', [sub('something_new')], T, 'lapsed', false, null],
  ];
  for (const [name, subs, now, state, entitled, until] of rows) {
    test(name, () => {
      const e = at(subs, now);
      assert.equal(e.state, state);
      assert.equal(e.entitled, entitled);
      assert.equal(e.until, until);
    });
  }

  test('grace follows SW_GRACE_DAYS', () => {
    const s = [sub('past_due', { first_failed_at: T - 2 * DAY })];
    assert.equal(at(s, T, fam(), { ...cfg, graceDays: 3 }).until, T + DAY);
    assert.equal(at(s, T, fam(), { ...cfg, graceDays: 2 }).state, 'lapsed');
    const e = at(s);
    assert.equal(e.graceUntil, T + 5 * DAY);
  });

  test('a missing date falls back to the other date, then to a day after the last sync', () => {
    assert.equal(at([sub('active', { trial_end: T - 2 * DAY })]).until, T + DAY);
    assert.equal(at([sub('trialing', { current_period_end: T + DAY })]).until, T + 2 * DAY);
    assert.equal(at([sub('active', { synced_at: T - HOUR })]).state, 'active');
    assert.equal(at([sub('active', { synced_at: T - 5 * DAY })]).state, 'lapsed');
    assert.equal(at([sub('past_due', { current_period_end: T - DAY })]).until, T + 6 * DAY);
  });

  test('the boundaries are exact (now < until)', () => {
    const end = T + 10 * DAY;
    const s = [sub('active', { current_period_end: end })];
    assert.equal(at(s, end + 3 * DAY - 1).entitled, true);
    assert.equal(at(s, end + 3 * DAY).entitled, false);
    const tr = [sub('trialing', { trial_end: end })];
    assert.equal(at(tr, end + DAY - 1).entitled, true);
    assert.equal(at(tr, end + DAY).entitled, false);
  });
});

describe('entitlementOf: the subscription that counts', () => {
  test('a live one beats a newer-synced ended one', () => {
    const subs = [sub('canceled', { id: 'a', synced_at: T }), sub('active', { id: 'b', current_period_end: T + 5 * DAY, synced_at: T - DAY })];
    assert.equal(countingSub(subs).id, 'b');
    assert.equal(at(subs).state, 'active');
  });
  test('of two live ones, the latest period end counts', () => {
    const subs = [sub('past_due', { id: 'a', current_period_end: T - DAY, first_failed_at: T - DAY }), sub('trialing', { id: 'b', trial_end: T + 6 * DAY, current_period_end: T + 6 * DAY })];
    assert.equal(countingSub(subs).id, 'b');
    assert.equal(at(subs).state, 'trialing');
  });
  test('with none live, the most recently synced counts', () => {
    const subs = [sub('canceled', { id: 'a', synced_at: T - DAY }), sub('incomplete', { id: 'b', synced_at: T })];
    assert.equal(countingSub(subs).id, 'b');
    assert.equal(at(subs).state, 'lapsed', 'a new attempt after an ended plan still reads as lapsed');
  });
  test('no subscriptions', () => {
    assert.equal(countingSub([]), null);
    assert.equal(countingSub(undefined), null);
  });
  test('details come from the counting subscription', () => {
    const e = at([sub('active', { current_period_end: T + 5 * DAY, trial_end: T - 2 * DAY, cancel_at_period_end: true })]);
    assert.deepEqual([e.periodEnd, e.trialEnd, e.cancelAtPeriodEnd, e.graceUntil], [T + 5 * DAY, T - 2 * DAY, true, null]);
    const none = at([]);
    assert.deepEqual([none.periodEnd, none.trialEnd, none.cancelAtPeriodEnd, none.graceUntil], [null, null, false, null]);
  });
});

describe('entitlementOf: free passes (comp_until)', () => {
  test('a pass that has not run out: comp, whatever the status', () => {
    for (const subs of [[], [sub('canceled')], [sub('past_due', { first_failed_at: T - 30 * DAY })], [sub('incomplete')]]) {
      const e = at(subs, T, fam({ comp_until: T + 20 * DAY }));
      assert.deepEqual([e.state, e.entitled, e.until], ['comp', true, T + 20 * DAY]);
    }
  });
  test('a pass and a paid plan: comp, until the later of the two', () => {
    const e = at([sub('active', { current_period_end: T + 30 * DAY })], T, fam({ comp_until: T + 5 * DAY }));
    assert.deepEqual([e.state, e.until], ['comp', T + 33 * DAY]);
  });
  test('a pass that ran out: lapsed (or the plan, if there is one)', () => {
    assert.equal(at([], T, fam({ comp_until: T - 1 })).state, 'lapsed');
    assert.equal(at([], T, fam({ comp_until: T })).state, 'lapsed');
    assert.equal(at([sub('active', { current_period_end: T + 5 * DAY })], T, fam({ comp_until: T - DAY })).state, 'active');
  });
  test('lapsed_at alone means the family had a plan', () => {
    assert.equal(at([], T, fam({ lapsed_at: T - DAY })).state, 'lapsed');
  });
});

describe('entitlementOf: consent tiers (§6.7, §11.4)', () => {
  const cases = [
    // [consent_at, verified_at, mpConsent, consent, friendsOk, walkieOk]
    [null, null, 'verified', 'none', false, false],
    [T - DAY, null, 'verified', 'email_plus', false, false],
    [T - DAY, T - HOUR, 'verified', 'verified', true, true],
    [null, null, 'email_plus', 'none', false, false],
    [T - DAY, null, 'email_plus', 'email_plus', true, false],
    [T - DAY, T - HOUR, 'email_plus', 'verified', true, true],
    [null, T - HOUR, 'verified', 'verified', true, true],
  ];
  for (const [consentAt, verifiedAt, mp, consent, friends, walkie] of cases) {
    test(`consent_at ${consentAt ? 'set' : 'null'}, verified_at ${verifiedAt ? 'set' : 'null'}, SW_MP_CONSENT=${mp}`, () => {
      const e = at([sub('active', { current_period_end: T + DAY })], T, fam({ consent_at: consentAt, verified_at: verifiedAt }), { ...cfg, mpConsent: mp });
      assert.deepEqual([e.consent, e.friendsConsentOk, e.walkieConsentOk], [consent, friends, walkie]);
      assert.equal(consentOf(fam({ consent_at: consentAt, verified_at: verifiedAt })), consent);
    });
  }
  test('consent does not depend on the plan (callers combine it with entitled)', () => {
    const e = at([], T, fam({ verified_at: T - DAY }));
    assert.deepEqual([e.entitled, e.consent, e.walkieConsentOk], [false, 'verified', true]);
  });
  test('unknown mpConsent reads as the strict default', () => {
    const e = at([], T, fam(), { graceDays: 7, mpConsent: 'nonsense' });
    assert.equal(e.friendsConsentOk, false);
  });
});

describe('entitlementOf: inputs', () => {
  test('times as Date, ms and ISO strings; camelCase rows; Date now', () => {
    const end = T + 10 * DAY;
    for (const v of [new Date(end), end, new Date(end).toISOString()]) {
      assert.equal(at([sub('active', { current_period_end: v })]).until, end + 3 * DAY);
    }
    const camel = { status: 'trialing', trialEnd: new Date(T + DAY), currentPeriodEnd: new Date(T + DAY), cancelAtPeriodEnd: false, syncedAt: new Date(T) };
    assert.equal(entitlementOf({ family: { consentAt: new Date(T), compUntil: null }, subs: [camel], now: new Date(T), cfg }).until, T + 2 * DAY);
    assert.equal(toMs(null), null);
    assert.equal(toMs('not a date'), null);
  });
  test('now is required; defaults for cfg', () => {
    assert.throws(() => entitlementOf({ family: fam(), subs: [] }));
    const e = entitlementOf({ family: fam(), subs: [sub('past_due', { first_failed_at: T - 6 * DAY })], now: T });
    assert.equal(e.until, T + DAY, 'grace defaults to 7 days');
  });
  test('the answer has exactly the fields of §6.5', () => {
    assert.deepEqual(Object.keys(at([])).sort(), ['cancelAtPeriodEnd', 'consent', 'entitled', 'friendsConsentOk', 'graceUntil', 'periodEnd', 'state', 'trialEnd', 'until', 'walkieConsentOk']);
  });
});
