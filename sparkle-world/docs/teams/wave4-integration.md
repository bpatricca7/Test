# Wave 4 integration: squishy toys and presents, sea forms, dolphins and sea animals

The request (dad and daughter, 2026-10-04) asked for four things in one message: squishy toys
and "neatos", mystery presents unlocked with coins, dolphins and sea animals, and a water form
(a mermaid for a girl, a cool sea creature for a boy). Three teams designed them:

| team | doc | builds |
|---|---|---|
| **squish** | `docs/teams/squishies.md` | Puffums and Stretchums (48 toys), the Squish Shelf, mystery presents on coin milestones |
| **merfolk** | `docs/teams/merfolk.md` | Mermaid / Sea Dragon / Just Me in deep water, sea swimming, the Studio's Water tab, the underwater tint |
| **ocean** | `docs/teams/ocean.md` | nine sea animals, the dolphin ride, the whale, Sea Friends |

This document says **how the three fit together**, which file each team may change and where,
the order to build and merge, and the full gate before the deploy. It is binding for all three
builders: **where a team doc disagrees with this one, this one wins** (§2 lists every known
disagreement). Every `file:line` is the code at commit `669b6fa` on
`claude/girl-game-world-building-gp6bnl`.

Status: BUILT AND MERGED on `claude/wave4-integration` (§8); the docs commit of §11 is done; the full gate (§10) and the deploy are next. See "As built" at the end.

---

## 0. Decisions at a glance

| Question | Decision |
|---|---|
| Module names | `squish` (`src/things/squish/`), `ocean` (`src/life/ocean/`), `merfolk` (`src/player/merfolk/`). **No module, system, facade or debug object is called `sea`.** The word "sea" stays only in data names (`look.sea`, `SEA_FORMS`, `SEA_KINDS`, `sea:*` events) (§3). |
| Mermaid on a dolphin | The sea form **stays** while riding. The pose is merfolk's **side-saddle** (`poseSaddleSea`); ocean passes `seaRide` and `seaKick` and merfolk uses `seaKick` for the tail's beat. A dolphin mount always turns the sea gate on, including from a stopped boat (§1.1, §2 C2-C4). |
| Squishy toys in the water | A held toy **hides** while swimming, in sea form (leaps too) and on a dolphin with a tail. It stays in the hotbar slot and is never lost; presence `hi` keeps sending it. **Squish!** hides while the toy is hidden; **Put away** stays. "Hold it" in the water says the existing line "Swim to the shore first!". Just Me on a dolphin holds it, as on a pony (§1.2). |
| Stickers | 11 new: squish 4, ocean 5, merfolk 2. Each pays +20 coins through the normal path. Book order is fixed by the module order: **squish, ocean, merfolk** (§4.7). |
| Coins and presents | Every new coin source (stickers, the daily sea reward of at most 23 coins a day) goes through `game.coins.add`, so it raises `stats.coinsEarned` and fills the mystery present path. Nothing is bought, opening a present never costs coins (§1.3). |
| One thing at a time | On the first deep swim, the sticker pop, merfolk's choice bubble, ocean's dolphin bubble and the present drop never show together. Toasts already queue (§1.4). |
| Popups on automated browsers | Every popup a wave-4 team starts **by itself** (not from a tap) is off on `navigator.webdriver` pages unless that team's probe turns it on, so the 25 older probes see the game they know (§1.5). |
| Profile | New: `profile.squish`, `stats.squishes` (squish); `stats.seaMet`, `stats.dolphinRides`, `stats.seaCoinDay`, `stats.seaCoinMask` (ocean); `look.sea` (merfolk). Only squish changes merge rules, backups and the server (§4.4). |
| Presence | `st: 'm'` and two `lk` tail tokens (merfolk), `sr` and `sk` (ocean), new `hi` values `squish_*` / `squishg_*` (squish). One combined size test (§4.3). |
| Base commit | Before anyone builds, the integrator lands a **step 0** commit: one property per line in the hot literals, the shared name scanner, the split flags for the three long suites, and baseline timings (§6). |
| Build | Three worktrees in parallel. Browser suites run **one at a time** under a lock (§7). |
| Merge order | **merfolk, then squish, then ocean** (ocean rebases last and runs the cross-team pass). Then one docs commit, one build, the full gate, one push (§8). |
| Gate | Every command runs in the foreground with `timeout 570` (9.5 min). Anything that can take longer is split with its `--only` flags. About 4.5 hours of serial browser time in all (§10). |

---

## 1. How the three features fit together

### 1.1 The sea: a mermaid swims out and meets dolphins

1. She walks into deep water (2+ blocks). After 0.25 s she turns (merfolk): sparkles, the tail
   grows, the **Sea Magic!** sticker pops (+20 coins). She floats up to the surface within about
   2 s, where ocean's animals live (ocean.md §5.1: dolphins' backs and fins break the surface).
2. Swimming at 4.6 blocks/s (6.2 fast), she is in deep water, so the **first pod** comes to her
   within 10 s (ocean.md §3.3). The buddy dolphin's toast ("Splashy came to say hi!") queues
   behind merfolk's toasts.
3. She taps a dolphin within 5 blocks: it pops its head up and holds still, and the bubble offers
   **Ride** and **Trick**. **Dolphin Friend** pops (+20, plus +2 daily).
4. **Ride.** `player.mount()` with kind `'dolphin'`: merfolk's `mount()` keeps the tail (it cuts
   it for every other mount). The avatar shows the side-saddle pose; the tail beats in time with
   the dolphin (`seaKick`). The HUD shows Jump (the dolphin leaps), not Up / Down; the joystick
   says **Ride**; the camera uses ocean's `extraWant` and merfolk's `headY` rule is off while
   riding. **Dolphin Rider** pops (+20, +5 daily).
5. Jump: the dolphin leaps. That `'sea:leap' { riding: true }` also earns **Big Leap!**
   (merfolk listens to it, §2 C7).
6. **Hop off**: she lands in the water at `level + 0.1`, still a mermaid, no sparkle and no
   sound. The gate is still on, so Up / Down show again and the joystick says **Swim**.
7. Leaping on her own (fast + Up through the surface, merfolk): escorting dolphins leap beside
   her (ocean listens to `'player:leap'`).
8. Swimming to the beach she flops onto the sand and turns back after 0.35 s on land.

Boys get the same story with the Sea Dragon (or any child who picks it). Just Me swims with the
easy controls, rides in the saddle pose with legs, and earns every sticker except Sea Magic!
(which needs a tail, by design).

### 1.2 Squishy toys around the water

- The avatar's rule (merfolk owns `avatar.js`): `heldBone.visible = !sleeping && !swimming &&
  !tail`. So a held Puffum hides while she swims (today's rule, `avatar.js:915`), while the tail
  is out (leaps included) and while she rides a dolphin with a tail (her hands are on the fin). A
  Just Me rider shows it, like a pony rider today.
- The toy is never taken out of the slot, and presence `hi` keeps sending it, so friends' pages
  (which run the same avatar rule from her `st`) also hide it and show it again on land.
- **Squish!** (life HUD, squish) shows only while the toy can be seen:
  `holding && game.player.avatar.heldShown !== false`. Merfolk adds the one-line getter
  `get heldShown()` to the avatar API (§5, `avatar.js`). **Put away** keeps showing, so she can
  always clear the slot.
- **Hold it** (shelf or unwrap) while `player.swimming || player.seaForm`: the toy goes to the
  slot as usual, and the toast is the existing line **"Swim to the shore first!"** instead of
  "You're holding the ...! Press Squish!". No new string.
- Choosing a toy in the Bag while riding a dolphin selects Build, and ocean's tool lock switches
  back to Hand with "Hop off first!", the same as choosing a block while driving today. Accepted.
- Squish's `avatar.hold(obj)` (an item in the hand) is not merfolk's cut hook `player.hold()`
  (the zip line state). Builders must not confuse the two.
- The sea toys tie the features together in her hands: the **Dolphin Puffum** (ocean's `sky`
  dolphin colors, the 2nd present on Mix, the 4th on Girl or Boy), the **Starfish Squeeze**
  (ocean's `orange` starfish), the **Seashell Squeeze**, the **Mermaid Tail** Puffum and the
  **Sea Dragon Puffum**. The last two use merfolk's own motifs (§2 C9).

### 1.3 Coins, stickers and presents: one loop

All new coins go through `game.coins.add(n, reason, { at })` (`src/things/shops/coins.js:91`),
which raises `coins` and `stats.coinsEarned` and flies coins to the pill:

| source | coins | team |
|---|---|---|
| 11 new stickers, once each | 11 x 20 = 220 | all |
| first hello to each sea kind each day | +2, at most 18 a day | ocean |
| first dolphin ride each day | +5 a day | ocean |

Squish's milestones count `earned = max(coinsEarned, coins - 100)` (squishies.md §3.2), so sea
play keeps filling the next mystery present (220 coins of stickers is about 3 presents at the
start of the path). Spending in the candy shop never moves the ring. Opening a present never
costs coins. No new text mentions prices, buying or coin amounts next to a present.

A kid's first session in a new build can therefore bring: up to 3 welcome presents (squish), Sea
Magic!, Dolphin Friend, Dolphin Rider, Big Leap!, Sea Explorer. §1.4 keeps those moments apart.

### 1.4 One thing at a time (binding rules)

| moment | waits for | owner |
|---|---|---|
| sticker pop | the existing pop queue (`src/life/stickers.js:72-198`) | existing |
| merfolk's first-turn choice bubble | the Sea Magic! pop to be gone (merfolk.md §5.2: 2.6 s after the first-ever turn); **no dolphin bubble open; not riding** | merfolk |
| ocean's dolphin bubble (Ride / Trick) | nothing: it comes from a tap. Opening it **closes merfolk's choice bubble** (counted as one showing, the form stays `'auto'`) | ocean (reads merfolk's bubble through the DOM class it closes, `lf-bubble[data-owner="merfolk"]`) |
| squish's present drop | its copied `blocked()` rule (no panel, dialog, photo, fade, sticker pop, tip; squishies.md §6.4) **plus: no `.lf-bubble` shown** (a pet's, a dolphin's or merfolk's) | squish (`src/things/squish/fx.js`) |
| toasts ("Mermaid magic!", the dive tip, the buddy, "You met ...") | the `ui.toast` queue (`src/ui/ui.js:98-104`); merfolk's dive tip already waits for its bubble | existing |
| NPC friend lines | ocean's `'sea:meet'` skips `quiet: true` (a sticker said it); merfolk's `'player:seaform'` line is once per world visit | ocean, merfolk |

Both bubbles carry a `data-owner` attribute (`merfolk`, `ocean`) so the other side can find them
without importing anything.

### 1.5 Automated browsers (`navigator.webdriver`)

Today the daily gift (`coins.js:252-257`) and squish's drop, Present button and ring animation
stay off on webdriver pages unless asked. Wave 4 extends the rule to every popup that starts by
itself, so older probes do not meet surprise toasts, bubbles or pops in their scenes:

| popup | off on webdriver unless | owner |
|---|---|---|
| present drop, Present button, ring wiggle / hop / sparkle | `game.debug.squish.presents(true)` | squish (already in its doc) |
| merfolk's first-turn bubble, dive / leap / pool tips | `game.debug.merfolk.tips(true)` | merfolk (new; its probe's B17, B18 turn it on) |
| ocean's buddy toast, pool toasts, whale toast and pointer, "Stop the boat" / "Swim out" toasts | `game.debug.ocean.popups(true)` | ocean (new; its probe turns it on in the passes that check them) |

Not included (they come from a real action and older probes already live with them): sticker
pops, the sea form itself, first-meet toasts after a tap. The animals themselves still swim on
webdriver pages; probes that measure draw calls near water call `debug.ocean.pause(true)` (§9.3).

### 1.6 Playing together

- Each player's collection, presents, Sea Friends and stickers are their own; nothing enters
  the host world. Sea animals are per page, with the shared moments ocean defines (buddy
  dolphin, whale times, `sr` rides, `sk` tricks).
- A friend sees: her tail form and color (`lk`), "in sea form" (`st: 'm'`), the dolphin under a
  rider (`sr`) with her tail side-saddle, a dolphin trick beside her (`sk`), and her held toy
  (`hi`, hidden by the same avatar rule while she swims).
- A guest can place a toy in the host's world (ordinary `e+`). Nothing else from wave 4 is in the
  journal.

---

## 2. Corrections to the team docs (binding)

The integrator copies these into the three docs in the docs commit (§11). Builders follow them
now.

| # | doc and place | says | correct |
|---|---|---|---|
| C1 | merfolk.md header (`:22-28`), §4.4 `main.js` row, §13 "Names", §14.3 debug API; ocean.md header (`:16-21`), §12.3 `main.js` row | each says the *other* team owns `sea` (`src/life/sea/`, `game.sea`, `game.debug.sea`; or `src/player/sea/`, system `sea`) | Ocean is `ocean` everywhere (`src/life/ocean/`, `import * as ocean`, system `ocean`, `game.ocean`, `game.debug.ocean`). Merfolk is `merfolk` everywhere. Merfolk's probe calls `game.debug.ocean.deepSpot()`, `game.debug.ocean.shoreSpot()` and (B10b) `game.debug.ocean.ride()`. |
| C2 | ocean.md §0 "Sea form while riding", §15 quoted text | the rider lies along the dolphin's back, hands on the fin | **Side-saddle** as merfolk.md §6.4 `poseSaddleSea` (merfolk owns the avatar). Ocean's `seatWorld` stays the seat point. R10 screenshots go to the daughter; if she prefers lying along the back, merfolk changes the pose only. |
| C3 | merfolk.md §4.2 `mount` | `if (!this.seaGate.on && this.swimming) { force(); _seaIn(form) }` | `if (m && m.kind === 'dolphin') { if (!this.seaGate.on) { this.seaGate.force(); this.seaSwim = true; this._idleVT = BUOY_DELAY; this._seaIn(form); } } else this._seaCut();` Two fixes: **`seaSwim = true`** (without it the gate is on but `seaSwim` stays false forever, so after Hop off the Up / Down buttons and the "Swim" label never come back), and **no `this.swimming` test** (a dolphin is always in water 3+ deep; mounting from a stopped boat has `swimming` false). `seaSwim` changes emit `'player:seaswim'` as everywhere else. |
| C4 | merfolk.md §4.4 merged `_syncAvatar` literal | no `seaKick` | add `seaKick` (ocean.md §6.5); merfolk's `poseSaddleSea` uses it as the tail phase when finite, else its own 1.2 rad/s beat (friends' pages have no `seaKick`) (§5.2). |
| C5 | merfolk.md §4.4 merged remote `_frame` literal | `speed: f.speed` | keep today's line `speed: st === 's' \|\| st === 'z' \|\| st === 'h' \|\| st === 'l' ? 0 : f.speed` (`remote-players.js:463`). Ocean passes `f.speed` to `remoteRide` separately. |
| C6 | ocean.md §5.2, §15 | escort uses `game.seaSwimmers()` "when merfolk provides it" | merfolk provides none in v1 (merfolk.md §13). Ocean uses its fallback only: friends with `st === 'i' \|\| st === 'm'` and friends' boats. |
| C7 | merfolk.md §10.3 `big_leap` | awarded on the first `'player:leap'` | also on the first `'sea:leap'` with `riding: true` (a string listener, no import; harmless before ocean lands). |
| C8 | ocean.md §7 joystick label; merfolk.md §4.2 `touch.js` | ocean: "Swim" while `player.swimming`; merfolk: "Swim" while sea swimming | One label function (§5.2): Drive / Steer in a vehicle, **Ride** on a dolphin, **Swim** while `player.seaSwim`, else **Walk**. Shallow water stays "Walk" as today. |
| C9 | squishies.md §3.1 row 24, §8.1, §13 | Sea Dragon Puffum: "a pointed three-tip tail fin, fan frills by the head, shiny scale pixels on the cheeks" | Use merfolk's Sea Dragon motifs (merfolk.md §0, §7): a **rounded fan fluke with five soft ribs** (no pointed tips), **round bubble-dome spikes** along the back, **leafy fronds** on the tail, **glow-spot** pixels, **two soft horn nubs**. Main color merfolk's Deep teal `#2FB5B0`, accent gold `#FFD43B`. The Mermaid Tail Puffum's main color becomes merfolk's default Sea green `#3FD8B0` with the round two-lobed fin. Decided before `ITEMS_V1` is pinned (colors are not pinned, keys are). |
| C10 | ocean.md §12.3 `game.js` row | "squishies & presents: `defaultProfile`" | squish does not touch `game.js` (squishies.md §3.3). Ocean is the only wave-4 team in `game.js`. |
| C11 | merfolk.md §4.4 `wardrobe-data.js` row | "squishies only if they take their optional `'squish'` emote" | squish changes neither `wardrobe-data.js` nor `EMOTES` (squishies.md §4.2). `EMOTES` is untouched in wave 4. |
| C12 | squishies.md §4.4 `hud.js` row | merfolk "maybe a Dive button" | merfolk reuses the fly Up / Down buttons (merfolk.md §5.3); no new HUD button. |
| C13 | squishies.md §4.3 `test-name.mjs`, §14.1 A13; ocean.md §13.1 S9 | the forbidden names written literally in a regex / test file | one shared scanner, `tools/lib/name-scan.mjs`, with the lists stored encoded (base64), made in step 0 (§6). The owner's rule is "never", so no test file spells them either. |
| C14 | ocean.md §12.1 `stickers.js`; merfolk.md §4.1 `stickers.js` | both export `installSeaStickers(game)` | ocean: `installOceanStickers`, merfolk: `installMerfolkStickers` (no clash today, but one grep should find one function). |
| C15 | ocean.md §13.2 N2; squishies.md §14.2 N3; merfolk.md §14.2 | three separate presence-size tests | one combined worst case, owned by ocean (it merges last) (§4.3). |
| C16 | merfolk.md §5.1 | the Water tab's "new" dot uses class `sw-new` | `sw-new` already means "the highlighted world card" (`src/ui/menus.js:131`, `:705`). Use `sw-tab-new`. |
| C17 | all three docs, "DESIGN.md section" | each asks the integrator for a §7 | DESIGN.md gets **one** `## 7. Wave 4: sea forms, sea friends, squishy toys and presents (added 2026-10-04)`, with 7.1 merfolk, 7.2 squish, 7.3 ocean (merge order). Builders do not edit DESIGN.md, MULTIPLAYER.md, DATA-MAP.md, `site/index.html` or each other's team docs: they list the wanted text in their own doc's "As built", and the integrator writes all of it once (§11). |

---

## 3. Namespaces (nothing may collide)

| kind | squish | merfolk | ocean |
|---|---|---|---|
| folder | `src/things/squish/` | `src/player/merfolk/` | `src/life/ocean/` |
| `main.js` import name | `squish` | `merfolk` | `ocean` |
| systems (`addSystem` name) | `squish-presents` (and any others prefixed `squish`) | `merfolk` | `ocean` |
| facade | `game.squish` | none (`game.underwater`) | `game.ocean`, `game.removeLock`, `game.stickerBookExtras` |
| debug | `game.debug.squish` | `game.debug.merfolk` | `game.debug.ocean` |
| events | `squish:get`, `squish:squeeze`, `present:ready`, internal `squish:refresh` | `player:seaform`, `player:leap`, `style:changed`, internal `player:seaswim` | `sea:meet`, `sea:ride`, `sea:hopoff`, `sea:leap`, `sea:trick`, `sea:whale` |
| panels / actions | panels `squish`, `present`; action `squish` | Studio tab `sea` ("Water") | none (the dolphin bubble is not a panel) |
| entity keys / Bag | `squish_<key>`, `squishg_<key>`, `toy_shelf`; Bag tab `squish` after `fun` | none | none |
| thumbnails / texture keys | `game.thumbs` keys start `squish:` | texture cache `sea\|scale\|…`, `sea\|fin\|…`; Studio snapshot keys `sea\|…` | `game.thumbs` keys `sea:<kind>:<variant>` |
| `.shots` prefix, probe, Node test | `squish-*`, `probe-squish.mjs`, `test-squish.mjs` | `merfolk-*`, `probe-merfolk.mjs`, `test-merfolk.mjs` | `ocean-*`, `probe-ocean.mjs`, `test-sea.mjs` |
| fixtures | `squish-rich-profile.json` | `merfolk-old-profile.json` | `ocean-beach-669b6fa.json` |
| device keys (`store.deviceSet`) | `squishPathTip`, `squishPillTip`, `squishPlaceTip`, `squishBagTip` | `seaHints`, `seaAsked`, `seaTabSeen`, `seaPoolHint`, `seaLeapTips` | none |
| toast keys | prefix `squish-` | prefix `sea-form-` | `sea-meet`, `sea-shallow`, other `sea-` keys |
| CSS class prefix | `sq-` | `mf-` (plus the shared `lf-bubble`, `sw-underwater`, `sw-pulse`, `sw-tab-new`) | `oc-` (plus the shared `lf-bubble`) |

Device keys in use today: `nameAsked`, `surpriseStyle`. None of the new ones clash. Existing
event names checked: none of the new ones exists today.

---

## 4. Shared data contracts

### 4.1 Append-only lists (never remove, rename or reorder)

| list | owner | why | guard |
|---|---|---|---|
| `SEA_FORMS`, `SEA_COLORS` (`wardrobe-data.js`, after `BROWS`) | merfolk | look codec sends indices | merfolk A1, test-net codec `lists` |
| every existing look list, `EMOTES` | (boys) | look codec | probe-boys A1 (untouched in wave 4) |
| `SEA_KINDS`, every `PALETTES[kind]` (the **dolphin** palette is sent by index in `sr` and `sk`) | ocean | presence, `stats.seaMet` keys, Ocean Star = first 9 | ocean S7 |
| `ITEMS`, `PRESENT_ORDER` | squish | keys in profiles, worlds and presence `hi` | squish A2 (`ITEMS_V1`, `ORDER_V1` pinned after the owner review, §7.3) |
| sticker ids (11 new, §4.7) | each | saved in `profile.stickers` | the cross-team check X6 |

### 4.2 The look codec tail

Only merfolk appends: two tokens after the jersey number (form index, color index), **left out
for the default `auto` + Match**, so today's strings, the boys goldens and `probe-boys` A3 / A9
stay exactly the same (merfolk.md §3.3). Worst case 156 characters (limit 160). The rule for any
later wave: a token appended after these must write the sea pair (`0.-`) first. Squish and
ocean change nothing in `codec.js`.

### 4.3 Presence

| field | change | owner | parse |
|---|---|---|---|
| `st` | new letter `m`: in sea form, not riding (a rider stays `h`) | merfolk | existing (one character) |
| `lk` | `packLook(withResolvedSea(look, style))`: never `auto`, never the style | merfolk | existing |
| `hi` | may also be `squish_<key>` / `squishg_<key>` (at most 28 characters) | squish | existing `HELD_KEY_RE` |
| `sr` | dolphin ride, palette index 0..15 | ocean | `parseSeaRide` (new) |
| `sk` | trick counter 0..65535 | ocean | `parseSeaTrick` (new) |

No protocol bump (peers share the build id). The combined worst case, owned by ocean's
`seaTests()` (it merges last): four players each with `st: 'm'`, a 156-character `lk`,
`hi: 'squishg_' + a 20-character key`, `sr: 15`, `sk: 65535` and the worst `vh`: host presence
at most 3,900 B (`STATE_BYTES`, `protocol.js:26`).

### 4.4 Profile and world saves

| key | owner | merges | backup / server |
|---|---|---|---|
| `profile.squish` (new top level) | squish | `mergeSquish` (union of toys, base rule) in `account/merge.js` and `storage.js` `mergeBackupProfile` | added to `BACKUP_PROFILE_KEYS`; the `putProfile` guard in `server/saves.mjs`; `legacy.js` `profileHasPlay` |
| `stats.squishes` | squish | existing per-key max | existing |
| `stats.seaMet` (map), `stats.dolphinRides`, `stats.seaCoinDay`, `stats.seaCoinMask` | ocean | existing nested max (`merge.js:14-22`, `storage.js:131-142`) | existing |
| `look.sea = { form, color }` | merfolk | the look travels whole (newer wins) | existing |

`defaultProfile` (`game.js:41-57`) is not changed by anyone. No world save changes, except that
toys placed in a world are ordinary entities. Old saves: each team's old-profile checks (squish
E1-E3, merfolk B14, ocean D1-D3) run on the merged tree too. The Girl / Boy / Mix pick is read
on the device only (squish orders presents with it; merfolk resolves `'auto'`), never stored.

### 4.5 Life HUD column (`lifeHud`, `src/things/pets/kit.js:345-383`)

| key | label | order | shown | owner |
|---|---|---|---|---|
| `hopoff` | Hop off | 0 | riding a pet | existing (pets) |
| `vgetout`, `vlights` | Get out, Lights | 0, 1 | driving | existing (vehicles) |
| **`seahop`** | Hop off | 0 | riding a dolphin | ocean |
| **`present`** | Present | 5 | a present is ready | squish |
| `basket` | Basket | 10 | | existing |
| `pets`, `friends` | | 20, 25 | | existing |
| `treat-eat`, `treat-away` | Eat, Put away | 30, 31 | holding a treat | existing |
| **`squish`** | Squish! | 32 | holding a toy that shows (§1.2) | squish |
| **`squish-away`** | Put away | 33 | holding a toy | squish |

She is never on two mounts at once, so the order-0 buttons never meet. On phones the labels are
hidden, so the three new squish icons and ocean's `dolphin` / `hopoff` icons must differ (squish
C5, ocean U1).

### 4.6 Icons and pictures

| file | entries | owner | anchor (insert right after) |
|---|---|---|---|
| `src/things/pets/kit.js` `PATHS` (life icons) | `present`, `squish`, `shelf` | squish | `eat:` |
| same | `dolphin` | ocean | `hopoff:` |
| `src/ui/icons.js` `PATHS` | `tail`, `deep` | merfolk | the end of the object |
| `src/ui/touch.js` `PICS` | `tail` | merfolk | the last existing picture |
| same | `dolphin` | ocean | merfolk's `tail` (keep both on conflict) |
| `src/ui/dressup/pictures.js` | `sea`, `match`, `mermaid`, `sea_dragon`, `me` | merfolk | |

Different anchors mean the two teams in `kit.js` never touch the same lines.

### 4.7 Stickers (registered on `game:ready`; book order = install order)

Every team registers its stickers on `game:ready`; listeners run in install order, so the
`main.js` order (§5.1) fixes the book: core and older teams first, then

| # | id | name | team |
|---|---|---|---|
| 1-4 | `squish_first`, `squish_ten`, `squish_all`, `squish_squeeze` | First Present!, Squish Collector, Squish Champion, Squeeze Me! | squish |
| 5-9 | `dolphin_friend`, `dolphin_rider`, `sea_explorer`, `ocean_star`, `whale_hello` | Dolphin Friend, Dolphin Rider, Sea Explorer, Ocean Star, Whale Hello! | ocean |
| 10-11 | `sea_magic`, `big_leap` | Sea Magic!, Big Leap! | merfolk |

None of the ids exists today (the existing `splash`, "Splash!", is a different sticker). The
total grows by 11 from today's live `game.stickers.total()`; probes read it live and never pin
it. Every award listener starts with `if (game.net?.remoteApplying) return;`. Each sticker pays
+20 through the existing `sticker:earned` listener.

### 4.8 Bag, panels, title, pause menu

Only squish adds a Bag tab (`squish`, spliced right after `fun` at install, so it lands between
Fun & Toys and Camping), panels (`squish`, `present`), a pause-menu button and (if the 5-tile
check passes, squishies.md Q5) a title tile. Ocean adds a Help card and the Sea Friends strip
(through the new `game.stickerBookExtras` hook). Merfolk adds the Studio's Water tab and two Help
cards.

---

## 5. SHARED FILES: who changes what

Builders edit only the lines listed for them, keep **one property or entry per line**, and on a
conflict **keep both sides in merge order (merfolk, squish, ocean)**. Step 0 (§6) reformats the
two single-line hot spots so most merges are pure line additions.

### 5.1 Game source

| file | merfolk | squish | ocean |
|---|---|---|---|
| `src/main.js` | import + module `merfolk` right after `stickers` | import + module `squish` right after `vehicles` | import + module `ocean` right after `collectibles` |
| `src/core/game.js` | — | — | `pick()` `throughLiquid`; `removeTarget` `removeLock` |
| `src/core/input.js` | `downKey` line after `:162` | — | — |
| `src/core/storage.js` | — | `BACKUP_PROFILE_KEYS`, `mergeBackupProfile`, `profileStale` in `loadProfile` | — |
| `src/core/squish-merge.js` (new) | — | all | — |
| `src/account/merge.js`, `legacy.js`, `portrait.js` | `portrait.js` `send` key | `merge.js` one line + import; `legacy.js` `profileHasPlay` | — |
| `server/saves.mjs` | — | `putProfile` guard | — |
| `src/world/physics.js` | `move` `swim` option, `grounded` | — | — |
| `src/player/wardrobe-data.js` | `sea` schema, default, lists, `KEYS`, `normalizeLook`, `randomLook` wrapper | — | — |
| `src/net/codec.js` | imports, `L`, `packLook` / `unpackLook` tails | — | — |
| `src/player/avatar.js` | everything sea (§4.2 of merfolk.md) **plus `get heldShown()`** (§1.2) | — | — |
| `src/player/player.js` | water block `:129-170`, gate, `mount` (C3), cut hooks, `_onKey` second line, `_syncAvatar` `sea` / `seaCut` | — | `_onKey` first line (`'dolphin'`), `_syncAvatar` `seaRide` / `seaKick` |
| `src/player/camera.js`, `emotes.js` | `headY`; emote wheel rule | — | — |
| `src/ui/hud.js` | `refreshFly` (`sea` rule) and its refresh events `'player:seaswim'`, **`'sea:ride'`, `'sea:hopoff'`** (strings; so mounting from the water hides Up / Down at once) | coin pill becomes a button, the ring, `refreshRing` | — |
| `src/ui/touch.js` | the label function (§5.2) with the Swim branch; help cards; `PICS.tail` | — | the Ride branch in the label function; `PICS.dolphin`; help card rows |
| `src/ui/icons.js` | `tail`, `deep` | — | — |
| `src/ui/ui.js` | — | — | toast `opts.img` |
| `src/ui/photo.js` | `hy`; underwater tint in the compose | — | — |
| `src/ui/inventory.js` | — | `TAB_COLORS.squish` (+ an `onTab` line if needed) | — |
| `src/ui/menus.js` | — | pause-menu button (+ title tile if Q5 passes) | — |
| `src/ui/stickerbook.js` | — | — | `stickerBookExtras` hook |
| `src/ui/dressup.js`, `dressup/stage.js`, `dressup/pictures.js`, `dressup/debug.js` | all wave-4 changes | — | — |
| `src/things/pets/kit.js` | — | `PATHS`: `present`, `squish`, `shelf` after `eat:` | `PATHS`: `dolphin` after `hopoff:` |
| `src/things/vehicles/index.js` | — | — | `pose()`; `park({ reason: 'sea' })` |
| `src/things/friends/friend.js` | sea gate, `seaAuto`, `netSample` `m`, puppet | — | — |
| `src/things/friends/chat.js` | `LINES.events['player:seaform']` | — | `LINES.events['sea:meet']`, `['sea:ride']`; `LINES.seaKinds`, `LINES.seaInvite`; `contextLines` |
| `src/things/friends/index.js` | its own once-per-visit `'player:seaform'` listener | — | `'sea:meet'` (skipping `quiet`), `'sea:ride'` in the react list `:760` |
| `src/net/adapter.js` | `st` line, `_lk` (resolved sea), `'style:changed'` drops `_lk` | `heldKey()` split into `treatHeld()` / `squishHeld()` | `sr`, `sk` in `local()`; `seaRideField()`, `seaTrickField()` after `vehicleField()` |
| `src/net/host.js` | — | — | `avatarFields`: `sr`, `sk` after `vh` |
| `src/net/protocol.js` | — | — | `parseSeaRide`, `parseSeaTrick` after `parseVehiclePresence` |
| `src/net/remote-players.js` | `_frame` flags (§5.2), `_ingest` `stSeen` sparkle, name tag and bubble heights | `heldModel()` squish branch | `_ingest` `sr` / `sk`, `remoteRide` call, `seaRide` flag, `_drop`, `clear()`, `list()`; `f.sr = null` where a friend is made |
| `src/life/stickers.js`, `src/core/registry.js`, `src/things/entities.js`, `coins.js`, `treats.js` | — | — | — (nobody) |

### 5.2 The merged literals (what the code looks like after all three merges)

`src/net/adapter.js` `local()` (step 0 splits today's one-line `return`, `:591`):

```js
    const st = pl ? (pl.seaForm && pl.state !== 'ride' ? 'm' : ST[pl.state] || 'w') : 'w'; // merfolk
    ...
    return {
      p,
      st,
      nm,
      lk: this._lk,              // merfolk: packLook(withResolvedSea(look, style))
      hi: this.heldKey(),        // squish: treatHeld() || squishHeld()
      vh: this.vehicleField(),
      sr: this.seaRideField(),   // ocean
      sk: this.seaTrickField(),  // ocean
    };
```

`src/player/player.js` `_onKey` (`:56`) and `_syncAvatar` (`:207-215`):

```js
    if (this.state === 'ride' && this.mountPet && (this.mountPet.kind === 'vehicle' || this.mountPet.kind === 'dolphin')) return; // ocean
    if (this.seaSwim && this.swimming) return;                                                                                       // merfolk
...
    const dolphin = this.state === 'ride' && !!this.mountPet && this.mountPet.kind === 'dolphin';   // ocean
    this.avatar.update(dt, {
      speed: Math.hypot(this.velocity.x, this.velocity.z),
      onGround: this.onGround,
      swimming: this.swimming,
      flying: this.flying,
      sitting: this.state === 'sit' || seated,
      sleeping: this.state === 'sleep',
      riding: this.state === 'ride' && !seated,
      seaRide: dolphin,                                    // ocean
      seaKick: dolphin ? this.mountPet.kick : 0,           // ocean (merfolk clamps a non-finite value to its own beat)
      sea: !!this.seaForm,                                 // merfolk
      seaCut: this._seaCutFrame,                           // merfolk
    });
```

`src/player/player.js` `mount` (`:329`), merfolk's lines first: C3 above.

`src/net/remote-players.js` `_frame` (`:455-472`):

```js
    const seated = f.st === 'h' && !!f.vehicle;
    const seaRide = f.st === 'h' && f.sr != null && !f.vehicle;                                   // ocean
    if (f.vehicle) f.vehicle.update(...);                                                         // unchanged
    if (g.ocean) g.ocean.remoteRide(f.peer, seaRide ? f.sr : null, f.pos.x, f.pos.y, f.pos.z, f.yaw, f.speed, show); // ocean (every frame, also when frozen)
    if (show && dist < ANIM_FREEZE) {
      const st = f.st;
      const sea = st === 'm' || seaRide;                                                          // merfolk
      const inLiquid = st === 'm' && g.physics ? g.physics.liquidAt(f.pos.x, f.pos.y + 0.6, f.pos.z) : false; // merfolk
      av.update(dt, {
        speed: st === 's' || st === 'z' || st === 'h' || st === 'l' ? 0 : f.speed,               // unchanged (C5)
        onGround: st !== 'f' && st !== 'i' && st !== 'l' && st !== 'm',                          // merfolk adds 'm'
        swimming: st === 'i' || inLiquid,                                                         // merfolk
        flying: st === 'f',
        sitting: st === 's' || seated,
        sleeping: st === 'z',
        riding: st === 'h' && !seated,
        seaRide,                                                                                  // ocean
        sea,                                                                                      // merfolk
      });
```

`src/ui/touch.js` joystick label (`:131-135`; merfolk replaces the three event lines with this,
ocean adds its branch and event names):

```js
    let vehicleKind = null;
    const setLabel = () => {
      const pl = game.player;
      joyLabel.textContent = vehicleKind ? (vehicleKind === 'boat' ? 'Steer' : 'Drive')
        : pl && pl.state === 'ride' && pl.mountPet && pl.mountPet.kind === 'dolphin' ? 'Ride'    // ocean
        : pl && pl.seaSwim ? 'Swim'                                                              // merfolk
        : 'Walk';
    };
    game.events.on('vehicle:drive', (e) => { vehicleKind = e && e.kind === 'boat' ? 'boat' : 'car'; setLabel(); });
    for (const ev of ['vehicle:park', 'world:unload']) game.events.on(ev, () => { vehicleKind = null; setLabel(); });
    for (const ev of ['player:seaswim', 'sea:ride', 'sea:hopoff']) game.events.on(ev, setLabel);
```

This gives ocean's R5 ("Swim" after Hop off in deep water: the gate is still on), R9 ("Walk"
after a teleport: `_seaCut()` cleared `seaSwim`) and merfolk's T1 (Walk / Swim / Walk).

`src/main.js` `modules` (step 0 puts one module per line):

```js
  theme, ui, account, blocks, worldgen, avatar, player, emotes, entities, furniture, prefabs,
  pets, garden, cooking, vehicles,
  squish,        // wave 4: after vehicles (needs entities, furniture, cooking/shops' game.coins)
  daynight, weather, particles, collectibles,
  ocean,         // wave 4: after collectibles (particles exist; stickers registry used on game:ready)
  stickers,
  merfolk,       // wave 4: after stickers
  net, hud, inventory, dressup, touch, settings, photo, stickerbook, menus, keepsafe,
```

### 5.3 Tests, tools, CI, package.json

| file | merfolk | squish | ocean |
|---|---|---|---|
| `tools/test-net.mjs` | codec test `lists` + sea loops (`:128-180`); `merfolkTests()` after `vehicleTests` (`:1789`); runner line `unit` / `merfolk` | `squishTests()` after merfolk's; runner `unit` / `squish` | `seaTests()` after squish's (incl. the combined size test, §4.3); runner `unit` / `sea` |
| `tools/net/fake-adapter.mjs` `local()` `:426-430` | — (tests set `fake.st`) | `hi` after `vh` | `sr`, `sk` after `hi` |
| `tools/test-saves.mjs` (after the `lookPicked` test `:486-492`) | — | S1-S5 | M1-M2 after squish's |
| `tools/probe-multiplayer.mjs` | `LOOKS` `want` fix (`:538`); test `SEA` after `LOOKS` | test `SQUISH` after `HELD` | — (its mp pass is in `probe-ocean`) |
| `tools/probe-vehicles.mjs` | — | — | `debug.ocean.pause(true)` in setup |
| `tools/probe-builds.mjs`, `tools/probe-prefabs.mjs` | — | — | `debug.ocean.pause(true)` in setup if their draw-call checks move (they measure calls; §9.3) |
| `tools/test-name.mjs`, `tools/lib/name-scan.mjs` | adds its encoded words (the film's title, place and character names) | adds its encoded extra words (the toy-brand plural and the dropped "space" toy name, squishies.md §14.1 A13), scanned over `src/**`, `site/**` and `dist` only (the team doc's own file name uses the plural) | adds the encoded character-name list from ocean.md §13.1 S9 |
| `package.json` scripts | `test:merfolk`, `probe:merfolk` after `probe:boys` | `test:squish`, `probe:squish` after merfolk's | `test:sea`, `probe:ocean` after squish's |
| `.github/workflows/test.yml` (repo root) | step "Sea forms (rules, codec, shore exit)" `npm run test:merfolk` after "Walkie-talkie" | "Squishy toys (data, merges)" `npm run test:squish` after merfolk's | "Sea animals (sea map, ride, whale)" `npm run test:sea` after squish's |

---

## 6. Step 0: the base commit (integrator, before any worktree is made)

One commit on `claude/girl-game-world-building-gp6bnl`, no behavior change:

1. **One entry per line** in the two single-line hot spots: the `return` of `adapter.local()`
   (`src/net/adapter.js:591`) and the `modules` array of `src/main.js` (`:51-53`). Smoke passes.
2. **The shared name scanner** `tools/lib/name-scan.mjs`: `scanText(text) -> matches`,
   `scanFiles(globs)`, the brand list (the owner's five forbidden names) stored base64-encoded,
   whole-word, case-insensitive; inlined `data:` URIs stripped first; scope `src/**`,
   `site/**`, `dist/*.html`, `dist/site/**` and `docs/**`. Teams' extra word lists (§5.3) are
   scanned over the game and site text only, not `docs/**`. Wired into `tools/test-name.mjs`.
   The player-facing character-name list (ocean.md §13.1 S9) is a second encoded list that only
   the wave-4 string tables are checked against (`STRINGS`, `ITEMS` names, `SEA_TEXT`,
   `DOLPHIN_NAMES`, merfolk's strings), because several of those names are ordinary words.
3. **Scrub the docs** so the scanner passes on `docs/**`: reword `docs/DESIGN.md:5`
   (squishies.md Q6) and the places in `squishies.md` (§8.1, §14.1 A13, §4.3) and `ocean.md`
   (§13.1 S9) that spell forbidden names, to "the owner's forbidden names" / "the character
   list in the scanner".
4. **Split flags for the long suites** (§10.2), each part checked green on this untouched tree:
   - `tools/probe-multiplayer.mjs`: `--part=a|b|c` (AT1 always runs first; then the part's
     tests in file order; parts in §10.2), keeping `--until`.
   - `tools/test-walkie.mjs`: `--part=1|2`, split at a section boundary (the browser scenes up
     to "Rosie talks", then the family-accounts section with the Node checks). **As done:**
     `--part=1|2|3`, because a part 2 from "Rosie talks" to the end took 464 s solo, and one
     from the mutes to the end 454 s (both over 450 s): 1 = the unit tests and the scenes up to "Rosie talks"; 2 = the family-accounts
     Node checks, "Rosie talks", the 15 s cap and the mutes; 3 = June's phone and turning it
     off. Each part sets up the same game together first (about 280 s in SwiftShader).
   - `tools/e2e-accounts.mjs` already has `--only`; check the three groups of §10.2.
5. **Baseline timings**: run every gate command of §10 once, solo, on this tree, and write the
   seconds into the "baseline" column of §10. **As done:** only the new split parts, smoke and
   `test:name` were run (the rest says "not measured"); a part checked only up to its first
   tests says so. Any command over **450 s** solo gets a further
   split now (the 570 s timeout must keep about 2 minutes of headroom on a busy machine).
6. Commit; nothing else. No `dist/*`.

---

## 7. Building in parallel

### 7.1 Worktrees

```bash
cd /home/user/Test
for t in merfolk squish ocean; do
  git worktree add -b claude/wave4-$t /home/user/wt-$t claude/girl-game-world-building-gp6bnl
  ln -s /home/user/Test/sparkle-world/node_modules /home/user/wt-$t/sparkle-world/node_modules
done
```

- Each builder works only in `/home/user/wt-<team>/sparkle-world`, commits to
  `claude/wave4-<team>`, never pushes, never commits `dist/*`, and ends commits with the
  session's trailers. No dependency is added in wave 4, so the shared `node_modules` link is
  safe.
- **First commit in each worktree: the team's goldens and fixtures**, recorded from the
  untouched base (step 0 changed no behavior): squish `squish-rich-profile.json`; merfolk
  `merfolk-old-profile.json` and the `OLD_*_669` goldens; ocean `ocean-beach-669b6fa.json` and
  the `chat.js` line count.
- **Node tests can run in parallel. Browser suites never do** (two SwiftShader Chromiums at once
  make timing checks flaky, wave3-critique.md §4). Every browser command runs under one lock and
  in the foreground:

  ```bash
  flock -n /tmp/sw-browser.lock timeout 570 node tools/probe-ocean.mjs --only=world
  ```

  `flock -n` fails at once when another worktree holds the lock: do Node work and try again,
  never wait in the background.

### 7.2 What each team builds, and when

| phase | merfolk (merfolk.md §15) | squish (squishies.md §15) | ocean (ocean.md §14) |
|---|---|---|---|
| **P1, parallel, no dependency** | 1-8: goldens, rules, lists, codec, physics `swim`, parts and avatar hooks (incl. `heldShown`), player gate (incl. C3, C4 lines), HUD / touch label (§5.2), Studio, friends, multiplayer | 1-11: everything, with §1.2 (`heldShown !== false`, the water toast), §1.4 (`.lf-bubble` in the drop rule), C9 models | 1-8: everything except the parts that need merfolk: R10, T3b's under-water camera, U1's Up / Down rectangles, the cross-team pass |
| **owner review** (one sitting, §7.3) | C5 render grids | toy grid incl. sea toys; names; shark or narwhal | gallery day / night; whale size; dolphin names |
| **P2, after the merges** (§8) | 9: B10b with ocean (`debug.ocean.ride()`) | — | R10, T3b, U1 on the merged tree; the `wave4` pass (§9) |
| docs and gate | each team writes its "As built"; the integrator does §11 and §10 | | |

Each team's own gate before asking to merge: its Node test, `test:net --only=unit`,
`test:saves` (squish, ocean), its whole probe in passes, `smoke`, and the suites its doc lists
as touched (merfolk.md §14.5, squishies.md §14.6, ocean.md §13.5), browser suites one at a time.

### 7.3 Owner review (before anything append-only is pinned)

One session with the dad and his daughter, after squish step 4, ocean step 3 and merfolk step 4:

- squish: the 48-toy grid incl. the 9 sea toys (with C9 applied), the names Puffums /
  Stretchums, the shark or the Narwhal (Q7), the first-8 tables. Then `ITEMS_V1` / `ORDER_V1`
  are pinned.
- ocean: the nine animals by day and night and every palette; "does this look like a famous
  character?"; the whale; the dolphin names. Then S7 is pinned.
- merfolk: Mermaid and Sea Dragon render grids with every head accessory; the Sea Dragon name
  check.
- Later, on the merged tree: the side-saddle screenshots (ocean R10).

---

## 8. Merge order

All merges happen in the main checkout (`/home/user/Test`) on
`claude/girl-game-world-building-gp6bnl`, nothing pushed until §11.

1. **merfolk first.** It changes the foundations the others sit on (look lists and codec,
   avatar, `player.js` water code, `touch.js` label, `hud.js` `refreshFly`, `remote-players`
   `_frame`), like boys did in wave 3. `git merge --no-ff claude/wave4-merfolk`. Run:
   `test:merfolk`, `test:net`, `smoke`, `probe:boys` (no edit expected: the sea tokens are left
   out for `auto`), `probe:mp --part=a` (LOOKS fix + SEA).
2. **squish second.** `git rebase` the squish branch on the merged tip, resolve per §5 (keep
   both, merge order), then merge. It is independent of the sea, but its storage, merge and
   server changes need the account suites. Run: `test:squish`, `test:saves`, `test:accounts`,
   `test:net`, `smoke`, `probe:squish` passes, `probe:mp --part=a`, `probe-shops`,
   `probe-keepsafe`, `e2e:accounts` groups.
3. **ocean last.** Rebase on the tip with both merged; apply the §5.2 literals exactly (ocean's
   lines are the last to land in `player.js`, `remote-players.js`, `adapter.js`, `touch.js`,
   `test-net.mjs`, `fake-adapter.mjs`). Then the P2 work (§7.2) and the cross-team pass (§9).
   Run: `test:sea`, `test:net` (combined size test), `probe:ocean` all passes incl. `wave4`,
   `probe:merfolk --only=water` (B10b now runs), `probe:vehicles`, `probe-builds`,
   `probe-prefabs`, `probe-environment`, `probe-pals`.
4. **Docs commit** (§11), then `npm run build`, `npm run build:site`, the **full gate** (§10),
   one commit with `dist`, one push.

If a merge breaks another team's checks, the fix goes on the merged tree by the integrator (or
the team, in its worktree rebased on the tip), never by reverting the earlier team.

---

## 9. Cross-team checks

### 9.1 The `wave4` pass (in `tools/probe-ocean.mjs --only=wave4`, written by ocean in P2)

Beach Cozy, desktop and iPad 1024 x 768 touch, `debug.merfolk.tips(true)`,
`debug.ocean.popups(true)`, `debug.squish.presents(true)`:

| id | check |
|---|---|
| X1 | **First deep swim, fresh profile, style never picked:** walk in from the beach; record every frame for 25 s which of these are visible: `.sw-stkpop`, `lf-bubble[data-owner=merfolk]`, `lf-bubble[data-owner=ocean]`, the present drop. Never two in the same frame. Sea Magic! and Dolphin Friend both pop (in that order); merfolk's bubble shows once; the drop (a present made ready by those coins) comes only after all are gone. |
| X2 | **Mermaid rides:** turn, tap a dolphin, tap Ride: `seaForm` set and `parts().shown` for the whole ride, no `'player:seaform'` during it, presence `st` `h` and `sr` set, Up / Down hidden, Jump shown, label "Ride". Jump: `big_leap` awarded (fresh profile). Hop off: label "Swim", Up / Down shown, the tail still out, no `magic` sound. Shots `wave4-ride-mermaid.png`, `wave4-ride-dragon.png` (the same with Boy picked). |
| X3 | **From a stopped boat:** park a Speedboat on deep water, tap a dolphin, Ride: the gate is on (`debug.merfolk.state().gateOn`) and `seaSwim` true at once (C3); Hop off: label "Swim", Up / Down shown. |
| X4 | **Toy in the water:** hold the Dolphin Puffum (`debug.squish.give`), swim deep: the held group is hidden, **Squish!** hidden, **Put away** shown, presence `hi` still `squish_pf_dolphin`; walk out: the toy shows again and Squish! squashes it. Just Me on a dolphin: the toy shows. "Hold it" from the shelf while swimming: the toast "Swim to the shore first!". |
| X5 | **HUD at phone 390 x 844 and iPad portrait 1024 x 1366** with all at once: riding a dolphin, a present waiting (Present button, ring), a toy held, a toast up: no overlap between the life column, joystick, Jump, Up / Down (just after Hop off), the coin pill and ring, the dolphin bubble, `.sw-toasts`, `.sw-stkpop` (the `probe-menus.mjs:24-38` rectangle math). The three squish icons, `dolphin` and `hopoff` render five different SVGs. |
| X6 | **Sticker book:** after `game:ready`, the last 11 ids of `game.registry.stickers` are exactly §4.7 in that order; `total()` is today's total + 11; all 11 have art; the Sea Friends strip shows under the pages. |
| X7 | **Two pages** (`NetHub` setup): Rosie in sea form holding a toy rides a dolphin: Lily sees the dolphin under her, her tail side-saddle, no toy in her hand; Rosie hops off on the shore: Lily sees legs and the toy within 2 s. Host presence and every message stay under 3,900 B; hashes converge. |
| X8 | **Old profile** (`boys-old-profile.json`): loads; after one deep swim, one dolphin tap and the first world load: `look.sea` default, `stats.seaMet.dolphin === 1`, `squish.base.coins === 0`, coins and stickers otherwise as before; "Hi, Lily!". |
| X9 | **Coins:** with `inFlight` 0, a dolphin hello (+2) and Sea Magic! (+20) raise `debug.squish.state().earned` by 22 and move the ring; a candy-shop spend of 30 does not move it. |
| X10 | **Webdriver quiet:** with none of the three debug switches on, 60 s of swimming at a deep spot and riding: no merfolk bubble or tip, no buddy / pool / whale toast, no present drop. |

### 9.2 Node checks

- `test:net`: the combined presence size (§4.3) and the three teams' blocks.
- `test:name`: the shared scanner over the whole tree plus the wave-4 string tables.
- `test:saves`: squish S1-S5, ocean M1-M2, and (integrator) one profile with all wave-4 keys
  (`squish`, `stats.seaMet` and the ride counters, `look.sea` explicit) merged both ways with an
  old server copy: nothing lost.

### 9.3 Older probes that may notice wave 4

| probe | why | handled by |
|---|---|---|
| `probe-vehicles` | draw calls and systems time on the water; second Get out turns her into a mermaid (Sea Magic! pop) | ocean's `pause(true)`; merfolk B10 covers the turn; the gate runs it |
| `probe-builds`, `probe-prefabs` | measure draw calls; pools get fish | ocean adds `pause(true)` if their counts move |
| `probe-multiplayer` `LOOKS` | the adapter now always sends the resolved sea pair | merfolk's `want` fix (required) |
| `probe-shops` | the coin pill becomes a button | its text checks still hold (squishies.md §14.6) |
| `probe-environment`, `probe-pals`, `probe-life` | ambient life, friends' lines, pets swimming | run in the gate; ocean records the `chat.js` line count |
| `probe-boys` | codec goldens | no edit expected (sea tokens left out for `auto`) |

---

## 10. The full gate (before the deploy)

### 10.1 Rules

- On the merged tree, after `npm run build` and `npm run build:site`, in
  `/home/user/Test/sparkle-world`.
- **Every command in the foreground, one at a time, wrapped in `timeout 570`** (9.5 minutes; the
  Bash call's own timeout set to 600000 ms). A command killed by the timeout is a **failure** to
  look into, not something to re-run in the background.
- Browser suites one at a time (`flock -n /tmp/sw-browser.lock` as in §7.1).
- **Zero console errors**, page errors or failed requests in every browser suite.
- Fix, then re-run the failed command **and** every command that covers the changed file.
- Times below: "earlier" = whole-suite runs logged on this machine during waves 2-3 (often with
  other runs in parallel, load about 4; solo runs were at the low end). "baseline" is filled in
  by step 0 (solo, untouched tree). Wave-4 probe times are the teams' estimates; each team splits
  any pass over 450 s before its merge.

### 10.2 Commands

**A. Node (fail fast; about 6 minutes)**

| # | command | earlier | baseline |
|---|---|---|---|
| A1 | `timeout 570 npm run build` | 1-2 s | 2 s; 2 s green in [gate-A] |
| A2 | `timeout 570 npm run build:site` | under 1 min | under 1 s, green in [gate-A] |
| A3 | `timeout 570 npm run test:name` | about 5 s | 1 s (the name scanner included); 2 s, 13 green in [gate-A] |
| A4 | `timeout 570 npm run test:merfolk` | seconds (new) | 2 s, 22 green in [gate-A] |
| A5 | `timeout 570 npm run test:squish` | seconds (new) | under 1 s, 17 green in [gate-A] |
| A6 | `timeout 570 npm run test:sea` | under 1 min (new; S0 makes 28 worlds) | 11 s, 21 green in [gate-A] |
| A7 | `timeout 570 npm run test:vehicles` | 1 s | 1 s, 11 green in [gate-A] |
| A8 | `timeout 570 npm run test:saves` | 54-60 s | 97 s, 42 green in [gate-A] |
| A9 | `timeout 570 npm run test:accounts` | 16-19 s | 27 s, 113 green in [gate-A] |
| A10 | `timeout 570 npm run test:billing` | 11 s | 12 s, 106 green and 1 skipped by design (no real-shapes.txt yet) in [gate-A] |
| A11 | `timeout 570 npm run test:mail-microsoft` | seconds | 3 s, 19 green in [gate-A] |
| A12 | `timeout 570 node tools/test-walkie-unit.mjs` | under 1 s | under 1 s, green in [gate-A] |
| A13 | `timeout 570 npm run test:net` | 143-150 s | 147 s, 69 green in [gate-A] |

**B. Smoke and the wave-4 probes (about 90 minutes)**

| # | command | earlier / estimate | baseline |
|---|---|---|---|
| B1 | `timeout 570 node tools/smoke.mjs` | 84-153 s | 102 s; 141 s green in [gate-B1]; 152 s green in [gate-B10d] (after the shelf's warm-up and read-back changes); 158 s green in [gate-B6r] on 16a7586 |
| B2 | `timeout 570 node tools/probe-merfolk.mjs --only=unit,water` | est. 6-8 min (merfolk splits `water` if over 450 s) | 289 s, 45 green in [gate-B1]; 337 s, 45 green in [gate-B5c] on 830cafe (after gate-B5's avatar and merfolk changes) |
| B3 | `timeout 570 node tools/probe-merfolk.mjs --only=studio` | est. 4-5 min | 230 s, 37 green in [gate-B1]; 238 s, 37 green in [gate-B3r] on 0a37ec5 (after gate-B5's avatar and merfolk changes; no console errors, page errors or failed requests) |
| B3b | `timeout 570 node tools/probe-merfolk.mjs --only=grids` (the C5 render grids: a pass of its own since [gate-B1]; studio, grids and review together went over 570 s) | | 208 s, 6 grids, green in [gate-B1]; 206 s, 6 grids, green in [gate-B3r] on f41b1f7 (no magenta; the grids looked at; no console errors, page errors or failed requests) |
| B3c | `timeout 570 node tools/probe-merfolk.mjs --only=review` (the owner's Sea Dragon showcase pictures) | | 243 s, 8 green in [gate-B1]; 251 s, 8 green in [gate-B3r] on adb2ce6 (the Sea Dragon showcase pictures looked at: horns, back spikes and tail fins whole from every side, in the sea, under the water and next to a mermaid; legs and no sea parts on land after a swim; no console errors, page errors or failed requests) |
| B4 | `timeout 570 node tools/probe-merfolk.mjs --only=touch,friends` | est. 4-5 min | 207 s, 12 green in [gate-B1]; 217 s, 12 green in [gate-B3r] on afa0658 (D2 friends within 5.8 of 6 blocks; no console errors, page errors or failed requests) |
| B5 | `timeout 570 node tools/probe-merfolk.mjs --only=costs` ([gate-B3r]: split from `--only=costs,save`, which took 544 s of its 570 s in [gate-B5c]; the save pass is B5b) | est. 4-6 min | 466 s and 445 s in [gate-B1], both **red** on one check only (B13c the longest frame after the first turn: the middle of 3 fresh pages +64 ms, then +41 ms, against at most +33 ms; no new shader program on any page; load about 4); the other 19 green. [gate-B5] root cause, measured on fresh pages: the move to deep water shows a new view (about 140 draw calls become about 200, about 90 chunk geometries reach the GPU 4 frames before the turn), so the shore baseline was not like against like; the turn itself built no program and uploaded no texture, its only first-use work being its parts' 5-7 geometries. Fixed: those geometries are drawn once, unseen, right after prepareSea (src/player/merfolk/index.js), and B13c now compares the turn's 0.5 s with later 0.5 s stretches in sea form at the same spot, and checks the turn frame sends no new geometry or texture. Re-run in [gate-B5]: 509 s, B13c timing green (middle -8 ms), geometries 0 on all 3 pages, but **red** on the new upload check (1 texture on 1 page of 3, source not yet found) and on B13e (1.92 ms vs idle 0.85 ms, +1.07 against +1.0; green in [gate-B1]; not yet re-run). [gate-B5b] the upload's source, looked for with a temporary diagnostic (every texImage2D / texStorage2D wrapped, the same first-turn steps on 21 fresh pages): no texture was sent on the turn's frames on any page, so no warm-up was missing and the check is unchanged; probe-merfolk now names any texture sent on those frames (its size and the scene object holding it) if it comes back. Re-run in [gate-B5b]: 513 s, the upload check green (geometries and textures 0 on all 3 pages), B13c timing green (middle +16 ms), B13e green (2.00 ms vs idle 1.03 ms, +0.97), every B14 save check green; **red** on one check only, B13c ensureSea for a Sea Dragon 2.50 ms (median of 5, at most 2 ms; green in [gate-B1] and [gate-B5], whose changes do not touch ensureSea; load about 3.5): a single timing blip by the rule, to be re-run once; still open. [gate-B5c] re-run once on 1445e40: 514 s, **red** again on B13c ensureSea for a Sea Dragon (2.10 ms) and on B13c the turn's longest frame (middle of 3 pages +81 ms; usual frames 240-270 ms, load about 3.5); a second failure, so looked into: a diagnostic (the same steps, 15 builds a pass) found the Sea Dragon's build still being optimized by the script engine after the probe's 5 warm-up builds (17, 1.4, 2.3, 5.5, 2.2, then 3.1, 4.8, 2.4, 2, 3 ms; later passes a median of 1.2-1.3 ms; the mermaid's, already warm from the page's own turn, 0.4-0.5 ms); gate-B5's changes do not touch ensureSea. The probe now warms it with 25 builds (was 5), the check unchanged (median of 5, at most 2 ms). Re-run: 544 s, 21 green (ensureSea 0.60 ms, a Sea Dragon 0.90 ms; B13c turn middle +17 ms; no new program, geometry or texture on the turn; B13e 1.36 vs 0.90 ms; every B14 save check): **green**; [gate-B3r] `--only=costs` alone on 83d7f62: 435 s, 15 green (B13c turn middle of 3 pages -29 ms; no new program, geometry or texture on the turn; ensureSea 0.70 ms, a Sea Dragon 0.90 ms; B13e 1.86 vs 1.06 ms; no console errors, page errors or failed requests): **green** |
| B5b | `timeout 570 node tools/probe-merfolk.mjs --only=save` (the B14 save checks; split from B5 in [gate-B3r]) | | ran inside B5 until [gate-B5c] (every B14 save check green there); [gate-B3r] on 83d7f62: 34 s, 6 green (no console errors, page errors or failed requests) |
| B6 | `timeout 570 node tools/probe-squish.mjs --only=desktop` | est. 6-8 min | 218 s, 78 green in [gate-B2] after two fixes: the pill tip now also waits for a sticker pop still in the queue (`game.stickers.pending()`; B3 red once: the pop's 500 ms clock starts a frame after the close, the tip's 600 ms clock at the close), and the probe's `aimAt` waits two game frames for the camera's new yaw (crashed once with the toy still behind the camera); one B2 drop-timing blip in between, green on re-run; 78 green in [gate-B10d] on 4be5273 (after the shelf's read-back change; time not logged); on 16a7586 in [gate-B6r]: 219 s **red** on one check only, B4 "a tap within 300 ms of opening does not count" (the panel's ghost-tap guard is 300 ms of wall time, and the probe's wait for the panel plus its click can pass that under load about 3.5; green in [gate-B2] and [gate-B10d]): a single timing blip by the rule, re-run once: 211 s, 78 green |
| B7 | `timeout 570 node tools/probe-squish.mjs --only=touch` | est. 4-6 min | 215-220 s, green twice ([rf2-c2]); 224 s, 37 green in [gate-B2]; 222 s, 37 green in [gate-B10d]; 220 s, 37 green in [gate-B6r] on 16a7586 |
| B8 | `timeout 570 node tools/probe-squish.mjs --only=world,save` | est. 5-7 min | 175 s, 22 green in [gate-B2]; 180 s, 22 green in [gate-B10d]; 186 s, 22 green in [gate-B6r] on 16a7586 |
| B9 | `timeout 570 node tools/probe-squish.mjs --only=mp` | est. 3-5 min | 195 s, 12 green in [gate-B2]; 219 s, 12 green in [gate-B10d]; 207 s, 12 green in [gate-B6r] on 16a7586 |
| B10 | `timeout 570 node tools/probe-squish.mjs --only=grids,cost` | est. 5-7 min | 293 s and 298 s in [gate-B2], both **red** on the same two checks (load about 4): F1 "back to the idle count within 3 s" (142-143 draw calls against 139-140 idle) and F4 the shelf with 96 owned (worst frame 1368-1441 ms against 1000, all in `sys:squish-presents`, longest thumbnail job 1291-1409 ms; all 96 thumbnails in 18.8-20.1 s against 20 s); every other check green. [gate-B10]: F1's root cause was the ambient life still arriving (game time is capped at 0.05 s a frame; the idle count rose 138 -> 142 over 9 s with no toy touched, and nothing of the squish stayed in the scene), so F1 now counts with the butterflies, fireflies and sea animals on a layer the camera does not draw: **green** (132 -> 132, +1, 132). F4: the thumbnail queue now draws a job that needs a new shader program once and reads it back a frame later, the shelf's warm-up draws each sample in a frame of its own, and the shelf draws 6 pictures a frame (was 4). Runs: 322 s (batch 4: worst frame 708 ms, but all 96 in 21.2 s), 297 s (batch 6: all 96 in 17.2 s, but one `sys:squish-presents` frame of 1589 ms early on); F4 still **red**, still open [gate-B10b]: a temporary diagnostic (every WebGL call on the thumbnail renderer timed by frame) found the long frame is the shelf's warm-up draw of the see-through shell's new shader program (one new program, compileAsync ready at once: no parallel-compile extension here): inside that one draw, three's shader-error check read the program log (1201 ms, it waits for the link) and both shader logs (322 + 328 ms, each a round trip behind the GPU's queue). Now the link status is read in a frame of its own (a failed link is still reported) and the warm-up draw skips three's log reads; the draw is cheap, but the link alone is still one frame of about 1.1 s (getProgramParameter 1107 ms). A 1 s wait before the first read did not shorten it: the link happens on demand, not in the background. F4 still **red** (diagnostic runs: 1146, 1859, 1698, 1190 ms; all 96 in 17.3-18.5 s); next: link that program before the shelf opens (e.g. while the world loads, or when the shelf button first shows), still open [gate-B10c]: the shelf's warm-up now runs ahead of time once she owns a toy (squish `warmShelf`: behind the loading screen while a world loads, otherwise in play frames with no pictures or chunks waiting), and the shelf's 2D canvases are kept in memory (`willReadFrequently`): a diagnostic found that after the link moved out, one picture's `toDataURL` waited 1008 ms for the GPU's queue. Runs: 308 s (warm-up only: 1757 ms, the toDataURL wait), diagnostics 921 ms (green, all 96 in 13.5 s) and 1265 ms (all 96 in 12.6 s): the only long frame left is the batch's own read-back waiting for the drawing (550-1230 ms a batch on this machine). An asynchronous read-back (three's `readRenderTargetPixelsAsync`) was tried and taken out: its first batch did not come back for about 35 frames, so the thumbnail queue drew the rest (40 s). F4 still **red**, still open; next: find why the fenced read-back stalled, or size the batches by the measured read-back time. [gate-B10d]: sizing batches by read-back time could not help (a plain read-back waits for everything the GPU has queued, the game's own last frame too: 500-1230 ms on this machine, the same for 1 picture as for 6). The shelf now reads each batch back without waiting: into a GPU-side pixel buffer behind a fence, handed out in a later frame once the fence has passed (one batch's pictures a frame; a batch not back after 30 frames is read anyway), at most 3 batches on their way back; picture size and quality unchanged. F4 now catches the window's long frames as they are reported (it counted from the end of `diag.longFrames`, which keeps only the last 40, so a full list would have shown none). Runs: 288 s (2 in flight: no frame over 250 ms, all 96 in 18.0 s), 312 s (3 in flight: no frame over 250 ms, the 48 on screen in 8.1 s, all 96 in 13.1 s), 305 s with the stricter F4 (no frame over 250 ms, the 48 on screen in 8.9 s, all 96 in 14.2 s): **green**; after `collect()` lost its while loop (A5's rule), 361 s: no frame over 250 ms, the 48 on screen in 9.5 s, all 96 in 14.7 s: **green**. A5 (test:squish) was red once on that while loop and is green (17) after it; A1-A4, A6, A7, A11, A12 green in [gate-B10d]; A8-A10 and A13 not yet re-run, and B6-B9 ran before that loop change |
| B11 | `timeout 570 node tools/probe-ocean.mjs --only=world` | est. 5-7 min | [gate-B3] 372 s on bbcc12e, every O1-O11 check **green** (no console errors, page errors or failed requests) |
| B12 | `timeout 570 node tools/probe-ocean.mjs --only=see,tap` | est. 5-7 min | [gate-B3] 227 s on 0f1132c, 63 checks **green** (V1 all 7 kinds seen on desktop and iPad, T1-T7 real taps; no console errors, page errors or failed requests) |
| B13 | `timeout 570 node tools/probe-ocean.mjs --only=ride,touch` | est. 6-8 min | [gate-B3] 257 s on addaad5, 44 checks **green** (desktop ride and iPad touch; no console errors, page errors or failed requests) |
| B14 | `timeout 570 node tools/probe-ocean.mjs --only=biomes,saves` | est. 4-6 min | [gate-B3] 198 s on 7c89ee9, 17 checks **green** (candy, flat pools and snow; old profile, old world, a beach world before and after sea life; no console errors, page errors or failed requests) |
| B15 | `timeout 570 node tools/probe-ocean.mjs --only=mp` | est. 4-5 min | [gate-B3] 401 s on 6be3dd1, 19 checks **green** (a desktop host and an iPad guest; no console errors, page errors or failed requests) |
| B16 | `timeout 570 node tools/probe-ocean.mjs --only=cost` | est. 5-6 min (C3 alone runs 3 min) | [gate-B3] 389 s on 619b251, 22 checks **green** (C1-C6, the gallery and G1; no console errors, page errors or failed requests) |
| B17 | `timeout 570 node tools/probe-ocean.mjs --only=wave4a --x=1` (X1, the first deep swim: desktop and iPad, 25 s of frames each) | | [gate-B17] 89 s on 5233871, 9 checks **green** (74.2 s of frames, 283 frames; the pop and the dolphin bubble 13 frames side by side, never over each other; Sea Magic! then Dolphin Friend; the drop after all; the drop picture looked at; no console errors, page errors or failed requests). The X1 pass is desktop only: §9.1 X1 names no iPad page, so the "and iPad" here is left to the owner |
| B17b | `timeout 570 node tools/probe-ocean.mjs --only=wave4a --x=2,3` (a mermaid and a sea dragon ride; from a stopped boat) | | green in [rf2-ride]; [gate-B17] 89 s on e45e40f, 17 checks **green** (no console errors, page errors or failed requests); both ride pictures looked at: she sits on the dolphin with the tail out, the camera crop and the tail behind her hair as in the owner's open item |
| B17c | `timeout 570 node tools/probe-ocean.mjs --only=wave4a --x=4` (a toy in the water) | | [gate-B17] 52 s on the B17b commit, 5 checks **green** (no console errors, page errors or failed requests; X4 takes no pictures) |
| B17d | `timeout 570 node tools/probe-ocean.mjs --only=wave4a --x=5` (the HUD at 390 x 844 and 1024 x 1366; on the phone the dolphin bubble may wait, hidden, while a pop and a toast are up, and must show clear of everything within 3 s of game time once they leave: the X5 decision in "As built") | | 154 s; [gate-B17] 148 s, 16 checks **green** (phone: the dolphin bubble waited hidden while the pop and toast were up, then showed at once; no overlaps on either size; no console errors, page errors or failed requests). All 6 pictures looked at; two things seen that the X5 checks do not cover, left open: on the iPad riding picture merfolk's "Hold Down to dive!" toast (shown 1.5 s into the swim, before the probe's ride) is still up while she rides and Down is hidden; and the coins' short "+N" fly-in (1.3 s, not one of the X5 parts) passes over the fading sticker pop |
| B17e | `timeout 570 node tools/probe-ocean.mjs --only=wave4b` (X6-X10; X7's two pages take about 3.5 min) | | 344 s on 724b031; X6-X10 green in [rf2-hud] (X7 alone after its timing change); [gate-B17] 345 s, 31 checks **green** (43 stickers, the last 11 in §4.7 order; X7 Lily sees Rosie's new state in 200 ms of game time; X8 the old profile 162 coins; X10 quiet; no console errors, page errors or failed requests). Both pictures looked at: the book and the Sea Friends strip are clear; in X7's picture Lily's own back hides most of Rosie on the dolphin (the check reads her state, not the picture) |

`--only=wave4` runs X1-X10 in one go but takes longer than one 570 s command, so the gate never
uses it: B17-B17e split it with `--only=wave4a --x=N` and `--only=wave4b`.

**C. The suites wave 4 touches most (about 90 minutes)**

| # | command | earlier (whole suite) | baseline |
|---|---|---|---|
| C1 | `timeout 570 node tools/probe-multiplayer.mjs --part=a` (AT1-AT6, AT17, HELD, SQUISH, AT18, AT19, ZIP) | whole: 1031-1775 s, so split | not measured (AT1 + AT2 only: 166 s, green); [gate-C1] 413 s on 78dcb51, all 12 tests **green** (90 checks; hub: 0 dropped, 0 duplicated; no console errors, page errors or failed requests) |
| C1b | `timeout 570 node tools/probe-multiplayer.mjs --part=d` (AT1, LOOKS, SEA; split from part a at the merfolk merge: with SEA, part a hit the 570 s timeout at load 4) | | [gate-C1] 419 s on 5f4a1b3, all 3 tests **green** (49 checks; hub: 0 dropped, 0 duplicated; no console errors, page errors or failed requests) |
| C2 | `timeout 570 node tools/probe-multiplayer.mjs --part=b` (AT1, AT7, AT11, AT9, AT10; [gate-C1]: AT20 and REJOIN moved to part f, C2b) | | not measured (AT1 + AT7 only: 143 s, green); [gate-C1] with all six tests on 25dd2e1: **killed by the timeout** at 572 s (AT1 182 s, AT7 19 s, AT11 180 s, AT9 63 s, AT10 11 s, AT20 34 s, all green; REJOIN cut off at the timeout while taking her title picture, after "june reloaded in 21.1 s"; load about 4.3). Root cause: the part was simply longer than one command (the two SwiftShader joins, AT1 and AT11, take about 180 s each), not a game fault: nothing failed before the kill. Fixed by splitting it: AT20 and REJOIN (which need June, so AT11 runs again) are part f. Re-run on 4e60bf8 (AT1, AT7, AT11, AT9, AT10): 502 s, 77 checks **green** (AT1 207 s, AT11 183 s; AT9 chaos: no resyncs, every guest entry ran once; no console errors, page errors or failed requests; load about 4.5) |
| C2b | `timeout 570 node tools/probe-multiplayer.mjs --part=f` (AT1, AT11, AT20, REJOIN; split from part b in [gate-C1]) | | [gate-C1] 539 s on ff5d0d2, 53 checks **green** (AT1 212 s, AT11 178 s, AT20 18 s, REJOIN 115 s: her reload and the world meshing again; no knock card; no console errors, page errors or failed requests; load about 4.5). Close to the limit (31 s left): if it is ever cut off, run AT20 in part b instead (part b had 68 s left) |
| C3 | `timeout 570 node tools/probe-multiplayer.mjs --part=c` (AT1, JUNE, AT12; [gate-C1b]: split in three, see C3c and C3d) | | not measured (AT1 + AT11 only: 218 s, green); [gate-C1] on 3d0c2d4: **killed by the timeout** at 571 s (AT1 206 s and AT11 180 s green; AT12 cut off 167 s in, while her friends waited to come back after Lily's reload; AT13-AT22 never ran; no check had failed; load about 5). Still open: every test in this part needs June, so a split part must run AT1 and AT11 again (about 390 s together now), which leaves no room for AT12; the part needs a design change (e.g. a lighter join for the later parts) before it can fit. Note: AT1 + AT11 took 218 s when the baseline was taken and about 386 s now. [gate-C1b] A/B join timing, back to back on this machine (old = the live branch 61915c5 built in a temporary worktree; new = 9d5822d's dist), `--part=b --until=AT1`: old AT1 208.5 s (Rosie g.loading to world:load 58 s, load about 1-4); new AT1 220.4 s (81 s) and 203.9 s (63 s; load about 2-4). So wave 4 did not make joining slower: AT1 alone is about 205 s on both, and the 218 s baseline for AT1 + AT11 must have been taken on a quieter machine. The second "snapshot 1 chunks" in one trace is not a retry: an instrumented run showed one enterSharedWorld call; the host re-makes its cached snapshot after SNAP_CACHE (60 s) while the guest still meshes, and the guest drops it (older than wave 4, harmless). Fix: part c split into c (JUNE, AT12), g (JUNE, AT13) and h (JUNE, AT8, AT21, BUDGET, END, AT22); JUNE is a lighter AT11 (June, the same phone visitor, joins with none of AT11's 300 edits, pictures or HUD checks; AT11 runs whole in parts b and f), so every test keeps its players and checks. Run on 9d5822d + the split: 547 s, **green** (AT1 211 s, JUNE 130 s, AT12 188 s; no console errors, page errors or failed requests; load 1.5 rising to 5.8). Only 23 s left: if it is ever cut off, AT12 needs a part without AT1's pictures |
| C3c | `timeout 570 node tools/probe-multiplayer.mjs --part=g` (AT1, JUNE, AT13; split from part c in [gate-C1b]) | | not measured yet |
| C3d | `timeout 570 node tools/probe-multiplayer.mjs --part=h` (AT1, JUNE, AT8, AT21, BUDGET, END, AT22; split from part c in [gate-C1b]) | | not measured yet |
| C3b | `timeout 570 node tools/probe-multiplayer.mjs --part=e` (SIX only, no AT1: six players, and Zoe, the 7th, gets the "full" card drawn above the Join keypad) | | 449 s, green on 82a7a8c ([rf2-six]); 571 s once on a busy machine, so run it alone |
| C4-C9 | `timeout 570 node tools/probe-boys.mjs --only=X` for X = `unit`, `studio`, `touch`, `world`, `friends`, `grids` | whole: 356-656 s | [gate-C2] on 9d5822d: C4 `unit` 1 s, 39 checks **green** (Node only); C5 `studio` 69 s, 41 checks **green**; C6 `touch` 293 s, 53 checks **green** (pictures looked at: phone 390 studio, friends list); no console errors, page errors or failed requests; load about 4. C7 `world` on 7139894: **failed** in 99 s, 1 check, "B8 no geometry leak after 60 boy looks" (geometries 136 -> 157). Root cause: a probe timing race, not a leak. The renderer counts a geometry only once it draws it; after the closing `setLook(orig)` the probe waited 300 ms, and frames here take 600+ ms, so the fresh look's ~21 meshes were counted at one snapshot and not at the other (a trace of every count change: 1340 disposals from setLook against 1319 + 21 first draws, net 0). Fix (tools/probe-boys.mjs, B8 `round`): wait for two drawn frames before each snapshot; the limit (+4) is unchanged. Re-run: 103 s, 15 checks **green** (geometries 156 -> 156; photo picture looked at). After the fix (664a8ee): C8 `friends` 258 s, 28 checks **green** (D5 longest frame 804 ms, 0 stalls); C9 `grids` 45 s **green** (starter grid looked at); C4 `unit` again 1 s, 39 **green**; no console errors, page errors or failed requests |
| C10 | `timeout 570 node tools/probe-vehicles.mjs --only=models,land` | whole: 455-763 s | [gate-C2] 150 s on 924b52b, 38 checks **green** (fleet picture looked at; no console errors, page errors or failed requests; load about 4) |
| C11 | `timeout 570 node tools/probe-vehicles.mjs --only=water,save` | | [gate-C2] 172 s on ed0c800, 18 checks **green** (the pagehide journal parks the van where she was; a pre-vehicles world loads as before; no console errors, page errors or failed requests; load about 4) |
| C12 | `timeout 570 node tools/probe-vehicles.mjs --only=touch,mp` | | [gate-C2] 482 s on 5f67e22, 49 checks **green** (June drives Lily's convertible with custody on the host; it survives Lily's reload; HUD at 844x390 looked at; no console errors, page errors or failed requests; load about 4). Only 88 s left under the limit: if it is ever cut off, split it into `--only=touch` and `--only=mp` |
| C13 | `timeout 570 node tools/probe-menus.mjs --only=desktop` | whole: 399-705 s | [gate-C3] 176 s on e88b155, 37 checks **green** (the bag picture looked at; no console errors, page errors or failed requests; load about 4.5) |
| C14 | `timeout 570 node tools/probe-menus.mjs --only=touch` | | not measured |
| C15 | `timeout 570 node tools/probe-shops.mjs` | 245-388 s | not measured |
| C16 | `timeout 570 node tools/probe-keepsafe.mjs` | 156-209 s | not measured |
| C17 | `timeout 570 node tools/probe-environment.mjs` | 147-185 s | not measured |
| C18 | `timeout 570 node tools/probe-pals.mjs` | 234-417 s | not measured |
| C19 | `timeout 570 node tools/probe-life.mjs --only=desktop` | whole: 328-511 s | not measured |
| C20 | `timeout 570 node tools/probe-life.mjs --only=touch` | | not measured |
| C21 | `timeout 570 node tools/probe-avatar.mjs` | 199-344 s | not measured |
| C22 | `timeout 570 node tools/probe-builds.mjs --only=gallery,hills,play` | whole: 383-572 s | not measured |
| C23 | `timeout 570 node tools/probe-builds.mjs --only=ui,touch` | | not measured |
| C24 | `timeout 570 node tools/probe-prefabs.mjs --only=gallery,undo` | whole: 332-531 s | not measured |
| C25 | `timeout 570 node tools/probe-prefabs.mjs --only=ui,touch` | | not measured |

**D. The rest of the standing gate (about 80 minutes)**

| # | command | earlier (whole suite) | baseline |
|---|---|---|---|
| D1 | `timeout 570 node tools/probe-outdoor.mjs --only=tree,zip` | whole: 309-542 s | not measured |
| D2 | `timeout 570 node tools/probe-outdoor.mjs --only=camp,salon,touch` | | not measured |
| D3-D6 | `timeout 570 node tools/probe-furniture.mjs --only=X` for X = `showroom`, `actions`, `touch`, `tops` | whole: 312-529 s | not measured |
| D7 | `timeout 570 node tools/test-net-game.mjs` | 321-523 s (split in step 0 if baseline > 450 s) | not measured |
| D8 | `timeout 570 node tools/probe-net-ux.mjs` | 217-392 s | not measured |
| D9 | `timeout 570 node tools/test-walkie.mjs --no-build --part=1` | whole: 507-953 s, so split in three | 355 s (169 checks, green) |
| D10 | `timeout 570 node tools/test-walkie.mjs --no-build --part=2` | | 358 s (85 checks, green) |
| D10b | `timeout 570 node tools/test-walkie.mjs --no-build --part=3` (added in step 0: part 2 alone was over 450 s) | | 371 s (48 checks, green) |
| D11 | `timeout 570 node tools/site-check.mjs --no-build` | 184-257 s | not measured |
| D12 | `timeout 570 npm run probe:railway` | 292-529 s (split in step 0 if baseline > 450 s) | not measured |
| D13 | `timeout 570 node tools/e2e-accounts.mjs --only=4` (runs 1-4) | whole: 757-1412 s, so split | not measured (`--only` closure checked in the code: runs 1-4) |
| D14 | `timeout 570 node tools/e2e-accounts.mjs --only=6,7` (runs 1, 2, 5, 6, 7) | | not measured (closure: runs 1, 2, 5, 6, 7) |
| D15 | `timeout 570 node tools/e2e-accounts.mjs --only=8,9,10` (runs 1, 2, 8, 9, 10) | | not measured (closure: runs 1, 2, 8, 9, 10) |
| D16-D22 | `timeout 570 node tools/probe-hud-sizes.mjs gate --sizes=X` for X = `390x844,844x390,1366x940`, `1366x1024,1180x820,1180x740`, `1180x700,1133x744,1133x660`, `1024x768,1024x690,1194x834`, `1194x750,1080x810,1080x700`, `1180x640,820x1180,768x1024`, `744x1133` (the wave-4 states; a group of 4 took up to 517 s) | | all 19 clear in [rf2-hud]: 186-376 s for a group of 3 |

In all: 13 Node commands and about 80 browser commands, about **5 hours** of serial browser
time. Order: A (stop at the first failure), B, C, D. After any fix, re-run its covering
commands, then A again.

---

## 11. Docs, site and deploy (integrator)

1. **Docs commit**, from the three teams' "As built" sections and §2:
   - `docs/DESIGN.md`: the new `## 7. Wave 4 ...` with 7.1 merfolk, 7.2 squish, 7.3 ocean; the
     §1 activities rows (sea forms, sea animals and the dolphin ride, squishy toys and mystery
     presents); the 11 stickers in the stickers list; the new events in the events table
     (`:258-284`) in merge order; the Player, Environment and Storage notes each team listed.
   - `docs/MULTIPLAYER.md`: §5.4 rows `st` (`m`), `hi` (toy keys), `sr`, `sk`; §5.13 the sea tail
     tokens and the "later tokens" rule; §7 rows (sea animals; squishy collection and presents
     per player; the sea form in the look); §9 hook lines; §15 the new tests.
   - `docs/DATA-MAP.md:50`, one sentence: "... stats (including which sea animals they met),
     settings, basket, squishy toy collection, and her avatar look (including the water form
     and tail color). A tail form chosen automatically from this device's Girl / Boy button is
     shown to friends like clothes are; the button itself is never sent or stored."
   - `site/index.html:111`, one sentence for all three: "Then came even more wishes: mermaids and
     sea dragons, dolphins to ride, sea animals to meet, squishy toys and mystery presents.
     They're inside too."
   - `docs/teams/shops.md` (the coin pill line), `docs/teams/avatar.md` (lazy sea parts,
     `disposeSea`), and §2's corrections in the three team docs; each team doc's
     "Integrator decisions" section points here.
2. `npm run build`, `npm run build:site`, then the **full gate** (§10).
3. One commit with the source, the docs and `dist/*`; one push to
   `claude/girl-game-world-building-gp6bnl`. Railway builds and starts the new version by itself
   (1-3 minutes, docs/DEPLOY-RAILWAY.md "Step 7. Updates"). Push when nobody is playing: players
   in a game reconnect, and a "Your game needs a refresh!" message brings everyone to the same
   version.
4. After the deploy: open `https://www.playglimmerworld.com/play` in a fresh page, check the
   build id is the new one and the console is clean, swim into the sea once (a tail, a dolphin
   pod) and open the Squish Shelf from the coin pill. The server change (the `putProfile`
   squish guard) is live with this deploy; nothing else on the server changes.
5. Remove the worktrees: `git worktree remove /home/user/wt-<team>` for each, and delete the
   three `claude/wave4-*` branches locally.

---

## 12. Risks and open questions for the owner

- **R1 Side-saddle or lying on the back?** Decided side-saddle (C2); the daughter sees the X2
  shots and can switch it (a pose-only change in merfolk's file).
- **R2 Too many moments in the first deep swim.** §1.4 keeps them apart; X1 measures it. If it
  still feels busy, the first thing to drop is merfolk's dive tip on the first-ever turn (it
  comes back on the second).
- **R3 The long gate.** About 4.5 hours of serial browser time. The split flags of step 0 are the
  only tooling change outside the three teams; they are checked on the untouched tree first.
- **R4 Stale tabs.** An old cached page can drop `profile.squish` from a cloud copy (the server
  guard stops that), drop an explicit `look.sea` choice (falls back to `'auto'`, accepted in
  merfolk.md §11), and never sees `sr` / `sk` (same-build rule). No owned thing is lost.
- **R5 Older probes' budgets near water** (§9.3). Mitigated by `debug.ocean.pause(true)`.
- **Q1 (owner)** Puffums / Stretchums as names; the shark or the Narwhal Puffum (squishies.md
  Q1, Q7).
- **Q2 (owner)** The gallery and render-grid look checks of §7.3, and the dolphin names.
- **Q3 (owner)** Should a mermaid be able to hold a squishy toy while she swims (a later wave:
  a sea-form "hold" pose, and the toy shown in the hand while swimming)? v1 hides it (§1.2).

## Integrator decisions

Answers to §12 and the questions the teams left open (2026-10-05). Each is easy to change
before the release; the ones marked **owner** still wait for the dad and his daughter.

- **Names.** Puffums and Stretchums, together "squishy toys", the **Squish Shelf** (squishies.md
  §8.1). The friendly closed-smile **Shark Puffum** is kept (Q1; the Narwhal swap stays one
  entry before the release). **Sea Dragon** is kept as the name of the boy's water form, and
  Mermaid for the girl's (merfolk.md §10.1). Every name passes `tools/lib/name-scan.mjs`.
- **R1 Side-saddle.** Kept: on a dolphin a mermaid or a sea dragon sits side-saddle
  (`poseSaddleSea`), the tail beating with the dolphin (`seaKick`). The X2 / R10 pictures
  (`.shots/ocean-ride-mermaid.png`, `ocean-ride-dragon.png`) go to the daughter (**owner**); a
  change is a pose-only change in merfolk's file.
- **Mix defaults to Mermaid.** With `look.sea.form` `'auto'`, Girl and Mix give the Mermaid and Boy
  the Sea Dragon; with no pick on the device, the worn look decides (`autoSeaForm`,
  `src/player/merfolk/rules.js`). The pick stays on the device; friends get the resolved form.
- **Sea Dragon horns.** The horns show with no head accessory or a bow and are left out under
  every other head accessory, so 4 of the 6 boy starters swim without horns until the hat comes
  off (`.shots/merfolk-grid-starters.png`). Kept for now, pending the **owner** (merfolk.md
  "As built", the owner review).
- **R2 One thing at a time.** §1.4 as built; X1 measures it. The one allowed overlap: the dolphin
  bubble and the Dolphin Friend pop come from the same tap, so they may show together, as long
  as the bubble never covers the pop (X1: 14 shared frames, 0 covered). If the **owner** wants
  no overlap at all, one of them waits for the other. If the first deep swim still feels busy,
  the first thing to drop is merfolk's dive tip on the first-ever turn.
- **R3 The long gate.** Split with `--only`, `--part`, `--x` and `--sizes` so every command fits
  in 570 s (§10 and the step notes in "As built").
- **R4 Stale tabs.** The server's `putProfile` squish guard ships with this deploy; nothing a
  player owns is lost.
- **R5 Older probes near water.** They call `game.debug.ocean.pause(true)` where sea life could
  touch their budgets (probe-vehicles); every self-started wave-4 popup stays off on
  `navigator.webdriver` pages.
- **Q2 Looks.** The gallery, render-grid and Studio pictures listed in the three team docs'
  "As built" sections, and the dolphin names in `DOLPHIN_NAMES`, wait for the **owner**'s read.
- **Q3 A toy in the sea.** v1 hides a held toy while she swims in sea form and on a dolphin with
  a tail (it stays in its slot, presence `hi` keeps sending it); Just Me on a dolphin holds it,
  as on a pony. A sea-form hold pose is for a later wave.
- **Six players.** The owner asked for 6 players in one world instead of 4 (MULTIPLAYER.md
  "Six players"). The relay's `SW_MAX_PEERS` defaults to 6; the **owner** checks at deploy time
  that the Railway service does not set it to 4.
- **The Dolphin Puffum's color** follows ocean's `sky` dolphin palette, `#6A80CC`
  (`src/things/squish/data.js`, squishies.md row 22): a color, not a pinned key.

## As built

(Where the build differs from this plan, the build is right.)

**Merges** on `claude/wave4-integration`, in the order of §8: `b0f7075` merfolk, `d982b73`
squish, `6c5a35b` ocean, each followed by its fixes (probe-squish E3 allows merfolk's default
water form on an old look; probe-ocean waits for merfolk's turn and puts Sea Magic! out of the
way before it counts coins). The Node suites passed on the merged tree with no change
(`72f68c0`). The live branch `claude/girl-game-world-building-gp6bnl` is merged into the
integration branch, never changed.

**P2 work after the merges** (commit tags in brackets):
- [verify-ocean-*], [p2-ride-camera]: probe-merfolk B10b (a dolphin ride in the water pass);
  probe-ocean R10 (a mermaid and a sea dragon ride), T3b (the camera under the surface), U1 / U2
  (merfolk's Up / Down and the Swim label after Hop off).
- [p2-wave4-a], [p2-wave4-b]: the cross-team pass of §9.1 in `tools/probe-ocean.mjs`:
  `--only=wave4a` (X1-X5, split with `--x=N`) and `--only=wave4b` (X6-X10, about 344 s);
  `--only=wave4` runs both but takes longer than one 570 s command. X6 checks that the sticker
  total equals the registered stickers and that the 11 new ids come last (32 + 11 = 43 here;
  never pinned). Just Me on a dolphin holds her toy (the held-toy rule reads the tail, not the
  mount).
- [p2-fish]: different kinds of sea animals keep apart (`apartKinds`, test-sea S14);
  `fishStacked` counts only fish in the picture; fish spacing across the view uses each fish's
  real width; `probe-ocean --only=rf --runs=N --vp=desktop|ipad`.
- [p2-hud]: probe-hud-sizes checks the wave-4 states (a toy and a present, swimming, the
  dolphin bubble, riding), alone and with friends; the dolphin bubble keeps clear of every HUD
  control; on sideways iPads the walkie's rings clear Up while she flies or swims.
- [p2-six-core], [p2-six-browser]: up to 6 players (`C.MAX_PLAYERS` 6, seats 1..5, two more seat
  colors, a 14-dolphin pool with 5 friends' rides); `probe-multiplayer --part=e` (SIX, about
  460 s) belongs in the §10 gate.
- [p2-docs]: §11 step 1 (this section, DESIGN.md §7, MULTIPLAYER.md, DATA-MAP.md, the home
  page, avatar.md, shops.md and the team docs' "Integrator decisions").
- [p2-hud-finish]: on upright phones the walkie is 96 px at bottom 77, and while it shows the
  joystick, Jump (or Up / Down) and the life column move 46 px up, so its pressed rings clear the
  hotbar, the joystick and Up / Jump.
- [review-fixes] (after a review of the merged tree): the server always joins the stored squishy
  toys with an upload's (`mergeSquish`; test-saves S5b), so an old tab's stale copy never drops a
  toy; dolphins part from the one she rides (`_apart` moves only the free one); the coin pill tip
  waits for toasts; the dolphin bubble waits (hidden) when it has no free spot and a sticker pop
  or toast would lie on it; no "Tap to say hi!" on an open-bubble, ridden or mounting dolphin or
  during a present drop; no dive tip while riding; Just Me on a dolphin holds her toy; the choice
  bubble closed by the dolphin bubble counts as one showing; the joystick label is set again on
  a world load; the tail help picture's wave. Details in the three team docs' "As built".
- [gate-A], [gate-B1]: §10.2 part A green on `08d2b92`; probe-merfolk split into `grids` and
  `review` passes (B3b, B3c).
- [rf2-ride]: probe-ocean R11 (no dolphin through the one she rides; `debug.ocean.setPod`); a
  buddy from her last ride goes back to its pod when she mounts another (`_mountNow`);
  probe-hud-sizes waits for the mount in game frames (at 1366x940 the 0.4 s mount took 7 s of
  wall clock at about 1.4 frames a second: a probe timing, not a game fault).
- [rf2-phone]: phones show one toast at a time (`src/ui/ui.js` `_toastRoom()`), in a narrower
  column clear of the life column and the tools; toasts jump below a sticker pop with no slide;
  on sideways phones new toasts wait while a pop shows and the walkie sits at right 240 /
  bottom 94, so its rings clear the hotbar and Photo / Fly.
- [rf2-six]: probe-multiplayer SIX checks that the "full" card is on top of the Join keypad and
  that each "Let in!" gave a seat; it runs as C3b (MULTIPLAYER.md "Six players").
- [rf2-hud]: probe-hud-sizes clear at all 19 sizes (D16-D22); probe-ocean X7's hop-off timed in
  two parts.
- [rf2-docs]: the notes above, the team docs' "As built" for these steps, MULTIPLAYER.md (6
  players, the full card) and §10.2 (B17-B17e, C3b, D16-D22).
- [rf2-x5]: the X5 decision (below): a dolphin bubble waiting for room is hidden and not
  tappable, its idle timer stands still, and it shows at the first free spot; probe-ocean X5
  checks the waiting bubble and that it shows clear of everything once the pop and toast leave.

- [rf2-c2]: Squish! and Put away show the moment she holds a toy (`hold()` / `putAway()` update
  the HUD); probe-squish C2 checks that and waits for game frames before the layout (below).

**Still open before the deploy** (none of them weakens a check):
- X5 on the upright phone (390 x 844): **decided** ([rf2-x5], the owner's default, set by the
  lead): on a crowded phone screen the dolphin bubble **waits**. Just after Hop off, with a
  sticker pop, a toast and Up / Down all up and no free spot, the bubble stays open but hidden
  and cannot be tapped (its idle timer stands still), and it shows with no overlap as soon as a
  free spot opens, at the latest once the pop and the toast are gone (with no pop or toast up it
  never waits). This is the design, not a loosened check: X5 now checks that while it waits it
  is hidden, Ride is not tappable and nothing overlaps, and that within 3 s of game time after
  the pop and the toast leave it shows inside the screen, Ride tappable, clear of every control
  (the same rectangle math). Every other X5 check is unchanged. B17d green on 390 x 844 and
  1024 x 1366 (154 s; pictures `.shots/wave4-x5-*-hopoff.png` and `-hopoff-shown.png`).
- probe-squish `--only=touch` C2 on the iPads (1024x1366, 1366x1024): **fixed** ([rf2-c2]). The
  root cause was timing, not a pop-in animation: `hold()` set the held toy at once, but Squish!
  and Put away only showed on the next game frame (`showHud()` ran in the system update), and on
  the GPU-less test machine one iPad-sized frame takes 600-800 ms (measured: hidden for 600-700
  ms, shown on the first frame after `held()`). Now `hold()` and `putAway()` update the HUD
  themselves; C2 checks the buttons show in the same moment as `held()`, then waits two game
  frames (plus the 600 ms) before the layout check. The check still fails a button that stays
  hidden. `--only=touch` green twice (about 215 s each).
- The ride pictures for the daughter (§7.3, `wave4-ride-mermaid.png`, `ocean-ride-*.png`): no
  dolphin crosses another any more, but the R10 camera cuts the ridden dolphin off at the bottom
  and her hair hides most of the side-saddle tail (**owner** or design call before she sees them).
- Small things for later (none blocks the deploy): the dolphin bubble moves between free spots
  while a sticker pop animates; toasts already up on a sideways phone when a pop starts fade out
  unseen; the walkie's busy label is cut with "..." on phones (older than wave 4).
- ~~The walkie on upright phones: its 22 px rings overlap hotbar slots and the joystick~~ Done
  in [p2-hud-finish] (upright) and [rf2-phone] (sideways); probe-hud-sizes 390x844 and 844x390
  clear in [rf2-hud].
- R-F (fish schools from her play camera): fixed in p2-fish-far (`motion.js` `fishY`, the back
  row a little above the front one; ocean.md "P2 fish fixes"), 10 of 10 runs on desktop and 10
  of 10 on iPad. Not re-run since: probe-ocean see,tap / ride / biomes / cost / wave4a / wave4b
  and probe-merfolk --only=water (the full gate runs them). ocean.md's older "Left as is" line
  about different kinds swimming close together is replaced by `apartKinds`.
- ~~16 of the 19 probe-hud-sizes sizes still to run~~ Done in [rf2-hud] on 7ec1495: all 19
  sizes are clear with the wave-4 states (alone and with friends), among them 390x844, 844x390
  (the walkie's rings clear the hotbar) and 1366x940 (the ride starts). A group of 4 took
  380-517 s and a group of 3 186-376 s, so the gate runs `--sizes=` groups of 3.
- [rf2-hud]: probe-ocean `--only=wave4b` (X6-X10) and probe-merfolk `--only=touch,friends` green
  on bfcbfc8. X7's hop-off check is timed in two parts: Rosie's new state reaches Lily within
  2 s of wall time, and the tail is gone within 2 s of Lily's game time (frames counted as
  `game.js` counts them, at most 0.05 s each). It had failed at 2033-2978 ms because two
  GPU-less pages ran at about 2 frames a second, so the tail's 0.175 s shrink took 4 frames of
  0.4-0.7 s; the message itself came in 200-550 ms. probe-hud-sizes runs as D16-D22.
- ~~The "full" card for a 7th player: check it is drawn above the Join keypad~~ Done in
  [rf2-six]: the card was always on top (the element at its centre is `.sw-net-msg`, with the
  wash and OK); the old picture was a stale frame from Zoe's lagging page. SIX now checks that,
  waits for fresh frames before the picture, and confirms each "Let in!" gave a seat (a lost tap
  had once left a seat free, so the 7th got "Knock knock" instead of the card). `--part=e` is
  C3b in §10.2.
- The **owner** items of "Integrator decisions" above, then §11 steps 2-5 (the build, the full
  gate of §10, one push to the live branch, the check on the live site).
