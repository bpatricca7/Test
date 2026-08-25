// Builds the combined OpenAI + Anthropic parameter-scale trajectory chart (SVG -> PNG).
// Log-scale timeline, 2018-2028. Encodes source quality: filled = lab-disclosed,
// hollow + range bar = third-party estimate, dashed = unconfirmed, violet band = scenario.
const fs = require("fs");
const sharp = require("sharp");

// ---------- canvas ----------
const W = 2960, H = 1308;               // 12.33in x 5.45in at 240dpi
const mL = 170, mR = 54, mT = 118, mB = 104;
const plotW = W - mL - mR, plotH = H - mT - mB;

const X0 = 2017.85, X1 = 2028.15;       // year domain
const LY0 = -1.15, LY1 = 4.28;          // log10(billions) domain: ~70M .. ~19T

const x = (yr) => mL + ((yr - X0) / (X1 - X0)) * plotW;
const y = (b) => mT + (1 - (Math.log10(b) - LY0) / (LY1 - LY0)) * plotH;

// ---------- palette (validated: scripts/validate_palette.js, dark mode) ----------
const C = {
  bg: "#0B1220", grid: "#232F4A", axis: "#3A4A6B", leader: "#44547A",
  ink: "#F2F6FD", ink2: "#C6D2E8", ink3: "#8CA0C4", ink4: "#6E7F9E", dot: "#AAB6C9",
  openai: "#18A184", anthropic: "#CC6C38", scenario: "#8B7BF7",
  chipFill: "#121C30", chipLine: "#26334F",
};
const FONT = "Liberation Sans, DejaVu Sans, Arial, sans-serif";

// ---------- data (billions of parameters; total capacity for MoE) ----------
// status: "disclosed" | "estimate" | "unconfirmed" | "unknown"
// Labels: either offset {lx, ly, la} from the marker, or absolute lane label
// {ax, ay, la} with a leader line. Fable 5 / GPT-5.6 x-positions are dodged
// slightly from true dates (Jun 9 / Jul 9 2026) so their range bars don't overlap.
const SERIES = [
  {
    name: "OpenAI", color: C.openai,
    pts: [
      { m: "GPT-1", v: "117M", yr: 2018.45, c: 0.117, status: "disclosed", lx: 0, ly: -100, la: "middle" },
      { m: "GPT-2", v: "1.5B", yr: 2019.12, c: 1.5, status: "disclosed", lx: 0, ly: -100, la: "middle" },
      { m: "GPT-3", v: "175B", yr: 2020.40, c: 175, status: "disclosed", lx: 0, ly: -100, la: "middle" },
      { m: "GPT-4", v: "~1.8T est.", yr: 2023.20, c: 1800, lo: 1500, hi: 2000, status: "estimate", lx: -40, ly: -76, la: "end" },
      { m: "GPT-4o", v: "~200B est.", yr: 2024.37, c: 200, lo: 150, hi: 300, status: "estimate", lx: 0, ly: 96, la: "middle" },
      { m: "GPT-4.5", v: "~4–5T est.", yr: 2025.16, c: 4500, lo: 4000, hi: 5000, status: "estimate", ax: 2050, ay: 372, la: "middle" },
      { m: "GPT-5", v: "~3–5T est.", yr: 2025.60, c: 4000, lo: 3000, hi: 5000, status: "estimate", ax: 2228, ay: 514, la: "middle" },
      { m: "GPT-5.6", v: "undisclosed", yr: 2026.62, c: null, lo: 3000, hi: 8000, status: "unknown", ax: 2560, ay: 514, la: "middle" },
    ],
  },
  {
    name: "Anthropic", color: C.anthropic,
    pts: [
      { m: "RL-CAI 52B", v: "52B (paper)", yr: 2022.95, c: 52, status: "disclosed", lx: 0, ly: 92, la: "middle" },
      { m: "Claude 2", v: "~130B est.", yr: 2023.55, c: 130, lo: 100, hi: 200, status: "estimate", lx: -36, ly: -64, la: "end" },
      { m: "Claude 3 Opus", v: "~2T est.", yr: 2024.18, c: 2000, lo: 1000, hi: 2500, status: "estimate", lx: 0, ly: -78, la: "middle" },
      { m: "Claude 3.5 Sonnet", v: "~400B est.", yr: 2024.47, c: 400, lo: 300, hi: 500, status: "estimate", lx: 52, ly: 16, la: "start" },
      { m: "Claude Opus 4.6", v: "~5T est.", yr: 2026.10, c: 5000, lo: 4000, hi: 6000, status: "estimate", ax: 2350, ay: 372, la: "middle" },
      { m: "Claude Fable 5", v: "~10T cited, unconfirmed", yr: 2026.34, c: 10000, lo: 8000, hi: 12000, status: "unconfirmed", lx: -26, ly: -64, la: "end" },
    ],
  },
];

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
let svg = [];
svg.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`);
svg.push(`<rect width="${W}" height="${H}" fill="${C.bg}"/>`);

// ---------- gridlines + y labels ----------
const gl = [
  { b: 0.1, t: "100M" }, { b: 1, t: "1B" }, { b: 10, t: "10B" },
  { b: 100, t: "100B" }, { b: 1000, t: "1T" }, { b: 10000, t: "10T" },
];
for (const g of gl) {
  const gy = y(g.b);
  svg.push(`<line x1="${mL}" y1="${gy}" x2="${W - mR}" y2="${gy}" stroke="${C.grid}" stroke-width="2"/>`);
  svg.push(`<text x="${mL - 22}" y="${gy + 11}" font-family="${FONT}" font-size="34" fill="${C.ink3}" text-anchor="end">${g.t}</text>`);
}
// x axis baseline + ticks
const yBase = mT + plotH;
svg.push(`<line x1="${mL}" y1="${yBase}" x2="${W - mR}" y2="${yBase}" stroke="${C.axis}" stroke-width="3"/>`);
for (let yr = 2018; yr <= 2028; yr++) {
  const tx = x(yr);
  svg.push(`<line x1="${tx}" y1="${yBase}" x2="${tx}" y2="${yBase + 14}" stroke="${C.axis}" stroke-width="3"/>`);
  svg.push(`<text x="${tx}" y="${yBase + 58}" font-family="${FONT}" font-size="34" fill="${C.ink3}" text-anchor="middle">${yr}</text>`);
}
// y axis unit caption (left-aligned so it never clips)
svg.push(`<text x="${16}" y="${mT - 46}" font-family="${FONT}" font-size="30" fill="${C.ink4}">parameters</text>`);
svg.push(`<text x="${16}" y="${mT - 12}" font-family="${FONT}" font-size="30" fill="${C.ink4}">(log scale)</text>`);

// ---------- scenario band: next-gen 8-10T, 2026.9 -> 2028 ----------
const bx0 = x(2026.9), bx1 = x(2027.98), byT = y(10000), byB = y(8000);
svg.push(`<rect x="${bx0}" y="${byT}" width="${bx1 - bx0}" height="${byB - byT}" fill="${C.scenario}" fill-opacity="0.22"/>`);
svg.push(`<rect x="${bx0}" y="${byT}" width="${bx1 - bx0}" height="${byB - byT}" fill="none" stroke="${C.scenario}" stroke-width="3" stroke-dasharray="10 8"/>`);
const bcx = (bx0 + bx1) / 2;
svg.push(`<text x="${bcx}" y="${byB + 64}" font-family="${FONT}" font-size="50" font-weight="bold" fill="${C.scenario}" text-anchor="middle">8–10T</text>`);
svg.push(`<text x="${bcx}" y="${byB + 108}" font-family="${FONT}" font-size="30" fill="${C.ink3}" text-anchor="middle">next-gen scenario</text>`);
svg.push(`<text x="${bcx}" y="${byB + 144}" font-family="${FONT}" font-size="30" fill="${C.ink3}" text-anchor="middle">(planning assumption,</text>`);
svg.push(`<text x="${bcx}" y="${byB + 180}" font-family="${FONT}" font-size="30" fill="${C.ink3}" text-anchor="middle">not a forecast)</text>`);

// ---------- series lines, range bars, markers (pass 1), labels on top (pass 2) ----------
for (const s of SERIES) {
  const line = s.pts.filter((p) => p.c != null);
  const path = line.map((p, i) => `${i ? "L" : "M"}${x(p.yr).toFixed(1)},${y(p.c).toFixed(1)}`).join(" ");
  svg.push(`<path d="${path}" fill="none" stroke="${s.color}" stroke-width="5" stroke-opacity="0.5" stroke-linejoin="round"/>`);

  for (const p of s.pts) {
    const px = x(p.yr);
    const anchorY = p.c != null ? y(p.c) : (y(p.lo) + y(p.hi)) / 2;
    if (p.lo != null && p.hi != null) {
      const dash = p.status === "unknown" ? ` stroke-dasharray="12 10"` : "";
      svg.push(`<line x1="${px}" y1="${y(p.hi)}" x2="${px}" y2="${y(p.lo)}" stroke="${s.color}" stroke-width="5"${dash}/>`);
      for (const v of [p.lo, p.hi]) {
        svg.push(`<line x1="${px - 14}" y1="${y(v)}" x2="${px + 14}" y2="${y(v)}" stroke="${s.color}" stroke-width="5"/>`);
      }
    }
    if (p.c != null) {
      const py = y(p.c);
      if (p.status === "disclosed") {
        svg.push(`<circle cx="${px}" cy="${py}" r="21" fill="${C.bg}"/>`);
        svg.push(`<circle cx="${px}" cy="${py}" r="17" fill="${s.color}"/>`);
      } else {
        const dash = p.status === "unconfirmed" ? ` stroke-dasharray="9 7"` : "";
        svg.push(`<circle cx="${px}" cy="${py}" r="17" fill="${C.bg}" stroke="${s.color}" stroke-width="6"${dash}/>`);
      }
    } else {
      svg.push(`<circle cx="${px}" cy="${anchorY}" r="21" fill="${C.bg}" stroke="${s.color}" stroke-width="5" stroke-dasharray="9 7"/>`);
      svg.push(`<text x="${px}" y="${anchorY + 12}" font-family="${FONT}" font-size="34" font-weight="bold" fill="${s.color}" text-anchor="middle">?</text>`);
    }
    if (p.ax != null) {
      const fromY = p.lo != null ? y(p.lo) + 12 : anchorY + 26;
      svg.push(`<line x1="${px}" y1="${fromY}" x2="${p.ax}" y2="${p.ay - 44}" stroke="${C.leader}" stroke-width="2.5"/>`);
    }
  }
}
// pass 2: labels above every line/marker, with a bg halo for legibility
function haloText(tx, ty, size, weight, fill, anchor, str) {
  const w = weight ? ` font-weight="bold"` : "";
  svg.push(`<text x="${tx}" y="${ty}" font-family="${FONT}" font-size="${size}"${w} stroke="${C.bg}" stroke-width="14" stroke-linejoin="round" fill="${C.bg}" text-anchor="${anchor}">${str}</text>`);
  svg.push(`<text x="${tx}" y="${ty}" font-family="${FONT}" font-size="${size}"${w} fill="${fill}" text-anchor="${anchor}">${str}</text>`);
}
for (const s of SERIES) {
  for (const p of s.pts) {
    const px = x(p.yr);
    const anchorY = p.c != null ? y(p.c) : (y(p.lo) + y(p.hi)) / 2;
    let lx, ly;
    if (p.ax != null) { lx = p.ax; ly = p.ay; }
    else { lx = px + p.lx; ly = anchorY + p.ly; }
    haloText(lx, ly, 38, true, C.ink, p.la, esc(p.m));
    haloText(lx, ly + 40, 32, false, C.ink3, p.la, esc(p.v));
  }
}

// ---------- 2024 efficiency-dip annotation ----------
svg.push(`<text x="${x(2024.6)}" y="${790}" font-family="${FONT}" font-size="31" font-style="italic" fill="${C.ink3}" text-anchor="middle">2024: both labs also shipped smaller,</text>`);
svg.push(`<text x="${x(2024.6)}" y="${828}" font-family="${FONT}" font-size="31" font-style="italic" fill="${C.ink3}" text-anchor="middle">cheaper frontier models — scale is not monotonic</text>`);

// ---------- stat chips (top-left, inside plot) ----------
function chip(cx, cy, w, lines) {
  svg.push(`<rect x="${cx}" y="${cy}" width="${w}" height="${lines.length * 44 + 34}" rx="16" fill="${C.chipFill}" stroke="${C.chipLine}" stroke-width="2.5"/>`);
  lines.forEach((ln, i) => {
    svg.push(`<text x="${cx + 26}" y="${cy + 52 + i * 44}" font-family="${FONT}" font-size="34" fill="${C.ink2}">${ln}</text>`);
  });
}
chip(mL + 34, mT + 40, 780, [
  `<tspan font-weight="bold" fill="${C.ink}">≈40,000×</tspan> growth in frontier total`,
  `capacity, 2018 → 2026 (117M → ~5T est.)`,
]);
chip(mL + 34, mT + 196, 780, [
  `Training compute: <tspan font-weight="bold" fill="${C.ink}">×4–5 / year</tspan> (Epoch AI)`,
]);

// ---------- legend (top row) ----------
let lgx = mL + 4;
const lgy = 48;
function lgDot(fill, stroke, dash, label, bold, color) {
  if (fill) svg.push(`<circle cx="${lgx + 17}" cy="${lgy - 11}" r="15" fill="${fill}"/>`);
  else svg.push(`<circle cx="${lgx + 17}" cy="${lgy - 11}" r="14" fill="${C.bg}" stroke="${stroke}" stroke-width="5"${dash ? ' stroke-dasharray="7 6"' : ""}/>`);
  lgx += 44;
  svg.push(`<text x="${lgx}" y="${lgy}" font-family="${FONT}" font-size="35" ${bold ? 'font-weight="bold"' : ""} fill="${color || C.ink2}">${label}</text>`);
  lgx += label.length * 16.4 + 66;
}
lgDot(C.openai, null, false, "OpenAI", true, C.ink);
lgDot(C.anthropic, null, false, "Anthropic", true, C.ink);
lgx += 30;
lgDot(C.dot, null, false, "Disclosed by lab", false);
lgDot(null, C.dot, false, "Third-party estimate (bar = range)", false);
lgDot(null, C.dot, true, "Unconfirmed / undisclosed", false);
svg.push(`<rect x="${lgx}" y="${lgy - 26}" width="34" height="26" rx="5" fill="${C.scenario}" fill-opacity="0.25" stroke="${C.scenario}" stroke-width="2.5" stroke-dasharray="7 6"/>`);
svg.push(`<text x="${lgx + 50}" y="${lgy}" font-family="${FONT}" font-size="35" fill="${C.ink2}">Scenario</text>`);

svg.push(`</svg>`);
const out = svg.join("\n");
fs.writeFileSync(__dirname + "/chart.svg", out);
sharp(Buffer.from(out)).png().toFile(__dirname + "/chart.png").then(() => console.log("chart.png written"));
