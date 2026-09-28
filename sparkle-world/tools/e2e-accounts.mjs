// Family accounts end to end (docs/ACCOUNTS.md §12.8, owner D): `npm run e2e:accounts`.
//
//   node tools/e2e-accounts.mjs [--only=1,2,5] [--headed] [--shots-prefix=acct] [--allow-missing]
//
// Starts a local Postgres (tools/testdb.mjs, a database URL: the server is its own program),
// the Stripe fake (tools/stripe-fake/, owner B; nothing talks to Stripe) and server/server.mjs
// with SW_ACCOUNTS=required, SW_TEST=1, MAIL_MODE=memory (emails are read back with
// GET /api/test/mail), SW_TRIAL_DAYS=7 (so the free week AND "Start today" are both driven)
// and the home page built for that mode, like probe-railway.mjs does. Chromium only (WebKit
// cannot be downloaded offline; the iPad checks are the family's, §14 step 8). Each browser
// context counts as its own home internet address (X-Forwarded-For: the server trusts a proxy
// on 127.0.0.1, as behind Railway's), so the per-address limits behave like real families.
// Zero console errors, apart from the answers a scenario expects (listed where they happen).
// Screenshots: .shots/<prefix>-*.png at 390 px, iPad and desktop.
//
//  1. Parent A signs up (the code from the capture), agrees, Start your free week, the fake's
//     Pay, back: "Free week"; adds Lily and Mia; their pictures are empty bubbles.
//  2. A new "iPad" seeded with 2 worlds from before accounts: /play → "Ask a grown-up" → I have
//     a code (read from A's Family page) → Who's playing → Lily → the import card → both worlds
//     in Lily's cloud (through the API) → she builds → Save & Exit.
//  3. A "computer" pairs → Lily → the world is there with its blocks. The iPad's site data is
//     cleared: reloaded, the world comes back from the cloud.
//  4. Both edit the same world offline (the API blocked), then reconnect: a "(copy)" world,
//     nothing lost.
//  5. Friends: in the free week Lily's switch is locked; Start now (email check) → verified →
//     on. Family B does the same with Start today. Lily hosts, B's June joins with the code →
//     Let in! → they build; hashes equal. A name change by June's page is ignored. Family C
//     (never subscribed): the resting card, no knock reaches Lily. The game never shows "$" or
//     "subscri" in any state.
//  6. Walkie (the relay itself, with the kids' device cookies): Lily's on, June's off → June
//     gets 0 voice bytes; B switches June's on → the perm frame → she talks and hears; off
//     again → nothing within 1 s.
//  7. Billing life: the renewal fails → "Payment didn't go through" → grace passes → Lily's
//     socket closes with 4402, the game shows the resting card, cloud writes refused, worlds
//     readable; B's Portal: Cancel at period end → "Ends …" → the period ends → resting.
//  8. A deletes Mia → Mia's device gets 410, its copy is wiped → the picker.
//  9. A deletes the account → nothing of A in any table, the fake's customer deleted, the
//     account_deleted email, A's devices get 410 family_gone and wipe.
// 10. Regression: /play from file:// makes no /api request; a window.claude stand-in makes no
//     /api/me request; SW_ACCOUNTS=optional: signed-out devices play, and play together, as today.
//
// The parts of builders A (sign-in, family, test hooks), B (billing, the Stripe fake) and C
// (the game's account module, saves) must be in the tree: a scenario whose parts are missing
// is reported as NOT RUN and the run fails (exit 2), never a silent pass (--allow-missing
// exits 0 for a partial tree).

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { launch, waitForTitle, waitForPlay, waitIdle, settle, ROOT, SHOTS, PAGE_URL } from './smoke.mjs';
import { sleep, game, until, press, setupPage, hostMakesCode, guestTypesCode, hostLetsIn, waitLive, bringTo, converge } from './net/mp-flows.mjs';
import { buildSite } from './site-build.mjs';
import { devEnv, loadStripeFake } from './dev-accounts.mjs';
import { W as WIRE, F_START, packFrame } from '../src/net/walkie/wire.js';

const argv = process.argv.slice(2);
const arg = (k, d = null) => {
  const a = argv.find((x) => x.startsWith(`--${k}=`));
  return a ? a.slice(k.length + 3) : argv.includes(`--${k}`) ? true : d;
};
const PREFIX = arg('shots-prefix', 'acct');
const ONLY = arg('only') ? new Set(String(arg('only')).split(',').map(Number)) : null;
const errors = [];
const T0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - T0) / 1000).toFixed(1).padStart(6)}s]`, ...a);
let passed = 0;

function check(cond, message) {
  if (cond) {
    passed++;
    console.log('    ok: ' + message);
  } else {
    console.log('    FAIL: ' + message);
    errors.push('[check] ' + message);
  }
  return !!cond;
}

// ---------------------------------------------------------------------------------------------
// what each scenario needs (docs/ACCOUNTS.md §15.1)

const PARTS = {
  auth: ['server/auth.mjs', 'A: sign-in, sessions, pairing'],
  family: ['server/family.mjs', 'A: /api/me, family, players'],
  hooks: ['server/test-hooks.mjs', 'A: /api/test/*'],
  mail: ['server/mail.mjs', 'A: the outbox (memory transport)'],
  billing: ['server/billing.mjs', 'B: checkout, sync, portal, webhooks'],
  stripe: ['server/stripe.mjs', 'B: the Stripe client'],
  stripeFake: ['tools/stripe-fake', 'B: the Stripe fake'],
  saves: ['server/saves.mjs', 'C: the saves API'],
  client: ['src/account/index.js', "C: the game's account module"],
};
const has = (k) => existsSync(path.join(ROOT, PARTS[k][0]));
const ACCOUNT_BASE = ['auth', 'family', 'hooks', 'mail', 'billing', 'stripe', 'stripeFake'];
const NEEDS = {
  1: ACCOUNT_BASE,
  2: [...ACCOUNT_BASE, 'saves', 'client'],
  3: [...ACCOUNT_BASE, 'saves', 'client'],
  4: [...ACCOUNT_BASE, 'saves', 'client'],
  5: [...ACCOUNT_BASE, 'client'],
  6: ACCOUNT_BASE,
  7: [...ACCOUNT_BASE, 'saves', 'client'],
  8: [...ACCOUNT_BASE, 'saves', 'client'],
  9: [...ACCOUNT_BASE, 'client'],
  10: [],
};
// later scenarios build on earlier ones (the same families and devices)
const AFTER = { 2: [1], 3: [1, 2], 4: [1, 2, 3], 5: [1, 2], 6: [1, 5], 7: [1, 2, 5], 8: [1], 9: [1, 2] };

// ---------------------------------------------------------------------------------------------
// servers

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

const SERVER_LOG = []; // every line any server of this run printed (the log spy below)

/** server/server.mjs as its own program; stopped only by its own PID. */
async function startServer(port, env) {
  const child = spawn(process.execPath, [path.join(ROOT, 'server', 'server.mjs')], {
    cwd: ROOT,
    env: { ...process.env, ...env, PORT: String(port), HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const lines = SERVER_LOG;
  child.stdout.on('data', (d) => { lines.push(String(d)); if (arg('verbose')) process.stdout.write('    [server] ' + d); });
  child.stderr.on('data', (d) => { lines.push(String(d)); process.stdout.write('    [server!] ' + d); });
  child.lines = lines;
  const end = Date.now() + 30000;
  while (Date.now() < end) {
    if (child.exitCode !== null) throw new Error('the server stopped: ' + lines.join('').slice(-400));
    try {
      if ((await fetch(`http://127.0.0.1:${port}/healthz`)).ok) return child;
    } catch {}
    await sleep(150);
  }
  child.kill('SIGKILL');
  throw new Error('the server did not start');
}

function stopServer(child) {
  return new Promise((resolve) => {
    if (!child || child.exitCode !== null) return resolve();
    child.once('exit', () => resolve());
    child.kill('SIGTERM');
    setTimeout(() => child.exitCode === null && child.kill('SIGKILL'), 5000).unref();
  });
}

// ---------------------------------------------------------------------------------------------
// the run's shared state

const R = {
  port: 0,
  base: '',
  env: null,
  db: null,
  stripe: null,
  server: null,
  browser: null,
  siteDir: null,
  ips: 10,
  fam: {}, // A, B, C: { email, ctx, page, ids: { Lily, Mia, June } }
  dev: {}, // ipad, computer, mia, june: { ctx, page, key, name, touch }
  unexpectedImport: new Set(), // devices that were asked about "worlds from before" wrongly
};

async function api(p, { method = 'GET', body, cookie = null, ip = '203.0.113.250' } = {}) {
  const headers = { 'X-Forwarded-For': ip };
  if (cookie) headers.Cookie = cookie;
  if (method !== 'GET') Object.assign(headers, { 'Content-Type': 'application/json', 'X-SW': '1', Origin: R.base });
  const res = await fetch(R.base + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  let data = null;
  try {
    data = await res.json();
  } catch {}
  return { status: res.status, data };
}

/**
 * How many emails `to` has had so far: a mark taken before an action, so the code the action
 * sends is found after it (the capture's times are the app clock's, which the test moves).
 */
async function mailMark(to) {
  return (await mailsTo(to)).length;
}

/** The newest 6-digit code emailed to `to` after the mark `since` (the memory outbox). */
async function codeFor(to, { since = 0, template = null } = {}) {
  const end = Date.now() + 20000;
  while (Date.now() < end) {
    const list = await mailsTo(to);
    const m = list.slice(since).filter((x) => !template || x.template === template).at(-1);
    const code = m && /\b(\d{6})\b/.exec(`${m.subject || ''} ${m.text || ''}`);
    if (code) return code[1];
    await sleep(250);
  }
  throw new Error(`no code emailed to ${to}`);
}

async function mailsTo(to) {
  const r = await api(`/api/test/mail?to=${encodeURIComponent(to)}`);
  return Array.isArray(r.data) ? r.data : [];
}

/** Move the app clock and the Stripe fake's clock together (§12.5). */
async function passDays(days) {
  const r = await api('/api/test/clock', { method: 'POST', body: { offsetMs: (R.clockDays = (R.clockDays || 0) + days) * 86400e3 } });
  check(r.status === 200, `the app clock moves ${days} days (now +${R.clockDays} d)`);
  if (R.stripe && typeof R.stripe.advance === 'function') await R.stripe.advance(days);
}

const cookieOf = async (ctx) => (await ctx.cookies(R.base)).map((c) => `${c.name}=${c.value}`).join('; ');

async function newContext(label, { w = 1024, h = 768, touch = true } = {}) {
  const ctx = await R.browser.newContext({
    viewport: { width: w, height: h },
    hasTouch: touch,
    isMobile: touch,
    deviceScaleFactor: 1,
    extraHTTPHeaders: { 'X-Forwarded-For': `203.0.113.${R.ips++}` },
  });
  ctx.label = label;
  // the game is one 2 MB page drawn by SwiftShader on a shared CPU: loading it can take long
  ctx.setDefaultNavigationTimeout(120000);
  return ctx;
}

async function newPage(ctx, key, { allow = [] } = {}) {
  const page = await ctx.newPage();
  const errs = [];
  // like smoke.mjs's collectors, with the address of a resource that failed to load (the
  // browser's own favicon.ico request on the Stripe fake's pages is not ours)
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const url = (msg.location() && msg.location().url) || '';
    if (/\/favicon\.ico$/.test(url)) return;
    errs.push(`[${key}] console.error: ${msg.text()}${url ? ` (${url})` : ''}`);
  });
  page.on('pageerror', (err) => errs.push(`[${key}] pageerror: ${err.message}\n${err.stack || ''}`));
  page.on('requestfailed', (req) => {
    if (/\/favicon\.ico$/.test(req.url())) return;
    // a request the page itself gave up because it reloaded (the scenarios reload on purpose)
    if (req.failure() && req.failure().errorText === 'net::ERR_ABORTED') return;
    errs.push(`[${key}] request failed: ${req.url()} ${req.failure() ? req.failure().errorText : ''}`);
  });
  // a 409 on a player's profile is the cloud saves' normal merge (§7.4): the game merges and pushes again
  page.baseAllow = [/409.*\/api\/players\/[^ ]*\/profile/, ...allow];
  page.allow = [...page.baseAllow];
  page.on('response', (res) => {
    if (res.status() >= 400 && !page.allow.some((re) => re.test(`${res.status()} ${res.url()}`))) errors.push(`[${key}] HTTP ${res.status()} ${res.url()}`);
  });
  page.errs = errs;
  page.flushErrors = () => {
    for (const e of errs.splice(0)) if (!page.allow.some((re) => re.test(e))) errors.push(e);
  };
  return page;
}

async function shot(page, name, full = false) {
  await mkdir(SHOTS, { recursive: true });
  const file = path.join(SHOTS, `${PREFIX}-${name}.png`);
  try {
    await page.screenshot({ path: file, fullPage: full, timeout: 60000 });
    console.log(`    screenshot ${path.relative(ROOT, file)}`);
  } catch (err) {
    console.log(`    (screenshot ${name} failed: ${String(err.message).split('\n')[0]})`);
  }
}

/** The game's words a kid must never see (§7.9). */
async function noPriceInGame(page, where) {
  const text = await page.evaluate(() => document.body.innerText || '');
  check(!/\$|subscri/i.test(text), `${where}: the game shows no "$" and no "subscri…"`);
}

// ---------------------------------------------------------------------------------------------
// the Family page (site/account.js; this builder's own page)

const FP = {
  async signIn(page, email) {
    await page.goto(`${R.base}/account`);
    await page.waitForSelector('#email');
    const since = await mailMark(email);
    await page.fill('#email', email);
    await page.click('button[type=submit]');
    await page.waitForSelector('.code-boxes');
    await page.locator('#code').fill(await codeFor(email, { since }));
  },
  async agree(page) {
    await page.waitForSelector('#agree', { timeout: 20000 });
    await page.check('#agree');
    await page.getByRole('button', { name: 'Agree and continue' }).click();
    await page.waitForSelector('#us');
  },
  /** On the plan card: tick the US box and start (trial or not) → the Stripe fake → pay → back. */
  async buy(page, { trial }) {
    await page.check('#us');
    await page.getByRole('button', { name: trial ? /Start your free week/ : /Start today|Start the Family Plan/ }).first().click();
    await page.waitForURL((u) => !u.href.startsWith(R.base + '/account'), { timeout: 30000 });
    await shot(page, `stripe-fake-checkout-${trial ? 'trial' : 'today'}`);
    // the fake's hosted page: "Pay (4242)", United States first (§12.3)
    await page.getByRole('button', { name: /Pay/ }).or(page.getByRole('link', { name: /Pay/ })).first().click();
    await page.waitForURL((u) => u.href.startsWith(R.base + '/account'), { timeout: 30000 });
    await page.waitForSelector('.all-set', { timeout: 30000 });
  },
  async addPlayer(page, nickname, { first = false } = {}) {
    if (first) await page.getByRole('button', { name: 'Add your first player' }).click();
    else await page.click('.player-add');
    await page.waitForSelector('#nick');
    await page.fill('#nick', nickname);
    await page.locator('#nick').press('Enter');
    await page.locator('article.player', { hasText: nickname }).waitFor({ timeout: 20000 });
  },
  /** Answer the email check if it opens (a code sent to `email`). */
  async passCheck(page, email, since) {
    const open = await page.waitForSelector('dialog .code-boxes', { timeout: 4000 }).then(() => true, () => false);
    if (!open) return false;
    await page.locator('dialog:has(.code-boxes) #code').fill(await codeFor(email, { since, template: 'check' }));
    await page.waitForSelector('dialog .code-boxes', { state: 'detached', timeout: 20000 });
    return true;
  },
  switchOf(page, nickname, which) {
    return page.locator('article.player', { hasText: nickname }).locator('.switch').nth(which === 'walkie' ? 1 : 0);
  },
  async setSwitch(page, email, nickname, which, on) {
    const sw = FP.switchOf(page, nickname, which);
    if ((await sw.getAttribute('aria-checked')) === String(on)) return;
    const since = await mailMark(email);
    await sw.click();
    if (on) await FP.passCheck(page, email, since);
    await page.waitForFunction(([n, w, v]) => {
      const card = [...document.querySelectorAll('article.player')].find((a) => a.querySelector('h3').textContent === n);
      return card && card.querySelectorAll('.switch')[w === 'walkie' ? 1 : 0].getAttribute('aria-checked') === String(v);
    }, [nickname, which, on], { timeout: 20000 });
  },
  async pairCode(page, email, lockTo = null) {
    const since = await mailMark(email);
    await page.getByRole('button', { name: "Set up a kid's device" }).click();
    if (lockTo) await page.selectOption('#pair-who', { label: `Only ${lockTo}` });
    await page.getByRole('button', { name: 'Make a code' }).click();
    await FP.passCheck(page, email, since);
    await page.waitForSelector('.pair-code');
    const code = (await page.textContent('.pair-code')).trim();
    await page.getByRole('button', { name: 'Done' }).click();
    return code;
  },
  async ribbon(page) {
    await page.goto(`${R.base}/account`);
    await page.waitForSelector('.ribbon', { timeout: 20000 });
    return (await page.textContent('.ribbon')).trim();
  },
  async family(ctx) {
    return (await api('/api/family', { cookie: await cookieOf(ctx) })).data;
  },
};

// ---------------------------------------------------------------------------------------------
// the game's account screens (src/account/, owner C), by the words of docs/ACCOUNTS.md §7

const GAME = {
  async open(dev, url = `${R.base}/play`) {
    await dev.page.goto(url);
    await dev.page.waitForFunction(() => window.__game && window.__game.ui, null, { timeout: 60000 });
  },
  /** The grown-up check (the walkie's multiplication gate, purpose 'grownups'). */
  async grownUpCheck(dev) {
    const p = dev.page;
    await p.waitForSelector('.sw-gate .sw-gate-qtext', { timeout: 15000 });
    // under a loaded CPU a tap can be lost: the typed answer is read back before OK (a wrong
    // answer only brings a new problem; three would wait a minute)
    for (let attempt = 0; attempt < 2; attempt++) {
      const q = await p.locator('.sw-gate .sw-gate-qtext').textContent();
      const m = /(\d+)\s*×\s*(\d+)/.exec(q);
      const want = String(Number(m[1]) * Number(m[2]));
      for (let k = 0; k < 3; k++) {
        for (let n = 0; n < 4 && (await p.locator('.sw-gate .sw-gate-a').textContent()).replace(/\D/g, ''); n++) await press(dev, '.sw-gate .sw-gate-del');
        for (let i = 0; i < want.length; i++) {
          if (i && want[i] === want[i - 1]) await sleep(400); // two taps on one key are not a double-tap
          await press(dev, `.sw-gate .sw-gate-key[data-d="${want[i]}"]`);
        }
        if ((await p.locator('.sw-gate .sw-gate-a').textContent()).replace(/\D/g, '') === want) break;
      }
      await press(dev, '.sw-gate .sw-gate-ok');
      // the check closes (right), or asks a new problem (wrong)
      const done = await p.waitForFunction((q) => !document.querySelector('.sw-gate') || document.querySelector('.sw-gate .sw-gate-qtext')?.textContent !== q, q, { timeout: 10000 }).then(() => p.evaluate(() => !document.querySelector('.sw-gate')), () => false);
      if (done) return;
    }
    throw new Error('the grown-up check did not take the answer');
  },
  /** Signed out: "Ask a grown-up" → I have a code → the grown-up check → type the code. */
  async pair(dev, code) {
    await dev.page.getByText(/Ask a grown-up/).first().waitFor({ timeout: 60000 });
    await shot(dev.page, `${dev.key}-ask-a-grown-up`);
    await tapIt(dev, dev.page.getByRole('button', { name: /I have a code/ }).first());
    await GAME.grownUpCheck(dev);
    const box = dev.page.locator('.sw-dialog input.sw-input, .sw-panel-wrap.sw-open input, dialog input').first();
    await box.waitFor({ timeout: 15000 });
    await box.fill(code);
    // a good code signs the device in and the game reloads (the old page may still look like
    // a title underneath its card, so wait for the reload itself)
    await Promise.all([dev.page.waitForNavigation({ timeout: 30000 }), box.press('Enter')]);
  },
  async pick(dev, nickname) {
    await dev.page.getByText(/Who's playing\?/).first().waitFor({ timeout: 60000 });
    await shot(dev.page, `${dev.key}-whos-playing`);
    await tapIt(dev, dev.page.getByRole('button', { name: new RegExp(nickname) }).first());
  },
  async title(dev) {
    await waitForTitle(dev.page, 90000);
  },
  worlds(dev) {
    return game(dev, async () => (await window.__game.store.listWorlds()).map((m) => ({ id: m.id, name: m.name, updatedAt: m.updatedAt })));
  },
  /** A world she builds in: New World (flat) → Create! → a row of blocks → Save & Exit. */
  async buildWorld(dev, { name = null } = {}) {
    const p = dev.page;
    await tapIt(dev, 'button.sw-btn:has-text("New World")');
    await p.waitForSelector('.sw-panel-wrap.sw-open .sw-biome img[src]');
    await tapIt(dev, '.sw-panel-wrap.sw-open .sw-biome[data-biome="flat"]');
    await tapIt(dev, 'button.sw-create');
    await waitForPlay(p);
    await waitIdle(p);
    await GAME.place(dev, 6);
    if (name) await game(dev, (n) => { window.__game.world.meta.name = n; }, name);
    return GAME.saveExit(dev);
  },
  /** Put `n` blocks in front of her (the game's own build call, recorded like a tap). */
  async place(dev, n = 4, block = null) {
    return game(dev, ([n, block]) => {
      const g = window.__game;
      const q = g.player.position;
      const id = block ?? g.registry.blocks.idOf('planks_pink');
      let placed = 0;
      // the game's own recorded edit (like a tap): history, autosave and the net see it
      for (let k = 0; k < n; k++) if (g.world.set(Math.floor(q.x) + 2 + k, Math.floor(q.y), Math.floor(q.z) + 2, id)) placed++;
      return placed;
    }, [n, block]);
  },
  async saveExit(dev) {
    const id = await game(dev, () => window.__game.world.meta.id);
    await tapIt(dev, '.sw-hud-tr button[aria-label="Menu"]');
    await tapIt(dev, '.sw-panel-wrap.sw-open button:has-text("Save & Exit")');
    await GAME.title(dev);
    return id;
  },
};

/**
 * Tap a button like a child would. The game gives the first button of a card or menu the
 * focus, and a focused button pulses: it never holds still, which is what a normal tap waits
 * for. After a short wait the tap goes through anyway (overlays are still handled first).
 */
async function tapIt(dev, target, timeout = 15000) {
  const l = typeof target === 'string' ? dev.page.locator(target).first() : target;
  await l.waitFor({ state: 'visible', timeout });
  try {
    if (dev.touch) await l.tap({ timeout: 6000 });
    else await l.click({ timeout: 6000 });
  } catch {
    await l.click({ force: true, timeout });
  }
}

/**
 * Close devices a later scenario no longer needs: every open game draws its world on the CPU
 * (SwiftShader), and four of them in the background slow the next scenario down a lot.
 */
async function retire(...keys) {
  for (const k of keys) {
    const d = R.dev[k];
    if (!d || d.retired) continue;
    d.page.flushErrors?.();
    d.retired = true;
    await d.ctx.close().catch(() => {});
  }
}

async function newDevice(key, name, size, opts = {}) {
  const ctx = await newContext(key, size);
  const page = await newPage(ctx, key, opts);
  const dev = { key, name, ctx, page, touch: size.touch !== false, viewport: { width: size.w, height: size.h }, seed: 11 + key.length };
  R.dev[key] = dev;
  // only the iPad played before accounts: any other device asked "from before. Whose are
  // they?" is wrong (§7.5: only when there are old worlds or a profile that was played).
  // It is counted (a check at the end) and answered like a grown-up would, so the rest runs.
  if (key !== 'ipad') {
    await page.addLocatorHandler(page.getByText(/from before\. Whose are they\?/).first(), async () => {
      R.unexpectedImport.add(key);
      await page.getByRole('button', { name: "They're not ours" }).first().click();
    });
  }
  return dev;
}

// ---------------------------------------------------------------------------------------------
// scenarios

async function s1() {
  log('1. Parent A signs up, the free week, Lily and Mia');
  const ctx = await newContext('parentA', { w: 1024, h: 768 });
  const page = await newPage(ctx, 'parentA');
  const A = (R.fam.A = { email: `a.${randomBytes(3).toString('hex')}@example.com`, ctx, page, ids: {} });
  await FP.signIn(page, A.email);
  await FP.agree(page);
  await shot(page, 'parentA-plan-ipad', true);
  await FP.buy(page, { trial: true });
  check(/free trial has started/.test(await page.textContent('.all-set')), 'back from the fake Checkout: "You\'re all set!", the free week has started');
  await shot(page, 'parentA-all-set-ipad');
  await FP.addPlayer(page, 'Lily', { first: true });
  await FP.addPlayer(page, 'Mia');
  const ribbon = (await page.textContent('.ribbon')).trim();
  check(/^Free week: \d+ days? left, then \$5\.99\/month\./.test(ribbon), `the plan ribbon: "${ribbon}"`);
  check((await page.locator('article.player .bubble img').count()) === 0 && (await page.locator('article.player .bubble').count()) === 2, "the kids' pictures are empty bubbles (no portrait yet)");
  const fam = await FP.family(ctx);
  for (const p of fam.players) A.ids[p.nickname] = p.id;
  check(A.ids.Lily && A.ids.Mia && fam.plan.state === 'trialing' && fam.consent.level === 'email_plus', `the family: trialing, consent email_plus, players ${Object.keys(A.ids).join(', ')}`);
  await shot(page, 'parentA-dashboard-ipad', true);
}

/** Before the accounts server starts: 2 worlds made on the iPad with accounts off, same address. */
async function seedLegacy() {
  log('the iPad has 2 worlds from before accounts (same address, accounts off)');
  const off = await startServer(R.port, { SW_SITE: path.join(ROOT, 'dist', 'site') });
  const dev = await newDevice('ipad', 'Lily', { w: 1024, h: 768 });
  try {
    await GAME.open(dev);
    await GAME.title(dev);
    await setupPage(dev);
    R.legacy = [await GAME.buildWorld(dev, { name: 'Old Castle' }), await GAME.buildWorld(dev, { name: 'Old Garden' })];
    const worlds = await GAME.worlds(dev);
    check(worlds.length === 2, `the iPad has ${worlds.length} worlds saved on the device`);
  } finally {
    await dev.page.close();
    await stopServer(off);
  }
}

async function s2() {
  log('2. The iPad: Ask a grown-up → I have a code → Lily → the import card');
  const A = R.fam.A;
  const code = await FP.pairCode(A.page, A.email);
  check(/^[0-9A-Z]{4}-[0-9A-Z]{4}$/.test(code), `A's Family page shows a pair code ${code}`);
  const dev = R.dev.ipad;
  dev.page = await newPage(dev.ctx, 'ipad');
  await GAME.open(dev);
  await GAME.pair(dev, code);
  await GAME.pick(dev, 'Lily');
  // the import card: "This iPad has 2 worlds from before. Whose are they?"
  await dev.page.getByText(/worlds from before/).first().waitFor({ timeout: 60000 });
  await shot(dev.page, 'ipad-import-card');
  await tapIt(dev, dev.page.getByRole('button', { name: 'Lily', exact: true }).first());
  await GAME.title(dev);
  await noPriceInGame(dev.page, 'the iPad, Lily');
  const cookie = await cookieOf(dev.ctx);
  const end = Date.now() + 60000;
  let cloud = [];
  while (Date.now() < end) {
    const r = await api(`/api/players/${A.ids.Lily}/worlds`, { cookie });
    cloud = Array.isArray(r.data) ? r.data.filter((w) => !w.deleted) : [];
    if (cloud.length >= 2) break;
    await sleep(1000);
  }
  check(cloud.length >= 2 && ['Old Castle', 'Old Garden'].every((n) => cloud.some((w) => w.name === n)), `both old worlds are in Lily's cloud (${cloud.map((w) => w.name).join(', ')})`);
  await setupPage(dev);
  R.shared = await GAME.buildWorld(dev, { name: 'Shared Island' });
  check(!!R.shared, 'Lily builds a new world on the iPad and saves it');
}

async function s3() {
  log('3. The computer pairs; the iPad forgets its site data');
  const A = R.fam.A;
  const code = await FP.pairCode(A.page, A.email);
  const dev = await newDevice('computer', 'Lily', { w: 1280, h: 800, touch: false });
  await GAME.open(dev);
  await GAME.pair(dev, code);
  await GAME.pick(dev, 'Lily');
  await GAME.title(dev);
  const end = Date.now() + 60000;
  let worlds = [];
  while (Date.now() < end && !(worlds = await GAME.worlds(dev)).some((w) => w.id === R.shared)) await sleep(1000);
  check(worlds.some((w) => w.id === R.shared), 'the computer has the iPad\'s world');
  const blocks = await game(dev, async (id) => {
    const s = await window.__game.store.loadWorld(id);
    return s && typeof s.blocks === 'string' ? s.blocks.length : 0;
  }, R.shared);
  check(blocks > 0, `with its blocks (${blocks} chars of blocks)`);
  await shot(dev.page, 'computer-lily-title');
  // the iPad's site data is cleared (the cookie stays: Safari's 7-day rule clears storage)
  const ipad = R.dev.ipad;
  await ipad.page.evaluate(async () => {
    localStorage.clear();
    for (const d of (await indexedDB.databases?.()) || []) indexedDB.deleteDatabase(d.name);
  });
  await ipad.page.reload();
  await GAME.pick(ipad, 'Lily'); // an unlocked device of a family with two players asks who plays
  await GAME.title(ipad);
  const back = Date.now() + 60000;
  while (Date.now() < back && !(await GAME.worlds(ipad)).some((w) => w.id === R.shared)) await sleep(1000);
  check((await GAME.worlds(ipad)).some((w) => w.id === R.shared), 'after the site data was cleared, the world comes back from the cloud');
}

async function s4() {
  log('4. Both devices edit the same world offline, then reconnect');
  const devs = [R.dev.ipad, R.dev.computer];
  const open = async (dev) => {
    await setupPage(dev);
    await game(dev, (id) => window.__game.loadWorld(id), R.shared);
    await waitForPlay(dev.page);
    await waitIdle(dev.page);
  };
  // both open it once online (the iPad's copy came back only as a name in the list after its
  // site data was cleared: opening it keeps the whole world on the device)
  for (const dev of devs) {
    await open(dev);
    await GAME.saveExit(dev);
  }
  for (const dev of devs) {
    dev.page.allow.push(/api\/players/);
    await dev.ctx.route('**/api/players/**', (route) => route.abort());
    await open(dev);
    await GAME.place(dev, 3 + devs.indexOf(dev));
    await GAME.saveExit(dev);
  }
  for (const dev of devs) await dev.ctx.unroute('**/api/players/**');
  // opened again: an unlocked device of a family with two players asks "Who's playing?"
  for (const dev of devs) {
    await dev.page.reload();
    await GAME.pick(dev, 'Lily');
    await GAME.title(dev);
  }
  const A = R.fam.A;
  const cookie = await cookieOf(R.dev.ipad.ctx);
  const end = Date.now() + 120000;
  let cloud = [];
  while (Date.now() < end) {
    cloud = ((await api(`/api/players/${A.ids.Lily}/worlds`, { cookie })).data || []).filter((w) => !w.deleted);
    if (cloud.some((w) => /\(copy\)$/.test(w.name || ''))) break;
    await sleep(2000);
  }
  check(cloud.some((w) => w.id === R.shared) && cloud.some((w) => /\(copy\)$/.test(w.name || '') && w.id.startsWith(R.shared + '~')), `a "(copy)" world next to the original: nothing lost (${cloud.map((w) => w.name).join(', ')})`);
  // what the offline minutes and the conflict answered (409) were expected: flushed under the allow list
  for (const dev of devs) {
    dev.page.flushErrors();
    dev.page.allow = [...dev.page.baseAllow];
  }
  await retire('computer');
}

async function s5() {
  log('5. Friends: the free week locks them; Start now; family B with Start today; C never subscribed');
  const A = R.fam.A;
  await A.page.goto(`${R.base}/account`);
  await A.page.waitForSelector('article.player');
  check(await FP.switchOf(A.page, 'Lily', 'friends').isDisabled(), "in the free week Lily's Play with friends is locked");
  check(/Turns on after your first payment/.test(await A.page.locator('article.player', { hasText: 'Lily' }).textContent()), '"Turns on after your first payment."');
  await shot(A.page, 'parentA-free-week-locked-ipad', true);
  const since = await mailMark(A.email);
  await A.page.locator('.ribbon').getByRole('button', { name: 'Start now' }).click();
  await A.page.locator('dialog').getByRole('button', { name: 'Start now' }).click();
  await FP.passCheck(A.page, A.email, since);
  await A.page.waitForFunction(() => /renews/.test(document.querySelector('.ribbon')?.textContent || ''), null, { timeout: 30000 });
  const famA = await FP.family(A.ctx);
  check(famA.consent.level === 'verified' && famA.plan.state === 'active', `Start now: paid today, consent verified (${famA.plan.state}, ${famA.consent.level})`);
  await FP.setSwitch(A.page, A.email, 'Lily', 'friends', true);
  check(true, "Lily's Play with friends is on");
  // family B: Start today
  const ctxB = await newContext('parentB', { w: 390, h: 844 });
  const pageB = await newPage(ctxB, 'parentB');
  const B = (R.fam.B = { email: `b.${randomBytes(3).toString('hex')}@example.com`, ctx: ctxB, page: pageB, ids: {} });
  await FP.signIn(pageB, B.email);
  await FP.agree(pageB);
  await shot(pageB, 'parentB-plan-390', true);
  await FP.buy(pageB, { trial: false });
  check(/Family Plan is on/.test(await pageB.textContent('.all-set')), 'family B: Start today → "You\'re all set!"');
  await FP.addPlayer(pageB, 'June', { first: true });
  B.ids.June = (await FP.family(ctxB)).players[0].id;
  await FP.setSwitch(pageB, B.email, 'June', 'friends', true);
  check(true, "family B: June's Play with friends is on right away (the first payment was today)");
  await shot(pageB, 'parentB-dashboard-390', true);
  const juneCode = await FP.pairCode(pageB, B.email, 'June');
  const june = await newDevice('june', 'June', { w: 390, h: 844 });
  await GAME.open(june);
  await GAME.pair(june, juneCode);
  await GAME.title(june);
  await setupPage(june);
  // Lily hosts on the iPad, June joins with the code. The iPad's game read /api/me when it
  // opened (in the free week: friends_locked); it learns the new switch when it opens again
  // (§7.1, §7.7: the "why" card comes from /api/me without trying), so it is opened again.
  const lily = R.dev.ipad;
  await lily.page.reload();
  await GAME.pick(lily, 'Lily');
  await GAME.title(lily);
  await setupPage(lily);
  const code = await hostMakesCode(lily, { log });
  await guestTypesCode(june, code);
  await hostLetsIn(lily, 'June');
  check(await waitLive(june), 'June is in Lily\'s world');
  await bringTo(june, lily);
  await GAME.place(lily, 3);
  await GAME.place(june, 2);
  const c = await converge([lily, june]);
  check(c.ok, `they build together; the hashes are equal${c.ok ? '' : ': ' + c.detail}`);
  // a changed page claims another name: the server stamps June's
  await game(june, () => window.__game.net.session.transport.setState({ nm: 'Lily' }));
  await sleep(1500);
  const names = await game(lily, () => window.__game.debug.net.peers().map((p) => p.nm));
  check(names.includes('June') && names.filter((n) => n === 'Lily').length === 1, `a name change by June's page is ignored (${names.join(', ')})`);
  await noPriceInGame(lily.page, 'Lily playing together');
  await noPriceInGame(june.page, 'June playing together');
  await shot(lily.page, 'ipad-lily-hosts-june');
  // family C never subscribed: the grown-up signs in from the game ("I'm a grown-up", §7.1),
  // which takes her back to it: the resting card; nothing reaches Lily
  const knocks = await game(lily, () => window.__knockEvents || 0);
  const cDev = await newDevice('familyC', 'Poppy', { w: 1024, h: 768 }, { allow: [/403/] });
  const C = (R.fam.C = { email: `c.${randomBytes(3).toString('hex')}@example.com`, ctx: cDev.ctx, page: cDev.page });
  await GAME.open(cDev);
  await cDev.page.getByText(/Ask a grown-up/).first().waitFor({ timeout: 60000 });
  // (the card's first button pulses while it has the focus, so it is never "stable" for a tap)
  const grown = cDev.page.getByRole('button', { name: /I'm a grown-up/ }).first();
  await grown.waitFor({ state: 'visible', timeout: 15000 });
  await grown.click({ force: true });
  await GAME.grownUpCheck(cDev);
  await cDev.page.waitForURL((u) => u.pathname === '/account' && u.searchParams.get('next') === '/play', { timeout: 60000 });
  await cDev.page.waitForSelector('#email');
  check(/take you back to the game/.test(await cDev.page.textContent('main')), 'from the game, the Family page says it will take her back');
  const cSince = await mailMark(C.email);
  await cDev.page.fill('#email', C.email);
  await cDev.page.click('button[type=submit]');
  await cDev.page.waitForSelector('.code-boxes');
  await Promise.all([cDev.page.waitForURL((u) => u.pathname === '/play', { timeout: 60000 }), cDev.page.locator('#code').fill(await codeFor(C.email, { since: cSince }))]);
  await cDev.page.getByText(/Sparkle World is resting/).first().waitFor({ timeout: 60000 });
  check(true, 'family C signed in from the game and is back in it: "Sparkle World is resting…"');
  // and the relay itself: C's session cannot come into Lily's game, with or without a player
  const lilyRoom = `sw1-${code.join('-')}`;
  const cCookie = await cookieOf(cDev.ctx);
  for (const [p, want] of [[null, 4401], ['00000000-0000-4000-8000-000000000000', 4405]]) {
    const s = await voiceSocket(cCookie, p, 'poppy', lilyRoom);
    const t0 = Date.now();
    while (s.closed === null && Date.now() - t0 < 5000) await sleep(50);
    check(s.closed === want, `family C's socket into Lily's game ${p ? 'as a made-up player' : 'without a player'}: closed with ${s.closed} (${want})`);
    s.ws.terminate();
  }
  await shot(cDev.page, 'familyC-resting');
  await noPriceInGame(cDev.page, 'family C (never subscribed)');
  check(!(await cDev.page.locator('button.sw-title-friends:not([hidden])').count()), 'family C: no Play with Friends to knock with');
  await sleep(1000);
  check((await game(lily, () => window.__knockEvents || 0)) === knocks, 'no knock from family C reaches Lily');
  await retire('familyC');
}

// ---- 6: the walkie switch, through the relay with the kids' device cookies

function voiceSocket(cookie, p, name, room = 'sw1-heart-star-moon-gem') {
  return new Promise((resolve) => {
    import('ws').then(({ WebSocket: WSN }) => {
      const box = { name, json: [], bytes: 0, lastByteAt: 0, self: null, closed: null };
      box.ws = new WSN(`ws://127.0.0.1:${R.port}/r/${room}?s=${name}-${randomBytes(8).toString('hex')}&d=${name}-dev-${randomBytes(8).toString('hex')}${p ? `&p=${p}` : ''}`, { headers: { Cookie: cookie, 'X-Forwarded-For': `198.51.100.${name.length}` } }); // no Origin: not a browser page
      box.ws.on('message', (d, bin) => {
        if (bin) {
          box.bytes += d.length;
          box.lastByteAt = Date.now();
          return;
        }
        const f = JSON.parse(d.toString());
        if (f.t === 'p' && f.self) box.self = f.self;
        box.json.push(f);
      });
      box.ws.on('close', (c) => (box.closed = c));
      box.ws.on('error', () => {});
      box.ws.on('open', () => resolve(box));
      box.ws.on('unexpected-response', (req, res) => {
        box.status = res.statusCode;
        resolve(box);
      });
    });
  });
}

const frame = (seq) => packFrame(seq === 0 ? F_START : 0, seq & 0xffff, 0, 0, new Uint8Array(WIRE.FRAME_SAMPLES / 2).fill(0x35));
const lastPerm = (b) => b.json.filter((f) => f.t === 'v' && f.k === 'perm').at(-1)?.walkie;

async function s6() {
  log('6. The walkie: Lily on, June off → 0 bytes; switched on → perm → she talks and hears; off → nothing within 1 s');
  const A = R.fam.A;
  const B = R.fam.B;
  await FP.setSwitch(A.page, A.email, 'Lily', 'walkie', true);
  await FP.setSwitch(B.page, B.email, 'June', 'walkie', false);
  const lily = await voiceSocket(await cookieOf(R.dev.ipad.ctx), A.ids.Lily, 'lily');
  const june = await voiceSocket(await cookieOf(R.dev.june.ctx), B.ids.June, 'june');
  const talk = { t: null };
  try {
    check(lily.closed === null && june.closed === null, 'both kids connect with their device sessions');
    const t0 = Date.now();
    while (!(lily.self && june.self) && Date.now() - t0 < 5000) await sleep(50);
    lily.ws.send(JSON.stringify({ t: 's', patch: { v: 1, r: 'h', nm: 'x', wk: 1, adm: [[june.self, 1]] } }));
    june.ws.send(JSON.stringify({ t: 's', patch: { v: 1, r: 'g', nm: 'x', wk: 1 } }));
    for (const b of [lily, june]) b.ws.send(JSON.stringify({ t: 'v', k: 'on' }));
    await sleep(300);
    check(lastPerm(lily) === 1 && lastPerm(june) === 0, 'the perm frames: Lily 1, June 0');
    lily.ws.send(JSON.stringify({ t: 'v', k: 'req' }));
    await sleep(200);
    let seq = 0;
    talk.t = setInterval(() => lily.ws.readyState === 1 && lily.ws.send(frame(seq++)), 80);
    await sleep(1500);
    check(june.bytes === 0, "June (her walkie off on the Family page) gets 0 voice bytes");
    await FP.setSwitch(B.page, B.email, 'June', 'walkie', true);
    const tOn = Date.now();
    while (lastPerm(june) !== 1 && Date.now() - tOn < 3000) await sleep(20);
    check(lastPerm(june) === 1, `B switched it on: the perm frame arrives (${Date.now() - tOn} ms)`);
    june.ws.send(JSON.stringify({ t: 's', patch: { wk: 1 } }));
    june.ws.send(JSON.stringify({ t: 'v', k: 'on' }));
    const b0 = june.bytes;
    await sleep(1500);
    check(june.bytes > b0 + 2000, `June hears Lily (${june.bytes - b0} B)`);
    clearInterval(talk.t);
    talk.t = null;
    lily.ws.send(JSON.stringify({ t: 'v', k: 'end' }));
    await sleep(3000);
    june.ws.send(JSON.stringify({ t: 'v', k: 'req' }));
    await sleep(300);
    check(june.json.some((f) => f.t === 'v' && f.k === 'go'), 'June may talk');
    let js = 0;
    const jt = setInterval(() => june.ws.readyState === 1 && june.ws.send(frame(js++)), 80);
    await sleep(1000);
    check(lily.bytes > 2000, `Lily hears June (${lily.bytes} B)`);
    // switched off again: nothing within 1 s
    const tOff = Date.now();
    await FP.setSwitch(B.page, B.email, 'June', 'walkie', false);
    await sleep(1500);
    clearInterval(jt);
    const lb = lily.bytes;
    await sleep(500);
    check(lily.bytes === lb && (lily.lastByteAt === 0 || lily.lastByteAt - tOff < 2500), `switched off: nothing of June reaches Lily after the switch (last byte ${lily.lastByteAt - tOff} ms after the click)`);
    check(lastPerm(june) === 0, 'June\'s page is told perm 0');
  } finally {
    if (talk.t) clearInterval(talk.t);
    lily.ws.terminate();
    june.ws.terminate();
  }
  await retire('june');
}

async function s7() {
  log('7. Billing life: the renewal fails, grace passes (4402), cancel at period end, resting');
  const A = R.fam.A;
  const state = R.stripe.state ? await R.stripe.state() : null;
  const customer = findCustomer(state, A.email);
  check(!!customer, 'the Stripe fake knows A as a customer');
  if (customer) await R.stripe.card(customer, 'fail');
  const lilySock = await voiceSocket(await cookieOf(R.dev.ipad.ctx), A.ids.Lily, 'lilyseven');
  await passDays(31);
  const ribbon = await FP.ribbon(A.page);
  check(/Payment didn't go through\. Playing continues until/.test(ribbon), `after the failed renewal: "${ribbon}"`);
  await shot(A.page, 'parentA-payment-failed-ipad');
  await passDays(9);
  await api('/api/test/jobs', { method: 'POST', body: { name: 'reconcile' } });
  const end = Date.now() + 150000;
  while (lilySock.closed === null && Date.now() < end) await sleep(500);
  check(lilySock.closed === 4402, `after the grace days Lily's socket closes with 4402 (${lilySock.closed})`);
  const ipad = R.dev.ipad;
  ipad.page.allow.push(/403/);
  await ipad.page.reload();
  await ipad.page.getByText(/Sparkle World is resting/).first().waitFor({ timeout: 60000 });
  check(true, 'the game shows "Sparkle World is resting…"');
  await shot(ipad.page, 'ipad-resting');
  const cookie = await cookieOf(ipad.ctx);
  const read = await api(`/api/players/${A.ids.Lily}/worlds`, { cookie });
  check(read.status === 200 && read.data.length > 0, 'her worlds are still readable');
  const write = await api(`/api/players/${A.ids.Lily}/worlds/${R.shared}`, { method: 'DELETE', cookie });
  check(write.status === 403 && write.data?.error === 'not_entitled', `cloud writes are refused (${write.status} ${write.data?.error})`);
  // family B: the Portal's "Cancel at period end" → Ends … → the period ends → resting
  const B = R.fam.B;
  if (customer) await R.stripe.card(customer, 'ok');
  await FP.ribbon(B.page);
  const since = await mailMark(B.email);
  await B.page.locator('.ribbon').getByRole('button', { name: 'Manage subscription' }).click();
  await FP.passCheck(B.page, B.email, since);
  await B.page.waitForURL((u) => !u.href.startsWith(R.base), { timeout: 30000 });
  await shot(B.page, 'stripe-fake-portal');
  await B.page.getByRole('button', { name: /Cancel at period end/ }).or(B.page.getByRole('link', { name: /Cancel at period end/ })).first().click();
  await sleep(1000);
  await B.page.goto(`${R.base}/account?portal=1`);
  await B.page.waitForSelector('.ribbon');
  const ends = (await B.page.textContent('.ribbon')).trim();
  check(/ends/i.test(ends) && /Resume/.test(ends), `after cancelling: "${ends}"`);
  await passDays(32);
  await api('/api/test/jobs', { method: 'POST', body: { name: 'reconcile' } });
  const rest = await FP.ribbon(B.page);
  check(/Resting/.test(rest), `the period ended: "${rest}"`);
  await shot(B.page, 'parentB-resting-390', true);
  // A wakes Sparkle World up again (Restart the plan: no second free week), for 8 and 9
  const ribbonA = await FP.ribbon(A.page);
  check(/Resting/.test(ribbonA), `family A is resting too: "${ribbonA}"`);
  await A.page.locator('.ribbon').getByRole('button', { name: 'Restart the plan' }).click();
  await A.page.waitForSelector('#us');
  check((await A.page.locator('.plan-choice .btn').count()) === 1, 'restarting offers no second free week (one button, the price next to it)');
  await FP.buy(A.page, { trial: false });
  await A.page.getByRole('button', { name: 'Go to your Family page' }).click();
  const back = (await A.page.textContent('.ribbon')).trim();
  check(/renews/.test(back), `family A restarted the plan: "${back}"`);
}

function findCustomer(state, email) {
  if (!state) return null;
  const list = Array.isArray(state.customers) ? state.customers : state.customers && typeof state.customers === 'object' ? Object.values(state.customers) : [];
  const c = list.find((x) => x && x.email === email);
  return c ? c.id : null;
}

async function s8() {
  log('8. A deletes Mia: her device gets 410, its copy is wiped, the picker');
  await retire('computer', 'june', 'familyC'); // 8 and 9 do not need them (their games draw on the CPU)
  const A = R.fam.A;
  await FP.ribbon(A.page);
  const code = await FP.pairCode(A.page, A.email, 'Mia');
  const mia = await newDevice('mia', 'Mia', { w: 1024, h: 768 }, { allow: [/410/] });
  await GAME.open(mia);
  await GAME.pair(mia, code);
  await GAME.title(mia);
  await setupPage(mia);
  await GAME.buildWorld(mia, { name: 'Mia House' });
  const dbs = async () => mia.page.evaluate(async () => ((await indexedDB.databases?.()) || []).map((d) => d.name));
  const before = await dbs();
  check(before.some((n) => n.includes(A.ids.Mia)), `Mia's device keeps her worlds in her own store (${before.join(', ')})`);
  const since = await mailMark(A.email);
  await A.page.getByRole('button', { name: 'Delete Mia' }).click();
  await A.page.fill('#confirm-nick', 'Mia');
  await A.page.locator('dialog .btn-danger-strong').click();
  await FP.passCheck(A.page, A.email, since);
  await A.page.locator('article.player', { hasText: 'Mia' }).waitFor({ state: 'detached', timeout: 20000 });
  check(true, 'A deleted Mia on the Family page');
  await mia.page.reload();
  // the device was only Mia's: now "Who's playing?" (or, with one player left, that player;
  // the lock went with Mia), never Mia again
  await mia.page.waitForFunction(() => /A grown-up can add you|Who's playing/.test(document.body.innerText) || (window.__game && window.__game.ui && window.__game.ui.current === 'title' && window.__game.account && window.__game.account.playerId), null, { timeout: 60000 });
  const now = await game(mia, () => window.__game.account && window.__game.account.playerId);
  check(now !== A.ids.Mia, `Mia's device does not play as Mia any more (${now === A.ids.Lily ? 'Lily, the one player left' : now || 'the picker'})`);
  const after = await dbs();
  check(!after.some((n) => n.includes(A.ids.Mia)), `Mia's copy is wiped from the device (${after.join(', ') || 'none left'})`);
  await shot(mia.page, 'mia-device-after-delete');
}

async function s9() {
  log('9. A deletes the account');
  const A = R.fam.A;
  const fam = await FP.family(A.ctx);
  const familyId = await (async () => {
    const r = await R.db.one('select id from families where email = $1', [A.email]);
    return r && r.id;
  })();
  await FP.ribbon(A.page).catch(() => {});
  const customer = findCustomer(R.stripe.state ? await R.stripe.state() : null, A.email);
  check(!!customer, `A is a customer at the Stripe fake (${customer})`);
  R.dev.ipad?.page.allow.push(/410/); // Lily's iPad hears family_gone at its next cloud call
  A.page.allow.push(/403|410/);
  const since = await mailMark(A.email);
  await A.page.getByRole('button', { name: 'Delete our account' }).click();
  await A.page.fill('#confirm-delete', 'DELETE');
  await A.page.locator('dialog .btn-danger-strong').click();
  await FP.passCheck(A.page, A.email, since);
  await A.page.getByText('Your account is deleted').waitFor({ timeout: 30000 });
  check(true, `the Family page says the account is deleted (it had ${fam.players.length} players)`);
  await shot(A.page, 'parentA-deleted-ipad');
  const tables = ['families', 'players', 'sessions', 'login_attempts', 'pair_codes', 'subscriptions', 'outbox'];
  const counts = {};
  for (const t of tables) {
    const col = t === 'families' ? 'id' : 'family_id';
    counts[t] = (await R.db.one(`select count(*) as n from ${t} where ${col} = $1`, [familyId])).n;
  }
  counts.player_rows = (await R.db.one('select count(*) as n from worlds w where not exists (select 1 from players p where p.id = w.player_id)')).n;
  check(Object.values(counts).every((n) => n === 0), `nothing of A is left in any table (${JSON.stringify(counts)})`);
  const state = R.stripe.state ? await R.stripe.state() : null;
  const gone = ((state && state.customers) || []).find((c) => c && c.id === customer);
  check(!!gone && gone.deleted === true && !findCustomer(state, A.email), `the Stripe fake shows A's customer deleted (${JSON.stringify(gone)})`);
  const subs = ((state && state.subscriptions) || []).filter((s) => s.customer === customer);
  check(subs.length > 0 && subs.every((s) => ['canceled', 'incomplete_expired'].includes(s.status)), `and every subscription of A's ended (${subs.map((s) => s.status).join(', ')})`);
  check((await mailsTo(A.email)).some((m) => m.template === 'account_deleted'), 'the account_deleted email was sent');
  const ipad = R.dev.ipad;
  ipad.page.allow.push(/410/);
  await ipad.page.reload();
  await ipad.page.getByText(/Ask a grown-up/).first().waitFor({ timeout: 60000 });
  const left = await ipad.page.evaluate(async () => ((await indexedDB.databases?.()) || []).map((d) => d.name).filter((n) => /@p-/.test(n)));
  check(left.length === 0, `A's iPad got 410 family_gone and wiped the players' copies (${left.join(', ') || 'none left'})`);
}

async function s10() {
  log('10. Regression: file://, a claude.ai stand-in, and SW_ACCOUNTS=optional');
  // file://: no /api request at all
  {
    const ctx = await newContext('file', { w: 1280, h: 800, touch: false });
    const page = await newPage(ctx, 'file');
    const asked = [];
    page.on('request', (r) => /\/api\//.test(r.url()) && asked.push(r.url()));
    await page.goto(PAGE_URL);
    await waitForTitle(page, 60000);
    await sleep(2000);
    check(asked.length === 0, `/play from file:// makes no /api request (${asked.length})`);
    await noPriceInGame(page, 'the game from file://');
    page.flushErrors();
    await ctx.close();
  }
  // a window.claude stand-in on the real server: no /api/me
  {
    const ctx = await newContext('claude', { w: 1280, h: 800, touch: false });
    await ctx.addInitScript(() => {
      window.claude = { use: async (n) => (n === 'room' ? { join: async () => { throw Object.assign(new Error('no'), { code: 'not_permitted' }); } } : null) };
    });
    const page = await newPage(ctx, 'claude');
    const asked = [];
    page.on('request', (r) => /\/api\/me\b/.test(r.url()) && asked.push(r.url()));
    await page.goto(`${R.base}/play`);
    await waitForTitle(page, 60000);
    await sleep(2000);
    check(asked.length === 0, `a window.claude stand-in makes no /api/me request (${asked.length})`);
    page.flushErrors();
    await ctx.close();
  }
  // nothing of scenarios 1-9 is needed any more: their games stop drawing
  await retire(...Object.keys(R.dev));
  for (const f of Object.values(R.fam)) {
    f.page?.flushErrors?.();
    await f.ctx?.close().catch(() => {});
  }
  // SW_ACCOUNTS=optional, with the family's settings (no free trial): signed-out devices play,
  // and play together, as today
  await stopServer(R.server);
  R.server = await startServer(R.port, { ...R.env, SW_ACCOUNTS: 'optional', SW_TRIAL_DAYS: '0', SW_SITE: R.optSite });
  const net = await (await fetch(`${R.base}/api/net`)).json();
  check(net.accounts === 'optional', `/api/net says accounts: optional (${JSON.stringify(net)})`);
  // the plan card as the family decided it (SW_TRIAL_DAYS=0), on a phone
  {
    const ctx = await newContext('parentD', { w: 390, h: 844 });
    const page = await newPage(ctx, 'parentD');
    await FP.signIn(page, `d.${randomBytes(3).toString('hex')}@example.com`);
    await FP.agree(page);
    const buttons = await page.locator('.plan-choice .btn').allTextContents();
    const words = await page.textContent('.plan-choices');
    check(buttons.length === 1 && buttons[0] === 'Start the Family Plan' && /\$5\.99 a month, plus sales tax where it applies/.test(words) && /renews every month until you cancel/.test(words) && !/free/i.test(words), `no free trial (the family's decision): one "Start the Family Plan" button, the price and the renewal next to it (${buttons.join(' | ')})`);
    check(!(await page.isChecked('#us')), 'the US box starts empty');
    await shot(page, 'parentD-plan-no-trial-390', true);
    page.flushErrors();
    await ctx.close();
  }
  const lily = await newDevice('opt-lily', 'Lily', { w: 1280, h: 800, touch: false });
  const rosie = await newDevice('opt-rosie', 'Rosie', { w: 1024, h: 768 });
  for (const d of [lily, rosie]) {
    await GAME.open(d);
    await GAME.title(d);
    await setupPage(d);
  }
  const kind = await until(lily, () => window.__game.net.kind, null, 10000);
  check(kind === 'ws', `optional, signed out: the WebSocket transport as today (${kind})`);
  const code = await hostMakesCode(lily, { log });
  await guestTypesCode(rosie, code);
  await hostLetsIn(lily, 'Rosie');
  check(await waitLive(rosie), 'optional, signed out: Rosie is in Lily\'s world, as today');
  await GAME.place(lily, 2);
  const c = await converge([lily, rosie]);
  check(c.ok, `optional, signed out: they build together, equal hashes${c.ok ? '' : ': ' + c.detail}`);
  await shot(lily.page, 'optional-signed-out-together');
  for (const d of [lily, rosie]) {
    d.page.flushErrors();
    await d.ctx.close();
  }
}

// ---------------------------------------------------------------------------------------------

async function main() {
  // --only=6 runs 1, 2 and 5 too (6 builds on 1 and 5, 5 on 2)
  const pick = new Set(ONLY || []);
  for (let grew = true; grew; ) {
    grew = false;
    for (const k of [...pick]) for (const d of AFTER[k] || []) if (!pick.has(d)) grew = !!pick.add(d);
  }
  const want = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].filter((n) => !ONLY || pick.has(n));
  const missing = {};
  for (const n of want) {
    const m = [...new Set([...NEEDS[n], ...(AFTER[n] || []).flatMap((k) => NEEDS[k])])].filter((k) => !has(k));
    if (m.length) missing[n] = m;
  }
  const run = want.filter((n) => !missing[n]);
  for (const [n, m] of Object.entries(missing)) log(`scenario ${n}: NOT RUN, needs ${m.map((k) => `${PARTS[k][0]} (${PARTS[k][1]})`).join(', ')}`);
  if (!run.length) return finish(missing);

  if (!existsSync(path.join(ROOT, 'dist', 'sparkle-world.html'))) {
    const r = spawnSync('npm', ['run', 'build'], { cwd: ROOT, stdio: 'inherit' });
    if (r.status !== 0) throw new Error('build failed');
  }
  R.port = await freePort();
  R.base = `http://localhost:${R.port}`;
  const cleanups = [];
  try {
    // every scenario runs a server with accounts on (10 too: optional mode), so a database
    const { openTestDb } = await import('./testdb.mjs');
    const t = await openTestDb({ needUrl: true, migrate: false });
    R.db = t.db;
    R.dbUrl = t.url;
    cleanups.push(() => t.close());
    const startStripeFake = await loadStripeFake();
    let stripeInfo = null;
    if (startStripeFake) {
      const webhookSecret = 'whsec_' + randomBytes(24).toString('hex'); // Stripe's are letters and digits
      R.stripe = await startStripeFake({ webhookUrl: `http://127.0.0.1:${R.port}/api/stripe/webhook`, webhookSecret, publicUrl: null });
      stripeInfo = { url: R.stripe.url, webhookSecret, priceId: R.stripe.priceId || null };
      cleanups.push(() => R.stripe.close());
    }
    R.env = {
      ...devEnv({ mode: 'required', origin: R.base, databaseUrl: R.dbUrl, stripe: stripeInfo, test: true, mail: 'memory' }),
      SW_TRIAL_DAYS: '7',
      SW_RECHECK_MS: '5000',
      SW_REQUIRED_FROM: '2026-11-02',
    };
    R.siteDir = mkdtempSync(path.join(tmpdir(), 'sw-e2e-site-'));
    R.optSite = mkdtempSync(path.join(tmpdir(), 'sw-e2e-site-opt-'));
    cleanups.push(() => rmSync(R.siteDir, { recursive: true, force: true }), () => rmSync(R.optSite, { recursive: true, force: true }));
    await buildSite({ out: R.siteDir, mode: 'required', env: R.env, quiet: true });
    await buildSite({ out: R.optSite, mode: 'optional', env: { ...R.env, SW_TRIAL_DAYS: '0' }, quiet: true });
    R.browser = await launch({ headed: !!arg('headed') });
    cleanups.push(() => R.browser.close());
    if (run.includes(2)) await seedLegacy();
    R.server = await startServer(R.port, { ...R.env, SW_SITE: R.siteDir });
    cleanups.push(() => stopServer(R.server));
    log(`server up with accounts (required): ${R.base}/account, Stripe ${R.stripe ? 'fake at ' + R.stripe.url : 'MISSING'}, database ${R.dbUrl ? 'url' : 'none'}`);
    const S = { 1: s1, 2: s2, 3: s3, 4: s4, 5: s5, 6: s6, 7: s7, 8: s8, 9: s9, 10: s10 };
    const failed = new Set();
    for (const n of run) {
      // a scenario that builds on a failed one is not run (it could only time out)
      const broken = (AFTER[n] || []).filter((k) => failed.has(k));
      if (broken.length) {
        failed.add(n);
        check(false, `scenario ${n}: not run, it builds on scenario ${broken.join(', ')}`);
        continue;
      }
      try {
        await S[n]();
      } catch (err) {
        check(false, `scenario ${n}: ${String(err && err.stack ? err.stack : err).split('\n').slice(0, 3).join(' | ')}`);
        for (const d of Object.values(R.dev)) await shot(d.page, `failed-${n}-${d.key}`).catch(() => {});
        for (const f of Object.values(R.fam)) await shot(f.page, `failed-${n}-${f.email.split('.')[0]}`).catch(() => {});
        failed.add(n); // what builds on it cannot run (a check that only failed stops nothing)
      }
      for (const f of Object.values(R.fam)) f.page?.flushErrors?.();
      for (const d of Object.values(R.dev)) d.page?.flushErrors?.();
    }
    if (run.some((n) => n >= 2 && n <= 9)) check(R.unexpectedImport.size === 0, `no device that never played before accounts is asked about "worlds from before" (${[...R.unexpectedImport].join(', ') || 'none'})`);
    // nothing personal in the server's log (§12.7 log spy, for the e2e's own run)
    const out = SERVER_LOG.join('');
    const leaks = Object.values(R.fam).map((f) => f.email).filter((e) => out.includes(e));
    check(!leaks.length && !/\b(Lily|June|Mia|Poppy)\b/.test(out), 'the server log has no email and no nickname');
  } finally {
    for (const c of cleanups.reverse()) {
      try {
        await c();
      } catch {}
    }
  }
  finish(missing);
}

function finish(missing) {
  const notRun = Object.keys(missing);
  console.log(`\n${passed} checks passed, ${errors.length} problems${notRun.length ? `, scenarios NOT RUN: ${notRun.join(', ')}` : ''}`);
  for (const e of errors) console.log(' - ' + e);
  if (errors.length) process.exitCode = 1;
  else if (notRun.length) {
    console.log('E2E NOT COMPLETE: the parts above are missing from this tree' + (arg('allow-missing') ? ' (--allow-missing)' : ''));
    process.exitCode = arg('allow-missing') ? 0 : 2;
  } else console.log('E2E ACCOUNTS PASSED');
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
