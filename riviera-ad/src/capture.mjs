// Frame-accurate capture: loads an HTML page that exposes
//   window.adReady   -> Promise resolved once every asset is loaded/decoded
//   window.renderFrame(t, info) -> draws the frame for time t (seconds); may return a Promise
// then screenshots every frame in headless Chromium and pipes the JPEGs into ffmpeg.
// Frames are split across N parallel browser pages; the chunks are concatenated losslessly.
//
// Usage: node src/capture.mjs --page src/ad.html --out build/video-9x16.mp4 \
//          [--w 1080 --h 1920 --fps 30 --duration 30 --workers 4 --from 0 --to 30 --query variant=9x16]
//        node src/capture.mjs --page src/ad.html --stills 1.0,5.5,12 --outdir build/stills
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'

const require = createRequire(import.meta.url)
let chromium
try { ({ chromium } = require('playwright')) } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')) }

const HERE = path.dirname(url.fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..') // riviera-ad/

function arg(name, def) {
  const i = process.argv.indexOf('--' + name)
  return i >= 0 ? process.argv[i + 1] : def
}
const W = +arg('w', 1080), H = +arg('h', 1920), FPS = +arg('fps', 30)
const PAGE = arg('page', 'src/ad.html')
const QUERY = arg('query', '')
const WORKERS = +arg('workers', 4)
const OUT = arg('out', 'build/video.mp4')
const STILLS = arg('stills', '')
const OUTDIR = arg('outdir', 'build/stills')
const FFMPEG = process.env.FFMPEG || findFfmpeg()

function findFfmpeg() {
  const candidates = ['/usr/local/lib/python3.11/dist-packages/imageio_ffmpeg/binaries/ffmpeg-linux-x86_64-v7.0.2', '/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg']
  for (const c of candidates) if (fs.existsSync(c)) return c
  return 'ffmpeg'
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff', '.wav': 'audio/wav' }
function serve() {
  return new Promise(res => {
    const srv = http.createServer((req, rsp) => {
      const p = decodeURIComponent(new URL(req.url, 'http://x').pathname)
      const f = path.join(ROOT, p)
      if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { rsp.writeHead(404); return rsp.end() }
      rsp.writeHead(200, { 'content-type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream', 'cache-control': 'max-age=3600' })
      fs.createReadStream(f).pipe(rsp)
    })
    srv.listen(0, '127.0.0.1', () => res(srv))
  })
}

async function openPage(browser, base) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 })
  const page = await ctx.newPage()
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') console.error('[page]', m.text()) })
  page.on('pageerror', e => console.error('[pageerror]', e.message))
  const q = QUERY ? '?' + QUERY : ''
  await page.goto(`${base}/${PAGE}${q}`, { waitUntil: 'load' })
  await page.waitForFunction(() => window.adReady !== undefined, null, { timeout: 60000 })
  await page.evaluate(() => window.adReady)
  const meta = await page.evaluate(() => (window.adMeta ? window.adMeta() : {}))
  return { page, ctx, meta }
}

async function drawFrame(page, t, i) {
  await page.evaluate(([t, i]) => Promise.resolve(window.renderFrame(t, { frame: i })), [t, i])
  return page.screenshot({ type: 'jpeg', quality: 95, animations: 'disabled', caret: 'hide' })
}

async function renderChunk(browser, base, from, to, file, idx) {
  const { page, ctx } = await openPage(browser, base)
  const ff = spawn(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '16', '-pix_fmt', 'yuv420p', '-r', String(FPS), file], { stdio: ['pipe', 'inherit', 'inherit'] })
  const done = new Promise((res, rej) => ff.on('close', c => (c === 0 ? res() : rej(new Error('ffmpeg exit ' + c)))))
  const t0 = Date.now()
  for (let i = from; i < to; i++) {
    const buf = await drawFrame(page, i / FPS, i)
    if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r))
    if ((i - from) % 60 === 0) console.log(`  worker ${idx}: frame ${i} (${from}-${to - 1}) ${((Date.now() - t0) / 1000).toFixed(1)}s`)
  }
  ff.stdin.end()
  await done
  await ctx.close()
}

async function main() {
  const srv = await serve()
  const base = `http://127.0.0.1:${srv.address().port}`
  const browser = await chromium.launch({ args: ['--disable-web-security', '--font-render-hinting=none', '--disable-lcd-text', '--force-color-profile=srgb', '--disable-gpu-vsync'] })
  try {
    if (STILLS) {
      fs.mkdirSync(OUTDIR, { recursive: true })
      const { page } = await openPage(browser, base)
      for (const s of STILLS.split(',')) {
        const t = +s
        await page.evaluate(([t]) => Promise.resolve(window.renderFrame(t, { frame: Math.round(t * 30) })), [t])
        const f = path.join(OUTDIR, `t${t.toFixed(2).padStart(6, '0')}.jpg`)
        fs.writeFileSync(f, await page.screenshot({ type: 'jpeg', quality: 90 }))
        console.log(f)
      }
      return
    }
    const probe = await openPage(browser, base)
    const duration = +arg('duration', probe.meta.duration || 30)
    await probe.ctx.close()
    const fromF = Math.round(+arg('from', 0) * FPS), toF = Math.round(+arg('to', duration) * FPS)
    const total = toF - fromF
    const n = Math.max(1, Math.min(WORKERS, Math.ceil(total / 30)))
    const chunkDir = path.join(path.dirname(OUT), 'chunks-' + path.basename(OUT, '.mp4'))
    fs.mkdirSync(chunkDir, { recursive: true })
    const per = Math.ceil(total / n)
    const jobs = []
    const t0 = Date.now()
    for (let k = 0; k < n; k++) {
      const a = fromF + k * per, b = Math.min(toF, a + per)
      if (a >= b) break
      jobs.push({ a, b, file: path.join(chunkDir, `part-${k}.mp4`), k })
    }
    console.log(`rendering ${total} frames (${W}x${H}@${FPS}) with ${jobs.length} workers`)
    await Promise.all(jobs.map(j => renderChunk(browser, base, j.a, j.b, j.file, j.k)))
    const list = path.join(chunkDir, 'list.txt')
    fs.writeFileSync(list, jobs.map(j => `file '${path.resolve(j.file)}'`).join('\n'))
    await new Promise((res, rej) => spawn(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', OUT], { stdio: 'inherit' })
      .on('close', c => (c === 0 ? res() : rej(new Error('concat failed')))))
    console.log(`wrote ${OUT} in ${((Date.now() - t0) / 1000).toFixed(1)}s`)
  } finally {
    await browser.close()
    srv.close()
  }
}
main().catch(e => { console.error(e); process.exit(1) })
