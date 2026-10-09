// Free passes from the SW_FREE_PASS Variable (docs/ACCOUNTS.md §6.9): the operator's own family
// uses the Glimmer World Membership without paying, set up from Railway's Variables alone (no admin shell).
//
//   const fp = createFreePass(ctx)
//   fp.listed(email)               → { email, day, until } | null
//   await fp.applyIn(q, familyId)  → { pass, consent, listed }: inside the caller's transaction, brings
//                                    one family in line with the list (row locked first)
//   await fp.sync()                → { set, ended, consent }: every family the list concerns
//                                    (at start; changing a Variable always restarts the server)
//
// The rules (each change is one audit row with actor `config`, like the admin's `comp`):
//   - a listed address gets comp_until = the end of its day (UTC) and comp_source = 'config':
//     at start for a family that exists, and when the family is created or signs in;
//   - a pass the admin command set (comp_source null) that is still running is never touched;
//     an admin pass that has ended no longer does anything, so the list may set a new one;
//   - a pass set by the list whose address is no longer listed ends at the next start
//     (comp_until = now: the plan ended, and the usual lapse and retention rules of §6.6 apply);
//   - verified consent, method 'operator': only for a listed address, only after the parent
//     agreed to the current notice in the normal flow (POST /api/consent), and only when no
//     verified consent is recorded yet. Like a card's, it stays once recorded.
// Nothing here logs an address: counts only.

import { loadNotice } from './mail-templates.mjs';

// family.mjs's noticeStale (an agreement to a notice older than its minimum version)
const noticeStale = (f, n) => !!f && !!f.consent_at && (f.notice_version ?? 0) < (n.minVersion ?? n.version);
const ms = (v) => (v === null || v === undefined ? null : v instanceof Date ? v.getTime() : typeof v === 'number' ? v : Date.parse(v));

export function createFreePass(ctx) {
  const { cfg, db, clock } = ctx;
  const list = Array.isArray(cfg.freePass) ? cfg.freePass : [];
  const byEmail = new Map(list.map((e) => [e.email, e]));
  const listed = (email) => (typeof email === 'string' ? byEmail.get(email) || null : null);

  /** The pass part: → true when the row changed. `f` is the locked families row. */
  async function passIn(q, f, now) {
    const e = listed(f.email);
    const until = ms(f.comp_until);
    const running = until !== null && until > now;
    const ours = f.comp_source === 'config';
    if (e) {
      if (ours) {
        if (until === e.until) return false; // already so
      } else {
        if (running) return false; // the admin's pass: never touched
        if (e.until <= now) return false; // a day that has passed: nothing to give
      }
      await q.query("update families set comp_until = $2, comp_source = 'config' where id = $1", [f.id, new Date(e.until)]);
      await ctx.audit(q, f.id, 'comp.set', { until: e.day }, { actor: 'config' });
      return true;
    }
    if (!ours || !running) return false;
    // no longer listed: the pass the list set ends now (an admin pass is never ours)
    await q.query("update families set comp_until = $2 where id = $1 and comp_source = 'config'", [f.id, new Date(now)]);
    await ctx.audit(q, f.id, 'comp.set', { until: null }, { actor: 'config' });
    return true;
  }

  /** The consent part: → true when verified consent was recorded now. */
  async function consentIn(q, f, now, notice) {
    if (!listed(f.email)) return false;
    if (!f.consent_at || f.verified_at) return false; // the notice first, always; never over another method
    if (noticeStale(f, notice)) return false; // agreed to an older notice: asked again first
    const r = await q.one("update families set verified_at = $2, verified_method = 'operator' where id = $1 and verified_at is null returning id", [f.id, new Date(now)]);
    if (!r) return false;
    await ctx.audit(q, f.id, 'consent.verified', { method: 'operator' }, { actor: 'config' });
    return true;
  }

  async function applyIn(q, familyId, { now = clock.now(), notice = null } = {}) {
    const f = await q.one('select * from families where id = $1 for update', [familyId]);
    if (!f) return { pass: false, consent: false, listed: false };
    const pass = await passIn(q, f, now);
    const consent = await consentIn(q, f, now, notice || (await loadNotice(cfg)));
    return { pass, consent, listed: !!listed(f.email) };
  }

  /** Every family the list concerns: listed addresses, and passes the list set before. */
  async function sync() {
    const now = clock.now();
    const notice = await loadNotice(cfg);
    const emails = list.map((e) => e.email);
    const r = await db.query("select id from families where email = any($1::text[]) or comp_source = 'config' order by created_at", [emails]);
    const c = { set: 0, ended: 0, consent: 0 };
    for (const { id } of r.rows) {
      const done = await db.tx((q) => applyIn(q, id, { now, notice }));
      if (done.pass) c[done.listed ? 'set' : 'ended']++;
      if (done.consent) c.consent++;
      if (done.pass || done.consent) changed(id);
    }
    return c;
  }

  /** After a change committed: the caches and the live sockets learn it (like the admin's). */
  function changed(familyId) {
    ctx.billing?.invalidate?.(familyId);
    ctx.events?.emit('family', { familyId });
  }

  return { list, listed, applyIn, sync, changed };
}
