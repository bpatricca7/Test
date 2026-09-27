// Checks the home page the way Railway serves it:
//
//   node tools/site-check.mjs [--no-build] [--shots-prefix=site]
//
// 1. `npm run build` (unless --no-build), then server/server.mjs as its own process on a free
//    port (PORT=<n> npm start, like Railway).
// 2. "/" at 390x844, 768x1024, 1280x800 and 1440x900: no console errors, no failed requests,
//    no sideways scrolling, every picture loaded, full-page screenshots .shots/<prefix>-<w>.png.
// 3. Every link on the page answers (and "/play" really opens the game's title screen), plus
//    /healthz, /api/net, /parents, the headers (CSP on the page, gzip, ETag and 304s).
// 4. The picture-code demo: a wrong code is refused, the right one knocks, "Let in!" lets in.
// 5. dist/site/preview.html is a fragment (no doctype/html/head/body) with the same content.

import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { mkdir, readFile } from 'node:fs/promises';
import { launch, waitForTitle, ROOT, SHOTS } from './smoke.mjs';
import { routeGoogleFonts } from './site-fonts.mjs';

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

function collect(page, label) {
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
  { w: 390, h: 844, touch: true },
  { w: 768, h: 1024, touch: true },
  { w: 1280, h: 800, touch: false },
  { w: 1440, h: 900, touch: false },
];

async function main() {
  if (!arg('no-build')) {
    const r = spawnSync('npm', ['run', 'build'], { cwd: ROOT, stdio: 'inherit' });
    if (r.status !== 0) throw new Error('build failed');
  }
  const port = await freePort();
  const server = await startServer(port);
  const base = `http://localhost:${port}`;
  const browser = await launch();
  try {
    // ---- server routes and headers
    console.log('routes');
    const home = await fetch(`${base}/`, { headers: { 'accept-encoding': 'gzip' } });
    const csp = home.headers.get('content-security-policy') || '';
    check(home.status === 200 && /text\/html/.test(home.headers.get('content-type')), `/ is the home page (${home.status})`);
    check(/fonts\.googleapis\.com/.test(csp) && /fonts\.gstatic\.com/.test(csp) && /script-src 'self'/.test(csp), `the home page has a CSP that allows Google Fonts (${csp.slice(0, 60)}…)`);
    check(home.headers.get('content-encoding') === 'gzip' && !!home.headers.get('etag'), 'gzip + ETag on the home page');
    check(/camera=\(\)/.test(home.headers.get('permissions-policy') || ''), 'Permissions-Policy is kept on the home page');
    const again = await fetch(`${base}/`, { headers: { 'if-none-match': home.headers.get('etag') } });
    check(again.status === 304, `a second visit is a 304 (${again.status})`);
    const play = await fetch(`${base}/play`);
    const playHtml = await play.text();
    check(play.status === 200 && playHtml.includes('<div id="app"></div>') && /camera=\(\)/.test(play.headers.get('permissions-policy') || ''), '/play is the game (with its Permissions-Policy)');
    check(!play.headers.get('content-security-policy'), 'the game page is served as before (no new CSP)');
    check((await fetch(`${base}/sparkle-world.html`)).status === 200, 'the old /sparkle-world.html still opens the game');
    check((await fetch(`${base}/healthz`)).status === 200, '/healthz answers');
    const info = await (await fetch(`${base}/api/net`)).json();
    check(info.ok === true && typeof info.build === 'string', `/api/net answers ${JSON.stringify(info)}`);
    check((await fetch(`${base}/parents`)).status === 200, '/parents opens the grown-ups page');
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
      collect(page, `home-${s.w}`);
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
      const over = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, w: window.innerWidth, wide: [...document.querySelectorAll('body *')].filter((e) => { const r = e.getBoundingClientRect(); return r.width && r.right > window.innerWidth + 1 && getComputedStyle(e).position !== 'fixed'; }).slice(0, 5).map((e) => e.className || e.tagName) }));
      check(over.sw <= over.w, `no sideways scrolling (page ${over.sw}px, window ${over.w}px)`);
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
        const pov = await parents.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
        check(pov, 'parents.html: no sideways scrolling');
        await parents.screenshot({ path: path.join(SHOTS, `${PREFIX}-parents-1280.png`), fullPage: true });
      }
      if (s.w === 390) {
        const parents = await context.newPage();
        collect(parents, 'parents-390');
        await parents.goto(`${base}/parents.html`);
        await parents.evaluate(() => document.fonts.ready);
        check(await parents.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'parents.html at 390: no sideways scrolling');
        await parents.screenshot({ path: path.join(SHOTS, `${PREFIX}-parents-390.png`), fullPage: true });
      }
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
    check(/fonts\.googleapis\.com/.test(frag) && /<style>/.test(frag) && /<script>/.test(frag) && /src="img\/title\.webp"/.test(frag) && /href="\/play"/.test(frag), 'preview.html inlines the style and script, keeps img/... and /play');
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
    await browser.close();
    server.kill('SIGTERM');
  }
  if (errors.length) {
    console.error(`\n${errors.length} problem(s):`);
    for (const e of errors) console.error(' - ' + e);
    process.exitCode = 1;
  } else console.log('\nHOME PAGE OK');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
