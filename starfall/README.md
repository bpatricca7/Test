# Starfall — a Rocket Boy short

A two-minute animated short in the spirit of a Pixar opener, generated entirely in code.
One HTML file. No image, model, or audio assets. The only dependency is the three.js
library, loaded from a CDN.

**Open `index.html` in a current browser and press Play.** Sound on. Space pauses, R replays, M mutes.

## The story

Finn is a small boy with a tin-can rocket pack who climbs the same hill every night to count
the stars. One night a star falls out of the sky and lands beside him: a little one, dim and
flickering, going out. Far above, a ring of seven stars is missing a piece exactly one star
wide. Finn has never flown higher than the old oak. He straps in anyway.

The rocket carries them up through the clouds to the edge of the sky, where it sputters and
dies. As they begin to fall, the star gives everything it has left in one burst of light,
pushes Finn clear, and sails home to close the ring. Finn drifts back down to his hill under a
small striped parachute, sits, and looks up. The newest star in the ring winks at him.

## What is generated in code

- **The world:** a rolling meadow curved like a tiny planet, a hero hill, an old oak, pines,
  Finn's house with lit windows, a distant town, instanced puffy clouds, fireflies, a moon,
  a twinkling star dome, and the ring constellation with its gap.
- **Finn:** a jointed character built from primitives: hips, torso, head, arms, legs, aviator
  cap, goggles, scarf (simulated flutter), boots, and a two-tank rocket pack with flames,
  indicator lights, and exhaust. Poses blend smoothly (sit, stand, run cycle, kneel, hold,
  brace, fly, tumble, hang, wave). The face has tracking eyes, blinks, eyebrows, and a mouth
  that moves through named expressions (wistful, surprised, worried, determined, joy, scared,
  content).
- **Lumen:** an extruded, beveled star with eyes, blush, and a glow that fades, wakes, and
  flares.
- **Cinematography:** 23 scripted camera shots keyed to the timeline, with eased dollies,
  tracking shots, handheld micro-shake, impact and launch shake, letterbox bars, captions,
  and title and end cards.
- **Effects:** a custom HDR post-processing pipeline (bright pass, five blurred mips, ACES
  tone mapping, vignette, film grain, flash frames), GPU particle systems for sparks, smoke,
  dust, and glitter, a meteor with a trail, shockwave and flash meshes, and a parachute with
  an elastic deploy.
- **Score:** a Web Audio soundtrack synthesized live: a chord pad that follows the scenes,
  a pentatonic chime motif through a feedback-delay reverb, wind, rocket rumble with a
  sub-oscillator, a meteor whoosh, impact thuds, countdown beeps, and the parachute pop.

## Timeline

| Time | Beat |
|------|------|
| 0:00 | Title over the night sky, tilt down to Finn on the hill |
| 0:17 | The star falls and crashes beside the hill |
| 0:26 | Finn finds Lumen in the crater; Lumen wakes |
| 0:34 | Tilt up to the ring constellation and its gap |
| 0:42 | Decision, countdown, ignition |
| 0:48 | Ascent through the clouds |
| 1:01 | The engine sputters and dies at the edge of the sky |
| 1:05 | Lumen's burst; release; the ring closes |
| 1:13 | Parachute, descent, landing |
| 1:28 | Finn looks up; the new star winks |
| 1:38 | End card |

## Testing hooks

`index.html?t=42` starts the film at 42 seconds without the poster (no audio until a click).
Add `&still=1` to freeze there. `window.__film.seek(t)` and `window.__film.tick(t)` render
single frames, which is how the frames in development were checked with headless Chromium.
