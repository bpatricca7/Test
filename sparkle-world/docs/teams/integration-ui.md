# Integration fixes: UI (src/ui)

Fixes made after the seven feature branches were merged, from the integration, playtest and
code reviews. Contract additions are marked **(contract)**.

## HUD (`hud.js`)

- Narrow tablets (iPad portrait 768 / 810 / 820 wide): a `max-width: 860px` step makes the
  hotbar slots 54 px and the gaps smaller, so Bag and Undo stay on screen. The empty spacer in
  the bottom row only takes space on phones now. `probe-menus.mjs` checks 768×1024 too.
- Hotbar slots picture the item in the color she picked (`items.iconFor(key, color)`, same as
  the Bag's mini hotbar), and a color change alone refreshes the picture.
- The target outline compares numbers (no per-frame strings or arrays) and keeps the tool
  colors as parsed `THREE.Color`s.

## Toasts (`theme.js`, `touch.js`) (contract)

- In play, toasts sit below the top HUD row on every screen size (`top: 96px`, phones
  `112px`), at most `min(92vw, 100vw − 220px, 640px)` wide so they stay clear of the tool
  column, and long text wraps.
- The top can be moved with the CSS variable `--sw-toast-top` on `.sw-ui` (an absolute
  length, safe area included). The tutorial sets it to just below its tip card while the card
  shows (and adds `.sw-tut-on` to `.sw-ui`; phones then line toasts up with the card).
- While a "New sticker!" pop (`.sw-stkpop`, a direct child of `.sw-ui`, from
  `src/life/stickers.js`) is on screen, toasts slide below it and the tutorial card steps
  aside (CSS `:has()`; browsers without it keep the old overlap).

## Bag (`inventory.js`)

- Touch long-press no longer gives the item when the timer fires: the card lights up
  ("ready") and the item goes into the slot when the finger lets go. A finger that rests and
  then swipes scrolls the list (the browser cancels the pointer) and changes nothing; a card
  that moved on screen between press and release (the list scrolled) never gives either.
  Mouse long-press is unchanged (gives at once, keeps browsing).
- **(contract)** Bag tab buttons carry the class `sw-tab` again (besides `sw-tab2`), the hook
  the core Bag had and the blocks / furniture / life / prefabs probes select tabs by.
- **(contract)** Items may set an optional numeric `order` (lower first, default 0) to move up
  in their Bag tab. Keys starting with `seed:` or `tool:` default to −10, so the seed packets
  and the Watering Can lead the Garden tab.

## Names (outside src/ui, one line each)

- `block:candle` is now "Little Candle" (`src/world/paint/garden.js`) and `block:bookshelf`
  "Book Block" (`src/world/paint/building.js`), so no two Bag items share a name
  ("Candle" and "Bookshelf" are the furniture pieces).

## Menus (`menus.js`)

- New World: the Create! row sticks to the bottom of the wizard card (it was below the fold on
  a landscape iPad), the card starts at the top every time it opens, the world cards line
  their pictures up at the top, and Everything Land (`mix`) has its own name ideas.
- **(contract)** The title's Dress Up / Stickers / Settings row carries `sw-title-small` again
  (besides `sw-title-tiles`), the core title's hook that `probe-avatar.mjs` clicks through.
- The pre-filled world name is selected when she taps or clicks the field, so typing replaces
  the suggestion instead of being inserted into it. After she types (or rolls the dice) the
  field behaves normally.
- The pause menu's Music / Sounds toggles set the volumes only (`audio.setVolumes`), no longer
  `game.applySettings()`, which reset the pixel ratio that Auto quality had lowered.
  (`applySettings` itself, in core, still resets it; only the Settings quality picker calls it.)

## Dress-Up (`dressup.js`)

- Closing the Studio prunes only its own queued stage pictures (keys starting with a tab key,
  e.g. `hair|…`, `outfits|slot|…`), before it emits `outfit:changed`, so the emote wheel's
  warm-up pictures of the new look (`emote|…`) are rendered instead of dropped.
