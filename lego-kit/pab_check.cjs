// Check every element of parts/pick_a_brick_upload.csv against LEGO Pick a Brick.
//
// For each element ID it records whether Pick a Brick lists it, the price, the
// range (Bestseller / Standard), stock, and the per-order limit when the site
// reports one. Results go to parts/pick_a_brick_live.csv.
//
// Needs network access to www.lego.com, Node, and Playwright with Chromium:
//   NODE_PATH=$(npm root -g) node lego-kit/pab_check.cjs <project folder> [en-us]
//
// It loads the Pick a Brick page in a real browser (for cookies), then calls the
// same GraphQL endpoint the page uses. That query was taken from the open-source
// LegoSharp client, so if LEGO has changed the API since, adjust QUERY below.
// Not yet run against the live site: the sandbox it was written in could not
// reach lego.com.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(process.argv[2] || '.');
const LOCALE = process.argv[3] || 'en-us';
const PAGE = `https://www.lego.com/${LOCALE}/pick-and-build/pick-a-brick`;

const VARIANT = (extra) => `
  id
  price { centAmount formattedAmount }
  attributes { designNumber colourId deliveryChannel ${extra} }`;
const QUERY = (extra) => `
query PickABrickQuery($query: String, $page: Int, $perPage: Int, $includeOutOfStock: Boolean) {
  elements(query: $query, page: $page, perPage: $perPage, includeOutOfStock: $includeOutOfStock) {
    total
    results {
      id
      name
      inStock
      ... on SingleVariantElement { variant { ${VARIANT(extra)} } }
      ... on MultiVariantElement { variants { ${VARIANT(extra)} } }
    }
  }
}`;

function readUpload() {
  const lines = fs.readFileSync(path.join(ROOT, 'parts', 'pick_a_brick_upload.csv'), 'utf8')
    .trim().split(/\r?\n/).slice(1);
  return lines.map((l) => { const [id, qty] = l.split(','); return { id, qty: Number(qty) }; });
}

async function lookup(page, id, extra) {
  return page.evaluate(async ({ id, q }) => {
    const r = await fetch('/api/graphql/PickABrickQuery', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ operationName: 'PickABrickQuery', query: q,
        variables: { query: id, page: 1, perPage: 20, includeOutOfStock: true } }),
    });
    return { status: r.status, body: await r.json().catch(() => null) };
  }, { id, q: QUERY(extra) });
}

(async () => {
  const items = readUpload();
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
  const page = await browser.newPage({ locale: 'en-US' });
  await page.goto(PAGE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  // try with the per-order limit field first; drop it if the schema rejects it
  let extra = 'maxOrderQuantity';
  const out = [['elementId', 'quantity', 'found', 'name', 'inStock', 'price', 'range',
                'maxOrderQuantity', 'enough', 'checkedAt']];
  for (const { id, qty } of items) {
    let res = await lookup(page, id, extra);
    if (extra && res.body && res.body.errors) { extra = ''; res = await lookup(page, id, extra); }
    const results = (res.body && res.body.data && res.body.data.elements.results) || [];
    let row = [id, qty, 'no', '', '', '', '', '', '', new Date().toISOString()];
    for (const el of results) {
      const variants = el.variants || (el.variant ? [el.variant] : []);
      const v = variants.find((x) => String(x.id) === String(id));
      if (!v) continue;
      const max = v.attributes.maxOrderQuantity;
      row = [id, qty, 'yes', el.name, el.inStock, v.price && v.price.formattedAmount,
             v.attributes.deliveryChannel, max ?? '',
             max ? (qty <= max ? 'yes' : `split into ${Math.ceil(qty / max)} orders`) : '',
             new Date().toISOString()];
      break;
    }
    out.push(row);
    process.stdout.write(`${row.slice(0, 8).join(' | ')}\n`);
    await page.waitForTimeout(400);   // be gentle with the site
  }
  await browser.close();
  const csv = out.map((r) => r.map((c) => /[",]/.test(String(c)) ? `"${String(c).replace(/"/g, '""')}"` : c).join(',')).join('\n');
  fs.writeFileSync(path.join(ROOT, 'parts', 'pick_a_brick_live.csv'), csv + '\n');
  const found = out.slice(1).filter((r) => r[2] === 'yes').length;
  console.log(`\n${found} of ${items.length} elements found on Pick a Brick -> parts/pick_a_brick_live.csv`);
})();
