// Builds frontier-ai-scale-trajectory.pptx — 3 draft slides for iterative review.
// Slide 1: present state · Slide 2: combined scale-trajectory chart · Slide 3: 8-10T scenario
const pptxgen = require("pptxgenjs");

const T = {
  bg: "0B1220", card: "121C30", cardLine: "26334F", cardDeep: "0E1830",
  ink: "F2F6FD", ink2: "C6D2E8", ink3: "8CA0C4", ink4: "6E7F9E",
  oaiText: "3FC5A6", oaiMark: "18A184",
  antText: "E39066", antMark: "CC6C38",
  scnText: "A79BF9", scnMark: "8B7BF7",
};
const FONT = "Calibri";

const pres = new pptxgen();
pres.layout = "LAYOUT_WIDE"; // 13.33 x 7.5

function card(slide, x, y, w, h, fill) {
  slide.addShape("roundRect", {
    x, y, w, h, rectRadius: 0.09,
    fill: { color: fill || T.card }, line: { color: T.cardLine, width: 1 },
  });
}
function chipShape(slide, x, y, w, h, text, color, filled) {
  slide.addShape("roundRect", {
    x, y, w, h, rectRadius: 0.07,
    fill: filled ? { color, transparency: 78 } : { color: T.cardDeep },
    line: { color, width: 1.25 },
  });
  slide.addText(text, {
    x, y: y - 0.012, w, h, align: "center", valign: "middle", margin: 0,
    fontFace: FONT, fontSize: 9.5, bold: true, color, charSpacing: 1.5,
  });
}

// ============================== SLIDE 1 ==============================
{
  const s = pres.addSlide();
  s.background = { color: T.bg };

  s.addText("FRONTIER AI · SCALE & CAPABILITY TRAJECTORY   —   DRAFT v1 FOR REVIEW · AUG 2026", {
    x: 0.55, y: 0.3, w: 12.2, h: 0.3, margin: 0,
    fontFace: FONT, fontSize: 10.5, color: T.ink4, charSpacing: 2,
  });
  s.addText("The frontier today: two labs define the edge", {
    x: 0.55, y: 0.6, w: 12.2, h: 0.62, margin: 0,
    fontFace: FONT, fontSize: 33, bold: true, color: T.ink,
  });
  s.addText("Both shipped new flagships in summer 2026. Capabilities and pricing are public — parameter counts are not.", {
    x: 0.55, y: 1.26, w: 12.2, h: 0.36, margin: 0,
    fontFace: FONT, fontSize: 14.5, color: T.ink2,
  });

  const cy = 1.84, ch = 4.28;
  // ---- OpenAI card ----
  card(s, 0.55, cy, 6.0, ch);
  chipShape(s, 0.85, cy + 0.28, 1.05, 0.32, "OPENAI", T.oaiText, true);
  s.addText("GPT-5.6", {
    x: 0.85, y: cy + 0.68, w: 5.4, h: 0.55, margin: 0,
    fontFace: FONT, fontSize: 28, bold: true, color: T.ink,
  });
  s.addText("Released July 9, 2026 · three variants: Luna (fast) · Terra (balanced) · Sol (most capable)", {
    x: 0.85, y: cy + 1.26, w: 5.45, h: 0.5, margin: 0,
    fontFace: FONT, fontSize: 11.5, color: T.ink3,
  });
  s.addText(
    [
      { text: "Aimed at enterprise work, coding, scientific research, and cyberdefense — billed by OpenAI as its “strongest cybersecurity model yet”", options: { bullet: { code: "2022" }, breakLine: true, paraSpaceAfter: 7 } },
      { text: "Sol: 54% more token-efficient on coding tasks than prior models (OpenAI claim)", options: { bullet: { code: "2022" }, breakLine: true, paraSpaceAfter: 7 } },
      { text: "Emphasis on design judgment and safeguards that hold under “real-world adversarial pressure”", options: { bullet: { code: "2022" }, breakLine: false } },
    ],
    { x: 0.85, y: cy + 1.82, w: 5.45, h: 1.7, margin: 0, fontFace: FONT, fontSize: 12.5, color: T.ink2, valign: "top" }
  );
  chipShape(s, 0.85, cy + 3.68, 2.95, 0.34, "PARAMETERS: NOT DISCLOSED", T.ink3, false);

  // ---- Anthropic card ----
  card(s, 6.78, cy, 6.0, ch);
  chipShape(s, 7.08, cy + 0.28, 1.35, 0.32, "ANTHROPIC", T.antText, true);
  s.addText("Claude Fable 5", {
    x: 7.08, y: cy + 0.68, w: 5.4, h: 0.55, margin: 0,
    fontFace: FONT, fontSize: 28, bold: true, color: T.ink,
  });
  s.addText("Released June 9, 2026 · first “Mythos-class” model · same underlying model as restricted-access Claude Mythos 5", {
    x: 7.08, y: cy + 1.26, w: 5.45, h: 0.5, margin: 0,
    fontFace: FONT, fontSize: 11.5, color: T.ink3,
  });
  s.addText(
    [
      { text: "Fable 5 = broad availability with new high-risk-area safeguards; Mythos 5 = trusted cyberdefense/infrastructure partners, fewer safeguards", options: { bullet: { code: "2022" }, breakLine: true, paraSpaceAfter: 7 } },
      { text: "Anthropic: >10% above Claude Opus 4.8 on some benchmarks; strong software-engineering and knowledge-work results", options: { bullet: { code: "2022" }, breakLine: true, paraSpaceAfter: 7 } },
      { text: "Pricing: $10 / $50 per million tokens (input / output)", options: { bullet: { code: "2022" }, breakLine: false } },
    ],
    { x: 7.08, y: cy + 1.82, w: 5.45, h: 1.7, margin: 0, fontFace: FONT, fontSize: 12.5, color: T.ink2, valign: "top" }
  );
  chipShape(s, 7.08, cy + 3.68, 2.95, 0.34, "PARAMETERS: NOT DISCLOSED", T.ink3, false);

  // ---- footnote + sources ----
  card(s, 0.55, 6.32, 12.23, 0.56, T.cardDeep);
  s.addText(
    [
      { text: "Name check: ", options: { bold: true, color: T.ink2 } },
      { text: "the voice transcript’s “Fable” is not a recognition error — Claude Fable 5 is the confirmed Anthropic model name. Google (Gemini), xAI and others also ship frontier models; per scope, this draft compares the two labs above.", options: { color: T.ink3 } },
    ],
    { x: 0.85, y: 6.32, w: 11.7, h: 0.56, margin: 0, fontFace: FONT, fontSize: 10.5, valign: "middle" }
  );
  s.addText("Sources: OpenAI (Jul 9, 2026); TechCrunch; CNBC (Jun 9 & Jul 8, 2026); Anthropic announcements. Details and links in speaker notes.", {
    x: 0.55, y: 6.98, w: 12.2, h: 0.28, margin: 0, fontFace: FONT, fontSize: 8.5, color: T.ink4,
  });

  s.addNotes(
    "SLIDE 1 - PRESENT STATE. Talk track: the frontier is currently defined by two flagship families shipped weeks apart in summer 2026. " +
    "OpenAI GPT-5.6 (July 9, 2026): three variants - Luna (speed), Terra (balance), Sol (most capable). OpenAI positions it for enterprise work, coding, science, and cybersecurity ('strongest cybersecurity model yet', defensive focus); Sam Altman cited Sol as 54% more token-efficient on coding. " +
    "Anthropic Claude Fable 5 (announced June 9, 2026): first 'Mythos-class' model. Fable 5 and Mythos 5 share the same underlying model; Fable 5 is broadly available with added safeguards in high-risk areas (cyber, bio), Mythos 5 is restricted to trusted cyberdefense/infrastructure partners. Anthropic cites >10% over Claude Opus 4.8 on some benchmarks. Pricing $10/$50 per M tokens. Note: US export controls on Fable 5/Mythos 5 were lifted June 30, 2026 (CNBC) - mention only if asked. " +
    "NAME RESOLUTION: the transcript word 'Fable' maps to a real model (Claude Fable 5) - confirmed via Anthropic/CNBC coverage; no placeholder needed. " +
    "CAVEAT to say out loud: everything on this slide is about capability and access; neither lab discloses parameter counts - that is slide 2's subject. " +
    "Sources: openai.com/index/previewing-gpt-5-6-sol; techcrunch.com/2026/07/09/openai-launches-its-new-family-of-models-with-gpt-5-6; cnbc.com/2026/07/08 (GPT-5.6 public release); cnbc.com/2026/06/09/anthropic-mythos-claude-fable-5.html; anthropic.com/news/claude-fable-5-mythos-5."
  );
}

// ============================== SLIDE 2 ==============================
{
  const s = pres.addSlide();
  s.background = { color: T.bg };

  s.addText([
    { text: "The scale trajectory: ", options: { color: T.ink } },
    { text: "≈40,000× in eight years", options: { color: T.ink } },
    { text: "  (est.)", options: { color: T.ink3, fontSize: 16 } },
  ], {
    x: 0.55, y: 0.26, w: 12.2, h: 0.55, margin: 0, fontFace: FONT, fontSize: 27, bold: true,
  });

  s.addImage({ path: __dirname + "/chart.png", x: 0.5, y: 0.94, w: 12.33, h: 5.45 });

  card(s, 0.55, 6.48, 12.23, 0.68, T.cardDeep);
  s.addText(
    [
      { text: "Reading this honestly: ", options: { bold: true, color: T.ink2 } },
      { text: "OpenAI last disclosed a flagship count with GPT-3 (2020); Anthropic never has for Claude flagships. Filled dots = lab-disclosed; hollow dots = third-party estimates (bars = published ranges). MoE splits “total” vs “active”: GPT-4 est. ~1.8T total, ~280B active per token. Log scale: each gridline is 10×.  Sources: lab papers (GPT-1/2/3; RL-CAI 52B); SemiAnalysis (GPT-4); Epoch AI (GPT-4o, 3.5 Sonnet, compute trend); LifeArchitect (Claude 3 Opus); press/analyst reports (later flagships).", options: { color: T.ink3 } },
    ],
    { x: 0.85, y: 6.48, w: 11.7, h: 0.68, margin: 0, fontFace: FONT, fontSize: 9, valign: "middle" }
  );

  s.addNotes(
    "SLIDE 2 - SCALE TRAJECTORY (the chart the room will remember). How to walk it: start bottom-left - GPT-1, 117M parameters, 2018, disclosed in the paper. Walk up the teal line: GPT-2 1.5B, GPT-3 175B (2020, the last disclosed OpenAI frontier count). Then the epistemics change: every point after 2020 is hollow - a third-party estimate with a range bar. GPT-4 ~1.8T total (SemiAnalysis leak; MoE, ~280B active per token). Orange line = Anthropic: RL-CAI 52B (disclosed in their research papers, Dec 2022), Claude 2 ~130B est., Claude 3 Opus ~2T est. (LifeArchitect), Claude 3.5 Sonnet ~400B est. (Epoch AI), Claude Opus 4.6 ~5T est. (third-party analysis; Musk claimed 5T), Claude Fable 5 ~10T widely cited but unconfirmed (dashed). " +
    "KEY BEATS: (1) ~40,000x total-capacity growth 2018->2026 using mid estimates (117M -> ~5T). (2) The 2024 dip is real and matters: both labs shipped smaller, cheaper frontier models (GPT-4o ~200B, 3.5 Sonnet ~400B) - scale is NOT monotonic; efficiency generations alternate with scale generations. (3) GPT-5.6: no credible size estimate exists yet - we show a dashed '?' range rather than invent one. (4) The violet band is OUR scenario (8-10T next-gen), not a forecast - note on log scale it is a small step above the rumored ~10T Mythos-class. " +
    "HONESTY DETAILS if asked: ranges reflect the spread of published estimates, not lab guidance; Fable 5 and GPT-5.6 markers are nudged ~3 weeks apart horizontally so their range bars don't overlap (true dates Jun 9 / Jul 9, 2026); 'total capacity' counts all MoE experts - active-per-token counts are ~5-10x lower; independent Epoch analysis argues frontier models got SMALLER in 2023-24 before re-scaling. " +
    "Sources: epoch.ai/gradient-updates/frontier-language-models-have-become-much-smaller; epoch.ai/publications/training-compute-of-frontier-ai-models-grows-by-4-5x-per-year; SemiAnalysis GPT-4 architecture report (Jul 2023); lifearchitect.ai (Claude estimates); press reports for GPT-4.5/GPT-5/Opus 4.6/Fable 5 figures."
  );
}

// ============================== SLIDE 3 ==============================
{
  const s = pres.addSlide();
  s.background = { color: T.bg };

  s.addText("Next generation: the 8–10T scenario", {
    x: 0.55, y: 0.34, w: 8.6, h: 0.6, margin: 0,
    fontFace: FONT, fontSize: 30, bold: true, color: T.ink,
  });
  chipShape(s, 9.4, 0.44, 3.38, 0.4, "SCENARIO — NOT A FORECAST", T.scnText, true);
  s.addText("Working assumption for planning: next-generation frontier models reach roughly 8–10 trillion total parameters and deliver another major capability step.", {
    x: 0.55, y: 1.0, w: 12.2, h: 0.4, margin: 0, fontFace: FONT, fontSize: 13.5, color: T.ink2,
  });

  const cy = 1.62, ch = 4.42;
  // ---- big number card ----
  card(s, 0.55, cy, 3.62, ch);
  s.addText("8–10T", {
    x: 0.55, y: cy + 0.55, w: 3.62, h: 1.05, align: "center", margin: 0,
    fontFace: FONT, fontSize: 60, bold: true, color: T.scnText,
  });
  s.addText("total parameters, next-gen frontier\n(planning assumption)", {
    x: 0.55, y: cy + 1.72, w: 3.62, h: 0.62, align: "center", margin: 0,
    fontFace: FONT, fontSize: 12, color: T.ink2,
  });
  s.addShape("line", { x: 0.95, y: cy + 2.52, w: 2.82, h: 0, line: { color: T.cardLine, width: 1 } });
  s.addText(
    [
      { text: "≈ 2× today’s estimated ~5T frontier — one more historical scaling step, not a discontinuity", options: { breakLine: true, paraSpaceAfter: 8 } },
      { text: "If the unconfirmed ~10T Mythos-class figures are right, this scale may already exist — making the scenario conservative on size", options: {} },
    ],
    { x: 0.95, y: cy + 2.72, w: 2.9, h: 1.5, margin: 0, fontFace: FONT, fontSize: 11.5, color: T.ink3, valign: "top" }
  );

  // ---- supports card ----
  card(s, 4.4, cy, 4.24, ch);
  s.addText("What supports it — verified trends", {
    x: 4.7, y: cy + 0.26, w: 3.7, h: 0.4, margin: 0, fontFace: FONT, fontSize: 15, bold: true, color: T.ink,
  });
  s.addText(
    [
      { text: "Frontier training compute has grown ×4–5 per year for a decade (Epoch AI)", options: { bullet: { code: "2022" }, breakLine: true, paraSpaceAfter: 8 } },
      { text: "Epoch judges ×4/yr feasible through 2030 — needing >5 GW training power", options: { bullet: { code: "2022" }, breakLine: true, paraSpaceAfter: 8 } },
      { text: "2026 frontier runs: 1e26–1e27 FLOPs, $200–500M per run — and still scaling", options: { bullet: { code: "2022" }, breakLine: true, paraSpaceAfter: 8 } },
      { text: "Est. frontier size roughly doubled per generation since 2023 (~1.8T → ~5T), putting 8–10T on-trend for the next step", options: { bullet: { code: "2022" }, breakLine: false } },
    ],
    { x: 4.7, y: cy + 0.78, w: 3.7, h: 3.4, margin: 0, fontFace: FONT, fontSize: 12, color: T.ink2, valign: "top" }
  );

  // ---- uncertain card ----
  card(s, 8.86, cy, 3.92, ch);
  s.addText("What stays uncertain", {
    x: 9.16, y: cy + 0.26, w: 3.4, h: 0.4, margin: 0, fontFace: FONT, fontSize: 15, bold: true, color: T.ink,
  });
  s.addText(
    [
      { text: "No lab discloses counts — 8–10T cannot be verified against ground truth", options: { bullet: { code: "2022" }, breakLine: true, paraSpaceAfter: 8 } },
      { text: "Scale is not monotonic: 2024’s frontier shrank 5–10× before re-scaling", options: { bullet: { code: "2022" }, breakLine: true, paraSpaceAfter: 8 } },
      { text: "Capability now leans on post-training RL and test-time compute — a 10T model is not automatically a leap", options: { bullet: { code: "2022" }, breakLine: true, paraSpaceAfter: 8 } },
      { text: "MoE blurs “size”: total vs active parameters differ ~5–10×", options: { bullet: { code: "2022" }, breakLine: false } },
    ],
    { x: 9.16, y: cy + 0.78, w: 3.4, h: 3.4, margin: 0, fontFace: FONT, fontSize: 12, color: T.ink2, valign: "top" }
  );

  // ---- takeaway ----
  card(s, 0.55, 6.28, 12.23, 0.6, T.cardDeep);
  s.addText(
    [
      { text: "Recommended framing: ", options: { bold: true, color: T.ink2 } },
      { text: "plan capacity against the 8–10T scenario; treat “another major capability leap” as plausible but unproven — and track capability benchmarks, not parameter rumors, as the leading indicator.", options: { color: T.ink3 } },
    ],
    { x: 0.85, y: 6.28, w: 11.7, h: 0.6, margin: 0, fontFace: FONT, fontSize: 11.5, valign: "middle" }
  );
  s.addText("Sources: Epoch AI (compute-trend and power analyses); scenario sizing: this team’s working assumption, benchmarked against third-party estimates shown on slide 2.", {
    x: 0.55, y: 6.98, w: 12.2, h: 0.28, margin: 0, fontFace: FONT, fontSize: 8.5, color: T.ink4,
  });

  s.addNotes(
    "SLIDE 3 - NEXT-GENERATION SCENARIO. Framing discipline: the 8-10T figure is OUR planning assumption (from the sponsor's expectation), not an authoritative forecast - say that explicitly; the chip on the slide says it too. " +
    "What is verified: Epoch AI's compute trend (x4-5/yr, decade-long, judged feasible through 2030 at >5 GW); 2026 frontier training runs at 1e26-1e27 FLOPs costing $200-500M; third-party size estimates roughly doubling per generation since 2023. " +
    "What is not: any specific next-gen parameter count (labs don't disclose); whether the capability leap materializes - recent gains lean on post-training RL and test-time compute, so capability may decouple from raw size; and note the twist that if the unconfirmed ~10T Mythos-class figures are right, 8-10T of total capacity may already be deployed - which makes the interesting question 'what does the next 2x buy?' rather than 'when do we hit 10T?'. " +
    "Anticipated exec questions: (1) Why a range, not a number? Because every input is an estimate range. (2) Does 2x parameters mean 2x capability? No - historically capability tracked compute and data more than parameter count alone, and MoE routing changes what 'size' means. (3) What would confirm the scenario? Disclosed counts (unlikely), credible technical leaks, or Epoch-style inference-cost analyses converging. " +
    "Suggested next iteration: add a capability-benchmark overlay (e.g., SWE-bench / GPQA over time) to pair the scale story with a capability story."
  );
}

pres.writeFile({ fileName: __dirname + "/frontier-ai-scale-trajectory.pptx" }).then(() => console.log("deck written"));
