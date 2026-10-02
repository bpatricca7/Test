// Emails (docs/ACCOUNTS.md §10, §13.7): every email goes through the `outbox` table, so it is
// sent exactly once, retried, and never lost in a deploy; the words are in mail-templates.mjs.
//
//   const mail = createMail(ctx)
//   await mail.enqueue(q, template, to, data, { familyId, sendAfter })
//       q: db or the caller's transaction (the email then exists only if the change commits).
//       data: codes, links, dates, flags; NEVER a child's nickname or world (§10's rule).
//       sendAfter: ms (the app clock), e.g. consent_confirm 24 h later.
//   await mail.runOutbox({ now })  → { sent, failed, stopped }   (jobs.mjs runs it under the
//       `sparkle-world:job:outbox` advisory lock every 15 s and right after an enqueue)
//   mail.captured                   the memory transport's emails (GET /api/test/mail)
//   mail.setTransport(fn)           tests: fn({ to, from, replyTo, template, subject, text, html, id })
//
// Transports (MAIL_MODE): `resend`, `postmark`, `microsoft` (production: Node's fetch, no SDK;
// `microsoft` is Microsoft 365 through Microsoft Graph, see below), `log` (development: one line
// with the masked address, and the code and link of sign-in emails), `memory` (tests). Failures
// back off 1 min, 5 min, 30 min, 2 h, 6 h, 12 h, 24 h, then stop; a transport's error may say
// `permanent` (stop now) or `retryAfterMs` (the provider's Retry-After, capped at 1 h).
// Secret data (codes, links) is scrubbed to {} once an email is sent or given up; a sign-in or
// check code older than its 15 minutes is not sent at all. Errors are recorded and logged by
// name only; an address, a code or a link is never logged (except the `log` transport's own
// development line).

import { renderMail, TEMPLATES, SECRET_TEMPLATES, loadNotice } from './mail-templates.mjs';

export const MAIL_BACKOFF_MS = Object.freeze([60e3, 5 * 60e3, 30 * 60e3, 2 * 3600e3, 6 * 3600e3, 12 * 3600e3, 24 * 3600e3]);
export const MAIL_MAX_TRIES = MAIL_BACKOFF_MS.length + 1; // the first try and 7 retries
const CODE_LIFE_MS = 15 * 60e3;

/** 'bryan@gmail.com' → 'b•••@gmail.com' (for the development log only). */
export function maskEmail(email) {
  const s = String(email || '');
  const at = s.lastIndexOf('@');
  if (at <= 0) return '•••';
  return s[0] + '•••' + s.slice(at);
}

const errName = (err) => String((err && (err.code || err.name)) || 'Error').replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 40) || 'Error';

function httpFail(status) {
  const e = new Error('mail provider answered ' + status);
  e.name = 'MailHttpError';
  e.code = 'http_' + status;
  return e;
}

// ---------------------------------------------------------------------------------------------
// transports

function resend(cfg) {
  return async (m) => {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.mailApiKey}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': `sparkle-outbox-${m.id}`, // a retry after a crash is not sent twice
      },
      body: JSON.stringify({ from: m.from, to: [m.to], subject: m.subject, text: m.text, html: m.html, ...(m.replyTo ? { reply_to: m.replyTo } : {}) }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw httpFail(res.status);
    await res.arrayBuffer().catch(() => {});
  };
}

function postmark(cfg) {
  return async (m) => {
    const res = await fetch('https://api.postmarkapp.com/email', {
      method: 'POST',
      headers: { 'X-Postmark-Server-Token': cfg.mailApiKey, Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        From: m.from,
        To: m.to,
        Subject: m.subject,
        TextBody: m.text,
        HtmlBody: m.html,
        ...(m.replyTo ? { ReplyTo: m.replyTo } : {}),
        MessageStream: 'outbound',
        TrackOpens: false,
        TrackLinks: 'None',
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw httpFail(res.status);
    await res.arrayBuffer().catch(() => {});
  };
}

// ---- Microsoft 365 (MAIL_MODE=microsoft): Microsoft Graph, app-only (OAuth 2.0 client credentials)
//
// Token: POST {login}/{MS_TENANT_ID}/oauth2/v2.0/token (client_id, client_secret,
// scope=https://graph.microsoft.com/.default, grant_type=client_credentials), kept in memory
// until 5 minutes before its expires_in, one refresh at a time. Send: POST
// {graph}/v1.0/users/{the MAIL_FROM mailbox}/sendMail → 202 Accepted, with saveToSentItems:false
// (no copy of a code or a family's email collects in the mailbox's Sent Items; docs/ACCOUNTS.md
// §10). A 401 drops the token and tries once more with a fresh one. 429 and 5xx are retried
// (Retry-After up to 5 s is waited for once, in place; a longer one moves the email's next try,
// at most 1 h, never sooner than the outbox's own backoff). 413, and a 400 whose code is about
// this one message (ErrorInvalidRecipients, ErrorMessageSizeExceeded), stop the email (the same
// message would be refused again); any other 400 keeps the slow backoff. SW_OPERATOR_EMAIL (every
// email's Reply-To) is checked at start, so a bad one never stops every email. 401/403/404 and sign-in failures are setup problems: one log line that
// names the likely fix, and the outbox's slow backoff keeps the email until it is fixed. Every
// request has a 10 s timeout. A log line never holds the secret, the token, an address or
// Microsoft's own error text (it can quote the address); only status numbers and error code names.

export const MS_TIMEOUT_MS = 10000;
export const MS_TOKEN_EARLY_MS = 5 * 60e3;
export const MS_RETRY_AFTER_WAIT_MS = 5000;
export const MAIL_RETRY_AFTER_CAP_MS = 3600e3;
const MS_HINT_EVERY_MS = 15 * 60e3;
const MS_PERMANENT_400 = new Set(['ErrorInvalidRecipients', 'ErrorMessageSizeExceeded']);
const MS_LOGIN = 'https://login.microsoftonline.com';
const MS_GRAPH = 'https://graph.microsoft.com';

/** Retry-After (seconds, or an HTTP date) → ms from now; null when absent or unreadable. */
export function retryAfterMs(value, nowMs = Date.now()) {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  if (/^\d+$/.test(s)) return Number(s) * 1000;
  const t = Date.parse(s);
  return Number.isFinite(t) ? Math.max(0, t - nowMs) : null;
}

const safeCode = (v) => (typeof v === 'string' ? v.replace(/[^A-Za-z0-9_.]/g, '').slice(0, 60) : '');

/** Entra sign-in error numbers (AADSTS…) → the fix, in words the dad can act on. */
const MS_TOKEN_HINTS = new Map([
  [7000215, "the client secret is not right: put the secret's Value (not its Secret ID) in MS_CLIENT_SECRET"],
  [7000222, 'the client secret has expired: make a new one (App registrations → the app → Certificates & secrets), put its Value in MS_CLIENT_SECRET and deploy'],
  [700016, 'no app with this MS_CLIENT_ID in this tenant: check MS_CLIENT_ID (Application (client) ID) and MS_TENANT_ID (Directory (tenant) ID)'],
  [90002, 'the tenant was not found: check MS_TENANT_ID (Directory (tenant) ID)'],
  [900023, 'the tenant was not found: check MS_TENANT_ID (Directory (tenant) ID)'],
  [700024, 'the client assertion is not valid: check MS_CLIENT_SECRET'],
  [1002012, 'the scope was refused: check the app registration in the Entra admin center'],
]);

function microsoft(cfg, { log, now, sleep, timeoutMs }) {
  const tokenUrl = `${cfg.msLoginBase || MS_LOGIN}/${encodeURIComponent(cfg.msTenantId)}/oauth2/v2.0/token`;
  const sendUrl = `${cfg.msGraphBase || MS_GRAPH}/v1.0/users/${encodeURIComponent(cfg.msMailbox).replace(/%40/g, '@')}/sendMail`;
  let cached = null; // { token, until }
  let inflight = null;
  const said = new Map();
  const hint = (key, text) => {
    const t = now();
    if (said.has(key) && t - said.get(key) < MS_HINT_EVERY_MS) return;
    said.set(key, t);
    log(`mail: ${text}`);
  };
  const fail = (code, { retryAfter = null, permanent = false } = {}) => {
    const e = new Error('Microsoft 365 answered ' + code);
    e.name = 'MailHttpError';
    e.code = code;
    if (retryAfter !== null) e.retryAfterMs = retryAfter;
    if (permanent) e.permanent = true;
    return e;
  };
  const netFail = (err, what) => {
    const timeout = err && (err.name === 'TimeoutError' || err.name === 'AbortError');
    hint(`net_${what}`, `Microsoft 365 could not be reached (${what}: ${timeout ? 'timed out' : 'network error'}); trying again later`);
    return fail(`ms_${what}_${timeout ? 'timeout' : 'network'}`);
  };
  const readJson = async (res) => {
    try {
      return await res.json();
    } catch {
      return null;
    }
  };

  async function fetchToken() {
    let res;
    try {
      res = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams({
          client_id: cfg.msClientId,
          client_secret: cfg.msClientSecret,
          scope: 'https://graph.microsoft.com/.default',
          grant_type: 'client_credentials',
        }).toString(),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      throw netFail(err, 'token');
    }
    const body = await readJson(res);
    if (res.ok && body && typeof body.access_token === 'string' && body.access_token) {
      const life = Number(body.expires_in) * 1000;
      return { token: body.access_token, until: now() + (Number.isFinite(life) ? Math.max(0, life - MS_TOKEN_EARLY_MS) : 0) };
    }
    const status = res.status;
    if (status === 429 || status >= 500) {
      hint(`token_${status}`, `Microsoft 365 sign-in is busy or down (${status}); trying again later`);
      throw fail(`ms_token_${status}`, { retryAfter: retryAfterMs(res.headers.get('retry-after')) });
    }
    const codes = Array.isArray(body?.error_codes) ? body.error_codes.map(Number) : [];
    const known = codes.find((c) => MS_TOKEN_HINTS.has(c));
    const why = known !== undefined ? `${MS_TOKEN_HINTS.get(known)} (AADSTS${known})` : `check MS_TENANT_ID, MS_CLIENT_ID and MS_CLIENT_SECRET${safeCode(body?.error) ? ` (${safeCode(body.error)})` : ''}`;
    hint(`token_${status}_${known ?? ''}`, `Microsoft 365 sign-in failed (${status}): ${why}`);
    throw fail(`ms_token_${status}`);
  }

  async function token() {
    if (cached && now() < cached.until) return cached.token;
    if (!inflight) {
      inflight = fetchToken()
        .then((t) => {
          cached = t;
          return t;
        })
        .finally(() => {
          inflight = null;
        });
    }
    return (await inflight).token;
  }

  return async (m) => {
    const message = {
      subject: m.subject,
      body: m.html ? { contentType: 'HTML', content: m.html } : { contentType: 'Text', content: m.text },
      toRecipients: [{ emailAddress: { address: m.to } }],
      ...(m.replyTo ? { replyTo: [{ emailAddress: { address: m.replyTo } }] } : {}),
    };
    const payload = JSON.stringify({ message, saveToSentItems: false });
    let renewed = false;
    let waited = false;
    for (;;) {
      const t = await token();
      let res;
      try {
        res = await fetch(sendUrl, {
          method: 'POST',
          headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
          body: payload,
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (err) {
        throw netFail(err, 'send');
      }
      if (res.ok) {
        await res.arrayBuffer().catch(() => {});
        return;
      }
      const status = res.status;
      const code = safeCode((await readJson(res))?.error?.code);
      const named = code ? `${status} ${code}` : String(status);
      if (status === 401 && !renewed) {
        renewed = true;
        if (cached && cached.token === t) cached = null; // a fresh token, once
        continue;
      }
      if (status === 429 || status >= 500) {
        const ra = retryAfterMs(res.headers.get('retry-after'));
        if (ra !== null && ra <= MS_RETRY_AFTER_WAIT_MS && !waited) {
          waited = true;
          await sleep(ra);
          continue;
        }
        hint(`send_${status}`, status === 429 ? `Microsoft 365 is limiting how fast we send (429); trying again later` : `Microsoft 365 answered ${status}; trying again later`);
        throw fail(`http_${status}`, { retryAfter: ra });
      }
      if (status === 401) {
        hint('send_401', `Microsoft 365 refused the app's token (${named}): check that MS_TENANT_ID and MS_CLIENT_ID are the same app registration's, and that its Mail.Send permission has admin consent`);
        throw fail('http_401');
      }
      if (status === 403) {
        hint('send_403', `Microsoft 365 refused (${named}): the app needs the Mail.Send application permission with admin consent (Entra admin center → App registrations → the app → API permissions); if the app is limited to one mailbox, MAIL_FROM must be that mailbox`);
        throw fail('http_403');
      }
      if (status === 404) {
        hint(
          'send_404',
          code === 'MailboxNotEnabledForRESTAPI'
            ? `Microsoft 365 refused (${named}): the MAIL_FROM user has no Exchange Online mailbox (give it a license, or use a shared mailbox)`
            : `Microsoft 365 refused (${named}): mailbox not found: MAIL_FROM must be a mailbox (a user or a shared mailbox) in this Microsoft 365 organization`,
        );
        throw fail('http_404');
      }
      if (status === 413 || (status === 400 && MS_PERMANENT_400.has(code))) {
        hint(`send_${status}`, `Microsoft 365 refused this email (${named}); it will not be sent again`);
        throw fail(`http_${status}`, { permanent: true });
      }
      if (status === 400) {
        // any other 400 may be about the setup or this app, not this one message: the slow backoff
        hint(`send_400_${code}`, `Microsoft 365 refused (${named}); trying again later`);
        throw fail('http_400');
      }
      hint(`send_${status}`, `Microsoft 365 answered ${named}`);
      throw fail(`http_${status}`);
    }
  };
}

function devLog(log) {
  return async (m) => {
    let what = '';
    if (m.template === 'signin') what = `: code ${m.data.code}, link ${m.data.link}`;
    else if (m.template === 'check') what = `: code ${m.data.code}`;
    log(`[mail] ${maskEmail(m.to)} ${m.template}${what}`);
  };
}

function memory(captured) {
  return async (m) => {
    captured.push({ template: m.template, to: m.to, subject: m.subject, text: m.text, html: m.html, at: m.now });
    if (captured.length > 2000) captured.splice(0, captured.length - 2000);
  };
}

/**
 * The transport for cfg.mailMode. `now` and `sleep` are for tests (the Microsoft token's life and
 * a short Retry-After wait use the real clock, not the app clock).
 */
export function makeTransport(cfg, { captured = [], log = () => {}, now = () => Date.now(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)), timeoutMs = MS_TIMEOUT_MS } = {}) {
  switch (cfg.mailMode) {
    case 'resend':
      return resend(cfg);
    case 'postmark':
      return postmark(cfg);
    case 'microsoft':
      return microsoft(cfg, { log, now, sleep, timeoutMs });
    case 'log':
      return devLog(log);
    case 'memory':
      return memory(captured);
    default:
      return async () => {
        const e = new Error('no mail transport');
        e.name = 'NoMailTransport';
        throw e;
      };
  }
}

// ---------------------------------------------------------------------------------------------

export function createMail(ctx) {
  const { cfg, clock, db } = ctx;
  const captured = [];
  let transport = makeTransport(cfg, { captured, log: (l) => ctx.log(l) });
  let kickTimer = null;

  const mail = {
    captured,
    /** jobs.mjs sets this when its timers run: an enqueue then sends within a moment. */
    autoKick: false,

    async enqueue(q, template, to, data = {}, { familyId = null, sendAfter = null } = {}) {
      if (!TEMPLATES.includes(template)) throw new Error('mail: unknown template');
      if (typeof to !== 'string' || !to.includes('@')) throw new Error('mail: bad address');
      const now = clock.now();
      const after = sendAfter === null || sendAfter === undefined ? now : Number(sendAfter instanceof Date ? sendAfter.getTime() : sendAfter);
      await q.query('insert into outbox (family_id, to_email, template, data, send_after, created_at) values ($1, $2, $3, $4, $5, $6)', [
        familyId,
        to,
        template,
        JSON.stringify(data || {}),
        new Date(after),
        new Date(now),
      ]);
      if (after <= now) mail.kick();
    },

    kick() {
      if (!mail.autoKick || kickTimer) return;
      kickTimer = setTimeout(() => {
        kickTimer = null;
        Promise.resolve(ctx.jobs?.run('outbox')).catch(() => {});
      }, 100);
      kickTimer.unref?.();
    },

    setTransport(fn) {
      transport = fn;
    },

    /** Send what is due (one row per transaction, `for update skip locked`). */
    async runOutbox({ now = clock.now(), limit = 20 } = {}) {
      const out = { sent: 0, failed: 0, stopped: 0 };
      for (let i = 0; i < limit; i++) {
        const r = await db.tx(async (q) => {
          const row = await q.one(
            'select * from outbox where sent_at is null and send_after <= $1 and tries < $2 order by send_after, id limit 1 for update skip locked',
            [new Date(now), MAIL_MAX_TRIES],
          );
          if (!row) return null;
          const data = row.data && typeof row.data === 'object' ? row.data : {};
          if (SECRET_TEMPLATES.includes(row.template) && new Date(row.created_at).getTime() < now - CODE_LIFE_MS) {
            await q.query("update outbox set tries = $2, last_error = 'expired', data = '{}'::jsonb where id = $1", [row.id, MAIL_MAX_TRIES]);
            return 'stopped';
          }
          let firstTime = false;
          if (row.template === 'signin') {
            const f = await q.one('select email_verified_at from families where email = $1', [row.to_email]);
            firstTime = !f || !f.email_verified_at;
          }
          let msg;
          try {
            msg = renderMail(row.template, { data, cfg, firstTime, notice: firstTime ? await loadNotice(cfg) : null });
            await transport({ id: row.id, to: row.to_email, from: cfg.mailFrom, replyTo: cfg.operator?.email || null, template: row.template, data, now, ...msg });
          } catch (err) {
            // err.permanent: the provider refused this very message (it would refuse it again);
            // err.retryAfterMs: the provider asked us to wait (honored up to an hour, never
            // sooner than the backoff)
            const tries = err && err.permanent ? MAIL_MAX_TRIES : row.tries + 1;
            const stop = tries >= MAIL_MAX_TRIES;
            const asked = Number.isFinite(err?.retryAfterMs) ? Math.min(Math.max(0, err.retryAfterMs), MAIL_RETRY_AFTER_CAP_MS) : 0;
            const wait = Math.max(MAIL_BACKOFF_MS[tries - 1] ?? 0, stop ? 0 : asked);
            await q.query(
              "update outbox set tries = $2, last_error = $3, send_after = $4, data = case when $5::boolean then '{}'::jsonb else data end where id = $1",
              [row.id, tries, errName(err), new Date(now + wait), stop],
            );
            return stop ? 'stopped' : 'failed';
          }
          await q.query("update outbox set sent_at = $2, data = '{}'::jsonb, last_error = null where id = $1", [row.id, new Date(now)]);
          if (row.template === 'consent_confirm' && row.family_id) {
            await ctx.audit(q, row.family_id, 'consent.confirm_sent', { v: Number.isInteger(data.v) ? data.v : undefined }, { actor: 'system' });
          }
          return 'sent';
        });
        if (!r) break;
        out[r]++;
      }
      if (out.failed || out.stopped) ctx.log(`mail: sent=${out.sent} failed=${out.failed} stopped=${out.stopped}`);
      return out;
    },
  };
  return mail;
}
