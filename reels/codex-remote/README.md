# Codex Remote — Instagram Reel

A 47.6 s, 1080×1920, 30 fps explainer: *control your computer by talking to your phone with Codex Remote, including driving Claude Code through computer use.*

**Status: first cut.** The edit, motion graphics, captions and sound are complete and render end to end. Three things are stand-ins — see "What is not final".

## Build

```bash
cd reels
npm install                                   # gsap
pip install numpy
(cd codex-remote && python3 audio/mix.py)     # voiceover + music bed + sound effects -> audio/mix.wav
node lib/render.cjs codex-remote              # frames -> codex-remote/codex-remote.mp4
node lib/render.cjs codex-remote --label check --stills 0,5.3,10.6   # spot-check frames
```

`index.html` + `reel.js` are a single GSAP timeline in which every frame is a pure function of time, so `lib/render.cjs` can seek to any frame, screenshot it with Playwright and hand the frames to ffmpeg.

## Script

> You can now control your entire computer… just by talking to your phone. It's called Codex Remote.
> Open ChatGPT on your computer, scan one QR code, and your phone is paired.
> Now it's a remote for your real machine. Your files. Your apps. Your logins.
> Tap the mic, and say what you want.
> With computer use, Codex sees your screen, clicks, and types, right inside your apps. Even Claude Code.
> *(second voice, into the phone)* "Open Claude, and have it fix my failing tests."
> Codex opens the app, types the prompt, and sends screenshots straight back to your phone.
> You approve each step with one tap. From the couch. The gym. Anywhere.
> This is the new way to work. You talk. Your computer does.
> Follow for more AI you can actually use.

## What is not final

| Piece | In this cut | Intended |
| --- | --- | --- |
| Product visuals | Illustrative UI drawn in code. It is **not** a screenshot of the real ChatGPT / Codex Remote or Claude apps and should not be presented as one. | Real screenshots and footage from OpenAI's announcement and docs, dropped into the phone and desktop frames. |
| Voiceover | Scratch take from OpenAI TTS (`gpt-4o-mini-tts`, voices *ash* and *coral*). | The ElevenLabs take already generated (voice "Marcus", plus "Jeni" for the spoken command). Word timings in `reel.js` (`CAPS`, `CMD`) and offsets in `audio/mix.py` (`VO`) need re-timing when it is swapped in. |
| Music | Synthesized bed from `audio/mix.py`. | A licensed or generated track, or trending audio added in Instagram at low volume. |

## Facts behind the claims

- Codex in the ChatGPT mobile app launched in preview on 14 May 2026 on iOS and Android, on all plans; you start work, review output, steer and approve from the phone while Codex keeps running on your computer. Source: OpenAI, "Work with Codex from anywhere".
- Pairing starts in the desktop app (Settings → Connections → control this Mac or PC) and uses a QR code; both devices need the same ChatGPT account. Source: OpenAI Codex docs, "Remote connections".
- Computer use lets Codex see the screen, click and type in desktop apps. It **cannot** automate terminal apps or ChatGPT itself, and cannot approve admin or security prompts — which is why the Claude Code scene shows the Claude desktop app, not a terminal. Source: OpenAI Codex docs, "Computer Use".
- Voice through Remote on the phone and Windows host support are reported by secondary sources (mid-2026); voice is reported as paid-plan only. Worth confirming against OpenAI's help centre before posting.
- "Entire computer" in the hook is shorthand. The caption carries the caveats.
