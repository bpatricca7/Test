# Team "gifts": the Gift Workshop, gifts in her hands, presents for friends and round the tree

Wave 5 (plan: `docs/teams/wave5-plan.md` §7.5). Branch `wave5/gifts`.

She walks up to the **Gift Workshop** bench, taps it, and makes a present in four big steps beside a
live 3D stage that changes with every tap: **What's inside?** (16 toys of our own, or a treat from
her basket), **Box** (little, tall, round), **Paper** (8 colors x 6 patterns), **Ribbon and bow**.
**Wrap it!** plays the wrapping moment: the toy hops into its box, the lid shuts, the paper folds
up round it, the ribbon zips on, the bow pops, ta-da, rays and confetti. Then the gift tag: **To:**
a friend in her world, a friend playing with her, or **Anyone**. **Done** puts the gift in her
hands. She gives it to a friend (tap the friend, or the **Give** button): the gift flies over,
the friend says "For me?!", it wiggles, pops open in a burst of its own colors, and the toy lands
in the friend's hands with hearts and a thank-you. Or she puts it down (tap the floor, or **Put
down**) as a present that anyone can open: confetti, "A Robot! From Lily!", and the toy goes into
the opener's Bag. Surprise presents round the holiday tree open to a toy each and come back
wrapped every new game day. Nothing is bought; nobody loses anything.

## 1. Decisions at a glance

| question | decision |
|---|---|
| what is inside | 16 original toys (`data.js TOYS`), or a treat from her basket (`'t:<food key>'`, taken out of the basket when wrapped) |
| where gifts wait | `profile.gifts.sack`, her gift shelf: at most 8 wrapped gifts, the front one is the one she holds |
| holding | the treats' and squishy toys' contract: the selected hotbar slot holds the Bag item `gift:hand` ("My Gifts"); the avatar holds `heldGiftModel` in the right hand |
| giving to a friend | tap the friend with the gift (friends `onBuild`) or the HUD **Give** button (shows with a friend within 5 blocks); local and visual (friends are not shared state) |
| a gift tagged for someone else | the friend points it out ("That one is for Mia!"); nothing is given |
| putting it down | a `gift_box` entity (Bag item use on a tap, or **Put down** in front of her), one Undo takes it back to her shelf |
| opening | anyone taps it: `open: 1` (an ANY_FIELDS patch), confetti, the toy to the opener's Bag (a `gift_toy_*` furniture item shows up), a treat to the opener's basket |
| a present tagged for another player who is here | only that player opens it; others see a wiggle and "A present for Sam!" |
| tree presents | `holiday:presents`: 3-8 presents round the tree "From the Holiday Tree", seeded per world and game day, never two of the same toy on one day; the host re-wraps the opened ones every morning (and on load after a new day) |
| coins | 2 a gift given (to a friend or put down), at most 10 a day, through `game.coins.add(n, 'gift', { at })` only |
| stickers | 3: `gift_maker`, `gift_giver`, `gift_ten` |
| closing the panel after Wrap it! | never loses the gift: it is wrapped for whoever the tag says (Anyone by default) |
| no WebGL | the stage shows a thumbnail instead; every step still works |

## 2. Keys, ids and names (wave5-plan.md §3 namespaces)

| kind | ids |
|---|---|
| entity / furniture keys | `gift_workshop` (2 x 2 x 1, Bag `holiday`, light 9), `gift_box` (1 x 1 x 1, `placeOn: 'table'`, no colliders), `gift_toy_<toy>` x 16 (hidden in the Bag until a present gave her that toy) |
| Bag items | `furn:gift_workshop`, `furn:gift_box` (its use places a random wrapped toy from her for anyone), `furn:gift_toy_*`, `gift:hand` ("My Gifts", hidden while the shelf is empty; its use puts the gift down) |
| actions | `gift-workshop` (opens the panel), `gift-open` (open a present; an open one hops its toy), `gift-toy` (a placed toy hops with its sound) |
| panel | `gift-workshop` |
| HUD buttons (life HUD) | `gift-give` (order 34), `gift-down` (35), `gift-away` (36) |
| stickers | `gift_maker` "Gift Maker", `gift_giver` "Gift Giver", `gift_ten` "Holiday Helper" |
| system | `gifts` (world save `{ v: 1, day }`: the game day the tree's presents were last wrapped) |
| facade | `game.gifts`: `held()`, `model(key)`, `holding()`, `giveTo(friend)`, `hold(id?)`, `putAway()`, `putDown()`, `wrap(spec, to)`, `sack()`, `toyName(inside)`, `openWorkshop()` |
| debug | `game.debug.gifts`: `state()`, `wrap(spec, to)`, `hold(id)`, `give()`, `putDown()`, `open(uid?)`, `rewrap(day)`, `presents(x, y, z, n)`, `workshop(x, y, z, rot)`, `panel` (`state()`, `pick(field, value)`, `step(i)`, `wrap()`, `to(name)`, `done()`) |
| thumbs keys | `gift:toy:<toy>`, `gift:w:<held key>`, `gift:hand` |
| toast keys | `gift-hint`, `gift-hold`, `gift-open`, `gift-newtoy` |
| CSS prefix | `gf-` |
| sounds | `sfx.js giftSfx(game, name)`: pick, crinkle, fold, snip, zip, bow, tada, wiggle, unwrap, whoosh, coins, and one per toy (soft, beep, choo, drum, vroom, click, magic, jingle, page; boing from the pets) |

## 3. Data shapes

### 3.1 A gift (`src/things/gifts/data.js`, pure: no imports, no DOM, nothing random of its own)

`{ inside, box, paper, pattern, ribbon, bow, to, from }`. Every look field is a key of an
**append-only** list (`TOYS`, `BOXES`, `PAPERS`, `PATTERNS`, `RIBBONS`, `BOWS`); `inside` is a toy
key or `'t:<basket food key>'`. `to` / `from` go through `cleanName` (letters, digits, spaces, `'`
and `-`, NFKC, at most 16 characters; `''` means Anyone). `normalizeGift` never throws and always
returns a valid gift.

### 3.2 `profile.gifts` (repaired by `ensureGifts`; `defaultProfile` is unchanged)

```
{ v: 1,
  sack: [ { id, inside, box, paper, pattern, ribbon, bow, to, from } ]   // at most 8, front = held
  toys: { robot: 1, ... },          // toys presents gave her (they show in her Bag)
  made, given, opened,              // counters (gift_ten at given >= 10)
  coinDay, coinsToday,              // yyyymmdd and the coins paid that day (cap 10)
  last: { inside, box, paper, pattern, ribbon, bow } }  // the Workshop starts here next time
```

### 3.3 The `gift_box` entity data (flat, at most about 310 bytes with worst-case names; the limit is 600)

`{ inside, box, paper, pattern, ribbon, bow, to, from, open: 0|1, tree?: 1 }`. `open` is in
`ANY_FIELDS`, so a guest may open a present the host placed (and the other way round).

### 3.4 Presence

`hi` (the treats' held-key field) can carry the gift's look: `'gift_w' + 5 base-36 digits` (box,
paper, pattern, ribbon, bow indices), 11 characters, matching `HELD_KEY_RE`. It never carries a
name or what is inside. Needs the integrator's two lines (Wanted 1-2).

### 3.5 Events

| event | payload | when |
|---|---|---|
| `gift:wrap` | `{ gift }` | a gift was wrapped at the Workshop |
| `gift:give` | `{ to, npc, placed, inside }` | a gift left her hands (to a friend, or put down) |
| `gift:place` | `{ to, uid }` | a present was put down |
| `gift:open` | `{ inside, from, to, tree }` | she opened a present |

Friends react to `gift:wrap` and `gift:open` (the existing `react` list).

### 3.6 World feature records (made by holiday-world)

| kind | fields | what gifts does |
|---|---|---|
| `holiday:workshop` | `x, y, z, rot?, color?` | places `gift_workshop` (2 x 2 x 1 footprint, the front faces `rot`); tries the other turns, then one block over each way, then forces it |
| `holiday:presents` | `x, y, z` (the tree's foot), `n` (3-8, default: the number of `spots`), `spots?` (`[[x, y, z], ...]`), `tree?` (`[x, z]` of the trunk) | places n wrapped presents round the tree, on free floor 1-6 blocks out (up to 3 blocks up or down), spread round the circle, each facing away from the tree; with `spots` it uses those cells and faces them away from `tree` (or from the middle of the spots when `tree` is missing), so holiday-world's record, whose own `x, y, z` is its first spot, works as it is |

## 4. Numbers

| what | value |
|---|---|
| toys / boxes / papers / patterns / ribbons / bows | 16 / 3 / 8 / 6 / 8 / 3 (55,296 different gifts with one treat) |
| gift shelf | 8 |
| coins | 2 a gift, 10 a day |
| a friend keeps the toy in hand | 240 s (a treat: eaten) |
| the Give button | a friend within 5 blocks |
| wrapping moment | 0.38 s (the preview paper whisks off) + 2.8 s; then ta-da |
| giving flight | 3.2 s (fly 0.6, wiggle, pop at 1.55, in the friend's hands at 2.5) |
| tree presents | 3-8, re-wrapped each game morning |
| entity data | <= 600 bytes (worst case about 310) |

## 5. Files

New (all ours): `src/things/gifts/data.js`, `models.js`, `index.js` (replaces the stub),
`panel.js`, `give.js`, `sfx.js`, `art.js`, `fx.js`; `tools/test-gifts.mjs`, `tools/giftview.mjs`;
this doc.

Shared lines (plan §6.1, gifts only): `src/things/friends/index.js` (the `gift:hand` tap in
`onBuild`, its hint, `receiveGift` / `dropGiftToy` / `_giftTick`, the toy dropped in `remove()` and
`clear()`, `'gift:wrap'` and `'gift:open'` in the react list) and `src/things/friends/chat.js`
(`gift`, `giftTreat`, `giftAsk`, `giftOther`, `giftHave` lines, `LINES_BOY.gift`, two places and two
events, `{toy}` and `{to}` in `fill`, `giftHave` while a friend holds a toy). Not changed:
`src/things/pets/kit.js` (the HUD buttons draw their own SVG faces).

## 6. How to test (no browser)

```
node tools/build.mjs
node tools/test-gifts.mjs          # 21 tests, about 4 s
node --test tools/test-name.mjs
node tools/test-vehicles.mjs && node tools/test-sea.mjs && node tools/test-merfolk.mjs && node tools/test-squish.mjs
node tools/giftview.mjs            # pictures in .shots/gifts/ (toys, gifts, papers, wrap, steps, opened, workshop)
```

`test-gifts.mjs` covers: the lists and their goldens (append-only); `normalizeGift` and
`cleanName` on junk; every combination (data, held key round trip); entity data and presence
sizes; the shelf; the coin cap (and a clock gone back); `mergeGifts`; `presentSpots` and
`treeGift`; the animation curves; words (no prices, pronouns, other companies' or famous
characters' names) and no `while` / `Math.random` / `localStorage` in the module; every model
builds; the module installed on a fake game (wrap, hold, give with the whole flight, coins,
stickers, the full shelf, a treat gift, put down, Undo, open, a guest, the world features, the
daily re-wrap, a saved world from an older day); the Workshop panel on a tiny fake DOM (every
step, Surprise me!, Wrap it! with its timeline, the tag, Done, closing mid-wrap, the shelf, a full
shelf); and friends' thank-you lines.

In a browser (for whoever can): `game.debug.gifts.workshop(x, y, z)` then tap the bench;
`game.debug.gifts.wrap({ inside: 'robot' }, 'Mia')`, `give()`, `putDown()`, `open()`;
`game.debug.gifts.presents(x, y, z, 6)` and `rewrap(day)`.

## 7. As built

- The Workshop panel (`panel.js`): a step bar (Toy, Box, Paper, Ribbon; tap any step), the stage
  on the shared preview renderer (drag to spin; the stage model keeps one framing in every step),
  a speech pill over the stage, choice tiles (toy thumbnails; treats with their count; box
  pictures in her paper and ribbon colors; pixel paper swatches; ribbon dots; bows), Back,
  **Surprise me!** (keeps the toy after step 1; picks a ribbon that shows on the paper), Next and
  **Wrap it!**. Little previews between steps: into the box, the paper folds up, the ribbon and
  bow. The wrapped gifts on her shelf show above step 1: tap one to hold it.
- The wrapping moment: a snip, the preview paper whisks off, then the full wrap with sounds on
  each beat (the toy drops in, the lid, crinkle, fold, zip, bow), then **ta-da**: rays, a spin and
  a hop, confetti in the paper's and ribbon's colors, "Ta-da! Your gift is ready!".
- The tag: tiles for Anyone, the friends in her world (girls pink, boys blue) and the players
  here; the tag fills in with a pop ("To: Mia / From: Lily"). **Done** wraps it and puts it in
  her hands with a hint ("Tap Mia to give your gift!").
- Holding: `gift:hand` in the selected slot; the gift follows her look changes; hidden while she
  swims with a tail (the avatar's `heldShown`). HUD: **Give** (a friend near), **Put down**,
  **Put away** (back on her shelf).
- Giving (`give.js`): the gift flies from her hand in an arc, the friend turns and asks "For
  me?!", two little shakes, POP (confetti and stars, the unwrap sound), the toy rises spinning and
  lands in the friend's hand. The friend says thank you (girl or boy lines), hearts, a heart or
  twirl emote, keeps the toy 4 minutes (hidden while eating or asleep) and sometimes talks about
  it ("Look at my robot!").
- Presents: wrapped presents batch (merged flat); an opening one rebuilds with its toy as a
  part for the pop-up, then settles back to a batched model. An open present shows the open box,
  its lid leaning on the side, torn paper bits and the toy sitting up out of it; tapping it hops
  the toy with its sound.

## 8. Wanted from the integrator

1. `src/net/adapter.js` `heldKey()` (line 640): `return this.treatHeld() || this.squishHeld() || this.giftHeld();`
   and a method beside `squishHeld()`:
   ```js
   /** The wrapped gift's look in her hands (game.gifts.held(): 'gift_w' + 5 digits), or null. */
   giftHeld() {
     const g = this.game.gifts;
     try {
       const k = g && g.held();
       return typeof k === 'string' ? k : null;
     } catch {
       return null;
     }
   }
   ```
2. `src/net/remote-players.js` `heldModel()` (after the squish line, line 62):
   `if (/^gift_w/.test(key) && game.gifts && typeof game.gifts.model === 'function') return game.gifts.model(key);`
3. `src/account/merge.js` (beside the squish line, line 54):
   `if (isObj(local.gifts) || isObj(server.gifts)) out.gifts = mergeGifts(local.gifts, server.gifts);`
   with `import { mergeGifts } from '../things/gifts/data.js';` (data.js has no imports, so the
   server can load it too).
4. `src/core/storage.js`: add `'gifts'` to `BACKUP_PROFILE_KEYS` (line 87) and, beside the
   squish join (line 146), `if (isObj(f.gifts)) { const joined = mergeGifts(current.gifts, f.gifts); if (canon(joined) !== canon(current.gifts)) current.gifts = joined; }`.
5. `package.json` scripts: `"test:gifts": "node tools/test-gifts.mjs"`.
6. holiday-world: the `holiday:workshop` record `{ x, y, z, rot }` needs a 2 x 2 x 1 floor spot
   (2 wide, 2 tall, 1 deep; the front faces `rot`); `holiday:presents` `{ x, y, z, n }` with
   `(x, y, z)` the tree's foot centre (floor level), optionally `spots`.
7. `src/ui/inventory.js` `TAB_PICS.holiday` (holiday-world's line): `furn:gift_box` makes a good
   tab picture.
8. `docs/DESIGN.md` events table: the four `gift:*` events in §3.5.

## 9. Known limits and open questions

- Giving to a friend is local and visual: friends are each player's own (a guest giving to the
  host's friend sees the whole moment; the host does not). The gift leaves the guest's shelf.
- A gift tagged for a player is matched by name; two players with the same name can both open it.
- `mergeGifts` joins two shelves: a gift given on one device can come back from the other copy
  (nothing is ever lost, at worst a gift returns).
- The Workshop starts from her last gift; should it start fresh each time? (A one-line change.)
- Open question for the owner: should friends also give her a present now and then (a friend
  walks up with a wrapped gift)? Easy to add on `gift:give`, left out of v1.
