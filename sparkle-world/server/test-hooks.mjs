// /api/test/* (docs/ACCOUNTS.md §5.2, §12.5): only with SW_TEST=1, which config.mjs refuses in
// production and with a live Stripe key; the router does not even mount these routes
// otherwise. They are the tests' and the e2e's handles on a server running as its own process:
//
//   GET  /api/test/mail?to=<email>   → the captured emails [{ template, to, subject, text, at }]
//                                      (MAIL_MODE=memory; the outbox is run first, so a code
//                                      asked for a moment ago is there)
//   POST /api/test/clock {offsetMs}  → the app clock = real time + offsetMs ({advanceMs} adds);
//                                      caches that run on real time are dropped
//   POST /api/test/jobs {name}       → runs a job now (outbox, retention, reconcile, reminders, summary)
//   POST /api/test/reset             → empties every table, the caches, the captured mail, the limits
//   POST /api/test/limits {off}      → rate limits off ({off:true}) or fresh and on ({off:false})

import { httpError } from './http.mjs';
import { Limits } from './limits.mjs';
import { JOB_NAMES } from './jobs.mjs';

function dropCaches(ctx) {
  ctx.billing?.invalidate?.();
  ctx.sessions?.clearCaches?.();
}

export function routes(ctx) {
  async function mail(req, x) {
    await ctx.jobs?.run('outbox');
    const to = typeof x.query.to === 'string' && x.query.to ? x.query.to.trim().normalize('NFC').toLowerCase() : null;
    const list = (ctx.mail.captured || []).filter((m) => !to || m.to === to);
    return { json: list.map((m) => ({ template: m.template, to: m.to, subject: m.subject, text: m.text, at: m.at })) };
  }

  async function clock(req, x) {
    const { offsetMs, advanceMs } = x.body;
    if (Number.isFinite(offsetMs)) ctx.clock.set(offsetMs);
    else if (Number.isFinite(advanceMs)) ctx.clock.set(ctx.clock.offsetMs + advanceMs);
    else throw httpError(400, 'bad_request');
    dropCaches(ctx);
    return { json: { offsetMs: ctx.clock.offsetMs, now: ctx.clock.now() } };
  }

  async function jobs(req, x) {
    const name = x.body.name;
    if (!JOB_NAMES.includes(name) || !ctx.jobs) throw httpError(400, 'bad_request');
    const result = await ctx.jobs.run(name);
    return { json: { ok: true, result } };
  }

  async function reset() {
    const r = await ctx.db.query("select tablename from pg_tables where schemaname = 'public' and tablename <> 'schema_migrations'");
    if (r.rows.length) await ctx.db.exec(`truncate ${r.rows.map((t) => `"${t.tablename}"`).join(', ')} restart identity cascade`);
    dropCaches(ctx);
    if (ctx.mail?.captured) ctx.mail.captured.length = 0;
    if (ctx.limits) ctx.limits = new Limits();
    return { json: { ok: true } };
  }

  async function limits(req, x) {
    ctx.limits = x.body.off === true ? null : new Limits();
    return { json: { limits: ctx.limits ? 'on' : 'off' } };
  }

  return [
    { method: 'GET', path: '/api/test/mail', who: 'test', handler: mail },
    { method: 'POST', path: '/api/test/clock', who: 'test', handler: clock },
    { method: 'POST', path: '/api/test/jobs', who: 'test', handler: jobs },
    { method: 'POST', path: '/api/test/reset', who: 'test', handler: reset },
    { method: 'POST', path: '/api/test/limits', who: 'test', handler: limits },
  ];
}
