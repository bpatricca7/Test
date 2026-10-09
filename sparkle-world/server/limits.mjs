// Rate limits and client addresses, shared by the relay (server.mjs) and the accounts API
// (docs/ACCOUNTS.md §4.8). No dependencies; nothing here is ever logged.
//
// - Bucket: one token bucket (rate tokens per second, up to `burst`).
// - isInternalIp / normalizeIp / clientIpOf / addressKey: which address a request counts as
//   (docs/MULTIPLAYER.md Addendum B item 4). server.mjs re-exports them for the tests.
// - netKey: the network a request counts as (IPv6 by /48), for the accounts' per-network limits.
// - KeyedLimiter: many buckets keyed by a string (an addressKey, an email key, a family id,
//   a player id, a session hash, or '*' for "everyone"); buckets that are full again are
//   forgotten, so memory stays small.
// - Limits: named KeyedLimiters made on first use from a spec, for the /api router and handlers.

import { isIP } from 'node:net';

/** A token bucket: `rate` tokens per second, at most `burst`, full at the start. */
export class Bucket {
  constructor(rate, burst, now = Date.now) {
    this.rate = rate;
    this.burst = burst;
    this.tokens = burst;
    this.now = now;
    this.at = now();
  }

  _fill() {
    const t = this.now();
    this.tokens = Math.min(this.burst, this.tokens + (Math.max(0, t - this.at) * this.rate) / 1000);
    this.at = t;
  }

  take(n = 1) {
    this._fill();
    if (this.tokens < n) return false;
    this.tokens -= n;
    return true;
  }

  /** Milliseconds until `n` tokens are there (0 when they are now). */
  waitMs(n = 1) {
    this._fill();
    if (this.tokens >= n) return 0;
    return this.rate > 0 ? Math.ceil(((n - this.tokens) * 1000) / this.rate) : Infinity;
  }

  /** Full again (nothing to remember about this key). */
  idle() {
    return this.tokens + ((this.now() - this.at) * this.rate) / 1000 >= this.burst;
  }
}

/**
 * Loopback, private, link-local and carrier-grade NAT (100.64.0.0/10) addresses: a proxy hop,
 * not a client. With proxyPeer (only for the socket peer: is this connection from a proxy?)
 * all of 100.0.0.0/8 counts too, because Railway says its edge and internal proxies always
 * connect from there. Inside X-Forwarded-For only 100.64.0.0/10 is skipped: the rest of 100/8
 * is ordinary public space (homes on some ISPs), and skipping it would let a client there
 * write any address it liked in front of the one the proxy appended.
 */
export function isInternalIp(ip, { proxyPeer = false } = {}) {
  if (typeof ip !== 'string') return true;
  const v4 = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(ip);
  if (v4) {
    const [a, b] = [+v4[1], +v4[2]];
    return a === 10 || a === 127 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
      (a === 169 && b === 254) || (proxyPeer ? a === 100 : a === 100 && b >= 64 && b <= 127);
  }
  const l = ip.toLowerCase();
  return l === '::1' || l === '::' || l.startsWith('fc') || l.startsWith('fd') || l.startsWith('fe80');
}

/** '::ffff:1.2.3.4' -> '1.2.3.4'; strips ports and brackets; '' when not an IP. */
export function normalizeIp(s) {
  let t = String(s || '').trim();
  if (t.startsWith('[')) t = t.slice(1, t.indexOf(']') > 0 ? t.indexOf(']') : undefined);
  else if (/^\d+\.\d+\.\d+\.\d+:\d+$/.test(t)) t = t.slice(0, t.lastIndexOf(':'));
  if (/^::ffff:\d+\.\d+\.\d+\.\d+$/i.test(t)) t = t.slice(7);
  return isIP(t) ? t : '';
}

/**
 * The address to count limits by. Without a trusted proxy (or when the socket peer is itself
 * a public address) it is the socket peer. Behind a proxy (Railway's edge connects from
 * 100.0.0.0/8) it is the right-most public entry of X-Forwarded-For: proxies append what they
 * saw, so entries a client wrote itself sit further left and are never reached. Only
 * internal entries: the socket peer.
 */
export function clientIpOf(remoteAddress, xff, trustProxy = true) {
  const sock = normalizeIp(remoteAddress) || String(remoteAddress || '?');
  if (!trustProxy || !isInternalIp(sock, { proxyPeer: true })) return sock;
  const list = (Array.isArray(xff) ? xff.join(',') : typeof xff === 'string' ? xff : '').split(',');
  for (let k = list.length - 1; k >= 0; k--) {
    const ip = normalizeIp(list[k]);
    if (!ip) continue;
    if (!isInternalIp(ip)) return ip;
  }
  return sock;
}

/**
 * The key the per-address limits count by: IPv4 as is, IPv6 by its /64 network (a home or a
 * phone gets a whole /64, so counting single IPv6 addresses would let one device take as many
 * as it likes). Anything else (not an IP) as is.
 */
export function addressKey(ip) {
  let a = String(ip || '?').trim();
  if (isIP(a) !== 6) return a;
  const zone = a.indexOf('%');
  if (zone >= 0) a = a.slice(0, zone);
  const [head, tail = ''] = a.split('::');
  const hs = head ? head.split(':') : [];
  const ts = a.includes('::') ? (tail ? tail.split(':') : []) : [];
  const groups = a.includes('::') ? [...hs, ...Array(Math.max(0, 8 - hs.length - ts.length)).fill('0'), ...ts] : hs;
  return groups.slice(0, 4).map((g) => (g || '0').toLowerCase().replace(/^0+(?=.)/, '')).join(':') + '::/64';
}

/**
 * The key the per-network limits count by: IPv6 by its /48 (a home or a small company gets a
 * /48 or a /56, so one /48 holds every /64 a single allocation can use), IPv4 as is (one
 * address is already one home). Anything else (not an IP) as is. docs/ACCOUNTS.md §4.8: the
 * sign-in and pairing limits for everyone sit behind these, so one allocation cannot use them up.
 */
export function netKey(ip) {
  const a = String(ip || '?').trim();
  if (isIP(a.split('%')[0]) !== 6) return a;
  const k = addressKey(a); // 'g1:g2:g3:g4::/64'
  return k.split(':').slice(0, 3).join(':') + '::/48';
}

/**
 * Token buckets keyed by a string. `count` tokens every `perMs` milliseconds, at most `burst`
 * at once (default `count`). Buckets that are full again are forgotten (checked at most once
 * a minute, on use), so an idle limiter holds nothing.
 *
 *   const perAddress = new KeyedLimiter({ count: 10, perMs: 3600e3, burst: 5 });
 *   if (!perAddress.take(addressKey(ip))) → 429 with Retry-After: perAddress.retryAfter(key)
 */
export class KeyedLimiter {
  constructor({ count, perMs, burst = count, now = Date.now, sweepMs = 60000 } = {}) {
    if (!(count > 0) || !(perMs > 0) || !(burst >= 1)) throw new Error('KeyedLimiter: count, perMs and burst must be positive');
    this.rate = (count * 1000) / perMs; // tokens per second (Bucket's unit)
    this.burst = burst;
    this.now = now;
    this.sweepMs = sweepMs;
    this.buckets = new Map();
    this.sweptAt = now();
  }

  _bucket(key) {
    let b = this.buckets.get(key);
    if (!b) this.buckets.set(key, (b = new Bucket(this.rate, this.burst, this.now)));
    return b;
  }

  /** Take `n` tokens for `key`; false when there are not enough (nothing is taken then). */
  take(key, n = 1) {
    if (this.now() - this.sweptAt > this.sweepMs) this.sweep();
    return this._bucket(String(key)).take(n);
  }

  /** Whole seconds until `key` has `n` tokens again (for Retry-After; at least 1). */
  retryAfter(key, n = 1) {
    const b = this.buckets.get(String(key));
    if (!b) return 1;
    return Math.max(1, Math.ceil(b.waitMs(n) / 1000));
  }

  /** Forget buckets that are full again. */
  sweep() {
    this.sweptAt = this.now();
    for (const [k, b] of this.buckets) if (b.idle()) this.buckets.delete(k);
  }

  get size() {
    return this.buckets.size;
  }
}

/**
 * Named limiters, made on first use from a spec: `limits.check({ name, count, perMs, burst },
 * key)` → `{ ok: true }` or `{ ok: false, retryAfter }` (seconds). The same name always means
 * the same limiter (the first spec seen for a name wins).
 */
export class Limits {
  constructor({ now = Date.now } = {}) {
    this.now = now;
    this.byName = new Map();
  }

  limiter(spec) {
    let l = this.byName.get(spec.name);
    if (!l) this.byName.set(spec.name, (l = new KeyedLimiter({ ...spec, now: this.now })));
    return l;
  }

  check(spec, key, n = 1) {
    const l = this.limiter(spec);
    if (l.take(key, n)) return { ok: true };
    return { ok: false, retryAfter: l.retryAfter(key, n) };
  }

  sweep() {
    for (const l of this.byName.values()) l.sweep();
  }
}
