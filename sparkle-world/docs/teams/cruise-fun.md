# Cruise fun (wave 5, team cruise-fun)

Everything to do on the Cruise Ship (wave5-plan.md §7.2): water slides, lifts, an arcade with
three mini games, three deck games, mini golf, a dance deck, a movie screen, the captain's wheel,
the "What's On" board, pool floats, sun loungers, towel animals and a ship's bell. Every piece is
also in the Bag's **Cruise Fun** tab, so she can build her own ship (or a water park in her
garden) anywhere.

All of it lives in `src/things/cruise/`. The only shared line touched is the `cruise:` line of
`TAB_PICS` in `src/ui/inventory.js`. Everything else another file would need is in
[Wanted from the integrator](#wanted-from-the-integrator).

## 1. Design

The ship should feel like a big family holiday: lots to do, all of it one tap away, nothing that
can go wrong. Every activity follows the same rules:

- **One tap starts it.** No menus to learn. The hint over a piece says what a tap does
  ("Tap to ride the slide!", "Tap to shoot hoops").
- **Every ending is a happy one.** A slide always ends in the pool or back at the start. A golf
  hole always goes in (a magic roll-in after six strokes). Every mini game ends with a cheer and
  a score above zero. A time limit ends any ride, so she can never be stuck.
- **Short.** Mini games run 30 to 60 seconds (Fish Match has no clock but turns on a magic help
  after 70 s). Deck games are five throws.
- **Tap only.** The canvas games take a tap or click (and Space or Enter for the big button). No
  dragging, no timing beyond "tap when the meter is in the green".
- **Our own look.** Every model, colour scheme, name and sticker is original. No cruise line's
  ship, names, colours, logos or characters, no studio characters and no famous holiday names
  (checked by `tools/test-name.mjs` and by the C11 test).

### 1.1 Water slides (`cruise_slide`, `cruise_waterslide`)

- A **slide start gate** sits at the top of a slide the ship built. It keeps the slide's path in
  its own entity data (`data.p`, packed, see §3.2). Tap it and she:
  1. hops onto the slide (0.55 s; from far away with a sparkly poof),
  2. rides it seated, facing down the slide, with her legs out and her arms going up as she speeds
     up. The speed builds downhill and never drops below a gentle minimum, so flat and uphill bits
     still move. She leans into the turns. Water spray and a bubble trail follow her, a rushing water
     sound follows her speed, and the camera swings to a chase view to one side (unless she is
     turning the camera herself),
  3. lands with a big splash and a bubble burst in the pool (or hops off onto her feet on dry land).
     Toast, coins (once a day) and the **Splashdown!** sticker.
- **Never stuck.** At the tap every cell of the path is checked against what is built now:
  - something built into the slide: she rides to just before it, then a magic hop takes her to
    the splash pool;
  - blocked at the very top, or the pool filled in: the gate says "Something is on the slide!
    Clear it to ride." and she stays where she is;
  - a ride that takes longer than its time limit hops to the end;
  - if the gate is removed, the world closes or she is otherwise released mid ride, she is put
    down on the nearest spot she can stand.
- **The Bag's slide start** (`cruise_slide` placed by hand, no `data.p`): it looks straight out of
  its front and follows what she built down (stairs, slopes, drops of one block) for up to 32
  cells, ending in water when it reaches some. A flat floor gives a short scoot. With nothing to
  slide down it says "Build a slope in front to slide down!".
- **The Mini Water Slide** (`cruise_waterslide`, 2 x 4 x 6) is a whole little slide in one piece:
  ladder, top, a curving chute and a splash end. It rides its own built-in path.

### 1.2 Lifts (`cruise_lift`)

A lift button panel stands at each deck stop. Stops are the lift pieces in the same x, z column
(so any column of lifts she builds works too). Tap: a ding, and a panel with one big button per
deck, top deck first, "You are here" on hers. Pick one: a ding, a short fade with the deck's
name, and she stands in that deck's lift facing out. With only one lift in the column the toast
says to build another one above or below.

### 1.3 Arcade (`cruise_arcade`) and the three mini games

Three cabinets, told apart by colour (pink, blue, mint) or by `data.g`. Each opens the game
panel. All drawn on a 640 x 400 canvas, scaled to fit.

| game | key | time | how | score |
|---|---|---|---|---|
| Star Catcher | `star` | 40 s | tap falling stars (a golden one is worth 3; a shooting star now and then) | stars caught |
| Bubble Pop | `bubble` | 40 s | tap each rising bubble (a golden starfish inside is worth 3) | how many popped |
| Fish Match | `fish` | none (help after 70 s) | 12 cards, 6 pairs of sea friends | `matchScore`: 10 a pair, more for quick and neat |

The panel shows a ready card (Play!), the clock and the best score, then an end card with a cheer,
the score, "New best!" or "Best N", confetti, and Again! / Done.

### 1.4 Deck games (`cruise_hoops`, `cruise_ringtoss`, `cruise_shuffle`)

Each is a 3D model on deck and a timing game in the panel: a power meter swings, she taps the
big button when it is in the green. Five throws. Each throw scores 1 (any throw), 2 (good) or 3
(in the green), so a round scores 5 to 15. The meter speeds up a little each throw. Hoops: the
ball arcs to the hoop. Ring Toss: rings onto pegs. Shuffleboard: the puck slides into the scoring
triangle. Playing all three gives **Deck Champ**.

### 1.5 Mini golf (`cruise_golf`, `cruise_flag`)

A start sign and (on the ship) a flag at each hole. Tap the sign for the whole course, a flag for
that hole on. In the panel: tap the green to aim, then the big button putts with the swinging
power. Six holes of our own: Sunny Start, Corner Cove, Bubble Bumpers, Zig Zag, Lighthouse Gap,
Starfish Loop (a course of up to 9 repeats them). Par shows for each hole; a banner cheers each
one in ("Hole in one!", "Super putt!", "Par! Great!", "In it goes!"). After 6 strokes the ball rolls in by magic. Score:
1 to 3 stars a hole. Finishing a course gives **Putt Putt!**.

### 1.6 Dance deck (`cruise_dj`)

Tap the DJ booth: the party starts (music loop, record spin, confetti). Tap again for the next of
four songs; after the fourth a tap rests the DJ. While a party plays:

- the dance floor lights up: coloured tiles change on the beat (an additive overlay, not block
  changes), with sweeping beams from the booth and a disco ball,
- the music comes from the nearest booth: full volume within 9 blocks, fading out by 28; the
  game's own music ducks while it plays,
- when she stands still on the floor she dances (`player.emote('dance')`, which friends within 10
  blocks mirror), and notes float up.

The song lives in the booth's entity data (`data.p`), so friends in a shared world hear and see
the same party. Starting one gives **Disco Deck**.

### 1.7 Movie screen (`cruise_movie`)

A big screen (5 x 3 from the Bag, up to 24 x 14 from a world record) showing the TV's own
cartoons (`src/things/furniture/tv.js` `drawChannel`, `CHANNELS`) on its own canvas, 12 frames a
second within 40 blocks of the camera. Tap for the next cartoon; after the last one it switches
off. The channel is entity data (`data.ch`), so friends see the same show.

### 1.8 Captain's wheel (`cruise_wheel`)

Tap: the ship's horn, a big "Captain <her name>!" toast, the wheel spins, she steps up behind the
wheel and the camera turns to look out over the bow for a couple of seconds (any touch on the
camera stops it). Gives **Captain!**.

### 1.9 The "What's On" board (`cruise_board`) and spots

Tap: a panel of activity cards with a picture each (Pool, Water Slides, Arcade, Deck Games, Mini
Golf, Dance Party, Movies, Captain's Bridge, Cabins, Beach Island), only those this world has.
"Take me there" fades and puts her at the place: a named spot from the world (`cruise:spot`
records) when there is one for that activity, else the nearest piece for it, standing in front
of it and facing it. "You are here" when she already is.

### 1.10 Small pleasures

- **Pool float** (`cruise_float`, 6 shapes by colour or `data.s`: donut, duck, star, melon, unicorn,
  turtle): bobs on the water (it rises to the surface when its cell is water). Tap to sit on it;
  she bobs along.
- **Sun lounger** (`cruise_lounger`): tap to lie back in the sun (quietly, no sleep).
- **Towel animal** (`cruise_towel`): sits on the bed or table below it. Tap to fold a new animal
  (swans, elephant, bunny, puppy) with a little toast.
- **Ship's bell** (`cruise_bell`): tap to ring it; it swings.
- A **welcome** toast and horn the first time she has been on a cruise world for 6 s with
  nothing covering the world ("Welcome aboard! The What's On board shows all the fun.").

## 2. Keys, ids and events

### 2.1 Furniture (all category `cruise`, `placeOn: 'floor'`)

| key | name | size w x h x d | colliders | action | data |
|---|---|---|---|---|---|
| `cruise_slide` | Water Slide Start | 1 x 3 x 1 | gate | `cruise-slide` | `{ n?: name, p?: packed path }` |
| `cruise_waterslide` | Mini Water Slide | 2 x 4 x 6 | slide | `cruise-slide` | none |
| `cruise_lift` | Lift | 1 x 2 x 1 | panel | `cruise-lift` | `{ n?: deck name }` |
| `cruise_arcade` | Arcade Game | 1 x 2 x 1 | cabinet | `cruise-arcade` | `{ g?: 'star' \| 'bubble' \| 'fish' }` (else by colour) |
| `cruise_hoops` | Hoops | 1 x 3 x 1 | pole | `cruise-game` | none |
| `cruise_ringtoss` | Ring Toss | 2 x 1 x 1 | table | `cruise-game` | none |
| `cruise_shuffle` | Shuffleboard | 1 x 1 x 4 | court | `cruise-game` | none |
| `cruise_golf` | Mini Golf | 1 x 2 x 1 | sign | `cruise-golf` | `{ h?: holes 1..9, par?: [2..5] }` |
| `cruise_flag` | Golf Hole Flag | 1 x 2 x 1 | none | `cruise-golf` | `{ i: hole index, h: holes }` |
| `cruise_dj` | DJ Booth | 2 x 3 x 1 | desk | `cruise-dj` | `{ p?: song 0..4, fx0, fz0, fx1, fz1, fy? }` |
| `cruise_movie` | Movie Screen | 5 x 3 x 1 | frame | `cruise-movie` | `{ ch: 0..3, w?: 5..24, h?: 3..14 }` |
| `cruise_wheel` | Captain's Wheel | 1 x 2 x 1 | stand | `cruise-wheel` | none |
| `cruise_board` | What's On Board | 2 x 2 x 1 | board | `cruise-board` | none |
| `cruise_float` | Pool Float | 1 x 1 x 1 | none | `cruise-float` | `{ s?: shape }` (else by colour) |
| `cruise_lounger` | Sun Lounger | 1 x 1 x 2 | lounger | `cruise-lounge` | none |
| `cruise_towel` | Towel Animal | 1 x 1 x 1 | none | `cruise-towel` | `{ a: 0..3 }` |
| `cruise_bell` | Ship's Bell | 1 x 2 x 1 | post | `cruise-bell` | none |

Lights: lift 8, arcade 6, DJ booth 7. Every data object is plain JSON of depth 1 or 2 and at
most about 450 bytes (the C1, C10 and C12 tests check it against `C.ENTITY_DATA_BYTES` = 600).

Bag tab picture (`TAB_PICS.cruise`): `furn:cruise_waterslide`, `furn:cruise_arcade`,
`furn:cruise_slide`.

### 2.2 World feature records placed (wave5-plan.md §4.1; host only)

| kind | places | notes |
|---|---|---|
| `cruise:slide` | `cruise_slide` at x, y, z | `path` normalised (broken points dropped, gaps up to 4 filled, a longer jump ends it, at most 240 cells), packed into `data.p`; `name` (20 chars) into `data.n`; `color` (css hex) is the gate colour |
| `cruise:lift` | a `cruise_lift` at (x, stop.y, z) for each stop (at most 12) | `name` (20 chars) into `data.n` |
| `cruise:arcade` | `cruise_arcade` | the n-th record gets star, bubble, fish, star... |
| `cruise:game` | `cruise_hoops` / `cruise_ringtoss` / `cruise_shuffle` | `game`: `hoops`, `ringtoss` (or `ring`), `shuffle` (or `shuffleboard`); anything else is skipped |
| `cruise:golf` | `cruise_golf` at x, y, z and a `cruise_flag` at each hole's `cup` | pars clamped to 2..5; 6 holes when none are given |
| `cruise:dance` | `cruise_dj` at x, y, z | the floor rectangle `x0, z0, x1, z1` (at most 24 x 24, 400 tiles) at height y |
| `cruise:movie` | `cruise_movie` | `w` 5..24, `h` 3..14 |
| `cruise:wheel` | `cruise_wheel` | |
| `cruise:board` | `cruise_board` | |
| `cruise:float` | `cruise_float` | colour picked from x, z |
| `cruise:spot` | no entity | `{ name, deck }` kept in the `cruise` system (at most 32), saved with the world |

A piece is placed with `game.worldFeatures.placeOpts()`. If the normal fit check fails only
because of the player or a replaceable block it is forced; it is never forced into a solid block
or another piece (then that record is skipped).

### 2.3 Other ids

| what | ids |
|---|---|
| actions | `cruise-slide`, `cruise-lift`, `cruise-arcade`, `cruise-game`, `cruise-golf`, `cruise-dj`, `cruise-movie`, `cruise-wheel`, `cruise-board`, `cruise-float`, `cruise-lounge`, `cruise-towel`, `cruise-bell` |
| panels | `cruise-play` (args `{ game, opts? }`), `cruise-lift` (`{ stops, here, uid }`), `cruise-board` (`{ uid }`) |
| system | `cruise` (world save: `{ v: 1, spots: [{ name, deck, x, y, z }] }`, only when there are spots) |
| stickers (6) | `cruise_splash` Splashdown!, `cruise_arcade` Arcade Star, `cruise_champ` Deck Champ, `cruise_golf` Putt Putt!, `cruise_captain` Captain!, `cruise_party` Disco Deck (hand drawn art in `art.js`) |
| profile | `profile.cruise = { v: 1, best: { game: n }, plays: { game: n }, day, mask, paid }`, read with a default and mended by `cruiseData()` |
| CSS | prefix `cr-` |
| facade | `game.cruise = { slides, party, sfx, spots(), play(key, opts), board(), award(id), data() }` |
| debug | `game.debug.cruise = { plan(uid), ride(), slide(uid), freeze(on), spots(), party(), board(), data(), lift(uid), goLift(uid), welcome(on) }`, and `game.debug.cruise.play(key, opts)` from the panels |
| toast keys | `cruise-slide`, `cruise-lift`, `cruise-movie`, `cruise-captain`, `cruise-lounge`, `cruise-towel`, `cruise-welcome`, `cruise-dj` |

### 2.4 Events

| event | payload |
|---|---|
| `cruise:slide` | `{ uid, phase: 'start' \| 'splash' \| 'done', wet? }` |
| `cruise:party` | `{ uid, song }` (0 = stopped) |
| `cruise:score` | `{ game, score, best, isBest }` |
| `cruise:movie` | `{ uid, ch }` |
| `cruise:bell` | `{ uid }` |
| `cruise:captain` | `{ uid }` |
| `cruise:lift` | `{ uid, deck }` |
| `cruise:goto` | `{ name }` |

## 3. Numbers

### 3.1 Coins (at most 20 a day)

Paid once per game per day through `game.coins.add(n, 'cruise')`:
Star Catcher 3, Bubble Pop 3, Fish Match 3, hoops 2, ring toss 2, shuffleboard 2, mini golf 3,
a slide ride 2 (sum 20 = `DAILY_CAP`). The day is a local `yyyymmdd` stamp with a bit mask of the
games paid; a clock that went backwards pays nothing. Stickers pay their usual +20 through the
existing listener.

### 3.2 Slides

| | |
|---|---|
| path cells from a record | at most 240 (`SLIDE.MAX_POINTS`), steps up to 1.5 accepted, gaps up to 4 filled |
| packed path | at most 420 characters (`SLIDE.MAX_CHARS`): the key cells (straight runs collapsed) as small steps, a step longer than the alphabet split in two |
| a record cell naming the floor block | lifted one up (`liftKeys`) so either reading of "cell center" works |
| speed | starts 2.4, gravity 8.8 along the slope, drag 0.012 v^2 and 0.15 rolling, kept in 3.2..11.5 blocks/s |
| time limit | the length at the slowest speed plus 4 s (plus the 0.55 s hop on) |
| Bag gate look-ahead | 32 cells |
| her seat | 0.06 above the cell floor; her hips drop by `HIP - 0.095` |

### 3.3 Party, movie, games

Party: 4 songs (118, 124, 112, 128 bpm), heard to 28 blocks, full within 9, lights shown within
56 blocks of the camera. Movie: 12 fps, within 40 blocks. Golf: friction 1.15/s plus 34 px/s^2,
putt 130..720 px/s, the cup takes the ball under 330 px/s, magic roll-in after 6 strokes.

## 4. Files

| file | what |
|---|---|
| `index.js` | install: the 17 pieces, actions, captain, lifts, board, world record placers, facade, debug, the `cruise` system |
| `logic.js` | pure logic (no three.js, no DOM): slide paths, ride planning and speed, auto slide, lift stops, meter, golf physics and course, coins, scores, `mergeCruise`, activities |
| `slide.js` | the slide ride (plan, hold, pose, spray, camera assist, safe ends) |
| `party.js` | DJ booths, the light-up floor, beams, music, dancing |
| `games.js` | the six canvas games (Star Catcher, Bubble Pop, Fish Match, the deck game, Golf) |
| `panels.js` | the `cruise-play`, `cruise-lift` and `cruise-board` panels and their CSS |
| `models.js` | all 3D models (`Kit`) and colliders |
| `art.js` | SVG pictures for the panels and the six stickers' art |
| `sfx.js` | synthesised sounds (rush, party loops, horn, ding, bell, splash, cheers...) |

## 5. How to test

```
cd sparkle-world
node tools/build.mjs
node --test tools/test-cruise-fun.mjs     # 33 tests, about a second
node --test tools/test-name.mjs
node tools/test-vehicles.mjs; node tools/test-sea.mjs; node tools/test-merfolk.mjs; node tools/test-squish.mjs
```

`tools/test-cruise-fun.mjs` covers: slide path packing and the 600-byte budget, lifting floor
cells, blocked cells and every safe end (full, pool, start), a whole simulated ride that follows
the path and ends in time, the Bag gate's path on small built worlds, lift stop picking, the
deck meter, every golf hole ending with the ball on the green, every mini game finishing by
itself with a score (with a busy pretend player), the daily coin cap, best scores, the merge
helper, the board's spot names, all 17 models building inside their footprints, the name scan,
and an install on a pretend game that runs every world record kind.

In a browser (`?debug`), on a cruise world or after placing pieces from the Bag:

- `game.debug.cruise.plan(uid)` shows a slide's plan; `slide(uid)` rides it; `freeze()` holds the
  ride still for a picture; `ride()` shows its progress.
- `game.debug.cruise.play('golf', { holes: 3 })` opens any game (`star`, `bubble`, `fish`,
  `hoops`, `ring`, `shuffle`, `golf`).
- `lift(uid)` / `goLift(uid)`, `board()`, `spots()`, `party()`, `data()`, `welcome()`.

## 6. As built

- All of §7.2 is in: slides (record gate, Bag gate, mini slide), lifts, arcade with 3 games,
  3 deck games, mini golf (sign and flags), dance deck, movie screen, captain's wheel, What's On
  board and spots, floats, loungers, towel animals, bell. 6 stickers, 20 coins a day.
- **Not checked in a browser** (there is none in this build container). Everything is checked by
  the build, the Node tests, an install on a pretend game, and a careful read against the APIs it
  calls. The first look in a real browser should check: the slide pose and the camera assist,
  the dance floor lights' height on the ship's real floor, the movie screen when `w` is larger
  than 5 (the model is wider than the 5 x 3 footprint the def declares), and the towel drop onto
  a cabin bed.
- `tools/worldview.mjs cruise` runs, but in this worktree the cruise biome is still the stub (no
  features), so the placers were checked with the C12 test instead.
- The slide ride holds her with `player.hold(this)` (like the zip line) and poses the bones itself
  after the avatar's update, since the avatar does not sit in the hold state.

## Wanted from the integrator

1. **Keep `profile.cruise` in backups and merges** (best scores, play counts, the day's paid
   games). `logic.js` exports a pure `mergeCruise(a, b)` for both:
   - `src/core/storage.js`: add `'cruise'` to `BACKUP_PROFILE_KEYS`, and in `mergeBackupProfile`
     next to the squish join:
     ```js
     if (isObj(f.cruise)) {
       const joined = mergeCruise(current.cruise, f.cruise);
       if (canon(joined) !== canon(current.cruise)) current.cruise = joined;
     }
     ```
     with `import { mergeCruise } from '../things/cruise/logic.js';`
   - `src/account/merge.js` `mergeProfile`, after the squish line:
     ```js
     if (isObj(local.cruise) || isObj(server.cruise)) out.cruise = mergeCruise(local.cruise, server.cruise);
     ```
     with `import { mergeCruise } from '../things/cruise/logic.js';`
2. **package.json**: `"test:cruise-fun": "node --test tools/test-cruise-fun.mjs",` next to the
   other `test:` scripts.
3. **cruise-world, the records**: the placers follow §4.1 as written. Notes for the ship:
   - the captain's wheel's front faces the captain (she stands in front of it and looks across
     it toward the bow), so give `cruise:wheel` the `rot` whose front points aft;
   - `cruise:dance` `y` is the air cell above the floor (the DJ booth's own y); the light tiles
     draw on the floor under it;
   - a `cruise:slide` path may name either the air cells (as §4.1 says) or the floor blocks under
     them; both ride the same. End it in a pool cell;
   - name `cruise:spot` records with words the board knows (pool, slides, arcade, games or sports,
     golf, dance or disco, theater or movies, bridge, cabins, beach).
4. Optional: a help card in `src/ui/touch.js` for the Cruise Fun tab ("Tap a slide start to
   whoosh down, the DJ booth for a party, the wheel to be Captain!").

## Open questions

- Party music ducks the game's music by setting `musicGain` directly and restores it with
  `audio._applyVolumes()`; the walkie-talkie ducks the same way. If both are on at once, the last
  one to finish restores the volume. A shared duck counter in `audio.js` would be cleaner.
- Should a friend's slide ride be shown? Today only her own avatar is posed; friends see her
  position move down the slide (standing).
- The welcome toast keys off `world.meta.biome === 'cruise'`; a ship built by hand in another
  world gets no welcome (on purpose).
