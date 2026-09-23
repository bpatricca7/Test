"""ECHO — shared DSP toolkit for the score and the mix.

Everything here is synthesized from first principles with numpy/scipy:
oscillators, envelopes, filters, a convolution reverb built from a
synthetic impulse response, loudness metering (ITU-R BS.1770 style) and a
look-ahead limiter. No samples, no external audio.
"""

import json
import os

import numpy as np
from scipy import signal as sps

SR = 48000
DURATION = 155.0
N = int(round(DURATION * SR))

HERE = os.path.dirname(os.path.abspath(__file__))
MOVIE = os.path.dirname(HERE)
BUILD = os.path.join(MOVIE, "build")
STEMS = os.path.join(BUILD, "stems")

TAU = 2.0 * np.pi


def load_timeline():
    with open(os.path.join(BUILD, "timeline.json")) as f:
        return json.load(f)


# ---------------------------------------------------------------------------
# Pitch. The whole score is tuned so that B5 is exactly 1000 Hz, the
# signal's "0" tone. The "1" tone (1420 Hz) then sits a (slightly wide)
# tritone above: the alien interval the score keeps circling.
# ---------------------------------------------------------------------------

_NAMES = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}


def midi(name):
    name = name.strip()
    pc = _NAMES[name[0].upper()]
    i = 1
    while i < len(name) and name[i] in "#b":
        pc += 1 if name[i] == "#" else -1
        i += 1
    octave = int(name[i:])
    return 12 * (octave + 1) + pc


def hz(note):
    m = midi(note) if isinstance(note, str) else note
    return 1000.0 * 2.0 ** ((m - 83) / 12.0)


def chord(spec):
    return [hz(n) for n in spec.split()]


def db(x):
    return 10.0 ** (x / 20.0)


def to_db(x, floor=-150.0):
    return 20.0 * np.log10(np.maximum(np.abs(x), 10 ** (floor / 20)))


# ---------------------------------------------------------------------------
# Envelopes / automation
# ---------------------------------------------------------------------------

def tvec(n, t0=0.0):
    return t0 + np.arange(n) / SR


def ramp_db(points, n, t0=0.0):
    """Gain curve from (time, dB) breakpoints, interpolated in dB.

    Values <= -100 are treated as silence.
    """
    pts = sorted(points)
    ts = np.array([p[0] for p in pts])
    vs = np.array([p[1] for p in pts], dtype=float)
    t = tvec(n, t0)
    g = db(np.interp(t, ts, vs))
    g[np.interp(t, ts, vs) <= -100] = 0.0
    return g


def ramp_lin(points, n, t0=0.0):
    pts = sorted(points)
    return np.interp(tvec(n, t0), [p[0] for p in pts], [p[1] for p in pts])


def fade_env(n, att, rel, curve="cos"):
    """Attack/release envelope over n samples (seconds for att/rel)."""
    env = np.ones(n)
    a = min(n, max(1, int(att * SR)))
    r = min(n - 0, max(1, int(rel * SR)))
    if curve == "cos":
        env[:a] = 0.5 - 0.5 * np.cos(np.linspace(0, np.pi, a))
        env[n - r:] *= 0.5 + 0.5 * np.cos(np.linspace(0, np.pi, r))
    else:
        env[:a] = np.linspace(0, 1, a)
        env[n - r:] *= np.linspace(1, 0, r)
    return env


def exp_decay(n, tau, att=0.002):
    t = tvec(n)
    env = np.exp(-t / tau)
    a = max(1, int(att * SR))
    a = min(a, n)
    env[:a] *= 0.5 - 0.5 * np.cos(np.linspace(0, np.pi, a))
    return env


def smooth_noise(n, rate_hz, rng, lo=0.0, hi=1.0):
    """Slowly varying random curve (cubic-ish interpolated random points)."""
    k = max(4, int(n / SR * rate_hz) + 4)
    pts = rng.uniform(lo, hi, k)
    xs = np.linspace(0, n, k)
    cur = np.interp(np.arange(n), xs, pts)
    # soften the corners
    w = max(3, int(SR / max(rate_hz, 0.01) / 2))
    if w < n:
        ker = np.hanning(w)
        ker /= ker.sum()
        cur = sps.fftconvolve(np.pad(cur, (w, w), mode="edge"), ker, mode="same")[w:w + n]
    return cur


# ---------------------------------------------------------------------------
# Oscillators
# ---------------------------------------------------------------------------

def phase_from_freq(freq, n, phase0=0.0):
    """Cumulative phase in cycles for a (possibly time varying) frequency."""
    if np.isscalar(freq):
        return phase0 + freq * np.arange(n) / SR
    return phase0 + np.cumsum(freq) / SR


def saw_blep(phase, dt):
    """Band-limited sawtooth from a cycle phase using polyBLEP."""
    t = np.mod(phase, 1.0)
    y = 2.0 * t - 1.0
    dt = np.broadcast_to(np.asarray(dt, dtype=float), t.shape)
    m = t < dt
    if m.any():
        x = t[m] / dt[m]
        y[m] -= x + x - x * x - 1.0
    m = t > 1.0 - dt
    if m.any():
        x = (t[m] - 1.0) / dt[m]
        y[m] -= x * x + x + x + 1.0
    return y


def sine(freq, n, phase0=0.0):
    return np.sin(TAU * phase_from_freq(freq, n, phase0))


# ---------------------------------------------------------------------------
# Filters
# ---------------------------------------------------------------------------

def _sos(kind, fc, order=2, fs=SR):
    if kind == "bp":
        return sps.butter(order, fc, btype="bandpass", fs=fs, output="sos")
    return sps.butter(order, fc, btype={"lp": "lowpass", "hp": "highpass"}[kind], fs=fs, output="sos")


def lp(x, fc, order=2):
    return sps.sosfilt(_sos("lp", fc, order), x, axis=-1)


def hp(x, fc, order=2):
    return sps.sosfilt(_sos("hp", fc, order), x, axis=-1)


def bp(x, lo, hi, order=2):
    return sps.sosfilt(_sos("bp", (lo, hi), order), x, axis=-1)


def tv_filter(x, fc, q=0.707, kind="lp", block=128):
    """Time-varying RBJ biquad (lp / bp / hp), coefficients updated per block.

    x: (..., n). fc: scalar or array of length n (Hz).
    """
    n = x.shape[-1]
    nb = (n + block - 1) // block
    fc = np.broadcast_to(np.asarray(fc, dtype=float), (n,)) if np.ndim(fc) == 0 else np.asarray(fc, float)
    fcb = np.clip(fc[::block][:nb], 8.0, 0.45 * SR)
    qb = np.broadcast_to(np.asarray(q, dtype=float), (n,))[::block][:nb]
    w0 = TAU * fcb / SR
    cw, sw = np.cos(w0), np.sin(w0)
    alpha = sw / (2.0 * qb)
    a0 = 1.0 + alpha
    a1 = -2.0 * cw / a0
    a2 = (1.0 - alpha) / a0
    if kind == "lp":
        b0 = (1.0 - cw) / 2.0 / a0
        b1 = (1.0 - cw) / a0
        b2 = b0
    elif kind == "hp":
        b0 = (1.0 + cw) / 2.0 / a0
        b1 = -(1.0 + cw) / a0
        b2 = b0
    else:  # constant 0 dB peak band-pass
        b0 = alpha / a0
        b1 = np.zeros_like(alpha)
        b2 = -alpha / a0
    y = np.empty_like(x, dtype=float)
    zi = np.zeros(x.shape[:-1] + (2,))
    for i in range(nb):
        s = slice(i * block, min(n, (i + 1) * block))
        y[..., s], zi = sps.lfilter([b0[i], b1[i], b2[i]], [1.0, a1[i], a2[i]], x[..., s], axis=-1, zi=zi)
    return y


def high_shelf(x, f0, gain_db, fs=SR):
    """RBJ high-shelf biquad (shelf slope S = 1)."""
    A = 10 ** (gain_db / 40.0)
    w0 = TAU * f0 / fs
    cw, sw = np.cos(w0), np.sin(w0)
    alpha = sw / 2.0 * np.sqrt(2.0)
    sa = 2.0 * np.sqrt(A) * alpha
    b = [A * ((A + 1) + (A - 1) * cw + sa), -2 * A * ((A - 1) + (A + 1) * cw), A * ((A + 1) + (A - 1) * cw - sa)]
    a = [(A + 1) - (A - 1) * cw + sa, 2 * ((A - 1) - (A + 1) * cw), (A + 1) - (A - 1) * cw - sa]
    return sps.lfilter(np.array(b) / a[0], np.array(a) / a[0], x, axis=-1)


def one_pole_smooth(x, tau):
    """Zero-phase-ish exponential smoothing via lfilter (forward only)."""
    a = np.exp(-1.0 / (tau * SR))
    return sps.lfilter([1 - a], [1, -a], x, axis=-1)


# ---------------------------------------------------------------------------
# Noise
# ---------------------------------------------------------------------------

def pink(shape, rng):
    """Pink (1/f) noise via spectral shaping, unit RMS."""
    shape = (shape,) if np.isscalar(shape) else tuple(shape)
    n = shape[-1]
    w = rng.standard_normal(shape)
    X = np.fft.rfft(w, axis=-1)
    f = np.fft.rfftfreq(n, 1 / SR)
    f[0] = f[1]
    X /= np.sqrt(f)
    y = np.fft.irfft(X, n=n, axis=-1)
    y -= y.mean(axis=-1, keepdims=True)
    return y / (np.sqrt(np.mean(y ** 2, axis=-1, keepdims=True)) + 1e-12)


def brown(shape, rng):
    shape = (shape,) if np.isscalar(shape) else tuple(shape)
    n = shape[-1]
    w = rng.standard_normal(shape)
    X = np.fft.rfft(w, axis=-1)
    f = np.fft.rfftfreq(n, 1 / SR)
    f[0] = f[1]
    X /= np.maximum(f, 15.0)
    y = np.fft.irfft(X, n=n, axis=-1)
    y -= y.mean(axis=-1, keepdims=True)
    return y / (np.sqrt(np.mean(y ** 2, axis=-1, keepdims=True)) + 1e-12)


# ---------------------------------------------------------------------------
# Stereo helpers
# ---------------------------------------------------------------------------

def pan_gains(pan):
    """Constant-power pan, pan in [-1, 1]."""
    a = (np.clip(pan, -1, 1) + 1.0) * np.pi / 4.0
    return np.cos(a), np.sin(a)


def to_stereo(sig, pan=0.0):
    sig = np.asarray(sig)
    if sig.ndim == 2:
        if pan == 0.0:
            return sig
        gl, gr = pan_gains(pan)
        return np.stack([sig[0] * gl * np.sqrt(2), sig[1] * gr * np.sqrt(2)])
    gl, gr = pan_gains(pan)
    return np.stack([sig * gl, sig * gr])


# ---------------------------------------------------------------------------
# Reverb: FFT convolution with a synthetic, frequency-dependent decaying
# noise impulse response plus a sprinkle of early reflections.
# ---------------------------------------------------------------------------

def make_ir(length, rt_low, rt_mid, rt_high, predelay=0.02, seed=0, er_count=10,
            er_span=0.08, width=1.0, onset=0.012):
    rng = np.random.default_rng(seed)
    n = int(length * SR)
    t = np.arange(n) / SR
    noise = rng.standard_normal((2, n))
    # partially correlate L/R for controllable width
    mid = (noise[0] + noise[1]) / 2
    noise = np.stack([mid + width * (noise[0] - mid), mid + width * (noise[1] - mid)])
    edges = [20, 200, 600, 1500, 3500, 7000, 14000, 23000]
    centers = np.sqrt(np.array(edges[:-1]) * np.array(edges[1:]))
    lf = np.log10(centers)
    rts = np.interp(lf, [np.log10(150), np.log10(1000), np.log10(10000)], [rt_low, rt_mid, rt_high])
    ir = np.zeros((2, n))
    for (lo, hi), rt in zip(zip(edges[:-1], edges[1:]), rts):
        band = bp(noise, lo, min(hi, 0.49 * SR), order=3)
        ir += band * np.exp(-6.9078 * t / rt)
    # smooth onset of the diffuse tail
    ir *= 1.0 - np.exp(-t / onset)
    # early reflections
    for ch in range(2):
        times = np.sort(rng.uniform(0.004, er_span, er_count))
        for k, tt in enumerate(times):
            i = int(tt * SR)
            ir[ch, i] += rng.choice([-1, 1]) * rng.uniform(0.4, 1.0) * np.exp(-tt / 0.06) * 6.0
    ir = lp(ir, 12000, order=2)
    pd = int(predelay * SR)
    ir = np.concatenate([np.zeros((2, pd)), ir], axis=1)
    fade = int(0.2 * SR)
    ir[:, -fade:] *= np.linspace(1, 0, fade)
    ir /= np.sqrt(np.sum(ir ** 2, axis=1, keepdims=True))
    return ir


def convolve_stereo(x, ir, n_out=None):
    n_out = n_out or x.shape[-1]
    out = np.zeros((2, n_out))
    for ch in range(2):
        if not np.any(x[ch]):
            continue
        y = sps.oaconvolve(x[ch], ir[ch])
        out[ch] = y[:n_out]
    return out


def pingpong(x, delay, feedback, taps=6, lp_fc=5000.0, cross=0.25):
    """Ping-pong echo built from explicit, progressively darker taps."""
    n = x.shape[-1]
    mono = x.mean(axis=0)
    out = np.zeros((2, n))
    d = int(delay * SR)
    cur = mono
    sos = _sos("lp", lp_fc, 1)
    for k in range(1, taps + 1):
        cur = sps.sosfilt(sos, cur)
        s = k * d
        if s >= n:
            break
        g = feedback ** k
        side = (k + 1) % 2
        out[side, s:] += cur[: n - s] * g
        out[1 - side, s:] += cur[: n - s] * g * cross
    return out


# ---------------------------------------------------------------------------
# Loudness (ITU-R BS.1770-4 K-weighting, gated integrated loudness)
# ---------------------------------------------------------------------------

def k_weight(x):
    b1 = [1.53512485958697, -2.69169618940638, 1.19839281085285]
    a1 = [1.0, -1.69065929318241, 0.73248077421585]
    b2 = [1.0, -2.0, 1.0]
    a2 = [1.0, -1.99004745483398, 0.99007225036621]
    return sps.lfilter(b2, a2, sps.lfilter(b1, a1, x, axis=-1), axis=-1)


def block_loudness(x, block=0.4, step=0.1):
    """Momentary loudness per block (LUFS), and block start times."""
    y = k_weight(np.atleast_2d(x))
    p = np.sum(y ** 2, axis=0)  # sum over channels (G=1 for L/R)
    cs = np.concatenate([[0.0], np.cumsum(p)])
    bl, st = int(block * SR), int(step * SR)
    starts = np.arange(0, len(p) - bl + 1, st)
    ms = (cs[starts + bl] - cs[starts]) / bl
    return -0.691 + 10 * np.log10(ms + 1e-20), starts / SR, ms


def integrated_loudness(x):
    L, _, ms = block_loudness(x)
    keep = L > -70.0
    if not keep.any():
        return -120.0
    rel = -0.691 + 10 * np.log10(ms[keep].mean()) - 10.0
    keep &= L > rel
    return -0.691 + 10 * np.log10(ms[keep].mean())


def true_peak(x, os_factor=4):
    y = sps.resample_poly(np.atleast_2d(x), os_factor, 1, axis=-1)
    return float(np.max(np.abs(y)))


def _moving_avg(x, L):
    """Causal moving average of length L (O(n) via cumulative sum)."""
    if L <= 1:
        return x.copy()
    xp = np.concatenate([np.full(L - 1, x[0]), x])
    cs = np.concatenate([[0.0], np.cumsum(xp)])
    return (cs[L:] - cs[:-L]) / L


def limiter(x, ceiling_db=-1.5, attack=0.004, release=0.06, hold=0.04, os_factor=4):
    """Look-ahead brickwall limiter with true-peak (oversampled) detection.

    Offline and fully vectorized: required gain -> running minimum over a
    window that looks (attack + release) ahead and `hold` behind -> two
    cascaded causal moving averages (lengths attack and release). Because
    the min-window covers both averaging spans, the smoothed gain at every
    peak is <= the gain that peak requires, so the ceiling is guaranteed
    while the gain curve itself stays smooth (no hard steps).
    """
    from scipy.ndimage import minimum_filter1d

    ceiling = db(ceiling_db)
    n = x.shape[-1]
    up = sps.resample_poly(x, os_factor, 1, axis=-1)
    pk = np.max(np.abs(up), axis=0)
    need = n * os_factor
    pk = pk[:need] if len(pk) >= need else np.pad(pk, (0, need - len(pk)))
    peak = np.maximum(pk.reshape(n, os_factor).max(axis=1), np.max(np.abs(x), axis=0))
    g = np.minimum(1.0, ceiling / np.maximum(peak, 1e-12))
    la, lr, hd = max(1, int(attack * SR)), max(1, int(release * SR)), int(hold * SR)
    ahead = la + lr
    # window [i - hd, i + ahead]: size = hd + ahead + 1, shifted forward
    size = hd + ahead + 1
    centre = size // 2
    origin = -(ahead - (size - 1 - centre))
    origin = int(np.clip(origin, -(size // 2), (size - 1) // 2))
    gmin = minimum_filter1d(g, size=size, origin=origin, mode="nearest")
    gs = _moving_avg(_moving_avg(gmin, lr), la)
    gs = np.minimum(gs, g)
    return x * gs, gs


# ---------------------------------------------------------------------------
# WAV IO
# ---------------------------------------------------------------------------

def write_wav_float(path, x):
    from scipy.io import wavfile
    os.makedirs(os.path.dirname(path), exist_ok=True)
    data = np.ascontiguousarray(np.atleast_2d(x).T.astype(np.float32))
    wavfile.write(path, SR, data)


def write_wav_16(path, x, seed=16):
    from scipy.io import wavfile
    os.makedirs(os.path.dirname(path), exist_ok=True)
    rng = np.random.default_rng(seed)
    x = np.atleast_2d(x)
    tpdf = (rng.random(x.shape) - rng.random(x.shape)) / 32768.0
    y = np.clip(np.round((x + tpdf) * 32767.0), -32768, 32767).astype(np.int16)
    wavfile.write(path, SR, np.ascontiguousarray(y.T))


def read_wav(path):
    """Read a wav file as float64 (channels, n) and its sample rate."""
    from scipy.io import wavfile
    sr, d = wavfile.read(path)
    if d.dtype == np.int16:
        d = d.astype(np.float64) / 32768.0
    elif d.dtype == np.int32:
        d = d.astype(np.float64) / 2147483648.0
    elif d.dtype == np.uint8:
        d = (d.astype(np.float64) - 128.0) / 128.0
    else:
        d = d.astype(np.float64)
    if d.ndim == 1:
        d = d[None, :]
    else:
        d = d.T
    return d, sr
