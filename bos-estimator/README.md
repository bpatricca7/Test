# BOS Estimator — AI RFP workload reader, RS Means-style estimating, 3D live crew tracker

A base operations support (BOS) estimating workbench for government services contractors.
Drop a solicitation (PWS, technical exhibits, workload tables) and the app:

1. **Reads the RFP with Claude** (Opus 5.5 or Sonnet 5.5, switchable, effort up to `xhigh`/`max`) and
   registers every facility and grounds area it finds — name, building number, gross and cleanable
   square footage, floors, fixtures, service frequency, dining headcount — live, as it reads.
   Each item carries the source excerpt and a confidence score.
2. **Builds a 3D campus** from the inventory: buildings extruded from footprint and story count, turf
   pads, parking, walks, athletic fields and rough grounds laid out around them.
3. **Estimates with RS Means-style productivity factors** (labor-hours per unit × quantity × annual
   frequency) for custodial, periodic floor care, grounds (mowing, trimming, beds, trees, paving,
   snow) and dining facility full food service.
4. **Animates the crews**: a live tracker shows who is on shift, which building or field each crew is
   in and what task they are doing, on a 24-hour simulated clock. Enter a building for a cut-away
   view of floors, finishes and the custodial / floor care crews inside; switch to the grounds tab to
   watch the mowing and landscape crews on the attached acreage.
5. **Looks the part**: gradient sky that tracks the simulated clock, buildings with seeded lit
   windows after dark, street lights, bloom and vignette post-processing (toggle **Cinematic / Fast**
   in the viewport), a cyan scan sweep while the AI reads, and a slow idle orbit of the campus.
6. **Cross-checks top-down on every run.** The reader also pulls the incumbent / previous contract
   facts (contract number, award value, period, obligations to date) out of the package — or you type
   them into the *Previous award & spend* panel — and the AI proposes a fully loaded cost per FTE,
   an ODC / materials share, G&A, fee and escalation for this scope and location. The app backs
   into an implied FTE range (loaded labor ÷ loaded cost per FTE), shows it beside the RS Means
   bottom-up number with the delta and the AI's reconciliation, and lets you drag any assumption to
   test sensitivity. Spend run-rate wins over award ÷ period when both are known.
7. **Rolls up manning**: hours and FTE by crew, working supervision, headcount, base-year labor
   dollars and a per-contract-year manning table (base + options). Export everything to CSV.

## Quick start

```bash
cd bos-estimator
npm install
cp .env.example .env            # add ANTHROPIC_API_KEY=sk-ant-...
npm run dev                     # API on :8787, Vite client on :5173
```

Open http://localhost:5173, drop a PDF/DOCX/TXT solicitation (or click **Try sample RFP**) and
press **Analyze RFP**.

One-port mode: `npm run up` builds the client and serves it from the API server on
http://localhost:8787 (works on Windows, macOS and Linux; needs Node 20+).

Without an API key the server falls back to a rule-based parser that handles delimited workload
tables (it reads the built-in sample completely); the UI shows which reader produced the inventory.

## How the AI reader works

`server/ai.ts` streams a tool-use conversation with Claude. The documents are attached as native
PDF blocks (so tables, scanned pages and drawings are read visually) or as text, with prompt caching
on the document prefix. The model registers items through four tools — `register_facilities`,
`register_grounds`, `set_site_info`, `finish` — and every tool call is pushed to the browser over
server-sent events, so buildings rise out of the ground while the model is still reading. Large
packages are split into passes automatically; duplicates are merged by building number.

Model and effort are per-project settings (`claude-opus-5-5` / `claude-sonnet-5-5` presets or any
custom model id). Adaptive thinking is on, `output_config.effort` carries the chosen effort, and the
server-side refusal fallback (`fallbacks: "default"`) is enabled; the server automatically steps down
to plainer request parameters if an account or model rejects any of them.

## Estimating model

* `shared/factors.ts` — the factor library (51 lines) in RSMeans Facilities Maintenance & Repair
  format: task, reference family, crew, unit (MSF, fixture, acre, MSF bed/paved, tree, meal, day),
  labor-hours per unit and a frequency rule (per service day, N×/year, mowing cycles from the growing
  season, snow events, leaf season, dining days, meal periods, per meal). Category defaults (floor
  finish mix, cleanable share of gross, fixtures per 1,000 SF, typical stories) live in the same file.
  Recalibrated, new and benchmark-validated lines carry a short `basis` citation, shown in the dialog.
* `shared/estimate.ts` — deterministic engine: resolves each facility against the defaults, applies
  the factors, sums hours by crew, converts to FTE with productive hours per FTE (default 1,776),
  adds working supervision (default 1 per 12 FTE) and produces the per-year manning table with
  workload growth and wage escalation. Only `in_scope` facilities are estimated. Service levels run
  from daily (7 or 5 days) down to every two weeks, monthly and quarterly (26 / 12 / 4 visits a year),
  and routine custodial tasks never recur more often than the building is visited. Grounds may be
  given in acres, hectares, sq ft, m², sq yd or linear feet of walk. A dining facility with
  per-meal-period headcounts but no meals-per-day or meal-period figure is priced with
  `diningMealsPerDay`, the same rules the reader applies: a 7-day DFAC averages
  (5 × weekday sum + 2 × weekend sum) / 7, a 6-day DFAC (5 × weekday + 1 × weekend) / 6, and a 5-day
  DFAC uses the weekday sum. A 6–7-day DFAC that prints weekday figures only serves weekends like
  weekdays (a weekend-only table the same way round). The meal-period count is the number of weekday
  periods with a headcount, so weekend Brunch / Supper rows do not add periods; when no weekday period
  has a figure it counts the weekend periods, then every listed period, then 3.
* Every factor is editable in the **RS Means factors** dialog (or inline in a building's task table).
  Overrides are stored with the project and highlighted in yellow.
* **Calibration.** The defaults target APPA Level 2 ("ordinary tidiness") for daily custodial service.
  `tests/calibration.test.ts` keeps each composite inside its benchmark band:

  | Check (engine case) | Band | Before → after | Basis / source |
  |---|---|---|---|
  | Office, 100k cleanable SF, daily 5 days | 15,000–21,000 SF per custodian shift | 9,014 → 17,815 | APPA Level 2 (office 16,900), NCES L2, FL DOE 19,000 |
  | Barracks common areas, daily 7 days | 10,000–18,000 SF per shift | 7,073 → 11,847 | APPA Level 2, restroom-heavy |
  | Clinic, daily 7 days | 10,000–15,000 SF per shift | 7,872 → 12,441 | APPA Level 1–2; hospital EVS ≈1,300 SF/h (HFM) |
  | Warehouse, 2× per week | 40,000–90,000 SF per 5-day post | 40,181 → 63,341 | APPA Level 4–5 |
  | Floor care, 100k SF VCT | 1,200–2,400 h/yr; spray buff 2,000–3,000 SF/h | 2,010 h (unchanged) | 17" high-speed spray-buff rates (janitorial production tables), CRI LCC strip rates |
  | Floor care, 100k SF carpet | 400–900 h/yr; extraction 600–1,500 SF/h | 720 → 640 h | CMM / ISSA carpet rates, AICS time-motion study |
  | Improved turf, 30-week season | 30–50 acres per grounds FTE | 38.1 → 42.2 | AS&U M&O studies, APPA grounds levels, Cornell / Exmark mowing rates |
  | Athletic fields, 30-week season | 125–230 h per acre per year | 86.5 → 130.5 | Sports Field Managers Association: ≈250 h (native soil) to ≈415 h (heavy use) per 1.8–2-acre field-year |
  | Athletic fields, each climate's default season (w weeks) | 125 × min(1, w ÷ 30) to 230 × max(1, w ÷ 30) h/acre/yr: cold 24 wk 100–230, arid 34 wk 125–261, hot-humid 40 wk 125–307 | cold 108.7, arid 145.1, hot-humid 166.9 | Same, prorated by season length |
  | Snow, per event | 20–80 lh per 100k SF of walk; 5–20 lh per 10-acre lot | 45; 15.2 (unchanged) | Shovel / blower rates; SIMA plowing rates |
  | DFAC full food service, 2,000 meals/day | 6–9 meals per labor-hour | 8.15 → 7.77 | Fort Hood, Fort Leonard Wood, Keesler / NAS Meridian contracts |
  | DFAC attendants only | 12–22 meals per labor-hour | 16.89 (unchanged) | Derived (DFA ≈ 35–45 % of FFS labor) |
  | Built-in sample | 105–135 total FTE; ±20 % of the incumbent-implied FTE | 145.7 → 120.7 FTE; +30.5 % → +9.0 % | Previous award (synthetic sample) |

  APPA and NCES quote area per custodian on shift (8 h per service day). The engine's FTE is 1,776
  productive hours, so SF per FTE = SF per shift × 0.888 for 5-day service and × 0.617 for 7-day
  service. The sources are secondary summaries of paid publications (APPA *Operational Guidelines:
  Custodial*, ISSA 612, PGMS, RSMeans); they give plausible bands, not licensed line values.
* **Cleaning standard (APPA Level 1–3).** A project assumption with a per-facility override; the AI
  reader sets a facility's level when the document assigns it one APPA level. Appearance tasks scale
  (Level 1 ×1.75, Level 3 ×0.6, so a 100k SF office lands at ≈10.5K / ≈18K / ≈29K SF per custodian
  shift), restroom sanitation stays within 3–6 minutes per fixture, infection control and periodic
  work do not scale, and Level 1 does not raise medical buildings past their Level 1–2 calibration.
  Commercial janitorial contracts usually price near Level 3; BOS PWS standards near Level 2.
* `shared/topdown.ts` — the should-cost arithmetic: `price = (loaded labor + ODC + subs) × (1 + G&A)
  × (1 + fee)`, solved for loaded labor and divided by the loaded cost per FTE. `server/ai.ts`
  (`topDownWithClaude`) asks the model for the assumptions and a written reconciliation;
  `POST /api/projects/:id/topdown` re-runs it on demand after you edit the award facts or lock a
  slider.

> RSMeans data is licensed. The values shipped here are representative BOS estimating defaults;
> reconcile each line against your organization's current RSMeans edition before pricing a bid.

## Accuracy on RFPs the reader has not seen

Besides the 16 development fixtures in `tests/fixtures/`, three batches of held-out fixtures
(`tests/holdout/`, `tests/holdout-b2/`, `tests/holdout-b3/`) were written by agents that never saw the
reader code, modelled on public solicitations (NAVFAC, Air Force, VA, Army Reserve, Marine Corps,
county, university, airport and National Park Service packages, a three-file package with a separate
addendum, a long full BOS PWS and a scanned image-only exhibit). Each truth file was checked by a
second agent against the rendered document. First-run scores, before any fixes from that batch:

| Batch | AI reader (simulated) | Rule-based parser |
|---|---|---|
| 1 (4 packages) | 99.5 | 67.9 |
| 2 (4 packages) | 96.7 | 75.6 |
| 3 (4 packages) | 100 | 47.6 |

AI scores come from a stand-in model driving the real prompt and tool handlers
(`scripts/sim-session.ts`), because the build environment had no API key; the recorded calls replay
with `npx tsx scripts/eval.ts --provider replay --sim opus-sim tests/holdout*/*` (all 100 after
fixes). The rule-based parser reaches 100 on batches 1–2 after fixes but stays near 48 on batch 3:
it is a fallback for clean facility lists, and every row it reads is marked for review.

## Layout

```
bos-estimator/
  server/     Express API: document reading (pdf-parse, mammoth), Claude extraction, rule-based
              fallback, JSON project store, CSV export, SSE streaming
  shared/     Domain types, factor library, estimating engine (used by server and client)
  client/     Vite + React + react-three-fiber app: 3D site, cut-away buildings, instanced crews,
              live tracker, ingest panel, facility list, detail/estimate panels, factors dialog
  samples/    Fort Example PWS excerpt with custodial, grounds and dining technical exhibits
  tests/      node:test suite for the parser and the estimating engine (npm test)
  data/       Saved projects (git-ignored)
```

## Scripts

| command | what it does |
|---|---|
| `npm run dev` | API (`tsx watch`) + Vite dev server with proxy |
| `npm run build` | production client bundle into `dist/` |
| `npm start` | serve API + built client on one port |
| `npm test` | parser and estimator tests |
| `npm run typecheck` | TypeScript across server, shared and client |

Projects are addressed by URL: `http://localhost:5173/?project=fort-example` keeps a separate
inventory and overrides per solicitation.
