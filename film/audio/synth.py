"""Tiny synthesizer toolkit: oscillators, envelopes, filters, reverb and a few
instruments (music box, felt piano, strings, pizzicato, harp, marimba, flute,
choir pad, timpani, cymbal). Everything is generated from math — no samples.
"""
import numpy as np
from scipy import signal

SR = 48000
rng = np.random.default_rng(7)


def t_axis(dur):
    return np.arange(int(dur * SR)) / SR


def midi_hz(m):
    return 440.0 * 2 ** ((m - 69) / 12)


NOTE = {'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11}


def n2m(name):
    """'C4', 'F#3', 'Bb5' -> midi number."""
    base = NOTE[name[0]]
    rest = name[1:]
    if rest.startswith('#'):
        base += 1
        rest = rest[1:]
    elif rest.startswith('b'):
        base -= 1
        rest = rest[1:]
    return base + 12 * (int(rest) + 1)


def adsr(n, a=0.01, d=0.1, s=0.7, r=0.2, hold=None):
    a_n, d_n, r_n = int(a * SR), int(d * SR), int(r * SR)
    hold_n = n - r_n if hold is None else int(hold * SR)
    env = np.zeros(n)
    idx = np.arange(n)
    env = np.where(idx < a_n, idx / max(a_n, 1), 1.0)
    dec = (idx >= a_n) & (idx < a_n + d_n)
    env[dec] = 1 - (1 - s) * (idx[dec] - a_n) / max(d_n, 1)
    env[idx >= a_n + d_n] = s
    rel = idx >= hold_n
    if rel.any():
        start_level = env[min(hold_n, n - 1)]
        env[rel] = start_level * np.maximum(0, 1 - (idx[rel] - hold_n) / max(r_n, 1))
    return env


def lp(x, f, order=2):
    f = min(f, SR * 0.45)
    b, a = signal.butter(order, f / (SR / 2), 'low')
    return signal.lfilter(b, a, x, axis=0)


def hp(x, f, order=2):
    b, a = signal.butter(order, f / (SR / 2), 'high')
    return signal.lfilter(b, a, x, axis=0)


def bp(x, f1, f2, order=2):
    b, a = signal.butter(order, [f1 / (SR / 2), min(f2, SR * 0.45) / (SR / 2)], 'band')
    return signal.lfilter(b, a, x, axis=0)


def saw_bl(freq, t, n_harm=None):
    """Band-limited sawtooth via additive synthesis (freq may be an array)."""
    f0 = np.mean(freq) if np.ndim(freq) else freq
    n_harm = n_harm or max(1, int((SR * 0.45) / f0))
    n_harm = min(n_harm, 40)
    phase = 2 * np.pi * np.cumsum(np.broadcast_to(freq, t.shape)) / SR
    out = np.zeros_like(t)
    for k in range(1, n_harm + 1):
        out += np.sin(k * phase) / k
    return out * (2 / np.pi)


# ------------------------------------------------------------------ instruments
def music_box(freq, dur=2.5, vel=0.8):
    t = t_axis(dur)
    parts = [(1, 1.0, 2.2), (2.0, 0.25, 4.0), (3.0, 0.08, 6.0), (4.2, 0.12, 7.0), (5.4, 0.05, 9.0)]
    y = sum(a * np.sin(2 * np.pi * freq * r * t) * np.exp(-t * dcy) for r, a, dcy in parts)
    click = np.exp(-t * 400) * rng.standard_normal(len(t)) * 0.08
    return (y + click) * vel * np.minimum(1, t / 0.002)


def celesta(freq, dur=2.0, vel=0.8):
    t = t_axis(dur)
    mod = np.sin(2 * np.pi * freq * 4.0 * t) * 1.2 * np.exp(-t * 8)
    y = np.sin(2 * np.pi * freq * t + mod) * np.exp(-t * 2.5)
    y += 0.3 * np.sin(2 * np.pi * freq * 2 * t) * np.exp(-t * 5)
    return y * vel * np.minimum(1, t / 0.003)


def glock(freq, dur=2.5, vel=0.8):
    t = t_axis(dur)
    parts = [(1, 1.0, 1.6), (2.76, 0.4, 3.5), (5.40, 0.18, 6.0), (8.93, 0.08, 9.0)]
    y = sum(a * np.sin(2 * np.pi * freq * r * t) * np.exp(-t * dcy) for r, a, dcy in parts)
    return y * vel * np.minimum(1, t / 0.001)


def felt_piano(freq, dur=3.0, vel=0.7):
    t = t_axis(dur)
    B = 0.0004
    y = np.zeros_like(t)
    for k in range(1, 12):
        fk = freq * k * np.sqrt(1 + B * k * k)
        if fk > SR * 0.45:
            break
        amp = (1 / k ** 1.3) * (0.6 + 0.4 * vel)
        y += amp * np.sin(2 * np.pi * fk * t + k) * np.exp(-t * (0.9 + 0.55 * k))
    y *= np.minimum(1, t / 0.004)
    hammer = lp(rng.standard_normal(len(t)) * np.exp(-t * 90), 1800) * 0.25
    y = lp(y + hammer, 1500 + 3000 * vel)
    return y * vel


def pluck(freq, dur=1.2, vel=0.8, bright=0.5):
    """Karplus-Strong string (pizzicato / harp)."""
    n = int(dur * SR)
    period = SR / freq
    p = int(period)
    frac = period - p
    buf = lp(rng.uniform(-1, 1, p + 2), 2000 + 8000 * bright)
    out = np.zeros(n)
    y = np.concatenate([buf, np.zeros(n)])
    decay = 0.996 if freq < 300 else 0.994
    for i in range(p + 2, n + p + 2):
        a = y[i - p - 1]
        b = y[i - p - 2]
        y[i] = decay * ((1 - frac) * (0.5 * (a + b)) + frac * b)
    out = y[p + 2:p + 2 + n]
    out *= np.minimum(1, np.arange(n) / (0.002 * SR))
    return out * vel / (np.abs(out).max() + 1e-9)


def harp(freq, dur=2.5, vel=0.7):
    return pluck(freq, dur, vel, bright=0.35) * np.exp(-t_axis(dur) * 0.8)


def pizz(freq, dur=0.6, vel=0.8):
    y = pluck(freq, dur, vel, bright=0.25)
    return y * np.exp(-t_axis(dur) * 5)


def marimba(freq, dur=1.0, vel=0.8):
    t = t_axis(dur)
    y = np.sin(2 * np.pi * freq * t) * np.exp(-t * 5)
    y += 0.35 * np.sin(2 * np.pi * freq * 4 * t) * np.exp(-t * 14)
    y += 0.1 * np.sin(2 * np.pi * freq * 9.9 * t) * np.exp(-t * 30)
    return y * vel * np.minimum(1, t / 0.002)


def strings(freq, dur, vel=0.6, attack=0.35, release=0.6, voices=6, bright=0.5):
    t = t_axis(dur + release)
    y = np.zeros_like(t)
    for v in range(voices):
        det = (v - (voices - 1) / 2) * 0.004
        vib = 1 + 0.003 * np.sin(2 * np.pi * (5.2 + 0.3 * v) * t + v)
        y += saw_bl(freq * (1 + det) * vib, t, 24)
    y /= voices
    y = lp(y, 900 + 2600 * bright + freq * 1.5)
    env = adsr(len(t), a=attack, d=0.2, s=0.9, r=release, hold=dur)
    return y * env * vel


def choir(freq, dur, vel=0.5, attack=0.6, release=1.0):
    t = t_axis(dur + release)
    y = np.zeros_like(t)
    for v in range(4):
        det = (v - 1.5) * 0.003
        vib = 1 + 0.004 * np.sin(2 * np.pi * 4.7 * t + v * 2)
        ph = 2 * np.pi * np.cumsum(freq * (1 + det) * vib) / SR
        y += np.sin(ph) + 0.35 * np.sin(2 * ph) + 0.18 * np.sin(3 * ph) + 0.1 * np.sin(4 * ph)
    # "ooh" formants
    y = bp(y, 250, 1100) * 1.2 + lp(y, 300) * 0.4
    env = adsr(len(t), a=attack, d=0.3, s=0.9, r=release, hold=dur)
    return y / 4 * env * vel


def flute(freq, dur, vel=0.6, vibrato=0.006):
    t = t_axis(dur + 0.15)
    vib = 1 + vibrato * np.sin(2 * np.pi * 5.0 * t) * np.minimum(1, t / 0.4)
    ph = 2 * np.pi * np.cumsum(freq * vib) / SR
    y = np.sin(ph) + 0.18 * np.sin(2 * ph) + 0.06 * np.sin(3 * ph)
    breath = bp(rng.standard_normal(len(t)), freq * 0.8, freq * 3) * 0.08
    env = adsr(len(t), a=0.06, d=0.1, s=0.85, r=0.15, hold=dur)
    return (y + breath) * env * vel


def bass(freq, dur, vel=0.7):
    t = t_axis(dur + 0.1)
    y = np.sin(2 * np.pi * freq * t) + 0.3 * np.sin(4 * np.pi * freq * t) * np.exp(-t * 6)
    env = adsr(len(t), a=0.005, d=0.25, s=0.55, r=0.1, hold=dur)
    return y * env * vel


def timpani(freq, dur=2.5, vel=0.9):
    t = t_axis(dur)
    f = freq * (1 + 0.08 * np.exp(-t * 20))
    ph = 2 * np.pi * np.cumsum(f) / SR
    y = np.sin(ph) * np.exp(-t * 1.8) + 0.4 * np.sin(1.5 * ph) * np.exp(-t * 3)
    y += lp(rng.standard_normal(len(t)), 400) * np.exp(-t * 25) * 0.6
    return y * vel


def cymbal_swell(dur=2.0, vel=0.5):
    t = t_axis(dur + 0.6)
    n = rng.standard_normal(len(t))
    y = hp(n, 5000) * 0.6 + bp(n, 3000, 9000) * 0.4
    env = np.minimum(1, (t / dur) ** 2.5)
    env[t > dur] = np.exp(-(t[t > dur] - dur) * 6)
    return y * env * vel


def cymbal_hit(dur=2.5, vel=0.4):
    t = t_axis(dur)
    n = rng.standard_normal(len(t))
    return (hp(n, 4000) * np.exp(-t * 2.2) + bp(n, 6000, 12000) * np.exp(-t * 5)) * vel


def shaker(vel=0.2):
    t = t_axis(0.12)
    return hp(rng.standard_normal(len(t)), 6000) * np.exp(-t * 45) * vel


def soft_kick(vel=0.6):
    t = t_axis(0.4)
    f = 45 + 90 * np.exp(-t * 30)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 9) * vel


# ------------------------------------------------------------------ effects
def reverb_ir(seconds=2.4, predelay=0.02, damp=3500, seed=3):
    r = np.random.default_rng(seed)
    n = int(seconds * SR)
    t = np.arange(n) / SR
    ir = np.zeros((n, 2))
    for ch in range(2):
        noise = r.standard_normal(n)
        env = np.exp(-t * 6.9 / seconds)
        x = noise * env
        # darker tail
        x = lp(x, damp) * 0.7 + lp(x, damp * 0.35) * 0.3
        ir[:, ch] = x
    pd = int(predelay * SR)
    ir = np.concatenate([np.zeros((pd, 2)), ir])
    return ir / np.sqrt((ir ** 2).sum(axis=0))


def convolve_stereo(x, ir):
    if x.ndim == 1:
        x = np.stack([x, x], axis=1)
    out = np.zeros((len(x) + len(ir) - 1, 2))
    for ch in range(2):
        out[:, ch] = signal.fftconvolve(x[:, ch], ir[:, ch])
    return out


def pan(x, p):
    """p in [-1, 1] -> stereo (equal power)."""
    a = (p + 1) * np.pi / 4
    return np.stack([x * np.cos(a), x * np.sin(a)], axis=1)


class Track:
    """A stereo buffer you can drop sounds into at times (seconds)."""

    def __init__(self, dur):
        self.buf = np.zeros((int(dur * SR) + SR * 4, 2))

    def add(self, when, x, gain=1.0, p=0.0):
        if x.ndim == 1:
            x = pan(x, p)
        i = int(when * SR)
        if i < 0:
            x = x[-i:]
            i = 0
        j = min(len(self.buf), i + len(x))
        self.buf[i:j] += x[: j - i] * gain
