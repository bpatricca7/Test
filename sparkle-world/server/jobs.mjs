// Background jobs, inside the one server process (docs/ACCOUNTS.md §3.5, §6.6, §13.7).
// Each run takes pg_try_advisory_lock(hashtext('sparkle-world:job:<name>')) and skips its turn
// when another container holds it (Railway runs the old and the new deployment side by side
// for a moment), so no job ever runs twice at once. Times come from the app clock (§3.1); the
// timers themselves run on real time. Every run logs counts only.
//
//   const jobs = startJobs(ctx, { timers })   timers: false in in-process tests (run by hand)
//   await jobs.run(name) → the job's result, or { skipped: true } (another instance has it)
//   await jobs.stop()                          timers off, waits for a running job
//
// | job        | when                              | does                                               |
// | outbox     | every 15 s and after an enqueue   | sends due emails (mail.mjs)                        |
// | retention  | hourly                            | every row of §3.5; lapse, warnings, purge (§6.6);  |
// |            |                                   | retries pending Stripe customer deletions          |
// | reconcile  | 30 s after start, then every 6 h  | billing.reconcile() (§6.6)                         |
// | reminders  | daily at 03:17 UTC                | annual_reminder; inactive after 24 months unused   |
// | summary    | daily at 03:17 UTC                | the one log line of §13.5                          |

import { entitlementOf } from './entitlement.mjs';
import { MAIL_MAX_TRIES } from './mail.mjs';

const MIN = 60e3;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const YEAR = 365 * DAY;
export const JOB_NAMES = Object.freeze(['outbox', 'retention', 'reconcile', 'reminders', 'summary']);
export const jobLock = (name) => `sparkle-world:job:${name}`;

const ms = (v) => (v === null || v === undefined ? null : v instanceof Date ? v.getTime() : typeof v === 'number' ? v : Date.parse(v));
const errName = (err) => (err && (err.code || err.name)) || 'Error';

/** Whole calendar years (UTC) from `from` to `to`. */
export function fullYears(from, to) {
  const a = new Date(from);
  const b = new Date(to);
  let y = b.getUTCFullYear() - a.getUTCFullYear();
  const anniversary = Date.UTC(b.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate(), a.getUTCHours(), a.getUTCMinutes(), a.getUTCSeconds());
  if (anniversary > b.getTime()) y--;
  return Math.max(0, y);
}

async function setFlags(q, familyId, patch) {
  await q.query('update families set flags = flags || $2::jsonb where id = $1', [familyId, JSON.stringify(patch)]);
}

// ---------------------------------------------------------------------------------------------
// the jobs

async function outbox(ctx, { now }) {
  return ctx.mail.runOutbox({ now });
}

async function retention(ctx, { now }) {
  const { db, cfg } = ctx;
  const ago = (d) => new Date(now - d);
  const c = { families: 0, players: 0, sessions: 0, attempts: 0, pairCodes: 0, goneSessions: 0, tombstones: 0, stripeEvents: 0, outbox: 0, audit: 0, deletedFamilies: 0, lapsed: 0, resumed: 0, warned: 0, stripe: 0 };
  const del = async (k, sql, params) => {
    c[k] += (await db.query(sql, params)).rowCount;
  };

  // ---- rows that simply expire (§3.5) ----
  await del('attempts', 'delete from login_attempts where expires_at < $1', [ago(DAY)]);
  await del('pairCodes', 'delete from pair_codes where expires_at < $1', [ago(DAY)]);
  await del('sessions', 'delete from sessions where (revoked_at is not null and revoked_at < $1) or expires_at < $1 or idle_expires_at < $1', [ago(7 * DAY)]);
  await del('goneSessions', 'delete from gone_sessions where gone_at < $1', [ago(180 * DAY)]);
  await del('tombstones', 'delete from worlds where body is null and deleted_at < $1', [ago(30 * DAY)]);
  await del('stripeEvents', 'delete from stripe_events where received_at < $1', [ago(30 * DAY)]);
  await del('outbox', 'delete from outbox where (sent_at is not null and sent_at < $1) or (sent_at is null and tries >= $3 and created_at < $2)', [ago(7 * DAY), ago(30 * DAY), MAIL_MAX_TRIES]);
  await del('audit', 'delete from audit_log where at < $1', [ago(3 * YEAR)]);
  await del('deletedFamilies', 'delete from deleted_families where deleted_at < $1', [ago(35 * DAY)]);

  // ---- families that never finished setting up ----
  const unfinished = await db.query(
    `select f.id from families f
      where (f.consent_at is null and f.created_at < $1)
         or (f.consent_at is not null and f.consent_at < $2 and f.comp_until is null and f.lapsed_at is null
             and not exists (select 1 from players p where p.family_id = f.id)
             and not exists (select 1 from subscriptions s where s.family_id = f.id and s.status not in ('incomplete', 'incomplete_expired')))`,
    [ago(14 * DAY), ago(30 * DAY)],
  );
  for (const { id } of unfinished.rows) {
    if ((await ctx.family.deleteFamily(id, { actor: 'system', notify: false, now })).ok) c.families++;
  }

  // ---- the plan ended: lapse, warnings, purge (§6.6) ----
  const fams = await db.query(
    `select f.* from families f
      where f.lapsed_at is not null or f.comp_until is not null or exists (select 1 from subscriptions s where s.family_id = f.id)`,
  );
  for (const f of fams.rows) {
    const subs = (await db.query('select * from subscriptions where family_id = $1', [f.id])).rows;
    const ent = entitlementOf({ family: f, subs, now, cfg });
    if (ent.entitled) {
      if (f.lapsed_at) {
        await db.tx(async (q) => {
          // kid_data_purged_at belongs to the lapse that ended: the next lapse purges again
          await q.query("update families set lapsed_at = null, purge_after = null, kid_data_purged_at = null, flags = flags - 'warned30' - 'warned7' where id = $1", [f.id]);
          await ctx.audit(q, f.id, 'plan.resumed', {}, { actor: 'system' });
        });
        ctx.billing.invalidate(f.id);
        ctx.events.emit('family', { familyId: f.id });
        c.resumed++;
      }
      continue;
    }
    let lapsedAt = ms(f.lapsed_at);
    let purgeAfter = ms(f.purge_after);
    if (lapsedAt === null) {
      if (ent.state !== 'lapsed') continue; // never had a plan: nothing to lapse
      lapsedAt = now;
      purgeAfter = now + cfg.retainDays * DAY;
      await db.tx(async (q) => {
        // a new lapse (a second one after a comeback too): warned and purged again, 90 days on
        await q.query("update families set lapsed_at = $2, purge_after = $3, kid_data_purged_at = null, flags = flags - 'warned30' - 'warned7' where id = $1", [f.id, new Date(lapsedAt), new Date(purgeAfter)]);
        await ctx.audit(q, f.id, 'plan.lapsed', {}, { actor: 'system' });
      });
      ctx.billing.invalidate(f.id);
      ctx.events.emit('family', { familyId: f.id }); // live games learn it now, not at the next sweep
      f.flags = { ...(f.flags || {}), warned30: undefined, warned7: undefined };
      f.kid_data_purged_at = null;
      c.lapsed++;
    }
    if (now >= lapsedAt + YEAR) {
      // the family row itself goes 12 months after the plan ended, with its Stripe customer
      if ((await ctx.family.deleteFamily(f.id, { actor: 'system', notify: false, now })).ok) c.families++;
      continue;
    }
    if (f.kid_data_purged_at || purgeAfter === null) continue;
    if (now >= purgeAfter) {
      const n = await db.tx(async (q) => {
        const r = await q.query('delete from players where family_id = $1', [f.id]);
        await q.query('update families set kid_data_purged_at = $2 where id = $1', [f.id, new Date(now)]);
        await ctx.audit(q, f.id, 'retention.purge', { players: r.rowCount }, { actor: 'system' });
        return r.rowCount;
      });
      c.players += n;
      ctx.events.emit('family', { familyId: f.id });
      continue;
    }
    const flags = f.flags || {};
    const warn = now >= purgeAfter - 7 * DAY ? (flags.warned7 ? null : { warned7: true, warned30: true }) : now >= purgeAfter - 30 * DAY && !flags.warned30 ? { warned30: true } : null;
    if (warn) {
      await db.tx(async (q) => {
        await ctx.mail.enqueue(q, 'lapse_warning', f.email, { lapsedAt, purgeAfter }, { familyId: f.id });
        await setFlags(q, f.id, warn);
      });
      c.warned++;
    }
  }

  // ---- Stripe customers of deleted families that could not be deleted at the time ----
  const pending = await db.query('select family_id, stripe_customer_id from deleted_families where stripe_customer_id is not null and stripe_done_at is null');
  for (const r of pending.rows) {
    try {
      const res = await ctx.billing.cancelAndDelete({ familyId: r.family_id, customerId: r.stripe_customer_id });
      if (res === false || (res && res.ok === false)) continue;
      await db.query('update deleted_families set stripe_done_at = $2, stripe_customer_id = null where family_id = $1', [r.family_id, new Date(now)]);
      c.stripe++;
    } catch (err) {
      ctx.log(`retention: stripe cleanup still failing ${errName(err)}`);
    }
  }

  const deleted = ['families', 'players', 'sessions', 'attempts', 'pairCodes', 'goneSessions', 'tombstones', 'stripeEvents', 'outbox', 'audit', 'deletedFamilies'].map((k) => `${k}=${c[k]}`).join(' ');
  ctx.log(`retention: deleted ${deleted}; lapsed=${c.lapsed} resumed=${c.resumed} warned=${c.warned} stripe=${c.stripe}`);
  return c;
}

async function reconcile(ctx, { now }) {
  if (typeof ctx.billing?.reconcile !== 'function') return { skipped: true };
  return (await ctx.billing.reconcile({ now })) ?? { ok: true };
}

async function reminders(ctx, { now }) {
  const { db } = ctx;
  const c = { annual: 0, inactive: 0 };
  const rows = await db.query(
    `select f.*, (select min(s.started_at) from subscriptions s where s.family_id = f.id and s.status in ('trialing', 'active', 'past_due')) as sub_started
       from families f
      where exists (select 1 from subscriptions s where s.family_id = f.id and s.status in ('trialing', 'active', 'past_due'))`,
  );
  for (const f of rows.rows) {
    const flags = f.flags || {};
    const started = ms(f.sub_started);
    if (started !== null) {
      const years = fullYears(started, now);
      if (years >= 1 && !((flags.annual ?? 0) >= years)) {
        await db.tx(async (q) => {
          await ctx.mail.enqueue(q, 'annual_reminder', f.email, {}, { familyId: f.id });
          await setFlags(q, f.id, { annual: years });
        });
        c.annual++;
      }
    }
    const lastUse = ms(f.last_seen_at) ?? ms(f.created_at);
    if (lastUse !== null && now - lastUse >= 730 * DAY && !(Number(flags.inactiveSent) >= lastUse)) {
      await db.tx(async (q) => {
        await ctx.mail.enqueue(q, 'inactive', f.email, {}, { familyId: f.id });
        await setFlags(q, f.id, { inactiveSent: now });
      });
      c.inactive++;
    }
  }
  if (c.annual || c.inactive) ctx.log(`reminders: annual=${c.annual} inactive=${c.inactive}`);
  return c;
}

/** The one daily line of §13.5 (counts only). */
async function summary(ctx, { now }) {
  const { db, cfg } = ctx;
  const fams = (await db.query('select * from families')).rows;
  const subs = (await db.query('select * from subscriptions')).rows;
  const byFamily = new Map();
  for (const s of subs) {
    if (!byFamily.has(s.family_id)) byFamily.set(s.family_id, []);
    byFamily.get(s.family_id).push(s);
  }
  const n = { families: fams.length, entitled: 0, trialing: 0, past_due: 0, lapsed: 0, disputes: 0, refund_due: 0 };
  for (const f of fams) {
    const e = entitlementOf({ family: f, subs: byFamily.get(f.id) || [], now, cfg });
    if (e.entitled) n.entitled++;
    if (e.state === 'trialing') n.trialing++;
    if (e.state === 'past_due') n.past_due++;
    if (e.state === 'lapsed') n.lapsed++;
    if (f.flags?.dispute === true) n.disputes++;
    if (f.flags?.refund_due === true) n.refund_due++;
  }
  const hooks = await db.one(
    'select count(*) filter (where processed_at is not null) as ok, count(*) filter (where processed_at is null) as failed from stripe_events where received_at > $1',
    [new Date(now - DAY)],
  );
  const mails = await db.one(
    'select count(*) filter (where sent_at > $1) as sent, count(*) filter (where sent_at is null and tries >= $2) as failed from outbox',
    [new Date(now - DAY), MAIL_MAX_TRIES],
  );
  const line = `accounts: families=${n.families} entitled=${n.entitled} trialing=${n.trialing} past_due=${n.past_due} lapsed=${n.lapsed} ` +
    `webhooks ok=${hooks.ok} failed=${hooks.failed} mails sent=${mails.sent} failed=${mails.failed} disputes=${n.disputes} refund_due=${n.refund_due}`;
  ctx.log(line);
  return { line, ...n, webhooksOk: hooks.ok, webhooksFailed: hooks.failed, mailsSent: mails.sent, mailsFailed: mails.failed };
}

const IMPL = { outbox, retention, reconcile, reminders, summary };

// ---------------------------------------------------------------------------------------------

/** ms until the next hh:mm UTC (real time). */
export function msUntilUtc(hh, mm, from = Date.now()) {
  const d = new Date(from);
  let next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hh, mm);
  if (next <= from) next += DAY;
  return next - from;
}

export function startJobs(ctx, { timers = true } = {}) {
  const running = new Map(); // name → promise of the run in this process
  const handles = [];
  let stopped = false;

  async function run(name, opts = {}) {
    if (!IMPL[name]) throw new Error('jobs: unknown job');
    if (stopped) return { skipped: true }; // shutting down: the database is going away
    while (running.has(name)) await running.get(name).catch(() => {});
    const p = (async () => {
      const r = await ctx.db.tryLock(jobLock(name), () => IMPL[name](ctx, { now: ctx.clock.now(), ...opts }));
      return r.ok ? r.value : { skipped: true };
    })();
    running.set(name, p);
    try {
      return await p;
    } finally {
      if (running.get(name) === p) running.delete(name);
    }
  }

  const safeRun = (name) => {
    if (stopped) return;
    run(name).catch((err) => ctx.log(`jobs: ${name} failed ${errName(err)}`));
  };
  const every = (msEvery, name, firstMs = msEvery) => {
    const t = setTimeout(function tick() {
      safeRun(name);
      const again = setInterval(() => safeRun(name), msEvery);
      again.unref?.();
      handles.push(again);
    }, firstMs);
    t.unref?.();
    handles.push(t);
  };

  if (timers) {
    ctx.mail.autoKick = true;
    every(15e3, 'outbox', 2e3);
    every(HOUR, 'retention', 5 * MIN);
    every(6 * HOUR, 'reconcile', 30e3);
    const daily = msUntilUtc(3, 17);
    every(DAY, 'summary', daily);
    every(DAY, 'reminders', daily + 60e3);
  }

  return {
    run,
    names: JOB_NAMES,
    async stop() {
      stopped = true;
      if (ctx.mail) ctx.mail.autoKick = false;
      for (const h of handles) {
        clearTimeout(h);
        clearInterval(h);
      }
      await Promise.allSettled([...running.values()]);
    },
  };
}
