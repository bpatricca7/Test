import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import { zipSync, strToU8 } from 'fflate';
import { classifyDocument, csvToRows, orderDocuments, readDocument, sniffFormat, textDocument, type DocInput } from '../server/extract';
import { extractPdfLayout } from '../server/pdf-layout';
import { expandZip } from '../server/zip-expand';
import type { FixtureTruth } from './harness/truth';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(here, 'fixtures');

// ---------- helpers ----------

/** Minimal hand-written PDF (standard Helvetica, nothing embedded): text runs, filled rules, a full-page image, /Rotate. */
interface PdfText { x: number; y: number; size?: number; str: string }
interface PdfPageSpec { texts?: PdfText[]; rects?: { x: number; y: number; w: number; h: number }[]; image?: boolean; rotate?: number }
function makePdf(pages: PdfPageSpec[]): Buffer {
  const objs: (string | Buffer)[] = [];
  const add = (body: string | Buffer) => { objs.push(body); return objs.length; };
  const esc = (s: string) => s.replace(/([()\\])/g, '\\$1');
  const catalog = add(''); const pagesObj = add('');
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const img = add(Buffer.concat([Buffer.from('<< /Type /XObject /Subtype /Image /Width 2 /Height 2 /ColorSpace /DeviceGray /BitsPerComponent 8 /Length 4 >>\nstream\n'), Buffer.from([0x80, 0xff, 0xff, 0x80]), Buffer.from('\nendstream')]));
  const kids: number[] = [];
  for (const p of pages) {
    const ops: string[] = [];
    if (p.image) ops.push('q 612 0 0 792 0 0 cm /Im1 Do Q');
    for (const r of p.rects ?? []) ops.push(`${r.x} ${r.y} ${r.w} ${r.h} re f`);
    for (const t of p.texts ?? []) ops.push(`BT /F1 ${t.size ?? 10} Tf 1 0 0 1 ${t.x} ${t.y} Tm (${esc(t.str)}) Tj ET`);
    const content = ops.join('\n');
    const c = add(`<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 612 792]${p.rotate ? ` /Rotate ${p.rotate}` : ''} /Resources << /Font << /F1 ${font} 0 R >> /XObject << /Im1 ${img} 0 R >> >> /Contents ${c} 0 R >>`));
  }
  objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
  objs[pagesObj - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
  const parts: Buffer[] = [Buffer.from('%PDF-1.4\n')]; const offsets: number[] = []; let len = parts[0].length;
  objs.forEach((o, i) => { const b = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`), Buffer.isBuffer(o) ? o : Buffer.from(o, 'latin1'), Buffer.from('\nendobj\n')]); offsets.push(len); parts.push(b); len += b.length; });
  parts.push(Buffer.from(`xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${len}\n%%EOF\n`));
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

test('PDF: a damaged file is reported, not thrown', async () => {
  const d = await one('broken.pdf', Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ngarbage'));
  assert.ok(d.warnings?.length, 'a warning explains the failure');
});

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
