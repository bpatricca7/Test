# Holiday Village: the world (wave 5, team holiday-world)

The `holiday` biome: a snowy valley at the top of the world, ringed by white mountains, always in
its prettiest winter-evening light and full of twinkling lights. This team owns the blocks, the
generator, the New World card and the feature records the other holiday teams build on
(wave5-plan.md §2.2, §4.2, §7.3).

Owned files:

| file | what |
|---|---|
| `src/world/paint/holiday.js` | the 16 holiday blocks and their tile painters |
| `src/world/biomes/holiday.js` | `generate`, `paintArt`, the biome def (`sky`, `weather`), the record helpers the test uses |
| `tools/test-holiday-world.mjs` | the Node test (H0..H7) |
| `docs/teams/holiday-world.md` | this doc |

Shared lines touched (both listed for this team in wave5-plan.md §6 / §3):

- `src/ui/inventory.js` `TAB_PICS.holiday` (the Bag tab's pictures).
- `tools/lib/name-scan.mjs` `EXTRA.holiday`: ten more encoded entries appended (the song
  reindeer, a famous story miser, a famous claymation elf, the snowman song's name, a film elf's
  name, a famous grump-film girl). `node --test tools/test-name.mjs` passes.

## 1. Design

North is -Z (where a new player looks). Distances are blocks from the giant tree, which stands
in the middle of the world. The village floor is `GROUND = 22` (the top solid block of the square,
lanes and lots).

```
                 mountains (all round, rock on the steep sides)
        elf home (mint)        SANTA'S WORKSHOP (red + green, gable to the south)
                  \                  |  light tunnel (3 arches, garland hedges)
  sledding hill   \                  |
  (rises west)     -----  ICY ARCH [ SQUARE + GIANT TREE ] GOLD ARCH ----- pasture | stable
  skating pond (ice) -----/          |  red arch                             (fence, gate)
                                     |  Candy Cane Lane                 launch hill + sleigh
     cottage           cottage  [lane] cottage
                       cottage  [lane] cottage      (Big: one more pair and one more cottage)
```

- **The village square** (the spawn): a 13-block-radius plaza. A red wool tree skirt with a white
  rim round the trunk, a peppermint ring, white bricks at the edge with a low garland hedge of
  light blocks (open where the four avenues come in), 8 lamp posts, 4 benches facing the tree,
  the cocoa stand (`candy_shop` for now) on the south-west, the Dress-Up booth on the south-east,
  the striped North Pole post (candy cane column, gold bauble on top), two snowmen.
- **The giant tree**: trunk 3 x 3 pine logs, 6 tiers of pine needles from 4 to 31 blocks above
  the floor (bottom radius about 10, a scalloped rim so tiers read as branch tips), three light
  strings (red-multi, gold, icy) spiralling round it (one turn every 7.5 layers), baubles
  (red / gold / blue, they glow a little) and snow on the tier tops, a 3D star of `holiday_star`
  blocks (two crossed 7 x 7 stars) on top: 39 blocks above the floor in all. 8 present spots
  round the trunk under the lowest branches (head room 3).
- **Light arches** (candy-cane pillars, a curve of light blocks, 6 high) at the mouths of the
  south, east and west avenues; a **light tunnel** of three arches in alternating colors with
  garland hedges along both sides up the north avenue to the workshop.
- **Avenues**: 5 wide, packed snow (`path`) with white quartz edges and peppermint stepping
  stones every third block.
- **Santa's workshop** (17 x 13, door 3 x 3 facing the tree): red workshop planks with candy-cane
  corners and a green band, holly over the door, a golden-light door frame and a star sign,
  lit windows, a green snowy gable roof (gold lights along its front and back edges), a brick
  chimney. Inside: toy shelves along the back and the sides, Santa's chair (`armchair`) on a red
  dais with a glowing star over it and a rug in front, two workbenches with stools, a dollhouse,
  a toy chest, a teddy, an easel, a balloon bunch, ceiling lamps and fairy lights, presents by the
  door, the **Gift Workshop** bench spot in the middle.
- **Candy Cane Lane**: cottages face the lane from both sides (2 pairs Cozy, 3 pairs Big), giant
  hooked candy canes with a red bauble every 12 blocks, lamp posts between, garland hedges of
  lights and holly along both edges with gaps at every cottage path.
- **Cottages** (7 x 7, walls 4 high, gable roof with light-string edges, icing dripping off the
  eaves, holly bushes under the front windows, a peppermint step, a wreath over the door, a
  chimney over the fireplace). Six looks (gingerbread / pink / white / mint frosting walls,
  candy-cane or white pillar corners, red or green roofs, three light colors, four floor woods).
  Furnished through `furn`: door, single bed, nightstand, fireplace, sofa, round table, chair,
  floor lamp, fairy lights on the ceiling, a present block.
- **The Twinkle Elves' cottage** (north-west, mint walls, peppermint corners, icy lights): a toy
  corner with toy shelves, a toy chest and a teddy by the fire instead of a bed; the
  `holiday:elfhome` spot beside its door.
- **Reindeer stable and pasture** (east): a 17 x 15 snowy pasture fenced in white (`fence`
  records with their `data.conn` worked out, a `gate` on the west side between two lit log
  posts), the stable closing its east side (red planks, open front with a beam of lights, a hay
  floor, stalls, lanterns, a red snowy roof); hay bales outside the gate.
- **The sleigh's launch hill** (south-east): a round snowy mound 5 high with a flat 9 x 5 pad,
  four lamp posts, the sleigh spot facing west down the hill, runway lights set into the snow
  down its front.
- **The skating pond** (west): frozen right through (ice from rim to rim, flush with the floor so
  skaters glide straight on), benches, lamp posts, a lantern pillar, a snowman.
- **The sledding hill** (beyond the pond, north-west): a 12-block slope rising west into the
  mountains, lights down both sides of the run, a candy-cane flag pole with a red bauble on top.
- **Pine forest** everywhere else (denser in noisy patches): 30% of pines wear baubles, about
  18% light strings, 8% a star on top. Snowmen and snowy bushes in the clearings. Gems: under
  trees, by snowmen, on hilltops, on the tree's star, beside Santa's chair, by the hay. A gem
  candidate inside a feature record's cells, or sealed in (no air path to the sky), is dropped
  before the gems are picked (`openToSky`); the tree elves are checked the same way.
- **Mountains**: from 24 (Cozy) / 30 (Big) blocks in from the edge the ground rises 10 to 28
  blocks with ridged peaks; steep sides show grey rock; at the very edge it eases down to 8 above
  the floor to meet the flat snowy horizon (`world.outside = { block: 'snow', surface: 31 }`).

### Light and sky

- `sky`: deep blue top `#5368C9`, lavender `mid` `#B497E0`, rosy horizon `#FFC2D6`, pink fog
  `#F2D8EE`, pink sunset / sunrise, deep indigo night `#141A4A`, pinkish clouds. Even at noon it
  reads as a winter evening.
- Every light block glows at night (light levels 12 to 15; baubles 8). By day the shader shows
  the sky light, so the lights only twinkle as colored bulbs in their tiles: the
  `sky.daylightMax` Wanted item below would make them glow by day too.
- `weather`: `{ sunny: 1.5, cloudy: 1, rain: 0, rainbow: 0, snow: 7 }` (read by weather.js today,
  no core change): it snows most of the time and never rains.
- A new world starts in sunny weather until the first change (weather.js only starts the `snow`
  biome in snow): the `startWeather` Wanted item below fixes that.

## 2. Blocks (all in the `holiday` Bag tab, 16 of the 16 allowed)

| key | name | light | notes |
|---|---|---|---|
| `holiday_lights` | Twinkle Lights | 13 | pine garland with red / gold / blue / green / pink bulbs, sound chime |
| `holiday_lights_gold` | Golden Lights | 14 | dark pine, warm gold and white bulbs |
| `holiday_lights_icy` | Icy Lights | 12 | frosted pine, icy blue and lilac bulbs, white wire |
| `holiday_star` | Tree Star | 15 | the glowing star |
| `holiday_bauble_red` / `_gold` / `_blue` | Red / Gold / Blue Bauble | 8 | shiny ornaments in needles |
| `holiday_present` | Wrapped Present | 0 | top and side tiles (bow on top) |
| `holiday_gingerbread` | Gingerbread | 0 | dough with icing piping and candy dots |
| `holiday_icing` | Icing Trim | 0 | cutout (see-through), icicle drips; `lightOpacity` 0 |
| `holiday_window` | Cozy Window | 12 | warm lit window panes |
| `holiday_roof` | Snowy Red Roof | 0 | shingles, snow on top, plain underside |
| `holiday_roof_green` | Snowy Green Roof | 0 | the same in green |
| `holiday_holly` | Holly | 0 | cutout leaves with berries |
| `holiday_planks_red` | Workshop Planks | 0 | red barn boards |
| `holiday_toy_shelf` | Toy Shelf | 0 | toys on a shelf, oak top and bottom |

The registry has 230 blocks with these (limit 256).

`TAB_PICS.holiday`: `block:holiday_lights`, `block:holiday_star`, `block:holiday_present`,
`block:holiday_gingerbread`.

## 3. Feature records (`world.features`, wave5-plan.md §4.2)

Every record is checked in `generate()` before it is handed out (`Village.finalize`): its cells
(by the same footprint rule as `game.entities`) are inside the world and empty (a flower sprite
is cleared), the floor under its bottom cells is solid (a solid block over a ceiling lamp), and no
two records share a cell (rugs aside). A record that does not fit is dropped and listed in
`world.holidayDropped` (`[{ record, why }]`, in memory only; the test requires it empty).
`x, y, z` is the first air cell above the floor. Extra fields beyond the plan are optional
helpers; owners may ignore them.

| kind | count (Cozy / Big) | fields | where |
|---|---|---|---|
| `holiday:workshop` | 1 / 1 | `rot` 0 (faces +Z, the door) | the middle of the workshop floor; 3 x 3 x 3 kept clear behind the anchor |
| `holiday:presents` | 1 / 1 | `n: 8`, `spots: [[x, y, z] x 8]` (one cell per present, round the trunk, the ones facing the spawn first), `tree: [x, z]` | under the giant tree |
| `holiday:elf` | 19 / 22 | `where`: `pole`, `snowman`, `sign`, `shelf` (2), `chimney`, `window`, `roof`, `hay`, `fence`, `lamp`, `flag`, `tree` (2) | listed in §3.1 |
| `holiday:elfhome` | 1 / 1 | `rot` = the cottage's facing | beside the elves' cottage door (1 x 2 x 1 clear) |
| `holiday:dressup` | 1 / 1 | `rot` 3 (faces west, into the square) | south-east of the tree; 3 x 3 x 3 clear |
| `holiday:reindeer` | 1 / 1 | `n: 4`, `area: [x0, z0, x1, z1]` (the open pasture inside the fence, every cell floor + 2 air), `y` (= the floor + 1) | the pasture |
| `holiday:sleigh` | 1 / 1 | `rot` 3 (faces west, down the hill) | the launch pad; 3 wide x 3 high x 7 long clear behind the anchor |
| `holiday:spot` | 8 / 8 | `name`: `tree`, `workshop`, `elfhome`, `cottages`, `stable`, `sleigh`, `pond`, `sledding`; `rot` faces the place | in front of each place (1 x 2 x 1 clear) |
| `furn` | about 140 / 170 | `key`, `rot`, `color` (always one of the piece's swatches), `data` (fences: `{ conn }`) | below |

Furniture keys used: `lantern_post` (square, lane, pond, launch pad), `bench`, `candy_shop` (the
cocoa stand), `door`, `bed_single`, `nightstand`, `fireplace`, `sofa`, `table_round`, `chair`,
`floor_lamp`, `fairy_lights` (ceiling), `lamp_ceiling`, `armchair` (Santa's chair), `rug_round`,
`table_long`, `stool`, `dollhouse`, `toy_chest`, `teddy_bear`, `easel`, `balloon_bunch`,
`fence`, `gate`.

### 3.1 Elf hiding places

On top of the North Pole post, on a snowman's hat, on the holly ledge over the workshop door,
on two toy shelves inside the workshop, on the workshop chimney, at each cottage (under a
window, on the roof ridge or on the chimney, in turn), on the hay in the stable, on the stable
roof, on a pasture fence post, on the lantern pillar by the pond, on the sledding flag, on a low
branch of the giant tree (south side) and in a forest pine near the pond.

## 4. Numbers

| what | value |
|---|---|
| world floor | y 22 (`GROUND`) |
| spawn | the square, 12 south of the tree, looking north at it |
| giant tree | needles 4..31 above the floor, star to 39, bottom radius ~10 |
| plaza radius | 13 |
| workshop | 17 x 13, walls 6, roof ridge 16 above the floor |
| cottages | 7 x 7, Cozy 5 + the elves' cottage, Big 8 + the elves' cottage |
| pasture | 17 x 15 (inside 15 x 13) |
| mountains | start 24 / 30 in from the edge, 10..28 high |
| generate time | Cozy 15..60 ms, Big 25..45 ms (Node) |
| glowing blocks (light 12+) | about 1000 Cozy, 1450..1650 Big |

## 5. How to test

```
node tools/test-holiday-world.mjs          # H0..H7 below, seeds 1..5, Cozy and Big
node tools/worldview.mjs holiday --T=8     # pictures in .shots/worldview (iso, iso2, top, side)
node tools/worldview.mjs holiday --size=big --seed=3 --slice=23,24
node --test tools/test-name.mjs
node tools/build.mjs
```

- H0 at most 16 holiday blocks, every face tile has a painter that runs, registry headroom
- H1 every world generates in time (Big < 300 ms), no unknown block keys, nothing dropped
- H2 the spawn is on the square, south of the tree, solid floor and two free cells, no record on it
- H3 every record in bounds, air cells, floor (or ceiling), no shared cells, plan fields
  (presents `n` 3..8 with a spot each, reindeer `n` 1..4 and an open, floored `area`)
- H4 the counts (workshop, 6+ presents, 12+ elves in 6+ kinds of places, elf home, booth, 4+
  reindeer, sleigh, 5+ named spots including tree / workshop / stable / pond / cottages,
  furnished cottages, the cocoa stand, fence and gate with `conn`)
- H5 the giant tree is 25+ tall with the star on top, 25+ of each light, 20+ baubles
- H6 our furniture sizes, ceiling flags and colors match the catalog
- H7 the biome def (sky, snowy weather) and `paintArt` with a fake canvas (with and without tiles)

## 6. As built

- All of the above is in. 16 blocks. The New World card (`paintArt`) is a dusk scene: indigo to
  pink sky with stars and a crescent moon, lavender mountains with snow caps, a gingerbread and
  a pink cottage with lit eaves and smoking chimneys, the big lit tree with a glowing star,
  presents, a snowman, a candy cane, lamp posts and falling snow.
- Checked with worldview pictures (iso, iso2, top, slices) on seeds 1..5 Cozy and Big, and the
  card rendered through a fake canvas.
- `world.waterLevel = 0` (no sea; the pond is frozen), so the ocean code finds nothing to do here.

## 7. Wanted from the integrator

1. **Start in snow** (`src/life/weather.js`, `startingWeather()`): today only the `snow` biome
   starts snowing. Exact change:
   ```js
   startingWeather() {
     const b = biomeDef();
     return biomeKey() === 'snow' || (b && b.startWeather === 'snow') ? 'snow' : 'sunny';
   },
   ```
   (the holiday biome def already carries `startWeather: 'snow'`).
2. **Evening light by day** (`src/life/daynight.js`, the `uDaylight` line, about line 298): let a
   biome cap its daylight so the light strings glow even at noon. Exact change: keep the biome's
   cap when the sky is set (`setBiomeSky`: `daylightMax = Math.min(1, Math.max(0.4, sky.daylightMax ?? 1));`
   with `let daylightMax = 1;` next to `let fogBase = null;`), then
   ```js
   bu.uDaylight.value = Math.min(daylightMax, Math.max(0.4, (0.4 + 0.6 * dayF) * (1 - 0.13 * oc)));
   ```
   The holiday def carries `sky.daylightMax: 0.72` (ignored until then; other biomes unchanged).
3. **npm script**: `"test:holiday-world": "node tools/test-holiday-world.mjs"` in `package.json`.
4. If a real cocoa stand furniture arrives (shops team), swap `candy_shop` at the square's
   south-west for it (one line in `square()`, `holiday.js`; its size must be added to `FURN_SIZE`).

## 8. Open questions

- The elves team decides how many of the 19 / 22 elf spots get an elf ("of 12" may become "of
  19"); every spot is reachable on foot except the roofs and chimneys, which need a jump from a
  roof edge or flying.
- The reindeer team may want the herd's `area` smaller (the pasture is 15 x 13 inside the fence)
  or a feeding spot; ask and it is a one-line change.
- The sleigh record keeps 3 x 3 x 7 clear; if the sleigh model is bigger, say so (the pad is
  9 x 5, it can grow).
- Big worlds have the same village in a bigger valley (more forest and mountains around it);
  more could be added there later (a second lane, a market).
