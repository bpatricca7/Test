// Optional password gate for a deployed instance. Set APP_PASSWORD and every page and API route needs the session
// cookie that POST /login sets; GET /api/health stays open for the host's health check. Without APP_PASSWORD (local
// use) nothing is gated.
import crypto from 'node:crypto';
import express from 'express';

const COOKIE = 'bos_session';
const MAX_AGE_S = 30 * 24 * 3600;
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 10;

const hash = (s: string) => crypto.createHash('sha256').update(s).digest();
const sameSecret = (a: string, b: string) => crypto.timingSafeEqual(hash(a), hash(b));

function readCookie(req: express.Request, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return undefined;
}

/** Only same-site paths: "/x?y", never "//host" or "https://…". */
const safeNext = (v: unknown) => (typeof v === 'string' && /^\/(?![/\\])/.test(v) ? v : '/');

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function loginPage(next: string, error?: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#111111"><title>Sign in · BOS Estimator</title>
<style>
:root{color-scheme:dark}*{box-sizing:border-box}
body{margin:0;min-height:100vh;min-height:100dvh;display:grid;place-items:center;background:#111111;color:#e2e2e2;
font:15px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;padding:24px max(16px,env(safe-area-inset-right)) 24px max(16px,env(safe-area-inset-left))}
form{width:100%;max-width:340px;display:grid;gap:14px;padding:28px 24px;background:#161616;border-radius:12px;box-shadow:inset 0 0 0 1px #2b2b2b}
.mark{font-weight:800;letter-spacing:.02em;font-size:18px}.mark i{display:block;width:28px;height:2px;margin-top:4px;background:#c6f43c;box-shadow:0 0 8px #c6f43c}
p{margin:0;color:#a6a6a6;font-size:13.5px}label{font-size:13px;color:#a6a6a6}
input{width:100%;height:46px;padding:0 12px;border-radius:8px;border:1px solid #6a6a6a;background:#111111;color:#e2e2e2;font:inherit;font-size:16px}
input:focus{outline:2px solid #ffffff;outline-offset:2px}
button{height:46px;border:0;border-radius:8px;background:#c6f43c;color:#0a0a0a;font:inherit;font-weight:650;cursor:pointer}
button:focus-visible{outline:2px solid #ffffff;outline-offset:2px}.err{color:#ff7a72;font-size:13.5px}
</style></head><body>
<form method="post" action="/login">
<div class="mark">BOS<i></i></div>
<p>This estimator is private. Enter the access password.</p>
${error ? `<div class="err" role="alert">${escapeHtml(error)}</div>` : ''}
<label for="pw">Password</label>
<input id="pw" name="password" type="password" autocomplete="current-password" required autofocus>
<input type="hidden" name="next" value="${escapeHtml(next)}">
<button type="submit">Sign in</button>
</form></body></html>`;
}

/** Installs the gate on `app` (before any route) when a password is set; returns whether it is active. */
export function installPasswordGate(app: express.Express, password: string | undefined): boolean {
  if (!password) return false;
  const token = crypto.createHmac('sha256', password).update('bos-session-v1').digest('base64url');
  const failures = new Map<string, number[]>();
  const signedIn = (req: express.Request) => { const c = readCookie(req, COOKIE); return c != null && sameSecret(c, token); };

  app.post('/login', express.urlencoded({ extended: false, limit: '4kb' }), (req, res) => {
    const ip = req.ip ?? 'unknown';
    const now = Date.now();
    const recent = (failures.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
    const next = safeNext(req.body?.next);
    if (recent.length >= MAX_FAILURES) { res.status(429).type('html').send(loginPage(next, 'Too many attempts. Try again in a few minutes.')); return; }
    if (typeof req.body?.password !== 'string' || !sameSecret(req.body.password, password)) {
      recent.push(now); failures.set(ip, recent);
      res.status(401).type('html').send(loginPage(next, 'Wrong password.'));
      return;
    }
    failures.delete(ip);
    res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: req.secure, maxAge: MAX_AGE_S * 1000, path: '/' });
    res.redirect(303, next);
  });
  app.post('/logout', (_req, res) => { res.clearCookie(COOKIE, { path: '/' }); res.redirect(303, '/'); });

  app.use((req, res, next) => {
    if (signedIn(req)) { next(); return; }
    if (req.method === 'GET' && req.path === '/api/health') { res.json({ ok: true }); return; }
    if (req.path.startsWith('/api/')) { res.status(401).json({ error: 'Sign in required. Reload the page to sign in.' }); return; }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.status(401).type('text/plain').send('Sign in required.'); return; }
    res.status(401).type('html').send(loginPage(safeNext(req.originalUrl)));
  });
  return true;
}
