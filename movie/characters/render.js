// Renders the animated cut with headless Chromium (WebGL via SwiftShader).
//
//   node movie/animated/render.js                          all frames -> build/frames/
//   node movie/animated/render.js --from 0 --to 480        a frame range
//   node movie/animated/render.js --stills 12,20.5 [--only valley,grid] [--out name]
//                                                          review PNGs -> build/stills/
//
// Needs Playwright (NODE_PATH=$(npm root -g)) and `npm install` in movie/animated.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { chromium } = require('playwright');

const ROOT = __dirname;
const BUILD = path.join(ROOT, 'build');
const ORIGIN = 'http://echo.local';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png' };

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : def;
}

function loadJSON(file, optional) {
  const p = path.join(BUILD, file);
  if (!fs.existsSync(p)) {
    if (optional) { console.warn(`(no ${file}; rendering without audio-reactive data)`); return null; }
    throw new Error(`missing ${p}; run timeline.py first`);
  }
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

async function openPage(browser, timeline, env, only) {
  const page = await browser.newPage({ viewport: { width: timeline.width, height: timeline.height } });
  page.on('pageerror', e => { console.error('page error:', e); process.exit(1); });
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') console.error('page:', m.text()); });
  await page.route(`${ORIGIN}/**`, route => {
    const rel = decodeURIComponent(new URL(route.request().url()).pathname);
    const file = path.join(ROOT, rel);
    if (!file.startsWith(ROOT) || !fs.existsSync(file)) return route.fulfill({ status: 404, body: 'not found' });
    route.fulfill({ status: 200, contentType: TYPES[path.extname(file)] || 'application/octet-stream', body: fs.readFileSync(file) });
  });
  await page.goto(`${ORIGIN}/index.html`);
  await page.waitForFunction(() => typeof window.init === 'function');
  const loaded = await page.evaluate(([tl, en, on]) => window.init(tl, en, on), [timeline, env, only]);
  return { page, loaded };
}

const cdpSessions = new WeakMap();

async function capture(page, t, file, W, H) {
  await page.evaluate(tt => window.renderFrame(tt), t);
  // CDP capture with optimizeForSpeed: same pixels as page.screenshot, a
  // faster PNG encoder (bigger files)
  let cdp = cdpSessions.get(page);
  if (!cdp) { cdp = await page.context().newCDPSession(page); cdpSessions.set(page, cdp); }
  const { data } = await cdp.send('Page.captureScreenshot', {
    format: 'png', clip: { x: 0, y: 0, width: W, height: H, scale: 1 }, optimizeForSpeed: true,
  });
  fs.writeFileSync(file, Buffer.from(data, 'base64'));
}

(async () => {
  const timeline = loadJSON('timeline.json');
  const env = loadJSON('audio_env.json', true);
  const only = arg('--only') ? arg('--only').split(',') : null;
  const browser = await chromium.launch({
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
           '--font-render-hinting=none', '--force-color-profile=srgb'],
  });
  const W = timeline.width, H = timeline.height;

  const stills = arg('--stills');
  if (stills) {
    const dir = path.join(BUILD, 'stills');
    fs.mkdirSync(dir, { recursive: true });
    const tag = arg('--out', '');
    const { page, loaded } = await openPage(browser, timeline, env, only);
    console.log('modules:', loaded.join(', '));
    for (const s of stills.split(',').map(Number)) {
      const file = path.join(dir, `${tag}t${s.toFixed(2).padStart(7, '0')}.png`);
      const t0 = Date.now();
      await capture(page, s, file, W, H);
      console.log(`${file}  (${Date.now() - t0} ms)`);
    }
    await browser.close();
    return;
  }

  const fps = timeline.fps;
  const total = Math.round(timeline.duration * fps);
  const from = +arg('--from', 0), to = +arg('--to', total);
  const workers = +arg('--workers', Math.max(1, Math.min(4, os.cpus().length)));
  const dir = path.join(BUILD, 'frames');
  fs.mkdirSync(dir, { recursive: true });

  let done = 0;
  const t0 = Date.now();
  await Promise.all(Array.from({ length: workers }, async (_, w) => {
    const { page } = await openPage(browser, timeline, env, only);
    for (let f = from + w; f < to; f += workers) {
      await capture(page, f / fps, path.join(dir, `${String(f).padStart(5, '0')}.png`), W, H);
      done++;
      if (done % 120 === 0) {
        const el = (Date.now() - t0) / 1000;
        console.log(`${done}/${to - from} frames  ${(done / el).toFixed(2)} fps  eta ${((to - from - done) / (done / el)).toFixed(0)}s`);
      }
    }
  }));
  await browser.close();
  console.log(`rendered ${to - from} frames in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
})();
