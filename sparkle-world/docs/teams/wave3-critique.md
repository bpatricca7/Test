# Wave 3 review: boys.md and vehicles.md checked against the code

Reviewed 2026-10-01 against `claude/girl-game-world-building-gp6bnl` @ `96565e4` (the commit both
plans cite). I checked every `file:line` the plans lean on. Most of them are right: the player ride
branch, `mount`/`stand`/`serialize`, `entities.place/remove/use/serialize`, `DIRTY_EVENTS`, the
system order, `avatarFields`, the `e+`/`e-` checks in `host.js`, the guest recorder, the look codec
and the list sizes. I measured today's worst-case look token at **147** chars and the list lengths
at 12/8/7/7/13/6/5/6/7/5, which match boys.md. The problems are below. **Blocking** means the plan
must change before anyone builds it.

---

## 1. Blocking

### Vehicles

**V-B1. The rider lags one frame behind the car.** `game._frame` runs `player.update` first and
the systems after it (`src/core/game.js:336`, `:341`). The camera runs after both (`:345`). The plan
puts the seat in the player's ride branch through `m.seatWorld(this.position)`
(`player.js:86-98`), which runs *before* the vehicles system moves the car. So the avatar and the
camera are always one step behind the car. That is 0.16 blocks at 60 fps and about 0.47 blocks at
20 fps on an iPad, so the avatar visibly slides out of the seat. Pets avoid this with
`syncRider()` after they move (`src/things/pets/pet.js:639-650`, called at `:697`).
**Fix:** after `step()`, the vehicles `update` writes `player.position`, `player.yaw` and
`avatar.group` the way `syncRider` does. Keep `seatWorld` in the ride branch only as a fallback.

**V-B2. `H` already opens Help.** `src/ui/touch.js:221` opens the Help panel on `KeyH` (or `?`).
The plan makes "Space or H" honk, so pressing H while driving would open Help and pause the game.
**Fix:** honk on Space and the Honk button only, and list Space on the keyboard help card.

**V-B3. A NaN in a picture-only value would freeze falling.** `Physics.overlap` returns
`top = -Infinity` when nothing is under a probe (`src/world/physics.js:39`). The plan's
`pitchVis = atan2(supportBack - supportFront, …)` becomes `atan2(NaN)` when both probes are over
air. `clamp(NaN)` stays NaN, and §5.7 then "restores `good`" **every frame**. Result: a car can
never drive off a ledge, it snaps back each frame, and `nanResets` fills up.
**Fix:**
- Treat "no support" as the finite value `y - 1.2`.
- Zero any non-finite *visual* value (`pitchVis`, `rollVis`, which §5.7 leaves out, and
  `liftVis`) instead of resetting the pose.
- Restore `good` only for a non-finite pose (`pos`, `yaw`, `speed`, `vy`).
- Add test-vehicles case 1b: drive off a 3-block cliff and check that `y` goes down and
  `nanResets === 0`.

**V-B4. "Back into the Bag" breaks "no losing items".** The audience rules say "no losing items"
(`docs/DESIGN.md:17-18`). §4.7 step 2 deletes the vehicle, with its color, when no park spot is
found. Loading a save already force-places entities (`entities.js:892`, `force: true`).
**Fix:** make the last resort `E.place(..., { force: true })` at the record the car was taken
from (or at the current pose, snapped to the grid). A vehicle is never removed.

**V-B5. The plan contradicts itself about `game.js`.** §3.2 ends with "Nothing changes in …
`src/core/game.js`", but §4.6 and build step 1 add `'vehicle:park'` to `DIRTY_EVENTS`
(`game.js:32-35`). Decision: vehicles owns this one-line edit, and boys does not touch `game.js`.

### Boys

**B-B1. Reordering `FRIENDS` changes the "Invite a Friend" picture.** §7 says to reorder the
array so girls and boys alternate. But `src/things/friends/ui.js:174` builds the Bag icon from
**`FRIENDS[3].look`**, and `friend.js:30` falls back to `FRIENDS[0]`. With the new order, index 3
is Kai, so the icon she knows changes. This breaks goal 2 ("girl's game unchanged") and the plan's
own append-only rule.
**Fix:** append the six boys at the end of `FRIENDS`. Add a separate `ROSTER_ORDER` key list for
the invite panel (`ui.js:429`) and pin the icon by key (`friendDef('<today's FRIENDS[3] key>')`).

### Both (process)

**P-B1. Nobody pushes until the merged build is green.** Railway deploys every push
(`railway.json` runs `npm run build`). The rules:
- Builders commit in their worktree branches and never push.
- Builders do **not commit `dist/*`**. `dist/build.json` and the two HTML files are tracked
  (`git ls-files dist`) and would conflict every time.
- Only the integrator rebuilds `dist` (and `npm run build:site`) once after the merge, runs the
  full gate (§4), and pushes once.

---

## 2. Improvements (do while building)

### Vehicles

1. **Bag tab.** `TAB_COLORS`/`TAB_PICS` are not enough. Splice `['vehicles', 'Cars & Boats']`
   into `ITEM_CATEGORIES` the way shops does (`src/things/shops/index.js:92-95`), placed after
   `shops`. Otherwise the nine items land under "More" (`src/ui/inventory.js:179-183`).
2. **Guest auto-park needs a written exception.** DESIGN.md §5 says "No `update()` mutates world
   state on a guest". Auto-park on a guest runs inside `update`, wrapped in `asPlayer`. Write it
   into MULTIPLAYER.md §9 as a named exception: only her own vehicle, only on her own state change,
   restored in `finally`.
3. **Turn off Build and Remove while driving** (toast "Park first to build!"). This removes a whole
   class of cases: blocks built into her moving car, and Magic Builds placed on top of it.
   `prefabs.js:315` `moveOut` **skips** riders, so a Magic Build would close her in. The plan's
   claim that prefab move-out "stands her up" is wrong.
4. **Check uids before placing.** Before `E.place(..., { uid })` from `away` or a park, check that
   `E.byUid(uid)` is empty; if it is taken, use `allocUid()`. `place()` overwrites `map` without
   checking (`entities.js:479`, `:497`), which would leave an orphaned model nobody can remove.
5. **Players who may not build.** For an account member without `canBuild`, the server drops her
   `ob` (`server/rooms.mjs:370`, `:477`), and no code in `src/` knows about `canBuild`. Her
   predicted `e-` would never reach the host, so the car would show twice until a resync. Confirm
   that `mayEdit('build')` is false on that page (ACCOUNTS §8.6), or refuse up front. Add an mp
   probe case.
6. **Host stop order.** In `stop()`, release custody **before** `this.a.detach()`
   (`host.js:160`). After that, `_hookEnt` returns early because `live` is false.
7. **E key.** `game.js:1388` makes E *interact with the target* when the tool is not Hand. While
   driving, E could sit her on a chair and park the car at the same time. Have the vehicles key
   handler run first and stop the event, or ignore `KeyE` targets while driving.
8. **Stickers.** Register them on `'game:ready'` the way `src/things/friends/stickers.js:94-98`
   does. `vehicles` installs before `life/stickers` (`src/main.js:49-51`).
9. **Physics gotcha.** `Physics._hit` is shared, and every `overlap()` call resets it
   (`physics.js:139` comment). Copy `top` and friends out of it before the next probe.
10. **Undo while driving** finds no entity and quietly uses up the "place" entry (`entities.js:503`).
    That is fine, but say so in the plan; Undo-related tests assume it.
11. **Old-save fixture.** `tools/fixtures` holds only `stripe`. Capture a real world and profile
    from `96565e4` now (with a horse ride, friends and a pool float on water) and load it in
    `probe-vehicles --only=save` and `test-saves`.
12. **The 10-s custody rule.** On iPad Safari a backgrounded tab drops the socket, the seat hold
    passes, and the car goes back to its spot. That is acceptable. Cover it in the mp probe with a
    hidden page.

### Boys

1. **The default name "Lily" for a boy.** NPC greetings fill `{name}` from `look.name`
   (`src/things/friends/chat.js:10`, `fill` at `:125-128`), so a boy who never typed a name hears
   "Hi Lily!". The plan only fixes the title. When `!nameSet && name === 'Lily'` and the look style
   is `'boy'`, use "friend" in `fill()`. Better: ask "What's your name?" once, the first time a boy
   look is picked (`net/ui.js:646` already has that dialog).
2. **Privacy of `profile.lookStyle`.** `'girl' | 'boy'` goes to the cloud (`stripProfile`,
   `server/saves.mjs:112-123`, keeps it). In child data that reads like a gender field, which
   goal 6 rules out.
   - Rename it to `surpriseStyle`.
   - Either keep it device-local (strip it like `net`), or list it in `docs/DATA-MAP.md:50` and in
     privacy.html.
3. **Legal pages.** The privacy.html and terms.html edits change legal wording while
   `server/notice.mjs` and the sign-in email still say "her" (Q1). Do the index.html wording now.
   Move privacy and terms into the same dad-approved legal pass as the notice, or get his OK first.
4. **Lily-Rose's line.** "Every girl is a princess!" → "Everyone can be royal!" changes an existing
   girl's line. Ask the dad, or keep it.
5. **probe-avatar grids.** The grids assume today's sizes. The outfits grid has 6-entry skin and
   hair arrays (`tools/probe-avatar.mjs:395`) and the hair grid has 12 colors (`:401`). Nothing
   breaks (it falls back to defaults), but extend the arrays so the new tiles are tested with
   varied colors.
6. **Codec tail.** Read `top.num` with `l.top ? l.top.num : 7`. `top` is always present after
   `normalizeLook` (`wardrobe-data.js:157`), but `packLook` failures are swallowed into
   `lk = ''` (`net/adapter.js:578-582`), which would silently give friends the default look.
   Assert this in test-net.
7. **Old-save fixture.** As in vehicles item 11: use a real profile from `96565e4` instead of only
   a hand-written literal (B11).

---

## 3. Files both builders touch (who owns what)

| File | Boys | Vehicles | Rule |
|---|---|---|---|
| `src/net/remote-players.js` | `list()` adds `lk` (`:235-242`) | `_ingest`, `_frame`, `_drop`, `list()` | **Vehicles owns.** Boys adds `lk: f.lk` as one new line at the end of the `list()` object. Vehicles rebases on it. |
| `src/net/protocol.js` | `MESSAGES` `:120`, `:121`, `:135` | `VEHICLE_KEY_RE` / `parseVehiclePresence` after `:216`, typedef `:420-488` | Boys owns `MESSAGES`. Vehicle refusal texts go in `facade.js refuse()` (like `'npc'`, `:209`), not in `MESSAGES`. |
| `tools/test-net.mjs` | edits the codec test `:129-157` | new tests | Boys owns the codec block. Vehicles adds its tests as a separate block at the end. |
| `package.json` | `probe:boys` | `probe:vehicles`, `test:vehicles` | The integrator resolves it (one line each). |
| `docs/DESIGN.md` | §1 Dress-Up `:58-62`, §2 Avatar `:421-465`, §4 item 6 | §1 activities and stickers tables, §2 Events / Player / Entities / Save formats / Items, new §6 | Each builder edits only those sections. **Vehicles owns** the §1 "Things you can do" table. |
| `docs/MULTIPLAYER.md` | §5.13 | §5.4, §7, §8.x, §9 | Separate sections; the integrator resolves. |
| `site/index.html` | wording pass | the feature sentence | **Boys owns** and writes the vehicles sentence (`:112`) too, because both ship in one deploy. |
| `src/things/pets.js` | string `:64` | (stretch goal: passenger pet) | Leave the stretch goal out of wave 3. |
| `dist/*` | rebuilt | rebuilt | Nobody commits it; the integrator rebuilds once. |

Single-owner files to watch: `player.js`, `camera.js`, `entities.js`, `hud.js`, `touch.js`,
`main.js`, `game.js`, `adapter.js`, `host.js` and `facade.js` belong to vehicles. `avatar.js`,
`wardrobe-data.js`, `codec.js`, `dressup*`, `menus.js`, `storage.js` and `friends/*` belong to boys.
Vehicles must not touch `avatar.js`; the drive pose stays the existing `sitting`.

## 4. Merge order and gate

1. Each branch passes its own full gate locally, without pushing. Run the browser suites **one
   worktree at a time**: two SwiftShader Chromium runs at once make timing checks flaky.
2. Merge **boys first**. It is mostly additive data and UI, and it fixes the codec and the
   strings. Then rebase **vehicles** on it: vehicles touches the core (player, entities, host),
   and its mp pass and remote drawing must run against the final `lk` and `list()`.
3. On the merged tree:
   - `npm run build` and `npm run build:site`.
   - smoke, test:net, test-walkie-unit, test:walkie, probe:railway, probe-net-ux, site-check,
     probe-keepsafe, probe-shops, probe:mp, test:accounts, test:billing, test:saves, e2e:accounts.
   - Also probe-avatar, probe-pals, probe-menus, probe-life, probe-outdoor, probe-furniture and
     test-net-game.
   - Plus probe:boys, probe:vehicles and test:vehicles.
   - Zero console errors.
4. Commit `dist` together with the source and push **once**.
