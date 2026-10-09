// The Stripe fake's state and rules (docs/ACCOUNTS.md §12.3): customers, the catalog (products,
// prices, portal configurations), Checkout and Portal sessions, subscriptions, invoices, charges,
// disputes and events, in the shapes of the pinned API version (2026-08-26.dahlia: the current
// period lives on the subscription item, an invoice names its subscription under
// `parent.subscription_details`, taxes are `total_taxes`). A clock of its own (`advance`) ends
// trials, renews periods, retries failed payments and ends subscriptions.
//
// No HTTP here: server.mjs speaks Stripe's HTTP to it and delivers the events it makes
// (takeEvents()) as signed webhooks. Operations throw FakeError with Stripe's error JSON.
//
// Money rules of the fake: a card is 'ok' until card(customer, 'fail'); a US billing address pays
// sales tax at `taxRate` (6 %), any other country none (Stripe Tax collects only where registered).
// A failed renewal is retried 3, 5 and 7 days after the first failure, then the subscription is
// canceled ("cancel the subscription when all retries fail", §14 step 4).

import { randomBytes } from 'node:crypto';

export const API_VERSION = '2026-08-26.dahlia';
const HOUR = 3600e3;
const DAY = 24 * HOUR;
const RETRY_DAYS = [3, 2, 2]; // after the first failure: +3 d, then +2 d, +2 d (days 3, 5, 7)
const INCOMPLETE_MS = 23 * HOUR;
const LIVE = new Set(['trialing', 'active', 'past_due', 'incomplete', 'unpaid', 'paused']);
const TERMINAL = new Set(['canceled', 'incomplete_expired']);

export class FakeError extends Error {
  constructor(status, error, headers = {}) {
    super(error.message);
    this.name = 'FakeError';
    this.status = status;
    this.error = error;
    this.headers = headers;
  }
}

export const invalid = (message, param, code) => new FakeError(400, { type: 'invalid_request_error', message, ...(code ? { code } : {}), ...(param ? { param } : {}) });
export const missingParam = (param) => invalid(`Missing required param: ${param}.`, param, 'parameter_missing');
export const noSuch = (kind, id, param = 'id') => new FakeError(404, { type: 'invalid_request_error', code: 'resource_missing', message: `No such ${kind}: '${id}'`, param });

const ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
export function rid(n) {
  const b = randomBytes(n);
  let s = '';
  for (let i = 0; i < n; i++) s += ALNUM[b[i] % ALNUM.length];
  return s;
}

export const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const sec = (ms) => Math.floor(ms / 1000);
const truthy = (v) => v === true || v === 'true';

/** The same day of the next month (clamped to the month's end), like a billing cycle anchor. */
export function addMonth(ms, anchorDay = new Date(ms).getUTCDate()) {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  const dim = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return Date.UTC(y, m, Math.min(anchorDay, dim), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds());
}

const ADDRESSES = {
  US: { city: 'San Francisco', country: 'US', line1: '510 Townsend St', line2: null, postal_code: '94103', state: 'CA' },
  CA: { city: 'Toronto', country: 'CA', line1: '1 Yonge St', line2: null, postal_code: 'M5E 1E5', state: 'ON' },
  GB: { city: 'London', country: 'GB', line1: '1 Test Street', line2: null, postal_code: 'EC1A 1BB', state: null },
  DE: { city: 'Berlin', country: 'DE', line1: 'Teststraße 1', line2: null, postal_code: '10115', state: null },
  AU: { city: 'Sydney', country: 'AU', line1: '1 George St', line2: null, postal_code: '2000', state: 'NSW' },
  MX: { city: 'Ciudad de México', country: 'MX', line1: 'Calle 1', line2: null, postal_code: '01000', state: 'CMX' },
};
export const COUNTRIES = Object.keys(ADDRESSES);
const addressFor = (country) => clone(ADDRESSES[country] || { city: 'Test City', country, line1: '1 Test Street', line2: null, postal_code: '00000', state: null });

export class StripeEngine {
  /**
   * @param {object} o
   * @param {string} o.publicUrl   the base of the hosted pages' URLs (/c/:id, /p/:id)
   * @param {boolean} [o.seed]     make the membership product and its $5.99 price (default true)
   * @param {number} [o.taxRate]   US sales tax in the fake (default 0.06)
   */
  constructor({ publicUrl = 'http://127.0.0.1', seed = true, taxRate = 0.06, fixedClock = null } = {}) {
    this.publicUrl = publicUrl;
    this.taxRate = taxRate;
    this.fixedClock = fixedClock; // ms: a clock that stands still unless moved (fixtures); null = real time
    this.offsetMs = 0;
    this.customers = new Map();
    this.products = new Map();
    this.prices = new Map();
    this.portalConfigs = new Map();
    this.checkoutSessions = new Map();
    this.portalSessions = new Map();
    this.subscriptions = new Map();
    this.invoices = new Map();
    this.charges = new Map();
    this.disputes = new Map();
    this.events = []; // every event made, oldest first
    this.pending = []; // events of the operation in progress (server.mjs delivers them)
    this.cards = new Map(); // customer -> 'ok' | 'fail'
    this.meta = new Map(); // id -> internal bookkeeping that is not part of Stripe's object
    this.order = 0; // creation order (several objects share a second)
    this.requestId = null; // the API request being served (event.request.id)
    this.idempotencyKey = null;
    if (seed) this.seedCatalog();
  }

  // ---- time ----

  now() {
    return (this.fixedClock ?? Date.now()) + this.offsetMs;
  }

  nowSec() {
    return sec(this.now());
  }

  /** Put the clock at `ms` (it keeps running from there, unless it is a fixed clock). */
  setNow(ms) {
    this.offsetMs = ms - (this.fixedClock ?? Date.now());
  }

  id(prefix, n = 24) {
    return prefix + rid(n);
  }

  _meta(id) {
    let m = this.meta.get(id);
    if (!m) this.meta.set(id, (m = {}));
    return m;
  }

  _stamp(obj) {
    this._meta(obj.id).order = ++this.order;
    return obj;
  }

  // ---- events ----

  emit(type, object, previous) {
    const ev = {
      id: this.id('evt_'),
      object: 'event',
      api_version: API_VERSION,
      created: this.nowSec(),
      data: { object: clone(object), ...(previous ? { previous_attributes: clone(previous) } : {}) },
      livemode: false,
      pending_webhooks: 1,
      request: { id: this.requestId, idempotency_key: this.idempotencyKey },
      type,
    };
    this._stamp(ev);
    this.events.push(ev);
    this.pending.push(ev);
    return ev;
  }

  /** The events made since the last call (the server delivers them as one batch). */
  takeEvents() {
    const e = this.pending;
    this.pending = [];
    return e;
  }

  // ---- lookups and expansion ----

  lookup(id) {
    if (typeof id !== 'string') return null;
    const maps = [
      ['cus_', this.customers], ['sub_', this.subscriptions], ['in_', this.invoices], ['price_', this.prices],
      ['prod_', this.products], ['ch_', this.charges], ['cs_', this.checkoutSessions], ['bpc_', this.portalConfigs],
      ['du_', this.disputes], ['bps_', this.portalSessions], ['evt_', null],
    ];
    for (const [p, map] of maps) {
      if (!id.startsWith(p)) continue;
      if (p === 'evt_') return this.events.find((e) => e.id === id) || null;
      return map.get(id) || null;
    }
    return null;
  }

  /** A copy of `obj` with the `expand` paths (['subscription.latest_invoice', 'data.product']) filled in. */
  expand(obj, paths = []) {
    const out = clone(obj);
    const list = Array.isArray(paths) ? paths : paths ? [paths] : [];
    for (const p of list) {
      if (typeof p !== 'string' || !p) continue;
      this._expandPath(out, p.split('.'));
    }
    return out;
  }

  _expandPath(node, segs) {
    if (!node || typeof node !== 'object' || !segs.length) return;
    const [k, ...rest] = segs;
    const v = node[k];
    if (Array.isArray(v)) {
      for (let i = 0; i < v.length; i++) {
        if (typeof v[i] === 'string' && !rest.length) {
          const o = this.lookup(v[i]);
          if (o) v[i] = clone(o);
        } else this._expandPath(v[i], rest);
      }
      return;
    }
    if (typeof v === 'string') {
      const o = this.lookup(v);
      if (!o) return;
      node[k] = clone(o);
    }
    if (rest.length) this._expandPath(node[k], rest);
  }

  /** Stripe's list object, newest first, with limit and starting_after. */
  list(items, { limit, starting_after: after, url }) {
    const sorted = [...items].sort((a, b) => (b.created - a.created) || ((this.meta.get(b.id)?.order || 0) - (this.meta.get(a.id)?.order || 0)));
    let start = 0;
    if (after) {
      const i = sorted.findIndex((x) => x.id === after);
      start = i < 0 ? sorted.length : i + 1;
    }
    const n = Math.min(Math.max(Number(limit) || 10, 1), 100);
    const data = sorted.slice(start, start + n);
    return { object: 'list', data: clone(data), has_more: start + n < sorted.length, url };
  }

  // ---- the catalog ----

  seedCatalog() {
    const product = this.createProduct({ name: 'Glimmer World Membership', metadata: { sw: 'family_plan' }, tax_code: 'txcd_10000000' });
    const price = this.createPrice({
      product: product.id, currency: 'usd', unit_amount: '599', recurring: { interval: 'month' }, tax_behavior: 'exclusive', lookup_key: 'sparkle_family_monthly', nickname: 'Membership monthly',
    });
    this.updateProduct(product.id, { default_price: price.id });
    this.createPortalConfig({ is_default: true, features: {} });
    this.seeded = { productId: product.id, priceId: price.id };
    this.takeEvents(); // the seed makes no webhooks
    return this.seeded;
  }

  createProduct(p = {}) {
    if (!p.name) throw missingParam('name');
    const now = this.nowSec();
    const prod = this._stamp({
      id: this.id('prod_', 14), object: 'product', active: p.active === undefined ? true : truthy(p.active), attributes: [], created: now, default_price: null,
      description: p.description || null, images: [], livemode: false, marketing_features: [], metadata: { ...(p.metadata || {}) }, name: p.name,
      package_dimensions: null, shippable: null, statement_descriptor: p.statement_descriptor || null, tax_code: p.tax_code || null, type: 'service',
      unit_label: null, updated: now, url: null,
    });
    this.products.set(prod.id, prod);
    this.emit('product.created', prod);
    return prod;
  }

  updateProduct(id, p = {}) {
    const prod = this.products.get(id);
    if (!prod) throw noSuch('product', id);
    for (const k of ['name', 'description', 'tax_code', 'default_price', 'statement_descriptor']) if (p[k] !== undefined) prod[k] = p[k] === '' ? null : p[k];
    if (p.active !== undefined) prod.active = truthy(p.active);
    if (p.metadata) this._mergeMetadata(prod, p.metadata);
    prod.updated = this.nowSec();
    this.emit('product.updated', prod);
    return prod;
  }

  _mergeMetadata(obj, md) {
    if (md === '') {
      obj.metadata = {};
      return;
    }
    for (const [k, v] of Object.entries(md || {})) {
      if (v === '' || v === null) delete obj.metadata[k];
      else obj.metadata[k] = String(v);
    }
  }

  createPrice(p = {}) {
    if (!p.currency) throw missingParam('currency');
    let productId = p.product;
    if (!productId && p.product_data) productId = this.createProduct(p.product_data).id;
    if (!productId) throw missingParam('product');
    if (!this.products.has(productId)) throw noSuch('product', productId, 'product');
    const amount = Number(p.unit_amount);
    if (!Number.isInteger(amount) || amount < 0) throw invalid('Invalid integer: unit_amount', 'unit_amount');
    if (p.lookup_key) {
      const taken = [...this.prices.values()].find((x) => x.lookup_key === p.lookup_key);
      if (taken) {
        if (!truthy(p.transfer_lookup_key)) throw invalid(`A price (\`${taken.id}\`) already uses that lookup key.`, 'lookup_key');
        taken.lookup_key = null;
      }
    }
    const interval = p.recurring?.interval;
    if (p.recurring && !['day', 'week', 'month', 'year'].includes(interval)) throw invalid('Invalid recurring[interval]', 'recurring[interval]');
    const price = this._stamp({
      id: this.id('price_'), object: 'price', active: true, billing_scheme: 'per_unit', created: this.nowSec(), currency: String(p.currency).toLowerCase(),
      custom_unit_amount: null, livemode: false, lookup_key: p.lookup_key || null, metadata: { ...(p.metadata || {}) }, nickname: p.nickname || null,
      product: productId,
      recurring: p.recurring ? { interval, interval_count: Number(p.recurring.interval_count || 1), meter: null, usage_type: 'licensed' } : null,
      tax_behavior: p.tax_behavior || 'unspecified', tiers_mode: null, transform_quantity: null, type: p.recurring ? 'recurring' : 'one_time',
      unit_amount: amount, unit_amount_decimal: String(amount),
    });
    this.prices.set(price.id, price);
    this.emit('price.created', price);
    return price;
  }

  updatePrice(id, p = {}) {
    const price = this.prices.get(id);
    if (!price) throw noSuch('price', id);
    if (p.active !== undefined) price.active = truthy(p.active);
    if (p.nickname !== undefined) price.nickname = p.nickname || null;
    if (p.lookup_key !== undefined) price.lookup_key = p.lookup_key || null;
    if (p.metadata) this._mergeMetadata(price, p.metadata);
    this.emit('price.updated', price);
    return price;
  }

  listPrices(p = {}) {
    let items = [...this.prices.values()];
    const keys = p.lookup_keys ? (Array.isArray(p.lookup_keys) ? p.lookup_keys : [p.lookup_keys]) : null;
    if (keys) items = items.filter((x) => keys.includes(x.lookup_key));
    if (p.active !== undefined) items = items.filter((x) => x.active === truthy(p.active));
    if (p.product) items = items.filter((x) => x.product === p.product);
    if (p.currency) items = items.filter((x) => x.currency === p.currency);
    return this.list(items, { ...p, url: '/v1/prices' });
  }

  createPortalConfig(p = {}) {
    const f = p.features || {};
    const cfg = this._stamp({
      id: this.id('bpc_'), object: 'billing_portal.configuration', active: true, application: null,
      business_profile: { headline: p.business_profile?.headline || null, privacy_policy_url: p.business_profile?.privacy_policy_url || null, terms_of_service_url: p.business_profile?.terms_of_service_url || null },
      created: this.nowSec(), default_return_url: p.default_return_url || null,
      features: this._portalFeatures(f),
      is_default: truthy(p.is_default), livemode: false, login_page: { enabled: false, url: null }, metadata: { ...(p.metadata || {}) }, name: p.name || null, updated: this.nowSec(),
    });
    if (cfg.is_default) for (const c of this.portalConfigs.values()) c.is_default = false;
    this.portalConfigs.set(cfg.id, cfg);
    return cfg;
  }

  _portalFeatures(f = {}, base = null) {
    const b = base || {
      customer_update: { allowed_updates: [], enabled: false },
      invoice_history: { enabled: false },
      payment_method_update: { enabled: false },
      subscription_cancel: { cancellation_reason: { enabled: false, options: [] }, enabled: false, mode: 'at_period_end', proration_behavior: 'none' },
      subscription_update: { default_allowed_updates: [], enabled: false, products: [], proration_behavior: 'none', schedule_at_period_end: { conditions: [] } },
    };
    const out = clone(b);
    if (f.customer_update) {
      if (f.customer_update.enabled !== undefined) out.customer_update.enabled = truthy(f.customer_update.enabled);
      if (f.customer_update.allowed_updates !== undefined) out.customer_update.allowed_updates = f.customer_update.allowed_updates === '' ? [] : [].concat(f.customer_update.allowed_updates);
    }
    if (f.invoice_history?.enabled !== undefined) out.invoice_history.enabled = truthy(f.invoice_history.enabled);
    if (f.payment_method_update?.enabled !== undefined) out.payment_method_update.enabled = truthy(f.payment_method_update.enabled);
    if (f.subscription_cancel) {
      const c = f.subscription_cancel;
      if (c.enabled !== undefined) out.subscription_cancel.enabled = truthy(c.enabled);
      if (c.mode) out.subscription_cancel.mode = c.mode;
      if (c.proration_behavior) out.subscription_cancel.proration_behavior = c.proration_behavior;
      if (c.cancellation_reason) {
        if (c.cancellation_reason.enabled !== undefined) out.subscription_cancel.cancellation_reason.enabled = truthy(c.cancellation_reason.enabled);
        if (c.cancellation_reason.options !== undefined) out.subscription_cancel.cancellation_reason.options = [].concat(c.cancellation_reason.options);
      }
    }
    if (f.subscription_update?.enabled !== undefined) out.subscription_update.enabled = truthy(f.subscription_update.enabled);
    return out;
  }

  updatePortalConfig(id, p = {}) {
    const cfg = this.portalConfigs.get(id);
    if (!cfg) throw noSuch('configuration', id);
    if (p.features) cfg.features = this._portalFeatures(p.features, cfg.features);
    if (p.business_profile) Object.assign(cfg.business_profile, p.business_profile);
    if (p.default_return_url !== undefined) cfg.default_return_url = p.default_return_url || null;
    if (p.active !== undefined) cfg.active = truthy(p.active);
    if (p.metadata) this._mergeMetadata(cfg, p.metadata);
    if (p.name !== undefined) cfg.name = p.name || null;
    cfg.updated = this.nowSec();
    return cfg;
  }

  // ---- customers ----

  createCustomer(p = {}) {
    if (p.email !== undefined && typeof p.email !== 'string') throw invalid('Invalid email', 'email');
    const c = this._stamp({
      id: this.id('cus_', 14), object: 'customer', address: p.address ? clone(p.address) : null, balance: 0, created: this.nowSec(), currency: null,
      default_source: null, delinquent: false, description: p.description || null, discount: null, email: p.email || null,
      invoice_prefix: rid(8).toUpperCase(), invoice_settings: { custom_fields: null, default_payment_method: null, footer: null, rendering_options: null },
      livemode: false, metadata: { ...(p.metadata || {}) }, name: p.name || null, next_invoice_sequence: 1, phone: null, preferred_locales: [],
      shipping: null, tax_exempt: 'none', test_clock: null,
    });
    this.customers.set(c.id, c);
    this.cards.set(c.id, 'ok');
    this.emit('customer.created', c);
    return c;
  }

  customer(id, param = 'id') {
    const c = this.customers.get(id);
    if (!c) throw noSuch('customer', id, param);
    return c;
  }

  liveCustomer(id, param = 'customer') {
    const c = this.customer(id, param);
    if (c.deleted) throw noSuch('customer', id, param);
    return c;
  }

  updateCustomer(id, p = {}) {
    const c = this.liveCustomer(id, 'id');
    const prev = {};
    for (const k of ['email', 'name', 'description']) {
      if (p[k] !== undefined) {
        prev[k] = c[k];
        c[k] = p[k] || null;
      }
    }
    if (p.address) {
      prev.address = c.address;
      c.address = clone(p.address);
    }
    if (p.metadata) this._mergeMetadata(c, p.metadata);
    this.emit('customer.updated', c, prev);
    return c;
  }

  deleteCustomer(id) {
    const c = this.liveCustomer(id, 'id');
    // deleting a customer cancels its subscriptions at once
    for (const s of this.subscriptions.values()) {
      if (s.customer === id && !TERMINAL.has(s.status)) this._endSubscription(s, 'canceled', 'cancellation_requested');
    }
    const before = clone(c);
    this.customers.set(id, { id, object: 'customer', deleted: true });
    this.emit('customer.deleted', before);
    return { id, object: 'customer', deleted: true };
  }

  card(customer, outcome) {
    if (!this.customers.has(customer)) throw noSuch('customer', customer);
    this.cards.set(customer, outcome === 'fail' ? 'fail' : 'ok');
  }

  // ---- Checkout ----

  createCheckoutSession(p = {}) {
    // the parameters the app relies on (§6.2): a missing one is a loud 400, so a regression fails
    if (!p.mode) throw missingParam('mode');
    if (p.mode !== 'subscription') throw invalid('The fake supports only mode=subscription.', 'mode');
    const items = Array.isArray(p.line_items) ? p.line_items : [];
    if (items.length !== 1) throw invalid('Exactly one line item is expected.', 'line_items');
    const priceId = items[0]?.price;
    if (!priceId) throw missingParam('line_items[0][price]');
    const price = this.prices.get(priceId);
    if (!price) throw noSuch('price', priceId, 'line_items[0][price]');
    if (!price.active) throw invalid('The price is not active.', 'line_items[0][price]');
    if (!price.recurring) throw invalid('mode=subscription needs a recurring price.', 'line_items[0][price]');
    if (String(items[0].quantity) !== '1') throw invalid('quantity must be 1', 'line_items[0][quantity]');
    if (p.payment_method_collection !== 'always') throw invalid("payment_method_collection must be 'always' (card up front)", 'payment_method_collection');
    if (!truthy(p.automatic_tax?.enabled)) throw invalid('automatic_tax[enabled] must be true', 'automatic_tax[enabled]');
    if (!p.client_reference_id) throw missingParam('client_reference_id');
    if (!p.success_url) throw missingParam('success_url');
    if (!String(p.success_url).includes('{CHECKOUT_SESSION_ID}')) throw invalid('success_url must contain {CHECKOUT_SESSION_ID}', 'success_url');
    if (!p.cancel_url) throw missingParam('cancel_url');
    if (p.consent_collection?.terms_of_service !== 'required') throw invalid("consent_collection[terms_of_service] must be 'required'", 'consent_collection[terms_of_service]');
    if (p.billing_address_collection !== 'required') throw invalid("billing_address_collection must be 'required'", 'billing_address_collection');
    if (truthy(p.allow_promotion_codes)) throw invalid('promotion codes are not offered', 'allow_promotion_codes');
    const types = p.payment_method_types ? [].concat(p.payment_method_types) : ['card'];
    if (!types.includes('card')) throw invalid('payment_method_types must include card', 'payment_method_types');
    let customer = null;
    if (p.customer) customer = this.liveCustomer(p.customer, 'customer').id;
    if (p.customer_update && !customer) throw invalid('customer_update can only be used with customer', 'customer_update');
    const now = this.nowSec();
    let expires = now + 24 * 3600;
    if (p.expires_at !== undefined) {
      expires = Number(p.expires_at);
      if (!Number.isInteger(expires) || expires < now + 30 * 60 - 5 || expires > now + 24 * 3600) {
        throw invalid('The `expires_at` timestamp must be between 30 minutes and 24 hours from Checkout Session creation.', 'expires_at');
      }
    }
    let trialDays = null;
    if (p.subscription_data?.trial_period_days !== undefined) {
      trialDays = Number(p.subscription_data.trial_period_days);
      if (!Number.isInteger(trialDays) || trialDays < 1 || trialDays > 730) throw invalid('Invalid subscription_data[trial_period_days]', 'subscription_data[trial_period_days]');
    }
    const id = 'cs_test_' + rid(58);
    const s = this._stamp({
      id, object: 'checkout.session', adaptive_pricing: { enabled: false }, after_expiration: null, allow_promotion_codes: false,
      amount_subtotal: price.unit_amount, amount_total: price.unit_amount,
      automatic_tax: { enabled: true, liability: { type: 'self' }, provider: 'stripe', status: 'requires_location_inputs' },
      billing_address_collection: 'required', cancel_url: p.cancel_url, client_reference_id: p.client_reference_id, client_secret: null,
      collected_information: { business_name: null, individual_name: null, shipping_details: null },
      consent: null, consent_collection: { payment_method_reuse_agreement: null, promotions: 'none', terms_of_service: 'required' },
      created: now, currency: price.currency, currency_conversion: null, custom_fields: [],
      custom_text: {
        after_submit: null, shipping_address: null, submit: null,
        terms_of_service_acceptance: p.custom_text?.terms_of_service_acceptance?.message ? { message: p.custom_text.terms_of_service_acceptance.message } : null,
      },
      customer, customer_creation: customer ? null : 'always', customer_details: null, customer_email: p.customer_email || null, discounts: [],
      expires_at: expires, invoice: null, invoice_creation: null, livemode: false, locale: p.locale || 'auto', metadata: { ...(p.metadata || {}) },
      mode: 'subscription', origin_context: null, payment_intent: null, payment_link: null, payment_method_collection: 'always',
      payment_method_configuration_details: null, payment_method_options: { card: { request_three_d_secure: 'automatic' } }, payment_method_types: types,
      payment_status: 'unpaid', permissions: null, phone_number_collection: { enabled: false }, recovered_from: null, saved_payment_method_options: null,
      setup_intent: null, shipping_address_collection: null, shipping_cost: null, shipping_options: [], status: 'open', submit_type: null,
      subscription: null, success_url: p.success_url, total_details: { amount_discount: 0, amount_shipping: 0, amount_tax: 0 }, ui_mode: 'hosted',
      url: `${this.publicUrl}/c/${id}`, wallet_options: null,
    });
    Object.assign(this._meta(id), {
      priceId, trialDays, subscriptionMetadata: { ...(p.subscription_data?.metadata || {}) },
      customerUpdate: p.customer_update || {}, params: clone(p),
    });
    this.checkoutSessions.set(id, s);
    return s;
  }

  checkoutSession(id) {
    const s = this.checkoutSessions.get(id);
    if (!s) throw noSuch('checkout.session', id);
    return s;
  }

  expireCheckoutSession(id) {
    const s = this.checkoutSession(id);
    if (s.status !== 'open') throw invalid(`Only Checkout Sessions with a status in ["open"] can be expired. This Checkout Session has a status of "${s.status}".`);
    this._expireSession(s);
    return s;
  }

  _expireSession(s) {
    s.status = 'expired';
    s.url = null;
    this.emit('checkout.session.expired', s);
  }

  listCheckoutSessions(p = {}) {
    let items = [...this.checkoutSessions.values()];
    if (p.customer) items = items.filter((x) => x.customer === p.customer);
    if (p.status) items = items.filter((x) => x.status === p.status);
    if (p.subscription) items = items.filter((x) => x.subscription === p.subscription);
    return this.list(items, { ...p, url: '/v1/checkout/sessions' });
  }

  /**
   * What the hosted page does when the parent taps a button (§12.3):
   *   outcome 'ok' (Pay with 4242), 'decline' (Declined), '3ds' (Needs 3-D Secure → incomplete),
   *   'approve' / 'fail3ds' (the bank's answer on a waiting 3-D Secure page)
   * → { status: 'complete'|'declined'|'requires_action'|'failed', redirect? }
   */
  completeCheckout(id, { outcome = 'ok', country = 'US', name = 'Test Parent' } = {}) {
    const s = this.checkoutSession(id);
    const m = this._meta(id);
    if (s.status !== 'open') throw invalid(`This Checkout Session is ${s.status}.`);
    if (m.pending) {
      const sub = this.subscriptions.get(m.pending);
      if (outcome === 'approve') {
        const inv = this.invoices.get(sub.latest_invoice);
        this._payInvoice(inv, { force: true });
        const prev = { status: sub.status };
        sub.status = 'active';
        this.emit('customer.subscription.updated', sub, prev);
        m.pending = null;
        return this._finishCheckout(s, sub, inv);
      }
      return { status: 'requires_action' };
    }
    let customerId = s.customer;
    if (!customerId) {
      customerId = this.createCustomer({ email: s.customer_email || 'parent@example.com' }).id;
      s.customer = customerId;
    }
    const cust = this.liveCustomer(customerId);
    const address = addressFor(String(country || 'US').toUpperCase());
    const prevCust = { address: cust.address, name: cust.name };
    if (m.customerUpdate?.address === 'auto' || !s.customer) cust.address = clone(address);
    if (m.customerUpdate?.name === 'auto') cust.name = name;
    s.customer_details = { address: clone(address), business_name: null, email: cust.email, individual_name: null, name, phone: null, tax_exempt: 'none', tax_ids: [] };
    if (outcome === 'decline' || (outcome === 'ok' && this.cards.get(customerId) === 'fail' && !m.trialDays)) {
      m.declined = (m.declined || 0) + 1;
      return { status: 'declined' };
    }
    this.emit('customer.updated', cust, prevCust);
    const price = this.prices.get(m.priceId);
    const trial = m.trialDays ? m.trialDays : 0;
    const sub = this._newSubscription({ customer: customerId, price, metadata: m.subscriptionMetadata, trialDays: trial, status: trial ? 'trialing' : outcome === '3ds' ? 'incomplete' : 'active' });
    const start = sub.items.data[0].current_period_start * 1000;
    const end = sub.items.data[0].current_period_end * 1000;
    const inv = this._newInvoice(sub, { reason: 'subscription_create', amount: trial ? 0 : price.unit_amount, start, end, address });
    sub.latest_invoice = inv.id;
    this.emit('customer.subscription.created', sub);
    this.emit('invoice.created', inv);
    this._finalize(inv);
    if (outcome === '3ds' && !trial) {
      inv.attempt_count = 1;
      inv.attempted = true;
      m.pending = sub.id;
      return { status: 'requires_action' };
    }
    this._payInvoice(inv, { force: true });
    return this._finishCheckout(s, sub, inv);
  }

  _finishCheckout(s, sub, inv) {
    s.status = 'complete';
    s.subscription = sub.id;
    s.invoice = inv.id;
    s.url = null;
    s.consent = { promotions: null, terms_of_service: 'accepted' };
    s.amount_subtotal = inv.subtotal;
    s.amount_total = inv.total;
    s.total_details = { amount_discount: 0, amount_shipping: 0, amount_tax: inv.total - inv.subtotal };
    s.automatic_tax.status = 'complete';
    s.payment_status = inv.amount_paid > 0 ? 'paid' : 'no_payment_required';
    this.emit('checkout.session.completed', s);
    return { status: 'complete', redirect: s.success_url.replace('{CHECKOUT_SESSION_ID}', s.id) };
  }

  // ---- subscriptions ----

  _newSubscription({ customer, price, metadata = {}, trialDays = 0, status }) {
    const now = this.now();
    const id = this.id('sub_');
    const trialEnd = trialDays ? now + trialDays * DAY : null;
    const periodEnd = trialEnd ?? addMonth(now);
    const item = {
      id: this.id('si_', 14), object: 'subscription_item', billing_thresholds: null, created: sec(now),
      current_period_end: sec(periodEnd), current_period_start: sec(now), discounts: [], metadata: {},
      plan: this._planOf(price), price: clone(price), quantity: 1, subscription: id, tax_rates: [],
    };
    const sub = this._stamp({
      id, object: 'subscription', application: null, application_fee_percent: null,
      automatic_tax: { disabled_reason: null, enabled: true, liability: { type: 'self' } },
      billing_cycle_anchor: sec(periodEnd), billing_cycle_anchor_config: null, billing_mode: { flexible: null, type: 'classic' }, billing_thresholds: null,
      cancel_at: null, cancel_at_period_end: false, canceled_at: null, cancellation_details: { comment: null, feedback: null, reason: null },
      collection_method: 'charge_automatically', created: sec(now), currency: price.currency, customer, days_until_due: null,
      default_payment_method: 'pm_' + rid(24), default_source: null, default_tax_rates: [], description: null, discounts: [], ended_at: null,
      invoice_settings: { account_tax_ids: null, issuer: { type: 'self' } },
      items: { object: 'list', data: [item], has_more: false, total_count: 1, url: `/v1/subscription_items?subscription=${id}` },
      latest_invoice: null, livemode: false, metadata: { ...metadata }, next_pending_invoice_item_invoice: null, on_behalf_of: null,
      pause_collection: null, payment_settings: { payment_method_options: null, payment_method_types: null, save_default_payment_method: 'off' },
      pending_invoice_item_interval: null, pending_setup_intent: null, pending_update: null, schedule: null, start_date: sec(now), status,
      test_clock: null, transfer_data: null, trial_end: trialEnd ? sec(trialEnd) : null,
      trial_settings: { end_behavior: { missing_payment_method: 'create_invoice' } }, trial_start: trialEnd ? sec(now) : null,
    });
    this._meta(id).anchorDay = new Date(periodEnd).getUTCDate();
    this.subscriptions.set(id, sub);
    return sub;
  }

  _planOf(price) {
    return {
      id: price.id, object: 'plan', active: price.active, amount: price.unit_amount, amount_decimal: String(price.unit_amount), billing_scheme: 'per_unit',
      created: price.created, currency: price.currency, interval: price.recurring?.interval || 'month', interval_count: price.recurring?.interval_count || 1,
      livemode: false, metadata: {}, meter: null, nickname: price.nickname, product: price.product, tiers_mode: null, transform_usage: null,
      trial_period_days: null, usage_type: 'licensed',
    };
  }

  subscription(id, param = 'id') {
    const s = this.subscriptions.get(id);
    if (!s) throw noSuch('subscription', id, param);
    return s;
  }

  listSubscriptions(p = {}) {
    let items = [...this.subscriptions.values()];
    if (p.customer) items = items.filter((x) => x.customer === p.customer);
    if (p.price) items = items.filter((x) => x.items.data[0]?.price?.id === p.price);
    const st = p.status;
    if (!st) items = items.filter((x) => !TERMINAL.has(x.status));
    else if (st === 'ended') items = items.filter((x) => TERMINAL.has(x.status));
    else if (st !== 'all') items = items.filter((x) => x.status === st);
    return this.list(items, { ...p, url: '/v1/subscriptions' });
  }

  updateSubscription(id, p = {}) {
    const sub = this.subscription(id);
    const keys = Object.keys(p).filter((k) => k !== 'expand');
    if (TERMINAL.has(sub.status) && keys.some((k) => k !== 'metadata' && k !== 'cancellation_details')) {
      throw invalid('A canceled subscription can only update its cancellation_details and metadata.');
    }
    const prev = {};
    if (p.metadata) {
      prev.metadata = clone(sub.metadata);
      this._mergeMetadata(sub, p.metadata);
    }
    if (p.cancel_at_period_end !== undefined) {
      const on = truthy(p.cancel_at_period_end);
      prev.cancel_at_period_end = sub.cancel_at_period_end;
      prev.cancel_at = sub.cancel_at;
      prev.canceled_at = sub.canceled_at;
      sub.cancel_at_period_end = on;
      sub.cancel_at = on ? sub.items.data[0].current_period_end : null;
      sub.canceled_at = on ? this.nowSec() : null;
      sub.cancellation_details = { comment: null, feedback: null, reason: on ? 'cancellation_requested' : null };
    }
    if (p.trial_end !== undefined) {
      if (p.trial_end !== 'now') throw invalid('The fake supports only trial_end=now.', 'trial_end');
      if (sub.status !== 'trialing') throw invalid('This subscription is not in a trial period.', 'trial_end');
      prev.status = sub.status;
      prev.trial_end = sub.trial_end;
      this._endTrial(sub, { reason: 'subscription_update' });
      this.emit('customer.subscription.updated', sub, prev);
      return sub;
    }
    this.emit('customer.subscription.updated', sub, prev);
    return sub;
  }

  cancelSubscription(id, p = {}) {
    const sub = this.subscription(id);
    if (TERMINAL.has(sub.status)) throw invalid('This subscription is already canceled.');
    void p; // invoice_now / prorate: nothing is invoiced or credited in the fake
    this._endSubscription(sub, 'canceled', 'cancellation_requested');
    return sub;
  }

  _endSubscription(sub, status, reason) {
    const now = this.nowSec();
    sub.status = status;
    sub.ended_at = now;
    sub.canceled_at = sub.canceled_at || now;
    sub.cancellation_details = { comment: null, feedback: null, reason };
    const m = this._meta(sub.id);
    m.nextAttemptAt = null;
    const inv = sub.latest_invoice ? this.invoices.get(sub.latest_invoice) : null;
    if (inv && inv.status === 'open') inv.next_payment_attempt = null;
    this.emit('customer.subscription.deleted', sub);
  }

  // ---- invoices and charges ----

  _taxFor(address, amount) {
    return address?.country === 'US' ? Math.round(amount * this.taxRate) : 0;
  }

  _newInvoice(sub, { reason, amount, start, end, address = null }) {
    const cust = this.customers.get(sub.customer);
    const addr = address || cust?.address || null;
    const tax = this._taxFor(addr, amount);
    const now = this.nowSec();
    const id = this.id('in_');
    const item = sub.items.data[0];
    const taxes = tax ? [{ amount: tax, tax_behavior: 'exclusive', tax_rate_details: { tax_rate: 'txr_fake_us' }, taxability_reason: 'standard_rated', taxable_amount: amount, type: 'tax_rate_details' }] : [];
    const line = {
      id: 'il_' + rid(24), object: 'line_item', amount, currency: sub.currency,
      description: `1 × ${this.products.get(item.price.product)?.name || 'Plan'} (at $${(item.price.unit_amount / 100).toFixed(2)} / month)`,
      discount_amounts: [], discountable: true, discounts: [], invoice: id, livemode: false, metadata: {},
      parent: { invoice_item_details: null, subscription_item_details: { invoice_item: null, proration: false, proration_details: { credited_items: null }, subscription: sub.id, subscription_item: item.id }, type: 'subscription_item_details' },
      period: { end: sec(end), start: sec(start) }, pretax_credit_amounts: [],
      pricing: { price_details: { price: item.price.id, product: item.price.product }, type: 'price_details', unit_amount_decimal: String(item.price.unit_amount) },
      quantity: 1, taxes: clone(taxes),
    };
    const seq = cust ? cust.next_invoice_sequence++ : 1;
    const inv = this._stamp({
      id, object: 'invoice', account_country: 'US', account_name: 'Glimmer World', account_tax_ids: null,
      amount_due: amount + tax, amount_overpaid: 0, amount_paid: 0, amount_remaining: amount + tax, amount_shipping: 0, application: null,
      attempt_count: 0, attempted: false, auto_advance: true,
      automatic_tax: { disabled_reason: null, enabled: true, liability: { type: 'self' }, provider: 'stripe', status: 'complete' },
      automatically_finalizes_at: null, billing_reason: reason, collection_method: 'charge_automatically', confirmation_secret: null, created: now,
      currency: sub.currency, custom_fields: null, customer: sub.customer, customer_address: addr ? clone(addr) : null, customer_email: cust?.email || null,
      customer_name: cust?.name || null, customer_phone: null, customer_shipping: null, customer_tax_exempt: 'none', customer_tax_ids: [],
      default_payment_method: null, default_source: null, default_tax_rates: [], description: null, discounts: [], due_date: null, effective_at: null,
      ending_balance: null, footer: null, from_invoice: null, hosted_invoice_url: null, invoice_pdf: null, issuer: { type: 'self' },
      last_finalization_error: null, latest_revision: null,
      lines: { object: 'list', data: [line], has_more: false, total_count: 1, url: `/v1/invoices/${id}/lines` },
      livemode: false, metadata: {}, next_payment_attempt: null, number: null, on_behalf_of: null,
      parent: { quote_details: null, subscription_details: { metadata: clone(sub.metadata), subscription: sub.id }, type: 'subscription_details' },
      payment_settings: { default_mandate: null, payment_method_options: null, payment_method_types: null },
      period_end: sec(end), period_start: sec(start), post_payment_credit_notes_amount: 0, pre_payment_credit_notes_amount: 0, receipt_number: null,
      rendering: null, shipping_cost: null, shipping_details: null, starting_balance: 0, statement_descriptor: null, status: 'draft',
      status_transitions: { finalized_at: null, marked_uncollectible_at: null, paid_at: null, voided_at: null },
      subtotal: amount, subtotal_excluding_tax: amount, test_clock: null, total: amount + tax, total_discount_amounts: [],
      total_excluding_tax: amount, total_pretax_credit_amounts: [], total_taxes: taxes, webhooks_delivered_at: null,
    });
    this._meta(id).seq = seq;
    this.invoices.set(id, inv);
    return inv;
  }

  _finalize(inv) {
    const cust = this.customers.get(inv.customer);
    inv.status = 'open';
    inv.number = `${cust?.invoice_prefix || 'FAKE'}-${String(this._meta(inv.id).seq).padStart(4, '0')}`;
    inv.status_transitions.finalized_at = this.nowSec();
    inv.effective_at = this.nowSec();
    inv.ending_balance = 0;
    inv.hosted_invoice_url = `${this.publicUrl}/i/${inv.id}`;
    inv.invoice_pdf = `${this.publicUrl}/i/${inv.id}/pdf`;
    this.emit('invoice.finalized', inv);
  }

  /** Try to pay an open invoice with the customer's card; emits paid/succeeded or payment_failed. */
  _payInvoice(inv, { force = false } = {}) {
    if (inv.status !== 'open') return inv.status === 'paid';
    inv.attempted = inv.amount_due > 0 ? true : inv.attempted;
    if (inv.amount_due > 0) inv.attempt_count++;
    const ok = inv.amount_due === 0 || force || this.cards.get(inv.customer) !== 'fail';
    if (!ok) {
      this.emit('invoice.payment_failed', inv);
      return false;
    }
    if (inv.amount_due > 0) {
      const ch = this._stamp({
        id: this.id('ch_'), object: 'charge', amount: inv.amount_due, amount_captured: inv.amount_due, amount_refunded: 0,
        billing_details: { address: clone(inv.customer_address), email: inv.customer_email, name: inv.customer_name, phone: null },
        captured: true, created: this.nowSec(), currency: inv.currency, customer: inv.customer, description: 'Subscription creation', disputed: false,
        livemode: false, metadata: {}, outcome: { network_status: 'approved_by_network', reason: null, risk_level: 'normal', seller_message: 'Payment complete.', type: 'authorized' },
        paid: true, payment_intent: this.id('pi_'), payment_method: 'pm_' + rid(24),
        payment_method_details: { card: { brand: 'visa', country: 'US', exp_month: 12, exp_year: 2034, funding: 'credit', last4: '4242' }, type: 'card' },
        receipt_email: null, refunded: false, status: 'succeeded',
      });
      this.charges.set(ch.id, ch);
      this._meta(inv.id).charge = ch.id;
    }
    inv.status = 'paid';
    inv.amount_paid = inv.amount_due;
    inv.amount_remaining = 0;
    inv.next_payment_attempt = null;
    inv.status_transitions.paid_at = this.nowSec();
    this.emit('invoice.paid', inv);
    this.emit('invoice.payment_succeeded', inv);
    return true;
  }

  invoice(id) {
    const inv = this.invoices.get(id);
    if (!inv) throw noSuch('invoice', id);
    return inv;
  }

  listInvoices(p = {}) {
    let items = [...this.invoices.values()];
    if (p.customer) items = items.filter((x) => x.customer === p.customer);
    if (p.subscription) items = items.filter((x) => x.parent?.subscription_details?.subscription === p.subscription);
    if (p.status) items = items.filter((x) => x.status === p.status);
    return this.list(items, { ...p, url: '/v1/invoices' });
  }

  charge(id) {
    const c = this.charges.get(id);
    if (!c) throw noSuch('charge', id);
    return c;
  }

  /** A chargeback on the customer's latest charge (charge.dispute.created). */
  dispute({ customer, charge } = {}) {
    let ch = charge ? this.charge(charge) : null;
    if (!ch) ch = [...this.charges.values()].filter((c) => c.customer === customer).sort((a, b) => (this.meta.get(b.id)?.order || 0) - (this.meta.get(a.id)?.order || 0))[0];
    if (!ch) throw invalid('no charge to dispute');
    ch.disputed = true;
    const d = this._stamp({
      id: this.id('du_'), object: 'dispute', amount: ch.amount, balance_transactions: [], charge: ch.id, created: this.nowSec(), currency: ch.currency,
      enhanced_eligibility_types: [], evidence: { customer_email_address: null, product_description: null, uncategorized_text: null },
      evidence_details: { due_by: this.nowSec() + 7 * 86400, has_evidence: false, past_due: false, submission_count: 0 },
      is_charge_refundable: true, livemode: false, metadata: {}, payment_intent: ch.payment_intent,
      payment_method_details: { card: { brand: 'visa', case_type: 'chargeback', network_reason_code: '10.4' }, type: 'card' },
      reason: 'fraudulent', status: 'needs_response',
    });
    this.disputes.set(d.id, d);
    this.emit('charge.dispute.created', d);
    return d;
  }

  // ---- the Portal ----

  createPortalSession(p = {}) {
    if (!p.customer) throw missingParam('customer');
    this.liveCustomer(p.customer, 'customer');
    let conf = null;
    if (p.configuration) {
      conf = this.portalConfigs.get(p.configuration);
      if (!conf) throw noSuch('configuration', p.configuration, 'configuration');
    } else conf = [...this.portalConfigs.values()].find((c) => c.is_default) || null;
    if (!conf) throw invalid('You can’t create a portal session in test mode until you save your customer portal settings in test mode.');
    const returnUrl = p.return_url || conf.default_return_url;
    if (!returnUrl) throw missingParam('return_url');
    const id = this.id('bps_');
    const ps = this._stamp({ id, object: 'billing_portal.session', configuration: conf.id, created: this.nowSec(), customer: p.customer, flow: null, livemode: false, locale: null, on_behalf_of: null, return_url: returnUrl, url: `${this.publicUrl}/p/${id}` });
    this.portalSessions.set(id, ps);
    return ps;
  }

  /** The customer's subscription the Portal shows (the live one, else the newest). */
  portalSubscription(customer) {
    const subs = [...this.subscriptions.values()].filter((s) => s.customer === customer).sort((a, b) => (this.meta.get(b.id)?.order || 0) - (this.meta.get(a.id)?.order || 0));
    return subs.find((s) => LIVE.has(s.status)) || subs[0] || null;
  }

  /** A Portal button: cancel_at_period_end | resume | cancel_now | update_card | card_fails. */
  portalAction(portalSessionId, action) {
    const ps = this.portalSessions.get(portalSessionId);
    if (!ps) throw noSuch('billing_portal.session', portalSessionId);
    const sub = this.portalSubscription(ps.customer);
    switch (action) {
      case 'cancel_at_period_end':
        if (!sub || !LIVE.has(sub.status)) throw invalid('nothing to cancel');
        return this.updateSubscription(sub.id, { cancel_at_period_end: 'true' });
      case 'resume':
        if (!sub || !LIVE.has(sub.status)) throw invalid('nothing to resume');
        return this.updateSubscription(sub.id, { cancel_at_period_end: 'false' });
      case 'cancel_now':
        if (!sub || !LIVE.has(sub.status)) throw invalid('nothing to cancel');
        return this.cancelSubscription(sub.id);
      case 'update_card':
        this.cards.set(ps.customer, 'ok');
        if (sub && sub.status === 'past_due') this._retry(sub);
        return sub;
      case 'card_fails':
        this.cards.set(ps.customer, 'fail');
        return sub;
      default:
        throw invalid('unknown portal action ' + action);
    }
  }

  // ---- the clock ----

  /** Move the fake's clock forward `ms`, doing everything that falls due on the way, in order. */
  advanceMs(ms) {
    if (!(ms >= 0)) throw new Error('advance: a positive time');
    const target = this.now() + ms;
    for (let guard = 0; guard < 100000 && this.stepTo(target); guard++);
    this.setNow(target);
  }

  /** The next thing due at or before `target`: { at, run } (the clock is not moved), or null. */
  nextDue(target) {
    return this._nextDue(target);
  }

  /** Move the clock to the next thing due at or before `target` and do it; false when none is left. */
  stepTo(target) {
    const next = this._nextDue(target);
    if (!next) return false;
    this.setNow(next.at);
    next.run();
    return true;
  }

  _nextDue(target) {
    let best = null;
    const consider = (at, run) => {
      if (at !== null && at <= target && (!best || at < best.at)) best = { at, run };
    };
    for (const sub of this.subscriptions.values()) {
      const item = sub.items.data[0];
      const m = this._meta(sub.id);
      if (sub.status === 'trialing') consider(sub.trial_end * 1000, () => this._endTrial(sub, { reason: 'subscription_cycle', emitUpdate: true }));
      else if (sub.status === 'active' && sub.cancel_at_period_end) consider(item.current_period_end * 1000, () => this._endSubscription(sub, 'canceled', 'cancellation_requested'));
      else if (sub.status === 'active') consider(item.current_period_end * 1000, () => this._renew(sub));
      else if (sub.status === 'past_due' && m.nextAttemptAt) consider(m.nextAttemptAt, () => this._retry(sub));
      else if (sub.status === 'incomplete') consider(sub.created * 1000 + INCOMPLETE_MS, () => this._expireIncomplete(sub));
    }
    for (const s of this.checkoutSessions.values()) {
      if (s.status === 'open') consider(s.expires_at * 1000, () => this._expireSession(s));
    }
    return best;
  }

  _endTrial(sub, { reason, emitUpdate = false }) {
    const prev = { status: sub.status, trial_end: sub.trial_end };
    const now = this.now();
    const item = sub.items.data[0];
    const start = now;
    const end = addMonth(start);
    this._meta(sub.id).anchorDay = new Date(start).getUTCDate();
    sub.trial_end = sec(now);
    item.current_period_start = sec(start);
    item.current_period_end = sec(end);
    sub.billing_cycle_anchor = sec(start);
    const price = item.price;
    const inv = this._newInvoice(sub, { reason, amount: price.unit_amount, start, end });
    sub.latest_invoice = inv.id;
    this.emit('invoice.created', inv);
    this._finalize(inv);
    const paid = this._payInvoice(inv);
    sub.status = paid ? 'active' : 'past_due';
    if (!paid) this._firstFailure(sub, inv);
    if (emitUpdate) this.emit('customer.subscription.updated', sub, prev);
  }

  _renew(sub) {
    const item = sub.items.data[0];
    const prev = { items: { data: [{ current_period_start: item.current_period_start, current_period_end: item.current_period_end }] }, latest_invoice: sub.latest_invoice };
    const start = item.current_period_end * 1000;
    const end = addMonth(start, this._meta(sub.id).anchorDay);
    item.current_period_start = sec(start);
    item.current_period_end = sec(end);
    const inv = this._newInvoice(sub, { reason: 'subscription_cycle', amount: item.price.unit_amount, start, end });
    sub.latest_invoice = inv.id;
    this.emit('invoice.created', inv);
    this._finalize(inv);
    const paid = this._payInvoice(inv);
    if (!paid) {
      prev.status = sub.status;
      sub.status = 'past_due';
      this._firstFailure(sub, inv);
    }
    this.emit('customer.subscription.updated', sub, prev);
  }

  _firstFailure(sub, inv) {
    const m = this._meta(sub.id);
    m.retries = 0;
    m.nextAttemptAt = this.now() + RETRY_DAYS[0] * DAY;
    inv.next_payment_attempt = sec(m.nextAttemptAt);
  }

  _retry(sub) {
    const m = this._meta(sub.id);
    const inv = this.invoices.get(sub.latest_invoice);
    if (!inv || inv.status !== 'open') {
      m.nextAttemptAt = null;
      return;
    }
    if (this._payInvoice(inv)) {
      m.nextAttemptAt = null;
      const prev = { status: sub.status };
      sub.status = 'active';
      this.emit('customer.subscription.updated', sub, prev);
      return;
    }
    m.retries = (m.retries || 0) + 1;
    if (m.retries >= RETRY_DAYS.length) {
      inv.next_payment_attempt = null;
      this._endSubscription(sub, 'canceled', 'payment_failed');
      return;
    }
    m.nextAttemptAt = this.now() + RETRY_DAYS[m.retries] * DAY;
    inv.next_payment_attempt = sec(m.nextAttemptAt);
  }

  _expireIncomplete(sub) {
    const inv = sub.latest_invoice ? this.invoices.get(sub.latest_invoice) : null;
    if (inv && inv.status === 'open') {
      inv.status = 'void';
      inv.status_transitions.voided_at = this.nowSec();
      this.emit('invoice.voided', inv);
    }
    for (const s of this.checkoutSessions.values()) if (this._meta(s.id).pending === sub.id) this._meta(s.id).pending = null;
    this._endSubscription(sub, 'incomplete_expired', null);
  }

  // ---- events API ----

  listEvents(p = {}) {
    let items = [...this.events];
    const types = p.types ? [].concat(p.types) : p.type ? [p.type] : null;
    if (types) items = items.filter((e) => types.some((t) => (t.endsWith('*') ? e.type.startsWith(t.slice(0, -1)) : e.type === t)));
    const c = p.created;
    if (c && typeof c === 'object') {
      if (c.gte !== undefined) items = items.filter((e) => e.created >= Number(c.gte));
      if (c.gt !== undefined) items = items.filter((e) => e.created > Number(c.gt));
      if (c.lte !== undefined) items = items.filter((e) => e.created <= Number(c.lte));
      if (c.lt !== undefined) items = items.filter((e) => e.created < Number(c.lt));
    } else if (c !== undefined) items = items.filter((e) => e.created === Number(c));
    return this.list(items, { ...p, url: '/v1/events' });
  }

  /** Everything, for tests (copies). */
  snapshot() {
    const vals = (m) => clone([...m.values()]);
    return {
      now: this.now(),
      offsetMs: this.offsetMs,
      customers: vals(this.customers),
      products: vals(this.products),
      prices: vals(this.prices),
      portalConfigurations: vals(this.portalConfigs),
      checkoutSessions: vals(this.checkoutSessions),
      portalSessions: vals(this.portalSessions),
      subscriptions: vals(this.subscriptions),
      invoices: vals(this.invoices),
      charges: vals(this.charges),
      disputes: vals(this.disputes),
      events: clone(this.events),
      cards: Object.fromEntries(this.cards),
    };
  }
}
