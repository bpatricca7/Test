# Wave 5: Cruise Ship and Holiday Village (added 2026-11-07)

From the dad (by voice, in his words, lightly trimmed):

> We need to create a few new worlds. A new **cruise ship world** where kids can go, an entire
> cruise ship world with **decks**, and I want it to feel like a big family cruise. Make it have
> really cool features and things people can do. They can **play games on the cruise ship**. They
> can do a bunch of different things.
>
> And a **holiday world**, all Christmas-themed, with **Christmas trees, amazing lights**, very cool
> Christmas activities. You can **turn into an elf**, or turn into **Santa**, or dress like Santa.
> You can **create gifts and wrap them and give them to your friends** in the game. A little
> **helper elf can come to your house**, and there are hiding elves in the holiday world too.
> You can **ride on Santa's sleigh**, **ride reindeer**, and see reindeer. Make them both look
> **amazing and unreal**.

This doc is the contract for the seven wave-5 teams and the integrator. It wins over each team's
own doc where they differ. `docs/DESIGN.md` (audience rules §1, architecture §2-§3, multiplayer
rules §5) and `docs/MULTIPLAYER.md` still bind everyone.

---

## 0. Decisions at a glance

- Two new world types on the New World screen, after Everything Land: **Cruise Ship** (`cruise`)
  and **Holiday Village** (`holiday`). Both are generated block worlds like the others (no
  scripted levels), and both start the player somewhere wonderful (the pool deck; the village
  square by the giant tree).
- **Everything is our own.** The ship is an original liner called the **Glimmer Star** (no real
  cruise line's ships, names, colors, characters, logos or shapes). The helper elves are our own
  **Twinkle Elves** (no trademarked elf doll's name, look, story or "rules"). No famous holiday
  characters by name (the scanner in §3 refuses them). Santa, elves, reindeer, sleighs, trees,
  stockings and presents are ordinary holiday things and are fine.
- **Age 7-8 rules hold everywhere** (DESIGN.md §1): nothing scary, no losing, no failing
  messages, big buttons with an icon and a 1-2 word label, every action gives a sparkle and a
  sound, works with mouse and touch, nothing bought with real money. Mini games never say "you
  lose": every round ends with a cheer and a score.
- **Coins**: activities may pay small Sparkle Coins through `game.coins.add(n, reason)` only,
  with a daily cap per team (§6.6). Nothing costs coins.
- **One thing at a time**: no popup a module starts by itself while a panel, dialog, sticker pop,
  photo, fade or another `.lf-bubble` is showing (copy the squish team's `blocked()` rule,
  `src/things/squish/fx.js`). Popups a module starts by itself stay off on
  `navigator.webdriver` pages unless the team's own debug switch turns them on.
- **Multiplayer**: every world change goes through `game.entities.*`, `World.set` or a
  registered actor; no `update()` mutates world state on a guest (`game.net?.isGuest`); every
  per-player listener (stickers, coins, stats) starts with `if (game.net?.remoteApplying) return;`;
  host-only actions on a guest refuse with `game.net.refuse(kind)` (DESIGN.md §5).
- **Saves never break**: old worlds and profiles load unchanged. New profile data lives under one
  new top-level key per team (§6.5), merged with care.

## 1. Teams, folders and namespaces (nothing may collide)

| team | folder(s) it owns | `main.js` module | facade / debug | team doc |
|---|---|---|---|---|
| cruise-world | `src/world/biomes/cruise.js`, `src/world/paint/cruise.js` | (worldgen) | none | `docs/teams/cruise-world.md` |
| cruise-fun | `src/things/cruise/` | `cruise` | `game.cruise`, `game.debug.cruise` | `docs/teams/cruise-fun.md` |
| holiday-world | `src/world/biomes/holiday.js`, `src/world/paint/holiday.js` | (worldgen) | none | `docs/teams/holiday-world.md` |
| holiday-looks | `src/player/holiday/` + the dress-up files in §6.1 | `holidayLooks` | `game.holidayLooks`, `game.debug.holidayLooks` | `docs/teams/holiday-looks.md` |
| gifts | `src/things/gifts/` | `gifts` | `game.gifts`, `game.debug.gifts` | `docs/teams/gifts.md` |
| elves | `src/things/elves/` | `elves` | `game.elves`, `game.debug.elves` | `docs/teams/elves.md` |
| reindeer | `src/things/reindeer/` + the pets / vehicles lines in §6.1 | `reindeer` | `game.reindeer`, `game.debug.reindeer` | `docs/teams/reindeer.md` |

| kind | prefix each team uses |
|---|---|
| block keys | cruise-world `cruise_*`; holiday-world `holiday_*` |
| furniture / entity keys | cruise-fun `cruise_*`; gifts `gift_*`; elves `elf_*`; reindeer `reindeer_*`, `sleigh*`; holiday-looks `holiday_booth` |
| item keys | `furn:<entity key>` / `block:<block key>` as today |
| systems (`addSystem` name) | `cruise`, `gifts`, `elves`, `reindeer`, `holiday-looks` (more: prefix with these) |
| events | `cruise:*`, `gift:*`, `elf:*`, `reindeer:*`, `sleigh:*`, `holidaylook:*` |
| panels, actions | prefix with the team name (`cruise-arcade`, `gift-workshop`...) |
| sticker ids | `cruise_*`, `gift_*`, `elf_*`, `reindeer_*` / `sleigh_*`, `look_*` (§6.4) |
| CSS class prefix | `cr-`, `gf-`, `el-`, `rd-`, `hl-` (plus the shared `lf-bubble`) |
| device keys (`store.deviceSet`), toast keys | prefix with the team name |
| `game.thumbs` keys | `cruise:`, `gift:`, `elf:`, `reindeer:`, `holiday:` |
| features kinds (§4) | `cruise:*` (made by cruise-world), `holiday:*` (made by holiday-world) |
| node test | `tools/test-<team>.mjs` (no browser; see §8) |

## 2. The two worlds (what "amazing and unreal" means here)

### 2.1 Cruise Ship (`cruise`), cruise-world

An enormous original ocean liner, the **Glimmer Star**, floating in a sparkling turquoise sea
that fills the world, with a small palm-tree island and a few rocks out at sea so swimming
and boating (and the dolphins of wave 4, which find any deep water) have somewhere to go.

- Hull: long, rounded bow and stern, deep navy-plum below a white upper hull with a pink-and-gold
  stripe and rows of round portholes (lit at night), the name GLIMMER STAR in block letters near
  the bow (only if it reads well; a big star emblem is fine instead), anchors, lifeboats along
  both sides.
- **Decks** (world height is 64; sea level about 20): at least four walkable decks plus the
  bridge, joined by wide stairs at both ends and by lifts (cruise-fun):
  1. **Promenade deck**: a wrap-around walk with glass railings, deck chairs, cabins in a row
     (each a little room with a door, a bed and a porthole), a snack bar.
  2. **Fun deck**: the arcade room, a theater / movie room, a kids' club with toys, a candy
     shop and an ice-cream parlor (existing shop furniture through `furn`).
  3. **Pool deck** (the spawn): two big pools (one shallow splash pool, one deep enough for
     sea forms), hot-tub rounds, loungers, a giant **water slide tower** with at least two
     twisting slides that end in a pool, a dance floor, a giant outdoor movie screen on the
     funnel, a bandstand.
  4. **Sports deck** (top): mini-golf course, a game court (hoops, ring toss, shuffleboard),
     a running track around the funnels.
  - **Bridge** at the front, with big windows and the captain's wheel; **funnels** in our own
    colors (white with a pink band and a gold star) with soft clouds above.
- Light: lots of block light (lanterns, light-up floor, sea lanterns in pools, portholes) so it
  glows at night; colorful flags strung between masts.
- Spawn: on the pool deck facing the slides. The whole ship fits a Cozy world (144) with sea all
  around (keep 8+ blocks of water to every edge); a Big world (208) makes a longer ship and a
  bigger island.

### 2.2 Holiday Village (`holiday`), holiday-world

A snowy valley at the top of the world, always in its prettiest winter evening light (the
biome's `sky` and `fog` colors, §5.2), full of twinkling lights.

- The **village square** (the spawn) with a **giant holiday tree** (25+ blocks tall) wrapped in
  light strings (light-emitting colored blocks), ornaments and a glowing star on top, presents
  around its foot (`holiday:presents`), lamp posts, benches, a hot-cocoa stand.
- **Gingerbread and candy cottages** (a few furnished through `furn`: bed, fireplace, sofa,
  table, lamps, `fairy_lights`), candy-cane lane, peppermint paths, light arches / a light
  tunnel, snowmen, a striped North Pole post.
- **Santa's workshop**: a big red-and-green building with toy shelves, workbenches and the Gift
  Workshop spot (`holiday:workshop`), plus Santa's chair.
- **Reindeer stable and pasture** with a fence (`holiday:reindeer`) and the **sleigh** parked on a
  little launch hill (`holiday:sleigh`).
- A frozen **skating pond**, a sledding hill, pine forest with ornaments and lights in some trees,
  candy and snow decorations, a Holiday Dress-Up booth (`holiday:dressup`).
- 12 or more good elf hiding places all around (`holiday:elf`).
- Snow falls (weather follows the biome: check `src/life/weather.js` for how a biome gets snow;
  ask the integrator in your doc if it needs a core change).

## 3. Names (the scanner)

`tools/lib/name-scan.mjs` already refuses the owner's brand list everywhere and now has wave-5
lists `cruise` and `holiday` (a cruise company's names, a famous mouse pair, the trademarked elf
doll and its "scout" wording, and famous holiday characters), encoded. Any team may append
encoded entries (one per line) to its world's list. `node --test tools/test-name.mjs` must stay
green. Don't spell any of those words in code, comments, docs or commit messages.

Our own names to use: **Glimmer Star** (the ship), **Twinkle Elves** (each with a first name:
Pip, Tinsel, Juniper, Sprout, Clove, Nutmeg, Holly, Sparkle, Jingle, Maple, Pepper, Snowdrop;
elves team may change), **Holiday Village** (the world). Reindeer get ordinary friendly names the
reindeer team picks (avoid every name from famous holiday songs or films).

## 4. World features (how a biome asks for things that are not blocks)

`src/world/features.js` (integrator, already in the base commit) is the one bridge between a
biome's `generate()` (blocks only) and the modules that own furniture, rides, games, elves and
animals.

- `generate()` sets `world.features = [ record, ... ]` (in memory only, never saved).
- When that fresh world first loads (host only), `features.js` calls the placer registered for
  each record's `kind`: `game.worldFeatures.on(kind, (game, record, world) => { ... })`, during
  the owning module's `install`. Placers use `game.entities.place(key, x, y, z, rot, color, data,
  game.worldFeatures.placeOpts())` (no history, no sparkle, no event, players ignored). A missing
  owner or a throwing placer only skips that record with one warning.
- Built-in kind `furn`: `{ kind: 'furn', key, x, y, z, rot = 0, color = null, data = {} }` places
  any existing furniture key (beds, sofas, `fireplace`, `ice_cream_parlor`, `candy_shop`,
  `piano`, `tv`, `fairy_lights`, `string_lights`, ...) and also any new furniture key a wave-5
  team registers (so the world teams may place `cruise_lounger` etc. directly once the key
  exists; an unknown key is skipped with a warning).
- Coordinates: `x, y, z` are the integer cell of the entity's base (the first air cell above the
  floor, like a block placed on the floor). `rot` 0..3 as in `entities.place` (study
  `src/things/entities.js` `footprint()` for which way each rot faces).
- A world team must leave each record's cells empty (air) and the floor solid under them.

### 4.1 Cruise kinds (made by cruise-world, placed by cruise-fun unless noted)

| kind | fields (besides x, y, z, rot) | what cruise-fun makes there |
|---|---|---|
| `cruise:slide` | `path: [[x, y, z], ...]` cell centers from the top platform to the splash cell in a pool (≤ 240 points, each step ≤ 1.5 blocks), `name` ('Twister', 'Big Dipper', ...), `color` (css) | the slide's start gate (tap: whoosh down the path, splash) |
| `cruise:lift` | `stops: [{ y, name }]` (deck floors y, deck names), one record per lift shaft (x, z = the shaft cell) | a lift button at every stop (tap: pick a deck, ding, ride) |
| `cruise:arcade` | none | one arcade cabinet (mini game panel) |
| `cruise:game` | `game: 'hoops' \| 'ringtoss' \| 'shuffle'` | that deck game |
| `cruise:golf` | `holes: [{ tee: [x, y, z], cup: [x, y, z], par }]` | a mini-golf start sign (and the holes) |
| `cruise:dance` | `x0, z0, x1, z1` (the floor, y = its top cell + 1) | the DJ booth at x, y, z |
| `cruise:movie` | `w, h` (screen size in blocks; the screen faces `rot`) | the big screen (cartoons) |
| `cruise:wheel` | none | the captain's wheel (horn, "Captain!") |
| `cruise:board` | none | the "What's on" board (pick an activity, "Take me there") |
| `cruise:spot` | `name`, `deck` | a named place the board and the lifts may send her to (pool, slides, arcade, golf, theater, dance, bridge, cabins, beach); not an entity |
| `cruise:float` | none | a pool float on the water |
| `furn` | (built in) | beds, loungers, shops, sofas, tables, lamps, pianos, TVs... |

### 4.2 Holiday kinds (made by holiday-world)

| kind | fields | owner and what it makes |
|---|---|---|
| `holiday:workshop` | none | gifts: the Gift Workshop bench |
| `holiday:presents` | `n` (how many, 3-8) | gifts: wrapped surprise presents around the tree, each opens to a toy |
| `holiday:elf` | `where` ('shelf', 'roof', 'tree', 'window', 'lamp', 'fence', 'chimney', ...) | elves: one hiding Twinkle Elf |
| `holiday:elfhome` | none | elves: the Twinkle Elves' cottage door sign (where she meets her first elf) |
| `holiday:dressup` | none | holiday-looks: the Holiday Dress-Up booth |
| `holiday:reindeer` | `n` (1-4) | reindeer: that many reindeer in the pasture |
| `holiday:sleigh` | none | reindeer: the parked sleigh |
| `holiday:spot` | `name` | a named place (tree, workshop, stable, pond, cottages); not an entity |
| `furn` | (built in) | cottages' furniture, the cocoa stand (`candy_shop` / `ice_cream_parlor` for now) |

A team that wants a new kind adds a row here in its own doc's "Wanted" list; the integrator
decides.

## 5. Blocks and the New World card

### 5.1 Block budget (hard limit)

Block ids are one byte. **214 blocks are registered today; the registry refuses the 256th.**
cruise-world may add **at most 14** block types, holiday-world **at most 16** (total ≤ 244, the
rest is reserve). Reuse existing blocks everywhere you can (run `node tools/worldview.mjs meadow`
and read `src/world/paint/*.js` for the library: wool in 16 colors, glass kinds, quartz, marble,
lanterns, sea lanterns, candy blocks, snow, ice, pine, planks, carpets, wallpapers...). New tiles
use the same pixel-art painter kit (`src/world/paint/kit.js`, `painter()`, `Pix`), 16x16,
pastel, deterministic. New blocks go in their team's paint file (already wired into
`src/world/blocks.js`), into Bag tabs `cruise` / `holiday` or an existing tab.

### 5.2 Biome def

As in `src/world/worldgen.js` and DESIGN.md §3: `{ key, name, description, iconBlock, colors,
sky: { top, horizon, fog, sunset, nightTop, cloud }, generate, paintArt? }`. The stub files hold
the key, name and description; teams may improve the description (keep it short: one line on a
card).

### 5.3 The card picture

`paintBiomeArt` (src/ui/menus/biome-art.js) now calls `def.paintArt(g, W, H, helpers)` when a biome
has one (288 x 176 canvas, `g.imageSmoothingEnabled = false`; helpers: `rand`, `reg`,
`tileFor(def, face)` -> 16x16 canvas, `drawSparkle(g, x, y, s, color)`, `pixelCloud(g, x, y, s,
color)`). Each world team paints a lovely pixel-art card in its biome file (a ship on the sea; a
lit tree in a snowy village at dusk). It must not throw (it runs in the browser only).

## 6. Shared files: who changes what

Edit only your own folder and the lines listed for you here, one property or entry per line, a
`// wave 5` comment on new shared lines. Anything else you need from a shared file goes in your
doc's **"Wanted from the integrator"** list (exact file, line and change) instead of editing it.
Never edit `docs/DESIGN.md`, `docs/MULTIPLAYER.md`, other teams' docs or `site/`.

### 6.1 Game source

| file | who | what |
|---|---|---|
| `src/ui/inventory.js` `TAB_PICS` | cruise-fun: the `cruise:` line; holiday-world: the `holiday:` line | the tab's picture keys |
| `tools/lib/name-scan.mjs` | cruise-world: `cruise` list; holiday-world: `holiday` list | append encoded entries |
| `src/player/wardrobe-data.js`, `src/player/avatar.js`, `src/player/avatar/*.js`, `src/ui/dressup.js`, `src/ui/dressup/*.js`, `src/net/codec.js` | holiday-looks only | holiday clothes, ready-made looks (**look lists are append-only**: the codec sends indices; look strings ≤ 160 characters; read `docs/teams/boys.md`, `docs/teams/merfolk.md` §3.3 and wave4-integration.md §4.2 first) |
| `src/things/friends/looks.js` | holiday-looks only | holiday outfits for NPC friends (append only) |
| `src/things/friends/index.js`, `src/things/friends/chat.js` | gifts only (elves and others: through events and the Wanted list) | "Give a gift" when she taps a friend while holding a gift; friends' thank-you lines (girl and boy lines) |
| `src/things/pets/species.js`, `src/things/pets/*.js` | reindeer only | the `reindeer` species appended last (check how species keys travel in saves and presence first) |
| `src/things/vehicles/defs.js`, `drive.js`, `index.js`, `live.js`, `remote.js`, `models-*.js` | reindeer only | the sleigh appended last to `VEHICLES` (append-only), flying (§7.7) |
| `src/things/pets/kit.js` `PATHS` (life icons) | each team may append its icons **at the end of the object**, one per line, prefixed by team (`cr_`, `gf_`, `el_`, `rd_`, `hl_`) | |
| `src/ui/touch.js` help cards / `PICS` | Wanted list only | |
| `src/core/*`, `src/world/world.js`, `physics.js`, `mesher.js`, `src/life/*`, `src/ui/hud.js`, `menus.js`, `stickerbook.js`, `src/net/*` (but codec, above) | nobody (Wanted list) | |
| `package.json` scripts | Wanted list only (the integrator adds `test:<team>`) | |

### 6.2 Merge order

cruise-world, holiday-world, holiday-looks, reindeer, gifts, elves, cruise-fun. On a conflict in
a shared list the integrator keeps both sides in this order.

### 6.3 Bag

Tabs `cruise` ("Cruise Fun") and `holiday` ("Holiday") exist in the base commit
(`ITEM_CATEGORIES`, `TAB_COLORS`). Cruise-fun's items (loungers, floats, arcade, deck games,
slide start, DJ booth, wheel, board, lift button, towel animals...) go in `cruise`. Holiday
blocks, the Gift Workshop, wrapped gifts, the elf's door sign, the dress-up booth, the sleigh's
reindeer and holiday decor go in `holiday` (the sleigh itself stays in Cars & Boats; the reindeer
pet in Pets). Every item a world places must also be in the Bag so she can build her own ship
or village anywhere.

### 6.4 Stickers

Each team registers its stickers on `game:ready` in its own module (see
`src/things/vehicles/stickers.js` for the pattern with hand-drawn art, 100 x 100) and awards them
itself. Book order follows install order. Budget: cruise-fun ≤ 6, gifts ≤ 3, elves ≤ 3,
reindeer ≤ 3, holiday-looks ≤ 2, world teams 0 (no events of their own). Each sticker pays +20
through the existing listener.

### 6.5 Profile and world saves

| key | owner |
|---|---|
| `profile.cruise` (scores, daily coin day) | cruise-fun |
| `profile.gifts` (gifts given count, last tags...) | gifts |
| `profile.elves` (elf name per world id is world data: keep it in the world, see below) | elves |
| `profile.reindeer` | reindeer |
| `profile.holidayLooks` | holiday-looks (if needed) |
| per-world data | through each team's `addSystem({ name, serialize, deserialize })` |

A new profile key must survive the two merges (`src/account/merge.js`, `src/core/storage.js`
`mergeBackupProfile` / `BACKUP_PROFILE_KEYS`): if yours needs more than "newer wins", put the
exact change in your Wanted list. `defaultProfile` in `game.js` is not changed by anyone: read
your key with a default (`profile.cruise || {}`).

### 6.6 Coins (daily caps)

cruise-fun ≤ 20 a day (arcade and deck games, first plays), gifts ≤ 10 (giving), elves ≤ 10
(finding), reindeer ≤ 5. Use `game.coins.add(n, reason)`; read how ocean's daily sea reward keeps
its day mask (`src/life/ocean/`).

## 7. What each team builds

Every team: study the modules you build on first (they are mature and carefully written; match
their style: short comments that say why, no `while` loops without a bound, every number
checked), then build, then write `docs/teams/<team>.md` (design, keys, numbers, how to test,
"As built", "Wanted from the integrator", open questions for the owner).

### 7.1 cruise-world
The `cruise` biome (§2.1): `generate`, `paintArt`, sky colors, its blocks (≤ 14: e.g. hull
paints, deck planks, glass railing, porthole, light-up dance floor tiles, pool tiles, lifebuoy,
funnel stripe, slide tube...), and `world.features` for everything in §4.1 (at least: 2 slides,
1-2 lifts, 3 arcade cabinets, 3 deck games, a 4-6 hole golf course, the dance floor, the movie
screen, the wheel, the board, 6+ spots, 4+ floats, and furnished cabins through `furn`). Keep
`generate` under about 300 ms for a Big world in Node (`tools/worldview.mjs` prints the time).
Use `tools/worldview.mjs cruise --T=8 --slice=<deck y>` pictures to check every deck (look at
them yourself: Read the PNG files). Test: `tools/test-cruise-world.mjs` (seeds 1..5, cozy and
big: spawn safe on the pool deck, every feature record on solid floor with air in its cells,
every slide path continuous and ending in water, lift stops on floors, no unknown blocks, sea
all around, block count budget).

### 7.2 cruise-fun
Everything to do on the ship (`src/things/cruise/`), all also in the Bag (`cruise` tab) so it
works in any world:
- **Water slides**: the start gate entity; tap -> she rides the path (seated pose, speed builds,
  gentle turns, a splash and bubbles at the end, never stuck: any blocked cell ends the ride
  safely in the pool or on the start). Study the zip line (`src/things/outdoor/zipline.js`) and
  the mount contract (`player.mount`). In the Bag: a slide start that rides a straight short
  slide down whatever she builds is enough (or a "Mini Slide" furniture piece).
- **Lifts**: a button at each deck stop; tap -> a small panel with big deck buttons (names from
  the record) -> a short "ding" fade and she is there.
- **Arcade**: 3 cabinets with 3 different mini games in a panel (canvas, 30-60 s rounds, tap or
  click only, a cheer and a score at the end, best score kept): for example Star Catcher, Bubble
  Pop, Fish Match (memory).
- **Deck games**: hoops, ring toss, shuffleboard as quick timing games (tap when the arrow is
  right), each with a 3D model on deck.
- **Mini golf**: a start sign; a simple, fun putting game per hole (a panel view is fine), par
  shown, every hole ends happily.
- **Dance deck**: DJ booth: tap -> party (music loop from `game.audio`, flashing colored lights
  as entity lights / particles, not block changes; she and nearby friends dance).
- **Movie screen**: big outdoor screen showing the TV's cartoons (study `src/things/furniture/tv.js`).
- **Captain's wheel**: tap -> the ship's horn, "Captain <name>!" toast, and a look out over the
  bow (camera), sticker.
- **What's on board** and spots: lists the ship's activities with pictures; "Take me there"
  moves her to the spot (fade).
- Pool floats, loungers (sit), towel animals on cabin beds (cute decor), a ship's bell.
- Stickers (≤ 6), coins (≤ 20 a day). Test: `tools/test-cruise-fun.mjs` (the pure logic:
  slide path following and its safe ends, game scoring, daily caps, lift stop picking).

### 7.3 holiday-world
The `holiday` biome (§2.2): `generate`, `paintArt`, sky (dusk-like pinks and deep blues, by day
too), its blocks (≤ 16: e.g. colored string-light blocks that glow, ornament blocks, glowing
star, gingerbread wall, icing trim, peppermint, wrapped-present block, candy-cane stripe if not
existing, North Pole stripe, holly, snowy roof...), `world.features` for everything in §4.2
(at least: workshop, presents 6+, 12+ elf spots, elf home, dress-up booth, reindeer pasture with
4+ reindeer, sleigh, 5+ spots, furnished cottages). Same tests as 7.1:
`tools/test-holiday-world.mjs`, worldview pictures checked by eye.

### 7.4 holiday-looks
- New clothes appended to the look lists: Santa coat (red, white trim, black belt, gold buckle),
  Santa trousers, Santa hat, a big white beard (face accessory; also a "Mrs. Claus" style dress
  with white trim for girls who want it), elf tunic (green with a zigzag hem and bells), elf
  hat with a bell, pointy elf ears, curly elf shoes, striped holiday stockings, reindeer antler
  headband, a cozy holiday sweater (snowflake / tree pattern), a candy cane and a present to
  hold. Every item free for anyone (Girl / Boy / Mix tags as `docs/teams/boys.md`).
- Ready-made looks **Santa** and **Elf** (and a girl and a boy version where it fits) in the
  Studio's ready-made row.
- **Holiday Dress-Up booth** (`holiday_booth` furniture, Bag `holiday`, placed by
  `holiday:dressup`): tap -> big buttons **Be an Elf**, **Be Santa**, **Back to me**: a sparkle
  puff and she is changed (her own look is kept and comes back with "Back to me"; Undo-safe; the
  look syncs to friends like any look change). The Studio stays the place for fine changes.
- NPC friends wear holiday outfits while in Holiday Village (appended `OUTFITS` entries, applied
  only there, restored when they leave).
- Stickers (≤ 2): e.g. `look_elf` (Little Helper), `look_santa` (Ho Ho Ho!). Test:
  `tools/test-holiday-looks.mjs` (lists only appended, old look strings decode the same, the new
  worst-case look string ≤ 160 characters, the ready-made looks normalize).

### 7.5 gifts
- **Gift Workshop** (`gift_workshop` furniture, Bag `holiday`, placed by `holiday:workshop`): tap
  -> a big friendly panel in 4 steps with a live 3D preview: **1 What's inside?** (12+ toys of our
  own: teddy, ball, robot, train, doll, puzzle, kite, drum, rocket, unicorn plush, paint set,
  book... plus treats she has in her basket if that is easy), **2 Box** (small / tall / big
  round), **3 Paper** (8 colors x 6 patterns: stripes, dots, stars, snowflakes, hearts,
  candy cane), **4 Ribbon and bow** (colors), then **Wrap it!** (a little wrapping animation:
  paper folds, ribbon ties, bow pops) and a **To:** tag (a friend in this world, a friend playing
  with her, or "Anyone").
- The wrapped gift is **in her hands** (hold contract like treats and squishy toys); she can
  **give it**: tap an NPC friend -> "Give gift" -> the friend unwraps it with a delighted line,
  hearts, and keeps the toy beside them for a while; or **place it** in the world (a `gift_box`
  entity, its data `{ to, from, inside, box, paper, pattern, ribbon }`) where anyone (a friend
  playing with her too) can tap it to open it: paper bursts into confetti, the toy pops out as
  placeable decor (or goes into the opener's basket), "From <name>!".
- **Surprise presents** around the holiday tree (`holiday:presents`), each opens to a toy (daily
  refill: they come back wrapped each new game day).
- Stickers (≤ 3): `gift_maker`, `gift_giver`, `gift_ten`. Coins: giving pays a little. Test:
  `tools/test-gifts.mjs` (gift data validation and normalization, every combination builds,
  presence / entity data size limits, daily caps).

### 7.6 elves
- **Twinkle Elves**: small original elf characters (round faces, rosy cheeks, a pointy hat with a
  little star, a scarf, mittens; 12 color schemes; our own style, not a doll in a red suit). Not
  scary, never mischievous in a way that breaks things: they never move or change her blocks or
  furniture.
- **In Holiday Village**: an elf hides at every `holiday:elf` spot. Tap -> giggle, a little
  line, sparkles, "You found Pip! (3 of 12)". Finding all gets a sticker. Hints: a soft jingle
  gets louder near an unfound elf; a "Find the elves" counter appears in the life column there.
- **An elf comes to her house**: once she has met the elves (or from the Bag: a "Twinkle Elf
  doorbell" / sign), an elf moves in to any world where she has a bed. Every new game morning
  (`time:morning`, and on loading a world on a new day) it hides somewhere new in or around her
  home (on a shelf, the fridge, a lamp, a wardrobe, the sofa back, the bath, a tree), sometimes
  with a tiny scene (a snow angel in sugar, a little note, a paper airplane, a pile of cookies).
  Find it and tap: a giggle, a line, a tiny surprise (coins ≤ 10 a day). She can name her elf.
  It is an entity placed and moved through `game.entities` (host only), so friends see it.
- The elves' cottage in Holiday Village (`holiday:elfhome`) where she meets them first.
- Stickers (≤ 3): `elf_first`, `elf_all` (found all in Holiday Village), `elf_home` (found her
  house elf 5 mornings). Test: `tools/test-elves.mjs` (hiding spot picking never inside solid
  blocks, never the same spot twice in a row, works with no furniture, daily caps).

### 7.7 reindeer
- **Reindeer** as a pet species (appended last): adopt from Bag -> Pets, several coat colors,
  antlers, a soft bell collar; pet, feed, ride like the pony. **In Holiday Village a ridden
  reindeer can fly** (Jump to take off, Up / Down while flying, gentle glide and landing; never
  falls: letting go glides down softly).
- **The pasture herd** (`holiday:reindeer`): reindeer that wander inside the pasture (host only,
  synced like pets / NPC actors), tap to pet / feed a carrot / ride.
- **Santa's sleigh** (`sleigh`, appended last to `VEHICLES`, Bag -> Cars & Boats, also placed by
  `holiday:sleigh`): a red-and-gold sleigh with two to four reindeer in front (one model),
  bells that jingle as its horn, a sparkle trail. It drives on land like a car and **flies**:
  Up / Down (the existing fly buttons; keyboard Space / Shift or the existing fly keys) lift
  it, it glides forward in the air, the reindeer's legs gallop, it lands softly when low over
  ground, it never goes through blocks or out of the world (same bounded physics rules as
  `docs/teams/vehicles.md`: every number checked, every loop bounded, never lost). Friends see it
  fly (presence `vh` already carries the car; add a height if needed, carefully, in
  `docs/MULTIPLAYER.md` terms in your Wanted list if the protocol must change).
- Stickers (≤ 3): `reindeer_friend` (petted a reindeer), `reindeer_rider`, `sleigh_ride` (flew
  the sleigh). Test: `tools/test-reindeer.mjs` (and `node tools/test-vehicles.mjs` stays green:
  fly physics bounded, never through blocks, landing finds ground, never lost).

## 8. Checking without a browser

This container has no browser, so nobody can run the Playwright probes or `npm run smoke`.
What every team runs before it says done:

1. `node tools/build.mjs` (the bundle builds; esbuild reports import errors here).
2. `node --test tools/test-name.mjs`, and the existing Node tests near your code:
   `node tools/test-vehicles.mjs`, `node tools/test-sea.mjs`, `node tools/test-merfolk.mjs`,
   `node tools/test-squish.mjs` (all no-browser) must stay green.
3. Your own `tools/test-<team>.mjs` (Node only; import your pure modules; no DOM). Keep pure
   logic (paths, scoring, data normalization, spot picking, physics steps) in files that import
   neither three.js scenes nor the DOM so Node can test them.
4. World teams: `node tools/worldview.mjs <biome> --seed=N [--size=big] [--T=8] [--slice=Y]`
   and look at every picture (Read the PNG). Iterate until it looks amazing.
5. Read your own diff once more as a reviewer hunting for runtime errors: every name imported
   exists, every `game.*` API you call exists with that signature (grep it), nothing runs on a
   guest that must not, nothing throws inside `update(dt)`. Code that only a browser runs gets
   twice the care because nobody can watch it run here.

## 9. Git

Each team works in its own worktree on branch `wave5/<team>` (made by the integrator from the
base commit). Commit there in small commits with clear messages (no trademarked words). Do not
commit `dist/` (run `git checkout -- dist` before committing; the integrator rebuilds it once),
do not push, do not merge, do not touch other worktrees.
