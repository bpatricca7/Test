# Integration: accounts v1 (builders A, B, C, D merged)

docs/ACCOUNTS.md §15.3 item 3. The four builder branches were merged into
`claude/girl-game-world-building-gp6bnl` with `--no-ff`, in the order A, B, C, D, on top of the
skeleton (`36ca134`). Every merge was clean (D already carried B's `site/privacy.html` and
`site/terms.html` byte for byte). Builder C's worktree also held uncommitted team notes and a
test header comment; they were carried over as they were.

Everything stays inert while `SW_ACCOUNTS` is unset: `server.mjs` never loads `accounts.mjs`
(so neither `pg` nor `stripe`), `/account`, `/privacy` and `/terms` are neither built into
`dist/site/` nor served, `/api/net` answers as before, and the game makes today's requests
(none on `file://` or claude.ai). The one change every visitor gets is the one §13.1 phase 0
asks for: the game's font is inside `dist/sparkle-world.html` (C, §7.10), so the game loads
nothing from Google, and `/parents` says so (D's `<!-- when font=self -->` block).

## Fixes made at integration (each in its owner's file, minimal)

| Owner | File | Fix |
|---|---|---|
| A | `server/mail-templates.mjs` | `billing.mjs` enqueues `us_only` with `{refundDue}`, the template read only `{refund}`: a paid non-US family was told "No payment was taken". Both keys count now. |
| A | `server/family.mjs` | `GET /api/family` adds `purgeAfter` (ms, `families.purge_after`), which D's lapsed ribbon reads ("kept until Jan 2"). |
| A | `server/accounts.mjs` | `createAccounts(cfg, { jobs: false })` (B's `test:billing`) starts no job timers, like `timers: false`. |
| C | `src/account/legacy.js` | `profileHasPlay()` counted `coins > 0`, but every profile starts with 100 coins (`coins.js`), so any device that had opened the game signed out was asked about "stickers and outfits from before", and a new player's profile never took the old look. Only more than the starting coins counts now. This was the e2e's one open problem. |
| D | `tools/test-walkie.mjs` | With the font inside the page, "June: turning the walkie off is one tap" tapped the Settings row while the panel was still opening (C's diagnosis). A 700 ms settle before the tap. |
| — | `docs/ACCOUNTS.md` | §8.1: in `optional`, no `p` is a legacy socket with or without a cookie (A's deviation 1, which D follows). §5.2: `/api/family`'s `elevatedAt`, `purgeAfter`, players' `sort`; `/api/test/clock {advanceMs}`; `/api/test/limits`. §9.2 state 3: with no trial, one **Start the Family Plan** button. §12.8 #5: family C signs in from the game. |

Checked and left as they are:

- `billing.cancelAndDelete()`: A calls it with `{ familyId, customerId }`; B reads `customerId`
  from an object too. The e2e's scenario 9 shows the fake's customer deleted.
- Lapse: A's retention job does the lapse itself (`plan.lapsed` / `plan.resumed`, the `family`
  event). B's `billing.lapse()` does the same thing, but nothing calls it. Both use the same
  §6.5 rules.
- Deleted families' Stripe customers are retried by A's retention job and by B's reconcile. The
  two agree, because both only set `stripe_done_at` after `{ok: true}`.

## Results (accounts off unless noted; one suite at a time, on a shared 4-core machine)

| Gate | Result |
|---|---|
| `npm install`, `npm run build` | up to date, 0 vulnerabilities; build `951cb7a3` |
| Bundle (§15.4) | `dist/artifact.html` +30,514 bytes over the skeleton (29.8 KB of the 30 KB budget); `dist/sparkle-world.html` +70,158 bytes (the same plus the self-hosted font, about 38.7 KB) |
| `npm run test:accounts` | 98 tests, 98 pass (the local cluster, run as the `postgres` user) |
| `npm run test:billing` | 104 tests: 103 pass, 1 skipped (`real-shapes.txt` does not exist until the dad's staging purchase, §12.4) |
| `npm run test:saves` | 32 tests, 32 pass, the 3 Chromium tests included (`file://` and a claude.ai stand-in make no `/api` request) |
| `node tools/e2e-accounts.mjs` | all 10 scenarios, **80 checks passed, 0 problems** (about 15 min; `required`, `SW_TRIAL_DAYS=7` for the free-week scenes; no `$` or "subscri" in the game DOM in any state; the server log has no email and no nickname) |
| `node tools/smoke.mjs` | SMOKE PASSED (17 checks) |
| `npm run test:net` | 59 passed, 0 failed (5 of them with accounts on, through the fake accounts) |
| `node tools/test-walkie.mjs` | 225 checks, 0 problems (with the accounts parts: the voice relay alone and the Family page switch through the real server). The first run, before the fix above, had 223 checks and 2 problems. |
| `node tools/probe-railway.mjs` | passed (25 checks) |
| `node tools/probe-net-ux.mjs` | passed (32 checks) |
| `node tools/site-check.mjs` | HOME PAGE OK (and the account pages), 554 checks |
| `node tools/probe-keepsafe.mjs` | passed (79 checks) |
| `node tools/probe-shops.mjs` | passed (93 checks) |
| `node tools/probe-multiplayer.mjs` | 23 of 24 pass. **AT12** failed in both runs, at a different step each time: the "Keep playing" click timed out, then "Rosie sees 'Lily is taking a little break…'" failed because Lily's reload took 65 s, longer than the host's 60 s grace. The skeleton (`36ca134`, built and run the same way, `--until=AT12`) fails AT12 the same way on this machine ("Keep playing" chip not visible within 30 s). So this comes from the busy machine, not from the merge: the load average was about 6 on 4 cores, and a builder's orphaned server alone used one whole core. |
| `dist/site/` with accounts off | the same as the skeleton's except one sentence in `parents.html`: the game "loads nothing from other sites either: the Fredoka font is built into the game" (§9.5, true since the font is self-hosted). `/account`, `/privacy` and `/terms` are neither built nor served. |

## Left for later

- `probe-multiplayer` AT12 needs a green run on a quiet machine. It is timing-bound: the host's
  page reloads while her friends' pages run 8× CPU-throttled. On this machine the skeleton
  fails it too.
- A leftover `node …/wf_af0a52ec-ac1-2/sparkle-world/server/server.mjs` (builder A's test
  server, parent PID 1, its test database gone) has used a whole core since 02:49. It was left
  running: not this integration's process.
- From the builders' notes, still open:
  - refunds are by hand (`refund_due`);
  - `real-shapes.txt` comes from the dad's staging purchase (§14 step 8);
  - disputes need Charges read on the key;
  - the legal drafts need the lawyer, and their email provider line still says "Resend or
    Postmark";
  - a turned-away non-US family reads `lapsed`;
  - the admin CLI's changes reach the running server within 60 s;
  - Postmark has no idempotency key;
  - HEAD of an export writes its audit row;
  - the game reads `why` only at boot (C, a suggestion from D);
  - `src/ui/keepsafe.js` still offers "Save a copy" in account mode (C's note for its owner);
  - WebKit and iPad checks are the dad's (§14 step 8).
- The lapsed ribbon reads `purgeAfter`, which the hourly retention job sets. Until that job's
  first run after the lapse, the ribbon still says "kept for a while", as it did in the e2e.
- `SW_ACCOUNTS` must stay unset on Railway until staging (§13.1). The e2e warns that
  `SW_TRIAL_DAYS=7` does not match `/terms`, which says there is no free trial. That warning is
  expected in the e2e.
