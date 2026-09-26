// Build Sparkle World into self-contained HTML:
//   dist/sparkle-world.html  complete document (file://, static hosts)
//   dist/artifact.html       the same page as a fragment for claude.ai Artifact publishing
// Usage: node tools/build.mjs          one-off minified build
//        node tools/build.mjs --serve  dev server with rebuild + live reload on :8000

import * as esbuild from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TITLE = 'Sparkle World';
// media=print + onload keeps a slow/blocked font request from delaying the game script
const FONT_LINK = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fredoka:wght@400;500;600;700&display=swap" media="print" onload="this.media=\'all\'">';
// shown before the JS runs (and keeps the page from flashing white)
const BOOT_CSS = 'html,body{margin:0;height:100%;background:#BDE6FF;overflow:hidden}#app{position:fixed;inset:0;background:#BDE6FF}';

const common = {
  entryPoints: [path.join(root, 'src/main.js')],
  bundle: true,
  format: 'iife',
  target: 'es2020',
  charset: 'utf8',
  legalComments: 'none',
  logLevel: 'warning',
  loader: { '.css': 'css' },
};

/** Keep inline code from closing its own tag. */
function escapeInline(code, tag) {
  const re = new RegExp(`<\\/(${tag})`, 'gi');
  return code.replace(re, (_, t) => `<\\/${t}`);
}

async function bundle() {
  const result = await esbuild.build({ ...common, minify: true, write: false, outdir: path.join(root, 'dist', '.bundle') });
  let js = '';
  let css = '';
  for (const f of result.outputFiles) {
    if (f.path.endsWith('.js')) js += f.text;
    else if (f.path.endsWith('.css')) css += f.text;
  }
  if (js.includes('<!--')) console.warn('warning: bundle contains "<!--"; check inline script parsing');
  return { js: escapeInline(js, 'script'), css: escapeInline(css, 'style') };
}

function fullDocument({ js, css }) {
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no">',
    `<title>${TITLE}</title>`,
    FONT_LINK,
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
  const parts = await bundle();
  const dist = path.join(root, 'dist');
  await mkdir(dist, { recursive: true });
  const full = fullDocument(parts);
  const frag = artifactFragment(parts);
  await writeFile(path.join(dist, 'sparkle-world.html'), full);
  await writeFile(path.join(dist, 'artifact.html'), frag);
  console.log(`Built in ${Date.now() - t0} ms:`);
  console.log(sizeLine('dist/sparkle-world.html', full));
  console.log(sizeLine('dist/artifact.html', frag));
}

async function serve() {
  const ctx = await esbuild.context({ ...common, sourcemap: 'inline', outdir: path.join(root, 'dev'), write: false });
  await ctx.watch();
  const { port } = await ctx.serve({ servedir: root, port: 8000 });
  console.log(`Sparkle World dev server: http://localhost:${port}/  (rebuilds on save, live reload)`);
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
