#!/usr/bin/env python3
"""SFX track for the Riviera brick-model ad (storyboard.json -> "sfx").

Every cue is synthesised from scratch (numpy/scipy, no samples) and placed sample-exactly at
round(t * 48000) with its storyboard gain:

  brick_click  two plastic bricks clicking: a 2-6 ms band-passed noise burst (contact) plus a
               damped inharmonic modal "tock" (7 modes, f0 ~1.3-2.5 kHz, 20-40 ms audible decay)
               and a hollow-body mode; "snaps" add the seating click 12-20 ms later. Variants by
               the cue notes: tiny 1x1 cascade clicks (seeded jitter + slow pitch drift), counter
               ticks, build-montage snaps tuned to D6 and shifted by the cue's "pitch" (semitones,
               D-major scale), a triple CTA snap, the 1x6 URL-brick drop (falls, snaps at the
               "lands" time given in the notes), a press-down/release button click, divider snap.
  shutter      mechanical camera shutter: bright first click, curtain swish, lower mirror clack
               60-90 ms later with a small bounce tick ("blink" variant = 2-frame spacing).
  whoosh       STFT-filtered stereo noise with a moving Gaussian band-pass (centre and width
               follow the on-screen motion), amplitude swell, turbulence, moving pan. Variants:
               air, paper slide (friction grain), air-suck (reverse swell, cut dead), whip-zoom,
               slider sweep, drop, punch-in, tape-measure zip (velocity-driven ratchet ticks).
  thud         soft paper/card drop (slap + air cushion + table knock + rustle), wood knock for the
               shelf plank, and the big DROP/CTA impact (pitch-swept sub boom with harmonics that
               survive phone speakers + low plastic snap-clack).
  pop          pitched bubble pop; confetti bursts add a decaying plastic rattle tail.
  sparkle      glassy bell partials in D major pentatonic with random micro-delays and pan spread;
               "bell ding" and single "glint" variants.
  riser        noise band sweeping up + gliding tone D4->D6 (cut dead at the end) or a reverse
               cymbal. The long riser is micro-ducked under overlapping brick clicks so the
               cascade stays readable.
  page_flip    dealt booklet page: release snick, papery swish with flutter + crinkle grains,
               soft landing slap, panned along the deal direction.

Level convention: each rendered cue is normalised to its own peak and scaled to
REF_DB[variant] + MASTER_DB + 20*log10(gain) dBFS, so a gain-1.0 brick snap peaks at -3.3 dBFS.
The full track is checked to stay below -1 dBFS sample peak and -1 dBTP (4x oversampled); if it
did not, a single global trim would be applied and reported (none is needed with the current
storyboard: peak -1.65 dBFS at the 8.00 drop). Audio is deterministic (per-cue seeded RNG; the
WAV's PEAK chunk carries a timestamp, so compare samples, not md5s).

Output: build/audio/sfx.wav - 48 kHz, stereo, float32, exactly duration*48000 samples.
Run:    python3 src/sfx.py                  render + cue table + count/peak/onset checks
        python3 src/sfx.py --png DIR        also write waveform/spectrogram/zoom PNGs to DIR
"""
import argparse
import json
import os
import re
import subprocess
import sys
import zlib

import numpy as np
import soundfile as sf
from scipy import signal

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "build", "audio", "sfx.wav")
SR = 48000
TAU = 2.0 * np.pi
BASE_SEED = 0x5F1C0DE
MASTER_DB = -0.3   # fixed headroom so the 8.00 drop stack (impact + snap + whip) stays under -1 dBFS

# peak level (dBFS) of a cue at gain 1.0, per variant
REF_DB = {
    "snap": -3.0, "tiny": -2.0, "tick": 1.0, "montage": -3.0, "triple": -3.0, "urlbrick": -3.0,
    "press": -3.0, "shutter": -3.5, "impact": -5.0, "paper_drop": -4.0, "wood": -4.0,
    "whoosh": -5.0, "paper_slide": -3.5, "suck": -5.0, "zip": -4.0, "pop": -4.0, "confetti": -4.0,
    "sparkle": -5.0, "ding": -4.5, "glint": -5.0, "riser": -7.0, "revcym": -4.5, "page_flip": -5.5,
}

# D major pentatonic, octaves 6-8 (sparkles, bells, tuned snaps)
NOTE = {"D6": 1174.66, "E6": 1318.51, "F#6": 1479.98, "A6": 1760.00, "B6": 1975.53,
        "D7": 2349.32, "E7": 2637.02, "F#7": 2959.96, "A7": 3520.00, "B7": 3951.07,
        "D8": 4698.64, "E8": 5274.04, "F#8": 5919.91, "A8": 7040.00}


# ----------------------------------------------------------------------------- DSP helpers
def n_(sec):
    return int(round(sec * SR))


def tvec(n):
    return np.arange(n) / SR


def peak(x):
    return float(np.max(np.abs(x))) + 1e-12


def norm(x):
    return x / peak(x)


def _sos(kind, f, order):
    if kind == "bandpass":
        lo, hi = f
        hi = min(hi, 0.45 * SR)
        lo = min(lo, hi * 0.8)
        f = [lo, hi]
    else:
        f = min(f, 0.45 * SR)
    return signal.butter(order, f, btype=kind, fs=SR, output="sos")


def bp(x, lo, hi, order=2):
    return signal.sosfilt(_sos("bandpass", (lo, hi), order), x, axis=0)


def hp(x, f, order=2):
    return signal.sosfilt(_sos("highpass", f, order), x, axis=0)


def lp(x, f, order=2):
    return signal.sosfilt(_sos("lowpass", f, order), x, axis=0)


def add_at(dst, src, t0):
    """dst += src starting at t0 seconds (extends dst if needed). 1-D or 2-D."""
    i = n_(t0)
    need = i + len(src)
    if need > len(dst):
        pad = np.zeros((need - len(dst),) + dst.shape[1:])
        dst = np.concatenate([dst, pad])
    dst[i:i + len(src)] += src
    return dst


def ramp_in(x, sec):
    k = max(1, n_(sec))
    x[:k] *= (np.arange(k) / k).reshape((-1,) + (1,) * (x.ndim - 1))
    return x


def ramp_out(x, sec):
    k = max(1, n_(sec))
    x[-k:] *= (1.0 - np.arange(1, k + 1) / k).reshape((-1,) + (1,) * (x.ndim - 1))
    return x


def pan_gains(p):
    th = (np.clip(p, -1.0, 1.0) + 1.0) * np.pi / 4.0
    return np.cos(th) * np.sqrt(2.0), np.sin(th) * np.sqrt(2.0)


def panned(x, p):
    """Mono (n,) or stereo (n,2) -> stereo, constant-power pan (scalar or per-sample array)."""
    n = len(x)
    gl, gr = pan_gains(np.broadcast_to(np.asarray(p, float), (n,)))
    if x.ndim == 1:
        return np.stack([x * gl, x * gr], axis=1)
    return np.stack([x[:, 0] * gl, x[:, 1] * gr], axis=1)


def smooth_noise(rng, n, rate):
    """Band-limited random modulation around 0 (std ~1), corner ~rate Hz."""
    m = lp(rng.standard_normal(n + 4096), rate, 2)[4096:]
    return m / (np.std(m) + 1e-12)


def modal(n, freqs, taus, amps, rng=None, attack=0.00012):
    """Sum of exponentially damped sines (impulse response of a modal body)."""
    freqs = np.atleast_1d(np.asarray(freqs, float))
    keep = freqs < 0.44 * SR
    freqs = freqs[keep]
    taus = np.atleast_1d(np.asarray(taus, float))[keep]
    amps = np.atleast_1d(np.asarray(amps, float))[keep]
    t = tvec(n)[None, :]
    ph = rng.uniform(-0.3, 0.3, len(freqs))[:, None] if rng is not None else 0.0
    y = (amps[:, None] * np.exp(-t / taus[:, None]) * np.sin(TAU * freqs[:, None] * t + ph)).sum(0)
    return ramp_in(y, attack)


def shaped_noise(rng, n, fc, bw, corr=0.5, nfft=1024):
    """Stereo noise through a moving Gaussian band-pass (log-frequency).

    fc(u) = centre Hz and bw(u) = FWHM in octaves, u in [0,1] across the buffer. Filtering is done
    in the STFT domain on noise that is longer than the buffer, so the time envelope applied
    afterwards alone decides the onset."""
    hop = nfft // 4
    pad = nfft
    N = n + 2 * pad
    freqs = np.fft.rfftfreq(nfft, 1.0 / SR)
    lf = np.log2(np.maximum(freqs, 20.0))[:, None]
    com = rng.standard_normal(N)
    out = np.zeros((n, 2))
    for ch in range(2):
        x = np.sqrt(corr) * com + np.sqrt(1.0 - corr) * rng.standard_normal(N)
        _, tt, Z = signal.stft(x, fs=SR, window="hann", nperseg=nfft, noverlap=nfft - hop)
        u = np.clip((tt - pad / SR) / (n / SR), 0.0, 1.0)
        c = np.log2(np.asarray(fc(u), float))[None, :]
        w = (np.asarray(bw(u), float) / 2.3548)[None, :]
        M = np.exp(-0.5 * ((lf - c) / w) ** 2)
        _, y = signal.istft(Z * M, fs=SR, window="hann", nperseg=nfft, noverlap=nfft - hop)
        out[:, ch] = y[pad:pad + n]
    return out / (np.sqrt(np.mean(out ** 2)) + 1e-12)


def logseg(u, pts):
    """Piecewise log-linear curve through (u_i, value_i) points."""
    us = np.array([p[0] for p in pts])
    vs = np.log(np.array([p[1] for p in pts], float))
    return np.exp(np.interp(u, us, vs))


def crackle(rng, n, rate, lo=2500.0, hi=11000.0, grain=0.0003):
    """Sparse paper/plastic micro-crackle grains; rate = grains/s (scalar or per-sample)."""
    p = np.broadcast_to(np.asarray(rate, float), (n,)) / SR
    imp = (rng.random(n) < p) * rng.lognormal(0.0, 0.7, n) * rng.choice([-1.0, 1.0], n)
    k = n_(grain * 5)
    ker = rng.standard_normal(k) * np.exp(-np.arange(k) / (grain * SR))
    y = signal.fftconvolve(imp, ker)[:n]
    return bp(y, lo, hi)


# ----------------------------------------------------------------------------- brick clicks
BR_RATIOS = np.array([1.0, 1.42, 1.87, 2.36, 2.93, 3.61, 4.40])
BR_AMPS = np.array([1.0, 0.85, 0.65, 0.50, 0.36, 0.26, 0.18])
BR_TAUS = np.array([9.0, 7.5, 6.0, 4.8, 3.8, 3.0, 2.3]) * 1e-3


def click_layer(rng, size=1.0, pitch=0.0, bright=1.0, body=0.5, tr=1.0, tone=None, dur=0.12):
    """One plastic-on-plastic contact: noise-burst transient + modal tock (+ body, + tuned mode).

    size: 0.4 (tiny stud) .. 1.0 (2x2 brick) .. 1.6 (1x6 brick); lower modes and longer decay as
    it grows. pitch: semitones (scales every mode and the burst band)."""
    ps = 2.0 ** (pitch / 12.0)
    n = n_(dur)
    t = tvec(n)
    # contact transient: 2-6 ms burst of noise, band-passed ~2-6 kHz (shifted with pitch)
    blen = rng.uniform(2.0e-3, 4.5e-3) * (0.75 + 0.25 * size)
    e = np.exp(-t / (blen / 4.0))
    e[:3] *= (0.4, 0.75, 0.95)
    lo = 1900.0 * ps ** 0.5 * rng.uniform(0.92, 1.08)
    hi = 6200.0 * ps ** 0.5 * (0.8 + 0.2 * bright) * rng.uniform(0.92, 1.08)
    burst = norm(bp(rng.standard_normal(n) * e, lo, hi, 2))
    # modal tock: inharmonic modes of the hollow ABS shell
    f0 = 1650.0 / size ** 0.8 * ps * rng.uniform(0.96, 1.04)
    fr = f0 * BR_RATIOS * rng.uniform(0.975, 1.025, len(BR_RATIOS))
    taus = BR_TAUS * size ** 0.7 / ps ** 0.5 * rng.uniform(0.85, 1.15, len(BR_RATIOS))
    amps = BR_AMPS * rng.uniform(0.7, 1.3, len(BR_RATIOS)) * (fr / f0) ** (0.5 * (bright - 1.0))
    y = tr * burst + 0.8 * norm(modal(n, fr, taus, amps, rng))
    if body > 0:
        fb = 540.0 / size ** 0.9 * ps ** 0.5 * rng.uniform(0.95, 1.05)
        b = modal(n, [fb, fb * 1.58, fb * 2.31], [6e-3 * size, 4e-3 * size, 2.5e-3 * size],
                  [1.0, 0.45, 0.25], rng)
        y = y + body * 0.9 * norm(b)
    if tone is not None:
        f, amp, tau = tone
        y = y + amp * norm(modal(n, [f, 2.003 * f, 3.01 * f], [tau, tau * 0.45, tau * 0.25],
                                 [1.0, 0.22, 0.08], rng))
    return y


def snap(rng, size=1.0, pitch=0.0, bright=1.0, body=0.5, second=True, tone=None,
         sec_amp=None, sec_delay=None):
    """Brick SNAP: contact click + the smaller seating click 12-20 ms later."""
    y = click_layer(rng, size, pitch, bright, body, 1.0, tone, dur=0.16)
    if second:
        d = sec_delay if sec_delay is not None else rng.uniform(0.012, 0.020)
        a = sec_amp if sec_amp is not None else rng.uniform(0.35, 0.55)
        y2 = click_layer(rng, size * rng.uniform(0.80, 0.92), pitch + rng.uniform(0.8, 2.5),
                         bright * 1.1, body * 0.4, 1.2, None, dur=0.10)
        y = add_at(y, a * y2, d)
    return y


# ----------------------------------------------------------------------------- generators
def g_snap(rng, pan=0.0, size=1.0, pitch=0.0, bright=1.0, body=0.5, **kw):
    return panned(snap(rng, size, pitch, bright, body, **kw), pan)


def g_tiny(rng, pan, k, count):
    """Cascade 1x1 stud snap: tiny, bright, mostly single; pitch drifts up ~2.5 st over the run."""
    drift = 2.5 * (k - 1) / max(1, count - 1)
    y = click_layer(rng, rng.uniform(0.55, 0.68), drift + rng.uniform(-0.7, 0.7),
                    rng.uniform(0.95, 1.25), 0.0, rng.uniform(0.85, 1.15), dur=0.07)
    if rng.random() < 0.3:
        y2 = click_layer(rng, rng.uniform(0.45, 0.6), drift + rng.uniform(0.5, 2.0), 1.2, 0.0, 1.0,
                         dur=0.05)
        y = add_at(y, rng.uniform(0.22, 0.35) * y2, rng.uniform(0.006, 0.010))
    return panned(y, pan)


def g_tick(rng, pan):
    """Piece-counter tick: very small, high."""
    y = click_layer(rng, 0.42, 3.0 + rng.uniform(-0.3, 0.3), 1.2, 0.0, 1.0, dur=0.05)
    return panned(y, pan)


def g_montage(rng, pitch, heavy=False):
    """Build-montage snap: tuned to D6 (+pitch semitones) so the run climbs the D-major scale."""
    ps = 2.0 ** (pitch / 12.0)
    tone = (NOTE["D6"] * ps, 0.65, 0.018 / ps ** 0.5)
    if heavy:
        y = snap(rng, 1.2, pitch, 1.05, 0.7, True, tone, sec_amp=0.6, sec_delay=0.012)
    else:
        y = snap(rng, 1.0, pitch, 1.0, 0.4, True, tone, sec_amp=0.3)
    return panned(y, rng.uniform(-0.08, 0.08))


def g_triple(rng):
    """Triple stacked brick snap (CTA hit layer): L / R / C, 0 / 23 / 49 ms."""
    out = np.zeros((1, 2))
    for dt, a, s, p in ((0.0, 1.0, 1.2, -0.25), (0.023, 0.72, 1.0, 0.28), (0.049, 0.85, 1.1, 0.0)):
        y = snap(rng, s, rng.uniform(-0.5, 0.5), 1.0, 0.6, True)
        out = add_at(out, a * panned(y, p), dt)
    return out


def g_urlbrick(rng, land):
    """1x6 brick falls (air swish from t) and snaps down at +land s, with a squash rebound tick."""
    n = n_(land + 0.2)
    t = tvec(n)
    fall_n = n_(land)
    u = np.clip(t / land, 0, 1)
    sw = shaped_noise(rng, n, lambda v: logseg(v, [(0, 3200), (1, 1500)]), lambda v: 1.4 + 0 * v, 0.6)
    env = np.where(t < land, 10 ** ((-20 + 14 * u ** 2) / 20), 0.0)
    env[:n_(0.002)] *= np.linspace(0, 1, n_(0.002))
    env[fall_n - n_(0.002):fall_n] *= np.linspace(1, 0, n_(0.002))
    y = sw * env[:, None] * 0.35
    s = snap(rng, 1.5, -1.0, 1.0, 0.95, True, sec_amp=0.5, sec_delay=0.015)
    y = add_at(y, panned(s, -0.03), land)
    reb = click_layer(rng, 0.9, 2.0, 1.1, 0.2, 1.0, dur=0.05)
    y = add_at(y, 0.16 * panned(reb, 0.05), land + 0.085)
    return y


def g_press(rng):
    """Button press-down click (duller, lower) + lighter release click 0.12 s later."""
    a = click_layer(rng, 1.35, -3.0, 0.75, 0.9, 0.7, dur=0.12)
    b = click_layer(rng, 1.0, 1.0, 1.1, 0.3, 1.0, dur=0.08)
    y = add_at(a, 0.38 * b, 0.12)
    return panned(y, -0.03)


def metal_click(rng, size=1.0, bright=1.0, body=0.4, dur=0.06):
    n = n_(dur)
    t = tvec(n)
    blen = rng.uniform(1.2e-3, 2.0e-3)
    burst = norm(bp(rng.standard_normal(n) * np.exp(-t / (blen / 4)), 2500 * bright, 11000, 2))
    f0 = 2600.0 / size * rng.uniform(0.97, 1.03)
    fr = f0 * np.array([1.0, 1.73, 2.61, 3.8]) * rng.uniform(0.98, 1.02, 4)
    tock = norm(modal(n, fr, np.array([9, 6, 4, 3]) * 1e-3 * size, [1, 0.7, 0.5, 0.3], rng))
    y = burst + 0.6 * tock
    if body > 0:
        fb = 820.0 / size
        y = y + body * norm(modal(n, [fb, fb * 1.61], [4e-3 * size, 2.5e-3], [1, 0.4], rng))
    return y


def g_shutter(rng, light=False):
    """Mechanical camera shutter: click - curtain swish - mirror clack (+ bounce tick)."""
    sp = 2.0 / 30.0 if light else rng.uniform(0.072, 0.080)
    n = n_(sp + 0.09)
    y = np.zeros(n)
    y = add_at(y, metal_click(rng, 0.85 if light else 1.0, 1.2, 0.15 if light else 0.35), 0.0)
    sw_n = n_(sp - 0.004)
    tt = tvec(sw_n) / (sp - 0.004)
    sw = bp(rng.standard_normal(sw_n), 2200, 8500) * (0.25 + 0.75 * np.sin(np.pi * tt) ** 1.5)
    sw = ramp_out(ramp_in(sw, 0.002), 0.001)
    y = add_at(y, (0.10 if light else 0.14) * norm(sw), 0.004)
    c2 = metal_click(rng, 1.0 if light else 1.3, 0.9, 0.2 if light else 0.8)
    y = add_at(y, (0.75 if light else 1.1) * c2, sp)
    y = add_at(y, 0.22 * metal_click(rng, 0.8, 1.3, 0.0, 0.03), sp + rng.uniform(0.009, 0.013))
    return panned(y, 0.0)  # kept centred: many phones play mono


def g_whoosh(rng, dur, peak_at, fcs, bw=1.3, pan=(0.0, 0.0), width=0.5, rise_db=-24.0,
             fall_db=-40.0, turb=0.25, paper=0.0, hard_end=False, pan_curve=None):
    """Moving band-pass noise whoosh. fcs = (start, at peak, end) Hz."""
    n = n_(dur)
    t = tvec(n)
    u = t / dur
    fc = lambda v: logseg(v, [(0.0, fcs[0]), (peak_at, fcs[1]), (1.0, fcs[2])])
    x = shaped_noise(rng, n, fc, lambda v: bw + 0 * v, corr=1.0 - width)
    r = np.clip(u / max(peak_at, 1e-6), 0, 1)
    f = np.clip((u - peak_at) / max(1.0 - peak_at, 1e-6), 0, 1)
    db = np.where(u < peak_at, rise_db * (1.0 - r) ** 1.6, fall_db * f ** 1.3)
    env = 10 ** (db / 20.0)
    if turb > 0:
        env = env * (1.0 + turb * np.tanh(smooth_noise(rng, n, 28.0) * 0.8))
    y = x * env[:, None]
    if paper > 0:
        c = np.stack([crackle(rng, n, 900.0 * env + 40.0), crackle(rng, n, 900.0 * env + 40.0)], 1)
        y = y + paper * c / (np.std(c) + 1e-12) * 0.35 * env[:, None]
        y = hp(y, 900.0)
    ramp_in(y, 0.002)
    ramp_out(y, 0.0015 if hard_end else 0.006)
    pc = u if pan_curve is None else pan_curve(u)
    return panned(y, pan[0] + (pan[1] - pan[0]) * pc)


def ease_out_cubic(u):
    return 1 - (1 - u) ** 3


def ease_in_out_cubic(u):
    return np.where(u < 0.5, 4 * u ** 3, 1 - (-2 * u + 2) ** 3 / 2)


def g_zip(rng, dur=0.45, pan=(-0.55, 0.55)):
    """Tape-measure zip: ratchet ticks whose rate follows the (easeInOutCubic) draw speed."""
    n = n_(dur + 0.03)
    t = tvec(n)
    u = np.clip(t / dur, 0, 1)
    v = np.where(u < 0.5, 12 * u ** 2, 12 * (1 - u) ** 2) / 3.0
    v[t > dur] = 0
    rate = 35.0 + 185.0 * v
    ph = np.cumsum(rate) / SR
    idx = np.concatenate([[0], np.nonzero(np.diff(np.floor(ph)) > 0)[0] + 1])
    idx = idx[t[idx] < dur]
    y = np.zeros(n)
    for i in idx:
        c = modal(n_(0.012), np.array([3100, 4700, 6900]) * rng.uniform(0.95, 1.05, 3),
                  np.array([1.6, 1.1, 0.8]) * 1e-3, [1, 0.6, 0.4], rng)
        c = c + 0.5 * norm(bp(rng.standard_normal(len(c)) * np.exp(-tvec(len(c)) / 0.0006), 2500, 9000))
        a = rng.uniform(0.6, 1.0) * (0.45 + 0.55 * v[i])
        y = add_at(y, a * norm(c), t[i])[:n]
    whirr = shaped_noise(rng, n, lambda q: 2400 + 2600 * np.clip(q, 0, 1), lambda q: 1.0 + 0 * q, 0.8)[:, 0]
    y = y + 0.22 * whirr * (0.12 + 0.88 * v)
    end = click_layer(rng, 0.7, 4.0, 1.2, 0.0, 1.0, dur=0.03)
    y = add_at(y, 0.4 * end, dur - 0.005)[:n]
    ramp_out(y, 0.004)
    return panned(y, pan[0] + (pan[1] - pan[0]) * ease_in_out_cubic(u))


def g_paper_drop(rng, weight=1.0, pan=0.0):
    """Photo print / booklet dropping flat onto a table."""
    n = n_(0.32)
    t = tvec(n)
    slap = norm(bp(rng.standard_normal(n) * np.exp(-t / (0.0045 * weight ** 0.3)), 280, 3800))
    puff = norm(lp(rng.standard_normal(n), 520, 2) * np.minimum(1, t / 0.0015) * np.exp(-t / 0.022))
    knock = norm(modal(n, [138, 305, 780], [0.028, 0.012, 0.006], [1.0, 0.5, 0.45], rng))
    rust = crackle(rng, n, 600 * np.exp(-t / 0.05) + 20, 2500, 10000)
    rust = norm(rust + 0.3 * norm(hp(rng.standard_normal(n), 3000)) * np.exp(-t / 0.03) * np.std(rust) * 3)
    y = 1.0 * slap + 0.75 * puff + 0.45 * weight * knock + 0.22 * rust * np.exp(-t / 0.06)
    ramp_in(y, 0.0004)
    ramp_out(y, 0.02)
    s = panned(y, pan)
    s[:, 1] += 0.05 * panned(norm(hp(rng.standard_normal(n), 4000)) * np.exp(-t / 0.02), pan)[:, 1]
    return s


def g_wood(rng, pan=-0.1):
    """Wooden shelf plank knock + short woody slide-in scrape from the left."""
    n = n_(0.45)
    t = tvec(n)
    knock = norm(modal(n, np.array([310, 690, 1120, 1710, 2590, 3820]) * rng.uniform(0.98, 1.02, 6),
                       [0.045, 0.030, 0.020, 0.013, 0.008, 0.005], [1.0, 0.8, 0.6, 0.45, 0.3, 0.2], rng))
    tr = norm(bp(rng.standard_normal(n) * np.exp(-t / 0.0012), 900, 5000))
    y = knock + 0.55 * tr
    sc_n = n_(0.3)
    st = tvec(sc_n) / 0.3
    scrape = bp(rng.standard_normal(sc_n) * (1 + 0.6 * np.sin(TAU * 38 * tvec(sc_n))), 500, 3500)
    scrape = norm(scrape) * (1 - st) ** 2 * 0.18
    y = add_at(y, scrape, 0.004)[:n]
    ramp_out(y, 0.03)
    return panned(y, np.linspace(pan - 0.25, pan, n))


def g_impact(rng):
    """DROP / CTA hit: pitch-swept sub boom (+harmonics for phones) + low plastic snap-clack."""
    n = n_(1.1)
    t = tvec(n)
    f = 44.0 + 82.0 * np.exp(-t / 0.045)
    ph = TAU * np.cumsum(f) / SR
    env = np.minimum(1.0, t / 0.0015) * np.exp(-t / 0.2)
    sub = np.sin(ph) * env
    sat = np.tanh(2.4 * sub) / np.tanh(2.4)
    harm = lp(hp(sat - sub, 140, 2), 650, 2)  # odd harmonics (130-400 Hz) so the boom still reads on phone speakers
    boom = sub + 1.2 * harm
    knock = norm(lp(rng.standard_normal(n), 380, 2) * np.minimum(1, t / 0.001) * np.exp(-t / 0.028))
    clack = snap(rng, 1.7, -2.0, 0.85, 1.0, True, sec_amp=0.45, sec_delay=0.017)
    y = 0.95 * norm(boom) + 0.35 * knock
    y = add_at(y, 0.6 * norm(clack), 0.0)[:n]
    ramp_out(y, 0.15)
    s = panned(y, 0.0)
    # a touch of width on the clack/air only (sub stays mono)
    air = hp(rng.standard_normal((n, 2)), 1500) * (np.exp(-t / 0.018) * np.minimum(1, t / 0.0005))[:, None]
    return s + 0.05 * norm(air)


def bubble(rng, f0=500.0, f1=1300.0, glide=0.007, tau=0.010, click=0.3, dur=0.1):
    n = n_(dur)
    t = tvec(n)
    f = f1 - (f1 - f0) * np.exp(-t / glide)
    ph = TAU * np.cumsum(f) / SR
    y = np.sin(ph) * np.minimum(1.0, t / 0.0006) * np.exp(-t / tau)
    y = y + 0.12 * np.sin(2 * ph) * np.exp(-t / (tau * 0.5))
    c = norm(bp(rng.standard_normal(n) * np.exp(-t / 0.0005), 1200, 7000))
    return norm(y) + click * c


def g_pop(rng, kind, pan):
    if kind == "stamp":
        y = bubble(rng, 380, 950, 0.007, 0.011, 0.35)
        tap = norm(bp(rng.standard_normal(len(y)) * np.exp(-tvec(len(y)) / 0.004), 350, 3200))
        y = y + 0.55 * tap
    elif kind == "small":
        y = bubble(rng, 700, 1800, 0.005, 0.008, 0.4, 0.06)
    elif kind == "label":
        y = bubble(rng, 520, 1400, 0.006, 0.010, 0.4)
        y = add_at(y, 0.15 * norm(crackle(rng, n_(0.03), 600, 2500, 9000)) * np.exp(-tvec(n_(0.03)) / 0.01), 0.003)
    else:
        y = bubble(rng)
    return panned(y, pan)


def g_rattle(rng, dur, count, avoid=(), spread=0.9):
    """Plastic brick-confetti rattle: many tiny clicks, dense at first, thinning out."""
    n = n_(dur + 0.08)
    out = np.zeros((n, 2))
    times = np.sort(dur * rng.random(count) ** 2.0)
    kept = [tt for tt in times if all(abs(tt - a) > 0.008 for a in avoid)]
    for tt in kept:
        y = click_layer(rng, rng.uniform(0.35, 0.72), rng.uniform(-2.0, 5.0), rng.uniform(0.9, 1.3),
                        0.0, rng.uniform(0.6, 1.2), dur=0.05)
        if rng.random() < 0.25:
            y2 = click_layer(rng, rng.uniform(0.35, 0.6), rng.uniform(0, 5), 1.2, 0.0, 1.0, dur=0.04)
            y = add_at(y, rng.uniform(0.3, 0.7) * y2, rng.uniform(0.003, 0.009))
        a = rng.uniform(0.4, 1.0) * np.exp(-tt / (dur * 0.5))
        p = rng.uniform(-1, 1) * spread * (0.3 + 0.7 * min(1.0, tt / 0.15))
        out = add_at(out, a * panned(y, p), tt)[:n]
    t = tvec(n)
    bed = np.stack([crackle(rng, n, 1500 * np.exp(-t / (dur * 0.25)) + 5, 3000, 11000) for _ in range(2)], 1)
    out += 0.25 * bed / (np.max(np.abs(bed)) + 1e-12) * np.exp(-t / (dur * 0.3))[:, None]
    ramp_out(out, 0.05)
    return out


def g_confetti(rng, tail, count, avoid):
    """Confetti burst: party-pop crack + air puff + low bubble blip, then the rattle tail."""
    n = n_(0.2)
    t = tvec(n)
    crack = norm(bp(rng.standard_normal(n) * np.exp(-t / 0.0028), 700, 7500))
    puff = norm(lp(rng.standard_normal(n), 900) * np.minimum(1, t / 0.001) * np.exp(-t / 0.03))
    blip = bubble(rng, 420, 980, 0.008, 0.014, 0.0, 0.2)
    y = panned(crack + 0.5 * puff + 0.9 * norm(blip), 0.0)
    y = y + 0.06 * hp(rng.standard_normal((n, 2)), 2000) * np.exp(-t / 0.01)[:, None]
    r = g_rattle(rng, tail, count, [a - 0.012 for a in avoid])
    return add_at(y, 0.55 * r / peak(r), 0.012)


def glass(n, f, tau, rng):
    t = tvec(n)
    y = np.sin(TAU * f * t)
    y += 0.45 * np.sin(TAU * f * 1.0013 * t + rng.uniform(0, TAU)) * np.exp(-t / (tau * 1.3))
    y += 0.22 * np.sin(TAU * 2.756 * f * t) * np.exp(-t / (tau * 0.3))
    return ramp_in(y * np.exp(-t / tau), 0.0003)


def g_sparkle(rng, pan=0.0, width=0.5, count=8, spread=0.16,
              pool=("D7", "F#7", "A7", "B7", "D8", "E8", "F#8", "A8"), first="D8"):
    """Glassy twinkle cluster: bell partials in D-major pentatonic with random micro-delays."""
    n = n_(spread + 0.7)
    out = np.zeros((n, 2))
    notes = rng.choice(pool, size=count)
    notes[0] = pool[-1] if first is None else first
    delays = np.sort(np.concatenate([[0.0], spread * rng.random(count - 1) ** 1.4]))
    for i, (nm, d) in enumerate(zip(notes, delays)):
        f = NOTE[nm] * rng.uniform(0.998, 1.002)
        tau = rng.uniform(0.10, 0.28) * (3000.0 / f) ** 0.5
        a = (1.0 if i == 0 else rng.uniform(0.35, 0.85)) * np.exp(-d / (spread * 1.5))
        g = glass(n_(0.7), f, tau, rng)
        out = add_at(out, a * panned(g, pan + width * rng.uniform(-1, 1)), d)[:n]
    t = tvec(n)
    air = hp(rng.standard_normal((n, 2)), 6500) * (np.minimum(1, t / 0.02) * np.exp(-t / 0.06))[:, None]
    out += 0.05 * air / (np.std(air) + 1e-12)
    ramp_out(out, 0.05)
    return out


def g_ding(rng, pan=-0.2):
    """Counter-lands bell ding: glock-style D7 over a soft D6, mallet tick, a few sparkles."""
    n = n_(0.9)
    t = tvec(n)
    f = NOTE["D7"]
    y = modal(n, [f, 2.756 * f, 5.404 * f], [0.42, 0.12, 0.045], [1.0, 0.28, 0.08], rng, 0.0006)
    y = y + 0.35 * modal(n, [NOTE["D6"]], [0.5], [1.0], rng, 0.0008)
    y = y + 0.25 * norm(hp(rng.standard_normal(n) * np.exp(-t / 0.0006), 3000))
    s = panned(norm(y), pan)
    sp = g_sparkle(rng, pan, 0.45, 4, 0.12, ("A7", "D8", "F#8", "A8"), None)
    s = add_at(s, 0.28 * sp, 0.03)[:n]
    ramp_out(s, 0.08)
    return s


def g_glint(rng, pan=-0.3):
    """Single glint: bright ping + one grace partial + air shimmer."""
    n = n_(0.6)
    y = np.zeros((n, 2))
    y = add_at(y, panned(glass(n, NOTE["D8"], 0.16, rng), pan), 0.0)[:n]
    y = add_at(y, 0.55 * panned(glass(n_(0.5), NOTE["A8"], 0.1, rng), pan + 0.15), 0.028)[:n]
    y = add_at(y, 0.3 * panned(glass(n_(0.5), NOTE["F#8"], 0.12, rng), pan - 0.1), 0.055)[:n]
    t = tvec(n)
    air = hp(rng.standard_normal((n, 2)), 7000) * (np.minimum(1, t / 0.015) * np.exp(-t / 0.05))[:, None]
    y += 0.06 * air / (np.std(air) + 1e-12)
    ramp_out(y, 0.05)
    return y


def g_riser(rng, dur):
    """Noise band sweeping up + gliding tone D4 -> D6 with growing vibrato; cut dead at the end."""
    n = n_(dur)
    t = tvec(n)
    u = t / dur
    nz = shaped_noise(rng, n, lambda v: 450.0 * (8500.0 / 450.0) ** (v ** 1.25),
                      lambda v: 1.6 - 1.1 * v, corr=0.35)
    e = 10 ** ((-30.0 + 30.0 * u ** 1.6) / 20.0)
    f = 293.66 * 4.0 ** (u ** 1.45)
    vib = 1.0 + (0.002 + 0.006 * u) * np.sin(TAU * np.cumsum(4.0 + 8.0 * u) / SR)
    ph = TAU * np.cumsum(f * vib) / SR
    ph2 = TAU * np.cumsum(f * vib * 2 ** (9 / 1200)) / SR
    tone = lambda p: np.sin(p) + 0.35 * np.sin(2 * p) + 0.15 * np.sin(3 * p)
    te = 10 ** ((-34.0 + 30.0 * u ** 1.4) / 20.0)
    tn = np.stack([tone(ph), tone(ph2)], 1) * te[:, None]
    y = nz * e[:, None] + 0.55 * tn / (np.max(np.abs(tn)) + 1e-12) * np.max(np.abs(nz * e[:, None]))
    ramp_in(y, 0.002)
    ramp_out(y, 0.0015)
    return y


def g_revcym(rng, dur):
    """Reverse cymbal: metallic 808-style square cluster + hiss, swelling and brightening, cut dead."""
    n = n_(dur)
    t = tvec(n)
    u = t / dur
    fr = np.array([205.3, 304.4, 369.6, 522.7, 540.0, 800.0]) * 1.6 * rng.uniform(0.98, 1.02, 6)
    sq = sum(np.sign(np.sin(TAU * f * t + rng.uniform(0, TAU))) for f in fr)
    metal = norm(bp(sq, 3500, 13000, 2))
    out = np.zeros((n, 2))
    for ch in range(2):
        hiss = norm(hp(rng.standard_normal(n), 4500, 2))
        tex = 0.55 * metal + 0.8 * hiss
        dark = lp(tex, 5000, 2)
        out[:, ch] = dark + (tex - dark) * u ** 1.5
    e = 10 ** ((-30.0 + 30.0 * u ** 1.25) / 20.0)
    out *= e[:, None]
    ramp_in(out, 0.001)
    ramp_out(out, 0.001)
    return out


def g_page(rng, direction=+1):
    """Booklet page dealt from one side: snick, flutter swish, crinkle, soft landing slap."""
    dur = 0.30
    n = n_(dur + 0.12)
    t = tvec(n)
    u = np.clip(t / dur, 0, 1)
    snick = norm(hp(rng.standard_normal(n) * np.exp(-t / 0.0009), 2500)) * 0.6
    fc = lambda v: logseg(v, [(0, 2600), (0.3, 4600), (1.0, 2200)])
    sw = shaped_noise(rng, n, fc, lambda v: 1.8 + 0 * v, corr=0.7)
    r = np.clip(u / 0.28, 0, 1)
    f = np.clip((u - 0.28) / 0.72, 0, 1)
    env = 10 ** (np.where(u < 0.28, -20 * (1 - r) ** 1.5, -34 * f ** 1.2) / 20)
    env[t > dur] *= np.exp(-(t[t > dur] - dur) / 0.01)
    fl_rate = 30.0 - 16.0 * u
    flutter = 0.45 + 0.55 * (0.5 + 0.5 * np.sin(TAU * np.cumsum(fl_rate) / SR)) ** 2
    y = sw * (env * flutter)[:, None] * 0.35
    cr = crackle(rng, n, 250 * env + 10, 2500, 11000)
    y += (0.35 * cr / (np.max(np.abs(cr)) + 1e-12) * env)[:, None]
    y[:, 0] += snick
    y[:, 1] += snick
    land = 0.27
    ln = n_(0.12)
    lt = tvec(ln)
    slap = norm(bp(rng.standard_normal(ln) * np.exp(-lt / 0.006), 350, 3500)) * 0.4
    slap += norm(lp(rng.standard_normal(ln), 600) * np.minimum(1, lt / 0.001) * np.exp(-lt / 0.015)) * 0.25
    y = add_at(y, np.stack([slap, slap], 1), land)[:n]
    ramp_out(y, 0.02)
    pan = direction * (0.6 - 0.55 * ease_out_cubic(u))
    return panned(y, pan)


# ----------------------------------------------------------------------------- cue -> recipe
def _pan_from_notes(notes, default=0.0):
    s = notes.lower()
    if "from the right" in s:
        return (0.7, 0.3)
    if "from the left" in s:
        return (-0.7, -0.3)
    if "left to right" in s:
        return (-0.7, 0.7)
    return (default, default)


def design(cue, rng, ctx):
    """Return (stereo buffer, variant, description) for one storyboard cue."""
    typ = cue["type"]
    notes = cue.get("notes", "")
    s = notes.lower()
    pan = cue.get("pan")
    pitch = float(cue.get("pitch", 0.0))
    t0 = float(cue["t"])

    if typ == "brick_click":
        if "cascade" in s:
            m = re.search(r"(\d+)\s*/\s*(\d+)", notes)
            k, cnt = (int(m.group(1)), int(m.group(2))) if m else (1, 1)
            return g_tiny(rng, pan if pan is not None else 0.0, k, cnt), "tiny", f"1x1 stud click {k}/{cnt}"
        if "counter tick" in s or "tick" in s and "counter" in s:
            return g_tick(rng, pan if pan is not None else -0.25), "tick", "counter tick"
        if "montage" in s or "pitch" in cue:
            heavy = "heavier" in s or "complete" in s
            return g_montage(rng, pitch, heavy), "montage", f"tuned snap D6{pitch:+.0f}st" + (" heavy" if heavy else "")
        if "triple" in s:
            return g_triple(rng), "triple", "triple snap L/R/C"
        m = re.search(r"lands\s+(\d+(?:\.\d+)?)", s)
        if m and float(m.group(1)) > t0:
            land = float(m.group(1)) - t0
            return g_urlbrick(rng, land), "urlbrick", f"fall swish + 1x6 snap at +{land * 1000:.0f} ms"
        if "press" in s:
            return g_press(rng), "press", "press + release click"
        if "divider" in s:
            return g_snap(rng, pan if pan is not None else 0.3, 1.1, 0.0, 1.0, 0.55), "snap", "divider snap"
        if "top layer" in s or "drop" in s:
            return g_snap(rng, pan if pan is not None else 0.0, 1.35, 0.0, 1.15, 0.8), "snap", "big bright snap"
        if "reveal" in s or "tally" in s:
            return g_snap(rng, pan if pan is not None else 0.25, 1.05, 0.0, 1.05, 0.55), "snap", "reveal snap"
        if "handle" in s or "slider" in s:
            return g_snap(rng, pan if pan is not None else 0.3, 1.15, 0.0, 1.1, 0.6), "snap", "2x2 handle snap"
        return g_snap(rng, pan if pan is not None else 0.0), "snap", "brick snap"

    if typ == "shutter":
        light = "blink" in s or "window" in s
        return g_shutter(rng, light), "shutter", "shutter (blink)" if light else "shutter"

    if typ == "whoosh":
        p = _pan_from_notes(notes)
        if pan is not None:
            p = (pan, pan)
        if "tape" in s or "zip" in s:
            return g_zip(rng), "zip", "tape-measure zip L->R"
        if "suck" in s:
            end = ctx.get("suck_end", 0.07)
            return g_whoosh(rng, end, 0.999, (1200, 7000, 7000), 1.2, p, 0.7, rise_db=-20,
                            turb=0.15, hard_end=True), "suck", f"air-suck swell {end * 1000:.0f} ms, cut dead"
        if "whip" in s:
            return g_whoosh(rng, 0.5, 0.04, (5000, 5200, 650), 1.4, p, 0.85, rise_db=-14,
                            fall_db=-42, pan_curve=ease_out_cubic), "whoosh", "whip-zoom out"
        if "pre-lap" in s or "part" in s and "split" in s:
            return g_whoosh(rng, 0.46, 0.68, (700, 3400, 1500), 1.4, p, 0.9, rise_db=-24,
                            fall_db=-36), "whoosh", "pre-lap split whoosh (wide)"
        if "slide off" in s:
            a = g_whoosh(rng, 0.46, 0.8, (1800, 3600, 2800), 1.8, (-0.1, -0.8), 0.4, -22, -30,
                         paper=0.8)
            b = g_whoosh(rng, 0.46, 0.82, (1600, 3300, 2500), 1.8, (0.1, 0.8), 0.4, -22, -30,
                         paper=0.8)
            return a + b, "paper_slide", "two prints slide off L + R"
        if "paper slide" in s or ("slides in" in s and "polaroid" in s):
            return g_whoosh(rng, 0.36 if "polaroid" not in s else 0.45, 0.22, (2200, 3800, 2400),
                            1.8, p if p != (0.0, 0.0) else (-0.8, -0.45), 0.35, -10, -34,
                            paper=1.0, pan_curve=ease_out_cubic), "paper_slide", "paper slide"
        if "sweeps" in s:
            return g_whoosh(rng, 0.5, 0.5, (1200, 2600, 1500), 1.0, p, 0.3, -24, -34,
                            pan_curve=ease_in_out_cubic), "whoosh", "slider sweep L->R"
        if "drops top to bottom" in s or ("slider" in s and "drop" in s):
            return g_whoosh(rng, 0.5, 0.5, (4200, 2200, 800), 1.1, p, 0.3, -24, -34), "whoosh", "slider drop (falling band)"
        if "downward" in s:
            return g_whoosh(rng, 0.44, 0.3, (3800, 2200, 480), 1.3, p, 0.7, -18, -40), "whoosh", "downward whoosh"
        if "slides up" in s:
            return g_whoosh(rng, 0.4, 0.14, (900, 2400, 3000), 1.4, p, 0.6, -16, -36,
                            pan_curve=ease_out_cubic), "whoosh", "stage slide-up (rising band)"
        if "punch" in s:
            w = g_whoosh(rng, 0.17, 0.05, (2200, 4200, 3000), 1.2, p, 0.5, -6, -34, turb=0.1)
            tt = tvec(len(w))
            thup = norm(bp(rng.standard_normal(len(w)) * np.exp(-tt / 0.006), 180, 1500))
            return w + 0.5 * peak(w) * panned(thup, 0.0), "whoosh", "punch-in (air + thup)"
        if "pops in" in s:
            return g_whoosh(rng, 0.18, 0.14, (3000, 2600, 1400), 1.2, p, 0.5, -7, -34,
                            turb=0.1), "whoosh", "window pop-in fwip"
        return g_whoosh(rng, 0.4, 0.5, (900, 3000, 1500), 1.3, p, 0.6), "whoosh", "whoosh"

    if typ == "thud":
        if "drop" in s and ("sub" in s or "snap" in s) or "cta hit" in s or "sub" in s:
            return g_impact(rng), "impact", "sub boom + snap-clack"
        if "wood" in s or "plank" in s or "shelf" in s:
            return g_wood(rng, pan if pan is not None else 0.0), "wood", "wood knock + scrape"
        w = 0.6 if "settles" in s else 1.0
        dp = 0.0
        if "arrival" in s:
            dp = -0.2
        elif "promenade" in s:
            dp = 0.25
        return g_paper_drop(rng, w, pan if pan is not None else dp), "paper_drop", "paper drop" + (" (settle)" if w < 1 else "")

    if typ == "pop":
        if "confetti" in s:
            m = re.search(r"tail to\s+(\d+(?:\.\d+)?)", s)
            tail = float(m.group(1)) - t0 if m else 1.0
            count = 26 if "small" in s else 80
            avoid = [a - t0 for a in ctx["other_times"] if t0 < a < t0 + tail + 0.1]
            return g_confetti(rng, tail, count, avoid), "confetti", f"confetti pop + rattle {tail:.2f} s ({count})"
        if "stamp" in s:
            return g_pop(rng, "stamp", pan if pan is not None else -0.25), "pop", "stamp pop"
        if "bottom-left" in s or "url bug" in s or "small" in s:
            return g_pop(rng, "small", pan if pan is not None else -0.35), "pop", "small pop"
        if "label" in s:
            return g_pop(rng, "label", pan if pan is not None else 0.12), "pop", "label pop"
        return g_pop(rng, "", pan if pan is not None else 0.0), "pop", "bubble pop"

    if typ == "sparkle":
        if "ding" in s or "bell" in s:
            return g_ding(rng, pan if pan is not None else -0.2), "ding", "bell ding D7 + sparkles"
        if "glint" in s:
            return g_glint(rng, pan if pan is not None else -0.3), "glint", "glint ping D8"
        return g_sparkle(rng, pan if pan is not None else -0.1, 0.5, 9, 0.18), "sparkle", "glass sparkle cluster"

    if typ == "riser":
        dur = float(cue.get("dur", 1.0))
        if "cymbal" in s:
            return g_revcym(rng, dur), "revcym", f"reverse cymbal {dur:.2f} s"
        return g_riser(rng, dur), "riser", f"noise+tone riser {dur:.2f} s, cut dead"

    if typ == "page_flip":
        d = -1 if "from the left" in s else +1
        return g_page(rng, d), "page_flip", "page dealt from " + ("left" if d < 0 else "right")

    # unknown type: generic small snap so nothing is silently dropped
    print(f"  WARNING: unknown sfx type {typ!r} at {t0}; using a brick snap", file=sys.stderr)
    return g_snap(rng, 0.0), "snap", f"fallback for {typ}"


# ----------------------------------------------------------------------------- render
def cue_seed(cue, k):
    key = f"{cue['type']}|{float(cue['t']):.4f}|{k}"
    return (zlib.crc32(key.encode()) ^ BASE_SEED) & 0xFFFFFFFF


def follower(x, att=0.0005, rel=0.030):
    """Peak envelope follower (1 ms blocks) of a mono signal."""
    blk = SR // 1000
    nb = len(x) // blk + 1
    pad = np.zeros(nb * blk)
    pad[:len(x)] = np.abs(x)
    b = pad.reshape(nb, blk).max(axis=1)
    ca, cr = np.exp(-1.0 / (att * 1000)), np.exp(-1.0 / (rel * 1000))
    e, out = 0.0, np.zeros(nb)
    for i, v in enumerate(b):
        c = ca if v > e else cr
        e = c * e + (1 - c) * v
        out[i] = e
    return np.repeat(out, blk)[:len(x)]


def render(sb, quiet=False):
    dur = float(sb["duration"])
    N = n_(dur)
    cues = sb["sfx"]
    times = [float(c["t"]) for c in cues]
    track = np.zeros((N, 2))
    placed = []
    seen = {}
    # the air-suck ends where the next hard hit starts (e.g. 7.93 -> 8.00)
    for i, c in enumerate(cues):
        t0 = float(c["t"])
        k = seen.get((c["type"], round(t0, 4)), 0)
        seen[(c["type"], round(t0, 4))] = k + 1
        rng = np.random.default_rng(cue_seed(c, k))
        ctx = {"other_times": [a for j, a in enumerate(times) if j != i]}
        later = sorted(a for a in times if a > t0 + 0.02)
        if later:
            ctx["suck_end"] = min(0.25, later[0] - t0)
        buf, variant, desc = design(c, rng, ctx)
        buf = norm(buf) * 10 ** ((REF_DB[variant] + MASTER_DB) / 20.0) * float(c.get("gain", 1.0))
        i0 = n_(t0)
        i1 = min(N, i0 + len(buf))
        lost = buf[i1 - i0:]
        if len(lost) and peak(lost) > 1e-3:
            print(f"  WARNING: cue {i} at {t0} truncated at the end ({20 * np.log10(peak(lost)):.1f} dBFS lost)")
        placed.append({"i": i, "t": t0, "type": c["type"], "gain": float(c.get("gain", 1.0)), "variant": variant,
                       "desc": desc, "i0": i0, "buf": buf[:i1 - i0], "pan": c.get("pan"), "pitch": c.get("pitch")})

    # micro-duck long risers under overlapping brick clicks (keeps the brickify cascade readable)
    for p in placed:
        if p["variant"] != "riser":
            continue
        a, b = p["i0"], p["i0"] + len(p["buf"])
        clicks = np.zeros(b - a)
        for q in placed:
            if q["type"] == "brick_click" and a <= q["i0"] < b:
                seg = np.abs(q["buf"]).max(1)
                j = q["i0"] - a
                m = min(len(seg), b - a - j)
                clicks[j:j + m] = np.maximum(clicks[j:j + m], seg[:m])
        if clicks.max() > 0:
            env = follower(clicks)
            ref = np.abs(p["buf"]).max(1)
            depth = np.clip(env / (np.maximum(ref, 1e-4) * 1.0), 0, 1)
            g = 10 ** (-6.0 * depth / 20.0)
            p["buf"] = p["buf"] * g[:, None]
            p["duck"] = float(20 * np.log10(g.min()))

    for p in placed:
        track[p["i0"]:p["i0"] + len(p["buf"])] += p["buf"]

    sp = peak(track)
    tp = true_peak(track)
    trim = 0.0
    if sp > 10 ** (-1.2 / 20) or tp > 10 ** (-1.05 / 20):
        trim = min(-1.2 - 20 * np.log10(sp), -1.05 - 20 * np.log10(tp))
        track *= 10 ** (trim / 20)
        for p in placed:
            p["buf"] = p["buf"] * 10 ** (trim / 20)
        print(f"  NOTE: global trim {trim:+.2f} dB applied to stay under -1 dBFS")
    return track.astype(np.float32), placed, trim


def true_peak(x):
    y = signal.resample_poly(x, 4, 1, axis=0)
    return peak(y)


# ----------------------------------------------------------------------------- verification
def detect_onsets(x, thr_db=9.0):
    """Generic onset detector (independent of the cue list), run on the rendered file.

    Four bands (300 Hz high-pass, 0.4-1.2, 1.2-4.5, 4.5-12 kHz), per-sample peak over channels. In each
    band: ratio of the energy in the next 0.5 ms to the energy of the previous 5 ms; a rising edge
    above thr_db is a candidate, refined to the first sample exceeding 4x the preceding background
    amplitude. A sound emerging from digital silence (< -70 dBFS for 5 ms, then > -62 dBFS) is
    also an onset (catches slow swells such as the reverse cymbal). Candidates < 3 ms apart merge."""
    x = x.astype(np.float64)
    bands = [hp(x, 300.0, 2), bp(x, 400.0, 1200.0, 2), bp(x, 1200.0, 4500.0, 2), bp(x, 4500.0, 12000.0, 2)]
    n = len(x)
    idx = np.arange(n)
    wf, wb = 24, 240
    floor = (10 ** (-66 / 20)) ** 2
    cands = []
    for bi, y in enumerate(bands):
        a = np.max(np.abs(y), axis=1)
        c = np.concatenate([[0.0], np.cumsum(a * a)])
        ef = (c[np.minimum(idx + wf, n)] - c[idx]) / wf
        eb = (c[idx] - c[np.maximum(idx - wb, 0)]) / wb
        R = 10 * np.log10((ef + floor) / (eb + floor))
        on = R > thr_db
        starts = np.nonzero(on & ~np.concatenate([[False], on[:-1]]))[0]
        for s0 in starts:
            bg = max(np.sqrt(eb[s0]), 10 ** (-66 / 20))
            hit = np.nonzero(a[s0:s0 + n_(0.002)] > 4 * bg)[0]
            cands.append(s0 + (hit[0] if len(hit) else 0))
        if bi == 0:  # emergence from silence
            quiet = eb < (10 ** (-70 / 20)) ** 2
            loud = a > 10 ** (-62 / 20)
            em = np.nonzero(loud & np.concatenate([[True], quiet[:-1]]))[0]
            cands.extend(em.tolist())
    cands = np.unique(np.array(cands, dtype=np.int64))
    out = []
    for k in cands:
        if out and k - out[-1] < n_(0.003):
            continue
        out.append(k)
    return np.array(out, dtype=np.int64)


def verify(sb, track, placed, trim):
    N = n_(float(sb["duration"]))
    ok = True
    print(f"\nplaced {len(placed)} cues / storyboard {len(sb['sfx'])} cues -> "
          f"{'OK' if len(placed) == len(sb['sfx']) else 'MISMATCH'}")
    ok &= len(placed) == len(sb["sfx"])
    ons = detect_onsets(track)
    ons_t = ons / SR
    print(f"generic onset detector found {len(ons)} onsets (includes snap seating clicks, rattle grains, zip ticks)")
    print(f"\n{'#':>3} {'t':>7} {'type':<12} {'gain':>5} {'pan':>5} {'pk dBFS':>8} {'onset':>8} {'err ms':>7}  variant / notes")
    worst = 0.0
    fails = []
    for p in placed:
        pk = 20 * np.log10(peak(p["buf"]))
        j = np.searchsorted(ons_t, p["t"])
        cand = [ons_t[k] for k in (j - 1, j) if 0 <= k < len(ons_t)]
        near = min(cand, key=lambda v: abs(v - p["t"])) if cand else np.nan
        err = (near - p["t"]) * 1000
        good = abs(err) <= 2.0
        worst = max(worst, abs(err)) if np.isfinite(err) else worst
        if not good:
            fails.append(p)
        pan = "" if p["pan"] is None else f"{p['pan']:+.2f}"
        d = p["desc"] + (f" (ducked {p['duck']:.1f} dB under clicks)" if "duck" in p else "")
        print(f"{p['i']:>3} {p['t']:>7.3f} {p['type']:<12} {p['gain']:>5.2f} {pan:>5} {pk:>8.1f} "
              f"{near:>8.4f} {err:>+7.2f}{'' if good else ' !!'}  {d}")
    ok &= not fails
    print(f"\nonset check: {len(placed) - len(fails)}/{len(placed)} cues have a detected onset within 2 ms "
          f"(worst |err| {worst:.2f} ms)")
    sp = 20 * np.log10(peak(track))
    tp = 20 * np.log10(true_peak(track))
    print(f"full track: {len(track)} samples = {len(track) / SR:.4f} s (expected {N}) | sample peak {sp:.2f} dBFS | "
          f"true peak {tp:.2f} dBTP | global trim {trim:+.2f} dB")
    ok &= len(track) == N and sp < -1.0 and tp < -1.0
    tail = track[-n_(0.03):]
    print(f"last 30 ms peak {20 * np.log10(peak(tail)):.1f} dBFS, first sample {track[0].tolist()}")
    print("VERIFY:", "PASS" if ok else "FAIL")
    return ok, ons


def pngs(outdir, wav, track, placed, ons):
    from PIL import Image, ImageDraw
    os.makedirs(outdir, exist_ok=True)
    ff = os.environ.get("FFMPEG") or __import__("imageio_ffmpeg").get_ffmpeg_exe()
    subprocess.run([ff, "-y", "-hide_banner", "-loglevel", "error", "-i", wav, "-filter_complex",
                    "showwavespic=s=3000x600:split_channels=1:scale=sqrt:colors=0x1F5FA8|0xC4161C",
                    "-frames:v", "1", os.path.join(outdir, "sfx_wave.png")], check=True)
    subprocess.run([ff, "-y", "-hide_banner", "-loglevel", "error", "-i", wav, "-filter_complex",
                    "showspectrumpic=s=3000x900:legend=1:fscale=log:color=magma:scale=log",
                    "-frames:v", "1", os.path.join(outdir, "sfx_spectrum.png")], check=True)
    colors = {"brick_click": (196, 22, 28), "whoosh": (31, 95, 168), "thud": (90, 60, 20), "pop": (242, 154, 46),
              "sparkle": (150, 80, 200), "shutter": (0, 140, 90), "riser": (0, 160, 200), "page_flip": (120, 120, 120)}

    def panel(t0, t1, W, H, name):
        img = Image.new("RGB", (W, H + 40), (255, 255, 255))
        d = ImageDraw.Draw(img)
        a, b = n_(t0), n_(t1)
        seg = track[a:b]
        cols = np.array_split(np.arange(len(seg)), W)
        for ch, (y0, col) in enumerate(((0, (31, 95, 168)), (H // 2, (60, 60, 60)))):
            mid = y0 + H // 4
            for x, ix in enumerate(cols):
                if len(ix) == 0:
                    continue
                v = seg[ix, ch]
                lo, hi = v.min(), v.max()
                d.line([(x, mid - hi * H / 4), (x, mid - lo * H / 4)], fill=col)
        for p in placed:
            if t0 <= p["t"] <= t1:
                x = (p["t"] - t0) / (t1 - t0) * W
                d.line([(x, 0), (x, H)], fill=colors.get(p["type"], (0, 0, 0)), width=1)
        for o in ons:
            ts = o / SR
            if t0 <= ts <= t1:
                x = (ts - t0) / (t1 - t0) * W
                d.line([(x, H), (x, H + 12)], fill=(0, 0, 0))
        d.text((6, H + 16), f"{name}: {t0:.2f}-{t1:.2f} s   coloured lines = cue times (red click, blue whoosh, "
                            f"brown thud, orange pop, purple sparkle, green shutter, cyan riser, grey page); "
                            f"black ticks = detected onsets", fill=(0, 0, 0))
        img.save(os.path.join(outdir, f"sfx_{name}.png"))

    panel(0.0, 30.0, 3000, 500, "full")
    panel(6.95, 8.2, 2400, 500, "zoom_cascade")
    panel(8.0, 10.0, 2400, 500, "zoom_counter")
    panel(17.95, 19.8, 2400, 500, "zoom_montage")
    panel(24.95, 26.2, 2400, 500, "zoom_button")
    # spectrogram of the cascade + drop region
    subprocess.run([ff, "-y", "-hide_banner", "-loglevel", "error", "-ss", "6.9", "-t", "1.4", "-i", wav,
                    "-filter_complex", "showspectrumpic=s=1800x700:legend=1:color=magma:scale=log",
                    "-frames:v", "1", os.path.join(outdir, "sfx_spectrum_cascade.png")], check=True)
    print(f"PNGs written to {outdir}")


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--png", metavar="DIR", help="also write waveform/spectrogram PNGs to DIR")
    ap.add_argument("--out", default=OUT)
    args = ap.parse_args()
    sb = json.load(open(os.path.join(ROOT, "storyboard.json")))
    track, placed, trim = render(sb)
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    sf.write(args.out, track, SR, subtype="FLOAT")
    print(f"wrote {args.out}  ({len(track)} samples, {track.shape[1]} ch, {SR} Hz, float32)")
    ok, ons = verify(sb, track, placed, trim)
    if args.png:
        pngs(args.png, args.out, track, placed, ons)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
