# Team "shops": Candy & Ice Cream Shops and Sparkle Coins (wave 2)

DESIGN.md section 4, item 2. Straight from her: "we want to be able to buy candy and ice cream,
all different types".

Owned files: `src/things/shops/*` (new), `tools/probe-shops.mjs`, this file.
Probe: `node tools/probe-shops.mjs [--only=desktop|touch|gift]` (screenshots `.shots/shops-*.png`).
Changes outside the folder are small and additive; they are listed at the end.

## What she gets

- **Sparkle Coins** in a coins pill next to the gems pill. Every profile starts with **100**
  (new ones and older ones that have no coins yet). Coins are only ever spent in a shop, never
  lost.
- Bag -> **Shops** (a new tab after Camping) with three shops, each in six pastel colors:

| key | name | size | what it does |
|---|---|---|---|
| `candy_shop` | Candy Shop | 3x3x2 | A striped-awning stall with candy-cane posts, glass candy jars (gumballs, wrapped sweets, candy canes), a pot of lollipops, shelves of jars, a heart on the counter, and a "Candy Shop" sign between two giant lollipops. Hand-tap: the shop with **Coco**. |
| `ice_cream_parlor` | Ice Cream Parlor | 3x3x2 | A glass freezer counter with six tubs, a menu board, stacked cones, a scalloped awning, and a big cone sign. Hand-tap: **Gigi**'s build-your-own ice cream. |
| `ice_cream_truck` | Ice Cream Truck | 3x2 footprint, 3 tall | A pastel truck with wheels, headlights, polka dots, a serving window (treat pictures, tubs, bunting, a bell and a cone holder on the shelf), a flip-up awning, a rounded roof with bunting, an "Ice Cream" sign and a giant cone. Hand-tap: **Sunny**'s ice cream, with Favorites. |

Shops are furniture (`game.entities.define`, action `shop`, hint "Tap to buy candy!" /
"Tap for ice cream!"). Their static parts batch with the other furniture (furniture Kit); the
glass is the shared `sheer()` material and the signs are one shared picture per shop kind.
Colliders let her walk round a stall and behind its counter (the counter is 1.1 high, above the
auto-hop); the truck is solid.

## The shop panel (`'shop'`, `ui.open('shop', { kind: 'candy'|'parlor'|'truck', entity, view })`)

- **Shopkeeper row** (sticky at the top on tablets and desktop): a real avatar portrait of the
  shopkeeper, waving (a snapshot from the shared Dress-Up stage, `getStage().snapshot`), a speech
  bubble with short kind lines (greetings, hints for each step, "Ooh, great choice!", and how
  many more coins she needs when a treat is too dear), and her coin wallet. Lines are read aloud
  through `game.speak` when Read Aloud is on.
- **Candy Shop**: 20 candies as big picture cards with prices of 3 to 15 coins:
  lollipop, rainbow lollipop, pink and blue cotton candy, gummy bears, jelly beans, chocolate bar,
  candy cane, gumdrops, rock candy, taffy, candy apple, macarons, sprinkle donut, marshmallows,
  sour straws, bubblegum (a little gumball machine), caramels, heart chocolates (15), cake pop.
  A tap buys one. Cards show how many she has.
- **Ice cream (parlor and truck)**: tabs **Build Your Own** and **Favorites**.
  - Build Your Own: a live spinning 3D preview (the life team's `preview(game)` on the shared
    Dress-Up stage: no new WebGL context; drag to spin; it pops when something changes) with the
    treat's name, the price tag and **Buy!**, and three steps:
    1. **Style**: cone 3, cup 3, sundae 6, popsicle 4, milkshake 6, ice cream sandwich 5 (3D
       pictures, price chips);
    2. **Scoops**: up to three of 12 flavors, +3 each (vanilla, chocolate, strawberry, mint chip,
       cookie dough, bubblegum, cotton candy, rainbow sherbet, mango, blueberry, birthday cake,
       unicorn; each with its own bits: chips, swirls, sprinkles). Tap a flavor to add a scoop
       (a fourth swaps the top one); tap a scoop in the slots to take it off (one always stays).
       Popsicles, shakes and sandwiches use the flavors as colored layers;
    3. **Toppings**: sprinkles +1, cherry +1, whipped cream +2, chocolate sauce +2, gummy bears +2.
  - Favorites: Unicorn Dream (unicorn, cotton candy, bubblegum sundae with sprinkles, whipped
    cream and a cherry), Rainbow Cone, Choco Shake, Mango Pop.
- **Buying**: coins hop from the wallet to the treat, a toy cash-register ka-ching, confetti,
  and a sheet at the bottom: "<Treat> is in your basket!" with **Hold**, **Eat** and **More**.
  Not enough coins: a soft "uh-oh", the card wiggles, and the shopkeeper says how many more
  coins she needs and how to earn them. Nothing is spent.
- Events: `'shop:buy' { item, price, shop, name }` (`item` is the basket key). The first purchase
  earns the **Sweet Tooth** sticker (own art).

## Sparkle Coins (`coins.js`, `game.coins`)

| earned from | coins | event |
|---|---|---|
| a gem | +10 | `gem:collect` |
| a harvest | +3 | `garden:harvest` |
| cooking | +5 | `cook:done` |
| a new sticker | +20 | `sticker:earned` |
| the first pat of each pet each day | +2 | `pet:pet` (remembered in `profile.coinPets`) |
| the daily gift | +25 | first play of each day |

- **Multiplayer contract (MULTIPLAYER.md section 9.11)**: every earning listener starts with
  `if (game.net?.remoteApplying) return;` (feature-detected; `game.net` does not exist yet).
- Every gain flies into the HUD pill: a "+10" bubble and little gold coins burst from above
  her head (a harvest: from the plant; a pet: from the pet; a gift: from the box) and arc into
  the pill with a jingle and a tink per coin, and the pill **counts up** as they land. A
  sticker's coins wait until its "New sticker!" pop is up and fly out of the sticker.
- **Daily gift**: on entering a world, the first time each day (device date), once the world is
  clear (no panel, dialog, fade, sticker pop or first-time tips; a first-time player gets it
  after the tips or after 90 s of play), a pink polka-dot present drops in at the top ("DAILY
  GIFT, A present for you! Tap to open!"). A tap (or 4 s) opens it: the lid pops off, rays,
  +25 coins fly out. Automated test browsers (`navigator.webdriver`) only get it when asked
  (`debug.shops.gift()`), like the tutorial tips, so other teams' probes are never covered.
- API: `game.coins.value`, `.shown` (the pill's number while coins fly), `.add(n, reason,
  { at })`, `.spend(n, reason) -> bool`, `.canAfford(n)`, `.gift({ force })`.
- Events: `'coins:change' { coins, delta, reason }` (reasons `gem harvest cook sticker pet gift
  shop`), `'coins:shown' { shown }` (the HUD refreshes the pill on it).

## Treats in the food system (`treats.js`)

Every bought treat is a **basket food keyed `treat_*`** with `FOOD[key].kind = 'sweet'`:

- **Candies** (`candy.js`): fixed keys (`treat_lollipop`, `treat_rainbow_lollipop`, ...,
  `treat_cake_pop`) registered into `FOOD` at install **before the basket installs** (like the
  camping team's s'more), with their models baked as `'food:<key>'` in the pets kit cache. So
  the basket gives them table pieces (`food_treat_*`) and Bag Food items (`food:treat_*`), and
  `foodModel()`, `foodIcon()`, pets' snacks and friends' treats draw them.
- **Ice creams** (`icecream.js`): self-describing keys
  `treat_ic_<style>_<flavor>[-<flavor>[-<flavor>]]_<toppings|x>`, e.g.
  `treat_ic_sundae_straw-mint-uni_scwh` (toppings `s` sprinkles, `c` cherry, `w` whipped cream,
  `h` chocolate sauce, `g` gummy bears). `game.treats.ensureTreat(key)` registers one the first
  time it shows up (profile load, purchase, a table piece loading, the hotbar): a `FOOD` entry
  (`name` like "Mango Cone", "Triple Sundae", or a favorite's own name), its baked model and a
  Bag Food item. On tables they are one shared piece, **`food_treat_ic`**, whose `data.food` is
  the key (so a saved world never needs a new definition).
- The basket panel shows them first, under **Sweet Treats**, with **Eat**, **Hold**, **Pet**
  (feed the nearest pet) and **Table**. Friends' Treat bubble lists shop treats first (pals
  contract: `treat_` keys, `game.treats.model(key)` for the model in her hand).

### Holding a treat

- A treat selected in the hotbar is **in her right hand**. **Hold** (shop sheet, basket) puts
  it in a hotbar slot (the one already holding it, else an empty one, else the current one) and
  selects the Build tool, so a Build-tap on a pet feeds it, on a friend gives it, on a table puts
  it there. Selecting another slot puts it back in her pocket; running out empties her hand.
- While she holds one, the life HUD column shows **Eat** and **Put away** (Put away clears
  that slot; the treat stays in the basket).
- **Eat**: she lifts it to her mouth for three big bites (crunch, or slurp for ice cream,
  sparkles in the treat's color, the model shrinking), then hearts, a happy hum, "Yummy
  <treat>!" and heart hands; `'food:eat' { food }`. Eating from the basket or the shop sheet
  eats from her hand the same way. Asleep or swimming, it falls back to the basket's eating.
- The model is attached to the avatar's hand bone through the new avatar hook (below), kept
  upright, arm raised. Her hand accessory (wand star, teddy, purse, balloon) hides meanwhile.
  Hidden while she sleeps or swims.
- API: `game.treats = { ensureTreat, model(key), hold(key, { quiet }), putAway(), eat(key?),
  held, eating, isTreat, name, price, icon }`. `model(key)` returns a new Object3D posed for a
  hand (the caller disposes it; geometry and material are shared).

## Save data

- Profile: `coins`, `coinGiftDay` ('YYYY-MM-DD'), `coinPets` `{ day, ids: ['<worldId>:<petId>'] }`,
  `stats.coinsEarned`, `stats.treatsBought`, `basket.treat_*`.
- World: shops are entities (`candy_shop`, `ice_cream_parlor`, `ice_cream_truck`); treats on
  tables are `food_treat_<candy>` or `food_treat_ic` with `data.food`. The hotbar may hold
  `food:treat_*` items.

## Multiplayer notes (for the net team)

Coins, shops, the basket and stickers are per player (MULTIPLAYER.md section 7). Placing a
bought treat on a table is an ordinary `e+` (`food_treat_ic` carries the key in its data, so
every peer can build it). "Hold it in your hand" is not part of `look`: the held key is
`game.treats.held` (null or a `treat_*` key), ready for the optional presence field `hi`; a
remote avatar can show it with `avatar.hold(game.treats.model(key))`.

## Stickers

`sweet_tooth` "Sweet Tooth" (buy a treat at a shop), registered on `game:ready` with its own art
(a waffle cone with a cherry and a swirl lollipop), like the pals team's stickers.

## Debug (`window.__game.debug.shops`)

`coins() shown() earn(n) setCoins(n) gift(force) giftShowing() open(kind, view) state() buy(key
| spec) key(spec) price(key | spec) treats() hold(key) held() eating() eat(key) putAway()
candyKeys()`.

## Probe coverage (`tools/probe-shops.mjs`)

- **desktop** (1280x800, real clicks): 100 coins and the pill; a gem's coins flying and the pill
  counting to 110; cooking +5, harvest +3, new stickers +20, the First Block sticker; the first
  pat of a pet +2 and not the second; nothing while `game.net.remoteApplying`; no surprise gift
  for an automated browser, then the gift on request (+25, remembered for today); Bag -> Shops ->
  Candy Shop -> "Pick a color!" -> placed with a click in that color; Hand-tap -> Coco's panel
  (20 candies, her portrait, her bubble); buy a Rainbow Lollipop (-6, basket, `shop:buy`, Sweet
  Tooth); Hold (the model on her hand bone, HUD Eat); Eat (three bites, `food:eat`, hand empty);
  the parlor: style / scoops / toppings pictures, a triple-scoop sundae with sprinkles, cherry,
  whipped cream and chocolate sauce priced by parts (21), no new WebGL context for the preview;
  buy, hold, eat; the truck and its Favorites (buy two); the Basket's Sweet Treats; Hold a cake
  pop and Build-tap the puppy (`pet:feed` with the treat); Mia's bubble -> Treat -> Macarons (she
  holds our model); an ice cream and gummy bears on a long table; save + reload (coins, the
  basket's ice cream and its Bag item, the table ice cream); 2 coins cannot buy 15.
- **touch** (iPad 1024x768, taps): Bag -> Shops -> Ice Cream Truck shows "Pick a color!" and
  the tapped color is the one used (the ghost-click fix); placed with a tap; the Hand on the
  truck; a triple cone with sprinkles and gummy bears (15); Hold; Eat.
- **gift** (a non-automated browser, `navigator.webdriver` off): the gift pops up by itself,
  opens by itself (+25), and not again after reloading the world the same day.

Also run: `node tools/smoke.mjs --shots-prefix=shops`, `probe-life`, `probe-pals`, and the touch
passes of `probe-furniture` and `probe-outdoor` (the Bag change) all pass.

## Changes outside `src/things/shops` (all additive)

- `src/things/cooking.js`: imports `./shops/index.js` and calls its `install(game)` first
  (before the basket, so the candies are foods in time).
- `src/things/cooking/basket.js`: a **Sweet Treats** group (first) for `kind: 'sweet'`; for
  sweets the card buttons are Eat (from her hand, via `game.treats`), **Hold**, Pet, Table;
  "No more X! Visit a shop!"; `TABLE_SCALE.sweet`; the slurp sound also for foods with
  `FOOD[key].slurp` (ice creams).
- `src/ui/hud.js`: the coins pill shows `game.coins.shown` when present (so it counts up as
  coins land) and refreshes on `'coins:shown'`.
- `src/player/avatar.js`: the held-item hook: `avatar.hold(object3d | null, pose = 'hold' |
  'eat')` and `avatar.held`. A `held` group on the right forearm bone at the hand (HAND_R), kept
  upright like the hand accessories; while holding, the arm is raised (or lifted to her mouth
  with little nibbles for 'eat'), except during emotes; hidden asleep or swimming; the hand
  accessory's separate pieces hide meanwhile; `dispose()` lets go. Nothing changes when nothing
  is held.
- `src/ui/inventory.js`: **the iPad "Pick a color!" bug** reported by the outdoor team. An item
  card opens the color step on `pointerup`; on touch the browser's click after that tap landed
  on the color card now under the finger and picked it. Now a color card (and Back) only takes a
  click whose press started on it (`pointerdown` seen), a keyboard click, or any click after the
  step has been up 700 ms. Also Bag tab colors for `camping` and `shops`.
- `tools/probe-life.mjs`: the iPad adoption picks the Midnight kitty by its `data-variant`
  (since the pals team moved Calico to the kitty breeds, Midnight is no longer the 4th card).
- `docs/DESIGN.md` (a pointer to this file) and `docs/teams/outdoor.md` (the Bag note: fixed).

## Known limits

- The coins pill number lags the real total for about a second while coins fly (by design);
  `profile.coins` is always exact.
- Custom ice cream Bag items are registered when first seen, so a hotbar slot holding one she
  no longer owns shows empty after a reload (it never errs).
- The treat in her hand uses the shared food material, so it does not fade with the avatar when
  the camera comes very close (the avatar hides at 1.15, so this is rarely seen).
- Eating takes about 2 s of game time (slower on very slow devices, like everything animated).
