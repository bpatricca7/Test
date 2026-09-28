// Checks the home page the way Railway serves it:
//
//   node tools/site-check.mjs [--no-build] [--shots-prefix=site]
//
// 1. `npm run build` (unless --no-build), then server/server.mjs as its own process on a free
//    port (PORT=<n> npm start, like Railway).
// 2. "/" at 360x780, 390x844, 768x1024, 1024x768, 1280x800 and 1440x900: no console errors, no
//    failed requests, nothing loaded from other sites, no sideways scrolling, every picture
//    loaded, the game picture on a phone's first screen, the island inside the side margins,
//    full-page screenshots .shots/<prefix>-<w>.png. Then 360, 390 and 414 again with the font
//    blocked (the fallback font must not push the page sideways either).
// 3. Every link on the page answers (and "/play" really opens the game's title screen), plus
//    /healthz, /api/net, /parents, the headers (CSP on the page, gzip, ETag and 304s).
// 4. The picture-code demo: a wrong code is refused, the right one knocks, "Let in!" lets in,
//    and "Say hi with a tap" shows the phrase on Lily's iPad.
// 5. dist/site/preview.html is a fragment (no doctype/html/head/body) with the same content.

import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { mkdir, readFile } from 'node:fs/promises';
import { launch, waitForTitle, ROOT, SHOTS } from './smoke.mjs';
import { routeGoogleFonts } from './site-fonts.mjs';
import { shareTags, withShareTags } from './site-build.mjs';

const argv = process.argv.slice(2);
const arg = (k, d = null) => {
  const a = argv.find((x) => x.startsWith(`--${k}=`));
  return a ? a.slice(k.length + 3) : argv.includes(`--${k}`) ? true : d;
};
const PREFIX = arg('shots-prefix', 'site');
const errors = [];
const check = (cond, message) => {
  if (cond) console.log('  ok: ' + message);
  else {
    console.log('  FAIL: ' + message);
    errors.push(message);
  }
  return !!cond;
};

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

async function startServer(port) {
  const child = spawn(process.execPath, [path.join(ROOT, 'server', 'server.mjs')], {
    cwd: ROOT, env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (d) => process.stdout.write('  [server] ' + d));
  child.stderr.on('data', (d) => process.stdout.write('  [server!] ' + d));
  const end = Date.now() + 15000;
  while (Date.now() < end) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/healthz`)).ok) return child;
    } catch {}
    await new Promise((r) => setTimeout(r, 150));
  }
  child.kill('SIGKILL');
  throw new Error('the server did not start');
}

function collect(page, label, base = null) {
  if (base) {
    page.on('request', (req) => {
      const u = req.url();
      const onGame = /^\/(play|sparkle-world\.html)/.test(new URL(req.frame().url() || page.url(), base).pathname);
      if (!onGame && !u.startsWith(base) && !u.startsWith('data:')) errors.push(`[${label}] loaded from another site: ${u}`);
    });
  }
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`[${label}] console.error: ${msg.text()}`);
  });
  page.on('pageerror', (err) => errors.push(`[${label}] pageerror: ${err.message}`));
  page.on('requestfailed', (req) => errors.push(`[${label}] request failed: ${req.url()} ${req.failure() ? req.failure().errorText : ''}`));
  page.on('response', (res) => {
    if (res.status() >= 400) errors.push(`[${label}] HTTP ${res.status()} ${res.url()}`);
  });
}

const SIZES = [
  { w: 360, h: 780, touch: true },
  { w: 390, h: 844, touch: true },
  { w: 768, h: 1024, touch: true },
  { w: 1024, h: 768, touch: true },
  { w: 1280, h: 800, touch: false },
  { w: 1440, h: 900, touch: false },
];
// the same phones with no Fredoka at all (blocked or slow): the fallback font is wider
const NO_FONT = [{ w: 360, h: 780 }, { w: 390, h: 844 }, { w: 414, h: 896 }];

/** Page width, and the elements that stick out on the right. */
function overflow(page) {
  return page.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    w: window.innerWidth,
    wide: [...document.querySelectorAll('body *')].filter((e) => {
      const r = e.getBoundingClientRect();
      return r.width && r.right > window.innerWidth + 1 && getComputedStyle(e).position !== 'fixed';
    }).slice(0, 5).map((e) => (e.className && e.className.baseVal === undefined ? e.className : e.tagName)),
  }));
}

async function main() {
  if (!arg('no-build')) {
    const r = spawnSync('npm', ['run', 'build'], { cwd: ROOT, stdio: 'inherit' });
    if (r.status !== 0) throw new Error('build failed');
  }
  const browser = await launch();
  try {
    if (!arg('accounts-only')) await homePage(browser);
    // family accounts (docs/ACCOUNTS.md §9, §12.9): the pages as SW_ACCOUNTS=required and
    // optional build and serve them, with the Family page in every state
    if (!arg('no-accounts')) await accountPages(browser);
  } finally {
    await browser.close();
  }
  if (errors.length) {
    console.error(`\n${errors.length} problem(s):`);
    for (const e of errors) console.error(' - ' + e);
    process.exitCode = 1;
  } else console.log('\nHOME PAGE OK' + (arg('no-accounts') ? '' : ' (and the account pages)'));
}

async function homePage(browser) {
  const port = await freePort();
  const server = await startServer(port);
  const base = `http://localhost:${port}`;
  try {
    // ---- server routes and headers
    console.log('routes');
    const home = await fetch(`${base}/`, { headers: { 'accept-encoding': 'gzip' } });
    const csp = home.headers.get('content-security-policy') || '';
    check(home.status === 200 && /text\/html/.test(home.headers.get('content-type')), `/ is the home page (${home.status})`);
    check(!/googleapis|gstatic|https:/.test(csp) && /font-src 'self'/.test(csp) && /script-src 'self'/.test(csp), `the home page's CSP allows only this site (${csp.slice(0, 70)}…)`);
    const font = await fetch(`${base}/fonts/fredoka-latin.woff2`);
    check(font.status === 200 && font.headers.get('content-type') === 'font/woff2' && (await font.arrayBuffer()).byteLength > 10000, 'the Fredoka font is served by the site (font/woff2)');
    const homeHtml = await (await fetch(`${base}/`)).text();
    check(!/fonts\.(googleapis|gstatic)\.com/.test(homeHtml) && /rel="preload" href="fonts\/fredoka-latin\.woff2"/.test(homeHtml), 'the home page preloads its own font and links nothing from Google');
    check(/apple-touch-icon" href="img\/icon-180\.png"/.test(homeHtml) && (await fetch(`${base}/img/icon-180.png`)).status === 200, 'the home-screen icon is there');
    check((await fetch(`${base}/img/share.jpg`)).status === 200, 'the link preview picture is there');
    const tagged = withShareTags('<head>\n  <!-- share-tags: x -->\n</head>', 'sparkle.example.app');
    check(/og:url" content="https:\/\/sparkle\.example\.app\/"/.test(tagged) && /og:image" content="https:\/\/sparkle\.example\.app\/img\/share\.jpg"/.test(tagged) && /summary_large_image/.test(tagged), 'with RAILWAY_PUBLIC_DOMAIN the page gets og:url, og:image and twitter:card');
    check(withShareTags('<head>\n  <!-- share-tags: x -->\n</head>', '') === '<head>\n</head>' && shareTags('bad domain"><script>') === '', 'without it (or with a strange one) those tags are left out');
    check(process.env.RAILWAY_PUBLIC_DOMAIN ? /og:image/.test(homeHtml) : !/og:image|share-tags/.test(homeHtml), 'the built page matches RAILWAY_PUBLIC_DOMAIN');
    check(home.headers.get('content-encoding') === 'gzip' && !!home.headers.get('etag'), 'gzip + ETag on the home page');
    const homePP = home.headers.get('permissions-policy') || '';
    check(/camera=\(\)/.test(homePP) && /microphone=\(\)/.test(homePP), `Permissions-Policy on the home page: camera and microphone off (${homePP})`);
    const again = await fetch(`${base}/`, { headers: { 'if-none-match': home.headers.get('etag') } });
    check(again.status === 304, `a second visit is a 304 (${again.status})`);
    const play = await fetch(`${base}/play`);
    const playHtml = await play.text();
    const playPP = play.headers.get('permissions-policy') || '';
    check(play.status === 200 && playHtml.includes('<div id="app"></div>') && /camera=\(\)/.test(playPP) && /microphone=\(self\)/.test(playPP), `/play is the game (camera off, the microphone for this site only, for the walkie-talkie: ${playPP})`);
    const playCsp = play.headers.get('content-security-policy') || '';
    check(/frame-ancestors 'none'/.test(playCsp) && /connect-src 'self'/.test(playCsp) && !/font-src|style-src|default-src/.test(playCsp), `the game page has the relay's CSP, not the home page's (its Google font still loads): ${playCsp}`);
    check((await fetch(`${base}/sparkle-world.html`)).status === 200, 'the old /sparkle-world.html still opens the game');
    check((await fetch(`${base}/healthz`)).status === 200, '/healthz answers');
    const info = await (await fetch(`${base}/api/net`)).json();
    check(info.ok === true && typeof info.build === 'string', `/api/net answers ${JSON.stringify(info)}`);
    const parentsRes = await fetch(`${base}/parents`);
    check(parentsRes.status === 200, '/parents opens the grown-ups page');
    // the words about voice are true: a walkie-talkie a grown-up turns on, never "no voice"
    const parentsHtml = await parentsRes.text();
    for (const [label, html] of [['home page', homeHtml], ['grown-ups page', parentsHtml]]) {
      check(!/no voice/i.test(html) && /walkie-talkie/i.test(html) && /multiplication/i.test(html) && /recorded/i.test(html) && /mute/i.test(html) && /only works on this website|only on this website|website version/i.test(html), `${label}: voice is described as the walkie-talkie (grown-up check, never recorded, mute, website only), never "no voice"`);
    }
    check((await fetch(`${base}/preview.html`)).status === 404, 'the Artifact fragment is not served as a page');
    check((await fetch(`${base}/../package.json`)).status === 404 && (await fetch(`${base}/%2e%2e/package.json`)).status === 404, 'no files outside dist/site/');
    const img = await fetch(`${base}/img/title.webp`);
    check(img.status === 200 && img.headers.get('content-type') === 'image/webp' && /max-age/.test(img.headers.get('cache-control') || ''), 'pictures are image/webp with a cache time');

    // ---- the page at every size
    for (const s of SIZES) {
      console.log(`home page ${s.w}x${s.h}`);
      const context = await browser.newContext({ viewport: { width: s.w, height: s.h }, deviceScaleFactor: 1, hasTouch: s.touch, isMobile: s.touch });
      await routeGoogleFonts(context);
      const page = await context.newPage();
      collect(page, `home-${s.w}`, base);
      await page.goto(`${base}/`, { waitUntil: 'load' });
      await page.evaluate(() => document.fonts.ready);
      // scroll through so every lazy picture loads, then back to the top
      const height = await page.evaluate(() => document.documentElement.scrollHeight);
      for (let y = 0; y < height; y += Math.round(s.h * 0.6)) {
        await page.evaluate((y) => window.scrollTo({ top: y, behavior: 'instant' }), y);
        await page.waitForTimeout(250);
      }
      await page.waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalWidth > 0), null, { timeout: 30000, polling: 250 }).catch(() => {});
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
      const pics = await page.evaluate(() => [...document.images].filter((i) => !i.naturalWidth).map((i) => i.getAttribute('src')));
      check(!pics.length, `every picture loaded${pics.length ? ' (missing: ' + pics.join(', ') + ')' : ''}`);
      const over = await overflow(page);
      // (a phone widens its layout to fit anything too wide, so compare with the phone's width)
      check(over.sw <= s.w && over.w === s.w, `no sideways scrolling (page ${over.sw}px, window ${over.w}px of ${s.w}${over.wide.length ? '; ' + over.wide.join(', ') : ''})`);
      if (s.w <= 900) {
        const hero = await page.evaluate(() => {
          const pc = document.querySelector('.postcard img').getBoundingClientRect();
          const faces = [...document.querySelectorAll('.dio .f')].map((f) => f.getBoundingClientRect()).filter((r) => r.width);
          return { top: pc.top, mid: pc.top + pc.height / 2, h: window.innerHeight, left: Math.min(...faces.map((r) => r.left)), right: Math.max(...faces.map((r) => r.right)), w: window.innerWidth };
        });
        if (s.w < 700) check(hero.mid < hero.h, `the game picture is on the first screen (its middle at ${Math.round(hero.mid)}px of ${hero.h})`);
        check(hero.left >= 15.5 && hero.right <= hero.w - 15.5, `the island stays inside the side margins (${Math.round(hero.left)}..${Math.round(hero.right)} of ${hero.w})`);
      }
      const alt = await page.evaluate(() => [...document.images].filter((i) => !i.hasAttribute('alt')).length);
      check(alt === 0, 'every picture has an alt attribute');
      const fredoka = await page.evaluate(() => document.fonts.check('600 20px Fredoka'));
      check(fredoka, 'Fredoka loaded');
      await mkdir(SHOTS, { recursive: true });
      await page.waitForTimeout(400);
      await page.screenshot({ path: path.join(SHOTS, `${PREFIX}-${s.w}.png`), fullPage: true });
      await page.screenshot({ path: path.join(SHOTS, `${PREFIX}-${s.w}-top.png`) });
      console.log(`  screenshots .shots/${PREFIX}-${s.w}.png, .shots/${PREFIX}-${s.w}-top.png`);

      if (s.w === 390 || s.w === 1280) {
        // the picture-code demo
        const code = await page.$$eval('#host-code li span', (els) => els.map((e) => e.textContent));
        const wrong = code.slice().reverse();
        for (const w of wrong) await page.locator(`#keys .key[aria-label="${w}"]`).click();
        await page.locator('#go').click();
        check(/Nobody is playing/.test(await page.locator('#pad-msg').textContent()), 'demo: a wrong code is refused kindly');
        await page.locator('#clear').click();
        for (const w of code) await page.locator(`#keys .key[aria-label="${w}"]`).click();
        await page.locator('#go').click();
        await page.locator('#let-in').waitFor({ state: 'visible' });
        await page.locator('#let-in').scrollIntoViewIfNeeded();
        await page.screenshot({ path: path.join(SHOTS, `${PREFIX}-${s.w}-demo-knock.png`) });
        await page.locator('#let-in').click();
        await page.locator('[data-view="in"]').waitFor({ state: 'visible', timeout: 5000 });
        check(await page.locator('#host [data-view="done"]').isVisible(), `demo: ${code.join(', ')} -> knock -> Let in! -> playing together`);
        await page.locator('.mini-phrases button', { hasText: "Let's build!" }).click();
        check(await page.locator('#host-bubble').isVisible() && /Let's build!/.test(await page.locator('#host-bubble').textContent()), 'demo: tapping "Let\'s build!" shows it in a bubble on Lily\'s iPad');
        const pill = await page.locator('.mini-phrases button').first().boundingBox();
        check(pill && pill.height >= 44, `demo: the phrase buttons are big enough to tap (${pill && Math.round(pill.height)}px)`);
        await page.screenshot({ path: path.join(SHOTS, `${PREFIX}-${s.w}-demo-done.png`) });
      }

      if (s.w === 1280) {
        // every link answers; /play opens the game
        const links = await page.$$eval('a[href]', (as) => [...new Set(as.map((a) => a.getAttribute('href')))]);
        for (const href of links) {
          if (href.startsWith('#')) {
            check(await page.locator(href).count() === 1, `link ${href} has its section`);
            continue;
          }
          const url = new URL(href, `${base}/`).href;
          const r = await fetch(url);
          check(r.status === 200, `link ${href} answers ${r.status}`);
        }
        const game = await context.newPage();
        collect(game, 'play');
        await page.locator('.hero .btn-play').click();
        await page.waitForURL(`${base}/play`);
        await waitForTitle(page, 60000);
        check(await page.evaluate(() => window.__game.ui.current === 'title' && !!document.querySelector('.sw-logo')), 'Play now opens the game at /play (title screen)');
        const kind = await page.waitForFunction(() => window.__game.net && window.__game.net.kind, null, { timeout: 10000 }).then((h) => h.jsonValue()).catch(() => null);
        check(kind === 'ws', `the game at /play still finds the multiplayer server (${kind})`);
        await game.close();
        const parents = await context.newPage();
        collect(parents, 'parents');
        await parents.goto(`${base}/parents.html`);
        await parents.evaluate(() => document.fonts.ready);
        const pov = await parents.evaluate((W) => document.documentElement.scrollWidth <= W && window.innerWidth === W, s.w);
        check(pov, 'parents.html: no sideways scrolling');
        await parents.screenshot({ path: path.join(SHOTS, `${PREFIX}-parents-1280.png`), fullPage: true });
      }
      if (s.w === 390) {
        const parents = await context.newPage();
        collect(parents, 'parents-390');
        await parents.goto(`${base}/parents.html`);
        await parents.evaluate(() => document.fonts.ready);
        check(await parents.evaluate((W) => document.documentElement.scrollWidth <= W && window.innerWidth === W, s.w), 'parents.html at 390: no sideways scrolling');
        await parents.screenshot({ path: path.join(SHOTS, `${PREFIX}-parents-390.png`), fullPage: true });
      }
      await context.close();
    }

    // ---- phones without the font: the fallback font must fit too
    for (const s of NO_FONT) {
      console.log(`home page ${s.w}x${s.h}, font blocked`);
      const context = await browser.newContext({ viewport: { width: s.w, height: s.h }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
      await context.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, (route) => route.abort());
      await context.route(/\/fonts\/[^/]+\.woff2$/, (route) => route.abort());
      const page = await context.newPage();
      await page.goto(`${base}/`, { waitUntil: 'load' });
      await page.evaluate(() => document.fonts.ready);
      check(!(await page.evaluate(() => document.fonts.check('600 20px Fredoka') && [...document.fonts].some((f) => f.family.replace(/"/g, '') === 'Fredoka' && f.status === 'loaded'))), 'Fredoka really is missing');
      const over = await overflow(page);
      check(over.sw <= s.w && over.w === s.w, `no sideways scrolling with the fallback font (page ${over.sw}px, window ${over.w}px of ${s.w}${over.wide.length ? '; ' + over.wide.join(', ') : ''})`);
      if (s.w === 360) {
        await page.screenshot({ path: path.join(SHOTS, `${PREFIX}-360-nofont.png`), fullPage: true });
        console.log(`  screenshot .shots/${PREFIX}-360-nofont.png`);
      }
      const parents = await context.newPage();
      await parents.goto(`${base}/parents.html`, { waitUntil: 'load' });
      const pov = await overflow(parents);
      check(pov.sw <= s.w && pov.w === s.w, `parents.html with the fallback font: no sideways scrolling (page ${pov.sw}px of ${s.w}${pov.wide.length ? '; ' + pov.wide.join(', ') : ''})`);
      await context.close();
    }

    // ---- reduced motion: nothing moves
    {
      const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
      await routeGoogleFonts(context);
      const page = await context.newPage();
      collect(page, 'reduced');
      await page.goto(`${base}/`);
      const moving = await page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running').length);
      check(moving === 0, `prefers-reduced-motion: no animations running (${moving})`);
      await context.close();
    }

    // ---- the Artifact fragment
    const frag = await readFile(path.join(ROOT, 'dist', 'site', 'preview.html'), 'utf8');
    check(frag.startsWith('<title>') && !/<!doctype|<html[\s>]|<head[\s>]|<body[\s>]/i.test(frag), 'preview.html is a fragment starting with <title>');
    check(/url\(fonts\/fredoka-latin\.woff2\)/.test(frag) && /<style>/.test(frag) && /<script>/.test(frag) && /src="img\/title\.webp"/.test(frag) && /href="\/play"/.test(frag), 'preview.html inlines the style (with the font) and script, keeps img/... and /play');
    {
      const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      await routeGoogleFonts(context);
      const page = await context.newPage();
      collect(page, 'preview');
      // served from dist/site/ like an Artifact with its files: a page that is only the fragment
      await page.route(`${base}/preview-test`, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: frag }));
      await page.goto(`${base}/preview-test`);
      await page.waitForTimeout(600);
      check(await page.locator('#keys .key').count() === 12, 'the fragment runs (the demo keypad is there)');
      await page.screenshot({ path: path.join(SHOTS, `${PREFIX}-preview.png`) });
      await context.close();
    }
  } finally {
    server.kill('SIGTERM');
  }
}

// =====================================================================================
// the account pages (docs/ACCOUNTS.md §9, §12.9): the site built for SW_ACCOUNTS=required and
// optional (tools/site-build.mjs into a temporary folder), served by server/server.mjs in this
// process with the in-memory stand-in for the accounts (tools/fake-accounts.mjs, which uses the
// real /api router): the words on /, /parents, /privacy and /terms, the headers, and the
// Family page in every state of §9.2 at iPhone (390x844), iPad (1024x768) and desktop
// (1280x800) sizes, plus 360 px: no console errors, no failed requests, nothing from other
// sites, no sideways scrolling, 44 px targets, screenshots .shots/<prefix>-acct-<state>-<size>.png.
// Then the whole sign-up journey through the page: email code, notice, plan, the pretend
// Checkout, first player, switches (with the email check), a kid's device code, sign out,
// deleting the account.

const ACCT_SIZES = [
  { w: 390, h: 844, touch: true, label: 'iphone' },
  { w: 1024, h: 768, touch: true, label: 'ipad' },
  { w: 1280, h: 800, touch: false, label: 'desktop' },
  { w: 360, h: 780, touch: true, label: '360', shots: false },
];
const OPERATOR = { SW_OPERATOR_NAME: 'The Sparkle Family', SW_OPERATOR_EMAIL: 'hello@sparkleworld.example', SW_OPERATOR_ADDRESS: 'PO Box 123, Springfield, IL 62701', SW_OPERATOR_PHONE: '+1 555 0100' };

async function buildAccountSite(mode, extraEnv = {}) {
  const { buildSite } = await import('./site-build.mjs');
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const dir = mkdtempSync(path.join(tmpdir(), `sw-site-${mode}-`));
  const env = { ...process.env, SW_ACCOUNTS: mode, SW_REQUIRED_FROM: '2026-11-02', ...OPERATOR, ...extraEnv };
  const result = await buildSite({ out: dir, mode, env, quiet: true });
  return { dir, result };
}

async function startAccountServer(mode, siteDir, fakeOpts = {}) {
  const { createFakeAccounts } = await import('./fake-accounts.mjs');
  const { createServer } = await import('../server/server.mjs');
  const port = await freePort();
  const base = `http://localhost:${port}`;
  const fake = await createFakeAccounts({ mode, publicOrigin: base, ...fakeOpts });
  const app = createServer({ accounts: fake, siteDir, log: () => {} });
  await app.listen(port);
  return { fake, app, base, port, close: () => app.close() };
}

const LILY = { nickname: 'Lily', friends: true, walkie: true, worlds: 3 };
const MIA = { nickname: 'Mia', worlds: 1 };

/** A family with a signed-in grown-up; returns { f, cookie, players }. */
function familyOf(fake, { plan = 'active', consent = 'verified', players = [LILY, MIA], elevated = true, kidDevice = true } = {}) {
  const f = fake.addFamily({ plan, consent });
  const ids = players.map((p) => fake.addPlayer(f, p));
  if (kidDevice && ids.length) fake.addSession(f, { kind: 'device', label: "Lily's iPad", lockPlayer: ids[0] });
  return { f, ids, cookie: fake.addSession(f, { kind: 'parent', elevated, label: 'Mac · Safari' }).token };
}

const clickText = (page, name) => page.getByRole('button', { name, exact: true }).first().click();

/** Every Family page state (§9.2): setup(fake) → { cookie?, path?, wait, act?, expect?, label? }. */
const ACCT_STATES = [
  { name: 'signin', setup: () => ({ wait: '#email', expect: async (p) => /sign in or start the Family Plan/.test(await p.textContent('main')) && /Kids never need an email/.test(await p.textContent('main')), label: 'sign in, and "Kids never need an email"' }) },
  { name: 'signin-from-game', setup: () => ({ path: '/account?next=/play', wait: '#email', expect: async (p) => /take you back to the game/.test(await p.textContent('main')), label: 'from the game: back to it after signing in' }) },
  { name: 'code', setup: () => ({ wait: '#email', act: async (p) => {
    await p.fill('#email', 'grown.up@example.com');
    await p.click('button[type=submit]');
    await p.waitForSelector('.code-boxes');
    await p.locator('#code').fill('482');
  }, expect: async (p) => (await p.getAttribute('#code', 'autocomplete')) === 'one-time-code' && (await p.getAttribute('#code', 'inputmode')) === 'numeric' && /g•••@example\.com/.test(await p.textContent('main')), label: 'the code boxes: one-time-code, numeric, the email masked' }) },
  { name: 'notice', setup: (fake) => ({ cookie: familyOf(fake, { plan: 'none', consent: 'none', players: [] }).cookie, wait: '#agree', expect: async (p) => !(await p.isChecked('#agree')) && (await p.isDisabled('button:has-text("Agree and continue")')) && (await p.locator('.notice-list li').count()) >= 6, label: 'the notice: every section, the box starts empty, Agree waits for it' }) },
  { name: 'plan', setup: (fake) => ({ cookie: familyOf(fake, { plan: 'none', consent: 'email_plus', players: [] }).cookie, wait: '#us', act: async (p) => clickText(p, 'Start the Family Plan'), expect: async (p) => !(await p.isChecked('#us')) && /only for families in the US/.test(await p.textContent('.acct-error')) && /\$5\.99/.test(await p.textContent('.plan-choice')) && /renews every month until you cancel/.test(await p.textContent('.plan-choice')), label: 'the plan: price and renewal next to the button, the US box starts empty and is needed' }) },
  { name: 'plan-trial', server: 'trial', setup: (fake) => ({ cookie: familyOf(fake, { plan: 'none', consent: 'email_plus', players: [] }).cookie, wait: '#us', expect: async (p) => (await p.locator('.plan-choice .btn').count()) === 2 && /Free for 7 days, then \$5\.99\/month/.test(await p.textContent('main')), label: 'with SW_TRIAL_DAYS=7: the free week and Start today, each with its terms' }) },
  { name: 'plan-cancelled', setup: (fake) => ({ cookie: familyOf(fake, { plan: 'none', consent: 'email_plus', players: [] }).cookie, path: '/account?checkout=cancel', wait: '#us', expect: async (p) => /No payment was made/.test(await p.textContent('main')), label: 'back from Checkout without paying' }) },
  { name: 'back-from-stripe', setup: (fake) => ({ cookie: familyOf(fake, { players: [] }).cookie, path: '/account?checkout=cs_test_back', wait: '.all-set', expect: async (p) => /You're all set!/.test(await p.textContent('main')) && !/checkout=/.test(p.url()) && (await p.getByRole('button', { name: 'Add your first player' }).count()) === 1, label: 'back from Stripe: "You\'re all set!" and Add your first player' }) },
  { name: 'us-only', setup: (fake) => ({ cookie: familyOf(fake, { plan: 'lapsed', players: [] }).cookie, path: '/account?checkout=cs_test_usonly', wait: 'text=only in the United States for now', expect: async (p) => /Nothing more will be charged/.test(await p.textContent('main')), label: 'back from Stripe with a billing address outside the US: cancelled, nothing charged' }) },
  { name: 'first-player', setup: (fake) => ({ cookie: familyOf(fake, { players: [] }).cookie, wait: '#nick', act: async (p) => p.fill('#nick', 'Star Bunny 7'), expect: async (p) => /Other players will see: Star Bunny/.test(await p.textContent('.preview')), label: 'add the first player: the preview through the game\'s own name filter' }) },
  { name: 'dash', setup: (fake) => ({ cookie: familyOf(fake).cookie, wait: '.device', expect: async (p) => /renews/.test(await p.textContent('.ribbon')) && /Cancel the plan/.test(await p.textContent('.ribbon')) && (await p.locator('article.player').count()) === 2, label: 'the dashboard: plan (with Cancel the plan), players, devices, privacy' }) },
  { name: 'cancel-plan', setup: (fake) => ({ cookie: familyOf(fake, { elevated: false }).cookie, wait: '.device', act: async (p) => {
    await clickText(p, 'Cancel the plan');
    await p.waitForSelector('dialog .btn-danger');
  }, expect: async (p) => /Nothing more will be charged/.test(await p.textContent('dialog')) && !(await p.locator('dialog .code-boxes').count()), label: 'cancelling: one question, no email code' }) },
  { name: 'dash-comp-renews', setup: (fake) => {
    const f = familyOf(fake, { plan: 'active' });
    fake.setFamily(f.f, { comp_until: new Date(Date.now() + 60 * 86400e3) });
    return { cookie: f.cookie, wait: '.device', expect: async (p) => /Free pass until .*still renews on/.test(await p.textContent('.ribbon')) && /Cancel the plan/.test(await p.textContent('.ribbon')) && /Manage subscription/.test(await p.textContent('.ribbon')), label: 'a free pass on top of a plan that still renews: Manage and Cancel stay' };
  } },
  { name: 'notice-again', setup: (fake) => {
    const f = familyOf(fake, { players: [LILY] });
    fake.setFamily(f.f, { notice_version: 0 });
    return { cookie: f.cookie, wait: '#agree', expect: async (p) => /We changed this notice since you last agreed/.test(await p.textContent('main')) && !(await p.isChecked('#agree')), label: 'a notice that changed in a way that matters: asked again' };
  } },
  { name: 'dash-trialing', server: 'trial', setup: (fake) => ({ cookie: familyOf(fake, { plan: 'trialing', consent: 'email_plus', players: [{ nickname: 'Lily' }, MIA] }).cookie, wait: '.device', expect: async (p) => /Free week: \d+ days? left, then \$5\.99\/month/.test(await p.textContent('.ribbon')) && (await p.locator('article.player .switch').first().isDisabled()) && /Turns on after your first payment/.test(await p.textContent('article.player')), label: 'free week: days left, Start now, friends locked until the first payment' }) },
  { name: 'dash-past-due', setup: (fake) => ({ cookie: familyOf(fake, { plan: 'past_due' }).cookie, wait: '.device', expect: async (p) => /Payment didn't go through\. Playing continues until/.test(await p.textContent('.ribbon')) && /Update card/.test(await p.textContent('.ribbon')), label: "payment didn't go through: Update card" }) },
  { name: 'dash-canceling', setup: (fake) => ({ cookie: familyOf(fake, { plan: 'canceling' }).cookie, wait: '.device', expect: async (p) => /ends/.test(await p.textContent('.ribbon')) && /Resume/.test(await p.textContent('.ribbon')), label: 'cancelling: Ends … Resume' }) },
  { name: 'dash-lapsed', setup: (fake) => ({ cookie: familyOf(fake, { plan: 'lapsed' }).cookie, wait: '.device', expect: async (p) => /Resting: the kids' worlds are kept until/.test(await p.textContent('.ribbon')) && /Restart the plan/.test(await p.textContent('.ribbon')) && /Download worlds/.test(await p.textContent('.ribbon')), label: 'resting: kept until …, Restart, Download' }) },
  { name: 'dash-comp', setup: (fake) => ({ cookie: familyOf(fake, { plan: 'comp', consent: 'email_plus', players: [{ nickname: 'Lily' }] }).cookie, wait: '.device', expect: async (p) => /Free pass until/.test(await p.textContent('.ribbon')) && /signed consent form/.test(await p.textContent('article.player')), label: 'a free pass' }) },
  { name: 'check', setup: (fake) => ({ cookie: familyOf(fake, { elevated: false }).cookie, wait: '.device', act: async (p) => {
    await p.locator('article.player', { hasText: 'Mia' }).locator('.switch').first().click();
    await p.waitForSelector('dialog .code-boxes');
  }, expect: async (p) => /We emailed a code to g•••@example\.com/.test(await p.textContent('dialog')), label: 'the email check before switching Play with friends on' }) },
  { name: 'pair', setup: (fake) => ({ cookie: familyOf(fake).cookie, wait: '.device', act: async (p) => {
    await clickText(p, "Set up a kid's device");
    await p.selectOption('#pair-who', { label: 'Only Lily' });
    await clickText(p, 'Make a code');
    await p.waitForSelector('.pair-code');
  }, expect: async (p) => /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/.test((await p.textContent('.pair-code')).trim()) && /Works for (9|10):\d\d/.test(await p.textContent('dialog')), label: "a kid's device: the code, big, with a 10-minute countdown" }) },
  { name: 'summary', setup: (fake) => ({ cookie: familyOf(fake).cookie, wait: '.device', act: async (p) => {
    await clickText(p, "See Lily's data");
    await p.waitForSelector('.facts-grid');
  }, expect: async (p) => (await p.locator('.worlds-list li').count()) === 3, label: "See Lily's data: worlds, stickers, coins, progress" }) },
  { name: 'add-player', setup: (fake) => ({ cookie: familyOf(fake).cookie, wait: '.device', act: async (p) => {
    await p.click('.player-add');
    await p.waitForSelector('dialog #nick');
  } }) },
  { name: 'delete-player', setup: (fake) => ({ cookie: familyOf(fake).cookie, wait: '.device', act: async (p) => {
    await clickText(p, 'Delete Mia');
    await p.waitForSelector('dialog #confirm-nick');
  }, expect: async (p) => p.isDisabled('dialog .btn-danger-strong'), label: 'deleting a player waits for her nickname' }) },
  { name: 'delete-account', setup: (fake) => ({ cookie: familyOf(fake).cookie, wait: '.device', act: async (p) => {
    await clickText(p, 'Delete our account');
    await p.waitForSelector('dialog #confirm-delete');
  }, expect: async (p) => /cancelled now, with no further charges/.test(await p.textContent('dialog')) && /backups roll off within 7 days/.test(await p.textContent('dialog')), label: 'deleting the account says what happens' }) },
  { name: 'this-device', setup: (fake) => ({ cookie: familyOf(fake).cookie, wait: '.device', act: async (p) => {
    await clickText(p, 'Kids play on this device');
    await p.waitForSelector('dialog #this-who');
  } }) },
  { name: 'kid-device', setup: (fake) => {
    const f = familyOf(fake);
    return { cookie: fake.addSession(f.f, { kind: 'device' }).token, wait: 'text=This device is set up for the kids' };
  } },
  { name: 'gone', setup: (fake) => {
    const f = familyOf(fake);
    fake.deleteFamily(f.f);
    return { cookie: f.cookie, wait: 'text=Your account is deleted', allow: [/\/api\/me.*410|410.*\/api\/me/] };
  } },
  { name: 'verify', setup: (fake) => ({ path: '/account/verify#t=' + fake.signInLink('grownup.link@example.com'), wait: 'text=You are signing in as', expect: async (p) => !/#t=/.test(p.url()) && /Sign in to Sparkle World\?/.test(await p.textContent('main')) && /g•••@example\.com/.test(await p.textContent('main')) && !(await p.locator('#grownup-answer').count()), label: 'the link page: the token leaves the address bar, it says whose sign-in it is, nothing happens without the button' }) },
  { name: 'verify-replace', setup: (fake) => {
    const other = familyOf(fake, { players: [LILY] });
    return { cookie: fake.addSession(other.f, { kind: 'device', label: 'iPad · Safari' }).token, path: '/account/verify#t=' + fake.signInLink('stranger@example.com'), wait: 'text=This device is signed in to another family', expect: async (p) => (await p.locator('#grownup-answer').count()) === 1 && /s•••@example\.com/.test(await p.textContent('main')), label: "a link opened on another family's kid device: a warning and the grown-up question first" };
  } },
  { name: 'verify-expired', setup: () => ({ path: '/account/verify#t=' + 'A'.repeat(43), wait: 'text=This link has run out', allow: true, expect: async (p) => !/#t=/.test(p.url()), label: 'an old link: run out, get a new code' }) },
  { name: 'verify-incomplete', setup: () => ({ path: '/account/verify', wait: 'text=This sign-in link is not complete' }) },
];

/** Visible touch targets smaller than 44 px (buttons, switches, fields; not links inside sentences). */
function smallTargets(page) {
  return page.evaluate(() => [...document.querySelectorAll('main button, main select, main input.acct-input, dialog button, dialog select, dialog input.acct-input, .top a.btn')]
    .filter((e) => e.offsetParent !== null && !e.closest('p'))
    .map((e) => [e.textContent.trim().slice(0, 30) || e.className, Math.round(e.getBoundingClientRect().height)])
    .filter(([, hgt]) => hgt < 44));
}

async function accountPages(browser) {
  const req = await buildAccountSite('required');
  const opt = await buildAccountSite('optional');
  const bare = await buildAccountSite('required', { SW_OPERATOR_NAME: '', SW_OPERATOR_EMAIL: '', SW_OPERATOR_ADDRESS: '', SW_OPERATOR_PHONE: '' });
  console.log('account pages: the site for SW_ACCOUNTS=required and optional');
  check(req.result.accounts === 'required' && req.result.missing.length === 0, `built for required with the operator details (${JSON.stringify(req.result.missing)})`);
  check(bare.result.missing.length === 4, `without the operator details the build warns (${bare.result.missing.join(', ')})`);
  {
    // a child's color is the same on the Family page and in the game's "Who's playing?"
    const { readFileSync, existsSync } = await import('node:fs');
    const picker = path.join(ROOT, 'src', 'account', 'picker.js');
    const colorsOf = (file, name) => (new RegExp(`${name}\\s*=\\s*\\[([^\\]]*)\\]`).exec(readFileSync(file, 'utf8')) || [])[1]?.replace(/\s/g, '') ?? null;
    if (existsSync(picker)) check(colorsOf(picker, 'COLORS') === colorsOf(path.join(ROOT, 'site', 'account.js'), 'PLAYER_COLORS'), "the Family page's player colors are the game's (src/account/picker.js)");
  }
  const srv = await startAccountServer('required', req.dir);
  const trial = await startAccountServer('required', req.dir, { trialDays: 7 });
  const optSrv = await startAccountServer('optional', opt.dir);
  try {
    // ---- the words (§9.5): every sentence true for the mode
    for (const [mode, s] of [['required', srv], ['optional', optSrv]]) {
      const home = await (await fetch(`${s.base}/`)).text();
      const parents = await (await fetch(`${s.base}/parents`)).text();
      const both = home + parents;
      check(!/\{\{|\}\}/.test(both), `${mode}: no placeholders left on / and /parents`);
      check(!/No accounts|nobody needs an account|Nothing is stored on the server|doesn't set cookies|not on our server/i.test(both), `${mode}: no "no accounts / nothing on the server / no cookies" sentence`);
      check(/id="family-plan"/.test(home) && /href="\/account">Sign in</.test(home) && /href="\/privacy"/.test(home) && /href="\/terms"/.test(home) && /\$5\.99 a month, plus sales tax where it applies/.test(home), `${mode}: the home page has the Family Plan section, Sign in, /privacy and /terms, the price with tax`);
      check(/nothing to buy inside/i.test(home) && /earned by playing/.test(home) && /cloud copy/.test(home) && /download or delete/i.test(home), `${mode}: nothing to buy inside, coins earned only, the cloud copy that can be downloaded or deleted`);
      check(/id="accounts"/.test(parents) && /href="\/privacy"/.test(parents) && /one cookie/i.test(parents), `${mode}: /parents has "Accounts and your child's information" and the one cookie`);
      check(/walkie-talkie/i.test(both) && /recorded/i.test(both) && /mute/i.test(both) && /only works on this website|only on this website|website version/i.test(both) && /Family page/.test(both), `${mode}: the walkie is described (the Family page switch, never recorded, mute, website only)`);
      if (mode === 'required') check(!/multiplication/i.test(both), 'required: no multiplication question (the Family page switch replaces it)');
      else check(/multiplication/i.test(both) && /November 2, 2026/.test(home), 'optional: devices without an account keep the multiplication question; the date playing together needs the plan');
      for (const p of ['/privacy', '/terms']) {
        const html = await (await fetch(`${s.base}${p}`)).text();
        check(!/\{\{|\}\}/.test(html) && html.includes('The Sparkle Family') && html.includes('PO Box 123') && html.includes('+1 555 0100') && html.includes('hello@sparkleworld.example'), `${mode}: ${p} prints the operator's name, address, phone and email`);
      }
    }
    const privacy = await (await fetch(`${srv.base}/privacy`)).text();
    check(/Railway/.test(privacy) && /Stripe/.test(privacy) && /never recorded/.test(privacy) && /10 business days/.test(privacy) && /90 days/.test(privacy), '/privacy: service providers, voices never recorded, retention, parent requests');
    const terms = await (await fetch(`${srv.base}/terms`)).text();
    check(/renews automatically every month/.test(terms) && /cancel any time/i.test(terms) && /no partial refunds/i.test(terms) && /United States/.test(terms) && /no in-app purchases/i.test(terms) && /no free trial/i.test(terms), '/terms: the plan, renewal until cancelled, cancelling, US only, no in-app purchases, no trial (SW_TRIAL_DAYS=0)');
    // the terms are written for no trial (the family's decision): a build with a trial says so
    const trialBuild = await buildAccountSite('required', { SW_TRIAL_DAYS: '7' });
    check(trialBuild.result.warnings.some((w) => /SW_TRIAL_DAYS=7/.test(w) && /terms/.test(w)), 'a build with SW_TRIAL_DAYS=7 warns that /terms says there is no free trial');

    // ---- headers
    const acct = await fetch(`${srv.base}/account`);
    const h = (k) => acct.headers.get(k) || '';
    check(acct.status === 200 && h('cross-origin-opener-policy') === 'same-origin' && /script-src 'self'/.test(h('content-security-policy')) && /form-action 'none'/.test(h('content-security-policy')) && /frame-ancestors 'none'/.test(h('content-security-policy')) && !/https:/.test(h('content-security-policy')), `/account: the site's CSP (only this site) and COOP same-origin`);
    check(h('x-frame-options') === 'DENY' && /microphone=\(\)/.test(h('permissions-policy')) && /payment=\(\)/.test(h('permissions-policy')) && !acct.headers.get('set-cookie'), '/account: no framing, no microphone or payment API, no cookie set by the page');
    const verify = await fetch(`${srv.base}/account/verify`);
    check(verify.status === 200 && verify.headers.get('cross-origin-opener-policy') === 'same-origin', '/account/verify: 200 with COOP');
    const me = await fetch(`${srv.base}/api/me`);
    check(me.status === 200 && me.headers.get('cache-control') === 'no-store' && me.headers.get('cross-origin-resource-policy') === 'same-origin', '/api/me: no-store, CORP same-origin');
    check((await fetch(`${srv.base}/names.js`)).headers.get('content-type')?.startsWith('text/javascript'), "the game's name filter is served for the nickname preview");
    for (const href of ['/account', '/account/verify', '/privacy', '/terms', '/parents', '/', '/play', '/third-party-notices.txt', '/account.css', '/account.js']) {
      const r = await fetch(`${srv.base}${href}`);
      if (!(r.status === 200 || (href === '/play' && r.status === 503))) check(false, `${href} answers (${r.status})`);
    }

    // ---- the home page, /parents, /privacy and /terms in the account modes, at every size
    for (const [mode, s] of [['required', srv], ['optional', optSrv]]) {
      for (const size of [...ACCT_SIZES, { w: 414, h: 896, touch: true, label: '414', shots: false }]) {
        const context = await browser.newContext({ viewport: { width: size.w, height: size.h }, deviceScaleFactor: 1, hasTouch: size.touch, isMobile: size.touch });
        const page = await context.newPage();
        collect(page, `${mode}-pages-${size.w}`, s.base);
        for (const p of mode === 'required' ? ['/', '/parents', '/privacy', '/terms'] : ['/', '/parents']) {
          await page.goto(s.base + p, { waitUntil: 'load' });
          await page.evaluate(() => document.fonts.ready);
          const over = await overflow(page);
          check(over.sw <= size.w && over.w === size.w, `${mode} ${p} at ${size.w}: no sideways scrolling (page ${over.sw}px${over.wide.length ? '; ' + over.wide.join(', ') : ''})`);
          if (p === '/') check(await page.locator('.top .top-signin').isVisible(), `${mode} / at ${size.w}: "Sign in" is in the header`);
          if (size.shots !== false && (size.w !== 1024 || p === '/')) {
            const name = p === '/' ? 'home' : p.slice(1);
            await page.screenshot({ path: path.join(SHOTS, `${PREFIX}-acct-${mode}-${name}-${size.label}.png`), fullPage: true });
          }
          await page.waitForLoadState('networkidle'); // lazy pictures the screenshot woke up
        }
        await context.close();
      }
    }

    // ---- every state at every size
    for (const size of ACCT_SIZES) {
      console.log(`Family page ${size.w}x${size.h}`);
      for (const st of ACCT_STATES) {
        const server = st.server === 'trial' ? trial : srv;
        const def = st.setup(server.fake);
        const context = await browser.newContext({ viewport: { width: size.w, height: size.h }, deviceScaleFactor: 1, hasTouch: size.touch, isMobile: size.touch });
        const page = await context.newPage();
        const label = `acct-${st.name}-${size.w}`;
        const before = errors.length;
        collect(page, label, server.base);
        if (def.cookie) await context.addCookies([{ name: server.fake.cfg.cookies.sess, value: def.cookie, url: server.base }]);
        try {
          await page.goto(server.base + (def.path || '/account'));
          await page.waitForSelector(def.wait, { timeout: 20000 });
          await page.evaluate(() => document.fonts.ready);
          if (def.act) await def.act(page);
          await page.waitForTimeout(200);
          if (def.expect) check(await def.expect(page), `${st.name} at ${size.w}: ${def.label || 'as expected'}`);
          const over = await overflow(page);
          check(over.sw <= size.w && over.w === size.w, `${st.name} at ${size.w}: no sideways scrolling (page ${over.sw}px${over.wide.length ? '; ' + over.wide.join(', ') : ''})`);
          if (size.touch) {
            const small = await smallTargets(page);
            check(!small.length, `${st.name} at ${size.w}: every button is 44 px or more${small.length ? ' (' + JSON.stringify(small) + ')' : ''}`);
          }
          check(await page.evaluate(() => document.fonts.check('600 20px Fredoka')), `${st.name} at ${size.w}: Fredoka loaded`);
          if (size.shots !== false) {
            await mkdir(SHOTS, { recursive: true });
            const modal = (await page.locator('dialog[open]').count()) > 0;
            await page.screenshot({ path: path.join(SHOTS, `${PREFIX}-acct-${st.name}-${size.label}.png`), fullPage: !modal });
          }
        } catch (err) {
          check(false, `${st.name} at ${size.w}: ${String(err.message).split('\n')[0]}`);
        }
        // the one expected failure: a deleted family's device learns it from /api/me (410)
        if (def.allow) for (let k = errors.length - 1; k >= before; k--) if (/410/.test(errors[k])) errors.splice(k, 1);
        await context.close();
      }
    }
    console.log(`  screenshots .shots/${PREFIX}-acct-<state>-{iphone,ipad,desktop}.png (${ACCT_STATES.length} states)`);

    await journey(browser, srv);
  } finally {
    await srv.close();
    await trial.close();
    await optSrv.close();
  }
}

/** The whole sign-up journey through the Family page (iPad size), against the fake accounts. */
async function journey(browser, srv) {
  console.log('Family page: the whole journey (iPad)');
  const { fake, base } = srv;
  const context = await browser.newContext({ viewport: { width: 1024, height: 768 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  collect(page, 'journey', base);
  const email = 'new.family@example.com';
  const lastCode = () => fake.lastMail(email).code;
  /** Do something that sends an email, and wait until it went out. */
  const mailed = async (fn) => {
    const n = fake.data.mail.length;
    await fn();
    const end = Date.now() + 10000;
    while (fake.data.mail.length === n && Date.now() < end) await new Promise((r) => setTimeout(r, 50));
    return lastCode();
  };
  try {
    await page.goto(`${base}/account`);
    await page.fill('#email', email);
    await page.click('button[type=submit]');
    await page.waitForSelector('.code-boxes');
    check([...fake.data.families.values()].every((f) => f.email !== email), 'asking for a code creates no family');
    await page.locator('#code').fill(lastCode());
    await page.waitForSelector('#agree');
    check(true, 'the code signs in; a new family sees the notice first');
    await page.check('#agree');
    await clickText(page, 'Agree and continue');
    await page.waitForSelector('#us');
    const fam = [...fake.data.families.values()].find((f) => f.email === email);
    check(fam && fam.consent_at && fam.notice_version === 1, 'agreeing records consent with the notice version');
    await page.check('#us');
    await clickText(page, 'Start the Family Plan');
    await page.waitForURL(/\/api\/fake\/stripe\/c\//);
    await page.click('#pay');
    await page.waitForSelector('.all-set');
    check(/You're all set!/.test(await page.textContent('.all-set')) && !/checkout=/.test(page.url()), 'back from Checkout: "You\'re all set!" (and the session id leaves the address bar)');
    await mkdir(SHOTS, { recursive: true });
    await page.screenshot({ path: path.join(SHOTS, `${PREFIX}-acct-all-set-ipad.png`) });
    await clickText(page, 'Add your first player');
    await page.fill('#nick', 'Lily');
    await page.locator('.swatch span').nth(3).click();
    await page.click('button[type=submit]');
    await page.waitForSelector('article.player');
    const lily = [...fake.data.players.values()].find((p) => p.family_id === fam.id);
    check(lily && lily.nickname === 'Lily' && lily.color === 3 && !lily.friends_on, 'the first player: nickname and color saved, Play with friends off');
    // the sign-in counts as the email check for 15 minutes: the switch goes on at once
    await page.locator('article.player').locator('.switch').first().click();
    await page.waitForFunction(() => document.querySelector('article.player .switch').getAttribute('aria-checked') === 'true');
    await page.locator('article.player').locator('.switch').nth(1).click();
    await page.waitForFunction(() => document.querySelectorAll('article.player .switch')[1].getAttribute('aria-checked') === 'true');
    check(fake.data.players.get(lily.id).friends_on && fake.data.players.get(lily.id).walkie_on, 'Play with friends and the walkie-talkie switched on (the first payment confirmed consent)');
    await page.waitForSelector('#history li time');
    check(/Play with friends on for Lily/.test(await page.textContent('#history')), 'the consent history shows it');
    // later: the check has run out, so switching on asks for a code first
    for (const s of fake.data.sessions.values()) if (s.familyId === fam.id) s.elevatedUntil = null;
    await page.reload();
    await page.waitForSelector('article.player');
    await page.locator('article.player').locator('.switch').first().click();
    await page.waitForFunction(() => document.querySelector('article.player .switch').getAttribute('aria-checked') === 'false');
    check(!fake.data.players.get(lily.id).friends_on, 'switching off needs no check');
    const checkCode = await mailed(() => page.locator('article.player').locator('.switch').first().click());
    await page.waitForSelector('dialog .code-boxes');
    await page.locator('dialog #code').fill(checkCode);
    await page.waitForFunction(() => document.querySelector('article.player .switch').getAttribute('aria-checked') === 'true');
    check(fake.data.players.get(lily.id).friends_on, 'switching on again asks for the email check, then works');
    // a kid's device
    await clickText(page, "Set up a kid's device");
    await clickText(page, 'Make a code');
    await page.waitForSelector('.pair-code');
    const code = (await page.textContent('.pair-code')).trim();
    check(fake.data.pairCodes.has(code.replace('-', '')), `the pair code ${code} is live`);
    await clickText(page, 'Done');
    // a device pairs with it (as the game would): it shows up in the list
    const pair = await fetch(`${base}/api/auth/pair`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-SW': '1', Origin: base }, body: JSON.stringify({ code: code.toLowerCase() }) });
    check(pair.status === 200, `the game's "I have a code" with that code (${pair.status})`);
    await page.reload();
    await page.waitForSelector('.device');
    check(/Kid device/.test(await page.textContent('#devices')), 'the paired device is listed as a kid device');
    // download everything (a file), then delete the account
    const [download] = await Promise.all([page.waitForEvent('download'), clickText(page, 'Download everything')]);
    check(/^sparkle-world-family-\d{4}-\d\d-\d\d\.json$/.test(download.suggestedFilename()), `Download everything saves ${download.suggestedFilename()}`);
    // six minutes later: deleting needs a check from the last 5 minutes
    for (const s of fake.data.sessions.values()) if (s.familyId === fam.id && !s.revoked) {
      s.elevatedAt = Date.now() - 6 * 60e3;
      s.elevatedUntil = s.elevatedAt + 15 * 60e3;
    }
    await page.reload();
    await page.waitForSelector('.device');
    await clickText(page, 'Delete our account');
    await page.fill('#confirm-delete', 'DELETE');
    const delCode = await mailed(() => page.locator('dialog .btn-danger-strong').click());
    await page.waitForSelector('dialog:has(.code-boxes)');
    await page.locator('dialog:has(.code-boxes) #code').fill(delCode);
    await page.waitForSelector('text=Your account is deleted');
    check(!fake.data.families.has(fam.id) && fake.lastMail(email).template === 'account_deleted', 'deleting the account needs a fresh check, then everything is gone and the goodbye email is sent');
    await page.screenshot({ path: path.join(SHOTS, `${PREFIX}-acct-deleted-ipad.png`) });
  } catch (err) {
    check(false, `the journey: ${String(err.message).split('\n')[0]}`);
    await page.screenshot({ path: path.join(SHOTS, `${PREFIX}-acct-journey-failed.png`) }).catch(() => {});
  }
  await context.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
