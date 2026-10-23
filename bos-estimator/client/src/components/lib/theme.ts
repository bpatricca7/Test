// Design tokens shared by the 2D shell and the 3D scene (UI spec §2.6). The 3D side imports this read-only,
// so legend swatches and building tints come from one place and cannot drift apart.
import { CATEGORY_DEFAULTS, CREWS, type Crew } from '@shared/factors';
import type { FacilityCategory } from '@shared/types';
import type { ColorBy } from '../../store';

export const T = {
  bg: '#0b0f17', surface1: '#121824', text1: '#e9eef6', text2: '#b6c0cf', text3: '#95a1b5', accent: '#5aa9f5', focus: '#8cc8ff',
  ok: '#22c55e', warn: '#f59e0b', bad: '#ef4444', flag: '#f472b6', edit: '#b3a6ff', newc: '#22d3ee', ai: '#e879f9',
} as const;

export type ConfBand = 'hi' | 'mid' | 'lo';
export type RowReview = 'verified' | 'flagged' | 'needs' | 'ok';

export const CONF = { hi: 0.75, mid: 0.45 } as const; // display bands
export const REVIEW_CONF_THRESHOLD = 0.6; // needs-review threshold (spec §6.2)
export function confBand(c: number): ConfBand { return c >= CONF.hi ? 'hi' : c >= CONF.mid ? 'mid' : 'lo'; }
/** Tone of the bottom-up vs implied Δ chip (§5.1): ≤ 10 % ok, ≤ 25 % warn, otherwise bad. */
export function deltaTone(d: number): 'ok' | 'warn' | 'bad' { const a = Math.abs(d); return a <= 0.1 ? 'ok' : a <= 0.25 ? 'warn' : 'bad'; }
export const CONF_GLYPH = { hi: '●', mid: '◆', lo: '▲' } as const;
export const CONF_COLOR = { hi: '#22c55e', mid: '#f59e0b', lo: '#ef4444' } as const;
export const REVIEW_COLOR = { verified: '#22c55e', flagged: '#f472b6', needs: '#f59e0b', ok: '#c9ced6' } as const;
export const NEUTRAL_ROOF = '#c9ced6';
export const FTE_RAMP = ['#6da7ec', '#3987e5', '#256abf', '#184f95', '#0d366b'] as const; // low → high
export const FINISH_COLORS = { carpet: '#7c6a52', resilient: '#aab1bb', hardTile: '#e5e7eb', concrete: '#5f6670', wood: '#b7793f' } as const;

/** Crew identity colours (CVD-validated against the dark surface; floor care and landscape swapped for adjacency). */
const CREW_OVERRIDE: Partial<Record<Crew, string>> = { floor_care: '#c98500', grounds_landscape: '#d95926' };
export function crewColor(id: Crew): string { return CREW_OVERRIDE[id] ?? CREWS.find((c) => c.id === id)?.color ?? '#9ca3af'; }
export const CREW_ORDER: Crew[] = ['custodial', 'floor_care', 'dining_prod', 'dining_san', 'supervision', 'grounds_mow', 'grounds_landscape'];

export function categoryColor(c: FacilityCategory): string { return CATEGORY_DEFAULTS[c]?.color ?? CATEGORY_DEFAULTS.other.color; }

function fteBin(fte: number, breaks: readonly number[]): number {
  let i = 0; while (i < breaks.length && fte > breaks[i]) i++;
  return Math.min(FTE_RAMP.length - 1, i);
}

export function buildingTint(mode: ColorBy, x: { category: FacilityCategory; conf: number; review: RowReview; fte: number; fteBreaks: readonly number[] }): string {
  switch (mode) {
    case 'confidence': { const b = confBand(x.conf); return b === 'hi' ? NEUTRAL_ROOF : CONF_COLOR[b]; }
    case 'review': return REVIEW_COLOR[x.review];
    case 'fte': return FTE_RAMP[fteBin(x.fte, x.fteBreaks)];
    default: return categoryColor(x.category);
  }
}

const fmtFte = (v: number) => (v >= 10 ? v.toFixed(0) : v.toFixed(1));

/**
 * Legend for a colour mode. `present` (optional) narrows the category legend to the categories the project has, in
 * that order (most buildings first), and appends the grounds kinds shown as pads.
 */
export function legendFor(mode: ColorBy, fteBreaks: readonly number[] = [], present?: { categories: readonly FacilityCategory[]; grounds?: readonly { color: string; label: string }[] }): { title: string; items: { color: string; glyph?: string; label: string }[] } {
  switch (mode) {
    case 'confidence': return { title: 'Extraction confidence', items: [
      { color: NEUTRAL_ROOF, glyph: CONF_GLYPH.hi, label: `High (≥ ${Math.round(CONF.hi * 100)}%)` },
      { color: CONF_COLOR.mid, glyph: CONF_GLYPH.mid, label: `Medium (${Math.round(CONF.mid * 100)}–${Math.round(CONF.hi * 100) - 1}%)` },
      { color: CONF_COLOR.lo, glyph: CONF_GLYPH.lo, label: `Low (< ${Math.round(CONF.mid * 100)}%)` } ] };
    case 'review': return { title: 'Review status', items: [
      { color: REVIEW_COLOR.verified, glyph: '✓', label: 'Verified' }, { color: REVIEW_COLOR.flagged, glyph: '⚑', label: 'Flagged' },
      { color: REVIEW_COLOR.needs, glyph: '!', label: 'Needs review' }, { color: REVIEW_COLOR.ok, label: 'Not reviewed' } ] };
    case 'fte': {
      const b = fteBreaks.length === 4 ? fteBreaks : [0.5, 1, 2, 4];
      const edges = [0, ...b];
      return { title: 'FTE per building', items: FTE_RAMP.map((c, i) => ({ color: c, label: i < 4 ? `${fmtFte(edges[i])}–${fmtFte(edges[i + 1])}` : `> ${fmtFte(edges[4])}` })) };
    }
    default: {
      const cats = present ? present.categories : (Object.keys(CATEGORY_DEFAULTS) as FacilityCategory[]);
      const items = cats.map((c) => ({ color: categoryColor(c), label: CATEGORY_DEFAULTS[c]?.label ?? c }));
      return { title: present?.grounds?.length && !cats.length ? 'Grounds areas' : 'Facility type', items: [...items, ...(present?.grounds ?? [])] };
    }
  }
}
