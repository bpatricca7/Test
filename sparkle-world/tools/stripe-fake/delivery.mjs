// Webhook delivery for the Stripe fake (docs/ACCOUNTS.md §12.3): every event is signed exactly the
// way Stripe signs it (the SDK's generateTestHeaderString: `t=<now>,v1=HMAC-SHA256(secret,
// "<t>.<payload>")`, with the real time of each attempt), so the app's real constructEvent path
// runs. The payload is Stripe's pretty-printed JSON.
//
// Modes (for the batches made after the call; a batch = the events of one API call, page tap or
// clock step):
//   normal     in order, one after the other
//   duplicate  every event twice
//   reverse    the batch in reverse order (out of order)
//   delay      the batch after `delayMs` (late)
//   drop       never delivered (the reconcile path); redeliver(id) can send one later
// A non-2xx answer (or no answer) is retried after `retryDelays` (short, for tests; Stripe itself
// retries for about 3 days).

import http from 'node:http';
import https from 'node:https';
import Stripe from 'stripe';

export const MODES = ['normal', 'duplicate', 'reverse', 'delay', 'drop'];

export class Delivery {
  constructor({ url = null, secret, retryDelays = [100, 300, 1000, 2000, 4000], delayMs = 400, log = () => {} }) {
    this.url = url;
    this.secret = secret;
    this.retryDelays = retryDelays;
    this.delayMs = delayMs;
    this.log = log;
    this.mode = 'normal';
    this.chain = Promise.resolve();
    this.busy = 0;
    this.attempts = []; // { event, type, attempt, status, at, mode }
    this.dropped = []; // event ids
    this.closed = false;
  }

  setMode(mode, { delayMs } = {}) {
    if (!MODES.includes(mode)) throw new Error(`delivery mode must be one of ${MODES.join(', ')}`);
    this.mode = mode;
    if (delayMs !== undefined) this.delayMs = delayMs;
  }

  /** Queue one batch of events (in the order they were made). */
  send(events) {
    if (!events || !events.length) return;
    const mode = this.mode;
    if (mode === 'drop' || !this.url) {
      for (const e of events) {
        this.dropped.push(e.id);
        this.attempts.push({ event: e.id, type: e.type, attempt: 0, status: mode === 'drop' ? 'dropped' : 'no-endpoint', at: Date.now(), mode });
      }
      return;
    }
    let list = [...events];
    if (mode === 'reverse') list.reverse();
    if (mode === 'duplicate') list = list.flatMap((e) => [e, e]);
    const wait = mode === 'delay' ? this.delayMs : 0;
    this.busy++;
    this.chain = this.chain
      .then(async () => {
        if (wait) await sleep(wait);
        for (const e of list) await this.deliver(e, mode);
      })
      .catch(() => {})
      .finally(() => {
        this.busy--;
      });
  }

  /** Send one event (again) now, with retries. */
  async deliver(event, mode = 'normal') {
    for (let attempt = 1; attempt <= this.retryDelays.length + 1 && !this.closed; attempt++) {
      const status = await this.post(event);
      this.attempts.push({ event: event.id, type: event.type, attempt, status, at: Date.now(), mode });
      if (status >= 200 && status < 300) return status;
      if (attempt <= this.retryDelays.length) await sleep(this.retryDelays[attempt - 1]);
    }
    return 0;
  }

  /** Queue a redelivery of an event that was made before (dropped, or to deliver it twice). */
  redeliver(event) {
    this.busy++;
    this.chain = this.chain.then(() => this.deliver(event, 'redeliver')).catch(() => {}).finally(() => this.busy--);
  }

  /** The signed request, like Stripe's: returns the HTTP status, or 0 when nothing answered. */
  post(event) {
    const payload = JSON.stringify(event, null, 2);
    const header = Stripe.webhooks.generateTestHeaderString({ payload, secret: this.secret });
    return postRaw(this.url, payload, header);
  }

  /** Resolves when every queued delivery (retries and delays included) is done. */
  async idle() {
    for (let i = 0; i < 1000; i++) {
      const c = this.chain;
      await c;
      await new Promise((r) => setImmediate(r));
      if (this.busy === 0 && c === this.chain) return;
    }
  }
}

export function postRaw(url, payload, signature, extraHeaders = {}) {
  return new Promise((resolve) => {
    let u;
    try {
      u = new URL(url);
    } catch {
      resolve(0);
      return;
    }
    const mod = u.protocol === 'https:' ? https : http;
    const body = Buffer.from(payload);
    const req = mod.request(
      {
        method: 'POST',
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Length': body.length,
          'User-Agent': 'Stripe/1.0 (+https://stripe.com/docs/webhooks)',
          'Cache-Control': 'no-cache',
          Accept: '*/*; q=0.5, application/xml',
          ...(signature ? { 'Stripe-Signature': signature } : {}),
          ...extraHeaders,
        },
        timeout: 15000,
      },
      (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode || 0));
        res.on('error', () => resolve(res.statusCode || 0));
      },
    );
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(0));
    req.end(body);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
