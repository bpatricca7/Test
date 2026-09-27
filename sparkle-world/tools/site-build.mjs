// Build the Sparkle World home page (site/) into dist/site/:
//   dist/site/**              a copy of site/ (index.html, parents.html, styles.css, app.js, img/)
//   dist/site/img/pics/*.svg  the 12 picture-code stickers, made from the game's own
//                             src/net/pictures.js (so the page always shows the real pictures)
//   dist/site/third-party-notices.txt  a copy of THIRD_PARTY_NOTICES.md
//   dist/site/preview.html    the same home page as a FRAGMENT for a claude.ai Artifact preview:
//                             <title>, the font link, <style>, the body content, <script>;
//                             images stay relative (img/...), links to /play stay as they are
//
// server/server.mjs serves dist/site/ at "/" and the game at "/play".
//
//   node tools/site-build.mjs      (tools/build.mjs runs it after the game build)

import { mkdir, readFile, writeFile, readdir, rm, copyFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(root, 'site');
const OUT = path.join(root, 'dist', 'site');
const IMAGE_BUDGET = 3 * 1024 * 1024;

async function walk(dir, base = dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(full, base)));
    else if (e.isFile()) out.push(path.relative(base, full));
  }
  return out.sort();
}

/** The home page as a fragment: no doctype/html/head/body; styles and script inlined. */
export function previewFragment(html, css, js) {
  const title = (/<title>[\s\S]*?<\/title>/i.exec(html) || ['<title>Sparkle World</title>'])[0];
  const fonts = [...html.matchAll(/<link[^>]+fonts\.(?:googleapis|gstatic)\.com[^>]*>/gi)].map((m) => m[0]);
  const body = (/<body[^>]*>([\s\S]*?)<\/body>/i.exec(html) || [null, html])[1]
    .replace(/<script\b[^>]*\bsrc=["'][^"']*["'][^>]*>\s*<\/script>/gi, '')
    .trim();
  const safeCss = css.replace(/<\/(style)/gi, '<\\/$1');
  const safeJs = js.replace(/<\/(script)/gi, '<\\/$1');
  return [
    title,
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    ...fonts.filter((l) => !/rel=["']preconnect/i.test(l)),
    `<style>${safeCss}</style>`,
    body,
    safeJs ? `<script>${safeJs}</script>` : '',
    '',
  ].join('\n');
}

export async function buildSite({ quiet = false } = {}) {
  const log = quiet ? () => {} : (...a) => console.log(...a);
  try {
    await stat(path.join(SRC, 'index.html'));
  } catch {
    log('  (no site/index.html: home page skipped)');
    return null;
  }
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  const files = await walk(SRC);
  let images = 0;
  for (const rel of files) {
    const to = path.join(OUT, rel);
    await mkdir(path.dirname(to), { recursive: true });
    await copyFile(path.join(SRC, rel), to);
    if (/\.(webp|jpe?g|png|avif|gif)$/i.test(rel)) images += (await stat(to)).size;
  }
  // the picture-code stickers, straight from the game
  const { CODE_PICTURES, pictureSvg } = await import(pathToFileURL(path.join(root, 'src', 'net', 'pictures.js')).href);
  await mkdir(path.join(OUT, 'img', 'pics'), { recursive: true });
  // a standalone SVG file is XML: a repeated attribute (fine inside HTML, where the first one
  // wins) would stop the whole picture from drawing, so keep only the first of each
  const firstAttrs = (svg) => svg.replace(/<([a-zA-Z]+)((?:\s+[\w:-]+="[^"]*")*)\s*(\/?)>/g, (m, tag, attrs, close) => {
    const seen = new Set();
    const kept = [...attrs.matchAll(/\s+([\w:-]+)="([^"]*)"/g)].filter(([, k]) => !seen.has(k) && seen.add(k)).map(([, k, v]) => ` ${k}="${v}"`).join('');
    return `<${tag}${kept}${close ? '/' : ''}>`;
  });
  for (const p of CODE_PICTURES) {
    const svg = firstAttrs(pictureSvg(p.word))
      .replace('<svg class="sw-pic "', '<svg xmlns="http://www.w3.org/2000/svg"')
      .replace(' aria-hidden="true" focusable="false"', ' width="128" height="128"');
    await writeFile(path.join(OUT, 'img', 'pics', `${p.word}.svg`), svg + '\n');
  }
  // the open-source notices, readable at /third-party-notices.txt
  try {
    await copyFile(path.join(root, 'THIRD_PARTY_NOTICES.md'), path.join(OUT, 'third-party-notices.txt'));
  } catch {}
  const html = await readFile(path.join(SRC, 'index.html'), 'utf8');
  const css = await readFile(path.join(SRC, 'styles.css'), 'utf8').catch(() => '');
  const js = await readFile(path.join(SRC, 'app.js'), 'utf8').catch(() => '');
  const frag = previewFragment(html, css, js);
  await writeFile(path.join(OUT, 'preview.html'), frag);
  const kb = (n) => (n / 1024).toFixed(1) + ' KB';
  log(`  dist/site/                ${files.length} files + ${CODE_PICTURES.length} code pictures; images ${kb(images)}`);
  log(`  dist/site/index.html      ${kb(Buffer.byteLength(html))}  (${kb(gzipSync(html).length)} gzip)`);
  log(`  dist/site/preview.html    ${kb(Buffer.byteLength(frag))}  (fragment for an Artifact preview)`);
  if (images > IMAGE_BUDGET) console.warn(`warning: home page images are ${kb(images)} (budget ${kb(IMAGE_BUDGET)})`);
  return { files: files.length, images };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  buildSite().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
}
