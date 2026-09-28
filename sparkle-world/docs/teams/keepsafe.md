# Team "keepsafe": keeping her worlds safe on the website

The dad asked: *"Can we ask the browser to save it like you suggested?"* On the Railway
website her worlds are saved only in the browser (IndexedDB → localStorage → memory,
`src/core/storage.js`). A browser may clear a website's storage when the device runs short of
space, and Safari on iPhone/iPad clears what a website stored after about 7 days without a
visit. There are no server saves (and none were added). What was built instead:

1. **Ask the browser to keep it** (`navigator.storage.persist()`).
2. **A copy in a file, every world at once**, with a gentle reminder on the title screen.

Inside claude.ai (`window.claude.use` exists) worlds already save to her account: none of
this shows or runs there, and none of it runs on `file://`. The family decided against an
"Add to Home Screen" suggestion: there is no such card, no web app manifest and no home-screen
app tags (the probe checks that they stay away).

## Files

| File | What |
|---|---|
| `src/core/keepsafe.js` | `KeepSafe` (`game.keepsafe`): where it runs (`hostKind()`: `'web'`, `'claude'`, `'file'`), the device (`deviceInfo()`: `ios` incl. iPadOS that says "Macintosh" with `maxTouchPoints > 1`, `standalone`), persistence, `backupDue()`, `report()` |
| `src/ui/keepsafe.js` | installs `game.keepsafe`; the title card; `saveAllWorlds(game)`; `openWorldFile(game)` with the in-page "is already here" question; action `saveAllToFile` |
| `src/core/storage.js` | `store.exportAll(profile)`, `store.importAll(text, { ask })`, `readWorldFile(text)`, `backupProfile()`, `mergeBackupProfile()`, `BACKUP_FORMAT` |
| `src/ui/dialogs.js` | `choiceDialog(ui, { title, body, text, note, choices, cancelValue, focus, className, makeButton, signal })` (any number of answers) |
| `src/ui/menus.js` | "Open a file" goes through `openWorldFile`; "Save" on a world emits `files:saved`; My Worlds has **Save all** (website only) |
| `src/core/diag.js` | `diag.report().storage = { backend, keepsafe: game.keepsafe.report() }` |
| `tools/probe-keepsafe.mjs` | end-to-end check through the real server (below) |

## 1. Persistent storage

On the website only: at boot (`game:ready`) `navigator.storage.persisted()`, and if it says no,
`navigator.storage.persist()`; again at her first tap / key press (`pointerdown`, `keydown`,
`touchend`, capture, once) if the answer is still no: `persist()` is then called right inside
the gesture (browsers say yes more readily after an interaction, or for an installed app).
One call at a time; everything is feature-detected and nothing throws. The answer is kept in
the profile:

```js
profile.keepsafe = {
  persisted: true | false | null,   // null: no Storage API
  askedAt, grantedAt,               // epoch ms (0 = never)
  installed: false,                 // running as a Home Screen app (display-mode standalone)
  lastBackupAt,                     // the last save to a file (one world or all)
  snoozeUntil,                      // "Not now"
  remindedAt,                       // the card was last shown
}
```

`game.keepsafe.report()` (in `diag.report().storage.keepsafe`): `{ host, ios, standalone,
persisted, asks, askedAt, lastBackupAt, snoozeUntil, estimate: { usageMB, quotaMB }, error }`;
outside the website only `{ host }`.

## 2. The backup card

On the title screen, 1.2 s after it opens (a quick Play skips it), at most once a session:
**"It's been a while! Save a copy of your worlds?"** with her own world pictures tucked into a
pink treasure box, **Save a copy** / **Not now**, and a small note for grown-ups. It shows only
when `game.keepsafe.backupDue(worlds)`:

- the website version (not claude.ai, not `file://`),
- the storage is at risk: `persisted !== true`, **or** an iPhone/iPad browser tab (not a Home
  Screen app), where the 7-day rule applies whatever the browser answers,
- she has worlds,
- no "Not now" waiting (7 days),
- the last copy in a file (`lastBackupAt`), or before the first copy her oldest world's
  `createdAt`, is 7 days old or more (a new player is not asked on day one).

Never while playing: it is only shown when the title is the open panel and nothing is loading,
and if a world starts loading while it is up (a Play tapped just before it appeared, friends
arriving), it closes unanswered and may come back next time on the title. It also waits while
another dialog is open or a "Keep playing" / "Join" chip is offered (friends first).

**Save a copy** saves every world in one file (`Sparkle World backup 2026-09-28.json`, through
the existing download path: an `<a download>` blob on the website) and toasts "Saved a copy of
your worlds!". **Not now**, Esc or a tap outside waits 7 days (a failed download: 1 day).
Every save to a file (this card, **Save all** in My Worlds, or **Save** on one world) emits
`files:saved { what: 'all' | 'world', id? }` and sets `lastBackupAt`.

## 3. The backup file and "Open a file"

```js
{ format: 'sparkle-world-backup', v: 1, about: '…', savedAt: ISO,
  profile: { look, outfits, playerName, nameSet, stickers, stickersSeen, stats, coins, basket, tutorialDone },
  worlds: [ <world save>, … ] }          // every world, not the "Before friends" side copies
```

Not in the file: `settings` (this device's volumes and quality, and a grown-up's walkie-talkie
OK, which stays per device), playing-with-friends ids (`profile.net`), `lastWorldId`,
`keepsafe`. A single-world file is still `{ format: 'sparkle-world', v: 1, save }`.

**Open a file** (My Worlds) takes both. `store.importAll(text, { ask })`:

- a world whose id is not here is added (a backup keeps its "Played …" days; one world opened
  from a file shows up first, as before);
- a world whose id **is** here is never replaced silently. In a backup, an unchanged one (same
  `updatedAt`) is skipped without asking. Otherwise `ask(conflict)` shows **"“Rainbow
  Meadow” is already here"** with both pictures ("Here now" / "In the file", "Played …",
  a **Newer** tag, the time when both are from the same day, "World 2 of 5 in the file"):
  **Keep the one here** (also Esc / a tap outside), **Use the one in the file**, **Keep both**
  (the file's becomes "Rainbow Meadow (copy)"). An unchanged single-world file says "They are
  just the same." with **OK** / **Keep both**.
- the backup's profile is merged by `mergeBackupProfile()`: nothing she has here is lost
  (stickers joined, coins / counters / basket keep the bigger number, empty outfit slots
  filled); her look, name and outfits come from the file only on a device with no worlds yet
  (a fresh profile, e.g. a new iPad). Then `profile:changed` is emitted.

Toasts: "Your worlds are back!" / "Your world is here!", or "You have all these worlds
already!" / "You kept your world." when nothing changed; a wrong file: "Hmm, that file is not a
Sparkle World." `store.importWorld()` (the old one-world import, a copy on a clash) is kept
for older callers.

## Tests

`node tools/probe-keepsafe.mjs [--no-build] [--headed]` (about 2½ minutes): builds, starts
`server/server.mjs` on a free port (stops only that process), then checks:

- no manifest, no `apple-mobile-web-app-*` / `mobile-web-app-capable` tags on the game page or
  the home page, `/manifest.webmanifest`, `/img/icon-192.png`, … are 404, and no "Home Screen"
  words in the game anywhere;
- desktop Chrome: `persist()` once at boot, once more at the first key press, never again;
  `profile.keepsafe` and `diag.report()` say so; the browser's real answer is recorded too;
- two worlds made today: no card; `lastBackupAt` 8 days ago: the card, with both pictures;
  "Not now" = 7 days and no card on the next visit; a quick Play: no card in the world, and
  asking while playing shows nothing; back on the title: the card; **Save a copy** downloads
  one file with both worlds, her look, coins and sticker and no settings; `lastBackupAt` = now;
  "Save" on one world and **Save all** count too;
- a fresh profile opens the backup: both worlds, her look, name, coins and sticker are back;
  opening it again after one world changed asks once (the unchanged world is skipped); Keep
  the one here / Keep both / Use the one in the file each do what they say; a one-world file
  that is already here: "They are just the same.";
- iPad Safari (UA + touch, 1024×768 and 768×1024), iPadOS that says "Macintosh" (touch points
  5) and an iPhone (390×844): the card shows although the browser says the storage is kept,
  fits the screen, big buttons; the question fits a phone; a Home Screen app
  (`navigator.standalone`), a Mac without touch and a desktop whose storage is kept: no card;
- `file://` and a claude.ai stand-in (`window.claude.use`): no card, `persist()` never called,
  no **Save all**, diag says only `{ host }`;
- zero console errors, page errors or failed requests.

Screenshots: `.shots/keepsafe-card-{desktop,ipad-landscape,ipad-portrait,iphone}.png`,
`keepsafe-conflict-{desktop,iphone}.png`, `keepsafe-restored.png`,
`keepsafe-worlds-save-all.png`. `tools/probe-menus.mjs` now answers the "already here"
question with **Keep both** when it opens the world it just saved.

## Left to check on real devices

- Whether Safari grants `persist()` for this site (it may say no in a browser tab; the card
  covers that case anyway) and where iPadOS puts the downloaded file (Files → Downloads).
- Firefox shows its own "store data in persistent storage?" prompt for `persist()`; one
  answer is remembered by the browser.
