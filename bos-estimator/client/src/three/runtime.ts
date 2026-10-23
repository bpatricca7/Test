// Non-reactive scene runtime shared by the 3D components, the label layer and the test hooks.
// Written per frame; never read through React state.
import type { AgentState } from './sim';

export interface LabelOut { id: string; text: string; lod: 'chip' | 'full' | 'pin'; x: number; y: number; w: number; h: number; isNew: boolean }
export interface CrewPoint { id: string; crew: string; wx: number; wy: number; wz: number; state: AgentState; xray?: boolean }

export const rt = {
  frame: 0,
  /** gl.info numbers of the last complete frame */
  info: { calls: 0, triangles: 0 },
  /** fits: counted fit triggers (spec §9.3); refits: re-framing the last fit in a new free rect (not a trigger) */
  cam: { fits: 0, refits: 0, retargets: 0, moving: false, userMoved: false, fitError: 0, lastFitAt: 0 },
  /** visible labels (viewport px), written by the label layer on every pack / reprojection */
  labels: [] as LabelOut[],
  /** rects (viewport px) the labels and pins cover; used to report agents hidden under labels */
  labelRects: [] as { x0: number; y0: number; x1: number; y1: number }[],
  /** agents drawn this frame, world space (global roster + interior crew) */
  crew: [] as CrewPoint[],
  /** the selected agent when it is not drawn (working inside a building at site distance): its card stays */
  selAgent: null as CrewPoint | null,
  /** facility id → crew → heads working inside now (site roster); drives the labels' crew-dot row */
  crewAt: new Map<string, Map<string, number>>(),
  /** true at site distance, when interior crews are hidden and labels show crew dots */
  interiorHidden: true,
  shadowDirty: true,
  /** a layout change asks for the shadow map in the frame after the next one (Lighting) */
  shadowDeferred: false,
  /** free-rect scissor in CSS px (origin bottom-left), shared by the main render and the post chain */
  scissor: { on: false, x: 0, y: 0, w: 0, h: 0 },
  /** set by components that animate; Scene keeps rendering while any is true */
  animating: new Set<string>(),
  /** High-tier frame-rate governor (perf.ts): 0 = full spec; 1 = no SMAA; 2 = + 0.75× DPR; 3 = + no Live glow */
  perf: { level: 0, changedAt: 0, since: 0, last: 0, median: 0, noUpUntil: 0, samples: [] as number[] },
};

export const requestShadow = () => { rt.shadowDirty = true; };
