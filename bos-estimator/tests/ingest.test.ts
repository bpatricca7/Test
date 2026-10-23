import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import { Document, Packer, Paragraph, Table, TableCell, TableRow, TextRun } from 'docx';
import { unzipSync, zipSync, strToU8 } from 'fflate';
import { classifyDocument, closeReaders, csvToRows, orderDocuments, readDocument, sniffFormat, textDocument, type DocInput } from '../server/extract';
import { extractPdfLayout } from '../server/pdf-layout';
import { extractXlsx, shrinkWorkbook } from '../server/xlsx-extract';
import { expandZip, zipEntries } from '../server/zip-expand';
import type { FixtureTruth } from './harness/truth';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(here, 'fixtures');

// ---------- helpers ----------

/** Minimal hand-written PDF (standard Helvetica, nothing embedded): text runs, filled rules, a full-page image (raw or
 *  JPEG), /Rotate, raw content operators; plus damage: a false /Count, a /Kids loop, an /Encrypt dictionary. */
interface PdfText { x: number; y: number; size?: number; str: string }
interface PdfPageSpec { texts?: PdfText[]; rects?: { x: number; y: number; w: number; h: number }[]; image?: boolean; jpeg?: boolean; rotate?: number; ops?: string[] }
interface PdfOptions { count?: number; circularKids?: boolean; encrypt?: boolean }
/** A real 16 x 16 grayscale baseline JPEG (170 bytes). */
const TINY_JPEG = Buffer.from('/9j/4AAQSkZJRgABAQAAAAAAAAD/2wBDABALDA4MChAODQ4SERATGCgaGBYWGDEjJR0oOjM9PDkzODdASFxOQERXRTc4UG1RV19iZ2hnPk1xeXBkeFxlZ2P/wAALCAAQABABAREA/8QAFgABAQEAAAAAAAAAAAAAAAAAAAUG/8QAFhAAAwAAAAAAAAAAAAAAAAAAABRh/9oACAEBAAA/AJSECENShAhD/9k=', 'base64');
const pdfEsc = (s: string) => s.replace(/([()\\])/g, '\\$1');
function makePdf(pages: PdfPageSpec[], opts: PdfOptions = {}): Buffer {
  const objs: (string | Buffer)[] = [];
  const add = (body: string | Buffer) => { objs.push(body); return objs.length; };
  const catalog = add(''); const pagesObj = add('');
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const img = add(Buffer.concat([Buffer.from('<< /Type /XObject /Subtype /Image /Width 2 /Height 2 /ColorSpace /DeviceGray /BitsPerComponent 8 /Length 4 >>\nstream\n'), Buffer.from([0x80, 0xff, 0xff, 0x80]), Buffer.from('\nendstream')]));
  const jpg = add(Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width 16 /Height 16 /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /DCTDecode /Length ${TINY_JPEG.length} >>\nstream\n`), TINY_JPEG, Buffer.from('\nendstream')]));
  const kids: number[] = [];
  for (const p of pages) {
    const ops: string[] = [];
    if (p.image) ops.push('q 612 0 0 792 0 0 cm /Im1 Do Q');
    if (p.jpeg) ops.push('q 612 0 0 792 0 0 cm /Im2 Do Q');
    for (const r of p.rects ?? []) ops.push(`${r.x} ${r.y} ${r.w} ${r.h} re f`);
    for (const t of p.texts ?? []) ops.push(`BT /F1 ${t.size ?? 10} Tf 1 0 0 1 ${t.x} ${t.y} Tm (${pdfEsc(t.str)}) Tj ET`);
    ops.push(...(p.ops ?? []));
    const content = ops.join('\n');
    const c = add(`<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 612 792]${p.rotate ? ` /Rotate ${p.rotate}` : ''} /Resources << /Font << /F1 ${font} 0 R >> /XObject << /Im1 ${img} 0 R /Im2 ${jpg} 0 R >> >> /Contents ${c} 0 R >>`));
  }
  const encrypt = opts.encrypt ? add(`<< /Filter /Standard /V 1 /R 2 /Length 40 /P -44 /O <${'5a'.repeat(32)}> /U <${'a5'.repeat(32)}> >>`) : 0;
  objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
  objs[pagesObj - 1] = `<< /Type /Pages /Kids [${opts.circularKids ? `${pagesObj} 0 R ` : ''}${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${opts.count ?? kids.length + (opts.circularKids ? 1 : 0)} >>`;
  const parts: Buffer[] = [Buffer.from('%PDF-1.4\n')]; const offsets: number[] = []; let len = parts[0].length;
  objs.forEach((o, i) => { const b = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`), Buffer.isBuffer(o) ? o : Buffer.from(o, 'latin1'), Buffer.from('\nendobj\n')]); offsets.push(len); parts.push(b); len += b.length; });
  const trailerExtra = encrypt ? ` /Encrypt ${encrypt} 0 R /ID [<00112233445566778899aabbccddeeff> <00112233445566778899aabbccddeeff>]` : '';
  parts.push(Buffer.from(`xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R${trailerExtra} >>\nstartxref\n${len}\n%%EOF\n`));
  return Buffer.concat(parts);
}

/** A two-page, top-aligned, borderless facility list (Word style) whose last page-1 row is split by the page break,
 *  with a footnote superscript, a struck-through row and wrapped names; page 3 is a scanned image with a CUI stamp. */
function facilityListPdf(rotate?: number): Buffer {
  const C = { bn: 50, name: 110, gross: 330, freq: 420 };
  const row = (y: number, cells: [number, string][]): PdfText[] => cells.map(([x, str]) => ({ x, y, str }));
  const p1: PdfText[] = [
    { x: 50, y: 740, size: 12, str: 'ATTACHMENT J-4 FACILITY LIST' },
    ...row(700, [[C.bn, 'Bldg'], [C.name, 'Facility Name'], [C.gross, 'Gross SF'], [C.freq, 'Frequency']]),
    ...row(684, [[C.bn, '1201'], [C.name, 'Brigade Headquarters'], [C.gross, '45,200'], [C.freq, 'Daily']]),
    { x: 361, y: 688, size: 6, str: '1' }, // footnote marker raised after "45,200"
    ...row(668, [[C.bn, '1205'], [C.name, 'Battalion Headquarters'], [C.gross, '18,750'], [C.freq, 'Daily']]),
    ...row(652, [[C.bn, '1310'], [C.name, 'Soldier Service Center'], [C.gross, '62,000'], [C.freq, 'Daily']]),
    ...row(641, [[C.name, '(DHR / Finance)']]),
    ...row(625, [[C.bn, '2402'], [C.name, 'Barracks, Enlisted'], [C.gross, '96,000'], [C.freq, 'Daily']]),
    ...row(614, [[C.name, '(Common Areas Only)']]),
    ...row(598, [[C.bn, '5100'], [C.name, 'Central Issue Facility'], [C.gross, '82,000'], [C.freq, 'Weekly']]),
    ...row(582, [[C.bn, '3105'], [C.name, 'Consolidated Health'], [C.gross, '54,300'], [C.freq, 'Daily']]),
    { x: 280, y: 40, size: 8, str: 'Page 1 of 3' },
  ];
  const p2: PdfText[] = [
    { x: 400, y: 770, size: 8, str: 'W912QR-26-R-0042 Attachment J-4' },
    ...row(740, [[C.name, 'Clinic and Dental']]), // the rest of row 3105, carried over by the page break
    ...row(724, [[C.bn, '4001'], [C.name, 'Physical Fitness Center'], [C.gross, '48,000'], [C.freq, 'Daily']]),
    ...row(708, [[C.bn, '4210'], [C.name, 'Child Development Center'], [C.gross, '22,400'], [C.freq, 'Daily']]),
    ...row(692, [[C.bn, '6010'], [C.name, 'Aviation Hangar 1'], [C.gross, '120,000'], [C.freq, 'Weekly']]),
    { x: 280, y: 40, size: 8, str: 'Page 2 of 3' },
  ];
  return makePdf([
    { texts: p1, rects: [{ x: 108, y: 601, w: 110, h: 0.8 }], rotate }, // strike-through over "Central Issue Facility"
    { texts: p2, rotate },
    { image: true, texts: [{ x: 40, y: 20, size: 7, str: 'CUI // Page 3 of 3' }] },
  ]);
}

const rowsOf = (text: string) => text.split('\n').filter((l) => l.includes(' | ')).map((l) => l.split(' | ').map((c) => c.trim()));
const digits = (s: string) => s.replace(/\[\^\w+\]/g, '').replace(/[^\d]/g, '');

/** Every truth building appears on one row with its number, its exact name and its gross SF in separate cells. */
function assertCleanRows(text: string, truth: FixtureTruth) {
  const rows = rowsOf(text);
  for (const f of truth.expect.facilities) {
    const hit = rows.some((cells) => cells.some((c) => c === f.buildingNumber || c === `Bldg ${f.buildingNumber}`) && cells.includes(f.name) && cells.some((c) => digits(c) === String(f.grossSqft)));
    assert.ok(hit, `no clean row for ${f.buildingNumber} ${f.name} ${f.grossSqft}`);
  }
}
function fixtureFile(id: string, file: string): { truth: FixtureTruth; file: string } | null {
  const dir = path.join(FIXTURES, id);
  const p = path.join(dir, 'build', file);
  if (!fs.existsSync(p)) return null;
  return { truth: JSON.parse(fs.readFileSync(path.join(dir, 'truth.json'), 'utf8')) as FixtureTruth, file: p };
}
const one = async (name: string, buf: Buffer, ingest?: 'auto' | 'native_pdf' | 'text'): Promise<DocInput> => {
  const docs = await readDocument(name, buf, ingest);
  assert.equal(docs.length, 1, `expected one document from ${name}`);
  return docs[0];
};

// ---------- fixtures ----------

test('sample PDF fixture: layout text has a clean pipe row for every building', async (t) => {
  const fx = fixtureFile('sample-fort-example', 'pws.pdf');
  if (!fx) { t.skip('fixture not rendered (node scripts/render-fixtures.mjs)'); return; }
  const d = await one('pws.pdf', fs.readFileSync(fx.file));
  assert.equal(d.kind, 'pdf');
  assert.equal(d.role, 'pws');
  assert.match(d.text, /^--- page 1 ---/);
  assert.match(d.text, /--- page 2 ---/);
  assert.deepEqual(d.scannedPages, []);
  assertCleanRows(d.text, fx.truth);
  assert.ok(rowsOf(d.text).some((c) => c[0] === 'Bldg No.' && c.includes('Gross SF') && c.includes('Cleanable SF')), 'header row kept as cells');
});

test('sample DOCX fixture: Word tables come out as clean pipe rows for every building', async (t) => {
  const fx = fixtureFile('sample-fort-example-docx', 'pws.docx');
  if (!fx) { t.skip('fixture not rendered (node scripts/render-fixtures.mjs)'); return; }
  const d = await one('pws.docx', fs.readFileSync(fx.file));
  assert.equal(d.kind, 'docx');
  assert.equal(d.mode, 'text');
  assertCleanRows(d.text, fx.truth);
});

test('scanned facility exhibit fixture: scanned pages are detected and routed natively', async (t) => {
  const dir = path.join(FIXTURES, 'scanned-facility-exhibit', 'build');
  const pdfs = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.pdf')) : [];
  if (!pdfs.length) { t.skip('scanned-facility-exhibit not present or not rendered'); return; }
  let flagged = 0;
  for (const f of pdfs) {
    const buf = fs.readFileSync(path.join(dir, f));
    const d = await one(f, buf);
    if (d.scannedPages?.length) {
      flagged++;
      assert.ok(d.warnings?.some((w) => /scanned images/.test(w)), 'scanned pages are reported in the warnings');
      if (buf.length <= 28 * 1024 * 1024) assert.equal(d.mode, 'native_pdf');
    }
  }
  assert.ok(flagged > 0, 'at least one scanned PDF is flagged');
});

// ---------- PDF layout ----------

test('PDF layout: footnotes as [^n], strike-through as ~~x~~, wrapped cells joined, split row re-attached across the page break', async () => {
  const r = await extractPdfLayout(facilityListPdf());
  assert.equal(r.numpages, 3);
  const [p1, p2] = r.text.split('--- page 2 ---');
  assert.match(p1, /^--- page 1 ---/);
  const lines = r.text.split('\n');
  assert.ok(lines.includes('Bldg | Facility Name | Gross SF | Frequency'));
  assert.ok(lines.includes('1201 | Brigade Headquarters | 45,200[^1] | Daily'), 'superscript footnote marker kept apart from the number');
  assert.ok(lines.includes('1310 | Soldier Service Center (DHR / Finance) | 62,000 | Daily'), 'wrapped name re-joined');
  assert.ok(lines.includes('5100 | ~~Central Issue Facility~~ | 82,000 | Weekly'), 'struck-through name marked');
  assert.ok(lines.includes('3105 | Consolidated Health Clinic and Dental | 54,300 | Daily'), 'row split by the page break re-attached');
  assert.ok(!/^Clinic and Dental/m.test(p2), 'continuation fragment removed from page 2');
  assert.ok(lines.includes('4001 | Physical Fitness Center | 48,000 | Daily'));
  assert.deepEqual(r.scannedPages, [3]);
});

test('PDF layout: /Rotate 90 pages come out upright with the same rows', async () => {
  const a = await extractPdfLayout(facilityListPdf());
  const b = await extractPdfLayout(facilityListPdf(90));
  assert.equal(b.text, a.text);
});

test('PDF routing: a scanned page goes native with a warning; text mode keeps the layout text and says what is lost', async () => {
  const buf = facilityListPdf();
  const auto = await one('J-4 Facility List.pdf', buf);
  assert.equal(auto.mode, 'native_pdf');
  assert.ok(auto.pdfBase64 && auto.pdfBase64.length > 0);
  assert.deepEqual(auto.scannedPages, [3]);
  assert.ok(auto.warnings?.some((w) => /1 of 3 pages are scanned images \(pages 3\)/.test(w)));
  assert.match(auto.text, /1201 \| Brigade Headquarters/);
  const text = await one('J-4 Facility List.pdf', buf, 'text');
  assert.equal(text.mode, 'text');
  assert.equal(text.pdfBase64, undefined);
  assert.ok(text.warnings?.some((w) => /NOT readable in text mode/.test(w)));
  assert.equal(text.text, auto.text);
});

test('PDF: a damaged file is reported, not thrown, and never sent to Claude as a PDF', async () => {
  const d = await one('broken.pdf', Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ngarbage'));
  assert.ok(d.warnings?.length, 'a warning explains the failure');
  // the API rejects an invalid PDF together with every other document of the request
  assert.equal(d.mode, 'text');
  assert.equal(d.pdfBase64, undefined);
  assert.equal(d.text, '');
  const enc = await one('J-4 (protected).pdf', makePdf([{ texts: [{ x: 50, y: 700, str: 'Bldg 1201 Brigade Headquarters 45,200 SF' }] }], { encrypt: true }));
  assert.equal(enc.mode, 'text');
  assert.equal(enc.pdfBase64, undefined);
  assert.ok(enc.warnings?.some((w) => /password-protected/.test(w)), JSON.stringify(enc.warnings));
});

test('PDF: a JPEG image (logo, seal, scan) neither crashes pdf.js in Node nor hides the page text', async () => {
  // pdf.js's default hands JPEGs to `new Image()`, which Node lacks: an uncaught ReferenceError that killed the server.
  // This runs in-process on purpose, so a regression fails the test run instead of hiding in the isolated reader.
  const texts = [{ x: 50, y: 700, str: 'PERFORMANCE WORK STATEMENT' }, { x: 50, y: 680, str: 'Bldg' }, { x: 110, y: 680, str: 'Facility Name' }, { x: 330, y: 680, str: 'Gross SF' }, { x: 50, y: 664, str: '1201' }, { x: 110, y: 664, str: 'Brigade Headquarters' }, { x: 330, y: 664, str: '45,200' }, { x: 50, y: 648, str: '1205' }, { x: 110, y: 648, str: 'Battalion HQ' }, { x: 330, y: 648, str: '18,750' }];
  const logo = makePdf([{ texts, ops: ['q 72 0 0 36 450 720 cm /Im2 Do Q'] }]);
  const r = await extractPdfLayout(logo);
  assert.equal(r.pages[0].images, 1, 'the JPEG is still counted');
  assert.deepEqual(r.scannedPages, []);
  assert.ok(r.text.split('\n').includes('1201 | Brigade Headquarters | 45,200'), r.text);
  const scan = await extractPdfLayout(makePdf([{ jpeg: true, texts: [{ x: 40, y: 20, size: 7, str: 'CUI' }] }, { texts }]));
  assert.deepEqual(scan.scannedPages, [1], 'a JPEG-scanned page is detected');
  const d = await one('PWS with logo.pdf', logo);
  assert.equal(d.mode, 'native_pdf');
  assert.match(d.text, /1205 \| Battalion HQ \| 18,750/);
});

test('PDF: a small file read the way the server reads uploads (fs.promises.readFile, an exact Buffer) parses', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ingest-test-'));
  try {
    const file = path.join(dir, 'tiny.pdf');
    fs.writeFileSync(file, makePdf([{ texts: [{ x: 50, y: 700, str: 'Bldg' }, { x: 110, y: 700, str: 'Facility Name' }, { x: 330, y: 700, str: 'Gross SF' }, { x: 50, y: 684, str: '1201' }, { x: 110, y: 684, str: 'Brigade Headquarters' }, { x: 330, y: 684, str: '45,200' }] }]));
    const buf = await fs.promises.readFile(file);
    assert.ok(buf.length < 4096, `${buf.length} bytes`);
    const d = await one('tiny.pdf', buf);
    assert.equal(d.warnings, undefined, JSON.stringify(d.warnings));
    assert.match(d.text, /1201 \| Brigade Headquarters \| 45,200/);
    const direct = await extractPdfLayout(buf);
    assert.equal(direct.numpages, 1);
    assert.match(direct.text, /1201 \| Brigade Headquarters \| 45,200/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('PDF: a false page count and a looping page tree cost one file, not the process', async () => {
  const page = { texts: [{ x: 50, y: 700, str: 'Bldg 1201 Brigade Headquarters 45,200 SF' }] };
  // /Count 3,000,000 on a one-page file: stops after a run of unloadable pages, one warning instead of 3 million markers
  const t0 = Date.now();
  const lie = await one('count.pdf', makePdf([page], { count: 3_000_000 }));
  assert.ok(Date.now() - t0 < 15000, `${Date.now() - t0} ms`);
  assert.ok(lie.text.length < 2000, `${lie.text.length} chars`);
  assert.match(lie.text, /Bldg 1201 Brigade Headquarters 45,200 SF/);
  assert.ok(lie.warnings?.some((w) => /were not read/.test(w)), JSON.stringify(lie.warnings));
  assert.equal(lie.mode, 'text', 'a damaged page tree is not sent to Claude as a PDF');
  assert.equal(lie.pages, 1);
  const direct = await extractPdfLayout(makePdf([page], { count: 3_000_000 }));
  assert.ok(direct.pagesRead <= 25 && direct.stop?.kind === 'failures', JSON.stringify({ read: direct.pagesRead, stop: direct.stop }));
  // a /Kids array that contains its own parent: pdf.js walks it until the heap or the array length gives out
  // (only the isolated reader can stop that: with BOS_READER_WORKERS=0 parsing is in-process and unprotected)
  if (process.env.BOS_READER_WORKERS === '0') return;
  const prev = process.env.BOS_READER_PAGE_LOAD_MS;
  process.env.BOS_READER_PAGE_LOAD_MS = '2000';
  try {
    const loop = await one('loop.pdf', makePdf([page], { circularKids: true }));
    assert.equal(loop.text, '');
    assert.equal(loop.pdfBase64, undefined);
    assert.ok(loop.warnings?.some((w) => /could not be read/.test(w) && /page tree/.test(w)), JSON.stringify(loop.warnings));
  } finally { if (prev == null) delete process.env.BOS_READER_PAGE_LOAD_MS; else process.env.BOS_READER_PAGE_LOAD_MS = prev; }
  // and the reader still works afterwards
  const ok = await one('J-4 Facility List.pdf', facilityListPdf());
  assert.match(ok.text, /1201 \| Brigade Headquarters \| 45,200\[\^1\] \| Daily/);
});

/** A ruled table whose Campus cells are merged over each group of buildings and centred between rows. */
function rowspanPdf(innerRules: boolean): Buffer {
  const X = [50, 120, 180, 330, 400];
  const rects: { x: number; y: number; w: number; h: number }[] = X.map((x) => ({ x: x - 0.4, y: 620, w: 0.8, h: 80 }));
  for (const y of [700, 684, 652, 620]) rects.push({ x: 50, y: y - 0.4, w: 350, h: 0.8 });
  if (innerRules) for (const y of [668, 636]) rects.push({ x: 120, y: y - 0.4, w: 280, h: 0.8 }); // stop at the merged Campus cell
  const row = (y: number, cells: string[]) => cells.map((str, i) => ({ x: [124, 184, 334][i], y, str }));
  return makePdf([{ rects, texts: [
    { x: 54, y: 689, str: 'Campus' }, { x: 124, y: 689, str: 'Bldg' }, { x: 184, y: 689, str: 'Facility Name' }, { x: 334, y: 689, str: 'Gross SF' },
    ...row(673, ['1201', 'Brigade Headquarters', '45,200']), ...row(657, ['1205', 'Battalion HQ', '18,750']), { x: 54, y: 665, str: 'Main Post' },
    ...row(641, ['2101', 'Dental Clinic', '9,800']), ...row(625, ['2105', 'Fitness Center', '31,000']), { x: 54, y: 633, str: 'North Annex' },
  ] }]);
}

test('PDF layout: a merged (rowspan) cell in a ruled table neither glues its rows together nor loses its label', async () => {
  const lines = (await extractPdfLayout(rowspanPdf(true))).text.split('\n');
  for (const l of ['Campus | Bldg | Facility Name | Gross SF', 'Main Post | 1201 | Brigade Headquarters | 45,200', 'Main Post | 1205 | Battalion HQ | 18,750', 'North Annex | 2101 | Dental Clinic | 9,800', 'North Annex | 2105 | Fitness Center | 31,000']) assert.ok(lines.includes(l), `${l}\n---\n${lines.join('\n')}`);
  // rules only between the groups: each building still gets its own row
  const rows = rowsOf((await extractPdfLayout(rowspanPdf(false))).text);
  for (const [bn, name, sf] of [['1201', 'Brigade Headquarters', '45,200'], ['1205', 'Battalion HQ', '18,750'], ['2101', 'Dental Clinic', '9,800'], ['2105', 'Fitness Center', '31,000']]) {
    assert.ok(rows.some((c) => c.includes(bn) && c.includes(name) && c.includes(sf) && c.length === 4), `${bn}: ${JSON.stringify(rows)}`);
  }
});

test('PDF layout: a wrapped Remarks line wider than the rows above it stays in the table, so the header keeps its rows', async () => {
  // a remark that wraps under the first data row reaches further right than the header and that row: it is a fragment of
  // the last column, not the end of the table (the rows below would otherwise lose their header)
  const C = { bn: 50, name: 100, gross: 250, rem: 320 };
  const row = (y: number, cells: [number, string][]): PdfText[] => cells.map(([x, str]) => ({ x, y, size: 9, str }));
  const pdf = makePdf([{ texts: [
    { x: 50, y: 740, size: 12, str: 'INVENTORY OF SERVICED STRUCTURES' },
    ...row(700, [[C.bn, 'Bldg'], [C.name, 'Facility Name'], [C.gross, 'Gross SF'], [C.rem, 'Remarks']]),
    ...row(686, [[C.bn, '1201'], [C.name, 'Brigade HQ'], [C.gross, '45,200'], [C.rem, 'Lobby only']]),
    ...row(677, [[C.rem, '(2,140 SF) excluded']]),
    ...row(663, [[C.bn, '1205'], [C.name, 'Battalion HQ'], [C.gross, '18,750'], [C.rem, 'None']]),
    ...row(649, [[C.bn, '2101'], [C.name, 'Dental Clinic'], [C.gross, '9,800'], [C.rem, 'None']]),
    ...row(635, [[C.bn, '2105'], [C.name, 'Fitness Center'], [C.gross, '31,000'], [C.rem, 'None']]),
  ] }]);
  const lines = (await extractPdfLayout(pdf)).text.split('\n');
  const header = lines.indexOf('Bldg | Facility Name | Gross SF | Remarks');
  assert.ok(header >= 0, lines.join('\n'));
  assert.equal(lines[header + 1], '1201 | Brigade HQ | 45,200 | Lobby only (2,140 SF) excluded');
  for (const [i, l] of ['1205 | Battalion HQ | 18,750 | None', '2101 | Dental Clinic | 9,800 | None', '2105 | Fitness Center | 31,000 | None'].entries()) assert.equal(lines[header + 2 + i], l, lines.join('\n'));
});

test('PDF layout: a short note set flush right under a table is not glued to the last row', async () => {
  // a wrapped Remarks fragment starts where the Remarks column starts; a right-aligned note under the table does not
  const C = { bn: 50, name: 100, gross: 250, rem: 320 };
  const row = (y: number, cells: [number, string][]): PdfText[] => cells.map(([x, str]) => ({ x, y, size: 9, str }));
  const pdf = makePdf([{ texts: [
    { x: 50, y: 740, size: 12, str: 'BUILDING LIST' },
    ...row(700, [[C.bn, 'Bldg'], [C.name, 'Facility Name'], [C.gross, 'Gross SF'], [C.rem, 'Remarks']]),
    ...row(686, [[C.bn, '201'], [C.name, 'Clinic'], [C.gross, '8,000'], [C.rem, 'Patient areas']]),
    ...row(672, [[C.bn, '202'], [C.name, 'Pharmacy'], [C.gross, '2,500'], [C.rem, 'None']]),
    ...row(663, [[440, 'Total: 10,500 SF']]),
  ] }]);
  const lines = (await extractPdfLayout(pdf)).text.split('\n');
  assert.ok(lines.includes('202 | Pharmacy | 2,500 | None'), lines.join('\n'));
  assert.ok(lines.includes('Total: 10,500 SF'), lines.join('\n'));
});

/** A ruled grid as Chromium prints an HTML table: a rule under every row, column borders drawn row by row and left out
 *  where a cell spans them. cols: x of each border; a cell spans columns from..to. */
interface GridCell { text: string; from: number; to?: number; align?: 'l' | 'r' | 'c' }
function gridPage(cols: number[], top: number, rows: GridCell[][], size = 7) {
  const rects: { x: number; y: number; w: number; h: number }[] = [{ x: cols[0], y: top - 0.25, w: cols[cols.length - 1] - cols[0], h: 0.5 }];
  const texts: PdfText[] = [];
  let y = top;
  for (const r of rows) {
    const yb = y - 10;
    rects.push({ x: cols[0], y: yb - 0.25, w: cols[cols.length - 1] - cols[0], h: 0.5 });
    cols.forEach((x, k) => { if (k > 0 && k < cols.length - 1 && r.some((c) => c.from < k && (c.to ?? c.from) >= k)) return; rects.push({ x: x - 0.25, y: yb, w: 0.5, h: 10 }); });
    for (const c of r) {
      const a = cols[c.from], b = cols[(c.to ?? c.from) + 1], w = c.text.length * 0.5 * size;
      texts.push({ x: c.align === 'r' ? b - 3 - w : c.align === 'c' ? (a + b) / 2 - w / 2 : a + 3, y: yb + 3, size, str: c.text });
    }
    y = yb;
  }
  return { rects, texts };
}

test('PDF layout: banner rows inside a ruled table stay in it, the header ends above the first banner, and a column merged only by spanning labels is split at its border', async () => {
  const c = (text: string, from: number, align: 'l' | 'r' | 'c' = 'l', to?: number): GridCell => ({ text, from, to, align });
  const row = (bn: string, ty: string, d: string, g: string, n: string, f: string) => [c(bn, 0), c(ty, 1, 'c'), c(d, 2), c(g, 3, 'r'), c(n, 4, 'r'), c(f, 5, 'c')];
  // centred column titles start right of the banner text, which sits at the cell's left padding
  const g = gridPage([40, 92, 118, 250, 310, 370, 420], 700, [
    [c('Facility', 0, 'c'), c('Type', 1, 'c'), c('Description', 2, 'c'), c('Gross SF', 3, 'c'), c('Net SF', 4, 'c'), c('Sched.', 5, 'c')],
    [c('EAST ANNEX', 0, 'l', 5)], row('EA-101', 'ADM', 'Annex Office Building', '18,400', '15,900', 'D5'), row('EA-102', 'WH', 'Supply Warehouse', '22,000', '3,100', 'W1'),
    [c('Annex total (2)', 1, 'l', 2), c('40,400', 3, 'r'), c('19,000', 4, 'r')],
    [c('WEST ANNEX', 0, 'l', 5)], row('WA-201', 'TRN', 'Classroom Building', '31,250', '27,400', 'D5'), [c('Annex total (1)', 1, 'l', 2), c('31,250', 3, 'r'), c('27,400', 4, 'r')],
  ]);
  const lines = (await extractPdfLayout(makePdf([{ texts: [{ x: 40, y: 740, size: 11, str: 'EXHIBIT C - CUSTODIAL WORKLOAD' }, ...g.texts], rects: g.rects }]))).text.split('\n');
  const h = lines.indexOf('Facility | Type | Description | Gross SF | Net SF | Sched.');
  assert.ok(h >= 0, lines.join('\n'));
  assert.deepEqual(lines.slice(h + 1, h + 5), ['EAST ANNEX |  |  |  |  |', 'EA-101 | ADM | Annex Office Building | 18,400 | 15,900 | D5', 'EA-102 | WH | Supply Warehouse | 22,000 | 3,100 | W1', ' | Annex total (2) |  | 40,400 | 19,000 |']);
  assert.ok(lines.includes('WA-201 | TRN | Classroom Building | 31,250 | 27,400 | D5'), lines.join('\n'));
  // a two-row grouped header with footnote markers on its titles, a banner, and a "closed" note spanning the measure columns
  const t2 = gridPage([36, 80, 112, 260, 310, 360, 400], 700, [
    [c('Bldg', 0, 'c'), c('BUILDING', 1, 'c', 2), c('AREA (SQ FT)', 3, 'c', 4), c('Days', 5, 'c')],
    [c('Code', 1, 'c'), c('Name', 2, 'c'), c('Gross', 3, 'c'), c('Semi-', 4, 'c')],
    [c('ZONE 1 - OPERATIONS', 0, 'l', 5)], [c('310', 0), c('OPS', 1, 'c'), c('Operations Center', 2), c('40,100', 3, 'r'), c('35,600', 4, 'r'), c('7', 5, 'c')],
    [c('314', 0), c('STO', 1, 'c'), c('Old Storage Shed', 2), c('CLOSED - NO SERVICE', 3, 'c', 5)], [c('312', 0), c('HQ', 1, 'c'), c('Wing Headquarters', 2), c('28,900', 3, 'r'), c('25,050', 4, 'r'), c('5', 5, 'c')],
    [c('316', 0), c('FIT', 1, 'c'), c('Fitness Center', 2), c('33,000', 3, 'r'), c('29,500', 4, 'r'), c('7', 5, 'c')], [c('318', 0), c('CDC', 1, 'c'), c('Child Development Center', 2), c('12,400', 3, 'r'), c('10,900', 4, 'r'), c('5', 5, 'c')],
  ]);
  t2.texts.push({ x: 296, y: 685.5, size: 4.5, str: '1' }); // a raised marker after "Gross"
  const l2 = (await extractPdfLayout(makePdf([{ texts: t2.texts, rects: t2.rects }]))).text.split('\n');
  assert.ok(l2.includes('Bldg | BUILDING Code | BUILDING Name | AREA (SQ FT) Gross[^1] | AREA (SQ FT) Semi- | Days'), l2.join('\n'));
  assert.ok(l2.includes('ZONE 1 - OPERATIONS |  |  |  |  |'), l2.join('\n'));
  assert.ok(l2.includes('310 | OPS | Operations Center | 40,100 | 35,600 | 7') && l2.includes('312 | HQ | Wing Headquarters | 28,900 | 25,050 | 5'), l2.join('\n'));
});

test('PDF layout: a sparse subtotal line under an unruled list is the next row, not the wrapped rest of the row above', async () => {
  const X = [40, 100, 140, 300, 370, 440];
  const texts: PdfText[] = [];
  let y = 700;
  const put = (cells: [number, string, boolean?][]) => { for (const [k, s, right] of cells) texts.push({ x: right ? X[k + 1] - 6 - s.length * 3.5 : X[k], y, size: 7, str: s }); y -= 11; };
  put([[0, 'Bldg'], [1, 'Type'], [2, 'Building Name'], [3, 'Gross SF'], [4, 'Net SF']]);
  put([[0, 'M-10'], [1, 'ADM'], [2, 'Post Headquarters'], [3, '24,000', true], [4, '20,100', true]]);
  put([[0, 'M-12'], [1, 'TRN'], [2, 'Learning Center'], [3, '9,800', true], [4, '8,700', true]]);
  put([[0, 'M-13'], [1, 'GYM'], [2, 'Fitness Center'], [3, '21,000', true], [4, '18,000', true]]);
  put([[0, 'M-14'], [1, 'WH'], [2, 'Supply Warehouse'], [3, '30,000', true], [4, '2,500', true]]);
  put([[1, 'Main Post subtotal'], [3, '84,800', true], [4, '49,300', true]]);
  const rows = rowsOf((await extractPdfLayout(makePdf([{ texts }]))).text);
  assert.ok(rows.some((r) => r[0] === 'M-14' && r.includes('30,000') && r.includes('2,500') && !r.some((x) => /subtotal|84,800/.test(x))), JSON.stringify(rows));
  assert.ok(rows.some((r) => r.some((x) => x === 'Main Post subtotal') && r.includes('84,800') && r.includes('49,300')), JSON.stringify(rows));
});

test('PDF layout: a page border is not a table frame (column titles stay one row, notes under the table stay text)', async () => {
  const texts: PdfText[] = [{ x: 50, y: 740, size: 11, str: 'EXHIBIT 7 - FACILITIES' }];
  let y = 700;
  for (const r of [['Bldg', 'Facility', 'Gross SF'], ['701', 'Operations Building', '12,000'], ['702', 'Garage', '4,500'], ['703', 'Storage', '2,000']]) { texts.push({ x: 50, y, str: r[0] }, { x: 100, y, str: r[1] }, { x: 300, y, str: r[2] }); y -= 11; }
  texts.push({ x: 50, y: y - 20, str: 'Note: Building 702 is cleaned weekly; all others daily.' });
  const rects = [{ x: 30, y: 30, w: 552, h: 0.6 }, { x: 30, y: 760, w: 552, h: 0.6 }, { x: 30, y: 30, w: 0.6, h: 730 }, { x: 581.4, y: 30, w: 0.6, h: 730 }];
  const lines = (await extractPdfLayout(makePdf([{ texts, rects }]))).text.split('\n');
  assert.ok(lines.includes('Bldg | Facility | Gross SF'), lines.join('\n'));
  assert.ok(lines.includes('Note: Building 702 is cleaned weekly; all others daily.'), lines.join('\n'));
});

test('PDF layout: under column titles, a row that opens with an identifier is a data row even with no two-digit figure', async () => {
  const c = (text: string, from: number, align: 'l' | 'r' | 'c' = 'l'): GridCell => ({ text, from, align });
  const g = gridPage([40, 80, 330, 400, 450], 700, [
    [c('Exhibit', 0, 'c'), c('Title', 1, 'c'), c('Pages', 2, 'c'), c('Copies', 3, 'c')],
    [c('E.1', 0), c('Building data sheets', 1), c('6', 2, 'c'), c('1', 3, 'c')],
    [c('E.2', 0), c('Wage determination', 1), c('22', 2, 'c'), c('1', 3, 'c')],
    [c('E.3', 0), c('Quality assurance plan', 1), c('9', 2, 'c'), c('2', 3, 'c')],
  ]);
  const lines = (await extractPdfLayout(makePdf([{ texts: g.texts, rects: g.rects }]))).text.split('\n');
  assert.ok(lines.includes('Exhibit | Title | Pages | Copies'), lines.join('\n'));
  assert.ok(lines.includes('E.1 | Building data sheets | 6 | 1'), lines.join('\n'));
});

test('PDF layout: a notes row inside the ruled frame stays text (its sentences are prose), a banner row stays in the table', async () => {
  const c = (text: string, from: number, align: 'l' | 'r' | 'c' = 'l', to?: number): GridCell => ({ text, from, to, align });
  const note1 = 'Notes: 1. Areas are from the 2026 inventory. 2. Bldg 702 is cleaned weekly.';
  const note2 = 'Gross SF is from the real property inventory. Building 703 is cleaned by the tenant agency.';
  const g = gridPage([40, 90, 300, 360, 420], 700, [
    [c('Bldg', 0, 'c'), c('Facility', 1, 'c'), c('Gross SF', 2, 'c'), c('Net SF', 3, 'c')],
    [c('EAST POST', 0, 'l', 3)],
    [c('701', 0), c('Operations Building', 1), c('12,000', 2, 'r'), c('10,500', 3, 'r')], [c('702', 0), c('Garage', 1), c('4,500', 2, 'r'), c('900', 3, 'r')],
    [c('703', 0), c('Records Storage', 1), c('2,000', 2, 'r'), c('1,800', 3, 'r')],
    [c(note1, 0, 'l', 3)], [c(note2, 0, 'l', 3)],
  ]);
  const lines = (await extractPdfLayout(makePdf([{ texts: g.texts, rects: g.rects }]))).text.split('\n');
  assert.ok(lines.includes('EAST POST |  |  |'), lines.join('\n'));
  assert.ok(lines.includes('703 | Records Storage | 2,000 | 1,800'), lines.join('\n'));
  assert.ok(lines.includes(note1) && lines.includes(note2), lines.join('\n'));
});

test('superscripts: unit exponents and ordinals stay text, footnote markers become [^n] (PDF and DOCX)', async () => {
  // superscripts as Word / Chromium print them: a smaller run with text rise (Ts persists across BT/ET, so reset it)
  const p = makePdf([{ ops: [
    'BT 0 Ts /F1 10 Tf 1 0 0 1 50 700 Tm (Gross Floor Area \\(m) Tj /F1 6 Tf 4 Ts (2) Tj /F1 10 Tf 0 Ts (\\)) Tj ET',
    'BT 0 Ts /F1 10 Tf 1 0 0 1 50 680 Tm (4,200 m) Tj /F1 6 Tf 4 Ts (2) Tj ET',
    'BT 0 Ts /F1 10 Tf 1 0 0 1 50 660 Tm (Restrooms on the 2) Tj /F1 6 Tf 4 Ts (nd) Tj /F1 10 Tf 0 Ts ( floor) Tj ET',
    'BT 0 Ts /F1 10 Tf 1 0 0 1 50 640 Tm (Total 45,200) Tj /F1 6 Tf 4 Ts (1) Tj ET',
    'BT 0 Ts /F1 10 Tf 1 0 0 1 50 620 Tm (Boiler Room) Tj /F1 6 Tf 4 Ts (2) Tj ET',
  ] }]);
  const t = (await extractPdfLayout(p)).text;
  for (const want of ['Gross Floor Area (m²)', '4,200 m²', 'Restrooms on the 2nd floor', 'Total 45,200[^1]', 'Boiler Room[^2]']) assert.ok(t.includes(want), `${want}\n---\n${t}`);
  const sup = (text: string) => new TextRun({ text, superScript: true });
  const cell = (children: TextRun[]) => new TableCell({ children: [new Paragraph({ children })] });
  const doc = new Document({ sections: [{ children: [
    new Paragraph({ children: [new TextRun('TE-3 FACILITY LIST (areas in m'), sup('2'), new TextRun('; restrooms serviced 2'), sup('nd'), new TextRun(' shift)'), sup('1')] }),
    new Table({ rows: [
      new TableRow({ children: [cell([new TextRun('Bldg')]), cell([new TextRun('Gross Floor Area (m'), sup('2'), new TextRun(')')]), cell([new TextRun('Floors')])] }),
      new TableRow({ children: [cell([new TextRun('1201')]), cell([new TextRun('4,200 m'), sup('2')]), cell([new TextRun('3'), sup('rd'), new TextRun(' floor and up')])] }),
    ] }),
  ] }] });
  const d = await one('TE-3.docx', await Packer.toBuffer(doc));
  const lines = d.text.split('\n');
  assert.ok(lines.includes('TE-3 FACILITY LIST (areas in m²; restrooms serviced 2nd shift)[^1]'), d.text);
  assert.ok(lines.includes('Bldg | Gross Floor Area (m²) | Floors'), d.text);
  assert.ok(lines.includes('1201 | 4,200 m² | 3rd floor and up'), d.text);
});

test('DOCX: a row of one cell across the table under the column titles is a banner, not part of the header', async () => {
  const c = (t: string, span = 1) => new TableCell({ columnSpan: span, children: [new Paragraph({ children: [new TextRun(t)] })] });
  const r = (...cs: TableCell[]) => new TableRow({ children: cs });
  const doc = new Document({ sections: [{ children: [new Paragraph('Exhibit 3 - Buildings by Site'), new Table({ rows: [
    r(c('Bldg'), c('Name'), c('Gross SF'), c('Cleanable SF')), r(c('NORTH CAMPUS', 4)), r(c('101'), c('Admin Building'), c('10,000'), c('9,000')),
    r(c('SOUTH CAMPUS (OPTION)', 4)), r(c('201'), c('Gym'), c('30,000'), c('26,000')),
  ] })] }] });
  const lines = (await one('exhibit-3.docx', await Packer.toBuffer(doc))).text.split('\n');
  const h = lines.indexOf('Bldg | Name | Gross SF | Cleanable SF');
  assert.ok(h >= 0, lines.join('\n'));
  assert.deepEqual(lines.slice(h + 1, h + 5), ['NORTH CAMPUS', '101 | Admin Building | 10,000 | 9,000', 'SOUTH CAMPUS (OPTION)', '201 | Gym | 30,000 | 26,000']);
});

// ---------- zip packages: sniffing, damage, precedence ----------

async function smallDocx(text: string): Promise<Buffer> {
  return Packer.toBuffer(new Document({ sections: [{ children: [new Paragraph({ children: [new TextRun(text)] })] }] }));
}

test('ZIP: a package that stores its entries uncompressed is a package, whatever its first entry is', async () => {
  const pdf = facilityListPdf();
  const qa = await smallDocx('QUESTIONS AND ANSWERS. Q1. Is Bldg 5100 in scope? A1. No.');
  // Python's zipfile, `zip -0` and 7-Zip "store" put the inner files' bytes ("%PDF-", "word/document.xml") in the clear
  for (const order of [['W912QR Att J-4 Facility List.pdf', 'W912QR Q&A No 1.docx'], ['A Q&A No 1.docx', 'B Att J-4 Facility List.pdf']]) {
    const files = Object.fromEntries(order.map((n) => [n, [new Uint8Array(n.endsWith('.pdf') ? pdf : qa), { level: 0 }] as [Uint8Array, { level: 0 }]]));
    const z = Buffer.from(zipSync(files));
    assert.equal(sniffFormat('package.zip', z), 'zip', order.join(' + '));
    const docs = await readDocument('package.zip', z);
    const kinds = docs.filter((d) => d.text).map((d) => `${path.posix.basename(d.name)}:${d.kind}:${d.role}`).sort();
    assert.deepEqual(kinds, order.map((n) => `${n}:${n.endsWith('.pdf') ? 'pdf' : 'docx'}:${n.endsWith('.pdf') ? 'attachment' : 'qa'}`).sort());
  }
  // a real docx / xlsx is still recognised from its own part names
  assert.equal(sniffFormat('attachment.bin', qa), 'docx');
});

test('ZIP: a corrupt or password-protected entry is skipped on its own; the rest of the package is read', async () => {
  const csv = (bn: string) => strToU8(`Bldg,Facility Name,Gross SF\n${bn},Brigade Headquarters,45200\n`);
  const z = Buffer.from(zipSync({ 'J-4 Facility List.csv': csv('1201'), 'notes/readme.txt': strToU8('x'.repeat(5000)), 'J-5 Grounds.csv': csv('1205'), 'secret.txt': [strToU8('password inside'), { level: 0 }] }, { level: 6 }));
  const entries = zipEntries(z);
  const bad = entries.find((e) => e.name === 'notes/readme.txt')!;
  z[bad.dataOffset] = 0xff; // deflate block type 3: invalid
  const sec = entries.find((e) => e.name === 'secret.txt')!;
  z.writeUInt16LE(z.readUInt16LE(sec.localOffset + 6) | 1, sec.localOffset + 6); // general-purpose flag bit 0: encrypted
  const cd = z.indexOf(Buffer.from('secret.txt'), z.lastIndexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))) - 46;
  z.writeUInt16LE(z.readUInt16LE(cd + 8) | 1, cd + 8);
  const docs = await readDocument('package.zip', z);
  assert.deepEqual(docs.filter((d) => d.text).map((d) => d.name).sort(), ['package.zip/J-4 Facility List.csv', 'package.zip/J-5 Grounds.csv']);
  const w = docs.find((d) => d.name === 'package.zip (skipped entries)')?.warnings ?? [];
  assert.ok(w.some((x) => /notes\/readme\.txt: could not be extracted/.test(x)), w.join(' / '));
  assert.ok(w.some((x) => /secret\.txt: password-protected/.test(x)), w.join(' / '));
});

test('classify: the zip a document came in names the package, not the document', async () => {
  const files = {
    'W9124D-26-R-0019 Att J-0001 PWS Custodial Services TE-1.txt': strToU8('TECHNICAL EXHIBIT 1\nBldg | Facility Name | Gross SF\n1201 | Brigade Headquarters | 45,200'),
    'W9124D-26-R-0019 Questions and Answers No 1.txt': strToU8('QUESTIONS AND ANSWERS\nQ1. Is 1201 in scope? A1. Yes.'),
    'W9124D-26-R-0019 Amendment 0002.txt': strToU8('AMENDMENT 0002\nBldg 1201 is revised to 47,900 SF.'),
  };
  const roles = (docs: DocInput[]) => docs.filter((d) => d.text).map((d) => `${path.posix.basename(d.name)}=${d.role}${d.amendment ?? ''}`).sort();
  const want = ['W9124D-26-R-0019 Amendment 0002.txt=amendment2', 'W9124D-26-R-0019 Att J-0001 PWS Custodial Services TE-1.txt=attachment', 'W9124D-26-R-0019 Questions and Answers No 1.txt=qa'];
  const thru = await readDocument('W9124D-26-R-0019 RFP thru Amendment 0002.zip', Buffer.from(zipSync(files)));
  assert.deepEqual(roles(thru), want);
  assert.deepEqual(orderDocuments(thru.filter((d) => d.text)).map((d) => path.posix.basename(d.name)), ['W9124D-26-R-0019 Att J-0001 PWS Custodial Services TE-1.txt', 'W9124D-26-R-0019 Questions and Answers No 1.txt', 'W9124D-26-R-0019 Amendment 0002.txt']);
  // one folder wrapping every entry (zip -r) names the package too
  const wrapped = await readDocument('package.zip', Buffer.from(zipSync(Object.fromEntries(Object.entries(files).map(([n, b]) => [`Amendment 0002 posting/${n}`, b])))));
  assert.deepEqual(roles(wrapped), want);
  // ... but a document with no cue of its own takes the package's amendment number, and a folder inside the package counts
  const amd = await readDocument('Amendment 0003.zip', Buffer.from(zipSync({ 'Revised Facility List.csv': strToU8('Bldg,Gross SF\n1201,47900\n'), 'SF30.txt': strToU8('AMENDMENT OF SOLICITATION/MODIFICATION OF CONTRACT\n2. AMENDMENT/MODIFICATION NO. | 3. EFFECTIVE DATE\n0003 | 15 OCT 2026') })));
  assert.deepEqual(roles(amd), ['Revised Facility List.csv=amendment3', 'SF30.txt=amendment3']);
  const inner = await readDocument('package.zip', Buffer.from(zipSync({ 'Amendment 0004/J-4 Facility List.csv': strToU8('Bldg,Gross SF\n1201,47900\n'), 'PWS.txt': strToU8('PERFORMANCE WORK STATEMENT') })));
  assert.deepEqual(roles(inner), ['J-4 Facility List.csv=amendment4', 'PWS.txt=pws']);
  assert.deepEqual(classifyDocument({ name: 'pkg thru Amendment 0002.zip/Att J-0001 PWS.pdf', container: 'pkg thru Amendment 0002.zip' }), { role: 'attachment' });
});

test('XLSX: a worksheet too big to load whole is cut after the row limit before ExcelJS sees it', async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('RPI Extract');
  ws.addRow(['Campus', 'Facility No', 'Facility Name', 'Gross SF']);
  for (let i = 0; i < 3000; i++) ws.addRow([i < 3 ? 'Main Post' : 'North', `B${1000 + i}`, `Unique Name ${i}`, 1000 + i]);
  ws.mergeCells('A2:A4');
  ws.getRow(3).hidden = true;
  ws.getCell('C5').font = { strike: true };
  wb.addWorksheet('Notes').addRow(['See', 'Unique Name 2500']);
  const buf = Buffer.from(await wb.xlsx.writeBuffer({ useSharedStrings: true } as Partial<ExcelJS.XlsxWriteOptions>));
  const limits = { maxRows: 100, sheetFullLoadBytes: 1000, sharedStringsPruneBytes: 1000 };
  const shrunk = shrinkWorkbook(buf, limits);
  assert.deepEqual(shrunk?.cuts, [{ sheet: 'RPI Extract', keptRows: 100, totalRows: 3001 }]);
  const ss = Buffer.from(unzipSync(new Uint8Array(shrunk!.buf))['xl/sharedStrings.xml']).toString();
  assert.ok(ss.includes('>Unique Name 50<') && ss.includes('>Unique Name 2500<') && !ss.includes('>Unique Name 2400<'), 'only the strings the kept rows (and the other sheets) use are kept');
  const r = await extractXlsx(buf, 'rpi.xlsx', limits);
  const lines = r.text.split('\n');
  assert.ok(lines.includes('Campus | Facility No | Facility Name | Gross SF'));
  assert.ok(lines.includes('Main Post | B1002 | Unique Name 2 | 1002'), 'merged campus repeated');
  assert.ok(lines.includes('North | B1003 | ~~Unique Name 3~~ | 1003'));
  assert.ok(!lines.some((l) => l.includes('Unique Name 1 |')), 'hidden row skipped');
  assert.ok(lines.includes('North | B1098 | Unique Name 98 | 1098') && !r.text.includes('Unique Name 99 |'));
  assert.ok(r.notes.some((n) => /RPI Extract \(3001 rows × 4 columns; read 100 × 4\)/.test(n)), r.notes.join(' / '));
  assert.ok(r.notes.some((n) => /1 hidden rows skipped/.test(n)));
  // a small workbook is loaded untouched
  assert.equal(shrinkWorkbook(buf), null);
});

test.after(() => closeReaders());


// ---------- spreadsheets / CSV / DOCX ----------

test('XLSX: each visible sheet as pipe rows with plain numbers, merged header groups, merged campus repeated, hidden and struck rows handled', async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Facilities');
  ws.addRow(['Attachment J-4 Facility List']);
  ws.mergeCells('A1:E1');
  ws.addRow(['Campus', 'Bldg', 'Facility Name', 'Square Feet', '']);
  ws.mergeCells('D2:E2');
  ws.addRow(['', '', '', 'Gross', 'Cleanable']);
  ws.addRow(['Main Post', '0012', 'Brigade Headquarters', 45200, 38400]);
  ws.addRow(['', 'A-101', 'Battalion HQ Annex', 18750, 15900]);
  ws.mergeCells('A4:A5');
  ws.addRow(['North Annex', '0012', 'Dental Clinic', { formula: 'D4/4', result: 11300 }, 1.5e4]);
  ws.addRow(['North Annex', '0040', 'Old Warehouse', 9640, 0]);
  ws.getCell('C7').font = { strike: true };
  ws.addRow(['North Annex', '0099', 'Filtered Out Building', 1, 1]);
  ws.getRow(8).hidden = true;
  ws.addRow(['Escalation', '', '', 0.035, new Date(Date.UTC(2026, 8, 30))]);
  for (const c of ['D', 'E']) ws.getColumn(c).numFmt = '#,##0'; // thousands separators are display-only
  ws.getCell('D9').numFmt = '0.0%';
  ws.getCell('E9').numFmt = 'yyyy-mm-dd';
  const hidden = wb.addWorksheet('Lookups', { state: 'hidden' });
  hidden.addRow(['secret', 1]);
  const buf = Buffer.from(await wb.xlsx.writeBuffer());

  const d = await one('J-4.xlsx', buf);
  assert.equal(d.kind, 'xlsx');
  assert.equal(d.role, 'attachment');
  const lines = d.text.split('\n');
  assert.ok(lines[0].startsWith('=== J-4.xlsx :: sheet "Facilities"'), lines[0]);
  assert.ok(lines.includes('Attachment J-4 Facility List'));
  assert.ok(lines.includes('Campus | Bldg | Facility Name | Square Feet Gross | Square Feet Cleanable'));
  assert.ok(lines.includes('Main Post | 0012 | Brigade Headquarters | 45200 | 38400'), 'plain numbers, leading zeros kept');
  assert.ok(lines.includes('Main Post | A-101 | Battalion HQ Annex | 18750 | 15900'), 'vertically merged campus repeated');
  assert.ok(lines.includes('North Annex | 0012 | Dental Clinic | 11300 | 15000'), 'formula cached result');
  assert.ok(lines.includes('North Annex | 0040 | ~~Old Warehouse~~ | 9640 | 0'));
  assert.ok(lines.some((l) => l.startsWith('Escalation |') && l.includes('3.5%') && l.includes('2026-09-30')));
  assert.ok(!d.text.includes('Filtered Out Building') && !d.text.includes('secret'));
  assert.ok(d.warnings?.some((w) => /hidden sheets skipped: Lookups/.test(w)));
  assert.ok(d.warnings?.some((w) => /1 hidden rows skipped/.test(w)));
});

test('CSV / TSV: quoted cells, BOM and CRLF parsed into pipe rows with the numbers as written', async () => {
  const csv = '﻿Bldg,Facility Name,Gross SF,Notes\r\n1201,"Brigade Headquarters, North",45200,"He said ""daily"""\r\n1205,Battalion HQ,"18,750",\r\n\r\n';
  const d = await one('J-4 Facility List.csv', Buffer.from(csv));
  assert.equal(d.kind, 'csv');
  assert.deepEqual(d.text.split('\n'), ['Bldg | Facility Name | Gross SF | Notes', '1201 | Brigade Headquarters, North | 45200 | He said "daily"', '1205 | Battalion HQ | 18,750']);
  const tsv = await one('export.tsv', Buffer.from('Bldg\tName\tGross\n1201\tHQ | Annex\t45200\n'));
  assert.equal(tsv.text, 'Bldg | Name | Gross\n1201 | HQ / Annex | 45200');
  // delimited content without a telling extension is still parsed; a .txt stays text
  assert.equal(sniffFormat('download', Buffer.from('a,b,c\n1,2,3\n4,5,6\n')), 'csv');
  assert.equal(sniffFormat('notes.txt', Buffer.from('a,b,c\n1,2,3\n')), 'text');
  assert.equal(csvToRows('x;y;z\n1;2;3'), 'x | y | z\n1 | 2 | 3');
  // Excel "Unicode text" export (UTF-16LE with BOM) is decoded, not refused as binary
  const u16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('Bldg\tGross\r\n1201\t45200\r\n', 'utf16le')]);
  const ut = await one('facilities.tsv', u16);
  assert.equal(ut.text, 'Bldg | Gross\n1201 | 45200');
});

test('DOCX / binaries: a corrupt .docx, a legacy .doc and unknown binary data are reported instead of sent as text', async () => {
  const broken = await one('Exhibit A.docx', Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(200, 7)]));
  assert.equal(broken.text, '');
  assert.ok(broken.warnings?.some((w) => /could not be read/.test(w)));
  const ole = Buffer.alloc(512); ole.writeUInt32BE(0xd0cf11e0, 0); ole.writeUInt32BE(0xa1b11ae1, 4);
  const doc = await one('J-5 Wage Determination.doc', ole);
  assert.equal(doc.text, '');
  assert.ok(doc.warnings?.some((w) => /legacy Office/.test(w)));
  const bin = Buffer.from(Array.from({ length: 4096 }, (_, i) => (i * 131 + 7) % 256));
  const b = await one('facility-list.txt', bin);
  assert.equal(b.text, '');
  assert.ok(b.warnings?.some((w) => /binary/.test(w)));
});

// ---------- zip packages ----------

test('ZIP: nested zips expand, junk is ignored, legacy and CAD files are reported as skipped', async () => {
  const level3 = zipSync({ 'deep.txt': strToU8('too deep') });
  const level2 = zipSync({ 'J-6 Grounds.csv': strToU8('Area,Acres\nCantonment,42.5\n'), 'level3.zip': level3 });
  const attachments = zipSync({ 'J-4 Facility List.csv': strToU8('Bldg,Facility Name,Gross SF\n1201,Brigade Headquarters,45200\n'), 'J-5 Wage Determination.doc': strToU8('legacy'), 'more.zip': level2 });
  const pkg = Buffer.from(zipSync({
    'W912QR-26-R-0042/Solicitation PWS.txt': strToU8('PERFORMANCE WORK STATEMENT\nBldg | Facility Name | Gross SF\n1201 | Brigade Headquarters | 45,200'),
    'W912QR-26-R-0042/Attachments/attachments.zip': attachments,
    'W912QR-26-R-0042/Amendment 0001.txt': strToU8('AMENDMENT 0001\nBldg 1201 is revised to 47,900 SF.'),
    '__MACOSX/W912QR-26-R-0042/._Solicitation PWS.txt': strToU8('junk'),
    'W912QR-26-R-0042/.DS_Store': strToU8('junk'),
    'W912QR-26-R-0042/Thumbs.db': strToU8('junk'),
    'W912QR-26-R-0042/Site Map.dwg': strToU8('cad'),
  }));
  const docs = await readDocument('package.zip', pkg);
  const names = docs.map((d) => d.name);
  assert.ok(names.includes('package.zip/W912QR-26-R-0042/Solicitation PWS.txt'));
  assert.ok(names.includes('package.zip/W912QR-26-R-0042/Amendment 0001.txt'));
  assert.ok(names.includes('package.zip/W912QR-26-R-0042/Attachments/attachments/J-4 Facility List.csv'));
  assert.ok(names.includes('package.zip/W912QR-26-R-0042/Attachments/attachments/more/J-6 Grounds.csv'), 'zip nested two levels deep is expanded');
  assert.ok(!names.some((n) => /__MACOSX|DS_Store|Thumbs|deep\.txt/.test(n)), names.join(', '));
  const readable = docs.filter((d) => d.text);
  assert.equal(readable.length, 4);
  for (const d of readable) assert.equal(d.container, 'package.zip');
  const csv = readable.find((d) => d.name.endsWith('J-4 Facility List.csv'))!;
  assert.equal(csv.kind, 'csv');
  assert.equal(csv.role, 'attachment');
  assert.match(csv.text, /^1201 \| Brigade Headquarters \| 45200$/m);
  assert.equal(readable.find((d) => d.name.endsWith('Amendment 0001.txt'))!.amendment, 1);
  const skipped = docs.find((d) => d.name === 'package.zip (skipped entries)');
  assert.ok(skipped, 'skip report present');
  const w = skipped.warnings ?? [];
  assert.ok(w.some((x) => /J-5 Wage Determination\.doc: legacy/.test(x)), w.join(' / '));
  assert.ok(w.some((x) => /Site Map\.dwg: CAD drawing/.test(x)), w.join(' / '));
  assert.ok(w.some((x) => /level3\.zip: zip nested too deep/.test(x)), w.join(' / '));
  // precedence inside the package: base, attachments, then the amendment
  const order = orderDocuments(readable).map((d) => path.posix.basename(d.name));
  assert.deepEqual(order, ['Solicitation PWS.txt', 'J-4 Facility List.csv', 'J-6 Grounds.csv', 'Amendment 0001.txt']);
});

test('ZIP: a forged size header is refused before inflating, and so is an honest bomb', async () => {
  const z = Buffer.from(zipSync({ 'facilities.csv': new Uint8Array(8 * 2 ** 20) }, { level: 9 }));
  const cd = z.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])); z.writeUInt32LE(64, cd + 24);
  const lh = z.indexOf(Buffer.from([0x50, 0x4b, 0x03, 0x04])); z.writeUInt32LE(64, lh + 22);
  const r = expandZip(z, 'liar.zip');
  assert.equal(r.files.length, 0);
  assert.ok(r.skipped.some((s) => /forged/.test(s.reason)), JSON.stringify(r.skipped));
  const docs = await readDocument('liar.zip', z);
  assert.ok(docs.every((d) => !d.text));
  assert.ok(docs.some((d) => d.warnings?.some((x) => /forged/.test(x))));
  const bomb = Buffer.from(zipSync({ 'facilities.csv': new Uint8Array(24 * 2 ** 20) }, { level: 9 }));
  assert.ok(expandZip(bomb, 'bomb.zip').skipped.some((s) => /zip bomb/.test(s.reason)));
  assert.ok(expandZip(bomb, 'bomb.zip', { maxEntryBytes: 2 ** 20 }).skipped.some((s) => /per-file cap/.test(s.reason)));
  assert.ok(expandZip(Buffer.from('PK\u0003\u0004 not really a zip'), 'bad.zip').skipped.some((s) => /unreadable zip/.test(s.reason)));
});

// ---------- package roles and precedence ----------

test('classify / order: Amendment 0002 lands after the base PWS whatever the upload order', () => {
  const docs = {
    amend2: textDocument('Amendment 0002.txt', 'AMENDMENT 0002\nBldg 1201 gross area is revised to 47,900 SF.'),
    pws: textDocument('PWS.txt', 'PERFORMANCE WORK STATEMENT\nTECHNICAL EXHIBIT 3 — CUSTODIAL WORKLOAD'),
    att: textDocument('Attachment J-4 Facility List.txt', 'Bldg | Facility Name | Gross SF'),
    qa: textDocument('Questions and Answers.txt', 'Q1. Is Bldg 5100 in scope? A1. No.'),
    sf30: textDocument('doc-17.txt', 'AMENDMENT OF SOLICITATION/MODIFICATION OF CONTRACT\n2. AMENDMENT/MODIFICATION NO. | 3. EFFECTIVE DATE\n0001 | 15 OCT 2026'),
  };
  assert.deepEqual([docs.amend2.role, docs.amend2.amendment], ['amendment', 2]);
  assert.equal(docs.pws.role, 'pws');
  assert.equal(docs.att.role, 'attachment');
  assert.equal(docs.qa.role, 'qa');
  assert.deepEqual([docs.sf30.role, docs.sf30.amendment], ['amendment', 1]);
  const expected = ['PWS.txt', 'Attachment J-4 Facility List.txt', 'Questions and Answers.txt', 'doc-17.txt', 'Amendment 0002.txt'];
  const uploads = [
    [docs.amend2, docs.qa, docs.sf30, docs.att, docs.pws],
    [docs.pws, docs.att, docs.qa, docs.sf30, docs.amend2],
    [docs.sf30, docs.amend2, docs.pws, docs.qa, docs.att],
  ];
  for (const u of uploads) assert.deepEqual(orderDocuments(u).map((d) => d.name), expected);
  // documents read without a role are classified on the fly
  const bare: DocInput[] = [{ name: 'Amendment 0002 - Revised J-4.pdf', mode: 'text', text: '', chars: 0, bytes: 0 }, { name: 'pws.pdf', mode: 'text', text: '', chars: 0, bytes: 0 }];
  assert.deepEqual(orderDocuments(bare).map((d) => d.name), ['pws.pdf', 'Amendment 0002 - Revised J-4.pdf']);
});

test('classify: file-name and first-page cues', () => {
  const c = (name: string, text = '') => classifyDocument({ name, text });
  assert.deepEqual(c('W9124J-27-R-0031 Att 0003 - TE5 Facility List.pdf'), { role: 'attachment' });
  assert.deepEqual(c('Amendment 0001 – Facility List (revised).pdf'), { role: 'amendment', amendment: 1 });
  assert.deepEqual(c('W912QR26R0042 A0003.pdf'), { role: 'amendment', amendment: 3 });
  assert.deepEqual(c('Addendum No. 2.pdf'), { role: 'amendment', amendment: 2 });
  assert.deepEqual(c('package.zip/Amendment 0004/J-4.xlsx'), { role: 'amendment', amendment: 4 });
  assert.deepEqual(c('Q&A Set 1.pdf'), { role: 'qa' });
  assert.deepEqual(c('rfp-27031-custodial.pdf'), { role: 'solicitation' });
  assert.deepEqual(c('Section J Exhibit A.xlsx'), { role: 'attachment' });
  assert.deepEqual(c('scan001.pdf', '--- page 1 ---\nQUESTIONS AND ANSWERS\nQ1. ...'), { role: 'qa' });
  assert.deepEqual(c('scan002.pdf', '--- page 1 ---\nSECTION J – ATTACHMENT J-3\nFACILITY LIST'), { role: 'attachment' });
  assert.deepEqual(c('scan003.pdf', '--- page 1 ---\nAMENDMENT 0003 TO SOLICITATION W912QR-26-R-0042\n'), { role: 'amendment', amendment: 3 });
  assert.deepEqual(c('scan004.pdf', '--- page 1 ---\nSolicitation No. 47PC0326R0014 (Conformed through Amendment 0001)\n'), { role: 'amendment', amendment: 1 });
  // a base RFP whose schedule merely mentions an addendum stays the base document
  assert.deepEqual(c('city-rfp.pdf', '--- page 1 ---\nREQUEST FOR PROPOSALS\nDate of Issue | October 5, 2026\nAddendum No. 1 (answers to questions) | October 19, 2026'), { role: 'solicitation' });
  assert.deepEqual(c('notes.txt', 'meeting notes'), { role: 'other' });
});
