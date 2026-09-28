// Sparkle World server for Railway (docs/MULTIPLAYER.md Addendum A, docs/DEPLOY-RAILWAY.md).
//
// One small Node 22 program, only the `ws` package:
// - serves the home page, dist/site/ (built from site/ by tools/site-build.mjs), at "/",
// - serves the built game, dist/sparkle-world.html (gzip, ETag, revalidated on every load), at
//   "/play" (also the old "/sparkle-world.html"; at "/" too when the home page is not built),
// - GET /healthz (Railway health check) and GET /api/net ({ ok, version, build }: the game
//   uses it to know it can play with friends here),
// - relays multiplayer rooms at wss://<host>/r/<roomName> with the room logic in rooms.mjs.
//
// Kid safety and privacy: no accounts, no chat text, no stored player data. Rooms live only in
// memory while friends play; message contents are never logged. The walkie-talkie
// (server/voice.mjs, docs/MULTIPLAYER.md Addendum C) relays live voice frames only between the
// players of one game (the room's host and the friends she let in: the same gate as below)
// whose grown-ups turned it on and whose badge shows it, and never records, stores or logs them.
//
// Identity: a player's `by` stamp is made HERE from a per-device secret the page sends when
// it connects (?d=..., kept in the device's localStorage, never shown to anyone), hashed with
// the room name. A page cannot choose or copy someone else's stamp, so "let in again", "sent
// home" and "follow the host after a reload" can trust it (docs/MULTIPLAYER.md Addendum B).
// Rooms are gated (rooms.mjs): until the host lets a player in, she sees only the public
// presence keys, gets no messages and no voice.
//
// Limits (env overrides in brackets): 4 players per room [SW_MAX_PEERS], 3,900 B per message,
// 4 KiB of presence per player, 40 messages/s per connection (burst 80), 500 rooms
// [SW_MAX_ROOMS], 12 connections per IP [SW_MAX_PER_IP], 6 live rooms made per IP
// [SW_ROOMS_PER_IP], new connections per IP 1/s with a burst of 30 [SW_CONNECT_RATE,
// SW_CONNECT_BURST], new rooms per IP 20/min with a burst of 12 [SW_ROOMS_PER_MIN,
// SW_ROOMS_BURST] (a code nobody plays makes a new room, so trying codes one after another is
// slow), rooms idle for 10 minutes are closed [SW_IDLE_MS], WebSocket frames over 16 KiB are
// refused, Origin must be this site [SW_ALLOWED_ORIGINS adds more, comma separated]. Voice has
// its own limits (server/voice.mjs). A page that drops without ever setting presence leaves
// its room at once (it has nothing to come back to).
// The client IP is the socket address, or behind a proxy (SW_TRUST_PROXY, on by default) the
// right-most public address in X-Forwarded-For (what the proxy saw, not what the client wrote);
// an IPv6 address counts by its /64 network (one home gets a whole /64). Those helpers and the
// token buckets live in server/limits.mjs.
//
// Family accounts (docs/ACCOUNTS.md) are OFF unless SW_ACCOUNTS is `optional` or `required`.
// Off, nothing below changes: no database, no /api routes beyond /api/net, no cookies, and
// server/accounts.mjs (with `pg` and `stripe`) is never even loaded. On, createServer({ accounts })
// sends every other /api/* request to accounts.handleHttp(), asks the database in /healthz,
// adds `accounts` and `friendsMode` to /api/net, and asks accounts.authorizeSocket() about every
// WebSocket after the existing checks (a refusal completes the handshake, sends {t:'e', code}
// and closes with 4401-4405 or 1013, so the page can show a friendly card).

import http from 'node:http';
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { RoomRegistry, ROOM_NAME_RE } from './rooms.mjs';
import { VoiceRelay } from './voice.mjs';
import { Bucket, clientIpOf, addressKey } from './limits.mjs';
import { loadConfig, summarizeConfig } from './config.mjs';

// moved to limits.mjs (docs/ACCOUNTS.md §1.3); re-exported here for the tests and older callers
export { Bucket, KeyedLimiter, isInternalIp, normalizeIp, clientIpOf, addressKey } from './limits.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const envInt = (name, def) => {
  const v = parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(v) ? v : def;
};

/**
 * Create the server (not listening yet). Options mirror the env variables; tests pass them
 * directly. Returns { server, registry, listen(port, host) -> Promise<port>, close() -> Promise }.
 */
export function createServer(opts = {}) {
  const o = {
    htmlPath: opts.htmlPath ?? process.env.SW_DIST ?? path.join(ROOT, 'dist', 'sparkle-world.html'),
    siteDir: opts.siteDir ?? process.env.SW_SITE ?? path.join(ROOT, 'dist', 'site'),
    maxRooms: opts.maxRooms ?? envInt('SW_MAX_ROOMS', 500),
    maxPeers: opts.maxPeers ?? envInt('SW_MAX_PEERS', 4),
    maxPerIp: opts.maxPerIp ?? envInt('SW_MAX_PER_IP', 12),
    roomsPerIp: opts.roomsPerIp ?? envInt('SW_ROOMS_PER_IP', 6),
    connectRate: opts.connectRate ?? envInt('SW_CONNECT_RATE', 1),
    connectBurst: opts.connectBurst ?? envInt('SW_CONNECT_BURST', 30),
    roomsPerMin: opts.roomsPerMin ?? envInt('SW_ROOMS_PER_MIN', 20),
    roomsBurst: opts.roomsBurst ?? envInt('SW_ROOMS_BURST', 12),
    idleMs: opts.idleMs ?? envInt('SW_IDLE_MS', 10 * 60 * 1000),
    graceMs: opts.graceMs ?? envInt('SW_GRACE_MS', 5000),
    msgBytes: opts.msgBytes ?? 3900,
    stateBytes: opts.stateBytes ?? 4096,
    rate: opts.rate ?? 40,
    burst: opts.burst ?? 80,
    maxFrame: opts.maxFrame ?? 16 * 1024,
    allowedOrigins: (opts.allowedOrigins ?? process.env.SW_ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    trustProxy: opts.trustProxy ?? process.env.SW_TRUST_PROXY !== '0',
    log: opts.log ?? ((...a) => console.log(...a)),
    sweepMs: opts.sweepMs ?? 5000,
    testStats: opts.testStats ?? process.env.SW_TEST_STATS === '1', // GET /api/stats (tests only)
    // family accounts (docs/ACCOUNTS.md §15.2): null = off, exactly today's server
    accounts: opts.accounts ?? null,
    // Strict-Transport-Security on every answer (accounts on with an https PUBLIC_ORIGIN)
    hsts: opts.hsts ?? false,
  };
  const accounts = o.accounts;
  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const page = loadPage(o.htmlPath);
  const site = loadSite(o.siteDir);
  const registry = new RoomRegistry({
    maxRooms: o.maxRooms, maxPeers: o.maxPeers, msgBytes: o.msgBytes, stateBytes: o.stateBytes,
    graceMs: o.graceMs, idleMs: o.idleMs, roomsPerOwner: o.roomsPerIp, gate: true,
  });
  // the walkie-talkie: who may hear and talk is read from the registry's gate (rooms.mjs gameOf)
  const voice = new VoiceRelay({ registry });
  voice.start();
  const conns = new Map(); // `${room}\n${peer}` -> conn
  const perIp = new Map();
  const connectBuckets = new Map(); // ip -> Bucket (new connections)
  const roomBuckets = new Map(); // ip -> Bucket (new rooms)
  const counters = { connections: 0, rejected: 0, rateDropped: 0, connectLimited: 0, roomLimited: 0, errors: 0, voiceKicked: 0 };
  let shuttingDown = false;

  const server = http.createServer((req, res) => handleHttp(req, res));
  const wss = new WebSocketServer({ noServer: true, maxPayload: o.maxFrame, perMessageDeflate: false });

  // every answer carries these; the page may not be framed by another site, talks only to
  // its own origin (fetch /api/net and the rooms), and loads no plugins or other bases. Only
  // the game page may use the microphone (the walkie-talkie), and only on this site; the
  // camera stays off everywhere
  function securityHeaders(res, game = false) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', `camera=(), microphone=${game ? '(self)' : '()'}, geolocation=(), payment=(), usb=(), display-capture=()`);
    res.setHeader('Content-Security-Policy', "frame-ancestors 'none'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'");
    res.setHeader('X-Frame-Options', 'DENY');
    if (o.hsts) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  }

  function sendText(res, status, text, head, extra = {}) {
    securityHeaders(res);
    res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...extra });
    res.end(head || text === undefined ? undefined : text);
  }

  function sendJson(res, status, body, head) {
    const text = JSON.stringify(body);
    securityHeaders(res);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(text) });
    res.end(head ? undefined : text);
  }

  function handleHttp(req, res) {
    const head = req.method === 'HEAD';
    let url = null;
    let pathname = '/';
    try {
      url = new URL(req.url, 'http://x');
      pathname = url.pathname;
    } catch {}
    // family accounts: every /api/* but /api/net (and the tests' /api/stats), any method
    if (accounts && url && pathname.startsWith('/api/') && pathname !== '/api/net' && !(pathname === '/api/stats' && o.testStats)) {
      return handleApi(req, res, url);
    }
    if (req.method !== 'GET' && !head) return sendText(res, 405, undefined, true, { Allow: 'GET, HEAD' });
    if (pathname === '/healthz') {
      if (!page) return sendJson(res, 503, { ok: false, error: 'game not built' }, head);
      if (accounts) return healthz(res, head);
      return sendJson(res, 200, { ok: true }, head);
    }
    if (pathname === '/api/stats' && o.testStats) return sendJson(res, 200, { ...stats(), voicePeers: voice.peerStats() }, head);
    if (pathname === '/api/net') {
      const info = { ok: !!page && !shuttingDown, version: pkg.version, build: page ? page.build : null };
      return sendJson(res, 200, accounts ? { ...info, ...accounts.netInfo() } : info, head);
    }
    // ---- the home page (dist/site/) at "/" and its files ----
    const sitePath = site ? siteFileFor(pathname) : null;
    if (sitePath && site.has(sitePath)) return sendSiteFile(req, res, site.get(sitePath), head);
    // ---- the game at "/play" ("/" too when the home page is not built) ----
    if (pathname === '/play' || pathname === '/play/' || pathname === '/sparkle-world.html' || (!site && (pathname === '/' || pathname === '/index.html'))) {
      if (!page) return sendText(res, 503, 'Sparkle World is not built yet. Run: npm run build\n', head);
      securityHeaders(res, true);
      res.setHeader('ETag', page.etag);
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Vary', 'Accept-Encoding');
      if (req.headers['if-none-match'] === page.etag) {
        res.writeHead(304);
        res.end();
        return;
      }
      const gz = /\bgzip\b/.test(req.headers['accept-encoding'] || '');
      const body = gz ? page.gz : page.raw;
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Length': body.length,
        ...(gz ? { 'Content-Encoding': 'gzip' } : {}),
      });
      res.end(head ? undefined : body);
      return;
    }
    if (pathname === '/favicon.ico' && !(site && site.has('favicon.ico'))) return sendText(res, 204, undefined, true);
    if (pathname.startsWith('/r/')) return sendText(res, 426, 'WebSocket only\n', head);
    sendText(res, 404, 'Not found\n', head);
  }

  // ---- family accounts (only with SW_ACCOUNTS on) ----

  async function handleApi(req, res, url) {
    securityHeaders(res);
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    try {
      if (await accounts.handleHttp(req, res, url)) return;
      if (!res.headersSent) sendJson(res, 404, { error: 'not_found' }, req.method === 'HEAD');
    } catch (err) {
      counters.errors++;
      o.log(`api: unexpected error ${err && err.name ? err.name : 'Error'}`);
      if (res.headersSent) res.destroy();
      else sendJson(res, 503, { error: 'unavailable' });
    }
  }

  /** The database answers `select 1` within 2 s and every migration is applied (§13.3). */
  async function healthz(res, head) {
    let h = null;
    let timer;
    try {
      h = await Promise.race([accounts.health(), new Promise((resolve) => (timer = setTimeout(() => resolve(null), 2000)))]);
    } catch {
      h = null;
    } finally {
      clearTimeout(timer);
    }
    if (h && h.ok) return sendJson(res, 200, { ok: true }, head);
    return sendJson(res, 503, { ok: false, error: 'database' }, head);
  }

  // ---- home page files ----

  /** "/" -> "index.html", "/parents" -> "parents.html", "/img/a.webp" -> "img/a.webp". */
  function siteFileFor(pathname) {
    if (pathname === '/' || pathname === '/index.html') return 'index.html';
    let rel = pathname.slice(1);
    try {
      rel = decodeURIComponent(rel);
    } catch {
      return null;
    }
    if (!rel || rel.includes('..') || rel.includes('\\') || rel.startsWith('/')) return null;
    if (!/\.[a-z0-9]+$/i.test(rel) && site.has(rel + '.html')) return rel + '.html';
    return rel;
  }

  function sendSiteFile(req, res, f, head) {
    securityHeaders(res);
    if (f.html) res.setHeader('Content-Security-Policy', SITE_CSP);
    res.setHeader('ETag', f.etag);
    res.setHeader('Cache-Control', f.cache);
    if (f.gz) res.setHeader('Vary', 'Accept-Encoding');
    if (req.headers['if-none-match'] === f.etag) {
      res.writeHead(304);
      res.end();
      return;
    }
    const gz = !!f.gz && /\bgzip\b/.test(req.headers['accept-encoding'] || '');
    const body = gz ? f.gz : f.raw;
    res.writeHead(200, {
      'Content-Type': f.type,
      'Content-Length': body.length,
      ...(gz ? { 'Content-Encoding': 'gzip' } : {}),
    });
    res.end(head ? undefined : body);
  }

  function clientIp(req) {
    return addressKey(clientIpOf(req.socket.remoteAddress, req.headers['x-forwarded-for'], o.trustProxy));
  }

  /** One token from this address's bucket in `map` (made full on first use). */
  function takeFrom(map, ip, rate, burst) {
    let b = map.get(ip);
    if (!b) map.set(ip, (b = new Bucket(rate, burst)));
    return b.take();
  }

  function originOk(req) {
    const origin = req.headers.origin;
    if (!origin) return true; // not a browser page; browsers always send Origin
    let host;
    try {
      host = new URL(origin).host;
    } catch {
      return false;
    }
    const want = req.headers['x-forwarded-host'] && o.trustProxy ? String(req.headers['x-forwarded-host']).split(',')[0].trim() : req.headers.host;
    if (host === want || host === req.headers.host) return true;
    return o.allowedOrigins.includes(origin);
  }

  function refuse(socket, status, text) {
    counters.rejected++;
    try {
      socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    } catch {}
    socket.destroy();
  }

  server.on('upgrade', (req, socket, head) => {
    let url;
    try {
      url = new URL(req.url, 'http://x');
    } catch {
      return refuse(socket, 400, 'Bad Request');
    }
    const m = /^\/r\/([^/]+)$/.exec(url.pathname);
    if (!m) return refuse(socket, 404, 'Not Found');
    let name = '';
    try {
      name = decodeURIComponent(m[1]);
    } catch {}
    if (!ROOM_NAME_RE.test(name)) return refuse(socket, 400, 'Bad Request');
    const secret = url.searchParams.get('s') || '';
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(secret)) return refuse(socket, 400, 'Bad Request');
    // the device secret (optional: an older page without it plays with no stamp, by:null)
    const device = url.searchParams.get('d') || '';
    if (device && !/^[A-Za-z0-9_-]{16,64}$/.test(device)) return refuse(socket, 400, 'Bad Request');
    if (!originOk(req)) return refuse(socket, 403, 'Forbidden');
    if (shuttingDown) return refuse(socket, 503, 'Service Unavailable');
    const ip = clientIp(req);
    // new connections, and new rooms, per address: a scanner opening room after room is slowed
    // down (a code nobody plays makes a new room; joining a game that is there does not count)
    if (!takeFrom(connectBuckets, ip, o.connectRate, o.connectBurst)) {
      counters.connectLimited++;
      return refuse(socket, 429, 'Too Many Requests');
    }
    if (!registry.rooms.has(name) && !takeFrom(roomBuckets, ip, o.roomsPerMin / 60, o.roomsBurst)) {
      counters.roomLimited++;
      return refuse(socket, 429, 'Too Many Requests');
    }
    if (accounts) return upgradeWithAccount(req, socket, head, url, name, secret, device, ip);
    try {
      wss.handleUpgrade(req, socket, head, (ws) => onConnection(ws, name, secret, device, ip, null));
    } catch (err) {
      counters.errors++;
      refuse(socket, 400, 'Bad Request');
    }
  });

  // with accounts on: the session and player are checked after every check above (§8.1)
  async function upgradeWithAccount(req, socket, head, url, name, secret, device, ip) {
    const playerId = url.searchParams.get('p') || null;
    if (playerId && !/^[A-Za-z0-9-]{1,64}$/.test(playerId)) return refuse(socket, 400, 'Bad Request');
    let r;
    try {
      r = await accounts.authorizeSocket({ cookie: req.headers.cookie || '', playerId });
    } catch {
      r = { ok: false, code: 'unavailable' };
    }
    if (socket.destroyed) return;
    if (shuttingDown) return refuse(socket, 503, 'Service Unavailable');
    try {
      if (r && r.ok) {
        wss.handleUpgrade(req, socket, head, (ws) => onConnection(ws, name, secret, device, ip, r.claims || null));
        return;
      }
      // refused AFTER the handshake: a browser sees only 1006 for a refused HTTP upgrade, so
      // the page could never show a friendly card for a 403
      const code = r && ACCOUNT_CLOSE[r.code] ? r.code : 'signed_out';
      counters.rejected++;
      wss.handleUpgrade(req, socket, head, (ws) => {
        safeSend(ws, { t: 'e', code });
        ws.close(ACCOUNT_CLOSE[code], code);
      });
    } catch {
      counters.errors++;
      refuse(socket, 400, 'Bad Request');
    }
  }

  function onConnection(ws, name, secret, device, ip, claims) {
    counters.connections++;
    const peer = createHash('sha256').update(name + '\n' + secret).digest('hex').slice(0, 16);
    // the server's stamp for this device in this room: the same device gets the same stamp
    // every time it comes back to these pictures, and nobody can make someone else's
    const by = device ? 'd' + createHash('sha256').update('sw-device\n' + name + '\n' + device).digest('base64url').slice(0, 16) : null;
    const ipCount = perIp.get(ip) || 0;
    if (ipCount >= o.maxPerIp) {
      safeSend(ws, { t: 'e', code: 'limit' });
      ws.close(4029, 'too many connections');
      return;
    }
    perIp.set(ip, ipCount + 1);
    const key = name + '\n' + peer;
    const conn = { ws, name, peer, ip, claims, bucket: new Bucket(o.rate, o.burst), bye: false, replaced: false, alive: true, dropped: 0, droppedAt: 0 };
    const old = conns.get(key);
    if (old) {
      old.replaced = true;
      try {
        old.ws.close(4009, 'replaced');
      } catch {}
    }
    conns.set(key, conn);
    const sink = (frame) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      if (ws.bufferedAmount > 2 * 1024 * 1024) {
        ws.terminate(); // far behind: it reconnects and gets the whole room again
        return;
      }
      ws.send(JSON.stringify(frame));
    };
    // claims (accounts on, docs/ACCOUNTS.md §8.2): null for legacy members; rooms.mjs applies them
    const r = registry.join(name, peer, sink, { by, kind: 'viewer', guest: false, owner: ip, claims });
    if (!r.ok) {
      safeSend(ws, { t: 'e', code: r.code });
      conn.bye = true;
      ws.close(r.code === 'full' ? 4001 : r.code === 'rooms_full' ? 4002 : r.code === 'limit' ? 4029 : 4004, r.code);
    } else {
      // the walkie-talkie link of this connection (server/voice.mjs decides who hears)
      conn.voice = voice.link(name, peer, {
        json: (f) => safeSend(ws, f),
        // live voice: a frame that would wait behind a slow connection is dropped, not queued
        binary: (b) => (ws.readyState === WebSocket.OPEN && ws.bufferedAmount < 64 * 1024 ? (ws.send(b, { binary: true }), true) : false),
        // too many voice frames that were not relayed: disconnected, like the JSON rate limit
        kick: () => {
          counters.voiceKicked++;
          ws.close(4008, 'too fast');
        },
      });
    }
    ws.on('pong', () => {
      conn.alive = true;
    });
    ws.on('message', (data, isBinary) => {
      // one bad frame must never take the relay (and every room) down
      try {
        onMessage(data, isBinary);
      } catch (err) {
        counters.errors++;
        o.log(`unexpected error handling a frame: ${err && err.name ? err.name : 'Error'}`);
        safeSend(ws, { t: 'e', code: 'bad_frame' });
        try {
          ws.close(1011, 'unexpected');
        } catch {}
      }
    });
    function onMessage(data, isBinary) {
      if (isBinary) {
        conn.voice?.binary(data); // walkie-talkie audio: its own limits (server/voice.mjs)
        return;
      }
      if (!conn.bucket.take()) {
        counters.rateDropped++;
        const now = Date.now();
        if (now - (conn.rateNoticeAt || 0) > 1000) {
          conn.rateNoticeAt = now;
          safeSend(ws, { t: 'e', code: 'rate' }); // the client is over its budget (a bug worth seeing)
        }
        if (now - conn.droppedAt > 10000) {
          conn.droppedAt = now;
          conn.dropped = 0;
        }
        if (++conn.dropped > 400) ws.close(4008, 'too fast');
        return;
      }
      let f;
      try {
        f = JSON.parse(data.toString('utf8'));
      } catch {
        safeSend(ws, { t: 'e', code: 'bad_frame' });
        return;
      }
      if (!f || typeof f !== 'object') return;
      if (f.t === 'k') {
        safeSend(ws, { t: 'k' });
        return;
      }
      if (f.t === 'v') {
        conn.voice?.control(f); // walkie-talkie control
        return;
      }
      if (f.t === 'bye') {
        conn.bye = true;
        registry.leave(name, peer);
        ws.close(1000, 'bye');
        return;
      }
      const err = registry.handle(name, peer, f);
      if (err) safeSend(ws, { t: 'e', code: err.code });
    }
    ws.on('error', () => {});
    ws.on('close', (code) => {
      conn.voice?.close();
      const n = (perIp.get(ip) || 1) - 1;
      if (n <= 0) perIp.delete(ip);
      else perIp.set(ip, n);
      if (conn.replaced) return;
      if (conns.get(key) === conn) conns.delete(key);
      if (!r.ok) return;
      // a page that never said anything (no presence) has nothing to come back to: it leaves at
      // once instead of holding its room for the reconnect grace
      const m = registry.rooms.get(name)?.members.get(peer);
      const silent = !m || Object.keys(m.state).length === 0;
      if (conn.bye || code === 1000 || code === 1001 || silent) registry.leave(name, peer);
      else registry.detach(name, peer);
    });
  }

  function safeSend(ws, frame) {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify(frame));
      } catch {}
    }
  }

  // heartbeat (dead connections) and sweeping (grace, idle rooms)
  const sweepTimer = setInterval(() => {
    for (const conn of conns.values()) {
      if (!conn.alive) {
        conn.ws.terminate();
        continue;
      }
      conn.alive = false;
      try {
        conn.ws.ping();
      } catch {}
    }
  }, 25000);
  const roomTimer = setInterval(() => {
    // forget address buckets that are full again
    for (const map of [connectBuckets, roomBuckets]) for (const [ip, b] of map) if (b.idle()) map.delete(ip);
    for (const { name, peer } of registry.sweep()) {
      const conn = conns.get(name + '\n' + peer);
      if (conn) {
        conn.bye = true;
        try {
          conn.ws.close(4000, 'idle');
        } catch {}
      }
    }
  }, o.sweepMs);
  sweepTimer.unref?.();
  roomTimer.unref?.();

  function listen(port = 8080, host = '0.0.0.0') {
    return new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, () => resolve(server.address().port));
    });
  }

  function close() {
    shuttingDown = true;
    voice.stop();
    clearInterval(sweepTimer);
    clearInterval(roomTimer);
    for (const conn of conns.values()) {
      try {
        conn.ws.close(1012, 'restarting');
      } catch {}
    }
    const closing = new Promise((resolve) => {
      const done = () => resolve();
      server.close(done);
      setTimeout(() => {
        for (const conn of conns.values()) conn.ws.terminate();
        server.closeAllConnections?.();
      }, 1500).unref?.();
    });
    if (!accounts) return closing;
    // accounts: in-flight requests finish first, then the database pool ends
    return closing.then(() => accounts.close().catch(() => {}));
  }

  function stats() {
    return { rooms: registry.roomCount, peers: registry.peerCount(), connections: conns.size, ...counters, ...registry.counts, voice: voice.stats() };
  }

  return { server, registry, voice, listen, close, stats, page, site, accounts, options: o };
}

// WebSocket close codes for the accounts refusals (docs/ACCOUNTS.md §8.1); the page maps them to
// friendly cards and stops retrying (1013: the database is down, the page retries)
const ACCOUNT_CLOSE = Object.freeze({
  signed_out: 4401,
  not_entitled: 4402,
  friends_off: 4403,
  friends_locked: 4404,
  player_gone: 4405,
  unavailable: 1013,
});
export { ACCOUNT_CLOSE };

function loadPage(file) {
  if (!existsSync(file)) return null;
  const raw = readFileSync(file);
  const build = createHash('sha1').update(raw).digest('hex').slice(0, 8);
  let buildId = build;
  const info = path.join(path.dirname(file), 'build.json');
  if (existsSync(info)) {
    try {
      const b = JSON.parse(readFileSync(info, 'utf8'));
      if (typeof b.build === 'string') buildId = b.build.slice(0, 32);
    } catch {}
  }
  return { raw, gz: gzipSync(raw, { level: 9 }), etag: `"${build}"`, build: buildId, size: statSync(file).size };
}

// ---------- the home page (dist/site/) ----------

// The home page's HTML pages (dist/site/*.html) get this stricter policy in place of the common
// one that securityHeaders() puts on every answer; the game page keeps the common one (it has
// inline scripts). Its own files (the Fredoka font too), pictures from data: URLs. Nothing from
// other sites, no other scripts.
const SITE_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

const SITE_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
};

/** Every file of dist/site/ in memory (a few MB), keyed by its relative path; null if not built. */
function loadSite(dir) {
  if (!dir || !existsSync(path.join(dir, 'index.html'))) return null;
  const files = new Map();
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue;
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile()) {
        const rel = path.relative(dir, full).split(path.sep).join('/');
        if (rel === 'preview.html') continue; // the Artifact fragment is not a page of this site
        const type = SITE_TYPES[path.extname(rel).toLowerCase()];
        if (!type) continue;
        const raw = readFileSync(full);
        const text = /^(text\/|application\/(json|manifest)|image\/svg)/.test(type);
        files.set(rel, {
          raw,
          gz: text ? gzipSync(raw, { level: 9 }) : null,
          etag: `"${createHash('sha1').update(raw).digest('hex').slice(0, 12)}"`,
          type,
          html: rel.endsWith('.html'),
          // pages, styles and scripts are checked on every visit (cheap 304s); pictures for a day
          cache: text ? 'no-cache' : 'public, max-age=86400',
        });
      }
    }
  };
  walk(dir);
  return files;
}

// ---------- run as a program ----------

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  // family accounts: off unless SW_ACCOUNTS says so; a broken setting refuses the start with one
  // line (exit 1, so Railway keeps the running deployment)
  let cfg;
  try {
    cfg = loadConfig(process.env);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
  let accounts = null;
  if (cfg.accounts !== 'off') {
    try {
      const { createAccounts } = await import('./accounts.mjs');
      accounts = await createAccounts(cfg, { log: (...a) => console.log(...a) });
    } catch (err) {
      console.error(`Sparkle World will not start: accounts could not start (${err && err.code ? err.code : err && err.name ? err.name : 'Error'})`);
      process.exit(1);
    }
    console.log(summarizeConfig(cfg));
  }
  const app = createServer({ accounts, hsts: !!(accounts && cfg.hsts) });
  const port = envInt('PORT', 8080);
  const host = process.env.HOST || '0.0.0.0';
  if (!app.page) console.warn('warning: dist/sparkle-world.html is missing; run "npm run build" first (health check will fail)');
  const bound = await app.listen(port, host);
  console.log(`Sparkle World server listening on port ${bound}` + (app.page ? ` (build ${app.page.build}, ${(app.page.gz.length / 1024).toFixed(0)} KB gzip)` : ''));
  console.log(app.site ? `home page at /, the game at /play (${app.site.size} home page files)` : 'no home page (dist/site/ missing): the game is at / and /play');
  let last = '';
  setInterval(() => {
    const s = app.stats();
    const line = `rooms=${s.rooms} players=${s.peers}`;
    if (line !== last) console.log(line);
    last = line;
  }, 15 * 60 * 1000).unref();
  const stop = async (sig) => {
    console.log(`${sig}: closing rooms and shutting down`);
    const force = setTimeout(() => process.exit(0), 4000);
    force.unref();
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));
  // a bug must not end every room: say what kind of error (never any payload) and keep serving
  process.on('uncaughtException', (err) => {
    console.error(`unexpected error, still serving: ${err && err.name ? err.name : 'Error'}`);
  });
  process.on('unhandledRejection', (err) => {
    console.error(`unexpected rejection, still serving: ${err && err.name ? err.name : 'Error'}`);
  });
}
