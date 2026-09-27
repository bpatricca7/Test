// Multiplayer game integration test (docs/MULTIPLAYER.md §15, docs/teams/net.md): the REAL
// game adapter in three browser pages (a host and two guests, each in its own browser
// context, so each has its own storage and device id) playing through the real Railway
// relay (server/server.mjs on a local port, WsTransport picked by /api/net detection).
//
// The script builds the game, then: the host starts a world and hosts; both guests join with
// the code (knock -> admitted -> snapshot -> live). Then blocks and strokes, protected edits,
// furniture (bed + rotate, table + candle on top, doors and lamps toggled by a guest), a
// guest's Magic House (Flower Cottage) and the host's Sparkle Camper, a guest's garden
// (plant, water, the host grows it, harvest into her basket), zip towers placed by a guest
// (the host links them, the guests follow the host's link list), pets and NPC friends
// (puppets on guests, refusals), Undo on both sides, "Undo building" for a guest, and a guest
// reload that joins again. After each phase every page must reach the same state:
// equal block / entity / plant hashes, empty outboxes and predictions, no resyncs, zero
// console errors, and a guest never saves the host's world.
//
//   node tools/test-net-game.mjs [--no-build] [--headed] [--keep]
//
// Exit code 0 when everything passed. Screenshots: .shots/netgame-*.png.

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { launch, attachErrorCollectors, waitForTitle, waitForPlay, shot, ROOT } from './smoke.mjs';
import { createServer } from '../server/server.mjs';

const args = new Set(process.argv.slice(2));
const P = 'netgame';
const errors = [];
const t0 = Date.now();

function log(...a) {
  console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
}

function check(cond, message) {
  if (!cond) {
    errors.push('[check] ' + message);
    console.log('  FAIL: ' + message);
  } else console.log('  ok: ' + message);
  return !!cond;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Poll fn in the page until it returns truthy (or time out; returns the last value). */
async function until(page, fn, arg, timeout = 30000, poll = 200) {
  const end = Date.now() + timeout;
  let v;
  for (;;) {
    v = await page.evaluate(fn, arg);
    if (v || Date.now() > end) return v;
    await sleep(poll);
  }
}

// ---------- helpers that run in the page ----------

const G = {
  info: () => {
    const g = window.__game;
    return { mode: g.mode, loading: g.loading, busy: g._busy, state: g.net.state, role: g.net.role, code: g.net.code };
  },
  /** Everything that must be equal on every page, compactly. */
  view: () => {
    const g = window.__game;
    const E = g.entities;
    const ents = E.all().map((e) => [e.uid, e.key, e.x, e.y, e.z, e.rot, e.color || 0, JSON.stringify(e.data || {})].join('|')).sort();
    const plants = g.garden.all().map((p) => `${p.x},${p.y},${p.z}|${p.crop}|${p.stage}`).sort();
    const pets = g.pets.pets.map((p) => `${p.id}|${p.species}|${p.name}|${p.mode}`).sort();
    const friends = g.friends.friends.map((f) => `${f.id}|${f.key}|${f.mode}`).sort();
    const zip = g.outdoor.zip.links.map((l) => `${l.a}-${l.b}`).sort();
    return { hash: g.debug.net.hash(), ents: ents.length, entsText: ents.join('\n'), plants, pets, friends, zip };
  },
  quiet: () => {
    const g = window.__game, d = g.debug.net, s = d.stats();
    if (g.net.role === 'host') return { role: 'host', seq: d.seq(), dirty: s.host ? null : null };
    return { role: 'guest', ap: d.ap(), pend: d.pend(), outbox: d.outbox(), state: g.net.state, resyncs: s.resyncs };
  },
};

async function quiet(host, guests, label, timeout = 60000) {
  const end = Date.now() + timeout;
  let stableSince = 0;
  let last = '';
  for (;;) {
    const h = await host.evaluate(G.quiet);
    const gs = [];
    for (const g of guests) gs.push(await g.evaluate(G.quiet));
    const ok = gs.every((q) => q.ap === h.seq && q.pend === 0 && q.outbox === 0 && q.state === 'g.live');
    const key = JSON.stringify([h, gs]);
    if (ok && key === last) {
      if (!stableSince) stableSince = Date.now();
      if (Date.now() - stableSince > 1200) return true;
    } else stableSince = 0;
    last = key;
    if (Date.now() > end) {
      check(false, `${label}: pages settle (host seq ${h.seq}, guests ${JSON.stringify(gs)})`);
      return false;
    }
    await sleep(250);
  }
}

async function compare(host, guests, label) {
  const hv = await host.evaluate(G.view);
  let ok = true;
  for (let k = 0; k < guests.length; k++) {
    const gv = await guests[k].evaluate(G.view);
    const same = JSON.stringify(gv.hash) === JSON.stringify(hv.hash);
    if (!same) {
      ok = false;
      const he = hv.entsText.split('\n'), ge = gv.entsText.split('\n');
      const onlyH = he.filter((x) => !ge.includes(x)).slice(0, 5);
      const onlyG = ge.filter((x) => !he.includes(x)).slice(0, 5);
      console.log(`  ${label}: guest ${k + 1} hash ${JSON.stringify(gv.hash)} vs host ${JSON.stringify(hv.hash)}; entities only on host ${JSON.stringify(onlyH)}, only on guest ${JSON.stringify(onlyG)}`);
    }
    check(same, `${label}: guest ${k + 1} block / entity / plant hashes equal the host's ${JSON.stringify(hv.hash)}`);
    check(JSON.stringify(gv.plants) === JSON.stringify(hv.plants), `${label}: guest ${k + 1} plants equal (${hv.plants.length})`);
    check(JSON.stringify(gv.pets) === JSON.stringify(hv.pets), `${label}: guest ${k + 1} pets equal (${hv.pets.length})`);
    check(JSON.stringify(gv.friends) === JSON.stringify(hv.friends), `${label}: guest ${k + 1} NPC friends equal (${hv.friends.length})`);
    check(JSON.stringify(gv.zip) === JSON.stringify(hv.zip), `${label}: guest ${k + 1} zip links equal ${JSON.stringify(hv.zip)}`);
  }
  return ok;
}

async function settleAndCompare(host, guests, label) {
  await quiet(host, guests, label);
  return compare(host, guests, label);
}

// ---------- main ----------

async function main() {
  if (!args.has('--no-build')) {
    log('building');
    const r = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'build.mjs')], { stdio: 'inherit' });
    if (r.status !== 0) throw new Error('build failed');
  }
  const app = createServer({ log: () => {}, idleMs: 600000 });
  if (!app.page) throw new Error('dist/sparkle-world.html missing');
  const port = await app.listen(0, '127.0.0.1');
  const url = `http://127.0.0.1:${port}/`;
  log('server', url, 'build', app.page.build);

  const browser = await launch({ headed: args.has('--headed') });
  const pages = [];
  const open = async (label, viewport = { width: 1024, height: 700 }) => {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    attachErrorCollectors(page, errors, label);
    await page.goto(url);
    await waitForTitle(page);
    pages.push({ label, context, page });
    return page;
  };
  try {
    const host = await open('host', { width: 1280, height: 800 });
    const ga = await open('guestA');
    const gb = await open('guestB');
    const guests = [ga, gb];
    for (const [pg, name] of [[host, 'Lily'], [ga, 'Mia'], [gb, 'Zoe']]) {
      await pg.evaluate((n) => {
        const g = window.__game;
        g.profile.playerName = n;
        g.profile.look.name = n;
        // storage spy: a guest must never store the host's world
        const orig = g.store.saveWorld.bind(g.store);
        window.__savedIds = [];
        g.store.saveWorld = (save) => {
          window.__savedIds.push(save && save.id);
          return orig(save);
        };
      }, name);
    }

    // ----- host starts a world and hosts -----
    log('host: new world');
    await host.evaluate(() => window.__game.debug.newWorld({ biome: 'meadow', size: 'cozy', seed: 4242, name: 'Lily Land' }));
    await waitForPlay(host);
    await host.evaluate(() => window.__game.debug.waitIdle(60000));
    check(await host.evaluate(() => window.__game.net.detect()), 'the page finds the relay (/api/net) and multiplayer is available');
    log('host: hosting');
    const hosted = await host.evaluate(() => window.__game.net.host());
    check(hosted, 'the host is live (world saved, backup written, code picked)');
    const code = await host.evaluate(() => window.__game.net.code);
    check(Array.isArray(code) && code.length === 4, `the code is 4 pictures: ${JSON.stringify(code)}`);
    const backups = await host.evaluate(() => window.__game.store.listBackups());
    const worlds = await host.evaluate(() => window.__game.store.listWorlds());
    check(backups.length === 1 && backups[0].id.endsWith('.before'), 'a "before friends" backup exists');
    check(worlds.every((w) => !w.id.endsWith('.before')), 'My Worlds does not list the backup');

    // ----- guests join -----
    for (const [pg, name] of [[ga, 'guest A'], [gb, 'guest B']]) {
      log(`${name}: joining`);
      const started = await pg.evaluate((c) => window.__game.net.join(c), code);
      check(started, `${name} starts joining`);
      const knock = await until(host, () => window.__game.debug.net.knocks().map((k) => k.peer)[0] || null, null, 30000);
      check(!!knock, `the host sees ${name} knocking`);
      if (knock) await host.evaluate((p) => window.__game.debug.net.admit(p), knock);
      const live = await until(pg, () => {
        const g = window.__game;
        return g.net.state === 'g.live' && g.mode === 'play' && !g.loading && !g._busy;
      }, null, 90000);
      check(live, `${name} is in the host's world`);
      check(await pg.evaluate(() => window.__game.world.meta.shared === true && window.__game.world.meta.id.startsWith('net-')), `${name}'s world is the shared one`);
    }
    await settleAndCompare(host, guests, 'joined');
    await shot(ga, 'joined-guestA', P);

    // a spot in front of the host for everything (flat enough: the meadow near spawn)
    const spot = await host.evaluate(() => {
      const g = window.__game, p = g.player.position;
      return { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) };
    });
    const ground = (pg, x, z) => pg.evaluate(({ x, z }) => window.__game.world.heightAt(x, z), { x, z });

    // ----- blocks and strokes -----
    log('phase: blocks');
    await ga.evaluate(({ x, z }) => {
      const g = window.__game;
      for (let k = 0; k < 6; k++) {
        const h = g.world.heightAt(x + 3 + k, z + 3);
        g.placeBlock(x + 3 + k, h + 1, z + 3, 'planks_pink');
      }
      // a stroke: one history group of many cells
      g.historyGroup(() => {
        for (let k = 0; k < 12; k++) {
          const h = g.world.heightAt(x + 3 + k, z + 5);
          g.placeBlock(x + 3 + k, h + 1, z + 5, 'wool_sky');
        }
      });
    }, spot);
    await gb.evaluate(({ x, z }) => {
      const g = window.__game;
      for (let k = 0; k < 5; k++) {
        const h = g.world.heightAt(x - 4, z + k);
        g.removeBlock(x - 4, h, z + k); // natural ground: allowed for friends
      }
      g.historyGroup(() => {
        for (let k = 0; k < 8; k++) {
          const h = g.world.heightAt(x - 6, z + k);
          g.placeBlock(x - 6, h + 1, z + k, 'glass');
        }
      });
    }, spot);
    // the host builds a wall; a guest then tries to take one of its blocks (protected)
    const wall = await host.evaluate(({ x, z }) => {
      const g = window.__game;
      const cells = [];
      for (let k = 0; k < 4; k++) {
        const h = g.world.heightAt(x + 2, z - 4 - k);
        g.placeBlock(x + 2, h + 1, z - 4 - k, 'brick_red');
        cells.push([x + 2, h + 1, z - 4 - k]);
      }
      return cells;
    }, spot);
    await settleAndCompare(host, guests, 'blocks');
    const protectedCell = wall[1];
    await ga.evaluate(([x, y, z]) => window.__game.removeBlock(x, y, z), protectedCell);
    await settleAndCompare(host, guests, 'protected edit');
    const back = await ga.evaluate(([x, y, z]) => window.__game.debug.getBlock(x, y, z), protectedCell);
    check(back === 'brick_red' || back === 'brick_pink' || (back && back !== 'air'), `the host's wall block came back on the guest (${back})`);

    // ----- furniture -----
    log('phase: furniture');
    const hostFurn = await host.evaluate(({ x, z }) => {
      const g = window.__game, E = g.entities;
      const out = {};
      const put = (key, dx, dz, rot = 0) => {
        const h = g.world.heightAt(x + dx, z + dz);
        const e = E.place(key, x + dx, h + 1, z + dz, rot, null, {});
        return e ? e.uid : 0;
      };
      out.door = put('door', -2, -2);
      out.lamp = put('floor_lamp', -3, -1);
      return out;
    }, spot);
    check(hostFurn.door > 0 && hostFurn.lamp > 0, 'the host placed a door and a lamp');
    const guestFurn = await ga.evaluate(({ x, z }) => {
      const g = window.__game, E = g.entities;
      const put = (key, dx, dz, rot = 0) => {
        const h = g.world.heightAt(x + dx, z + dz);
        const e = E.place(key, x + dx, h + 1, z + dz, rot, null, {});
        return e;
      };
      const bed = put('bed_single', 4, -3);
      const table = put('table_round', 6, -1);
      let candle = null;
      if (table) {
        const def = E.defs.get('candle') ? 'candle' : 'table_lamp';
        candle = E.place(def, table.x, table.y + 1, table.z, 0, null, {});
      }
      // turn the bed before the host answered
      if (bed) E.rotate(bed);
      return { bed: bed ? bed.uid : 0, table: table ? table.uid : 0, candle: candle ? candle.uid : 0, rot: bed ? bed.rot : -1 };
    }, spot);
    check(guestFurn.bed >= 1000001 && guestFurn.bed < 2000000, `the guest's bed has a uid of her seat's range (${guestFurn.bed})`);
    check(guestFurn.candle > 0, 'a candle stands on the guest\'s table');
    // the other guest opens the host's door and switches the host's lamp (toggles are allowed)
    const seen = await until(gb, ({ door, lamp }) => !!(window.__game.entities.byUid(door) && window.__game.entities.byUid(lamp)), hostFurn, 20000);
    check(seen, 'guest B sees the host\'s door and lamp');
    await gb.evaluate(({ door, lamp }) => {
      const g = window.__game;
      g.setTool('hand');
      g.debug.interact(door);
      g.debug.interact(lamp);
    }, hostFurn);
    await settleAndCompare(host, guests, 'furniture');
    const doorOpen = await host.evaluate((uid) => window.__game.entities.byUid(uid).data.open, hostFurn.door);
    const lampOn = await host.evaluate((uid) => window.__game.entities.byUid(uid).data.on, hostFurn.lamp);
    check(doorOpen === true, 'the host\'s door is open on the host (a guest opened it)');
    check(lampOn === false, 'the host\'s lamp is off on the host (a guest switched it)');
    const bedRot = await host.evaluate((uid) => window.__game.entities.byUid(uid)?.rot, guestFurn.bed);
    check(bedRot === guestFurn.rot, `the guest's turned bed arrived turned (${bedRot})`);

    // ----- Magic Houses: a guest's cottage (intent) and the host's camper -----
    log('phase: Magic Houses');
    const histBefore = await host.evaluate(() => window.__game.history.length);
    const entsBefore = await host.evaluate(() => window.__game.entities.all().length);
    const cottage = await ga.evaluate(({ x, z }) => {
      const g = window.__game;
      const r = g.prefabs.place('cottage', x + 24, z + 2, { animate: true });
      return !!r;
    }, spot);
    check(cottage, 'the guest starts the Flower Cottage magic');
    const built = await until(host, (n) => window.__game.entities.all().length > n + 5, entsBefore, 40000);
    check(built, 'the host built the guest\'s cottage (furniture in the world)');
    check(await host.evaluate((n) => window.__game.history.length === n, histBefore), 'the host\'s Undo history is unchanged by the guest\'s house');
    await host.evaluate(({ x, z }) => window.__game.prefabs.place('sparkle_camper', x - 30, z - 20, { animate: false }), spot);
    await settleAndCompare(host, guests, 'Magic Houses');
    await shot(ga, 'houses-guestA', P);

    // ----- garden: plant, water, grow (host), harvest (guest) -----
    log('phase: garden');
    const bed0 = { x: spot.x + 8, z: spot.z - 8 };
    const planted = await ga.evaluate(({ x, z }) => {
      const g = window.__game;
      let n = 0;
      for (let k = 0; k < 3; k++) {
        const h = g.world.heightAt(x + k, z);
        if (g.debug.garden.plant('carrot', x + k, h, z)) n++;
      }
      const h = g.world.heightAt(x, z);
      g.setSlot(g.hotbar.index, 'tool:watering_can');
      g.debug.garden.water(x + 1, h, z);
      return n;
    }, bed0);
    check(planted === 3, `the guest planted 3 carrots (${planted})`);
    await settleAndCompare(host, guests, 'planted');
    const wetOnHost = await host.evaluate(() => window.__game.garden.wet.size);
    check(wetOnHost > 0, `the host adopted the guest's wet soil (${wetOnHost} wet cells with timers)`);
    await host.evaluate(() => window.__game.debug.garden.grow(400));
    await settleAndCompare(host, guests, 'grown');
    const ripe = await ga.evaluate(() => window.__game.garden.all().filter((p) => p.stage === 3).length);
    check(ripe === 3, `the guest sees 3 ripe carrots (${ripe})`);
    const basketBefore = await ga.evaluate(() => window.__game.profile.basket.carrot | 0);
    const hostBasket = await host.evaluate(() => window.__game.profile.basket.carrot | 0);
    await ga.evaluate(({ x, z }) => {
      const g = window.__game;
      for (const p of g.garden.all()) if (p.stage === 3 && p.z === z && p.x >= x && p.x < x + 2) g.debug.garden.harvest(p.x, p.y, p.z);
    }, bed0);
    await settleAndCompare(host, guests, 'harvested');
    const basketAfter = await ga.evaluate(() => window.__game.profile.basket.carrot | 0);
    check(basketAfter > basketBefore, `the guest's basket got carrots (${basketBefore} -> ${basketAfter})`);
    check(await host.evaluate(() => window.__game.profile.basket.carrot | 0) === hostBasket, 'the host\'s basket is unchanged');

    // ----- zip towers: placed by a guest, linked by the host -----
    log('phase: zip lines');
    const towers = await gb.evaluate(({ x, z }) => {
      const g = window.__game, E = g.entities;
      const def = E.defs.get('zipline_tower');
      const out = [];
      for (const [dx, dz] of [[-10, 12], [-22, 12], [-10, 16], [-24, 16], [-14, 20], [-26, 20]]) {
        if (out.length === 2) break;
        const h = g.world.heightAt(x + dx, z + dz);
        if (out.length === 1 && Math.abs(out[0].x - (x + dx)) < 6) continue;
        if (!E.canPlace(def, x + dx, h + 1, z + dz, 0)) continue;
        const e = E.place('zipline_tower', x + dx, h + 1, z + dz, 0, null, {});
        if (e) out.push({ uid: e.uid, x: e.x });
      }
      return out;
    }, spot);
    check(towers.length === 2, `guest B placed two zip towers (${JSON.stringify(towers)})`);
    await settleAndCompare(host, guests, 'zip towers');
    const links = await host.evaluate(() => window.__game.outdoor.zip.links.length);
    check(links >= 1, `the host linked the guest's towers (${links} zip line)`);

    // ----- pets and NPC friends: host-owned, puppets on guests -----
    log('phase: pets and friends');
    const pets = await host.evaluate(({ x, y, z }) => {
      const g = window.__game;
      return [g.debug.pets.adopt('puppy', null, 'Biscuit', x + 1.5, y + 0.5, z + 1.5), g.debug.pets.adopt('horse', null, 'Star', x - 1.5, y + 0.5, z + 1.5)];
    }, spot);
    const npc = await host.evaluate(({ x, y, z }) => window.__game.debug.friends.invite('mia', x + 2.5, y + 0.5, z - 1.5), spot);
    check(pets.every(Boolean) && !!npc, 'the host adopted a puppy and a horse and invited Mia');
    await settleAndCompare(host, guests, 'pets and friends');
    const puppet = await until(ga, (id) => {
      const p = window.__game.pets.byId(id);
      return p && p.netTarget ? { remote: window.__game.pets.remote, h: p.h } : null;
    }, pets[0], 20000);
    check(puppet && puppet.remote && puppet.h > 0, `guest pets are puppets following the host's samples (${JSON.stringify(puppet)})`);
    const refused = await ga.evaluate(({ horse, npc }) => {
      const g = window.__game;
      const p = g.pets.byId(horse);
      const f = g.friends.byId(npc);
      const rode = g.pets.mount(p);
      const moded = (g.friends.setMode(f, 'follow'), f.mode);
      const petted = g.pets.petPet(p);
      return { rode, moded, petted, riding: g.player.state === 'ride' };
    }, { horse: pets[1], npc });
    check(refused.rode === false && !refused.riding, 'a guest cannot ride the host\'s horse (refused with a toast)');
    check(refused.moded !== 'follow', 'a guest cannot make the host\'s NPC friend follow her');
    check(refused.petted === true, 'a guest can pet the host\'s pet (local hearts)');
    // the host moves a pet: guests follow the samples
    await host.evaluate((id) => {
      const g = window.__game, p = g.pets.byId(id);
      p.teleport(p.pos.x + 4, p.pos.y, p.pos.z + 1, false);
      g.pets.setMode(p, 'stay', { quiet: true });
    }, pets[0]);
    const followed = await until(ga, ([id, x]) => {
      const p = window.__game.pets.byId(id);
      return p && Math.abs(p.pos.x - x) < 0.6;
    }, [pets[0], await host.evaluate((id) => window.__game.pets.byId(id).pos.x, pets[0])], 20000);
    check(followed, 'the guest\'s puppy moved to where the host\'s puppy is');
    await settleAndCompare(host, guests, 'pet moved');

    // ----- undo on both sides; Undo building for guest B -----
    log('phase: undo');
    await ga.evaluate(() => { const g = window.__game; g.undo(); g.undo(); });
    await host.evaluate(() => window.__game.undo());
    await settleAndCompare(host, guests, 'undo');
    const undone = await host.evaluate(() => window.__game.debug.net.undoSeat(2));
    check(undone > 0, `the host took back guest B's building (${undone} groups)`);
    await settleAndCompare(host, guests, 'undo building');
    const hostUndo = await host.evaluate(() => window.__game.undo());
    check(hostUndo, 'the host\'s own Undo brings guest B\'s building back');
    await settleAndCompare(host, guests, 'undo of undo building');

    // ----- a guest reloads and joins again -----
    log('phase: guest reload');
    await gb.reload();
    await waitForTitle(gb);
    await gb.evaluate(() => {
      const g = window.__game;
      const orig = g.store.saveWorld.bind(g.store);
      window.__savedIds = window.__savedIds || [];
      g.store.saveWorld = (save) => {
        window.__savedIds.push(save && save.id);
        return orig(save);
      };
    });
    await gb.evaluate((c) => window.__game.net.join(c), code);
    const back2 = await until(gb, () => {
      const g = window.__game;
      return g.net.state === 'g.live' && g.mode === 'play' && !g.loading && !g._busy;
    }, null, 90000);
    check(back2, 'guest B is back after a reload (known friend: let in again without a knock card)');
    // she builds again after coming back (her uids must not clash with her earlier ones)
    const again = await gb.evaluate(({ x, z }) => {
      const g = window.__game, E = g.entities;
      const h = g.world.heightAt(x + 1, z + 9);
      const e = E.place('chair', x + 1, h + 1, z + 9, 0, null, {});
      g.placeBlock(x + 2, g.world.heightAt(x + 2, z + 9) + 1, z + 9, 'planks_pink');
      return e ? e.uid : 0;
    }, spot);
    const seatB = await gb.evaluate(() => window.__game.net.session.guestCore.seat);
    check(again > seatB * 1e6 && again < (seatB + 1) * 1e6, `guest B's new chair has a uid of her seat ${seatB} (${again})`);
    await settleAndCompare(host, [ga, gb], 'guest reload');
    await shot(host, 'end-host', P);
    await shot(gb, 'end-guestB', P);

    // ----- the rules that hold for the whole session -----
    for (const [pg, name] of [[ga, 'guest A'], [gb, 'guest B']]) {
      const ids = await pg.evaluate(() => window.__savedIds || []);
      check(ids.every((id) => !String(id).startsWith('net-')), `${name} never stored the host's world (${JSON.stringify(ids)})`);
      const st = await pg.evaluate(() => window.__game.debug.net.stats());
      check(st.resyncs === 0, `${name} needed no resync (${st.resyncs})`);
    }
    const hs = await host.evaluate(() => window.__game.debug.net.stats().host.stats);
    log('host stats', JSON.stringify({ batches: hs.batches, executed: hs.executed, rejected: hs.rejected, rejectCodes: hs.rejectCodes, snapshots: hs.snapshots, fixes: hs.fixes }));
    check(hs.dupExec === 0, 'no guest entry was executed twice');

    // ----- the host ends the session -----
    await host.evaluate(() => window.__game.net.leave());
    const home = await until(ga, () => window.__game.mode === 'title' && window.__game.net.state === 'idle', null, 30000);
    check(home, 'guest A goes back to the title when the host stops playing');
  } finally {
    if (!args.has('--keep')) {
      for (const p of pages) await p.context.close().catch(() => {});
      await browser.close().catch(() => {});
    }
    await app.close();
  }
}

main()
  .catch((err) => {
    errors.push('[fatal] ' + (err && err.stack ? err.stack : err));
  })
  .finally(() => {
    if (errors.length) {
      console.log(`\nNET GAME TEST FAILED with ${errors.length} problem(s):`);
      for (const e of errors) console.log(' - ' + e);
      process.exit(1);
    }
    console.log(`\nNET GAME TEST PASSED in ${((Date.now() - t0) / 1000).toFixed(0)} s: equal hashes on every page, no console errors.`);
    process.exit(0);
  });
