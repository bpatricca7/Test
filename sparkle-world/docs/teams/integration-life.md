# Integration fixes: "life" area (pets, garden, cooking, src/life)

Notes from the post-merge fix pass. They extend DESIGN.md and docs/teams/life.md.

## Sticker pop waits for a clear world (`src/life/stickers.js`)

`game.stickers.award(id)` still records the sticker, saves and emits `sticker:earned` at once.
The big "NEW STICKER!" pop, with its jingle and confetti, now waits while anything covers
the world: an open panel (`ui.current`, which includes the photo polaroid, piano, Bag and
Recipe Book), a dialog, the camera countdown (`.sw-photo-mode`), the loading card, a fade,
or a hidden tab. It shows once the world has been clear for 0.5 s. If a panel opens while a
pop is up, the pop steps aside. A pop shown for less than 1.2 s comes back later; an older
one flies to the Sticker Book early. A pop is skipped if the Sticker Book has already shown
that sticker (`profile.stickersSeen`).

## Keyed toasts (`src/ui/ui.js`, core: small addition)

`ui.toast(text, { key })`: if a toast with the same `key` is still up or waiting, it is
updated in place (new text, timer restarted, pops again) instead of stacking another one.
Toasts without `key` work as before. Collectibles uses `key: 'gem-count'` for "Gem N of M!",
so gems found close together make one toast that counts up.

## Recipe pictures warm up gently (`src/things/cooking.js`)

The 33 food and ingredient thumbnails are no longer queued on `world:load`. A small system
(`cooking-warmup`) waits for 6 s of play, then asks for one picture every 0.6 s. It does this
only while `game.thumbs.queue` is empty, and only while the view has been still for 0.5 s (she
is standing and the camera is not turning) or a panel is open. Hotbar and Bag icons always go
first, no frame renders more than one of our pictures, and a render never shows as a hitch
while she moves. The thumbnail cache lasts for the whole session, so this runs once. The
Basket and the Recipe Book still ask for their own pictures when they open. Left for the core
owner: a priority option on `thumbs.get`, so visible UI can jump ahead of pictures a panel
asked for earlier.

## Live previews use the shared avatar stage (`src/things/pets/preview.js`)

The adoption and cooking-result previews draw on `getStage()` (`src/ui/dressup/stage.js`):
- `mount(el)` calls `stage.attach(el)`, puts our pivot into `stage.previewScene` and sets
  `stage.onPreviewFrame`.
- Our `update` sets the whole `stage.previewCamera` (fov, near, far, position, lookAt) each
  frame.
- `unmount()` detaches only while the stage is still attached to our element, and puts back
  the camera lens (fov, near, far) it had before.

`preview(game)`, `clear()` and `unmount()` never create a WebGL context. The game now uses
at most three contexts: main, thumbnails and the stage.

## Pet beds

- A pet sleeping in a pet bed wakes and hops to a free spot as soon as the bed is gone
  (`pet.js` sleep branch checks `sys.bedSpot(bedUid)`). Its claim is released, so it no
  longer sleeps on in mid-air and no block can be built into it.
- The Furniture team's `pet_bed` def (`src/things/furniture/catalog.js`) has
  `petSpot: [0.5, 0.16, 0.5]` (cushion top).
- The pets fallback `pet_bed` (`definePetBedFallback` / `petBedMesh`) was never used after
  the merge (furniture installs first), so it was removed.

## Floating pets settle

Found while probing: a floating duckling bounced between 0.44 and 0.88 blocks. Its float
point is almost where `swimming` is sampled, so the flag flipped on most frames (14 flips in a 5 s
SwiftShader sample), and its shadow and paddling pose flickered with it. Now:
- Once a pet is swimming, it stays swimming while its feet are wet.
- Buoyancy slows as the float point nears the surface.

Floating pets now settle calmly. Climbing out (the wall hop) and walking into or out of water
work as before.

## Probe

`tools/probe-life.mjs`: the Bag tabs are `.sw-tab2` in the merged Bag (the selector accepts
both). The probe also checks that a sleeping pet hops out when its bed is removed.
