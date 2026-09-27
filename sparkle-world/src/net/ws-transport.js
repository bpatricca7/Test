// WsTransport (docs/MULTIPLAYER.md §4.4, Addendum A): NetTransport over one WebSocket to the
// page's own origin, wss://<host>/r/<roomName>, speaking the JSON frames of server/rooms.mjs.
// Picked automatically outside claude.ai when GET /api/net answers (transport.js).
//
// - The peer id is derived by the server from a per-page secret sent with the connection, so
//   a reconnect (network blip, server restart) comes back as the SAME peer and the room hands
//   it the whole roster again; presence is re-asserted by FrameTransport.
// - Reconnects back off 0.5, 1, 2, 4, 8, 8... s; after about a minute the session ends
//   (onStatus fatal 'ended').
// - identity(): a random per-device id (localStorage), canHost true. No accounts.

import { FrameTransport, NetError, realClock } from './transport.js';
import { loadDeviceId } from './loop-transport.js';

const BACKOFF = [500, 1000, 2000, 4000, 8000];
const GIVE_UP_MS = 60000;
const KEEPALIVE_MS = 20000;
const SILENT_MS = 50000;
const CLOSE_TO_ERROR = { 4001: 'full', 4002: 'busy', 4029: 'busy', 4003: 'no_rooms', 4004: 'invalid' };

function randomSecret(n = 24) {
  const a = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const buf = new Uint8Array(n);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(buf);
  else for (let k = 0; k < n; k++) buf[k] = Math.floor(Math.random() * 256);
  let s = '';
  for (let k = 0; k < n; k++) s += a[buf[k] % a.length];
  return s;
}

export class WsTransport extends FrameTransport {
  /**
   * @param {object} o
   * @param {string} [o.url]        base like 'ws://127.0.0.1:8080' (default: this page's origin)
   * @param {string} [o.uid]        my stable id (default: a per-device id in localStorage)
   * @param {object} [o.clock]
   * @param {Function} [o.WebSocket] constructor (default: globalThis.WebSocket)
   * @param {object} [o.faults]     tests: { dropRate, dupRate, delayMs, rand } on received broadcasts
   */
  constructor(o = {}) {
    super({ clock: o.clock || realClock, limits: o.limits });
    this._base = o.url || null;
    this._uid = o.uid || null;
    this._WS = o.WebSocket || globalThis.WebSocket;
    this._faults = o.faults || null;
    this._secret = randomSecret();
    this._ws = null;
    this._attempt = 0;
    this._downSince = 0;
    this._retryTimer = null;
    this._kaTimer = null;
    this._lastRx = 0;
    this._blockUntil = 0;
    this._roomName = null;
  }

  get kind() { return 'ws'; }

  async identity() {
    if (!this._uid) this._uid = loadDeviceId('ws');
    return { uid: this._uid, canHost: true };
  }

  _urlFor(room) {
    let base = this._base;
    if (!base) {
      const loc = globalThis.location;
      if (!loc) throw new NetError('unavailable', 'no location');
      base = (loc.protocol === 'https:' ? 'wss://' : 'ws://') + loc.host;
    }
    return `${base.replace(/\/$/, '')}/r/${encodeURIComponent(room)}?s=${this._secret}`;
  }

  async _linkOpen(roomName) {
    if (typeof this._WS !== 'function') throw new NetError('unavailable', 'no WebSocket');
    this._roomName = roomName;
    this._stopped = false;
    this._attempt = 0;
    this._downSince = 0;
    this._connect();
    this._keepalive();
  }

  _connect() {
    if (this._stopped) return;
    let ws;
    try {
      ws = new this._WS(this._urlFor(this._roomName));
    } catch (err) {
      this._scheduleRetry();
      return;
    }
    this._ws = ws;
    this._lastRx = this.clock.now();
    ws.onopen = () => {
      this._attempt = 0;
      this._downSince = 0;
    };
    ws.onmessage = (ev) => {
      if (this._ws !== ws) return;
      this._lastRx = this.clock.now();
      let f;
      try {
        f = JSON.parse(typeof ev.data === 'string' ? ev.data : String(ev.data));
      } catch {
        return;
      }
      if (f && f.t === 'k') return;
      if (f && f.t === 'b' && this._faults) return this._faulty(f);
      this._onFrame(f);
    };
    ws.onerror = () => {};
    ws.onclose = (ev) => {
      if (this._ws !== ws) return;
      this._ws = null;
      this._onLinkDown();
      this._onSocketClosed(ev.code);
    };
  }

  _onSocketClosed(code) {
    if (this._stopped || this._closed) return;
    const err = CLOSE_TO_ERROR[code];
    if (err) {
      if (this._welcome) this._failOpen(new NetError(err));
      else this._onFatal('ended');
      this._stopped = true;
      return;
    }
    this._scheduleRetry();
  }

  _scheduleRetry() {
    if (this._stopped || this._closed) return;
    const now = this.clock.now();
    if (!this._downSince) this._downSince = now;
    if (now - this._downSince > GIVE_UP_MS) {
      this._stopped = true;
      if (this._welcome) this._failOpen(new NetError('transient', 'cannot reach the server'));
      else this._onFatal('ended');
      return;
    }
    const wait = Math.max(BACKOFF[Math.min(this._attempt, BACKOFF.length - 1)], this._blockUntil - now);
    this._attempt++;
    if (this._retryTimer !== null) this.clock.clearTimeout(this._retryTimer);
    this._retryTimer = this.clock.setTimeout(() => {
      this._retryTimer = null;
      this._connect();
    }, wait);
  }

  _keepalive() {
    if (this._kaTimer !== null) this.clock.clearTimeout(this._kaTimer);
    this._kaTimer = this.clock.setTimeout(() => {
      this._kaTimer = null;
      if (this._stopped || this._closed) return;
      const ws = this._ws;
      if (ws && ws.readyState === 1) {
        if (this.clock.now() - this._lastRx > SILENT_MS) {
          try {
            ws.close(4000, 'silent');
          } catch {}
        } else {
          try {
            ws.send('{"t":"k"}');
          } catch {}
        }
      }
      this._keepalive();
    }, KEEPALIVE_MS);
  }

  _linkSend(frame) {
    const ws = this._ws;
    if (!ws || ws.readyState !== 1) return false;
    try {
      ws.send(JSON.stringify(frame));
      return true;
    } catch {
      return false;
    }
  }

  async _linkClose() {
    this._stopped = true;
    if (this._retryTimer !== null) this.clock.clearTimeout(this._retryTimer);
    if (this._kaTimer !== null) this.clock.clearTimeout(this._kaTimer);
    this._retryTimer = this._kaTimer = null;
    const ws = this._ws;
    this._ws = null;
    if (!ws) return;
    if (ws.readyState === 0 || ws.readyState === 1) {
      await new Promise((resolve) => {
        const done = () => resolve();
        const timer = setTimeout(done, 1000);
        ws.onclose = () => {
          clearTimeout(timer);
          done();
        };
        try {
          ws.close(1000, 'bye');
        } catch {
          clearTimeout(timer);
          done();
        }
      });
    }
  }

  // ---------- test helpers ----------

  _faulty(f) {
    const q = this._faults;
    const rand = q.rand || Math.random;
    const copies = rand() < (q.dupRate || 0) ? 2 : 1;
    for (let k = 0; k < copies; k++) {
      if (rand() < (q.dropRate || 0)) continue;
      const [lo, hi] = q.delayMs || [0, 0];
      const d = lo + rand() * (hi - lo);
      if (d <= 0) this._onFrame(f);
      else this.clock.setTimeout(() => this._onFrame(f), d);
    }
  }

  /** Tests: drop the connection for `ms` (the server keeps the peer during its grace). */
  partition(ms) {
    const ws = this._ws;
    if (!ws) return false;
    this._blockUntil = this.clock.now() + ms;
    try {
      ws.close(4000, 'test partition');
    } catch {}
    return true;
  }
}
