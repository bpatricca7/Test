import { createContext, useContext } from 'react';
import type { EstimateResult } from '@shared/estimate';
import type { SiteLayout } from './three/layout';
import type { Agent } from './three/sim';

export interface Derived { est: EstimateResult | null; layout: SiteLayout | null; roster: Agent[] }
export const DerivedContext = createContext<Derived>({ est: null, layout: null, roster: [] });
export const useDerived = () => useContext(DerivedContext);
