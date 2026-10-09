// Public search metadata belongs to the configured website, even when Railway's
// generated domain is also available. Account and game screens are not landing pages.
export const PUBLIC_PAGES = Object.freeze({
  'index.html': '/',
  'parents.html': '/parents',
  'playdate-guide.html': '/playdate-guide',
  'decorate-a-house.html': '/decorate-a-house',
  'privacy.html': '/privacy',
  'terms.html': '/terms',
});

export function siteOrigin(env = process.env) {
  const value = String(env.PUBLIC_ORIGIN || env.RAILWAY_PUBLIC_DOMAIN || '').trim();
  if (!value) return '';
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
        url.pathname !== '/' || url.search || url.hash) return '';
    return url.origin;
  } catch {
    return '';
  }
}

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[c]);
const plainText = (value) => value.replace(/&(amp|lt|gt|quot|#39);/g, (_, entity) => ({
  amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'",
})[entity]);

/** Keep metadata in the original HTML so crawlers do not need JavaScript. */
export function withSeoTags(html, file, origin) {
  const pathname = PUBLIC_PAGES[file];
  if (!pathname || !origin) return html;
  const url = origin + pathname;
  const title = plainText((/<title>([^<]*)<\/title>/i.exec(html) || [null, 'Glimmer World'])[1]);
  const description = plainText((/<meta name="description" content="([^"]*)">/i.exec(html) || [null, ''])[1]);
  const tags = [`<link rel="canonical" href="${escapeHtml(url)}">`];
  if (file !== 'index.html') tags.push(
    '<meta property="og:type" content="website">',
    '<meta property="og:site_name" content="Glimmer World">',
    `<meta property="og:title" content="${escapeHtml(title)}">`,
    `<meta property="og:description" content="${escapeHtml(description)}">`,
    `<meta property="og:url" content="${escapeHtml(url)}">`,
    `<meta property="og:image" content="${escapeHtml(origin)}/img/share.jpg">`,
    '<meta name="twitter:card" content="summary_large_image">',
  );
  if (file === 'index.html') {
    const data = {
      '@context': 'https://schema.org',
      '@graph': [
        { '@type': 'Organization', '@id': origin + '/#organization', name: 'Glimmer World',
          url, logo: origin + '/img/icon-180.png',
          sameAs: ['https://www.youtube.com/@playglimmerworld', 'https://www.instagram.com/playglimmerworld/'] },
        { '@type': 'WebSite', '@id': origin + '/#website', name: 'Glimmer World',
          url, inLanguage: 'en', publisher: { '@id': origin + '/#organization' } },
        { '@type': 'VideoGame', '@id': origin + '/#game', name: 'Glimmer World',
          url, description, image: origin + '/img/share.jpg',
          applicationCategory: 'GameApplication', gamePlatform: 'Web browser',
          genre: ['Sandbox', 'Building', 'Family'], inLanguage: 'en',
          playMode: ['https://schema.org/SinglePlayer', 'https://schema.org/MultiPlayer'],
          publisher: { '@id': origin + '/#organization' } },
      ],
    };
    // JSON-LD is data, not executable code. Escape '<' so text cannot close its tag.
    tags.push(`<script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`);
  }
  return html.replace('</head>', tags.join('\n') + '\n</head>');
}

/** Only pages that this build actually publishes belong in its sitemap. */
export function crawlerFiles(origin, accounts = 'off') {
  const robots = ['User-agent: *', 'Allow: /', 'Disallow: /api/', 'Disallow: /r/'];
  if (origin) robots.push('', `Sitemap: ${origin}/sitemap.xml`);
  const pages = Object.entries(PUBLIC_PAGES)
    .filter(([file]) => accounts !== 'off' || !['privacy.html', 'terms.html'].includes(file));
  const sitemap = origin ? [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...pages.map(([, pathname]) => `  <url><loc>${escapeHtml(origin + pathname)}</loc></url>`),
    '</urlset>', '',
  ].join('\n') : null;
  return { robots: robots.join('\n') + '\n', sitemap };
}
