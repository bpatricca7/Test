// The family server's /api from the game (docs/ACCOUNTS.md §5, §7.3): same-origin fetch with
// the session cookie, X-SW: 1 and JSON on every change (the server's CSRF rules, §4.7), a
// timeout, and errors as Error objects with `status` and `code` whose message holds the
// status ("403 not_entitled"), so the store's permanent-error check recognizes 401/403.
// No request leaves this module unless the account module decided that accounts are on.

/** An Error for a failed call: { status (0 = no answer), code, data, retryAfter }. */
export function apiError(status, code, data = null, retryAfter = 0) {
  const e = new Error(status ? `${status} ${code}` : code);
  e.status = status;
  e.code = code;
  e.data = data;
  e.retryAfter = retryAfter;
  if (data && typeof data === 'object') {
    if (Number.isFinite(data.rev)) e.rev = data.rev;
    if (Number.isFinite(data.updatedAt)) e.updatedAt = data.updatedAt;
  }
  return e;
}

/** "r12" (an ETag) → 12, or undefined. */
export const revOf = (etag) => {
  const m = /r(\d+)/.exec(etag || '');
  return m ? Number(m[1]) : undefined;
};

/**
 * o.base: prefix for paths (tests: 'http://127.0.0.1:1234'); o.fetch; o.headers: added to every
 * request (tests: the cookie and Origin a browser would send).
 * → { call(method, path, { json, body, headers, ifMatch, timeout }) → { status, json, etag } }
 */
export function createApi(o = {}) {
  const base = o.base || '';
  const f = o.fetch || ((...a) => globalThis.fetch(...a));
  const extra = o.headers || {};
  async function call(method, path, { json, body, headers = {}, ifMatch, timeout = 8000 } = {}) {
    const h = { ...extra, ...headers };
    if (method !== 'GET') {
      h['X-SW'] = '1';
      h['Content-Type'] = 'application/json';
    }
    if (ifMatch !== undefined) h['If-Match'] = ifMatch;
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = setTimeout(() => ctl && ctl.abort(), timeout);
    let res;
    let text = '';
    try {
      res = await f(base + path, {
        method, headers: h, credentials: 'same-origin', cache: 'no-store', signal: ctl ? ctl.signal : undefined,
        body: json !== undefined ? JSON.stringify(json) : body,
      });
      text = res.status === 204 ? '' : await res.text();
    } catch {
      throw apiError(0, 'offline');
    } finally {
      clearTimeout(timer);
    }
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {}
    if (!res.ok) throw apiError(res.status, (data && typeof data.error === 'string' && data.error) || 'unavailable', data, Number(res.headers.get('retry-after')) || 0);
    return { status: res.status, json: data, etag: res.headers.get('etag') };
  }
  return { call };
}
