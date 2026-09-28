# Team "accounts B": billing, the Stripe fake, legal drafts

Builder B of docs/ACCOUNTS.md §15: §6 (Stripe Checkout, Portal, webhooks, entitlement, reconcile,
lapse, US only), the Stripe client, the Stripe fake with its fixtures and setup script, the billing
tests, the direct notice, the text of `/privacy` and `/terms`, and the compliance documents. All of
it is inert while `SW_ACCOUNTS` is unset: server.mjs never imports accounts.mjs then, so neither
`stripe` nor any of these modules is loaded.

The family's decisions it implements (§0.2): Stripe, US only, one plan at $5.99/month, no in-app
purchases, **no free trial** (`SW_TRIAL_DAYS=0` by default: the first $5.99 is charged at Checkout
and that payment is the verified consent), friends need their own subscription.

## Files

| File | What |
|---|---|
| `server/stripe.mjs` | `createStripe(cfg)` (ctx.stripe): the SDK with `apiVersion '2026-08-26.dahlia'`, 2 network retries, 10 s timeout, telemetry off; `STRIPE_API_BASE` → host/port/protocol of the fake. `stripeOptions(cfg)`, `STRIPE_API_VERSION`, `stripeErrorName(err)`, `isMissing(err)` |
| `server/billing.mjs` | `createBilling(ctx)` and `routes(ctx)`; the shape contract (`READ_PATHS`, `shapePaths`, `hasPath`), `HANDLED_EVENTS`, `subscriptionRow`, `invoiceSubscriptionId` |
| `server/notice.mjs` | `NOTICE_VERSION` (1), `noticeSections(cfg)`, `noticeCheckbox()`, `notice(cfg)` (the `GET /api/notice` answer), `noticeSummary(cfg)` (first sign-in email), `renewalSentence(cfg, {trial})` (Checkout's terms box), `pricePhrase(cfg)`, `FRIENDS_SWITCH_NOTICE`, `WALKIE_SWITCH_NOTICE` (= the game's `GATE_NOTE`, tested) |
| `server/entitlement.mjs` | (skeleton) the pure §6.5 table |
| `tools/stripe-fake/` | `server.mjs` (`startStripeFake`, also a program), `engine.mjs` (state, shapes, the clock), `delivery.mjs` (signed webhooks, delivery modes, retries), `pages.mjs` (hosted Checkout and Portal), `form.mjs` (Stripe's form encoding), `make-fixtures.mjs` |
| `tools/fixtures/stripe/` | 13 events (one per handled type and status path) + `subscriptions.json` (Stripe's state at each), generated from the fake with fixed ids and times |
| `tools/stripe-setup.mjs` | `npm run stripe:setup`: product, the $5.99 price (lookup key `sparkle_family_monthly`) and the portal configuration, idempotent |
| `tools/test-billing.mjs` | `npm run test:billing` (below) |
| `site/privacy.html`, `site/terms.html` | the text (between `<!-- B: text starts -->` and `<!-- B: text ends -->`) in a shell copied from `parents.html`; D owns the shell |
| `docs/SECURITY-PROGRAM.md`, `RETENTION.md`, `DATA-MAP.md`, `INCIDENT.md`, `VENDORS.md`, `CONSENT-FORM.md` | the compliance documents, for a solo operator |

## Contracts (as built)

`ctx.billing = createBilling(ctx)` has the pinned four and a few more:

| Method | What |
|---|---|
| `entitlementFor(familyId)` | the §6.5 object; cached 60 s (real time), recomputed when `clock.offsetMs` changes or the cached `until` has passed; not-a-uuid → `none` |
| `invalidate(familyId?)` | drop one family (or all) from the cache |
| `reconcile({now}?)` | the reconcile job: re-reads `trialing` subscriptions whose trial ends within the hour, `active` ones whose period ends within the hour, and every `past_due`/`incomplete`/`unpaid`/`paused` one; finishes Checkouts whose webhooks never came (`families.flags.checkout`, 25 h); retries pending Stripe customer deletions. → `{checked, sessions, failed, deletions: {tried, done}}`; logs one count line. The caller (jobs.mjs) holds the advisory lock |
| `cancelAndDelete(customerId \| familyRow)` | §3.4 step 1: cancel every subscription that has not ended (`invoice_now: false, prorate: false`), delete the customer. Never throws: `{ok: true}` (also when already gone), `{ok: true, skipped: true}` (no customer), or `{ok: false, error}` |
| `lapse({now}?)` | §6.6: sets `lapsed_at`/`purge_after` (now + `SW_RETAIN_DAYS`) on families that had a plan or pass and are not entitled, clears both (and `flags.warned30/warned7`) when entitled again; audits `plan.lapsed` / `plan.resumed` (actor `system`). → `{lapsed, resumed}`. The warning emails and the purge stay in A's retention job |
| `retryDeletions()` | the deletion part of reconcile on its own: `deleted_families` rows with a customer and no `stripe_done_at` |
| `checkPrice()` | `SW_PRICE_TEXT` against `STRIPE_PRICE_ID` (one warning line). Runs once in the background at start only in production or with `STRIPE_API_BASE` (never with a made-up key in unit tests) |
| `stats()` | counters for the daily summary: `webhooksOk, webhooksFailed, webhooksDuplicate, badSignature, ignored, stripeErrors, verified, usOnly, disputes, duplicatesCanceled, customersDeleted, reconciled` |
| `routes()` | the five routes below (`routes(ctx)` of the module returns them too) |
| `applySubscription(q, sub, {familyId?, syncedAt, paidInvoice?})`, `handleEvent(event)` | for tests and the admin tool |

Routes:

| Route | Who | Answers |
|---|---|---|
| `POST /api/billing/checkout {trial?, usResident: true}` | parent (verified email, `consent_at`) | `{url}` · 400 `us_only` (box not ticked) · 403 `consent_required` / `forbidden` · 409 `already_subscribed` (the mirror, then Stripe's own list) · 502 `stripe_unavailable` · 429 `rate` (5/h per family, 20/h per address). With `SW_TRIAL_DAYS=0`, `trial` is ignored. One open Checkout per family, reused for 30 min |
| `POST /api/billing/sync {sessionId?}` | parent | `{plan, usOnly?}` · 404 `not_found` (another family's or unknown session) · 400 `bad_request` (malformed id) |
| `POST /api/billing/portal` | parent+check | `{url}` (return to `/account?portal=1`, `STRIPE_PORTAL_CONFIG` when set) · 404 `not_found` (no customer) |
| `POST /api/billing/start-now` | parent+check | `{plan}` (verified at once when the charge went through) · 409 `conflict` (not trialing) |
| `POST /api/stripe/webhook` | stripe (raw body ≤ 1 MB) | `200 {received: true}` · 400 `bad_signature` · 500 (Stripe retries) |

Emails it enqueues (`ctx.mail.enqueue(q, template, to, data, {familyId})`, inside the same
transaction as the change, so exactly once): `welcome {priceText, trialDays, trialEnd (ms|null),
periodEnd (ms|null)}` (a new live plan, once per subscription, never for a duplicate or a non-US
one), `friends_ready {}` (the first paid invoice with `amount_paid > 0`), `us_only {refundDue}`.
Audit: `consent.verified {method: 'card', invoice}` (actor `stripe`), `plan.lapsed {}`,
`plan.resumed {}` (actor `system`). Events: `ctx.events.emit('family', {familyId})` after every
committed change (webhook, sync, Start now, reconcile, lapse).

`families.flags` written by billing: `checkout {id, at, trial}` (the open Checkout), `welcome` and
`us_only` (the subscription id they were sent for), `refund_due`, `dispute`, `duplicate_sub`,
`customer_gen` (bumped when Stripe deletes the customer; the next customer's idempotency key is
`cust-<family>-<gen>`).

How each rule is kept: the webhook verifies the signature over the raw body (300 s), skips an id
already processed, re-fetches what it needs outside the transaction (the subscription with
`latest_invoice` expanded; a completed Checkout's subscription after cancelling it when the billing
country is not sold to), then in one transaction records the event id and applies the effect. Every
effect is idempotent by itself too (the verified consent and the three emails are guarded by the row
they change), so the sync, the webhook and reconcile agree in any order. A subscription row is only
replaced by a newer read (`synced_at`). A paid invoice records verified consent only when its billing
country is sold to. Two live plans: the newer (by start date) is cancelled at Stripe, flagged
`duplicate_sub` (+ `refund_due` if it was already paid); the other plan's state is read from Stripe
first, never assumed from the mirror.

## The Stripe fake (for D's e2e and dev-accounts)

```js
import { startStripeFake } from './stripe-fake/server.mjs';
const fake = await startStripeFake({ webhookUrl, webhookSecret, publicUrl });   // all optional
// app env: STRIPE_API_BASE=fake.url, STRIPE_WEBHOOK_SECRET=fake.webhookSecret, STRIPE_PRICE_ID=fake.priceId
fake.setWebhook('http://127.0.0.1:<port>/api/stripe/webhook');   // when the app's port is known later
await fake.pay(checkoutUrl, { outcome: 'ok'|'decline'|'3ds'|'approve', country: 'US' });
await fake.portal(portalUrl, 'cancel_at_period_end'|'resume'|'cancel_now'|'update_card'|'card_fails');
fake.onClock((nowMs) => appClock.set(nowMs - Date.now()));   // in-process: the app clock follows each step
await fake.advance(days);          // trials end, renewals (failing card → past_due, retries +3/+5/+7 d, then cancelled)
fake.delivery('normal'|'duplicate'|'reverse'|'delay'|'drop', { delayMs });
fake.card(customerId, 'fail'); await fake.dispute({ customer }); await fake.idle(); fake.state();
```

- Hosted pages: `/c/:id` (buttons `#pay`, `#decline`, `#threeds`, then `#approve` / `#fail3ds`;
  `#country` select, US first; Pay redirects 303 to `success_url`), `/p/:id` (`#cancel`, `#resume`,
  `#cancel-now`, `#update-card`, `#card-fails`, `#return`).
- As its own process: `node tools/stripe-fake/server.mjs --port 12111 [--webhook-url URL]` prints the
  three variables; control it with `POST /__fake/advance {days}`, `/__fake/delivery {mode, delayMs}`,
  `/__fake/card {customer, outcome}`, `/__fake/webhook {url, secret}`, `/__fake/dispute {customer}`,
  `/__fake/redeliver {event}`, `/__fake/fail {count, status, path}`, `GET /__fake/state`,
  `GET /__fake/idle`. With a separate app process, move the app clock (`POST /api/test/clock`)
  **before** each `advance` by the same amount, or in small steps, so "first seen past_due" is right.
- It refuses what the app must never do: another `Stripe-Version`, a live key, a Checkout without
  `payment_method_collection: 'always'`, `automatic_tax`, `client_reference_id`,
  `{CHECKOUT_SESSION_ID}`, `consent_collection`, `billing_address_collection: 'required'`, with
  promotion codes, more than one item, or an `expires_at` outside 30 min–24 h (Stripe's 400 JSON).
- Money in the fake: US addresses pay 6 % sales tax (599 + 36 = 635), others none.

## How to test

```
npm run test:billing                       # 103 tests: 102 pass, 1 skipped (real-shapes.txt not there yet)
SW_TEST_DB=pglite npm run test:billing     # the same on PGlite
node tools/stripe-fake/make-fixtures.mjs   # after changing the fake: rewrites the fixtures (the suite checks they match)
STRIPE_SECRET_KEY=sk_test_x STRIPE_API_BASE=http://127.0.0.1:12111 npm run stripe:setup   # against a running fake
```

The suite (about 10 s): the §6.5 table (42); the notice (every §11.3 element) and the legal drafts
(every §11.10 / 312.4(d) element, nothing loaded from other sites); the fake itself (encoding,
refusals, idempotency, Checkout checks, pay / decline / 3-D Secure / non-US tax, the clock, the
Portal, hosted pages, the five delivery modes and retries, an outage, the program); the Stripe
client; the shape contract (fixtures ⊇ `READ_PATHS`, fixtures = the fake's shapes, real-shapes.txt
when present); then the real server + SDK + fake: who may start a plan, the exact Checkout
parameters, pay → verified by card + one welcome + one friends_ready + audit, the return sync with
dropped webhooks, the Portal and sync without a session id, non-US (cancelled, `us_only`,
`refund_due`, never verified), duplicate / reverse / late deliveries, a throwing handler (500 then
success, once), bad signatures (wrong secret, 10-minute-old, re-serialized, missing), a dispute, two
live plans, a customer deleted in the Dashboard, the `synced_at` guard, failed renewal → grace →
cancelled → lapsed by the clock, reconcile after dropped webhooks, `cancelAndDelete` and retried
deletions, lapse, the entitlement cache, Stripe down → 502, the Checkout rate limit, and a log spy;
with `SW_TRIAL_DAYS=7`: the trial ($0 invoice is not consent, one per family), Start now (verified
at once without webhooks), the trial ending by the clock, a declined card at the trial's end; the
webhook over every fixture with a stubbed Stripe; `SW_STRIPE_SHAPES=1` lines; `stripe:setup`
idempotency, drift repair, `--replace`, the program.

## Notes for integration

- **A (accounts.mjs, jobs, admin, mail, family)**:
  - test-billing passes `createAccounts(cfg, { log, clock, db, jobs: false })`: please honour
    `jobs: false` (skip `startJobs`), so the outbox worker, retention and reconcile don't run in the
    middle of these tests (the suite already makes `billing.reconcile/lapse` no-ops for background
    callers and reads email data from what was handed to `enqueue`, so it survives a scrubbing
    worker).
  - The reconcile job calls `ctx.billing.reconcile()` (every 6 h and 30 s after start); the
    retention job calls `ctx.billing.lapse()` and may call `ctx.billing.retryDeletions()`; the family
    delete calls `ctx.billing.cancelAndDelete(family.stripe_customer_id)` first, and keeps
    `deleted_families.stripe_customer_id` (with `stripe_done_at` only when it answered `{ok: true}`).
  - `GET /api/notice` → `notice(cfg)`; `POST /api/consent` stores `NOTICE_VERSION`; the `signin`
    template may use `noticeSummary(cfg)`.
  - Mail templates `welcome`, `friends_ready`, `us_only` get the data above. The audit actions and
    keys B writes are in §11.9's list.
  - The admin tool's `comp` / `consent-verified` should call `ctx.billing.invalidate(familyId)`;
    `show` can print `flags` (`dispute`, `refund_due`, `us_only`, `duplicate_sub`). The daily
    summary can use `ctx.billing.stats()`.
  - The `stripe` SDK writes one `<claude-code-hint …/>` line to stderr when it is imported with
    `CLAUDECODE` set (only in this development environment): a log spy on stderr may see it.
- **C (saves)**: writes check `(await ctx.billing.entitlementFor(familyId)).entitled` (true in the
  `past_due` grace too).
- **D (Family page, site, e2e, deploy doc)**:
  - `/privacy` and `/terms` are in `site/`, so in this tree they are also served while accounts are
    off. **They describe accounts and must not be published in off mode**: please gate them with the
    account pages (in `site-build.mjs` or `server.mjs`), and fill `{{SW_OPERATOR_*}}` and
    `{{SW_PRICE_TEXT}}` there. Keep the text between the `B: text` markers when putting your shell
    around it (or take these files as they are: the shell is `parents.html`'s).
  - Plan card: with `SW_TRIAL_DAYS=0` show only the one "start" button (the server ignores
    `trial`); `/account?checkout=cs_…` → `POST /api/billing/sync {sessionId}` (`usOnly: true` means
    "US only for now, you were not charged or a refund is coming"); `?portal=1` → `sync {}`.
  - DEPLOY-RAILWAY.md: the restricted key needs **Charges read** too (disputes, §14 step 4 updated);
    the webhook subscribes to exactly `HANDLED_EVENTS`; `npm run stripe:setup`; on staging
    `SW_STRIPE_SHAPES=1` and copy the `stripe-shape` lines into `tools/fixtures/stripe/real-shapes.txt`
    (the test then checks them).
- docs/ACCOUNTS.md edits in this branch: §0.1 step 3 (no free trial), the §6.4 dispute row and §14
  step 4 (Charges read).

## Checklist: the legal elements (§11.3, §11.10; tested in test:billing)

Direct notice (`server/notice.mjs`, 312.4(c)):

- [x] why the parent's contact was collected ("You gave us your email so we can ask your permission and so you can sign in")
- [x] that consent is needed, and how to give it (the "I agree" checkbox, never pre-ticked)
- [x] the items collected (nickname, avatar and its picture, game progress, worlds incl. typed world and pet names)
- [x] how they are used (only to run the game)
- [x] the possible disclosures (Play with friends: nickname, avatar, world; walkie: live voice, never recorded), off by default, per child
- [x] that collection can be agreed to without disclosure ("You can agree to saving without agreeing to playing with friends")
- [x] how the sharing switches unlock (worded from `SW_MP_CONSENT`: the first payment)
- [x] the recipients (Railway; Stripe and the email provider named from `MAIL_MODE`, never children's information; no selling)
- [x] retention (`SW_RETAIN_DAYS` after the plan ends; deletion at once; backups 7 days)
- [x] the parent's rights (see, download, delete, switch off; or email the operator)
- [x] deletion of the parent's contact if consent does not come (14 days)
- [x] the link to the online notice and the operator's name, address, phone and email

Online notice (`site/privacy.html`, 312.4(d)):

- [x] operator name, address, phone, email (`{{SW_OPERATOR_*}}`) · [x] what is collected from children and why
- [x] how it is used · [x] what is never collected · [x] what is kept about parents
- [x] whether children can make information available to others, and the two switches
- [x] persistent identifiers (the session cookie, the sign-in cookie, the device secret, IP addresses in memory) and the internal operations they support
- [x] service providers and what each receives · [x] no selling, no advertising
- [x] the retention policy (RETENTION.md in plain words) · [x] parent rights and how to use them (10 business days)
- [x] how consent is obtained (email plus; the card method; form / call / video for free passes)
- [x] security in brief · [x] the notice version and date

Terms (`site/terms.html`) and auto-renewal:

- [x] the one plan and its price, "plus sales tax where it applies" (`{{SW_PRICE_TEXT}}`) · [x] no free trial (the family's decision)
- [x] automatic monthly renewal until cancelled · [x] how to cancel (the Portal, two taps, or email) and when it takes effect (period end, no partial refunds)
- [x] United States only (non-US cancelled and refunded) · [x] a parent or legal guardian, 18+, agrees for her children
- [x] nothing to buy inside the game · [x] kind play (acceptable use) · [x] changes to the terms and the price with 30 days' notice · [x] the operator
- [x] Checkout: `consent_collection.terms_of_service: 'required'` with the renewal sentence (`renewalSentence(cfg)`) next to the box
- [x] the `welcome` email's data (price, trial end, period end) for the acknowledgment A's template writes; online cancellation in the Portal; the `annual_reminder` is A's job

## Known gaps

- **Refunds** stay manual (`refund_due` for a non-US payment or a duplicate plan).
- **A turned-away (non-US) family** reads `lapsed` afterwards (its cancelled subscription counts as
  "had a plan" in the pinned §6.5 table); `sync` says `usOnly: true` right away, later visits don't.
- **Disputes** need "Charges read" on the restricted key to find the family; without it they are
  counted (and Stripe emails the dad) but not flagged on the family.
- **Stripe Tax code**: `stripe:setup` sets one only with `STRIPE_TAX_CODE` (the accountant decides).
- **The real shapes** (`real-shapes.txt`) come from the dad's test purchase (§14 step 8); until then
  the contract is checked against the fixtures, which the fake generates (they are only as right as
  the fake's idea of the dahlia shapes).
- **The fake** does not model prorations, coupons, several items, Radar, real 3-D Secure on
  renewals, test clocks, subscription schedules, `trial_will_end`, invoice payments lists, or
  portal session expiry.
- **The legal drafts** name the email provider as "Resend or Postmark"; the direct notice
  (`notice.mjs`) names the one in `MAIL_MODE`. Both drafts are for the lawyer (§14 step 6, §17),
  written for no trial: if a trial is ever turned on, `/terms` "Free trial" changes in the same deploy.
