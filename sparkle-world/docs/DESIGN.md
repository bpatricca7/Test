# Sparkle World — Design & Technical Spec

A cozy, blocky 3D world-building game for a girl who is almost 8. Think "Minecraft creative
mode" rebuilt around what she asked for: **make your own worlds, dress up your avatar in cool
outfits, build really nice houses, put beds (and everything else) in them, and do all the
things you do in life** — cook, garden, take a bath, play piano, have pets, sleep, take photos.

This document is the contract every contributor (human or agent) builds against. If code and
this doc disagree, fix one of them in the same change.

---

## 1. Player experience

### Audience rules (apply to every feature)
- Age 7–8. Short words, big friendly buttons, every button has an icon **and** a 1–2 word label.
- Nothing scary: no monsters, no damage, no dying, no hunger meter, no losing items. Falling in
  water = swimming. Falling off the world edge = gently float back.
- Creative mode only: every block and item is free and unlimited.
- Instant payoff: every action gives a little sound + sparkle. Big things (first house, first
  pet, sleeping) give a celebration toast and a sticker.
- Works with **mouse + keyboard** and with **touch (iPad)**. No pointer lock required.
- Saves automatically. You can never lose your world by accident (delete asks twice in-page;
  `confirm()` is not available inside the artifact frame).

### Screens / flow
1. **Title screen** — big "Sparkle World" logo over a live 3D backdrop (a pretty generated world,
   slow orbiting camera, the player's avatar waving in front). *Not built yet (Menus team): the
   core title uses a CSS sky/hills backdrop with floating block icons.* Buttons: **Play** (continue last
   world), **My Worlds**, **New World**, **Dress Up**, **Stickers**, **Settings**.
2. **New World wizard** — type a world name (suggestion pre-filled, e.g. "Lily's Rainbow Meadow"),
   pick a world type from big picture cards, pick a size (Cozy / Big), tap **Create!**.
   World types (biomes):
   - `meadow` Flower Meadow — rolling grass hills, flowers everywhere, oak + cherry-blossom trees,
     a pond, butterflies.
   - `candy` Candy Land — pink frosting ground, cookie dirt, chocolate pond, lollipop trees,
     candy canes, gumdrops, cotton-candy clouds.
   - `beach` Beach Island — island in a turquoise ocean, sand, palm trees, shells, a lagoon.
   - `snow` Snowy Wonderland — snow hills, frozen pond (ice), snowy pine trees, snowmen.
   - `fairy` Fairy Forest — purple-leaf trees, glowing mushrooms, crystals, fireflies, moss.
   - `flat` Builder Flat — perfectly flat grass, great for building towns.
3. **My Worlds** — cards with a thumbnail, name, world type, "last played"; Play / Rename / Delete
   (delete uses an in-page "Are you sure? Yes, delete / No, keep it" step).
4. **In the world (HUD)**
   - Bottom: **hotbar** of 9 slots (number keys 1–9 or tap).
   - Bottom-left of hotbar: **Bag** button (opens the full catalog).
   - Right side, stacked big round buttons: **Build** (place), **Remove** (magic eraser),
     **Hand** (use/interact) — one is active at a time. Plus **Fly**, **Emotes**, **Photo**.
   - Top-left: world name + time-of-day icon; gem counter.
   - Top-right: **Dress Up** (wardrobe), **Stickers**, **Menu** (pause: Resume, Settings,
     Save & Exit).
   - Center: soft crosshair on desktop; highlighted target block/face outline (sparkly).
   - Context hint bubble near the target: "Tap to sleep", "Tap to sit", "Tap to pet Biscuit".
   - Touch: left thumb joystick, right side drag = look, Jump button, Fly up/down when flying.
5. **Bag (catalog)** — tabs with pictures: Nature, Building, Colors, Candy, Glass & Windows,
   Lights, Bedroom, Living Room, Kitchen, Bathroom, Garden, Fun & Toys, Pets, Food, Magic Houses.
   Tap an item to put it in the selected hotbar slot. Items with colors (furniture) show little
   color dots; tapping one opens a "Pick a color!" step with a big picture of the item in every
   color (≥ 88 px buttons), the current slot's color marked.
6. **Dress-Up Studio** — full-screen: big 3D avatar on a turntable (drag to spin) with sparkly
   backdrop; category tabs (Skin, Hair, Eyes & Face, Tops, Bottoms, Dresses, Shoes, Hats &
   Ears, Glasses, Wings & Backpacks, Necklaces, Hand); each item a thumbnail; color swatches;
   pattern picker (plain, hearts, stars, stripes, dots, rainbow, flowers). "Surprise me!"
   randomizer, 6 saved **Outfit** slots, name field. Opened from title, HUD, or a wardrobe/mirror
   in the world.
7. **Sticker Book** — pages of stickers earned for milestones; locked ones show a hint.

### Things you can do in the world
| Activity | How |
|---|---|
| Build | Pick a block, tap a block face with Build tool. Press and hold still (0.42 s), then drag: a line of blocks on the layer you pressed (never climbing toward the camera); one Undo takes the whole line back. A slow, still press is just a tap. |
| Remove | Remove tool, tap a block, water or a piece of furniture (hold + drag erases a line on one layer). The solid bottom layer (y = 0) stays. Undo button (last 20 actions). |
| Magic Houses | Bag → Magic Houses → tap ground: a whole furnished house appears (cottage, princess castle, treehouse, candy house, beach hut, igloo, pet shop, bakery). Undo removes it. |
| Furniture | Beds, sofas, chairs, tables, lamps, wardrobes, rugs, TV, piano, kitchen, bathroom… placed facing you; tap with Build again on the same spot rotates. Colorable. |
| Sleep | Hand-tap a bed: avatar lies down, screen dims with stars and "Zzz", time skips to morning, "Good morning, <name>!" |
| Sit | Hand-tap chair/sofa/swing/bench. Tap again or move to stand. |
| Doors & lights | Hand-tap door to open/close, lamp to switch on/off (lamps really light the room at night). |
| Dress up | Wardrobe or mirror → Dress-Up Studio. |
| Cook | Hand-tap stove/oven/fridge → pick a recipe (cupcake, cookies, pizza, pancakes, ice cream, fruit salad, birthday cake, smoothie) → tap ingredients in order → food goes to your basket. Eat it (hearts), feed a pet, or place it on a table. |
| Garden | Seeds (flowers, sunflower, carrot, strawberry, pumpkin, watermelon); plant on grass/dirt, water with the watering can, watch it grow (4 stages, ~2–3 minutes), harvest. |
| Pets | Bag → Pets: puppy, kitty, bunny, pony, unicorn, panda, duckling. Name it, it follows you, sits, sleeps in a pet bed, gets hearts when petted/fed. Ride the pony or unicorn (rainbow trail!). |
| Music | Piano: tap keys on a mini keyboard (C major, two octaves) or "Play a song". |
| Bath | Bathtub → bubbles. Sink / shower → splashy particles. |
| TV | Hand-tap TV → cute animated shows (canvas animation). |
| Emotes | Wave, dance, twirl, cartwheel, jump for joy, heart hands, sit. |
| Photos | Camera button → UI hides, flash, polaroid preview → save to device. |
| Explore | Collect sparkling gems hidden around the world; swim; fly; butterflies & fireflies. |
| Weather & time | Day/night cycle (~12 min), stars and moon at night; weather wand in Settings: sunny, cloudy, rain, snow, rainbow. |

### Stickers (achievements)
`first_block` First Block · `builder` 100 blocks placed · `home_sweet_home` placed a bed and a
door in the same world · `sweet_dreams` slept in a bed · `best_friends` adopted a pet ·
`pet_lover` petted a pet 10 times · `little_chef` cooked something · `master_chef` cooked all
recipes · `green_thumb` harvested a plant · `fashionista` changed outfit 5 times ·
`gem_hunter` 10 gems · `gem_master` all gems in a world · `rainbow_maker` placed all 7 rainbow
colors · `night_owl` saw the stars · `musician` played 20 piano notes · `photographer` took a
photo · `unicorn_rider` rode a unicorn · `magic_builder` placed a Magic House ·
`world_maker` created 3 worlds · `splash` went swimming · `sky_high` flew above the clouds.

### Visual identity
- Pixel-art block textures (16×16, nearest filtering) in a **bright pastel** palette; soft fog;
  gradient sky (mint→sky blue by day, peach sunsets, deep indigo nights with twinkling stars).
- Per-vertex ambient occlusion + face shading + block light (lamps glow warm at night).
- UI: chunky "toy sticker" style — thick white outlines, candy colors, soft drop shadows,
  bouncy press animations. Font: **Fredoka** (Google Fonts) with fallback
  `'Fredoka', ui-rounded, 'Arial Rounded MT Bold', 'Trebuchet MS', system-ui, sans-serif`.
- UI palette tokens (CSS custom properties on `:root`, defined in `src/ui/theme.js`):
  `--sw-pink #FF5FA2`, `--sw-pink-soft #FFD1E6`, `--sw-lav #9C7BFF`, `--sw-lav-soft #E6DDFF`,
  `--sw-mint #3FD8B0`, `--sw-sun #FFC94D`, `--sw-sky #6CC6FF`, `--sw-ink #3A1F4D`,
  `--sw-cream #FFF8FC`, `--sw-white #FFFFFF`, `--sw-shadow rgba(58,31,77,.25)`.
  The game is a single deliberate visual world (no dark theme); body background is set
  explicitly.
- Icons: blocks use their texture tile; furniture/food/pets use rendered 3D thumbnails
  (`game.thumbs`); UI buttons use inline SVG icons from `src/ui/icons.js`. No emoji as UI icons.

---

## 2. Technical architecture

- **Three.js 0.186.1** (npm), plain JavaScript ES modules, no framework, no TypeScript.
- Bundled by **esbuild** (`tools/build.mjs`) into ONE self-contained file
  `dist/sparkle-world.html` (JS + CSS inlined; only the Google Font is external and optional).
  It must work opened from `file://`, from any static host, and as a claude.ai Artifact
  (sandboxed iframe: no `alert/confirm/prompt`, no `<a download>`, no `window.open`).
- `npm run dev` serves `index.html` + live bundle at http://localhost:8000.
- `npm run smoke` builds and runs `tools/smoke.mjs` (Playwright, headless Chromium with
  SwiftShader WebGL2) — loads the page, starts a world, fails on any console error / page error,
  saves screenshots to `.shots/`.
- WebGL2 required (DataArrayTexture for block textures).
- A debug handle `window.__game` is always exposed for automated play tests.

### Directory layout & ownership

```
sparkle-world/
  index.html              dev page
  tools/build.mjs         bundle → dist/sparkle-world.html
  tools/smoke.mjs         headless smoke/play test
  src/main.js             boot: new Game(), install every module in order, start title screen
  src/core/               game.js events.js input.js audio.js storage.js util.js noise.js
                          thumbs.js (offscreen 3D thumbnail renderer)
                          registry.js (BlockRegistry, ItemRegistry, Bag tab list)
                          models.js (shared box/cyl/ball/mat/canvasTexture helpers)
  src/world/              world.js blocks.js textures.js mesher.js light.js chunks.js
                          raycast.js physics.js worldgen.js material.js (block shader)
  src/player/             player.js camera.js avatar.js wardrobe-data.js emotes.js
  src/things/             entities.js furniture.js furniture-models.js prefabs.js
                          pets.js garden.js cooking.js food-models.js
  src/life/               daynight.js weather.js particles.js collectibles.js stickers.js
  src/ui/                 theme.js icons.js ui.js hud.js menus.js inventory.js dressup.js
                          touch.js settings.js photo.js stickerbook.js dialogs.js
```

### Module contract

Every feature module exports `install(game)`; `src/main.js` calls them in a fixed order. A
module may register blocks, items, systems, panels, stickers and event listeners. It must not
reach into another feature module's internals — only through `game` APIs, registries and events.

```js
// src/main.js (order matters: registries before world load)
import { Game } from './core/game.js';
const game = new Game(document.getElementById('app'));
for (const m of [theme, ui, blocks, worldgen, avatar, player, emotes, entities, furniture,
                 prefabs, pets, garden, cooking, daynight, weather, particles, collectibles,
                 stickers, hud, inventory, dressup, touch, settings, photo, stickerbook, menus])
  m.install(game);
game.start();   // builds texture atlas, loads the profile, opens title screen
```
`icons.js`, `dialogs.js`, `furniture-models.js`, `food-models.js`, `registry.js`, `models.js`
and `material.js` are helper modules imported by others (not in the install list). Blocks,
tiles, items and biomes must be registered during `install` (the texture atlas is built once
in `game.start()`).

### `Game` (src/core/game.js)

```js
class Game {
  // three.js
  renderer; scene; camera;          // PerspectiveCamera, fov 70
  // services
  events;        // Emitter: on(name, fn) -> off(), once, emit(name, payload)
  input;         // Input (below)
  audio;         // Audio (below)
  store;         // SaveStore (below)
  ui;            // UI root helper (below)
  thumbs;        // Thumbs: thumbs.get(key, buildObject3D) -> Promise<dataURL> (cached)
  registry;      // { blocks: BlockRegistry, items: ItemRegistry, stickers: Map, recipes: Map,
                 //   prefabs: Map, pets: Map, biomes: Map }
  // state
  profile;       // persistent profile object (see Save formats); game.saveProfile()
  world;         // World | null  (null on title screen)
  player;        // Player | null
  mode;          // 'title' | 'play'
  paused;        // true while a modal panel is open (gameplay input ignored)
  time;          // { t: seconds since world start, dayTime: 0..1 (0.25 = sunrise, 0.5 = noon,
                 //   0.75 = sunset), day: int }
  selectedTool;  // 'build' | 'remove' | 'hand'
  hotbar;        // { slots: Array(9) of itemKey|null, index: 0..8 }
  target;        // current pick result or null (see Picking)

  addSystem(sys);        // sys = { name, update?(dt), onWorldLoad?(world, save), onWorldUnload?(),
                         //         serialize?() -> json, deserialize?(json) }  (per-world data)
  getSystem(name);
  newWorld({ name, biome, size, seed }) -> Promise<void>   // generate + enter
  loadWorld(id) -> Promise<void>
  saveWorld({ thumbnail = true } = {}) -> Promise<void>     // also autosaves every 45 s
  exitToTitle() -> Promise<void>                            // saves first
  pickables;     // Set of { object3d, kind: 'entity'|'pet'|'other', ref, onUse(game, hit),
                 //          hint(game) -> string|null, box?: THREE.Box3 (world-space) }
  pick(ndc?, { liquids?, reuse? }) -> PickResult|null      // from screen center / pointer
  useTarget()        // performs current tool on game.target
  interact(hit)      // Hand tool
  toast(text, { icon, color, big, duration } = {})   // shortcut to ui.toast
  celebrate(position, kind='sparkle')       // shortcut: particles + sound
  award(stickerId)   // shortcut to stickers system
  undo()             // pops game.history (array of { undo(), redo() }), max 20; afterwards
                     // steps the player out of anything that was put back around her
  pushHistory(entry)
  beginHistoryGroup(); endHistoryGroup()    // everything pushed in between = ONE Undo (nests)
  historyGroup(fn)   // same, around fn(); use for multi-step actions (strokes, prefabs...)
}
```

Game loop: `requestAnimationFrame`; `dt` clamped to 0.05 s. Order per frame: input → (play
mode) advance `game.time` → player → systems (registration order) → camera rig → target pick
+ hint → chunk rebuilds (time-sliced, ≤ 6 ms per frame; 40 ms while the loading screen shows)
→ queued thumbnails → render. When the tab is hidden, loop pauses and a save is triggered.
System `update(dt)` runs every frame in every mode (check `game.world`); on world load each
system gets `onWorldLoad(world, save)` and then `deserialize(save.systems[name])` if present.
See §3 for the full as-built API.

### Events (payload shapes)
```
'world:load'        { world, save }          'world:unload'   {}
'world:created'     { world }                'world:saved'    { id, persistent }
'block:place'       { x, y, z, id, prev }    'block:remove'   { x, y, z, id }
'entity:place'      { entity }               'entity:remove'  { entity }
'entity:use'        { entity, action }       // action: 'sit'|'sleep'|'door'|'lamp'|'piano'|...
'player:sleep'      {}                       'time:morning'   { day }
'player:sit'        { entity }               'player:stand'   {}
'player:swim'       {}                       'player:fly'     { flying }
'avatar:changed'    { look }                 'outfit:changed' { look }
'pet:adopt'         { pet }                  'pet:pet'        { pet }    'pet:feed' { pet, food }
'pet:ride'          { pet }
'cook:done'         { recipe }               'food:eat'       { food }
'garden:plant'      { plant }                'garden:harvest' { plant, crop }
'gem:collect'       { count, total }         'photo:taken'    {}
'piano:note'        { note }                 'prefab:place'   { prefab }
'sticker:earned'    { sticker }              'ui:open' { panel }  'ui:close' { panel }
'tool:change'       { tool }                 'hotbar:change'  { index, key }
'time:night'        {}                       'weather:change' { weather }
'emote'             { name }
'game:ready'        {}                       'profile:changed' { profile }
'history:change'    { size }                 'thumbnail:before' {}  'thumbnail:after' {}
```
`block:place` / `block:remove` payloads also carry `key` (block key). `world.set(..., {record:
false})` (worldgen, undo, prefabs) emits nothing.

### Blocks (src/world/blocks.js, registry in core)
```js
game.registry.blocks.register({
  key: 'planks_pink',            // stable string id used in saves and prefabs
  name: 'Pink Planks',
  category: 'building',          // bag tab: nature|building|colors|candy|glass|lights|garden|fun
  tiles: { all } | { top, side, bottom } | { top, sides, bottom, front },  // tile keys
  solid: true,                   // collides
  shape: 'cube' | 'cross' | 'slab' | 'carpet' | 'liquid',   // cross = flower sprite
  transparent: false,            // cutout alpha (leaves, glass, flowers)
  translucent: false,            // blended (water, stained glass, ice)
  light: 0,                      // emitted block light 0..15
  tint: null,                    // optional rgb multiplier
  onUse: null,                   // optional (game, hit) => bool, Hand tool on this block
  hidden: false                  // not shown in the Bag (e.g. crops, farmland variants)
});
game.registry.blocks.tile(key, painter)   // painter(ctx, rand) paints a 16×16 tile
game.registry.blocks.byKey(key) -> def with numeric `id`; byId(id)
```
Numeric ids are assigned at registration (0 = air). Saves store a `palette` (id → key) so ids
may change between versions. Up to 255 block types (Uint8).
Extra def fields: `replaceable` (default true for air, liquids and `cross` sprites: blocks and
furniture placed there replace it), `lightOpacity` 0..15 (default 15 opaque cube, 1
translucent, 0 otherwise; leaves use 1), `sound` (audio name, default 'place'), `hint`
(Hand-tool text when `onUse` is set). `blocks.tile(key, painter, { animated })` — animated
tiles (water) get the shader's gentle wobble. `blocks.idOf(key)` → id or −1,
`blocks.iconFor(key)` → Promise<isometric PNG dataURL>, `blocks.props` (after start) holds
typed lookup arrays by id (`shape pass opaque solid emit opacity replaceable selectable
faceLayer`). Painter helpers are exported from `src/world/blocks.js`: `px rect speckle voronoi
paintWool paintPlanks`.
Core ships: grass dirt stone cobble sand water snow ice log_oak leaves_oak leaves_cherry
flower_rose flower_daisy flower_tulip grass_tall planks_oak planks_pink planks_white slab_oak
glass glass_pink wool_{pink,white,purple,sky,yellow,lime,red} carpet_pink carpet_white
lamp_block (`slab_oak` is an extra, non-canonical key).

Core ships the ~20 essential blocks (air, grass, dirt, stone, sand, water, wood logs, leaves,
planks, glass, a few colors). `src/world/blocks.js` (Blocks & Worldgen owner) grows the full
library to 120+ blocks. Canonical keys other modules may rely on:
`grass dirt stone cobble sand water snow ice log_oak leaves_oak leaves_cherry log_birch
planks_oak planks_pink planks_white planks_lavender planks_mint glass glass_pink glass_heart
wool_<color> (red orange yellow lime green cyan sky blue purple magenta pink white lightgray
gray black brown) brick_red brick_pink brick_white quartz marble frosting_pink frosting_white
cookie chocolate candy_cane gumdrop_<color> cotton_candy lollipop_block moss mushroom_glow
crystal_pink crystal_blue lamp_block lantern sea_lantern farmland flower_rose flower_tulip
flower_daisy flower_sunflower flower_lavender flower_poppy grass_tall cloud rainbow shell
coral palm_log palm_leaves pine_leaves snow_leaves carpet_<color> wallpaper_hearts
wallpaper_stars wallpaper_stripes wallpaper_flowers tile_kitchen tile_bath roof_red
roof_blue roof_pink hay`.

### Items (hotbar/Bag entries — registry in core)
```js
game.registry.items.register({
  key: 'furn:bed_canopy',        // blocks are auto-registered as 'block:<key>'
  name: 'Princess Bed',
  category: 'bedroom',           // Bag tab id
  icon: (color?) => Promise<dataURL>, // blocks: tile image; others: game.thumbs; with
                                 // colors, icon(color) pictures that color (Bag color picker)
  colors: ['#FFB6D9', ...] | null, // optional variant swatches (furniture)
  use(game, hit, opts) -> bool   // called by Build tool; opts.color = chosen swatch
});
```
Bag tabs (ids): `nature building colors candy glass lights bedroom living kitchen bathroom
garden fun pets food houses` (labels in `ITEM_CATEGORIES`, `src/core/registry.js`).
Items may also set `kind` ('block' | 'furniture' | 'other'), `hidden`, and blocks/furniture
set `block` / `furniture` keys. `items.get(key)`, `items.byCategory(tab)`,
`items.iconFor(key, color?)` → Promise<dataURL> (cached per color, never rejects). `use` returns true when it did
something (false plays a soft "nope" click).

### World (src/world/world.js)
- Size `{ x: 144|208, y: 64, z: 144|208 }` (Cozy/Big), chunk 16×64×16.
- `world.get(x,y,z)`, `world.set(x,y,z,id, {record=true})` (marks chunk + neighbours dirty,
  updates light, emits events when record), `world.heightAt(x,z)`, `world.inBounds`.
- `world.blocks` Uint8Array, index `(y * sz + z) * sx + x`.
- Serialization: RLE → base64, plus `palette`.
- Water is static (no flow). Out-of-bounds reads return air above y=0 ground; the world edge has
  an invisible wall and the ocean/fog hides it.
- Also: `world.setKey(x,y,z,key)`, `world.defAt`, `world.surfaceAt(x,z)` (highest non-air),
  `heightAt` = highest *solid* block (−1 if none), `getSky/getBlockLight`,
  `world.batch(fn)` (many `set`s, one relight over the touched columns — use for prefabs),
  `world.meta` `{ id, name, biome, seed, createdAt, sizeName, spawn }`, `world.waterLevel`,
  `world.outside` `{ block, surface }` (the flat horizon ring drawn around the world; set by
  the biome's `generate`).

### Rendering & light
- `light.js`: two 4-bit channels per voxel: **sky** (flood from open sky, −1 per step,
  straight down no loss) and **block** (flood from emitting blocks and from entity light
  sources registered via `world.addLightSource(x,y,z,level)`). Incremental relight on edits,
  bounded to the affected region.
- `mesher.js`: per chunk builds three BufferGeometries — **opaque**, **cutout** (alphaTest), and
  **translucent** (blended, depthWrite false, sorted by chunk distance). Attributes: `position`,
  `uv`, `layer` (texture array layer), `shade` (AO × face shade), `light` (vec2 sky/block).
  Face culling against neighbours (cross-chunk). `cross` shapes are two diagonal quads.
- One `ShaderMaterial` (GLSL3, `sampler2DArray`) with uniforms `uDaylight` (0.4 night ..1 day,
  set by daynight), `uSkyColor`, `uBlockLightColor` (warm), `uFogColor`, `uFogNear/Far`, `uTime`
  (water wobble). Final light = max(sky × daylight, block × warm) with an ambient floor so
  interiors are never pitch black (`uAmbient` 0.22 at night .. 0.6 by day). Extra uniform:
  `uOpacity`. Fog is pushed out while the camera is high above the ground (flying), so the
  island stays clear from above.
  Uniform colors are raw sRGB (the shader writes without output conversion). `layer` ≥ 1024
  marks an animated tile. Material variants: opaque, cutout (`CUTOUT`, DoubleSide), translucent
  (`TRANSLUCENT`, blended, no depth write) share `game.blockUniforms`.
- Furniture/avatars use `MeshLambertMaterial` lit by `game.lights.hemi/sun` (driven by
  daynight) and a pool of 4 warm PointLights (range 10, decay 1, intensity ≈ 4.9 at night,
  ≈ 1 by day) that entities.js puts at the lamp of the lit furniture nearest the camera
  (constant light count: no shader recompiles).
- The horizon ring (`world.outside`) for an ocean is drawn like in-world water: translucent,
  over a seabed ring at the depth, block and sky light of the world's own edge; the mesher
  treats out-of-bounds cells below the ocean surface as that water (no water walls at the
  edge).
- `textures.js` builds a `DataArrayTexture` (16×16 per layer, mipmaps on, nearest-mipmap-linear)
  from all registered tile painters, deterministic via seeded RNG.

### Picking (`game.pick()`)
Ray from camera through pointer (touch/mouse) or screen center (keyboard play), max 8 blocks
from the player. Tests voxels (DDA) and `game.pickables` (Box3/ray), returns the nearest.
Liquids are hit only with `{ liquids: true }` — the default while the Remove tool is selected
(and for right-click remove), so water can be erased while Build aims through it. The frame
loop's own target pick uses `{ reuse: true }`: `game.target` is a scratch object overwritten
every frame (copy what you need to keep). `raycastVoxels(..., accept, out)` also fills a
reusable `makeVoxelHit()` object.
```js
{ type: 'block', x, y, z, id, key, face: [nx,ny,nz], point: Vector3, place: [x,y,z], distance }
{ type: 'pickable', pickable, point: Vector3, distance, face, place }
```
Pickables may also define `onRemove(game, hit)` (Remove tool), `onBuild(game, hit, item,
opts) -> bool` (Build tool; return true if handled, else the item is placed at `hit.place`)
and `hint(game, hit)`. Reach is `game.reach` (8) from the player's head.

### Player (src/player/player.js)
- Capsule-ish AABB 0.6 × 1.7 × 0.6. Walk 4.3 m/s, run (Shift / joystick push) 6.5, jump
  velocity so it clears 1.25 blocks, gravity 24. **Auto-jump** up 1-block ledges when walking
  into them (kid-friendly). Swimming in water (slow, buoyant, Space rises). Flying toggle (Fly
  button / double-tap Space): Space up, Shift/C down.
- Collides with voxels and with `game.colliders` (Set of world-space Box3 provided by entities).
- `player.avatar` (from `createAvatar`), `player.state` = 'walk'|'sit'|'sleep'|'swim'|'fly'|
  'ride'|'emote'. `player.sitOn(entity, seatPos, yaw)`, `player.sleepIn(entity, pos, yaw)`,
  `player.stand()`, `player.mount(pet)`, `player.teleport(x,y,z)`, `player.position`,
  `player.yaw`.
- Camera (camera.js): third person by default, **over the shoulder**: the orbit pivot sits
  0.75 to the camera's right of the head (less on portrait phones, 0 in bed) and 0.3 above it,
  so the avatar stands left of centre and the screen-centre target is not hidden behind her
  (distance 4.5, orbit with drag/right side touch, wheel/pinch zoom 2–9, collision pull-in;
  the pivot also pulls in beside walls). The avatar is hidden when the camera is within 1.15
  of her head. First person toggle (V key / Settings). Camera never clips into blocks. `game.cameraRig` = `{ yaw, pitch, distance, mode, setMode(m),
  toggleMode(), snap() }`; yaw 0 looks toward +Z. Movement is camera-relative. Portrait
  screens widen the vertical fov (70° + (1 − aspect)·40°).
- Player extras: `setFlying(on)`, `toggleFly()`, `emote(name)`, `findStandSpot(x,y,z,entity)`,
  `overlapsCell(x,y,z)`, `serialize()` (saves a standing spot when sitting/sleeping),
  `seatEntity`, `mountPet`. Riding: `mount(pet)` puts the player on `pet.object3d` (or
  `pet.group`) at `pet.seatHeight` (default 0.9) every frame; the pets module moves the pet and
  reads `game.input` while `player.state === 'ride'`. `game.createPlayer(saved)` (set by
  player.js) builds the player and `game.cameraRig`.

### Avatar (src/player/avatar.js)
```js
createAvatar(look) -> {
  group,                 // THREE.Group, origin at feet, ~1.75 units tall, model faces +Z
                         // (player sets group.rotation.y = yaw; yaw 0 looks toward +Z)
  setLook(look),
  update(dt, { speed, onGround, swimming, flying, sitting, sleeping, riding }),
  playEmote(name),       // 'wave'|'dance'|'twirl'|'cartwheel'|'jump'|'heart'|'sit'
  dispose()
}
```
Blocky "chibi" proportions (big head, big sparkly eyes, blush), clothes are canvas textures on
body/arm/leg boxes plus extra geometry for skirts, dresses, hair styles, wings, hats.
Poses: when `sitting` the group origin is the seat surface (hips rest there); when `sleeping`
the origin is the mattress-top centre and the body lies along local Z, head toward −Z.
`playEmote` returns its duration in seconds; `avatar.look` is the normalized look.
avatar.js sets `game.createAvatar` and `game.defaultLook`. wardrobe-data.js exports the option
lists as `[{ key, name }]` plus `normalizeLook(look)` and `randomLook(rand, name)`.

`look` schema (defaults in `src/player/wardrobe-data.js`, persisted in profile):
```js
{
  name: 'Lily',
  skin: '#F6D2B8',
  hair:  { style: 'long', color: '#7A4A2A', color2: null },
  eyes:  { color: '#5A3A28', lashes: true },
  face:  { blush: true, freckles: false, smile: 'happy' },
  top:    { type: 'tshirt', color: '#FF8CC6', pattern: 'hearts', patternColor: '#FFFFFF' },
  bottom: { type: 'skirt',  color: '#8E7CFF', pattern: 'none', patternColor: '#FFFFFF' },
  dress:  null,            // or { type, color, pattern, patternColor } — replaces top+bottom
  shoes:  { type: 'sneakers', color: '#FFFFFF' },
  acc: { head: 'bow', headColor: '#FF5FA2', face: 'none', back: 'none', backColor: '#B8E1FF',
         neck: 'none', neckColor: '#FFD700', hand: 'none' }
}
```
Hair styles: long, ponytail, pigtails, bun, space_buns, braids, curly, bob, short, side_pony,
wavy_long, pixie. Tops: tshirt, tank, hoodie, sweater, blouse, crop, jacket, sparkle_top.
Bottoms: skirt, tutu, jeans, leggings, shorts, overalls, pleated. Dresses: sundress, party,
princess, ballgown, overall_dress, mermaid. Shoes: sneakers, boots, sandals, sparkle,
rainboots, ballet, roller_skates. Head: none, bow, tiara, crown, flower_crown, cat_ears,
bunny_ears, unicorn_horn, beanie, sun_hat, headband, witch_hat(sparkly, friendly), halo.
Face: none, glasses, sunglasses, heart_glasses, star_glasses. Back: none, fairy_wings,
butterfly_wings, angel_wings, backpack, cape, mermaid_tail? (no). Neck: none, necklace,
pearls, scarf, bowtie. Hand: none, wand, purse, balloon, teddy, ice_cream.

### Entities & furniture (src/things/entities.js, furniture.js, furniture-models.js)
```js
game.registry.furniture   // Map key -> def, created by entities.js
def = {
  key: 'bed_canopy', name: 'Princess Bed', category: 'bedroom',
  size: [w, h, d],               // grid cells occupied (before rotation)
  colors: [...],                 // swatches; model uses chosen color
  build(color, data) -> THREE.Group   // origin at footprint min corner center-bottom rules in code
  colliders: 'full' | 'none' | [ [minx,miny,minz,maxx,maxy,maxz], ... ]  // local units
  light: 0..15,                  // when on
  actions: ['sleep'] | ['sit'] | ['door'] | ['lamp'] | ['piano'] | ['tv'] | ['cook'] |
           ['wardrobe'] | ['bath'] | ['sink'] | ['swing'] | ['read'] | ['feed'] ...,
  seat?: [x,y,z], sleepPos?: [x,y,z],
  placeOn?: 'floor' | 'wall' | 'ceiling' | 'table',
  surface?: number               // height of a top that 'table' items stand on (model units)
}
game.entities.place(key, x, y, z, rot, color, data) -> entity   // rot 0..3 (90° steps)
game.entities.remove(entity)
game.entities.at(x,y,z) -> entity|null
game.entities.all()
entity = { uid, key, x, y, z, rot, color, data, object3d, def }
```
Entities occupy grid cells (blocks cannot be placed into occupied cells), register colliders,
pickables, light sources, and are saved in the world save via the `entities` system.
As built:
- Register with `game.entities.define(def)` (adds to `game.registry.furniture` and registers
  the Bag item `furn:<key>` with a `game.thumbs` icon). Extra def fields: `lightPos`
  (model units), `defaultData`, `update(entity, dt, game)`.
- Model convention: `build(color, data)` returns a Group in block units spanning
  [0,w]×[0,h]×[0,d] (origin = footprint min corner), front facing +Z.
- Anchor: the tapped cell is the front-row middle cell; the footprint extends away from the
  front. rot 0..3 turns the front to +Z, +X, −Z, −X; Build-tool placement turns the front toward
  the player (wall items: out of the wall) and tries other turns if it does not fit.
  Furniture may share its bottom cell with a carpet (raised 1/16).
- Actions: `game.entities.registerAction(name, { run(game, entity, hit), hint?(game, entity) })`;
  Hand-tap runs `def.actions[0]` and emits `entity:use`. Core actions: `sit`, `sleep`, `lamp`.
- Also: `place(key,x,y,z,rot,color,data,{history,events,fx,uid,force})`, `rotate(entity)`,
  `setData(entity, patch)` (rebuilds model + light), `refresh(entity)`, `placeFromHit(key, hit,
  color)`, `canPlace`, `footprint`, `localToWorld(entity, lx, ly, lz)`, `byUid(uid)`.
  entity adds `cells, colliders, pickable, lightCell, yOffset, frontCell()`.
- Build tool on a placed piece with the same item selected rotates it; Remove tool removes it.
- `placeOn` (as built):
  - `'floor'` (default) stands in the tapped cell.
  - `'wall'` tapped on a wall's side faces out of it (on a floor it stands like a floor item).
  - `'ceiling'` hangs in the cell under a solid block: tap the underside of a block, or the
    floor below a ceiling (looks up to 8 cells). No ceiling → "Hang it under a ceiling!".
    Build the model hanging from the top of its [0,h] box.
  - `'table'` stands on top of furniture that declares `surface` (e.g. `table_round` 0.82):
    it takes the cell above and `yOffset = surface − 1`, recorded as `entity.restsOn` (uid).
    Elsewhere it stands on the floor. Removing the table removes what stands on it (one Undo
    brings both back); saves load tables first.
  Helpers: `entities.surfaceBelow(x,y,z)`, `entities.itemsOnTop(entity)`. entity also has
  `lightPoint` (world [x,y,z] of its light).

Canonical furniture keys (prefabs and other modules may reference these):
Bedroom: `bed_single bed_double bed_canopy bed_bunk bed_heart bed_cloud crib pet_bed
wardrobe dresser vanity nightstand toy_chest bookshelf desk mirror`
Living: `sofa armchair beanbag coffee_table tv fireplace piano rug_round rug_heart
floor_lamp table_lamp plant_pot picture_frame clock bookshelf_tall`
Kitchen: `stove oven fridge counter sink_kitchen table_round table_long chair stool
cake_stand fruit_bowl`
Bathroom: `bathtub shower toilet sink_bath towel_rack bath_mat`
Doors & structure: `door door_pink door_glass window_frame stairs fence gate ladder`
Lights: `lamp_ceiling fairy_lights lantern_post candle`
Garden & fun: `swing slide trampoline bench mailbox well fountain pool_float picnic_blanket
bird_house flower_box tree_house_ladder easel dollhouse teddy_bear balloon_bunch`

### Magic Houses (src/things/prefabs.js)
`game.registry.prefabs.set(key, { name, icon, size:[x,y,z], build(api) })` where
`api.block(x,y,z,key)`, `api.fill(x0,y0,z0,x1,y1,z1,key)`, `api.furn(key, x,y,z, rot, color)`
use prefab-local coordinates; placement clears the area, levels a foundation, and is undoable
as one history entry. Prefabs: cottage, princess_castle, treehouse, candy_house, beach_hut,
igloo, bakery, pet_shop, modern_house, barn.

### Pets, garden, cooking
- `pets.js`: species registry (puppy, kitty, bunny, pony, unicorn, panda, duckling) with
  blocky models, idle/walk/sit/sleep animations, follow AI (pathing = simple steering + hop up
  1 block, teleport to player if > 24 away), name tag above head, hearts on pet, ride for
  pony/unicorn. Pets saved per world.
- `garden.js`: plant entities on farmland (Build tool with a seed turns grass/dirt into
  farmland and plants), watering can tool, growth stages driven by `game.time`, harvest with
  Hand. Crops drop food items into `profile.basket`.
- `cooking.js`: recipes registry, Cooking panel (ingredient tapping mini-game), food models,
  basket (inventory of food with counts, stored in profile), eat / feed / place-on-table.

### Environment (src/life)
- `daynight.js`: sky dome gradient shader, sun + moon sprites, stars (points, twinkle), clouds
  (voxel-ish flat cloud layer drifting), sets `uDaylight`, fog color, ambient; emits
  `time:morning` / `time:night`. `game.time.dayLength` = 720 s. Settings can freeze time.
  The core advances `game.time` each play frame (`t` always, `dayTime` unless
  `settings.timeFrozen`); daynight detects clock crossings (0.25 / 0.78) and emits the events.
  `game.setDayTime(v)` and `game.skipToMorning()` move the clock; a night slept through with
  `skipToMorning()` is quiet (it sets `game.time.quietNight`): `time:morning` fires,
  `time:night` does not. Biomes may give
  `sky: { top, horizon }` day colors.
- `weather.js`: sunny, cloudy, rain, snow, rainbow (big arc in sky + sparkles).
- `particles.js`: `game.particles.emit(kind, position, opts)`; kinds: sparkle, heart, star,
  bubble, splash, zzz, note, leaf, petal, confetti, rainbow_trail, smoke_puff. Ambient spawners:
  butterflies by day, fireflies at night near flowers, petals under cherry trees.
- `collectibles.js`: gems (5 colors) placed by worldgen seeds; spin + glow; collect by touch.
- `stickers.js`: sticker registry, progress counters in `profile.stats`, awards toast + book.

### UI (src/ui)
`game.ui`:
```js
ui.root                // HTMLElement overlay (pointer-events managed)
ui.addStyles(css)      // inject a <style>
ui.toast(text, opts)   // bouncy toast, queued
ui.hint(text|null, at?)  // context bubble just below `at` {x,y} (CSS px; the game passes the
                         // projected target point), else below the screen centre
ui.registerPanel(name, { build(container, game), onOpen?(args), onClose?(), fullscreen? })
ui.open(name, args) / ui.close() / ui.isOpen(name)   // one modal panel at a time, sets game.paused
ui.button({ icon, label, onClick, variant })          // consistent chunky button element
ui.confirm({ title, text, yes, no, signal? }) -> Promise<bool> // in-page confirm (dialogs.js)
ui.textInput({ title, value, placeholder, suggestions, signal? }) -> Promise<string|null>
// dialogs: Enter activates the focused button (confirm focuses "No"), or submits the text
// field; Esc / tapping outside cancels; an aborted AbortSignal closes them as cancelled
// as built, also:
ui.el(tag, cls, text); ui.icon(name) -> svg string; ui.hasPanel(name); ui.toggle(name);
ui.back()      // Close/Esc: opens def.back(game) if it returns a panel name, else closes
ui.closeAll(); ui.setTitle(name, text); ui.current; ui.dialogOpen; ui.hudLayer
ui.loading(text, progress)   // loading card; loading(null) hides, undefined text keeps it
ui.transition({ text, stars, hold }, midFn) -> Promise   // dreamy fade (used by sleep)
// registerPanel def extras: title, icon, width, closable (default true), back(game)
// button({ ..., size: 'big'|'small'|'icon', title, className })
```
Named actions: `game.registerAction(name, fn)` / `game.runAction(name)`. Core registers
`build remove hand undo bag menu fly camera`; keys P → `photo`, G → `emotes`; HUD Dress Up →
`dressup`, Stickers → `stickers` (buttons stay hidden until a module registers the action).
Panel names: `title newworld worlds dressup bag stickers settings pause cooking piano tv basket
pets adopt photo`.

### Input (src/core/input.js)
Unified: `input.move` {x,z} (−1..1; x +1 = right, z +1 = forward), `input.look` {dx,dy}
(pixels) consumed per frame, `input.zoom` (+ = out) and `input.turn` (−1..1, arrow keys)
consumed per frame, `input.jump`,
`input.down`, `input.run`, `input.pointer` {x,y} (normalized device coords of the last
tap/cursor, or null = screen center), `input.on('tap', fn)` (click/tap without drag),
`input.on('hold', fn)`, `input.on('key', fn)`. Mouse: left-click = use current tool; right-click
= remove (desktop shortcut); drag (either button, > 6 px) = look. Keys: WASD/arrows, Space,
Shift, 1–9, E (hand/interact), Q (remove), B (bag), F (fly), V (camera), P (photo),
G (emotes), Z (undo, also Ctrl+Z), Esc (menu / close panel). Touch: joystick (left 40% of
screen), look drag (right side), taps act at the tap point. Touches that start on the resting
joystick (its radius + 36 px) only steer; a quick (< 0.28 s), still (< 10 px) touch elsewhere
in the joystick zone still acts as a tap.
As built: ↑/↓ also move, ←/→ turn the camera; R = Build tool; E uses the target directly (or
switches to Hand). Hold still ≥ 0.42 s then drag = paint/erase a line (`hold` events with
`phase: 'start'|'move'|'end'`; `end` carries `dragged` and `cancelled`). A hold that never
dragged is a slow tap: the game runs a normal tap on release unless the hold painted.
`input.press('jump'|'down'|'run', bool)` for HUD buttons (a press shorter than a frame still
counts for one frame),
`input.touchMode` + `touchmode` event, `gesture` event (first user gesture unlocks audio).

### Audio (src/core/audio.js)
WebAudio, created on first user gesture. `audio.play(name, { volume, pitch })` synthesized
sounds: pop, place, remove, click, sparkle, chime, whoosh, splash, jump, step, eat, pet, bark,
meow, neigh, magic, success, page, camera, note:<midi>. `audio.music(on)` gentle generative
music-box loop (day theme, soft night theme). Volumes in `profile.settings`.

### Storage (src/core/storage.js)
`SaveStore` with two backends; every call is async and never throws to callers (errors are
logged and reported as `{ ok:false }`).
- **Local**: IndexedDB `sparkle-world` (stores `worlds`, `metas` (small list entries),
  `profile`), fallback `localStorage` (`sparkle-world:*` keys), fallback in-memory.
- **Cloud (claude.ai Artifact)**: when `window.claude?.use` exists, `await claude.use('db')` and
  `await claude.use('user')` (user id via `await user.id()`). Layout:
  `data/users/<uid>/profile` (profile doc), `.../profile/worlds/<worldId>` (meta + `parts` count),
  `.../profile/worldparts/<worldId>-<i>` (`{ data: <≤180000 chars> }`). Writes: parts first,
  then meta; one write at a time per doc; cloud writes throttled to ≥ 60 s apart except on
  exit/visibility change. Load picks the newest `updatedAt` between local and cloud.
  Doc bodies: profile `{ profile, updatedAt }`, world meta `{ id, name, biome, size,
  createdAt, updatedAt, thumbnail, parts }`, part `{ data }` (the save JSON split in
  ≤ 180000-char pieces). `store.init()` waits ≤ 1.5 s for the cloud; a later arrival fires
  `store.onCloudReady(fn)` (the game reloads a newer cloud profile on the title screen).
  `store.flush()` pushes pending cloud writes now; `store.backendName` e.g. 'indexedDB+cloud'.
- `store.listWorlds()`, `store.loadWorld(id)`, `store.saveWorld(save)`, `store.deleteWorld(id)`,
  `store.loadProfile()`, `store.saveProfile(profile)`, `store.exportWorld(id) -> string`,
  `store.importWorld(string)`.
- Write failures later in a session (quota, eviction, a broken database): that save falls
  through IndexedDB → localStorage → memory instead of being dropped. Reads merge every local
  backend that holds data (newest `updatedAt` wins; localStorage copies left by an earlier
  session are found at `init()`); a later successful primary write drops the older fallback
  copy. `saveWorld`/`saveProfile` resolve `{ ok, backend, persistent, error? }` —
  `persistent` is false when the data only lives in memory (no cloud). `store.persistent`
  says the same for the store as a whole (false in a sandboxed frame without storage or
  cloud). The game toasts "Oh no! This device can't save your world right now." on entering a
  world when not persistent and after a non-persistent save (at most every 4 minutes).
- Export: "Save to a file" in My Worlds uses `claude.use('downloads')` when present, else an
  `<a download>` blob link; Import uses a file input. *Not built yet (Menus team): only
  `store.exportWorld/importWorld` exist.*
- Publishing as a claude.ai Artifact: declare the capabilities `db` and `user` (cloud saves)
  and `downloads` (for "Save to a file" once it exists).

### Save formats
```js
// profile
{ v: 1, look, outfits: [look|null ×6], playerName, stickers: { id: timestampISO },
  stats: { blocksPlaced, petsPetted, notesPlayed, outfitChanges, recipesCooked: {..}, gems,
           worldsCreated, ... },
  basket: { foodKey: count }, settings: { music: 0.5, sfx: 0.8, camera: 'third',
  readAloud: false, timeFrozen: false, quality: 'auto' }, lastWorldId }
// world
{ v: 1, id, name, biome, seed, size: {x,y,z}, createdAt, updatedAt, palette: [keys],
  blocks: '<base64 RLE>', player: { x,y,z,yaw, flying }, time: { t, dayTime, day },
  systems: { entities: [...], pets: [...], garden: [...], collectibles: {...},
             weather: {...}, ... }, thumbnail: 'data:image/jpeg;base64,...' }
```
As built: `updatedAt` is epoch ms (profile too). RLE = per run: id byte + LEB128 length.
World saves also hold `sizeName` ('cozy'|'big'), `waterLevel`, `outside`, `spawn: [x,y,z]`
and `hotbar: { slots: [itemKey|null ×9], colors: [swatch|null ×9], index }` (the hotbar is
per world; `game.hotbar.colors` holds the chosen swatch per slot).
`entities` system data: `[{ uid, key, x, y, z, rot, color, data }]`.

### Performance budget
60 fps on a 2019 iPad / mid laptop: chunk meshing time-sliced (≤ 6 ms/frame), no per-frame
allocations in hot paths, ≤ 8 dynamic PointLights total (prefer baked block light), particle
pool (≤ 800), pets ≤ 12, render distance = whole world with fog. `quality: 'low'` halves pixel
ratio and particle counts.

### Testing
- `npm run smoke` must pass with zero console errors.
- Debug API on `window.__game`: `debug.newWorld(opts)`, `debug.place(key,x,y,z)`,
  `debug.teleport(x,y,z)`, `debug.setTime(dayTime)`, `debug.select(itemKey)`,
  `debug.useAt(x,y,z)` (simulate a Build-tool tap at a block), `debug.interact(entityUid)`,
  `debug.screenshot()`. Also: `loadWorld(id)`, `exitToTitle()`, `save()`,
  `getBlock(x,y,z)` → key, `heightAt(x,z)`, `entities()`, `info()` (mode, fps, draw calls,
  pending chunks, storage…), `waitIdle(ms)` → Promise<bool>. `place` accepts block keys and
  furniture keys (`furn:bed_single` or `bed_single`); `useAt(x,y,z, face=[0,1,0])`.
- `tools/smoke.mjs [--biome=meadow] [--shots-prefix=core] [--only=desktop|touch] [--headed]`.
  It exports `launch, openGame, attachErrorCollectors, waitForTitle, waitForPlay, waitIdle,
  startWorld, startWorldViaUI, shot, settle, finish, screenPoint` for team scenario scripts.
  Besides building, sleeping, saving and reloading it checks (through the real UI): a slow
  Hand press on a bed sleeps, a hold-drag stroke is one layer and one Undo, typing in the
  Rename dialog works, taps on the joystick never act, and no HUD button shows through the
  open Bag on a phone.

---

## 3. Core as built — extra shared APIs

The core added these on `Game` (feature modules may rely on them):

```js
game.lights            // { hemi: HemisphereLight, sun: DirectionalLight } (daynight drives them)
game.blockUniforms     // shared block shader uniforms; game.blockMaterials { opaque, cutout, translucent }
game.physics           // Physics (world + game.colliders): bodyBlocked(x,y,z,halfW,h), liquidAt, move(body, dt)
game.chunks            // ChunkRenderer: pending, update(budgetMs, camX, camZ), rebuild(chunk)
game.colliders         // Set<Box3>, world-space solid boxes from entities
game.entities / game.particles / game.stickers / game.cameraRig / game.createAvatar / game.createPlayer
game.loading           // true while the loading card meshes a world
game.reach             // 8
game.hotbar.colors     // chosen swatch per slot
game.setTool(tool); game.selectSlot(i); game.setSlot(i|null, itemKey, color); game.selectedItem()
game.placeBlock(x,y,z,key,{ history=true, fx=true }) -> bool    // undoable, sparkle + sound
game.removeBlock(x,y,z,{ history=true, fx=true }) -> bool       // refuses solid blocks at y = 0
game.placeBlockFromHit(hit, key, opts)   // what block items' use() calls
game.removeTarget(hit)                   // Remove tool (right-click on desktop)
game.setDayTime(v); game.skipToMorning()
game.saveProfile(immediate=false)        // debounced 400 ms
game.applySettings()                     // volumes, quality (pixel ratio), camera mode
game.captureThumbnail() -> jpeg dataURL  // 240×150; taken on world creation, exit and at
                                         // most every 5 min by autosave (it costs a render)
game.flushSave()                         // save now + push cloud writes (tab hidden / pagehide)
// WebGL context loss: three.js restores the context itself; the game saves at once and, if
// the picture has not returned after 2.5 s, offers "Wake up" (reload) in an in-page dialog.
game.registerAction(name, fn); game.runAction(name, ...args)
```

Shared helpers: `src/core/models.js` — `box(w,h,d,color|material,x,y,z)` (min-corner placed,
shared unit geometry), `cyl`, `ball`, `mat(color, { emissive, emissiveIntensity, opacity, side
})` (cached Lambert), `canvasTexture(w,h,paint)`, `disposeObject(root)` (skips
`userData.shared`). `src/core/util.js` — `mulberry32 hashString hash3 clamp lerp smoothstep
randInt pick angleDelta makeId hexToRgb rgbToHex mixHex shade jitter rgba hexToUnit nextFrame
sleep escapeHtml`. `src/core/noise.js` — `new Noise(seed)`: `n2 n3 fbm2 fbm3 ridge2`.
`thumbs.get(key, build, { dir, zoom })` renders with a small second WebGLRenderer.

Biome def (`game.registry.biomes.set(key, def)`): `{ key, name, description, iconBlock,
colors: [cssTop, cssBottom] (New World card), sky?: { top, horizon }, generate(world, rand,
noise), spawn?(world) -> [x,y,z] }`. `generate` writes `world.blocks` directly (helpers in
`src/world/worldgen.js`: `idOf put peek fillColumn growTree defaultSpawn`) and sets
`world.waterLevel` and `world.outside`. Light is computed after generation.

Particles: every kind in §2 exists in the core pool (simple sprites);
`particles.emit(kind, pos, { count, color, spread, scale })`.
Stickers: `game.registry.stickers` entries `{ id, name, hint, icon }`; `game.stickers.award(id)
/ has(id) / count()`. The core wires every sticker in §1 to its event (counters in
`profile.stats`); `gem_master` compares against `world.gemTotal` (set by collectibles).

Core-owned modules: everything in `src/core`, `src/world`, `player.js camera.js avatar.js
(placeholder) wardrobe-data.js`, `entities.js furniture.js furniture-models.js (starter set)`,
`daynight.js particles.js stickers.js (minimal)`, `theme.js icons.js ui.js dialogs.js hud.js
menus.js inventory.js (minimal Bag)`. Stubs that export `install(game) {}`: emotes, prefabs,
pets, garden, cooking, food-models, weather, collectibles, dressup, touch, settings, photo,
stickerbook.

---

## 4. Wave 2 — requests from the player (added 2026-09-26)

Straight from her: "change the avatar's hair style to different ones; buy candy and ice cream, all different
types; pets like dogs, cats, turtles and horses; zip lines and tree houses; really cool girls; really cool big
trailers you can camp in and do things on the inside, like a dream camper or a house."

1. **Hair styles** — already in the Dress-Up Studio (12+ styles). Add a **Hair Salon chair** furniture piece:
   sit in it and the Dress-Up Studio opens on the Hair tab.
2. **Candy & Ice Cream shops (buying things)**
   - Currency: **Sparkle Coins**, stored in `profile.coins`, shown in the HUD. Earned generously: gems (+10),
     harvesting (+3), cooking (+5), first sticker unlocks (+20), petting a pet (first time each day +2), daily gift
     on first play each day (+25). New players start with 100. Never lose coins.
   - Shop counters (furniture): `candy_shop`, `ice_cream_parlor`, `ice_cream_truck`. Hand-tap opens a shop panel.
   - Candy (many kinds): lollipop, rainbow swirl lollipop, cotton candy (pink/blue), gummy bears, jelly beans,
     chocolate bar, candy cane, gumdrops, rock candy, taffy, candy apple, macarons, donuts (sprinkles), marshmallow,
     sour straws, bubblegum, caramel, heart chocolates.
   - Ice cream: flavors vanilla, chocolate, strawberry, mint chip, cookie dough, bubblegum, cotton candy, rainbow
     sherbet, mango, blueberry, birthday cake, unicorn; served as cone, cup, sundae, popsicle, milkshake, ice cream
     sandwich; toppings sprinkles, cherry, whipped cream, chocolate sauce, gummy bears. Build-your-own with a live
     3D preview.
   - Bought treats go into the basket: eat, share with pets/friends, place on tables, or **hold it in your hand**.
3. **More pets** — add **turtle** and **horse** (rideable, several coat colors) plus more dog and cat breeds.
4. **Zip lines** — place a start tower and an end tower (auto-links the nearest), a cable between them; Hand-tap
   the start to zip across with a whoosh (the avatar hangs from a handle). Works from treehouses.
5. **Tree houses** — more treehouse Magic Builds (big two-tree house with a rope bridge, fairy treehouse, lookout
   with a zip line) + treehouse parts (rope bridge, platform, ladder).
6. **Cool girls (friends)** — NPC friends who live in the world: stylish girls with names and cool outfits
   (built with `createAvatar` + curated looks), wander, wave, chat in speech bubbles, dance with you, follow you
   when invited, sit on sofas, sleep in beds at night, can be dressed up too. "Invite a friend" from the Bag.
7. **Big campers & camping** — Magic Builds: **Sparkle Camper** (big pink camper with bunk beds, kitchenette,
   sofa, bathroom, rooftop deck with slide and a pop-out pool), **Retro Mini Trailer**, **Camper Van**. Camping
   furniture: tent (sleep in it), campfire (roast marshmallows / s'mores), camping chairs, hammock, string lights,
   picnic table, cooler.
