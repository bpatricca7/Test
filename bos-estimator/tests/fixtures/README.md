# RFP test fixtures

Each directory is one solicitation package with known answers.

| file | purpose |
|---|---|
| `truth.json` | ground truth (see `tests/harness/truth.ts`): inputs to render, expected facilities / grounds / dining / prior award, provenance and traps |
| `*.html`, `*.csv`, `*.json`, `*.txt` | sources; `npm run fixtures` renders them into `build/` as PDF, scanned (image-only) PDF, DOCX or XLSX |
| `README.md` | where the format comes from (real document URLs, what is copied verbatim vs illustrative) |
| `sim/*.calls.json` | recorded tool calls from a model run, replayable with `npm run eval -- --provider replay <dir>` |

Fidelity levels: `real-rows` (rows copied from a real public document), `real-format` (real exhibit layout and wording,
illustrative values), `synthetic` (built to exercise one failure mode).

```bash
npm run fixtures                       # render every fixture
npm run eval                           # score the rule-based reader on all fixtures
npm run eval -- --provider claude      # score Claude (needs ANTHROPIC_API_KEY)
npm run eval -- --provider claude ~/rfp/*.pdf   # run on your own solicitation, no scoring
```
