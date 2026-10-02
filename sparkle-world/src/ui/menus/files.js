// Saving files to the device and opening files from it.
// Inside a claude.ai Artifact the page cannot download directly: it asks the viewer through
// the `downloads` capability (claude.use('downloads').save({ filename, data })). Everywhere
// else a temporary <a download> blob link does the job.

let dlPromise = null;
let dlNs; // undefined = not resolved yet, null = unavailable

/** Start resolving the downloads capability early (memoized; resolves later, never now). */
export function prepareDownloads() {
  if (dlPromise) return dlPromise;
  try {
    const c = typeof window !== 'undefined' ? window.claude : null;
    if (!c || typeof c.use !== 'function') {
      dlNs = null;
      dlPromise = Promise.resolve(null);
    } else {
      dlPromise = Promise.resolve(c.use('downloads'))
        .then((ns) => (dlNs = ns || null))
        .catch(() => (dlNs = null));
    }
  } catch {
    dlNs = null;
    dlPromise = Promise.resolve(null);
  }
  return dlPromise;
}

async function downloadsNamespace(waitMs = 2500) {
  prepareDownloads();
  if (dlNs !== undefined) return dlNs;
  return Promise.race([dlPromise, new Promise((r) => setTimeout(() => r(null), waitMs))]);
}

/** Make a string safe and friendly as a file name (keeps letters, digits, spaces, - _ '). */
export function safeFileName(name, fallback = 'Glimmer World') {
  const s = String(name || '').replace(/[^\p{L}\p{N} _'-]+/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
  return s || fallback;
}

/**
 * Offer a file to the player. data: string | Blob. Resolves one of:
 * 'saved' (handed to the device), 'declined' (the viewer said no), 'failed'.
 */
export async function saveFile({ filename, data, mime = 'application/octet-stream' }) {
  const ns = await downloadsNamespace();
  if (ns && typeof ns.save === 'function') {
    try {
      await ns.save({ filename, data });
      return 'saved';
    } catch (err) {
      const code = err && err.code;
      if (code === 'declined') return 'declined';
      if (code === 'rate_limited') return 'declined';
      console.warn('[files] downloads.save failed', code || err);
      if (code !== 'unavailable' && code !== 'not_granted' && code !== 'capability_disabled' && code !== 'capability_removed') return 'failed';
      // fall through to the link below
    }
  }
  try {
    const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    return 'saved';
  } catch (err) {
    console.warn('[files] download link failed', err);
    return 'failed';
  }
}

/** A data: URL as a Blob (for PNG photos). */
export function dataUrlToBlob(dataUrl) {
  const [head, body] = dataUrl.split(',');
  const mime = (head.match(/data:([^;]+)/) || [])[1] || 'application/octet-stream';
  const bin = atob(body);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/**
 * Let the player pick a file; resolves its text (or null when cancelled / unreadable).
 * accept: e.g. '.json,application/json'.
 */
export function pickTextFile(accept = '') {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    if (accept) input.accept = accept;
    input.style.position = 'fixed';
    input.style.left = '-9999px';
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      input.remove();
      resolve(v);
    };
    input.addEventListener('change', () => {
      const file = input.files && input.files[0];
      if (!file) return finish(null);
      const reader = new FileReader();
      reader.onload = () => finish(typeof reader.result === 'string' ? reader.result : null);
      reader.onerror = () => finish(null);
      reader.readAsText(file);
    });
    input.addEventListener('cancel', () => finish(null));
    document.body.appendChild(input);
    input.click();
  });
}
