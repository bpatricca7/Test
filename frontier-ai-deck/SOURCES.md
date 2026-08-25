# Data & sources — frontier AI scale trajectory (draft v2, Aug 2026)

> v2: per review feedback, the slide-2 chart window now starts at GPT-3.5 (ChatGPT era).
> Earlier models stay in this table as off-chart context.

Every number plotted on slide 2, with its epistemic status. **Bold = disclosed by the lab**;
everything else is a third-party estimate or an unconfirmed claim, and is drawn hollow /
dashed with a range bar on the chart. "Total capacity" counts all mixture-of-experts (MoE)
experts; active-per-token counts are typically 5–10× lower.

## OpenAI series

| Model | Date | Plotted (range) | Status | Source |
|---|---|---|---|---|
| **GPT-1** *(off-chart context)* | Jun 2018 | **117M** | Disclosed (paper) | OpenAI GPT-1 paper |
| **GPT-2** *(off-chart context)* | Feb 2019 | **1.5B** | Disclosed | OpenAI GPT-2 report |
| **GPT-3** *(off-chart context)* | May 2020 | **175B** | Disclosed (paper) | Brown et al. 2020 |
| GPT-3.5 | Nov 2022 | ~175B | Estimate — undisclosed; plotted at its GPT-3 lineage size (turbo variants likely far smaller; a ~20B claim in a Microsoft paper was retracted) | GPT-3 paper lineage; press analyses |
| GPT-4 | Mar 2023 | ~1.8T (1.5–2T) | Estimate — MoE, 16×111B experts, ~280B active/token | SemiAnalysis leak (Jul 2023), widely corroborated, never confirmed by OpenAI |
| GPT-4o | May 2024 | ~200B (150–300B) | Estimate | Epoch AI, "Frontier language models have become much smaller" |
| GPT-4.5 "Orion" | Feb 2025 | ~4.5T (4–5T) | Analyst estimate; OpenAI called it its largest model to date | Analyst reports (e.g., CometAPI roundup) |
| GPT-5 | Aug 2025 | ~4T (3–5T) | Leaked estimate; other claims range far wider (dense-equivalent ~1.7T to tens of T total MoE) | Samsung SemiCon Taiwan slide leak; press analyses |
| GPT-5.6 (Luna/Terra/Sol) | Jul 9, 2026 | none (3–8T shown as dashed "?") | Undisclosed — no credible estimate yet; bar is our assumption "at least GPT-5-class" | OpenAI / TechCrunch / CNBC launch coverage (capabilities only) |

## Anthropic series

| Model | Date | Plotted (range) | Status | Source |
|---|---|---|---|---|
| **RL-CAI 52B** (Claude research predecessor) | Dec 2022 | **52B** | Disclosed in research papers | Anthropic constitutional-AI research line (LifeArchitect summary) |
| Claude 2 | Jul 2023 | ~130B (100–200B) | Weak third-party estimate | TextCortex / LifeArchitect-style estimates |
| Claude 3 Opus | Mar 2024 | ~2T (1–2.5T) | Estimate (dense assumption) | LifeArchitect (Alan D. Thompson) |
| Claude 3.5 Sonnet | Jun 2024 | ~400B (300–500B) | Estimate | Epoch AI (same analysis as GPT-4o) |
| Claude Opus 4.6 | early 2026 | ~5T (4–6T) | Third-party analysis (MoE); Elon Musk publicly claimed "Opus 5T / Sonnet 1T" (version ambiguity noted) | unexcitedneurons Substack (Feb 2026); 36kr coverage of Musk claim |
| Claude Fable 5 / Mythos 5 | Jun 9, 2026 | ~10T (8–12T) | Widely cited, **unconfirmed** — Anthropic has not stated a count | Press/analyst claims (e.g., "first 10T-parameter model" commentary) |

## Trend & scenario inputs (slide 3)

| Claim | Status | Source |
|---|---|---|
| Frontier training compute grows ×4–5 / year (2010–2024; ×4 since 2018) | Verified analysis | Epoch AI, "Training compute of frontier AI models grows by 4-5x per year" |
| ×4/yr feasible through 2030, needing >5 GW training power | Published projection | Epoch AI power-demand analyses |
| 2026 frontier runs: 1e26–1e27 FLOPs, $200–500M | Published estimate | Epoch AI / derived press analyses |
| Next-gen at 8–10T total parameters, another major capability leap | **Scenario — this team's planning assumption**, not a forecast | Sponsor's working expectation; benchmarked against the table above |

## Honesty rules used in the deck

1. Disclosed vs estimated is encoded visually (filled vs hollow markers, dashed = unconfirmed).
2. Ranges reflect the spread of published estimates, not lab guidance.
3. MoE total ≠ active parameters; the chart plots total capacity and says so.
4. The 2024 "efficiency dip" (GPT-4o, Claude 3.5 Sonnet smaller than predecessors) is shown, not smoothed away.
5. The 8–10T band is labeled as a scenario on the chart itself.
6. Chart legibility note: Fable 5 and GPT-5.6 markers are nudged ~3 weeks apart horizontally
   (true dates Jun 9 / Jul 9, 2026) so their range bars don't overlap; dates are stated in labels/notes.

## Link list

- https://openai.com/index/previewing-gpt-5-6-sol/
- https://techcrunch.com/2026/07/09/openai-launches-its-new-family-of-models-with-gpt-5-6/
- https://www.cnbc.com/2026/07/08/openai-expanding-gpt-5point6-ai-model-release-ending-government-limits.html
- https://www.cnbc.com/2026/06/09/anthropic-mythos-claude-fable-5.html
- https://www.anthropic.com/news/claude-fable-5-mythos-5
- https://epoch.ai/gradient-updates/frontier-language-models-have-become-much-smaller
- https://epoch.ai/publications/training-compute-of-frontier-ai-models-grows-by-4-5x-per-year
- https://epoch.ai/blog/power-demands-of-frontier-ai-training
- https://patmcguinness.substack.com/p/gpt-4-details-revealed (SemiAnalysis GPT-4 summary)
- https://lifearchitect.ai/gpt-5/ and https://lifearchitect.ai/anthropic/
- https://www.cometapi.com/how-many-parameters-does-gpt-5-have/
- https://unexcitedneurons.substack.com/p/estimating-the-size-of-claude-opus
- https://eu.36kr.com/en/p/3760679047267075 (Musk parameter claim)
