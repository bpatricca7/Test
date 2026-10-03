# Environment team: sky, weather, sparkles, gems & stickers

Owned files: `src/life/daynight.js weather.js particles.js collectibles.js stickers.js` and
`src/ui/stickerbook.js`, plus the new helpers `src/life/sky.js clouds.js env-icons.js precip.js
ambient.js sticker-art.js`. Probe: `node tools/probe-environment.mjs [--only=sky,weather,life,gems,stickers,touch]`
(screenshots in `.shots/environment-*.png`).

## Day & night (`daynight.js`, `sky.js`, `clouds.js`)

- Gradient sky dome (three colours per vertex + per-pixel sun disc and halo, moon halo, pastel
  night nebula and the rainbow), a soft glowing sun, peach/pink/lavender sunrises and sunsets, a
  deep indigo night with twinkling pastel stars (a few sparkly four-point ones) that turn with
  the night, a sleepy moon with phases (`game.time.day`, 7-day cycle, never a dark new moon),
  shooting stars now and then (the first one per world visit toasts "Make a wish!"), and fluffy
  voxel clouds on a wrapping grid that drifts with the wind and fills up with the weather.
- Kept as documented: `game.blockUniforms` `uDaylight` 0.4 (night) .. 1 (day), `uAmbient`
  0.22 .. 0.6, fog / Lambert lights driven smoothly; `time:morning` / `time:night` at clock
  crossings 0.25 / 0.78, and a night slept through with `skipToMorning()` stays quiet
  (`time.quietNight`: no `time:night`). Grey weather dims light a little but never below the
  floor. At night the directional light becomes a soft lavender moonlight.
- Biome sky palette: `biomes.get(key).sky = { top, horizon, mid?, fog?, sunset?, sunrise?,
  nightTop?, cloud?, sprinkles? }` (hex strings; all optional, defaults are the meadow sky).
  `sunset`/`sunrise` = horizon colour at dusk/dawn, `cloud` tints the clouds (Candy Land:
  `'#FFD1E6'` for cotton-candy clouds), `sprinkles: true` makes rain sprinkle rain (Candy Land is
  detected by key `candy` anyway). A biome may also give `weather: { sunny, cloudy, rain, snow,
  rainbow }` weights for the automatic weather.
- `game.timeOfDay = { phase: 'dawn'|'day'|'dusk'|'night', label, daylight 0..1, night 0..1,
  dusk 0..1, key, icon() }`: `icon()` is a colourful SVG for the phase + weather (sunrise, sun,
  sunset, moon, cloud, rain, sprinkles, snow, rainbow). The HUD time pill uses it (see core
  change below).
- `game.sky` (environment internals, read-only for others): `dome, stars, moon, shoot, clouds`,
  `setRainbow(amount, dirX?, dirZ?)`, `shootingStar(lookYaw?)`.
- Cloud layer sits at `world.sy + 3` .. `+ ~6`, so "Sky High" (flying above `sy + 9`) really is
  above the clouds.

## Weather (`weather.js`, `precip.js`)

```js
game.weather = {
  current,                 // 'sunny' | 'cloudy' | 'rain' | 'snow' | 'rainbow'
  kinds: ['sunny', 'cloudy', 'rain', 'snow', 'rainbow'],
  info: { [kind]: { key, name, icon } },   // name + colourful SVG string for buttons
  fx: { cloud, overcast, rain, snow, rainbow },   // smoothed 0..1 amounts (read-only)
  sprinkles,               // true while it rains candy sprinkles
  auto,                    // automatic changes on/off (default true)
  set(kind, { instant = false, manual = true, announce = false, silent = false }) -> bool,
  startingWeather(),       // what a new world starts with ('snow' in the snow biome)
}
```
- `set()` fades over a few seconds and emits `'weather:change' { weather }`. A weather picked by
  the player (`manual`, the default) stays about 6 minutes before the sky changes by itself.
  **Settings / weather wand**: just call `game.weather.set(kind)`; `game.weather.info[kind]`
  gives the label and icon.
- Saved per world as system `weather` `{ current, timer }`.
- Automatic weather: mostly sunny; rain is often followed by a rainbow; the snow biome snows a
  lot; Candy Land rains sprinkles; small toasts announce rain / snow / rainbow.
- Rain: GPU streaks around the camera (never inside houses: a heightmap texture of the world
  hides drops under roofs and trees), ripple rings and droplets where it lands, a gentle rain
  sound (filtered noise + soft drips, muffled under a roof; sprinkle rain plinks tiny notes).
  Snow: soft drifting flakes. Rainbow: a big pastel bow in the sky (placed where she is looking
  when it appears) with twinkles, plus rainbow sparkles around her. No thunder, nothing scary.

## Particles (`particles.js`, `ambient.js`)

- `game.particles.emit(kind, position, opts)`: position is a `Vector3` or `[x, y, z]`; opts
  `{ count, color, colors, spread, scale, speed, life, dir: [x, y, z], gravity }`.
- Kinds (all documented ones are kept): `sparkle heart star bubble splash zzz note leaf petal
  confetti rainbow_trail smoke_puff`, plus `glint snowflake gem firefly magic`. One pooled
  `THREE.Points` (800 max, one draw call); glossy sprites painted on a canvas atlas (red channel
  = tint, green = white highlight, so every colour stays shiny). Each kind has its own motion:
  hearts sway up, bubbles pop, Zzz drift out one after another, petals/leaves flutter down,
  confetti tumbles, `rainbow_trail` cycles the rainbow when emitted each frame.
  `quality: 'low'` halves counts. `game.particles.alive()` and `.kinds` for debugging.
- Ambient life (system `ambient`): little flapping 3D butterflies in pastel colours visit
  flowers by day (they land and rest), glowing fireflies at night (pastel fairy lights in the
  Fairy Forest), cherry petals under cherry trees, a falling leaf now and then, bubbles on
  ponds, snow glints in the sun. `game.ambient.spawnButterfly(x,y,z)`,
  `spawnFirefly(x,y,z,fairy)`, `count()` are there for fun and probes.

## Gems (`collectibles.js`)

- 20-30 faceted gems per world in 5 colours (`GEM_COLORS`), spinning and bobbing with a glow;
  collected by walking or flying into them, or by tapping one within reach (Hand, Build or
  Remove all grab it) - chime, burst and a "Gem 3 of 24!" toast; all found = confetti.
- **Worldgen contract**: set `world.gemSpots = [[x, y, z], ...]` (air cells) while generating;
  up to 30 are used for new worlds. Without it gems are scattered over the land (seeded by the
  world). `world.gemTotal` is set by collectibles.
- Event `'gem:collect' { count, total, color }`: `count` = gems found in this world, `total` =
  `world.gemTotal`. `profile.stats.gems` (lifetime, the HUD counter) is bumped by stickers.js.
- Saved per world as system `collectibles` `{ v: 1, gems: [[x, y, z, colorIndex, found], ...] }`.
- Gem radar: every ~10 s the nearest gem (within 48) sends up a faint sparkle beam.
- Building a block into a gem's cell hops the gem up. `game.gems = { colors, list(), found(),
  total(), nearest(), radar() }`.

## Stickers (`stickers.js`, `sticker-art.js`, `src/ui/stickerbook.js`)

- All 21 DESIGN.md ids kept and wired to their events (counters in `profile.stats`). One
  refinement: **Night Owl** starts counting at `time:night` and is awarded after ~4 s of
  stargazing (playing, awake, sky not overcast), so it arrives while the stars twinkle.
- `game.stickers = { has, award, count, total, all(), canvas(id, { locked }), shape(id),
  image(id, { locked, size }), unseen(), markSeen() }`. `canvas()` returns a new `<canvas>`
  with the glossy die-cut sticker (or its lavender silhouette when locked); use it for anything
  shown during play (`image()` returns a PNG data URL but reads pixels back, which can hitch).
- Awarding shows a big "NEW STICKER!" pop with the sticker picture and sun rays (it then flies
  off toward the Stickers button), confetti + jingle, and emits `'sticker:earned' { sticker }`.
- **Adding stickers** (other teams): `game.registry.stickers.set(id, { id, name, hint, icon,
  art?(ctx) })` during install, then `game.award(id)`. `art(ctx)` draws the motif in a 100 x 100
  box (the die-cut border, shadow and gloss are added for you); without it the art is picked by
  `icon` (`star heart home moon gem music photo dress fly build`) or a paint palette.
- Sticker Book: action `'stickers'` (toggles) and panel `'stickers'` (`ui.open('stickers',
  { sticker: id })` opens on that sticker's page). Two album pages with spiral rings (one page
  on phones), six per page, "12 of 21 stickers" progress, earned ones tilted, shining and dated,
  "NEW!" badges, locked ones as silhouettes with their hint; tap one to see it big; Back / Next
  buttons, swipe or arrow keys. Opened from the title screen, Close returns to the title.
  `profile.stickersSeen` remembers which earned stickers the book has shown.

## Performance notes

- Sky dome shading uses define-based variants (day / night / rainbow) instead of uniform
  branches, is drawn after the opaque world (only sky pixels are shaded), and the nebula is per
  vertex. Stars below the horizon are culled in the vertex shader; the star layer is hidden by
  day. Clouds draw only the puffs that are out (faces sorted by their appear threshold).
- Every environment shader, texture and buffer is warmed up once behind the loading screen
  (`userData.envWarm` objects + a 1 x 1 pixel draw), so nightfall, the first rainbow or the
  first fireflies never stall a frame. Sticker pictures are canvases (no pixel read-back).
- No per-frame allocations in the update loops; precipitation and ripples animate on the GPU.

## Core change (additive)

- `src/ui/hud.js` `refreshTime()`: when `game.timeOfDay` exists, the time pill shows
  `game.timeOfDay.icon()` and refreshes when `timeOfDay.key` changes (phase + weather); it also
  sets `data-phase` on the pill. Without `game.timeOfDay` it behaves exactly as before.
