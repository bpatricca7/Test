# Cruise Ship world (cruise-world, wave 5)

The `cruise` biome: an enormous, original ocean liner, the **Glimmer Star**, floating on a
turquoise sea, with a little palm island, three rocks and coral. She spawns on the sunny Pool
Deck looking at the pools and the slide tower. Everything that is an entity (furniture, rides,
games, lifts, named places) is a `world.features` record for cruise-fun and the furniture bridge
(docs/teams/wave5-plan.md §4, §4.1). This team owns the blocks, the generator, the card picture
and the records' positions; cruise-fun owns what the records turn into.

Files:

| file | what |
|---|---|
| `src/world/paint/cruise.js` | the 14 ship blocks (tab `cruise`) |
| `src/world/biomes/cruise.js` | `shipPlan`, `generate`, `paintArt`, the biome def, `FURN_SIZES`, `footprint` |
| `tools/test-cruise-world.mjs` | the world tests (no browser) |
| `tools/lib/name-scan.mjs` | (shared line, §6) more encoded entries in the `cruise` list |

## 1. Design

The ship runs along **Z**: stern at the low end, bow at the high end, centred on `cx = sx / 2`.
Port is -X, starboard +X. Decks (floor block y; she stands one above):

| deck | floor y | what is on it |
|---|---|---|
| keel | 12 | bottom of the hull (the sea floor is about y 7..10; the water line is 20) |
| swim platform | 21 | a teak platform at the stern at the water, stairs up through the aft deck |
| Promenade | 30 (`F1`) | the open wrap-around walk with lifeboats over it; inside: snack bar, cabins both sides of a corridor, the lobby round the forward lift (little fountains, guest desk, piano), more cabins, the bow lounge |
| Fun | 35 (`F2`) | kids' club, the Bubble Hall (aisles round the big pool's glass tank), arcade, art studio (a big ship adds music and toy rooms), Sweet Street (candy shop, ice-cream parlor, the forward lift), theater with a stage |
| Pool | 40 (`F3`) | **spawn**; the slide tower (platform 52, `FT`), the big pool (4 deep, glass sides), splash pool (2 deep), two round hot tubs, dance floor with flags, bandstand, loungers, the board; a big ship adds a palm lawn / kiddie pool park; inside (under the sports deck): Sunset Lounge and cafe |
| Sports | 45 (`F4`) | two raked funnels (white, pink band, gold star emblem, navy cap, a puff of cloud), the big screen on the aft funnel's base facing the pool deck, a running track round the funnels, mini golf (port), game court (starboard), the bridge (front, wings over the sides) |
| Bridge roof | 50 (`F5`) | the mast with a lookout and a lantern |

Outside: navy hull plates (waterline to y 25), a pink-and-gold stripe (26), white topsides with
portholes, the name in gold letters near the bow on both sides (each side reads correctly from
outside), white anchors, flagstaffs at bow and stern, strings of party flags bow - mast -
funnels - slide tower - stern, glass railings with a quartz handrail (1.5 blocks: she cannot
auto-jump them) and a lantern every ninth post (also round the slide tower's platform, beside each
slide gate, along the outside of the tower's spiral stair and along the stairwell cut through the
aft deck down to the swim platform), lit windows and portholes (light 8 and 9), sea
lanterns in the pools. The island is off the starboard side (dock, swan boat and speedboat,
palms, a picnic, shells), the rocks off port and aft, each with a gem.

How she moves round the ship without lifts (C10 in the test checks this): grand staircases at
the stern on both sides (Promenade -> Fun -> Pool), stairs at the forward end of the pool deck on
both sides (Pool -> Sports), doors through every room's aft and forward walls (the Bubble Hall's
doors are in its side aisles), the cabin doors, the bridge door and the swim-platform stairs
from the snack bar door down to the water.

## 2. Blocks (category `cruise`, 14, registered in this order)

| key | name | look |
|---|---|---|
| `cruise_lifebuoy` | Lifebuoy | pink and white ring (first: the tab's picture) |
| `cruise_hull` | Hull Plates | navy-plum riveted plates (sound chime) |
| `cruise_white` | Ship Paint | smooth white |
| `cruise_stripe` | Hull Stripe | pink top with tiny stars, white line, gold lower half |
| `cruise_porthole` | Porthole | white plate, brass rim, glowing window (light 9) |
| `cruise_window` | Cabin Window | white, lit window with pink curtains (light 8) |
| `cruise_deck` | Teak Deck | teak planks with dark caulking |
| `cruise_rail` | Glass Railing | glass with a white handrail (transparent) |
| `cruise_pool` | Pool Tiles | aqua mosaic |
| `cruise_dance` | Dance Floor | four glowing colored squares (light 12) |
| `cruise_emblem` | Star Emblem | pink with a white ring and a gold star (light 10) |
| `cruise_slide` | Slide (Aqua) | glossy aqua (sound pop) |
| `cruise_slide_pink` | Slide (Pink) | glossy pink (sound pop) |
| `cruise_flags` | Party Flags | two strings of pennants (cross sprite) |

228 block types are registered with these (limit 255).

## 3. Feature records (`world.features`)

All records: `{ kind, x, y, z, rot }` integers, `rot` 0..3 as `entities.place` (front toward +Z,
+X, -Z, -X). `x, y, z` is the first air cell above the floor unless the row says otherwise.
Before a record is listed, every cell it covers is checked free air (not yet claimed by another
record) with a solid floor under the bottom cells, and then claimed; nothing later builds into a
claimed cell. Records that do not fit are skipped (none do on seeds 1..5); the list is on
`world._cruiseSkipped` (non-enumerable) for tests.

| kind | fields | cells kept free | where (count) |
|---|---|---|---|
| `cruise:slide` | `path: [[x,y,z],...]`, `name`, `color` | each path cell and the one over it | 'Twister' `#5FD3E6` and 'Big Dipper' `#FF8DC0` from the tower platform (2) |
| `cruise:lift` | `stops: [{ y, name }]` | `(x, stop.y+1, z)`, `(x, stop.y+2, z)` for every stop | aft by the tower (Promenade, Fun, Pool, Slide Tower) and forward (Promenade, Fun, Pool, Sports) (2) |
| `cruise:arcade` | - | the cell and the one over it | arcade room side walls, facing in (3) |
| `cruise:game` | `game` | the cell and the one over it | court on the sports deck: `hoops`, `ringtoss`, `shuffle` (3) |
| `cruise:golf` | `holes: [{ tee, cup, par }]` | the sign cell and the one over it | port side of the sports deck: 5 holes (Cozy) / 6 (Big) |
| `cruise:dance` | `x0, z0, x1, z1` | the booth cell and the one over it | 7 x 7 floor on the pool deck, booth just aft of it facing it (1) |
| `cruise:movie` | `w: 9, h: 5` | the screen: `footprint([w, h, 1], x, y, z, rot)` | on the aft funnel's white base, bottom middle cell, facing aft (`rot` 2) toward the pool deck (1) |
| `cruise:wheel` | - | the cell and the one over it (and the captain's place behind it) | bridge, facing the bow (`rot` 2 means its front, where she stands, is aft) (1) |
| `cruise:board` | - | the cell and the one over it | beside the spawn (1) |
| `cruise:spot` | `name`, `deck` | the cell and the one over it (not an entity) | 15: `pool`, `slides`, `arcade`, `theater`, `kids`, `sweets`, `golf`, `court`, `dance`, `bridge`, `cabins`, `snacks`, `lounge`, `beach`, `marina` |
| `cruise:float` | - | the water cell | `y` is the **top water cell** (air above), like `pool_float` with `{ water: true }`: 4 in the big pool, 2 in the splash pool, 1 in each kiddie pool (6 Cozy / 7 Big) |
| `furn` | `key`, `color?`, `data?` | `footprint(FURN_SIZES[key], x, y, z, rot)` | about 360 (Cozy) / 610 (Big): see below |

Field details:

- `cruise:slide`: the record's `x, y, z` is `path[0]`, the gate cell on the platform (y 53);
  `rot` points along the first step. Every step moves one cell along X or Z and drops 0 or 1
  (length <= 1.42), never climbs; the last points drop straight down into the pool, and the
  last point is a water cell of the big pool (4 deep). About 33 points each, a drop of 13.
- `cruise:lift`: `x, z` is the shaft cell, `y` the first stop's floor + 1. Stop `y` values are
  floor blocks: 30, 35, 40, 52 (aft) and 30, 35, 40, 45 (forward). Stop names: 'Promenade Deck',
  'Fun Deck', 'Pool Deck', 'Sports Deck', 'Slide Tower'. The lift does not cut a shaft; the
  two cells over the floor are free at every stop.
- `cruise:golf`: the record is the start sign (port aft corner of the course). Each hole is a
  6 x 6 green (grass) with a low border of white or pink slabs; `tee` and `cup` are the air
  cells over the green (y 46); the cup's green block is white wool. `par` 2 or 3. Holes run from
  aft to forward with a gap in the border between them; the third hole has a striped post with a
  lantern, every other hole a flower hedge in the middle.
- `cruise:dance`: the floor cells are `x0..x1, z0..z1` at y - 1 (block `cruise_dance`); the
  booth faces +Z (`rot` 0) toward the floor.
- `cruise:spot` `deck` strings: 'Pool Deck', 'Slide Tower', 'Fun Deck', 'Sports Deck', 'Bridge',
  'Promenade Deck', 'Beach Island', 'Swim Platform'.

Furniture keys placed through `furn` (sizes `[w, h, d]` checked against the catalogs by test
C8): `bed_single`, `bed_bunk`, `nightstand`, `wardrobe`, `toy_chest`, `beanbag`, `armchair`,
`door`, `door_pink` (cabins); `counter`, `stool`, `fridge`, `table_round`, `chair` (snack bar,
cafe); `sofa`, `coffee_table`, `piano`, `plant_pot`, `floor_lamp`, `bookshelf_tall`,
`lamp_ceiling` (lounge, lobby, bow lounge); `trampoline`, `slide`, `dollhouse`, `teddy_bear`,
`balloon_bunch`, `easel`, `desk` (kids' club, art studio); `candy_shop`, `ice_cream_parlor`
(Sweet Street); `tv`, `bench` (theater); `cruise_lounger` (pool deck: cruise-fun's key,
`[1, 1, 2]` assumed), `lantern_post`, `picnic_blanket` (pool deck, island); `boat_swan`,
`boat_speed` (at the dock: base y = the water surface cell, as vehicles/park.js), `cooler`,
`camp_chair` (island). Colors are soft pinks, mints, skies, lilacs and suns.

## 4. Numbers

`shipPlan(sx, sz)` gives every number from the world size:

| | Cozy 144 | Big 208 |
|---|---|---|
| beam (half width) | 17 | 20 |
| stern z0 / bow tip z1 | 15 / 132 | 18 / 193 |
| Promenade rooms zA0..zA1 | 24..121 | 27..182 |
| Fun deck rooms zB0..zB1 | 30..118 | 33..179 |
| slide tower centre zT | 37 | 40 |
| lounge / sports deck zC0..zC1 | 75..115 | 118..176 |
| bridge zBr0..zC1 | 109..115 | 170..176 |
| forward lift zLift | 90 | 133 |
| spawn | (72.5, 41, 71.5) | (104.5, 41, 114.5) |
| feature records | ~390 | ~640 |
| gems | 24 | 28 |
| non-natural blocks | ~78 000 | ~140 000 |
| generate() in Node | 20..80 ms | 40..125 ms |

Each room level is the deck under it inset by 4 (a 3-wide open walk outside its walls); the
Fun deck and the lounge level take the hull width 3 and 6 cells further forward, so the
superstructure steps back toward the bow. The bow rakes forward at the top and the bilge rounds
in under the water.

## 5. How to test

```
node tools/test-cruise-world.mjs                 # C0..C10, seeds 1..5, Cozy and Big (~1 s)
node tools/test-cruise-world.mjs --only=C4 --seeds=1..2
node tools/worldview.mjs cruise --T=8 --views=iso,iso2,top --slice=30,35,40,45,52 [--size=big] [--seed=N]
node --test tools/test-name.mjs
```

C0 no throw; C1 time; C2 spawn on the pool deck; C3 every record's cells free on a solid floor,
no overlaps, the counts (2 slides, lifts, 3 arcades, 3 games, golf 4-6 holes, dance, movie,
wheel, board, 6+ spots with the plan's names, 4+ floats, beds, loungers); C4 slide paths; C5 lift
stops; C6 no unknown block, at most 110 kinds, the block budget (< 110 000 ship blocks Cozy,
< 220 000 Big); C7 water at sea level 8+ cells to every edge, 20-30 gems in air; C8 furniture
sizes vs the catalog sources; C9 the plan's order; C10 every spot, slide gate, game, the wheel
and every bed can be walked or swum to from the spawn without the lifts.

## 6. As built

- Everything in §7.1 of the plan: 2 slides, 2 lifts, 3 arcade cabinets, 3 deck games, a 5-hole
  (Cozy) / 6-hole (Big) golf course, the dance floor, the movie screen, the wheel, the board, 15
  spots, 6-7 floats, 26 furnished cabins (Cozy) / 48 (Big).
- The card picture (`paintArt`): the ship side-on, bow to the right, on bands of turquoise sea
  under a sunny sky, with the slide tower, funnels with puffs, lifeboats, flags, a palm island
  and sparkles. Plain `fillRect` only; wrapped in try/catch.
- Sky: top `#5CC2FF`, horizon `#D6F4FF`, fog `#DDF5FF`, sunset `#FFB8A8`, night `#141A4E`.
  `world.outside` is water with its surface at 20.875; `waterLevel` 20.
- Shared line touched: `tools/lib/name-scan.mjs`, ten encoded entries appended to the `cruise`
  list (more cruise lines and famous ship names), each marked `// wave 5 (cruise-world)`.

## 7. Wanted from the integrator

1. `package.json` scripts: add `"test:cruise-world": "node tools/test-cruise-world.mjs",` and
   run it with the other world tests.
2. cruise-fun: register `cruise_lounger` with `size: [1, 1, 2]` (the generator places 8 (Cozy)
   / 48 (Big) of them with that footprint, head end away from the front). If the size differs,
   change `FURN_SIZES.cruise_lounger` in `src/world/biomes/cruise.js` (test C8 then checks it
   against `src/things/cruise/*.js`).
3. cruise-fun: read `cruise:float` with `y` = the top water cell (place `pool_float` with
   `{ water: true }` there, as `src/things/furniture.js` does), and `cruise:movie`'s `x, y, z` as
   the bottom middle cell of a `w x h` screen facing `rot`.
4. cruise-fun: the lift record's cells are kept free at every stop, but the ship has no open
   shaft between decks; a lift that teleports between stops (ding, doors) fits best.

## 8. Open questions for the owner

- The Big ship carries about 640 furniture records (Cozy 390). If that is heavy on a tablet,
  the cheapest cut is fewer cabins (`cabinBlock`) or no forward cabin block.
- Should the island's boats be rideable to and from the swim platform (they are ordinary
  vehicle records now)?
- The kiddie pools on a Big ship's park each have one float; more floats or a fountain sound?
