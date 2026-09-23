# ECHO

A sci-fi short, built entirely in code. No footage, no samples, no AI voice API.

> A radio signal arrived at 03:14 UTC. Nobody was listening for it.

There are two cuts:

- **[`ECHO_animated.mp4`](ECHO_animated.mp4)**: the animated cut (3:05). Real-time 3D: a 1974 prologue at a giant valley dish, a journey from Earth to the galaxy, a 3D observatory and spectrogram flyover, the bitstream folding into the picture, and the visitor stepping out of it. Source in [`animated/`](animated/).
- **[`ECHO.mp4`](ECHO.mp4)**: the first cut (2:35), a quieter 2D version.

## How it's made

Everything comes from one timeline, so picture and sound stay frame-accurate:

| Part | File | What it does |
| --- | --- | --- |
| Timeline | `timeline.py` | Script, scene timing, a time for every typed character, the 1,679-bit message (a 23 × 73 picture), and pulse times |
| Voice | `audio/voice.py` | A formant speech synthesizer written from scratch (glottal pulse source + resonator filters) that speaks the alien line |
| Score + sound | `audio/score.py` | Synthesized music, typewriter clicks, the two-tone radio pulses, ambience, risers and hits |
| Mix | `audio/mix.py` | Mixes the stems and voice, masters the soundtrack, and exports loudness envelopes the visuals react to |
| Picture | `visuals/echo.js` | Draws every frame on a canvas as a pure function of time: night sky, telescope, oscilloscope, the decoded picture, titles |
| Capture | `visuals/render.js` | Steps headless Chromium through all 3,720 frames (24 fps) |
| Build | `build.sh` | Runs all of the above and encodes the MP4 with ffmpeg |

## Rebuild

Needs Python 3 with `numpy`, `scipy` and `imageio-ffmpeg`, plus Node with Playwright's Chromium.

```bash
pip install numpy scipy imageio-ffmpeg
./movie/build.sh
```

Intermediate files go to `movie/build/` (ignored by git).

## The animated cut

Same method, in 3D with three.js, rendered in headless Chromium (software WebGL):

| Part | File |
| --- | --- |
| Timeline | `animated/timeline.py` |
| Compositor (bloom, narration, subtitles, fades) | `animated/main.js`, `animated/lib/util.js` |
| Scenes | `animated/scenes/valley.js`, `journey.js`, `observatory.js`, `signal.js`, `grid.js`, `ending.js` |
| Score, sound design, mix | `animated/audio/score.py`, `instruments.py`, `mix.py` |
| Capture | `animated/render.js` (4,440 frames at 24 fps) |
| Build | `animated/build.sh` (installs three.js with npm, then renders and encodes) |
