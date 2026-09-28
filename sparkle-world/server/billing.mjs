// Billing (docs/ACCOUNTS.md §6, owner B): Stripe Checkout, the return sync, the Customer Portal,
// Start now, the webhook, entitlement with its 60 s cache, reconcile, lapse, and the Stripe side
// of deleting a family. One plan ($5.99/month), US only, card up front, no promotion codes, and
// nothing for sale inside the game.
//
//   const billing = createBilling(ctx)     // ctx.billing (accounts.mjs)
//   billing.entitlementFor(familyId) → §6.5 object (entitlement.mjs), cached 60 s
//   billing.invalidate(familyId?)       // after anything that changes a family's plan (no id: all)
//   billing.reconcile()                 // the reconcile job (§6.6): re-reads subscriptions whose trial
//                                       // or period ends within the hour, open Checkouts whose
//                                       // webhooks never came, and retries Stripe customer deletions
//   billing.cancelAndDelete(customerId | familyRow) → { ok, error? }   // §3.4 step 1; never throws
//   billing.lapse()                     // lapsed_at / purge_after on and off (§6.6); the retention job calls it
//   billing.checkPrice()                // SW_PRICE_TEXT against the Stripe price (a warning, never fatal)
//   billing.stats()                     // counters for the daily summary line (§13.5)
//   routes(ctx)                         // POST /api/billing/checkout|sync|portal|start-now, /api/stripe/webhook
//
// Rules that keep it safe (§6.4): the webhook verifies the signature over the raw body first; an
// event id is handled once (stripe_events, inside the same transaction as its effect, so emails go
// exactly once); what an event needs is re-fetched from Stripe outside the transaction (the order
// of deliveries is not trusted); a subscription row is only replaced by a newer read (synced_at).
// Every effect is also idempotent on its own (verified consent, the welcome, us_only and
// friends_ready emails are guarded by the row they change), so the return sync, the webhook and
// the reconcile job can all apply the same thing in any order.
//
// Consent (§6.7, §11.4): the first paid invoice with amount_paid > 0 records verified consent
// (method 'card'): with no trial (the default) that is the Checkout payment itself. A $0 trial
// invoice never counts. A billing address outside SW_SELL_COUNTRIES never counts either: that
// subscription is cancelled at once, the us_only email goes out, and a paid invoice is flagged
// `refund_due` for the dad (refunds are by hand, §16).
//
// Logs: counts and error names only; never an email, a customer's address or a Stripe message.

import { randomBytes } from 'node:crypto';
import { HttpError, isUuid } from './http.mjs';
import { entitlementOf, toMs } from './entitlement.mjs';
import { renewalSentence } from './notice.mjs';
import { STRIPE_API_VERSION, stripeErrorName, isMissing } from './stripe.mjs';

const MIN = 60e3;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const CACHE_MS = 60e3;
const CHECKOUT_REUSE_MS = 30 * MIN;
const CHECKOUT_TRACK_MS = 25 * HOUR; // an open Checkout is looked at by reconcile this long
const NON_TERMINAL = ['trialing', 'active', 'past_due'];
const SESSION_ID_RE = /^cs_(test|live)_[A-Za-z0-9]{1,250}$/;
const WEBHOOK_MAX = 1024 * 1024;

/** The event types the webhook acts on (§6.4); the Dashboard endpoint subscribes to exactly these. */
export const HANDLED_EVENTS = Object.freeze([
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.paid',
  'invoice.payment_failed',
  'charge.dispute.created',
  'customer.deleted',
]);

// ---------------------------------------------------------------------------------------------
// the shape contract (§12.4): the key paths this file reads from each event. tools/test-billing.mjs
// checks them against the fixtures and, once the dad has made his test purchase with
// SW_STRIPE_SHAPES=1, against tools/fixtures/stripe/real-shapes.txt.

const EVENT_PATHS = ['id', 'type', 'created', 'api_version'];
const SUBSCRIPTION_PATHS = [
  'data.object.id', 'data.object.customer', 'data.object.status', 'data.object.metadata', 'data.object.created', 'data.object.start_date',
  'data.object.trial_end', 'data.object.cancel_at_period_end', 'data.object.cancel_at', 'data.object.canceled_at', 'data.object.ended_at',
  'data.object.latest_invoice', 'data.object.items.data[].current_period_end', 'data.object.items.data[].price.id',
];
export const READ_PATHS = Object.freeze({
  'checkout.session.completed': [...EVENT_PATHS, 'data.object.id', 'data.object.mode', 'data.object.status', 'data.object.client_reference_id', 'data.object.customer', 'data.object.subscription', 'data.object.payment_status', 'data.object.amount_total', 'data.object.metadata', 'data.object.customer_details.address.country'],
  'customer.subscription.created': [...EVENT_PATHS, ...SUBSCRIPTION_PATHS],
  'customer.subscription.updated': [...EVENT_PATHS, ...SUBSCRIPTION_PATHS],
  'customer.subscription.deleted': [...EVENT_PATHS, ...SUBSCRIPTION_PATHS],
  'invoice.paid': [...EVENT_PATHS, 'data.object.id', 'data.object.status', 'data.object.amount_paid', 'data.object.customer', 'data.object.parent.subscription_details.subscription', 'data.object.status_transitions.paid_at', 'data.object.customer_address'],
  'invoice.payment_failed': [...EVENT_PATHS, 'data.object.id', 'data.object.customer', 'data.object.parent.subscription_details.subscription'],
  'charge.dispute.created': [...EVENT_PATHS, 'data.object.id', 'data.object.charge'],
  'customer.deleted': [...EVENT_PATHS, 'data.object.id'],
});
/** Read when present (may be null or missing in a real event). */
export const OPTIONAL_PATHS = Object.freeze([
  'data.object.metadata.family_id', 'data.object.customer_address.country', 'data.object.subscription', 'data.object.parent.subscription_details.metadata.family_id',
  'data.object.current_period_end', // before the dahlia-era move to the item; read only defensively
]);

/** Sorted key paths of a JSON value (arrays as `[]`), without any value: the `stripe-shape` log. */
export function shapePaths(value) {
  const out = new Set();
  const walk = (v, p) => {
    if (Array.isArray(v)) {
      if (!v.length) out.add(p + '[]');
      for (const x of v) walk(x, p + '[]');
      return;
    }
    if (v && typeof v === 'object') {
      const keys = Object.keys(v);
      if (!keys.length && p) out.add(p);
      for (const k of keys) walk(v[k], p ? `${p}.${k}` : k);
      return;
    }
    out.add(p);
  };
  walk(value, '');
  return [...out].sort();
}

/** Does `paths` (from shapePaths) contain `want`, as a leaf or as an object/array above leaves? */
export function hasPath(paths, want) {
  const set = paths instanceof Set ? paths : new Set(paths);
  if (set.has(want)) return true;
  for (const p of set) if (p.startsWith(want + '.') || p.startsWith(want + '[]')) return true;
  return false;
}

// ---------------------------------------------------------------------------------------------

const idOf = (v) => (typeof v === 'string' ? v : v && typeof v === 'object' && typeof v.id === 'string' ? v.id : null);
const tsDate = (s) => (Number.isFinite(s) && s > 0 ? new Date(s * 1000) : null);
const normCountry = (c) => (typeof c === 'string' && /^[A-Za-z]{2}$/.test(c.trim()) ? c.trim().toUpperCase() : null);
const errName = (err) => (err && err.code ? String(err.code) : err && err.name ? err.name : 'Error');

/** The subscription id an invoice belongs to (dahlia: parent.subscription_details; older: subscription). */
export function invoiceSubscriptionId(inv) {
  return idOf(inv?.parent?.subscription_details?.subscription) ?? idOf(inv?.subscription) ?? null;
}

/** The columns of the subscriptions mirror (§3.3) from a Stripe subscription object. */
export function subscriptionRow(sub) {
  const item = sub?.items?.data?.[0] || null;
  const periodEnd = item?.current_period_end ?? sub?.current_period_end ?? null; // dahlia keeps it on the item
  const cancelAt = Number.isFinite(sub?.cancel_at) ? sub.cancel_at : null;
  return {
    id: sub.id,
    customer: idOf(sub.customer),
    status: String(sub.status || ''),
    priceId: idOf(item?.price),
    startedAt: tsDate(sub.start_date ?? sub.created),
    trialEnd: tsDate(sub.trial_end),
    periodEnd: tsDate(periodEnd),
    // the Portal's "cancel at period end" (also when a newer API marks it with cancel_at alone)
    cancelAtPeriodEnd: sub.cancel_at_period_end === true || (cancelAt !== null && periodEnd !== null && cancelAt <= periodEnd),
    canceledAt: tsDate(sub.canceled_at),
    endedAt: tsDate(sub.ended_at),
  };
}

export function createBilling(ctx) {
  const { cfg, db } = ctx;
  const clock = ctx.clock || { now: () => Date.now() };
  const log = ctx.log || (() => {});
  const stripe = () => {
    if (!ctx.stripe) throw Object.assign(new Error('no Stripe client'), { name: 'StripeMissing' });
    return ctx.stripe;
  };
  const sell = new Set(cfg.sellCountries || ['US']);
  const cache = new Map(); // familyId -> { at (real ms), offset, value }
  const locks = new Map(); // familyId -> promise chain (one checkout at a time per family)
  const counters = {
    webhooksOk: 0, webhooksFailed: 0, webhooksDuplicate: 0, badSignature: 0, ignored: 0, stripeErrors: 0,
    verified: 0, usOnly: 0, disputes: 0, duplicatesCanceled: 0, customersDeleted: 0, reconciled: 0,
  };
  let warnedVersion = false;

  const offsetOf = () => (typeof clock.offsetMs === 'number' ? clock.offsetMs : 0);
  const emit = (familyId) => {
    try {
      ctx.events?.emit?.('family', { familyId });
    } catch {}
  };
  const changed = (ids) => {
    for (const id of new Set((ids || []).filter(Boolean))) {
      invalidate(id);
      emit(id);
    }
  };

  // ---- entitlement (§6.5) ----

  async function entitlementFor(familyId) {
    const now = clock.now();
    if (!isUuid(familyId)) return entitlementOf({ family: {}, subs: [], now, cfg });
    const hit = cache.get(familyId);
    if (hit && Date.now() - hit.at < CACHE_MS && hit.offset === offsetOf() && (hit.value.until === null || now < hit.value.until)) return { ...hit.value };
    const family = await db.one('select * from families where id = $1', [familyId]);
    const subs = family ? (await db.query('select * from subscriptions where family_id = $1', [familyId])).rows : [];
    const value = entitlementOf({ family: family || {}, subs, now, cfg });
    cache.set(familyId, { at: Date.now(), offset: offsetOf(), value });
    if (cache.size > 10000) cache.delete(cache.keys().next().value);
    return { ...value };
  }

  function invalidate(familyId) {
    if (familyId) cache.delete(familyId);
    else cache.clear();
  }

  // ---- Stripe calls ----

  async function sc(fn, { missing = null } = {}) {
    try {
      return await fn(stripe());
    } catch (err) {
      if (missing && isMissing(err)) throw new HttpError(missing[0], missing[1]);
      counters.stripeErrors++;
      log(`billing: stripe ${stripeErrorName(err)}`);
      throw new HttpError(502, 'stripe_unavailable');
    }
  }

  /** The subscription as Stripe has it now (latest_invoice expanded), or `fallback` when it is gone. */
  async function fetchSubscription(id, fallback = null) {
    try {
      return await stripe().subscriptions.retrieve(id, { expand: ['latest_invoice'] });
    } catch (err) {
      if (isMissing(err)) return fallback;
      throw err;
    }
  }

  // ---- the database side ----

  /** The family a Stripe object belongs to: metadata.family_id, client_reference_id, else the customer. */
  async function familyFor(q, { metadata = null, clientRef = null, customer = null } = {}) {
    for (const id of [metadata, clientRef]) {
      if (isUuid(id)) {
        const f = await q.one('select id from families where id = $1', [id]);
        if (f) return { id: f.id, byCustomer: false };
      }
    }
    if (customer) {
      const f = await q.one('select id from families where stripe_customer_id = $1', [customer]);
      if (f) return { id: f.id, byCustomer: true };
    }
    return null;
  }

  /**
   * Lock the family's row for the rest of the transaction. Every billing transaction takes it
   * first (before any subscriptions row), so webhooks Stripe delivers at the same moment, the
   * return sync and reconcile queue up behind each other instead of deadlocking. → false if gone.
   */
  async function lockFamily(q, familyId) {
    return !!(await q.one('select id from families where id = $1 for update', [familyId]));
  }

  async function linkCustomer(q, familyId, customer) {
    if (!customer) return;
    await q.query(
      'update families set stripe_customer_id = $2 where id = $1 and stripe_customer_id is null and not exists (select 1 from families o where o.stripe_customer_id = $2)',
      [familyId, customer],
    );
  }

  /** Set flags[key] = value unless it already is; true for the one caller that changed it. */
  async function flagOnce(q, familyId, key, value) {
    const r = await q.one(
      'update families set flags = flags || jsonb_build_object($2::text, $3::text) where id = $1 and (flags ->> $2) is distinct from $3 returning email',
      [familyId, key, String(value)],
    );
    return r;
  }

  async function setFlags(q, familyId, obj) {
    await q.query('update families set flags = flags || $2::jsonb where id = $1', [familyId, JSON.stringify(obj)]);
  }

  /** Write a Stripe read into the mirror (only over an older read). Returns the row, or null. */
  async function upsertSubscription(q, familyId, sub, syncedAt) {
    const r = subscriptionRow(sub);
    const now = new Date(clock.now());
    return q.one(
      `insert into subscriptions as s (id, family_id, customer_id, status, price_id, started_at, trial_end, current_period_end,
         cancel_at_period_end, canceled_at, ended_at, first_failed_at, synced_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, case when $4 = 'past_due' then $12::timestamptz else null end, $13, now())
       on conflict (id) do update set
         family_id = excluded.family_id, customer_id = excluded.customer_id, status = excluded.status, price_id = excluded.price_id,
         started_at = excluded.started_at, trial_end = excluded.trial_end, current_period_end = excluded.current_period_end,
         cancel_at_period_end = excluded.cancel_at_period_end, canceled_at = excluded.canceled_at, ended_at = excluded.ended_at,
         first_failed_at = case when excluded.status = 'past_due' then coalesce(s.first_failed_at, excluded.first_failed_at)
                                when excluded.status in ('active', 'trialing') then null
                                else s.first_failed_at end,
         synced_at = excluded.synced_at, updated_at = now()
       where excluded.synced_at >= s.synced_at
       returning *`,
      [r.id, familyId, r.customer || '', r.status, r.priceId, r.startedAt, r.trialEnd, r.periodEnd, r.cancelAtPeriodEnd, r.canceledAt, r.endedAt, now, new Date(syncedAt)],
    );
  }

  /** A paid invoice: latest_paid_at, and the first real payment is verified consent (§11.4). */
  async function recordPaid(q, familyId, invoice, subId) {
    const paidAt = tsDate(invoice.status_transitions?.paid_at) || new Date(clock.now());
    if (subId) await q.query('update subscriptions set latest_paid_at = greatest(latest_paid_at, $2) where id = $1', [subId, paidAt]);
    if (!(invoice.amount_paid > 0)) return false; // the trial's $0 invoice is not a monetary transaction
    const fam = await q.one('select country, verified_at from families where id = $1', [familyId]);
    if (!fam || fam.verified_at) return false;
    const country = normCountry(invoice.customer_address?.country) || fam.country;
    if (country && !sell.has(country)) return false; // turned away (§6.8): never counts
    const won = await q.one("update families set verified_at = $2, verified_method = 'card' where id = $1 and verified_at is null returning email", [familyId, new Date(clock.now())]);
    if (!won) return false;
    await ctx.audit(q, familyId, 'consent.verified', { method: 'card', invoice: String(invoice.id || '') }, { actor: 'stripe' });
    await ctx.mail.enqueue(q, 'friends_ready', won.email, {}, { familyId });
    counters.verified++;
    return true;
  }

  /**
   * Apply one fresh subscription read: the mirror row, trial_used, and a paid invoice
   * (`paidInvoice`, or the expanded latest_invoice). → the family id, or null (not ours / gone).
   */
  async function applySubscription(q, sub, { familyId = null, syncedAt, paidInvoice = null } = {}) {
    if (!sub || !sub.id) return null;
    const customer = idOf(sub.customer);
    let fid = familyId;
    if (!fid) {
      const f = await familyFor(q, { metadata: sub.metadata?.family_id, customer });
      if (!f) return null;
      fid = f.id;
    }
    if (!(await lockFamily(q, fid))) return null;
    await linkCustomer(q, fid, customer);
    await upsertSubscription(q, fid, sub, syncedAt);
    if (sub.trial_end || sub.status === 'trialing') await q.query('update families set trial_used = true where id = $1 and not trial_used', [fid]);
    const latest = sub.latest_invoice && typeof sub.latest_invoice === 'object' ? sub.latest_invoice : null;
    for (const inv of [paidInvoice, latest]) {
      if (inv && inv.status === 'paid' && invoiceSubscriptionId(inv) === sub.id) await recordPaid(q, fid, inv, sub.id);
    }
    return fid;
  }

  const otherLivePlan = (q, familyId, subId) =>
    q.one(`select id from subscriptions where family_id = $1 and id <> $2 and status in ('trialing', 'active', 'past_due') limit 1`, [familyId, subId]);

  const countryAllowed = (session) => {
    const c = normCountry(session?.customer_details?.address?.country);
    return !c || sell.has(c);
  };

  /** Before a completed Checkout is applied: a billing address we don't sell to is cancelled first (§6.8). */
  async function checkoutSubscription(session, expanded = null) {
    const subId = idOf(session.subscription);
    if (!subId) return null;
    if (!countryAllowed(session)) {
      try {
        await stripe().subscriptions.cancel(subId, { invoice_now: false, prorate: false });
      } catch (err) {
        if (!isMissing(err) && err?.type !== 'StripeInvalidRequestError') throw err; // already cancelled is fine
      }
      return fetchSubscription(subId, expanded);
    }
    if (expanded && expanded.latest_invoice !== undefined && typeof expanded === 'object') return expanded;
    return fetchSubscription(subId, expanded);
  }

  /** A completed Checkout (the webhook and the return sync share it). → the family id or null. */
  async function applyCheckout(q, session, sub, syncedAt) {
    const customer = idOf(session.customer);
    const f = await familyFor(q, { clientRef: session.client_reference_id, metadata: session.metadata?.family_id ?? sub?.metadata?.family_id, customer });
    if (!f || !(await lockFamily(q, f.id))) return null;
    const fid = f.id;
    await linkCustomer(q, fid, customer);
    const country = normCountry(session.customer_details?.address?.country);
    if (country) await q.query('update families set country = $2 where id = $1', [fid, country]);
    if (sub) await applySubscription(q, sub, { familyId: fid, syncedAt });
    const key = idOf(session.subscription) || session.id;
    if (country && !sell.has(country)) {
      const paid = session.payment_status === 'paid' && Number(session.amount_total) > 0;
      const won = await flagOnce(q, fid, 'us_only', key);
      if (won) {
        if (paid) await setFlags(q, fid, { refund_due: true });
        await ctx.mail.enqueue(q, 'us_only', won.email, { refundDue: paid }, { familyId: fid });
        counters.usOnly++;
      }
    } else if (sub && NON_TERMINAL.includes(sub.status) && !(await otherLivePlan(q, fid, sub.id))) {
      // (a second plan is a duplicate that gets cancelled: no welcome for it)
      const won = await flagOnce(q, fid, 'welcome', sub.id);
      if (won) {
        const r = subscriptionRow(sub);
        await ctx.mail.enqueue(q, 'welcome', won.email, {
          priceText: cfg.priceText, trialDays: sub.status === 'trialing' ? cfg.trialDays : 0,
          trialEnd: sub.status === 'trialing' ? toMs(r.trialEnd) : null, periodEnd: toMs(r.periodEnd),
        }, { familyId: fid });
      }
    }
    await q.query("update families set flags = flags - 'checkout' where id = $1 and flags -> 'checkout' ->> 'id' = $2", [fid, session.id]);
    return fid;
  }

  /**
   * Two live plans for one family (§6.4): the newer is cancelled (and flagged for the dad; a paid
   * one gets refund_due). The other's live state is read from Stripe first, never from the mirror.
   * → { sub (fresh), others: [fresh reads to write too], dup: { id, refund } | null }
   */
  async function checkDuplicates(sub) {
    const out = { sub, others: [], dup: null };
    if (!sub || !NON_TERMINAL.includes(sub.status)) return out;
    const customer = idOf(sub.customer);
    const meta = isUuid(sub.metadata?.family_id) ? sub.metadata.family_id : null;
    const fam = meta
      ? await db.one('select id from families where id = $1', [meta])
      : customer ? await db.one('select id from families where stripe_customer_id = $1', [customer]) : null;
    if (!fam) return out;
    const rows = (await db.query(`select id from subscriptions where family_id = $1 and id <> $2 and status in ('trialing', 'active', 'past_due')`, [fam.id, sub.id])).rows;
    const live = [];
    for (const r of rows) {
      const other = await fetchSubscription(r.id);
      if (other) {
        out.others.push(other);
        if (NON_TERMINAL.includes(other.status)) live.push(other);
      }
    }
    if (!live.length) return out;
    const started = (s) => Number(s.start_date ?? s.created ?? 0);
    const all = [sub, ...live].sort((a, b) => started(a) - started(b) || (a.id < b.id ? -1 : 1));
    const newest = all[all.length - 1];
    try {
      await stripe().subscriptions.cancel(newest.id, { invoice_now: false, prorate: false });
    } catch (err) {
      if (!isMissing(err) && err?.type !== 'StripeInvalidRequestError') throw err;
    }
    const fresh = await fetchSubscription(newest.id, newest);
    out.dup = { id: newest.id, refund: newest.status === 'active' };
    if (newest.id === sub.id) out.sub = fresh;
    else out.others = out.others.map((o) => (o.id === newest.id ? fresh : o));
    counters.duplicatesCanceled++;
    log('billing: a family had two live plans; the newer one was cancelled');
    return out;
  }

  async function applyDuplicates(q, familyId, { others = [], dup = null }, syncedAt) {
    for (const o of others) await applySubscription(q, o, { familyId, syncedAt });
    if (dup && familyId) await setFlags(q, familyId, { duplicate_sub: dup.id, ...(dup.refund ? { refund_due: true } : {}) });
  }

  // ---- the webhook (§6.4) ----

  /** Stripe reads an event needs, made before the transaction (the payload's order is not trusted). */
  async function prepare(event) {
    const o = event.data?.object || {};
    switch (event.type) {
      case 'checkout.session.completed': {
        if (o.mode !== 'subscription') return { session: o, sub: null };
        const sub = await checkoutSubscription(o);
        return { session: o, sub, syncedAt: clock.now() };
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const fresh = await fetchSubscription(o.id, o);
        const d = await checkDuplicates(fresh);
        return { ...d, syncedAt: clock.now() };
      }
      case 'invoice.paid':
      case 'invoice.payment_failed': {
        const subId = invoiceSubscriptionId(o);
        if (!subId) return { sub: null };
        return { sub: await fetchSubscription(subId), invoice: o, syncedAt: clock.now() };
      }
      case 'charge.dispute.created': {
        let customer = null;
        const chargeId = idOf(o.charge);
        if (chargeId) {
          try {
            customer = idOf((await stripe().charges.retrieve(chargeId)).customer);
          } catch (err) {
            // without "Charges: read" on the key (or a charge gone), the dispute is still counted;
            // Stripe emails the dad about every dispute anyway
            if (!isMissing(err) && err?.type !== 'StripePermissionError' && err?.statusCode !== 403) throw err;
            log(`billing: dispute without a family (${stripeErrorName(err)})`);
          }
        }
        return { customer };
      }
      case 'customer.deleted':
        return { customer: idOf(o) };
      default:
        return null;
    }
  }

  /** The effect of one event inside the transaction. → the family ids it changed. */
  async function apply(q, event, prep) {
    const now = new Date(clock.now());
    switch (event.type) {
      case 'checkout.session.completed':
        return [await applyCheckout(q, prep.session, prep.sub, prep.syncedAt)];
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const fid = await applySubscription(q, prep.sub, { syncedAt: prep.syncedAt });
        await applyDuplicates(q, fid, prep, prep.syncedAt);
        return [fid];
      }
      case 'invoice.paid':
      case 'invoice.payment_failed': {
        if (!prep.sub) return [];
        const paid = event.type === 'invoice.paid' ? prep.invoice : null;
        const hint = prep.invoice?.parent?.subscription_details?.metadata?.family_id;
        let fid = await applySubscription(q, prep.sub, { syncedAt: prep.syncedAt, paidInvoice: paid });
        if (!fid && isUuid(hint)) fid = await applySubscription(q, prep.sub, { familyId: hint, syncedAt: prep.syncedAt, paidInvoice: paid });
        return [fid];
      }
      case 'charge.dispute.created': {
        counters.disputes++;
        if (!prep.customer) return [];
        const f = await q.one('select id from families where stripe_customer_id = $1 for update', [prep.customer]);
        if (!f) return [];
        await setFlags(q, f.id, { dispute: true });
        return [f.id];
      }
      case 'customer.deleted': {
        if (!prep.customer) return [];
        const rows = (await q.query(
          "update families set stripe_customer_id = null, flags = flags || jsonb_build_object('customer_gen', coalesce((flags ->> 'customer_gen')::int, 0) + 1) where stripe_customer_id = $1 returning id",
          [prep.customer],
        )).rows;
        await q.query('update deleted_families set stripe_done_at = coalesce(stripe_done_at, $2) where stripe_customer_id = $1', [prep.customer, now]);
        return rows.map((r) => r.id);
      }
      default:
        return [];
    }
  }

  async function webhook(req, x) {
    let event;
    try {
      event = stripe().webhooks.constructEvent(x.body, req.headers['stripe-signature'], cfg.stripeWebhookSecret, 300);
    } catch {
      counters.badSignature++;
      throw new HttpError(400, 'bad_signature');
    }
    if (!event || typeof event.id !== 'string' || typeof event.type !== 'string') throw new HttpError(400, 'bad_request');
    if (cfg.stripeShapes) log(`stripe-shape ${event.type} ${shapePaths(event).join(' ')}`);
    if (event.api_version && event.api_version !== STRIPE_API_VERSION && !warnedVersion) {
      warnedVersion = true;
      log(`billing: warning: webhook events come in API version ${String(event.api_version).slice(0, 40)}, the app pins ${STRIPE_API_VERSION} (set the endpoint's version in the Stripe Dashboard)`);
    }
    if (!HANDLED_EVENTS.includes(event.type)) {
      counters.ignored++;
      return { json: { received: true } };
    }
    const seen = await db.one('select processed_at from stripe_events where id = $1', [event.id]);
    if (seen && seen.processed_at) {
      counters.webhooksDuplicate++;
      return { json: { received: true } };
    }
    try {
      const prep = await prepare(event);
      const ids = await db.tx(async (q) => {
        const ins = await q.query('insert into stripe_events (id, type, created, received_at) values ($1, $2, $3, $4) on conflict (id) do nothing returning id', [
          event.id, event.type.slice(0, 100), Number(event.created) || 0, new Date(clock.now()),
        ]);
        if (!ins.rowCount) return null; // handled by a delivery racing this one
        const out = prep ? await apply(q, event, prep) : [];
        await q.query('update stripe_events set processed_at = $2 where id = $1', [event.id, new Date(clock.now())]);
        return out;
      });
      if (ids === null) counters.webhooksDuplicate++;
      else counters.webhooksOk++;
      changed(ids || []);
      return { json: { received: true } };
    } catch (err) {
      counters.webhooksFailed++;
      log(`billing: webhook ${event.type} failed: ${err && err.type ? stripeErrorName(err) : errName(err)} (Stripe will retry)`);
      throw new HttpError(500, 'unavailable');
    }
  }

  // ---- the routes' work ----

  async function familyRow(x) {
    const id = x.session?.familyId;
    const f = isUuid(id) ? await db.one('select * from families where id = $1', [id]) : null;
    if (!f) throw new HttpError(410, 'family_gone');
    return f;
  }

  async function withFamilyLock(id, fn) {
    const prev = locks.get(id) || Promise.resolve();
    let release;
    const mine = new Promise((r) => (release = r));
    const tail = prev.then(() => mine);
    locks.set(id, tail);
    await prev;
    try {
      return await fn();
    } finally {
      release();
      if (locks.get(id) === tail) locks.delete(id);
    }
  }

  /** Stripe's list of the customer's subscriptions, written into the mirror. → the fresh reads. */
  async function syncCustomer(familyId, customer) {
    const list = await sc((s) => s.subscriptions.list({ customer, status: 'all', limit: 3, expand: ['data.latest_invoice'] }));
    const syncedAt = clock.now();
    await db.tx(async (q) => {
      for (const sub of list.data || []) if (idOf(sub.customer) === customer) await applySubscription(q, sub, { familyId, syncedAt });
    });
    changed([familyId]);
    return list.data || [];
  }

  async function checkout(req, x) {
    const body = x.body || {};
    let fam = await familyRow(x);
    if (!fam.email_verified_at) throw new HttpError(403, 'forbidden');
    if (!fam.consent_at) throw new HttpError(403, 'consent_required');
    if (body.usResident !== true) throw new HttpError(400, 'us_only');
    return withFamilyLock(fam.id, async () => {
      fam = await familyRow(x);
      const live = await db.one(`select id from subscriptions where family_id = $1 and status in ('trialing', 'active', 'past_due') limit 1`, [fam.id]);
      if (live) throw new HttpError(409, 'already_subscribed');
      let customer = fam.stripe_customer_id;
      if (customer) {
        // the mirror can be behind (a late webhook): ask Stripe before starting a second plan
        const subs = await syncCustomer(fam.id, customer);
        if (subs.some((s) => NON_TERMINAL.includes(s.status))) throw new HttpError(409, 'already_subscribed');
      }
      const now = clock.now();
      const trial = body.trial === true && !fam.trial_used && cfg.trialDays > 0;
      const open = fam.flags?.checkout;
      if (open && typeof open.id === 'string' && Number.isFinite(open.at) && now - open.at < CHECKOUT_REUSE_MS) {
        let s = null;
        try {
          s = await stripe().checkout.sessions.retrieve(open.id);
        } catch (err) {
          if (!isMissing(err)) {
            counters.stripeErrors++;
            log(`billing: stripe ${stripeErrorName(err)}`);
            throw new HttpError(502, 'stripe_unavailable');
          }
        }
        if (s && s.status === 'open' && s.url && open.trial === trial && idOf(s.customer) === customer) return { json: { url: s.url } };
        if (s && s.status === 'open') await stripe().checkout.sessions.expire(s.id).catch(() => {}); // one open Checkout per family
      }
      if (!customer) {
        const gen = Number(fam.flags?.customer_gen) || 0;
        const c = await sc((st) => st.customers.create({ email: fam.email, metadata: { family_id: fam.id } }, { idempotencyKey: 'cust-' + fam.id + (gen ? '-' + gen : '') }));
        await db.query('update families set stripe_customer_id = $2 where id = $1 and stripe_customer_id is null and not exists (select 1 from families o where o.stripe_customer_id = $2)', [fam.id, c.id]);
        customer = (await db.one('select stripe_customer_id from families where id = $1', [fam.id]))?.stripe_customer_id || c.id;
      }
      const origin = cfg.publicOrigin;
      const session = await sc((st) =>
        st.checkout.sessions.create(
          {
            mode: 'subscription',
            customer,
            client_reference_id: fam.id,
            line_items: [{ price: cfg.stripePriceId, quantity: 1 }],
            subscription_data: { metadata: { family_id: fam.id }, ...(trial ? { trial_period_days: cfg.trialDays } : {}) },
            payment_method_collection: 'always', // card up front, even for a trial
            payment_method_types: ['card'], // Apple Pay and Google Pay are card wallets
            automatic_tax: { enabled: true },
            customer_update: { address: 'auto', name: 'auto' },
            billing_address_collection: 'required',
            consent_collection: { terms_of_service: 'required' }, // the Terms URL is set in the Dashboard
            custom_text: { terms_of_service_acceptance: { message: renewalSentence(cfg, { trial }) } },
            allow_promotion_codes: false,
            locale: 'en',
            expires_at: Math.floor(now / 1000) + 35 * 60, // Stripe's minimum is 30 minutes after its own clock
            success_url: origin + '/account?checkout={CHECKOUT_SESSION_ID}',
            cancel_url: origin + '/account?checkout=cancel',
          },
          { idempotencyKey: `co-${fam.id}-${randomBytes(9).toString('base64url')}` },
        ),
      );
      await setFlags(db, fam.id, { checkout: { id: session.id, at: now, trial } });
      return { json: { url: session.url } };
    });
  }

  async function sync(req, x) {
    const fam = await familyRow(x);
    const sessionId = x.body?.sessionId;
    let usOnly = false;
    if (sessionId !== undefined && sessionId !== null && sessionId !== '') {
      if (typeof sessionId !== 'string' || !SESSION_ID_RE.test(sessionId)) throw new HttpError(400, 'bad_request');
      const session = await sc((s) => s.checkout.sessions.retrieve(sessionId, { expand: ['subscription', 'subscription.latest_invoice'] }), { missing: [404, 'not_found'] });
      if (session.client_reference_id !== fam.id) throw new HttpError(404, 'not_found');
      if (session.status === 'complete' && session.mode === 'subscription') {
        const expanded = session.subscription && typeof session.subscription === 'object' ? session.subscription : null;
        let sub;
        try {
          sub = await checkoutSubscription(session, expanded);
        } catch (err) {
          counters.stripeErrors++;
          log(`billing: stripe ${stripeErrorName(err)}`);
          throw new HttpError(502, 'stripe_unavailable');
        }
        const syncedAt = clock.now();
        await db.tx((q) => applyCheckout(q, { ...session, subscription: idOf(session.subscription) }, sub, syncedAt));
        usOnly = !countryAllowed(session);
      }
      changed([fam.id]);
    } else if (fam.stripe_customer_id) {
      await syncCustomer(fam.id, fam.stripe_customer_id);
    }
    const plan = await entitlementFor(fam.id);
    return { json: { plan, ...(usOnly ? { usOnly: true } : {}) } };
  }

  async function portal(req, x) {
    const fam = await familyRow(x);
    if (!fam.stripe_customer_id) throw new HttpError(404, 'not_found');
    const ps = await sc(
      (s) => s.billingPortal.sessions.create({
        customer: fam.stripe_customer_id,
        return_url: cfg.publicOrigin + '/account?portal=1',
        ...(cfg.stripePortalConfig ? { configuration: cfg.stripePortalConfig } : {}),
      }),
      { missing: [404, 'not_found'] },
    );
    return { json: { url: ps.url } };
  }

  async function startNow(req, x) {
    const fam = await familyRow(x);
    const row = await db.one("select id from subscriptions where family_id = $1 and status = 'trialing' order by trial_end desc nulls last limit 1", [fam.id]);
    if (!row) throw new HttpError(409, 'conflict');
    // one key per subscription: a repeated tap (or a retry) can never charge twice
    await sc((s) => s.subscriptions.update(row.id, { trial_end: 'now' }, { idempotencyKey: `startnow-${row.id}` }), { missing: [409, 'conflict'] });
    const sub = await sc((s) => s.subscriptions.retrieve(row.id, { expand: ['latest_invoice'] }));
    const syncedAt = clock.now();
    await db.tx((q) => applySubscription(q, sub, { familyId: fam.id, syncedAt }));
    changed([fam.id]);
    return { json: { plan: await entitlementFor(fam.id) } };
  }

  // ---- jobs (the job runner in jobs.mjs holds the advisory lock around each) ----

  async function retryDeletions() {
    const rows = (await db.query('select family_id, stripe_customer_id from deleted_families where stripe_customer_id is not null and stripe_done_at is null')).rows;
    let done = 0;
    for (const r of rows) {
      const res = await cancelAndDelete(r.stripe_customer_id);
      if (res.ok) {
        await db.query('update deleted_families set stripe_done_at = $2 where family_id = $1', [r.family_id, new Date(clock.now())]);
        done++;
      }
    }
    return { tried: rows.length, done };
  }

  async function reconcile({ now = clock.now() } = {}) {
    let checked = 0;
    let failed = 0;
    const limit = new Date(now + HOUR);
    const rows = (await db.query(
      `select id, family_id from subscriptions
        where (status = 'trialing' and (trial_end is null or trial_end < $1))
           or (status = 'active' and (current_period_end is null or current_period_end < $1))
           or status in ('past_due', 'incomplete', 'unpaid', 'paused')`,
      [limit],
    )).rows;
    for (const r of rows) {
      try {
        const fresh = await fetchSubscription(r.id);
        if (!fresh) continue;
        const d = await checkDuplicates(fresh);
        const syncedAt = clock.now();
        await db.tx(async (q) => {
          const fid = await applySubscription(q, d.sub, { familyId: r.family_id, syncedAt });
          await applyDuplicates(q, fid, d, syncedAt);
        });
        changed([r.family_id]);
        checked++;
      } catch (err) {
        failed++;
        log(`billing: reconcile read failed: ${stripeErrorName(err)}`);
      }
    }
    // Checkouts whose webhooks never came and whose parent never came back (§6.4 drop)
    const open = (await db.query("select id, flags -> 'checkout' as co from families where flags ? 'checkout'")).rows;
    let sessions = 0;
    for (const f of open) {
      const co = f.co || {};
      try {
        if (typeof co.id !== 'string' || !SESSION_ID_RE.test(co.id) || !(now - Number(co.at) < CHECKOUT_TRACK_MS)) {
          await db.query("update families set flags = flags - 'checkout' where id = $1", [f.id]);
          continue;
        }
        const session = await stripe().checkout.sessions.retrieve(co.id);
        if (session.status === 'complete' && session.mode === 'subscription') {
          const sub = await checkoutSubscription(session);
          const syncedAt = clock.now();
          await db.tx((q) => applyCheckout(q, session, sub, syncedAt));
          changed([f.id]);
          sessions++;
        } else if (session.status === 'expired') {
          await db.query("update families set flags = flags - 'checkout' where id = $1", [f.id]);
        }
      } catch (err) {
        if (isMissing(err)) await db.query("update families set flags = flags - 'checkout' where id = $1", [f.id]);
        else {
          failed++;
          log(`billing: reconcile checkout read failed: ${stripeErrorName(err)}`);
        }
      }
    }
    const deletions = await retryDeletions();
    counters.reconciled += checked + sessions;
    log(`billing: reconcile subscriptions=${checked} checkouts=${sessions} failed=${failed} deletions=${deletions.done}/${deletions.tried}`);
    return { checked, sessions, failed, deletions };
  }

  /**
   * The Stripe side of deleting a family (§3.4 step 1): cancel every subscription that has not
   * ended (no final invoice, no proration), then delete the customer. Never throws: a failure is
   * { ok: false } and the retention job retries it from deleted_families.
   */
  async function cancelAndDelete(target) {
    const customer = typeof target === 'string' ? target : target?.stripe_customer_id ?? target?.stripeCustomerId ?? target?.customerId ?? null;
    if (!customer) return { ok: true, skipped: true };
    try {
      const subs = await stripe().subscriptions.list({ customer, status: 'all', limit: 100 });
      for (const s of subs.data || []) {
        if (s.status === 'canceled' || s.status === 'incomplete_expired') continue;
        try {
          await stripe().subscriptions.cancel(s.id, { invoice_now: false, prorate: false });
        } catch (err) {
          if (!isMissing(err) && err?.type !== 'StripeInvalidRequestError') throw err;
        }
      }
      try {
        await stripe().customers.del(customer);
      } catch (err) {
        if (!isMissing(err)) throw err;
      }
      counters.customersDeleted++;
      return { ok: true };
    } catch (err) {
      counters.stripeErrors++;
      log(`billing: stripe customer deletion failed (${stripeErrorName(err)}); the retention job retries it`);
      return { ok: false, error: stripeErrorName(err) };
    }
  }

  /**
   * Lapse (§6.6): a family that had a plan or a pass and is no longer entitled gets lapsed_at and
   * purge_after (now + SW_RETAIN_DAYS); one that is entitled again gets both cleared. Audited as
   * plan.lapsed / plan.resumed. The warnings and the purge itself are the retention job's.
   */
  async function lapse({ now = clock.now() } = {}) {
    const fams = (await db.query(
      `select f.* from families f
        where f.lapsed_at is not null or f.comp_until is not null
           or exists (select 1 from subscriptions s where s.family_id = f.id and s.status not in ('incomplete', 'incomplete_expired'))`,
    )).rows;
    let lapsed = 0;
    let resumed = 0;
    for (const f of fams) {
      const subs = (await db.query('select * from subscriptions where family_id = $1', [f.id])).rows;
      const e = entitlementOf({ family: f, subs, now, cfg });
      if (!e.entitled && !f.lapsed_at && e.state === 'lapsed') {
        const ok = await db.tx(async (q) => {
          const r = await q.query('update families set lapsed_at = $2, purge_after = $3 where id = $1 and lapsed_at is null', [f.id, new Date(now), new Date(now + cfg.retainDays * DAY)]);
          if (r.rowCount) await ctx.audit(q, f.id, 'plan.lapsed', {}, { actor: 'system' });
          return r.rowCount > 0;
        });
        if (ok) {
          lapsed++;
          changed([f.id]);
        }
      } else if (e.entitled && f.lapsed_at) {
        const ok = await db.tx(async (q) => {
          const r = await q.query("update families set lapsed_at = null, purge_after = null, flags = flags - 'warned30' - 'warned7' where id = $1 and lapsed_at is not null", [f.id]);
          if (r.rowCount) await ctx.audit(q, f.id, 'plan.resumed', {}, { actor: 'system' });
          return r.rowCount > 0;
        });
        if (ok) {
          resumed++;
          changed([f.id]);
        }
      }
    }
    return { lapsed, resumed };
  }

  /** SW_PRICE_TEXT against the Stripe price (§2): one warning line when they disagree. */
  async function checkPrice() {
    try {
      const p = await stripe().prices.retrieve(cfg.stripePriceId);
      const text = String(cfg.priceText || '');
      const m = /\$\s?(\d+)(?:\.(\d{2}))?/.exec(text);
      const cents = m ? Number(m[1]) * 100 + Number(m[2] || 0) : null;
      const problems = [];
      if (cents !== null && p.unit_amount !== cents) problems.push(`amount ${p.unit_amount}`);
      if (p.currency !== 'usd') problems.push(`currency ${p.currency}`);
      if (p.recurring?.interval !== 'month' || (p.recurring?.interval_count || 1) !== 1) problems.push(`interval ${p.recurring?.interval_count || 1} ${p.recurring?.interval || 'none'}`);
      if (/plus[^.]*tax/i.test(text) && p.tax_behavior !== 'exclusive') problems.push(`tax_behavior ${p.tax_behavior}`);
      if (/tax\s+included/i.test(text) && p.tax_behavior !== 'inclusive') problems.push(`tax_behavior ${p.tax_behavior}`);
      if (!p.active) problems.push('inactive');
      if (problems.length) log(`billing: warning: SW_PRICE_TEXT does not match STRIPE_PRICE_ID (${problems.join(', ')})`);
      return { ok: !problems.length, problems };
    } catch (err) {
      log(`billing: warning: could not read STRIPE_PRICE_ID (${stripeErrorName(err)})`);
      return { ok: false, problems: ['unreadable'] };
    }
  }

  function stats() {
    return { ...counters };
  }

  function routeList() {
    const family20 = { name: 'billing-family', count: 20, perMs: HOUR, key: 'family' };
    return [
      {
        method: 'POST', path: '/api/billing/checkout', who: 'parent', handler: checkout,
        limit: [{ name: 'billing-checkout-family', count: 5, perMs: HOUR, key: 'family' }, { name: 'billing-checkout-ip', count: 20, perMs: HOUR, key: 'ip' }],
      },
      { method: 'POST', path: '/api/billing/sync', who: 'parent', handler: sync, limit: [family20] },
      { method: 'POST', path: '/api/billing/portal', who: 'parent+check', handler: portal, limit: [family20] },
      { method: 'POST', path: '/api/billing/start-now', who: 'parent+check', handler: startNow, limit: [family20] },
      { method: 'POST', path: '/api/stripe/webhook', who: 'stripe', body: { kind: 'raw', max: WEBHOOK_MAX }, handler: webhook },
    ];
  }

  // SW_PRICE_TEXT is checked once in the background where Stripe (or the fake) is really there:
  // production (and staging) or a STRIPE_API_BASE; never in unit tests with a made-up key
  if (cfg.production || cfg.stripeApiBase) setTimeout(() => checkPrice().catch(() => {}), 0).unref?.();

  return {
    entitlementFor,
    invalidate,
    reconcile,
    cancelAndDelete,
    lapse,
    checkPrice,
    retryDeletions,
    stats,
    routes: routeList,
    // for tests and the admin CLI
    applySubscription: (q, sub, o) => applySubscription(q, sub, o),
    handleEvent: async (event) => {
      const prep = await prepare(event);
      return db.tx(async (q) => (prep ? apply(q, event, prep) : []));
    },
  };
}

/** The billing routes (accounts.mjs mounts every route module's routes(ctx)). */
export function routes(ctx) {
  const b = ctx.billing && typeof ctx.billing.routes === 'function' ? ctx.billing : createBilling(ctx);
  return b.routes();
}
