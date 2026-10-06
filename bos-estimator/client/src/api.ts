import type { EstimateResult } from '@shared/estimate';
import type { ExtractionEvent, Project } from '@shared/types';

export interface Health { ok: boolean; aiAvailable: boolean; presets: { id: string; label: string; blurb: string }[]; defaultModel: string; defaultEffort: string }

export const api = {
  health: () => fetch('/api/health').then((r) => r.json() as Promise<Health>),
  sample: () => fetch('/api/sample').then((r) => r.text()),
  getProject: (id: string) => fetch(`/api/projects/${id}`).then((r) => r.json() as Promise<Project>),
  saveProject: (p: Project) => fetch(`/api/projects/${p.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) }).then((r) => r.json() as Promise<Project>),
  resetProject: (id: string) => fetch(`/api/projects/${id}`, { method: 'DELETE' }).then((r) => r.json() as Promise<Project>),
  estimate: (id: string) => fetch(`/api/projects/${id}/estimate`, { method: 'POST' }).then((r) => r.json() as Promise<EstimateResult>),
  exportCsvUrl: (id: string) => `/api/projects/${id}/export.csv`,
};

export interface ExtractOptions {
  projectId: string;
  files: File[];
  text?: string;
  textName?: string;
  model: string;
  effort: string;
  ingest: 'auto' | 'native_pdf' | 'text';
  provider: 'auto' | 'claude' | 'heuristic';
  mode: 'replace' | 'append';
  signal?: AbortSignal;
  onEvent: (e: ExtractionEvent) => void;
}

/** POST multipart and parse the server-sent event stream. */
export async function runExtraction(o: ExtractOptions): Promise<void> {
  const fd = new FormData();
  for (const f of o.files) fd.append('files', f, f.name);
  if (o.text) { fd.append('text', o.text); fd.append('textName', o.textName ?? 'Pasted text'); }
  fd.append('model', o.model); fd.append('effort', o.effort); fd.append('ingest', o.ingest); fd.append('provider', o.provider); fd.append('mode', o.mode);
  const res = await fetch(`/api/projects/${o.projectId}/extract`, { method: 'POST', body: fd, signal: o.signal });
  if (!res.ok || !res.body) throw new Error(`Server error ${res.status}`);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, idx); buf = buf.slice(idx + 2);
      for (const line of chunk.split('\n')) {
        if (!line.startsWith('data: ')) continue;
        try { o.onEvent(JSON.parse(line.slice(6)) as ExtractionEvent); } catch { /* ignore malformed */ }
      }
    }
  }
}
