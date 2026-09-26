# Creative brief: "Take the Riviera home" social video ad

## The story (from the client, in their words)
"We went to the Riviera Resort. Show the pictures from it, then: we wanted to take a little
piece of the resort home with us, so we bought the French resort brick set from
**brickcoodle.com**. It's awesome, it comes with the instructions. Make a very catchy ad for
social media about the product so we get buys and clicks. Show the brick set, the rendering
of it, and the instructions."

Goal: a scroll-stopping vertical social ad (Reels / TikTok / Shorts) that drives clicks to
**brickcoodle.com**. Tone: warm family-vacation nostalgia that turns into "you can build this".
The client said we don't have to literally say "awesome" and "amazing".

## Product facts (from the instruction booklet; the ONLY claims we may make)
- Name on the booklet: **Riviera Resort**, "A micro-scale display model in LEGO® bricks".
- **1,746 pieces**, 87 kinds of parts, 10 colours.
- **48 × 32 studs** (38 × 26 cm footprint), **16 cm tall** at the domes, scale about 1:250.
- **94 illustrated steps** in 6 sections: 1 The grounds, 2 The central pavilion,
  3 The domed pavilions (build 2), 4 The guest wings (build 2), 5 The porte-cochère (the arched
  entrance canopy), 6 Palms, flowers and flags.
- Build time about **6 to 8 hours**.
- Architectural details: arched porte-cochère, mansard-roofed central pavilion with oval dormers,
  two domed corner pavilions with lanterns, guest wings with red awnings, lawn lined with palms,
  two flagpoles (red + blue flags).
- Booklet includes a complete parts inventory with element IDs, plus parts lists (CSV,
  BrickLink XML) and a digital model file (opens in BrickLink Studio, LeoCAD, LDCad).
- It is an **unofficial fan design**: "not affiliated with, sponsored or endorsed by The LEGO
  Group or Disney. LEGO® is a trademark of The LEGO Group."

## Hard constraints
- Do NOT present it as an official LEGO® set or a Disney product. No LEGO/Disney logos.
  Call it the "Riviera Resort brick model" (or similar). "LEGO®" may appear only descriptively
  ("built from LEGO® bricks") and the end card must carry a small disclaimer:
  "Unofficial fan design. Not affiliated with or endorsed by The LEGO Group or Disney."
- Do NOT quote a price. Do NOT claim bricks are "included in the box" (unverified; the booklet
  explains ordering the parts separately). Safe: "step-by-step instructions", "full parts list",
  "1,746 pieces", "94 steps", etc.
- CTA destination text: **brickcoodle.com** (exactly this spelling).
- The resort photos show the client's own family from behind (kids + a parent with a stroller).
  They are fine to use. Don't add names.

## Available assets (all paths relative to `riviera-ad/assets/`)
Photos (client's own, iPhone):
- `photos/resort-arrival.jpg` 1171×1621 portrait: little girl (lilac tee, pink crocs) and dad
  pushing a stroller walking up a wide paved promenade toward the resort's tall white facade
  with blue shutters, balconies, mansard roof, palm trees, lamp posts, blue sky.
- `photos/resort-balcony-view.jpg` 1206×1536 portrait: view from a high balcony down onto the
  arched, domed porte-cochère entrance canopy, reflecting fountains, palm trees, sweeping
  drive, big blue sky with clouds, a theme-park dome on the horizon.
- `photos/resort-promenade.jpg` 1206×1288 near-square: waterfront promenade, dad with stroller,
  toddler boy in blue, girl in lilac, resort tower at left, huge cumulus clouds, deep blue sky.
Brick model:
- `instructions/pages/cover.webp` 1554×1065 RGBA (transparent bg): hero 3/4 render of the full
  finished model (same view as the client's rendering). BEST hero asset.
- `render/brick-model-render.png` 1400×959 (white bg); `instructions/cutouts/brick-model-render.webp` (transparent).
- `instructions/cutouts/finished-view-1..4.webp` (transparent): 4 camera angles of finished model
  (1 = low front 3/4, 2 = straight front, 3 = high 3/4 like cover, 4 = rear 3/4).
- `instructions/cutouts/step-01..94.webp` (transparent; steps 89 and 90 are missing): the
  cumulative build state at each step. Steps 1-10 grounds (grey baseplate, tan drive, green
  lawn), 11-34 central pavilion built floor by floor, 35-60 domed pavilion tower, 61-80 guest
  wing, 81-88 porte-cochère built onto the full model, 91-94 palms and flags on the full model.
  Steps 34, 60, 80, 88, 94 show the whole model coming together on the base.
  In steps, newly added parts are outlined in orange (instruction style).
- `instructions/cutouts/section-*.webp`: section intro hero renders.
- `instructions/pages/page-NN.jpg`: full booklet pages as printed (white pages, blue accents,
  numbered steps, "parts for this step" callouts, yellow "Build 2" badges). Page 01 = cover,
  02 = About this model, 03/14/28/43/55/64 = section openers, 21/31/49/62/68 = typical step
  pages, 70 = the finished model (4 views), 71 = parts inventory, 74 = ordering the parts.
- `instructions/catalog.json` lists everything with pixel sizes.

## Production toolkit (what is actually buildable here)
- Video is rendered frame-by-frame from an HTML/CSS/JS page in headless Chromium
  (deterministic `renderFrame(t)`), piped to ffmpeg (H.264 + AAC). Anything CSS/Canvas can do
  is possible: Ken Burns, parallax, masks/wipes, blur, 3D transforms, drop shadows, particle
  confetti made of bricks, animated counters, kinetic typography, split screens.
- Fonts on hand (woff2): Anton, Bebas Neue, Archivo Black, Montserrat 400-900, Poppins 400-900,
  Playfair Display (400/700, italic), DM Serif Display, Cormorant Garamond, Fraunces, Caveat
  (handwritten), Permanent Marker. Noto Color Emoji is installed.
- Voiceover: Kokoro neural TTS (natural). English voices: af_heart (warm female, best),
  af_bella, af_nicole, am_michael, am_puck, am_fenrir, bf_emma (British), etc. A native French
  female voice `ff_siwis` exists for a short French flourish ("Voilà !", "Bienvenue !").
  VO is generated phrase by phrase, so we control exactly when each line lands.
- Music: synthesized in Python (numpy): we choose BPM, key, instrumentation (plucky synths,
  claps, kick, bass, bells, whistle-y lead, accordion-ish pad for a French touch), risers,
  drops and stops that hit on cut points. Synthesized SFX: brick "click/snap" sounds, whooshes,
  pops, a camera shutter.
- Burned-in captions (most people watch muted).

## Platform specs
- Primary: 1080×1920 (9:16), 30 fps, 20-35 s (ideal ~30 s). A 4:5 (1080×1350) feed cut should
  be derivable from the same layout.
- Safe zones for 9:16: keep key text out of the top ~220 px and bottom ~420 px, and ~140 px
  off the right edge (platform UI). Hook must land in the first 1.5 s. Loop-friendly ending helps.
