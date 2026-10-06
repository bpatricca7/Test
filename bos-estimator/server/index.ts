import express from 'express';
import cors from 'cors';
import multer from 'multer';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readDocument, type DocInput, type IngestMode } from './extract';
import { heuristicExtract } from './heuristic';
import { aiAvailable, extractWithClaude, mergeFacility, topDownHeuristic, topDownWithClaude } from './ai';
import { heuristicPriorAward } from './heuristic';
import { emptyProject, listProjects, loadProject, saveProject } from './store';
import { CATEGORY_DEFAULTS, CREWS, FACTORS } from '../shared/factors';
import { DEFAULT_ASSUMPTIONS, estimateInventory } from '../shared/estimate';
import { AI_MODEL_PRESETS, type AiConfig, type ExtractionEvent, type Inventory, type PriorAward, type Project, type TopDownEstimate } from '../shared/types';

const here = path.dirname(fileURLToPath(import.meta.url));
// Minimal .env loader (no dependency): KEY=value lines, '#' comments, existing env wins.
try {
  const envText = await fs.readFile(path.resolve(here, '../.env'), 'utf8');
  for (const line of envText.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m && !line.trim().startsWith('#') && process.env[m[1]] == null) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch { /* no .env */ }
const app = express();
const PORT = Number(process.env.PORT || 8787);

app.use(cors());
app.use(express.json({ limit: '25mb' }));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 60 * 1024 * 1024, files: 20 } });

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, aiAvailable: aiAvailable(), presets: AI_MODEL_PRESETS, defaultModel: 'claude-opus-5-5', defaultEffort: 'xhigh' });
});

app.get('/api/factors', (_req, res) => {
  res.json({ factors: FACTORS, crews: CREWS, categories: CATEGORY_DEFAULTS, defaults: DEFAULT_ASSUMPTIONS });
});

app.get('/api/sample', async (_req, res) => {
  const text = await fs.readFile(path.resolve(here, '../samples/sample-rfp-pws.txt'), 'utf8');
  res.type('text/plain').send(text);
});

app.get('/api/projects', async (_req, res) => res.json(await listProjects()));
app.get('/api/projects/:id', async (req, res) => res.json(await loadProject(req.params.id)));
app.put('/api/projects/:id', async (req, res) => {
  const body = req.body as Partial<Project>;
  const current = await loadProject(req.params.id);
  const next: Project = { ...current, ...body, id: req.params.id, createdAt: current.createdAt };
  res.json(await saveProject(next));
});
app.delete('/api/projects/:id', async (req, res) => {
  const p = emptyProject(req.params.id);
  res.json(await saveProject(p));
});

app.post('/api/projects/:id/estimate', async (req, res) => {
  const p = await loadProject(req.params.id);
  res.json(estimateInventory(p.inventory, p.assumptionOverrides ?? {}, p.factorOverrides));
});

app.post('/api/projects/:id/topdown', async (req, res) => {
  const p = await loadProject(String(req.params.id));
  const body = (req.body ?? {}) as { provider?: 'auto' | 'claude' | 'heuristic'; priorAward?: PriorAward; overrides?: Project['topDownOverrides'] };
  if (body.priorAward) p.priorAward = body.priorAward;
  if (body.overrides) p.topDownOverrides = body.overrides;
  const est = estimateInventory(p.inventory, p.assumptionOverrides ?? {}, p.factorOverrides, p.wages as never);
  const ctx = { priorAward: p.priorAward, est, site: p.inventory.site, overrides: p.topDownOverrides };
  const wantAi = body.provider === 'claude' || ((body.provider ?? 'auto') === 'auto' && aiAvailable());
  let topDown: TopDownEstimate;
  try {
    if (wantAi) {
      if (!aiAvailable()) throw new Error('ANTHROPIC_API_KEY is not set on the server.');
      topDown = (await topDownWithClaude(ctx, p.ai)).topDown;
    } else topDown = topDownHeuristic(ctx);
  } catch (err) {
    if (body.provider === 'claude') { res.status(502).json({ error: (err as Error).message }); return; }
    topDown = topDownHeuristic(ctx);
  }
  p.topDown = topDown;
  await saveProject(p);
  res.json(topDown);
});

app.get('/api/projects/:id/export.csv', async (req, res) => {
  const p = await loadProject(req.params.id);
  const est = estimateInventory(p.inventory, p.assumptionOverrides ?? {}, p.factorOverrides);
  const rows: string[][] = [['Scope', 'Item', 'Building #', 'Task', 'RS Means ref', 'Crew', 'Quantity', 'Unit', 'Freq/yr', 'LH/unit', 'Annual hours']];
  for (const fe of est.facilities) for (const l of fe.lines) rows.push(['Facility', fe.resolved.name, fe.resolved.buildingNumber ?? '', l.name, l.ref, l.crew, String(l.quantity), l.unit, String(l.frequencyPerYear), String(l.lhPerUnit), String(l.annualHours)]);
  for (const ge of est.grounds) for (const l of ge.lines) rows.push(['Grounds', ge.area.name, '', l.name, l.ref, l.crew, String(l.quantity), l.unit, String(l.frequencyPerYear), String(l.lhPerUnit), String(l.annualHours)]);
  rows.push([]);
  rows.push(['Crew summary', 'Crew', '', '', '', '', 'Hours', 'FTE', 'Headcount', 'Wage', 'Annual labor $']);
  for (const c of est.crews) rows.push(['', c.label, '', '', '', '', String(c.hours), String(c.fte), String(c.headcount), String(c.wage), String(c.annualCost)]);
  rows.push([]);
  rows.push(['Manning by year', 'Year', '', '', '', '', 'Hours', 'FTE', 'Headcount', '', 'Labor $']);
  for (const y of est.years) rows.push(['', y.label, '', '', '', '', String(y.hours), String(y.fte), String(y.headcount), '', String(y.laborCost)]);
  if (p.topDown) {
    const t = p.topDown; rows.push([]);
    rows.push(['Top-down cross-check', 'Basis', t.basis, 'Annual value (escalated)', String(t.annualValue), 'Loaded $/FTE', String(t.assumptions.loadedCostPerFte), 'ODC %', String(t.assumptions.odcMaterialsPct), 'G&A %', String(t.assumptions.gaPct)]);
    rows.push(['', 'Implied FTE low/base/high', `${t.impliedFte.low} / ${t.impliedFte.base} / ${t.impliedFte.high}`, 'Bottom-up FTE', String(t.bottomUpFte), 'Delta', t.deltaPct == null ? '' : `${Math.round(t.deltaPct * 100)}%`, 'Recommended', String(t.recommendedFte ?? ''), 'Rationale', t.rationale]);
  }
  const csv = rows.map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  res.setHeader('Content-Disposition', `attachment; filename="${p.id}-estimate.csv"`);
  res.type('text/csv').send(csv);
});

// ---------- extraction (SSE) ----------
app.post('/api/projects/:id/extract', upload.array('files', 20), async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();
  const send = (e: ExtractionEvent) => { res.write(`data: ${JSON.stringify(e)}\n\n`); };
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 15000);
  const abort = new AbortController();
  req.on('close', () => abort.abort());

  const started = Date.now();
  try {
    const body = req.body as Record<string, string>;
    const files = (req.files as Express.Multer.File[]) ?? [];
    const ingest = (['auto', 'native_pdf', 'text'].includes(body.ingest) ? body.ingest : 'auto') as IngestMode;
    const provider = body.provider === 'heuristic' ? 'heuristic' : body.provider === 'claude' ? 'claude' : 'auto';
    const mode = body.mode === 'append' ? 'append' : 'replace';
    const ai: AiConfig = { model: (body.model || 'claude-opus-5-5').trim(), effort: (['low', 'medium', 'high', 'xhigh', 'max'].includes(body.effort) ? body.effort : 'xhigh') as AiConfig['effort'] };

    send({ type: 'status', stage: 'reading', message: `Reading ${files.length} file(s)${body.text ? ' + pasted text' : ''}…` });
    const docs: DocInput[] = [];
    for (const f of files) {
      const d = await readDocument(f.originalname, f.buffer, ingest);
      docs.push(d);
      send({ type: 'document', name: d.name, pages: d.pages, chars: d.chars, mode: d.mode });
    }
    if (body.text && body.text.trim()) {
      const d: DocInput = { name: body.textName || 'Pasted text', mode: 'text', text: body.text, chars: body.text.length, bytes: Buffer.byteLength(body.text) };
      docs.push(d);
      send({ type: 'document', name: d.name, chars: d.chars, mode: 'text' });
    }
    if (!docs.length) throw new Error('No documents received.');

    let inventory: Inventory;
    let foundAward: PriorAward | undefined;
    let usedProvider: 'claude' | 'heuristic' = 'heuristic';
    let usage: { input: number; output: number } | undefined;
    let model: string | undefined;
    const wantAi = provider === 'claude' || (provider === 'auto' && aiAvailable());
    if (wantAi) {
      if (!aiAvailable()) throw new Error('ANTHROPIC_API_KEY is not set on the server. Add it to .env (see .env.example) or choose the rule-based parser.');
      try {
        const r = await extractWithClaude(docs, ai, send, abort.signal);
        inventory = r.inventory; usage = r.usage; model = r.model; usedProvider = 'claude'; foundAward = r.priorAward;
      } catch (err) {
        if (provider === 'claude') throw err;
        send({ type: 'status', stage: 'ai', message: `AI extraction failed (${(err as Error).message}). Falling back to the rule-based parser.` });
        inventory = heuristicExtract(docs);
      }
    } else {
      send({ type: 'status', stage: 'ai', message: aiAvailable() ? 'Using rule-based parser (as requested).' : 'No ANTHROPIC_API_KEY configured — using rule-based parser.' });
      inventory = heuristicExtract(docs);
      for (const f of inventory.facilities) send({ type: 'facility', facility: f });
      for (const g of inventory.grounds) send({ type: 'grounds', area: g });
      send({ type: 'site', site: inventory.site });
    }
    if (!foundAward || !(foundAward.totalValue || foundAward.annualValue || foundAward.spendToDate)) {
      const h = heuristicPriorAward(docs);
      if (h && (h.totalValue || h.annualValue || h.spendToDate)) { foundAward = { ...(foundAward ?? {}), ...h }; send({ type: 'prior_award', award: foundAward }); }
    }

    send({ type: 'status', stage: 'merging', message: 'Merging into project…' });
    const project = await loadProject(String(req.params.id));
    if (mode === 'append') {
      const map = new Map(project.inventory.facilities.map((f) => [f.id, f]));
      for (const f of inventory.facilities) map.set(f.id, map.has(f.id) ? mergeFacility(map.get(f.id)!, f) : f);
      inventory = { site: { ...project.inventory.site, ...inventory.site }, facilities: [...map.values()], grounds: [...project.inventory.grounds, ...inventory.grounds] };
    }
    project.inventory = inventory;
    project.ai = ai;
    // Keep manually entered award facts unless the package states a value.
    const hasValue = (a?: PriorAward) => Boolean(a && (a.totalValue || a.annualValue || a.spendToDate));
    project.priorAward = hasValue(foundAward) ? { ...(project.priorAward ?? {}), ...foundAward } : foundAward ? { ...foundAward, ...(project.priorAward ?? {}) } : project.priorAward;
    if (project.priorAward) send({ type: 'prior_award', award: project.priorAward });

    // Top-down should-cost cross-check runs on every extraction.
    send({ type: 'status', stage: 'ai', message: hasValue(project.priorAward) ? 'Backing into FTEs from the previous award (top-down should-cost)…' : 'Building top-down assumptions (no award value found yet)…' });
    try {
      const est = estimateInventory(inventory, project.assumptionOverrides ?? {}, project.factorOverrides, project.wages as never);
      const ctx = { priorAward: project.priorAward, est, site: inventory.site, overrides: project.topDownOverrides };
      if (usedProvider === 'claude' && aiAvailable()) {
        const r = await topDownWithClaude(ctx, ai, send, abort.signal);
        project.topDown = r.topDown; if (usage) { usage.input += r.usage.input; usage.output += r.usage.output; }
      } else project.topDown = topDownHeuristic(ctx);
      send({ type: 'topdown', topDown: project.topDown });
    } catch (err) {
      send({ type: 'status', stage: 'ai', message: `Top-down cross-check failed (${(err as Error).message}); using rule-based assumptions.` });
      const est = estimateInventory(inventory, project.assumptionOverrides ?? {}, project.factorOverrides, project.wages as never);
      project.topDown = topDownHeuristic({ priorAward: project.priorAward, est, site: inventory.site, overrides: project.topDownOverrides });
      send({ type: 'topdown', topDown: project.topDown });
    }
    project.documents = [...(mode === 'append' ? project.documents : []), ...docs.map((d) => ({ name: d.name, size: d.bytes, pages: d.pages, chars: d.chars, mode: d.mode }))];
    project.extraction = { provider: usedProvider, model, finishedAt: new Date().toISOString(), durationMs: Date.now() - started, usage };
    if (!project.name || project.name === 'Untitled BOS estimate') project.name = inventory.site.installationName ? `${inventory.site.installationName} BOS` : project.name;
    await saveProject(project);
    send({ type: 'done', inventory, provider: usedProvider, model, durationMs: Date.now() - started, usage });
  } catch (err) {
    send({ type: 'error', message: (err as Error).message || String(err) });
  } finally {
    clearInterval(heartbeat);
    res.end();
  }
});

// ---------- static client (production) ----------
const dist = path.resolve(here, '../dist');
app.use(express.static(dist));
app.get(/^\/(?!api\/).*/, async (_req, res, next) => {
  try { await fs.access(path.join(dist, 'index.html')); res.sendFile(path.join(dist, 'index.html')); } catch { next(); }
});

app.listen(PORT, () => {
  console.log(`BOS estimator server on http://localhost:${PORT}  (AI: ${aiAvailable() ? 'Claude enabled' : 'no API key → rule-based parser'})`);
});
