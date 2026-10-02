// Make the Stripe objects the Family Plan needs (docs/ACCOUNTS.md §6.1, §14 step 4), once:
//
//   STRIPE_SECRET_KEY=sk_test_… PUBLIC_ORIGIN=https://your-domain npm run stripe:setup
//
// It finds or makes, and prints for the Railway Variables:
//   - the Product "Glimmer World Family Plan" (metadata sw=family_plan)
//   - its one Price: $5.99 a month, USD, tax behavior "exclusive" ("plus sales tax where it applies"),
//     lookup key sparkle_family_monthly                          → STRIPE_PRICE_ID
//   - a Customer Portal configuration (metadata sw=family_portal): update the card, invoice
//     history, cancel at the end of the period with the reason survey; no plan switching, no
//     quantity, no email editing                                  → STRIPE_PORTAL_CONFIG
// Running it again changes nothing (it looks everything up first; a portal configuration that
// drifted is put back, and a product or portal headline made under the game's old name, such as
// "Sparkle World Family Plan", gets today's name). A Stripe price can't be changed: if the one with the lookup key differs,
// it stops and says so (`--replace` makes a new one and moves the lookup key to it).
//
// It needs a full secret key (sk_…) once, by hand. The running server only gets the restricted
// key. Test mode first (sk_test_…), then again with the live key. The product's tax code is set
// in the Dashboard with the accountant (Stripe Tax settings), or here with STRIPE_TAX_CODE=txcd_….
// With STRIPE_API_BASE it talks to the local fake (tests).

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Stripe from 'stripe';
import { stripeOptions } from '../server/stripe.mjs';

export const LOOKUP_KEY = 'sparkle_family_monthly';
export const PRODUCT_TAG = 'family_plan';
export const PORTAL_TAG = 'family_portal';
export const PRODUCT_NAME = 'Glimmer World Family Plan';
export const PORTAL_HEADLINE = 'Glimmer World Family Plan';
export const PRICE = Object.freeze({ unit_amount: 599, currency: 'usd', interval: 'month', tax_behavior: 'exclusive' });

const CANCEL_REASONS = ['too_expensive', 'missing_features', 'switched_service', 'unused', 'customer_service', 'too_complex', 'low_quality', 'other'];

/** The portal features the Family Plan wants (§6.1). */
export function portalFeatures() {
  return {
    customer_update: { enabled: false }, // the sign-in email and the receipts' email stay one address
    invoice_history: { enabled: true },
    payment_method_update: { enabled: true },
    subscription_cancel: {
      enabled: true, mode: 'at_period_end', proration_behavior: 'none',
      cancellation_reason: { enabled: true, options: CANCEL_REASONS },
    },
    subscription_update: { enabled: false }, // one plan: nothing to switch to, no quantity
  };
}

function portalDrift(conf) {
  const f = conf.features || {};
  const out = [];
  if (f.customer_update?.enabled !== false) out.push('customer_update');
  if (f.invoice_history?.enabled !== true) out.push('invoice_history');
  if (f.payment_method_update?.enabled !== true) out.push('payment_method_update');
  const c = f.subscription_cancel || {};
  if (c.enabled !== true || c.mode !== 'at_period_end' || c.proration_behavior !== 'none' || c.cancellation_reason?.enabled !== true) out.push('subscription_cancel');
  if (f.subscription_update?.enabled !== false) out.push('subscription_update');
  return out;
}

async function listAll(listFn, params) {
  const out = [];
  let after;
  for (let i = 0; i < 50; i++) {
    const page = await listFn({ limit: 100, ...params, ...(after ? { starting_after: after } : {}) });
    out.push(...page.data);
    if (!page.has_more || !page.data.length) break;
    after = page.data[page.data.length - 1].id;
  }
  return out;
}

/**
 * Find or make everything. → { priceId, productId, portalConfigId, created: [what was made/changed] }
 * @param {{ stripe: Stripe, origin?: string|null, replace?: boolean, taxCode?: string|null, log?: Function }} o
 */
export async function setup({ stripe, origin = null, replace = false, taxCode = null, log = () => {} }) {
  const created = [];

  // ---- the product and the price ----
  const byKey = await stripe.prices.list({ lookup_keys: [LOOKUP_KEY], limit: 1, expand: ['data.product'] });
  let price = byKey.data[0] || null;
  let product = price && typeof price.product === 'object' ? price.product : null;
  if (!product) {
    const products = await listAll((p) => stripe.products.list(p), { active: true });
    product = products.find((p) => p.metadata?.sw === PRODUCT_TAG) || null;
  }
  if (!product) {
    product = await stripe.products.create({
      name: PRODUCT_NAME,
      description: 'Up to 6 kids, their worlds saved on every device, playing with friends and the walkie-talkie. Nothing to buy inside the game.',
      metadata: { sw: PRODUCT_TAG },
      ...(taxCode ? { tax_code: taxCode } : {}),
    });
    created.push('product');
  } else {
    const fix = {};
    if (product.name !== PRODUCT_NAME) fix.name = PRODUCT_NAME; // made under the old name
    if (taxCode && product.tax_code !== taxCode) fix.tax_code = taxCode;
    if (fix.name || fix.tax_code) {
      product = await stripe.products.update(product.id, fix);
      if (fix.name) created.push('product name');
      if (fix.tax_code) created.push('product tax code');
    }
  }
  const wrong = price
    ? [
        price.unit_amount !== PRICE.unit_amount && `amount ${price.unit_amount}`,
        price.currency !== PRICE.currency && `currency ${price.currency}`,
        (price.recurring?.interval !== PRICE.interval || (price.recurring?.interval_count || 1) !== 1) && `interval ${price.recurring?.interval}`,
        price.tax_behavior !== PRICE.tax_behavior && `tax behavior ${price.tax_behavior}`,
        !price.active && 'inactive',
        (typeof price.product === 'object' ? price.product.id : price.product) !== product.id && 'another product',
      ].filter(Boolean)
    : [];
  if (price && wrong.length && !replace) {
    const err = new Error(`The price with lookup key ${LOOKUP_KEY} (${price.id}) differs: ${wrong.join(', ')}. Stripe prices can't be changed; run again with --replace to make a new one and move the lookup key to it.`);
    err.code = 'price_differs';
    throw err;
  }
  if (!price || wrong.length) {
    price = await stripe.prices.create({
      product: product.id,
      currency: PRICE.currency,
      unit_amount: PRICE.unit_amount,
      recurring: { interval: PRICE.interval },
      tax_behavior: PRICE.tax_behavior,
      lookup_key: LOOKUP_KEY,
      transfer_lookup_key: true,
      nickname: 'Family Plan monthly',
      metadata: { sw: 'family_monthly' },
    });
    created.push('price');
  }
  if (product.default_price !== price.id && (typeof product.default_price !== 'object' || product.default_price?.id !== price.id)) {
    await stripe.products.update(product.id, { default_price: price.id });
    created.push('default price');
  }

  // ---- the Customer Portal configuration ----
  const configs = await listAll((p) => stripe.billingPortal.configurations.list(p), { active: true });
  let conf = configs.find((c) => c.metadata?.sw === PORTAL_TAG) || null;
  const profile = {
    headline: PORTAL_HEADLINE,
    ...(origin ? { privacy_policy_url: origin + '/privacy', terms_of_service_url: origin + '/terms' } : {}),
  };
  if (!conf) {
    conf = await stripe.billingPortal.configurations.create({
      business_profile: profile,
      ...(origin ? { default_return_url: origin + '/account?portal=1' } : {}),
      features: portalFeatures(),
      metadata: { sw: PORTAL_TAG },
    });
    created.push('portal configuration');
  } else {
    const drift = portalDrift(conf);
    const urls = origin && (conf.business_profile?.privacy_policy_url !== profile.privacy_policy_url || conf.business_profile?.terms_of_service_url !== profile.terms_of_service_url || conf.default_return_url !== origin + '/account?portal=1');
    const headline = conf.business_profile?.headline !== PORTAL_HEADLINE;
    if (drift.length || urls || headline) {
      conf = await stripe.billingPortal.configurations.update(conf.id, {
        business_profile: profile,
        ...(origin ? { default_return_url: origin + '/account?portal=1' } : {}),
        features: portalFeatures(),
      });
      created.push(`portal configuration (${[...drift, urls ? 'links' : null, headline ? 'headline' : null].filter(Boolean).join(', ')})`);
    }
  }
  log(created.length ? `made or fixed: ${created.join(', ')}` : 'everything was already there; nothing changed');
  return { priceId: price.id, productId: product.id, portalConfigId: conf.id, created };
}

// ---- as a program ----

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const key = (process.env.STRIPE_SECRET_KEY || '').trim();
  if (!/^sk_(test|live)_[A-Za-z0-9_]+$/.test(key)) {
    console.error('Set STRIPE_SECRET_KEY to a full secret key (sk_test_… first, then sk_live_…). A restricted key cannot make products.');
    process.exit(1);
  }
  const apiBase = (process.env.STRIPE_API_BASE || '').trim() || null;
  if (apiBase && /_live_/.test(key)) {
    console.error('STRIPE_API_BASE is for the local fake only; not with a live key.');
    process.exit(1);
  }
  let origin = (process.env.PUBLIC_ORIGIN || '').trim().replace(/\/+$/, '') || null;
  if (origin && !/^https:\/\/[^/]+$/.test(origin) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
    console.error('PUBLIC_ORIGIN must be the site address, like https://www.playglimmerworld.com');
    process.exit(1);
  }
  if (!origin) console.warn('(no PUBLIC_ORIGIN: the portal gets no Privacy/Terms links or return address; set them in the Dashboard, or run again with PUBLIC_ORIGIN)');
  const stripe = new Stripe(key, stripeOptions({ stripeApiBase: apiBase }));
  try {
    const r = await setup({ stripe, origin, replace: process.argv.includes('--replace'), taxCode: (process.env.STRIPE_TAX_CODE || '').trim() || null, log: (l) => console.log(l) });
    console.log(`Stripe ${/_live_/.test(key) ? 'LIVE' : 'test'} mode. Put these in Railway → the game service → Variables:`);
    console.log(`STRIPE_PRICE_ID=${r.priceId}`);
    console.log(`STRIPE_PORTAL_CONFIG=${r.portalConfigId}`);
  } catch (err) {
    console.error(err.code === 'price_differs' ? err.message : `Stripe said no: ${err.type || err.name}${err.code ? ' ' + err.code : ''}${err.message ? ': ' + err.message : ''}`);
    process.exit(1);
  }
}
