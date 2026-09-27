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
  60 s, the next three 2 minutes (up to 10). Wrong answers are saved at once
  (`profile.settings.walkieWrong = {n, at, locks}`, forgotten after 10 quiet minutes or a
  right answer), so neither closing the check nor a reload skips the wait (tested: 2 wrong, a
  reload, 1 more → locked). Success saves `profile.settings.walkie = {on: true, at}` on **this
  device only**. Turning it off is one tap. The plain note for grown-ups: *"Voices
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
  **talking**). The server enforces the badge: a page gets voice (and may talk) only while its
  presence says `wk:1`, so **walkie off** really means "hears nothing"; **Mute / Unmute** per friend (the host's mutes a friend for everyone; a
  friend's is only for herself); the host also has **Mute everyone** ("All walkie-talkies rest
  (yours too)"). A muted child's button turns grey with a sleepy moon: "Walkie resting".
- A device whose walkie is **off** shows no walkie button, only a small grey **Walkie off**
  badge while a friend's walkie is on (tap: "A grown-up can turn on the walkie-talkie in
  Settings."). It sends nothing and the server sends it nothing.
- Playing alone, and inside claude.ai (RoomTransport, where the microphone is blocked): no
  walkie UI at all, no Settings row.

Screenshots (`node tools/test-walkie.mjs`): `.shots/walkie-gate-{desktop,ipad,phone}.png`,
`walkie-gate-wait.png` (the wait after a reload),
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
| `server/voice.mjs` | the relay: voice-on set, the visible `wk` badge, "who is in the game", floor and fairness, caps, limits, junk budget, mutes, counters |
| `tools/test-walkie.mjs` | unit + end-to-end test runner (`npm run test:walkie`) |
| `tools/test-walkie-unit.mjs` | the Node unit tests |
| `docs/teams/walkie.md` | this file |

Small hooks in existing files (kept separate so a merge is easy):

| File | Change |
|---|---|
| `server/server.mjs` | import `VoiceRelay`; `voice.link()` per connection (with `kick()` → close 4008); binary frames → `conn.voice.binary()`, `{t:'v'}` → `conn.voice.control()`, close → `conn.voice.close()`; `voice.start()/stop()`; `stats().voice`; `GET /api/stats` only with `SW_TEST_STATS=1`; **`Permissions-Policy: microphone=(self)`** (camera, geolocation, payment stay off); header comment. Review fixes: **device stamps** (`&d=` secret → `by = sha256('dev\n' + d)`, passed to `registry.join`); new connections (3/s, burst 20) and new rooms (20/min, burst 12) per address; the client address is the **last** `X-Forwarded-For` entry (`SW_PROXY_HOPS`), IPv6 per /64; a page that never set presence leaves at once when it drops |
| `src/net/ws-transport.js` | `binaryType = 'arraybuffer'`; binary and `{t:'v'}` frames go to `voiceIn`; `voiceUp()` after each reconnect; `sendVoice(data)`. Review fix: a per-device secret (`localStorage 'sparkle-world:net-dev'`) sent as `&d=`; `identity().uid` is the server's stamp of it (`deviceStampOf`) |
| `src/net/host.js` | review fix: a knock is let in by device id only while no other page in the room carries that id (waits up to 8 s for a fading page, then a normal knock card) |
| `tools/test-net.mjs` | review fix tests: device stamps, per-address limits, `X-Forwarded-For`, silent drops (server); a copied device id over the loop transport (session) |
| `src/net/index.js` | `net.walkie = installWalkie(game, net)` (2 lines) |
| `src/net/ui.js` | Players panel: `net.walkie.decorateRow(...)` per row, `net.walkie.decoratePanel(...)` after the rules, `net.walkie.panelKey()` in the refresh key (3 lines) |
| `src/ui/settings.js` | a generic `game.settingsRows` hook before "How to play" (2 lines) |
| `package.json` | `test:walkie` script |
| `docs/MULTIPLAYER.md` | Addendum B; a note under Addendum A item 2 |
| `docs/DEPLOY-RAILWAY.md` | how grown-ups turn it on; "Is it safe for kids?"; the test in the checks table |

The HUD itself (`src/ui/hud.js`), `remote-players.js`, `rooms.mjs` and the protocol are
unchanged: the button is its own element in the HUD layer, the speaking badge reads
`net.remote.get(peer)` positions, and the server reads room presence without changing
`rooms.mjs`. The net core changed only in the review fixes above (`host.js` admissions,
`ws-transport.js` device secret).

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
- **"Who can hear" is what everyone sees** (review, 2026-09-27): the server sends voice to a
  page, and lets it talk, only while its room presence has `wk:1`, the badge every Players
  panel shows. Before, the private `{k:'on'}` frame alone was enough, so a modified page could
  listen while everyone saw "walkie off". `hi.ok` still means only "in the game".
- **Device ids are stamped by the server** (review, 2026-09-27; Addendum A): the uid that
  reclaims a seat and that "Keep playing" remembers used to be a presence field that anyone
  in the room could read and copy; a stranger who guessed the code could knock with a
  let-in friend's uid and be admitted without a tap, and then get voice. Now each page sends
  a device secret with its connection and the server stamps `by = sha256('dev\n' + secret)`;
  the net core already preferred `by` over `presence.uid`. As a second line, the host never
  admits by id while another page with that id is in the room. Old saved "Keep playing" ids
  (from before the change) simply no longer match: those friends knock once more.
- **Loudness** (review, 2026-09-27): the brief's reviewer suggested a DynamicsCompressor at
  about −24 dB, 12–20:1 on the voice bus. Web Audio's compressor adds an automatic make-up
  gain of `(1 / curve(1.0))^0.6`, which at −24 dB / 20:1 is **+13.7 dB** for everything,
  hiss included, so we did it differently: every decoded 80 ms frame is levelled **before it
  plays** (`levelFrame`: over −14 dBFS RMS or peaks over 0.8 → turned down at once; back up by
  +2 dB per frame; normal talking untouched: a look-ahead limiter, since the whole frame is
  known), then the bus has a peak limiter at −3 dB (20:1, knee 0, 2 ms) whose make-up gain a
  trim cancels, and `VOICE_GAIN` is 1 (was 1.35). Measured through the real chain in an
  OfflineAudioContext (the game's master compressor included): a full-scale square blast went
  from peak 1.25 (clipping) and 20.3 dB louder than normal talking to peak 0.23 and 7.5 dB
  louder; normal talking plays exactly as sent. The optional server check (drop presses whose
  ADPCM step index stays ≥ 80) was not added: the receiving page protects itself, and a
  child's loud laugh should not be cut.
- **Fairness** (review, 2026-09-27): a friend who heard "busy" during a press goes first after
  it (the last talker gets `wait` for 2.5 s while that friend is still a voice-on player);
  frames under 20 ms of audio are silence (they do not keep the floor); after a press the
  server cut (15 s, silence) the same talker waits 2.5 s instead of 0.7 s.
- **Junk frames cost the sender** (review, 2026-09-27): binary frames that are not relayed
  (bad header, no floor, over the rate) take from a per-connection budget (30 frames/s, burst
  60; 16 KB/s, burst 64 KB); past it the connection is closed with 4008, like the JSON path.
- **A listener's own mutes are sent to the server** (`{k:'mute'}`), so a muted voice is not even
  delivered, besides being dropped by the page.
- **"Mute everyone" includes the host's own walkie** ("All walkie-talkies rest (yours too)"):
  one clear quiet-time switch; fairer than "only I can talk".
- **The host's Mute is for everyone; a friend's Mute is for herself.** One Mute button per row,
  so a 7-year-old never has to choose between two kinds of mute.
- **The microphone card shows once per device** (`profile.settings.walkie.mic`), even when the
  browser already allows the microphone (Chromium's test flags do), so the child always gets
  the explanation first. Turning the walkie off and on again shows it again.
- **Pressing again right after one's own press**: the server asks for a 0.7 s pause (2.5 s after
  a cut, or while a friend who asked goes first) so one child cannot hog the walkie by
  re-pressing; the page quietly asks again every 0.7 s while the button is still held (her
  words are buffered, up to about 1.3 s).
- **Busy is decided twice**: the page knows who is talking (server `talk` notices) and says
  "Mia is talking" without opening the microphone; a true tie (two presses in the same
  millisecond) is decided by the server, and the loser's microphone closes at once.
- **Key M** for hold-to-talk (free in play mode: the game uses WASD, arrows, Space, Shift, C, B,
  E, Q, R, F, V, P, G, Z, X, H, T, 1–9; the piano's keys are A–P and M is not among them).
- **Playback volume** goes through the game's master gain, so the **Quiet** switch silences
  voices too; the music ducks while someone talks; every frame is levelled first (see
  Loudness).
- **Bandwidth**: 16 kHz IMA ADPCM, 80 ms frames: 8,100 B/s per talker measured (about 65 kbit/s),
  relayed once per listener (≤ 3 listeners: ≤ 24 KB/s down from the server per talking game).

## Tests

`npm run test:walkie` (about 11 minutes in SwiftShader; 173 checks in the last run; `--unit-only` for the Node part only, `--no-build`,
`--headed`, `--shots-prefix=walkie`):

- **Review fixes** (2026-09-27), in the same run: a **stranger** who guessed the code (a raw
  socket next to the real `NetSession` host and guest over `WsTransport` and the real server)
  copies Rosie's device id from the room and knocks with it and her name: **not let in**, the
  host gets a normal knock card (the stranger's id is her own server stamp), `hi.ok` false,
  **0 voice bytes** in two presses, her `req` → `no group`; Rosie's page saying "on" without
  `wk:1` gets **0 frames**, with `wk:1` all 12; the **playback chain** in an
  OfflineAudioContext (blast vs. talking, numbers above); the **grown-up check** in its own
  page: 2 wrong answers are saved at once, a reload, 1 more → the pad waits 60 s, another
  reload → still waiting (`walkie-gate-wait.png`). Unit additions: the leveller (a decoded
  full-scale blast ≤ −14 dBFS RMS and ≤ 0.8 peak; talking at −22 dBFS untouched; back to
  full level in 7 frames), saved wrong answers (reload → lock, 2 min second lock, forgotten
  after 10 min), a let-in page with `on` but no `wk` (0 bytes, `no off`; `wk:1` hears; `wk`
  cleared or `0` mid-press: nothing more), fairness (busy → next turn; head start expires),
  header-only and 4 ms frames do not keep the floor, the longer pause after a cut, the junk
  budget (55 no-floor frames fine, past 60 → one 4008 kick; a flooding talker too). The
  relay tests now let 8 pages into the test room (before, the fifth, the "other host", was
  refused by the 4-player limit and never really tested). `npm run test:net` adds the
  server's device stamps, per-address limits (26 connections at once with forged first
  `X-Forwarded-For` entries → 6 refused; 16 codes in a row → 4 refused; joining an existing
  game is not limited), silent drops, and the copied-id rule over the loop transport.
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
--shots-prefix=walkie` (single player: no walkie UI, nothing changed; after the review fixes: `--shots-prefix=walkie2`).

## To check on real devices (headless Chromium cannot)

- **iPhone / iPad Safari**: that the microphone indicator (orange dot) goes off on release; that
  speaker output stays on the loudspeaker (not the earpiece) and at normal volume while and
  after the microphone was open (iOS switches the audio session to play-and-record while
  capturing); that the first press inside a fresh page asks for the microphone as expected.
- Real voices through echo cancellation on a tablet speaker (a friend's voice should not echo
  back when two devices are in the same room; if it does, move them apart).
- Latency end to end (expected about 0.3–0.4 s: 80 ms frames + 160 ms jitter buffer + network).

## Known limits

- The grown-up check protects **this device**. The page decides "voice on" after it; the
  server cannot see the check on other devices and trusts that declaration. What the server
  does enforce: a voice-on page must be a player of that game (let in with a tap), must show
  its walkie to everyone (presence `wk:1`, the badge), and never receives voice without both.
  So the host always sees who can hear and can mute anyone; the grown-ups' guide says so.
- Admission by device id ("Keep playing", a reload): on Railway the id is the server's stamp
  of a per-device secret, so it cannot be copied; a device that was let in once in a session
  comes back without a tap. Anyone with physical access to that device (its `localStorage`)
  is that device. In claude.ai the id is the platform's account id. Only the dev/test loop
  transport still uses a self-declared id (and there the host still never admits by id while
  another page with it is present).
- The per-address limits count the last `X-Forwarded-For` entry. Railway's help forum says
  its edge appends the connecting address there and keeps whatever the client sent in front
  of it (so only the last entry is trustworthy); this was **not** verified on a live Railway
  deployment. If a proxy chain ever puts every player behind one address, set
  `SW_PROXY_HOPS` to the number of proxies or raise the limits. Many addresses (a botnet, many IPv6 /64s) can still try
  codes faster; the host's **Let in!** tap stays the real gate.
- Presence `adm` (the net core's list of let-in friends) is the server's truth for "in the
  game". If the net core ever renames or reshapes it, the walkie fails **closed** (nobody is
  in the game, nobody hears anything) and the unit tests fail.
- Local mutes last for the session (keyed by the friend's device id); so do the host's mutes.
- On a plain `http://` home-network address the browser offers no microphone; the page then
  says "The walkie works on the game's https address."
- On a heavily loaded machine SwiftShader can stall a page for seconds: the end-to-end test
  therefore retries a screenshot or a Mute tap once when a page is slow (and logs the retry).
