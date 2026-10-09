# Avatar & Dress-Up — team notes

Owner files: `src/player/avatar.js`, `src/player/avatar/*` (geo, rig, textures, outfit, hair,
accessories), `src/player/wardrobe-data.js`, `src/player/emotes.js`, `src/ui/dressup.js`,
`src/ui/dressup/*` (stage, sparkles, pictures, css, debug). Probe: `tools/probe-avatar.mjs`.

## createAvatar (DESIGN §2 "Avatar", as built)

```js
const av = game.createAvatar(look, opts?)   // or: import { createAvatar } from './player/avatar.js'
av.group            // THREE.Group, origin at the feet, ~1.75 tall (+ hats), faces +Z
av.look             // normalized copy of the current look
av.setLook(look)    // no-op when unchanged; ~2-8 ms; rebuilds geometry, reuses materials
av.update(dt, { speed, onGround, swimming, flying, sitting, sleeping, riding })
av.playEmote(name)  // 'wave'|'dance'|'twirl'|'cartwheel'|'jump'|'heart'|'sit' -> seconds
av.emoting          // current emote name or null
av.setOpacity(0..1) // own materials: fades the whole avatar (camera uses it when close)
av.resetPose(); av.settle(state, seconds)   // snap / pre-roll the animation (thumbnails)
av.bones            // named bones (read only): body hips torso head armL elbowL armR elbowR legL kneeL legR kneeR
av.dispose()
```

- `opts.fx(kind, Vector3, particleOpts)` receives particle bursts (wand sparkles, heart hands,
  dance notes, jump stars, sleep zzz). `game.createAvatar` defaults it to
  `game.particles.emit`; pass `{ fx: null }` for an avatar that is not in the world scene
  (title backdrop, photo booth). `opts.blink: false` freezes blinking/glancing.
- Poses: sitting / riding put the hips on the group origin (seat / saddle); sleeping lies
  along local Z, head toward −Z, back on the origin (mattress-top centre). Emotes also play
  while hovering (flying at rest); moving faster than 0.6 m/s, sitting, sleeping, riding or
  swimming cancels them.
- Each avatar owns ~10 materials; canvas textures (eyes, mouths, cloth patterns, glasses,
  wings) come from a ref-counted cache in `avatar/textures.js` (idle entries evicted LRU,
  at most 48 idle). Everything is released by `dispose()`. ~33 meshes (draw calls) per avatar.
- Riding bounce and hair / cape / balloon springs are driven by the group's real movement,
  so moving `group` (player, pets, a turntable) is enough.
- **Sea parts (wave 4, docs/teams/merfolk.md §6.3, §7).** `createAvatar(look, { seaAuto })` and
  `update(dt, { sea: true, seaRide, seaKick, ... })` turn her into a Mermaid or a Sea Dragon in
  deep water. The tail, fin and extras are **lazy**: built on the first turn, or hidden ahead by
  `prepareSea()` (1.5 s after a world load or look change in play mode), never in `build()`.
  `disposeSea()` alone owns their meshes, bones, materials and textures (`build()`'s sweep
  never touches them; `setLook` and `dispose()` call it first). `seaForm`, `seaShown`,
  `setSeaAuto(fnOrForm)` and `heldShown` (false while a held item hides: swimming, the tail
  out, asleep) are read-only helpers; `seaParts()` is for probes.

## look schema (`wardrobe-data.js`)

As in DESIGN.md plus: `hair.color2` may be a hex, `'rainbow'` or null; `hair.mix` =
`'ombre'|'streaks'|'tips'`; `acc.faceColor` / `acc.handColor` (hex or null = the item's own
colors). `normalizeLook(look)` validates every field (unknown keys fall back to defaults) and
returns a deep copy. Exports: option lists `[{key,name}]` (`HAIR_STYLES HAIR_MIXES TOPS BOTTOMS
DRESSES SHOES HEAD_ACC FACE_ACC BACK_ACC NECK_ACC HAND_ACC PATTERNS SMILES EMOTES`), palettes
(`SKIN_TONES HAIR_COLORS(_NATURAL|_FANTASY) EYE_COLORS CLOTH_COLORS METAL_COLORS ACC_COLORS
RAINBOW`), `randomLook(rand, name, base?)` (color-story themes; with `base` keeps name, skin,
eyes and face), `STARTER_OUTFITS` (Princess, Sporty, Beach Day, Fairy, Cozy Winter, Rock Star)
+ `applyOutfit(look, outfit)`, `cloneLook`, `lookSignature`. `game.lookSignature` too.

Wave 3 (boy looks, see `docs/teams/boys.md`): the lists grew (append only) with boy hair,
tops, bottoms, shoes, hats, a star backpack, tie, medal, toys and patterns; options carry a
surprise `tag`; new look keys `face.brows` and `top.num`; `randomLook(rand, name, base, style)`
with 'girl' | 'boy' | 'mix'; six boy starters appended (`tag: 'b'`, may set lashes / brows).

## Dress-Up Studio

- Panel `'dressup'` (fullscreen) + action `'dressup'`. `game.runAction('dressup')` from the HUD,
  the title screen, or a wardrobe / mirror. Optional args pick a tab:
  `game.ui.open('dressup', { tab: 'hats' })` — tabs: `skin hair face tops bottoms dresses shoes
  hats glasses back neck hand outfits`. Closing returns to the title when opened there.
- Every change: `game.profile.look` (+ `profile.playerName`) saved via `game.saveProfile()`,
  `'avatar:changed' { look }` (throttled ~180 ms). On close, if the look differs from when it
  opened: `'outfit:changed' { look }` once (the core counts these for the `fashionista`
  sticker) and a "Looking great!" toast in the world.
- Saved outfits live in `game.profile.outfits` (6 × look|null).
- `game.dressup` is the Studio instance (`.look`, `.preview.spin`, used by the probe).

## Emote wheel

Action `'emotes'` (HUD Emotes button, G key; toggles) opens panel `'emotes'`: seven buttons
pictured with the player's own avatar mid-emote. Picking calls `game.player.emote(name)`
(DESIGN's `player.emote`, which emits `'emote' { name }`). Keys 1–7 pick, G / Esc close.

## Shared stage (for other teams)

`import { getStage } from '../ui/dressup/stage.js'` — one extra WebGL context for avatar
pictures. `stage.snapshot(key, look, { frame, pose: { emote, state, t, yaw }, size, aspect })`
→ `Promise<HTMLCanvasElement|null>` (cached by key). Frames: `full hair head face torso legs
dress feet back neck hand emote` or `{ cy, span, yaw, pitch }`. Please reuse it instead of
creating more WebGL contexts (e.g. for a name-tag portrait or a photo frame).

## Core change

`src/player/camera.js`: when `avatar.setOpacity` exists the camera fades the avatar between
0.75 and 1.55 units from the head instead of hiding it at 1.15 (older avatars keep the hard
hide). No other core files touched.

## Debug

`window.__game.debug.avatar`: `renderGrid(items, { cols, size, aspect })` → PNG dataURL
(items `{ look, label, frame?, pose? }`), `starters()`, `random(seed, base?)`,
`hairStyles()`, `look()`, `textures()` (cache stats).
