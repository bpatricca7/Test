// Interior crew (UI spec §9.11, P1): inside a building the scene spawns N = clamp(round(on-shift FTE), 1, 24) local
// agents from this building's own daily hours and the crews' shift windows, independent of the 140-agent site
// roster, so a 21.9-FTE gym is never empty while its crews are on shift.
import type { FacilityEstimate } from '@shared/estimate';
import { CREWS, type Crew } from '@shared/factors';
import type { BuildingPlacement, Box2 } from './layout';
import { relShift, serpentine, taskLabel, type Agent, type AgentState, type ScheduledJob } from './sim';

const cache = new Map<string, Agent>();

/** Vertical gap between floors in the cut-away (exploded) interior, so every floor's crew stays visible. */
export const explodeGap = (b: Pick<BuildingPlacement, 'floors' | 'box'>) => (b.floors > 1 ? Math.min(4, Math.max(1.8, Math.min(b.box.w, b.box.d) * 0.22)) : 0);
/** Height of floor `i`'s slab in the exploded interior. */
export const floorY = (b: Pick<BuildingPlacement, 'floors' | 'box' | 'floorHeight'>, i: number) => i * (b.floorHeight + explodeGap(b));

export function interiorAgents(fe: FacilityEstimate | undefined, b: BuildingPlacement | undefined, time: number): AgentState[] {
  if (!fe || !b) return [];
  const onShift: { crew: Crew; heads: number; start: number; len: number; hours: number }[] = [];
  for (const meta of CREWS) {
    const hours = fe.dailyHoursByCrew[meta.id] ?? 0;
    if (hours <= 0.05) continue;
    const len = ((meta.shift.end - meta.shift.start) % 24 + 24) % 24 || 8;
    const r = (((time - meta.shift.start) % 24) + 24) % 24;
    if (r >= len) continue;
    onShift.push({ crew: meta.id, heads: hours / len, start: meta.shift.start, len, hours });
  }
  const total = onShift.reduce((s, c) => s + c.heads, 0);
  if (total <= 0) return [];
  const N = Math.max(1, Math.min(24, Math.round(total)));
  // largest-remainder split of N across the crews on shift
  const raw = onShift.map((c) => (c.heads / total) * N);
  const counts = raw.map(Math.floor);
  let left = N - counts.reduce((s, v) => s + v, 0);
  raw.map((v, i) => ({ i, r: v - Math.floor(v) })).sort((a, b) => b.r - a.r).forEach(({ i }) => { if (left > 0) { counts[i]++; left--; } });
  const out: AgentState[] = [];
  const inset: Box2 = { x: b.box.x, z: b.box.z, w: b.box.w * 0.8, d: b.box.d * 0.8 };
  const floors = Math.max(1, Math.min(24, b.floors));
  onShift.forEach((c, ci) => {
    for (let i = 0; i < counts[ci]; i++) {
      const id = `in-${fe.facilityId}-${c.crew}-${i + 1}`;
      let agent = cache.get(id);
      const job: ScheduledJob = { kind: 'facility', targetId: fe.facilityId, targetName: fe.resolved.buildingNumber ? `Bldg ${fe.resolved.buildingNumber}` : fe.resolved.name, crew: c.crew, task: taskLabel(fe.lines, c.crew), hours: c.hours / Math.max(1, counts[ci]), box: b.box, floors: b.floors, floorHeight: b.floorHeight, y: 0, travelStart: 0, start: 0, end: c.len * 0.98, from: { x: b.box.x, z: b.box.z } };
      if (!agent || agent.jobs[0]?.box !== b.box || agent.jobs[0]?.hours !== job.hours) { agent = { id, crew: c.crew, index: i, represents: 1, jobs: [job], shiftStart: c.start, shiftLen: c.len }; cache.set(id, agent); }
      const r = relShift(agent, time);
      const n = counts[ci];
      const p = (r / c.len + i / n + ci * 0.21) % 1;
      const floor = Math.min(floors - 1, Math.floor(p * floors));
      const pf = p * floors - floor;
      const spacing = Math.max(0.9, Math.min(2.2, inset.d / 6));
      const s = serpentine(inset, pf, spacing, i * 0.137 + ci * 0.31);
      out.push({ agent, status: 'work', x: s.x, y: floorY(b, floor) + 0.1, z: s.z, heading: s.heading, job: agent.jobs[0], floor, progress: Math.min(1, r / c.len) });
    }
  });
  if (cache.size > 400) cache.clear();
  return out;
}
