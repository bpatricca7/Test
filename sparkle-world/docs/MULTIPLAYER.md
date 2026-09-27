# Sparkle World: Play with Friends (multiplayer v1)

The family asked: *"make this game multiplayer where you can enter a code and play with your
friends"*. This document is the contract for building it. It extends `docs/DESIGN.md`; read §2
and §3 there first. If code and this document disagree, fix one of them in the same change.

Status: final design, ready to implement. Date: 2026-09-27.

---

## 0. Decision summary

**Base: Proposal 3 ("state journal").** The host's page is the only authority. Every change
travels as the **latest value of a key** (a block cell, a furniture piece, a plant, a pet). A
friend who misses messages asks again and gets a **compacted catch-up** holding only the newest
value of each key changed since her last applied batch. Friends talk to the host **only through
their presence object**, which is reliable. This model converges under any pattern of dropped
events, and it has the smallest amount of machinery of the three proposals.

**Grafted from Proposal 1 ("Hostlink"):**
- No `db` documents at all. The world snapshot streams over the room, and receipts come back
  in presence.
- Guest edits use compare-and-set: each cell carries its before value.
- A build-id check between peers.
- Budget and 1 KiB-string discipline for every message.
- A probe emit that checks whether this viewer may host.
- A 12-picture keypad.
- Local saves every 15 s while hosting, plus a "before friends" backup.
- Guards so that stickers, basket and coins listeners ignore friends' actions.
- A contract-faithful fake room for headless tests.

**Grafted from Proposal 2:**
- "Careful friends" protection is on by default: a friend may change only her own things
  and natural ground.
- At most 4 players.
- A name sanitizer for name tags.
- The platform account name in small print on the knock card, for grown-ups.
- A light hash safety net.
- A listener audit.
- A two-account platform spike before anything else is built.

**Cut from v1** (full list in §17): lobby "friends playing now" cards, guests controlling pets
or NPC friends, guest weather and time controls, host migration, and any server. There is
never free-text chat.

---

## 1. Platform facts this design relies on

Each fact was checked against the capability contracts in `artifact-capabilities/0.2.60/*.d.ts`.

| # | Fact | Source | Consequence here |
|---|---|---|---|
| F1 | `room.join(name)` opens a named room. The grammar is `^[a-z0-9][a-z0-9_.-]{0,47}$`. Names are **not secret**: anyone who can use the room can join any name. | room.d.ts `RoomName`, `join` | The code is a room name `sw1-heart-star-moon-cat`. The real safety boundary is who the artifact is shared with, plus the host's knock approval. |
| F2 | Topics must match `^[a-z][a-z0-9_.-]{0,47}$`. They are admin-only unless the declaration opens them to `interact` (Contributor and above; not Viewers or Commenters). At most 16 topics. Everyone receives everything. | room.d.ts header, `emit` | Three topics, opened to `interact`. **Guests never emit.** Viewers, Commenters and outside invitees hold `view` (except an outside Editor on an artifact not shared by link), so most of them could not emit anyway. |
| F3 | Anyone may set presence. The merged object must stay ≤ 4 KiB of JSON, and the latest value wins. It is sent coalesced, about 30 per second. The platform re-asserts it on reconnect, hands it to newcomers, and clears it on leave. Keys must be identifier-like. | room.d.ts `presence` | Presence is the **only** guest-to-host channel: an acknowledged outbox. All presence keys are identifiers (`[A-Za-z_][A-Za-z0-9_]*`), so peers are never used as keys; use arrays of `[peer, value]`. Strings stay ≤ 1,000 B and arrays ≤ 64 entries. |
| F4 | `emit` data is ≤ 4 KiB. Delivery is not promised: it may drop, it is never stored or replayed, and it is dropped silently while disconnected. The sender's own echo comes back with `isMe && sameTab`. Order is not documented. | room.d.ts `emit` | Batches are numbered. Receivers reorder, deduplicate, detect gaps and request repair through presence. |
| F5 | Emits and presence share about 40 per second, burst 80, **per page**. Named rooms use the lobby's budget. Beyond it, emits drop and the runtime reports the drop **once via `reportError`** (a console error). | room.d.ts `emit`, `NamedRoom` | One token bucket per page: 30 per second, burst 60, covering presence flushes and emits. A console error would fail our tests. |
| F6 | Every delivery carries a `Sender`: `peer` (one per open document, stable across reconnects, new on reload), `by` (the user id, or null), `isMe`, `sameTab`, `kind`, `guest`. | room.d.ts `Sender` | Seats are keyed by `peer`. Bans and auto-readmit use `by` when it is not null. Only `kind === 'viewer'` is accepted. |
| F7 | `onPeers` fires at most once per animation frame. The first delivery lists the room as `joined`, and more `joined` entries follow "for a second or two". | room.d.ts `PeersChange` | Wait ≥ 2 s before deciding "nobody here". Also poll `peers()` from the 100 ms tick, because frames stop in hidden tabs. |
| F8 | `connected()` false at load is normal, and only a true-to-false edge lasting about 2 s counts as a disconnect. `not_granted`, `revoked` and `capability_*` are terminal. | room.d.ts `connected`, error codes | Debounce disconnects to 2 s. Terminal codes end the session gently. |
| F9 | `join` rejects with `invalid_argument`, `limit_reached` (≤ 16 rooms per page), `not_permitted` (don't retry) or `upstream_error` (retry). After a reconnect the platform re-joins rooms by itself; a room that cannot be re-joined ends with one listener error. | room.d.ts `join` | Error mapping in §4.3 and friendly text in §12. |
| F10 | A new artifact version **reloads every view and empties the room**. | room.d.ts header | Resume chips on the title: **Keep playing** for the host, **Join Lily** for guests (§6). |
| F11 | Declaring `db` makes the artifact organization-internal. Viewers, Commenters and outside invitees hold `view` (except an outside Editor while the artifact is not shared by link) and cannot write, not even their own `data/users/<id>/`. | db.d.ts ACCESS RULES | Multiplayer writes **no** db documents. A guest's profile saves locally when the cloud refuses, which is today's behaviour. |
| F12 | `user.can('data.write')` resolves true, false or null. `null` means "the platform said nothing": keep the control and let the call decide. `profiles()` returns names only under scope `profile`. `id()` may be null. | user.d.ts | The hosting gate is `can('data.write') !== false`, followed by a probe emit. The knock card shows the account name from `profiles()`. |

**Unknown until tested: can an outside, view-level friend join a *named* room?** F9 allows
`not_permitted` for "this viewer cannot use named rooms here". Task 0 of the implementation plan
(§16) is a 30-minute spike with two real accounts before any code is built.

---

## 2. Architecture

```
 HOST page (the authority)                          GUEST page (a mirror plus her own predictions)
 ┌─────────────────────────────────────┐             ┌─────────────────────────────────────┐
 │ unchanged single-player game code   │             │ unchanged single-player game code   │
 │   World.set · entities · garden ·   │             │   her taps run locally at once      │
 │   pets (hooks report every change)  │             │   (hooks RECORD her changes)        │
 │ NetHost                             │  sw.op      │ NetGuest                            │
 │   journal key->seq, 100 ms flush ───┼────────────►│   buffer by seq, apply in order,    │
 │   seats, validation, exec, undo     │  sw.bulk    │   pend map keeps her predictions    │
 │   snapshot carousel, catch-up fixes─┼────────────►│   snapshot assembler, fix apply     │
 │   host presence (reliable) ─────────┼────────────►│   reads hd / acks / seats / time /  │
 │     hd, acks, seats, time, weather, │             │   weather / pets                    │
 │     pets, rules, hashes             │◄────────────┼── guest presence (reliable):        │
 │                                     │  presence   │     outbox ob, nd, rx, avatar       │
 └─────────────────────────────────────┘             └─────────────────────────────────────┘
              ▲  NetTransport: RoomTransport today, WsTransport later (only this file changes)
```

Seven rules carry the whole design:
1. **The host's world is the truth.** A guest never saves it or sends it anywhere, and her
   predictions are only shown while they wait for an answer.
2. **Host to all: numbered batches of key values** (`sw.op`). A lost batch is replaced by a
   catch-up with the current values of every key changed since then (`sw.bulk`, kind `f`).
3. **Guest to host: an outbox in her presence.** Each entry is kept until the host acks it and
   is processed exactly once. Edits carry compare-and-set before values.
4. **Every guest op touches its keys**, whether it is accepted or rejected. The host's value
   therefore always reaches her in the same batch as the ack, which clears her predictions.
5. **Big state moves as a snapshot** streamed in chunks over `sw.bulk` (kind `s`). Receipts
   come back in presence.
6. **Presence carries everything that must be reliable or high-rate**: acks, head sequence
   number, seats, time, weather, avatar and pet motion. Emits carry only batches and bulk data.
7. **All networking goes through `NetTransport`.** `NetHost` and `NetGuest` also reach the game
   only through `GameAdapter`, so the protocol is unit-testable in Node with fakes.

---

## 3. Module layout

New directory `src/net/`. No code outside `src/net/*-transport.js` touches `window.claude`,
apart from `storage.js`, which is unchanged.

| File | What it holds | Owner (§16) |
|---|---|---|
| `src/net/index.js` | `install(game)`: creates the `game.net` facade (§9.1), the `net` system, the actions `mp-friends` and `mp-say`, and the UI; resolves `claude.use('room')` availability. All multiplayer panel and action names start with `mp-`, so they cannot clash with the wave-2 NPC "friends" feature. | C |
| `src/net/transport.js` | `NetTransport` contract (JSDoc), `TokenBucket`, `jsonBytes()`, `createTransport(kind)`. | A |
| `src/net/room-transport.js` | `RoomTransport` over `claude.use('room')` and `claude.use('user')`. | A |
| `src/net/loop-transport.js` | `LoopTransport`: an in-memory hub for Node tests, or a BroadcastChannel for two tabs in dev with `?net=loop`. Supports fault injection. | A |
| `src/net/protocol.js` | Constants (§5.12), topic names, message and presence builders and parsers, shape validation of untrusted input, rejection codes, the `GameAdapter` typedef (§9.0). | A |
| `src/net/codec.js` | `packCells` / `unpackCells`, region RLE, `packLook` / `unpackLook`, snapshot framing (deflate, crc, chunking), `stableStringify`, `fnv1a32`, block-hash `mix`. | A |
| `src/net/journal.js` | Host `Journal`: key→seq maps, dirty sets, `flush()` into batches, `since(from)` for fixes, floor. | A |
| `src/net/host.js` | `NetHost`: seats, knocks, outbox processing, validation, protection, rate limits, author map, per-seat logs (undo), fixes, snapshot carousel, host presence composer, 15 s local saves. | A |
| `src/net/guest.js` | `NetGuest`: recorder, outbox, pend maps, batch buffer and apply, gap detection, fix and snapshot assembly, hash check, time and weather following, host-away handling. | A |
| `src/net/session.js` | `NetSession` state machine (§6): open, knock, resume, leave, errors → messages. | A |
| `src/net/adapter.js` | `GameAdapter`: the only bridge to game internals. Reads and writes cells, entities, plants and actors; installs hooks; executes guest ops; makes and enters snapshots. | B |
| `src/net/actors.js` | Host-owned moving things (pets now, NPC friends in wave 2): records, handles, motion samples, guest puppets. | B |
| `src/net/remote-players.js` | `RemotePlayers` system: friends' avatars, interpolation, name tags, phrase bubbles, emotes. | C |
| `src/net/ui.js` | Panels `mp-start`, `mp-join`, `mp-friends`, `mp-say`; the knock card; message cards; HUD badge refresh; summary dialog. | C |
| `src/net/pictures.js` | The 12 code pictures (SVG strings plus words) and the 16 quick phrases (text plus icon). | C |
| `src/net/names.js` | `sanitizeName()` plus a small blocklist (reviewed by a grown-up). | C |

---

## 4. Transport

### 4.1 Interface (`src/net/transport.js`)

```js
/**
 * NetTransport: everything multiplayer needs from the network. Semantics every
 * implementation must keep: send() may drop, duplicate or reorder; setState() is reliable
 * latest-value (re-sent after reconnects, handed to newcomers, cleared on leave).
 */
export class NetTransport {
  get kind() {}            // 'room' | 'loop' | 'ws'
  get limits() {}          // { msgBytes: 3900, stateBytes: 3900, strBytes: 1000, rate: 30, burst: 60 }
  async identity() {}      // -> { uid: string|null, canHost: true|false|null }   (null = try it)
  async open(roomName) {}  // join; resolves { self: peerId }; rejects NetError (4.3)
  async close() {}         // leave; idempotent
  selfId() {}              // my peer id (null before open)
  connected() {}           // debounced: false only after a true->false edge lasting 2 s
  onStatus(fn) {}          // fn({ connected, fatal?: 'revoked'|'not_granted'|'ended' }) -> off
  setState(patch) {}       // merge into MY state (top-level null deletes). Coalesced to <= 10 Hz.
                           // Throws NetError('too_big') synchronously if the merged object would
                           // exceed limits.stateBytes, and applies nothing (caller shrinks outbox)
  flushState() {}          // send the merged state within 30 ms (outbox/ack changes)
  peers() {}               // [{ id, uid, by, at, guest, self, state, updatedAt }] frozen; viewers only
                           // uid = the room's stamp (by) or null, never from presence; at = join order
  onPeers(fn) {}           // fn({ peers, joined, left, updated }) -> off
  send(topic, data, prio) {}  // topic 'op'|'bulk'|'ctl'; prio 0 (ctl) .. 3 (snapshot);
                              // -> 'sent' | 'queued' | 'dropped'  (never throws; never retried)
  on(topic, fn) {}         // fn(data, fromPeerId) -> off; my own echoes are filtered out
  async probeSend() {}     // host precondition: may I send on the topics? -> boolean
}
```

### 4.2 `RoomTransport` (`src/net/room-transport.js`)

| Interface | Room call |
|---|---|
| `identity()` | `user.id()`; `user.can('data.write')` (true, false or null) |
| `open(name)` | `room = await claude.use('room')` (null → `NetError('unavailable')`), then `nr = await room.join(name)`. Subscribe `nr.on('sw.op'|'sw.bulk'|'sw.ctl', …, onError)`, `nr.onPeers`, `nr.onConnection`. |
| `send(topic, data)` | Only while `nr.connected()`; otherwise return `'dropped'`. JSON byte check ≤ `msgBytes`, else it is a bug: log it and return `'dropped'`. Then take a token from the bucket, or queue by priority. Queue items older than 2 s are dropped; a dropped `op` batch is repaired by §5.7. Sends `nr.emit('sw.' + topic, data)`. |
| `setState(patch)` | Merge locally. Check `jsonBytes(merged) ≤ stateBytes` (throw `too_big`). A 100 ms timer, or 30 ms after `flushState()`, calls `nr.presence(diffPatch)` with one bucket token. |
| `peers()` | Maps `nr.peers()`: `peer → id`, `by → uid` (null when `by` is null: presence is written by the peer itself, so a uid from it could be anyone's; Addendum B), `presence → state`, `isMe && sameTab → self`; drops `kind !== 'viewer'`. |
| `probeSend()` | Waits for `connected()`, then `nr.emit('sw.ctl', { k: 'hi' })`: resolves → true; `not_permitted` → false. |

**Budget.** There is one `TokenBucket(30/s, burst 60)` per page, shared by presence flushes and
emits. The queue priority is: presence flush > `ctl` > `op` > `bulk` fix > `bulk` snapshot.
Topic names: `sw.op`, `sw.bulk` and `sw.ctl`.

### 4.3 Error mapping

| Room code | Where | NetError / action |
|---|---|---|
| `use('room')` → null | availability | `unavailable`: the Friends buttons stay hidden |
| `invalid_argument` | any | a bug: `console.warn` once, drop the message, count it in `debug.net.stats()` |
| `not_permitted` | `join` | `no_rooms` (terminal; don't retry) |
| `not_permitted` | `emit` / probe | `cannot_host` (the probe) |
| `limit_reached` | `join` | `busy` (retry once after 5 s) |
| `upstream_error` | `join`, or a listener (room ended) | `transient`: rejoin the same name after 1, 2, 4 and 8 s, then `lost` |
| `revoked`, `not_granted`, `capability_*`, `transform_error` | any | `fatal`: leave quietly; neutral message "Playing together stopped." |

### 4.4 Other transports

- **`LoopTransport`** (`?net=loop`, and in Node unit tests) implements the same semantics over a
  shared hub object (tests) or `BroadcastChannel('sw-net')` (two tabs in one browser profile).
  Its knobs are `dropRate`, `dupRate`, `delayMs:[min,max]`, `reorder`, `partition(peer, ms)`,
  byte limits that throw like the real ones, and per-peer send counters.
- **`WsTransport`** (later, for the game's own website) uses one WebSocket to
  `wss://…/r/<roomName>` with JSON frames:
  - `{t:'b', topic, data}` for broadcast; the server relays it and stamps `from`.
  - `{t:'s', patch}` for state; the server merges, rebroadcasts, and hands the state to
    newcomers, which gives exactly the presence semantics.
  - `{t:'p'}` roster frames drive `peers` and `onPeers`.
  - `identity()` comes from the site's login, and `canHost` is true.

  The server is a dumb relay of about 150 lines. Nothing above `NetTransport` changes: protocol,
  journal, host, guest and UI all stay as they are. Limits may be raised (`msgBytes` 60,000),
  which only means fewer chunks.

---

## 5. Protocol

### 5.1 Codes and room names

- There are **12 pictures**. The word is also the code token:
  `heart star moon sun flower rainbow cat bunny fish cupcake crown gem`.
- A code is 4 pictures, and repeats are allowed: 12⁴ = 20,736 codes.
- **Room name** = `'sw1-' + words.join('-')`, for example `sw1-cupcake-rainbow-crown-heart`.
  The longest is 35 characters and it satisfies F1. `sw1` is the protocol major version, so
  incompatible protocol versions never meet.
- **Picking a code (host).** Choose at random, join, then wait **2 s** (F7). If another viewer
  with `state.r === 'h'` is there, leave and pick again (at most 3 tries).
  - If two hosts race into one room, the one with the newer `hs` (hosting-since) leaves. On a
    tie, the one with the larger peer id leaves.
  - Guests follow the host that admitted them and ignore any other `r:'h'`.

### 5.2 The state model (keys and values)

| Key | Value on the wire | Source of truth |
|---|---|---|
| cell `c:i` (`i = (y*sz+z)*sx+x`) | block id 0..255 (all peers run the same build, so ids agree) | `world.blocks[i]` |
| entity `e:uid` | `[uid,key,x,y,z,rot,color\|0,data\|0,yo,ro]`, where `yo = round(yOffset*1000)` and `ro = restsOn\|0`; or absent | `game.entities` |
| plant `p:i` (the plant's own cell) | `[i,crop,stage,wet]`, `wet` 0/1; or crop `0` = none | `game.garden` |
| actor `a:<kind>:<id>` (pets; NPC friends in wave 2) | `[kind,id,rec\|0]`, where rec is the actor's serialize() record plus `h` (a small session handle) and without the position | `actors.js` |

Time, weather, avatars and actor **positions** are not keys. They live in presence (§5.4).
Gems are per player and are not synced (§7).

**Entity uid ranges.** Seat `s` (0 = host, 1..3 = guests) allocates uids in
`[s·1,000,000 + 1, (s+1)·1,000,000)`. `EntityManager.nextUid` is bumped only by uids in its own
range (§9.4). A guest starts at `max(existing uids in her range) + 1` after each snapshot. Old
saves are unaffected, because all their uids are below 10⁶.

### 5.3 Topics and messages

Every message is JSON of at most **3,900 UTF-8 bytes**. Every topic is opened to `interact`
(§10). A receiver accepts a topic message only when **`from === followedHostPeer && data.e ===
currentEpoch`**. Unknown fields are ignored, and every field is type-checked and clamped
(`protocol.js`).

**`sw.op`: a numbered batch, host to everyone, at most 10 per second.**
```js
{ e:'k3f9x2', s:1042,                      // epoch, sequence number (consecutive, never reused)
  a:[[1,57],[2,12]],                       // acks: [seat, processed-through lseq] (whenever changed)
  r:[[1,56,2]],                            // rejections this batch: [seat, lseq, code] (§8.1)
  c:'00x3k2a…',                            // cells: 7 chars each = idx base36 (5, zero-padded) + id hex (2)
  g:[[x0,y0,z0,dx,dy,dz,'<b64>']],         // regions: RLE (id byte + LEB128 run) of CURRENT ids in the box,
                                           //   order x fastest, then z, then y (same as world.blocks)
  X:[1000007],                             // removed entity uids
  E:[[57,'bed_canopy',70,21,64,2,'#FFB6D9',{},0,0]],   // entity records (whole)
  P:[[923441,'carrot',2,1]],               // plants (crop 0 = removed)
  K:[['pet','petlx3k…',{…,h:3}]],          // actor records (0 = removed)
  f:[['pf','cottage',61,20,40,79,52]] }    // optional cosmetic hints: [kind,key,x0,y,z0,x1,z1] (may be lost)
```
- Cells go in `c` unless one 16×16 column holds more than 32 dirty cells. Then they are sent as
  one region `g` over the dirty bounding box, re-encoding current ids, which is idempotent.
- A flush larger than 3,900 B is split into several consecutive sequence numbers. Each part is
  a complete set of values for its own keys.
- Typical sizes:

  | Change | Size |
  |---|---|
  | One block | ~60 B |
  | 96-cell stroke | ~700 B |
  | One furniture piece | ~120 B |
  | Castle (6.6k cells, 42 pieces) | ~4–6 messages |

**`sw.bulk`: big data for chosen receivers, at most 10 per second.**
```js
{ k:'s', e, id:'s7', s0:1040, i:3, n:14, z:1, c:'a1b2c3d4', d:'<≤3600 b64 chars>' }       // snapshot chunk
{ k:'f', e, to:'<peer>', id:'f9', from:980, upto:1042, i:0, n:2, d:'<≤3600 chars of JSON>' } // catch-up part
```
- The receiver ignores `to` not equal to its own id.
- The fix payload is a JSON object with the same fields as a batch (`a r c g X E P K`). `a` is
  the whole ack table at `upto`; `r` holds that seat's rejections from the last 30 s.

**`sw.ctl`: control, best effort.** Presence repeats anything important.
```js
{ k:'hi' }                                       // probe (ignored by receivers)
{ k:'bye', e, to:'<peer>'|'*', why:'kick'|'end'|'deny' }
```

### 5.4 Presence schemas

All keys are identifiers, all strings are ≤ 1,000 B, and each merged object is ≤ 3,900 B.
Avatar fields are the same for hosts and guests.

| Field | Who | Type | Meaning |
|---|---|---|---|
| `v` | all | `1` | protocol major (must match) |
| `pv` | all | string | build id `__SW_BUILD__` (must match; §9.14) |
| `r` | all | `'h'`\|`'g'` | role |
| `uid` | all | null | no longer sent (Addendum B): identity is the room's `by` stamp only |
| `nm` | all | string ≤ 12 | name for the tag, already `sanitizeName`d; receivers sanitize again |
| `lk` | all | string ≤ 160 | `packLook(look)` (§5.13) |
| `p` | all | `[x,y,z,yaw]` 2 dp | position (feet; seat surface when sitting; mattress when sleeping) |
| `st` | all | 1 char | `w` walk/stand, `i` swim, `f` fly, `s` sit, `z` sleep, `h` ride, `e` emote, `l` zip line |
| `em` | all | `[name,n]` | last emote and a nonce |
| `ph` | all | `[id,n]` | last quick phrase and a nonce |
| `ep` | all | string | host: its epoch. Guest: the epoch she follows. |
| `hs` | host | number | hosting-since (ms, host clock), for tie-breaks |
| `hd` | host | int | head sequence number (last batch sent) |
| `fl` | host | int | journal floor (a fix below it is impossible) |
| `ak` | host | `[[seat,lseq]]` | processed-through per seat (fast outbox trim) |
| `adm` | host | `[[peer,seat]]` | admitted friends (a guest finds her own seat here) |
| `no` | host | `[[peer,why]]` | refused or sent home: `d` deny, `k` kicked, `f` full, `v` version |
| `rs` | host | `[peer]` | these peers must take a new snapshot |
| `ru` | host | `[build,mine]` | rules: friends can build (1/0); friends can change my things (1/0) |
| `tm` | host | `[dayTime(4dp),day,frozen]` | clock |
| `wx` | host | string | weather kind |
| `pt` | host | `[[h,x20,y20,z20,yaw100,st]]` | pet motion (integers: ×20 for position, ×100 for yaw; ≤ 12 pets) |
| `nx` | host | `[[h,x20,y20,z20,yaw100,st,line]]` | NPC friend motion (wave 2; `line` = curated speech index or −1) |
| `hh` | host | `[s,b,e,p]` | safety-net hashes at sequence `s` (§5.11) |
| `zz` | host | 0/1 | host tab hidden ("taking a nap") |
| `end` | host | 0/1 | session over |
| `kn` | guest | 1 | knocking (until listed in `adm` or `no`) |
| `zc` | guest | 0/1 | can decompress `deflate-raw` |
| `rx` | guest | `{id,h,m}` | snapshot receive state: `id` 0 = "please send"; `h` chunks held; `m` missing indices as a comma string (≤ 32) |
| `nd` | guest | int | present only while she needs a catch-up from this sequence number. Her applied sequence number `ap` is **not** in presence, to avoid a send on every batch; it is in `debug.net`. |
| `ob` | guest | `[[lseq,kind,…args]]` | outbox (§5.6), ≤ 2,800 B, ≤ 40 entries |

Typical sizes and rates:
- Host: about 1.2 KB. Sent at ≤ 10 Hz while the host or pets move, and on change otherwise.
- Guest: about 0.5 KB when idle, ≤ 3.4 KB while building. Sent at ≤ 10 Hz while moving or
  while the outbox is non-empty, and on change otherwise.
- Position is re-sent only after moving > 2 cm or turning > 1°.

### 5.5 Host: journal, flush, batches

- **Hooks** (§9) call `journal.touch(kind, key)` on **every** change of a synced key, whatever
  caused it: host input, systems (garden drying, mailbox), Undo, prefab commits, or executing a
  guest op.
- **Flush** runs at most every 100 ms, from the 100 ms tick or a frame, and only when something
  is dirty or the acks changed:
  1. Pack the dirty keys with their current values into messages ≤ 3,900 B.
  2. For each message `m`: `seq += 1`, set `journal[key] = seq` for its keys, and send it on
     `sw.op` with `s = seq`.
  3. Set `hd = seq` in presence.
- **The journal** keeps key → last seq only. Values are read live when a fix is built.
  - Cells, entities and plants use numeric Maps.
  - Above 60,000 keys, the floor `fl` rises to the median seq and older entries are dropped.
- **Epoch** `ep` is 6 random base36 characters, new on every host start or reload. Sequence
  numbers restart at 0 per epoch.

### 5.6 Guest to host: recorder, outbox, acks, predictions

- **Recording** is on only when the role is guest, the state is `g.live`, `!remoteApplying`,
  and `!game._inSystems` (§9.2).
  - Hooks append in time order: consecutive cell changes merge into one `b` op (first before,
    last after, no-ops dropped). Entity, plant and intent ops close the current `b` run.
  - At `frameEnd()` the recording becomes outbox entries of ≤ 1,000 B and ≤ 100 cells each.
  - Each entry takes the next `lseq` (per page load, starting at 1).

| kind | args | produced by |
|---|---|---|
| `b` | packed string: 9 chars per cell = idx (5 base36) + before (2 hex) + after (2 hex) | any `World.set` in her actions: placing, removing, strokes, Undo, tilling, watering, grass cleared by furniture |
| `e+` | `uid,key,x,y,z,rot,color,data` | `entities.place` |
| `e-` | `uid` | `entities.remove` (items on top are recorded first, each as its own `e-`) |
| `er` | `uid,rotBefore,rotAfter` | `rotate` / `_setRot` |
| `ed` | `uid,patch` | `setData` (door, lamp, TV, window, picture, easel, bloom, fence `conn`) |
| `p+` | `x,y,z,crop` | `garden.addPlant` (planting, undo) |
| `p-` | `x,y,z,crop` | `garden.removePlant` (Remove tool, undo) |
| `ph` | `x,y,z,crop` | `garden.harvest` (stage 3 → removed, or regrow → stage 2) |
| `pf` | `key,ox,oy,oz,rot` | intent: her Magic House (§7) |
| `pu` | `lseqOfPf` | intent: Undo of her own Magic House |
| `z` | – | intent: she slept (`skipToMorning`) |

- **Outbox window.** Presence `ob` holds the oldest unacked entries that fit in 2,800 B.
  Newer entries wait in a local queue, which is unbounded. The HUD shows a small "sending…"
  sparkle when more than 20 entries are waiting.
- **Trim.** When host presence `ak` shows `[mySeat, L]`, entries with `lseq ≤ L` leave the
  outbox. The host never processes an lseq twice: it tracks `lastLseq` per **peer**.
- **Predictions (pend maps).** For every key in a recorded entry, set
  `pendCells[i] / pendEnts[uid] / pendPlants[i] = lseq`.
  - When a batch is applied (in sequence order) or a fix is applied, **process `a` first**: for
    my seat, delete every pend entry whose lseq ≤ the acked L.
  - **Then** apply values, skipping keys that are still pending.
  - Because the host touches every key of an op it processes, whether accepted or rejected, the
    authoritative value arrives in the same batch as the ack that clears the prediction. A
    rejected edit therefore reverts by itself.
- **Rejection feedback.** `r` entries for my seat play the soft "nope" click and show at most one
  toast per 4 s. The texts are in §12. A `pf` rejection ends the pop-in with "The magic fizzled!"

### 5.7 Catch-up fixes

1. The guest applies batch `s` only when `s === ap + 1`. Out-of-order batches wait in a buffer
   of ≤ 400. Duplicates and `s ≤ ap` are dropped.
2. If `hd > ap` (from host presence, which is reliable) and batch `ap+1` has not arrived within
   **400 ms**, she sets presence `nd = ap`.
3. On every tick the host serves each admitted peer that has `nd < hd` and got no fix in the
   last 2 s:
   - It first flushes, so that `upto = hd`, then collects the keys with `journal seq > nd` and
     their current values.
   - If `nd < fl` or the payload is > 48 KB, it sends a snapshot instead: the peer goes into
     presence `rs`.
   - Otherwise it sends the payload as `k:'f'` parts.
4. The guest applies a fix only when **all** its parts have arrived, and atomically: acks, then
   values. Then `ap = upto`, she discards buffered batches ≤ `upto`, and she deletes `nd` once
   `ap ≥ hd`. A lost part simply means `nd` stays set, and the host sends a new fix.

### 5.8 Snapshot carousel

- **Contents.** `adapter.makeSnapshot()` runs in the same JS task, right after a flush, so the
  snapshot equals the state at `s0 = hd`:
  - `json` = `game.serializeWorld({ thumbnail: false })` minus `player`, `hotbar` and
    `thumbnail`;
  - `name` = `"<host nm>'s World"`;
  - `net: { s0, ep, host: [x,y,z,yaw] }`;
  - `rle` = `world.encodeBlocksBytes()`.
- **Framing.** `u32le(jsonLen) | utf8(JSON with blocks:'') | rle`, then
  `CompressionStream('deflate-raw')` if every current receiver has `zc: 1` (else raw, `z: 0`),
  then base64, then 3,600-character chunks. `c` = `fnv1a32` of the uncompressed bytes.
- **Expected size and time at 10 chunks per second:**

  | World | Chunks | Time |
  |---|---|---|
  | Cozy | 10–20 | 1–2 s |
  | Busy Big world | ≤ 35 | ≤ 4 s |

- **Carousel.**
  - The host keeps the latest snapshot for 60 s and reuses it for a new receiver when `s0 ≥ fl`.
  - It sends chunks in index order, then re-sends every index in any receiver's `m` that was not
    sent in the last 800 ms.
  - It re-sends from 0 for a receiver with `rx.h === 0` after 3 s without progress.
  - It stops when no admitted peer has `rx.id` set.
- **Guest.**
  1. Subscribe to all topics **before** knocking.
  2. When admitted, set `rx = {id: 0, h: 0, m: ''}` and buffer `sw.op`.
  3. Assemble the chunks, check `c`, decompress, and call `adapter.enterSnapshot()`.
  4. Set `ap = s0`, apply the buffered batches `> s0`, and fix the gaps through §5.7.
  5. Clear `rx`.
- **Failure.** A crc or parse failure retries twice, then shows "The world got lost on the way.
  Let's try again!" with a Retry button. A download stalled for 60 s is handled the same way.

### 5.9 Ordering and drop recovery at a glance

| What is lost or late | Detected by | Recovery |
|---|---|---|
| a batch | `hd > ap`, or a buffered `s > ap+1` | fix (§5.7) |
| the last batch (tail loss) | host presence `hd` (never dropped) | fix |
| a fix part | `nd` still set 2 s later | the host sends a new fix |
| a snapshot chunk | `rx.m` / `rx.h` | carousel re-send |
| a gap older than the floor, or huge | `nd < fl` or > 48 KB | new snapshot (`rs`) |
| a guest edit | it stays in the presence outbox until acked | none needed (exactly once) |
| an ack in a lost batch | the fix carries the full ack table | pend cleared then |
| host reload (new epoch) | `ep` changed on a host peer with the same uid (room stamp) | new snapshot; her unacked edits are dropped |
| brief disconnect | `connected()` / platform re-assert | the peer label is stable; everything resumes |

### 5.10 Why it converges

- **Host.** Let `H_n` be the host state after flush `n`. Every change of a synced key passes a
  hook, so every key whose value differs between `H_{n-1}` and `H_n` has journal seq ≥ n. Each
  batch carries current values, not deltas, so applying batches in order yields `H_n` exactly.
- **Guest** (confirmed state `G`). `G = H_{s0}` after the snapshot.
- **Induction.** If `G = H_a` and she applies batch `a+1`, then `G = H_{a+1}`. A fix
  `(a, u]` holds the value at `u` of every key changed in `(a, u]`; unchanged keys already agree.
  So `G = H_u`.
- **Liveness.** Presence is eventually delivered and re-asserted, so `hd`, `nd`, `rx` and the
  outbox always arrive. Every loss in §5.9 has a recovery that repeats until it succeeds, for
  any drop rate below 100%.
- **Predictions.** The displayed state is `G` with the pending keys overlaid. Every outbox entry
  is processed exactly once, and every key it names is touched in the batch that acks it. So
  when the edits stop, the pend maps empty and the displayed state equals `G`.
- **Result.** Once edits stop, all peers equal `H_hd`.
- **Outside the model.** A code path that changes state without a hook falls outside this
  argument. §5.11 detects that and the §9 contract prevents it.

### 5.11 Safety net: hashes and resync

- **Block hash `b`.** `Σ mix(i, id)` over non-air cells mod 2³², where
  `mix = fmix32(imul(i, 0x9E3779B1) ^ imul(id, 0x85EBCA77))`.
  - It is kept incrementally in the `World.set` hook, which costs one multiply per set.
  - A full scan runs after a snapshot load and at host start: about 20 ms for 2.77 M cells.
- **Entity hash `e`.** `fnv1a32` over uid-sorted
  `uid|key|x|y|z|rot|color|stableStringify(data)`. **Plant hash `p`**: the same idea over
  `idx|crop|stage`. Both are computed on demand, in under 2 ms.
- **Host.** Every 10 s, if `hd` moved since the last hash: flush, compute, and set
  `hh = [hd,b,e,p]`.
- **Guest.** When `ap === hh[0]`, the pend maps are empty and the buffer holds nothing unapplied:
  compute and compare.
  - **Two mismatches in a row** (on different `hh` values) trigger a resync: take a new
    snapshot while showing "Fixing a few sparkles…".
  - The resync is counted in `debug.net.stats().resyncs`. The acceptance tests require 0 resyncs
    in fault-free runs.

### 5.12 Constants (`protocol.js`)

| Name | Value |
|---|---|
| MAX_PLAYERS | 4 (host plus seats 1..3) |
| MSG_BYTES / STATE_BYTES / STR_BYTES | 3,900 / 3,900 / 1,000 |
| BUCKET | 30 per s, burst 60 (per page) |
| PRESENCE_HZ | ≤ 10 moving, on change otherwise; `flushState` within 30 ms |
| TICK | 100 ms `setInterval` (keeps running when frames stop) |
| FLUSH_MIN | 100 ms |
| OUTBOX_BYTES / ENTRY_BYTES / CELLS_PER_B | 2,800 / 1,000 / 100 |
| GAP_WAIT / FIX_REPEAT / FIX_MAX | 400 ms / 2 s / 48 KB |
| CHUNK_CHARS / SNAP_HZ / SNAP_CACHE | 3,600 / 10 / 60 s |
| JOURNAL_MAX_KEYS | 60,000 |
| FIND_HOST / KNOCK_GIVEUP | 8 s after join / 90 s |
| HOST_AWAY_GRACE / SEAT_HOLD | 60 s / 60 s |
| HASH_EVERY | 10 s |
| HOST_LOCAL_SAVE | every 15 s while hosting, when anything changed |
| INTERP_DELAY / AVATAR_HIDE / TAG_HIDE | 150 ms / 64 blocks / 22 blocks |
| LOOK_MIN_INTERVAL / PHRASE_MIN_INTERVAL | 1 s / 2 s |
| Rate limits per guest | cells 400/s (burst 800); entity ops 20/s; setData 10/s; `pf` 1 per 20 s; `z` 1 per 60 s (for the whole session) |

### 5.13 Look codec

`packLook(look)` makes a dot-separated token string (about 130 characters) in this fixed order:
1. `skin`
2. `hair.style`, `hair.color`, `hair.color2` (`-`, `r` = rainbow, or hex), `hair.mix`
3. `eyes.color`, `eyes.lashes`
4. `face.blush`, `face.freckles`, `face.smile`
5. `top` × 4
6. `bottom` × 4
7. `dress` × 4 (`-` each when null)
8. `shoes.type`, `shoes.color`
9. `acc.head`, `headColor`, `face`, `faceColor|-`, `back`, `backColor`, `neck`, `neckColor`,
   `hand`, `handColor|-`

Options are indices in base36 into the exported lists in `wardrobe-data.js` (`HAIR_STYLES`,
`HAIR_MIXES`, `SMILES`, `TOPS`, `PATTERNS`, `BOTTOMS`, `DRESSES`, `SHOES`, `*_ACC`). This is
safe because `pv` must match. Colors are 6 hex digits without `#`, and booleans are 0/1. The
name is not included (`nm`). `unpackLook` always ends with `normalizeLook()`.

---

## 6. Session state machine (`session.js`)

`game.net.state` holds one of these values, and each change emits `'net:state' { state, role,
count }`.

```
            host()                                     leave/stop/fatal
 idle ────────────────► h.opening ──► h.live ──────────────► h.closing ──► idle
   │                        │ fail                    ▲ │ room ended: rejoin 1,2,4,8 s (same epoch)
   │                        ▼                         └─┘
   │                     idle + message
   │ join(code)
   └──► g.joining ─► g.finding ─► g.knocking ─► g.loading ─► g.live ◄────► g.waiting
            │ err       │ 8 s        │ no/90 s     │ fail×2      │  ▲ host back (same ep)
            ▼           ▼            ▼             ▼             │  │
         idle+msg    idle+msg     idle+msg      idle+msg         │  └─ zz:1, or host peer gone
                                                                 │     (≤ 60 s)
                                 new epoch / hash ×2 / rs ──► g.loading   (resync)
            kicked / end / 60 s host gone / leave() / fatal ──► g.leaving ──► idle + message
```

**Host `h.opening`**, in order. Any failure goes back to `idle` with a message from §12.
1. `net.available` is true, `game.mode === 'play'`, a world is loaded, and the game is not busy.
2. `identity().canHost === false` → message *cannot host*.
3. `serializeWorld({thumbnail:true})` → `store.saveWorld(save)`. Then write the backup:
   `store.saveWorld({...save, id: save.id + '.before', backupOf: save.id, backupAt: now})`.
   **The session does not start unless both writes resolve `ok`.**
4. Pick a code and join (§5.1). Then `probeSend()`; false → leave, message *cannot host*.
5. New epoch. Block-hash full scan. `adapter.attach('host')`. Hooks are live from here on.
6. Host presence: `{v, pv, r:'h', ep, hs, nm, lk, p, st, hd:0, fl:0, ak:[], adm:[], no:[],
   ru:[1,0], tm, wx, pt}`.
7. `profile.net.lastHost = {code, worldId, at, uids:[]}` is saved.
8. Open the Friends panel showing the code.

**Host `h.live`:**
- On knocks, run the admission rules (§8.5).
- **Each tick, in this order** (from the frame, or from the 100 ms interval when no frame ran in
  the last 150 ms):
  1. read `peers()`;
  2. admissions and seat timeouts;
  3. process outboxes in seat order;
  4. flush;
  5. serve fixes;
  6. snapshot chunks;
  7. compose the host presence;
  8. the 15 s local save and the 10 s hash when due.
- On `visibilitychange` hidden: set `zz:1`; visible: set `zz:0`.
- On a room error: retry with the same epoch.

**Host `h.closing`:**
- Set presence `end:1` and emit `ctl {k:'bye', to:'*', why:'end'}`.
- `saveWorld({thumbnail:true})`, `store.flush()`, `close()`, `adapter.detach()`.
- Show the summary dialog (§11.7).

**Guest:**
- `g.joining`: check `net.available`, then `open(room)`, then subscribe.
- `g.finding`: wait ≤ 8 s for a viewer with `r:'h'`, `v === 1` and `pv === mine`. A `pv`
  mismatch ends with a message. With several, the one the room says joined first (`at`) is
  the host; presence `hs` (written by each peer itself) only breaks ties where the room gives
  no order (claude.ai).
- `g.knocking`: presence `{v, pv, r:'g', nm, lk, kn:1, zc, ep}`, then wait for `adm` or
  `no`. On admission, `kn` is deleted.
- `g.loading`: §5.8, then `game.enterSharedWorld(save)` (§9.2).
- `g.live`: record, send, apply. This is the only state in which `mayEdit()` can be true.
  **Each tick, in this order:**
  1. read the host presence;
  2. trim the outbox by `ak`;
  3. apply buffered batches and complete fixes;
  4. gap check (`nd`);
  5. follow time and weather;
  6. compose her presence.

  Recording is flushed into the outbox at `frameEnd()`.
- **Resync.** A same-epoch resync (hash mismatch, or listed in `rs`) keeps her outbox, since the
  host will still process it with CAS, and clears the pend maps with the new snapshot. A new
  epoch drops both.
- `g.waiting`: entered on host `zz:1`, or when the host peer is missing. A non-blocking card says
  "Lily is taking a little break…". She can walk and build: edits are predicted and queued.
- `g.leaving`: `close()`, then `game.exitToTitle()` (which does not save the host world) and the
  message. `exitToTitle()` only when she was in the host's world: an ending before that
  (wrong code, "Not now", no answer) leaves her where she was, the keypad open.

**Resume after a reload or a new version.**
- Host: if `profile.net.lastHost.at` is less than 30 min ago, the title shows the chip
  **Keep playing**. It runs `loadWorld(worldId)`, then `host({code, resume:true})`: the same
  code, a new epoch, and the uids in `lastHost.uids` are auto-admitted. The backup is kept
  (§13) and who owned what comes back from the world's save (`systems.netOwners`, written
  while hosting; Addendum B). Opening that world any other way (Play, My Worlds) while
  `lastHost` is fresh asks "Your friends are waiting! Open your door again?", and hosting it
  from the pause menu reuses the code.
- Guest: `profile.net.lastJoin = {code, hostName, at}` shows the chip **Join Lily** for 2 h.
- `profile.net` is part of the profile (via `mergeProfile` defaults) and is saved locally and in
  the cloud like any profile field.

---

## 7. What syncs, per feature

| Feature | Host | Guest | Notes |
|---|---|---|---|
| Friends' avatars | its own presence | own presence | Each peer draws the others (`remote-players.js`): `game.createAvatar(unpackLook(lk))`, a 150 ms interpolation buffer, `avatar.update(dt, flags from st)` with speed from position deltas, `playEmote` on each new nonce, a name tag (`nameTagSprite` from `pets/kit.js`), and a phrase bubble sprite for 4 s. No collisions and no picking. Hidden beyond 64 blocks. |
| Blocks (tap, strokes, Remove, Undo) | journal | recorded `b`, predicted | Guests may not place a solid block in a cell overlapping any avatar (`net.cellHasFriend`). After each applied batch, `game.unstickPlayer()` runs. |
| Furniture: place, remove, rotate, data (doors, lamps, TV, curtains, pictures, easel, bloom, fence `conn`) | journal | recorded `e+ e- er ed`, predicted | Whole records host to guest; per-field patches guest to host. Records with unchanged data skip `refresh()`, so door animations are not reset. |
| Magic Houses and campers | journal (its own commit) | intent `pf`; pop-in animation locally, no commit | The host runs `prefabs.applyRemote` (§9.5) outside its own Undo history. The guest celebrates on ack; her Undo sends `pu`. |
| Garden: plant, water, harvest | journal; growth, drying and rain run **only here** | recorded `b`, `p+`, `ph`, `p-`; growth off | Watering is predicted as `farmland_wet` cells. The host calls `garden.adoptWet(x,y,z)` when it applies them. The harvest reward goes into the harvester's own basket immediately; a rare conflict may give a duplicate, which is fine because items are never lost. |
| Pets (including wave-2 turtles and horses) | owns everything: AI, records `K`, motion in `pt` | puppets only | Guests: petting and Remove-tool tickling play the local hearts and voice. Adopt, feed, ride, rename, Stay/Follow and the Pets panel show "That's Lily's pet! Ask her to help." Remote pet names go through `sanitizeName`, falling back to the species name. |
| NPC friend girls (wave 2) | owns everything: records `K` kind `npc`, motion in `nx` | puppets | Guests may wave and dance nearby, locally. "Invite a friend" and NPC dress-up are host-only in v1. Speech is `line` indices into a curated list. |
| Zip lines (wave 2) | towers and links are entities (`ed` for the link) | ride locally | Others see `st:'l'` plus positions at 10 Hz. |
| Time | presence `tm`, re-published every 5 s and at once after a jump (`setDayTime`, sleep) | follows | The guest keeps ticking and extrapolates from the peer's `updatedAt`. She snaps if the difference is > 0.01 day, otherwise eases at 10% per second. `frozen` comes from the host. A forward snap past 0.25 sets `time.quietNight`. |
| Sleep | runs `skipToMorning()` | intent `z`, plus a local skip (prediction) | The host moves everyone to morning, at most once per 60 s, with the toast "Mia went to sleep. Good morning, everyone!" If the host refuses, the guest's clock snaps back to night. |
| Weather | presence `wx`; the auto weather runs here | `weather.auto = false`; `set(wx, {manual:false, announce:true})` on change | The weather wand is hidden for guests. |
| Coins, shops, stickers, basket, cooking, outfits, photos, piano, TV shows, books | per player | per player | These never enter the host world. Buying changes only the buyer's profile. Placing a bought treat is an `e+`. |
| Gems | its own copy | its own copy | Not synced. Each player collects in her own copy, for her own profile. The host's saved gems never change because of guests. |
| Emotes and quick phrases | presence `em`, `ph` | presence | Phrases are ids into the receiver's own table (§11.6). |

**Held treats (wave 2).** If "hold it in your hand" is not part of `look`, add the optional
presence field `hi` (an item key) and draw it on remote avatars. Never send free text.

---

## 8. Host authority

### 8.1 Validation of guest outbox entries

The host processes entries in `lseq` order, once each, and only for admitted, non-banned peers
whose `ep` matches. Every op executes inside `net.exec(seat, fn)`, which sets:
- `remoteApplying = true`, so per-player listeners skip (§9.11);
- `noHistory = true`, so the host's Undo stack is untouched;
- the author to `seat`, so changes go to the author map and the seat log.

Every key an op names is **touched even when the op is rejected** (§5.6).

| kind | Checks, in order (the first failure gives its code) | Apply |
|---|---|---|
| `b` | rule `build`; rate cells. Per cell: in bounds; CAS `current === before`, or `current === after` (a no-op); `y === 0 && solid[before] && !solid[after]` → 5; `after` solid while the cell is occupied by an entity → 1; careful mode: `before ≠ 0 && !free(i, seat)` → 2 | `world.set(…, {record:true})` inside `world.batch` when > 8 cells. After a cell becomes `farmland_wet`: `garden.adoptWet`. |
| `e+` | build; rate; key registered; uid in the seat's range and unused; `data` ≤ 600 B JSON, depth ≤ 3; `canPlace(def, x, y, z, rot, null, {players:false})` → else 1 | `entities.place(…, {uid, history:false, events:true, fx:true})` |
| `e-` | build; exists; careful mode: author = seat, for the entity **and** every item standing on it → else 2 | `entities.remove(e, {history:false})` |
| `er` | build; exists; `rot === rotBefore` → else 1; careful: own; `canPlace` for the new rot, ignoring the entity itself, with players off | `_setRot` |
| `ed` | exists; patch keys ⊆ `ANY_FIELDS = {open, on, ch, art, bloom, conn}`, unless own or builder mode → else 2; ≤ 600 B | `setData` |
| `p+` | build; crop known; soil below is farmland; no plant there | `garden.addPlant(crop, x, y, z, 0, wetUntil)` |
| `ph` | a plant exists with the same crop and stage 3 → else 1 (allowed in careful mode: harvesting helps) | the same state change as `harvest()`, without the reward or fx |
| `p-` | exists and crop matches; careful: own → else 2 | `garden.removePlant` |
| `pf` | build; rate 1 per 20 s; plan exists; footprint inside the world edges (`EDGE`); `oy` within `[1, sy − H − 1]`; careful: every changed cell is `free`, and every entity the diff removes is own → else 2 | `game.prefabs.applyRemote(key, pl)`; host toast "Mia made a Flower Cottage!" |
| `pu` | the seat log holds the group for that `pf` | revert that group with CAS (as §8.4) |
| `z` | at most once per 60 s for the whole session → else 4 | `game.skipToMorning()` plus the toast |

Rejection codes: `1` conflict, `2` protected, `3` paused (rule `build` is 0), `4` limit,
`5` invalid.

**Rate limits** are token buckets per seat (§5.12). Each entry is charged **before** it is
applied: its cells, plus 1 for every non-cell op; a cost above the burst is capped at the burst.
- If the entry does not fit yet, processing of that peer's outbox pauses there, and the acks stop
  at the previous entry. The entry stays in her presence and runs when the bucket refills, so a
  very fast friend is slowed down without losing anything.
- `pf` and `z` are different: over their limit they are rejected with code 4 instead of waiting.

### 8.2 "Careful friends" protection (the default: rule `mine = 0`)

`free(i, seat)` is true when:
- `author.get(i) === seat` (she changed that cell this session); **or**
- the cell has no author and its current block is `classify(game).natural || tree || leaves ||
  plant || liquid` (from `prefabs/place.js`). This is the same notion of "not a player build"
  that the Magic House terrace ring already uses.

The author map on the host covers cells, entity uids and plant cells. Its values are **owner
keys** (Addendum B), not seats: `'u:' + uid` for a friend with a room stamp, `'p:' + peer`
for one without, `0` for the host. `free(i, seat)` compares with the seat's owner key.
- An executed guest op sets `author[key] = owner` for the cells it changed, and for the
  entities and plants it **added**.
- A host change **outside systems** (her taps, her Undo, a per-friend undo) sets
  `author[key] = 0` for the cells it changed and the entities and plants it added. That is
  protected, so the host's own builds from this session are protected, including
  natural-class blocks.
- A host change **inside systems** (rain, the end of her own Magic House animation) deletes
  a changed cell's key and gives an added entity or plant no owner, so the cell falls back to
  the natural-block rule. The house's building blocks are not natural, so they stay protected.
- **Only adding or removing changes an entity's or plant's owner.** Turning a piece, a data
  change (a tap on a lamp or door, a fence joining a neighbour, a railing opening for a
  bridge) and a plant's growth or harvest leave the owner as it was, inside a friend's op or
  not. Removing drops the key.
- Soil getting wet (`farmland` → `farmland_wet`, a watering can) or drying out again changes
  no owner either, and watering anyone's farmland is allowed in careful mode (like
  harvesting). A treat on a table (`placeOn: 'table'`, action `eat_food`) may be eaten
  (`e-`) by anyone.
- `conn` (fence joins) in a guest's `ed` is dropped: the host works joins out itself when
  blocks or pieces next to a fence change, and the entity goes back to the guest as a
  record.

Known limitation: pre-session host builds made of natural-class blocks (stone, dirt, sand,
grass, snow) are not protected. The per-friend undo (§8.4) and the backup (§13) cover them.

Entities with no author are protected. Toggle fields (`ANY_FIELDS`) are always allowed. With
rule `mine = 1` ("Friends can change my things"), everything is allowed except the bottom layer
and the world bounds.

### 8.3 Rules (host toggles, presence `ru`)

- **Friends can build** (default on). When off, the host rejects `b e+ e- er p+ p- pf` with
  code 3.
- **Friends can change my things** (default off; see §8.2).

The guest reads `ru`: `net.mayEdit()` is false while building is paused, and the Build and
Remove tools say "Lily paused building." When the host switches building off or on again,
the guest hears "Lily paused building." / "You can build again!" and, while it is off, a
small "Lily paused building" pill stays under the top bar. Hand-tool toggles, sitting,
sleeping, emotes and phrases always work. (In the Players panel the switches read
**Players can build** and **Careful players**.)

### 8.4 Per-friend undo (the **Undo building** button)

- **The friend's log.** The host keeps one log per owner key (Addendum B; a friend who takes
  a freed seat does not get the last friend's log): one group per executed entry, holding
  its first before and last after values per key. The log is in memory: after the host's
  page reloads, **Undo building** covers what the friend built since (the confirm says
  "since you came back").
  - Cells are stored as `Int32Array` idx plus `Uint8Array` before/after, which keeps prefabs
    cheap.
  - Entity and plant records are stored whole.
  - The log is capped at 2 MB per seat; beyond that the oldest groups are dropped and the
    backup still covers them.
- **Undo all.** It runs in the host's normal user scope, inside **one host history group**, so
  the host's own Undo can bring it back. It walks the groups newest to oldest and restores every
  key whose current value still equals its `after`, which keeps later work by the host or other
  friends. Entities come back only if `canPlace`.
- **Result.** The changes broadcast like any host change, and the log is cleared. The friend
  hears it kindly: `ctl {k:'tidy', e, to, n, at:[[x,y,z]…]}` → "Lily tidied up. Let's build
  something new together!" and sparkles at up to 6 of the places that went back.

### 8.5 Admission, full, deny, send home

- **Knock.** A viewer with `kn:1` who is not in `adm` or `no`:
  - wrong `v` or `pv` → `no v`;
  - uid banned this session → `no k`;
  - uid seated before in this session, or listed in `lastHost.uids` on resume → auto-admit to
    the same seat. The uid is the room's stamp (`by`) only, never a value from presence
    (Addendum B): a peer cannot copy a friend's uid into her own presence to skip the card;
  - 3 seats taken → `no f`;
  - otherwise → queue a **knock card** (§11.4), one card at a time.
- **Yes.** The host adds `adm [peer, lowest free seat]` and starts `lastLseq[peer] = 0`.
  **Not now** → `no d`.
- **Send home** (two-step confirm):
  - `no k`, `ban` the uid when it is not null, and remove the peer from `adm`;
  - ignore the peer's outbox from then on;
  - emit `ctl {k:'bye', to: peer, why:'kick'}` (best effort).
  The guest sees herself in `no` and leaves: "Time to go home! Let's play in your own world."
- **Seat hold.** A seated peer missing for 60 s loses the seat. The same uid returning later is
  auto-admitted to the same seat if it is free, or to another free seat.

---

## 9. Game integration: the hooks

Every hook is inert when `!game.net?.active`, so single-player behaviour stays byte-for-byte
the same and `npm run smoke` must keep passing. Hooks never import `src/net/*`: they only call
`game.net?.…` or a callback property that the adapter sets.

### 9.0 `GameAdapter`: the frozen boundary between the net core and the game

`src/net/adapter.js` (Agent B) implements it over the real game. `tools/net/fake-adapter.mjs`
(Agent A) implements it over plain arrays and Maps for the Node tests. `host.js` and `guest.js`
call nothing else in the game.

```js
/** @interface GameAdapter */
{
  // ---- lifecycle ----
  attach(role, hooks),   // role 'host' | 'guest'. Installs world.onCell, entities.onChange,
                         // garden.onChange and the actor touch; sets entities.uidBase
                         // (guest: seat * 1e6), pets remote mode and weather.auto = false (guest).
                         // hooks = {
                         //   cell(i, prev, id),
                         //   ent(kind, uid, before, after),   // 'add': null, rec | 'del': rec, null |
                         //                                    // 'rot': rotB, rotA | 'data': dataBefore, patch
                         //   plant(kind, i, before, after),   // 'add' | 'del' | 'stage' | 'harvest';
                         //                                    // before/after = [crop, stage] | null
                         //   actor(kind, id) }                // host only
  detach(),

  // ---- reading current values (host encodes batches, fixes and hashes from these) ----
  size(),                              // { sx, sy, sz }
  getCell(i), coords(i),               // id; [x, y, z]
  entityRecord(uid),                   // [uid,key,x,y,z,rot,color|0,data|0,yo,ro] | null
  plantRecord(i),                      // [i,crop,stage,wet] | null
  actorRecord(kind, id),               // [kind,id,rec] | null
  actorSamples(),                      // { pt: [...], nx: [...] }
  isFree(id),                          // classify(): natural || tree || leaves || plant || liquid
  isSolid(id), occupied(i),            // occupied: an entity covers cell i
  entityHash(), plantHash(),           // uint32 (the block hash is kept by net via the cell hook)
  maxUidInRange(lo, hi),

  // ---- snapshot ----
  makeSnapshot(),                      // { json, rle: Uint8Array }; state at the call
  enterSnapshot(json, rle),            // Promise<boolean>; guest: game.enterSharedWorld

  // ---- guest: silent apply of host data (inside remoteApplying) ----
  applyPayload(p),                     // order: X, c/g (world.batch), E (tables first), P, K;
                                       // then 'net:applied' + unstick; -> { cells, ents }

  // ---- host: execute validated guest ops (called inside net.exec(seat)) ----
  setCells(pairs),                     // [i, id, i, id, ...]; record:true; batch when > 8
  canPlaceEntity(key, x, y, z, rot, ignoreUid),   // players ignored
  placeEntity(rec), removeEntity(uid), rotateEntity(uid, rot), patchEntity(uid, patch),
  ridersOf(uid),                       // uids of items standing on it
  plantAt(i), soilOk(i),               // [crop, stage] | null; farmland under the cell
  addPlant(crop, x, y, z), removePlant(i), harvestPlant(i), adoptWet(i),
  prefab(key, pl, policy),             // { ok, code }  (game.prefabs.applyRemote)
  skipToMorning(),

  // ---- environment (both roles) ----
  local(),                             // { p, st, nm, lk } for my own presence
  time(), applyTime(tm, ageMs),        // [dayTime, day, frozen]
  weather(), applyWeather(kind),
  toast(text, icon), celebrate(kind, x, y, z), unstick(),
}
```

### 9.1 `game.net` facade (`src/net/index.js`)

```js
game.net = {
  available, active, state, role,        // role: null | 'host' | 'guest'
  get isHost(), get isGuest(),
  remoteApplying,                        // guest: applying host data; host: executing a guest op
  noHistory,                             // host exec scope: history calls are no-ops
  hostFrozen,                            // guest: the host's timeFrozen flag
  host(opts), join(code), leave(opts),   // async
  mayEdit(tool),                         // 'hand' always true; 'build'/'remove' on a guest:
                                         // g.live && ru.build; host/solo: always true
  cellHasFriend(x, y, z),                // any remote avatar's AABB overlaps the cell
  intent(kind, args) -> lseq,            // guest: 'pf' | 'pu' | 'z'
  frameEnd(),                            // Game._frame end: guest recorder flush
  players(),                             // [{ peer, seat, name, you, host, pos:[x,y,z] }]
  code,                                  // ['heart','star','moon','cat'] | null
  actors,                                // actor registry (§9.8)
};
game.debug.net = { state, role, code, seq, ap, pend, outbox, hash, stats, peers,
                   admitAll, kick, undoSeat, setRules, corruptCell /* test only */ };
```

### 9.2 `src/core/game.js`

- **`serializeWorld({thumbnail})`** is new and factored out of `saveWorld`; it returns the save
  object. `saveWorld` uses it.
- **`saveWorld()`**: first line `if (this.net?.isGuest) return { ok: true, skipped: true };`.
  This covers `flushSave`, `_unloadWorld` and the autosave.
- **`enterSharedWorld(save, rle)`** is new and runs under `_busy`:
  - `new World(save.size, this.registry.blocks)`, then `decodeBlocksBytes(rle, save.palette)`,
    meta from `save` (`id = 'net-' + words.join('-')`), `waterLevel`, `outside`,
    `computeAllLight`;
  - then `_enterWorld(world, save, {shared: true})`, with `save.player` set to 2 blocks in front
    of the host (`save.net.host`), or to the spawn when that is unknown;
  - afterwards `unstickPlayer()`;
  - the hotbar is `DEFAULT_HOTBAR`.
- **`_enterWorld(world, save, opts)`**: when `opts.shared`, skip `profile.lastWorldId`, the
  autosave interval and `_warnSaveTrouble`.
- **`_updateSystems`**: set `this._inSystems = true` before the loop and `false` in a `finally`.
- **`_frame`**: at the end, `this.net?.frameEnd()`.
- **`pushHistory`, `beginHistoryGroup`, `endHistoryGroup`**: first line
  `if (this.net?.noHistory) return;`.
- **`placeBlock` / `removeBlock` undo and redo closures**: when `this.net?.active`, apply only
  if the cell still holds the value this action wrote (CAS). Otherwise skip it silently. In
  single-player the LIFO order makes this always true.
- **`placeBlock`**: refuse a solid block when `this.net?.cellHasFriend(x, y, z)`.
- **`useTarget`, `removeTarget`, `_strokeStart`**: if `this.net && !this.net.mayEdit(tool)`,
  play the nope sound, show the toast from §12, and return false.
- **`skipToMorning()`**: if `this.net?.isGuest && !this.net.remoteApplying`, call
  `this.net.intent('z')`, then continue locally (prediction).
- **`_advanceTime`**: `frozen = this.net?.isGuest ? this.net.hostFrozen :
  this.profile.settings.timeFrozen`.
- **`exitToTitle()`**: `if (this.net?.active) await this.net.leave({ quiet: true });` before
  unloading.
- **`unstickPlayer()`**: a public alias of `_unstickPlayer`.

### 9.3 `src/world/world.js`

- **`this.onCell = null`**. In `set()`, right after `this.blocks[i] = id;`:
  `if (this.onCell !== null) this.onCell(i, prev, id);`. This covers `batch`, `writeCells`,
  `entities.place` grass-clearing, garden tilling, drying and undo.
- **`encodeBlocksBytes()`** / **`decodeBlocksBytes(bytes, palette)`**: the current base64
  functions become thin wrappers around these.

### 9.4 `src/things/entities.js`

- **`this.onChange = null`**, called at the end of:

  | Call | Hook |
  |---|---|
  | `place` | `('add', e)` |
  | `remove` | `('del', record)` |
  | `rotate` / `_setRot` | `('rot', e, rotBefore)` |
  | `setData` | `('data', e, patch, dataBefore)` (copy taken before `Object.assign`) |

- **Uid allocation.** Add `uidBase` (default 0) and `allocUid()`. In `place`, use
  `uid ?? this.allocUid()`, and bump `nextUid` only when
  `floor(uid / 1e6) === floor(uidBase / 1e6)`. `clear()` resets `uidBase` to 0.
- **`canPlace(def, x, y, z, rot, ignore, opts = {})`**: `opts.players === false` skips the
  player-overlap test.
- **`place()` opts**: `yOffset` and `restsOn` overrides, used for remote records.
- **`remove(e, opts)`**: `opts.riders === false` skips the cascade to items on top. The guest
  apply path uses it, because the host sends the riders' own removals.
- **The undo closure of `remove`**: re-place with `force: !game.net?.active`. When a session is
  active, re-place only if `canPlace` (players off); otherwise skip.

### 9.5 `src/things/prefabs.js`

- **`build(plan, pl)`** on a guest, when not `remoteApplying`:
  - `lseq = net.intent('pf', [key, ox, oy, oz, rot])`;
  - `startJob(plan, pl, {visualOnly: true, lseq})`;
  - the placeholder's `undo` calls `net.intent('pu', [lseq])` and cancels the job.
- **`commitJob`** for a visual-only job: do not commit. Keep the pop-in mesh until
  `game.prefabs.resolveRemote(lseq, ok)` is called, or for at most 10 s. `guest.js` calls it when
  it applies the ack for that lseq: `ok` is true unless an `r` entry for it arrived.
  - ok: the "Ta-da! Your X is ready!" toast, the `prefab:place` event (her sticker), and the
    mesh is dropped once the chunks are clean.
  - not ok: "The magic fizzled! Something of Lily's is in the way.", and the mesh is dropped.
- **`game.prefabs.applyRemote(key, pl, policy)`** (host):
  - `plan`, the bounds from `footprintBounds`, then `computeDiff`;
  - `policy(diff)` → false means reject with code 2;
  - `commit(plan, pl)`. History is suppressed by `noHistory`, and `moveOut` may move the host.
  - Sparkles and confetti play at the bounds.
- **The `commit` undo closure**: `writeCells` becomes CAS when `game.net?.active`, restoring
  only the cells whose current value is still `next[k]`.

### 9.6 `src/things/garden.js`

- **`this.onChange = null`**, called in `addPlant` (`'add'`), `removePlant` (`'del'`) and
  `_setStage` (`'stage', before`). Inside `harvest()` it reports `'harvest'` instead: set
  `this._harvesting = true` around the remove or stage change.
- **`update()`**: when `game.net?.isGuest`, skip growth, drying and rain watering. Wiggle, bounce,
  sparkles, watering cans, flyers and `_checkDormant` keep running.
- **`adoptWet(x, y, z)`** (host): add a wet timer and set the plant's `wetUntil`.
- **`applyRemote(rec)`** (guest): add, remove or set the stage silently, with no history or
  events.

### 9.7 `src/things/pets.js`, `src/things/pets/pet.js`

- **`sys.remote`** (true on guests): `update()` skips the AI and calls
  `pet.puppet(dt, sample)`, which lerps the position and yaw, sets pose flags from `st`, then
  calls `_post(dt)`.
- **`sys.onChange`**, called in `_add`, `remove`, `setMode` and `setName`. Add a handle `pet.h`,
  a session counter.
- **Guest refusals** (toast §12): the adopt item's `use`, `feed`, `mount`, `setMode`, `call`,
  `sendHome`, rename, and the `pets` panel actions. `petPet` and `tickle` keep their local
  cosmetics.

### 9.8 `src/net/actors.js`

This generic actor registry keeps NPC friends out of net code:
```js
game.net.actors.register(kind, {
  list(),                          // host: current actors
  idOf(a),
  record(a),                       // serialize() without position, plus h
  sample(a),                       // [h, x, y, z, yaw, st(, line)]
  applyRecord(id, rec | null),     // guest
  applySamples(samples),           // guest (called every frame with the interpolation target)
  setRemote(bool),
});
```
Pets register as kind `pet`. **Wave-2 NPC friends must register as kind `npc` and call
`game.net?.actors.touch('npc', id)` on create, remove and record changes.**

### 9.9 `src/life/weather.js`

- On guests the net layer sets `game.weather.auto = false`.
- Recommended, and cosmetic only: listen for `'net:applied' {cells}` and call
  `heightmap.setColumn` for each cell, so rain stops falling inside a friend's new roof.

### 9.10 `src/life/collectibles.js`

Recommended: on `'net:applied'`, run the unbury check for placed cells, which is cosmetic.

### 9.11 Per-player listener guards

In `src/life/stickers.js`, `src/things/cooking/basket.js` and `src/ui/touch.js`, every
world-event listener (`block:*`, `entity:*`, `prefab:place`, `garden:*`, `pet:*`) starts with
`if (game.net?.remoteApplying) return;`.

**This is a contract for all current and wave-2 code: any listener that changes the local
player's profile (stickers, stats, coins, basket, tutorial) must return early when
`game.net?.remoteApplying` is set.**

Guests apply host data silently (`record:false`, `events:false`) and emit one `'net:applied'
{cells: [x,y,z,…] (≤ 2,048 entries, else null), entities: n}` per applied batch. The host
executes guest ops with the normal events on, so derived listeners such as fence joining run
exactly as in single-player.

### 9.12 `src/core/storage.js`

- `listWorlds()` excludes ids ending in `.before`.
- `listBackups()` is new.
- `deleteWorld(id)` also deletes `id + '.before'`.
- `restoreBackup(id)`: load `.before`, then `saveWorld({...b, id, updatedAt: now})`; the backup
  is kept.

### 9.13 UI files

- **`src/ui/menus.js`**:
  - Title tile **Friends** (`button.sw-tile--friends`), which opens panel `mp-start`. It is
    shown when `game.actions.has('mp-friends') && game.net.available`, and refreshes on
    `'net:state'`.
  - Title chips **Keep playing** and **Join Lily** (§6, §11.1).
  - Pause panel: **Invite Friends** (not in a session), **Friends** (host), **Go home** (guest;
    this replaces the label of Save & Exit). Labels refresh `onOpen`.
  - My Worlds card button **Before friends**, shown while a backup less than 7 days old exists,
    with a two-step confirm.
- **`src/ui/hud.js`**:
  - A round **Friends** button (`[data-action="mp-friends"]`) with a count badge, in the
    top-right group before Menu.
  - A **Say** button (`[data-action="mp-say"]`) in the right extras after Emotes.
  - Both show only while `game.net?.active`, refreshed on `'net:state'` and `world:load`.
- **`src/ui/settings.js`**: hide the weather wand, the time of day and Freeze time when
  `game.net?.isGuest`.
- **`src/ui/icons.js`**: new icons `friends`, `talk` and `knock`. The code pictures live in
  `src/net/pictures.js`.

### 9.14 Build and boot

- **`tools/build.mjs`**: `define: { __SW_BUILD__: '"<8 hex>"' }`, the sha1 of every `src/**`
  file's path and content plus the `three` package version. The dev server uses
  `'dev-' + the same hash`.
  Peers must have an equal `pv` to play together.
- **`src/main.js`**: the install order becomes `… collectibles, stickers, net, hud, inventory,
  dressup, touch, settings, photo, stickerbook, menus`. `net` needs entities, prefabs, pets,
  garden and weather already installed, and hud and menus read its actions.

### 9.15 Documentation

Implementers add a DESIGN.md §5 "Playing with friends" that points to this file and states the
rules below, plus `docs/teams/net.md`.
- Every world-state change goes through `World.set`, `entities.*`, the garden API or a
  registered actor.
- No `update()` mutates world state on guests.
- Per-player listeners check `remoteApplying`.

---

## 10. Capabilities and storage

Publish with:
```js
capabilities: {
  db: {},                                  // unchanged: default rules; data/users/<id>/ stays private (cloud saves)
  user: { scopes: ['profile'] },           // ids (Sender.by, bans, auto-readmit) + account names on the knock card
  downloads: {},                           // unchanged ("Save to a file")
  room: { topics: { 'sw.op': 'interact', 'sw.bulk': 'interact', 'sw.ctl': 'interact' } },
}
```

- **Topics.** 3 of the 16 are used. Opening them to `interact` lets a Contributor host her own
  world. Guests never need send rights. Spoofing by another Contributor is harmless, because
  receivers accept these topics only from the host peer they follow (§5.3).
- **db.** No new paths, rules or documents.
  - The host world keeps saving through the existing `SaveStore` to
    `data/users/<hostUid>/profile/worlds/<id>` and `…/worldparts/<id>-<i>`.
  - The backup is the same kind of save under the id `<id>.before`: at most 3 more documents
    per hosted world, overwritten each session and deleted with the world.
  - `profile.net` lives in the profile document.
  - Guests never write any host data.
- **Republishing** with the new `user` scope and `room` changes the consent prompt, and reloads
  every open view (F10). Publish when nobody is playing.

---

## 11. UI flows (iPad first)

Every new control has an icon and a 1–2 word label. Buttons are ≥ 88 px, or ≥ 80 px on screens
narrower than 400 px. Nothing needs a keyboard or pointer lock. There is exactly one modal panel
at a time; the knock card and message cards are non-modal. The DOM hooks in parentheses are for
tests.

### 11.1 Title → Friends (panel `mp-start`, `.sw-net-start`)

Two big cards. Each has an icon, a 1–2 word label and one small line under it:
- **Join** (`.sw-net-join`), "Visit a friend's world", opens the keypad.
- **Invite** (`.sw-net-invite`), "Friends come to your world":
  - if a last world exists, it loads that world, then starts hosting;
  - else it shows "Make a world first!" and opens New World.

Resume chips appear above the cards when valid:
- **Keep playing** (host), with the small line "with your friends" (on the title it is the
  big first button);
- **Join Lily** (guest), with the small line "again". If nobody is playing with its code any
  more: "Lily isn't playing right now. Ask her for a new code!" and the chip goes.

The first time she uses Play with Friends while her name is still the game's starting one
(`profile.nameSet` unset and the name equal to the default look's "Lily"), a "What's your
name?" dialog comes first. Until then her presence `nm` is empty (others see "Friend").

In a world, the pause menu's **Play Together** (`.sw-pause-invite`) opens this card; it never
makes a code by itself. Make a Code there hosts the open world. While `lastHost` is fresh for
the open world, hosting reuses its code and uids (a resume), and opening that world with
**Play** asks "Your friends are waiting! Open your door again?" (`friends_waiting`).

### 11.2 Keypad (panel `mp-join`, `.sw-net-keypad`)

- A 4×3 grid of the 12 pictures (`.sw-net-key[data-pic]`), each read aloud on tap when "Read
  words out loud" is on.
- 4 big slots (`.sw-net-slot`), **Back** (`.sw-net-back`), **Clear** (`.sw-net-clear`), and a
  big **Go** (`.sw-net-go`) enabled once 4 pictures are chosen.
- It fits 768×1024 portrait and 390×844.

### 11.3 Joining cards (guest)

- "Looking for your friend…"
- "Knock knock! Waiting for your friend to say yes…" with **Cancel** (on the Railway relay
  the host's name is not shown to a player who is not let in yet: Addendum B)
- "Flying to Lily's world…" (the loading card with chunk progress)
- then play, with the toast "You're in Lily's world!"

Other players see "Mia is here!" with a sparkle burst at her avatar once she has arrived
(not while she is knocking or loading: her row says "Flying here…" until then). She does not
get a "Lily is here!" for the host of the world she flew into.

### 11.4 Knock card (host, `.sw-net-knock`)

- Non-modal, top-centre below the toasts, shown even over panels.
- It shows the friend's avatar head (`getStage().snapshot` of the unpacked look), "**Mia** wants
  to play!", and in small print the account name from `user.profiles([by])` plus a "visitor"
  badge when `guest` is true, both set with `textContent`.
- Two buttons: **Come in!** (`.sw-net-yes`) and **Not now** (`.sw-net-no`).
- A queue shows one card at a time. The card disappears if the friend leaves. A card that was
  up for a minute or more and then went away (she gave up after 90 s) leaves the toast "Mia
  knocked while you were busy. She can knock again!".
- A name that someone playing already has is shown with a number ("Lily 2"), on the card and
  in the Players list.

### 11.5 Friends panel (`mp-friends`, action `mp-friends`, width 520, fullscreen on phones)

- **Host:**
  - The code as 4 big picture tiles with their words, and "Say these pictures to play together!".
    For grown-ups, small print shows "sw1-heart-star-moon-cat".
  - One row per player (`.sw-net-row[data-seat]`): head, name, account name in small print,
    "visitor" badge, **Undo building** (`.sw-net-undo`, two-step), **Send home**
    (`.sw-net-kick`, two-step).
  - Toggles **Players can build** (`.sw-net-rule-build`) and **Careful players**
    (`.sw-net-rule-careful`, on = `mine 0`).
  - **Stop playing** (`.sw-net-stop`), with a confirm: "Stop playing together?".
  - The HUD's **Players** button shows a game pad (the NPC friends' button shows two girls).
- **Guest:** the player list (the host marked with a crown) and **Go home**.

### 11.6 Say (quick phrases, panel `mp-say`, action `mp-say`, key T)

- A 4×4 grid (`.sw-net-phrase[data-id]`) of 16 phrases with icons:
  `Hi! · Come here! · Look! · Follow me! · Let's build! · Wow! · So pretty! · Thank you! ·
  Help please! · Let's dance! · Race you! · Yes! · No thanks · Oops! · Good night! · Bye!`
- Only the id is sent (`ph`), and receivers show text from their own table. Ids outside 0..15
  are ignored. At most one phrase per 2 s.
- The bubble shows over the avatar for 4 s, and is read aloud with `game.speak` when read-aloud
  is on.
- Emotes keep using the existing wheel, and `em` sends them.

### 11.7 End of session (host)

A dialog: "Playing together is over! Everything is saved." with **Great!** and a small
secondary **Before friends**. That restores the backup with a two-step confirm. The first shows
the copy's picture and says what goes: "Your world goes back to this copy from today.
Everything built since then goes away, also what you built." (**Yes, go back** / **No, keep
it**). The world as it was is kept as `<id>.undo`, the backup is used up, and the card after it
has **Undo** ("Changed your mind? Undo brings back what was there."). The same **Before
friends** button is on the world's card in My Worlds as a small white button with "Copy from
<day>", while the backup is younger than 7 days **and nothing was built alone since**: once a
change she made alone in that world is saved, the backup is deleted (Addendum B, §13).

### 11.8 Names

`sanitizeName(s)`:
1. NFKC.
2. Keep Unicode letters, space, `-` and `'`; drop the letters that draw nothing (U+115F,
   U+1160, U+3164, U+FFA0) and keep at most 2 combining marks on a letter.
3. Collapse spaces and trim to 12 characters.
4. If the result is empty or in the blocklist (`src/net/names.js`, lowercase, compared without
   spaces and accents, Cyrillic / Greek look-alike letters read as Latin), use "Friend".

It is applied to `nm`, remote pet names (falling back to the species name) and the guest's world
name (`"<name>'s World"`). Nothing a child typed is shown to others unless it passed this
function. Easel pictures (16×16 pixels) are the only free drawing; the host can undo them.

---

## 12. Failure handling (friendly messages, never error codes)

| Situation | What the child sees | Where |
|---|---|---|
| `room` unavailable / file:// / signed out | Friends buttons hidden | title, pause |
| `canHost === false` or probe `not_permitted` | "You can join a friend's world!" · small: "Grown-ups: inviting friends needs Contributor access to Sparkle World." | card |
| join `no_rooms` | "Playing together isn't turned on for this account. Ask a grown-up!" | card |
| `busy` (limit) | "Lots of games right now! Try again in a minute." | card |
| `transient` after retries | "The magic mail is slow. Try again?" [Try again] | card |
| no host within 8 s | "Nobody is playing with those pictures. Check them with your friend!" (the keypad stays open with her pictures) | keypad |
| no host for a **Join Lily** chip | "Lily isn't playing right now. Ask her for a new code!" (the chip goes; it stays after "went home" and "Playing together stopped." in case she comes back with the same pictures) | card |
| `pv` or `v` mismatch | "Your game needs a refresh!" [Refresh] (`location.reload()`) | card |
| denied ("Not now") | "Lily can't play right now. Maybe later!" | card |
| knock not answered in 90 s | "Lily didn't hear the knock. Knock again?" [Knock again] | card |
| full | "Lily's world is full of friends right now!" | card |
| snapshot failed twice | "The world got lost on the way. Let's try again!" [Try again] | card |
| disconnected > 2 s | small cloud badge "Reconnecting…"; the world stays playable | HUD |
| host `zz` or missing | "Lily is taking a little break…" (non-blocking) | card |
| host gone 60 s / `end` | "Lily went home. Her world is saved at her house!" → title | card |
| sent home | "Time to go home! Let's play in your own world." → title | card |
| building paused / on again | "Lily paused building." / "You can build again!" (+ a pill while paused) | toast |
| rejected: conflict | "Oops! Someone else changed that." | toast (≤ 1 per 4 s) |
| rejected: protected | "That's someone else's! Build your own next to it." | toast |
| rejected: limit | "Slow down, sparkle builder!" | toast |
| Magic House rejected (protected) | "The magic fizzled! Something of Lily's is in the way." | toast |
| Magic House too soon (code 4) | "The magic needs a little rest! Try again in a moment." | toast |
| Magic House: the place changed (1, 5) | "Oops! Something changed there." | toast |
| the host's Undo building | "Lily tidied up. Let's build something new together!" + sparkles | toast |
| pet/NPC action as guest | "That's Lily's pet! Ask her to help." | toast |
| backup could not be written | "Your world couldn't make a safety copy, so friends can't come in right now." | card |
| fatal (`revoked`, …) | "Playing together stopped." → single player | card |

`Lily` here is the host's sanitized `nm` ("your friend" while it is not known). Before a
guest was ever in the host's world (wrong code, "Not now", no answer, full, version), the
session ends quietly where she was (the keypad keeps her pictures); after, she goes back to
the title.

---

## 13. Host data safety

1. **Guests never persist the host world.** The `saveWorld` guard, `enterSharedWorld` without
   store calls, and `profile.lastWorldId` untouched.
2. **A backup before anyone joins** (`<id>.before`). Hosting does not start unless it is there.
   A backup that is still good (younger than 7 days) is **kept**, never overwritten: "Keep
   playing" after a reload, a second Invite and a new code the same week all go back to the
   world from before friends first came. Once a change she made **alone** in that world is
   saved, the backup is deleted (restoring it would throw her own work away); the next
   hosting makes a fresh one. A restore keeps the world as it was as `<id>.undo` (Undo on the
   card) and uses the backup up.
3. **Local saves every 15 s while hosting**, plus the existing `flushSave` on hidden and
   pagehide, and the existing 60 s cloud throttle. A crash loses at most 15 s, where
   single-player loses up to 45 s.
4. **Every guest edit is checked.** Compare-and-set, careful-friends protection, rate limits,
   and a building pause switch.
5. **Undo at three levels.** Each friend's own Undo is local and CAS-guarded. **Undo building**
   works per friend and can itself be undone. **Before friends** restores the backup, and
   can itself be undone once.
6. **Guest edits never enter the host's Undo stack** (`noHistory`), and the host's own Undo
   closures are CAS-guarded, so neither side's Undo blindly erases the other's later work.

---

## 14. Performance budget (2019 iPad)

- **Remote avatars:** at most 3 × about 33 draw calls. They are hidden beyond 64 blocks and use
  no per-frame allocations (a pooled sample ring per peer). Look changes are applied at most
  once per second (`setLook` takes 2–8 ms).
- **Host tick work:** under 1 ms typical.
- **Snapshot build:** 20–40 ms once per join, reused for 60 s. `CompressionStream` runs natively.
- **Hash:** one multiply per `World.set`. The full scan (about 20 ms) runs only at a join or host
  start. The entity hash takes under 2 ms every 10 s.
- **Remote edits:** applied inside `world.batch` (one relight). Chunk meshing stays time-sliced
  (≤ 6 ms per frame). A single region above 20,000 cells is applied over consecutive frames.
- **Bandwidth per viewer:**

  | Activity | Rate |
  |---|---|
  | Typical play | 5–15 KB/s |
  | Building bursts | ≤ 60 KB/s |
  | Join | 30–110 KB once |

---

## 15. Tests

### 15.1 Node unit and property tests (`tools/test-net.mjs`, no browser)

- **`FakeAdapter`** (`tools/net/fake-adapter.mjs`) implements `GameAdapter` over a `Uint8Array`
  of cells, an entity `Map` with the same place, remove, rotate and data rules (a footprint
  occupancy check), a plant `Map`, and actors.
- **`LoopTransport`** hub, with every limit enforced (3,900 B, 1,000 B strings, identifier keys,
  budget 40/s burst 80) and faults: 30% emit drop, 0–800 ms delay, reorder, 5% duplicates,
  presence coalescing to 30 Hz latest-wins, random 3 s partitions.
- **Unit tests:**
  - codec round trips (cells, regions, look for every option, snapshot framing and crc);
  - chunk and message sizes never above the limits;
  - an incremental hash equal to a full scan after 10,000 random sets.
- **Property test:** 1 host and 3 guests, 5,000 seeded random actions, run 20 seeds.
  - The actions: strokes, the same cell edited at once, furniture place, rotate and data,
    table-top items, guest Undo, plant, harvest, prefab intents on the fake, host sims, host
    Undo, "undo seat", kick, a guest reload, a host epoch restart.
  - After 10 s of quiet, assert:
    - equal cells, entities and plants on every peer;
    - empty outboxes and pend maps;
    - every guest entry processed exactly once (a counter);
    - no message over the limits;
    - no page over the budget;
    - nothing changed by a kicked seat after its kick.

### 15.2 Headless multiplayer probe (`tools/probe-multiplayer.mjs`)

- **Setup.** It reuses the `tools/smoke.mjs` exports (`launch`, `attachErrorCollectors`,
  `waitForTitle`, `waitForPlay`, `waitIdle`, `shot`, `finish`, `screenPoint`) and builds its own
  contexts, one per player, so each has its own IndexedDB. The host context is desktop
  1280×800; one guest is an iPad (1024×768, `hasTouch`); an optional third is a phone (390×844).
- **Fake `window.claude`** (`tools/net/fake-claude.js`, installed with `context.addInitScript`
  before load). `use()` returns:
  - `room`: implements room.d.ts faithfully:
    - `join`, `emit`, `on`, `presence`, `peers`, `onPeers` (at most once per frame, net
      `joined`/`left`/`updated`, frozen snapshots), `connected`, `onConnection`, `leave`;
    - Sender stamping (`peer`, `by`, `isMe`, `sameTab`, `kind`, `guest`);
    - the topic and room-name grammars;
    - 4 KiB emit and merged-presence checks that reject `invalid_argument`;
    - per-page levels (`admin` / `interact` / `view`): an emit below a topic's level rejects
      `not_permitted`;
    - the send budget (40/s, burst 80): emits past it are dropped and `reportError` is called
      once, which the test counts as a failure.
  - `user`: per-page `id`, `can('data.write')` (host true, guest `null`), `profiles`,
    `canEdit`.
  - `db`: null, so storage stays local.
- **Delivery.** Pages call `window.__swHub(json)` (`context.exposeBinding`), and a Node
  `NetHub` (`tools/net/hub.mjs`, shared with the unit tests) routes messages. It delivers with
  `page.evaluate(m => window.__swFakeRoomDeliver(m), msg)` and supports the §15.1 faults plus
  `partition(page, ms)`, `revoke(page)` and `newVersion()` (reload every page and empty the
  rooms).
- **Manual two-tab dev** uses `?net=loop` (the BroadcastChannel `LoopTransport`).

### 15.3 Acceptance tests (all must pass; each ends with `debug.net.hash()` equal on all pages and zero console errors)

| # | Scenario | Pass when |
|---|---|---|
| AT1 | The host starts a world, Pause → Invite Friends, and reads the code tiles. The guest uses Title → Friends → Join → taps 4 pictures on the keypad (touch) → Go. The host taps **Come in!** | Both in play within 15 s; the guest avatar is visible to the host and the host's to the guest. |
| AT2 | The guest paints a 10-cell hold-drag stroke with real pointer events, then Undo. | The host sees 10 cells within 1 s; after Undo both are back to the original. |
| AT3 | The guest places a bed and rotates it before the ack. | The same record on both; uid in [1,000,001, 2,000,000). |
| AT4 | Careful mode: the guest opens the host's door (allowed) and removes a host-placed wall block (protected). | Door open on both; the wall reverts on the guest within 1 s, with one "That's Lily's!" toast. |
| AT5 | The guest builds a Flower Cottage on grass, then Undo. | The house appears on all pages with its furniture; Undo removes it everywhere; the host's history length is unchanged. |
| AT6 | The guest plants carrots, waters them; the host runs `debug.garden.grow(200)`; the guest harvests. | The guest's basket has +2 carrots; the plant state is equal; the host basket is unchanged. |
| AT7 | The host taps **Undo building** for the guest. | The guest's cells and furniture are gone; host edits made after hers are kept; the host's Undo brings them back. |
| AT8 | **Send home.** | The guest is on the title with the message; her later outbox is ignored; her knock is auto-refused. |
| AT9 | Chaos: 30% emit drop, 0–800 ms delay, reorder, 5% duplicates, 60 s of random `debug.useAt`, furniture and stroke edits by host and 2 guests. | Everything equal within 10 s of quiet; outboxes and pend empty; 0 resyncs. |
| AT10 | Partition a guest for 5 s during a castle build. | "Reconnecting…" shown and hidden; converges. |
| AT11 | A third player joins after 300 edits. | Converges; snapshot < 5 s. |
| AT12 | Reload the host page mid-session → **Keep playing**. | New epoch; guests resync; the host world holds every edit acked before its last local save. |
| AT13 | `newVersion()` | Both pages show their resume chips; rejoin works. |
| AT14 | View-level guest. | The hub saw 0 emits from guest pages. |
| AT15 | Budget and sizes over a 60 s building session. | No page > 40 sends/s or > 80 in any 1 s window; no emit or presence > 3,900 B; no string > 1,000 B; no `reportError`. |
| AT16 | Storage spy. | The guest never calls `store.saveWorld` with an `id` starting `net-`; the guest profile (stickers, basket) is saved. |
| AT17 | Phrases and emotes. | The bubble and emote show on the other page within 1 s. |
| AT18 | Time and weather: the host sets rain and night; the guest sleeps in a bed. | The guest follows rain and night; after sleeping it is morning on both. |
| AT19 | Pets. | Host pets move on the guest; the guest can pet (local hearts); adopt and ride show the toast. |
| AT20 | Safety net: `debug.net.corruptCell` on the guest. | A resync within 25 s; equal afterwards. |
| AT21 | UI screenshots `.shots/net-*.png` at 1024×768, 768×1024 and 390×844: keypad, knock card, Friends panel, remote avatar with name and bubble, Say panel, message card. | Nothing clipped; no HUD button shows through open panels. |
| AT22 | `npm run smoke` with net installed and no session, plus a regression for old saves: uids < 10⁶ keep bumping `nextUid`. | Passes unchanged. |

### 15.4 Manual, real artifact (after the spike)

- The owner hosts on an iPad. A Contributor member joins on a laptop. An outside guest invited
  by email at Viewer level joins on a second iPad.
- Check: join, knock, presence-only building, real latency, `reportError` never fires, and
  republishing mid-session leads to the resume chips.

---

## 16. Implementation plan

**Task 0: platform spike. It blocks the release, not the coding.** Publish a tiny test artifact
with `room` (one topic opened to `interact`) and `user`. Using the owner's account and an
outside account invited by email as Viewer, record:
- can the Viewer `join` a named room;
- set presence;
- is her emit refused with `not_permitted`;
- how fast presence moves.

If named rooms are refused for outside Viewers, v1 still works among members of one
organization (a family Team). Tell the family.

**Three parallel agents with disjoint files.** Every interface they share is defined in this
document (§4.1 NetTransport, §5 protocol, §9.0 GameAdapter, §9.1 facade, §9.2–§9.12 hooks) and
is frozen before work starts.

- **Agent A, net core (no game files):**
  - `src/net/transport.js`, `room-transport.js`, `loop-transport.js`, `protocol.js`
    (including the `GameAdapter` typedef), `codec.js`, `journal.js`, `host.js`, `guest.js`,
    `session.js`;
  - `tools/net/hub.mjs`, `tools/net/fake-adapter.mjs`, `tools/test-net.mjs`.
  - Done when §15.1 passes.
- **Agent B, game integration:**
  - `src/net/adapter.js`, `src/net/actors.js`;
  - every hook in §9.2–§9.12: `core/game.js`, `world/world.js`, `things/entities.js`,
    `things/prefabs.js`, `things/garden.js`, `things/pets.js`, `things/pets/pet.js`,
    `life/weather.js`, `life/collectibles.js`, `life/stickers.js`, `things/cooking/basket.js`,
    `ui/touch.js`, `core/storage.js`;
  - `tools/build.mjs`, `docs/DESIGN.md` §5 and `docs/teams/net.md`.
  - Merges first. It is behaviour-neutral without a session: smoke and every team probe must
    pass.
- **Agent C, UI, avatars and end-to-end:**
  - `src/net/index.js`, `ui.js`, `remote-players.js`, `pictures.js`, `names.js`;
  - `src/main.js`, `ui/menus.js`, `ui/hud.js`, `ui/settings.js`, `ui/icons.js`;
  - `tools/net/fake-claude.js`, `tools/probe-multiplayer.mjs`.
  - Builds against A's `LoopTransport` and B's adapter as they land.

**Order.** Task 0 runs in parallel. Then A, B and C in parallel. Merge B, then A, then C. Run
§15.2–15.3 until they pass. Then an iPad screenshot review and the §15.4 manual run. The **wave-2
teams** (NPC friends, zip lines, coins, campers) follow §9.8, §9.11 and the DESIGN §5 rules from
now on, and the probe runs on every wave-2 merge.

---

## 17. Deferred (not in v1)

- The lobby card "Friends playing now" (join without typing a code).
- Guests adopting, feeding, riding, renaming or ordering the host's pets; bringing your own pets.
- Guest weather and time controls ("Friends can change the weather").
- Guests inviting or dressing up NPC friends.
- Host migration, or keeping the world running without the host.
- Guests saving a copy of the host's world.
- Shared piano, TV shows, books and cooking; gifts and trading treats between players.
- Tapping or colliding with friends ("Wave to Mia!").
- More than 4 players.
- Per-friend "Undo last"; "Let friends in by themselves" (auto-admit); a hide-names toggle.
- Per-chunk hash repair (v1 resyncs the whole snapshot on mismatch).
- `WsTransport` and a game server for the own website.
- A db-backed crash log for recovery beyond the 15 s local saves.
- **Never:** free-text chat, voice chat, or showing typed text that did not pass
  `sanitizeName`.

---

## Appendix A. How the three proposals scored

Each criterion is scored 1–10. Total = mean.

| Proposal | Convergence under drops | Fit to room/db contracts | Implementation risk and size | Kid UX and safety | Host data safety | iPad performance | WebSocket swap | **Total** |
|---|---|---|---|---|---|---|---|---|
| 1 Hostlink | 9 | 9 | 4 | 8 | 9 | 7 | 9 | **7.9** |
| 2 DB-backed op log | 8 | 7 | 3 | 8 | 9 | 7 | 6 | **6.9** |
| 3 State journal (winner) | 9 | 8 | 8 | 7 | 7 | 8 | 9 | **8.0** |

- **1 Hostlink.**
  - Strengths: the most careful platform reading (1 KiB strings, the probe emit, budgets) and
    excellent data safety.
  - Weaknesses: two capture models (CAS effects plus about 10 host-run commands), optimistic
    rebase, four kinds of incremental hashes, per-chunk repair and lobby cards. That is a very
    large surface for a v1.
- **2 DB-backed op log.**
  - Strengths: strong crash recovery and the careful-friends default.
  - Weaknesses: a db log with generations, compaction, leases, a code registry and palette
    replay adds heavy machinery and depends on unmeasured db call-rate limits. The store
    abstraction makes a server swap bigger.
- **3 State journal.**
  - Strengths: the simplest model that converges under any drop pattern; a clean ack-in-batch
    rule; uid seat ranges; disciplined v1 scope.
  - Weaknesses, all fixed in this design:
    - last-writer-wins guest edits, which could overwrite the host's concurrent work (now CAS);
    - presence maps keyed by peer ids, which are not identifier-safe (now arrays);
    - a db snapshot and rebase that needed new rules and writes (now the room carousel);
    - no gardening for guests (now plant, water and harvest).

---

## Addendum A: family decisions (2026-09-27). These override the sections above where they differ.

1. **Railway hosting is part of v1.** The family wants to deploy the game to Railway so friends
   can join with only a code and no Claude account. So `WsTransport` (§4.4) and its relay
   server move from "later" into v1:
   - `src/net/ws-transport.js` implements `NetTransport` over one WebSocket to the page's own
     origin (`wss://<host>/r/<roomName>`) with the JSON frames described in §4.4. It is picked
     automatically when the page is **not** inside claude.ai: `window.claude?.use` is missing
     and the page is served over http(s) from a host that answers `GET /api/net`. Otherwise
     the page uses `RoomTransport` (claude.ai), or `LoopTransport` in tests.
   - `server/server.mjs` is one dependency-light Node 22 program (only the `ws` package):
     - It serves `dist/sparkle-world.html` gzip-compressed with cache headers,
       `/healthz`, and `/api/net` (`{ok, version, build}`).
     - It relays rooms keyed by the code's room name with **exactly the room semantics** the
       game relies on (presence merge, hand-off to newcomers, clear on leave, broadcast with a
       sender stamp, roster changes). The tests' fake hub (`tools/net/hub.mjs`) and the server
       share one room-logic module (`server/rooms.mjs`), so what the tests exercise is what
       runs in production.
     - Server-side limits: at most 4 peers per room, 3,900 B per message, 4 KiB of presence
       per peer, and a per-connection rate limit (about 40 per second, burst 80). It also
       caps rooms (e.g. 500) and connections per IP, drops idle rooms after 10 minutes,
       checks Origin, and never logs payloads.
     - It stores **no** player data. There are no accounts; identity is a random per-device
       id plus the sanitized in-game name.
   - `railway.json` / `Procfile` and `package.json` scripts: `npm start` runs the server on
     `$PORT`, the build runs `npm run build`, and the health check is `/healthz`.
     `docs/DEPLOY-RAILWAY.md` has step-by-step instructions for a parent: connect the GitHub
     repo, set the root directory `sparkle-world`, and the service deploys on every push.
   - Saving on the Railway version is local only: IndexedDB, plus "Save to a file". The
     existing SaveStore fallbacks already do this with no code change. No server-side saves in
     v1, which keeps COPPA exposure minimal.
2. **No voice chat, ever, unless a parent-gated design is explicitly requested later.** Quick
   phrases and emotes only (already the rule in §11.6 and §17).
3. The two-account spike (Task 0) needs the family's help: it can only be run by real people
   with two claude.ai accounts. The Railway path does not depend on it.

## Addendum B: after the review (2026-09-27). Overrides the sections above where they differ.

Three reviews (relay safety, kid UX, sync) found real holes; these are the rules now.

1. **Identity is a stamp the room makes, never a value a page writes.**
   - On the Railway relay each page sends a per-device secret with its connection
     (`?d=`, 32 random characters kept in `localStorage['sparkle-world:net-device']`, never in
     presence, never shown). The server stamps `by = 'd' + base64url(sha256('sw-device\n' +
     room + '\n' + secret))[0..16]`: the same device gets the same stamp in the same room
     (a reload, "Keep playing", "Join Lily"), a different one in another room (nobody can
     follow a device across games), and nobody can make someone else's. On claude.ai `by`
     is the platform's user id.
   - `peers()[].uid` is `by` or null, never presence `uid` (which is no longer sent).
     Auto-admit ("known" friends, `lastHost.uids`), bans ("Send home") and following a
     reloaded host all use it; a peer with no stamp always gets a knock card.
2. **The host is the one who was there first.** Roster entries carry `at`, the room's join
   order. Guests pick the earliest `r:'h'` peer (hs only breaks ties where there is no `at`);
   the host's rival check uses `at` and ignores her own page from before a reload (same uid).
3. **The Railway relay is gated** (`rooms.mjs` `gate: true`; claude.ai rooms are not, the
   test hub follows the room it plays). The room's host side is the earliest member whose
   presence says `r:'h'` plus every member with her `by` that also says `r:'h'`; the let-in
   members are the peers in those members' `adm`. Everybody else sees only the public
   presence keys of the others (`v pv r ep hs end adm no kn`: enough to find the host and
   hear yes or no, not her name, look or position) and gets **no messages**; their own
   messages reach nobody. Being let in (or sent home) sends the member everyone's presence
   again. So a code scanner learns only "someone is hosting", a later pretend host reaches
   nobody, and the world snapshot never goes to a player who was not let in.
4. **Relay limits.** A broadcast deeper than 16 levels is refused before it is measured (an
   8,000-deep array made `JSON.stringify` throw and ended the process); each frame is handled
   in try/catch (close 1011 on a surprise) and the process keeps serving on
   `uncaughtException`, logging only the error's name. Per IP: 12 connections, 6 live rooms
   made, new connections 1/s with a burst of 30 (HTTP 429). The IP behind a proxy is the
   right-most public `X-Forwarded-For` entry (proxy hops in private ranges and Railway's
   100.0.0.0/8 skipped),
   so a client cannot pick its own. Every answer carries `Content-Security-Policy:
   frame-ancestors 'none'; connect-src 'self'; object-src 'none'; base-uri 'none';
   form-action 'none'` and `X-Frame-Options: DENY`. The 4-picture code stays (5 pictures
   would make scanning slower but joining harder for a 7-year-old; the gate and the pacing
   take away what scanning could find).
5. **Ownership follows the friend** (§8.2, §8.4): owner keys instead of seats; only adding or
   removing changes an owner; watering and eating are allowed; `conn` is the host's. Owners
   are saved with the host's world while hosting (`systems.netOwners`, `NetHost
   exportAuthors()`; the snapshot leaves it out) and taken up again on "Keep playing"
   (`env.loadAuthors(code)`), so a friend can still change what she built after the host's
   page reloads. Per-friend logs stay in memory.
6. **Kind words** (§12): Undo building tells the friend (ctl `tidy`); an unanswered knock is
   `no_answer`, not "Not now", and the host hears about it; building paused / on again is
   told with a pill while paused; a refusal never tells her to "ask first"; a Magic Build
   says why it did not happen; a wrong code keeps her on the keypad; "Lily is here!" is not
   shown to the friend who just arrived, and a sent-home friend gets one goodbye.
7. **"Before friends" never takes her own work by surprise** (§11.7, §13): kept on resume,
   dropped once she builds alone, honest confirm with the copy's picture and day, undoable,
   a small button. Hosting from the pause menu goes through the Play with Friends card
   (**Play Together**), and a reloaded host who taps Play is asked to open her door again.
8. **Names** (§11.1, §11.8): a device that never chose a name shows "Friend" and is asked
   "What's your name?" the first time she plays together; duplicate names get a number;
   invisible Hangul fillers, towers of accents and Cyrillic / Greek look-alikes are handled.
9. **Small sync fixes.** A guest's bridge openings are worked out again when bridge pieces or
   platforms come or go through `net:applied` (a refused bridge end no longer leaves her
   railing open and a hash resync behind). A friend's found gems in a host world stay found
   when she comes back (`profile.net.gems`, 8 worlds), so a rejoin does not pay their coins
   again. On a visit, "Home Sweet Home" counts only her own pieces.
