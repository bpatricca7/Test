# Integration fixes — area "world" (entities, furniture, Magic Houses)

Changes made after the seven feature branches were merged. Contract changes are marked
**(contract)**; DESIGN.md is left as it was, so read this file with it.

## Furniture draws in a couple of calls per house (contract)

A furnished house used to cost about 2.9 draw calls per piece (452 calls for the 155 pieces of
castle + cottage + modern house; about 1,500 for a town of 18 Magic Houses), and
`renderer.render()` took 9 to 16 ms of CPU per frame. Two changes fix this:

- **One atlas material** (`src/things/furniture/atlas.js`). The furniture Kit now puts plain
  colors *and* the shared 16x16 pixel-art materials of `paint.js` (wood, fabric, quilts, tiles,
  bricks, stone, stripes, fluffy, glow, lamp shades...) on ONE `MeshLambertMaterial`: vertex
  colors, plus a per-vertex `fLook` attribute = (texture-array layer or -1, glow). Glow is
  emissive = color x glow, which is what `glow()`, the lamp shades, the piano and the balloons
  did before. Front-only and double-sided (lamp shades) are two variants: `ATLAS_MAT`,
  `ATLAS_MAT_2`. Anything that does not fit keeps its own material exactly as before:
  see-through (`sheer()`, water), per-piece textures (TV screen, easel picture) and bigger
  images (paintings 32x32, mirror, clock face, screen-off). The pictures are the same as
  before: showroom and interior screenshots were compared pixel by pixel, day and night.
  `paint.js` materials now carry `material.name` = their cache key, and their canvases are
  created with `willReadFrequently`, so copying one into the texture array is cheap.
  `sheer()` materials draw both sides in one pass (`forceSinglePass`), which halves their calls.
- **Static batching** (`StaticBatcher` in `src/things/entities.js`). When a piece is placed,
  the static meshes of its model (the Kit marks them `userData.batch`) are baked into world
  space and **taken out of `entity.object3d`**. All pieces in a 16x16 square of the world are
  merged into one mesh per material, so a square costs one or two draw calls. The batches live
  under `entities.group` (child `furniture-batches`). A batch is rebuilt just before the next
  render of the scene when a piece in its square is placed, removed, turned or rebuilt
  (`setData`, `refresh`). Lamps, curtains, TV channels and fences are all `setData`, and a
  rebuild costs a few ms. Doors keep no static meshes, so opening one rebuilds nothing.
  - What stays in the piece's own model: its **parts** (`partsOf(entity)`: door leaves,
    lids, flames, swing seat...), see-through and one-off-material meshes, hitboxes.
  - **(contract)** Code that moves or scales a piece's *whole* model must set
    `batch: false` on the def (as `beanbag` and `trampoline` now do); otherwise animate a part.
    Code that walks `entity.object3d` looking for static meshes will not find them.
    `entity.pickable.box` is still the full model's box (measured before baking).
  - The batch attribute arrays are freed once uploaded to the GPU. After a lost WebGL context
    comes back, every batch is rebuilt from the pieces' baked copies.
  - `game.entities.batcher.info()` → `{ regions, meshes, pieces, failed }` for probes. If a
    rebuild ever throws, batching switches itself off and every piece is rebuilt whole.

Measured with 1024x768 and SwiftShader, same scene as the review (Big meadow world, castle +
cottage + modern house, night): furniture 452 → 79 draw calls, frame 656 → 283,
`renderer.render()` CPU 9.3 → 2.2 ms. Town of all 18 Magic Houses seen from above: furniture
~1,490 → ~290 calls (522 pieces). Placing furniture costs the same as before.

Not done here (other areas): pets are still 12–18 meshes each (pets owner), and the HUD
target outline is still 13 meshes (HUD owner).

## Table-top items on low and tall tops

`entities.placeFromHit`: a `placeOn: 'table'` item tapped on the **top face** of a piece with
`surface` now goes in the cell right above that piece's footprint (under the tapped spot),
`y = piece.y + size[1]`. Before this, the generic pick cell (`floor(point.y + 0.5)`) was the
piece's own cell for the coffee table (top 0.47) and its upper cell for the piano (1.26) and
the fireplace mantel (1.38): "No room there!". `surfaceBelow` and `yOffset` then put the item on
the real top (e.g. yOffset −0.62 on the mantel). The generic pick math is unchanged: the desk,
whose pick box reaches 1.06, relies on it. This covers candles, lamps, plants and cake stands
from the Furniture team and all food from the Life team.

## Magic Houses

- Modern House: the TV stood on the bathroom door's front cell, so nobody could get into the
  bathroom. The bathroom door now opens from the kitchen side (in the partition at x = 11,
  facing −x), and the TV stands against the solid partition, centred on the sofa and the coffee
  table.
- Desktop: moving the mouse onto the house bar (to press Turn or Build!) used to make the canvas
  lose the cursor, so the ghost jumped to the screen centre and Build! built there. The ghost
  now stays where she pointed while the mouse is on the bar (`toolbar.hover`).
- The see-through ghost (house, footprint, corner posts) hides between `thumbnail:before` and
  `thumbnail:after`, so it is not in My Worlds pictures or in photos. The pop-in of a house
  being built is left in: that is the house appearing, and the world only changes at the end.

## Furniture panels

- Piano on a phone (≤ 600 px): each song card takes a full row and its Listen / My turn buttons
  sit side by side inside it. Buttons may also wrap, never overflow.
- Storybook "Read to me" uses `game.speak(text, true)` (the voice, rate, pitch and volume the
  settings module picked for every toast and tip). It still cuts off the previous page when
  you turn the page. The old local voice is kept only as a fallback.

## Probes

- `tools/probe-prefabs.mjs` gallery: every door and gate of every Magic House can be walked
  through (with the door open, she fits in its front and back cells, one step up or down
  allowed), and a draw-call budget for the town (furniture ≤ 0.65 calls per piece). The Bag tab
  selector is now `.sw-tab2` (the Menus team renamed it), and the ghost-in-picture check is in
  the ui pass. The Turn, Hand-tool and tap-to-move checks wait for the frame instead of a
  fixed time (they failed under CPU load). The "bar covers no HUD control" check tests the
  buttons and pills in the corner groups, not the empty part of their boxes (the new HUD's
  right column box spans under the bar on a portrait iPad while no button does). All three of
  these failed on the merged build before this change.
- `tools/probe-furniture.mjs`: new `--only=tops` pass (a candle and a cupcake clicked onto the
  top of each of the 12 pieces with a surface, standing exactly on it), a phone pass (piano
  song buttons inside their cards, tappable, and "My turn" works), `.sw-tab2`, and the Bag is
  closed with `.sw-bag-close` (the new Bag has no `.sw-close`).
