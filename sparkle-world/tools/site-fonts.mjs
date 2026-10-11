// Google Fonts for headless pictures: Playwright's Chromium does not go through this machine's
// HTTPS proxy, so the page would fall back to a system font. routeGoogleFonts(context) answers
// the fonts.googleapis.com / fonts.gstatic.com requests from a local cache instead, filled once
// with curl (which uses the proxy and verifies TLS). Without curl or a network the requests
// just fail as before (the pages then use their fallback fonts).

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(ROOT, '.shots', '.font-cache');
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

function cached(url) {
  mkdirSync(CACHE, { recursive: true });
  const file = path.join(CACHE, createHash('sha1').update(url).digest('hex').slice(0, 16));
  if (existsSync(file)) return readFileSync(file);
  const r = spawnSync('curl', ['-sSfL', '-m', '20', '-A', UA, url], { maxBuffer: 16 * 1024 * 1024 });
  if (r.status !== 0 || !r.stdout || !r.stdout.length) return null;
  writeFileSync(file, r.stdout);
  return r.stdout;
}

export async function routeGoogleFonts(context) {
  await context.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, async (route) => {
    const url = route.request().url();
    const body = cached(url);
    if (!body) return route.abort();
    const css = url.includes('googleapis.com');
    await route.fulfill({
      status: 200,
      body,
      headers: {
        'content-type': css ? 'text/css; charset=utf-8' : 'font/woff2',
        'access-control-allow-origin': '*',
        'cache-control': 'public, max-age=86400',
      },
    });
  });
}
