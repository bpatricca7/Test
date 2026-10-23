// Turns uploaded RFP files (PDF / DOCX / XLSX / CSV / TSV / TXT / MD / ZIP) into inputs the readers can read.
// The format is sniffed from magic bytes (users rename files; SAM.gov serves "attachment.bin"), not trusted from the name.
//
// PDF, Word and Excel files are parsed in a worker thread with its own heap limit and a time limit: a hostile or
// broken file (a JPEG pdf.js cannot decode in Node, a circular page tree, a page count of three million, a workbook
// that does not fit in memory) costs that one file, never the server process and the other uploads in flight.
import path from 'node:path';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import type { DocumentRole } from '../shared/types';
import type { PdfLayoutResult, PdfPhase, PdfTextResult } from './pdf-layout';
import type { DocxResult } from './docx-tables';
import type { XlsxResult } from './xlsx-extract';
import { expandZip, zipEntries, zipNames } from './zip-expand';

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

const PK = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

/** docx / xlsx / other Office / plain zip, from the archive's own entry names (never from raw bytes: a package that
 *  stores its entries uncompressed carries the inner files' bytes, "%PDF-" and "word/document.xml" included, verbatim). */
function zipKind(name: string, buf: Buffer): Sniffed {
  let names = zipNames(buf);
  if (!names.length) { try { names = zipEntries(buf).map((e) => e.name); } catch { names = []; } }
  const has = (n: string) => names.includes(n);
  if (has('word/document.xml')) return 'docx';
  if (has('xl/workbook.xml')) return 'xlsx';
  if (has('ppt/presentation.xml') || (has('mimetype') && has('content.xml'))) return 'office-other';
  // a damaged Office file: let its own reader explain what is wrong with it
  if ((!names.length || has('[Content_Types].xml')) && /\.docx$/i.test(name)) return 'docx';
  if ((!names.length || has('[Content_Types].xml')) && /\.xls[xm]$/i.test(name)) return 'xlsx';
  return 'zip';
}

/** What the bytes are, regardless of the file name (the name only breaks ties for text and damaged OOXML). */
export function sniffFormat(name: string, buf: Buffer): Sniffed {
  // zip family first: local file header, empty archive, or spanned-archive marker at offset 0
  if (buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && ((buf[2] === 3 && buf[3] === 4) || (buf[2] === 5 && buf[3] === 6) || (buf[2] === 7 && buf[3] === 8))) return zipKind(name, buf);
  const head = buf.subarray(0, 1024);
  const pdfAt = head.indexOf('%PDF-'), pkAt = head.indexOf(PK);
  if (pdfAt >= 0 && (pkAt < 0 || pdfAt < pkAt)) return 'pdf';
  if (pkAt > 0) { const k = zipKind(name, buf); if (k !== 'zip' || zipNames(buf).length) return k; } // self-extracting / prefixed zip
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
  const lines = sample.split(/\r?\n/).filter((l) => l.trim()).slice(0, 6);
  const counts = (re: RegExp) => lines.map((l) => l.match(re)?.length ?? 0);
  for (const re of [/\t/g, /,/g]) { const c = counts(re); if (lines.length >= 2 && c.every((n) => n >= 2) && c.every((n) => n === c[0])) return 'csv'; }
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

/** Where a document sits in an uploaded package. */
export interface PackageScope {
  /** folders INSIDE the archive ("Amendment 0004/Revised"), which say something about this one document */
  folders?: string;
  /** what the whole package is called (the zip's name, plus a single top folder that wraps every entry): it says
   *  nothing about an individual document ("… RFP thru Amendment 0002.zip" holds the base PWS too), so it is only
   *  used for a document that has no cue of its own */
  label?: string;
}
const PACKAGE_RANGE = /\b(?:thru|through|incl\.?|including|conformed|to\s+date|and\s+prior|[0-9]{1,4}\s*-\s*[0-9]{1,4})\b/i;

/** Package role and amendment number from the file name and first-page cues ("AMENDMENT OF SOLICITATION",
 *  "Amendment 0002", "Questions and Answers", "Attachment J-…"). Amendment cues win: a revised attachment
 *  issued with Amendment 0002 (by its name, or by a folder inside the package) ranks as Amendment 0002 so its values
 *  supersede the base. The zip a document came in (`container`) is not one of its folders. */
export function classifyDocument(doc: string | { name: string; text?: string; container?: string }, textArg?: string, scope?: PackageScope): { role: DocumentRole; amendment?: number } {
  const name = (typeof doc === 'string' ? doc : doc.name).replace(/\\/g, '/');
  const text = typeof doc === 'string' ? textArg ?? '' : doc.text ?? '';
  const container = typeof doc === 'string' ? undefined : doc.container?.replace(/\\/g, '/');
  const base = path.posix.basename(name).replace(/\.[a-z0-9]{1,5}$/i, '');
  const inner = container && name.startsWith(`${container}/`) ? name.slice(container.length + 1) : name;
  const dir = scope?.folders ?? inner.split('/').slice(0, -1).join('/');
  const label = scope?.label ?? (container ? path.posix.basename(container).replace(/\.zip$/i, '') : undefined);
  const own = classifyOwn(base, dir, text);
  if ((own.role === 'other' || (own.role === 'amendment' && own.amendment == null)) && label && !PACKAGE_RANGE.test(label)) {
    const n = label.match(AMEND_NO)?.[1] ?? label.match(AMEND_CODE)?.[1];
    if (n != null && Number(n) > 0) return { role: 'amendment', amendment: Number(n) };
  }
  return own;
}

function classifyOwn(base: string, dir: string, text: string): { role: DocumentRole; amendment?: number } {
  const page1 = firstPage(text);
  const head = page1.slice(0, 1200);
  const num = (m: RegExpMatchArray | null) => (m ? Number(m[1]) : undefined);
  // 1. amendment number in the file name (or a folder inside the package)
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

// ---------- isolated parsing (worker threads) ----------
type ParseOp = 'pdf-layout' | 'pdf-text' | 'docx' | 'xlsx';
interface ParseResults { 'pdf-layout': PdfLayoutResult; 'pdf-text': PdfTextResult; docx: DocxResult; xlsx: XlsxResult }
type Beat = (page: number, pages: number, phase: PdfPhase) => void;
interface ParseOptions { maxPages?: number }
interface WorkerJob { id: number; op: ParseOp; name: string; data: Uint8Array; opts: ParseOptions }
type WorkerReply =
  | { ready: true }
  | { id: number; beat: true; page: number; pages: number; phase: PdfPhase }
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; name: string; message: string };

/** The parsers themselves (loaded on first use, so the main thread never loads pdf.js / ExcelJS / mammoth when isolated). */
async function runParse(op: ParseOp, data: Uint8Array, name: string, beat: Beat, opts: ParseOptions = {}): Promise<unknown> {
  const buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  switch (op) {
    case 'pdf-layout': return (await import('./pdf-layout')).extractPdfLayout(buf, { onPage: beat, maxPages: opts.maxPages });
    case 'pdf-text': return (await import('./pdf-layout')).extractPdfText(buf, { onPage: beat, maxPages: opts.maxPages });
    case 'docx': return (await import('./docx-tables')).extractDocx(buf);
    case 'xlsx': return (await import('./xlsx-extract')).extractXlsx(buf, name);
  }
}

const WORKER_ROLE = 'bos-estimator:document-reader';
const env = (k: string, d: number) => { const raw = process.env[k]; const v = Number(raw); return raw != null && raw !== '' && Number.isFinite(v) ? v : d; };
/** Reader limits (read when used, so they can be tuned per process or per test). */
const limits = () => ({
  /** BOS_READER_WORKERS=0 parses in-process (no isolation) */
  pool: Math.max(0, Math.min(8, env('BOS_READER_WORKERS', 2))),
  heapMb: env('BOS_READER_HEAP_MB', 1024),
  /** no progress (a PDF reports every page) for this long means the parser is stuck */
  stallMs: env('BOS_READER_STALL_MS', 180_000),
  /** loading one page from the page tree takes milliseconds; this long means a cycle in the tree (pdf.js walks it forever) */
  pageLoadMs: env('BOS_READER_PAGE_LOAD_MS', 30_000),
  jobMs: env('BOS_READER_TIMEOUT_MS', 10 * 60_000),
});
const KEEP_ALIVE_MS = 30_000;

/** The worker died or stopped responding (as opposed to the parser reporting an error). */
export class ReaderCrash extends Error {
  override name = 'ReaderCrash';
  /** the PDF page being worked on, and whether it was being loaded (a broken page tree) or laid out */
  constructor(message: string, readonly page?: number, readonly phase?: PdfPhase) { super(message); }
}
class ReaderStartError extends Error {}

interface Slot { w: Worker; busy: boolean; ready: Promise<void>; keep?: NodeJS.Timeout }
const slots = new Set<Slot>();
const waiting: ((s: Slot) => void)[] = [];
let isolation: boolean | undefined; // undefined: not tried yet
let jobSeq = 0;

/** The worker runs this module. Under tsx (the server's runtime) the worker's imports need tsx's resolver, which a
 *  worker does not inherit: a tiny bootstrap registers it first. Compiled JavaScript is started directly. */
function workerEntry(): URL {
  const self = import.meta.url;
  if (!/\.[cm]?tsx?$/.test(new URL(self).pathname)) return new URL(self);
  let api: string;
  try { api = import.meta.resolve('tsx/esm/api'); } catch { return new URL(self); }
  const boot = `import { register } from ${JSON.stringify(api)};\nregister();\nawait import(${JSON.stringify(self)});\n`;
  return new URL(`data:text/javascript,${encodeURIComponent(boot)}`);
}

function spawn(): Slot {
  const w = new Worker(workerEntry(), { workerData: { role: WORKER_ROLE }, resourceLimits: { maxOldGenerationSizeMb: limits().heapMb, stackSizeMb: 8 } });
  const ready = new Promise<void>((resolve, reject) => {
    const done = () => { w.off('message', onMsg); w.off('error', onErr); w.off('exit', onExit); };
    const onMsg = (m: WorkerReply) => { if ('ready' in m) { done(); resolve(); } };
    const onErr = (e: Error) => { done(); reject(new ReaderStartError(e.message)); };
    const onExit = (code: number) => { done(); reject(new ReaderStartError(`exited with code ${code}`)); };
    w.on('message', onMsg); w.on('error', onErr); w.on('exit', onExit);
  });
  ready.catch(() => undefined);
  const slot: Slot = { w, busy: true, ready };
  w.on('exit', () => { slots.delete(slot); clearTimeout(slot.keep); });
  w.on('error', () => undefined); // reported to the job that was running; never an uncaught error here
  return slot;
}

async function acquire(): Promise<Slot> {
  for (const s of slots) if (!s.busy) { s.busy = true; clearTimeout(s.keep); s.w.ref(); return s; }
  if (slots.size < Math.max(1, limits().pool)) { const s = spawn(); slots.add(s); return s; }
  return new Promise((resolve) => waiting.push(resolve));
}
function release(s: Slot): void {
  const next = waiting.shift();
  if (next) { next(s); return; }
  s.busy = false; s.w.unref(); // an idle reader never keeps the process alive
  s.keep = setTimeout(() => { slots.delete(s); void s.w.terminate(); }, KEEP_ALIVE_MS); s.keep.unref();
}
function discard(s: Slot): void {
  slots.delete(s); clearTimeout(s.keep); void s.w.terminate();
  const next = waiting.shift();
  if (next) { const n = spawn(); slots.add(n); next(n); }
}

function runOn(slot: Slot, op: ParseOp, data: Uint8Array, name: string, beat?: Beat, opts: ParseOptions = {}): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const id = ++jobSeq; const w = slot.w; const lim = limits();
    let stall: NodeJS.Timeout | undefined; let at: { page: number; phase: PdfPhase } | undefined;
    const settle = (fn: () => void) => { clearTimeout(stall); clearTimeout(total); w.off('message', onMsg); w.off('error', onErr); w.off('exit', onExit); fn(); };
    const crash = (msg: string) => settle(() => reject(new ReaderCrash(at ? `${msg} on page ${at.page}` : msg, at?.page, at?.phase)));
    const arm = (ms = lim.stallMs) => { clearTimeout(stall); stall = setTimeout(() => crash(at?.phase === 'load' ? `the page did not load within ${Math.round(ms / 1000)} s (a loop in the page tree?)` : `the reader stopped making progress for ${Math.round(ms / 1000)} s`), ms); };
    const total = setTimeout(() => crash(`reading took longer than ${Math.round(lim.jobMs / 60000)} minutes`), lim.jobMs);
    const onMsg = (m: WorkerReply) => {
      if ('ready' in m || m.id !== id) return;
      if ('beat' in m) { at = { page: m.page, phase: m.phase }; arm(m.phase === 'load' ? lim.pageLoadMs : lim.stallMs); beat?.(m.page, m.pages, m.phase); return; }
      settle(() => (m.ok ? resolve(m.result) : reject(Object.assign(new Error(m.message), { name: m.name }))));
    };
    const onErr = (e: Error & { code?: string }) => crash(e.code === 'ERR_WORKER_OUT_OF_MEMORY' ? `the reader ran out of memory (limit ${lim.heapMb} MB)` : `the reader crashed (${e.message})`);
    const onExit = (code: number) => crash(`the reader stopped (exit code ${code})`);
    w.on('message', onMsg); w.on('error', onErr); w.on('exit', onExit);
    const copy = new Uint8Array(data); // an exact copy, moved (not cloned) into the worker
    w.postMessage({ id, op, name, data: copy, opts } satisfies WorkerJob, [copy.buffer]);
    arm();
  });
}

/** Run one parser on one file, isolated. Throws the parser's own error, or a ReaderCrash when the worker died. */
async function isolated<O extends ParseOp>(op: O, data: Uint8Array, name: string, beat?: Beat, opts: ParseOptions = {}): Promise<ParseResults[O]> {
  if (isolation === false || limits().pool === 0) return (await runParse(op, data, name, beat ?? (() => undefined), opts)) as ParseResults[O];
  const slot = await acquire();
  try { await slot.ready; }
  catch (err) {
    discard(slot);
    if (isolation === undefined) { // the worker cannot start here at all (e.g. a runtime without worker support): read in-process
      isolation = false;
      console.warn(`[extract] isolated document reader unavailable (${(err as Error).message}); parsing in-process`);
      return (await runParse(op, data, name, beat ?? (() => undefined), opts)) as ParseResults[O];
    }
    throw new ReaderCrash(`the reader could not start (${(err as Error).message})`);
  }
  isolation = true;
  try {
    const r = await runOn(slot, op, data, name, beat, opts);
    release(slot);
    return r as ParseResults[O];
  } catch (err) {
    if (err instanceof ReaderCrash) discard(slot); else release(slot);
    throw err;
  }
}

/** Stop idle readers now (tests, scripts); busy ones finish their file first. */
export async function closeReaders(): Promise<void> {
  await Promise.all([...slots].filter((s) => !s.busy).map((s) => { slots.delete(s); clearTimeout(s.keep); return s.w.terminate(); }));
}

// worker side: this same module, started by spawn()
if (!isMainThread && parentPort && (workerData as { role?: unknown } | null)?.role === WORKER_ROLE) {
  const port = parentPort;
  port.on('message', (m: WorkerJob) => {
    void (async () => {
      try {
        const result = await runParse(m.op, m.data, m.name, (page, pages, phase) => port.postMessage({ id: m.id, beat: true, page, pages, phase } satisfies WorkerReply), m.opts);
        port.postMessage({ id: m.id, ok: true, result } satisfies WorkerReply);
      } catch (err) {
        const e = err as { name?: unknown; message?: unknown };
        port.postMessage({ id: m.id, ok: false, name: typeof e?.name === 'string' ? e.name : 'Error', message: typeof e?.message === 'string' ? e.message : String(err) } satisfies WorkerReply);
      }
    })();
  });
  port.postMessage({ ready: true } satisfies WorkerReply);
}

// ---------- reading ----------
function textDoc(name: string, bytes: number, text: string, kind: DocInput['kind'], extra: Partial<DocInput> = {}): DocInput {
  const t = cleanText(text);
  return { name, mode: 'text', text: t, chars: t.length, bytes, kind, ...extra };
}

export interface ReadOptions {
  /** progress while a long document is read (PDFs report every page) */
  onProgress?: (p: { name: string; page: number; pages: number }) => void;
}

const errText = (err: unknown) => (err as Error)?.message || String(err);
const isPassword = (err: unknown) => (err as Error)?.name === 'PasswordException' || /no password given|incorrect password/i.test(errText(err));
/** Text and CSV files past this are cut (a facility list is never this big; the readers could not use more). */
const MAX_TEXT_BYTES = 64 * 2 ** 20;

async function readPdf(name: string, buf: Buffer, ingest: IngestMode, opts: ReadOptions): Promise<DocInput> {
  const warnings: string[] = [];
  const beat: Beat = (page, pages, phase) => { if (phase === 'done') opts.onProgress?.({ name, page, pages }); };
  let text = ''; let pages: number | undefined; let scannedPages: number[] = [];
  /** pdf.js opened the file and read its pages; a damaged one (pages that do not load, a page count it cannot hold) is
   *  never sent to Claude as a PDF: the API rejects an invalid PDF together with every other document of the request */
  let opened = false; let damaged = false; let reason = '';
  const pageCount = (stop: PdfLayoutResult['stop'], numpages: number, lastLoaded: number) => (stop && stop.kind !== 'cap' ? lastLoaded : numpages);
  try {
    let r: PdfLayoutResult; let cut: ReaderCrash | undefined;
    try { r = await isolated('pdf-layout', buf, name, beat); }
    catch (err) {
      // a page that cannot even be loaded (a loop in the page tree) would stop the plain-text pass the same way:
      // read the pages before it again, and report the rest
      if (!(err instanceof ReaderCrash && err.phase === 'load' && err.page != null && err.page > 1)) throw err;
      cut = err;
      r = await isolated('pdf-layout', buf, name, beat, { maxPages: err.page - 1 });
    }
    if (cut) {
      r.text = r.text.replace(/\n*--- pages \d+-\d+ --- \(not read: only the first \d+ pages are read\)$/, '');
      r.warnings.push(`pages ${cut.page}-${r.numpages} were not read: ${cut.message}`);
      r.stop = { from: cut.page!, kind: 'failures', reason: cut.message };
      r.text += `\n\n--- pages ${cut.page}-${r.numpages} --- (not read: ${cut.message})`;
      r.warnings = r.warnings.filter((w) => !/^pages \d+-\d+ were not read: only the first/.test(w));
    }
    opened = true;
    text = cleanText(r.text); scannedPages = r.scannedPages;
    const unloadable = r.pages.filter((p) => p.error === 'page could not be loaded').map((p) => p.page);
    const unlaid = r.pages.filter((p) => p.error && p.error !== 'page could not be loaded').map((p) => p.page);
    pages = pageCount(r.stop, r.numpages, Math.max(0, ...r.pages.filter((p) => p.error !== 'page could not be loaded').map((p) => p.page)));
    if (unloadable.length) warnings.push(`pages ${pageRanges(unloadable)} could not be loaded (damaged pages)`);
    if (unlaid.length) warnings.push(`pages ${pageRanges(unlaid)} could not be laid out and were left out of the text`);
    warnings.push(...r.warnings);
    damaged = r.loadFailures > 0 || (r.stop != null && r.stop.kind !== 'cap');
  } catch (err) {
    if (isPassword(err)) reason = 'password-protected PDF: remove the password (or print it to a new PDF) and upload it again';
    else if (err instanceof ReaderCrash && err.phase === 'load') reason = `PDF could not be read (${errText(err)}); the file is damaged. Re-save it (print to PDF) and upload it again`;
    else {
      try {
        const r = await isolated('pdf-text', buf, name, beat);
        opened = true;
        text = cleanText(r.text);
        pages = pageCount(r.stop, r.numpages, r.pagesRead - r.loadFailures);
        warnings.push(`table layout could not be recovered (${errText(err)}); plain text used, so table columns may run together`, ...r.warnings);
        damaged = r.loadFailures > 0 || (r.stop != null && r.stop.kind !== 'cap');
      } catch (err2) {
        reason = isPassword(err2) ? 'password-protected PDF: remove the password (or print it to a new PDF) and upload it again' : `PDF could not be read (${errText(err2)}); damaged or not really a PDF? Re-save it (print to PDF) and upload it again`;
      }
    }
  }
  if (!opened) warnings.push(`${reason}. It was not sent to Claude either (the API rejects an unreadable PDF together with the rest of the request)`);
  const nPages = pages ?? 0;
  const healthy = opened && !damaged;
  const fitsNative = nPages > 0 && nPages <= NATIVE_PDF_MAX_PAGES;
  const scannedNative = scannedPages.length > 0 && nPages <= NATIVE_PDF_SCANNED_MAX_PAGES;
  const noText = !text.replace(/--- pages? \d+(?:-\d+)? ---[^\n]*/g, '').replace(/\s+/g, '');
  const noTextNative = noText && nPages > 0 && nPages <= NATIVE_PDF_SCANNED_MAX_PAGES;
  const useNative = ingest !== 'text' && healthy && buf.length <= NATIVE_PDF_MAX_BYTES && (ingest === 'native_pdf' || fitsNative || scannedNative || noTextNative);
  const notNativeWhy = !healthy && opened ? ' (the file is damaged, so it was not sent to Claude as a PDF: re-save it with "print to PDF" and upload it again)' : '';
  if (scannedPages.length) {
    warnings.push(`${scannedPages.length} of ${nPages} pages are scanned images (pages ${pageRanges(scannedPages)}): ${useNative ? 'sent to Claude as page images; the rule-based reader cannot read them' : `NOT readable in text mode - split them out or OCR them${notNativeWhy}`}`);
  } else if (noText && opened) {
    warnings.push(useNative ? 'no text layer: sent to Claude as page images; the rule-based reader cannot read it' : `no text layer found; nothing to read in text mode${notNativeWhy}`);
  } else if (notNativeWhy && ingest === 'native_pdf') warnings.push(`read as text${notNativeWhy}`);
  return { name, mode: useNative ? 'native_pdf' : 'text', text: opened ? text : '', pdfBase64: useNative ? buf.toString('base64') : undefined, pages, chars: opened ? text.length : 0, bytes: buf.length, kind: 'pdf', scannedPages, warnings };
}

async function readOne(name: string, buf: Buffer, ingest: IngestMode, container: string | undefined, depth: number, opts: ReadOptions): Promise<DocInput[]> {
  const fail = (msg: string, kind?: DocInput['kind']): DocInput[] => [textDoc(name, buf.length, '', kind, { warnings: [msg] })];
  const crashNote = (err: unknown) => (err instanceof ReaderCrash ? ' (the file is too large or too damaged to read safely)' : '');
  if (!buf.length) return fail('empty file');
  const format = sniffFormat(name, buf);
  switch (format) {
    case 'pdf': return [await readPdf(name, buf, ingest, opts)];
    case 'docx': {
      try { const r = await isolated('docx', buf, name); return [textDoc(name, buf.length, r.text, 'docx', { warnings: r.warnings.length ? r.warnings : undefined })]; }
      catch (err) { return fail(`Word document could not be read (${errText(err)})${crashNote(err)}; damaged or password-protected?`, 'docx'); }
    }
    case 'xlsx': {
      try { const r = await isolated('xlsx', buf, path.posix.basename(name)); return [textDoc(name, buf.length, r.text, 'xlsx', { warnings: r.notes.length ? r.notes : undefined })]; }
      catch (err) { return fail(`Workbook could not be read (${errText(err)})${crashNote(err)}; damaged or password-protected? Save it as .xlsx and upload again`, 'xlsx'); }
    }
    case 'zip': {
      if (depth > 0) return fail('nested zip skipped');
      const z = expandZip(buf, name);
      // folders inside the package say something about a document; the zip's own name (and one folder wrapping every
      // entry, as "zip -r" makes) only names the package
      const rel = z.files.map((f) => f.name.slice(name.length + 1).split('/'));
      const tops = new Set(rel.map((r) => (r.length > 1 ? r[0] : '')));
      const wrapper = tops.size === 1 && !tops.has('') ? [...tops][0] : '';
      const label = [path.posix.basename(name.replace(/\\/g, '/')).replace(/\.zip$/i, ''), wrapper].filter(Boolean).join('/');
      const out: DocInput[] = [];
      for (const f of z.files) {
        const folders = f.name.slice(name.length + 1).split('/').slice(wrapper ? 1 : 0, -1).join('/');
        let docs: DocInput[];
        try { docs = await readOne(f.name, f.buffer, ingest, container ?? name, depth + 1, opts); }
        catch (err) { docs = [textDoc(f.name, f.buffer.length, '', undefined, { warnings: [`unreadable: ${errText(err)}`] })]; }
        for (const d of docs) {
          d.container ??= container ?? name;
          if (!d.role) { const c = classifyDocument(d, undefined, { folders, label }); d.role = c.role; if (c.amendment != null) d.amendment = c.amendment; }
          out.push(d);
        }
      }
      if (z.skipped.length || !out.length) out.push(textDoc(`${name} (skipped entries)`, 0, '', undefined, { role: 'other', container: container ?? name, warnings: z.skipped.length ? z.skipped.map((s) => `${s.name}: ${s.reason}`) : ['the zip holds no readable documents'] }));
      return out;
    }
    case 'ole': return fail('legacy Office file (.doc / .xls / .ppt / .msg): save it as .docx / .xlsx / .pdf and upload it again');
    case 'office-other': return fail('PowerPoint / OpenDocument files are not supported: save it as .pdf, .docx or .xlsx and upload it again');
    case 'binary': return fail('not a readable document (binary data); skipped instead of sending it to the model as text');
    case 'csv': case 'text': default: {
      const cut = buf.length > MAX_TEXT_BYTES;
      const t = decodeText(cut ? buf.subarray(0, MAX_TEXT_BYTES) : buf);
      const warn = cut ? { warnings: [`only the first ${MAX_TEXT_BYTES / 2 ** 20} MB of this ${Math.round(buf.length / 2 ** 20)} MB file were read`] } : {};
      return format === 'csv'
        ? [textDoc(name, buf.length, csvToRows(t, /\.(tsv|tab)$/i.test(name) ? '\t' : undefined), 'csv', warn)]
        : [textDoc(name, buf.length, t, 'text', warn)];
    }
  }
}

/** Read one uploaded file. A zip yields one document per readable entry (nested zips to depth 2) plus a
 *  "(skipped entries)" record listing what was left out and why. Unreadable content never throws (and never takes the
 *  process down: PDF / Word / Excel parsing runs isolated): it comes back as a document with empty text and a
 *  warning. Every document carries its package role and amendment number. */
export async function readDocument(name: string, buf: Buffer, ingest: IngestMode = 'auto', opts: ReadOptions = {}): Promise<DocInput[]> {
  const docs = await readOne(name, buf, ingest, undefined, 0, opts);
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
