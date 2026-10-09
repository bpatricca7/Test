# Glimmer World: family accounts, the Glimmer World Membership and cloud saves (accounts v1)

*Final spec, 2026-09-28. Written by the lead architect after scoring three proposals (Appendix A).
The base is proposal 2 ("one box"); the best ideas of proposals 1 and 3 are grafted on, and what
v1 does not need is cut (§16). This is the contract for the implementers (§15). If code and this
document disagree, fix one of them in the same change, as DESIGN.md says.*

Glossary. **Family**: one account, owned by one grown-up (the **parent**), who signs in with email.
**Player**: a child in the family (nickname + avatar picture only). **Family page**: the grown-ups'
dashboard at `/account`. **Glimmer World Membership** ("the membership"; called the Family Plan until
2026-10-03, when the family renamed it because that name sounded as if cheaper plans existed):
the one $5.99/month Stripe subscription, the only plan, with everything included. Identifiers
keep the old name (`family_plan` in Stripe metadata, `#family-plan`, `planView`). **Entitled**: the
family's plan (or a free pass) is currently good. **Parent session / device session**: a signed-in
browser of the parent / a kid's device set up by the parent. **Email check**: a fresh 6-digit code
emailed to the parent before a sensitive action. **Grown-up check**: the game's existing
multiplication speed bump (`src/net/walkie/gate.js`), asked only where nothing else protects the
step (§7.7): the Grown-ups card on a device with a parent session, **Remove old copies** on a kid's
device, and the walkie switch in local mode. Never on the way to sign in or to pair a device (the
parent's email, or the code from the Family page, is the grown-up's OK).

---

## 0. The short version

### 0.1 Will this be an end-to-end website? Yes.

Once this is built, nobody has to do anything by hand for a new family:

1. Home page → **Membership** → the Family page. The grown-up types an email, then the 6-digit
   code from the email (or taps the link in it).
2. She reads a short notice about children's information and ticks "I agree".
3. She pays on Stripe's own checkout page: **$5.99 a month** (plus sales tax where it applies),
   charged at checkout (no free trial, §0.2), card up front. Apple Pay works on the iPad.
4. She adds the kids: a nickname each, up to 6.
5. On a kid's iPad: open the game → **Grown-ups** → **I have a code** → type the 8-character code the
   Family page shows. (Or sign in on that iPad and tap **Kids play on this device**.)
6. The kid taps her avatar in **Who's playing?** and plays. Her worlds are saved on the iPad and in
   the family's cloud copy, so they follow her to the computer and come back if Safari clears the
   site's data. Worlds already on the device are brought in the first time.
7. **Play with friends** (friends whose families also have the plan) and the **walkie-talkie** are
   switched on per child on the Family page; the server enforces both switches.
8. The grown-up manages or cancels the plan in Stripe's Customer Portal, and can download or delete
   everything on the Family page. Nothing is ever for sale inside the game.

What code cannot do (the family's jobs, §14): buy a domain; the Stripe settings (product, price,
tax, portal, webhook, keys); the email provider set-up; Railway's database and variables; the
operator contact details the privacy notice must print; a lawyer's read of the notice and of the
consent approach (§11); and one real test-mode purchase before going live.

### 0.2 The family's decisions (binding)

| Decision | Consequence in this spec |
|---|---|
| Payments: **Stripe** (existing account) | Stripe Checkout (hosted), Customer Portal, Stripe Tax, webhooks (§6) |
| Sell in the **US first** | USD only, US tax registrations, non-US billing addresses are turned away (§6.8) |
| **One plan: $5.99/month** subscription | one Product, one recurring Price; no other prices, no promotion codes |
| **No in-app purchases, ever** | no purchase path inside the game; Sparkle Coins stay earned-only; kids never see a price (§7.9) |
| **Friends need their own account** | multiplayer only between signed-in players of entitled families (`SW_FRIENDS_MODE=subscription`, §8) |
| **No free trial** (decided 2026-09-28) | `SW_TRIAL_DAYS=0` is the default; the first $5.99 charge happens at checkout, so the card-transaction consent (`verified`) is recorded at sign-up and friends/walkie can be switched on right away by the parent (§6.7) |
| **Friends need their own $5.99 subscription** (confirmed 2026-09-28) | `SW_FRIENDS_MODE=subscription` is fixed for v1; `free-join` stays unbuilt-by-default config only |
| Accounts belong to **parents**; kids never enter email | parent email sign-in; kid devices are paired with a code (§4) |
| Players are **nickname + avatar only** | no real names, birthdays, photos, kid emails (§3.3, §11.2) |

### 0.3 Open decisions, made configuration (defaults shown)

| Variable | Default | Other values | Where |
|---|---|---|---|
| `SW_TRIAL_DAYS` | `0` (no trial: the family's decision) | any whole number (card up front, Stripe subscription trial) | §6.2 |
| `SW_FRIENDS_MODE` | `subscription` (each friend's family subscribes) | `free-join` (a free account may only join, not host or build) | §6.7, §8.6 |
| `SW_MP_CONSENT` | `verified` (friends unlock after the first real payment) | `email_plus` (only after a lawyer says so; required by `free-join`) | §6.7, §11.4 |
| `SW_ACCOUNTS` | `off` (today's behavior) | `optional`, `required` | §1.2, §13 |
| `SW_GRACE_DAYS` | `7` (play on after a failed payment) | | §6.5 |
| `SW_RETAIN_DAYS` | `90` (kid data kept after a plan ends) | | §3.5 |
| `SW_SELL_COUNTRIES` | `US` | comma list of 2-letter codes | §6.8 |

### 0.4 What each proposal gave this spec

- **Proposal 2 (base):** one Node service + Railway Postgres, only `pg` and `stripe` added, email code
  as the primary sign-in (an iPad Home Screen app has its own cookie jar, so a link opened from Mail
  signs in Safari, not the app), the code bound to the browser that asked, SaveStore's existing cloud
  slot, the email outbox, refusing WebSockets *after* the handshake with close codes the page can
  read, the server stamping each player's nickname, free passes (`comp_until`) and an admin CLI, a
  Stripe fake with delivery chaos, everything off unless `SW_ACCOUNTS` is set.
- **Proposal 1:** the per-child *separate* consents (friends, walkie) recorded in an audit log without
  personal data, the step-up list, `__Host-` cookies, `Sec-Fetch-Site`, the log-spy test, the
  security test list, per-family limits, `410 player_gone` wiping a deleted child's data on devices.
- **Proposal 3:** world tombstones (deletes reach other devices), "a kid never sees a price" with a
  test for it, "no child data in any email", the operator's contact details in the notice, claims
  applied inside `rooms.mjs` and `voice.mjs`, close codes wired into the page's error table, the
  three-state `SW_ACCOUNTS`, the dashboard avatar portrait, the "resting" wording, an idempotent
  Stripe setup script.
- **Cut** (§16): passkeys, the grown-up PIN, app-level email encryption, picture pairing codes,
  card-fingerprint trial checks, automatic refunds, per-player relay stamps.

---

## 1. Architecture

### 1.1 Shape

```
 kid's iPad / computer (the game, /play)        parent's phone (the Family page, /account)
        │  HTTPS: /api/me, /api/players/:pid/*          │  HTTPS: /api/auth/*, /api/family, /api/billing/*
        │  WSS:   /r/<room>?s=&d=&p=<player>            │  (fetch, JSON; never form posts)
        ▼                                              ▼
 ┌──────────────────────────── Railway: ONE Node 22 service ─────────────────────────────┐
 │ server/server.mjs  static site + game, the relay (rooms.mjs, voice.mjs), upgrade checks │
 │ server/accounts.mjs  /api router, sessions, family, saves, billing, jobs, mail outbox   │
 └───────────────┬───────────────────────────┬─────────────────────────────┬──────────────┘
                 │ private network            │ HTTPS (server → provider)   │ HTTPS both ways
                 ▼                            ▼                             ▼
        Railway Postgres 16            Email provider (Microsoft      Stripe (Checkout, Portal,
   (families, players, saves,          365, Resend or Postmark):       Tax, webhooks): parent
    sessions, billing mirror)          parent email + our text only     email + payment only
```

No second service: jobs run inside the same process under Postgres advisory locks (§13.3). Rooms,
rate limits and caches stay in memory, so **Replicas stays 1** (as DEPLOY-RAILWAY.md already says).

### 1.2 The three modes (`SW_ACCOUNTS`)

| | `off` (default) | `optional` (launch, ≤ 30 days) | `required` (final) |
|---|---|---|---|
| Database, `/api/*` accounts routes | not used, not mounted | used | used |
| `/play` signed out | exactly today | exactly today (device saves, math-gated walkie) + a **Grown-ups** tile | "Ask a grown-up" card (§7.1) |
| Signed in, entitled | — | cloud saves, picker, dashboard switches | same |
| Signed in, no plan (ended or never started) | — | plays her own player with cloud writes refused (read-only), saves on the device | a grown-up's sign-in: straight to the Family page; a kid's device: "Glimmer World is resting" card |
| … and `SW_FRIENDS_MODE=free-join`, a player with friends on | — | visitor: join a friend's game only (§7.1) | same |
| Relay | exactly today | sockets without `p` as today; sockets with `p` are checked (§8) | every socket needs a session and `p` |
| `/api/net` | `{ok, version, build}` | adds `accounts:'optional', friendsMode` | adds `accounts:'required', friendsMode` |

The claude.ai Artifact build, `file://` and `npm run dev` never use any of this (§7.10).

### 1.3 Module layout (owners in §15)

```
server/
  server.mjs          (edit) routes /api/* to accounts, /healthz with the database, async upgrade checks,
                      per-family limits, live revocation, HSTS                                  [D]
  limits.mjs          (new) Bucket, isInternalIp, normalizeIp, clientIpOf, addressKey moved out of
                      server.mjs (re-exported there for the tests), KeyedLimiter               [D]
  rooms.mjs           (edit) member claims: host/build/walkie/nickname rules                    [D]
  voice.mjs           (edit) per-link `allowed`, the `perm` control frame                        [D]
  config.mjs          (new) read + validate environment variables (§2)                          [A]
  db.mjs              (new) pg Pool (or PGlite in tests): query, tx, tryLock                    [A]
  migrate.mjs         (new) migration runner; migrations/001_init.sql, 002, 003 (§3.3)          [A]
  http.mjs            (new) router, body reader (limits, gzip), cookies, CSRF, JSON answers     [A]
  accounts.mjs        (new) composition root: createAccounts(cfg) → the API server.mjs uses     [A]
  auth.mjs            (new) sign-in, sessions, email check, pairing, devices                    [A]
  family.mjs          (new) /api/me, family, consent, players, export, delete                   [A]
  audit.mjs           (new) audit(q, familyId, action, detail) with the allowed actions         [A]
  mail.mjs            (new) outbox, transports (resend | postmark | microsoft | log | memory)   [A]
  mail-templates.mjs  (new) every email's text (§10)                                            [A]
  jobs.mjs            (new) outbox sender, retention, lapse, reminders, reconcile trigger (§13.7)[A]
  admin.mjs           (new) the admin CLI (§13.8)                                               [A]
  freepass.mjs        (new) SW_FREE_PASS: the operator's own family's pass and consent (§6.9)   [A]
  test-hooks.mjs      (new) /api/test/* (only with SW_TEST=1)                                   [A]
  saves.mjs           (new) /api/players/:pid/profile|worlds|portrait                           [C]
  entitlement.mjs     (new) pure entitlementOf() (§6.5)                                         [B]
  billing.mjs         (new) checkout, sync, portal, start-now, webhook, reconcile               [B]
  stripe.mjs          (new) the Stripe client (pinned API version, fake host in tests)          [B]
  notice.mjs          (new) NOTICE_VERSION + the direct notice text, one source for page+email  [B]
src/
  account/            (new) index.js (install, prepare, screens), api.js (fetch wrapper),
                      cloud.js (HttpCloudBackend), picker.js, cards.js, merge.js, legacy.js,
                      portrait.js                                                               [C]
  core/storage.js     (edit) namespaces, injected cloud, retries, reconcile, tombstones, forks  [C]
  core/game.js        (edit) startHooks, fork handler                                           [C]
  main.js             (edit) install the account module after `ui`                              [C]
  net/ws-transport.js, transport.js, session.js, protocol.js, facade.js, ui.js (edit):
                      &p=, close codes 4401-4405, canHost, friendly messages                    [C]
  net/walkie/index.js, walkie/ui.js, walkie/gate.js (edit): account-mode switch, perm frame,
                      gate reusable as the grown-up check                                       [C]
  ui/settings.js, ui/menus.js (edit): name row, Grown-ups row/tile, Switch chip, visitor mode   [C]
site/
  account.html, account/verify.html, account.js, account.css (new): the Family page           [D]
  privacy.html, terms.html (new): drafts (text by B, page shell by D)                          [B/D]
  index.html, parents.html (edit): truthful copy (§9.5)                                         [D]
tools/
  build.mjs (edit: self-host the font in the game) [C]; site-build.mjs (edit: operator
  placeholders) [D]; testdb.mjs [A]; test-accounts.mjs [A]; stripe-fake/ [B]; fixtures/stripe/ [B];
  stripe-setup.mjs [B]; test-billing.mjs [B]; test-saves.mjs [C]; e2e-accounts.mjs [D];
  dev-accounts.mjs [D]; site-check.mjs, test-net.mjs, test-walkie.mjs (additions) [D]
docs/
  ACCOUNTS.md (this), SECURITY-PROGRAM.md, RETENTION.md, DATA-MAP.md, INCIDENT.md, VENDORS.md,
  CONSENT-FORM.md [B]; DEPLOY-RAILWAY.md, MULTIPLAYER.md Addendum D [D]; DESIGN.md storage note [C]
.github/workflows/test.yml (repository root, working-directory sparkle-world)                   [D]
```

### 1.4 Dependencies

| Package | Version (pin exactly, like the others) | Why |
|---|---|---|
| `pg` | 8.23.0 | Postgres driver (a few small deps: pg-pool, pg-protocol, pg-types, pgpass) |
| `stripe` | 22.6.2 | official SDK; **no runtime dependencies**; pinned API version `2026-08-26.dahlia` |
| `@electric-sql/pglite` (devDependency) | 0.5.8 | in-process Postgres for tests when no real Postgres is available |

Email goes out with Node's own `fetch` (no SDK). No Express, no ORM, no auth framework. Passkeys
(phase 2) would add `@simplewebauthn/server`.

**Why not Better Auth.** It clearly does not beat a small hand-written layer here:
1. The flows are bespoke and would be custom plugins anyway: a code bound to the browser that asked
   (iPad Home Screen apps), kid devices paired by code, parent vs device sessions, an email check
   before sensitive actions, COPPA consent state, and kid players who are not users at all.
2. Its footprint: `better-auth@1.7.6` depends on its own core, kysely and adapter packages for
   Mongo, Prisma, Drizzle, Kysely and memory, zod, jose, better-call, nanostores, `@noble/*` and a
   telemetry package. That is a large, fast-moving supply chain inside a child-directed service whose
   server depends on `ws` alone today, plus its own tables and cookie/CSRF conventions to reconcile.
3. The properties that make sign-in safe here are each a few testable lines: random single-use
   tokens stored hashed, POST to consume, codes bound to an attempt cookie with 5 tries, `__Host-`
   cookies, a custom header + Origin check, rate limits.
4. The one part that must not be hand-written (WebAuthn parsing) is deferred, and Better Auth's own
   passkey plugin delegates it to `@simplewebauthn/server` anyway.

Expected size: `auth.mjs` about 450 lines, fully covered by `tools/test-accounts.mjs` (§12.6).

---

## 2. Configuration (Railway Variables)

`server/config.mjs` reads everything once at start and **refuses to start** (one clear line in the
Deploy Logs, exit code 1, so Railway keeps the old deployment) when a rule below is broken.

| Variable | Needed when | Meaning |
|---|---|---|
| `SW_ACCOUNTS` | always (default `off`) | `off` \| `optional` \| `required` |
| `DATABASE_URL` | accounts on | `${{Postgres.DATABASE_URL}}` (Railway reference variable, private network); `pglite:` or `pglite:<dir>` = in-process PGlite for development and tests (refused in production) |
| `PUBLIC_ORIGIN` | accounts on | e.g. `https://www.playglimmerworld.com`; must be `https://`, except `http://localhost:*` / `http://127.0.0.1:*` when `NODE_ENV` is not `production` (then cookies drop `__Host-`/`Secure`, §4.2) |
| `SW_SECRET` | accounts on | ≥ 32 random bytes, base64. Sub-keys by HKDF-SHA256(secret, salt `sparkle-world`, info = `code` \| `email` \| `pair`). Rotating it only voids pending codes |
| `STRIPE_SECRET_KEY` | accounts on | a **restricted** key `rk_live_…` (`sk_test_`/`rk_test_` on staging) (§14 step 4) |
| `STRIPE_WEBHOOK_SECRET` | accounts on | `whsec_…` of the webhook endpoint |
| `STRIPE_PRICE_ID` | accounts on | `price_…` of the $5.99/month price |
| `STRIPE_PORTAL_CONFIG` | optional | `bpc_…`; otherwise the Dashboard's default portal settings |
| `SW_TRIAL_DAYS`, `SW_FRIENDS_MODE`, `SW_MP_CONSENT`, `SW_GRACE_DAYS`, `SW_RETAIN_DAYS`, `SW_SELL_COUNTRIES` | optional | §0.3 |
| `SW_PRICE_TEXT` | optional | default `$5.99 a month, plus sales tax where it applies`; checked against the Stripe price at start (a mismatch logs one warning) |
| `SW_WORLD_MAX_BYTES` | optional | default `8388608` (8 MB, one world's JSON, uncompressed) |
| `SW_MAX_PER_FAMILY` | optional | default `12` relay connections per family |
| `SW_FREE_PASS` | optional | the operator's own family, without paying (§6.9): a comma list of `email` or `email:YYYY-MM-DD` (no date = through `2099-12-31`), at most 20. The Deploy Logs show only how many |
| `MAIL_MODE` | accounts on | `microsoft` \| `resend` \| `postmark` (production) \| `log` (development) \| `memory` (tests) |
| `MAIL_API_KEY`, `MAIL_FROM` | production | `MAIL_API_KEY`: the Resend or Postmark key (not used with `microsoft`). `MAIL_FROM`: `Glimmer World <hello@your-domain>` (before the domain is verified at Resend, `Glimmer World <onboarding@resend.dev>` works, but Resend delivers it only to the Resend account owner's own address). With `microsoft`, its address part **is the sending mailbox** (`/users/{address}/sendMail`), for example `Glimmer World <support@brickoodle.com>` |
| `MS_TENANT_ID`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET` | `MAIL_MODE=microsoft` | the Microsoft Entra app registration (DEPLOY-RAILWAY.md step 12a): the Directory (tenant) ID and the Application (client) ID (both GUIDs), and the client secret's **Value** (a value shaped like a GUID is refused: that is the secret's ID). The Deploy Logs show only `mail microsoft (<the mailbox's domain>)` |
| `SW_OPERATOR_NAME`, `SW_OPERATOR_EMAIL`, `SW_OPERATOR_ADDRESS`, `SW_OPERATOR_PHONE` | production | printed into `/privacy`, `/terms` and emails (COPPA requires operator contact details); `SW_OPERATOR_EMAIL` is also every email's Reply-To and must be one bare address (`hello@your-domain`, no name) |
| `NODE_ENV` | production | `production` |
| `NPM_CONFIG_INCLUDE` | production (the build) | `dev`: with `NODE_ENV=production` npm leaves out devDependencies such as esbuild, which the build needs (`NPM_CONFIG_PRODUCTION=false` does nothing with npm 10) |
| `SW_TEST`, `STRIPE_API_BASE`, `MS_LOGIN_BASE`, `MS_GRAPH_BASE`, `SW_TEST_DATABASE_URL`, `SW_STRIPE_SHAPES` | tests/staging only | §12 (`MS_LOGIN_BASE` and `MS_GRAPH_BASE` point `microsoft` at the local fake, §12.3a) |

Refusal rules: accounts on without any required variable; `PUBLIC_ORIGIN` not https in production;
`SW_SECRET` shorter than 32 bytes; production with `MAIL_MODE` not `resend`/`postmark`/`microsoft`;
with `MAIL_MODE=microsoft`, a missing or malformed `MS_TENANT_ID`/`MS_CLIENT_ID` (GUIDs),
`MS_CLIENT_SECRET` (missing, shaped like a GUID, or with spaces) or a `MAIL_FROM` that is not one
address; `SW_TEST=1` with `NODE_ENV=production` or a `…_live_` Stripe key; `STRIPE_API_BASE`,
`MS_LOGIN_BASE` or `MS_GRAPH_BASE` in production;
`SW_STRIPE_SHAPES=1` with a live key; `SW_FRIENDS_MODE=free-join` with `SW_MP_CONSENT=verified`
(a free family can never pass card consent, §6.7); an `SW_FREE_PASS` entry that is not an email
address, has a date that is not a real day (or is after 2099-12-31), or lists an address twice, or
more than 20 entries (the line names the entry by its place, never the address); unknown values of
any enum. With accounts `off`
only `SW_ACCOUNTS` itself is checked (nothing else is read), so a stray variable can never stop
today's server.
The existing `SW_MAX_*`, `SW_TRUST_PROXY`, `SW_ALLOWED_ORIGINS` etc. are unchanged. With the cookie now
carried by the WebSocket, `SW_ALLOWED_ORIGINS` must never list another company's site.

---

## 3. Database

### 3.1 Conventions

- Postgres 16 (Railway), plain SQL, `gen_random_uuid()` ids, `timestamptz` times, JSON as `jsonb`,
  compressed blobs as `bytea` (gzip).
- **Time comes from the app clock.** Every time comparison passes `$now` from `ctx.clock.now()`
  (tests move it, §12.5); SQL `now()` is used only for `created_at`-style defaults.
- `db.mjs` returns `bigint` (int8) as `Number` (revs and epoch ms stay below 2^53) and `bytea` as
  `Buffer`, for both `pg` and PGlite.
- Pool: `max 10`, `connectionTimeoutMillis 5000`, `idleTimeoutMillis 30000`, `statement_timeout
  10000`. Railway's private network needs no TLS.

### 3.2 Migrations

- Files `server/migrations/NNN_name.sql`, applied in order at start by `migrate.mjs` inside
  `pg_advisory_lock(hashtext('sparkle-world:migrate'))`, each file in its own transaction, recorded
  in `schema_migrations(version int primary key, name text, applied_at timestamptz default now())`.
- **Expand only.** A release may add tables, nullable columns, columns with defaults and indexes.
  Dropping or renaming happens at least one release after no code reads it. Reason: Railway runs the
  old and the new deployment side by side for a moment (§13.3). A released migration file is never
  edited.
- Running the runner twice changes nothing (tested).

### 3.3 Schema: `server/migrations/001_init.sql`

```sql
-- Glimmer World accounts v1 (docs/ACCOUNTS.md §3). Expand-only; never edit after release.

create table families (
  id                  uuid primary key default gen_random_uuid(),
  email               text not null,                  -- the parent's; trimmed, NFC, lower-case
  created_at          timestamptz not null default now(),
  email_verified_at   timestamptz,                    -- first successful sign-in
  last_seen_at        timestamptz,                    -- bumped at most once a day (retention)
  notice_version      int,                            -- direct notice version agreed to
  consent_at          timestamptz,                    -- tier 1: email plus (§11.4)
  verified_at         timestamptz,                    -- tier 2: verified consent
  verified_method     text,                           -- 'card' | 'form' | 'call' | 'video'
  stripe_customer_id  text,
  trial_used          boolean not null default false,
  comp_until          timestamptz,                    -- free pass (admin CLI)
  country             text,                           -- billing country from Checkout
  lapsed_at           timestamptz,                    -- entitlement ended (retention clock)
  purge_after         timestamptz,                    -- kid data deleted after this
  kid_data_purged_at  timestamptz,
  flags               jsonb not null default '{}'::jsonb,  -- {dispute, warned30, warned7, refund_due, ...}
  constraint families_email_key unique (email),
  constraint families_customer_key unique (stripe_customer_id),
  constraint families_email_norm check (email = lower(btrim(email)) and char_length(email) between 3 and 254),
  constraint families_verified_method check (verified_method in ('card','form','call','video')),
  constraint families_country check (country ~ '^[A-Z]{2}$')
);
create index families_purge_idx on families (purge_after) where purge_after is not null;

create table players (
  id            uuid primary key default gen_random_uuid(),
  family_id     uuid not null references families(id) on delete cascade,
  nickname      text not null check (char_length(nickname) between 1 and 12),  -- src/net/names.js
  color         smallint not null default 0 check (color between 0 and 7),
  sort          smallint not null default 0,
  portrait      bytea check (portrait is null or octet_length(portrait) <= 32768),  -- PNG head
  portrait_rev  int not null default 0,
  friends_on    boolean not null default false,
  walkie_on     boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint walkie_needs_friends check (not walkie_on or friends_on)
);
create index players_family_idx on players (family_id);
create unique index players_nickname_idx on players (family_id, lower(nickname));

create table player_profiles (
  player_id          uuid primary key references players(id) on delete cascade,
  rev                bigint not null,
  client_updated_at  bigint not null,     -- profile.updatedAt (epoch ms)
  body               bytea not null,      -- gzip(profile JSON)
  size               int not null,        -- uncompressed bytes
  updated_at         timestamptz not null default now()
);

create table worlds (
  player_id          uuid not null references players(id) on delete cascade,
  world_id           text not null check (world_id ~ '^[A-Za-z0-9_.~-]{1,72}$'),  -- incl. .before/.undo/~fork
  rev                bigint not null,
  client_updated_at  bigint not null,     -- save.updatedAt
  meta               jsonb not null,      -- metaOf(save) without the thumbnail
  thumb              bytea,               -- the JPEG (≤ 72 KB)
  body               bytea,               -- gzip(save JSON incl. thumbnail); null = tombstone
  size               int not null default 0,   -- uncompressed bytes
  stored             int not null default 0,   -- octet_length(body), for quotas
  deleted_at         timestamptz,         -- tombstone: other devices learn about the delete
  updated_at         timestamptz not null default now(),
  primary key (player_id, world_id)
);

create table sessions (
  id_hash          bytea primary key,     -- sha256(cookie token); the token itself is never stored
  family_id        uuid not null references families(id) on delete cascade,
  kind             text not null check (kind in ('parent','device')),
  label            text check (char_length(label) <= 40),   -- "iPad · Safari" or the parent's name for it
  lock_player      uuid references players(id) on delete set null,
  created_at       timestamptz not null default now(),
  last_seen_at     timestamptz not null default now(),
  expires_at       timestamptz not null,
  idle_expires_at  timestamptz not null,
  elevated_until   timestamptz,           -- email check (or sign-in) + 15 min
  elevated_at      timestamptz,
  revoked_at       timestamptz
);
create index sessions_family_idx on sessions (family_id);
create index sessions_expiry_idx on sessions (expires_at);

create table gone_sessions (             -- sessions of deleted families: devices learn "family_gone"
  id_hash  bytea primary key,
  gone_at  timestamptz not null default now()
);

create table login_attempts (
  id_hash       bytea primary key,        -- sha256(attempt id); the id is in the __Host-sw_login cookie
  purpose       text not null check (purpose in ('signin','check')),
  email         text not null,
  email_key     bytea not null,           -- HMAC(k_email, email): rate counting
  family_id     uuid references families(id) on delete cascade,   -- 'check' only
  session_hash  bytea,                    -- 'check': the session to elevate
  link_hash     bytea unique,             -- sha256(link token); 'signin' only
  code_mac      bytea not null,           -- HMAC(k_code, attempt id || code)
  next          text,                     -- validated return path (§4.3)
  tries         smallint not null default 0,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null,
  used_at       timestamptz
);
create index login_attempts_email_idx on login_attempts (email_key, created_at);
create index login_attempts_expiry_idx on login_attempts (expires_at);

create table pair_codes (
  code_mac     bytea primary key,         -- HMAC(k_pair, normalized code)
  family_id    uuid not null references families(id) on delete cascade,
  label        text check (char_length(label) <= 40),
  lock_player  uuid references players(id) on delete cascade,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  used_at      timestamptz
);

create table subscriptions (               -- mirror of Stripe; a family may have several over time
  id                    text primary key,  -- sub_…
  family_id             uuid not null references families(id) on delete cascade,
  customer_id           text not null,
  status                text not null,     -- Stripe's value, verbatim
  price_id              text,
  started_at            timestamptz,       -- subscription.created
  trial_end             timestamptz,
  current_period_end    timestamptz,       -- items.data[0].current_period_end (dahlia)
  cancel_at_period_end  boolean not null default false,
  canceled_at           timestamptz,
  ended_at              timestamptz,
  first_failed_at       timestamptz,       -- first time seen past_due (grace starts)
  latest_paid_at        timestamptz,
  synced_at             timestamptz not null,   -- when we read it from Stripe (monotonic guard)
  updated_at            timestamptz not null default now()
);
create index subscriptions_family_idx on subscriptions (family_id);

create table stripe_events (
  id            text primary key,          -- evt_…
  type          text not null,
  created       bigint not null,
  received_at   timestamptz not null default now(),
  processed_at  timestamptz
);

create table outbox (
  id          bigserial primary key,
  family_id   uuid references families(id) on delete cascade,
  to_email    text not null,
  template    text not null,
  data        jsonb not null default '{}'::jsonb,   -- scrubbed to {} once sent (codes, links)
  send_after  timestamptz not null default now(),
  sent_at     timestamptz,
  tries       smallint not null default 0,
  last_error  text,                         -- error name only
  created_at  timestamptz not null default now()
);
create index outbox_due_idx on outbox (send_after) where sent_at is null;

create table audit_log (                   -- consent and parent actions; never personal data (§11.9)
  id         bigserial primary key,
  family_id  uuid not null,                -- no foreign key: kept 3 years after the family
  player_id  uuid,
  at         timestamptz not null default now(),
  actor      text not null check (actor in ('parent','system','stripe','admin')),
  action     text not null,
  detail     jsonb not null default '{}'::jsonb
);
create index audit_family_idx on audit_log (family_id, at);

create table deleted_families (
  family_id           uuid primary key,
  deleted_at          timestamptz not null default now(),
  stripe_customer_id  text,                -- until the Stripe customer is deleted too
  stripe_done_at      timestamptz
);
```

**`server/migrations/002_session_locked.sql`** (added after the review of the integrated build):

```sql
alter table sessions add column locked boolean not null default false;
update sessions set locked = true where lock_player is not null;
update worlds set meta = '{}'::jsonb where body is null;   -- tombstones keep no world content
```

`sessions.lock_player` is `on delete set null`, so "is this device locked" is kept apart from "to
which player": a device locked to a child who is deleted (or purged by retention) stays locked,
to nobody. `/api/me` lists no player for it, every `:pid` route answers 404 (her own ones 410
`player_gone`, so the device wipes her copy) and the relay 4405, until the parent picks who plays
on the Family page (choosing "Anyone in the family" unlocks it). Every check is the one test
`lockedAway(s, pid)`: `(locked or lock_player) and lock_player <> pid` (the `or` covers a row
written by an older deployment during a deploy).

**`server/migrations/003_free_pass.sql`** (`SW_FREE_PASS`, §6.9):

```sql
alter table families add column comp_source text;      -- null: the admin's pass; 'config': SW_FREE_PASS's
alter table families add constraint families_comp_source check (comp_source in ('config'));
alter table families drop constraint families_verified_method,
  add constraint families_verified_method check (verified_method in ('card','form','call','video','operator'));
alter table audit_log drop constraint audit_log_actor_check,
  add constraint audit_log_actor_check check (actor in ('parent','system','stripe','admin','config'));
```

Replacing a check constraint by a wider one of the same name, in one statement, is the one drop
the expand-only rule (§3.2) allows: every value the old code writes is still allowed, so an old
deployment running side by side keeps working (the test that checks migrations knows this case).

Limits enforced in code: ≤ 6 players per family; ≤ 3 live pair codes per family; ≤ 60 live worlds
per player (side copies count, tombstones do not); stored gzip ≤ 100 MB per player and ≤ 300 MB per
family; profile ≤ 256 KB; portrait ≤ 32 KB PNG. Before release, `tools/test-saves.mjs --measure`
prints real save sizes from the probes' worlds; keep caps at 4× the largest seen or more.

### 3.4 Deletion cascades

- **Delete a family** (parent, or admin): (1) Stripe first: cancel every non-terminal subscription
  (`subscriptions.cancel(id, {invoice_now: false, prorate: false})`), then `customers.del(customer)`;
  a Stripe failure does not block step 2, it is retried by the retention job from
  `deleted_families.stripe_customer_id`. (2) One transaction: copy the family's session hashes into
  `gone_sessions`; insert `deleted_families`; `delete from families` (cascades to players →
  profiles, worlds; sessions; login attempts; pair codes; subscriptions; outbox) and the sign-in
  attempts for that email; audit `family.deleted`. (3) Close the family's sockets (4401), clear the cookie, enqueue the
  `account_deleted` email (`family_id` null, address captured before step 2), log
  `deletion-journal family=<uuid>` (no email).
  Before `customers.del` the customer gets the metadata `sw_family_deleted: '1'`, so its
  `customer.deleted` event says the deletion was ours.
- **Delete a player:** delete the row (cascades to profile and worlds), audit, close her sockets
  (4405), drop the cached sessions of devices locked to her (they stay locked, to nobody, §3.3),
  log `deletion-journal player=<uuid>`. Devices then get `410 player_gone` and wipe that player's
  local copy (§7.2).
- **Delete a world** (in the game): a tombstone (§5.4) and `deletion-journal world=<player
  uuid>/<world id>` (ids only).
- **Restore from a backup** re-creates deleted families, players and worlds. The runbook (§13.4)
  re-applies deletions from two journals that live outside the database: Stripe's
  `customer.deleted` events that carry our mark (Stripe keeps 30 days of events; a customer
  deleted by hand in the Dashboard only unlinks its family, §6.4, and is never re-applied) and the
  `deletion-journal` log lines (`family=`, `player=`, `world=`).

### 3.5 Retention (the written policy; `jobs.mjs` enforces it hourly)

| Data | Kept | Then |
|---|---|---|
| Sign-in / check attempts, pair codes | until 24 h after they expire | deleted |
| Parent sessions | 30 days from sign-in, or 14 days unused | deleted 7 days after expiry |
| Device sessions | 180 days after last use | deleted 7 days after expiry |
| `gone_sessions` | 180 days | deleted |
| A family that never agreed to the notice | 14 days after sign-up | deleted (the notice says so) |
| A family that agreed but never had a plan or free pass (and no players) | 30 days | deleted |
| Kid data (players, profiles, worlds, portraits) after the plan ends | `SW_RETAIN_DAYS` (90) after `lapsed_at`; emails 30 and 7 days before; after every lapse (a comeback and a new lapse start the clock, the warnings and the purge again) | deleted; family row kept |
| The family row (email, Stripe id, consent dates) after the plan ends | 12 months after `lapsed_at` | deleted with its Stripe customer |
| A paying family with no sign-in and no play for 24 months | kept | one email offering deletion; never deleted while paying |
| World tombstones (no content: no body, picture or `meta`) | 30 days | deleted |
| `stripe_events` | 30 days | deleted |
| Outbox | sent: 7 days (secret data scrubbed at send); failed: 30 days | deleted |
| Audit log (no personal data) | 3 years (proof of consent; a choice, not a legal requirement) | deleted |
| `deleted_families` | 35 days | deleted |
| Walkie audio | never stored | — |
| Server logs | Railway's log retention; never emails, tokens, codes, nicknames, world names, IPs | — |
| Database backups | Railway's schedule, keep ≤ 7 days | roll off |
| Requested deletion | immediately (families, players, worlds) | backups roll off within 7 days |

---

## 4. Sign-in, sessions and devices

### 4.1 Principles

Parents sign in with email; kids never type an email. Everything secret is random (32 bytes from
`crypto.randomBytes`), single use where it can be, stored only as a hash, and compared in constant
time. A GET never changes anything.

### 4.2 Cookies

| Cookie | Holds | Attributes |
|---|---|---|
| `__Host-sw_sess` | session token (parent or device) | `Secure; HttpOnly; SameSite=Lax; Path=/`; `Max-Age` = the session's remaining life |
| `__Host-sw_login` | sign-in / check attempt id | same, `Max-Age=900` |

- Over `http://localhost` the names are `sw_sess` / `sw_login` without `Secure` (derived from
  `PUBLIC_ORIGIN`, §2).
- `SameSite=Lax`, not `Strict`: the return from Stripe is a navigation from another site.
- A new token is issued on sign-in and on a kind change (no session fixation); a device session's
  `expires_at` slides forward at most once a day without a new token.
- The same-origin WebSocket handshake carries the cookie; cross-site pages cannot (Lax, plus the
  relay's existing `originOk()` check).

### 4.3 Parent sign-in (sign-in and sign-up are one flow)

1. `POST /api/auth/start {email, next?}`: normalize (trim, NFC, lower-case; ≤ 254 chars; simple
   `local@domain.tld` shape). Always the same answer, `202 {ok:true}`, with the same work done
   whether or not a family exists: count recent attempts, insert a `login_attempts` row (attempt id →
   cookie; link token → `link_hash`; 6-digit code from `crypto.randomInt` → `code_mac`; 15 minutes),
   mark older unused attempts for this email used (only the 3 newest stay valid), enqueue a
   `signin` email, set `__Host-sw_login`. The outbox worker chooses the "welcome" or the "sign in"
   wording after the response, so timing does not reveal whether the account exists. **No family row
   is created here**, so typing a stranger's email creates nothing.
2. **Code** (primary): `POST /api/auth/verify {code}` needs the `__Host-sw_login` cookie, so a code
   works only in the browser that asked (the parent can read the email on her phone and type the code
   into the iPad app that asked). 5 wrong tries kill the attempt: `400 {error:'bad_code', triesLeft}`,
   then `410 {error:'expired'}`. The input uses `autocomplete="one-time-code"` and `inputmode="numeric"`.
3. **Link** (convenience): `https://<origin>/account/verify#t=<token>`. The token is in the fragment,
   so it never reaches server logs or a Referer. The page first asks `POST /api/auth/verify
   {token, peek: true}` (uses nothing) → `{email: 'b•••@gmail.com', replacing}` and shows "Sign in
   to Glimmer World?" with "You are signing in as b•••@gmail.com" and a button that POSTs
   `{token}`. `replacing` is true when this browser holds a live session of **another** family
   (a kid's device, say): signing in would sign it out of that family, so the page says so, asks
   the grown-up check (a times-table question) and sends `{token, replace: true}`; without
   `replace` the server answers `409 {error:'conflict', replacing:true}` and the link stays good
   (login CSRF: a stranger's link opened on a kid's device never quietly takes it over). Opening
   the link (email scanners prefetch links) consumes nothing. The link works in any browser.
4. On success, in one transaction: `update login_attempts set used_at=$now where id_hash=$1 and
   used_at is null and expires_at > $now returning …` (single use even under a race); find or create
   the family (`insert … on conflict (email) do nothing`, then select); set `email_verified_at`; revoke
   the browser's old session if any; create a **parent** session (30 days absolute, 14 days idle) with
   `elevated_until = now + 15 min`; clear `__Host-sw_login`; answer `{next}`.
5. `next` must match `^/(account|play)(\?[A-Za-z0-9=&%_-]{0,200})?$`, otherwise `/account`.

### 4.4 The email check (step-up)

Sensitive actions need `elevated_until > now` (sign-in counts for 15 minutes):
turning **Play with friends** or the **walkie-talkie** on; deleting a player; downloads (per player,
per family); making a pair code; starting a plan (**Checkout**: a child on a device that kept a
grown-up's session never reaches Stripe's page, §7.9); the Stripe Portal (card, invoices, Resume:
it shows the parent's billing details); **Start now**. Signing out, here or everywhere, never needs a
check: it only protects the family.
Deleting the family needs a check done **within the last 5 minutes** (`elevated_at`).
Turning a switch off, renaming, adding a player, removing a device, signing out and **Cancel the
plan** (§6.3) need no check: cancelling is never harder than starting (California's ARL and
similar laws).

`POST /api/auth/check` (parent session) emails a 6-digit code (a `login_attempts` row with purpose
`check`, the session's hash, the attempt cookie); `POST /api/auth/verify {code}` then sets
`elevated_until = now + 15 min` and `elevated_at = now` on that session. 5 per hour per family.
Passkeys (Face ID) and a grown-up PIN are phase 2 (§16).

### 4.5 Kid devices

- **Pair code:** the Family page's **Set up a kid's device** (email check) calls
  `POST /api/devices/pair-code {label?, lockPlayer?}` → `{code: "K7QM-2XFD", expiresAt}`: 8 symbols of
  Crockford base32 (no I, L, O, U; input is case-insensitive and reads O as 0, I and L as 1; the dash
  is optional), about 40 bits, 10 minutes, single use, at most 3 live per family. On the kid's device:
  game → **Grown-ups** → **I have a code** (no grown-up check: the code from the Family page is the
  grown-up's OK) → `POST /api/auth/pair {code}` → a
  **device** session (180 days after last use) with the code's label and locked player. 10 tries per
  10 minutes per address, 200 per hour overall.
- **Kids play on this device:** a parent signed in on the kid's device taps it on the Family page (or
  in the game's grown-up card): `POST /api/devices/this {label?, lockPlayer?}` swaps the parent session
  for a device session (new token). The Family page on that browser then asks to sign in again.
- A **device** session may use: `GET /api/me`, the saves and portrait routes of its family's players
  (only the locked player if set), the WebSocket, `POST /api/auth/logout`. Never `/api/family*`,
  `/api/billing/*`, `/api/devices*`.
- "Who's playing?" has no kid PIN: the kids are 7–8 and siblings. A device can be locked to one player;
  it stays locked when that player is deleted (to nobody, `sessions.locked`, §3.3).
- Labels: a coarse name made once from the User-Agent at creation (`iPad · Safari`, `Mac · Chrome`,
  …; the User-Agent itself is not stored); the parent can rename it.

### 4.6 Sessions: lifetimes and revocation

A session is valid when `revoked_at is null and expires_at > now and idle_expires_at > now`.
`last_seen_at`/`idle_expires_at` are bumped at most once an hour. Lookups go through a 60-second
in-memory cache keyed by the token hash (single replica); revocation clears it. The Family page lists
sessions (`GET /api/devices`) with **Sign out** per device and **Sign out everywhere**; revoking closes
that session's sockets with 4401 at once.

### 4.7 CSRF and headers

- Every state-changing `/api/*` request (anything but GET/HEAD) must: carry `X-SW: 1` (a cross-site
  page cannot send it without a CORS preflight, and the server never answers CORS); have `Origin`
  equal to `PUBLIC_ORIGIN`; have `Content-Type: application/json` (the world PUT may add
  `Content-Encoding: gzip`); and, when `Sec-Fetch-Site` is present, have it `same-origin`.
  Violations answer `403 {error:'forbidden'}` / `415`. Only `POST /api/stripe/webhook` is exempt (it
  is verified by signature).
- API answers: `Cache-Control: no-store`, `Content-Type: application/json; charset=utf-8`, the
  existing `securityHeaders()`, plus `Cross-Origin-Resource-Policy: same-origin`.
- All answers when `PUBLIC_ORIGIN` is https: `Strict-Transport-Security: max-age=31536000`.
- Account pages use the existing `SITE_CSP` (`script-src 'self'; connect-src 'self'; form-action
  'none'; frame-ancestors 'none'`), plus `Cross-Origin-Opener-Policy: same-origin`. They never submit
  forms; Stripe URLs are fetched as `{url}` and opened with `location.assign(url)`.

### 4.8 Rate limits and abuse

In-memory `KeyedLimiter` (token buckets from `server/limits.mjs`, keyed by `addressKey(ip)` (IPv6 by
/64), `netKey(ip)` (IPv6 by /48, IPv4 as is), `email_key`, family id or player id; idle buckets
forgotten). All answer `429 {error:'rate'}` with `Retry-After`. A route's limits are checked in
order (per address, per network, then for everyone), **before its body is read**, together with
who may call (§5.1): a refused request never has its body read, inflated or parsed, and one home's
allocation (a /56 holds 256 /64s) runs into its own network's limit long before it could use up
the limit for everyone. When a limit for everyone is used up, the log says so (one line, never
who). `email_key` is `HMAC(k_email, the mailbox)`: `name+tag@` counts as `name@`, and at Gmail dots
do not count.

| What | Limit |
|---|---|
| `POST /api/auth/start` | per email (mailbox): 3 / 15 min and 10 / day (counted in `login_attempts`, survives restarts); per address 10 / hour (burst 5); per network 20 / hour (burst 10); all 1000 / hour |
| `POST /api/auth/verify` | 5 tries per attempt; per email 10 wrong codes a day over all its attempts (sign-in and email check; after that codes for that email are `410 expired` until the day has passed, while the link keeps working); per address 30 / hour |
| `POST /api/auth/check` | per family 5 / hour |
| `POST /api/auth/pair` | per address 10 / 10 min; per network 20 / 10 min; all 1000 / hour (a code is about 40 bits and lives 10 minutes: with 30 codes waiting at any time, 24,000 guesses a day would need about 1.5 million days, on average, to hit one) |
| `POST /api/devices/pair-code` | per family 10 / hour |
| `POST /api/billing/checkout` | per family 5 / hour; per address 20 / hour; one open Checkout Session per family at a time (reused while < 30 min old) |
| other billing routes | per family 20 / hour |
| world and profile PUT | per player 12 / min (burst 20) |
| exports | per family 5 / hour |
| everything else under `/api` | per address 120 / min (burst 60); per session 240 / min |
| request bodies | read only after who may call and the limits (§5.1); JSON 16 KB (world PUT: `SW_WORLD_MAX_BYTES` after decompression, inflated with the asynchronous `gunzip`, off the event loop the relay shares; profile 256 KB; webhook 1 MB raw) → `413` without reading further (`Connection: close`) |

Abuse covered: email enumeration (identical answers, nothing created at start), link prefetching
(POST to consume), code guessing (bound to the attempt cookie, 5 tries, 10 wrong a day per email),
login CSRF (the link page says whose sign-in it is and replaces another family's session only when
asked, §4.3), email bombing (per-mailbox, per-network and global limits), card testing (only a signed-in parent with a verified email and agreed notice can make
a Checkout Session, rate limits, hosted Checkout with Stripe's own bot and Radar protections, no card
form of ours anywhere), IDOR (every `:pid` is checked against the session's family and answers `404`
when it is not hers), gzip bombs (`maxOutputLength`), trial abuse (one trial per family; the same
card under a new email is an accepted risk, §18).

---

## 5. API

### 5.1 Conventions

JSON in and out. Errors are `{error: '<code>', …}` with one of: `bad_request`, `bad_email`,
`bad_code`, `expired`, `rate`, `forbidden`, `signed_out` (401), `check_required` (403),
`consent_required`, `needs_verified`, `not_entitled` (403), `not_found`, `player_gone` (410),
`family_gone` (410), `conflict` (409), `deleted` (410), `too_big` / `quota` (413), `limit`,
`nickname_taken`, `nickname_blocked`, `already_subscribed` (409), `us_only`, `stripe_unavailable`
(502), `unavailable` (503). The page never shows a code to a child (§7.7).

Who may call is checked, with the route's limits, before the body is read (§4.8).
Who may call (the "Who" column): **anyone**; **session** (parent or device); **parent**;
**parent+check** (email check within 15 min); **parent+check5** (within 5 min); **player** (any
session of the family that owns `:pid`, and the device's locked player if set); **stripe**
(signature); **test** (only with `SW_TEST=1`).

### 5.2 Routes

| Method, path | Who | Body → answer | Owner |
|---|---|---|---|
| `GET /api/net` | anyone | `{ok, version, build, accounts?, friendsMode?}` (existing + 2 fields) | D |
| `GET /healthz` | anyone | `{ok}`; with accounts: `select 1` (2 s) and migrations applied, else 503 | D |
| `GET /api/me` | anyone | §5.3 | A |
| `GET /api/notice` | anyone | `{version, sections:[{title, text}], checkbox}` from `notice.mjs` | A (data: B) |
| `POST /api/auth/start` | anyone | `{email, next?}` → `202 {ok:true}` | A |
| `POST /api/auth/verify` | anyone | `{code}` or `{token, replace?}` → `{next}` (sign-in) or `{elevatedUntil}` (check); `{token, peek: true}` → `{email (masked), replacing}`, uses nothing; a link in a browser signed in to another family without `replace` → `409 {error:'conflict', replacing:true}` (§4.3) | A |
| `POST /api/auth/check` | parent | → `202 {ok:true}` | A |
| `POST /api/auth/logout` | session | → `{ok}` | A |
| `POST /api/auth/logout-all` | parent | → `{ok}` (every session of the family) | A |
| `POST /api/auth/pair` | anyone | `{code}` → `{ok}` + device cookie | A |
| `POST /api/devices/pair-code` | parent+check | `{label?, lockPlayer?}` → `{code, expiresAt}` | A |
| `POST /api/devices/this` | parent | `{label?, lockPlayer?}` → `{ok}` (becomes a device session) | A |
| `GET /api/devices` | parent | → `[{id (8 hex), kind, label, lastSeen (date), current, lockPlayer, locked}]` (`locked` with `lockPlayer` null: locked to a deleted child, §3.3) | A |
| `PATCH /api/devices/:id` | parent | `{label?, lockPlayer?}` → device (`lockPlayer` a player locks it, `null` unlocks it) | A |
| `DELETE /api/devices/:id` | parent | → `{ok}` (revoked, sockets closed) | A |
| `GET /api/family` | parent | `{email, createdAt, elevatedUntil, elevatedAt, consent:{level, noticeVersion, consentAt, verifiedAt, method}, plan (§6.5), purgeAfter, players:[{id, nickname, color, sort, portrait, friends, walkie, createdAt, worlds, lastPlayed}], config:{friendsMode, mpConsent, trialDays, priceText, noticeVersion, noticeMinVersion, operatorEmail}}` (times in epoch ms) | A |
| `GET /api/family/audit` | parent | → consent history `[{at, action, player?}]` | A |
| `POST /api/consent` | parent | `{noticeVersion, agree:true}` → `{consent}` | A |
| `POST /api/players` | parent | `{nickname, color?}` → `201 player` (needs consent to a notice ≥ `NOTICE_MIN_VERSION`, else `403 consent_required`; and entitled, or `free-join`) | A |
| `PATCH /api/players/:pid` | parent (+check to switch on) | `{nickname?, color?, sort?, friends?, walkie?, notice?}` → player. Switching on also needs consent to a notice ≥ `NOTICE_MIN_VERSION` (`403 consent_required`); `friends.on`/`walkie.on` record the server's notice version, and a `notice` other than it → `409 conflict {noticeVersion}` | A |
| `DELETE /api/players/:pid` | parent+check | `{confirm: <nickname>}` → `{ok}` | A |
| `GET /api/players/:pid/summary` | parent | `{nickname, createdAt, friends, walkie, profile:{stickers, coins, stats}, worlds:[{id, name, biome, sizeName, updatedAt, size, thumb}]}` | A |
| `GET /api/players/:pid/export` | parent+check | attachment: `{format:'sparkle-world-player', v:1, player, profile, worlds:[{format:'sparkle-world', v:1, save}]}` | A |
| `GET /api/family/export` | parent+check | attachment `glimmer-world-family-<date>.json`: family, consent history, every player export (streamed, one world at a time) | A |
| `POST /api/family/delete` | parent+check5 | `{confirm:'DELETE'}` → `{ok}`, signed out (§3.4) | A |
| `GET /api/players/:pid/profile` | player | → `200 profile` + `ETag: "r<rev>"`, or `204` | C |
| `PUT /api/players/:pid/profile` | player (entitled) | profile JSON + `If-Match` → `{rev}` \| 409 \| 403 | C |
| `GET /api/players/:pid/worlds` | player | → `[{…meta, rev, thumbnail: url\|null}]` + tombstones `{id, deleted:true, updatedAt, rev}` | C |
| `GET /api/players/:pid/worlds/:wid` | player | → the save JSON (gzip when accepted) + `ETag` | C |
| `GET /api/players/:pid/worlds/:wid/thumb` | player | → `image/jpeg`, `Cache-Control: private, max-age=86400` (URL has `?v=<rev>`) | C |
| `PUT /api/players/:pid/worlds/:wid` | player (entitled) | save JSON (gzip optional) + `If-Match` → `{rev}` \| 409 \| 410 \| 413 \| 403 | C |
| `DELETE /api/players/:pid/worlds/:wid` | player (entitled) | → `{rev}` (a tombstone; no `If-Match` needed) | C |
| `PUT /api/players/:pid/portrait` | player | `{png: 'data:image/png;base64,…'}` (≤ 32 KB, PNG signature checked) → `{rev}` | C |
| `GET /api/players/:pid/portrait` | player | → `image/png` (URL has `?v=<portrait_rev>`) | C |
| `POST /api/billing/checkout` | parent+check (+consent) | `{trial: bool, usResident: true}` → `{url}` \| `409 already_subscribed` | B |
| `POST /api/billing/sync` | parent | `{sessionId?}` → `{plan}` | B |
| `POST /api/billing/portal` | parent+check | → `{url}` | B |
| `POST /api/billing/cancel` | parent | → `{plan}` (the live plan ends at the period end; `409 conflict` when there is none) | B |
| `POST /api/billing/start-now` | parent+check | → `{plan}` (trialing only) | B |
| `POST /api/stripe/webhook` | stripe | raw body → `200 {received:true}` \| 400 \| 500 | B |
| `GET /api/test/mail?to=` | test | → captured emails `[{template, to, subject, text, at}]` | A |
| `POST /api/test/clock` | test | `{offsetMs}` (absolute) or `{advanceMs}` → app clock moved | A |
| `POST /api/test/jobs` | test | `{name}` → runs a job now | A |
| `POST /api/test/reset` | test | truncates every table | A |
| `POST /api/test/limits` | test | `{off: true\|false}` → rate limits off, or fresh and on (a server in its own process) | A |
| WS `/r/<room>?s=&d=&p=<player>` | session (§8) | the existing relay | D |

`server.mjs` keeps answering 405 for non-GET methods outside `/api/*`.

### 5.3 `GET /api/me` (the game's boot call)

```js
// signed out:
{ signedIn: false, accounts: 'optional' | 'required' }
// signed in (never includes the parent's email):
{ signedIn: true, kind: 'parent' | 'device', accounts, friendsMode,
  plan: { state, entitled, until },            // state: §6.5 (for grown-up small print only)
  consent: 'none' | 'email_plus' | 'verified',
  players: [{ id, nickname, color, portrait,   // portrait: '/api/players/<id>/portrait?v=3' | null
              friends, walkie,                 // the parent's switches
              canJoin, canHost, walkieOk,      // what the relay will allow now
              why }],                          // null | 'not_entitled' | 'friends_locked' | 'friends_off'
  lockPlayer: id | null,
  locked: boolean,                              // true with lockPlayer null: locked to a deleted child, players: []
  playUntil: ms }                               // min(entitlement until, now + 7 days): offline boot limit
// the family was deleted:            410 {error:'family_gone'}  (session hash found in gone_sessions)
// a revoked or expired session:      401 {error:'signed_out'}
```

### 5.4 The saves protocol (server side of §7.3)

- **Revisions.** Each row has `rev` (starts at 1, +1 per accepted write or delete), sent as
  `ETag: "r<rev>"`. Every write carries `If-Match: "r<rev>"` (the revision this copy descends from) or
  `If-Match: *` (create). No `If-Match` → `428`.
- **World PUT**, in one transaction with `select … for update`:
  - no row, or a tombstone: `*` or any `If-Match` → store (a tombstone is resurrected only when the
    incoming `updatedAt` is newer than `deleted_at`, else `410 {error:'deleted'}`);
  - a row and `If-Match` equals its rev → store, rev + 1;
  - a row, `If-Match` differs (or is `*`): if the incoming `updatedAt` equals the stored one → `200`
    with the current rev (the same save again); else `409 {error:'conflict', rev, updatedAt}`;
  - side copies (`<id>.before`, `<id>.undo`): newest `updatedAt` wins, no conflicts.
- **Validation.** Body ≤ `SW_WORLD_MAX_BYTES` after `zlib.gunzip(buf, {maxOutputLength})` (asynchronous, and only for a caller who may write there, §4.8);
  JSON object with `id === :wid`, string `name` ≤ 80, string `blocks`, `size` `{x,y,z}` within
  `WORLD_SIZES` bounds, finite `updatedAt`, `thumbnail` null or `data:image/jpeg;base64,…` ≤ 96 KB.
  Stored: `body = gzip(JSON as received)`, `thumb` = the decoded JPEG, `meta = metaOf(save)` minus
  the thumbnail. The server imports `metaOf` from `src/core/storage.js`, `WORLD_SIZES` from
  `src/world/world.js` and `sanitizeName` from `src/net/names.js` (all three load cleanly in Node,
  like `src/net/walkie/wire.js` already does), so page and server can never disagree.
- **Quotas** (§3.3) → `413 {error:'quota'}`. **Writes** need the family entitled (or within grace) →
  otherwise `403 {error:'not_entitled'}`. **Reads** work while the player exists (the retention
  window), so a lapsed kid still sees her worlds and the parent can download them.
- **Profile PUT** follows the same `If-Match` rules (no side copies); the client merges on 409 (§7.4).
- **Delete** writes a tombstone (`body`, `thumb` null, `meta` `{}`, `deleted_at`, rev + 1: no
  world content, not even its name) and a `deletion-journal world=` line (§3.4). A deleted player
  answers `410 {error:'player_gone'}` on every route.

---

## 6. Billing (Stripe)

### 6.1 Stripe objects (the family creates them; §14 step 4)

- Product **Glimmer World Membership** (portal headline the same), tax code chosen in the Stripe Tax settings for a personal-use
  online game or digital subscription (the exact code to be confirmed there, with an accountant).
- One Price: `unit_amount 599`, `currency usd`, `recurring.interval month`, `tax_behavior exclusive`
  ("$5.99 a month, plus sales tax where it applies"; §17 asks the family), `lookup_key
  sparkle_family_monthly`. No other prices, no coupons.
- Customer Portal: update payment method, invoice history, cancel **at period end** with the reason
  survey; no plan switching, no quantity, no customer email editing (sign-in email and receipts
  stay one address).
- `tools/stripe-setup.mjs` creates the product, price and a portal configuration idempotently (by
  lookup key / metadata) and prints `STRIPE_PRICE_ID` and `STRIPE_PORTAL_CONFIG`. It needs a full
  secret key once (the running server only ever gets the restricted key).
- The SDK client (`server/stripe.mjs`): `new Stripe(key, {apiVersion: '2026-08-26.dahlia',
  maxNetworkRetries: 2, timeout: 10000})`, plus `{host, port, protocol}` from `STRIPE_API_BASE` in tests
  (the SDK takes these in the client configuration). The webhook endpoint uses the same API version.

### 6.2 Checkout (`POST /api/billing/checkout`)

Requires a parent session with a fresh email check (a sign-in counts for 15 minutes, so the
first-time flow asks for no second code), `consent_at`, the `usResident` checkbox, and no non-terminal subscription
(else `409 already_subscribed` and the page offers the Portal). Creates the customer once
(`customers.create({email, metadata:{family_id}}, {idempotencyKey:'cust-'+family_id})`; never any
child data), then:

```js
stripe.checkout.sessions.create({
  mode: 'subscription', customer, client_reference_id: family.id,
  line_items: [{ price: STRIPE_PRICE_ID, quantity: 1 }],
  subscription_data: { metadata: { family_id: family.id },
                       ...(trial && !family.trial_used && TRIAL_DAYS > 0 ? { trial_period_days: TRIAL_DAYS } : {}) },
  payment_method_collection: 'always',            // card up front, even for the trial
  payment_method_types: ['card'],                 // cards; Apple Pay / Google Pay are card wallets
  automatic_tax: { enabled: true },
  customer_update: { address: 'auto', name: 'auto' },
  billing_address_collection: 'required',
  consent_collection: { terms_of_service: 'required' },   // Terms URL set in the Dashboard
  custom_text: { terms_of_service_acceptance: { message: '<the auto-renewal sentence, §11.10>' } },
  allow_promotion_codes: false, locale: 'en',
  expires_at: nowSeconds + 35 * 60,               // Stripe's minimum is 30 min after its own clock
  success_url: PUBLIC_ORIGIN + '/account?checkout={CHECKOUT_SESSION_ID}',
  cancel_url:  PUBLIC_ORIGIN + '/account?checkout=cancel',
}, { idempotencyKey: `co-${family.id}-${nonce}` })
```

Answers `{url}`; the page calls `location.assign(url)`. The plan card offers the trial ("Start your
free week") and, as a second choice, **Start today** (no trial: the first payment happens now, which
unlocks friends and the walkie at once, §6.7).

### 6.3 Coming back, the Portal, Start now

- **Sync:** `/account?checkout=cs_…` calls `POST /api/billing/sync {sessionId}` → retrieve the session
  (`expand: ['subscription']`), check `client_reference_id === family.id`, then run the same upsert as
  the webhook (§6.4). The parent sees "You're all set!" even if the webhook is late. Without
  `sessionId` (back from the Portal) it syncs `subscriptions.list({customer, status:'all', limit:3})`.
- **Portal:** `billingPortal.sessions.create({customer, return_url: PUBLIC_ORIGIN + '/account?portal=1',
  configuration: STRIPE_PORTAL_CONFIG})` → `{url}`. Cancellation is at period end: the plan shows
  "Ends Nov 5" with a **Resume** link (the Portal) until then.
- **Cancel the plan** (`POST /api/billing/cancel`, a parent session, no email check): the live
  subscription (trialing, active or past due) gets `subscriptions.update(id,
  {cancel_at_period_end: true})`, the mirror is updated at once (the webhook follows). On the
  Family page it is two taps (**Cancel the plan**, **Yes, cancel it**), while starting a plan
  needs the email check: cancelling is never harder than starting.
- **Start now** (trialing only): `subscriptions.update(id, {trial_end: 'now'})`; Stripe invoices and
  charges at once. The handler then retrieves the subscription with `latest_invoice` and applies the
  same `invoice.paid` logic if it is paid, so friends unlock without waiting for the webhook.

### 6.4 Webhooks (`POST /api/stripe/webhook`)

1. Read the **raw** body (≤ 1 MB) before any parsing; `stripe.webhooks.constructEvent(raw,
   req.headers['stripe-signature'], STRIPE_WEBHOOK_SECRET)` with the default 300 s tolerance. Failure
   → `400 {error:'bad_signature'}`, a counter, nothing else logged.
2. If `stripe_events` already has this id with `processed_at` → `200`.
3. Fetch what the event needs from Stripe **outside** the transaction (for any subscription-bearing
   event: `subscriptions.retrieve(id)`), because the payload's order is not trusted.
4. One transaction: `insert into stripe_events … on conflict do nothing` (0 rows → already handled →
   commit, `200`); apply the effect; `update stripe_events set processed_at`. Emails are enqueued in
   the same transaction, so they go exactly once.
5. After commit: `billing.invalidate(familyId)` and the `family` event (live sockets, §8.4).
6. Any error → rollback → `500`; Stripe retries with backoff for up to about 3 days.

The subscription upsert writes only when `excluded.synced_at >= subscriptions.synced_at`, so two
handlers racing cannot put an older read on top of a newer one. The family is found from
`subscription.metadata.family_id`, else `client_reference_id`, else `stripe_customer_id`.

| Event | Effect |
|---|---|
| `checkout.session.completed` | link `stripe_customer_id`; upsert the subscription; `trial_used = true` if it has a trial; store `country` from `customer_details.address.country`; if the country is not in `SW_SELL_COUNTRIES`: cancel the subscription at once, email `us_only`, and if an invoice was already paid (no trial) set `flags.refund_due` for the dad (daily summary + admin `show`) |
| `customer.subscription.created` / `updated` / `deleted` | upsert; `first_failed_at` set the first time status is `past_due`, cleared when `active`; if a family ends up with two non-terminal subscriptions, cancel the newer one and flag it |
| `invoice.paid` | subscription id = `invoice.parent?.subscription_details?.subscription ?? invoice.subscription`; upsert; `latest_paid_at`; **if `amount_paid > 0` and `verified_at` is null: `verified_at = now`, `verified_method = 'card'`, audit `consent.verified {method:'card', invoice}`, email `friends_ready`.** The trial's $0 invoice also sends `invoice.paid` and must not count |
| `invoice.payment_failed` | upsert (status becomes `past_due`); Stripe's own failed-payment email tells the parent |
| `charge.dispute.created` | `flags.dispute = true` (daily summary); entitlement unchanged. The family is found through the disputed charge's customer (`charges.retrieve`, hence **Charges read** on the key, §14 step 4); without it the dispute is still counted and Stripe emails the dad anyway |
| `customer.deleted` | clear `stripe_customer_id` (a customer deleted by hand in the Dashboard); our own family delete marks the customer `sw_family_deleted` first (§3.4), which only the restore runbook reads |
| anything else | `200`, ignored |

Current-period dates come from `sub.items.data[0].current_period_end` (the pinned API version keeps
them on the item); the code falls back to the top-level field only defensively.

### 6.5 Entitlement (`server/entitlement.mjs`, a pure function)

```js
entitlementOf({ family, subs, now, cfg }) → {
  state: 'none' | 'trialing' | 'active' | 'canceling' | 'past_due' | 'comp' | 'lapsed',
  entitled: boolean, until: ms | null,
  trialEnd, periodEnd, graceUntil, cancelAtPeriodEnd,
  subState,                    // the subscription's own state while it is good (also under a free pass), else null
  consent: 'none' | 'email_plus' | 'verified',
  friendsConsentOk: boolean,   // cfg.mpConsent === 'email_plus' ? consent !== 'none' : consent === 'verified'
  walkieConsentOk: boolean,    // consent === 'verified' (always)
}
```

The subscription that counts: the non-terminal one (`trialing`, `active`, `past_due`) with the
latest period end; else the most recently synced.

| Stripe status | Entitled while | `state` | `until` |
|---|---|---|---|
| (any) and `comp_until > now` | always | `comp` | `comp_until` (the plan's `until` when that is later) |
| `trialing` | `now < trial_end + 1 day` | `trialing` | `trial_end + 1 d` |
| `active`, not cancelling | `now < period_end + 3 days` (renewal webhook lag) | `active` | `period_end + 3 d` |
| `active`, `cancel_at_period_end` | `now < period_end + 1 hour` | `canceling` | `period_end` |
| `past_due` | `now < first_failed_at + SW_GRACE_DAYS` | `past_due` | `first_failed_at + grace` |
| `incomplete` | never | `none` (`lapsed` when an earlier plan or pass ended) | — |
| `unpaid`, `canceled`, `incomplete_expired`, `paused`, or any row past its `until` | never | `lapsed` (had a plan) or `none` | — |

"Had a plan": an ended free pass, a `lapsed_at`, or any subscription that got past `incomplete` /
`incomplete_expired`. A missing date on a live subscription (it should not happen) falls back to the
other date, then to a day after `synced_at`. The slack days only cover late webhooks; the reconcile
job (§6.6) corrects the real state. Callers
use `billing.entitlementFor(familyId)` (60-second cache, invalidated by webhooks, sync and admin).
Tested as a table over every status × time position × comp × consent (§12.6).

### 6.6 Reconcile and lapse

- **Reconcile** (every 6 h and 30 s after start, `pg_try_advisory_lock`): every subscription in
  `trialing`/`active`/`past_due` whose `trial_end` or `current_period_end` is before `now + 1 h` is
  retrieved and upserted. It also retries pending Stripe customer deletions.
- **Lapse** (hourly, in the retention job): a family that is not entitled, had a plan or pass, and has
  no `lapsed_at` gets `lapsed_at = now`, `purge_after = now + SW_RETAIN_DAYS`; a family entitled again
  gets both cleared (audit `plan.lapsed` / `plan.resumed`). Emails at `purge_after − 30 d` and
  `− 7 d`; at `purge_after` the players are deleted (`kid_data_purged_at`, audit
  `retention.purge {players:n}`). `kid_data_purged_at` belongs to one lapse: a comeback and a new
  lapse clear it, so a second lapse is warned and purged again 90 days on (a device locked to a
  purged child stays locked to nobody, §3.3).

### 6.7 Trial, consent tiers and `SW_FRIENDS_MODE`

| | Solo play + cloud saves | Play with friends | Walkie-talkie |
|---|---|---|---|
| Needs | entitled + `consent_at` (email plus) | entitled + tier by `SW_MP_CONSENT` (default: `verified`) + the child's **friends** switch | entitled + `verified` + friends switch + the child's **walkie** switch |
| With no trial (the default, `SW_TRIAL_DAYS=0`) | yes | right after checkout (the first charge is the verified consent), once the parent switches **friends** on | same, plus the **walkie** switch |
| During a free week (only if `SW_TRIAL_DAYS>0`) | yes | after **Start now** or the first monthly payment | same |
| Free pass (`comp`) | yes | after the admin records verified consent (`admin consent-verified … --method form`, a signed consent form, §11.4); for an `SW_FREE_PASS` address, once the parent agrees to the notice (method `operator`, §6.9) | same |

**`subscription`** (default): every relay member must pass the row above.
**`free-join`**: a family with consent and no plan may add players and switch **friends** on; those
players may only **join** (never host, never build, never walkie; §8.6), and they get no cloud saves.
Because joining shows a child's nickname and avatar to other children, `free-join` requires
`SW_MP_CONSENT=email_plus`, which is only right if the lawyer agrees that this filtered, invite-only
play is not a disclosure needing stronger consent (§11.4). The server refuses the combination
`free-join` + `verified` (§2).

### 6.8 US only, tax, card testing, fees

- **US first:** prices in USD; the plan card asks "I live in the United States" (required); Checkout
  requires a billing address; the webhook turns away any other country (§6.4). A Radar rule
  (`Block if :card_country: != 'US'`) is optional and may need a paid Radar plan.
- **Tax:** Stripe Tax on (`automatic_tax`); the origin address set; a registration in the home state
  if it taxes digital goods (ask an accountant). Stripe Tax collects only where registered and its
  threshold monitoring warns when another state's economic nexus comes near.
- **Card testing:** §4.8.
- **Fees** (approximate; check the account's pricing page): card 2.9% + 30¢ ≈ $0.47, Billing ≈ 0.7% ≈
  $0.04, Tax ≈ 0.5% ≈ $0.03 → about **$5.45** kept per family per month, before income tax.

### 6.9 Free passes from `SW_FREE_PASS` (the operator's own family)

The dad tests the membership with his own family without paying, and without a shell on the
server (the admin CLI needs `railway ssh`, §13.8). He lists his own address(es) in a Railway
Variable: `SW_FREE_PASS=dad@example.com` or `SW_FREE_PASS=dad@example.com, mom@example.com:2027-06-30`
(no date = through 2099-12-31; at most 20; checked at start, §2). `server/freepass.mjs` applies it:

- **When:** at every start, for each family that already exists with a listed address, and at
  sign-in (which also creates the family), so listing an address before the family signs up works.
  Changing a Variable always restarts the server on Railway, so the start is when a list change
  takes effect. Each family is changed in its own transaction, its row locked first, and only when
  something differs: running it again (or in two containers side by side) changes nothing.
- **The pass:** `comp_until` = the end of the listed day (UTC), `comp_source = 'config'`. A pass the
  admin command set (`comp_source` null) is never touched while it runs; one that has ended no
  longer does anything, so the list may set its own. `admin comp` on a listed family takes the pass
  over (`comp_source` null); when that pass ends, or after `comp … off`, the list gives its own
  again at the next start or sign-in. To stop, remove the address from the list.
- **Removed from the list:** a pass the list set ends at the next start (`comp_until = now`). It
  ends like any plan ending: the family is `lapsed` (§6.5) and the lapse, warnings and retention of
  §6.6 apply, unless the family has its own subscription. Passes set by the admin command are never
  ended by the list.
- **Consent:** a listed family is the operator's own, approved by the operator, so its verified
  consent (tier 2, §11.4) is recorded with the method **`operator`**: only for a listed address,
  only after the parent agreed to the current notice in the normal flow (`POST /api/consent`, or
  at the next start or sign-in for a parent who agreed before the address was listed), and only
  when no verified consent is recorded yet (never over `card`, `form`, `call` or `video`). The
  notice is never skipped: until the parent agrees, the family has the pass but no players. Like a
  card's, the record stays when the address leaves the list (it records that a grown-up said yes).
  **List only your own family's addresses**: for anyone else, a free pass is `admin comp` plus a
  signed consent form (`admin consent-verified … --method form`).
- **Records:** each change is one `audit_log` row with the actor `config`: `comp.set {until}` (the
  listed day, or `null` when the pass ended) and `consent.verified {method: 'operator'}`. The log
  says only counts (`free passes: 1 listed, 1 set, 0 ended, 0 consent recorded`); `admin show`
  marks such a pass `(from SW_FREE_PASS)`.

---

## 7. Game integration

### 7.1 Boot: the account module (`src/account/`)

`src/main.js` installs `account` right after `ui`. `install(game)` sets `game.account` and pushes a
hook onto `game.startHooks`; `Game.start()` awaits every hook **after the texture build and before
`store.init()`** (a failing hook is logged and ignored). `install` starts `GET /api/net` and
`GET /api/me` at once, so they run during the texture build.

`prepare()` decides the mode:

1. `window.claude?.use` exists, the page is not `http(s):`, `?net=loop`, or `/api/net` has no
   `accounts` field (or `off`) → **local** mode: nothing changes (the store keeps today's names and
   `detectCloud()`).
2. `/api/me` fails (network, timeout 3 s, 5xx) → the cache `localStorage['sparkle-world:acct']`: if
   it has a player and `now < playUntil`, **account** mode offline (cloud pushes wait and retry);
   otherwise `optional` → local mode, `required` → the "Can't reach Glimmer World" card with **Try
   again**.
3. `410 family_gone` → wipe every player namespace the cache lists, clear the cache, then as signed out.
4. Signed out → `optional`: local mode plus a **Grown-ups** tile; `required`: **blocked** mode, a card
   over the title: "Ask a grown-up to set up Glimmer World" with **I'm a grown-up** (straight to
   `/account?next=/play`: the parent's email sign-in protects everything there), **I have a code**
   (straight to pair: the code from the Family page is the grown-up's OK), and, when the device
   holds old worlds, **Keep my old worlds safe** (a read-only list with the existing **Save to a
   file**). None of them asks the grown-up check (it slowed sign-ups and protected nothing more).
5. Signed in, family not entitled:
   - with `SW_FRIENDS_MODE=free-join` and the chosen player's friends switch on (after the picker
     below) → **visitor** mode in either `optional` or `required`: the title shows only **Play with
     Friends** (Join a Code), **Dress Up** and **Settings**; saves stay on the device (no cloud);
   - otherwise `optional` → account mode with cloud writes refused (read-only; saves stay on the
     device); `required` → a grown-up's own sign-in (a `parent` session) gets no card and goes
     straight to the Family page (`/account`: the notice if not agreed yet, then the membership);
     a kid's device is blocked with "Glimmer World is resting. Ask a grown-up to wake it up!" and
     one **Grown-ups** button, which leads straight to the Family page (no grown-up check: on a
     kid's device that page only says "This device is set up for the kids")
6. Signed in, entitled: no players → in `required` a grown-up's own sign-in goes straight to the
   Family page (`/account?next=/play`) to add one; a kid's device (and `optional`) gets "A grown-up
   can add you on the Family page"; a locked device or one player → that player; otherwise **Who's playing?**: full-screen,
   big cards (≥ 120 px) with the portrait (or a colored bubble with the first letter) and the nickname,
   the last player first. Tapping one selects it.

Selecting player `pid`: `game.store.configure({ns: 'p-' + pid, cloud: new HttpCloudBackend(pid, …),
mergeProfile})`, remember it in the cache, resolve. On `game:ready` (profile loaded, before the title
opens) the module sets `profile.playerName = nickname`, `profile.nameSet = true`,
`profile.look.name = nickname` and emits `profile:changed`. **Switch player** (title chip "Not Lily?",
shown with 2+ players on an unlocked device) flushes the store, stores the choice and reloads the page.

### 7.2 SaveStore changes (`src/core/storage.js`)

Public API stays async and never throws. Additions:

```js
store.configure({ ns, cloud, mergeProfile })   // before init(); throws if init() already started.
    // ns 'p-<uuid>' → IndexedDB 'sparkle-world@p-<uuid>', localStorage prefix 'sparkle-world@p-<uuid>:'.
    // cloud: a backend used instead of detectCloud(). Without configure(): exactly today's names.
store.onFork(fn)                // fn({from, to, name}) after a conflict fork (§7.4)
SaveStore.wipe(ns)              // static: delete that namespace's database and keys
SaveStore.legacy()              // static: a store on today's names, for the import (§7.5)
```

Behavior changes (they only trigger with a backend that uses them; claude.ai's `CloudBackend` is
unchanged):

1. **Push interval per backend:** `cloud.minInterval ?? 60000` (the HTTP backend: 30000).
2. **Failed pushes are retried.** Today `_pushCloud` drops a save whose push failed; now a transient
   failure puts it back (unless a newer one is pending) and retries after 30 s, 1, 2, then every 5 min.
   Permanent errors (401/403) keep today's `cloudReadOnly` path.
3. **Revisions:** a map `{id → rev}` in `localStorage[prefix + 'revs']` (memory if unavailable), set
   when a copy is downloaded, after each successful push, and when a local copy's `updatedAt` equals
   the cloud meta's. It is the `base` of the next push.
4. **Reconcile after `init()`:** one `listMetas()`; for each local world: a cloud tombstone at least as
   new → delete the local copy; no cloud copy, or the local one newer → queue a push (this uploads what
   the page-closing journal saved); equal → learn the rev. Same for the profile.
5. **Tombstones:** `_listAll()` and `loadWorld()` ignore an id whose cloud tombstone is newer than the
   local copy.
6. **409 on a world → fork** (§7.4). **409 on the profile →** `mergeProfile(local, server)` and push
   again on the server's rev. **410 `deleted`** → delete the local copy. **410 `player_gone` /
   `family_gone`** → `cloud.onGone(code)` (the account module wipes and reloads).
7. **Skip unchanged pushes:** a world push is skipped when only `player`, `time`, `hotbar` and
   `updatedAt` changed since the last successful push and that push is under 5 minutes old (a cheap
   FNV hash of `blocks`, `palette` and `systems`). Autosave every 45 s would otherwise upload the whole
   world each minute.

`LS_PREFIX` / `DB_NAME` become instance fields; the legacy `sparkle-world:net-device` and
`sparkle-world:net-id` keys are never touched by any of this.

### 7.3 `HttpCloudBackend` (`src/account/cloud.js`)

The same six methods as `CloudBackend`, `kind 'cloud'` (so `backendName` reads `indexedDB+cloud`):

| Method | Request |
|---|---|
| `getProfile()` | `GET /api/players/:pid/profile` → profile (+ `_rev` from `ETag`), `null` on 204 |
| `putProfile(p, {base})` | `PUT …/profile`, `If-Match` → `{rev}` |
| `listMetas()` | `GET …/worlds` (cached 10 s: `loadWorld()` asks for metas every time) |
| `getWorld(id)` | `GET …/worlds/:id` → save (+ `_rev`) |
| `putWorld(save, {base})` | `PUT …/worlds/:id`, body gzip-compressed with `CompressionStream('gzip')` where the browser has it (`Content-Encoding: gzip`), `If-Match: "r<base>"` or `*` |
| `deleteWorld(id)` | `DELETE …/worlds/:id` |

Every request: `credentials: 'same-origin'`, `X-SW: 1`, JSON, a timeout (reads 8 s, world reads
24 s, writes 20 s). Errors are thrown as `Error` objects with `status` and `code`; the message contains
the status (`"403 not_entitled"`), so today's `isPermanentCloudError` recognizes 401/403 as permanent.
The page-closing journal (`journalWorld`) stays as it is; fetch `keepalive` is not used for worlds
(its 64 KB limit), so the next session's reconcile uploads what was journaled.

### 7.4 Conflicts

- **World (409):** the device's copy becomes a new world: id `<id>~<4 random base36>`, name
  `"<name> (copy)"` (≤ 80 characters), pushed with `If-Match: *`; the server's version of `<id>` is
  downloaded so both exist on the device. If the game is inside that world, `game.js` handles
  `onFork`: `world.meta.id` and `world.meta.name` become the fork's, `profile.lastWorldId` too, and a
  toast says "Your world changed on another device too, so we kept both copies!" She keeps building,
  nothing is lost. Side copies (`.before`, `.undo`) never conflict (newest wins).
- **Profile (409):** `mergeProfile(local, server)` (`src/account/merge.js`): the newer `updatedAt`
  gives the base; stickers are the union (earliest date kept); each `stats` number and each
  `stats.recipesCooked` count takes the maximum; `coins` take the maximum (coins are earned-only);
  `outfits`, `look`, `settings`, `basket`, `lastWorldId` come from the newer copy; **`net` (the
  "Keep playing" / "Join Lily" memory) and `settings.walkie*` are device-local: always the local
  copy's, and stripped before upload.**

### 7.5 Worlds already on the device (first sign-in)

On `game:ready` in account mode, if `SaveStore.legacy()` holds worlds or a non-default profile and
`localStorage['sparkle-world:legacy']` is neither `imported` nor `dismissed`: a grown-up-worded card
"This iPad has 3 worlds from before. Whose are they?" with the family's players as buttons, plus
**Not now** (asks again next time) and **They're not ours** (dismissed).

Choosing a player copies every legacy world, `.before`/`.undo` side copies included, into that
player's store (a new id when the player already has that id, like `importWorld`), then `flush()`.
The profile: a fresh player profile (no stickers, zero stats) takes the legacy look, outfits,
stickers, stats, coins and basket; otherwise stickers are unioned and coins/stats take the maximum
(never summed, so importing twice farms nothing). Then `sparkle-world:legacy = {state:'imported', to,
at}`. The legacy data stays 30 days as a fallback, then a later boot deletes it
(`sparkle-world:metas`, `sparkle-world:profile`, `sparkle-world:world:*` and the `sparkle-world`
database only). The grown-up card also has **Remove old copies now**. The import runs **in the game**,
because an iPad Home Screen app keeps its own storage, apart from Safari's.

### 7.6 The player in the game

- **Nickname:** set by the parent; the Settings name row shows it read-only ("A grown-up can change
  it on the Family page"). `ensureName()` in `src/net/ui.js` never asks, because `nameSet` is true.
- **Look:** Dress Up is unchanged (the look lives in the synced profile). After a look change
  (`avatar:changed` / `outfit:changed`, 10 s debounce), and once when a player has no portrait, the
  module renders the head with the Dress Up stage the net UI already uses
  (`getStage().snapshot(key, look, {frame:'head', size:160})`) and sends
  `PUT /api/players/:pid/portrait`. The Family page and other devices' pickers show it.

### 7.7 Friends and the walkie in the page

- `WsTransport` (C edits `facade.js` to pass `{player: game.account?.playerId}`) adds `&p=<playerId>`
  in account and visitor modes. `identity()` answers `canHost: game.account ? player.canHost : true`,
  so a free-join visitor gets the existing `cannot_host` card ("You can join a friend's world!") with
  new small print "Grown-ups: see the Family page."
- Close codes and `{t:'e'}` codes **4401 `signed_out`, 4402 `not_entitled`, 4403 `friends_off`,
  4404 `friends_locked`, 4405 `player_gone`, 4406 `accounts_mixed`** go into `CLOSE_TO_ERROR` (`ws-transport.js`), the
  welcome map (`transport.js _onFrame`) and `ERROR_TO_MESSAGE` (`session.js`). They stop retries, both
  while opening and mid-session (a mid-session close shows its own message, not "Playing together
  stopped."). `player_gone` reloads to the picker.
- New texts (`protocol.js MESSAGES`, looks in `ui.js MSG_LOOK`): `signed_out` "Ask a grown-up to sign
  in to Glimmer World on this device." · `not_entitled` "Glimmer World is resting. Ask a grown-up to
  wake it up!" · `friends_off` "Ask a grown-up to turn on Play with Friends for you." ·
  `friends_locked` "Playing with friends isn't ready yet. A grown-up can check the Family page." ·
  `accounts_mixed` "You can't play with this friend yet: both of you need a grown-up to set up
  Glimmer World." (with a **Grown-ups** button, like the others)
- **Before connecting:** when `/api/me` says the player cannot join (`why`), **Play with Friends**
  shows that card at once instead of trying.
- **Walkie:** in account mode `walkie.enabled` is `game.account.walkieAllowed`: the player's `walkieOk`
  from `/api/me`, then every `{t:'v', k:'perm', walkie}` frame from the server (§8.3). The Settings row
  (`walkie/ui.js settingsRow`) becomes read-only: "Walkie-talkie: on (a grown-up can change this on
  the Family page)". The multiplication gate stays for local mode. `profile.settings.walkie` from the
  old gate is not carried over.
- **Grown-ups** (title tile, Settings row, the player picker and the play-together cards, account
  modes only) → a grown-up card. Only a **parent session** asks the grown-up check first (`openGate`
  gains a `purpose: 'grownups'` variant with its own title and note): there the Family page opens
  with no email code and controls voice, devices and the plan. Signed out: **Sign in or start**
  (`/account?next=/play`), **I have a code**, with no check (the email sign-in or the code protects
  them). Device session, with no check: **Family page** (it only says "This device is set up for the
  kids"), **Switch player**, **Remove old copies** (the grown-up check first, then "Remove the old
  copies?"), **Sign this device out** (a plain "Sign this device out?" confirm, as on the Family page
  there). Parent session, behind the check: **Family page**, **Make this a kid device**
  (`POST /api/devices/this`), **Switch player**, **Remove old copies**, **Sign out**.

### 7.8 Offline

`/api/me` answers are cached (`sparkle-world:acct`: players' ids, nicknames, colors, switches,
`playUntil`, the last player, every player id used on this device). A network failure (never a 401)
boots from the cache until `playUntil`; saves go to the device and pushes retry when the server
answers. A 401 is never treated as offline.

### 7.9 What a kid never sees

No price, no "subscribe", no "buy", no email field, no error codes, anywhere in the game. Every money
or account screen is on the Family page, behind the parent's email (and, on a device that keeps a
grown-up's session, the game's grown-up check; starting a plan and the Portal need a fresh email
check, so a child on a device that kept a grown-up's session cannot reach Stripe's pages). The e2e
test asserts that the game's DOM never contains `$` or "subscri" in any account state (§12.8).
Sparkle Coins stay earned-only: no route grants coins, and the game page keeps `payment=()`.

### 7.10 claude.ai, `file://`, dev, and the build

- The account module is in the same bundle (`dist/sparkle-world.html` and `dist/artifact.html`) and
  does nothing when `window.claude?.use` exists, on `file://`, with `?net=loop`, or without an
  `accounts` answer from `/api/net`. It makes **no request** in those cases (tested).
- The claude.ai CloudBackend, RoomTransport and the math-gated walkie are untouched.
- **Font:** `tools/build.mjs` inlines `site/fonts/fredoka-latin.woff2` (29.7 KB → about 40 KB as a
  `data:` URL in an `@font-face`) into `dist/sparkle-world.html` instead of the Google Fonts link, so
  the game loads nothing from another site and no child's IP address reaches Google. The Artifact
  fragment keeps its current link (claude.ai's own page).
- Budget: the account module ≤ 30 KB minified; `/play` stays one cacheable file (ETag, gzip).

---

## 8. Multiplayer and walkie enforcement (server)

### 8.1 The upgrade

`server.mjs` keeps every existing check (room name, `s`, `d`, Origin, shutting down, connection and
room buckets), then, with accounts on:

```js
const r = await accounts.authorizeSocket({ cookie: req.headers.cookie, playerId: url.searchParams.get('p') })
// → { ok: true, claims: null }            optional mode and no p (with or without a cookie): a legacy socket (today's behavior)
// → { ok: true, claims }                   claims = { sessionHash, familyId, playerId, nickname,
//                                                     canHost, canBuild, walkie, until }
// → { ok: false, code }                    code: signed_out | not_entitled | friends_off | friends_locked | player_gone | unavailable
```

After the `await` the handler checks `socket.destroyed`. A refusal **completes the WebSocket handshake**,
sends `{t:'e', code}` and closes with the code below (a browser sees only 1006 for a refused HTTP
handshake, so a 403 there could never become a friendly card). Existing 429 refusals stay as they are.

| Close | Code | When |
|---|---|---|
| 4401 | `signed_out` | no valid session; `p` without a session; `required` mode without `p`; the session was revoked |
| 4402 | `not_entitled` | the family's plan is not good (and not a free-join visitor) |
| 4403 | `friends_off` | the child's **Play with friends** switch is off |
| 4404 | `friends_locked` | the consent tier for friends is missing (`SW_MP_CONSENT`) |
| 4405 | `player_gone` | the player is not in the session's family (or was deleted), or a locked device asks for another player |
| 4406 | `accounts_mixed` | (from `rooms.mjs`, `optional` only) the room has members of the other kind: account and legacy never share a room (§8.2) |
| 1013 | `unavailable` | the database is down and no cached answer exists (the page retries, then "Playing together stopped.") |

Claims come from a 60-second cache keyed by `(sessionHash, playerId)`; while the database is down an
entry up to 30 minutes old is used, so reconnects after a deploy keep working. Existing codes (4000,
4001, 4002, 4003, 4004, 4008, 4009, 4029, 1011, 1012) keep their meaning.

### 8.2 Claims in `rooms.mjs`

`join(name, peer, sink, meta)` takes `meta.claims` (null for legacy members and in `tools/net/hub.mjs`).
A member with claims gets `acct = {familyId, playerId, nickname, canHost, canBuild, walkie}`. In
`handle()`:

- presence `r:'h'` from a member with `!canHost` → rejected `{code:'cannot_host'}` (state unchanged);
- presence `wk:1` from a member with `!walkie` → the key is dropped from the patch (her badge shows
  "walkie off", which is exactly what the voice relay reads);
- presence `nm` from a member with a nickname → replaced by the server's nickname (a changed page
  cannot pretend to be another child);
- presence `ob` (the guest's building outbox, MULTIPLAYER.md §5.4) from a member with `!canBuild` →
  dropped; broadcasts `sw.op` / `sw.bulk` from such a member → rejected (only a host sends them);
- `setClaims(name, peer, acct)` updates a live member; losing `walkie` also clears her `wk` and sends
  the update to the room.

In `subscription` mode every admitted account member has `canHost = canBuild = true`. The host's
**Let in!** gate, device stamps (`by`, unchanged: still per device) and the host hold are untouched.

**Account and legacy members never share a room** (only possible in `optional`): the parent's
consent covers friends "whose families have Glimmer World too" (§11.3, §11.5), so `join()` refuses
a member without claims in a room with an account member, and an account member in a room with a
legacy member (`accounts_mixed`, close 4406, before any roster: nothing about either child
crosses, voice included). Legacy pages play with each other exactly as before; account children
with each other.

### 8.3 Claims in `voice.mjs`

`link(name, peer, send, {walkie = true} = {})` stores `l.allowed`. `_talkBlock` answers `'off'` and
`_group` skips a link that is not allowed (on top of the `wk:1` rule). `setAllowed(l, on)`: off → the
floor is released (`cut` `off`) and `l.on = false`. The server sends `{t:'v', k:'perm', walkie: 0|1}`
when a link with claims is made and whenever it changes; the page uses it (§7.7). Nothing about
recording changes: frames are passed on and forgotten; only counters are kept.

### 8.4 Live revocation

`server.mjs` indexes account connections by session hash, family id and player id. On
`accounts.events` (`session` revoked, `family` changed or deleted, `player` changed or deleted) and on
every 60-second sweep (`accounts.recheck(claims)`, cached), each affected connection is re-checked:
lost `canJoin` → `{t:'e'}` + close with the code (§8.1); lost walkie → `voice.setAllowed(false)` +
`registry.setClaims`; gained walkie → `setAllowed(true)` + `perm`. A dashboard switch reaches a live
game within about a second; a lapse by time within about two minutes.

### 8.5 Limits

Per family: at most `SW_MAX_PER_FAMILY` (12) connections, next to the existing per-address limits
(which stay). Room-per-owner counting stays per address.

### 8.6 `free-join`

A visitor's claims are `canHost = canBuild = walkie = false` (only with `SW_MP_CONSENT=email_plus`).
She can knock and play in a subscribed friend's world as a looker (the host's page also treats her as
"Players can build: off", MULTIPLAYER.md §8). Her page never offers hosting (`identity().canHost`).

---

## 9. The Family page (`/account`)

### 9.1 Files

- `site/account.html` (`/account`), `site/account/verify.html` (`/account/verify`): the site's header
  and footer, a `<main id="acct">`, a `<noscript>` note, `account.css` and `account.js` (vanilla JS,
  about 900 lines, in the style of `site/app.js`). `account.css` is loaded only by account pages, so the
  home page stays as light as today.
- `site/privacy.html` (`/privacy`), `site/terms.html` (`/terms`): static pages; `site-build.mjs`
  replaces `{{SW_OPERATOR_NAME}}`, `{{SW_OPERATOR_EMAIL}}`, `{{SW_OPERATOR_ADDRESS}}`,
  `{{SW_OPERATOR_PHONE}}`, `{{SW_PRICE_TEXT}}`, `{{SW_TRIAL_DAYS}}` from the build's environment
  (Railway passes variables to builds) and warns when one is missing.
- Phone first (360–390 px, 16 px margins, ≥ 44 px targets), then iPad and computer; the site's
  Fredoka font, colors and chunky buttons. Every value from the API is inserted with `textContent`.

### 9.2 States (one page; `account.js` renders the first that applies)

1. **Sign in** (401 from `/api/family`): "Grown-ups: sign in or start your membership". Email field →
   "Check your email" with 6 code boxes (`one-time-code`), **Resend** after 30 s, **Use a different
   email**, and "Kids never need an email." The first-time email also carries the notice.
2. **Notice** (`consent.level === 'none'`, or an agreement to a notice older than
   `NOTICE_MIN_VERSION`, then with "We changed this notice since you last agreed"): the direct notice from `GET /api/notice` (§11.3), its
   version, a link to `/privacy`, the checkbox, **Agree and continue**.
3. **Plan** (not entitled and no players yet; with `free-join` it can be skipped with **Not now**):
   "Glimmer World Membership: $5.99 a month,
   plus sales tax where it applies. One membership with everything included. There are no tiers and
   no add-ons. Up to 6 kids, their worlds saved on every device, playing with
   friends, the walkie-talkie. Nothing to buy inside the game, ever." Checkbox "I live in the United
   States". With no trial (`SW_TRIAL_DAYS=0`, the family's choice) one button, **Start your
   membership** ("The first payment is today, then it renews every month until you cancel. Cancel any time
   here: Cancel the plan, then Yes. That first payment is also how we confirm that a grown-up said
   yes, so playing with friends and the walkie-talkie can be turned on right away."). With a trial,
   two: **Start your free week** ("Free for 7 days, then $5.99/month. It renews every month until you
   cancel. Cancel any time here: Cancel the plan, then Yes.") and **Start today** ("Pay now and playing
   with friends and the walkie-talkie can be turned on today. The first payment is how we confirm that a
   grown-up said yes."). Opened from an iPad Home Screen app, it suggests Safari (the app's cookie jar
   and Stripe's page do not mix well).
4. **Back from Stripe** (`?checkout=cs_…`): "Setting up…" → sync → confetti "You're all set!" →
   **Add your first player**.
5. **Add a player** (no players yet): nickname (1–12 letters, "a nickname, not her real name"; a live
   preview through the same filter: "Other players will see: Star Bunny"), a color, **Add**.
6. **Dashboard:**
   - **Plan** ribbon, one sentence + its actions: "Free week: 5 days left, then $5.99/month."
     [Manage membership] [Start now] [Cancel the plan] · "Glimmer World Membership: renews Nov 5."
     [Manage membership] [Cancel the plan] · "Payment didn't go through. Playing continues until Oct
     12." [Update card] [Cancel the plan] · "Ends Nov 5." [Resume] · "Resting: worlds are kept
     until Jan 2." [Restart membership] [Download worlds] · "Free pass until …" (with a plan that
     still renews: "…Your Glimmer World Membership still renews on Nov 5." [Manage membership]
     [Cancel the plan]). Manage/Update/Resume open the Portal (email check); **Cancel the plan** asks
     one question ("Cancel your membership?", [Yes, cancel it] [Keep membership]) and needs no code.
     **Cancel the plan** keeps its words on purpose: `/terms` names that button, and the terms change
     only with notice.
   - **Players** (up to 6): portrait or bubble, nickname, **Rename**, the **Play with friends** switch
     with its own notice ("Other players in a game she joins or hosts see her nickname, her avatar and
     the world. Only friends the host lets in, whose families have Glimmer World too. No typing, only
     16 friendly phrases."), the **Walkie-talkie** switch with its own notice (`GATE_NOTE`: "Voices go
     live only to friends in this game, are never recorded, and stop when the button is let go."),
     disabled until friends is on and consent is verified ("Turns on after your first payment. [Start
     now]"); **See her data** (the summary: worlds with pictures, sizes and dates, stickers, coins,
     stats, created date); **Download her worlds** (each world as the game's own `sparkle-world` file,
     which **My Worlds → Open a file** accepts); **Delete player** (email check, type the nickname:
     "Deletes her worlds from our server now; devices remove their copies the next time they open the
     game."). **+ Add player**.
   - **Devices:** the list (label, "last used" date, **Sign out**, lock to a player); **Set up a kid's
     device** (the code large, a 10-minute countdown, "On her iPad: open <site>/play → Grown-ups → I have
     a code"); **Kids play on this device**.
   - **Privacy and data:** **Download everything**, the consent history, links to `/privacy` and
     `/terms`, the privacy contact, **Delete our account** (email check within 5 minutes, the list of
     what happens: the plan is cancelled now with no further charges; the kids' worlds and everything
     else are deleted now; backups roll off within 7 days; Stripe keeps the payment records the law
     requires; type DELETE).
   - **Sign out**, **Sign out everywhere**, **Play now** (`/play`).
7. The email check is a small modal: "We emailed a code to b•••@gmail.com" + the code boxes.

### 9.3 Copy rules

Plain words, no jargon, no dark patterns: the price and renewal terms are next to every button that
starts a plan; cancelling is never harder than starting (**Cancel the plan**, **Yes**: two taps and
no code, while starting needs the email check); no box is ever pre-ticked
(the US box and the notice box start empty); errors say what to do next ("Couldn't reach the payment
page. Try again in a minute.").

### 9.4 From the game and back

The game's grown-up card links to `/account` in the same tab (an iPad Home Screen app stays in the
app); the Family page has **Play now**. `next=/play` brings a sign-in started from the game back to it.

### 9.5 Home page and `/parents` (the same deploy that sets `SW_ACCOUNTS=optional`)

Every sentence that would become false changes at the same moment: "No accounts", "Nothing to buy",
"Worlds stay on your device", "nothing stored on the server", "doesn't set cookies", "the game loads
the font from Google". New truths: accounts belong to grown-ups and kids never type an email; one
Glimmer World Membership at $5.99 a month (plus tax where it applies), the only plan, with
everything included (no tiers, no add-ons), nothing to buy inside the game, coins are
earned only; worlds are saved on the device and in the family's cloud copy on our server, and can be
downloaded or deleted any time; one cookie keeps a signed-in device signed in; no ads, no analytics,
no trackers; the game loads nothing from other sites. The walkie text covers both ways (the Family
page switch; during `optional`, the per-device question for devices without an account). The home page
gains a **Glimmer World Membership** section (`#family-plan`; the menu says **Membership**), **Sign in** in the header, and `/privacy` + `/terms` in the footer.
During `optional` it announces the date from which playing together needs the membership for each
family. `/parents` gets a short "Accounts and your child's information" section linking `/privacy`.

---

## 10. Emails

All emails go through the `outbox` table (exactly once, retried, never lost in a deploy) and one of
five transports: `microsoft` (Microsoft 365 through Microsoft Graph, below), `resend`
(`POST https://api.resend.com/emails`, `Authorization: Bearer`),
`postmark` (`POST https://api.postmarkapp.com/email`, `X-Postmark-Server-Token`, stream `outbound`,
`TrackOpens:false`, `TrackLinks:'None'`), `log` (development: prints "[mail] b•••@gmail.com signin:
code 482913, link http://localhost:8080/account/verify#t=…"; refused in production), `memory` (tests,
read with `GET /api/test/mail`). The worker runs every 15 s and right after an enqueue; failures back
off 1 min, 5 min, 30 min, 2 h, 6 h, 12 h, 24 h, then stop (counted in the daily summary). Plain text
plus simple HTML, no remote images, no tracking, links only to `PUBLIC_ORIGIN`.

**`microsoft` (Microsoft 365, `server/mail.mjs`).** App-only Microsoft Graph with the OAuth 2.0
client credentials grant, Node's `fetch`, no SDK; every request has a 10 s timeout.

- **Token:** `POST https://login.microsoftonline.com/{MS_TENANT_ID}/oauth2/v2.0/token`, form
  `client_id`, `client_secret`, `scope=https://graph.microsoft.com/.default`,
  `grant_type=client_credentials`
  ([client credentials flow](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-client-creds-grant-flow)).
  The access token is kept in memory until 5 minutes before its `expires_in` (about an hour), with
  one refresh at a time (emails sent at the same moment share it).
- **Send:** `POST https://graph.microsoft.com/v1.0/users/{mailbox}/sendMail`, where the mailbox is
  the address in `MAIL_FROM`, with `{ message: { subject, body: { contentType: 'HTML', content },
  toRecipients: [{ emailAddress: { address } }], replyTo: [the operator's email] },
  saveToSentItems: false }`. Graph takes one body: `HTML` when the template has HTML (every
  template does), `Text` otherwise. Success is `202 Accepted`
  ([user: sendMail](https://learn.microsoft.com/en-us/graph/api/user-sendmail?view=graph-rest-1.0)).
  Permission: Microsoft Graph **`Mail.Send`, application type**, with admin consent (the least
  privileged permission for this call), optionally limited to this one mailbox with Exchange Online
  RBAC for Applications (DEPLOY-RAILWAY.md step 12a, "Lock the app to the one mailbox"). The name
  people see is the mailbox's own display name in Microsoft 365 (the name part of `MAIL_FROM` is not
  sent). A shared mailbox works and needs no license.
- **`saveToSentItems: false`, and why:** sign-in codes and the family's emails do not collect in
  the mailbox's Sent Items, where anyone reading that mailbox would see them and where they would
  outlive this app's own retention (§3.5: an email's data is scrubbed when it is sent, the row is
  deleted after 7 days). Exchange still keeps the sent item in the mailbox's **Recoverable Items**
  for the deleted-item retention period (14 days by default in Exchange Online, at most 30) unless
  the mailbox is on a hold or under a retention policy, and keeps a message trace (sender,
  recipient, subject) as for any email
  ([the send mail process](https://learn.microsoft.com/en-us/graph/outlook-things-to-know-about-send-mail),
  [Recoverable Items in Exchange Online](https://learn.microsoft.com/en-us/exchange/security-and-compliance/recoverable-items-folder/recoverable-items-folder)).
  Codes are dead after 15 minutes, so those copies are of no use to anyone; do not put the sending
  mailbox on a litigation hold or a long retention policy. What does land in that mailbox's
  **Inbox**: "Undeliverable" notices and automatic replies, which name the parent's address and
  quote our email (a sign-in code's subject included) and stay until deleted; DEPLOY-RAILWAY.md
  step 12a has the dad delete them now and then, or set a retention tag that deletes Inbox items
  after 30 days.
- **Errors:** a `401` drops the cached token and tries once more with a fresh one. `429` and `5xx`
  are retried: a `Retry-After` of up to 5 s is waited for once, in place; a longer one moves the
  email's next try (honored up to 1 h, never sooner than the backoff above;
  [throttling](https://learn.microsoft.com/en-us/graph/throttling)). `413`, and a `400` whose
  code is about this one message (`ErrorInvalidRecipients`, `ErrorMessageSizeExceeded`): the
  message itself was refused, so it stops at once (`permanent`); any other `400` keeps the slow
  backoff. Every message carries `SW_OPERATOR_EMAIL` as its Reply-To, so the start refuses
  anything but one bare address there (`SW_OPERATOR_EMAIL must be one bare address, like
  hello@your-domain`): a display name would make every email `ErrorInvalidRecipients`. `403` (no `Mail.Send` application
  permission with admin consent, or the mailbox is outside the app's RBAC scope), `404` (no such
  mailbox; `MailboxNotEnabledForRESTAPI`: no Exchange Online mailbox), a second `401`, and sign-in
  failures (`AADSTS7000215` wrong secret, `AADSTS7000222` expired secret, `AADSTS700016` wrong
  app, `AADSTS90002` wrong tenant) are setup problems: one Deploy Logs line names the likely fix
  (at most once per 15 minutes per problem), for example `mail: Microsoft 365 refused (403
  ErrorAccessDenied): the app needs the Mail.Send application permission with admin consent …`,
  and the email keeps the slow backoff above, so emails queued during a setup mistake (a consent
  confirmation, a welcome) still go out once it is fixed (a sign-in or check code is not sent
  after its 15 minutes: the parent asks for a new one). A log line never holds the secret, the
  token, an address or Microsoft's own error text (it can quote the mailbox address): only status
  numbers and error code names.
- **Limits:** Exchange Online allows 30 messages a minute and 10,000 recipients a day per mailbox
  ([Exchange Online limits](https://learn.microsoft.com/en-us/office365/servicedescriptions/exchange-online-service-description/exchange-online-limits));
  Graph allows 10,000 requests per 10 minutes and 4 concurrent requests per app and mailbox
  ([Outlook service limits](https://learn.microsoft.com/en-us/graph/throttling-limits#outlook-service-limits)).
  Family scale is far below both, and the outbox sends one email at a time.

**Rule: no email ever contains a child's nickname, avatar, world or pet name** ("your family's
players"), so the email provider never receives children's information.

| Template | When | Says |
|---|---|---|
| `signin` | sign-in requested | the code (also in the subject: "Your Glimmer World code: 482913"), the link, "didn't ask? ignore this"; the first time also the direct notice summary and `/privacy` |
| `check` | email check | the code, what it is for |
| `consent_confirm` | 24 h after consent (`send_after`) | "You agreed on <date> that Glimmer World may keep your children's nicknames, avatars and worlds. Changed your mind? Family page → Delete (link). You can also reply to this email." (the "plus" of email plus) |
| `welcome` | Checkout completed | plan, price, trial end date, "renews monthly until you cancel", how to cancel (the Portal, or reply), "cancel before <date> and you won't be charged" (auto-renewal acknowledgment) |
| `friends_ready` | first real payment | friends and walkie can now be switched on per child; they stay off until then |
| `us_only` | non-US billing address | sorry, US only for now; no charge (or a refund is coming) |
| `lapse_warning` | `purge_after − 30 d`, `− 7 d` | the plan ended on <date>; worlds are deleted on <date> unless restarted; download link |
| `annual_reminder` | each subscription anniversary | the plan, price, how to cancel (California's auto-renewal law; counsel to confirm) |
| `inactive` | paying, no use for 24 months | offer to cancel and delete |
| `account_deleted` | family deleted | what was deleted, what Stripe keeps, backups roll off within 7 days |

Billing emails Stripe sends itself (turned on in the Dashboard, §14): receipts, failed payments,
trial ending reminders, expiring cards.

---

## 11. COPPA and other compliance

*An engineering reading of the rules, not legal advice. Before the first real charge, one flat-fee
review by a lawyer who works on COPPA covers the notice, the privacy notice, the terms, and the two
judgment calls flagged below (§17).*

### 11.1 Scope

Glimmer World is a service directed to children under 13, so the COPPA Rule (16 CFR Part 312) applies
in full, including the amendments published April 22, 2025, whose compliance date (April 22, 2026)
has passed. Every piece of child data is treated as personal information, including where the
definition may not strictly reach it: the nickname (kids type real names), world and pet names, the
portrait, and persistent identifiers (session cookies, the relay's device secret).

### 11.2 What is collected, and why

| From or about a child | Purpose | Where |
|---|---|---|
| Nickname (chosen by the parent, 12 letters, filtered) | show her player | `players` |
| Avatar look (in the profile) and a head portrait (PNG) | show her player; picker and Family page | `player_profiles`, `players.portrait` |
| Game progress (stickers, stats, coins, outfits, settings) | her game | `player_profiles` |
| Worlds (incl. typed world and pet names, filtered when shown to others) | cloud saves, moving between devices | `worlds` |
| Session cookie, device secret (relay stamp) | sign-in and multiplayer identity: support for internal operations only, never ads or profiling | `sessions`, memory |
| Live walkie audio | relayed live between players; never stored | memory only |

Never collected: kid emails, real names, birthdays, photos (the camera stays off), location, contacts,
recordings, chat text (there is none), analytics, ads, error-tracking SDKs, play-time tracking. IP
addresses are used only in memory for rate limits, as today. From the parent: email, consent records;
payment details go only to Stripe.

### 11.3 Direct notice (312.4(c)), draft v1 (`server/notice.mjs`, shown before consent and in the first email)

> **Before your children play: what Glimmer World keeps, and why.** *(Notice version 2)*
>
> - **You gave us your email** so we can ask your permission and so you can sign in. Children are
>   never asked for an email.
> - **We need your permission first:** if you don't agree, we don't collect, use or share anything
>   about your children.
> - **With your permission we keep, for each child:** a nickname you choose (a nickname, please, not
>   a real name), her avatar and its picture, her game progress (stickers, coins, outfits, settings)
>   and her worlds, including names she types for worlds and pets. We use them only to run the game:
>   to save her worlds on our server so they follow her between devices and survive a browser
>   clearing its data.
> - **We never collect** children's emails, real names, birthdays, photos, location, contacts or
>   recordings. No ads, no analytics, no trackers.
> - **Playing with friends and the walkie-talkie are off** until you switch them on for each child on
>   the Family page. When on, the other children in the same game (only friends the host lets in,
>   whose families also have Glimmer World) see her nickname, avatar and the world, and hear her voice
>   live while she holds the walkie button. Voices are never recorded. You can agree to saving without
>   agreeing to playing with friends. These switches become available once we have confirmed that a
>   grown-up said yes: your first payment does that. *(`notice.mjs` words this sentence from
>   `SW_MP_CONSENT`.)*
> - **Who helps us run it:** Railway (hosting and database). Stripe (your payments) and
>   {email provider} (our emails) receive only your email and payment details, never your children's
>   information. We don't sell or share information for advertising.
> - **How long we keep it:** while your plan is active, and {SW_RETAIN_DAYS} days after it ends (so you
>   can come back). When you delete it, it is gone at once, and our backups roll off within 7 days.
>   Details in the Privacy Notice.
> - **You can** see, download and delete your children's information and turn any permission off at
>   any time on the Family page, or by writing to {operator email}.
> - **If you don't finish** setting up: if you don't agree to this notice within 14 days, we delete
>   your email address; if you agree but don't start a Glimmer World Membership within 30 days, we
>   delete it then.
> - [Read the full Privacy Notice](/privacy). Glimmer World is run by {operator name}, {address},
>   {phone}, {email}.
>
> ☐ I'm the parent or legal guardian of the children who will play, I'm 18 or older, and I agree that
> Glimmer World may keep the information above to run the game for them. **[Agree and continue]**

This covers the notice's required elements: why the parent's contact was collected; that consent is
needed and that without it nothing is collected, used or disclosed (312.4(c)(1)(ii)); the items collected and the possible disclosures; how they are used, the recipients and that
collection can be agreed to without disclosure; the link to the online notice; how to consent; and
deletion of the parent's contact if consent does not come. Changing the text bumps `NOTICE_VERSION`;
when the change is material, `NOTICE_MIN_VERSION` is raised with it: parents who agreed to an older
version see the notice again on the Family page, and until they agree no player is added and no
switch goes on (`403 consent_required`; saving goes on). Version 1 was reworded before anyone agreed
to it in production (accounts were still off), so it stays version 1. The same goes for the game's
rename from Sparkle World to Glimmer World (2026-10-02): it changed only the product name in the
notice, the checkbox and the emails, still before any family had agreed in production, so the
text was edited in place as version 1 (`NOTICE_MIN_VERSION` stays 1, `NOTICE_DATE` unchanged). From
the first real agreement on, any change, even a name, bumps `NOTICE_VERSION`.

**Version 2 (2026-10-03).** The paid plan was renamed from the Family Plan to the Glimmer World
Membership; in the notice that is one phrase ("If you don't finish": "don't start a Glimmer World
Membership within 30 days"). By then accounts were on in production (`SW_ACCOUNTS=required`), so
real agreements to version 1 exist or may exist (the operator's own, from checking the free pass),
and the rule above applies: the change bumps `NOTICE_VERSION` to 2
(`NOTICE_DATE` 2026-10-03, and `/privacy`'s version line with it). It is not a change that matters: it
changes no information collected, no use, no recipient and no right, only the plan's name. So
`NOTICE_MIN_VERSION` stays 1: an agreement to version 1 still counts, nobody is asked to agree again,
and new agreements and switches record version 2.

### 11.4 Verifiable parental consent, in tiers

- **Tier 1, email plus** (the "email plus" method of 312.5(b)(2)), for internal use only (cloud saves, nickname, avatar,
  progress): a verified email sign-in, the affirmative checkbox on the direct notice, and a
  confirmation email 24 hours later with a way to revoke (`consent_confirm`). Email plus is allowed
  only when the operator does not disclose children's information; tier 1 never does, because both
  sharing features need tier 2 by default.
- **Tier 2, verified**: the card method (312.5(b)(2)(ii)): "requiring a parent, in connection with a
  monetary transaction, to use a credit card, debit card, or other online payment system that
  provides notification of each discrete transaction to the primary account holder". Recorded at the
  first `invoice.paid` with `amount_paid > 0`. A $0 trial sign-up (Stripe saves the card with a $0
  check) is **probably not** a monetary transaction, so the trial does not count; **Start now** or
  **Start today** gets there on day one. For free passes, the admin can record another listed method
  (a signed consent form returned by mail, fax or scan; a call; a video call) with
  `admin consent-verified <email> --method form|call|video` (`docs/CONSENT-FORM.md` is the form).
  The operator's own family, listed in `SW_FREE_PASS`, is recorded with the method `operator` after
  the parent agrees to the notice (§6.9).
- **Judgment call 1 (for the lawyer):** whether the trial's saved card is enough. If yes, it is one
  line (set `verified_at` at `checkout.session.completed`).
- **Judgment call 2 (for the lawyer):** whether filtered, invite-only multiplayer (nickname ≤ 12 letters,
  no digits; 16 fixed phrases; world names filtered) is a disclosure needing tier 2. The default says
  yes (`SW_MP_CONSENT=verified`). If the lawyer says no, `email_plus` unlocks friends during the free
  week and allows `free-join`. The walkie always needs tier 2.

### 11.5 Separate consent for sharing (312.5(a)(2) as amended)

Per child, off by default, each with its own notice text and its own audit record: **Play with
friends** (`friends.on`), **Walkie-talkie** (`walkie.on`). Agreeing to the notice never switches them
on. There are no other third-party disclosures: Railway, Stripe and the email provider are service
providers under their data processing terms, and Stripe and the email provider receive no child data.

### 11.6 Parent rights (312.6)

Review: **See her data** and the downloads. Delete: per world (in the game), per child, or the
whole family, immediately. Revoke: any switch off (enforced on live games at once), or delete the
child (refuses further collection). Identity: a signed-in parent session plus the email check.
Requests by email (to the operator email) are answered within 10 business days, after the request is
confirmed from the account's email address (`admin export`, `admin delete`).

### 11.7 Written retention policy (312.10)

`docs/RETENTION.md` = §3.5 with the purposes and business need of each row, published in `/privacy`.
Enforced by `jobs.mjs`; every run logs counts only (`retention: deleted families=1 players=3 …`).

### 11.8 Written information security program (312.8), `docs/SECURITY-PROGRAM.md`

- Coordinator: the dad (named). A written risk assessment at launch and every year.
- Safeguards: 2FA or passkeys on GitHub, Railway, Stripe, the email provider and the domain registrar;
  secrets only in Railway Variables; a restricted Stripe key; Postgres only on Railway's private
  network; TLS everywhere; hashed tokens, codes and sessions; no personal data in logs (tested); exact
  dependency pins, `npm ci`, `npm audit` in CI; server changes reviewed before merge; the tests of
  §12.7; the walkie never records (a tested invariant).
- Vendors: `docs/VENDORS.md` (Railway, Stripe, the email provider: what each receives, their data
  processing terms, their security pages), reviewed yearly.
- Incident response: `docs/INCIDENT.md` (contain: rotate keys, `admin sign-out-all`; assess; notify
  affected parents and follow state breach-notification laws; write it down).
- Test and review: the automated suites on every change, a restore drill once, a yearly review date.

### 11.9 Consent and action records (`audit_log`)

Actions: `consent.email_plus {v}`, `consent.confirm_sent {v}`, `consent.verified {method, invoice?}`,
`player.create`, `player.delete`, `friends.on {v}`, `friends.off`, `walkie.on {v}`, `walkie.off`
(`v` is always the notice version the server shows; a page that says another one gets `409`),
`device.paired {sid}`, `device.removed {sid}`, `export.player`, `export.family`, `family.delete`,
`family.deleted`, `plan.lapsed`, `plan.resumed`, `retention.purge {players}`, `comp.set {until}`,
`email.changed`. Actors: `parent`, `system`, `stripe`, `admin`, and `config` (the records
`SW_FREE_PASS` writes, §6.9); consent methods: `card`, `form`, `call`, `video`, `operator`.
`detail` holds only versions, ids (a player id, an 8-hex session prefix, a Stripe
invoice id) and counts; never an email, a nickname, an IP address or free text. `audit.mjs` rejects
unknown actions and keys.

### 11.10 The online notice, the terms, auto-renewal

- **`/privacy`** (312.4(d)): operator name, address, phone, email; what is collected from children,
  how it is used, whether children can make information available to others (friends/walkie) and the
  switches; the persistent identifiers and the internal operations they support; the service
  providers and what each receives; no selling, no advertising; the retention policy (§3.5); parent
  rights and how to use them; the notice version and date.
- **`/terms`**: the one plan and price, "plus sales tax where it applies"; the free trial; automatic
  monthly renewal until cancelled; how to cancel (the Portal) and when it takes effect (period end,
  no partial refunds); the US only; a parent must agree for her children; no in-app purchases; acceptable
  use (kind play); changes to the terms and the price with notice; the operator.
- **Auto-renewal** (ROSCA; California's law and similar states): the terms next to the button, an
  affirmative checkbox (Checkout's `terms_of_service` with the sentence "I agree to the Terms. My
  Glimmer World Membership renews every month at $5.99 plus tax until I cancel; I can cancel any time
  on the Family page."), the `welcome` acknowledgment email, online cancellation in the Portal, the `annual_reminder`.
  The FTC's "click-to-cancel" rule was vacated in July 2025; the state laws still apply.

### 11.11 Safe Harbor, state laws, tax

- **Safe Harbor:** consider kidSAFE (kidSAFE+ COPPA-certified) or PRIVO after launch, once there are
  paying families: an outside review of these exact flows and a seal. Ask for current prices.
- **State laws:** children's privacy and design-code laws differ and some are enjoined; minimal data,
  no ads and COPPA consent are the best hedge; the lawyer's review covers the home state.
- **Sales tax:** §6.8; an accountant decides the registrations.

### 11.12 Documents to produce (owners in §15)

`site/privacy.html`, `site/terms.html`, the direct notice (`server/notice.mjs`), the email texts
(`mail-templates.mjs`), `docs/RETENTION.md`, `docs/SECURITY-PROGRAM.md`, `docs/DATA-MAP.md` (every
field: where it lives, who can see it, when it is deleted), `docs/INCIDENT.md`, `docs/VENDORS.md`,
`docs/CONSENT-FORM.md`, the parent-request procedure (in SECURITY-PROGRAM.md), updated
`site/index.html`, `site/parents.html` and `docs/DEPLOY-RAILWAY.md`, and `docs/MULTIPLAYER.md`
Addendum D (replacing Addendum A's "no server-side saves, no accounts").

---

## 12. Testing

### 12.1 Principles

Every automated test runs with **no network access to Stripe or any email provider**. The real
`stripe` SDK talks to a local fake; emails are captured in memory; Postgres is local. The only real
Stripe step is the dad's one test-mode purchase (§14 step 8).

### 12.2 Databases in tests (`tools/testdb.mjs`)

`openTestDb()`: `SW_TEST_DATABASE_URL` set → a fresh database per test file (`create database
sw_t_<random>`, dropped after); else, when Postgres binaries are found and the user is not root
(as root: when a `postgres` system user exists, the cluster runs as that user) → a throwaway
cluster (`initdb` into a temp directory, a random port, a Unix socket); else, when
`@electric-sql/pglite` is installed → in-process PGlite behind the same `query/tx` interface; else it
exits with "No Postgres for the tests: set SW_TEST_DATABASE_URL" (never a silent pass). CI uses a real
Postgres 16 service.

### 12.3 The Stripe fake (`tools/stripe-fake/`, owner B)

`startStripeFake({webhookUrl, webhookSecret, publicUrl})` → `{url, advance(days), delivery(mode),
card(customer, 'ok'|'fail'), state(), close()}`; also runnable as `node tools/stripe-fake/server.mjs`.

- A `node:http` server speaking the subset the app uses, in the pinned API version's shapes: customers
  (create, retrieve, delete), checkout sessions (create, retrieve, list; `url` → `/c/:id`), billing
  portal sessions (`url` → `/p/:id`), subscriptions (retrieve, list, update `trial_end:'now'` /
  `cancel_at_period_end`, cancel), prices (retrieve). Stripe's form encoding (brackets), `Idempotency-Key`
  replay (same key and body → same answer; different body → `400 idempotency_error`), Stripe's error JSON
  and statuses, `cus_`/`cs_test_`/`sub_`/`in_`/`evt_` ids.
- It checks the parameters the app relies on (mode, one line item with the price, `payment_method_collection
  'always'`, `automatic_tax.enabled`, `client_reference_id`, `{CHECKOUT_SESSION_ID}` in `success_url`,
  `consent_collection`) and answers 400 when one is missing, so a regression fails loudly.
- Hosted pages: `/c/:id` with **Pay (4242)**, **Declined**, **Needs 3-D Secure** (→ `incomplete`) and a
  country menu (US first); paying creates the subscription (trialing, or active with a paid invoice
  including a fake tax line), sends the events and redirects to `success_url`. `/p/:id` with **Cancel
  at period end**, **Resume**, **Cancel now**, **Update card**, **Card starts failing**.
- A clock: `advance(days)` ends trials (`invoice.paid` 599 + tax, subscription `active`), renews
  periods, or with a failing card sends `invoice.payment_failed` + `past_due`, and after the retries
  `customer.subscription.deleted`.
- Webhooks signed exactly like Stripe with the SDK's `stripe.webhooks.generateTestHeaderString({payload,
  secret})`, so the app's real `constructEvent` path runs. Delivery modes: `normal`, `duplicate`,
  `reverse` (out of order), `delay`, `drop` (the reconcile path), with retries on non-2xx.

### 12.3a The Microsoft 365 fake (`tools/ms-graph-fake.mjs`)

`startMsGraphFake({tenantId, clientId, clientSecret, mailboxes})` → `{url, requests, sent, tokens,
revokeTokens(), failSend({status, headers, code, times}), failToken({status, errorCodes, times}),
hang, reset(), close()}`. A `node:http` server for the two calls `MAIL_MODE=microsoft` makes, at
`MS_LOGIN_BASE` and `MS_GRAPH_BASE` (both its `url`; refused in production): the token endpoint
checks the form, tenant, app and secret (answering Entra's error JSON with `error_codes`, e.g.
`AADSTS7000215` for a wrong secret); `sendMail` checks the bearer token (revoked → `401`), the
mailbox (unknown → `404 ErrorInvalidUser`, whose message quotes the address, so the tests show it
is never logged) and the JSON body, and answers `202`. `tools/test-mail-microsoft.mjs`
(`npm run test:mail-microsoft`) covers the config checks, the request shapes, the token cache and
its refresh, the 401 retry, 429 Retry-After, 5xx, 400/403/404 and sign-in failures and their log
lines, timeouts, the outbox's handling, and a real sign-in code email from `/api/auth/start`
through the fake to `/api/auth/verify`; the log spy checks that no secret, token, code or address
was logged.

### 12.4 Fixtures and the contract check

`tools/fixtures/stripe/*.json`: one event per handled type and status path, in the pinned shapes,
signed at test time. The **contract check**: on staging with `SW_STRIPE_SHAPES=1` (test keys only),
the webhook logs `stripe-shape <type> <sorted key paths>` (paths only, no values); the dad copies
those lines into `tools/fixtures/stripe/real-shapes.txt` after his test purchase, and
`tools/test-billing.mjs` checks that every path the code reads exists there. Repeat when upgrading
`stripe`.

### 12.5 Email capture and the clock

`MAIL_MODE=memory` + `GET /api/test/mail?to=`. `POST /api/test/clock {offsetMs}` moves the app clock
used by every time comparison (§3.1); the e2e moves the Stripe fake's clock by the same amount.

### 12.6 Suites (node:test, no new dependencies)

- **`tools/test-accounts.mjs` (A):** config refusals; migrations (twice, expand-only, old queries on the
  new schema); sign-in (§12.7); sessions, kinds, locks; pairing; consent, players (limits, nickname
  filter and uniqueness, switch rules and tiers); exports; family delete (every table counted: zero
  rows left for the family, `gone_sessions` filled, the Stripe fake shows the customer deleted);
  retention and lapse jobs with the test clock; outbox retries, scrubbing and exactly-once; audit
  (no personal data); advisory locks (two instances, one job run).
- **`tools/test-mail-microsoft.mjs`:** `MAIL_MODE=microsoft` against its fake (§12.3a).
- **`tools/test-billing.mjs` (B):** `entitlementOf` table; checkout parameters (trial on/off, one trial,
  already subscribed → 409, US box); sync with and without a session id; Portal; Start now (verified at
  once); webhooks: bad signature → 400 and nothing written, 10-minute-old timestamp → 400, re-serialized
  body → 400 (the raw body is what is verified), duplicate id → handled once (one email), reversed order
  → the final row is right, a throwing handler → 500 then success on retry, trial `invoice.paid` $0 →
  not verified, $5.99 → verified, non-US → cancelled + `us_only`, dispute → flag, two subscriptions →
  the newer cancelled; reconcile with dropped deliveries; the shape contract.
- **`tools/test-saves.mjs` (C):** the saves API (revs, 409, 410, tombstones, quotas, gzip bomb → 413,
  validation, entitlement on writes, reads when lapsed, IDOR → 404); `SaveStore` + `HttpCloudBackend`
  in Node against the real server (a small `localStorage` shim; IndexedDB is not needed): retries,
  reconcile, forks, profile merge (`net` device-local), legacy import (twice → no double coins), skip of
  unchanged pushes, `wipe`; `--measure` prints world sizes.
- **`tools/test-net.mjs`, `tools/test-walkie.mjs` additions (D):** with an injected fake `accounts`
  object: refusals and close codes, nickname stamping, `wk` dropped without walkie, `r:'h'` refused
  without canHost, `ob` dropped without canBuild, live revocation (friends off → closed ≤ 1 s; walkie
  off → 0 voice bytes ≤ 1 s, even if the page keeps sending `{k:'on'}` with `wk:1`), per-family limit,
  the database-down cache; legacy sockets unchanged in `optional`.

### 12.7 Security tests (in the suites above)

`/api/auth/start` gives the same status, body and timing (within a margin) for known and unknown
emails and creates no family; a token is single use and a GET of `/account/verify` consumes nothing;
5 wrong codes kill the attempt; a code without its attempt cookie fails; expired tokens fail; cookie
flags are exactly `__Host-`, `Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/`; the session changes at
sign-in; a revoked session is refused everywhere (HTTP and WebSocket); CSRF: missing `X-SW`, a wrong
`Origin`, `text/plain`, a cross-site `Sec-Fetch-Site` → 403/415, the webhook exempt; every
parent+check route without the check → 403 `check_required`; delete without a 5-minute check → 403; a
device session → 401/403 on every family, billing and device route; another family's `:pid` → 404;
`next` open-redirect attempts → `/account`; every limit reaches 429; one IPv6 /48 cannot use up the
limits for everyone; per email counts the mailbox (`+tag`, Gmail dots); 10 wrong codes a day per
email; a signed-out caller's gzip bomb is answered 401 before it is inflated; a link opened on
another family's device says whose it is and replaces the session only with `replace`; a device
locked to a deleted child sees nobody (HTTP and WebSocket); `/api/test/*` absent without
`SW_TEST`; the server refuses to start with `SW_TEST=1` in production; and a **log spy** over every
suite asserts that no email address, token, code, nickname, world name or IP address is ever logged.

### 12.8 End to end (`tools/e2e-accounts.mjs`, Playwright via `playwright-core`, owner D)

Starts Postgres (§12.2), the Stripe fake and the server (`SW_ACCOUNTS=required`, `SW_TEST=1`,
`MAIL_MODE=memory`) like `probe-railway.mjs` does. Chromium only (WebKit cannot be downloaded
offline; the iPad checks are manual, §14 step 8). Zero console errors; screenshots
`.shots/acct-*.png` at 390 px, iPad and desktop.

1. Parent A signs up (code from the capture), agrees, **Start your free week** → fake Pay → back:
   "Free week"; adds Lily and Mia; the portraits are empty bubbles. The game in A's own browser
   (a parent session): **Grown-ups** asks the grown-up check before the grown-ups' card.
2. A new "iPad" context seeded with 2 legacy worlds: `/play` → "Ask a grown-up" → **I have a code**
   (no grown-up check; the code read from A's page) → Who's playing → Lily → the import card → both
   worlds in Lily's cloud (checked through the API); **Grown-ups** opens the card with no check,
   **Sign this device out** asks "Sign this device out?", **Remove old copies** asks the grown-up
   check before "Remove the old copies?" (Keep them) → she builds → Save & Exit.
3. A "computer" context pairs → Lily → the world is there with the blocks. The iPad's site data is
   cleared and reloaded → the world comes back from the cloud.
4. Both edit the same world offline (API blocked) then reconnect → a "(copy)" world, nothing lost.
5. Friends: in the trial, Lily's friends switch is locked; **Start now** (email check) → verified →
   switch on. Family B does the same with **Start today**. Lily hosts, B's child joins with the code →
   **Let in!** → they build; hashes equal. A presence `nm` change by B's page is ignored. Family C
   (never subscribed, so no dashboard and no pair code) signs in from the game (**I'm a grown-up**,
   no grown-up check → the Family page → back to `/play`) → "Glimmer World is resting…" style card, no knock reaches Lily
   (the relay refuses C's sockets: 4401 without a player, 4405 with a made-up one). The game DOM
   never contains `$` or "subscri" in any state.
6. Walkie: Lily's walkie on, B's child's off → B's child gets 0 voice bytes; B's parent switches it on
   → the `perm` frame arrives → she talks and hears; switched off again → nothing within 1 s.
7. Billing life: the fake clock passes the renewal with a failing card → "Payment didn't go through"
   → grace passes → Lily's socket closes with 4402, the game shows the resting card (its
   **Grown-ups** goes straight to the Family page: "This device is set up for the kids"), cloud writes
   refused, worlds still readable; family B: **Cancel the plan** → **Yes, cancel it** (no email
   code) → "Ends …" → the period ends → lapsed; A restarts the plan (Checkout asks for the email
   check when the sign-in is older than 15 minutes).
8. A deletes Mia → Mia's device gets 410 and its local copy is wiped → the picker.
9. A deletes the account → every table is empty for A, the fake shows the customer deleted, the
   `account_deleted` email is captured, A's devices get `410 family_gone` and wipe.
10. Regression: `/play` from `file://` makes no `/api` request; a `window.claude` stand-in page makes
    no `/api/me` request; `SW_ACCOUNTS=optional` → a signed-out device plays and plays together
    exactly as today.

### 12.9 Regression gates (must stay green)

With `SW_ACCOUNTS` unset: `npm run smoke`, `npm run test:net`, `npm run test:walkie`,
`npm run probe:railway`, `node tools/probe-net-ux.mjs`, `npm run probe:mp` (claude.ai),
`node tools/site-check.mjs` (extended to the account pages: no requests to other sites, headers, no
sideways scrolling, 360/390 px, iPad, desktop).

### 12.10 CI (`.github/workflows/test.yml` at the repository root)

Node 22; `services: postgres:16`; `working-directory: sparkle-world`; `npm ci`; install Chromium
(`npx playwright@1.56.1 install --with-deps chromium`, then `CHROMIUM_PATH` from
`chromium.executablePath()`); `npm run build`; `test:accounts`, `test:billing`, `test:saves`,
`test:net`, `test:walkie`, `e2e:accounts`, `smoke`, `site-check`; `npm audit --omit=dev`
(informational). No step talks to Stripe or an email provider.

New `package.json` scripts: `test:accounts`, `test:billing`, `test:saves` (`node --test …`),
`e2e:accounts` (build + e2e), `dev:accounts` (`tools/dev-accounts.mjs`: local Postgres + the fake +
the server with `MAIL_MODE=log` on `http://localhost:8080`), `stripe:setup`, `admin`.

---

## 13. Rollout

### 13.1 Phases

| Phase | What | Gate to the next |
|---|---|---|
| 0. Dark | Merge with `SW_ACCOUNTS` unset; the font self-hosted. Production behaves exactly as today. | all suites green |
| 1. Staging | A Railway `staging` environment (own Postgres, Stripe test mode, real email to the dad), `SW_ACCOUNTS=required`. The dad's checklist and his one test-mode purchase (§14). | checklist done, webhook deliveries all 2xx, lawyer's notes applied |
| 2. Optional | Production: live keys, `SW_ACCOUNTS=optional`, home page and `/parents` updated in the same deploy, the cut-off date announced. Existing friend families get free passes if the family wishes (`admin comp <email> <date>`). | ≤ 30 days |
| 3. Required | `SW_ACCOUNTS=required`, the pages' `optional`-only sentences removed in the same deploy. | — |

### 13.2 Existing players

Nothing on a device is deleted at the switch: worlds are imported at the first sign-in (§7.5) and kept
30 more days; **Save to a file** / **Open a file** keep working (and a signed-out device in
`required` still has **Keep my old worlds safe**). The old device secret keeps working for the relay
stamp. The claude.ai version needs no migration.

### 13.3 Deploys without downtime

Railway builds, starts the new container (migrations under the lock, jobs start), waits for
`/healthz` (database + migrations), switches traffic, then stops the old one (SIGTERM → the existing
`close()` sends 1012 and pages reconnect; accounts drain in-flight requests for up to 5 s and end the
pool). Railway only uses the health check at deploy time, so a short database outage later never
restarts a running server. Migrations are expand-only (§3.2). Jobs use `pg_try_advisory_lock` and the
outbox `for update skip locked`, so the overlap never runs a job twice or sends an email twice. If
Railway offers `RAILWAY_DEPLOYMENT_DRAINING_SECONDS`, set it to 10 (check the current docs).

### 13.4 Backups and restore

Turn on Railway's Postgres volume backups (daily, keep 7) if the plan offers them (to be checked in
the Postgres service's **Backups** tab; if not, upgrade or document that devices' own copies are the
fallback). Never copy the database to another vendor without updating VENDORS.md and the notice.
**Restore runbook** (in SECURITY-PROGRAM.md): restore on staging first; after a production restore to
time T, run `admin reapply-deletions --since T --ids <file> [--dry-run]`: it lists and (after the
count is typed) deletes again the families whose Stripe `customer.deleted` events since T carry
their `family_id` **and our mark** `sw_family_deleted` (others are printed for review: a customer
deleted by hand in the Dashboard never deletes its family), and the `family=`, `player=` and
`world=` ids of the `deletion-journal` lines since T (pasted from the Deploy Logs; a world becomes a
tombstone again). Do one restore drill on staging.

### 13.5 What the dad watches

Stripe emails him when webhook deliveries keep failing. The Deploy Logs print one line a day:
`accounts: families=… entitled=… trialing=… past_due=… lapsed=… webhooks ok=… failed=… mails sent=…
failed=… disputes=… refund_due=…`. Railway's usage page; the email provider's bounce list (with Microsoft 365: the "Undeliverable" notices in the sending mailbox's inbox); the Microsoft 365 client secret's expiry date.

### 13.6 Costs

| Item | Cost |
|---|---|
| Railway Hobby: the Node service + Postgres | $5/month minimum (includes $5 of use); likely $5–10 |
| Domain | about $10–20 a year |
| Email | Microsoft 365: nothing extra when the family already has a Microsoft 365 business plan with a mailbox on the domain (a shared mailbox needs no license). Otherwise Resend's free tier (3,000 emails/month, 100/day) covers family scale; Postmark: 100/month free, then about $15/month |
| Stripe, per $5.99 charge | about $0.54 (card, Billing, Tax; §6.8) |
| Lawyer | one flat-fee review before the first real charge |
| kidSAFE / PRIVO | optional, after launch; ask for a quote |

Two or three paying families cover the running costs.

### 13.7 Jobs (`server/jobs.mjs`, in the one process)

Each job takes `pg_try_advisory_lock(hashtext('sparkle-world:job:<name>'))` and skips its turn when
another container holds it; times come from the app clock; every run logs counts only.

| Job | When | Does |
|---|---|---|
| `outbox` | every 15 s and right after an enqueue | sends due emails (`for update skip locked`, 20 at a time), scrubs secret data, backs off failures (§10) |
| `retention` | hourly | every row of §3.5; lapse detection, warnings and purges (§6.6); retries pending Stripe customer deletions |
| `reconcile` | every 6 h, and 30 s after start | re-reads subscriptions whose trial or period ends within the hour (§6.6) |
| `reminders` | daily | `annual_reminder` on subscription anniversaries; `inactive` after 24 months without use |
| `summary` | daily at 03:17 UTC | the one log line of §13.5 |

### 13.8 Admin CLI (`npm run admin -- <command>`, `server/admin.mjs`)

Talks to the database directly (§14 step 7), writes `audit_log` rows with actor `admin`, prints counts
and ids, never children's content.

| Command | What |
|---|---|
| `show <email>` | plan state, consent, flags, player and device counts, last seen |
| `comp <email> <YYYY-MM-DD\|off>` | a free pass until that day (or remove it); warns when the family's plan still renews (and is charged). Without a shell, `SW_FREE_PASS` gives the operator's own family a pass (§6.9) |
| `consent-verified <email> --method form\|call\|video` | records tier-2 consent obtained another listed way (§11.4) |
| `change-email <old> <new>` | after confirming the request from the old address; every session and pair code of the family ends (it often follows a taken-over mailbox) |
| `export <email> > file.json` | the family export. It prints children's content, so it is never emailed: a parent asking by email is helped to sign in and use **Download everything** |
| `delete <email>` | the family delete of §3.4 (asks to type the email again) |
| `sign-out-all [<email>]` | revoke every session of a family, or of everyone (incident response; without an email it asks to type `EVERYONE`) |
| `reapply-deletions --since <ISO time> [--ids <file>] [--dry-run]` | after a restore (§13.4): lists the families, players and worlds, asks to type how many |
| `purge-now`, `stats` | run the retention job now; print the summary line |

---

## 14. The dad's setup checklist

Do everything in **test mode on staging** first, then again in live mode for production. Each step
becomes a numbered section of `docs/DEPLOY-RAILWAY.md`, written like the existing ones.

1. **Domain.** Buy one (for example `playglimmerworld.com`). Railway → the game service → Settings →
   Networking → Custom Domain; add the CNAME at the registrar. Needed for email (DKIM/SPF), trust, and
   later passkeys. Turn on 2FA at the registrar.
2. **Railway.** + New → Database → PostgreSQL. In the game service's Variables:
   `DATABASE_URL = ${{Postgres.DATABASE_URL}}`. Postgres → Backups: daily, keep 7 (if offered).
   Replicas stays 1. Keep **Serverless / App Sleeping off** (webhooks, emails and the daily jobs need a
   running server). Keep the spending limit (step 8 of the current doc). Environments → New → duplicate
   production as `staging` (its own Postgres and a `*.up.railway.app` address).
3. **Email provider.** **Microsoft 365** when the family already has it (the family's choice,
   2026-10-02): an app registration with the `Mail.Send` application permission and a client
   secret, best locked to the one mailbox (DEPLOY-RAILWAY.md step 12a). Otherwise Resend (Postmark
   works the same): create the account;
   add the domain; put its DKIM/SPF (and Postmark's Return-Path) records at the registrar; add a
   DMARC record; turn **off** open and click tracking; shortest message retention; copy the API key.
   (Postmark approves new accounts before they can send to anyone.)
4. **Stripe** (turn on 2FA first):
   - Settings → Public details: name "Glimmer World", support email, Terms URL `https://<domain>/terms`,
     Privacy URL `https://<domain>/privacy`, statement descriptor (e.g. `GLIMMERWORLD`).
   - Run `STRIPE_SECRET_KEY=sk_test_… npm run stripe:setup` (product, the $5.99 monthly price with
     tax behavior "exclusive", the portal configuration; it prints `STRIPE_PRICE_ID` and
     `STRIPE_PORTAL_CONFIG`), or make them by hand.
   - Tax: turn on Stripe Tax, set the origin address, pick the product tax code, add the home-state
     registration if the accountant says so.
   - Billing → Customer portal: update card, invoices, cancel at end of period with the reason survey;
     no plan switching, no quantity, no email editing.
   - Billing → Subscriptions and emails: receipts, failed-payment emails, trial-ending reminders,
     expiring-card emails on; Smart Retries, then **cancel the subscription** when all retries fail.
   - Radar: defaults (optionally the non-US rule if your plan allows it).
   - Developers → Webhooks → Add endpoint `https://<domain>/api/stripe/webhook`, API version
     `2026-08-26.dahlia`, events: `checkout.session.completed`, `customer.subscription.created`,
     `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`,
     `invoice.payment_failed`, `charge.dispute.created`, `customer.deleted`. Copy the signing secret.
   - Developers → API keys → Create restricted key: Customers write, Checkout Sessions write,
     Subscriptions write, Customer portal write, Invoices read, Prices read, Charges read (to find the
     family of a chargeback), Events read. Nothing else.
5. **Railway Variables** (game service):
   `SW_ACCOUNTS`, `NODE_ENV=production`, `PUBLIC_ORIGIN=https://<domain>`, `DATABASE_URL`,
   `SW_SECRET` (make it with `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`),
   `STRIPE_SECRET_KEY` (the restricted key), `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID`,
   `STRIPE_PORTAL_CONFIG`, `MAIL_MODE=microsoft` with `MS_TENANT_ID`, `MS_CLIENT_ID` and
   `MS_CLIENT_SECRET` (or `MAIL_MODE=resend`/`postmark` with `MAIL_API_KEY`),
   `MAIL_FROM=Glimmer World <hello@<domain>>` (with `microsoft`: the sending mailbox),
   `SW_OPERATOR_NAME`, `SW_OPERATOR_EMAIL`,
   `SW_OPERATOR_ADDRESS` (a PO box or a small LLC's address keeps the home address private),
   `SW_OPERATOR_PHONE`, and if you want other than the defaults `SW_TRIAL_DAYS`, `SW_FRIENDS_MODE`,
   `SW_MP_CONSENT`, `SW_GRACE_DAYS`, `SW_RETAIN_DAYS`. Never set `SW_TEST`, `STRIPE_API_BASE`,
   `MS_LOGIN_BASE` or `MS_GRAPH_BASE` in production (the server refuses to start).
6. **Legal.** Fill in the operator details; have the lawyer read `/privacy`, `/terms`, the notice and
   §11.4's two judgment calls; publish. Optionally apply to kidSAFE later.
7. **Admin access.** `railway ssh` into the service and run `npm run admin -- show <email>` (check the
   current Railway CLI; if `ssh` is unavailable: temporarily enable Postgres public networking and use
   `DATABASE_PUBLIC_URL` with `railway run`, then turn it off again).
8. **The one real test-mode purchase** (staging, `SW_STRIPE_SHAPES=1`): sign up with your own email
   (check it arrives in iPad Mail and the code autofills in a Home Screen app), agree, **Start your
   free week** with card `4242 4242 4242 4242`, add two players, pair a second browser, build, check the
   world on the other device, **Start now**, switch friends and walkie on, play together with a second
   test family, open the Portal and cancel, check the tax line and that every webhook delivery in the
   Stripe Dashboard shows 2xx; copy the `stripe-shape` log lines (§12.4). Do the iPad checks WebKit
   cannot do offline: Home Screen app sign-in with the code, pairing, the walkie. Then live mode: repeat
   step 4 with live keys, set production's Variables, deploy, make one real $5.99 purchase on the
   family's own card and refund it in the Dashboard.

---

## 15. Implementation plan

### 15.1 Agents and file ownership (disjoint)

| Agent | Owns (creates or edits) |
|---|---|
| **A: platform, sign-in, family** | `server/config.mjs, db.mjs, migrate.mjs, migrations/001_init.sql, http.mjs, accounts.mjs, auth.mjs, family.mjs, audit.mjs, mail.mjs, mail-templates.mjs, jobs.mjs, admin.mjs, test-hooks.mjs`; `tools/testdb.mjs, tools/test-accounts.mjs`; `package.json` (all new deps and scripts, §1.4, §12.10) |
| **B: billing, the Stripe fake, legal drafts** | `server/entitlement.mjs, billing.mjs, stripe.mjs, notice.mjs`; `tools/stripe-fake/**, tools/fixtures/stripe/**, tools/stripe-setup.mjs, tools/test-billing.mjs`; the text of `site/privacy.html` and `site/terms.html`; `docs/SECURITY-PROGRAM.md, RETENTION.md, DATA-MAP.md, INCIDENT.md, VENDORS.md, CONSENT-FORM.md` |
| **C: game client and cloud saves** | `src/account/**`; `src/core/storage.js, src/core/game.js, src/main.js`; `src/net/ws-transport.js, transport.js, session.js, protocol.js, facade.js, ui.js`; `src/net/walkie/index.js, ui.js, gate.js`; `src/ui/settings.js, src/ui/menus.js`; `server/saves.mjs`; `tools/build.mjs`; `tools/test-saves.mjs`; `docs/DESIGN.md` (storage note), `docs/teams/accounts-client.md` |
| **D: relay enforcement, the Family page, end to end** | `server/server.mjs, limits.mjs, rooms.mjs, voice.mjs`; `site/account.html, site/account/verify.html, site/account.js, site/account.css`, the shells of `site/privacy.html` and `site/terms.html`, `site/index.html, site/parents.html`; `tools/site-build.mjs, site-check.mjs, e2e-accounts.mjs, dev-accounts.mjs`, additions to `tools/test-net.mjs` and `tools/test-walkie.mjs`; `.github/workflows/test.yml`; `docs/DEPLOY-RAILWAY.md`, `docs/MULTIPLAYER.md` (Addendum D) |

A file outside one's list is changed only by asking its owner. The only planned hand-offs are the
three below.

### 15.2 Shared contracts (pinned here so the agents can work in parallel)

```js
// server/accounts.mjs (A) — what server.mjs (D) calls
export async function createAccounts(cfg, { log, clock }) → {
  mode, friendsMode,
  handleHttp(req, res, url) → Promise<boolean>,        // every /api/* except /api/net and /api/stats
  health() → Promise<{ ok, db, migrations }>,
  netInfo() → { accounts: mode, friendsMode },
  authorizeSocket({ cookie, playerId }) → Promise<{ ok, claims?, code? }>,   // §8.1
  recheck(claims) → Promise<{ ok, claims?, code? }>,   // cached ≤ 60 s
  events,                                              // EventEmitter: 'session' {sessionHash},
                                                       //   'family' {familyId}, 'player' {familyId, playerId}
  close() → Promise<void>,
}
// createServer({ accounts }) (D): tests inject a fake accounts object with the same shape.

// route modules (A: auth, family, test-hooks; B: billing; C: saves)
export function routes(ctx) → [{ method, path /* '/api/players/:pid/worlds/:wid' */,
  who /* 'anyone'|'session'|'parent'|'parent+check'|'parent+check5'|'player'|'stripe'|'test' */,
  body /* { max, kind: 'json'|'raw'|'world' } */, limit /* limiter keys */,
  handler: async (req, x) → ({ status, json?, headers?, stream?, cookies? }) }]
// x = { params, query, body, session, family, player, ip, now }
// ctx = { cfg, db, clock, log, mail: { enqueue(q, template, to, data, { familyId, sendAfter }) },
//         audit, limits, sessions, family: { load, player }, billing: { entitlementFor, invalidate,
//         routes, reconcile, cancelAndDelete }, events, stripe }

// server/entitlement.mjs (B): entitlementOf(...) exactly as §6.5
// server/notice.mjs (B): export const NOTICE_VERSION; export function noticeSections(cfg) → [{title, text}]
// storage backend interface (C): §7.2–7.3
```

Hand-offs: **D → A**: `server/limits.mjs` (the extracted `Bucket`, IP helpers, `KeyedLimiter`) lands
first. **A → everyone**: `package.json`, `001_init.sql`, `config.mjs`, `db.mjs`, `http.mjs` and an
`accounts.mjs` skeleton land in the first merge. **B → A, C**: `entitlement.mjs` (pure) lands early.

### 15.3 Order

1. **Skeleton (day 1):** D extracts `limits.mjs` and adds the `accounts` hooks to `server.mjs` (a no-op
   while `SW_ACCOUNTS` is unset); A lands deps, migration, config, db, http, the accounts skeleton and
   `testdb`; B lands `entitlement.mjs` + its table test. All regression gates green.
2. **In parallel:** A (sign-in, sessions, pairing, family, mail, jobs, admin, tests); B (billing, fake,
   fixtures, setup script, legal drafts); C (account module, storage, saves API, net/walkie edits, font);
   D (claims in rooms/voice/server, the Family page, site copy, site-check, CI).
3. **Integration:** D's `e2e-accounts.mjs` against everything; fixes go to each file's owner.
4. **Staging** with the dad (§14), then phases 2–3 (§13.1).

### 15.4 Acceptance

- **A:** `npm run test:accounts` green, including §12.7 and the log spy; `admin` commands work against a
  test database; config refusals tested.
- **B:** `npm run test:billing` green over fixtures and the fake in every delivery mode; `stripe:setup` is
  idempotent against the fake; the legal drafts contain every element of §11.3 and §11.10 (a checklist in
  the PR).
- **C:** `npm run test:saves` green; `npm run smoke` and `npm run probe:mp` green; the claude.ai and
  `file://` builds make no `/api` request; the bundle grows ≤ 30 KB minified plus the ~40 KB font.
- **D:** `test:net` and `test:walkie` green with and without accounts; `site-check` green on the account
  pages; `e2e:accounts` green end to end (§12.8); DEPLOY-RAILWAY.md walks through §14.
- **Release gates:** all of §12.9; no `$` in the game's DOM; every public sentence on `/`, `/parents`,
  `/privacy`, `/terms` true for the mode being deployed; the lawyer's notes applied before phase 2.

---

## 16. Deferred (not in v1)

- Passkeys (Face ID / Touch ID) with `@simplewebauthn/server` (after the custom domain is in place:
  passkeys are tied to it).
- A grown-up PIN as a faster check on shared devices.
- A second parent (co-parent) per family; changing the sign-in email on the Family page (admin only in v1).
- Encrypting parent emails in the application (Railway's disk encryption and hashed secrets only in v1).
- A relay stamp that follows the child across devices (`by` per player); v1 keeps per-device stamps.
- Picture pairing codes, QR codes.
- Card-fingerprint checks against repeated trials.
- Automatic refunds (non-US or otherwise): refunds are done by hand in the Stripe Dashboard.
- Kids renaming themselves in the game.
- Promotion codes, gift or annual plans, sibling pricing, other currencies, sales outside the US, VAT.
- Merging two versions of a world (v1 keeps both copies).
- An admin web page (the CLI only).
- Weekly summary emails to the dad; push notifications.
- Safe Harbor certification (after launch).
- More than one replica (would need shared rooms, limits and caches).
- A service worker / offline install of `/play`.
- Languages other than English.

## 17. Open questions for the family

1. **Free play without an account:** at the end of the rollout, should `/play` need the membership
   (`SW_ACCOUNTS=required`), or should solo play on one device stay free forever (`optional`), with the
   plan adding cloud saves, friends and the walkie?
2. **Friends in the free week:** is it all right that playing with friends and the walkie wait for the
   first payment (or **Start now**), unless the lawyer says the free week's card is enough (§11.4)?
3. **Price display:** "$5.99 a month plus sales tax" (US norm, default) or "$5.99, tax included"
   (the family absorbs the tax)? It must be chosen before creating the Stripe price.
4. **Families already playing together:** free passes when the switch to `required` comes? How long?
5. **Operator details for the privacy notice:** which name, mailing address (PO box / LLC?), phone and
   email?
6. **Trial length:** keep 7 days, or shorter, or none?
7. **Refunds:** "cancel any time, keeps working until the end of the month, no partial refunds": OK?
8. **Email provider:** Resend (free at this size) or Postmark (paid after 100 emails a month)?
   *Decided 2026-10-02: Microsoft 365, which the family already has (`MAIL_MODE=microsoft`).*
9. **Domain name**, and whether to apply for a kidSAFE seal after launch.

## 18. Risks

- **Consent framing** (§11.4): if the lawyer says a first real charge is needed for friends too, the
  free week is solo-only unless the parent taps **Start now**. The configuration handles either answer.
- **Friends need a paid plan** (`subscription`): fewer classmates can play together; `free-join` depends
  on the lawyer's answer.
- **iPad Home Screen apps** keep cookies and storage apart from Safari: codes, pairing and the in-game
  import handle it; it needs the real-iPad checks of §14 step 8 (WebKit cannot be tested offline here).
- **Safari can still evict the device cache:** it now costs only a re-download, but edits made offline
  and evicted before any connection are lost (the 30-second pushes and the journal keep the window small).
- **Two devices editing one world** produce "(copy)" worlds; safe, but may puzzle a 7-year-old.
- **Webhooks late, missing or mis-signed after a key change:** sync-on-return, the 6-hourly reconcile,
  slack days, grace, Stripe's failure emails and the daily counts. The flip side: up to about 10 days of
  play after a failed card (period slack + grace) is accepted.
- **Stripe API drift:** the pinned version, both field locations read, the shape contract.
- **The database is now on the relay's path:** the 30-minute claims cache and offline boot soften an
  outage; new sign-ins, checkouts and cloud writes stop while it is down.
- **One replica** only (rooms, limits, caches in memory).
- **Restores** can bring back deleted families until the runbook is run (§13.4).
- **Kids may type real names** into nicknames or world names; the filter, the hint and the parent's
  control reduce it, and friends are opt-in per child.
- **Deliverability:** without the domain's DKIM/SPF, codes land in spam; the domain is step 1.
- **Sales tax** duties differ by state; Stripe collects only where registered.
- **The home page and `/parents` must change with the mode**, or the published notice is false.
- **Hand-written sign-in** is where bugs could hide: a small surface, the §12.7 tests, and a focused
  security review before phase 2.
- **The solo operator:** the security program, incidents and disputes all fall on the dad; the runbooks
  stay short.

---

## Appendix A. How the three proposals scored

Scores 1–10 per criterion; total out of 70.

| | Security | COPPA | Simple to run | Family UX | Fits the code | Offline tests | Cost | Total |
|---|---|---|---|---|---|---|---|---|
| 1. Family Plan (security first) | 9 | 9 | 5 | 6 | 7 | 9 | 8 | **53** |
| 2. One box (the base) | 8 | 8 | 9 | 7.5 | 9 | 9 | 8.5 | **59** |
| 3. Family experience first | 7 | 7 | 6 | 9 | 8.5 | 8.5 | 8 | **54** |

- **Proposal 1** was the most careful on security and COPPA (layered, per-child consents; restore
  re-application; the log spy) but heavy for one parent to run (three secrets with rotation, many email
  checks, many switches), and two details did not fit the code: refusing the WebSocket with an HTTP 403
  (a browser only sees 1006, so no friendly card is possible) and close code 4003, which the page already
  maps to `no_rooms`. Its restore safety net lived in the same database a restore replaces.
- **Proposal 2** fitted the code best (SaveStore's cloud slot and the dropped-push gap, refusing after the
  handshake, nickname stamping, `wk` stripping), was the simplest to operate, and tested well (delivery
  chaos, a contract check against real events). It needed the per-child consent records, the tombstones,
  the operator details and the kid-never-sees-a-price rule from the others; its per-player relay stamp
  was dropped as a risk to Addendum B's rules.
- **Proposal 3** had the best family experience and several sharp catches (names.js's 12 letters, no child
  data in emails, operator contact details, the picture keypad), but allowed playing with friends under
  email plus by default, added a guessable PIN and more moving parts (picture codes, card fingerprints,
  automatic refunds), kept `/healthz` green with a broken database, and imported old worlds on the web page
  where an iPad Home Screen app's storage is not visible.
