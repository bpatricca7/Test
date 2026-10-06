// Tiny JSON-file project store (one file per project under data/projects).
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Project } from '../shared/types';

const here = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.resolve(here, '../data/projects');

export async function ensureDir() {
  await fs.mkdir(DIR, { recursive: true });
}

export function emptyProject(id = 'default', name = 'Untitled BOS estimate'): Project {
  const now = new Date().toISOString();
  return {
    id, name, createdAt: now, updatedAt: now,
    inventory: { site: {}, facilities: [], grounds: [] },
    factorOverrides: {},
    assumptionOverrides: {},
    ai: { model: 'claude-opus-5-5', effort: 'xhigh' },
    documents: [],
  };
}

const file = (id: string) => path.join(DIR, `${id.replace(/[^a-z0-9_-]/gi, '_')}.json`);

export async function loadProject(id: string): Promise<Project> {
  await ensureDir();
  try {
    const raw = await fs.readFile(file(id), 'utf8');
    return JSON.parse(raw) as Project;
  } catch {
    return emptyProject(id);
  }
}

export async function saveProject(p: Project): Promise<Project> {
  await ensureDir();
  p.updatedAt = new Date().toISOString();
  await fs.writeFile(file(p.id), JSON.stringify(p, null, 2));
  return p;
}

export async function listProjects(): Promise<{ id: string; name: string; updatedAt: string; facilities: number }[]> {
  await ensureDir();
  const names = (await fs.readdir(DIR)).filter((n) => n.endsWith('.json'));
  const out = [];
  for (const n of names) {
    try {
      const p = JSON.parse(await fs.readFile(path.join(DIR, n), 'utf8')) as Project;
      out.push({ id: p.id, name: p.name, updatedAt: p.updatedAt, facilities: p.inventory.facilities.length });
    } catch { /* skip corrupt */ }
  }
  return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
