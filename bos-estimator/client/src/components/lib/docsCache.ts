// Source-file cache (UI spec §5.13, P1): uploaded files are kept in this browser's IndexedDB (store `bos-docs`,
// key `${projectId}/${name}`) when a read starts, so a source viewer can open the cited page later without a server
// change. Every call is wrapped: when IndexedDB is unavailable (private window, blocked storage) the functions
// resolve to empty results and the UI falls back to the excerpt only.

const DB_NAME = 'bos-docs';
const STORE = 'files';
export const DOCS_CACHE_EVENT = 'bos:docs-cache';

interface Rec { key: string; projectId: string; name: string; type: string; size: number; at: number; blob: Blob }
export interface CacheStats { count: number; bytes: number; names: string[] }

let dbPromise: Promise<IDBDatabase | null> | null = null;
function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase | null>((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') { resolve(null); return; }
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => { try { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'key' }); } catch { /* ignore */ } };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch { resolve(null); }
  });
  return dbPromise;
}

const range = (projectId: string) => IDBKeyRange.bound(`${projectId}/`, `${projectId}/￿`);
const done = (tx: IDBTransaction) => new Promise<boolean>((res) => { tx.oncomplete = () => res(true); tx.onerror = () => res(false); tx.onabort = () => res(false); });
const notify = (projectId: string) => { try { window.dispatchEvent(new CustomEvent(DOCS_CACHE_EVENT, { detail: { projectId } })); } catch { /* ignore */ } };

/** Store (or replace) files for a project. Never throws. */
export async function cacheFiles(projectId: string, files: readonly File[]): Promise<boolean> {
  if (!files.length) return true;
  try {
    const db = await openDb(); if (!db) return false;
    const tx = db.transaction(STORE, 'readwrite');
    const st = tx.objectStore(STORE);
    const at = Date.now();
    for (const f of files) st.put({ key: `${projectId}/${f.name}`, projectId, name: f.name, type: f.type, size: f.size, at, blob: f } satisfies Rec);
    const ok = await done(tx);
    notify(projectId);
    return ok;
  } catch { return false; }
}

/** Count and total size of the cached files of a project. */
export async function cacheStats(projectId: string): Promise<CacheStats> {
  const empty: CacheStats = { count: 0, bytes: 0, names: [] };
  try {
    const db = await openDb(); if (!db) return empty;
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll(range(projectId));
    const rows = await new Promise<Rec[]>((res) => { req.onsuccess = () => res((req.result ?? []) as Rec[]); req.onerror = () => res([]); });
    return { count: rows.length, bytes: rows.reduce((s, r) => s + (r.size || 0), 0), names: rows.map((r) => r.name) };
  } catch { return empty; }
}

/** The cached file for a document name, or null. */
export async function getCachedFile(projectId: string, name: string): Promise<Blob | null> {
  try {
    const db = await openDb(); if (!db) return null;
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(`${projectId}/${name}`);
    const rec = await new Promise<Rec | undefined>((res) => { req.onsuccess = () => res(req.result as Rec | undefined); req.onerror = () => res(undefined); });
    return rec?.blob ?? null;
  } catch { return null; }
}

/** Remove every cached file of a project. */
export async function clearCache(projectId: string): Promise<boolean> {
  try {
    const db = await openDb(); if (!db) return false;
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(range(projectId));
    const ok = await done(tx);
    notify(projectId);
    return ok;
  } catch { return false; }
}
