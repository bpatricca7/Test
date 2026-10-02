// Write tools/fixtures/stripe/*.json (docs/ACCOUNTS.md §12.4): one webhook event per handled type
// and status path, in the pinned API version's shapes, made by running the fake's own flows and
// then giving every id and time a fixed value (so the files don't change from run to run).
//
//   node tools/stripe-fake/make-fixtures.mjs          (rewrites the files; review the diff)
//
// Next to the events, subscriptions.json holds, per fixture, the subscription as Stripe has it at
// that moment (latest_invoice expanded): what the webhook's re-fetch returns in the fixture tests.
// The families the fixtures belong to have fixed ids (FIXTURE_FAMILIES).

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { StripeEngine } from './engine.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const FIXTURE_DIR = path.join(ROOT, 'tools', 'fixtures', 'stripe');
export const FIXTURE_FAMILIES = Object.freeze({
  paid: '5a1e0000-0000-4000-8000-000000000001',
  trial: '5a1e0000-0000-4000-8000-000000000002',
  abroad: '5a1e0000-0000-4000-8000-000000000003',
});
const T0 = 1790856000; // 2026-10-01T12:00:00Z: every fixture time is moved to start here
const DAY = 86400e3;

function checkoutParams(customer, family, trialDays) {
  return {
    mode: 'subscription', customer, client_reference_id: family,
    line_items: [{ price: null, quantity: '1' }],
    subscription_data: { metadata: { family_id: family }, ...(trialDays ? { trial_period_days: String(trialDays) } : {}) },
    payment_method_collection: 'always', payment_method_types: ['card'], automatic_tax: { enabled: 'true' },
    customer_update: { address: 'auto', name: 'auto' }, billing_address_collection: 'required',
    consent_collection: { terms_of_service: 'required' },
    custom_text: { terms_of_service_acceptance: { message: 'I agree to the Terms. My Family Plan renews every month at $5.99 plus tax until I cancel; I can cancel any time on the Family page.' } },
    allow_promotion_codes: 'false', locale: 'en',
    success_url: 'https://glimmerworld.example/account?checkout={CHECKOUT_SESSION_ID}', cancel_url: 'https://glimmerworld.example/account?checkout=cancel',
  };
}

/** Run the flows; → { fixtures: { name: event }, subscriptions: { name: sub }, runT0 } */
export function makeFixtures() {
  const e = new StripeEngine({ publicUrl: 'https://stripe-fake.example', fixedClock: T0 * 1000 });
  const runT0 = e.nowSec();
  const tick = () => e.setNow(e.now() + 60e3); // a minute between the parent's steps
  const fixtures = {};
  const subs = {};
  const take = (name, type, pick = (evs) => evs[evs.length - 1]) => {
    const evs = e.pending.filter((x) => x.type === type);
    if (!evs.length) throw new Error(`no ${type} for ${name}`);
    const ev = pick(evs);
    fixtures[name] = ev;
    const subId = ev.data.object.object === 'subscription' ? ev.data.object.id : ev.data.object.subscription || ev.data.object.parent?.subscription_details?.subscription || null;
    if (subId) subs[name] = e.expand(e.subscriptions.get(subId), ['latest_invoice']);
  };
  const session = (customer, family, trialDays) => {
    const p = checkoutParams(customer, family, trialDays);
    p.line_items[0].price = e.seeded.priceId;
    return e.createCheckoutSession(p);
  };

  // 1. no trial, US: paid at Checkout; later the card fails at renewal; later a chargeback
  const c1 = e.createCustomer({ email: 'parent1@example.com', metadata: { family_id: FIXTURE_FAMILIES.paid } });
  const s1 = session(c1.id, FIXTURE_FAMILIES.paid, 0);
  e.takeEvents();
  tick();
  e.completeCheckout(s1.id, { outcome: 'ok', country: 'US' });
  take('checkout.session.completed', 'checkout.session.completed');
  take('customer.subscription.created', 'customer.subscription.created');
  take('invoice.paid', 'invoice.paid');
  e.takeEvents();
  tick();
  e.dispute({ customer: c1.id });
  take('charge.dispute.created', 'charge.dispute.created');
  e.takeEvents();
  e.card(c1.id, 'fail');
  e.advanceMs(32 * DAY);
  take('invoice.payment_failed', 'invoice.payment_failed');
  take('customer.subscription.updated.past_due', 'customer.subscription.updated');
  e.takeEvents();

  // 2. a free week (SW_TRIAL_DAYS=7): the $0 invoice, cancel at period end, then cancel now
  const c2 = e.createCustomer({ email: 'parent2@example.com', metadata: { family_id: FIXTURE_FAMILIES.trial } });
  const s2 = session(c2.id, FIXTURE_FAMILIES.trial, 7);
  e.takeEvents();
  tick();
  e.completeCheckout(s2.id, { outcome: 'ok', country: 'US' });
  take('checkout.session.completed.trial', 'checkout.session.completed');
  take('customer.subscription.created.trialing', 'customer.subscription.created');
  take('invoice.paid.trial', 'invoice.paid');
  e.takeEvents();
  const sub2 = e.checkoutSessions.get(s2.id).subscription;
  tick();
  e.updateSubscription(sub2, { cancel_at_period_end: 'true' });
  take('customer.subscription.updated.canceling', 'customer.subscription.updated');
  e.takeEvents();
  tick();
  e.cancelSubscription(sub2, {});
  take('customer.subscription.deleted', 'customer.subscription.deleted');
  e.takeEvents();

  // 3. a billing address outside the US (turned away), then the customer deleted in the Dashboard
  const c3 = e.createCustomer({ email: 'parent3@example.com', metadata: { family_id: FIXTURE_FAMILIES.abroad } });
  const s3 = session(c3.id, FIXTURE_FAMILIES.abroad, 0);
  e.takeEvents();
  tick();
  e.completeCheckout(s3.id, { outcome: 'ok', country: 'CA' });
  take('checkout.session.completed.non-us', 'checkout.session.completed');
  e.takeEvents();
  tick();
  e.deleteCustomer(c3.id);
  take('customer.deleted', 'customer.deleted');
  e.takeEvents();

  return { fixtures, subscriptions: subs, runT0 };
}

/** Fixed ids (prefix + a counter, in first-seen order) and times (moved to start at T0). */
export function normalize(value, runT0) {
  const ids = new Map();
  const counters = {};
  const idRe = /\b(cus|sub|si|in|il|ch|pi|pm|du|evt|req|price|prod|bpc|bps|txr)_[A-Za-z0-9]{6,}\b|\bcs_test_[A-Za-z0-9]{20,}\b/g;
  const mapId = (id) => {
    if (id === 'txr_fake_us') return id;
    if (!ids.has(id)) {
      const prefix = id.startsWith('cs_test_') ? 'cs_test_' : id.slice(0, id.indexOf('_') + 1);
      counters[prefix] = (counters[prefix] || 0) + 1;
      ids.set(id, `${prefix}Fixture${String(counters[prefix]).padStart(4, '0')}`);
    }
    return ids.get(id);
  };
  const delta = T0 - runT0;
  const walk = (v, key) => {
    if (Array.isArray(v)) return v.map((x) => walk(x, key));
    if (v && typeof v === 'object') {
      const out = {};
      for (const k of Object.keys(v)) out[k] = walk(v[k], k);
      return out;
    }
    if (typeof v === 'string' && key === 'invoice_prefix') return 'FIXTURE0';
    if (typeof v === 'string' && key === 'number') return v.replace(/^[A-Z0-9]{8}-(\d{4})$/, 'FIXTURE0-$1');
    if (typeof v === 'string') return v.replace(idRe, (m) => mapId(m));
    if (typeof v === 'number' && Number.isInteger(v) && v > 1.6e9 && v < 2.6e9 && key !== 'amount') return v + delta;
    return v;
  };
  return walk(value);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const { fixtures, subscriptions, runT0 } = makeFixtures();
  const all = normalize({ fixtures, subscriptions }, runT0);
  mkdirSync(FIXTURE_DIR, { recursive: true });
  for (const [name, ev] of Object.entries(all.fixtures)) writeFileSync(path.join(FIXTURE_DIR, `${name}.json`), JSON.stringify(ev, null, 2) + '\n');
  writeFileSync(path.join(FIXTURE_DIR, 'subscriptions.json'), JSON.stringify(all.subscriptions, null, 2) + '\n');
  console.log(`wrote ${Object.keys(all.fixtures).length} fixtures and subscriptions.json to ${path.relative(ROOT, FIXTURE_DIR)}`);
}
