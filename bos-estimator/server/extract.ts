// Turns uploaded RFP files (PDF / DOCX / XLSX / CSV / TSV / TXT / MD / ZIP) into inputs the readers can read.
// The format is sniffed from magic bytes (users rename files; SAM.gov serves "attachment.bin"), not trusted from the name.
import path from 'node:path';
import type { DocumentRole } from '../shared/types';
import { extractPdfLayout, pdfParse } from './pdf-layout';
import { extractDocx } from './docx-tables';
import { extractXlsx } from './xlsx-extract';
import { expandZip } from './zip-expand';

export interface DocInput {
  name: string;
  mode: 'native_pdf' | 'text';
  /** Always populated. Layout-preserving: table rows as "cell | cell", "--- page N ---" markers, [^n] footnotes, ~~struck~~ text. */
  text: string;
  pdfBase64?: string; // populated when mode === 'native_pdf'
  pages?: number;
  chars: number;
  bytes: number;
  /** What was parsed: pdf, docx, xlsx (one doc per workbook, sheets marked "=== file :: sheet ==="), csv, text. */
  kind?: 'pdf' | 'docx' | 'xlsx' | 'csv' | 'text';
  /** Package role and amendment number; documents are ordered base → attachments → Q&A → amendments (ascending) before reading. */
  role?: DocumentRole;
  amendment?: number;
  /** 1-based pages with no usable text layer (scanned images). */
  scannedPages?: number[];
  warnings?: string[];
  /** Name of the zip the file came from, if any. */
  container?: string;
}

export type IngestMode = 'auto' | 'native_pdf' | 'text';

const NATIVE_PDF_MAX_PAGES = 100;
const NATIVE_PDF_MAX_BYTES = 28 * 1024 * 1024;
/** Scanned pages can only be read natively; the API's own page limit still applies. */
const NATIVE_PDF_SCANNED_MAX_PAGES = 600;

export function cleanText(t: string): string {
  return t.replace(/^﻿/, '').replace(/\u0000/g, '').replace(/\r\n?/g, '\n').replace(/[ \t\f\v]+\n/g, '\n').replace(/\n{4,}/g, '\n\n\n').trim();
}

// ---------- format sniffing ----------
type Sniffed = 'pdf' | 'docx' | 'xlsx' | 'zip' | 'ole' | 'office-other' | 'csv' | 'text' | 'binary';
const TEXT_EXT = /\.(txt|md|markdown|json|html?|xml)$/i;

function decodeText(buf: Buffer): string {
  if (buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString('utf16le'); // Excel "Unicode text" exports
  if (buf[0] === 0xfe && buf[1] === 0xff) { const b = Buffer.from(buf.subarray(2)); b.swap16(); return b.toString('utf16le'); }
  return buf.toString('utf8').replace(/^﻿/, '');
}

/** What the bytes are, regardless of the file name (the name only breaks ties for text and damaged OOXML). */
export function sniffFormat(name: string, buf: Buffer): Sniffed {
  if (buf.subarray(0, 1024).includes(Buffer.from('%PDF-'))) return 'pdf';
  if (buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && (buf[2] === 0x03 || buf[2] === 0x05)) {
    // OOXML parts are named in the local headers (start) and the central directory (end)
    const names = buf.subarray(0, Math.min(buf.length, 64 * 1024)).toString('latin1') + buf.subarray(Math.max(0, buf.length - 256 * 1024)).toString('latin1');
    if (/word\/document\.xml/.test(names)) return 'docx';
    if (/xl\/workbook\.xml/.test(names)) return 'xlsx';
    if (/ppt\/presentation\.xml|mimetypeapplication\/vnd\.oasis/.test(names)) return 'office-other';
    if (/\.docx$/i.test(name)) return 'docx';
    if (/\.xls[xm]$/i.test(name)) return 'xlsx';
    return 'zip';
  }
  if (buf.length >= 4 && buf.readUInt32BE(0) === 0xd0cf11e0) return 'ole';
  const utf16 = (buf[0] === 0xff && buf[1] === 0xfe) || (buf[0] === 0xfe && buf[1] === 0xff);
  const sample = utf16 ? decodeText(buf.subarray(0, 16384)) : buf.subarray(0, 8192).toString('utf8');
  if (!sample.length) return 'text';
  if (!utf16 && sample.includes('\u0000')) return 'binary';
  const printable = (sample.match(/[^\u0000-\u0008\u000e-\u001f�]/g)?.length ?? 0) / sample.length;
  if (printable < 0.9) return 'binary';
  if (/\.(csv|tsv|tab)$/i.test(name)) return 'csv';
  if (TEXT_EXT.test(name)) return 'text';
  // no telling extension: delimited if the first lines all carry the same number (>= 2) of commas or tabs
  const head = sample.split(/\r?\n/).filter((l) => l.trim()).slice(0, 6);
  const counts = (re: RegExp) => head.map((l) => l.match(re)?.length ?? 0);
  for (const re of [/\t/g, /,/g]) { const c = counts(re); if (head.length >= 2 && c.every((n) => n >= 2) && c.every((n) => n === c[0])) return 'csv'; }
  return 'text';
}

/** Parse CSV / TSV (RFC 4180 quoting) into "cell | cell" rows. Pipes inside cells become "/" so columns stay stable. */
export function csvToRows(text: string, delimiter?: ',' | '\t' | ';'): string {
  const first = text.split('\n', 1)[0] ?? '';
  const n = (c: string) => first.split(c).length - 1;
  const delim = delimiter ?? (n('\t') > n(',') && n('\t') >= n(';') ? '\t' : n(';') > n(',') ? ';' : ',');
  const rows: string[][] = []; let row: string[] = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
    else if (c === '"' && !cell.trim()) q = true;
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows
    .filter((r) => r.some((c) => c.trim()))
    .map((r) => r.map((c) => c.replace(/\s+/g, ' ').replace(/\|/g, '/').trim()).join(' | ').replace(/(\s\|\s*)+$/, ''))
    .join('\n');
}

/** "3, 4, 5, 9" -> "3-5, 9" */
const pageRanges = (p: number[]): string => p.reduce<string[]>((acc, n, i) => { if (i && n === p[i - 1] + 1) acc[acc.length - 1] = acc[acc.length - 1].replace(/-\d+$/, '') + `-${n}`; else acc.push(String(n)); return acc; }, []).join(', ');

// ---------- package roles and precedence ----------
const FIRST_PAGE_CHARS = 4000;
const firstPage = (text: string): string => { const t = text.replace(/^--- page 1 ---\n?/, ''); const i = t.indexOf('--- page 2 ---'); return (i >= 0 ? t.slice(0, i) : t).slice(0, FIRST_PAGE_CHARS); };
const AMEND_NO = /(?:^|[^a-z])(?:amendment|amend|amdt|amd|addendum)(?:\s*\/\s*modification)?[\s_.#-]*(?:no\.?|number|nr\.?)?[\s_.#:-]*(\d{1,4})(?!\d)/i;
/** An amendment / addendum heading line ("AMENDMENT 0002 TO SOLICITATION …", "Addendum No. 1"): not a table row, and not a
 *  schedule or index entry that merely mentions one ("Amendment 0001 issued | …", "… incorporated as Section 6"). */
const HEAD_AMEND = /^[^|\n]{0,60}?(?:^|[^a-z])(?:amendment|addendum)\s*(?:no\.?|number|#)?\s*[:.]?\s*(\d{1,4})(?![0-9])[^|\n]{0,60}$/im;
const HEAD_AMEND_NOT = /issued|due\b|incorporat|bound|acknowledg|attached|see\s/i;
const CONFORMED = /conformed\s+(?:copy\s+)?(?:through|thru|incorporating|to\s+include|with)\s+amendments?\s*(?:no\.?\s*)?(\d{1,4})/i;
const AMEND_CODE = /(?:^|[^A-Za-z0-9])A(0\d{3})(?![0-9])/; // SAM.gov file names: "... A0002.pdf"
const QA_RE = /questions?\s*(?:and|&)\s*answers?|(?:^|[^a-z])q\s*&\s*a(?:[^a-z]|$)|(?:^|[^a-z])q&as?(?:[^a-z]|$)|responses?\s+to\s+(?:industry\s+|vendor\s+|offeror\s+|bidder\s+)?(?:questions|inquiries|rfis?)|(?:^|[^a-z])rfi\s+responses?/i;
const ATTACH_NAME = /(?:^|[^a-z])(?:attachment|attachments|att|attch|exhibit|annex|appendix|enclosure|encl)(?:[^a-z]|$)|(?:^|[^a-z0-9])j[-_. ]?\d{1,4}(?:[^0-9]|$)|(?:^|[^a-z0-9])te[-_ ]?\d{1,2}(?:[^0-9]|$)|section[-_ ]j(?:[^a-z]|$)/i;
const ATTACH_HEAD = /^\s*(?:section\s+j\b.{0,40}attachment|attachment\s+(?:j[-.\s]?)?[a-z0-9-]{1,8}\b|technical\s+exhibit\s+\d|exhibit\s+[a-z0-9-]{1,6}\b|appendix\s+[a-z0-9-]{1,4}\b|annex\s+[a-z0-9-]{1,4}\b)/im;
const PWS_RE = /(?:^|[^a-z])(?:pws|sow|soo)(?:[^a-z]|$)|performance\s+work\s+statement|statement\s+of\s+(?:work|objectives)/i;
const SOL_RE = /solicitation|(?:^|[^a-z])(?:rfp|rfq|ifb|itb|rfi)(?:[^a-z]|$)|request\s+for\s+(?:proposals?|quotes?|quotations?)|invitation\s+(?:for|to)\s+bid|sf[-_ ]?(?:1449|33|18|1442)|combined\s+synopsis/i;

/** Package role and amendment number from the file name and first-page cues ("AMENDMENT OF SOLICITATION",
 *  "Amendment 0002", "Questions and Answers", "Attachment J-…"). Amendment cues win: a revised attachment
 *  issued with Amendment 0002 ranks as Amendment 0002 so its values supersede the base. */
export function classifyDocument(doc: string | { name: string; text?: string }, textArg?: string): { role: DocumentRole; amendment?: number } {
  const name = typeof doc === 'string' ? doc : doc.name;
  const text = typeof doc === 'string' ? textArg ?? '' : doc.text ?? '';
  const base = path.posix.basename(name.replace(/\\/g, '/')).replace(/\.[a-z0-9]{1,5}$/i, '');
  const dir = name.replace(/\\/g, '/').split('/').slice(0, -1).join('/');
  const page1 = firstPage(text);
  const head = page1.slice(0, 1200);
  const num = (m: RegExpMatchArray | null) => (m ? Number(m[1]) : undefined);
  // 1. amendment number in the file name (or the zip folder it came from)
  const nameNo = num(base.match(AMEND_NO)) ?? num(base.match(AMEND_CODE)) ?? num(dir.match(AMEND_NO));
  if (nameNo != null && nameNo > 0) return { role: 'amendment', amendment: nameNo };
  // 2. SF-30 "AMENDMENT OF SOLICITATION/MODIFICATION OF CONTRACT", or an amendment / addendum heading on page 1
  const headLine = head.match(HEAD_AMEND);
  const headNo = headLine && !HEAD_AMEND_NOT.test(headLine[0]) ? num(headLine) : undefined;
  if (/amendment\s+of\s+solicitation\s*\/?\s*modification\s+of\s+contract/i.test(page1)) {
    // block 2 "AMENDMENT/MODIFICATION NO." holds the zero-padded number (0002), usually on the next table row
    const at = page1.search(/amendment\s*\/\s*modification\s+(?:no|number)/i);
    const sf30No = at >= 0 ? num(page1.slice(at, at + 300).match(/(?:^|[^0-9])(0\d{3})(?![0-9])/)) : undefined;
    return { role: 'amendment', amendment: sf30No ?? headNo };
  }
  if (headNo != null && headNo > 0) return { role: 'amendment', amendment: headNo };
  // a conformed copy incorporates the amendments it names, so it supersedes them
  const conformed = num(page1.match(CONFORMED));
  if (conformed != null && conformed > 0) return { role: 'amendment', amendment: conformed };
  // 3. file name cues
  if (QA_RE.test(base)) return { role: 'qa' };
  if (ATTACH_NAME.test(base)) return { role: 'attachment' };
  if (PWS_RE.test(base)) return { role: 'pws' };
  if (SOL_RE.test(base)) return { role: 'solicitation' };
  // 4. first-page headings
  if (QA_RE.test(head)) return { role: 'qa' };
  if (ATTACH_HEAD.test(head)) return { role: 'attachment' };
  if (PWS_RE.test(head)) return { role: 'pws' };
  if (SOL_RE.test(head)) return { role: 'solicitation' };
  if (/^\s*(?:amendment|addendum)\b/im.test(head)) return { role: 'amendment' };
  return { role: 'other' };
}

const ROLE_RANK: Record<DocumentRole, number> = { solicitation: 0, pws: 0, other: 0, attachment: 1, qa: 2, amendment: 3 };

/** Precedence order: base solicitation / PWS → attachments → Q&A → amendments by number (ascending), so later
 *  documents win. Upload order is kept within a rank; documents without a role are classified on the fly. */
export function orderDocuments<T extends DocInput>(docs: T[]): T[] {
  const keyed = docs.map((d, i) => {
    const c = d.role ? { role: d.role, amendment: d.amendment } : classifyDocument(d);
    return { d, i, rank: ROLE_RANK[c.role] ?? 0, amend: c.role === 'amendment' ? c.amendment ?? Number.MAX_SAFE_INTEGER : 0 };
  });
  keyed.sort((a, b) => a.rank - b.rank || a.amend - b.amend || a.i - b.i);
  return keyed.map((k) => k.d);
}

// ---------- reading ----------
function textDoc(name: string, bytes: number, text: string, kind: DocInput['kind'], extra: Partial<DocInput> = {}): DocInput {
  const t = cleanText(text);
  return { name, mode: 'text', text: t, chars: t.length, bytes, kind, ...extra };
}

async function readPdf(name: string, buf: Buffer, ingest: IngestMode): Promise<DocInput> {
  const warnings: string[] = [];
  let text = ''; let pages: number | undefined; let scannedPages: number[] = [];
  try {
    const r = await extractPdfLayout(buf);
    text = cleanText(r.text); pages = r.numpages; scannedPages = r.scannedPages;
    const bad = r.pages.filter((p) => p.error).map((p) => p.page);
    if (bad.length) warnings.push(`pages ${pageRanges(bad)} could not be laid out and were left out of the text`);
  } catch (err) {
    try {
      const parsed = await pdfParse(buf);
      text = cleanText(parsed.text); pages = parsed.numpages;
      warnings.push(`table layout could not be recovered (${(err as Error).message}); plain text used, so table columns may run together`);
    } catch (err2) {
      warnings.push(`PDF could not be parsed (${(err2 as Error).message}); encrypted or damaged?`);
      pages = undefined;
    }
  }
  const nPages = pages ?? 0;
  const fitsNative = nPages > 0 && nPages <= NATIVE_PDF_MAX_PAGES && buf.length <= NATIVE_PDF_MAX_BYTES;
  const scannedNative = scannedPages.length > 0 && nPages <= NATIVE_PDF_SCANNED_MAX_PAGES && buf.length <= NATIVE_PDF_MAX_BYTES;
  const noText = !text.replace(/--- page \d+ ---/g, '').replace(/\s+/g, '');
  const useNative = ingest !== 'text' && buf.length <= NATIVE_PDF_MAX_BYTES && (ingest === 'native_pdf' || fitsNative || scannedNative || (noText && pages == null));
  if (scannedPages.length) {
    warnings.push(`${scannedPages.length} of ${nPages} pages are scanned images (pages ${pageRanges(scannedPages)}): ${useNative ? 'sent to Claude as page images; the rule-based reader cannot read them' : 'NOT readable in text mode - split them out or OCR them'}`);
  } else if (noText) {
    if (!warnings.length) warnings.push(useNative ? 'no text layer: sent to Claude as page images; the rule-based reader cannot read it' : 'no text layer found; nothing to read in text mode');
    else if (useNative) warnings.push('sent to Claude as a native PDF in case it can read it; the rule-based reader cannot');
  }
  return { name, mode: useNative ? 'native_pdf' : 'text', text, pdfBase64: useNative ? buf.toString('base64') : undefined, pages, chars: text.length, bytes: buf.length, kind: 'pdf', scannedPages, warnings };
}

async function readOne(name: string, buf: Buffer, ingest: IngestMode, container: string | undefined, depth: number): Promise<DocInput[]> {
  const fail = (msg: string, kind?: DocInput['kind']): DocInput[] => [textDoc(name, buf.length, '', kind, { warnings: [msg] })];
  if (!buf.length) return fail('empty file');
  switch (sniffFormat(name, buf)) {
    case 'pdf': return [await readPdf(name, buf, ingest)];
    case 'docx': {
      try { const r = await extractDocx(buf); return [textDoc(name, buf.length, r.text, 'docx', { warnings: r.warnings.length ? r.warnings : undefined })]; }
      catch (err) { return fail(`Word document could not be read (${(err as Error).message}); damaged or password-protected?`, 'docx'); }
    }
    case 'xlsx': {
      try { const r = await extractXlsx(buf, path.posix.basename(name)); return [textDoc(name, buf.length, r.text, 'xlsx', { warnings: r.notes.length ? r.notes : undefined })]; }
      catch (err) { return fail(`Workbook could not be read (${(err as Error).message}); damaged or password-protected? Save it as .xlsx and upload again`, 'xlsx'); }
    }
    case 'zip': {
      if (depth > 0) return fail('nested zip skipped');
      const z = expandZip(buf, name);
      const out: DocInput[] = [];
      for (const f of z.files) {
        try { for (const d of await readOne(f.name, f.buffer, ingest, container ?? name, depth + 1)) { d.container ??= container ?? name; out.push(d); } }
        catch (err) { out.push(textDoc(f.name, f.buffer.length, '', undefined, { container: container ?? name, warnings: [`unreadable: ${(err as Error).message}`] })); }
      }
      if (z.skipped.length || !out.length) out.push(textDoc(`${name} (skipped entries)`, 0, '', undefined, { role: 'other', container: container ?? name, warnings: z.skipped.length ? z.skipped.map((s) => `${s.name}: ${s.reason}`) : ['the zip holds no readable documents'] }));
      return out;
    }
    case 'ole': return fail('legacy Office file (.doc / .xls / .ppt / .msg): save it as .docx / .xlsx / .pdf and upload it again');
    case 'office-other': return fail('PowerPoint / OpenDocument files are not supported: save it as .pdf, .docx or .xlsx and upload it again');
    case 'binary': return fail('not a readable document (binary data); skipped instead of sending it to the model as text');
    case 'csv': return [textDoc(name, buf.length, csvToRows(decodeText(buf), /\.(tsv|tab)$/i.test(name) ? '\t' : undefined), 'csv')];
    default: return [textDoc(name, buf.length, decodeText(buf), 'text')];
  }
}

/** Read one uploaded file. A zip yields one document per readable entry (nested zips to depth 2) plus a
 *  "(skipped entries)" record listing what was left out and why. Unreadable content never throws: it comes back as
 *  a document with empty text and a warning. Every document carries its package role and amendment number. */
export async function readDocument(name: string, buf: Buffer, ingest: IngestMode = 'auto'): Promise<DocInput[]> {
  const docs = await readOne(name, buf, ingest, undefined, 0);
  for (const d of docs) {
    if (d.container && d.container === d.name) delete d.container;
    if (!d.role) { const c = classifyDocument(d); d.role = c.role; if (c.amendment != null) d.amendment = c.amendment; }
    if (d.warnings && !d.warnings.length) delete d.warnings;
  }
  return docs;
}

/** A pasted-text document (classified like an uploaded one). */
export function textDocument(name: string, text: string): DocInput {
  const d = textDoc(name, Buffer.byteLength(text), text, 'text');
  const c = classifyDocument(d); d.role = c.role; if (c.amendment != null) d.amendment = c.amendment;
  return d;
}
