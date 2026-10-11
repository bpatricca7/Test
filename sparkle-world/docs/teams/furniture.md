# Furniture & Home Life — team notes

Owner files: `src/things/furniture.js`, `src/things/furniture-models.js`,
`src/things/furniture/*` (new), `tools/probe-furniture.mjs`. Small additive core changes in
`src/things/entities.js` and `src/core/input.js` (listed at the end).

## What is registered

Every canonical furniture key from DESIGN.md is defined with `game.entities.define(def)`, so the
Bag shows rendered 3D thumbnails in the right tab and `icon(color)` pictures the chosen swatch.

| Bag tab | Keys |
|---|---|
| bedroom | `bed_single bed_double bed_canopy bed_bunk bed_heart bed_cloud crib pet_bed wardrobe dresser vanity nightstand toy_chest bookshelf desk mirror` |
| living | `sofa armchair beanbag coffee_table tv fireplace piano rug_round rug_heart plant_pot picture_frame clock bookshelf_tall` |
| lights | `table_lamp floor_lamp lamp_ceiling fairy_lights lantern_post candle` |
| kitchen | `stove oven fridge counter sink_kitchen table_round table_long chair stool cake_stand fruit_bowl` |
| bathroom | `bathtub shower toilet sink_bath towel_rack bath_mat` |
| building | `door door_pink door_glass window_frame stairs fence gate ladder` |
| garden | `bench mailbox well fountain picnic_blanket bird_house flower_box` |
| fun | `swing slide trampoline pool_float tree_house_ladder easel dollhouse teddy_bear balloon_bunch` |

Item keys are `furn:<key>`. The first swatch is the default color; swatches are pastels first
(`src/things/furniture/palette.js`, `SW`). Beds pick a quilt pattern per color (hearts, stars,
clouds, dots, flowers, patchwork, gingham, moons, rainbow...).

### Placement modes (as used)
- `placeOn: 'table'`: `table_lamp candle plant_pot cake_stand fruit_bowl teddy_bear` (they stand
  on anything with `surface`, otherwise on the floor).
- Surfaces (`def.surface`, model units): `table_round 0.82, table_long 0.82, counter 0.91,
  oven 0.94, nightstand 0.63, dresser 0.92, desk 0.8, coffee_table 0.47, bookshelf 0.98,
  bookshelf_tall 1.98, fireplace 1.38 (mantel), piano 1.26`.
- `placeOn: 'wall'`: `picture_frame clock mirror window_frame towel_rack flower_box ladder
  tree_house_ladder`.
- `placeOn: 'ceiling'`: `lamp_ceiling fairy_lights`.
- `flat: true` (new, see core changes): `rug_round rug_heart bath_mat picnic_blanket` — other
  furniture may stand on the same cells (a table on a rug).

### Lights
`table_lamp 13, floor_lamp 14, lamp_ceiling 15, fairy_lights 10, lantern_post 14, candle 9,
fireplace 13, tv 6 (only while a show is on)`. All toggle with the `lamp` action (fireplace:
`fireplace`, TV: `tv`) through `data.on`. Candles and the fireplace flicker their point light
via `entity.lightScale`.

## Hand-tool actions (all registered with `game.entities.registerAction`)
Every action has a hint bubble, a sound and particles.

`sit` (chairs, sofa & bench — nearest of `def.seats`, armchair, beanbag squish, stool, picnic),
`sleep` (all beds & crib; bunk bed: top or bottom by where you tap, `def.sleepSpots`; a quilt
tucks her in; dreamy fade with moon, stars and Zzz; skip to morning; "Good morning, <name>!";
tapping the bed again says "Tap to get up"), `door` (doors & gate: eased swing, colliders
follow `data.open`, open doors let you pass, a closing door steps her out of the way),
`window` (curtains), `lamp`, `piano`, `tv` (3 channels on a live canvas screen, then off),
`book`, `easel`, `mailbox` (letter panel; a new letter arrives every `time:morning`), `cook`,
`wardrobe` (wardrobe, dresser, vanity, mirror), `sink`, `shower`, `bath`, `toilet`, `towel`,
`fireplace`, `clock` (says the game time), `picture` (next painting), `plant` (water; a potted
plant blooms), `toy_chest` (lid opens, confetti, a toy pops out), `pet_bed`, `hug`, `swing`
(really swings, she rides it), `slide` (slides down with a rainbow trail), `trampoline`,
`float`, `wish` (well & fountain), `bird`, `balloon`, `dollhouse` (front swings open),
`climb` (ladders), `yum` (cake & fruit).

Also without tapping: landing on a trampoline bounces (hold Jump to bounce higher); pressing
forward or Jump while touching a ladder climbs it (tapping a ladder climbs to the top and steps
off). Fences join up with neighbouring fences, gates and solid blocks (`data.conn`).

## Panels registered
- `piano` — `ui.open('piano', { entity })`: two-octave rainbow keyboard (C4–C6, black keys,
  A–L / W–P keys on a keyboard, finger glissando), songs "Twinkle Twinkle", "Mary's Lamb",
  "Happy Birthday" with **Listen** and **My turn** (follow the glowing key). Every note plays
  `audio.play('note:<midi>')`, floats a note particle out of the piano and emits
  `'piano:note' { note }`.
- `book` — `ui.open('book', { story? })`: 4 illustrated storybooks (4–5 pages each), Back/Next,
  "Read to me" (speech synthesis when available; automatic when `settings.readAloud`).
- `easel` — `ui.open('easel', { entity })`: paint a 16×16 picture (16 colors, brush, fill,
  undo, clear); **Done!** stores it as `entity.data.pic` (256 hex chars) and shows it on the easel.
- `letter` — `ui.open('letter', { entity })`: a kind note from a random friend.

## Cross-team contracts (how this side behaves)
- **Cooking**: stove / oven / fridge / counter call
  `game.ui.open('cooking', { entity, station })` with station `'stove'|'oven'|'fridge'|'counter'`
  (`def.station`). Without that panel: toast "Yum! Cooking is coming soon to this kitchen!".
  `sink_kitchen` runs water (it is not a cooking station).
- **Dress-up**: wardrobe, dresser, vanity and mirror run `game.runAction('dressup')` (or open a
  `dressup` panel), else a friendly toast.
- **Pet beds**: key `pet_bed` (1×1, no collider). Pets can find them with
  `game.entities.all().filter(e => e.key === 'pet_bed')`; the bed's centre is
  `entities.localToWorld(e, 0.5, 0.15, 0.5)`.
- **Food on tables**: any def with `placeOn: 'table'` stands on the surfaces above.
- **Prefabs**: `api.furn(key, x, y, z, rot, color)` works with every key above; colors outside
  the swatch list work too (models take any hex).
- Stickers: `home_sweet_home` fires from `entity:place` (keys `bed_*` + `door*`),
  `sweet_dreams` from the sleep action, `musician` from `piano:note`.

## Model kit (for other teams that want it)
`src/things/furniture/kit.js` — `new Kit()` then `box / cyl / cone / ball / torus / stick /
pixels(rows, px, map)`, `part(name, x, y, z, init?)` for moving bits, `hitbox()` for a bigger
pick box, `build()` → Group with every static piece merged into one mesh per material (plain
colors share one vertex-colored material). `partsOf(entity)` returns the moving parts.
Textures: `src/things/furniture/paint.js` (quilts, wood, fabric, fluffy, tiles, bricks,
stone, stripes, mirror, water, paintings, clock face), all cached and shared.

Performance: a furnished 4-room house plus garden (116 pieces) adds ~180 draw calls; the whole
catalog is ~3 draw calls per piece. Only TVs that are on and easels with a painting create
per-entity textures (disposed with the model).

## Entity data used
`door*/gate { open }`, `window_frame { open }`, `tv { ch, on }`, `fireplace/lamps { on }`,
`fence { conn }`, `easel { pic }`, `mailbox { mail }`, `plant_pot { bloom }`,
`picture_frame { art }`, `pool_float { water }`, `dollhouse { open }`. All saved with the world.

## Core changes (additive)
- `src/things/entities.js`
  - `def.colliders` may be a function `(data, entity) => boxes` (doors: open ones let you pass).
  - `def.flat` (rugs/mats): kept in a separate cell map, so other furniture can stand on the same
    cells; `entities.at()` returns the non-flat piece first.
  - Point-light intensity is refreshed every frame and multiplied by `entity.lightScale`
    (default 1) so fireplaces and candles flicker; the nearest-lights assignment still runs 4×/s.
- `src/core/input.js`: a still left press longer than the hold delay whose hold timer never
  ran (a long frame delivered the release first) now counts as a tap, as DESIGN.md promises
  ("a slow, still press is just a tap"). This made the smoke test's slow bed press flaky under
  CPU load.

## Tests
`node tools/probe-furniture.mjs [--only=showroom|house|actions|touch]` — showroom of every
piece, the furnished dollhouse by day and night, then real clicks/taps on lamps, doors (walk
through / blocked), piano keys and songs, storybook, TV, fireplace, clock, window, picture,
stove & wardrobe (fallbacks), toy chest, mailbox letter, bath, shower, sleeping in the canopy
and the top bunk, stairs, ladders, trampoline, swing, slide, easel painting, dollhouse, pool
float, fences, rug + table, save & reload; plus an iPad pass (Bag tabs, color picker, tap to
place, sleep, piano). Screenshots: `.shots/furniture-*.png`.
