import express from 'express';
import cors from 'cors';
import multer from 'multer';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { orderDocuments, readDocument, textDocument, type DocInput, type IngestMode } from './extract';
import { heuristicExtract } from './heuristic';
import { aiAvailable, extractWithClaude, mergeFacility, topDownHeuristic, topDownWithClaude } from './ai';
import { heuristicPriorAward } from './heuristic';
import { emptyProject, listProjects, loadProject, saveProject } from './store';
import { CATEGORY_DEFAULTS, CREWS, FACTORS } from '../shared/factors';
import { DEFAULT_ASSUMPTIONS, estimateInventory } from '../shared/estimate';
import { AI_MODEL_PRESETS, type AiConfig, type DocumentInfo, type ExtractionEvent, type Inventory, type PriorAward, type Project, type TopDownEstimate } from '../shared/types';

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
// One request's stray promise rejection must not end every other run in flight (Node's default is to exit).
// Document parsing itself runs in isolated workers (server/extract.ts), so a hostile upload cannot reach this.
process.on('unhandledRejection', (reason) => { console.error('[server] unhandled rejection:', reason); });

app.use(cors());
app.use(express.json({ limit: '25mb' }));

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
const MAX_UPLOAD_FILES = 150;
const MAX_UPLOAD_BYTES = 600 * 1024 * 1024; // whole request; zip packages count at their compressed size
const MAX_TEXT_FIELD_BYTES = 25 * 1024 * 1024; // pasted PWS text
const UPLOAD_DIR = path.join(os.tmpdir(), 'bos-estimator-uploads');
const upload = multer({
  storage: multer.diskStorage({ destination: (_req, _file, cb) => { fs.mkdir(UPLOAD_DIR, { recursive: true }).then(() => cb(null, UPLOAD_DIR), (err: Error) => cb(err, UPLOAD_DIR)); } }),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: MAX_UPLOAD_FILES, fieldSize: MAX_TEXT_FIELD_BYTES, fields: 50 },
  defParamCharset: 'utf8', // UTF-8 file names ("Amendment 0001 – Facility List.pdf"), busboy defaults to latin1
});
const fmtMb = (n: number) => `${Math.round(n / 1024 / 1024)} MB`;

/** multer, with its failures answered as JSON (413 / 400) before the event stream starts - never an HTML stack trace. */
const receiveUploads: express.RequestHandler = (req, res, next) => {
  const declared = Number(req.headers['content-length'] || 0);
  if (declared > MAX_UPLOAD_BYTES + MAX_TEXT_FIELD_BYTES) {
    res.status(413).json({ error: `Upload is ${fmtMb(declared)}; the limit is ${fmtMb(MAX_UPLOAD_BYTES)} per run. Split the package into several Append runs.` });
    req.resume();
    return;
  }
  upload.array('files', MAX_UPLOAD_FILES)(req, res, (err: unknown) => {
    if (!err) {
      const files = (req.files as Express.Multer.File[] | undefined) ?? [];
      const total = files.reduce((n, f) => n + f.size, 0);
      if (total > MAX_UPLOAD_BYTES) {
        void Promise.all(files.map((f) => fs.rm(f.path, { force: true })));
        res.status(413).json({ error: `Files total ${fmtMb(total)}; the limit is ${fmtMb(MAX_UPLOAD_BYTES)} per run. Split the package into several Append runs.` });
        return;
      }
      next();
      return;
    }
    if (err instanceof multer.MulterError) {
      const file = err.field === 'files' && (err as multer.MulterError & { filename?: string }).filename ? ` (${(err as multer.MulterError & { filename?: string }).filename})` : '';
      const [status, message] = ({
        LIMIT_FILE_SIZE: [413, `A file${file} is larger than ${fmtMb(MAX_UPLOAD_BYTES)}.`],
        LIMIT_FILE_COUNT: [413, `Too many files: at most ${MAX_UPLOAD_FILES} per run. Upload the package as a .zip, or split it into several Append runs.`],
        LIMIT_FIELD_VALUE: [413, `Pasted text is larger than ${fmtMb(MAX_TEXT_FIELD_BYTES)}. Upload it as a file instead.`],
        LIMIT_PART_COUNT: [413, 'Too many form parts in the upload.'],
        LIMIT_FIELD_COUNT: [400, 'Too many form fields in the upload.'],
        LIMIT_UNEXPECTED_FILE: [400, `Unexpected file field "${err.field ?? ''}"; send documents in the "files" field.`],
      } as Record<string, [number, string]>)[err.code] ?? [400, `Upload rejected: ${err.message}.`];
      res.status(status).json({ error: message, code: err.code });
      return;
    }
    res.status(400).json({ error: `Upload failed: ${(err as Error)?.message || String(err)}` });
  });
};

app.post('/api/projects/:id/extract', receiveUploads, async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();
  const send = (e: ExtractionEvent) => { if (!res.writableEnded) res.write(`data: ${JSON.stringify(e)}\n\n`); };
  const heartbeat = setInterval(() => { if (!res.writableEnded) res.write(': ping\n\n'); }, 15000);
  const abort = new AbortController();
  // the client went away (req 'close' fires as soon as the body is consumed, so watch the response instead)
  res.on('close', () => { if (!res.writableFinished) abort.abort(); });

  const started = Date.now();
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  try {
    const body = (req.body ?? {}) as Record<string, string>;
    const ingest = (['auto', 'native_pdf', 'text'].includes(body.ingest) ? body.ingest : 'auto') as IngestMode;
    const provider = body.provider === 'heuristic' ? 'heuristic' : body.provider === 'claude' ? 'claude' : 'auto';
    const mode = body.mode === 'append' ? 'append' : 'replace';
    const ai: AiConfig = { model: (body.model || 'claude-opus-5-5').trim(), effort: (['low', 'medium', 'high', 'xhigh', 'max'].includes(body.effort) ? body.effort : 'xhigh') as AiConfig['effort'] };

    send({ type: 'status', stage: 'reading', message: `Reading ${files.length} file(s)${body.text ? ' + pasted text' : ''}…` });
    const docs: DocInput[] = [];
    const announce = (d: DocInput) => {
      send({ type: 'document', name: d.name, size: d.bytes, pages: d.pages, chars: d.chars, mode: d.mode, kind: d.kind, role: d.role, amendment: d.amendment, scannedPages: d.scannedPages?.length ? d.scannedPages : undefined, warnings: d.warnings });
      for (const w of d.warnings ?? []) send({ type: 'warning', file: d.name, message: w });
    };
    // long documents: a status line every few seconds while their pages are read
    let lastProgress = 0;
    const onProgress = (p: { name: string; page: number; pages: number }) => {
      if (Date.now() - lastProgress < 3000 || p.pages < 20) return;
      lastProgress = Date.now();
      send({ type: 'status', stage: 'reading', message: `Reading ${p.name}: page ${p.page} of ${p.pages}…` });
    };
    for (const f of files) {
      if (abort.signal.aborted) throw new Error('Cancelled.');
      try {
        const buf = await fs.readFile(f.path);
        for (const d of await readDocument(f.originalname, buf, ingest, { onProgress })) { docs.push(d); announce(d); }
      } catch (err) {
        const message = `could not be read (${(err as Error).message || String(err)}); skipped`;
        const d: DocInput = { name: f.originalname, mode: 'text', text: '', chars: 0, bytes: f.size, warnings: [message] };
        docs.push(d); announce(d);
      } finally {
        await fs.rm(f.path, { force: true }).catch(() => undefined);
      }
    }
    if (body.text && body.text.trim()) { const d = textDocument(body.textName || 'Pasted text', body.text); docs.push(d); announce(d); }
    if (!docs.length) throw new Error('No documents received.');
    // precedence: base → attachments → Q&A → amendments (ascending), so later documents win in both readers
    const readable = orderDocuments(docs.filter((d) => d.text.trim() || d.pdfBase64));
    if (!readable.length) throw new Error('None of the uploaded files could be read (see the warnings above).');
    if (readable.length > 1) send({ type: 'status', stage: 'reading', message: `Reading order (later documents supersede earlier ones): ${readable.map((d, i) => `${i + 1}. ${d.name}${d.role && d.role !== 'other' ? ` [${d.role === 'amendment' && d.amendment != null ? `amendment ${String(d.amendment).padStart(4, '0')}` : d.role}]` : ''}`).join(' · ')}` });

    // live progress: distinct facilities / grounds registered so far
    const seenFacilities = new Set<string>(); const seenGrounds = new Set<string>(); let expected: number | undefined;
    const track = (e: ExtractionEvent) => {
      if (e.type === 'progress') { expected = e.expected ?? expected; send(e); return; }
      send(e);
      if (e.type === 'facility' || e.type === 'grounds') {
        if (e.type === 'facility') seenFacilities.add(e.facility.id); else seenGrounds.add(e.area.id);
        send({ type: 'progress', registered: seenFacilities.size, expected, grounds: seenGrounds.size });
      }
    };
    const streamHeuristic = (inv: Inventory) => {
      for (const f of inv.facilities) track({ type: 'facility', facility: f });
      for (const g of inv.grounds) track({ type: 'grounds', area: g });
      send({ type: 'site', site: inv.site });
    };

    let inventory: Inventory;
    let foundAward: PriorAward | undefined;
    let usedProvider: 'claude' | 'heuristic' = 'heuristic';
    let usage: { input: number; output: number } | undefined;
    let model: string | undefined;
    const wantAi = provider === 'claude' || (provider === 'auto' && aiAvailable());
    if (wantAi) {
      if (!aiAvailable()) throw new Error('ANTHROPIC_API_KEY is not set on the server. Add it to .env (see .env.example) or choose the rule-based parser.');
      try {
        const r = await extractWithClaude(readable, ai, track, abort.signal);
        inventory = r.inventory; usage = r.usage; model = r.model; usedProvider = 'claude'; foundAward = r.priorAward;
      } catch (err) {
        if (provider === 'claude' || abort.signal.aborted) throw err;
        send({ type: 'status', stage: 'ai', message: `AI extraction failed (${(err as Error).message}). Falling back to the rule-based parser.` });
        inventory = heuristicExtract(readable);
        streamHeuristic(inventory);
      }
    } else {
      send({ type: 'status', stage: 'ai', message: aiAvailable() ? 'Using rule-based parser (as requested).' : 'No ANTHROPIC_API_KEY configured — using rule-based parser.' });
      inventory = heuristicExtract(readable);
      streamHeuristic(inventory);
    }
    if (!foundAward || !(foundAward.totalValue || foundAward.annualValue || foundAward.spendToDate)) {
      const h = heuristicPriorAward(readable);
      if (h && (h.totalValue || h.annualValue || h.spendToDate)) { foundAward = { ...(foundAward ?? {}), ...h }; send({ type: 'prior_award', award: foundAward }); }
    }

    if (abort.signal.aborted) throw new Error('Cancelled before the results were saved.');
    send({ type: 'status', stage: 'merging', message: 'Merging into project…' });
    const project = await loadProject(String(req.params.id));
    const docInfos: DocumentInfo[] = docs.map((d) => ({ name: d.name, size: d.bytes, pages: d.pages, chars: d.chars, mode: d.mode, kind: d.kind, role: d.role, amendment: d.amendment, scannedPages: d.scannedPages?.length ? d.scannedPages : undefined, warnings: d.warnings?.length ? d.warnings : undefined }));
    let keptPrevious = false;
    if (mode === 'append') {
      const map = new Map(project.inventory.facilities.map((f) => [f.id, f]));
      for (const f of inventory.facilities) map.set(f.id, map.has(f.id) ? mergeFacility(map.get(f.id)!, f) : f);
      inventory = { site: { ...project.inventory.site, ...inventory.site }, facilities: [...map.values()], grounds: [...project.inventory.grounds, ...inventory.grounds] };
    } else if (!inventory.facilities.length) {
      if (project.inventory.facilities.length) {
        keptPrevious = true;
        send({ type: 'warning', message: `No facilities were found in this package, so the previous inventory (${project.inventory.facilities.length} facilities) was kept instead of being replaced. Check the warnings above, or use Append to add to it.` });
        inventory = { ...project.inventory, site: { ...project.inventory.site, ...inventory.site }, grounds: project.inventory.grounds.length ? project.inventory.grounds : inventory.grounds };
      } else send({ type: 'warning', message: 'No facilities were found in this package. Check the warnings above; a scanned exhibit needs the Claude reader, and workload tables must list a building and its square footage.' });
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
    project.documents = [...(mode === 'append' || keptPrevious ? project.documents : []), ...docInfos];
    project.extraction = { provider: usedProvider, model, finishedAt: new Date().toISOString(), durationMs: Date.now() - started, usage };
    if (!project.name || project.name === 'Untitled BOS estimate') project.name = inventory.site.installationName ? `${inventory.site.installationName} BOS` : project.name;
    await saveProject(project);
    send({ type: 'done', inventory, provider: usedProvider, model, durationMs: Date.now() - started, usage });
  } catch (err) {
    send({ type: 'error', message: (err as Error).message || String(err) });
  } finally {
    clearInterval(heartbeat);
    await Promise.all(files.map((f) => fs.rm(f.path, { force: true }).catch(() => undefined)));
    res.end();
  }
});

// API errors as JSON (malformed JSON bodies, oversized payloads, unexpected exceptions) - never an HTML stack trace.
app.use('/api', (err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (res.headersSent) { next(err); return; }
  const e = err as { status?: number; statusCode?: number; type?: string; message?: string };
  const status = Number(e.status ?? e.statusCode) || 500;
  const message = e.type === 'entity.too.large' ? 'Request body is too large.' : status >= 500 ? `Server error: ${e.message ?? 'unexpected failure'}` : e.message ?? 'Bad request';
  if (status >= 500) console.error(err);
  res.status(status).json({ error: message });
});

// ---------- static client (production) ----------
const dist = process.env.DIST_DIR ? path.resolve(process.env.DIST_DIR) : path.resolve(here, '../dist');
app.use(express.static(dist));
app.get(/^\/(?!api\/).*/, async (_req, res, next) => {
  try { await fs.access(path.join(dist, 'index.html')); res.sendFile(path.join(dist, 'index.html')); } catch { next(); }
});

app.listen(PORT, () => {
  console.log(`BOS estimator server on http://localhost:${PORT}  (AI: ${aiAvailable() ? 'Claude enabled' : 'no API key → rule-based parser'})`);
});
