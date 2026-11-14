#!/usr/bin/env node
/*
 * Frame-accurate renderer for code-driven Reels.
 *
 *   node lib/render.cjs <reel-dir> [--from 0] [--to <sec>] [--fps 30] [--workers 4]
 *                       [--stills 1.0,5.2,... [--label name]] [--no-encode] [--encode-only]
 *
 * The reel's index.html must expose:
 *   window.REEL = { duration, fps, width, height }
 *   window.seek(t)  -> Promise, puts every animation at time t (seconds)
 *
 * Nothing in the page may run on wall-clock time; every frame is a pure
 * function of t, so frames can be rendered in any order and in parallel.
 */
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = process.argv[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
}

(async () => {
  const reel = process.argv[2];
  if (!reel) throw new Error('usage: render.cjs <reel-dir>');
  const root = path.resolve(__dirname, '..', reel);
  const url = 'file://' + path.join(root, 'index.html');
  const framesDir = path.join(root, 'frames');
  const stills = arg('stills', null);
  const workers = Number(arg('workers', 4));

  const browser = await chromium.launch({
    args: ['--font-render-hinting=none', '--disable-lcd-text', '--force-color-profile=srgb'],
  });

  const open = async () => {
    const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
    page.on('pageerror', (e) => { console.error('[page error]', e.message); process.exitCode = 1; });
    page.on('console', (m) => { if (m.type() === 'error') console.error('[console]', m.text()); });
    await page.goto(url);
    await page.waitForFunction(() => window.REEL && window.REEL.ready === true, null, { timeout: 30000 });
    return page;
  };

  const first = await open();
  const meta = await first.evaluate(() => window.REEL);
  const fps = Number(arg('fps', meta.fps || 30));

  if (stills) {
    const dir = path.join(root, 'stills', String(arg('label', 'latest')));
    fs.mkdirSync(dir, { recursive: true });
    for (const s of String(stills).split(',')) {
      const t = Number(s);
      await first.evaluate((x) => window.seek(x), t);
      const file = path.join(dir, `t${t.toFixed(2).padStart(5, '0')}.jpg`);
      await first.screenshot({ path: file, type: 'jpeg', quality: 90 });
      console.log(file);
    }
    await browser.close();
    return;
  }

  const from = Number(arg('from', 0));
  const to = Number(arg('to', meta.duration));
  const f0 = Math.round(from * fps);
  const f1 = Math.round(to * fps);
  if (arg('encode-only', false)) {
    // reuse the frames already on disk (e.g. after changing only the audio mix)
    await browser.close();
  } else {
    fs.rmSync(framesDir, { recursive: true, force: true });
    fs.mkdirSync(framesDir, { recursive: true });

    const pages = [first];
    while (pages.length < workers) pages.push(await open());

    const started = Date.now();
    let done = 0;
    await Promise.all(pages.map(async (page, w) => {
      for (let f = f0 + w; f < f1; f += workers) {
        await page.evaluate((x) => window.seek(x), f / fps);
        await page.screenshot({
          path: path.join(framesDir, String(f - f0).padStart(5, '0') + '.jpg'),
          type: 'jpeg',
          quality: 95,
        });
        if (++done % 150 === 0) console.log(`${done}/${f1 - f0} frames`);
      }
    }));
    await browser.close();
    console.log(`rendered ${done} frames in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  }

  if (arg('no-encode', false)) return;
  const audio = path.join(root, 'audio', 'mix.wav');
  const out = path.join(root, arg('out', `${path.basename(root)}.mp4`));
  const args = ['-v', 'error', '-y', '-framerate', String(fps), '-i', path.join(framesDir, '%05d.jpg')];
  if (fs.existsSync(audio)) args.push('-ss', String(from), '-i', audio);
  args.push('-c:v', 'libx264', '-preset', 'slow', '-crf', String(arg('crf', 19)), '-pix_fmt', 'yuv420p',
    '-profile:v', 'high', '-level', '4.2', '-r', String(fps), '-movflags', '+faststart');
  if (fs.existsSync(audio)) args.push('-c:a', 'aac', '-b:a', '256k', '-ar', '48000', '-shortest');
  args.push(out);
  execFileSync('ffmpeg', args, { stdio: 'inherit' });
  console.log('wrote', out);
})().catch((e) => { console.error(e); process.exit(1); });
