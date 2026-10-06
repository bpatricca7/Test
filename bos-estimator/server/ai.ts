// Claude-powered RFP reader. Streams the model's progress and registers facilities / grounds
// through tool calls so the 3D scene can grow while the document is still being read.
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import type { AiConfig, ExtractionEvent, Facility, GroundsArea, Inventory, PriorAward, SiteInfo, TopDownAssumptions, TopDownEstimate } from '../shared/types';
import type { EstimateResult } from '../shared/estimate';
import { DEFAULT_TOPDOWN, annualValueBasis, bottomUpLoadedCostPerFte, computeTopDown, heuristicAssumptions } from '../shared/topdown';
import { FACILITY_CATEGORIES, GROUNDS_KINDS, SERVICE_LEVELS } from '../shared/types';
import { categorize } from './heuristic';
import type { DocInput } from './extract';

type Emit = (e: ExtractionEvent) => void;

const PASS_TEXT_LIMIT = 2_400_000; // chars of plain text per request (~600k tokens)
const PASS_PAGE_LIMIT = 500; // native PDF pages per request (API limit is 600)
const MAX_TURNS = 60;

const SYSTEM = `You are a senior estimator for base operations support (BOS) contracts: custodial services, periodic floor care, grounds maintenance, and dining facility (full food service) operations on military installations and federal campuses.

You are reading a solicitation package (RFP / PWS / SOW, technical exhibits, workload data, facility lists, drawings, Q&A). Your job is to build a complete, accurate FACILITY AND GROUNDS INVENTORY for the estimate.

How to work:
1. Read everything first. Workload tables are usually in technical exhibits or attachments ("TE-3 Custodial Workload", "Attachment J-4 Facility List", "Exhibit B Grounds"). Facility lists can be split across pages; column headers may only appear once.
2. Register EVERY facility that requires custodial or floor care service, and the dining facility(ies) if food service is in scope. Use register_facilities in batches of up to 25. Do not stop until every row of every workload table is registered. If a list has 300 buildings, register all 300.
3. Square footage is the most important number. Copy it exactly as printed (strip commas). If the exhibit shows both gross and cleanable/serviced area, record both. If a value is in square yards or square meters, convert to square feet and say so in notes. If a building's area is genuinely missing, estimate it from the building type and set confidence ≤ 0.4 with a note explaining the assumption.
4. Capture service frequency (daily 5-day, daily 7-day, 3x/week, 2x/week, weekly), floors, restroom fixture counts, and floor finish mix when the document gives them. Leave fields null when the RFP is silent; the estimating engine applies category defaults.
5. Register grounds areas with register_grounds: improved / semi-improved / unimproved acreage, athletic fields, planting beds, parking lots, sidewalks, trees. Keep the document's unit (acres, SF, SY, LF, each). Tie an area to a building number when the document does; if one quantity is shared by several named buildings, split it evenly and register one area per building (say so in notes). Areas not tied to a building are fine as site-wide entries.
6. For a dining facility, fill the dining profile: average meals (headcount) per day, meal periods, days per week, seats, kitchen and dining room SF, and whether the requirement is full food service, dining facility attendant (DFA) only, or management only.
7. Call set_site_info once you know the installation, location, solicitation number, climate / growing season, and contract period (base + options).
8. Look hard for the PREVIOUS / INCUMBENT CONTRACT: incumbent name, contract number, award or ceiling value, period of performance, annual value, obligations or spend to date, award year. This often hides in the cover letter, sources-sought notice, Q&A, justification, or a "current contract" paragraph. Call set_previous_award with whatever you find (nulls for the rest) — the estimate backs into an FTE count from it. If nothing is stated, call it once with all values null and say so in notes.
9. Give each item a short source excerpt (the row or sentence you took the number from) and a page number when you can see one.
10. When everything is registered, call finish with a short summary and a list of anything unresolved (missing areas, ambiguous units, buildings mentioned in text but absent from the exhibit).

Never invent buildings that the documents do not mention. Prefer tool calls over prose; keep any narration to one or two short sentences.`;

const CAT_ENUM = FACILITY_CATEGORIES;
const LEVEL_ENUM = SERVICE_LEVELS.map((s) => s.id);
const KIND_ENUM = GROUNDS_KINDS.map((k) => k.id);

const tools: Anthropic.Beta.BetaTool[] = [
  {
    name: 'register_facilities',
    description: 'Register one or more facilities (buildings) that the contractor must service. Call repeatedly in batches of up to 25 until every facility in the workload exhibits is registered.',
    input_schema: {
      type: 'object',
      properties: {
        facilities: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              building_number: { type: ['string', 'null'], description: 'Building / facility number exactly as printed, e.g. "1201", "B-45", "P-114".' },
              name: { type: 'string', description: 'Facility name as printed.' },
              category: { type: 'string', enum: CAT_ENUM, description: 'Best-fit facility category.' },
              gross_sqft: { type: 'number', description: 'Gross square feet. 0 only if truly unknown (then also set confidence ≤ 0.4).' },
              cleanable_sqft: { type: ['number', 'null'], description: 'Cleanable / serviced square feet when the document distinguishes it.' },
              floors: { type: 'integer', description: 'Number of stories; 0 if not stated.' },
              restroom_fixtures: { type: ['integer', 'null'] },
              occupancy: { type: ['integer', 'null'] },
              service_level: { type: 'string', enum: LEVEL_ENUM, description: 'Routine cleaning frequency.' },
              scope: { type: 'array', items: { type: 'string', enum: ['custodial', 'floor_care', 'dining', 'grounds'] }, description: 'Which services apply to this facility.' },
              floor_mix: {
                type: ['object', 'null'],
                description: 'Fractions of floor area by finish if the RFP gives them (sum ≈ 1).',
                properties: { carpet: { type: 'number' }, resilient: { type: 'number' }, hard_tile: { type: 'number' }, concrete: { type: 'number' }, wood: { type: 'number' } },
              },
              dining: {
                type: ['object', 'null'],
                properties: {
                  seats: { type: ['integer', 'null'] },
                  meals_per_day: { type: 'number', description: 'Average total meals (headcount) per day across all meal periods.' },
                  meal_periods: { type: 'integer' },
                  days_per_week: { type: 'integer' },
                  kitchen_sqft: { type: ['number', 'null'] },
                  dining_room_sqft: { type: ['number', 'null'] },
                  service_style: { type: 'string', enum: ['full_food_service', 'dining_facility_attendant', 'management_only'] },
                },
                required: ['meals_per_day', 'meal_periods', 'days_per_week', 'service_style'],
              },
              source: {
                type: 'object',
                properties: { file: { type: ['string', 'null'] }, page: { type: ['integer', 'null'] }, excerpt: { type: 'string', description: 'The row or sentence the numbers came from (≤ 200 chars).' } },
                required: ['excerpt'],
              },
              confidence: { type: 'number', description: '0–1 confidence that name and square footage are correct.' },
              notes: { type: ['string', 'null'] },
              site_hint: { type: ['object', 'null'], description: 'Optional relative position on the installation (0–1 east, 0–1 north) if a map or area grouping is given.', properties: { x: { type: 'number' }, y: { type: 'number' } } },
            },
            required: ['name', 'category', 'gross_sqft', 'floors', 'service_level', 'scope', 'source', 'confidence'],
          },
        },
      },
      required: ['facilities'],
    },
  },
  {
    name: 'register_grounds',
    description: 'Register grounds maintenance areas (turf acreage, beds, parking, walks, trees).',
    input_schema: {
      type: 'object',
      properties: {
        areas: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              facility_building_number: { type: ['string', 'null'], description: 'Building number this area belongs to, if the document associates it.' },
              kind: { type: 'string', enum: KIND_ENUM },
              quantity: { type: 'number' },
              unit: { type: 'string', enum: ['acres', 'sqft', 'sqyd', 'lf', 'each'] },
              source: { type: 'object', properties: { file: { type: ['string', 'null'] }, page: { type: ['integer', 'null'] }, excerpt: { type: 'string' } }, required: ['excerpt'] },
              confidence: { type: 'number' },
              notes: { type: ['string', 'null'] },
            },
            required: ['name', 'kind', 'quantity', 'unit', 'source', 'confidence'],
          },
        },
      },
      required: ['areas'],
    },
  },
  {
    name: 'set_site_info',
    description: 'Record installation-level facts: name, location, solicitation, climate, growing season, contract period.',
    input_schema: {
      type: 'object',
      properties: {
        installation_name: { type: ['string', 'null'] },
        location: { type: ['string', 'null'] },
        solicitation: { type: ['string', 'null'] },
        contract_name: { type: ['string', 'null'] },
        climate_zone: { type: ['string', 'null'], enum: ['cold', 'temperate', 'hot_humid', 'arid', null] },
        growing_season_weeks: { type: ['integer', 'null'] },
        contract_years: { type: ['integer', 'null'], description: 'Total years including base and all option periods.' },
        notes: { type: ['string', 'null'] },
      },
    },
  },
  {
    name: 'set_previous_award',
    description: 'Record what the package says about the incumbent / previous contract and its value or spend.',
    input_schema: {
      type: 'object',
      properties: {
        incumbent: { type: ['string', 'null'] },
        contract_number: { type: ['string', 'null'] },
        contract_type: { type: ['string', 'null'], description: 'FFP, IDIQ, cost-plus, etc.' },
        total_value: { type: ['number', 'null'], description: 'Total award / ceiling value in dollars.' },
        period_months: { type: ['integer', 'null'], description: 'Months of performance that total_value covers (base + options).' },
        annual_value: { type: ['number', 'null'], description: 'Annual value in dollars if stated directly.' },
        spend_to_date: { type: ['number', 'null'], description: 'Obligated / invoiced dollars to date.' },
        spend_period_months: { type: ['integer', 'null'], description: 'Months covered by spend_to_date.' },
        award_year: { type: ['integer', 'null'] },
        source: { type: 'object', properties: { file: { type: ['string', 'null'] }, page: { type: ['integer', 'null'] }, excerpt: { type: 'string' } }, required: ['excerpt'] },
        confidence: { type: 'number' },
        notes: { type: ['string', 'null'] },
      },
      required: ['source', 'confidence'],
    },
  },
  {
    name: 'finish',
    description: 'Call once when every facility and grounds area has been registered.',
    input_schema: {
      type: 'object',
      properties: { summary: { type: 'string' }, unresolved: { type: 'array', items: { type: 'string' } } },
      required: ['summary', 'unresolved'],
    },
  },
];

// ---------- validation of tool inputs (lenient: coerce, default, never throw on one bad row) ----------
const nnum = z.coerce.number().nullish();
const FacilityIn = z.object({
  building_number: z.union([z.string(), z.number()]).nullish().transform((v) => (v == null ? undefined : String(v).trim())),
  name: z.string().min(1),
  category: z.string().default('other'),
  gross_sqft: z.coerce.number().nonnegative().default(0),
  cleanable_sqft: nnum,
  floors: z.coerce.number().int().nonnegative().default(0),
  restroom_fixtures: nnum,
  occupancy: nnum,
  service_level: z.string().default('daily_5'),
  scope: z.array(z.string()).default(['custodial', 'floor_care']),
  floor_mix: z.object({ carpet: nnum, resilient: nnum, hard_tile: nnum, concrete: nnum, wood: nnum }).nullish(),
  dining: z.object({ seats: nnum, meals_per_day: z.coerce.number().default(0), meal_periods: z.coerce.number().int().default(3), days_per_week: z.coerce.number().int().default(7), kitchen_sqft: nnum, dining_room_sqft: nnum, service_style: z.string().default('full_food_service') }).nullish(),
  source: z.object({ file: z.string().nullish(), page: nnum, excerpt: z.string().default('') }).default({ excerpt: '' }),
  confidence: z.coerce.number().min(0).max(1).default(0.7),
  notes: z.string().nullish(),
  site_hint: z.object({ x: z.coerce.number(), y: z.coerce.number() }).nullish(),
});
const GroundsIn = z.object({
  name: z.string().min(1),
  facility_building_number: z.union([z.string(), z.number()]).nullish().transform((v) => (v == null ? undefined : String(v).trim())),
  kind: z.string(),
  quantity: z.coerce.number().nonnegative(),
  unit: z.string().default('acres'),
  source: z.object({ file: z.string().nullish(), page: nnum, excerpt: z.string().default('') }).default({ excerpt: '' }),
  confidence: z.coerce.number().min(0).max(1).default(0.7),
  notes: z.string().nullish(),
});

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
export const facilityId = (bn: string | undefined, name: string) => `b-${slug(bn && bn.length ? bn : name) || 'x'}`;

function toFacility(raw: unknown, fallbackFile?: string): Facility | { error: string } {
  const p = FacilityIn.safeParse(raw);
  if (!p.success) return { error: p.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') };
  const d = p.data;
  const category = (CAT_ENUM as string[]).includes(d.category) ? (d.category as Facility['category']) : categorize(d.name);
  const serviceLevel = (LEVEL_ENUM as string[]).includes(d.service_level) ? (d.service_level as Facility['serviceLevel']) : 'daily_5';
  const scope = d.scope.filter((s) => ['custodial', 'floor_care', 'dining', 'grounds'].includes(s)) as Facility['scope'];
  const f: Facility = {
    id: facilityId(d.building_number, d.name),
    buildingNumber: d.building_number || undefined,
    name: d.name.trim(),
    category,
    grossSqft: d.gross_sqft,
    cleanableSqft: d.cleanable_sqft ?? undefined,
    floors: d.floors,
    restroomFixtures: d.restroom_fixtures ?? undefined,
    occupancy: d.occupancy ?? undefined,
    serviceLevel,
    scope: scope.length ? scope : ['custodial', 'floor_care'],
    confidence: d.confidence,
    notes: d.notes ?? undefined,
    source: { file: d.source.file ?? fallbackFile, page: d.source.page ?? undefined, excerpt: d.source.excerpt.slice(0, 240) },
    siteHint: d.site_hint ?? undefined,
  };
  if (d.floor_mix) f.floorMix = { carpet: d.floor_mix.carpet ?? 0, resilient: d.floor_mix.resilient ?? 0, hardTile: d.floor_mix.hard_tile ?? 0, concrete: d.floor_mix.concrete ?? 0, wood: d.floor_mix.wood ?? 0 };
  if (d.dining && d.dining.meals_per_day > 0) {
    f.dining = { seats: d.dining.seats ?? undefined, mealsPerDay: d.dining.meals_per_day, mealPeriods: d.dining.meal_periods, daysPerWeek: d.dining.days_per_week, kitchenSqft: d.dining.kitchen_sqft ?? undefined, diningRoomSqft: d.dining.dining_room_sqft ?? undefined, serviceStyle: (['full_food_service', 'dining_facility_attendant', 'management_only'].includes(d.dining.service_style) ? d.dining.service_style : 'full_food_service') as NonNullable<Facility['dining']>['serviceStyle'] };
    if (!f.scope.includes('dining')) f.scope.push('dining');
  }
  return f;
}

function toGrounds(raw: unknown, idx: number, fallbackFile?: string): GroundsArea | { error: string } {
  const p = GroundsIn.safeParse(raw);
  if (!p.success) return { error: p.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') };
  const d = p.data;
  const kind = (KIND_ENUM as string[]).includes(d.kind) ? (d.kind as GroundsArea['kind']) : 'improved_turf';
  const unit = (['acres', 'sqft', 'sqyd', 'lf', 'each'].includes(d.unit) ? d.unit : 'acres') as GroundsArea['unit'];
  return {
    id: `g-${idx}-${slug(d.name) || kind}`,
    name: d.name.trim(),
    facilityId: d.facility_building_number ? facilityId(d.facility_building_number, d.facility_building_number) : undefined,
    kind, quantity: d.quantity, unit,
    confidence: d.confidence, notes: d.notes ?? undefined,
    source: { file: d.source.file ?? fallbackFile, page: d.source.page ?? undefined, excerpt: d.source.excerpt.slice(0, 240) },
  };
}

export function mergeFacility(a: Facility, b: Facility): Facility {
  const [hi, lo] = b.confidence >= a.confidence ? [b, a] : [a, b];
  return {
    ...lo, ...hi,
    grossSqft: hi.grossSqft > 0 ? hi.grossSqft : lo.grossSqft,
    cleanableSqft: hi.cleanableSqft ?? lo.cleanableSqft,
    floors: hi.floors || lo.floors,
    restroomFixtures: hi.restroomFixtures ?? lo.restroomFixtures,
    occupancy: hi.occupancy ?? lo.occupancy,
    floorMix: hi.floorMix ?? lo.floorMix,
    dining: hi.dining ?? lo.dining,
    scope: [...new Set([...a.scope, ...b.scope])] as Facility['scope'],
    notes: [a.notes, b.notes].filter(Boolean).join(' | ') || undefined,
    confidence: Math.max(a.confidence, b.confidence),
  };
}

// ---------- request planning ----------
function planPasses(docs: DocInput[]): DocInput[][] {
  const passes: DocInput[][] = [];
  let cur: DocInput[] = []; let chars = 0; let pages = 0;
  for (const d of docs) {
    const dChars = d.mode === 'text' ? d.text.length : 0;
    const dPages = d.mode === 'native_pdf' ? d.pages ?? 1 : 0;
    if (cur.length && (chars + dChars > PASS_TEXT_LIMIT || pages + dPages > PASS_PAGE_LIMIT)) { passes.push(cur); cur = []; chars = 0; pages = 0; }
    cur.push(d); chars += dChars; pages += dPages;
  }
  if (cur.length) passes.push(cur);
  return passes;
}

function docBlocks(docs: DocInput[]): Anthropic.Beta.BetaContentBlockParam[] {
  const blocks: Anthropic.Beta.BetaContentBlockParam[] = [];
  for (const d of docs) {
    if (d.mode === 'native_pdf' && d.pdfBase64) {
      blocks.push({ type: 'document', title: d.name, source: { type: 'base64', media_type: 'application/pdf', data: d.pdfBase64 } });
    } else {
      // Split very long text so no single block is unwieldy.
      const parts = Math.max(1, Math.ceil(d.text.length / PASS_TEXT_LIMIT));
      for (let i = 0; i < parts; i++) {
        const slice = d.text.slice(i * PASS_TEXT_LIMIT, (i + 1) * PASS_TEXT_LIMIT);
        blocks.push({ type: 'document', title: parts > 1 ? `${d.name} (part ${i + 1}/${parts})` : d.name, source: { type: 'text', media_type: 'text/plain', data: slice || '(empty document)' } });
      }
    }
  }
  return blocks;
}

const isCurrentGen = (m: string) => /claude-(opus|sonnet)-5|fable|mythos|claude-opus-4-[678]|claude-sonnet-4-6/.test(m);
const supportsFallbacks = (m: string) => /claude-(opus|sonnet)-5|fable|mythos/.test(m);

type Variant = 'full' | 'no_fallbacks' | 'bare';

type StreamParams = Parameters<Anthropic['beta']['messages']['stream']>[0];

function buildParams(cfg: AiConfig, variant: Variant, messages: Anthropic.Beta.BetaMessageParam[]): StreamParams {
  const base: StreamParams = {
    model: cfg.model,
    max_tokens: 64000,
    system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
    tools,
    tool_choice: { type: 'auto' },
    messages,
  };
  if (variant === 'bare' || !isCurrentGen(cfg.model)) return base;
  base.thinking = { type: 'adaptive', display: 'summarized' };
  base.output_config = { effort: cfg.effort };
  if (variant === 'full' && supportsFallbacks(cfg.model)) {
    base.betas = ['server-side-fallback-2026-07-01'];
    base.fallbacks = 'default';
  }
  return base;
}

export async function extractWithClaude(docs: DocInput[], cfg: AiConfig, emit: Emit, signal?: AbortSignal): Promise<{ inventory: Inventory; priorAward?: PriorAward; usage: { input: number; output: number }; model: string }> {
  const client = new Anthropic({ maxRetries: 3, timeout: 30 * 60 * 1000 });
  const facilities = new Map<string, Facility>();
  const grounds: GroundsArea[] = [];
  let site: SiteInfo = {};
  let priorAward: PriorAward | undefined;
  const usage = { input: 0, output: 0 };
  let gIdx = 0;
  let servedModel = cfg.model;

  const passes = planPasses(docs);
  for (let p = 0; p < passes.length; p++) {
    const pass = passes[p];
    emit({ type: 'status', stage: 'ai', message: passes.length > 1 ? `AI pass ${p + 1} of ${passes.length}: reading ${pass.map((d) => d.name).join(', ')}` : `Reading ${pass.map((d) => d.name).join(', ')} with ${cfg.model} (effort: ${cfg.effort})` });

    const already = [...facilities.values()].map((f) => `${f.buildingNumber ?? ''} ${f.name}`.trim());
    const intro = [
      `Solicitation package, ${pass.length} document(s).`,
      passes.length > 1 ? `This is pass ${p + 1} of ${passes.length}. ${already.length ? `Facilities already registered in earlier passes (do not re-register unless you find corrected data): ${already.slice(0, 400).join('; ')}` : ''}` : '',
      'Build the complete facility and grounds inventory using the tools. Start with set_site_info if the installation is identifiable, then register facilities table by table, then grounds, then finish.',
    ].filter(Boolean).join('\n\n');

    const first: Anthropic.Beta.BetaContentBlockParam[] = [...docBlocks(pass), { type: 'text', text: intro, cache_control: { type: 'ephemeral' } }];
    const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: first }];

    let variant: Variant = 'full';
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      if (signal?.aborted) throw new Error('Extraction cancelled');
      let msg: Anthropic.Beta.BetaMessage;
      try {
        const stream = client.beta.messages.stream(buildParams(cfg, variant, messages), { signal });
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
        msg = await stream.finalMessage();
      } catch (err) {
        if (err instanceof Anthropic.BadRequestError && variant !== 'bare') {
          // Account / model combinations that reject fallbacks, effort or adaptive thinking: step down and retry.
          const next: Variant = variant === 'full' ? 'no_fallbacks' : 'bare';
          emit({ type: 'status', stage: 'ai', message: `Model rejected request options (${err.message.slice(0, 120)}). Retrying with ${next === 'bare' ? 'basic parameters' : 'no server-side fallback'}.` });
          variant = next; turn -= 1; continue;
        }
        throw err;
      }

      servedModel = msg.model || servedModel;
      usage.input += (msg.usage.input_tokens ?? 0) + (msg.usage.cache_read_input_tokens ?? 0) + (msg.usage.cache_creation_input_tokens ?? 0);
      usage.output += msg.usage.output_tokens ?? 0;
      messages.push({ role: 'assistant', content: msg.content });

      if (msg.stop_reason === 'refusal') {
        const d = msg.stop_details && 'category' in msg.stop_details ? ` (${msg.stop_details.category ?? 'unspecified'})` : '';
        throw new Error(`The model declined to process this document${d}.`);
      }

      const toolUses = msg.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');
      if (toolUses.length === 0) {
        if (msg.stop_reason === 'max_tokens') { messages.push({ role: 'user', content: 'You hit the output limit. Continue registering the remaining facilities and grounds; do not repeat items already registered.' }); continue; }
        if (msg.stop_reason === 'pause_turn') continue;
        break; // end_turn without tools → done with this pass
      }

      let finished = false;
      const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
      for (const tu of toolUses) {
        const input = (tu.input ?? {}) as Record<string, unknown>;
        let text = '';
        try {
          if (tu.name === 'register_facilities') {
            const rows = Array.isArray(input.facilities) ? input.facilities : [];
            const ok: string[] = []; const bad: string[] = [];
            for (const row of rows) {
              const f = toFacility(row, pass[0]?.name);
              if ('error' in f) { bad.push(f.error); continue; }
              const merged = facilities.has(f.id) ? mergeFacility(facilities.get(f.id)!, f) : f;
              facilities.set(f.id, merged);
              emit({ type: 'facility', facility: merged });
              ok.push(`${merged.buildingNumber ?? ''} ${merged.name} (${merged.grossSqft.toLocaleString()} SF)`.trim());
            }
            const zero = rows.length ? [...facilities.values()].filter((f) => f.grossSqft <= 0).map((f) => f.name) : [];
            text = `Registered ${ok.length} facilities (total so far ${facilities.size}).${bad.length ? ` Rejected ${bad.length} rows: ${bad.slice(0, 3).join(' | ')}` : ''}${zero.length ? ` Facilities still missing square footage: ${zero.slice(0, 10).join(', ')} — estimate and flag if the document never states them.` : ''}`;
          } else if (tu.name === 'register_grounds') {
            const rows = Array.isArray(input.areas) ? input.areas : [];
            let n = 0; const bad: string[] = [];
            for (const row of rows) {
              gIdx += 1;
              const g = toGrounds(row, gIdx, pass[0]?.name);
              if ('error' in g) { bad.push(g.error); continue; }
              if (g.facilityId && !facilities.has(g.facilityId)) g.facilityId = undefined;
              grounds.push(g); n += 1;
              emit({ type: 'grounds', area: g });
            }
            text = `Registered ${n} grounds areas (total so far ${grounds.length}).${bad.length ? ` Rejected: ${bad.slice(0, 3).join(' | ')}` : ''}`;
          } else if (tu.name === 'set_site_info') {
            const s = input as Record<string, unknown>;
            site = {
              ...site,
              installationName: str(s.installation_name) ?? site.installationName,
              location: str(s.location) ?? site.location,
              solicitation: str(s.solicitation) ?? site.solicitation,
              contractName: str(s.contract_name) ?? site.contractName,
              climateZone: (['cold', 'temperate', 'hot_humid', 'arid'].includes(String(s.climate_zone)) ? (s.climate_zone as SiteInfo['climateZone']) : site.climateZone),
              growingSeasonWeeks: numOr(s.growing_season_weeks) ?? site.growingSeasonWeeks,
              contractYears: numOr(s.contract_years) ?? site.contractYears,
              notes: str(s.notes) ?? site.notes,
            };
            emit({ type: 'site', site });
            text = 'Site info recorded.';
          } else if (tu.name === 'set_previous_award') {
            const a = input as Record<string, unknown>;
            const src = (a.source ?? {}) as Record<string, unknown>;
            const next: PriorAward = {
              incumbent: str(a.incumbent), contractNumber: str(a.contract_number), contractType: str(a.contract_type),
              totalValue: numOr(a.total_value), periodMonths: numOr(a.period_months), annualValue: numOr(a.annual_value),
              spendToDate: numOr(a.spend_to_date), spendPeriodMonths: numOr(a.spend_period_months), awardYear: numOr(a.award_year),
              source: { file: str(src.file) ?? pass[0]?.name, page: numOr(src.page), excerpt: (str(src.excerpt) ?? '').slice(0, 240) },
              confidence: Math.max(0, Math.min(1, numOr(a.confidence) ?? 0.5)), notes: str(a.notes),
            };
            const hasValue = Boolean(next.totalValue || next.annualValue || next.spendToDate);
            priorAward = priorAward && !hasValue ? { ...priorAward, notes: [priorAward.notes, next.notes].filter(Boolean).join(' | ') || undefined } : { ...(priorAward ?? {}), ...Object.fromEntries(Object.entries(next).filter(([, v]) => v !== undefined)) } as PriorAward;
            emit({ type: 'prior_award', award: priorAward });
            text = hasValue ? `Previous award recorded (${annualValueBasis(priorAward).basis} basis ≈ $${Math.round(annualValueBasis(priorAward).value).toLocaleString()}/yr).` : 'Noted: no award value in the package.';
          } else if (tu.name === 'finish') {
            finished = true;
            const unresolved = Array.isArray(input.unresolved) ? (input.unresolved as unknown[]).map(String) : [];
            emit({ type: 'ai_text', text: `Finished: ${String(input.summary ?? '')}${unresolved.length ? `\nUnresolved: ${unresolved.join('; ')}` : ''}`, kind: 'text' });
            if (unresolved.length) site = { ...site, notes: [site.notes, `Unresolved: ${unresolved.join('; ')}`].filter(Boolean).join('\n') };
            text = 'Acknowledged.';
          } else text = `Unknown tool ${tu.name}`;
        } catch (err) {
          results.push({ type: 'tool_result', tool_use_id: tu.id, is_error: true, content: `Tool failed: ${(err as Error).message}` });
          continue;
        }
        results.push({ type: 'tool_result', tool_use_id: tu.id, content: text });
      }
      messages.push({ role: 'user', content: results });
      if (finished) break;
    }
  }

  return { inventory: { site, facilities: [...facilities.values()], grounds }, priorAward, usage, model: servedModel };
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const numOr = (v: unknown) => (typeof v === 'number' && isFinite(v) ? v : typeof v === 'string' && v.trim() && isFinite(Number(v)) ? Number(v) : undefined);

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

export async function topDownWithClaude(ctx: TopDownContext, cfg: AiConfig, emit?: Emit, signal?: AbortSignal): Promise<{ topDown: TopDownEstimate; usage: { input: number; output: number } }> {
  const client = new Anthropic({ maxRetries: 3, timeout: 10 * 60 * 1000 });
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: `${describeContext(ctx)}\n\nPropose the top-down assumptions and reconciliation now via report_top_down.` }];
  const usage = { input: 0, output: 0 };
  let variant: Variant = 'full';
  for (let attempt = 0; attempt < 3; attempt++) {
    let msg: Anthropic.Beta.BetaMessage;
    try {
      const params = buildParams(cfg, variant, messages);
      params.system = [{ type: 'text', text: TOPDOWN_SYSTEM }];
      params.tools = [topDownTool];
      params.max_tokens = 16000;
      const stream = client.beta.messages.stream(params, { signal });
      msg = await stream.finalMessage();
    } catch (err) {
      if (err instanceof Anthropic.BadRequestError && variant !== 'bare') { variant = variant === 'full' ? 'no_fallbacks' : 'bare'; continue; }
      throw err;
    }
    usage.input += (msg.usage.input_tokens ?? 0) + (msg.usage.cache_read_input_tokens ?? 0) + (msg.usage.cache_creation_input_tokens ?? 0);
    usage.output += msg.usage.output_tokens ?? 0;
    if (msg.stop_reason === 'refusal') throw new Error('The model declined to produce the top-down estimate.');
    const tu = msg.content.find((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use' && b.name === 'report_top_down');
    if (!tu) {
      const text = msg.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text').map((b) => b.text).join(' ');
      messages.push({ role: 'assistant', content: msg.content }, { role: 'user', content: 'Please call report_top_down with the numbers now.' });
      if (text && emit) emit({ type: 'ai_text', text, kind: 'text' });
      continue;
    }
    const parsed = TopDownIn.safeParse(tu.input);
    if (!parsed.success) {
      messages.push({ role: 'assistant', content: msg.content }, { role: 'user', content: [{ type: 'tool_result', tool_use_id: tu.id, is_error: true, content: `Invalid fields: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}. Call report_top_down again.` }] });
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
