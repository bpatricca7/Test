#!/usr/bin/env node
// Renders RFP test fixtures into the real file formats the app ingests.
//   node scripts/render-fixtures.mjs [fixtureDir ...]   (default: every dir under tests/fixtures)
// Each fixture's truth.json lists inputs: { src, as: pdf|scanned-pdf|docx|xlsx|csv|txt, out? }.
//   pdf          HTML → PDF via headless Chromium (text layer, real table layout)
//   scanned-pdf  HTML → PDF → 110-dpi page images → image-only PDF (no text layer, like a scan)
//   docx         HTML → DOCX (headings, paragraphs, tables) via the docx library
//   xlsx         CSV  → XLSX via exceljs; a JSON file {sheets:[{name, rows:[[...]]}]} gives multi-sheet workbooks
//   csv / txt    copied as-is
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import ExcelJS from 'exceljs';
import { parse as parseHtml } from 'node-html-parser';
import { Document, Packer, Paragraph, Table, TableRow, TableCell, TextRun, HeadingLevel, WidthType } from 'docx';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../tests/fixtures');
const dirs = process.argv.slice(2).length ? process.argv.slice(2).map((d) => path.resolve(d)) : fs.readdirSync(root).map((d) => path.join(root, d)).filter((d) => fs.existsSync(path.join(d, 'truth.json')));
const exe = process.env.CHROMIUM_PATH || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const browser = await chromium.launch(exe ? { executablePath: exe } : {});
const ext = { pdf: 'pdf', 'scanned-pdf': 'pdf', docx: 'docx', xlsx: 'xlsx', csv: 'csv', txt: 'txt' };

async function htmlToPdf(src, out) {
  const page = await browser.newPage();
  await page.goto('file://' + src, { waitUntil: 'load' });
  await page.pdf({ path: out, format: 'Letter', printBackground: true, margin: { top: '0.6in', bottom: '0.6in', left: '0.6in', right: '0.6in' }, displayHeaderFooter: true, headerTemplate: '<span></span>', footerTemplate: '<div style="font-size:8px;width:100%;text-align:center;color:#555">Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>' });
  await page.close();
}

async function scannedPdf(src, out, tmp) {
  const textPdf = path.join(tmp, 'text.pdf');
  await htmlToPdf(src, textPdf);
  execFileSync('pdftoppm', ['-r', '110', '-png', textPdf, path.join(tmp, 'pg')]);
  const pngs = fs.readdirSync(tmp).filter((f) => f.startsWith('pg') && f.endsWith('.png')).sort();
  const html = `<html><head><style>@page{size:Letter;margin:0}body{margin:0}img{width:8.5in;height:11in;display:block;page-break-after:always;filter:grayscale(1) contrast(1.05)}</style></head><body>${pngs.map((p) => `<img src="file://${path.join(tmp, p)}">`).join('')}</body></html>`;
  const htmlPath = path.join(tmp, 'scan.html'); fs.writeFileSync(htmlPath, html);
  const page = await browser.newPage();
  await page.goto('file://' + htmlPath, { waitUntil: 'load' });
  await page.pdf({ path: out, width: '8.5in', height: '11in', printBackground: true, margin: { top: 0, bottom: 0, left: 0, right: 0 } });
  await page.close();
}

function parseCsv(text) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
    else if (c === '"') q = true; else if (c === ',') { row.push(cell); cell = ''; } else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
const typed = (v) => { const t = String(v).trim(); if (/^-?[\d,]+(\.\d+)?$/.test(t) && /\d/.test(t) && !/^0\d/.test(t)) return Number(t.replace(/,/g, '')); return t; };

async function toXlsx(src, out) {
  const wb = new ExcelJS.Workbook();
  const sheets = src.endsWith('.json') ? JSON.parse(fs.readFileSync(src, 'utf8')).sheets : [{ name: 'Sheet1', rows: parseCsv(fs.readFileSync(src, 'utf8')) }];
  for (const sh of sheets) {
    const ws = wb.addWorksheet(sh.name.slice(0, 31));
    for (const r of sh.rows) ws.addRow(r.map(typed));
    for (const m of sh.merges ?? []) ws.mergeCells(m);
    ws.columns.forEach((c) => { c.width = 16; });
    if (sh.numFmt) ws.columns.forEach((c, i) => { if (sh.numFmt[i]) c.numFmt = sh.numFmt[i]; });
  }
  await wb.xlsx.writeFile(out);
}

function inlineRuns(node) {
  const runs = [];
  const walk = (n, bold) => {
    for (const ch of n.childNodes) {
      if (ch.nodeType === 3) { const t = ch.rawText.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' '); if (t) runs.push(new TextRun({ text: t, bold })); }
      else if (ch.tagName === 'BR') runs.push(new TextRun({ text: '', break: 1 }));
      else walk(ch, bold || ch.tagName === 'B' || ch.tagName === 'STRONG' || ch.tagName === 'TH');
    }
  };
  walk(node, node.tagName === 'TH');
  return runs.length ? runs : [new TextRun('')];
}

async function toDocx(src, out) {
  const root = parseHtml(fs.readFileSync(src, 'utf8'));
  const body = root.querySelector('body') ?? root;
  const children = [];
  const heading = { H1: HeadingLevel.HEADING_1, H2: HeadingLevel.HEADING_2, H3: HeadingLevel.HEADING_3, H4: HeadingLevel.HEADING_4 };
  const visit = (el) => {
    for (const n of el.childNodes) {
      if (n.nodeType !== 1) { const t = n.rawText?.trim(); if (t) children.push(new Paragraph({ children: [new TextRun(t)] })); continue; }
      const tag = n.tagName;
      if (heading[tag]) children.push(new Paragraph({ heading: heading[tag], children: inlineRuns(n) }));
      else if (tag === 'P' || tag === 'LI') children.push(new Paragraph({ children: inlineRuns(n), bullet: tag === 'LI' ? { level: 0 } : undefined }));
      else if (tag === 'TABLE') {
        const rows = n.querySelectorAll('tr').map((tr) => new TableRow({ tableHeader: tr.querySelectorAll('th').length > 0, children: tr.childNodes.filter((c) => c.tagName === 'TD' || c.tagName === 'TH').map((td) => new TableCell({ columnSpan: Number(td.getAttribute('colspan') || 1), children: [new Paragraph({ children: inlineRuns(td) })] })) }));
        if (rows.length) children.push(new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } }));
      } else if (['DIV', 'SECTION', 'UL', 'OL', 'TBODY', 'THEAD', 'CENTER', 'HEADER', 'FOOTER', 'MAIN', 'ARTICLE'].includes(tag)) visit(n);
      else if (tag !== 'STYLE' && tag !== 'SCRIPT' && n.text.trim()) children.push(new Paragraph({ children: inlineRuns(n) }));
    }
  };
  visit(body);
  const doc = new Document({ sections: [{ children }] });
  fs.writeFileSync(out, await Packer.toBuffer(doc));
}

let failures = 0;
for (const dir of dirs) {
  const truth = JSON.parse(fs.readFileSync(path.join(dir, 'truth.json'), 'utf8'));
  const build = path.join(dir, 'build');
  fs.mkdirSync(build, { recursive: true });
  for (const input of truth.inputs) {
    const src = path.join(dir, input.src);
    const base = path.basename(input.src).replace(/\.[^.]+$/, '');
    const out = path.join(build, input.out ?? `${base}${input.as === 'scanned-pdf' ? '-scanned' : ''}.${ext[input.as]}`);
    try {
      if (!fs.existsSync(src)) throw new Error(`missing source ${input.src}`);
      if (input.as === 'pdf') await htmlToPdf(src, out);
      else if (input.as === 'scanned-pdf') { const tmp = fs.mkdtempSync(path.join(build, '.scan-')); try { await scannedPdf(src, out, tmp); } finally { fs.rmSync(tmp, { recursive: true, force: true }); } }
      else if (input.as === 'docx') await toDocx(src, out);
      else if (input.as === 'xlsx') await toXlsx(src, out);
      else fs.copyFileSync(src, out);
      console.log(`✓ ${truth.id}: ${path.relative(dir, out)} (${(fs.statSync(out).size / 1024).toFixed(0)} KB)`);
    } catch (err) {
      failures++;
      console.error(`✗ ${truth.id}: ${input.src} → ${input.as}: ${err.message}`);
    }
  }
}
await browser.close();
process.exit(failures ? 1 : 0);
