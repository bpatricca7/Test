// Live crew simulation. Builds a daily roster from the estimate (one agent per head, or one agent
// representing k heads for very large contracts), schedules each agent's jobs across its shift and
// computes deterministic positions for any simulated time of day.
import type { EstimateResult } from '@shared/estimate';
import { CREWS, crewMeta, type Crew } from '@shared/factors';
import type { Box2, SiteLayout } from './layout';

export interface Job {
  kind: 'facility' | 'zone';
  targetId: string;
  targetName: string;
  crew: Crew;
  task: string;
  hours: number; // hours of work for one agent
  box: Box2;
  floors: number;
  floorHeight: number;
  y: number; // ground y
}

export interface ScheduledJob extends Job {
  travelStart: number; // hours since shift start
  start: number;
  end: number;
  from: { x: number; z: number };
}

export interface Agent {
  id: string;
  crew: Crew;
  index: number;
  represents: number; // heads represented by this agent
  jobs: ScheduledJob[];
  shiftStart: number;
  shiftLen: number;
}

export interface AgentState {
  agent: Agent;
  status: 'off' | 'travel' | 'work';
  x: number; y: number; z: number;
  heading: number;
  job?: ScheduledJob;
  floor: number;
  progress: number;
}

const WALK_SPEED = 110; // scene units per sim hour (visual pacing)

function taskLabel(lines: { crew: Crew; name: string; annualHours: number }[], crew: Crew): string {
  const top = lines.filter((l) => l.crew === crew).sort((a, b) => b.annualHours - a.annualHours).slice(0, 2).map((l) => l.name.split(',')[0].split('(')[0].trim());
  return top.join(' · ') || crewMeta(crew).short;
}

export function buildRoster(est: EstimateResult, layout: SiteLayout, maxAgents = 140): Agent[] {
  const bmap = new Map(layout.buildings.map((b) => [b.id, b]));
  const zmap = new Map(layout.zones.map((z) => [z.id, z]));
  const jobsByCrew = new Map<Crew, Job[]>();
  const push = (j: Job) => { const arr = jobsByCrew.get(j.crew) ?? []; arr.push(j); jobsByCrew.set(j.crew, arr); };

  for (const fe of est.facilities) {
    const b = bmap.get(fe.facilityId); if (!b) continue;
    for (const [crew, hrs] of Object.entries(fe.dailyHoursByCrew) as [Crew, number][]) {
      if (hrs <= 0.05) continue;
      push({ kind: 'facility', targetId: fe.facilityId, targetName: fe.resolved.buildingNumber ? `Bldg ${fe.resolved.buildingNumber}` : fe.resolved.name, crew, task: taskLabel(fe.lines, crew), hours: hrs, box: b.box, floors: b.floors, floorHeight: b.floorHeight, y: 0 });
    }
  }
  for (const ge of est.grounds) {
    const z = zmap.get(ge.areaId); if (!z) continue;
    for (const [crew, hrs] of Object.entries(ge.dailyHoursByCrew) as [Crew, number][]) {
      if (hrs <= 0.05) continue;
      push({ kind: 'zone', targetId: ge.areaId, targetName: ge.area.name, crew, task: taskLabel(ge.lines, crew), hours: hrs, box: z.box, floors: 1, floorHeight: 0, y: 0 });
    }
  }

  // headcount per crew from the estimate; scale down if the roster would be too large to draw
  const heads = new Map<Crew, number>();
  for (const c of est.crews) heads.set(c.crew, c.headcount);
  const totalHeads = [...heads.values()].reduce((s, v) => s + v, 0);
  const scale = totalHeads > maxAgents ? totalHeads / maxAgents : 1;

  const agents: Agent[] = [];
  for (const meta of CREWS) {
    const crew = meta.id;
    const hc = heads.get(crew) ?? 0;
    if (hc <= 0) continue;
    const n = Math.max(1, Math.round(hc / scale));
    const represents = Math.max(1, Math.round(hc / n));
    const shiftStart = meta.shift.start;
    const shiftLen = ((meta.shift.end - meta.shift.start) % 24 + 24) % 24 || 8;

    let jobs = jobsByCrew.get(crew) ?? [];
    if (crew === 'supervision') {
      // supervisors tour every facility and zone briefly
      jobs = [...layout.buildings.map((b) => ({ kind: 'facility' as const, targetId: b.id, targetName: est.facilities.find((f) => f.facilityId === b.id)?.resolved.name ?? b.id, crew, task: 'Quality inspection', hours: 0.5, box: b.box, floors: b.floors, floorHeight: b.floorHeight, y: 0 }))];
    }
    // split long jobs so several agents can share a big building; scale hours to this agent's "weight"
    const chunks: Job[] = [];
    for (const j of jobs) {
      const perAgentHours = j.hours / represents;
      const parts = Math.max(1, Math.ceil(perAgentHours / (shiftLen * 0.9)));
      for (let i = 0; i < parts; i++) chunks.push({ ...j, hours: perAgentHours / parts });
    }
    chunks.sort((a, b) => b.hours - a.hours);
    // LPT assignment onto n agents
    const buckets: { load: number; jobs: Job[] }[] = Array.from({ length: n }, () => ({ load: 0, jobs: [] }));
    for (const c of chunks) { const b = buckets.reduce((m, x) => (x.load < m.load ? x : m), buckets[0]); b.jobs.push(c); b.load += c.hours; }

    buckets.forEach((b, i) => {
      // order jobs by location to reduce silly back-and-forth
      b.jobs.sort((p, q) => p.box.x - q.box.x || p.box.z - q.box.z);
      const scheduled: ScheduledJob[] = [];
      let t = 0; let from = { x: layout.depot.x, z: layout.depot.z };
      const avail = shiftLen * 0.92;
      const total = b.jobs.reduce((s, j) => s + j.hours, 0);
      const squeeze = total > avail ? avail / total : 1;
      for (const j of b.jobs) {
        const dist = Math.hypot(j.box.x - from.x, j.box.z - from.z);
        const travel = Math.max(0.05, dist / WALK_SPEED);
        const start = t + travel;
        const dur = Math.max(0.1, j.hours * squeeze);
        scheduled.push({ ...j, travelStart: t, start, end: start + dur, from });
        t = start + dur; from = { x: j.box.x, z: j.box.z };
      }
      agents.push({ id: `${crew}-${i + 1}`, crew, index: i, represents, jobs: scheduled, shiftStart, shiftLen });
    });
  }
  return agents;
}

export function relShift(agent: Agent, time: number): number {
  return (((time - agent.shiftStart) % 24) + 24) % 24;
}

/** Position inside a box following a serpentine (lawn-mower) pattern as progress goes 0→1. */
export function serpentine(box: Box2, p: number, spacing: number, phase = 0): { x: number; z: number; heading: number } {
  const rows = Math.max(1, Math.round(box.d / spacing));
  const pp = ((p + phase) % 1 + 1) % 1;
  const row = Math.min(rows - 1, Math.floor(pp * rows));
  const u = pp * rows - row;
  const dir = row % 2 === 0 ? 1 : -1;
  const x = box.x - box.w / 2 + (dir === 1 ? u : 1 - u) * box.w;
  const z = box.z - box.d / 2 + (row + 0.5) * (box.d / rows);
  return { x, z, heading: dir === 1 ? 0 : Math.PI };
}

export function agentStates(agents: Agent[], time: number, depot: { x: number; z: number }): AgentState[] {
  return agents.map((agent) => {
    const r = relShift(agent, time);
    const off: AgentState = { agent, status: 'off', x: depot.x, y: 0, z: depot.z, heading: 0, floor: 0, progress: 0 };
    if (r >= agent.shiftLen || agent.jobs.length === 0) return off;
    for (const job of agent.jobs) {
      if (r < job.travelStart) break;
      if (r < job.start) {
        const u = (r - job.travelStart) / Math.max(1e-6, job.start - job.travelStart);
        const x = job.from.x + (job.box.x - job.from.x) * u;
        const z = job.from.z + (job.box.z - job.from.z) * u;
        return { agent, status: 'travel', x, y: 0, z, heading: Math.atan2(job.box.x - job.from.x, job.box.z - job.from.z), job, floor: 0, progress: 0 };
      }
      if (r < job.end) {
        const p = (r - job.start) / Math.max(1e-6, job.end - job.start);
        const floors = Math.max(1, job.floors);
        const floor = Math.min(floors - 1, Math.floor(p * floors));
        const pf = p * floors - floor;
        const inset: Box2 = { x: job.box.x, z: job.box.z, w: job.box.w * 0.84, d: job.box.d * 0.84 };
        const spacing = job.kind === 'zone' ? Math.max(0.8, Math.min(2.5, inset.d / 8)) : Math.max(0.9, Math.min(2.2, inset.d / 6));
        const s = serpentine(inset, pf, spacing, agent.index * 0.137);
        return { agent, status: 'work', x: s.x, y: job.kind === 'facility' ? floor * job.floorHeight : 0, z: s.z, heading: s.heading, job, floor, progress: p };
      }
    }
    return off;
  });
}

export interface CrewNow { crew: Crew; onShift: number; working: number; traveling: number; heads: number; where: { target: string; task: string; n: number }[] }

export function summarize(states: AgentState[]): CrewNow[] {
  const out = new Map<Crew, CrewNow>();
  for (const s of states) {
    const c = out.get(s.agent.crew) ?? { crew: s.agent.crew, onShift: 0, working: 0, traveling: 0, heads: 0, where: [] };
    c.heads += s.agent.represents;
    if (s.status !== 'off') c.onShift += s.agent.represents;
    if (s.status === 'work' && s.job) {
      c.working += s.agent.represents;
      const w = c.where.find((x) => x.target === s.job!.targetName && x.task === s.job!.task);
      if (w) w.n += s.agent.represents; else c.where.push({ target: s.job.targetName, task: s.job.task, n: s.agent.represents });
    }
    if (s.status === 'travel') c.traveling += s.agent.represents;
    out.set(s.agent.crew, c);
  }
  for (const c of out.values()) c.where.sort((a, b) => b.n - a.n);
  return CREWS.map((m) => out.get(m.id)).filter((x): x is CrewNow => Boolean(x));
}

export const fmtTime = (h: number) => {
  const hh = Math.floor(((h % 24) + 24) % 24);
  const mm = Math.floor((h - Math.floor(h)) * 60);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
};
