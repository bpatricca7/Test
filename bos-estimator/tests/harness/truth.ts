// Ground-truth contract for RFP test fixtures (tests/fixtures/<id>/truth.json).
import type { ClimateZone, FacilityCategory, GroundsKind, GroundsUnit, ServiceLevel } from '../../shared/types';

export type InputKind = 'pdf' | 'scanned-pdf' | 'docx' | 'xlsx' | 'csv' | 'txt';

export interface FixtureInput {
  /** Source file inside the fixture directory (HTML for pdf/scanned-pdf/docx, CSV for xlsx/csv, TXT for txt). */
  src: string;
  /** What the renderer produces from it; the produced file lands in <fixture>/build/. */
  as: InputKind;
  /** Optional output file name (defaults to <src basename>.<ext>). */
  out?: string;
}

export interface TruthFacility {
  buildingNumber?: string;
  name: string;
  grossSqft: number;
  cleanableSqft?: number;
  floors?: number;
  serviceLevel?: ServiceLevel;
  category?: FacilityCategory;
  restroomFixtures?: number;
  dining?: { mealsPerDay: number; mealPeriods?: number; daysPerWeek?: number };
}

export interface TruthGrounds {
  kind: GroundsKind;
  quantity: number;
  unit: GroundsUnit;
  /** Building numbers the area belongs to, if the document ties it to buildings. */
  buildingNumbers?: string[];
  name?: string;
}

export interface FixtureTruth {
  id: string;
  title: string;
  theme: string;
  provenance: {
    /** real-rows: rows copied from a real public document; real-format: real exhibit layout/wording with illustrative values; synthetic: invented to exercise a failure mode. */
    fidelity: 'real-rows' | 'real-format' | 'synthetic';
    sources: { url: string; note?: string }[];
    notes?: string;
  };
  inputs: FixtureInput[];
  expect: {
    facilities: TruthFacility[];
    /** true when the list above is every facility in scope (so precision is measurable). */
    facilitiesComplete: boolean;
    grounds?: TruthGrounds[];
    site?: { contractYears?: number; climateZone?: ClimateZone; installationName?: string; solicitation?: string };
    priorAward?: { totalValue?: number; periodMonths?: number; annualValue?: number; spendToDate?: number; spendPeriodMonths?: number; incumbent?: string; contractNumber?: string; awardYear?: number };
  };
  /** The real-world traps this fixture exercises (wrapped names, glued columns, square meters, addendum supersedes…). */
  traps: string[];
}
