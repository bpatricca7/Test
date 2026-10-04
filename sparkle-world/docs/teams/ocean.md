# Team "ocean": dolphins and sea animals to meet, and a dolphin to ride (wave 4 design)

The request (dad and daughter, 2026-10-04), the part this team owns: *"Also add Dolphins, and sea
animals ..."*. The same message asks for squishies, mystery presents and a sea form (a mermaid
tail for a girl and a cool sea creature for a boy). Those belong to two other teams:
**squishies & presents** and **merfolk** (the sea form, swim controls, any underwater picture).
This document covers the animals that live in the water and on the shore, how a kid finds and
meets them, the dolphin ride, their stickers and coins, multiplayer, saves, costs and tests.
Section 15 lists every touch point with the other two teams.

Status: **DESIGN, revision 2** (nothing built yet; revised after two reviews, see §17). Every
`file:line` is the code as of commit `669b6fa` on branch `claude/girl-game-world-building-gp6bnl`.
The water numbers in §2.1 were measured in Node with the real biome generators (seed 777, Cozy
and Big; the recipe is in §13.1 S0).

Owner files (all new): `src/life/ocean/*`, `tools/test-sea.mjs`, `tools/probe-ocean.mjs`, this
file. The hooks outside the folder are small and listed in §12.2. The folder, the system, the
facade and the debug object are all named **`ocean`**, because the merfolk team already uses
`src/player/sea/`, a system named `sea` and `game.debug.sea` (merfolk.md:314, :907), and
`game.addSystem` keys systems by name (`src/core/game.js:207-210`), so two systems named `sea`
would overwrite each other.

---

## 0. Decisions at a glance

| Question | Decision |
|---|---|
| Which animals | **Nine kinds**, dolphins first: Dolphin (pods of 2 to 4, sometimes with a baby), Little Fish (schools), Sea Turtle, Octopus, Jellyfish, Seahorse, Crab (on the shore), Starfish (seabed and wet sand), and a gentle Whale far out at sea. No sharks, nothing that bites or stings, no fishing or catching. All looks are our own: no stripes on orange fish, no big-grin pink starfish (§3). |
| What they are in code | **Ambient life**, like the butterflies (`src/life/ambient.js:1-5`): a new system `ocean` in `src/life/ocean/`. Not entities, not pets, not Bag items. Nothing is placed, saved in a world, or written to the world. |
| How they look | Cute rounded toy animals with big eyes and blush, built with the pets `Kit` (`src/things/pets/kit.js:41-118`) and drawn as **one `THREE.InstancedMesh` per kind** (9 draw calls at most, usually 2 to 4), with a small vertex shader that bends the body. Lambert lighting and scene fog come for free, so they match pets and furniture by day and night. |
| Can kids see them | **Yes, from the normal swim camera.** The water surface is about 75% opaque (texture alpha 190/255, `src/world/paint/nature.js:99`), so near the player every animal lives **at the surface**: dolphin backs and fins break the water and puff from the blowhole, turtles lift their heads to breathe, fish skip, jelly bells touch the surface, and seabed animals send up bubble trails (§5.1). A probe compares real swim-camera shots with and without sea life (§13.4 V1). |
| Where and when | Driven by a new **sea map** (water depth per column), built at world load like the weather heightmap and kept current by events **and** a round-robin rescan (§4.1). Dolphins need water 3+ deep over a 5x5 area; fish 2+ deep; crabs on shore cells; starfish on shallow seabed and wet sand; the whale out past the world edge. A kid's own pool works: small pools get fish, a big deep pool gets dolphins, with a toast (§3.3). |
| Finding them | A distant **show pod** leaps out at sea whenever deep sea is in view (cosmetic), NPC friends say "I saw dolphins out in the deep water!", and the Help panel has a dolphin card. The first pod reaches a kid within 10 s of her first swim into deep water (§3.3, §7). |
| Behaviour | Dolphins arrive as a pod, swim beside a swimmer or a boat (and play around a kid who stops), leap in arcs with splashes, leap together with a mermaid who leaps. Fish schools scatter and regroup. Turtles glide. Jellies pulse and glow at night. Crabs scuttle sideways and wave. The whale visits twice a game day, plus a first personal visit (§5.8). |
| Meeting them | Tap any animal with any tool. Taps never place or remove anything on an animal, **including the water above an animal under the surface** (new `throughLiquid` pickables, §5.6). It reacts with hearts and a sound; the first time per kind a toast with the animal's **3D picture** says **"You met a Dolphin!"**. Counted in `profile.stats.seaMet`. The Sticker Book gets a **Sea Friends** strip: 9 round slots, a silhouette until met (§7.3). |
| Dolphin ride | Tap a dolphin while swimming: it pops its head up beside the kid, holds still and chirps, and a bubble shows **Ride** (first, biggest) and **Trick**. Ride uses the existing mount contract (`player.mount`, `src/player/player.js:324-335`, state `'ride'`, kind `'dolphin'`). Speed 9.5 (12 running) with a "zoom"; Jump leaps; **Hop off** in the left column. From a stopped boat the bubble also offers Ride. Dolphins stay in deep water and U-turn at the world edge. |
| Sea form while riding | **Joint decision with merfolk (§15): the sea form STAYS while riding a dolphin.** A mermaid or sea dragon lies along the dolphin's back, hands on the fin, tail kicking in time with the dolphin. No turn-back sparkle on mount or on Hop off. "Just Me" uses the saddle pose. |
| Stickers and coins | Five stickers, registered on `game:ready`: **Dolphin Friend**, **Dolphin Rider**, **Sea Explorer** (5 kinds), **Ocean Star** (the first 9 kinds), **Whale Hello!**, +20 coins each. Plus a **small daily sea reward** on the pets precedent: +2 for the first hello to each kind each day, +5 for the first ride each day (at most 23 a day), so sea play keeps feeding the mystery-present path (§8). |
| Multiplayer | **Local cosmetic animals**, plus the moments kids point at are shared: the world's own **buddy dolphin** (name and color from the world seed), the whale's visit time (seed + game day), presence **`sr`** (a friend rides a dolphin) and presence **`sk`** (a friend's dolphin did a trick: every page plays one beside her). No protocol bump, no host authority, nothing in the journal (§9). |
| Saves | **No new profile keys.** `stats.seaMet` (map), `stats.dolphinRides`, `stats.seaCoinDay`, `stats.seaCoinMask` live inside `profile.stats`, which every merge already max-merges key by key, nested maps included (`src/account/merge.js:14-22`, `src/core/storage.js:131-142`). Nothing in world saves. Old saves load unchanged. |
| Append-only lists | `SEA_KINDS` (keys) and each kind's palette list. The **dolphin palette is sent by index** in presence `sr` and `sk`, so it is APPEND ONLY like the look lists. |
| Performance | ≤ 9 extra draw calls (usually 2 to 4), ≤ ~65k triangles at the very most, no per-frame allocation, ≤ +1.0 ms systems stage on the probe machine, shaders pre-warmed behind the loading screen. Nothing lowered; schools near the player are never thinned (§11.2). |

---

## 1. Goals and non-goals

### Goals
1. A kid who swims out from the beach, or steers a boat across the sea, meets dolphins within
   about 10 seconds of reaching deep water, **sees them clearly from the normal swim camera**,
   sees them leap and splash, and can tap one to start a ride.
2. A kid can ride a dolphin: it is **faster than a horse or the Speedboat**, it leaps on Jump, and
   it never strands them (it stops at shallow water, turns back at the world edge, and **Hop off**
   always puts them safely back in the water). A mermaid stays a mermaid on the dolphin.
3. The sea feels alive in every island biome: fish at the surface, turtles coming up to breathe,
   crabs on the shore, starfish on the sand, jellies glowing at night, a whale saying hello.
4. Collecting "who did I meet" is a gentle, **picture-first** goal: a first-meet toast with the
   animal's picture, a Sea Friends strip that shows which ones are still missing, five stickers,
   and a small daily coin reward that never asks for grinding.
5. Two kids playing together both see dolphins, see the same buddy dolphin, see each other's
   tricks and rides, and see the whale at the same moment.
6. Old saves load exactly as before. Picture quality stays the same or better. Nothing new to
   buy, nothing about prices, no personal data.

### Non-goals (v1)
- No sharks or scary animals, no stings, no bites, no ink, no being knocked over. No fishing, no
  catching, no keeping animals, no feeding (a later wave could feed dolphins a fish treat).
- No adopting wild sea animals. The **pet turtle** (`src/things/pets/turtle.js:8-17`, sticker
  "Shell Buddy") is unchanged and stays in the Pets tab; the wild **Sea Turtle** is a different,
  larger animal with flippers (§3).
- No sea life in the Bag, no placing animals, nothing saved in a world.
- No underwater picture (tint, fog, caustics), no dive button and no swim-speed change: those are
  the merfolk team's. The animals are drawn with scene fog, so they follow any underwater fog the
  merfolk team adds without changes here (§11.1).
- No host-owned sea animals (§9.1 explains why).
- No biome-only animals in v1 (a later append: a narwhal in the snow sea, a gentle manta ray;
  §16 Q5).

---

## 2. How the code works today (what this builds on)

### 2.1 Water

- Liquids are any block with `shape: 'liquid'`: `water` (`src/world/paint/nature.js:189`),
  `choco_milk` and `strawberry_milk` (`src/world/paint/candy.js:196-197`). Water does not flow.
  The surface is drawn at `y + 0.875` (`src/world/mesher.js:30`). The only test is
  `Physics.liquidAt` (`src/world/physics.js:82-86`); there is no depth query anywhere.
- **The surface is see-through but not clear.** The water tile is painted at alpha 190/255
  (`nature.js:99`), drawn as one translucent face at the top of a liquid column
  (`mesher.js:166-177`; there are **no faces between two water cells**), and mixed with fog by the
  water material (`src/world/material.js:90`). Seen from above, anything under the surface shows
  at about 25%. Seen from below (a diving mermaid), nothing is in the way. This is why near the
  player the animals live at the surface (§5.1).
- Every island biome floods to `sea: 20` (`src/world/biomes/gen.js:155-163`, `:379-381`), so the
  top water cell is y = 20 and the surface is at 20.875. Candy's sea is **strawberry milk**
  (`candy.js:67`). Flat has no sea (`flat.js:33`, the horizon is grass).
- The horizon ring (`world.outside`, `src/world/chunks.js:122-171`) is liquid 420 blocks beyond
  the edge in every island biome (strawberry milk in Candy). `world.outside` can be **null**
  (`save.outside || null`, `src/core/game.js:634`, `:674`), and its `.block` is a key string, so
  "is it a liquid" needs `registry.byKey(outside.block)` and the shape table. The ring's opaque
  seabed is drawn at the **median edge seabed** (`_edgeSeabed`, `chunks.js:139-166`), measured
  (seed 777): depth 6 in beach, **5** in meadow, candy, snow, fairy and mix. Physics puts an
  invisible wall at the world edge (`physics.js:166-170`), so the player never leaves the world,
  but **wild animals may swim and leap out there** with no voxel queries, above that seabed.
- Measured with the real generators (seed 777, columns whose top block is liquid, by depth):

| Biome | Size | depth ≥ 3 | depth ≥ 5 | from spawn to sea-level water ≥ 4 deep | full-world depth scan, warm |
|---|---|---|---|---|---|
| beach | Cozy 144 | 9,810 | 7,696 | 56 blocks | 1.8 ms |
| beach | Big 208 | 19,695 | 14,887 | 80 | 3.7 ms |
| meadow | Cozy | 6,797 | 4,824 | 61 | 1.7 ms |
| meadow | Big | 12,348 | 9,251 | 89 | 3.8 ms |
| candy | Cozy / Big | 6,709 / 12,378 | 4,798 / 9,252 | 61 / 89 | 1.8 / 3.6 ms |
| snow | Cozy / Big | 6,393 / 11,708 | 4,569 / 8,872 | 61 / 90 | 1.7 / 3.7 ms |

  The first (cold, un-optimised JIT) scan took 3 to 75 ms on the same machine; it runs once at
  world load, behind the loading screen, exactly like the weather heightmap does today
  (`weather.js:213-216`). It is **never** repeated synchronously during play (§4.1).
- The beach **lagoon** (`beach.js:62-64`, `:90`) is a round bay 23 (Cozy) to 33 (Big) blocks from
  spawn whose floor is at `sea - 2.2`, so it is **at most 2 deep**: fish, seahorses, starfish,
  sea turtles and crabs on its rim, but no dolphins. Its channel to the sea is cut to `sea - 1.2`
  (`beach.js:94`), 1 to 2 deep, so dolphins never use it either. Coral grows at depth 1 to 6
  (`beach.js:136-151`). Starfish and seashell **blocks** lie on the sand (`beach.js:38-39`,
  `:166-170`; block def `src/world/paint/garden.js:479`).
- Fog: `far = clamp(worldR * 0.95, 120, 200)`, x 0.7 in rain or snow (`src/life/daynight.js:291`),
  near about 0.3 of that (`:290-312`), so about 137 / 41 (Cozy) and 198 / 59 (Big) on a clear
  day. The deep sea at 56 to 90 blocks from spawn is inside fog far, so a leaping dolphin out
  there **could** be seen from the island; the show pod (§5.2) makes sure one is.

### 2.2 Ambient life, the pattern to copy
- `src/life/ambient.js`: butterflies (instanced, 2 draw calls, `:234-311`), fireflies (1 call,
  `:313-337`), a `SpotScanner` that samples 36 random columns per frame near the player
  (`:14-91`), and a system with `onWorldLoad / onWorldUnload: reset` (`:524-528`). Pools are made
  once, nothing is allocated per frame, `instanceCount` is 0 when idle, `userData.envWarm = true`
  so `daynight.warmUp` precompiles the shaders (`daynight.js:115-140`). It has **no net code**:
  each page shows its own butterflies.
- A vertex-bend Lambert material already exists: `swayMaterial()` patches a
  `MeshLambertMaterial` with `onBeforeCompile` and a `customProgramCacheKey`
  (`src/things/outdoor/models-tree.js:320-345`). The sea material copies this.
- The pets `Kit` bakes boxes, cylinders and balls into one vertex-colored geometry
  (`src/things/pets/kit.js:41-118`), lit by the scene's hemisphere and sun lights.
- 3D thumbnails: `game.thumbs.get(key, build, opts)` renders an `Object3D` to a 96x96 PNG data
  URL, cached by key, queued with a per-frame budget, and disposes the object afterwards
  (`src/core/thumbs.js:1-18`, `:235`; used by furniture `src/things/entities.js:351`).

### 2.3 Tapping things that are not blocks
- `game.pickables` is a Set of `{ object3d, kind, ref, box: THREE.Box3, onUse, onBuild, onRemove,
  hint }` (`src/core/game.js:143`, hit test `:1020-1037`). The Hand runs `onUse`
  (`game.js:1134`), Build runs `onBuild` first (`:1095-1098`), Remove runs `onRemove`
  (`:1125-1127`). The gems use all three for "grab" (`src/life/collectibles.js:251-256`), and the
  hint text shows in the HUD (`game.js:1062`). Reach is 8 (`game.js:145`).
- **Liquids stop the pick ray for the Remove tool and for a right-click** (`game.js:1003`,
  `_tapAt` `:1435`, `_liquidAccept` `:1044-1049`). The voxel ray then ends at the top of the first
  water cell, and every pickable farther than that is skipped (`t >= bestT`, `:1024`). So today a
  Remove tap on a fish under the surface removes the **water** above it. The voxel ray also
  skips the cell the camera is in (`src/world/raycast.js:88-95`), so a camera under water hits the
  next water cell less than a block away. §5.6 fixes both.
- Blocks with `onUse` show `def.hint || 'Tap to use'` as a **string** (`game.js:1065`).
- `removeTarget` waits only while driving a vehicle (`isDriving()`, `game.js:1110-1128`, toast
  "Park first to build!" `:1276-1282`).

### 2.4 Mounts and swimming
- `player.mount(m)` (`player.js:329-335`) sets state `'ride'`; a mount that has
  `seatWorld(out)` seats the player itself (`player.js:96-105`), `beforeStand()` gives the stand
  spot (`:283-290`), `standSpot()` is used by saves (`:400-412`), `overlapsCell` stops blocks being
  built into it. Vehicles are the model (`src/things/vehicles/index.js:325-367`).
- `player.teleport()` (`player.js:370-380`) sets `state = 'walk'` and `mountPet = null` **without**
  calling `beforeStand()`. Vehicles and pets notice this every frame ("her state changed under
  us", `vehicles/index.js:613-614`; `pet.js:578`).
- `game.unstickPlayer()` returns at once while `state === 'ride'` (`game.js:1314`), and is called
  after a friend's edits arrive (`src/net/adapter.js:364`) and after Undo.
- `_onKey` returns early on Space for a vehicle so a double Space does not toggle flying
  (`player.js:53-64`). `_syncAvatar` passes `riding: this.state === 'ride' && !seated`
  (`player.js:207-216`), which picks the saddle pose (`src/player/avatar.js:532-561`).
- The game's own E key runs first: `if (target && tool !== 'hand' && interact(target)) return;
  setTool('hand')` (`game.js:1412-1414`). Vehicles keep the Hand tool while driving and switch
  back any other tool with "Park first to build!" (`vehicles/index.js:955-980`).
- Swimming: `inWater = liquidAt(feet + 0.6)` and `'player:swim'` on entry (`player.js:129-136`);
  swim speed 2.8 (`:11`). The merfolk team changes this block (deep-water gate, dive, sea form:
  mermaid 4.6, 6.2 running).
- Ride speeds today (`pet.js:592`: speed x 1.6, run x 1.45): pony 7.4 (10.7 running), horse 9.0
  (12.8). The Speedboat drives at 9.5 (`vehicles/defs.js:86`).
- `game.vehicles.current` is the internal record; position, yaw, speed and the boat flag are on
  `current.drive` (`pos`, `yaw`, `speed`, `boat`; `vehicles/drive.js:75-89`), not on the record.
  A def's vehicle kind is `defs.get(key).vehicle` (`vehicles/defs.js:85`: `kind: 'boat', water: true`).

### 2.5 Multiplayer facts this design relies on
- Presence fields are written by `avatarFields` (`src/net/host.js:1393-1416`) for host and guests;
  `vh` (`:1415`) is the precedent for an optional field parsed by a pure function
  (`parseVehiclePresence`, `src/net/protocol.js:226-233`). Unknown identifier keys need no server
  change (`server/rooms.mjs:365-372`). Up to 4 players (`MAX_PLAYERS`, `protocol.js:23`).
- `remote-players.js` reads presence in `_ingest` (`:340-372`) and poses friends in `_frame`
  (`:412-484`): `st:'h'` → `riding` unless the friend has a vehicle (`:458-471`).
- Guests follow the host clock `tm` to within 0.01 day (7 s), with forward snaps
  (`src/net/adapter.js:619-650`). A guest's clock stops on `net.hostFrozen`, not on her own
  setting (`game.js:403`). `world.meta.seed` and the blocks are the same on every page (a guest
  gets `seed: save.seed`, `game.js:670`).
- `net:applied` carries `cells: null` when more than 2,048 cells changed (`adapter.js:19`, `:362`).

---

## 3. The sea animals

All models: block units, **nose = +Z**, origin at the body's center (dolphins, fish, turtles,
jellies, seahorses, whale) or at the feet (octopus, crab, starfish). Built once per kind with
`SeaKit` (§4.2), cached, never disposed. Eyes are glossy dark balls with a white highlight ball;
every animal has two pink blush dots. Sizes are the adult size; a baby dolphin is the same
geometry at scale 0.6.

| key (append-only) | Name kids read | Size | Look | Body bend | Tap reaction | Sound |
|---|---|---|---|---|---|---|
| `dolphin` | Dolphin | 1.9 long | Smooth rounded body, pale belly (accent), short beak with a small smile line, big round forehead, dorsal fin, two flippers, V-shaped tail flukes. A small star saddle shows **only on a ridden dolphin** (§4.2 flags). | `kick`: tail beats up and down | Swimming within 5 blocks: pops its head up beside the kid, chirps, the Ride / Trick bubble (§6.1). Otherwise a trick (next in the order spin, flip, tail-walk), sparkles, hearts | `chirp` (clicks and a rising whistle) |
| `fish` | Little Fish | 0.32 long, schools of 6 to 10 | Round pastel body with **three small accent dots** on each side (never stripes), fan tail, side fins. | `wiggle`: side to side | The whole school scatters, bubbles, regroups after 3 s | `bloop` |
| `sea_turtle` | Sea Turtle | shell 0.9 | Domed shell with lighter hexagon scutes on top (accent), a cream belly, a round smiling head, long front flippers, short back flippers. Not the pet turtle: no legs, flippers instead. | `flap`: flippers row | A slow barrel roll, hearts; then it glides beside the player for 10 s | `bloop` (pitch 0.7) |
| `octopus` | Octopus | 0.8 tall | Big round head with a little crown of spots (accent), eight curly tentacles of three balls each. | `curl`: tentacle tips sway | Changes to its next color with a pop, waves all arms, puffs sparkly bubbles (never ink), scoots 2 blocks | `pop` + `giggle` |
| `jelly` | Jellyfish | bell 0.5, 1.0 tall | Rounded bell with a frilly rim of small balls (accent), four ribbon arms, six thin tentacles. The bell glows softly at night. | `pulse`: the bell squeezes, tentacles trail | The bell glows bright, it bobs up with three pulses | `boop` |
| `seahorse` | Seahorse | 0.5 tall | Upright, round belly (accent), snout, little crown spikes, curled tail, a fluttering back fin. | `flutter`: back fin | Twirls once, sparkles | `ding` (pitch 1.4) |
| `crab` | Crab | 0.5 wide | Round flat shell, eyes on stalks, two big claws, six legs. | `snip`: claws open and close, legs tick | Waves both claws, hops sideways, hearts; a crab hiding in the sand pops back out first (§5.5) | `clack` |
| `starfish` | Starfish | 0.5 across | Five plump arms with white dots and two blush dots, two small eyes, a **tiny** smile (no wide grin). Orange by default. | `curl`: arm tips lift | Waves its arms, star particles | `giggle` (pitch 1.3) |
| `whale` | Whale | 8 long | The dolphin's gentle big cousin: wide rounded head, small eyes with blush, belly stripes, broad flukes. | `kick`, slow | Not tappable (always far out); it surfaces, spouts and waves its tail | `whale` (a low soft hum and a spout whoosh) |

The **existing Starfish block** (`garden.js:479`) also says hi: a Hand tap on it plays the
starfish reaction (sparkles and the giggle, the block itself does not move) and counts as meeting
a Starfish (§5.7).

**Our own looks, not famous ones.** Kids name what they see out loud, and the owner's rule bans
other companies' character designs. So: no white bands on an orange or peach fish (the dots are
a pale gold accent on those palettes), no pink starfish with a big face, no red crab with a
mouth, no blue fish with a yellow tail. Every gallery shot (§13.4 C5) gets a "does this look like
a famous character?" check with the owner before step 4 starts.

### 3.1 Model recipes (dolphin in full; the others in the same style)

The dolphin, nose +Z, origin at the body's center. `T` = tinted by the palette body (mask 1),
`A` = tinted by the palette accent (mask 2), fixed colors are mask 0. `along` (the bend weight)
is computed per vertex from z: `clamp((0.6 - z) / 1.8, 0, 1)`. Each `part()` also records its
**pivot** (the root point its limb bends about, §4.2 `aPivot`).

```
ball 0.32, scale [0.9, 0.85, 2.6]      at (0, 0, 0)            T  body
ball 0.27, scale [0.8, 0.6, 2.3]       at (0, -0.08, 0.05)     A  belly
ball 0.24                              at (0, 0.06, 0.6)       T  forehead
cyl  r 0.09, h 0.32, rot [PI/2, 0, 0]  base at (0, -0.04, 0.8) T  beak; ball 0.09 at its tip
cbox 0.14 x 0.015 x 0.02               at (0, -0.05, 1.0)      #5A4A6A  smile line
ball 0.055 x2                          at (+-0.17, 0.10, 0.72) #2A1B33  eyes
ball 0.02 x2                           at (+-0.19, 0.13, 0.75) #FFFFFF  eye shine
ball 0.045, scale [1, 0.6, 0.4] x2     at (+-0.20, 0.00, 0.68) #FF9EC4  blush
cbox 0.05 x 0.30 x 0.28, rot [-0.5,0,0] at (0, 0.32, -0.1)     T  dorsal fin
cbox 0.32 x 0.04 x 0.16, rot [0,0,+-0.5] at (+-0.30, -0.12, 0.3) T  flippers (limb 1, pivot (+-0.16, -0.12, 0.3))
ball 0.16, scale [0.8, 0.8, 2]         at (0, 0, -0.82)        T  tail stock
cbox 0.30 x 0.04 x 0.20, rot [0,+-0.4,0] at (+-0.16, 0, -1.12) T  flukes (V)
cbox 0.30 x 0.05 x 0.34                at (0, 0.30, 0.18)      #FFD84D  saddle seat (limb 3)
cbox 0.16 x 0.16 x 0.03, rot [0,0,PI/4] at (0, 0.36, 0.36)     #FF5FA2  saddle star (limb 3)
```
Ball segments: 12 for the dolphin and whale, 8 for everything smaller (fish, seahorse, starfish,
crab legs). About 2,250 triangles per dolphin, 420 per fish. The whale is the dolphin recipe
stretched (scale [4.2, 3.6, 4.2], beak replaced by a wide round head ball, white belly stripes as
thin cboxes, no saddle), so it costs one more cached geometry, not a new style.

The others follow the table in §3 with the same parts vocabulary (balls for bodies, cbox for
fins and flippers, a cyl with `topRatio 0` for the seahorse's crown spikes). Limb ids (§4.2):
1 = flippers / claws / back fin, 2 = legs / tentacles / arms, 3 = the dolphin's saddle.

### 3.2 Palettes (append-only lists, `src/life/ocean/kinds.js`)

Each list is `[key, body, accent]`. Index 0 is the default. Both colors are used: body for mask 1
parts, accent for mask 2 parts (belly, dots, scutes, crown spots, rim). There is **no variant
geometry**: a palette only changes the two tints. **The dolphin list is sent by index in presence
`sr` and `sk`, so it is APPEND ONLY** (the same rule as the look lists,
`src/player/wardrobe-data.js:6-9`); the others are append-only by convention. Nothing has shipped
yet, so this revision's changes to the lists are free; from step 2 on the S7 guard pins them.

| kind | palettes (key: body / accent) |
|---|---|
| dolphin | `sky` #8EB8E0 / #F7FBFF · `lilac` #B9A8F0 / #F6F2FF · `rose` #F7A8C8 / #FFF4F8 · `mint` #9EE3CF / #F4FFFB · `silver` #C9D3E0 / #FFFFFF · `bubblegum` #FF9CCB / #FFF0F7 (candy) · `cotton` #C8B4FF / #FFF7FF (candy) · `snowy` #F2F6FA / #FFFFFF (snow) · `deep` #3F7FBF / #EAF4FF · `teal` #2FA3A0 / #E8FFFB |
| fish | `coral` #FF8FB1 / #FFE3EC · `sunny` #FFD166 / #FFF6D6 · `sky` #8FD3FF / #E6F6FF · `grape` #B49CFF / #EEE6FF · `mint` #7FE0C2 / #E3FFF5 · `peach` #FFA36C / #FFE08A · `pearl` #F5F5FF / #D9D6FF · `koi` #FF9F43 / #FFE08A (ponds) · `fairy` #E9B8FF / #FFF2FF (fairy ponds, glows at night) · `candy` #FF7AB8 / #FFF27A (candy, sprinkle-yellow dots) |
| sea_turtle | `ocean` #3FB8C8 / #BFF0F5 · `leafy` #5FB86A / #D6F5C8 · `coral` #FF9CC8 / #FFE0EE · `lilac` #9C86E8 / #E6DEFF · `midnight` #34508C / #A9C2F0 |
| octopus | `coral` #FF8FA3 / #FFE0E6 · `lilac` #C3A6FF / #F0E8FF · `peach` #FFB38A / #FFE6D6 · `mint` #8FE3C8 / #E3FFF5 · `sunny` #FFD866 / #FFF6D0 |
| jelly | `pink` #FFB8D6 / #FFE6F1 · `lilac` #D9C8FF / #F4EEFF · `aqua` #A6F0FF / #E6FCFF · `peach` #FFD1B0 / #FFF0E3 · `gummy` #FF8CC6 / #FFD6EC (candy) |
| seahorse | `sunny` #FFD866 / #FFF6D0 · `pink` #FF9CC8 / #FFE6F1 · `orange` #FFA36C / #FFE6D6 · `lilac` #C3A6FF / #F0E8FF |
| crab | `red` #FF7A6B / #FFD6CF · `pink` #FF9CC8 / #FFE6F1 · `candy` #FFB3D9 / #FFF0F7 |
| starfish | `orange` #FF9F5A / #FFE6D0 · `coral` #FF8F7A / #FFE3DC · `lilac` #C9B2FF / #F2ECFF · `yellow` #FFD43B / #FFF6C8 |
| whale | `blue` #7FA7D6 / #F2F6FA · `grey` #A9B6C8 / #F2F6FA · `white` #F2F6FA / #FFFFFF (snow) · `berry` #E8A3D0 / #FFF0F7 (candy) |

Biome choice: Candy uses only the candy palettes where a kind has one (else the default list);
Snow's dolphins and whale use `snowy` / `white` half of the time; fairy ponds use `fairy` fish.
`deep` and `teal` dolphins and `midnight` turtles are in the normal draw (about 1 in 5 each),
so the sea has a few cooler, bolder animals too, and the buddy dolphin (§5.2) can be one.

### 3.3 Where and when (spawn rules)

"Near" is measured from the player (or from the boat she drives). Sampling comes from the sea map
(§4.1), so every rule is an O(1) column read. **Ring with fallback**: every kind has a preferred
spawn ring; if no qualifying cell lies in the ring after the frame's samples (24 columns), the
spawner takes the **farthest qualifying cell at least `min` blocks away** among the cells it has
seen in the last 2 s (a 16-entry ring buffer per kind, no allocation), preferring cells behind the
camera, and the animal arrives with a splash (a leap for dolphins, a bubble puff for fish).

| kind | water / place | depth rule | how many | when | ring (fallback min) | leaves when |
|---|---|---|---|---|---|---|
| dolphin | any liquid at its own top level (sea, a kid's pool; not the lagoon or its channel) | ≥ 3 at the column, and ≥ 3 at 8 of 9 samples on a 5x5 grid (stride 2) around it | 1 pod of 2 to 4 including a baby (25%) | always; at night a new pod comes half as often | 30 to 40 (6); needs the player swimming, in a boat, or within 30 blocks of qualifying water. **First deep swim of a session**: 20 to 25 blocks, sprinting, so it reaches her within 10 s | the player is > 45 blocks from the pod for 20 s; swims away and fades out beyond 40 blocks |
| show pod (dolphin, cosmetic) | deep columns or the horizon ring, in view | as dolphin | 1 pod of 2 or 3 | daylight > 0.2; whenever deep sea lies inside 0.8 x fog far and inside the camera's view, and no real pod is within 30 blocks | 45 blocks to 0.8 x fog far, inside the view cone | out of view for 10 s, or a real pod arrives |
| fish | any liquid, ponds included | ≥ 2, and the 3x3 around is liquid | up to 3 schools of 6 to 10 (low quality: 3 to 5) | day full; night half | 8 to 22 (4) | > 30 blocks away (fade) |
| sea_turtle | sea-level liquid | ≥ 2 | up to 3, one at a time every 40 to 70 s | daylight > 0.3 | 14 to 26 (6) | > 34 blocks, or night (dives and fades) |
| octopus | the seabed: a solid block under liquid | water above 2 to 6 deep; on the beach prefers a coral cell within 2 | up to 2 | always | 10 to 24 (4) | > 30 blocks |
| jelly | sea-level liquid | ≥ 3 | night up to 8 (low 4), day up to 2 | always (night more, glowing) | 10 to 26 (4) | > 32 blocks, or day comes (a night jelly sinks and fades) |
| seahorse | near coral or on any shallow seabed | 2 to 5 | up to 6 | daylight > 0.3 | 6 to 18 (3) | > 24 blocks |
| crab | a **shore cell**: a solid, non-liquid top block at y = level or level + 1 next to (4-neighbour) a liquid column | — | up to 6 | daylight > 0.2, not in snow weather | 6 to 20 (3) | > 26 blocks |
| starfish | shallow seabed (water 1 to 3 deep) or a shore cell of sand | — | up to 12 | always | 4 to 20 (2) | > 26 blocks |
| whale | the horizon ring 12 to 40 blocks past the world edge (any biome whose `world.outside` is a liquid); else none | — | 1 | two shared visits per game day, plus one personal first visit (§5.8) | §5.8 | after its 30 s visit (dives) |

**Dolphin slots.** A new pod spawns only when the free wild slots are at least the pod's size
plus 1; the baby counts inside the pod. A ridden dolphin keeps its wild slot. The show pod has
its own 3 slots; the 3 friends' ride slots are reserved (§4.2).

**A kid's pool.** The sea map marks columns that became liquid through `block:place` or
`net:applied` this session (`placed` bit, §4.1); in Flat every liquid counts. The first time a
fish school or a dolphin pod spawns in such water in a world session, a toast with the animal's
picture says **"Fish moved into your pool!"** or **"Dolphins came to your pool!"**. A 5x5x2 pool
gets fish while the kid stands beside it (fallback min 4: the far side of the pool); a 17x17x4
pool gets a pod (fallback min 6).

Biomes: **beach** has everything (the lagoon: fish, seahorses, starfish, sea turtles; crabs on its
rim). **meadow, fairy, mix, snow**: the same along their sea ring; their ponds get only fish (the
snow pond is 93% ice-capped, `gen.js:217`, so a column topped with ice is not water to the sea map
and fish only appear in its open holes). **candy**: the same animals in candy palettes in the
strawberry-milk sea and the chocolate-milk pond. **flat**: none at first; a kid-built pool gets
fish (2+ deep, 3x3) and, if big and deep enough for the dolphin rule, a dolphin pod. The whale
only appears where the horizon ring is liquid (not flat).

---

## 4. Data shapes

### 4.1 `SeaMap` (`src/life/ocean/seamap.js`, pure: no THREE, Node-testable)

```js
class SeaMap {
  attach(world, reg)        // reg = { props, liquidIdOf(key) }; full scan (world load only)
  detach()
  setColumn(x, z)           // rescan one column now (block:place / block:remove / net:applied cells)
  markAllDirty()            // net:applied with cells === null: every row rescanned by tick()
  tick(rows = 2)            // rescan the next `rows` rows in turn (dirty rows first); bounded
  top(x, z)                 // y of the top liquid cell of the column, or -1 (none / capped)
  depth(x, z)               // liquid cells from top() down, 0..15 (capped)
  bed(x, z)                 // y of the solid cell under the liquid, or -1
  placed(x, z)              // true: became liquid this session through an edit (pool toast)
  shore(x, z)               // true: top block solid, not liquid, at level or level+1, next to a liquid column
  deepAround(x, z, need=3)  // the 5x5 stride-2 rule of §3.3 (9 reads)
  inBounds(x, z)            // inside [1, sx-1] x [1, sz-1]
  outside()                 // { liquid, level, depth } for out-of-bounds columns
  stats()                   // { ms, liquid, deep, shallow, ticks } for the probe
}
```
- Storage: `top`, `depth` and `flags` as `Uint8Array(sx * sz)` (255 = none); 3 x 43 KB for Big,
  plus a `Uint8Array(sz)` of dirty rows.
- A column counts only if its **top non-air block is a liquid** (ice, a lily pad block or a
  bridge over the water makes it not-water, which is what we want: nothing swims under ice and
  nothing leaps into a bridge). Lily pads: `lily_pad` is a `carpet` block (`garden.js:477`,
  `:480`) in the air cell above the water (`gen.js:218`); the scan skips `carpet` shapes (also
  seashells and starfish blocks on sand) before the liquid test, so ponds with lily pads still
  count and a starfish on sand leaves a shore cell.
- **Outside.** `attach` computes the outside the way `_edgeSeabed` does (`chunks.js:144-166`):
  the median depth of the edge columns (every second one) that end in the outside liquid. If
  `world.outside` is null, or `registry.byKey(outside.block)` is missing or not
  `SHAPES.liquid`, then `{ liquid: false }` and no out-of-bounds column is water. Otherwise
  out-of-bounds columns report `top = floor(outside.surface)` and that median depth (6 in beach,
  5 elsewhere today), and every creature out there is clamped to `bed + 1.3` (§5.1).
- **Keeping it current.** Edits with events update one column at once: `block:place`,
  `block:remove`, `net:applied` (its `cells`; with `cells === null` it calls `markAllDirty()`,
  never a synchronous full scan during play). Many edits send **no event**: Undo / Redo
  (`_casSet`, `game.js:1212-1215`), Magic House / prefab placement and its undo
  (`src/things/prefabs/place.js:404`, `:422`), garden tilling (`src/things/garden.js:281-293`),
  entity placement clearing a cell (`src/things/entities.js:473`), a guest's local undo of
  predicted cells (`adapter.js:435`). So, like the weather heightmap's round-robin
  (`src/life/precip.js:78-90`), the ocean system calls `map.tick(2)` every frame: 2 rows (about
  0.04 ms), a full Big world every 104 frames (1.7 s at 60 fps, 3.5 s at 30 fps), dirty rows
  first.
- Things that must never be wrong for even a frame read the world directly as well: each
  creature's own cell check (§5.1), the ride's own cell and the cell ahead (§6.3), and the leap
  arc (§5.2, §6.3) use `world.get` + the shape table, not only the map.
- Every loop is a `for` with a fixed bound (no `while`), as `tools/test-vehicles.mjs:461-470`
  enforces for vehicles.

### 4.2 `SeaKit` and the creature buffers (`src/life/ocean/models.js`)

`class SeaKit extends Kit` (no change to `pets/kit.js`): `part(mask, limb, pivot)` sets the mask,
limb and pivot for the following primitives; `geometry()` calls `super.geometry()` and then writes
two more vertex attributes by walking the same parts in the same order (each part's vertex count
is its template's count, `kit.js:63-68`): `aSea = vec3(along, mask, limb)` and `aPivot = vec3`
(the part's root, in the animal's own space). `along` comes from a per-kind function of the
vertex position (§3.1).

Per kind, one `THREE.InstancedMesh(geometry, seaMaterial(mode), capacity)`:

| attribute | type | per | meaning |
|---|---|---|---|
| `instanceMatrix` | mat4, `DynamicDrawUsage` | instance | position, yaw / pitch / roll, scale (built with one scratch `Matrix4`, `Quaternion`, `Euler`) |
| `iSwim` | vec4, `DynamicDrawUsage` | instance | phase (radians), amplitude, extra (turn bend or curl amount), shade (depth dim, 0.6..1) |
| `iTint` | vec4, `DynamicDrawUsage` | instance | rgb = palette body color (linear), w = glow (0 for most; jellies and fairy fish at night; a tap flash) |
| `iAcc` | vec4, `DynamicDrawUsage` | instance | rgb = palette accent (linear), w = flags (1 = saddle shown) |
| `aSea` | vec3 | vertex | along (0 head .. 1 tail, or radial 0 .. 1), tint mask (0 fixed, 1 body, 2 accent), limb id (0..3) |
| `aPivot` | vec3 | vertex | the root of the vertex's part, for limb bends |

**Slots are compacted every frame.** The stepper writes the live records of a kind into slots
`0..n-1` in record order and sets `mesh.count = n`. A `slotOwner[]` array (`Int16Array`) remembers
which record each slot showed last frame; `iTint` / `iAcc` are rewritten for a slot only when its
owner changed or the record's `tintVer` changed (a palette pop, a glow change), so colors never
scramble after a despawn. Each frame: `instanceMatrix.addUpdateRange(0, n * 16)`,
`iSwim.addUpdateRange(0, n * 4)` and `needsUpdate = true`; the two tint attributes get a range only
when something changed. All four instance attributes are created with
`setUsage(THREE.DynamicDrawUsage)` (three r186 defaults `instanceMatrix` to static).

Capacity (instances) per kind: dolphin 12 (6 wild, the ride keeps its wild slot; 3 show pod; 3
friends' rides), fish 30, sea turtle 3, octopus 2, jelly 8, seahorse 6, crab 6, starfish 12,
whale 1. `mesh.visible = count > 0`; `frustumCulled = false` (instances spread over the sea, like
the butterflies); `userData.envWarm = true`; names `sea-dolphin`, `sea-fish`, ... so the probe's
per-group draw-call breakdown (`tools/probe-vehicles.mjs:245-278`) can list them.

**Thumbnails.** `thumbFor(kind, variant)` → `game.thumbs.get('sea:' + kind + ':' + variant,
build, { dir: [1.0, 0.6, 1.4], zoom: 0.85 })`, where `build` makes a plain `Mesh` from a **clone**
of the kind's geometry with the palette baked into its color attribute on the CPU and a
`MeshLambertMaterial({ vertexColors: true })` (thumbs disposes the clone after rendering,
`thumbs.js:235`; the cached instancing geometry is never touched). The nine default thumbnails
are requested at `'low'` priority on `game:ready`, so they are ready before the first meet.

### 4.3 The kinds table (`src/life/ocean/kinds.js`)

```js
export const SEA_KINDS = ['dolphin', 'fish', 'sea_turtle', 'octopus', 'jelly', 'seahorse',
  'crab', 'starfish', 'whale'];                    // APPEND ONLY
export const OCEAN_STAR_KINDS = 9;                 // Ocean Star = the first 9 SEA_KINDS, forever
export const SEA_NAMES = { dolphin: 'Dolphin', fish: 'Little Fish', sea_turtle: 'Sea Turtle',
  octopus: 'Octopus', jelly: 'Jellyfish', seahorse: 'Seahorse', crab: 'Crab',
  starfish: 'Starfish', whale: 'Whale' };
export const SEA_SPEC = {   // numbers from §3.3 and §5, one object per kind
  dolphin: { cap: 12, wild: 6, show: 3, depth: 3, near: [30, 40], min: 6, leave: 45,
             speed: 4.2, sprint: 11, mode: 'kick', sound: 'chirp', day: 1, night: 0.5 },
  ...
};
export const PALETTES = { dolphin: [['sky', '#8EB8E0', '#F7FBFF'], ...], ... };  // §3.2
export const DOLPHIN_NAMES = ['Splashy', 'Wavy', 'Twirl', 'Breezy', 'Ripple', 'Swish', 'Zoomy',
  'Seafoam', 'Tumble', 'Glide', 'Drizzle', 'Skimmer'];
export const SEA_TEXT = { ... };                   // every string kids read (§7), for the S9 scan
```
Dolphin names are dolphin-only everyday words: none is a pet name already in the game
(`src/things/pets/species.js`, `turtle.js:12`), none is a famous film, show or game character
(checked by the S9 scan, §13.1). A grown-up still reads the final list before shipping (§16 Q4).
Each dolphin in a pod gets a name (no repeats within a pod); the name shows in the Ride / Trick
bubble and in the buddy toast.

### 4.4 A creature record (pooled, made once)

```js
{ on, kind, x, y, z, vx, vy, vz, yaw, pitch, roll, scale,
  state /* 'swim' | 'leap' | 'trick' | 'escort' | 'play' | 'hold' | 'leave' | 'rest' | 'scatter' | 'hide' | 'ride' | 'show' */,
  t /* time in state */, phase, amp, variant, tintVer, glow, name, buddy, level /* water top y */,
  pod /* index */, tx, ty, tz /* target */, fade /* 0..1 */, puffT /* next breath / bubble */,
  box: THREE.Box3, pickable, inSet }
```
Creatures are records in fixed arrays per kind; spawning takes a free record, despawning sets
`on = false` (slots are compacted, §4.2). Each record's pickable object (and its `Box3`) is made
once. **The box is moved every frame** for every record in the set (6 float writes, no
allocation), so a dolphin at 11 blocks/s is never missed. Adding to and removing from
`game.pickables` happens at 4 Hz, only while the record is within 12 blocks of the player, so the
pick loop at `game.js:1020` stays short. `game.pickables.clear()` runs in `_enterWorld` before the
systems' `onWorldLoad` (`game.js:726`) and after `onWorldUnload` (`:793`), so every record's
`inSet` is reset to false in **both** hooks. Show-pod dolphins never get a pickable.

### 4.5 Profile (no new keys)

```js
profile.stats.seaMet = { dolphin: 3, fish: 1, starfish: 2 }  // hellos per kind, capped at 999
profile.stats.dolphinRides = 2                                 // rides started
profile.stats.seaCoinDay = 20261004                            // yyyymmdd of the last sea coin (only grows)
profile.stats.seaCoinMask = 0b1000000101                       // that day: kinds paid (bits 0..8), ride paid (bit 9)
```
Created lazily on the first meet / ride / coin (as `stats.rainbow` is, `src/life/stickers.js:253-258`).
Both merges already take the per-key maximum for nested maps inside `stats`: the cloud merge's
`maxNumbers` recurses (`src/account/merge.js:14-22`, used at `:51`), and so does the backup merge
(`src/core/storage.js:131-142`). `stats` is already in `BACKUP_PROFILE_KEYS` (`storage.js:86`).
Max-merging the coin mask can at worst repay one hello on a second device the same day (2 coins);
nothing can be farmed. Every change to these counters is followed by `game.saveProfile()`
(debounced at 400 ms, `game.js:548-557`), from `greet()` and from the ride start.

### 4.6 Presence `sr` and `sk` (new, optional)

| field | type | meaning |
|---|---|---|
| `sr` | int 0..15 or null / absent | the player rides a dolphin; the value is the dolphin palette index (§3.2, append-only) |
| `sk` | int 0..65535 or null / absent | the player's dolphin trick counter: `(n % 4096) * 16 + variant`, `n` grows by one per trick she started with a tap or the Trick button, `variant` the dolphin's palette index |

`parseSeaRide(v)`: `isIntIn(v, 0, 15) ? v : null`; `parseSeaTrick(v)`: `isIntIn(v, 0, 65535) ? v : null`
(both in `protocol.js`). About 6 bytes each, sent on change only. With `st:'h'`, `sr` means "riding
a dolphin"; `'h'` with `vh` is driving; `'h'` with neither is a pony ride (today's meaning,
unchanged). A rider keeps `st:'h'` even in sea form (§15).

### 4.7 Events (local, never sent)

```
'sea:meet'    { kind, first, quiet }  a hello (tap, Starfish block, whale seen); quiet = a sticker popped for it
'sea:ride'    { variant }             a dolphin ride starts
'sea:hopoff'  { reason }              'button' | 'key' | 'stand' | 'water' | 'blocked' | 'lost' | 'unload'
'sea:leap'    { riding }              a dolphin leaps (riding: with the player on it)
'sea:trick'   { variant }             a dolphin trick the player started (drives presence sk)
'sea:whale'   { personal }            the whale is placed and surfaces
```

### 4.8 `game.ocean` facade and `game.debug.ocean`

```js
game.ocean = {
  map,                                   // the SeaMap
  get riding() {},                       // true while the player rides a dolphin
  rideField(),                           // presence sr: player.mountPet === ride.mount ? variant : null
  trickField(),                          // presence sk: the counter, or null before the first trick
  remoteRide(peer, variant, x, y, z, yaw, speed, visible),  // stores a friend's ride pose; variant null = remove
  remoteTrick(peer, value, x, y, z),     // a friend's sk changed: play a trick beside her
  hopOff(reason),
  near(kind, x, y, z, r),                // nearest live creature of a kind within r, or null (no allocation)
  nearAny(x, y, z, r),                   // kind of the nearest live creature within r, or null
  nearDeep(x, z, r),                     // true if dolphin water lies within r (16 x 4 samples, cached 1 s)
  met(kind),                             // profile.stats.seaMet[kind] || 0
  thumb(kind, variant),                  // promise of the picture's data URL (§4.2)
};
game.debug.ocean = {
  spawn(kind, x, y, z, { variant, n }), clear(), pause(on), count(), list(kind),
  deepSpot(), lagoonSpot(), shoreSpot(), edgeSpot(), mapStats(),
  tap(kind),                             // the tap reaction on the nearest of a kind
  ride(), hopOff(), rideState(),         // { x, y, z, yaw, speed, level, leaping, uturn }
  whaleNow(), whaleTime(day, k), whaleState(),  // force a visit; the shared schedule; { phase, placed, latched }
  gallery(),                             // all nine models in a row in front of the camera (screenshots)
  stats(),                               // { leaps, leapApex, spawns, despawns, nanResets, puffs, mapTicks }
};
```
`remoteRide` only **stores** the pose (no allocation); the ocean system writes it into the
dolphin mesh on its next update, so a friend's dolphin lags her by one frame. This is because
the `net` system (`remote-players._frame`) runs after the ocean system in install order.

---

## 5. Behaviour and motion (`src/life/ocean/motion.js`, pure over `{ map, world, rand }`)

All steppers take `dt` clamped to 0.05 s, sanitize every number each step (a non-finite value
resets the record to its last good pose and bumps `stats().nanResets`), and use bounded loops
only. Positions are block units; the water surface of a column is `top + 0.875`.

### 5.1 Water rules (every swimmer)
- **Near the player they live at the surface** (the water is about 75% opaque from above, §2.1).
  Within 20 blocks of the player:
  - dolphins cruise and escort with their center at **surface - 0.25 to -0.35**, so the back and
    the dorsal fin break the water; every 4 to 6 s each puffs from the blowhole (`splash` x 3,
    straight up 0.6, a soft `pff`);
  - sea turtles swim at surface - 0.3 to -0.8 and come up to breathe every 6 to 10 s (head and
    shell top out for 1.2 s, a small ripple);
  - fish schools stay **0.15 to 0.4** below; every 3 to 6 s one fish skips out in a 0.4-high arc
    with a ripple (`splash` x 2, quiet);
  - jelly bells touch the surface (bell top at surface - 0.05), tentacles hang below;
  - seabed animals (octopus, seahorse, starfish under water) send up a thin bubble trail every 2
    to 3 s (`bubble` x 3 rising to the surface), so a kid knows where to look or dive. A merfolk
    diver sees them clearly (no faces between water cells).
  Farther than 20 blocks, swimmers may go deeper (dolphins 0.6 to 1.2, turtles 0.8 to 2), which
  nobody can see anyway.
- **Depth dim**: `iSwim.w` (shade) = 1 for every animal within 10 blocks; beyond that
  `clamp(1 - 0.07 * depthBelowSurface, 0.6, 1)`.
- Before moving, the stepper reads the column ahead (`x + vx * 0.4`, `z + vz * 0.4`). If it fails
  the kind's depth rule or its `top` differs from the creature's `level`, the creature does not
  enter: it turns toward the best of 8 directions sampled 2 blocks away (bounded: 8 reads), and
  slows to 30%.
- Vertical bounds: a swimmer stays between `bed + 1.3` and its surface band above. Only a leap, a
  breath or a skip goes above the surface.
- Every 0.25 s each creature re-checks its own cell **with `world.get`** (not the map). If it is
  no longer liquid (a kid built into it, a Magic House landed on it), it pops to the nearest liquid
  neighbour within 2 blocks with a bubble puff, or fades out. Combined with `map.tick` (§4.1), a
  house dropped on the sea is cleared of animals within one second.
- The world edge: wild animals may swim outside the world into the horizon ring
  (`SeaMap.outside()`), never below the ring's `bed + 1.3`; the ride may not (§6.3).

### 5.2 Dolphins
- **Pod**: a leader follows a slow wander target (a new point 8 to 14 blocks ahead on qualifying
  water every 4 to 7 s); the others hold offsets 1.6 to 2.4 blocks to the side and behind, with
  their own phase. The baby holds 0.9 blocks beside one adult.
- **Buddy dolphin.** Every world has one: its name and palette come from `h01(world.meta.seed)`
  (`DOLPHIN_NAMES[h % 12]`, a palette of that biome's draw), the same on every page. It leads the
  first pod of each world session, and the first time that pod comes within 6 blocks a toast with
  its picture says **"Splashy came to say hi!"**. Nothing is saved; the seed makes it come back.
  The other pod members are random.
- **Cruise**: speed 4.2, at the surface band of §5.1, tail kick rate `2.2 + speed * 0.5` Hz, pitch
  follows `vy`, roll leans into turns (max 0.35 rad).
- **Escort**: when the player swims within 25 blocks, or drives a boat over qualifying water
  within 30 blocks, the pod targets offsets beside them: left / right at 2.2 blocks, 1.0 ahead; a
  boat at speed gets them at the bow, 1.6 to the sides. They match the target's velocity (up to
  `sprint` 11, so they can race ahead of a Speedboat at 9.5) and never come closer than 1.5
  blocks. The boat's pose comes from a new read-only getter on the vehicles facade,
  `game.vehicles.pose()` → `{ x, y, z, yaw, speed, boat }` or null (§12.2), which reads
  `current.drive`. Friends can be escorted too when the local player is not in the water: from
  `game.seaSwimmers()` when merfolk provides it, else from `game.net.remote.friends` values with
  `st === 'i' || st === 'm'`, and friends' boats (`vh` set and
  `game.vehicles.defs.get(f.vh[0])?.vehicle?.water === true`); at 4 Hz, no allocation.
- **Play** (a slow or still swimmer, speed < 1.5 for 1 s): the pod circles her at 2.5 blocks,
  and one dolphin leaps every 3 to 6 s **regardless of speed**, so a "Just Me" swimmer (2.8) and a
  kid who just floats both get the show.
- **Leap together**: on merfolk's `'player:leap'` (the mermaid's own leap), every escorting or
  playing dolphin with a clear arc leaps beside her within 0.2 s.
- **Leap**: when cruising or escorting at speed > 3 (or in play, above) and the column 3 to 5
  blocks ahead qualifies and 4 air cells above the surface along the arc are free (`world.get`,
  bounded: 4 columns x 4 cells), a dolphin leaps every 3 to 7 s (escorting a boat: every 2 to
  4 s). Exit speed 7.0 up at 35 degrees pitch, gravity 14: apex about 1.75 above the surface,
  about 1.0 s in the air, a full 1.5 rad pitch-over. Splash particles
  (`game.particles.emit('splash', ...)`, count 10) at exit and entry, `bubble` x 4 under the
  entry, the core `splash` sound at `volume = clamp(1 - d / 40, 0, 1)`.
- **Tricks** (from the Trick button, or a tap when Ride is not offered, in order, then
  repeating): `spin` (straight up 2.2, a full roll, back down), `flip` (a forward somersault arc),
  `tailwalk` (rises half out, moves backward 2 blocks on its kicking tail for 1.6 s, chirping). A
  trick needs 3 air cells above; without them it does a roll at the surface instead. Sparkles at
  the top, hearts at the end. A trick the player started emits `'sea:trick'` (presence `sk`).
- **Hold** (the bubble is open, §6.1): the dolphin swims to 1.6 blocks beside the player, facing
  her, head up out of the water, and holds still (a tiny bob only) until the bubble closes.
- **Ride cue**: while the player swims, the nearest rideable dolphin within 5 blocks gives a soft
  sparkle puff every 1.5 s (no words: "you can ride me").
- **Show pod** (`state 'show'`, cosmetic): placed per §3.3, moves slowly along the view, and its
  dolphins leap one after another every 10 to 20 s (the same arc, splashes, no sound beyond 40
  blocks). Not tappable, never escorts, removed when a real pod arrives.
- **Leave**: target a point 40 blocks away on qualifying water (or the horizon ring), fade over
  the last 6 blocks.

### 5.3 Fish schools
One center with a wander target (any qualifying water within 10 blocks); each fish keeps an
orbiting offset (radius 0.4 to 1.2, its own speed) around the center, in the surface band of
§5.1. No neighbour checks (no O(n^2)). **Scatter** (tap, or the player swimming through the
school at > 2): offsets x 3 over 0.4 s with a burst of `bubble`, then back to normal over 3 s.

### 5.4 Sea turtles, jellies, seahorses, octopus
- Turtle: speed 1.4, long gentle curves (turn rate 0.3 rad/s), the surface band and breaths of
  §5.1, flippers flap at 0.8 Hz; after a tap it targets 2.5 blocks beside the player for 10 s.
- Jelly: drifts at 0.3, bobs 0.15 per pulse (every 1.4 s) with the bell kept at the surface.
  Glow (`iTint.w`, bell parts only: limbs 0 and 1, §11.1): `0.6 * timeOfDay.night`, written by the
  CPU for that one jelly; a tap adds a flash of 1.2 decaying over 1.5 s, by day too.
- Seahorse: holds a spot, bobs 0.15 up and down at 0.5 Hz, turns slowly; fin flutters at 6 Hz;
  bubble trail.
- Octopus: rests on the bed, tentacles curl slowly, color drifts to the next palette every 20 s
  (lerp 2 s); on a tap: color pop to the next palette, a 2-block scoot with tentacles streaming;
  bubble trail.

### 5.5 Crabs and starfish
- Crab: walks **sideways** (yaw perpendicular to motion) at 1.2 along shore cells only (it checks
  `shore()` ahead); pauses 1 to 3 s; snips its claws while paused. When a kid comes within 1.5
  blocks without tapping, it scuttles 2 blocks sideways, turns to face her, waves both claws
  and **stays**. If there is no shore cell to step to, it digs into the sand (`state 'hide'`,
  sinks 0.3 so only its eye stalks poke out, 1 s); a tap pops it back out and counts as meeting
  it. It never runs away for good.
- Starfish: does not move; arm tips curl at 0.2 Hz with its own phase. On sand it sits on the top
  face; on the seabed on the bed's top face, with the bubble trail of §5.1.

### 5.6 Tapping (the pickable for every record)
- `hint: () => 'Tap to say hi!'`; `onUse`, `onBuild` and `onRemove` all run the same `greet()` and
  return true, so a selected block is never placed and nothing is ever removed on an animal
  (the gems precedent, `collectibles.js:252-254`).
- **Through the water.** Every pickable of an animal that can be under the surface carries
  `throughLiquid: true`. A small additive change in `game.pick()` (§12.2): when the voxel hit is a
  liquid cell **and** the Set holds a `throughLiquid` pickable, the ray is cast once more with
  `accept = null` (liquids ignored, only on Remove taps and right-clicks); `throughLiquid`
  pickables are then compared against that second distance instead of the water's. So a Remove
  tap or a right-click on a fish 1 block under the surface greets the fish, the water stays, and
  a solid block in front of the fish still wins. This works with the camera above or under the
  water.
- **Remove waits while riding.** A new optional `game.removeLock` hook in `removeTarget`
  (`if (this.removeLock && this.removeLock()) return false;`, beside the `isDriving()` check):
  while a dolphin is ridden it plays the click and shows **"Hop off first!"** with the dolphin
  picture (once per 1.5 s), so no tap, right-click or stroke can remove the water under the
  dolphin. Like vehicles, the tool is set to Hand on mount and any other tool picked while riding
  switches back with the same toast (`tool:change` listener, the `vehicles/index.js:971-979`
  pattern), so Build cannot place blocks around the rider either.
- `greet()`: the kind's reaction (§3, §5.2 to §5.5), `game.celebrate(pos, 'heart', { quiet: true })`,
  the kind's sound, `stats.seaMet[kind]++` (capped at 999), the daily coin check (§8),
  `game.saveProfile()`, `'sea:meet' { kind, first, quiet }`, and on the first meet ever a toast
  (§7) unless a sticker popped for the same tap. Then the sticker checks (§8). A tap on the same
  animal within 0.8 s is ignored (no spam).
- Fish: one pickable per school (its bounding box, at least 1.2 blocks), so little fish are easy
  to tap. Seahorse and starfish boxes are padded to 0.6 x 0.6 x 0.6.
- Dolphins: swimming within 5 blocks → hold + bubble (§6.1); from a slow boat (speed < 1) within
  4 blocks → hold beside the boat + bubble with Ride (§6.1); otherwise a trick, and once per world
  session a toast: "Stop the boat to ride a dolphin!" (in a moving boat) or "Swim out to ride a
  dolphin!" (on land).

### 5.7 The Starfish block
At install, after blocks are registered, the ocean module sets `onUse` and
`hint = 'Tap to say hi!'` (a **string**, as the HUD reads it, `game.js:1065`) on the existing block
def (`game.registry.blocks.byKey('starfish')`, block defined at `garden.js:479`), so no edit to
`garden.js`. `onUse`: star particles at the block, the giggle, `greet('starfish')` counting, return
true. Only the Hand greets the block: it is `replaceable` (`garden.js:477-479`), so a Build tap
replaces it as today. Placing, breaking and saving the block are unchanged.

### 5.8 The whale's visits (`src/life/ocean/schedule.js`, pure)
- **Two shared windows a game day.** `whaleTime(seed, day, k)` for `k = 0, 1`:
  `0.32 + 0.12 * h01(seed, day, 0)` and `0.52 + 0.12 * h01(seed, day, 1)`, where `h01` is a 32-bit
  integer hash (mulberry32 of `seed ^ Math.imul(day, 0x9E3779B1) ^ Math.imul(k + 1, 0x85EBCA77)`).
  A visit lasts 0.042 day (30 s), so both end before dusk (0.7). Every page with the same world
  and the same game day picks the same moments (one every 6 minutes of play on average).
- `whalePhase(seed, day, dayTime)` → `{ k, p }` with `p` in 0..1 during a window, else null.
  **The rise, spouts and dive are driven directly from `p`** (rise `p` 0 to 0.27, three spouts
  across 0.3 to 0.75, tail wave and dive 0.8 to 1), not from a local timer, so every page shows the
  same part of the visit at the same moment. A page that first sees a window at `p > 0.6`
  (a late joiner, a forward clock snap) skips it. Each window is **latched** per
  `(seed, day, k)`: shown at most once, so a clock frozen inside the window never loops it.
- **Frozen clocks** use the same predicate as `_advanceTime` (`game.js:403`):
  `const frozen = game.net?.isGuest && game._isShared() ? game.net.hostFrozen : profile.settings.timeFrozen`.
  While frozen, the page uses its own clock instead: a visit every 360 s of `game.time.t` (not
  shared; fine).
- **Where** is chosen locally when a window opens and retried every 5 s while `p < 0.6`: the
  horizon-ring direction closest to the camera's view direction (8 directions sampled), 12 to 40
  blocks past the edge, at least 55 blocks from the player and inside 0.75 x fog far. If no
  direction qualifies, the nearest ring point at least 55 blocks away is used **if** it is inside
  0.95 x fog far; otherwise the window is skipped (no toast, not counted) and the next one tries
  again (this covers rain, where fog far drops to 0.7x, and a player at one edge of a Cozy world
  facing inland). The whale's dive pitch is limited so its lowest vertex stays above the ring's
  `bed + 0.5` (§4.1).
- **Only when placed**: the toast "A whale says hello! Look at the sea!" (with the whale picture)
  and `'sea:whale'` fire only once the whale is actually placed, and only for a player in play,
  not in a panel, and within 60 blocks of sea-level water (`nearDeep`, or any outside-ring
  column). Kids indoors, underground or far inland simply miss that window.
- **Pointer**: while the whale is placed and its center is off-camera, a soft round whale
  picture (its thumbnail, 56 px) sits at the screen edge in its direction (clamped clear of the
  HUD columns), fading out once the whale is in view.
- **First personal visit**: the first time a kid with `met('whale') === 0` is at sea (swimming or
  boating 20+ blocks from the nearest shore cell, or over the horizon-facing edge), a local visit
  is scheduled within 60 s (its own `p` from `game.time.t`, not shared), once per world session
  until the whale is met. So Whale Hello is reachable in the first session.
- **At the world edge**: when the player is within 3 blocks of the edge on the whale's side during
  a visit, the whale turns toward her, waves its tail and spouts toward her (one extra spout), so
  the invisible wall becomes a moment instead of a dead end.
- **Seeing it**: the whale's center is inside the camera frustum and closer than fog far for 1.5 s
  in total during a visit → `greet('whale')` (counts as meeting the Whale; awards Whale Hello!).

---

## 6. The dolphin ride (`src/life/ocean/ride.js`)

### 6.1 Starting
- **From the water.** While `player.state === 'swim'`, a tap on a dolphin within 5 blocks puts
  it in **hold** (§5.2: it pops its head up 1.6 blocks beside her, holds still, chirps) and opens
  the bubble on it. Because the dolphin holds still, the bubble does not move. **Ride** is first
  and biggest (the `dolphin` icon), **Trick** second. The trick plays only from the Trick button.
- **From a boat.** When the boat's `speed < 1` and a dolphin is within 4 blocks, the tap puts the
  dolphin in hold beside the boat and the bubble offers **Ride** and **Trick**. Ride parks the boat
  where it is through the vehicles facade with a new reason, `park({ reason: 'sea' })` (treated as
  the confirmed second Get out, no shore search and no toast, §12.2), and then mounts at once
  (the kid slides over onto the dolphin, sparkles). The boat stays parked on the water.
- Tap Ride: the dolphin swims under the player (0.4 s, sparkles, `chirp`), then
  `player.mount(ride)` with the mount object below, `stats.dolphinRides++`, `game.saveProfile()`,
  `'sea:ride'`, sticker Dolphin Rider, the daily ride coins (§8), the toast (§7), the camera's
  `extraWant = 1.5` (the existing API, `src/player/camera.js:28-31`, `:75-78`), and the Hand tool.
- If Ride is tapped while that dolphin is doing a trick, the trick finishes (at most 1.6 s) and
  then the mount starts; the bubble shows the Ride button pressed meanwhile.
- Desktop keyboard: there is no direct key to start a ride (the bubble is the way); this keeps
  every key free.

### 6.2 The mount object (the vehicles contract, `vehicles/index.js:325-353`)
```js
{
  kind: 'dolphin',
  pose: 'ride',                    // the saddle pose for "Just Me"; merfolk's avatar shows its sea-ride pose instead (§15)
  variant,                         // palette index (presence sr)
  get yaw() {},                    // the dolphin's yaw
  get kick() {},                   // the dolphin's tail phase (radians), for the sea-ride pose
  seatWorld(out),                  // back of the dolphin: center + (0, 0.42 + bob, -0.1) rotated
  overlapsCell(x, y, z),           // the dolphin's cells at level and level + 1: no blocks built into it
  standSpot(),                     // for saves: beside the dolphin, in the water (§6.4)
  beforeStand(),                   // stood up by something else (fly, a panel action): same spot
}
```
The ocean system moves the dolphin and then seats the player, after `player.update` and before
the camera (the vehicles `_seat` pattern, `vehicles/index.js:357-367`): `seatWorld(pl.position)`,
`pl.yaw = yaw`, and the avatar group copied. The ridden dolphin shows its star saddle
(`iAcc.w = 1`).

### 6.3 Riding physics (pure `step(dt, wishX, wishZ, run, jump)`, Node-tested)
- The dolphin keeps the **level** it started on: center at `level + 0.875 - 0.25`, a bob of
  ±0.05 at 2 Hz.
- Steering like the horse (`pet.js:582-590`): the joystick or W A S D point where to go
  (camera-relative). Speed toward **`9.5 * |wish|`** (with run: **12.0**) at an acceleration of 6
  per second; yaw eases to the wish at `min(1, 4 * dt)`. Faster than a horse (9.0) and level with
  the Speedboat; running beats a running horse (12.8 is close, and the dolphin leaps).
- **Zoom**: holding Run at full speed adds a splash trail (`splash` x 2 every 0.15 s behind the
  flukes) and widens the camera (`extraWant` eases from 1.5 up to 2.0).
- **Ahead check** each step, with `ahead = max(0.9, 0.95 + speed * 0.15)` (2.75 at 12): the
  column at `ahead` and the center column must satisfy `depth ≥ 3` and `top === level`, be
  `inBounds`, and the cells at `level + 1` **and** `level + 2` (where the seated rider is) must be
  air, read with `world.get` (not only the map). Otherwise the dolphin brakes at 30 per second²
  (12 to 0 in 0.4 s, inside the look-ahead), turns toward the deepest of 8 sampled directions
  (**out-of-bounds samples are excluded**), and the toast "Dolphins stay in deep water!" with the
  dolphin picture shows (key `sea-shallow`, at most once per 4 s). It never enters a failing
  column.
- **The world edge**: when the failing column is only out of bounds, there is no toast. The
  dolphin chirps and swims a 1.5 s U-turn arc toward the island's center, ignoring the joystick
  during the arc; then the joystick steers again. A kid who keeps steering outward gets another
  arc, never a stall longer than 0.5 s.
- **Leap** (Jump / Space / the Jump button): cooldown 1.2 s; refused unless the landing column
  (`speed * 1.0` ahead) qualifies and **4** air cells are free along the arc (`level + 1` to
  `level + 4`, `world.get`). Up speed 7.0, gravity 14 (apex about 1.75 above, about 1.0 s),
  forward speed kept; splash at take-off and landing, `'sea:leap' { riding: true }`. The rider goes
  up with it (seated). A **refused** leap does a small splash hop (0.5 high, 0.35 s) with a chirp
  instead of nothing, so Jump never feels broken.
- **Blocked**: on every step, if `physics.bodyBlocked(seat.x, seat.y, seat.z, pl.halfW,
  pl.height)` is true, or the dolphin's own cell is not liquid (`world.get`), the ride ends with
  reason `'blocked'` (a friend's build arrived, an Undo or a Magic House put a block into the
  rider). `game.unstickPlayer()` returns early while riding (`game.js:1314`), so this check is the
  only thing that frees her.
- Sanitize every number every step; keep a last good pose; bounded loops only.

### 6.4 Ending
- **Hop off** (life column button, `X` or `E`, or `player.stand()` from anything else): the
  player is placed beside the dolphin in the water, feet at `level + 0.1` (so `liquidAt(feet +
  0.6)` is true and they are swimming at once), trying right, left, behind, in front (4 spots,
  `physics.bodyBlocked` test each); if none fits, at the dolphin's own spot. **After every
  hop-off, whatever the reason, `game.unstickPlayer()` is called**, because the fallback spot can
  be blocked. The dolphin swims beside them for 20 s as a buddy, then rejoins the pod.
  `'sea:hopoff'`, camera `extraWant = 0`, the joystick label from the swim state (§7).
- The water under the dolphin disappears (a friend's edit, an Undo): hop off with reason
  `'water'` and the toast "Splash! Off you go!". Blocks in the rider: reason `'blocked'`, the same
  toast.
- **Lost mount**: every frame, `if (ride.on && (pl.state !== 'ride' || pl.mountPet !== ride.mount))
  endRide('lost')`. This catches `player.teleport()` (debug teleport, the fall-back-to-spawn path
  `player.js:172-175`, Hop to a friend), which never calls `beforeStand()`. It resets
  `extraWant` to 0, emits `'sea:hopoff' { reason: 'lost' }` (so the joystick label resets), and
  returns the dolphin to the pod. `rideField()` returns a value only while
  `player.mountPet === ride.mount`, so presence `sr` clears on the next send.
- World unload: the ride ends silently (`'unload'`). Saves while riding use `standSpot()` (a
  water spot), so a reload puts the player swimming where they were.
- `game.isDriving()` stays false for a dolphin (`game.js:1110-1113` checks `kind === 'vehicle'`),
  so the HUD's Jump button stays Jump (not Honk). Build is held off by the Hand-tool lock and
  Remove by `removeLock` (§5.6). The game's own E handler only switches to Hand while riding (the
  tool already is Hand), so E only hops off.

### 6.5 Hooks in the player
- `player.js:56`: the early return on Space also for `kind === 'dolphin'` (Space is the leap; a
  double Space would otherwise stand them up to fly).
- `player.js:207-216` (`_syncAvatar`): add `seaRide: this.state === 'ride' && !!this.mountPet &&
  this.mountPet.kind === 'dolphin'` and `seaKick: seaRide ? this.mountPet.kick : 0` to the state
  object passed to `avatar.update`. **Merfolk reads both** (§15): with `seaRide` set, a mermaid or
  sea dragon keeps her form and shows the sea-ride pose. Today's avatar ignores them (legs in
  the saddle), which is also the "Just Me" look.
- Everything else that checks `state === 'ride'` already does the right thing (no emotes, no
  unstick, pets and friends follow, presence `st:'h'`).

---

## 7. UI and every string kids read (iPad first)

- **Bubble** (dolphins only): the pets bubble look (classes `lf-bubble`, `lf-bubble-name`,
  `lf-bubble-row`, the existing **56 px** round faces `.lf-bubble .sw-round-face`,
  `pets/ui.js:79`), with a local copy of `roundBtn` in `ocean/ui.js` (it is not exported from
  `pets/ui.js`). Ride is first, pink, with the `dolphin` icon and a gentle pulse, at
  `transform: scale(1.15)`; Trick second, lilac. Placed above the **held** dolphin with `toScreen`
  (`pets/kit.js:390-397`), so it stays put. Closes on any tap elsewhere, on `ui:open`, on
  `world:unload`, when the player stops swimming (from the water) or the boat moves (from a boat),
  when the dolphin goes beyond 8 blocks, or after **9 s idle** like the pets bubble
  (`pets/ui.js:543`); the idle timer resets on any interaction and **pauses while a sticker pop
  (`.sw-stkpop`) is showing**. Nothing over the joystick, the Jump button, merfolk's Up / Down
  buttons, the life column, the toasts, the sticker pop or the coin pill (the probe checks
  rectangles, U1).
- **Toasts with pictures**: a small additive option in `ui.toast` (§12.2), `opts.img` (a data
  URL) drawn as a 36 px round picture in place of the icon. Every ocean toast uses the animal's
  thumbnail (§4.2); if the thumbnail is not ready yet, the `sparkle` icon.
- **One thing at a time on a first meet**: when a sticker pops for the same tap (Dolphin Friend,
  Sea Explorer, Ocean Star, Whale Hello!), the first-meet toast is skipped (the sticker already
  says it) and `'sea:meet'` carries `quiet: true`, so NPC friends say one line, not two.
- **Life column** (`lifeHud`, `pets/kit.js:345-383`): `seahop` "Hop off" (icon `hopoff`, pink,
  order 0, pulsing like the pets one, `pets/ui.js:517-518`), shown only while riding a dolphin.
- **Joystick label** (`src/ui/touch.js:132-136`): "Ride" on `'sea:ride'`; on `'sea:hopoff'` the
  label follows the swim state: "Swim" while `player.swimming`, else "Walk" (one helper shared with
  merfolk, which shows "Swim" while swimming too, §15).
- New life icon `dolphin` in `pets/kit.js` `PATHS` (`:253-279`): a leaping dolphin silhouette, used
  by the Ride button.
- **Help cards** (`touch.js` `KEY_CARDS` `:144`, `TOUCH_CARDS` `:167`): a new `PICS.dolphin` (a
  64x64 SVG: a pink dolphin over a blue wave) with **"Swim to a dolphin and tap it to ride"**
  (touch) / **"Swim to a dolphin and click it to ride"** (keys), and a row
  `[[E or X], 'Hop off a dolphin']` beside "Get out of a car".
- **Whale pointer**: §5.8 (56 px round thumbnail at the screen edge, no words).

| Where | Text |
|---|---|
| Hint when aiming at an animal (desktop crosshair) | Tap to say hi! |
| First meet of each kind (toast with the animal's picture, key `sea-meet`, read aloud when Read Aloud is on; skipped when a sticker pops) | You met a Dolphin! · You met a Little Fish! · You met a Sea Turtle! · You met an Octopus! · You met a Jellyfish! · You met a Seahorse! · You met a Crab! · You met a Starfish! · You met a Whale! |
| The buddy dolphin's first visit in a session | Splashy came to say hi! (the buddy's name) |
| A kid's pool | Fish moved into your pool! · Dolphins came to your pool! |
| Bubble title | the dolphin's name (e.g. Splashy) |
| Bubble buttons | Ride · Trick |
| Tapping a dolphin from a moving boat (once per world session) | Stop the boat to ride a dolphin! |
| Tapping a dolphin from land (once per world session) | Swim out to ride a dolphin! |
| Ride starts (touch / desktop) | Steer with the joystick! Tap Jump to jump! / Steer with W A S D! Space to jump! |
| Shallow water while riding | Dolphins stay in deep water! |
| Water gone or blocks under the dolphin | Splash! Off you go! |
| Remove or another tool while riding | Hop off first! |
| Life column | Hop off |
| Joystick label | Ride (then Swim or Walk) |
| Help cards | Swim to a dolphin and tap it to ride · Swim to a dolphin and click it to ride · Hop off a dolphin |
| The whale arrives (only once placed) | A whale says hello! Look at the sea! |
| Sea Friends strip | Sea Friends (title) · the animal's name under each met slot |
| Stickers | §8 |

All of these live in one exported `SEA_TEXT` object (§4.3). No text says "her" or "she" about a
player, nothing mentions prices or buying, no brand names.

### 7.1 NPC friends (`src/things/friends/`)
- `chat.js` `LINES.events` (`:85-95`) gains
  `'sea:meet': ['Wow! A sea friend!', 'So cute! Hi there!', 'I love the ocean!']` and
  `'sea:ride': ['You\'re riding a dolphin! Wheee!', 'Go, go, dolphin!', 'So fast! Yay!']`.
  The `'sea:meet'` listener skips events with `quiet: true` (the sticker line already plays).
- `chat.js` `LINES.seaKinds = { dolphin: ['Look, dolphins! Hi, dolphins!', 'Dolphins are so
  smart!'], fish: ['The fish are so sparkly!'], sea_turtle: ['A sea turtle! So graceful!'],
  jelly: ['The jellyfish are glowing!'], crab: ['Click click! A little crab!'],
  octopus: ['An octopus! Eight arms to hug!'], seahorse: ['A tiny seahorse! So cute!'],
  starfish: ['A starfish! Twinkle twinkle!'], whale: ['A whale! It\'s so big and gentle!'] }`;
  `contextLines` (`:187-226`) adds the lines of `game.ocean.nearAny(p.x, p.y, p.z, 10)` (with
  `p = friend.pos`) when it is set.
- **Invite lines**: `LINES.seaInvite = ['I saw dolphins out in the deep water!', 'Let\'s swim out
  and find dolphins!']`, added by `contextLines` when the player has `met('dolphin') === 0` and
  `game.ocean.nearDeep(p.x, p.z, 40)` is true for the friend's position (the friend is near the
  shore).
- `index.js:760`: add `'sea:meet'` and `'sea:ride'` to the react list.
- Friends' pronouns are untouched (lines above use no pronouns).

### 7.2 Timing on iPad
A first dolphin tap now does, in order: hold + chirp + bubble (at once), the sticker pop with
confetti (the existing queue, top 16%, `stickers.js:36`), coins flying from the dolphin, one NPC
line. No first-meet toast (the sticker covers it). The bubble's idle timer is paused while the
pop is up, so the kid can look at the sticker and still find Ride waiting.

### 7.3 Sea Friends strip (Sticker Book)
- Read from `stats.seaMet` only (no new keys). A row of **9 round slots** (the first
  `OCEAN_STAR_KINDS` of `SEA_KINDS`) under the sticker pages, titled "Sea Friends". An unmet kind
  shows its thumbnail as a soft grey silhouette (`filter: brightness(0) opacity(.22)`, no extra
  render); a met kind shows the colored thumbnail and its name.
- Tapping a met slot shows it big in the Sticker Book's detail layer, spinning slowly (a CSS
  `rotateY` wobble), with its name and its sound.
- Ocean Star's hint is "Fill all the Sea Friends", and the strip sits right under it, so a kid at
  8 of 9 can see that the octopus is the grey one.
- How it gets there: a tiny additive hook in `src/ui/stickerbook.js` (§12.2):
  `game.stickerBookExtras` (an array of `{ key, build(el), refresh() }`), built once under the
  pages in `build()` and refreshed in `onOpen()`. Ocean registers one entry on `game:ready`.

---

## 8. Stickers and coins

Registered on `game:ready` (after the core 21 and the other teams' 11, so they come later in the
book), the vehicles pattern (`src/things/vehicles/stickers.js:75-92`), each with canvas art in the
100x100 box (`src/life/sticker-art.js:1-6`):

| id | Name | Hint | Earned when | Art |
|---|---|---|---|---|
| `dolphin_friend` | Dolphin Friend | Say hi to a dolphin | first dolphin hello | a lilac dolphin leaping over a wave, a heart |
| `dolphin_rider` | Dolphin Rider | Ride a dolphin | first ride starts | a sky dolphin with its little star saddle, splashing |
| `sea_explorer` | Sea Explorer | Meet 5 kinds of sea animals | 5 of the first 9 `SEA_KINDS` with `seaMet ≥ 1` | a fish, a starfish and a shell in bubbles |
| `ocean_star` | Ocean Star | Fill all the Sea Friends | all of the first 9 `SEA_KINDS` (`OCEAN_STAR_KINDS`), so kinds appended later never move the goal | an orange starfish with a little crown, sparkles |
| `whale_hello` | Whale Hello! | See a whale say hello | the whale counted as met (§5.8) | a whale spouting a heart |

Each pays +20 coins through the existing `sticker:earned` listener (`coins.js:215-242`), 100 in
all, once.

**Daily sea reward** (the pets precedent, `coins.js:233-242`: +2 for the first pat of each pet each
day), through `game.coins.add(n, 'sea', { at })` so it counts toward `stats.coinsEarned` and the
mystery-present milestones, with the coins flying from the animal as they do from pets:
- +2 for the first hello to each kind each day (at most 9 x 2 = 18);
- +5 for the first dolphin ride each day.
At most 23 coins a day, nothing to farm. The day stamp is `stats.seaCoinDay` (yyyymmdd from
`today()`, `coins.js:57-61`, a number that only grows) and `stats.seaCoinMask` (§4.5); a new day
resets the mask. No words about prices or coins in any sea text.

Award listeners check `game.net?.remoteApplying` first (`docs/MULTIPLAYER.md` §9.11); sea taps are
local actions, so it is never set there, but the guard is kept as the rule says. Sticker total
goes from 32 to 37 (plus whatever the other wave-4 teams add).

---

## 9. Multiplayer

### 9.1 Decision: local cosmetic animals, with the shared moments kids point at

Each page spawns and moves its own animals, like butterflies and fireflies (`ambient.js`, no net
code; `docs/MULTIPLAYER.md` §7 has no row for ambient life). Why not host-owned:
- Motion channels `pt` / `nx` carry at most 12 samples each and are **shared** by every actor kind
  on them (`src/net/actors.js:114-127`, `host.js:1271-1272`); pets and friends already use them.
  A pod of leaping dolphins, fish schools and jellies would starve pets and friends or need a new
  host presence channel (`readHostState` whitelists fields, `protocol.js:396-420`).
- Leaps are fast (7 blocks/s up, 1 s in the air); at the presence rate a remote dolphin would
  jitter or need its own prediction.
- Nothing about sea life changes the world or anybody's things, so there is nothing to keep
  consistent and nothing to lose. Each child taps their own animals for their own profile (the
  gems precedent, §7 "Gems").
- Guests may not change world state in `update()` (`docs/DESIGN.md` §5); local cosmetic life
  never does.

But "Look at my dolphin!" / "What dolphin?" would be a confusing first multiplayer moment. So
the things kids point at **are** shared, at almost no protocol cost:
- **The buddy dolphin** (§5.2): its name and color come from the world seed, so both pages have
  "Splashy" leading their first pod.
- **Tricks** (presence `sk`, §4.6): when a friend starts a trick, every other page plays a trick
  beside her within 2 s (§9.2).
- **Rides** (presence `sr`): everyone sees the dolphin under a rider, and the rider's sea form.
- **The whale's moments** (§5.8), from `world.meta.seed` and the game day/time that guests already
  follow.
- **Escort**: each page's dolphins escort friends' swimmers and boats seen on that page, so two
  kids swimming together both see dolphins around both of them.

### 9.2 Presence `sr` and `sk`
- Written by `adapter.local()` (`src/net/adapter.js:568-592`): `sr: this.seaRideField()` →
  `game.ocean ? game.ocean.rideField() : null` and `sk: this.seaTrickField()` →
  `game.ocean ? game.ocean.trickField() : null`, each in a try/catch (the `vehicleField` pattern,
  `:595-603`).
- `avatarFields` (`host.js:1415`):
  `if ('sr' in local) owner._set(patch, 'sr', parseSeaRide(local.sr));` and the same for `sk` with
  `parseSeaTrick` (sent only when the value changes).
- `remote-players.js`:
  - `_ingest` (`:340-372`): `f.sr = parseSeaRide(st.sr)`; `const sk = parseSeaTrick(st.sk)`; if
    `f.sk !== undefined && sk !== null && sk !== f.sk` then
    `game.ocean.remoteTrick(f.peer, sk, f.pos.x, f.pos.y, f.pos.z)`; then `f.sk = sk`. The first
    value a page sees only sets `f.sk` (a late joiner never replays old tricks).
  - `_frame` (`:412-484`): `const seaRide = f.st === 'h' && f.sr !== null && !f.vehicle;` then
    `game.ocean.remoteRide(f.peer, seaRide ? f.sr : null, f.pos.x, f.pos.y, f.pos.z, f.yaw, f.speed, show)`
    and `av.update(..., { riding: st === 'h' && !seated, seaRide, sea: st === 'm' || seaRide, ... })`
    (merfolk's `sea` flag, §15; the friend's form comes from her look as merfolk resolves it).
  - `_drop` (`:536`) calls `remoteRide(f.peer, null)`; `clear()` (session ends) calls it for every
    friend; `list()` (`:242-252`) gains `seaRide: f.sr`.
- The friend's dolphin is an instance of the same dolphin mesh with its saddle, placed so its back
  is under the friend's seat (`center = p - (0, 0.42, 0)` rotated by yaw), hidden with the avatar
  beyond 64 blocks, kicking from `f.speed`, with splashes when `p.y` crosses the surface.
- `remoteTrick(peer, value, x, y, z)`: the nearest wild dolphin within 12 blocks of that friend
  (preferring the same palette) plays the next trick with hearts. If there is none and a wild slot
  is free, one dolphin of that palette is brought in 6 blocks from her with a splash leap, then
  does the trick, then joins the local pod or leaves. At most one remote trick per friend per
  1.5 s.
- No protocol bump: peers in one room already run the same build (`pv`, `docs/MULTIPLAYER.md`
  §5.4). Receivers parse defensively (anything out of range is null).
- Size: about 12 bytes for both; host presence stays far below 3,900 B (`protocol.js:26`).

### 9.3 Guests and visitors
- A guest meets animals, rides dolphins, earns their own stickers and daily sea coins in someone
  else's world, all local. Nothing goes to the host. The host's saved world never changes because
  of sea life.
- `remoteApplying` never matters for sea taps; the guard stays on the award code anyway.

### 9.4 What changes in `docs/MULTIPLAYER.md`
- §5.4 table (after `vh`, `:317`): `sr` and `sk` rows (the text of §4.6).
- §7 table (`:657-672`): a **Sea animals** row: "per page (cosmetic, like butterflies); the
  buddy dolphin comes from the world seed and the whale's visit times from the seed and the game
  day, so everyone sees them; a rider's dolphin travels as presence `sr` and a friend's tricks as
  presence `sk`".
- §9 hooks list: the `adapter.local()`, `avatarFields` and `remote-players` lines above.
- §15 tests: the ocean probe's `mp` pass (§13.4 F).

---

## 10. Saves and old-save safety

- **World saves**: nothing. The `ocean` system has no `serialize` / `deserialize`. A world saved
  with sea life around is byte-for-byte the same as without (probe check D3).
- **Profile**: only `stats.seaMet`, `stats.dolphinRides`, `stats.seaCoinDay` and
  `stats.seaCoinMask` (§4.5), created lazily and saved with `game.saveProfile()`. Old profiles
  have none of them and need nothing: `mergeProfile` at load (`src/core/game.js:60-69`) keeps
  `stats` as it is; the counters appear on the first tap.
- **Cloud and backups**: nested numbers in `stats` are already max-merged per key in both merges
  (`merge.js:14-22`, `storage.js:131-142`), and `stats` is already backed up (`storage.js:86`).
  **No change to `merge.js`, `storage.js`, `legacy.js` or `BACKUP_PROFILE_KEYS`.** New tests guard
  this (§13.3) so a later change to `maxNumbers` cannot silently drop a sea counter.
- **Look**: untouched by this team. **Device-only**: nothing (the Girl / Boy / Mix choice is not
  read by sea life at all; the sea form while riding is merfolk's, from the look).
- **COPPA / data map**: `docs/DATA-MAP.md:50` row "her avatar look, ..., stats, ..." already covers
  game counters; add "(including which sea animals they met)" for clarity. No personal data.
- **Old clients**: an old cached page never meets `sr` or `sk` (same-build rule) and never sees
  `seaMet` as anything but an unknown nested stat, which it keeps (merges pass unknown keys
  through).

---

## 11. Rendering and performance

### 11.1 The sea material (`src/life/ocean/material.js`)
`seaMaterial(mode)` → a cached `MeshLambertMaterial({ vertexColors: true })` per mode (`kick`,
`wiggle`, `flap`, `pulse`, `curl`, `flutter`, `snip`), `userData.shared = true`, with
`onBeforeCompile` (the `swayMaterial` pattern, `models-tree.js:327-343`) and
`customProgramCacheKey = () => 'sw-sea-' + mode`:
- vertex: `attribute vec3 aSea; attribute vec3 aPivot; attribute vec4 iSwim; attribute vec4 iTint;
  attribute vec4 iAcc;` varyings `vSeaTint`, `vSeaAcc`, `vSeaMask`, `vSeaShade`, `vSeaGlow`; in
  `begin_vertex`, per mode (before `instanceMatrix`, so it bends in the animal's own space):
  - `kick: transformed.y += iSwim.y * sin(iSwim.x - aSea.x * 2.4) * aSea.x * aSea.x * 0.35;`
  - `wiggle: transformed.x += iSwim.y * sin(iSwim.x - aSea.x * 3.0) * aSea.x * 0.25;`
  - `flap / snip`: for limb 1 vertices (`abs(aSea.z - 1.0) < 0.5`),
    `vec3 d = transformed - aPivot; float a = iSwim.y * sin(iSwim.x) * sign(aPivot.x);` rotate
    `d` about the animal's Z axis by `a` and add `aPivot` back (flippers and claws swing about
    their roots; left and right mirror);
  - `pulse`: bell (`aSea.x < 0.5`) scales xz by `1 + iSwim.y * sin(iSwim.x)`; tentacles trail by
    `sin(iSwim.x - aSea.x * 4)`;
  - `curl`: tips (`aSea.x`) lift by `iSwim.z * aSea.x * aSea.x` and sway by `sin(iSwim.x + aSea.z)`;
  - every mode: the saddle (limb 3) collapses to its pivot when `iAcc.w < 0.5`; a turn bend
    `transformed.x += iSwim.z * aSea.x * aSea.x` makes swimmers curve into turns.
- fragment: after `color_fragment`,
  `vec3 k = vSeaMask < 0.5 ? vec3(1.0) : (vSeaMask < 1.5 ? vSeaTint : vSeaAcc);`
  `diffuseColor.rgb *= k * vSeaShade;` and after `emissivemap_fragment`,
  `totalEmissiveRadiance += diffuseColor.rgb * vSeaGlow;` where `vSeaGlow = iTint.w` for limbs 0
  and 1 and 0 for limb 2 (so a jelly's bell glows, not its tentacles). Glow is per instance, so
  one tapped jelly or one fairy fish lights up, not all of them.
- Lighting and fog are Lambert's own (`scene.fog` is set by daynight, `daynight.js:313-316`), so
  the animals darken at night and fade in the fog like the furniture and pets do, and follow any
  underwater fog the merfolk team adds by changing `scene.fog`.
- `iSwim.w` (shade): §5.1 (1 within 10 blocks, else `clamp(1 - 0.07 * depthBelowSurface, 0.6, 1)`).
- Render order: the animals are opaque and draw before the translucent water (`material.js:127-128`,
  `depthWrite: false`). Seen from above, the parts under the surface are dimmed to about 25% by
  the water; that is why near the player every animal shows its back, head, bell or bubbles at or
  above the surface (§5.1), and the probe checks it from the real swim camera (V1). Jellies are
  opaque "gummy" jellies with a glow, so no transparent sorting is needed.

### 11.2 Budgets (2019 iPad, `docs/DESIGN.md` §2 "Performance budget")

| item | cost |
|---|---|
| Draw calls | one per kind with live instances: at most 9, usually 2 to 4 at sea, 0 inland (meshes hidden at count 0). Friends' ride dolphins and the show pod share the dolphin mesh: 0 extra. |
| Triangles | at full counts about 12 x 2.25k (dolphins) + 30 x 0.42k (fish) + whale 3k + the rest about 12k: ≤ 65k, typically 15k. |
| CPU per frame | spawn sampling 24 columns (O(1) reads each), `map.tick(2)` (about 0.04 ms), ≤ 87 creature steps (≤ 2 sea-map reads each, plus a `world.get` every 0.25 s), ≤ 87 matrix writes and box moves: about 0.2 ms desktop, ≤ 0.5 ms on the iPad budget; the probe checks ≤ +1.0 ms on SwiftShader. |
| Pickables | ≤ 40, only within 12 blocks (Set membership at 4 Hz, boxes moved every frame). |
| Sea map | 3 x 43 KB (Big); full scan once at world load (1.7 to 3.8 ms warm); one column per block change; 2 rows per frame round-robin. |
| Particles | from the existing pool (≤ 800); a leap emits about 14, a spout about 30, a blowhole puff 3, a bubble trail 3. |
| Audio | short synth voices from `sfx.js` (§12.1), distance-scaled, dropped when quieter than 0.05. |
| Allocations | none per frame: pooled records, scratch math objects, typed arrays. |
| Shaders | 7 programs, all compiled by `daynight.warmUp` behind the loading screen (`envWarm`). |
| Thumbnails | 9 default pictures (plus the buddy's and any met variant), 96x96, through the existing queue at `'low'` priority. |
| Bundle | about 2,400 lines ≈ 48 KB minified, about 14 KB gzip, on a 2.3 MB page. |

`quality: 'low'` halves fish and jellies only (as it halves particles today); nothing else changes
and nothing is lowered for `auto` / `high`. If a real 2019 iPad drops frames at sea, the levers,
in order: (1) creatures more than 15 blocks away step at half rate (every second frame, `dt`
doubled); (2) pickable Set refresh at 2 Hz; (3) only then thin out far-away schools (beyond 12
blocks). Schools within 12 blocks of the player are never thinned, and picture quality is never
lowered.

---

## 12. Files

### 12.1 New files (`src/life/ocean/`)

| file | contents |
|---|---|
| `index.js` | `install(game)`: builds the meshes, the `ocean` system (`onWorldLoad`: `map.attach`, reset, `inSet` flags off; `onWorldUnload`: end ride, clear pools, `inSet` flags off, `map.detach`; `update(dt)`: `map.tick`, spawn, step, lost-mount check, write buffers, whale), sea-map hooks (`block:place`, `block:remove`, `net:applied`), the Starfish block hook (§5.7), `removeLock`, the Hand-tool lock while riding, sticker registration, the Sea Friends entry, keys (X / E hop off while riding), `game.ocean`, `game.debug.ocean`. |
| `kinds.js` | `SEA_KINDS`, `OCEAN_STAR_KINDS`, `SEA_NAMES`, `SEA_SPEC`, `PALETTES`, `DOLPHIN_NAMES`, `SEA_TEXT` (§4.3, §3.2, §7). |
| `seamap.js` | `SeaMap` (§4.1). Pure. |
| `models.js` | `SeaKit`, one builder per kind (§3, §3.1), `geometryFor(kind)` (cached), `thumbFor(kind, variant)`. |
| `material.js` | `seaMaterial(mode)` (§11.1). |
| `motion.js` | pure steppers per kind (`stepPod`, `stepShow`, `stepSchool`, `stepGlider`, `stepDrifter`, `stepCrawler`, `stepStill`, `stepLeap`, `stepTrick`, `stepHold`) and `canLeap(map, world, ...)` (§5). |
| `ride.js` | `DolphinRide` (mount object §6.2, `step` §6.3, hop-off spot §6.4). Pure step, Node-tested. |
| `schedule.js` | `whaleTime`, `whalePhase`, `h01`, `buddyOf(seed, biome)` (§5.8, §5.2). Pure. |
| `ui.js` | the dolphin bubble (with its own `roundBtn` copy), the Hop off button, toasts with pictures, the whale pointer, the Sea Friends strip, joystick label events. |
| `sfx.js` | `createSeaSfx(game)`: `chirp`, `whale`, `boop`, `clack`, `pff` (synthesized, the structure of `src/things/outdoor/sfx.js`); everything else goes to `sfx()` of `pets/sfx.js` (`bloop`, `giggle`, `ding`, `pop`) or the core (`splash`, `sparkle`). |
| `stickers.js` | the five stickers with art (§8), `installSeaStickers(game)` → `award(id)`; the daily sea coins. |

Plus `tools/test-sea.mjs`, `tools/probe-ocean.mjs` (§13) and two `package.json` scripts:
`"test:sea": "node tools/test-sea.mjs"`, `"probe:ocean": "node tools/build.mjs && node tools/probe-ocean.mjs"`.

### 12.2 Changed files (all additive; inert unless the player is near water)

| file | where | change |
|---|---|---|
| `src/main.js` | imports; `modules` `:51-53` | `import * as ocean from './life/ocean/index.js'`; insert `ocean` after `collectibles` (particles exist by then; the sticker registry is only used on `game:ready`, and `stickers` installs after `collectibles`; `game.net` is read lazily at run time). |
| `src/core/game.js` | `pick()` `:1003-1037`; `removeTarget()` `:1117-1128` | `throughLiquid` pickables (§5.6): when the voxel hit is a liquid and such a pickable exists, one more `raycastVoxels` with `accept = null` (Remove taps and right-clicks only) and compare `throughLiquid` boxes against that distance; about 8 lines. `removeTarget`: `if (this.removeLock && this.removeLock()) return false;` after the `isDriving()` check. |
| `src/ui/ui.js` | `_pumpToasts` `:98-104` | `opts.img` (a data URL) → a 36 px round `<img>` in place of the icon; about 3 lines. |
| `src/ui/stickerbook.js` | `build()` `:205-240`, `onOpen()` `:245-256` | `game.stickerBookExtras` hook (§7.3): build each extra under the nav once, `refresh()` on open; about 6 lines. |
| `src/things/vehicles/index.js` | facade `:1006-1020`; `park()` `:459-476` | `pose()` → `{ x, y, z, yaw, speed, boat }` from `current.drive`, or null (3 lines). `park({ reason: 'sea' })`: treated as the confirmed second Get out on open water (`swim = true`, no shore search, no toast). |
| `src/player/player.js` | `_onKey` `:56` | `if (this.state === 'ride' && this.mountPet && (this.mountPet.kind === 'vehicle' \|\| this.mountPet.kind === 'dolphin')) return;` |
| | `_syncAvatar` `:207-216` | add `seaRide` and `seaKick` to the state object (§6.5). |
| `src/net/protocol.js` | after `parseVehiclePresence` `:226-233` | `parseSeaRide(v)`, `parseSeaTrick(v)`. |
| `src/net/host.js` | `avatarFields` `:1415` | two lines for `sr`, `sk` (§9.2); import the parsers. |
| `src/net/adapter.js` | `local()` `:568-592`; new `seaRideField()`, `seaTrickField()` beside `vehicleField` `:595` | `sr`, `sk`. |
| `src/net/remote-players.js` | `_ingest` `:340-372`, `_frame` `:412-484`, `_drop` `:536`, `clear()`, `list()` `:242-252` | §9.2. |
| `tools/net/fake-adapter.mjs` | `local()` `:426-430` | `if (this.sr !== undefined) out.sr = this.sr;` and the same for `sk` (as `vh`). |
| `tools/test-net.mjs` | runner `:2014` | `if (!ONLY \|\| ONLY.has('unit') \|\| ONLY.has('sea')) await seaTests();` next to the vehicles line, and the `seaTests()` block (§13.2). |
| `src/things/friends/chat.js` | `LINES.events` `:85-95`; new `LINES.seaKinds`, `LINES.seaInvite`; `contextLines` `:187-226` | §7.1. |
| `src/things/friends/index.js` | react list `:760` | add `'sea:meet'` (skipping `quiet`), `'sea:ride'`. |
| `src/things/pets/kit.js` | `PATHS` `:253-279` | new life icon `dolphin`. |
| `src/ui/touch.js` | `:134-136`; `PICS` `:83`; `KEY_CARDS` `:144`; `TOUCH_CARDS` `:167` | "Ride" on `'sea:ride'`; on `'sea:hopoff'` "Swim" or "Walk" from the swim state; `PICS.dolphin` and the help cards (§7). |
| `docs/DESIGN.md` | §1 activities `:91-112`, stickers `:114-123`; §2 events `:258-287`, environment `:598-613`; the wave-4 section | §14 step 9. The integrator makes **one** `## 7. Wave 4` section with sub-sections 7.1 to 7.3 (squishies & presents, merfolk, ocean); squishies.md:355 claims the same number. |
| `docs/MULTIPLAYER.md` | §5.4 `:317`, §7 `:657-672`, §9, §15 | §9.4. |
| `docs/DATA-MAP.md` | `:50` | the wording of §10. |
| `site/index.html` | `:111` | together with the other wave-4 teams, one sentence: "...and cars, vans and boats to drive, **dolphins to ride and sea animals to meet**. They're inside too." (the integrator merges all wave-4 wishes into this one line). |
| `package.json` | scripts | `test:sea`, `probe:ocean`. |

Nothing changes in `src/world/*` (the Starfish block is hooked at run time), `src/account/*`,
`src/core/storage.js`, `src/net/codec.js`, `src/net/guest.js`, the server, the look, the wardrobe
lists, the avatar (merfolk adds the sea-ride pose), the camera or the HUD file. The only
`src/core` change is the two small hooks in `game.js` above.

### 12.3 SHARED FILES (other wave-4 teams may touch the same files; merge by hand, never overwrite)

| file | ocean's change | other team's change |
|---|---|---|
| `src/player/player.js` | `_onKey :56`, `_syncAvatar :207-216` (`seaRide`, `seaKick`) | merfolk: swim detection and physics `:129-150`, the sea gate, `mount()` cut (skips `kind === 'dolphin'`, §15), `_syncAvatar` (form flags) |
| `src/player/avatar.js` | none | merfolk: tail / sea form, swim pose, **the sea-ride pose** (reads `seaRide`, `seaKick`) |
| `src/net/remote-players.js` | `_ingest` (`sr`, `sk`), `_frame` (`seaRide`, `sea` for riders), `_drop`, `clear()`, `list()` | merfolk: `_frame` swim flags (`st 'm'`), `_ingest :348`, `seaFriends(out)`; squishies: `heldModel` `:56-67` |
| `src/net/adapter.js` | `local()` adds `sr`, `sk` | merfolk: the `st` line (`'m'`, but `'h'` while riding, §15) and `_lk` (merfolk.md:362); squishies: `heldKey()` `:606-617` |
| `src/net/host.js` `avatarFields` | `sr`, `sk` lines | squishies: none expected (`hi` is reused) |
| `src/net/protocol.js` | `parseSeaRide`, `parseSeaTrick` | none expected |
| `tools/net/fake-adapter.mjs` | `sr`, `sk` | merfolk: `st` override; squishies: `hi` source |
| `tools/test-net.mjs` | `seaTests()` and its runner line | merfolk: `merfolkTests()` after `vehicleTests`; squishies: their block |
| `src/core/game.js` | `pick()` `throughLiquid`, `removeLock` | squishies & presents: `defaultProfile` |
| `src/ui/ui.js` | toast `opts.img` | none expected |
| `src/ui/stickerbook.js` | `stickerBookExtras` hook | none expected (squishies.md:459: not touched) |
| `src/things/vehicles/index.js` | `pose()`, `park({ reason: 'sea' })` | merfolk: none (it reads `mountPet.kind`) |
| `src/player/wardrobe-data.js`, `src/net/codec.js` | **none** | merfolk: a sea-form look field and codec tokens (append-only) |
| `src/account/merge.js`, `src/core/storage.js`, `src/account/legacy.js` | **none** | squishies & presents: new profile maps and merge rules |
| `src/ui/hud.js`, `src/ui/inventory.js`, `src/ui/menus.js` | **none** | squishies & presents: coin pill button, collection / present UI; merfolk: Up / Down in sea form |
| `src/life/stickers.js` / sticker book order | none (registers its own on `game:ready`) | all teams add stickers; the integrator fixes the registration order |
| `src/things/pets/kit.js` `PATHS`, `lifeHud` orders | icon `dolphin`; button `seahop` order 0 | squishies: Squeeze / Put away buttons; presents: a "Present!" button |
| `src/things/friends/chat.js`, `index.js` | lines and the react list | merfolk: `'player:seaform'` lines and react entry; squishies may add lines |
| `src/ui/touch.js` | joystick label (Ride / Swim / Walk), help cards | merfolk: "Swim" label while swimming, Up / Down buttons |
| `src/main.js` modules list | `ocean` after `collectibles` | merfolk: `sea` after `stickers`; squishies: their modules |
| `docs/DESIGN.md` events / stickers / environment / wave-4 section, `docs/MULTIPLAYER.md` §5.4 / §7, `docs/DATA-MAP.md`, `site/index.html:111` | §12.2 | all three teams |
| `package.json` scripts | `test:sea`, `probe:ocean` | the other teams' scripts |

---

## 13. Tests

### 13.1 `tools/test-sea.mjs` (Node, no browser, seconds; the `test-vehicles.mjs` model)
Imports `seamap.js`, `motion.js`, `ride.js`, `schedule.js`, `kinds.js` and `src/net/protocol.js`
over a `FakeWorld` (a `Uint8Array` of blocks with a `props` of `shape`, `solid`, like
`tools/test-vehicles.mjs:48-85`), plus the real biome generators for S0.

- **S0 real worlds**: the recipe (reproduces §2.1 exactly):
  ```js
  const items = new ItemRegistry(); const B = new BlockRegistry(items);
  blocks.install({ registry: { blocks: B, items } });
  B.finalize(() => 0, () => false);          // both arguments must be functions (registry.js:162)
  const w = new World(WORLD_SIZES[size], B);
  mod.generate(w, mulberry32(seed), new Noise(seed));
  ```
  Generate beach / meadow / candy / snow / fairy / mix / flat at Cozy and Big (seed 777 and
  12345); `SeaMap.attach` finds the numbers of §2.1 within 2%; flat has 0 liquid columns; candy's
  sea counts (strawberry milk); the lagoon's deepest column is ≤ 2 and its channel ≤ 2; the outside
  depth is 6 in beach and 5 in meadow, candy, snow, fairy, mix; warm attach ≤ 8 ms for Big.
- **S1 SeaMap**: depth, top and bed of hand-built columns (1, 2, 3, 6 deep; ice on top → none;
  a lily-pad carpet on top → counts; a bridge block on top → none); `setColumn` after a block
  change; a prefab-style batch of `world.set(..., { record: false })` over water with **no event**
  is seen after at most `ceil(sz / 2)` `tick()` calls; `markAllDirty()` then ticks rescan every
  row; out-of-bounds columns with a liquid and a grass `outside`; **`outside === null`** → no
  liquid; outside depth 5 when the edge seabed median is 5; `shore()` true on sand next to water
  and false one block inland; `deepAround` with one shallow sample (8 of 9 still passes) and two
  (fails); `placed()` set by `setColumn` from an edit, not by `attach`.
- **S2 motion**: 20 seeds x 2,000 steps per kind, with random block edits every 50 steps (half of
  them with no `setColumn`, only `tick`): every number finite; dolphins never in a column failing
  their rule except during a leap and never below `bed + 1`; out-of-bounds creatures never below
  the outside `bed + 1.3`; within 20 blocks of the player, dolphins' centers in
  `[surface - 0.35, surface - 0.25]` outside leaps and tricks, fish in `[surface - 0.4,
  surface - 0.15]` outside skips; fish never outside liquid; crabs only on shore cells; starfish
  never move; `nanResets` 0 on clean input and the reset path works after a forced `NaN`; the
  spawn fallback finds a cell in a 5x5x2 pool with the player at its edge (fish) and in a
  17x17x4 pool (dolphins); slot compaction keeps every slot's tint equal to its record's palette
  after random despawns.
- **S3 leaps**: apex ≤ surface + 2.0 (wild) and the arc is refused under a bridge 1 to 4 blocks
  above the surface; airtime 0.8 to 1.2 s; landing in a qualifying column; a still player in
  play gets a leap within 6 s.
- **S4 ride**: 20 seeds x 2,000 random inputs (wish, run, jump) over a sea with an island, a
  shallow shelf and the world edge: always `depth ≥ 3` and `top === level` at the center; never
  leaves `[1, sx - 1]`; at the shelf speed reaches 0 within 0.45 s from 12 and the dolphin never
  enters a shallow column; full speed 9.5 (12 with run) within 2 s; a leap returns to the level; a
  refused leap gives the 0.5 hop; steering straight at the world edge for 5 s never stalls more
  than 0.5 s and never shows the shallow toast; a block placed at `level + 1` or `level + 2` on the
  dolphin's cell ends the ride with `'blocked'` on the next step; the ahead check refuses a column
  with a block at `level + 2`; the hop-off spot is inside liquid with a free body (fake
  `bodyBlocked`); `standSpot()` equals it.
- **S5 schedule**: `whaleTime(seed, day, 0)` in `[0.32, 0.44]` and `(seed, day, 1)` in
  `[0.52, 0.64]`, the same for the same inputs, at least 10 different values over days 1 to 20;
  `whalePhase` is null outside the 0.042-day windows, `p` 0 to 1 inside; a clock frozen inside a
  window shows it once (latch); a first sight at `p = 0.5` plays from the dive part, at `p = 0.65`
  skips; the frozen-clock predicate uses `hostFrozen` for a shared guest and `timeFrozen`
  otherwise; placement with fog far x 0.7 (rain) on Cozy from the island centre falls back or
  skips as §5.8 says; `buddyOf(seed, biome)` is stable.
- **S6 presence**: `parseSeaRide` accepts 0..15, rejects -1, 16, 1.5, '3', null, [], {}, NaN;
  `parseSeaTrick` accepts 0..65535, rejects -1, 65536, 1.5, '3', null, [], {}, NaN.
- **S7 append-only guard**: hard-coded copies of today's `SEA_KINDS` and of every palette's keys
  equal the first N entries of the exported lists (recorded when step 2 lands; the
  `probe-boys.mjs:41-55` pattern); `OCEAN_STAR_KINDS === 9`.
- **S8 caps**: the capacity and the low-quality caps of §4.2 / §11.2; a new pod is refused when
  free wild slots < pod size + 1.
- **S9 static scans** (comment lines stripped): no `while (` in `src/life/ocean/**`; every value
  of `SEA_TEXT`, every `DOLPHIN_NAMES` entry and the new `chat.js` strings scanned for `$`,
  "buy", "price"; none of the owner's forbidden names and none of the names on the character
  list in the scanner, as whole words (both stored encoded in the shared scanner
  `tools/lib/name-scan.mjs`: `scanText(text)` and `scanCharacters(text)`); no
  dolphin name equal to any pet name in `src/things/pets/`; every string of §7 present exactly
  in `SEA_TEXT`.

### 13.2 `tools/test-net.mjs` (a separate `seaTests()` block at the end, the vehicles precedent `:1789`, and its runner line `:2014`)
- N1 `avatarFields` with `local.sr = 3`: the patch has `sr: 3`; the same value again: no `sr` in
  the next patch; `sr: null` → `sr: null` once; a bad value (`'x'`, 99) → null. The same for `sk`.
- N2 host presence with `sr`, `sk`, `vh`, `hi`, merfolk's `st: 'm'` and a 152-character `lk`:
  ≤ 3,900 B (the check at `:1793-1820`).
- N3 the fake adapter sends `sr` / `sk` only when a test sets them; the property test runs
  unchanged.

### 13.3 `tools/test-saves.mjs` (next to the `lookPicked` test, `:486-492`)
- M1 `mergeProfile`: local `stats.seaMet = { dolphin: 3, fish: 1 }`, server `{ dolphin: 1, crab: 2 }`
  (either newer) → `{ dolphin: 3, fish: 1, crab: 2 }`; `stats.dolphinRides`, `seaCoinDay` and
  `seaCoinMask` take the max.
- M2 `mergeBackupProfile` (imported from `src/core/storage.js`): the same maps join by maximum;
  an old backup without `seaMet` leaves the current one alone.

### 13.4 `tools/probe-ocean.mjs` (browser; the `probe-vehicles.mjs` structure)
Imports `launch, openGame, startWorld, waitForPlay, settle, shot, finish, parseArgs, screenPoint`
from `./smoke.mjs`; its own `check()` printing FAIL lines (`probe-vehicles.mjs:34`); shots
`.shots/ocean-*.png`; probe-only page settings `tutorialDone = true`, `quality = 'low'` for the
SwiftShader passes except the cost pass (as `probe-vehicles.mjs:47-58`). Flags
`--only=world|see|tap|ride|touch|biomes|saves|mp|cost`. Check messages carry these ids. About 10
to 12 minutes in total.

**A. world (desktop 1280x800, beach Cozy)**
- O1 `mapStats()` after load: liquid / deep counts equal the Node numbers for the same seed; build
  time logged.
- O2 teleport to `deepSpot()` (swimming, first deep swim of the session): a pod of 2 to 4
  dolphins within 6 blocks **within 10 s**; the buddy toast once; over 300 sampled frames every
  dolphin's column passes the rule unless it is leaping.
- O3 within 60 s at least one leap (`stats().leaps`), splash particles seen, `leapApex` ≤ surface
  + 2.0; blowhole puffs counted (`stats().puffs` > 0).
- O4 teleport to `lagoonSpot()`: a fish school within 25 s; no dolphin ever inside the lagoon.
- O5 night (`setTime(0.9)`): at least one jelly within 26 blocks of a deep spot; its `iTint.w` >
  0.3 and a fish's is 0; `whaleNow()` refused at night (no whale).
- O6 a crab on a shore cell within 30 s at `shoreSpot()`; walking at it until 1.4 blocks: it
  scuttles sideways and stays within 4 blocks (or hides with its eye stalks out); a tap on it
  counts as meeting it.
- O7 drive a Speedboat (placed with `entities.place`, driven with `debug.vehicles`) at full speed
  over deep water for 20 s: a dolphin within 6 blocks for ≥ 5 s, at least one ahead of the bow,
  at least one leap while escorting.
- O8 build a block into a dolphin's cell (`world.setKey` with record): within 1 s the dolphin is
  in liquid again or gone; no console error.
- O9 world unload and back to the title: `game.pickables.size` equals the baseline before the
  world; `count()` is all zeros; sea meshes hidden.
- O10 place a Magic House (prefab, the `record: false` path) on deep water next to a pod: within
  5 s no dolphin's position is inside a solid cell; a ride steered at the house stops before it.
- O11 standing at spawn on beach Cozy facing the sea (clear day): the show pod is placed within
  20 s and leaps at least once in view; it is not in `game.pickables`.

**V. see (desktop and iPad sizes, the real swim camera)**
- V1 the player swimming at `deepSpot()` with the default third-person camera; `debug.ocean`
  spawns, one at a time, a dolphin, a fish school, a sea turtle and a jelly 4 to 6 blocks in front
  of her (their normal state, not frozen). For each: two shots of the same frame time, with
  `pause(true)` + hidden meshes and without; the mean pixel difference inside the animal's
  projected box is above a set threshold (recorded at step 4 on the reference machine, a
  delta-E of at least 12 to start), so each animal is clearly visible from above the water.
  Seabed animals: a bubble trail is seen within 3 s (particle count rises within 12 blocks).
  Shots `ocean-see-*.png` go to the daughter for review with the gallery.

**B. tap (desktop, real mouse clicks at `screenPoint` of the animal, Hand tool)**
- T1 click a dolphin while swimming: it goes to `'hold'` beside her (no trick), the bubble shows
  the dolphin's name, "Ride" and "Trick"; sticker `dolphin_friend` pops; **no** first-meet toast
  (the sticker covers it); coins +20 and +2; one NPC line at most; `stats.seaMet.dolphin === 1`.
  Click Trick: a trick plays (`state 'trick'`).
- T2 click a dolphin from a moving boat: trick, no bubble, toast "Stop the boat to ride a
  dolphin!" once (a second click: no second toast). Stop the boat (speed < 1), click a dolphin
  within 4 blocks: the bubble shows Ride.
- T3 with a block selected in the hotbar, click a dolphin: no block placed (`history.length`
  unchanged); with the Remove tool, click a leaping dolphin: nothing removed.
- **T3b** with the Remove tool, click a fish school 1 block under the surface (and once more
  with a right-click and the Hand tool): greet (scatter, `seaMet.fish` +1); `world.get` of the
  water cell above it unchanged, `history.length` unchanged. With the camera below the surface
  (merfolk dive, or the player teleported 2 blocks under): the same.
- T4 click a fish school: scatter state, bubbles, toast "You met a Little Fish!" with an `<img>`
  in it.
- T5 spawn and click a sea turtle, an octopus (its tint changes), a jellyfish, a seahorse, a crab,
  a starfish: each first meet shows its picture toast once, except the one that pops
  `sea_explorer`; daily coins +2 each, a second hello the same day pays nothing.
- T6 Hand-click a Starfish **block** on the beach: star particles, counts as `starfish`; with
  Build, the block is replaced as today.
- T7 `whaleNow()` with the camera facing the sea: the whale is in the frustum, spouts, the toast
  "A whale says hello! Look at the sea!" only after it is placed, `whale_hello` after 1.5 s; with
  every kind met, `ocean_star` is earned; the Sticker Book shows 5 new sea stickers with art and
  the Sea Friends strip with 9 colored slots (screenshot); with one kind unmet, that slot is a
  silhouette (screenshot).
- T8 `whaleNow()` with the camera facing inland: the edge pointer shows; turning toward the whale
  hides it. `weather.set('rain')` on Cozy from the island centre: either a whale inside fog far or
  no toast at all (never a toast without a whale).

**C. ride (desktop)**
- R1 bubble Ride: `player.state === 'ride'`, `mounted.kind === 'dolphin'`, camera `extraWant` 1.5,
  tool Hand, toast "Steer with W A S D! Space to jump!", `dolphin_rider` earned,
  `stats.dolphinRides === 1`, daily ride coins +5 once.
- R2 hold W for 3 s: moved ≥ 18 blocks, always on qualifying water at one level; hold Shift+W:
  speed reaches 12, splash trail, `extraWant` rises toward 2.
- R3 Space: the player's y rises ≥ surface + 1.3 and comes back; splash; a double Space does
  **not** start flying; under a bridge, Space gives the small hop.
- R4 steer at the shore: stops; toast "Dolphins stay in deep water!" at most once per 4 s; never
  enters a shallow column. Steer at the world edge (`edgeSpot()`): a U-turn, no toast, no stall
  longer than 0.5 s.
- R5 the Hop off button: state `'swim'`, feet in liquid, `'sea:hopoff'` reason `'button'`, label
  "Swim"; X also hops off, and E with the Hand tool only hops off (no other animal greeted, no
  door opened); the dolphin stays beside for 20 s; `seaForm` is unchanged by the hop-off (a sea
  form that was on stays on, with no turn sparkle).
- R6 remove the water under the riding dolphin (`removeBlock` on its cell, as a friend's edit):
  hop off with "Splash! Off you go!", no error.
- R7 save while riding, reload: the player loads swimming near the spot; no ride; no error.
- R8 build a block onto the dolphin's cell while riding: refused (`overlapsCell`); picking the
  Build tool while riding switches back to Hand with "Hop off first!"; a right-click on the water
  beside the dolphin changes no block.
- **R8b** a friend's block (`net:applied` path) at `level + 1` on the ridden dolphin's cell: the
  ride ends with `'blocked'` within 1 frame and the player is free (`bodyBlocked` false) after
  `unstickPlayer`.
- **R9** `debug.teleport` while riding: within 1 frame the label is "Walk", `extraWant` 0,
  `rideField()` null, `'sea:hopoff'` reason `'lost'`; the dolphin is back in the wild list.
- R10 sea form while riding (with merfolk): a mermaid and a sea dragon each ride; `seaForm`
  stays set through mount and hop-off; screenshots `ocean-ride-mermaid.png`,
  `ocean-ride-dragon.png` for the daughter to approve.

**D. touch (iPad 1024x768, `touch: true`)**
- U1 tap a dolphin with `page.touchscreen.tap`: the bubble; its rectangle does not overlap the
  joystick, the Jump button, merfolk's Up / Down buttons (when shown), the life column,
  `.sw-toasts`, `.sw-stkpop` or the coin pill (the overlap math of `probe-menus.mjs:24-38`); the
  bubble's rectangle moves less than 40 px over its first 3 s open; it is still open 8 s later
  while a sticker pop shows.
- U2 tap Ride; the joystick label reads "Ride"; a CDP touch drag on the joystick
  (`probe-vehicles.mjs:752-753`) moves the dolphin; the Jump button leaps; tap Hop off; label
  "Swim". The Help panel's Touch tab shows the dolphin card. Screenshots: bubble, riding, leap.

**E. biomes and saves**
- B1 candy: dolphins and fish use candy palettes; fish appear in the chocolate-milk pond.
- B2 flat: no sea life for 30 s; build a 5x5x2 water pool with `world.batch` and **stand at its
  edge**: a fish school within 30 s and the toast "Fish moved into your pool!"; a 17x17x4 pool,
  standing at its edge: a dolphin pod within 45 s and "Dolphins came to your pool!"; a 2-deep pool
  never gets dolphins.
- B3 snow: no fish under the ice-capped part of the pond.
- D1 the old profile fixture (`tools/fixtures/boys-old-profile.json`, the `probe-boys.mjs:603-629`
  method): loads; no `seaMet`; one tap creates `seaMet.fish = 1` and `seaCoinDay`; a reload keeps
  them.
- D2 the old world fixture (`tools/fixtures/old-world-96565e4.json`, loaded as in
  `probe-vehicles.mjs:960-972`): loads with sea life; no console errors.
- D3 a beach world saved, 60 s of sea life with taps and a ride, saved again: the world's `blocks`
  string and `systems` keys are identical apart from `player`, `time`, `weather` (sea life writes
  nothing).

**F. mp (the `NetHub` + `FakeClaudeHub` setup of `probe-vehicles.mjs:984-1004`)**
- P1 Rosie (guest) rides a dolphin: on Lily's page `debug.net.remote()` shows Rosie with `st 'h'`
  and `seaRide` set, one remote ride dolphin with its saddle within 0.6 blocks under her seat
  (`debug.ocean.list`), within 2 s; Rosie hops off: it is gone within 2 s.
- P2 both pages run `whaleTime(seed, day, k)` to the same values; forcing a shared moment
  (`setDayTime` on the host) starts the whale on both pages within 8 s, at the same visit part.
- **P2b** Lily joins when the host's window is at `p = 0.5`: her whale shows the dive, never a
  fresh rise; at `p = 0.7` she sees none.
- P3 Rosie taps animals: her stickers, coins and `seaMet` change, Lily's do not; the host journal
  has no new entries from sea life; hashes stay equal (`converge`).
- **P4** Rosie's page closes while she rides: on Lily's page the remote dolphin is gone within
  2 s and `debug.ocean.list('dolphin')` is back to the wild count.
- **P5** Lily joins while Rosie already rides: Lily sees the dolphin under Rosie within 2 s.
- **P6** Rosie taps a dolphin's Trick: on Lily's page a dolphin within 12 blocks of Rosie plays a
  trick with hearts within 2 s; Lily joining after that trick sees no replay.
- **P7** both pages show the same buddy name in the buddy toast.

**G. cost (desktop, quality auto)**
- C1 draw calls: a fixed camera over the sea (the `drawCallsOf` median of 5,
  `probe-vehicles.mjs:245-278`), every kind spawned at full count: sea groups ≤ 9 calls; with
  `pause(true)` and cleared pools vs on: difference ≤ 9.
- C2 systems stage average over 120 frames with full counts ≤ idle + 1.0 ms
  (`probe-vehicles.mjs:470-478` method).
- C3 `renderer.info.memory.geometries` after 3 minutes of spawning and despawning ≤ the value
  after the first 10 s + 2 (geometries are built once per kind; thumbnail clones are disposed).
- C4 after 60 s every creature position is finite; no frame longer than 1 s (`diag.report()`).
- C5 `debug.ocean.gallery()`: the nine models in a row, day and night screenshots, plus every
  palette of the fish and the starfish. Reviewed with the daughter **and** with the owner for
  "does this look like a famous character?" before step 4.

### 13.5 Existing suites that must stay green
`npm run smoke`, `npm run test:net`, `node tools/test-walkie-unit.mjs`, `npm run test:walkie`,
`npm run probe:railway`, `node tools/probe-net-ux.mjs`, `node tools/site-check.mjs`,
`node tools/probe-keepsafe.mjs`, `node tools/probe-shops.mjs`, `npm run probe:mp`,
`npm run test:accounts`, `npm run test:billing`, `npm run test:saves`, `npm run e2e:accounts`,
`npm run test:name`; and, because they cover touched files or the same scenes:
`node tools/probe-environment.mjs` (ambient life), `node tools/probe-life.mjs` (pets swim),
`node tools/probe-pals.mjs` (friends' lines), `node tools/probe-menus.mjs`,
`npm run probe:vehicles` (boats on the beach, `park`), `npm run probe:boys`,
`npm run test:vehicles`, `node tools/test-net-game.mjs`, and merfolk's `probe-merfolk.mjs` /
`test-merfolk.mjs` once they exist. Browser suites one at a time.

Known edits likely in existing tests:
- `probe-vehicles.mjs:469-513` compares draw calls and the systems stage while driving vs parked
  on the water. Sea life near the boat can add 1 to 4 calls between the two samples. Set
  `__game.debug.ocean.pause(true)` in that probe's setup (as it sets `tutorialDone`), so the check
  keeps measuring vehicles only.
- `probe-pals.mjs` line counts (`lineCount()`, `chat.js:257-266`) grow by the new lines if a
  check pins the total.
- The sticker total (37 with ours) only matters if a probe pins it; none does today (grep:
  `probe-environment.mjs:301` reads it without pinning).
- Any probe that removes water by clicking through a pickable: none found today; T3b covers the
  new rule.

---

## 14. Build order

1. Record goldens before any change: today's `chat.js` line count; a beach world save and its
   profile from `669b6fa` as `tools/fixtures/ocean-beach-669b6fa.json` (for D3). Run nothing else.
2. `kinds.js`, `seamap.js` (with `tick`), `schedule.js`, `tools/test-sea.mjs` S0, S1, S5, S7, S8.
   Run `npm run test:sea`.
3. `models.js`, `material.js`, the meshes in `index.js` with `debug.ocean.spawn` / `gallery()`
   only (no spawning rules yet), thumbnails. Screenshot the gallery by day and night; tune the
   looks with the daughter; the owner's famous-character check. Run `smoke`.
4. `motion.js` and the `ocean` system: spawn rules with fallback (§3.3), the surface band and
   puffs (§5.1), the show pod, the buddy, despawn, sea-map hooks and `tick`, pickables (moved
   every frame), the `game.js` `throughLiquid` change, `greet()`, picture toasts (`ui.js`
   `opts.img`), `stats.seaMet`, daily sea coins, the Starfish block hook. Test S2, S3; probe A, V,
   B (without the ride), E. Run `probe-environment`, `probe-life`.
5. `ride.js`, `ui.js` (bubble, hold, Hop off), `removeLock` and the tool lock, the vehicles
   `pose()` and `park({ reason: 'sea' })`, the two `player.js` lines, the touch label and help
   cards, the `dolphin` icon. Test S4; probe C (R10 once merfolk's pose lands), D. Run
   `probe:vehicles` (with the pause edit), `probe-menus`.
6. The whale (two windows, phase-driven, latch, placement fallback, pointer, personal visit, edge
   wave), `sfx.js`. Probe B T7, T8.
7. `stickers.js` with art; the Sea Friends strip and the `stickerbook.js` hook; friends' lines and
   invites. Run `probe-pals`.
8. Multiplayer: `parseSeaRide`, `parseSeaTrick`, `avatarFields`, `adapter.local()`,
   `remote-players.js` (`sr`, `sk`, `clear()`), the fake adapter; `test-net` N1 to N3 and the
   runner line; probe F. Run `test:net`, `probe:mp`.
9. Docs: `DESIGN.md` (activities row "Sea animals", the 5 stickers, the events of §4.7, an
   environment bullet, the ocean sub-section of the one wave-4 section), `MULTIPLAYER.md`
   (§9.4), `DATA-MAP.md`, `test-saves` M1, M2. The website sentence goes with the integrator.
10. Cost pass G, then the full gate of `docs/teams/wave3-critique.md:167-182` plus §13.5. Builders
    never commit `dist/*`; the integrator rebuilds once and pushes once.

---

## 15. Coordination with the other wave-4 teams

**Merfolk (sea form, swim controls, underwater picture)**

*Joint decision: the sea form stays while riding a dolphin.* Merfolk's doc currently says the
opposite ("No riding dolphins (the ocean team's call; riding is always 'no sea form')",
merfolk.md:64; "A dolphin ride ... is a `ride` state: no sea form while riding", merfolk.md:853;
the `mount()` cut in its §6.5 table, merfolk.md:611-612). Ocean's call, which merfolk.md:64 leaves
to us, is that the mermaid keeps her tail, because a mermaid (or sea dragon) riding a dolphin is
exactly the picture this family asked for, and losing the tail on Ride and getting it back on Hop
off would feel like the game taking the mermaid away. The text below is ready for merfolk.md; the
merfolk team (or the integrator) applies it, and both docs then say the same:

> **Riding a dolphin (with the ocean team).** While `player.mountPet.kind === 'dolphin'` the sea
> form **stays**: `mount()` does not cut it (no sparkle, no sound), and Hop off does not turn it
> again. The avatar reads `s.seaRide` and `s.seaKick` (from `player._syncAvatar`, ocean §6.5) and
> shows a **sea-ride pose**: lying along the dolphin's back, hands on the dorsal fin, the tail
> trailing over the flukes, the tail kick in phase with `seaKick`. `seaTarget` keeps the form when
> `s.riding && s.seaRide` (`seaTarget = s.sea && form !== 'me' && !s.sitting && (!s.riding ||
> s.seaRide) && !s.sleeping`). "Just Me" keeps today's saddle pose. While riding, presence `st`
> stays `'h'` (`pl.seaForm && pl.state !== 'ride' ? 'm' : ...`), so presence `sr` keeps meaning a
> dolphin ride; friends' pages show the form from `sr` (`sea: st === 'm' || seaRide`). Touch
> controls while riding: Jump shows (the dolphin leaps), Up / Down hide. A riding leap
> (`'sea:leap' { riding: true }`) also counts for **Big Leap!**. Probe: a mermaid and a sea dragon
> riding, screenshots for the daughter (ocean R10, merfolk B10 gains a dolphin row).

Other lines:
- Ocean reads `player.swimming` and `player.state === 'swim'` only. If merfolk adds hysteresis or
  a minimum depth to swimming, pods simply arrive by the new rule; nothing to change here.
- Escort uses `game.seaSwimmers()` when present (merfolk.md:845), else friends with
  `st === 'i' || st === 'm'`, so friends in sea form are escorted.
- `'player:leap'` (merfolk.md:298): escorting dolphins leap with her (§5.2).
- Diving: near the player the animals are at the surface (so they show from above), and seabed
  animals send up bubble trails, so a diver knows where to go. Under the surface there are no
  faces between water cells, so a diver sees everything clearly. Ocean adds no input.
- Underwater tint or fog through `scene.fog` applies to the animals automatically (Lambert).
  Merfolk owns the underwater overlay (merfolk.md:850-852); ocean adds none.
- Names: ocean's system, folder, facade and debug object are `ocean` (merfolk has `sea`).
- Shared lines: `adapter.local()` (merfolk's `st` and `_lk` lines, merfolk.md:362; ocean's `sr`,
  `sk`), `remote-players._frame` (both set flags in the same `av.update` call),
  `tools/test-net.mjs` (`merfolkTests()` and `seaTests()` blocks and runner lines),
  `src/ui/touch.js` (merfolk's Up / Down and "Swim" label; ocean's Ride label and help card),
  `src/main.js` (merfolk's `sea` after `stickers`, ocean's `ocean` after `collectibles`). U1
  includes merfolk's Up / Down rectangles; R5 expects the form to stay across hop-off.
- Merfolk's sea form is in the look (wardrobe lists, codec); ocean never touches either.

**Squishies & presents (collections, coin milestones)**
- Ocean adds 100 coins of stickers once, plus the daily sea reward (at most 23 a day, §8), all
  through `coins.add`, so `stats.coinsEarned` grows (`coins.js:97-98`) and their milestones keep
  moving while a kid plays at sea.
- If they want sea-themed squishies (a dolphin squishy, a starfish squishy), they make their own
  models; ocean's geometry is shaped for instancing and bending, not for holding. The sea
  thumbnails (`game.ocean.thumb`) can be reused for a present-reveal picture if they like.
- Both teams may add life-column buttons; ocean's `seahop` uses order 0 and only shows while
  riding a dolphin, so it never sits beside a "Present!" button for long.

**Integrator**
- Sticker registration order in the book (all teams register on `game:ready`).
- One `## 7. Wave 4` section in `DESIGN.md` with sub-sections 7.1 to 7.3 (squishies.md:355 and
  this doc both asked for a "§7").
- The `site/index.html:111` sentence.
- Applying the merfolk text above to merfolk.md if the merfolk team has not.
- One `npm run build`, one commit of `dist/*`, one push.

---

## 16. Risks and open questions

- **Q1 Ride from a boat.** Resolved: a stopped boat (speed < 1) with a dolphin within 4 blocks
  offers Ride and leaves the boat parked on the water; a moving boat says "Stop the boat to ride a
  dolphin!" (§6.1). Still open: should the kid be able to get back into the parked boat from the
  dolphin with one tap? Proposed: v1 uses the normal way (swim to it, tap it).
- **Q2 Names on wild dolphins.** Resolved: the buddy dolphin per world (§5.2) gives a dolphin to
  come back to without saving anything. Naming your own dolphin would need saving and is left out.
- **Q3 The whale's size.** 8 blocks long and always 55+ blocks away so it reads as gentle, not
  scary. The daughter should see it before shipping (gallery screenshot, step 3).
- **Q4 Existing names to review (not this team's files, for the owner).** Pet name lists hold
  names that belong to famous characters or brands: `Squirt` and `Bubbles` (turtle,
  `turtle.js:12`; famous film sea creatures), `Nala` (cat; a famous film lion), `Thumper` (bunny;
  a famous film rabbit), `Oreo` (panda; a cookie trademark), `Spirit` and `Duchess` (horse; famous
  film animals), `Aurora` (unicorn; a famous film princess), `Pebbles` (turtle; a cartoon
  character), `Buttercup` (a cartoon character). Ocean's own dolphin list avoids all of these and
  every existing pet name; a grown-up reads it once more before shipping.
- **Q5 Cooler animals and biome seas.** v1 appends bolder palettes (`deep`, `teal` dolphins,
  `midnight` turtles, §3.2) so the sea is not all pastel. A later append (APPEND ONLY to
  `SEA_KINDS`, never counted by Ocean Star): one biome-only animal per sea, e.g. a narwhal in the
  snow sea (a natural sister to the game's unicorns) and a gentle manta ray, so each sea has one
  thing to find.
- **Risk: kids still can't see something.** V1 measures it from the real swim camera; if an
  animal fails the threshold, it comes closer to the surface, never brighter water or lower
  water quality.
- **Risk: other probes' budgets.** Sea life near water adds draw calls to any probe that measures
  a scene by the sea (vehicles today). Mitigation: `debug.ocean.pause(true)` in those probes,
  named mesh groups in the breakdown.
- **Risk: tapping small animals on a phone.** Mitigated by padded pick boxes, one box per fish
  school, boxes moved every frame and taps that go through the water; probe U1 checks a real tap.
- **Risk: performance on old iPads.** Instancing keeps calls to at most 9; if a real 2019 iPad
  drops frames at sea, the levers are CPU first (half-rate stepping beyond 15 blocks, 2 Hz
  pickable refresh), then thinning far-away schools only; never schools within 12 blocks of the
  player, never picture quality (§11.2).
- **Risk: merfolk does not adopt the riding decision.** Then the avatar shows the saddle pose
  and merfolk's `mount()` cut fires; nothing in ocean breaks, but R10 fails and the owner should
  decide. Ocean's side (`seaRide`, `seaKick`, `st 'h'` while riding) is the same either way.

---

## 17. Review notes

Revision 2 applies every blocker and major issue from both reviews and every minor one, with
these choices where the reviews offered options or disagreed:

- **Sea form while riding.** One review asked to keep the sea form on a dolphin (a joint decision
  in both docs); the other asked to drop `seaRide` because merfolk.md says "riding = no sea form".
  This revision keeps the sea form (§0, §6.5, §15): merfolk.md:64 leaves the call to ocean, and a
  mermaid on a dolphin is what the owner asked for. `seaRide` is therefore no longer dead code.
  I did **not** edit merfolk.md myself: it is the merfolk team's file and may be under revision
  in parallel; §15 holds the exact text for it, and the integrator checks it lands.
- **Remove taps through the water.** One review offered a `throughLiquid` flag in `pick()` or a
  sea-side hit test; the other a pick box raised to `top + 1.02` to avoid touching `game.js`.
  I chose `throughLiquid` (§5.6): the raised box fails when the camera is under the water (the
  voxel ray skips the camera's own cell and hits the next water cell less than a block away,
  `raycast.js:88-95`), which merfolk's diving makes common. It costs one extra voxel ray only on
  Remove taps over water.
- **Riding with Build / Remove.** The reviews suggested either a "Hop off first!" guard or a trick
  on a Remove tap. I used the vehicles model (Hand tool locked while riding) plus a small
  `removeLock` hook, because right-clicks and strokes reach `removeTarget` whatever the tool.
  This also settles the E-key note: with Hand locked, E only hops off.
- **Bubble size.** One review wanted Ride "biggest", the other the existing 56 px faces. Both:
  56 px faces, Ride at `scale(1.15)` with a pulse.
- **Misty.** The suggested names kept "Misty", which is also a famous video-game character, so it
  is replaced by "Skimmer" and added to the S9 list. "Ziggy" (a comic-strip character) is dropped
  too.
- **Whale fallback.** One review allowed either "nearest ring point" or "skip". I used both, in
  order: the nearest point at least 55 blocks away if it is inside 0.95 x fog far, else skip with
  no toast, so a toast never fires without a whale.
- **Frozen-clock whale period.** Shortened from 600 s to 360 s to match two visits per 720 s day.

---

## As built (P1)

Built on `claude/wave4-ocean` from step 0 (`582d11c`), steps 1 to 8 of §14 except the parts that
need merfolk (below). The integration plan's corrections apply: the folder, system, facade and
debug object are `ocean` (C1), the stickers install with `installOceanStickers` (C14), the pose on
a dolphin is merfolk's side-saddle (C2), escort uses the friends fallback only (C6), and the
joystick label is the one function of integration §5.2 (C8).

**Files.** `src/life/ocean/`: `kinds.js`, `seamap.js`, `schedule.js`, `models.js`, `material.js`,
`render.js` (the nine instanced meshes, slot compaction), `motion.js`, `ride.js`, `whale.js`,
`ui.js`, `sfx.js`, `stickers.js`, `index.js`. Shared lines as integration §5: `main.js`,
`game.js` (`throughLiquid`, `removeLock`), `player.js` (the two §5.2 lines), `ui.js` (`opts.img`),
`stickerbook.js` (`stickerBookExtras`, built on the book's first open), `touch.js` (the label
function with the Ride branch, `PICS.dolphin`, the two help cards and the "Hop off a dolphin" row),
`pets/kit.js` (`dolphin` icon after `hopoff:`), `vehicles/index.js` (`pose()`,
`park({ reason: 'sea' })`), `friends/chat.js` and `friends/index.js`, `protocol.js`, `host.js`,
`adapter.js`, `remote-players.js`; tools: `test-sea.mjs`, `probe-ocean.mjs`, `test-net.mjs`
`seaTests()` (N1-N3, N2 is the combined wave-4 worst case of integration §4.3: 572 B host
presence), `test-saves.mjs` M1-M2, `test-name.mjs` (the sea string tables), `fake-adapter.mjs`,
`name-scan.mjs` (one more name on the character list), `probe-vehicles.mjs` (`pause(true)` in
setup), `package.json` (`test:sea`, `probe:ocean`), `.github/workflows/test.yml`. Goldens:
`tools/fixtures/ocean-beach-669b6fa.json` (a beach Cozy world and profile from the untouched base,
the `chat.js` line count 253; it is 271 now).

**Where the build differs from the design** (the build is right):
- Sea turtles swim higher near her (centre 0.2 to 0.45 under the surface, not 0.3 to 0.8): with
  the lower band their shells failed V1 (the §16 rule: closer to the surface, never brighter water).
- A dolphin's leap also needs every column under its path to be deep (S4 asks for deep water under
  the centre at every step); a refused leap's small hop only happens when there is room over the
  rider's head (a low roof would otherwise end the ride as `'blocked'`).
- Space asks for the leap on the key itself (a quick tap can fall between two frames on a slow
  device, the vehicles' honk precedent).
- The whale's place is sampled from her position (24 directions, the one closest to her view
  first), not from the island's centre: from a deep spot near one edge, every centre-based
  direction in view was closer than 55 blocks.
- A friend's dolphin is hidden while her presence is away (a closed page), so it goes at once.
- The Ride / Trick bubble moves below (or beside) a sticker pop or a toast instead of covering it.
- The show pod is stepped by its own function (it froze while no wild pod was out), heads along
  open water and retries a refused leap a second later.
- Hellos to a crab whose shore was built away: it moves to the nearest shore cell within 2 or goes.
- Owner decision: the name dropped from the turtle's new-pet list (`turtle.js`; pets keep theirs).
- Debug helpers beyond §4.8 for the probes: `still(on)`, `autoSpawn(on)`, `popups(on)`,
  `shiftSchool(i, dy)`, `palettes(kind)`, `cap(kind)`, `fields()`, `remote()`, `bubble()`,
  `schools()`, `pods()`, `buddy()`, `tapRec(kind, i)`, `slotTint`, `meshCounts`, `corrupt`.
- Probe timings are in game time where they measure gameplay (SwiftShader draws few frames and the
  game steps at most 0.05 s a frame, so game time runs at about half the wall clock here).

**Not built in P1 (needs merfolk; P2 on the merged tree):** R10 (a mermaid and a sea dragon
riding, `ocean-ride-mermaid.png`, `ocean-ride-dragon.png`), T3b with the camera under the surface,
U1's Up / Down rectangles, the `wave4` pass (integration §9.1, X1-X10). Until merfolk lands,
`player.seaSwim` does not exist, so R5 and U2 accept "Walk" after Hop off (they expect "Swim" once
merfolk's label branch is live; the probe reads `seaSwim` and checks the right one).

**Probe passes (solo, this machine):** `world` 230 s, `see` 51 s, `tap` 80-110 s, `ride` 100 s,
`touch` 42 s, `biomes,saves` 150 s, `mp` 265 s, `cost` (with the gallery) 276 s. Every gate
group of integration §10.2 B11-B16 stays under 450 s.

**Wanted text for the integrator (C17):**
- DESIGN.md §1 activities: "Sea animals: dolphins, little fish, sea turtles, an octopus,
  jellyfish, seahorses, crabs, starfish and a whale; tap to say hi, ride a dolphin." Stickers:
  Dolphin Friend, Dolphin Rider, Sea Explorer, Ocean Star, Whale Hello! Events: `sea:meet`,
  `sea:ride`, `sea:hopoff`, `sea:leap`, `sea:trick`, `sea:whale` (§4.7). Environment: "Sea life
  lives at the surface near her (the water is 75% opaque); one instanced mesh per kind; a sea map
  kept by events and a 2-rows-a-frame rescan." 7.3: this section.
- MULTIPLAYER.md: §5.4 `sr` and `sk` rows (§4.6), §7 the Sea animals row (§9.4), §9 the
  adapter / host / remote-players lines, §15 `probe-ocean --only=mp` and `test-net` `seaTests()`.
- DATA-MAP.md:50: "(including which sea animals they met)".

**Review pictures (owner review, integration §7.3):** `.shots/ocean-gallery-day.png`,
`ocean-gallery-night.png`, `ocean-gallery-whale.png`, `ocean-palettes-<kind>[-n].png` for every
kind (the dolphin palettes are sent by index: pinned by S7), `ocean-see-*.png` (the swim camera),
`ocean-tap-bubble.png`, `ocean-touch-*.png`, `ocean-ride-*.png`, `ocean-world-*.png`,
`ocean-tap-whale*.png`, `ocean-tap-seafriends-*.png`. The dolphin names in `DOLPHIN_NAMES` wait
for a grown-up's read (§16 Q4).

**Owner-review fixes (after P1).**
- *The empty gallery.* Root cause: in `gallery()`'s grid branch the `r.z = ...` and `r.y = ...`
  assignments sat on the same line as a `//` comment, so every grid animal kept a stale y and z
  (y = 0 under the sea floor, or wherever it last swam) and the gallery, night gallery and palette
  pictures showed empty water; only animals a non-grid picture had placed earlier (the whale, one
  dolphin) showed. Each assignment is on its own line now. C5 used to count the returned items; it
  now projects each animal to the screen and needs it inside the view with at least 40 of its own
  silhouette pixels near its centre, differing from the same picture without sea life by >= 30
  (the old code: 0 of 8 by day and night, 1 of 10 dolphin palettes; now every one).
- *Faint animals from the play camera.* The water is 75% opaque and the animals were drawn before
  it, so under the surface they showed at about 25%. The sea meshes now draw after the water
  (`material.js`: transparent with depth written, `renderOrder` 1, the water's chunks are <= 0,
  particles 10; no new draw calls): a pixel on the other side of the surface from the camera lets
  the water behind show through by 0.2 + 0.07 per block of depth (at most 0.42), is 8% brighter
  and has a soft light rim; pixels on the camera's side (fins, leaps, a camera under the water) are
  drawn as before. A new per-instance `iSurf` (the surface y; -1e4 for crabs and starfish on sand,
  and in the gallery) feeds it. The `sky` dolphin palette changed colour (#8EB8E0 to #7F98D4, its
  key kept): it was the water's own blue. V1 now measures the animal against the water it covers
  (diff) and against a 6-pixel ring of water around it (ring) for seven kinds (each first palette):
  the old look measured diff 16-38 / ring 8-25 (one seahorse breaking the water 70 / 44), the new
  one diff 72-161 / ring 57-152 (two runs); the gate is diff >= 60 and ring >= 50.
- *Owner pictures:* `node tools/probe-ocean.mjs --only=review` (not in the default run) writes
  `.shots/ocean-review-gallery-day.png`, `-gallery-night`, `-gallery-whale`,
  `-palettes-<kind>[-n]` (every palette), `-underwater` (a debug camera under the surface; merfolk's
  own under-water camera comes with P2) and `-play-desktop[-2]`, `-play-ipad[-2]` (her camera with
  animals swimming near her), the HUD and the target outline hidden (as a Photo hides it). The
  `world` pass's O2 (a pod within 10 s of game time) failed once at 15.9 s on a loaded machine and
  passed on the rerun (3.6 s); nothing here touches the pod.
