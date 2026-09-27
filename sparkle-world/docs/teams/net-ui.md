# Team "net UI": Play with Friends screens, friends' avatars, end-to-end tests (Agent C)

docs/MULTIPLAYER.md is the contract (Addendum A overrides earlier sections). The net core
(Agent A) and the game integration with its `game.net` facade (Agent B, docs/teams/net.md)
sit underneath. This file is what a child sees and how it is tested.

| File | What |
|---|---|
| `src/net/index.js` | `install(game)`: B's facade (`facade.js`) with the reviewed `sanitizeName` and `toastMessages: false`, the `net` system (friends' avatars, the held treat), the screens, availability detection at start |
| `src/net/ui.js` | panels `mp-start`, `mp-join`, `mp-players`, `mp-say`; knock cards; message cards; summary; "Before friends"; resume chips; status pills |
| `src/net/remote-players.js` | friends' avatars from presence: interpolation, poses, name tags, phrase bubbles, held treats |
| `src/net/pictures.js` | the 12 code pictures (SVG stickers, `pictureSvg` / `pictureUrl`) and the 16 quick phrases with icons |
| `src/net/names.js` | `sanitizeName(s, fallback)` + the blocklist (grown-ups can review it there) |
| hooks | `main.js` (net after stickers), `ui/menus.js`, `ui/hud.js`, `ui/settings.js`, `ui/icons.js` |
| `tools/net/fake-claude.js` | a room.d.ts-faithful `window.claude` for Playwright pages, routed through `tools/net/hub.mjs` |
| `tools/net/mp-flows.mjs` | shared probe helpers: the real-UI flows (make a code, type it, let in) and `converge()` |
| `tools/probe-multiplayer.mjs` | `npm run probe:mp`: AT1-AT22 with three pages over the fake claude.ai room |
| `tools/probe-railway.mjs` | `npm run probe:railway`: build, the real server as its own process, three pages over WebSockets, kill -9 and restart, kill for good |

## Words a child sees (and why)

- The NPC girls already own **Friends** (HUD button and panel `friends`, "My Friends"). Real
  people are therefore **Players** in the game (HUD button with a game pad and a count badge,
  panel `mp-players`, action `mp-players`; the contract's `mp-friends` name was not used) and
  **Play with Friends** on the title, where there are no NPC friends to confuse them with.
- Codes: **Make a Code** ("Friends come to your world") and **Join a Code** ("Visit a
  friend's world"), two big picture cards. The keypad asks "Tap the 4 pictures your friend
  tells you"; each picture is read aloud when "Read words out loud" is on.
- The host's knock card says "**Mia** wants to play!" with **Let in!** / **Not now** (the
  contract's "Come in!" read as if the host were the one arriving).
- Rules: **Players can build** and **Careful players** ("They can't change your things");
  the panel says "Say these pictures to play together!" and "Waiting for players to knock…".
- A device whose name was never chosen is asked "What's your name?" the first time she opens
  Play with Friends (until then others see "Friend"); a name someone playing already has
  gets a number ("Lily 2") on the knock card and in Players.
- Refusals never ask for something she cannot do: "That's someone else's! Build your own next
  to it."; the host's Undo building reaches the friend as "Lily tidied up. Let's build
  something new together!" (with sparkles); a knock nobody answered in 90 s is "Lily didn't
  hear the knock. Knock again?", and the host hears "Mia knocked while you were busy".
- Every message is a card with a picture and one or two big buttons (§12 texts, host name
  filled in and capitalised). Nothing shows an error code.

## Screens

- **Title**: a sky-blue **Play with Friends** button under My Worlds (shown once
  `game.net.available` is known true), and above Play the resume chips **Keep playing** (host,
  30 min) / **Join Lily** (guest, 2 h), each with the 4 code pictures on it.
- **Play with Friends** (`mp-start`): the two cards; "Make a Code" names the world it will open
  (the last one) and hosts as soon as it is loaded; with no world yet it says "Make a world
  first!" and hosts right after the New World wizard.
- **Keypad** (`mp-join`): 4 slots (the next one blinks), Back, Clear, a 6x2 grid of 88 px
  pictures (4x3 at 80 px on phones), Go!. After Go the same panel shows the joining cards:
  "Looking for your friend…" (the 4 pictures hop), "Knock knock! Waiting for Lily to say yes…"
  (a knocking door, Cancel; on the Railway relay the host's name shows only once she is let
  in, so it reads "your friend"), "Flying to Lily's world…" (snapshot progress). "Nobody is
  playing with those pictures" appears in the keypad with the pictures kept, so she can fix
  one; "Not now", no answer, full and version end on the keypad too (with their card).
- **Knock card** (host, above everything, one at a time, "+1 more"): portrait from the shared
  avatar stage, name, account name in small print on claude.ai plus "visitor" for outside
  guests, knock-knock sound.
- **Players** (`mp-players`): host: the code as 4 big tiles (tap one to hear it, **Say it** reads
  all four), a grown-ups' line with the code words and where friends open the game (the site
  address on Railway), one row per player in her color (portrait, crown for the host, "(you)",
  "Flying here…" / "Coming back…" / "Taking a little break"), **Undo building** and **Send home**
  (each with an in-page confirm), the two rule switches, **Stop playing** (confirm). Guest: the
  list and **Go home**.
- **Say** (`mp-say`, HUD Say button, key T): 16 phrase buttons with icons; the bubble shows over
  her own head too; one phrase per 2 s (a wiggle says "wait").
- **HUD**: Players (count) before Menu, Say after Emotes, only in a session; on phones the Help
  button makes room while playing together (Help stays in the Menu); with a mouse the Fly /
  Emotes / Say / Photo buttons sit two by two so the column clears the top-right buttons.
  "Reconnecting…" (cloud) and "Sending…" (a guest with more than 20 waiting changes) pills.
  "Lily is taking a little break…" pill while the host's tab is hidden or reloading, and on a
  guest "Lily paused building" while building is switched off.
- **Pause**: **Play Together** (not in a session; opens the Play with Friends card, where Make a
  Code hosts this world, reusing a fresh "Keep playing" code), **Players** (in one); a guest's
  Save & Exit reads **Go home**; the host's Save & Exit says goodbye first (summary card).
- A reloaded host who opens that world with **Play** gets "Your friends are waiting! Open your
  door again?" (the same code); the title shows **Keep playing** as the big first button.
- **Summary** (host): "Playing together is over! Everything is saved." with **Great!** and a
  small **Before friends** (two questions, the first with the copy's picture and day and "also
  what you built"; then the backup comes back and a card offers **Undo**). **My Worlds** shows
  a small white **Before friends** with "Copy from <day>" while the backup is younger than 7
  days and nothing was built alone since (docs/MULTIPLAYER.md §13, Addendum B).
- **Settings** on a guest: no weather wand, no time of day (she follows the host's).

## Friends' avatars

`createAvatar(unpackLook(lk), { fx: null })`, looks applied at most once per second; samples
in a fixed ring per friend, drawn 150 ms late with interpolation (a jump over 6 blocks
snaps); poses from `st` (walk, swim, fly, sit, sleep, ride, emote, and the zip line's hanging
pose for `l`); emotes and phrases play once per new nonce; name tags (`nameTagSprite`) in seat
colors pink / sky / mint / lavender, only within 22 blocks; avatars hidden beyond 64 blocks and
not animated beyond 32. A friend arriving gets a sparkle and "Mia is here!" ("is back!" after
a reload); leaving, "Mia went home.". The held treat (`game.treats.held`, a key or `{ key }`)
travels as presence `hi` (set by index.js on the transport, so the net core is unchanged) and is
drawn in the right hand with the Shops model when there is one, else the food models.

## Tests

- `npm run probe:mp` (~25 min in SwiftShader): Lily (desktop, mouse, can host), Rosie (iPad,
  touch, view level), June (phone, touch, outside visitor, joins later). AT1-AT22 plus a
  Sparkle Camper, NPC friends, a zip-line ride, a held treat, a reload + "Join Lily", "Keep
  playing" after a host reload, a new version with everyone's chips, Save & Exit. Every step
  ends with equal hashes / entities / plants / pets / NPC friends / zip links on all pages.
  Screenshots `.shots/net-*.png`.
- `npm run probe:railway` (~6 min): the real server as a child process on a free port.
- In SwiftShader a guest needs about a minute to mesh the world after the snapshot arrived
  (the snapshot itself takes well under a second); the probes wait for it.
