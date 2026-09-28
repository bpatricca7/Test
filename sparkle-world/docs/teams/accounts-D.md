# Accounts, builder D: relay enforcement, the Family page, end to end

docs/ACCOUNTS.md is the contract (§8, §9, §12.6 D, §12.8, §12.10, §14, §15). This file is what
builder D built on top of the skeleton, the contracts it relies on, how to test it, what the
first integration run (A, B and C merged into a scratch tree) found, and what is left.
Everything here is inert while `SW_ACCOUNTS` is unset: `createServer()` gets no `accounts`, the
relay code paths below are never taken, the site is built exactly as before (the account pages,
`/privacy` and `/terms` are not even copied to `dist/site/`, and the server answers them 404),
and `npm run build` gives the same build id and bytes as the skeleton (d532aea4).

## What was built

| File | What |
|---|---|
| `server/server.mjs` | account connections indexed by session / family / player; live revocation on `accounts.events` and a sweep every 60 s (`SW_RECHECK_MS`); refusals after the handshake (`{t:'e', code}` + 4401–4405 / 1013); the per-family limit (`SW_MAX_PER_FAMILY`, 12; a reconnect of the same page takes its own old place); claims to `rooms.mjs` and `voice.mjs`; the Family page and `/privacy`, `/terms` served only with accounts on, with `Cross-Origin-Opener-Policy: same-origin` on `/account` and `/account/verify`; a warning when the home page was built for another mode; `recheckAll()` for tests |
| `server/rooms.mjs` | member `acct` claims (§8.2): `r:'h'` without `canHost` refused (`cannot_host`), `wk` without `walkie` dropped, `nm` = the server's nickname, `ob` without `canBuild` dropped, `sw.op` / `sw.bulk` without `canBuild` refused (`cannot_build`), `setClaims()` brings a live member in line (and tells the room) |
| `server/voice.mjs` | per-link `allowed` (§8.3), the `{t:'v', k:'perm', walkie}` frame at link time and on change, `setAllowed()` (off: the floor is cut `off` at once); legacy links unchanged |
| `site/account.html`, `site/account/verify.html`, `site/account.js`, `site/account.css` | the Family page (§9): every state of §9.2 (below); vanilla JS, `textContent` only, `fetch` with `X-SW: 1`, never a form post, Stripe opened with `location.assign(url)` |
| `site/index.html`, `site/parents.html`, `site/styles.css` | the words for `optional` / `required` (§9.5), picked at build time by `<!-- when accounts=… -->` blocks; `off` keeps today's pages byte for byte |
| `site/privacy.html`, `site/terms.html` | **B's files, byte for byte** (B's text inside the shell B copied from `parents.html`, which is the site's shell): no merge conflict at integration |
| `tools/site-build.mjs` | the mode blocks, `{{SW_OPERATOR_*}}` / `{{SW_PRICE_TEXT}}` / `{{SW_TRIAL_DAYS}}` / `{{SW_RETAIN_DAYS}}` / `{{SW_REQUIRED_FROM}}` placeholders (warned when missing), `names.js` for the nickname preview, `.site.json` (the mode), `<!-- when font=google|self -->` from the built game (true before and after C's self-hosted font), warnings when `SW_TRIAL_DAYS` / `SW_GRACE_DAYS` / `SW_RETAIN_DAYS` no longer match the legal pages' words |
| `tools/site-check.mjs` | the account pages: every Family page state at 360, 390, iPad 1024×768 and desktop (screenshots `.shots/site-acct-*.png`), no request to another site, no sideways scrolling, 44 px targets, headers (CSP, COOP, CORP, no cookie), the words of `/`, `/parents`, `/privacy`, `/terms` per mode, the player colors equal the game's picker |
| `tools/fake-accounts.mjs` | an in-memory stand-in with the §15.2 shape (the real `http.mjs` router and `entitlementOf()` over in-memory handlers) for `test:net`, `test:walkie`, `site-check` and `dev-accounts --fake` |
| `tools/test-net.mjs`, `tools/test-walkie.mjs` | the relay with accounts (§12.6 D), next to every existing test (without accounts) |
| `tools/e2e-accounts.mjs` | the ten scenarios of §12.8 against the real server, the real Stripe SDK and B's fake, A's memory mail capture and test clock, C's game; a scenario whose parts are missing is reported NOT RUN (exit 2), never a silent pass |
| `tools/dev-accounts.mjs` | `npm run dev:accounts`: local Postgres + the Stripe fake + the server with `MAIL_MODE=log`; `--fake` for the page alone |
| `.github/workflows/test.yml` | CI (§12.10): Postgres 16, Chromium, every suite |
| `docs/DEPLOY-RAILWAY.md` | Part 2: the dad's checklist of §14, steps 10–18, and what to watch |
| `docs/MULTIPLAYER.md` | Addendum D (the relay with accounts) |

### The Family page states (§9.2)

Sign in (email → six code boxes with `one-time-code`, resend after 30 s, "Use a different
email", "Kids never need an email") · the link page (`/account/verify#t=…`: the token leaves the
address bar at once, nothing happens without the button) · the notice (every section of
`GET /api/notice`, the box starts empty) · the plan (price and renewal terms next to the button,
the US box starts empty; one button with no trial, the free week and Start today with a trial;
Home Screen app → "open it in Safari") · back from Stripe ("Setting up…" → sync → "You're all
set!"; `usOnly` → "only in the United States for now, nothing more will be charged") · add the
first player (live preview through the game's own `names.js`) · the dashboard: the plan ribbon
for `trialing`, `active`, `past_due`, `canceling`, `lapsed`, `comp`, `none`; players with the two
switches and their own notices (locked with the reason and, in a trial, Start now), See her data,
Download her worlds (the game's own backup file), Rename, Delete (type the nickname); devices
(label, last used, lock to a player, rename, sign out; Set up a kid's device with the big code
and a 10-minute countdown; Kids play on this device); privacy and data (Download everything, the
consent history, `/privacy`, `/terms`, the privacy contact, Delete our account with the list of
what happens and DELETE typed); Sign out, Sign out everywhere, Play now · the email check dialog
("We emailed a code to b•••@gmail.com"; the 5-minute rule for deleting the account) · a kid
device opening the page · the account deleted (`410 family_gone`) · can't reach us.

## Contracts used (§15.2, the skeleton, A's and B's notes)

- `createServer({ accounts, hsts, maxPerFamily, recheckMs })`; `accounts` has the §15.2 shape.
  `recheck(claims, { fresh: true })` after an event (A's cache is already cleared by then; the
  second argument is only a hint), `recheck(claims)` from the sweep.
- `authorizeSocket` answers as A documents: in `optional`, no `p` is a legacy socket **with or
  without a session cookie** (A's deviation 1; the fake and Addendum D follow it).
- Claims: `{ sessionHash (hex or Buffer), familyId, playerId, nickname, canHost, canBuild,
  walkie, until }`. Events: `session {sessionHash}`, `family {familyId, deleted?}`,
  `player {familyId, playerId, deleted?}`.
- The page reads `GET /api/me`, `GET /api/family` (+ `elevatedAt`), `GET /api/notice`,
  `GET /api/devices` (a bare array, times in ms), `GET /api/family/audit`, the player and family
  routes, B's `checkout {trial, usResident}`, `sync {sessionId?}` → `{plan, usOnly?}`,
  `portal`, `start-now`. Every time may be ms or an ISO string.

## How to test

```
npm ci
npm run test:net                  # every relay test, with and without accounts
npm run test:walkie               # the walkie, plus the Family page's switch through the relay
node tools/site-check.mjs         # the home page (accounts off) and the account pages (fake accounts)
npm run e2e:accounts              # needs A, B and C in the tree (NOT RUN otherwise, exit 2)
npm run dev:accounts              # try it: http://localhost:8080/account (codes print in the terminal)
node tools/dev-accounts.mjs --fake --seed    # the page alone, a demo family
```

Numbers are in the section "Results" below.

## Results

(filled in at the end of the run: see below)

## The first integration run (A, B, C merged in a scratch tree, not committed here)

What it found on D's side, fixed in this branch: the e2e read emailed codes by time (the capture's
times are the app clock, which the test moves) → by position; the game's code box is the
dialog's `.sw-input`; a pairing reload was not waited for; the iPad (whose site data was cleared)
had the shared world only as a name until opened, so the offline scene opens it online first; a
device locked to a deleted player goes to the remaining player when there is only one (the
check accepts that); the player colors differed from the game's picker; the two plan choices of
a trial were squeezed on the iPad; the US-only return was not handled.

## Notes for integration

- **privacy.html / terms.html**: both B and D created them. D's branch now has B's files byte
  for byte (B's `3e214dc`), so the merge is clean as long as B does not change them again; if
  it does, take B's version.
- **A**: please add `purgeAfter` (ms, `families.purge_after`) to `GET /api/family`; the lapsed
  ribbon then says "Resting: the kids' worlds are kept until Jan 2." (§9.2). Without it the page
  says "kept for a while after a plan ends".
- **B**: `/terms` says there is no free trial. The e2e runs with `SW_TRIAL_DAYS=7` (to drive the
  free week and Start now, §12.8) and its build warns about exactly that, which is expected.
- **C (a bug the e2e shows, red until fixed)**: every new device that opened the game signed
  out in `required` mode is asked "This device has stickers and outfits from before. Whose are
  they?" at its first play (seen on the computer and on Mia's device). `profileHasPlay()` in
  `src/account/legacy.js` counts `coins > 0`, but `src/things/shops/coins.js` gives every
  profile 100 coins to start, so an untouched profile counts as played. Suggested: compare with
  the starting coins (or leave coins out). The e2e answers the card like a parent ("They're not
  ours") so the other scenarios still run, and fails one check naming the devices.
- **C (a bug the e2e shows)**: the same question comes back at every boot after it was
  answered. `askLegacy()` (`src/account/cards.js`) never reads `legacyState()`, so an iPad
  whose old worlds were imported (they are kept 30 days) or dismissed ("They're not ours") is
  asked again each time the game opens (§7.5: only while `sparkle-world:legacy` is neither
  `imported` nor `dismissed`; "Not now" asks again next time). Seen when Lily's iPad opens the
  game again in §12.8 #5.
- **C (a bug the e2e shows, red until fixed; children's data)**: a deleted player's copy stays
  on a device that was not playing her at that moment. `prepare()` in `src/account/index.js`
  wipes only on `410 family_gone`, or on `player_gone` while she is the chosen player; when the
  device opens again, `/api/me` simply no longer lists her, so `sparkle-world@p-<her id>` is
  never wiped (§3.4 / the delete dialog: "devices remove their copies the next time they open
  the game"). Suggested: on a successful online `/api/me`, wipe every id of `cache.used` that
  is not in `me.players` (same family), and drop it from the cache. Seen in §12.8 #8 (Mia's
  device reopened after A deleted her: the picker, but her database still there).
- **C (a suggestion)**: the game reads `why` from `/api/me` when it opens, so a child whose
  grown-up has just switched **Play with friends** on still sees "Playing with friends isn't
  ready yet" until the game is opened again. Asking `/api/me` again when she taps Play with
  Friends while `why` is set would make the switch feel instant (the e2e reopens the game there).
- **C**: a device locked to a player who is then deleted plays as the only remaining player
  (the lock is `on delete set null`); §12.8 #8 says "→ the picker", which is what it shows with
  two or more players left.
- The `stripe` SDK prints one `<claude-code-hint …/>` line on stderr when `CLAUDECODE` is set
  (only in this development environment); the e2e shows it as `[server!]`.

## Known gaps

- WebKit cannot be run offline here: the iPad checks (Home Screen app sign-in with the code,
  pairing, the walkie) are the dad's (§14 step 8, DEPLOY-RAILWAY step 17).
- The Family page computes "N days left" and "the check is still good" with the device's clock;
  the server decides (a wrong device clock costs at most one extra email check).
- The free week wording is written for 7 days ("Free week"); other trial lengths say "Free
  trial" and "N days".
