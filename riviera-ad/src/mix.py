"""Mix voice-over, music and SFX into the final ad soundtrack.

Inputs (48 kHz WAV, any channel count; missing files are treated as silence):
  build/audio/vo.wav          full-length voice-over timeline
  build/audio/music.wav       full-length music bed
  build/audio/sfx.wav         full-length SFX timeline
  src/data/vo_timeline.json   VO line times (written by voice.py)
Outputs:
  build/audio/mix_pre.wav     float32 sum before mastering
  build/audio/mix.wav         stereo 48 kHz 16-bit, exactly duration*48000 samples, -14 LUFS
                              integrated, true peak <= -2 dBTP (so the AAC deliverables stay
                              under -1 dBTP), sample-aligned with mix_pre.wav

Mix:
  VO     a fast peak limiter on the >5 kHz band only (ceiling -14 dBFS) tames HF clicks/esses,
         so no single transient drives the master limiter; "Voila !" (vo5), the exclamation that
         sits on the music drop, is lifted +3 dB over the level-matched narration lines
  music  line-based duck read from vo_timeline.json: 0 dB outside VO, -8 dB under vo1-vo5,
         -13 dB under vo6-vo13 ("heavily ducked" under the final lines), window
         [start-0.08, end+0.12]; smoothed in dB (60 ms toward more attenuation, 150 ms release),
         so it opens up in every gap between lines
  sfx    the same windows at -8 dB, except the first 40 ms of every hit (storyboard cue with
         gain >= 0.9), which play at full level
  bed    music + sfx pass a 1 ms lookahead peak limiter (20 ms release) set 1 dB above the
         master ceiling (after the static gain), so the brick-snap hits that land on drum hits
         are shaved on the bus alone (the VO is untouched) and the master limiter only catches
         voice + bed overlaps (a few dB at most) instead of pulling the whole mix down
Master: one static gain to -14 LUFS (measured with ffmpeg ebur128, corrected once), then a
4x-oversampled lookahead limiter with latency compensation (no delay, no loudness riding).
"""
import importlib.util
import json
import os
import re
import subprocess
import sys

import numpy as np
import soundfile as sf
from scipy import signal
from scipy.ndimage import minimum_filter1d, uniform_filter1d

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AUDIO = os.path.join(ROOT, "build", "audio")
SR = 48000
FFMPEG = os.environ.get("FFMPEG") or __import__("imageio_ffmpeg").get_ffmpeg_exe()

MUSIC_GAIN, SFX_GAIN = 0.9, float(os.environ.get("SFX_GAIN", 1.05))
DUCK_LEAD, DUCK_TAIL = 0.08, 0.12          # duck window around each VO line (s)
DUCK_EARLY_DB, DUCK_LATE_DB = -8.0, -13.0  # music under vo1-vo5 / vo6-vo13
LATE_FROM = 6                              # first line number that gets the deeper duck
SFX_DUCK_DB = -8.0
HIT_MIN_GAIN, HIT_HOLD = 0.9, 0.040        # SFX hits that stay un-ducked, and for how long
DUCK_ATT, DUCK_REL = 0.060, 0.150          # one-pole time constants of the duck gain (s)
VO_HF_SPLIT, VO_HF_CEIL_DB = 5000.0, -14.0
VO_HF_ATT, VO_HF_REL = 0.001, 0.040
VO_LINE_DB = {"vo5": 3.0}                  # per-line lift in the mix ("Voila !" on the drop)
TARGET_LUFS = -14.0
LIMIT = 0.78                               # alimiter ceiling at 192 kHz (-2.16 dBFS, so <= -2 dBTP)
BED_HEADROOM_DB = 1.0                      # bed limiter ceiling above the master ceiling (post-gain)
BED_ATT, BED_REL = 0.001, 0.020
MASTER_TAIL = "aresample=192000,alimiter=limit={lim}:attack=1:release=60:level=false:latency=1,aresample=48000"


def load(name, n):
    path = os.path.join(AUDIO, name)
    if not os.path.exists(path):
        print(f"  (no {name}, using silence)")
        return np.zeros((n, 2), np.float64)
    x, sr = sf.read(path, dtype="float64", always_2d=True)
    if sr != SR:
        raise SystemExit(f"{name} must be {SR} Hz, got {sr}")
    if x.shape[1] == 1:
        x = np.repeat(x, 2, axis=1)
    out = np.zeros((n, 2), np.float64)
    m = min(n, len(x))
    out[:m] = x[:m, :2]
    return out


# ----------------------------------------------------------------------------- peak limiting
def release(g, rel):
    """Instant attack / exponential release (`rel` s) toward 1.0 of a gain curve. Only the
    stretches where the gain is below 1 (plus 8 time constants after them) are walked."""
    out = g.copy()
    idx = np.flatnonzero(g < 1.0 - 1e-7)
    if not len(idx):
        return out
    cr = np.exp(-1.0 / (rel * SR))
    tail = int(8 * rel * SR)
    cuts = np.flatnonzero(np.diff(idx) > tail)
    for a, e in zip(np.r_[idx[0], idx[cuts + 1]], np.r_[idx[cuts], idx[-1]]):
        b = min(len(g), e + tail)
        seg = g[a:b].tolist()
        r = 1.0
        for i, v in enumerate(seg):
            r = 1.0 - (1.0 - r) * cr
            if v < r:
                r = v
            seg[i] = r
        out[a:b] = seg
    return out


def peak_limit_gain(level, ceil, att, rel):
    """Gain curve of a lookahead peak limiter for a (mono or channel-max) level signal: the
    required gain is held over +/-att, smoothed by an att-long moving average (so it is fully
    down when the peak arrives; the ceiling is never exceeded) and released over `rel`."""
    req = np.minimum(1.0, ceil / np.maximum(level, 1e-12))
    la = max(1, int(att * SR))
    g = uniform_filter1d(minimum_filter1d(req, 2 * la + 1), la)
    return release(np.minimum(g, req), rel)


def vo_hf_limit(x):
    """Split at 5 kHz (4th-order Butterworth, zero-phase: the two bands sum back exactly) and run
    the top band through a lookahead peak limiter (1 ms attack, 40 ms release, -14 dBFS ceiling).
    Returns (processed mono signal, per-sample gain applied to the top band)."""
    lo = signal.sosfiltfilt(signal.butter(4, VO_HF_SPLIT, "lowpass", fs=SR, output="sos"), x)
    hi = signal.sosfiltfilt(signal.butter(4, VO_HF_SPLIT, "highpass", fs=SR, output="sos"), x)
    g = peak_limit_gain(np.abs(hi), 10 ** (VO_HF_CEIL_DB / 20), VO_HF_ATT, VO_HF_REL)
    return lo + hi * g, g


# ----------------------------------------------------------------------------- ducking
def smooth_duck(target_db, force0=None, att=DUCK_ATT, rel=DUCK_REL):
    """One-pole follower in dB on 1 ms blocks: `att` toward more attenuation, `rel` back up.
    force0: boolean block mask where the gain is held at 0 dB (follower state reset).
    Returns a per-sample linear gain (block values linearly interpolated)."""
    ca, cr = np.exp(-1.0 / (att * 1000)), np.exp(-1.0 / (rel * 1000))
    out = np.empty(len(target_db))
    e = 0.0
    tl = target_db.tolist()
    fl = force0.tolist() if force0 is not None else [False] * len(tl)
    for i, (v, f) in enumerate(zip(tl, fl)):
        if f:
            e = 0.0
        else:
            c = ca if v < e else cr
            e = c * e + (1 - c) * v
        out[i] = e
    return out


def to_samples(block_db, n):
    tb = (np.arange(len(block_db)) + 0.5) * (SR // 1000)
    return 10 ** (np.interp(np.arange(n), tb, block_db) / 20)


def line_targets(lines, nb, depth_for):
    tgt = np.zeros(nb)
    for L in lines:
        a = max(0, int(np.floor((L["start"] - DUCK_LEAD) * 1000)))
        b = min(nb, int(np.ceil((L["end"] + DUCK_TAIL) * 1000)))
        tgt[a:b] = np.minimum(tgt[a:b], depth_for(L))
    return tgt


def sfx_cues(sb):
    """Storyboard SFX cues as sfx.py renders them."""
    spec = importlib.util.spec_from_file_location("sfx_mod", os.path.join(ROOT, "src", "sfx.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.effective_cues(sb)


def hit_times(cues):
    return sorted({float(c["t"]) for c in cues if float(c.get("gain", 1.0)) >= HIT_MIN_GAIN})


def line_gain(lines, n):
    """Per-sample VO gain from VO_LINE_DB (10 ms ramps, placed in the silence around the clip)."""
    g = np.zeros(n)
    for L in lines:
        d = VO_LINE_DB.get(L["id"], 0.0)
        if d:
            a, b = int((L["start"] - 0.03) * SR), int((L["end"] + 0.06) * SR)
            r = int(0.01 * SR)
            env = np.ones(b - a)
            env[:r], env[-r:] = np.linspace(0, 1, r), np.linspace(1, 0, r)
            g[a:b] += d * env
    return 10 ** (g / 20)


def build_pre(verbose=True):
    """Voice processing and ducking. Returns dict(vo, music, sfx, music_gain, sfx_gain, bed,
    lines, hits, n) (float64); `bed` is the ducked music + sfx before the bed limiter."""
    sb = json.load(open(os.path.join(ROOT, "storyboard.json")))
    tl = json.load(open(os.path.join(ROOT, "src", "data", "vo_timeline.json")))
    dur = float(sb["duration"])
    n = int(round(dur * SR))
    vo, music, sfx = load("vo.wav", n), load("music.wav", n), load("sfx.wav", n)
    lines = tl["lines"]

    vo_m, hf_g = vo_hf_limit(vo.mean(axis=1))
    vo_m = vo_m * line_gain(lines, n)
    vo_p = np.repeat(vo_m[:, None], 2, axis=1)

    nb = n // (SR // 1000) + 1
    num = lambda L: int(re.sub(r"\D", "", L["id"]) or 0)                       # noqa: E731
    m_db = smooth_duck(line_targets(lines, nb, lambda L: DUCK_LATE_DB if num(L) >= LATE_FROM else DUCK_EARLY_DB))
    hits = hit_times(sfx_cues(sb))
    hold = np.zeros(nb, bool)
    for t in hits:
        hold[max(0, int(np.floor(t * 1000)) - 1): int(np.ceil((t + HIT_HOLD) * 1000))] = True
    s_db = smooth_duck(line_targets(lines, nb, lambda L: SFX_DUCK_DB), hold)
    g_m, g_s = to_samples(m_db, n), to_samples(s_db, n)
    bed = music * (g_m * MUSIC_GAIN)[:, None] + sfx * (g_s * SFX_GAIN)[:, None]
    if verbose:
        hf_on = np.mean(hf_g < 0.99) * 100
        print(f"  VO >5 kHz limiter: max GR {-20 * np.log10(hf_g.min()):.1f} dB, active {hf_on:.2f}% of the time; "
              f"VO peak {20 * np.log10(np.abs(vo).max() + 1e-12):.1f} -> {20 * np.log10(np.abs(vo_m).max() + 1e-12):.1f} dBFS"
              + "".join(f"; {k} {v:+.1f} dB" for k, v in VO_LINE_DB.items()))
        print(f"  duck: music -8 dB (vo1-vo{LATE_FROM - 1}) / -13 dB (vo{LATE_FROM}+), sfx -8 dB, "
              f"{len(hits)} hits un-ducked for {HIT_HOLD * 1000:.0f} ms: {', '.join(f'{t:g}' for t in hits)}")
    return dict(vo=vo_p, music=music, sfx=sfx, music_gain=g_m, sfx_gain=g_s, bed=bed, lines=lines, hits=hits, n=n)


def sum_mix(P, bed_ceil=None):
    """VO + bed, the bed optionally through the lookahead peak limiter. Returns (mix, bed gain)."""
    bed = P["bed"]
    g = np.ones(len(bed))
    if bed_ceil is not None:
        g = peak_limit_gain(np.abs(bed).max(axis=1), bed_ceil, BED_ATT, BED_REL)
        bed = bed * g[:, None]
    mix = P["vo"] + bed
    # tiny fade-in (keeps the frame-0 shutter click) and a short fade-out so the loop never clicks
    fi, fo = int(0.001 * SR), int(0.012 * SR)
    mix[:fi] *= np.linspace(0, 1, fi)[:, None]
    mix[-fo:] *= np.linspace(1, 0, fo)[:, None]
    return mix, g


def gr_report(g, floor=0.5):
    """Max gain reduction (dB), ms above `floor` dB, and the worst few moments of a gain curve."""
    blk = SR // 1000
    nb = len(g) // blk
    gr = -20 * np.log10(np.maximum(g[: nb * blk].reshape(nb, blk).min(axis=1), 1e-9))
    shown, top = [], []
    for k in np.argsort(gr)[::-1]:
        if gr[k] < floor or len(top) >= 6:
            break
        if all(abs(k - s) > 100 for s in shown):
            shown.append(k)
            top.append(f"{k / 1000:.3f}s {gr[k]:.1f} dB")
    return float(gr.max()), int(np.sum(gr > floor)), top


# ----------------------------------------------------------------------------- master
def ebur128(path):
    p = subprocess.run([FFMPEG, "-hide_banner", "-nostats", "-i", path, "-af", "ebur128=peak=true", "-f", "null", "-"],
                       capture_output=True, text=True).stderr
    tail = p[p.rfind("Summary:"):]
    i = float(re.search(r"I:\s+(-?[\d.]+) LUFS", tail).group(1))
    tp = float(re.search(r"Peak:\s+(-?[\d.inf]+) dBFS", tail).group(1))
    return i, tp


def render_master(pre_path, vol_db, n, limiter=True):
    af = f"volume={vol_db:.2f}dB," + (MASTER_TAIL.format(lim=LIMIT) if limiter else "aresample=192000,aresample=48000")
    raw = subprocess.run([FFMPEG, "-hide_banner", "-loglevel", "error", "-i", pre_path, "-af", af,
                          "-ar", str(SR), "-ac", "2", "-f", "f32le", "-"], capture_output=True, check=True).stdout
    y = np.frombuffer(raw, np.float32).reshape(-1, 2).astype(np.float64)
    got = len(y)
    if got >= n:
        y = y[:n]
    else:
        y = np.concatenate([y, np.zeros((n - got, 2))])
    return y, got


def main():
    P = build_pre()
    n = P["n"]
    pre = os.path.join(AUDIO, "mix_pre.wav")
    out = os.path.join(AUDIO, "mix.wav")
    # the bed limiter ceiling is set relative to the master ceiling after the static gain, so
    # measure the loudness of the un-limited sum first (the bed limiter barely changes it)
    mix, _ = sum_mix(P)
    sf.write(pre, mix.astype(np.float32), SR, subtype="FLOAT")
    vol0 = TARGET_LUFS - ebur128(pre)[0]
    bed_ceil = 10 ** ((20 * np.log10(LIMIT) + BED_HEADROOM_DB - vol0) / 20)
    mix, g_bed = sum_mix(P, bed_ceil)
    sf.write(pre, mix.astype(np.float32), SR, subtype="FLOAT")

    # static gain to -14 LUFS (measured, then corrected once on the limited render)
    i_pre, tp_pre = ebur128(pre)
    vol = TARGET_LUFS - i_pre
    y, _ = render_master(pre, vol, n)
    sf.write(out, y, SR, subtype="PCM_16")
    i1, _ = ebur128(out)
    if abs(i1 - TARGET_LUFS) > 0.05:
        vol += TARGET_LUFS - i1
        y, _ = render_master(pre, vol, n)
    y_lin, got = render_master(pre, vol, n, limiter=False)
    sf.write(out, y, SR, subtype="PCM_16")
    i2, tp2 = ebur128(out)

    # master limiter gain reduction: 1 ms block peaks, limited vs the same chain without it
    blk = SR // 1000
    nb = n // blk
    pk_l = np.abs(y_lin[: nb * blk]).reshape(nb, blk, 2).max(axis=(1, 2))
    pk_o = np.abs(y[: nb * blk]).reshape(nb, blk, 2).max(axis=(1, 2))
    ratio = np.where(pk_l > 0.5 * LIMIT, np.minimum(1.0, np.maximum(pk_o, 1e-9) / np.maximum(pk_l, 1e-9)), 1.0)
    b_max, b_ms, b_top = gr_report(g_bed)
    m_max, m_ms, m_top = gr_report(np.repeat(ratio, blk))
    print(f"  bed limiter: ceiling {20 * np.log10(bed_ceil):+.2f} dBFS pre-gain ({20 * np.log10(LIMIT) + BED_HEADROOM_DB:+.2f} after it), "
          f"GR max {b_max:.2f} dB, > 0.5 dB during {b_ms} ms" + (f" (worst: {', '.join(b_top)})" if b_top else ""))
    print(f"  master: pre-mix {i_pre:.2f} LUFS / {tp_pre:+.2f} dBTP -> static gain {vol:+.2f} dB, "
          f"limiter ceiling {20 * np.log10(LIMIT):.2f} dBFS @192 kHz (latency-compensated, {got} samples out)")
    print(f"  master limiter GR: max {m_max:.2f} dB, > 0.5 dB during {m_ms} ms" + (f" (worst: {', '.join(m_top)})" if m_top else ""))
    print(f"wrote {out}  ({len(y)} samples, {i2:.1f} LUFS integrated, true peak {tp2:.1f} dBTP)")


if __name__ == "__main__":
    sys.exit(main())
