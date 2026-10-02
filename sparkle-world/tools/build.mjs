// Build Glimmer World into self-contained HTML:
//   dist/sparkle-world.html  complete document (file://, static hosts, the site's /play), with
//                            the Fredoka font inside it (site/fonts/fredoka-latin.woff2 as a
//                            data: URL), so the game loads nothing from another site and no
//                            child's address reaches Google (docs/ACCOUNTS.md §7.10)
//   dist/artifact.html       the same page as a fragment for claude.ai Artifact publishing
//                            (keeps the Google Fonts link: claude.ai's own page)
//   dist/site/               the home page (site/, tools/site-build.mjs; served at "/", the game at "/play")
// Usage: node tools/build.mjs          one-off minified build
//        node tools/build.mjs --serve  dev server with rebuild + live reload on :8000

import * as esbuild from 'esbuild';
import { mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSite } from './site-build.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TITLE = 'Glimmer World';
// media=print + onload keeps a slow/blocked font request from delaying the game script
const FONT_LINK = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fredoka:wght@400;500;600;700&display=swap" media="print" onload="this.media=\'all\'">';
/** The font inside the page: the site's own Fredoka (latin, weights 400-700). */
async function fontFace() {
  const woff2 = await readFile(path.join(root, 'site', 'fonts', 'fredoka-latin.woff2'));
  return `@font-face{font-family:'Fredoka';font-style:normal;font-weight:400 700;font-display:swap;src:url(data:font/woff2;base64,${woff2.toString('base64')}) format('woff2')}`;
}
// shown before the JS runs (and keeps the page from flashing white)
const BOOT_CSS = 'html,body{margin:0;height:100%;background:#BDE6FF;overflow:hidden}#app{position:fixed;inset:0;background:#BDE6FF}';

/**
 * The build id (docs/MULTIPLAYER.md §9.14): sha1 of every src/** file's path and content plus
 * the three.js version, 8 hex. Friends can only play together on the same build (presence pv).
 */
async function buildId() {
  const h = createHash('sha1');
  const walk = async (dir) => {
    const entries = (await readdir(dir, { withFileTypes: true })).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) await walk(full);
      else if (e.isFile()) {
        h.update(path.relative(root, full).split(path.sep).join('/'));
        h.update('\0');
        h.update(await readFile(full));
        h.update('\0');
      }
    }
  };
  await walk(path.join(root, 'src'));
  try {
    const three = JSON.parse(await readFile(path.join(root, 'node_modules', 'three', 'package.json'), 'utf8'));
    h.update('three@' + three.version);
  } catch {
    h.update('three@?');
  }
  return h.digest('hex').slice(0, 8);
}

const common = {
  entryPoints: [path.join(root, 'src/main.js')],
  bundle: true,
  format: 'iife',
  target: 'es2020',
  charset: 'utf8',
  legalComments: 'eof', // keep third-party license notices (Three.js is MIT)
  logLevel: 'warning',
  loader: { '.css': 'css' },
};

/** Keep inline code from closing its own tag. */
function escapeInline(code, tag) {
  const re = new RegExp(`<\\/(${tag})`, 'gi');
  return code.replace(re, (_, t) => `<\\/${t}`);
}

async function bundle(build) {
  const define = { __SW_BUILD__: JSON.stringify(build) };
  const result = await esbuild.build({ ...common, define, minify: true, write: false, outdir: path.join(root, 'dist', '.bundle') });
  let js = '';
  let css = '';
  for (const f of result.outputFiles) {
    if (f.path.endsWith('.js')) js += f.text;
    else if (f.path.endsWith('.css')) css += f.text;
  }
  if (js.includes('<!--')) console.warn('warning: bundle contains "<!--"; check inline script parsing');
  return { js: escapeInline(js, 'script'), css: escapeInline(css, 'style') };
}

function fullDocument({ js, css, font }) {
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no">',
    `<title>${TITLE}</title>`,
    `<style>${font}</style>`,
    `<style>${BOOT_CSS}${css}</style>`,
    '</head>',
    '<body>',
    '<div id="app"></div>',
    `<script>${js}</script>`,
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

function artifactFragment({ js, css }) {
  return [
    `<title>${TITLE}</title>`,
    FONT_LINK,
    `<style>${BOOT_CSS}${css}</style>`,
    '<div id="app"></div>',
    `<script>${js}</script>`,
    '',
  ].join('\n');
}

function sizeLine(name, text) {
  const bytes = Buffer.byteLength(text);
  const gz = gzipSync(text).length;
  return `  ${name.padEnd(24)} ${(bytes / 1024).toFixed(1).padStart(8)} KB  (${(gz / 1024).toFixed(1)} KB gzip)`;
}

async function buildOnce() {
  const t0 = Date.now();
  const build = await buildId();
  const parts = await bundle(build);
  const dist = path.join(root, 'dist');
  await mkdir(dist, { recursive: true });
  const full = fullDocument({ ...parts, font: await fontFace() });
  const frag = artifactFragment(parts);
  await writeFile(path.join(dist, 'sparkle-world.html'), full);
  await writeFile(path.join(dist, 'artifact.html'), frag);
  // the Railway server reports this id at /api/net (server/server.mjs reads dist/build.json)
  await writeFile(path.join(dist, 'build.json'), JSON.stringify({ build }) + '\n');
  console.log(`Built ${build} in ${Date.now() - t0} ms:`);
  console.log(sizeLine('dist/sparkle-world.html', full));
  console.log(sizeLine('dist/artifact.html', frag));
  // the home page (site/ -> dist/site/)
  await buildSite();
}

async function serve() {
  // the dev bundle keeps one id per server start ('dev-' + the source hash)
  const define = { __SW_BUILD__: JSON.stringify('dev-' + (await buildId())) };
  const ctx = await esbuild.context({ ...common, define, sourcemap: 'inline', outdir: path.join(root, 'dev'), write: false });
  await ctx.watch();
  const { port } = await ctx.serve({ servedir: root, port: 8000 });
  console.log(`Glimmer World dev server: http://localhost:${port}/  (rebuilds on save, live reload)`);
}

if (process.argv.includes('--serve')) {
  serve().catch((err) => {
    console.error(err);
    process.exit(1);
  });
} else {
  buildOnce().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
}
