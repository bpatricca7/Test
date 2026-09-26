#!/usr/bin/env python3
"""Music bed for the Riviera brick-model ad (storyboard.json -> "music").

French Riviera pop-house, 120 BPM, D major, D-Bm-G-A. Everything is synthesised with
numpy/scipy (no samples):

  pluck     Karplus-Strong nylon pluck (fractional-delay allpass tuning, pluck-position comb)
  pad/stab  musette accordion: two polyBLEP saws per note at +/-6 cents, 2-pole LP, 5 Hz tremolo
  acc       accordion lead (3 reeds + low reed) that takes the hook in the final chorus
  whistle   sine whistle with delayed 5 Hz vibrato, portamento and breath noise (+ ping-pong delay)
  glock     additive glockenspiel (free-bar partials 1 : 2.76 : 5.40 : 8.93) + music box (tine partials)
  bass      round sine/triangle bass, kick side-chain pump
  drums     pitch-swept sine kick + click, layered claps, shaker, open hat, snare roll, crash,
            sub boom, reverse cymbal, filtered-noise riser sweep
  fx        shared FFT-convolution reverb (synthetic stereo IR), bus glue compressor,
            4x-oversampled soft clipper, loudness auto-gain (BS.1770) to about -14 LUFS.

Stop-downs are rendered as separate segments that are cut dead (3 ms ramp, including their
reverb/delay tails): 7.50-8.00 contains only a quiet glock A5 and a -18 dB reverse cymbal,
21.50-22.00 is digital silence. The tail after 30.0 s (final-chord reverb + the pickup notes) is
wrapped onto the start and every stateful master process is primed circularly, so sample
1,439,999 flows straight into sample 0 when the ad loops.

Output: build/audio/music.wav, 48 kHz, stereo, float32, exactly duration*48000 samples.
Run:    python3 src/music.py            (about 20-40 s)
"""
import json
import os
import sys
import time

import numpy as np
import soundfile as sf
from scipy import signal

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "build", "audio", "music.wav")
SB = json.load(open(os.path.join(ROOT, "storyboard.json")))

SR = 48000
DUR = float(SB["duration"])                 # 30.0 s
BPM = float(SB["bpm"])                      # 120
BEAT = 60.0 / BPM                           # 0.5 s
E8, S16, T32 = BEAT / 2, BEAT / 4, BEAT / 8
BAR = 4 * BEAT                              # 2.0 s
N = int(round(DUR * SR))                    # 1,440,000
TAIL = 3.0                                  # rendered past the end, then wrapped onto the start
NT = N + int(TAIL * SR)
STOPS = [(float(s["start"]), float(s["end"])) for s in SB["music"]["sections"] if s["energy"] == "stop"]
STOP1, STOP2 = STOPS                        # (7.5, 8.0), (21.5, 22.0)
TARGET_LUFS = -14.0
CEIL = 10 ** (-1.35 / 20)                   # soft-clip ceiling (sample peak)
TP_MAX = 10 ** (-1.2 / 20)                  # true-peak safety
RNG = np.random.default_rng(20260926)
T_ABS = np.arange(NT) / SR

# times that must be sample-exact (hits / drops / stingers) - never humanised
EXACT = {0.0, 1.5, 7.5, 8.0, 11.5, 13.0, 19.5, 22.0, 25.0, 26.0, 28.0, 29.5}

# ----------------------------------------------------------------------------- music theory
_PC = {"C": 0, "C#": 1, "D": 2, "D#": 3, "E": 4, "F": 5, "F#": 6, "G": 7, "G#": 8, "A": 9, "A#": 10, "B": 11}


def midi(name):
    return 12 * (int(name[-1]) + 1) + _PC[name[:-1]]


def hz(m):
    return 440.0 * 2.0 ** ((np.asarray(m, dtype=float) - 69.0) / 12.0)


# D-Bm-G-A one per bar, restarted on D at the 22.00 CTA hit (bar 12) so the final chorus and
# the 28.00 ending land on D; bar 14 splits G|A for a V-I cadence into 28.00; the last half-bar
# is the A (V) pickup that resolves into bar 1 on the loop.
CHORDS = [(0, "D"), (2, "Bm"), (4, "G"), (6, "A"), (8, "D"), (10, "Bm"), (12, "G"), (14, "A"),
          (16, "D"), (18, "Bm"), (20, "G"), (22, "D"), (24, "Bm"), (26, "G"), (27, "A"),
          (28, "D"), (29.5, "A")]
ARP = {"D": ["D4", "A4", "F#5", "D5"], "Bm": ["B3", "F#4", "D5", "B4"],      # open R-5-10 (+8)
       "G": ["G3", "D4", "B4", "G4"], "A": ["A3", "E4", "C#5", "A4"]}
PADV = {"D": ["A3", "D4", "F#4", "A4"], "Bm": ["B3", "D4", "F#4", "B4"],
        "G": ["B3", "D4", "G4", "B4"], "A": ["A3", "C#4", "E4", "A4"]}
BASS = {"D": "D2", "Bm": "B1", "G": "G1", "A": "A1"}


def chord_at(t):
    c = CHORDS[0][1]
    for t0, name in CHORDS:
        if t + 1e-9 >= t0:
            c = name
    return c


# ----------------------------------------------------------------------------- helpers
def hum(t, ms):
    """Humanise an onset by a small seeded timing offset (never for EXACT hits)."""
    if round(t, 4) in EXACT:
        return t
    return t + float(np.clip(RNG.normal(0.0, ms / 2000.0), -ms / 1000.0, ms / 1000.0))


def vr(spread):
    return float(1.0 + np.clip(RNG.normal(0.0, spread), -2 * spread, 2 * spread))


def pan_lr(p):
    a = (np.clip(p, -1, 1) + 1) * np.pi / 4
    return np.cos(a) * np.sqrt(2), np.sin(a) * np.sqrt(2)


def add(stem, t, sig, pan=0.0):
    """Mix a mono (panned) or stereo signal into a stem at time t (sample-rounded)."""
    i0 = int(round(t * SR))
    if i0 >= len(stem):
        return
    sig = np.asarray(sig)
    n = min(len(sig), len(stem) - i0)
    if n <= 0:
        return
    if sig.ndim == 1:
        gl, gr = pan_lr(pan)
        stem[i0:i0 + n, 0] += gl * sig[:n]
        stem[i0:i0 + n, 1] += gr * sig[:n]
    else:
        stem[i0:i0 + n] += sig[:n]


def ramp_in(x, sec):
    k = min(len(x), max(1, int(sec * SR)))
    w = 0.5 - 0.5 * np.cos(np.pi * np.arange(k) / k)
    x[:k] *= w if x.ndim == 1 else w[:, None]
    return x


def ramp_out(x, sec):
    k = min(len(x), max(1, int(sec * SR)))
    w = 0.5 + 0.5 * np.cos(np.pi * (np.arange(k) + 1) / k)
    x[-k:] *= w if x.ndim == 1 else w[:, None]
    return x


_SOS = {}


def sos(kind, f, order=2):
    key = (kind, f if np.isscalar(f) else tuple(f), order)
    if key not in _SOS:
        _SOS[key] = signal.butter(order, f, btype=kind, fs=SR, output="sos")
    return _SOS[key]


def filt(x, kind, f, order=2):
    return signal.sosfilt(sos(kind, f, order), x, axis=0)


def noise(n, ch=1):
    return RNG.standard_normal((n, ch) if ch > 1 else n)


def rbj_lp(fc, q):
    w = 2 * np.pi * min(fc, 0.45 * SR) / SR
    cw, al = np.cos(w), np.sin(w) / (2 * q)
    b = np.array([(1 - cw) / 2, 1 - cw, (1 - cw) / 2])
    a = np.array([1 + al, -2 * cw, 1 - al])
    return b / a[0], a / a[0]


def shelf(x, f0, gain_db, kind="high", S=0.8):
    """RBJ shelving biquad."""
    A = 10 ** (gain_db / 40)
    w = 2 * np.pi * f0 / SR
    cw, sw = np.cos(w), np.sin(w)
    al = sw / 2 * np.sqrt((A + 1 / A) * (1 / S - 1) + 2)
    sg = 1 if kind == "high" else -1
    b = np.array([A * ((A + 1) + sg * (A - 1) * cw + 2 * np.sqrt(A) * al),
                  -2 * sg * A * ((A - 1) + sg * (A + 1) * cw),
                  A * ((A + 1) + sg * (A - 1) * cw - 2 * np.sqrt(A) * al)])
    a = np.array([(A + 1) - sg * (A - 1) * cw + 2 * np.sqrt(A) * al,
                  2 * sg * ((A - 1) - sg * (A + 1) * cw),
                  (A + 1) - sg * (A - 1) * cw - 2 * np.sqrt(A) * al])
    return signal.lfilter(b / a[0], a / a[0], x, axis=0)


def peaking(x, f0, gain_db, q):
    """RBJ peaking EQ biquad."""
    A = 10 ** (gain_db / 40)
    w = 2 * np.pi * f0 / SR
    al = np.sin(w) / (2 * q)
    b = np.array([1 + al * A, -2 * np.cos(w), 1 - al * A])
    a = np.array([1 + al / A, -2 * np.cos(w), 1 - al / A])
    return signal.lfilter(b / a[0], a / a[0], x, axis=0)


def tv_lowpass(x, fc, q=0.707, block=64):
    """Time-varying resonant low-pass (RBJ biquad, coefficients updated every `block` samples)."""
    x2 = x if x.ndim == 2 else x[:, None]
    y = np.empty_like(x2)
    zi = np.zeros((2, x2.shape[1]))
    for i in range(0, len(x2), block):
        b, a = rbj_lp(fc[min(i + block // 2, len(fc) - 1)], q)
        y[i:i + block], zi = signal.lfilter(b, a, x2[i:i + block], axis=0, zi=zi)
    return y if x.ndim == 2 else y[:, 0]


def saw_blep(freq, n=None, phase0=0.0):
    """Band-limited sawtooth (polyBLEP). freq: scalar (with n) or per-sample array."""
    if np.isscalar(freq):
        dt = np.full(n, freq / SR)
        ph = (phase0 + dt[0] * np.arange(n)) % 1.0
    else:
        dt = np.asarray(freq) / SR
        ph = (phase0 + np.cumsum(dt) - dt[0]) % 1.0
    y = 2.0 * ph - 1.0
    m = ph < dt
    x = ph[m] / dt[m]
    y[m] -= x + x - x * x - 1.0
    m = ph > 1.0 - dt
    x = (ph[m] - 1.0) / dt[m]
    y[m] -= x * x + x + x + 1.0
    return y


# ----------------------------------------------------------------------------- instruments
def ks_pluck(m, vel, dur, t60, fc):
    """Karplus-Strong nylon pluck with fractional-delay allpass tuning (exact pitch)."""
    f = float(hz(m))
    n = int(dur * SR)
    P = SR / f
    Nd = int(P - 1.0)                       # integer delay; 0.5 from the averager, rest allpass
    d = P - 0.5 - Nd                         # in [0.5, 1.5)
    c = (1 - d) / (1 + d)
    g = 10 ** (-3.0 / (t60 * f))            # per-period loss for the requested T60
    L = int(np.ceil(P)) + 1
    exc = RNG.standard_normal(L)
    exc = signal.lfilter(*signal.butter(2, min(2000 + 6000 * vel, 16000), fs=SR), exc)
    M = max(1, int(round(0.14 * P)))       # pluck position comb (warmer, hollow nylon tone)
    exc = exc - np.concatenate([np.zeros(M), exc[:-M]])
    exc -= exc.mean()
    x = np.zeros(n)
    x[:L] = exc
    # Y/X = 2(1+c z^-1) / (2(1+c z^-1) - g z^-Nd (1+z^-1)(c+z^-1))
    a = np.zeros(Nd + 3)
    a[0], a[1] = 2.0, 2.0 * c
    a[Nd] -= g * c
    a[Nd + 1] -= g * (1 + c)
    a[Nd + 2] -= g
    y = signal.lfilter([2.0, 2.0 * c], a, x)
    y /= np.max(np.abs(y)) + 1e-12
    y = signal.sosfilt(sos("highpass", 90), y)
    if fc < 15000:
        y = signal.sosfilt(sos("lowpass", float(round(fc, -1))), y)
    ramp_in(y, 0.0008)
    ramp_out(y, 0.06)
    return y * vel


GLOCK_PARTIALS = [(1.0, 1.0, 1.35), (2.756, 0.30, 0.30), (5.404, 0.13, 0.10), (8.933, 0.05, 0.05)]
MBOX_PARTIALS = [(1.0, 1.0, 0.95), (2.0, 0.05, 0.35), (5.93, 0.20, 0.09), (13.8, 0.04, 0.03)]


def bell(m, vel, length, partials, dscale=1.0, tick=0.12):
    f = float(hz(m))
    n = int(length * SR)
    t = np.arange(n) / SR
    y = np.zeros(n)
    for r, a, tau in partials:
        if f * r < 19000:
            y += a * np.exp(-t / (tau * dscale)) * np.sin(2 * np.pi * f * r * t)
    k = int(0.004 * SR)
    y[:k] += tick * signal.sosfilt(sos("highpass", 4000), RNG.standard_normal(k)) * np.exp(-np.arange(k) / (0.0008 * SR))
    ramp_in(y, 0.0006)
    ramp_out(y, 0.08)
    return y * vel


def music_box(m, vel, length=1.4):
    y = bell(m, 1.0, length, MBOX_PARTIALS, tick=0.2)
    y2 = bell(m + 0.04, 1.0, length, MBOX_PARTIALS, tick=0.0)   # +4 cents second comb tooth
    return (0.7 * y + 0.35 * y2) * vel


def bass_note(m, dur, vel, decay=None):
    f = float(hz(m))
    n = int((dur + 0.03) * SR)
    t = np.arange(n) / SR
    ph = 2 * np.pi * f * t
    tri = sum(((-1) ** ((k - 1) // 2)) * np.sin(k * ph) / (k * k) for k in (1, 3, 5, 7, 9) if k * f < 4000) * (8 / np.pi ** 2)
    y = 0.72 * np.sin(ph) + 0.38 * tri + 0.07 * np.sin(2 * ph)
    env = 0.72 + 0.28 * np.exp(-t / 0.09)
    if decay:
        env = env * np.exp(-t / decay)
    y = np.tanh(1.5 * y * env) / np.tanh(1.5)
    ramp_in(y, 0.003)
    y[int(dur * SR):] *= 0.0
    ramp_out(y[: int(dur * SR)], 0.025)
    return y * vel


def kick(vel):
    n = int(0.45 * SR)
    t = np.arange(n) / SR
    f = 55.0 + 115.0 * np.exp(-t / 0.026) + 60.0 * np.exp(-t / 0.004)
    ph = 2 * np.pi * (np.cumsum(f) - f[0]) / SR
    body = np.sin(ph) * np.exp(-t / 0.16) * (1 - 0.25 * np.exp(-t / 0.01))
    clk = signal.sosfilt(sos("highpass", 1800), RNG.standard_normal(n)) * np.exp(-t / 0.0011) * 0.16
    y = np.tanh(1.7 * (body + clk)) / np.tanh(1.7)
    ramp_out(y, 0.03)
    return y * vel


def sub_boom(vel):
    n = int(1.9 * SR)
    t = np.arange(n) / SR
    f = hz(midi("D1")) + (92.0 - hz(midi("D1"))) * np.exp(-t / 0.11)
    ph = 2 * np.pi * (np.cumsum(f) - f[0]) / SR
    y = np.sin(ph) * np.exp(-t / 0.75)
    y = np.tanh(1.3 * y) / np.tanh(1.3)
    ramp_in(y, 0.002)
    ramp_out(y, 0.3)
    return y * vel


def clap(vel, accent=False):
    n = int(0.45 * SR)
    t = np.arange(n) / SR
    env = np.zeros(n)
    for ti, a in zip((0.0, 0.007, 0.014, 0.021), (1.0, 0.8, 0.72, 0.8)):
        env += a * (t >= ti) * np.exp(-np.clip(t - ti, 0, None) / 0.0026)
    tail_tau = 0.13 if accent else 0.085
    env += 0.45 * (t >= 0.021) * np.exp(-np.clip(t - 0.021, 0, None) / tail_tau)
    common = RNG.standard_normal(n)
    out = np.zeros((n, 2))
    for ch in range(2):
        w = 0.72 * common + 0.28 * RNG.standard_normal(n)
        body = signal.sosfilt(sos("bandpass", (850, 2600)), w)
        snap = signal.sosfilt(sos("highpass", 3800), w) * 0.35
        out[:, ch] = (body + snap) * env
    if accent:       # second, roomier layer for the rally accents
        room = signal.sosfilt(sos("bandpass", (600, 5000)), RNG.standard_normal((n, 2)), axis=0)
        out += 0.35 * room * (np.exp(-t / 0.18) * (1 - np.exp(-t / 0.004)))[:, None]
    ramp_out(out, 0.05)
    return out * vel / (np.max(np.abs(out)) + 1e-9)


def snare(vel, f0):
    n = int(0.22 * SR)
    t = np.arange(n) / SR
    ph = 2 * np.pi * (np.cumsum(f0 * (1 + 0.25 * np.exp(-t / 0.01))) / SR)
    body = (0.8 * np.sin(ph) + 0.3 * np.sin(1.52 * ph)) * np.exp(-t / 0.035)
    nz = signal.sosfilt(sos("bandpass", (1800, 9000)), RNG.standard_normal(n)) * np.exp(-t / 0.05) * 1.1
    y = body + nz
    ramp_in(y, 0.0005)
    ramp_out(y, 0.04)
    return y * vel / (np.max(np.abs(y)) + 1e-9)


def shaker(vel):
    n = int(0.11 * SR)
    t = np.arange(n) / SR
    env = np.minimum(t / 0.005, 1.0) ** 2 * np.exp(-np.clip(t - 0.005, 0, None) / 0.03)
    y = signal.sosfilt(sos("bandpass", (4500, 11000)), RNG.standard_normal(n)) * env
    ramp_out(y, 0.02)
    return y * vel / (np.max(np.abs(y)) + 1e-9)


HAT_F = [5610.0, 6930.0, 7810.0, 8970.0, 10300.0, 11700.0]
_HAT_METAL = None


def open_hat(vel):
    """808-style: six band-limited (additive) square oscillators + noise, high-passed."""
    global _HAT_METAL
    n = int(0.24 * SR)
    t = np.arange(n) / SR
    if _HAT_METAL is None:
        _HAT_METAL = np.zeros(n)
        for f in HAT_F:
            f0, p0 = f / 13.0, RNG.uniform(0, 6.28)
            for k in range(1, int(20000 / f0) + 1, 2):
                _HAT_METAL += np.sin(k * (2 * np.pi * f0 * t + p0)) / k
        _HAT_METAL /= 6.0
    metal = _HAT_METAL
    y = signal.sosfilt(sos("highpass", 7000, 4), 0.6 * metal + RNG.standard_normal(n))
    y *= np.exp(-t / 0.055) * (1 - np.exp(-t / 0.0006))
    ramp_out(y, 0.04)
    return y * vel / (np.max(np.abs(y)) + 1e-9)


def crash(vel, length=3.2):
    n = int(length * SR)
    t = np.arange(n) / SR
    out = np.zeros((n, 2))
    fr = RNG.uniform(2600, 9500, 48)
    taus = RNG.uniform(0.35, 1.6, 48)
    for ch in range(2):
        w = RNG.standard_normal(n)
        hi = signal.sosfilt(sos("highpass", 7500), w) * np.exp(-t / 0.55)
        mid = signal.sosfilt(sos("bandpass", (2800, 7500)), w) * np.exp(-t / 1.05)
        met = sum(np.sin(2 * np.pi * f * t + RNG.uniform(0, 6.28)) * np.exp(-t / tau) for f, tau in zip(fr, taus)) / 10.0
        out[:, ch] = 0.9 * hi + 0.8 * mid + 0.35 * met
    out *= (1 - np.exp(-t / 0.0012))[:, None]
    ramp_out(out, 0.4)
    return out * vel / (np.max(np.abs(out)) + 1e-9)


def reverse_cymbal(dur):
    n = int(dur * SR)
    t = np.arange(n) / SR
    w = signal.sosfilt(sos("bandpass", (3000, 12000)), RNG.standard_normal((n, 2)), axis=0)
    env = np.exp((t - dur) / 0.08)
    y = w * env[:, None]
    ramp_in(y, 0.01)
    ramp_out(y, 0.002)
    return y / (np.max(np.abs(y)) + 1e-9)


def chord_pad(notes, dur, vel, fc, attack, release, swell_db=0.0, hit_decay=None):
    """Musette accordion chord: 2 polyBLEP saws per note at +/-6 cents, split L/R, 2-pole LP."""
    n = int((dur + release) * SR)
    out = np.zeros((n, 2))
    k = 1.0 / (2.0 * np.sqrt(len(notes)))
    for nm in notes:
        f = float(hz(midi(nm)))
        s1 = saw_blep(f * 2 ** (6 / 1200), n, RNG.random())
        s2 = saw_blep(f * 2 ** (-6 / 1200), n, RNG.random())
        out[:, 0] += k * (0.68 * s1 + 0.32 * s2)
        out[:, 1] += k * (0.32 * s1 + 0.68 * s2)
    out = signal.sosfilt(sos("lowpass", float(round(fc, -1))), out, axis=0)
    t = np.arange(n) / SR
    env = np.ones(n)
    ka = max(1, int(attack * SR))
    env[:ka] = 0.5 - 0.5 * np.cos(np.pi * np.arange(ka) / ka)
    if swell_db:
        env *= 10 ** (swell_db * np.clip(t / dur, 0, 1) / 20)
    if hit_decay:
        env *= hit_decay[1] + (1 - hit_decay[1]) * np.exp(-t / hit_decay[0])
    kd = int(dur * SR)
    kr = n - kd
    env[kd:] *= 0.5 + 0.5 * np.cos(np.pi * np.arange(kr) / kr)
    return out * env[:, None] * vel


def line_synth(notes, kind, vel=1.0):
    """Monophonic legato line. kind 'whistle' (sine, portamento, vibrato) or 'acc' (reeds)."""
    t_start = notes[0][0] - 0.02
    t_end = notes[-1][0] + notes[-1][1] + 0.25
    n = int((t_end - t_start) * SR)
    t = np.arange(n) / SR
    pitch = np.full(n, float(notes[0][2]))
    depth = np.zeros(n)
    amp = np.zeros(n)
    art = np.ones(n)
    att, rel = (0.028, 0.07) if kind == "whistle" else (0.03, 0.09)
    for j, (on, du, m, *rest) in enumerate(notes):
        v = rest[0] if rest else 1.0
        i0 = int(round((on - t_start) * SR))
        i1 = int(round((on + du - t_start) * SR))
        nxt = int(round((notes[j + 1][0] - t_start) * SR)) if j + 1 < len(notes) else n
        legato = j > 0 and notes[j - 1][0] + notes[j - 1][1] >= on - 1e-6
        pitch[i0:nxt] = m
        tt = (np.arange(i0, n) - i0) / SR
        depth[i0:nxt] = np.clip((tt[: nxt - i0] - 0.13) / 0.22, 0, 1)
        g = np.zeros(n - i0)
        ka = int(att * SR)
        g[: i1 - i0] = 1.0
        if not legato:                                    # fresh attack only after a rest
            g[:ka] = np.minimum(g[:ka], 0.5 - 0.5 * np.cos(np.pi * np.arange(ka) / ka))
        kr = int(rel * SR)
        seg = g[i1 - i0: i1 - i0 + kr]
        seg[:] = 0.5 + 0.5 * np.cos(np.pi * np.arange(len(seg)) / kr)
        amp[i0:] = np.maximum(amp[i0:], g * v)
        if legato:                                        # soft tongue/bellows re-articulation
            kd = min(int(0.045 * SR), n - i0)
            art[i0:i0 + kd] *= 1 - 0.2 * np.sin(np.pi * np.arange(kd) / kd)
    if kind == "whistle":
        a = np.exp(-1.0 / (0.03 * SR))                     # portamento (one-pole in semitones)
        pitch = signal.lfilter([1 - a], [1, -a], pitch, zi=[a * (notes[0][2] - 1.0)])[0]
        pitch = pitch + 0.22 * depth * np.sin(2 * np.pi * 5.0 * t + 0.3)
        f = hz(pitch)
        ph = 2 * np.pi * np.cumsum(f) / SR
        y = np.sin(ph) + 0.045 * np.sin(2 * ph) + 0.012 * np.sin(3 * ph)
        br = signal.sosfilt(sos("bandpass", (1500, 6000)), RNG.standard_normal(n)) * 0.035
        y = (y + br) * amp * art
        return y * vel
    # accordion lead: 3 reeds (0 / +8 / -8 cents) + a soft reed an octave below; bellows tremolo
    f = hz(pitch)
    f = signal.lfilter([1 - np.exp(-1 / (0.003 * SR))], [1, -np.exp(-1 / (0.003 * SR))], f, zi=[np.exp(-1 / (0.003 * SR)) * f[0]])[0]
    r0 = saw_blep(f, phase0=RNG.random())
    r1 = saw_blep(f * 2 ** (8 / 1200), phase0=RNG.random())
    r2 = saw_blep(f * 2 ** (-8 / 1200), phase0=RNG.random())
    lo = saw_blep(f * 0.5, phase0=RNG.random())
    out = np.zeros((n, 2))
    out[:, 0] = 0.45 * r0 + 0.42 * r1 + 0.18 * r2 + 0.22 * lo
    out[:, 1] = 0.45 * r0 + 0.18 * r1 + 0.42 * r2 + 0.22 * lo
    out = signal.sosfilt(sos("lowpass", 3400), out, axis=0)
    # reed "honk" formant
    b, a = signal.iirpeak(1150, 1.2, fs=SR)
    out = out + 0.35 * signal.lfilter(b, a, out, axis=0)
    trem = 1 - 0.1 * (0.5 + 0.5 * np.sin(2 * np.pi * 5.0 * (t + t_start)))
    out *= (amp * art * trem)[:, None]
    return out * vel * 0.55


# ----------------------------------------------------------------------------- arrangement
def fc_pluck(t):
    """Pluck low-pass cutoff (Hz) per note onset: closed intro, opening memory, open riser/drops."""
    def ex(t, t0, t1, f0, f1):
        u = np.clip((t - t0) / (t1 - t0), 0, 1)
        return f0 * (f1 / f0) ** u
    if t < 2.5:
        return 1200.0
    if t < 5.0:
        return ex(t, 2.5, 5.0, 1200, 3000)
    if t < 7.5:
        return ex(t, 5.0, 7.5, 3000, 9000)
    if t < 15.0:
        return 7000.0
    if t < 18.0:
        return 4000.0
    if t < 20.0:
        return 6000.0
    if t < 22.0:
        return 2800.0
    if t < 28.0:
        return 7000.0
    return ex(t, 28.0, 29.9, 3500, 2500)


def seg_of(t):
    if t < STOP1[0] - 1e-9:
        return "A"
    if STOP1[1] - 1e-9 <= t < STOP2[0] - 1e-9:
        return "B"
    if t >= STOP2[1] - 1e-9:
        return "C"
    raise ValueError(f"event at {t:.3f} s falls inside a stop-down")


def build_arrangement():
    A = {k: [] for k in ("pluck", "glock", "mbox", "whistle", "acc", "pad", "stab", "bass", "kick",
                         "sub", "clap", "hat", "shaker", "snare", "crash", "revcym", "sweep")}

    def pl(t, note, vel, dur=1.0, t60=1.35, fc=None):
        A["pluck"].append(dict(t=hum(t, 2.5), m=midi(note), vel=vel * vr(0.06), dur=dur, t60=t60,
                               fc=fc if fc else fc_pluck(t), pan=-0.2 + RNG.uniform(-0.12, 0.12)))

    PAT = [0, 1, 2, 0, 1, 2, 3, 2]                    # R-5-10 | R-5-10 | 8-10 (3+3+2 tresillo)
    ACC = [1.0, 0.7, 0.8, 0.93, 0.7, 0.8, 0.9, 0.68]

    def arp8(t0, t1, gain, skip=()):
        for i in range(int(round(t0 / E8)), int(round(t1 / E8))):
            t = i * E8
            if any(abs(t - s) < 1e-6 for s in skip):
                continue
            slot = i % 8
            pl(t, ARP[chord_at(t)][PAT[slot]], gain * ACC[slot])

    # --- 0.0-2.5 intro: low-passed arp, glock D6 on 0.00, pluck+glock accent on 1.50
    arp8(0.0, 2.5, 0.62)
    pl(1.5, "F#5", 0.75)                              # accent dyad D5+F#5 under the brick snap
    A["glock"] += [(0.0, "D6", 0.5), (1.5, "A5", 0.42), (1.5, "D6", 0.5)]
    # --- 2.5-5.0 memory: arp opens up, accordion pad + whistle motif, soft shaker 8ths
    arp8(2.5, 5.0, 0.55)
    A["pad"] += [dict(t=2.5, dur=1.5, ch="Bm", vel=0.75, fc=1500, att=0.45, rel=0.12),
                 dict(t=4.0, dur=1.0, ch="G", vel=0.72, fc=1650, att=0.1, rel=0.1),
                 dict(t=5.0, dur=1.0, ch="G", vel=0.42, fc=1500, att=0.04, rel=0.1, swell=4.0),
                 dict(t=6.0, dur=1.6, ch="A", vel=0.48, fc=2600, att=0.04, rel=0.1, swell=12.0)]
    for i in range(10, 20):
        t = i * E8
        A["shaker"].append((hum(t, 3), (0.5 if i % 2 else 0.32) * vr(0.1)))
    # whistle hook  A4-D5-F#5-E5 | D5-B4-A4  (8th slots 0,1,3,6 | 8,11,12), sounding 8va
    def hook(t0, notes8, v=1.0):
        return [(t0 + s * E8, d * E8, midi(nm) + 12, v) for s, d, nm in notes8]
    CALL = [(0, 1, "A4"), (1, 2, "D5"), (3, 3, "F#5"), (6, 2, "E5"), (8, 3, "D5"), (11, 1, "B4"), (12, 4, "A4")]
    A["whistle"].append(hook(2.5, CALL[:-1] + [(12, 2, "A4")], 0.78))   # softer first statement, ends as the riser starts
    # --- 5.0-7.5 riser: climbing 16th plucks, noise sweep 900 Hz->8 kHz, snare roll 8->16->32 with
    #     rising pitch, pad swell; no bass (the low end arrives with the drop). Cut dead at 7.50.
    climb = [(5.0, ["G3", "B3", "D4", "G4"]), (5.5, ["B3", "D4", "G4", "B4"]),
             (6.0, ["A3", "C#4", "E4", "A4"]), (6.5, ["C#4", "E4", "A4", "C#5"]),
             (7.0, ["E4", "A4", "C#5", "E5"])]
    k = 0
    for tb, notes in climb:
        for j, nm in enumerate(notes):
            t = tb + j * S16
            pl(t, nm, (0.32 + 0.68 * (k / 19) ** 1.3) * (1.0 if j == 0 else 0.82), dur=0.34, t60=0.55)
            k += 1
    A["sweep"].append((5.0, 7.5, 900.0, 8000.0))
    rolls = [(5.0, 6.0, E8), (6.0, 7.0, S16), (7.0, 7.5, T32)]
    for a0, a1, step in rolls:
        for i in range(int(round((a1 - a0) / step))):
            t = a0 + i * step
            u = (t - 5.0) / 2.5
            A["snare"].append((t, (0.12 + 0.88 * u ** 1.6) * vr(0.05), 185.0 * 2 ** (u * 1.0)))
    # --- 7.5-8.0 STOP-DOWN #1: only a quiet sustained glock A5 + reverse cymbal 7.70-8.00 (-18 dB)
    A["glock"].append((7.5, "A5", 0.24, 2.2, "X"))
    A["revcym"].append((STOP1[1], 0.30, -18.0))
    # --- 8.0-15.0 DROP: crash, sub boom, 4otf kick, claps 2+4 (+ accents 11.5 / 13.0),
    #     octave bass, accordion off-beat stabs, whistle hook + answer, glock sparkles
    A["crash"].append((8.0, 1.0))
    A["sub"].append((8.0, 0.8))
    for i in range(16, 30):
        A["kick"].append((i * BEAT, 1.0))
    for t in (8.5, 9.5, 10.5, 11.5, 12.5, 13.0, 13.5, 14.5):
        acc = t in (11.5, 13.0)
        A["clap"].append((t, 1.0 if acc else 0.8, acc))
    for i in range(32, 60):
        t = i * E8
        root = BASS[chord_at(t)]
        m = root if i % 2 == 0 else root[:-1] + str(int(root[-1]) + 1)
        A["bass"].append((hum(t, 1.0) if i % 2 else t, m, 0.21, 0.95 if i % 2 == 0 else 0.8))
        if i % 2:
            A["stab"].append((hum(t, 1.5), chord_at(t), (0.95 if (i // 2) % 2 else 0.8) * vr(0.05)))
            A["hat"].append((hum(t, 1.5), 0.55 * vr(0.08)))
    for i in range(64, 120):
        t = i * S16
        A["shaker"].append((hum(t, 2.5), [0.42, 0.22, 0.6, 0.28][i % 4] * vr(0.1)))
    arp8(8.0, 15.0, 0.62)
    ANSWER = [(0, 1, "B4"), (1, 2, "D5"), (3, 3, "G5"), (6, 2, "F#5"), (8, 2, "E5"), (10, 1, "C#5"), (11, 1, "A4")]
    A["whistle"].append(hook(8.0, CALL) + hook(12.0, ANSWER))
    A["glock"] += [(11.75, "D6", 0.3, 1.0, None, 0.4), (11.875, "F#6", 0.26, 1.0, None, 0.4),
                   (13.0, "D5", 0.5), (13.125, "F#5", 0.55), (13.25, "A5", 0.6), (13.375, "D6", 0.66)]
    # --- 15.0-18.0 booklet: kick on 1+3 only, claps, sustained pad, pluck, off-beat bass, shaker 8ths
    for t in (15.0, 16.0, 17.0):
        A["kick"].append((t, 0.85))
    for t in (15.5, 16.5, 17.5):
        A["clap"].append((t, 0.7, False))
    A["pad"] += [dict(t=15.0, dur=1.0, ch="A", vel=0.7, fc=1800, att=0.08, rel=0.1),
                 dict(t=16.0, dur=2.0, ch="D", vel=0.7, fc=1800, att=0.05, rel=0.1),
                 dict(t=18.0, dur=2.0, ch="Bm", vel=0.72, fc=1900, att=0.03, rel=0.1),
                 dict(t=20.0, dur=1.6, ch="G", vel=0.75, fc=1700, att=0.03, rel=0.1)]
    for i in range(60, 72):
        t = i * E8
        if i % 2:
            A["bass"].append((hum(t, 1.0), BASS[chord_at(t)], 0.2, 0.78))
        A["shaker"].append((hum(t, 2.5), (0.5 if i % 2 else 0.3) * vr(0.1)))
    arp8(15.0, 18.0, 0.72)
    # --- 18.0-20.0 build montage: 4otf kick back, NO hats/shaker (the SFX brick clicks are the
    #     8th-note hat), bass walk-up D-E-F#-A in octaves, completion chime D6+A6 at 19.50
    for i in range(36, 40):
        A["kick"].append((i * BEAT, 1.0))
    for t in (18.5, 19.5):
        A["clap"].append((t, 0.8, False))
    for j, nm in enumerate(["D2", "D3", "E2", "E3", "F#2", "F#3", "A2", "A3"]):
        A["bass"].append((18.0 + j * E8, nm, 0.21, 0.95 if j % 2 == 0 else 0.8))
    arp8(18.0, 20.0, 0.5)
    A["glock"] += [(19.5, "D6", 0.75, 1.5), (19.5, "A6", 0.6, 1.5)]
    # --- 20.0-21.5 red one: kick out; pad + pluck + music-box statement of the motif; soft bass
    arp8(20.0, 21.5, 0.62)
    A["bass"].append((20.0, "G2", 1.45, 0.3, 0.8))              # just a soft warm G under the music box
    for t, nm in [(20.0, "A5"), (20.125, "D6"), (20.375, "F#6"), (20.75, "E6"), (21.0, "D6"), (21.25, "B5"), (21.375, "A5")]:
        A["mbox"].append((t, midi(nm), 0.5 * vr(0.04)))
    # --- 21.5-22.0 STOP-DOWN #2: digital silence (reverse cymbal 21.60 comes from the SFX track)
    # --- 22.0-28.0 final chorus: crash + full D chord, accordion takes the hook, full groove
    A["crash"].append((22.0, 1.0))
    A["sub"].append((22.0, 0.72))
    A["pad"].append(dict(t=22.0, dur=1.9, ch="D", vel=1.15, fc=2600, att=0.004, rel=0.1, hit=(0.6, 0.25)))
    for j, nm in enumerate(["D3", "A3", "D4", "F#4", "A4", "D5"]):
        pl(22.0 + j * 0.011, nm, 0.75, dur=1.2, t60=1.8)
    A["glock"] += [(22.0, "D6", 0.5), (22.0, "F#6", 0.4)]
    for i in range(44, 56):
        A["kick"].append((i * BEAT, 1.0))
    for t in (22.5, 23.5, 24.5, 25.5, 26.5, 27.5):
        A["clap"].append((t, 0.8, False))
    for i in range(88, 112):
        t = i * E8
        root = BASS[chord_at(t)]
        m = root if i % 2 == 0 else root[:-1] + str(int(root[-1]) + 1)
        A["bass"].append((hum(t, 1.0) if i % 2 else t, m, 0.21, 0.95 if i % 2 == 0 else 0.8))
        if i % 2:
            A["stab"].append((hum(t, 1.5), chord_at(t), (0.8 if (i // 2) % 2 else 0.68) * vr(0.05)))
            A["hat"].append((hum(t, 1.5), 0.55 * vr(0.08)))
    for i in range(176, 224):
        t = i * S16
        A["shaker"].append((hum(t, 2.5), [0.42, 0.22, 0.6, 0.28][i % 4] * vr(0.1)))
    arp8(22.0, 28.0, 0.55, skip=(22.0,))
    ACC_ANSWER = [(26.0, 0.25, "B4"), (26.25, 0.25, "D5"), (26.5, 0.5, "G5"), (27.0, 0.25, "F#5"),
                  (27.25, 0.25, "E5"), (27.5, 0.25, "C#5"), (27.75, 0.25, "E5"), (28.0, 1.3, "D5")]
    acc_call = [(t, d, m - 12) for t, d, m, _ in hook(22.0, CALL)]       # accordion plays at written pitch
    A["acc"].append(acc_call + [(t, d, midi(nm)) for t, d, nm in ACC_ANSWER])
    A["glock"] += [(23.75, "A5", 0.28, 1.0, None, -0.4), (23.875, "D6", 0.3, 1.0, None, -0.4),
                   (25.75, "D6", 0.28, 1.0, None, 0.4), (25.875, "F#6", 0.3, 1.0, None, 0.4)]
    # --- 28.0-29.5 outro: final D chord rings (strum + thin pad + bass + glock + accordion D5)
    for j, nm in enumerate(["D3", "A3", "D4", "F#4", "A4", "D5", "F#5"]):
        pl(28.0 + j * 0.014, nm, 0.72 - 0.02 * j, dur=1.6, t60=2.4)
    A["pad"].append(dict(t=28.0, dur=1.3, ch=["D4", "F#4", "A4", "D5"], vel=0.72, fc=2000, att=0.01, rel=0.45))
    A["bass"].append((28.0, "D2", 1.4, 0.62, 0.55))
    A["glock"] += [(28.0, "D6", 0.45, 1.6), (28.0, "A6", 0.35, 1.6)]
    pl(28.75, "A4", 0.4, dur=0.9)
    pl(29.25, "F#4", 0.36, dur=0.4)
    # --- 29.5-30.0 loop bridge: A (V) pickup, damped so it resolves into bar-1's D4 on replay;
    #     the whole bus low-pass closes back to ~1.2 kHz (see master)
    pl(29.5, "A3", 0.55, dur=0.55, t60=0.9, fc=2500)
    pl(29.75, "C#4", 0.62, dur=0.3, t60=0.9, fc=2500)
    pl(29.875, "E4", 0.62, dur=0.18, t60=0.9, fc=2500)
    return A


# ----------------------------------------------------------------------------- rendering
STEMS = ("kick", "sub", "bass", "pad", "acc", "whistle", "pluck", "glock", "drums", "fx")
GAIN = dict(kick=0.85, sub=0.5, bass=0.44, pad=0.68, acc=0.62, whistle=0.135, pluck=0.72, glock=0.3,
            drums=1.0, fx=1.0)
SEND = dict(pad=0.2, acc=0.18, whistle=0.3, pluck=0.24, glock=0.4, drums=0.08, fx=0.08)
REV_RETURN = 0.55


def render_segment(A, seg):
    """Render every event of one segment ("A" 0-7.5, "B" 8-21.5, "C" 22-30+, "X" = the
    stop-down #1 exceptions) into dry stereo stems. Returns (stems, kick times)."""
    st = {k: np.zeros((NT, 2)) for k in STEMS}
    kicks = []

    def sel(t):
        return seg != "X" and seg_of(t) == seg

    for p in A["pluck"]:
        if sel(p["t"]):
            add(st["pluck"], p["t"], ks_pluck(p["m"], p["vel"], p["dur"], p["t60"], p["fc"]), p["pan"])
    for g in A["glock"]:
        t, nm, v = g[0], g[1], g[2]
        ln = g[3] if len(g) > 3 else 1.8
        tag = g[4] if len(g) > 4 else None
        pan = g[5] if len(g) > 5 else 0.3
        if (seg == "X" and tag == "X") or (tag != "X" and sel(t)):
            add(st["glock"], t, bell(midi(nm), v, ln + 0.5, GLOCK_PARTIALS, dscale=ln / 1.8), pan)
    if seg == "X":                                   # (the reverse cymbal is added post-master)
        return st, kicks
    for t, m, v in A["mbox"]:
        if sel(t):
            add(st["glock"], t, music_box(m, v), -0.15)
    for ph in A["whistle"]:
        if sel(ph[0][0]):
            add(st["whistle"], ph[0][0] - 0.02, line_synth(ph, "whistle"), 0.05)
    for ph in A["acc"]:
        if sel(ph[0][0]):
            add(st["acc"], ph[0][0] - 0.02, line_synth(ph, "acc"))
    for p in A["pad"]:
        if sel(p["t"]):
            notes = PADV[p["ch"]] if isinstance(p["ch"], str) else p["ch"]
            add(st["pad"], p["t"], chord_pad(notes, p["dur"], p["vel"], p["fc"], p["att"], p["rel"],
                                           p.get("swell", 0.0), p.get("hit")))
    for t, ch, v in A["stab"]:
        if sel(t):
            add(st["pad"], t, chord_pad(PADV[ch], 0.11, v * 1.25, 3200, 0.004, 0.07))
    for t, nm, du, v, *dec in A["bass"]:
        if sel(t):
            add(st["bass"], t, bass_note(midi(nm), du, v, dec[0] if dec else None))
    for t, v in A["kick"]:
        if sel(t):
            add(st["kick"], t, kick(v))
            kicks.append(t)
    for t, v in A["sub"]:
        if sel(t):
            add(st["sub"], t, sub_boom(v))
    for t, v, acc in A["clap"]:
        if sel(t):
            add(st["drums"], t, clap(0.75 * v * (1.25 if acc else 1.0), acc))
    for t, v in A["hat"]:
        if sel(t):
            add(st["drums"], t, open_hat(0.19 * v), -0.3)
    for t, v in A["shaker"]:
        if sel(t):
            add(st["drums"], t, shaker(0.21 * v), 0.35)
    for t, v, f0 in A["snare"]:
        if sel(t):
            add(st["drums"], t, snare(0.62 * v, f0), 0.1)
    for t, v in A["crash"]:
        if sel(t):
            add(st["drums"], t, crash(0.3 * v))
    for t0, t1, f0, f1 in A["sweep"]:
        if sel(t0):
            n = int((t1 - t0) * SR)
            u = np.arange(n) / n
            w = RNG.standard_normal((n, 2))
            y = filt(tv_lowpass(w, f0 * (f1 / f0) ** (u ** 1.15), q=1.3), "highpass", 300)
            y *= (0.04 + 0.96 * u ** 2.4)[:, None] * 0.15
            add(st["fx"], t0, ramp_in(y, 0.05))
    return st, kicks


def pump(kicks, depth, release=0.2, attack=0.003):
    g = np.ones(NT)
    L = int(release * SR)
    x = np.arange(L) / L
    shape = depth * (1 - (3 * x ** 2 - 2 * x ** 3)) * np.minimum(np.arange(L) / (attack * SR), 1.0)
    for tk in kicks:
        i0 = int(round(tk * SR))
        n = min(L, NT - i0)
        g[i0:i0 + n] = np.minimum(g[i0:i0 + n], 1 - shape[:n])
    return g[:, None]


def make_ir(rt60=1.7, length=2.4, pre=0.018):
    n = int(length * SR)
    t = np.arange(n) / SR
    ir = np.zeros((n, 2))
    k0 = int(pre * SR)
    for ch in range(2):
        w = RNG.standard_normal(n)
        env = lambda rt: 10 ** (-3 * t / rt)      # noqa: E731
        x = (signal.sosfilt(sos("lowpass", 800), w) * env(rt60 * 1.15)
             + signal.sosfilt(sos("bandpass", (800, 4500)), w) * env(rt60)
             + 0.55 * signal.sosfilt(sos("highpass", 4500), w) * env(rt60 * 0.45))
        x *= 1 - np.exp(-t / 0.012)
        x = np.concatenate([np.zeros(k0), x[:-k0]])
        for d in RNG.uniform(0.004, 0.045, 7):            # a few early reflections
            ir[k0 + int(d * SR), ch] += RNG.uniform(0.3, 0.8) * RNG.choice([-1, 1])
        ir[:, ch] += x
    ir /= np.sqrt(np.sum(ir ** 2) / 2)
    return ir


IR = None


def reverb(send):
    xl = 0.75 * send[:, 0] + 0.25 * send[:, 1]
    xr = 0.25 * send[:, 0] + 0.75 * send[:, 1]
    wet = np.stack([signal.fftconvolve(xl, IR[:, 0])[:NT], signal.fftconvolve(xr, IR[:, 1])[:NT]], axis=1)
    wet = filt(wet, "highpass", 220)
    return filt(wet, "lowpass", 9000)


def pingpong(x, delay, fb, wet, reps=5, lp=4200):
    mono = filt(x.mean(axis=1), "highpass", 350)
    out = np.zeros_like(x)
    d = int(round(delay * SR))
    y = mono
    for k in range(1, reps + 1):
        y = signal.sosfilt(sos("lowpass", lp, 1), y)
        ch = (k + 1) % 2
        if k * d < NT:
            out[k * d:, ch] += wet * fb ** (k - 1) * y[: NT - k * d]
    return out


def process_segment(st, kicks):
    t = T_ABS[:, None]
    st["pad"] *= 1 - 0.14 * (0.5 + 0.5 * np.sin(2 * np.pi * 5.0 * t))           # 5 Hz tremolo
    if kicks:
        st["bass"] *= pump(kicks, 0.6)
        st["pad"] *= pump(kicks, 0.5)
        st["pluck"] *= pump(kicks, 0.22)
        st["acc"] *= pump(kicks, 0.18)
    st["pad"] = filt(st["pad"], "highpass", 170)
    st["pluck"] = filt(st["pluck"], "highpass", 140)
    st["bass"] = filt(filt(st["bass"], "lowpass", 1600), "highpass", 38)
    st["kick"] = filt(st["kick"], "highpass", 32)
    st["sub"] = filt(st["sub"], "highpass", 30)
    st["whistle"] = filt(st["whistle"], "highpass", 300)
    dry = sum(st[k] * GAIN[k] for k in STEMS)
    send = sum(st[k] * GAIN[k] * SEND[k] for k in SEND)
    wet = reverb(send) * REV_RETURN
    if kicks:
        wet *= pump(kicks, 0.3)
    dly = (pingpong(st["whistle"] * GAIN["whistle"], E8, 0.34, 0.32)
           + pingpong(st["acc"] * GAIN["acc"], E8 * 1.5, 0.25, 0.14))
    out = dry + wet + dly
    return filt(out, "highpass", 24)


def cut_after(x, t_cut, fade=0.003):
    i1 = int(round(t_cut * SR))
    k = int(fade * SR)
    x[i1 - k:i1] *= (0.5 + 0.5 * np.cos(np.pi * (np.arange(k) + 1) / k))[:, None]
    x[i1:] = 0.0
    return x


# ----------------------------------------------------------------------------- master
KW = np.array([[1.53512485958697, -2.69169618940638, 1.19839281085285, 1.0, -1.69065929318241, 0.73248077421585],
               [1.0, -2.0, 1.0, 1.0, -1.99004745483398, 0.99007225036621]])


def lufs(x):
    y = signal.sosfilt(KW, x, axis=0)
    blk, hop = int(0.4 * SR), int(0.1 * SR)
    ms = np.array([np.sum(np.mean(y[i:i + blk] ** 2, axis=0)) for i in range(0, len(y) - blk + 1, hop)])
    lk = -0.691 + 10 * np.log10(ms + 1e-20)
    g = ms[lk > -70]
    rel = -0.691 + 10 * np.log10(np.mean(g)) - 10
    return -0.691 + 10 * np.log10(np.mean(ms[(lk > -70) & (lk > rel)]))


def glue_comp(x, thr_db=-15.0, ratio=2.0, knee=6.0, att=0.012, rel=0.18):
    blk = 48
    nb = len(x) // blk
    lvl = 10 * np.log10(np.mean((x[: nb * blk] ** 2).reshape(nb, blk, 2).mean(axis=2), axis=1) + 1e-12) + 3.0
    over = lvl - thr_db
    gr = np.where(over <= -knee / 2, 0.0,
                  np.where(over >= knee / 2, -over * (1 - 1 / ratio),
                           -(1 - 1 / ratio) * (over + knee / 2) ** 2 / (2 * knee)))
    ca, cr = np.exp(-blk / (att * SR)), np.exp(-blk / (rel * SR))
    sm = np.empty(nb)
    s = 0.0
    for i in range(nb):
        c = ca if gr[i] < s else cr
        s = c * s + (1 - c) * gr[i]
        sm[i] = s
    g = np.interp(np.arange(len(x)), np.arange(nb) * blk + blk / 2, 10 ** (sm / 20))
    return x * g[:, None], sm


def soft_clip(x, ceil=CEIL, knee_frac=0.6):
    up = signal.resample_poly(x, 4, 1, axis=0)
    thr = knee_frac * ceil
    a = np.abs(up)
    o = a > thr
    up[o] = np.sign(up[o]) * (thr + (ceil - thr) * np.tanh((a[o] - thr) / (ceil - thr)))
    return signal.resample_poly(up, 1, 4, axis=0)


def true_peak(x):
    return float(np.max(np.abs(signal.resample_poly(x, 4, 1, axis=0))))


def master(loop):
    P = SR                                           # circular priming (1 s) for all stateful stages
    ext = np.concatenate([loop[-P:], loop], axis=0)
    ext = shelf(shelf(ext, 7500, 2.0, "high"), 90, -1.5, "low")        # a little air, a little less mud
    ext = peaking(peaking(ext, 3300, 1.8, 0.8), 1350, -1.2, 1.0)        # presence up, whistle/glock zone down
    ext = ext / (np.max(np.abs(ext)) + 1e-12) * 10 ** (-6 / 20)
    comp, gr = glue_comp(ext)
    g_db = 0.0
    for _ in range(6):                               # makeup gain -> about -14 LUFS after clipping
        y = soft_clip(comp * 10 ** (g_db / 20))[P:P + N]
        step = TARGET_LUFS - lufs(y)
        if abs(step) < 0.05:
            break
        g_db += step
    else:
        g_db -= step                                 # keep g_db consistent with the y we return
    pre = comp[P:P + N] * 10 ** (g_db / 20)
    print(f"  master: makeup {g_db:+.1f} dB, pre-clip peak {20 * np.log10(np.max(np.abs(pre))):+.1f} dBFS, "
          f"{100 * np.mean(np.abs(pre) > 0.6 * CEIL):.2f}% of samples in the clipper knee")
    tp = true_peak(np.concatenate([y[-2000:], y, y[:2000]]))
    if tp > TP_MAX:
        y *= TP_MAX / tp
    return y, float(np.min(gr[P // 48:])), g_db


# ----------------------------------------------------------------------------- main
def main():
    global IR
    t0 = time.time()
    IR = make_ir()
    A = build_arrangement()
    bus = np.zeros((NT, 2))
    for seg, cut in (("A", STOP1[0]), ("B", STOP2[0]), ("C", None)):
        st, kicks = render_segment(A, seg)
        y = process_segment(st, kicks)
        if cut is not None:
            y = cut_after(y, cut)
        bus += y
        print(f"  segment {seg}: rendered ({time.time() - t0:.1f} s)")
    # loop bridge: the bus low-pass closes back to ~1.2 kHz over 29.25-29.95 and stays closed
    # for the tail rendered past 30.0 s (which is wrapped onto the low-passed intro below)
    i_a = int(28.8 * SR)
    tt = T_ABS[i_a:]
    fc = 18000.0 * (1200.0 / 18000.0) ** np.clip((tt - 29.25) / 0.7, 0, 1)
    xf = np.clip((tt - 28.8) / 0.1, 0, 1)[:, None]
    bus[i_a:] = bus[i_a:] * (1 - xf) + tv_lowpass(bus[i_a:].copy(), fc, q=0.8) * xf
    # stop-down #1 exception (not cut): the quiet sustained glock A5 at 7.50 (+ its reverb)
    pre_peak = float(np.max(np.abs(bus)))
    st, _ = render_segment(A, "X")
    bus += process_segment(st, [])
    # loop: wrap everything rendered past 30.0 s onto the start
    loop = bus[:N].copy()
    loop[: NT - N] += bus[N:]
    wrapped_db = 20 * np.log10(np.sqrt(np.mean(bus[N:N + SR // 2] ** 2)) / (pre_peak + 1e-12) + 1e-12)
    y, gr_min, g_db = master(loop)
    # reverse-cymbal suck-in 7.70-8.00 at exactly -18 dBFS peak, added after the master chain
    # (it plays alone in stop-down #1, so it needs no bus processing and stays calibrated)
    for t_end, dur, db in A["revcym"]:
        add(y, t_end - dur, reverse_cymbal(dur) * 10 ** (db / 20))
    # stop-down #2 must be digital silence (clears oversampling/HPF residue)
    i0, i1 = int(round(STOP2[0] * SR)), int(round(STOP2[1] * SR))
    y[i0:i1] = 0.0
    y = y.astype(np.float32)
    assert y.shape == (N, 2)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    sf.write(OUT, y, SR, subtype="FLOAT")
    pk = 20 * np.log10(np.max(np.abs(y)))
    print(f"wrote {OUT}: {len(y)} samples ({len(y) / SR:.3f} s), peak {pk:.2f} dBFS, "
          f"true peak {20 * np.log10(true_peak(y)):.2f} dBTP, {lufs(y):.2f} LUFS, "
          f"glue GR max {gr_min:.1f} dB, wrapped loop tail (0-0.5 s) RMS {wrapped_db:.1f} dB re bed peak, "
          f"render {time.time() - t0:.1f} s")
    for s in SB["music"]["sections"]:
        a, b = int(s["start"] * SR), int(s["end"] * SR)
        r = np.sqrt(np.mean(y[a:b].astype(np.float64) ** 2))
        print(f"  {s['start']:5.2f}-{s['end']:5.2f}  {s['energy']:4s}  RMS {20 * np.log10(r + 1e-12):7.1f} dBFS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
