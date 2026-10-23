#!/usr/bin/env tsx
// Offline evaluation of the AI reader without an API key: a stand-in model (a person or an agent) reads exactly what the
// live loop would send, calls the tools by writing JSON, and gets back exactly the tool results the live loop returns —
// through the same applyToolCall code path (server/toolcalls.ts). The finished call log is scored with
//   npx tsx scripts/eval.ts --provider replay <fixtureDir>
//
//   npx tsx scripts/sim-session.ts init <fixtureDir> [--name opus-sim]           writes sim/<name>/request/* and prints the index
//   npx tsx scripts/sim-session.ts step <fixtureDir> <batch.json> [--name …]      applies a batch [{name, input}] (pass = current)
//   npx tsx scripts/sim-session.ts next-pass <fixtureDir> [--name …]              moves to the next pass (multi-pass packages)
//   npx tsx scripts/sim-session.ts status <fixtureDir> [--name …]                 counts, declared tables, completeness gaps
import fs from 'node:fs';
import path from 'node:path';
import { readDocument, type DocInput } from '../server/extract';
import * as extract from '../server/extract';
import { describeRequests } from '../server/ai';
import { replayToolCalls, completeness, createState, applyToolCall, beginPass, type ToolCall } from '../server/toolcalls';
import type { FixtureTruth } from '../tests/harness/truth';

const argv = process.argv.slice(2);
const opt = (k: string, d: string) => { const i = argv.indexOf(`--${k}`); if (i >= 0) { const v = argv[i + 1]; argv.splice(i, 2); return v; } return d; };
const name = opt('name', 'opus-sim');
const [cmd, dirArg, batchArg] = argv;
if (!cmd || !dirArg) { console.error('usage: sim-session.ts init|step|next-pass|status <fixtureDir> [batch.json] [--name n]'); process.exit(2); }
const dir = path.resolve(dirArg);
const ext = { pdf: 'pdf', 'scanned-pdf': 'pdf', docx: 'docx', xlsx: 'xlsx', csv: 'csv', txt: 'txt' } as const;

async function loadDocs(): Promise<{ docs: DocInput[]; files: string[] }> {
  const truth = JSON.parse(fs.readFileSync(path.join(dir, 'truth.json'), 'utf8')) as FixtureTruth;
  const files = truth.inputs.map((i) => path.join(dir, 'build', i.out ?? `${path.basename(i.src).replace(/\.[^.]+$/, '')}${i.as === 'scanned-pdf' ? '-scanned' : ''}.${ext[i.as]}`));
  let docs: DocInput[] = [];
  for (const f of files) { const r = await readDocument(path.basename(f), fs.readFileSync(f), 'auto'); docs.push(...(Array.isArray(r) ? r : [r])); }
  const order = (extract as Record<string, unknown>).orderDocuments as undefined | ((d: DocInput[]) => DocInput[]);
  if (order) docs = order(docs);
  return { docs, files };
}

const simDir = path.join(dir, 'sim');
const reqDir = path.join(simDir, name, 'request');
const callsFile = path.join(simDir, `${name}.calls.json`);
const stateFile = path.join(simDir, name, 'session.json');
type Rec = { model: string; passes: string[][]; calls: ToolCall[] };
const loadRec = (): Rec => (fs.existsSync(callsFile) ? JSON.parse(fs.readFileSync(callsFile, 'utf8')) : { model: name, passes: [], calls: [] });
const loadSession = (): { pass: number; passes: string[][] } => JSON.parse(fs.readFileSync(stateFile, 'utf8'));

const { docs, files } = await loadDocs();
const preview = describeRequests(docs);

if (cmd === 'init') {
  fs.mkdirSync(reqDir, { recursive: true });
  fs.writeFileSync(path.join(reqDir, 'system.md'), preview.system);
  fs.writeFileSync(path.join(reqDir, 'tools.json'), JSON.stringify(preview.tools, null, 2));
  const index: string[] = [`# Request preview for ${path.basename(dir)} (${preview.passes.length} pass(es))`, '', `system prompt: ${path.join(reqDir, 'system.md')}`, `tool definitions: ${path.join(reqDir, 'tools.json')}`, ''];
  preview.passes.forEach((p, i) => {
    const intro = path.join(reqDir, `pass-${i + 1}-intro.md`);
    fs.writeFileSync(intro, p.intro);
    index.push(`## Pass ${i + 1}: ${p.names.join(', ')}`, 'Document blocks, in order (the user turn is these blocks followed by the intro):');
    p.items.forEach((it, k) => {
      if (it.mode === 'native_pdf') {
        const src = files.find((f) => path.basename(f) === it.doc) ?? it.doc;
        index.push(`  ${k + 1}. [native PDF, ${it.pages ?? '?'} pages] "${it.title}" — read it visually: ${src}`);
      } else {
        const tf = path.join(reqDir, `pass-${i + 1}-doc-${k + 1}.txt`);
        fs.writeFileSync(tf, it.text ?? '');
        index.push(`  ${k + 1}. [text] "${it.title}" — ${tf}`);
      }
    });
    index.push(`  then the intro: ${intro}`, '');
  });
  fs.writeFileSync(path.join(reqDir, 'INDEX.md'), index.join('\n'));
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  fs.writeFileSync(stateFile, JSON.stringify({ pass: 0, passes: preview.passes.map((p) => p.names) }));
  fs.writeFileSync(callsFile, JSON.stringify({ model: name, passes: preview.passes.map((p) => p.names), calls: [] }, null, 2));
  console.log(index.join('\n'));
} else if (cmd === 'step') {
  const sess = loadSession();
  const batch = JSON.parse(fs.readFileSync(path.resolve(batchArg), 'utf8')) as { name: string; input: unknown }[] | { calls: { name: string; input: unknown }[] };
  const calls = Array.isArray(batch) ? batch : batch.calls;
  const rec = loadRec();
  const before = rec.calls.length;
  rec.calls.push(...calls.map((c) => ({ name: c.name, input: c.input, pass: sess.pass })));
  const r = replayToolCalls(rec.calls, docs, undefined, { passes: sess.passes });
  fs.writeFileSync(callsFile, JSON.stringify(rec, null, 2));
  r.results.slice(before).forEach((x, i) => console.log(`── tool_result ${before + i + 1} (${x.name})${x.isError ? ' [is_error]' : ''}\n${x.resultText}`));
  console.log(`\n[state] ${r.inventory.facilities.length} facilities (${r.inventory.facilities.filter((f) => !f.status || f.status === 'in_scope').length} in scope), ${r.inventory.grounds.length} grounds areas, prior award ${r.priorAward ? 'set' : 'none'}; pass ${sess.pass + 1} of ${sess.passes.length}`);
} else if (cmd === 'next-pass') {
  const sess = loadSession();
  if (sess.pass + 1 >= sess.passes.length) { console.log('Already on the last pass.'); process.exit(0); }
  sess.pass++; fs.writeFileSync(stateFile, JSON.stringify(sess));
  // the next pass intro depends on what was registered: rebuild it from the replayed state
  const st = createState(docs);
  const rec = loadRec(); let cur: number | undefined;
  for (const c of rec.calls) { if (c.pass != null && c.pass !== cur) { cur = c.pass; beginPass(st, sess.passes[c.pass]); } applyToolCall(st, c); }
  const intro = path.join(reqDir, `pass-${sess.pass + 1}-intro.md`);
  console.log(`Now on pass ${sess.pass + 1}. The intro for this pass is at ${intro} (built before any calls; the live loop also lists everything registered in earlier passes):\n`);
  console.log(fs.readFileSync(intro, 'utf8'));
} else if (cmd === 'status') {
  const sess = loadSession();
  const rec = loadRec();
  const st = createState(docs); let cur: number | undefined;
  for (const c of rec.calls) { if (c.pass != null && c.pass !== cur) { cur = c.pass; beginPass(st, sess.passes[c.pass]); } applyToolCall(st, c); }
  console.log(`calls ${rec.calls.length}; facilities ${st.facilities.size}; grounds ${st.grounds.length}; pass ${sess.pass + 1}/${sess.passes.length}`);
  for (const g of completeness(st)) console.log(`gap ${g.table}: ${g.message}`);
} else { console.error(`unknown command ${cmd}`); process.exit(2); }
