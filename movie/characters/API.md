# ECHO (characters cut) — build contract

Everyone building a piece of this film codes to this file. The director (scenes/film.js) puts the
pieces together, blocks the action, animates the performances and drives lip-sync.

## Units and axes

- three.js r186, metres, **Y up**, floor at **y = 0**.
- A character's `yaw = 0` means it faces **+Z**. Positive yaw turns it toward +X (yaw π faces −Z).
- Deterministic only: no `Math.random`, no `Date`. Use `U.mulberry32(seed)`. Every `set()` or
  `update()` call must fully define the state for that time, because frames render out of order.
- Performance: the whole frame (hut + two humans + Visitor + bloom) must render in ≲ 1.5 s at
  1920×1080 on SwiftShader (a software GPU). Budget ~60k triangles per character, no shadow maps
  larger than 1024², no MSAA, and no per-pixel noise in shaders that fill the screen (bake noise into
  textures in `create`). The first frame may take a few extra seconds for bakes and shader compiles.

## The room: the observatory hut, interior (see `timeline.py` MARKS)

A small, lived-in radio-observatory control hut, night. 5.0 m (X) × 4.0 m (Z) × 2.6 m high,
centred on the origin: walls at x = ±2.5 and z = ±2.0.

| Thing | Where |
| --- | --- |
| Desk along the back wall | top surface y = 0.75, x −1.7 … 0.7, z −2.0 … −1.25 |
| Main monitor (the one that matters) | screen centre (−0.50, 1.12, −1.70), faces +Z, 0.62 × 0.35 m (16:9) |
| Second monitor | left of the main one, angled toward the chair |
| Equipment rack with blinking LEDs, red alarm beacon on top | back-right, x 0.9 … 1.5, against the back wall |
| Desk lamp (warm) | on the desk, x ≈ 0.35 |
| Sam's office chair (wheels, swivel, seat top y = 0.47) | at `sam_chair` (−0.50, 0, −0.85); rolls back to `sam_chair_back` |
| Maya's worn armchair (seat top y ≈ 0.42, reclined back) | at `maya_armchair` (−1.85, 0, 0.95), facing the desk (yaw 0.78π) |
| Window, right wall | centre (2.5, 1.40, 0.30), 1.1 × 0.9 m; the dish on the ridge is visible outside |
| Door, front wall | x ≈ 1.5 |
| Where the Visitor stands | `visitor` (1.30, 0, −0.50), facing yaw −0.42π (toward the humans) |

Light motivation: a warm tungsten desk lamp (about 2700 K), cool blue-cyan monitor glow, a red
alarm beacon pulsing, moonlight/starlight through the window and, when present, cyan light from the
hologram. The set owns all the room lights; characters must look good under them.

## Humans: `lib/human.js`

```js
import { createHuman } from '../lib/human.js';
const maya = await createHuman(env, 'maya');   // or 'sam'; env = { THREE, U, TL, ... } from main.js
scene.add(maya.root);
maya.set(state);                                // every frame, full state
maya.getEye(out)  / maya.getHead(out)           // world-space Vector3 after set(), for camera framing
maya.heights                                    // { standEye, sitEye } in metres
```

`state` (anything left out uses its default, a neutral standing pose facing +Z):

| Field | Meaning |
| --- | --- |
| `t` | film time (s), for breathing, idle sway and micro-motion (deterministic) |
| `position [x,y,z]`, `yaw` | root on the floor between the feet (for `sit`, the point under the front of the seat) |
| `sit` 0..1 | 0 standing, 1 seated on a seat whose top is at `seatHeight` (default 0.47) |
| `recline` 0..1 | when seated: slumped back, head resting back (Maya asleep in the armchair) |
| `lean` −1..1 | torso lean forward (+) or back (−) |
| `twist` | torso yaw (rad) relative to the hips (Sam twisting round in his chair) |
| `walk {phase, amount}` | in-place walk cycle; the feet plant at phase 0.25 (L) and 0.75 (R) of each cycle. The director moves `position`. `amount` 0..1 blends it in |
| `head {yaw, pitch, roll}` | relative to the torso (rad) |
| `lookAt [x,y,z]`, `headFollow` 0..1 | eyes aim at the world point; the head turns part of the way (`headFollow`, default 0.4) |
| `blink` 0..1 | 1 = eyes shut (the director times the blinks) |
| `eyes {squint, wide}` 0..1 | |
| `brows {raise, furrow, sad}` | raise −1..1, the others 0..1 |
| `mouth {smile, frown, jaw}` 0..1 | expression layer on top of the visemes |
| `visemes {sil, PP, FF, TH, DD, kk, CH, SS, nn, RR, aa, E, I, O, U}` | lip-sync weights 0..1 (the director blends them from the phoneme timings; roughly sum to 1) |
| `armL`, `armR` | pose weights, blended: `{ rest, desk, overEyes, point, gesture, raise, pocket, chin }` (0..1 each). `desk` = hands on the desk or keyboard; `overEyes` = forearm across the eyes; `chin` = hand to chin, thinking |
| `pointAt [x,y,z]` | target for `point` |
| `gesturePhase` | drives the `gesture` motion (open-palm explaining beat) |
| more arm poses (same blend dict) | `shrug`, `hips` (hands on hips), `cross` (arms folded), `reach` (hand to `reachAt [x,y,z]`, e.g. a key on the keyboard), `wave`, `lean` (both hands planted on the desk, bearing weight), `scratch` (hand to back of head), `beat` (a quick emphatic downward hand beat) |
| `reachAt [x,y,z]` | target for `reach` |
| `energy` 0..1 | how animated the idle/secondary motion is (0 = asleep/still, 1 = keyed up): scales breathing, weight shifts, fidgets and the follow-through on hair, headphones, cardigan and hood |
| `startle` 0..1 | a whole-body flinch (shoulders up, head back, hands lift); the director keys it as a quick 0→1→0 |
| `nod`, `shake` | extra head-motion amplitudes 0..1; the director supplies the phase through `head` or `t` |
| `past` | `dt => state`: the same character's full state at `t - dt` (non-recursive, no `past` inside), so the rig can run deterministic follow-through springs over the recent motion. Also passed to the Visitor. |
| `walk.stride` | metres per step (the director passes the real distance / steps); a phase running backwards walks backwards |

**Motion quality matters as much as the look. The user specifically asked for characters that are
"really cool and move around and talk, not just static".** Design the rig for lively acting:
- **Overlapping action and follow-through:** hair, bun, headphones, hood and the cardigan hem lag
  and settle after head and body moves. Keep it deterministic: derive it from `t`, walk phase,
  gesture phase and the pose values themselves.
- **Walking:** believable weight transfer, hip sway, bounce and counter-rotation of shoulders against
  hips. Arms swing unless another arm pose is weighted in.
- **Talking:** secondary head motion is natural when combined with the director's nods and beats.
- **Faces:** asymmetric where possible (a slightly lopsided smile reads alive). Keep the eyes wet and bright.

Characters (see `timeline.py` CAST):
- **maya**: early 50s radio astronomer. Brown skin, dark curly hair with grey streaks in a loose
  bun, round tortoiseshell glasses, moss-green knitted cardigan over a cream shirt, dark trousers,
  flat shoes. About 1.66 m tall.
- **sam**: mid-20s PhD student. Dark brown skin, short twisted hair, faded mustard hoodie with
  over-ear headphones around the neck, blue jeans, white sneakers. About 1.80 m tall.

Look: stylized feature-animation (think Pixar/Arcane-lite), appealing and warm, not uncanny.
Expressive, detailed eyes (iris detail, limbal ring, wet highlight, eyelids, lashes), soft skin
with warm subsurface-like shading, sculpted hair, fabric that reads as fabric, five-fingered hands.
Faces must hold up in 1080p close-ups, and lip-sync must read clearly.

## The Visitor: `lib/visitor.js`

```js
import { createVisitor } from '../lib/visitor.js';
const v = await createVisitor(env);
scene.add(v.root);
v.set(state);
v.getEye(out) / v.getHead(out)
```

`state`: `t`, `position`, `yaw`, `head {yaw,pitch,roll}`, `lookAt`, `headFollow`, `blink`,
`visemes` (same 15 keys), `raiseHand` 0..1 (right hand up, palm out, like the figure in the picture),
`glow` 0..1 (voice loudness while it speaks: pulses its inner light),
`materialize` 0..1 (0 = nothing, 1 = fully formed hologram), `materializeFrom {center:[x,y,z],
width, height}` (the main monitor screen: voxels and light pour out of it and assemble the body),
`dissolve` 0..1 (it breaks into light that streams toward `dissolveTo [x,y,z]`, the window),
`flicker` 0..1 (hologram instability).
More motion (the Visitor must feel alive, curious and graceful, never a statue):
`walk {phase, amount}` (a three-legged gait: feet plant at phase 0, 1/3, 2/3), `lean` −1..1,
`crouch` 0..1 (folds its long legs to bring its head down to a human's eye level, about 1.6 m),
`gesture` 0..1 with `gesturePhase` (a slow, elegant open-hand gesture with its long fingers),
`reachAt [x,y,z]` + `reach` 0..1 (extends a hand toward a point), `tilt` (curious head tilt, rad),
plus continuous idle life: a gentle float and sway, crest and finger micro-motion, and breathing light.

Design (see CAST): tall (about 2.1 m) and slender, an elongated skull with a swept-back crest, very
large dark almond eyes with a faint inner glow, no nose, a small delicate mouth, long three-fingered
hands, three-jointed legs. Its silhouette echoes the three-legged figure in the returned picture.
Rendered as a hologram: cyan-white light with a fresnel rim, fine scanlines, subtle interference
flicker, faint internal structure, additive over the room. It gives off cyan light: expose
`v.light` (a PointLight the director adds, and the set can also read `v.lightLevel`). It must still read as a
detailed, solid, expressive character in close-up: eyes, lids, mouth and hands clearly
articulated.

## The set: `lib/set.js`

```js
import { createSet } from '../lib/set.js';
const set = await createSet(env);
set.interior.root  // add to the interior scene
set.exterior.root  // a separate THREE.Scene's contents for the two exterior shots
set.update(t, { alarm, surge, lights, hologram, samChair: {pos:[x,y,z], yaw}, dish: {az, el} })
set.anchors        // monitor screen centre/normal/size, window centre, lamp, etc. (world coords)
```

- The set owns **all interior lighting** (lamp, monitors, alarm beacon, moonlight, and a hologram
  fill light driven by `state.hologram` 0..1), plus `lights` 0..1 (1 = normal, drops during the
  surge) and `surge` 0..1 (brown-out flicker, monitor glitch).
- The **main monitor's screen** is drawn by the set from the timeline (`TL.beats`, `TL.pulses`,
  `TL.grid`):
  - idle: a live spectrogram noise floor with the 1420 MHz hydrogen line;
  - `beats.pulses`: the 1,679 two-tone pulses accelerating, with a PULSES counter to 1679 and then "END OF TRANSMISSION";
  - `beats.fold`: the 23 × 73 picture assembling row by row at `TL.grid.row_times`;
  - hold on the picture;
  - `beats.zoom_visitor`: zoom to the added figure, which is highlighted red-orange;
  - `beats.surge`: glitches;
  - then the screen goes dark/noisy while the Visitor is present, and back to idle after `beats.lights_return`.

  The second monitor shows supporting readouts. The alarm beacon on the rack rotates red from
  `beats.alarm` until the lights return.
- **Exterior** (for shots `ext_push` 7–15 s and `ext_dish` 109.3–113 s): the same ridge, dish and hut
  as the previous cut's observatory scene. It's night, with the Milky Way and stars, and the hut window is warm and lit.
  The dish turns toward the sky during `beats.dish_turns` (az/el from `state.dish`). The camera for
  these shots is the director's. Expose `exterior.anchors` (dish, hut window) for framing.

## Director: `scenes/film.js` (the one scene module, 7–113 s)

Owns the cameras (the per-shot list in `TL.shots`), all blocking, the walk-cycle timing (feet plant
on `TL.footsteps`), blinks, gaze, the phoneme→viseme lip-sync from `TL.dialogue[*].phonemes`, and
the calls to every `set()`.

## Voices: `audio/speech.py` → `build/dialogue/`

`build/dialogue/<id>.wav` (48 kHz mono) and `build/dialogue/manifest.json`:
```json
{ "lines": { "d01": { "wav": "d01.wav", "duration": 1.84,
    "phonemes": [ {"p": "M", "start": 0.02, "end": 0.09}, ... ],   // ARPAbet, stress digits allowed
    "words":    [ {"w": "Maya", "start": 0.02, "end": 0.41}, ... ] } } }
```
All times are relative to the start of the wav. The line plays at `dialogue[i].start` in the film.
