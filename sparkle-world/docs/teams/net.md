# Team "net": playing with friends, game integration (Agent B)

docs/MULTIPLAYER.md is the contract (Addenda A, B and C override earlier sections). The net core
(`src/net/{transport,room-transport,loop-transport,ws-transport,protocol,codec,journal,host,guest,session}.js`,
`server/*`, Agent A) talks to the game only through the **GameAdapter**. This file is what
Agent B built around it: the adapter, the actor registry, every hook in the game, a minimal
`game.net` facade with no UI, and a three-page test.

| File | What |
|---|---|
| `src/net/adapter.js` | `GameAdapter` over the real game (§9.0) |
| `src/net/actors.js` | `ActorRegistry`: pets (`pet`), NPC friends (`npc`), zip links (`zip`) |
| `src/net/facade.js` | `install(game)`: `game.net` (§9.1, no UI) and `game.debug.net` |
| `tools/test-net-game.mjs` | host + 2 guests in real pages over the real relay |

Everything is inert while `game.net` is missing or `!game.net.active`: playing alone is
unchanged (smoke and every team probe pass as before; no request is made at boot).

## Rules for every module (DESIGN.md §5)

1. Every world change goes through `World.set`, `game.entities.*` (`place`, `remove`,
   `rotate`, `setData`), the garden API (`addPlant`, `removePlant`, `_setStage`,
   `harvestState`) or a registered actor. **Never** mutate `entity.data` or `world.blocks`
   directly: the hooks would not see it and friends' worlds would drift (the hash safety net
   then resyncs them).
2. No `update()` or time listener changes world state on a guest (`game.net?.isGuest`): the
   host's result arrives in a batch. (Garden growth / drying / rain, mailbox mail, pets' and
   friends' morning and bedtime are guarded.)
3. Listeners that change the local player's profile (stickers, stats, coins, basket, tips)
   return early when `game.net?.remoteApplying` is set. On the host this flag is set while a
   friend's change runs (her world events fire with it set); on a guest while the host's
   data is applied (those applies emit no world events at all).
4. Things only the host may do on a guest are refused with `game.net.refuse(kind)`
   (`'paused' | 'pet' | 'npc'`), which toasts once per 4 s.

## Hooks (what changed where)

- **`world/world.js`**: `world.onCell(i, prev, id)` after every changed `set()` (also
  silent ones: batches, undo, prefabs, garden, grass cleared by furniture);
  `encodeBlocksBytes()` / `decodeBlocksBytes(bytes, palette)` (the base64 pair wraps them).
- **`things/entities.js`**: `onChange` for `('add', e)`, `('del', record)`,
  `('rot', e, rotBefore)` (`rotate` and `_setRot`), `('data', e, patch, dataBefore)`.
  `uidBase` + `allocUid()`: `nextUid` follows only uids of its own seat range (old saves,
  uids < 10⁶, bump it as before). `canPlace(..., opts)` with `players: false`; `place()`
  opts `players`, `yOffset`, `restsOn`; `remove(e, { riders: false })`; `_record(e)` (the
  wire record). The Undo of a removal (`_placeBack`) is compare-and-set while a session
  runs: it comes back only if it fits, and a guest gives a piece that is not from her uid
  range a fresh uid of her own (later redo entries follow it).
- **`core/game.js`**: public `serializeWorld({ thumbnail, blocks })` (no side effects;
  `_serializeWorld` also clears the "save soon" timer); `saveWorld` / `flushSave` never
  store a shared world (the mark `world.meta.shared` is on the world itself, so it also holds
  after the session ended; this is stricter than §9.2's `isGuest` line, and her own world is
  still saved if she knocks from inside it); `enterSharedWorld(save, rle)` (world id `net-<code>`, two blocks in front of the
  host, default hotbar, no autosave, no `lastWorldId`); `_enterWorld(world, save, { shared })`;
  `_inSystems` around system updates; `net.frameEnd()` at the end of each frame; history
  calls are no-ops under `net.noHistory`; block Undo / Redo closures are compare-and-set
  (`_casSet`) while a session runs; `placeBlock` refuses a solid block in a friend's avatar
  (`net.cellHasFriend`); `useTarget` / `removeTarget` / strokes check `net.mayEdit(tool)`
  (Hand always works); `skipToMorning` on a guest sends the intent `z` and skips locally;
  `_advanceTime` follows the host's frozen flag on a guest; `exitToTitle`, `newWorld` and
  `loadWorld` leave the session first (quietly); `unstickPlayer()` alias.
- **`things/prefabs.js`, `prefabs/place.js`**: `commit(plan, pl, diff)`; the house Undo is
  CAS while a session runs (`writeCellsCas`: only cells still holding what the house wrote);
  `applyRemote(key, {x, y, z, rot}, policy)` (host: bounds and EDGE checks, `computeDiff`,
  the policy gets `{cells: [i, before, after, ...], ents: [uids incl. riders]}`, commit
  outside the host's Undo, sparkles and confetti); on a guest `build()` plays the magic as a
  **visual-only job**: when the pop-in ends it sends `pf` and keeps the pop-in until
  `resolveRemote(lseq, ok)`; ok = "Ta-da!" + `prefab:place` (her sticker) and the pop-in stays
  until the host's blocks are drawn; not ok = dropped (the core toasts "The magic fizzled!").
  Her Undo sends `pu`. Works for every Magic Build (campers, treehouses with rope bridges
  and zip towers: their furniture is placed by the host's commit like any piece).
- **`things/garden.js`**: `onChange(kind, i, before, after)` for add / del / stage /
  harvest (`harvestState(plant)` is what a harvest does to the plant); `adoptWet(x, y, z)`
  (host: a friend's watering dries on the usual timer); `applyRemote([i, crop, stage, wet])`
  (guest, silent); a guest does not grow, dry or rain-water (and no overnight growth).
- **`things/pets.js`, `pets/pet.js`, `pets/ui.js`**: `sys.remote`, `sys.onChange(pet)` (add,
  remove, setMode, setName, call / home), `pet.h` handles, `pet.netSample()` /
  `setNetTarget()` / `puppet(dt)`; guest refusals for adopt, feed, ride, Stay / Follow,
  Call, Home, rename and Bye; petting and tickling stay local (no care bubble on a guest).
- **`things/friends/index.js`, `friends/friend.js`**: the same pattern, see below.
- **`things/outdoor/zipline.js`, `outdoor/index.js`**: `zip.onChange()` on link / unlink,
  `zip.setLinks(list)`; a `net:applied` listener keeps ladders (towers, platforms) and
  whole-bridge Remove in step with pieces that arrived silently.
- **`things/furniture/life.js`**: morning mail only on the host.
- **`life/weather.js`**: heightmap columns follow `net:applied` (no rain under a friend's
  new roof). **`life/collectibles.js`**: gems hop out of a friend's new blocks.
- **Guards** (`remoteApplying`): `life/stickers.js` (block, pet, garden, prefab, entity
  listeners), `things/pets/stickers.js`, `things/cooking/basket.js` (food placed / removed),
  `ui/touch.js` (tutorial). Audited, nothing to guard: `friends/stickers.js` (invite, dance,
  sleepover are her own actions), the outdoor stickers (awarded in her own ride / tent /
  s'more code), `friend:*`, `zipline:ride`, `camp:marshmallow` reactions (local chatter).
- **`core/storage.js`**: `listWorlds()` hides `<id>.before` and `<id>.undo`;
  `listBackups()` (metas carry `backupOf`, `backupAt`); `restoreBackup(id)` keeps the world
  as it is as `<id>.undo`, restores the backup and deletes it (`{ok, id, undo}`);
  `restoreUndo(id)` takes a restore back; `deleteWorld(id)` also deletes both side copies.
- **`tools/build.mjs`**: `__SW_BUILD__` = sha1 of every `src/**` path and content plus the
  three.js version (8 hex; `dev-<hash>` for `--serve`); also writes `dist/build.json`, which
  the Railway server reports at `/api/net`.
- **`main.js`**: `net` (the facade) installs after `stickers`, before `hud`.

## Adapter design decisions

- **Records.** Entity `[uid, key, x, y, z, rot, color|0, data|0, yo, ro]` with `data` a JSON
  copy (so `undefined` keys vanish the same way everywhere); plant `[i, crop, stage, wet]`
  (wet = farmland_wet under it; cosmetic). Hashes use `codec.hashEntityRecords` /
  `hashPlantRecords` over these.
- **Silent apply (guest).** `X` (removals, riders untouched), cells in one `world.batch`,
  entities (tables first) with **force**: an unchanged piece (same key / cell / turn) only
  takes the new data / color / height and is rebuilt only when something differs (her own
  door keeps swinging when its ack comes back); anything else is removed and placed anew with
  the host's uid, `yOffset` and `restsOn`. Then plants, actors, `actors.afterApply`, one
  `'net:applied' { cells: [x,y,z,...] (≤ 2,048 cells, else null), entities, placed, removed }`
  and `unstickPlayer()`.
- **Host execution.** Friends' ops run with the normal events on (fences join, zip towers
  link, bridges open railings, the host's derived listeners work as alone). Every exec
  method also pushes an undo entry (a no-op under `noHistory`), so the host's
  **Undo building** (`host.undoSeat`, run in her own scope inside one `historyGroup`) can be
  undone by her own Undo. A friend's block landing in the host's avatar unsticks her.
- **Uid ranges.** `attach` / `enterSnapshot` set `uidBase = seat * 1e6` and `nextUid =
  max(seat base + 1, highest uid of the range + 1, the page's previous nextUid when the seat
  is the same)`: `entities.clear()` (world load) resets them, so the adapter re-applies it.
- **Snapshot.** `serializeWorld({ thumbnail: false, blocks: false })` minus player, hotbar,
  picture and `systems.netOwners`, plus `actors` (the `[id, h]` handles of pets and friends);
  blocks as raw RLE bytes. On entering: pet and friend names and the world name pass
  `sanitizeName`; gems are her own copy (the ones she found in this host world before stay
  found: `profile.net.gems['<world id>@<createdAt>']`, 8 worlds kept, updated on
  `gem:collect`); weather auto stays off; hooks go onto the new World.
- **Rules helpers.** `isWatering(before, after)` (farmland → farmland_wet: allowed on anyone's
  soil, changes no owner) and `isEdible(uid)` (`placeOn: 'table'` with the `eat_food`
  action: anyone may eat it).
- **Name.** `local().nm` is empty while the profile's name is still the default look's
  ("Lily") and `profile.nameSet` is not set (dress-up, settings and the name step set it):
  others see "Friend", never a borrowed "Lily".
- **Time.** More than 0.01 day apart: snap (a forward snap over a morning sets
  `time.quietNight`); otherwise ease 10% of the gap per second. Frozen from the host.
- **Weather.** A guest's `weather.auto = false`; `set(wx, { manual: false, announce: true })`.
- **Presence `st`.** walk `w`, swim `i`, fly `f`, sit `s`, sleep `z`, ride `h`, emote `e`,
  zip line (`player.state === 'hold'`) `l`.

## NPC friends (wave 2): host-owned puppets

Picked because it is the simplest thing that keeps one truth and works under loss:

- The host's friends are actors of kind **`npc`**: record = her save entry without position
  (`id, key, name, look, mode, home, metAt, h`), touched on invite, bye, mode changes (Follow /
  Stay / Home / Call) and dress-up. The snapshot carries them as the `friends` system.
- Motion is in host presence **`nx`**: `[h, x*20, y*20, z*20, yaw*100, st, line, emo]`, `st`
  `w` / `s` (sit) / `z` (sleep) / `i` (swim), `line` always −1 (speech is not sent in v1),
  `emo` = counter × 8 + emote index (wave, dance, twirl, cartwheel, jump, heart, sit), so a
  dance on the host plays on every page.
- On a guest (`friends.remote`) the AI does not run: each friend glides to the latest sample
  (snaps over 8 blocks), sits / sleeps / swims from `st`, plays new emotes. Everything that is
  hers alone stays: she can Hand-tap a friend (wave, hearts, a greeting line in a bubble),
  friends near her chat to her with their curated lines and mirror her emotes (dance party),
  all locally. Inviting, dressing up, treats, Follow / Stay / Home / Call / Bye are refused
  ("That's Lily's friend! Ask Lily to help.").
- Friends follow the **host's** player when in Follow mode (v1).

## Pets

Kind **`pet`**, samples in **`pt`** `[h, x*20, y*20, z*20, yaw*100, st]` (`w` / `s` sit /
`l` lie / `z` sleep / `i` swim / `h` ridden / `f` ridden in the air). Turtles and horses work
the same way (a guest's tickle hides the turtle locally; riding the host's horse is refused).
Remote pet names pass `sanitizeName` (fallback: the species name).

## Zip lines, rope bridges, tree platforms, campfire, tent

- **Zip links** are made by the host (a tower links to the nearest free tower when placed,
  also inside a friend's op or Magic Build). The host's link list is the actor record
  **`zip:links`** `{ l: [[towerUidA, towerUidB, parkedAtB]] }`, sent whenever a link is made
  or undone; guests call `zip.setLinks(list)` on it and again whenever towers arrive or go
  (a guest's own new tower links locally at once, then follows the host's list). Links are
  not in the entity hash; the outdoor system still saves them per world as before.
- **The ride** is local movement: `player.hold()` state, presence `st: 'l'` with positions at
  ≤ 10 Hz for others (Agent C draws her hanging). Which end the trolley waits at is cosmetic
  and not synced.
- **Rope bridges, tree platforms, campfire, tent, camper bunks, string lights**: plain
  entities; every state change already goes through `setData` (`open` railings, `on`),
  bridge segments share `b` in their data. Railing openings are derived by the host and
  arrive as platform records.

## Shops & Sparkle Coins

The shops branch was not merged here (see the hand-off). Its contract with multiplayer:
coin-earning listeners start with `if (game.net?.remoteApplying) return;` (the facade
provides `remoteApplying`); shop counters are ordinary entities; buying, coins and the
basket are per player and never synced; placing a bought treat is an `e+`. The held treat
(`game.treats.held`, null or a `treat_*` key) goes into the optional presence field **`hi`**
(`adapter.local().hi` -> `avatarFields`, the only writer; keys must match
`HELD_KEY_RE` = `[a-z0-9_-]{1,48}` in `protocol.js`, since ice cream keys carry `-` between
their flavors and reach 47 characters; anything else sends null, which deletes it). Every page
draws it on remote avatars with `avatar.hold(game.treats.model(hi), 'hold')`, the same model
she sees in her own hand (`remote-players.js`; `debug.net.remote()` lists `held` and `inHand`).

## For Agent C (UI, avatars, end-to-end)

- Build on `src/net/facade.js`: `install(game, { sanitizeName, toastMessages: false })` from
  `src/net/index.js` (pass the reviewed `sanitizeName` from `names.js`; the facade's basic
  one has no blocklist), then add actions `mp-friends`, `mp-say` and the panels. Replace the
  `net` entry in `main.js` with `index.js`.
- `game.net`: `available` (null until `detect()` resolves; call it when the title / pause
  menu opens: it may fetch `/api/net`), `kind`, `active`, `state`, `role`, `isHost`,
  `isGuest`, `code`, `hostName`, `remoteApplying`, `noHistory`, `hostFrozen`, `host(opts)`,
  `join(code)`, `leave(opts)`, `mayEdit(tool)`, `cellHasFriend(x, y, z)` (presence
  positions; swap in the remote avatars' boxes if you like), `intent`, `players()`,
  `emote(name)` (the player's `emote` events are forwarded already), `say(id)`,
  `refuse(kind)`, `on(name, fn)`, `session`, `adapter`, `actors`.
- Game events: `net:state` `{state, role, count}`, `net:message` `{code, text, vars}`
  (toasted by default until you pass `toastMessages: false`), `net:knock`, `net:knock-gone`,
  `net:players`, `net:reject`, `net:intent`, `net:resync`, `net:progress` `{have, of}`,
  `net:status` `{connected}`, `net:summary`, `net:snapshot-failed`, `net:rules` `{build,
  mine}` (guest: the host switched a rule), `net:tidied` `{n}` (guest: the host undid her
  building), `net:restored` / `net:backup-dropped` `{id}`, and `net:applied`.
- Presence `hi` (held treat key or absent) comes with every player's avatar fields.
- `game.debug.net`: `state role code seq ap pend outbox hash stats peers players knocks
  admit admitAll kick undoSeat setRules host join leave corruptCell`.
- Host start: `game.net.host()` saves the world and makes sure its `.before` backup is there
  (`backup_failed` otherwise). A backup younger than 7 days is kept, never overwritten (a
  resume, a second Invite); the facade deletes it once a change made **alone** in that
  world is saved (block / entity / prefab / garden / pet / history events while no session
  runs, then `world:saved`; event `net:backup-dropped`). `profile.net.lastHost = {code,
  worldId, at, uids}` and `profile.net.lastJoin = {code, hostName, at}` are saved for the
  resume chips. A system `netOwners` saves `hostCore.exportAuthors()` with the world while
  hosting; `env.loadAuthors(code)` hands it to a resumed host.
- Guests' presence `p` is feet (seat when sitting); `st` as above; remote pets / friends are
  real `Pet` / `Friend` objects on guests (no extra drawing needed).
- The "sending…" sparkle: `game.net.session.sending()`.

## Notes for the net core (Agent A)

Two small changes were made in `src/net/host.js` (both covered by `npm run test:net`):
`_revertGroup` decides which of a group's added pieces go before removing any (removing one
fence piece re-joins its neighbours, which made the rest look "changed since" and stay: half
a Flower Cottage fence survived the guest's Undo), and `avatarFields` sends the optional
`hi` (held treat) when the adapter's `local()` has it.

- Owners (review fixes, MULTIPLAYER.md Addendum B): the author map holds owner keys (`'u:'`
  + room stamp, `'p:'` + peer, `0` host), so a friend in a freed seat owns nothing of the
  last one's; only adds and removes change an owner (growth, harvest, turning, data changes,
  fence joins and railing openings do not), so a friend's plant stays hers as it grows and a
  host's lamp stays the host's after a friend tapped it. Derived changes during a friend's op
  are still in her Undo building group (the host's revert restores them).
- `ed` patches from a guest lose `conn` (the host derives fence joins; `touchEnt` sends her
  the record). Watering (`isWatering`) and eating (`isEdible`) pass careful mode.
- Device ids and the walkie (merge of the walkie branch, 2026-09-27): the uid is the room's
  stamp (`by`) only (MULTIPLAYER.md Addendum B item 1); the walkie branch's own fix for the
  same hole (a global `sha256('dev\n' + secret)` stamp, `identity().uid` computed by the page,
  and an 8 s wait before auto-admitting a uid that another page also carried) was dropped in
  the merge, so `host.js` admissions are the review's. `WsTransport` also carries the
  walkie's socket hooks (`voiceIn`, `voiceUp`, `sendVoice`, binary frames), and the relay's
  voice uses the same gate as names and messages (`RoomRegistry.gameOf`, Addendum C.3). The
  gate's host is ranked by the device's first join in the room (`at`) and her place is held
  for 90 s while her page reloads (Addendum B items 2 and 3). Covered by `npm run test:net`
  and `npm run test:walkie`.
- Sleep: a guest's `skipToMorning()` sends intent `z` and skips her own clock at once. While
  that intent waits for the host's answer the guest does not follow the host's (older) clock,
  so she never flickers back into the night; the ack arrives in the same presence as the
  host's new clock (morning for everyone, or back to night when the host said no). The host
  flushes a clock jump at once (urgent presence), not with the next 100 ms presence.

## Known limits (v1)

- NPC friends' speech is not sent (`line` −1): each page's friends chat locally.
- Which end a zip-line trolley waits at is not synced (cosmetic).
- A guest reading the host's mailbox letter sends `{mail: false}`, which is not an
  `ANY_FIELDS` toggle: in careful mode it is refused ("That's someone else's!") and the flag
  comes back. Painting on the host's easel (`pic`) is refused the same way (her own easels work).
  Adding `mail` (and maybe `pic`) to `ANY_FIELDS` would change that.
- Doors toggled by a friend swing on every page (the furniture's per-entity animation state
  survives the in-place record update); pieces placed anew by a record just appear.

## Tests

- `node tools/test-net-game.mjs [--no-build] [--headed] [--keep]`: builds, starts
  `server/server.mjs` on a free local port, three browser contexts (host 1280×800, two
  guests) join through `WsTransport` (picked by `/api/net`), and play: blocks and strokes, a
  protected edit, furniture (bed + turn, table + candle, the host's door and lamp toggled
  by a guest), a guest's Flower Cottage, the host's Sparkle Camper, a guest's Lookout
  Treehouse (zip towers linked by the host), garden (plant, water, host grows, guest
  harvests into her basket), zip towers placed by a guest, building paused, a guest's sleep
  bringing morning, pets and NPC friends (puppets, refusals, petting), Undo on both sides,
  Undo building and the host's Undo of it, a guest reload and rejoin (let in again by her device's room stamp). Every phase ends with
  equal block / entity / plant hashes and equal plants, pets, friends and zip links; no
  resyncs, no console errors, a guest never stores the host's world. About 5 minutes in
  SwiftShader.
- `npm run test:net` (net core, Node) also covers the review fixes: the relay's depth check,
  gate, join order and rooms per IP (and a pretend host who is in the room while the host's
  page reloads: she never becomes the host); identity from stamps only; careful-friends
  rules; owners across a freed seat and a host reload; the kind messages; and, against the
  real server, the crash frame, security headers (the microphone only on the game page),
  device stamps, X-Forwarded-For, pacing of connections and of new rooms, IPv6 per /64 and
  silent drops.
- `node tools/probe-net-ux.mjs [--no-build] [--headed]` (about 5 minutes, real relay): the
  name step on a new device, Play Together, the gate while knocking, building paused and on
  again, Undo building heard by the friend, a reloaded host tapping Play ("Your friends are
  waiting!", the same code, the backup kept), Before friends with its picture and Undo, and
  building alone dropping the backup.
