# Team "squishies": squishy toys to collect, squeeze and hold, and mystery presents earned with Sparkle Coins

The request, from the dad and his daughter (2026-10-04): *"Can you add squishys and neatos into
the game somehow google them if you want and dont know what they are and mystery presents that
you have to unlock once you get a certain amount of coins. Also add Dolphins, and sea animals,
and the option to turn into mermaid when you get in the water for a girl and a cool sea creature
for a boy..."* This document covers **the squishy toys, the squeeze toys ("neatos") and the
mystery presents**. Dolphins and sea animals in the world are team "ocean"
(`docs/teams/ocean.md`); the water forms are team "merfolk" (`docs/teams/merfolk.md`). This team
makes **squishy versions** of the dolphin, a starfish, a seashell and both water forms, so the
three features in the dad's message meet in the kid's hands (§13).

What the two toys are (research, 2026-10-04): "squishies" are slow-rise foam toys shaped like
foods and animals: you squeeze them flat and they slowly puff back up. "Neatos" is how kids say
the name of a brand of palm-sized, dough-filled squeeze balls that you squish and stretch and that
slowly go back to their shape (plain blobs, cubes, hearts, animals, glitter, fuzzy and jelly
kinds). **We copy none of their names, logos or characters, and no other company's character
design.** Both toy types get our own names (§0, §8.1) and every toy is our own design, built in
code from the game's own block-and-ball model kit. No picture from the web is used.

Status: **DESIGN, revised after review** (nothing built yet). Every `file:line` is the code as of
commit `669b6fa` on this branch.

Owner files (all new): `src/things/squish/*`, `src/core/squish-merge.js`,
`tools/test-squish.mjs`, `tools/probe-squish.mjs`, `tools/fixtures/squish-rich-profile.json`,
this file. Hooks outside the folder are small and listed in §4.2 and in the SHARED FILES list
(§4.4).

---

## 0. Decisions at a glance

| Question | Decision |
|---|---|
| Our names | Slow-rise foam toys are **Puffums** (one **Puffum**). Dough squeeze-and-stretch toys are **Stretchums** (one **Stretchum**). Together they are **squishy toys**, and the collection is the **Squish Shelf** (the panel and every button that opens it). "squishy" is only used as an ordinary word ("a squishy toy"), never as a product name, because "Squishies" is a registered toy trademark (§8.1). None of these names is used in the game today (`grep -rniE "puffum\|stretchum\|squish shelf\|mystery" src site` finds nothing). |
| How many | **48 toys**: 24 Puffums and 24 Stretchums, including a **Dolphin**, a **Starfish**, a **Seashell**, a **Mermaid Tail** and a **Sea Dragon** (the merfolk forms) and ten boy-leaning toys (§3.1). After all 48, each present lets the kid **pick one of their toys to make sparkly** (the Glitter round, 48 more). That is 96 presents in all (§6.6). |
| How you get them | **Only from mystery presents.** Nothing is bought, ever. No toy is found in the world in v1. |
| When a present comes | At milestones of **coins earned over time** (`profile.stats.coinsEarned`, which only goes up, `src/things/shops/coins.js:97-98`). Spending coins never takes a present away, never moves the progress ring, and **opening a present never takes coins**. The first present comes at 50 earned coins; the gap grows by 10 each time up to **100** (§3.2, §6.1). All 48 toys take 4,650 earned coins: about 5 weeks for a kid who explores new worlds, about 3 months for a kid who builds in one world (both tables in §6.1). |
| Players who already have coins | When the feature first starts in play, up to **3 welcome presents** wait for anyone who has earned at least 180 coins; the milestones then go on from where they are (§6.2). A start made from a stale offline copy is marked provisional and never causes a flood later. |
| What is inside | The **next toy in a fixed order** that the player does not have yet: **never a duplicate**, no rarity, no odds, no "rare!" words, no re-rolls. With Girl or Boy picked in the Dress-Up Studio (device only), presents alternate between **that side's own toys and shared toys, own first**: a Boy's first present is the Dino Puffum, a Girl's is the Unicorn Puffum, and the Dolphin Puffum is the 2nd present on Mix and the 4th on Girl or Boy (§6.3). Every toy comes in the end. |
| The unwrap | A full-card panel with the present in live 3D on the shared stage: **tap 3 times** (wiggle, wiggle, POP; taps during an animation are queued, never lost), rays, confetti, and the toy jumps out spinning with its name. A bouncing pointing finger shows what to do on the first-ever present (§5.3). |
| Where they live | **Squish Shelf** panel: opened by tapping the **coin pill** (it becomes a button, taught once by a pointing hand), from the pause menu, or from a button at the top of the Bag's **Squish Toys** tab. The tab has every toy you own (unlimited, free decor, like furniture). **Hold it** puts the toy in your hand with the Hand tool, so tapping squishes and never plants copies by accident. |
| Seeing progress | The shelf starts with a **present path**: the next present, big, with a fill bar that fills as you play and pops its ribbon when full, then two grey presents after it. Words are "**40 to go!**" with a coin picture, never "{n} more coins". A coin pill ring (28 px, 24 px on phones) fills too and wiggles when nearly full; a sparkle hops from the pill into the ring as coins land (§5.1, §5.4). |
| Playing with them | Any press does something. **Puffums** squash flat when pressed, **stay flat while held**, and **slowly rise** when let go. **Stretchums** squeeze on press, **stretch** when held past 0.3 s, and wobble back on release. This works on the shelf, in the unwrap, and with the **Squish!** button for a held toy; a Hand tap on a placed toy plays the full squash and rise. Soft synthesized sounds (§7.4). |
| Stickers | 4 new: **First Present!**, **Squish Collector**, **Squish Champion**, **Squeeze Me!** (§5.8). |
| Profile | One new top-level key `profile.squish` with `got` / `glit` / `seen` maps (union on every merge), a `base` (a real base beats a provisional one, then the earliest wins) and a `rest` marker (§3.3, §9.2). Added to the backup file. No new personal data. |
| Multiplayer | Each player's own. A held toy shows in the player's hand to friends through the existing presence field `hi` (a new key prefix, **no protocol change**). A toy placed in a friend's world is an ordinary `e+`. The look codec, the look option lists and `EMOTES` are **not changed** (§10). |
| Cost | An idle placed toy is **batched like furniture** (0 extra draw calls for 42 of the 48 kinds; 1 for the 6 see-through kinds). A toy being squished costs 1 call for about 2.3 s. Holding one is 1-2 calls. No new WebGL context (§11). |

---

## 1. Goals and non-goals

### Goals
1. A child plays as they always do and, every so often, a **mystery present** drops in. Opening
   it is a real moment: tap, tap, POP, a new toy they have never had.
2. A five-year-old who cannot read can **see** that playing fills up the next present: the
   present path and the ring are pictures, not numbers.
3. Collecting lasts for **weeks**: 48 different toys, then the Glitter round, with a shelf that
   shows what is still a mystery.
4. The toys are **fun to touch**: press and hold, let go and watch it puff up; squeeze and stretch;
   with soft sounds, on the shelf, in the hand and in the world.
5. Kids can **hold** a toy, **put it** on a table or the floor of their world (as many as they like,
   like any furniture), and friends playing together can **see** the toy in their hand.
6. Picking **Boy** clearly changes which toys come first; nothing in the feature is pink-only.
7. Nothing is ever bought. Coins only come from playing. Opening never spends. The words never
   mention prices or buying, and no coin number ever sits next to a present like a price tag.
8. Old saves, cloud copies, backup files and multiplayer keep working, and **no toy is ever lost**
   when two devices disagree (including an old tab left open on an iPad).
9. The picture stays as sharp as today, and idle play costs nothing new per frame.

### Non-goals (v1)
- No trading or giving toys to other players (it would mean toys moving between profiles; v2 at
  the earliest, with the dad).
- No toys found lying in the world (it would need the per-host-world tracking that gems use,
  `src/net/adapter.js:56-74`; see §16 Q4).
- No random drops, rarity tiers or "chance" wording of any kind.
- No new look option, no Dress-Up hand accessory for toys (the held toy is enough and needs no
  codec change). No new emote.
- No NPC friend squeezing toys (an optional extra, §12).

---

## 2. How the code works today (what this builds on)

- **Coins.** `profile.coins` starts at `START_COINS = 100` (`src/things/shops/coins.js:17`);
  `ensure()` repairs it (`:74-84`). `add(n, reason)` raises `coins` **and**
  `stats.coinsEarned` (`:91-106`), emits `'coins:change' { coins, delta, reason }` (`:100`) and
  flies coins into the pill; `'coins:shown' { shown }` (`:88`) fires as the pill's number counts
  up. `spend()` (`:108-119`) never touches `coinsEarned` and sets `shown` at once (`:116`).
  Earning sources and amounts are `EARN` (`:18`): gem 10, harvest 3, cook 5, new sticker 20,
  first pat of a pet each day 2, daily gift 25. Every earning listener skips friends' actions
  (`remote()`, `:66`).
- **`coinsEarned` is as old as coins.** It was in the first coins commit (`530b988`), so every
  profile that ever earned a coin has it. Profiles that never earned have no `coinsEarned`
  (`tools/fixtures/boys-old-profile.json`: `coins: 100`, no `coinsEarned`). The old-world fixture
  has `coins: 160, coinsEarned: 60` (`tools/fixtures/old-world-96565e4.json`). `coins - 100` is a
  lower bound of what was earned (spending only lowers `coins`), so the earned total is
  `max(coinsEarned, coins - 100)`.
- **Where coins come from in practice.** Gems pay 10 each and there are 24-30 per new world
  (`src/life/collectibles.js:166`), so a kid who keeps making new worlds earns about 100-150 a
  day. A kid who builds in one world earns the daily gift (25), pet pats (2 each), harvests (3) and
  cooking (5): about 40-60 a day once the one-time stickers are gone. §6.1 plans for both.
- **The daily gift** (`coins.js:244-326`) drops a DOM box with "A present for you!" / "Tap to
  open!" (`:270`) that **opens by itself** after 4.2 s (`:296`). It waits for a clear world
  (`blocked()` `:247-250`, a local closure: no panel, dialog, photo mode, fade, sticker pop or
  tutorial tip), waits for the tips or 90 s of play (`:322-324`), and is never shown to automated
  browsers unless asked (`bot`, `:67`, `:252-257`). `game.coins.giftShowing` (`:353`).
- **The sticker pop** (`src/life/stickers.js:72-198`) is the model for gating a big moment; its
  rays are a local closure (`:77-112`). Stickers are registered as `{ id, name, hint, icon,
  art(ctx) }` (`:7`); other teams add theirs on `game:ready` (shops:
  `src/things/shops/index.js:84-89`). `game.stickers.award(id)` (`:205-217`) pays +20 coins.
  `game.stickers.total()` (`:219`) is the live count (32 today).
- **Models.** The furniture `Kit` (`src/things/furniture/kit.js`) has `box`, `cyl`, `cone`,
  `ball`, `torus`, `stick`, `pixels`, `hitbox` (`:295`), and named moving **parts** (`part()`
  `:288`). `build()` (`:307-325`) merges the meshes of each part into a **new** `BufferGeometry`
  on every build (only the unit primitives are cached in `cachedGeo`). Meshes that are direct
  children of the model are marked `userData.batch` (`:321`); plain colors and shared opaque
  materials all land on **one atlas material** (`src/things/furniture/atlas.js:96-112`).
  `sheer()` (see-through, `src/things/furniture/paint.js:68-75`) gets its own transparent mesh.
  The Teddy Bear (`src/things/furniture/models-garden.js:406-428`, about 0.65 blocks tall) is the
  model for a soft toy.
- **Batching.** `StaticBatcher.add` (`src/things/entities.js:76-85`) bakes only **direct mesh
  children** of the model that are `userData.batch`, opaque, on a shared material. Meshes inside
  a part (a child `Group`) are never batched and cost a draw call each. `entities.refresh(entity)`
  (`:707`) rebuilds one entity.
- **Furniture.** `game.entities.define(def)` (`entities.js:326-353`) auto-registers a Bag item
  `furn:<key>`. Table pieces use `placeOn: 'table'`: tapped onto a piece, they go in cell
  `ref.y + h` (`:780`) with `yOffset = table.y + table.yOffset + surface - y` (`:476-478`), so a
  surface must be measured from the bottom of the piece's **top** cell row (the 1-high Bookshelf
  has `surface: 0.98`, `furniture/catalog.js:73-74`; the 2-high Big Bookshelf `1.98`,
  `:105-106`). The pick box is the model's tight bounds (`:550`). Per-item defs with `hidden` Bag
  items that show once owned are the basket's pattern (`src/things/cooking/basket.js:58-81`,
  `:115-152`). Entity actions run locally (`entities.use`, `:808-815`) and emit `'entity:use'`, a
  "save soon" event (`src/core/game.js` `DIRTY_EVENTS`, `:32-35`). A world opened by a build that
  does not know an entity key drops it (`:898-900`).
- **Bag tabs.** `ITEM_CATEGORIES` (`src/core/registry.js:10-15`) lists the tabs; the Bag makes a
  tab only for a known category and puts anything else under "More"
  (`src/ui/inventory.js:181-193`). Modules splice their own tab in: vehicles after `shops`
  (`src/things/vehicles/index.js:56-59`), camping after `fun`
  (`src/things/outdoor/extras.js:138-141`).
- **Tools and the hotbar.** `game.setTool('build' | 'remove' | 'hand')` (`game.js:951`);
  selecting a filled hotbar slot switches to Build (`:962`).
- **Holding.** `avatar.hold(obj, 'hold' | 'eat')` (`src/player/avatar.js:340`) has one slot; held
  things hide while sleeping or swimming. Treats are held while the selected hotbar slot is
  `food:treat_*` (`src/things/shops/treats.js:163-194`); `letGo()` only releases its own object
  (`:172-178`); `hold()` (`:197-211`) picks the slot. Life-HUD buttons Eat / Put away are orders
  30 / 31 and set their own face SVG after `add()` (`:290-297`). A held treat is scaled 0.9
  (`HAND`, `treats.js:27`).
- **Presence `hi`.** `adapter.local()` sends `hi: this.heldKey()` (`src/net/adapter.js:591`).
  `heldKey()` (`:606-617`) returns null early when there is no `game.treats` and again inside
  its `try`. The host and guests keep `hi` only if it matches `HELD_KEY_RE =
  /^[a-z0-9_-]{1,48}$/` (`src/net/protocol.js:216`, `src/net/host.js:1413`). Friends' pages draw
  it with `heldModel(game, key)` (`src/net/remote-players.js:56-67`), which knows treats and foods
  only. The test fake adapter's `local()` sends only fields a test set (`vh`,
  `tools/net/fake-adapter.mjs:426-430`).
- **Live 3D in a panel.** `preview(game)` (`src/things/pets/preview.js`) borrows the Dress-Up
  shared stage: `mount(el)`, `show(obj, { onFrame, spin, ... })`, `unmount()`. `show()` takes
  **one** object, disposes the previous one and frames the camera once from its bounding box
  (`:110-135`); its own pointer handlers spin the object on drag (`:31-40`). No new WebGL
  context. Static icons: `game.thumbs.get(key, build)` (`src/core/thumbs.js:44`).
- **HUD.** The coin pill is a passive `div` (`src/ui/hud.js:358-362`, class `sw-passive`, `:12`).
  `refreshCoins` (`:516-530`) returns early when the shown number did not change (`:522`); it is
  bound to `coins:shown` (`:530`). The left life-HUD column:
  `lifeHud(game).add(name, { icon, label, color, order, onClick })` / `.show(name, on)`
  (`src/things/pets/kit.js:345-383`) draws `lifeIcon(icon)` from `PATHS` (`:253-279`; unknown
  names fall back to the sparkle) and has no badge. On phones the labels are hidden
  (`:338-339`), so **the icon is the only thing that tells buttons apart**. The pause menu has a
  row grid (`src/ui/menus.js:886-889`).
- **Profile merges.** Load: `mergeProfile` spreads unknown top-level keys
  (`src/core/game.js:60-69`). `saveProfile()` is debounced by 400 ms and `saveProfile(true)` saves
  at once (`:548-557`). Cloud: `src/account/merge.js:40-56` takes the newer copy for every key not
  listed, unions `stickers`, maxes `stats` and `coins`. A 409 during play is merged through
  `store.onProfile` with `Object.assign(g.profile, mergeProfile(g.profile, merged))`
  (`src/account/index.js:152-155`): it **replaces** `g.profile.squish` and emits no
  `profile:changed`. Offline or on a cloud timeout, `loadProfile` returns the local copy
  (`src/core/storage.js:805-815`). Backups: `BACKUP_PROFILE_KEYS` (`storage.js:86`),
  `mergeBackupProfile` (`:110-145`, the "changed" test is a JSON compare at `:144`).
  `profileHasPlay` (`src/account/legacy.js:36-38`). The server imports `src/core/storage.js`
  (`server/saves.mjs:35`); its `putProfile` (`:147-174`) has no build check.
- **Device-only style.** Girl / Boy / Mix is `store.deviceGet('surpriseStyle')`, read through
  `game.surpriseStyle()` (`src/ui/dressup.js:100`, `:360-366`). It never enters the profile.

---

## 3. Data shapes

### 3.1 The toys (`src/things/squish/data.js`, pure: no three.js, no DOM)

```js
// APPEND ONLY. Keys are saved in profiles and worlds, sent as presence `hi`, and pinned by the
// golden list ITEMS_V1 in tools/test-squish.mjs. Never remove, rename or reorder an entry.
export const ITEMS = [
  { key, name, kind: 'puff' | 'stretch', shape, colors: [main, accent, detail], tag: 'g' | 'b' | 'gb', look },
  ...
];
export const PRESENT_ORDER = [...keys];   // APPEND ONLY too (a permutation of ITEMS keys)
```

- `key` matches `/^(pf|st)_[a-z]+(_[a-z]+)*$/`, is at most 20 characters, and **never ends in
  `_g`** (A1). Furniture defs are `squish_<key>`; glitter defs use their own prefix,
  `squishg_<key>` (at most 28 characters, inside `HELD_KEY_RE`), so no future key can collide
  with a glitter def.
- `name` is at most 20 characters. A glitter toy keeps the **same name** and shows a gold star
  badge next to it (the word "Glitter" is never glued to the name, so it always fits a 72 px
  cubby). Where a sentence needs words, it says "sparkly {name}".
- `shape` picks a recipe in `models.js` (§7.1). `colors` are `#rrggbb`. `tag` is the same letter
  scheme as the wardrobe (`src/player/wardrobe-data.js:40`) and is only used to order presents
  for the device's Girl / Boy pick (§6.3). Every toy is for everyone.
- Faces everywhere are closed smiles: **no teeth on any toy**.

**Puffums** (kind `puff`: matte foam, squash fast, rise slowly over about 2.2 s)

| # | key | name | shape | colors (main, accent, detail) | tag | look (Kit recipe in short) |
|---|---|---|---|---|---|---|
| 1 | `pf_strawberry` | Strawberry Puffum | berry | `#FF5F7E #FFE9A8 #4FB860` | gb | plump berry (ball, `sy` 0.9, on a short cone), cream seed pixels, crown of 5 flat green leaves, smile |
| 2 | `pf_toast` | Toasty | toast | `#F7D9A0 #C98A45 #FF9EB8` | gb | bread slice: rounded box with two-ball top, darker crust rim, sleepy eyes, pink cheeks |
| 3 | `pf_donut` | Sprinkle Donut | donut | `#E9B26C #FF8FC8 #FFFFFF` | gb | torus dough, flatter pink torus icing on top, 14 rainbow sprinkle boxes |
| 4 | `pf_cupcake` | Cupcake Puffum | cupcake | `#FFB3C7 #A6D8FF #E8203F` | g | striped wrapper cylinder, 3-ball swirl frosting, cherry with a stem |
| 5 | `pf_peach` | Peachy | peach | `#FFB38A #FF8FA3 #4FB860` | g | ball with a darker cleft stripe, one leaf, blush |
| 6 | `pf_icecream` | Ice Cream Puffum | icecream | `#E9B26C #BDF2DA #FFB3C7` | gb | cone with waffle pixels, mint and pink scoops, a drip |
| 7 | `pf_macaron` | Macaron | macaron | `#C8B4FF #FFFFFF #FFB3C7` | g | two squashed cylinders with a cream filling ring, face |
| 8 | `pf_watermelon` | Melon Slice | melon | `#FF6F7D #3FB66B #3A1F4D` | gb | thick half-disc (half cylinder of stacked boxes), green rind, seed pixels, face |
| 9 | `pf_rocket` | Rocket Puffum | rocket | `#F2F6FA #FF5F7E #6CC6FF` | b | chubby rounded rocket, red cone nose, round sky window with a smiling face, 3 red fins, a puffy flame of 3 orange-yellow balls under it |
| 10 | `pf_bunny` | Bunny Puffum | bunny | `#FFF0F6 #FFB8D6 #3A1F4D` | g | round body, two long ears (balls `sy` 2.4) with pink insides, cotton tail |
| 11 | `pf_kitty` | Kitty Loaf | catloaf | `#FFC98F #FFFFFF #3A1F4D` | gb | loaf-shaped cat (rounded box), cone ears, white paws, tail curled round |
| 12 | `pf_panda` | Panda Puffum | panda | `#FFFFFF #3A1F4D #FF9EB8` | gb | round panda, dark ears and eye patches, blush |
| 13 | `pf_cub` | Cuddle Cub | bear | `#9A6B4F #FFD9C2 #FF5F7E` | gb | cocoa-brown sitting cub, cream muzzle and tummy, hugging a little red heart, a small bow on one ear (no honey pot, §8.1) |
| 14 | `pf_frog` | Froggy | frog | `#7FD37A #FFF1B8 #FF8FA3` | gb | wide squat frog, eyes on top, big closed smile |
| 15 | `pf_penguin` | Penguin Puffum | penguin | `#3E4A7A #FFFFFF #FFB347` | gb | egg-shaped penguin, white tummy, orange beak and feet |
| 16 | `pf_dino` | Dino Puffum | dino | `#7FD37A #FFE066 #3A1F4D` | b | chubby dino, row of yellow back spikes (cones with round tips), little arms, tail |
| 17 | `pf_shark` | Shark Puffum | shark | `#8FB8E8 #FFFFFF #3A1F4D` | b | round, smiling shark: top fin, tail, white tummy, **closed smile and pink blush, no teeth** (§13, Q7) |
| 18 | `pf_unicorn` | Unicorn Puffum | unicorn | `#FFFFFF #FFD1E6 #FFC94D` | g | round unicorn, gold horn, pastel rainbow mane balls |
| 19 | `pf_whale` | Splashy Whale | whale | `#6CC6FF #E6F6FF #3A1F4D` | gb | round whale, tail flukes, a 3-ball water spout |
| 20 | `pf_sloth` | Sleepy Sloth | sloth | `#B79A80 #F1E1CF #3A1F4D` | gb | round sloth, face mask, sleepy smile, long arms hugging itself |
| 21 | `pf_octopus` | Octo Puffum | octopus | `#FF9CCB #FFD1E6 #3A1F4D` | gb | round head, 6 curled legs (quarter tori) |
| 22 | `pf_dolphin` | Dolphin Puffum | dolphin | `#6A80CC #F7FBFF #3A1F4D` | gb | chubby round dolphin (ball `sx` 1.3) in ocean's `sky` palette (ocean changed it from #8EB8E0 to #6A80CC after the owner reviews, so it reads on blue water): pale belly, short beak with a smile line, round forehead, dorsal fin, two flippers, V tail flukes, blush |
| 23 | `pf_mermaid` | Mermaid Tail | mermaid | `#9EE3CF #C8B4FF #FFFFFF` | g | a plump J-curl of tail (5 stacked balls) standing on its curl, mint-to-lilac scale pixels, the merfolk Mermaid's **round two-lobed fin** at the top, a pearl on the curl |
| 24 | `pf_seadragon` | Sea Dragon Puffum | seadragon | `#5FC9B5 #FFD43B #3A1F4D` | b | chubby sitting sea dragon (merfolk's own creature): a ridge of soft round-tipped spikes, a pointed **three-tip tail fin**, fan frills by the head, shiny scale pixels on the cheeks, closed smile |

**Stretchums** (kind `stretch`: dough-filled, squeeze softly, stretch when held)

| # | key | name | shape | colors | tag | look |
|---|---|---|---|---|---|---|
| 1 | `st_bubblegum` | Bubblegum Blob | blob | `#FF8FC8 #FFFFFF #3A1F4D` | gb | soft round blob (`sy` 0.92), shine dot, tiny face |
| 2 | `st_cube` | Squeezy Cube | cube | `#C8B4FF #FFFFFF #3A1F4D` | gb | rounded cube (box + 8 corner balls) |
| 3 | `st_heart` | Heart Squeeze | heart | `#FF5F7E #FFFFFF #3A1F4D` | g | heart from two balls and a cone |
| 4 | `st_star` | Star Squeeze | star | `#FFC94D #FFFFFF #3A1F4D` | gb | chubby standing 5-point star (5 cones round a ball) |
| 5 | `st_cloud` | Cloud Squeeze | cloud | `#E6F6FF #FFFFFF #3A1F4D` | gb | cluster of 5 balls, flat bottom |
| 6 | `st_gold` | Gold Glitter Ball | glitter | `#FFE9A8 #F2A900 #FFFFFF` | gb | see-through ball (`sheer`) with glowing gold flecks inside |
| 7 | `st_rainbow` | Rainbow Glitter Ball | glitter | `#FFFFFF #FF8FC8 #6CC6FF` | g | see-through ball, flecks in 6 rainbow colors |
| 8 | `st_galaxy` | Galaxy Ball | glitter | `#3E2A7A #FFE27A #9C7BFF` | b | dark see-through ball with star-shaped flecks |
| 9 | `st_lime` | Lime Jelly | jelly | `#9BE86A #DFFFC2 #3A1F4D` | gb | see-through green ball with little bubble balls inside |
| 10 | `st_grape` | Grape Jelly Cube | jellycube | `#9C7BFF #E6DDFF #3A1F4D` | gb | see-through rounded cube with bubbles |
| 11 | `st_ocean` | Ocean Jelly | jelly | `#6CC6FF #FFB347 #FFFFFF` | gb | see-through blue ball with two tiny **plain orange** fish inside (one color, no white bands or stripes) |
| 12 | `st_peachfuzz` | Fuzzy Peach | fuzzy | `#FFC2A8 #FF9EB8 #3A1F4D` | g | fuzzy ball (`fluffyMat`), blush |
| 13 | `st_snowball` | Snowball | fuzzy | `#FFFFFF #A6D8FF #3A1F4D` | gb | fuzzy white ball, blue snowflake pixels |
| 14 | `st_moon` | Glow Moon | glow | `#E8FFB8 #C9F2A0 #3A1F4D` | gb | softly glowing ball (`glow(color, 0.35)`), crater pixels, sleepy face |
| 15 | `st_kitty` | Kitty Blob | animal | `#FFC4DD #FF8FB1 #3A1F4D` | g | blob with cone ears and whiskers |
| 16 | `st_ducky` | Ducky Blob | animal | `#FFE066 #FF9F43 #3A1F4D` | gb | blob with a beak and a tuft |
| 17 | `st_piggy` | Piggy Blob | animal | `#FFB3C7 #FF8FA3 #3A1F4D` | gb | blob with a snout and floppy ears |
| 18 | `st_dinoegg` | Dino Egg | egg | `#BDF2DA #7FD37A #3A1F4D` | b | speckled egg with a crack and a little dino face peeking out |
| 19 | `st_zoom` | Zoom Blob | zoom | `#5FC9C9 #FFC94D #3A1F4D` | b | teal blob, **two** big shiny eyes, two bendy antennae (3 tilted little balls each) **tipped with yellow stars**, closed smile (replaces "Space Buddy", §8.1) |
| 20 | `st_soccer` | Soccer Squeeze | ball | `#FFFFFF #3A1F4D #FF5F7E` | b | white ball with dark patch pixels |
| 21 | `st_starfish` | Starfish Squeeze | starfish | `#FF9F5A #FFFFFF #3A1F4D` | gb | five plump arms lying flat (like ocean's starfish), white dot pixels, a tiny smile in the middle |
| 22 | `st_shell` | Seashell Squeeze | shell | `#FFC2D1 #FFF1E6 #FFFFFF` | g | fan-shaped scallop shell standing up: 5 rounded ribs, a little pearl ball at the hinge |
| 23 | `st_robot` | Robot Blob | robot | `#AFC3D6 #6CC6FF #FF5F7E` | b | rounded square blob, a sky screen face with pixel eyes and smile, two bolt ears, a little round light on top |
| 24 | `st_volcano` | Volcano Squeeze | volcano | `#8B6B5A #FF7A3D #FFD43B` | b | squat rounded cone, an orange "lava" blob with yellow drips on top (stretching pushes the lava blob up) |

Tag counts: 10 `b`, 11 `g`, 27 `gb` (checked with node). Sea toys: Dolphin, Mermaid Tail, Sea
Dragon, Splashy Whale, Octo, Shark, Ocean Jelly, Starfish, Seashell.

**`PRESENT_ORDER`** (the Mix order; Girl and Boy use it through the rule in §6.3):

```
pf_strawberry pf_dolphin   st_bubblegum pf_dino     pf_unicorn  st_starfish pf_seadragon st_heart
pf_mermaid    st_robot     pf_donut     st_cube     pf_shark    st_shell    pf_bunny     st_gold
pf_whale      st_galaxy    pf_cupcake   st_ducky    pf_rocket   st_rainbow  pf_kitty     st_volcano
pf_panda      st_kitty     pf_octopus   st_zoom     pf_peach    st_star     pf_icecream  st_dinoegg
pf_cub        st_peachfuzz pf_toast     st_soccer   pf_macaron  st_lime     pf_frog      st_ocean
pf_penguin    st_moon      pf_sloth     st_cloud    pf_watermelon st_grape  st_snowball  st_piggy
```

The first 8 presents for each style (computed with the §6.3 rule in node; pinned in A7):

| style | presents 1-8 |
|---|---|
| Mix | Strawberry Puffum, **Dolphin Puffum**, Bubblegum Blob, Dino Puffum, Unicorn Puffum, Starfish Squeeze, Sea Dragon Puffum, Heart Squeeze |
| Girl | **Unicorn Puffum**, Strawberry Puffum, Heart Squeeze, **Dolphin Puffum**, Mermaid Tail, Bubblegum Blob, Seashell Squeeze, Starfish Squeeze |
| Boy | **Dino Puffum**, Strawberry Puffum, Sea Dragon Puffum, **Dolphin Puffum**, Robot Blob, Bubblegum Blob, Shark Puffum, Starfish Squeeze |

A Girl device gets no `b` toy before present 39, a Boy device no `g` toy before present 38.

### 3.2 Milestones (pure functions in `data.js`)

```js
export const START_COINS = 100;           // same value as coins.js:17 (not imported: no UI deps)
export const FIRST = 50, STEP = 10, MAX_GAP = 100, WELCOME = 3;

/** The gap before present n (1-based): 50, 60, 70, 80, 90, then 100 every time. */
export function gap(n)        // min(MAX_GAP, FIRST + STEP * (n - 1))
/** Earned coins needed (counted from base) for present n. */
export function threshold(n)  // T(n) = gap(1) + ... + gap(n)
/** Everything earned so far (spending never lowers it). */
export function earned(p)     // max(stats.coinsEarned || 0, (coins || 0) - START_COINS, 0), floored, finite
export function presentsTotal()                       // 2 * ITEMS.length (toys + glitter)
export function opened(p)     // count of keys in squish.got + squish.glit (known or not)
export function milestone(p, n) // earned coins at which present n is reached (base, or rest for n > rest.n, §6.6)
export function reached(p)    // largest n <= presentsTotal() with milestone(p, n) <= earned(p)
export function ready(p)      // max(0, min(reached(p) - opened(p), presentsTotal() - knownOpened(p)))
export function progress(p, inFlight) // 0..1 toward the next present, 'ready', or 'done' (§5.1)
export function toNext(p)     // coins still to earn for the next present, or null when all are opened
export function nextItem(p, style) // { key, glitter, pick } or null (§6.3, §6.6)
export function makeBase(p, nowIso, { prov }) // §6.2
export { mergeSquish } from '../../core/squish-merge.js'; // §9.2
```

`T(n)` values (checked with node): 1: 50, 2: 110, 3: 180, 4: 260, 5: 350, 6: 450, 8: 650,
10: 850, 11: 950, 12: 1,050, 16: 1,450, 24: 2,250, 32: 3,050, **48: 4,650**, 64: 6,250,
**96: 9,450**. Every loop is bounded by `presentsTotal()`; there is no `while` in `data.js` or
the present-picking path (the vehicles rule, `tools/test-vehicles.mjs:461`).

### 3.3 Profile

```js
profile.squish = {                    // NEW, created lazily in play (§6.2), never deleted
  v: 1,
  got:  { [itemKey]: isoDate },       // toys opened from presents (earliest date wins)
  glit: { [itemKey]: isoDate },       // glitter versions made (earliest date wins)
  seen: { [itemKey | itemKey+':g']: 1 }, // the "NEW!" tag was cleared (§5.4)
  base: { coins: number, at: isoDate, prov?: 1 }, // where the milestones start (§6.2)
  rest: { n: number, coins: number }  // optional: the last time every present was opened (§6.6)
}
profile.stats.squishes                // NEW counter: toys squeezed (max-merged with the other stats)
```

- `profile.squish` is game data, not personal data. It holds item keys, dates and coin counts.
- Not in `defaultProfile` (`src/core/game.js:41-57`): `game.js` is not changed.
- **Nobody caches `game.profile.squish`.** A 409 merge replaces the object (§2), so every reader
  goes through `game.profile.squish` each time.
- Worst-case size: 96 keys in `got`/`glit` plus 96 in `seen`, about 8 KB, far under the 256 KB
  profile cap (`server/saves.mjs:48`).
- Unknown keys inside `squish` (from a newer build) are kept by every merge (§9.2).

### 3.4 World entities

- 96 toy defs: `squish_<key>` and `squishg_<key>`. `{ category: 'squish', size: [1,1,1],
  colliders: 'none', placeOn: 'table', actions: ['squish'], defaultData: {}, build(color, data,
  entity), update(entity, dt) }`. No colors (no "Pick a color!" step). No per-entity data, so
  nothing in a world save is new except the keys.
- 1 more def, **Toy Shelf** `toy_shelf`: a **low, kid-height shelf** `{ category: 'squish', size:
  [2,1,1], placeOn: 'floor', surface: 0.98, colliders: [[0, 0, 0.05, 2, 0.98, 1]], colors:
  [wood, white, sky, pink] }` (the normal furniture color swatch, so it has the "Pick a color!"
  step; heart cut-outs only on pink). Toys tapped onto it stand on its top at `shelf.y +
  shelf.yOffset + 0.98` (W1). The two inner boards are **decoration only**: nothing can be placed
  on them. Shown in the Squish Toys tab once the first toy is owned.
- Bag items are the auto items `furn:squish_<key>` / `furn:squishg_<key>`, set `hidden` until owned
  (the basket's pattern, `basket.js:76-77`, `:144-150`).

### 3.5 Presence

No new field. A held toy is presence `hi` = its def key, e.g. `squish_pf_strawberry` or
`squishg_st_gold` (at most 28 characters; `HELD_KEY_RE` allows 48).

### 3.6 Events (append to the DESIGN.md events table, `docs/DESIGN.md:258-284`)

```
'squish:get'      { key, glitter, n }        // a present was opened; n = presents opened so far
'squish:squeeze'  { key, glitter, where }    // where: 'hand' | 'world' | 'shelf' | 'present'
'present:ready'   { ready }                  // the number of waiting presents went up
```

None of them is a "save soon" world event (they change only the profile). A Hand squish on a
placed toy does emit the existing `'entity:use'` (§11).

---

## 4. Files

### 4.1 New files

| file | contents |
|---|---|
| `src/core/squish-merge.js` | `mergeSquish(a, b)` only (§9.2). **Pure and dependency-free** (no imports at all), so `storage.js` and through it the server can import it without loading any game module. |
| `src/things/squish/data.js` | `ITEMS`, `PRESENT_ORDER`, milestone math, `makeBase`, `nextItem`, re-export of `mergeSquish`, `STRINGS` (every player-facing string, §8.2). Pure (imported by Node tests). |
| `src/things/squish/models.js` | `toyModel(key, { glitter, live })` (Kit recipes per `shape`, §7.1), `heldToy(key, glitter)`, `presentModel(wrapIndex)` (the lilac mystery box with a `lid` part, a `bow` part and a "?" tag), `toyShelf(color)`, `SHAPES`. Sets `obj.name = 'squish:' + key + (glitter ? ':g' : '')`. |
| `src/things/squish/index.js` | `install(game)`: entity defs and the `squish` action, the Bag tab (`ITEM_CATEGORIES` splice), hidden-until-owned items, holding (hotbar sync), life-HUD buttons, stickers, the presents system (§6), `refresh()` (§6.7), `game.squish` facade, `game.debug.squish`. |
| `src/things/squish/panel.js` | Panels `'squish'` (Squish Shelf) and `'present'` (the unwrap), the present drop overlay, the one-time tips, CSS. |
| `src/things/squish/anim.js` | The press / squish / slow-rise / stretch curves (pure functions of time, shared by world, hand, shelf and unwrap). |
| `src/things/squish/sfx.js` | `squishSfx(game, name)`: `squish`, `rise`, `stretch`, `snap`, `rustle`, `shake`, `unwrap` (synthesized, §7.4). |
| `src/things/squish/fx.js` | **Copies** (with `mulberry32` from `src/core/util.js` in place of `Math.random`) of the coins' `blocked()` rule, the shop confetti burst and the sticker rays, which are local closures in files this team does not change (§2). |
| `src/things/squish/art.js` | Sticker art for the 4 stickers, the mystery present SVG for the drop, the shelf path and the tip card, the Bag tab picture fallback. |
| `tools/test-squish.mjs` | Node tests A1-A16 (§14.1), a few seconds. |
| `tools/probe-squish.mjs` | Browser probe (§14.3), flags `--only=desktop,touch,world,save,mp,grids,cost`. |
| `tools/fixtures/squish-rich-profile.json` | A profile saved by today's build (before this team's change) with `coinsEarned` about 2,000 (§14.3 E3). |

`package.json`: `"test:squish": "node tools/test-squish.mjs"`,
`"probe:squish": "npm run build && node tools/probe-squish.mjs"`.

### 4.2 Changed files (game and server)

| File | Functions / lines | Change |
|---|---|---|
| `src/main.js` | imports `:4-38`, `modules` `:51-53` | import `* as squish from './things/squish/index.js'`; add `squish` right after `vehicles` (needs entities, furniture, cooking/shops for `game.coins`, and `ui`). |
| `src/core/registry.js` | `ITEM_CATEGORIES` `:10-15` | **not edited**: `squish/index.js` `install()` splices `['squish', 'Squish Toys']` in **right after `'fun'`** (Fun & Toys), the way camping and vehicles do (`outdoor/extras.js:138-141`, `vehicles/index.js:56-59`), guarded by "not already there". Since squish installs after outdoor, it lands between Fun & Toys and Camping. |
| `src/account/merge.js` | `mergeProfile` `:40-56` | `if (isObj(local.squish) \|\| isObj(server.squish)) out.squish = mergeSquish(local.squish, server.squish);` (imported from `../core/squish-merge.js`). Header comment `:1-7` gains "squish: union of toys; a real base beats a provisional one, then the earliest". |
| `src/core/storage.js` | `BACKUP_PROFILE_KEYS` `:86`; `mergeBackupProfile` `:110-145`; `loadProfile` `:803-815` and `_loadProfileRev` | add `'squish'` to the keys; in the backup merge, `if (isObj(f.squish)) current.squish = mergeSquish(current.squish, f.squish);` (only when the **file** has toys, fresh or not). Import from `./squish-merge.js` (no `things/` import in core). In `loadProfile`, set `this.profileStale = true` when a cloud backend exists and the cloud read threw or timed out (both paths), else `false` (§6.2). |
| `server/saves.mjs` | `putProfile` `:147-174` | **A small guard** (§9.1): inside the existing advisory-lock transaction, when the incoming body has no `squish` and a row exists, read the stored `body`, gunzip it once, and if it has `squish`, copy that `squish` into the incoming profile before it is stored. The server already imports `src/core/storage.js` (`:35`), which now imports only the dependency-free `squish-merge.js`; a Node test checks the server still loads (A15). |
| `src/account/legacy.js` | `profileHasPlay` `:36-38` | also true when `Object.keys((p.squish && p.squish.got) \|\| {}).length > 0`. |
| `src/ui/hud.js` | coin pill `:358-362`; a new `refreshRing` | the pill becomes a `button` (`type="button"`, classes `sw-pill sw-coins`, **no** `sw-passive`), `aria-label` "Sparkle Coins: {n}. Open the Squish Shelf", `onClick` `game.runAction('squish')` when that action exists (else it stays passive). A **present ring** span `.sw-coins-ring` after the number (§5.1). The ring has **no text** (the probe-shops check reads the pill's `textContent`, `tools/probe-shops.mjs:246`). It has its **own** `refreshRing()` bound to `coins:shown`, `coins:change` and `squish:refresh` (not inside `refreshCoins`, which returns early when the number did not change, `:522`). |
| `src/ui/inventory.js` | `TAB_COLORS` `:18-22` | `squish: '#FF9CCB'`; no `TAB_PICS` entry (the tab falls back to its first owned toy, `:389-395`). The **Squish Shelf** button at the top of the tab is added by `panel.js` through the Bag's existing tab-open hook (or, if there is none, a one-line `onTab` callback here; the builder says which). |
| `src/ui/menus.js` | pause panel row `:886-889` | a **Squish Shelf** button (`variant: 'pink'`, icon from `art.js`) before Settings when `game.actions.has('squish')`. |
| `src/things/pets/kit.js` | `PATHS` `:253-279` | three icons: **`present`** (a wrapped box with a bow and a "?"), **`squish`** (a round blob squashed flat under a flat hand), **`shelf`** (a little shelf with two blobs on it). The ocean team adds `dolphin` here too. |
| `src/net/adapter.js` | `heldKey()` `:606-617`; comment `:588-590` | `heldKey()` returns early twice when there are no treats, so a line "after the treat" would be skipped. Instead: rename today's body to `treatHeld()` unchanged, add `squishHeld()` (`const sq = this.game.squish; try { const k = sq && sq.held(); return typeof k === 'string' ? k : null; } catch { return null; }`), and `heldKey() { return this.treatHeld() \|\| this.squishHeld(); }`. Comment: "treats and squishy toys are the writers of `hi`". |
| `src/net/remote-players.js` | `heldModel` `:56-67` | before the food fallback: `if (/^squishg?_/.test(key) && game.squish && typeof game.squish.model === 'function') return game.squish.model(key);` (inside the try). |

Not changed: `game.js`, `player.js`, `avatar.js`, `wardrobe-data.js` (`EMOTES` included),
`codec.js`, `protocol.js`, `host.js`, `guest.js`, `entities.js`, `coins.js`, `treats.js`,
`stickers.js`, `stickerbook.js`, `shops/panel.js`, `pets/preview.js`. The shops' daily gift is not
touched; the presents system only reads `game.coins.giftShowing` and `game.coins.shown`.

### 4.3 Changed files (tests, site, docs)

| File | Where | Change |
|---|---|---|
| `tools/test-saves.mjs` | `describe('mergeProfile (§7.4)')` `:465-492`; server profile tests | S1-S5 after the `lookPicked` test (§14.4). |
| `tools/test-net.mjs` | new `squishTests()` after `vehicleTests()` (`:1789`), run at `:2014` under `--only=unit` / `squish` | §14.2. |
| `tools/net/fake-adapter.mjs` | `local()` `:426-430` | `if (this.hi !== undefined) out.hi = this.hi;`, the way `vh` is done (ocean.md §12.3 expects this). |
| `tools/test-name.mjs` | its name scan | gains the trademark scan (§14.1 A13) through the shared scanner `tools/lib/name-scan.mjs` (the owner's forbidden names, plus squish's extra words: the toy-brand plural and the dropped "space" toy name, stored encoded) over text files only. |
| `tools/probe-multiplayer.mjs` | after `test('HELD', ...)` `:466` | new test `SQUISH` (§14.5). |
| `package.json` | scripts | `test:squish`, `probe:squish`. |
| `.github/workflows/test.yml` (repo root) | right after the **"Walkie-talkie"** step (`:83-84`) | a step "Squishy toys (data, merges)" running `npm run test:squish` (seconds). |
| `docs/DESIGN.md` | events `:258-284`; a new wave-4 section | the 3 events; a short section pointing here. **The integrator assigns the section number** (ocean.md §12.2 also adds a "new §7"). |
| `docs/MULTIPLAYER.md` | presence table `hi` row (§5.4, `:299-320`), §7 per-player list (`:670-675`) | `hi` may also be a `squish_*` / `squishg_*` key; the collection is per player, never in the host world. |
| `docs/DATA-MAP.md` | `player_profiles` row `:50` | "…stickers, coins, stats, settings, basket, squishy toy collection" (game data, not personal). |
| `docs/teams/shops.md` | "Sparkle Coins" | one line: the coin pill is now a button that opens the Squish Shelf; earned coins also fill up mystery presents. |

### 4.4 SHARED FILES (other teams may touch these in the same wave)

Builders edit only the lines listed above in these files and tell the integrator. Squish's hunks
are small and positional, so they rebase cleanly.

| File | Squish touches | Who else may touch it this wave |
|---|---|---|
| `src/main.js` | one import, one entry in `modules` | ocean (a new module), merfolk |
| `src/account/merge.js` | one line + import | none expected (sea forms live in `look`; ocean uses `stats`) |
| `src/core/storage.js` | `BACKUP_PROFILE_KEYS`, `mergeBackupProfile`, `profileStale` in `loadProfile` | none expected |
| `server/saves.mjs` | the `putProfile` squish guard | none expected |
| `src/account/legacy.js` | `profileHasPlay` | none |
| `src/ui/hud.js` | coin pill, `refreshRing` | merfolk (maybe a Dive button next to Up/Down, `:442-444`, `:484`) |
| `src/ui/inventory.js` | `TAB_COLORS` (+ maybe an `onTab` line) | ocean if they add a Bag tab |
| `src/ui/menus.js` | pause grid row | none expected |
| `src/things/pets/kit.js` | `PATHS`: `present`, `squish`, `shelf` | **ocean** (`PATHS.dolphin`, `seahop` button order 0) |
| `src/net/adapter.js` | `heldKey()` split into `treatHeld()` / `squishHeld()` | **ocean** (`local()` adds `sr`) |
| `src/net/remote-players.js` | `heldModel()` | **merfolk** (`_frame` swim flags `:458-473`), **ocean** (`seaRide`) |
| `tools/net/fake-adapter.mjs` | `hi` in `local()` | **ocean** (`sr`) |
| `src/player/wardrobe-data.js`, `src/net/codec.js` | **not touched** (`EMOTES` too) | merfolk (water-form lists, appended) |
| `src/player/avatar.js` | **not touched** | merfolk (tail, `poseSwim`) |
| `src/life/stickers.js`, `src/ui/stickerbook.js` | **not touched** (stickers are added on `game:ready` from our module) | sea teams add stickers the same way |
| `docs/DESIGN.md`, `docs/MULTIPLAYER.md` tables | rows appended; section number from the integrator | sea teams |
| `tools/test-net.mjs`, `tools/test-saves.mjs`, `tools/probe-multiplayer.mjs`, `tools/test-name.mjs` | a new block / test each, appended | sea teams |
| `.github/workflows/test.yml` | one step after Walkie-talkie | sea teams may add theirs |

---

## 5. UI and controls (iPad first)

### 5.1 The coin pill and the present ring

- The coin pill (top-left, next to the gems) becomes **tappable**. Tapping it opens the Squish
  Shelf. Minimum hit area 44 x 44 px (padding, no visual change except the ring).
- After the number sits the **present ring** (**28 px; 24 px on phones**): a little lilac mystery
  present inside a ring that fills up as coins are earned toward the next present. At **80% full
  it wiggles** once every 4 s. When a present is waiting, the whole ring turns bright and hops
  every 3 s. When everything is collected it shows a gold star and stops filling.
- **Progress never follows spending.** `progress(p, inFlight)` with
  `inFlight = max(0, p.coins - game.coins.shown)` (the coins still flying in):
  `e = earned(p) - inFlight`; `prev = milestone(p, opened(p))`, `next = milestone(p,
  opened(p) + 1)`; progress = clamp((e - prev) / (next - prev), 0, 1). `spend()` sets `shown` at
  once (`coins.js:116`), so spending in the candy shop never moves the ring; flying coins fill it
  as they land, together with the number.
- **A sparkle hops**: each time coins land in the pill (`coins:shown` going up), one small
  sparkle visibly hops from the number into the ring, so "coins fill the present" is shown, not
  told.
- On `navigator.webdriver` pages the ring's wiggle, hop and sparkle are off (it still shows its
  fill), unless `debug.squish.presents(true)` asks for them, so other teams' HUD-overlap checks
  (`probe-menus.mjs:24-45`, `probe-multiplayer.mjs:157-175`) see a still pill.

### 5.2 The present drop and the Present button

- When a new present becomes ready (`ready` rises) and the world is clear (§6.4), the present
  **pops out of the coin pill**, grows and floats to the top centre. It has **its own look**, not
  the daily gift's: a **taller lilac box** with a swirl ribbon and a big **"?" tag** (no yellow
  ring label), and its own words: big **"Mystery present!"** and under it **"Tap me!"**. It never
  says "A present for you!" (the daily gift's line, `coins.js:270`).
- Tapping it opens the **present** panel (§5.3). Unlike the daily gift it **never opens by
  itself**: after 7 s it shrinks and flies to the **Present** button, leaving a **sparkle trail**,
  and the button **bounces twice**, so the kid sees where it went.
- **Present** button: `lifeHud(game).add('present', { icon: 'present', label: 'Present', order:
  5, color: 'var(--sw-lav)' })`; after `add()` the module sets the face SVG and appends a count
  badge span when more than one waits (as `treats.js:294-297` sets its faces). It pulses
  (`lf-pulse`, `src/things/pets/kit.js:328-329`) and shows whenever `ready > 0` in play. Order 5
  puts it after Hop off / Lights and before Basket (10).
- Automated browsers (`navigator.webdriver`) get neither the drop nor the button unless a test asks
  (`debug.squish.presents(true)`), exactly like the daily gift (`coins.js:252-257`).

### 5.3 The unwrap (panel `'present'`)

- `ui.registerPanel('present', { title: 'Mystery Present', icon: <present>, width: 640,
  back: () => null })`. Opening pauses the world like every panel.
- **Stage:** the shared avatar stage through `preview(game)` (no new WebGL context). `show()` gets
  **one `Group`** holding the present, the toy (hidden until the reveal), the cushion, and an
  invisible `Kit.hitbox` the full height of the reveal (the toy's highest spring), so the camera
  framing is set once and the toy never leaves the frame. `spin: 0` while tapping (the group turns
  slowly by itself through `onFrame`); the preview's own drag-to-spin is ignored here. The stage
  host gets `touch-action: none; -webkit-touch-callout: none; user-select: none` so an iPad
  press-and-hold never brings up the callout or text selection.
- The present is `presentModel(n % 6)`: 6 pastel wraps on the lilac mystery box (dots, stripes,
  stars, hearts), chosen by the present's number, never by what is inside. It sits on a soft
  cushion whose color follows the device style: **lilac for Mix, sky for Boy, pink for Girl**.
- **Taps:** a tap is a `pointerdown` on the stage. **Input is ignored for 300 ms after the panel
  opens** (the ghost-tap guard, like C4), so the tap that opened it (on the drop or the Present
  button) never counts as tap 1. A tap that lands while a wiggle is still playing is **queued**
  and plays right after, never dropped (at most 2 queued). Space or Enter taps too.
- **First-ever present** (`opened(p) === 0`): a big bouncing **pointing finger** picture over the
  box until the first tap.
- **Tap 1:** the box squashes and wiggles, `shake` sound, a few sparkles. Text: "Tap the present!"
  becomes **"Again!"**.
- **Tap 2:** a bigger wiggle, the bow loosens, `rustle`. Text: **"One more!"**.
- **Tap 3 (the reveal):** the commit happens here (§6.5). The lid and bow fly off, golden rays spin
  behind (copied rays, `fx.js`), DOM confetti (copied burst, `fx.js`), `unwrap` sound, then
  `tada`. The toy springs up out of the box, squashes as it lands, slowly rises (a Puffum) or
  wobbles (a Stretchum), and spins.
- **Name banner** (the sticker pop label style, `stickers.js:42-46`): small **"NEW!"** / big
  **"Strawberry Puffum!"**. Under it one line about the kind the first time each kind comes:
  "A Puffum! Press it and it puffs back up." / "A Stretchum! Squeeze it and stretch it!". Read
  Aloud speaks the name (`game.speak`, `src/ui/settings.js:99-117`).
- **Glitter round** (§6.6): after the POP the box shows a row of the kid's own toys that are not
  sparkly yet, with **"Pick a toy to make sparkly!"**. The tapped toy flies into the box, sparkles
  burst, and it comes out with glitter: small **"Now it sparkles!"** / big "{name}!" with the gold
  star badge. No "NEW!".
- **Buttons** (big, picture + word): **Squish it!** (press-and-hold on the stage toy too),
  **Hold it** (closes the panel, puts it in the hand, §5.5), **Squish Shelf** (switches to the
  Squish Shelf, opened on this toy), and **Next present!** with the count when another waits.
  The panel's Close works at every step.
- **Closing before tap 3** (or before picking, in the Glitter round) changes nothing: the present
  stays ready.
- If the stage cannot draw (`preview.failed`), the box and the toy are the 96 px thumbnails with
  the same CSS squash and pop.

### 5.4 The Squish Shelf (panel `'squish'`, action `'squish'`)

- `ui.registerPanel('squish', { title: 'Squish Shelf', width: 1000 })`,
  `game.registerAction('squish', (g) => g.ui.toggle('squish'))`.
- **The present path (top of the shelf).** Left to right: the **next present**, big (the lilac
  mystery box picture), with a fat **fill bar** under it that fills as coins are earned; then
  **two greyed presents** after it, smaller, with a dotted path between. The words under the bar
  are a coin picture and **"40 to go!"**. Never "{n} more coins", never a coin number on the box
  itself (it must not read like a price). When the bar is full, its **ribbon pops off** and the
  box hops, with "**Ready!**" and a big **Open it!** button (opens `'present'`).
- **First time the shelf opens** (device flag `squishPathTip`): a one-time picture card over the
  path: a coin, an arrow, a present, and **"Play to fill it up!"** / **"Spending candy coins is
  OK."**, with an OK button.
- **Counter:** **"12 of 48"** with the sticker-book bar style (`stickerbook.js:16-21`). After the
  48 toys a second counter appears next to it: a sparkle picture and **"Glitter 5 of 48"**, and
  the path says "Next: make a toy sparkly!". After all 96: **"You found every toy! You are a Squish
  Champion!"** with a crown and no path.
- **Tabs** (picture + word): **All**, **Puffums**, **Stretchums**.
- **The shelf:** wooden shelves (CSS: warm wood planks with a shadow) with cubbies, 6 per row on
  iPad, 4 on phones, scrolling down. Each cubby shows the toy's 96 px thumbnail. A toy not yet
  owned shows its thumbnail as a soft lavender **silhouette** (`filter: brightness(0)
  opacity(.22)`) with a round **"?" badge and no word** (`aria-label` "Still a mystery"). Owned
  toys show their name; new ones a "NEW!" tag. An owned glitter version adds a gold star corner;
  tapping the star switches the cubby between the two.
- **NEW! tags** clear only when that cubby is tapped, or when the shelf is closed after being open
  for at least 2 s (then every NEW! that was on screen is cleared). A quick open and close keeps
  them.
- **Tap an owned toy:** a detail card over the shelf with the toy big on the shared stage
  (`preview.show(toyModel(...), { spin: 0 })`), the stage host with the same no-callout CSS as
  §5.3. **Any press without a drag does something** (§7.2):
  - **Puffum:** squashes on `pointerdown`, **stays flat while held** (no time limit), and slowly
    rises on release.
  - **Stretchum:** squeezes on press, **stretches** when held past 300 ms (up to 1.6x, growing
    while held), and wobbles back on release.
  - A drag of more than 8 px spins the toy instead (and lets a squashed Puffum rise).
  - A little **hand picture** pressing down shows under the toy, with "Press it!" (Puffum) or
    "Press and hold!" (Stretchum).
  Buttons: **Hold it**, **Glitter** (only when owned; toggles the version shown), Back.
- Thumbnails are requested with normal priority when the shelf opens (48 at most, plus owned
  glitter ones); a cubby shows a soft placeholder until its picture lands.

### 5.5 Holding a toy

- Owned toys are in the Bag tab **Squish Toys** (right after Fun & Toys). At the top of the tab is
  a **Squish Shelf** button (picture + word). Choosing a toy puts it in a hotbar slot as usual
  (which selects Build, `game.js:962`). **While the selected slot is a toy, the avatar holds it**
  in the right hand (the treats' rule, `treats.js:163-194`); with Build, a tap places it (any
  number, it is free), like any furniture.
- **Hold it** (shelf or unwrap) does what `treats.hold` does (`treats.js:197-211`): it puts the toy
  in the slot that already has it, or an empty one, or the current one, selects it, and **then
  switches to the Hand tool** (`game.setTool('hand')`), so a kid showing off a toy who taps around
  the world squishes things instead of planting copies. Toast: "You're holding the Strawberry
  Puffum! Press Squish!".
- **The first time a toy is placed** (device flag `squishPlaceTip`): toast "You put it down! It's
  still in your Bag."
- Life-HUD while holding: **Squish!** (`icon: 'squish'`, order 32, pink) with the same
  **press-and-hold** behavior as the shelf (pointerdown squashes / squeezes, hold stays flat /
  stretches, release rises / wobbles), and **Put away** (`icon: 'shelf'`, order 33, lavender;
  treats' Put away keeps its basket picture): clears that hotbar slot; toast **"All put away!"**.
- The held toy hides while sleeping or swimming (the avatar already does this) and while eating a
  treat (the treat takes the hand).

### 5.6 Toys in the world

- A placed toy stands on a table, shelf top or the floor, about **0.5 blocks** tall (Puffums) or
  **0.4** (Stretchums), centred in its cell.
- Every toy model gets `k.hitbox(0.1, 0, 0.1, 0.9, 0.7, 0.9)`, so the Hand-tool target is almost
  the whole cell, not the toy's tight shape.
- **Hand tap:** the `squish` action plays the whole squash and rise. Puffum: squash to 45% height
  in 0.12 s, then rise slowly back over 2.2 s with an ease-out, `squish` then a soft `rise` sound,
  3 hearts. Stretchum: squeeze to 60% in 0.1 s, then stretch up to 140% and wobble back over
  1.2 s, `squish` then `stretch` and a `snap` at the end, a few sparkles. Hint: "Tap to squish!".
- Remove, Undo, careful-friends rules and saving are the normal furniture ones.

### 5.7 Finding the shelf

- **Once, after the first present closes** (device flag `squishPillTip`): a bouncing pointing hand
  over the coin pill with **"Your toys live here!"**, gone on the next tap anywhere or after 6 s.
- The pause menu's row grid gets a **Squish Shelf** button (`menus.js:886-889`).
- The Bag's Squish Toys tab has a **Squish Shelf** button at its top (§5.5).
- The title screen gets a **Squish Shelf** tile **if** the 5-tile layout passes the `sw-four`
  check at 420 px (`menus.js:397`, C5); otherwise it stays in play only (Q5).

### 5.8 Stickers (registered on `game:ready`, after the other teams' stickers)

| id | name | hint | awarded when | art (100 x 100 canvas) |
|---|---|---|---|---|
| `squish_first` | First Present! | Open a mystery present | the first present is opened | an open lilac mystery present with a Puffum popping out, stars |
| `squish_ten` | Squish Collector | Collect 10 squishy toys | `got` has 10 known keys | three toys on a little shelf |
| `squish_all` | Squish Champion | Collect every Puffum and Stretchum | `got` has every `ITEMS` key | a crown over a heart-shaped Stretchum |
| `squish_squeeze` | Squeeze Me! | Squish a toy 25 times | `stats.squishes >= 25` | a blob squashed flat with motion lines |

Each pays +20 coins through the normal sticker path (`coins.js:228-231`). Four stickers are added
to whatever the book has; probes read `game.stickers.total()` live (32 today; the sea teams add
theirs too). Awards are checked in `refresh()` (§6.7), so a profile merged from another device
catches up during play; each award is guarded by `remoteApplying`.

---

## 6. Behavior: presents

### 6.1 The milestone rule

Present `n` (counting from 1) is reached when `earned(p) >= milestone(p, n)`, which is
`base.coins + T(n)` (§3.2; §6.6 for after a full collection). Ready = reached minus opened. Coins
earned anywhere (gems, stickers, cooking, harvest, pets, the daily gift) count. Spending in the
candy shop never lowers `earned`, so nothing is ever taken back. Opening never changes `coins` or
`coinsEarned`.

How long it takes, for two kinds of play (computed with node from `T(n)`; early days are faster
for both, because the one-time stickers pay 20 each):

| presents | earned coins | **explores new worlds** (about 125 a day: gems, gift, stickers) | **builds in one world** (about 50 a day: gift, pets, harvest, cooking) |
|---|---|---|---|
| 1 | 50 | the first session | the first day |
| 3 | 180 | day 2 | day 3 or 4 |
| 10 | 850 | about 1 week | about 2.5 weeks |
| 24 | 2,250 | about 2.5 weeks | about 6 weeks |
| 48 (every toy) | 4,650 | about 5 weeks | about 3 months |
| 96 (every toy sparkly) | 9,450 | about 11 weeks | about 6 months |

Once the gap reaches 100 (present 6), a builder gets a present about **every 2 days** and an
explorer almost **every day**. The game does not reward farming throwaway worlds much: an
explorer is only about 2.5 times faster, and both always see the ring move during a session.
If the dad wants it faster for builders, see R1 and Q3.

### 6.2 The milestone start (`base`) and players who already earned coins

The base is created **lazily**: on the first `world:load` in play mode, after `await
game.store.reconciled`, if `profile.squish` is missing or has no valid `base`. Nothing is created
or saved on `game:ready` (the title screen), so starting the game never bumps `updatedAt` and
never makes `onCloudReady` skip a newer cloud copy (`game.js:283-289`).

```js
base = { coins: Math.max(0, earned(p) - T(WELCOME)), at: nowIso }   // WELCOME = 3
if (game.store.profileStale) base.prov = 1   // the cloud read failed: this profile may be old
```

then `game.saveProfile()`.

- New player (earned 0): base 0, the first present at 50 earned coins.
- Earned 60 (the old-world fixture): base 0, **1** present ready now.
- Earned 120: base 0, **2** ready (50 and 110).
- Earned 180 or more: base = earned - 180, so exactly **3** welcome presents are ready, and the
  4th comes after 80 more coins (the normal T(4) - T(3) gap).

**Provisional bases.** A device that is offline (or whose cloud read timed out) may hold a
days-old local profile with a small `earned`. Its base is marked `prov: 1`. The merge rule
(§9.2): **a real base beats a provisional one**; between two real bases the earliest `at` wins;
between two provisional bases the one with **larger `coins`** wins. So a stale offline start can
never become the base once a real one exists, and never makes 14 presents appear when the real
`coinsEarned` arrives.

**Promotion.** In a later session where `profileStale` is false and the merged profile's base is
still provisional (no device ever made a real one), `refresh()` makes it real, capped so it can
never flood: `base = { coins: max(base.coins, earned(p) - T(opened(p) + WELCOME)), at: base.at }`
(no `prov`). At most `WELCOME` presents are then ready.

### 6.3 What is inside (no duplicates, no gambling)

```
nextItem(p, style):
  letter = style === 'girl' ? 'g' : style === 'boy' ? 'b' : null   // device only: game.surpriseStyle()
  round 1 (toys), while some ITEMS key is not in got:
    missing = PRESENT_ORDER keys not in got
    no letter (Mix): the first missing key
    with a letter:   own = missing with tag === letter; shared = missing with tag === 'gb'
                     k = number of ITEMS keys in got
                     k even: the first of own, else the first of shared
                     k odd:  the first of shared, else the first of own
                     if both are empty: the first missing key (the other side's toys)
    -> { key, glitter: false, pick: false }
  round 2 (Glitter, every ITEMS key in got): -> { key: the first PRESENT_ORDER key not in glit,
           glitter: true, pick: true }   // the kid picks; key is only the default (§6.6)
  null when both rounds are complete
```

- This is the Studio's rule (boys.md: "the side's own first, then shared"), turned into an
  alternation so each side's own toys come early and the shared ones are not starved. With Boy
  picked, the first present is the **Dino Puffum**; with Girl, the **Unicorn Puffum**. The first 8
  for each style are in §3.1 and pinned in A7.
- The style only **orders**; it never hides anything, and it is read on this device only.
  Nothing about it is stored.
- No weights, no odds, no "rare", no "try again", no duplicates.

### 6.4 When the drop may show

Every frame the `squish-presents` system does one comparison and returns unless a drop is wanted.
A drop is wanted when `ready` went up since the last drop (event `present:ready`). It shows when
all of these hold for 1.5 s:

- `game.mode === 'play'`, the world is loaded, the page is visible;
- the copied `blocked()` rules (`fx.js`, from `coins.js:247-250`): no panel, dialog, photo mode,
  fade, sticker pop or tutorial tip;
- the daily gift is not showing (`game.coins.giftShowing`) and no coins are flying
  (`game.coins.shown === game.coins.value`), so the gift's coins land first and may themselves
  reach a milestone; the mystery present then comes **after** the gift is fully gone, with its
  own look and words (§5.2), so the two are never confused;
- the tutorial is done or 90 s were played (the gift's rule, `coins.js:322-324`);
- not a webdriver page (unless asked).

At most one drop per 3 minutes. The Present button shows whenever `ready > 0` regardless.

### 6.5 Opening (the commit)

At tap 3 in the present panel (or at the pick, in the Glitter round), in this order:

1. `const item = nextItem(game.profile, style)`; if null, close (nothing to open).
2. `game.profile.squish.got[key] = now` (or `glit[pickedKey] = now`); `await
   game.saveProfile(true)` (the immediate save, not the 400 ms debounce, `game.js:548-557`).
3. `refresh()` (§6.7): unhides the Bag item(s) (`furn:squish_<key>` / `furn:squishg_<key>`, plus
   `furn:toy_shelf` with the first toy), recounts `ready` and the ring, checks stickers.
4. Emit `'squish:get' { key, glitter, n: opened(p) }`.
5. Show the reveal.

A reload or crash after step 2 keeps the toy (the reveal is just not seen; the shelf shows it as
NEW). A reload before tap 3 keeps the present ready. E4 reloads within 100 ms of tap 3.

### 6.6 The Glitter round and after everything is collected

- After 48 toys, each present makes one owned toy sparkly. **The kid picks which** (§5.3); it is a
  choice, not a chance, and stays deterministic (debug and tests take the default, the first in
  `PRESENT_ORDER` without glitter). The shelf shows "Glitter {n} of 48".
- After 96 there are no more presents: the ring shows a gold star, the shelf shows the champion
  line, the Present button never shows.
- **`rest`.** While every present is opened, `refresh()` keeps `squish.rest = { n: opened(p),
  coins: earned(p) }` up to date (so `rest.coins` tracks what the kid earns while complete). For
  `n > rest.n`, `milestone(p, n) = rest.coins + gap(rest.n + 1) + ... + gap(n)`; for `n <= rest.n`
  it is the normal `base.coins + T(n)`. Merge: the `rest` with the larger `n` wins; with equal `n`
  the larger `coins` (§9.2).
- When a later build **appends** new toys, `presentsTotal()` grows, and the first new present
  comes one normal gap (100 coins) after the kid's earned total at the time they were last
  complete, not all at once. New toys are appended to `ITEMS` and `PRESENT_ORDER`; `nextItem`
  round 1 covers every key not in `got`, so new toys come before the remaining glitter picks.

### 6.7 One `refresh()` for everything derived

Every derived value lives in one `refresh()`: the `hidden` flag of all 97 Bag items, `ready`, the
`present:ready` event, the ring (`squish:refresh` event for `hud.js`), the Present button, `rest`,
base promotion, and the sticker checks. It reads `game.profile.squish` fresh every time. It runs
on `game:ready`, `profile:changed`, `coins:change`, `coins:shown`, `squish:get`, when the Bag or
the shelf opens, and on a **1 s timer** that compares a cheap signature (`|got| + |glit|`,
`earned(p)`, `base.at`) and calls `refresh()` only when it changed. That catches a 409 merge
during play, which replaces `profile.squish` without any event (§2): toys opened on another
device show in the Squish Toys tab within about a second (probe step E6). Profile-changing parts
are skipped when `game.net.remoteApplying`.

---

## 7. Models, animation and sound

### 7.1 Model recipes (`models.js`)

- **Idle toys batch like furniture.** `build(color, data, entity)` puts the toy's meshes
  **directly under the model** (marked `userData.batch`) when the toy is idle, so the
  `StaticBatcher` bakes them into the square's batch: **0 extra draw calls**. When a Hand squish
  starts, the action sets `entity._squishing = true` and calls `entities.refresh(entity)`;
  `build()` then puts the meshes into one part **`toy`** (origin at the toy's bottom centre, so
  scaling it squashes it onto the table) for the animation, about 2.3 s; when the curve ends,
  `update()` clears the flag and refreshes again. Shelf, unwrap and held toys are always built
  with the `toy` part (`live: true`).
- Everything opaque is plain colors, `fluffyMat` (fuzzy kinds) or `glow` (Glow Moon), all on the
  **atlas material**.
- See-through kinds (`glitter`, `jelly`, `jellycube`; 6 of the 48): an inner atlas part (flecks:
  tiny boxes with `glow(color, 0.6)`; bubbles; the plain orange fish) plus an outer shell with
  `sheer(main, 0.55)`. The inner part batches when idle; the transparent shell never does
  (1 draw call each).
- Faces are `pixels()` (2 dots for eyes with a white shine pixel, a 3-pixel closed smile, pink
  cheek boxes), the Teddy Bear's method (`models-garden.js:413-420`). No teeth anywhere.
- **Glitter versions:** the same recipe plus 10-14 tiny `glow('#FFF6C8', 0.8)` star flecks on the
  surface and a gold rim on the base. Still batched when idle for opaque kinds.
- **Sizes** in block units: Puffums **0.46-0.54** tall and up to 0.5 wide; Stretchums
  **0.36-0.42**. (The Teddy Bear is about 0.65.) The probe checks that a placed toy is at least
  44 px tall on screen at the default camera on a 1024 px iPad (W3).
- `heldToy(key, glitter)`: the same model, scaled **0.85**, rotated to face forward, raised so the
  bottom sits in the palm (the treat model's way, `treats.js:137-151`; a treat is 0.9).
- **Geometry sharing.** `Kit.build` makes new buffers on every build (§2). Held, shelf, unwrap and
  remote-held toys build one geometry per `key + glitter` into a small cache in `models.js`,
  marked `userData.shared` so `disposeObject` leaves it; the cache is cleared when the world is
  unloaded. Placed idle toys are baked into batches anyway.
- `presentModel(i)`: the lilac mystery box, 0.5 x 0.62 x 0.5 blocks (taller than wide), one of 6
  wraps, a swirl ribbon, a 4-loop bow part, a "?" tag, and a `lid` part that can fly off.
- `toyShelf(color)`: a low 2-wide shelf, two inner decorative boards, heart cut-out pixels on the
  sides **only in the pink color**; static (batched).

### 7.2 Animation curves (`anim.js`, pure)

`pressCurve(kind, phase, t, from)` returns `{ sx, sy }` for the part scale (`sx = 1/sqrt(sy)`,
keeping volume). `phase` is `'tap'`, `'down'` (held) or `'up'` (released); `from` is the `sy` at
the moment of release.

- `puff`, `tap`: 0-0.12 s squash to `sy` 0.45; 0.12-2.3 s rise with `1 - (1-u)^3`; done.
- `puff`, `down`: squash to 0.45 in 0.12 s and **stay there** for as long as it is held.
- `puff`, `up`: rise from `from` to 1 over 2.2 s with the same ease-out.
- `stretch`, `tap`: 0-0.1 s squeeze to 0.6; 0.1-0.45 s stretch to 1.4; then a damped wobble
  `1 + 0.4 e^{-5u} cos(14u)` back to 1 by 1.3 s.
- `stretch`, `down`: squeeze to 0.75 in 0.1 s; after 300 ms held, `sy` eases toward 1.6 while held.
- `stretch`, `up`: the damped wobble from `from` back to 1.

World toys use `def.update(entity, dt)` (`entities.js:831-840`) and return at once when not
animating (the teddy's pattern, `life.js:737-745`). The held toy and the stage toys are animated
by the squish module's own system and the preview's `onFrame`.

### 7.3 Particles

`game.particles.emit('heart', ...)` (3) on a Puffum squish, `'sparkle'` (5) on a Stretchum, the
toy's main color. The reveal's confetti and rays are DOM (the panel covers the world).
Visual randomness (confetti, sparkle spread) uses `mulberry32` seeded per burst.

### 7.4 Sounds (`sfx.js`, synthesized like `src/things/pets/sfx.js`)

| name | sound |
|---|---|
| `squish` | low-pass hiss 900 -> 250 Hz, 0.18 s, plus a soft sine 260 -> 180 Hz (based on furniture `fluff`, `src/things/furniture/sfx.js:135-138`) |
| `rise` | very soft sine glide 200 -> 340 Hz over 1.6 s, volume 0.04 |
| `stretch` | triangle glide 220 -> 520 Hz, 0.35 s, with a faint hiss |
| `snap` | the life `boing` at pitch 1.3 |
| `shake` | two quick muffled taps (a filtered noise burst each) |
| `rustle` | band-pass hiss 2-4 kHz, 0.25 s (paper) |
| `unwrap` | `rustle`, then the shops' `gift` arpeggio (`src/things/shops/sfx.js` `case 'gift'`) |

Noise buffers are filled with `mulberry32` (not `Math.random`). All go through the sfx gain, so
the Sound slider and mute work.

---

## 8. Every player-facing string

### 8.1 Names

- **Puffum / Puffums**, **Stretchum / Stretchums**, **Squish Shelf** (the panel and every button
  that opens it), **Squish Toys** (Bag tab only), **Toy Shelf** (the furniture piece only),
  **Mystery Present**.
- Name checks (web search on 2026-10-04): "Squishies" is a registered trademark, and "Squishkins",
  "Smooshums", "Squeezamals", "Mooshies", "Globbles", "Squish'Ums", and in the "Puff-" plush space
  "Puffkins" (Swibco) and "Puffalumps" (Fisher-Price) are other companies' toy names, so none of
  them is used. No toy product named "Puffums" or "Stretchums" turned up. A trademark search by a
  grown-up before launch is still suggested (Q1).
- **Dropped on purpose:**
  - **"Space Buddy"** (the old `st_alien`): too close to the title of another company's film and
    its merchandise, and a green three-eyed blob with one ball-tipped antenna looks like a famous
    film's toy alien. It is now the **Zoom Blob**: teal, two eyes, two bendy antennae tipped with
    stars. "space bud" is in the trademark scan (A13).
  - **"Honey Cub"**: a tan-and-yellow cub hugging a honey pot reads as a famous storybook bear
    owned by another company. It is now the **Cuddle Cub**: cocoa brown, hugging a red heart, a
    bow on one ear. **No bear in the game ever carries a honey pot.**
  - The Ocean Jelly's fish are **plain orange, no white stripes**, so they do not look like a
    famous film's clownfish. The Shark has no teeth.
  - The Mermaid Tail and Sea Dragon use the **merfolk team's own designs** (a round two-lobed fin;
    a three-tip fin with soft spikes and frills), not any film's.
- The owner's forbidden names never appear in shipped text (A13, in `tools/test-name.mjs`,
  through the shared scanner `tools/lib/name-scan.mjs`, which stores them encoded). The old
  wording of `docs/DESIGN.md:5` named another company's game; the integrator reworded it in
  step 0 (Q6), so no other company's name is in the repo at all.

### 8.2 Strings (exported as `STRINGS` from `data.js`; B10 also reads the rendered DOM)

| where | text |
|---|---|
| present drop | big "Mystery present!", small "Tap me!" (never the daily gift's "A present for you!") |
| life HUD | "Present", "Squish!", "Put away" |
| present panel title | "Mystery Present" |
| unwrap steps | "Tap the present!", "Again!", "One more!" |
| reveal | "NEW!", "{name}!", "A Puffum! Press it and it puffs back up.", "A Stretchum! Squeeze it and stretch it!" |
| glitter round | "Pick a toy to make sparkly!", "Now it sparkles!" |
| reveal buttons | "Squish it!", "Hold it", "Squish Shelf", "Next present!" (with "×2" when 2 more wait) |
| shelf title | "Squish Shelf" |
| present path | "{n} to go!" (with a coin picture), "Ready!", "Open it!", "Next: make a toy sparkly!" |
| path tip card | "Play to fill it up!", "Spending candy coins is OK.", "OK" |
| counters | "{n} of {total}", "Glitter {n} of {total}" |
| complete | "You found every toy! You are a Squish Champion!" |
| tabs | "All", "Puffums", "Stretchums" |
| cubby | no word for a mystery (a "?" badge; aria-label "Still a mystery"), "NEW!" |
| detail | "Press it!", "Press and hold!", "Hold it", "Glitter", "Back" |
| world hints | "Tap to squish!" |
| toasts | "You're holding the {name}! Press Squish!", "All put away!", "You put it down! It's still in your Bag." (once per device), "Your new toy is in your Bag too!" (once per device, `deviceSet('squishBagTip', 1)`) |
| pill tip | "Your toys live here!" (once per device) |
| pause menu, Bag tab button | "Squish Shelf" |
| coin pill aria-label | "Sparkle Coins: {n}. Open the Squish Shelf" |
| stickers | §5.8 |

No string contains "buy", "price", "cost", "rare", "chance", "her", "she", or a currency sign,
and no string puts a coin number next to the word "present" (A13 on `STRINGS`, B10 on the DOM).

---

## 9. Saves and old-save safety

### 9.1 What old saves and old tabs do

- An old profile (no `squish`, maybe no `coinsEarned`) loads exactly as before. In play, the
  first world load adds `squish` with the base rule (§6.2) and saves. Its look, coins, stickers
  and stats are not touched.
- Old worlds have no `squish_*` entities; nothing changes. A world with toys opened by an older
  cached page loses those toys from that world on its next save (`entities.js:898-900`). Friends
  share the build id, so this only happens with an old open tab; the toys are still in the profile
  and can be placed again (R3).
- **An old-build tab still open** (iPad Safari restores tabs) merges a 409 with the **old**
  `mergeProfile`, which takes the newer copy whole and uploads a profile with no `squish`. The
  server guard (§4.2) keeps the stored `squish` when an incoming profile has none, so the cloud
  copy never loses the toys. The old tab's own IndexedDB copy may lack them until a new-build tab
  loads; the new merge then unions them back from the cloud (S5).

### 9.2 Merges (`mergeSquish(a, b)`, in `src/core/squish-merge.js`)

```js
mergeSquish(a, b):
  if neither is an object -> undefined (the key stays absent)
  if only one is an object -> that one, unchanged (deep-equal; no re-normalizing)
  out = { ...other keys of the side with more opened, v: max(a.v, b.v, 1) }
  out.got  = union(a.got,  b.got)    // earliest date per key (the stickers' rule, merge.js:24-28)
  out.glit = union(a.glit, b.glit)
  out.seen = union(a.seen, b.seen)   // values 1
  out.base = pickBase(a.base, b.base)
     // valid = coins finite >= 0 and `at` parses; an invalid base loses to a valid one
     // real (no prov) beats provisional; two real: earliest `at`; two provisional: larger coins
     // (ties: earliest `at`, then larger coins, so the result does not depend on the order)
  out.rest = the valid rest with the larger n; equal n: the larger coins; none valid: absent
```

- **No toy is ever lost**: both sides' toys are always kept.
- `mergeSquish(a, undefined)` deep-equals `a`, so restoring a backup file without `squish` changes
  nothing and reports "not changed" (A9, A11).
- If two devices each opened a present offline, the union may hold one toy more than the
  milestones reached: `ready()` clamps at 0, and the next present simply comes one milestone later.
  Nothing is taken away.
- Inputs that are not objects (arrays, strings, null) are treated as empty and never throw.
- `stats.squishes` is max-merged with every other stat (`merge.js:49`, `storage.js:131-143`).

### 9.3 Backups and first sign-in

`'squish'` joins `BACKUP_PROFILE_KEYS`, so "Save a copy" files and the legacy first sign-in import
(`src/account/legacy.js:112`) carry the collection, and `mergeBackupProfile` joins it with
`mergeSquish` **only when the file has a `squish` object** (fresh device or not). `profileHasPlay`
counts a profile with a toy as "has play".

### 9.4 Privacy (COPPA)

No new personal data. `profile.squish` is item keys, dates and coin counts. The Girl / Boy pick is
only read from the device to order presents and pick the cushion color, and is never written. The
device flags (`squishPathTip`, `squishPillTip`, `squishPlaceTip`, `squishBagTip`) go through
`store.deviceSet`. `docs/DATA-MAP.md` gets the wording change in §4.3.

---

## 10. Multiplayer

- **Per player.** Presents, the collection and stickers live in each player's own profile and never
  enter the host world (`docs/MULTIPLAYER.md:670`). Opening a present while visiting a friend works
  the same and changes nothing for the friend.
- **Guards.** Every listener that changes the profile starts with
  `if (game.net && game.net.remoteApplying) return;` (§9.11, `MULTIPLAYER.md:1058-1067`): the
  profile-writing parts of `refresh()`, sticker checks, and the squeeze counter for world toys (a
  squeeze only counts when it is this player's own Hand tap).
- **Held toy.** `adapter.heldKey()` sends the def key as `hi` (through `squishHeld()`, §4.2);
  friends' pages draw it with `game.squish.model(key)` in `heldModel`. An unknown or garbage key
  draws nothing. The squeeze animation is local only in v1 (friends see the toy, not the squash;
  §12 has the optional presence counter).
- **Placed toys** are ordinary furniture: a guest's placement is an `e+` with key `squish_*` /
  `squishg_*` and empty data, validated like any furniture (`host.js:506`, key registered, build
  rules). The careful-friends rules apply. Hand taps rebuild the entity locally for the animation
  (§7.1) but change no entity data, so they never send a journal or ops message.
- **A guest places a toy they own in a host's world:** it stays in that world (the world's owner
  keeps it as decor), and the guest still has it in their own Bag (toys are unlimited, nothing is
  given away). This is the same as placing any furniture.
- No protocol, presence size, codec or server-relay change. Presence `hi` is at most 28
  characters (presence stays far under `STATE_BYTES` 3,900, `protocol.js:26`).

What changes in MULTIPLAYER.md: the `hi` row says "a treat key, a food key or a squishy toy def key
(`squish_*`, `squishg_*`)", and §7's per-player list gains "the squishy toy collection and mystery
presents".

---

## 11. Performance, safety and cost budget

| what | cost |
|---|---|
| placed idle toy, opaque kinds (42 of 48, and their glitter versions) | **0** extra draw calls: baked into the square's static batch like furniture (§7.1) |
| placed idle toy, see-through kinds (6 of 48) | 1 draw call each (the transparent shell; the inside is batched) |
| a toy being squished | +1 draw call for about 2.3 s, plus two `entities.refresh` rebuilds (one at the start, one at the end) and the square's batch rebuild, as when any furniture piece changes |
| Toy Shelf | 0 extra (static, batched) |
| held toy (local or a friend's) | 1-2 draw calls; geometry shared per key (§7.1) |
| idle per frame | one number comparison in `squish-presents`; world toys' `update` returns at once unless animating; the 1 s signature check in `refresh()` |
| animating toy | a scale write per frame, no allocation |
| shelf panel | shared stage (no new WebGL context); up to 48 thumbnails through the queued thumbs renderer (96 px each, about 1.7 MB of PNG data URLs at most, cached) |
| unwrap panel | shared stage, one group (present, toy, cushion), disposed on close |
| saves | each Hand squish emits `entity:use`, a "save soon" event, so squeezing toys schedules a world save every few seconds, the same as hugging the Teddy Bear today. Accepted: the save is debounced and small. |
| profile | at most about 8 KB |
| bundle | about 35-45 KB minified (data table, shape recipes, panels, CSS) |
| geometry | each placed toy builds its own buffers (Kit merges per build, about 1.5-3k vertices); they are baked into the batch while idle. Held, shelf and unwrap toys share one geometry per `key + glitter`. |

Budgets checked by the probe (§14.3 F): **60 placed idle toys** (48 opaque, 12 see-through) add at
most **14** draw calls; squishing one adds at most 1 more and returns to the idle count within 3 s;
holding a toy adds at most **2**; the systems stage with 60 placed idle toys averages at most idle
**+0.3 ms** over 120 frames; no frame over 1 s while the shelf fills its thumbnails; no geometry
growth after opening and closing the shelf 10 times (counted under the preview pivot, not the
whole renderer, see the boys B8 flake, `tools/probe-boys.mjs:551-559`).

Nothing is lowered: same pixel ratio, same shadows, same particle counts.

Safety: every number from a profile is checked (`Number.isFinite`, `>= 0`) before use; unknown
item keys in a profile are kept but never built; a model recipe that throws is caught and the
toy is drawn as a plain ball in its main color (never an error on screen, one `console.warn`).

---

## 12. Optional extras (only if time allows, in this order)

1. **Wish star.** On the shelf, a small star button on a mystery silhouette: "Wish for this one!".
   The wished toy becomes the next present (round 1 only), overriding the order once. Stored as
   `squish.wish = { key, at }` (merge: the later `at` wins; cleared when that toy is opened). It is
   a choice, not a chance; nothing else changes. A kid who wants the Unicorn is not stuck waiting
   13 presents.
2. **Friends see the squeeze:** a tiny optional presence counter `hs` (0-9, wrapping) next to `hi`,
   bumped on each squeeze of the held toy; one line in `adapter.local()` and `host.js`
   `avatarFields`, and friends' pages play the squash on the held model when it changes.
   `EMOTES` stays as it is (no wheel button, no number key, no avatar pose).
3. **NPC friends react:** a friend within 6 blocks says "So squishy!" or "Can I squish it?" when
   the player squeezes a held toy (pals' chat hooks).
4. **Shelf in the world:** a Toy Shelf Hand action "Fill it with my toys" that places up to 4
   owned toys on its top.

---

## 13. Coordination with the sea teams

- **Toys tied to the sea features** (ocean.md:1053 leaves "a dolphin squishy, a starfish squishy"
  to this team): the **Dolphin Puffum** (2nd present on Mix, 4th on Girl and Boy, in ocean's `sky`
  dolphin colors), the **Starfish Squeeze** and **Seashell Squeeze** (presents 6-8), and one toy for
  each merfolk form: the **Mermaid Tail** (5th on Girl) and the **Sea Dragon Puffum** (3rd on Boy),
  using merfolk's own names and fin shapes. They are our own models; ocean's instanced geometry is
  not reused (ocean.md:1053-1054).
- **The shark.** Ocean's rule is "no sharks, nothing that bites" for animals in the sea. The Shark
  Puffum is a toy, not a sea animal, and now has a closed smile and blush with no teeth. The dad
  decides at the grid review (Q7); if he says no, `pf_shark` is replaced **before** `ITEMS_V1` is
  pinned by a **Narwhal Puffum** (`pf_narwhal`, tag `b`, same order slot).
- A held toy hides while swimming (`avatar.js:915`) and, in sea form, while leaping (merfolk §6.3),
  so the tail needs nothing from us. Merfolk owns `remote-players.js` `_frame`; we only touch
  `heldModel` (§4.4).
- Both sea teams and squish add life-HUD buttons and `PATHS` icons in `pets/kit.js`: ocean adds
  `dolphin` and `seahop` (order 0, only while riding); squish adds `present` (order 5), `squish`
  (32) and `shelf` (33). No order clashes.
- Both teams append stickers on `game:ready`; the book handles any count, and probes read
  `game.stickers.total()` live. The integrator sets the registration order.
- `tools/net/fake-adapter.mjs`: squish adds `hi` to `local()` the way `vh` is done; ocean adds
  `sr` next to it (ocean.md §12.3).
- The sea teams own `wardrobe-data.js` and `codec.js` changes; squish changes neither (not even
  `EMOTES`).
- `docs/DESIGN.md`: both teams add a wave-4 section; **the integrator assigns the numbers**.

---

## 14. Tests

### 14.1 `tools/test-squish.mjs` (Node, seconds; imports `src/things/squish/data.js`, `src/core/squish-merge.js`, `src/account/merge.js`, `src/core/storage.js` pure helpers, `src/net/protocol.js`)

- **A1** `ITEMS`: 48 entries, unique keys matching `/^(pf|st)_[a-z]+(_[a-z]+)*$/`, at most 20
  characters, **none ending in `_g`**, 24 of each kind, names 1-20 characters, unique names (the
  glitter version shows the same name plus a badge, so no glitter name is longer than 20), tags in
  `g|b|gb` with at least 10 `b` and 10 `g`, three valid `#rrggbb` colors, `shape` known to the
  recipe list (`models.js` exports `SHAPES` names; checked by a static scan). The 9 sea keys
  (`pf_dolphin`, `pf_mermaid`, `pf_seadragon`, `pf_whale`, `pf_octopus`, `pf_shark`, `st_ocean`,
  `st_starfish`, `st_shell`) are present.
- **A2** append-only: `ITEMS` keys and `PRESENT_ORDER` start with the goldens `ITEMS_V1` /
  `ORDER_V1` pinned in the test.
- **A3** `PRESENT_ORDER` is a permutation of the `ITEMS` keys.
- **A4** `threshold`: T(1)=50, T(2)=110, T(3)=180, T(6)=450, T(11)=950, T(48)=4650, T(96)=9450;
  gaps never shrink and never pass 100.
- **A5** `makeBase`: earned 0 / 60 / 120 / 180 / 2000 give base 0 / 0 / 0 / 0 / 1820 and ready
  0 / 1 / 2 / 3 / 3. A profile with no `stats` and no `coins` gives base 0 and ready 0.
  `{ prov: true }` sets `prov: 1`. Promotion of a provisional base with earned 2000 and opened 2
  leaves at most 3 ready.
- **A6** `earned`: `max(coinsEarned, coins - 100)`; a spend (coins down) never lowers `ready`; NaN,
  negative and string values are treated as 0. `progress(p, inFlight)` is unchanged after a spend
  of 30 (coins down 30, `inFlight` 0).
- **A7** `nextItem`: the **first 8 keys for each style are pinned** (the §3.1 table). Mix gives
  `PRESENT_ORDER` exactly; **the first present differs by style** (Mix `pf_strawberry`, Girl
  `pf_unicorn`, Boy `pf_dino`); `pf_dolphin` is within the first 4 for every style; with `'boy'` no
  `g` toy comes while a `b` or `gb` toy is missing, and `'girl'` the same for `b`; 48 opens per
  style give every toy once, no duplicates; then the Glitter round gives `pick: true` defaults in
  order; then null.
- **A8** `ready` clamps: opened above reached gives 0; unknown keys in `got` count as opened;
  `toNext` is null when all are opened. **`rest`:** a profile with all 96 opened and `rest = { n:
  96, coins: E }`, then 4 toys appended (a test-only `ITEMS` extension) and earned E + 1000: ready
  is the normal count from `rest.coins` (E + 100 reaches present 97 only), not 8.
- **A9** `mergeSquish`: union both ways, earliest dates kept; base: a real base beats an earlier
  provisional one; two real: earliest `at`; two provisional: larger `coins`; **an early stale
  provisional base (earned 300) against a later real one (earned 2,000) keeps the real one, and
  ready stays at most 3**; an invalid base loses to a valid one; `rest` larger `n` wins; unknown
  inner keys kept; garbage inputs (null, arrays, strings, numbers) never throw and never drop
  valid items; `mergeSquish(a, undefined)` deep-equals `a`; `merge(merge(a,b),b)` equals
  `merge(a,b)`; the result is the same for `merge(a,b)` and `merge(b,a)`.
- **A10** `mergeProfile` (`merge.js`): a newer server copy without `squish` keeps the local toys;
  a newer local copy keeps the server's toys; `stats.squishes` takes the max.
- **A11** `mergeBackupProfile`: a file's toys are joined into a current profile (fresh and not
  fresh); the current toys are never removed; a file **without** `squish` returns "not changed";
  `backupProfile` includes `squish`.
- **A12** `profileHasPlay` is true for `{ coins: 100, squish: { got: { pf_strawberry: '…' } } }`.
- **A13** words and names: every string in `STRINGS` has none of `buy`, `price`, `cost`, `rare`,
  `chance`, `\bher\b`, `\bshe\b`, `[$€£]`; no `STRINGS` entry has a number next to "present". The
  trademark scan (the shared scanner `tools/lib/name-scan.mjs`: the owner's forbidden names plus
  squish's encoded extra words, the toy-brand plural and the dropped "space" toy name) runs in **`tools/test-name.mjs`** over text files only (`src/**/*.js`, `site/**/*.{html,css,js,md}`,
  `dist/*.html` with inlined `data:` URIs stripped first). No `while (` and no `Math.random` in
  `data.js` and the present-picking code (`nextItem`, `refresh`, the commit); visual randomness
  elsewhere uses `mulberry32`.
- **A14** every held key (`squish_<key>` and `squishg_<key>`) matches `HELD_KEY_RE`; no
  `localStorage` in the squish module (device values go through `store.deviceGet/deviceSet`).
- **A15** `await import('../server/saves.mjs')` still loads in Node (the server imports
  `storage.js`, which now imports `squish-merge.js`); `squish-merge.js` has no `import` lines.
- **A16** `ITEM_CATEGORIES` after `install()` with a stub game: `'squish'` sits right after
  `'fun'`, once, even if `install()` runs twice.

### 14.2 `tools/test-net.mjs` additions (`squishTests()`, appended after `vehicleTests`)

- **N1** `avatarFields` keeps `hi: 'squishg_pf_strawberry'` and sends it only when it changes.
- **N2** `hi` values that break the rule (`'squish_PF'`, 49 characters, `'a b'`) become null.
- **N3** host presence with `hi` set stays under 3,900 B in the existing size test.
- **N4** `adapter.heldKey()` with no `game.treats` and a held toy returns the toy key (the early
  return is gone); with both, the treat wins.

### 14.3 `tools/probe-squish.mjs` (browser; copies `tools/probe-vehicles.mjs` structure)

Imports `launch, openGame, startWorld, waitForPlay, waitIdle, shot, finish, settle,
screenPoint` from `smoke.mjs`; `const PREFIX = 'squish'`; profile tweaks `tutorialDone = true`,
`settings.quality = 'low'` (test setting only). Flags
`--only=desktop,touch,world,save,mp,grids,cost`. New debug surface used by the probe:

```js
game.debug.squish = {
  state(),                    // { got, glit, base, rest, earned, reached, opened, ready, toNext, progress }
  presents(on = true),        // allow the drop, the Present button and the ring animation on a webdriver page
  give(key, { glitter }),     // open-free grant for scenes (debug only)
  giveAll({ glitter }),
  open(),                     // open the present panel
  tapPresent(),               // one tap on the present (for the 3-tap flow without coordinates)
  pick(key),                  // the Glitter round pick
  squeeze(where, ms),         // press the held / first placed / shown toy for ms (0 = a tap)
  order(style),               // the order nextItem would follow
}
```

**B: desktop** (1280 x 800)
- **B1** fresh profile: no Squish Toys tab in the Bag; the coin pill is a `button`; tapping it opens
  "Squish Shelf" with "0 of 48", the present path with "50 to go!", the one-time tip card (and not
  on the second open), and 48 silhouette cubbies with a "?" badge and no word.
- **B2** earn 50 through a real source (`game.coins.add(50, 'gift')`): `ready` is 1,
  `present:ready` fired, the Present button shows (after `presents(true)`) with the `present`
  icon, the drop appears only when no panel is open and no sticker pop is up (open the Bag first:
  no drop; close it: the drop comes within 3 s). **The drop's headline is "Mystery present!" and
  differs from the daily gift's label**; left alone it flies to the Present button after 7 s.
- **B3** tap the Present button, tap the present 3 times with real clicks: the reveal shows "NEW!"
  and "Strawberry Puffum!"; `got.pf_strawberry` is set; `coins.value` and `coinsEarned` are
  unchanged by the opening; the `squish_first` sticker ("First Present!") is awarded; the panel's
  Close works. On close, the pill tip "Your toys live here!" shows once.
- **B4** close after 2 taps: `ready` is still 1, `got` unchanged. Reopen: a tap within 300 ms of
  opening does not count; **three fast taps 80 ms apart open the present** (queued, none lost).
- **B5** Bag: the tab `.sw-tab[data-tab=squish]` exists, sits right after Fun & Toys, and shows
  exactly the owned toys (and the Toy Shelf) under a **Squish Shelf** button; choosing a toy puts
  it in the avatar's hand (`avatar.held` named `squish:pf_strawberry`); **Squish!** pressed 600 ms
  squashes it (part `sy` below 0.6 within 0.2 s and still below 0.6 at 550 ms), released it rises
  (above 0.97 by 3 s); **Put away** clears the slot and the hand, toast "All put away!".
- **B6** place a table, then the toy with a Build tap on the table top: an entity
  `squish_pf_strawberry` stands on it; a Hand tap plays the squish (`sy` dips and recovers); the
  hint says "Tap to squish!"; the first placement shows "You put it down! It's still in your Bag."
- **B7** hand exclusivity: hold a toy, then select a treat (shops), then the toy again, 20 times:
  the hand always holds the selected one, nothing leaks (objects under the avatar's held group: at
  most 1), and `renderer.info.memory.geometries` returns to its start value.
- **B8** shelf: tabs filter (All 48 / Puffums 24 / Stretchums 24); the detail card mounts the shared
  stage (no new WebGL context: `document.querySelectorAll('canvas').length` unchanged); **a 600 ms
  press on a Puffum squashes it and keeps it flat until release**; a 600 ms press on a Stretchum
  stretches (`sy` above 1.3) and release wobbles back; **Hold it** closes the panel, holds the toy
  and selects the Hand tool (a world tap then places nothing). NEW! tags stay after a 1 s open and
  close, and go after a 2.5 s open or a cubby tap.
- **B9** `giveAll()`, then open a present: the pick row shows with "Pick a toy to make sparkly!";
  `pick('pf_dino')` makes the Dino sparkly ("Now it sparkles!", no "NEW!"); the shelf shows
  "Glitter 1 of 48"; `giveAll({ glitter: true })`: no present ready, the ring shows the star, the
  shelf shows the champion line, the `squish_all` sticker is awarded.
- **B10** words: every visible text node in the drop, both panels, the HUD buttons, the tips and
  the hints has none of `buy|price|cost|rare|chance|\bher\b|\bshe\b|[$€£]`.
- **B11** Read Aloud on: the reveal speaks the toy's name (wrap `game.speak`).
- **B12** style: with `deviceSet('surpriseStyle','boy')`, the first present opened is
  `pf_dino`; with `'girl'` (fresh profile) `pf_unicorn`; with Mix `pf_strawberry`; the cushion is
  sky / pink / lilac; the profile has no style field after opening (`JSON.stringify(profile)` has
  no "surpriseStyle").
- **B13** ring: spend 30 coins in the candy shop: the ring fraction is unchanged; earn 10: it moves
  as the coins land.

**C: touch** (iPad 1024 x 1366 portrait and 1366 x 1024; phone 390 x 844 and 360 x 780)
- **C1** the coin pill's tap box is at least 44 x 44 px and a `locator.tap()` opens the shelf; the
  pill's `textContent` is still only the number; the ring is at least 28 px (24 px on phones).
- **C2** open a present with 3 `touchscreen.tap`s; Hold it; Squish! and Put away show at once; the
  life-HUD Squish! and Present buttons do not overlap the joystick (bounding boxes).
- **C3** the shelf fits 360 px wide with no horizontal scroll; cubbies at least 72 px.
- **C4** the Bag's ghost-click rule: the tap that chooses a toy in the Bag does not place one under
  the finger (no new entity within 700 ms).
- **C5** at 390 px wide, the **Present**, **Squish!** and **Put away** buttons have three different
  SVG markups (labels are hidden there, `kit.js:338-339`). The 5-tile title check at 420 px
  decides Q5.
- **C6** a 700 ms `touchscreen` press on the shelf stage brings up no callout and selects no text
  (`getSelection().toString()` is empty).

**W: world**
- **W1** on the beach biome, a toy placed on the floor, on a table and on the Toy Shelf top saves and
  reloads in place (keys and positions); on the shelf, `toy.y + toy.yOffset ≈ shelf.y +
  shelf.yOffset + 0.98`.
- **W2** Remove and Undo of a placed toy work; no profile change.
- **W3** at the default third-person camera on a 1024 px iPad viewport, a placed Stretchum's
  on-screen box is at least 44 px tall, and a Hand tap 0.3 blocks beside it (inside its cell)
  still squishes it.

**E: old saves and merges**
- **E1** `tools/fixtures/boys-old-profile.json` (no `coinsEarned`): loads; nothing is saved on the
  title screen; after the first world load `squish.base.coins` is 0; ready 0; the shelf says "50
  to go!"; look, coins (100), stickers unchanged; "Hi, Lily!".
- **E2** `tools/fixtures/old-world-96565e4.json` profile (`coinsEarned` 60): ready 1; the world loads
  as before.
- **E3** `tools/fixtures/squish-rich-profile.json` (recorded from this commit's build before any
  change, `coinsEarned` about 2,000): exactly 3 ready; nothing else in the profile changed except
  the new `squish` key.
- **E4** open a present and reload **within 100 ms** of tap 3: the toy is still there; reload
  between tap 2 and tap 3: still ready.
- **E5** "Save a copy" then restore onto a fresh profile: the toys come back; restore onto a profile
  with other toys: both sets kept; restore a file without `squish`: no save, no `profile:changed`.
- **E6** mid-session, merge a server profile that carries one more toy through `store.onProfile`
  (the 409 path): the Squish Toys tab shows it within 1.5 s and `ready` is recounted.

**M: multiplayer** (the `tools/net/mp-flows.mjs` harness, as `probe-vehicles.mjs:984-1004`)
- **M1** the host holds the Splashy Whale: the guest's page shows it in the host avatar's hand
  (a model named `squish:pf_whale` under the remote avatar); putting it away removes it.
- **M2** the guest places a toy in the host's world: the host sees it; world hashes converge.
- **M3** the guest opens a present during the session: the host's profile, coins and stickers are
  unchanged; the guest's toy is in the guest's profile only.
- **M4** the host's Hand tap on a guest's placed toy sends no **journal or ops** message (presence
  is ignored; counted for 1 s).

**F: costs and grids** (`--only=cost,grids`)
- **F1** **60 placed idle toys** (48 opaque, 12 see-through) add at most 14 draw calls (median of
  5 frames, fixed camera, `drawCallsOf` from `probe-vehicles.mjs:244-278`); squishing one adds at
  most 1 and the count returns within 3 s.
- **F2** holding a toy adds at most 2 calls.
- **F3** systems stage with 60 idle placed toys: average over 120 frames at most idle + 0.3 ms.
- **F4** opening the shelf with all 96 owned: no frame over 1 s (`diag.report()`), all thumbnails
  within 20 s.
- **F5** geometry: open and close the shelf and the present panel 10 times; geometries under the
  preview pivot return to 0; `renderer.info.memory.geometries` grows by at most 4 after a warm-up.
- **F6** grids (`.shots/squish-*.png`): `all` (48 toys), `glitter` (48), `sea` (the 9 sea toys next
  to ocean's dolphin and a merfolk tail, if those teams have landed), `shelf-ipad`, `shelf-phone`,
  `path-tip`, `unwrap-1..4` (each step), `glitter-pick`, `hand` (holding, close camera), `world`
  (toys on a table and the Toy Shelf in all 4 colors), `sticker-art` (the 4 stickers).

### 14.4 `tools/test-saves.mjs` (after the `lookPicked` test, `:486-492`)

- **S1** "squish toys are joined (the earliest date kept) whichever copy is newer".
- **S2** "a real milestone start beats a provisional one, even an earlier one; two real: the
  earliest; a missing one is not made up" (the stale-offline case of A9 through `mergeProfile`).
- **S3** "a server copy without squish never removes toys" (through `mergeProfile`, and once through
  the profile conflict path at `:703-735` with a 409).
- **S4** server guard: PUT a profile with `squish`, then PUT (with the right `If-Match`) one
  without it: GET returns the stored `squish`.
- **S5** old tab: run the `669b6fa` `mergeProfile` (copied into the test as a fixture function) on
  one side of a 409 so the upload has no `squish`; then the new build's load and merge: the toys
  are all there.

### 14.5 `tools/probe-multiplayer.mjs`: test `SQUISH` (after `HELD`, `:466`)

"a squishy toy in Rosie's hand shows in her avatar's hand on Lily's page; Lily's Toy Shelf with a
toy on it shows on Rosie's page; hashes converge". Budget unchanged (no new messages).

### 14.6 Existing suites that must stay green

`smoke`, `test:net`, `test:saves`, `test:accounts`, `test:name` (now with the trademark scan),
`probe-shops` (coin pill now a button: B-checks at `probe-shops.mjs:236-252`, `:627`, `:652` read
`.sw-hud .sw-coins` and its text, which stay true), `probe-menus` (pause grid gains a button; the
ring is still on webdriver pages), `probe-keepsafe` (backup carries `squish`; checks `:301-348`
still pass), `probe-life`, `probe-furniture` (new defs in the Bag tab list only once owned; the
Bag's tab list gains Squish Toys only once a toy is owned), `probe-environment` (sticker counts
are read live, `:301`), `probe:mp`, `probe:boys`, `probe:vehicles`, `site-check`.

Known edits needed in existing tests: none expected. The drop, the Present button and the ring
animation are off on webdriver pages (§5.1, §5.2), so welcome presents never move the coin pill's
box during other probes' HUD-overlap checks.

---

## 15. Build order

1. **Data and math** (`squish-merge.js`, `data.js`, `anim.js`) and `tools/test-squish.mjs` A1-A12,
   A14-A16. **Show the dad the toy list and the §3.1 first-8 table, settle Q7 (the shark), then
   record the `ITEMS_V1` / `ORDER_V1` goldens.** Run `npm run test:squish`.
2. **Record the fixture** `squish-rich-profile.json` from today's build (`dist` at `669b6fa`):
   a fresh profile, `game.coins.add(1940, 'gift')` in the page, save, copy the profile out.
3. **Saves**: `merge.js`, `storage.js` (incl. `profileStale`), `legacy.js`, the server guard;
   `test-saves` S1-S5. Run `npm run test:saves`.
4. **Models**: `models.js` (every `shape` in §3.1, glitter, present, Toy Shelf, the idle / live
   build split, the shared cache); the F6 `all`, `glitter` and `sea` grids. Show the dad the grids
   before going on (Q2).
5. **Furniture and Bag**: 97 defs, the `ITEM_CATEGORIES` splice, `squish` action, hidden-until-owned
   items, Bag tab color and Squish Shelf button. B5-B6, W1-W3.
6. **Holding**: hotbar sync, Hold it with the Hand tool, Squish! / Put away with their icons
   (`kit.js` `PATHS`), `game.squish.model`, `heldKey` and `heldModel` hooks, fake adapter `hi`.
   B5, B7, C5; `test-net` N1-N4. Run `npm run test:net`.
7. **Presents**: lazy base, `refresh()`, the drop, the Present button, the present panel (taps,
   guard, queue, finger, Glitter pick), sounds. B1-B4, B9, B11-B12, E1-E6.
8. **Shelf panel** (present path, tip card, press-and-hold), coin pill button and ring
   (`hud.js`), the pill tip, pause button (`menus.js`). B8, B13, C1-C6.
9. **Stickers** and art; B10 words scan; A13 (`STRINGS` and `test-name.mjs`).
10. **Multiplayer**: M1-M4 and the `SQUISH` test in probe-multiplayer. Run `npm run probe:mp`.
11. **Costs**: F1-F5. Then docs (§4.3), the CI step, and the suites in §14.6, one browser suite at a
    time.

---

## 16. Risks and open questions

- **R1 Coins and fun:** if presents feel too slow or too fast, only `FIRST`, `STEP`, `MAX_GAP`
  change (constants in `data.js`). Changing them later moves future milestones only; toys already
  opened stay. §6.1 shows both a builder's and an explorer's pace for the dad to judge.
- **R2 Thumbnail load:** 48 thumbnails on a slow iPad may take several seconds; cubbies show
  placeholders and the panel never waits. F4 measures it.
- **R3 Stale tabs:** an old cached page could save a world without its toys (they stay in the
  profile and can be placed again). It can no longer remove them from the cloud profile (the
  server guard, §9.1), and the new merge on any up-to-date device unions them back locally.
- **R4 Two kids on one device:** each family player has their own profile; the device style is
  shared by the device (as in the Studio today). Nothing in the collection is shared.
- **R5 Squish rebuilds:** a Hand squish rebuilds the toy twice and its square's batch once. If a
  kid taps 20 toys in a row on an old iPad this could cost a few ms per tap; F1 and F3 watch it.
  The fallback is option (b) of the review: one shared geometry per key and a per-world cap.
- **Q1** Are **Puffums** and **Stretchums** the names the daughter likes? Any replacement must be
  checked the same way (not in the game, no toy product by that name found). A grown-up trademark
  search before launch is suggested.
- **Q2** Toy grid review: does she want any toy swapped before the list is pinned (it is append
  only once shipped)?
- **Q3** Should the first present be a little earlier (25 coins) so it always comes in the first
  10 minutes, and should `MAX_GAP` go lower still (80) for kids who mostly build? (Today: 50 and
  100.)
- **Q4** Toys found in the world (one hidden present per world, tracked per host world like gems)
  as a v2?
- **Q5** Title screen Squish Shelf tile: **yes, if** the 5-tile `sw-four` layout passes at 420 px
  (C5); otherwise in play only.
- **Q6** Reword `docs/DESIGN.md:5` (it named another company's game) so no other company's name is
  in the repo at all? Done in the integrator's step 0.
- **Q7** The Shark Puffum (no teeth, smiling) or a Narwhal Puffum in its place? Decide before
  `ITEMS_V1` is pinned.

---

## Review notes

Every blocker and major issue from the two reviews is fixed above, and every minor one is taken.
Where this doc goes beyond, or slightly differs from, a reviewer's suggested fix:

- **`rest` after appended toys (§6.6).** Recording `rest = { n, coins: earned }` only once, when
  the collection completes, would still release every appended present at once for a kid who
  finished months ago (their earned total has moved on since). So `refresh()` keeps `rest.coins`
  up to date while everything is opened, and the first new present comes one normal gap later.
- **Provisional base promotion (§6.2).** The reviewers' merge rule handles a stale base meeting a
  real one. If no device ever makes a real base, the provisional one is made real in a later
  online session, **capped at 3 ready presents**, so a stale start can still never flood.
- **Draw calls (§7.1, §11).** Took option (a), idle toys batched with a refresh while squishing,
  rather than (b), shared geometry plus a per-world cap. A cap would be the first "you can't
  place more" limit a kid meets with free decor. Shared geometry is still used for held, shelf
  and unwrap toys. (b) stays the fallback (R5).
- **Mix order.** To make the Dolphin early for every style (2nd on Mix, 4th on Girl and Boy), the
  Mix order no longer strictly alternates Puffum and Stretchum in its first five presents
  (Strawberry, Dolphin, Bubblegum, Dino, Unicorn). That seemed the right trade for the toy the kid
  asked for by name.
- **The shark.** Kept, with a closed smile and no teeth, because it is one of the few boy-leaning
  toys, but marked for the dad (Q7) with the Narwhal ready as a swap before pinning.
- **Wish star.** Added as optional extra 1 (§12), not in v1, because it adds a profile field and a
  merge rule. The Glitter round pick is in v1.
- **Server change.** The server guard in `putProfile` means "the server is not changed" is no
  longer true. It is a small, local guard under the existing lock, tested by S4.
- **Ring size.** 28 px and 24 px on phones as asked. The present path on the shelf is the main
  picture of progress; the ring is the reminder.

---

## Integrator decisions

The integration plan, `docs/teams/wave4-integration.md`, decides everything shared between the three wave-4 teams and wins where this doc differs: its §2 corrections (C9, C12, C13, C15, C17) apply to this doc, and its "Integrator decisions" and "As built" sections hold the answers to the open questions and what is still open before the deploy. In short, for this doc:

- C9: the Sea Dragon Puffum uses merfolk's motifs (`#2FB5B0` / gold), the Mermaid Tail
  `#3FD8B0` with the round two-lobed fin; the Dolphin Puffum follows ocean's `sky` palette
  `#6A80CC` (a color, not a pinned key).
- C12, C13, C15, C17: no Dive button (merfolk reuses Up / Down); the forbidden names live only
  encoded in `tools/lib/name-scan.mjs`; one combined presence size test (ocean's); the integrator
  writes DESIGN.md §7.2, MULTIPLAYER.md, DATA-MAP.md and the shops.md coin pill line (done).
- Decisions: **Puffums**, **Stretchums** and the **Squish Shelf** as names; the friendly
  closed-smile **Shark Puffum** kept (the Narwhal swap stays one entry before the release); a
  held toy hides while she swims in sea form and on a dolphin with a tail (Just Me on a dolphin
  holds it).


## As built (P1)

Built on `claude/wave4-squish` from step 0 (`582d11c`), §15 steps 1-11 with the integration
plan's §1.2, §1.4 and C9. Where this differs from the design above, this is what the code does.

**Owner decisions applied (2026-10-04, all easy to change before the release):** Puffums and
Stretchums, the Squish Shelf; the friendly closed-smile Shark Puffum kept (the Narwhal swap is
still one entry before release); the goldens `ITEMS_V1` / `ORDER_V1` are pinned in
`tools/test-squish.mjs` for the picture review and only grow after the first release. C9 colors:
Sea Dragon Puffum `#2FB5B0` / `#FFD43B` with merfolk's motifs (rounded five-rib fan fluke, round
bubble-dome spikes, leafy fronds, glow spots, two horn nubs), Mermaid Tail `#3FD8B0` with the
round two-lobed fin.

**Files.** New: `src/core/squish-merge.js`, `src/things/squish/{data,anim,models,index,panel,fx,sfx,art,tab,sheet}.js`,
`tools/test-squish.mjs`, `tools/probe-squish.mjs`, `tools/fixtures/squish-rich-profile.json`
(recorded at `582d11c` with `tools/record-squish-fixture.mjs`, 1,940 earned coins). Changed, only
the lines of the integration plan §5: `main.js`, `merge.js`, `legacy.js`, `storage.js`
(`BACKUP_PROFILE_KEYS`, `mergeBackupProfile`, `profileStale`), `server/saves.mjs` (the
`putProfile` guard), `hud.js` (the pill button, the ring, `refreshRing`, the sparkle hop),
`inventory.js` (`TAB_COLORS.squish` and ONE line: the Bag emits `'bag:tab' { tab, main }` after a
tab's heading, which the shelf button listens to), `menus.js` (one line: the pause button through
`game.squish.shelfButton`), `pets/kit.js` (`present`, `squish`, `shelf` after `eat:`),
`adapter.js` (`treatHeld()` / `squishHeld()`), `remote-players.js` (`heldModel`),
`fake-adapter.mjs` (`hi`), `test-net.mjs` (`squishTests()`, runner `unit` / `squish`),
`test-saves.mjs` (S1-S5), `probe-multiplayer.mjs` (`SQUISH`, part a), `name-scan.mjs` (squish's two
encoded words), `package.json`, the CI step.

**Differences from the design.**
- Everything a kid sees move or wait for runs on wall-clock time (the drop's 1.5 s clear world,
  presses, squishes, the unwrap, the 1 s signature check): a slow page caps its frame time.
- Heights are set by `fit()` in `models.js`: Puffums 0.48-0.54, Stretchums 0.39-0.42 (the top of
  the designed range, so a Stretchum is 44 px tall on an iPad next to her).
- The Starfish Squeeze sits up a little (tilted) instead of lying flat, so its face shows and it
  is as tall as the other Stretchums. The Heart Squeeze's point is a flat diamond (a round cone
  hid its face).
- The shelf's pictures are drawn in batches by `sheet.js`: several toys into one offscreen target
  on the game's thumbnail renderer (no WebGL context of our own; three's `isXRRenderTarget` flag
  makes it draw exactly as on the canvas with the same shader programs), one read-back, cut into
  96 px pictures; the toys' shaders for it compile one kind a frame first. On the software
  renderer 96 pictures take about 14 s with no frame over 1 s (one at a time through the queue
  took 40 s). Same look as `thumbs.js` (2x drawn, 4x MSAA, same lights and lens). The thumbnail
  queue is the fallback.
- `rest` (§6.6): `milestone(n)` for `n >= rest.n` counts from `rest.coins`, so the first appended
  present is one normal gap after the last complete total (A8 checks it).
- The pill tip waits until the world is clear (after the First Present! sticker pop); the Bag tip
  ("Your new toy is in your Bag too!") comes on a later present's close, never together.
- A16 checks the pure `tab.js` helper (twice), which `install()` calls.
- E1: other modules may tidy an old profile on the title screen; the probe checks that nothing
  of the squishy toys is made or saved there.
- Holding, the HUD and the drop share the one `squish-presents` system.
- Not built: the title-screen tile (Q5: the shelf is in play only, from the coin pill, the pause
  menu and the Bag tab) and the optional extras of §12.

**Checks run (all green on this branch):** `test:squish` (17), `test:name`, `test:net` (65, incl.
N1-N4), `test:saves` (39, incl. S1-S5 and the browser parts), `test:accounts` (113),
`probe-squish` in passes (`desktop`, `touch`, `world,save`, `mp`, `grids,cost`), `smoke`,
`probe-multiplayer --part=a` (incl. `SQUISH`), `probe-shops`, `probe-menus` (desktop, touch),
`probe-keepsafe`, `probe-life` (desktop, touch), `probe-furniture` (4 parts),
`probe-environment`, `probe-boys` (6 parts), `probe-vehicles` (3 parts), `site-check`.

**Owner review pictures** (`.shots/`): `squish-sheet.png` and `squish-sheet-glitter.png` (all 48
toys, named, plain and sparkly), `squish-all.png`, `squish-glitter.png`, `squish-sea.png`,
`squish-sea-glitter.png` (the 9 sea toys), `squish-world.png` (the Toy Shelf in 4 colors, a
table), `squish-hand.png`, `squish-unwrap-1..4.png`, `squish-unwrap-boy.png`,
`squish-glitter-pick.png`, `squish-shelf-ipad.png`, `squish-shelf-phone.png`,
`squish-b1-shelf-first.png` (the path tip), `squish-b2-drop.png`, `squish-sticker-art.png`.

**Text for the integrator (C17; builders do not edit these files):**
- DESIGN.md §7.2: Puffums and Stretchums (48 toys) come only from mystery presents at milestones
  of earned coins (50, then 10 more each time up to 100; up to 3 welcome presents; a Glitter
  round after all 48); the Squish Shelf (coin pill, pause menu, Bag tab); holding with Squish! and
  Put away; toys are free decor in worlds; 4 stickers (First Present!, Squish Collector, Squish
  Champion, Squeeze Me!). Events: `'squish:get' { key, glitter, n }`, `'squish:squeeze' { key,
  glitter, where }`, `'present:ready' { ready }` (and the internal `'squish:refresh'`,
  `'bag:tab'`). Storage: `profile.squish` (`got`, `glit`, `seen`, `base`, `rest`, unions on every
  merge), `stats.squishes`; device keys `squishPathTip`, `squishPillTip`, `squishPlaceTip`,
  `squishBagTip`.
- MULTIPLAYER.md §5.4 `hi`: "a treat key, a food key or a squishy toy def key (`squish_*`,
  `squishg_*`)"; §7: "the squishy toy collection and mystery presents" are per player.
- DATA-MAP.md: the squishy toy collection is game data in the profile (§11 sentence).
- shops.md: the coin pill is a button that opens the Squish Shelf; earned coins also fill the
  mystery presents (spending never takes one away).

## As built (integration review fixes)

Made on `claude/wave4-integration` after the three merges (commit tag `[review-fixes]`).

- **The server joins the toys on every upload.** The `putProfile` guard of §9.1 used to keep the
  stored `squish` only when the upload had none. An old tab can hold a stale copy (picked up at an
  earlier 409, which its old merge keeps whole) and upload it after a newer toy landed. Now,
  whenever a row exists and the stored profile has toys, the server stores
  `mergeSquish(stored, upload)` (the unions every device uses), or the stored toys when the upload
  has none (`server/saves.mjs`). test-saves S5b: an old tab with a stale `squish` uploads after a
  newer toy landed, and the server keeps both. Nothing a player owns is lost; §11 step 4 of the
  integration plan ("the `putProfile` squish guard is live with this deploy") still holds.
- **The pill tip waits for toasts.** On an upright phone the one-time coin pill tip sits right
  where the toast stack is, so it waits while a toast shows (for example "You're holding ...
  Press Squish!"), then 600 ms more, as it already waited for the First Present! pop
  (`panel.js` `pumpTips`). probe-squish C2 checks the tip never lies on a toast and takes
  `squish-pilltip-phone.png`.
- **Just Me on a dolphin holds her toy.** `inWater()` (`index.js`) returns false while she rides a
  dolphin with no tail (`player.swimming` keeps its old value during a ride, so it cannot decide
  there); with a tail, the toy still hides as in §1.2 of the integration plan.
- **Ocean's "Tap to say hi!" waits during a present drop** (one "tap" call at a time).
- **Squish! and Put away show the moment she holds a toy** ([rf2-c2]). probe-squish
  `--only=touch` C2 failed on the two iPads (1024x1366, 1366x1024): about 600 ms after `held()`
  was true, Squish! and Put away still read as hidden. `hold()` set the held toy at once, but the
  life HUD only updated in the next system update (`showHud()` in the `squish-presents`
  system), and on the GPU-less test machine one iPad-sized frame takes 600-800 ms. Now `hold()`
  and `putAway()` call `showHud()` themselves (`index.js`), so the buttons appear with the
  "You're holding ..." toast. C2 checks that they show in the same moment as `held()`, then
  waits two game frames (`diag.frames`) and 600 ms before it measures the layout; a button that
  stays hidden still fails. `--only=touch` green twice.
