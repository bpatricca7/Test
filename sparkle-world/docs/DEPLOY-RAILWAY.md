# Putting Sparkle World on the internet (Railway)

This guide puts Sparkle World on its own web address, so friends can play together from
their own iPads or computers: one player taps **Play with Friends → Make a Code** and reads out
4 pictures, the others tap **Play with Friends → Join a Code** and tap the same 4 pictures. No
accounts are needed.

You do not need to know how to program. It takes about 20 minutes the first time.

---

## What you need

- The GitHub account that owns the repository **bpatricca7/Test** (the game lives in its
  `sparkle-world` folder).
- A credit card for Railway's **Hobby plan: $5 per month**. That $5 includes $5 of server use
  every month. A small family game server like this one normally stays inside it, so the bill
  is usually just the $5. (If it ever uses more, Railway charges the difference; step 8 shows
  how to set a spending limit.)

---

## Step 1. Create a Railway account

1. Go to **https://railway.com** and click **Login** (top right).
2. Choose **Login with GitHub** and approve. Use the GitHub account that owns bpatricca7/Test.
3. Railway asks you to pick a plan: choose **Hobby** and add your card.

## Step 2. Make a project from the GitHub repository

1. On the Railway dashboard click **New Project** (or **+ New**).
2. Choose **Deploy from GitHub repo**.
3. The first time, Railway asks to install its GitHub app. Allow it for the repository
   **bpatricca7/Test** (you can choose "Only select repositories").
4. Pick **bpatricca7/Test**. Railway creates a *service* and starts a first build. That first
   build may fail, because it does not know the game is in a folder yet. That is fine: fix it
   in the next step.

## Step 3. Tell Railway where the game is and how to start it

Click the new service (the box with the repository name), then open its **Settings** tab.

| Setting (where) | Set it to |
|---|---|
| **Source → Root Directory** | `sparkle-world` |
| **Source → Branch** | `claude/girl-game-world-building-gp6bnl` (the game's branch today; if you later merge it into `main`, switch this to `main`) |
| **Build → Custom Build Command** | `npm run build` |
| **Deploy → Custom Start Command** | `npm start` |
| **Deploy → Healthcheck Path** | `/healthz` |
| **Deploy → Replicas** (if shown) | `1` (important: all friends in a game must reach the same server) |

Railway saves each field when you click outside it or press the check mark. Then click
**Deploy** (or the purple **Apply changes** bar at the top) to start a new build.

*Shortcut for later:* the folder also has a `railway.json` file with the same build, start
and health-check settings. You only need it if you want Railway to read the settings from
the repository: in **Settings → Config-as-code → Railway Config File**, enter
`/sparkle-world/railway.json` (the full path; Railway does not look inside the Root Directory
for it). Setting the fields by hand as above works just as well.

## Step 4. Watch it build

Open the **Deployments** tab. The newest deployment shows *Building*, then *Deploying*, then
**Active** (green), usually within 2–3 minutes. If it turns red, see *If something goes wrong*
below.

## Step 5. Give it a web address

1. In **Settings → Networking**, click **Generate Domain**.
2. Railway shows an address like `https://sparkle-world-production.up.railway.app`.
3. Open it in Safari or Chrome. The Sparkle World title screen should appear.
4. Optional check: add `/healthz` to the address. The page should say `{"ok":true}`.

On an iPad you can tap the Share button → **Add to Home Screen** so it opens like an app.

### Bring her worlds over from the claude.ai version (optional)

Worlds are saved per website, so worlds made on the claude.ai link don't appear on the Railway
address by themselves (and the other way round). To move one, about 10 seconds per world:

1. Open the game on claude.ai → **My Worlds** → on the world's card tap **Save** (the download arrow; it saves the world to a file).
2. Open the Railway address → **My Worlds** → **Open a file** → pick that file.

Her outfits and stickers stay with each website; she can dress up again in a minute.

## Step 6. Play together

1. On the first device, on the title screen: **Play with Friends → Make a Code** (it opens
   the last world). Or, inside a world: **Menu → Invite Friends**. Four big pictures appear
   (for example *heart, star, moon, cat*). **Say it** reads them out loud.
2. On the second device (same web address): **Play with Friends → Join a Code**, tap the same
   4 pictures, **Go!**.
3. The first device shows a card "**Mia** wants to play!": tap **Let in!** (or **Not now**).

Up to 4 players can be in one world. Each device saves its own worlds in its browser, just like
before; nothing is saved on the server.

While playing together:

- The **Players** button (two kids, with how many are playing) shows the code again and who
  is here, each in her own color. The player who invited can **Undo building** for one friend,
  **Send home** a friend, switch **Friends can build** and **Careful friends** (on: friends
  cannot change her things), and **Stop playing**.
- **Say** (a speech bubble, or the T key) has 16 happy words ("Hi!", "Let's build!", "Thank
  you!", ...). There is no typing.
- **Walkie-talkie** (only if a grown-up turned it on for that device, see below): hold the big
  walkie button (or the M key) and talk; let go and it stops. Everyone in the game whose walkie
  is on hears it, one talker at a time, at most 15 seconds per press.
- After a reload (or a new version), the title shows **Keep playing** on the device that
  invited and **Join Lily** (her name) on her friends' devices for a while: one tap each and
  everyone is back together.
- When she stops, her world is saved; **Before friends** (on the goodbye card, and on the
  world in **My Worlds** for a week) puts the world back to how it was before friends came.

### The walkie-talkie (for grown-ups)

The walkie-talkie is **off** until a grown-up turns it on, separately on each device:

1. On the title screen (or **Menu** inside a world) tap **Settings**, scroll to
   **Walkie-talkie (grown-ups)** and tap its switch.
2. Answer the multiplication question on the number pad (for example *17 × 8*). Three wrong
   answers make it wait one minute.
3. The first time she presses the walkie button, a card explains the microphone; tap **OK**, and
   **Allow** if the browser asks.

Turning it off is one tap on the same switch (no question). A device whose walkie is off never
receives anyone's voice and never sends any; she just sees a small "Walkie off" badge when her
friends use theirs. In the **Players** panel every player can **Mute** anyone for herself, and
the player who invited can **Mute** a friend for everyone or switch on **Mute everyone**.

The microphone only works on the real web address (https) or on `localhost`; browsers block it
on plain `http://192.168…` home-network addresses. The walkie-talkie does not exist in the
claude.ai version of the game.

The in-game "Friends" (the girls you can invite from the Bag) are something else: they live in
your own world. Real people are always "Players".

## Step 7. Updates

Every time new code is pushed to the branch from step 3, Railway builds and starts the new
version by itself (1–3 minutes). The old version keeps running until the new one is healthy.

- Players who are in a game at that moment are disconnected for a moment and reconnect by
  themselves.
- If a player then sees **"Your game needs a refresh!"**, everyone reloads the page (the host
  too): all players must run the same version.
- Easiest: push updates when nobody is playing.

## Step 8. Logs, usage and a spending limit

- **Logs:** click the service → **Deployments** → the active deployment → **View Logs**.
  *Build Logs* show the build; *Deploy Logs* show the running server. You should see a line like
  `Sparkle World server listening on port 8080 (build 1a2b3c4d, 564 KB gzip)` and, every 15
  minutes when something changed, `rooms=1 players=2`. The server never writes down what
  children do or say in the game.
- **Usage:** the project's **Usage** page (or your account's **Usage**) shows this month's cost.
- **Spending limit:** in your account's **Usage** page you can set a hard limit (for example
  $10). If it is ever reached, Railway stops the service instead of charging more.
- **Saving money (optional):** in **Settings → Deploy**, turning on **Serverless** (it may be
  called "App Sleeping") lets the server sleep when nobody has used it for a while. The first
  visit afterwards takes a few extra seconds.

## Step 9. Turning it off

- To take the game offline for a while: **Settings → Networking**, remove the domain.
- To remove it for good: **Settings → Danger → Delete Service**. Nothing else is lost: the
  worlds live on the children's devices.

---

## Is it safe for kids?

- **A code, then a yes.** A game is found with 4 pictures (20,736 possible codes). Knowing the
  code is not enough: the player who invited must tap **Let in!** for each friend, one at a
  time. She can **Send home** a friend at any time, and that friend cannot knock again in that
  game.
- **Her world is protected.** By default ("Careful friends"), friends can build and change only
  their own things and natural ground, not the host's houses and furniture. The host can pause
  building, **Undo building** for any friend, and a copy of her world from *before friends
  came* is saved on her device.
- **No chat.** There is no typing to other players at all: only 16 fixed friendly phrases
  ("Hi!", "Let's build!", "Thank you!", …) and dance or wave emotes. Player names go through a
  filter before others see them.
- **Voice only by walkie-talkie, only with a grown-up's OK on that device.** It is off until a
  grown-up answers a multiplication question in Settings, and each device needs its own OK to
  talk *and* to hear (a device without it receives no voice at all). The microphone is on only
  while the button is held (at most 15 seconds, one talker at a time) and turns off the moment
  it is let go. Voices go live only to the players of that one game: the player who invited
  and the friends she let in, never to someone still knocking or sent home. **Nothing is
  recorded or stored**, on the devices or on the server, and the server does not log voices.
  The player who invited can mute a friend or everyone; every child can mute anyone for
  herself.
- **No camera.** The game never uses the camera; the server's `Permissions-Policy` allows the
  microphone for this site only (for the walkie-talkie) and turns the camera, location and
  payments off.
- **No accounts, no personal data.** Nobody signs up; there are no emails or passwords. Each
  device gets a random id so a friend who reloads can come back to her seat.
- **Nothing stored on the server.** A game room exists only in the server's memory while
  friends are playing, and disappears when they leave (or after 10 quiet minutes). The server
  does not save worlds, names, pictures or messages, and does not log what happens in games.
- **Limits.** At most 4 players per game, 500 games at a time, and 12 connections from one
  home internet address. Other websites cannot connect to your game server.
- **The web address is public.** Anyone who has the address can open the game (just like any
  website) and could try codes, but still needs a **Let in!** from the host. Share the
  address only with the families you play with, and you can remove it any time (step 9).

---

## If something goes wrong

| What you see | What to do |
|---|---|
| Build fails with `esbuild: not found` or `Cannot find module 'esbuild'` | In **Variables**, add `NPM_CONFIG_PRODUCTION` = `false`, then redeploy. |
| Build fails right away with "no start command" or wrong files | Check **Root Directory** is exactly `sparkle-world` (step 3). |
| Deployment fails at "Healthcheck" | Check the build command is `npm run build` (the game must be built before it starts). Look at the Deploy Logs for `dist/sparkle-world.html is missing`. |
| The page opens but there is no **Play with Friends** button | Open `/api/net` on your address; it should show `{"ok":true,...}`. If it does, reload the game page. |
| "Lots of games right now!" | The server is at its limit (500 games, or 12 devices on one home connection). Wait a minute. |
| "Your game needs a refresh!" | Reload the page on every device (a new version was published). |
| Friends are "Reconnecting…" often | Usually home Wi-Fi. The game keeps working and catches up when the connection returns. |

### Settings for grown-ups who like knobs (optional)

Add these in the service's **Variables** tab (then redeploy):

| Variable | Default | Meaning |
|---|---|---|
| `SW_MAX_ROOMS` | 500 | games at the same time |
| `SW_MAX_PER_IP` | 12 | connections from one internet address |
| `SW_IDLE_MS` | 600000 | close a game after this many quiet milliseconds (10 min) |
| `SW_ALLOWED_ORIGINS` | *(empty)* | extra web addresses allowed to connect, comma separated (only needed if you serve the page from a different domain than the server) |

Railway sets `PORT` by itself; do not change it.

---

## Try it on your own computer first (optional)

You need Node.js 22 or newer. In a terminal, in the `sparkle-world` folder:

```
npm ci
npm run build
npm start
```

Then open **http://localhost:8080** twice: once in a normal browser window and once in a
private (incognito) window, so the game treats them as two different devices. Make a code in
one window and join it from the other. Friends on the same home Wi-Fi can use your computer's
address instead of `localhost` (for example `http://192.168.1.20:8080`). Stop the server with
Ctrl+C.

Automatic checks (for grown-ups who change the code):

| Command | What it checks |
|---|---|
| `npm run test:net` | the multiplayer code on its own, with lost and late messages (about 2 minutes) |
| `npm run test:walkie` | the walkie-talkie: sound coding, the server's rules (who may hear, one talker, 15 seconds, mutes) and three browsers with a pretend microphone through this same server (about 10 minutes) |
| `npm run probe:railway` | builds the game, starts this same server on a free port, and three headless browsers (a computer, an iPad and a phone) make a code, join it through the real screens and build together; then the server is killed and started again (everyone reconnects by themselves) and finally killed for good (everyone gets a friendly "Playing together stopped." card). About 6 minutes. |
| `npm run probe:mp` | the same game inside claude.ai (a pretend claude.ai room): every screen, knocking, building, Undo building, Send home, sleep, pets, zip lines, reloads, a new version, lost messages, and the size and speed limits. About 25 minutes. |
