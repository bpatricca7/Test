"""Generate every spoken line of the film with the Kokoro neural TTS model.

Narration is kept warm and clean. The two robots get a little character:
Bolt is pitched up with a soft metallic ring, Luma is pitched up with a
shimmering chorus. Output: audio/build/voices/<id>.wav (48 kHz) and
src/story/voice_durations.json (seconds, used by the animation timeline).
"""
import json
import os
import sys

import librosa
import numpy as np
import soundfile as sf
from scipy import signal

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
MODELS = os.environ.get("KOKORO_DIR", os.path.expanduser("~/.cache/bolt-and-luma"))
OUT = os.path.join(HERE, "build", "voices")
SR = 48000


def trim(y, sr, db=-42, pad=0.04):
    env = np.abs(y)
    thr = 10 ** (db / 20) * env.max()
    idx = np.where(env > thr)[0]
    if len(idx) == 0:
        return y
    a = max(0, idx[0] - int(pad * sr))
    b = min(len(y), idx[-1] + int(pad * 2 * sr))
    return y[a:b]


def fade(y, sr, t=0.01):
    n = int(t * sr)
    y = y.copy()
    y[:n] *= np.linspace(0, 1, n)
    y[-n:] *= np.linspace(1, 0, n)
    return y


def highpass(y, sr, f):
    b, a = signal.butter(2, f / (sr / 2), "high")
    return signal.lfilter(b, a, y)


def lowpass(y, sr, f):
    b, a = signal.butter(2, f / (sr / 2), "low")
    return signal.lfilter(b, a, y)


def peaking(y, sr, f0, gain_db, q=1.0):
    A = 10 ** (gain_db / 40)
    w0 = 2 * np.pi * f0 / sr
    alpha = np.sin(w0) / (2 * q)
    b = [1 + alpha * A, -2 * np.cos(w0), 1 - alpha * A]
    a = [1 + alpha / A, -2 * np.cos(w0), 1 - alpha / A]
    return signal.lfilter(np.array(b) / a[0], np.array(a) / a[0], y)


def compress(y, thresh=0.35, ratio=3.0):
    env = np.abs(signal.hilbert(y))
    env = lowpass(env, SR, 30)
    gain = np.ones_like(env)
    over = env > thresh
    gain[over] = (thresh + (env[over] - thresh) / ratio) / env[over]
    return y * gain


def fx_narrator(y):
    y = highpass(y, SR, 70)
    y = peaking(y, SR, 180, 1.5, 0.8)   # a touch of warmth
    y = peaking(y, SR, 3500, 1.5, 1.0)  # presence
    return compress(y)


def fx_bolt(y):
    t = np.arange(len(y)) / SR
    # soft ring modulation gives the "little machine" buzz
    ring = y * np.sin(2 * np.pi * 55 * t)
    y = 0.8 * y + 0.28 * ring
    # short metallic comb (the voice rattles inside a tin body)
    d = int(0.0023 * SR)
    out = y.copy()
    out[d:] += 0.32 * y[:-d]
    y = peaking(out, SR, 1800, 3, 1.2)
    return compress(highpass(y, SR, 120))


def fx_luma(y):
    t = np.arange(len(y)) / SR
    out = y.copy()
    for rate, depth, base in ((0.9, 0.0018, 0.011), (1.3, 0.0022, 0.017)):
        delay = (base + depth * np.sin(2 * np.pi * rate * t)) * SR
        idx = np.clip(np.arange(len(y)) - delay, 0, len(y) - 1)
        out += 0.35 * np.interp(idx, np.arange(len(y)), y)
    out = peaking(out, SR, 6000, 3, 0.7)  # sparkle
    return compress(highpass(out, SR, 140))


def echo(y):
    tail = int(2.2 * SR)
    out = np.concatenate([y, np.zeros(tail)])
    src = lowpass(y, SR, 2500)
    for k, g in enumerate((0.5, 0.3, 0.17, 0.09), start=1):
        d = int(0.42 * k * SR)
        out[d:d + len(src)] += g * src
        src = lowpass(src, SR, 1800)
    return out


def world_shift(y, sr, semitones, formant):
    """Raise the pitch with the WORLD vocoder, moving formants only slightly so words stay clear."""
    import pyworld as pw

    f0, sp, ap = pw.wav2world(np.ascontiguousarray(y), sr)
    f0 = f0 * 2 ** (semitones / 12)
    if formant != 1.0:
        n = sp.shape[1]
        src = np.arange(n) / formant
        sp = np.ascontiguousarray(np.stack([np.interp(src, np.arange(n), row) for row in sp]))
    return pw.synthesize(f0, sp, ap, sr)


FX = {"narrator": fx_narrator, "bolt": fx_bolt, "luma": fx_luma}


def main():
    from kokoro_onnx import Kokoro

    with open(os.path.join(ROOT, "src", "story", "script.json")) as f:
        script = json.load(f)
    only = set(sys.argv[1:])
    os.makedirs(OUT, exist_ok=True)
    kokoro = Kokoro(os.path.join(MODELS, "kokoro-v1.0.onnx"), os.path.join(MODELS, "voices-v1.0.bin"))
    dur_path = os.path.join(ROOT, "src", "story", "voice_durations.json")
    durations = json.load(open(dur_path)) if os.path.exists(dur_path) else {}

    for line in script["lines"]:
        if only and line["id"] not in only:
            continue
        v = script["voices"][line["who"]]
        audio, sr = kokoro.create(line["text"], voice=v["voice"], speed=v["speed"], lang="en-us")
        y = trim(np.asarray(audio, dtype=np.float64), sr)
        if v["pitch"]:
            y = world_shift(y, sr, v["pitch"], v.get("formant", 1.0))
        y = librosa.resample(y, orig_sr=sr, target_sr=SR)
        y = FX[v["fx"]](y)
        if line.get("echo"):
            y = echo(y)
        y = fade(y, SR)
        y = y / (np.abs(y).max() + 1e-9) * 0.89
        sf.write(os.path.join(OUT, line["id"] + ".wav"), y.astype(np.float32), SR, subtype="PCM_24")
        durations[line["id"]] = round(len(y) / SR, 3)
        print(f'{line["id"]:4s} {durations[line["id"]]:6.2f}s  {line["text"]}')

    with open(dur_path, "w") as f:
        json.dump(durations, f, indent=1, sort_keys=True)


if __name__ == "__main__":
    main()
