# Team "merfolk": a mermaid tail or a sea dragon form when you swim in deep water

The request, from the dad and his daughter (2026-10-04): *"Can you add squishys and neatos into
the game ... and mystery presents ... Also add Dolphins, and sea animals, and the option to turn
into mermaid when you get in the water for a girl and a cool sea creature for a boy kinda like
[a famous movie about a sea-monster boy]...."* (the movie's name is left out on purpose: we never
use other companies' names or designs). This document covers **turning into a mermaid or a sea
creature in the water**: when it happens, what the tail and the creature look like, how they
swim, how a child picks one, what friends see, saves, costs and tests.
The squishy toys and presents are team "squishies" (`docs/teams/squishies.md`). Dolphins and
other sea animals are the sea-life team ("ocean", `docs/teams/ocean.md`). The touch points are
listed in section 13.

Status: DESIGN (revised after two reviews; see "Review notes" at the end). Every `file:line` is
the code as of commit `669b6fa` on `claude/girl-game-world-building-gp6bnl`. Nothing has been
built yet.

Owner files (new): `src/player/merfolk/rules.js`, `src/player/merfolk/parts.js`,
`src/player/merfolk/index.js`, `src/player/merfolk/stickers.js`, `tools/test-merfolk.mjs`,
`tools/probe-merfolk.mjs`, `tools/fixtures/merfolk-old-profile.json`.

**Names agreed with ocean.** Ocean owns the word `sea` in code (`src/life/sea/`, the `sea`
system, `game.sea`, `game.debug.sea`). Merfolk uses `merfolk` everywhere: the folder
`src/player/merfolk/`, the import name `merfolk` in `main.js`, the system name `merfolk`
(`save.systems[...]` and the slow-system diagnostics key on it, `game.js:384`, `:735-738`,
`:829-834`) and `game.debug.merfolk`. The words "sea" in look fields (`look.sea`, `SEA_FORMS`,
`SEA_COLORS`) and in player fields (`player.seaForm`, `player.seaSwim`) are data names, not
module names, and do not clash.

---

## 0. Decisions at a glance

| Question | Decision |
|---|---|
| The two forms | **Mermaid**: a shimmering scaled tail with a round two-lobed fin and a little fin frill at the waist. **Sea Dragon** (our own creature, built from dragon and real leafy-sea-dragon ideas; redesigned after the owner review, see As built): a longer, thicker, gently curving tail with light belly plates down the front, a tall row of round-tipped crest spikes (tail colored, gold tips) from the waist down the whole tail, big solid leafy fronds on the tail's sides and small leafy fins on the forearms, softly glowing spots along the tail, a big ribbed fan fin whose outer lobes reach furthest, and two curved horn nubs on the head (only with no head accessory or a bow). Deep teal with gold accents by default; Match never makes it purple or pearl (those give Deep teal). **The face, ears and cheeks stay 100 % the child's** (no head fans, no cheek scales). Both keep the child's own face, hair and top. |
| Third choice | **Just Me**: no tail, no sparkles. In **deep** water she still gets the easy swimming (hover, Up and Down, the leap) at a slightly lower speed; in shallow water she swims exactly as today. Saying no to a tail is never a punishment. |
| When it happens | Swimming in **deep** water (liquid at the waist **and** either one more liquid cell under the feet or liquid at head height), for **0.25 s**. Water, chocolate milk and strawberry milk all count. Never while flying, riding a pony, horse or vehicle, sitting, sleeping or on a zip line. **Riding a dolphin keeps the tail** (side-saddle, §6.5). |
| Turning back | After standing on land for **0.35 s**, or after **1.4 s** out of the water (a leap that lands back in the water keeps the tail). Flying, mounting a pony or vehicle, sitting, the zip line or a teleport turn her back **at once**. |
| The moment | A burst of sparkles and bubbles around the legs, the tail grows in 0.35 s, the `magic` sound (pitch 1.25), a shimmer that runs down the scales. Turning back: a smaller sparkle, the tail shrinks, `magic` at pitch 0.9 and lower volume. Remote friends get the sparkle (no sound). |
| How it swims | Faster: **4.6** blocks/s (**6.2** fast; today 2.8). **Floats up gently** to the surface when no Up or Down is held for 1 s. **Up** and **Down** rise and dive (touch: the Up and Down buttons; keys: **Space** up, **C** down; **Shift only means fast**). In first person, looking down while swimming forward dives. A fast swim up through the surface does a **dolphin leap** (about **1.75 blocks** high, with a twirl). Swimming into the shore or an underwater step **flops her up onto it** (the ledge hop also works while swimming). |
| The first turn | While the form is still `'auto'`, the first turn on a device shows a **non-blocking bubble** over her with three big picture buttons: **Mermaid**, **Sea Dragon**, **Just Me**. A tap stores the choice; ignoring it keeps `'auto'`. It fades after 8 s or when she leaves the water (§5.2). |
| The choice later | Dress-Up Studio, new tab **Water** right after **Shoes** (the tail replaces legs and shoes), with a sparkle "new" dot until first opened: **"I swim as"**: **Mermaid / Sea Dragon / Just Me**, then **"Tail color"**: **Match** or 12 sea colors. Every child can pick any of them. |
| The default | New look field `look.sea = { form: 'auto', color: null }`. `'auto'` follows this device's Girl / Boy / Mix button: Boy gives **Sea Dragon**, Girl and Mix give **Mermaid**. If the button was never tapped, `'auto'` follows the **worn look**: a look that fits Boy and not Girl (`lookFits`) gives Sea Dragon, anything else Mermaid. A tap (bubble or Studio) stores an explicit choice that never changes by itself. Old saves get `'auto'`, so they need no rewrite. |
| Tail color "Match" | Takes the dress color (else the bottom's color) and **snaps it to the nearest bright sea color**; white, gray, black, brown and very dark or pale colors become **Deep teal** for a Sea Dragon and **Sea green** for a Mermaid. A Sea Dragon's Match is never Purple or Pearl (those give Deep teal; a child can still pick Purple by hand). No boy starter look gives a dull tail. |
| Privacy | The Girl / Boy / Mix choice stays on the device (`SaveStore.deviceGet`). The profile only stores `'auto'` or the form a child tapped. Friends receive the **resolved form** (a look item like a hat). For `'auto'` with the button set, that form is worked out from the button, so friends can see a tail chosen by it, exactly as they see the clothes the Boy button swaps in; the button itself is never sent or stored (§9.3). |
| Look codec | **Two tokens appended** after the jersey number (form index, color palette index), and **left out** when the look is the default `auto` + `match`. Today's strings, goldens and old prefixes do not change. Worst case 156 characters (limit 160). New lists `SEA_FORMS` and `SEA_COLORS` are **append only**. Any later token must write the sea pair first (`0.-`) (§3.3). |
| Presence | One new `st` letter, **`m`**: "in sea form" (swimming or leaping, with a tail). No other new field. A dolphin rider stays `h` with ocean's `sr`; friends show her tail from her `lk` (§9.2). |
| The rig | The sea parts are built **lazily** the first time an avatar turns (about 1 ms), then shown or hidden with `visible`. Turning never calls `setLook`, never rebuilds the look, never changes the saved look and never sends a new `lk`. Legs (with shoes) and skirt / dress flares hide; the hip block stays as the waistband. |
| NPC friends | They turn too when they swim in deep water: girls become mermaids, boys sea dragons (`def.kind`). They swim faster in sea form and say a line the first time the player turns in each world visit. |
| Cameras | Third person looks at the lower, forward head (`headY` 1.05). First person eye 1.15. A soft **underwater tint** when the camera is under the surface, for every swimmer: one extra full-screen composited layer while underwater, its light rays moved only with `transform` (no repaint) (§5.6). Photos taken underwater get the same tint drawn in. |
| Stickers | **Sea Magic!** (first time with a tail) and **Big Leap!** (first dolphin leap; Just Me can earn it too), +20 coins each through the normal sticker path. |
| Saves | Only `look.sea`. No new profile key, world key, merge rule or backup key. Device-only flags: `seaHints`, `seaAsked`, `seaTabSeen`, `seaPoolHint`. |

---

## 1. Goals and non-goals

### Goals

1. A child who walks into the pond or the sea turns into a mermaid or a sea dragon within half a
   second, with a sparkle moment that feels like magic, floats up to the surface, and turns back
   on the beach by just swimming at it.
2. Swimming in deep water is clearly more fun for everyone: faster, smooth tail kicks, diving
   down to the coral and the fish, and leaping out of the water like the dolphins.
3. Any child can pick any form or none, right in the water the first time (one tap) or later in
   the Dress-Up Studio, with pictures and one word each.
4. Friends in multiplayer see the same form and tail color; NPC friends join in. A mermaid can
   ride a dolphin with her tail.
5. Old saves, old outfits, backups, cloud profiles and multiplayer keep working. No player's
   things change. The picture stays exactly as sharp; on land the cost is zero.

### Non-goals (v1)

- No underwater fog or light change inside the 3D scene (the overlay tint is enough; §5.6).
- No breath meter, no drowning.
- No sea form in photo props, the title backdrop or the emote wheel pictures.
- No new Dress-Up items for land (the Mermaid Dress already exists, `wardrobe-data.js:63`).
- No hair floating for "Just Me" swimmers (only the sea form gets floaty hair, §6.4).
- No full-body emotes in sea form (arm-only Wave and Heart do play, §6.3). A "tail flip" emote
  and a **Rainbow** tail pattern are planned for a later wave (both append only, §16 Q9).

---

## 2. How the code works today (what this builds on)

- **Detection.** `Player.update` probes one cell, `physics.liquidAt(x, y + 0.6, z)`
  (`src/player/player.js:129-136`). On entry it emits `'player:swim'`, plays `splash` and
  celebrates; `this.swimming = inWater && !this.flying`. `Physics.liquidAt` checks
  `props.shape[id] === SHAPES.liquid` (`src/world/physics.js:82-86`): `water`
  (`src/world/paint/nature.js:189`), `choco_milk` and `strawberry_milk`
  (`src/world/paint/candy.js:196-197`). A one-block puddle already counts as swimming. There
  is no exit event and no hysteresis; at the surface `swimming` toggles as she bobs.
- **Swim physics.** `SWIM = 2.8` (`player.js:11`); acceleration 14 in water (`:139`); vertical:
  `vy -= 5 dt`, Jump adds up to 3.6, sinking capped at -2.2 (`:147-150`). `input.down` is used
  only for flying (`src/core/input.js:162`: Shift, C or the touch Down button), and `input.run`
  also includes Shift (`:163`).
- **Getting out of the water today.** Today's swimmer sinks, touches the floor, and the ledge
  auto-hop (`player.js:164-166`, `res.ledge !== null && wishLen > 0.3 && this.onGround`) lifts
  her onto the bank. In `Physics.move` both step-up and `res.ledge` need ground contact:
  `grounded = wasOnGround || res.onGround` (`physics.js:141`), step-up when grounded
  (≤ `STEP_HEIGHT` 0.55) or rising (≤ `AIR_STEP` 0.3) (`:144`), `res.ledge` only when grounded
  and the rise ≤ `LEDGE_HEIGHT` 1.05 (`:148-150`). NPC friends have their own water hop
  (`friend.js:707`).
- **Double Space.** `_onKey` (`player.js:53-64`) toggles flying on two Space presses within
  `DOUBLE_TAP_MS`.
- **Early returns.** `hold` (`:84-88`), `sit` / `sleep` (`:89-95`) and `ride` (`:96-116`) return
  before the water probe, so a rider or a zip-liner never swims (but `this.swimming` keeps its
  last value; §6.1 handles that).
- **The avatar.** `createAvatar(look, opts)` (`src/player/avatar.js:159`) builds bones from
  `REST` (`src/player/avatar/rig.js:8-21`; `HIP` 0.64, `PIVOT_Y` 0.9). `build()` (`:370-416`)
  merges every (bone, material) pair into one mesh, then sweeps every material whose `gen` is
  stale and releases its texture keys (`:399-405`); `clearParts` (`:356-368`) disposes meshes
  and dynamic bones on every look change. `material(key)` (`:200-238`) owns every material so
  `setOpacity` (`:240`) and `dispose` reach them; `cloth:` is Lambert + `vertexColors` + map,
  `cloth2:` the same with `DoubleSide` (`:216-219`). `setLook` rebuilds only when the
  normalized JSON changes (`:418-425`).
- **Poses.** `update(dt, s)` (`:878`) picks: sleeping, sitting/riding, `s.swimming` →
  `poseSwim(speed)` (`:577-595`, body pitch up to 1.0 rad, flutter kick), flying, ground
  (`:897-912`). It adds `parts.lift` (`:913`), hides the held item while swimming (`:915`),
  deforms skirt flares (`:947-956`) and runs `springs` (`:761`, hair, cape, wings). A fast
  shrink (0.12 s) happens only when `s.sitting/riding/sleeping/flying` is set.
- **The hips and legs.** Hip block `cbox(-0.19, 0.555, -0.115, 0.19, 0.775, 0.115)` on `hips`
  (`src/player/avatar/outfit.js:262-264`). Thighs on `legL`/`legR`, shins **and shoes** on
  `kneeL`/`kneeR` (`outfit.js:318-343`, `buildShoes` `:491+`), so hiding `legL` and `legR`
  hides every leg, pant leg and shoe. Skirts and dresses are `Flare` meshes on `hips`
  (`outfit.js:458-487`), stored only in `parts.meshes` today; `Flare` pads its bounding sphere
  by 0.4 (`geo.js:410`).
- **Everyone draws avatars with the same code:** the player (`player.js:42`), NPC friends
  (`src/things/friends/friend.js:34`), remote players (`src/net/remote-players.js:495`), the
  Studio preview (`src/ui/dressup.js:1094`) and the shared snapshot stage
  (`src/ui/dressup/stage.js:176`). One hook in the avatar serves them all.
- **Looks.** Option lists are append only (`src/player/wardrobe-data.js:6-9`); `normalizeLook`
  (`:182-228`) drops unknown keys; `freshLook` (`:244`) compares with `DEFAULT_LOOK` (`:21-35`);
  `lookFits(look, letter)` (`:119-126`). The codec (`src/net/codec.js:356-450`) sends list
  indices; an older (shorter) string is a valid prefix. Default look: 126 characters, 36
  tokens; worst case 152 (measured in Node, 3,000 random looks per style give at most 151).
- **Girl / Boy / Mix** lives in `store.deviceGet('surpriseStyle')` (`dressup.js:359-362`), null
  until picked; `game.surpriseStyle()` reads it (`dressup.js:98-100`). `deviceGet` caches only
  values it wrote (`src/core/storage.js:509-516`), so a never-picked style reads
  `localStorage` on every call.
- **Studio details.** `_applied` plays `emote || EMOTE_FOR[this.tab] || 'wave'`
  (`dressup.js:314`). Snapshot keys are pruned on close by their tab prefix
  (`STUDIO_KEYS` from `TABS`, `:38`, `:282`). `_wearSlot` replaces the whole look
  (`:1076-1079`); the slot "on" check compares full signatures (`:1022`).
- **Presence.** `adapter.local()` sends `st: ST[pl.state]` (`src/net/adapter.js:21`, `:571`) and
  `lk: packLook(profile.look)` (cached, dropped on look events `:41-47`). Remote avatars are
  built with `fx: null` (`remote-players.js:495`) and posed from `st` (`:462-470`); `f.st`
  starts as `'w'` (`:109`); the phrase bubble sits at 2.45 (`:598-599`); beyond 32 blocks they
  freeze, beyond 64 they hide (`:31-33`).
- **Help and the joystick.** The joystick label says "Walk", "Drive" or "Steer"
  (`src/ui/touch.js:131-135`); the help cards say "Shift: Run or go down" and "Fly button, then
  Up and Down" (`:147-175`).

---

## 3. Data shapes

### 3.1 Look (profile `look`, saved outfits, NPC friend saves, backups)

One new key with a fixed default:

```js
sea: { form: 'auto' | 'mermaid' | 'sea_dragon' | 'me', color: null | one of SEA_COLORS }
// DEFAULT_LOOK.sea = { form: 'auto', color: null }
```

- `form: 'auto'` = "this device's Girl / Boy / Mix button, or the worn look if it was never
  tapped" (§3.4). Not a tile.
- `color: null` = **Match**: the dress color if a dress is worn, else the bottom's color,
  **snapped** to a bright sea color (`seaColorOf`, §3.4). Match stays `null` in the save and the
  codec; every page computes the same hex from the same look.
- The default picture on land does not change, so `freshLook` keeps working: a never-touched
  profile still matches `DEFAULT_LOOK`.

`normalizeLook` (`wardrobe-data.js:182-228`) adds, after `acc`:

```js
const sea = l.sea && typeof l.sea === 'object' ? l.sea : {};
...
sea: {
  form: one(sea.form, KEYS.sea, d.sea.form),
  color: seaCol(sea.color), // a SEA_COLORS hex (upper case) or null; anything else -> null
},
```

with `const SEA_SET = new Set(SEA_COLORS)` and
`const seaCol = (v) => (typeof v === 'string' && SEA_SET.has(v.toUpperCase()) ? v.toUpperCase() : null);`.
`KEYS` (`:157-162`) gains `sea: keySet(SEA_FORMS)`. The schema comment (`:11-19`) gains the
`sea` line.

### 3.2 Option lists (APPEND ONLY: the codec sends their indices)

Appended after `BROWS` (`wardrobe-data.js:101`):

```js
/** What you become in deep water. 'auto' (index 0) follows this device's Girl / Boy button
 *  (or the worn look) and is never shown as a tile. APPEND ONLY (look codec). */
export const SEA_FORMS = opts([
  ['auto', 'Auto', 'gb'],
  ['mermaid', 'Mermaid', 'g'],
  ['sea_dragon', 'Sea Dragon', 'b'],
  ['me', 'Just Me', 'gb'],
]);
/** Tail colors (the codec sends the index; null = Match my clothes). APPEND ONLY.
 *  Hex only: patterns (a later Rainbow tail) go in their own list, never here. */
export const SEA_COLORS = [
  '#3FD8B0', '#6CC6FF', '#4D7CFF', '#9C7BFF', '#FF8CC6', '#FF5FA2',
  '#FF6B6B', '#FFA94D', '#FFD43B', '#6BD68A', '#2FB5B0', '#E6DDFF',
];
export const SEA_COLOR_NAMES = [
  'Sea green', 'Sky blue', 'Ocean blue', 'Purple', 'Pink', 'Hot pink',
  'Coral', 'Orange', 'Gold', 'Green', 'Deep teal', 'Pearl',
];
```

- Keys are new and live in their own list, so `'mermaid'` here never clashes with the Mermaid
  Dress (`DRESSES` index 5).
- The tags only order the Studio tiles (§5.1). **`lookFits` does not look at `sea`** (on
  purpose: switching Girl / Boy must never take a tail choice away), and the Surprise lists
  ignore it.
- `src/ui/dressup/debug.js:11-14` `OPTION_LISTS` gains `'SEA_FORMS'` so
  `debug.avatar.options()` guards it in the browser too.

### 3.3 Codec tokens (`src/net/codec.js`)

- Imports (`:5-8`) gain `SEA_FORMS, SEA_COLORS`; `L` (`:362-366`) gains `sea: SEA_FORMS`
  (so `IDX.sea` exists).
- `packLook` (`:376-402`), after the `num` push:

  ```js
  // Appended tail (merfolk): sea form and tail color, left out while they are the default
  // ('auto', Match) so every older look packs exactly as before.
  // RULE FOR LATER TOKENS: a team that appends a token after these must always write the
  // sea pair first (`0.-` = auto / Match) whenever its own token is present, or positions shift.
  const s = l.sea;
  if (s.form !== 'auto' || s.color) {
    const ci = s.color ? SEA_COLORS.indexOf(s.color) : -1;
    t.push(tokIdx(IDX.sea, s.form), ci >= 0 ? ci.toString(36) : '-');
  }
  ```

- `unpackLook` (`:405-450`), after `num`:

  ```js
  // The sea tail came later still: a missing token reads '-', which gives 'auto' / Match.
  const form = opt(L.sea);
  const ct = parseInt(next(), 36);
  look.sea = { form, color: Number.isInteger(ct) && ct >= 0 && ct < SEA_COLORS.length ? SEA_COLORS[ct] : null };
  ```

- Sizes: `+4` characters when present (`.f.c`, both one base-36 character while each list
  stays under 36 entries). Default 126 (unchanged, tokens left out); a resolved default look
  130; worst case 152 + 4 = **156** ≤ 160 (`tools/test-net.mjs:140`, MULTIPLAYER.md `lk ≤ 160`).
- The header comment of `packLook` becomes "(~130 chars, at most 156)".
- MULTIPLAYER.md §5.13 gets the same rule as the comment: "Tokens after sea: when any later
  token is present, write the sea pair (`0.-` for auto / Match) first."

### 3.4 Pure helpers (`src/player/merfolk/rules.js`, no three.js, no DOM: Node tests import it)

```js
export const SEA_IN = 0.25;        // s of deep swimming before she turns
export const SEA_OUT_LAND = 0.35;  // s on the ground out of the water before she turns back
export const SEA_OUT_AIR = 1.4;    // s out of the water (a leap) before she turns back anyway
export const SEA_GROW = 0.35;      // s for the tail to grow or shrink
export const SEA_CUT = 0.12;       // s for a cut (flying, mounting, teleport, Just Me)
export const SEA_SWIM = 4.6;       // blocks/s with a tail (today's SWIM is 2.8)
export const SEA_SWIM_FAST = 6.2;  // fast (Shift, or the joystick pushed to its edge)
export const ME_SWIM = 4.0;        // Just Me in deep water
export const ME_SWIM_FAST = 5.4;
export const SEA_VY = 3.4;         // up / down speed
export const SEA_VY_RATE = 6;      // 1/s easing of the vertical speed toward its target
export const BUOY_DELAY = 1.0;     // s with no Up / Down before she floats up
export const BUOY_VY = 1.0;        // blocks/s of the gentle float up
export const SHALLOW_VY = -1.5;    // with no input in shallow water she settles onto the bottom
export const HOP_HOLD = 0.35;      // s after a shore / step hop with plain gravity (no easing)
export const LEAP_V = 9.2;         // leap start speed: 9.2^2 / (2 * 24) = 1.76 blocks of rise
export const LEAP_MIN_HS = 3.0;    // horizontal speed needed for a leap
export const LEAP_COOLDOWN = 0.9;  // s between leaps
export const FP_DIVE_DEAD = 0.2;   // first person: camera pitch (rad) before look-to-dive starts
export const SEA_DEFAULT_HEX = { mermaid: '#3FD8B0', sea_dragon: '#2FB5B0' };

/** 'mermaid' | 'sea_dragon' for 'auto'. style: 'girl'|'boy'|'mix'|null (device only).
 *  With no style, the worn look decides (only the look, which is already in the profile). */
export function autoSeaForm(style, look) {
  if (style === 'boy') return 'sea_dragon';
  if (style === 'girl' || style === 'mix') return 'mermaid';
  return look && lookFits(look, 'b') && !lookFits(look, 'g') ? 'sea_dragon' : 'mermaid';
}

/** The form a look shows: its own choice, or autoSeaForm(style, look) for 'auto'. */
export function resolveSeaForm(look, style) { ... } // -> 'mermaid' | 'sea_dragon' | 'me'

/** A NEW normalized look with 'auto' replaced (what friends receive in lk). Never mutates `look`. */
export function withResolvedSea(look, style) { ... }

/** The tail's hex. sea.color if set; else Match: the dress color, else the bottom color,
 *  snapped: an exact SEA_COLORS entry stays; a color with saturation < 0.35, lightness < 0.22
 *  or > 0.9, or a brown (hue 15-45 and lightness < 0.5) gives SEA_DEFAULT_HEX[form]; anything
 *  else gives the SEA_COLORS entry (Pearl left out) with the nearest hue. For a sea dragon,
 *  a Match that comes out Purple or Pearl gives its Deep teal (never a purple dragon). */
export function seaColorOf(look, form) { ... }

/** Deep enough to turn: liquid at the waist and (one more liquid cell below the feet or
 *  liquid at head height). liquidAt(x, y, z) -> bool. Puddles one block deep never count. */
export function seaDeep(liquidAt, x, y, z) {
  return liquidAt(x, y + 0.6, z) && (liquidAt(x, y - 0.4, z) || liquidAt(x, y + 1.4, z));
}

/** Liquid cells straight below the feet (0..cap), for the dive hint (≥ 3) and the pool tip. */
export function depthBelow(liquidAt, x, y, z, cap = 4) { ... }

/** The turn-in / turn-back timer with hysteresis (one per swimmer). */
export class SeaGate {
  constructor() { this.on = false; this.inT = 0; this.outT = 0; }
  reset() { this.on = false; this.inT = this.outT = 0; }
  /** f = { deep, swimming, onGround, blocked }. Returns 'in' | 'out' | 'cut' | null. */
  step(dt, f) {
    dt = Number.isFinite(dt) ? Math.min(Math.max(dt, 0), 0.1) : 0;
    if (f.blocked) { const was = this.on; this.reset(); return was ? 'cut' : null; }
    if (!this.on) {
      this.inT = f.deep && f.swimming ? this.inT + dt : 0;
      if (this.inT >= SEA_IN) { this.on = true; this.inT = this.outT = 0; return 'in'; }
      return null;
    }
    this.outT = f.swimming ? 0 : this.outT + dt;
    if ((f.onGround && this.outT >= SEA_OUT_LAND) || this.outT >= SEA_OUT_AIR) { this.reset(); return 'out'; }
    return null;
  }
  /** Turn on at once (mounting a dolphin before the 0.25 s are up). */
  force() { this.on = true; this.inT = this.outT = 0; }
}
```

- The gate now runs for **every** form, Just Me included: `gate.on` means "sea swimming" (easy
  controls). Only the tail depends on the form.
- `'cut'` = turned back at once (flying, mounting a pony or vehicle, sitting, sleeping, the zip
  line, a teleport): sparkles, quick shrink, no sound.
- Once on, shallow water keeps the gate on while she still swims (`swimming` true); only leaving
  the water turns her back.
- Checked in Node for `DEFAULT_LOOK` and all 12 starters (`applyOutfit(DEFAULT_LOOK, o)`): Match
  gives girl starters Pink, Purple, Gold, Purple, Ocean blue, Hot pink; boy starters as a Sea
  Dragon give Deep teal (soccer white, skater gray, dino brown, dapper near-black), Purple
  (space) and Ocean blue (camp). The default look gives Purple.

`wardrobe-data.js` re-exports nothing from `rules.js`; `rules.js` imports `normalizeLook` and
`lookFits` from `wardrobe-data.js` (one direction only). `lookFits` normalizes, so callers cache
the result (§6.3); it never runs per frame.

### 3.5 Profile and device storage

- **No new profile key.** `look.sea` travels inside `profile.look`, `profile.outfits[]` (saved
  slots) and NPC friend looks. `mergeProfile` merges `look` one level deep with the default look
  (`src/core/game.js:60-69`), so an old profile gains `sea: { form: 'auto', color: null }` in
  memory. `account/merge.js`, `BACKUP_PROFILE_KEYS` and `mergeBackupProfile`
  (`src/core/storage.js:86`, `:110-145`) need **no change** (the look already travels whole).
- **Device only** (`SaveStore.deviceSet`, never in the profile, a backup or the cloud):
  - `seaHints` (0..2): how many times the dive hint was shown (§5.4).
  - `seaAsked` (0..2): how many times the first-turn bubble was shown; 2 after a tap (§5.2).
  - `seaTabSeen` (bool): the Water tab was opened (hides its "new" dot, §5.1).
  - `seaPoolHint` (bool): the "make it 2 deep" tip was shown (§5.4).
  - `seaLeapTips` (0..1): the leap tip was shown (§5.4).
- `deviceGet` is called only on events and turns, never per frame (§6.3).

### 3.6 Presence (MULTIPLAYER.md §5.4)

- `st` gains **`m`** = "in sea form with a tail (swimming, or leaping out of the water)". The
  adapter sends it whenever `player.seaForm` is set and she is not riding; otherwise today's
  letters (a Just Me sea swimmer sends `i`; a dolphin rider sends `h`).
- `lk` is `packLook(withResolvedSea(profile.look, style))`: friends get `mermaid` /
  `sea_dragon` / `me`, never `auto`, never the style. A remote page that somehow receives
  `auto` draws it as `me` (the avatar's default `seaAuto`, §4.2).
- NPC friend motion samples (`friend.js:206-210`, channel `nx`) gain `st` **`m`** the same
  way. No new field anywhere, no protocol bump (peers share the build id `pv`,
  MULTIPLAYER.md:317).

### 3.7 Events (append to the DESIGN.md table, `docs/DESIGN.md:258-284`)

```
'player:seaform'    { form }                 // 'mermaid' | 'sea_dragon' when the tail appears or changes form, null when it goes (local player only)
'player:leap'       { pos: [x, y, z], form } // a dolphin leap out of the water; form is null for Just Me (local player only)
'style:changed'     { style }                // the Studio's Girl / Boy / Mix button changed (device-local)
```

`'player:swim'` keeps its meaning (every entry into water, `player.js:131`). No event is sent
for Just Me sea swimming (nothing to see).

---

## 4. Files

### 4.1 New files

| file | contents |
|---|---|
| `src/player/merfolk/rules.js` | §3.4: constants, `autoSeaForm`, `resolveSeaForm`, `withResolvedSea`, `seaColorOf`, `seaDeep`, `depthBelow`, `SeaGate`, `leapCheck(f)` (pure). |
| `src/player/merfolk/parts.js` | `buildSea(P, form, hex, look)` (§7), `class TailTube` (CPU-deformed tail with attached extras, like `Flare`, `src/player/avatar/geo.js:348-473`), `flukeGeometry(form)`, painters `paintScales(g, w, h, hex, form)` and `paintFin(g, w, h, hex, form)` (used through the texture cache `acquire`, `src/player/avatar/textures.js:31`). Imports three.js and `GeoBuilder`; no DOM at import time. |
| `src/player/merfolk/index.js` | `install(game)`: the `merfolk` system (the first-turn bubble, the dive / pool / leap tips, the bubble trail, the underwater overlay §5.6, sticker awards, the joystick label), `game.debug.merfolk` (§14.3), CSS for the overlay and the bubble. |
| `src/player/merfolk/stickers.js` | `SEA_STICKERS` (`sea_magic`, `big_leap`) with 100×100 canvas art, `installSeaStickers(game)` → `award(id)` (same shape as `src/things/vehicles/stickers.js:75-92`). |
| `tools/test-merfolk.mjs` | Node unit tests (§14.1). |
| `tools/probe-merfolk.mjs` | Browser probe (§14.3). |
| `tools/fixtures/merfolk-old-profile.json` | A profile saved by build `669b6fa` (before this change): a dress look, two saved outfit slots, Boy style is **not** in it (device only). Recorded before any code change (§14.3 B14). |

`package.json` scripts: `"test:merfolk": "node tools/test-merfolk.mjs"`,
`"probe:merfolk": "node tools/build.mjs && node tools/probe-merfolk.mjs"`.

### 4.2 Changed files (game)

| file | where | change |
|---|---|---|
| `src/player/wardrobe-data.js` | header `:11-19`; `DEFAULT_LOOK` `:21-35`; after `BROWS` `:101`; `KEYS` `:157-162`; `normalizeLook` `:182-228` | §3.1-3.2: `sea` in the schema and the default, `SEA_FORMS`, `SEA_COLORS`, `SEA_COLOR_NAMES`, `KEYS.sea`, `seaCol`, the `sea` block. |
| | `randomLook` `:297-301` | wrap the three branches: `const out = ...; if (base) out.sea = normalizeLook(base).sea; return out;` (no `rand()` call is added, so every seeded surprise is unchanged; `girlLook`/`boyLook` return `normalizeLook(...)`, which adds the default `sea` without base). |
| | `applyOutfit` `:541-557` | nothing: it spreads `base`, so `sea` is kept. |
| `src/ui/dressup/debug.js` | `OPTION_LISTS` `:11-14` | append `'SEA_FORMS'`. |
| `src/net/codec.js` | imports `:5-8`; `L` `:362-366`; `packLook` `:376-402`; `unpackLook` `:444-449` | §3.3, including the "later tokens" comment. |
| `src/world/physics.js` | `move` `:93`; `grounded` `:141` | `move(body, dt, { step = true, swim = false } = {})`; `const grounded = wasOnGround \|\| res.onGround \|\| swim;`. Only the player passes `swim` (`!!this.seaSwim`); friends and pets do not, so their behavior is byte-for-byte the same. A sea swimmer then steps up underwater steps (≤ 0.55) and gets `res.ledge` at the shore and at a pond rim (≤ 1.05). |
| `src/core/input.js` | after `:162` | `this.downKey = on && (k.has('KeyC') \|\| v.down \|\| latch.down);` (Down without Shift). `input.down` keeps today's meaning for flying and pets. |
| `src/player/avatar.js` | `createAvatar` `:159-160` | `opts.seaAuto`: a function `(look) => form` or a string; default `() => 'me'`. |
| | `material()` `:200-238` | new keys `scale:<hex>:<form>` (Lambert, `vertexColors`, repeat map from `paintScales`, FrontSide: **the same program as `cloth:`**; `emissive` = the tail color, `emissiveIntensity` 0.12) and `fin:<hex>:<form>` (Lambert, `vertexColors`, map from `paintFin`, `DoubleSide`: **the same program as `cloth2:`**; plus `transparent`, `depthWrite: false`, `emissiveIntensity` 0.25, which are not program defines). Every sea geometry carries a white `color` attribute so `vertexColors` matches. Both go through `register(...)` with their `texKeys`, so `setOpacity` and `dispose` reach them; their keys go in `sea.matKeys`; pushed to a `seaMats` list for the shimmer. Glow spots use the existing permanent `glow` material. |
| | `clearParts` `:356-368` | calls `disposeSea()` **first**. |
| | `build()` `:370-416` | keep the flare meshes: `parts.flareMeshes = [...]` (the `P.flares` loop `:393-398`). Sea parts are **not** built here. The stale-material sweep (`:399-405`) also skips keys starting with `scale:` or `fin:` (belt and braces: `disposeSea` already removed them). |
| | new `disposeSea()` | **the only owner of sea resources**: removes its meshes from their parents and disposes their geometries; removes its dynamic bones from `av.dynBones` and `bones`; for each key in `sea.matKeys`: `mats.get(k).mat.dispose()`, `release(tk)` for each of its `texKeys` **exactly once**, `mats.delete(k)`; empties `seaMats`; `sea = null`. |
| | after `build()` | `ensureSea(form, hex)`: if `sea` already matches, return; remember `wasShown = seaW > 0.5 && sea && sea.form !== form`; `disposeSea()`; `const P = new BuildContext(av, look)`; `const out = buildSea(P, form, hex, look)`; then one mesh per `P.builders` entry exactly like `build()` (`:380-389`, materials through `material()`), plus `out.custom` meshes (tube, fluke). All go under `sea.root` (a `Group` child of `bones.hips` at the hip pivot) or on the bones `buildSea` names. Dynamic bones made by `P.bone` are recorded in `sea.bones`. Built hidden. If `wasShown`, emit the turn sparkle and set `seaFlash = 1` (a form change while the tail is out, e.g. a Studio tap or the bubble). |
| | `update()` `:878-997` | §6.3-6.4: the sea weight `seaW` and its target; pose choice gains `poseSea`, `poseLeap` and `poseSaddleSea`; legs, flares and `parts.lift` follow `seaW`; `heldBone.visible` also needs `seaW < 0.5`; the flare deform (`:948-956`) is skipped while `seaW > 0.5`; after the bones are applied, `seaTick(dt, s, speed)` deforms the tube, places the fluke, flutters the frill and pulses `seaMats` (only while `seaW > 0`). |
| | `springs()` `:761-874` | for hair chains while `seaW > 0.5` and not riding: `tx = tx * 0.5 + 0.32 + Math.sin(t * 1.3 + ci) * 0.08`, `K` 30 instead of 70, `C` 6 (soft floating hair). Capes unchanged. |
| | `setLook` `:418-425`, new `setSeaAuto` | both clear the cached resolved form (`autoForm = null`); it is recomputed once, on the next frame that needs it (§6.3). |
| | `resetPose()` `:1000` | `seaW = seaTarget; seaPhase = 0;` (snapshots and teleports snap, no sparkles). |
| | API `:1044-1073` | `get seaForm()` (resolved: `'mermaid'`, `'sea_dragon'` or `'me'`, from the cache), `get seaShown()` (`seaW > 0.5`), `setSeaAuto(fnOrString)`. |
| | `dispose()` `:1029` | `disposeSea()` first. |
| `src/player/player.js` | constructor `:42` | `game.createAvatar(game.profile.look, { seaAuto: (look) => autoSeaForm(game.surpriseStyle ? game.surpriseStyle() : null, look) })`; `this.seaGate = new SeaGate(); this.seaSwim = false; this.seaForm = null; this._leapAt = -1e9; this._hopT = 0; this._idleVT = BUOY_DELAY; this._seaToastShown = false;`; listener `'style:changed'` → `this.avatar.setSeaAuto(...)` (same function, so the cache refreshes). |
| | `_onKey` `:53-64` | ignore the double-Space fly while `this.seaSwim && (this.swimming \|\| this.state === 'ride')` (merged with ocean's dolphin line, §4.4). The Fly button and F still fly. |
| | `update()` `:129-170` | §6.1-6.2: after `this.swimming` is set, step the gate; speed, acceleration and the vertical block use the sea numbers while `seaSwim`; the shore hop; the leap check; the first-person look-to-dive. Shallow-water swimming and land keep today's code path exactly. |
| | `:161` | `physics.move(this.body, dt, { step: !this.flying, swim: this.seaSwim && this.swimming })`. |
| | `:164-167` | auto-hop condition becomes `res.ledge !== null && !this.flying && wishLen > 0.3 && (this.onGround \|\| (this.seaSwim && this.swimming))`; on a hop while `seaSwim`, also `this._hopT = HOP_HOLD` and a small splash (`celebrate(..., 'splash', { quiet: true })`). |
| | `:188` | unchanged (`state` stays `'swim'` / `'walk'`; `seaForm` and `seaSwim` are separate). |
| | `_syncAvatar` `:201-217` | the merged literal (§4.4): `..., riding: ..., sea: !!this.seaForm, seaRide: <ocean's expression>, seaCut: this._seaCutFrame` (`_seaCutFrame` is set by `_seaOut(true)` and cleared after this call). |
| | `setFlying` `:219` | after the `if (this.flying === on) return` early exit, and only when `on`: `this._seaCut()`. |
| | `sitOn` `:245`, `sleepIn` `:260`, `hold` `:342`, `teleport` `:370` | call `this._seaCut()` first. |
| | `mount` `:329` | `if (m && m.kind === 'dolphin') { if (!this.seaGate.on && this.swimming) { this.seaGate.force(); this._seaIn(form) } } else this._seaCut();` A dolphin ride keeps (or starts) the tail; every other mount cuts it. |
| | new | `_seaIn(form)`: if `form !== 'me'`: `seaForm = form`, `magic` at pitch 1.25 volume 0.7, emit `'player:seaform' { form }` (the merfolk system adds the toast / sticker / bubble). `_seaOut(cut)`: if `seaForm`: `magic` at pitch 0.9 volume 0.5 unless `cut`, `_seaCutFrame = cut`, emit `'player:seaform' { form: null }`; then `seaForm = null`, `seaSwim = false`. `_seaCut()`: if `seaGate.on`, `seaGate.reset()` and `_seaOut(true)`. The avatar's own weight does the shrinking and the sparkles (§6.3). |
| | `emote()` `:362` | while `this.seaForm`, allow only `wave` and `heart` (arm-only; §6.3); everything else returns. |
| `src/player/emotes.js` | `pick` `:38-41` | while `p.swimming \|\| p.seaForm`: the wheel shows only Wave and Heart; any other pick gives the same "Swim to the shore first!" toast. |
| `src/player/camera.js` | `headY` `:85` | `const sea = !!this.player.seaForm && this.player.state !== 'ride';` then `... : sea ? (first ? 1.15 : 1.05) : first ? EYE : HEAD`. |
| `src/ui/hud.js` | `refreshFly` `:484-497`; events `:586-589` | `const sea = !!(game.player && game.player.seaSwim && game.player.state !== 'ride');` → `upBtn.hidden = downBtn.hidden = !(flying \|\| sea); jumpBtn.hidden = flying \|\| sea;`. Add `'player:seaswim'` (an internal event the player emits when `seaSwim` changes; not in the DESIGN table) to the refresh events. CSS class `sw-pulse` on the Down button while the dive hint shows (§5.4). |
| `src/ui/touch.js` | joystick label `:131-135`; `KEY_CARDS`, `TOUCH_CARDS` `:147-175` | on `'player:seaswim'` with `on`, the label says **Swim**; back to **Walk** when it ends (and on `world:unload`, as today). Help: touch card `[tail picture, 'In deep water: Up and Down to swim and dive']`; key card `[Space · C · Shift, 'In deep water: Space up, C down, Shift fast']`; the Shift card text stays "Run or go down" (true on land and flying). |
| `src/ui/icons.js` | `PATHS` | two new icons: `tail` (a fin rising from a wave) and `deep` (two stacked water blocks with a wave on top). |
| `src/ui/photo.js` | `selfieCamera` `:312-316` (the `hy` line `:314`); the shot compose `:179-188` | `hy = p.position.y + (p.seaForm && p.state !== 'ride' ? 1.0 : 1.3)`; when `game.underwater` was set at capture time, draw the same tint gradient over the photo area in the 2D compose, so the photo is what she saw. |
| `src/ui/dressup.js` | `TABS` `:21-35`; `ZOOMS` `:40-45`; `_applied` `:314`; `_buildTab` | §5.1: tab `{ key: 'sea', label: 'Water', aria: 'Water: mermaid, sea dragon or just me', zoom: 'sea' }` inserted **right after `shoes`**; `ZOOMS.sea = { cy: 0.78, span: 2.6 }`; `_applied` plays no emote when `this.tab === 'sea'`; `case 'sea'` builds the form grid and the color row. Tile snapshot keys come from the existing `_grid` (`${tabKey}\|...`) with `tabKey 'sea'`, so `stage.prune` (`:282`) drops them on close. |
| | `_grid` `:782-850` | `cfg.pose` passed through to `stage.snapshot(key, look, { frame, size, pose: cfg.pose })` (`:824`). |
| | `_swatches` | `cfg.first`: an extra first swatch (value `null`, class `sw-sw--match`, aria "Match my clothes", the `match` picture) for the tail color. |
| | tab bar | a small sparkle dot (`sw-new`) on the Water tab while `!deviceGet('seaTabSeen')`; opening the tab sets it. |
| | `open()` | when `game.player.seaForm` is set, open on the Water tab. |
| | `_setStyle` `:364-371` | emit `'style:changed' { style: s }`; refresh the Water tab if open. |
| | `_lookFor` `keep` `:398` | `keep = (l) => W.normalizeLook({ ...l, name, skin, eyes..., sea: cur.sea })` (a tail choice survives Girl / Boy swaps; `'auto'` then follows the new button). |
| | `_wearSlot` `:1076-1079`; slot "on" `:1022` | `W.normalizeLook({ ...saved, name: d.name, sea: d.sea })` (the tail choice is part of who you are, like the name); the "on" check compares both sides with `sea` taken out. `_saveSlot` stores the look without `sea`. |
| | dress tile hint | picking the Mermaid Dress shows the hint "Swim in deep water for a real tail!" (§10.2). |
| | `_setupPreview` `:1094` | `createAvatar(this.look, { fx, seaAuto: (look) => autoSeaForm(this.style(), look) })`. |
| | `_frame` `:1143` | `p.avatar.update(dt, this.tab === 'sea' ? SEA_PREVIEW : IDLE)` with `const SEA_PREVIEW = { speed: 1.6, onGround: false, swimming: true, sea: true }` (Just Me shows today's swim pose, because the avatar shows no tail for `'me'`). |
| `src/ui/dressup/stage.js` | `FRAMES` `:22-35` | `sea: { cy: 0.85, span: 2.5, yaw: 1.15, pitch: 0.18 }` (a side view of a swimmer). |
| `src/ui/dressup/pictures.js` | `P` | `sea` (a wave with a tail fin rising out of it), `match` (a little shirt next to a fin, both pink), `mermaid`, `sea_dragon`, `me` (used by the Studio fallback tiles and the first-turn bubble). |
| `src/account/portrait.js` | `send` `:39` | `const key = JSON.stringify({ ...look, sea: null })`: a tail choice never re-uploads the head picture. |
| `src/net/adapter.js` | `ST` `:21`; `local()` `:571`, `:582-587`; constructor `:41-47` | `const st = pl ? (pl.seaForm && pl.state !== 'ride' ? 'm' : ST[pl.state] \|\| 'w') : 'w';`; `this._lk = packLook(withResolvedSea(prof.look \|\| {}, g.surpriseStyle ? g.surpriseStyle() : null))`; drop `_lk` on `'style:changed'` too. |
| `src/net/remote-players.js` | `_frame` `:458-479`; `_ingest` `:348`; `_placeBubble` `:598-599` | §9.2. |
| `src/things/friends/friend.js` | constructor `:34`; `netSample` `:206-210`; `puppet` `:256`; `update` `:402-410`; `_move` `:686-688` | §8: `seaAuto` by `def.kind`; a `SeaGate` stepped in `_move` (host only); puppets set `seaOn` straight from `st`; `sea: this.seaOn` to `avatar.update`; water speed `* (this.seaOn ? 1.05 : 0.65)`; `st` `'m'`. |
| `src/things/friends/index.js` | react list `:760` | a `'player:seaform'` listener that reacts only when `form` is set and only **once per world visit** (a flag reset on `world:load`). |
| `src/things/friends/chat.js` | `LINES.events` | `'player:seaform': ['Whoa! Look at your tail!', 'So sparkly! Let\'s swim!', 'You swim so fast now!']`. |
| `src/main.js` | imports; `modules` `:51-53` | `import * as merfolk from './player/merfolk/index.js'`; insert `merfolk` after `stickers` (stickers registry exists; particles exist). |

Not changed: `src/core/game.js`, `src/core/storage.js`, `src/account/merge.js`,
`src/account/legacy.js`, `src/net/protocol.js`, `src/net/host.js`, `src/net/guest.js`,
`src/net/actors.js`, `src/things/pets/*`, the server, world saves, world generation.

### 4.3 Changed files (tests, site, docs)

| file | change |
|---|---|
| `tools/test-net.mjs` | codec test `:129-136`: `'sea.form': wardrobe.SEA_FORMS` in `lists`; a loop over every `SEA_COLORS` entry and `null`; "today's 36-token string unpacks to `auto` / Match"; "a default look still has 36 tokens" (the existing `eq(oldToks.length, 36)` at `:170` must keep passing); worst case with sea ≤ 160. New block `merfolkTests()` appended after `vehicleTests` (§14.2). |
| `tools/probe-multiplayer.mjs` | **`LOOKS` `:528-545` must change**: `want` is computed the way the adapter does, `codec.packLook(rules.withResolvedSea(mine, style))`, with `style` read from Rosie's page (`g.surpriseStyle()`), and the later `unpackLook` comparison takes `sea` out of both sides (or compares with the resolved look). New test `SEA` after `LOOKS` (§14.4). |
| `tools/net/fake-adapter.mjs` | **no edit**: `local()` already returns `st: this.st` (`:427`); tests set `fake.st = 'm'`. |
| `tools/probe-boys.mjs` | **no edit expected**: `TAIL = '.0.7'` (`:100`), A3 and A9 keep passing because the sea tokens are left out for the default. If an integrator sees them fail, the sea tokens are being written for `'auto'`, which is a bug. (Before declaring this, grep every probe for `.lk` and `packLook(`; the grep at `669b6fa` finds only probe-boys and probe-multiplayer `LOOKS`.) |
| `tools/lib/name-scan.mjs` | shared trademark scanner (owned by squishies or the integrator, §14.1 A13); merfolk only adds its own encoded words. |
| `docs/DESIGN.md` | events table (`:258-284`): 3 rows (§3.7); §1 activities: one line "Swim as a mermaid or a sea dragon in deep water"; stickers list: 2 rows; Player section: sea form, sea swim, the shore hop. |
| `docs/MULTIPLAYER.md` | §5.4 `st` row (`:313`): add `m` sea-form swim; §5.13: the appended sea tokens, the 156 worst case and the "later tokens" rule (§3.3); NPC `nx` sample `st` adds `m`. |
| `docs/DATA-MAP.md` | `:50`: "her avatar look (including the water form she picked and its tail color)". Add: "A tail form chosen automatically from this device's Girl / Boy button is shown to friends like clothes are; the button itself is never sent or stored." Not personal data. |
| `docs/teams/avatar.md` | one paragraph pointing here (sea parts are lazy, outside `build()`, and `disposeSea()` owns their materials). |
| `docs/teams/ocean.md` | the merged `_syncAvatar` and remote `_frame` literals (§4.4), and the side-saddle decision for its §15 (the integrator pastes them; merfolk does not edit ocean's doc). |
| `site/index.html` | `:111`: the integrator adds one sentence for all three new teams, e.g. "Then came even more wishes: mermaids and sea dragons, dolphins, squishy toys and surprise presents." |

### 4.4 SHARED FILES (other teams may touch these in the same wave)

Builders edit only the lines listed above in these files and tell the integrator.

| File | Merfolk touches | Who else may touch it this wave |
|---|---|---|
| `src/player/wardrobe-data.js` | `DEFAULT_LOOK`, two lists appended after `BROWS`, `KEYS`, `normalizeLook`, `randomLook` wrapper | squishies only if they take their optional `'squish'` emote (append to `EMOTES` `:127`, squishies.md §12). Different lines. |
| `src/net/codec.js` | `L`, `packLook` tail, `unpackLook` tail | none expected (squishies and ocean: "not touched"). |
| `src/world/physics.js` | `move` options, `grounded` | none expected. |
| `src/core/input.js` | one `downKey` line after `:162` | none expected. |
| `src/player/avatar.js` | `material`, `build`, `clearParts`, `update`, `springs`, `disposeSea`, API | ocean: reads nothing new (ocean.md §4.4). Merfolk reads `s.seaRide` (§6.5). |
| `src/player/player.js` | water block `:129-170`, `_onKey`, `_syncAvatar`, `mount`, cut hooks | **ocean**: `_onKey :56` (dolphin early return) and `_syncAvatar :207-216` (`seaRide`). Merged forms below; both docs carry them. |
| `src/net/adapter.js` | `local()` `st` and `lk` lines, one listener | **squishies** (`heldKey()` `:606-617`), **ocean** (`sr: this.seaRideField()` in `local()`). Different lines of the same literal: keep one property per line. |
| `src/net/remote-players.js` | `_frame` flags, name tag and bubble top, `_ingest` sparkle | **squishies** (`heldModel()` `:56-67`), **ocean** (`_ingest` `f.sr`, `_frame` `seaRide` and `remoteRide`, `_drop`, `list()`). Merged `_frame` literal below. |
| `src/ui/hud.js` | `refreshFly`, one event, the pulse class | **squishies** (coin pill `:358-362`, `refreshCoins` `:516-530`). Different lines. |
| `src/ui/touch.js` | joystick label listener, two help cards | **ocean** may set "Ride" on the joystick (ocean.md §4.4). Order: ride label wins while riding. |
| `src/ui/icons.js` | two icons appended | squishies / ocean may append icons. Append only. |
| `src/ui/dressup.js`, `src/ui/dressup/stage.js`, `src/ui/dressup/pictures.js`, `src/ui/dressup/debug.js` | Water tab, slots, `OPTION_LISTS` | none expected. |
| `src/ui/photo.js` | `hy`, the underwater tint in the compose | none expected. |
| `src/things/friends/index.js`, `chat.js` | one listener, one events entry | ocean may add "Look, a dolphin!" lines (`LINES.events`, a different key). |
| `src/main.js` | one import (`merfolk`), one module entry | **squishies** (one entry), **ocean** (`import * as sea from './life/sea/index.js'`). Distinct names; each on its own line. |
| `src/life/stickers.js`, `src/ui/stickerbook.js` | **not touched** (stickers are added on `game:ready` from `src/player/merfolk/stickers.js`) | everyone adds stickers the same way. |
| `docs/DESIGN.md` events table, `docs/MULTIPLAYER.md` presence table, `docs/DATA-MAP.md` | rows appended | squishies, ocean. |
| `tools/test-net.mjs`, `tools/probe-multiplayer.mjs` | a block and a test each, plus the `LOOKS` `want` fix | squishies, ocean. |
| `tools/test-name.mjs`, `tools/lib/name-scan.mjs` | merfolk's encoded words | squishies (owner of the scanner), ocean. |
| `site/index.html` `:111` | one combined sentence (integrator) | squishies, ocean. |

**Merged `_onKey` (player.js `:53-64`)**, ocean's line and merfolk's line together:

```js
if (this.state === 'ride' && this.mountPet && (this.mountPet.kind === 'vehicle' || this.mountPet.kind === 'dolphin')) return; // horn / dolphin leap
if (this.seaSwim && this.swimming) return; // Space is Up in deep water: never a double-tap fly
```

**Merged `_syncAvatar` state literal (player.js `:207-216`):**

```js
this.avatar.update(dt, {
  speed: Math.hypot(this.velocity.x, this.velocity.z),
  onGround: this.onGround,
  swimming: this.swimming,
  flying: this.flying,
  sitting: this.state === 'sit' || seated,
  sleeping: this.state === 'sleep',
  riding: this.state === 'ride' && !seated,
  seaRide: this.state === 'ride' && !!this.mountPet && this.mountPet.kind === 'dolphin', // ocean
  sea: !!this.seaForm,                                                                    // merfolk
  seaCut: this._seaCutFrame,                                                              // merfolk
});
```

**Merged remote `_frame` flags (remote-players.js `:462-470`):**

```js
const seaRide = st === 'h' && f.sr !== null && !f.vehicle;                       // ocean
const sea = st === 'm' || seaRide;                                               // merfolk: a rider's tail shows if her lk form has one
const inLiquid = st === 'm' && g.physics ? g.physics.liquidAt(f.pos.x, f.pos.y + 0.6, f.pos.z) : false;
av.update(dt, {
  speed: f.speed,
  onGround: st !== 'f' && st !== 'i' && st !== 'l' && st !== 'm',
  swimming: st === 'i' || inLiquid,                                              // 'm' in the air = poseLeap
  flying: st === 'f',
  sitting: st === 's' || seated,
  sleeping: st === 'z',
  riding: st === 'h' && !seated,
  seaRide,                                                                       // ocean
  sea,                                                                           // merfolk
});
```

---

## 5. UI and controls (iPad first)

### 5.1 Dress-Up Studio: the Water tab

- New tab **Water** with the `sea` picture, **right after Shoes** (the tail takes the place of
  legs and shoes). A small sparkle "new" dot sits on it until it is first opened
  (`seaTabSeen`, device only). When Dress Up is opened while she is in sea form, it opens on the
  Water tab. Zoom `sea`. While the tab is open, the preview avatar swims on the turntable in her
  form (tail kicking slowly, hair floating), so the child sees what she picked right away.
- Section 1, title **"I swim as"** (picture `sea`): a big-tile grid (`big: true`)
  of three 3D tiles, each a side view of her own look swimming (`stage.snapshot` with
  `frame: 'sea'`, `pose: { state: { swimming: true, sea: true, speed: 2.2, onGround: false }, t: 0.9 }`):
  **Mermaid**, **Sea Dragon**, **Just Me** (the Just Me tile shows today's swim pose).
  - Order: Boy style → Sea Dragon, Mermaid, Just Me. Anything else → Mermaid, Sea Dragon, Just Me.
    **Both forms always show**, whatever the style.
  - The tile that is on: the explicit form, or for `'auto'` the form it resolves to. A tap
    always stores the explicit key (`d.sea.form = o.key`), even on the tile already on.
  - Tap: `this.change(..., { kind: 'item', sound: 'magic' })`; **no emote** (`_applied` skips it
    on this tab); the hint under the avatar says the line from §10 for 2.6 s; the preview
    sparkles because `ensureSea` rebuilds with a different form while the tail is out (§4.2).
- Section 2, title **"Tail color"**, hidden while the form shows Just Me: a swatch row: first
  **Match** (the `match` picture; on while `color === null`), then the 12 `SEA_COLORS`
  (aria labels from `SEA_COLOR_NAMES`). Tap: `d.sea.color = c` (or `null`), `kind: 'color'`.
- Undo works as for any look change. Surprise me! keeps `sea` (it keeps who you are). Wearing
  a saved outfit keeps `sea` too (§4.2 `_wearSlot`).
- Phone (390 wide): the big grid is 3 tiles in one row at 108 px; the swatch row wraps. The
  tab sits 8th instead of 14th, so on a phone it is a short scroll from Shoes.

### 5.2 Turning in the world

- In: sparkles + bubbles at the hips (`fx('sparkle', { count: 14, spread: 0.5 })`,
  `fx('bubble', { count: 6 })`), glints along the tail while it grows (one every 0.05 s for
  0.35 s), the scales flash (`emissiveIntensity` 0.6 → 0.12 over 0.5 s), `magic` pitch 1.25.
- The first turn in each world visit: toast **"Mermaid magic!"** or **"Sea Dragon magic!"**
  (icon `sparkle`, color `mint`, 2.6 s). The first turn ever: the **Sea Magic!** sticker pop
  (its own celebration; the toast is skipped that time).
- Out: smaller sparkle (`count: 8`), tail shrinks, legs show at half way, `magic` pitch 0.9
  volume 0.5. A cut (flying, mounting a pony or vehicle, a teleport, choosing Just Me) shrinks
  in 0.12 s (`seaCut` in the avatar state) with the sparkle and no sound.
- **The first-turn bubble** (`seaAsked < 2` and the look's form is `'auto'`): after the turn
  (on the first-ever turn, 2.6 s later so the sticker pop has flown away; otherwise 0.6 s), a
  bubble over her head in the pets bubble style (`src/things/pets/ui.js:455-470`, `roundBtn`,
  classes `lf-bubble`, `sw-round`): three big round picture buttons, **Mermaid** (`mermaid`
  picture), **Sea Dragon** (`sea_dragon`), **Just Me** (`me`), each a picture and one word. It
  is **not modal**: the joystick, buttons and camera all keep working, nothing pauses. It fades
  after 8 s, when she leaves the water, or when a panel opens. A tap stores the explicit form
  (one look change through the same path as the Studio's `_commit`: `profile.look` updated,
  `saveProfile`, `'avatar:changed'`), sets `seaAsked = 2`, and the new form shows at once with
  sparkles (a change to Just Me is a quick shrink). Ignoring it keeps `'auto'` and counts one
  showing (`seaAsked + 1`), so it can appear one more time on a later day. Probes set
  `seaAsked = 2` in their page tweaks, except where they test it.

### 5.3 Swimming controls

| | Touch (iPad / phone) | Keyboard |
|---|---|---|
| Swim | joystick (label **Swim**; pushed to its edge = fast) | WASD / arrows (Shift = fast, and only fast) |
| Up | **Up** button (the fly Up button, shown in deep water) | Space |
| Down | **Down** button (shown in deep water) | C |
| Float up | let go of Up and Down for 1 s | same |
| Leap | swim fast toward the surface holding Up | Space while swimming fast at the surface |
| Get out | swim at the beach or the pond rim: she flops up onto it | same |
| First person | looking down and swimming forward dives; looking up rises (dead zone 0.2 rad) | same |

The Jump button hides in deep water exactly as it does while flying (`hud.js:490-491`), so the
right side shows Up and Down in the same spots kids know from flying. Double Space never
toggles flying in deep water (the F key and the Fly button still do).

### 5.4 Tips (dive, leap, puddle)

- **Dive tip**: the first two times sea swimming starts on a device (`seaHints < 2`), and only
  when `depthBelow(...) ≥ 3` (there is something to dive into), 1.5 s after the turn (on the
  first-ever turn, after the bubble has gone): toast **"Hold Down to dive!"** (touch) or
  **"Hold C to dive!"** (keyboard), icon `down`, and the Down button **pulses** (CSS
  `sw-pulse`, a soft glow, 3 s) so the picture tells the story. Then `seaHints + 1`. Skipped
  while a panel is open.
- **Leap tip**: on the 3rd sea turn on a device (`seaLeapTips < 1`), toast **"Swim fast + Up =
  big leap!"** with the `up` icon; if an NPC friend is following, the friend says it instead:
  "Swim fast and press Up to leap like a dolphin!".
- **Pool tip**: once per device (`seaPoolHint`), when the resolved form is not Just Me, the
  `sea_magic` sticker is not owned yet (she has never turned) and she has swum 3 s in water
  that is not deep: toast **"Make it 2 deep for mermaid magic!"** (or **"... for sea dragon
  magic!"**) with the `deep` icon. This helps the child who built a 1-deep pool in a Flat world.

### 5.5 Photo mode

The selfie camera aims at the lower head in sea form (§4.2 `photo.js`). The selfie's heart
emote only plays when `state === 'walk'` (`photo.js:341`), so a leaping mermaid is never
interrupted. The tail, fins and frills are ordinary meshes, so they are in the picture. A photo
taken while the camera is underwater gets the same tint drawn over it (§5.6), so the saved photo
matches what she saw.

### 5.6 The underwater tint

- `src/player/merfolk/index.js` checks the camera every frame: the cell at the camera is a
  liquid **and** (the cell above is a liquid **or** the camera's fraction in the cell is below
  0.875, the drawn surface, `src/world/mesher.js:30`). `game.underwater` = the liquid's block
  key or `null`.
- A `div.sw-underwater` placed right after the game canvas (under the HUD, `pointer-events:
  none`, `contain: strict`) fades in (0.25 s, opacity only) with a **static** vertical gradient:
  water `rgba(120,210,255,.18)` → `rgba(30,110,200,.38)`; chocolate milk
  `rgba(150,90,50,.22)` → `rgba(90,50,25,.45)`; strawberry milk `rgba(255,190,220,.2)` →
  `rgba(240,110,170,.4)`. The light rays are a child element twice the screen's width with a
  `repeating-linear-gradient` at 100° (white 4 %), moved only with `transform: translate3d(...)`
  (`will-change: transform`, CSS animation 8 s, paused when hidden). The gradient is never
  repainted while it shows; the rays stay on the compositor.
- Cost: **one extra full-screen composited layer while the camera is underwater**, none above
  water (the div is `display: none` then). No shader, no render target, no change to resolution
  or fog. Never lower resolution to pay for it (B13f measures it on the iPad viewport).
- Lifecycle: `game.underwater = null` and the overlay hides on `world:unload`, whenever
  `game.mode !== 'play'` or `!game.physics` (title screen, menus that leave play), and after
  `exitToTitle`.
- For every swimmer (Just Me too).

---

## 6. Behavior

### 6.1 The gate (local player)

In `Player.update` after `this.swimming = inWater && !this.flying` (`player.js:136`):

```js
const form = this.avatar ? this.avatar.seaForm : 'me';   // cached in the avatar (§6.3)
const deep = physics ? seaDeep(this._liq, this.position.x, this.position.y, this.position.z) : false;
const ev = this.seaGate.step(dt, { deep, swimming: this.swimming, onGround: this.onGround, blocked: this.flying });
if (ev === 'in') { this.seaSwim = true; this._idleVT = BUOY_DELAY; this._seaIn(form); }
else if (ev === 'out' || ev === 'cut') this._seaOut(ev === 'cut');
else if (this.seaGate.on && (form === 'me' ? 'me' : form) !== (this.seaForm || 'me')) {
  // the form changed while in the water (Studio, bubble): a quick change, no gate reset
  if (form === 'me') { this._seaCutFrame = true; this.seaForm = null; emit('player:seaform', { form: null }); }
  else { this.seaForm = form; emit('player:seaform', { form }); }
}
```

(`this._liq` is a closure made once in the constructor, not per frame.) `seaSwim` is true while
the gate is on (every form); `seaForm` is the tail form or null. The early-return states (`hold`,
`sit`, `sleep`, `ride`) never reach this code, so every method that enters them calls
`_seaCut()` first (§4.2), except a dolphin ride (§6.5). A world load makes a new `Player`
(`player.js:426-433`), so the gate starts off; she turns again 0.25 s after the load if she is
in deep water (sparkles; the `'player:swim'` splash already happens today on that frame).

### 6.2 Physics while sea swimming (only while `this.seaSwim && this.swimming`)

```js
const tail = !!this.seaForm;
const speed = this.flying ? ... : this.seaSwim && this.swimming
  ? (input.run ? (tail ? SEA_SWIM_FAST : ME_SWIM_FAST) : (tail ? SEA_SWIM : ME_SWIM))
  : this.swimming ? SWIM : ...;
// vertical (replaces :147-150 only while sea swimming)
if (this._hopT > 0) {                      // a shore / step hop: plain gravity, no easing
  this._hopT -= dt; this.velocity.y -= GRAVITY * dt;
} else {
  let want = input.jump ? SEA_VY : input.downKey ? -SEA_VY : 0;   // Shift is never Down here
  if (firstPerson && wishLen > 0.2 && want === 0) {
    const p = rig.pitch; // positive looks down (camera.js:86-87: dy = -sin(pitch))
    if (Math.abs(p) > FP_DIVE_DEAD) want = -Math.sign(p) * Math.min(1, (Math.abs(p) - FP_DIVE_DEAD) * 1.6) * SEA_VY * Math.max(0, input.move.z);
  }
  this._idleVT = want !== 0 ? 0 : this._idleVT + dt;
  if (want === 0) {
    if (!deep) want = SHALLOW_VY;                                        // settle onto the bottom
    else if (this._idleVT >= BUOY_DELAY && physics.liquidAt(x, y + 1.1, z)) want = BUOY_VY; // float up
  }
  this.velocity.y += (want - this.velocity.y) * Math.min(1, SEA_VY_RATE * dt);
}
// the leap: swimming fast with Up held, head out of the water, rising
if (input.jump && hs > LEAP_MIN_HS && this.velocity.y > 1.5 && !physics.liquidAt(x, y + 1.5, z) && now - this._leapAt > LEAP_COOLDOWN * 1000) {
  this.velocity.y = LEAP_V; this._leapAt = now;
  g.audio.play('splash', { pitch: 1.2 }); g.celebrate([x, y + 0.8, z], 'splash', { quiet: true });
  g.events.emit('player:leap', { pos: [x, y, z], form: this.seaForm });
}
// then: physics.move(..., { swim: true }) and the ledge hop (§4.2 :161, :164-167)
```

- **Floating up.** With no Up or Down for 1 s she drifts up at 1 block/s until her chest is out
  (`y + 1.1` no longer liquid), then hovers with her waist in the water. Right after turning in
  (`_idleVT` starts at `BUOY_DELAY`) she floats straight up, so a child who walked in from the
  beach and let go is at the surface, seeing the sky and the dolphins, within about 2 s. Holding
  Down keeps her down; letting go floats her up again a second later.
- **Shallow water** (not `deep`, gate still on): with no input she settles onto the bottom at
  1.5 blocks/s, so the walk-out at a beach works like today.
- **Getting out.** `physics.move` gets `swim: true`, so step-up and `res.ledge` treat her as
  grounded (§4.2 `physics.js`). Holding only forward toward a bank whose top is up to 1.05 above
  her feet gives a ledge hop (the existing `JUMP_V * 0.92` rule), a small splash, and 0.35 s of
  plain gravity so the easing does not eat the hop: she flops up onto the sand. Underwater steps
  up to 0.55 are simply stepped up; 1-block steps are hopped. Holding Down does not block the
  hop (the hop skips the easing). A wall taller than 1.05 is a wall, as on land.
- **Surface.** At the surface she stays without bobbing out (the waist probe stays in the
  water), so `swimming` no longer flickers there.
- In the air during a leap (not swimming) the normal gravity branch runs (`:152-158`); the
  tail stays on (the gate's air time is 1.4 s). The leap rises about 1.76 blocks.
- Horizontal acceleration stays 14 (`:139`).
- Every value is clamped: `velocity.y` in [-SEA_VY, LEAP_V] outside a hop; `dt` is already
  clamped by the loop. No new allocation per frame.

### 6.3 The avatar: weight, visibility, poses

New state inside `createAvatar`: `seaW` (0..1), `seaTarget`, `seaPhase`, `seaFlash`, `leapSpin`,
`sea` (the built parts or null), `seaAutoFn`, `autoForm` (the cached resolved `'auto'` form,
null until needed).

Each `update(dt, s)`:

```js
// The form is resolved only when it can matter, and 'auto' is cached (cleared by setLook / setSeaAuto):
const form = s.sea || seaW > 0 ? seaFormNow() : null;   // seaFormNow: look.sea.form, or autoForm ??= seaAutoFn(look)
const ridingOk = !s.riding || s.seaRide;                 // a dolphin ride keeps the tail
seaTarget = s.sea && form !== 'me' && !s.sitting && !s.sleeping && ridingOk ? 1 : 0;
if (seaTarget > 0) ensureSea(form, seaColorOf(look, form));   // lazy, once per (look, form)
const rate = s.seaCut || s.sitting || (s.riding && !s.seaRide) || s.sleeping || s.flying ? 1 / SEA_CUT : 1 / SEA_GROW;
seaW = snapSecondary ? seaTarget : clamp(seaW + Math.sign(seaTarget - seaW) * rate * dt, 0, 1);
// crossing 0.5 up: fx sparkle + bubble burst, seaFlash = 1; crossing down: small sparkle
const tail = seaW > 0.5;
bones.legL.visible = bones.legR.visible = !tail;
for (const m of parts.flareMeshes) m.visible = !tail;
if (sea) sea.root.visible = seaW > 0.01;
```

- On land, with `s.sea` false and `seaW` 0, nothing is resolved: no `deviceGet`, no
  `lookFits`, no string work. The player's own gate reads `avatar.seaForm`, which is the cached
  value (computed once per look or style change).
- `sea.root.scale.set(0.6 + 0.4 * seaW, seaW, 0.6 + 0.4 * seaW)` (the tail grows down from the
  waist); the horn nubs scale with `seaW` too (their own bone).
- Pose choice (`:898-912`): `s.riding && s.seaRide && tail` → `poseSaddleSea(dt, s)` (before the
  riding branch); `s.swimming` → `tail ? poseSea(speed, dt, s) : poseSwim(speed)`; new:
  `else if (tail && !s.flying) poseLeap(dt, s)` before the flying branch.
- `if (!s.sitting && !s.sleeping && !s.riding && !tail) tgt[RPY] += parts.lift;` (roller
  skates do not lift a tail).
- `heldBone.visible = !s.sleeping && !s.swimming && !tail;`
- Emotes: while `tail`, only the arm-only emotes **wave** and **heart** play (they move the
  arms over the sea pose); any other emote ends (`:900` gains `|| (tail && !ARM_ONLY.has(emote))`).
- Hidden flares are not deformed while `seaW > 0.5` (`:948-956` skips).

### 6.4 Pose recipes (all angles in radians; channels as in `avatar.js:28-37`)

**`poseSea(speed, dt, s)`** (swimming with a tail):

```js
const sp = Math.min(1, speed / SEA_SWIM);
seaPhase += dt * (2.2 + 6.5 * sp);
const dive = Math.max(-0.55, Math.min(0.55, -vy * 0.16));      // vy: the avatar's own estimate
tgt[RRX] = 0.3 + 1.1 * sp + dive * (0.4 + 0.6 * sp);           // flat and streamlined when fast; nose down diving
tgt[HX] = -0.8 * Math.max(0, tgt[RRX] - 0.2);                   // eyes forward
tgt[RPY] = Math.sin(seaPhase) * 0.035 * (0.3 + sp);
tgt[TX] = Math.sin(seaPhase + Math.PI) * 0.05 * sp;            // the chest counters the kick
tgt[ALX] = mix(-0.25 + Math.sin(t * 2.6) * 0.3, 0.25, sp);     // sculling -> arms back along the sides
tgt[ARX] = mix(-0.25 - Math.sin(t * 2.6) * 0.3, 0.25, sp);
tgt[ALZ] = mix(0.75 + Math.sin(t * 2.6) * 0.25, 0.18, sp);
tgt[ARZ] = -mix(0.75 + Math.sin(t * 2.6 + Math.PI) * 0.25, 0.18, sp);
tgt[ELX] = tgt[ERX] = mix(-0.5, -0.1, sp);
seaKick = { amp: 0.16 + 0.3 * sp, turn: Math.max(-0.5, Math.min(0.5, -yawRate * 0.12)), curl };
// as built: curl eases (6/s) toward 0.24 when she rests on the floor (s.onGround, sp < 0.35:
// the tail curls back along the sand instead of sinking into it; checked in 2-deep water, the
// lowest point stays above the floor), -0.05 when floating still, else 0
```

**`poseLeap(dt, s)`** (tail out of the water: a leap, or flopping on the sand for up to 0.35 s):

```js
tgt[RRX] = Math.max(0.2, Math.min(2.0, 1.0 - vy * 0.2));   // rising: head up; falling: head first
tgt[ALX] = tgt[ARX] = vy < 0 ? -2.8 : -0.6;                 // arms over the head as she dives back in
tgt[ALZ] = 0.2; tgt[ARZ] = -0.2; tgt[HX] = -0.3;
seaKick = { amp: 0.06, turn: 0, curl: 0.18 };               // an arched tail
// the twirl: while rising after a leap, leapSpin goes 0 -> 2π (one turn about the body's long
// axis), added to the root yaw AFTER the channel smoothing (not as a target), then reset to 0.
```

The re-entry splash (the existing `'player:swim'` celebrate on entry) is joined, after a leap,
by a bigger sparkle ring (`fx('sparkle', { count: 18, spread: 0.9 })`).

**`poseSaddleSea(dt, s)`** (riding a dolphin with a tail): the riding pose's upper body and
arms (holding on), the hips turned 0.5 rad to the side; the tail drapes down along the
dolphin's side (`seaKick = { amp: 0.08, turn: 0.35, curl: 0.25 }`, a slow kick at 1.2 rad/s).

**The tail wave** (`seaTick`): for joint `i` of `N - 1 = 7`:
`a_i = amp * sin(seaPhase - 0.8 i) * (0.3 + 0.7 i / 6) + curl` (bend toward her back, about
the hips' X axis) and `side_i = turn * i / 6` (about the Z axis). Up-and-down like a dolphin
kick, never side to side. A frill flutter (mermaid waist frill and dragon fronds):
`scale.x = 1 + 0.06 * sin(t * 5)`. The shimmer: every `seaMats` entry's
`emissiveIntensity = base + 0.06 * sin(t * 2.4 + i) + 0.5 * seaFlash` (`seaFlash` decays at 2/s).

**Hair** floats (§4.2 `springs`). **Face**: `mouth = 'open'` for the first 0.6 s after turning
(a happy gasp), else her own smile.

### 6.5 Vehicles, animals, zip lines and other states

| She is ... | Sea form |
|---|---|
| riding a dolphin (ocean, `mount` kind `'dolphin'`) | **kept**: side-saddle, tail draped along the dolphin's side, kicking slowly (`seaRide`). No `'player:seaform'` events during the ride; presence stays `h`. If the gate was not on yet (tapped within the first 0.25 s), `mount` turns it on at once. Just Me riders show legs. |
| hopping off a dolphin into deep water | the tail simply stays: no regrow, no sound, no sparkle; she swims on |
| a dolphin ride that ends by unload or teleport | cut (no sound) |
| driving a boat / car / van (`state 'ride'`, `mountPet.kind === 'vehicle'`) | never; `mount()` cuts it if she boarded from the water |
| riding a pony, horse, unicorn or swimming turtle | never; `mount()` cuts it |
| on a zip line over water (`hold`) | never; `hold()` cuts it |
| flying over water, or flying up out of it | never; `setFlying(true)` cuts it (only a real change to flying) |
| sitting, sleeping (cannot happen in water today) | cut by `sitOn` / `sleepIn` |
| getting out of a boat on open water (second tap, `vehicles/index.js:464-475`) | turns 0.25 s after she lands in the water |
| sliding down a big slide into a pool (`probe-builds` camper) | turns if the pool is 2 deep |
| teleported (Hop to a friend, respawn) | cut (quick shrink, no sound; the sparkles show only if the avatar was visible), then the gate decides again |

### 6.6 Old behavior that stays exactly the same

Every swimmer in water too shallow to turn: today's speed, sinking, Jump-to-rise, pose,
splash, `'player:swim'`, and the "Swim to the shore first!" emote rule. Land: nothing changes
(no sea part is even built until the first turn). NPC friends and pets: `physics.move` without
`swim`, so they move exactly as today.

---

## 7. Geometry recipes (`src/player/merfolk/parts.js`)

All sizes in avatar space (feet at 0, `HIP` 0.64). Colors: `C` = the tail hex,
`L = mixHex(C, '#FFFFFF', 0.45)` (fins), `D = shade(C, -0.25)` (edges),
dragon accent `A` = gold `#FFC83A`, not mixed with the tail, so a purple or pink tail never
turns it peach (crest tips, horns, fin ribs; Gold and Orange tails get deep teal `#178A86`
instead), belly `B = mixHex(C, '#FFE7A0', 0.6)`, fronds and fan fin `F = shade(C, -0.24)` at the
root to `R = mixHex(shade(C, -0.05), A, 0.4)` at the rim, crest spike roots `K = shade(C, -0.12)`,
glow spots `G` / `H` (core, halo) (`seaPalette`).

### 7.1 TailTube (one mesh, up to three material groups)

- Root ring at y 0.62 (inside the hip block, `outfit.js:263`), 8 rings, 12 sides, superellipse
  exponent 2.6 (soft-boxy, matches the blocky style), **flat shaded** (non-indexed, face
  normals; like `Flare`). Lives under `sea.root` on `hips`.
- Mermaid: length 0.86; half-width `rx` = 0.205, 0.19, 0.17, 0.15, 0.125, 0.10, 0.075, 0.05;
  half-depth `rz` = 0.13, 0.125, 0.12, 0.11, 0.095, 0.08, 0.06, 0.04. One group (scales).
- Sea Dragon (as built after the owner review): length 0.96; `rx` = 0.2, 0.235, 0.23, 0.215,
  0.19, 0.16, 0.125, 0.085; `rz` = 0.125, 0.16, 0.16, 0.15, 0.135, 0.115, 0.09, 0.065; a rest
  `bend` per joint (0, 0.05, 0.09, 0.09, 0.05, −0.03, −0.08 rad) added after the clamp of the
  animated angle (so a joint can reach at most 1.2 + 0.09 rad): a gentle S curve. The two front
  columns (i 5, 6) are the **belly plates** (vertex color `B`, smooth plates in the texture).
  Two groups in the same buffer:
  - group 0, `scale:` (one opaque draw; the extras sample the plain middle of a belly plate,
    `CREST_V`, and take their color per vertex): the tube; a **crest spike** on the back (−Z)
    at every ring 0..7 (`crestPlate`, outline `sin^1.5`: a tall spike with a soft round tip
    leaning toward the fin from the side, a lens from behind; base 0.17 → 0.10, height
    0.27 → 0.13, thickness 0.12 → 0.07), growing from `K` at its root into an `A` tip
    (`crestColor`); and **leafy fronds**, a big three-lobed leaf on each side at rings 2, 4 and
    6 (0.30 → 0.17 long), swept down toward the fin and a little back, solid with both faces,
    `F` at the root to `R` at the rim;
  - group 1, `seaglow:<hex>`: **glow spots**, a round spot with a soft halo on each side of the
    crest at rings 1..6 (radius 0.034 → 0.022), unlit and gently pulsing (`seaTick`), so they
    shine at night and in deep water.
- The tube's rest layout is built once per form and color (`tubeTemplate`) and shared.
- Every extra vertex (domes, fronds, spots) is stored as (joint index, offset in that joint's
  frame), so `deform` moves it with the spine.
- UVs: u around the ring (0..1), v along the tail (×3 repeats); the scales texture repeats.
- `deform(angles, sides)`: walks the spine from the root (rest direction −Y), rotating by
  `a_i` about X and `side_i` about Z per joint, writes positions and face normals **in place**
  (`Float32Array`s made once; `attributes.position.needsUpdate = true`), and returns the tip
  position and direction in two preallocated vectors. Inputs are clamped to ±1.2 rad; a
  non-finite input resets that joint to 0.
- `deform` also places `sea.tip` (an `Object3D`: position = tip, quaternion from −Y to the tip
  direction).
- **Culling**: the tube and the fluke have `frustumCulled = false` (each is one small mesh), so
  a bent tail never vanishes at screen edges, in first-person mirrors or in selfies.

### 7.2 Fluke (one mesh on `sea.tip`, `renderOrder` 3, `frustumCulled = false`)

- Plane in the tip's X–Y plane (flat faces toward ±Z, so it is horizontal when she swims
  flat, like a dolphin's).
- Mermaid: two rounded lobes, total width 0.52, length 0.26, a scalloped trailing edge
  (5 scallops per lobe), a small notch in the middle.
- Mermaid: the fin material. Sea Dragon: the scales material (solid, both faces, plain
  `CREST_V` uv): a big **fan** (width 0.8, length 0.44) of five round lobes whose outer lobes
  reach furthest (a tail fin, not a round shell), each held by an `A` rib (thin strips on both
  faces); `F` at the root to `R` at the rim; no pointed tips.

### 7.3 Extras (through `P.B(...)`, merged per bone and material like every other part)

- **Mermaid waist frill** (`P.B('hips', fin)`): 10 petal quads around y 0.56–0.64, tilted out
  0.35 rad, covering the join of hip block and tail.
- **Sea Dragon horn nubs** (`P.B(seaHorns, 'plain')`): two curved horns (`horn()`: a tapered
  tube of four segments bending back, radius 0.078 → 0.016, a lighter rounded tip, about 0.36
  long) rooted in the hair at x ±0.14, y 1.66, z −0.04, splayed out a little, clearly above
  short hair (`hornSpot(look)`). **Only with no head accessory or a bow**: every other head
  accessory sits on top of the head (hats, crown, tiara, flower crown, headband, cat and bunny
  ears, unicorn horn, halo, headphones) and horns there grew out of it, so they are left out.
  Behind and above a bow (z −0.22, splayed out); out beside a top bun (±0.24) or a fauxhawk's
  ridge (±0.21); back behind space buns (z −0.2); up out of an afro (y 1.97), curly hair (1.78),
  spikes (1.76) or short curls (1.7), so they never end inside the hair.
- **No crest on the torso**: the crest starts at the waist. Carried up the back it sat on the
  child's own shirt (over a shirt number), poked through long hair from the side and had to be
  left out under backpacks and wings.
- **Sea Dragon forearm fins** (`P.B('elbowL' / 'elbowR', scale)`): a small solid leafy fin
  (0.13 long) on the outside of each forearm, lying back along the arm toward the elbow.
- Nothing on the face, ears or cheeks, no scales on the face, body or arms: the face is 100 %
  the child's.

### 7.4 Textures (128×128, through the shared cache)

- `paintScales(g, w, h, hex, form)`: rows of overlapping half-round scales (mermaid: 8 per
  row, 8 rows, offset each row; dragon: diamond scales with darker `D` edges and a lighter
  belly band at u 0.4–0.6), each scale a gradient from `C` to `L` with a white highlight dot.
  Cache key `sea|scale|<hex>|<form>`, repeat wrapping.
- `paintFin(g, w, h)`: translucent `L` with alpha 0.85 at the base → 0.55 at the edge, 7 ribs
  from the base corner, a white rim (the mermaid's fin and frill; the sea dragon has no
  see-through parts). Key `sea|fin|<form>`.
- **Ownership** (§4.2 `disposeSea`): each avatar acquires each key once when it creates the
  material and releases it exactly once in `disposeSea`. Two avatars with the same key (the
  player and Aria both on `sea|scale|#3FD8B0|mermaid`) each hold one reference, so the cache
  never evicts a texture that is still in use, and nothing leaks.

### 7.5 Draw calls per avatar in sea form

| form | added (shown) | hidden | net |
|---|---|---|---|
| Mermaid | tube 1, fluke 1, waist frill 1 = **3** | legs: 4 meshes (bare) or up to 8 (pants: cloth + plain on 4 bones), skirt/dress flares 1-2 | about −1 to −7 |
| Sea Dragon | tube 2 groups (scales + crest + fronds, glow spots), fluke 1, horn nubs 1 (0 under a hat), forearm fins 2 = **6** | same | about −6 to +2 (B13a checks a boy starter: ≤ +6) |

On land: 0 (nothing built, or built and `visible = false`).

---

## 8. NPC friends

- `new Friend` (`friend.js:34`): `g.createAvatar(this.look, { seaAuto: this.def.kind === 'boy' ? 'sea_dragon' : 'mermaid' })`.
  Their looks keep `sea: 'auto'`, so a friend saved in an old world is the same; **Aria**
  (`looks.js:119-128`) becomes a mermaid with a teal tail (Match → her Mermaid Dress color).
- Host (`_move` `:686`): after `this.swimming` is set, `this.seaGate.step(dt, { deep:
  seaDeep(...), swimming: this.swimming, onGround: this.onGround, blocked: this.act === 'sit'
  || this.act === 'sleep' })`; `this.seaOn = this.seaGate.on && this.avatar.seaForm !== 'me'`.
  Water speed `speed *= this.seaOn ? 1.05 : 0.65` (`:688`), so a following friend keeps up with
  a fast mermaid. They keep floating at the surface (`:693-701`); they do not dive. Their own
  water hop (`:707`) still gets them out.
- `update` (`:402-410`) and `puppet` (`:280-288`) pass `sea: this.seaOn`.
- `netSample` (`:206-210`): `st = ... : this.seaOn ? 'm' : this.swimming ? 'i' : 'w'`.
- `puppet` (`:256`): `this.swimming = t.st === 'i' || t.st === 'm'; this.seaOn = t.st === 'm';`
  (set directly; guests run no gate).
- Chat: `game.events.on('player:seaform', ({ form }) => { if (form && !reacted) { reacted = true; sys.react('player:seaform'); } })`,
  with `reacted` reset on `world:load`: friends say one line the first time she turns in each
  world visit, never on turning back, never again at every shore hop. Lines in §10.
- Friends' sparkles come from their avatar `fx` (world particles). No sound for them.

---

## 9. Multiplayer

### 9.1 What travels

| What | How | Size |
|---|---|---|
| Her form and tail color | `lk` (two appended tokens, resolved) | +4 characters (≤ 156) |
| "In sea form now" | `st: 'm'` | 1 character (same field) |
| Riding a dolphin with a tail | ocean's `st: 'h'` + `sr`; the tail comes from her `lk` form | 0 extra |
| NPC friend in sea form | `nx` sample `st: 'm'` | same field |
| Leaps, sparkles, sounds | not sent; each page draws its own from `st` changes | 0 |

Nothing enters the host world. No host validation change (`st` is already cut to one
character, `host.js:1404`). No server change.

### 9.2 `remote-players.js`

- `_frame` (`:462-470`): the merged literal in §4.4. For `st 'm'`, `swimming` comes from the
  receiving page's own blocks (`liquidAt` at the friend's waist), so a leaping friend shows
  `poseLeap` in the air instead of a flat swim pose. A dolphin rider (`seaRide`) shows her tail
  side-saddle when her `lk` form has one.
- `_ingest` (`:348`): `f.stSeen` (like `emN`): the first presence of a friend, or any presence
  while `f.avatar` is null, only records the letter. Afterwards, when the letter changes to or
  from `'m'` and the friend is within `ANIM_FREEZE`, `g.particles.emit('sparkle', [x, y + 0.6, z], { count: 12 })`
  (remote avatars have no `fx`, `:495`). A late joiner or a friend coming into range never
  sparkles for nothing.
- Name tag (`:478`): `st === 'm' ? 1.7 : ...`. Phrase bubble (`_placeBubble` `:598-599`):
  `st === 'm' ? 2.0 : ...`.
- Beyond 32 blocks a friend's avatar freezes (`:460`): a friend who turns out there keeps the
  last shape until she comes closer. Accepted (same as every other pose).

### 9.3 Why this is privacy-safe

The style (Girl / Boy / Mix) never leaves the device and is never stored in the profile or the
cloud. A friend sees which form she shows, the same way they see her hair or her cap, and every
child can pick either form or none. **Stated plainly:** when the form is `'auto'` and the
device's button is set, the tail form friends see is worked out from that button, so one bit
derived from it reaches the relay and friends, exactly as the clothes the Boy button swaps in
already do. When the button was never tapped, the form comes only from the worn look, which is
already in the profile. The button itself is never sent or stored. B9 checks that presence and
the saved profile never contain the strings `girl`, `boy` or `mix`.

---

## 10. Every player-facing string

### 10.1 Names (our own; checked against the trademark rule: generic words only)

| key | kids read |
|---|---|
| `mermaid` | Mermaid |
| `sea_dragon` | Sea Dragon |
| `me` | Just Me |
| tab | Water |

### 10.2 Strings

| where | text |
|---|---|
| Studio tab label / aria | **Water** / "Water: mermaid, sea dragon or just me" |
| Studio section titles | **I swim as** · **Tail color** |
| Studio Match swatch aria | Match my clothes |
| Studio hint after a tap | "Splash! A mermaid tail!" · "Whoosh! A sea dragon!" · "Swimming as me!" |
| Studio hint on the Mermaid Dress | "Swim in deep water for a real tail!" |
| First-turn bubble buttons | **Mermaid** · **Sea Dragon** · **Just Me** (each with its picture) |
| Toast, first turn in a world visit | **Mermaid magic!** · **Sea Dragon magic!** |
| Dive tip (twice per device, deep spots only) | "Hold Down to dive!" (touch) · "Hold C to dive!" (keyboard) |
| Leap tip (once per device) | "Swim fast + Up = big leap!" · friend line "Swim fast and press Up to leap like a dolphin!" |
| Pool tip (once per device) | "Make it 2 deep for mermaid magic!" · "Make it 2 deep for sea dragon magic!" |
| Joystick label | **Swim** (deep water) |
| Help cards | touch: "In deep water: Up and Down to swim and dive" · keys: "In deep water: Space up, C down, Shift fast" |
| Emote wheel in sea form (existing text, for full-body emotes) | "Swim to the shore first!" |
| Sticker `sea_magic` | **Sea Magic!** · hint "Swim in water 2 blocks deep as a mermaid or sea dragon" |
| Sticker `big_leap` | **Big Leap!** · hint "Swim fast and leap out of the water" |
| NPC friend lines (`LINES.events['player:seaform']`) | "Whoa! Look at your tail!" · "So sparkly! Let's swim!" · "You swim so fast now!" |

No "her" or "she" about real players, no prices, no "buy". Read Aloud reads the toasts as it
reads every toast (`src/ui/settings.js:99-117`).

### 10.3 Stickers (`src/player/merfolk/stickers.js`, registered on `game:ready`)

| id | name | awarded when | art (100×100) |
|---|---|---|---|
| `sea_magic` | Sea Magic! | the first `'player:seaform'` with a form | a teal mermaid fin rising from a wave with three sparkles |
| `big_leap` | Big Leap! | the first `'player:leap'` (any form, Just Me too) | an arc of droplets over a wave with a fin at the top of the arc |

Both listeners start with `if (game.net?.remoteApplying) return;`. +20 coins each through the
normal sticker path. Sticker total grows by 2 (the book handles any count).

---

## 11. Saves and old-save safety

- **Old profiles**: no `sea` → `mergeProfile` fills the default → `normalizeLook` keeps
  `{ form: 'auto', color: null }`. Nothing else in the look changes (A2 checks the whole
  normalized JSON against a golden recorded before the change, minus `sea`). Coins, stickers,
  outfits, basket, worlds: untouched.
- **What an old player sees**: the first time she swims in deep water she turns (the feature),
  and the bubble lets her pick Mermaid, Sea Dragon or Just Me right there.
- **Saved outfit slots** (`profile.outfits`): an old slot has no `sea`. Wearing any slot keeps
  the current `sea` (`_wearSlot`, §4.2), so a child who picked Sea Dragon stays a Sea Dragon
  when she wears Outfit 1. New slots are saved without `sea`. The slot "on" check ignores
  `sea`, so an old slot still shows as worn.
- **NPC friends saved in worlds**: their looks gain the default `sea`; their `def.kind`
  decides the form.
- **Cloud, backups, first sign-in**: the look travels whole (`account/merge.js:40-56`: newer
  `updatedAt` wins for `look`; `BACKUP_PROFILE_KEYS` has `look`, `storage.js:86`). No rule
  changes.
- **Worlds**: no world data changes. The player save stays `{ x, y, z, yaw, flying }`
  (`player.js:414`); sea form is never saved (it is worked out again from the water).
- **Older cached page** (a family with an old tab open) loading a profile written by the new
  build: `normalizeLook` there drops `sea` in memory; if that old tab saves, `sea` is lost
  from the cloud copy and comes back as `'auto'` (only an explicit tap is lost, never a
  thing she owns). Accepted; same as every look key added before.
- **Server**: `stripProfile` passes `look` (`server/saves.mjs:113-123`); about +40 bytes.

---

## 12. Performance, safety, audio

| what | cost |
|---|---|
| Avatar on land | 0 draw calls, 0 per-frame work (the form is not even resolved; one boolean) |
| First turn of an avatar (lazy build) | about 1 ms CPU, once per (look, form) (the player's own parts are built hidden ahead, `prepareSea()`, textures uploaded); the sea material kinds are drawn once by a warm-up when a world loads (fourth round, As built). The turn builds no shader program; its longest frame in 0.5 s stays within 33 ms of the shore's (B13c) |
| Avatar in sea form | Mermaid +3 / Sea Dragon +8 draw calls, minus 5-10 hidden leg and skirt meshes; tube deform about 0.02 ms (8×12 quads + extras, in place); hidden flares not deformed |
| Textures | 2 per (color, form) at 128×128 through the shared cache, refcounted once per avatar (§7.4) |
| Player physics | 3 to 4 extra `liquidAt` calls per frame while sea swimming (depth, float-up, the leap head check only when Up is held); 0 on land |
| Camera underwater check | 2 `liquidAt` calls per frame; DOM class toggled only on change |
| Underwater tint | one extra full-screen composited layer while the camera is underwater (static gradient + transform-only rays, no repaint); 0 above water. B13f: ≤ +1 ms average frame on the iPad viewport |
| NPC friends | one `SeaGate` step each in `_move` (host) |
| Remote players | one letter compare; one `liquidAt` per `'m'` friend; deform only within 32 blocks |
| Bundle | about 16 KB minified (parts + rules + index + stickers + Studio tab + bubble) |
| Allocations per frame | none (scratch vectors and typed arrays made once) |

Picture quality: nothing is lowered; no setting, pixel ratio, shadow or texture size changes.
Every loop is bounded (rings, joints, petals, domes). Every number from input or presence is
clamped; a non-finite tail angle resets to 0.

Audio: `magic` (in 1.25 / out 0.9), `splash` (leap, pitch 1.2; shore hop, quiet): existing
synthesized sounds (`src/core/audio.js:225`, `:255`). Bubble trail: while she is sea swimming,
under the surface (head cell liquid) and moving faster than 1 block/s,
`particles.emit('bubble', head, { count: 1 })` every 0.3 s (local player only).

---

## 13. Coordination with the other teams

**Ocean (dolphins and sea animals).**

- **Names**: ocean owns `sea` (`src/life/sea/`, system `sea`, `game.sea`, `game.debug.sea`);
  merfolk is `merfolk` everywhere (header of this doc).
- **Dolphin ride**: ocean's mount kind `'dolphin'` keeps the tail (side-saddle, §6.4-6.5);
  merfolk reads ocean's `seaRide` flag in the avatar and on friends' pages; no new field. Ocean
  needs no change beyond the merged literals in §4.4 (which both docs carry).
- **Deep spots**: merfolk's probe uses `game.debug.sea.deepSpot()` when ocean is installed and
  keeps a small fallback (`game.debug.merfolk.deepSpot(maxR)`) only for builds without ocean.
- **What ocean reads**: `player.swimming` and `player.state` (ocean.md §15). Merfolk's
  hysteresis keeps `swimming` steady at the surface, so pods arrive by the same rule. Divers
  reach the animals 0.6 to 2 blocks down; Just Me can dive too.
- **Events** `'player:seaform'` and `'player:leap'` exist if ocean wants a pod to leap with her
  (optional; nothing in ocean depends on them).
- **Underwater picture**: `game.underwater` (the liquid key or null). Merfolk owns the tint
  (§5.6); ocean adds no second one. Animals are under the overlay like everything else.
- No `game.seaSwimmers()` in v1 (no team consumes it); if ocean later wants escorts for
  friends in sea form, they read `net.remote.list()` (`st 'm'`) and say so in their doc.
- Creatures never collide with avatars; the tail never collides with anything.

**Squishies.** A held toy already hides while swimming (`avatar.js:915`); in sea form it also
hides while leaping (§6.3). Shared lines in `adapter.js`, `remote-players.js`, `hud.js` and
`main.js` are listed in §4.4. The trademark scanner is shared (§14.1 A13).

**Avatar owners.** `build()` is untouched except for keeping the flare mesh list and skipping
sea keys in its sweep; all sea work sits beside it, and `disposeSea()` owns its resources.

---

## 14. Tests

### 14.1 `tools/test-merfolk.mjs` (Node, seconds; imports `src/player/merfolk/rules.js`, `src/player/wardrobe-data.js`, `src/net/codec.js`, `src/world/physics.js`, `src/player/merfolk/parts.js` for `TailTube` only)

Goldens recorded from `669b6fa` **before** any change and pasted into the file:
`OLD_KEYS_669` (every option list's keys today), `OLD_DEFAULT_TOKEN_669` (the 126-character
default), `OLD_STARTERS_669` (`packLook(applyOutfit(DEFAULT_LOOK, o))` for all 12 starters),
`OLD_RANDOM_669` (20 seeds × girl / boy / mix, `packLook(randomLook(mulberry32(s), 'Zoe', null, style))`),
`OLD_NORMAL_669` (`JSON.stringify(normalizeLook(fixture.profile.look))` of the new fixture).

| id | check |
|---|---|
| A1 | every existing list still starts with `OLD_KEYS_669`; `SEA_FORMS` keys are exactly `auto, mermaid, sea_dragon, me`; `SEA_COLORS` equals the 12 hexes; every list < 36 entries |
| A2 | `DEFAULT_LOOK.sea` is `{ form: 'auto', color: null }`; `normalizeLook(old fixture look)` minus `sea` equals `OLD_NORMAL_669`; `freshLook({ look: DEFAULT_LOOK })` is still true |
| A3 | `packLook(DEFAULT_LOOK) === OLD_DEFAULT_TOKEN_669`; every `OLD_STARTERS_669` and `OLD_RANDOM_669` string is reproduced exactly |
| A4 | round trip of every form × (every color and null): `unpackLook(packLook(l))` equals `l`; length ≤ 160; worst case (A4b: every optional color, a dress, number 99, `sea_dragon`, color 11) is 156 |
| A5 | today's 36-token default string and a 34-token string both unpack to `sea: { form: 'auto', color: null }`; a string with sea placeholders `.0.-` unpacks to auto / Match; a broken color token (`zz`) gives `null`; an index 99 form gives `'auto'` |
| A6 | `resolveSeaForm`: auto + girl / mix → mermaid, auto + boy → sea_dragon, auto + null → mermaid for every girl starter and the default, sea_dragon for every boy-only starter (`lookFits` b and not g); every explicit form wins under every style; `withResolvedSea` never returns `'auto'` |
| A6b | `withResolvedSea(l, s)` leaves `l` deep-equal to a copy taken before the call, for every style |
| A6c | Match: for `DEFAULT_LOOK` and all 12 starters × both forms, `seaColorOf` is one of `SEA_COLORS`; no boy starter gives white, gray, brown or black; exact palette colors stay themselves |
| A7 | `randomLook(rand, 'Zoe', base)` keeps `base.sea` for all three styles; without `base` it is the default; the number of `rand()` calls per style is unchanged (a counting `rand`) |
| A8 | `lookFits` gives the same answer with `sea` set to each form (sea is ignored) |
| A9 | `normalizeLook` rejects a non-palette color (`'#123456'` → null), a string form (`'shark'` → `'auto'`), `sea: 5`, `sea: null` |
| A10 | `SeaGate` tables: a one-block puddle never turns (`deep` false, 10 s); 0.24 s deep does not turn, 0.26 s does; 50 surface bobs (`swimming` false for 0.2 s each) give exactly one `'in'` and no `'out'`; a 1.2 s leap keeps it on; 0.35 s on the ground turns back; `blocked` gives `'cut'` at once; `force()` turns on; `dt` NaN / Infinity / negative never throws or turns |
| A11 | `seaDeep` on a fake `liquidAt` grid: 1 deep standing → false; 2 deep standing → true; floating with the cell under the feet liquid → true; `depthBelow` counts and caps |
| A12 | `TailTube.deform` with 10,000 random angle sets (including NaN and ±1e9): every position finite, vertex count constant, the position array is the same object (no reallocation), tip inside 1.0 of the root; `frustumCulled === false` on the tube and fluke |
| A13 | trademark scan through the shared `tools/lib/name-scan.mjs` (owned by squishies or the integrator; the list is stored encoded, e.g. reversed or base64, so the names never appear literally in the repo). Merfolk adds its own encoded words (the movie's title, place and character names) and runs it over `src/**`, `site/**` and `dist/sparkle-world.html`, comments included. `docs/**` is outside the scan (`docs/DESIGN.md:5` is known and left for the integrator). |
| A14 | **shore exit (the real `Physics.move`)**: a fake world (the minimal `world` shape Physics needs: `sx`, `sz`, a block getter, `props.shape`) with a 3-deep sea, a seabed rising in 1-block steps, and land level with the water top. A small stepper that runs the §6.2 sea rules with `swim: true` and the ledge hop, holding **only forward**, at 60 and 30 fps, from the surface, mid-water and the floor: on land (feet ≥ land top, not in liquid) within **2 s** in every case. Also: an underwater 1-block step (crossed within 1 s), a pond rim 1 block above the water top (out within 2 s), holding Down + forward (still out within 2.5 s), and a 3-block cliff (never climbed, never stuck oscillating: y stays finite and below the cliff top). |
| A15 | texture refcounts: a fake `acquire` / `release` pair counting per key; build the sea for two avatars with the same key, dispose one, then `clearParts` + rebuild the other 20 times with color changes: every key's count returns to 0 at the end and never goes below 0 |
| A16 | `input.downKey`: with Shift only it is false; with C or the virtual Down it is true (a tiny fake key set over the `Input` update) |

### 14.2 `tools/test-net.mjs` additions

- In the existing codec test (`:128-180`): `'sea.form': wardrobe.SEA_FORMS` in `lists`; a loop
  over `[null, ...SEA_COLORS]` with `sea_dragon`; the existing `eq(oldToks.length, 36)` keeps
  passing (default sea leaves the tokens out).
- `merfolkTests()` appended after `vehicleTests` (`:1789`): `avatarFields` passes `st: 'm'`
  unchanged; a host presence with `lk` at 156 characters (plus ocean's `sr` and squishies'
  `hi`) stays under `STATE_BYTES` (`protocol.js:26`); the fake adapter sends `st: 'm'` when a
  test sets `fake.st = 'm'` (no fake-adapter edit).

### 14.3 `tools/probe-merfolk.mjs` (browser; copies `tools/probe-vehicles.mjs` structure)

Imports `launch, openGame, waitForPlay, waitIdle, shot, settle, finish, parseArgs, screenPoint`
from `smoke.mjs`; its own `check()`; `PREFIX = 'merfolk'`; `--only=unit,water,studio,touch,friends,costs,save`.
Probe-only page tweaks as usual (`tutorialDone`, `quality: 'low'`, `seaAsked = 2` except in
B17); they never change what players get.

New debug API `game.debug.merfolk` (from `src/player/merfolk/index.js`):
`state()` → `{ seaSwim, seaForm, gateOn, inT, outT, swimming, deep, underwater, vy, hs, hopT }`;
`parts()` → `{ built, form, color, shown, meshes, legsVisible, flaresVisible }` for the local
avatar; `deepSpot(maxR)` → `game.debug.sea.deepSpot()` when ocean is installed, else its own
bounded search (the nearest column with water ≥ 4 deep at sea level, 9,000 columns max);
`shore()` → a deep spot and the nearest sand cell one block above the water top (ocean's
`shoreSpot()` when present).

**Pass `water` (desktop 1280×800, beach biome Cozy, style never picked):**

| id | check |
|---|---|
| B1 | teleport onto the lagoon shore, walk (key W) into a deep spot: within 1.2 s `seaForm === 'mermaid'`, `parts().legsVisible === false`, one `'player:seaform'`, sticker `sea_magic`; shot `mermaid-in`. A second turn in a new world visit shows the toast "Mermaid magic!" |
| B1b | for 5 seeds: walking from spawn into the Beach lagoon's center turns her **if** the lagoon there is 2 deep; the probe logs the seeds where it is not (ocean.md §2.1 allows up to 2), as information, not a failure |
| B2 | flat world, a 1-deep 4×4 water patch placed with `debug.place`: walking in gives `swimming` true and `seaForm` null for 3 s; the pool tip toast "Make it 2 deep for mermaid magic!" shows once, and not on a second visit |
| B3 | walk in from the beach and let go: within 2.5 s her chest is above the surface (`y + 1.1` not liquid); then idle 5 s: still exactly one `'player:seaform'`, `swimming` true on 95 % of sampled frames, `\|vy\| < 0.4` |
| B4 | hold W for 2 s: horizontal speed ≥ 4.2 (Just Me control in B8: 3.6 to 4.2) |
| B4b | hold **Shift+W** for 2 s in deep water: `\|Δy\| < 0.3` and horizontal speed ≥ 5.5 (Shift is fast, never down) |
| B5 | hold C 1.5 s: y drops ≥ 2 (deep spot); hold Space 1.5 s: y rises ≥ 2; underwater overlay class on while the camera is under, off above (`game.underwater` matches); after `exitToTitle` the overlay is hidden and `game.underwater` is null |
| B6 | leap: Shift+W toward the surface with Space held: `'player:leap'` seen, peak y ≥ water top + 1.4, `seaForm` stays set through the leap, sticker `big_leap`; shot `leap` |
| B6b | double-tap Space (two presses 150 ms apart) in deep water: `flying` stays false and `seaForm` stays set |
| B7 | **shore exit**: start at `shore()`'s deep spot, hold **only W** toward the 1-block sand bank: on land with `seaForm` null within 3 s, legs visible, `'player:seaform' { form: null }`. Same from the floor (after holding C) and from the surface |
| B7b | a pond rim (a 3×3 pond dug 3 deep in grass with `debug.place`): hold only W from the middle: out within 3 s |
| B8 | Just Me (`profile.look.sea.form = 'me'` + `avatar:changed`): deep water gives no tail and no `'player:seaform'`; `seaSwim` true; speed 3.6 to 4.2; hold C dives; letting go floats up; leap works and gives `big_leap` on a fresh profile; shallow (1-deep) water: today's speed ≤ 3.0 and sinking with no input |
| B9 | `deviceSet('surpriseStyle', 'boy')`: auto gives `sea_dragon`; an explicit `mermaid` stays a mermaid under Boy; `lk` sent by the adapter contains the resolved form index, never 0; the presence JSON and the saved profile JSON never contain `girl`, `boy` or `mix` as values |
| B10 | riding and friends of riding: drive a Swan Boat across the lagoon (`debug.vehicles`): `seaForm` null all the way; second Get out on open water: sea form 0.25-1.0 s later; Hand-tap the boat from the water: cut at once (no grow, no sound). Fly (the F key) from deep water: cut at once. A zip line over water (`outdoor` prefab): none. A redundant `setFlying(false)` while in sea form: no cut |
| B10b | **dolphin ride** (when ocean is installed: `debug.sea.ride()` next to a dolphin in sea form): `parts().legsVisible === false` and `parts().shown` for the whole ride; no `'player:seaform'` events from mount to hop off; presence `st` is `h`; hop off in deep water: tail still shown, no event, no `magic` sound. Skipped with a note when ocean is not in the build |
| B11 | cameras: third person `headY` while in sea form (rig target y − player y ≈ 1.05 ± 0.05); first person hides the avatar; looking down 0.6 rad and pressing W dives (y falls ≥ 1 in 1.5 s) |
| B12 | selfie photo in sea form: a photo is taken, no console errors, the camera looks at y + 1.0; a photo taken underwater has a tinted bottom row (mean blue > red on the saved image) |
| B13 | (see `costs`) |
| B14 | old save: write `tools/fixtures/merfolk-old-profile.json` into the store as `probe-boys.mjs:603-629` does, reload: the look is the old look plus `sea` default, outfits intact, coins and stickers equal, title shows no Dress Up nudge (`freshLook` false as before) |
| B15 | 30 s of scripted random swimming (W/A/D/C/Space/Shift every 0.4 s, seeded): every position finite, no stall frame > 1 s inside the window, never flying |
| B16 | candy biome: the strawberry-milk sea turns her too, overlay pink |
| B17 | first-turn bubble (`seaAsked` 0, form auto): the bubble shows after the turn with three buttons; the joystick still moves her while it shows; tapping Sea Dragon gives `profile.look.sea.form === 'sea_dragon'`, a tail of that form within 0.5 s and `seaAsked === 2`; with a fresh device, ignoring it: it fades within 9 s, the form stays `'auto'`, `seaAsked === 1` |
| B18 | tips: in a deep spot (≥ 3 below) the dive toast shows and the Down button has `sw-pulse`; in the 2-deep lagoon (or a placed 2-deep pool) the dive toast does not show; on the first-ever turn the dive toast never overlaps the sticker pop or the bubble (their DOM nodes are never visible on the same frame) |

**Pass `studio` (desktop, then iPad 1024×768 touch):**

| id | check |
|---|---|
| C1 | the **Water** tab shows right after Shoes, with its picture and the "new" dot (gone after opening); three tiles with labels Mermaid, Sea Dragon, Just Me; the on tile is Mermaid (auto, never picked, default look) |
| C2 | tap Sea Dragon (real tap): `profile.look.sea.form === 'sea_dragon'` after close; the preview shows a tail (snapshot pixel test: opaque pixels below y 0.4 of the frame are tail-colored); the preview plays no wave emote; the preview sparkles (particle count rises) |
| C3 | Tail color row hidden for Just Me; Match on by default; tap Pink → `#FF8CC6`; Undo returns to Match |
| C4 | auto + tap Boy → the on tile moves to Sea Dragon, `look.sea.form` stays `'auto'`; explicit Mermaid + tap Boy → still Mermaid |
| C5 | render grid shots: both forms × 12 colors + Match × (dress, jeans, skirt, shorts) and every head accessory once with the Sea Dragon, via `game.debug.avatar.renderGrid`; no magenta material (`material()` fallback). These shots are also the input for the grown-up look check (§16 Q2) |
| C6 | phone 390×844: the Water tab is reachable; tiles and swatches fit with no horizontal page scroll |
| C7 | set Sea Dragon, wear an old fixture outfit slot: the form stays `sea_dragon`, and that slot shows as worn |
| C8 | in the Water tab, with the preview in sea form, tap all 12 colors and Match: no magenta material, mesh count under the preview avatar stable, `debug.avatar.textures()` `refs` equal before and after closing the Studio |
| C9 | open Dress Up while the player is in sea form: the Water tab is the open tab |

**Pass `touch` (iPad 1024×768, `hasTouch`):**

| id | check |
|---|---|
| T1 | on land: Jump shows, Up/Down hidden, joystick label "Walk"; in deep water: Up and Down show, Jump hidden, label "Swim"; back on land: Jump again, "Walk" |
| T2 | holding the Down button 1.5 s dives (y falls ≥ 2); the dive tip toast "Hold Down to dive!" shows once per device |
| T3 | the joystick pushed to its edge swims ≥ 5.5 blocks/s |
| T4 | **shore exit with the joystick only**: from a deep spot, push the joystick toward the real Beach shore: on land within 3 s; the same at a real pond rim |
| T5 | the help panel (touch) shows the "In deep water: Up and Down to swim and dive" card |

**Pass `friends`:**

| id | check |
|---|---|
| D1 | invite Aria and Leo (`debug.friends`), follow mode, swim to a deep spot: Aria shows a mermaid tail, Leo a sea dragon (`friend.avatar.seaShown`); a line from `LINES.events['player:seaform']` is said when the player turns; turning back and in again 3 times in the same visit: no second line |
| D2 | following in sea form, the friends stay within 6 blocks **horizontal** distance over 10 s of swimming at 4.6 near the surface |

**Pass `costs` (fixed camera, median of 5 frames, as `probe-vehicles.mjs:245-278`):**

| id | check |
|---|---|
| B13a | draw calls with her in sea form vs standing on the shore at the same camera: ≤ +6 |
| B13b | meshes under `av.group`: sea form ≤ land + 6 (Sea Dragon) |
| B13c | the longest frame in the 0.5 s after the first turn of a fresh page ≤ 33 ms; `ensureSea` CPU ≤ 2 ms; `setLook` time over 20 looks unchanged (≤ 1.3× the land baseline + 0.5 ms) because the sea parts are not built in `build()` |
| B13d | 60 sea toggles (teleports in and out of water) plus 20 look changes made while the tail is shown: unique geometries under `av.group` unchanged at the end (count under the avatar, see the B8 flake note in `boys.md`), and `debug.avatar.textures()` `refs` and `textures` equal before and after |
| B13e | systems stage average over 120 frames with the player + 3 NPC friends in sea form ≤ idle + 1.0 ms |
| B13f | average frame time with the camera underwater vs just above, same spot, iPad viewport (1024×768, DPR 2): ≤ +1 ms |

**Pass `save`:** B14 above, plus a world saved while she is in sea form reloads with her in the
water and sea form back within 1 s.

### 14.4 `tools/probe-multiplayer.mjs`: test `SEA` (after `LOOKS`, `:528`)

Host and guest in a beach world. The host swims into deep water: the guest's view of the host
has `st === 'm'`, `seaShown` true, form `mermaid`, a sparkle burst seen (particle count rises).
The host leaps: on the guest's page the host's avatar is not in the swim pose while in the air.
The guest picks Sea Dragon + Gold in the Studio and swims: the host sees a sea dragon with a gold
tail. **While the guest is swimming, the guest changes the tail color to Pink: the host's view
updates within 2 s, with no geometry growth under that avatar.** The host picks Just Me: the
guest sees today's swim pose. Host NPC Leo swims deep: the guest's puppet shows a sea dragon.
**A second guest joins while the host is already in sea form: no sparkle burst at join**
(particle count unchanged for 1 s after the avatar appears). `lk` ≤ 160 throughout; no message
or presence over 3,900 B; equal hashes at the end.

### 14.5 Existing suites that must stay green

`smoke`, `test:net`, `test:saves`, `test:accounts`, `probe:mp` (with the `LOOKS` fix below),
`probe:boys` (no edit expected: A3, A9, B8 must pass untouched), `probe:vehicles` (water pass:
"she swims" after the second Get out stays true because she no longer bobs), `probe-builds`
(camper slide splash), `probe-avatar`, `probe-pals`, `probe-life`, `probe-menus`,
`probe-environment` (it emits `player:swim` by hand, `:306`; no sea form follows without real
water), `test-net-game`, `site-check`, `test:name`.

Known edits needed in existing tests:
- the test-net codec `lists` map and the new `merfolkTests()` block (§14.2);
- **`probe-multiplayer.mjs` `LOOKS` (`:538`)**: `want = codec.packLook(rules.withResolvedSea(mine, style))`
  with `style` from Rosie's page (`g.surpriseStyle()`), and the `unpackLook` comparison after it
  with `sea` taken out of both sides. Without this, `r.lk === want` never holds (the adapter
  now always appends the resolved sea pair) and "Lily gets Rosie's new look token within 5 s"
  fails after 8 s.

Before declaring any other suite "no edit", grep every probe for `.lk` and `packLook(`.

---

## 15. Build order

1. **Record goldens first** from the untouched tree: `OLD_*_669` values and
   `tools/fixtures/merfolk-old-profile.json` (a dress look, two outfit slots, coins 340,
   stickers). Run: nothing.
2. `src/player/merfolk/rules.js`, `wardrobe-data.js` (§3.1-3.2), `debug.js` `OPTION_LISTS`,
   `codec.js` (§3.3), `tools/test-merfolk.mjs` A1-A11, A16, test-net codec additions. Run
   `test:merfolk`, `test:net --only=unit`, `probe:boys --only=unit`.
3. `physics.js` `swim` option, `input.js` `downKey`, and A14 (the shore exit in Node) before
   any browser work: if A14 fails, nothing else matters.
4. `src/player/merfolk/parts.js` and the avatar hooks (§4.2 `avatar.js`, including
   `disposeSea`), `stage.js` `FRAMES.sea`. A12, A15. Check render grids by hand in
   `game.debug.avatar.renderGrid` with `{ swimming: true, sea: true }`. Run `probe-avatar`,
   `probe:boys --only=world`.
5. `player.js` gate, physics, `_onKey`, `mount`, cut hooks; `camera.js`, `hud.js`, `touch.js`,
   `icons.js`, `emotes.js`, `photo.js`, `src/player/merfolk/index.js` (overlay, bubble, tips,
   bubbles, stickers, debug), `main.js`. Run `probe:merfolk --only=water,touch,costs`, `smoke`,
   `probe:vehicles`, `probe-builds`.
6. The Studio Water tab, slots, `pictures.js`, `portrait.js`, `'style:changed'`. Run
   `probe:merfolk --only=studio`, `probe-avatar`, `probe-menus`.
7. NPC friends (`friend.js`, `friends/index.js`, `chat.js`). Run `probe:merfolk --only=friends`,
   `probe-pals`.
8. Multiplayer: `adapter.js`, `remote-players.js`, friend `netSample`/`puppet`,
   `merfolkTests()`, probe-multiplayer `LOOKS` fix and `SEA`. Run `test:net`, `probe:mp`.
9. With ocean merged: the merged `_onKey` / `_syncAvatar` / `_frame` literals, B10b. Run
   `probe:merfolk --only=water`, ocean's probe.
10. Docs (DESIGN, MULTIPLAYER, DATA-MAP, avatar.md), A13 through the shared scanner,
    `package.json` scripts. Run `test:name`, `probe:merfolk` (all), then the full gate
    (`wave3-critique.md:167-182`) one worktree at a time. Builders never commit `dist/*`; the
    integrator rebuilds it once.

---

## 16. Risks and open questions

- **Q1 The default form.** `'auto'` follows the Girl / Boy button, or the worn look when the
  button was never tapped, and the first turn asks with a non-blocking bubble. A child is
  therefore never silently shown as a form she did not pick for long: one tap in the water
  changes it. Proposed: as designed; the integrator confirms the bubble wording (three words,
  three pictures).
- **Q2 The Sea Dragon's name and look.** "Sea Dragon" is a generic animal name (there are real
  sea dragons). The look is built from our own motifs (horn nubs, bubble spikes, leafy fronds,
  glow spots, a fan fluke) and leaves the face, ears and cheeks untouched. Before launch, a
  grown-up looks at the C5 render grids and answers "does it look like anyone's character?";
  if yes, the extras change before shipping. Also a quick name check, as for the squishy names.
- **Q3 Who owns the underwater tint.** Merfolk (§5.6), agreed in ocean.md §15.
- **Q4 Faster swimming changes timings in existing probes** that swim (vehicles water pass,
  builds camper splash). They check states, not speeds; the gate run will tell.
- **Q5 Old players will start to turn** the first time they swim in deep water. That is the
  wish; the bubble and the Water tab make Just Me one tap away, and it is remembered.
- **Q6 A friend's tail beyond 32 blocks** stays as it was until she comes closer (the remote
  animation freeze). Accepted.
- **Q7 Older cached tabs** can drop an explicit sea choice from a cloud profile (§11). Accepted:
  no item is lost, only a preference that falls back to `'auto'`.
- **Q8 Hats and the dragon's horn nubs**: the nubs show only with no head accessory or a bow
  and move around the bow and tall hair (§7.3); C5 render grids show every head
  accessory (boy and girl, accessories in pink / blue so a horn poking through would show) and
  every hair style with the Sea Dragon.
- **Q9 Later wave (append only)**: a **Rainbow** tail as its own pattern list (`SEA_PATTERNS`,
  a third optional codec token written after the sea pair), so `SEA_COLORS` stays hex only; a
  "tail flip" emote appended to `EMOTES`.
- **Q10 The gentle float-up** means a child who wants to stay on the seabed must keep holding
  Down. Proposed: keep it (the float-up is what makes the water safe-feeling for a 5-year-old
  and what gets her back to the dolphins); revisit after play-testing.

---

## Integrator decisions

(Empty until the integrator answers Q1-Q10. Builders: never push; never commit `dist/*`; end
commit messages with the trailers the session gives.)

## As built

(Written after the build. Where the build differs from the plan text, the build is right.)

### As built (P1)

Built on `claude/wave4-merfolk` from the step-0 base `582d11c`: §15 steps 1-8 (the P1 column of
wave4-integration.md §7.2), with the corrections C1, C3, C4, C5, C7, C8, C14, C16 and C17 applied.
First commit: the goldens (`OLD_*_669` in `tools/test-merfolk.mjs`) and
`tools/fixtures/merfolk-old-profile.json`, both recorded from the untouched base (a real profile
saved by that build: a Mermaid Dress look, two outfit slots, 340 coins, three stickers).

**Where the build differs from the plan**

- **Shore exit (§6.2, A14, B7b).** `physics.move({ swim })` also reports a ledge up to
  `SWIM_LEDGE` 2.05 above her feet (not only 1.05), and the hop speed grows with the rise
  (`hopVy`). She floats with her waist in the water, so a pond rim one block above the water is
  about 2 blocks above her feet: with the 1.05 rule alone she could never get out of a dug pond.
  A 3-block cliff is still a wall (A14). The float-up probe is `BUOY_PROBE` 0.95 above the feet
  (the plan said 1.1): she floats a little higher, which keeps the beach within one hop.
- **The vertical step is one pure function** (`seaVy` in `rules.js`), shared by `player.js` and
  the Node stepper of A14. A leap sets 0.25 s of plain gravity (`hopT`) so the easing does not
  eat it on the frames before she is out of the water.
- **Textures** are light gray-scale, one pair per form (`sea|scale|<form>`, `sea|fin|<form>`);
  the tail color comes from vertex colors. Material keys stay per color and form
  (`scale:<hex>:<form>`, `fin:<hex>:<form>`), owned by `disposeSea()` as planned. A15 checks the
  references go back to zero.
- **Studio tiles** show her floating in the water, three-quarter front
  (`FRAMES.sea = { cy: 0.8, span: 2.3, yaw: 0.6, pitch: 0.14 }`, speed 0.3), not a side view
  while swimming: from the side long hair hid the face and the tail. Easy to change at the review.
- **Saved outfit slots** keep the whole look, `sea` included (the plan said without it):
  wearing a slot never changes the water form and the "worn" check leaves it out, so this is
  harmless and `probe-avatar`'s "the slot is the look" check stays as it was.
- **The leap tip** shows on the 3rd turn of a page visit (there is no per-device turn counter;
  `seaLeapTips` still makes it once per device).
- **NPC friends' line**: the first tail of a world visit resets the friends' reaction timer, so
  the tail line wins over the "You got a sticker!" cheer of her first swim a moment before.
- **The literals of wave4-integration.md §5.2** are in place with ocean's lines as written there
  (`_onKey` dolphin line, `seaRide` / `seaKick` in `_syncAvatar`, `seaRide` in the remote
  `_frame`, the Ride branch of the joystick label). They do nothing until ocean lands; ocean adds
  only `remoteRide`, `sr` / `sk` and the rest of its own lines.
- **Probe helpers** added to shared files for tests only: `avatar.seaParts()`,
  `remote-players` `list()` gains `sea` (one line after `lk`).
- **CI**: `.github/workflows/test.yml` runs `npm run test:merfolk` after the walkie-talkie.
- **Name scan (A13)**: merfolk's five encoded words are in `tools/lib/name-scan.mjs` `EXTRA.merfolk`;
  A13 checks every sea string kids read against the brand list, the extra words and the
  character list.

**Probe notes** (`tools/probe-merfolk.mjs`, passes `unit,water`, `swim`, `studio` (with the C5
grids), `grids`, `touch,friends`, `costs,save`)

- Times are game time: the game clamps a frame to 50 ms, and SwiftShader often runs at 6-10 fps,
  so "within N s" checks count game seconds (what a child sees at a normal frame rate).
- B6: "peak y >= water top + 1.4" reads "the top water cell's y + 1.4" (feet clear the surface by
  about 0.4); with `LEAP_V` 9.2 that is what the plan's numbers give.
- B9's adapter checks (lk sends the resolved form, never auto) run in probe-multiplayer `LOOKS`
  and `SEA`; a solo page has no adapter.
- B10b (riding a dolphin) is P2 (it needs ocean).
- B12: the selfie camera aims 0.15 under its head point, so it looks at y + 0.85 (head point
  y + 1.0 in sea form, 1.3 on land).
- B13c: on SwiftShader a normal frame is already 100-180 ms, so "<= 33 ms" is checked as "the
  first turn adds at most 33 ms to the usual frame"; `ensureSea` itself is 0.6 ms (<= 2).
- probe-multiplayer `SEA` (part a) opens a fourth page, Mia, who joins while Lily is already a
  mermaid (no burst), then goes home; part a now runs about 445 s.

**Gate (P1), each command alone, browser suites under the lock** (seconds on this machine)

| command | result |
|---|---|
| `node tools/test-merfolk.mjs` | 19 passed |
| `node tools/test-net.mjs --only=unit` / whole `test-net` | 26 / 63 passed (142 s) |
| `npm run test:saves`, `npm run test:accounts`, `test:vehicles`, walkie unit, `test:name` | green |
| `probe-merfolk --only=unit,water` / `swim` / `studio` / `touch,friends` / `costs,save` | green (153 / ~350 / 194 / 107 / 195 s) |
| `smoke` | green (90 s) |
| `probe-multiplayer --part=a` / `b` / `c` | green (445 / 448 / 445 s) |
| `probe-boys` unit, studio, touch, world, friends, grids | green |
| `probe-vehicles` models,land / water,save / touch,mp | green (96 / 90 / 264 s) |
| `probe-builds` gallery,hills,play / ui,touch | green (206 / 98 s) |
| `probe-avatar`, `probe-pals`, `probe-life --only=desktop` / `touch` | green (187 / 249 / 204 / 92 s) |
| `probe-menus --only=desktop` / `touch`, `probe-environment` | green (99 / 264 / 130 s) |
| `test-net-game`, `site-check --no-build` (after `build:site`) | green (279 / 180 s) |

The gate caught one thing, fixed above: `probe-avatar` expects a saved outfit slot to be exactly
the look (the slot now keeps `sea`). `probe:boys` needed no edit (the sea tokens are left out
for auto + Match), as planned.

**For the owner review (§7.3)**: `.shots/merfolk-grid-mermaid.png`,
`merfolk-grid-sea_dragon.png` (every tail color and Match, the back, four kinds of clothes, the
swim view), `merfolk-grid-heads.png` and `merfolk-grid-headsBack.png` (every head accessory with
the Sea Dragon: since the second review round the horn nubs are left out only under a hat), `merfolk-grid-starters.png`,
the Studio (`merfolk-studio-water-*.png`, `merfolk-studio-dragon-*.png`) and the world
(`merfolk-mermaid-in.png`, `merfolk-dragon-in.png`, `merfolk-leap.png`, `merfolk-underwater.png`,
`merfolk-candy-underwater.png`, `merfolk-bubble.png`, `merfolk-friends-sea.png`). The Sea Dragon
name and look check is the owner's (§16 Q2).

**Wanted text for the integrator** (C17: builders do not edit these files)

- `docs/DESIGN.md` §7.1 (sea forms): the turn in deep water (0.25 s; 2 deep), Mermaid / Sea
  Dragon / Just Me, `look.sea` (auto follows this device's Girl / Boy button, else the worn look),
  sea swimming (4.6 / 6.2 blocks/s, Up / Down, the float up, the dolphin leap, the shore flop up
  to 2 blocks), the Studio's Water tab, the underwater tint, NPC friends turning too. Events:
  `'player:seaform' { form }`, `'player:leap' { pos, form }`, `'style:changed' { style }` (and
  the internal `'player:seaswim' { on }`). Stickers: Sea Magic!, Big Leap!. Player: `seaGate`,
  `seaSwim`, `seaForm`; `game.underwater`.
- `docs/MULTIPLAYER.md` §5.4 `st` gains `m` (in sea form, not riding); `lk` is
  `packLook(withResolvedSea(look, style))`; §5.13: two sea tokens after the jersey number, left
  out for auto + Match, worst case 156; "a later token must write the sea pair (`0.-`) first";
  NPC `nx` samples use `st` `m` too.
- `docs/DATA-MAP.md:50`: "... her avatar look (including the water form and tail color). A tail
  form chosen automatically from this device's Girl / Boy button is shown to friends like clothes
  are; the button itself is never sent or stored."
- `docs/teams/avatar.md`: one paragraph: the sea parts are lazy, built outside `build()`;
  `disposeSea()` owns their meshes, bones, materials and textures; `seaParts()`, `heldShown`.

**Not done in P1, and why**: B10b and the merged-literal check with ocean's dolphin are P2
(§7.2: they need ocean's `debug.ocean.ride()`). Everything else in §15 steps 1-8 is built.

### As built (owner review: the Sea Dragon redesign)

The owner review found the Sea Dragon looked almost like the mermaid (same tail, tiny spikes,
horn nubs hidden by hair) and, from behind, not like a creature at all. It is now a bold, friendly
creature of our own (§0, §7.1-7.3, §7.5 updated): a longer (0.96), thicker, gently curving tail
with light **belly plates** down the front; a tall row of round-tipped **crest spikes** (tail
colored, growing into gold tips) from the waist down the whole tail, which is what shows from
the play camera; big solid **leafy fronds** on the tail and small **leafy fins on the forearms**;
**curved horn nubs** that clearly rise above the hair; round **glow spots** with a soft halo
along the crest that pulse gently (unlit `seaglow:<hex>`, owned by `disposeSea()`); a big
**ribbed fan fin** (five round lobes, the outer ones longest, five gold ribs, no points).
Untouched: the face, eyes, skin, hair, no frills or fins near the face or ears, no scales on the
face, body or arms; no list, key, codec or save change. The tube's rest layout is built once per
form and color (`tubeTemplate`), so a Sea Dragon's `ensureSea` stays about as cheap as before.

**Second round (the picture judges):**
- **Horns left out only under a hat** (beanie, sun hat, sparkly hat, cap, backwards cap, bucket
  hat), not under every head accessory: the girl with her bow, tiaras, ears, halos, headbands,
  headphones and four of the six boy starters now have them. `hornSpot(look)` moves them where an
  accessory or hair sits on that spot (behind a bow, ears, headphones, the unicorn horn or a
  crown; beside a top bun; behind space buns; up out of an afro, curly hair, spikes or short
  curls, so they never end inside the curls).
- **No crest on the torso**: on the back of the shirt it read as beads sewn on (over the shirt
  number), poked through long hair from the side and was left out under backpacks. The crest
  starts at the waist; its spikes are taller (0.27 at the waist), pointier (`sin^1.5`) and grow
  from the tail color into a gold tip (`crestColor`), so they read as spikes, not gold lumps.
- **Solid, bolder fronds, forearm fins and fan fin**: drawn with the scales material (opaque,
  both faces) in a deep tail color with a gold-tinged rim, not the pale see-through fin
  material; the fan's outer lobes are now the longest, so it reads as a tail fin, not a shell.
  The forearm fins are smaller (0.13) and lie back along the arm. The dragon has no `fin:`
  material at all now: 6 draw calls in sea form (was 8).
- **Gold accent of its own** (`#FFC83A`, not mixed with the tail), so a pink or purple tail's
  crest is gold, not peach. **Match never makes a purple or pearl Sea Dragon** (`seaColorOf`:
  those give its Deep teal; Purple picked by hand stays), so the default girl's Sea Dragon is
  teal and gold and her Water-tab cards differ at a glance (test A6c).
- **Dress Up**: with the tail out, the preview floats above the turntable (0.32 mermaid, 0.58
  Sea Dragon, the camera follows) and the Sea Dragon swims slower there (0.6), so its whole tail
  hangs down instead of pointing at the camera; the probe waits for the change to settle before
  its `merfolk-studio-dragon-*.png` pictures.
- **Resting on a shallow floor** (holding Down in 2-deep water), the tail curls back along the
  sand (`poseSea(speed, dt, onFloor)`) instead of sinking 0.6 into it (mermaid too).
- Doc fix: the rest `bend` is added after the clamp of the animated angle (§7.1).
- Tests: A6c checks a Sea Dragon's Match is never Purple or Pearl; A17 checks `hornSpot` for
  every head accessory × hair style (null only under the six hats) and the gold accent. Probe
  B8's 1-deep test pool is now raised on a sand floor with a rim (the sea next to the beach ran
  into it in one world and made it deep).

Probe: `--only=review` (also run by `studio`) writes the owner pictures
`merfolk-review-{boy,girl,compare,colors}.png` (front, three-quarter, side, back, swimming, from
behind; next to the mermaid; six tail colors) and the world shots
`merfolk-review-{boy,girl}-{water,swims,underwater}.png`, `merfolk-review-night.png`,
`merfolk-review-next-to-mermaid.png`. The render grids gained the Soccer Star boy starter (front,
side, back, swimming, from behind), the boy starters from behind and the girl starters as a Sea
Dragon; `merfolk-grid-heads.png` / `-headsBack.png` show every head accessory on the boy and the
default girl (accessories in pink / blue, never the horns' gold, framed tall enough for the
halo) and the new `merfolk-grid-hair.png` every hair style with the Sea Dragon (boy front, girl
side). B13a / B13b also measure a boy starter as a Sea Dragon and B13c its `ensureSea` (≤ 2 ms).
The review world shots are taken in open water (a spot whose 9×9 neighbourhood is all deep, at
least 5 deep, at least 18 blocks inside the world, facing into the world) so no cliff sits behind
the camera and the world's edge, where its water meets the horizon ring, is out of the picture
(that edge shows a thin brown line: world / horizon code, not merfolk's; noted for the
integrator). The under-water ones dive, hover and look down a little onto his back, so the whole
crest and fan show; `merfolk-review-next-to-mermaid-swims.png` has the two swimming side by
side.

**Shader warm-up (found while re-running B13c).** The fins (`fin:`) are see-through and
two-sided, which three.js draws in two passes, so they needed two shader programs nothing else
uses (not the `cloth2:` program, as §7.5 had assumed); built lazily they stalled the frame of the
first turn (about 0.7 s on SwiftShader). `index.js` now compiles them (and the scale program) on
`world:load` with stand-in materials of the same kind against the world's lights and fog; the
first turn adds no program. B13c now earns the Sea Magic! sticker before it measures, so the
sticker's pop (the sticker book's cost) is not counted as the turn's. Probe robustness: B8's
1-deep test pool is 11×11 (one second of swimming no longer reaches its rim and hops out); B16
makes a new candy world when the random one has no deep milk near the start.

**Third round (the picture judges):**
- **Bug: the forearm fins stayed on the arms on land.** They were merged straight onto the
  elbow bones, outside `sea.root` and `sea.bones`, so the visibility toggle and the grow scale
  never reached them: after a swim a dragon kid walked about (and showed in Dress Up, photos and
  on friends' screens) with leaves on both forearms, and they popped in at full size. Each now
  hangs on its own sea group under the elbow (`seaFinL` / `seaFinR`, in `bones`), so it hides and
  grows with the tail. Test A18 (Node: after a swim, on land the same meshes are drawn as before
  it) and the review check "on land after a swim, no sea parts showing" with its picture
  `merfolk-review-boy-land-after-swim.png`.
- **Seen at the surface (the usual play view).** Floating with its head out (`seaFloat`, passed by
  the player and remote players: the water does not reach 1.3 above the feet), the Sea Dragon's
  tail sweeps straight back from the hips and lies along the surface, crest up, curving round to
  one side, its end and fan fin curling up out of the water, and it rides 0.13 higher, its back
  at the waterline (`FLOAT_BEND`, `seaKick.float`; the mermaid is unchanged). Swimming along the
  top the tail lifts a little, so the fan fin stays in sight from behind.
- **Darker back, warm belly**: the tail shades from a dark back along the spine (`S`, the tail
  color 45 % darker) to its own color on the flanks, so it reads as a dark shape in light water;
  the belly plates are warm gold-cream. Taller crest spikes (0.31 at the waist).
- **Glow at night and in deep water**: bigger glow spots, plus a glowing bead at the tip of each
  frond; the glow material is drawn in the blended pass after the water (the tube's
  `renderOrder` 4, 0.85 opacity, no depth write), so the spots shine up through it.
- **Fins, not leaves**: fronds, forearm fins and fan fin are deep tail color with a light rim in
  the tail's own color (teal mixed with gold had turned them leaf green), and each frond has three
  gold ribs like the fan fin. The fan folds its outer lobes a little toward the back (`FOLD`
  0.42, real face normals), so from the side it is a wedge, not a thin stick. Forearm fins 0.16.
- **Horns**: a dark root band, ridge bands and a light tip (no more plain yellow crescents), and
  `hornSpot` now gives each accessory its own spot, tilt and size: out to the sides past a halo
  ring, a crown or a unicorn horn; low and sideways under bunny ears (clear of the bent ear);
  between and behind cat ears; back, higher and wider behind a bow, so both horns show above the
  default girl's bow in the Dress Up preview.
- Pictures: the heads grids frame head and shoulders (big enough to judge each horn); the back,
  side and play-camera frames fit the whole fan fin.
- Costs: draw calls unchanged (B13a sea form = land); `ensureSea` for a Sea Dragon about 1 ms.
  B13c (the longest frame just after the first turn, +33 ms allowed) is noise-bound on this busy
  machine: the previous commit measured +23, +70 and +48 ms, this one +28 to +163 ms; no shader
  program is compiled on the turn.

**Fourth round (the picture judges):**
- **Readable from the play camera.** The float bend that lifted the tail end and fan toward
  the camera is gone (and so is riding 0.13 higher: he floats at the mermaid's level). Floating,
  the tail sweeps back from the hips and its end sinks a little; swimming along the top it trails
  straight back and a little down under the surface (`FLOAT_STILL` / `FLOAT_SWIM`, blended by
  speed). The dragon's tail waves side to side in a slow S (`seaKick.side`, more at speed) with a
  smaller up-and-down kick (×0.4), and its fan fin rolls with the wave and turns on edge with
  speed (`fluke.rotation.y`, eased), so from behind you see horns, the crest down the tail and the
  fan under the water tint, not a flat splash. The mermaid's poses are unchanged.
- **No famous-dragon colors.** Accents per tail (`ACCENTS` in parts.js): Purple has mint horns,
  crest and ribs and a pink belly (never purple + gold + yellow); Coral aqua with a shell-pink
  belly; Orange berry pink; Gold deep teal, its dark shades amber (they were olive). Test A17.
- **Horns only with no head accessory or a bow.** Every other head accessory sits on top of the
  head (hats, crown, tiara, flower crown, headband, cat and bunny ears, unicorn horn, halo,
  headphones), so the horns are left out there; an unknown accessory key also gives none. A
  fauxhawk moves them out past its ridge. Grids: heads, headsBack, hair (front, back, girl side).
- **Land after a swim**: the picture looks from over the water at him on the beach (he faces
  the sea); it tries a few angles until the camera stands well back (a tree in a random world
  once put it in his head), checked at more than 2.5 blocks.
- **Probe timing**: B1 (tail grown) and B18 (dive tip) now wait in game time, like the rest of
  the probe; on a loaded software GPU the wall-clock waits ran out first. B16 can need a new
  candy world when the random one has no deep milk near the start (it tries up to 3).
- **Friends**: Aria and Leo pass `seaFloat` too (head out of the water), so a friend Sea Dragon
  floats like the player instead of hanging its tail down.
- **First-turn cost (B13c), measured** (same command on all three builds, lock held, no other
  browser, boy starter as a Sea Dragon, 3 fresh pages each; this 4-core machine draws in
  software, a usual frame is 180-200 ms). Turn frame / its 0.5 s against the same on the shore:
  3372638 (before the redesign) 885-997 ms, +544 to +795 ms, 2 new shader programs on the turn;
  f0eb909 856-932 ms, +646 to +738 ms, 1 new program. So the stall was there before the redesign
  too: a GPU builds a program the first time a material kind is really drawn (the fins' two
  passes, the glow), and the old B13c window started after that frame, so it never saw it. Now
  165-211 ms, -2 to +28 ms, 0 new programs (and a 4-run check: turn frames 149-436 ms with the
  shore's own spikes at 213-364 ms). How: when a world loads, three one-triangle stand-ins
  (scales, two-sided see-through fins, blended glow) are drawn once in the real scene; 1.5 s
  after a world loads or the look changes the player's sea parts are built hidden
  (`avatar.prepareSea()`) and their textures sent to the GPU (`initTexture`). B13c now runs 3
  fresh pages before the main costs page opens, measures from the turn frame itself against the
  shore's 0.5 s stretches (like for like), takes the middle one, and fails if the turn builds any
  shader program.

**For the integrator / squish (Sea Dragon Puffum, C9):** the motifs changed shape, not names:
the horn nubs are now curved horns swept back, with a dark root band, ridge bands and a light
tip; the "bubble-dome spikes" are a tall row of round-tipped crest spikes, tail colored with gold
tips, from the waist (not the neck) to the fin; the back is darker than the flanks; the belly has
warm gold-cream plates; the fronds are bigger, solid, deep tail color with a light rim in the
tail's own color and three gold ribs each (fins, not leaves); the glow spots are round with a
halo, plus glowing beads at the frond tips; the fan fin is bigger, five round lobes with the outer
ones longest, deep tail color with gold ribs, folded a little toward the back. Colors stay Deep teal
`#2FB5B0`; the accent gold is now `#FFC83A` (C9's `#FFD43B` is close enough for a toy). A toy in
other colors follows `ACCENTS` (a purple one has mint horns and crest and a pink belly, never gold).

---

## Review notes

Every blocker and major issue from the two reviews is fixed above; so are all minor ones, with
these differences:

- **Dolphin ride: kept the tail, not "mount() cuts it".** One review asked for side-saddle (the
  picture a child has in mind); the other proposed a §6.5 row "riding a dolphin: never; mount()
  cuts it; legs show". They conflict; the side-saddle tail is what was asked for and what
  ocean.md §15 leaves to us, so §6.5 says "kept". The shared-files part of that second review
  (the merged `_onKey`, `_syncAvatar` and remote `_frame` literals, the extra §4.4 rows) is done.
- **Shore exit: one mechanism, not two.** The two reviews proposed (a) `swim: true` in
  `physics.move` so step-up and `res.ledge` work while sea swimming, plus the hop on
  `this.seaSwim`, plus `_hopT`; and (b) a separate hop on `res.hitWall` when the head is above
  the surface. With (a), every bank she can get onto (rise ≤ 1.05) already sets `res.ledge`;
  `res.hitWall` with no ledge means a wall taller than a hop can clear, so (b) would only bounce
  her against cliffs (as NPC friends do today). (a) plus the float-up and the shallow-water
  settle covers every case in A14 / B7 / T4, including holding Down. The "rest on the floor in
  the shallows" idea from (b) is taken (`SHALLOW_VY`).
- **`photo.js:341`** was reported as off by two; at `669b6fa` the `state === 'walk'` check is
  at `:341`, so it stays. The other line fixes (`player.js:42`, `P.flares` loop `:393-398`,
  `photo.js:314` for the `hy` line) are applied.
- **Leap height**: the dolphins' 7.0 exit speed is a different body; the leap was raised to
  about 1.76 blocks (`LEAP_V` 9.2) with a twirl, not to the dolphins' height, so a child can
  still see where she lands from the third-person camera.
- **Trademark scan**: merfolk does not own the shared scanner; it asks squishies (who already
  planned the scan in `tools/test-name.mjs`) or the integrator to move it into
  `tools/lib/name-scan.mjs` with an encoded list, and only adds its own words there.
