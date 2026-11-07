# Team "holiday-looks": Santa and elf dress-up, the Holiday Dress-Up booth, holiday friends

Wave 5, plan section 7.4 (`docs/teams/wave5-plan.md`). The request: *"I want to be able to dress up
as an elf and as Santa"*, plus a Holiday Village where the helper elves and friends join in. This
team made the holiday clothes, the ready-made Santa and Elf looks, the Holiday Dress-Up booth,
holiday outfits for NPC friends in Holiday Village and two stickers. Every name is our own (no
company's names, no famous holiday characters, nothing of the trademarked elf doll): the ready-made
looks are "Santa", "Elf", "Mrs. Santa" and "Cozy Holiday", and the stickers are "Little Helper"
and "Ho Ho Ho!".

Branch `wave5/holiday-looks`, base `3b1bf3f`. Owner files:

| file | what |
|---|---|
| `src/player/holiday/index.js` | the `holiday-looks` system: booth furniture and action, the `holiday:dressup` placer, the big-button bubble, costume changes with Undo, friends in Holiday Village, `game.holidayLooks`, `game.debug.holidayLooks` |
| `src/player/holiday/rules.js` | pure rules (Node-tested): costumes, "Back to me", the girl / boy side, the booth state, friends' outfit picks |
| `src/player/holiday/booth.js` | the booth model (plain colors and glow only, builds in Node) |
| `src/player/holiday/stickers.js` | Little Helper and Ho Ho Ho! with hand-drawn art |
| `tools/test-holiday-looks.mjs` | the team test (13 checks, about 1.5 s) |
| `tools/lib/holiday-lookview.mjs` | a Node software renderer for looks and models (pictures without a browser) |
| `tools/fixtures/holiday-looks-golden.json` | goldens recorded from the base commit before any change |

Shared lines changed (all ours per plan §6.1): `src/player/wardrobe-data.js`,
`src/player/avatar.js` (one line), `src/player/avatar/{outfit,accessories,hair,textures}.js`,
`src/ui/dressup.js`, `src/ui/dressup/pictures.js`, `src/things/friends/looks.js` (append only).
`src/net/codec.js` did **not** need a change.

---

## 1. Design

### 1.1 The clothes (all free, all appended)

Every new piece is a new entry at the **end** of an existing look list, so the codec (which sends
list indices as one base-36 digit) needs no change and every old look string decodes exactly as
before. Every piece carries `season: 'holiday'` and a Girl / Boy / Mix tag (`docs/teams/boys.md`):
`'gb'` (shown on both sides) for everything except the two dresses (`'g'`, like every dress).

| list | appended keys (name) | index |
|---|---|---|
| `TOPS` | `santa_coat` (Santa Coat), `elf_tunic` (Elf Tunic), `holiday_sweater` (Holiday Sweater) | 14-16 |
| `BOTTOMS` | `santa_pants` (Santa Pants), `holiday_tights` (Stripy Tights) | 10-11 |
| `DRESSES` | `santa_dress` (Santa Dress), `elf_dress` (Elf Dress) | 6-7 |
| `SHOES` | `santa_boots` (Santa Boots), `elf_shoes` (Elf Shoes) | 9-10 |
| `HEAD_ACC` | `santa_hat` (Santa Hat), `elf_hat` (Elf Hat), `antlers` (Antlers), `elf_ears` (Elf Ears) | 17-20 |
| `FACE_ACC` | `beard` (Santa Beard) | 5 |
| `BACK_ACC` | `toy_sack` (Toy Sack) | 7 |
| `HAND_ACC` | `candy_cane` (Candy Cane), `present` (Present) | 9-10 |
| `PATTERNS` | `snowflakes` (Snowflakes), `trees` (Little Trees), `candy` (Candy Stripes) | 12-14 |

What they look like (all voxel parts on the avatar, `src/player/avatar/*.js`):

- **Santa Coat**: velvet red (a new soft `velvet` cloth with a sheen), a white fur collar and
  front strip, white fur cuffs, a coat skirt with a deep fur hem, a black belt with a gold buckle.
- **Santa Pants**: velvet, fur cuffs at the knee. **Santa Boots**: tall black boots with a buckle
  strap and a fur top. **Santa Hat**: a soft cone that flops to one side in four tipping pieces,
  a fluffy fur band of soft puffs, a white pompom. **Santa Beard**: a big fluffy beard of round
  puffs over a solid core, sideburns, a curly mustache with her smile peeking out (any color: it
  takes the face-accessory color, white by default).
- **Toy Sack**: a round sack on her back tied with gold rope, a teddy, a present and a candy cane
  peeking out, the rope across her front.
- **Santa Dress** (the "Mrs. Santa" style): velvet, long sleeves with fur cuffs, a fur collar and
  three fluffy buttons, a black belt with a gold buckle, a flared skirt with a deep fur hem.
- **Elf Tunic**: green, a zigzag collar, a belt, a zigzag hem with little gold bells on its
  points. **Elf Dress**: puffy sleeves, a zigzag collar, a red belt, a two-layer zigzag skirt with
  a white underlayer, worn over red-and-white stockings. **Stripy Tights**: seven stripes per leg
  in the pattern color (white by default). **Elf Shoes**: low shoes whose toes curl up and back
  with a gold bell on the tip. **Elf Hat**: a tall cone that bends over at the tip with a gold
  bell, a zigzag band, and built-in pointy ears. **Elf Ears**: pointy ears in her skin tone, with a
  tiny jingle-bell earring in the chosen color.
- **Antlers**: a headband with two branching antlers, soft ears and a sprig of holly with
  berries; on tall hair (afro, spiky, short curly, fauxhawk) the antlers stand higher.
- **Holiday Sweater**: knit, a crew collar, knit bands at chest and hem with little diamonds, a
  pixel tree on the front with ornaments and a star (white on a green sweater), a snowflake on
  the back, a knit cuff band.
- **Candy Cane**: a striped stick with a hook curling forward. **Present**: a wrapped box with a
  ribbon cross and a bow (gold ribbon, red on a yellow box). Both are held up like the toys.
- **Patterns**: six-armed snowflakes, little pine trees with a gold star, diagonal candy stripes.

The hats join the flat-hat set (`HAT_FLAT`), so short and curly styles stay low under them; both
hats widen with puffy hair (`P.hairPuff`) like the other hats.

### 1.2 Ready-made holiday looks

`HOLIDAY_OUTFITS` (append only) in `wardrobe-data.js`, shaped like `STARTER_OUTFITS`. None sets a
hair style or the face: who she is (name, skin, hair, eyes, face, sea form) always stays.

| key | name | tag | look |
|---|---|---|---|
| `santa` | Santa | gb | Santa Coat and Pants (red), Santa Boots, Santa Hat, Santa Beard, Toy Sack, a green Present |
| `elf` | Elf | b | Elf Tunic (green), Stripy Tights (red / white), Elf Shoes (red), Elf Hat, Candy Cane |
| `elf_girl` | Elf | g | Elf Dress (green), Elf Shoes (red), Elf Hat, Candy Cane |
| `mrs_santa` | Mrs. Santa | g | Santa Dress (red), Santa Boots, Santa Hat, gold glasses, a pink Present |
| `cozy` | Cozy Holiday | gb | Holiday Sweater (red), jeans, brown boots, Antlers, a green scarf, Candy Cane |

They are a list of their own (not `STARTER_OUTFITS`), so the Studio's "Ready-made looks" row (12
tiles, probe-boys B4), the friends' "Dress up" bubble (6 / 8 buttons, probe-boys A7) and the
merfolk goldens stay exactly as they were. The Studio shows them in a new section **"Holiday
looks"** right under "Ready-made looks" on the Outfits tab, filtered by Girl / Boy / Mix like the
ready-made row (Mix shows all five). Picking one never picks the Girl / Boy style.

### 1.3 Surprises stay the same

`tagged()` (what Surprise me!, the friends' surprise looks and `randomLook` draw from) skips
seasonal options, also in its empty-side fallback, and the girl dress pick draws from the six
original dresses. So no surprise ever comes out in a Santa hat, and **every seeded `randomLook`
is exactly what it was** (60 goldens).

### 1.4 The Holiday Dress-Up booth

`holiday_booth` furniture, "Holiday Dress-Up", Bag tab **Holiday**, 2 x 3 x 1, six panel colors
(green first). A cozy little dressing booth: candy-cane posts with gold balls, a snowy roof with a
big gold star, a sign with a pixel Santa hat, star and elf hat, twinkly lights along the sign and
down the posts, a big mirror in a gold frame, a mini Santa hat and a mini elf hat on pegs, red
curtains tied back with gold (green on a red booth), presents on the stage, a soft white rug. It
gives a little light at night (8). She can walk onto its low stage.

Tap it -> a speech bubble over her head (the shared `.lf-bubble` style, `data-owner="holiday-looks"`)
titled "Holiday Dress-Up!" with **big round picture buttons**:

| side | buttons |
|---|---|
| girl (`g`) | Be an Elf (Elf Dress) - Be Santa - Santa Dress (Mrs. Santa) - Back to me |
| boy (`b`) or not sure (`n`) | Be an Elf (Elf Tunic) - Be Santa - Back to me |

The side is the Studio's Girl / Boy choice (`game.surpriseStyle()`); with none picked, her own
clothes decide (`lookLean`: hair counts twice, then one-side clothes, patterns, shoes and
accessories; a dress means girl). The costume she is wearing has a gold ring. "Back to me" is
greyed out (and says "You are you already!") when there is nothing to go back to.

A tap: the bubble closes, a **sparkle puff** (sparkles, stars, and snowflakes for a costume, the
`magic` sound) and a little twirl, and she is changed. The change is saved like any look change
(`profile.look`, `saveProfile(true)`), drawn at once (`'avatar:changed'`, `'outfit:changed'`) and
so reaches friends in a shared world like any Studio change (the net adapter repacks `_lk`).

**Her own look is kept.** `profile.holidayLooks = { v: 1, own, wearing }` keeps her own clothes
(top, bottom, dress, shoes, accessories) from before the first costume; a costume always goes on
over **her own** clothes (so nothing of a previous costume hides under it), switching costumes
keeps the first `own`, and "Back to me" puts those clothes back. Only clothes: a hair change in
the Studio while dressed up stays after "Back to me". If she changes in the Studio and wears no
holiday piece any more, the state is cleared, so "Back to me" never takes her somewhere old.

**Undo-safe.** Each booth change is one Undo step (`game.pushHistory`): Undo puts the previous
look and booth state back, Redo puts it on again. If her look changed since (the Studio), the
Undo step does nothing rather than throw away the newer look.

The bubble closes when she taps, walks more than 6 blocks from the booth, after 25 s untouched,
when a panel opens, when the booth goes away, or when the world unloads. It does not open while a
panel is up (one thing at a time); like ocean's dolphin bubble, a tap on the booth closes
merfolk's self-started choice bubble through `'ui:bubble-closed'` (wave4-integration.md §1.4).
It never opens by itself, so the webdriver rule (§1.5) does not apply.

### 1.5 Friends in Holiday Village

When she invites a friend in a Holiday Village world (`world.meta.biome === 'holiday'`), 1.6 s
later (after the hello line) the friend puts on a holiday outfit with the usual friend styling
moment (sparkles, a twirl, a "style" line): `game.friends.style(f, 'outfit', key)`. Host only
(skipped on a guest, for the host's friends seen remotely, and while a remote change applies).
Friends start from their own look in every world, so it is theirs again once they go home.

Nine friend outfits are appended to `OUTFITS` in `src/things/friends/looks.js` with tag `'h'`
(never on the "Dress up" bubble): `hl_elf_girl`, `hl_elf`, `hl_mrs_santa`, `hl_santa`, `hl_cozy`
(from `HOLIDAY_OUTFITS`), `hl_snowflake` (green snowflake sweater, Santa hat, a present),
`hl_snowflake_girl` (blue snowflake sweater, stripy tights, Santa hat, a candy cane),
`hl_reindeer` (brown hoodie, antlers, scarf), `hl_reindeer_girl` (tree sweater, red skirt,
antlers). Who wears what is picked by hand for a mix (`FRIEND_PICKS` in rules.js): three girl
elves, two Mrs. Santas, two cozy sweaters, two snowflake sweaters and a reindeer among the girls;
two elves, a Santa, a reindeer, a snowflake sweater and a cozy sweater among the boys. A later
friend gets one by a hash of their key.

### 1.6 Stickers (2)

| id | name | hint | earned |
|---|---|---|---|
| `look_elf` | Little Helper | Dress up as an elf | wearing the elf hat with the elf tunic or dress |
| `look_santa` | Ho Ho Ho! | Dress up as Santa | the Santa hat or beard with the Santa coat or dress |

Registered on `game:ready` (after the older ones in the book), each with its own 100 x 100 art
(an elf hat with bells and a candy cane on snow; a Santa face with a fluffy beard). The booth and
the Studio both earn them (any own look change that shows the costume). Each pays +20 through the
existing sticker listener.

---

## 2. Keys, ids, events, records

| kind | name |
|---|---|
| furniture | `holiday_booth` (Bag item `furn:holiday_booth`, category `holiday`), action `holiday_booth` |
| world feature | `holiday:dressup` `{ kind, x, y, z, rot? }` -> one booth at that anchor (front row middle, `rot` 0..3), placed with `worldFeatures.placeOpts()`, forced if the cells are not free |
| system | `holiday-looks` (no per-world save) |
| profile key | `profile.holidayLooks = { v: 1, own: { top, bottom, dress, shoes, acc } \| null, wearing: HOLIDAY_OUTFITS key \| null }` (read with `normState`, anything odd becomes "not dressed up") |
| events emitted | `'holidaylook:wear' { outfit, look }`, `'holidaylook:back' { look }`, plus the usual `'avatar:changed'` and `'outfit:changed'`; `'ui:bubble-closed' { owner: 'merfolk', by: 'holiday-looks' }` when the booth closes merfolk's bubble |
| events read | `'outfit:changed'`, `'avatar:changed'`, `'friend:invite'`, `'ui:open'`, `'world:unload'`, `'ui:bubble-closed'` (owner `holiday-looks`), `'game:ready'` |
| stickers | `look_elf`, `look_santa` |
| facade | `game.holidayLooks = { dress(idOrKey), back(), state(), buttons(), open(entity?), close() }` |
| debug | `game.debug.holidayLooks = { state, side, dress, back, open, close, bubble() (button ids or null), friendKey(friendKey), dressFriends() }` |
| CSS | `.lf-bubble[data-owner="holiday-looks"]`, `.hl-on`, `.hl-off` |
| pictures | `holiday`, `santa`, `elf`, `santa_dress`, `my_look` in `src/ui/dressup/pictures.js` |
| look lists | the 20 keys in §1.1; `HOLIDAY_OUTFITS`, `holidayOutfit(key)`, `HOLIDAY_RED`, `HOLIDAY_GREEN`, `isHoliday(list, key)`, `wearsHoliday(look)` |
| friend outfits | `hl_*` (9), tag `'h'` |

## 3. Numbers

| what | value |
|---|---|
| list sizes after | TOPS 17, BOTTOMS 12, DRESSES 8, SHOES 11, HEAD_ACC 21, FACE_ACC 6, BACK_ACC 8, HAND_ACC 11, PATTERNS 15 (all < 36) |
| worst-case look string | 156 characters with holiday pieces (unchanged; limit 160); longest holiday look on 15,000 random looks with a random sea: 156 |
| old look strings | 257 goldens decode identically (default, 12 starters, 60 surprises, 16 friends, 14 friend outfits, every option of every list, every sea color, an old short string) |
| booth | 2 x 3 x 1, light 8, 6 colors, about 2,900 triangles |
| bubble | closes after 25 s, at 6 blocks from the booth |
| friend dress-up delay | 1.6 s after the invite |
| stickers | 2 (+20 each) |

## 4. How to test

```
node tools/test-holiday-looks.mjs                   # 13 checks, about 1.5 s
node tools/test-holiday-looks.mjs --shots=/tmp/hl   # also writes 4 pictures (read them)
node tools/build.mjs
node --test tools/test-name.mjs
node tools/test-merfolk.mjs; node tools/test-sea.mjs; node tools/test-vehicles.mjs; node tools/test-squish.mjs
node tools/test-net.mjs; node tools/probe-boys.mjs --only=unit
```

The checks: L1 lists only appended (and only by these 20 seasonal pieces, each < 36 long); L2 the
257 old look strings decode exactly the same; L3 the 60 seeded surprises are unchanged and 6,000
surprises wear nothing seasonal; L4 the ready-made row and the friends' bubble unchanged; C1
every piece round-trips the codec, the worst case is 156, every holiday look on 15,000 random
looks <= 160; O1 the holiday looks normalize, pack, keep hair and skin, fit their tags and are
recognised as costumes; B1-B2 the booth rules (costume, switch, Back to me, Studio changes, odd
states, buttons per side, the side of every starter); B3 the real module on a stand-in game (booth
and feature registered and placed, a costume with its sticker and one Undo step, Undo, Back to
me, an Undo after a Studio change keeps the Studio look, a friend dressed only in Holiday Village
and only on the host); F1 every friend's holiday outfit; A1 every piece builds on the avatar
(each hat with every one of the 19 hair styles, with the beard, sack and present) and the new
cloth and patterns paint; A2 the real avatar builds, animates and swaps all 21 holiday looks; M1
the booth model, colliders, stickers, pictures, and a name scan of every new string and file.

In a browser (for the integrator, no browser here): open a world, Bag > Holiday > Holiday
Dress-Up, place it, tap it: the bubble; Be an Elf / Be Santa / Back to me; Undo; the Studio's
Outfits tab "Holiday looks"; a Holiday Village world: invite a friend, 1.6 s later they change;
`window.__game.debug.holidayLooks` for the same steps.

## 5. As built

- All of §1 is built. Pictures were checked by eye with the Node renderer
  (`tools/lib/holiday-lookview.mjs`; textures are not drawn there, only cloth colors): the five
  holiday looks from four sides, every hat on long, short, afro and space-buns hair, all 16
  friends in their holiday outfits, and the booth in two colors from four sides. The booth
  buttons' pictures and the sticker art were looked at through a small path rasterizer.
- Fixed while looking: the knit band at the sweater's hem was hidden inside the long hem box; the
  beard first read as a white mask (now round puffs); the Santa hat's fur band read as teeth (now
  soft puffs); the antlers vanished into an afro (now lifted on tall hair); the booth's hats on
  pegs hid behind the curtains (narrower curtains, smaller mirror).
- `tagged()`'s fallback (a side with no options of its own, e.g. dresses for boys) now also
  skips seasonal options, so it returns exactly the old list.
- `wearsHoliday()` drives "is she dressed up"; `costumeShown()` (rules.js) drives the stickers.
- The codec needed nothing: every new value is an index in an existing list.

## 6. Wanted from the integrator

1. `tools/probe-boys.mjs` line 112, the A1 sizes (the only check that turns red; it compares exact
   list sizes):
   `const counts = { HAIR_STYLES: 19, TOPS: 14, BOTTOMS: 10, SHOES: 9, HEAD_ACC: 17, BACK_ACC: 7, NECK_ACC: 7, HAND_ACC: 9, PATTERNS: 12 };`
   ->
   `const counts = { HAIR_STYLES: 19, TOPS: 17, BOTTOMS: 12, SHOES: 11, HEAD_ACC: 21, BACK_ACC: 8, NECK_ACC: 7, HAND_ACC: 11, PATTERNS: 15 }; // wave 5: + holiday pieces`
   and, if that check also counts DRESSES or FACE_ACC anywhere, DRESSES 8, FACE_ACC 6.
2. `package.json` scripts: `"test:holiday-looks": "node tools/test-holiday-looks.mjs",`
3. `src/core/storage.js` line 87 `BACKUP_PROFILE_KEYS`: append `'holidayLooks'` (so a backup that
   restores a costume look also restores "Back to me"). Newer-wins merging is enough
   (`src/account/merge.js` needs nothing).
4. `src/ui/inventory.js` `TAB_PICS`: the `holiday:` line belongs to holiday-world; please make
   sure `furn:holiday_booth` is in it or near it if the tab shows a picture list.
5. `docs/DESIGN.md` (look lists, one line): "Wave 5 appended 20 holiday pieces (`season:
   'holiday'`, never in surprises), `HOLIDAY_OUTFITS` (Studio: Holiday looks), the Holiday
   Dress-Up booth (`holiday_booth`) and `profile.holidayLooks`; see docs/teams/holiday-looks.md."
6. `docs/MULTIPLAYER.md`: nothing new travels; a booth change is an ordinary look change (`_lk`).
   Friends' holiday outfits are host-side friend looks, synced as before.
7. probe-merfolk's head-accessory pictures (`W.options().HEAD_ACC`) will now also show the four
   holiday head pieces with the sea dragon; the horn nubs hide under hats as before (only no head
   accessory or a bow shows them). Re-take those pictures once.

## 7. Open questions for the owner

- Should Santa's beard also be offered in other colors in the Studio's swatches (it takes any
  face-accessory color; white is the default)?
- Friends change into holiday outfits only when invited in Holiday Village. Should friends
  already in a Holiday Village world from an older save change too the next time it loads?
  (`game.debug.holidayLooks.dressFriends()` does it on demand.)
- Should the booth also offer "Be a Reindeer" (antlers, brown sweater) for the little brother?
- The holiday pieces show all year in the Studio (at the end of each list). Should they hide
  outside December, or stay free all year as now?
