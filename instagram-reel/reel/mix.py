"""Mix voice + music + sfx and master to Instagram-friendly loudness.

Music rides under the voice (section-aware bed level, ducks while she talks,
breathes up in the gaps) and opens up for the end card. Master: -14 LUFS
integrated, true peak <= -1 dBTP. Writes build/mix.wav.
"""
import json, os
import numpy as np, soundfile as sf, pyloudnorm as pyln
import config as C
from dsp import limiter, db2lin

SR = C.SR
TARGET_LUFS = -14.0

# music level under speech, dB (music stem is normalised to -16 LUFS overall)
BED = {"hook": -12.5, "stop": -60, "groove": -14.0, "story": -9.5, "build": -13.0,
       "list": -14.0, "cta": -12.5}
GAP_LIFT = 5.0        # how far the music rises when she pauses
REVEAL_BED = -10.0    # under "Chelsea Packs the Magic"
END_CARD = +1.0       # music on the end card
SFX_GAIN = -10.0


def smooth_gain(db_curve, attack_s, release_s):
    """One-pole smoothing, fast when the gain drops (duck), slow when it rises."""
    a_dn = np.exp(-1 / (attack_s * 100))
    a_up = np.exp(-1 / (release_s * 100))
    out = np.empty_like(db_curve)
    cur = db_curve[0]
    for i, v in enumerate(db_curve):
        a = a_dn if v < cur else a_up
        cur = v + (cur - v) * a
        out[i] = cur
    return out


def main():
    tl = json.load(open(os.path.join(C.BUILD, "timeline.json")))
    ev = tl["events"]
    voice, _ = sf.read(os.path.join(C.BUILD, "voice.wav"))
    music, _ = sf.read(os.path.join(C.BUILD, "music.wav"))
    sfx, _ = sf.read(os.path.join(C.BUILD, "sfx.wav"))
    n = round(tl["total"] * SR)
    voice, music, sfx = [np.pad(x, [(0, max(0, n - len(x)))] + [(0, 0)] * (x.ndim - 1))[:n] for x in (voice, music, sfx)]
    mask = np.load(os.path.join(C.BUILD, "speech_mask_10ms.npy"))   # 10 ms frames
    frames = int(np.ceil(n / (SR / 100)))
    mask = np.pad(mask, (0, max(0, frames - len(mask))))[:frames]
    mask = np.concatenate([mask[5:], np.zeros(5, bool)]) | mask     # duck 50 ms before she speaks

    # section bed level per 10 ms frame
    t = np.arange(frames) / 100
    bed = np.full(frames, BED["hook"])
    for s in tl["sections"]:
        bed[t >= s["t"] - 0.06] = BED[s["name"]]
    # the music section changes on the beat before the clip's first word; follow the music
    bed[t >= ev["reveal"] - 0.02] = REVEAL_BED
    curve = np.where(mask, bed, bed + GAP_LIFT)
    curve[t >= ev["freeze"]] = END_CARD
    curve = smooth_gain(curve, attack_s=0.06, release_s=0.35)
    # the end card blooms up from wherever the bed was, over ~0.4 s
    k0 = int((ev["freeze"] - 0.05) * 100)
    x = np.clip((t[k0:] - t[k0]) / 0.4, 0, 1)
    curve[k0:] = curve[k0] + (END_CARD - curve[k0]) * (1 - (1 - x) ** 2)
    g = db2lin(np.interp(np.arange(n) / SR, t, curve))

    mix = np.stack([voice, voice], axis=1) + music * g[:, None] + sfx * db2lin(SFX_GAIN)
    meter = pyln.Meter(SR)
    mix *= db2lin(TARGET_LUFS - meter.integrated_loudness(mix))
    mix = limiter(mix, ceiling_db=-1.2, lookahead_ms=3, release_ms=120, true_peak=True)
    # tiny fades so the loop point on Instagram never clicks
    f = int(0.004 * SR)
    mix[:f] *= np.linspace(0, 1, f)[:, None]
    mix[-int(0.25 * SR):] *= np.linspace(1, 0, int(0.25 * SR))[:, None] ** 2
    sf.write(os.path.join(C.BUILD, "mix.wav"), mix.astype(np.float32), SR, subtype="FLOAT")
    print("mix LUFS", round(meter.integrated_loudness(mix), 2))


if __name__ == "__main__":
    main()
