# Team "pals": more pets and cool girl friends (wave 2)

DESIGN.md section 4, items 3 (more pets) and 6 (friends).
Owned files: `src/things/pets.js`, `src/things/pets/*` except `pets/preview.js`, and
`src/things/friends/*`. Probe: `node tools/probe-pals.mjs [--only=lineup|desktop|touch]`.
No files outside these were changed. The friends module is installed from `pets.js`
(`installFriends(game)` at the end of the pets `install`), so `src/main.js` is untouched.

## More pets

Species (`game.registry.pets`) are now `puppy kitty bunny pony unicorn panda duckling turtle
horse`. Bag -> Pets gets `pet:turtle` and `pet:horse` automatically.

- **Turtle** (`src/things/pets/turtle.js`): shells `green` (Leafy Green), `rainbow`,
  `pinkspots` (Pink Spots), `ocean`, `starry`. Slow on land (2.1 blocks/s), fast in water
  (`spec.swimBoost` 2.3, so about 4.8 blocks/s), floats at the surface. Tickling it with the
  Remove tool tucks head, legs and tail into the shell for 2.6 s (`pet.anim.hideLeft`, blend
  `pet.anim.hide`), toast "Peekaboo! <name> is hiding in the shell!", then it peeks out with
  a happy hop. Petting brings it straight back out. Treat: strawberry. It rests standing
  (no sitting pose).
- **Horse** (`src/things/pets/horse.js`): rideable, bigger (about 2.4 tall with the ears) and
  faster than the pony (walk 5.6, run 8.8; ridden about 9 blocks/s, 12.8 with Run). Seat height
  1.4. Coats `chestnut`, `palomino`, `socks` (Black Beauty: black with white socks and a
  blaze), `dapple` (Dapple Gray), `pinto`. Mane option **Flowing / Braided** (pet option
  `braids`, braided knots with ribbons and a braided tail with a bow), picked in the adoption
  panel. Gallops (rocking canter) when ridden fast. Treat: carrot. It lies down instead of
  sitting and never uses pet beds (like ponies).
- **Breeds** (`src/things/pets/breeds.js`), shown under a "Breeds" heading in the adoption
  panel (colors first under "Colors"):
  - puppy: `retriever` (Golden Retriever), `dalmatian`, `corgi`, `poodle`, `husky`
  - kitty: `tabby`, `siamese`, `calico` (moved to Breeds), `persian` (Fluffy Persian), `black`
    (Black Cat)
  The old color variants are unchanged, so old saves load the same pets.
- Variant defs may set `group: 'breeds'` and `tagY` (name-tag height when the breed is taller).
- Adoption panel: "Pick a color or a breed" / "Pick a coat" / "Pick a shell"; the horse shows
  two mane buttons (`.lf-opt[data-braids]`) with pictures. Variant cards carry
  `data-variant`.

### Pet options (save format addition)

`pets.adopt(species, variant, name, spot, { fx, opts })`; `opts` is normalized by
`petOpts(species, opts)` in `species.js` (today only `{ braids: true }` for horses). A pet
save entry gets `opts` when it has any: `{ id, species, variant, ..., opts: { braids: true } }`.
`pet.opts` is always an object. `petThumb(game, species, variant, opts)` caches a picture per
option set.

### One draw call per pet (contract)

Live pets are built with `buildRig(species, variant, { ...opts, merged: true })`: every
vertex-colored part is baked into ONE shared geometry per species + variant + options and
drawn as a `THREE.SkinnedMesh` (`rig.skinned`) whose bones are the rig's own pivots
(`src/things/pets/skin.js`). A pet is now 3 draw calls (body, blob shadow, name tag; the
unicorn's glowing horn is one more) instead of 12-18.

- `animate()` still moves the pivots; parts that hide (happy / sleepy eyes, tongue, a turtle's
  head) now hide with `scale 0` as well as `visible` (a bone has nothing to hide).
- The closed sleepy eye is its own part (`eye.userData.sleepy`) instead of the happy eye
  flipped with `scale.y = -1` (a flipped bone would turn the faces inside out).
- Code that walks `pet.object3d` looking for part meshes will find empty `Object3D` bones
  instead. Use `pet.box` for bounds. `pet.dispose()` frees the per-pet bone texture.
- Previews (adoption panel) and thumbnails keep the separate meshes (`merged` off), so
  `preview.js` works unchanged.
- If merging ever throws, the pet is drawn part by part (a console warning, no error).

### Stickers

Registered on `game:ready` (so they follow the core ones in the book), with their own art:
`giddy_up` "Giddy Up!" (ride a horse, from `pet:ride`) and `shell_buddy` "Shell Buddy" (adopt a
turtle, from `pet:adopt`).

### Debug

`debug.pets.adopt(species, variant, name, x, y, z, opts)`, `debug.pets.tickle(id)`,
`debug.pets.info(id)` -> `{ species, variant, opts, merged, meshes, hide, riding, swimming }`.

## Friends ("really cool girls") - `game.friends`, system `'friends'`

Ten friends to invite (`src/things/friends/looks.js`), each with her own curated look, style,
name-tag color and voice pitch: **Mia** (Rock Star), **Zoe** (Sporty), **Ava** (Fairy),
**Lily-Rose** (Princess), **Maya** (Skater, roller skates), **Chloe** (Artist), **Nia**
(Dancer), **Emma** (Beach Day), **Sofia** (Snow Queen), **Aria** (Mermaid). Skin tones from
light to deep, twelve different hair styles and colors. Built with `game.createAvatar(look)`.
Wave 3 added six boys after them (Leo, Max, Kai, Sam, Ezra, Theo) with `pronoun` / `kind` on
every def, boy outfits, hair and lines, and an invite order that takes turns; see
`docs/teams/boys.md`.

- **Inviting**: Bag -> Fun & Toys -> **Invite a Friend** (`friend:invite`, first in the tab),
  Build-tap the ground -> panel **`friends`** (`ui.open('friends', { spot })`) -> tap a friend
  card -> she appears there with sparkles, confetti and a jingle, waves and says hello. The HUD
  **Friends** button (left column, under Pets, shown once a friend is here; action
  `'friends'`) opens the same panel without a spot: she appears in front of the player. Max
  **6** per world (the cards dim, a toast explains). A friend already here is marked "Here!"
  and tapping her card calls her over.
- **My Friends panel**: cards for the friends in this world (Call, Follow / Stay, Home, Bye with
  a double in-page confirm) and the invite roster with full-body portraits.
- **Hand-tap a friend**: she turns, waves, says hi, and a bubble opens over her head with big
  round buttons: **Talk** (a line that fits the moment), **Follow me** / **Stay here**,
  **Dance** (she dances and so does the player; everyone near joins in), **Treat** (a free
  star cookie, or up to five foods from the basket, shop treats first), **Dress up** (outfits
  Princess, Sporty, Beach Day, Fairy, Cozy Winter, Rock Star, Party, Mermaid; **Surprise!**;
  **New hair** (next hair style); **Twins!** (her outfit copied from the player's)). Remove
  tool: tickles (giggle, jump). Build tool with a food item: gives that treat.
- **Behaviour** (`friend.js`): wanders near her home spot, waves and says hi when the player
  comes within 4 blocks (at most every 40 s), chats every 9-18 s when near (one friend at a
  time), follows in slots beside the player (teleports when more than 24 blocks away or lost),
  stays put on Stay, hops 1-block ledges, swims, sidesteps and pops over when stuck. Mirrors
  the player's emotes (`'emote'` event: wave, dance, twirl, cartwheel, jump, heart, sit;
  friends sitting on a sofa get up to dance). Sits on free seats nearby now and then; at
  night goes to a free bed and sleeps (no bed: naps on the grass near home); when the player
  goes to sleep, friends within 30 blocks tuck into free beds too; everyone wakes up at
  `time:morning` (one of them says good morning). A friend gets up when the player takes her
  spot ("Here, you can have my seat!") or when the seat / bed is removed. Eats treats in
  three bites with the treat in her hand, then hearts and a thank you. Now and then she gives
  a pet nearby some love (heart hands, hearts over the pet, a happy hop, "Biscuit is so
  cute!").
- **Chat** (`chat.js`): 230+ short kind lines. They react to her outfit (tiara, wings, roller
  skates, hair style, rainbow hair...), pets near (by name and species), night, morning, rain,
  snow, rainbow, the world type, food in the basket, furniture nearby (piano, trampoline,
  beds, swing, easel, candy shop, ice cream parlor, campfire, tent, zip line tower...), plus 4
  lines of each friend's own. Friends also react to `shop:buy`, `zipline:ride`,
  `camp:marshmallow`, `photo:taken`, `sticker:earned`, `pet:adopt`, `cook:done`,
  `garden:harvest`, `prefab:place`. Lines never repeat one of the friend's last 8. Every line
  is a speech bubble (they stack instead of overlapping), a sing-song babble at her pitch,
  and read aloud through `game.speak` when the Read Aloud setting is on (not for background
  chatter).
- **Performance**: a friend is an avatar (~26 draw calls with the tag). Friends more than 40
  blocks from the camera are hidden; friends outside the view keep walking but their avatar
  animation is frozen (no `avatar.update`); name tags only within 22 blocks. With 6 friends
  and 3 pets in view the whole frame was ~150 draw calls in the probe. No per-frame
  allocations (frustum, sphere and bubble rects are reused).

### Events

- `'friend:invite'` `{ friend }` (canonical)
- `'friend:talk'` `{ friend, line, kind }` (canonical; every line a friend says)
- `'friend:treat'` `{ friend, food }` (food key), `'friend:style'` `{ friend, look }`,
  `'friends:dance'` `{ count }` (two or more friends danced along)

### Seats and beds (how other teams' furniture is used)

Any furniture def whose `actions[0]` is `'sit'` with `seat` / `seats` is a seat, and any with
`actions[0] === 'sleep'` with `sleepPos` / `sleepSpots` (or the default `[0.5, 0.45, 1]`) is a
bed (except `crib`). She walks to `entity.frontCell()`, then sits at the seat point (the
avatar's hips on it) or lies at the sleep point facing `rot * 90deg`, exactly like the player.
So the outdoor team's `camp_chair`, `picnic_table`, `tent`, `hammock`, `camper_bunk` and every
Magic Build bed and sofa work with no extra code, as long as they use those actions and
fields. Each spot is claimed by one friend at a time.

### Treats from the shops (contract)

Basket keys starting with `treat_` are treats friends can eat. The picture comes from the Bag
item `food:<key>` when it exists (`items.iconFor`), the name from that item. The 3D model in
her hand: `game.treats.model(key)` when the Shops team provides it (returns an Object3D, we
dispose it), else `foodModel(key)` when `food-models.js` knows the key, else the ice cream
(keys with ice/cream/sundae/shake/pop) or cupcake model.

### Save format (`systems.friends`)

`{ v: 1, list: [{ id, key, name, look, mode: 'home'|'follow'|'stay', x, y, z, yaw, home: [x,y,z], metAt }] }`.
The full look is saved, so outfits she picked stay. A friend sitting or sleeping is saved
standing next to her seat.

### Dress-Up Studio

The Studio (`src/ui/dressup.js`, Avatar team) always edits `game.profile.look` (it saves the
profile and emits `avatar:changed` on every change), so it cannot edit a friend's look
without changing the player. Friends are styled from their bubble instead (outfits,
Surprise!, New hair, Twins!), changing her right there in the world with sparkles. If the
Avatar team later adds `ui.open('dressup', { look, onDone(look) })`, the Dress up button can
open it (one line in `friends/ui.js`).

### Stickers

`bff` "Best Friends Forever" (invite a friend), `dance_party` "Dance Party" (two or more
friends dance along), `sleepover` "Sleepover" (she sleeps while a friend sleeps in a bed
nearby). Registered on `game:ready`, with their own art.

### Debug (`window.__game.debug.friends`)

`keys() roster() list() invite(key, x?, y?, z?) talk(id) tap(id) dance(id) setMode(id, mode)
treat(id, key?, free?) style(id, 'outfit'|'surprise'|'hair'|'twins', key?) sit(id) bed(id)
remove(id) lines() outfits() drawCalls()`.

## Probe coverage (`tools/probe-pals.mjs`)

- **lineup**: every dog (10), cat (9), turtle (5) and horse (5, flowing and braided) plus one
  of each species, each checked to be one merged mesh; screenshots `pals-lineup-*`.
- **desktop** (1280x800, real clicks): adopts a rainbow turtle, a braided palomino horse and a
  corgi through Bag + adoption panel; rides the horse (bubble Ride), checks speed above the
  pony's and the saddle height, Hop off; tickles the turtle with the Remove tool (hides, peeks
  out, never removed); turtle swims fast in a pool; invites Mia and Zoe through the Bag and Ava
  through the Friends button; Talk; Dance (everyone dances, Dance Party sticker); G + 6 heart
  emote mirrored; Treat -> Cookie (in her hand, eaten); Dress up -> Princess, New hair,
  Surprise!, Twins!; Follow me + walk; three friends sit on a sofa and an armchair; at night
  they sleep in beds; she sleeps in the last bed and everyone wakes up in the morning
  (Sleepover sticker); friends over 40 blocks away hidden; 6 max; save + reload keeps friends,
  outfits and the braided mane.
- **touch** (iPad 1024x768, taps): invite Nia from the Bag, tap her, Follow me, Dance; adopt a
  pinto horse with taps, ride it and hop off.
