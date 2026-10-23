// Claude-powered RFP reader. Streams the model's progress and registers facilities / grounds through tool calls so the
// 3D scene can grow while the package is still being read. Tool calls are applied by server/toolcalls.ts, the same code
// that replays recorded runs in tests and `npm run eval -- --provider replay`.
import Anthropic, { toFile } from '@anthropic-ai/sdk';
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { AiConfig, ExtractionEvent, Facility, Inventory, PriorAward, SiteInfo, TopDownAssumptions, TopDownEstimate } from '../shared/types';
import type { EstimateResult } from '../shared/estimate';
import { DEFAULT_TOPDOWN, annualValueBasis, bottomUpLoadedCostPerFte, computeTopDown, heuristicAssumptions } from '../shared/topdown';
import type { DocInput } from './extract';
import {
  applyToolCall, beginPass, createState, docRank, extractionTools, facilityKey, finalize, mergeFacilities, noFinishWarning, precedenceList,
  groundsSummary, registeredSummary, tablesSummary, type ExtractionState, type ToolCall,
} from './toolcalls';

export { replayToolCalls } from './toolcalls';
export type { ToolCall as ReplayCall } from './toolcalls';

type Emit = (e: ExtractionEvent) => void;

/** Token usage, with cache reads and writes kept apart from uncached input (input / output keep their old meaning for the UI). */
export interface AiUsage { input: number; output: number; cacheRead: number; cacheWrite: number }

export interface ExtractOptions {
  /** Write the run's tool calls as {model, passes, calls: [{name, input, pass, truncated?}]} JSON (replayable with replayToolCalls). */
  recordCallsTo?: string;
  /** Upload native PDFs once with the Files API and reference them by file_id (default true; BOS_FILES_API=0 disables). */
  useFilesApi?: boolean;
  /** Tool-loop turns per pass (default 80). */
  maxTurns?: number;
  /** Injected client (tests). */
  client?: Anthropic;
}

const PASS_TEXT_LIMIT = 2_000_000; // chars of text per document block / request (~600k tokens)
const PASS_PAGE_LIMIT = 500; // native PDF pages per request (API limit is 600)
const PASS_INLINE_BYTES = 24 * 1024 * 1024; // base64 PDF bytes sent inline per request (request limit is 32 MB)
const PASS_TOKEN_BUDGET = 650_000; // estimated document tokens per request (1M context; leave room for the tool loop)
const TOKENS_PER_NATIVE_PAGE = 2_500;
const CHARS_PER_TOKEN = 3.3;
const MAX_TURNS = 80;
const MAX_OUTPUT_TOKENS = 64_000;
/** Room a request needs beyond its input: one full turn of output plus the tool results sent with it. */
const CONTEXT_HEADROOM = MAX_OUTPUT_TOKENS + 16_000;
/** Fresh conversations per pass after the context window fills up. */
const MAX_CONTINUATIONS = 3;
const PROMPT_TOO_LONG = /prompt is too long|context (?:window|length)|maximum context|too many (?:input )?tokens/i;
const contextWindowOf = (model: string) => (/claude-haiku-4|claude-3/.test(model) ? 200_000 : 1_000_000);
const contextTokens = (u?: Anthropic.Beta.BetaUsage) => (u ? (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.output_tokens ?? 0) : 0);
const EPHEMERAL = { type: 'ephemeral' } as const;

const SYSTEM = `You are a senior estimator for base operations support (BOS) contracts: custodial services, periodic floor care, grounds maintenance, and dining facility (full food service) operations on military installations and federal campuses.

You are reading a solicitation package (RFP / PWS / SOW, technical exhibits, workload data, facility lists, drawings, Q&A, amendments). Your job is to build a complete, accurate FACILITY AND GROUNDS INVENTORY for the estimate. The tools do the arithmetic: copy every number exactly as printed and let the tools convert units, sum fixtures, derive meals per day and reconcile totals.

How the text is rendered (documents supplied as text; PDFs attached natively you read visually):
- Table rows are "cell | cell | cell". Empty cells are kept in position, so column indexes stay stable down a table. A header row may join a group label and a sub-column ("Square Feet Gross | Square Feet Cleanable", "Restroom Fixtures WC | Restroom Fixtures UR").
- "--- page N ---" starts page N; use it for source.page.
- "[^1]" is a footnote marker attached to the text before it. It is never part of a number: "45,200[^1]" is 45,200.
- "~~text~~" is struck-through text, which usually means deleted by an amendment.
- Spreadsheets appear as "=== file :: sheet ===" sections followed by their rows.

How to work:
1. Read everything first. Workload tables are usually in technical exhibits or attachments ("TE-3 Custodial Workload", "Attachment J-4 Facility List", "Exhibit B Grounds"). Facility lists can be split across pages; column headers may appear only once.
2. Workload tables. Before registering rows, call declare_tables once for every workload table you find (facility lists, custodial workload, dining workload, grounds), with table_id, title, file, page range and the number of printed rows (a printed row with several quantities, such as acres by type plus beds and trees, is one row). For a facility table give the printed total gross area, if there is one, in the table's unit; for a grounds table give each printed total of a quantity you register in printed_totals, with its unit as printed and the grounds kinds it covers. Tag every facility and grounds area with the table_id of the table it is printed in. Never register subtotal, total, grand total or sum rows; their figures belong in declare_tables. finish lists every declared table whose registered rows, square footage or quantities don't match; resolve the gap, or call finish again explaining it in unresolved, naming the table_id.
3. Register EVERY row of every workload table with register_facilities, in table order, in batches of up to 50 rows per call. Register the tables that print building areas before tables that only add data to those buildings (dining headcounts, frequencies, fixtures); a row that only adds data to a building whose area another table prints gets gross_area null and area_missing false, and if that building is not registered yet the tool holds the row until it is. Keep each call short enough to finish well within the output limit. If a call is reported as cut off, resend exactly those rows in smaller batches. Do not stop until every row is registered; if a list has 800 buildings, register all 800.
4. Building identity. Copy building_number exactly as printed, including letters, hyphens and leading zeros (0012, T-2401, 3105-B, P-114). If the package covers more than one installation, campus or site, set campus on every facility: the same number on two campuses is two different buildings. A building that appears in several tables (custodial list and dining workload, base list and amendment) is one facility: register it each time with the same building_number and campus and the tool merges the rows.
5. Areas. Copy every area exactly as printed, in the document's unit, and set area_unit (sf, sm or sy). Never convert units or add areas up yourself; the tool does. gross_area is the whole area the contract covers at that facility. When the document says a facility's area is its building area plus separately listed units (portables, modulars, annexes, "N @ SF each"), those units belong to that facility: copy the building area as printed into gross_area and list the units in added_areas ({label, count, unit_area} as printed, one entry per unit size); the tool adds them to the gross and still reconciles the table against the printed column. Never put them in cleanable_area. If the exhibit shows both gross and cleanable / serviced / custodial area, record both: cleanable is part of the gross and is never larger, so a larger "pricing", "billing" or "serviced" figure that includes extra structures is the gross, not the cleanable area. When the document says the gross area is the cleaning basis (no net or cleanable area surveyed, "gross area applies", "no deduction is made"), set cleanable_equals_gross to true; leave cleanable_area null only when the package says nothing about it. If a building's area is not printed anywhere, set gross_area to null and area_missing to true, put your estimate in estimated_gross_area and its basis in notes. Rows with no gross_area and no area_missing flag only add data to a building registered from another row (frequency, fixtures, dining).
6. Scope status. Rows marked excluded, not in scope, N/A, information only, no service, vacant, closed, disposed, to be demolished, or shown struck through get the matching status (excluded, deleted_by_amendment, demolished, vacant) and a status_reason quoting the document; buildings serviced only in an option period get option_only. Register these rows anyway; do not just omit them. Leave status null when a row says nothing about scope: a new building is then in scope, and a row that only updates a registered building keeps its status. Use in_scope only when a document explicitly puts a building (back) in scope, with a status_reason.
7. Frequency, fixtures, floors. service_level is the routine cleaning frequency; also copy the frequency wording verbatim into service_frequency_text. Bi-weekly means every two weeks (biweekly) unless the document defines it as twice a week; monthly and quarterly have their own levels. When WC / UR / LAV / shower counts are separate columns, fill fixtures.water_closets, urinals, lavatories and showers separately; the tool sums them. Leave these fields null when the RFP is silent; the estimating engine applies category defaults.
8. Grounds: register_grounds for improved / semi-improved / unimproved acreage, athletic fields, planting beds, parking, sidewalks and trees, in the document's unit (acres, hectares, sqft, sqm, sqyd, lf or each). Type I = improved_turf; Type II = semi_improved; Type III and Type IV = unimproved. BASH, airfield infield and clear-zone areas are semi_improved or unimproved, per the mowing frequency. When the label and the stated mowing frequency disagree, follow the frequency. Put the document's own label in document_label and the mowing frequency in mowing_frequency_text. Register one area per printed quantity: a printed row with several quantities (Type I / II / III acres, turf, beds, trees, ballfields) becomes several areas, each with that printed row as source.excerpt; the table counts the printed row once. Tie areas to building numbers (and campus) when the document does; if one quantity is shared by several named buildings, split it evenly and register one area per building, each with the printed row as source.excerpt and "split from a shared quantity" in notes (still one printed row). Never register total rows; their figures belong in declare_tables.printed_totals. Out-of-scope areas get a status.
9. Dining. Register each dining facility separately with its own headcount; never sum headcount across facilities. If headcount is given per meal period, fill dining.meal_periods with {period, weekday_headcount, weekend_headcount} (weekday = Monday–Friday average per day, weekend = weekend / holiday average per day, null when the period is not served then) and leave meals_per_day null: the tool computes meals per day. Also fill seats, kitchen and dining room SF, days per week, and whether the requirement is full food service, dining facility attendant (DFA) only, or management only.
10. Call set_site_info once you know the installation, location, solicitation number, climate / growing season, and contract period (base + options).
11. Look hard for the PREVIOUS / INCUMBENT CONTRACT: incumbent name, contract number, award or ceiling value, period of performance, annual value, obligations or spend to date, award year. It often hides in the cover letter, sources-sought notice, Q&A, justification, or a "current contract" paragraph. Call set_previous_award with whatever you find (nulls for the rest); the estimate backs into an FTE count from it. If nothing is stated, call it once with all values null and say so in notes.
12. Give each item a short source excerpt (the row or sentence you took the numbers from), the page number, and source.file exactly as the document is named in the package list.
13. When everything is registered, call finish with a short summary and a list of anything unresolved (missing areas, ambiguous units, unreadable pages, buildings mentioned in text but absent from the exhibits).

Never invent buildings that the documents do not mention. Prefer tool calls over prose; keep any narration to one or two short sentences.`;

const PRECEDENCE_RULES = 'Where documents disagree, the one listed later wins. When an amendment or Q&A changes a building, register it again with the new values and cite that document in source.file. When it deletes, excludes or demolishes a building, register the building with status deleted_by_amendment (or excluded, demolished, vacant) and a status_reason. Do not just omit it. Tag amendment and Q&A rows with the table_id of a table you declared for that document, or null - never with the base table\'s id: the base table is reconciled against its rows as printed.';

// ---------- compatibility exports ----------
/** Facility id as the reader assigns it: the printed number as a slug (b-0012, b-t-2401), campus-prefixed only when a campus is set. */
export const facilityId = (bn: string | undefined, name: string, campus?: string) => facilityKey(bn, name, campus);
/** Merge an existing facility with a newer registration of the same building (append mode). */
export const mergeFacility = (a: Facility, b: Facility): Facility => mergeFacilities(a, b);

// ---------- request planning ----------
interface PassItem { doc: DocInput; title: string; text?: string; fileId?: string; tokens: number; inlineBytes: number; pages: number }

function splitText(text: string, limit: number): string[] {
  if (text.length <= limit) return [text];
  const parts: string[] = []; let rest = text;
  while (rest.length > limit) {
    const window = rest.slice(0, limit);
    let cut = window.lastIndexOf('\n--- page ');
    if (cut < limit * 0.6) cut = window.lastIndexOf('\n');
    if (cut < limit * 0.6) cut = limit;
    parts.push(rest.slice(0, cut)); rest = rest.slice(cut);
  }
  if (rest) parts.push(rest);
  return parts;
}

function planItems(docs: DocInput[], uploads: Map<DocInput, string>): PassItem[] {
  const items: PassItem[] = [];
  for (const d of docs) {
    if (d.mode === 'native_pdf' && d.pdfBase64) {
      const fileId = uploads.get(d);
      const pages = d.pages ?? 1;
      items.push({ doc: d, title: d.name, fileId, pages, tokens: pages * TOKENS_PER_NATIVE_PAGE, inlineBytes: fileId ? 0 : d.pdfBase64.length });
      continue;
    }
    const parts = splitText(d.text ?? '', PASS_TEXT_LIMIT);
    parts.forEach((t, i) => items.push({ doc: d, title: parts.length > 1 ? `${d.name} (part ${i + 1}/${parts.length})` : d.name, text: t, pages: 0, tokens: Math.ceil(t.length / CHARS_PER_TOKEN), inlineBytes: t.length }));
  }
  return items;
}

function planPasses(items: PassItem[]): PassItem[][] {
  const passes: PassItem[][] = [];
  let cur: PassItem[] = []; let tokens = 0; let pages = 0; let bytes = 0;
  for (const it of items) {
    if (cur.length && (tokens + it.tokens > PASS_TOKEN_BUDGET || pages + it.pages > PASS_PAGE_LIMIT || bytes + it.inlineBytes > PASS_INLINE_BYTES)) { passes.push(cur); cur = []; tokens = 0; pages = 0; bytes = 0; }
    cur.push(it); tokens += it.tokens; pages += it.pages; bytes += it.inlineBytes;
  }
  if (cur.length) passes.push(cur);
  return passes;
}

function docBlocks(items: PassItem[], useFiles: boolean): Anthropic.Beta.BetaContentBlockParam[] {
  return items.map((it): Anthropic.Beta.BetaContentBlockParam => {
    if (it.doc.mode === 'native_pdf' && it.doc.pdfBase64) {
      return useFiles && it.fileId
        ? { type: 'document', title: it.title, source: { type: 'file', file_id: it.fileId } }
        : { type: 'document', title: it.title, source: { type: 'base64', media_type: 'application/pdf', data: it.doc.pdfBase64 } };
    }
    return { type: 'document', title: it.title, source: { type: 'text', media_type: 'text/plain', data: it.text || '(empty document: no readable text)' } };
  });
}

const ranges = (pages: number[]) => {
  const s = [...new Set(pages)].sort((a, b) => a - b); const out: string[] = [];
  for (let i = 0; i < s.length; i++) { let j = i; while (j + 1 < s.length && s[j + 1] === s[j] + 1) j++; out.push(j > i ? `${s[i]}-${s[j]}` : `${s[i]}`); i = j; }
  return out.join(', ');
};

/** How a conversation (and a pass) ended. */
type PassEnd = 'finish' | 'end' | 'turns' | 'context' | 'refusal' | 'error';
/** A fresh conversation over the same documents after the previous one filled the context window. */
interface Continuation { n: number; carry?: string }

function passIntro(allDocs: DocInput[], pass: PassItem[], p: number, nPasses: number, st: ExtractionState, cont?: Continuation): string {
  const inPass = new Set(pass.map((i) => i.doc.name));
  const prec = precedenceList(allDocs);
  const lines: string[] = [];
  lines.push(`Solicitation package: ${allDocs.length} document(s).${nPasses > 1 ? ` The package is too large for one request: this is request ${p + 1} of ${nPasses} and it contains ${[...inPass].join(', ')}.` : ''}`);
  lines.push(`Documents from lowest to highest precedence (each one supersedes those listed above it):\n${prec.map((d, i) => `${i + 1}. ${d.name} (${d.label})${nPasses > 1 ? (inPass.has(d.name) ? ' [in this request]' : ' [another request]') : ''}`).join('\n')}\n${PRECEDENCE_RULES}`);
  const notes: string[] = [];
  for (const d of allDocs.filter((x) => inPass.has(x.name))) {
    if (d.scannedPages?.length) {
      notes.push(d.mode === 'native_pdf'
        ? `${d.name} pages ${ranges(d.scannedPages)} are scanned images; read them visually. If a table there is unreadable, list it in unresolved.`
        : `${d.name} pages ${ranges(d.scannedPages)} are scanned images with no text layer and could not be included; list any workload table on them in unresolved.`);
    }
    if (d.mode === 'text' && !d.text?.trim()) notes.push(`${d.name} has no readable text; list it in unresolved.`);
    for (const w of (d.warnings ?? []).slice(0, 6)) notes.push(`${d.name}: ${w}`);
  }
  if (notes.length) lines.push(`Reader notes:\n${notes.slice(0, 30).map((n) => `- ${n}`).join('\n')}`);
  if (cont) {
    lines.push(`This request continues reading the same documents: the previous conversation about them filled the model's context window and was closed (continuation ${cont.n}). Everything registered so far is listed below and is kept. Do not re-register it; register only the rows that are still missing, then call finish.${cont.carry ? `\n\nResults of the last tool calls in the previous conversation:\n${cont.carry}` : ''}`);
  }
  if (p > 0 || cont) {
    const where = cont ? 'so far' : 'in earlier requests';
    if (st.facilities.size) lines.push(`Already registered ${where}, one per line as building number|campus|gross SF|status (do not re-register unless this request has corrected or later data):\n${registeredSummary(st)}`);
    const tables = tablesSummary(st);
    if (tables) lines.push(`Tables declared ${where}:\n${tables}`);
    const grounds = cont ? groundsSummary(st) : '';
    if (grounds) lines.push(`Grounds areas registered so far, one per line as name|kind|quantity|building:\n${grounds}`);
  }
  lines.push(cont
    ? 'Continue with the tools: register the remaining facilities and grounds, set_site_info / set_previous_award if not done yet, and finish.'
    : 'Build the complete facility and grounds inventory using the tools: set_site_info if the installation is identifiable, declare_tables, then register facilities table by table, then grounds, set_previous_award, and finish.');
  return lines.join('\n\n');
}

// ---------- request parameters ----------
const isCurrentGen = (m: string) => /claude-(opus|sonnet|haiku)-5|fable|mythos|claude-opus-4-[678]|claude-sonnet-4-6/.test(m);
const supportsFallbacks = (m: string) => /claude-(opus|sonnet)-5|fable|mythos/.test(m);

/** Request options that an account / model combination may reject; stepped down one at a time on a 400. */
interface Flags { fallbacks: boolean; thinking: boolean; strict: boolean }
const initialFlags = (model: string): Flags => ({ fallbacks: supportsFallbacks(model), thinking: isCurrentGen(model), strict: true });

function stepDown(flags: Flags, err: Error, firstTurn: boolean): string | null {
  const m = err.message ?? '';
  // tool definitions only change before the conversation has history (changing them later would invalidate it)
  if (firstTurn && flags.strict && /strict|schema|grammar|compil|additionalProperties|too complex/i.test(m)) { flags.strict = false; return 'non-strict tool schemas'; }
  if (flags.fallbacks) { flags.fallbacks = false; return 'no server-side fallback'; }
  if (firstTurn && flags.strict) { flags.strict = false; return 'non-strict tool schemas'; }
  if (flags.thinking) { flags.thinking = false; return 'basic parameters'; }
  return null;
}

type StreamParams = Parameters<Anthropic['beta']['messages']['stream']>[0];

function buildParams(cfg: AiConfig, flags: Flags, messages: Anthropic.Beta.BetaMessageParam[], o: { system: string; tools: Anthropic.Beta.BetaTool[]; maxTokens: number; cacheSystem?: boolean }): StreamParams {
  const base: StreamParams = {
    model: cfg.model,
    max_tokens: o.maxTokens,
    system: [{ type: 'text', text: o.system, ...(o.cacheSystem ? { cache_control: EPHEMERAL } : {}) }],
    tools: o.tools,
    tool_choice: { type: 'auto' },
    messages,
  };
  if (!flags.thinking || !isCurrentGen(cfg.model)) return base;
  base.thinking = { type: 'adaptive', display: 'summarized' };
  base.output_config = { effort: cfg.effort ?? 'high' };
  if (flags.fallbacks && supportsFallbacks(cfg.model)) {
    base.betas = ['server-side-fallback-2026-07-01'];
    base.fallbacks = 'default';
  }
  return base;
}

function addUsage(usage: AiUsage, u: Anthropic.Beta.BetaUsage | undefined) {
  if (!u) return;
  usage.input += u.input_tokens ?? 0;
  usage.output += u.output_tokens ?? 0;
  usage.cacheRead += u.cache_read_input_tokens ?? 0;
  usage.cacheWrite += u.cache_creation_input_tokens ?? 0;
}

async function streamTurn(client: Anthropic, params: StreamParams, emit: Emit, signal?: AbortSignal): Promise<Anthropic.Beta.BetaMessage> {
  const stream = client.beta.messages.stream(params, { signal });
  let textBuf = ''; let thinkBuf = ''; let lastFlush = Date.now();
  const flush = () => {
    if (thinkBuf.trim()) emit({ type: 'ai_text', text: thinkBuf, kind: 'thinking' });
    if (textBuf.trim()) emit({ type: 'ai_text', text: textBuf, kind: 'text' });
    textBuf = ''; thinkBuf = ''; lastFlush = Date.now();
  };
  for await (const ev of stream) {
    if (ev.type === 'content_block_delta') {
      if (ev.delta.type === 'text_delta') textBuf += ev.delta.text;
      else if (ev.delta.type === 'thinking_delta' && ev.delta.thinking) thinkBuf += ev.delta.thinking;
      if (Date.now() - lastFlush > 400) flush();
    } else if (ev.type === 'content_block_stop') {
      flush();
    } else if (ev.type === 'content_block_start' && ev.content_block.type === 'tool_use') {
      flush();
      emit({ type: 'ai_text', text: `→ ${ev.content_block.name}`, kind: 'tool' });
    }
  }
  flush();
  return stream.finalMessage();
}

// ---------- Files API ----------
const safeFileName = (name: string) => { const base = (name.split(/[\\/]/).pop() ?? 'document').replace(/[<>:"|?*\\/\u0000-\u001f]/g, '_').slice(0, 200) || 'document'; return /\.pdf$/i.test(base) ? base : `${base}.pdf`; };

async function uploadPdfs(client: Anthropic, docs: DocInput[], emit: Emit, signal?: AbortSignal): Promise<Map<DocInput, string>> {
  const out = new Map<DocInput, string>();
  for (const d of docs) {
    if (d.mode !== 'native_pdf' || !d.pdfBase64) continue;
    try {
      const file = await toFile(Buffer.from(d.pdfBase64, 'base64'), safeFileName(d.name), { type: 'application/pdf' });
      const meta = await client.files.upload({ file, expires_in_seconds: 24 * 3600 }, { signal });
      out.set(d, meta.id);
    } catch (err) {
      if (signal?.aborted) throw err;
      emit({ type: 'status', stage: 'ai', message: `Files API upload of ${d.name} failed (${(err as Error).message.slice(0, 120)}); sending the PDF inline instead.` });
      if (err instanceof Anthropic.APIError && err.status != null && err.status < 500 && err.status !== 429) break; // account-level refusal: don't retry every file
    }
  }
  return out;
}

const fileSourceError = (err: unknown) => (err instanceof Anthropic.BadRequestError || err instanceof Anthropic.NotFoundError || err instanceof Anthropic.PermissionDeniedError) && /file/i.test((err as Error).message);

// ---------- extraction ----------
export async function extractWithClaude(docs: DocInput[], cfg: AiConfig, emit: Emit, signal?: AbortSignal, opts: ExtractOptions = {}): Promise<{ inventory: Inventory; priorAward?: PriorAward; usage: AiUsage; model: string; warnings: string[] }> {
  const client = opts.client ?? new Anthropic({ maxRetries: 3, timeout: 30 * 60 * 1000 });
  const maxTurns = opts.maxTurns ?? MAX_TURNS;
  const st = createState(docs);
  const usage: AiUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const flags = initialFlags(cfg.model);
  let servedModel = cfg.model;
  const warned = new Set<string>();
  const warn = (message: string) => { if (warned.has(message)) return; warned.add(message); emit({ type: 'warning', message }); };
  const recorded: { model: string; passes: string[][]; calls: ToolCall[] } = { model: cfg.model, passes: [], calls: [] };

  const wantFiles = (opts.useFilesApi ?? true) && process.env.BOS_FILES_API !== '0' && docs.some((d) => d.mode === 'native_pdf' && d.pdfBase64);
  const uploads = wantFiles ? await uploadPdfs(client, docs, emit, signal) : new Map<DocInput, string>();
  let useFiles = uploads.size > 0;
  if (useFiles) emit({ type: 'status', stage: 'ai', message: `Uploaded ${uploads.size} PDF(s) once with the Files API.` });

  try {
    // documents go to the model base first, amendments last (ties keep package order)
    const ordered = docs.map((d, i) => ({ d, r: docRank(d, i) })).sort((a, b) => a.r - b.r).map((x) => x.d);
    const passes = planPasses(planItems(ordered, uploads));
    const window = contextWindowOf(cfg.model);
    // Refusals and terminal API errors end the pass, not the run: what was registered is kept. They are thrown only when
    // nothing at all was registered (index.ts then falls back to the rule-based reader or reports the error).
    const registered = () => st.facilities.size + st.grounds.length + st.excludedGrounds.length;
    const failures: { err: Error; message: string; warned: boolean }[] = [];
    const fail = (err: Error, message: string) => { const warned = registered() > 0; if (warned) warn(message); failures.push({ err, message, warned }); };
    for (let p = 0; p < passes.length; p++) {
      const pass = passes[p];
      const names = [...new Set(pass.map((i) => i.doc.name))];
      beginPass(st, names);
      recorded.passes.push(names);
      emit({ type: 'status', stage: 'ai', message: passes.length > 1 ? `AI pass ${p + 1} of ${passes.length}: reading ${names.join(', ')}` : `Reading ${names.join(', ')} with ${cfg.model} (effort: ${cfg.effort ?? 'high'})` });

      let finished = false; let nudged = false; let turns = 0;
      let cont: Continuation | undefined;
      let ended = 'end' as PassEnd;
      let stopRun = false;
      // One conversation per pass, plus a fresh continuation conversation (same documents, everything registered so far
      // summarised in the intro) whenever one fills the context window. Continuations stay in the same pass: replays match.
      for (;;) {
        const intro: Anthropic.Beta.BetaTextBlockParam = { type: 'text', text: passIntro(docs, pass, p, passes.length, st, cont), cache_control: EPHEMERAL };
        const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: [...docBlocks(pass, useFiles), intro] }];
        // moving cache breakpoint: system + intro + the last block of the latest user turn = 3 of the 4 allowed
        let marked: { cache_control?: Anthropic.Beta.BetaCacheControlEphemeral | null } | undefined;
        const pushUser = (content: Anthropic.Beta.BetaContentBlockParam[]) => {
          if (marked) delete marked.cache_control;
          const last = content[content.length - 1] as { cache_control?: Anthropic.Beta.BetaCacheControlEphemeral | null };
          last.cache_control = EPHEMERAL; marked = last;
          messages.push({ role: 'user', content });
        };

        let convTurns = 0; let convApplied = 0; let carry: string | undefined; let full = 'filled';
        let firstInput = 0; // tokens of the conversation's first request (documents + intro): what a fresh conversation costs
        nudged = false;
        let outcome = 'end' as PassEnd;
        while (true) {
          if (turns >= maxTurns) { outcome = 'turns'; break; }
          if (signal?.aborted) throw new Error('Extraction cancelled');
          const params = buildParams(cfg, flags, messages, { system: SYSTEM, tools: extractionTools({ strict: flags.strict }), maxTokens: MAX_OUTPUT_TOKENS, cacheSystem: true });
          let msg: Anthropic.Beta.BetaMessage;
          try {
            msg = await streamTurn(client, params, emit, signal);
          } catch (err) {
            if (signal?.aborted) throw new Error('Extraction cancelled');
            if (convTurns === 0 && useFiles && fileSourceError(err)) {
              useFiles = false;
              messages[0] = { role: 'user', content: [...docBlocks(pass, false), intro] };
              emit({ type: 'status', stage: 'ai', message: `The API did not accept the uploaded file (${(err as Error).message.slice(0, 120)}); sending PDFs inline.` });
              continue;
            }
            if (err instanceof Anthropic.BadRequestError && PROMPT_TOO_LONG.test(err.message)) {
              // the tool history no longer fits: continue in a fresh conversation (other request options would not help)
              if (convTurns > 0) { outcome = 'context'; break; }
            } else if (err instanceof Anthropic.BadRequestError) {
              const step = stepDown(flags, err, turns === 0);
              if (step) { emit({ type: 'status', stage: 'ai', message: `Model rejected request options (${err.message.slice(0, 120)}). Retrying with ${step}.` }); continue; }
            }
            const e = err instanceof Error ? err : new Error(String(err));
            // a 400 is about this request's content (another pass may still be read); anything else (5xx / 429 after the
            // SDK's retries, auth, network) stops the run
            stopRun = !(err instanceof Anthropic.BadRequestError);
            fail(e, `AI pass ${p + 1} stopped after ${turns} turns because of an API error (${e.message.slice(0, 200)}); keeping what was registered so far - the inventory may be incomplete.`);
            outcome = 'error';
            break;
          }
          turns++; convTurns++;
          if (convTurns === 1) firstInput = contextTokens(msg.usage) - (msg.usage?.output_tokens ?? 0);
          servedModel = msg.model || servedModel;
          addUsage(usage, msg.usage);
          messages.push({ role: 'assistant', content: msg.content });

          if (msg.stop_reason === 'refusal') {
            const d = msg.stop_details && 'category' in msg.stop_details ? ` (${msg.stop_details.category ?? 'unspecified'})` : '';
            fail(new Error(`The model declined to process this document${d}.`), `AI pass ${p + 1} stopped after ${turns - 1} turns because the model declined to continue${d}; keeping what was registered so far - the inventory may be incomplete.`);
            outcome = 'refusal';
            break;
          }

          // max_tokens and model_context_window_exceeded both cut the output off mid-block
          const contextFull = msg.stop_reason === 'model_context_window_exceeded';
          const cutOff = msg.stop_reason === 'max_tokens' || contextFull;
          const toolUses = msg.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');
          if (!toolUses.length) {
            if (contextFull) { outcome = 'context'; break; }
            if (cutOff) { pushUser([{ type: 'text', text: 'You hit the output limit. Continue registering the remaining facilities and grounds in smaller batches; do not repeat items already registered.' }]); continue; }
            if (msg.stop_reason === 'pause_turn') { pushUser([{ type: 'text', text: 'Continue.' }]); continue; }
            if (!finished && !nudged) { nudged = true; pushUser([{ type: 'text', text: 'You ended your turn without calling finish. If every workload row is registered, call finish now (listing anything unresolved); otherwise continue registering.' }]); continue; }
            outcome = 'end';
            break;
          }

          // A tool_use cut off by the output limit is the last content block; it is answered with an error and never applied.
          const lastBlock = msg.content[msg.content.length - 1];
          const results: Anthropic.Beta.BetaContentBlockParam[] = [];
          const texts: string[] = [];
          for (const tu of toolUses) {
            const truncated = cutOff && tu === lastBlock;
            const r = applyToolCall(st, { name: tu.name, input: tu.input }, { truncated });
            recorded.calls.push({ name: tu.name, input: tu.input, pass: p, ...(truncated ? { truncated: true } : {}) });
            for (const e of r.events) { if (e.type !== 'warning') emit(e); else if (!(truncated && contextFull)) warn(e.message); }
            if (!r.isError) convApplied++;
            results.push({ type: 'tool_result', tool_use_id: tu.id, content: r.resultText, ...(r.isError ? { is_error: true } : {}) });
            texts.push(truncated && contextFull ? `${tu.name}: cut off when the context window filled up and NOT applied - resend those rows.` : `${tu.name}: ${r.resultText}`);
            if (tu.name === 'finish' && !r.isError) finished = true;
          }
          if (finished) { outcome = 'finish'; break; }
          carry = texts.join('\n').slice(0, 4000);
          // no further turn in a conversation whose context is full (it cannot fit): continue in a fresh one
          if (contextFull) { outcome = 'context'; break; }
          if (msg.stop_reason === 'max_tokens' && lastBlock?.type !== 'tool_use') results.push({ type: 'text', text: 'You hit the output limit. Continue in smaller batches.' });
          // the next request would not leave room for a full turn of output: continue in a fresh conversation instead,
          // when that frees real room (if the documents alone nearly fill the window, a fresh conversation would not help)
          const used = contextTokens(msg.usage);
          if (used + CONTEXT_HEADROOM > window && used - firstInput > CONTEXT_HEADROOM) { outcome = 'context'; full = 'nearly filled'; break; }
          pushUser(results);
        }
        if (outcome !== 'context') { ended = outcome; break; }
        if (convApplied === 0 || (cont?.n ?? 0) >= MAX_CONTINUATIONS) {
          warn(`AI pass ${p + 1} ${full} the model's context window after ${turns} turns ${convApplied === 0 ? 'without registering anything new' : `and ${MAX_CONTINUATIONS} continuations`}; stopped - the inventory may be incomplete.`);
          ended = 'context';
          break;
        }
        cont = { n: (cont?.n ?? 0) + 1, carry };
        warn(`AI pass ${p + 1} ${full} the model's context window after ${turns} turns; continuing in a fresh request (continuation ${cont.n}) with the ${st.facilities.size} facilities registered so far.`);
      }
      if (ended === 'end') warn(noFinishWarning(p + 1));
      else if (ended === 'turns') warn(`AI pass ${p + 1} stopped after ${maxTurns} turns without calling finish - the inventory may be incomplete.`);
      if (stopRun) {
        const unread = passes.slice(p + 1).flatMap((x) => x.map((i) => i.doc.name));
        if (unread.length) fail(failures[failures.length - 1].err, `Not read by the AI because of the error above: ${[...new Set(unread)].join(', ')}.`);
        break;
      }
    }
    if (failures.length && registered() === 0) throw failures[0].err;
    for (const f of failures) if (!f.warned) warn(f.message);

    const fin = finalize(st);
    // finalize repeats the per-pass "no finish" warning; keep the loop's more specific one (e.g. turn limit) instead
    const passAlreadyWarned = (w: string) => { const m = w.match(/^AI pass (\d+) /); return Boolean(m && [...warned].some((x) => x.startsWith(`AI pass ${m[1]} `))); };
    for (const w of fin.warnings) if (!passAlreadyWarned(w)) warn(w);
    return { inventory: fin.inventory, priorAward: fin.priorAward, usage, model: servedModel, warnings: [...warned] };
  } finally {
    if (opts.recordCallsTo) {
      try {
        await fs.mkdir(path.dirname(path.resolve(opts.recordCallsTo)), { recursive: true });
        await fs.writeFile(opts.recordCallsTo, JSON.stringify({ ...recorded, model: servedModel }, null, 1));
      } catch (err) { emit({ type: 'warning', message: `Could not record tool calls to ${opts.recordCallsTo}: ${(err as Error).message}` }); }
    }
    for (const id of uploads.values()) client.files.delete(id).catch(() => { /* expires in 24 h anyway */ });
  }
}

export const aiAvailable = () => Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

// ---------------------------------------------------------------------------------------------
// Top-down should-cost: the model proposes loaded-FTE cost and ODC / materials assumptions from
// the previous award and the bottom-up labor picture; the arithmetic runs in shared/topdown.ts.
// ---------------------------------------------------------------------------------------------

const TOPDOWN_SYSTEM = `You are the pricing lead on a base operations support (BOS) capture team. You cross-check a bottom-up labor estimate (RS Means-style productivity) against a top-down view backed into from the previous award or the incumbent's spend run-rate.

Formula the tool applies:
  annual_value (escalated to today) = raw annual value × (1 + escalation)^years_since_award
  cost_base = annual_value / ((1 + G&A) × (1 + fee))
  loaded_labor = cost_base − annual_value × ODC/materials share − annual_value × subcontract share
  implied_FTE = loaded_labor / loaded cost per FTE-year

Propose assumptions a seasoned estimator would defend for this scope and location:
- Loaded cost per FTE-year = base wage × 2,080 paid hours × load factor (SCA health & welfare, vacation/holiday, payroll taxes, site overhead and supervision not already in the headcount). Typical BOS custodial/grounds mixes land $48k–$75k; dining-heavy or high-wage-determination areas run higher. Give a base plus a low and high bound.
- ODC / materials share of price: custodial consumables and equipment ~4–7%; grounds adds mowing fleet, fuel and parts; dining full food service is usually government-furnished subsistence so only smallwares and chemicals. Say what you assumed.
- G&A and fee typical for a services prime (G&A 6–12%, fee 5–9%); subcontract pass-through if the scope implies it.
- Escalation and years since award if the award value is dated.
Then compare: state the implied FTE range against the bottom-up FTE, say which you trust more and why, name the biggest risks (scope changes, wage determination, incumbent under-staffing, option years), and give a recommended FTE to carry. If the package gives no award or spend value, still propose the assumptions, set basis to "none", and say what data to request.
Call report_top_down exactly once with the numbers; keep prose inside the tool's rationale field.`;

const topDownTool: Anthropic.Beta.BetaTool = {
  name: 'report_top_down',
  description: 'Report the top-down pricing assumptions and reconciliation.',
  input_schema: {
    type: 'object',
    properties: {
      loaded_cost_per_fte: { type: 'number', description: 'Base-case fully loaded $ per FTE-year.' },
      loaded_cost_low: { type: 'number' },
      loaded_cost_high: { type: 'number' },
      odc_materials_pct: { type: 'number', description: 'Share of price, 0–1.' },
      subcontract_pct: { type: 'number', description: 'Share of price, 0–1.' },
      ga_pct: { type: 'number', description: '0–1' },
      fee_pct: { type: 'number', description: '0–1' },
      escalation_pct: { type: 'number', description: 'Annual, 0–1' },
      years_since_award: { type: 'number' },
      basis: { type: 'string', enum: ['award', 'spend', 'annual', 'none'], description: 'Which prior value the implied FTE should be backed out of.' },
      annual_value_override: { type: ['number', 'null'], description: 'Use only if the package states an annual value the structured fields missed.' },
      rationale: { type: 'string', description: '4–8 sentences: assumptions, implied vs bottom-up, which to trust.' },
      risks: { type: 'array', items: { type: 'string' } },
      recommended_fte: { type: ['number', 'null'] },
    },
    required: ['loaded_cost_per_fte', 'loaded_cost_low', 'loaded_cost_high', 'odc_materials_pct', 'subcontract_pct', 'ga_pct', 'fee_pct', 'escalation_pct', 'years_since_award', 'basis', 'rationale', 'risks'],
  },
};

const TopDownIn = z.object({
  loaded_cost_per_fte: z.coerce.number().positive(),
  loaded_cost_low: z.coerce.number().positive(),
  loaded_cost_high: z.coerce.number().positive(),
  odc_materials_pct: z.coerce.number().min(0).max(0.6),
  subcontract_pct: z.coerce.number().min(0).max(0.8).default(0),
  ga_pct: z.coerce.number().min(0).max(0.4),
  fee_pct: z.coerce.number().min(0).max(0.3),
  escalation_pct: z.coerce.number().min(0).max(0.15).default(0.03),
  years_since_award: z.coerce.number().min(0).max(30).default(0),
  basis: z.string().default('none'),
  annual_value_override: z.coerce.number().positive().nullish(),
  rationale: z.string().default(''),
  risks: z.array(z.string()).default([]),
  recommended_fte: z.coerce.number().positive().nullish(),
});

export interface TopDownContext {
  priorAward?: PriorAward;
  est: EstimateResult;
  site: SiteInfo;
  overrides?: Partial<TopDownAssumptions>;
}

function describeContext(ctx: TopDownContext): string {
  const { est, priorAward: pa, site } = ctx;
  const basis = annualValueBasis(pa);
  const crews = est.crews.map((c) => `${c.label}: ${c.fte.toFixed(1)} FTE @ $${c.wage}/hr (${c.hours.toLocaleString()} h, $${c.annualCost.toLocaleString()} base wages)`).join('\n');
  return [
    `Installation: ${site.installationName ?? 'unknown'}${site.location ? `, ${site.location}` : ''}; solicitation ${site.solicitation ?? 'n/a'}; contract years ${site.contractYears ?? 'n/a'}; climate ${site.climateZone ?? 'n/a'}.`,
    `Scope metrics: ${est.metrics.facilitiesCount} facilities, ${est.metrics.grossSqft.toLocaleString()} gross SF (${est.metrics.cleanableSqft.toLocaleString()} cleanable), ${est.metrics.acres.toFixed(1)} acres of turf/grounds, ${est.metrics.pavedSqft.toLocaleString()} SF paved, ${est.metrics.mealsPerYear.toLocaleString()} meals/yr.`,
    `Bottom-up (RS Means-style) result: ${est.totalFte.toFixed(1)} FTE / ${est.totalHeadcount} heads, ${est.directHours.toLocaleString()} direct hours, $${est.totalLaborCost.toLocaleString()} base-wage labor. Crew mix:\n${crews}`,
    `Wage-weighted loaded cost per FTE implied by this mix at a ${(1.42).toFixed(2)} load factor: $${bottomUpLoadedCostPerFte(est).toLocaleString()}.`,
    pa ? `Previous award facts: ${JSON.stringify({ ...pa, source: pa.source?.excerpt })}. Derived annual value basis: ${basis.basis} ≈ $${Math.round(basis.value).toLocaleString()}/yr.` : 'Previous award facts: none found in the package and none entered.',
    ctx.overrides && Object.keys(ctx.overrides).length ? `Estimator-locked assumptions (keep these): ${JSON.stringify(ctx.overrides)}.` : '',
    `Current year: ${new Date().getFullYear()}.`,
  ].filter(Boolean).join('\n\n');
}

export async function topDownWithClaude(ctx: TopDownContext, cfg: AiConfig, emit?: Emit, signal?: AbortSignal, opts: { client?: Anthropic } = {}): Promise<{ topDown: TopDownEstimate; usage: AiUsage }> {
  const client = opts.client ?? new Anthropic({ maxRetries: 3, timeout: 10 * 60 * 1000 });
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: `${describeContext(ctx)}\n\nPropose the top-down assumptions and reconciliation now via report_top_down.` }];
  const usage: AiUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const flags = initialFlags(cfg.model); flags.strict = false;
  for (let attempt = 0; attempt < 4; attempt++) {
    let msg: Anthropic.Beta.BetaMessage;
    try {
      const params = buildParams(cfg, flags, messages, { system: TOPDOWN_SYSTEM, tools: [topDownTool], maxTokens: 16000 });
      msg = await client.beta.messages.stream(params, { signal }).finalMessage();
    } catch (err) {
      if (err instanceof Anthropic.BadRequestError && stepDown(flags, err, false)) continue;
      throw err;
    }
    addUsage(usage, msg.usage);
    if (msg.stop_reason === 'refusal') throw new Error('The model declined to produce the top-down estimate.');
    const tu = msg.content.find((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use' && b.name === 'report_top_down');
    if (!tu) {
      const text = msg.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text').map((b) => b.text).join(' ');
      messages.push({ role: 'assistant', content: msg.content }, { role: 'user', content: 'Please call report_top_down with the numbers now.' });
      if (text && emit) emit({ type: 'ai_text', text, kind: 'text' });
      continue;
    }
    const parsed = msg.stop_reason === 'max_tokens' ? undefined : TopDownIn.safeParse(tu.input);
    if (!parsed?.success) {
      const why = parsed ? `Invalid fields: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}` : 'The call was cut off by the output limit';
      messages.push({ role: 'assistant', content: msg.content }, { role: 'user', content: [{ type: 'tool_result', tool_use_id: tu.id, is_error: true, content: `${why}. Call report_top_down again.` }] });
      continue;
    }
    const d = parsed.data;
    const proposed: TopDownAssumptions = {
      loadedCostPerFte: Math.round(d.loaded_cost_per_fte), loadedCostLow: Math.round(Math.min(d.loaded_cost_low, d.loaded_cost_per_fte)), loadedCostHigh: Math.round(Math.max(d.loaded_cost_high, d.loaded_cost_per_fte)),
      odcMaterialsPct: d.odc_materials_pct, subcontractPct: d.subcontract_pct, gaPct: d.ga_pct, feePct: d.fee_pct, escalationPct: d.escalation_pct, yearsSinceAward: d.years_since_award,
    };
    const assumptions: TopDownAssumptions = { ...proposed, ...(ctx.overrides ?? {}) };
    let pa = ctx.priorAward;
    if (d.annual_value_override && !(pa?.annualValue)) pa = { ...(pa ?? {}), annualValue: d.annual_value_override, notes: [pa?.notes, 'Annual value supplied by the model from the package text.'].filter(Boolean).join(' | ') };
    const topDown = computeTopDown(pa, assumptions, ctx.est, { rationale: d.rationale, risks: d.risks, recommendedFte: d.recommended_fte ?? undefined, provider: 'claude', model: msg.model || cfg.model });
    return { topDown, usage };
  }
  throw new Error('The model did not return a top-down estimate.');
}

export function topDownHeuristic(ctx: TopDownContext): TopDownEstimate {
  const a: TopDownAssumptions = { ...heuristicAssumptions(ctx.est, ctx.priorAward), ...(ctx.overrides ?? {}) };
  const basis = annualValueBasis(ctx.priorAward);
  const rationale = basis.basis === 'none'
    ? 'No previous award or spend value is available, so the implied FTE cannot be backed out yet. Enter the incumbent contract value (or obligations to date) in the Previous award panel, or let the AI reader find it in the package. The assumptions shown are rule-based defaults: loaded cost per FTE from the bottom-up crew mix at a 1.42 load factor, ODC/materials scaled by the grounds share of the work.'
    : `Rule-based cross-check (no AI key configured). Annual value taken from the ${basis.basis} basis. Loaded cost per FTE is the wage-weighted bottom-up mix at a 1.42 load factor; ODC/materials assumed at ${(a.odcMaterialsPct * 100).toFixed(1)}% of price, G&A ${(a.gaPct * 100).toFixed(0)}% and fee ${(a.feePct * 100).toFixed(0)}%. Adjust the sliders to test sensitivity, or configure ANTHROPIC_API_KEY for a reasoned reconciliation.`;
  return computeTopDown(ctx.priorAward, a, ctx.est, { rationale, risks: basis.basis === 'none' ? ['Prior award value missing'] : ['Defaults not tuned to the local wage determination', 'ODC share is a rule of thumb'], provider: 'heuristic' });
}

export { DEFAULT_TOPDOWN };

// ---------------------------------------------------------------------------------------------
// Request preview for offline evaluation (scripts/sim-session.ts): exactly what the live loop sends the model on the
// first turn of each pass — system prompt, tool definitions, document blocks (native PDF or text) and the pass intro.
// ---------------------------------------------------------------------------------------------
export interface RequestPreview {
  system: string;
  tools: Anthropic.Beta.BetaTool[];
  passes: { names: string[]; intro: string; items: { title: string; doc: string; mode: 'native_pdf' | 'text'; pages?: number; text?: string }[] }[];
}
export function describeRequests(docs: DocInput[]): RequestPreview {
  const st = createState(docs);
  const ordered = docs.map((d, i) => ({ d, r: docRank(d, i) })).sort((a, b) => a.r - b.r).map((x) => x.d);
  const passes = planPasses(planItems(ordered, new Map()));
  return {
    system: SYSTEM,
    tools: extractionTools({ strict: true }),
    passes: passes.map((pass, p) => ({
      names: [...new Set(pass.map((i) => i.doc.name))],
      intro: passIntro(docs, pass, p, passes.length, st),
      items: pass.map((it) => ({ title: it.title, doc: it.doc.name, mode: it.doc.mode === 'native_pdf' && it.doc.pdfBase64 ? 'native_pdf' as const : 'text' as const, pages: it.doc.pages, text: it.text })),
    })),
  };
}
