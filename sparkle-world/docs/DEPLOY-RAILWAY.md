# Putting Sparkle World on the internet (Railway)

This guide puts Sparkle World on its own web address, so friends can play together from
their own iPads or computers: one player taps **Play with Friends → Make a Code** and reads out
4 pictures, the others tap **Play with Friends → Join a Code** and tap the same 4 pictures. No
accounts are needed. (Family accounts and the $5.99 Family Plan are a separate, later step:
**Part 2** at the end. Until you turn them on, nothing of them runs.)

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
| **Deploy → Restart Policy** | `Always` (if the server ever stops, Railway starts it again, however often) |
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
3. Open it in Safari or Chrome. The Sparkle World **home page** appears (the page for
   grown-ups and kids that shows what's inside, with a big **Play now** button).
4. Tap **Play now**: the game's title screen appears. The game's own address is the home page
   address with `/play` at the end, for example
   `https://sparkle-world-production.up.railway.app/play`.
5. Optional check: add `/healthz` to the address. The page should say `{"ok":true}`.
6. Optional, for link previews: when you text the address to another family, the message can
   show a picture of the game. That needs the address to be known while building, so once the
   domain exists, open **Deployments** and click **Redeploy** on the newest one (Railway then
   gives the build its `RAILWAY_PUBLIC_DOMAIN`). The Build Logs then show a
   `link preview tags` line with your address.

| Address | What it shows |
|---|---|
| `https://<your address>/` | the home page |
| `https://<your address>/play` | the game |
| `https://<your address>/parents` | safety and privacy, in plain words |
| `https://<your address>/healthz` | `{"ok":true}` (Railway's health check) |

On an iPad, open the game (**Play now**, or the `/play` address), then tap the Share button →
**Add to Home Screen** so it opens like an app, straight into the game. If you added the plain
address to the Home Screen before the home page existed, it now opens the home page: tap
**Play now**, or add the icon again from `/play`. Her worlds are not affected: they are saved
per website, and the home page and the game are the same website.

### Bring her worlds over from the claude.ai version (optional)

Worlds are saved per website, so worlds made on the claude.ai link don't appear on the Railway
address by themselves (and the other way round). To move one, about 10 seconds per world:

1. Open the game on claude.ai → **My Worlds** → on the world's card tap **Save** (the download arrow; it saves the world to a file).
2. Open the Railway address → **My Worlds** → **Open a file** → pick that file.

Her outfits and stickers stay with each website; she can dress up again in a minute.

### Keeping her worlds safe

Her worlds are saved **in the browser on her device**, not on the server (the server keeps
nothing, on purpose: no accounts and no children's data on it). A browser can clear what a
website saved: when the device runs short of space, when someone clears the browser's website
data, and Safari on iPhone and iPad clears a website's saved data after about **7 days in
which the website was not opened**. So the game does three things, and you can do one:

- **It asks the browser to keep her worlds** ("persistent storage"). There is nothing to tap.
  (Firefox may ask you once whether the site may store data: tap **Allow**.)
- **It reminds her to make a copy.** When no copy was made for a week and the browser does not
  promise to keep her worlds (or it is Safari on an iPhone or iPad), the title screen shows
  *"It's been a while! Save a copy of your worlds?"*. **Save a copy** saves one file with every
  world, her look, outfits and stickers; **Not now** asks again in a week. It never interrupts
  playing.
- **You can make a copy any time:** **My Worlds → Save all** (only on this website). The file is
  called for example `Sparkle World backup 2026-09-28.json`. On an iPad or iPhone, Safari asks
  whether to download it: tap **Download**; it goes to the **Files** app, in **Downloads**.
  Keep it somewhere safe (for example move it to iCloud Drive, or email it to yourself).
- **To bring them back** (a new iPad, or after the browser cleared them): open the game →
  **My Worlds → Open a file** → pick the file. Her worlds, look, outfits, stickers and coins
  come back. If a world in the file is already on the device and different, the game asks which
  one to keep (**Keep the one here**, **Use the one in the file** or **Keep both**): it never
  replaces one without asking. The file does not carry the device's settings (for example the
  walkie-talkie stays off on a new device until a grown-up turns it on there).

## Step 6. Play together

1. On the first device, on the title screen: **Play with Friends → Make a Code** (it opens
   the last world). Or, inside a world: **Menu → Play Together → Make a Code**. Four big
   pictures appear (for example *heart, star, moon, cat*). **Say it** reads them out loud.
   The first time a device plays together, it asks **"What's your name?"** so friends see
   who is knocking.
2. On the second device, open the same web address and tap **Play now** (or open the `/play`
   address directly), then **Play with Friends → Join a Code**, tap the same 4 pictures, **Go!**.
3. The first device shows a card "**Mia** wants to play!": tap **Let in!** (or **Not now**).

Up to 4 players can be in one world. Each device saves its own worlds in its browser, just like
before; nothing is saved on the server.

While playing together:

- The **Players** button (a game pad, with how many are playing) shows the code again and
  who is here, each in her own color. The player who invited can **Undo building** for one
  player (that player is told kindly), **Send home** a player, switch **Players can build**
  and **Careful players** (on: the others cannot change her things, but may still water her
  garden and eat treats on her tables), and **Stop playing**.
- **Say** (a speech bubble, or the T key) has 16 happy words ("Hi!", "Let's build!", "Thank
  you!", ...). There is no typing.
- **Walkie-talkie** (only if a grown-up turned it on for that device, see below): hold the big
  walkie button (or the M key) and talk; let go and it stops. Everyone in the game whose walkie
  is on hears it, one talker at a time, at most 15 seconds per press.
- After a reload (or a new version), the title shows **Keep playing** on the device that
  invited and **Join Lily** (her name) on her friends' devices for a while: one tap each and
  everyone is back together. If she taps **Play** instead, her world asks "Your friends are
  waiting! Open your door again?".
- When she stops, her world is saved; **Before friends** (on the goodbye card, and as a small
  button on the world in **My Worlds**, with the day of the copy) puts the world back to how
  it was before friends came, and an **Undo** on the card after takes that back. It is only
  offered until she builds on her own in that world again (then going back would take her
  own building away too), and for at most a week.

### The walkie-talkie (for grown-ups)

The walkie-talkie is **off** until a grown-up turns it on, separately on each device:

1. On the title screen (or **Menu** inside a world) tap **Settings**, scroll to
   **Walkie-talkie (grown-ups)** and tap its switch.
2. Answer the multiplication question on the number pad (for example *17 × 8*). Three wrong
   answers make it wait one minute (the next time two minutes, up to ten). Closing the
   question or reloading the page does not skip the wait.
3. The first time she presses the walkie button, a card explains the microphone; tap **OK**, and
   **Allow** if the browser asks.

Turning it off is one tap on the same switch (no question). A device whose walkie is off never
receives anyone's voice and never sends any; she just sees a small "Walkie off" badge when her
friends use theirs. In the **Players** panel every player has a badge: **walkie** (this device
can hear and talk) or **walkie off** (it cannot; the server checks this badge before it sends a
single voice). Every player can **Mute** anyone for herself, and the player who invited can
**Mute** a friend for everyone or switch on **Mute everyone**. A friend's voice is never played
much louder than normal talking: shouting or a loud noise is turned down before it plays.

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
  `Sparkle World server listening on port 8080 (build 1a2b3c4d, 564 KB gzip)`, then
  `home page at /, the game at /play (…)` and, every 15 minutes when something changed,
  `rooms=1 players=2`. The server never writes down what
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
  time. Until then the server shows the knocking device nothing of the game (no names, no
  world, no messages, no voices). She can **Send home** a friend at any time, and that device
  cannot knock again in that game. The server slows down anyone who tries codes one after
  another (a few new games per minute from one internet address), so trying the codes from
  one home takes many hours.
- **Her world is protected.** By default ("Careful players"), friends can build and change only
  their own things and natural ground, not the host's houses and furniture. The host can pause
  building, **Undo building** for any friend, and a copy of her world from *before friends
  came* is saved on her device.
- **No chat.** There is no typing to other players at all: only 16 fixed friendly phrases
  ("Hi!", "Let's build!", "Thank you!", …) and dance or wave emotes. Player names go through a
  filter before others see them.
- **Voice only by walkie-talkie, only with a grown-up's OK on that device.** It is off until a
  grown-up answers a multiplication question in Settings. The question protects **this
  device**: each family's grown-up decides for their own child's device, and nobody else's
  answer turns yours on. The server cannot see that question (a changed copy of the page could
  skip it on its own device), so here is what the server itself checks: voices go only to
  players who show **walkie** in the Players panel (a device showing **walkie off** receives
  no voice at all and cannot talk), and only to the players of that one game, the player who
  invited and the friends she let in with a tap (the same check that decides who may see
  names and the world), never to someone still knocking or sent home. So the player who
  invited always sees who can hear, and can **Mute** a friend for everyone or switch on
  **Mute everyone**; every child can mute anyone for herself. The microphone is on only while
  the button is held (at most 15 seconds, one talker at a time, and a friend who is waiting
  goes next) and turns off the moment it is let go. **Nothing is recorded or stored**, on the
  devices or on the server, and the server does not log voices. Loud shouting from a friend
  is turned down before it plays. The walkie exists only on this website version, not inside
  claude.ai. The game can also read its own words out loud for early readers (Settings,
  *Read words out loud*, off at first).
- **No camera.** The game never uses the camera. The server's `Permissions-Policy` turns the
  camera, location and payments off for this site, and allows the microphone only on the
  game page, only for this site (for the walkie-talkie); the home page may not use it.
- **No accounts, no personal data** (without Part 2). Nobody signs up; there are no emails or
  passwords. Each
  device keeps a random secret so a friend who reloads can come back to her seat; the
  server turns it into a different stamp in every game, so no one can follow a device from
  game to game, and no one can pretend to be another device.
- **Nothing stored on the server** (without Part 2). A game room exists only in the server's
  memory while
  friends are playing, and disappears when they leave (or after 10 quiet minutes). The server
  does not save worlds, names, pictures, messages or voices, and does not log what happens in
  games.
- **With family accounts (Part 2)** the server keeps, with a parent's permission, the parent's
  email, each child's nickname, avatar picture, progress and worlds (the family's cloud copy),
  which the parent can see, download and delete on the Family page. Messages and voices are still
  never stored. Playing with friends and the walkie-talkie are switches per child, off at first,
  and the server enforces them: a child whose switch is off cannot join, and a switch turned off
  reaches a game in progress within a second. At most 12 connections per family.
- **Limits.** At most 4 players per game, 500 games at a time, 12 connections and 6 games
  from one home internet address, and new connections and new games are slowed down if one
  address keeps opening them (someone trying code after code). Other websites cannot connect
  to your game server or show the game inside their own pages. One broken or unkind message
  cannot stop the server.
- **The web address is public.** Anyone who has the address can open the game (just like any
  website) and could try codes, but still needs a **Let in!** from the host. **Share the
  address only with the families you know**, and you can remove it any time (step 9).

---

## If something goes wrong

| What you see | What to do |
|---|---|
| Build fails with `esbuild: not found` or `Cannot find module 'esbuild'` | In **Variables**, add `NPM_CONFIG_PRODUCTION` = `false`, then redeploy. |
| Build fails right away with "no start command" or wrong files | Check **Root Directory** is exactly `sparkle-world` (step 3). |
| Deployment fails at "Healthcheck" | Check the build command is `npm run build` (the game must be built before it starts). Look at the Deploy Logs for `dist/sparkle-world.html is missing`. |
| The page opens but there is no **Play with Friends** button | Open `/api/net` on your address; it should show `{"ok":true,...}`. If it does, reload the game page. |
| The address shows the game instead of the home page | The home page was not built (the Build Logs show a `dist/site/` line when it is). Check the build command is `npm run build`. The game still works at `/` and at `/play` meanwhile. |
| "Lots of games right now!" | The server is at its limit (500 games, 12 devices or 6 games on one home connection, or very many new games or wrong codes from one home connection in a short time). Wait a minute. |
| "Your game needs a refresh!" | Reload the page on every device (a new version was published). |
| Friends are "Reconnecting…" often | Usually home Wi-Fi. The game keeps working and catches up when the connection returns. |

### Settings for grown-ups who like knobs (optional)

Add these in the service's **Variables** tab (then redeploy):

| Variable | Default | Meaning |
|---|---|---|
| `SW_MAX_ROOMS` | 500 | games at the same time |
| `SW_MAX_PER_IP` | 12 | connections from one internet address |
| `SW_ROOMS_PER_IP` | 6 | games one internet address may have started at the same time |
| `SW_CONNECT_RATE` / `SW_CONNECT_BURST` | 1 / 30 | new connections per second from one address, and how many may come at once |
| `SW_ROOMS_PER_MIN` / `SW_ROOMS_BURST` | 20 / 12 | new games per minute from one address, and how many may come at once (a wrong code counts as a new game; joining a game that is there does not) |
| `SW_TRUST_PROXY` | on | set to `0` only if the server is NOT behind Railway's (or another) proxy; behind one (a connection from a private address or Railway's 100.0.0.0/8), the address counted is the right-most public one in `X-Forwarded-For` (the one the proxy saw; only private, link-local and 100.64.0.0/10 hops are skipped there, because the rest of 100.x is ordinary home addresses). An IPv6 address counts by its /64 (one home) |
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

Then open **http://localhost:8080** for the home page, and **http://localhost:8080/play** for
the game. Open the game twice: once in a normal browser window and once in a private
(incognito) window, so the game treats them as two different devices. Make a code in one
window and join it from the other. Friends on the same home Wi-Fi can use your computer's
address instead of `localhost` (for example `http://192.168.1.20:8080`). Stop the server with
Ctrl+C.

Automatic checks (for grown-ups who change the code):

| Command | What it checks |
|---|---|
| `npm run test:net` | the multiplayer code on its own, with lost and late messages (about 2 minutes) |
| `node tools/site-check.mjs` | builds, starts this same server, and checks the home page at phone (360 and 390 px wide), iPad and computer sizes, and on phones again with the font blocked (no errors, nothing loaded from other sites, no sideways scrolling, every picture and link, the picture-code demo), that **Play now** opens the game at `/play`, and the page's headers. Screenshots go to `.shots/site-*.png`. About 4 minutes. |
| `npm run test:walkie` | the walkie-talkie: sound coding, the server's rules (who may hear, one talker, 15 seconds, mutes) and three browsers with a pretend microphone through this same server (about 10 minutes) |
| `npm run probe:railway` | builds the game, starts this same server on a free port, and three headless browsers (a computer, an iPad and a phone) make a code, join it through the real screens and build together; then the server is killed and started again (everyone reconnects by themselves) and finally killed for good (everyone gets a friendly "Playing together stopped." card). About 6 minutes. |
| `node tools/probe-keepsafe.mjs` | over this same server: the browser is asked to keep her worlds, the "Save a copy of your worlds?" card (after a week, "Not now", never while playing), the backup file and opening it on a new device (worlds and look come back, a world that is already there is only replaced after asking), on a computer, iPad and iPhone; nothing of it inside claude.ai or from a file on the computer. About 3 minutes. |
| `node tools/probe-net-ux.mjs` | over this same server: the name question on a new device, Play Together, what a knocking device can see, building paused and on again, Undo building told kindly, a host reload ("Your friends are waiting!"), Before friends and its Undo. About 5 minutes. |
| `npm run probe:mp` | the same game inside claude.ai (a pretend claude.ai room): every screen, knocking, building, Undo building, Send home, sleep, pets, zip lines, reloads, a new version, lost messages, and the size and speed limits. About 25 minutes. |
| `npm run test:accounts`, `npm run test:billing`, `npm run test:saves` | family accounts (Part 2): sign-in, the Family Plan and Stripe (a pretend Stripe, never the real one), cloud saves. They need Postgres on the computer (or `SW_TEST_DATABASE_URL`). A few minutes each. |
| `npm run e2e:accounts` | family accounts end to end in Chromium: sign up, the plan, kids' devices, worlds on two devices, playing together, the walkie switch, a failed payment, deleting a child and the account. About 20 minutes. |
| `npm run dev:accounts` | try Part 2 on your computer: `http://localhost:8080/account` with a local database and the pretend Stripe; the emails (with their codes) are printed in the terminal. `npm run dev:accounts -- --fake --seed` needs no database at all. |

`node tools/site-check.mjs` also builds the pages for `SW_ACCOUNTS=required` and `optional` and
checks them, and the Family page in every state, at phone, iPad and computer sizes
(`.shots/site-acct-*.png`).

---

# Part 2: family accounts and the Family Plan

Everything above works with **no accounts at all**, and stays exactly like that until you set
the variable `SW_ACCOUNTS`. This part turns on the **Family Plan** ($5.99 a month, plus sales tax
where it applies): grown-ups sign in on the **Family page** (`/account`), add their kids,
worlds are saved in the family's cloud copy, and playing with friends and the walkie-talkie are
switched on per child. The whole design is in `docs/ACCOUNTS.md`; this is the checklist of the
things only you can do (its §14), step by step.

**Do it twice.** First everything in **Stripe test mode on a `staging` copy** of the game (steps
10–17), with your own email and the test card `4242 4242 4242 4242`. Only when that works, repeat
it in **live mode for production** (step 18). Nothing is ever charged in test mode.

It takes an afternoon the first time, plus waiting for the domain and the email provider.

## Step 10. A domain

The Family Plan needs a web address of your own (emails come from it, and it looks trustworthy).

1. Buy one at a registrar (for example `sparkleworld.fun`, about $10–20 a year). Turn on **2FA**
   (a code on your phone at sign-in) at the registrar straight away.
2. Railway → the game service → **Settings → Networking → Custom Domain** → type the domain.
   Railway shows a **CNAME** record.
3. At the registrar, in the domain's **DNS** settings, add that CNAME record. After a few minutes
   (sometimes an hour) Railway shows a green check and `https://<domain>` opens the home page.

## Step 11. Railway: a database, and a staging copy

1. In the project: **+ New → Database → Add PostgreSQL**. A **Postgres** box appears.
2. Click the **game service → Variables → New Variable**: name `DATABASE_URL`, value
   `${{Postgres.DATABASE_URL}}` (type it exactly like that; Railway fills in the private address).
3. Click the **Postgres** box → **Backups** (if your plan offers it): daily, keep 7.
4. Keep the game service's **Settings → Deploy → Replicas** at `1`, and turn **Serverless / App
   Sleeping off**: payments (webhooks), emails and the daily jobs need a server that is awake.
   Keep your spending limit (step 8).
5. **Environments** (the name at the top, `production`) → **New Environment** → **Duplicate
   production**, name it `staging`. It gets its own Postgres and its own `…up.railway.app`
   address (**Settings → Networking → Generate Domain** in staging). Steps 12–17 happen in
   **staging**.

## Step 12. The email provider

Sign-in codes are emailed. Resend is free at family scale (3,000 emails a month); Postmark works
the same way (it approves new accounts before they can send).

1. Make an account (with 2FA). **Domains → Add domain** → your domain.
2. It shows DNS records (DKIM and SPF; Postmark also a Return-Path). Add each one at the
   registrar, exactly as shown. Also add a **DMARC** record, for example a TXT record named
   `_dmarc` with the value `v=DMARC1; p=quarantine; rua=mailto:<your email>`.
3. In the provider's settings: **open tracking off, click tracking off**, and the shortest message
   retention offered.
4. **API Keys → Create** a key with "sending access" only. Copy it (you need it in step 14).

## Step 13. Stripe (in test mode first)

Turn on **2FA** in Stripe first. Make sure the switch at the top says **Test mode**.

1. **Settings → Public details:** name `Sparkle World`, a support email, **Terms of service**
   `https://<domain>/terms`, **Privacy policy** `https://<domain>/privacy`, statement descriptor
   (what appears on card statements) `SPARKLEWORLD`.
2. **The plan.** On your computer, in the `sparkle-world` folder, with a *full* test secret key
   (Developers → API keys → **Secret key**, `sk_test_…`; only for this one command, never in
   Railway):

   ```
   STRIPE_SECRET_KEY=sk_test_… npm run stripe:setup
   ```

   It makes the product **Sparkle World Family Plan**, the one price ($5.99 a month, tax
   "exclusive": tax is added on top) and the Customer Portal settings, and prints two lines,
   `STRIPE_PRICE_ID=price_…` and `STRIPE_PORTAL_CONFIG=bpc_…`. Keep them for step 14. Running it
   again changes nothing.
3. **Tax:** Settings → **Tax** → turn on Stripe Tax, set your origin address, and for the product
   pick the tax code for a personal-use online game or digital subscription (check it with your
   accountant, and add a registration for your home state if the accountant says so).
4. **Billing → Customer portal:** update payment method on, invoice history on, **cancel at end
   of billing period** with the reason survey; plan switching off, quantity off, email editing
   off. (The setup script did this; check it looks like that.)
5. **Billing → Subscriptions and emails:** successful payment receipts, failed payment emails,
   trial-ending reminders and expiring-card emails **on**. Under "Manage failed payments": Smart
   Retries, then **cancel the subscription** when all retries fail.
6. **Radar:** leave the defaults. (Optionally, if your plan allows custom rules, `Block if
   :card_country: != 'US'`.)
7. **Developers → Webhooks → Add endpoint:** URL `https://<your staging address>/api/stripe/webhook`,
   API version **`2026-08-26.dahlia`**, events: `checkout.session.completed`,
   `customer.subscription.created`, `customer.subscription.updated`,
   `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`,
   `charge.dispute.created`, `customer.deleted`. Save, then **Reveal** the signing secret
   (`whsec_…`) and copy it.
8. **Developers → API keys → Create restricted key** (name it "Sparkle World server"):
   **Customers: write, Checkout Sessions: write, Subscriptions: write, Customer portal: write,
   Invoices: read, Prices: read, Events: read.** Nothing else. Copy the key (`rk_test_…`).

## Step 14. Railway Variables

In **staging**, the game service → **Variables → Raw Editor**, paste and fill in (one per line):

| Variable | Value |
|---|---|
| `SW_ACCOUNTS` | `required` on staging (see step 18 for production) |
| `NODE_ENV` | `production` |
| `PUBLIC_ORIGIN` | `https://<the staging address>` (production: `https://<domain>`), nothing after it |
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (from step 11) |
| `SW_SECRET` | a long random secret: run `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` and paste what it prints |
| `STRIPE_SECRET_KEY` | the **restricted** key from step 13.8 (`rk_test_…`) |
| `STRIPE_WEBHOOK_SECRET` | `whsec_…` from step 13.7 |
| `STRIPE_PRICE_ID` | `price_…` from step 13.2 |
| `STRIPE_PORTAL_CONFIG` | `bpc_…` from step 13.2 |
| `MAIL_MODE` | `resend` (or `postmark`) |
| `MAIL_API_KEY` | the key from step 12 |
| `MAIL_FROM` | `Sparkle World <hello@<domain>>` |
| `SW_OPERATOR_NAME` | who runs Sparkle World (your name, or your small LLC) |
| `SW_OPERATOR_EMAIL` | the email parents can write to |
| `SW_OPERATOR_ADDRESS` | a mailing address (a PO box or an LLC's address keeps your home address private) |
| `SW_OPERATOR_PHONE` | a phone number for parents |

The operator lines are printed on `/privacy`, `/terms` and in emails: the children's privacy law
(COPPA) requires them. Railway passes the Variables to the build too, so the pages are built with
them (the Build Logs warn about any that is missing).

Optional, only if you want other than the family's decisions: `SW_TRIAL_DAYS` (0: no free
trial), `SW_FRIENDS_MODE` (`subscription`: each friend's family has the plan), `SW_MP_CONSENT`
(`verified`), `SW_GRACE_DAYS` (7), `SW_RETAIN_DAYS` (90), `SW_SELL_COUNTRIES` (`US`),
`SW_MAX_PER_FAMILY` (12 connections), and `SW_REQUIRED_FROM` (the date the home page announces
while `SW_ACCOUNTS=optional`, for example `2026-11-02`).

**Never** set `SW_TEST` or `STRIPE_API_BASE` on Railway: they are for the automatic tests, and the
server refuses to start with them in production.

Click **Deploy**. In the Deploy Logs you should see a line like
`accounts: required, friends subscription, consent verified, trial 0 d, …, stripe test, db postgres`
and then `Sparkle World server listening …`. If a variable is wrong, the new deployment stops with
**one line** that names it (for example `SW_SECRET must be at least 32 random bytes`) and the old
deployment keeps running: fix the variable and deploy again.

## Step 15. The legal part

1. Open `https://<staging address>/privacy` and `/terms` and check your operator details.
2. Have a lawyer who works on children's privacy (COPPA) read `/privacy`, `/terms`, the notice the
   Family page shows before a child plays, and the two questions in `docs/ACCOUNTS.md` §11.4
   (whether the free trial's saved card counts as consent; whether playing with friends needs the
   stronger consent). A flat-fee review is enough. Apply the lawyer's notes before going live.
3. Later, optionally, apply for a kidSAFE or PRIVO seal.

## Step 16. Admin access (for a parent's request, a free pass, or an emergency)

The admin commands run inside the service:

1. Install the Railway command line tool on your computer and log in (`railway login`), then in
   the `sparkle-world` folder: `railway link` (pick the project and the environment).
2. `railway ssh`, then for example `npm run admin -- show <email>` (plan, consent, players and
   devices counted, never the children's content). Other commands: `comp <email> <YYYY-MM-DD>` (a
   free pass), `consent-verified <email> --method form` (a signed consent form), `export <email>`,
   `delete <email>`, `sign-out-all`, `stats`.
3. If `railway ssh` is not available on your plan: turn on the Postgres service's public
   networking for a moment, run `railway run --service <game> npm run admin -- …` with
   `DATABASE_URL` set to the Postgres `DATABASE_PUBLIC_URL`, and **turn public networking off
   again** afterwards.

## Step 17. The one real test-mode purchase (staging)

Set `SW_STRIPE_SHAPES=1` in staging's Variables (test keys only), deploy, then:

1. On your iPad, open `https://<staging address>/account`, type your email, and check that the
   email arrives in iPad Mail and that the **6-digit code** fills in by itself. Also try it from a
   Home Screen app (add `/play` to the Home Screen, open it, **Grown-ups → Sign in or start**).
2. Read the notice, tick the box, **Agree and continue**.
3. Tick **I live in the United States**, **Start the Family Plan**. On Stripe's page use the card
   `4242 4242 4242 4242`, any future date, any 3 digits, a US address. Back on the Family page:
   **You're all set!**
4. Add two players. **Set up a kid's device**: on a second browser (or the iPad's Home Screen
   app) open `/play` → **Grown-ups** → **I have a code**, type the code. Pick a player, build
   something, and check the world appears on the other device.
5. Switch **Play with friends** and the **Walkie-talkie** on for one child (a code is emailed
   first). Play together with a second test family (another email, another browser), including the
   walkie. Switch the walkie off on the Family page while they play: it stops within a second.
6. **Manage subscription** → cancel. The plan shows **Ends …**.
7. In the Stripe Dashboard: the invoice shows the **tax line**; **Developers → Webhooks → your
   endpoint**: every delivery is **2xx**.
8. In the Deploy Logs, copy every line that starts with `stripe-shape` into
   `tools/fixtures/stripe/real-shapes.txt` (the automatic tests check the code against them), then
   remove `SW_STRIPE_SHAPES` again.
9. What only a real iPad can check (the tests cannot run Safari): the Home Screen app sign-in with
   the code, pairing, and the walkie.

## Step 18. Live: production, optional first, then required

1. In Stripe, switch to **live mode** and repeat step 13 (the setup command with `sk_live_…`, tax,
   portal, emails, the webhook for `https://<domain>/api/stripe/webhook`, a live restricted key).
2. In **production**'s Variables, set everything of step 14 with the live values,
   `PUBLIC_ORIGIN=https://<domain>`, and **`SW_ACCOUNTS=optional`**, plus `SW_REQUIRED_FROM` (the
   date, at most about 30 days later, from which playing together needs the Family Plan). Deploy.
   In `optional`, a device that is not signed in plays exactly as before, with a **Grown-ups** tile;
   the home page and `/parents` now describe the Family Plan (they are built for the mode you set:
   always change `SW_ACCOUNTS` and let Railway rebuild, never only restart).
3. Make one real $5.99 purchase with the family's own card, then **refund it** in the Stripe
   Dashboard (Payments → the payment → Refund).
4. Families already playing together: give them a free pass if you like
   (`npm run admin -- comp <their email> 2027-01-01`).
5. On the announced date, set **`SW_ACCOUNTS=required`** and deploy: signed-out devices now see
   "Ask a grown-up to set up Sparkle World", and the home page's `optional`-only sentences are gone.

To turn accounts off again, remove `SW_ACCOUNTS` (or set it to `off`) and deploy: the game and the
pages are exactly as in Part 1 (the database is kept, untouched).

### What to watch

- **Stripe** emails you when webhook deliveries keep failing.
- **Deploy Logs**, one line a day: `accounts: families=… entitled=… trialing=… past_due=…
  lapsed=… webhooks ok=… failed=… mails sent=… failed=… disputes=… refund_due=…`. A `refund_due`
  is a non-US family whose payment needs a manual refund in the Dashboard; `disputes` are
  chargebacks.
- **Railway → Usage**, and the email provider's bounce list.
- **Backups:** once, restore staging from a backup and check the Family page still works (the
  runbook is in `docs/SECURITY-PROGRAM.md`).

### If something goes wrong (family accounts)

| What you see | What to do |
|---|---|
| The deployment stops with `Sparkle World will not start: … is missing` or `must …` | That variable is missing or wrong (step 14). The old deployment keeps running. |
| `accounts could not start (ECONNREFUSED)` | The database is not reachable: check `DATABASE_URL = ${{Postgres.DATABASE_URL}}` and that the Postgres service is running. |
| The deploy fails at "Healthcheck" with accounts on | `/healthz` asks the database; open the Postgres service's logs. |
| `warning: the home page was built for SW_ACCOUNTS=off, but the server runs with required` | The pages were built before the variable was set: **Redeploy** (a build, not a restart). |
| The build warns `the account pages need SW_OPERATOR_…` | Set the operator variables (step 14) and redeploy. |
| No sign-in email arrives | Check the spam folder; check the provider's logs and that the domain shows "verified" (step 12). |
| "Couldn't reach the payment page" | Stripe keys or `STRIPE_PRICE_ID` (step 13); the Deploy Logs show `stripe_unavailable`. |
| Stripe shows failed webhook deliveries | The endpoint URL (step 13.7) and `STRIPE_WEBHOOK_SECRET` must match; a key change needs the new secret. The server also re-reads subscriptions every 6 hours, and the Family page syncs when a parent comes back from Stripe. |
| A parent asks for her data, or to be deleted, by email | Confirm the request came from the account's email, then `npm run admin -- export <email>` or `delete <email>` (step 16). Answer within 10 business days. |
