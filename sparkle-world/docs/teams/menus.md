# Menus team: menus, Bag, controls, photo, settings & music

Files: `src/ui/menus.js`, `src/ui/inventory.js`, `src/ui/touch.js`, `src/ui/settings.js`,
`src/ui/photo.js`, `src/ui/hud.js` (polish), the music part of `src/core/audio.js`, and helpers
under `src/ui/menus/` (`backdrop.js`, `biome-art.js`, `icons2.js`, `files.js`).
Probe: `node tools/probe-menus.mjs [--only=desktop|touch]` (screenshots `.shots/menus-*.png`).

## What is built

| Feature | Where | Notes |
|---|---|---|
| Title screen | `menus.js` + `menus/backdrop.js` | Live 3D island (its own small `World` 48×32×48 + `ChunkRenderer`, not saved): pink cottage, cherry trees, flowers, lantern posts, butterflies, voxel clouds, petals, chimney puffs; the player's avatar (`game.createAvatar(profile.look)`) waves / twirls / hearts; slow swinging camera; "Hi, Lily!" bubble follows her head. Buttons: Play (continue last world, hidden if none, shows its name), New World, My Worlds, then tiles Dress Up / Stickers / Settings (each only when its action/panel exists; Help fills in when fewer than 3). Everything is disposed as soon as the loading card shows or a world loads, and rebuilt when the title opens again. |
| New World wizard | `menus.js` + `menus/biome-art.js` | Name pre-filled ("Lily's Rainbow Meadow"), dice = "New idea" (a dice name sticks when the world type changes), painted pixel-art preview per biome made from the game's own block tiles (known recipes for meadow, flat, candy, beach, snow, fairy; any other biome gets a generic scene from `iconBlock` + `colors` + `sky`), Cozy / Big cards, Create!. |
| Loading card | `menus.js` | Adds rotating cute lines ("Planting flowers…", "Painting the sky…") and rising hearts to the core `ui.loading` card (a MutationObserver; core API unchanged). |
| My Worlds | `menus.js` + `menus/files.js` | Cards: thumbnail (or painted biome art), biome badge, name, "Played today"; Play, Rename, Save (to a file), Delete (two in-page questions). Toolbar: New World, Open a file (one world or a whole backup; a world already here is only replaced after an in-page question), and on the website Save all (every world in one file). Friendly empty state. See docs/teams/keepsafe.md. |
| Bag | `inventory.js` | Full-screen panel `bag`: picture tabs for every Bag tab that has items (+ "More" for categories not in `ITEM_CATEGORIES`), big search box, "Recently used" (profile.bagRecent), item cards with slot badges, "Pick a color!" step, mini hotbar at the bottom. Tap = into the selected slot + close; long-press (0.46 s) = into the slot, move to the next slot, keep browsing (touch: on release, so rest-then-swipe only scrolls); mouse drag = drop on any slot. |
| HUD | `hud.js` | Help button (top right), Sparkle Coins pill (see below), touch layout: tools hang from the top, Fly/Emotes/Photo in a row, Jump / Up+Down own the bottom-right corner; checked for overlaps at 1024×768, 1180×820, 820×1180, 768×1024 and 390×844 with every other team's button present. |
| Controls | `touch.js` | Joystick dead zone (16 %) + smooth response curve, look speed (`settings.lookSpeed`) for mouse and touch, decorated joystick ring ("Walk"). Pinch zoom and "no accidental builds" are core behaviour, verified by the probe. |
| How to play | `touch.js` | Panel `help`, action `help`, keys H / ?: keycaps and mouse pictures, a Touch tab with gesture pictures, "Show tips again". |
| Tutorial | `touch.js` | 5 bubbles (walk, build, Bag, Hand, "saves by itself"), each finishes when she does it (or Next), shown once per profile (`profile.tutorialDone`). Action `tutorial` replays it. Browsers driven by automation (`navigator.webdriver`) skip the automatic start so other teams' screenshots stay clean. |
| Settings | `settings.js` | Panel `settings` (+ action `settings`): Music / Sounds sliders, Quiet (mute all), Read words out loud (speechSynthesis for toasts, hints and tips; `game.speak(text)`), Camera, Look speed, Pretty or fast (Auto / Pretty / Fast; Auto steps the pixel ratio down after 6 s under 30 fps), Weather wand (only when `game.weather` exists), Time of day + Freeze time (in a world), Your name, How to play. |
| Photo | `photo.js` | Action `photo` (P key, HUD Photo). UI fades, "Smile!" viewfinder, flash + shutter; polaroid with world name, date and "by <name>", frames Plain / Hearts / Stars / Flowers / Rainbow; Save (downloads capability or `<a download>`), Take another, Selfie! (camera swings to her face and she makes heart hands), Done. Emits `photo:taken`. `game.photo = { take(opts), save(), canvas }`. |
| Music | `core/audio.js` | Generative music box with moods `day` (bright 4/4 with swing), `night` (3/4 lullaby with pads), `menu` and `cozy` (warm pads); phrase-based melodies (A A B A, new tune every 8 bars), a light echo-hall (two feedback delays, cheap on tablets), 1–2 s crossfades between moods. |

## Contracts for other teams

- **Actions registered here:** `photo`, `help`, `tutorial`, `settings`. `photo` takes an optional
  `{ selfie: true }` (`game.runAction('photo', { selfie: true })`).
- **Panels registered here:** `title`, `newworld`, `worlds`, `pause`, `bag`, `settings`, `help`, `photo`.
- **Audio (core API kept, additions):** `audio.setMood('menu' | 'cozy' | null)` (null = day/night by
  the clock, `setNight` still works), `audio.mood` (getter), `audio.setMuted(bool)`. The settings
  system sets `menu` on the title and `cozy` when there is a roof over her head.
- **Sparkle Coins:** the HUD shows a coin pill as soon as `profile.coins` is a number. Emit
  `game.events.emit('coins:change', { coins })` after changing it for an instant update (it also
  polls 4× per second). Please do not add a second coin pill.
- **Weather:** Settings shows the weather wand when `game.weather = { current, kinds, set(kind) }`
  exists; `kinds` may be strings or `{ key, name }`. Known keys get icons: sunny, cloudy, rain,
  snow, rainbow.
- **Profile fields added:** `profile.bagRecent` (`[{ key, color }]`), `profile.tutorialDone`,
  `profile.playerName` (also written to `look.name`), `settings.muted`, `settings.lookSpeed`
  (0.4–2.2, default 1). `settings.quality` is `'auto' | 'high' | 'low'` (UI: Auto / Pretty / Fast).
- **Name changes** emit `avatar:changed { look }` and `profile:changed { profile }`.
- **Title backdrop** uses furniture models when they exist (`door_pink`/`door`, `mailbox`, `bench`,
  `picnic_blanket`, `balloon_bunch`, `flower_box`) via `def.build(color, data)`, and block keys
  with fallbacks (`roof_pink`, `glass_heart`, `lantern`, `brick_red`, `flower_sunflower`…). It
  listens to `avatar:changed` / `outfit:changed` and to the `dressup` panel closing to refresh her look.
- **Biome cards:** no extra biome fields are needed; the painter reads `name`, `description`,
  `colors`, `iconBlock` and `sky.top/horizon`. Blocks named in the recipes that do not exist fall
  back quietly (e.g. candy uses `frosting_pink`, `cookie`, `lollipop_block`, `gumdrop_*` when present).
- **Bag:** items with a category missing from `ITEM_CATEGORIES` appear under "More". Tab pictures
  prefer these items when registered: `block:leaves_cherry`, `block:brick_pink`, `block:wool_pink`,
  `block:lollipop_block`, `block:glass_heart`, `block:lantern`, `furn:bed_canopy`, `furn:sofa`,
  `furn:stove`, `furn:bathtub`, `furn:swing`, `furn:trampoline`; otherwise the tab's first item.
- **Hiding UI for pictures:** photos emit `thumbnail:before` / `thumbnail:after` around the capture
  (same as the core thumbnail), so anything that hides for thumbnails hides for photos too.
- **Input:** `touch.js` wraps `game.input.update()` (after the core update) to apply the joystick
  dead zone and look speed. Anyone else wrapping it should call through the same way.
- **UI wrappers:** `settings.js` wraps `ui.toast` and `ui.hint` (calls the original first) for
  read-aloud.

## Core changes

- `src/core/audio.js` (music part, owned by this team per the brief): new generative music with
  moods, echo and crossfades; added `setMood`, `mood`, `setMuted`. Existing API (`music`,
  `setNight`, `setVolumes`, `play`, `unlock`, `suspend`) unchanged.
- No other core file was edited.

## Testing notes

- Headless SwiftShader renders a world at only ~7–9 real frames per second (the game's own `fps`
  reading is clamped at 20+), so probes wait for outcomes instead of fixed times.
- The probe stands in for other teams' buttons (`dressup`, `stickers`, `emotes`) and for
  `game.weather`, so the merged layout is what gets checked.
