# Glimmer World: data retention policy

*The written retention policy COPPA asks for (16 CFR 312.10): we keep children's personal
information only as long as reasonably necessary for the purpose it was collected for, then delete
it so it cannot be read or rebuilt. This is docs/ACCOUNTS.md §3.5 with the reason for each row. It
is published, in plain words, in the Privacy Notice (`/privacy`, "How long we keep things"). The
server enforces it by itself: the hourly `retention` job in `server/jobs.mjs` (with
`billing.lapse()` for the "plan ended" clock), which logs counts only
(`retention: deleted families=1 players=3 …`).*

## What we keep, why, and for how long

| Data | Why we keep it | How long | Then |
|---|---|---|---|
| Children's players (nickname, color, portrait), profiles (avatar, progress) and worlds | to run the game: save her worlds and show her player on every device | while the family's plan (or free pass) is good | see the next row |
| … after the plan ends (or a free pass ends: the admin's, or one from `SW_FREE_PASS` whose address was taken off the list) | so the family can come back, or download the worlds | `SW_RETAIN_DAYS` (**90 days**) after `lapsed_at`; emails 30 and 7 days before (after every lapse: a family that comes back and lapses again is warned and purged again) | deleted (the players, which deletes profiles and worlds); `kid_data_purged_at` is set for that lapse and cleared when the plan comes back or lapses again |
| The family row (parent's email, Stripe customer id, consent dates, billing country) after the plan ends | so a returning family finds its account and its consent records; answering billing questions | **12 months** after `lapsed_at` | deleted, together with the Stripe customer |
| A family that never agreed to the notice | nothing to run without consent; the notice promises it | **14 days** after sign-up | deleted |
| A family that agreed but never had a plan or free pass and added no players | nothing to run | **30 days** | deleted |
| A paying family with no sign-in and no play for 24 months | it is still paying, so we keep it | kept | one email offering to cancel and delete; never deleted while paying |
| Sign-in and email-check attempts, pairing codes | a code only works for a few minutes; kept a little longer to count abuse | until **24 hours** after they expire | deleted |
| Parent sessions | keep a parent's browser signed in | 30 days from sign-in, or 14 days unused | deleted 7 days after they expire |
| Device sessions (a child's device) | keep the device signed in | 180 days after last use | deleted 7 days after they expire |
| `gone_sessions` (session hashes of deleted families) | so a device learns its family was deleted and wipes its copy | **180 days** | deleted |
| World tombstones (a marker that a world was deleted) | so other devices delete their copy too | **30 days** | deleted |
| `stripe_events` (ids of Stripe webhook events) | to handle each Stripe event exactly once | **30 days** | deleted |
| The outbox (emails waiting to be sent) | to send each email exactly once, with retries | sent: **7 days** (codes and links are scrubbed as soon as it is sent); failed: **30 days** | deleted |
| The audit log (consent and parent actions: dates, versions, ids, counts; never an email, a nickname or an IP address) | proof of each consent and of each switch turned on or off | **3 years** (our choice, not a legal requirement) | deleted |
| `deleted_families` (a deleted family's id and Stripe customer id) | to finish deleting the Stripe customer if Stripe was down, and to re-apply deletions after a restore | **35 days** | deleted |
| Walkie-talkie audio | passed on live to the friends in the game | **never stored** | — |
| Server logs | running and fixing the service | Railway's log retention; they contain no emails, tokens, codes, nicknames, world names or IP addresses | roll off |
| Database backups | recovering from a disaster | Railway's schedule, at most **7 days** | roll off |
| A signed consent form, or notes of a consent call (CONSENT-FORM.md) | proof of verified consent for a family with a free pass | while the family's account exists, then as long as the audit log (3 years) | shredded / deleted |

## Deleting on request

- A parent can delete one world (in the game), one child, or the whole family (Family page) at any
  time. It is deleted from the database **at once**; database backups roll off within **7 days**.
- Deleting a family also cancels its plan and deletes its Stripe customer (docs/ACCOUNTS.md §3.4).
  Stripe keeps the payment records the law requires it to keep; they hold no children's
  information.
- Devices remove their own copies the next time they open the game (`410 player_gone` /
  `family_gone`).

## How deletion works

Deletion is a real `delete` in Postgres (the rows are gone; foreign keys cascade from a family to
its players, profiles, worlds, sessions, codes, subscriptions and outbox). Nothing is "soft
deleted" except the 30-day world tombstones, which hold no world content (no body, picture or
`meta`: not the world's name either). Every deletion a parent asks for writes a
`deletion-journal` line with ids only (`family=`, `player=`, `world=<player>/<world>`), and our
own family deletes mark the Stripe customer (`sw_family_deleted`) before deleting it. After a
database restore, the restore runbook re-applies all of them (SECURITY-PROGRAM.md §7).

## Checking it works

- The Deploy Logs show a `retention:` line every hour with the counts it deleted.
- `tools/test-accounts.mjs` tests every row with the test clock; `tools/test-billing.mjs` tests the
  lapse clock (`lapsed_at`, `purge_after`).
- Once a year (SECURITY-PROGRAM.md §10), compare this table with the Privacy Notice and the code.
