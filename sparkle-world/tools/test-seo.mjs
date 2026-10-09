// Crawl the server's actual responses in every account mode. In particular, an
// XML file copied by the builder must also be served with an XML content type.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildSite } from './site-build.mjs';
import { createServer } from '../server/server.mjs';
import { siteOrigin } from './seo.mjs';

const origin = 'https://www.playglimmerworld.com';
const env = {
  PUBLIC_ORIGIN: origin,
  RAILWAY_PUBLIC_DOMAIN: 'generated.up.railway.app',
  SW_OPERATOR_NAME: 'Example operator', SW_OPERATOR_EMAIL: 'support@example.test',
  SW_OPERATOR_ADDRESS: 'Example address', SW_OPERATOR_PHONE: 'Example phone',
  SW_REQUIRED_FROM: '2026-10-09',
};

test('a custom public origin takes precedence; invalid origins do not reach HTML', () => {
  assert.equal(siteOrigin(env), origin);
  assert.equal(siteOrigin({ RAILWAY_PUBLIC_DOMAIN: 'fallback.up.railway.app' }), 'https://fallback.up.railway.app');
  assert.equal(siteOrigin({ PUBLIC_ORIGIN: 'http://localhost:8000/' }), 'http://localhost:8000');
  for (const value of ['', 'bad domain"><script>', 'https://user:password@example.test',
    'https://example.test/path', 'https://example.test/?query', 'https://example.test/#fragment']) {
    assert.equal(siteOrigin({ PUBLIC_ORIGIN: value }), '', value);
  }
});

for (const mode of ['off', 'optional', 'required']) test(`public crawl in ${mode} mode`, async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'glimmer-seo-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const out = path.join(dir, 'site');
  await buildSite({ out, mode, env, quiet: true });
  const game = path.join(dir, 'game.html');
  await writeFile(game, '<!doctype html><title>Glimmer World</title><div id="app"></div>');
  const accounts = mode === 'off' ? null : {
    close: async () => {}, netInfo: () => ({ accounts: mode }), health: async () => ({ ok: true }),
  };
  const app = createServer({ siteDir: out, htmlPath: game, accounts, log: () => {} });
  t.after(() => app.close());
  const port = await app.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${port}`;
  const get = (pathname, options) => fetch(base + pathname, options);
  const sitemap = await get('/sitemap.xml');
  assert.equal(sitemap.status, 200);
  assert.match(sitemap.headers.get('content-type'), /^application\/xml/);
  const xml = await sitemap.text();
  const urls = [...xml.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1]);
  const paths = mode === 'off' ? ['/', '/parents'] : ['/', '/parents', '/privacy', '/terms'];
  assert.deepEqual(urls, paths.map((p) => origin + p));
  assert.doesNotMatch(xml, /generated|\/account|\/play|\.html/);

  const robots = await get('/robots.txt');
  assert.equal(robots.status, 200);
  const rules = await robots.text();
  assert.match(rules, /Sitemap: https:\/\/www\.playglimmerworld\.com\/sitemap\.xml/);
  assert.match(rules, /Disallow: \/api\//);
  assert.doesNotMatch(rules, /Disallow: \/(account|play|img|fonts)/);

  for (const pathname of paths) {
    const response = await get(pathname + '?utm_source=test');
    assert.equal(response.status, 200, pathname);
    assert.equal(response.headers.get('x-robots-tag'), null, pathname);
    const html = await response.text();
    assert.equal([...html.matchAll(/rel="canonical"/g)].length, 1);
    assert.ok(html.includes(`rel="canonical" href="${origin + pathname}"`), pathname);
    assert.doesNotMatch(html, /generated\.up\.railway\.app/);
    assert.doesNotMatch(html, /name="robots" content="noindex"/);
    assert.match(html, /<h1\b/);
    const alias = pathname === '/' ? '/index.html' : pathname + '.html';
    const redirect = await get(alias + '?utm_source=test', { redirect: 'manual' });
    assert.equal(redirect.status, 301, alias);
    assert.equal(redirect.headers.get('location'), pathname + '?utm_source=test');
    const head = await get(alias, { method: 'HEAD', redirect: 'manual' });
    assert.equal(head.status, 301);
    assert.equal(await head.text(), '');
  }
  const home = await (await get('/')).text();
  const data = JSON.parse(/<script type="application\/ld\+json">([^<]*)<\/script>/.exec(home)[1]);
  assert.equal(data['@context'], 'https://schema.org');
  assert.deepEqual(data['@graph'].map((node) => node['@type']), ['Organization', 'WebSite', 'VideoGame']);
  assert.equal(data['@graph'][2].url, origin + '/');
  assert.equal(data['@graph'][2].gamePlatform, 'Web browser');
  assert.doesNotMatch(home, /share-tags|seo-tags/);
  assert.ok((await readFile(path.join(out, 'parents.html'), 'utf8')).includes('Glimmer World for Parents'));

  for (const pathname of ['/play', '/play/', '/sparkle-world.html']) {
    const response = await get(pathname);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-robots-tag'), 'noindex');
    const cached = await get(pathname, { headers: { 'if-none-match': response.headers.get('etag') } });
    assert.equal(cached.status, 304);
    assert.equal(cached.headers.get('x-robots-tag'), 'noindex');
  }
  if (mode === 'off') {
    for (const pathname of ['/privacy', '/privacy.html', '/terms', '/terms.html', '/account'])
      assert.equal((await get(pathname, { redirect: 'manual' })).status, 404);
  } else {
    const response = await get('/account');
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-robots-tag'), 'noindex');
    assert.match(await response.text(), /name="robots" content="noindex"/);
  }
  assert.equal((await get('/not-a-page')).status, 404);
  assert.equal((await get('/preview.html')).status, 404);
});
