// Is the family's Family Plan (or free pass) good right now? (docs/ACCOUNTS.md §6.5)
// A pure function: no database, no Stripe, no clock of its own. Callers use
// billing.entitlementFor(familyId), which loads the rows and caches the answer for 60 s.
//
//   entitlementOf({ family, subs, now, cfg }) → {
//     state: 'none' | 'trialing' | 'active' | 'canceling' | 'past_due' | 'comp' | 'lapsed',
//     entitled, until,                 // until: ms, or null when not entitled
//     trialEnd, periodEnd, graceUntil, // ms or null, from the subscription that counts
//     cancelAtPeriodEnd,
//     consent: 'none' | 'email_plus' | 'verified',
//     friendsConsentOk,                // cfg.mpConsent === 'email_plus' ? consent !== 'none' : consent === 'verified'
//     walkieConsentOk,                 // consent === 'verified' (always)
//   }
//
// `family` is a families row, `subs` its subscriptions rows (snake_case, as the database gives
// them; camelCase works too). Times may be Date, epoch ms or ISO strings. `now` is the app
// clock (ms or Date). `cfg` needs { graceDays, mpConsent } (loadConfig() has both).
//
// The table (Stripe status → entitled while → state, until):
//   comp_until > now (any status)       always                      comp       max(comp_until, the plan's until)
//   trialing                            now < trial_end + 1 day      trialing   trial_end + 1 d
//   active, not cancelling              now < period_end + 3 days    active     period_end + 3 d   (renewal webhook lag)
//   active, cancel_at_period_end        now < period_end + 1 hour    canceling  period_end
//   past_due                            now < first_failed_at + SW_GRACE_DAYS   past_due   first_failed_at + grace
//   incomplete                          never                        none (or lapsed if an earlier plan or pass ended)
//   unpaid, canceled, incomplete_expired, paused, or past its until: never → lapsed (had a plan or pass) or none
// The subscription that counts: the non-terminal one (trialing, active, past_due) with the
// latest period end; else the most recently synced. "Had a plan": an ended free pass, a
// lapsed_at, or any subscription that got past `incomplete` / `incomplete_expired`.

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const NON_TERMINAL = new Set(['trialing', 'active', 'past_due']);
const NEVER_STARTED = new Set(['incomplete', 'incomplete_expired']);

/** Date | number | ISO string | null → epoch ms or null. */
export function toMs(v) {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? v.getTime() : null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'bigint') return Number(v);
  const t = Date.parse(String(v));
  return Number.isFinite(t) ? t : null;
}

const camel = (k) => k.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
/** row[snake] ?? row[camel] */
const get = (row, k) => (row ? (row[k] !== undefined ? row[k] : row[camel(k)]) : undefined);

export function consentOf(family) {
  if (toMs(get(family, 'verified_at')) !== null) return 'verified';
  if (toMs(get(family, 'consent_at')) !== null) return 'email_plus';
  return 'none';
}

/** The subscription that counts (see above), or null. */
export function countingSub(subs) {
  const list = (subs || []).filter(Boolean);
  const periodEnd = (s) => toMs(get(s, 'current_period_end')) ?? toMs(get(s, 'trial_end')) ?? -Infinity;
  const live = list.filter((s) => NON_TERMINAL.has(get(s, 'status')));
  if (live.length) return live.reduce((a, b) => (periodEnd(b) > periodEnd(a) ? b : a));
  if (!list.length) return null;
  return list.reduce((a, b) => ((toMs(get(b, 'synced_at')) ?? -Infinity) > (toMs(get(a, 'synced_at')) ?? -Infinity) ? b : a));
}

/** What one subscription row allows at `now`: { entitled, state, until, graceUntil }. */
function subscriptionAt(sub, now, graceDays) {
  const status = get(sub, 'status');
  const trialEnd = toMs(get(sub, 'trial_end'));
  const periodEnd = toMs(get(sub, 'current_period_end'));
  const synced = toMs(get(sub, 'synced_at'));
  // a missing date (it should not happen) falls back to the other one, then to a day after the
  // last read from Stripe: the reconcile job (every 6 h) reads it again before that runs out
  const fallback = synced !== null ? synced + DAY : null;
  if (status === 'trialing') {
    const end = trialEnd ?? periodEnd ?? fallback;
    const until = end === null ? null : end + DAY;
    return until !== null && now < until ? { entitled: true, state: 'trialing', until, graceUntil: null } : { entitled: false };
  }
  if (status === 'active') {
    const end = periodEnd ?? trialEnd ?? fallback;
    if (end === null) return { entitled: false };
    if (get(sub, 'cancel_at_period_end') === true) {
      return now < end + HOUR ? { entitled: true, state: 'canceling', until: end, graceUntil: null } : { entitled: false };
    }
    return now < end + 3 * DAY ? { entitled: true, state: 'active', until: end + 3 * DAY, graceUntil: null } : { entitled: false };
  }
  if (status === 'past_due') {
    const failed = toMs(get(sub, 'first_failed_at')) ?? periodEnd ?? synced;
    if (failed === null) return { entitled: false };
    const graceUntil = failed + graceDays * DAY;
    return now < graceUntil ? { entitled: true, state: 'past_due', until: graceUntil, graceUntil } : { entitled: false, graceUntil };
  }
  return { entitled: false }; // incomplete, unpaid, canceled, incomplete_expired, paused, unknown
}

export function entitlementOf({ family, subs = [], now, cfg = {} }) {
  const t = toMs(now);
  if (t === null) throw new Error('entitlementOf: now is required');
  const graceDays = Number.isFinite(cfg.graceDays) ? cfg.graceDays : 7;
  const mpConsent = cfg.mpConsent === 'email_plus' ? 'email_plus' : 'verified';
  const consent = consentOf(family);
  const sub = countingSub(subs);
  const at = sub ? subscriptionAt(sub, t, graceDays) : { entitled: false };
  const compUntil = toMs(get(family, 'comp_until'));
  const hadPlan =
    compUntil !== null ||
    toMs(get(family, 'lapsed_at')) !== null ||
    (subs || []).some((s) => s && !NEVER_STARTED.has(get(s, 'status')));

  let state;
  let entitled;
  let until;
  if (compUntil !== null && compUntil > t) {
    state = 'comp';
    entitled = true;
    until = at.entitled ? Math.max(compUntil, at.until) : compUntil;
  } else if (at.entitled) {
    ({ state, until } = at);
    entitled = true;
  } else {
    state = hadPlan ? 'lapsed' : 'none';
    entitled = false;
    until = null;
  }
  return {
    state,
    entitled,
    until,
    trialEnd: sub ? toMs(get(sub, 'trial_end')) : null,
    periodEnd: sub ? toMs(get(sub, 'current_period_end')) : null,
    graceUntil: sub && get(sub, 'status') === 'past_due' ? at.graceUntil ?? null : null,
    cancelAtPeriodEnd: sub ? get(sub, 'cancel_at_period_end') === true : false,
    consent,
    friendsConsentOk: mpConsent === 'email_plus' ? consent !== 'none' : consent === 'verified',
    walkieConsentOk: consent === 'verified',
  };
}
