# Chelsea Packs the Magic: Instagram intro reel

This folder has the scripts that turn seven iPhone talking-head clips into one
vertical Instagram Reel: 1080×1920, 30 fps, about 47 seconds. The script cuts
the clips, cleans up the audio, generates an original music track, burns in
captions and titles, and encodes the result. The footage and the rendered video
are **not** in git. The clips carry GPS metadata and the repo is public. Put the
clips in `footage/` and run `./build.sh`.

## What the edit does

| Time | Clip | Line | Treatment |
|---|---|---|---|
| 0:00 | 3540 | "I can manage a classroom full of first graders…" | Hook first. Punch-in on "that is where my skill ends", and the music tape-stops so the joke lands. |
| 0:08 | 3541 | "Hi, I'm Chelsea, a mom of three, a teacher, and a Disney mom." | The groove kicks in on the beat. "Chelsea" script title with sparkles. Tags pop in as she says them. |
| 0:13 | 3544 | Planning a Disney trip got her through a tough few years | Music softens to pad and celesta. Slow zoom steps. |
| 0:26 | 3546 | "…a space that I could share a little bit of that happiness." | The music builds (IV to V). |
| 0:30 | 3549 | Family favorites, travelling with littles, the best beignets | "What you'll find here" header. Comedic punch-in and a musical "ta-da" after the beignets line. |
| 0:39 | 3550 + 3551 | "If that sounds like your kind of thing, then welcome home to Chelsea Packs the Magic." | Two takes spliced: 3551 clips off its first word and 3550 has a long pause. Riser into an impact and sparkle on "Chelsea". |
| 0:44 | | End card | Blurred freeze frame, brand title, and a "Follow for Disney family tips" button that pops on the final chord. |

## Sound

- **Dialogue** (`voice.py`):
  - Each clip is matched to the same loudness, and dead air and breaths are cut on frame boundaries.
  - Cleanup chain: 24 dB/oct high-pass, light FFT denoise, EQ (−1.5 dB at 190 Hz, +3.5 dB at 3.3 kHz, +3 dB at 6.5 kHz), de-esser, two-stage compression, and a look-ahead peak limiter.
  - Room tone between phrases is pulled down 10 dB.
- **Music** (`music.py`):
  - Composed in code for this cut, in F major at 114 BPM. It uses plucked ukulele and pizzicato, glockenspiel, celesta, pads, bass and light drums.
  - No samples or licensed tracks, so Instagram won't mute the reel for copyright.
  - Section changes land on the edit because the pauses before key lines are stretched onto the beat grid (`timeline.py`).
- **Mix** (`mix.py`):
  - The music sits under her voice with a level set per section, ducks while she talks and rises in the gaps.
  - It opens up for the end card.
  - The master is −14 LUFS integrated with true peak at or below −1 dBTP, which matches Instagram's normalization.
- **Check:** speech recognition run on the final mix reads back every line correctly.

## Picture

- **Look:** gentle S-curve, a warm push, vibrance and a soft vignette. The 720p source is upscaled with Lanczos and then sharpened.
- **Reframing:** every shot is framed on her face. Zoom levels alternate (1.0× to 1.32×) with a slow drift, and the comedic punch-ins overshoot slightly.
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
cp /path/to/IMG_35*.mov footage/
./build.sh
```

To change the edit, captions or title text, edit `reel/config.py`: the segment
list, the `CAPTIONS` text (`|` splits caption chunks), and the brand strings.
Then run `./build.sh` again.
