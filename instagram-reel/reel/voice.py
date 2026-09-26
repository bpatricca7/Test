"""Cut the dialogue to the timeline and give it a broadcast-style polish.

(DeepFilterNet denoise, if the project asks for it, happens in analyze.py)
raw cut -> per-clip loudness match -> HPF / project EQ / de-ess / compression
(ffmpeg) -> -16 LUFS -> soft gap attenuation -> peak limit. Writes build/<project>/voice.wav.
"""
import json, os, subprocess
import numpy as np, soundfile as sf, pyloudnorm as pyln
import config as C
from dsp import limiter

SR = C.SR
FADE = int(0.006 * SR)


def load_clip(clip):
    y, sr = sf.read(C.voice_wav(clip))
    assert sr == SR
    return y if y.ndim == 1 else y.mean(1)  # the two iPhone mics are well correlated; a mono voice sits centred


def ramp(n):
    return 0.5 - 0.5 * np.cos(np.linspace(0, np.pi, n))


def cut(tl):
    n_total = round(tl["total"] * SR)
    out = np.zeros(n_total)
    meter = pyln.Meter(SR)
    clips = {}
    for s in tl["segments"]:
        if s["clip"] not in clips:
            y = load_clip(s["clip"])
            gain = 10 ** ((-24.0 - meter.integrated_loudness(y)) / 20)
            clips[s["clip"]] = y * gain
    segs = tl["segments"]
    for k, s in enumerate(segs):
        y = clips[s["clip"]]
        a, b = round(s["i"] * SR), round(s["o"] * SR)
        piece = np.zeros(b - a)
        avail = y[a:min(b, len(y))]
        piece[:len(avail)] = avail
        if not s.get("cont"):
            piece[:FADE] *= ramp(FADE)
        if k + 1 == len(segs) or not segs[k + 1].get("cont"):
            piece[-FADE:] *= ramp(FADE)[::-1]
        t0 = round(s["tl0"] * SR)
        out[t0:t0 + len(piece)] += piece[:n_total - t0]
    # let the last breath/smile die away into the end card
    f0, f1 = round((tl["events"]["freeze"] - 0.20) * SR), round(tl["events"]["freeze"] * SR)
    out[f0:f1] *= ramp(f1 - f0)[::-1]
    out[f1:] = 0
    return out


CHAIN = ",".join([
    "highpass=f=75:poles=2", "highpass=f=75:poles=2",          # 24 dB/oct rumble cut
    *C.VOICE_EQ,                                                 # per-project tone (see projects/)
    "lowpass=f=15500",                                           # tame codec hash above
    "deesser=i=0.35:m=0.5:f=0.5:s=o",
    "acompressor=threshold=0.05:ratio=2.8:attack=8:release=120:knee=3:makeup=1",
    "acompressor=threshold=0.18:ratio=6:attack=2:release=60:knee=2:makeup=1",  # peak catcher
])


def gap_gate(y):
    """Duck room tone between phrases by ~10 dB with soft 30 ms ramps."""
    hop = SR // 100
    n = len(y) // hop
    rms = np.sqrt((y[:n * hop].reshape(n, hop) ** 2).mean(1)) + 1e-9
    db = 20 * np.log10(rms)
    speech = db > np.percentile(db[db > -80], 90) - 26
    k = 8  # 80 ms hold either side
    sp = np.convolve(speech.astype(float), np.ones(2 * k + 1), "same") > 0
    g = np.where(sp, 1.0, 10 ** (-10 / 20))
    g = np.convolve(g, np.ones(3) / 3, "same")
    gs = np.interp(np.arange(len(y)), np.arange(n) * hop + hop / 2, g)
    return y * gs, sp


def main():
    tl = json.load(open(os.path.join(C.BUILD, "timeline.json")))
    raw = cut(tl)
    rp, pp = os.path.join(C.BUILD, "voice_raw.wav"), os.path.join(C.BUILD, "voice_proc.wav")
    sf.write(rp, raw.astype(np.float32), SR, subtype="FLOAT")
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", rp, "-af", CHAIN,
                    "-c:a", "pcm_f32le", pp], check=True)
    y, _ = sf.read(pp)
    y = y[:len(raw)]
    meter = pyln.Meter(SR)
    y *= 10 ** ((-16.0 - meter.integrated_loudness(y)) / 20)
    y, sp = gap_gate(y)
    y = limiter(y, ceiling_db=-3.0, lookahead_ms=2.0, release_ms=60.0)   # catch a few consonant spikes
    sf.write(os.path.join(C.BUILD, "voice.wav"), y.astype(np.float32), SR, subtype="FLOAT")
    np.save(os.path.join(C.BUILD, "speech_mask_10ms.npy"), sp)
    print("voice LUFS", round(meter.integrated_loudness(y), 2), "peak dBFS", round(20 * np.log10(np.abs(y).max()), 2))


if __name__ == "__main__":
    main()
