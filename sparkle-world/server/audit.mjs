// Consent and action records (docs/ACCOUNTS.md §11.9): one row in audit_log per consent or
// parent action, kept 3 years as proof of consent. A row never holds personal data: `detail`
// carries only versions, ids (a player id goes in its own column, an 8-hex session prefix, a
// Stripe invoice id), methods, dates and counts. Never an email, a nickname, an IP address or
// free text. Unknown actions, unknown detail keys and values of the wrong shape are refused
// (a programming error, so the request answers 503 and nothing is written).
//
//   await audit(q, familyId, action, detail = {}, { actor = 'parent', playerId = null, at = null })
//     q:       db or a transaction's q (tools write it in the same transaction as the change)
//     actor:   'parent' | 'system' | 'stripe' | 'admin' | 'config' (SW_FREE_PASS, §6.9)
//     at:      ms (the app clock); accounts.mjs passes ctx.clock.now() for every caller

import { isUuid } from './http.mjs';

/** action → the detail keys it may carry (§11.9). */
export const AUDIT_ACTIONS = Object.freeze({
  'consent.email_plus': ['v'],
  'consent.confirm_sent': ['v'],
  'consent.verified': ['method', 'invoice'],
  'player.create': [],
  'player.delete': [],
  'friends.on': ['v'],
  'friends.off': [],
  'walkie.on': ['v'],
  'walkie.off': [],
  'device.paired': ['sid'],
  'device.removed': ['sid'],
  'export.player': [],
  'export.family': [],
  'family.delete': [],
  'family.deleted': [],
  'plan.lapsed': [],
  'plan.resumed': [],
  'retention.purge': ['players'],
  'comp.set': ['until'],
  'email.changed': [],
});

export const AUDIT_ACTORS = Object.freeze(['parent', 'system', 'stripe', 'admin', 'config']);

const smallInt = (v) => Number.isInteger(v) && v >= 0 && v <= 1e6;
/** key → is this value allowed (never text a person typed). */
const VALUES = {
  v: smallInt,
  players: smallInt,
  method: (v) => ['card', 'form', 'call', 'video', 'operator'].includes(v),
  invoice: (v) => typeof v === 'string' && /^in_[A-Za-z0-9]{1,64}$/.test(v),
  sid: (v) => typeof v === 'string' && /^[0-9a-f]{8}$/.test(v),
  until: (v) => v === null || (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)),
};

/** Throws when the record would break the rules above. */
export function checkAudit(action, detail = {}, { actor = 'parent', playerId = null } = {}) {
  const keys = AUDIT_ACTIONS[action];
  if (!keys) throw new Error('audit: unknown action');
  if (!AUDIT_ACTORS.includes(actor)) throw new Error('audit: unknown actor');
  if (playerId !== null && playerId !== undefined && !isUuid(playerId)) throw new Error('audit: player id must be a uuid');
  if (!detail || typeof detail !== 'object' || Array.isArray(detail)) throw new Error('audit: detail must be an object');
  for (const [k, v] of Object.entries(detail)) {
    if (v === undefined) continue;
    if (!keys.includes(k)) throw new Error('audit: unknown detail key for this action');
    if (!VALUES[k](v)) throw new Error('audit: detail value not allowed');
  }
}

export async function audit(q, familyId, action, detail = {}, { actor = 'parent', playerId = null, at = null } = {}) {
  if (!isUuid(familyId)) throw new Error('audit: family id must be a uuid');
  checkAudit(action, detail, { actor, playerId });
  const clean = {};
  for (const [k, v] of Object.entries(detail || {})) if (v !== undefined) clean[k] = v;
  await q.query('insert into audit_log (family_id, player_id, at, actor, action, detail) values ($1, $2, $3, $4, $5, $6)', [
    familyId,
    playerId || null,
    new Date(at ?? Date.now()),
    actor,
    action,
    JSON.stringify(clean),
  ]);
}
