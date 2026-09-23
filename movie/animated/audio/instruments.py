"""ECHO (animated cut) — synthesized instruments and sound-design generators.

Built on the generic DSP toolkit of the first cut (movie/audio/dsp.py, which
is imported, not copied). The musical instruments carry over the first cut's
designs; the rest (braams, taiko, timpani, cymbals, whooshes, shockwave,
jungle, servo, alarm, crystalline grains...) are new for the bigger picture.
Everything is generated from oscillators and noise: no samples.
"""

import os
import sys

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "audio"))
from dsp import (SR, TAU, hz, chord, db, tvec, ramp_db, fade_env, smooth_noise, saw_blep,  # noqa: E402,F401
                 pan_gains, to_stereo, lp, hp, bp, tv_filter, pink, brown, convolve_stereo,
                 pingpong, one_pole_smooth)


# ---------------------------------------------------------------------------
# Buses and placement
# ---------------------------------------------------------------------------

class Bus:
    """A section of the score: dry, hall-send, space-send and echo-send buffers.

    Rendered through the reverbs and then gated, so sections can end in
    hard, clean cuts without reverb tails leaking past them.
    """

    def __init__(self, t0, t1):
        self.t0 = t0
        self.n = int(round((t1 - t0) * SR))
        self.dry = np.zeros((2, self.n))
        self.rev = np.zeros((2, self.n))
        self.space = np.zeros((2, self.n))
        self.echo = np.zeros((2, self.n))

    def add(self, sig, t, gain=1.0, pan=0.0, send=0.0, space=0.0, echo=0.0):
        st = to_stereo(np.asarray(sig, dtype=float), pan) * gain
        s = int(round((t - self.t0) * SR))
        a, b = max(0, s), min(self.n, s + st.shape[1])
        if b <= a:
            return
        seg = st[:, a - s:b - s]
        self.dry[:, a:b] += seg
        if send:
            self.rev[:, a:b] += seg * send
        if space:
            self.space[:, a:b] += seg * space
        if echo:
            self.echo[:, a:b] += seg * echo

    def render(self, hall, space_ir=None, gate=None, echo_delay=0.5, echo_fb=0.45, echo_send=0.5):
        out = self.dry.copy()
        rev = self.rev
        if np.any(self.echo):
            e = pingpong(self.echo, echo_delay, echo_fb, taps=8, lp_fc=4200.0)
            out += e
            rev = rev + e * echo_send
        if np.any(rev):
            out += convolve_stereo(rev, hall, self.n)
        if space_ir is not None and np.any(self.space):
            out += convolve_stereo(self.space, space_ir, self.n)
        if gate:
            out *= ramp_db(gate, self.n, self.t0)
        return out


def place(stem, sig, t0, gain=1.0):
    s = int(round(t0 * SR))
    n = stem.shape[1]
    a, b = max(0, s), min(n, s + sig.shape[1])
    if b > a:
        stem[:, a:b] += sig[:, a - s:b - s] * gain


def curve(spec, n):
    """Scalar, or [(t, value), ...] interpolated geometrically over n samples."""
    if np.isscalar(spec):
        return float(spec)
    pts = sorted(spec)
    return np.exp(np.interp(tvec(n), [p[0] for p in pts], np.log([p[1] for p in pts])))


# ---------------------------------------------------------------------------
# Tonal instruments (carried over from the first cut)
# ---------------------------------------------------------------------------

def pad(notes, dur, att=2.0, rel=2.5, fc=1200.0, q=0.707, voices=5, detune=10.0, seed=0,
        spread=0.8, trem=None):
    """Detuned polyBLEP saw ensemble through a (time-varying) low-pass."""
    n = int(dur * SR)
    t = tvec(n)
    rng = np.random.default_rng(seed)
    out = np.zeros((2, n))
    for j, f in enumerate(notes):
        for v in range(voices):
            pos = (2.0 * v / (voices - 1) - 1.0) if voices > 1 else 0.0
            cents = detune * pos + rng.normal(0, detune * 0.12)
            drift = 1.0 + 0.0007 * np.sin(TAU * rng.uniform(0.05, 0.2) * t + rng.uniform(0, TAU))
            fv = f * 2 ** (cents / 1200.0) * drift
            s = saw_blep(rng.random() + np.cumsum(fv) / SR, fv / SR)
            gl, gr = pan_gains(spread * pos * (1 if j % 2 == 0 else -1))
            out[0] += gl * s
            out[1] += gr * s
    out /= np.sqrt(len(notes) * voices)
    out = tv_filter(out, curve(fc, n), q) if not np.isscalar(fc) else lp(out, fc, order=2)
    out *= fade_env(n, att, rel)
    if trem is not None:
        rate, depth = trem
        rate = curve(rate, n)
        ph = np.cumsum(np.broadcast_to(rate, (n,))) / SR
        out *= 1.0 - depth * (0.5 + 0.5 * np.sin(TAU * ph))
    return out


FORMANTS = {
    "a": [(730, 0, 90), (1150, -6, 110), (2650, -18, 160), (3500, -26, 220)],
    "o": [(520, 0, 80), (880, -5, 100), (2500, -24, 160), (3400, -30, 220)],
    "u": [(350, 0, 70), (650, -8, 90), (2400, -30, 160), (3300, -36, 220)],
}


def choir(notes, dur, att=1.5, rel=2.5, seed=0, vowel="a", copies=2, spread=0.7):
    """Additive voices: harmonic series shaped by vowel formants, with vibrato."""
    n = int(dur * SR)
    t = tvec(n)
    rng = np.random.default_rng(seed)
    out = np.zeros((2, n))
    fm = FORMANTS[vowel]
    vib_in = np.clip(t / 1.2, 0, 1)
    for f in notes:
        H = int(min(4200.0 / f, 24))
        hs = np.arange(1, H + 1)
        fh = f * hs
        amp = sum(db(g) * np.exp(-0.5 * ((fh - F) / bw) ** 2) for F, g, bw in fm) + 0.02
        amp *= hs ** -0.6
        for c in range(copies):
            vib = 0.0045 * vib_in * np.sin(TAU * rng.uniform(4.6, 5.6) * t + rng.uniform(0, TAU))
            fv = f * 2 ** (rng.normal(0, 5) / 1200.0) * (1.0 + vib)
            ph = rng.random() + np.cumsum(fv) / SR
            sig = np.zeros(n)
            for h, a in zip(hs, amp):
                sig += a * np.sin(TAU * h * ph)
            gl, gr = pan_gains(spread * rng.uniform(-1, 1))
            out[0] += gl * sig
            out[1] += gr * sig
    out /= np.sqrt(len(notes) * copies) * 2.0
    return out * fade_env(n, att, rel)


def bell(f, dur=4.0, decay=1.8, idx=1.6, ratio=3.5):
    """FM bell / celesta: inharmonic modulator, decaying index."""
    n = int(dur * SR)
    t = tvec(n)
    idx = idx * min(1.0, 900.0 / f)
    I = idx * np.exp(-t / (0.25 * decay))
    y = np.sin(TAU * f * t + I * np.sin(TAU * f * ratio * t)) * np.exp(-t / decay)
    y += 0.3 * np.sin(TAU * 2.0 * f * t + 0.3) * np.exp(-t / (0.4 * decay))
    if 2.76 * f < 16000:
        y += 0.1 * np.sin(TAU * 2.76 * f * t) * np.exp(-t / (0.15 * decay))
    return y * fade_env(n, 0.002, 0.05)


def pluck(f, dur=1.0, decay=0.35, bright=2.2):
    """Soft FM mallet pluck."""
    n = int(dur * SR)
    t = tvec(n)
    I = bright * min(1.0, 700.0 / f) * np.exp(-t / 0.05)
    y = np.sin(TAU * f * t + I * np.sin(TAU * f * t)) * np.exp(-t / decay)
    y += 0.12 * np.sin(TAU * 4.0 * f * t) * np.exp(-t / 0.012)
    return y * fade_env(n, 0.0015, 0.05)


def piano(f, dur=5.0, vel=0.6, seed=0):
    """Additive felt piano: stiff-string partials, per-partial decay, unison beating."""
    rng = np.random.default_rng(seed)
    n = int(dur * SR)
    t = tvec(n)
    y = np.zeros(n)
    Bc = 0.00032
    for k in range(1, 14):
        fk = k * f * np.sqrt(1 + Bc * k * k)
        if fk > 11000:
            break
        ak = k ** -1.3 * np.exp(-(k - 1) * (0.6 - 0.35 * vel))
        tau = 3.2 * (262.0 / f) ** 0.35 / (1.0 + 0.5 * (k - 1))
        p1, p2 = rng.uniform(0, TAU, 2)
        y += ak * np.exp(-t / tau) * (np.sin(TAU * fk * t + p1) + 0.7 * np.sin(TAU * fk * 1.0007 * t + p2))
    ham = lp(rng.standard_normal(n) * np.exp(-t / 0.006), 1200.0) * 0.08
    y = lp(y + ham, 1800.0 + 3500.0 * vel, order=1)
    return y * fade_env(n, 0.003, 0.3) * 0.5


def sub(f, dur, att=1.0, rel=1.5, h2=0.12):
    n = int(dur * SR)
    t = tvec(n)
    y = np.sin(TAU * f * t) + h2 * np.sin(TAU * 2 * f * t + 0.5)
    return y * fade_env(n, att, rel)


def thump(f0, f1, dur, tau_pitch=0.04, tau_amp=0.2, noise=0.15, seed=0):
    """Pitch-dropping sine: heartbeat, low pulses."""
    rng = np.random.default_rng(seed)
    n = int(dur * SR)
    t = tvec(n)
    freq = f1 + (f0 - f1) * np.exp(-t / tau_pitch)
    y = np.sin(TAU * np.cumsum(freq) / SR) * np.exp(-t / tau_amp)
    if noise:
        y += noise * lp(rng.standard_normal(n), 400.0) * np.exp(-t / 0.03)
    return y * fade_env(n, 0.0015, min(0.05, dur / 4))


def shepard_rise(dur, base, layers=5, octaves=1.0, seed=0, fc=(900, 5000)):
    """Endless-rise cluster: saw layers gliding up with a bell-shaped weighting."""
    n = int(dur * SR)
    t = tvec(n)
    s = t / dur
    rng = np.random.default_rng(seed)
    out = np.zeros((2, n))
    for k in range(layers):
        pos = k + octaves * s
        w = np.exp(-0.5 * ((pos - layers / 2.0) / (layers / 4.0)) ** 2)
        f = base * 2 ** pos
        for side in range(2):
            fv = f * 2 ** (rng.normal(0, 6) / 1200)
            out[side] += w * saw_blep(rng.random() + np.cumsum(fv) / SR, fv / SR)
    out /= layers
    return tv_filter(out, np.exp(np.linspace(np.log(fc[0]), np.log(fc[1]), n)), 0.8)


# ---------------------------------------------------------------------------
# New orchestral weight
# ---------------------------------------------------------------------------

def organ(notes, dur, att=0.01, rel=0.08, seed=0, drawbars=(1.0, 0.7, 0.35, 0.3, 0.15, 0.1),
          spread=0.5, leslie=0.08):
    """Additive pipe/drawbar organ (harmonics 1,2,3,4,6,8), gentle rotary shimmer."""
    n = int(dur * SR)
    t = tvec(n)
    rng = np.random.default_rng(seed)
    harm = (1, 2, 3, 4, 6, 8)
    out = np.zeros((2, n))
    for j, f in enumerate(notes):
        for c in range(2):
            fv = f * 2 ** ((c - 0.5) * 3 / 1200)
            ph0 = rng.random()
            sig = np.zeros(n)
            for h, a in zip(harm, drawbars):
                if h * fv < 12000 and a:
                    sig += a * np.sin(TAU * (h * fv * t + ph0 * h))
            sig *= 1 - leslie * (0.5 + 0.5 * np.sin(TAU * rng.uniform(5.2, 6.4) * t + rng.uniform(0, TAU)))
            gl, gr = pan_gains(spread * (1 if (j + c) % 2 else -1) * 0.7)
            out[0] += gl * sig
            out[1] += gr * sig
    out /= np.sqrt(len(notes) * 2) * sum(drawbars)
    return out * fade_env(n, att, rel)


def spiccato(f, dur=0.2, seed=0, bright=2800.0):
    """Short bowed string note for ostinati: three detuned saws, fast decay."""
    rng = np.random.default_rng(seed)
    n = int(dur * SR)
    t = tvec(n)
    out = np.zeros((2, n))
    for v, c in enumerate((-9, 0, 9)):
        fv = f * 2 ** ((c + rng.normal(0, 2)) / 1200)
        s = saw_blep(rng.random() + fv * t, fv / SR)
        gl, gr = pan_gains((v - 1) * 0.6)
        out[0] += gl * s
        out[1] += gr * s
    env = np.minimum(1.0, t / 0.006) * (0.35 + 0.65 * np.exp(-t / 0.06))
    out = lp(out * env, bright, order=2) / 2.0
    return out * fade_env(n, 0.001, 0.04)


def braam(notes, dur=4.0, seed=0, drive=2.2, fc=((0, 160), (0.12, 2600), (0.9, 1100), (4.0, 320)),
          att=0.02, rel=1.6, voices=7, detune=18.0):
    """Huge low brass 'braam': wide saw stack, snapping filter, tanh drive."""
    p = pad(notes, dur, att=att, rel=rel, fc=[(a, b) for a, b in fc if a <= dur] + [(dur, fc[-1][1])],
            q=1.25, voices=voices, detune=detune, seed=seed, spread=0.95)
    p = np.tanh(drive * p * 3.0) / np.tanh(drive)
    n = p.shape[1]
    return p * (0.45 + 0.55 * np.exp(-tvec(n) / 1.4)) * fade_env(n, att, rel)


def taiko(size=1.0, seed=0, dur=1.6):
    """Big drum: pitch-dropping membrane, skin noise, stick click."""
    rng = np.random.default_rng(seed)
    n = int(dur * SR)
    t = tvec(n)
    f0, f1 = 170.0 / size, 58.0 / size
    freq = f1 + (f0 - f1) * np.exp(-t / 0.045)
    y = np.sin(TAU * np.cumsum(freq) / SR) * np.exp(-t / (0.32 * size))
    y += 0.35 * np.sin(TAU * np.cumsum(freq * 1.58) / SR) * np.exp(-t / 0.12)
    y += 0.45 * bp(rng.standard_normal(n), 90.0, 900.0) * np.exp(-t / 0.06)
    y += 0.18 * hp(rng.standard_normal(n), 2500.0) * np.exp(-t / 0.004)
    y = np.tanh(1.6 * y) / np.tanh(1.6)
    return y * fade_env(n, 0.0008, 0.2)


def timpani(f, dur=3.0, vel=1.0, seed=0):
    """Tuned kettle drum: inharmonic membrane modes + felt mallet."""
    rng = np.random.default_rng(seed)
    n = int(dur * SR)
    t = tvec(n)
    glide = 1.0 + 0.03 * np.exp(-t / 0.03)
    y = np.zeros(n)
    for r, a, d in ((1.0, 1.0, 1.3), (1.504, 0.55, 0.9), (1.742, 0.35, 0.7), (2.0, 0.3, 0.55),
                    (2.245, 0.2, 0.45), (2.494, 0.12, 0.35)):
        y += a * np.sin(TAU * np.cumsum(f * r * glide) / SR + rng.uniform(0, TAU)) * np.exp(-t / d)
    y += 0.4 * vel * lp(rng.standard_normal(n), 900.0) * np.exp(-t / 0.02)
    return y * fade_env(n, 0.001, 0.3) * (0.5 + 0.5 * vel)


def _square(freq, n, rng):
    ph = rng.random() + freq * np.arange(n) / SR
    dt = freq / SR
    return saw_blep(ph, dt) - saw_blep(ph + 0.5, dt)


def cymbal(dur=4.0, seed=0, decay=1.4, reverse=False):
    """Crash cymbal: six band-limited metallic squares + noise, band-passed."""
    rng = np.random.default_rng(seed)
    n = int(dur * SR)
    t = tvec(n)
    y = sum(_square(f * 2.0 * rng.uniform(0.99, 1.01), n, rng) for f in (205.3, 304.4, 369.6, 522.7, 540.0, 800.0))
    y = bp(y, 4500.0, 13000.0, order=2) * 0.6
    y += hp(rng.standard_normal(n), 5000.0) * 0.8
    y = np.stack([y, np.roll(y, int(0.0007 * SR)) * 0.9 + 0.1 * hp(rng.standard_normal(n), 5000.0)])
    env = np.exp(-t / decay) * (1 - np.exp(-t / 0.002))
    y = y * env
    if reverse:
        y = y[:, ::-1] * fade_env(n, 0.3, 0.004)
    return y * fade_env(n, 0.001, 0.3) * 0.35


# ---------------------------------------------------------------------------
# Sound design generators
# ---------------------------------------------------------------------------

def noise_sweep(dur, f0, f1, q, rng, kind="bp"):
    n = int(dur * SR)
    fc = np.exp(np.linspace(np.log(f0), np.log(f1), n))
    return tv_filter(pink((2, n), rng), fc, q, kind=kind)


def reverse_swell(dur, rng, f0=400.0, f1=7000.0):
    n = int(dur * SR)
    t = tvec(n)
    y = noise_sweep(dur, f0, f1, 0.8, rng, kind="lp")
    env = np.exp((t - dur) / (dur / 4.5))
    k = int(0.012 * SR)
    env[-k:] *= np.linspace(1, 0, k)
    return y * env


def boom(dur=8.0, f0=72.0, f1=27.0, seed=0, body=0.7, tau=2.2):
    """Cinematic low boom: sub sweep, low body noise, a crack, soft saturation."""
    rng = np.random.default_rng(seed)
    n = int(dur * SR)
    t = tvec(n)
    freq = f1 + (f0 - f1) * np.exp(-t / 0.35)
    ph = np.cumsum(freq) / SR
    y = np.sin(TAU * ph) * np.exp(-t / tau)
    y += 0.35 * np.sin(TAU * 2 * ph + 0.3) * np.exp(-t / 0.6)
    y += body * lp(rng.standard_normal(n), 170.0, order=2) * np.exp(-t / 0.7)
    y += 0.25 * bp(rng.standard_normal(n), 700.0, 3500.0) * np.exp(-t / 0.02)
    y = np.tanh(1.4 * y) / np.tanh(1.4)
    return y * fade_env(n, 0.003, 1.0)


def sub_drop(dur=3.0, f0=110.0, f1=26.0, tau=1.2):
    n = int(dur * SR)
    t = tvec(n)
    freq = f1 * (f0 / f1) ** np.exp(-t / (dur * 0.25))
    y = np.sin(TAU * np.cumsum(freq) / SR) * np.exp(-t / tau)
    return y * fade_env(n, 0.004, 0.5)


def shockwave(dur=3.5, seed=0):
    """Blast front: bright noise closing to a low roar, widening, with crackle."""
    rng = np.random.default_rng(seed)
    n = int(dur * SR)
    t = tvec(n)
    src = rng.standard_normal((2, n)) * 0.6 + pink((2, n), rng) * 0.6
    fc = 250.0 + 12000.0 * np.exp(-t / (dur * 0.18))
    y = tv_filter(src, fc, 0.6, kind="lp")
    y *= np.exp(-t / 0.9) * (1 - np.exp(-t / 0.003))
    # widening: the right channel lags a little more as the front spreads
    y[1] = np.interp(np.arange(n) - 0.012 * SR * (1 - np.exp(-t / 0.5)), np.arange(n), y[1])
    crack = np.zeros(n)
    k = 90
    pos = (rng.exponential(0.35, k) * SR).astype(int)
    pos = pos[pos < n]
    crack[pos] = rng.lognormal(0, 0.7, len(pos)) * rng.choice([-1, 1], len(pos))
    crack = bp(crack, 900.0, 6000.0) * 2.5
    y += np.stack([crack, np.roll(crack, 211)])
    return y * fade_env(n, 0.002, 0.6)


def whoosh(dur, seed=0, f_lo=180.0, f_hi=2600.0, center=0.62, pan0=-0.8, pan1=0.8, q=1.1, low=0.5):
    """A pass-by: band-passed noise that rises to the pass point (Doppler) then falls, panning across."""
    rng = np.random.default_rng(seed)
    n = int(dur * SR)
    t = tvec(n)
    s = t / dur
    c = center
    shape = np.where(s < c, (s / c) ** 2.2, np.exp(-(s - c) / (1 - c) * 3.2))
    fc = f_lo * (f_hi / f_lo) ** shape
    y = tv_filter(pink((2, n), rng), fc, q, kind="bp") * 2.0
    y *= shape ** 1.4
    p = pan0 + (pan1 - pan0) * (0.5 + 0.5 * np.tanh((s - c) * 6))
    gl, gr = pan_gains(p)
    y = np.stack([y[0] * gl * 1.41, y[1] * gr * 1.41])
    if low:
        tc = c * dur
        wh = np.zeros(n)
        m = n - int(tc * SR) - int(0.05 * SR)
        if m > 0:
            th = thump(80.0, 38.0, m / SR, tau_pitch=0.08, tau_amp=0.35, noise=0.0)
            wh[n - m:] = th[:m]
        wh += 0.0
        y += low * np.stack([wh, wh]) * 0.7
    return y * fade_env(n, 0.02, 0.1)


def relay_clunk(seed=0, size=1.0):
    rng = np.random.default_rng(seed)
    n = int(0.6 * SR)
    t = tvec(n)
    y = thump(130 / size, 62 / size, 0.6, tau_pitch=0.02, tau_amp=0.07 * size, noise=0.3, seed=seed)
    y += 0.5 * bp(rng.standard_normal(n), 2000.0, 7000.0) * np.exp(-t / 0.003)
    y += 0.2 * (np.sin(TAU * 1830 * t) + 0.6 * np.sin(TAU * 2710 * t)) * np.exp(-t / 0.04)
    y += 0.3 * np.sin(TAU * 420 / size * t) * np.exp(-t / 0.06)
    return y * fade_env(n, 0.0005, 0.1)


def electric_hum(dur, f0, seed=0, bright=1.0):
    """Transformer hum: odd-heavy harmonic series with slow flutter and a little buzz."""
    rng = np.random.default_rng(seed)
    n = int(dur * SR)
    t = tvec(n)
    fl = 1 + 0.002 * smooth_noise(n, 3.0, rng, -1, 1)
    ph = np.cumsum(f0 * fl) / SR
    y = np.zeros(n)
    for k in range(1, 16):
        if k * f0 > 5000:
            break
        a = (1.0 if k % 2 else 0.55) / k ** (1.1 - 0.35 * bright)
        y += a * np.sin(TAU * k * ph + rng.uniform(0, TAU))
    y = np.tanh(1.8 * y) / 1.8
    return y


def crickets(dur, seed=0, voices=7):
    """Night insects: several chirping crickets plus a continuous katydid trill."""
    rng = np.random.default_rng(seed)
    n = int(dur * SR)
    t = tvec(n)
    out = np.zeros((2, n))
    for v in range(voices):
        f = rng.uniform(3900, 5600)
        syl = rng.uniform(24, 38)             # syllables per second
        nsyl = rng.integers(3, 6)
        period = rng.uniform(0.45, 1.1)
        off = rng.uniform(0, period)
        tt = np.mod(t + off, period)
        gate = (tt < nsyl / syl).astype(float)
        am = (0.5 - 0.5 * np.cos(TAU * syl * tt)) ** 2 * gate
        y = np.sin(TAU * f * t + rng.uniform(0, TAU)) * am
        y += 0.15 * np.sin(TAU * 2 * f * t) * am
        lvl = db(rng.uniform(-12, 0)) * (0.6 + 0.4 * smooth_noise(n, 0.1, rng))
        gl, gr = pan_gains(rng.uniform(-0.9, 0.9))
        out[0] += y * lvl * gl
        out[1] += y * lvl * gr
    # katydid trill
    for side, f in ((0, 6600.0), (1, 7100.0)):
        am = (0.5 + 0.5 * np.sin(TAU * 52.0 * t)) ** 3 * (0.4 + 0.6 * smooth_noise(n, 0.3, rng))
        out[side] += 0.35 * bp(rng.standard_normal(n), f * 0.95, f * 1.05) * am * 3.0
    return out / voices ** 0.5


def frogs(dur, seed=0, rate=0.8):
    """Distant frog croaks: glottal pulse trains through two formants."""
    rng = np.random.default_rng(seed)
    n = int(dur * SR)
    out = np.zeros((2, n))
    k = rng.poisson(rate * dur)
    for i in range(k):
        t0 = rng.uniform(0, dur - 0.6)
        m = int(rng.uniform(0.12, 0.28) * SR)
        tt = tvec(m)
        f0 = rng.uniform(70, 120)
        pulses = (np.mod(f0 * tt, 1.0) < 0.12).astype(float)
        y = bp(pulses, 350, 700) + 0.5 * bp(pulses, 1000, 1500)
        env = np.sin(np.pi * tt / tt[-1]) ** 0.7
        reps = rng.integers(1, 4)
        seg = np.concatenate([y * env] * reps + [np.zeros(int(0.05 * SR))])
        seg = lp(seg, 2500.0)
        s = int(t0 * SR)
        e = min(n, s + len(seg))
        gl, gr = pan_gains(rng.uniform(-1, 1))
        g = db(rng.uniform(-10, 0))
        out[0, s:e] += seg[:e - s] * g * gl
        out[1, s:e] += seg[:e - s] * g * gr
    return out


def servo(dur, seed=0, rotor=36.0):
    """Big dish slewing: motor harmonics that spin up/down, gear mesh, rumble, creaks."""
    rng = np.random.default_rng(seed)
    n = int(dur * SR)
    t = tvec(n)
    up, down = 0.8, 0.6
    sp = np.clip(t / up, 0, 1) ** 1.5 * np.clip((dur - t) / down, 0, 1) ** 1.2
    sp *= 1 + 0.015 * smooth_noise(n, 4.0, rng, -1, 1)
    fr = rotor * (0.15 + 0.85 * sp)
    ph = np.cumsum(fr) / SR
    y = np.zeros(n)
    for k in range(1, 30):
        a = 1.0 / k
        if k in (7, 14, 21):   # gear mesh / slot harmonics
            a *= 4.0
        y += a * np.sin(TAU * k * ph + rng.uniform(0, TAU))
    y *= sp
    rumble = lp(brown(n, rng), 140.0) * (0.3 + 0.7 * sp) * (0.8 + 0.2 * np.sin(TAU * ph * 0.5))
    grind = bp(rng.standard_normal(n), 900.0, 3000.0) * (0.5 + 0.5 * np.sin(TAU * 7 * ph)) ** 4 * sp * 0.25
    y = 0.35 * y + 0.8 * rumble + grind
    # two metallic creaks
    for c in range(2):
        tc = rng.uniform(0.25, 0.75) * dur
        m = int(rng.uniform(0.4, 0.8) * SR)
        s = int(tc * SR)
        f = np.linspace(rng.uniform(700, 900), rng.uniform(500, 650), m)
        cr = tv_filter(rng.standard_normal(m), f, 25.0, kind="bp") * np.sin(np.linspace(0, np.pi, m)) * 1.2
        y[s:s + m] += cr[:max(0, min(m, n - s))]
    return np.stack([y, 0.9 * y + 0.1 * np.roll(y, 97)])


def buzzer(dur, f, seed=0):
    """Old hut alarm buzzer tone (odd harmonics), one beep."""
    n = int(dur * SR)
    t = tvec(n)
    y = sum(np.sin(TAU * k * f * t) / k for k in (1, 3, 5, 7, 9) if k * f < 9000)
    return y * fade_env(n, 0.004, 0.012)


def glass(f, dur=0.4, decay=0.12, seed=0):
    """Crystalline grain: short inharmonic FM ping."""
    n = int(dur * SR)
    t = tvec(n)
    I = 1.3 * min(1.0, 3000.0 / f) * np.exp(-t / (decay * 0.3))
    y = np.sin(TAU * f * t + I * np.sin(TAU * f * 3.17 * t)) * np.exp(-t / decay)
    if 2.41 * f < 16000:
        y += 0.3 * np.sin(TAU * 2.41 * f * t) * np.exp(-t / (decay * 0.5))
    return y * fade_env(n, 0.0008, 0.02)


def tick(f, rng, empty=False):
    """Soft, precise digital blip (the first cut's grid tick)."""
    n = int(0.12 * SR)
    t = tvec(n)
    tr = hp(rng.standard_normal(n), 3000.0) * np.exp(-t / 0.0005) * 0.25
    if empty:
        y = 0.4 * np.sin(TAU * 260 * t) * np.exp(-t / 0.01) + tr
        return y * fade_env(n, 0.0003, 0.02) * 0.45
    y = np.sin(TAU * f * t) * np.exp(-t / 0.03) + 0.22 * np.sin(TAU * 2 * f * t) * np.exp(-t / 0.012)
    return (y + tr) * fade_env(n, 0.0006, 0.02)


def shimmer(notes, dur, seed=0):
    rng = np.random.default_rng(seed)
    n = int(dur * SR)
    t = tvec(n)
    out = np.zeros((2, n))
    for f in notes:
        for mult, g in ((1.0, 1.0), (2.0, 0.3)):
            ff = f * mult * 2 ** (rng.normal(0, 4) / 1200)
            if ff > 15000:
                continue
            att = rng.uniform(0.4, 1.4)
            env = (1 - np.exp(-t / att)) * np.exp(-t / rng.uniform(2.5, 4.5))
            trem = 1.0 - 0.45 * (0.5 + 0.5 * np.sin(TAU * rng.uniform(2.5, 7.0) * t + rng.uniform(0, TAU)))
            y = g * np.sin(TAU * ff * t + rng.uniform(0, TAU)) * env * trem
            gl, gr = pan_gains(rng.uniform(-0.8, 0.8))
            out[0] += gl * y
            out[1] += gr * y
    return out / np.sqrt(len(notes)) * fade_env(n, 0.01, 1.5)


def key_click(rng, heavy=False, space=False):
    """Quiet mechanical/terminal keystroke (the first cut's design), fixed peak."""
    n = int(0.1 * SR)
    t = tvec(n)
    p = rng.uniform(0.92, 1.08)
    noise = rng.standard_normal(n)
    if space:
        y = 0.5 * np.sin(TAU * 150 * p * t) * np.exp(-t / 0.014)
        y += 0.3 * lp(noise, 1500.0) * np.exp(-t / 0.003)
    else:
        tr = hp(noise, 2500.0) * np.exp(-t / 0.0006)
        f1 = rng.uniform(2300, 3300) * p
        f2 = rng.uniform(4800, 6800) * p
        f3 = rng.uniform(210, 320) * p * (0.85 if heavy else 1.0)
        body = (0.5 * np.sin(TAU * f1 * t + rng.uniform(0, TAU)) * np.exp(-t / 0.0045)
                + 0.28 * np.sin(TAU * f2 * t + rng.uniform(0, TAU)) * np.exp(-t / 0.0022)
                + 0.35 * np.sin(TAU * f3 * t) * np.exp(-t / (0.012 if heavy else 0.009)))
        y = 0.9 * tr + body
        d = int(rng.uniform(0.035, 0.06) * SR)
        y[d:] += 0.22 * (0.8 * tr[:n - d] + 0.5 * body[:n - d])
        if heavy:
            y *= db(2.0)
    y *= fade_env(n, 0.00015, 0.01)
    y = hp(y, 100.0)
    y /= np.max(np.abs(y)) + 1e-12
    return y * db(rng.uniform(-2.5, 2.5)) * (0.3 if space else 1.0)
