# Putting Sparkle World on the internet (Railway)

This guide puts Sparkle World on its own web address, so friends can play together from
their own iPads or computers: one player taps **Friends → Invite** and reads out 4 pictures,
the others tap **Friends → Join** and tap the same 4 pictures. No accounts are needed.

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
| **Source → Branch** | `main` (or the branch you want to play) |
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

## Step 6. Play together

1. On the first device: start or load a world, then **Friends → Invite**. Four big pictures
   appear (for example *heart, star, moon, cat*).
2. On the second device (same web address): **Friends → Join**, tap the same 4 pictures, **Go**.
3. The first device shows a card "**Mia** wants to play!": tap **Come in!**.

Up to 4 players can be in one world. Each device saves its own worlds in its browser, just like
before; nothing is saved on the server.

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
  code is not enough: the player who invited must tap **Come in!** for each friend, one at a
  time. She can **Send home** a friend at any time, and that friend cannot knock again in that
  game.
- **Her world is protected.** By default ("Careful friends"), friends can build and change only
  their own things and natural ground, not the host's houses and furniture. The host can pause
  building, **Undo building** for any friend, and a copy of her world from *before friends
  came* is saved on her device.
- **No chat.** There is no typing to other players at all: only 16 fixed friendly phrases
  ("Hi!", "Let's build!", "Thank you!", …) and dance or wave emotes. Player names go through a
  filter before others see them.
- **No voice, no camera.** The game never uses the microphone or camera, and the server tells
  browsers so (it sends a `Permissions-Policy` that turns them off for this site).
- **No accounts, no personal data.** Nobody signs up; there are no emails or passwords. Each
  device gets a random id so a friend who reloads can come back to her seat.
- **Nothing stored on the server.** A game room exists only in the server's memory while
  friends are playing, and disappears when they leave (or after 10 quiet minutes). The server
  does not save worlds, names, pictures or messages, and does not log what happens in games.
- **Limits.** At most 4 players per game, 500 games at a time, and 12 connections from one
  home internet address. Other websites cannot connect to your game server.
- **The web address is public.** Anyone who has the address can open the game (just like any
  website) and could try codes, but still needs a **Come in!** from the host. Share the
  address only with the families you play with, and you can remove it any time (step 9).

---

## If something goes wrong

| What you see | What to do |
|---|---|
| Build fails with `esbuild: not found` or `Cannot find module 'esbuild'` | In **Variables**, add `NPM_CONFIG_PRODUCTION` = `false`, then redeploy. |
| Build fails right away with "no start command" or wrong files | Check **Root Directory** is exactly `sparkle-world` (step 3). |
| Deployment fails at "Healthcheck" | Check the build command is `npm run build` (the game must be built before it starts). Look at the Deploy Logs for `dist/sparkle-world.html is missing`. |
| The page opens but there is no **Friends** button | Open `/api/net` on your address; it should show `{"ok":true,...}`. If it does, reload the game page. |
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
