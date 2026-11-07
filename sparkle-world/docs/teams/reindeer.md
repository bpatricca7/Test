# Team "reindeer": reindeer pets, the pasture herd and the flying Jingle Sleigh

Wave 5, plan section 7.7 (`docs/teams/wave5-plan.md`). Branch `wave5/reindeer`.

Everything here is our own design and our own names. The reindeer have plain cozy names
(Snowberry, Pinecone, Flurry, Hazel, Bramble, Aspen, Clementine, Juniper). Every coat has a dark
nose, and no nose glows. `tools/test-reindeer.mjs` (R3) checks the code and this doc against
`tools/lib/name-scan.mjs` and a list of famous holiday names. That list is kept encoded, so the
names are never spelled out anywhere.

## 1. What she gets

- **A reindeer pet** (Bag → Pets → Reindeer, last in the list).
  - Six coats: Cocoa, Snowy, Caramel, Chocolate, Frost and Rosy.
  - Branching antlers with round tips, a cream chest ruff, a white tail flash and a dark nose.
  - A holiday saddle blanket with gold bells, and a bell collar in the coat's accent colour.
  - Pet, feed (a carrot) and ride it like the pony (gait `trot`, trick `rear`).
- **Flying, but only in Holiday Village.** While she rides a reindeer there:
  - Jump takes off and climbs; Down (Shift / C / the Land button) comes down.
  - With nothing held it glides down gently and lands on its hooves. It never falls.
  - Elsewhere the reindeer hops like the pony.
  - The flight is the unicorn's flight in `pet.js`: the spec's `flies` is a getter that asks the reindeer module's sky check.
  - A stardust ribbon trails behind any flying reindeer, with gold sparkles and a soft jingle.
- **A pasture herd.** The world feature `holiday:reindeer` places 1-4 friendly reindeer as home-mode pets. She can tap one to pet, feed or ride it.
- **The Jingle Sleigh** (Bag → Cars & Boats → Jingle Sleigh, last in `VEHICLES`).
  - The look: red and gold, with curled runners, gold scrolls, a star on the back, presents behind the seat and two lanterns.
  - Four reindeer in harness, in two rows, all part of the one model. They gallop on the ground and tuck their legs in the air.
  - Its horn is sleigh bells, and a stardust trail with sparkles follows it in the air.
  - It drives like a car. Jump / Honk takes off and climbs, Down comes down, and with nothing held it glides down slowly and touches down softly.
  - Over water it hovers and never lands.
  - Friends see it fly.

## 2. Keys, ids, events, records

| What | Id / key |
|---|---|
| Pet species | `reindeer` (appended last to `SPECIES` and `BUILDERS`) |
| Coats (variants) | `cocoa`, `snowy`, `caramel`, `chocolate`, `frost`, `rosy` |
| Vehicle | `sleigh` (appended last to `VEHICLES`; kind `sleigh`, horn `bells`, `flies: true`) |
| System | `reindeer` (`src/things/reindeer/index.js`; installed by `main.js` after vehicles and pets) |
| Facade | `game.reindeer`: `canFly()`, `flying()`, `land()`, `herd()`, `placeHerd(rec)`, `placeSleigh(rec)` |
| Debug | `game.debug.reindeer`: `sky(on)` (true / false / null forces the sky check), `state()`, `herd(x,y,z,n)`, `sleigh(x,y,z,rot)`, `land()` |
| Vehicle facade additions | `game.vehicles.flying()`, `canFly()`, `land()`; `pose().flying`; debug `takeOff()`, `land()` |
| Stickers | `reindeer_friend` (pet a reindeer), `reindeer_rider` (ride a reindeer), `sleigh_ride` (fly the sleigh) |
| Events | `reindeer:herd` {n,x,y,z}, `reindeer:fly` {pet}, `reindeer:land` {pet}, `sleigh:takeoff` {key}, `sleigh:land` {key, airTime} |
| Feature records | `holiday:reindeer` {x,y,z,n} (n 1-4, default 2) and `holiday:sleigh` {x,y,z,rot} (rot 0-3) |
| Profile key | `profile.reindeer` = {coinDay, coinMask, petted, rides, flights, sleighFlights}, always read through `logic.state()`, which creates and cleans it |
| Sounds (pets `sfx`) | `reindeer` (voice), `jingle` (happy), `sleighbells` (the sleigh's horn) |
| Icons (`pets/kit.js` PATHS, at the end) | `rd_land`, `rd_head` |
| HUD | life-column button `rdland` ("Land", order 2), shown only while she is in the air |
| CSS prefix | `rd-` (none needed so far) |

**The feature records are host only.** `features.js` never runs a placer on a guest.
- **Herd reindeer** are put in with `game.pets.deserialize([...])` in mode `home`. They are saved and synced exactly like her other pets, and no `pet:adopt` fires. They count toward the pet limit (12), and a record never places more than the room left.
- **The sleigh** is placed with `game.vehicles.placeRecord({key:'sleigh',...})`, at its spot, else nearby, else forced. A placed vehicle is never lost.

**Coins:** at most 5 a day, only through `game.coins.add(n, 'reindeer', {at})`.
- A reindeer's first flight of the day gives +2.
- The sleigh's first flight of the day gives +3.

Each is marked in `profile.reindeer.coinMask` for the day (`coinDay`, yyyymmdd local).

**Per-player listeners:** `pet:pet`, `pet:feed`, `pet:ride` and `sleigh:takeoff` each begin with `if (game.net?.remoteApplying) return;`.

## 3. Numbers

**Sleigh** (`defs.js`)
- Size 2×3×6, with two colliders: the body box and the team box.
- speed 7, reverse 2.5, accel 5, turn 1.9, cam 3.2.
- **flySpeed 9.5.** In the air it coasts to a stop at 1.2 blocks/s².

**Flight** (`FLY` in `drive.js`)
- **Speeds:** climb 4.2 blocks/s, dive 4.5, glide down 0.8, Land button 4. vy eases at 9 blocks/s².
- **Soft landing:** near the floor the descent is at most 0.45 + 1.5 × height.
- **Air move:** it hops over a step of up to 1.6 blocks. A wall stops it softly.
- **Floor scans:** two scans of 40 blocks each. Water counts as the surface + 0.7 (hover).
- **Ceiling:** pos.y ≤ world.sy + 1.
- **Never bad:** every number is checked (`sanitize`). The last good pose is restored when anything is non-finite or the body is ever inside blocks.

**Reindeer pet**
- speed 5, run 8.2, hop 8.8, seat 1.1, height 1.3.
- In the air it uses the unicorn's flight in `pet.js`.

**Herd**
- The reindeer stand within 3 blocks of the record's middle.
- Each one gets a free standing spot from `pets.findSpot`. Names and coats are a seeded shuffle, so a world always gets the same herd.

## 4. Files

| File | |
|---|---|
| `src/things/reindeer/logic.js` (new) | pure rules: sky check, herd count, spots, names, coats, coins, profile record |
| `src/things/reindeer/index.js` | the system: placers, stickers (canvas art), coins, Land button, rider-flight events, stardust ribbons, facade, debug |
| `src/things/pets/reindeer.js` (new) | the species spec and model; `setReindeerSky` |
| `src/things/pets/species.js` | `reindeer` appended (`// wave 5`) |
| `src/things/pets/fx.js` | `STARDUST` palette exported; `RainbowTrail` takes `{colors, width, life}`; textures cached per palette |
| `src/things/pets/sfx.js` | `reindeer`, `jingle`, `sleighbells` |
| `src/things/pets/kit.js` | `rd_land`, `rd_head` icons appended |
| `src/things/pets/ui.js` | "Pick a coat" for the reindeer picker |
| `src/things/vehicles/drive.js` | flight mode (only for a spec with `flies`, never a boat); every other vehicle ignores Up / Down |
| `src/things/vehicles/defs.js` | `sleigh` appended last |
| `src/things/vehicles/models-sleigh.js` (new) | the sleigh and its reindeer team |
| `src/things/vehicles/index.js` | the Up / Down controls, getting out in the air (lands first, parks on touchdown; refused over water), the bells horn, takeoff / landing sparkles and events, the trail, a water hint ("Hold Space / Honk to fly over the water!") |
| `src/things/vehicles/live.js` | gallop / tuck animation of the team |
| `src/things/vehicles/remote.js` | friends' sleighs: a guessed airborne state, trail and sparkles |
| `tools/test-reindeer.mjs` (new) | Node-only tests |

## 5. How to test

```
node tools/test-reindeer.mjs        # 11 tests
node tools/test-vehicles.mjs        # must stay green (11)
node --test tools/test-name.mjs
```

**Tests in `tools/test-reindeer.mjs`**
- **F1:** take off, climb, glide, soft landing.
- **F2:** random worlds and random sticks, with Up and Down. It is never inside blocks, never out of the world and never NaN.
- **F3:** landing on a cliff, into a pit and under a ceiling. Over water it hovers and never lands.
- **F4:** walls in the air; a low fence hopped over.
- **F5:** NaN injected mid-flight; a roof blocks takeoff; Land.
- **F6:** every other vehicle drives the same path with or without Up / Down.
- **F7:** the sleigh def: last in the list, colliders inside its size, park spots fit.
- **R1:** the species.
- **R2:** herd spots, names, coins and the profile.
- **R4:** the module on a fake game: herd, sleigh, stickers, coins and flight events.
- **R3:** no `while` loops and no famous names in our files and this doc.

**In the game (browser console)**
- `game.debug.reindeer.sky(true)` lets a reindeer fly anywhere.
- `game.debug.reindeer.herd(x,y,z,3)` places a herd.
- `game.debug.reindeer.sleigh(x,y,z,0)` places a sleigh.
- `game.debug.vehicles.takeOff()` and `game.debug.reindeer.land()` take off and land.

## 6. As built

- The sleigh's flight lives in `drive.js` as a mode that only `flies` specs enter. Ground driving is unchanged, which F6 proves.
- Takeoff needs room: the body must fit 0.25 blocks higher.
- In the air the drive moves in sub-steps:
  - it slides along walls and hops low things;
  - it finds the floor with two overlap scans;
  - it eases the vertical speed and slows near the floor.
- It lands only on solid ground, never in water. The floor counts as water only when the water is the highest thing under it, so a sleigh with its tail on a bank and its nose over a pond lands on the bank (F3) instead of hovering on the shore.
- Getting out in the air never drops her. The sleigh lands first and parks when it touches down. Over water she gets a friendly hint instead. Pressing Up again before it touches down cancels that parking.
- A ridden reindeer's flight (events, bells, the coin, the Land button) starts only after 0.6 s in the air, so a little drop is not a take-off. Riding a reindeer outside Holiday Village says once a session where reindeer fly.
- The reindeer pet's flight reuses the unicorn's flight in `pet.js` through a `flies` getter, so `src/things/pets.js` needed no change. A missing or throwing sky check means "no flying".
- Friends' copies guess "in the air" from whether the body has support (every 0.2 s). The height already comes through the normal pose.
- No browser was available in this container, so the models were checked with a scratch software rasterizer in Node. The sleigh, all six coats and the face were checked this way, and the Node tests cover the rest.

## 7. Wanted from the integrator

1. **Holiday Village biome** (`src/world/biomes/holiday.js`): emit `holiday:reindeer` {x,y,z,n} in a fenced pasture and `holiday:sleigh` {x,y,z,rot} near the square. Today the biome only names reindeer in its description. The herd and the parked sleigh appear once those records exist.
2. **`hud.js` / `touch.js`:** while she drives a flying vehicle, label the Honk button "Fly" with an up icon and show the virtual Down button. Today the Honk button also climbs (it is `input.jump`). Down is Shift / C on a keyboard, or the Land button on touch.
3. **Optional, protocol:** a flying bit in the presence `vh` record, so friends' sleighs know for sure instead of guessing.
4. **Optional, name scan:** add the encoded famous reindeer names (see R3 in `tools/test-reindeer.mjs`) to `tools/lib/name-scan.mjs` EXTRA, so every team is checked.
5. **Note:** herd reindeer count toward the 12-pet limit. A full pet list places fewer reindeer, or none.

## 8. Open questions

- Should herd reindeer be "visitors" that are not saved to her pet list? Today they are home-mode pets, synced and saved like any other.
- Should the pet stardust trail move into `src/things/pets.js` (owned by the pets team) so that guests draw it for friends' reindeer too? Today the reindeer module draws it for every flying reindeer it can see.
- The Land button holds the virtual Down until she touches down. If the HUD team adds a real Down button, the Land button could become a single tap.
