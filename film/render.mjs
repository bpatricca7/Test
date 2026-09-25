// Frame renderer: drives the film page in headless Chromium and captures frames.
//   node render.mjs stills --times 1,2.5 [--w 1920] [--q "mood=sunset"]   -> out/stills/*.png
//   node render.mjs video --from 0 --to 30 [--w 1920] [--step 1] --out out/part.mp4
import http from 'http';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { chromium } from 'playwright';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const root = path.dirname(new URL(import.meta.url).pathname);
const args = process.argv.slice(2);
const mode = args[0];
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const W = +opt('w', 1920), H = Math.round((W * 9) / 16);
const query = opt('q', '');

const types = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html', '.json': 'application/json', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(req.url.split('?')[0]));
  fs.readFile(p, (err, data) => {
    if (err) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': types[path.extname(p)] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(0);
await new Promise((r) => server.on('listening', r));
const port = server.address().port;

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-gpu-vsync'] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
page.on('pageerror', (e) => console.error('PAGE ERROR', e.message));
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.error('console:', m.text().slice(0, 400)); });
await page.goto(`http://localhost:${port}/index.html?w=${W}&${query}`);
await page.waitForFunction('window.ready === true', null, { timeout: 180000 });
const info = await page.evaluate(() => window.filmInfo);
const FPS = info.FPS;

const cdp = await page.context().newCDPSession(page);
async function grab(frame) {
  await page.evaluate((f) => window.renderFrame(f), frame);
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', optimizeForSpeed: true, clip: { x: 0, y: 0, width: W, height: H, scale: 1 } });
  return Buffer.from(data, 'base64');
}

if (mode === 'info') {
  console.log(JSON.stringify(info, null, 1));
} else if (mode === 'layout') {
  fs.writeFileSync(path.join(root, 'out/layout.json'), JSON.stringify(await page.evaluate(() => window.layoutInfo())));
  console.log('wrote out/layout.json');
} else if (mode === 'stills') {
  const outDir = path.join(root, opt('dir', 'out/stills'));
  fs.mkdirSync(outDir, { recursive: true });
  for (const ts of opt('times', '0').split(',')) {
    const frame = Math.round(parseFloat(ts) * FPS);
    const t0 = Date.now();
    await page.evaluate((f) => window.renderFrame(f), frame); // warm-up (shader compiles, env maps)
    const png = await grab(frame);
    const file = path.join(outDir, `${opt('prefix', 'still')}_${ts.padStart(6, '0')}.png`);
    fs.writeFileSync(file, png);
    console.log(file, Date.now() - t0, 'ms');
  }
} else if (mode === 'video') {
  const from = Math.round(parseFloat(opt('from', 0)) * FPS);
  const to = Math.min(info.frames, Math.round(parseFloat(opt('to', info.DURATION)) * FPS));
  const step = +opt('step', 1);
  const out = path.join(root, opt('out', 'out/video.mp4'));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const ffmpeg = require('imageio-ffmpeg-path') ;
  const ff = spawn(ffmpeg, ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS / step), '-c:v', 'png', '-i', '-',
    '-c:v', 'libx264', '-preset', opt('preset', 'medium'), '-crf', opt('crf', '16'), '-pix_fmt', 'yuv420p', '-r', String(FPS / step), out], { stdio: ['pipe', 'inherit', 'inherit'] });
  const t0 = Date.now();
  for (let f = from; f < to; f += step) {
    const png = await grab(f);
    if (!ff.stdin.write(png)) await new Promise((r) => ff.stdin.once('drain', r));
    if ((f - from) % (48 * step) === 0) {
      const done = (f - from) / step + 1, total = Math.ceil((to - from) / step);
      const el = (Date.now() - t0) / 1000;
      console.log(`frame ${f} (${done}/${total}) ${(el / done).toFixed(2)}s/frame, eta ${((total - done) * el / done / 60).toFixed(1)} min`);
    }
  }
  ff.stdin.end();
  await new Promise((r) => ff.on('close', r));
  console.log('wrote', out, ((Date.now() - t0) / 1000).toFixed(0), 's');
}
await browser.close();
server.close();
