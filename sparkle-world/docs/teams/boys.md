# Team "boys": boy looks, boy friends, and words that fit every player

Request (dad and daughter, 2026-10-01): *"Okay can you please make boys characters as well as
boats and cars and vans you can drive please."* This document covers **boy characters** only:
the player's avatar, the NPC friends, neutral words about real players, the website wording
and the multiplayer look codec. Boats, cars and vans are a separate team; the touch points are
listed in section 13.

Status: BUILT (wave 3). The plan below was written before the code changed: every `file:line`
is the code as of commit `96565e4` on `claude/girl-game-world-building-gp6bnl`. What was built,
and where it differs from the plan, is in "As built" at the end.

---

## 0. Decisions at a glance

| Question | Decision |
|---|---|
| How does a look "read as a boy"? | New short hair styles (7), boy tops (6), bottoms (3), shoes (2), caps / bucket hat / headphones, star backpack, tie / medal, 3 toys to hold, 5 new patterns, and a **Bold** eyebrow choice. Eyelashes are already optional (`eyes.lashes`). |
| New look keys | Only two: `face.brows` (`'soft'` \| `'bold'`) and `top.num` (jersey number, 0 to 99). Everything else is new **values** appended to existing option lists. |
| Option lists | **Append only.** No existing entry moves, so old saves and the codec's index tokens keep their meaning. |
| "Surprise me!" | A **Girl / Boy / Mix** toggle next to Surprise me! (one button that cycles). Stored in `profile.lookStyle`. Missing = `'girl'`, so the daughter's surprises are exactly what they are today. |
| Ready-made looks | 6 boy starter looks appended to the 6 girl ones (Outfits tab: 12 tiles). |
| First run | No new modal (it would block every probe that clicks the title, and existing players). Instead the title's **Dress Up** tile wiggles with a sparkle badge while the look was never touched, and opens the Studio on the **Outfits** tab where the boy looks and the Girl / Boy / Mix toggle are. |
| NPC friends | 6 boys (Leo, Max, Kai, Sam, Ezra, Theo) join the 10 girls (16 in the roster, still max 6 per world). Each def gets `pronoun: 'she' \| 'he'` and `kind: 'girl' \| 'boy'`. |
| Real players | Text about real players never says "her/she": the name, "they", or a rephrase. Story-book animals keep their pronouns. |
| Website | A neutral wording pass ("your child", "they", "kids"). The origin story ("a list from a girl who is almost 8", "a dad and his daughter") stays because it is true. Image alt text stays true to each picture. |
| Server consent notice | **Not changed in this build** (pinned, versioned legal text; see Open question Q1). |
| Multiplayer | Two tokens appended to the end of the look string; still at most 151 characters. NPC records already carry the full look JSON. No new presence fields. |

---

## 1. Goals

1. A boy can make himself in the Dress-Up Studio in under a minute, and the result clearly
   reads as a boy at game distance (short hair, no lashes, bold brows, boy clothes).
2. A girl's game is unchanged unless she chooses otherwise: default look, default Surprise me!
   behaviour, existing tiles in the same order, existing friends with the same looks.
3. Six cool boy NPC friends with their own looks, names, voices, speech lines and the right
   pronoun everywhere the game talks about them.
4. No text about a real player assumes a girl.
5. The website talks about "your child" and "kids", keeps the true origin story, and lists boys
   (and vehicles, when that team ships) in the feature list.
6. Old saves, old outfits, old backups, cloud profiles and multiplayer keep working. The picture
   stays exactly as sharp, and no new per-frame cost is added.

Non-goals: a "gender" field (a look is just clothes and hair; anyone can wear anything);
changing the default player name `Lily` (tests and the net name logic depend on it, see
`src/net/adapter.js:570`, `src/net/ui.js:643`, `tools/probe-menus.mjs:59`); changing the
parents' consent notice (Q1).

---

## 2. How the avatar is built today (what it takes to add each thing)

- `createAvatar(look)` (`src/player/avatar.js:159`) normalizes the look, then `build()`
  (`avatar.js:368`) runs `buildBody`, `buildOutfit` (`avatar/outfit.js:27`, `:45`),
  `buildHair` (`avatar/hair.js:328`) and `buildAccessories` (`avatar/accessories.js:446`) on a
  `BuildContext` (`avatar.js:60`). Each piece is drawn with `P.B(bone, material)`: all boxes
  for one (bone, material) pair are merged into **one mesh** (`avatar.js:378-388`). So a new
  item drawn with an existing material on an existing bone costs **zero draw calls**.
- Materials: `'plain'` (vertex colors), `'hair'` (strand texture), `cloth:<spec>` (a 128 px
  pattern tile from `paintCloth`, `avatar/textures.js:140`, cached by `clothKey`,
  `textures.js:257`), `glasses:`, `wing:`, `glow`, `bright` (`avatar.js:198-235`).
- Hair: a style is one function in `STYLES` (`hair.js:157`) plus a color range in `RANGES`
  (`hair.js:13`, used by ombre/tips in `hairColors`, `hair.js:20`). Helpers: `helmet` (cap of
  hair, `hair.js:50`), `bangs` (`:81`), `sideLocks` (`:102`), `chain` (swinging bones,
  `:125`; each chain bone is one more mesh). Hair is built **before** accessories, so a style
  can read `P.look.acc.head` (to flatten under a cap).
- Tops / bottoms / shoes: `buildOutfit` switches on type (`outfit.js:94-163` chest details,
  `:184-200` sleeves via `SLEEVES` `:16`, `:202-218` legs via `PANTS` `:22`), `buildShoes`
  (`outfit.js:333`). Fabric per type: `FABRIC` (`outfit.js:10`). Pixel decals: `heartDecal`
  (`outfit.js:237`), each pixel one box on the torso `'plain'` builder.
- Accessories: `HEAD` table (`accessories.js:24`), `buildFace` (`:189`), `buildBack` (`:246`),
  `buildNeck` (`:301`), `buildHand` (`:347`, upright items on the `handItem` bone, defaults
  in `HAND_DEFAULT` `:345`).
- Face: eyes/brows/blush/freckles are painted on one 256x128 canvas per eye variant
  (`paintEyes`, `textures.js:310`; brows at `:340-347`, lashes at `:357`, `:376`, `:431-452`),
  keyed in `acquireFace` (`avatar.js:260-289`).
- The look schema, option lists, `normalizeLook`, `randomLook`, `STARTER_OUTFITS` and
  `applyOutfit` live in `src/player/wardrobe-data.js` (lines 14, 32-85, 132, 210, 265, 328).
- Everyone else draws avatars through the same code: the player (`player.js:39`), the title
  backdrop (`ui/menus/backdrop.js:301`), the Studio preview (`ui/dressup.js:808`), the shared
  snapshot stage (`ui/dressup/stage.js:176`; used by account portraits `account/portrait.js:17`,
  the Players list `net/ui.js:313`, friend cards `things/friends/ui.js:158`, emote wheel
  `player/emotes.js:54`, shopkeepers `things/shops/panel.js:284`), remote players
  (`net/remote-players.js:436`) and NPC friends (`things/friends/friend.js:34`). So adding the
  items in the avatar files makes them work in portraits, thumbnails and photo mode with no
  change there (the `head` frame, `stage.js:25`, spans y 0.94 to 2.16, which fits every new hat).

---

## 3. Data shapes

### 3.1 Look (profile `look`, saved outfits, friend saves, backups)

Two new keys; both have defaults, so every old look normalizes:

```js
face: { blush, freckles, smile, brows: 'soft' | 'bold' },   // NEW brows, default 'soft'
top:  { type, color, pattern, patternColor, num: 0..99 },   // NEW num, default 7 (drawn on 'jersey' only)
```

`DEFAULT_LOOK` (`wardrobe-data.js:14`) gains `face.brows: 'soft'` and `top.num: 7`. The
default picture does not change (soft brows are today's brows; `num` is only drawn on a jersey).

`normalizeLook` (`wardrobe-data.js:132-176`):

```js
const int = (v, lo, hi, d) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : d);
face: { ..., brows: one(face.brows, KEYS.brows, 'soft') },
top: { ...garment(l.top, d.top, KEYS.top), num: int(l.top && l.top.num, 0, 99, 7) },
```

`num` is added to `top` only (not `bottom` / `dress`, which also use `garment()` at
`wardrobe-data.js:121`). Strings, NaN and Infinity fall back to 7.

New exported list: `BROWS = opts([['soft', 'Soft'], ['bold', 'Bold']])`, and `KEYS.brows`.

### 3.2 Option lists: appended values (never reorder)

Each option object gains an optional `tag`: `'g'` (in the Girl surprise), `'b'` (in the Boy
surprise) or `'gb'` (both). `opts()` (`wardrobe-data.js:30`) becomes
`pairs.map(([key, name, tag = 'g']) => ({ key, name, tag }))`. The codec and the Studio ignore
`tag` except where stated.

Existing entries keep their place. Their tags (only `'g'` or `'gb'`, so the Girl filter is
exactly today's list and today's random sequence is unchanged):

| List | `'gb'` (both) | everything else existing is `'g'` |
|---|---|---|
| HAIR_STYLES | curly | |
| TOPS | tshirt, hoodie, sweater, jacket | |
| BOTTOMS | jeans, shorts, overalls | |
| SHOES | sneakers, boots, sandals, rainboots, roller_skates | |
| HEAD_ACC | beanie, witch_hat (Sparkly Hat) | (`none` is never picked by randomLook) |
| FACE_ACC | glasses, sunglasses, star_glasses | |
| BACK_ACC | backpack, cape | |
| NECK_ACC | scarf, bowtie | |
| HAND_ACC | wand, balloon, teddy, ice_cream | |
| PATTERNS | none, stars, stripes, dots | |

Appended (all tagged `'b'`; every option is still free for anyone in the Studio):

| List (file:line) | New `key` → name | Count after |
|---|---|---|
| HAIR_STYLES (`wardrobe-data.js:32`) | `buzz` Buzz Cut, `spiky` Spiky, `side_part` Side Part, `shaggy` Shaggy, `short_curly` Short Curls, `fauxhawk` Faux Hawk, `afro` Afro | 19 |
| TOPS (`:38`) | `polo` Polo, `jersey` Jersey, `button_up` Button-Up, `tee_dino` Dino Tee, `tee_rocket` Rocket Tee, `tee_bolt` Lightning Tee | 14 |
| BOTTOMS (`:42`) | `cargo_shorts` Cargo Shorts, `joggers` Joggers, `pants` Pants | 10 |
| SHOES (`:50`) | `high_tops` High-Tops, `skate_shoes` Skate Shoes | 9 |
| HEAD_ACC (`:54`) | `cap` Cap, `cap_back` Backwards Cap, `bucket_hat` Bucket Hat, `headphones` Headphones | 17 |
| BACK_ACC (`:63`) | `star_pack` Star Backpack | 7 |
| NECK_ACC (`:67`) | `necktie` Tie, `medal` Medal | 7 |
| HAND_ACC (`:70`) | `soccer_ball` Soccer Ball, `toy_car` Toy Car, `dino_toy` Toy Dino | 9 |
| PATTERNS (`:74`) | `plaid` Plaid, `checks` Checks, `bolts` Lightning, `dinos` Dinos, `rockets` Rockets | 12 |
| FACE_ACC, DRESSES, SMILES, HAIR_MIXES | unchanged | |

All lists stay under 36 entries, so every codec token stays one base-36 character.

### 3.3 Starter outfits (`STARTER_OUTFITS`, `wardrobe-data.js:265`)

Each entry gains `tag` (`'g'` for the 6 existing, `'b'` for the new ones) and may carry
`eyes` / `face` partial overrides. `applyOutfit` (`wardrobe-data.js:328`) adds:

```js
eyes: outfit.eyes ? { ...base.eyes, ...outfit.eyes } : base.eyes,
face: outfit.face ? { ...base.face, ...outfit.face } : base.face,
```

(skin, hair color, eye color and name still stay yours.) Appended entries:

| key | name | hairStyle | top | bottom | shoes | acc | eyes/face |
|---|---|---|---|---|---|---|---|
| `soccer` | Soccer Star | short_curly | jersey `#4D7CFF`, none, num **10**, patternColor `#FFFFFF` | shorts `#FFFFFF` | high_tops `#FF6B6B` | neck medal `#FF6B6B`, hand soccer_ball | lashes false, brows bold |
| `skater` | Skater | spiky | tee_bolt `#3A1F4D` | joggers `#6B7280` | skate_shoes `#FF6B6B` | head cap_back `#FF6B6B` | lashes false |
| `space` | Space Explorer | fauxhawk | tee_rocket `#3A1F4D` | joggers `#7048E8` | high_tops `#FFFFFF` | head headphones `#6CC6FF`, back star_pack `#6CC6FF` | lashes false |
| `dino` | Dino Explorer | buzz | tee_dino `#FFE58A` | cargo_shorts `#8B5E3C` | boots `#8B5E3C` | head bucket_hat `#6BD68A`, back backpack `#FFA94D`, hand dino_toy | lashes false |
| `camp` | Camping Day | shaggy | button_up `#FF6B6B`, plaid, patternColor `#3A1F4D` | jeans `#4D7CFF` | boots `#8B5E3C` | head beanie `#FFA94D` | lashes false, brows bold |
| `dapper` | Party Time | side_part | button_up `#FFFFFF` | pants `#3A1F4D` | sneakers `#FFFFFF` | neck bowtie `#FF5FA2`, hand balloon `#6CC6FF` | lashes false |

Girls' starters have no `eyes` / `face` overrides, so they behave exactly as today.

### 3.4 Profile

```js
profile.lookStyle   // NEW, optional: 'girl' | 'boy' | 'mix'. Missing = 'girl' for Surprise me!
                    // and "never chosen" for the auto-switch rule (section 5.3)
profile.lookPicked  // NEW, optional: true once the Studio was closed after the title nudge
```

- `mergeProfile` in `src/core/game.js:60-69` spreads unknown keys, so both survive a load.
  `src/account/merge.js:43-54` copies the whole profile from the newer side, so they reach the
  cloud copy. Neither is device-local.
- Backups: add both to `BACKUP_PROFILE_KEYS` (`src/core/storage.js:86`). In
  `mergeBackupProfile` (`storage.js:110`) copy `lookStyle` only when `fresh` (like `look`,
  `storage.js:115`), and set `lookPicked = true` when either side has it.
- An old profile has neither key: Surprise me! is today's (girl), and the nudge only shows if
  the look is still exactly the untouched default (section 5.5).

### 3.5 NPC friend defs (`src/things/friends/looks.js:9`)

```js
{ key, name, style, color, pitch, icon, look, lines,
  pronoun: 'she' | 'he',      // NEW (defaults to 'she' for the existing ten in a loop after the list)
  kind: 'girl' | 'boy' }      // NEW (defaults to 'girl'): picks outfits, surprise and hair cycling
```

New helper in `looks.js`:

```js
export function pronouns(def) {
  return def && def.pronoun === 'he'
    ? { they: 'he', them: 'him', their: 'his', They: 'He' }
    : { they: 'she', them: 'her', their: 'her', They: 'She' };
}
```

The world save (`systems.friends`, `docs/teams/pals.md` "Save format") is unchanged in shape:
`{ v: 1, list: [{ id, key, name, look, mode, x, y, z, yaw, home, metAt }] }`. New keys
(`leo` ...) appear in `key`. Old builds drop unknown keys on load
(`things/friends/index.js:657`, `friendDef(d.key)` is null): this only matters if an older
build ever opens a newer world.

### 3.6 Presence and the look token (multiplayer)

No new presence fields. `lk` (`net/adapter.js:578-585`) gets two tokens appended (section 9).

---

## 4. Files to add and change

### 4.1 Add

| File | What |
|---|---|
| `tools/probe-boys.mjs` | The new probe (section 11.1). |
| `docs/teams/boys.md` | This document (builder appends "as built" notes at the end). |

### 4.2 Change (game)

| File | Functions / lines | Change |
|---|---|---|
| `src/player/wardrobe-data.js` | header comment `:1-12`; `DEFAULT_LOOK` `:14`; `opts` `:30`; lists `:32-77`; `KEYS` `:109`; `normalizeLook` `:132`; `THEMES` `:192`; `randomLook` `:210`; `STARTER_OUTFITS` `:265`; `applyOutfit` `:328` | Sections 3.1 to 3.3, and `randomLook(rand, name, base, style = 'girl')` (section 5.4). New exports: `BROWS`, `BOY_THEMES`, `tagged(list, letter)`. |
| `src/player/avatar/hair.js` | `RANGES` `:13`; `helmet` `:50`; `STYLES` `:157`; `buildHair` `:328` | 7 styles (section 6.1); `helmet` records `P.hairPuff`; `buildHair` sets `P.hatFlat` before calling the style. |
| `src/player/avatar/outfit.js` | `FABRIC` `:10`, `SLEEVES` `:16`, `PANTS` `:22`, `LONG_TOPS` `:23`; chest switch `:94-163`; waist button `:169`; legs `:202-218`; `buildShoes` `:333`; new `pixelDecal`, `DECALS`, `DIGITS` | Section 6.2 and 6.3. |
| `src/player/avatar/accessories.js` | `HEAD` `:24`; `buildBack` `:246` (backpack `:250-264`); `buildNeck` `:301`; `HAND_DEFAULT` `:345`; `buildHand` `:347` | Section 6.4. |
| `src/player/avatar/textures.js` | `paintCloth` patterns `:198-255`; `paintEyes` brows `:340-347` | 5 patterns; `o.brows === 'bold'`: lineWidth 8.5, flatter arc. |
| `src/player/avatar.js` | `acquireFace` `:262-270`; header comment `:1` | Add `look.face.brows` to the eye texture key (`base` at `:263`) and pass `brows` to `paintEyes`. Header: "a detailed, adorable blocky chibi kid". |
| `src/ui/dressup.js` | `TABS` `:19-33`; `COLOR_HINTS` `:46-50`; actions `:161-164`; `open` `:210`; `surprise` `:295`; `_buildTab` hair `:392`, face `:417-438`, tops `:439`, neck `:493`, outfits `:499-507`; new `_stepper`, `_order` | Section 5. |
| `src/ui/dressup/css.js` | actions `:39-40`, phone rules `:102-125`, `:151` | `.sw-dress-style` button, `.sw-dstep` stepper, `.sw-dtab--nudge`. |
| `src/ui/dressup/pictures.js` | `P` `:7` | New pictures `girl`, `boy`, `mix`, `brows`, `number`; `neck` redrawn with a tie next to the necklace. |
| `src/ui/dressup/debug.js` | `random` `:49`, `hairStyles` `:50` | `random(seed, base, style)`; new `options()` that returns every list's keys and tags (probe). |
| `src/ui/menus.js` | `refreshTitle` Dress Up tile `:368`; `playerName` `:212`; hello `:274`, `:343`, `:354` | Title nudge (section 5.5); "Hi there!" rule. |
| `src/core/storage.js` | `BACKUP_PROFILE_KEYS` `:86`; `mergeBackupProfile` `:110-124`; backup `about` `:1049` | Section 3.4; neutral string (section 8). |
| `src/things/friends/looks.js` | header `:1-3`; `FRIENDS` `:9-129`; after `:129`; `extra` `:138`; `ICONS` `:157`; `OUTFITS` `:160`; `wearOutfit` `:166`; `nextHair` `:175`; `surpriseLook` `:182` | 6 boys (section 7), `pronouns()`, outfit `tag`, kind-aware hair cycling / surprise; `wearOutfit` ignores `eyes` / `face` overrides. |
| `src/things/friends/chat.js` | `LINES` `:9-121`; `HAIR_NAMES` `:123`; `outfitLines` `:132-151`; `pickLine` `:201` | New compliments (section 8.3), `LINES_BOY` overrides for `style` and `hair`. |
| `src/things/friends/index.js` | `_refused` `:65`; `invite` toast `:105`; `sendHome` toast `:312`; `style()` `:441-455` | Pronoun strings; `style(f,'outfit'|'hair'|'surprise')` pass `f.def.kind`. |
| `src/things/friends/ui.js` | `MODE_TEXT` `:207` (used `:398`); style bubble `:335-342`; bye confirm `:463` | Pronoun strings; the Dress up bubble lists only outfits whose `tag` fits the friend's kind. |
| `src/things/friends/icons.js` | `PATHS` `:10`; `friendIcon` core list `:31` | New icons `rocket`, `dino`; add `'build'` to the core fallback list. |
| `src/things/pets.js` | `_refused` `:64` | Neutral string. |
| `src/net/protocol.js` | `MESSAGES` `:120`, `:121`, `:135` | Neutral strings. |
| `src/net/ui.js` | `:983`, `:1009`, `:1263`, `:1346` | Neutral strings. |
| `src/net/walkie/ui.js` | `:569` | Neutral string. |
| `src/net/codec.js` | `L` `:363-366`; `packLook` `:375`; `unpackLook` `:400` | Section 9. |
| `src/net/remote-players.js` | `list()` `:235-242` | Add `lk: f.lk` (debug only; the probe compares looks). |
| `src/ui/keepsafe.js` | note `:263` | Neutral string. |
| `src/account/cards.js` | note `:108` | Neutral string. |

### 4.3 Change (tests, site, docs)

| File | Change |
|---|---|
| `tools/test-net.mjs` `:129-133`, after `:157` | Add `'face.brows': wardrobe.BROWS` to the round-trip lists; jersey `num` 0, 7, 35, 36, 99 round trips; an old 50-token string (no tail) unpacks to `brows 'soft'`, `num 7`; `randomLook(rand, 'Zoe', null, 'boy')` and `'mix'` x 200 each through the same `check` (≤ 160 chars). |
| `tools/probe-multiplayer.mjs` `:572` | Regex becomes `/That's Lily's pet! Ask Lily to help/`. New test `LOOKS` after `HELD` (section 11.2). |
| `tools/probe-pals.mjs` `:365`, `:644` | Wait for `>= 16` invite pictures (was 10). Add one boy invite to the existing "six friends" scene so the draw-call log covers a boy. |
| `tools/site-shots.mjs` `:68` | Also set `g.profile.lookPicked = true` (keeps the marketing title shot free of the nudge badge). |
| `package.json` scripts | `"probe:boys": "node tools/build.mjs && node tools/probe-boys.mjs"` |
| `site/index.html`, `site/parents.html`, `site/privacy.html`, `site/terms.html`, `site/account.js` | Section 10. |
| `docs/DESIGN.md` | §1 Dress-Up Studio (`:58-62`): add Girl / Boy / Mix and the new categories. §2 Avatar (`:445-462`): lists, `face.brows`, `top.num`. §4 item 6 (`:875-878`): "friends: ten girls and six boys". |
| `docs/MULTIPLAYER.md` §5.13 (`:524-543`) | Add items 10 (`face.brows`) and 11 (`top.num`, base 36), "about 150 characters", and the append-only rule for lists. |
| `docs/teams/avatar.md`, `docs/teams/pals.md` | Short "see boys.md" notes where the lists and the ten friends are described. |

---

## 5. UI and controls (iPad / touch first)

### 5.1 Dress-Up Studio tabs (`src/ui/dressup.js:19-33`)

- Tab keys stay the same (`neck` stays `neck`; probes use `data-tab`). Only one label changes:
  `neck` "Necklaces" → **"Neck"**, with a picture that shows a tie and a necklace (aria-label
  "Neck: necklaces, ties and medals"). "Hats & Ears" and "Wings & Bags" already cover caps and
  the star backpack.
- **Hair** (`:392`): 19 tiles. **Face** (`:417`): a new "Eyebrows" grid (Soft / Bold, `frame:
  'face'`, `small: true`) right after Smile, before Eye color; the existing Eyelashes yes/no
  row (`:429`) stays.
- **Tops** (`:439`): 14 tiles. Under the colors, a new **"My number"** stepper, shown only when
  wearing a jersey (hidden otherwise, like the pattern color row): a big **−** button, the number
  in a jersey-shaped badge, a big **+** button (each at least 64 px, like the swatches), press
  and hold repeats every 120 ms. Clamped 0 to 99. Kind `'color'` (little sparkle, `pop`).
- **Bottoms / Shoes / Hats / Back / Neck / Hand**: the new tiles; **patterns** row shows 12.
- **Item order follows the style**: `_order(list)` puts tiles whose `tag` contains the current
  style letter first (stable sort; Mix keeps list order). With `lookStyle` unset or `'girl'` the
  order is exactly today's. Changing the style clears `this.views` so tabs rebuild in the new
  order (`showTab` rebuilds from the cache at `:337-341`).
- `COLOR_HINTS` (`:46-50`) additions: head `cap '#4D7CFF'`, `cap_back '#FF6B6B'`,
  `bucket_hat '#6BD68A'`, `headphones '#6CC6FF'`; neck `necktie '#4D7CFF'`, `medal '#FF6B6B'`;
  back `star_pack '#6CC6FF'`.

### 5.2 Outfits tab (`dressup.js:499-507`)

"Ready-made looks" shows 12 big tiles, ordered by `_order` (boys first for a Boy style). Tapping a
boy look applies it (section 3.3) with the usual `dance` emote and `magic` sound.

### 5.3 The Girl / Boy / Mix toggle

- One button in the actions row (`dressup.js:161-164`) between **Surprise me!** and **Undo**:
  picture + label **Girl** (bow picture), **Boy** (cap picture) or **Mix** (bow and cap).
  Each tap cycles Girl → Boy → Mix → Girl, plays `pop`, saves `profile.lookStyle`,
  `game.saveProfile()`, and rebuilds the tab order. aria-label: "Surprise style: Boy".
- Phones (`css.js:102-125`, `:151` at ≤ 480 px): the label hides and the picture stays (all
  three buttons fit a 360 px row: about 150 + 64 + 90 px plus gaps).
- **Surprise me!** (`dressup.js:295`) becomes
  `W.randomLook(Math.random, this.look.name, this.look, this.game.profile.lookStyle || 'girl')`.
- **Auto rule**: when `lookStyle` is missing and a Ready-made look is picked, set `lookStyle` to
  that look's tag (`'boy'` for a boy look, `'girl'` for a girl look). An explicit toggle tap
  always wins and is never overwritten.

### 5.4 `randomLook(rand, name, base, style)` (`wardrobe-data.js:210`)

- `'girl'` (default): the exact code of today, picking from `tagged(list, 'g')`, which equals
  today's lists. Not one extra `rand()` call, so seeded results are identical (probe check B1).
- `'boy'`: `BOY_THEMES` (6 color stories: *team* `#4D7CFF/#FF6B6B/#FFFFFF`, *ocean*
  `#6CC6FF/#3FD8B0/#4D7CFF`, *forest* `#6BD68A/#8B5E3C/#FFE58A`, *sunset*
  `#FFA94D/#FF6B6B/#FFE58A`, *space* `#3A1F4D/#7048E8/#6CC6FF`, *dino* `#B8F2A0/#FFA94D/#6BD68A`);
  `dress` always null; hair, top, bottom, shoes from `tagged(list, 'b')`; patterns from
  `none, stars, stripes, dots, plaid, checks, bolts, dinos, rockets`; head 50% from tagged b
  (no `none`), face 20%, back 25%, neck 15%, hand 30%; when there is no `base`: lashes 15%,
  blush 50%, freckles 25%, brows bold 55%; `top.num` = `1 + floor(rand() * 99)`.
- `'mix'`: one `rand()` picks the girl or boy branch, then the hair style is picked from the
  whole list.
- With `base` (the Studio's case) name, skin, eyes and face stay, as today.
- Guard: `tagged()` falls back to the whole list if a filter is ever empty, so `pick()` can
  never return `undefined`.

### 5.5 First run: the title nudge (no modal)

- `fresh(profile)` = `!profile.lookPicked && lookSignature({ ...profile.look, name: 'Lily' })
  === lookSignature(DEFAULT_LOOK)` (the look was never changed).
- While fresh, the title's **Dress Up** tile (`menus.js:368`) gets the class `sw-tile--nudge`:
  a gentle wiggle every 4 s and a small sparkle badge (CSS only, no new element, so no layout
  or overlap change; `prefers-reduced-motion` turns the wiggle off). Its click runs
  `game.runAction('dressup', { tab: 'outfits' })` instead of the last tab.
- The Studio's `close()` (`dressup.js:224`) sets `profile.lookPicked = true` whenever it was
  opened while fresh, so the nudge goes away after one visit.
- Players with any changed look (everyone who played before) never see it.
- The hello bubble (`menus.js:274`, `:343`, `:354`) says **"Hi there!"** instead of
  "Hi, Lily!" when `!profile.nameSet && name === 'Lily' && profile.lookStyle === 'boy'`. A fresh
  profile has no `lookStyle`, so `tools/probe-menus.mjs:59` (`/Hi, Lily!/`) still passes.
- Why not a "Who do you want to be?" card: a modal on a fresh profile would cover the title for
  every browser probe (smoke, menus, avatar, pals, shops, keepsafe, multiplayer all start fresh
  and click title buttons), and for players coming back on a new device.

### 5.6 NPC friend bubbles and panels (`src/things/friends/ui.js`)

- Dress up bubble (`:335-342`): boys show their 6 boy outfits, girls their 6 girl outfits plus
  Party and Mermaid (8, as today), then Surprise!, New hair, Twins!, Back.
- **New hair** cycles inside the friend's kind (`tagged(HAIR_STYLES, 'g' | 'b')`), so a boy
  friend cycles buzz → spiky → ... and a girl friend cycles exactly today's 12 (plus curly is
  in both).
- **Surprise!** uses `randomLook(Math.random, name, look, def.kind)`.
- The invite roster (`ui.js:425-458`) shows 16 cards (grid `minmax(140px, 1fr)`, `:55`;
  phones `110px`, `:67`); the order of `FRIENDS` interleaves girls and boys (section 7).

---

## 6. The new pieces (geometry recipes)

All new geometry uses existing materials on existing bones unless stated, so it adds no draw
calls. Every loop has a constant bound (integer counters, no float-step loops).

### 6.1 Hair (`hair.js`)

`helmet` stores `P.hairPuff = puff` (default 0). `buildHair` sets
`P.hatFlat = ['cap', 'cap_back', 'bucket_hat', 'beanie'].includes(P.look.acc.head)` before
calling the style. Only the new styles read `hatFlat` (old styles look exactly as today).
`RANGES` entries (top y, bottom y for ombre / tips):

| key | RANGES | Recipe |
|---|---|---|
| `buzz` | `[1.77, 1.42]` | `helmet({ sideBottom: 1.46, backBottom: 1.38, puff: -0.014, sideFront: 0.12 })`; a short straight hairline: 7 thin boxes y 1.6 to 1.665 at z 0.27 to 0.3 (no anime points). |
| `spiky` | `[1.95, 1.42]` | `helmet({ sideBottom: 1.44, backBottom: 1.36 })`, `bangs('short')`; 9 cones (`h.cone`, r 0.06 to 0.08, h 0.14 to 0.2) on top pointing up and back, tilts from `mulberry32(7)`; with `hatFlat` only the 3 front spikes peek out under the brim (h 0.06). |
| `side_part` | `[1.8, 1.42]` | `helmet({ sideBottom: 1.42, backBottom: 1.36 })`; swept fringe lifted into a swoop: 6 boxes rotated about x = 0.12 (the part), one darker strand (`C(19)` shaded) along the part line. |
| `shaggy` | `[1.78, 1.25]` | `helmet({ sideBottom: 1.32, backBottom: 1.22, puff: 0.012 })`, `bangs('wispy')` lowered 0.05, `sideLocks(1.3, { w: 0.04, tip: true })`, jagged back edge (as `helmet`'s dips but deeper). |
| `short_curly` | `[1.84, 1.3]` | `helmet({ sideBottom: 1.36, backBottom: 1.3, puff: 0.015 })`; 42 curls (`ccube` 0.085 to 0.1, `mulberry32(31)`) over crown, sides and back, face left open (same test as curly, `hair.js:246`). |
| `fauxhawk` | `[1.98, 1.44]` | buzz sides (`puff: -0.01`), then a central ridge of 5 tilted `ccube`s from z 0.24 to z -0.24, tallest in front (top y 1.98); with `hatFlat` the ridge top is 1.8. |
| `afro` | `[1.98, 1.24]` | `helmet({ sideBottom: 1.24, backBottom: 1.18, puff: 0.07 })`; 56 round curls (`ccube` 0.13, `mulberry32(53)`) on a sphere of radius 0.43 around (0, 1.62, -0.03), face open; `P.backZ = -0.42`. With `hatFlat`, `puff` 0.04 and the top row is skipped. |

The existing `curly` uses about 110 curls (`hair.js:241-262`); none of the new styles exceeds
60, so build time stays below curly's.

### 6.2 Tops (`outfit.js`)

| type | sleeves (`SLEEVES`) | Details (all on the torso `'plain'` builder `TP` unless noted) |
|---|---|---|
| `polo` | short | crew trim; two collar flaps (rotated boxes, `trimLight`) at y 1.04 to 1.1; a placket box and 2 buttons. |
| `jersey` | short | V-neck (two skin boxes, like `scoop`), sleeve stripes in `patternColor` (2 boxes per arm on the arm `'plain'` builder), **number** front (pixel digits, s = 0.028, centred at y 0.92) and back (s = 0.04, y 0.86, digits mirrored so they read from behind). Number color: `patternColor`, or `shade(color, -0.5)` / white when it equals the shirt color. |
| `button_up` | long; in `LONG_TOPS` | pointed collar (2 rotated boxes), placket, 4 buttons, chest pocket; plaid reads as flannel. |
| `tee_dino` | short | crew; a 13x10 pixel dino (green `#6BD68A`, belly `#B8F2A0`, eye ink), s = 0.016. |
| `tee_rocket` | short | crew; a 9x14 pixel rocket (white body, red fins `#FF6B6B`, blue window `#6CC6FF`, a yellow sparkle puff at the bottom instead of flames). |
| `tee_bolt` | short | crew; a 7x12 pixel lightning bolt (`#FFD43B`, edge `#FFA94D`). |

Decals use a new `pixelDecal(b, rows, x, y, z, s, palette)` (rows are strings, one char per
pixel; `heartDecal`, `outfit.js:237`, can call it). The decal is always drawn (it is the shirt),
over any pattern. `DIGITS` is a 3x5 pixel font for 0 to 9.

### 6.3 Bottoms and shoes (`outfit.js`)

- `cargo_shorts`: the shorts branch (`outfit.js:212-215`) handles both; cargo ends lower
  (y 0.40 instead of 0.46) and adds a side pocket per leg (`P.B(leg, bottomMat)` box + flap).
  Waist button (`outfit.js:169`) for `cargo_shorts` and `pants` too.
- `joggers`: in `PANTS`; `FABRIC.bottom.joggers = 'knit'`; ankle cuffs (knee bone, y 0.06 to
  0.12, `shade(bottomC, -0.15)`) instead of the light hem band; two white drawstrings at the
  waist.
- `pants`: in `PANTS`; cotton; the existing light hem band (`outfit.js:209`).
- `high_tops` (`buildShoes`): sneaker sole and toe cap as `sneakers`, shaft up to y 0.26 in
  the shoe color, white laces (4 rows), round ankle patch (`#FFFFFF` disc with a star in the
  shoe color).
- `skate_shoes`: chunky low shoe, thick white sole (0.05), a side stripe `shade(c, 0.4)`,
  white toe band.

### 6.4 Accessories (`accessories.js`)

| key | Recipe |
|---|---|
| `cap` | Crown: `cbox` from y 1.62 to 1.86, half width `0.36 + P.hairPuff`, depth -0.33 to 0.31; top button; front brim box z 0.28 to 0.52, y 1.64 to 1.67, `shade(c, -0.1)`; a small star badge (`#FFFFFF`). |
| `cap_back` | Same, rotated π about y (brim at the back), plus the strap gap: a skin-colored hair tuft is not drawn (keeps it simple). |
| `bucket_hat` | `cyl` crown r 0.36 h 0.2 at y 1.64; sloping brim `cyl` r 0.5 h 0.03 tilted down 0.12; band `shade(c, -0.15)`. |
| `headphones` | Band: 15 boxes on an arc of radius `0.4 + P.hairPuff` over the top (same loop as `headband`, `:151-156`); 2 cups (`ccube` 0.1 x 0.15 x 0.13) at x ±(0.37 + P.hairPuff), y 1.4; light cushions. |
| `star_pack` (back) | The backpack code (`:250-264`) with a `badge` parameter: a yellow 5-pixel star instead of the pink heart. |
| `necktie` (neck) | Knot (`ccube` 0.05) at y 1.05, z 0.125; tie 2 boxes narrowing to y 0.78, color c, a lighter stripe. |
| `medal` (neck) | V ribbon (2 rotated boxes, color c) down to y 0.9; gold disc (`cyl` r 0.045, `GOLD`) with a white star. |
| `soccer_ball` (hand) | On the `handItem` bone like `teddy` (`:383`): `sphere` r 0.09 white with 6 dark pentagon cubes. `HAND_DEFAULT '#FFFFFF'`. |
| `toy_car` (hand) | Voxel car 0.2 x 0.1 x 0.12: body c, a cab with two blue windows, 4 dark wheels (`cyl`), headlights. `HAND_DEFAULT '#FF6B6B'`. |
| `dino_toy` (hand) | Voxel dino 0.18 tall (body, head, tail, 3 back plates), color c, belly lighter. `HAND_DEFAULT '#6BD68A'`. |

### 6.5 Patterns (`textures.js:198-255`)

Inside the 128 px tile, seamless, drawn in `patternColor` like the others:
`plaid` (two 18 px bands each way at 45% alpha plus 2 px lines at 70%), `checks` (4x4
checkerboard), `bolts` (two bolts at the q / 3q spots), `dinos` (two dino silhouettes),
`rockets` (two small rockets with a sparkle). Same tile size, same cache, same sharpness.

### 6.6 Brows (`textures.js:340-347`)

`paintEyes(..., { brows })`: `'soft'` is today's code unchanged. `'bold'`: `lineWidth = 8.5`,
control point raised 2 instead of 4 (flatter, straighter), outer end 2 px lower. The texture key
in `acquireFace` (`avatar.js:263`) includes `brows`.

---

## 7. NPC friends: six boys

Appended to `FRIENDS` (`looks.js:9`) and interleaved in display order:
**Mia, Leo, Zoe, Kai, Ava, Max, Lily-Rose, Theo, Maya, Sam, Chloe, Ezra, Nia, Emma, Sofia,
Aria** (reorder the array; keys and looks of the girls are untouched). Every boy has
`pronoun: 'he', kind: 'boy'`, `eyes.lashes: false`.

| key / name | style | tag color | pitch | icon | look |
|---|---|---|---|---|---|
| `leo` Leo | Soccer Star | `#4D7CFF` | 0.94 | `ball` | skin `#C3845A`; short_curly `#1F1614`; eyes `#2E1E14`; blush off, smile grin, brows bold; jersey `#4D7CFF` num 10 (patternColor `#FFFFFF`); shorts `#FFFFFF`; high_tops `#FF6B6B`; neck medal `#FF6B6B`; hand soccer_ball |
| `max` Max | Skater | `#FF6B6B` | 0.92 | `skate` | skin `#F6D2B8`; spiky `#D9762F`; eyes `#3F7AC9`; blush on, freckles on, smile cat; tee_bolt `#3A1F4D`; joggers `#6B7280`; skate_shoes `#FF6B6B`; head cap_back `#FF6B6B` |
| `kai` Kai | Space Explorer | `#7048E8` | 0.98 | `rocket` (new) | skin `#8C5535`; fauxhawk `#1F1614` + `#7FD3FF` tips; eyes `#5A3A28`; blush on, smile open; tee_rocket `#3A1F4D`; joggers `#7048E8`; high_tops `#FFFFFF`; head headphones `#6CC6FF`; back star_pack `#6CC6FF` |
| `sam` Sam | Dino Explorer | `#6BD68A` | 0.9 | `dino` (new) | skin `#FFE6D8`; buzz `#C99A5B`; eyes `#3C9A64`; blush on, freckles on, smile grin; tee_dino `#FFE58A`; cargo_shorts `#8B5E3C`; boots `#8B5E3C`; head bucket_hat `#6BD68A`; back backpack `#FFA94D`; hand dino_toy |
| `ezra` Ezra | Builder | `#FFA94D` | 0.95 | `build` (core) | skin `#6D4029`; afro `#1F1614`; eyes `#2E1E14`; blush off, smile happy, brows bold; button_up `#FF6B6B` plaid `#3A1F4D`; jeans `#4D7CFF`; boots `#FFA94D`; hand toy_car `#FFD43B` |
| `theo` Theo | Magician | `#B36BFF` | 1.0 | `wand` | skin `#A96C45`; side_part `#3B2419`; eyes `#8A6A2E`; blush on, smile grin; button_up `#FFFFFF`; pants `#3A1F4D`; boots `#222230`; head witch_hat (Sparkly Hat) `#7048E8`; neck bowtie `#FF5FA2`; back cape `#7048E8`; hand wand `#FFE58A` |

Own lines (4 each, short, kind, nobody gets hurt):

- Leo: "Goal! Did you see that?", "Let's kick the ball around!", "Teamwork makes the dream work!", "High five, teammate!"
- Max: "Watch me skate! Whoosh!", "Let's build a skate ramp!", "Skating is the best!", "That was so cool!"
- Kai: "3, 2, 1, blast off!", "I want to visit every planet!", "Look! That star is winking at us!", "Let's build a rocket ship!"
- Sam: "Rawr! I'm a friendly dinosaur!", "Let's dig for dinosaur bones!", "Did you know some dinos had feathers?", "Stomp, stomp! Dino dance!"
- Ezra: "Let's build the tallest tower ever!", "I can build a road for my car! Vroom!", "Every house needs a cozy bed!", "Measure twice, build once!"
- Theo: "Abracadabra! Ta-da!", "Pick a card, any card!", "I can make sparkles appear! Look!", "The best magic is being kind!"

Names pass `sanitizeName` (`src/net/names.js`) unchanged and are not in its blocklist. Movement,
seats, beds, treats, sleepovers, the 6-per-world limit (`index.js:22`) and the LOD (`:23`) are
shared code and unchanged.

---

## 8. Every player-facing string

### 8.1 New item and control names (Studio, tiles, aria)

Hair: Buzz Cut, Spiky, Side Part, Shaggy, Short Curls, Faux Hawk, Afro.
Tops: Polo, Jersey, Button-Up, Dino Tee, Rocket Tee, Lightning Tee.
Bottoms: Cargo Shorts, Joggers, Pants. Shoes: High-Tops, Skate Shoes.
Hats: Cap, Backwards Cap, Bucket Hat, Headphones. Back: Star Backpack. Neck: Tie, Medal.
Hand: Soccer Ball, Toy Car, Toy Dino. Patterns: Plaid, Checks, Lightning, Dinos, Rockets.
Eyebrows: Soft, Bold (section title "Eyebrows"). Tops: "My number" (section title),
aria-labels "One less", "One more", "Number 10".
Style button: "Girl", "Boy", "Mix"; aria-label "Surprise style: Girl|Boy|Mix".
Tab: "Neck" (aria-label "Neck: necklaces, ties and medals").
Ready-made looks: Soccer Star, Skater, Space Explorer, Dino Explorer, Camping Day, Party Time.
Title: "Hi there!" (section 5.5).

### 8.2 Text about real players (all of it, before → after)

| File:line | Before | After |
|---|---|---|
| `src/net/protocol.js:120` (`host_gone`) | `{host} went home. Her world is saved at her house!` | `{host} went home. The world is saved at {host}'s house!` |
| `src/net/protocol.js:121` (`ended`) | same | same as above |
| `src/net/protocol.js:135` (`pet_owner`) | `That's {host}'s pet! Ask her to help.` | `That's {host}'s pet! Ask {host} to help.` (matches `net/facade.js:209` for friends) |
| `src/things/pets.js:64` | `That's your friend's pet! Ask her to help.` | `That's your friend's pet! Ask your friend to help.` |
| `src/things/friends/index.js:65` | `She's your friend's friend! Ask her to help.` | `That's your friend's friend! Ask your friend to help.` |
| `src/net/ui.js:983` | `It's her world` | `` `It's ${name}'s world` `` |
| `src/net/ui.js:1009` | `` `${name} goes back to her own world and can't come back in this game.` `` | `` `${name} goes back home and can't come back in this game.` `` |
| `src/net/ui.js:1263` | `` `${who} knocked while you were busy. She can knock again!` `` | `` `${who} knocked while you were busy. They can knock again!` `` |
| `src/net/ui.js:1346` | `` `${cap(who)} isn't playing right now. Ask her for a new code!` `` | `` `${cap(who)} isn't playing right now. Ask for a new code!` `` |
| `src/net/walkie/ui.js:569` | `Mute next to a friend turns her walkie off for everyone.` | `Mute next to a friend turns that friend's walkie off for everyone.` |
| `src/ui/keepsafe.js:263` (grown-ups note) | `...on this website her worlds live only in this browser... One file keeps ${'her world'|'both worlds'|'all n worlds'}, her look and stickers...` | `...on this website your child's worlds live only in this browser... One file keeps ${'the world'|'both worlds'|'all n worlds'}, the look and stickers...` |
| `src/account/cards.js:108` | `Grown-ups: they are copied into her worlds and her cloud copy.` | `Grown-ups: they are copied into that player's worlds and cloud copy.` |
| `src/core/storage.js:1049` (backup file `about`) | `...a copy of every world, her look, outfits and stickers...` | `...a copy of every world, your look, outfits and stickers...` |

Code comments that say "her" (many, e.g. `net/guest.js:32`, `net/host.js:26`) are not shown to
anyone and are left alone.

### 8.3 Text about NPC friends (pronoun from the def)

| File:line | Before | After |
|---|---|---|
| `things/friends/index.js:105` | `${def.name} is here! Tap her to play!` | `` `${def.name} is here! Tap ${p.them} to play!` `` |
| `things/friends/index.js:312` | `${f.name} went back to her spot!` | `` `${f.name} went back to ${p.their} spot!` `` |
| `things/friends/ui.js:207`, `:398` | `MODE_TEXT.home = 'At her spot'` | `modeText(mode, def)`: `` `At ${p.their} spot` `` (others unchanged) |
| `things/friends/ui.js:463` | `You can invite her again!` | `` `You can invite ${p.them} again!` `` |
| `things/friends/looks.js:55` (Lily-Rose) | `Every girl is a princess!` | `Everyone can be royal!` |

Chat (`chat.js`):

- `LINES_BOY` used by `pickLine` for boys when the kind is `style` or `hair`:
  style: "I love it! Thank you!", "I look so cool!", "Do I look awesome?", "This is my new
  favorite!", "So stylish!"; hair: "New hair! I love it!", "Ooh, so cool!", "My hair looks
  awesome!". (Girls keep `chat.js:36`, `:38`.)
- Hair compliments (`chat.js:147`): new styles use `HAIR_PRAISE` instead of
  `` `Your ${hn} hair is so pretty!` ``: buzz "Cool buzz cut!", spiky "Your spiky hair is
  awesome!", side_part "Your hair looks so sharp!", shaggy "Your shaggy hair is so fun!",
  short_curly "I love your curls!", fauxhawk "Whoa, a faux hawk! So cool!", afro "Your afro is
  awesome!".
- Outfit compliments (`chat.js:96-120`): head cap "Cool cap!", cap_back "Backwards cap! So
  cool!", bucket_hat "Nice bucket hat!", headphones "What song are you listening to?"; back
  star_pack "Cool star backpack!"; neck necktie "A tie! So fancy!", medal "A gold medal! You're
  a champion!"; hand soccer_ball "Let's play soccer!", toy_car "Vroom vroom! Cool car!",
  dino_toy "Rawr! I love your dino!"; shoes high_tops "Cool high-tops!", skate_shoes "Nice skate
  shoes!"; new `top` map (only without a dress): jersey "Number {num}! Go team!", tee_dino
  "Dinosaurs are the best!", tee_rocket "To the moon! Cool rocket!", tee_bolt "Lightning fast!".
  `fill()` (`chat.js:125`) also replaces `{num}`.

Story-book text about animal characters (`things/furniture/panel-book.js:237-268`) stays.

---

## 9. Multiplayer

- **Look token** (`codec.js:375`, `:400`; MULTIPLAYER.md §5.13): append two tokens after
  `handColor`: `tokIdx(IDX.brows, l.face.brows)` and `(l.top.num | 0).toString(36)`. Unpack
  reads them last: `brows = opt(L.brows)`; `num = parseInt(next(), 36)`, kept only if an
  integer 0 to 99. A string without the tail (`next()` returns `'-'`) gives `undefined` and
  `normalizeLook` fills `'soft'` and 7. Add `brows: BROWS` to `L` (`codec.js:363`).
- **Length**: today's worst case is 147 characters (measured with `packLook` on a look with
  every optional color set); the tail adds at most 4 (two dots, 1 + 2 characters): **151**.
  Below the test's 160 (`tools/test-net.mjs:139`) and the presence cap of 200
  (`net/guest.js:173`, `net/host.js:144`, `:1231`).
- **Lists append only**: indices of existing options never change. Peers must have the same
  build anyway (`pv`, `net/host.js:215`, `net/guest.js:147`), so a new index never reaches an
  old page; if it ever did, `opt()` returns `undefined` and the default is used (`codec.js:405-407`).
- **NPC friends**: the actor record carries the full look JSON (`net/actors.js:217`, `:243`);
  `normalizeLook` handles the new keys. The pronoun comes from `friendDef(key)` on each page,
  so guests say "Tap him" correctly with nothing new on the wire. Guests tapping a host's friend
  get the existing neutral refusal (`net/facade.js:209`).
- **Host authority**: unchanged. Looks are presence (each player owns their own); NPC styling on a
  guest goes through `_refused()` (`friends/index.js:61-67`).
- **Remote avatars** rebuild at most once a second per friend (`remote-players.js:31`, `:363`).

---

## 10. Website wording pass

Rules: "your child" / "each child" / "kids" / "they"; keep the true origin story; keep each
alt text true to what its picture shows (the existing screenshots show a girl, so "a girl" stays
in those alts); keep every phrase `tools/site-check.mjs` looks for (it checks none of the
pronouns; it does check `nothing to buy inside`, `earned by playing`, `cloud copy`,
`download or delete`, `one cookie`, `walkie-talkie`, `recorded`, `mute`, `only works on this
website`, `Family page`, `multiplication`, `November 2, 2026`, `renews automatically every
month`, `cancel any time`, `no partial refunds`, `United States`, `no in-app purchases`,
`no free trial`, the operator lines, `Railway`, `Stripe`, `never recorded`, `10 business days`,
`90 days`; `site-check.mjs:507-527`). None of the edits below touches those phrases.

### 10.1 `site/index.html`

| Line | Change |
|---|---|
| 72, 139, 207, 227, 253 (alt) | Keep (each describes its screenshot truthfully). Only if the screenshots are retaken (`npm run shots:site`) must the alts be rewritten; 207 lists the 12 styles visible in that picture. |
| 111 | `Everything on her wish list.` → `Everything on the wish list.` |
| 112 | Keep the first sentence (true); append: `Then she asked for boys to play with, so they are inside too.` (+ `and cars, boats and vans to drive` only in the deploy that ships vehicles). |
| 203 | `The Dress-Up Studio has 12 hair styles, tops, skirts, dresses and shoes, hats and tiaras, ...` → `The Dress-Up Studio has 19 hair styles, from braids and space buns to buzz cuts and faux hawks, tops, jerseys, skirts, dresses, shorts and shoes, hats, caps and tiaras, glasses, wings and backpacks, and something to hold. Everything comes in lots of colors and patterns: hearts, stars, stripes, dots, plaid, dinos, rockets, rainbow and flowers. Or tap Surprise me! and pick Girl, Boy or Mix.` |
| 224 | `...leaving a rainbow trail behind her.` (the unicorn) → `...leaving a rainbow trail behind it.` |
| 246 | `Invite friends from a group of ten girls, each with her own style.` → `Invite friends from a group of ten girls and six boys, each with their own style.` |
| 429, 434, 439 | `Then she holds a button to talk` → `Then your child holds a button to talk` |
| 437, 442 | `so they follow her to another device` → `so they follow your child to another device` |
| 470 | `Up to 6 kids, each with her own player and worlds` → `Up to 6 kids, each with their own player and worlds` |
| 492 | Keep `It was made for a girl who is almost 8` (true); last sentence → `Kids who love building, dressing up, pets and adventures will feel right at home.` |
| 505, 522 | `she holds the walkie button ... as soon as she lets go ... hear her live` → `your child holds the walkie button ... as soon as they let go ... hear them live` |
| 535 | `as she plays ... so her worlds follow her` → `as your child plays ... so their worlds follow them` |
| 539 | `sets up her device ... she taps her picture` → `sets up the child's device ... the child taps their picture` |
| 424, 582 | Keep (`A dad made this for his daughter`, `Made with love by a dad and his daughter.`: true). |

### 10.2 `site/parents.html`

| Line | Change |
|---|---|
| 40, 203 | Keep (origin story). |
| 89 | `A friend opens this same website on her own device` → `on their own device` |
| 92, 94 | `switched Play with friends on for her` → `switched Play with friends on for that child` |
| 101 | `a copy of her world ... on her device` → `a copy of the host's world ... on the host's device` |
| 102 | `Her world is saved on her device.` → `The host's world is saved on the host's device.` |
| 104 | `(the girls you can invite to live in your world)` → `(the girls and boys you can invite to live in your world)` |
| 116 | `(her own, her pets' and her worlds')` → `(their own, their pets' and their worlds')` |
| 127 | `She holds the walkie button ... the moment she lets go.` → `A child holds the walkie button ... the moment they let go.` |
| 129 | `just for herself` → `just for themselves` |
| 139, 141 | `on the device she plays on, as she plays` → `on the device your child plays on, as they play` |
| 148 | `her avatar and its picture, her progress ... and her worlds` → `their avatar and its picture, their progress ... and their worlds` |
| 170 | `come into her world` → `come into the host's world` |
| 187 | `See her data, download her worlds` → `See a child's data, download their worlds` |

### 10.3 `site/privacy.html` (legal; wording only, no change in what is collected)

| Line | Change |
|---|---|
| 88 | `her avatar and its picture, her game progress and her worlds, only to run the game for her` → `their avatar and its picture, their game progress and their worlds, only to run the game for them` |
| 99 | `not her real name). It shows her player` → `not their real name). It shows their player` |
| 100 | `Her avatar (how she dressed up her player) and a small picture of her avatar's head ... They show her player` → `Their avatar (how they dressed up their player) and a small picture of their avatar's head ... They show their player` |
| 101 | `Her game progress ... how many things she has built or cooked, and her game settings` → `Their game progress ... how many things they have built or cooked, and their game settings` |
| 102 | `Her worlds, including the names she types for her worlds and her pets ... follow her` → `Their worlds, including the names they type for their worlds and pets ... follow them` |
| 104 | `run the game for her: to save and load her worlds, show her player, and let her play` → `run the game for them: to save and load their worlds, show their player, and let them play` |
| 105 | `her worlds stay on that device only and nothing about her reaches our server ... while she plays` → `their worlds stay ... nothing about them reaches our server ... while they play` |
| 127 | `a game she joins or hosts see her nickname, her avatar` → `a game they join or host see their nickname, their avatar` |
| 128 | `hear her voice live while she holds the walkie button` → `hear their voice live while they hold the walkie button` (keeps `never recorded`) |
| 130 | `keeping her worlds` → `keeping their worlds` |
| 177 | `See her data on the Family page shows her worlds` → `See <nickname>'s data on the Family page shows their worlds` (matches the real button, `site/account.js:1085`) |
| 178 | `Download her worlds` → `Download their worlds` |
| 188 | `a code sent to her email` (the grown-up) → `a code sent to their email` |

### 10.4 `site/terms.html`

| Line | Change |
|---|---|
| 126 | `a nickname for each child that is not her real name` → `that is not their real name` |
| 127 | `whether she may play with friends` → `whether they may play with friends` |
| 165 | Keep. |

### 10.5 `site/account.js` (Family page)

| Line | Change |
|---|---|
| 686 | `Up to 6 kids, each with her own player` → `each with their own player` |
| 845 | `A nickname, not her real name.` → `A nickname, not their real name.` |
| 859 | `Each child gets her own player, with her own worlds and stickers.` → `Each child gets their own player, with their own worlds and stickers.` |
| 1429 | `a code to type on her iPad, phone or computer` → `a code to type on your child's iPad, phone or computer` |

`site/account/verify.html:51`, `site/account.html:55`: keep (origin footer).

### 10.6 Not changed here: the consent notice

`server/notice.mjs:32`, `:78-79`, `:88` and `server/mail-templates.mjs:243` say "her" in the
notice parents agree to. Changing that text is a new notice version (`notice.mjs:5`:
"bump it whenever the text changes"), pinned by `tools/test-billing.mjs:386`
(`NOTICE_VERSION === 1`), `:396` (`/see her nickname, avatar and the world/`, `/hear her voice
live/`), `tools/fake-accounts.mjs:44`, `:46` and several `notice: 1` / `noticeVersion: 1` uses
in `tools/test-accounts.mjs` (e.g. `:1626`, `:1656-1670`, `:993`, `:2475`). See Q1.

---

## 11. Tests

### 11.1 New `tools/probe-boys.mjs`

Structure like `tools/probe-pals.mjs` (imports `launch, openGame, startWorld, waitForPlay,
settle, shot, finish, parseArgs` from `./smoke.mjs`; screenshots `.shots/boys-*.png`; fails on
any console error or failed check). Flags `--only=unit|studio|friends|touch`.

**A. Unit (Node, no browser; imports the modules directly like `test-net.mjs`)**

1. Append-only guard: hard-coded copies of today's key arrays for every list (12 hair, 3 mixes,
   8 tops, 7 bottoms, 6 dresses, 7 shoes, 13 head, 5 face, 6 back, 5 neck, 6 hand, 7 patterns,
   4 smiles) equal the first N keys of each exported list.
2. Old looks normalize: `DEFAULT_LOOK` as it is today (a JSON literal in the probe, no `brows`,
   no `num`), a saved look with garbage (`top.num: 'x'`, `NaN`, `Infinity`, `-5`, `150`,
   `face.brows: 'huge'`) → `brows 'soft'`, `num` 7 / 7 / 7 / 0 / 99; `normalizeLook` is
   idempotent on 500 random looks of each style.
3. `randomLook` Girl is unchanged: golden JSON of `randomLook(mulberry32(s), 'Zoe')` for
   seeds 1 to 20 (recorded from the code **before** the change, step 1 of section 14) equals
   the new output, and equals `randomLook(mulberry32(s), 'Zoe', null, 'girl')`.
4. Boy surprise: 300 seeds: `dress === null`; hair, top, bottom and shoes keys all tagged `b`;
   pattern in the boy set; `top.num` integer 1 to 99; lashes on in fewer than 30%.
5. Mix: 300 seeds produce both a dress look and a `b`-tagged hair at least once.
6. Codec: every new option round-trips; the token of today's `DEFAULT_LOOK` is a prefix of the
   new token; an old token without the tail unpacks to `brows 'soft'`, `num 7`; worst-case
   length ≤ 151.
7. Friends: 16 defs, unique keys and names, 6 with `pronoun 'he'` and `kind 'boy'`; every look
   normalizes to itself; every name passes `sanitizeName` unchanged; `pronouns()` of each.
8. Strings: static scan of the files in section 8.2 / 8.3 with `//` comment lines removed: none
   of the old strings is still present; `MESSAGES.pet_owner` fills to "That's Lily's pet! Ask
   Lily to help."; `messageText('host_gone', {host:'Leo'})` contains no "Her"/"her".
9. Applying each boy starter to `DEFAULT_LOOK` keeps skin, hair color, eye color and name; each
   girl starter gives exactly today's result (golden from step 1).

**B. Studio (desktop 1280x800, mouse) and C. touch (iPad 1024x768, `touch: true`)**

1. Fresh profile: the title's Dress Up tile has `sw-tile--nudge`; tapping it opens the Studio on
   `outfits`; the title buttons' rectangles do not overlap the tile (same overlap math as
   `probe-menus.mjs:24-38`); closing the Studio removes the nudge and sets `lookPicked`.
2. Hair tab: 19 tiles, all pictures `sw-ready` within 25 s; tap Buzz Cut → `profile.look.hair.style
   === 'buzz'` and the preview's signature changed.
3. Style button cycles Girl → Boy → Mix → Girl (label text and `profile.lookStyle`); with Boy,
   the Hair tab's first tile is Buzz Cut; 10 x Surprise me! → no dress, boy-tagged hair, name and
   skin kept.
4. Outfits tab: 12 ready-made tiles; tap Soccer Star → `top.type 'jersey'`, `num 10`,
   `lashes false`, and `lookStyle` became `'boy'` (it was unset).
5. Number stepper: visible only with the jersey; + from 98 goes 99 and stays 99; − at 0 stays 0;
   a long press (1.5 s) moves at most 15 steps.
6. Face tab: Eyebrows Bold changes the eye texture key (`debug.avatar.textures()` count grows by
   at most 6, then falls back after Undo).
7. Render grid (`debug.avatar.renderGrid`) of every new option on a default body (7 hair, 6 tops,
   3 bottoms, 2 shoes, 4 head, 1 back, 2 neck, 3 hand, 5 patterns on a tee, bold brows), plus the
   6 boy starters and the 6 boy friends in `full` and `head` frames: screenshots, no errors.
8. Costs (in the world, the player's avatar): mesh count of each boy starter ≤ the mesh count of
   the Princess starter (today about 33); `setLook` average over 20 boy looks ≤ 1.3x the average
   over 20 girl looks (the probe-avatar method, `probe-avatar.mjs:302-305`); 60 random boy looks
   then back: geometries ≤ start + 4, avatar texture cache ≤ 90 (as `probe-avatar.mjs:309-312`).
9. Portraits: `getStage().snapshot('acct-head:x', boyLook, { frame: 'head', size: 160 })`
   returns a canvas; its PNG data URL is under the 32 KB limit (`account/portrait.js:8`); the
   top 8% of the canvas has non-transparent pixels for a look with a cap and for the afro
   (nothing cut off).
10. Photo mode: the HUD Photo button with a boy look takes a photo and closes with no errors.
11. Old save: before reload, write a profile whose look is today's `DEFAULT_LOOK` literal with
    `hair.style 'pixie'` via `game.store.saveProfile`; reload; title renders; `profile.look`
    gains `brows 'soft'` and `num 7`; no Dress Up nudge (look not default).

**D. Friends (desktop and touch)**

1. Invite `leo` with `debug.friends.invite`; the toast is "Leo is here! Tap him to play!";
   invite `mia`: "Mia is here! Tap her to play!".
2. Home on Leo: toast "Leo went back to his spot!"; My Friends card meta "Soccer Star · At his
   spot"; Bye confirm text contains "invite him again".
3. Leo's Dress up bubble: 6 outfit buttons, then Surprise!, New hair, Twins!, Back; Surprise! x5
   → no dress; New hair x7 → only boy-tagged styles; Mia's bubble still has 8 outfit buttons.
4. Talk on a boy 30 times: no line from `LINES.style` that says "pretty" (style kind forced via
   `debug.friends.style`).
5. Six friends (3 boys, 3 girls) near the player: draw calls logged; `info().calls` ≤ the
   probe-pals log for six girls + 10%; after 30 s of follow mode every friend position is finite
   (`Number.isFinite` on x, y, z) and the frame loop never stalled more than 1 s
   (`diag.report()` long frames).
6. Save and reload: boy friends come back with the same key, name and look JSON.
7. Roster panel: 16 cards, all pictures loaded, order starts Mia, Leo, Zoe, Kai.

### 11.2 `tools/probe-multiplayer.mjs`: new test `LOOKS` (after `HELD`)

Rosie (guest, iPad) applies the Space Explorer look with `num 23` and bold brows through the
Studio debug path (`game.profile.look = ...; game.events.emit('avatar:changed', ...)`). Within
5 s Lily's `debug.net.remote()` entry for Rosie has `lk` equal to Rosie's own `packLook`, and its
avatar look has `hair.style 'fauxhawk'`, `top.num 23`, `face.brows 'bold'`. Lily invites Leo; on
Rosie's page Leo appears with the same look JSON; Rosie taps Leo → the toast "That's Lily's
friend! Ask Lily to help." Ends with equal hashes, like every test there.

### 11.3 Existing suites that must stay green

`npm run smoke`, `npm run test:net`, `node tools/test-walkie.mjs`, `npm run probe:railway`,
`node tools/probe-net-ux.mjs`, `node tools/site-check.mjs`, `node tools/probe-keepsafe.mjs`,
`node tools/probe-shops.mjs`, `npm run probe:mp`, `npm run test:accounts`, `npm run test:billing`,
`npm run test:saves`, `npm run e2e:accounts`; and, because they cover these files:
`node tools/probe-avatar.mjs`, `node tools/probe-pals.mjs`, `node tools/probe-menus.mjs`,
`node tools/test-walkie-unit.mjs`, `node tools/test-net-game.mjs`. Browser tests use
playwright-core with Chromium at `/opt/pw-browsers/chromium` and the args
`--use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist`.

Known edits needed in existing tests: `probe-multiplayer.mjs:572` (regex), `test-net.mjs:129`
(lists), `probe-pals.mjs:365`, `:644` (16 pictures), `site-shots.mjs:68` (lookPicked). Nothing
in `test-accounts`, `test-billing`, `test-saves`, `e2e-accounts` or `site-check` pins the
changed strings (checked with grep on every old string in section 8 and 10).

---

## 12. Performance, safety, audio

### 12.1 Performance (2019 iPad budget, DESIGN.md §2 "Performance budget")

| What | Cost |
|---|---|
| Draw calls per avatar | 0 extra for hair, tops, decals, jersey numbers, bottoms, shoes, caps, headphones, bucket hat, star pack, tie, medal (existing bone + material). +1 for a hand toy (the `handItem` bone, same as today's teddy). New patterns live in the existing cloth texture. Boy hair has no swinging chains, so boy looks have **fewer** meshes than ponytail / braids / pigtails looks. |
| Triangles | Largest new piece: the afro, 56 rounded cubes (curly today: about 110). Pixel decals: at most 130 boxes on one merged torso mesh. |
| Textures | Same sizes as today (cloth 128x128, eyes 256x128); same LRU cache (`textures.js:31-63`). |
| Per frame | Nothing new. All new parts are static geometry merged at `setLook`. NPC boys run the shared `Friend` update with its LOD (hidden past 40 blocks, frozen animation off screen). |
| `setLook` | Bounded by the probe (≤ 1.3x girl looks). Remote players rebuild at most once per second each. |
| Studio | 7 more hair tiles etc.: more stage snapshots, still inside the 10 ms per frame snapshot budget (`stage.js:18`). |
| Bundle | About +30 KB source, roughly +12 KB minified (+4 KB gzip) in `dist/sparkle-world.html` (2.3 MB today). |
| Picture quality | Unchanged: no pixel ratio, texture size or filtering change. |

### 12.2 Safety

- No new movement code. NPC boys use `friend.js` movement as is. The probe checks positions stay
  finite and frames do not stall (D5).
- Every new number is clamped: `top.num` (normalize, codec unpack, stepper), and
  `Number.isFinite` rejects NaN and Infinity everywhere a number enters.
- Bounded loops only: hair, decal, pattern and accessory loops have constant integer bounds;
  `randomLook` has no retry loop; `tagged()` falls back to the full list, so no empty pick; the
  stepper's press-and-hold timer stops on `pointerup`, `pointercancel`, `pointerleave`, panel
  close and at the clamp.
- Nothing scary or about fighting: no swords, no superhero fights (Theo is a magician), the rocket
  tee has a sparkle puff not flames, dinosaurs are "friendly", every line is kind.
- No purchases: every item is free in the Studio, no coins involved.

### 12.3 Audio

No new sounds or files. Boys babble at pitches 0.9 to 1.0 through the existing `sfx(g, 'babble',
{ pitch })` (`friends/index.js:188`). The style button plays `pop`; items use the existing
`sparkle`, `magic`, `pop` (`dressup.js:271`). Read Aloud speaks the new neutral strings as is.

---

## 13. Coordination with the vehicles team (cars, boats, vans)

- Both teams edit `docs/DESIGN.md`, `site/index.html` (feature list), possibly
  `things/friends/chat.js` (friends reacting to vehicles) and `player/avatar.js` (a driving pose).
  This plan touches `avatar.js` only at `acquireFace` (`:262-270`) and the header comment, so a
  drive pose in `update()` / pose functions does not conflict.
- The `toy_car` hand item is a toy held in the hand, not a vehicle; names must not clash with the
  vehicles' entity keys (suggest vehicle keys `car_*`, `boat_*`, `van_*`).
- The website sentences that mention driving (section 10.1 lines 112, 492) go in only with the
  deploy that ships vehicles.

---

## 14. Build order (one session)

1. **Record goldens first** (before any code change): a scratch script that prints
   `randomLook(mulberry32(s), 'Zoe')` for s = 1..20, `applyOutfit(DEFAULT_LOOK, o)` for the 6
   girl starters, `packLook(DEFAULT_LOOK)`, and today's key arrays. Paste them into
   `tools/probe-boys.mjs` section A as literals.
2. `wardrobe-data.js`: `opts` with tags, appended lists, `BROWS`, `DEFAULT_LOOK`, `normalizeLook`,
   `tagged`, `BOY_THEMES`, `randomLook(..., style)`, starters, `applyOutfit`. Run probe-boys
   `--only=unit` steps A1 to A5, A9.
3. `codec.js` tail tokens; update `test-net.mjs`; run `npm run test:net` and probe-boys A6.
4. Avatar geometry: `textures.js` (patterns, brows), `avatar.js` (`acquireFace`), `hair.js`,
   `outfit.js`, `accessories.js`. Check with the render grid (B7) after each file.
5. Studio: `dressup.js`, `css.js`, `pictures.js`, `debug.js`. Run `probe-avatar.mjs` and
   probe-boys B.
6. Title nudge and "Hi there!" in `menus.js`; `storage.js` backup keys; `site-shots.mjs:68`.
   Run `probe-menus.mjs`, `probe-keepsafe.mjs`, `npm run smoke`.
7. Friends: `looks.js`, `chat.js`, `index.js`, `ui.js`, `icons.js`; update `probe-pals.mjs`.
   Run `probe-pals.mjs` and probe-boys D.
8. Neutral strings (section 8.2) in `protocol.js`, `net/ui.js`, `walkie/ui.js`, `pets.js`,
   `keepsafe.js`, `cards.js`, `storage.js`; `remote-players.js` `lk` in `list()`; update
   `probe-multiplayer.mjs:572`, add test `LOOKS`. Run `npm run probe:mp`, `probe-net-ux`,
   `test-walkie`, probe-boys A8.
9. Website (section 10). Run `node tools/site-check.mjs`.
10. Docs: DESIGN.md, MULTIPLAYER.md §5.13, team notes; append "as built" notes here.
11. Full gate: every suite in 11.3 plus `npm run probe:boys`, zero console errors. Then
    `npm run build` (Railway runs it too, `railway.json`), commit in small steps (one per
    numbered step), push.

---

## 15. Risks and open questions

**Risks**

- R1. *Tile overload*: 19 hair tiles and 14 tops are a lot on a phone. Mitigation: style-based
  ordering (5.1). If it still feels long, split the Hair grid into "Short" and "Long" sections
  (no keys change).
- R2. *Boy starters change the face*: picking Skater as a girl turns lashes off. That is the point
  of a ready-made boy look, and Undo is one tap. Girl starters never change the face.
- R3. *The nudge* could still surprise a probe that asserts the Dress Up tile's exact class list.
  None does today (grep `sw-tile--lav` in `tools/`); the nudge is CSS only.
- R4. *Hats over tall hair*: old tall styles (bun, space buns) still poke through caps (as they
  do through the beanie today). Only the new styles flatten.
- R5. *Older builds opening newer worlds* drop boy friends (3.5). Railway always serves the
  newest build; a claude.ai Artifact copy of an older build sharing a cloud profile is the only
  case.
- R6. *Merge conflicts* with the vehicles team in DESIGN.md and site/index.html (section 13).
- R7. *Neutral "they"* reads naturally for kids in short sentences; the long ones were rephrased
  with names instead ("Ask Lily to help").

**Open questions (for the dad)**

- Q1. The parents' consent notice (`server/notice.mjs`) and the first sign-in email say "her".
  Change them now as notice version 2 (wording only, `NOTICE_MIN_VERSION` stays 1 so nobody is
  asked again) with the test updates listed in 10.6, or leave them for a separate legal pass?
  This plan leaves them.
- Q2. Girl / Boy / Mix as words on the button, or pictures only?
- Q3. Should the default name for someone who picked Boy and never typed a name stay "Lily" (it is
  shown to nobody else; `adapter.js:570` hides it from other players) with "Hi there!" on the
  title, as planned, or should the Studio ask "What's your name?" the first time a boy look is
  picked?
- Q4. Retake the website screenshots with a boy in one of them (then the alts in 10.1 change)?
- Q5. Six boys enough, or one more so the roster is 10 + 7? The per-world limit stays 6.

---

## Integrator decisions (binding; they override anything above that disagrees)

Settled before building, together with docs/teams/wave3-critique.md (apply every item marked for boys or both there):

1. **Legal text waits (Q1).** Do not change server/notice.mjs, the sign-in/notice emails (mail-templates.mjs), site/privacy.html or site/terms.html in this wave. They go into one dad-approved legal pass with the lawyer review. Change only site/index.html, site/parents.html and site/account.js wording.
2. **Style button (Q2):** words with a small picture: "Girl", "Boy", "Mix".
3. **Unset name (Q3):** when the style is boy and the name is still the unset default, NPC lines and the title greet "friend" instead of "Lily". When a boy starter look is first picked, the Studio may ask "What's your name?" once (skippable); never block.
4. **Screenshots (Q4):** do not retake website screenshots in this wave; alt texts stay accurate as they are.
5. **Six boys (Q5)** is enough. Append them at the END of FRIENDS (critique B-B1); use a separate ROSTER_ORDER for the invite panel; pin the Bag icon by key.
6. **Keep every existing girl's lines unchanged**, including "Every girl is a princess!".
7. **The style setting** is named `surpriseStyle`, kept device-local (not in the cloud profile, not sent to the server), so no gender-like field enters children's data.
8. **Files you own / must not touch:** follow the critique's SHARED list. Boys owns avatar.js, wardrobe-data.js, codec.js, dressup*, menus.js, storage.js, friends/*, the MESSAGES block in protocol.js, the codec look test in test-net.mjs, site/index.html (including ONE sentence about drivable cars, vans and boats in the feature list). Boys adds only `lk: f.lk` (one line) in remote-players.js list() and only the string at pets.js:64. Never edit game.js, player.js, entities.js, hud.js, touch.js, host.js, adapter.js.
9. **Never push; never commit dist/*.** Commit source, docs and tests to your worktree branch often (end each commit message with the two attribution lines the integrator gives you). The integrator merges, rebuilds dist and runs the full gate once.

---

## As built (wave 3, boys builder)

Everything in sections 3 to 11 is built, with the integrator decisions above applied. Where the
build differs from the plan text, the build is right and the plan text is old:

- **Style setting.** `surpriseStyle` ('girl' | 'boy' | 'mix', or unset) is kept per player on
  this device only: `SaveStore.deviceGet / deviceSet` (`src/core/storage.js`) store it in
  localStorage under the store's own prefix (`sparkle-world@p-<uuid>:device:surpriseStyle` for
  a family player), or in memory when storage is blocked. It is never in the profile, a backup
  file or the cloud copy; `SaveStore.wipe('')` removes it with the old saves. The Studio reads
  it through `game.surpriseStyle()`. There is no `profile.lookStyle`. `profile.lookPicked`
  (the title nudge is done) is in the profile and in backups (either side true wins).
- **Unset name (decision 3).** `nameUnset(profile)` in `wardrobe-data.js`. With the Boy style
  and the name never typed, the title says "Hi, friend!", friends' `{name}` lines say
  "friend", and New World suggestions say "My Rainbow Meadow" instead of "Lily's ...". After
  the first boy ready-made look (name unset) the Studio shows a "What's your name? Type it
  here!" bubble under the name field once per device (`deviceGet('nameAsked')`), for 7 s; it
  never blocks.
- **Tile order.** Girl and Mix keep the list order (Girl is exactly the old order, new items at
  the end). Boy puts boy-only items first, then shared ones ('gb', e.g. Curly, T-Shirt), then
  the rest; 'none' always stays first. So with Boy the Hair tab starts with Buzz Cut.
- **Auto style.** The first ready-made look picked while the style is unset sets it (boy look
  -> Boy, girl look -> Girl). The Outfits tab keeps its order until the next visit, so tiles
  do not jump under the finger.
- **Actions row.** Surprise me!, the style button (picture + word) and Undo stay in one row
  from desktop down to a 360 px phone (the word hides at 480 px and below).
- **Codec length.** The plan's "151" missed one character: the tail is `.1.2r` (two dots, one
  brows character, two number characters), so the worst case is 147 + 5 = **152** (test-net
  allows 160, presence 200). An old token has 34 tokens (not 50).
- **Jersey + medal.** The front number sits lower (centre y 0.845, 0.025 per pixel) and the
  medal hangs on a short ribbon above it, so Soccer Star shows both.
- **Toys in hand** (soccer ball, toy car, toy dino) use the ice cream's arm pose (`HOLD_UP` in
  `avatar.js`; the only other changes there are the face texture key and the header).
- **Bucket hat** is a soft square crown on a 4-sided sloping brim (a round crown let the
  hair's box corners poke through). Caps are rounded boxes with a two-step brim. Under a cap,
  bucket hat or beanie (`P.hatFlat`) the short curls drop their crown ring and fringe, the faux
  hawk drops its ridge, the afro keeps only its two lower rings and spiky shows three short
  front spikes, so nothing pokes through the hat (`.shots/boys-hats.png`).
- **Costs measured** (B8, SwiftShader): boy starters 21 to 25 meshes (Princess 30); setLook
  about 6 ms for boy looks vs 7 ms for girl looks; no geometry growth over 60 boy looks after
  a warm-up round. Three boys + three girls draw fewer calls than six girls (142 vs 152).
- **Friends.** `FRIENDS` gains the six boys at the end; `ROSTER_ORDER` / `rosterFriends()` give
  the invite panel's order; `BAG_FRIEND = 'lilyrose'` pins the Bag picture; `pronouns(def)`,
  `outfitsFor(def)`, `nextHair(look, kind)`, `surpriseLook(look, kind)`; `LINES_BOY` (style,
  hair) and `HAIR_PRAISE` in `chat.js`; jersey and tee compliments use `{num}`. Lily-Rose keeps
  "Every girl is a princess!". `debug.friends.roster()` also has `pronoun` and `kind`, and
  `debug.friends.order()` gives the invite order.
- **Ghost tap on the invite cards.** With 16 cards the My Friends panel fills the spot where
  the "Invite a Friend" ground tap lands, so on an iPad that same tap's click picked the card
  under the finger (Theo) without the child choosing. The invite cards now ignore a click in
  the first 700 ms after they are drawn unless it was pressed on that card (the Bag's colour
  step uses the same rule). probe-pals' touch pass caught it.
- **Not changed (decision 1):** `server/notice.mjs`, the mail templates, `site/privacy.html`
  and `site/terms.html` still say "her"; they wait for the dad-approved legal pass. The site
  screenshots were not retaken, so their alt texts stay true.
- **Site sentence.** `site/index.html` line 112 now ends "Then she asked for boys to play
  with, and for cars, vans and boats to drive, so they are inside too." (one deploy ships both
  teams; if vehicles does not ship, drop the vehicles part).

### Tests

- `tools/probe-boys.mjs` (`npm run probe:boys`), flags `--only=unit|studio|touch|world|friends|grids`:
  A1-A9 in Node (goldens recorded from the code before any change), B1-B6 on desktop and C on
  an iPad with taps (plus a 390 px and a 360 px phone for the actions row), B7 grids
  (`.shots/boys-*.png`: hair, hats on every short style, clothes, accessories, starters,
  friends, surprises), B8 costs, B9 portraits, B10 photo, B11 an old save, D1-D7 friends on
  desktop (D3 and D7 on touch too).
- `tools/fixtures/boys-old-profile.json`: a real profile saved by the build before boys
  (`dist` at `cfb5e7c`, the same game code as `96565e4`), loaded by B11.
- `tools/test-net.mjs`: brows in the round-trip lists, Boy and Mix looks, numbers 0 / 7 / 35 /
  36 / 99, an old 34-token string, a broken number token, `packLook` without a top.
- `tools/probe-multiplayer.mjs`: new test `LOOKS` after `HELD`; the pet and "went home"
  messages follow the new words.
- `tools/probe-pals.mjs`: waits for 16 invite pictures; the six-friends scene includes Leo.
- `tools/site-shots.mjs`: sets `lookPicked` so the marketing title shot has no nudge badge.
