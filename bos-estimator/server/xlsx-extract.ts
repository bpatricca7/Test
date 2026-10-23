// XLSX -> text, one block per visible sheet, rows as "cell | cell" with header-aware flattening.
//  - numbers as plain numbers (45200, not "45,200" or 4.52E+04); percents as "15%"; dates as YYYY-MM-DD
//  - formulas -> cached result (exceljs never calculates; a formula without a cached result is flagged)
//  - merged cells: vertical merges repeat the value down (a "Campus" column merged over 40 rows applies to each
//    row); horizontal merges in header rows become group labels prefixed onto each sub-column
//  - hidden sheets / rows / columns are left out and reported (hidden rows are often filtered-out / excluded
//    buildings); strike-through cells are wrapped in ~~ ~~ (deleted by amendment)
import ExcelJS from 'exceljs';

const MAX_ROWS = 20000, MAX_COLS = 60;

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

interface Merge { top: number; left: number; bottom: number; right: number }
export interface XlsxReport { hiddenSheets: string[]; hiddenRows: number; hiddenCols: number; formulaNoValue: number; truncated: string[]; sheets: { name: string; rows: number; cols: number }[] }
export interface XlsxResult { text: string; report: XlsxReport; notes: string[] }

export async function extractXlsx(buf: Buffer, name = 'workbook.xlsx'): Promise<XlsxResult> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const out: string[] = [];
  const report: XlsxReport = { hiddenSheets: [], hiddenRows: 0, hiddenCols: 0, formulaNoValue: 0, truncated: [], sheets: [] };
  for (const ws of wb.worksheets) {
    if (ws.state && ws.state !== 'visible') { report.hiddenSheets.push(`${ws.name} (${ws.state})`); continue; }
    const nCols = Math.min(ws.columnCount, MAX_COLS);
    if (ws.columnCount > MAX_COLS || ws.rowCount > MAX_ROWS) report.truncated.push(`${ws.name} (${ws.rowCount} rows × ${ws.columnCount} columns; read ${Math.min(ws.rowCount, MAX_ROWS)} × ${nCols})`);
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
