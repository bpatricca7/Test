#!/usr/bin/env python3
"""ECHO — score and sound design, synthesized from scratch.

Renders four stems (48 kHz, stereo, float32, exactly 155.0 s) to
movie/build/stems/{music,typing,signal,sfx}.wav, placing every event from
movie/build/timeline.json.

Musical design
--------------
* Tuning: the whole score is tuned so that B5 = 1000 Hz, the signal's
  bit-0 tone. The bit-1 tone (1420 Hz) then lands a slightly wide tritone
  above the tonic (F), and that "alien" interval recurs in the harmony.
* Key: B minor / B Aeolian, with Phrygian (C natural) colour for mystery,
  D major for recognition, a G -> B major (bVI -> I, Picardy) bloom for the
  emotional peak, and a suspended B (no third) for the unresolved ending.
* The "echo" motif: F# - B - C# - D (5 - 1 - 2 - b3). It is heard as
  distant bells with ping-pong echoes, resolves to D in the recognition
  scene, and is left hanging on C# at the end: the answer is not given.
* Instruments: polyBLEP detuned-saw string pads through time-varying
  low-pass filters, additive formant "choir", FM bells and plucks, an
  additive felt piano with inharmonic partials, sine sub bass, pitch-drop
  thumps for heartbeat/timpani/booms. Glue: FFT convolution reverb with a
  synthetic decaying-noise impulse response, ping-pong echoes.

Run:  python3 movie/audio/score.py
"""

import os
import sys
import time

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dsp import (SR, N, TAU, STEMS, load_timeline, hz, chord, db, tvec, ramp_db, fade_env,  # noqa: E402
                 exp_decay, smooth_noise, saw_blep, pan_gains, to_stereo, lp, hp, bp, tv_filter,
                 pink, brown, make_ir, convolve_stereo, pingpong, write_wav_float, one_pole_smooth)

TL = load_timeline()
CUES = TL["cues"]

# decode section clock: one grid row per 16th note
STEP = (TL["grid"]["fill"]["end"] - TL["grid"]["fill"]["start"]) / TL["grid"]["rows"]
K0 = TL["grid"]["fill"]["start"]


def kt(k):
    return K0 + k * STEP


# ---------------------------------------------------------------------------
# Buses: each musical segment gets its own dry / reverb-send / echo-send
# buffers, is rendered through the reverb, then gated. This lets the score
# make hard, clean cuts (53.2 s, 116.6 s) without reverb tails leaking.
# ---------------------------------------------------------------------------

class Bus:
    def __init__(self, t0, t1):
        self.t0 = t0
        self.n = int(round((t1 - t0) * SR))
        self.dry = np.zeros((2, self.n))
        self.rev = np.zeros((2, self.n))
        self.echo = np.zeros((2, self.n))

    def add(self, sig, t, gain=1.0, pan=0.0, send=0.0, echo=0.0):
        st = to_stereo(np.asarray(sig, dtype=float), pan) * gain
        s = int(round((t - self.t0) * SR))
        a, b = max(0, s), min(self.n, s + st.shape[1])
        if b <= a:
            return
        seg = st[:, a - s:b - s]
        self.dry[:, a:b] += seg
        if send:
            self.rev[:, a:b] += seg * send
        if echo:
            self.echo[:, a:b] += seg * echo

    def render(self, ir, gate=None, echo_delay=0.5, echo_fb=0.45, echo_send=0.5):
        out = self.dry.copy()
        rev = self.rev
        if np.any(self.echo):
            e = pingpong(self.echo, echo_delay, echo_fb, taps=8, lp_fc=4200.0)
            out += e
            rev = rev + e * echo_send
        if np.any(rev):
            out += convolve_stereo(rev, ir, self.n)
        if gate:
            out *= ramp_db(gate, self.n, self.t0)
        return out


def place(stem, sig, t0):
    s = int(round(t0 * SR))
    a, b = max(0, s), min(N, s + sig.shape[1])
    if b > a:
        stem[:, a:b] += sig[:, a - s:b - s]


def curve(spec, n):
    """Scalar, or [(t, value), ...] interpolated geometrically over n samples."""
    if np.isscalar(spec):
        return float(spec)
    pts = sorted(spec)
    return np.exp(np.interp(tvec(n), [p[0] for p in pts], np.log([p[1] for p in pts])))


# ---------------------------------------------------------------------------
# Instruments
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
}


def choir(notes, dur, att=1.5, rel=2.5, seed=0, vowel="a", copies=2, spread=0.7):
    """Additive 'aah' voices: harmonic series shaped by vowel formants."""
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
    """Soft FM mallet pluck for arpeggios."""
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
    """Pitch-dropping sine: heartbeat, timpani, booms."""
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
# Music, segment 1: cold -> observatory -> signal (hard cut at 53.2)
# ---------------------------------------------------------------------------

def music_seg1(ir):
    cut = CUES["silence"]
    bus = Bus(0.0, cut + 1.0)
    n = bus.n
    t = tvec(n)

    # sub drone creeping in from black: B0 + B1 with a slow 0.25 Hz beat
    f1, f0 = hz("B1"), hz("B0")
    drone = (0.55 * np.sin(TAU * f1 * t) + 0.25 * np.sin(TAU * f1 * 1.004 * t + 1.0)
             + 0.45 * np.sin(TAU * f0 * t) + 0.08 * np.sin(TAU * 2 * f1 * t + 0.4)
             + 0.03 * np.sin(TAU * 3 * f1 * t))
    drone *= ramp_db([(0, -110), (0.6, -70), (4, -42), (9, -34), (12.5, -31), (20, -30),
                      (33.5, -29), (45, -26), (cut, -22)], n)
    bus.add(drone, 0.0, send=0.05)

    # observatory: wide, cold, beautiful string pads (voice-led, long crossfades)
    obs = [
        (12.5, "B2 F#3 D4 A4 C#5", "B1", 6.3, 3.5),
        (17.75, "G2 D3 B3 F#4 A4", "G1", 6.3, 2.2),
        (23.0, "E2 B2 G3 D4 F#4 B4", "E1", 6.3, 2.2),
        (28.25, "F#2 C#3 B3 E4 C#5", "F#1", 3.8, 2.0),
        (31.0, "F#2 C#3 A#3 E4 C#5", "F#1", 4.0, 1.4),
    ]
    for i, (t0, spec, bass, dur, att) in enumerate(obs):
        p = pad(chord(spec), dur + 1.5, att=att, rel=2.6, voices=5, detune=9, seed=100 + i,
                fc=[(0, 650), (dur * 0.6, 1500), (dur + 1.5, 900)])
        bus.add(p, t0, gain=db(-17), send=0.6)
        bus.add(sub(hz(bass), dur + 1.5, 2.0, 2.4), t0, gain=db(-27), send=0.05)
        top = [2 * hz(x) for x in spec.split()[-2:]]
        bus.add(choir(top, dur + 1.5, att=att + 0.5, rel=2.6, seed=200 + i, vowel="o"), t0,
                gain=db(-30), send=0.9)

    # distant bells: the echo motif, answered by its own echoes
    bells = [(13.9, "F#5"), (14.75, "B5"), (15.6, "C#6"), (16.45, "D6"),
             (21.6, "A5"), (22.3, "F#5"), (23.3, "E5"), (24.1, "D5"),
             (28.6, "F#5"), (29.45, "B5"), (30.3, "C#6"), (31.3, "A#5")]
    for i, (tt, note) in enumerate(bells):
        bus.add(bell(hz(note), 4.0, decay=1.6), tt, gain=db(-27), pan=0.35 * (-1) ** i,
                send=0.5, echo=0.45)

    # signal: a dark B pedal whose filter opens as the pulses accelerate
    s0 = CUES["signal_on"]
    dur = cut - s0 + 0.2
    p = pad(chord("B1 F#2 B2 F#3"), dur, att=2.5, rel=0.05, voices=6, detune=14, seed=300, q=1.1,
            fc=[(0, 240), (8, 420), (14, 900), (17.5, 2200), (dur, 4200)])
    p *= ramp_db([(0, -24), (6, -22), (12, -19), (17, -14), (dur, -9)], p.shape[1])
    bus.add(p, s0, send=0.35)

    # tension cluster: B / C / F / F# tremolo strings (the tritone of the signal)
    c0 = 40.0
    dur = cut - c0 + 0.2
    p = pad(chord("B3 C4 F4 F#4 C5"), dur, att=4.0, rel=0.05, voices=4, detune=16, seed=301, q=0.9,
            fc=[(0, 700), (dur * 0.7, 2000), (dur, 5000)], trem=([(0, 5.0), (dur, 17.0)], 0.55))
    p *= ramp_db([(0, -34), (7, -28), (11, -21), (dur, -13)], p.shape[1])
    bus.add(p, c0, send=0.45)

    # accelerating low pulses, one per eight signal pulses, merging into a growl
    times = TL["pulses"]["times"]
    for i in range(0, len(times), 8):
        tt = times[i]
        nxt = times[i + 8] if i + 8 < len(times) else tt + 8 * (times[-1] - times[-2])
        iv = nxt - tt
        dec = min(0.4, 1.3 * iv)
        g = -30 + 14.0 * (tt - 35.0) / 18.0
        th = thump(hz("B2"), hz("B1"), min(1.6, dec * 5), tau_pitch=0.03, tau_amp=dec, noise=0.1, seed=i)
        bus.add(th, tt, gain=db(g), send=0.12)

    # a slow Shepard rise under the last seconds
    r0 = 46.5
    dur = cut - r0 + 0.1
    sr = shepard_rise(dur, hz("B2"), seed=302, fc=(700, 6000))
    sr *= ramp_db([(0, -46), (dur * 0.7, -30), (dur, -19)], sr.shape[1])
    bus.add(sr, r0, send=0.4)

    gate = [(0, 0), (cut - 0.02, 0), (cut + 0.03, -34), (cut + 0.9, -120)]
    return bus.render(ir, gate=gate, echo_delay=0.62, echo_fb=0.5)


# ---------------------------------------------------------------------------
# Music, segment 2: after the silence -> decode -> recognition
# ---------------------------------------------------------------------------

DECODE = [  # (k_start, pad, arp tones, bass root)
    (-48, "B2 F#3 C#4 D4", "B3 D4 F#4 C#5 D5 F#5", "B1"),
    (-16, "G2 D3 B3 F#4 C#5", "G3 B3 D4 F#4 B4 C#5", "G1"),
    (16, "E2 B2 G3 D4 F#4", "E4 G4 B4 D5 F#5 G5", "E1"),
    (48, "C3 G3 B3 E4 F#4", "C4 E4 G4 B4 E5 F#5", "C2"),
    (80, "F#2 C#3 B3 E4", "F#3 C#4 E4 B4 C#5 E5", "F#1"),
    (96, "F#2 C#3 A#3 E4", "F#3 C#4 E4 A#4 C#5", "F#1"),
]
ARP = [0, 2, 4, 5, 3, 1, 4, 2, 0, 3, 5, 4, 2, 1, 3, 5]


def arp_every(k):
    if k < -32:
        return 4
    if k < 80:
        return 2
    return 4


def arp_gain(k):
    return float(np.interp(k, [-48, -32, 0, 48, 73, 90, 104], [-32, -29, -26, -22, -21, -26, -40]))


def music_seg2(ir):
    t_start = CUES["silence"]
    t_end = CUES["came_back_in_52"] + 0.1
    bus = Bus(t_start, t_end)

    # the ear still rings at 1000 Hz after the signal stops
    ring = np.sin(TAU * hz("B5") * tvec(int(5.0 * SR))) * fade_env(int(5.0 * SR), 1.4, 2.8)
    bus.add(ring, 53.7, gain=db(-50), send=0.6)
    bus.add(sub(hz("B0"), 6.0, 2.5, 2.0), 54.8, gain=db(-30))

    # ---- decode: pads on the grid clock, with an 8th-note pump
    for i, (k, spec, arp, root) in enumerate(DECODE):
        k_end = DECODE[i + 1][0] if i + 1 < len(DECODE) else 104
        t0, t1 = kt(k), kt(k_end)
        dur = t1 - t0 + 1.6
        p = pad(chord(spec), dur, att=1.8 if i else 2.8, rel=1.6, voices=5, detune=8, seed=400 + i,
                fc=[(0, 700), (dur * 0.5, 1300), (dur, 800)], q=0.9)
        tt = tvec(p.shape[1], t0)
        phase = np.mod(tt - K0, 2 * STEP)
        pump = 1.0 - 0.3 * np.exp(-phase / 0.09) if k >= -16 else 1.0
        bus.add(p * pump, t0, gain=db([-23.5, -22, -20.5, -18.5, -19, -20][i]), send=0.45)
        bus.add(sub(hz(root), dur, 0.8, 1.4), t0, gain=db(-28))

        # arpeggio
        tones = [hz(x) for x in arp.split()]
        for kk in range(k, k_end):
            if kk < -48 or (kk - (-48)) % arp_every(kk):
                continue
            f = tones[ARP[(kk + 48) % 16] % len(tones)]
            bus.add(pluck(f, 0.9, decay=0.32), kt(kk), gain=db(arp_gain(kk)),
                    pan=0.4 * np.sin(kk * 0.7), send=0.3, echo=0.18)
        # pulsing bass on 8ths
        if k >= -16:
            for kk in range(k, min(k_end, 100), 2):
                g = -27 if kk % 4 == 0 else -31
                bs = pad([hz(root) * 2], 0.32, att=0.004, rel=0.2, voices=2, detune=6, seed=kk + 999,
                         fc=[(0, 900), (0.32, 180)], spread=0.1)
                bus.add(bs, kt(kk), gain=db(g + float(np.interp(kk, [-16, 60, 96, 100], [0, 2, 0, -8]))),
                        send=0.05)

    # upper counter-line from k=48: bell 16ths on the off-steps
    for kk in range(49, 80, 2):
        tones = [hz(x) for x in DECODE[3][2].split()] if kk < 80 else [hz(x) for x in DECODE[4][2].split()]
        f = 2 * tones[ARP[(kk * 3) % 16] % len(tones)]
        bus.add(bell(f, 1.2, decay=0.35, idx=1.0), kt(kk), gain=db(-37), pan=-0.4 * np.sin(kk * 0.5),
                send=0.3, echo=0.2)

    # the motif on bells, then a variation in the Phrygian colour
    for kk, note in [(16, "F#5"), (20, "B5"), (24, "C#6"), (28, "D6"),
                     (48, "E6"), (52, "F#6"), (56, "B5"), (60, "G5")]:
        bus.add(bell(hz(note), 3.5, decay=1.4), kt(kk), gain=db(-28), pan=0.3, send=0.5, echo=0.35)

    # grid complete: a soft chime and a low swell
    for j, note in enumerate(["B5", "D6", "F#6", "B6"]):
        bus.add(bell(hz(note), 5.0, decay=2.2, idx=0.9), 77.0 + 0.045 * j, gain=db(-29),
                pan=-0.3 + 0.2 * j, send=0.7, echo=0.3)
    bus.add(sub(hz("B1"), 4.0, 0.3, 3.0), 77.0, gain=db(-27))

    # ---- recognition: warm strings, the motif resolves to D
    rec = [
        (82.0, "D2 A2 F#3 C#4 E4 A4", "D1", 3.5),
        (85.5, "G2 D3 B3 F#4 A4 D5", "G1", 4.0),
        (89.5, "E2 B2 G3 D4 F#4 B4", "E1", 5.0),
        (94.5, "Bb1 Bb2 G3 D4 E4 G4", "Bb1", 3.0),
        (97.5, "F#2 C#3 B3 E4 C#5", "F#1", 1.1),
        (98.6, "F#2 C#3 A#3 E4 C#5", "F#1", 2.0),
    ]
    gains = [-20, -19.5, -19, -18, -16.5, -15.5]
    for i, (t0, spec, bass, dur) in enumerate(rec):
        p = pad(chord(spec), dur + 2.4, att=1.6 if i else 2.2, rel=2.4, voices=6, detune=9, seed=500 + i,
                fc=[(0, 1100), (dur, 2400), (dur + 2.4, 1500)])
        bus.add(p, t0, gain=db(gains[i]), send=0.55)
        bus.add(sub(hz(bass), dur + 2.4, 1.2, 2.0), t0, gain=db(-25))
        # soft rolled piano chord
        for j, note in enumerate(spec.split()[1:4]):
            bus.add(piano(hz(note), 4.0, vel=0.35, seed=600 + i * 10 + j), t0 + 0.04 * j,
                    gain=db(-27), pan=-0.2 + 0.2 * j, send=0.4)
        if i >= 2:
            bus.add(choir(chord(" ".join(spec.split()[-3:])), dur + 2.4, att=2.0, rel=2.4, seed=650 + i),
                    t0, gain=db(-27), send=0.8)

    melody = [(83.9, "F#4", 0.55), (84.55, "B4", 0.55), (85.2, "C#5", 0.6), (85.85, "D5", 0.7),
              (87.8, "E5", 0.55), (88.45, "D5", 0.5), (89.1, "B4", 0.6),
              (91.2, "A4", 0.5), (91.85, "B4", 0.5), (92.5, "F#4", 0.55),
              (94.5, "D5", 0.6), (95.3, "Bb4", 0.65), (96.5, "A4", 0.5),
              (97.6, "C#5", 0.6), (98.2, "B4", 0.6), (98.8, "A#4", 0.7)]
    for i, (tt, note, vel) in enumerate(melody):
        bus.add(piano(hz(note), 4.5, vel=vel, seed=700 + i), tt, gain=db(-17), pan=0.1, send=0.45, echo=0.12)
        if note in ("D5", "B4") and tt < 90:
            bus.add(bell(2 * hz(note), 3.0, decay=1.2, idx=0.8), tt, gain=db(-35), pan=-0.3, send=0.6)

    cue = CUES["came_back_in_52"]
    gate = [(t_start, -120), (t_start + 0.05, 0), (cue - 1.4, 0), (cue - 0.2, -40), (cue - 0.05, -120)]
    return bus.render(ir, gate=gate, echo_delay=2 * STEP * 2, echo_fb=0.42)


# ---------------------------------------------------------------------------
# Music, segment 3: heartbeat -> difference -> zoom riser (cut for the voice)
# ---------------------------------------------------------------------------

def music_seg3(ir):
    cue = CUES["came_back_in_52"]
    t_cut = TL["zoom"]["end"] + 0.1
    bus = Bus(cue - 0.9, t_cut + 0.3)

    # heartbeat: lub-dub sub pulse under "It came back in 52."
    beats = [cue + 0.95 * i for i in range(6)]
    beat_gain = [-11, -11, -12, -13, -16, -22]
    for i, tb in enumerate(beats):
        bus.add(thump(78, 46, 0.7, tau_pitch=0.035, tau_amp=0.15, noise=0.12, seed=800 + i), tb,
                gain=db(beat_gain[i]), send=0.1)
        bus.add(thump(70, 44, 0.6, tau_pitch=0.03, tau_amp=0.12, noise=0.08, seed=810 + i), tb + 0.27,
                gain=db(beat_gain[i] - 5), send=0.1)
    # a whisper of air above it
    bus.add(np.sin(TAU * hz("F#6") * tvec(int(4.5 * SR))) * fade_env(int(4.5 * SR), 1.5, 2.0),
            cue, gain=db(-58), send=0.8)

    # difference: dark dissonant bed (B / C / F), then the reveal stab
    d0 = CUES["recognition"] + 22.0  # 104.0
    dur = t_cut - d0
    p = pad(chord("B1 C2 F2 B2"), dur, att=2.5, rel=0.05, voices=5, detune=12, seed=900, q=1.0,
            fc=[(0, 200), (6.0, 380), (9.0, 500), (dur - 3.1, 600), (dur, 3000)])
    p *= ramp_db([(0, -26), (6, -22), (9.0, -20), (dur - 3.1, -20), (dur, -10)], p.shape[1])
    bus.add(p, d0, send=0.35)
    bus.add(sub(hz("B0"), dur, 3.0, 0.05), d0, gain=db(-27))

    # high tremolo cluster: "Except it isn't the same picture."
    h0 = 106.6
    dur = t_cut - h0
    p = pad(chord("B4 C5 F5"), dur, att=2.5, rel=0.05, voices=3, detune=10, seed=901,
            fc=[(0, 1800), (dur, 6000)], trem=([(0, 7.0), (dur - 3.1, 9.0), (dur, 22.0)], 0.6))
    p *= ramp_db([(0, -40), (3.4, -34), (dur - 3.1, -32), (dur, -17)], p.shape[1])
    bus.add(p, h0, send=0.6, pan=0.15)

    # "Someone added themselves." — brassy dissonant stab + timpani
    rv = CUES["reveal"]
    st = pad(chord("B1 B2 F3 G#3 C4 F4"), 3.2, att=0.012, rel=2.8, voices=6, detune=14, seed=902, q=1.3,
             fc=[(0, 400), (0.08, 3500), (0.6, 1200), (3.2, 350)])
    bus.add(st, rv, gain=db(-13), send=0.7)
    bus.add(thump(110, 52, 3.0, tau_pitch=0.06, tau_amp=0.9, noise=0.3, seed=903), rv, gain=db(-14), send=0.5)

    # after the reveal: slow tritone pulse B1 / F2
    for i, tb in enumerate(np.arange(rv + 1.3, 113.4, 0.66)):
        note = "B1" if i % 2 == 0 else "F2"
        bus.add(thump(hz(note) * 1.5, hz(note), 0.9, tau_pitch=0.03, tau_amp=0.3, noise=0.05, seed=920 + i),
                tb, gain=db(-22), send=0.2)

    # zoom: accelerating heartbeat + Shepard rise + everything opens, then cut
    z0, z1 = TL["zoom"]["start"], TL["zoom"]["end"]
    tb, iv, i = z0, 0.62, 0
    while tb < z1 - 0.05:
        g = -19 + 9 * (tb - z0) / (z1 - z0)
        bus.add(thump(90, 48, 0.5, tau_pitch=0.03, tau_amp=0.1 + 0.05 * iv, noise=0.12, seed=940 + i),
                tb, gain=db(g), send=0.15)
        tb += iv
        iv = max(0.11, iv * 0.86)
        i += 1
    dur = t_cut - z0
    sr = shepard_rise(dur, hz("B2"), layers=6, seed=950, fc=(800, 7500))
    sr *= ramp_db([(0, -38), (dur * 0.6, -24), (dur, -11)], sr.shape[1])
    bus.add(sr, z0, send=0.4)

    gate = [(bus.t0, 0), (t_cut - 0.1, 0), (t_cut - 0.03, -120)]
    return bus.render(ir, gate=gate)


# ---------------------------------------------------------------------------
# Music, segment 4: room for the voice, then the bloom (peak of the film)
# ---------------------------------------------------------------------------

def music_seg4(ir):
    v = CUES["voice"]
    t0 = TL["zoom"]["end"] + 0.1
    bus = Bus(t0, 126.4)

    # almost nothing under the voice: a low G pedal and a glint of air
    bus.add(sub(hz("G1"), 3.0, 1.2, 0.8), v + 0.2, gain=db(-40))
    bus.add(np.sin(TAU * hz("D6") * tvec(int(2.5 * SR))) * fade_env(int(2.5 * SR), 1.2, 1.0), v + 0.3,
            gain=db(-56), send=0.9)

    b0 = v + 2.1  # 119.1: the swell begins as the last word ends
    b1 = b0 + 2.4  # 121.5: bVI -> I (B major)
    # G major 9: strings, choir, low brass, sub, timpani, a cascade of bells
    st = pad(chord("G2 D3 B3 F#4 A4 D5 B5"), b1 - b0 + 2.6, att=1.1, rel=2.4, voices=7, detune=11,
             seed=1000, spread=0.95, fc=[(0, 700), (1.2, 4200), (3.5, 3000)])
    bus.add(st, b0, gain=db(-7.5), send=0.6)
    bus.add(choir(chord("G3 B3 D4 F#4 A4 D5"), b1 - b0 + 2.6, att=1.3, rel=2.4, seed=1001),
            b0, gain=db(-11), send=0.8)
    br = pad(chord("G1 G2 D3"), b1 - b0 + 2.4, att=0.9, rel=2.2, voices=4, detune=7, seed=1002, q=0.9,
             fc=[(0, 250), (1.0, 900), (3.0, 500)], spread=0.3)
    bus.add(br, b0, gain=db(-10), send=0.4)
    bus.add(sub(hz("G1"), b1 - b0 + 2.4, 0.9, 2.2), b0, gain=db(-16))
    bus.add(thump(98, 49, 3.5, tau_pitch=0.07, tau_amp=1.1, noise=0.25, seed=1003), b0 + 0.05,
            gain=db(-15), send=0.5)
    for j, note in enumerate(["G5", "B5", "D6", "F#6", "A6", "B6"]):
        bus.add(bell(hz(note), 4.0, decay=1.8, idx=1.0), b0 + 0.35 + 0.17 * j, gain=db(-25),
                pan=-0.6 + 0.24 * j, send=0.6, echo=0.35)

    # B major (Picardy): awe, decaying into the fade to black
    dur = 126.4 - b1
    st = pad(chord("B2 F#3 D#4 F#4 C#5 D#5 B5"), dur, att=0.9, rel=3.8, voices=7, detune=11, seed=1010,
             spread=0.95, fc=[(0, 2500), (1.5, 3800), (dur, 900)])
    bus.add(st, b1, gain=db(-9.5), send=0.65)
    bus.add(choir(chord("B3 D#4 F#4 C#5 D#5 F#5"), dur, att=1.0, rel=3.8, seed=1011), b1, gain=db(-12), send=0.85)
    br = pad(chord("B1 B2 F#3"), dur, att=0.8, rel=3.6, voices=4, detune=7, seed=1012, q=0.9,
             fc=[(0, 400), (1.0, 900), (dur, 300)], spread=0.3)
    bus.add(br, b1, gain=db(-11), send=0.4)
    bus.add(sub(hz("B1"), dur, 0.8, 3.6), b1, gain=db(-16))
    for j, note in enumerate(["B5", "D#6", "F#6", "C#7"]):
        bus.add(bell(hz(note), 4.0, decay=2.0, idx=0.8), b1 + 0.1 + 0.21 * j, gain=db(-27),
                pan=0.5 - 0.3 * j, send=0.7, echo=0.35)

    fb = CUES["fade_to_black"]
    gate = [(t0, -120), (t0 + 0.05, 0), (fb, 0), (125.0, -8), (126.0, -40), (126.3, -120)]
    return bus.render(ir, gate=gate, echo_delay=0.41, echo_fb=0.45)


# ---------------------------------------------------------------------------
# Music, segment 5: ending, title, credits
# ---------------------------------------------------------------------------

def music_seg5(ir):
    t0 = 125.8
    bus = Bus(t0, 155.0)
    title = TL["title_card"]["start"]

    chords5 = [
        (126.0, "G2 D3 B3 F#4", "G1", 5.0, -25, 2.8),
        (131.0, "F#2 D3 A3 E4", "D2", 4.5, -25, 2.0),
        (135.5, "A1 A2 E3 B3 E4", "A1", 3.0, -24, 2.0),
        (title, "B1 B2 F#3 C#4 F#4 B4", "B1", 8.0, -21, 1.8),
        (146.5, "G1 G2 D3 A3 B3 F#4", "G1", 4.0, -24, 2.2),
        (150.5, "B1 B2 F#3 C#4 F#4", "B1", 4.3, -25, 2.2),
    ]
    for i, (tt, spec, bass, dur, g, att) in enumerate(chords5):
        rel = 2.6 if i < len(chords5) - 1 else 3.5
        p = pad(chord(spec), dur + rel * 0.8, att=att, rel=rel, voices=5, detune=9, seed=1100 + i,
                fc=[(0, 700), (dur * 0.5, 1300), (dur + rel, 700)])
        bus.add(p, tt, gain=db(g), send=0.6)
        bus.add(sub(hz(bass), dur + rel * 0.8, 1.5, rel), tt, gain=db(-28 if i != 3 else -24))
        if i in (3, 5):
            bus.add(choir(chord("B3 F#4 C#5"), dur + rel * 0.8, att=2.5, rel=rel, seed=1150 + i, vowel="o"),
                    tt, gain=db(-26), send=0.9)

    # the motif, never finished: F# - B - C# ... (no answer yet)
    melody = [(126.4, "F#4", 0.5), (127.1, "B4", 0.5), (127.8, "C#5", 0.55),
              (130.0, "G3", 0.3), (130.25, "D4", 0.3), (130.5, "B4", 0.35),
              (132.6, "E5", 0.5), (133.3, "D5", 0.45), (134.0, "C#5", 0.5), (135.2, "A4", 0.45),
              (136.4, "B4", 0.45), (137.0, "C#5", 0.5),
              (140.4, "F#5", 0.4), (141.1, "B5", 0.4), (141.8, "C#6", 0.45),
              (147.0, "F#4", 0.45), (147.7, "B4", 0.45), (148.4, "C#5", 0.5),
              (150.6, "B3", 0.35), (150.9, "F#4", 0.35)]
    for i, (tt, note, vel) in enumerate(melody):
        bus.add(piano(hz(note), 5.0, vel=vel, seed=1200 + i), tt, gain=db(-18), pan=0.12,
                send=0.5, echo=0.2)

    gate = [(t0, 0), (152.0, 0), (153.8, -24), (154.85, -120)]
    return bus.render(ir, gate=gate, echo_delay=0.7, echo_fb=0.45)


MUSIC_TRIM_DB = -4.5


def render_music(ir):
    out = np.zeros((2, N))
    for name, fn in [("seg1", music_seg1), ("seg2", music_seg2), ("seg3", music_seg3),
                     ("seg4", music_seg4), ("seg5", music_seg5)]:
        t = time.time()
        seg = fn(ir)
        start = {"seg1": 0.0, "seg2": CUES["silence"], "seg3": CUES["came_back_in_52"] - 0.9,
                 "seg4": TL["zoom"]["end"] + 0.1, "seg5": 125.8}[name]
        place(out, seg * db(MUSIC_TRIM_DB), start)
        print(f"  music {name}: {time.time() - t:5.1f}s")
    return out


# ---------------------------------------------------------------------------
# Typing: one keystroke per character
# ---------------------------------------------------------------------------

SLOT_PAN = {"center": 0.0, "center-high": 0.0, "lower": 0.0}


def key_click(rng, heavy=False, space=False):
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
        d = int(rng.uniform(0.035, 0.06) * SR)  # key release, much softer
        y[d:] += 0.22 * (0.8 * tr[:n - d] + 0.5 * body[:n - d])
        if heavy:
            y *= db(2.0)
    y *= fade_env(n, 0.00015, 0.01)
    y = hp(y, 100.0)
    y /= np.max(np.abs(y)) + 1e-12
    return y * db(rng.uniform(-2.5, 2.5)) * (0.3 if space else 1.0)


def render_typing(room_ir):
    rng = np.random.default_rng(7)
    out = np.zeros((2, N))
    wet = np.zeros((2, N))
    for cue in TL["text"]:
        base_pan = SLOT_PAN.get(cue["slot"], 0.18)
        heavy = cue.get("style") == "emph"
        for ch, tt in zip(cue["text"], cue["char_times"]):
            y = key_click(rng, heavy=heavy, space=(ch == " "))
            st = to_stereo(y, float(np.clip(base_pan + rng.uniform(-0.22, 0.22), -1, 1))) * 0.45
            place(out, st, tt)
            place(wet, st * 0.35, tt)
    out += convolve_stereo(wet, room_ir, N)
    return out


# ---------------------------------------------------------------------------
# Signal: 1,679 FSK pulses through a radio receiver
# ---------------------------------------------------------------------------

def render_signal(room_ir):
    rng = np.random.default_rng(1679)
    P = TL["pulses"]
    times = np.array(P["times"])
    bits = np.array(P["bits"])
    f_one, f_zero = P["freq_one"], P["freq_zero"]
    r0, r1 = CUES["signal_on"], CUES["silence"]
    t_a = r0 - 0.1
    n = int((r1 + 0.6 - t_a) * SR)
    x = np.zeros(n)

    iv = np.diff(times)
    iv = np.append(iv, iv[-1])
    lengths = np.minimum(0.09, 0.6 * iv)
    for tt, b, L in zip(times, bits, lengths):
        f = f_one if b else f_zero
        s = int(np.ceil((tt - t_a) * SR))
        m = int(L * SR)
        tk = (s + np.arange(m)) / SR - (tt - t_a)
        a = min(int(0.006 * SR), m // 2)
        env = np.ones(m)
        ramp = 0.5 - 0.5 * np.cos(np.linspace(0, np.pi, a + 2)[1:-1])
        env[:a] = ramp
        env[m - a:] = ramp[::-1]
        x[s:s + m] += 0.5 * np.sin(TAU * f * tk) * env

    # the stream: as pulses blur together, a continuous-phase FSK warble
    tt = t_a + np.arange(n) / SR
    idx = np.searchsorted(times, tt, side="right") - 1
    after = tt > times[-1]
    idx[after] = (len(times) - 1 + ((tt[after] - times[-1]) / iv[-1]).astype(int)) % len(times)
    idx = np.clip(idx, 0, len(times) - 1)
    finst = np.where(bits[idx] == 1, f_one, f_zero).astype(float)
    finst = one_pole_smooth(finst, 0.00025)
    stream = np.sin(TAU * np.cumsum(finst) / SR)
    stream *= ramp_db([(t_a, -120), (47.0, -120), (49.5, -24), (52.0, -12), (r1, -6)], n, t_a)
    x += 0.5 * stream

    # gentle rise in level as the rate climbs
    x *= ramp_db([(t_a, -3), (45, -2), (r1, 0)], n, t_a)

    # --- radio treatment: multipath, band-limit, saturation, noise, fading
    d = int(0.0023 * SR)
    x[d:] += 0.22 * x[:-d]
    x = bp(x, 280.0, 3300.0, order=3)
    x = np.tanh(1.6 * x) / np.tanh(1.6)
    x = bp(x, 300.0, 3600.0, order=2)
    fading = 0.72 + 0.28 * smooth_noise(n, 0.9, rng)
    x *= fading

    static = bp(rng.standard_normal(n), 300.0, 3400.0, order=2)
    static *= 0.6 + 0.4 * smooth_noise(n, 1.7, rng)
    crack = np.zeros(n)
    k = rng.poisson(6 * n / SR)
    crack[rng.integers(0, n, k)] = rng.lognormal(0, 0.8, k) * rng.choice([-1, 1], k)
    static += bp(crack, 800.0, 5000.0) * 4.0
    static *= ramp_db([(t_a, -120), (r0, -120), (r0 + 0.4, -30), (45, -31), (r1, -27)], n, t_a)
    x += static

    gate = ramp_db([(t_a, -120), (r0 - 0.02, -120), (r0 + 0.02, 0), (r1 - 0.015, 0), (r1 + 0.025, -120)], n, t_a)
    x *= gate

    st = np.stack([x, x])
    # a hint of width: very short decorrelation + tiny room
    st[1] = np.roll(st[1], int(0.0004 * SR))
    st = st + 0.12 * convolve_stereo(st, room_ir, n)
    st *= gate  # keep the cut at 53.2 hard, even for the room
    out = np.zeros((2, N))
    place(out, st, t_a)
    return out


# ---------------------------------------------------------------------------
# SFX & ambience
# ---------------------------------------------------------------------------

def noise_sweep(dur, f0, f1, q, rng, kind="bp", stereo=True, pink_src=True):
    n = int(dur * SR)
    src = pink((2, n), rng) if pink_src else rng.standard_normal((2, n))
    fc = np.exp(np.linspace(np.log(f0), np.log(f1), n))
    y = tv_filter(src, fc, q, kind=kind)
    if not stereo:
        y = np.stack([y[0], y[0]])
    return y


def reverse_swell(dur, rng, f0=400.0, f1=7000.0):
    n = int(dur * SR)
    t = tvec(n)
    y = noise_sweep(dur, f0, f1, 0.8, rng, kind="lp")
    env = np.exp((t - dur) / (dur / 4.5))
    env[-int(0.012 * SR):] *= np.linspace(1, 0, int(0.012 * SR))
    return y * env


def boom(dur=8.0, f0=72.0, f1=27.0, seed=0):
    rng = np.random.default_rng(seed)
    n = int(dur * SR)
    t = tvec(n)
    freq = f1 + (f0 - f1) * np.exp(-t / 0.35)
    ph = np.cumsum(freq) / SR
    y = np.sin(TAU * ph) * np.exp(-t / 2.2)
    y += 0.35 * np.sin(TAU * 2 * ph + 0.3) * np.exp(-t / 0.6)
    y += 0.7 * lp(rng.standard_normal(n), 170.0, order=2) * np.exp(-t / 0.7)
    y += 0.25 * bp(rng.standard_normal(n), 700.0, 3500.0) * np.exp(-t / 0.02)
    y = np.tanh(1.4 * y) / np.tanh(1.4)
    return y * fade_env(n, 0.003, 1.0)


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


def tick(f, rng, empty=False):
    n = int(0.12 * SR)
    t = tvec(n)
    tr = hp(rng.standard_normal(n), 3000.0) * np.exp(-t / 0.0005) * 0.25
    if empty:
        y = 0.4 * np.sin(TAU * 260 * t) * np.exp(-t / 0.01) + tr
        return y * fade_env(n, 0.0003, 0.02) * 0.45
    y = np.sin(TAU * f * t) * np.exp(-t / 0.03) + 0.22 * np.sin(TAU * 2 * f * t) * np.exp(-t / 0.012)
    return (y + tr) * fade_env(n, 0.0006, 0.02)


def render_sfx(hall_ir, room_ir):
    rng = np.random.default_rng(2024)
    out = np.zeros((2, N))
    send = np.zeros((2, N))   # -> hall
    rsend = np.zeros((2, N))  # -> room

    def add(sig, t0, gain=1.0, pan=0.0, hall=0.0, room=0.0):
        st = to_stereo(sig, pan) * gain
        place(out, st, t0)
        if hall:
            place(send, st * hall, t0)
        if room:
            place(rsend, st * room, t0)

    # radio hiss bed: crackly in the cold open, then a faint room tone
    hiss = bp(rng.standard_normal((2, N)), 1200.0, 9000.0, order=2)
    qsb = smooth_noise(N, 0.6, rng, 0.55, 1.0)
    crack = np.zeros(N)
    cr_n = int(4.0 * 12.0)
    pos = rng.integers(int(0.6 * SR), int(12.3 * SR), cr_n)
    crack[pos] = rng.lognormal(0, 0.9, cr_n) * rng.choice([-1, 1], cr_n)
    crack = bp(crack, 900.0, 6000.0) * 3.0
    hiss = hiss * qsb + np.stack([crack, crack * 0.8])
    silence = CUES["silence"]
    hiss *= ramp_db([(0, -110), (0.8, -50), (6.0, -49), (12.5, -52), (16.0, -62), (33.5, -63),
                     (silence, -63), (silence + 0.03, -76), (56.0, -70), (100.0, -70), (101.0, -67),
                     (104.0, -70), (126.0, -71), (150.0, -72), (154.9, -120)], N)
    out += hiss

    # wind for the observatory: pink band-pass with a wandering centre + brown rumble + a thin whistle
    w0, w1 = 12.3, 37.0
    n = int((w1 - w0) * SR)
    src = pink((2, n), rng)
    centre = 330 + 520 * smooth_noise(n, 0.12, rng)
    wind = tv_filter(src, centre, 0.9, kind="bp")
    wind += 0.6 * lp(brown((2, n), rng), 220.0)
    whistle = tv_filter(rng.standard_normal((2, n)), 1150 + 350 * smooth_noise(n, 0.1, rng), 9.0, kind="bp")
    wind += 0.25 * whistle * smooth_noise(n, 0.2, rng, 0.0, 1.0)
    gust = 0.35 + 0.65 * smooth_noise(n, 0.18, rng) ** 1.5
    wind *= gust
    wind *= ramp_db([(w0, -120), (12.5, -60), (15.5, -31), (28, -31), (33.5, -37), (35.5, -48), (w1, -120)], n, w0)
    add(wind, w0, hall=0.15)

    # riser into the silence
    r0 = 45.5
    rs = noise_sweep(silence - r0, 300.0, 7000.0, 1.8, rng)
    rs *= ramp_db([(0, -60), (4.0, -44), (silence - r0 - 0.6, -25), (silence - r0, -20)], rs.shape[1])
    rs[:, -int(0.02 * SR):] *= np.linspace(1, 0, int(0.02 * SR))
    add(rs, r0)

    # grid ticks: one per row, pitch from how many bits are lit (B minor pentatonic)
    rows = TL["grid"]["returned"]
    penta = [0, 3, 5, 7, 10]
    for r, (tt, row) in enumerate(zip(TL["grid"]["row_times"], rows)):
        c = sum(row)
        if c == 0:
            add(tick(0, rng, empty=True), tt, gain=db(-26), room=0.5)
            continue
        j = min(c, 13)
        semis = 12 * (j // 5) + penta[j % 5]
        f = hz("B4") * 2 ** (semis / 12)
        xs = [x for x, b in enumerate(row) if b]
        pan = (np.mean(xs) / 22.0 - 0.5) * 0.9
        add(tick(f, rng), tt, gain=db(-22 - 2.5 * j / 13), pan=pan, room=0.5, hall=0.12)

    # grid moves: a soft air whoosh
    g0, g1 = TL["grid"]["move"]["start"], TL["grid"]["move"]["end"]
    ws = noise_sweep(g1 - g0, 350.0, 1600.0, 1.2, rng)
    m = ws.shape[1]
    ws *= np.sin(np.linspace(0, np.pi, m)) ** 2 * db(-30)
    add(ws, g0, hall=0.3)

    # scan: resonant filtered-noise sweep + faint scanning flutter
    s0, s1 = TL["scan"]["start"], TL["scan"]["end"]
    ds = s1 - s0
    sw = noise_sweep(ds, 350.0, 5200.0, 6.0, rng)
    sw += 0.4 * noise_sweep(ds, 700.0, 10400.0, 3.0, rng)
    m = sw.shape[1]
    tt = tvec(m)
    sw *= 0.8 + 0.2 * np.sin(TAU * 28.0 * tt)
    sw *= fade_env(m, 0.08, 0.25) * db(-20)
    sw[0] *= np.linspace(1.15, 0.85, m)
    sw[1] *= np.linspace(0.85, 1.15, m)
    add(sw, s0, hall=0.25)

    # differing rows flash as the scanline passes: soft 1420 Hz blips (the "1" tone)
    sent, ret = TL["grid"]["sent"], TL["grid"]["returned"]
    nrows = len(ret)
    for r in range(nrows):
        diff = [x for x in range(len(ret[r])) if ret[r][x] != sent[r][x]]
        if not diff:
            continue
        tb = s0 + (r + 0.5) / nrows * ds
        nb = int(0.12 * SR)
        tv = tvec(nb)
        y = (np.sin(TAU * 1420.0 * tv) + 0.6 * np.sin(TAU * 1427.0 * tv)) * np.exp(-tv / 0.035)
        y *= fade_env(nb, 0.002, 0.03)
        pan = (np.mean(diff) / 22.0 - 0.5) * 0.9
        add(y, tb, gain=db(-30 + min(4, len(diff))), pan=pan, room=0.4, hall=0.2)

    # reveal impact at 110
    rv = CUES["reveal"]
    add(reverse_swell(0.9, rng, 300, 4000) * db(-30), rv - 0.9)
    add(boom(6.0, 80.0, 34.0, seed=11), rv, gain=db(-15), hall=0.35)

    # zoom riser (cut just before the voice)
    z0, z1 = TL["zoom"]["start"], TL["zoom"]["end"]
    zr = noise_sweep(z1 + 0.1 - z0, 250.0, 9000.0, 1.4, rng)
    zr *= ramp_db([(0, -52), (1.5, -40), (z1 + 0.1 - z0, -21)], zr.shape[1])
    zr[:, -int(0.03 * SR):] *= np.linspace(1, 0, int(0.03 * SR))
    add(zr, z0, hall=0.1)

    # breath in before the bloom, and a soft sub landing
    b0 = CUES["voice"] + 2.1
    add(reverse_swell(1.3, rng, 200, 5000) * db(-31), b0 - 1.3 + 0.05, hall=0.3)
    add(boom(5.0, 60.0, 30.0, seed=12), b0 + 0.05, gain=db(-20), hall=0.3)

    # title: reverse swell -> deep boom -> shimmering tail
    th = TL["title_card"]["start"]
    add(reverse_swell(1.6, rng, 250, 6000) * db(-27), th - 1.6)
    add(boom(8.0, 72.0, 27.0, seed=13), th, gain=db(-7.5), hall=0.3)
    sh = shimmer([hz(x) for x in ["B5", "F#6", "C#7", "E6", "G#6", "B6", "D#7"]], 9.0, seed=14)
    add(sh, th + 0.02, gain=db(-19), hall=0.9)

    out += convolve_stereo(send, hall_ir, N)
    out += convolve_stereo(rsend, room_ir, N)
    return out


# ---------------------------------------------------------------------------

def check_and_write(name, x):
    assert x.shape == (2, N), (name, x.shape)
    assert np.all(np.isfinite(x)), name
    x = x - x.mean(axis=1, keepdims=True)
    pk = float(np.max(np.abs(x)))
    if pk > 0.98:
        print(f"  ! {name} peak {pk:.3f} -> scaled to 0.98")
        x *= 0.98 / pk
    write_wav_float(os.path.join(STEMS, f"{name}.wav"), x)
    rms = float(np.sqrt(np.mean(x ** 2)))
    print(f"  wrote {name}.wav  peak {20 * np.log10(max(pk, 1e-9)):6.1f} dBFS  rms {20 * np.log10(max(rms, 1e-9)):6.1f} dBFS")
    return x


def main():
    t_all = time.time()
    os.makedirs(STEMS, exist_ok=True)
    hall = make_ir(6.5, rt_low=5.2, rt_mid=4.2, rt_high=1.8, predelay=0.03, seed=11, width=1.0)
    room = make_ir(1.4, rt_low=0.8, rt_mid=0.65, rt_high=0.3, predelay=0.006, seed=12, er_span=0.03, width=0.8)

    t = time.time()
    typing = render_typing(room)
    print(f"typing  {time.time() - t:5.1f}s")
    check_and_write("typing", typing)
    del typing

    t = time.time()
    sig = render_signal(room)
    print(f"signal  {time.time() - t:5.1f}s")
    check_and_write("signal", sig)
    del sig

    t = time.time()
    sfx = render_sfx(hall, room)
    print(f"sfx     {time.time() - t:5.1f}s")
    check_and_write("sfx", sfx)
    del sfx

    t = time.time()
    music = render_music(hall)
    print(f"music   {time.time() - t:5.1f}s")
    check_and_write("music", music)

    print(f"total render {time.time() - t_all:.1f}s")


if __name__ == "__main__":
    main()
