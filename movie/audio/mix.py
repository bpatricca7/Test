#!/usr/bin/env python3
"""ECHO — final mix and master.

Reads the four stems rendered by score.py plus the alien voice
(movie/build/voice.wav, 48 kHz mono, owned by the voice pipeline), places
the voice at voice.start (117.0 s) in the centre, ducks the music under it
with a smooth look-ahead sidechain envelope, sums, masters to about
-16 LUFS integrated (ITU-R BS.1770 K-weighted, gated) with true peaks below
-1 dBTP through a gentle look-ahead limiter, and writes:

  movie/build/soundtrack.wav   48 kHz, stereo, 16-bit, exactly 155.0 s
  movie/build/audio_env.json   per-frame envelopes for the visuals

If voice.wav does not exist yet a placeholder buzz is synthesized in memory
(never written to disk) so the pipeline can be tested; a warning is printed.

Run:  python3 movie/audio/mix.py
"""

import json
import os
import sys
import time

import numpy as np
from scipy import signal as sps
from scipy.ndimage import maximum_filter1d

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dsp import (SR, N, TAU, BUILD, STEMS, load_timeline, db, to_db, hp, lp, bp, read_wav,  # noqa: E402
                 write_wav_16, integrated_loudness, block_loudness, true_peak, limiter, make_ir,
                 convolve_stereo, one_pole_smooth, _moving_avg)

TARGET_LUFS = -16.0
CEILING_DBTP = -1.3          # limiter ceiling (true-peak detection); report must be < -1.0
VOICE_TARGET_LUFS = -15.0    # voice loudness (pre-master scale) while it speaks
STEM_GAIN_DB = {"music": 0.0, "typing": -5.0, "signal": -13.0, "sfx": -2.0}
DUCK_DB = {"music": 5.0, "sfx": 2.5}

TL = load_timeline()


def placeholder_voice():
    """2 s formant-ish buzz, only for testing the mix when voice.wav is missing."""
    n = int(2.0 * SR)
    t = np.arange(n) / SR
    f0 = 95 * (1 + 0.08 * np.sin(TAU * 0.7 * t)) * (1 - 0.1 * t / 2.0)
    ph = np.cumsum(f0) / SR
    src = sps.sawtooth(TAU * ph)
    y = np.zeros(n)
    for fc, g in ((600, 1.0), (1100, 0.6), (2500, 0.25)):
        y += g * bp(src, fc * 0.85, fc * 1.15)
    syll = np.clip(np.sin(np.pi * np.clip(t / 0.55, 0, 3.6)) ** 2, 0, 1)
    env = syll * np.clip(t / 0.03, 0, 1) * np.clip((2.0 - t) / 0.2, 0, 1)
    y *= env
    return y / np.max(np.abs(y)) * 0.5


def load_voice():
    path = os.path.join(BUILD, "voice.wav")
    if os.path.exists(path):
        v, sr = read_wav(path)
        v = v.mean(axis=0)
        if sr != SR:
            from math import gcd
            g = gcd(int(sr), SR)
            v = sps.resample_poly(v, SR // g, int(sr) // g)
        return v, False
    print("WARNING: movie/build/voice.wav not found -- using an in-memory placeholder voice "
          "(nothing is written to voice.wav). Re-run mix.py once the real voice exists.")
    return placeholder_voice(), True


def load_stem(name):
    d, sr = read_wav(os.path.join(STEMS, f"{name}.wav"))
    assert sr == SR, (name, sr)
    if d.shape[0] == 1:
        d = np.vstack([d, d])
    if d.shape[1] < N:
        d = np.pad(d, ((0, 0), (0, N - d.shape[1])))
    return d[:, :N]


def duck_envelope(voice_track, depth_db):
    """Sidechain-style gain curve: smooth, with look-ahead, holds between words."""
    env = np.sqrt(one_pole_smooth(voice_track ** 2, 0.015) + 1e-20)
    lvl = to_db(env / (env.max() + 1e-20))
    key = np.clip((lvl + 40.0) / 25.0, 0.0, 1.0)          # 0 below -40 dB, 1 above -15 dB
    key = maximum_filter1d(key, size=int(0.25 * SR))       # hold through short gaps
    red = depth_db * key
    # smooth: ~120 ms rise (starts slightly before the voice), ~450 ms recovery
    red = _moving_avg(red[::-1], int(0.12 * SR))[::-1]     # anticipatory attack
    red = _moving_avg(red, int(0.45 * SR))                 # release
    return db(-red)


def frame_rms(x, fps, frames):
    x = np.atleast_2d(x)
    p = np.mean(x ** 2, axis=0)
    hop = SR / fps
    out = np.zeros(frames)
    for i in range(frames):
        a, b = int(round(i * hop)), int(round((i + 1) * hop))
        out[i] = np.sqrt(np.mean(p[a:b])) if b > a else 0.0
    m = out.max()
    return [round(float(v), 4) for v in (out / m if m > 0 else out)]


def main():
    t_all = time.time()
    stems = {k: load_stem(k) for k in ("music", "typing", "signal", "sfx")}
    for k, g in STEM_GAIN_DB.items():
        stems[k] *= db(g)

    # --- voice: loudness-normalized, placed at voice.start, centred, a touch of space
    voice, is_placeholder = load_voice()
    v_start = float(TL["voice"]["start"])
    s = int(round(v_start * SR))
    vtrack = np.zeros(N)
    m = min(len(voice), N - s)
    vtrack[s:s + m] = voice[:m]
    vtrack = hp(vtrack, 35.0, order=2)
    active = vtrack[s:s + m]
    L_v, _, _ = block_loudness(np.vstack([active, active]) / np.sqrt(2), block=0.4, step=0.1)
    L_v = L_v[L_v > -70]
    v_loud = float(np.percentile(L_v, 90)) if len(L_v) else -30.0
    v_gain = db(VOICE_TARGET_LUFS - v_loud)
    vtrack *= v_gain
    voice_st = np.vstack([vtrack, vtrack]) / np.sqrt(2)
    room = make_ir(1.6, rt_low=1.0, rt_mid=0.9, rt_high=0.45, predelay=0.012, seed=31, width=0.9)
    voice_st = voice_st + 0.12 * convolve_stereo(voice_st, room, N)

    # --- sidechain ducking under the voice
    for k, d in DUCK_DB.items():
        stems[k] *= duck_envelope(vtrack, d)

    mixed = sum(stems.values()) + voice_st
    mixed = hp(mixed, 22.0, order=4)  # subsonic / DC

    # --- master: loudness normalize, then true-peak limiter, iterate to land on target
    gain_db = TARGET_LUFS - integrated_loudness(mixed)
    for _ in range(3):
        y, g = limiter(mixed * db(gain_db), ceiling_db=CEILING_DBTP, attack=0.004, release=0.08, hold=0.04)
        L = integrated_loudness(y)
        if abs(L - TARGET_LUFS) < 0.1:
            break
        gain_db += TARGET_LUFS - L
    # tiny safety fades at the very edges
    y[:, :int(0.005 * SR)] *= np.linspace(0, 1, int(0.005 * SR))
    y[:, -int(0.02 * SR):] *= np.linspace(1, 0, int(0.02 * SR))
    tp = true_peak(y)
    L = integrated_loudness(y)
    gr_max = -float(to_db(g.min()))
    assert y.shape == (2, N) and np.all(np.isfinite(y))
    write_wav_16(os.path.join(BUILD, "soundtrack.wav"), y)

    # --- envelopes for the visuals
    fps = int(TL["fps"])
    frames = int(round(TL["duration"] * fps))
    master_gain = db(gain_db)
    env = {
        "fps": fps,
        "voice_rms": frame_rms(vtrack, fps, frames),
        "signal_rms": frame_rms(stems["signal"], fps, frames),
        "music_rms": frame_rms(stems["music"], fps, frames),
        "master_rms": frame_rms(y, fps, frames),
    }
    vw = sps.resample_poly(voice, 1, SR // 2400)  # polyphase FIR: anti-aliased decimation
    vw = vw / (np.max(np.abs(vw)) + 1e-12)
    env["voice_wave"] = {"start": v_start, "rate": 2400, "samples": [round(float(v), 3) for v in vw]}
    if is_placeholder:
        env["voice_placeholder"] = True
    with open(os.path.join(BUILD, "audio_env.json"), "w") as f:
        json.dump(env, f, separators=(",", ":"))

    # --- report
    print(f"master gain {gain_db:+.2f} dB, voice gain {20 * np.log10(v_gain):+.1f} dB "
          f"(voice loudness {v_loud:.1f} LUFS raw){' [PLACEHOLDER VOICE]' if is_placeholder else ''}")
    print(f"integrated loudness {L:.2f} LUFS | true peak {20 * np.log10(tp):.2f} dBTP | "
          f"sample peak {20 * np.log10(np.max(np.abs(y))):.2f} dBFS | max limiter GR {gr_max:.2f} dB")
    red = -to_db(g)
    hot = red > 1.0
    if hot.any():
        edges = np.flatnonzero(np.diff(np.concatenate([[0], hot.astype(int), [0]])))
        spans = [(a / SR, b / SR, float(red[a:b].max())) for a, b in zip(edges[::2], edges[1::2])]
        merged = []
        for a, b, r in spans:
            if merged and a - merged[-1][1] < 0.5:
                merged[-1] = (merged[-1][0], b, max(merged[-1][2], r))
            else:
                merged.append((a, b, r))
        print("limiter > 1 dB: " + ", ".join(f"{a:.1f}-{b:.1f}s ({r:.1f} dB)" for a, b, r in merged))
    else:
        print("limiter never exceeds 1 dB of gain reduction")
    print(f"{'scene':<13}{'start':>7}{'end':>7}{'RMS dBFS':>10}{'LUFS':>8}{'max M':>8}")
    for sc in TL["scenes"]:
        a, b = int(sc["start"] * SR), int(sc["end"] * SR)
        seg = y[:, a:b]
        rms = 20 * np.log10(np.sqrt(np.mean(seg ** 2)) + 1e-12)
        Lm, _, _ = block_loudness(seg)
        print(f"{sc['id']:<13}{sc['start']:7.1f}{sc['end']:7.1f}{rms:10.1f}{integrated_loudness(seg):8.1f}"
              f"{Lm.max():8.1f}")
    print(f"wrote {os.path.join(BUILD, 'soundtrack.wav')} and audio_env.json in {time.time() - t_all:.1f}s")


if __name__ == "__main__":
    main()
