#!/usr/bin/env python3
"""ECHO (characters cut) — dialogue mix and master.

Reads the stems rendered by score.py and the dialogue rendered by the voice
department (build/dialogue/<id>.wav + manifest.json), places every line at
its `dialogue[i].start` from build/timeline.json, and mixes with dialogue as
the priority:

* Human lines (dry): a 70 Hz high-pass, a little proximity (low shelf) and
  presence, a gentle 2.5:1 leveller, and a small, warm room: early
  reflections from an image-source model of the 5 x 4 x 2.6 m timber hut,
  placed from the blocking (the speaker's mark and pose at that moment), plus
  a short dark diffuse tail.
* Visitor lines (already processed): placed, a touch of the same room from
  the Visitor's mark and a soft, long space around it.
* Every stem is ducked under the dialogue with a smooth, anticipatory
  sidechain envelope (the alarm and the music most).
* Master: about -16 LUFS integrated (BS.1770, gated), true peak <= -1 dBTP
  through a gentle look-ahead limiter. Dialogue stays centred (mono-safe).

Everything is read at runtime; nothing is pinned to the current timings. If
the manifest is missing, the soundtrack is built without dialogue and a
warning is printed.

Writes build/soundtrack.wav (48 kHz, stereo, 16-bit, exactly the film's
duration) and build/audio_env.json (fps, master_rms, maya_rms, sam_rms,
visitor_rms, visitor_wave).

Run:  python3 movie/characters/audio/mix.py
"""

import json
import os
import sys
import time

import numpy as np
from scipy import signal as sps
from scipy.ndimage import maximum_filter1d

HERE = os.path.dirname(os.path.abspath(__file__))
CHAR = os.path.dirname(HERE)
MOVIE = os.path.dirname(CHAR)
sys.path.insert(0, os.path.join(MOVIE, "audio"))
from dsp import (SR, TAU, db, to_db, hp, lp, read_wav, write_wav_16, integrated_loudness,  # noqa: E402
                 block_loudness, true_peak, limiter, make_ir, high_shelf, convolve_stereo,
                 one_pole_smooth, _moving_avg)

BUILD = os.path.join(CHAR, "build")
# ECHO_TIMELINE / ECHO_STEMS / ECHO_DIALOGUE / ECHO_OUT override paths (used to test re-timed dialogue)
TIMELINE = os.environ.get("ECHO_TIMELINE", os.path.join(BUILD, "timeline.json"))
STEMS = os.environ.get("ECHO_STEMS", os.path.join(BUILD, "stems"))
DIALOGUE_DIR = os.environ.get("ECHO_DIALOGUE", os.path.join(BUILD, "dialogue"))
OUT_DIR = os.environ.get("ECHO_OUT", BUILD)

TARGET_LUFS = -16.0
CEILING_DBTP = -1.3
DIALOGUE_LUFS = -17.0        # the humans' own gated loudness, before the final master trim
VISITOR_LUFS = -18.0         # the Visitor: slow and low, and its processed lines are peakier
STEM_GAIN_DB = {"music": -1.0, "typing": -6.0, "monitor": -9.0, "foley": 0.0, "amb": 0.0,
                "alarm": -13.0, "fx": -2.0}
DUCK_DB = {"music": 7.0, "typing": 0.0, "monitor": 5.0, "foley": 1.5, "amb": 4.0, "alarm": 9.0, "fx": 3.0}
ROOM_WET = 0.55              # human lines: image-source room level relative to the dry voice
SPEAKERS = ("maya", "sam", "visitor")


# ---------------------------------------------------------------------------
# Filters for the dialogue chain
# ---------------------------------------------------------------------------

def _biquad(x, b, a):
    return sps.lfilter(np.array(b) / a[0], np.array(a) / a[0], x, axis=-1)


def low_shelf(x, f0, gain_db):
    A = 10 ** (gain_db / 40.0)
    w0 = TAU * f0 / SR
    cw, sw = np.cos(w0), np.sin(w0)
    sa = 2 * np.sqrt(A) * sw / 2 * np.sqrt(2)
    b = [A * ((A + 1) - (A - 1) * cw + sa), 2 * A * ((A - 1) - (A + 1) * cw), A * ((A + 1) - (A - 1) * cw - sa)]
    a = [(A + 1) + (A - 1) * cw + sa, -2 * ((A - 1) + (A + 1) * cw), (A + 1) + (A - 1) * cw - sa]
    return _biquad(x, b, a)


def peaking(x, f0, gain_db, q=1.0):
    A = 10 ** (gain_db / 40.0)
    w0 = TAU * f0 / SR
    alpha = np.sin(w0) / (2 * q)
    cw = np.cos(w0)
    b = [1 + alpha * A, -2 * cw, 1 - alpha * A]
    a = [1 + alpha / A, -2 * cw, 1 - alpha / A]
    return _biquad(x, b, a)


def leveller(x, ratio=2.5, knee=6.0, below_peak=9.0):
    """Gentle feed-forward RMS compressor; threshold set from the material's own level."""
    env = np.sqrt(one_pole_smooth(x ** 2, 0.01) + 1e-20)
    lvl = to_db(env)
    active = lvl[lvl > lvl.max() - 45]
    thr = np.percentile(active, 95) - below_peak if len(active) else -30.0
    over = lvl - thr
    k = knee / 2
    gr = np.where(over <= -k, 0.0, np.where(over >= k, over, (over + k) ** 2 / (2 * knee))) * (1 - 1 / ratio)
    gr = np.maximum(one_pole_smooth(gr, 0.006), one_pole_smooth(gr, 0.15))
    return x * db(-gr)


# ---------------------------------------------------------------------------
# The hut: image-source early reflections + a short, dark diffuse tail
# ---------------------------------------------------------------------------

ROOM_DIMS = np.array([5.0, 2.6, 4.0])   # x, y (height), z; the room is centred on x/z = 0 in the timeline


def room_ir(src, lis, rt60=0.38, order=3, seed=0, length=0.45):
    """Reflections only (the direct sound is the dry voice). Returns (2, n), relative to direct = 1."""
    rng = np.random.default_rng(seed)
    n = int(length * SR)
    c = 343.0
    shift = np.array([2.5, 0.0, 2.0])
    S = np.asarray(src, float) + shift
    Lc = np.asarray(lis, float) + shift
    V = float(np.prod(ROOM_DIMS))
    area = 2 * (ROOM_DIMS[0] * ROOM_DIMS[1] + ROOM_DIMS[0] * ROOM_DIMS[2] + ROOM_DIMS[1] * ROOM_DIMS[2])
    beta = np.sqrt(max(0.05, 1 - min(0.9, 0.161 * V / (area * rt60))))
    d_dir = np.linalg.norm(S - Lc)
    horiz = np.array([S[2] - Lc[2], 0.0, -(S[0] - Lc[0])])
    horiz = horiz / (np.linalg.norm(horiz) + 1e-9)
    ears = [Lc - 0.09 * horiz, Lc + 0.09 * horiz]
    ir = np.zeros((order + 1, 2, n))
    rng_i = np.arange(-order, order + 1)
    for nx in rng_i:
        for ny in rng_i:
            for nz in rng_i:
                k = abs(nx) + abs(ny) + abs(nz)
                if k == 0 or k > order:
                    continue
                img = np.array([m * L + (s if m % 2 == 0 else L - s)
                                for m, L, s in zip((nx, ny, nz), ROOM_DIMS, S)])
                for e, ear in enumerate(ears):
                    d = np.linalg.norm(img - ear)
                    tau = (d - d_dir) / c * SR
                    if tau < 0 or tau >= n - 1:
                        continue
                    i0 = int(tau)
                    fr = tau - i0
                    a = beta ** k * d_dir / d
                    ir[k, e, i0] += a * (1 - fr)
                    ir[k, e, i0 + 1] += a * fr
    out = np.zeros((2, n))
    for k in range(1, order + 1):
        out += lp(ir[k], 9000.0 / (1 + 0.7 * k), order=1)       # timber: each bounce darker
    t = np.arange(n) / SR
    tail = lp(rng.standard_normal((2, n)), 3500.0, order=2) * np.exp(-6.91 * t / rt60)
    tail *= 1 - np.exp(-np.maximum(t - 0.012, 0) / 0.012)
    er_e = np.sum(out ** 2)
    tail *= np.sqrt(0.8 * er_e / (np.sum(tail ** 2) + 1e-20))
    return out + tail


# ---------------------------------------------------------------------------
# Blocking: where a speaker is at time t (from TL marks and walks)
# ---------------------------------------------------------------------------

def position(TL, who, t):
    B = TL["beats"]
    marks = TL["marks"]
    start = {"maya": "maya_armchair", "sam": "sam_chair", "visitor": "visitor"}[who]
    p = np.array(marks[start]["pos"], float)
    for w in sorted((w for w in TL["walks"] if w["who"] == who), key=lambda w: w["start"]):
        if t >= w["end"]:
            p = np.array(marks[w["to"]]["pos"], float)
        elif t >= w["start"]:
            u = (t - w["start"]) / (w["end"] - w["start"])
            p = (1 - u) * np.array(marks[w["from"]]["pos"], float) + u * np.array(marks[w["to"]]["pos"], float)
            break
    if who == "sam":
        seated = t < B.get("sam_backs_off", {"start": 1e9})["start"] + 1.2
        h = 1.12 if seated else 1.62
    elif who == "maya":
        seated = t < B.get("maya_stands", {"start": 1e9})["start"]
        h = 1.0 if seated else 1.52
    else:
        cr = B.get("visitor_crouch")
        h = 1.55 if (cr and cr["start"] <= t <= cr["end"]) else 1.9
    p[1] = h
    return p


def listener_for(src):
    """A boom-ish listening point 0.8 m in front of the speaker, toward the room centre."""
    d = np.array([-src[0], 0.0, -src[2]])
    nrm = np.linalg.norm(d)
    d = d / nrm if nrm > 1e-6 else np.array([0.0, 0.0, 1.0])
    lis = src + 0.8 * d
    lis[1] = src[1] - 0.05
    return lis


# ---------------------------------------------------------------------------

def load_stem(name, N):
    d, sr = read_wav(os.path.join(STEMS, f"{name}.wav"))
    assert sr == SR, (name, sr)
    if d.shape[0] == 1:
        d = np.vstack([d, d])
    if d.shape[1] < N:
        d = np.pad(d, ((0, 0), (0, N - d.shape[1])))
    return d[:, :N]


def load_line(path):
    v, sr = read_wav(path)
    v = v.mean(axis=0)
    if sr != SR:
        from math import gcd
        g = gcd(int(sr), SR)
        v = sps.resample_poly(v, SR // g, int(sr) // g)
    return v


def duck_envelope(key, depth_db):
    """Smooth sidechain gain: anticipatory ~120 ms attack, holds through short gaps, ~400 ms release."""
    env = np.sqrt(one_pole_smooth(key ** 2, 0.015) + 1e-20)
    lvl = to_db(env / (env.max() + 1e-20))
    k = np.clip((lvl + 36.0) / 18.0, 0.0, 1.0)
    k = maximum_filter1d(k, size=int(0.3 * SR))
    red = depth_db * k
    red = _moving_avg(red[::-1], int(0.12 * SR))[::-1]
    red = _moving_avg(red, int(0.4 * SR))
    return db(-red)


def frame_rms(x, fps, frames):
    p = np.mean(np.atleast_2d(x) ** 2, axis=0)
    hop = SR / fps
    out = np.array([np.sqrt(np.mean(p[int(round(i * hop)):int(round((i + 1) * hop))])) for i in range(frames)])
    m = out.max()
    return [round(float(v), 4) for v in (out / m if m > 0 else out)]


def group_gain(tracks, target):
    """Gain that brings a group's own gated loudness to target (keeps each line's dynamics)."""
    x = np.vstack([tracks, tracks]) / np.sqrt(2) if tracks.ndim == 1 else tracks
    L = integrated_loudness(x)
    return db(target - L) if L > -70 else 1.0


def main(dialogue_dir=None, out_dir=None):
    t_all = time.time()
    out_dir = out_dir or OUT_DIR
    with open(TIMELINE) as f:
        TL = json.load(f)
    N = int(round(float(TL["duration"]) * SR))
    fps = int(TL["fps"])
    frames = int(round(TL["duration"] * fps))

    stems = {k: load_stem(k, N) * db(g) for k, g in STEM_GAIN_DB.items()}

    # ---- dialogue
    ddir = dialogue_dir or DIALOGUE_DIR
    man_path = os.path.join(ddir, "manifest.json")
    manifest = {}
    if os.path.exists(man_path):
        with open(man_path) as f:
            manifest = json.load(f).get("lines", {})
    else:
        print(f"WARNING: {man_path} not found -- building the soundtrack WITHOUT dialogue. "
              "Re-run mix.py once the voices are rendered.")
    dry = {s: np.zeros(N) for s in SPEAKERS}          # as delivered, placed (for envelopes and ducking)
    proc = {s: np.zeros((2, N)) for s in SPEAKERS}    # processed, placed
    placed, missing = [], []
    space_ir = make_ir(2.6, rt_low=2.2, rt_mid=1.9, rt_high=1.0, predelay=0.03, seed=77, width=1.0)
    for d in TL["dialogue"]:
        info = manifest.get(d["id"])
        if not info:
            if manifest:
                missing.append(d["id"])
            continue
        path = os.path.join(ddir, info.get("wav", f"{d['id']}.wav"))
        if not os.path.exists(path):
            missing.append(d["id"])
            continue
        v = load_line(path)
        who = d["speaker"]
        s = int(round(float(d["start"]) * SR))
        m = min(len(v), N - s)
        if m <= 0:
            continue
        v = v[:m]
        dry[who][s:s + m] += v
        src = position(TL, who, float(d["start"]) + 0.5 * m / SR)
        ir = room_ir(src, listener_for(src), seed=int(d["id"][1:]))
        if who == "visitor":
            x = hp(v, 30.0)
            tail = int(3.0 * SR)
            xx = np.concatenate([x, np.zeros(tail)])
            stx = np.vstack([xx, xx]) / np.sqrt(2)
            wet = 0.3 * convolve_stereo(stx, ir, len(xx)) + 0.22 * convolve_stereo(stx, space_ir, len(xx))
            out = stx + wet
        else:
            x = hp(v, 70.0, order=2)
            x = low_shelf(x, 180.0, 2.5)              # a little proximity
            x = peaking(x, 3500.0, 1.5, q=0.9)        # presence
            tail = int(0.6 * SR)
            xx = np.concatenate([x, np.zeros(tail)])
            stx = np.vstack([xx, xx]) / np.sqrt(2)
            out = stx + ROOM_WET * convolve_stereo(stx, ir, len(xx))
        e = min(N, s + out.shape[1])
        proc[who][:, s:e] += out[:, :e - s]
        placed.append((d["id"], who, float(d["start"]), m / SR))

    have_dialogue = bool(placed)
    if have_dialogue:
        humans = proc["maya"] + proc["sam"]
        humans = leveller(humans)
        g_h = group_gain(humans, DIALOGUE_LUFS) if np.any(humans) else 1.0
        g_v = group_gain(proc["visitor"], VISITOR_LUFS) if np.any(proc["visitor"]) else 1.0
        dialogue = humans * g_h + proc["visitor"] * g_v
        key = dry["maya"] + dry["sam"] + dry["visitor"]
        for k, depth in DUCK_DB.items():
            if depth:
                stems[k] *= duck_envelope(key, depth)
    else:
        dialogue = np.zeros((2, N))
        g_h = g_v = 1.0

    bed = sum(stems.values())

    def master_bus(dlg):
        return high_shelf(hp(bed + dlg, 22.0, order=4), 6500.0, 1.0)

    mixed = master_bus(dialogue)
    gain_db = TARGET_LUFS - integrated_loudness(mixed)
    if have_dialogue:
        # the synthetic voices are peaky: a fast peak limiter on the dialogue bus alone, set a
        # little under the master ceiling, so syllable peaks never make the bed pump
        dialogue, _ = limiter(dialogue, ceiling_db=CEILING_DBTP - 0.7 - gain_db, attack=0.002,
                              release=0.06, hold=0.01)
        mixed = master_bus(dialogue)
        gain_db = TARGET_LUFS - integrated_loudness(mixed)
    for _ in range(4):
        y, g = limiter(mixed * db(gain_db), ceiling_db=CEILING_DBTP, attack=0.006, release=0.15, hold=0.03)
        L = integrated_loudness(y)
        if abs(L - TARGET_LUFS) < 0.1:
            break
        gain_db += TARGET_LUFS - L
    y[:, :int(0.005 * SR)] *= np.linspace(0, 1, int(0.005 * SR))
    y[:, -int(0.02 * SR):] *= np.linspace(1, 0, int(0.02 * SR))
    tp = true_peak(y)
    L = integrated_loudness(y)
    assert y.shape == (2, N) and np.all(np.isfinite(y))
    os.makedirs(out_dir, exist_ok=True)
    write_wav_16(os.path.join(out_dir, "soundtrack.wav"), y)

    # ---- envelopes for the picture
    env = {"fps": fps, "master_rms": frame_rms(y, fps, frames)}
    for s_ in SPEAKERS:
        env[f"{s_}_rms"] = frame_rms(dry[s_], fps, frames)
    vis = [(st, st + dur) for (_, who, st, dur) in placed if who == "visitor"]
    if vis:
        v0, v1 = min(a for a, _ in vis), max(b for _, b in vis)
        seg = dry["visitor"][int(round(v0 * SR)):int(round(v1 * SR))]
        vw = sps.resample_poly(seg, 1, SR // 2400)           # polyphase FIR: anti-aliased decimation
        vw = vw / (np.max(np.abs(vw)) + 1e-12)
        env["visitor_wave"] = {"start": round(v0, 4), "rate": 2400, "samples": [round(float(u), 3) for u in vw],
                               "segments": [[round(a, 4), round(b, 4)] for a, b in sorted(vis)]}
    else:
        first = min((float(d["start"]) for d in TL["dialogue"] if d["speaker"] == "visitor"), default=0.0)
        env["visitor_wave"] = {"start": first, "rate": 2400, "samples": [], "segments": []}
    if not have_dialogue:
        env["dialogue_missing"] = True
    with open(os.path.join(out_dir, "audio_env.json"), "w") as f:
        json.dump(env, f, separators=(",", ":"))

    # ---- report
    red = -to_db(g)
    print(f"dialogue: {len(placed)} lines placed" + (f", MISSING {missing}" if missing else "") +
          (f" | group gains human {20 * np.log10(g_h):+.1f} dB, visitor {20 * np.log10(g_v):+.1f} dB" if have_dialogue else ""))
    print(f"master gain {gain_db:+.2f} dB | integrated {L:.2f} LUFS | true peak {20 * np.log10(tp):.2f} dBTP | "
          f"sample peak {20 * np.log10(np.max(np.abs(y))):.2f} dBFS | max limiter GR {red.max():.2f} dB")
    hot = red > 1.0
    if hot.any():
        edges = np.flatnonzero(np.diff(np.concatenate([[0], hot.astype(int), [0]])))
        spans = [(a / SR, b / SR, float(red[a:b].max())) for a, b in zip(edges[::2], edges[1::2])]
        print("limiter > 1 dB: " + ", ".join(f"{a:.1f}-{b:.1f}s ({r:.1f} dB)" for a, b, r in spans[:12]))
    Lm, tm, _ = block_loudness(y)
    mg = db(gain_db)
    if have_dialogue:
        print(f"{'line':<5}{'who':<8}{'start':>7}{'len':>6}{'dialogue':>10}{'bed':>8}{'SBR':>6}")
        sbr = []
        for (i, who, st, dur) in placed:
            a, b = int(st * SR), int((st + dur) * SR)
            if b - a < int(0.45 * SR):
                b = a + int(0.45 * SR)
            ld = integrated_loudness(dialogue[:, a:b] * mg)
            lb = integrated_loudness(bed[:, a:b] * mg)
            sbr.append(ld - lb)
            print(f"{i:<5}{who:<8}{st:7.2f}{dur:6.2f}{ld:10.1f}{lb:8.1f}{ld - lb:6.1f}")
        print(f"speech-to-background: min {min(sbr):.1f} dB, median {np.median(sbr):.1f} dB")
    B = TL["beats"]
    shots = {s["id"]: s for s in TL["shots"]}
    windows = [("black typewriter", 0.0, B["exterior"]["start"]),
               ("exterior", B["exterior"]["start"], B["exterior"]["end"]),
               ("waking (d01-d03)", B["exterior"]["end"], B["maya_walks"]["end"]),
               ("pulses", B["pulses"]["start"], B["pulses"]["end"]),
               ("fold", B["fold"]["start"], B["fold"]["end"]),
               ("recognition", B["fold"]["end"], B["zoom_visitor"]["start"]),
               ("zoom", B["zoom_visitor"]["start"], B["surge"]["start"]),
               ("surge", B["surge"]["start"], B["surge"]["end"]),
               ("materialize", B["materialize"]["start"], B["materialize"]["end"]),
               ("visitor scenes", B["materialize"]["end"], B["dematerialize"]["start"]),
               ("dissolve", B["dematerialize"]["start"], B["lights_return"]),
               ("after (d19)", B["lights_return"], B["maya_to_window"]["start"]),
               ("window (d20)", B["maya_to_window"]["start"], shots["ext_dish"]["start"]),
               ("exterior dish", shots["ext_dish"]["start"], TL["title_card"]["start"]),
               ("title", TL["title_card"]["start"], TL["credits"]["start"]),
               ("credits", TL["credits"]["start"], TL["duration"] - 0.3),
               ("last 0.3 s", TL["duration"] - 0.3, TL["duration"])]
    print(f"{'beat':<18}{'window':>15}{'RMS dBFS':>10}{'LUFS':>8}{'max M':>8}")
    for name, a, b in windows:
        seg = y[:, int(a * SR):int(b * SR)]
        sel = (tm >= a) & (tm + 0.4 <= b)
        mm = f"{Lm[sel].max():8.1f}" if sel.any() else f"{'-':>8}"
        print(f"{name:<18}{a:7.1f}-{b:6.1f}s{20 * np.log10(np.sqrt(np.mean(seg ** 2)) + 1e-12):10.1f}"
              f"{integrated_loudness(seg):8.1f}{mm}")
    print(f"wrote {os.path.join(out_dir, 'soundtrack.wav')} and audio_env.json in {time.time() - t_all:.1f}s")


if __name__ == "__main__":
    main()
