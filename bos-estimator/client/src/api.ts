import type { EstimateResult } from '@shared/estimate';
import type { ExtractionEvent, PriorAward, Project, TopDownAssumptions, TopDownEstimate } from '@shared/types';

/** The server's error message for a failed request: the JSON { error } body when there is one, never an HTML page. */
export async function errorMessage(res: Response, fallback: string): Promise<string> {
  let body = '';
  try { body = await res.text(); } catch { /* body unreadable */ }
  try {
    const j = JSON.parse(body) as { error?: unknown; message?: unknown };
    const m = typeof j.error === 'string' ? j.error : typeof j.message === 'string' ? j.message : '';
    if (m) return m;
  } catch { /* not JSON */ }
  const text = body && !/^\s*</.test(body) ? body.trim().slice(0, 300) : '';
  const status = res.status === 413 ? 'upload too large' : res.statusText || `HTTP ${res.status}`;
  return `${fallback} (${text || status}${text ? '' : `, ${res.status}`})`;
}

async function json<T>(p: Promise<Response>, fallback: string): Promise<T> {
  let r: Response;
  try { r = await p; } catch (err) { throw new Error(`${fallback} (could not reach the server: ${(err as Error).message})`); }
  if (!r.ok) throw new Error(await errorMessage(r, fallback));
  return r.json() as Promise<T>;
}

export interface Health { ok: boolean; aiAvailable: boolean; presets: { id: string; label: string; blurb: string }[]; defaultModel: string; defaultEffort: string }

export const api = {
  health: () => json<Health>(fetch('/api/health'), 'Health check failed'),
  sample: () => fetch('/api/sample').then(async (r) => { if (!r.ok) throw new Error(await errorMessage(r, 'Could not load the sample RFP')); return r.text(); }),
  getProject: (id: string) => json<Project>(fetch(`/api/projects/${id}`), 'Could not load the project'),
  /** Throws on failure (the shell shows "Not saved · Retry"). */
  saveProject: (p: Project, opts: { keepalive?: boolean } = {}) => {
    const body = JSON.stringify(p);
    // keepalive lets a save started while the page unloads finish; browsers cap keepalive bodies at 64 KB
    return json<Project>(fetch(`/api/projects/${p.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body, keepalive: Boolean(opts.keepalive) && body.length < 60_000 }), 'Save failed');
  },
  /** PUT only some top-level keys (the server merges them into its copy) and get the whole saved project back. */
  patchProject: (id: string, patch: Partial<Project> & Record<string, unknown>, opts: { keepalive?: boolean } = {}) => {
    const body = JSON.stringify(patch);
    return json<Project>(fetch(`/api/projects/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body, keepalive: Boolean(opts.keepalive) && body.length < 60_000 }), 'Save failed');
  },
  resetProject: (id: string) => json<Project>(fetch(`/api/projects/${id}`, { method: 'DELETE' }), 'Reset failed'),
  estimate: (id: string) => json<EstimateResult>(fetch(`/api/projects/${id}/estimate`, { method: 'POST' }), 'Estimate failed'),
  exportCsvUrl: (id: string) => `/api/projects/${id}/export.csv`,
  runTopDown: (id: string, body: { provider?: 'auto' | 'claude' | 'heuristic'; priorAward?: PriorAward; overrides?: Partial<TopDownAssumptions> }) =>
    json<TopDownEstimate>(fetch(`/api/projects/${id}/topdown`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), 'Top-down cross-check failed'),
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
  /** called once the server answered (the upload is done and the stream is open) */
  onResponse?: () => void;
}

/** POST multipart and parse the server-sent event stream. */
export async function runExtraction(o: ExtractOptions): Promise<void> {
  const fd = new FormData();
  for (const f of o.files) fd.append('files', f, f.name);
  if (o.text) { fd.append('text', o.text); fd.append('textName', o.textName ?? 'Pasted text'); }
  fd.append('model', o.model); fd.append('effort', o.effort); fd.append('ingest', o.ingest); fd.append('provider', o.provider); fd.append('mode', o.mode);
  let res: Response;
  try {
    res = await fetch(`/api/projects/${o.projectId}/extract`, { method: 'POST', body: fd, signal: o.signal });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new Error(`Could not reach the server (${(err as Error).message}). If the upload was very large, split it into several Append runs.`);
  }
  if (!res.ok) throw new Error(await errorMessage(res, 'Extraction request failed'));
  if (!res.body) throw new Error('Extraction request failed (empty response from the server)');
  o.onResponse?.();
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
