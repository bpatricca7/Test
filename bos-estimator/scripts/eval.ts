#!/usr/bin/env tsx
// Run the RFP reader against fixtures (scored) or against your own documents (summary only).
//
//   npm run eval                                   # every fixture, rule-based parser
//   npm run eval -- --provider claude              # every fixture, Claude (needs ANTHROPIC_API_KEY)
//   npm run eval -- --provider claude ~/RFPs/W912QR-26-R-0042/*.pdf   # your own solicitation files
//   npm run eval -- --provider replay tests/fixtures/<id>             # replay recorded tool calls (sim/*.calls.json)
//   npm run eval -- --provider claude --record run.calls.json tests/fixtures/<id>   # record the run's tool calls
//
// Options: --model <id> --effort <low|medium|high|xhigh|max> --ingest <auto|native_pdf|text> --json <out.json> --quiet
//          --record <file>  (claude only) write the tool calls; with several fixtures, <fixture-id> is inserted before .calls.json
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as extract from '../server/extract';
import { readDocument, type DocInput, type IngestMode } from '../server/extract';
import { heuristicExtract, heuristicPriorAward } from '../server/heuristic';
import * as ai from '../server/ai';
import { estimateInventory } from '../shared/estimate';
import type { AiConfig, ExtractionEvent, Inventory, PriorAward } from '../shared/types';
import { scoreInventory, type ScoreReport } from '../tests/harness/score';
import type { FixtureTruth } from '../tests/harness/truth';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.resolve(here, '../tests/fixtures');

// minimal .env loader (same rules as the server)
try { for (const line of fs.readFileSync(path.resolve(here, '../.env'), 'utf8').split('\n')) { const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i); if (m && !line.trim().startsWith('#') && process.env[m[1]] == null) process.env[m[1]] = m[2].replace(/^["']|["']$/g, ''); } } catch { /* none */ }

const argv = process.argv.slice(2);
const opt = (k: string, d?: string) => { const i = argv.indexOf(`--${k}`); if (i >= 0) { const v = argv[i + 1]; argv.splice(i, 2); return v; } return d; };
const flag = (k: string) => { const i = argv.indexOf(`--${k}`); if (i >= 0) { argv.splice(i, 1); return true; } return false; };
const provider = opt('provider', 'heuristic') as 'heuristic' | 'claude' | 'replay';
const cfg: AiConfig = { model: opt('model', 'claude-opus-5-5')!, effort: (opt('effort', 'high') as AiConfig['effort']) };
const ingest = opt('ingest', 'auto') as IngestMode;
const jsonOut = opt('json');
const recordTo = opt('record');
const quiet = flag('quiet');
const targets = argv.length ? argv : fs.readdirSync(FIXTURES).map((d) => path.join(FIXTURES, d)).filter((d) => fs.existsSync(path.join(d, 'truth.json'))).sort();

async function loadDocs(files: string[]): Promise<DocInput[]> {
  let docs: DocInput[] = [];
  for (const f of files) docs.push(...(await expand(await readDocument(path.basename(f), fs.readFileSync(f), ingest))));
  // base → attachments → Q&A → amendments, when the reader provides it (added in a newer server/extract.ts)
  const orderDocuments = (extract as Record<string, unknown>).orderDocuments;
  if (typeof orderDocuments === 'function') { const r = await (orderDocuments as (d: DocInput[]) => DocInput[] | Promise<DocInput[]>)(docs); if (Array.isArray(r)) docs = r; }
  return docs;
}
// readDocument may return one doc or (for zips / workbooks in newer versions) several
async function expand(d: DocInput | DocInput[]): Promise<DocInput[]> { return Array.isArray(d) ? d : [d]; }

type RunUsage = { input: number; output: number; cacheRead?: number; cacheWrite?: number };
type Recorded = { model?: string; passes?: string[][]; calls: ai.ReplayCall[] };

async function run(docs: DocInput[], o: { callsFile?: string; recordTo?: string } = {}): Promise<{ inventory: Inventory; priorAward?: PriorAward; ms: number; usage?: RunUsage; warnings: string[] }> {
  const t0 = Date.now();
  const warnings: string[] = [];
  const emit = (e: ExtractionEvent) => { if (e.type === 'warning') { warnings.push(e.message); return; } if (quiet) return; if (e.type === 'status') console.log(`   · ${e.message}`); else if (e.type === 'ai_text' && e.kind === 'tool') process.stdout.write('.'); };
  if (provider === 'claude') {
    if (!ai.aiAvailable()) throw new Error('ANTHROPIC_API_KEY is not set (add it to .env)');
    const r = await ai.extractWithClaude(docs, cfg, emit, undefined, { recordCallsTo: o.recordTo });
    if (!quiet) process.stdout.write('\n');
    const pa = r.priorAward ?? heuristicPriorAward(docs);
    return { inventory: r.inventory, priorAward: pa, ms: Date.now() - t0, usage: r.usage, warnings };
  }
  if (provider === 'replay') {
    if (!o.callsFile || !fs.existsSync(o.callsFile)) throw new Error(`no recorded calls (sim/*.calls.json)${o.callsFile ? ` at ${o.callsFile}` : ''}`);
    const rec = JSON.parse(fs.readFileSync(o.callsFile, 'utf8')) as Recorded;
    const r = ai.replayToolCalls(rec.calls, docs, emit, { passes: rec.passes });
    return { inventory: r.inventory, priorAward: r.priorAward ?? heuristicPriorAward(docs), ms: Date.now() - t0, warnings };
  }
  const inventory = heuristicExtract(docs);
  return { inventory, priorAward: heuristicPriorAward(docs), ms: Date.now() - t0, warnings };
}
const fmtUsage = (u?: RunUsage) => (u ? ` · ${u.input.toLocaleString()} in / ${u.output.toLocaleString()} out tokens${u.cacheRead || u.cacheWrite ? ` (cache ${(u.cacheRead ?? 0).toLocaleString()} read / ${(u.cacheWrite ?? 0).toLocaleString()} written)` : ''}` : '');
const recordPath = (id: string) => (!recordTo ? undefined : targets.length > 1 ? recordTo.replace(/(\.calls)?\.json$/i, '') + `.${id}.calls.json` : recordTo);

const pct = (n: number | null) => (n == null ? '  — ' : `${Math.round(n * 100)}%`.padStart(4));
const reports: ScoreReport[] = [];

for (const target of targets) {
  const stat = fs.statSync(target);
  if (stat.isDirectory() && fs.existsSync(path.join(target, 'truth.json'))) {
    const truth = JSON.parse(fs.readFileSync(path.join(target, 'truth.json'), 'utf8')) as FixtureTruth;
    const build = path.join(target, 'build');
    const files = truth.inputs.map((i) => path.join(build, i.out ?? `${path.basename(i.src).replace(/\.[^.]+$/, '')}${i.as === 'scanned-pdf' ? '-scanned' : ''}.${{ pdf: 'pdf', 'scanned-pdf': 'pdf', docx: 'docx', xlsx: 'xlsx', csv: 'csv', txt: 'txt' }[i.as]}`));
    const missing = files.filter((f) => !fs.existsSync(f));
    if (missing.length) { console.log(`✗ ${truth.id}: not rendered (${missing.map((m) => path.basename(m)).join(', ')}) — run npm run fixtures`); continue; }
    if (!quiet) console.log(`\n▶ ${truth.id} — ${truth.title} [${truth.provenance.fidelity}]`);
    try {
      const docs = await loadDocs(files);
      const sim = path.join(target, 'sim');
      const callsFile = provider === 'replay' && fs.existsSync(sim) ? fs.readdirSync(sim).filter((f) => f.endsWith('.calls.json')).sort().map((f) => path.join(sim, f))[0] : undefined;
      if (provider === 'replay' && !callsFile) { console.log(`  – ${truth.id}: no recorded calls (sim/*.calls.json), skipped`); continue; }
      const r = await run(docs, { callsFile, recordTo: recordPath(truth.id) });
      const rep = scoreInventory(truth, r.inventory, provider, r.priorAward);
      reports.push(rep);
      const f = rep.facilities;
      console.log(`  score ${String(rep.score).padStart(3)} │ facilities ${f.matched}/${f.expected} found (extracted ${f.extracted}) │ SF exact ${pct(f.sfExactRate)} │ precision ${pct(f.precision)} │ total SF ${f.totalSfGot.toLocaleString()} vs ${f.totalSfExpected.toLocaleString()} (${f.totalSfErrPct >= 0 ? '+' : ''}${f.totalSfErrPct}%) │ ${r.ms} ms${fmtUsage(r.usage)}`);
      if (!quiet) for (const w of r.warnings.slice(0, 6)) console.log(`    warning: ${w}`);
      for (const g of rep.grounds) if (Math.abs(g.errPct) > 2) console.log(`    grounds ${g.kind}: ${g.got} vs ${g.expected} ${g.unit} (${g.errPct}%)`);
      for (const d of rep.dining) if (!d.ok) console.log(`    dining meals/day: ${d.got} vs ${d.expected}`);
      for (const p of rep.priorAward) if (!p.ok) console.log(`    prior award ${p.field}: ${String(p.got)} vs ${String(p.expected)}`);
      if (!quiet) { for (const m of rep.misses.slice(0, 8)) console.log(`    miss: ${m}`); if (rep.misses.length > 8) console.log(`    … ${rep.misses.length - 8} more misses`); for (const x of rep.extras.slice(0, 4)) console.log(`    extra: ${x}`); }
    } catch (err) { console.log(`  ✗ ${(err as Error).message}`); }
  } else {
    // ad-hoc: treat all non-fixture args as one solicitation package
    const files = targets.filter((t) => fs.statSync(t).isFile());
    const docs = await loadDocs(files);
    for (const d of docs) console.log(`  read ${d.name}: ${d.pages ? `${d.pages} pages, ` : ''}${d.chars.toLocaleString()} chars, ${d.mode}`);
    if (provider === 'replay') { console.log('  --provider replay needs a fixture directory with sim/*.calls.json'); break; }
    const r = await run(docs, { recordTo });
    const est = estimateInventory(r.inventory);
    console.log(`\n${r.inventory.facilities.length} facilities · ${est.metrics.grossSqft.toLocaleString()} gross SF · ${r.inventory.grounds.length} grounds areas (${est.metrics.acres.toFixed(1)} acres) · ${est.totalFte} FTE bottom-up · ${r.ms} ms${fmtUsage(r.usage)}`);
    for (const w of r.warnings) console.log(`  warning: ${w}`);
    for (const f of r.inventory.facilities) console.log(`  ${(f.buildingNumber ?? '—').padEnd(8)} ${f.name.slice(0, 48).padEnd(48)} ${String(f.grossSqft.toLocaleString()).padStart(10)} SF  ${f.serviceLevel.padEnd(8)} ${Math.round(f.confidence * 100)}%${f.status && f.status !== 'in_scope' ? `  [${f.status}]` : ''}`);
    for (const g of r.inventory.grounds) console.log(`  [grounds] ${g.name.slice(0, 50).padEnd(50)} ${g.quantity.toLocaleString()} ${g.unit}`);
    if (r.priorAward) console.log(`  [prior award] ${JSON.stringify({ ...r.priorAward, source: undefined })}`);
    break;
  }
}

if (reports.length > 1) {
  const avg = (k: (r: ScoreReport) => number) => Math.round((reports.reduce((s, r) => s + k(r), 0) / reports.length) * 1000) / 10;
  console.log(`\n${provider}: ${reports.length} fixtures · mean score ${avg((r) => r.score / 100)} · facility recall ${avg((r) => r.facilities.recall)}% · SF exact ${avg((r) => r.facilities.sfExactRate)}%`);
}
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(reports, null, 2));
