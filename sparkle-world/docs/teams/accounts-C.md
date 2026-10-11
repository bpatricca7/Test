# Accounts, builder C: the game client and cloud saves

Scope: docs/ACCOUNTS.md §7 (the game with family accounts), §5.4 (the saves API) and the C
rows of §15.1. Everything here is inert until the site answers `accounts` in `/api/net`
(`SW_ACCOUNTS=optional|required`): with it unset the game makes exactly today's requests
(file:// and claude.ai: none at all), saves under exactly today's names, and the relay URL,
walkie gate and title are unchanged.

## What was built

| File | What |
|---|---|
| `server/saves.mjs` | `routes(ctx)`: profile GET/PUT, worlds list/GET/thumb/PUT/DELETE, portrait PUT/GET (§5.2, §5.4). Revisions with `If-Match` (428 without), 409 `{error:'conflict', rev, updatedAt}`, "the same save again" → 200 with the current rev, tombstones (410 `deleted`; a newer save resurrects; a delete of a world the server never had leaves a tombstone too, up to 1000 such per player, then `{rev: 0}` without one), side copies (`.before`/`.undo`: newest wins, never 409), quotas (60 live worlds, 100 MB per player, 300 MB per family → 413 `quota`), validation (id, name ≤ 80, blocks, size within `WORLD_SIZES`, finite `updatedAt`, JPEG thumbnail ≤ 72 KB), entitlement on writes (403 `not_entitled`, and `consent_required` when the family has no consent), reads while lapsed, portrait PNG ≤ 32 KB with its signature checked, `pg_advisory_xact_lock` per (player, world) around each write, gzip off the event loop. Limits: world/profile PUT and DELETE 12/min burst 20 per player; portrait 6/min per player. Imports `metaOf`/`isSideCopyId` from `src/core/storage.js` and `WORLD_SIZES` from `src/world/world.js`. |
| `src/core/storage.js` | `configure({ ns, cloud, mergeProfile, readOnly })`, `onFork`, `onProfile`, `static wipe(ns)`, `static legacy()`, `close()`, `forkName()`, `newWorldId()` exported. `dbName`/`lsPrefix` are instance fields. Revisioned backends only: revisions map (`<prefix>revs`), queued deletes (`<prefix>dels`), retries (30 s, 1, 2, then 5 min; `Retry-After` honored), one push at a time, reconcile after `init()` (`store.reconciled` for tests), tombstones, forks, profile merge on 409 and at load, downloaded worlds kept locally with their rev, unchanged pushes skipped for 5 min (FNV of the save minus player/time/hotbar/updatedAt/thumbnail). 400/413 on a world: not retried (the copy stays on the device). 401/403/410 (player_gone, family_gone): read-only, as today's permanent path. |
| `src/core/game.js` | `game.startHooks` (awaited after the texture build, before `store.init()`), the fork handler (the world she is in becomes the copy; toast; `world:forked` event). |
| `src/main.js` | installs `account` right after `ui`. |
| `src/account/index.js` | `install(game)` → `game.account`; boot (`/api/net` shared with the net facade, then `/api/me` only when accounts are on); modes local / account / visitor / blocked; picker; offline boot from `sparkle-world:acct` (signed out or a 401 forgets the cached `me`, so a signed-out device never boots a player offline); 410 family_gone / player_gone wipe; a player missing from `/api/me` that this device played is looked up once (`GET …/profile`): 410 → her copy here is wiped, 404 (another family's) → forgotten, not wiped; nickname enforcement; `switchPlayer()`; `setWalkie()`; the other player's import; "A grown-up can add you" (entitled, no players) stays in `required` and has an OK in `optional`. |
| `src/account/api.js` | fetch wrapper: `X-SW: 1` + JSON on writes, timeouts, errors `"<status> <code>"` with the answer's fields. |
| `src/account/cloud.js` | `HttpCloudBackend` (§7.3). |
| `src/account/merge.js` | `mergeProfile(local, server)`, `cloudProfile(p)` (§7.4). |
| `src/account/legacy.js` | first sign-in import (§7.5), `expireLegacy()` after 30 days (signed in only, and never while an old world was played after the import: signed-out play in `optional` uses the old names), `removeLegacy()`, `playedSince()`. The question is asked until answered (`imported` / `dismissed` in `sparkle-world:legacy`), then again only for old worlds played after the answer. |
| `src/account/picker.js` | "Who's playing?" (cards ≥ 120 px: portrait or bubble, last player first, Grown-ups / Back). |
| `src/account/cards.js` | the grown-ups' card, "I have a code", the blocking cards ("Ask a grown-up…", "resting", "no players", "Can't reach"), "Keep my old worlds safe", the import question. |
| `src/account/portrait.js` | head portrait via the Dress Up stage (once when missing, 10 s after a look change). |
| `src/net/transport.js` | `fetchNetInfo(env)` (one `/api/net` per page, failures not cached); `{t:'e'}` account codes while opening; NetError codes. |
| `src/net/ws-transport.js` | `&p=<player>`, `identity().canHost`, close codes 4401–4405 (no retries, opening or mid-session). |
| `src/net/session.js`, `protocol.js`, `ui.js`, `facade.js` | messages `signed_out`, `not_entitled`, `friends_off`, `friends_locked` (+ `cannot_host_acct` small print); a mid-session refusal says its own words; `mp-start` shows `why` at once; the facade passes `{ player, canHost }` for `ws`. `player_gone` has no words: the account module wipes and reloads. |
| `src/net/walkie/*` | account mode: `enabled` = `game.account.walkieAllowed`, `{t:'v', k:'perm', walkie}` handled, read-only Settings row; `openGate(game, { purpose: 'grownups', settings, save })`. The math gate is unchanged in local mode. |
| `src/ui/settings.js`, `src/ui/menus.js` | read-only name row, Grown-ups row and title tile, "Not Lily?" chip, visitor title. |
| `tools/build.mjs` | Fredoka (`site/fonts/fredoka-latin.woff2`) inlined as a `data:` `@font-face` in `dist/sparkle-world.html`; `dist/artifact.html` keeps the Google link. |
| `tools/test-saves.mjs` | the suite (below); `--measure`. |
| `docs/DESIGN.md` | storage note. |

## Contracts used (§15.2, the skeleton)

- Router: `body: { kind: 'world' }` for the world PUT (gzip, `SW_WORLD_MAX_BYTES` after
  decompression), JSON 256 KB + 4 KB for the profile, 48 KB for the portrait; `who: 'player'`
  (the router answers 401 / 404 / 410 player_gone); `x.player.family_id` for the family quota.
- `ctx.billing.entitlementFor(familyId)` → `{ entitled, consent }`.
- `ctx.savesLimits` (optional) overrides `SAVES_LIMITS` per server (tests).
- The game reads `/api/me` exactly as §5.3 (`players[].{id, nickname, color, portrait, friends,
  walkie, canJoin, canHost, walkieOk, why}`, `lockPlayer`, `playUntil`, `plan.entitled`,
  `friendsMode`, `kind`), `POST /api/auth/pair {code}`, `POST /api/auth/logout`,
  `POST /api/devices/this`, all with `X-SW: 1` and JSON.
- `game.account` for other modules: `mode`, `active`, `playerId`, `canHost`, `walkieAllowed`,
  `why`, `grownups`, `canSwitch`, `openGrownups()`, `switchPlayer()`, `setWalkie(on)`.

## How to test

- `npm run test:saves` (32 tests in 6 suites): the saves API (12), `mergeProfile` (2),
  SaveStore + HttpCloudBackend in Node (11), the account module's boot in Node (3), the relay
  socket's account close codes with a fake WebSocket (1), and the built game in Chromium (3;
  skipped without `dist/sparkle-world.html` or a Chromium, or with `SW_SAVES_BROWSER=0`). Runs
  on the test cluster and on PGlite (`SW_TEST_DB=pglite`). The Node boot tests and the browser
  part use a pretend `/api/me` (`meFor()`, §5.3; A's auth/family answer it for real) and the
  pretend session store of the API part.
- `node tools/test-saves.mjs --measure`: every biome × size saved by the built game (JSON and
  gzip sizes) against the caps.
- Regression gates with `SW_ACCOUNTS` unset: `npm run build`, `node tools/smoke.mjs`,
  `npm run test:net` (see the hand-off notes for numbers).

## Known gaps and notes for integration

- `site/parents.html` (D) still says the game loads the font from Google; with this build
  that sentence is false from the moment it merges (§9.5), so D should change it in the same
  merge.
- A 409 / 404 / 410 on `/api/*` shows as "Failed to load resource" in the browser console;
  D's e2e has to allow those for the conflict and deletion scenes.
- The account cache `sparkle-world:acct` keeps `/api/me` (nicknames, switches, `playUntil`) on
  the kid's device, as §7.8 says; sign-out does not wipe the player copies on the device (they
  come back when the device is signed in again); `family_gone` / `player_gone` do.
- `keepsafe` (this browser's storage state) is treated as device-local like `net` and
  `settings.walkie*` (never uploaded, always this device's in a merge).
- The legacy import runs only online (it needs the family's player list), on the title (never
  over her game).
- Visitor mode (`free-join`) is implemented minimally: no cloud, the title shows Play with
  Friends, Dress Up, Settings (and Grown-ups).
- `src/ui/keepsafe.js` (not C's) still offers "Save a copy of your worlds" every 7 days in
  account mode; with cloud saves on, its owner may want to skip the card while
  `game.store.cloudWritable` (the file copy still works and is harmless).
- **The self-hosted font changes the game's layout in these tests.** Before, the sandbox could
  not reach Google Fonts, so every browser test ran with the fallback font; now the real
  Fredoka is inside the page (as on the live site, where Google served it). One timing-fragile
  step in `tools/test-walkie.mjs` (D's file) then fails often: "June: turning the walkie off is
  one tap" (and so "June told the server voice off"). The event log shows the tap reaching
  `.sw-wk-setrow` instead of `.sw-wk-switch`: Playwright taps while the Settings panel is still
  opening. The same happens on the skeleton's own code once the font is inlined (1 of 3 runs of
  a focused repro), never with a 400 ms pause first (3 of 3). The fix is in the test: after
  `waitForSelector('.sw-panel-wrap.sw-open .sw-wk-setrow')` add `await settle(june.page, 700);`
  (as `grownUpTurnsOn` effectively does with `scrollIntoViewIfNeeded`). With that one line the
  whole `node tools/test-walkie.mjs` passes on this tree (198 checks, 0 problems); without it
  it failed 3 of 3 runs here, while the skeleton (fallback font) passed.
- Other browser probes that tap or press at computed points may shift the same way for the
  same reason (the real font is a little wider than the fallback); none is changed here.
- Bundle: `dist/artifact.html` grows by 30,502 bytes minified (29.8 KiB, the project's "KB"),
  `dist/sparkle-world.html` by that plus the font (≈ 39.8 KB as a `data:` URL, and the Google
  link goes). The budget of §15.4 has little room left.
