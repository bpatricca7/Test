# Accounts, builder A: platform, sign-in, family

docs/ACCOUNTS.md is the contract (§4, §5, §10, §11.9, §12.6–12.7, §13.7–13.8, §15). This file
is what builder A built on top of the skeleton (config, db, migrations, the /api router,
accounts.mjs), the contracts the other builders code against, how to test it, and what is left.
Everything here is inert while `SW_ACCOUNTS` is unset: server.mjs never imports accounts.mjs
then, so none of these files is even loaded.

| File | What |
|---|---|
| `server/auth.mjs` | sign-in (email code + link), parent/device sessions (cache, touch, slide), the email check, pair codes, devices, `authorizeSocket` / `recheck` with claims |
| `server/family.mjs` | `/api/me`, notice, consent, players and their switches, summary, exports, player and family delete; `accessOf()` (what the relay allows) |
| `server/audit.mjs` | `audit()` with the §11.9 action/key allow-list |
| `server/mail.mjs` | the outbox worker, transports `resend` / `postmark` / `log` / `memory`, backoff, scrubbing |
| `server/mail-templates.mjs` | every email's words (§10) and `loadNotice()` (B's `notice.mjs`, or a short v1 fallback) |
| `server/jobs.mjs` | outbox, retention (§3.5) + lapse/warnings/purge (§6.6), reconcile hook, reminders, the daily line; each under `pg_try_advisory_lock` |
| `server/admin.mjs` | the admin CLI (§13.8): `runAdmin()` for tests, a program for `railway ssh` |
| `server/test-hooks.mjs` | `/api/test/*` (only with `SW_TEST=1`) |
| `server/accounts.mjs` | (edited) audit rows carry the app clock, `ctx.jobs`, `ctx.routes`, the `timers` option, sockets answered by auth.mjs |
| `tools/test-accounts.mjs` | the suite (§12.6 A, §12.7, the log spy) |
| `tools/testdb.mjs` | (edited) `installLogSpy()` for every accounts suite |

## Contracts for B, C and D

### ctx (what route modules and billing get)

`ctx = { cfg, db, clock, log, events, limits, stripe, mail, audit, sessions, family, billing, jobs, routes }`

- `ctx.mail.enqueue(q, template, to, data, { familyId, sendAfter })`: `q` is the caller's
  transaction (the email exists only if it commits). `sendAfter` is ms of the app clock.
  Templates and the `data` each one reads (anything else is ignored; **never a child's name**):
  `signin {code, link}`, `check {code}`, `consent_confirm {at, v}`, `welcome {trialEnd?, periodEnd?}`,
  `friends_ready {}`, `us_only {refund?: true}`, `lapse_warning {lapsedAt, purgeAfter}`,
  `annual_reminder {}`, `inactive {}`, `account_deleted {}`. An unknown template throws.
- `ctx.audit(q, familyId, action, detail, { actor, playerId })`: the time is the app clock. Only
  the §11.9 actions, each with its own keys (`consent.verified` takes `{method, invoice?}`;
  `invoice` must look like `in_…`; actor `'stripe'` for webhooks). Anything else throws (503).
- `ctx.family.load(familyId)`, `ctx.family.player(pid)` (rows), `ctx.family.deleteFamily(id, { actor, notify })`.
- `ctx.sessions`: `fromRequest`, `byHash`, `authorizeSocket`, `recheck`, `revokeFamily`, `clearCaches` (see auth.mjs's header).
- `ctx.jobs.run(name)` → the job's result or `{ skipped: true }`; names `outbox`, `retention`, `reconcile`, `reminders`, `summary`.

### What A calls on billing (B)

- `billing.entitlementFor(familyId)` → §6.5; `billing.invalidate(familyId?)` (no argument: all).
- `billing.cancelAndDelete({ familyId, customerId })` → resolve (anything but `false` or `{ok:false}`)
  when the Stripe customer is gone (cancel non-terminal subscriptions, then `customers.del`; a
  customer that is already deleted counts as done), throw or return `{ok:false}` to be retried.
  Called at a family delete (before the rows go) and hourly by the retention job for every
  `deleted_families` row with a `stripe_customer_id` and no `stripe_done_at` (the family row is
  gone by then, so it must work from the customer id alone). A sets `stripe_done_at` and clears
  the customer id on success.
- `billing.reconcile({ now })`: called by the `reconcile` job (30 s after start, every 6 h) under
  its advisory lock.
- `notice.mjs`: `NOTICE_VERSION`, `noticeSections(cfg)`, and optionally `NOTICE_CHECKBOX` (string)
  or `noticeCheckbox(cfg)`; without it the §11.3 checkbox sentence is used.

### Events (D re-checks live sockets, §8.4)

`ctx.events` / `accounts.events` (an EventEmitter). A emits, B emits `family` after webhooks:

| event | payload | when |
|---|---|---|
| `session` | `{ sessionHash }` (64 hex) | a session revoked (logout, logout-all, device removed, sign-in over an old one, pairing over an old one, "Kids play on this device", admin sign-out-all), a device's lock changed, a family deleted (each of its sessions) |
| `family` | `{ familyId, deleted? }` | consent agreed, the family deleted (`deleted: true`), kid data purged; B: after a webhook or sync |
| `player` | `{ familyId, playerId, deleted? }` | friends/walkie/nickname changed, the player deleted (`deleted: true`) |

auth.mjs registers its own listeners first, so by the time server.mjs's listener calls
`recheck`, the claims cache no longer holds the old answer.

### The relay's questions (§8.1)

- `authorizeSocket({ cookie, playerId })`:
  - no `p`: `optional` → `{ok:true, claims:null}` (a legacy socket), **with or without a session
    cookie** (a signed-in page that fell back to local mode plays as today; see Deviations);
    `required` → `signed_out`.
  - `p` without a session cookie → `signed_out`; `p` not a uuid → `player_gone`; a revoked,
    expired or unknown session → `signed_out`; a locked device asking for another player, a
    player of another family, a deleted player → `player_gone`; then `not_entitled`,
    `friends_locked`, `friends_off` (in that order); the database down with no cached answer
    younger than 30 minutes → `unavailable`.
  - `claims = { sessionHash (hex), familyId, playerId, nickname, canHost, canBuild, walkie, until }`.
- `recheck(claims)` → the same answer for that session and player (null claims → legacy).
- Answers are cached 60 s per (session, player); the events above clear them at once.

### HTTP shapes worth knowing (D's Family page, C's game)

- Every time in JSON is **epoch ms** (`lastSeen`, `createdAt`, `elevatedUntil`, `expiresAt`, `until`, `playUntil`, audit `at`).
- `GET /api/me`: §5.3; a locked device sees only its player. `401 signed_out` and `410 family_gone`
  also clear the cookie. A device session's cookie is sent again with its slid `Max-Age`.
- `POST /api/auth/verify {code}` → `400 {error:'bad_code', triesLeft}`; no attempt cookie, a used,
  killed or expired attempt → `410 expired`.
- `POST /api/devices/pair-code` → `200 {code:'K7QM-2XFD', expiresAt}`; 4th live code → `409 limit`;
  a `lockPlayer` not hers → `404`.
- `POST /api/auth/pair` → any failure `400 bad_code` (never says why).
- `GET /api/devices` → a bare array `[{id, kind, label, lastSeen, createdAt, current, lockPlayer}]`;
  parent sessions get a User-Agent label too ("iPhone · Safari").
- `PATCH /api/devices/:id {label?, lockPlayer?}`: only a device can be locked (`400` for a parent session).
- `GET /api/family` → §5.2 plus `elevatedAt` (to know whether a delete needs a new check) and `sort` per player.
- `POST /api/consent` with an old `noticeVersion` → `409 conflict {noticeVersion}` (reload the notice).
- `POST /api/players` → `201 player`; `403 consent_required`, `403 not_entitled`,
  `400 nickname_blocked` (nothing left after names.js), `409 nickname_taken`, `409 limit` (6).
  The stored nickname is `sanitizeName()`'s output ("Lily2" → "Lily").
- `PATCH /api/players/:pid`: switching on needs the check (`403 check_required`), a plan
  (`403 not_entitled`; free-join: friends only) and the consent tier (`403 needs_verified`);
  `walkie:true` with friends off → `409 conflict`; friends off takes the walkie with it.
- `DELETE /api/players/:pid {confirm: nickname}` (case-insensitive) → `{ok}`; else `400`.
- `GET /api/players/:pid/summary` thumbs point at C's `/api/players/:pid/worlds/:wid/thumb?v=<rev>`.
- Exports: `Content-Disposition: attachment; filename="sparkle-world-player-YYYY-MM-DD.json"`
  (`…-family-…`), streamed one world at a time; each world is `{format:'sparkle-world', v:1, save}`,
  which `readWorldFile()` (My Worlds → Open a file) reads.

### Test hooks (`SW_TEST=1` only; D's e2e)

`GET /api/test/mail?to=` (runs the outbox first), `POST /api/test/clock {offsetMs}` (absolute;
`{advanceMs}` adds), `POST /api/test/jobs {name}`, `POST /api/test/reset`, and
`POST /api/test/limits {off:true|false}` (rate limits off, or fresh and on) for a server running
as its own process. All POSTs need the §4.7 headers like any other.

### The log spy for B, C and D

`import { installLogSpy } from './testdb.mjs'`: `const spy = installLogSpy()` at the top of a test
file, pass `spy.log` as the server's and accounts' `log`, `spy.remember(email, code, token, nickname…)`,
and end with a test calling `spy.check()` (it also refuses any email-address or IPv4 shape).

## Deviations and choices (none from the pinned §15.2 signatures)

1. **Optional mode, a session cookie and no `p`** → a legacy socket (`claims: null`), not
   `signed_out`. §1.2 says "sockets without p as today"; §8.1's comment names only the no-cookie
   case. A signed-in page falls back to local mode (no `p`) when `/api/me` fails, and refusing it
   would show "Ask a grown-up to sign in" to a signed-in child. In `required`, no `p` is refused.
2. `billing.cancelAndDelete({ familyId, customerId })`: the argument shape is A's (not pinned).
3. `/api/test/clock` also takes `{advanceMs}`; `/api/test/limits` is extra (the orchestrator asked
   for an SW_TEST-only way to reset limits).
4. `createAccounts(cfg, { …, timers })` (default true) and `ctx.routes`, `ctx.jobs` are additions.
5. `/api/me` 410 answers carry a cookie-clearing header (the page wipes once, not at every boot).

## How to test

```
npm ci
npm run test:accounts                     # 96 tests: the cluster (postgres user) by default
SW_TEST_DB=pglite npm run test:accounts   # 95 + 1 skipped (the admin-as-a-program test needs a URL)
SW_TEST_VERBOSE=1 npm run test:accounts   # print what the servers log
```

The suite starts real servers (createServer + createAccounts, `SW_TEST=1`, `MAIL_MODE=memory`,
an **https** `PUBLIC_ORIGIN`, so cookies are the production `__Host-…; Secure` ones) and talks
to them over HTTP and WebSocket with a small cookie-jar client; each browser has its own
X-Forwarded-For address. The app clock is moved for expiry, retention and lapse. Billing's Stripe
side of a delete is a recording stub; `STRIPE_API_BASE` points at a closed port so no call can
leave the machine. Regression gates with `SW_ACCOUNTS` unset: `npm run build` (build id d532aea4,
no dist change), `node tools/smoke.mjs --shots-prefix=acct-a`, `npm run test:net` (54/54),
`node tools/probe-railway.mjs`: all green in this tree.

Admin by hand: `node tools/testdb.mjs --migrate` prints a `DATABASE_URL`; then
`SW_ACCOUNTS=optional DATABASE_URL=… PUBLIC_ORIGIN=http://localhost:8080 SW_SECRET=… STRIPE_…=… MAIL_MODE=log node server/admin.mjs show <email>`.

## Known gaps

- Until B's `notice.mjs` lands, `/api/notice` and the first sign-in email use a short v1 fallback.
- The admin CLI is another process: the running server sees its changes within 60 s (caches).
- `inactive` uses `families.last_seen_at`, bumped by sign-in and by `/api/me` at most once a day.
- The daily line's `webhooks failed` counts `stripe_events` rows of the last day not processed;
  B's bad-signature counter is not in it.
- Families deleted by retention (never agreed, no plan) get no email; the notice says so.
- A HEAD of an export route still writes its audit row.
- The sign-in timing test allows 40 ms (or half the larger median) between known and unknown emails;
  the work is identical by construction (no family lookup at start).
- Postmark has no idempotency key: a crash between sending and committing can send an email twice
  (Resend gets `Idempotency-Key: sparkle-outbox-<id>`).
