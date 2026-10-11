# Team "builds": treehouses and campers (wave 2 Magic Builds)

Owner of `src/things/prefabs.js` and `src/things/prefabs/*`; probe `tools/probe-builds.mjs`.
Wave 2 requests 5 and 7 from DESIGN.md §4. **No files outside `src/things/prefabs*`,
`tools/probe-builds.mjs` and this file were changed.**

## What she gets

Bag → **Magic Houses** now ends with seven wave 2 builds, each with its 3D picture. Every one
is fully furnished, builds with the usual ghost + magic pop-in, and is ONE Undo.

| key | name | highlights |
|---|---|---|
| `sparkle_camper` | Sparkle Camper | 16-long pink camper with rounded ends and top edges, big pink windows, a striped awning. Inside: two `camper_bunk`s by a nightstand + lamp, kitchenette (fridge, counters, stove, sink, cake), lounge (sofa, coffee table, candle, beanbag, books, pictures, clock), a walled bathroom (shower, sink, toilet, towels, bath mat), rugs, lamps, fairy lights. Outside: open stairs up to a candy-striped roof deck (railings, parasol, beanbags, table with cake, plants), a landing and a **Big Slide down into the pop-out pool** (floats, loungers, parasol), `string_lights`, a `campfire` with `camp_chair`s, a `cooler`. |
| `retro_trailer` | Retro Mini Trailer | round mint-and-cream teardrop (rounded profile and corners, porthole windows). Inside: double bed, nightstand + lamp, rug, beanbag, fairy lights, picture. The back hatch lifts up over a **fold-out kitchen** (counter, stove, sink facing out). Camp fire with three camp chairs, string lights, cooler, picnic. |
| `camper_van` | Camper Van | long sky-and-white van (window band, big windscreen, heart tail lights). Inside: bench seats round a table with cake, rug, mini kitchen with fridge, driver seats, lamp. A **striped roof tent with a bed** (ladder up the back; tap the bed to snuggle in), surfboards on the roof. Parasol picnic, camp chairs, string lights. |
| `campground` | Campground | a path through a log arch to a camp fire ring (four camp chairs and a bench), **three pastel `tent`s** facing the fire, a `picnic_table` with cake and a cooler, a **`hammock` between two trees**, string lights, lamp posts, woods, flowers, a woodpile and a bird house. |
| `friendship_treehouse` | Big Friendship Treehouse | two big blossom trees, a pink sleepover cabin (two bunk beds) and a mint cabin (big bed, easel, comfy chair) joined by a **`rope_bridge`**; stairs up, rope ladders through a hatch, a **Big Slide** from the porch down to the meadow, string lights, a swing under the bridge. |
| `fairy_treehouse` | Fairy Treehouse | a giant **glowing mushroom-tree**: a stem with round windows (a little hall with a crystal lamp), lantern-lit stairs up round the stem, a glowing cap with round windows and a curled rim, a leafy fairy crown; inside the cap a cosy room (cloud bed, vanity, wardrobe, books, beanbags, **crystal lamps**, lantern chandelier) and a **tiny balcony** with lamp posts. Toadstools, crystals, a pond, glowing flowers. |
| `lookout_treehouse` | Lookout Treehouse | a tall tree on a grassy hill holding a big lookout deck (railings, two **telescopes**, a bench, a tiny cabin with a bed) reached by long stairs, a leafy canopy above, and a **zip line**: one `zipline_tower` on the deck and one in the flower meadow ~23 blocks away, 11 blocks lower. They link by themselves; she zips from the treehouse down to the meadow and back. |

The older keys were kept (hotbars may hold them); `retro_trailer` / `friendship_treehouse` got
their new names. Without the outdoor team's pieces every build still looks right (look-alikes
below); with them (checked against a merged preview) every piece is placed, 100%.

## Pieces only Magic Builds place (`prefabs/extras.js`)

Ordinary furniture (`game.entities.define`), hidden from the Bag (`item.hidden`), so they save,
undo, batch and Remove like any piece:

- `big_slide` (1x5x7) and `big_slide_tall` (1x7x9): a long curvy chute with rails, legs and a
  heart hoop. Its entry (back, top) is level with the deck it hangs from. **Hand**: she sits at
  the top (from further away a sparkly hop takes her there) and whooshes down (the furniture
  `whee` sound, whoosh, rainbow trail, speeding up then easing out); standing still on the top
  lip for a moment starts it too. Ending over water = a splash into the pool (she swims).
  Action `big_slide`, hint "Tap to slide!". Only a small lip collider at the top.
- `lookout_telescope` (1x1x1): pastel telescope on a tripod; **Hand**: it sweeps round,
  sparkles fly far out where it points, a chime and an "I spy..." toast (stars and moon at
  night). Action `telescope`; counts `profile.stats.telescopeLooks`.

## Prefab api additions (contract, `prefabs/kit.js`, `plan.js`, `place.js`)

- `a.has(key)`: is a furniture key registered (a missing one is reported once, like skipped
  keys). `a.sizeOf(key)`: its footprint `[w, h, d]` or null.
- `a.at(keys, x0, y, z0, rot, color, data)`: furniture placed **by its footprint**: it covers
  x0.. / z0.. whatever its turn (first registered key of `'a|b'` wins). Much easier than
  anchors for multi-cell pieces.
- Furniture data strings starting with `'@'` are made unique per built copy at placement
  (`placedData`): `'@friends'` becomes `'pf:<x>,<y>,<z>,<rot>@friends'`. Used for the rope
  bridge id `b` that all segments of one bridge share, so two treehouses never share a bridge.
- `prefabs/outdoor.js` helpers (use the outdoor piece, else a look-alike): `campfire` (stone
  ring + ember + candle), `tent` (wool tent), `campChair` (chair), `cooler` (toy chest),
  `bunk` (`camper_bunk|bed_bunk|bed_single`), `stringLights` (two lamp posts), `hammock`
  (bench), `picnicTable` (long table + bench), `ropeBridge` (planks with fence rails; segments
  `{ i, n, b: '@id' }`, rot = direction), `zipTower` (returns false when missing; the lookout
  then puts a bench there), plus `rail`, `bigSlide`, `parasol`, `roundWindow`, `bushyTree`.

## Using the other wave 2 teams' pieces

- Outdoor: `tent campfire camp_chair hammock string_lights picnic_table cooler camper_bunk
  rope_bridge zipline_tower`, exactly as `docs/teams/outdoor.md` (in their branch) describes.
  **Zip line**: towers link to the nearest unlinked tower when placed, so the two lookout
  towers link to each other (a tower somewhere else in the world that is still waiting for a
  partner, within 48 blocks, would be taken first; rare). Undo removes both and the cable.
  Tower ladders face away from the cable: the deck tower's ladder is on the deck side.
- Shops / friends: not used by these builds.

## Performance

- Place (commit) 30-200 ms per build in headless SwiftShader; the magic start is the usual.
- Draw calls: the static furniture batches (world team). Heavy pieces from other teams
  (`string_lights` 6 meshes each, `fairy_lights` 7, `campfire` 4, doors 2) are used sparingly:
  all seven builds together = 265 pieces, 165 furniture draw calls with the outdoor pieces
  (budget 0.65 per piece, the same as `probe-prefabs`).
- No per-frame allocations: slides and telescopes only do work while ridden/used (slides
  check the top lip only when she is within 12 blocks).

## Tests

`node tools/probe-builds.mjs [--only=gallery,hills,play,ui,touch] [--keys=a,b] [--night]
[--prefix=builds] [--page=path/to/sparkle-world.html]` (screenshots `.shots/builds-*.png`)

- **gallery**: registered, Bag item + hidden extras; each build in a flat world: all furniture
  placed, every door walkable, outside 3/4 view + every room (`view` spots), the camp town
  from above + draw-call budget, every Bag picture.
- **hills**: each build on the bumpiest spots of a Big meadow, turned 0-3: one Undo entry,
  inside the world, all furniture placed, Undo restores every block (whole-array compare) and
  the furniture; place+Undo of all at one spot byte-identical; a camper survives save+reload.
- **play**: camper slide by Hand from the deck → splash in the pool; the top lip starts a ride;
  treehouse slide from the ground (hop up, ride down); rope bridge is one bridge and two
  treehouses get two ids; van ladder up to the roof tent and sleeping in its bed; telescope
  toast; the lookout's zip towers link, run downhill, **a real zip ride from the deck lands at
  the meadow tower**, Undo removes the line (the outdoor checks run when their pieces exist).
- **ui** (1280x800, real clicks): Bag → Magic Houses → Sparkle Camper → ghost → click →
  magic → one Undo entry with all furniture → Hand tool + click on the slide rides it → the
  Undo button restores every block.
- **touch** (iPad 1024x768, real taps): Bag → Campground → ghost → tap the ghost → built;
  Hand tool + tap on the treehouse slide rides it.

All passes are green on this branch alone, and gallery + play are green on a local preview
merged with the outdoor team's in-progress branch (tents, fires, bunks, bridges, zip towers).
`tools/probe-prefabs.mjs` (all 20 Magic Houses) still passes.
