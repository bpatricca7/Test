# Accounts v1: fixes after the security and COPPA/privacy reviews

Two independent reviews (security; COPPA and privacy) read the integrated accounts build
(`docs/teams/accounts-integration.md`) and reported 22 issues, each with a reproduction. Every
one was confirmed against the code. Everything below is still inert while `SW_ACCOUNTS` is unset:
the server never loads `accounts.mjs`, rooms without accounts have no account members (so the
new room rule never fires), and the game's account module makes no request on `file://`,
claude.ai or a site without accounts.

## Fixed

| # | Severity | Issue | Fix |
|---|---|---|---|
| 1 | major | A device locked to one child saw and acted as every sibling once that child was deleted (`lock_player … on delete set null`) | Migration `002_session_locked.sql`: `sessions.locked`. One test, `lockedAway(s, pid)` (`http.mjs`), in the routes, `/api/me` (a locked device whose child is gone lists nobody, `locked: true`) and the relay (4405). The deleted child's own routes still answer 410, so the device wipes her copy. `deletePlayer` drops those sessions from the 60 s cache. Retention purges keep the lock too. The Family page shows "Nobody yet"; choosing "Anyone in the family" unlocks it on purpose. |
| 2 | major | Bodies were read, gunzipped (synchronously) and parsed before the session check | The router checks who may call and the route's limits first; a refused request is answered with `Connection: close`, its body never read. `gunzip` is asynchronous (thread pool). A signed-out gzip bomb now gets 401, not 413 (tested). |
| 3 | major | The sign-in and pairing limits for everyone could be used up from one IPv6 allocation | `netKey` (IPv6 by /48, IPv4 as is) and per-network limits in front of the global ones (start 20/h burst 10, pair 20/10 min); globals raised to 1000/h; one log line when a global limit is used up. Per-email start counting is per mailbox (`+tag`, Gmail dots). |
| 4 | minor | The sign-in link page said nothing about whose sign-in it was; one tap replaced a kid device's family session | `POST /api/auth/verify {token, peek:true}` → `{email (masked), replacing}` without using anything. Without `replace:true` a link opened in a browser of another family answers `409 conflict {replacing:true}` and stays good. The page shows the masked email, and when replacing a warning and a times-table question for a grown-up. |
| 5 | minor | Wrong codes were limited only per attempt | 10 wrong codes a day per email (sum of `tries`); after that codes are `410 expired` until the day passes; the unguessable link keeps working. `triesLeft` counts the smaller of the two. |
| 6 | minor | Admin CLI: `sign-out-all` without email and `reapply-deletions` acted without confirmation; reapply deleted families whose customer was deleted by hand; `change-email` left sessions valid | `sign-out-all` without an email asks for `EVERYONE`. `reapply-deletions` lists everything, asks for the count, has `--dry-run`, and uses only `customer.deleted` events our own delete marked (`billing.cancelAndDelete` sets `metadata.sw_family_deleted` before `customers.del`); unmarked ones are printed for review. `change-email` revokes the family's sessions and deletes its pair codes in the same transaction. |
| 7 | minor | `friends.on`/`walkie.on` recorded a notice version the client chose | Always the server's version; another `notice` answers `409 conflict {noticeVersion}`. |
| 8 | major | Kid data was never purged 90 days after a second lapse (`kid_data_purged_at` never cleared) | Cleared when the plan comes back and when a new lapse starts (`jobs.mjs` and `billing.lapse()`). Tested: lapse → purge → comeback → new child → lapse → two warnings → purge at +90 days. |
| 9 | major | Optional mode put account children in rooms with signed-out children, against the consent notice | `rooms.mjs` never mixes the two kinds: `accounts_mixed`, close **4406** before any roster (no nickname, avatar, world or voice crosses). The page shows "You can't play with this friend yet: both of you need a grown-up to set up Sparkle World." with a Grown-ups button, and stops retrying. test-net and test-walkie expect the refusal and 0 voice bytes both ways. `/parents` (optional) says signed-out devices play with each other only. |
| 10 | major | Cancelling needed an email code that starting did not | `POST /api/billing/cancel` (parent session, no check; cancel at period end) behind **Cancel the plan → Yes, cancel it** on the trial, active and past-due ribbons. The Portal (card, invoices, Resume) keeps its check. Home page, terms, emails, the plan card and ACCOUNTS.md §9.3 say it that way. |
| 11 | major | The restore runbook re-applied only family deletions | `deletion-journal player=<uuid>` (after the delete commits) and `world=<player>/<world id>` (for a world the server held); `reapply-deletions` parses both (players deleted again, worlds made tombstones again). SECURITY-PROGRAM.md §7, ACCOUNTS.md §3.4/§13.4, RETENTION.md. |
| 12 | major | The direct notice lacked 312.4(c)(1)(ii) | A section "We need your permission first: if you don't agree, we don't collect, use or share anything about your children." (also in the email summary and `/privacy#consent`). `NOTICE_VERSION` stays 1: nobody has agreed in production (accounts are off). |
| 13 | minor | Tombstones kept the world's meta (the typed name) | The tombstone upsert sets `meta = '{}'` (and `client_updated_at`); migration 002 clears existing ones. test-saves checks it. |
| 14 | minor | A child on a device with a parent session could reach the price and Checkout behind only the times-table question | Checkout needs a fresh email check (`parent+check`; a sign-in counts for 15 minutes, so the first-time flow is unchanged); the page runs the check when asked. Opened from the game (`?next=/play`), the dashboard offers **Make this a kid device** right under "Back to the game". |
| 15 | minor | Re-consent after a notice change was promised but never asked | `NOTICE_MIN_VERSION` in `notice.mjs` (`/api/family` `config.noticeMinVersion`). An agreement to an older version shows the notice again ("We changed this notice since you last agreed"), and until then new players and switch-ons answer `403 consent_required`. Tested with an agreement to version 0. |
| 16 | minor | The notice said 14 days for everyone | "If you don't agree to this notice within 14 days, we delete your email address; if you agree but don't start the Family Plan within 30 days, we delete it then." |
| 17 | minor | Terms said children still see their worlds after a plan ends, false in `required` | `<!-- when accounts=optional -->` / `required` blocks in `terms.html`. |
| 18 | minor | `/parents` said one cookie only on a signed-in device | Names the 15-minute sign-in cookie too (and the home page's "one cookie" line). |
| 19 | minor | The parent-request procedure emailed children's data | SECURITY-PROGRAM.md §5 and DEPLOY-RAILWAY.md: help the parent sign in and use Download everything; never email the export. The admin usage says `export` prints children's content; `/privacy` says we never send children's information by email. |
| 20 | minor | INCIDENT.md recommended `SW_ACCOUNTS=off` | Rollback first (plus `sign-out-all`); `off` only as a last resort for hours, without rebuilding the site in off mode, with daily `purge-now` and email answers meanwhile. |
| 21 | minor | A paying family given a free pass lost the cancel button | `entitlementOf` adds `subState` (the subscription's own state while good); the comp ribbon keeps Manage and Cancel while the plan still renews ("Your Family Plan still renews on …"). `admin comp` warns about such a subscription. |
| 22 | minor | The device-name hint invited a child's name | Hint and placeholder "The kids' iPad" ("a nickname is fine, never a child's real name"); DATA-MAP marks `sessions.label` as possibly child information; `/privacy` says so. |

## Found on the way

- The grown-ups check (the gate with purpose `grownups`, C's `src/net/walkie/gate.js`) drew its
  house icon without a size, so it filled the card and pushed the keypad and Cancel down. On one
  e2e run a keypad tap timed out behind it on the iPad-sized page (scenario 5, family C). The
  icon now takes the gate's 46 px picture size; the next e2e run passed.
- `GET /api/test/mail` ran the outbox once (20 emails); a test that queued more missed its own
  code. It now drains what is due (test hooks only).
- The net client's three copies of the account codes are one list (`ACCOUNT_CODES`,
  `transport.js`), which keeps the bundle inside the 30 KB budget with the new 4406.

## Not done, and why

- **#2, checking `If-Match` before the body is read** (the reviewer's "optionally"): the body is
  now read only for a caller who may write to that player, within its 12-a-minute limit, so the
  stranger case is closed; moving `If-Match` into the router would give it knowledge of one
  route's protocol for no further gain.
- **#3, 10-symbol pair codes**: the spec (§4.5), the game's code field and the Family page pin
  8 symbols, which parents type on a child's device. With the per-network limit in front, the
  global pairing limit could be raised to 1000/h and still leaves guessing out of reach (about
  40 bits, 10-minute codes: with 30 codes waiting at any time, 24,000 guesses a day would need
  about 1.5 million days on average). A longer code is a later option if the global limit ever
  has to go much higher.
- **#9, rewriting every notice for mixing in optional mode**: the reviewer's alternative. The
  family's decision is that friends need their own plan, so the server enforces the notice
  instead.
- **#14, "send a parent session to /account only after a fresh sign-in" in the game's
  grown-up card**: with Checkout and the Portal behind the email check, the grown-up card can
  keep linking to the Family page; the dashboard offers "Make this a kid device" instead.

## Results

One suite at a time on the shared 4-core machine; `SW_ACCOUNTS` unset unless noted. Every
browser suite checks for zero console errors.

| Gate | Result |
|---|---|
| `npm run test:accounts` | 107 tests, 107 pass (was 98: the locked device, the gzip bomb before the session, the per-network limits, the mailbox key, wrong codes per email, the link peek, the notice version, the second lapse, the admin safeguards) |
| `npm run test:billing` | 105 tests: 104 pass, 1 skipped (`real-shapes.txt`, as before); new: Cancel the plan, the check before Checkout, the customer mark, `billing.lapse()` clearing the purge |
| `npm run test:saves` | 32 tests, 32 pass (a tombstone keeps no meta), on `fe9e1ca6` too |
| `node tools/e2e-accounts.mjs` (`required`) | 84 checks passed, 0 problems (starting the plan right after sign-in asks for no second code; B cancels with two taps and no code; A restarts). Run three times: passed, then the gate-icon timeout above, then passed after that fix |
| `npm run build` | `fe9e1ca6` (the committed dist); `dist/artifact.html` is 30,552 bytes over the skeleton (the account module's budget is 30 KB = 30,720 bytes) |
| `node tools/smoke.mjs --shots-prefix=review` | SMOKE PASSED (17 checks), on `5ef61ad1` and again on `fe9e1ca6` |
| `npm run test:net` | 59 passed, 0 failed (the optional-mode test now expects 4406 both ways) |
| `node tools/test-walkie.mjs` | 230 checks, 0 problems (0 voice bytes between legacy and account links, both ways) |
| `node tools/probe-railway.mjs` | passed (25 checks) |
| `node tools/probe-net-ux.mjs` | passed (32 checks) |
| `node tools/site-check.mjs` | HOME PAGE OK (and the account pages), 644 checks (new states: verify, verify-replace, verify-expired, dash-from-game, cancel-plan, dash-comp-renews, notice-again) |
| `node tools/probe-keepsafe.mjs` | passed (79 checks) |
| `node tools/probe-shops.mjs` | passed (93 checks) |
| `node tools/probe-multiplayer.mjs` | 24 of 24 pass (AT12 too, this time) |

The accounts-off gates ran on `5ef61ad1`; `fe9e1ca6` differs only in the grown-ups check's
icon, which only account mode shows.
