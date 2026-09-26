"""Generate the ad's voice-over from storyboard.json with Kokoro neural TTS.

Every VO line is synthesized as its own clip, trimmed, and placed so its first audible
sample lands exactly on the line's `start`. If a clip would overrun `max_dur`, it is
re-synthesized slightly faster until it fits.

Outputs:
  build/audio/vo/<id>.wav    each placed clip (48 kHz mono)
  build/audio/vo.wav         the full-length VO timeline (48 kHz mono, float)
  src/data/vo_timeline.json  {"lines": [{id, start, end, text, words: [{text, start, end}]}]}
                             word times are estimated from phoneme counts, anchored to the
                             pauses actually present in the audio.

Model files (~350 MB) are downloaded on first run into build/models/.
"""
import json
import os
import re
import urllib.request

import numpy as np
import soundfile as sf
from scipy.signal import resample_poly

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODELS = os.environ.get("KOKORO_DIR", os.path.join(ROOT, "build", "models"))
RELEASE = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/"
SR = 48000
PRE_ROLL = 0.012  # seconds of (near-silent) lead-in kept before the audible onset
TARGET_RMS_DB = -18.0  # loudness of the voiced part of every clip (evens out voices/lines)


def model_files():
    os.makedirs(MODELS, exist_ok=True)
    paths = []
    for name in ("kokoro-v1.0.onnx", "voices-v1.0.bin"):
        p = os.path.join(MODELS, name)
        if not os.path.exists(p):
            print(f"  downloading {name} ...")
            urllib.request.urlretrieve(RELEASE + name, p)
        paths.append(p)
    return paths


def trim(x, rel_db=-42.0):
    """Trim leading/trailing silence relative to the clip peak; keep a short pre-roll."""
    env = np.abs(x)
    thr = env.max() * 10 ** (rel_db / 20)
    idx = np.flatnonzero(env > thr)
    a = max(0, idx[0] - int(PRE_ROLL * SR))
    b = min(len(x), idx[-1] + int(0.04 * SR))
    y = x[a:b].copy()
    # match loudness across clips/voices: RMS of the voiced 10 ms frames -> TARGET_RMS_DB
    hop = int(0.01 * SR)
    fr = y[: len(y) // hop * hop].reshape(-1, hop)
    rms = np.sqrt((fr ** 2).mean(axis=1))
    voiced = rms[rms > rms.max() * 10 ** (-30 / 20)]
    y *= 10 ** (TARGET_RMS_DB / 20) / np.sqrt((voiced ** 2).mean())
    fade = int(0.004 * SR)
    y[:fade] *= np.linspace(0, 1, fade)
    y[-fade:] *= np.linspace(1, 0, fade)
    return y


def pauses(x, min_gap=0.07, rel_db=-38.0):
    """Return (start, end) in seconds of silent gaps inside the clip."""
    hop = int(0.005 * SR)
    frames = np.abs(x[: len(x) // hop * hop]).reshape(-1, hop).max(axis=1)
    quiet = frames < frames.max() * 10 ** (rel_db / 20)
    gaps, i = [], 0
    while i < len(quiet):
        if quiet[i]:
            j = i
            while j < len(quiet) and quiet[j]:
                j += 1
            if i > 0 and j < len(quiet) and (j - i) * hop / SR >= min_gap:
                gaps.append((i * hop / SR, j * hop / SR))
            i = j
        else:
            i += 1
    return gaps


def word_times(kokoro, words, lang, clip, start):
    """Estimate per-word times: weight words by phoneme count, split at detected pauses."""
    weights = []
    for w in words:
        ph = kokoro.tokenizer.phonemize(w, lang)
        ph = re.sub(r"[ˈˌ.,!?…\s]", "", ph)
        weights.append(max(1, len(ph)))
    dur = len(clip) / SR - PRE_ROLL
    gaps = pauses(clip)
    speech = dur - sum(b - a for a, b in gaps)
    # map "speech time" (pauses removed) back to clip time
    def to_clip(s):
        t = s
        for a, b in gaps:
            if a - PRE_ROLL <= t:
                t += b - a
        return t
    total = float(sum(weights))
    out, acc = [], 0.0
    for w, wt in zip(words, weights):
        s0 = acc / total * speech
        acc += wt
        s1 = acc / total * speech
        out.append({"text": w, "start": round(start + to_clip(s0), 3), "end": round(start + to_clip(s1), 3)})
    return out


def main():
    from kokoro_onnx import Kokoro

    sb = json.load(open(os.path.join(ROOT, "storyboard.json")))
    dur = float(sb["duration"])
    base_voice = sb["voice"]["id"]
    base_speed = float(sb["voice"].get("speed", 1.0))
    onnx, voices = model_files()
    kokoro = Kokoro(onnx, voices)

    os.makedirs(os.path.join(ROOT, "build", "audio", "vo"), exist_ok=True)
    os.makedirs(os.path.join(ROOT, "src", "data"), exist_ok=True)
    timeline = np.zeros(int(round(dur * SR)), np.float32)
    lines = []
    prev_end = 0.0
    for v in sb["vo"]:
        voice = v.get("voice", base_voice)
        lang = v.get("lang", "fr-fr" if voice.startswith("f") and voice[1] == "f" else "en-us")
        speed = float(v.get("speed", base_speed))
        text = v.get("tts_text", v["text"])
        max_dur = float(v["max_dur"])
        for attempt in range(8):
            audio, sr = kokoro.create(text, voice=voice, speed=speed, lang=lang)
            clip = trim(resample_poly(audio.astype(np.float64), SR // 1000, sr // 1000).astype(np.float32))
            if len(clip) / SR - PRE_ROLL <= max_dur or attempt == 7:
                break
            speed *= 1.04
        clip_dur = len(clip) / SR - PRE_ROLL
        start = float(v["start"])
        a = int(round((start - PRE_ROLL) * SR))
        if a < 0:  # first line: drop the pre-roll rather than start before 0
            clip, a = clip[-a:], 0
        timeline[a: a + len(clip)] += clip[: len(timeline) - a]
        sf.write(os.path.join(ROOT, "build", "audio", "vo", f"{v['id']}.wav"), clip, SR)
        end = start + clip_dur
        words = v["text"].split()
        lines.append({
            "id": v["id"], "start": round(start, 3), "end": round(end, 3), "text": v["text"],
            "voice": voice, "speed": round(speed, 3),
            "words": word_times(kokoro, words, lang, clip, start),
        })
        flag = "" if clip_dur <= max_dur else "  !! OVER max_dur"
        overlap = "  !! OVERLAPS previous line" if start < prev_end else ""
        print(f"  {v['id']:5s} {start:6.2f}-{end:6.2f}s  {clip_dur:4.2f}/{max_dur:4.2f}s  {voice} x{speed:.2f}  {v['text']}{flag}{overlap}")
        prev_end = end

    peak = np.abs(timeline).max()
    if peak > 0.89:
        timeline *= 0.89 / peak
    sf.write(os.path.join(ROOT, "build", "audio", "vo.wav"), timeline, SR, subtype="FLOAT")
    json.dump({"sample_rate": SR, "lines": lines}, open(os.path.join(ROOT, "src", "data", "vo_timeline.json"), "w"), indent=1)
    print(f"wrote build/audio/vo.wav and src/data/vo_timeline.json ({len(lines)} lines)")


if __name__ == "__main__":
    main()
