// The Stripe fake (docs/ACCOUNTS.md §12.3, owner B): a local HTTP server that speaks the part of
// Stripe's API this app uses, so the real `stripe` SDK (pointed at it with STRIPE_API_BASE) and the
// app's real webhook code run in every test with no network access to Stripe.
//
//   import { startStripeFake } from './stripe-fake/server.mjs';
//   const fake = await startStripeFake({ webhookUrl, webhookSecret, publicUrl });
//   fake.url                       // STRIPE_API_BASE
//   fake.webhookSecret, fake.priceId, fake.productId
//   fake.setWebhook(url, secret?)  // when the app's address is known only after the fake started
//   await fake.pay(sessionIdOrUrl, { outcome: 'ok'|'decline'|'3ds'|'approve', country: 'US' })
//   await fake.portal(portalSessionIdOrUrl, 'cancel_at_period_end'|'resume'|'cancel_now'|'update_card'|'card_fails')
//   await fake.advance(days)       // the fake's clock: trials end, periods renew, retries, cancels
//   fake.delivery('normal'|'duplicate'|'reverse'|'delay'|'drop', { delayMs })
//   fake.card(customerId, 'ok'|'fail')
//   await fake.dispute({ customer })
//   await fake.redeliver(eventId)
//   await fake.idle()              // every webhook delivery (with retries) done
//   fake.state()                   // everything, copied; fake.events(type?), fake.deliveries(), fake.requests(filter?)
//   fake.failNext(count, { status, path })   // the next API calls answer 5xx (Stripe outage)
//   await fake.close()
// Every waiting call (pay, portal, advance, dispute, redeliver) resolves after the webhooks it
// caused were delivered (pass { wait: false } not to wait).
//
// It checks what the app relies on and answers Stripe's 400 when it is missing: the pinned
// Stripe-Version header, a test key, the Checkout parameters of §6.2, Idempotency-Key replay (the
// same key and body → the same answer; another body → 400 idempotency_error).
//
// Hosted pages (for the end-to-end test): /c/:id Checkout with Pay (4242), Declined, Needs 3-D
// Secure and a country menu; /p/:id the Portal with Cancel at period end, Resume, Cancel now,
// Update card, Card starts failing.
//
// Control over HTTP (when it runs as its own process): POST /__fake/advance {days}, /__fake/delivery
// {mode, delayMs}, /__fake/card {customer, outcome}, /__fake/webhook {url, secret}, /__fake/dispute
// {customer}, /__fake/redeliver {event}, /__fake/fail {count, status, path}; GET /__fake/state,
// /__fake/idle.
//
// As a program: node tools/stripe-fake/server.mjs [--port 12111] [--webhook-url URL]
//   [--webhook-secret whsec_…] [--public-url URL] prints STRIPE_API_BASE, STRIPE_WEBHOOK_SECRET and
//   STRIPE_PRICE_ID for the server and keeps running until Ctrl+C.

import http from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { StripeEngine, FakeError, API_VERSION, invalid, rid } from './engine.mjs';
import { Delivery } from './delivery.mjs';
import { parseForm } from './form.mjs';
import { checkoutPage, portalPage, plainPage } from './pages.mjs';

export { API_VERSION };

const BODY_MAX = 256 * 1024;

export async function startStripeFake({
  webhookUrl = null,
  webhookSecret = 'whsec_fake' + randomBytes(16).toString('hex'),
  publicUrl = null,
  port = 0,
  host = '127.0.0.1',
  apiKeys = null, // null = any sk_test_/rk_test_ key; else only these
  seed = true,
  taxRate = 0.06,
  retryDelays,
  delayMs,
  log = () => {},
} = {}) {
  const engine = new StripeEngine({ publicUrl: publicUrl || 'http://placeholder', seed, taxRate });
  const delivery = new Delivery({ url: webhookUrl, secret: webhookSecret, retryDelays, delayMs, log });
  const requests = []; // { method, path, params, idempotencyKey, stripeVersion, status, at }
  const idem = new Map(); // key -> { fingerprint, status, body }
  const faults = []; // { status, path, left }

  const flush = () => delivery.send(engine.takeEvents());

  const server = http.createServer((req, res) => {
    handle(req, res).catch((err) => {
      log(`stripe-fake: ${err && err.stack ? err.stack : err}`);
      if (!res.headersSent) sendJson(res, 500, { error: { type: 'api_error', message: 'fake error' } });
      else res.destroy();
    });
  });

  async function handle(req, res) {
    const url = new URL(req.url, 'http://fake');
    const p = url.pathname;
    if (p.startsWith('/v1/')) return api(req, res, url);
    if (p.startsWith('/c/')) return checkoutRoute(req, res, url);
    if (p.startsWith('/p/')) return portalRoute(req, res, url);
    if (p.startsWith('/i/')) return sendHtml(res, 200, plainPage('Invoice', 'A test invoice of the Stripe fake.'));
    if (p.startsWith('/__fake/')) return control(req, res, url);
    sendJson(res, 404, { error: { type: 'invalid_request_error', message: `Unrecognized request URL (${req.method}: ${p}).` } });
  }

  // ---- the API ----

  async function api(req, res, url) {
    const method = req.method;
    const raw = method === 'POST' ? await readBody(req) : '';
    const params = method === 'POST' ? parseForm(raw) : parseForm(url.search.slice(1));
    const key = req.headers['idempotency-key'] || null;
    const entry = { method, path: url.pathname, params, idempotencyKey: key, stripeVersion: req.headers['stripe-version'] || null, status: 0, at: engine.now() };
    requests.push(entry);
    const answer = (status, body, headers = {}) => {
      entry.status = status;
      sendJson(res, status, body, { 'Request-Id': 'req_' + rid(14), 'Stripe-Version': API_VERSION, ...headers });
    };

    const auth = String(req.headers.authorization || '');
    const m = /^Bearer\s+((?:sk|rk)_test_[A-Za-z0-9_]+)$/.exec(auth);
    if (!m || (apiKeys && !apiKeys.includes(m[1]))) {
      return answer(401, { error: { type: 'invalid_request_error', message: 'Invalid API Key provided (the fake takes sk_test_/rk_test_ keys only).' } });
    }
    if (entry.stripeVersion !== API_VERSION) {
      return answer(400, { error: { type: 'invalid_request_error', message: `The fake speaks only Stripe-Version ${API_VERSION} (got ${entry.stripeVersion || 'none'}).` } });
    }
    const fault = faults.find((f) => f.left > 0 && (!f.path || url.pathname.startsWith(f.path)));
    if (fault) {
      fault.left--;
      return answer(fault.status, { error: { type: 'api_error', message: 'The Stripe fake is having an outage (failNext).' } });
    }
    let fingerprint = null;
    if (method === 'POST' && key) {
      fingerprint = createHash('sha256').update(method + ' ' + url.pathname + '\n' + raw).digest('hex');
      const seen = idem.get(key);
      if (seen) {
        if (seen.fingerprint !== fingerprint) {
          return answer(400, {
            error: {
              type: 'idempotency_error',
              message: `Keys for idempotent requests can only be used with the same parameters they were first used with. Try using a key other than '${key}' if you meant to execute a different request.`,
            },
          });
        }
        return answer(seen.status, seen.body, { 'Idempotent-Replayed': 'true', 'Idempotency-Key': key });
      }
    }
    engine.requestId = 'req_' + rid(14);
    engine.idempotencyKey = key;
    let status = 200;
    let body;
    try {
      body = route(method, url.pathname, params);
    } catch (err) {
      if (!(err instanceof FakeError)) throw err;
      engine.takeEvents(); // a refused call makes no events
      return answer(err.status, { error: { ...err.error, request_log_url: null } }, err.headers);
    } finally {
      engine.requestId = null;
      engine.idempotencyKey = null;
    }
    if (fingerprint) idem.set(key, { fingerprint, status, body });
    flush();
    return answer(status, body, key ? { 'Idempotency-Key': key } : {});
  }

  function route(method, p, q) {
    const e = engine;
    const exp = (obj) => e.expand(obj, q.expand);
    const seg = p.split('/').slice(2); // ['customers', 'cus_…', …]
    const [a, b, c, d] = seg;
    const is = (m, n) => method === m && seg.length === n;
    switch (a) {
      case 'customers':
        if (is('POST', 1)) return exp(e.createCustomer(q));
        if (is('GET', 2)) return exp(e.customer(b));
        if (is('POST', 2)) return exp(e.updateCustomer(b, q));
        if (is('DELETE', 2)) return e.deleteCustomer(b);
        break;
      case 'products':
        if (is('POST', 1)) return exp(e.createProduct(q));
        if (is('GET', 1)) {
          let items = [...e.products.values()];
          if (q.active !== undefined) items = items.filter((x) => String(x.active) === String(q.active));
          if (q.ids) items = items.filter((x) => [].concat(q.ids).includes(x.id));
          return exp(e.list(items, { ...q, url: '/v1/products' }));
        }
        if (is('GET', 2)) {
          const prod = e.products.get(b);
          if (!prod) throw new FakeError(404, { type: 'invalid_request_error', code: 'resource_missing', message: `No such product: '${b}'`, param: 'id' });
          return exp(prod);
        }
        if (is('POST', 2)) return exp(e.updateProduct(b, q));
        break;
      case 'prices':
        if (is('POST', 1)) return exp(e.createPrice(q));
        if (is('GET', 1)) return exp(e.listPrices(q));
        if (is('GET', 2)) {
          const price = e.prices.get(b);
          if (!price) throw new FakeError(404, { type: 'invalid_request_error', code: 'resource_missing', message: `No such price: '${b}'`, param: 'id' });
          return exp(price);
        }
        if (is('POST', 2)) return exp(e.updatePrice(b, q));
        break;
      case 'billing_portal':
        if (b === 'configurations') {
          if (method === 'POST' && seg.length === 2) return exp(e.createPortalConfig(q));
          if (method === 'GET' && seg.length === 2) {
            let items = [...e.portalConfigs.values()];
            if (q.is_default !== undefined) items = items.filter((x) => String(x.is_default) === String(q.is_default));
            if (q.active !== undefined) items = items.filter((x) => String(x.active) === String(q.active));
            return exp(e.list(items, { ...q, url: '/v1/billing_portal/configurations' }));
          }
          if (method === 'GET' && seg.length === 3) {
            const cfg = e.portalConfigs.get(c);
            if (!cfg) throw new FakeError(404, { type: 'invalid_request_error', code: 'resource_missing', message: `No such configuration: '${c}'`, param: 'configuration' });
            return exp(cfg);
          }
          if (method === 'POST' && seg.length === 3) return exp(e.updatePortalConfig(c, q));
        }
        if (b === 'sessions' && method === 'POST' && seg.length === 2) return exp(e.createPortalSession(q));
        break;
      case 'checkout':
        if (b === 'sessions') {
          if (method === 'POST' && seg.length === 2) return exp(e.createCheckoutSession(q));
          if (method === 'GET' && seg.length === 2) return exp(e.listCheckoutSessions(q));
          if (method === 'GET' && seg.length === 3) return exp(e.checkoutSession(c));
          if (method === 'POST' && seg.length === 4 && d === 'expire') return exp(e.expireCheckoutSession(c));
        }
        break;
      case 'subscriptions':
        if (is('GET', 1)) return exp(e.listSubscriptions(q));
        if (is('GET', 2)) return exp(e.subscription(b));
        if (is('POST', 2)) return exp(e.updateSubscription(b, q));
        if (is('DELETE', 2)) return exp(e.cancelSubscription(b, q));
        break;
      case 'invoices':
        if (is('GET', 1)) return exp(e.listInvoices(q));
        if (is('GET', 2)) return exp(e.invoice(b));
        break;
      case 'charges':
        if (is('GET', 2)) return exp(e.charge(b));
        break;
      case 'events':
        if (is('GET', 1)) return exp(e.listEvents(q));
        if (is('GET', 2)) {
          const ev = e.lookup(b);
          if (!ev) throw new FakeError(404, { type: 'invalid_request_error', code: 'resource_missing', message: `No such event: '${b}'`, param: 'id' });
          return exp(ev);
        }
        break;
      default:
        break;
    }
    throw new FakeError(404, { type: 'invalid_request_error', message: `Unrecognized request URL (${method}: ${p}). The Stripe fake does not speak it.` });
  }

  // ---- hosted pages ----

  async function checkoutRoute(req, res, url) {
    const id = decodeURIComponent(url.pathname.slice(3));
    const s = engine.checkoutSessions.get(id);
    if (req.method === 'GET') return sendHtml(res, s ? 200 : 404, checkoutPage(engine, s));
    if (req.method !== 'POST' || !s) return sendHtml(res, 404, checkoutPage(engine, null));
    const form = parseForm(await readBody(req));
    let r;
    try {
      r = engine.completeCheckout(id, { outcome: form.outcome || 'ok', country: form.country || 'US' });
    } catch (err) {
      if (!(err instanceof FakeError)) throw err;
      return sendHtml(res, 400, checkoutPage(engine, s, { message: err.error.message }));
    } finally {
      flush();
    }
    if (r.status === 'complete') return redirect(res, r.redirect);
    const message = r.status === 'declined' ? 'Your card was declined.' : '';
    return sendHtml(res, 200, checkoutPage(engine, s, { message }));
  }

  async function portalRoute(req, res, url) {
    const id = decodeURIComponent(url.pathname.slice(3));
    const ps = engine.portalSessions.get(id);
    if (req.method === 'GET') return sendHtml(res, ps ? 200 : 404, portalPage(engine, ps));
    if (req.method !== 'POST' || !ps) return sendHtml(res, 404, portalPage(engine, null));
    const form = parseForm(await readBody(req));
    let message = 'Done.';
    try {
      engine.portalAction(id, form.action);
    } catch (err) {
      if (!(err instanceof FakeError)) throw err;
      message = err.error.message;
    } finally {
      flush();
    }
    return sendHtml(res, 200, portalPage(engine, ps, { message }));
  }

  // ---- control (for a fake running as its own process) ----

  async function control(req, res, url) {
    const what = url.pathname.slice('/__fake/'.length);
    let body = {};
    if (req.method === 'POST') {
      try {
        body = JSON.parse((await readBody(req)) || '{}');
      } catch {
        return sendJson(res, 400, { error: 'bad json' });
      }
    }
    try {
      switch (`${req.method} ${what}`) {
        case 'POST advance':
          await api_.advance(Number(body.days) || 0);
          return sendJson(res, 200, { now: engine.now() });
        case 'POST delivery':
          api_.delivery(body.mode, { delayMs: body.delayMs });
          return sendJson(res, 200, { mode: delivery.mode });
        case 'POST card':
          api_.card(body.customer, body.outcome);
          return sendJson(res, 200, { ok: true });
        case 'POST webhook':
          api_.setWebhook(body.url, body.secret);
          return sendJson(res, 200, { ok: true, secret: delivery.secret });
        case 'POST dispute':
          return sendJson(res, 200, await api_.dispute(body));
        case 'POST redeliver':
          await api_.redeliver(body.event);
          return sendJson(res, 200, { ok: true });
        case 'POST fail':
          api_.failNext(Number(body.count) || 1, { status: body.status, path: body.path });
          return sendJson(res, 200, { ok: true });
        case 'GET state':
          return sendJson(res, 200, api_.state());
        case 'GET idle':
          await api_.idle();
          return sendJson(res, 200, { ok: true });
        default:
          return sendJson(res, 404, { error: 'unknown control ' + what });
      }
    } catch (err) {
      return sendJson(res, 400, { error: err instanceof FakeError ? err.error.message : String(err && err.message) });
    }
  }

  // ---- start ----

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
  const base = `http://${host}:${server.address().port}`;
  engine.publicUrl = publicUrl || base;

  const idOf = (x, prefix) => {
    const s = String(x || '');
    const m = new RegExp(`(${prefix}[A-Za-z0-9_]+)`).exec(s);
    return m ? m[1] : s;
  };
  const waited = async (fn, wait = true) => {
    let r;
    try {
      r = fn();
    } finally {
      flush();
    }
    if (wait) await delivery.idle();
    return r;
  };

  let clockHook = null;
  /** The clock: one step at a time, each step's webhooks delivered before the next (like real time). */
  async function advanceMs(ms, { wait = true } = {}) {
    if (!(ms >= 0)) throw new Error('advance: a positive time');
    const target = engine.now() + ms;
    for (let guard = 0; guard < 100000; guard++) {
      const next = engine.nextDue(target);
      if (!next) break;
      engine.setNow(next.at);
      if (clockHook) await clockHook(engine.now());
      try {
        next.run();
      } finally {
        flush();
      }
      if (wait) await delivery.idle();
    }
    engine.setNow(target);
    if (clockHook) await clockHook(engine.now());
  }

  const api_ = {
    url: base,
    webhookSecret,
    priceId: engine.seeded?.priceId ?? null,
    productId: engine.seeded?.productId ?? null,
    engine,
    setWebhook(url, secret) {
      delivery.url = url || null;
      if (secret) delivery.secret = secret;
      if (secret) api_.webhookSecret = secret;
    },
    now: () => engine.now(),
    pay: (session, { outcome = 'ok', country = 'US', wait = true } = {}) => waited(() => engine.completeCheckout(idOf(session, 'cs_'), { outcome, country }), wait),
    portal: (ps, action, { wait = true } = {}) => waited(() => engine.portalAction(idOf(ps, 'bps_'), action), wait),
    advance: (days, o) => advanceMs(days * 86400e3, o),
    advanceMs,
    /** fn(nowMs) before every clock step, so the app's clock can follow (clock.set(now - Date.now())). */
    onClock(fn) {
      clockHook = fn || null;
    },
    dispute: (o = {}, { wait = true } = {}) => waited(() => engine.dispute(o), wait),
    async redeliver(eventId) {
      const ev = engine.events.find((x) => x.id === eventId);
      if (!ev) throw invalid('no such event ' + eventId);
      delivery.redeliver(ev);
      await delivery.idle();
    },
    delivery(mode, opts) {
      delivery.setMode(mode, opts);
    },
    card(customer, outcome) {
      engine.card(customer, outcome);
    },
    failNext(count = 1, { status = 500, path: p = null } = {}) {
      faults.push({ status: status || 500, path: p, left: count });
    },
    idle: () => delivery.idle(),
    state: () => ({ ...engine.snapshot(), deliveries: [...delivery.attempts], mode: delivery.mode }),
    events: (type) => engine.events.filter((e) => !type || e.type === type).map((e) => JSON.parse(JSON.stringify(e))),
    deliveries: () => [...delivery.attempts],
    requests: (filter) => requests.filter((r) => !filter || (typeof filter === 'function' ? filter(r) : r.path.startsWith(filter))),
    async close() {
      delivery.closed = true;
      await new Promise((r) => server.close(() => r()));
      server.closeAllConnections?.();
    },
  };
  return api_;
}

// ---- small HTTP helpers ----

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let n = 0;
    req.on('data', (c) => {
      n += c.length;
      if (n > BODY_MAX) {
        reject(new Error('body too big'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sendJson(res, status, body, headers = {}) {
  const text = JSON.stringify(body, null, 2);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(text), 'Cache-Control': 'no-cache, no-store', ...headers });
  res.end(text);
}

function sendHtml(res, status, html) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(html);
}

function redirect(res, location) {
  res.writeHead(303, { Location: location, 'Cache-Control': 'no-store' });
  res.end();
}

// ---- as a program ----

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const arg = (name, def = null) => {
    const i = process.argv.indexOf('--' + name);
    return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
  };
  const fake = await startStripeFake({
    port: Number(arg('port', 12111)),
    host: arg('host', '127.0.0.1'),
    webhookUrl: arg('webhook-url'),
    webhookSecret: arg('webhook-secret') || undefined,
    publicUrl: arg('public-url'),
    log: (l) => console.error(l),
  });
  console.log(`STRIPE_API_BASE=${fake.url}`);
  console.log(`STRIPE_WEBHOOK_SECRET=${fake.webhookSecret}`);
  console.log(`STRIPE_PRICE_ID=${fake.priceId}`);
  console.log(`(the Stripe fake; webhooks to ${arg('webhook-url') || '(none yet: POST /__fake/webhook {url})'}; Ctrl+C stops it)`);
  const stop = async () => {
    await fake.close();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
