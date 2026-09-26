"""Mix voice-over, music and SFX into the final ad soundtrack.

Inputs (48 kHz WAV, any channel count; missing files are treated as silence):
  build/audio/vo.wav     full-length voice-over timeline
  build/audio/music.wav  full-length music bed
  build/audio/sfx.wav    full-length SFX timeline
Output:
  build/audio/mix.wav    stereo 48 kHz, loudness-normalised for social (-14 LUFS, -1 dBTP)

The music is side-chain ducked under the voice (smooth envelope, ~-8 dB while talking)
so every word stays intelligible on phone speakers.
"""
import json
import os
import subprocess
import sys

import numpy as np
import soundfile as sf

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AUDIO = os.path.join(ROOT, "build", "audio")
SR = 48000
FFMPEG = os.environ.get("FFMPEG") or __import__("imageio_ffmpeg").get_ffmpeg_exe()


def load(name, n):
    path = os.path.join(AUDIO, name)
    if not os.path.exists(path):
        print(f"  (no {name}, using silence)")
        return np.zeros((n, 2), np.float32)
    x, sr = sf.read(path, dtype="float32", always_2d=True)
    if sr != SR:
        raise SystemExit(f"{name} must be {SR} Hz, got {sr}")
    if x.shape[1] == 1:
        x = np.repeat(x, 2, axis=1)
    out = np.zeros((n, 2), np.float32)
    m = min(n, len(x))
    out[:m] = x[:m, :2]
    return out


def envelope(x, attack=0.02, release=0.28):
    """Peak-following envelope of a mono signal with separate attack/release (seconds)."""
    a = np.abs(x)
    # downsample to 1 ms blocks for speed, then upsample
    blk = SR // 1000
    nb = len(a) // blk + 1
    pad = np.zeros(nb * blk, np.float32)
    pad[: len(a)] = a
    b = pad.reshape(nb, blk).max(axis=1)
    ca, cr = np.exp(-1.0 / (attack * 1000)), np.exp(-1.0 / (release * 1000))
    env = np.zeros_like(b)
    e = 0.0
    for i, v in enumerate(b):
        c = ca if v > e else cr
        e = c * e + (1 - c) * v
        env[i] = e
    return np.repeat(env, blk)[: len(a)]


def main():
    sb = json.load(open(os.path.join(ROOT, "storyboard.json")))
    dur = float(sb["duration"])
    n = int(round(dur * SR))
    vo, music, sfx = load("vo.wav", n), load("music.wav", n), load("sfx.wav", n)

    # side-chain duck: gain goes from 1.0 to `duck` as the voice envelope rises
    env = envelope(vo.mean(axis=1))
    thr = 0.02
    duck_db = float(os.environ.get("DUCK_DB", -8.0))
    amount = np.clip(env / thr, 0, 1)
    gain = 10 ** (duck_db * amount / 20.0)
    music_d = music * gain[:, None]

    mix = vo * 1.0 + music_d * 0.9 + sfx * 0.8
    # gentle fade in/out so the loop point never clicks
    f = int(0.012 * SR)
    mix[:f] *= np.linspace(0, 1, f)[:, None]
    mix[-f:] *= np.linspace(1, 0, f)[:, None]
    pre = os.path.join(AUDIO, "mix_pre.wav")
    sf.write(pre, mix, SR, subtype="FLOAT")

    out = os.path.join(AUDIO, "mix.wav")
    # two-pass loudnorm to -14 LUFS integrated, -1 dBTP
    p1 = subprocess.run([FFMPEG, "-hide_banner", "-i", pre, "-af", "loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json", "-f", "null", "-"],
                        capture_output=True, text=True)
    txt = p1.stderr
    js = json.loads(txt[txt.rindex("{"): txt.rindex("}") + 1])
    af = (f"loudnorm=I=-14:TP=-1.5:LRA=11:measured_I={js['input_i']}:measured_TP={js['input_tp']}:"
          f"measured_LRA={js['input_lra']}:measured_thresh={js['input_thresh']}:offset={js['target_offset']}:linear=true,"
          f"aresample={SR},alimiter=limit=0.84:level=false")
    subprocess.run([FFMPEG, "-y", "-hide_banner", "-loglevel", "error", "-i", pre, "-af", af, "-ar", str(SR), "-ac", "2",
                    "-c:a", "pcm_s16le", out], check=True)
    print(f"wrote {out}  (input {js['input_i']} LUFS -> -14 LUFS)")


if __name__ == "__main__":
    sys.exit(main())
