// Build the Sparkle World home page (site/) into dist/site/:
//   dist/site/**              a copy of site/ (index.html, parents.html, styles.css, app.js, img/)
//   dist/site/img/pics/*.svg  the 12 picture-code stickers, made from the game's own
//                             src/net/pictures.js (so the page always shows the real pictures)
//   dist/site/third-party-notices.txt  a copy of THIRD_PARTY_NOTICES.md
//   dist/site/preview.html    the same home page as a FRAGMENT for a claude.ai Artifact preview:
//                             <title>, <style>, the body content, <script>; images and the font
//                             stay relative (img/..., fonts/...), links to /play stay as they are
//
// Link previews: when RAILWAY_PUBLIC_DOMAIN is set (Railway sets it for a service with a public
// address, also while building), index.html gets og:url, og:image (img/share.jpg) and
// twitter:card with that address; without it those tags are left out (they need a full URL).
//
// Family accounts (docs/ACCOUNTS.md §9.5): the words on the pages must be true for the mode
// being deployed, so the build reads SW_ACCOUNTS (Railway passes the service's Variables to the
// build) and keeps only the lines written for that mode:
//   <!-- when accounts=off -->            (HTML; in CSS: /* when accounts=off */)
//   … lines for that mode …
//   <!-- when accounts=optional,required -->
//   … lines for those modes …
//   <!-- end when -->
// The marker lines themselves always go, so with SW_ACCOUNTS unset (off) the output is exactly
// the pages as they were before accounts. `<!-- when font=google|self -->` picks the sentence
// about the game's font from the built game itself (dist/sparkle-world.html links Google Fonts
// or not), and `<!-- when trial=yes|no -->` the words about a free trial (SW_TRIAL_DAYS > 0).
// Only with accounts on:
//   - the Family page (account.html, account/verify.html, account.js, account.css), /privacy and
//     /terms are built, and src/net/names.js is copied as names.js (the Family page's nickname
//     preview uses the game's own filter);
//   - {{SW_OPERATOR_NAME}}, {{SW_OPERATOR_EMAIL}}, {{SW_OPERATOR_ADDRESS}},
//     {{SW_OPERATOR_PHONE}}, {{SW_PRICE_TEXT}}, {{SW_TRIAL_DAYS}}, {{SW_RETAIN_DAYS}},
//     {{SW_REQUIRED_FROM}} are filled in from the build's environment (a warning names each
//     one that is missing; the operator's details are required by COPPA in production);
//   - dist/site/.site.json records the mode (the server warns when it runs in another one).
// With accounts off those files are left out entirely (the server would not serve them).
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

/** Files that exist only with accounts on (relative to site/, `/` separators). */
export const ACCOUNT_ONLY = ['account.html', 'account/verify.html', 'account.js', 'account.css', 'privacy.html', 'terms.html'];
const accountOnly = (rel) => ACCOUNT_ONLY.includes(rel) || rel.startsWith('account/');

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

const SHARE_MARK = /[ \t]*<!-- share-tags:[^>]*-->\n?/;

/** The tags that need the site's full address, or none without one. */
export function shareTags(domain) {
  const host = String(domain || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (!/^[a-z0-9.-]+(:\d+)?$/.test(host)) return '';
  const url = `https://${host}/`;
  return [
    `<meta property="og:url" content="${url}">`,
    `<meta property="og:image" content="${url}img/share.jpg">`,
    '<meta property="og:image:width" content="1200">',
    '<meta property="og:image:height" content="630">',
    '<meta property="og:image:alt" content="Sparkle World: Build a whole world. Then move in. The game\'s title screen and a little floating island made of blocks.">',
    '<meta name="twitter:card" content="summary_large_image">',
    '',
  ].join('\n');
}

/** index.html with the share tags filled in (or the marker removed). */
export function withShareTags(html, domain = process.env.RAILWAY_PUBLIC_DOMAIN) {
  return html.replace(SHARE_MARK, shareTags(domain));
}

/** SW_ACCOUNTS as the build sees it: 'off' | 'optional' | 'required' (anything else: off, warned). */
export function accountsMode(env = process.env) {
  const v = String(env.SW_ACCOUNTS ?? '').trim().toLowerCase();
  if (v === '' || v === 'off') return 'off';
  if (v === 'optional' || v === 'required') return v;
  console.warn(`warning: SW_ACCOUNTS=${env.SW_ACCOUNTS} is not off, optional or required: the home page is built for off (the server will refuse to start)`);
  return 'off';
}

const WHEN = /^[ \t]*(?:<!--|\/\*)[ \t]*when[ \t]+(accounts|font|trial)=([a-z,]+)[ \t]*(?:-->|\*\/)[ \t]*$/;
const END = /^[ \t]*(?:<!--|\/\*)[ \t]*end when[ \t]*(?:-->|\*\/)[ \t]*$/;

/**
 * Keep the lines written for this build: `when accounts=…` / `when font=…` blocks (see the top
 * of this file); the marker lines always go. Blocks do not nest.
 */
export function forMode(text, { accounts = 'off', font = 'google', trial = 'no' } = {}) {
  if (!/when (accounts|font|trial)=/.test(text)) return text;
  const want = { accounts, font, trial };
  const out = [];
  let keep = true;
  for (const line of text.split('\n')) {
    const m = WHEN.exec(line);
    if (m) {
      keep = m[2].split(',').includes(want[m[1]]);
      continue;
    }
    if (END.test(line)) {
      keep = true;
      continue;
    }
    if (keep) out.push(line);
  }
  return out.join('\n');
}

/** The {{…}} placeholders of the account-mode pages, from the build's environment. */
export function placeholders(env = process.env) {
  const v = (k, d = null) => (typeof env[k] === 'string' && env[k].trim() ? env[k].trim() : d);
  return {
    SW_OPERATOR_NAME: v('SW_OPERATOR_NAME'),
    SW_OPERATOR_EMAIL: v('SW_OPERATOR_EMAIL'),
    SW_OPERATOR_ADDRESS: v('SW_OPERATOR_ADDRESS'),
    SW_OPERATOR_PHONE: v('SW_OPERATOR_PHONE'),
    SW_PRICE_TEXT: v('SW_PRICE_TEXT', '$5.99 a month, plus sales tax where it applies'),
    SW_TRIAL_DAYS: v('SW_TRIAL_DAYS', '0'),
    SW_RETAIN_DAYS: v('SW_RETAIN_DAYS', '90'),
    SW_REQUIRED_FROM: v('SW_REQUIRED_FROM'),
  };
}

const escHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const MISSING = {
  SW_OPERATOR_NAME: '[operator name: set SW_OPERATOR_NAME]',
  SW_OPERATOR_EMAIL: '[operator email: set SW_OPERATOR_EMAIL]',
  SW_OPERATOR_ADDRESS: '[mailing address: set SW_OPERATOR_ADDRESS]',
  SW_OPERATOR_PHONE: '[phone: set SW_OPERATOR_PHONE]',
  SW_REQUIRED_FROM: 'a date we will announce here first',
};

/** Fill {{NAME}} placeholders (HTML-escaped); returns { text, missing: [names] }. */
export function fillPlaceholders(text, values) {
  const missing = new Set();
  const out = text.replace(/\{\{(SW_[A-Z_]+)\}\}/g, (m, k) => {
    if (!(k in values)) return m;
    const val = values[k];
    if (val === null || val === undefined) {
      missing.add(k);
      return escHtml(MISSING[k] || `[${k}]`);
    }
    if (k === 'SW_REQUIRED_FROM' && /^\d{4}-\d\d-\d\d$/.test(val)) {
      const d = new Date(val + 'T12:00:00Z');
      return escHtml(d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }));
    }
    return escHtml(val);
  });
  return { text: out, missing: [...missing] };
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

/**
 * @param {object} [o]
 * @param {boolean} [o.quiet]
 * @param {string} [o.out]    where to build (default dist/site; tests build other modes elsewhere)
 * @param {'off'|'optional'|'required'} [o.mode]  default: SW_ACCOUNTS from `env`
 * @param {object} [o.env]    the environment to read (default process.env)
 */
export async function buildSite({ quiet = false, out = OUT, mode = null, env = process.env } = {}) {
  const log = quiet ? () => {} : (...a) => console.log(...a);
  try {
    await stat(path.join(SRC, 'index.html'));
  } catch {
    log('  (no site/index.html: home page skipped)');
    return null;
  }
  const accounts = mode || accountsMode(env);
  const on = accounts !== 'off';
  // the game's font: Google Fonts, or its own (docs/ACCOUNTS.md §7.10)
  let font = 'google';
  try {
    font = /fonts\.googleapis\.com/.test(await readFile(path.join(root, 'dist', 'sparkle-world.html'), 'utf8')) ? 'google' : 'self';
  } catch {}
  const values = placeholders(env);
  const trial = Number(values.SW_TRIAL_DAYS) > 0 ? 'yes' : 'no';
  const missing = new Set();
  const textOf = (rel, text) => {
    let t = forMode(text, { accounts, font, trial });
    if (on && /\.(html|css|js)$/.test(rel)) {
      const f = fillPlaceholders(t, values);
      for (const k of f.missing) missing.add(k);
      t = f.text;
    }
    return t;
  };

  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  const files = (await walk(SRC)).filter((rel) => on || !accountOnly(rel.split(path.sep).join('/')));
  const pics = new Map();
  for (const rel of files) {
    const to = path.join(out, rel);
    await mkdir(path.dirname(to), { recursive: true });
    const from = path.join(SRC, rel);
    if (/\.(html|css|js)$/.test(rel)) {
      let t = textOf(rel, await readFile(from, 'utf8'));
      if (rel === 'index.html') t = withShareTags(t, env.RAILWAY_PUBLIC_DOMAIN);
      await writeFile(to, t);
    } else await copyFile(from, to);
    if (/\.(webp|jpe?g|png|avif|gif)$/i.test(rel)) pics.set(rel.split(path.sep).join('/'), (await stat(to)).size);
  }
  if (on) {
    // the game's own name filter, for the Family page's nickname preview (an ES module with no imports)
    await copyFile(path.join(root, 'src', 'net', 'names.js'), path.join(out, 'names.js'));
    await writeFile(path.join(out, '.site.json'), JSON.stringify({ accounts, font }) + '\n');
  }
  // what a visit downloads: a computer gets the big pictures, a phone the -800 copies where
  // there are some (srcset); the link preview and the home-screen icon are not part of a visit
  const extra = (rel) => /-800\.webp$/.test(rel) || /^img\/(share\.jpg|icon-180\.png)$/.test(rel);
  let images = 0, phone = 0;
  for (const [rel, n] of pics) {
    if (extra(rel)) continue;
    images += n;
    phone += pics.get(rel.replace(/\.webp$/, '-800.webp')) ?? n;
  }
  // the picture-code stickers, straight from the game
  const { CODE_PICTURES, pictureSvg } = await import(pathToFileURL(path.join(root, 'src', 'net', 'pictures.js')).href);
  await mkdir(path.join(out, 'img', 'pics'), { recursive: true });
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
    await writeFile(path.join(out, 'img', 'pics', `${p.word}.svg`), svg + '\n');
  }
  // the open-source notices, readable at /third-party-notices.txt
  try {
    await copyFile(path.join(root, 'THIRD_PARTY_NOTICES.md'), path.join(out, 'third-party-notices.txt'));
  } catch {}
  const html = textOf('index.html', await readFile(path.join(SRC, 'index.html'), 'utf8'));
  const css = textOf('styles.css', await readFile(path.join(SRC, 'styles.css'), 'utf8').catch(() => ''));
  const js = textOf('app.js', await readFile(path.join(SRC, 'app.js'), 'utf8').catch(() => ''));
  const frag = previewFragment(html, css, js);
  await writeFile(path.join(out, 'preview.html'), frag);
  const kb = (n) => (n / 1024).toFixed(1) + ' KB';
  const where = path.relative(root, out) || out;
  log(`  ${(where + '/').padEnd(25)} ${files.length} files + ${CODE_PICTURES.length} code pictures; images per visit ${kb(images)} (computer), ${kb(phone)} (phone)`);
  if (on) log(`  family accounts           ${accounts}: the Family page, /privacy and /terms are built`);
  // the legal pages' words are written for the defaults: a build with other settings says so
  // (the words must change in the same deploy, docs/ACCOUNTS.md §11.10, §18)
  const warnings = [];
  if (on && missing.size) warnings.push(`warning: the account pages need ${[...missing].sort().join(', ')} (set them in the build's environment, like Railway's Variables; placeholders were printed instead)`);
  if (on) {
    const legal = (f) => readFile(path.join(out, f), 'utf8').catch(() => '');
    const terms = await legal('terms.html');
    const privacy = await legal('privacy.html');
    if (trial === 'yes' && /There is no free trial/.test(terms)) warnings.push(`warning: SW_TRIAL_DAYS=${values.SW_TRIAL_DAYS}, but /terms says there is no free trial: change site/terms.html in the same deploy`);
    if (values.SW_RETAIN_DAYS !== '90' && /\b90 days\b/.test(privacy + terms)) warnings.push(`warning: SW_RETAIN_DAYS=${values.SW_RETAIN_DAYS}, but /privacy and /terms say 90 days: change them in the same deploy`);
    const grace = typeof env.SW_GRACE_DAYS === 'string' && env.SW_GRACE_DAYS.trim() ? env.SW_GRACE_DAYS.trim() : '7';
    if (grace !== '7' && /continues for 7 days/.test(terms)) warnings.push(`warning: SW_GRACE_DAYS=${grace}, but /terms says playing continues for 7 days: change it in the same deploy`);
  }
  for (const w of warnings) console.warn(w);
  if (/<!-- share-tags/.test(html)) log(`  link preview tags         ${shareTags(env.RAILWAY_PUBLIC_DOMAIN) ? 'for ' + env.RAILWAY_PUBLIC_DOMAIN : 'left out (RAILWAY_PUBLIC_DOMAIN is not set)'}`);
  log(`  ${(where + '/index.html').padEnd(25)} ${kb(Buffer.byteLength(html))}  (${kb(gzipSync(html).length)} gzip)`);
  log(`  ${(where + '/preview.html').padEnd(25)} ${kb(Buffer.byteLength(frag))}  (fragment for an Artifact preview)`);
  if (images > IMAGE_BUDGET) console.warn(`warning: home page images are ${kb(images)} (budget ${kb(IMAGE_BUDGET)})`);
  return { files: files.length, images, phone, accounts, missing: [...missing], warnings };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  buildSite().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
}
