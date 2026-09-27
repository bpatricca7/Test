# Team "walkie": the walkie-talkie

The family asked (the dad's words): *"Can we make the walkie talkie feature also? Only to be
used with a code for multiplayer and only used when pressed, it has to be confirmed by a parent
with a multiplication problem."* The contract is `docs/MULTIPLAYER.md` **Addendum B** (rules,
wire format, server behaviour); this file is what was built, where it hooks in, how it was
tested and what is left to check on real devices.

## What a child sees

- **Settings → Walkie-talkie (grown-ups)** (Railway only): a switch. Turning it on opens the
  **grown-up check**: "Please ask a grown-up to answer: 17 × 8 = ?" on a big number pad
  (13–19 × 6–9, answers 78–171). A wrong answer brings a new problem; three wrong answers wait
  60 s (a reload does not skip the wait). Success saves `profile.settings.walkie = {on: true,
  at}` on **this device only**. Turning it off is one tap. The plain note for grown-ups: *"Voices
  go live only to friends in this game, are never recorded, and stop when the button is let
  go."*
- While playing together (a code) with the walkie on: a big **walkie button** (a pink walkie
  with a heart on a sunny circle) in the HUD, "Hold to talk" (plus an **M** key chip with a
  mouse). Hold it: it glows pink, ripples, a mint ring counts the 15 s down (yellow in the last
  6 s, pink in the last 3) with the seconds in a bubble, "Talking!". Let go: a soft "bip" and the
  microphone is off. At 15 s: a little three-note tune, "That's 15 seconds!", then "Let go, then
  press again".
- A friend talking: "Mia is talking" on the button in Mia's color, a **speaking badge** (walkie
  + sound waves, in her color) over Mia's head, a radio "kssh-bip" before her voice and a
  "roger" beep after it; the music ducks meanwhile. Pressing then gives a friendly "boop boop".
- The first press on a device shows the **microphone card**: "Your walkie needs the
  microphone! Tap OK. If you are asked, tap Allow." / "Your voice goes only to your friends in
  this game, and only while you hold the button." A refused microphone shows a card with
  help for grown-ups and **Try again**.
- **Players** panel: every row has a badge (**walkie**, **walkie off**, **muted**,
  **talking**); **Mute / Unmute** per friend (the host's mutes a friend for everyone; a
  friend's is only for herself); the host also has **Mute everyone** ("All walkie-talkies rest
  (yours too)"). A muted child's button turns grey with a sleepy moon: "Walkie resting".
- A device whose walkie is **off** shows no walkie button, only a small grey **Walkie off**
  badge while a friend's walkie is on (tap: "A grown-up can turn on the walkie-talkie in
  Settings."). It sends nothing and the server sends it nothing.
- Playing alone, and inside claude.ai (RoomTransport, where the microphone is blocked): no
  walkie UI at all, no Settings row.

Screenshots (`node tools/test-walkie.mjs`): `.shots/walkie-gate-{desktop,ipad,phone}.png`,
`walkie-mic-card-{desktop,ipad,phone}.png`, `walkie-hud-talking-{desktop,ipad,phone}.png`,
`walkie-hud-talking-phone-sideways.png`, `walkie-hud-talking-ipad-portrait.png`,
`walkie-hud-countdown-desktop.png`, `walkie-hud-capped-desktop.png`,
`walkie-speaking-badge-{ipad,desktop,phone}.png`, `walkie-hud-walkie-off-phone.png`,
`walkie-hud-muted-by-host-ipad.png`, `walkie-hud-quiet-ipad.png`,
`walkie-players-host-mute-controls.png`, `walkie-players-host-mute-everyone.png`,
`walkie-players-guest-muted-lily.png`, `walkie-players-phone.png`.

## Files

New (everything lives here):

| File | What |
|---|---|
| `src/net/walkie/wire.js` | frame format and limits, shared with the server |
| `src/net/walkie/adpcm.js` | IMA ADPCM codec, 16 kHz resampler |
| `src/net/walkie/capture.js` | microphone (only while held), AudioWorklet / ScriptProcessor tap |
| `src/net/walkie/player.js` | playback with a 160 ms jitter buffer, squelch and cue sounds, music ducking |
| `src/net/walkie/gate.js` | the grown-up check |
| `src/net/walkie/ui.js` | HUD button, speaking badges, Walkie off badge, microphone card, Players panel controls, Settings row (all CSS) |
| `src/net/walkie/art.js` | walkie-talkie SVGs |
| `src/net/walkie/index.js` | the controller (`installWalkie(game, net)` → `net.walkie`, `debug.walkie`) |
| `server/voice.mjs` | the relay: voice-on set, "who is in the game", floor, caps, limits, mutes, counters |
| `tools/test-walkie.mjs` | unit + end-to-end test runner (`npm run test:walkie`) |
| `tools/test-walkie-unit.mjs` | the Node unit tests |
| `docs/teams/walkie.md` | this file |

Small hooks in existing files (kept separate so a merge is easy):

| File | Change |
|---|---|
| `server/server.mjs` | import `VoiceRelay`; `voice.link()` per connection; binary frames → `conn.voice.binary()`, `{t:'v'}` → `conn.voice.control()`, close → `conn.voice.close()`; `voice.start()/stop()`; `stats().voice`; `GET /api/stats` only with `SW_TEST_STATS=1`; **`Permissions-Policy: microphone=(self)`** (camera, geolocation, payment stay off); header comment |
| `src/net/ws-transport.js` | `binaryType = 'arraybuffer'`; binary and `{t:'v'}` frames go to `voiceIn`; `voiceUp()` after each reconnect; `sendVoice(data)` |
| `src/net/index.js` | `net.walkie = installWalkie(game, net)` (2 lines) |
| `src/net/ui.js` | Players panel: `net.walkie.decorateRow(...)` per row, `net.walkie.decoratePanel(...)` after the rules, `net.walkie.panelKey()` in the refresh key (3 lines) |
| `src/ui/settings.js` | a generic `game.settingsRows` hook before "How to play" (2 lines) |
| `package.json` | `test:walkie` script |
| `docs/MULTIPLAYER.md` | Addendum B; a note under Addendum A item 2 |
| `docs/DEPLOY-RAILWAY.md` | how grown-ups turn it on; "Is it safe for kids?"; the test in the checks table |

The HUD itself (`src/ui/hud.js`), `remote-players.js`, `rooms.mjs`, the net core and the
protocol are unchanged: the button is its own element in the HUD layer, the speaking badge
reads `net.remote.get(peer)` positions, and the server reads room presence without changing
`rooms.mjs`.

## Design decisions (and where they differ from the brief)

- **Relay, not WebRTC** (as briefed): see Addendum B.2 (privacy of home IPs, no TURN bill, one
  place that enforces every rule).
- **"In the game" is decided by the server from the host's presence** (`adm`), not by the page
  saying "voice on" alone. The brief said "within the room"; but a room also holds friends
  still knocking (not let in yet) and anyone who guessed the code. Reading `adm` at every frame
  means only the players the host let in hear anything, and a friend who is sent home stops
  hearing at once.
- **Host mute is also enforced by the server** (not only by the pages): the host's presence
  `wm` is checked at every request and frame.
- **A listener's own mutes are sent to the server** (`{k:'mute'}`), so a muted voice is not even
  delivered, besides being dropped by the page.
- **"Mute everyone" includes the host's own walkie** ("All walkie-talkies rest (yours too)"):
  one clear quiet-time switch; fairer than "only I can talk".
- **The host's Mute is for everyone; a friend's Mute is for herself.** One Mute button per row,
  so a 7-year-old never has to choose between two kinds of mute.
- **The microphone card shows once per device** (`profile.settings.walkie.mic`), even when the
  browser already allows the microphone (Chromium's test flags do), so the child always gets
  the explanation first. Turning the walkie off and on again shows it again.
- **Pressing again right after one's own press**: the server asks for a 0.7 s pause (so one
  child cannot hog the walkie by re-pressing); the page quietly asks again after the pause while
  the button is still held (her words are buffered, up to about 1.3 s).
- **Busy is decided twice**: the page knows who is talking (server `talk` notices) and says
  "Mia is talking" without opening the microphone; a true tie (two presses in the same
  millisecond) is decided by the server, and the loser's microphone closes at once.
- **Key M** for hold-to-talk (free in play mode: the game uses WASD, arrows, Space, Shift, C, B,
  E, Q, R, F, V, P, G, Z, X, H, T, 1–9; the piano's keys are A–P and M is not among them).
- **Playback volume** goes through the game's master gain, so the **Quiet** switch silences
  voices too; the music ducks while someone talks.
- **Bandwidth**: 16 kHz IMA ADPCM, 80 ms frames: 8,100 B/s per talker measured (about 65 kbit/s),
  relayed once per listener (≤ 3 listeners: ≤ 24 KB/s down from the server per talking game).

## Tests

`npm run test:walkie` (about 10 minutes in SwiftShader; 131 checks in the last run; `--unit-only` for the Node part only, `--no-build`,
`--headed`, `--shots-prefix=walkie`):

- **Unit** (`tools/test-walkie-unit.mjs`): ADPCM round trip of 2 s of speech-like audio at
  **SNR 33.0 dB**, 8,100 B/s; a middle frame decodes on its own; full-scale input stays in
  range; resampler 48 kHz and 44.1 kHz → 16 kHz keeps a 1 kHz tone's pitch and level; frame
  header round trip and refusals (magic, reserved byte, step index, flags, size); relay over
  the real `RoomRegistry`: host and admitted friend in the game, knocker and a second "host" not;
  frames reach only walkie-on players of the game (walkie-off friend, knocker, fake host,
  talker: 0 bytes); busy; floor released by the last frame and by `end`; 0.7 s cooldown; 15 s
  cap by audio length (15.12 s relayed) and by time; idle cuts (no first frame in 3 s, 1.5 s
  silence); a 100-frame flood (24 relayed, 76 dropped) and frames 4× too fast for 3 s (56
  relayed: the 12,000 B/s limit); oversized / malformed frames; listener
  mute (not sent); host mute of one friend (refused) and Mute everyone (cut at the next frame,
  host included); a friend sent home is cut and hears nothing; voice off; a talker's
  disconnect frees the floor.
- **End to end** through the real server (`server/server.mjs` on a random port,
  `SW_TEST_STATS=1`), Chromium with a fake microphone: first, no walkie at all alone (file://)
  or inside claude.ai (a stand-in `window.claude` room: room transport, no Settings row, no
  button); then three pages: Lily (host, desktop 1280×800), Rosie (iPad 1024×768, touch), June
  (phone 390×844, touch, walkie **off**): Permissions-Policy;
  grown-up checks with real taps (a wrong answer, then right) on desktop and iPad; no walkie UI
  before playing together; the button only for walkie-on players, June only gets the "Walkie
  off" badge; the microphone card on the first press; **Lily holds 2 s** → 25 frames / 16,176 B
  sent, Rosie receives 25 frames and schedules 25 buffers (2.00 s), **June receives 0 bytes**
  (her page and the server's per-peer counters), the server relays exactly Lily's bytes once;
  every microphone track `ended` right after the release; Rosie pressing while Lily talks gets
  "Lily is talking" without opening her microphone; two real presses at once → one talks; the
  same millisecond → the server gives it to one and answers "busy" to the other; Rosie talks
  from the iPad and Lily hears her; a long press is cut at 15.1 s (14.96 s sent, 14.96 s played by Rosie) with the
  button still held, the ring counting down; the open Players panel does not redraw by itself
  (a redraw could swallow a tap); Rosie mutes Lily (nothing even sent to her); the
  host mutes Rosie (her walkie rests, nothing sent when she presses); Mute everyone (everyone's
  walkie rests, host included); June's grown-up turns hers on from the pause menu, June talks
  from the phone, Rosie hears her; phone sideways and iPad upright shots; turning off is one tap
  and tells the server "voice off"; the server log names no child and no code; **zero console
  errors**.

Also re-run: `npm run test:net`, `node tools/probe-railway.mjs`, `node tools/smoke.mjs
--shots-prefix=walkie` (single player: no walkie UI, nothing changed).

## To check on real devices (headless Chromium cannot)

- **iPhone / iPad Safari**: that the microphone indicator (orange dot) goes off on release; that
  speaker output stays on the loudspeaker (not the earpiece) and at normal volume while and
  after the microphone was open (iOS switches the audio session to play-and-record while
  capturing); that the first press inside a fresh page asks for the microphone as expected.
- Real voices through echo cancellation on a tablet speaker (a friend's voice should not echo
  back when two devices are in the same room; if it does, move them apart).
- Latency end to end (expected about 0.3–0.4 s: 80 ms frames + 160 ms jitter buffer + network).

## Known limits

- The page decides "voice on" after the grown-up check; the server trusts that declaration
  (it cannot see the check). What the server does enforce is that a voice-on page must be a
  player of that game, and that it never sends voice to a page that did not say "on".
- Presence `adm` (the net core's list of let-in friends) is the server's truth for "in the
  game". If the net core ever renames or reshapes it, the walkie fails **closed** (nobody is
  in the game, nobody hears anything) and the unit tests fail.
- Local mutes last for the session (keyed by the friend's device id); so do the host's mutes.
- On a plain `http://` home-network address the browser offers no microphone; the page then
  says "The walkie works on the game's https address."
- On a heavily loaded machine SwiftShader can stall a page for seconds: the end-to-end test
  therefore retries a screenshot or a Mute tap once when a page is slow (and logs the retry).
