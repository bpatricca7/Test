# Team "prefabs" — Magic Houses

Owner of `src/things/prefabs.js` and `src/things/prefabs/*`; probe `tools/probe-prefabs.mjs`.
**No core files were changed.**

## What she gets

Bag → **Magic Houses** holds 18 builds, each pictured by a small 3D render of the real thing
(textured like the world, on a little lawn):

| key | name | highlights |
|---|---|---|
| `cottage` | Flower Cottage | white walls, strawberry roof, flower boxes, picket fence + gate, cherry trees, mailbox; flowery wallpaper, big bed, kitchen, dining nook, reading chair |
| `princess_castle` | Princess Castle | 4 round towers with pointed pink roofs and flags, central spire, throne on a dais, red carpet, grand double staircase, heart-wallpapered suite with canopy bed, vanity, dollhouse, bath corner, lounge with TV |
| `treehouse` | Treehouse | pink cabin round the trunk of a giant cherry-blossom tree, porch railing, stairs up the side, rope ladders through a floor hatch, bunk bed, desk, reading nook, swing below |
| `candy_house` | Candy House | gingerbread walls, frosting roof with drips and gumdrops, candy-cane pillars, cotton-candy chimney, gumdrop fence, lollipop trees; heart bed, candy kitchen, party table |
| `beach_hut` | Beach Hut | striped hut on palm stilts, thatch roof, deck railing, steps, hammock, surfboards, umbrella + towel, sandcastle, tiki torches, palms; kitchenette, outdoor shower |
| `igloo` | Snow Igloo | snow dome, ice windows, glowing skylight, tunnel with a door, fireplace, cloud bed, armchair, books; snowman, snowy pines, frozen pond |
| `bakery` | Sweet Bakery | pink brick shop, display windows, striped awning, giant cupcake sign, ovens, cake counter, café tables inside and out, menu easel; home upstairs with bed and bath |
| `pet_shop` | Pet Shop | big pink paw sign, fish tank, bird house, pet beds and bowls, toy chest, treat counter; keeper's bedroom; dog house outside |
| `modern_house` | Modern House | glass walls, two floors + stairs, kitchen island, living room, bathroom, bedroom, roof terraces with glass rails, pool with float, loungers, umbrella |
| `barn` | Happy Barn | red barn, white trim, gambrel roof, weathervane, pony stalls with gates, hay bales, loft bed, silo, paddock, pumpkin patch |
| `rainbow_bridge` | Rainbow Bridge | 7-lane rainbow arch with cloud rails and lanterns; does NOT flatten the land (`options: { clear: 'none', level: false }`) |
| `flower_garden` | Flower Garden | hedge garden, blossom arch, glowing fountain, flower beds of every kind, benches, wishing well, picnic |
| `playground` | Playground | toy-block fence, play tower + slide, swings, trampoline, seesaw, merry-go-round, sandbox with sandcastle, hopscotch |
| `sparkle_camper` | Sparkle Camper | (wave 2) big pink camper: bunk beds, kitchenette, sofa, bathroom, roof deck with loungers + parasol, pop-out pool with slide, camp fire |
| `retro_trailer` | Retro Trailer | (wave 2) little silver trailer, double bed, tiny kitchen, awning, camp fire, picnic |
| `camper_van` | Camper Van | (wave 2) sky-blue van, pop-up roof, bed, kitchen, surfboards, umbrella, picnic |
| `friendship_treehouse` | Friendship Treehouse | (wave 2) two trees, two cabins (sleepover + playroom), rope bridge, stairs, rope ladders, swing |
| `fairy_treehouse` | Fairy Treehouse | (wave 2) round lavender hut in a fairy tree, spiral stair, toadstools, glowing mushrooms, crystals, pond |

The zip-line lookout from wave 2 is not built: zip-line towers are not canonical furniture yet.

## Placing (the flow she sees)

1. Tap a house in the Bag → it goes into the hotbar; a **house bar** appears above the hotbar:
   picture + name + tip, a **Turn** button and a glowing **Build!** button (≥ 54 px; on
   portrait screens the bar sits under the world name so it never covers the joystick/Jump).
2. A see-through **ghost** of the house (real textures, pink tint, pulsing) follows where she
   aims, its door turned toward her, with a dashed pink footprint, corner posts and sparkles.
   **R** or **Turn** turns it a quarter; it eases round. It never lands on top of her (it slides
   away along her view), and it stays inside the world (clamped a few blocks from the edge).
3. Build: desktop — click; iPad — tap a spot (the ghost jumps there), then tap the ghost (it
   is a pickable, hint "Tap to build!"), or press **Build!**.
4. **Magic**: magic chime + whoosh, then every block pops in bottom-to-top over ~1.6 s (drops
   in, overshoots, settles, with a white flash) while sparkles and stars ride up a rising band
   and pop sounds climb in pitch. Then the world changes in one batch, the furniture moves in,
   confetti + stars + hearts, "Ta-da! Your Cottage is ready!", and the ghost stays hidden
   over the new house until she aims elsewhere.
5. **Undo** takes the whole thing back in one step: every block restored byte-for-byte (the
   probe compares the whole block array), furniture removed, anything that was in the way put
   back. Undo during the magic cancels the house.

## What placement does to the land

- The anchor is the tapped column; the house's **front-middle** cell sits there, the house
  extends away from her. Base height = the ground under the aim (trees and flowers ignored);
  when aiming at water the base rises to the water surface (so huts stand on the pond).
- **Footprint**: layer 0 becomes the prefab's floor or the column's own surface block (grass,
  sand, snow, frosting…); everything above is cleared (high tree canopies above the roof may
  stay); gaps below are filled with the column's own under-soil (dirt/sand/cookie) and stone
  deeper. Trees whose trunks were cut are removed whole (leaves within 3 of the trunk).
- **Terrace ring** (3 blocks round the footprint): natural ground more than `d-1` above the
  base is cut down, ground more than `d` below is filled up (not water), so houses never sit
  in a pit or on a cliff. Player builds (non-natural blocks) in the ring are never touched.
- Furniture already in the footprint is removed first (and comes back on Undo).
- If she stands where the house goes she is moved to the front door, facing it.

## Contracts

- `game.registry.prefabs.set(key, { key, name, icon, size: [x, y, z], build(api) })`. Entries
  put there by other modules before `game:ready` get their Bag item `prefab:<key>` then; or call
  `game.prefabs.register(def)`. Optional def fields: `options: { clear: 'all'|'none', level }`,
  `anchor: [x, z]` (default front-middle), `view: { name: [x, y, z, lookX, lookY, lookZ] }`
  (photo spots, prefab-local; the probe screenshots them), `blurb`, `iconDir`, `iconZoom`.
- **api** (prefab-local; x left→right, y up with 0 = ground layer, z back (0) → front (D-1);
  rot 0 faces the front/+z, 1 +x, 2 back, 3 −x): `block(x, y, z, key)`, `fill(x0, y0, z0,
  x1, y1, z1, key)`, `furn(key, x, y, z, rot, color, data?, { back?, orBlock? })` (DESIGN
  contract), plus `air walls lining corners floor checker gable hip cyl cone dome line blob
  layers door flowers tree put get`. `put()` = `furn()` with `back: true`: the cell is the
  piece's back row against a wall, so beds and tubs grow into the room whatever their depth.
- Keys may carry stand-ins: `'hedge|leaves_oak'` uses the first registered key. Every design
  chain ends in a **canonical** DESIGN.md block key; the only non-canonical first choices are
  `path hedge snowman_head pumpkin planks_birch mushroom_stem mushroom_cap_red log_fairy
  leaves_fairy` (all in the Blocks team's library). All furniture keys are canonical.
  Unknown keys are skipped; a canonical key the library lacks falls back through
  `BLOCK_STAND_INS` (kit.js). Each missing key is reported once in one `console.warn`.
- Event **`prefab:place`** `{ prefab: { key, name, x, y, z, rot, bounds } }` after the house is
  in (the core awards `magic_builder`; beds + doors also trigger `home_sweet_home`).
  Furniture is placed with `events: true`, so `entity:place` fires for each piece.
- `game.prefabs`: `register(def)`, `plan(key)`, `list()`, `placementAt(key, x, z, { rot, fromY })`,
  `place(key, x, z, { rot, fromY, animate = false })` → result `{ key, placement, bounds,
  changed, removed, furniture: { requested, placed, skipped } }`, `finish()`, `building`,
  `clock`, `holdClock` (tests: pin the animation clock), `ghost`, `lastResult`, `footprint()`,
  `turn()`, `buildHere()`. Also `game.debug.prefabs`. Action `turn_house`.

## Technical notes

- Plans resolve lazily after `game.start()` (keys → ids) and are cached with their ghost and
  thumbnail geometry (marked `userData.shared`).
- The ghost, the pop-in and the Bag pictures are voxel meshes built like the chunk mesher
  (same texture array, face shade, AO) with one small GLSL3 `ShaderMaterial` sharing the
  world's daylight/fog uniforms. The pop-in is animated in the vertex shader (per-block start
  time attribute), so a frame costs one uniform write. The animated copy stays (behind, via
  polygon offset) until the real chunks have re-meshed, so there is no flicker.
- Commit = one `world.batch` (one relight) + one history group. Measured in headless Chromium:
  castle place ~30–40 ms, starting its magic ~40–60 ms, smaller builds 5–20 ms.
- No per-frame allocations in the ghost/animation paths (numeric change detection, reused
  rays and hit objects, hoisted particle/sound option objects).
- World unload cancels a running build (nothing half-built is ever saved: the world only
  changes at the end of the magic).

## Tests

`node tools/probe-prefabs.mjs [--only=gallery,undo,ui,touch] [--keys=a,b] [--night]
[--prefix=prefabs] [--page=path/to/sparkle-world.html]`

- **gallery**: every prefab in a Builder Flat world (outside 3/4 view + each photo spot, and
  night views with `--night`), the town from above, the Bag tab with all pictures.
- **undo**: meadow world — cottage on the hilliest spot, beach hut by the pond, castle in the
  woods, modern house at the world corner, rainbow bridge by water: one history entry, stays
  inside the world, undo restores every block (full array compare) and the furniture; place +
  undo of every prefab leaves the world byte-identical; a built house survives save + reload.
- **ui**: real clicks — Bag → Magic Houses → Flower Cottage → ghost on hover → R and Turn →
  click → pop-in → one Undo entry → Undo button restores everything; Undo during the magic
  cancels; bar and ghost hide with the Hand tool.
- **touch**: iPad 1024×768 — ghost before any tap, a tap elsewhere moves it without building,
  tapping the ghost builds, Build! builds; phone 390×844 and portrait iPad: the bar covers no
  HUD control.

`--page` runs the same checks against another build — used during development against a
preview that merged the Blocks, Furniture, Life, Environment and Avatar teams' branches (all
checks pass there too, with every furniture piece placed: e.g. cottage 47/47, castle 42/42,
modern house 66/66).
