"""Small DSP helpers shared by the audio scripts."""
import numpy as np
from scipy.ndimage import minimum_filter1d, uniform_filter1d
from scipy.signal import butter, sosfilt, sosfiltfilt, resample_poly, fftconvolve

SR = 48000


def db2lin(db):
    return 10 ** (db / 20)


def limiter(x, ceiling_db=-1.0, lookahead_ms=3.0, release_ms=80.0, true_peak=False, sr=SR):
    """Look-ahead brickwall limiter for mono (n,) or stereo (n, 2) float audio."""
    ceil = db2lin(ceiling_db)
    peak = np.abs(x) if x.ndim == 1 else np.abs(x).max(axis=1)
    if true_peak:  # 4x oversampled detection catches inter-sample peaks
        up = np.abs(resample_poly(x, 4, 1, axis=0))
        up = up if up.ndim == 1 else up.max(axis=1)
        peak = np.maximum(peak, up.reshape(-1, 4).max(axis=1)[:len(peak)])
    need = np.minimum(1.0, ceil / np.maximum(peak, 1e-12))
    L = max(1, int(lookahead_ms * sr / 1000))
    g = minimum_filter1d(need, size=2 * L + 1)
    # release: gain may only rise slowly
    a = np.exp(-1.0 / (release_ms * sr / 1000))
    out = np.empty_like(g)
    cur = 1.0
    for i in range(len(g)):   # ~2M samples; fast enough for a 1-minute reel
        gi = g[i]
        cur = gi if gi < cur else gi + (cur - gi) * a
        out[i] = cur
    out = uniform_filter1d(out, size=L)  # smooth the attack so it never clicks
    out = np.minimum(out, minimum_filter1d(need, size=2 * L + 1))
    return x * (out if x.ndim == 1 else out[:, None])


def lowpass(x, f, order=4, sr=SR):
    return sosfilt(butter(order, f, btype="low", fs=sr, output="sos"), x, axis=0)


def highpass(x, f, order=4, sr=SR):
    return sosfilt(butter(order, f, btype="high", fs=sr, output="sos"), x, axis=0)


def bandpass(x, lo, hi, order=2, sr=SR):
    return sosfilt(butter(order, [lo, hi], btype="band", fs=sr, output="sos"), x, axis=0)


def peaking(x, f0, gain_db, q=1.0, sr=SR):
    """RBJ peaking EQ (zero-phase so stems stay aligned)."""
    A = 10 ** (gain_db / 40)
    w = 2 * np.pi * f0 / sr
    al = np.sin(w) / (2 * q)
    b = np.array([1 + al * A, -2 * np.cos(w), 1 - al * A])
    a = np.array([1 + al / A, -2 * np.cos(w), 1 - al / A])
    sos = np.concatenate([b / a[0], a / a[0]])[None, :]
    return sosfiltfilt(sos, x, axis=0)


def reverb_ir(seconds=2.0, rt60=1.6, predelay_ms=18, damp_hz=5500, seed=7, sr=SR):
    """Stereo exponentially-decaying noise IR with a darkening tail."""
    rng = np.random.default_rng(seed)
    n = int(seconds * sr)
    t = np.arange(n) / sr
    env = np.exp(-6.9 * t / rt60)
    ir = rng.standard_normal((n, 2)) * env[:, None]
    # progressive damping: blend towards a low-passed copy as the tail ages
    lp = lowpass(ir, damp_hz, order=2, sr=sr)
    lp2 = lowpass(ir, damp_hz / 3, order=2, sr=sr)
    w = np.clip(t / (rt60 * 0.6), 0, 1)[:, None]
    ir = (1 - w) * lp + w * lp2
    ir[: int(0.004 * sr)] *= np.linspace(0, 1, int(0.004 * sr))[:, None]
    pre = np.zeros((int(predelay_ms * sr / 1000), 2))
    ir = np.concatenate([pre, ir])
    return ir / np.sqrt((ir ** 2).sum(axis=0, keepdims=True))


def convolve_stereo(x, ir):
    """x mono (n,) or stereo (n,2) -> stereo wet signal, same length."""
    if x.ndim == 1:
        x = np.stack([x, x], axis=1)
    return np.stack([fftconvolve(x[:, c], ir[:, c])[: len(x)] for c in range(2)], axis=1)
