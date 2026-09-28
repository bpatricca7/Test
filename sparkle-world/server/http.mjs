// The /api plumbing (docs/ACCOUNTS.md §4.7, §4.8, §5.1, §15.2): the router, the body reader
// (limits, gzip), cookies, the CSRF rules, "who may call", rate limits and JSON answers.
// Route modules (auth, family, saves, billing, test hooks) only describe routes:
//
//   export function routes(ctx) → [{
//     method: 'GET'|'POST'|'PUT'|'PATCH'|'DELETE',
//     path: '/api/players/:pid/worlds/:wid',            // :name segments become x.params.name
//     who: 'anyone'|'session'|'parent'|'parent+check'|'parent+check5'|'player'|'stripe'|'test',
//     body: { kind: 'json'|'raw'|'world', max },         // default { kind: 'json', max: 16 KB }
//     limit: [{ name, count, perMs, burst?, key: 'ip'|'session'|'family'|'player'|'global' }],
//     handler: async (req, x) → { status?, json?, body?, stream?, headers?, cookies? },
//   }]
//
//   x = { params, query, body, bodyBytes, bodyGzip, cookies, session, sessionError, family,
//         player, ip, now, req, url }
//     body       parsed JSON ('json', 'world'), or the raw Buffer ('raw')
//     bodyBytes  the (uncompressed) bytes of the body; bodyGzip: the gzip bytes as received, or null
//     session    { hash, kind: 'parent'|'device', familyId, lockPlayer, elevatedUntil (ms|null),
//                  elevatedAt (ms|null), … } from ctx.sessions.fromRequest(), or null
//     family     the families row of the session's family (ctx.family.load), or null
//     player     the players row of :pid ('player' routes), checked against the session
//     ip         addressKey of the client (IPv6 by /64), for limits only; never log or store it
//     now        the app clock in ms (ctx.clock.now()); pass new Date(x.now) to SQL
//
// A handler answers with an object, or throws `new HttpError(status, code, extra?)` (or
// `httpError(...)`): the answer is then `{ error: code, ...extra }`. Anything else thrown is
// logged by its name only and answers 503 { error: 'unavailable' }.
//   json:    any JSON value (Content-Type application/json, Cache-Control no-store)
//   body:    a Buffer or string with your own headers['Content-Type'] (pictures, gzip worlds)
//   stream:  a Readable or async iterable of Buffers/strings (exports)
//   cookies: [{ name: 'sess'|'login', value: string|null (null clears), maxAge: seconds }]
//   headers: extra headers (ETag, Cache-Control, Content-Disposition, Retry-After, …)
//
// server.mjs has already set the common security headers and Cross-Origin-Resource-Policy.

import { gunzipSync } from 'node:zlib';
import { Readable } from 'node:stream';
import { addressKey, clientIpOf } from './limits.mjs';

export const JSON_MAX = 16 * 1024;
export const RAW_MAX = 1024 * 1024;
const CHECK_MS = 5 * 60 * 1000; // parent+check5: an email check within the last 5 minutes
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const DEFAULT_LIMITS = Object.freeze({
  ip: Object.freeze({ name: 'api-ip', count: 120, perMs: 60000, burst: 60 }),
  session: Object.freeze({ name: 'api-session', count: 240, perMs: 60000, burst: 240 }),
});

export class HttpError extends Error {
  constructor(status, code, extra = {}, headers = {}) {
    super(`${status} ${code}`);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.extra = extra;
    this.headers = headers;
  }
}

export const httpError = (status, code, extra, headers) => new HttpError(status, code, extra, headers);

export const isUuid = (s) => typeof s === 'string' && UUID_RE.test(s);

// ---------------------------------------------------------------------------------------------
// cookies

/** `a=1; b=2` → { a: '1', b: '2' } (the first of a repeated name wins). */
export function parseCookies(header) {
  const out = Object.create(null);
  if (typeof header !== 'string' || !header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i <= 0) continue;
    const k = part.slice(0, i).trim();
    if (!k || k in out) continue;
    let v = part.slice(i + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    out[k] = v;
  }
  return out;
}

/**
 * One Set-Cookie value for the session ('sess') or sign-in attempt ('login') cookie, with the
 * attributes of §4.2 (`__Host-`, Secure, HttpOnly, SameSite=Lax, Path=/; plain names and no
 * Secure over http://localhost). value null → cleared (Max-Age=0).
 */
export function serializeCookie(cfg, which, value, maxAge) {
  const name = cfg.cookies[which];
  if (!name) throw new Error('unknown cookie ' + which);
  if (value !== null && !/^[A-Za-z0-9_-]{1,200}$/.test(value)) throw new Error('cookie values are base64url');
  const parts = [`${name}=${value === null ? '' : value}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${value === null ? 0 : Math.max(0, Math.floor(maxAge))}`];
  if (cfg.cookies.secure) parts.push('Secure');
  return parts.join('; ');
}

/** The value of our 'sess' or 'login' cookie in a request (or a raw Cookie header), or null. */
export function cookieOf(cfg, reqOrHeader, which) {
  const header = typeof reqOrHeader === 'string' ? reqOrHeader : reqOrHeader?.headers?.cookie;
  const v = parseCookies(header)[cfg.cookies[which]];
  return v && /^[A-Za-z0-9_-]{1,200}$/.test(v) ? v : null;
}

// ---------------------------------------------------------------------------------------------
// CSRF (§4.7): every state-changing request carries X-SW: 1, the site's own Origin,
// Content-Type application/json, and Sec-Fetch-Site same-origin when the browser sends it.
// The Stripe webhook is exempt (it is verified by its signature).

export function csrfProblem(req, cfg) {
  if (req.headers['x-sw'] !== '1') return httpError(403, 'forbidden');
  if (req.headers.origin !== cfg.publicOrigin) return httpError(403, 'forbidden');
  const sfs = req.headers['sec-fetch-site'];
  if (sfs !== undefined && sfs !== 'same-origin') return httpError(403, 'forbidden');
  const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (type !== 'application/json') return httpError(415, 'bad_request');
  return null;
}

// ---------------------------------------------------------------------------------------------
// bodies

/** Read at most `max` bytes (413 too_big past that, without reading further). */
export function readRaw(req, max) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > max) return reject(httpError(413, 'too_big'));
    const chunks = [];
    let size = 0;
    let done = false;
    const finish = (err, value) => {
      if (done) return;
      done = true;
      req.off('data', onData);
      req.off('end', onEnd);
      req.off('error', onError);
      if (err) {
        req.pause();
        reject(err);
      } else resolve(value);
    };
    const onData = (c) => {
      size += c.length;
      if (size > max) return finish(httpError(413, 'too_big'));
      chunks.push(c);
    };
    const onEnd = () => finish(null, Buffer.concat(chunks, size));
    const onError = () => finish(httpError(400, 'bad_request'));
    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onError);
  });
}

/**
 * The request body for a route's `body` spec → { body, bytes, gzip }.
 * 'json': ≤ max (16 KB) of JSON, an object (an empty body is {}); no gzip.
 * 'world': JSON, optionally Content-Encoding: gzip; ≤ max bytes AFTER decompression
 *          (gunzip with maxOutputLength, so a gzip bomb is a 413, not a crash).
 * 'raw':  the bytes as sent (≤ max, 1 MB), not parsed (the Stripe webhook).
 */
export async function readBody(req, spec = {}, cfg = {}) {
  const kind = spec.kind || 'json';
  const max = spec.max ?? (kind === 'raw' ? RAW_MAX : kind === 'world' ? cfg.worldMaxBytes || 8388608 : JSON_MAX);
  const enc = String(req.headers['content-encoding'] || 'identity').trim().toLowerCase();
  if (kind === 'raw') {
    if (enc !== 'identity') throw httpError(415, 'bad_request');
    const bytes = await readRaw(req, max);
    return { body: bytes, bytes, gzip: null };
  }
  let gzip = null;
  let bytes;
  if (enc === 'gzip' && kind === 'world') {
    gzip = await readRaw(req, max);
    try {
      bytes = gunzipSync(gzip, { maxOutputLength: max });
    } catch (err) {
      if (err && (err.code === 'ERR_BUFFER_TOO_LARGE' || err instanceof RangeError)) throw httpError(413, 'too_big');
      throw httpError(400, 'bad_request');
    }
  } else if (enc === 'identity') {
    bytes = await readRaw(req, max);
  } else {
    throw httpError(415, 'bad_request');
  }
  if (!bytes.length) return { body: {}, bytes, gzip };
  let body;
  try {
    body = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw httpError(400, 'bad_request');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw httpError(400, 'bad_request');
  return { body, bytes, gzip };
}

// ---------------------------------------------------------------------------------------------
// the router

const SESSION_WHO = new Set(['session', 'parent', 'parent+check', 'parent+check5', 'player']);
const PARENT_WHO = new Set(['parent', 'parent+check', 'parent+check5']);
const WHO = new Set(['anyone', 'stripe', 'test', ...SESSION_WHO]);
const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);

export function compilePath(p) {
  if (typeof p !== 'string' || !p.startsWith('/api/')) throw new Error('route paths start with /api/: ' + p);
  const segs = p.split('/').slice(1);
  const keys = [];
  const parts = segs.map((s) => {
    if (s.startsWith(':')) {
      keys.push(s.slice(1));
      return '([^/]+)';
    }
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  });
  return { re: new RegExp('^/' + parts.join('/') + '$'), keys, literals: segs.filter((s) => !s.startsWith(':')).length };
}

/**
 * @param {object} o
 * @param {object} o.cfg     loadConfig()
 * @param {object} o.ctx     { clock, log, limits, sessions: { fromRequest(req, now) }, family: { load(id), player(pid) } }
 * @param {Array}  o.routes  route objects (see the top of this file)
 * @returns {{ handle(req, res, url) → Promise<boolean>, routes }}
 */
export function createRouter({ cfg, ctx, routes }) {
  const list = [];
  for (const r of routes) {
    if (!METHODS.has(r.method)) throw new Error(`route ${r.path}: unknown method ${r.method}`);
    if (!WHO.has(r.who)) throw new Error(`route ${r.method} ${r.path}: unknown who ${r.who}`);
    if (typeof r.handler !== 'function') throw new Error(`route ${r.method} ${r.path}: no handler`);
    if (r.who === 'test' && !cfg.test) continue; // /api/test/* exist only with SW_TEST=1
    for (const other of list) if (other.method === r.method && other.path === r.path) throw new Error(`route ${r.method} ${r.path} twice`);
    list.push({ ...r, ...compilePath(r.path) });
  }
  // the most specific path first: /api/devices/this before /api/devices/:id
  list.sort((a, b) => b.literals - a.literals);
  const log = ctx.log || (() => {});
  const now = () => (ctx.clock ? ctx.clock.now() : Date.now());

  function match(pathname) {
    const found = [];
    for (const r of list) {
      const m = r.re.exec(pathname);
      if (!m) continue;
      const params = {};
      let ok = true;
      r.keys.forEach((k, i) => {
        try {
          params[k] = decodeURIComponent(m[i + 1]);
        } catch {
          ok = false;
        }
      });
      if (ok) found.push({ r, params });
    }
    return found;
  }

  function limited(spec, key) {
    if (!ctx.limits || key === undefined || key === null) return;
    const res = ctx.limits.check(spec, key);
    if (!res.ok) throw httpError(429, 'rate', {}, { 'Retry-After': String(res.retryAfter) });
  }

  async function handle(req, res, url) {
    const pathname = url.pathname;
    const found = match(pathname);
    if (!found.length) return false;
    const method = req.method === 'HEAD' ? 'GET' : req.method;
    const hit = found.find((f) => f.r.method === method);
    if (!hit) {
      const allow = [...new Set(found.map((f) => f.r.method))];
      if (allow.includes('GET')) allow.push('HEAD');
      send(res, req, { status: 405, json: { error: 'bad_request' }, headers: { Allow: allow.join(', ') } });
      return true;
    }
    const { r, params } = hit;
    const x = {
      params,
      query: Object.fromEntries(url.searchParams),
      body: undefined,
      bodyBytes: null,
      bodyGzip: null,
      cookies: parseCookies(req.headers.cookie),
      session: null,
      sessionError: null,
      family: null,
      player: null,
      ip: addressKey(clientIpOf(req.socket?.remoteAddress, req.headers['x-forwarded-for'], cfg.trustProxy !== false)),
      now: now(),
      req,
      url,
    };
    try {
      if (r.who !== 'stripe') limited(DEFAULT_LIMITS.ip, x.ip);
      if (method !== 'GET') {
        if (r.who !== 'stripe') {
          const bad = csrfProblem(req, cfg);
          if (bad) throw bad;
        }
        const b = await readBody(req, r.body || (r.who === 'stripe' ? { kind: 'raw' } : {}), cfg);
        x.body = b.body;
        x.bodyBytes = b.bytes;
        x.bodyGzip = b.gzip;
      }
      if (r.who !== 'stripe' && r.who !== 'test') await who(r, x);
      for (const l of r.limit || []) {
        const key = l.key === 'global' ? '*' : l.key === 'ip' ? x.ip : l.key === 'session' ? x.session?.hash?.toString('hex') : l.key === 'family' ? x.session?.familyId : l.key === 'player' ? x.player?.id : undefined;
        limited(l, key);
      }
      const answer = (await r.handler(req, x)) || { status: 204 };
      send(res, req, answer, cfg);
    } catch (err) {
      if (err instanceof HttpError) {
        // a body that was too big is not read further: the connection closes after this answer
        const extra = err.status === 413 ? { Connection: 'close' } : {};
        send(res, req, { status: err.status, json: { error: err.code, ...err.extra }, headers: { ...err.headers, ...extra } });
      } else {
        log(`api: ${r.method} ${r.path} failed: ${err && err.code ? err.code : err && err.name ? err.name : 'Error'}`);
        if (res.headersSent) res.destroy();
        else send(res, req, { status: 503, json: { error: 'unavailable' } });
      }
    }
    return true;
  }

  async function who(r, x) {
    const needs = SESSION_WHO.has(r.who);
    try {
      x.session = ctx.sessions ? await ctx.sessions.fromRequest(x.req, x.now) : null;
    } catch (err) {
      if (!(err instanceof HttpError)) throw err;
      if (needs) throw err; // 401 signed_out, 410 family_gone
      x.sessionError = err; // 'anyone' routes (GET /api/me) decide themselves
    }
    if (x.session) {
      limited(DEFAULT_LIMITS.session, x.session.hash ? Buffer.from(x.session.hash).toString('hex') : x.session.familyId);
      if (ctx.family?.load) x.family = await ctx.family.load(x.session.familyId);
      if (!x.family && needs && ctx.family?.load) throw httpError(410, 'family_gone');
    }
    if (!needs) return;
    const s = x.session;
    if (!s) throw httpError(401, 'signed_out');
    if (PARENT_WHO.has(r.who)) {
      if (s.kind !== 'parent') throw httpError(403, 'forbidden');
      if (r.who !== 'parent' && !(s.elevatedUntil > x.now)) throw httpError(403, 'check_required');
      if (r.who === 'parent+check5' && !(s.elevatedAt >= x.now - CHECK_MS)) throw httpError(403, 'check_required');
    }
    if (r.who === 'player') {
      const pid = x.params.pid;
      if (!isUuid(pid)) throw httpError(404, 'not_found');
      const p = ctx.family?.player ? await ctx.family.player(pid) : null;
      if (!p) throw httpError(410, 'player_gone'); // deleted (or never was): devices wipe their copy
      if (p.family_id !== s.familyId) throw httpError(404, 'not_found'); // another family's: never say it exists
      if (s.lockPlayer && s.lockPlayer !== pid) throw httpError(404, 'not_found');
      x.player = p;
    }
  }

  return { handle, routes: list };
}

/** Write a handler's answer (cfg is needed only for answers that set cookies). */
export function send(res, req, a, cfg = null) {
  const status = a.status ?? (a.json !== undefined || a.body !== undefined || a.stream ? 200 : 204);
  const headers = { 'Cache-Control': 'no-store', ...(a.headers || {}) };
  if (a.cookies?.length) headers['Set-Cookie'] = a.cookies.map((c) => (typeof c === 'string' ? c : serializeCookie(cfg, c.name, c.value, c.maxAge)));
  const head = req.method === 'HEAD';
  if (a.json !== undefined) {
    const text = JSON.stringify(a.json);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(text), ...headers });
    res.end(head ? undefined : text);
    return;
  }
  if (a.body !== undefined) {
    const buf = typeof a.body === 'string' ? Buffer.from(a.body) : a.body;
    res.writeHead(status, { 'Content-Length': buf.length, ...headers });
    res.end(head ? undefined : buf);
    return;
  }
  if (a.stream) {
    res.writeHead(status, headers);
    if (head) {
      res.end();
      return;
    }
    const src = typeof a.stream.pipe === 'function' ? a.stream : Readable.from(a.stream);
    src.on('error', () => res.destroy());
    src.pipe(res);
    return;
  }
  res.writeHead(status, headers);
  res.end();
}
