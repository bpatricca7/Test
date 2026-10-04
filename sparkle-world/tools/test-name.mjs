// The product name (`npm run test:name`, node:test, no network): the game is called Glimmer World
// (formerly Sparkle World). Nothing a child, a parent or the operator reads may still say the old
// name: the game's source and its build, the home page and the account pages (source and
// dist/site/), the server's pages, emails and direct notice, the Stripe setup and the parent and
// operator docs.
//
// What is deliberately KEPT (renaming it would lose saves or break old files and links), and so
// allowed here:
//   - `sparkle-world` written exactly like that (lowercase, a hyphen): the app folder and package,
//     the IndexedDB name and the localStorage prefixes (`sparkle-world:…`, `sparkle-world@p-…`),
//     the file formats inside saved files (`sparkle-world`, `sparkle-world-backup`,
//     `sparkle-world-player`, `sparkle-world-family`), the old URL /sparkle-world.html and
//     dist/sparkle-world.html, the HKDF salt, the advisory lock names, Railway names;
//   - `sparkleworld` in the nickname block list (src/net/names.js), next to `glimmerworld`;
//   - the few sentences that say the game was renamed (ALLOWED_LINES below).
// server/migrations/*.sql are never edited after release (their first-line comments keep the
// old name) and are not checked.
//
// The built files (dist/sparkle-world.html, dist/artifact.html, dist/site/) are checked when they
// are there: `npm run test:name` builds first.
//
// The paid plan's name, too: it is the Glimmer World Membership (formerly the Family Plan; the
// family's decision of 2026-10-03, because "Family Plan" sounded as if cheaper plans existed). No
// page, email, notice, Checkout sentence or Stripe default may say "Family Plan" any more. Kept:
// the identifiers (`family_plan` in Stripe metadata, `#family-plan`, `.family-plan`, variable
// names), which are never written with a space, and the lines in FAMILY_PLAN_LINES below that say
// on purpose what the old name was.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderMail, TEMPLATES } from '../server/mail-templates.mjs';
import { notice, noticeSummary, renewalSentence, FRIENDS_SWITCH_NOTICE } from '../server/notice.mjs';
import { PRODUCT_NAME, PORTAL_HEADLINE } from './stripe-setup.mjs';
import { loadConfig } from '../server/config.mjs';
import { scanText, scanCharacters, scanFiles, filesFor, brandWords, characterWords, extraWords, SCOPE, EXTRA_SCOPE } from './lib/name-scan.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Any spelling of the old name: Sparkle World, sparkle-world, SPARKLEWORLD, Sparkle&nbsp;World, … */
const OLD = /sparkle(?:\s|&nbsp;|\\u00a0|[_-])*world/gi;
/** Is this match an identifier that stays (see the top of this file)? */
function kept(match, after) {
  if (match === 'sparkle-world') return true; // anywhere, written exactly like that
  // the nickname block list, source or built: 'sparkleworld', 'glimmerworld'
  return match === 'sparkleworld' && /^["'],\s*["']glimmerworld["']/.test(after);
}
/** Lines that say, on purpose, that the game used to be called Sparkle World. */
const ALLOWED_LINES = [
  /\(formerly Sparkle World\)/,
  /rename from Sparkle World to Glimmer World/,
  /^\s*Sparkle World gets the new name \(same ids/, // docs/DEPLOY-RAILWAY.md, re-running stripe:setup
  /"Sparkle World Family Plan" or "Glimmer World Family Plan", gets today's name/, // tools/stripe-setup.mjs
];

/** The old name of the paid plan, in any case and spacing ("Family Plan", "family&nbsp;plan", "FAMILY\nPLAN"). */
const OLD_PLAN = /family(?:\s|&nbsp;|\\u00a0)+plan/gi;
/** Lines that say, on purpose, what the plan used to be called. */
const FAMILY_PLAN_LINES = [
  /"Sparkle World Family Plan" or "Glimmer World Family Plan", gets today's name/, // tools/stripe-setup.mjs
  /the paid plan's name, "Family Plan", became "Glimmer World Membership"/, // server/notice.mjs, version 2
  /made as the "Glimmer World Family Plan" \(before the membership rename/, // docs/DEPLOY-RAILWAY.md, re-running stripe:setup
];

/** Every use of the plan's old name in `text` that is not an allowed line. */
export function oldPlanNames(text, file = '') {
  const lines = text.split('\n');
  const bad = [];
  let at = 0;
  for (const m of text.matchAll(OLD_PLAN)) {
    const first = text.slice(0, m.index).split('\n').length - 1;
    const last = first + m[0].split('\n').length - 1;
    if ([first, last].some((i) => FAMILY_PLAN_LINES.some((re) => re.test(lines[i])))) continue;
    if (first < at) continue;
    at = first;
    bad.push(`${file}:${first + 1}: ${lines[first].trim().slice(0, 140)}`);
  }
  return bad;
}

/** What people read: [folder or file, extensions]. */
const SOURCES = [
  ['src', ['.js']],
  ['index.html', null],
  ['site', ['.html', '.js', '.css']],
  ['server', ['.mjs']],
  ['tools/stripe-setup.mjs', null],
  ['tools/stripe-fake', ['.mjs']], // the pretend Checkout and Portal pages a parent sees in development
  ['THIRD_PARTY_NOTICES.md', null],
  ['docs/DEPLOY-RAILWAY.md', null],
  ['docs/CONSENT-FORM.md', null],
  ['docs/DESIGN.md', null],
];
const BUILT = ['dist/sparkle-world.html', 'dist/artifact.html', 'dist/site'];

function files(rel, exts) {
  const abs = path.join(ROOT, rel);
  if (!existsSync(abs)) return [];
  if (!statSync(abs).isDirectory()) return [rel];
  const out = [];
  for (const name of readdirSync(abs).sort()) {
    const r = path.posix.join(rel, name);
    if (statSync(path.join(ROOT, r)).isDirectory()) {
      if (r === 'server/migrations' || r.startsWith('site/img') || r.startsWith('site/fonts') || r.startsWith('dist/site/img') || r.startsWith('dist/site/fonts')) continue;
      out.push(...files(r, exts));
    } else if (!exts || exts.includes(path.extname(name))) out.push(r);
  }
  return out;
}

/** Every use of the old name in `text` that is neither a kept identifier nor an allowed line. */
export function oldNames(text, file = '') {
  const bad = [];
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    for (const m of line.matchAll(OLD)) {
      if (kept(m[0], line.slice(m.index + m[0].length))) continue;
      if (ALLOWED_LINES.some((re) => re.test(line))) continue;
      bad.push(`${file}:${i + 1}: ${line.trim().slice(0, 140)}`);
    }
  });
  // the name wrapped across two lines of prose ("… Sparkle\nWorld …")
  for (const m of text.matchAll(/sparkle\s*\n[\s/*#>-]*world/gi)) {
    const n = text.slice(0, m.index).split('\n').length;
    if (!ALLOWED_LINES.some((re) => re.test(lines[n - 1]) || re.test(lines[n]))) bad.push(`${file}:${n}: ${lines[n - 1].trim().slice(0, 140)} / ${lines[n].trim().slice(0, 60)}`);
  }
  return bad;
}

describe('the product name is Glimmer World everywhere people read it', () => {
  test('the checker itself: catches the old name in its spellings, lets the kept identifiers through', () => {
    for (const s of ['Sparkle World', 'sparkle world', 'SPARKLE WORLD', 'Sparkle&nbsp;World', 'SparkleWorld', 'Sparkle_World', 'Sparkle-World', 'about Sparkle\n// World']) {
      assert.equal(oldNames(s, 'x.js').length, 1, s);
    }
    assert.deepEqual(oldNames("localStorage['sparkle-world:acct']; ({ format: 'sparkle-world-backup' }); '/sparkle-world.html'", 'x.js'), []);
    assert.deepEqual(oldNames("'host', 'sparkleworld', 'glimmerworld'", 'src/net/names.js'), []);
    assert.deepEqual(oldNames('"host","sparkleworld","glimmerworld"', 'dist/sparkle-world.html'), []);
    assert.equal(oldNames("'sparkleworld'", 'site/app.js').length, 1);
    assert.equal(oldNames("'Sparkle-World'", 'site/app.js').length, 1);
    assert.deepEqual(oldNames('Glimmer World (formerly Sparkle World)', 'docs/DESIGN.md'), []);
  });

  test('sources: the game, the site, the server, the Stripe setup and the parent and operator docs', () => {
    const all = SOURCES.flatMap(([rel, exts]) => files(rel, exts));
    assert.ok(all.length > 100, `found ${all.length} files`);
    const bad = all.flatMap((f) => oldNames(readFileSync(path.join(ROOT, f), 'utf8'), f));
    assert.deepEqual(bad, []);
  });

  test('the built game and home page (dist/), when built', (t) => {
    const all = BUILT.flatMap((rel) => files(rel, null)).filter((f) => /\.(html|js|css|txt|json)$/.test(f));
    if (!all.length) return t.skip('nothing built yet (npm run build)');
    const bad = all.flatMap((f) => oldNames(readFileSync(path.join(ROOT, f), 'utf8'), f));
    assert.deepEqual(bad, []);
    const game = readFileSync(path.join(ROOT, 'dist', 'sparkle-world.html'), 'utf8');
    assert.match(game, /<title>Glimmer World<\/title>/);
    assert.match(game, /\["Glimmer","World"\]|\['Glimmer', 'World'\]/, 'the title screen logo spells Glimmer World');
    if (existsSync(path.join(ROOT, 'dist', 'site', 'index.html'))) {
      const home = readFileSync(path.join(ROOT, 'dist', 'site', 'index.html'), 'utf8');
      assert.match(home, /<title>Glimmer World<\/title>/);
      assert.match(home, /aria-label="Glimmer World, home"/);
    }
  });

  test('every email, the direct notice and the default sender say Glimmer World', () => {
    const cfg = {
      mpConsent: 'verified', retainDays: 90, trialDays: 7, priceText: '$5.99 a month, plus sales tax where it applies', mailMode: 'resend',
      publicOrigin: 'https://www.playglimmerworld.com', operator: { name: 'The Operator', email: 'hello@playglimmerworld.com', address: 'PO Box 1', phone: '+1 555 0100' },
    };
    const data = { code: '123456', at: Date.UTC(2026, 9, 2), v: 1, lapsedAt: Date.UTC(2026, 9, 2), purgeAt: Date.UTC(2027, 0, 1), trialEnd: Date.UTC(2026, 9, 9), nickname: 'Lily' };
    const n = notice(cfg);
    for (const template of TEMPLATES) {
      for (const firstTime of [false, true]) {
        const m = renderMail(template, { data, cfg, firstTime, notice: n });
        assert.deepEqual(oldNames(`${m.subject}\n${m.text}\n${m.html || ''}`, `mail ${template}`), [], template);
      }
    }
    assert.match(renderMail('signin', { data, cfg, firstTime: true, notice: n }).subject, /^Your Glimmer World code: 123456$/);
    const all = [n.title, n.checkbox, ...n.sections.flatMap((s) => [s.title, s.text]), noticeSummary(cfg), FRIENDS_SWITCH_NOTICE].join('\n');
    assert.deepEqual(oldNames(all, 'notice'), []);
    assert.match(n.title, /what Glimmer World keeps/);
    assert.match(n.checkbox, /I agree that Glimmer World may keep/);
    const dev = { SW_ACCOUNTS: 'optional', DATABASE_URL: 'postgresql://sw@127.0.0.1:5432/sw', PUBLIC_ORIGIN: 'http://localhost:8080', SW_SECRET: Buffer.alloc(32, 7).toString('base64'), STRIPE_SECRET_KEY: 'sk_test_abc123', STRIPE_WEBHOOK_SECRET: 'whsec_abc123', STRIPE_PRICE_ID: 'price_abc123', MAIL_MODE: 'memory' };
    assert.equal(loadConfig(dev).mailFrom, 'Glimmer World <hello@localhost>');
  });
});

describe('the paid plan is the Glimmer World Membership everywhere people read it', () => {
  test('the checker itself: catches "Family Plan" in its spellings, lets the identifiers through', () => {
    for (const s of ['Family Plan', 'family plan', 'FAMILY PLAN', 'Family&nbsp;Plan', 'the Family\n  Plan', '<!-- ===== FAMILY PLAN ===== -->']) {
      assert.equal(oldPlanNames(s, 'x.html').length, 1, s);
    }
    assert.deepEqual(oldPlanNames('<section class="family-plan" id="family-plan">; metadata: { sw: \'family_plan\' }; familyPlan()', 'x.js'), []);
    assert.deepEqual(oldPlanNames('// "Sparkle World Family Plan" or "Glimmer World Family Plan", gets today\'s name).', 'tools/stripe-setup.mjs'), []);
  });

  test('sources: the game, the site, the server, the Stripe setup and the parent and operator docs', () => {
    const all = SOURCES.flatMap(([rel, exts]) => files(rel, exts));
    assert.ok(all.length > 100, `found ${all.length} files`);
    const bad = all.flatMap((f) => oldPlanNames(readFileSync(path.join(ROOT, f), 'utf8'), f));
    assert.deepEqual(bad, []);
  });

  test('the built game and pages (dist/), when built', (t) => {
    const all = BUILT.flatMap((rel) => files(rel, null)).filter((f) => /\.(html|js|css|txt|json)$/.test(f));
    if (!all.length) return t.skip('nothing built yet (npm run build)');
    assert.deepEqual(all.flatMap((f) => oldPlanNames(readFileSync(path.join(ROOT, f), 'utf8'), f)), []);
  });

  test('every email, the direct notice, the Checkout sentence and the Stripe defaults say Glimmer World Membership', () => {
    const cfg = {
      mpConsent: 'verified', retainDays: 90, trialDays: 7, priceText: '$5.99 a month, plus sales tax where it applies', mailMode: 'resend',
      publicOrigin: 'https://www.playglimmerworld.com', operator: { name: 'The Operator', email: 'hello@playglimmerworld.com', address: 'PO Box 1', phone: '+1 555 0100' },
    };
    const data = { code: '123456', at: Date.UTC(2026, 9, 2), v: 2, lapsedAt: Date.UTC(2026, 9, 2), purgeAfter: Date.UTC(2027, 0, 1), trialEnd: Date.UTC(2026, 9, 9), nickname: 'Lily', refund: true };
    const n = notice(cfg);
    for (const template of TEMPLATES) {
      for (const firstTime of [false, true]) {
        const m = renderMail(template, { data, cfg, firstTime, notice: n });
        assert.deepEqual(oldPlanNames(`${m.subject}\n${m.text}\n${m.html || ''}`, `mail ${template}`), [], template);
      }
    }
    assert.equal(renderMail('welcome', { data: { ...data, trialEnd: null }, cfg, notice: n }).subject, 'Welcome to your Glimmer World Membership');
    assert.match(renderMail('welcome', { data: { ...data, trialEnd: null }, cfg, notice: n }).text, /^Thank you! Your Glimmer World Membership is on\.\n\nThe membership: \$5\.99 a month, plus sales tax where it applies, for the whole family, with everything included\. It is the only plan there is: no tiers, no add-ons/);
    assert.equal(renderMail('annual_reminder', { data, cfg, notice: n }).subject, 'A yearly reminder about your Glimmer World Membership');
    const all = [n.title, n.checkbox, ...n.sections.flatMap((s) => [s.title, s.text]), noticeSummary(cfg), renewalSentence(cfg), renewalSentence(cfg, { trial: true })].join('\n');
    assert.deepEqual(oldPlanNames(all, 'notice'), []);
    assert.match(all, /don't start a Glimmer World Membership within 30 days/);
    assert.match(renewalSentence(cfg), /^I agree to the Terms\. My Glimmer World Membership renews every month at \$5\.99 plus tax until I cancel/);
    assert.deepEqual([PRODUCT_NAME, PORTAL_HEADLINE], ['Glimmer World Membership', 'Glimmer World Membership']);
  });
});

// Other companies' names (docs/teams/wave4-integration.md §6 step 0, C13): never in the game, the
// site, the built pages or the docs. The lists live encoded in the shared scanner
// tools/lib/name-scan.mjs; this file builds its examples from the decoded lists and never spells
// a name itself.
describe("no other company's names, anywhere people read", () => {
  test('the scanner itself: whole words in any case, data: URIs skipped, lists decoded', () => {
    const brands = brandWords();
    assert.ok(brands.length >= 5, 'the owner\'s forbidden names are all there');
    // a plain spelling of each entry (drop the optional bits of the fragment)
    const plain = brands.map((w) => w.replace(/\[ -\]\?/g, '').replace(/s\?$/, ''));
    for (const w of plain) {
      for (const s of [w, w.toUpperCase(), w[0].toUpperCase() + w.slice(1), `Think "${w} mode".`, `a ${w}'s toy`]) {
        assert.equal(scanText(s).length, 1, `caught (${plain.indexOf(w)}): ${s.length} chars`);
      }
      assert.deepEqual(scanText(`${w}x xx${w}`), [], 'whole words only');
      const b64 = Buffer.from(` ${w} `).toString('base64');
      assert.deepEqual(scanText(`<img src="data:image/png;base64,${b64}${w}=="> ok`), [], 'data: URIs are stripped first');
    }
    assert.deepEqual(scanText('Glimmer World: build, dress up, Puffums and Stretchums on the Squish Shelf.'), []);
    const hit = scanText(`one\ntwo ${plain[2]}\nthree`);
    assert.deepEqual([hit[0].line, hit[0].col], [2, 5]);
    // the character list: only for the wave-4 string tables
    const chars = characterWords();
    assert.ok(chars.length >= 20);
    for (const w of chars) assert.equal(scanCharacters(`Hi, ${w}!`).length, 1);
    assert.deepEqual(scanCharacters('Splashy came to say hi!'), []);
    assert.deepEqual(scanText(`Hi, ${chars[0]}!`), [], 'characters are not in the brand list');
    // the teams' extra words are scanned only with { extras: true }
    assert.deepEqual(scanText('Puffums', { extras: true }), [], 'the extra lists compile and leave our own names alone');
    for (const team of ['merfolk', 'squish', 'ocean']) assert.ok(Array.isArray(extraWords(team)));
  });

  test('the scope: src/**, site/**, the built pages and docs/** (text files only)', () => {
    const all = filesFor(SCOPE);
    assert.ok(all.some((f) => f.startsWith('src/')) && all.some((f) => f.startsWith('site/')) && all.some((f) => f.startsWith('docs/')), 'every folder is scanned');
    assert.ok(!all.some((f) => /\.(png|jpe?g|webp|woff2?|ttf|gif|ico)$/i.test(f)), 'no binary files');
    assert.ok(all.includes('docs/DESIGN.md') && all.includes('src/main.js'));
  });

  test('sources, docs and the built pages carry none of the owner\'s forbidden names', () => {
    assert.deepEqual(scanFiles(SCOPE).map((m) => `${m.file}:${m.line}: ${m.text}`), []);
  });

  test("the teams' extra words: not in the game or the site", () => {
    assert.deepEqual(scanFiles(EXTRA_SCOPE, { extras: true }).map((m) => `${m.file}:${m.line}: ${m.text}`), []);
  });
});
