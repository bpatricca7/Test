// Sparkle World server for Railway (docs/MULTIPLAYER.md Addendum A, docs/DEPLOY-RAILWAY.md).
//
// One small Node 22 program, only the `ws` package:
// - serves the built game, dist/sparkle-world.html (gzip, ETag, revalidated on every load),
// - GET /healthz (Railway health check) and GET /api/net ({ ok, version, build }: the game
//   uses it to know it can play with friends here),
// - relays multiplayer rooms at wss://<host>/r/<roomName> with the room logic in rooms.mjs.
//
// Kid safety and privacy: no accounts, no chat text, no voice, no stored player data. Rooms
// live only in memory while friends play; message contents are never logged.
//
// Limits (env overrides in brackets): 4 players per room [SW_MAX_PEERS], 3,900 B per message,
// 4 KiB of presence per player, 40 messages/s per connection (burst 80), 500 rooms
// [SW_MAX_ROOMS], 12 connections per IP [SW_MAX_PER_IP], rooms idle for 10 minutes are closed
// [SW_IDLE_MS], WebSocket frames over 16 KiB are refused, Origin must be this site
// [SW_ALLOWED_ORIGINS adds more, comma separated].

import http from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { RoomRegistry, ROOM_NAME_RE } from './rooms.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const envInt = (name, def) => {
  const v = parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(v) ? v : def;
};

class Bucket {
  constructor(rate, burst) {
    this.rate = rate;
    this.burst = burst;
    this.tokens = burst;
    this.at = Date.now();
  }

  take() {
    const now = Date.now();
    this.tokens = Math.min(this.burst, this.tokens + ((now - this.at) * this.rate) / 1000);
    this.at = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

/**
 * Create the server (not listening yet). Options mirror the env variables; tests pass them
 * directly. Returns { server, registry, listen(port, host) -> Promise<port>, close() -> Promise }.
 */
export function createServer(opts = {}) {
  const o = {
    htmlPath: opts.htmlPath ?? process.env.SW_DIST ?? path.join(ROOT, 'dist', 'sparkle-world.html'),
    maxRooms: opts.maxRooms ?? envInt('SW_MAX_ROOMS', 500),
    maxPeers: opts.maxPeers ?? envInt('SW_MAX_PEERS', 4),
    maxPerIp: opts.maxPerIp ?? envInt('SW_MAX_PER_IP', 12),
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
  };
  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const page = loadPage(o.htmlPath);
  const registry = new RoomRegistry({
    maxRooms: o.maxRooms, maxPeers: o.maxPeers, msgBytes: o.msgBytes, stateBytes: o.stateBytes,
    graceMs: o.graceMs, idleMs: o.idleMs,
  });
  const conns = new Map(); // `${room}\n${peer}` -> conn
  const perIp = new Map();
  const counters = { connections: 0, rejected: 0, rateDropped: 0 };
  let shuttingDown = false;

  const server = http.createServer((req, res) => handleHttp(req, res));
  const wss = new WebSocketServer({ noServer: true, maxPayload: o.maxFrame, perMessageDeflate: false });

  function securityHeaders(res) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  }

  function sendJson(res, status, body, head) {
    const text = JSON.stringify(body);
    securityHeaders(res);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(text) });
    res.end(head ? undefined : text);
  }

  function handleHttp(req, res) {
    const head = req.method === 'HEAD';
    if (req.method !== 'GET' && !head) {
      res.writeHead(405, { Allow: 'GET, HEAD' });
      res.end();
      return;
    }
    let pathname = '/';
    try {
      pathname = new URL(req.url, 'http://x').pathname;
    } catch {}
    if (pathname === '/healthz') {
      if (!page) return sendJson(res, 503, { ok: false, error: 'game not built' }, head);
      return sendJson(res, 200, { ok: true }, head);
    }
    if (pathname === '/api/net') {
      return sendJson(res, 200, { ok: !!page && !shuttingDown, version: pkg.version, build: page ? page.build : null }, head);
    }
    if (pathname === '/' || pathname === '/index.html' || pathname === '/sparkle-world.html') {
      if (!page) {
        res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(head ? undefined : 'Sparkle World is not built yet. Run: npm run build\n');
        return;
      }
      securityHeaders(res);
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
    if (pathname === '/favicon.ico') {
      res.writeHead(204);
      res.end();
      return;
    }
    if (pathname.startsWith('/r/')) {
      res.writeHead(426, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(head ? undefined : 'WebSocket only\n');
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(head ? undefined : 'Not found\n');
  }

  function clientIp(req) {
    if (o.trustProxy) {
      const xff = req.headers['x-forwarded-for'];
      if (typeof xff === 'string' && xff) return xff.split(',')[0].trim();
    }
    return req.socket.remoteAddress || '?';
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
    if (!originOk(req)) return refuse(socket, 403, 'Forbidden');
    if (shuttingDown) return refuse(socket, 503, 'Service Unavailable');
    const ip = clientIp(req);
    wss.handleUpgrade(req, socket, head, (ws) => onConnection(ws, name, secret, ip));
  });

  function onConnection(ws, name, secret, ip) {
    counters.connections++;
    const peer = createHash('sha256').update(name + '\n' + secret).digest('hex').slice(0, 16);
    const ipCount = perIp.get(ip) || 0;
    if (ipCount >= o.maxPerIp) {
      safeSend(ws, { t: 'e', code: 'limit' });
      ws.close(4029, 'too many connections');
      return;
    }
    perIp.set(ip, ipCount + 1);
    const key = name + '\n' + peer;
    const conn = { ws, name, peer, ip, bucket: new Bucket(o.rate, o.burst), bye: false, replaced: false, alive: true, dropped: 0, droppedAt: 0 };
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
    const r = registry.join(name, peer, sink, { by: null, kind: 'viewer', guest: false });
    if (!r.ok) {
      safeSend(ws, { t: 'e', code: r.code });
      conn.bye = true;
      ws.close(r.code === 'full' ? 4001 : r.code === 'rooms_full' ? 4002 : 4004, r.code);
    }
    ws.on('pong', () => {
      conn.alive = true;
    });
    ws.on('message', (data, isBinary) => {
      if (isBinary) return;
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
      if (f.t === 'bye') {
        conn.bye = true;
        registry.leave(name, peer);
        ws.close(1000, 'bye');
        return;
      }
      const err = registry.handle(name, peer, f);
      if (err) safeSend(ws, { t: 'e', code: err.code });
    });
    ws.on('error', () => {});
    ws.on('close', (code) => {
      const n = (perIp.get(ip) || 1) - 1;
      if (n <= 0) perIp.delete(ip);
      else perIp.set(ip, n);
      if (conn.replaced) return;
      if (conns.get(key) === conn) conns.delete(key);
      if (!r.ok) return;
      if (conn.bye || code === 1000 || code === 1001) registry.leave(name, peer);
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
    clearInterval(sweepTimer);
    clearInterval(roomTimer);
    for (const conn of conns.values()) {
      try {
        conn.ws.close(1012, 'restarting');
      } catch {}
    }
    return new Promise((resolve) => {
      const done = () => resolve();
      server.close(done);
      setTimeout(() => {
        for (const conn of conns.values()) conn.ws.terminate();
        server.closeAllConnections?.();
      }, 1500).unref?.();
    });
  }

  function stats() {
    return { rooms: registry.roomCount, peers: registry.peerCount(), connections: conns.size, ...counters, ...registry.counts };
  }

  return { server, registry, listen, close, stats, page, options: o };
}

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

// ---------- run as a program ----------

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const app = createServer();
  const port = envInt('PORT', 8080);
  const host = process.env.HOST || '0.0.0.0';
  if (!app.page) console.warn('warning: dist/sparkle-world.html is missing; run "npm run build" first (health check will fail)');
  const bound = await app.listen(port, host);
  console.log(`Sparkle World server listening on port ${bound}` + (app.page ? ` (build ${app.page.build}, ${(app.page.gz.length / 1024).toFixed(0)} KB gzip)` : ''));
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
}
