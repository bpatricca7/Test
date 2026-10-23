// XLSX -> text, one block per visible sheet, rows as "cell | cell" with header-aware flattening.
//  - numbers as plain numbers (45200, not "45,200" or 4.52E+04); percents as "15%"; dates as YYYY-MM-DD
//  - formulas -> cached result (exceljs never calculates; a formula without a cached result is flagged)
//  - merged cells: vertical merges repeat the value down (a "Campus" column merged over 40 rows applies to each
//    row); horizontal merges in header rows become group labels prefixed onto each sub-column
//  - hidden sheets / rows / columns are left out and reported (hidden rows are often filtered-out / excluded
//    buildings); strike-through cells are wrapped in ~~ ~~ (deleted by amendment)
//  - size: ExcelJS builds the whole workbook in memory (about 0.5 KB per cell), so a worksheet whose XML is too big
//    to load is cut after maxRows rows BEFORE ExcelJS sees it (streamed, the rest is never held in memory), and the
//    shared strings only those rows use are kept.
import ExcelJS from 'exceljs';
import { Inflate, zipSync, type Zippable } from 'fflate';
import { inflateEntry, zipEntries, type ZipEntry } from './zip-expand';

const MAX_COLS = 60;
export interface XlsxLimits {
  /** rows read per sheet */
  maxRows: number;
  /** worksheets whose XML is larger than this are cut at maxRows rows before loading (20k rows of a 20-column export ≈ 16 MB) */
  sheetFullLoadBytes: number;
  /** never keep more than this much of one worksheet's XML, whatever the row count */
  sheetHeadMaxBytes: number;
  /** shared strings larger than this are pruned to the strings the kept rows use */
  sharedStringsPruneBytes: number;
}
export const XLSX_LIMITS: XlsxLimits = { maxRows: 20000, sheetFullLoadBytes: 32 * 2 ** 20, sheetHeadMaxBytes: 48 * 2 ** 20, sharedStringsPruneBytes: 16 * 2 ** 20 };
/** Declared uncompressed sizes past these are a zip bomb or not a facility list. */
const MAX_DECLARED_TOTAL = 2 * 2 ** 30, MAX_INFLATE_ENTRY = 512 * 2 ** 20;

const richText = (v: unknown): string | undefined => {
  if (v && typeof v === 'object' && 'richText' in v && Array.isArray((v as { richText: unknown }).richText)) return ((v as { richText: { text?: string }[] }).richText).map((r) => r.text ?? '').join('');
  return undefined;
};

function cellText(cell: ExcelJS.Cell): { t: string; noCachedValue: boolean } {
  let v: unknown = cell.value; let noCachedValue = false;
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    const o = v as Record<string, unknown>;
    if ('formula' in o || 'sharedFormula' in o) {
      const res = o.result;
      if (res === undefined || res === null) { noCachedValue = true; v = ''; }
      else v = typeof res === 'object' && !(res instanceof Date) && 'error' in (res as object) ? (res as { error: string }).error : res;
    } else if ('richText' in o) v = richText(o) ?? '';
    else if ('text' in o && 'hyperlink' in o) v = typeof o.text === 'object' ? richText(o.text) ?? '' : o.text;
    else if ('error' in o) v = o.error;
  }
  let t: string;
  if (v == null) t = '';
  else if (v instanceof Date) t = Number.isNaN(v.getTime()) ? '' : v.toISOString().slice(0, 10);
  else if (typeof v === 'number') { const fmt = String(cell.numFmt ?? ''); t = /%/.test(fmt) ? `${+(v * 100).toFixed(4)}%` : String(+v.toFixed(6)); }
  else if (typeof v === 'boolean') t = v ? 'TRUE' : 'FALSE';
  else t = String(v);
  t = t.replace(/[\r\n\t]+/g, ' ').replace(/\|/g, '/').replace(/\s+/g, ' ').trim();
  if (t && cell.font?.strike) t = `~~${t}~~`;
  return { t, noCachedValue };
}

// ---------- oversized worksheets ----------
const ROW_END = Buffer.from('</row>'), SHEET_DATA_END = Buffer.from('</sheetData>');

/** Stream-inflate a worksheet, keeping its first `maxRows` rows (and at most `headMax` bytes) plus everything
 *  after </sheetData> (merges, which the kept rows need). Returns null when the sheet has no more rows than that. */
function cutSheet(zip: Uint8Array, e: ZipEntry, maxRows: number, headMax: number): { xml: Buffer; keptRows: number; totalRows: number } | null {
  if (e.encrypted || e.dataOffset < 0 || e.dataOffset + e.size > zip.length || (e.method !== 8 && e.method !== 0)) return null;
  const head: Buffer[] = []; let headBytes = 0; let rows = 0; let cut = false;
  let tail: Buffer[] | null = null; let tailBytes = 0;
  let carry = Buffer.alloc(0); // bytes of the previous chunk that may hold the start of a split marker
  let extraRows = 0; let ended = false;
  const onChunk = (chunk: Uint8Array) => {
    if (ended) return; // the sheet fits: everything after </sheetData> is irrelevant
    let buf = Buffer.concat([carry, Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength)]);
    if (!cut) {
      let at = 0;
      for (;;) {
        const i = buf.indexOf(ROW_END, at);
        if (i < 0) break;
        const end = i + ROW_END.length;
        if (headBytes + end > headMax && rows > 0) { cut = true; head.push(buf.subarray(0, at)); headBytes += at; buf = buf.subarray(at); break; }
        rows++; at = end;
        if (rows >= maxRows) { cut = true; head.push(buf.subarray(0, end)); headBytes += end; buf = buf.subarray(end); break; }
      }
      if (!cut) {
        // keep complete rows; carry the unfinished one (it may straddle the next chunk)
        const sd = buf.indexOf(SHEET_DATA_END, at);
        if (sd >= 0) { ended = true; carry = Buffer.alloc(0); return; }
        head.push(buf.subarray(0, at)); headBytes += at; carry = Buffer.from(buf.subarray(at));
        if (carry.length > headMax) { cut = true; carry = Buffer.alloc(0); } // a single absurd row
        return;
      }
    }
    if (tail) { tail.push(Buffer.from(buf)); tailBytes += buf.length; carry = Buffer.alloc(0); return; }
    // skipping: count the rows we drop, look for the end of the row data
    const sd = buf.indexOf(SHEET_DATA_END);
    const scanTo = sd >= 0 ? sd : Math.max(0, buf.length - SHEET_DATA_END.length);
    for (let i = buf.indexOf(ROW_END); i >= 0 && i < scanTo; i = buf.indexOf(ROW_END, i + 1)) extraRows++;
    if (sd >= 0) { tail = [Buffer.from(buf.subarray(sd))]; tailBytes = buf.length - sd; carry = Buffer.alloc(0); }
    else carry = Buffer.from(buf.subarray(scanTo));
  };
  if (e.method === 0) onChunk(zip.subarray(e.dataOffset, e.dataOffset + e.size));
  else {
    const inf = new Inflate((chunk) => onChunk(chunk));
    const raw = zip.subarray(e.dataOffset, e.dataOffset + e.size);
    for (let p = 0; p < raw.length; p += 2 ** 20) inf.push(raw.subarray(p, Math.min(raw.length, p + 2 ** 20)), p + 2 ** 20 >= raw.length);
  }
  if (!cut) return null;
  const headXml = Buffer.concat(head);
  const dim = /<dimension\s+ref="[A-Z]+\d+:[A-Z]+(\d+)"/.exec(headXml.subarray(0, 4096).toString('latin1'));
  const totalRows = Math.max(rows + extraRows, dim ? Number(dim[1]) : 0);
  // merges and the rest of the sheet; a tail that is absurdly big (or missing) is replaced by a plain close
  const tailXml = tail && tailBytes <= headMax ? Buffer.concat(tail) : Buffer.from('</sheetData></worksheet>');
  return { xml: Buffer.concat([headXml, tailXml]), keptRows: rows, totalRows };
}

/** Blank every shared string the kept rows do not use (indexes stay valid, memory drops to what is used). */
function pruneSharedStrings(xml: Buffer, used: Set<number>): Buffer {
  const SI = Buffer.from('<si>'), SI_END = Buffer.from('</si>'), SI_EMPTY = Buffer.from('<si/>'), BLANK = Buffer.from('<si><t></t></si>');
  const out: Buffer[] = []; let copied = 0; let at = 0; let idx = 0;
  for (;;) {
    const a = xml.indexOf(SI, at), b = xml.indexOf(SI_EMPTY, at);
    if (a < 0 && b < 0) break;
    if (b >= 0 && (a < 0 || b < a)) { idx++; at = b + SI_EMPTY.length; continue; }
    const end = xml.indexOf(SI_END, a);
    if (end < 0) break;
    if (!used.has(idx)) { out.push(xml.subarray(copied, a), BLANK); copied = end + SI_END.length; }
    idx++; at = end + SI_END.length;
  }
  out.push(xml.subarray(copied));
  return Buffer.concat(out);
}

const SHEET_FILE = /^xl\/worksheets\/sheet\d+\.xml$/;
/** Shared-string indexes a worksheet's cells use (<c t="s"><v>n</v></c>). */
function sharedStringRefs(xml: Uint8Array, into: Set<number>): void {
  const s = Buffer.from(xml.buffer, xml.byteOffset, xml.byteLength).toString('latin1');
  for (const m of s.matchAll(/<c\b((?:[^>/]|\/(?!>))*)>([\s\S]*?)<\/c>/g)) {
    if (!/\bt="s"/.test(m[1])) continue;
    const v = /<v>\s*(\d+)\s*<\/v>/.exec(m[2]);
    if (v) into.add(Number(v[1]));
  }
}

interface Shrunk { buf: Buffer; cuts: { sheet: string; keptRows: number; totalRows: number }[] }

/** Cut worksheets too big for ExcelJS to load whole; null when nothing needs cutting (the original is loaded). */
export function shrinkWorkbook(buf: Buffer, limits: Partial<XlsxLimits> = {}): Shrunk | null {
  const lim: XlsxLimits = { ...XLSX_LIMITS, ...limits };
  let entries: ZipEntry[];
  try { entries = zipEntries(buf); } catch { return null; } // let ExcelJS report the damage
  const declared = entries.reduce((n, e) => n + e.originalSize, 0);
  if (declared > MAX_DECLARED_TOTAL) throw new Error(`the workbook declares ${(declared / 2 ** 30).toFixed(1)} GB of content (zip bomb?)`);
  const big = entries.filter((e) => SHEET_FILE.test(e.name) && e.originalSize > lim.sheetFullLoadBytes);
  if (!big.length) return null;
  // sheet file -> sheet name (workbook.xml + its rels), for the report
  const text = (name: string) => { const e = entries.find((x) => x.name === name); try { return e && e.originalSize < 4 * 2 ** 20 ? Buffer.from(inflateEntry(buf, e)).toString('utf8') : ''; } catch { return ''; } };
  const rels = new Map<string, string>();
  for (const m of text('xl/_rels/workbook.xml.rels').matchAll(/<Relationship\b[^>]*>/g)) { const id = /\bId="([^"]+)"/.exec(m[0])?.[1], t = /\bTarget="([^"]+)"/.exec(m[0])?.[1]; if (id && t) rels.set(id, t.replace(/^\/?(xl\/)?/, 'xl/')); }
  const sheetName = new Map<string, string>();
  for (const m of text('xl/workbook.xml').matchAll(/<sheet\b[^>]*>/g)) { const n = /\bname="([^"]*)"/.exec(m[0])?.[1], id = /\br:id="([^"]+)"/.exec(m[0])?.[1]; const file = id && rels.get(id); if (n != null && file) sheetName.set(file, n.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")); }
  const replaced = new Map<string, Uint8Array>(); const cuts: Shrunk['cuts'] = [];
  for (const e of big) {
    const c = cutSheet(buf, e, lim.maxRows, lim.sheetHeadMaxBytes);
    if (!c) continue;
    replaced.set(e.name, c.xml);
    cuts.push({ sheet: sheetName.get(e.name) ?? e.name, keptRows: c.keptRows, totalRows: c.totalRows });
  }
  if (!cuts.length) return null;
  const data = new Map<string, Uint8Array>();
  for (const e of entries) {
    if (e.name.endsWith('/')) continue;
    const r = replaced.get(e.name);
    if (r) { data.set(e.name, r); continue; }
    if (e.originalSize > MAX_INFLATE_ENTRY) { if (SHEET_FILE.test(e.name) || e.name === 'xl/sharedStrings.xml') throw new Error(`${e.name} is too large to read`); continue; }
    try { data.set(e.name, inflateEntry(buf, e)); } catch (err) { if (SHEET_FILE.test(e.name)) throw err; }
  }
  // shared strings: keep only the ones the (cut and whole) worksheets use
  const ss = data.get('xl/sharedStrings.xml');
  if (ss && ss.length > lim.sharedStringsPruneBytes) {
    const used = new Set<number>();
    for (const [n, x] of data) if (SHEET_FILE.test(n)) sharedStringRefs(x, used);
    data.set('xl/sharedStrings.xml', pruneSharedStrings(Buffer.from(ss.buffer, ss.byteOffset, ss.byteLength), used));
  }
  const files: Zippable = {};
  for (const [n, x] of data) files[n] = [x, { level: 0 }];
  return { buf: Buffer.from(zipSync(files)), cuts };
}

interface Merge { top: number; left: number; bottom: number; right: number }
export interface XlsxReport { hiddenSheets: string[]; hiddenRows: number; hiddenCols: number; formulaNoValue: number; truncated: string[]; sheets: { name: string; rows: number; cols: number }[] }
export interface XlsxResult { text: string; report: XlsxReport; notes: string[] }

export async function extractXlsx(buf: Buffer, name = 'workbook.xlsx', limits: Partial<XlsxLimits> = {}): Promise<XlsxResult> {
  const MAX_ROWS = limits.maxRows ?? XLSX_LIMITS.maxRows;
  const shrunk = shrinkWorkbook(buf, limits);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load((shrunk?.buf ?? buf) as unknown as ArrayBuffer);
  const out: string[] = [];
  const report: XlsxReport = { hiddenSheets: [], hiddenRows: 0, hiddenCols: 0, formulaNoValue: 0, truncated: [], sheets: [] };
  for (const ws of wb.worksheets) {
    if (ws.state && ws.state !== 'visible') { report.hiddenSheets.push(`${ws.name} (${ws.state})`); continue; }
    const nCols = Math.min(ws.columnCount, MAX_COLS);
    const pre = shrunk?.cuts.find((c) => c.sheet === ws.name);
    if (pre) report.truncated.push(`${ws.name} (${pre.totalRows} rows × ${ws.columnCount} columns; read ${pre.keptRows} × ${nCols})`);
    else if (ws.columnCount > MAX_COLS || ws.rowCount > MAX_ROWS) report.truncated.push(`${ws.name} (${ws.rowCount} rows × ${ws.columnCount} columns; read ${Math.min(ws.rowCount, MAX_ROWS)} × ${nCols})`);
    const hiddenCol = new Set<number>(); for (let c = 1; c <= nCols; c++) if (ws.getColumn(c).hidden) hiddenCol.add(c);
    report.hiddenCols += hiddenCol.size;
    // merge ranges, indexed by cell
    const mergeIdx = new Map<number, Merge>();
    const key = (r: number, c: number) => r * 100000 + c;
    const merges = (ws.model as { merges?: string[] }).merges ?? [];
    for (const ref of merges) {
      const [a, b] = ref.split(':'); if (!a || !b) continue;
      const ca = ws.getCell(a), cb = ws.getCell(b);
      const m: Merge = { top: Number(ca.row), left: Number(ca.col), bottom: Math.min(Number(cb.row), MAX_ROWS), right: Math.min(Number(cb.col), nCols) };
      for (let r = m.top; r <= m.bottom; r++) for (let c = m.left; c <= m.right; c++) mergeIdx.set(key(r, c), m);
    }
    const grid: { cells: string[]; spans: { from: number; to: number; text: string }[] }[] = [];
    const last = Math.min(ws.rowCount, MAX_ROWS);
    for (let r = 1; r <= last; r++) {
      const row = ws.getRow(r);
      if (row.hidden) { if (row.cellCount) report.hiddenRows++; continue; }
      const cells: string[] = []; const spans: { from: number; to: number; text: string }[] = [];
      for (let c = 1; c <= nCols; c++) {
        if (hiddenCol.has(c)) continue;
        const m = mergeIdx.get(key(r, c));
        if (m && (m.top !== r || m.left !== c)) {
          cells.push(m.left === c && m.top !== r ? cellText(ws.getCell(m.top, m.left)).t : ''); // vertical merge: repeat down
          continue;
        }
        const { t, noCachedValue } = cellText(row.getCell(c));
        if (noCachedValue) report.formulaNoValue++;
        if (m && m.right > m.left) spans.push({ from: cells.length, to: cells.length + (m.right - m.left), text: t });
        cells.push(t);
      }
      grid.push({ cells, spans });
    }
    // drop empty rows / trailing empty columns
    const rows = grid.filter((g) => g.cells.some(Boolean));
    if (!rows.length) continue;
    const width = Math.max(...rows.map((g) => { let w = g.cells.length; while (w && !g.cells[w - 1]) w--; return w; }));
    // header: first row with >= 3 non-empty texty cells, extended down while rows have no numbers
    const isNum = (t: string) => /^-?\d[\d.]*%?$/.test(t);
    let h0 = rows.findIndex((g) => g.cells.filter((t) => t && !isNum(t)).length >= Math.min(3, width));
    const lines = [`=== ${name} :: sheet "${ws.name}" (${rows.length} rows) ===`];
    if (h0 < 0) h0 = 0;
    for (const g of rows.slice(0, h0)) lines.push(g.cells.filter(Boolean).join(' ')); // title / preamble rows
    let h1 = h0;
    while (h1 + 1 < rows.length && !rows[h1 + 1].cells.some(isNum) && rows[h1 + 1].cells.filter(Boolean).length >= 2 && h1 - h0 < 3) h1++;
    const head: string[][] = Array.from({ length: width }, () => []);
    for (const g of rows.slice(h0, h1 + 1)) {
      for (const sp of g.spans) for (let k = sp.from; k <= sp.to && k < width; k++) if (sp.text && !head[k].includes(sp.text)) head[k].push(sp.text);
      g.cells.slice(0, width).forEach((t, i) => { if (t && !head[i].includes(t)) head[i].push(t); });
    }
    lines.push(head.map((p) => p.join(' ')).join(' | '));
    for (const g of rows.slice(h1 + 1)) lines.push(g.cells.slice(0, width).join(' | ').replace(/(\s\|\s*)+$/, ''));
    report.sheets.push({ name: ws.name, rows: rows.length, cols: width });
    out.push(lines.join('\n'));
  }
  const notes: string[] = [];
  if (report.hiddenSheets.length) notes.push(`hidden sheets skipped: ${report.hiddenSheets.join(', ')}`);
  if (report.hiddenRows) notes.push(`${report.hiddenRows} hidden rows skipped`);
  if (report.hiddenCols) notes.push(`${report.hiddenCols} hidden columns skipped`);
  if (report.formulaNoValue) notes.push(`${report.formulaNoValue} formulas had no cached value (open and re-save in Excel)`);
  if (report.truncated.length) notes.push(`sheets truncated at ${MAX_ROWS} rows / ${MAX_COLS} columns: ${report.truncated.join(', ')}`);
  return { text: out.join('\n\n') + (notes.length ? `\n\n[extraction notes: ${notes.join('; ')}]` : ''), report, notes };
}
