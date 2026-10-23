// Crew icons (UI spec §5.9), shared by the crew dock, the Estimate crews table and the Inspector crew bars.
import { Brush, ChefHat, ClipboardCheck, Shovel, SprayCan, Tractor, UtensilsCrossed } from 'lucide-react';
import type { Crew } from '@shared/factors';
import type { IconType } from '../ui';

export const CREW_ICON: Record<Crew, IconType> = {
  custodial: SprayCan,
  floor_care: Brush,
  dining_prod: ChefHat,
  dining_san: UtensilsCrossed,
  supervision: ClipboardCheck,
  grounds_mow: Tractor,
  grounds_landscape: Shovel,
};

/** "17:00–01:30" for a shift window in sim hours. */
export const hhmm = (h: number) => { const x = ((h % 24) + 24) % 24; return `${String(Math.floor(x)).padStart(2, '0')}:${String(Math.round((x % 1) * 60)).padStart(2, '0')}`; };
export const shiftLabel = (s: { start: number; end: number }) => `${hhmm(s.start)}–${hhmm(s.end)}`;
/** Whether the sim time falls inside a shift window (windows may wrap past midnight). */
export const onShift = (s: { start: number; end: number }, t: number) => (s.end > s.start ? t >= s.start && t < s.end : t >= s.start || t < s.end);
