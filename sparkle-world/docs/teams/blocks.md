# Team "blocks" — Block library & world types

Owner of `src/world/blocks.js`, `src/world/worldgen.js`, `src/world/paint/*` (tile painters +
block definitions per Bag tab) and `src/world/biomes/*` (one file per world type plus the
shared generator toolkit). No core files were changed.

## Block library (213 blocks + air)

Every tile is a deterministic 16×16 pastel pixel-art painter (seeded by the tile key). The
painting kit is `src/world/paint/kit.js` (`Pix` buffer with wrap-around coords, plum-leaning
shading, tileable value noise, knit/planks/bricks/leaves/bark/drip/sprinkle/glass helpers,
string pixel-art via `p.art(rows, palette)`). Registration order = Bag order inside a tab
(the tab's own icon is its first item).

Legend: `(cross)` sprite, `(slab)`, `(carpet)`, `(liquid)`, `~` translucent, `*N` light level.

- **nature (41)**: grass dirt path stone mossy_stone sand sand_pink gravel clay grass_snowy snow
  ice~ ice_packed grass_moss moss water(liquid) log_oak leaves_oak log_birch leaves_birch
  log_cherry leaves_cherry palm_log palm_leaves log_pine pine_leaves snow_leaves log_fairy
  leaves_fairy mushroom_stem mushroom_cap_red mushroom_cap_glow*12 coral coral_purple
  coral_yellow coral_blue shell seashell(carpet) starfish(carpet) lily_pad(carpet)
  seaweed(cross)
- **building (42)**: planks_{pink white lavender mint sky oak birch cherry} brick_{red pink
  white lavender} stone_bricks cobble quartz quartz_pillar marble terracotta_{peach pink
  lavender mint} slab_{oak pink white stone quartz}(slab) roof_{red blue pink lavender mint
  straw} bookshelf tile_kitchen tile_bath tile_pink wallpaper_{hearts stars stripes flowers
  polka rainbow}
- **colors (38)**: wool_<c> and carpet_<c>(carpet) for c in pink red orange yellow lime green
  cyan sky blue purple magenta brown white lightgray gray black; concrete_{pink peach yellow
  mint sky lavender} ("Pastel Pink"…)
- **candy (26)**: lollipop_block grass_frosting grass_frosting_mint grass_frosting_vanilla
  cookie frosting_{pink white mint chocolate} chocolate waffle_cone candy_cane peppermint
  gumdrop_{pink orange yellow green blue purple} cotton_candy cake_sprinkles marshmallow
  candy_stick choco_milk(liquid) strawberry_milk(liquid) lollipop(cross)
- **glass (13)**: glass_heart glass glass_pink glass_lavender glass_blue glass_mint
  glass_yellow glass_star glass_flower (all cutout) glass_stained_{rainbow pink blue purple}~
- **lights (11)**: lamp_block*15 lantern*14 (paper lantern) sea_lantern*15 star_block*15
  heart_lamp*13 moon_lamp*12 pumpkin_lantern*14 (smiley on its +Z front)
  crystal_{pink blue purple}*11 candle(cross)*12
- **garden (22 + 1 hidden)**: flower_{rose tulip tulip_pink tulip_red tulip_white daisy cosmos
  sunflower poppy lavender bluebell lily forgetmenot}(cross) grass_tall fern mushroom_red
  mushroom_glow*10 (cross) hedge hedge_flowers pumpkin melon hay farmland ("Garden Soil");
  hidden: farmland_wet
- **fun (18)**: rainbow cloud glitter_{pink gold blue purple} jelly_{pink blue green purple}~
  gem_{pink blue purple} gold_block gift toy_block snowman_head (face on +Z) music_block

Every canonical key from DESIGN.md §2 exists (the probe checks the full list, including all
16 `wool_*`/`carpet_*`). `gumdrop_<color>` exists for pink orange yellow green blue purple.
`slab_oak` keeps its core meaning.

Notes for other teams:
- **Id budget**: 214 of the 255 block ids are used. ~40 remain for other teams' blocks; please
  prefer entities for crops/decorations.
- **Farmland**: `farmland` (visible, "Garden Soil") and `farmland_wet` (hidden) are registered
  here, so garden.js's "register only if missing" never triggers.
- **Music Block**: Hand-tap plays the next note of a happy scale (`audio 'note:<midi>'`), emits
  a `note` particle and `'piano:note' { note, source: 'music_block' }` (so it counts toward the
  `musician` sticker). Hint: "Tap to play a note".
- **Flat icons**: seashell/starfish/lily_pad are thin carpet-shaped decorations (solid, cutout,
  `replaceable`); their Bag icon is drawn flat (`item.icon` override in blocks.js).
- **Lily pads** sit in the cell above a pond's surface; you can hop on them.
- Painter helpers still exported from `blocks.js`: `px rect speckle voronoi paintWool
  paintPlanks`, plus `WOOL_COLORS` (key suffix → hex) and `CORE_WOOL` (same object).

## World types (`game.registry.biomes`, New World order)

| key | name | ground / features | sea |
|---|---|---|---|
| `meadow` | Flower Meadow | rolling grass hills, flower drifts (one kind per patch), oak/birch/cherry forests, bushes, mossy boulders, a pumpkin & melon patch, a lily pond ahead of the start fed by a **waterfall** off a little cliff (hidden nook behind the water), garden path from the start to the pond | water |
| `candy` | Candy Land | cake-layer terraced hills in a strawberry/mint/vanilla frosting patchwork over cookie & chocolate, lollipop trees (discs face the start), giant candy canes, cotton-candy & ice-cream trees, gumdrop bushes, lollipop sprites, a **chocolate-milk pond** with a waffle path, **cotton-candy puff clouds** in the sky | strawberry milk |
| `beach` | Beach Island | one round island with a grassy hill in the middle, wide sandy shore with pink-sand patches, palms (leaning, coconuts), seashells & starfish, a shallow **lagoon** with a channel, 3–5 **palm islets**, a sandcastle, coral gardens in the shallows | water (shallow shelf) |
| `snow` | Snowy Wonderland | deep-snow hills (little steps stay white), snowy pines + frosted birches, **frozen pond** (ice over water) with a path, snowmen (with hats), frosty bushes, blue-ice spikes, ice floes | water |
| `fairy` | Fairy Forest | fairy-moss hills, purple willow-like fairy trees with hanging strands and lanterns, giant glowing and red mushrooms, crystal clusters, fairy rings of glowing mushrooms, bluebells/lilies/lavender/ferns, lily pond with a **waterfall** and pebble path | water |
| `flat` | Builder Flat | perfectly flat grass at y 16 (top at 16, stand at 17), little flower patches only far from the middle | none (grass ring) |
| `mix` | Everything Land | jittered grid of regions (middle = meadow, neighbours always differ, all five types used), heights blended by soft distance weights over domain-warped coords, ground/trees/flowers from the dominant region, candy clouds over candy regions, snowmen, crystals, coral | water |

Every generate():
- sets `world.waterLevel` (20; flat 0) and `world.outside` (`{ block, surface }`; Candy Land
  uses `strawberry_milk`, flat uses `grass` at 17);
- sets **`world.gemSpots`** = 20–30 `[x, y, z]` air cells (24 Cozy / 28 Big), spread ≥ ~9
  apart, ≥ 7 from the start, mixing kinds of places: hilltops, under trees, flower fields,
  behind the waterfall, islets, lagoon, sandcastle, snowmen, mushroom/crystal/candy-cane/
  ice-cream tops, fairy rings, on top of puff clouds, the frozen pond; and **`world.gemTotal`**
  = `gemSpots.length`;
- stores its chosen start in `world._spawn`; `biome.spawn(world)` (= `biomeSpawn` from
  worldgen.js) returns it when it is still a safe standing spot, else `defaultSpawn`.
  The start area is a flat clearing (radius ~6, blending out to 15) with a ring of flowers;
  the player faces −Z, toward the pond/waterfall and two "hero" trees framing the view.

Sky palettes (`biome.sky`, hex): `{ top, horizon, fog, sunset, nightTop, cloud }` for every
biome. Current daynight.js reads `top`/`horizon`; the environment team can use the rest.

Biome def: `{ key, name, description, iconBlock, colors: [cardTop, cardBottom], sky,
generate(world, rand, noise), spawn(world) }` (card icons: grass, grass_frosting, shell,
snowman_head, mushroom_cap_glow, planks_pink, rainbow).

**Menus team**: `NAME_IDEAS` has no `mix` entry yet (falls back to meadow names). Suggested:
`mix: ['Everything Land', 'Wonder Island', 'Rainbow Kingdom']`.

### Generator toolkit (src/world/biomes/gen.js)
`new Gen(world, rand, noise, { sea })` with `shape(fn)`, `flattenSpawn`, `islandEdge` (rounded
wobbly coast), `carvePond` (water level = lowest rim − 1, rim kept, so no floating water) +
`pourPonds`, `fillColumns(fn -> [top, under, deep, depth, mid, midDepth])`, `fillSea`,
`scatter` (spacing + claims), `eachSurface`, `gem(x, y, z, tag)`, `hilltopGems`, `pickGems`,
`finish()`. Growers in `TREES`: oak birch cherry palm pine fairy mushroom crystals lollipop
candyCane cottonCandy iceCream gumdropBush snowman; plus `blob mound puffCloud
waterfallCliff`. Region pieces (`height column surfaces forest tree flora`) are exported by
each biome file for Everything Land. Legacy helpers `idOf put peek fillColumn growTree
defaultSpawn` stay exported from worldgen.js.

## Performance (headless Chromium + SwiftShader, this container)
Big world (208×64×208) generation, best of 2 runs (`game.worldgen.benchmark`):
meadow ~50 ms, candy ~40 ms, beach ~40 ms, snow ~40 ms, fairy ~35 ms, flat ~7 ms, mix ~150 ms
(core lighting afterwards 20–45 ms). Budget was 1.5 s. Same seed ⇒ identical blocks
(checked by hash); another seed ⇒ another world.

## Debug / tests
- `game.worldgen.generate(biome, size, seed)` → an off-screen World; `game.worldgen.benchmark
  (biome, size, seed)` → `{ genMs, lightMs, gems, gemSpots, spawn, hash, … }`.
- `node tools/probe-blocks.mjs [--only=sheets,bench,gallery,biomes,ui] [--biomes=a,b]
  [--seed=7] [--size=cozy|big]` — library checks (≥130 blocks, canonical keys, names, tabs,
  painted faces), texture contact sheets + Bag icon sheets, the block gallery (every block in
  rows, day + night), every biome from the spawn (real HUD) + aerial + low + night +
  waterfall close-ups, Big-world benchmark/determinism/gem/spawn checks, and real-UI checks
  (New World wizard → Everything Land, every Bag tab, click Lollipop Swirl → click the ground to
  place it, click a Music Block with the Hand tool). Screenshots: `.shots/blocks-*.png`.
