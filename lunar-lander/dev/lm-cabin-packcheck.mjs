// Packing speed / fill check with cabin-like tile sizes (LM-CABIN helper): node dev/lm-cabin-packcheck.mjs
import { packShelves } from '../src/render/cockpit/lm/optimize.js';
const sizes = [[806,1378],[806,1378],[962,598],[962,598],[1456,429],[1456,429],[1092,702],[1092,702],[1508,858],[1508,858],[780,1196],[780,1196],[1364,924],[312,546],[702,611],[609,648],[800,392],[780,832]];
for (let i = 0; i < 80; i++) sizes.push([100 + (i * 37) % 400, 60 + (i * 53) % 300]);
const rects = sizes.map(([w, h]) => ({ w: w + 24, h: h + 24 }));
const t0 = performance.now();
const pages = packShelves(rects, 4096);
const area = rects.reduce((s, r) => s + r.w * r.h, 0);
console.log('ms', (performance.now() - t0).toFixed(1), 'pages', pages.map((p) => `${p.w}x${p.h}`), 'fill', (area / pages.reduce((s, p) => s + p.w * p.h, 0)).toFixed(2));
