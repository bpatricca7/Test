import { createContext, useContext } from 'react';
import type { EstimateResult, FacilityEstimate, GroundsEstimate } from '@shared/estimate';
import type { SiteLayout } from './three/layout';
import type { Agent } from './three/sim';
import type { ConfBand, RowReview } from './components/lib/theme';

/** Issue codes computed per row by components/lib/review.ts (UI spec §6.1). */
export type IssueCode = string;

export interface RowMeta { conf: ConfBand; review: RowReview; issues: IssueCode[]; inScope: boolean; edited: boolean }

export interface Derived {
  est: EstimateResult | null;
  estById: Map<string, FacilityEstimate>;
  gestById: Map<string, GroundsEstimate>;
  /** object identity changes ONLY when geometry changes */
  layout: SiteLayout | null;
  layoutRev: number;
  estRev: number;
  /** [] while view === 'table' */
  roster: Agent[];
  /** every facility and grounds id */
  rowMeta: Map<string, RowMeta>;
  /** FTE quantiles (20/40/60/80) of in-scope facilities, for colorBy 'fte' */
  fteBreaks: [number, number, number, number];
}

export const EMPTY_DERIVED: Derived = { est: null, estById: new Map(), gestById: new Map(), layout: null, layoutRev: 0, estRev: 0, roster: [], rowMeta: new Map(), fteBreaks: [0.5, 1, 2, 4] };
export const DerivedContext = createContext<Derived>(EMPTY_DERIVED);
export const useDerived = () => useContext(DerivedContext);
