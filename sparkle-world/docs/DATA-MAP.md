# Glimmer World: data map

*Every piece of information Glimmer World handles with family accounts on: where it lives, who can
see it, and when it is deleted. Kept next to the schema (`server/migrations/001_init.sql`,
docs/ACCOUNTS.md §3.3); a new column or a new kind of data updates this file, RETENTION.md and the
Privacy Notice in the same change. "Child" marks children's personal information (COPPA treats all
of it as personal information here, docs/ACCOUNTS.md §11.1).*

Who can see it, in the tables below:
- **Parent**: the signed-in parent of that family, on the Family page (and in the downloads).
- **Devices**: the family's signed-in devices (the game), for that family's players only; a device
  locked to one player sees only her.
- **Friends**: other players in a game she joins or hosts, only when her **Play with friends**
  switch is on and the host let them in.
- **Operator**: the coordinator (the dad), through the admin tool (counts, ids and dates; it never
  prints children's content) or a database restore.
- **Railway**: hosts the server and the database (a service provider, VENDORS.md).

## 1. The database (Railway Postgres)

### `families` (one row per family)

| Field | What | Child? | Who sees it | Deleted |
|---|---|---|---|---|
| `id` | random id | no | internal | with the row |
| `email` | the parent's email (trimmed, lower-case) | no | parent, operator, Railway | with the row (RETENTION.md) |
| `created_at`, `email_verified_at`, `last_seen_at` | dates | no | operator | with the row |
| `notice_version`, `consent_at` | which notice the parent agreed to, and when (tier 1) | no | parent, operator | with the row |
| `verified_at`, `verified_method` | verified consent (tier 2): `card`, `form`, `call`, `video`, or `operator` (the operator's own family listed in `SW_FREE_PASS`, after the parent agreed to the notice) | no | parent, operator | with the row |
| `stripe_customer_id` | the Stripe customer (`cus_…`) | no | operator | with the row; cleared if the customer is deleted in Stripe |
| `trial_used`, `comp_until`, `comp_source` | one trial per family; a free pass, and who set it (null: the admin command; `config`: `SW_FREE_PASS`) | no | parent (the pass's date), operator | with the row |
| `country` | billing country from Checkout (2 letters) | no | operator | with the row |
| `lapsed_at`, `purge_after`, `kid_data_purged_at` | the retention clock after a plan ends | no | parent (as dates), operator | with the row |
| `flags` | operator flags: `dispute`, `refund_due`, `us_only`, `duplicate_sub`, `welcome`, `warned30`, `warned7`, `customer_gen`, `checkout` (an open Checkout's id and time) | no | operator | with the row |

### `players` (one row per child)

| Field | What | Child? | Who sees it | Deleted |
|---|---|---|---|---|
| `id`, `family_id`, `sort`, `created_at`, `updated_at` | ids, order, dates | no | parent, devices | with the player |
| `nickname` | chosen by the parent, 1–12 letters, filtered when shown to others | **child** | parent, devices, friends (if on) | with the player |
| `color` | a color number 0–7 | child | parent, devices, friends | with the player |
| `portrait`, `portrait_rev` | a PNG of her avatar's head (≤ 32 KB), drawn by the game | **child** | parent, devices | with the player |
| `friends_on`, `walkie_on` | the parent's switches | no | parent, devices (the relay enforces them) | with the player |

### `player_profiles` (one per child)

| Field | What | Child? | Who sees it | Deleted |
|---|---|---|---|---|
| `body` (gzip JSON), `size`, `rev`, `client_updated_at` | outfits, stickers, coins, stats (including which sea animals they met), settings, basket, squishy toy collection, and her avatar look (including the water form and tail color). A tail form chosen automatically from this device's Girl / Boy button is shown to friends like clothes are; the button itself is never sent or stored. | **child** | parent (summary, download), devices; friends see the avatar look while playing (if on) | with the player |

### `worlds` (her saved worlds)

| Field | What | Child? | Who sees it | Deleted |
|---|---|---|---|---|
| `world_id`, `rev`, `client_updated_at`, `size`, `stored`, `updated_at` | ids, revisions, sizes, dates | no | parent, devices | with the world / player |
| `meta` | name, biome, size, dates (the world's summary) | **child** (the name she typed) | parent, devices; friends in a game she hosts | at once when she deletes the world (a tombstone's `meta` is `{}`), or with the player |
| `thumb` | a small JPEG picture of the world | child | parent, devices | with the world / player |
| `body` | the world itself (blocks, things, pets and their names), gzip | **child** | parent (download), devices; friends see the world she hosts while playing | at once when she deletes it (a tombstone with no content stays 30 days) |
| `deleted_at` | the tombstone's date | no | devices | after 30 days |

### Sign-in

| Table / field | What | Child? | Who sees it | Deleted |
|---|---|---|---|---|
| `sessions.id_hash` | SHA-256 of the session cookie (the cookie itself is never stored) | no (a persistent identifier) | internal | 7 days after expiry |
| `sessions.kind`, `lock_player`, `locked`, dates, `elevated_*`, `revoked_at` | parent or device session; which player a kid device is locked to (`locked` stays true when that player is deleted: the device then sees nobody); the email check's time | no | parent (device list) | 7 days after expiry |
| `sessions.label` | a coarse device name like "iPad · Safari", or a name the parent types (the page suggests "The kids' iPad"; it may still hold a child's name) | **possibly child** | parent (device list, family export) | with the session (7 days after expiry) |
| `gone_sessions` | session hashes of deleted families | no | internal | 180 days |
| `login_attempts` | the email (for the code email), `email_key` (HMAC of the email, for rate counting), hashed attempt id, link and code; tries; dates | no | internal | 24 h after expiry |
| `pair_codes` | HMAC of a kid-device pairing code, label, locked player, dates | no | internal | 24 h after expiry |

### Billing

| Table / field | What | Child? | Who sees it | Deleted |
|---|---|---|---|---|
| `subscriptions` | a mirror of the Stripe subscription: status, price, dates, cancel flag, first failed payment, last payment, when it was read | no | parent (as the plan), operator | with the family |
| `stripe_events` | Stripe event ids and types already handled | no | internal | 30 days |
| `deleted_families` | a deleted family's id and Stripe customer id, until Stripe confirms | no | operator | 35 days |

### Email and records

| Table / field | What | Child? | Who sees it | Deleted |
|---|---|---|---|---|
| `outbox` | the recipient (a parent's email), the template name, its data (codes and links, scrubbed to `{}` once sent), tries, last error name | no (emails never contain children's information) | internal | sent 7 days, failed 30 days |
| `audit_log` | consent and parent actions: the action, a date, the actor (`parent`, `system`, `stripe`, `admin`, `config` for `SW_FREE_PASS`), a player id, and details limited to versions, ids (a player id, an 8-hex session prefix, a Stripe invoice id) and counts | no (never an email, nickname or IP address) | parent (consent history), operator | 3 years (no foreign key: it outlives the family on purpose) |
| `schema_migrations` | migration versions | no | internal | never |

## 2. On the devices

| Where | What | Child? | Who sees it | Deleted |
|---|---|---|---|---|
| Browser cookie `__Host-sw_sess` | the session token (parent's browser or a child's device) | persistent identifier | that browser | sign out, expiry, or clearing site data |
| Browser cookie `__Host-sw_login` | a sign-in attempt id, 15 minutes | no | that browser | after sign-in or 15 minutes |
| IndexedDB / localStorage `sparkle-world@p-<player id>` | her profile and worlds on that device (the game's own copy) | **child** | that device | "Delete player" (the next time the game opens: `410 player_gone`), family deletion (`family_gone`), clearing site data |
| localStorage `sparkle-world:acct` | a cache of `/api/me`: player ids, nicknames, colors, switches, the offline limit | **child** (nicknames) | that device | sign out, family deletion, clearing site data |
| localStorage `sparkle-world:net-device` | the device secret for the relay stamp (docs/MULTIPLAYER.md Addendum B) | persistent identifier | that device | clearing site data |
| Legacy storage (`sparkle-world:*`, the `sparkle-world` database) | worlds made before accounts | **child** | that device | 30 days after they are brought into a player, or **Remove old copies now** |

## 3. In the server's memory only (never written down)

| What | Child? | How long |
|---|---|---|
| Rooms: presence (nickname, avatar look, position), the host's world snapshot while playing together | **child** | while the game lasts; a room is dropped 10 minutes after it goes idle |
| Walkie-talkie audio frames | **child** (voice) | passed on to the friends in that game at once, never stored |
| IP addresses (per-address limits, keyed by /64 for IPv6) | no | minutes; idle buckets are forgotten |
| The session and entitlement caches | no | 60 seconds (claims up to 30 minutes while the database is down) |

## 4. Outside Glimmer World

| Who | What they get | Child? |
|---|---|---|
| Stripe | the parent's email, `family_id` as metadata, the card and billing address typed on Stripe's page, the plan and payments | no |
| The email provider (Microsoft 365 with `MAIL_MODE=microsoft`; or Resend or Postmark) | the parent's email and the text of our emails (codes, links, dates; never children's information). With Microsoft 365 the emails are sent from the family's own mailbox with `saveToSentItems: false`: no copy in Sent Items, but Exchange keeps the sent item in that mailbox's Recoverable Items for its deleted-item retention (14 days by default, at most 30) and a message trace (docs/ACCOUNTS.md §10); "Undeliverable" notices and automatic replies land in that mailbox's Inbox with the parent's address and our subject (a sign-in code included) and stay until deleted (DEPLOY-RAILWAY.md step 12a: delete them, or a retention tag that deletes Inbox items after 30 days) | no |
| Railway | everything in §1 (as our host), Deploy Logs (no personal information in them) | yes, as a service provider |
| Railway backups | a copy of §1, kept at most 7 days | yes |

Nobody else receives anything: no analytics, ads, trackers, error-tracking or font services (the
game's font is served by our own server).

## 5. Rules that keep this map true

- No email address, token, code, nickname, world name or IP address in any log line (tested by the
  log spies in `test:accounts` and `test:billing`).
- No child's information in any email (docs/ACCOUNTS.md §10).
- No child's information to Stripe or the email provider.
- A new field or table → update this file, RETENTION.md, the Privacy Notice (`site/privacy.html`)
  and, if it changes what is collected, the direct notice (`server/notice.mjs`, bump
  `NOTICE_VERSION`).
