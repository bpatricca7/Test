#!/usr/bin/env python3
"""ECHO: the alien line "We heard you.", synthesized from scratch.

No TTS engine, no voice API, no samples, no models. This is a source-filter
(Klatt-style) formant synthesizer written with numpy/scipy only:

  glottal source   Liljencrants-Fant (LF) flow-derivative pulses, one per glottal
                   cycle, shaped by Fant's Rd voice-quality parameter, with a pitch
                   contour, jitter, shimmer, a slow "inhuman" wobble and
                   pitch-synchronous aspiration noise (breathiness).
  vocal tract      five time-varying second-order resonators in cascade (F1..F5),
                   coefficients recomputed every sample from smoothly
                   interpolated formant/bandwidth tracks.
  phonetics        [w iː] [h ɝː d] [j uː]: phone targets joined by coarticulated
                   transitions; /h/ = aspiration through the next vowel's tract;
                   /d/ = voice-bar closure, release burst, F2 locus transition.
  character        vocal tract ~10 % longer than an adult male, a coherent
                   sub-octave "second throat", a faint whispered shadow and a
                   slow chorus.
  transmission     radio band-limit, mild saturation, ionospheric fading and
                   multipath, static + a faint 1420 Hz carrier that ride with the
                   voice, a distant echo and a long dark cavern reverb.

Run from the repo root:   python3 movie/audio/voice.py

Writes (48 kHz, mono, 16-bit PCM):
  movie/build/voice.wav              finished line (0.05 s pre-roll, 4.0 s long)
  movie/build/voice_dry.wav          the voice before radio/space processing
  movie/build/voice_spectrogram.png  analysis image (dry, dry + targets, final)

Deterministic: every random source is seeded.
"""

import os
import struct
import wave
import zlib

import numpy as np
from scipy import signal
from scipy.interpolate import CubicSpline, PchipInterpolator
from scipy.optimize import brentq

FS = 48000
SEED = 1974
PRE_ROLL = 0.05          # s of silence before the first sound
TOTAL_LEN = 4.0          # s, length of voice.wav
PEAK_DBFS = -3.0

FORMANT_SCALE = 0.91     # < 1: a vocal tract ~10 % longer than an adult male's
SUB_FORMANT_SCALE = 0.78  # the sub-octave layer's even larger "second throat"

HERE = os.path.dirname(os.path.abspath(__file__))
BUILD = os.path.normpath(os.path.join(HERE, "..", "build"))


# ---------------------------------------------------------------------------
# The phrase: phone targets and timing (seconds from the first sound)
# ---------------------------------------------------------------------------

PARAMS = ("F1", "F2", "F3", "F4", "F5", "B1", "B2", "B3", "B4", "B5")

# Adult-male reference targets (Hz) before FORMANT_SCALE.
PHONES = {
    #        F1    F2    F3    F4    F5     B1   B2   B3   B4   B5
    "w":   (300,  610, 2150, 3300, 3850,   65,  70, 110, 200, 260),
    "i":   (270, 2290, 3010, 3600, 4250,   60,  90, 140, 200, 260),
    # /h/ is the following vowel's tract with an open glottis (wide B1, B2)
    "h":   (490, 1350, 1690, 3250, 3850,  260, 190, 200, 260, 300),
    "er":  (490, 1350, 1690, 3250, 3850,   65,  80,  90, 200, 260),
    # alveolar closure: F1 collapses, F2/F3 head for the /d/ locus
    "dcl": (230, 1720, 2550, 3300, 3850,   90, 110, 150, 220, 280),
    "j":   (260, 2070, 3020, 3550, 4200,   60,  90, 140, 200, 260),
    "u":   (300,  870, 2240, 3300, 3850,   62,  70, 110, 200, 260),
}

# (time, phone, overrides). Pairs of the same phone are steady states; the
# spans between them are the coarticulated transitions (slow for the glides
# /w/ and /j/, fast for the stop /d/).
FORMANT_KEYS = [
    (0.000, "w", {}), (0.060, "w", {}),
    (0.250, "i", {}), (0.600, "i", {}),
    (0.640, "h", {"F3": 1800}), (0.740, "h", {"F3": 1760}),
    (0.830, "er", {}), (1.160, "er", {"F3": 1700}),
    (1.240, "dcl", {}), (1.330, "dcl", {}),
    (1.400, "j", {}), (1.440, "j", {}),
    (1.640, "u", {}), (2.260, "u", {"F2": 810, "F1": 290}),
]

# Voicing amplitude (linear, 1 = vowel nucleus)
AV_KEYS = [
    (0.000, 0.0), (0.035, 0.45), (0.090, 0.85), (0.200, 1.45), (0.300, 1.58),
    (0.450, 1.45), (0.530, 0.65), (0.590, 0.0),
    (0.740, 0.0), (0.795, 0.60), (0.865, 1.0), (1.100, 0.95), (1.195, 0.70),
    (1.240, 0.0),
    (1.345, 0.0), (1.362, 0.65), (1.420, 0.95), (1.600, 1.22), (1.850, 1.08),
    (2.050, 0.42), (2.180, 0.0), (2.300, 0.0),
]

# Unmodulated aspiration (/h/, breathy offsets, release aspiration of /d/)
AH_KEYS = [
    (0.000, 0.0), (0.460, 0.0), (0.545, 0.05), (0.600, 0.0),
    (0.640, 0.0), (0.690, 0.30), (0.765, 0.24), (0.835, 0.0),
    (1.336, 0.0), (1.345, 0.16), (1.372, 0.0),
    (1.950, 0.0), (2.110, 0.06), (2.230, 0.0), (2.300, 0.0),
]

# Voice bar during the /d/ closure (radiated through the throat walls)
AVB_KEYS = [(0.0, 0.0), (1.215, 0.0), (1.245, 1.0), (1.320, 0.75), (1.340, 0.0), (2.3, 0.0)]
D_RELEASE = 1.336

# Pitch (Hz): calm and low, slight lift on "we", accent on "heard", final fall
F0_KEYS = [
    (0.00, 84), (0.22, 90), (0.55, 82), (0.74, 84), (0.96, 97), (1.22, 86),
    (1.38, 88), (1.65, 83), (2.25, 72),
]

# Fant's Rd: ~1 modal, >1.5 breathy/lax, <0.9 pressed
RD_KEYS = [
    (0.00, 1.60), (0.12, 0.90), (0.45, 0.92), (0.58, 1.70), (0.74, 1.60),
    (0.87, 0.80), (1.15, 0.85), (1.24, 1.20), (1.36, 1.05), (1.60, 0.90),
    (1.95, 1.20), (2.20, 2.20),
]

PHRASE_END = 2.30                      # s; all sources are silent after this
SEGMENTS = [("W", 0.00, 0.12), ("I", 0.12, 0.59), ("H", 0.64, 0.79),
            ("ER", 0.79, 1.24), ("D", 1.24, 1.37), ("J", 1.37, 1.52),
            ("U", 1.52, 2.20)]

# Level calibration (tuned by measuring renders: formant levels, /h/ and burst re vowel)
ASP_GAIN = 0.45          # unmodulated aspiration (/h/, offsets)
BREATH = 0.035           # pitch-synchronous breath noise mixed into voicing
VBAR_GAIN = 0.10
BURST_GAIN = 0.22
SUB_DB = -13.0           # sub-octave layer re main layer (RMS)
WHISPER_DB = -21.0
CHORUS_DB = -12.0
SOURCE_SHELF_DB = 8.0
OPEN_PHASE_B1 = 45.0     # Hz added to B1 during the glottal open phase

# Radio / space
RADIO_DRIVE = 2.0        # tanh overdrive of the transmitter
COMP_RATIO = 3.0         # transmitter AGC
STATIC_DB = -30.0        # static re voice RMS
CARRIER_DB = -37.0
THROW_FROM = 1.38        # s (phrase time): "you" is thrown into the echo
ECHO_TAPS = ((0.56, -8.0, 2000.0), (1.12, -15.0, 1400.0))   # (delay s, dB, lowpass Hz)
REVERB_DB = -12.0


# ---------------------------------------------------------------------------
# Parameter tracks
# ---------------------------------------------------------------------------

def track(keys, t, smooth_ms=0.0):
    """Shape-preserving (PCHIP) interpolation through (time, value) keys,
    held constant outside them, then optionally Gaussian-smoothed."""
    kt = np.array([k[0] for k in keys], float)
    kv = np.array([k[1] for k in keys], float)
    v = PchipInterpolator(kt, kv, extrapolate=False)(np.clip(t, kt[0], kt[-1]))
    if smooth_ms > 0:
        v = gsmooth(v, smooth_ms * 1e-3 * FS)
    return v


def gsmooth(x, sigma):
    """Gaussian smoothing (sigma in samples), edges held, via FFT convolution."""
    half = int(4 * sigma) + 1
    k = np.exp(-0.5 * (np.arange(-half, half + 1) / sigma) ** 2)
    xp = np.concatenate([np.full(half, x[0]), x, np.full(half, x[-1])])
    return signal.fftconvolve(xp, k / k.sum(), mode="same")[half:half + len(x)]


def formant_tracks(t, scale):
    """Per-sample F1..F5 and B1..B5 from FORMANT_KEYS (coarticulated)."""
    out = {}
    for i, p in enumerate(PARAMS):
        keys = []
        for time, ph, over in FORMANT_KEYS:
            keys.append((time, over.get(p, PHONES[ph][i])))
        v = track(keys, t, smooth_ms=9.0)
        out[p] = v * scale if p.startswith("F") else v
    return out


def smooth_noise(n, rate_hz, rng):
    """Band-limited random wander, unit-ish amplitude, ~rate_hz changes/s."""
    step = FS / rate_hz
    pts = rng.standard_normal(int(n / step) + 4)
    return CubicSpline(np.arange(len(pts)), pts)(np.arange(n) / step) * 0.8


# ---------------------------------------------------------------------------
# Glottal source: Liljencrants-Fant model
# ---------------------------------------------------------------------------

RA_SCALE = 0.35   # shorter return phase than Rd predicts at this very low F0


def lf_params(rd):
    """Normalized (T0 = 1) LF timing from Rd (Fant 1995) and the solved
    growth (alpha) and return-phase (eps) constants for zero net flow."""
    ra = (-1.0 + 4.8 * rd) / 100.0
    rk = (22.4 + 11.8 * rd) / 100.0
    rg = rk / (4.0 * (0.11 * rd / (0.5 + 1.2 * rk) - ra))
    tp = 1.0 / (2.0 * rg)
    te = tp * (1.0 + rk)
    ta = ra * RA_SCALE
    tr = 1.0 - te                                     # time to closure
    eps = 1.0 / ta
    for _ in range(60):                               # eps*ta = 1 - exp(-eps*tr)
        f = eps * ta - 1.0 + np.exp(-eps * tr)
        fp = ta - tr * np.exp(-eps * tr)
        eps -= f / fp
    wg = np.pi / tp

    def area(alpha):
        ex = np.exp(alpha * te)
        a_open = (ex * (alpha * np.sin(wg * te) - wg * np.cos(wg * te)) + wg) / (alpha ** 2 + wg ** 2)
        ee = -ex * np.sin(wg * te)
        a_ret = -(ee / (eps * ta)) * ((1.0 - np.exp(-eps * tr)) / eps - tr * np.exp(-eps * tr))
        return a_open + a_ret

    alpha = brentq(area, -20.0, 60.0)
    return tp, te, ta, alpha, eps


_RD_GRID = np.round(np.arange(0.5, 2.71, 0.01), 2)
_LF_TABLE = np.array([lf_params(r) for r in _RD_GRID])


def lf_pulse(tau, rd):
    """One flow-derivative cycle on normalized time tau in [0, 1).
    Scaled so the main excitation (negative peak at te) equals -1.
    Also returns the open-phase flow shape used to gate breath noise."""
    i = int(np.clip(np.round((rd - _RD_GRID[0]) / 0.01), 0, len(_RD_GRID) - 1))
    tp, te, ta, alpha, eps = _LF_TABLE[i]
    wg = np.pi / tp
    ee = -np.exp(alpha * te) * np.sin(wg * te)
    open_ = tau <= te
    e = np.where(open_,
                 np.exp(alpha * tau) * np.sin(wg * tau) / ee,
                 -(np.exp(-eps * (tau - te)) - np.exp(-eps * (1.0 - te))) / (eps * ta))
    flow = np.where(open_, np.sin(np.pi * np.clip(tau / te, 0, 1)), 0.0)
    return e, flow


def glottal_epochs(f0, rng, jitter=0.005):
    """Glottal cycle start times and periods following the f0 track."""
    n = len(f0)
    epochs = []
    t = 0.0
    while True:
        i = int(t * FS)
        if i >= n:
            break
        period = (1.0 / f0[i]) * (1.0 + jitter * rng.standard_normal())
        epochs.append((t, period))
        t += period
    return epochs


def render_glottal(epochs, rd, n, rng, shimmer=0.05, rd_offset=0.0):
    """Sum of LF pulses (evaluated at exact sub-sample epoch times)."""
    src = np.zeros(n)
    flow = np.zeros(n)
    for t0, period in epochs:
        n0 = int(np.ceil(t0 * FS))
        n1 = min(n, int(np.ceil((t0 + period) * FS)))
        if n1 <= n0:
            continue
        idx = np.arange(n0, n1)
        tau = (idx / FS - t0) / period
        amp = 1.0 + shimmer * rng.standard_normal()
        e, fl = lf_pulse(tau, rd[n0] + rd_offset)
        src[n0:n1] += amp * e
        flow[n0:n1] = fl
    return src, flow


# ---------------------------------------------------------------------------
# Vocal tract: time-varying second-order resonators
# ---------------------------------------------------------------------------

def resonate(x, freq, bw):
    """Klatt resonator y[n] = A x[n] + B y[n-1] + C y[n-2] with per-sample
    coefficients (unity gain at DC)."""
    r = np.exp(-np.pi * bw / FS)
    c = -r * r
    b = 2.0 * r * np.cos(2.0 * np.pi * freq / FS)
    a = 1.0 - b - c
    out = []
    push = out.append
    y1 = y2 = 0.0
    for an, bn, cn, xn in zip(a.tolist(), b.tolist(), c.tolist(), x.tolist()):
        y = an * xn + bn * y1 + cn * y2
        y2 = y1
        y1 = y
        push(y)
    return np.asarray(out)


# Fixed poles above F5: the "higher-pole correction" that restores the
# high-frequency level a 5-formant cascade loses (Klatt got it for free at 10 kHz).
HIGH_POLES = ((4950.0, 450.0), (5900.0, 650.0))


def cascade(x, ft, bw_scale=1.0, scale=FORMANT_SCALE, b1_add=0.0):
    """F1..F5 (time-varying) then the fixed high poles. `b1_add` widens B1
    sample by sample (open-glottis damping)."""
    for k in range(1, 6):
        bw = ft["B%d" % k] * bw_scale + (b1_add if k == 1 else 0.0)
        x = resonate(x, ft["F%d" % k], bw)
    for f, b in HIGH_POLES:
        x = resonate(x, np.full(len(x), f * scale), np.full(len(x), b))
    return x


def rms(x):
    return float(np.sqrt(np.mean(np.square(x)) + 1e-20))


def shelf(x, f_zero, gain_db):
    """First-order high shelf: flat below f_zero, +gain_db well above it."""
    wz = 2 * np.pi * f_zero
    wp = wz * 10 ** (gain_db / 20)
    b, a = signal.bilinear([1 / wz, 1], [1 / wp, 1], FS)
    return signal.lfilter(b, a, x)


def one_pole_lp(x, fc):
    a = np.exp(-2.0 * np.pi * fc / FS)
    return signal.lfilter([1.0 - a], [1.0, -a], x)


def fractional_delay(x, delay_samples):
    """Read x at n - delay[n] with linear interpolation (delay may vary)."""
    n = np.arange(len(x), dtype=float)
    pos = n - delay_samples
    return np.interp(pos, n, x, left=0.0, right=0.0)


# ---------------------------------------------------------------------------
# Voice
# ---------------------------------------------------------------------------

def synthesize_voice():
    """Returns (dry voice at 48 kHz starting at the phrase onset, info dict)."""
    rng = np.random.default_rng(SEED)
    n = int((PHRASE_END + 0.35) * FS)
    t = np.arange(n) / FS

    # --- control tracks
    f0 = track(F0_KEYS, t, smooth_ms=25.0)
    wobble = (1.0 + 0.012 * np.sin(2 * np.pi * 0.55 * t + 0.7)
              + 0.006 * smooth_noise(n, 2.0, rng))       # slow, not-quite-human
    f0 = f0 * wobble
    rd = np.clip(track(RD_KEYS, t, smooth_ms=15.0), 0.5, 2.7)
    av = np.clip(track(AV_KEYS, t, smooth_ms=4.0), 0.0, None)
    ah = np.clip(track(AH_KEYS, t, smooth_ms=3.0), 0.0, None)
    avb = np.clip(track(AVB_KEYS, t, smooth_ms=3.0), 0.0, None)
    ft = formant_tracks(t, FORMANT_SCALE)

    # --- main voice: LF pulses + breath + aspiration -> cascade formants
    epochs = glottal_epochs(f0, rng)
    src, flow = render_glottal(epochs, rd, n, rng)
    src = shelf(src, 1000.0, SOURCE_SHELF_DB)            # Klatt "TL", used as a lift
    noise = rng.standard_normal(n)
    noise = signal.lfilter(*signal.butter(2, 150.0, "highpass", fs=FS), noise)
    gate = 0.25 + 0.75 * flow                           # breath rides the open phase
    excitation = (av * src
                  + BREATH * av * gate * noise
                  + ASP_GAIN * ah * noise)
    # while the glottis is open the subglottal airway damps F1 (pitch-synchronous B1)
    main = cascade(excitation, ft, b1_add=OPEN_PHASE_B1 * flow)

    # --- /d/: voice bar through the closed tract, then the release burst
    vbar = resonate(src * avb * VBAR_GAIN, np.full(n, 190.0), np.full(n, 110.0))
    bn = rng.standard_normal(n)
    dt = t - D_RELEASE
    benv = np.where(dt >= 0, (1.0 - np.exp(-np.maximum(dt, 0) / 0.0004))
                    * np.exp(-np.maximum(dt, 0) / 0.0075), 0.0)
    burst_src = bn * benv
    burst = (0.35 * signal.sosfilt(signal.butter(2, [1600, 2500], "bandpass", fs=FS, output="sos"), burst_src)
             + 0.85 * signal.sosfilt(signal.butter(2, [2500, 3500], "bandpass", fs=FS, output="sos"), burst_src)
             + 1.00 * signal.sosfilt(signal.butter(2, [3500, 5500], "bandpass", fs=FS, output="sos"), burst_src))
    burst *= BURST_GAIN

    # --- sub-octave "second throat": every other glottal cycle, bigger tract
    sub_epochs = [(epochs[k][0], epochs[k + 2][0] - epochs[k][0])
                  for k in range(0, len(epochs) - 2, 2)]
    sub_src, _ = render_glottal(sub_epochs, rd, n, rng, shimmer=0.03, rd_offset=0.35)
    sub_src = one_pole_lp(sub_src, 1800.0)
    sub = cascade(av * sub_src, formant_tracks(t, SUB_FORMANT_SCALE), bw_scale=0.8,
                  scale=SUB_FORMANT_SCALE)

    # --- whispered shadow, a hair behind and a hair "smaller"
    wenv = gsmooth(av, 0.02 * FS)
    wdelay = int(0.028 * FS)
    wenv = np.concatenate([np.zeros(wdelay), wenv[:-wdelay]])
    whisper = cascade(rng.standard_normal(n) * wenv, formant_tracks(t - 0.028, FORMANT_SCALE * 1.05),
                      bw_scale=1.4, scale=FORMANT_SCALE * 1.05)

    # --- level the layers against the main voice (RMS over voiced frames)
    voiced = av > 0.5
    ref = rms(main[voiced])
    sub *= ref / rms(sub[voiced]) * 10 ** (SUB_DB / 20)
    whisper *= ref / rms(whisper[voiced]) * 10 ** (WHISPER_DB / 20)

    body = main + vbar + burst
    # slow chorus: the same voice ~12 ms late, drifting, for an unnatural doubling
    cdelay = (0.012 + 0.003 * np.sin(2 * np.pi * 0.31 * t)) * FS
    chorus = fractional_delay(main, cdelay) * 10 ** (CHORUS_DB / 20)
    dry = body + chorus + sub + whisper

    # remove DC / subsonic content (causal, so nothing precedes the onset)
    dry = signal.sosfilt(signal.butter(2, 30.0, "highpass", fs=FS, output="sos"), dry)

    info = {
        "t": t, "av": av, "ah": ah, "avb": avb, "f0": f0, "ft": ft,
        "main": main, "burst": burst, "vbar": vbar,
        "active": (av > 1e-3) | (ah > 1e-3) | (avb > 1e-3) | (benv > 1e-3),
    }
    return dry, info


# ---------------------------------------------------------------------------
# Radio link and space
# ---------------------------------------------------------------------------

def peaking_eq(f0, gain_db, q):
    a = 10 ** (gain_db / 40)
    w = 2 * np.pi * f0 / FS
    alpha = np.sin(w) / (2 * q)
    b = [1 + alpha * a, -2 * np.cos(w), 1 - alpha * a]
    den = [1 + alpha / a, -2 * np.cos(w), 1 - alpha / a]
    return np.array(b) / den[0], np.array(den) / den[0]


def reverb_ir(rng, length=3.2, predelay=0.05):
    """Dark cavern: exponentially decaying noise whose highs die first,
    a slow diffuse build-up and a few sparse early reflections. Normalized
    so its mean power gain over the radio band (250-3500 Hz) is 0 dB."""
    n = int(length * FS)
    t = np.arange(n) / FS
    white = rng.standard_normal(n)
    ir = np.zeros(n)
    bands = [(None, 450, 2.9), (450, 1000, 2.6), (1000, 2000, 1.9),
             (2000, 3500, 1.2), (3500, None, 0.6)]          # (lo, hi, RT60 s)
    for lo, hi, rt in bands:
        if lo is None:
            sos = signal.butter(4, hi, "lowpass", fs=FS, output="sos")
        elif hi is None:
            sos = signal.butter(4, lo, "highpass", fs=FS, output="sos")
        else:
            sos = signal.butter(4, [lo, hi], "bandpass", fs=FS, output="sos")
        ir += signal.sosfiltfilt(sos, white) * 10 ** (-3.0 * t / rt)
    ir = one_pole_lp(ir, 2500.0)                           # a dark room
    ir *= 1.0 - np.exp(-t / 0.07)                          # cavernous swell-in
    for d, g in [(0.011, 0.9), (0.023, -0.7), (0.037, 0.6), (0.058, -0.45), (0.083, 0.35)]:
        k = int(d * FS)
        ir[k:k + 48] += g * np.hanning(48)
    ir = np.concatenate([np.zeros(int(predelay * FS)), ir])
    spec = np.abs(np.fft.rfft(ir)) ** 2
    f = np.fft.rfftfreq(len(ir), 1 / FS)
    band = (f >= 250) & (f <= 3500)
    return ir / np.sqrt(np.mean(spec[band]))


def envelope_follower(gate, attack_s, release_s):
    """One-pole attack/release smoothing of a 0/1 gate."""
    att, rel = np.exp(-1 / (attack_s * FS)), np.exp(-1 / (release_s * FS))
    out = np.empty(len(gate))
    acc = 0.0
    for i, v in enumerate(gate.tolist()):
        acc = (att if v > acc else rel) * (acc - v) + v
        out[i] = acc
    return out


def radio_space(dry, active):
    """Transmit `dry` (already padded to the final length) over a long, noisy
    radio path and play it into a vast dark space."""
    rng = np.random.default_rng(SEED + 1)
    n = len(dry)
    t = np.arange(n) / FS
    sos = lambda order, f, kind: signal.butter(order, f, kind, fs=FS, output="sos")

    # 1. transmitter: narrow channel, slow AGC-style compression, soft overdrive
    x = signal.sosfilt(sos(3, 230.0, "highpass"), dry)
    x = signal.sosfilt(sos(5, 3500.0, "lowpass"), x)
    x = signal.lfilter(*peaking_eq(1400.0, 3.0, 0.8), x)       # small-speaker "honk"
    x = x / np.max(np.abs(x))
    a = np.exp(-1.0 / (0.045 * FS))
    env = np.sqrt(signal.lfilter([1 - a], [1, -a], x * x)) + 1e-9
    thresh = rms(x[active])
    x = x * np.minimum(1.0, (env / thresh) ** (1.0 / COMP_RATIO - 1.0))
    x = x / np.max(np.abs(x))
    x = np.tanh(RADIO_DRIVE * x) / np.tanh(RADIO_DRIVE)
    x = signal.sosfilt(sos(4, 3500.0, "lowpass"), x)           # channel filter

    # 2. path: slow fading and a second, drifting ray (moving multipath notches)
    x = x * (1.0 + 0.08 * smooth_noise(n, 3.0, rng))
    mp_delay = (0.0011 + 0.0005 * np.sin(2 * np.pi * 0.37 * t)) * FS
    x = x + 0.25 * fractional_delay(x, mp_delay)
    x = x / np.max(np.abs(x))
    voice_rms = rms(x[active])

    # 3. receiver: static and a faint 1420 Hz carrier open and close with the voice
    g = envelope_follower(active.astype(float), 0.035, 0.45)
    static = signal.sosfilt(sos(2, [300, 3400], "bandpass"), rng.standard_normal(n))
    static *= 1.0 + 0.5 * smooth_noise(n, 9.0, rng)            # flutter
    static *= voice_rms * 10 ** (STATIC_DB / 20) / rms(static)
    carrier_f = 1420.0 + 2.5 * smooth_noise(n, 0.8, rng)
    carrier = np.sqrt(2) * voice_rms * 10 ** (CARRIER_DB / 20) * np.sin(2 * np.pi * np.cumsum(carrier_f) / FS)
    x = x + g * (static + carrier)
    x = signal.sosfilt(sos(2, [200.0, 3700.0], "bandpass"), x)

    # 4. space: the last word is thrown into two distant, darkening repeats ...
    throw = envelope_follower((t >= PRE_ROLL + THROW_FROM).astype(float), 0.03, 0.03)
    echo = np.zeros(n)
    tone = x * throw
    for delay, gain_db, lp in ECHO_TAPS:
        tone = signal.sosfilt(sos(2, lp, "lowpass"), tone)
        d = int(delay * FS)
        echo[d:] += 10 ** (gain_db / 20) * tone[:n - d]
    echo = signal.sosfilt(sos(2, 400.0, "highpass"), echo)
    # ... and everything rings in a long, dark cavern
    wet = signal.fftconvolve(x + echo, reverb_ir(rng))[:n]
    out = x + echo + 10 ** (REVERB_DB / 20) * wet

    # tail: let the cavern ring, then close the file smoothly at TOTAL_LEN
    fade = int(0.6 * FS)
    out[-fade:] *= 0.5 * (1 + np.cos(np.linspace(0, np.pi, fade)))
    return out


# ---------------------------------------------------------------------------
# Output helpers: WAV, PNG, spectrogram image
# ---------------------------------------------------------------------------

def normalize(x, peak_dbfs=PEAK_DBFS):
    return x * (10 ** (peak_dbfs / 20) / np.max(np.abs(x)))


def write_wav(path, x):
    pcm = np.clip(np.round(x * 32767.0), -32768, 32767).astype("<i2")
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(FS)
        w.writeframes(pcm.tobytes())


def write_png(path, rgb):
    """Minimal PNG writer (8-bit RGB, no filtering) with zlib + struct."""
    h, w, _ = rgb.shape
    raw = b"".join(b"\x00" + rgb[y].astype(np.uint8).tobytes() for y in range(h))

    def chunk(tag, data):
        c = tag + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c) & 0xFFFFFFFF)

    png = (b"\x89PNG\r\n\x1a\n"
           + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
           + chunk(b"IDAT", zlib.compress(raw, 9))
           + chunk(b"IEND", b""))
    with open(path, "wb") as f:
        f.write(png)


_GLYPHS = {
    "0": "111101101101111", "1": "010110010010111", "2": "111001111100111",
    "3": "111001111001111", "4": "101101111001001", "5": "111100111001111",
    "6": "111100111101111", "7": "111001001001001", "8": "111101111101111",
    "9": "111101111001111", "A": "010101111101101", "B": "110101110101110",
    "C": "011100100100011", "D": "110101101101110", "E": "111100110100111",
    "F": "111100110100100", "G": "011100101101011", "H": "101101111101101",
    "I": "111010010010111", "J": "001001001101010", "K": "101101110101101",
    "L": "100100100100111", "M": "101111111101101", "N": "110101101101101",
    "O": "010101101101010", "P": "110101110100100", "R": "110101110101101",
    "S": "011100010001110", "T": "111010010010010", "U": "101101101101111",
    "V": "101101101101010", "W": "101101111111101", "X": "101101010101101",
    "Y": "101101010010010", "Z": "111001010100111", ".": "000000000000010",
    "-": "000000111000000", "/": "001001010100100", ":": "000010000010000",
    "+": "000010111010000", "(": "010100100100010", ")": "010001001001010",
    "=": "000111000111000", "_": "000000000000111", " ": "000000000000000",
}


def draw_text(img, x, y, text, color, scale=2):
    for ch in text.upper():
        g = _GLYPHS.get(ch, _GLYPHS[" "])
        for r in range(5):
            for c in range(3):
                if g[r * 3 + c] == "1":
                    y0, x0 = y + r * scale, x + c * scale
                    img[y0:y0 + scale, x0:x0 + scale] = color
        x += 4 * scale


def colormap(v):
    """v in [0, 1] -> RGB, an inferno-like ramp."""
    anchors = np.array([[0, 0, 4], [40, 11, 84], [101, 21, 110], [159, 42, 99],
                        [212, 72, 66], [245, 125, 21], [250, 193, 39], [252, 255, 164]], float)
    pos = np.clip(v, 0, 1) * (len(anchors) - 1)
    i = np.minimum(pos.astype(int), len(anchors) - 2)
    f = (pos - i)[..., None]
    return anchors[i] * (1 - f) + anchors[i + 1] * f


def spectrogram_panel(x, t_max, width, height, f_max=6000.0, win_s=0.006, floor_db=70.0):
    """Wideband (6 ms) spectrogram image, pre-emphasized so F2..F4 show."""
    x = np.concatenate([x, np.zeros(max(0, int(t_max * FS) - len(x)))])[:int(t_max * FS)]
    x = signal.lfilter([1, -0.94], [1], x)
    win = int(win_s * FS)
    hop = t_max * FS / width
    nfft = 4096
    w = np.hanning(win)
    xp = np.concatenate([np.zeros(win // 2), x, np.zeros(win)])
    starts = (np.arange(width) * hop).astype(int)
    frames = np.stack([xp[s:s + win] * w for s in starts])
    mag = np.abs(np.fft.rfft(frames, nfft))
    db = 20 * np.log10(mag + 1e-9)
    freqs = np.fft.rfftfreq(nfft, 1 / FS)
    rows = np.linspace(f_max, 0, height)
    img_db = np.stack([np.interp(rows, freqs, col) for col in db], axis=1)
    top = np.max(img_db)
    return colormap((img_db - (top - floor_db)) / floor_db)


def render_png(path, dry_full, final, info):
    W = 1200
    L, R, gap = 64, 16, 34
    ph = 280
    wave_h = 110
    Hh = 30 + 3 * (ph + gap) + wave_h + 40
    img = np.full((Hh, L + W + R, 3), 16, np.uint8)
    white, grey, cyan = (230, 230, 230), (120, 120, 120), (80, 230, 255)
    t_dry = 2.5

    def axes(y0, t_max, f_max, label):
        draw_text(img, L, y0 - 16, label, white)
        for k in range(0, int(f_max) + 1, 1000):
            yy = y0 + int(round((1 - k / f_max) * (ph - 1)))
            img[yy, L - 6:L] = white
            draw_text(img, L - 28 if k < 10000 else L - 36, yy - 5, "%dK" % (k // 1000), grey)
        step = 0.1
        for j in range(int(round(t_max / step)) + 1):
            xx = L + min(W - 1, int(round(j * step / t_max * (W - 1))))
            major = j % 5 == 0
            img[y0 + ph:y0 + ph + (7 if major else 3), xx] = white if major else grey
            if major:
                draw_text(img, xx - 8, y0 + ph + 9, "%.1f" % (j * step), grey)

    # panel 1: dry
    y1 = 30
    img[y1:y1 + ph, L:L + W] = spectrogram_panel(dry_full, t_dry, W, ph)
    axes(y1, t_dry, 6000, "DRY VOICE (VOICE_DRY.WAV)  0-6 KHZ  TIME S")
    for name, a, b in SEGMENTS:
        xx = L + int(((a + b) / 2 + PRE_ROLL) / t_dry * (W - 1))
        draw_text(img, xx - 4 * len(name), y1 + 4, name, white)

    # panel 2: dry + synthesis formant targets (F1..F4) where a source is active
    y2 = y1 + ph + gap
    img[y2:y2 + ph, L:L + W] = spectrogram_panel(dry_full, t_dry, W, ph)
    axes(y2, t_dry, 6000, "DRY + FORMANT TRACKS F1-F4 (DOTS)")
    ft, active, tt = info["ft"], info["active"], info["t"]
    for px in range(0, W, 3):
        tm = px / (W - 1) * t_dry - PRE_ROLL
        i = int(tm * FS)
        if i < 0 or i >= len(tt) or not active[i]:
            continue
        for k in range(1, 5):
            f = ft["F%d" % k][i]
            yy = y2 + int(round((1 - f / 6000) * (ph - 1)))
            img[yy:yy + 2, L + px:L + px + 2] = cyan

    # panel 3: final
    y3 = y2 + ph + gap
    img[y3:y3 + ph, L:L + W] = spectrogram_panel(final, TOTAL_LEN, W, ph)
    axes(y3, TOTAL_LEN, 6000, "RADIO + SPACE (VOICE.WAV)")

    # waveform strip of the final
    y4 = y3 + ph + gap
    draw_text(img, L, y4 - 16, "VOICE.WAV WAVEFORM (PEAK %.1F DBFS)" % (20 * np.log10(np.max(np.abs(final)))), white)
    edges = np.linspace(0, len(final), W + 1).astype(int)
    mid = y4 + wave_h // 2
    img[mid, L:L + W] = (60, 60, 60)
    for px in range(W):
        seg = final[edges[px]:edges[px + 1]]
        lo, hi = seg.min(), seg.max()
        a = mid - int(hi * (wave_h // 2 - 2))
        b = mid - int(lo * (wave_h // 2 - 2))
        img[a:b + 1, L + px] = (120, 200, 255)
    write_png(path, img)


# ---------------------------------------------------------------------------

def main():
    os.makedirs(BUILD, exist_ok=True)
    dry, info = synthesize_voice()
    pre = np.zeros(int(PRE_ROLL * FS))

    dry_out = normalize(np.concatenate([pre, dry]))
    n_total = int(TOTAL_LEN * FS)
    padded = np.concatenate([dry_out, np.zeros(n_total - len(dry_out))])[:n_total]
    active = np.concatenate([np.zeros(len(pre), bool), info["active"]])
    active = np.concatenate([active, np.zeros(n_total, bool)])[:n_total]
    final = normalize(radio_space(padded, active))
    final[:len(pre)] = 0.0                       # guarantee the silent pre-roll

    write_wav(os.path.join(BUILD, "voice.wav"), final)
    write_wav(os.path.join(BUILD, "voice_dry.wav"), dry_out)
    render_png(os.path.join(BUILD, "voice_spectrogram.png"), dry_out, final, info)

    off = len(pre)
    act = np.flatnonzero(info["active"])
    voiced = np.flatnonzero(info["av"] > 1e-3)
    audible = np.flatnonzero(np.abs(final) > 10 ** (-60 / 20))
    print("voice.wav      %.3f s, peak %.2f dBFS, first sample above -60 dBFS at %.3f s, tail to %.3f s"
          % (len(final) / FS, 20 * np.log10(np.max(np.abs(final))), audible[0] / FS, audible[-1] / FS))
    print("phrase         sources active %.3f-%.3f s, voicing %.3f-%.3f s (%.2f s)"
          % ((act[0] + off) / FS, (act[-1] + off) / FS, (voiced[0] + off) / FS,
             (voiced[-1] + off) / FS, (voiced[-1] - voiced[0]) / FS))
    print("voice_dry.wav  %.3f s, peak %.2f dBFS" % (len(dry_out) / FS, 20 * np.log10(np.max(np.abs(dry_out)))))
    print("wrote", BUILD)


if __name__ == "__main__":
    main()
