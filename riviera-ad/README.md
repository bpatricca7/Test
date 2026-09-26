# "94 Steps Back to the Riviera": social video ad

A 30-second vertical video ad for the **Riviera Resort brick model** from
**brickcoodle.com**. It tells the family's story:

1. **One we stayed in, one we built.** A split screen puts the real resort (our balcony photo) against the brick model.
2. **Nobody wanted to leave the Riviera.** The trip photos appear as instant prints on a scrapbook table.
3. **So we took a little piece of it home.** The photo turns into bricks, then *"Voilà !"* reveals the full model with a 1,746-piece counter.
4. **Real vs. brick.** A slider compares the real resort and the model, ending on "This one fits on a shelf" (38 × 26 cm · 16 cm tall).
5. **Every step illustrated. Every part listed.** The instruction booklet appears, and the model builds itself from step 1 to 94.
6. **94 steps back to the Riviera.** The end card says "Step 1 starts at brickcoodle.com".

## Deliverables (`out/`)

| File | Use |
|---|---|
| `riviera-ad-9x16.mp4` | 1080×1920, 30 fps, H.264 + AAC, -14 LUFS. For Reels, TikTok, Shorts and Stories |
| `riviera-ad-4x5.mp4` | 1080×1350 cut for the Instagram and Facebook feed |
| `riviera-ad-cover.jpg` | Cover / thumbnail frame (t = 2.2 s, "One we stayed in. / One we built.") |

The end card carries the disclaimer: *Unofficial fan design. Not affiliated with or endorsed by
The LEGO Group or Disney.* The ad never quotes a price or says bricks are included, because the
booklet has the parts ordered separately.

## How it's made

Everything is generated from code and the source assets, so any change can be re-rendered with one command:

```bash
pip install numpy scipy soundfile pillow imageio-ffmpeg kokoro-onnx pymupdf
bash src/build.sh          # voice-over, music, SFX, mix, both videos, cover
SKIP_AUDIO=1 bash src/build.sh   # re-render video only
```

| Step | File | What it does |
|---|---|---|
| Spec | `storyboard.json`, `STORYBOARD.md` | Exact timing for every scene, line, sound cue and text item |
| Voice | `src/voice.py` | Kokoro neural TTS (`af_heart`, plus `ff_siwis` for "Voilà !"). Each line is placed on its storyboard time; writes `src/data/vo_timeline.json` with word timings |
| Music | `src/music.py` | 120 BPM D-major "French Riviera pop-house" synthesized in numpy (nylon pluck, accordion pad, whistle hook, glockenspiel, drums) |
| SFX | `src/sfx.py` | 93 synthesized foley cues: brick snaps (tuned to the key in the build montage), shutter, whooshes, page flips, confetti |
| Mix | `src/mix.py` | Ducks the music under the voice and masters to -14 LUFS / -1.5 dBTP |
| Picture | `src/ad.html`, `src/ad.js` | Deterministic `renderFrame(t)` motion graphics in HTML/CSS/canvas |
| Capture | `src/capture.mjs` | Headless Chromium renders every frame in parallel and pipes it to ffmpeg |
| QA | `src/review_tools.py` | Contact sheets with platform safe-zone overlays, audio lane charts |

Assets (`assets/`): the family's resort photos, the model rendering, and images taken from the
instruction booklet PDF: transparent cutouts of every build step and finished view, plus page scans.
Fonts are open-source (Fontsource). `BRIEF.md` lists the product facts and constraints the ad was
written against.

To change the voice, edit `voice.id` in `storyboard.json`. For example, `am_michael` gives a male
narrator. Then run `bash src/build.sh`.
