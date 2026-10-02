// Accounts configuration (docs/ACCOUNTS.md §2): every Railway Variable the accounts code reads,
// read once at start and checked. A broken rule refuses the start with ONE line (the caller
// prints it and exits 1, so Railway keeps the old deployment). No dependencies.
//
//   loadConfig(env = process.env) → a frozen config object, or throws ConfigError
//
// With SW_ACCOUNTS unset (or `off`) only SW_ACCOUNTS itself is checked: every other variable is
// ignored, nothing is required, and the server behaves exactly as it did before accounts.
// Secrets never appear in an error message or in summarizeConfig().

import { hkdfSync } from 'node:crypto';

export class ConfigError extends Error {
  constructor(problems) {
    super('Sparkle World will not start: ' + problems.join('; '));
    this.name = 'ConfigError';
    this.problems = problems;
  }
}

export const ACCOUNT_MODES = ['off', 'optional', 'required'];
export const FRIENDS_MODES = ['subscription', 'free-join'];
export const MP_CONSENTS = ['verified', 'email_plus'];
export const MAIL_MODES = ['resend', 'postmark', 'microsoft', 'log', 'memory'];
/** The modes that really send: the only ones allowed in production. */
export const MAIL_PROVIDERS = ['resend', 'postmark', 'microsoft'];

export const DEFAULTS = Object.freeze({
  trialDays: 0, // the family's decision (2026-09-28): no free trial
  friendsMode: 'subscription', // friends need their own subscription
  mpConsent: 'verified',
  graceDays: 7,
  retainDays: 90,
  sellCountries: Object.freeze(['US']),
  priceText: '$5.99 a month, plus sales tax where it applies',
  worldMaxBytes: 8388608,
  maxPerFamily: 12,
});

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1']);
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The address part of MAIL_FROM (`Name <addr>` or a bare `addr`), lower-cased; null when it is
 * not one address. With MAIL_MODE=microsoft it picks the mailbox (/users/{address}/sendMail).
 */
export function mailboxOf(from) {
  const s = String(from || '').trim();
  const m = /^(?:[^<>]*<([^<>\s]+)>|([^<>\s]+))$/.exec(s);
  const a = m ? (m[1] || m[2]).toLowerCase() : '';
  return /^[^\s@<>()[\]\\,;:"/?#%]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(a) ? a : null;
}

/**
 * true when `s` is one bare address (no display name, no list), with the same address rule as
 * mailboxOf; `localhost` as the domain only when allowed (development and tests).
 */
export function bareAddress(s, allowLocalhost = false) {
  const t = String(s || '').trim();
  if (mailboxOf(t) === t.toLowerCase() && !t.includes('<')) return true;
  return allowLocalhost && /^[^\s@<>()[\]\\,;:"/?#%]+@localhost$/i.test(t);
}

/** HKDF-SHA256 sub-key of the master secret (salt `sparkle-world`, info = its purpose). */
export function subKey(secret, info) {
  return Buffer.from(hkdfSync('sha256', secret, 'sparkle-world', info, 32));
}

/**
 * Read and check the accounts configuration.
 * @param {Record<string, string|undefined>} env usually process.env
 */
export function loadConfig(env = process.env) {
  const problems = [];
  const str = (k) => {
    const v = env[k];
    return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
  };
  const oneOf = (k, list, def) => {
    const v = str(k);
    if (v === null) return def;
    const l = v.toLowerCase();
    if (!list.includes(l)) {
      problems.push(`${k} must be one of ${list.join(', ')}`);
      return def;
    }
    return l;
  };
  const int = (k, def, min, max = Number.MAX_SAFE_INTEGER) => {
    const v = str(k);
    if (v === null) return def;
    if (!/^\d+$/.test(v) || +v < min || +v > max) {
      problems.push(`${k} must be a whole number from ${min} to ${max}`);
      return def;
    }
    return +v;
  };

  const accounts = oneOf('SW_ACCOUNTS', ACCOUNT_MODES, 'off');
  if (accounts === 'off' || problems.length) {
    if (problems.length) throw new ConfigError(problems);
    return Object.freeze({ accounts: 'off', ...DEFAULTS });
  }

  const nodeEnv = str('NODE_ENV') || 'development';
  const production = nodeEnv === 'production';
  const test = str('SW_TEST') === '1';
  const need = (k) => {
    const v = str(k);
    if (v === null) problems.push(`${k} is missing (needed when SW_ACCOUNTS is ${accounts})`);
    return v;
  };
  const needInProduction = (k) => {
    const v = str(k);
    if (v === null && production) problems.push(`${k} is missing (needed in production)`);
    return v;
  };
  /** A test-only API address (MS_LOGIN_BASE, MS_GRAPH_BASE): refused in production, like STRIPE_API_BASE. */
  const testBase = (k) => {
    const v = str(k);
    if (v === null) return null;
    if (production) {
      problems.push(`${k} is for tests only and is refused in production`);
      return null;
    }
    try {
      const u = new URL(v);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error();
    } catch {
      problems.push(`${k} must be an http(s) address`);
      return null;
    }
    return v.replace(/\/+$/, '');
  };

  // ---- the database ----
  const databaseUrl = need('DATABASE_URL');
  if (databaseUrl) {
    if (/^pglite:/i.test(databaseUrl)) {
      if (production) problems.push('DATABASE_URL pglite: is for development and tests only');
    } else if (!/^postgres(ql)?:\/\//i.test(databaseUrl)) {
      problems.push('DATABASE_URL must be a postgres:// or postgresql:// address');
    }
  }

  // ---- where the site lives (cookies, CSRF, links in emails, Stripe return pages) ----
  let publicOrigin = need('PUBLIC_ORIGIN');
  let secureCookies = true;
  if (publicOrigin) {
    let u = null;
    try {
      u = new URL(publicOrigin);
    } catch {}
    if (!u || (u.pathname !== '/' && u.pathname !== '') || u.search || u.hash || u.username || u.password) {
      problems.push('PUBLIC_ORIGIN must be just the site address, like https://sparkleworld.fun');
    } else if (u.protocol === 'https:') {
      publicOrigin = u.origin;
    } else if (u.protocol === 'http:' && LOCAL_HOSTS.has(u.hostname) && !production) {
      publicOrigin = u.origin;
      secureCookies = false; // http://localhost: cookies without __Host- and Secure (§4.2)
    } else {
      problems.push(production ? 'PUBLIC_ORIGIN must start with https:// in production' : 'PUBLIC_ORIGIN must start with https:// (or be http://localhost:<port> for development)');
    }
  }

  // ---- the master secret and its sub-keys ----
  const secretText = need('SW_SECRET');
  let secret = null;
  if (secretText) {
    const b = /^[A-Za-z0-9+/_-]+={0,2}$/.test(secretText) ? Buffer.from(secretText, 'base64') : Buffer.alloc(0);
    if (b.length < 32) problems.push('SW_SECRET must be at least 32 random bytes, base64 encoded');
    else secret = b;
  }

  // ---- Stripe ----
  const stripeSecretKey = need('STRIPE_SECRET_KEY');
  const stripeLive = !!stripeSecretKey && /_live_/.test(stripeSecretKey);
  if (stripeSecretKey && !/^(sk|rk)_(test|live)_[A-Za-z0-9_]+$/.test(stripeSecretKey)) problems.push('STRIPE_SECRET_KEY must be a Stripe secret or restricted key (sk_… or rk_…)');
  const stripeWebhookSecret = need('STRIPE_WEBHOOK_SECRET');
  if (stripeWebhookSecret && !/^whsec_[A-Za-z0-9_+/=]+$/.test(stripeWebhookSecret)) problems.push('STRIPE_WEBHOOK_SECRET must start with whsec_');
  const stripePriceId = need('STRIPE_PRICE_ID');
  if (stripePriceId && !/^price_[A-Za-z0-9_]+$/.test(stripePriceId)) problems.push('STRIPE_PRICE_ID must start with price_');
  const stripePortalConfig = str('STRIPE_PORTAL_CONFIG');
  if (stripePortalConfig && !/^bpc_[A-Za-z0-9_]+$/.test(stripePortalConfig)) problems.push('STRIPE_PORTAL_CONFIG must start with bpc_');
  const stripeApiBase = str('STRIPE_API_BASE');
  if (stripeApiBase) {
    if (production) problems.push('STRIPE_API_BASE is for tests only and is refused in production');
    else {
      try {
        const u = new URL(stripeApiBase);
        if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error();
      } catch {
        problems.push('STRIPE_API_BASE must be an http(s) address');
      }
    }
  }
  const stripeShapes = str('SW_STRIPE_SHAPES') === '1';
  if (stripeShapes && stripeLive) problems.push('SW_STRIPE_SHAPES=1 is for test keys only');

  // ---- the plan and the rules around it (§0.3) ----
  const trialDays = int('SW_TRIAL_DAYS', DEFAULTS.trialDays, 0, 365);
  const friendsMode = oneOf('SW_FRIENDS_MODE', FRIENDS_MODES, DEFAULTS.friendsMode);
  const mpConsent = oneOf('SW_MP_CONSENT', MP_CONSENTS, DEFAULTS.mpConsent);
  if (friendsMode === 'free-join' && mpConsent === 'verified') problems.push('SW_FRIENDS_MODE=free-join needs SW_MP_CONSENT=email_plus (a free family can never pass card consent)');
  const graceDays = int('SW_GRACE_DAYS', DEFAULTS.graceDays, 0, 60);
  const retainDays = int('SW_RETAIN_DAYS', DEFAULTS.retainDays, 1, 3650);
  let sellCountries = DEFAULTS.sellCountries;
  const sc = str('SW_SELL_COUNTRIES');
  if (sc !== null) {
    const list = sc.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
    if (!list.length || list.some((c) => !/^[A-Z]{2}$/.test(c))) problems.push('SW_SELL_COUNTRIES must be a comma list of 2-letter country codes, like US');
    else sellCountries = Object.freeze([...new Set(list)]);
  }
  const priceText = str('SW_PRICE_TEXT') || DEFAULTS.priceText;
  const worldMaxBytes = int('SW_WORLD_MAX_BYTES', DEFAULTS.worldMaxBytes, 65536, 256 * 1024 * 1024);
  const maxPerFamily = int('SW_MAX_PER_FAMILY', DEFAULTS.maxPerFamily, 1, 1000);

  // ---- email ----
  if (str('MAIL_MODE') === null) need('MAIL_MODE');
  const mailMode = oneOf('MAIL_MODE', MAIL_MODES, null);
  const mailProvider = MAIL_PROVIDERS.includes(mailMode);
  const microsoft = mailMode === 'microsoft';
  if (production && mailMode && !mailProvider) problems.push('MAIL_MODE must be resend, postmark or microsoft in production');
  const mailApiKey = str('MAIL_API_KEY');
  const mailFrom = str('MAIL_FROM') || (mailProvider ? null : 'Sparkle World <hello@localhost>');
  if (mailProvider && !microsoft && !mailApiKey) problems.push(`MAIL_API_KEY is missing (needed with MAIL_MODE=${mailMode})`);
  if (mailProvider && !mailFrom) problems.push(`MAIL_FROM is missing (needed with MAIL_MODE=${mailMode})`);

  // Microsoft 365 (Microsoft Graph, app-only; docs/ACCOUNTS.md §10): the app registration's ids
  // and client secret, and the mailbox MAIL_FROM names. Read only with MAIL_MODE=microsoft. A
  // problem line never prints a value (the secret above all).
  let msTenantId = null;
  let msClientId = null;
  let msClientSecret = null;
  let msMailbox = null;
  // tests only: a local fake of the two Microsoft hosts (tools/ms-graph-fake.mjs); refused in
  // production whatever MAIL_MODE is, exactly like STRIPE_API_BASE
  const msLoginBase = testBase('MS_LOGIN_BASE');
  const msGraphBase = testBase('MS_GRAPH_BASE');
  if (microsoft) {
    msTenantId = str('MS_TENANT_ID');
    msClientId = str('MS_CLIENT_ID');
    msClientSecret = str('MS_CLIENT_SECRET');
    if (!msTenantId) problems.push('MS_TENANT_ID is missing (needed with MAIL_MODE=microsoft)');
    else if (!GUID.test(msTenantId)) problems.push('MS_TENANT_ID must be the Directory (tenant) ID, like 00000000-0000-0000-0000-000000000000');
    if (!msClientId) problems.push('MS_CLIENT_ID is missing (needed with MAIL_MODE=microsoft)');
    else if (!GUID.test(msClientId)) problems.push('MS_CLIENT_ID must be the Application (client) ID, like 00000000-0000-0000-0000-000000000000');
    if (!msClientSecret) problems.push('MS_CLIENT_SECRET is missing (needed with MAIL_MODE=microsoft)');
    else if (GUID.test(msClientSecret)) problems.push("MS_CLIENT_SECRET looks like the secret's ID: copy the secret's Value instead");
    else if (/\s/.test(msClientSecret) || msClientSecret.length < 16 || msClientSecret.length > 256) problems.push('MS_CLIENT_SECRET must be the client secret Value (one word, no spaces)');
    if (mailFrom) {
      msMailbox = mailboxOf(mailFrom);
      if (!msMailbox) problems.push('MAIL_FROM must name the sending mailbox, like Sparkle World <support@your-domain>');
    }
    if (msTenantId) msTenantId = msTenantId.toLowerCase();
    if (msClientId) msClientId = msClientId.toLowerCase();
  }

  // ---- who runs it (printed in /privacy, /terms and emails; COPPA) ----
  // The operator's email is also every email's Reply-To: it must be one bare address (a provider
  // refuses a message with a bad Reply-To, Microsoft 365 for good with 400 ErrorInvalidRecipients).
  // localhost is allowed outside production (development and tests).
  const operator = Object.freeze({
    name: needInProduction('SW_OPERATOR_NAME'),
    email: needInProduction('SW_OPERATOR_EMAIL'),
    address: needInProduction('SW_OPERATOR_ADDRESS'),
    phone: needInProduction('SW_OPERATOR_PHONE'),
  });
  if (operator.email !== null && !bareAddress(operator.email, !production)) problems.push('SW_OPERATOR_EMAIL must be one bare address, like hello@your-domain');

  // ---- free passes the operator gives his own family (§6.9) ----
  const freePass = parseFreePass(str('SW_FREE_PASS'), problems);

  // ---- tests and staging only (§12) ----
  if (test && production) problems.push('SW_TEST=1 is refused in production');
  if (test && stripeLive) problems.push('SW_TEST=1 is refused with a live Stripe key');
  const testDatabaseUrl = str('SW_TEST_DATABASE_URL');

  if (problems.length) throw new ConfigError(problems);

  const cookieBase = { secure: secureCookies, httpOnly: true, sameSite: 'Lax', path: '/' };
  return Object.freeze({
    accounts,
    nodeEnv,
    production,
    test,
    databaseUrl,
    testDatabaseUrl,
    trustProxy: str('SW_TRUST_PROXY') !== '0', // the same rule as the relay (server.mjs)
    publicOrigin,
    hsts: publicOrigin.startsWith('https://'),
    cookies: Object.freeze({
      ...cookieBase,
      sess: secureCookies ? '__Host-sw_sess' : 'sw_sess',
      login: secureCookies ? '__Host-sw_login' : 'sw_login',
    }),
    secret,
    keys: Object.freeze({ code: subKey(secret, 'code'), email: subKey(secret, 'email'), pair: subKey(secret, 'pair') }),
    stripeSecretKey,
    stripeLive,
    stripeWebhookSecret,
    stripePriceId,
    stripePortalConfig,
    stripeApiBase,
    stripeShapes,
    trialDays,
    friendsMode,
    mpConsent,
    graceDays,
    retainDays,
    sellCountries,
    priceText,
    worldMaxBytes,
    maxPerFamily,
    mailMode,
    mailApiKey,
    mailFrom,
    msTenantId,
    msClientId,
    msClientSecret,
    msMailbox,
    msLoginBase,
    msGraphBase,
    operator,
    freePass,
  });
}

export const FREE_PASS_MAX = 20;
export const FREE_PASS_DEFAULT_DAY = '2099-12-31';
const DAY_MS = 24 * 3600e3;

/**
 * The same address shape as auth.mjs's normalizeEmail (sign-in stores the family's email that
 * way, so a listed address matches it exactly); repeated here because this file imports nothing.
 */
function freePassEmail(s) {
  let e;
  try {
    e = s.trim().normalize('NFC').toLowerCase();
  } catch {
    return null;
  }
  if (e.length < 3 || e.length > 254) return null;
  if (!/^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:".]{2,}$/u.test(e)) return null;
  if (/[\u0000-\u001f\u007f]/.test(e) || e.includes('..')) return null;
  return e;
}

/**
 * SW_FREE_PASS: `a@b.com, c@d.com:2027-06-30` → a frozen list of { email, day, until } (until:
 * the end of that day, UTC, in ms; no day = 2099-12-31). A problem names the entry by its
 * place in the list, never by its text (an address is personal data). null/empty → [].
 */
export function parseFreePass(text, problems) {
  if (text === null || text === undefined || String(text).trim() === '') return Object.freeze([]);
  const parts = String(text).split(',').map((s) => s.trim()).filter(Boolean);
  if (parts.length > FREE_PASS_MAX) {
    problems.push(`SW_FREE_PASS lists ${parts.length} addresses (at most ${FREE_PASS_MAX})`);
    return Object.freeze([]);
  }
  const list = [];
  const seen = new Set();
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    const m = /^(.*?)(?::(\d{4}-\d{2}-\d{2}))?$/.exec(p);
    const email = m ? freePassEmail(m[1]) : null;
    if (!email) {
      problems.push(`SW_FREE_PASS entry ${i + 1} must be an email address, or email:YYYY-MM-DD`);
      continue;
    }
    const day = m[2] || FREE_PASS_DEFAULT_DAY;
    const [y, mo, d] = day.split('-').map(Number);
    const t = Date.UTC(y, mo - 1, d);
    if (!Number.isFinite(t) || y < 2000 || y > 2099 || new Date(t).toISOString().slice(0, 10) !== day) {
      problems.push(`SW_FREE_PASS entry ${i + 1} has a date that is not a real day (YYYY-MM-DD, up to 2099-12-31)`);
      continue;
    }
    if (seen.has(email)) {
      problems.push(`SW_FREE_PASS entry ${i + 1} lists the same address twice`);
      continue;
    }
    seen.add(email);
    list.push(Object.freeze({ email, day, until: t + DAY_MS }));
  }
  return Object.freeze(list);
}

/** One safe line for the Deploy Logs (no secrets, no addresses of people). */
export function summarizeConfig(cfg) {
  if (cfg.accounts === 'off') return 'accounts: off';
  return [
    `accounts: ${cfg.accounts}`,
    `friends ${cfg.friendsMode}`,
    `consent ${cfg.mpConsent}`,
    `trial ${cfg.trialDays} d`,
    `grace ${cfg.graceDays} d`,
    `retain ${cfg.retainDays} d`,
    `sell ${cfg.sellCountries.join(',')}`,
    cfg.mailMode === 'microsoft' ? `mail microsoft (${String(cfg.msMailbox || '').split('@')[1] || '?'}${cfg.msLoginBase || cfg.msGraphBase ? ', fake' : ''})` : `mail ${cfg.mailMode}`,
    `stripe ${cfg.stripeLive ? 'live' : 'test'}${cfg.stripeApiBase ? ' (fake)' : ''}`,
    `db ${/^pglite:/i.test(cfg.databaseUrl) ? 'pglite' : 'postgres'}`,
    cfg.freePass && cfg.freePass.length ? `free passes ${cfg.freePass.length}` : null,
    cfg.test ? 'TEST HOOKS ON' : null,
  ].filter(Boolean).join(', ');
}
