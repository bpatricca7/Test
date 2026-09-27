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
