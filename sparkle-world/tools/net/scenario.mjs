// Property-test scenario shared by tools/test-net.mjs (docs/MULTIPLAYER.md §15.1):
// 1 host + 3 guests (FakeAdapter), seeded random actions, faults, then quiet and checks:
// equal worlds, empty outboxes and predictions, every guest entry processed exactly once,
// nothing done by a kicked seat after the kick, no limit or budget violation.
//
// Runs over the loop hub with a virtual clock (simNet) or over real WebSockets to
// server/server.mjs with the real clock (wsNet).

import { SimClock, NetHub, mulberry32 } from './hub.mjs';
import { FakeAdapter, B, CROPS } from './fake-adapter.mjs';
import { LoopTransport } from '../../src/net/loop-transport.js';
import { WsTransport } from '../../src/net/ws-transport.js';
import { NetSession } from '../../src/net/session.js';
import { realClock } from '../../src/net/transport.js';

export let VERBOSE = false;
export function setVerbose(v) {
  VERBOSE = !!v;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const track = (p) => {
  const s = { done: false, value: undefined, error: null };
  p.then((v) => { s.done = true; s.value = v; }, (e) => { s.done = true; s.error = e; });
  return s;
};
function assert(cond, msg) {
  if (!cond) throw new Error('assertion failed: ' + msg);
}

export function makeSession(ctx, name, uid, opts = {}) {
  const adapter = opts.adapter || new FakeAdapter({ name, empty: !!opts.guest, rand: ctx.rand });
  const session = new NetSession({
    adapter, clock: ctx.clock, rand: ctx.rand, build: opts.build || 'test',
    transport: () => ctx.transport(uid), options: { compression: false, trackExec: true, ...(opts.options || {}) },
    env: opts.env,
  });
  adapter.session = session;
  const messages = [];
  session.on('message', (m) => messages.push(m.code));
  return { name, uid, adapter, session, messages };
}

const ACTIONS = [
  ['stroke', 22], ['contend', 5], ['place', 8], ['cup', 4], ['rotate', 4], ['data', 6], ['remove', 5],
  ['undo', 8], ['plant', 5], ['water', 3], ['harvest', 4], ['sim', 6], ['prefab', 1.2], ['move', 10],
  ['emote', 1], ['sleep', 0.4], ['undoSeat', 0.25], ['rules', 0.4], ['partition', 0.35],
  ['reloadGuest', 0.15], ['restartHost', 0.04], ['kick', 0.06],
];
const ACTION_TOTAL = ACTIONS.reduce((s, a) => s + a[1], 0);
const STROKE_IDS = [B.air, B.planks, B.glass, B.wool, B.brick, B.grass, B.dirt, B.flower, B.water];

/**
 * net = { clock, advance(ms), transport(uid), partition(player, ms), violations(), hubStats(), close() }
 */
export async function scenario(seed, steps, net, { quietMs = 10000, maxQuietMs = 90000, label = '' } = {}) {
  const rand = mulberry32(seed);
  const ri = (n) => Math.floor(rand() * n);
  const pick = (list) => list[ri(list.length)];
  const ctx = { clock: net.clock, rand, transport: net.transport };
  const startAt = net.clock.now();
  const hostMaker = (adapter) => makeSession(ctx, 'Lily', 'u-host', { adapter, options: { autoAdmit: true } });
  let H = hostMaker(null);
  const hostCores = [];
  const counters = { acted: 0, skipped: 0, kicks: 0, reloads: 0, restarts: 0, partitions: 0, resyncHash: 0, resyncRs: 0, epochs: 0 };
  for (const [a] of ACTIONS) counters['n_' + a] = 0;

  const until = async (cond, ms) => {
    const end = net.clock.now() + ms;
    while (!cond()) {
      if (net.clock.now() > end) return false;
      await net.advance(50);
    }
    return true;
  };

  const waitP = async (p, ms = 30000) => {
    const t = track(p);
    await until(() => t.done, ms);
    if (!t.done) throw new Error('timed out');
    if (t.error) throw t.error;
    return t.value;
  };
  const h = track(H.session.host());
  if (!(await until(() => h.done, 20000)) || !h.value) throw new Error('host did not start');
  hostCores.push(H.session.hostCore);
  const code = H.session.code;
  const guests = [];
  let nextGuest = 1;
  const guestStats = [];
  const addGuest = async (uid, name) => {
    const G = makeSession(ctx, name, uid, { guest: true });
    G.alive = true;
    G.session.on('resync', (r) => { if (r.reason === 'hash') counters.resyncHash++; else counters.resyncRs++; });
    await waitP(G.session.join(code));
    guests.push(G);
    return G;
  };
  for (const nm of ['Mia', 'Zoe', 'Ava']) await addGuest('u-g' + nextGuest++, nm);
  if (!(await until(() => guests.every((g) => g.session.state === 'g.live'), 30000))) throw new Error('guests did not load: ' + guests.map((g) => g.session.state + '/' + g.messages).join(' '));

  const kicked = []; // { peer, host, count }
  let lastPartitionAt = -Infinity;
  let buildPausedUntil = -1;
  const hot = () => [8 + ri(16), 5 + ri(4), 8 + ri(16)];
  const alive = () => guests.filter((g) => g.alive && g.session.state !== 'idle');
  const canAct = (p) => p === H ? H.session.state === 'h.live' : p.session.state === 'g.live' && p.session.mayEdit('build');
  const retire = (g) => {
    g.alive = false;
    guestStats.push(g.session.guestCore ? g.session.guestCore.stats : null);
  };

  for (let step = 0; step < steps; step++) {
    // pick the action and who does it
    let r = rand() * ACTION_TOTAL;
    let act = ACTIONS[0][0];
    for (const [a, w] of ACTIONS) {
      r -= w;
      if (r < 0) {
        act = a;
        break;
      }
    }
    const players = [H, ...alive()];
    const who = pick(players);
    const ad = who.adapter;
    counters['n_' + act]++;
    if (buildPausedUntil >= 0 && step >= buildPausedUntil) {
      H.session.setRules({ build: 1 });
      buildPausedUntil = -1;
    }
    const acts = canAct(who);
    let did = true;
    switch (act) {
      case 'stroke': {
        if (!acts) { did = false; break; }
        const [x, y, z] = hot();
        const n = 1 + ri(12);
        const id = pick(STROKE_IDS);
        const alongX = rand() < 0.5;
        const list = [];
        for (let k = 0; k < n; k++) list.push(alongX ? [x + k, y, z, id] : [x, y, z + k, id]);
        ad.userCells(list);
        break;
      }
      case 'contend': {
        const [x, y, z] = hot();
        const others = alive().filter((g) => canAct(g));
        if (!canAct(H) || others.length === 0) { did = false; break; }
        H.adapter.userCells([[x, y, z, B.brick]]);
        const g = pick(others);
        g.adapter.userCells([[x, y, z, B.glass]]);
        g.session.frameEnd();
        break;
      }
      case 'place': {
        if (!acts) { did = false; break; }
        const [x, , z] = hot();
        ad.userPlace(pick(['table', 'chair', 'bed', 'door', 'lamp', 'easel', 'table']), x, 5, z, ri(4), pick([0, '#FFB6D9', '#AAD4FF']));
        break;
      }
      case 'cup': {
        if (!acts) { did = false; break; }
        const tables = Array.from(ad.ents.values()).filter((e) => e.key === 'table');
        if (!tables.length) { did = false; break; }
        const t = pick(tables);
        ad.userPlace('cup', t.x, t.y + 1, t.z, 0);
        break;
      }
      case 'rotate': case 'data': case 'remove': {
        if (!acts || ad.ents.size === 0) { did = false; break; }
        const e = pick(Array.from(ad.ents.values()));
        if (act === 'rotate') ad.userRotate(e.uid);
        else if (act === 'remove') ad.userRemove(e.uid);
        else if (e.key === 'door') ad.userData(e.uid, { open: !(e.data && e.data.open) });
        else if (e.key === 'lamp') ad.userData(e.uid, { on: !(e.data && e.data.on) });
        else if (e.key === 'easel') ad.userData(e.uid, { art: 'ab'.repeat(ri(40)) });
        else ad.userData(e.uid, { color2: pick(['a', 'b']) });
        break;
      }
      case 'undo':
        if (!acts) { did = false; break; }
        ad.userUndo();
        break;
      case 'plant': {
        if (!acts) { did = false; break; }
        const [x, , z] = hot();
        ad.userTill(x, 4, z);
        ad.userPlant(x, 5, z, pick(CROPS));
        break;
      }
      case 'water': {
        if (!acts) { did = false; break; }
        const [x, , z] = hot();
        ad.userWater(x, 4, z);
        break;
      }
      case 'harvest': {
        if (!acts) { did = false; break; }
        const ripe = Array.from(ad.plants.entries()).filter(([, p]) => p.stage === 3);
        if (!ripe.length) { did = false; break; }
        ad.userHarvest(pick(ripe)[0]);
        break;
      }
      case 'sim':
        if (H.session.state === 'h.live') H.adapter.sim(rand);
        break;
      case 'prefab': {
        if (!acts) { did = false; break; }
        const [x, , z] = hot();
        ad.userPrefab('hut', x, 5, z);
        break;
      }
      case 'move':
        ad.pos = [ri(30) + rand(), 5, ri(30) + rand(), rand() * 6];
        break;
      case 'emote':
        who.session.emote(pick(['wave', 'dance']));
        who.session.say(ri(16));
        break;
      case 'sleep':
        if (!acts) { did = false; break; }
        ad.userSleep();
        break;
      case 'undoSeat': {
        const seats = alive().map((g) => g.session.guestCore?.seat).filter(Boolean);
        if (!seats.length || H.session.state !== 'h.live') { did = false; break; }
        H.session.undoSeat(pick(seats));
        break;
      }
      case 'rules':
        if (H.session.state !== 'h.live') { did = false; break; }
        if (rand() < 0.5) {
          H.session.setRules({ build: 0 });
          buildPausedUntil = step + 20 + ri(60);
        } else H.session.setRules({ mine: H.session.rules.mine ? 0 : 1 });
        break;
      case 'partition':
        // faults stop with the actions: no partition may still be open when the quiet starts
        if (step > steps - 200) { did = false; break; }
        if (net.partition(who, 3000)) {
          counters.partitions++;
          lastPartitionAt = net.clock.now();
        }
        break;
      case 'reloadGuest': {
        const g = pick(alive());
        if (!g || g.session.state !== 'g.live') { did = false; break; }
        counters.reloads++;
        retire(g);
        await waitP(g.session.abandon());
        await addGuest(g.uid, g.name);
        break;
      }
      case 'restartHost': {
        if (H.session.state !== 'h.live' || step > steps * 0.9) { did = false; break; }
        counters.restarts++;
        const uids = alive().map((g) => g.uid);
        await waitP(H.session.abandon());
        H.adapter.undoStack = [];
        H = hostMaker(H.adapter);
        const h2 = track(H.session.host({ code, resume: true, uids }));
        if (!(await until(() => h2.done, 30000)) || !h2.value) throw new Error('host restart failed ' + H.messages);
        hostCores.push(H.session.hostCore);
        break;
      }
      case 'kick': {
        const g = pick(alive().filter((x) => x.session.state === 'g.live'));
        if (!g || kicked.length >= 1 || step > steps * 0.8) { did = false; break; }
        const peer = g.session.transport.selfId();
        const core = H.session.hostCore;
        H.session.kick(peer);
        kicked.push({ peer, core, count: core.execLog.get(peer)?.size ?? 0 });
        counters.kicks++;
        retire(g);
        // a new friend takes the free seat a little later
        await net.advance(500);
        await addGuest('u-g' + nextGuest++, 'Ivy');
        break;
      }
    }
    if (did) counters.acted++;
    else counters.skipped++;
    who.session.frameEnd();
    who.session.frame();
    await net.advance(5 + ri(30));
  }
  if (buildPausedUntil >= 0) H.session.setRules({ build: 1 });

  // ---------- quiet: wait, then assert ----------
  const quietStart = net.clock.now();
  const live = () => alive();
  const snapshotState = () => {
    const hv = H.adapter.view();
    const issues = [];
    if (H.session.state !== 'h.live') issues.push('host ' + H.session.state);
    const core = H.session.hostCore;
    for (const g of live()) {
      const gc = g.session.guestCore;
      if (g.session.state !== 'g.live') {
        issues.push(`${g.name} ${g.session.state}`);
        continue;
      }
      if (gc.outbox.length || gc.run) issues.push(`${g.name} outbox ${gc.outbox.length}`);
      if (gc.pendingCount()) issues.push(`${g.name} pend ${gc.pendingCount()}`);
      if (core && gc.ap !== core.journal.seq) issues.push(`${g.name} ap ${gc.ap}/${core.journal.seq}`);
      const gv = g.adapter.view();
      if (Buffer.compare(Buffer.from(gv.cells), Buffer.from(hv.cells)) !== 0) {
        let n = 0;
        for (let i = 0; i < hv.cells.length; i++) if (hv.cells[i] !== gv.cells[i]) n++;
        issues.push(`${g.name} cells differ (${n})`);
      }
      if (JSON.stringify(gv.ents) !== JSON.stringify(hv.ents)) issues.push(`${g.name} entities differ`);
      if (JSON.stringify(gv.plants) !== JSON.stringify(hv.plants)) issues.push(`${g.name} plants differ`);
      if (JSON.stringify(gv.actors) !== JSON.stringify(hv.actors)) issues.push(`${g.name} actors differ`);
    }
    return issues;
  };
  await net.advance(quietMs);
  let issues = snapshotState();
  const at10 = issues.length === 0;
  if (!at10 && VERBOSE) {
    console.log(`    seed ${seed}: at ${quietMs / 1000} s of quiet: ${issues.join('; ')}; last partition ${((quietStart - lastPartitionAt) / 1000).toFixed(1)} s before quiet`);
    for (const g of live()) {
      const t = g.session.transport;
      const hp = H.session.transport.peers().find((p) => p.id === t.selfId());
      console.log('      ' + g.name + ' ' + JSON.stringify(g.session.guestCore?.debug()) + ' fixParts ' + JSON.stringify(Array.from(g.session.guestCore?.fixParts || [], ([id, f]) => [id, f.from, f.upto, f.got, f.n])) +
        ` link up ${t._rawUp}/${t._debUp}; host sees nd=${hp?.state.nd} ep=${hp?.state.ep} rx=${JSON.stringify(hp?.state.rx)} updatedAt ${hp ? ((net.clock.now() - hp.updatedAt) / 1000).toFixed(1) : '-'} s ago; my stats ${JSON.stringify(t.stats())}; lastFix ${H.session.hostCore.lastFixAt.get(t.selfId()) ? ((net.clock.now() - H.session.hostCore.lastFixAt.get(t.selfId())) / 1000).toFixed(1) : '-'}`);
    }
    console.log('      host ' + JSON.stringify(H.session.hostCore?.debug().stats) + ' transport ' + JSON.stringify(H.session.transport.stats()));
    for (const [peer, fx] of H.session.hostCore.fixCache) console.log(`      fixCache ${peer} id ${fx.id} ${fx.from}..${fx.upto} parts ${fx.parts.length} age ${((net.clock.now() - fx.at) / 1000).toFixed(1)} s`);
  }
  while (issues.length && net.clock.now() - quietStart < maxQuietMs) {
    await net.advance(500);
    issues = snapshotState();
  }
  const quietTook = net.clock.now() - quietStart;
  if (issues.length) {
    const dbg = live().map((g) => JSON.stringify(g.session.guestCore?.debug())).join('\n');
    throw new Error(`${label} seed ${seed}: not converged after ${quietTook} ms: ${issues.join('; ')}\nhost ${JSON.stringify(H.session.hostCore?.debug())}\n${dbg}`);
  }
  // exactly once: no entry executed twice; every entry of every live guest executed
  let dup = 0;
  for (const core of hostCores) dup += core.stats.dupExec;
  assert(dup === 0, 'an entry was executed twice: ' + dup);
  const core = H.session.hostCore;
  for (const g of live()) {
    const gc = g.session.guestCore;
    const peer = g.session.transport.selfId();
    const done = core.execLog.get(peer) || new Set();
    for (let l = gc.epochBase + 1; l <= gc.lseq; l++) if (!done.has(l)) throw new Error(`${g.name}: entry ${l} never processed`);
  }
  for (const k of kicked) {
    const now = k.core.execLog.get(k.peer)?.size ?? 0;
    assert(now === k.count, `kicked seat changed the world after its kick (${k.count} -> ${now})`);
  }
  const v = net.violations();
  if (v.length) throw new Error('limit/budget violations: ' + JSON.stringify(v.slice(0, 5)));
  for (const g of live()) guestStats.push(g.session.guestCore.stats);
  let rejects = 0, fixes = 0, snapshots = 0, batches = 0;
  for (const s of guestStats) if (s) { rejects += s.rejects; fixes += s.fixes; snapshots += s.snapshots; batches += s.batches; }
  let executed = 0, rs = 0;
  for (const c of hostCores) { executed += c.stats.executed; rs += c.stats.rsForced; }
  if (counters.resyncHash) throw new Error('hash resyncs: ' + counters.resyncHash);
  const hs = net.hubStats();
  if (VERBOSE) {
    const codes = {}, kinds = {};
    for (const c of hostCores) {
      for (const [k, n] of Object.entries(c.stats.rejectCodes)) codes[k] = (codes[k] || 0) + n;
      for (const [k, n] of Object.entries(c.stats.executedKinds)) kinds[k] = (kinds[k] || 0) + n;
    }
    console.log(`    seed ${seed}: acted ${counters.acted}, skipped ${counters.skipped}; executed by kind ${JSON.stringify(kinds)}; rejects ${JSON.stringify(codes)}; hub ${JSON.stringify(hs)}; virtual ${((net.clock.now() - startAt) / 1000).toFixed(0)} s`);
  }
  for (const g of live()) await waitP(g.session.abandon());
  await waitP(H.session.abandon());
  return {
    seed, steps, acted: counters.acted, executed, rejects, batches, fixes, snapshots, rsForced: rs,
    resyncHash: counters.resyncHash, resyncRs: counters.resyncRs, kicks: counters.kicks, reloads: counters.reloads,
    restarts: counters.restarts, partitions: counters.partitions, convergedAt10s: at10, quietMs: quietTook, ...hs,
  };
}

export function simNet(seed) {
  const clock = new SimClock();
  const hub = new NetHub({
    clock, rand: mulberry32(seed ^ 0x5bd1e995), dropRate: 0.3, dupRate: 0.05, delayMs: [0, 800], presenceDelayMs: [0, 120],
  });
  return {
    clock,
    advance: (ms) => clock.advance(ms),
    transport: (uid) => new LoopTransport({ hub, clock, uid }),
    partition: (p, ms) => {
      const peer = p.session.transport?.selfId();
      return peer ? hub.partition(peer, ms) : false;
    },
    violations: () => hub.violations,
    hubStats: () => ({ maxEmit: hub.stats.maxEmit, maxState: hub.stats.maxState, dropped: hub.stats.dropped, duplicated: hub.stats.duplicated, maxPerSec: Math.max(0, ...Array.from(hub.links.values(), (l) => l.maxPerSec)) }),
    close: () => hub.close(),
  };
}

export function wsNet(port, seed) {
  const frand = mulberry32(seed ^ 0x2545f491);
  const transports = new Map();
  const clock = realClock;
  return {
    clock,
    advance: (ms) => sleep(ms),
    transport: (uid) => {
      const t = new WsTransport({ url: `ws://127.0.0.1:${port}`, uid, faults: { dropRate: 0.3, dupRate: 0.05, delayMs: [0, 800], rand: frand } });
      transports.set(t, uid);
      return t;
    },
    partition: (p, ms) => !!p.session.transport?.partition?.(ms),
    violations: () => {
      const v = [];
      for (const t of transports.keys()) {
        const s = t.stats();
        if (s.bigDropped) v.push({ kind: 'msg_bytes', n: s.bigDropped });
        for (const code of ['too_big', 'bad_state', 'bad_frame', 'bad_topic']) if (s.errors[code]) v.push({ kind: code, n: s.errors[code] });
      }
      return v;
    },
    hubStats: () => ({}),
    close: () => {},
  };
}
