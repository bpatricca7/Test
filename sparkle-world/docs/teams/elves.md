# Team elves: the Twinkle Elves (wave 5)

Owner of `src/things/elves/` (module `elves`, facade `game.elves`, probes `game.debug.elves`),
`tools/test-elves.mjs` and this doc. Plan: `docs/teams/wave5-plan.md` §7.6.

The Twinkle Elves are twelve small elves of our own: round faces, rosy cheeks, a floppy pointy
hat with a little glowing star on the tip, a striped scarf, mittens, curly shoes. Each has its own
color scheme and a first name. They love hide and seek. They are never scary and never naughty:
they never move, break or change a block or a piece of furniture. Everything an elf does is an
entity of its own placed, moved and removed through `game.entities` on the host.

## 1. What you can do

- **Holiday Village**: an elf hides at every `holiday:elf` spot. Tap one: it giggles, hops and
  waves, says a line ("Peekaboo! There you are!"), sparkles, and a toast with its picture says
  "You found Pip! (3 of 12)". A found elf keeps a little gold star spinning over its head. Hints:
  a soft sleigh-bell jingle plays every few seconds when an elf you have not found is within 18
  blocks, louder and quicker the closer you are; within 5 blocks its hat star twinkles. A
  round "Elves" button with a `found/total` badge shows in the life column in any world that has
  hiding elves; it opens the **Twinkle Elves** panel (who is found, who is still hiding, with a
  progress bar). Finding all of them: a tune, confetti, a big toast and the `elf_all` sticker.
- **The elves' cottage** (`holiday:elfhome`): a glowing "Twinkle Elves" sign with **Bramble**
  (the greeter, in purple) beside it. Tapping either meets the elves (sets `met`) and opens the
  panel.
- **The house elf**: once you have met the elves (the sign, Bramble, the panel or a first find),
  an elf moves into any of your worlds (not Holiday Village) that has a bed. An **Elf Door** from
  the Bag (Holiday tab, "Twinkle Elf doorbell") brings one right away in any world, with a
  knock-knock. Every new game morning (`time:morning`, and when a world is loaded on a new real
  day) the elf hides somewhere new in or around your home: on a shelf, the fridge, a lamp, the
  wardrobe, the sofa, the bed, in the bath, on the floor somewhere, outside in the garden or up
  in a tree. Often (60 %) it sets up a tiny scene: cookies to share, a little note, a paper
  airplane, a snow angel in sugar, a cocoa cup bath with marshmallows, reading a book, a tiny
  snowman, a candy cane, a tiny present, and always a bubble bath when it hides in a bathtub.
  Find it and tap: a giggle, a line (the scene's own), a tiny surprise: 3 coins (within the daily
  cap) and for the cookie and candy scenes a treat in your basket. The bubble has **Yay!**,
  **Name** (give your elf its own name, 14 letters) and **Bye** (it goes home after a "Say bye?"
  question; an Elf Door brings an elf back). The Elf Door, tapped, says where the elf is hiding
  ("Knock knock! Pip is hiding on the fridge!"), and the panel has a **Hint** button.
- **Bag** (Holiday tab): **Twinkle Elf** (12 swatches, one per elf: a friendly figure that
  giggles and says hi when tapped, never hides), **Elf Door** (on a wall), **Elf Sign** (the
  cottage sign).

## 2. Keys and ids

| what | id |
|---|---|
| module | `src/things/elves/index.js` (`install(game)`) |
| system (`addSystem`) | `elves` |
| furniture | `elf_twinkle` (Twinkle Elf, 1x1x1, `placeOn: 'table'`, colliders none, 12 colors), `elf_door` (Elf Door, 1x1x1, `placeOn: 'wall'`, colliders none, 6 colors), `elf_sign` (Elf Sign, 1x2x1, a thin post collider, light 8, 4 colors). All in category `holiday`. Bag items `furn:elf_twinkle`, `furn:elf_door`, `furn:elf_sign` (made by `entities.define`). |
| entity actions | `elf`, `elf_door`, `elf_sign` |
| feature records | `holiday:elf` (`where`, optional `rot`), `holiday:elfhome` (optional `rot`) |
| events emitted | `elf:found` `{ role: 'hide', idx, name, found, total }` or `{ role: 'house', name, finds }`, `elf:all` `{ total }`, `elf:arrive` `{ name }` |
| events used | `game:ready`, `world:load`, `time:morning`, `entity:place`, `entity:use`, `ui:open`, `world:unload`, input `tap` |
| stickers | `elf_first` (Peekaboo!: find a Twinkle Elf), `elf_all` (Super Seeker: find all the elves in Holiday Village), `elf_home` (Elf Best Friend: find your house elf on 5 mornings) |
| thumbnails | `elf:face:0` .. `elf:face:11`, `elf:face:greet` |
| UI | panel `elves` (Twinkle Elves), life button `elves` (order 26), bubble `.lf-bubble.el-bubble`, CSS prefix `el-` |
| coin reason | `elves` |
| profile key | `profile.elves` |
| world save | `systems.elves` |
| icon (shared line) | `el_elf` at the end of `PATHS` in `src/things/pets/kit.js` |

### 2.1 Entity data (`elf_twinkle`)

| field | meaning |
|---|---|
| `role` | `'hide'` (a village elf), `'house'` (the house elf), `'greet'` (Bramble), none (a Bag figure) |
| `idx` | village elf number 0..29 (its bit in the found mask) |
| `sc` | color scheme 0..11 (else from the swatch color) |
| `name` | its name (`'Pip'`; the house elf's own name) |
| `hide` | the house elf's hiding number (1, 2, 3, ...: one per morning) |
| `scene` | `cookies`, `note`, `plane`, `angel`, `cocoa`, `book`, `snowman`, `candy`, `gift`, `bath` |
| `pose` | `stand`, `sit`, `lie`, `cup`, `peek` (a scene brings its own) |
| `dy` | the height above what `entities.place` gives by itself (a slab: -0.5, a sofa seat, a shelf top), so a reload shows it the same |
| `where` | a place word: the record's `where` in a village, `'on the fridge'` etc. for the house elf |

### 2.2 `profile.elves`

```
{ v: 1, met: bool,
  found: { [worldKey]: bitmask },   which village elves (data.idx) were found in each world
  home:  { [worldKey]: hideNo },    the last house-elf hide found in each world
  homeFinds: n,                     mornings the house elf was found (elf_home at 5)
  coinDay: yyyymmdd, coinGot: n,    the daily coin cap
  keys: [worldKey...] }             newest last; only 24 worlds are kept
```

`worldKey` is `'w' + base36(hash(seed:createdAt))`, so a guest in a friend's shared world and
the friend's own page agree on it, and progress is per player.

### 2.3 `systems.elves` (per world, host only)

`{ v: 1, house: { uid, name, sc, hide, stamp, spot: [x,y,z], prev: [[x,y,z] x <= 3], away, bed } }`
or nothing when the world has no house elf. The house elf's name lives here (it is world data,
plan §6.5) and on the entity.

## 3. Numbers

| number | value |
|---|---|
| coins a day (all elves) | at most 10 (`COIN_CAP`), counted on the device's day; a clock that went back pays 0 |
| a village elf's first find | 2 coins |
| the house elf's morning find | 3 coins |
| `elf_all` | needs a village of at least 6 hiding elves |
| `elf_home` | 5 mornings |
| village elves per world | at most 30 (the found mask is 30 bits) |
| house elf area | 9 blocks sideways, 3 down, 6 up from home (the Elf Door's front, else the bed you slept in, else the bed nearest you) |
| reach | a hiding place is at most 6.5 from the eyes of a cell you can stand in (the tap reach is 8), with nothing solid in between |
| jingle | within 18 blocks; volume 0.12..1 by closeness squared; every 1.3 s (close) to 4.5 s (far) |
| twinkle | within 5 blocks, every 1.2 s |
| a scene | 60 % of mornings |
| sweep | every 1.5 s on the host |
| animation | elves farther than 32 blocks from the camera stand still |

## 4. Where an elf may hide (`spots.js`, pure)

The picker sees the world through a small `view` (`view.js` builds it from the world and the
furniture; the test builds a made-up one). A hiding place is:

1. an **open** cell: plain air in your worlds (a village record may also stand where a plant or a
   snow tuft is, which `place()` clears: the world is brand new) with no furniture and no friend
   in it, not water;
2. with **support** right under it: a full block (dy 0), a slab (dy -0.5), or the top of a piece
   of furniture an elf may perch on (its collider top over the cell's middle, or its `surface`;
   never a toilet, stove, oven, campfire, grill, trampoline, swing, slide, well, fountain,
   ladder, zip line, pool, hot tub, a door, a vehicle, a rug, a wall or ceiling piece, another
   elf or a gift box);
3. **not where you stand**;
4. **reachable**: some cell within 4 blocks you can stand in (two free cells, a floor) has its
   eyes within 6.5 of the elf with nothing solid in between (a 3D line walk), **and** that cell
   is in the air around home you can get to without digging (a bounded flood fill from home,
   at most 80 000 cells). So a sealed room or a cave pocket under the floor is never used.

Candidates are weighted: furniture tops 3 (the bath 2.6), cells under a roof 1.3, outdoors 0.6,
divided by `1 + distance / 6`. A weighted random order (seeded by world, hide number and game
day, so every reload agrees) is tried until one is reachable. **Yesterday's spot is never
used**; the three before it sink to 5 % weight. Nowhere new fits: the elf stays where it was.
With no furniture at all the floor, the garden and trees still give plenty of places. On the
real biomes (meadow, snow, beach, fairy, candy, flat; seeds 1..3) every one of 30 mornings found
a good spot in about 5 ms.

The **sweep** (host, every 1.5 s): an elf whose support went away (a shelf picked up, a block
broken) hops down to the nearest good cell (reachable first), keeping its data and uid. It never
moves anything else.

## 5. Multiplayer

- Village elves, Bramble, the sign and the house elf are entities: placed and moved on the host
  only (`history: false`, no events, no sound, `players: false`), so friends see them. A guest
  never places, moves or sweeps.
- Finding is per player: each page keeps its own `profile.elves` (found masks by world key),
  its own coins (daily cap), stickers and gold stars. Every per-player listener starts with
  `game.net?.remoteApplying`.
- Renaming or saying bye to the house elf on a guest page refuses with
  `game.net.refuse('npc')`; tapping an Elf Door with no elf on a guest page does the same.
- The house elf only lives in your own worlds (`meta.shared` worlds get none).

## 6. One thing at a time

Toasts the module starts by itself (the arrival "Knock knock! Pip moved in!", "Good morning!
Pip is hiding somewhere new") wait in a small queue until nothing covers the world (the squish
team's `blocked()` rule, copied into `ui.js`), one every 4 s, dropped after 2 minutes, and are
off on `navigator.webdriver` pages unless `game.debug.elves.popups(true)`. Toasts from a tap
show right away (they answer the tap).

## 7. Files

| file | what |
|---|---|
| `index.js` | install: furniture, actions, placers, the system, events, house elf, jingle, sweep, facade, debug |
| `data.js` | pure: names, schemes, lines, scenes, numbers, profile and save helpers |
| `spots.js` | pure: the hiding-place picker (§4) |
| `view.js` | the world and furniture as the picker sees them |
| `models.js` | the elf (four baked meshes: body, head, arm, star; poses and held things), the Elf Door, the Elf Sign |
| `ui.js` | the bubble, the life button and counter, the panel, portraits, `blocked()` |
| `art.js` | the three stickers' art |
| `sfx.js` | jingle, giggle, knock, hello, tada (oscillators on the sound-effects bus) |

## 8. How to test

- `node tools/test-elves.mjs` (or `node --test tools/test-elves.mjs`): E1..E11: spots never in a
  solid block, always supported and reachable (300 mornings), never the same spot twice in a row,
  old spots sink, works with no furniture and in an open field, prefers furniture and uses the
  bath, never in a sealed room or a cave pocket or where you stand, null (no throw) when nothing
  fits, same seed same spot; `nearestSpot`, `lineOfSight`, `furnitureTop`, `localCell` (the
  inverse of the entity footprint for every size and turn); the daily coin cap (also across a
  merge), one house find per morning; found masks, normalize, merge, 24 worlds; the world save,
  names, swatches, world keys; no famous names, no he/she, no `while` / `Math.random` in the pure
  files; the `el_elf` line and every import of `index.js`.
- `node tools/build.mjs`, `node --test tools/test-name.mjs`, the vehicles, sea, merfolk and
  squish tests: all pass on this branch.
- In the game (`game.debug.elves`): `state()`, `list()`, `tap(uid)`, `morning()` (a new hiding
  place now), `arrive()`, `meet()`, `popups(true)`, `spots(n)` (n picks around home).
  Try: a meadow world, put a bed, open the panel (meets the elves) or put an Elf Door on a wall;
  `game.debug.elves.morning()` a few times; a world with no furniture; pick up the shelf the elf
  sits on (it hops down); a Holiday Village with its `holiday:elf` records; a friend joining.

## 9. As built

- Everything in §1 is built. The "Twinkle Elf doorbell" of the plan is the **Elf Door**; the
  "sign" is the **Elf Sign** (the cottage sign; from the Bag it is a way to meet the elves, then
  any bed brings an elf).
- Village elves face the spawn unless the record has `rot`. Some hold a candy cane, a present, a
  book, a snowman or cookies; some sit (on trees, shelves, fences, lamps, roofs, benches, steps,
  porches, chimneys).
- A record whose own cell cannot hold an elf (a block, furniture) moves to the nearest
  reachable good cell within 2 sideways, 4 down and 2 up; if none is reachable, the nearest
  supported one.
- A Bag Twinkle Elf placed by you is decor: it giggles and says hi, never hides, never pays.
- No new blocks, no shared file but the one icon line.

## 10. Wanted from the integrator

1. **Backups keep the elves** (`src/core/storage.js`): add `'elves'` to `BACKUP_PROFILE_KEYS`
   (line 87, after `'squish'`), and in `mergeBackupProfile` after the squish block:
   ```js
   // the Twinkle Elves: found elves are joined (nothing found is lost)
   if (isObj(f.elves)) {
     const joined = mergeElves(current.elves, f.elves);
     if (canon(joined) !== canon(current.elves)) current.elves = joined;
   }
   ```
   with `import { mergeElves } from '../things/elves/data.js';` (data.js imports nothing).
2. **Accounts keep the elves** (`src/account/merge.js`, `mergeProfile`, after the squish line):
   ```js
   if (isObj(local.elves) || isObj(server.elves)) out.elves = mergeElves(local.elves, server.elves);
   ```
   with the same import (or copy `mergeElves` and `normalizeElves` into `src/core/elves-merge.js`
   if the server must not reach into `src/things/`).
3. **package.json**: `"test:elves": "node tools/test-elves.mjs"`.
4. **Bag picture** (optional, `src/ui/inventory.js` `TAB_PICS.holiday`): `'furn:elf_door'` may
   come after holiday-world's own pick.
5. **Holiday-world** (for the world team): at least 12 `holiday:elf` records with a `where`
   word from `shelf, roof, tree, window, lamp, fence, chimney, bench, sign, wall, stable,
   tree_big, pond, cottage, workshop, porch, step, snowman, sleigh, bridge` (anything else reads
   "by the ..."); each record is the air cell the elf stands in, with a block or a perchable
   piece of furniture under it, in sight of a place to stand. One `holiday:elfhome` record (the
   sign's cell, 2 high; Bramble takes the nearest free cell beside it).

## 11. Open questions

- Should the house elf also visit a friend's world you are a guest in? (Now: only your own
  worlds; in a friend's world you can find the host's elf.)
- `elf_all` needs 6+ hiding elves so a tiny custom village does not hand it out; fine?
- The house elf in Holiday Village: none (the village has its own twelve). A player who lives
  there with a bed only gets one through an Elf Door.
