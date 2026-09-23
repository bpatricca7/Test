// Renders ECHO's frames with headless Chromium.
//
//   node movie/visuals/render.js                 -> every frame, 4 workers, into build/frames/
//   node movie/visuals/render.js --stills 2,40   -> single PNGs into build/stills/ for review
//
// Needs Playwright (global install is fine: NODE_PATH=$(npm root -g)).

const fs = require('fs');
const path = require('path');
const os = require('os');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const BUILD = path.join(ROOT, 'build');
const PAGE = 'file://' + path.join(__dirname, 'index.html');

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

async function openPage(browser, timeline, env) {
  const page = await browser.newPage({ viewport: { width: timeline.width, height: timeline.height } });
  page.on('pageerror', e => { console.error('page error:', e); process.exit(1); });
  await page.goto(PAGE);
  await page.evaluate(([tl, en]) => window.init(tl, en), [timeline, env]);
  return page;
}

async function capture(page, t, file) {
  await page.evaluate(tt => window.renderFrame(tt), t);
  const canvas = await page.$('#c');
  await canvas.screenshot({ path: file, type: 'png' });
}

(async () => {
  const timeline = loadJSON('timeline.json');
  const env = loadJSON('audio_env.json', true);
  const browser = await chromium.launch({
    args: ['--disable-gpu', '--font-render-hinting=none', '--force-color-profile=srgb'],
  });

  const stills = arg('--stills');
  if (stills) {
    const dir = path.join(BUILD, 'stills');
    fs.mkdirSync(dir, { recursive: true });
    const page = await openPage(browser, timeline, env);
    for (const s of stills.split(',').map(Number)) {
      const file = path.join(dir, `t${s.toFixed(2).padStart(7, '0')}.png`);
      await capture(page, s, file);
      console.log(file);
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
    const page = await openPage(browser, timeline, env);
    for (let f = from + w; f < to; f += workers) {
      await capture(page, f / fps, path.join(dir, `${String(f).padStart(5, '0')}.png`));
      done++;
      if (done % 120 === 0) {
        const el = (Date.now() - t0) / 1000;
        console.log(`${done}/${to - from} frames  ${(done / el).toFixed(1)} fps  eta ${((to - from - done) / (done / el)).toFixed(0)}s`);
      }
    }
  }));
  await browser.close();
  console.log(`rendered ${to - from} frames in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
})();
