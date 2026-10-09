// The Stripe client (docs/ACCOUNTS.md §6.1): the official SDK with the API version pinned, two
// network retries and a 10 s timeout. In tests and on a developer's machine STRIPE_API_BASE points
// it at the local fake (tools/stripe-fake/), which refuses it in production (config.mjs).
//
//   const stripe = createStripe(cfg)     // ctx.stripe; nothing is sent until a call is made
//   stripeOptions(cfg)                   // the SDK options (also used by tools/stripe-setup.mjs)
//   STRIPE_API_VERSION                   // '2026-08-26.dahlia' (the webhook endpoint uses it too)
//
// The running server only ever has the restricted key (§14 step 4); tools/stripe-setup.mjs is the
// one place that uses a full secret key, once, by hand.
//
// Imported only when SW_ACCOUNTS is on (accounts.mjs loads it), so with accounts off the SDK is
// never loaded.

import Stripe from 'stripe';

/** The API version every request and every webhook event of this app speaks. */
export const STRIPE_API_VERSION = '2026-08-26.dahlia';

/** The SDK configuration for this app (and where it talks to: Stripe, or the fake). */
export function stripeOptions(cfg = {}) {
  const o = {
    apiVersion: STRIPE_API_VERSION,
    maxNetworkRetries: 2,
    timeout: 10000,
    telemetry: false, // no request-timing reports to Stripe: nothing it needs
  };
  if (cfg.stripeApiBase) {
    const u = new URL(cfg.stripeApiBase);
    o.protocol = u.protocol === 'http:' ? 'http' : 'https';
    o.host = u.hostname;
    o.port = u.port ? Number(u.port) : o.protocol === 'http' ? 80 : 443;
  }
  return o;
}

/** The Stripe client for `cfg` (loadConfig()): cfg.stripeSecretKey, cfg.stripeApiBase. */
export function createStripe(cfg) {
  if (!cfg || !cfg.stripeSecretKey) throw new Error('createStripe: STRIPE_SECRET_KEY is missing');
  return new Stripe(cfg.stripeSecretKey, stripeOptions(cfg));
}

/** The name of a Stripe error for logs and answers (never its message: it can echo parameters). */
export function stripeErrorName(err) {
  if (!err) return 'Error';
  if (err.type && typeof err.type === 'string') return err.code ? `${err.type}:${err.code}` : err.type;
  return err.code || err.name || 'Error';
}

/** True for "this object does not exist (any more)" answers. */
export const isMissing = (err) => !!err && (err.code === 'resource_missing' || err.statusCode === 404);
