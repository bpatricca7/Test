# Team "outdoor": zip lines, treehouse parts, camping & the salon chair (wave 2)

Owner files: `src/things/outdoor/*` (new), `tools/probe-outdoor.mjs`, this file.
Hooks outside the folder (all additive, listed at the end): one call in
`src/things/furniture.js`, a generic `hold()` state and a `quiet` sleep option in
`src/player/player.js`.

## What she gets

Bag -> **Camping** (a new tab after Fun & Toys) and one piece in **Bedroom**:

| key | name | what it does |
|---|---|---|
| `tent` | Camping Tent | pastel dome tent (door flaps rolled up, poles, guy ropes, a tiny lantern, a sleeping bag). Hand: sleep inside (the furniture sleep: dreamy night, morning), crickets, **Happy Camper** sticker. |
| `campfire` | Camp Fire | stone ring, logs, flickering flame cones, embers and smoke puffs, warm point light + block light 14 (flickers), a soft halo at night, crackles when she is near. Hand: the **marshmallow game** (below). |
| `camp_chair` | Camp Chair | folding striped chair with a juice box in the cup holder. Hand: sit. |
| `hammock` | Hammock | rainbow net on a wooden stand. Hand: she lies down in it and it swings gently (she rolls with it). |
| `string_lights` | String Lights | two posts, a sagging wire of rainbow bulbs that twinkle and glow (halos brighten at night), light 11. Hand: on / off (furniture `lamp`). |
| `picnic_table` | Picnic Table | A-frame table with benches and a gingham cloth (swatch = cloth color), jar of daisies. `surface: 0.81` (food / candles / cakes stand on it). Hand: sit on the nearest bench spot, facing the table. |
| `cooler` | Cooler | Hand: the lid pops open, a juice box pops out, flies to her, slurp, hearts, "Yummy grape juice!". |
| `camper_bunk` | Camper Bunk | narrow two-level bunk (quilts, reading lights, curtains, ladder). Hand: sleep on the bunk nearest the tap. |
| `zipline_tower` | Zip Line Tower | 2x2, 7 tall: stone feet, braced posts, a deck 3 up with a low picket railing and flower boxes, a ladder up the front, bunting under a pointy pastel roof. See **Zip lines**. |
| `tree_platform` | Tree Platform | 3x3 deck with a railing, a lantern and bunting, a rope ladder down the front. On a trunk side: braced against the tree; on the ground: on stilts 3 blocks up. |
| `rope_bridge` | Rope Bridge | planks, rope rails and netting across a gap between platforms / block tops; sways; walkable. |
| `salon_chair` (Bedroom) | Salon Chair | styling station (mirror ringed with glowing bulbs, bottles, hair dryer) and a pink tufted chair. Hand: she sits, the chair spins once, the **Dress-Up Studio opens on Hair** (`game.ui.open('dressup', { tab: 'hair' })`). Coming back: a spin, a dryer whoosh, sparkles. |

All pieces are colorable (swatches first = default), rendered with the furniture Kit (static
parts batch with the rest of the furniture), and saved with the world like any furniture.

## Zip lines (`zipline.js`)

- **Linking**: a Zip Tower placed from anywhere (Build tool, Undo/Redo, a Magic Build with
  `api.furn`) links to the **nearest unlinked tower** at most 48 blocks away (and at least 3
  apart horizontally). Toasts guide her: "Now build a second Zip Tower (up to 48 blocks
  away)!" / "Zip line ready! Tap a tower to zip across!". A sparkle runs along the new cable.
- **Cable**: a real catenary (sag ~ 3.5% of the span) between the two roof beams, on the side
  that faces the other tower, drawn as one candy-striped tube (shared material) with clamps.
  A trolley (little pulley car, wheels on the cable) with two padded grips on straps is parked
  at one end. The grips hang beside her head: with the chibi proportions her raised hands only
  reach the middle of her head, so there is no bar across it.
- **Ride** (Hand on either tower): if she is not on that tower's deck she climbs its ladder
  (magic sparkle hop to the ladder foot first when she is elsewhere), steps onto the deck,
  walks to the edge, the trolley whizzes over if it waits at the other end, she jumps up and
  grabs the grips, and zips: speed from the slope (never under 4.4 m/s, so flat and uphill
  lines work; at most 12.5), a gentle brake before the end, a pendulum swing, knees tucked with
  a happy kick, rainbow + sparkle trail, synthesized wind that follows her speed, and the camera
  eases to a three-quarter side view (towers never block it; dragging the view pauses the
  assist). She lands softly on the far deck: stars, "Wheee! You zipped across!", the
  **Zip Zoom!** sticker, `profile.stats.zipRides`.
- **Event**: `'zipline:ride' { from, to }` (tower entities) when she lets go of the platform.
- **Undo / Remove**: removing or undoing a tower unlinks it (cable and trolley disposed);
  putting it back (Undo) links it again. Links are saved per world in system `outdoor`:
  `{ v: 1, zip: [[uidA, uidB, parkedAtB 0|1]] }`.
- The ride uses `player.hold(holder)` (new, see below): no walking, gravity or jumping while
  she holds on; flying, `stand()` or `teleport()` let go and the ride ends cleanly. The avatar
  pose is blended on top of the avatar's own pose after `player.update` (bones only, the
  avatar module is untouched).

## Treehouse parts (`bridge.js`, `ladders.js`)

- **Tree Platform** placement (item `use` overridden): tapped on the **side of a solid block**
  (a trunk) the deck is braced against it, its top level with that block's top, back row
  against it, facing out, with a rope ladder to the ground below; tapped on the **ground** it
  stands on stilts with its deck 3 blocks up (2, 1, 0 if there is no room), facing her.
  Data: `{ legs, ladder, open }` (`legs` 0 = braced; `ladder` = rope ladder length; `open` =
  railing cells left open, 12 bits: side*3+index, sides front/right/back/left). `open` is
  derived: the ladder cell and every cell where a bridge meets the deck (recomputed whenever
  platforms or bridges change).
- **Ladders**: pushing toward the tower / platform ladder (camera-relative) or Jump climbs;
  letting go slides down gently; at the top she steps onto the deck. Hand on a platform climbs
  by itself (the timeout is game time, so slow devices still get the whole climb).
- **Rope Bridge**: select it and tap a platform deck (or block top / side) facing across a gap;
  it stretches from that edge to the next platform or full block top at the same height
  (up to 20 cells; friendly toasts otherwise). Every cell is a `rope_bridge` entity
  `{ i, n, b }` (b = bridge id) so cells, colliders, saving and undo come from the entity
  system; segment 0 draws the whole bridge (one mesh) whose sway and bounce are done in the
  vertex shader (the furniture atlas material + two uniforms, one shared material). Walking on
  it makes it bounce and creak; Hand-tap wobbles it. Placing, the Remove tool on any part and
  Undo always take the **whole** bridge (one history entry). Railing and side-guard colliders
  are 1.1 high (above the 1.05 auto-hop, so walking into a railing never hops her over it; a
  real jump still does).

## Camping extras (`camp.js`, `extras.js`)

- **Marshmallow game** (panel `marshmallow`, `ui.open('marshmallow', { entity })`): a night
  scene on a canvas (device-pixel sharp): Roast! -> the marshmallow (with a face) toasts over
  animated flames along a Soft / Golden / Crispy meter -> **Pull out!** (button, tap on the
  picture, Space or Enter). Golden = "Perfect! Golden and gooey!" + **S'mores Star** sticker;
  soft = "Soft and squishy! Still yummy!"; burnt = "Crispy! Still yummy!" (never a fail). A
  s'more assembles; **Eat it!** (hearts, `food:eat { food: 'smores' }`), **Save it**
  (`basketAdd(game, 'smores', 1)`), **Again!**. Emits `'camp:marshmallow' { result, entity }`
  (`result`: 'soft' | 'golden' | 'crispy'). `game.marshmallow` has `state`, `roast()`, `pull()`.
- **S'more food**: `FOOD.smores` (`kind: 'meal'`) is added at install, before cooking installs,
  and its model is pre-baked as `'food:smores'` in the pets kit cache, so the basket, the Bag
  Food tab (`food:smores`), tables (`food_smores`) and pets all know it.
- **Stickers** (with their own art): `zip_zoom` "Zip Zoom!", `happy_camper` "Happy Camper",
  `smores_star` "S'mores Star".
- **Bag tab**: `['camping', 'Camping']` is inserted into `ITEM_CATEGORIES` after `fun` when it
  is missing (the tab picture is the tent, the tab's first item).

## For other teams

- **Magic Builds** (camper / treehouse prefabs): every key above works with `api.furn`. Zip
  towers placed by a build link up by themselves (two in one build = a zip line). Platforms:
  pass `{ legs, ladder }` (e.g. `{ legs: 0, ladder: 4 }` against a trunk; the default data is
  stilts 3 up with a 3-block ladder). Bridges: one `rope_bridge` per cell, rot = direction the
  bridge runs (0 +z, 1 +x, 2 -z, 3 -x), data `{ i, n, b }` with the same unique `b` string for
  the whole bridge, i = 0 at the start; railing openings follow automatically.
- **Friends** can listen to `'zipline:ride'` and `'camp:marshmallow'`; the hammock lies her
  down with `sleepIn(..., { quiet: true })`, so it does **not** emit `'player:sleep'`.
- `game.outdoor = { zip, ladders, bridges, sfx, camp }`; `game.debug.outdoor = { links(),
  ride(), zip(uid) }`; `game.outdoor.zip.freeze = true` holds a ride still (probe pictures).

## Changes outside `src/things/outdoor` (additive)

- `src/things/furniture.js`: imports `./outdoor/index.js` and calls its `install(game)` at the
  end of the furniture install (after the catalog, so the furniture `sleep`, `sit` and `lamp`
  actions exist, and before cooking installs, so the s'more food is registered in time).
- `src/player/player.js`:
  - `player.hold(holder)` / `player.release()` and state `'hold'`: a generic "carried by a
    moving thing" state. While holding, `update()` only syncs the avatar; the holder moves
    `position` every frame. `stand()`, `teleport()`, `setFlying()`, `emote()` and
    `serialize()` treat `'hold'` like sitting (let go / no emote / save a standing spot).
    `player.holder` is the current holder.
  - `sleepIn(entity, pos, yaw, { quiet })`: `quiet` skips `'player:sleep'` (a rest, not bedtime).

## Found along the way (for core, not changed here)

- **Touch Bag skips "Pick a color!"**: in `src/ui/inventory.js` an item card acts on
  `pointerup` (and redraws the panel as the color grid), while the color cards listen for
  `click`. On a touch screen the click the browser sends after the tap lands on the color card
  now under the finger, so she gets that color and the Bag closes before she sees the step
  (reproduced on the iPad viewport with the Camp Fire; probably any colorable item whose card
  sits over a color card).
  A likely fix: ignore color-card clicks for ~350 ms after the grid appears, or act on the
  item card's `click` instead of `pointerup`.
  **Fixed** (wave 2, Shops team, `docs/teams/shops.md`): a color card only takes a click whose
  press started on it (or a keyboard click, or after 700 ms).

## Tests

`node tools/probe-outdoor.mjs [--only=zip,tree,camp,salon,touch]` (screenshots
`.shots/outdoor-*.png`):
- **zip**: meadow hills; Bag -> Camping -> Zip Line Tower, clicks on two hill tops; they link;
  HUD Hand + click: climb, grab, zoom (side / front / wide pictures of her hanging mid-ride),
  landing on the far deck, `zipline:ride`, sticker; ride back; save + reload keeps the link;
  Remove unlinks, the Undo button relinks.
- **tree**: two stilt platforms by clicks, Hand climbs the rope ladder, a rope bridge clicked
  across, railings open, walk across with W (the bridge bounces), wobble, Remove takes the whole
  bridge and one Undo brings it back, a platform braced against a trunk.
- **camp**: tent + camp fire from the Bag with clicks, the rest of a campsite, day and night
  pictures (fire light and flicker, glowing string lights), marshmallow golden (basket) and
  crispy (eat), the s'more food, hammock (no `player:sleep`), camp chair, picnic table,
  cooler juice box, string lights off / on, sleeping in the tent (Happy Camper), top bunk.
- **salon**: Bag -> Bedroom -> Salon Chair, sit + spin, Dress-Up opens on Hair, back in the chair.
- **touch** (iPad 1024x768): Camping tab pictures, a camp fire by taps, the marshmallow game by
  taps, a zip ride started with a tap.
