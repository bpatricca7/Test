# Team "life": Pets, Garden & Cooking

What this team built, what other modules can rely on, and how to test it.
Owned files: `src/things/pets.js`, `src/things/garden.js`, `src/things/cooking.js`,
`src/things/food-models.js`, and everything under `src/things/pets/`, `src/things/garden/`,
`src/things/cooking/`. Probe: `node tools/probe-life.mjs [--only=desktop|touch]`.

No core files were changed.

## Shared kit (`src/things/pets/kit.js`)

- `Kit` bakes boxes / cylinders / balls into ONE vertex-colored `BufferGeometry`;
  `baked(key, draw)` caches it (marked `userData.shared`, so `disposeObject` skips it). Every
  pet part, plant stage and food model is one shared geometry + the shared `VC_MAT`
  (`MeshLambertMaterial({ vertexColors: true })`, lit by `game.lights`).
- Basket helpers: `basketCount(game, key)`, `basketAdd(game, key, n)`, `basketTake(game, key, n)`.
  They save the profile and emit **`basket:change` `{ basket, key, delta }`** (new event).
- `lifeHud(game)`: a small column of round HUD buttons (left side, under the world name pill):
  **Hop off** (only while riding), **Basket**, **Pets** (once you have a pet). Each button has
  `data-action="<name>"`. If the HUD team shows its own Basket / Pets button
  (`.sw-hud [data-action="basket"]` or `[aria-label="Basket"]`, same for Pets), ours hides.
- `pets/preview.js`: one extra small WebGL canvas (created on first use) for the live 3D
  previews in the adoption panel and the cooking result screen. Falls back to thumbnails.
- `pets/sfx.js`: `sfx(game, name)` synthesizes our sounds on the core audio context / sfx bus
  (`squeak peep quack mew purr yip unicorn plop stir ding sizzle whirr freeze tick pour till
  harvest crunch slurp tada boing nope`; core names pass through to `audio.play`).

## Pets (`game.pets`, system `'pets'`)

Species (`game.registry.pets`, key -> spec): `puppy kitty bunny pony unicorn panda duckling`,
4-5 color variants each (e.g. puppy golden/snowy/spotty/cocoa/candy, kitty
ginger/misty/calico/midnight/lilac, unicorn pearl/blossom/lilac/mint/starry with rainbow mane
and a softly glowing horn). Spec fields: `name, voice, treat, gait, trick, speed, halfW,
height, rideable, flies, swims, seat, variants[{ key, name, ... }]`.

- **Adopt**: Bag -> Pets tab -> item `pet:<species>` -> Build-tap the ground -> panel
  **`adopt`** (`ui.open('adopt', { species, spot: [x, y, z] })`): color variants with a live
  spinning preview, a name field with suggestions + dice, **Adopt!** -> confetti, hearts.
  Max **12** pets per world (`MAX_PETS`).
- **Hand-tap a pet**: pets it (hearts, voice, happy hop) and shows a bubble over it with
  **Ride** (pony / unicorn), **Feed** (a free species treat, or food from the basket),
  **Stay / Follow**, **Trick**. Build-tap with a food item selected feeds it. The Remove tool
  never removes pets (it tickles them).
- **Riding** (`player.mount(pet)` contract): the pet reads the same move input (camera
  relative), Space / Jump jumps; the unicorn flies gently while Jump is held (glides down when
  released, Shift / C dives) and leaves a rainbow ribbon trail. Hop off with the HUD button,
  E or X. A double-tap of Space while riding does not dismount (player's fly shortcut).
  `pet.object3d` / `pet.seatHeight` are set; we also sync the rider after moving the pet each
  frame (no one-frame lag).
- **AI**: follows in slots behind her (steering, hop up 1 block, swim/float, side-step when
  stuck, pop over when stuck > 5 s), teleports next to her when > 24 blocks away (or lost for a
  while, or she flies off), wanders / sits / lies down / does tricks when idle, looks at her.
  Modes: `follow`, `stay`, `home` (wanders around its home spot).
- **Pet beds**: at night each pet (not ponies/unicorns) claims the nearest free entity with
  key `pet_bed` (or any furniture def with `petBed: true`), walks there and sleeps curled up
  with floating Z's; wakes up in the morning. Where it lies: `def.petSpot || def.sleepPos ||
  [w/2, 0.14, d/2]` (model units). **Furniture team**: please give `pet_bed` a `petSpot`
  (cushion top). If `pet_bed` is not registered when pets installs, pets registers a fallback
  `pet_bed` (round cushion, colors) so the Bag always has one; furniture installs first, so
  after the merge the Furniture team's bed wins.
  Pets also curl up when she sleeps nearby, and when she stands still at night.
- Pets panel **`pets`** + action **`pets`**: list (thumbnail, name, species, mode) with Call,
  Stay/Follow, Name (rename dialog), Home, Feed, Bye (double confirm); an "Adopt a new friend"
  row puts `pet:<species>` into the hotbar.
- Events: `pet:adopt` `{ pet }`, `pet:pet` `{ pet }`, `pet:feed` `{ pet, food }` (food is a
  basket key or `'treat'`), `pet:ride` `{ pet }`. `pet.species`, `pet.name`, `pet.variant`,
  `pet.id` are always there.
- API: `game.pets.pets` (array), `adopt(species, variant, name, spot)`, `remove(pet)`,
  `petPet(pet)`, `feed(pet, key|'treat')`, `mount(pet)`, `dismount()`, `rider`, `call(pet)`,
  `setMode(pet, mode, { quiet })`, `sendHome(pet)`, `nearest(x, y, z, maxDist)`, `byId(id)`.
- Save (`systems.pets`): `[{ id, species, variant, name, mode, x, y, z, yaw, home, adoptedAt, love }]`.

## Garden (`game.garden`, system `'garden'`)

- Bag -> Garden tab: seed packets `seed:<crop>` for **rose tulip sunflower carrot strawberry
  pumpkin watermelon blueberry**, and `tool:watering_can`.
- Build-tap a seed on grass / dirt / farmland (or on a flower / tall grass standing on it):
  tills the block to `farmland` and plants (one Undo takes both back). Registers blocks
  `farmland` and `farmland_wet` **only if missing** (Blocks team's win after the merge).
- Watering can: Build-tap a plant or farmland: a little can pours (splashes), the 3x3 farmland
  around turns `farmland_wet` for 90 s of game time and plants there grow 1.9x faster. Rain
  (`game.weather.current === 'rain'`) waters plants under the open sky. Wet soil dries back.
- Growth: 4 stages (seeds with a little sign, sprout, growing, ready) over 120-170 s of
  `game.time.t` (dry); keeps growing while you are elsewhere in the world; a night's sleep adds
  90 s. Ready plants sparkle, bob, and say "Tap to harvest!".
- Hand-tap a ready plant: the crop flies to her and lands in `profile.basket`
  (carrot x2, strawberry x3, pumpkin, watermelon, blueberries x4); flowers become bouquets
  (`rose`, `tulip`, `sunflower` in the basket). Strawberry / blueberry bushes regrow; the rest
  leave the farmland ready for new seeds. Unpicked flowers just stay in bloom (decorative).
  Remove tool removes a plant (undoable). Plants hide while their soil is gone or something
  was built into their cell, and come back if it returns (undo).
- Events: `garden:plant` `{ plant }`, `garden:harvest` `{ plant, crop, count }`.
- Save (`systems.garden`): `{ v: 1, plants: [[crop, x, y, z, progress, wetSecondsLeft]], wet: [[x, y, z, secondsLeft]] }`.

## Cooking (`game.cooking`, `game.registry.recipes`)

- Recipes (`game.registry.recipes`, key -> `{ key, name, food, makes, method, station, steps }`):
  cupcake, cookies, pizza, pancakes, ice_cream, fruit_salad, birthday_cake, smoothie,
  carrot_soup, strawberry_pie, pumpkin_pie, watermelon_popsicle. Methods: bake (oven), fry /
  boil (stove), freeze (fridge), blend / mix (counter). Pantry basics (flour, milk, egg, sugar,
  butter, chocolate, cheese, tomato, sprinkles, banana, yogurt, honey, ice, cream, water,
  cinnamon) are unlimited; garden crops (carrot, strawberry, blueberry, pumpkin, watermelon)
  come from the basket and are used up.
- Panel **`cooking`**: `game.ui.open('cooking', { entity, station: 'stove'|'oven'|'fridge'|'counter' })`
  (or `game.cooking.open(station, entity)`). Recipe book (this station's recipes first; recipes
  missing garden crops show a "Grow" hint) -> tap the ingredients into the glass bowl in order
  (wrong ones wiggle; the next one glows after a pause) -> stir (draw circles or tap) -> Bake /
  Cook / Freeze / Blend / Toss with an animated appliance and timer -> ding -> the dish spins
  in 3D with confetti, goes into the basket; Eat! / Again / Recipes / Done. Emits
  `cook:done` `{ recipe }` (the recipe object; `recipe.key` is the recipe key).
  **Furniture team**: call it from stove / oven / fridge / counter / sink_kitchen, falling back
  to a toast if `!game.ui.hasPanel('cooking')`.
- Basket panel **`basket`** + action **`basket`**: food by group (Yummy Food, From the Garden,
  Flowers) with counts; Eat (she holds it up, three bites, sparkles, hearts, `food:eat`
  `{ food }`), Pet (feeds the nearest pet), Table (puts it in the hotbar: Build-tap a table).
  Flowers: Vase (on a table) / Smell.
- Bag -> Food tab: `food:<key>` items for food you own (name shows the count, hidden at 0),
  plus an always-there **Recipe Book** (`food:recipe_book`, opens the cooking panel anywhere).
  Bouquets appear in the Garden tab.
- Food on tables: entities `food_<key>` (`placeOn: 'table'`, `colliders: 'none'`, hidden Bag
  items). Placing one takes it out of the basket; the Remove tool (or removing the table) puts
  it back; Hand-tap eats it (flowers: smell). Needs a furniture def with `surface`
  (core `table_round` has 0.82).
- Food models: `foodModel(key)` / `foodIcon(game, key)` / `FOOD` / `INGREDIENTS` /
  `foodName(key, n)` in `src/things/food-models.js` (other teams may use them, e.g. a
  cake_stand or fruit_bowl could show `foodModel('birthday_cake')`).

## Stickers

Handled by the core sticker wiring through our events: `best_friends` (pet:adopt),
`pet_lover` (pet:pet x10), `unicorn_rider` (pet:ride with species unicorn), `little_chef` /
`master_chef` (cook:done, all 12 recipe keys), `green_thumb` (garden:harvest).

## Debug API (`window.__game.debug`)

- `debug.pets`: `list() adopt(species, variant, name, x?, y?, z?) pet(id) feed(id, key) ride(id)
  dismount() remove(id) setMode(id, mode)`
- `debug.garden`: `plants() grow(seconds) plant(crop, x, y, z) water(x, y, z) harvest(x, y, z)`
- `debug.cooking`: `give(key, n) basket() open(station) eat(key)`

## Probe coverage (`tools/probe-life.mjs`)

Desktop: adopts all 7 species through Bag + adoption panel (clicks), lineup of 12 pets with
variants, max-12 refusal, Hand-tap pet + bubble + feed, ride the unicorn (fly, rainbow trail,
double-Space, Hop off), follow walk, pond swim + climb out, pet bed at night + morning,
Pets panel, plant 4 seeds via Bag clicks (tilling), watering can, growth stages 0-3
(screenshots), harvest with Hand, regrowing bushes, cook cupcake (circle stir) and carrot soup
(tap stir, uses garden carrots) through the panel, eat from the basket, place food on a table,
Hand-eat it, Bag Food tab, save + reload persistence. Touch (iPad 1024x768): adopt a kitty,
pet + feed with taps, plant with a tap, Basket button, HUD under panels. Phone (390x844):
cook ice cream with taps and eat it from the result screen.
