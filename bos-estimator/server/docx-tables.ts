// DOCX -> text with tables preserved as "cell | cell" rows.
// mammoth.convertToHtml keeps table structure (tr/td, colspan, rowspan from vMerge, th for repeated header rows),
// strike-through (<s>) and superscripts; extractRawText flattens every cell onto its own line.
// No HTML library needed: mammoth's output is a small, well-formed tag set, tokenised here with one regex.
import mammoth from 'mammoth';

const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = (s: string): string => s.replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e: string) => {
  if (e[0] === '#') { const cp = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(cp) && cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : m; }
  return ENT[e.toLowerCase()] ?? m;
});
const BLOCK = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'br']);

interface Cell { text: string; colspan: number; rowspan: number; th: boolean }
interface Row { header: boolean; cells: Cell[] }
interface OpenTable { nested: boolean; rows: Row[]; cell: Omit<Cell, 'text'> | null }
type Block = { kind: 'text'; text: string } | { kind: 'table'; rows: Row[] };

/** Parse mammoth HTML into text paragraphs and tables (nested tables are flattened into their cell's text). */
function parse(html: string): Block[] {
  const tokens = html.match(/<\/?[a-z0-9]+[^>]*>|[^<]+/gi) ?? [];
  const blocks: Block[] = []; const tables: OpenTable[] = [];
  let text = ''; let sup = 0;
  const flushText = () => { const t = text.replace(/\s+/g, ' ').trim(); if (t && !tables.length) blocks.push({ kind: 'text', text: t }); text = ''; };
  for (const tok of tokens) {
    if (tok[0] !== '<') { let t = decode(tok); if (sup) t = `[^${t.trim()}]`; text += t; continue; }
    const m = tok.match(/^<(\/?)([a-z0-9]+)([^>]*)>/i); if (!m) continue;
    const close = m[1] === '/'; const tag = m[2].toLowerCase(); const attrs = m[3];
    const T = tables[tables.length - 1];
    if (tag === 's' || tag === 'del' || tag === 'strike') { text += '~~'; continue; }
    if (tag === 'sup') { sup += close ? -1 : 1; continue; }
    if (tag === 'table') {
      if (!close) { if (tables.length) { text += ' '; tables.push({ nested: true, rows: [], cell: null }); } else { flushText(); tables.push({ nested: false, rows: [], cell: null }); } }
      else {
        const done = tables.pop();
        if (!done) continue;
        if (done.nested) text += ' ' + done.rows.map((r) => r.cells.map((c) => c.text).filter(Boolean).join(' / ')).join(' ; ') + ' ';
        else blocks.push({ kind: 'table', rows: done.rows });
      }
      continue;
    }
    if (T && !T.nested) {
      if (tag === 'tr' && !close) T.rows.push({ header: false, cells: [] });
      else if ((tag === 'td' || tag === 'th') && !close) { text = ''; T.cell = { colspan: Math.max(1, Number(attrs.match(/colspan="?(\d+)/i)?.[1] ?? 1)), rowspan: Math.max(1, Number(attrs.match(/rowspan="?(\d+)/i)?.[1] ?? 1)), th: tag === 'th' }; }
      else if ((tag === 'td' || tag === 'th') && close && T.cell) {
        const row = T.rows[T.rows.length - 1] ?? (T.rows.push({ header: false, cells: [] }), T.rows[T.rows.length - 1]);
        row.cells.push({ ...T.cell, text: text.replace(/\s+/g, ' ').replace(/~~\s*~~/g, '').trim() });
        if (T.cell.th) row.header = true;
        T.cell = null; text = '';
      } else if (BLOCK.has(tag) && close && T.cell) text += ' ';
      continue;
    }
    if (tables.length) { if (BLOCK.has(tag) && close) text += ' '; continue; }
    if (BLOCK.has(tag) && (close || tag === 'br')) flushText();
    else if (tag === 'img' && !close) { const alt = attrs.match(/alt="([^"]*)"/i)?.[1]; text += alt ? ` [image: ${decode(alt)}] ` : ' [image] '; }
  }
  flushText();
  return blocks;
}

interface GridRow { header: boolean; cells: string[] }
/** Expand colspan/rowspan into a rectangular grid. Spanned positions are left empty, except a rowspan label is
 *  repeated downwards so every row says which group/building it belongs to, and a header colspan label is marked
 *  ("\0label") in each spanned position so it can be prefixed onto every sub-column. */
function grid(rows: Row[]): GridRow[] {
  const out: GridRow[] = []; const carry: { text: string; left: number }[] = [];
  for (const r of rows) {
    const cells: string[] = []; let col = 0;
    const take = () => { while ((carry[col]?.left ?? 0) > 0) { cells[col] = carry[col].text; carry[col].left--; col++; } };
    for (const c of r.cells) {
      take();
      cells[col] = c.text;
      if (c.rowspan > 1) carry[col] = { text: c.text, left: c.rowspan - 1 };
      for (let k = 1; k < c.colspan; k++) { cells[col + k] = r.header ? `\u0000${c.text}` : ''; if (c.rowspan > 1) carry[col + k] = { text: '', left: c.rowspan - 1 }; }
      col += c.colspan;
    }
    take();
    out.push({ header: r.header, cells: Array.from(cells, (x) => x ?? '') });
  }
  return out;
}

const hasNumber = (c: string) => /\d{2,}/.test(c);

/** More leading non-numeric rows than a header ever has: a key/value block ("GSA Building Number | VA0123ZZ"). */
const MAX_HEADER_ROWS = 3;

function tableLines(rows: Row[]): string[] {
  const g = grid(rows);
  if (!g.length) return [];
  const width = Math.max(...g.map((r) => r.cells.length));
  const lines: string[] = [];
  // a first row holding one label across the whole table is its title, not a group header
  while (g.length > 1 && width >= 3 && g[0].cells.length === width && g[0].cells.every((c, i) => (i === 0 ? c && !c.startsWith('\u0000') : c === `\u0000${g[0].cells[0]}`))) { lines.push(g[0].cells[0]); g.shift(); }
  // header rows: explicit <th> rows, or leading rows with no 2+ digit numbers when the table body has them
  // (a generator that marks every row <th> says nothing about which rows are the header)
  const thInfo = !g.every((r) => r.header);
  let h = 0;
  while (h < g.length && ((thInfo && g[h].header) || (!g[h].cells.some(hasNumber) && g.slice(h + 1).some((r) => r.cells.some(hasNumber))))) h++;
  if (h >= g.length || h > MAX_HEADER_ROWS) h = 0;
  if (h) {
    const head: string[][] = Array.from({ length: width }, () => []);
    for (const r of g.slice(0, h)) r.cells.forEach((c, i) => { const t = c.replace(/^\u0000/, ''); if (t && head[i][head[i].length - 1] !== t) head[i].push(t); });
    lines.push(head.map((p) => p.join(' ')).join(' | '));
  }
  for (const r of g.slice(h)) {
    // spanned positions of a body row stay empty (the text is in the span's first cell)
    const cells = Array.from({ length: width }, (_, i) => { const c = r.cells[i] ?? ''; return c.startsWith('\u0000') ? '' : c; });
    if (cells.some(Boolean)) lines.push(cells.join(' | ').replace(/(\s\|\s*)+$/, ''));
  }
  return lines;
}

export interface DocxResult { text: string; tables: number; warnings: string[] }

export async function extractDocx(buf: Buffer): Promise<DocxResult> {
  const { value: html, messages } = await mammoth.convertToHtml({ buffer: buf }, {
    includeDefaultStyleMap: true,
    styleMap: ['strike => s'],
    // never base64-encode embedded images into the HTML (only their alt text is used)
    convertImage: mammoth.images.imgElement(async () => ({ src: '' })),
  });
  const out: string[] = [];
  let tables = 0;
  for (const b of parse(html)) {
    if (b.kind === 'text') out.push(b.text);
    else { tables++; out.push('', ...tableLines(b.rows), ''); }
  }
  return { text: out.join('\n').replace(/\n{3,}/g, '\n\n').trim(), tables, warnings: messages.filter((m) => m.type === 'warning').map((m) => m.message).slice(0, 10) };
}
