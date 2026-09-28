// The admin CLI (docs/ACCOUNTS.md §13.8): `npm run -s admin -- <command>` on the server
// (railway ssh), with the server's own Variables. It talks to the database directly, writes
// audit_log rows with actor `admin`, and prints counts and ids: never children's content.
// (-s keeps npm's banner out of `export`'s output.)
//
//   show <email>                                    plan, consent, flags, player/device counts, last seen
//   comp <email> <YYYY-MM-DD|off>                   a free pass until the end of that day (UTC), or none
//   consent-verified <email> --method form|call|video   tier-2 consent obtained another listed way (§11.4)
//   change-email <old> <new>                        after confirming the request from the old address;
//                                                   every session and pair code of the family ends
//   export <email> > file.json                      the family export: it PRINTS CHILDREN'S CONTENT
//                                                   (nicknames, portraits, worlds). Never email it:
//                                                   a parent downloads it herself on the Family page
//   delete <email>                                  the family delete of §3.4 (type the email again)
//   sign-out-all [<email>]                          every session of a family, or of everyone (type
//                                                   EVERYONE to confirm)
//   reapply-deletions --since <ISO time> [--ids <file>] [--dry-run]
//                                                   after a restore (§13.4): the families, players and
//                                                   worlds deleted since then, from Stripe's
//                                                   customer.deleted events that our own deletes
//                                                   marked and the `deletion-journal` log lines;
//                                                   lists them and asks to type how many
//   purge-now                                       run the retention job now
//   stats                                           print the daily summary line
//
// The running server caches sessions and entitlement for up to 60 s, so changes made here
// reach it within a minute.

import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { normalizeEmail } from './auth.mjs';
import { entitlementOf } from './entitlement.mjs';
import { isUuid } from './http.mjs';

export const USAGE = `usage: npm run -s admin -- <command>
  show <email>
  comp <email> <YYYY-MM-DD|off>
  consent-verified <email> --method form|call|video
  change-email <old> <new>
  export <email> > file.json      (prints children's content: never email the file)
  delete <email>
  sign-out-all [<email>]           (no email: everyone, after typing EVERYONE)
  reapply-deletions --since <ISO time> [--ids <file>] [--dry-run]
  purge-now
  stats`;

const DAY = 24 * 3600e3;
const ms = (v) => (v === null || v === undefined ? null : v instanceof Date ? v.getTime() : typeof v === 'number' ? v : Date.parse(v));
const day = (v) => (ms(v) === null || !Number.isFinite(ms(v)) ? '-' : new Date(ms(v)).toISOString().slice(0, 10));
const when = (v) => (ms(v) === null || !Number.isFinite(ms(v)) ? '-' : new Date(ms(v)).toISOString().slice(0, 16).replace('T', ' ') + ' UTC');

async function askLine(prompt) {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    return await new Promise((resolve) => rl.question(prompt, resolve));
  } finally {
    rl.close();
  }
}

function option(args, name) {
  const i = args.indexOf(name);
  if (i < 0) return null;
  const v = args[i + 1];
  args.splice(i, 2);
  return v ?? '';
}

/**
 * Run one admin command. Returns the exit code (0 done, 1 refused or failed, 2 usage).
 * @param {string[]} argv   e.g. ['comp', 'a@b.co', '2026-12-31']
 * @param {{ ctx, out?, write?, confirm?, readFile? }} o  ctx: createAccounts(...).ctx
 */
export async function runAdmin(argv, { ctx, out = (s) => process.stdout.write(s + '\n'), write = (c) => process.stdout.write(c), confirm = askLine, readFile = (f) => readFileSync(f, 'utf8') } = {}) {
  const { db, cfg, clock } = ctx;
  const args = [...argv];
  const cmd = args.shift();
  const usage = () => {
    out(USAGE);
    return 2;
  };
  const byEmail = async (raw) => {
    const email = normalizeEmail(raw);
    if (!email) return null;
    return db.one('select * from families where email = $1', [email]);
  };
  const needFamily = async (raw) => {
    const f = await byEmail(raw);
    if (!f) out('no family with that email');
    return f;
  };
  const changed = (f) => {
    ctx.billing?.invalidate?.(f.id);
    ctx.events?.emit('family', { familyId: f.id });
  };
  const now = clock.now();

  switch (cmd) {
    case 'show': {
      if (args.length !== 1) return usage();
      const f = await needFamily(args[0]);
      if (!f) return 1;
      const subs = (await db.query('select * from subscriptions where family_id = $1 order by synced_at desc', [f.id])).rows;
      const e = entitlementOf({ family: f, subs, now, cfg });
      const p = await db.one('select count(*) as n, count(*) filter (where friends_on) as friends, count(*) filter (where walkie_on) as walkie from players where family_id = $1', [f.id]);
      const s = await db.one(
        `select count(*) filter (where kind = 'parent') as parent, count(*) filter (where kind = 'device') as device from sessions
          where family_id = $1 and revoked_at is null and expires_at > $2 and idle_expires_at > $2`,
        [f.id, new Date(now)],
      );
      const codes = await db.one('select count(*) as n from pair_codes where family_id = $1 and used_at is null and expires_at > $2', [f.id, new Date(now)]);
      const flags = Object.entries(f.flags || {}).map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' ') || '-';
      out(`family ${f.id}`);
      out(`  created ${day(f.created_at)}  email verified ${day(f.email_verified_at)}  last seen ${day(f.last_seen_at)}`);
      out(`  plan: ${e.state}, entitled ${e.entitled ? 'yes' : 'no'}, until ${when(e.until)}` + (e.trialEnd ? `, trial end ${when(e.trialEnd)}` : '') + (e.periodEnd ? `, period end ${when(e.periodEnd)}` : '') + (e.graceUntil ? `, grace until ${when(e.graceUntil)}` : '') + (e.cancelAtPeriodEnd ? ', cancels at period end' : ''));
      for (const x of subs) out(`  subscription ${x.id}: ${x.status}, period end ${when(x.current_period_end)}${x.cancel_at_period_end ? ', cancel at period end' : ''}, synced ${when(x.synced_at)}`);
      out(`  stripe customer ${f.stripe_customer_id || '-'}  country ${f.country || '-'}  trial used ${f.trial_used ? 'yes' : 'no'}`);
      out(`  consent: ${e.consent}, notice v${f.notice_version ?? '-'} agreed ${day(f.consent_at)}, verified ${day(f.verified_at)}${f.verified_method ? ` (${f.verified_method})` : ''}`);
      out(`  free pass until ${day(f.comp_until)}  lapsed ${day(f.lapsed_at)}  purge after ${day(f.purge_after)}  kid data purged ${day(f.kid_data_purged_at)}`);
      out(`  players ${p.n} (friends on ${p.friends}, walkie on ${p.walkie})  sessions: parent ${s.parent}, device ${s.device}  live pair codes ${codes.n}`);
      out(`  flags ${flags}`);
      return 0;
    }

    case 'comp': {
      if (args.length !== 2) return usage();
      const f = await needFamily(args[0]);
      if (!f) return 1;
      let until = null;
      let label = null;
      if (args[1] !== 'off') {
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(args[1]);
        const t = m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : NaN;
        if (!m || !Number.isFinite(t) || new Date(t).toISOString().slice(0, 10) !== args[1]) return usage();
        until = t + DAY; // through the end of that day (UTC)
        label = args[1];
      }
      await db.tx(async (q) => {
        await q.query('update families set comp_until = $2 where id = $1', [f.id, until === null ? null : new Date(until)]);
        await ctx.audit(q, f.id, 'comp.set', { until: label }, { actor: 'admin' });
      });
      changed(f);
      out(until === null ? `free pass removed for family ${f.id}` : `free pass for family ${f.id} through ${label} (UTC)`);
      if (until !== null) {
        const live = await db.query("select id, cancel_at_period_end from subscriptions where family_id = $1 and status in ('trialing', 'active', 'past_due')", [f.id]);
        for (const x of live.rows) {
          if (!x.cancel_at_period_end) out(`warning: subscription ${x.id} still renews and is still charged. If the pass replaces it, cancel it (the parent's Family page: Cancel the plan, or the Stripe Dashboard).`);
        }
      }
      return 0;
    }

    case 'consent-verified': {
      const method = option(args, '--method');
      if (args.length !== 1 || !['form', 'call', 'video'].includes(method)) return usage();
      const f = await needFamily(args[0]);
      if (!f) return 1;
      await db.tx(async (q) => {
        await q.query('update families set verified_at = $2, verified_method = $3 where id = $1', [f.id, new Date(now), method]);
        await ctx.audit(q, f.id, 'consent.verified', { method }, { actor: 'admin' });
      });
      changed(f);
      out(`verified consent (${method}) recorded for family ${f.id}` + (f.consent_at ? '' : ' (note: the parent has not agreed to the notice on the Family page yet)'));
      return 0;
    }

    case 'change-email': {
      if (args.length !== 2) return usage();
      const next = normalizeEmail(args[1]);
      if (!next) {
        out('the new email does not look like an email address');
        return 1;
      }
      const f = await needFamily(args[0]);
      if (!f) return 1;
      if (await db.one('select 1 as x from families where email = $1', [next])) {
        out('another family already signs in with the new email');
        return 1;
      }
      // an email change often follows a lost or taken-over mailbox: every session and live pair
      // code of the family ends with it (devices are set up again from the new address)
      const revoked = await db.tx(async (q) => {
        await q.query('update families set email = $2 where id = $1', [f.id, next]);
        await q.query('delete from login_attempts where email = $1 or family_id = $2', [f.email, f.id]);
        const r = await q.query('update sessions set revoked_at = $2 where family_id = $1 and revoked_at is null returning id_hash', [f.id, new Date(now)]);
        await q.query('delete from pair_codes where family_id = $1', [f.id]);
        await ctx.audit(q, f.id, 'email.changed', {}, { actor: 'admin' });
        return r.rows.map((x) => x.id_hash);
      });
      ctx.sessions?.announce?.(revoked);
      changed(f);
      out(`email changed for family ${f.id}; ${revoked.length} session${revoked.length === 1 ? '' : 's'} signed out and its pair codes ended. Change the customer's email in the Stripe Dashboard too, so receipts go to the same address.`);
      return 0;
    }

    case 'export': {
      if (args.length !== 1) return usage();
      const f = await needFamily(args[0]);
      if (!f) return 1;
      await ctx.audit(db, f.id, 'export.family', {}, { actor: 'admin' });
      for await (const chunk of ctx.family.exportFamily(f.id)) write(chunk);
      write('\n');
      return 0;
    }

    case 'delete': {
      if (args.length !== 1) return usage();
      const f = await needFamily(args[0]);
      if (!f) return 1;
      const typed = await confirm(`Type the email again to delete family ${f.id} and everything in it: `);
      if (normalizeEmail(typed || '') !== f.email) {
        out('not deleted: the email did not match');
        return 1;
      }
      const r = await ctx.family.deleteFamily(f.id, { actor: 'admin', notify: true, now });
      out(`deleted family ${f.id}` + (r.stripeDone ? '' : ' (the Stripe customer is deleted later by the retention job)'));
      return 0;
    }

    case 'sign-out-all': {
      if (args.length > 1) return usage();
      let familyId = null;
      if (args.length === 1) {
        const f = await needFamily(args[0]);
        if (!f) return 1;
        familyId = f.id;
      } else {
        // everyone: every kid device of every family has to be set up again afterwards
        const typed = await confirm('No email given: this signs out EVERY family and every kid device. Type EVERYONE to go on: ');
        if (String(typed || '').trim() !== 'EVERYONE') {
          out('nobody was signed out');
          return 1;
        }
      }
      const n = await ctx.sessions.revokeFamily(familyId, { now });
      out(`signed out ${n} session${n === 1 ? '' : 's'}` + (familyId ? ` of family ${familyId}` : ' (everyone)') + '; the running server notices within a minute');
      return 0;
    }

    case 'reapply-deletions': {
      const since = option(args, '--since');
      const idsFile = option(args, '--ids');
      const dry = args.includes('--dry-run');
      if (dry) args.splice(args.indexOf('--dry-run'), 1);
      const t = since ? Date.parse(since) : NaN;
      if (args.length || !Number.isFinite(t)) return usage();
      const fams = new Set();
      const players = new Set();
      const worlds = new Map(); // `${pid}/${wid}` → [pid, wid]
      if (ctx.stripe?.events?.list) {
        const list = ctx.stripe.events.list({ type: 'customer.deleted', created: { gte: Math.floor(t / 1000) }, limit: 100 });
        const each = list && typeof list[Symbol.asyncIterator] === 'function' ? list : ((await list)?.data || []);
        for await (const ev of each) {
          const obj = ev?.data?.object || {};
          const fid = obj.metadata?.family_id;
          if (!isUuid(fid)) continue;
          // only customers our own family delete marked (billing.cancelAndDelete): one deleted
          // by hand in the Dashboard only unlinked its family (§6.4), which must stay
          if (obj.metadata?.sw_family_deleted === '1') fams.add(fid.toLowerCase());
          else out(`not reapplied (deleted by hand in Stripe, check it): event ${ev.id} customer ${obj.id || '-'} family ${fid.toLowerCase()}`);
        }
      } else {
        out('stripe: no client here, so Stripe customer.deleted events were not read');
      }
      if (idsFile !== null) {
        const text = readFile(idsFile);
        const U = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
        for (const m of text.matchAll(new RegExp(`family=(${U})`, 'gi'))) fams.add(m[1].toLowerCase());
        for (const m of text.matchAll(new RegExp(`player=(${U})`, 'gi'))) players.add(m[1].toLowerCase());
        for (const m of text.matchAll(new RegExp(`world=(${U})/([A-Za-z0-9_.~-]{1,72})`, 'gi'))) worlds.set(`${m[1].toLowerCase()}/${m[2]}`, [m[1].toLowerCase(), m[2]]);
        for (const line of text.split(/\r?\n/)) if (isUuid(line.trim())) fams.add(line.trim().toLowerCase());
      }
      const total = fams.size + players.size + worlds.size;
      for (const id of fams) out(`family ${id}`);
      for (const id of players) out(`player ${id}`);
      for (const k of worlds.keys()) out(`world ${k}`);
      out(`${fams.size} famil${fams.size === 1 ? 'y' : 'ies'}, ${players.size} player${players.size === 1 ? '' : 's'}, ${worlds.size} world${worlds.size === 1 ? '' : 's'} to delete again`);
      if (dry || !total) return 0;
      const typed = await confirm(`Type ${total} to delete these ${total} again: `);
      if (String(typed || '').trim() !== String(total)) {
        out('nothing deleted: the number did not match');
        return 1;
      }
      let nf = 0;
      let np = 0;
      let nw = 0;
      for (const id of fams) {
        const r = await ctx.family.deleteFamily(id, { actor: 'admin', notify: false, now });
        if (r.ok) nf++;
      }
      for (const pid of players) {
        const p = await db.one('select family_id from players where id = $1', [pid]);
        if (p && (await ctx.family.deletePlayer(p.family_id, pid, { actor: 'admin', now }))) np++;
      }
      for (const [pid, wid] of worlds.values()) {
        // the same tombstone as a delete in the game (saves.mjs): other devices learn it too
        const r = await db.query(
          `update worlds set rev = rev + 1, client_updated_at = $3, meta = '{}'::jsonb, thumb = null, body = null, size = 0, stored = 0, deleted_at = $4, updated_at = $4
            where player_id = $1 and world_id = $2 and body is not null`,
          [pid, wid, now, new Date(now)],
        );
        nw += r.rowCount;
      }
      if (nf || np) ctx.billing?.invalidate?.();
      out(`reapplied deletions: ${nf} famil${nf === 1 ? 'y' : 'ies'}, ${np} player${np === 1 ? '' : 's'} and ${nw} world${nw === 1 ? '' : 's'} deleted again; the rest were already gone`);
      return 0;
    }

    case 'purge-now': {
      if (args.length) return usage();
      const r = await ctx.jobs.run('retention');
      if (r.skipped) {
        out('the retention job is running elsewhere right now; try again in a minute');
        return 1;
      }
      out('retention: ' + Object.entries(r).map(([k, v]) => `${k}=${v}`).join(' '));
      return 0;
    }

    case 'stats': {
      if (args.length) return usage();
      const r = await ctx.jobs.run('summary');
      if (r.skipped) {
        out('the summary job is running elsewhere right now; try again in a minute');
        return 1;
      }
      out(r.line);
      return 0;
    }

    default:
      return usage();
  }
}

// ---- run as a program ----
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const { loadConfig } = await import('./config.mjs');
  let cfg;
  try {
    cfg = loadConfig(process.env);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
  if (cfg.accounts === 'off') {
    console.error('admin: SW_ACCOUNTS is off here; run it with the same Variables as the server');
    process.exit(1);
  }
  const { createAccounts } = await import('./accounts.mjs');
  let accounts;
  try {
    accounts = await createAccounts(cfg, { log: (...a) => console.error(...a), timers: false });
  } catch (err) {
    console.error(`admin: could not open the database (${err && err.code ? err.code : err && err.name ? err.name : 'Error'})`);
    process.exit(1);
  }
  let code = 1;
  try {
    code = await runAdmin(process.argv.slice(2), { ctx: accounts.ctx });
  } catch (err) {
    console.error(`admin: failed (${err && err.code ? err.code : err && err.name ? err.name : 'Error'})`);
  } finally {
    await accounts.close();
  }
  process.exit(code);
}
