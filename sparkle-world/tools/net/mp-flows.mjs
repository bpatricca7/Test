// Shared Playwright helpers for the multiplayer probes (tools/probe-multiplayer.mjs over the
// fake claude.ai room, tools/probe-railway.mjs over the real Railway server). Every flow is
// driven through the real UI with clicks (mouse pages) or taps (touch pages).
//
// A "player" is { key, name, touch, viewport, context, page }.

import { waitForPlay, waitIdle, settle, screenPoint } from '../smoke.mjs';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const game = (pl, fn, a) => pl.page.evaluate(fn, a);

/** Poll fn in the page until it returns truthy; returns the value (or the last falsy one). */
export async function until(pl, fn, a, timeout = 20000, poll = 200) {
  const end = Date.now() + timeout;
  let v;
  for (;;) {
    try {
      v = await pl.page.evaluate(fn, a);
    } catch (err) {
      v = null;
      if (!/Execution context was destroyed|navigation|Target closed/.test(String(err))) throw err;
    }
    if (v || Date.now() > end) return v;
    await sleep(poll);
  }
}

/**
 * Wait until the page has drawn `n` more frames. A page that just opened the title (or just
 * reloaded) compiles its shaders on its first 3D frame; with other game pages drawing through
 * the same SwiftShader GPU process that one frame can hold the page's main thread for half a
 * minute, and a tap sent meanwhile times out. Bounded: gives up after `timeout` ms.
 */
export async function drawn(pl, n = 2, timeout = 180000) {
  const page = pl.page || pl;
  const frames = page.evaluate((n) => new Promise((res) => {
    let left = Math.max(1, Math.min(10, n | 0));
    const f = () => (--left <= 0 ? res(true) : requestAnimationFrame(f));
    requestAnimationFrame(f);
  }), n).catch(() => false);
  let timer;
  const late = new Promise((res) => { timer = setTimeout(() => res(false), timeout); });
  const ok = await Promise.race([frames, late]);
  clearTimeout(timer);
  return ok;
}

/** Real tap (touch pages) or click (mouse pages). */
export async function press(pl, locator, { timeout = 15000 } = {}) {
  const l = typeof locator === 'string' ? pl.page.locator(locator).first() : locator;
  await l.waitFor({ state: 'visible', timeout });
  if (pl.touch) await l.tap();
  else await l.click();
}

/** Real tap / click at a page point. */
export async function pressAt(pl, x, y) {
  if (pl.touch) await pl.page.touchscreen.tap(x, y);
  else await pl.page.mouse.click(x, y);
}

/** Turn the camera toward a world point and tap it. */
export async function tapWorld(pl, [x, y, z], pitch = 0.5) {
  await game(pl, ([x, y, z, pitch]) => {
    const g = window.__game, p = g.player.position;
    g.cameraRig.yaw = Math.atan2(x - p.x, z - p.z);
    g.cameraRig.pitch = pitch;
  }, [x, y, z, pitch]);
  await settle(pl.page, 700);
  const s = await screenPoint(pl.page, x, y, z);
  if (!s) throw new Error('target behind the camera');
  await pressAt(pl, s.x, s.y);
  return s;
}

/** Name, look, quiet settings, a state trace, toasts, knock events and the storage spy. */
export async function setupPage(pl) {
  await pl.page.evaluate(({ name, seed }) => {
    const g = window.__game;
    const look = g.debug.avatar.random(seed);
    look.name = name;
    g.profile.look = look;
    g.profile.playerName = name;
    g.profile.nameSet = true; // she typed her name (a fresh profile is asked first)
    g.profile.tutorialDone = true;
    // SwiftShader renders on the CPU: draw the 3D at 1x (the UI stays sharp)
    g.profile.settings.quality = 'low';
    g.applySettings();
    g.saveProfile(true);
    g.events.emit('avatar:changed', { look });
    g.events.emit('profile:changed', { profile: g.profile });
    const t0 = performance.now();
    window.__netTrace = [];
    g.events.on('net:state', (s) => window.__netTrace.push([Math.round(performance.now() - t0), s.state]));
    g.events.on('world:load', () => window.__netTrace.push([Math.round(performance.now() - t0), 'world:load']));
    g.events.on('net:progress', (p) => { if (p.have === p.of) window.__netTrace.push([Math.round(performance.now() - t0), `snapshot ${p.of} chunks`]); });
    window.__knockEvents = 0;
    g.events.on('net:knock', () => window.__knockEvents++);
    window.__toasts = [];
    const toast = g.ui.toast.bind(g.ui);
    g.ui.toast = (text, opts) => {
      window.__toasts.push(String(text));
      return toast(text, opts);
    };
    window.__saves = [];
    const save = g.store.saveWorld.bind(g.store);
    g.store.saveWorld = (s, ...rest) => {
      window.__saves.push(s && s.id);
      return save(s, ...rest);
    };
  }, { name: pl.name, seed: pl.seed });
}

export async function trace(pl) {
  return game(pl, () => (window.__netTrace || []).map(([t, s]) => `${(t / 1000).toFixed(1)}s ${s}`).join(', '));
}

/** Host: New World (biome card) -> Create! -> Menu -> Play Together -> Make a Code; returns the code words. */
export async function hostMakesCode(host, { biome = 'flat', shot = null, log = () => {} } = {}) {
  const p = host.page;
  await press(host, 'button.sw-btn:has-text("New World")');
  await p.waitForSelector('.sw-panel-wrap.sw-open .sw-biome img[src]');
  if (biome !== 'meadow') await press(host, `.sw-panel-wrap.sw-open .sw-biome[data-biome="${biome}"]`);
  await press(host, 'button.sw-create');
  await waitForPlay(p);
  await waitIdle(p);
  await settle(p, 500);
  log('  host world ready');
  await press(host, '.sw-hud-tr button[aria-label="Menu"]');
  await p.waitForSelector('.sw-panel-wrap.sw-open .sw-pause-invite');
  await settle(p, 1200);
  if (shot) await shot(host, 'pause-invite');
  await press(host, '.sw-panel-wrap.sw-open .sw-pause-invite');
  // the Play with Friends card first (never a code at once), then Make a Code
  await p.waitForSelector('.sw-panel-wrap.sw-open .sw-net-invite');
  await settle(p, 1000);
  if (shot) await shot(host, 'play-together-card');
  await press(host, '.sw-panel-wrap.sw-open .sw-net-invite');
  await p.waitForSelector('.sw-panel-wrap.sw-open .sw-net-code-tiles:not(.sw-wait) .sw-net-tile[data-pic]', { timeout: 30000 });
  await settle(p, 800);
  return p.$$eval('.sw-panel-wrap.sw-open .sw-net-code-tiles .sw-net-tile[data-pic]', (els) => els.map((e) => e.dataset.pic));
}

/** Guest: Title -> Play with Friends -> Join a Code -> 4 pictures -> Go. */
export async function guestTypesCode(guest, code, { shot = null, onKeypad = null } = {}) {
  const p = guest.page;
  await p.waitForSelector('button.sw-title-friends:not([hidden])', { timeout: 15000 });
  if (shot) await shot(guest, `${guest.key}-title`);
  await press(guest, 'button.sw-title-friends');
  await p.waitForSelector('.sw-panel-wrap.sw-open .sw-net-join');
  if (shot) {
    await settle(p, 900);
    await shot(guest, `${guest.key}-start`);
  }
  await press(guest, '.sw-panel-wrap.sw-open .sw-net-join');
  await p.waitForSelector('.sw-panel-wrap.sw-open .sw-net-keypad:not([hidden])');
  for (let k = 0; k < code.length; k++) {
    await press(guest, `.sw-panel-wrap.sw-open .sw-net-key[data-pic="${code[k]}"]`);
    if (shot && k === 1) {
      await settle(p, 500);
      await shot(guest, `${guest.key}-keypad-2`);
    }
  }
  if (onKeypad) await onKeypad(guest);
  await press(guest, '.sw-panel-wrap.sw-open .sw-net-go');
}

/** Host: the knock card for `name` appears; "Let in!". Returns the card's small print. */
export async function hostLetsIn(host, name, { shot = null } = {}) {
  const p = host.page;
  const card = p.locator('.sw-net-knock', { hasText: name });
  await card.waitFor({ state: 'visible', timeout: 30000 });
  await settle(p, 900);
  if (shot) await shot(host, `knock-${name.toLowerCase()}`);
  const small = (await card.locator('.sw-net-knock-acct').textContent()) || '';
  await press(host, card.locator('.sw-net-yes'));
  return small;
}

export async function waitLive(pl, timeout = 150000) {
  return until(pl, () => {
    const g = window.__game;
    return g.mode === 'play' && !g.loading && !g._busy && g.net.state === 'g.live';
  }, null, timeout, 400);
}

/** Put a guest next to the host (a teleport, as if she walked there). */
export async function bringTo(guest, host, dx = 2, dz = 2) {
  const p = await game(host, () => { const q = window.__game.player.position; return [q.x, q.y, q.z]; });
  await game(guest, ([x, y, z]) => {
    const g = window.__game;
    g.player.teleport(x, y + 0.5, z);
    g.unstickPlayer();
  }, [p[0] + dx, p[1], p[2] + dz]);
}

/**
 * Close the open panel (never the title screen itself): on the title, back to the title (what
 * her X / back buttons lead to), else the world.
 */
export async function closePanels(pl) {
  await game(pl, () => {
    const g = window.__game, u = g.ui;
    if (!u.current || u.current === 'title') return;
    if (g.mode === 'title' && u.hasPanel('title')) u.open('title');
    else u.close();
  });
}

export const VIEW = () => {
  const g = window.__game;
  const E = g.entities;
  const ents = E.all().map((e) => [e.uid, e.key, e.x, e.y, e.z, e.rot, e.color || 0, JSON.stringify(e.data || {})].join('|')).sort();
  const plants = g.garden.all().map((p) => `${p.x},${p.y},${p.z}|${p.crop}|${p.stage}`).sort();
  const pets = g.pets.pets.map((p) => `${p.id}|${p.species}|${p.mode}`).sort();
  const friends = g.friends ? g.friends.friends.map((f) => `${f.id}|${f.key}`).sort() : [];
  const zip = g.outdoor ? g.outdoor.zip.links.map((l) => `${l.a}-${l.b}`).sort() : [];
  return { hash: g.debug.net.hash(), ents: ents.join('\n'), plants, pets, friends, zip };
};

export const QUIET = () => {
  const g = window.__game, d = g.debug.net;
  if (g.net.role === 'host') return { role: 'host', seq: d.seq(), state: g.net.state };
  return { role: 'guest', ap: d.ap(), pend: d.pend(), outbox: d.outbox(), state: g.net.state, loading: g.loading };
};

/**
 * Wait until every guest applied everything and nothing is pending, then compare all pages.
 * Returns { ok, hash, detail }.
 */
export async function converge(players, { timeout = 45000 } = {}) {
  const [host, ...guests] = players;
  const end = Date.now() + timeout;
  let stable = 0;
  let last = '';
  let q = null;
  for (;;) {
    const h = await game(host, QUIET);
    const gs = [];
    for (const g of guests) gs.push(await game(g, QUIET));
    q = { h, gs };
    const ok = gs.every((x) => x.ap === h.seq && x.pend === 0 && x.outbox === 0 && (x.state === 'g.live' || x.state === 'g.waiting') && !x.loading);
    const key = JSON.stringify(q);
    if (ok && key === last) {
      if (!stable) stable = Date.now();
      if (Date.now() - stable > 1200) break;
    } else stable = 0;
    last = key;
    if (Date.now() > end) return { ok: false, hash: null, detail: `pages never settled: ${JSON.stringify(q)}` };
    await sleep(300);
  }
  const hv = await game(host, VIEW);
  const diffs = [];
  for (const g of guests) {
    const gv = await game(g, VIEW);
    const same = JSON.stringify(gv.hash) === JSON.stringify(hv.hash) && gv.ents === hv.ents &&
      JSON.stringify([gv.plants, gv.pets, gv.friends, gv.zip]) === JSON.stringify([hv.plants, hv.pets, hv.friends, hv.zip]);
    if (!same) {
      const he = hv.ents.split('\n'), ge = gv.ents.split('\n');
      diffs.push(`${g.key} ${JSON.stringify(gv.hash)} vs host ${JSON.stringify(hv.hash)}; only host ${JSON.stringify(he.filter((x) => !ge.includes(x)).slice(0, 4))}; only ${g.key} ${JSON.stringify(ge.filter((x) => !he.includes(x)).slice(0, 4))}`);
    }
  }
  return { ok: diffs.length === 0, hash: hv.hash, detail: diffs.join(' | ') };
}
