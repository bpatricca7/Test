import { MARK_H, MARK_PATH } from "./mark";

/*
 * Canvas engine behind <LogoSpinner>. The Amentum mark is sampled into square "pixels".
 *
 *   spin    the pixels spiral out of the logo into two counter-rotating rings, each with a
 *           trailing tail, with the odd pixel glitching bright
 *   reform  every pixel spirals back to its place in the mark (landing left to right), then the
 *           pixel mark snaps into the solid vector logo
 *   solid   the static logo; the animation loop stops
 */

const TAU = Math.PI * 2;
const OUTER_PERIOD = 1.1; // seconds per turn, clockwise
const INNER_PERIOD = 1.8; // counter-clockwise
const INTRO = 0.4; // seconds for a pixel to leave the logo for its ring
const INTRO_STAGGER = 0.18;
const LAND = 0.55; // seconds for a pixel to fly home
const LAND_STAGGER = 0.24; // left edge lands first, right edge last
const SNAP = 0.28; // pixel mark -> solid logo

type Home = { x: number; y: number; alpha: number };

type Pixel = Home & {
  r: number; // home position in polar form around the centre
  a: number;
  dir: 1 | -1; // ring direction
  radius: number; // ring radius
  slot: number; // angle of this pixel's slot on its ring
  tail: number; // brightness along the ring's tail, 0..1
  size: number; // side length while on the ring
  // last drawn state (c*) and where the reform flight started (f*)
  cr: number;
  ca: number;
  cAlpha: number;
  cSize: number;
  fr: number;
  fa: number;
  fAlpha: number;
  fSize: number;
};

const sampleCache = new Map<number, { cell: number; homes: Home[] }>();

/** Sample the mark onto a grid of ~2px cells sized for a `size`-px square box. */
function sampleMark(size: number): { cell: number; homes: Home[] } {
  const cached = sampleCache.get(size);
  if (cached) return cached;
  const cols = Math.max(8, Math.min(20, Math.round(size / 2.2)));
  const cell = size / cols;
  const markH = (size * MARK_H) / 100;
  const rows = Math.ceil(markH / cell);
  const gridTop = (size - rows * cell) / 2;
  const R = 8; // raster pixels per cell
  const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  const homes: Home[] = [];
  if (ctx) {
    ctx.canvas.width = cols * R;
    ctx.canvas.height = rows * R;
    ctx.translate(0, (((size - markH) / 2 - gridTop) / cell) * R);
    ctx.scale((cols * R) / 100, (cols * R) / 100);
    ctx.fill(new Path2D(MARK_PATH), "evenodd");
    const data = ctx.getImageData(0, 0, cols * R, rows * R).data;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        let sum = 0;
        for (let y = r * R; y < (r + 1) * R; y++)
          for (let x = c * R; x < (c + 1) * R; x++) sum += data[(y * cols * R + x) * 4 + 3];
        const coverage = sum / (255 * R * R);
        if (coverage >= 0.28)
          homes.push({ x: (c + 0.5) * cell, y: gridTop + (r + 0.5) * cell, alpha: 0.45 + 0.55 * Math.min(1, coverage * 1.4) });
      }
    }
  }
  const out = { cell, homes };
  sampleCache.set(size, out);
  return out;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const easeOut = (t: number) => 1 - (1 - t) ** 3;
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
/** Signed shortest angle from a to b. */
const shortest = (a: number, b: number) => ((((b - a + Math.PI) % TAU) + TAU) % TAU) - Math.PI;
/** Angle from a to b travelling in direction `dir` (never backwards). */
const forward = (a: number, b: number, dir: 1 | -1) => dir * ((((dir * (b - a)) % TAU) + TAU) % TAU);
const noise = (i: number, n: number) => {
  const v = Math.sin(i * 12.9898 + n * 78.233) * 43758.5453;
  return v - Math.floor(v);
};

export class LogoSpinnerEngine {
  private ctx: CanvasRenderingContext2D | null;
  private dpr: number;
  private pixels: Pixel[] = [];
  private cell: number;
  private mark: Path2D;
  private markTop: number;
  private color: string;
  private reduced: boolean;
  private mode: "spin" | "reform" | "solid";
  private t0 = 0;
  private raf = 0;

  constructor(canvas: HTMLCanvasElement, private size: number, done: boolean) {
    this.dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    canvas.width = Math.round(size * this.dpr);
    canvas.height = Math.round(size * this.dpr);
    this.ctx = canvas.getContext("2d");
    this.ctx?.scale(this.dpr, this.dpr);
    this.mark = new Path2D(MARK_PATH);
    this.markTop = (size - (size * MARK_H) / 100) / 2;
    this.color = getComputedStyle(canvas).getPropertyValue("--mark").trim() || "#5fb257";
    this.reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const { cell, homes } = sampleMark(size);
    this.cell = cell;
    this.layout(homes);
    this.mode = done ? "solid" : "spin";
    this.start();
  }

  /** Split the pixels into an outer and inner ring, keeping each ring in angular order. */
  private layout(homes: Home[]) {
    const c = this.size / 2;
    const withPolar = homes.map((h) => ({ ...h, r: Math.hypot(h.x - c, h.y - c), a: Math.atan2(h.y - c, h.x - c) }));
    const byDistance = [...withPolar].sort((p, q) => q.r - p.r);
    const nOuter = withPolar.length >= 14 ? Math.ceil(withPolar.length * 0.62) : withPolar.length;
    const rings = [
      { items: byDistance.slice(0, nOuter), radius: this.size * 0.42, dir: 1 as const },
      { items: byDistance.slice(nOuter), radius: this.size * 0.24, dir: -1 as const },
    ];
    for (const ring of rings) {
      const n = ring.items.length;
      if (!n) continue;
      const size = Math.min(this.cell * 0.9, ((TAU * ring.radius) / n) * 0.72);
      ring.items
        .sort((p, q) => p.a - q.a)
        .forEach((p, k) => {
          // the head of the tail leads in the direction of travel
          const along = ring.dir === 1 ? (k + 1) / n : (n - k) / n;
          this.pixels.push({
            ...p, dir: ring.dir, radius: ring.radius, slot: -Math.PI + (TAU * (k + 0.5)) / n,
            tail: 0.08 + 0.92 * along ** 3, size,
            cr: p.r, ca: p.a, cAlpha: p.alpha, cSize: this.cell * 0.92,
            fr: p.r, fa: p.a, fAlpha: p.alpha, fSize: this.cell * 0.92,
          });
        });
    }
  }

  setDone(done: boolean) {
    if (done && this.mode === "spin") {
      for (const p of this.pixels) Object.assign(p, { fr: p.cr, fa: p.ca, fAlpha: p.cAlpha, fSize: p.cSize });
      this.mode = "reform";
      this.start();
    } else if (!done && this.mode !== "spin") {
      this.mode = "spin";
      this.start();
    }
  }

  destroy() {
    cancelAnimationFrame(this.raf);
  }

  private start() {
    cancelAnimationFrame(this.raf);
    this.t0 = performance.now();
    if (this.reduced || this.mode === "solid" || !this.pixels.length) {
      this.drawStatic();
      return;
    }
    const tick = (now: number) => {
      const keepGoing = this.frame((now - this.t0) / 1000);
      if (keepGoing) this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  private drawStatic() {
    const ctx = this.ctx;
    if (!ctx) return;
    ctx.clearRect(0, 0, this.size, this.size);
    if (this.mode === "spin" && this.pixels.length) {
      for (const p of this.pixels) this.px(p.x, p.y, this.cell * 0.92, p.alpha * 0.7);
    } else {
      this.solid(1, 1);
    }
  }

  /** Draw one frame; returns false once the animation has finished. */
  private frame(t: number): boolean {
    const ctx = this.ctx;
    if (!ctx) return false;
    ctx.clearRect(0, 0, this.size, this.size);
    const c = this.size / 2;
    const n = this.pixels.length;

    if (this.mode === "spin") {
      const tick = Math.floor(t * 10);
      this.pixels.forEach((p, i) => {
        const period = p.dir === 1 ? OUTER_PERIOD : INNER_PERIOD;
        const ringA = p.slot + (p.dir * TAU * t) / period;
        const q = easeInOut(clamp01((t - (i / n) * INTRO_STAGGER) / INTRO));
        const glitch = noise(i, tick) < 0.03 ? 0.7 : 0;
        const ringAlpha = Math.min(1, p.tail * (0.82 + 0.18 * Math.sin(t * 11 + i * 1.7)) + glitch);
        p.cr = lerp(p.r, p.radius, q);
        p.ca = p.a + shortest(p.a, ringA) * q;
        p.cAlpha = lerp(p.alpha, ringAlpha, q);
        p.cSize = lerp(this.cell * 0.92, p.size, q);
        this.px(c + p.cr * Math.cos(p.ca), c + p.cr * Math.sin(p.ca), p.cSize, p.cAlpha);
      });
      return true;
    }

    // reform: fly home along a spiral in each ring's direction of travel, then snap to solid
    const landed = LAND + LAND_STAGGER;
    const snap = clamp01((t - landed) / SNAP);
    for (const p of this.pixels) {
      const e = easeOut(clamp01((t - (p.x / this.size) * LAND_STAGGER) / LAND));
      p.cr = lerp(p.fr, p.r, e);
      p.ca = p.fa + forward(p.fa, p.a, p.dir) * e;
      p.cAlpha = lerp(p.fAlpha, p.alpha, e);
      p.cSize = lerp(p.fSize, this.cell * 0.92, e);
      this.px(c + p.cr * Math.cos(p.ca), c + p.cr * Math.sin(p.ca), p.cSize, p.cAlpha * (1 - snap));
    }
    if (snap > 0) this.solid(easeOut(snap), 1 + 0.12 * (1 - easeOut(snap)));
    if (snap < 1) return true;
    this.mode = "solid";
    this.drawStatic();
    return false;
  }

  private px(x: number, y: number, s: number, alpha: number) {
    const ctx = this.ctx!;
    const snap = (v: number) => Math.round(v * this.dpr) / this.dpr;
    const side = Math.max(1 / this.dpr, snap(s));
    ctx.globalAlpha = alpha;
    ctx.fillStyle = this.color;
    ctx.fillRect(snap(x - s / 2), snap(y - s / 2), side, side);
  }

  private solid(alpha: number, scale: number) {
    const ctx = this.ctx!;
    const c = this.size / 2;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = this.color;
    ctx.translate(c, c);
    ctx.scale(scale, scale);
    ctx.translate(-c, this.markTop - c);
    ctx.scale(this.size / 100, this.size / 100);
    ctx.fill(this.mark, "evenodd");
    ctx.restore();
  }
}
