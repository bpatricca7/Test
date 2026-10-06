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
5. **Rolls up manning**: hours and FTE by crew, working supervision, headcount, base-year labor
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

Production build: `npm run build && npm start` serves the bundled client from the API server on
http://localhost:8787.

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

* `shared/factors.ts` — the factor library (49 lines) in RSMeans Facilities Maintenance & Repair
  format: task, reference family, crew, unit (MSF, fixture, acre, MSF bed/paved, tree, meal, day),
  labor-hours per unit and a frequency rule (per service day, N×/year, mowing cycles from the growing
  season, snow events, leaf season, dining days, meal periods, per meal). Category defaults (floor
  finish mix, cleanable share of gross, fixtures per 1,000 SF, typical stories) live in the same file.
* `shared/estimate.ts` — deterministic engine: resolves each facility against the defaults, applies
  the factors, sums hours by crew, converts to FTE with productive hours per FTE (default 1,776),
  adds working supervision (default 1 per 12 FTE) and produces the per-year manning table with
  workload growth and wage escalation.
* Every factor is editable in the **RS Means factors** dialog (or inline in a building's task table).
  Overrides are stored with the project and highlighted in yellow.

> RSMeans data is licensed. The values shipped here are representative BOS estimating defaults;
> reconcile each line against your organization's current RSMeans edition before pricing a bid.

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
