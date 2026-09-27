// game.net: the minimal multiplayer facade (docs/MULTIPLAYER.md §9.1) with NO user interface.
// It wires the NetSession (net core) to the real game through the GameAdapter, and gives the
// game's hooks what they read (active, role, isHost / isGuest, remoteApplying, noHistory,
// hostFrozen, mayEdit, cellHasFriend, intent, frameEnd, refuse). The Friends panels, keypad,
// knock cards and remote avatars (src/net/index.js, ui.js, remote-players.js) build on it:
// see docs/teams/net.md "For Agent C".
//
// Nothing here touches the network until host() / join() / detect() is called, so playing
// alone is unchanged (no request at boot: detectTransportKind() may fetch /api/net).

import { NetSession } from './session.js';
import { createTransport, detectTransportKind, NetError } from './transport.js';
import { GameAdapter } from './adapter.js';
import { messageText, isCode } from './protocol.js';

/* global __SW_BUILD__ */
const BUILD = typeof __SW_BUILD__ === 'string' ? __SW_BUILD__ : 'dev';
const REFUSE_GAP = 4000;

/**
 * Install game.net and game.debug.net. opts (for the UI module / tests):
 *   sanitizeName   names shown to others (src/net/names.js); default: a basic sanitizer
 *   transport      () => NetTransport | Promise (overrides detection; tests)
 *   toastMessages  false: do not toast session messages (the UI shows its own cards)
 */
export function install(game, opts = {}) {
  const adapter = new GameAdapter(game, { sanitizeName: opts.sanitizeName });
  let kind; // undefined: not detected yet; null: unavailable
  let detecting = null;

  async function detect() {
    if (opts.transport) return true;
    if (kind !== undefined) return !!kind;
    if (!detecting) {
      detecting = detectTransportKind(globalThis).then((k) => {
        kind = k || null;
        net.kind = kind;
        net.available = !!kind;
        game.events.emit('net:state', { state: session.state, role: session.role, count: 0 });
        return !!kind;
      });
    }
    return detecting;
  }

  async function makeTransport() {
    if (opts.transport) return opts.transport();
    await detect();
    if (!kind) throw new NetError('unavailable');
    return createTransport(kind);
  }

  const env = {
    /** Save the world, then its "before friends" backup; both must be stored. */
    async prepareHost() {
      if (game.mode !== 'play' || !game.world || game.loading || game._isShared()) return { ok: false };
      const save = game._serializeWorld({ thumbnail: true });
      const main = await game._storeWorld(save);
      if (!main || !main.ok) return { ok: false };
      const backup = { ...save, id: save.id + '.before', backupOf: save.id, backupAt: Date.now() };
      const res = await game.store.saveWorld(backup);
      return res && res.ok ? { ok: true } : { ok: false };
    },
    async saveHost({ final = false } = {}) {
      if (game.mode !== 'play' || !game.world || game._isShared()) return;
      await game.saveWorld({ thumbnail: !!final });
    },
    saveLastHost(info) {
      const p = game.profile;
      p.net = { ...(p.net || {}), lastHost: { code: info.code, worldId: game.world ? game.world.meta.id : null, at: info.at, uids: info.uids || [] } };
      game.saveProfile();
    },
    saveLastJoin(info) {
      const p = game.profile;
      p.net = { ...(p.net || {}), lastJoin: { code: info.code, hostName: adapter.sanitizeName(info.hostName, 'Friend'), at: info.at } };
      game.saveProfile();
    },
    exitToTitle: () => game.exitToTitle(),
  };

  const session = new NetSession({
    adapter,
    transport: () => makeTransport(),
    build: BUILD,
    env,
    options: { autoAdmit: false },
  });

  const refusedAt = new Map();

  const net = {
    available: opts.transport ? true : null, // null: not checked yet (see detect())
    kind: null,
    session,
    adapter,
    actors: adapter.actors,
    build: BUILD,
    get active() { return session.state !== 'idle'; },
    get state() { return session.state; },
    get role() { return session.role; },
    get isHost() { return session.role === 'host'; },
    get isGuest() { return session.role === 'guest'; },
    get remoteApplying() { return session.remoteApplying; },
    get noHistory() { return session.noHistory; },
    get hostFrozen() { return session.hostFrozen; },
    get code() { return session.code; },
    /** The host's name as shown here (sanitized), '' when not a guest. */
    get hostName() {
      const g = session.guestCore;
      return g ? adapter.sanitizeName(g.hostName, 'your friend') : '';
    },
    detect,
    /** Start hosting the loaded world. opts: { code, resume, uids }. */
    host: (o) => session.host(o),
    /** Join a friend's world by its 4 picture words. */
    join: (code) => (isCode(code) ? session.join(code) : Promise.resolve(false)),
    leave: (o) => session.leave(o),
    mayEdit: (tool) => session.mayEdit(tool),
    /** Does any other player's avatar (from presence) overlap block cell (x, y, z)? */
    cellHasFriend(x, y, z) {
      if (session.state === 'idle') return false;
      for (const pl of session.players()) {
        if (pl.you || !Array.isArray(pl.pos)) continue;
        const [px, py, pz] = pl.pos;
        if (px + 0.3 > x && px - 0.3 < x + 1 && pz + 0.3 > z && pz - 0.3 < z + 1 && py + 1.7 > y && py < y + 1) return true;
      }
      return false;
    },
    intent: (kind, args) => session.intent(kind, args || []),
    frameEnd() {
      if (session.state === 'idle') return;
      session.frameEnd();
      session.frame();
    },
    players: () => session.players(),
    emote: (name) => session.emote(name),
    say: (id) => session.say(id),
    on: (name, fn) => session.on(name, fn),
    /**
     * A friend asked for something only the host may do: a short, friendly toast (at most
     * one per kind every 4 s). kind: 'paused' | 'pet' | 'npc'.
     */
    refuse(kind) {
      const now = performance.now();
      if (now - (refusedAt.get(kind) ?? -Infinity) < REFUSE_GAP) return;
      refusedAt.set(kind, now);
      const host = net.hostName || 'your friend';
      let text = '';
      if (kind === 'paused') text = messageText('paused', { host });
      else if (kind === 'pet') text = messageText('pet_owner', { host });
      else if (kind === 'npc') text = `That's ${host}'s friend! Ask ${host} to help.`;
      if (text) game.toast(text, { icon: 'heart' });
    },
  };
  game.net = net;

  // session -> game events (the UI listens to these)
  session.on('state', (s) => game.events.emit('net:state', s));
  session.on('message', (m) => {
    game.events.emit('net:message', m);
    if (opts.toastMessages !== false && m && m.text) game.toast(m.text, { icon: 'heart', duration: 5000 });
  });
  for (const name of ['knock', 'knock-gone', 'players', 'reject', 'intent', 'resync', 'progress', 'status', 'summary', 'snapshot-failed']) {
    session.on(name, (p) => game.events.emit('net:' + name, p));
  }
  // the player's own emotes show on friends' pages
  game.events.on('emote', ({ name }) => { if (session.state !== 'idle') session.emote(name); });

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => session.setHidden(document.hidden));
  }
  if (typeof window !== 'undefined') {
    // a reload or a new version: drop the session at once (friends wait for the host to return)
    window.addEventListener('pagehide', (e) => {
      if (!e.persisted && session.state !== 'idle') session.abandon();
    });
  }

  installDebug(game, net, session, adapter);
  return net;
}

function installDebug(game, net, session, adapter) {
  if (!game.debug) return;
  const g = () => session.guestCore;
  const h = () => session.hostCore;
  game.debug.net = {
    state: () => session.state,
    role: () => session.role,
    code: () => session.code,
    seq: () => (h() ? h().journal.seq : null),
    ap: () => (g() ? g().ap : null),
    pend: () => (g() ? g().pendingCount() : 0),
    outbox: () => session.sending(),
    hash: () => session.hashes(),
    stats: () => session.stats(),
    peers: () => (session.transport ? session.transport.peers().map((p) => ({ id: p.id, uid: p.uid, self: p.self, r: p.state.r, nm: p.state.nm })) : []),
    players: () => session.players().map((p) => ({ peer: p.peer, seat: p.seat, name: p.name, you: p.you, host: p.host, pos: p.pos })),
    knocks: () => session.knocks(),
    admit: (peer) => session.admit(peer),
    admitAll: (on = true) => session.setAutoAdmit(on),
    kick: (peer) => session.kick(peer),
    undoSeat: (seat) => session.undoSeat(seat),
    setRules: (r) => session.setRules(r),
    host: (o) => net.host(o),
    join: (code) => net.join(code),
    leave: (o) => net.leave(o),
    /**
     * Test only: change a cell the way an unhooked code path would (the block hash sees it,
     * but it is never sent): the safety net must notice and resync.
     */
    corruptCell(i, id) {
      const w = game.world;
      if (!w) return false;
      const [x, y, z] = adapter.coords(i);
      const was = game._inSystems;
      game._inSystems = true;
      try {
        return w.set(x, y, z, id, { record: false });
      } finally {
        game._inSystems = was;
      }
    },
  };
}
