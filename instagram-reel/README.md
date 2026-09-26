# Chelsea Packs the Magic: Instagram intro reel

This folder has the scripts that turn iPhone talking-head clips into one
vertical Instagram Reel: 1080×1920 at 30 fps. The scripts cut the clips, clean
up the audio, generate an original music track, burn in captions and titles,
and encode the result. There are two cuts, each described by a project file in
`reel/projects/`:

| Project | Clips | Length | Notes |
|---|---|---|---|
| `intro_v3` | IMG_3567, 3570, 3583, 3576 | about 32 s | intro_v2 with the "I wanted to create a space…" line swapped for the tighter retake IMG_3583. |
| `intro_v2` (default) | IMG_3567, 3570, 3574, 3576 | about 33 s | Handheld, closer, noisier room. DeepFilterNet removes the background noise. Titles sit under the chin because the ears fill the top of frame. |
| `intro_v1` | IMG_3540–3551 | about 47 s | Tripod, quiet room. Includes the "tough few years" story section. |

The footage and the rendered videos are **not** in git. The clips carry GPS
metadata and the repo is public. Put the clips in `footage/`, then run
`./build.sh` (or `./build.sh intro_v1` / `./build.sh intro_v3`).

## What the edit does (intro_v2)

| Time | Clip | Line | Treatment |
|---|---|---|---|
| 0:00 | 3570 | "I can manage a classroom full of first grade students…" | Hook first. Punch-in on "that is where my skill set ends", and the music tape-stops so the joke lands. |
| 0:10 | 3567 | "Hi, I'm Chelsea, mom of three, teacher and Disney lover." | The groove kicks in on the beat. A "Hi, I'm / Chelsea" name card with sparkles, and tags that pop in as she says them. |
| 0:15 | 3574 | "I wanted to create a space…", family favorites, littles, beignets | Short IV–V build into the list groove. "What you'll find here" header. Comedic punch-in and a musical "ta-da" after "the best beignets?" |
| 0:25 | 3576 | "If that's your jam, then welcome home to Chelsea Packs the Magic." | Riser into an impact and sparkle on "Chelsea". |
| 0:30 | | End card | Blurred freeze frame, brand title, and a "Follow for Disney family tips" button that pops on the final chord. |

intro_v1 follows the same structure. It adds a softer "story" section and splices
two takes of the sign-off.

## Sound

- **Noise removal** (`analyze.py`, projects with `DENOISE = True`):
  - Each clip's dialogue goes through [DeepFilterNet](https://github.com/Rikorose/DeepFilterNet) (`deep-filter`, 40 dB attenuation limit).
  - On intro_v2, pauses dropped from −43 to −67 dBFS at matched speech level, and speech level and brightness were unchanged.
- **Dialogue** (`voice.py`):
  - Each clip is matched to the same loudness. Dead air and breaths are cut on frame boundaries.
  - Cleanup chain: 24 dB/oct high-pass, a per-project EQ (`VOICE_EQ`), de-esser, two-stage compression, and a look-ahead peak limiter.
  - intro_v2's EQ pulls out the close-mic 250–400 Hz boxiness.
  - Room tone between phrases is pulled down 10 dB.
- **Music** (`music.py`):
  - Composed in code for each cut, in F major at 114 BPM. It uses plucked ukulele and pizzicato, glockenspiel, celesta, pads, bass and light drums.
  - No samples or licensed tracks, so Instagram won't mute the reel for copyright.
  - The sections (hook, groove, story, build, list, CTA, finale) follow the edit. The pauses before key lines are stretched onto the beat grid (`timeline.py`).
- **Mix** (`mix.py`):
  - The music sits under her voice with a level set per section, ducks while she talks and rises in the gaps.
  - It opens up for the end card.
  - The master is −14 LUFS integrated with true peak at or below −1 dBTP, which matches Instagram's normalization.
- **Check:** speech recognition on the final mix reads back the same words as on the raw clips.

## Picture

- **Look:** gentle S-curve, a warm push, vibrance and a soft vignette. The 720p source is upscaled with Lanczos and then sharpened.
- **Reframing:** every shot is framed on the face median for that shot. Zooms alternate with a slow drift, and comedic punch-ins overshoot slightly.
- **intro_v2 framing:** the zooms stay gentle (1.06–1.2×) so the Minnie ears stay in frame.
- **Captions:** word-by-word with the current word on a Minnie-red pill. "Disney", "beignets" and the brand name are in gold. Emoji pop in at the end of a line.
- **Safe zones:** captions and titles stay clear of her face and Instagram's top, bottom and side UI.
- **Fonts and emoji:** Poppins and Pacifico (SIL Open Font License), and Twemoji graphics (CC-BY 4.0).

## Rebuilding

```bash
pip install -r requirements.txt       # plus ffmpeg with libx264
# assets (REEL_ASSETS, default /tmp/claude-0):
#   fonts/   Poppins-{SemiBold,ExtraBold,Black}.ttf, Pacifico-Regular.ttf   (google/fonts)
#   emoji/   Twemoji SVGs rendered to 256px PNGs, named by codepoint     (jdecked/twemoji)
#   models/  sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8                  (k2-fsa/sherpa-onnx releases)
#   bin/     deep-filter (DeepFilterNet v0.5.6 static binary, GitHub releases)
cp /path/to/IMG_35*.mov footage/
./build.sh            # intro_v2
./build.sh intro_v1   # the first cut
```

To change a cut, edit its file in `reel/projects/`. That covers the segment
list, the `CAPTIONS` text (`|` splits caption chunks), name tags, title
positions and the voice EQ. Shared defaults and the brand strings are in
`reel/config.py`.
