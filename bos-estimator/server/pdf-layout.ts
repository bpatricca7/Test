// Layout-preserving PDF text extraction on top of pdf-parse 1.1.1 (pdf.js v1.10.100), pure JS.
//
//   const { text, pages, scannedPages } = await extractPdfLayout(buf)
//
// Pipeline per page
//   1. text items -> display space (viewport transform, so /Rotate pages come out upright); if most glyphs are
//      rotated (sideways landscape table on a portrait page) the whole page is rotated so that text is horizontal.
//   2. atoms: items glued across kerning splits (gap < 0.15 em), duplicate "fake bold" items dropped.
//   3. lines: atoms clustered by baseline; small raised/lowered atoms (footnote markers, superscripts) are attached
//      to the neighbouring line as [^n] instead of being glued into the number ("45,2001").
//   4. segments: atoms split where the x gap >= 0.45 em (a column gap, not a word space).
//   5. table regions: runs of multi-segment lines (plus short wrapped fragments between them).
//   6. columns: whitespace "rivers" (x ranges no body segment covers) give column boundaries; header cells that
//      straddle a river are spanning group headers and get prefixed to each sub-column ("Square Feet Gross").
//   7. rows: horizontal ruling lines from the operator list delimit rows when the table is ruled; otherwise lines are
//      grouped by vertical gap (2-class split) with at most one "full" line per row, so wrapped cells - top, middle
//      or bottom aligned - collapse into one logical row. Strike-through lines over text become ~~text~~.
//   8. emit: table rows as "cell | cell | cell" with empty cells kept so column indexes stay stable; prose as text;
//      "--- page N ---" markers; per-page stats (chars, images) for scanned-page detection.
//   9. across pages: wrapped-cell fragments at the top of a page are re-attached to the table row they belong to
//      (the previous page's last row for top-aligned tables split by a page break, the next row for bottom-aligned).
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// ---------- minimal pdf.js 1.10 surface ----------
interface PdfTextItem { str: string; transform: number[]; width: number }
interface PdfTextContent { items: PdfTextItem[] }
interface PdfViewport { transform: number[]; width: number; height: number }
interface PdfOperatorList { fnArray: number[]; argsArray: unknown[] }
export interface PdfPage {
  pageNumber?: number;
  view: number[];
  getViewport(scale: number): PdfViewport;
  getTextContent(opts?: { normalizeWhitespace?: boolean; disableCombineTextItems?: boolean }): Promise<PdfTextContent>;
  getOperatorList(): Promise<PdfOperatorList>;
}
interface PdfJsSettings { disableFontFace?: boolean; isEvalSupported?: boolean; disableWorker?: boolean }
interface PdfJsModule { PDFJS?: PdfJsSettings; OPS: Record<string, number> }
export interface PdfParseResult { numpages: number; numrender: number; info: unknown; metadata: unknown; text: string; version: string }
type PdfParse = (data: Uint8Array, options?: { max?: number; pagerender?: (page: PdfPage) => Promise<string> }) => Promise<PdfParseResult>;

// The same CommonJS module instance pdf-parse itself requires (shared require cache), so the settings below apply to it.
const PDFJS = require('pdf-parse/lib/pdf.js/v1.10.100/build/pdf.js') as PdfJsModule;
const pdfParseRaw = require('pdf-parse/lib/pdf-parse.js') as PdfParse;
/** pdf.js reads the whole underlying ArrayBuffer: a Buffer that is a view into a larger one (Node's small-buffer pool,
 *  a zip entry) parses as garbage ("bad XRef entry"), so hand it an exact copy. */
const exactBytes = (buf: Uint8Array): Uint8Array => (buf.byteOffset === 0 && buf.byteLength === buf.buffer.byteLength ? buf : new Uint8Array(buf));
/** pdf-parse's default entry (plain text, used as the fallback). Importing it from here guarantees the hardening below ran first. */
export const pdfParse: PdfParse = (data, options) => pdfParseRaw(exactBytes(data), options);

function harden(s: PdfJsSettings | undefined): void {
  if (!s) return;
  s.isEvalSupported = false; // untrusted uploads: never compile font programs with new Function (CVE-2024-4367 class)
  s.disableFontFace = true; // getOperatorList() would otherwise call document.createElement('style') and crash Node
  s.disableWorker = true;
}
harden(PDFJS.PDFJS);
harden((globalThis as { PDFJS?: PdfJsSettings }).PDFJS);
const OPS = PDFJS.OPS;

// ---------- geometry ----------
type Mat = [number, number, number, number, number, number];
const IDENT: Mat = [1, 0, 0, 1, 0, 0];
const asMat = (a: unknown): Mat => {
  const m = Array.isArray(a) || ArrayBuffer.isView(a) ? Array.from(a as ArrayLike<number>) : [];
  return m.length >= 6 ? [m[0], m[1], m[2], m[3], m[4], m[5]] : IDENT;
};
const mul = (m1: Mat, m2: Mat): Mat => [m1[0] * m2[0] + m1[2] * m2[1], m1[1] * m2[0] + m1[3] * m2[1], m1[0] * m2[2] + m1[2] * m2[3], m1[1] * m2[2] + m1[3] * m2[3], m1[0] * m2[4] + m1[2] * m2[5] + m1[4], m1[1] * m2[4] + m1[3] * m2[5] + m1[5]];
const apply = (m: Mat, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
const median = (a: number[]): number => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const NUMERIC = /^[($]?\s*-?\d[\d,]*(\.\d+)?\s*(%|sf|gsf|csf|sq\.?\s*ft\.?|sm|m2|m²|sy|ac|acres?|ea|each|lf|ft)?\)?(\s*\[\^\w+\])?$/i;

interface HRule { dir: 'h'; x0: number; x1: number; y: number }
interface VRule { dir: 'v'; y0: number; y1: number; x: number }
type Rule = HRule | VRule;
const isH = (r: Rule): r is HRule => r.dir === 'h';
const isV = (r: Rule): r is VRule => r.dir === 'v';
interface Box { x0: number; x1: number; y0: number; y1: number; kind: 'rect' | 'line' }
interface Graphics { rules: Rule[]; images: number; imageArea: number }

/** Collect thin filled/stroked rectangles and lines (table rules, strike-throughs) and image paints, in display space. */
async function graphics(page: PdfPage, vt: Mat): Promise<Graphics> {
  const ol = await page.getOperatorList();
  const rules: Rule[] = []; let images = 0, imageArea = 0;
  let ctm: Mat = IDENT; let lw = 1; let pending: Box[] = [];
  const stack: [Mat, number][] = [];
  const imageOps = new Set([OPS.paintImageXObject, OPS.paintJpegXObject, OPS.paintInlineImageXObject, OPS.paintImageMaskXObject]);
  for (let i = 0; i < ol.fnArray.length; i++) {
    const fn = ol.fnArray[i]; const args = (ol.argsArray[i] ?? []) as unknown[];
    if (fn === OPS.save) stack.push([ctm, lw]);
    else if (fn === OPS.restore) { const s = stack.pop(); if (s) [ctm, lw] = s; }
    else if (fn === OPS.transform) ctm = mul(ctm, asMat(args));
    else if (fn === OPS.setLineWidth) lw = Number(args[0]) || 0;
    else if (fn === OPS.paintFormXObjectBegin) { stack.push([ctm, lw]); if (args[0]) ctm = mul(ctm, asMat(args[0])); }
    else if (fn === OPS.paintFormXObjectEnd) { const s = stack.pop(); if (s) [ctm, lw] = s; }
    else if (imageOps.has(fn)) { images++; imageArea += Math.abs(ctm[0] * ctm[3] - ctm[1] * ctm[2]); }
    else if (fn === OPS.constructPath) {
      const ops = Array.from((args[0] ?? []) as ArrayLike<number>); const coords = Array.from((args[1] ?? []) as ArrayLike<number>);
      let k = 0; let cur: [number, number] | null = null;
      const m = mul(vt, ctm);
      for (const op of ops) {
        if (op === OPS.rectangle) {
          const [x, y, w, h] = coords.slice(k, k + 4); k += 4;
          const p1 = apply(m, x, y), p2 = apply(m, x + w, y + h);
          pending.push({ x0: Math.min(p1[0], p2[0]), x1: Math.max(p1[0], p2[0]), y0: Math.min(p1[1], p2[1]), y1: Math.max(p1[1], p2[1]), kind: 'rect' });
        } else if (op === OPS.moveTo) { cur = apply(m, coords[k], coords[k + 1]); k += 2; }
        else if (op === OPS.lineTo) {
          const p = apply(m, coords[k], coords[k + 1]); k += 2;
          if (cur) pending.push({ x0: Math.min(cur[0], p[0]), x1: Math.max(cur[0], p[0]), y0: Math.min(cur[1], p[1]), y1: Math.max(cur[1], p[1]), kind: 'line' });
          cur = p;
        } else if (op === OPS.curveTo) k += 6;
        else if (op === OPS.curveTo2 || op === OPS.curveTo3) k += 4;
      }
    } else if (fn >= OPS.stroke && fn <= OPS.closeEOFillStroke) {
      const stroke = fn === OPS.stroke || fn === OPS.closeStroke || fn >= OPS.fillStroke;
      const scale = Math.hypot(ctm[0], ctm[1]) || 1;
      for (const p of pending) {
        const pad = stroke ? (lw * scale) / 2 : 0;
        const r = { x0: p.x0 - pad, x1: p.x1 + pad, y0: p.y0 - pad, y1: p.y1 + pad };
        const w = r.x1 - r.x0, h = r.y1 - r.y0;
        if (h <= 2.5 && w >= 4) rules.push({ dir: 'h', x0: r.x0, x1: r.x1, y: (r.y0 + r.y1) / 2 });
        else if (w <= 2.5 && h >= 4) rules.push({ dir: 'v', y0: r.y0, y1: r.y1, x: (r.x0 + r.x1) / 2 });
        else if (p.kind === 'rect' && stroke) { // stroked cell rectangle: four edges
          rules.push({ dir: 'h', x0: r.x0, x1: r.x1, y: r.y0 }, { dir: 'h', x0: r.x0, x1: r.x1, y: r.y1 }, { dir: 'v', y0: r.y0, y1: r.y1, x: r.x0 }, { dir: 'v', y0: r.y0, y1: r.y1, x: r.x1 });
        }
      }
      pending = [];
    } else if (fn === OPS.endPath) pending = [];
  }
  return { rules: mergeRules(rules), images, imageArea };
}

/** Chromium / Word draw a table border as one short rectangle per cell: join collinear pieces into full rules. */
function mergeRules(rules: Rule[]): Rule[] {
  const out: Rule[] = [];
  for (const dir of ['h', 'v'] as const) {
    const rs = rules.filter((r) => r.dir === dir).map((r) => (isH(r) ? { p: r.y, a: r.x0, b: r.x1 } : { p: (r as VRule).x, a: (r as VRule).y0, b: (r as VRule).y1 })).sort((x, y) => x.p - y.p);
    const groups: { p: number; items: { p: number; a: number; b: number }[] }[] = [];
    for (const r of rs) { const g = groups[groups.length - 1]; if (g && Math.abs(r.p - g.p) <= 0.8) g.items.push(r); else groups.push({ p: r.p, items: [r] }); }
    for (const g of groups) {
      let cur: { p: number; a: number; b: number } | null = null;
      for (const r of g.items.sort((x, y) => x.a - y.a)) {
        if (cur && r.a <= cur.b + 2) cur.b = Math.max(cur.b, r.b);
        else { if (cur) out.push(dir === 'h' ? { dir, x0: cur.a, x1: cur.b, y: cur.p } : { dir, y0: cur.a, y1: cur.b, x: cur.p }); cur = { p: g.p, a: r.a, b: r.b }; }
      }
      if (cur) out.push(dir === 'h' ? { dir, x0: cur.a, x1: cur.b, y: cur.p } : { dir, y0: cur.a, y1: cur.b, x: cur.p });
    }
  }
  return out;
}

// ---------- text items -> lines -> segments ----------
interface RawItem { str: string; x: number; y: number; w: number; fs: number; ang: number }
interface Item extends RawItem { rot: boolean; sup?: boolean }
interface Atom { str: string; x: number; w: number; fs: number; rot: boolean }
interface Seg { text: string; x0: number; x1: number; rot: boolean; atoms: Atom[] }
interface Line { y: number; fs: number; items: Item[]; segs: Seg[]; x0: number; x1: number; dead?: boolean; title?: boolean; pageHeader?: boolean }

function pageItems(tc: PdfTextContent, vt: Mat): RawItem[] {
  const items: RawItem[] = [];
  for (const it of tc.items) {
    if (!it.str || !it.str.trim()) continue;
    const t = mul(vt, asMat(it.transform));
    const fs = Math.hypot(t[2], t[3]) || Math.hypot(t[0], t[1]) || 10;
    const ang = Math.round((Math.atan2(t[1], t[0]) * 180) / Math.PI);
    items.push({ str: it.str, x: t[4], y: t[5], w: Number(it.width) || 0, fs, ang });
  }
  return items;
}

/** Rotate so the dominant text direction is horizontal; return items with x (left), y (baseline, y grows down), w, fs. */
function normalise(items: RawItem[]): { rotated: number; items: Item[] } {
  const weight = new Map<number, number>();
  for (const it of items) { const a = (((Math.round(it.ang / 90) * 90) % 360) + 360) % 360; weight.set(a, (weight.get(a) ?? 0) + it.str.length); }
  const dom = [...weight.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
  const rad = (-dom * Math.PI) / 180, c = Math.cos(rad), s = Math.sin(rad);
  return {
    rotated: dom,
    items: items.map((it): Item => {
      const x = it.x * c - it.y * s, y = it.x * s + it.y * c; // rotate the anchor
      const rel = ((((it.ang - dom) % 360) + 540) % 360) - 180; // remaining angle after page rotation
      if (Math.abs(rel) < 10) return { ...it, x, y, rot: false };
      // still rotated (e.g. vertical column header): use its axis-aligned bbox, anchor at bottom-left
      const r2 = (rel * Math.PI) / 180, dx = Math.cos(r2) * it.w, dy = Math.sin(r2) * it.w;
      return { ...it, x: Math.min(x, x + dx) - it.fs * 0.2, y: Math.max(y, y + dy), w: Math.max(Math.abs(dx), it.fs * 0.8), rot: true };
    }),
  };
}

/** Footnote marker as "[^n]" (Army exhibits print them as "1/"). */
const footnote = (m: string) => `[^${m.trim().replace(/\/$/, '')}]`;

function buildLines(items: Item[]): Line[] {
  // dedupe fake-bold overprints
  const seen = new Set<string>(); let uniq: Item[] = [];
  for (const it of items) { const k = `${it.str}@${Math.round(it.x)}:${Math.round(it.y)}`; if (seen.has(k)) continue; seen.add(k); uniq.push(it); }
  // footnote markers / superscripts: a short, smaller item raised above the baseline of the item it follows
  const bodyFs = median(uniq.map((x) => x.fs));
  for (const s of uniq) {
    if (s.rot || s.fs > 0.85 * bodyFs || !/^\s*[\w*†‡§,()]{1,3}\/?\s*$/.test(s.str)) continue;
    const host = uniq.filter((h) => h !== s && !h.sup && !h.rot && h.fs >= s.fs / 0.85 && h.y - s.y > 0.12 * h.fs && h.y - s.y < 0.7 * h.fs && s.x - (h.x + h.w) > -1.5 && s.x - (h.x + h.w) < 0.4 * h.fs)
      .sort((a, b) => Math.abs(s.x - (a.x + a.w)) - Math.abs(s.x - (b.x + b.w)))[0];
    if (host) { host.str = host.str.replace(/\s+$/, '') + footnote(s.str); host.w = Math.max(host.w, s.x + s.w - host.x); s.sup = true; }
  }
  uniq = uniq.filter((x) => !x.sup);
  uniq.sort((a, b) => a.y - b.y || a.x - b.x);
  const lines: Line[] = [];
  for (const it of uniq) {
    let best: Line | null = null, bestD = Infinity;
    for (let i = lines.length - 1; i >= Math.max(0, lines.length - 6); i--) {
      const L = lines[i]; const d = Math.abs(L.y - it.y);
      if (d <= 0.3 * Math.max(Math.min(L.fs, it.fs), 2) && d < bestD) { best = L; bestD = d; }
    }
    if (best) { best.items.push(it); best.fs = Math.max(best.fs, it.fs); }
    else lines.push({ y: it.y, fs: it.fs, items: [it], segs: [], x0: 0, x1: 0 });
  }
  // attach small raised/lowered lines (footnote markers) to the line they decorate
  for (const L of lines) {
    const fsL = median(L.items.map((x) => x.fs));
    if (!L.items.every((x) => /^[\s*†‡§¹²³⁴-⁹\dA-Za-z,()/]{1,4}$/.test(x.str))) continue;
    const host = lines.find((H) => H !== L && !H.dead && median(H.items.map((x) => x.fs)) >= fsL / 0.85 && Math.abs(H.y - L.y) <= 0.7 * H.fs &&
      L.items.every((s) => H.items.some((h) => s.x - (h.x + h.w) > -1 && s.x - (h.x + h.w) < 0.4 * H.fs)));
    if (host) { for (const s of L.items) host.items.push({ ...s, y: host.y, sup: true }); L.dead = true; }
  }
  const out = lines.filter((l) => !l.dead);
  for (const L of out) {
    L.items.sort((a, b) => a.x - b.x);
    // atoms: glue kerning splits and superscripts
    const atoms: Atom[] = [];
    for (const it of L.items) {
      const a = atoms[atoms.length - 1];
      const gap = a ? it.x - (a.x + a.w) : Infinity;
      if (a && it.sup && gap < 0.4 * L.fs) { a.str += footnote(it.str); a.w = it.x + it.w - a.x; continue; }
      if (a && gap < 0.15 * L.fs && !it.rot && !a.rot) { a.str += (gap > 0.1 * L.fs && !/\s$/.test(a.str) && !/^\s/.test(it.str) ? ' ' : '') + it.str; a.w = Math.max(a.w, it.x + it.w - a.x); continue; }
      atoms.push({ str: it.str, x: it.x, w: it.w, fs: it.fs, rot: it.rot });
    }
    // segments: split at column-sized gaps
    const segs: Seg[] = [];
    for (const a of atoms) {
      const s = segs[segs.length - 1];
      const gap = s ? a.x - s.x1 : Infinity;
      if (s && gap < 0.45 * L.fs && !a.rot && !s.rot) { s.text += (/\s$/.test(s.text) || /^\s/.test(a.str) ? '' : ' ') + a.str; s.x1 = Math.max(s.x1, a.x + a.w); s.atoms.push(a); continue; }
      segs.push({ text: a.str, x0: a.x, x1: a.x + a.w, rot: a.rot, atoms: [a] });
    }
    for (const s of segs) s.text = s.text.replace(/\s+/g, ' ').trim();
    L.segs = segs.filter((s) => s.text);
    L.x0 = Math.min(...L.segs.map((s) => s.x0)); L.x1 = Math.max(...L.segs.map((s) => s.x1));
  }
  return out.filter((l) => l.segs.length);
}

function markStrike(lines: Line[], rules: Rule[]): void {
  const hs = rules.filter(isH);
  for (const L of lines) for (const s of L.segs) {
    const hit = hs.some((r) => r.y < L.y - 0.12 * L.fs && r.y > L.y - 0.5 * L.fs && Math.min(r.x1, s.x1) - Math.max(r.x0, s.x0) > 0.7 * (s.x1 - s.x0));
    if (hit) s.text = `~~${s.text}~~`;
  }
}

// ---------- table regions ----------
type Col = [number, number];
interface Region { prose: boolean; lines: Line[]; x0: number; x1: number; cols?: Col[]; bounds?: number[]; used?: boolean }
const proseRegion = (L: Line): Region => ({ prose: true, lines: [L], x0: L.x0, x1: L.x1 });

/** Group lines into table regions. */
function regions(lines: Line[], pageW: number): Region[] {
  const out: Region[] = []; let cur: Region | null = null;
  // an isolated single-segment line (big gap above AND below) is a title / caption: it closes the current table
  // (wrapped cell fragments always sit within ~1.3 em of another line of their row)
  lines.forEach((L, i) => { const up = i ? L.y - lines[i - 1].y : Infinity, dn = i + 1 < lines.length ? lines[i + 1].y - L.y : Infinity; L.title = L.segs.length === 1 && up > 1.6 * L.fs && dn > 1.6 * L.fs; });
  const isProse = (L: Line) => L.title || (L.segs.length === 1 && L.x1 - L.x0 > 0.55 * pageW && !L.segs[0].rot);
  // the topmost line of the page, set apart from what follows, is a running header: it never starts a table
  if (lines.length > 1 && lines[1].y - lines[0].y > 1.8 * lines[0].fs) lines[0].pageHeader = true;
  for (const L of lines) {
    const multi = L.segs.length >= 2;
    const gapOk = cur != null && L.y - cur.lines[cur.lines.length - 1].y <= 3.2 * L.fs;
    if (L.pageHeader) { out.push(proseRegion(L)); continue; }
    if (multi && (!cur || !gapOk)) { if (cur) out.push(cur); cur = { prose: false, lines: [L], x0: L.x0, x1: L.x1 }; continue; }
    const bodyFs = cur ? median(cur.lines.map((l) => l.fs)) : 0;
    if (cur && gapOk && (multi || (!isProse(L) && Math.abs(L.fs - bodyFs) <= 0.12 * bodyFs && L.x0 >= cur.x0 - L.fs && L.x1 <= cur.x1 + L.fs))) cur.lines.push(L);
    else { if (cur) out.push(cur); cur = null; out.push(proseRegion(L)); continue; }
    cur.x0 = Math.min(...cur.lines.map((l) => l.x0)); cur.x1 = Math.max(...cur.lines.map((l) => l.x1));
  }
  if (cur) out.push(cur);
  // leading short lines just above a table (first line of a wrapped / multi-row header) belong to it
  for (let i = 1; i < out.length; i++) {
    const r = out[i]; if (r.prose) continue;
    while (i > 0 && out[i - 1].prose) {
      const L = out[i - 1].lines[0], first = r.lines[0];
      if (first.y - L.y > 1.6 * first.fs || L.x1 - L.x0 > 0.4 * (r.x1 - r.x0) || L.x0 < r.x0 - first.fs || L.x1 > r.x1 + first.fs || Math.abs(L.fs - first.fs) > 0.12 * first.fs) break;
      r.lines.unshift(L); out.splice(i - 1, 1); i--;
    }
  }
  // trailing single-segment lines far below the last row are headings/captions, not wrapped cell text
  for (let i = 0; i < out.length; i++) {
    const r = out[i]; if (r.prose) continue;
    const tail: Line[] = [];
    while (r.lines.length > 2 && r.lines[r.lines.length - 1].segs.length === 1 && r.lines[r.lines.length - 1].y - r.lines[r.lines.length - 2].y > 1.5 * r.lines[r.lines.length - 1].fs) tail.unshift(r.lines.pop()!);
    if (tail.length) out.splice(i + 1, 0, ...tail.map(proseRegion));
  }
  // a "table" with fewer than 2 multi-segment lines is just text
  return out.flatMap((r) => (r.prose || r.lines.filter((l) => l.segs.length >= 2).length >= 2 ? [r] : r.lines.map(proseRegion)));
}

/** Coverage sweep: x ranges covered by at most `tol` lines are rivers between columns. */
function sweep(basis: Line[], tol: number): Col[] {
  const ev: [number, number][] = [];
  for (const l of basis) {
    const iv: [number, number][] = [];
    for (const sg of l.segs.map((x): [number, number] => [x.x0, x.x1]).sort((a, b) => a[0] - b[0])) { const c = iv[iv.length - 1]; if (c && sg[0] <= c[1]) c[1] = Math.max(c[1], sg[1]); else iv.push([sg[0], sg[1]]); }
    for (const [a, b] of iv) ev.push([a, 1], [b, -1]);
  }
  ev.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  const cols: Col[] = []; let depth = 0, start = 0;
  for (const [x, d] of ev) {
    const was = depth > tol; depth += d; const now = depth > tol;
    if (!was && now) { const c = cols[cols.length - 1]; if (c && x - c[1] < 0.8) { start = c[0]; cols.pop(); } else start = x; }
    else if (was && !now) cols.push([start, x]);
  }
  return cols;
}

function columnsFor(region: Region, prevCols: Col[] | undefined): Col[] {
  const multi = region.lines.filter((l) => l.segs.length >= 2);
  const body = multi.filter((l) => l.segs.some((s) => /\d/.test(s.text)));
  const basis = body.length >= 3 ? body : multi;
  // coverage sweep: x ranges covered by at most `tol` lines are rivers (a few spanning cells - subtotal labels,
  // colspan notes - must not erase a column boundary that every other row respects)
  const tol = basis.length >= 8 ? Math.floor(0.1 * basis.length) : 0;
  const cols = sweep(basis, tol);
  if (basis.length >= 4) {
    // a river crossed by only a line or two (a "CLOSED – NO WORKLOAD" note across the meal columns, a zone banner or
    // TOTAL label across item, number and name) still separates two columns that the other rows fill on both sides
    const loose = sweep(basis, tol + (basis.length >= 8 ? 2 : 1));
    const need = Math.max(2, Math.ceil(0.25 * basis.length));
    for (let i = 0; i + 1 < loose.length; i++) {
      const g0 = loose[i][1], g1 = loose[i + 1][0];
      const k = cols.findIndex(([a, b]) => a < g0 && b > g1);
      if (k < 0) continue;
      const [a, b] = cols[k];
      const left = basis.filter((l) => l.segs.some((s) => s.x1 <= g0 + 0.5 && s.x1 > a)).length;
      const right = basis.filter((l) => l.segs.some((s) => s.x0 >= g1 - 0.5 && s.x0 < b)).length;
      if (left >= need && right >= need) cols.splice(k, 1, [a, g0], [g1, b]);
    }
  }
  // continuation of a table from the previous page: reuse its columns if this region fits inside them
  if (prevCols && cols.length < prevCols.length) {
    const fits = basis.every((l) => l.segs.every((s) => prevCols.some(([a, b]) => s.x0 >= a - 3 && s.x1 <= b + 3)));
    if (fits) return prevCols;
  }
  return cols;
}

const colOf = (cols: Col[], s: { x0: number; x1: number }): number => { let best = 0, bestOv = -Infinity; cols.forEach(([a, b], i) => { const ov = Math.min(b, s.x1) - Math.max(a, s.x0); if (ov > bestOv) { bestOv = ov; best = i; } }); return best; };
const colsSpanned = (cols: Col[], s: Seg): number[] => cols.map(([a, b], i) => (Math.min(b, s.x1) - Math.max(a, s.x0) > 0.3 * Math.min(b - a, s.x1 - s.x0) ? i : -1)).filter((i) => i >= 0);
const fullLine = (cols: Col[], L: Line): boolean => new Set(L.segs.map((s) => colOf(cols, s))).size >= Math.max(2, Math.ceil(0.6 * cols.length));

/** Vertical alignment of wrapped cells: where the one "full" line of a multi-line row sits. */
type Align = 'top' | 'bottom' | 'unknown';

/** `hint` is the alignment of the table this one continues (previous region / page), when known. */
function rowsFor(region: Region, cols: Col[], rules: Rule[], hint: Align = 'unknown'): Line[][] {
  const lines = region.lines;
  const width = region.x1 - region.x0;
  const hr = rules.filter(isH).filter((r) => r.x1 - r.x0 >= 0.8 * width && r.x0 <= region.x0 + 0.1 * width && r.x1 >= region.x1 - 0.1 * width).map((r) => r.y).sort((a, b) => a - b);
  // distinct rule positions inside the region's vertical extent
  const top = lines[0].y - lines[0].fs * 1.2, bottom = lines[lines.length - 1].y + lines[lines.length - 1].fs * 0.6;
  const ys: number[] = []; for (const y of hr) if (y > top - 3 && y < bottom + 3 && (!ys.length || y - ys[ys.length - 1] > 1.5)) ys.push(y);
  if (ys.length >= 3) {
    // ruled table: bands between consecutive rules
    const groups: { band: number; lines: Line[] }[] = [];
    for (const L of lines) {
      const mid = L.y - 0.35 * L.fs; let band = ys.findIndex((y) => y > mid); if (band < 0) band = ys.length;
      const g = groups[groups.length - 1];
      if (g && g.band === band) g.lines.push(L); else groups.push({ band, lines: [L] });
    }
    return groups.map((g) => g.lines);
  }
  // unruled: split on large vertical gaps, at most one full line per row
  const gaps: number[] = []; for (let i = 1; i < lines.length; i++) gaps.push(lines[i].y - lines[i - 1].y);
  let thr = Infinity;
  if (gaps.length >= 2) {
    const s = [...gaps].sort((a, b) => a - b); let bestV = 0;
    for (let i = 1; i < s.length; i++) { const lo = s.slice(0, i), hi = s.slice(i); const mlo = lo.reduce((a, b) => a + b, 0) / lo.length, mhi = hi.reduce((a, b) => a + b, 0) / hi.length; const v = lo.length * hi.length * (mhi - mlo) ** 2; if (v > bestV && mhi > mlo * 1.3) { bestV = v; thr = (s[i - 1] + s[i]) / 2; } }
  }
  const groups: { lines: Line[]; full: boolean }[] = [];
  let g: { lines: Line[]; full: boolean } | null = null;
  for (const L of lines) {
    const full = fullLine(cols, L);
    const close = g != null && L.y - g.lines[g.lines.length - 1].y < thr;
    // uniform spacing (no gap classes): a partial line with nothing in the first column continues the row above
    const continuation = g != null && !Number.isFinite(thr) && !full && L.y - g.lines[g.lines.length - 1].y <= 1.45 * L.fs && !L.segs.some((s) => colOf(cols, s) === 0) && !L.segs.some((s) => NUMERIC.test(s.text));
    if (g && (close || continuation) && !(full && g.full)) { g.lines.push(L); g.full = g.full || full; }
    else { g = { lines: [L], full }; groups.push(g); }
  }
  // top-aligned table continued from the previous page: partial lines above the first full data line are the tail
  // of the row the page break split, not the start of this row - keep them apart so they can be re-attached
  const first = groups[0];
  if (hint === 'top' && first && first.lines.length > 1) {
    const k = first.lines.findIndex((L) => fullLine(cols, L));
    if (k > 0 && first.lines[k].segs.some((s) => /\d{2,}/.test(s.text) && NUMERIC.test(s.text))) groups.splice(0, 1, { lines: first.lines.slice(0, k), full: false }, { lines: first.lines.slice(k), full: true });
  }
  return groups.map((x) => x.lines);
}
function alignmentOf(rows: Line[][], cols: Col[]): Align {
  let top = 0, bottom = 0;
  for (const r of rows) {
    if (r.length < 2) continue;
    const idx = r.map((L) => fullLine(cols, L));
    if (idx.filter(Boolean).length !== 1) continue;
    if (idx[0]) top++; else if (idx[idx.length - 1]) bottom++;
  }
  if (top + bottom < 2) return 'unknown';
  return top >= 2 * bottom ? 'top' : bottom >= 2 * top ? 'bottom' : 'unknown';
}

/** Column span of a header segment. Ruled tables: the cell is bounded by the nearest vertical rules that cross
 *  its baseline (a colspan group label has no divider between its sub-columns at its own height). Unruled: overlap. */
function headerSpan(cols: Col[], s: Seg, y: number, rules: Rule[]): number[] {
  const v = rules.filter(isV).filter((r) => r.y0 <= y - 2 && r.y1 >= y - 2);
  const left = Math.max(-Infinity, ...v.filter((r) => r.x <= s.x0 + 1).map((r) => r.x));
  const right = Math.min(Infinity, ...v.filter((r) => r.x >= s.x1 - 1).map((r) => r.x));
  const ext = Number.isFinite(left) && Number.isFinite(right) ? { x0: left, x1: right } : s;
  const span = cols.map(([a, b], i) => ((a >= ext.x0 - 1 && b <= ext.x1 + 1) || Math.min(b, ext.x1) - Math.max(a, ext.x0) > 0.5 * Math.min(b - a, ext.x1 - ext.x0) ? i : -1)).filter((i) => i >= 0);
  return span.length ? span : [colOf(cols, s)];
}

/** x positions separating consecutive columns: a vertical rule inside the river when the table is ruled, else the river midpoint. */
function boundaries(cols: Col[], rules: Rule[], region: Region): number[] {
  const y0 = region.lines[0].y, y1 = region.lines[region.lines.length - 1].y;
  const vs = rules.filter(isV);
  return cols.slice(1).map(([a], i) => {
    const prevEnd = cols[i][1];
    const v = vs.filter((r) => r.x >= prevEnd - 1 && r.x <= a + 1 && r.y0 <= y1 && r.y1 >= y0).sort((p, q) => (q.y1 - q.y0) - (p.y1 - p.y0))[0];
    return v ? v.x : (prevEnd + a) / 2;
  });
}
const colAt = (bounds: number[], x: number): number => { let i = 0; while (i < bounds.length && x > bounds[i]) i++; return i; };

/** Split segments that straddle a column boundary at their atom (text run) edges: header cells are often closer
 *  together than the 0.45 em segment gap because the header text is what sets the column widths. */
function splitSegs(segs: Seg[], bounds: number[]): Seg[] {
  const out: Seg[] = [];
  for (const s of segs) {
    const cs = colAt(bounds, s.x0 + 1), ce = colAt(bounds, s.x1 - 1);
    if (cs === ce || s.atoms.length < 2) { out.push(s); continue; }
    let cur: (Seg & { col: number }) | null = null;
    for (const a of s.atoms) {
      const c = colAt(bounds, a.x + a.w / 2);
      if (cur && cur.col === c) { cur.text = `${cur.text} ${a.str}`.replace(/\s+/g, ' ').trim(); cur.x1 = a.x + a.w; cur.atoms.push(a); }
      else { cur = { col: c, text: a.str.trim(), x0: a.x, x1: a.x + a.w, rot: a.rot, atoms: [a] }; out.push(cur); }
    }
  }
  return out.filter((x) => x.text);
}
function splitAtBounds(L: Line, bounds: number[]): void { L.segs = splitSegs(L.segs, bounds); }

/** Joins the text pieces of one cell; a word wrapped after a hyphen is re-joined ("3105-" + "B19" -> "3105-B19"). */
const joinCell = (parts: string[]): string => parts.join(' ').replace(/(\w-) (?=\w)/g, '$1');

type X0s = (number | undefined)[];
/** cells as text, plus the left edge of each cell's text (to match wrapped fragments to the cell they continue). */
interface TableRow { cells: string[]; data: boolean; x0s?: X0s; /** a leading key/value row ("GSA Building Number | VA0123ZZ") */ kv?: boolean }
interface TableOut { titles?: string[]; header?: string[]; headerX0s?: X0s; rows: TableRow[] }
/** More leading non-numeric row groups than a header ever has: a key/value block, not a header to flatten. */
const MAX_HEADER_ROWS = 3;
const minX0 = (x0s: X0s, c: number, x: number) => { x0s[c] = x0s[c] == null ? x : Math.min(x0s[c]!, x); };

function emitTable(region: Region, cols: Col[], rows: Line[][], rules: Rule[]): TableOut {
  const out: TableOut = { rows: [] };
  let headerDone = false;
  const headerRows: { cells: string[][]; spans: { cols: number[]; text: string }[]; lines: Line[] }[] = [];
  for (const rowLines of rows) {
    const cells: string[][] = cols.map(() => []);
    const x0s: X0s = cols.map(() => undefined);
    const spans: { cols: number[]; text: string; x0: number }[] = [];
    const numeric = rowLines.some((L) => L.segs.some((s) => /\d{2,}/.test(s.text) && NUMERIC.test(s.text)));
    const body = headerDone || numeric;
    for (const L of rowLines) for (const s of L.segs) {
      const sp = colsSpanned(cols, s);
      // a spanning body cell (subtotal labels…) goes to its first column, in reading order with the rest of the cell
      if (sp.length > 1 && !body) spans.push({ cols: sp, text: s.text, x0: s.x0 });
      else { const c = sp.length ? sp[0] : colOf(cols, s); cells[c].push(s.text); minX0(x0s, c, s.x0); }
    }
    if (!headerDone && !numeric) { headerRows.push({ cells, spans, lines: rowLines }); continue; }
    if (!headerDone) {
      headerDone = true;
      if (headerRows.length > MAX_HEADER_ROWS) {
        for (const hr of headerRows) {
          const c = hr.cells.map((x) => [...x]);
          for (const sp of hr.spans) c[sp.cols[0]].push(sp.text);
          out.rows.push({ cells: c.map(joinCell), data: false, kv: true });
        }
      } else if (headerRows.length) {
        // flatten (possibly multi-row) header: spanning group labels are prefixed onto each sub-column; a label that
        // spans every column is the table's title and stays on its own line
        const h: string[][] = cols.map(() => []);
        const hx: X0s = cols.map(() => undefined);
        const titles: string[] = [];
        const segs = headerRows.flatMap((hr) => hr.lines.flatMap((L) => L.segs.map((s) => ({ s, y: L.y })))).sort((a, b) => a.y - b.y || a.s.x0 - b.s.x0);
        for (const { s, y } of segs) {
          const span = headerSpan(cols, s, y, rules);
          if (cols.length >= 3 && span.length === cols.length) { titles.push(s.text); continue; }
          for (const c of span) { h[c].push(s.text); minX0(hx, c, s.x0); }
        }
        if (titles.length) out.titles = titles;
        if (h.some((t) => t.length)) { out.header = h.map((t) => t.join(' ')); out.headerX0s = hx; }
      }
    }
    out.rows.push({ cells: cells.map(joinCell), data: true, x0s });
  }
  if (!headerDone && headerRows.length) for (const hr of headerRows) out.rows.push({ cells: [...hr.cells.map((c) => c.join(' ')), ...hr.spans.map((s) => s.text)], data: false });
  return out;
}

const rowText = (cells: string[]): string => cells.join(' | ').replace(/\s+$/, '');

// ---------- page assembly ----------
type Entry =
  | { kind: 'blank' }
  | { kind: 'text'; text: string; line: Line }
  | { kind: 'table'; table: TableOut; region: Region; align: Align };

interface RenderedPage { entries: Entry[]; images: number; imageCover: number; rotated: number; prevCols?: Col[]; lastAlign: Align }

/** Cell texts of a stray single-line fragment that fits inside a table's columns, or null when it is not one
 *  (touches the first column, holds a number, spans more than two columns, or does not fit the table). */
function fragmentCells(L: Line, region: Region, allowIsolated = false): { cells: string[]; x0s: X0s } | null {
  if (!region.cols || !region.bounds) return null;
  const fs = median(region.lines.map((l) => l.fs));
  if (Math.abs(L.fs - fs) > 0.12 * fs || L.x0 < region.x0 - fs || L.x1 > region.x1 + fs || (L.title && !allowIsolated)) return null;
  const segs = splitSegs(L.segs.map((x) => ({ ...x, atoms: [...x.atoms] })), region.bounds);
  if (!segs.length || segs.some((s) => NUMERIC.test(s.text))) return null;
  const cells: string[][] = region.cols.map(() => []);
  const x0s: X0s = region.cols.map(() => undefined);
  for (const s of segs) { const c = colAt(region.bounds, (s.x0 + s.x1) / 2); cells[c].push(s.text); minX0(x0s, c, s.x0); }
  if (cells[0].length || cells.filter((c) => c.length).length > 2) return null;
  return { cells: cells.map((c) => c.join(' ')), x0s };
}
/** A wrapped fragment starts at the same left edge as the text of the cell it continues (or the column's edge). */
const alignedWith = (frag: { cells: string[]; x0s: X0s }, row: TableRow, region: Region): boolean => {
  const fs = median(region.lines.map((l) => l.fs));
  return frag.cells.every((t, c) => { if (!t) return true; const x = frag.x0s[c], ref = row.x0s?.[c] ?? region.cols?.[c]?.[0]; return x != null && ref != null && Math.abs(x - ref) <= 0.6 * fs; });
};
const mergeCells = (a: string[], b: string[], bFirst = false): string[] =>
  a.map((x, i) => { const y = b[i] ?? ''; if (!y) return x; if (!x) return y; return joinCell(bFirst ? [y, x] : [x, y]); });

async function renderPage(page: PdfPage, prevCols: Col[] | undefined, prevAlign: Align): Promise<RenderedPage> {
  const vp = page.getViewport(1);
  const vt = asMat(vp.transform);
  const tc = await page.getTextContent({ normalizeWhitespace: true, disableCombineTextItems: false });
  const g = await graphics(page, vt).catch((): Graphics => ({ rules: [], images: 0, imageArea: 0 }));
  const { items, rotated } = normalise(pageItems(tc, vt));
  const rotRules = (list: Rule[]): Rule[] => {
    const rad = (-rotated * Math.PI) / 180, c = Math.cos(rad), s = Math.sin(rad);
    return list.map((r): Rule => {
      const pts: [number, number][] = isH(r) ? [[r.x0, r.y], [r.x1, r.y]] : [[r.x, r.y0], [r.x, r.y1]];
      const q = pts.map(([x, y]) => [x * c - y * s, x * s + y * c]);
      return Math.abs(q[0][1] - q[1][1]) < 1 ? { dir: 'h', x0: Math.min(q[0][0], q[1][0]), x1: Math.max(q[0][0], q[1][0]), y: q[0][1] } : { dir: 'v', y0: Math.min(q[0][1], q[1][1]), y1: Math.max(q[0][1], q[1][1]), x: q[0][0] };
    });
  };
  const rules = rotated ? rotRules(g.rules) : g.rules;
  const lines = buildLines(items);
  markStrike(lines, rules);
  const pageW = rotated % 180 ? vp.height : vp.width;
  const regs = regions(lines, pageW);
  let cols = prevCols;
  // compute table columns first, so a glued header line just above a table can be recognised and pulled in
  regs.forEach((r, i) => {
    if (r.prose) return;
    r.cols = columnsFor(r, cols); cols = r.cols;
    r.bounds = boundaries(r.cols, rules, r);
    for (let k = i - 1; k >= 0 && k >= i - 3; k--) {
      const p = regs[k]; if (!p.prose || p.used) break;
      const L = p.lines[0], first = r.lines[0];
      if (L.title || first.y - L.y > 1.6 * first.fs || L.x0 < r.x0 - 3 * first.fs || L.x1 > r.x1 + Math.max(3 * first.fs, 0.6 * (r.x1 - r.x0))) break;
      const probe = splitSegs(L.segs.map((x) => ({ ...x, atoms: [...x.atoms] })), r.bounds);
      if (new Set(probe.map((x) => colAt(r.bounds!, (x.x0 + x.x1) / 2))).size < 2) break;
      r.lines.unshift(L); p.used = true;
    }
  });
  const entries: Entry[] = [];
  let lastY: number | null = null;
  let align: Align = prevAlign;
  for (let i = 0; i < regs.length; i++) {
    const r = regs[i];
    if (r.used) continue;
    if (lastY != null && r.lines[0].y - lastY > 1.8 * r.lines[0].fs) entries.push({ kind: 'blank' });
    if (r.prose) {
      const L = r.lines[0];
      entries.push({ kind: 'text', line: L, text: L.segs.map((x, j) => (j && x.x0 - L.segs[j - 1].x1 > 2 * L.fs ? ' | ' : j ? ' ' : '') + x.text).join('') });
    } else {
      for (const L of r.lines) splitAtBounds(L, r.bounds!);
      const rows = rowsFor(r, r.cols!, rules, align);
      const own = alignmentOf(rows, r.cols!);
      if (own !== 'unknown') align = own;
      const table = emitTable(r, r.cols!, rows, rules);
      // bottom-aligned wraps of the table's first row sit above its first full line, outside the region: pull them in
      if (align === 'bottom' && !table.header && table.rows[0]?.data) {
        const frags: string[][] = [];
        let k = entries.length - 1; let nextY = r.lines[0].y;
        while (k >= 0) {
          const e = entries[k];
          if (e.kind !== 'text' || nextY - e.line.y > 1.6 * e.line.fs) break;
          const f = fragmentCells(e.line, r); if (!f || !alignedWith(f, table.rows[0], r)) break;
          frags.unshift(f.cells); nextY = e.line.y; k--;
        }
        if (frags.length) {
          entries.splice(k + 1);
          let lead = frags[0]; for (const f of frags.slice(1)) lead = mergeCells(lead, f);
          table.rows[0].cells = mergeCells(table.rows[0].cells, lead, true);
        }
      }
      entries.push({ kind: 'table', table, region: r, align: own === 'unknown' ? align : own });
    }
    lastY = r.lines[r.lines.length - 1].y;
  }
  const [vx0, vy0, vx1, vy1] = page.view; const pageArea = Math.abs((vx1 - vx0) * (vy1 - vy0)) || 1;
  return { entries, images: g.images, imageCover: Math.min(1, g.imageArea / pageArea), rotated, prevCols: cols, lastAlign: align };
}

/** Page furniture: a few short text lines (running header / footer, page number, CUI banner). */
const furniture = (es: Entry[]): boolean => es.every((e) => e.kind !== 'table') && es.filter((e) => e.kind === 'text').length <= 4 && es.reduce((n, e) => n + (e.kind === 'text' ? e.text.length : 0), 0) <= 320;
const sameColumns = (a: Region, b: Region): boolean => {
  const ca = a.cols ?? [], cb = b.cols ?? [];
  if (ca === cb) return true;
  if (ca.length !== cb.length || !ca.length) return false;
  return cb.every(([x0, x1], i) => { const mid = (x0 + x1) / 2; return mid >= ca[i][0] - 3 && mid <= ca[i][1] + 3; });
};

/** A top-aligned table row split by a page break: its wrapped cell text continues at the top of the next page,
 *  above (or as the leading non-numeric "header" of) the continued table. Re-attach it to the previous page's last row. */
function reattachAcrossPages(prev: RenderedPage, cur: RenderedPage): void {
  const pi = prev.entries.map((e) => e.kind).lastIndexOf('table');
  const ci = cur.entries.findIndex((e) => e.kind === 'table');
  if (pi < 0 || ci < 0) return;
  const T1 = prev.entries[pi], T2 = cur.entries[ci];
  if (T1.kind !== 'table' || T2.kind !== 'table' || !furniture(prev.entries.slice(pi + 1))) return;
  if (!sameColumns(T1.region, T2.region) || T1.align === 'bottom') return;
  const last = [...T1.table.rows].reverse().find((r) => r.data);
  if (!last || last !== T1.table.rows[T1.table.rows.length - 1]) return;
  // fragments: the text lines right above T2 that fit inside its columns and line up with the split row's cells
  const frags: string[][] = [];
  let k = ci - 1; let nextY = T2.region.lines[0].y;
  while (k >= 0) {
    const e = cur.entries[k];
    if (e.kind === 'blank') { k--; continue; }
    if (e.kind !== 'text' || nextY - e.line.y > 3 * e.line.fs) break;
    const f = fragmentCells(e.line, T2.region, true); if (!f || !alignedWith(f, last, T1.region)) break;
    frags.unshift(f.cells); nextY = e.line.y; k--;
  }
  const before = cur.entries.slice(0, k + 1);
  if (frags.length) {
    if (!furniture(before)) return;
    let add = frags[0]; for (const f of frags.slice(1)) add = mergeCells(add, f);
    last.cells = mergeCells(last.cells, add);
    const removed = cur.entries.splice(k + 1, ci - k - 1);
    if (removed.some((e) => e.kind === 'blank')) cur.entries.splice(k + 1, 0, { kind: 'blank' });
    return;
  }
  const h = T2.table.header;
  if (!h || h.length !== last.cells.length || !furniture(before)) return;
  // the continuation was pulled into T2 as a leading non-numeric "header" row ...
  if (!h[0] && h.filter(Boolean).length <= 2 && alignedWith({ cells: h, x0s: T2.table.headerX0s ?? [] }, last, T1.region)) {
    last.cells = mergeCells(last.cells, h);
    T2.table.header = undefined;
    return;
  }
  // ... or below a repeated header row: the same header as the previous page plus extra text in one or two columns
  const h1 = T1.table.header;
  if (!h1 || h1.length !== h.length) return;
  const extra = h.map((t, c) => (t === h1[c] ? '' : h1[c] && t.startsWith(`${h1[c]} `) ? t.slice(h1[c].length + 1) : null));
  if (extra.some((x) => x == null) || extra[0] || !extra.some(Boolean) || extra.filter(Boolean).length > 2) return;
  last.cells = mergeCells(last.cells, extra as string[]);
  T2.table.header = [...h1];
}

function pageText(p: RenderedPage): string {
  const out: string[] = [];
  for (const e of p.entries) {
    if (e.kind === 'blank') out.push('');
    else if (e.kind === 'text') out.push(e.text);
    else {
      if (e.table.titles) out.push(...e.table.titles);
      if (e.table.header) out.push(e.table.header.join(' | '));
      for (const r of e.table.rows) out.push(r.kv ? r.cells.join(' | ').replace(/(\s\|\s*)+$/, '') : r.data ? rowText(r.cells) : r.cells.join(' | '));
    }
  }
  return out.join('\n');
}

export interface PdfPageInfo { page: number; chars: number; images: number; imageCover: number; rotated: number; error?: string }
export interface PdfLayoutResult { text: string; numpages: number; pages: PdfPageInfo[]; scannedPages: number[] }

/** Layout-preserving text of a PDF ("--- page N ---" markers, "cell | cell" table rows) plus per-page scan detection. */
export async function extractPdfLayout(buf: Buffer, opts: { maxPages?: number } = {}): Promise<PdfLayoutResult> {
  const rendered: (RenderedPage | { error: string })[] = [];
  let prevCols: Col[] | undefined; let prevAlign: Align = 'unknown';
  const parsed = await pdfParse(buf, {
    max: opts.maxPages ?? 0,
    pagerender: async (page) => {
      const idx = (page.pageNumber ?? rendered.length + 1) - 1; // a page pdf.js cannot even load is skipped by pdf-parse
      try {
        const r = await renderPage(page, prevCols, prevAlign);
        prevCols = r.prevCols; prevAlign = r.lastAlign;
        rendered[idx] = r;
      } catch (err) {
        rendered[idx] = { error: (err as Error).message || String(err) };
      }
      return '';
    },
  });
  for (let i = 0; i < Math.min(parsed.numrender || parsed.numpages, parsed.numpages); i++) rendered[i] ??= { error: 'page could not be loaded' };
  for (let i = 1; i < rendered.length; i++) {
    const a = rendered[i - 1], b = rendered[i];
    if ('entries' in a && 'entries' in b) reattachAcrossPages(a, b);
  }
  const pages: PdfPageInfo[] = [];
  const parts: string[] = [];
  rendered.forEach((r, i) => {
    const n = i + 1;
    if ('error' in r) { pages.push({ page: n, chars: 0, images: 0, imageCover: 0, rotated: 0, error: r.error }); parts.push(`--- page ${n} --- (unreadable: ${r.error})`); return; }
    const text = pageText(r);
    pages.push({ page: n, chars: text.replace(/\s+/g, '').length, images: r.images, imageCover: r.imageCover, rotated: r.rotated });
    parts.push(`--- page ${n} ---\n${text}`);
  });
  // pages with (almost) no text but an image paint are scans that need OCR / native-PDF reading
  // (a stamp, Bates number or CUI banner adds a few dozen characters to a scan, so use image coverage too)
  const scannedPages = pages.filter((p) => (p.chars < 40 && p.images > 0) || (p.imageCover >= 0.5 && p.chars < 400)).map((p) => p.page);
  return { text: parts.join('\n\n'), numpages: parsed.numpages, pages, scannedPages };
}
