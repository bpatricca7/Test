# Team "vehicles": cars, vans and boats you can drive (wave 3 design)

The request, from the dad and his daughter: *"Okay can you please make boys characters as well
as boats and cars and vans you can drive please."* This document covers **boats, cars and vans
you can drive**. The "boys characters" part belongs to the avatar / pals teams (looks and
NPC friends) and is out of scope here; every vehicle works with any avatar look, and the fleet
is made for every kid (a jeep, a go-kart and a speedboat next to a bubble car and a swan boat).

Status: **built** (wave 3; see "As built" at the end for what changed from this design and
the test results). Every claim about the existing code cites `file:line` as of branch
`claude/girl-game-world-building-gp6bnl`, commit `96565e4`.

Owner files (all new): `src/things/vehicles/*`, `tools/probe-vehicles.mjs`,
`tools/test-vehicles.mjs`, this file. Hooks outside the folder are small and listed in §3.2.

---

## 0. Decision summary

1. **Nine vehicles**, all free in a new Bag tab **Cars & Boats**, each with 6 color swatches:
   Bubble Car, Convertible, Safari Jeep, Go-Kart (cars); Road Trip Van, Ice Cream Van (vans);
   Speedboat, Swan Boat, Sailboat (boats). Detailed blocky models built with the furniture
   `Kit` (`src/things/furniture/kit.js:1-12`, merged geometry, one atlas material).
2. **A parked vehicle is a normal furniture entity** (`game.entities.define`,
   `src/things/entities.js:323`): Bag item `furn:<key>`, colliders, pickable, saved with the
   world (`entities.js:878`), synced by the journal as `e+ / e- / ed`, Remove tool, Undo,
   careful-friends protection. Hand-tap runs the new entity action **`drive`**.
3. **Driving lifts the entity out of the world** (`entities.remove(..., {history:false,
   events:false, fx:false})`, no Undo entry) and builds a live model that carries the
   player. **Getting out places it back** (same uid when allowed, grid-snapped, a 90-degree
   turn), again with no Undo entry.
4. **The player state stays `'ride'`**; `player.mount()` is generalised from "a pet" to
   "a mount" (`{ kind: 'pet' | 'vehicle', ... }`). Every existing "is she riding?" check
   (emotes, zip line, prefab move-out, unstick, pets/friends following, the presence `st`
   char `'h'`) already does the right thing for a car. See §4.1 for why this beats a new
   `'drive'` state.
5. **Never lost.** The driven vehicle is written into every save as a parked record
   (`systems.vehicles.away`), so autosave, page hide, leaving the world and a crash all keep
   it, without yanking her out of the car. In multiplayer the host keeps **custody** of any
   vehicle a friend is driving and puts it back if the friend disappears (§8.4).
6. **Physics:** a small kinematic model on top of the existing `Physics.overlap` /
   `bodyBlocked` (`src/world/physics.js:36-80`), with three square probes along the vehicle.
   Cars climb 1-block steps (visually eased), roll down gently, stop softly at walls (boing,
   stars), refuse water at the shore. Boats only move on water at one water level, bob and
   leave a foam wake. **Every number is sanitized every frame; every loop has a fixed bound.**
   `physics.js` itself is not changed.
7. **Controls (iPad first):** the joystick works exactly like riding the horse today
   (`src/things/pets/pet.js:582-589`, point where you want to go), plus a **chase camera**
   that swings behind the vehicle, plus **pull back = reverse**. Keyboard: W/S/A/D. While
   driving the **Jump** button becomes **Honk** (same spot, same input), and the left life
   column shows **Get out** and **Lights**.
8. **Multiplayer:** one new optional presence field **`vh`** (`[key, color, flags, honk,
   srcUid]`), drawn by `remote-players.js` under the friend's avatar. No protocol version
   bump (peers must already share the build id `pv`, `docs/MULTIPLAYER.md` §5.4/§9.14).
   Host validation gains a small **custody** rule for vehicle `e-` / `e+` (§8.4).
9. Stickers **Beep Beep!** (first drive) and **Ahoy!** (first boat ride). Pets riding along
   in the passenger seat is a cheap stretch goal (§11); NPC friends driving is not (§11).

---

## 1. Goals and non-goals

### Goals
- She can pick a car, van or boat from the Bag, put it in her world in the color she likes,
  tap it with the Hand and **drive it**, honk, switch the lights on, and get out where she
  wants. It stays where she parked it, in every save, on every device, with friends too.
- It feels great on an iPad with one thumb on the joystick: driving forward, turning,
  reversing, bumping softly into a wall, climbing a one-block step, sailing round a lake.
- Nothing scary and nobody gets hurt: no crashes, no damage, no flipping, no fast falls
  without a soft landing, no "game over". Bumps are bouncy and sparkly.
- Picture quality stays the same or better (headlights add light, nothing is lowered).
- Old saves load exactly as before; multiplayer keeps working with the host authoritative.

### Non-goals (v1)
- No racing, timers, scores, damage, fuel, or traffic. No passengers who are other players
  (each player drives her own vehicle). No trailers, no towing. No flying cars.
- No NPC friends driving (§11). No vehicles inside Magic Builds (a later prefab may add a
  parked van with `api.furn('van_camper', ...)`, which already works for any furniture key).
- No in-app purchases: every vehicle is free and unlimited, like furniture.

---

## 2. The fleet

All models: block units, footprint `[0,w] x [0,h] x [0,d]`, **nose = front = +Z** (the
furniture convention, `src/things/entities.js:5-6`), built with `new Kit()` and returned by
`k.build()` (`src/things/furniture/kit.js:307`). Plain colors go on the shared atlas
material, so a parked vehicle's body merges into the world's furniture batches
(`entities.js` StaticBatcher, `userData.batch`, see `kit.js:320`). Glass uses `sheer()` and
lamps use `glow()` from `src/things/furniture/paint.js` (as `src/things/shops/models.js:9`).

`build(color, data)`: when `data.live` is true (the driving model, the remote model and
nothing else) wheels / propeller / paddle wheel / sail go into named **parts**
(`kit.part(name, ...)`, `kit.js:288`) so they can spin; otherwise everything is static and
batched. Thumbnails (`entities.js:194-197`) build the static version.

| key | Bag name | kind | size [w,h,d] | swatches (first = default) | what makes it special |
|---|---|---|---|---|---|
| `car_bubble` | Bubble Car | car | [2,2,2] | `#FF9CCB #9BE8CF #C8B4FF #A6D8FF #FFE38F #FFBFA0` | round egg body, glass dome, big round "eye" headlights with lashes, smiley grille, white-wall wheels, flower antenna topper, polka dots |
| `car_convertible` | Convertible | car | [2,2,3] | `#FF5FA2 #6CC6FF #3FD8B0 #9C7BFF #FFC94D #FFFFFF` | open top, white tufted seats, heart steering wheel, chrome bumpers, tail fins with heart tail lights, white-walls |
| `car_jeep` | Safari Jeep | car | [2,2,3] | `#E9C98F #8FD4A8 #FF9F5A #6CC6FF #FF6F7D #B9A3FF` | boxy body, roll bar, big knobbly wheels, spare tire on the back, roof rack with a striped surfboard, fog lamps, pastel paw-print decals |
| `car_kart` | Go-Kart | kart | [1,1,2] | `#FF4F7B #4FB8FF #3FD8B0 #FFC94D #9C7BFF #FF9F43` | low frame, fat rear tires, number **8** on the nose plate, little spoiler, checkered flag on a whip pole |
| `van_camper` | Road Trip Van | van | [2,3,4] | `#8FE3D0 #FFB3C7 #A6D8FF #FFE38F #C8B4FF #FFBFA0` | two-tone (color + white), pop-top roof with striped canvas, surfboard, round headlights, curtains, flower stickers, a bike on the back |
| `van_icecream` | Ice Cream Van | van | [2,3,4] | `TRUCK_COLORS` (`src/things/shops/models.js:14`, exported) | serving hatch with a striped awning, giant cone on the roof, sprinkle decals, menu board; horn = a music-box jingle |
| `boat_speed` | Speedboat | boat | [2,2,4] | `#FF5FA2 #3AAEF0 #22BF95 #9C7BFF #FFC94D #FF7A59` | pointed bow, windshield, white seats, racing stripe, outboard motor (spinning propeller part), life ring |
| `boat_swan` | Swan Boat | boat | [2,2,3] | `#FFFFFF #FFD1E6 #E6DDFF #BFE9FF #FFF1B8 #C9F2E4` | swan body with a long neck, orange beak, bow tie, wing side panels, bench seat, paddle wheel at the back (part) |
| `boat_sail` | Sailboat | boat | [2,4,4] | `#FF9CCB #A6D8FF #FFE38F #9BE8CF #C8B4FF #FFFFFF` (sail color) | white hull, mast, striped main sail + jib (a part that billows with speed), pennant at the top, tiny cabin, tiller seat |

Boats are built with their **waterline at model y = 0.85**: a parked boat stands in the top
water cell (whose surface is drawn at +0.875, `src/world/mesher.js:30`), so the water covers
the hull's bottom edge. Boats have `update(entity, dt)` (`entities.js:827-835` runs
`def.update`) that bobs a `hull` part ±0.04 and rolls ±0.03 rad; so a parked boat's hull is
a part (not batched, about 2-3 draw calls per parked boat; see §9).

### Driving specs (starting values; tune with her)

`def.vehicle` (an extra def field; `define()` keeps unknown fields, `entities.js:323-334`):

| key | seat [x,y,z] | pose | body halfW / halfL / height | max speed | reverse | accel | turn (rad/s) | camera extra | horn | engine voice |
|---|---|---|---|---|---|---|---|---|---|---|
| `car_bubble` | [1.00, 0.45, 0.95] | sit | 0.88 / 0.88 / 1.6 | 6.5 | 2.5 | 5 | 2.2 | +1.5 | meep-meep | buzz |
| `car_convertible` | [1.32, 0.50, 1.25] | sit | 0.88 / 1.38 / 1.3 | 8.0 | 2.5 | 5 | 2.0 | +1.5 | ah-oo-gah | purr |
| `car_jeep` | [1.32, 0.62, 1.30] | sit | 0.88 / 1.38 / 1.7 | 7.0 | 2.5 | 5 | 2.0 | +1.8 | honk-honk | rumble |
| `car_kart` | [0.50, 0.28, 0.75] | sit | 0.40 / 0.90 / 0.9 | 8.5 | 2.5 | 7 | 2.6 | +1.0 | beep | zip |
| `van_camper` | [1.30, 0.90, 2.85] | sit | 0.88 / 1.88 / 2.6 | 6.0 | 2.2 | 4 | 1.6 | +2.5 | toot-toot | hum |
| `van_icecream` | [1.30, 0.90, 2.85] | sit | 0.88 / 1.88 / 2.6 | 6.0 | 2.2 | 4 | 1.6 | +2.5 | jingle | hum |
| `boat_speed` | [1.00, 1.05, 1.60] | sit | 0.85 / 1.85 / 1.0 | 9.5 | 2.0 | 4 | 1.8 | +2.2 | toot | putt |
| `boat_swan` | [1.00, 1.00, 1.10] | sit | 0.85 / 1.35 / 1.0 | 4.0 | 1.5 | 3 | 2.0 | +2.0 | quack-quack | pedal |
| `boat_sail` | [1.00, 1.05, 0.90] | sit | 0.85 / 1.85 / 1.0 | 6.5 | 1.5 | 2.5 | 1.5 | +3.0 | ding-ding | sail |

Seat = the seat **surface** (the avatar's sitting origin, DESIGN.md §2 Avatar "when
`sitting` the group origin is the seat surface"). The driver sits on the left (+X) in
two-wide cars (left of a +Z-facing car is +X, because the camera's right at yaw 0 is −X,
`src/player/camera.js:88`). Walking is 4.3 and running 6.5 (`src/player/player.js:9-10`);
the horse rides at about 9 (`src/things/pets/horse.js:10` speed 5.6 × 1.6,
`pet.js:592`): vehicles stay in that friendly range.

Also in `def.vehicle`: `kind`, `water` (boats), `noun` ('car', 'jeep', 'go-kart', 'van',
'boat'), `hint`, `passenger` (seat for a pet, §11), `lamps` (headlamp positions, model units),
`wheels` (radius and axle z, for spin), `door` (+1 left / −1 right: where she steps out).

---

## 3. Files

### 3.1 New files (`src/things/vehicles/`)

| file | contents |
|---|---|
| `index.js` | `install(game)`: Bag tab, `E.define` for every vehicle, item `use` overrides (land / water placement), `E.registerAction('drive', ...)`, the `vehicles` system (`update`, `serialize`, `deserialize`, `onWorldLoad`, `onWorldUnload`), keys (Space/H honk, L lights, E/X get out), life-column buttons, event listeners (multiplayer), `game.vehicles` facade (§4.6), `game.debug.vehicles` (§10.3). |
| `defs.js` | `VEHICLES` table (§2) and `vehicleDef(key)`. |
| `kit.js` | shared model helpers: `wheel(k, x, y, z, r, t, color)`, `axlePart`, `seat`, `steeringWheel`, `headlamp`, `discZ` (as `shops/models.js:110`, not exported there), `plate(k, text)`, `stripe`. |
| `models-cars.js` | `bubbleCar(color, data)`, `convertible`, `jeep`, `kart`. |
| `models-vans.js` | `roadTripVan`, `iceCreamVan`. |
| `models-boats.js` | `speedboat`, `swanBoat`, `sailboat`. |
| `drive.js` | `class Drive`: the live vehicle (pose, velocity, `step(dt, controls)`, probes, climb, water rules, sanitize, `seatWorld(out)`, `overlapsCell`, presence field). Pure logic over `{ world, physics }` so Node can test it (`tools/test-vehicles.mjs`). |
| `park.js` | `anchorFromCenter`, `findParkSpot(game, def, pose, opts)`, `isLandSpot`, `isWaterSpot`, `waterTopAt`, `doorSpot`. Bounded searches only. |
| `fx.js` | `WakeRibbon` (a flat foam ribbon, one draw call, ring buffer like `RainbowTrail`, `src/things/pets/fx.js:41-145`), `Headlights` (two additive light cones + a ground glow quad), dust puffs. |
| `sfx.js` | `createVehicleSfx(game)`: engine voice (start / speed / stop), horns, boing, splash, door pop. Same structure as `src/things/outdoor/sfx.js:6-121`. |
| `remote.js` | `RemoteVehicle` for friends' vehicles (built from presence `vh`), used through `game.vehicles.remoteModel()`. |
| `stickers.js` | `beep_beep` and `ahoy` with canvas art (100×100 box, `src/life/sticker-art.js:5-6`). |

Plus `tools/probe-vehicles.mjs`, `tools/test-vehicles.mjs` (§10) and two `package.json`
scripts: `"probe:vehicles": "node tools/build.mjs && node tools/probe-vehicles.mjs"`,
`"test:vehicles": "node tools/test-vehicles.mjs"`.

### 3.2 Changed files (all additive, inert unless a vehicle is used)

| file | where | change |
|---|---|---|
| `src/main.js` | imports; `modules` list `:49-51` | `import * as vehicles from './things/vehicles/index.js'`; insert `vehicles` after `cooking` (entities, pets and shops are installed by then, so the Bag tab can go after **Shops**; the system registers after `entities`, so `vehicles.deserialize` runs after entity deserialize, `src/core/game.js:735-742`). |
| `src/ui/inventory.js` | `TAB_COLORS :18-22`, `TAB_PICS :24` | `vehicles: '#6CC6FF'`; `vehicles: ['furn:car_bubble']`. |
| `src/things/entities.js` | `rotXZ :28` | `export` it. |
| | constructor (`:276-317`) | `this.extraLights = new Set()`: objects `{ object3d, lightPoint: [x,y,z], lightScale, lightCell: true, moving: true }` that may borrow a pool light. |
| | `update()` `:844-860` | when sorting `lit`, also push every `extraLights` item; in the per-frame loop `:857`, for an item with `moving`, also set `this.lights[i].position` every frame (the 0.25 s re-sort alone would lag ~2 blocks). The pool stays 4 lights: **no shader recompiles** (DESIGN.md §2 Rendering). |
| `src/player/player.js` | `mount(pet)` `:293-299` | becomes `mount(m)`; `m.kind` defaults to `'pet'`. Keeps `this.mountPet` (pets compare it by identity, `pet.js:578`, `:641`) and adds the getter `get mounted() { return this.mountPet; }`. |
| | ride branch `:86-98` | if `typeof m.seatWorld === 'function'` use `m.seatWorld(this.position)` and `this.yaw = m.yaw`, else today's `o.position + seatHeight`. |
| | `_syncAvatar` `:183-197` | `const seated = this.state === 'ride' && this.mountPet && this.mountPet.pose === 'sit';` then `sitting: this.state === 'sit' \|\| seated`, `riding: this.state === 'ride' && !seated`. |
| | `_onKey` `:50-59` | return early while a vehicle is mounted (a double Space would `toggleFly()`, which stands her up; Space is the horn while driving). |
| | `stand()` `:251-265` | before the stand spot: `if (was === 'ride' && m && m.beforeStand) pref = m.beforeStand();` (the vehicle parks itself **synchronously** and returns her door-side spot), then use `pref` if given, else `findStandSpot`. |
| | `overlapsCell` `:347-355` | `\|\| !!(this.state === 'ride' && this.mountPet && this.mountPet.overlapsCell && this.mountPet.overlapsCell(x, y, z))`: no blocks built into her moving car (`game.placeBlock` checks it, `src/core/game.js:1151`; `entities.canPlace` too, `entities.js:419`). |
| | `serialize` `:357-366` | for a vehicle mount use `this.mountPet.standSpot()` (beside the park spot the vehicles system computed for the same save) before `findStandSpot`. |
| `src/player/camera.js` | constructor `:20-31`, `update` `:61-127` | `this.extra = 0; this.extraWant = 0;` eased at 2/s; the wanted distance becomes `this.distance + this.extra` (the two uses at `:103-108`), so her own zoom is never overwritten (the zip line overwrites `rig.distance`, `src/things/outdoor/zipline.js:739`; we do not). `headY` `:75`: when `state === 'ride'` and the mount is a vehicle, `first ? 0.95 : HEAD` (a seated driver's eyes; 1.55 would be above the bubble car's dome). |
| `src/ui/hud.js` | `refreshFly` `:479-485`; events `:575` | `const driving = !!(game.player && game.player.mountPet && game.player.mountPet.kind === 'vehicle');` → `flyBtn.hidden = driving`; Jump's face and label become **Honk** (icon `honk`) while driving and back to **Jump** after. Add `'vehicle:drive'` and `'vehicle:park'` to the refresh list at `:575`. The Honk button keeps `name: 'jump'` (`holdButton`, `:226-238`): no new input plumbing. |
| `src/ui/icons.js` | `PATHS` | new icon `honk` (a horn with two sound arcs). |
| `src/things/pets/kit.js` | `PATHS` `:253-277` | new life icon `lights` (a headlamp with beams). "Get out" reuses `hopoff` (`:266`). |
| `src/ui/touch.js` | `:132` | keep a reference to the `.sw-joy-label` span; on `'vehicle:drive'` set it to **Drive** (boats **Steer**), on `'vehicle:park'` and `world:unload` back to **Walk**. |
| `src/net/adapter.js` | `local()` `:563-585` | add `vh: this.vehicleField()` (`game.vehicles ? game.vehicles.presence() : null`). |
| | `makeSnapshot()` `:257-264` | `if (json.systems) delete json.systems.vehicles;` (the host's own bookkeeping, like `netOwners` `:263`; otherwise a joining friend would get a parked copy of the car the host is driving). |
| | new | `isVehicle(key)` (registry def has `vehicle`), `parkVehicle(rec)` → uid or 0 (host custody: place `rec`, else the bounded park search near it, else near the record's origin). |
| `src/net/host.js` | `avatarFields` `:1217-1238` | `if ('vh' in local) owner._set(patch, 'vh', parseVehiclePresence(local.vh));` (same pattern as `hi`, `:1237`). |
| | `_run` `e+` `:479-492`, `e-` `:493-505` | custody rules (§8.4). |
| | `_freeSeat` `:319`, `kick` `:281`, `stop` `:151`, `_readPeers` `:179`, `_reclaimSeat` `:332`, `undoSeat` `:833` | custody release (§8.4). |
| | new | `this.custody = new Map()` (owner key → entry), `custodyRecords()`, `_releaseCustody(owner, why)`. |
| `src/net/protocol.js` | near `HELD_KEY_RE` `:213-216`; GameAdapter typedef `:420-488` | `VEHICLE_KEY_RE = /^[a-z][a-z0-9_]{0,31}$/`, `parseVehiclePresence(v)` → a clean array or `null`; typedef gains optional `isVehicle`, `parkVehicle`. |
| `src/net/remote-players.js` | `_ingest` `:324-354`, `_frame` `:356-424`, `_drop` `:477-492`, `list()` `:235-242` | parse `vh`; keep a `RemoteVehicle` per friend (from `game.vehicles.remoteModel`); pose `sitting` instead of `riding` when the vehicle's pose is `sit`; place the vehicle under her seat; play a new honk nonce within 24 blocks; dispose on drop; `list()` reports `vehicle: key \| null`. |
| `src/net/facade.js` | net object `:149-213` | `get rules()` (→ `session.rules`, `src/net/session.js:388`); `refuse(kind, vars)` gains kind `'vehicle'` (text in §7); `custody()` → `session.hostCore ? session.hostCore.custodyRecords() : []`; `ownerToken(uid)` / `restoreOwner(uid, token)` (host only, §8.4; no-ops elsewhere). |
| `tools/net/fake-adapter.mjs` | `FURNITURE`, `isEdible` `:193` | a `kart_test` entry with `vehicle: true`; `isVehicle(key)`, `parkVehicle(rec)`. |
| `tools/test-net.mjs` | new tests | §10.2. |
| `docs/DESIGN.md` | §1 activities + stickers, §2 events / Player / Entities / Save formats / Bag tabs, new §6 | §12 step 9. |
| `docs/MULTIPLAYER.md` | §5.4, §7, §8.1, §8.2, §9 | §12 step 9. |
| `package.json` | scripts | `probe:vehicles`, `test:vehicles`. |
| `dist/*` | | rebuilt (`npm run build`) in the same change, as the repo does (`git ls-files dist`). |

Nothing changes in `src/world/physics.js`, `src/core/game.js`, `src/core/storage.js`,
`src/net/guest.js`, `src/net/codec.js` or the server.

---

## 4. Data shapes and lifecycle

### 4.1 Why `'ride'` (generalised) and not a new `'drive'` state

`player.state === 'ride'` is already checked in 15 places that all mean "she is being
carried: don't emote, don't unstick, follow her, stand her up first": `emotes.js:34`,
`zipline.js:303`, `prefabs.js:315`, `game.js:1289` (unstick), `cooking.js:68`,
`basket.js:175,204,233`, `friends/index.js:326`, `friends/friend.js:598`, `pet.js:331`,
`pets.js:519`, `player.js:202,307,327,335,360`, and the presence map
`adapter.js:21` (`ride: 'h'`). A new state would need every one of those edited (and the
remote pose code), with a real risk of missing one. The pets code compares
`pl.mountPet !== this` by identity (`pet.js:578`, `:641`), so a vehicle mount is simply "not
my pet" there. The two places that read pet-specific fields are covered by the optional
`seatWorld` / `pose` fields above. `basket.js:204` lifts eat sparkles by 1.25 for any mount:
fine in a car.

### 4.2 The mount object (what `player.mount(m)` receives)

```js
m = {
  kind: 'vehicle',
  key, def,                    // registry def (def.vehicle = specs)
  object3d,                    // the live pivot Group (position = footprint centre at the wheels, rotation.y = yaw)
  yaw,                         // radians, finite, normalised to (-PI, PI]
  pose: 'sit',
  seatHeight,                  // def.vehicle.seat[1] (for code that only knows pets)
  seatWorld(out),              // writes the seat surface (world) into out, returns out
  overlapsCell(x, y, z),       // her moving car's body boxes vs a block cell
  standSpot(),                 // [x,y,z] beside the park spot of the current save (player.serialize)
  beforeStand(),               // park now (synchronously), returns her door-side stand spot or null
}
```

### 4.3 Entity def (one example)

```js
E.define({
  key: 'car_convertible', name: 'Convertible', category: 'vehicles', size: [2, 2, 3],
  colors: ['#FF5FA2', '#6CC6FF', '#3FD8B0', '#9C7BFF', '#FFC94D', '#FFFFFF'],
  build: (c, data) => convertible(c, data),
  colliders: [[0.06, 0, 0.04, 1.94, 1.25, 2.96]],
  actions: ['drive'],
  defaultData: {},
  vehicle: {
    kind: 'car', water: false, noun: 'car', hint: 'Tap to drive!',
    seat: [1.32, 0.5, 1.25], passenger: [0.68, 0.5, 1.25], pose: 'sit', door: 1,
    body: { halfW: 0.88, halfL: 1.38, height: 1.3 },
    speed: 8, reverse: 2.5, accel: 5, turn: 2.0, cam: 1.5,
    horn: 'aooga', engine: 'purr',
    lamps: [[0.45, 0.62, 2.98], [1.55, 0.62, 2.98]],
    wheels: { r: 0.28, axles: [0.62, 2.38] },
  },
});
```
Boats add `update(entity, dt)` (bob), `colliders: [[0.05, 0, 0.05, w-0.05, 1.3, d-0.05]]`
(the hull only; the sail and mast are not walls).

### 4.4 Placement (item `use` overrides, after `define`)

Like `patchPoolFloat` (`src/things/furniture.js:21-43`), `index.js` replaces each vehicle
item's `use(g, hit, opts)`:

- **Land vehicles.** Cell as in `placeFromHit` (`entities.js:721-728`). If that cell or the
  one below it is a liquid → toast **"Cars go on land!"**, return false. Rotation: the
  **nose points away from her** (where she is looking), so pushing forward drives away from
  the camera: `rAway = (rotToward + 2) % 4` where `rotToward` is the furniture rule
  (`entities.js:753-755`); try `[rAway, rAway+1, rAway+3, rotToward]`. The anchor is moved
  `d − 1` cells along the nose, so the **rear row** is the tapped cell and the body extends
  away from her: `[fx, fz] = rotXZ(0, 1, r); anchor = cell + (d − 1) · [fx, fz]`. Accept the
  first `canPlace` (`entities.js:403`) whose bottom cells have solid ground under at least
  half of them; else the existing **"No room there!"** (`entities.js:761`).
- **Boats.** Climb from the tapped cell to the top water cell (as `furniture.js:30-33`). If
  there is no water there → **"Boats go on water! Tap the water."** Same nose-away rule and
  anchor shift; accept only when every bottom footprint cell is a liquid whose cell above is
  not, and `canPlace` passes.
- `E.place(key, ...)` with the chosen color: normal history (one Undo removes it), normal
  events and sparkle, normal journal/recorder. A parked vehicle is ordinary furniture from
  here on (Remove tool, Undo, Build-tool rotate on the same item, careful friends).

### 4.5 Save format (backward compatible)

- Parked vehicles: ordinary entity records in `systems.entities`
  (`{ uid, key, x, y, z, rot, color, data }`, `entities.js:878-880`). `data` stays `{}`.
- **New `systems.vehicles`** (written by the new system's `serialize`):
  ```js
  { v: 1, away: [ { uid, key, x, y, z, rot, color, data } ] }   // or undefined when empty
  ```
  `away` holds (a) the vehicle she is driving right now, as the **parked record it would get
  if she got out here** (`findParkSpot` from the live pose; if none, the record she took it
  from), and (b) on a host, every vehicle a friend is driving (`game.net.custody()`, §8.4).
  `deserialize` places each record (`E.place(..., { uid, history:false, events:false,
  fx:false })` when `canPlace`; else the bounded park search around it; else around the
  player; last resort `force: true` at the record) and then calls `game.unstickPlayer()`
  (`src/core/game.js:1281-1284`) because `_enterWorld` does not unstick
  (`game.js:733-742`).
- `player` in the save: `player.serialize()` already stands her up for `'ride'`
  (`player.js:360-362`); with a vehicle it uses `m.standSpot()` (beside the computed park
  spot, never inside it). `serializeWorld` runs systems before the player (`game.js:829-838`
  then `:858`), so the park spot is known when the player is saved.
- **Old saves**: no `systems.vehicles` → nothing happens; no vehicle keys → nothing new.
- **Old builds reading new saves**: unknown furniture keys are skipped
  (`entities.js:891`) and unknown systems ignored, so nothing breaks; the vehicles are
  dropped only if that old build saves the world again (a Railway rollback; see §13).
- Stats in `profile.stats`: `drives`, `boatRides`, `honks`, `driveMeters` (ints, per player;
  guarded by `remoteApplying`).

### 4.6 `game.vehicles` facade and events

```js
game.vehicles = {
  defs,                        // Map key -> def (vehicles only)
  current,                     // the Drive or null
  drive(entity) -> bool,       // what the 'drive' action runs
  park({ reason }) -> bool,    // 'button' | 'key' | 'stand' | 'auto' | 'net'
  presence() -> vh | null,     // §8.1
  remoteModel(vh) -> RemoteVehicle | null,
  honk(), toggleLights(),
};
```
Events (added to DESIGN.md §2): `'vehicle:drive' { key, kind, uid }`,
`'vehicle:park' { entity, reason }`, `'vehicle:honk' { key }`,
`'vehicle:bump' { speed }`. Drive and park use `events: false` on the entity calls, so no
`entity:place` / `entity:remove` fires (no tutorial step, no "Home Sweet Home" counting, no
solo-edit mark). The "save 5 s after a change" timer listens to the events in
`DIRTY_EVENTS` (`src/core/game.js:32-35`, `:443`): the drive tap is already covered
(`entities.use()` emits `'entity:use'`, `entities.js:804-809`), and **`'vehicle:park'` is
added to `DIRTY_EVENTS`** (a one-word change, the only edit in `game.js`), so a parked car
is saved within 5 s like any furniture.

### 4.7 Drive / park lifecycle

**`drive(entity)`** (the `drive` action's `run`, from a Hand tap):
1. Refuse when: no player; she is asleep; she is already in a vehicle → **"Park first, then
   try again!"**; a boat that is not on water (bottom cells not liquid) → **"Boats need
   water! Put it on the water with Build."** On a horse: `game.pets.dismount()` first
   (`src/things/pets.js:407-412`, `game.pets` at `:626`). Flying: land quietly.
2. Multiplayer guest checks (§8.3).
3. `rec = { uid, key, x, y, z, rot, color, data }`; start pose from
   `E.localToWorld(e, w/2, 0, d/2)` (`entities.js:380`), `yaw = rot · π/2`.
4. Host only: `token = game.net?.ownerToken(uid)` (§8.4).
5. `asPlayer(() => E.remove(e, { history: false, events: false, fx: false }))`. `asPlayer`
   sets `game._inSystems = false` around the call and restores it, because a guest's
   recorder ignores changes made inside systems (`src/net/guest.js:753`) and a host's
   author map treats them as "no owner" (`src/net/host.js:649`). A drive or park is always
   her own action, even when the system noticed it (see "auto-park" below).
6. Build the live model (`def.build(color, { live: true })`), wrap it in a pivot exactly as
   `_attach` does (`entities.js:519-527`), add it to the vehicles group.
7. `player.mount(m)`; `cameraRig.yaw = yaw` (as pets do, `pets.js:397`);
   `cameraRig.extraWant = v.cam`.
8. Engine start, a sparkle, the first-time controls toast (§7), stats, sticker, emit
   `'vehicle:drive'`.

**`park({ reason })`**:
1. `spot = findParkSpot(...)` (§5.6). Boats with `reason: 'button'`: the shore rule (§5.5).
2. If no spot and the reason is `'button'` / `'key'` → **"No room to park here! Drive a
   little more."** and keep driving. For every other reason (stand, auto, net, save) use the
   fallbacks: the record she took it from (if `canPlace`), then a search around it, then
   (solo / host only) back into the Bag with **"No room to park, so your car went back in
   the Bag."** (it is free and unlimited; this needs a world packed full of blocks).
3. Dispose the live model, stop the engine, drop the extra light, `cameraRig.extraWant = 0`.
4. `asPlayer(() => E.place(key, ax, ay, az, rot, color, data, { uid, history: false,
   events: false, fx: false, players: false }))` with `uid` = the original uid unless she
   is a guest and it is not in her range (`E.uidBase`, §8.3), then `E.allocUid()`.
   Host: `game.net?.restoreOwner(newUid, token)`.
5. Stand her at the door-side spot (`park.doorSpot`, then `findStandSpot`,
   `player.js:268-291`) **after** placing, so she is never inside its collider.
6. Sparkle, `pop`, emit `'vehicle:park'`.

**Auto-park** (the state changed under us): every frame the system checks
`player.state === 'ride' && player.mountPet === this.current.mount`. `sitOn` / `sleepIn`
set the state directly (`player.js:225-249`), `teleport` resets it (`:334-345`),
`pets.mount` replaces the mount (`pets.js:394`): in each case the vehicle parks where it
is (`reason: 'auto'`, through `asPlayer`). `setFlying`, `hold` and explicit `stand()` go
through `beforeStand` (synchronous). World unload / page hide / save: **no physical park**;
the save already holds the parked record (§4.5), and on unload the live model is dropped
(`onWorldUnload`). A friend's page never saves (`game.js:799-807`); her car is the host's
to keep (§8.4).

---

## 5. Physics on voxels (`drive.js`, `park.js`)

### 5.1 State
`pos` (Vector3, pivot centre at wheel level), `yaw`, `speed` (signed, along the nose),
`vy`, `onGround`, `liftVis` (visual vertical offset, eases to 0 at 5/s), `pitchVis`,
`rollVis`, `waterY` (boats: index of the top water cell), `good = { x, y, z, yaw }` (last
valid pose), counters for debug (`nanResets`, `bumps`, `blockedFrames`). No allocations per
frame: all scratch vectors are fields.

### 5.2 Probes
Three square bodies along the nose axis, each `bodyBlocked(px, y + 0.01, pz, halfW,
height)` (`physics.js:78-80`): centre, and `± (halfL − halfW)` along the nose (one probe
when `halfL === halfW`, the bubble car). `halfW < w/2` and `halfL < d/2`, so a parked
vehicle's probes always fit inside its own footprint, which `canPlace` already proved free.
At a diagonal heading the squares miss the rectangle's corners by at most ~0.25 blocks: the
nose may touch a wall a little at 45°; never the other way round (never stuck in a wall).
`overlap` already calls a non-finite or > 64-block box "blocked" (`physics.js:41-42`), so a
broken pose can never loop inside it.

### 5.3 One frame (`step(dt, controls)`), land vehicles

```
dt: if !(dt > 0) return; dt = min(dt, 0.05)                 (the game clamps too, game.js:318)
sanitize()                                                  (5.7)
controls -> targetSpeed, yawRate                            (6.1)
speed += clamp(targetSpeed - speed, -decel*dt, +accel*dt)   (decel 3.5 coasting, 9 braking)
turn:   newYaw = yaw + yawRate*dt; accept only if poseFree(pos, newYaw) (no turning into a wall)
move:   d = speed*dt; n = min(4, ceil(|d| / 0.3)); for s in 0..n-1:
          try P' = P + nose*(d/n) at the same y:
            free and !waterAhead(P')          -> accept
            blocked by <= 1.05 rise (front probe's overlap top, onGround) and the whole body
              is free at y' = top + 0.001     -> accept, y = y', liftVis -= rise, speed *= 0.75
            else slide: try the X part alone, then the Z part alone -> accept one, speed *= 0.85
            else: stop. if |speed| > 2: bump (boing, stars at the bumper, squash 0.3 s)
                  speed = 0; break
vertical: support = max top under the 3 probes in [y - 1.2, y + 0.05] (3 overlap calls)
          support >= y - 0.01 -> y = support, vy = 0, onGround
          else vy = max(vy - 18*dt, -14); y = max(support, y + vy*dt)  (soft landing squash
               when vy < -6; never damage)
          water under the centre after falling -> back to good pose (5.7)
visual: pitchVis eases to atan2(supportBack - supportFront, 2*(halfL-halfW)) clamped +-0.3;
        rollVis small sway from yawRate*speed clamped +-0.08; liftVis -> 0
clamp:  x, z inside [m, size - m] (m = halfL + 0.02), like physics.js:106-107, 166-170
good:   if onGround and poseFree -> good = pose
```

- **Climbing** a 1-block step: the physics snaps (one frame), the picture eases (`liftVis`
  over ~0.2 s) and tips the nose up (`pitchVis`), so it reads as a smooth bump.
- **Rolling down**: the vehicle rests on its highest supported probe, so at an edge the nose
  dips first (pitch), then the body drops when the last probe leaves the step: 1 block
  takes ~0.33 s at gravity 18 (gentler than the player's 24, `player.js:14`).
- **Walls**: a soft stop, a "boing", 4 stars; sliding along walls keeps her moving.
- **Water** (`waterAhead`): a liquid cell at the front probe at `y + 0.1`, or no support
  within 1.2 under the front probe and a liquid at `y − 0.6` → treated as a wall, no boing,
  speed 0, toast **"Cars can't swim! Try a boat!"** (keyed, at most every 6 s).
- **No flipping**: pitch and roll are picture-only and clamped; the body never rotates
  around X or Z.
- **Speeds**: §2 table. Turning at a standstill is allowed at 35% (kids point first, then
  push).

### 5.4 Boats

- On drive: `waterY = waterTopAt(x, z)` (scan up from the boat's cell while liquid, at most
  64 steps, `y < world.sy`).
- A pose is free for a boat when, for every probe centre, the cell `(floor(px), waterY,
  floor(pz))` is a liquid and `bodyBlocked(px, waterY + 0.9, pz, halfW, 1.0)` is false (no
  block, bridge or furniture collider at hull height). Same sub-steps, turn check and slide
  as cars; no climbing, no gravity: `pos.y = waterY` always.
- Bumping the shore: speed 0, a soft splash, toast **"Boats stay on the water!"** (keyed,
  every 6 s).
- The water went away under her (someone removed it): search the 8 neighbouring columns at
  `waterY` for water and move there; else park with fallbacks (a boat may then sit on land:
  Hand-tap says **"Boats need water! Put it on the water with Build."**).
- Picture: bob `0.05·sin(2.1t)`, pitch `0.03·sin(1.3t)` plus a little nose-up with speed;
  the sail part billows (`scale.z = 1 + 0.15·speed/max`); the swan's neck nods; the paddle
  wheel and propeller spin with speed.
- **Wake**: a `WakeRibbon` (horizontal foam strip, 56 points, ages out in 1.6 s, widens as it
  ages: a V) pushed at the stern when `|speed| > 0.8`, plus `particles.emit('splash', stern,
  { count: 2, spread: 0.3 })` every 0.09 s above 1.5 b/s (`src/life/particles.js:25`).

### 5.5 Getting out of a boat
1. `spot = player.findStandSpot(seat)` (`player.js:268-291`, ring radius ≤ 3, needs ground):
   found → park the boat on water right here (water park search), stand her on the shore.
2. Not found (open water): first tap → **"Drive to the shore, or tap Get out again to
   swim!"**; a second tap within 4 s → park on water, put her in the water beside the hull
   (she swims; the existing splash and `splash` sticker happen naturally,
   `player.js:113-118`).

### 5.6 Park spot search (`findParkSpot`), bounded
- `rot = round(yaw / (π/2)) & 3`; candidates rot order `[rot, rot+1, rot+3, rot+2]`.
- Centre → anchor: `[ox, oz] = rotXZ(w/2 − ai − 0.5, 0.5 − d/2, rot)`,
  `ax = round(cx − 0.5 − ox)`, `az = round(cz − 0.5 − oz)` (the inverse of `localToWorld`,
  `entities.js:380-385`, `ai = floor((w − 1)/2)`, `:361-364`).
- Offsets: rings r = 0..3 (49 columns) × 4 rotations × dy ∈ {0, +1, −1} = at most 588
  `canPlace` calls (each ≤ 32 cells); land: half the bottom cells supported, none liquid;
  boats: all bottom cells liquid at `waterY`. `players: false` (she is in it).
- Extended fallback (non-button reasons only): rings 4..8 (at most 3,468 calls, a few ms,
  once). Only called at Get out, auto-park and save (cached for 1 s), **never per frame**.

### 5.7 Safety: NaN / Infinity and loops
- `sanitize()` at the start and end of every step: if any of `pos.x/y/z, yaw, speed, vy,
  liftVis, pitchVis` is not finite → restore `good`, zero `speed / vy / liftVis`,
  `nanResets++`, one `console.warn` per drive (never `console.error`: the probes fail on
  errors only for real bugs, and this path is tested on purpose).
- `yaw = atan2(sin(yaw), cos(yaw))` each frame (after the finite check).
- Controls: `move.x / move.z` not finite → 0, clamped to [−1, 1].
- Start of a frame **inside** something (a block placed into the car by a friend, an Undo):
  try `y + 1`, `y + 2`, `y + 3` (3 tries), then `good`, then auto-park with fallbacks and
  **"Oops! Something got in the way. Your car is parked."**
- Below the world (`y < −8`) or above `sy + 30` → `good` (like `player.js:154-159`).
- Loop bounds: sub-steps ≤ 4; climb ≤ 1 per sub-step; support 3 calls; water scan ≤ 64;
  park search ≤ 588 (≤ 3,468 fallback); stand spot ≤ 49 × 4 (`findStandSpot`); unstick ≤ 3;
  remote vehicles O(1) per friend. **No `while` loops** in `src/things/vehicles/` (checked
  by `tools/test-vehicles.mjs`, §10.1).
- Remote data: presence `p` is finite-checked already (`remote-players.js:327`); `vh` is
  parsed by `parseVehiclePresence` (§8.1); saved records: `x, y, z` must be integers in
  bounds, else go to the fallback search.

---

## 6. UI and controls

### 6.1 Steering (one scheme for joystick and keys)
- `W` = the camera-relative wish vector, exactly as the player and the horse compute it
  (`player.js:104-109`, `pet.js:582-589`); `|W|` (0..1) is the throttle (the joystick's
  curve and dead zone already apply, `src/ui/touch.js:105-127`).
- `|W| < 0.15`: coast to a stop (3.5 b/s²): **letting go slows down**.
- **Reverse**: the stick or keys point mostly back (`move.z < −0.35` and
  `|move.x| < 0.75·|move.z|`) while the camera is roughly behind the vehicle
  (`|angleDelta(yaw, cameraYaw)| < 1.2`) → target speed `−reverse·|W|`; `move.x` swings the
  tail to that side at 60% of the turn rate. A soft "beep beep" plays while reversing.
- Otherwise **point to go**: `rel = angleDelta(yaw, atan2(Wx, Wz))`;
  `yawRate = clamp(3·rel, −turn, turn) · min(1, 0.35 + |speed| / 1.5)`;
  `targetSpeed = speed_max · |W| · (1 − 0.5·min(1, |rel| / 1.6))` (slows in sharp turns).
- **Chase camera** (in the vehicles system, the zip line's pattern,
  `zipline.js:724-740`): when `|speed| > 0.5`, not reversing, and no look drag or arrow
  turn for 1.0 s, `rig.yaw += angleDelta(rig.yaw, yaw) · min(1, 1.8·dt)` and `rig.pitch`
  eases to 0.32. So "up" is forward, left/right steer and "down" reverses, like every
  driving toy; dragging the view always wins for a while.
- **Keys**: W/↑ go, S/↓ reverse, A/D steer (through the same wish vector), ←/→ still turn
  the camera (`src/core/input.js:146-147`), **Space or H = Honk**, **L = Lights**,
  **E or X = Get out** (the pets' keys, `pets.js:694-698`; E also does its usual Hand
  switch, `game.js:1387-1389`, harmless).
- First person (V) works: the camera sits at the driver's eyes (§3.2 camera), the avatar
  hides as today, the dashboard shows.

### 6.2 HUD while driving
| control | where | look |
|---|---|---|
| **Honk** | the Jump button's place (bottom right on touch; `.sw-touch`, `hud.js:440-445`) | icon `honk`, label "Honk", mint; same `input.press('jump')` (`hud.js:226-238`) |
| **Get out** | life column, `order: 0`, pulsing (`lifeHud`, `src/things/pets/kit.js:343-378`, as **Hop off** `pets/ui.js:517-518`) | icon `hopoff`, pink |
| **Lights** | life column, `order: 1` | icon `lights`, sun-yellow; lit when on |
| Fly | hidden while driving | |
| Joystick label | | "Drive" (boats "Steer") |

Buttons show on `'vehicle:drive'` and hide on `'vehicle:park'` and `world:unload`. The
life column already keeps clear of the joystick on every screen shape
(`pets/kit.js:316-335`).

### 6.3 Lights
- Toggle with Lights / L; **automatic at night**: on when `uDaylight < 0.55` unless she
  switched them off during this drive (cheap: one uniform read per frame).
- Picture: the model's lamp boxes glow (`glow()` material), two additive cones and one
  ground-glow quad (`MeshBasicMaterial`, additive, `depthWrite: false`, opacity follows
  `1 − daylight`), and the driven vehicle borrows one of the 4 pooled point lights through
  `E.extraLights` (§3.2): real warm light on the walls, no new light, no recompiles.
- Friends see the lamps and cones (flag in `vh`), not the pooled light.

### 6.4 Hints
- Parked vehicle with the Hand tool: `def.vehicle.hint` ("Tap to drive!" etc., §7). Remove
  tool: "Tap to remove"; Build with the same item: "Tap to turn it" (`entities.js:813-825`).

---

## 7. Every player-facing string

| where | text |
|---|---|
| Bag tab | **Cars & Boats** |
| Item names | Bubble Car · Convertible · Safari Jeep · Go-Kart · Road Trip Van · Ice Cream Van · Speedboat · Swan Boat · Sailboat |
| Hand hints | cars, jeep, go-kart, vans: "Tap to drive!" · Speedboat: "Tap to drive the boat!" · Swan Boat: "Tap to pedal!" · Sailboat: "Tap to sail!" |
| HUD | "Honk" · "Get out" · "Lights" · joystick "Drive" / "Steer" |
| first drive (touch) | "Push the joystick to drive! Tap Honk to beep!" · boats: "Push the joystick to steer! Tap Honk to toot!" |
| first drive (keys) | "Drive with W A S D! Space honks, E gets out." · boats: "Steer with W A S D! Space toots, E gets out." |
| placing | "Cars go on land!" · "Boats go on water! Tap the water." · (existing) "No room there!" |
| driving | "Cars can't swim! Try a boat!" · "Boats stay on the water!" · "Park first, then try again!" |
| boat on land | "Boats need water! Put it on the water with Build." |
| getting out | "No room to park here! Drive a little more." · "Drive to the shore, or tap Get out again to swim!" |
| fallbacks | "Oops! Something got in the way. Your car is parked." · "No room to park, so your car went back in the Bag." (`car` becomes the vehicle's noun) |
| friends (guest) | "That's {host}'s {noun}! Make your own in the Bag." · "{name} is driving that one!" · "Your {noun} went back to its spot!" |
| friends (host) | "{name}'s {noun} went back to its spot." |
| stickers | **Beep Beep!** (hint "Drive a car or van") · **Ahoy!** (hint "Steer a boat") |

Nouns: car, jeep, go-kart, van, boat. `{host}` / `{name}` are sanitized names
(`src/net/facade.js:166-169`). Per Addendum B item 6 a refusal never says "ask first".

---

## 8. Multiplayer

### 8.1 Presence field `vh` (both roles)

| field | type | meaning |
|---|---|---|
| `vh` | `[key, color, flags, honk, src]` or absent/null | `key`: a registered vehicle key (`VEHICLE_KEY_RE`); `color`: 6 lowercase hex, no `#` (as the look codec, `docs/MULTIPLAYER.md` §5.13); `flags`: int 0..3 (bit 0 lights, bit 1 reversing); `honk`: int 0..999 nonce (wraps); `src`: the uid she took it from (int 0..2³¹, 0 = none) |

- Written by `adapter.local()` → `avatarFields` (`host.js:1217-1238`), exactly like `hi`
  (`:1237`): the presence key is set only when the value changes, so a drive costs one
  send, a honk one send (honks are limited to one per 0.6 s), lights one send. Position is
  the existing `p` (the seat: `player.position` is the seat surface while driving), yaw is
  `p[3]`. About 45 bytes; host presence stays far below 3,900 B (§5.4: about 1.2 KB).
- `st` stays `'h'` (`adapter.js:21`). `'h'` without `vh` is still a horse ride.
- **No protocol bump**: `v` stays 1. Peers in one room already run the same build (`pv`
  must match, §5.4 / §9.14), so no page meets a `vh` it does not understand; receivers still
  parse it defensively (`parseVehiclePresence`: wrong shape, unknown key or bad color →
  `null`, numbers clamped).

### 8.2 Drawing friends' vehicles (`remote-players.js`)
- `_ingest`: `f.vh = parseVehiclePresence(st.vh)`; on a key or color change, dispose the
  old `RemoteVehicle` and ask `game.vehicles.remoteModel(vh)` for a new one (live model, same
  as hers, ~3-5 draw calls); a new `honk` nonce plays the horn when she is within 24 blocks
  (volume falls off with distance).
- `_frame`: pose `sitting: st === 's' || (st === 'h' && f.vehicle && pose === 'sit')`,
  `riding: st === 'h' && !(...)` (today `:403-411`). The vehicle's pivot = her seat
  position minus the seat offset rotated by her yaw:
  `o = (seat.x − w/2, seat.y, seat.z − d/2)`; `pivot.x = p.x − (o.x·cos yaw + o.z·sin yaw)`,
  `pivot.z = p.z − (−o.x·sin yaw + o.z·cos yaw)`, `pivot.y = p.y − seat.y`. Wheels spin and
  boats bob from `f.speed` (already computed, `:389-391`); wakes for remote boats too
  (one ribbon each). Hidden with her avatar beyond 64 blocks (`:394-397`).
- `_drop` disposes it; `list()` gains `vehicle`. No collisions and no picking, as for
  avatars (§7 "Friends' avatars").

### 8.3 A friend (guest) drives
- **Before trying** (no flicker in the common cases):
  - building paused (`!game.net.mayEdit('build')`) → `net.refuse('paused')`: the host would
    reject both the `e-` and the `e+` (`host.js:483`, `:497`);
  - careful mode (`game.net.rules.mine === 0`) and the vehicle's uid is **below 10⁶** (the
    host's own range, `docs/MULTIPLAYER.md` §5.2; host-range entities are owner 0 or
    no-owner, both protected, §8.2) → `net.refuse('vehicle', { noun })`: **"That's Lily's
    car! Make your own in the Bag."**
- **Driving**: the drive's `e-` is recorded (through `asPlayer`) and predicted as today;
  she drives at once.
- **If the host says no** (another friend's car in careful mode, or a lost race): the host
  touches the key and sends the parked record back with the ack (§5.6 rule 4), so the
  entity with her `src` uid **reappears** on her page. The vehicles system checks every
  frame `E.byUid(src)` while she drives a borrowed uid on a guest: if it is there again,
  the drive ends without parking (the live car vanishes in a sparkle, she stands beside the
  parked one). The net layer already shows its own rejection toast; we add none.
- **A race** (two players tap the same car within ~100 ms): the second `e-` finds it gone
  and is accepted as "already gone" (`host.js:498`), so rejection cannot tell. Instead, if
  another player's `vh[4]` equals her `src`, the lower seat keeps it (the host is seat 0);
  the other page ends its drive without parking: **"{name} is driving that one!"**
- **Parking**: an `e+` with her original uid when it is in her range
  (`E.uidBase + 1 ≤ uid < E.uidBase + 10⁶`), else a new uid from `E.allocUid()`
  (`entities.js:387-392`) as the host requires (`host.js:484-485`).
- **Undo building** for her (ctl `tidy` → `'net:tidied'`, `facade.js:245-247`): if she is
  driving, the drive ends without parking (the host has reverted her vehicle changes).
- **Leaving, kicked, host ends, page reload**: her page drops the live model on unload
  (guests never save, `game.js:799-807`); the host's custody puts the car back (§8.4).

### 8.4 Host: custody (`host.js`), the "never lose a vehicle" rule
- **Taking**: in `_run` case `e-` (`host.js:493-505`), when the removed entity's key
  `a.isVehicle(key)`: before removing, `custody.set(owner, { uid, rec, peer, prevOwner:
  author.ents.get(uid), since: now, noVhSince: null })` (one vehicle per owner; a second
  take releases the first).
- **Parking**: in case `e+` (`:479-492`), when `a.isVehicle(key)` and the owner holds
  custody for the same key: skip the `R.build` (paused) check (her car must come back even
  if building was paused meanwhile); keep every other check (uid range, key, data size).
  If `canPlaceEntity` fails, `a.parkVehicle(rec)` searches nearby (bounded, §5.6) with the
  same uid. On success: drop the custody and set `author.ents[newUid] = prevOwner` (a
  vehicle **keeps its owner when moved**: a friend's kart stays hers after Lily drives it,
  Lily's car stays Lily's after a friend borrowed it with "Friends can change my things"
  on). The touch rule stays: the record goes back to her in the same batch as the ack.
- **Releasing** (`_releaseCustody`): place `rec` back where it was taken from through
  `a.parkVehicle(rec)` (journaled like any host change), set its owner back to `prevOwner`,
  toast the host **"{name}'s {noun} went back to its spot."** Triggers:
  1. `_freeSeat` (seat hold over, `:190`, `:319`), `kick` (`:281`), `_reclaimSeat` (her
     page reloaded, `:332`), `stop()` (`:151`, before the final save);
  2. `_readPeers`: she is present but her presence has no `vh` with `src === uid` for 10 s
     and her outbox (`ob`) holds no unprocessed `e+` of that key (her drive ended without a
     park: a resync, a dropped page, a refused `e+`);
  3. the custody uid exists again (an Undo building restored it): just drop the entry;
  4. `undoSeat` (`:833`): drop that owner's entry after the revert.
- **Saves**: the host's world saves (every 15 s while hosting, §5.12 `HOST_LOCAL_SAVE`, and
  at the end) include every custody record in `systems.vehicles.away` (via
  `game.net.custody()`), so a crash of the host's page mid-session still keeps the car:
  the next load parks it at its spot. `makeSnapshot` leaves `systems.vehicles` out.
- **The host drives**: no custody (her own page); others see `vh` under her avatar; her
  park restores the owner through `ownerToken` / `restoreOwner`.
- **Fake adapter / Node tests**: `isVehicle` / `parkVehicle` are optional (`a.isVehicle?.`),
  so the existing property test runs unchanged.

### 8.5 What changes in the contract (MULTIPLAYER.md edits)
- §5.4: add `vh`. §7: a **Vehicles** row (parked: journal `E` records, `e+ e- er` from
  friends; driving: presence `vh`; custody on the host). §8.1: the custody notes on `e-` /
  `e+`. §8.2: "a vehicle keeps its owner when driven and parked again". §9: the hooks of
  §3.2. §15: the tests of §10.

### 8.6 Rates and sizes
A drive or park is one entity op (≤ 120 B, §5.3 table). Honks ≤ 1.7 presence sends per
second at worst. Nothing new in `sw.op` beyond normal entity records. Rate limit "entity
ops 20/s" (§5.12) is never approached.

---

## 9. Performance (2019 iPad budget, DESIGN.md §2)

| item | cost |
|---|---|
| Driving physics | ≤ 4 sub-steps × (≤ 3 probe tests + 1 climb test) + 3 support tests + 1-2 turn tests ≈ 20 `overlap` calls per frame, each ≤ 27 voxel reads plus one pass over `game.colliders` (a few hundred boxes): well under 0.2 ms. |
| Live vehicle draw calls | body (atlas) 1 + glass 1 + 2 axle parts (or propeller / paddle / sail) + lights 2 (only when on) = 3-6. |
| Parked vehicles | car and van bodies merge into the furniture batches (0 extra); glass +1 each; boats +2-3 each (bobbing hull part). |
| Friends' vehicles | ≤ 3 × 3-6 draw calls, hidden beyond 64 blocks; matrix updates only; no audio except honks. |
| Wake | 1 draw call per boat on screen; particles ≤ 25 per second from the pool (≤ 800). |
| Lights | no new lights (borrows 1 of the 4 pooled), no shader recompiles. |
| Audio | one engine voice (2 oscillators + 1 noise source + filters) while driving; `setTargetAtTime` only when speed changes by > 2%. |
| Allocations | none per frame (scratch vectors, ring buffers, pooled particles). |
| Park search | only at Get out, auto-park and saves (cached 1 s); ≤ 588 `canPlace`. |
| Bundle | ~9 models × ~250 lines + ~1,500 lines of logic ≈ 45-60 KB minified (~12-15 KB gzip) on a 2.3 MB file (`dist/sparkle-world.html`). |

Quality: nothing is lowered; `quality: 'low'` keeps working as today (it halves pixel ratio
and particles, DESIGN.md §2).

---

## 10. Tests

### 10.1 `tools/test-vehicles.mjs` (Node, no browser, seconds)
Imports `drive.js`, `park.js` and `src/world/physics.js` over a fake world (`Uint8Array`
blocks + a `registry.props` with `solid`, `shape`), like `tools/net/fake-adapter.mjs` does
for net.
1. **NaN / Infinity**: set `pos.x = NaN`, `yaw = Infinity`, `speed = NaN`, `move.x = NaN`
   on alternate steps; after every step all values are finite and the pose equals `good` or
   a free pose; `nanResets` counts them.
2. **Bounded**: 20 seeds × 2,000 random steps in random worlds (walls, pits, 1- and 2-block
   steps, water, enclosed 1×1 holes, the world edge), random controls and `dt` in
   [0, 0.05] incl. 0: each `step()` returns in < 2 ms and the vehicle is never inside a
   solid at the end of a step; land vehicles never end in water; boats never leave water.
3. **Climb / fall**: a 1-block step is climbed at 2 b/s (y +1 ± 0.01 within 1 s); a 2-block
   wall stops it (speed 0, one bump); driving off a 1-block ledge lands 1 lower.
4. **Park spot**: `findParkSpot` result always passes `canPlace` (fake), rot ∈ 0..3,
   integer anchor; returns null in a sealed box after ≤ 588 checks (counted).
5. **Source check**: no `while (` in `src/things/vehicles/*.js` (read the files, regex).

### 10.2 `tools/test-net.mjs` additions (`npm run test:net`)
- `vehicles: presence vh` — `parseVehiclePresence` accepts good arrays, rejects text,
  unknown keys, bad colors, deep or huge values; `avatarFields` sends `vh` only on change;
  a host presence with `vh` stays ≤ 3,900 B.
- `vehicles: custody` (FakeAdapter, seat 1, careful mode):
  1. the friend's `e-` of her own `kart_test` → custody held; host pauses building; her
     `e+` of the same key with her uid → accepted, owner hers, custody gone;
  2. while paused, an `e+` of a vehicle without custody → code 3 (unchanged rule);
  3. take, then `_freeSeat` → the kart is back at its spot with its uid and its owner;
  4. take, then `stop()` → back before the final save; `custodyRecords()` listed it until
     then;
  5. take, then 10 s of presence without `vh` (fake clock) → back; with an `e+` still in
     `ob` → not released;
  6. `mine = 1`: she takes the host's car and parks it → new uid in her range, owner still
     0 (the host);
  7. `undoSeat` after take + park → the host's car is back at its old spot, no custody left;
  8. the property test (§15.1) still passes unchanged (no vehicles in it).

### 10.3 `tools/probe-vehicles.mjs` (browser; `npm run probe:vehicles`)
Same harness as `tools/probe-outdoor.mjs` (imports `launch, openGame, startWorld, waitIdle,
shot, settle, finish, screenPoint` from `tools/smoke.mjs`; real clicks / taps for what she
does; the debug API to read results). Chromium at `/opt/pw-browsers/chromium` with
`--use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist`
(`smoke.mjs:18-19`). Passes (`--only=land,water,touch,models,save,mp`):

`game.debug.vehicles` (new): `list()`, `state()` → `{ key, x, y, z, yaw, speed, onGround,
water, lights, bumps, nanResets, src }`, `drive(uid)`, `park()`, `honk()`, `corrupt(field)`
(test only: writes NaN into the live state), `drop()` (test only: end the drive without
parking, to test custody rule 2).

- **land** (desktop 1280×800, `flat` biome with a built test course):
  Bag → **Cars & Boats** → Convertible → color 2 → click the ground → one entity with that
  color, nose away from her; Hand → click it → `player.state === 'ride'`, mount kind
  `vehicle`, the entity is gone, `'vehicle:drive'` fired, **Beep Beep!** earned; hold W
  1.5 s → moved ≥ 4 blocks along its nose; A → yaw changes; S → moves backwards; a 2-high
  wall → stops in front of it (never inside: `bodyBlocked` false), `bumps ≥ 1`; a 1-block
  step → `y` up by 1 ± 0.05; off a ledge → down 1; toward a pond → stops on the shore, the
  toast "Cars can't swim!" shown, center column never liquid; Space → `'vehicle:honk'`
  and the audio `started` count rises; L → lights flag on; `setTime(0.9)` → lights on by
  themselves, pooled light borrowed (`E.lights.some(l => l.intensity > 0)`); E → parked:
  entity back with an integer anchor and rot ∈ 0..3, `canPlace` true for it (ignoring
  itself), `player.state === 'walk'` and not overlapping it; the history length is the same
  as before the drive (no Undo entries); then Remove + Undo of the parked car works;
  `corrupt('x')` → next frame finite, `nanResets === 1`, `info().fps > 0` and no page error;
  draw calls while driving minus parked ≤ 8 (`debug.info().calls`); the `systems` stage
  average over 120 frames while driving ≤ idle average + 1.5 ms (`game._stageTimes`).
- **water** (`beach` biome): click the lagoon with the Speedboat → entity in the top water
  cell, all bottom cells liquid; Hand → drive; W 2 s → moved, `y === waterY` (± bob), wake
  visible (ribbon mesh visible, splash particles emitted); drive at the shore → stops, the
  boat's probe columns are all water, "Boats stay on the water!"; Get out near the shore →
  boat parked on water, she stands on sand; far from shore: first tap → the "Drive to the
  shore" toast and still driving, second tap → parked, she swims; Swan Boat and Sailboat
  drive 1 s each; a Convertible clicked on water → "Cars go on land!"; a Speedboat on grass
  → "Boats go on water!"; **Ahoy!** earned.
- **touch** (iPad 1024×768, `hasTouch`): Bag tab and item by taps; place the Safari Jeep;
  Hand tap → driving; the joystick dragged with CDP `Input.dispatchTouchEvent` (as
  `tools/probe-menus.mjs:429-445`) → moves forward; the Jump spot shows **Honk** (label
  text), Jump and Fly hidden; **Get out** and **Lights** visible in the life column, their
  boxes not overlapping the joystick ring or the hotbar; tap Honk → honk event; tap Get out
  → parked. Screenshots `.shots/vehicles-hud-*.png` at 1024×768, 768×1024, 390×844 and
  844×390: nothing clipped, nothing shows through the open Bag (the smoke rule).
- **models**: all 9 placed in a row (debug place), `items.iconFor` gives a non-empty data
  URL for each, one picture `.shots/vehicles-fleet.png` by day and one at night with lights;
  parked draw calls for the 6 land vehicles ≤ 6 above an empty world (they batch).
- **save**: drive the Road Trip Van 10 blocks, `debug.save()` while driving, reload the
  page → the van is parked near where she was, she stands beside it (not inside), the van's
  uid is the one she drove; `flushSave({ unloading: true })` path: dispatch `pagehide`,
  reload → same; an old fixture save (no `systems.vehicles`) loads with 0 page errors.
- **mp** (two contexts with `FakeClaudeHub` + `NetHub`, the setup of
  `tools/probe-multiplayer.mjs:60-100`, helpers from `tools/net/mp-flows.mjs`; Lily host
  desktop, Rosie guest iPad):
  1. Lily places a Convertible; Rosie (careful mode) taps it → "That's Lily's car!" and it
     is unchanged on both pages;
  2. Rosie places her Go-Kart and drives it → on Lily's page a vehicle model sits under
     Rosie's avatar (`remotePlayers.list()[0].vehicle === 'car_kart'`) and the parked kart
     is gone on both; Rosie honks → Lily's page plays it;
  3. Lily pauses building; Rosie parks → accepted (custody), kart on both pages, hashes
     equal (`debug.net.hash()`), 0 resyncs;
  4. Rosie drives again, then `debug.vehicles.drop()` → within 12 s the kart is back at its
     spot on both pages;
  5. Rosie drives again, Lily sends her home (`kick`) → the kart is back on Lily's page;
  6. "Friends can change my things" on; Rosie (back in) drives Lily's Convertible; Lily's
     page reloads (**Keep playing**) mid-drive → after the reload Lily's world has the
     Convertible (custody saved in `systems.vehicles`);
  7. Lily drives; a third page joins → its snapshot has no parked copy of Lily's car;
     Lily parks → it appears on every page;
  8. AT14 / AT15 style budget check (`probe-multiplayer.mjs:118-128`): ≤ 80 sends per
     second, no message or presence over 3,900 B, no refusals; zero console errors on all
     pages.

### 10.4 Existing suites that must stay green (the build Railway ships)
`npm run smoke`, `npm run test:net`, `node tools/test-walkie-unit.mjs` +
`npm run test:walkie`, `npm run probe:railway`, `node tools/probe-net-ux.mjs`,
`node tools/site-check.mjs`, `node tools/probe-keepsafe.mjs`, `node tools/probe-shops.mjs`,
`npm run probe:mp`, `npm run test:accounts`, `npm run test:billing`, `npm run test:saves`,
`npm run e2e:accounts`. Because shared files change, also run the probes of the teams whose
code paths are touched: `probe-life.mjs` (horse riding: `player.mount`), `probe-outdoor.mjs`
(zip line `hold` / `stand`, camera assist), `probe-furniture.mjs` (`entities.js` lights
pool, pool float), `probe-menus.mjs` (joystick label, keyboard help).

---

## 11. Optional extras

- **A pet in the passenger seat (cheap, solo and host only; stretch goal).** On drive, the
  nearest following pet within 6 blocks that is not big (`!spec.rideable`, the pony/horse
  stay home) hops into `def.vehicle.passenger`: `pets.js` gets `pet.passenger = handle`;
  `Pet.update` skips the AI while it is set and the vehicles system writes its position and
  yaw each frame (like `syncRider`, `pet.js:639-650`), pose `sit`. On park the pet hops out
  beside the door. On a host the pets' actor samples already carry the position to friends
  (`docs/MULTIPLAYER.md` §9.7-9.8). About 40 lines in `pets.js` / `pet.js` plus a probe check.
  Not on guests (pets are the host's puppets there).
- **NPC friends driving: not cheap.** Their AI (`src/things/friends/friend.js`), their actor
  sync (`kind: 'npc'`) and seat logic would all need vehicle states; leave for later.
- **Ice Cream Van that also opens the shop** when parked: a second action would need a
  choice bubble (Hand-tap runs only `actions[0]`, `entities.js:804-806`). Open question.

---

## 12. Build order (one session)

Each step ends with its own checks; commit nothing until step 10 passes. **Do not push
before every suite in §10.4 is green: Railway deploys every push.**

1. **Shared hooks** (§3.2): `entities.js` (`export rotXZ`, `extraLights`), `player.js`
   (generalised `mount`, pose, `_onKey`, `beforeStand`, `overlapsCell`, `serialize`),
   `camera.js` (`extra`, `headY`), `hud.js` + `icons.js` (Honk swap), `pets/kit.js`
   (`lights` icon), `touch.js` (label), `inventory.js` (tab color / picture),
   `game.js` `DIRTY_EVENTS` (+ `'vehicle:park'`), `main.js` (install). With no vehicle in
   play these are inert. Run `npm run smoke`, `probe-life.mjs`, `probe-outdoor.mjs`.
2. **Defs and models**: `defs.js`, `kit.js`, the three model files, `E.define` + Bag tab +
   placement `use` overrides in `index.js`. Look at the fleet picture (`--only=models`),
   by day and night; check thumbnails in the Bag.
3. **`drive.js` + `park.js` (land) and `tools/test-vehicles.mjs`** first in Node: NaN,
   bounded, climb, park spot. Then the `drive` action, the system update, auto-park,
   chase camera, HUD buttons, keys. `--only=land`.
4. **Boats**: water rules, bob, wake (`fx.js`), shore get-out. `--only=water`.
5. **Lights and audio**: `fx.js` headlights, `extraLights`, `sfx.js` (engine, horns, boing,
   jingle), honk rate limit.
6. **Saves**: `systems.vehicles`, `standSpot`, `deserialize` + unstick. `--only=save`.
7. **Touch pass**: `--only=touch` on all four screen shapes; fix layout overlaps.
8. **Multiplayer**: `protocol.js` parser, `adapter.js` (`vh`, snapshot strip, `isVehicle`,
   `parkVehicle`), `host.js` (`avatarFields`, custody), `facade.js` (`rules`, `refuse`,
   `custody`, owner tokens), `remote-players.js` (draw, pose, honk), guest checks in
   `index.js`; `fake-adapter.mjs` + `test-net.mjs` tests; `--only=mp`;
   `npm run test:net`; `npm run probe:mp`.
9. **Stickers and docs**: `stickers.js`; DESIGN.md (§1 activity row "Drive | Bag → Cars &
   Boats → place it, Hand-tap: drive, honk, lights, Get out"; stickers `beep_beep`, `ahoy`;
   §2 events; Player `mount(m)`; Entities `def.vehicle`; Save formats `systems.vehicles`;
   Bag tab `vehicles`; a new §6 "Wave 3: cars, vans and boats" pointing here); MULTIPLAYER.md
   (§8.5 list); update this file's status to "as built" with anything that changed.
10. **Gate**: `npm run build`, then every suite in §10.4 plus `npm run probe:vehicles` and
    `npm run test:vehicles`; zero console errors; commit source + `dist/` together.

---

## 13. Risks and open questions

**Risks**
1. **Reusing `'ride'`**: any future code that assumes `player.mountPet` is a pet will see a
   vehicle. Mitigation: `m.kind`, the `mounted` getter, and a comment at `player.js:31`.
2. **`host.js` is the net core** (unit-tested against a fake adapter). The custody rule is
   small and optional on the adapter, but it is new authority logic: it gets its own unit
   tests (§10.2) and the existing property test must pass unchanged.
3. **Square probes** let a nose touch a wall by up to ~0.25 blocks at diagonal headings
   (picture only, never stuck). Acceptable for a kid game; a rotated-box test would cost
   much more code.
4. **Railway rollback**: an older build drops vehicles from any world it saves again (it
   skips unknown furniture keys, `entities.js:891`). Only matters if a deploy is rolled
   back after she built with vehicles.
5. **Guest pre-check is a guess** for vehicles of other friends (only host-range uids are
   refused up front); a refused one shows a short drive and then the parked car again,
   with the net layer's usual "That's someone else's!" toast.
6. **Parked boats are not batched** (bobbing parts): a world with 20 boats adds ~50 draw
   calls. If that shows up, stop the bob beyond 32 blocks and merge far boats (later).
7. The shop's **Ice Cream Truck** (a counter you buy from) and the drivable **Ice Cream
   Van** can be confused. Names differ on purpose; see question 2.
8. **E key** both gets out and does its usual Hand switch (`game.js:1387-1389`), exactly as
   with the horse today.

**Open questions for the family**
1. Should friends be able to drive the host's cars when "Careful players" is on? (Designed:
   no, only with "Friends can change my things"; they can always bring their own from the
   Bag.)
2. Should the parked Ice Cream Van also open the ice cream shop (a choice bubble "Drive /
   Buy ice cream")?
3. Speeds: is 8.5 for the go-kart fun or too fast for her? (All speeds are in one table.)
4. The pet in the passenger seat (§11): include it in this wave?
5. Getting out on open water: swim (designed) or should the boat glide to the shore by
   itself?
6. "Boys characters" from the same message: handled by the avatar / pals teams, not here.

---

## Integrator decisions (binding; they override anything above that disagrees)

Settled before building, together with docs/teams/wave3-critique.md (apply every BLOCKING item V-B1..V-B5 and P-B1, and every vehicles/both improvement there):

1. **Friends and the host's cars:** as designed. In careful mode a friend cannot drive the host's vehicles (friendly toast); with "Friends can change my things" on, she can. Friends can always bring their own from the Bag.
2. **Ice Cream Van:** drive only in this wave (its horn plays the jingle); it does not open the shop.
3. **Speeds:** use the table as designed (one table, easy to tune later).
4. **No passenger pet in this wave** (stretch goal dropped; pets.js belongs to the boys builder except nothing).
5. **Getting out on open water:** as designed (tap Get out twice: she hops out and swims; the boat floats where it is).
6. **Honk is Space and the Honk button only** (KeyH opens Help, V-B2). Get out with E or X must win over the game's E interaction while driving.
7. **Never delete a vehicle** (V-B4): when no spot fits, place it with {force:true} at its record.
8. **Build and Remove are off while driving** ("Park first to build!").
9. **Seat the rider after the vehicle moves** (V-B1), the way pet.syncRider does.
10. **Files you own / must not touch:** follow the critique's SHARED list. Vehicles owns game.js (the DIRTY_EVENTS line only), player.js, camera.js, entities.js, hud.js, touch.js, main.js, adapter.js, host.js, facade.js, remote-players.js (the boys builder adds one `lk: f.lk` line in list(); keep it if you see it), the new src/things/vehicles/. In protocol.js add only VEHICLE_KEY_RE / parseVehiclePresence after the existing constants; refusal texts go in facade.js. Do not edit site/*, avatar/wardrobe/dress-up/friends files, codec.js, or the MESSAGES block. Your tests in test-net.mjs go in a separate block at the end.
11. **Never push; never commit dist/*.** Commit source, docs and tests to your worktree branch often (end each commit message with the two attribution lines the integrator gives you). The integrator merges, rebuilds dist and runs the full gate once.

---

## As built (wave 3 build)

Built on `worktree-wf_d6bdfde8-016-2` from `cfb5e7c`, following the build order and the
integrator decisions above. What differs from the design, and why:

**Files.** As in §3.1, plus `src/things/vehicles/live.js` (`LiveModel`: the live model with its
pivot / tilt / model groups, wheel, propeller, paddle and sail parts and the headlights; shared by
the car she drives and friends' cars in `remote.js`). `defs.js` is pure data (Node imports it) and
keeps its own copy of the shops' `TRUCK_COLORS` (same six swatches). `tools/fixtures/old-world-96565e4.json`
is a world and profile saved by the build before vehicles (a bed, a lamp, a pool float on water, a
puppy, a horse she rides while it saves, an NPC friend), loaded by `probe-vehicles --only=save`.

**Shared files** (the critique's list, nothing else): `game.js` only gains `'vehicle:park'` in
`DIRTY_EVENTS`; `protocol.js` only `VEHICLE_KEY_RE` and `parseVehiclePresence` (the adapter's
optional `isVehicle` / `parkVehicle` / `vehicleNoun` are documented in `adapter.js`, not in the
typedef); refusal texts are in `facade.js`.

**Controls.**
- Honk: Space and the Honk button only (`KeyH` stays Help, V-B2). Space honks on the key itself
  (a tap can come and go between two frames) and the 'jump' press it makes counts as the same
  honk; the button presses 'jump'. Honks at most every 0.6 s. The keyboard help card lists Space
  (Honk in a car), L (Car lights), E or X (Get out of a car).
- E or X get out and win over the game's E: while she drives the tool is held on Hand (a
  `tool:change` listener registered on `game:ready`, after the HUD's, switches back to Hand with
  "Park first to build!"), so the game's E only switches to Hand and never interacts. This is also
  how Build and Remove are off while driving (decision 8) without touching `game.js`.
  A desktop right-click, a Remove stroke and Undo do not go through the tool, so
  `game.removeTarget()` and `game.undo()` refuse while `game.isDriving()` with the same note
  (wave 3 fixes; Undo would otherwise use up the car's own Bag placement entry). A block built
  into the car is still refused by `player.overlapsCell`.
- Hand taps while driving work as usual: a chair or a bed auto-parks the car where it is.

**Physics.** As §5 with V-B3 applied: "no support" is the finite `y - 1.2`, picture values are
zeroed when broken, only the pose restores `good`. Water ahead is checked at the bumper's centre
and corners, at the wheels' level and down to 4 cells below them until ground (a pond past a small
ledge counts). The shore / pond toast also shows while a boat glides along a shore or a car along
a pond (the straight move was refused even though a slide went on); boats splash at the shore, only
cars boing at walls. `step(dt, { mx, mz, camYaw })` takes the raw controls (Node tests drive it).

**Boats.** Get out near land steps her onto DRY land only (`_shoreSpot`: 49 columns x 4 heights,
never the lagoon floor under shallow water, which the player's `findStandSpot` would accept).
Parked boats bob through `def.update` turning the 'hull' part about its middle at the waterline.

**Never lost (V-B4).** Get out: the bounded search (588 checks); "No room to park here!" only for
a button / key. Every other path (stood up, auto, trouble, saves, loading) falls back to: its old
spot, the extended search here, the extended search round its old spot, then `force: true` at its
old spot (or here, on whole cells). `placeRecord` checks the uid is free first (critique item 4) and
leaves a record that is already there (a save made twice) alone.

**Multiplayer.**
- Custody starts only when the friend's presence `vh` (sent in the same state as her `ob`) names
  the removed vehicle's uid. A plain Remove of a vehicle (no `vh`) is a removal, not a drive; the
  design's 10 s rule would otherwise have put a removed car back.
- A visiting player who may not build (free-join, ACCOUNTS §8.6: the relay drops her `ob`) is
  refused up front: "You're visiting Lily's world! Look around and have fun." (facade kind 'look').
- Host `stop()` releases custody before the hooks come off (critique item 6); the host's own drives
  keep the owner through `net.ownerToken` / `net.restoreOwner`.
- The race (two players tap one car) uses `remote-players.vehicleOf(src)`: the lower seat keeps it.
  The host follows the same rule (wave 3 fixes): a later `e-` for a car already in custody moves
  the custody to the lower seat when her vh names it (careful mode: only to its owner from
  before), and `_watchCustody` hands it to another seated friend whose vh names it when the
  holder lets it go. test-net covers both arrival orders.
- Cars refuse a drop into water up to 32 cells below the bumper (it was 4: a higher cliff over a
  pond gave a fall-and-snap-back loop), and a fall into water closes that edge while she stays
  within 3 blocks of it (`Drive.wetEdge`). Boats take their room above the water from
  `body.clearance` (Sailboat 3.9 for its mast, others 1.85).
- Known limitation: if the host's page reloads while a friend drives a car that is NOT in her own
  uid range (mine = 1), the host's world brings the car back from `systems.vehicles` and her later
  park adds a second copy (nothing is lost; one copy can be removed). Her own cars park with their
  own uid and replace the restored record.
- Known limitation (deferred from the wave 3 review): a host's car that a friend drove and parked
  while "Friends can change my things" was on keeps the host as its owner but gets a uid in the
  friend's seat range. If the host later turns careful mode on, the page's own pre-check (uid
  below 10⁶) lets that car through: the drive starts, the host refuses it (PROTECTED) and the
  car snaps back with the general "That's someone else's!" note instead of "That's Lily's car!".
  Nothing is lost. The clean fix needs the host to tell the pages who owns out-of-range cars, or
  a park that keeps the car's host-range uid (a protocol change), so it waits for a later wave.

**Not done (left out on purpose).** The passenger pet (decision 4) and NPC friends driving (§11).
The Build / Remove HUD buttons are not dimmed while she drives (they answer with the toast).

### Test results (this worktree)

Run one suite at a time (SwiftShader Chromium; another builder's browser ran alongside):

| suite | result |
|---|---|
| `npm run test:vehicles` | 8 passed, 0 failed (NaN, cliff 1b, 40,000 random steps p99 < 0.02 ms, boats 20,000 steps, climb / wall / ledge / shore, park spots and the 588 bound, no `while`) |
| `npm run test:net` | 61 passed, 0 failed (unit incl. the two vehicle tests, 20 property seeds, server, accounts, ws property) |
| `npm run probe:vehicles` | 102 checks, SMOKE PASSED, zero console errors (land, water, touch, models, save, mp). The first full run failed one check (driving draw calls 10 > 8, measured from two different camera views); the probe now measures both from one fixed camera (7). |
| `npm run smoke` | passed (17 checks) |
| `probe-life` / `probe-outdoor` / `probe-furniture` / `probe-menus` | 63 / 52 / 52 / 77 checks, passed |
| `probe-shops` / `probe-keepsafe` / `probe-net-ux` / `site-check` | 93 / 79 / 32 / 644 checks, passed |
| `npm run probe:railway` | 25 checks, passed |
| `probe-avatar` / `probe-pals` / `test-net-game` | 28 / 72 / 228 checks, passed |
| `node tools/test-walkie-unit.mjs` | all walkie unit tests passed |
| `npm run test:walkie` | 230 checks, 0 problems (third run). Twice it failed 3-5 timing checks (the 15 s cap ring, a tap on a sliding Settings panel) while the machine's load was 8-12 on 4 cores; the build before vehicles passed then, and this build passed all 230 once the load dropped. |
| `npm run e2e:accounts` | 84 checks, 0 problems (third run; the first was cut by a time limit, the second timed out tapping the grown-up keypad under the same heavy load) |
| `npm run probe:mp` | 24 tests PASS (AT1-AT22, END), 196 checks, 0 failed |
| `npm run test:accounts` / `test:billing` / `test:saves` | 107 / 104 / 32 passed, 0 failed |
