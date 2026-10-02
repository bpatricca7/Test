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
    super('Glimmer World will not start: ' + problems.join('; '));
    this.name = 'ConfigError';
    this.problems = problems;
  }
}

export const ACCOUNT_MODES = ['off', 'optional', 'required'];
export const FRIENDS_MODES = ['subscription', 'free-join'];
export const MP_CONSENTS = ['verified', 'email_plus'];
export const MAIL_MODES = ['resend', 'postmark', 'log', 'memory'];

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
      problems.push('PUBLIC_ORIGIN must be just the site address, like https://www.playglimmerworld.com');
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
  const mailProvider = mailMode === 'resend' || mailMode === 'postmark';
  if (production && mailMode && !mailProvider) problems.push('MAIL_MODE must be resend or postmark in production');
  const mailApiKey = str('MAIL_API_KEY');
  const mailFrom = str('MAIL_FROM') || (mailProvider ? null : 'Glimmer World <hello@localhost>');
  if (mailProvider && !mailApiKey) problems.push(`MAIL_API_KEY is missing (needed with MAIL_MODE=${mailMode})`);
  if (mailProvider && !mailFrom) problems.push(`MAIL_FROM is missing (needed with MAIL_MODE=${mailMode})`);

  // ---- who runs it (printed in /privacy, /terms and emails; COPPA) ----
  const operator = Object.freeze({
    name: needInProduction('SW_OPERATOR_NAME'),
    email: needInProduction('SW_OPERATOR_EMAIL'),
    address: needInProduction('SW_OPERATOR_ADDRESS'),
    phone: needInProduction('SW_OPERATOR_PHONE'),
  });

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
    `mail ${cfg.mailMode}`,
    `stripe ${cfg.stripeLive ? 'live' : 'test'}${cfg.stripeApiBase ? ' (fake)' : ''}`,
    `db ${/^pglite:/i.test(cfg.databaseUrl) ? 'pglite' : 'postgres'}`,
    cfg.freePass && cfg.freePass.length ? `free passes ${cfg.freePass.length}` : null,
    cfg.test ? 'TEST HOOKS ON' : null,
  ].filter(Boolean).join(', ');
}
