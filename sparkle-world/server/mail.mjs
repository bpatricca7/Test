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
// Transports (MAIL_MODE): `resend`, `postmark` (production: Node's fetch, no SDK), `log`
// (development: one line with the masked address, and the code and link of sign-in emails),
// `memory` (tests). Failures back off 1 min, 5 min, 30 min, 2 h, 6 h, 12 h, 24 h, then stop.
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

export function makeTransport(cfg, { captured = [], log = () => {} } = {}) {
  switch (cfg.mailMode) {
    case 'resend':
      return resend(cfg);
    case 'postmark':
      return postmark(cfg);
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
            const tries = row.tries + 1;
            const stop = tries >= MAIL_MAX_TRIES;
            await q.query(
              "update outbox set tries = $2, last_error = $3, send_after = $4, data = case when $5::boolean then '{}'::jsonb else data end where id = $1",
              [row.id, tries, errName(err), new Date(now + (MAIL_BACKOFF_MS[tries - 1] ?? 0)), stop],
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
