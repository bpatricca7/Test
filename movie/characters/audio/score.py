#!/usr/bin/env python3
"""ECHO (characters cut) — score, sound design and foley, synthesized from scratch.

Renders seven stems (48 kHz, stereo, float32, exactly the film's duration) to
movie/characters/build/stems/:

  music   sparse score: felt piano, soft strings, the choir for the Visitor
  typing  typewriter keys on text[*].char_times
  monitor the main monitor's little speaker: static, the 1,679 pulses, row blips,
          the zoom, surge glitches (all mono / centred)
  foley   cloth, chairs, casters and footsteps on TL.footsteps
  amb     wind and insects outside; room tone, equipment hum, fridge, fans inside
  alarm   the hut alarm (muffled outside, then in the room), own stem so the mix
          can duck it hard under speech
  fx      surge, materialize, the Visitor's glint, dissolve, lights return, the
          distant dish servo, title boom and shimmer

Every time comes from build/timeline.json (beats, shots, footsteps, pulses,
grid rows, title, credits) and, for line lengths, build/dialogue/manifest.json
when it exists. Nothing is pinned to the current numbers, so re-timed
dialogue only needs a re-run of this script and mix.py.

Tuning as in the other cuts (B5 = 1000 Hz, the signal's bit-0 tone); the hut's
equipment hum sits on B1 (62.5 Hz) so the room itself is in the key.

Run:  python3 movie/characters/audio/score.py
"""

import json
import os
import sys
import time

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
CHAR = os.path.dirname(HERE)
MOVIE = os.path.dirname(CHAR)
sys.path.insert(0, os.path.join(MOVIE, "animated", "audio"))
from instruments import (SR, TAU, hz, chord, db, tvec, ramp_db, fade_env, smooth_noise,  # noqa: E402
                         saw_blep, pan_gains, to_stereo, lp, hp, bp, tv_filter, pink, brown,
                         convolve_stereo, one_pole_smooth, Bus, place, pad, choir, bell, pluck, piano,
                         sub, thump, shepard_rise, braam, taiko, timpani, cymbal, noise_sweep,
                         reverse_swell, boom, relay_clunk, electric_hum, crickets, servo, buzzer, glass,
                         tick, shimmer, key_click)
from dsp import make_ir, write_wav_float  # noqa: E402

BUILD = os.path.join(CHAR, "build")
STEMS = os.path.join(BUILD, "stems")
DIALOGUE_DIR = os.path.join(BUILD, "dialogue")
with open(os.path.join(BUILD, "timeline.json")) as _f:
    TL = json.load(_f)
DUR = float(TL["duration"])
N = int(round(DUR * SR))
B = TL["beats"]
SHOT = {s["id"]: s for s in TL["shots"]}


def _manifest():
    p = os.path.join(DIALOGUE_DIR, "manifest.json")
    if os.path.exists(p):
        with open(p) as f:
            return json.load(f).get("lines", {})
    return {}


MAN = _manifest()


def _line_span(d):
    info = MAN.get(d["id"], {})
    dur = info.get("duration", d.get("duration", d["target"]))
    return float(d["start"]), float(d["start"]) + float(dur)


LINES = {d["id"]: _line_span(d) for d in TL["dialogue"]}
SPEAKER = {d["id"]: d["speaker"] for d in TL["dialogue"]}
VIS_LINES = sorted((LINES[i] for i in LINES if SPEAKER[i] == "visitor"), key=lambda s: s[0])


def span(name):
    b = B[name]
    return float(b["start"]), float(b["end"])


INT0 = span("exterior")[1]                       # the cut inside
INT1 = float(SHOT["ext_dish"]["start"])          # back outside for the dish
SURGE = span("surge")
MAT = span("materialize")
DEMAT = span("dematerialize")
LIGHTS = float(B["lights_return"])
TITLE = float(TL["title_card"]["start"])
CRED = (float(TL["credits"]["start"]), float(TL["credits"]["end"]))


def mark_x(name):
    return TL["marks"][name]["pos"][0]


def room_pan(x):
    """Level pan from room x (walls at +-2.5 m). Level only, so it folds to mono cleanly."""
    return float(np.clip(x / 2.5 * 0.4, -0.45, 0.45))


# ---------------------------------------------------------------------------
# Foley generators (specific to this film)
# ---------------------------------------------------------------------------

def rustle(dur, seed, kind="hoodie"):
    """Cloth: a cluster of soft swishes (band noise under random bumps), plus fibre crackle."""
    rng = np.random.default_rng(seed)
    n = int(dur * SR)
    t = tvec(n)
    lo, hi = {"hoodie": (450, 5500), "knit": (300, 3200), "denim": (500, 4500)}[kind]
    y = bp(rng.standard_normal(n), lo, hi)
    env = np.zeros(n)
    for _ in range(int(3 + dur * 6)):
        c = rng.uniform(0.05, dur - 0.05)
        w = rng.uniform(0.04, 0.16)
        env += rng.uniform(0.3, 1.0) * np.exp(-0.5 * ((t - c) / w) ** 2)
    y *= env
    if kind != "knit":
        cr = np.zeros(n)
        k = int(dur * 40)
        cr[rng.integers(0, n, k)] = rng.normal(0, 1, k)
        y += 0.5 * hp(cr, 3000.0) * env
    return y / (np.max(np.abs(y)) + 1e-9) * fade_env(n, 0.02, 0.05)


def creak(dur, seed, f_rate=(25.0, 55.0), res=(260.0, 720.0, 1500.0), q=14.0):
    """Stick-slip creak: an irregular impulse train exciting resonant bands (wood, springs)."""
    rng = np.random.default_rng(seed)
    n = int(dur * SR)
    t = tvec(n)
    rate = np.interp(t, [0, dur * 0.5, dur], [f_rate[0], f_rate[1], f_rate[0] * 1.2])
    rate *= 1 + 0.25 * smooth_noise(n, 12.0, rng, -1, 1)
    ph = np.cumsum(rate) / SR
    imp = np.zeros(n)
    idx = np.flatnonzero(np.diff(np.floor(ph)) > 0)
    imp[idx] = rng.uniform(0.3, 1.0, len(idx))
    y = sum(tv_filter(imp, f * (1 + 0.04 * np.sin(TAU * rng.uniform(0.5, 2) * t)), q, kind="bp") * g
            for f, g in zip(res, (1.0, 0.6, 0.3)))
    env = np.sin(np.pi * np.clip(t / dur, 0, 1)) ** 0.7
    y = y * env
    return y / (np.max(np.abs(y)) + 1e-9) * fade_env(n, 0.01, 0.05)


def squeak(dur, seed, f0=780.0):
    """Office-chair swivel squeak (stick-slip on a bearing) plus a small mechanism clunk."""
    rng = np.random.default_rng(seed)
    n = int(dur * SR)
    t = tvec(n)
    f = f0 * (1 + 0.14 * t / dur) * (1 + 0.01 * np.sin(TAU * 43 * t))
    ph = np.cumsum(f) / SR
    y = (np.sin(TAU * ph) + 0.4 * np.sin(TAU * 2 * ph) + 0.15 * np.sin(TAU * 3 * ph))
    y *= (0.6 + 0.4 * np.sin(TAU * rng.uniform(35, 55) * t) ** 2) * np.sin(np.pi * t / dur) ** 1.5
    y += 0.8 * thump(420, 180, dur, tau_pitch=0.01, tau_amp=0.02, noise=0.4, seed=seed)
    return y / (np.max(np.abs(y)) + 1e-9) * fade_env(n, 0.005, 0.05)


def casters(dur, seed):
    """Office chair rolling back on vinyl: speed-shaped rumble with wheel rotation AM and seam bumps."""
    rng = np.random.default_rng(seed)
    n = int(dur * SR)
    t = tvec(n)
    speed = np.sin(np.pi * np.clip(t / dur, 0, 1)) ** 0.8
    wheel = np.cumsum(6.0 + 14.0 * speed) / SR
    y = bp(pink(n, rng), 150.0, 2400.0) * (0.55 + 0.45 * np.sin(TAU * wheel) ** 2) * speed
    y += 0.4 * lp(brown(n, rng), 200.0) * speed
    for c in rng.uniform(0.2, 0.8, 2) * dur:
        i = int(c * SR)
        m = int(0.05 * SR)
        y[i:i + m] += 1.5 * thump(300, 150, 0.05, tau_pitch=0.005, tau_amp=0.01, noise=0.5, seed=seed + 1)[:max(0, min(m, n - i))]
    return y / (np.max(np.abs(y)) + 1e-9)


def footstep(kind, seed, backward=False):
    """One footfall; the heel strike is at sample 0 (the picture plants the foot there)."""
    rng = np.random.default_rng(seed)
    dur = 0.35
    n = int(dur * SR)
    t = tvec(n)
    y = np.zeros(n)
    if kind == "flat":        # Maya: soft flats on vinyl over wooden boards
        y += thump(rng.uniform(240, 290), 130, dur, tau_pitch=0.008, tau_amp=0.02, noise=0.35, seed=seed)
        y += 0.35 * bp(rng.standard_normal(n), 1200.0, 5000.0) * np.exp(-t / 0.006)
        d = int(rng.uniform(0.05, 0.075) * SR)
        toe = 0.45 * thump(300, 160, dur, tau_pitch=0.006, tau_amp=0.014, noise=0.3, seed=seed + 1)
        toe += 0.2 * bp(rng.standard_normal(n), 1500.0, 6000.0) * np.exp(-t / 0.004)
        y[d:] += toe[:n - d]
    else:                     # Sam: sneakers, duller, with the odd squeak
        y += thump(rng.uniform(190, 230), 105, dur, tau_pitch=0.01, tau_amp=0.025, noise=0.5, seed=seed)
        y += 0.2 * lp(rng.standard_normal(n), 1800.0) * np.exp(-t / 0.012)
        if backward:
            m = int(0.14 * SR)
            y[:m] += 0.25 * bp(rng.standard_normal(m), 700.0, 3000.0) * np.sin(np.pi * np.arange(m) / m)
        if rng.random() < 0.5:
            d = int(0.03 * SR)
            m = int(0.06 * SR)
            tq = tvec(m)
            sq = np.sin(TAU * np.cumsum(rng.uniform(2100, 2700) * (1 + 0.08 * tq / tq[-1])) / SR)
            y[d:d + m] += 0.12 * sq * np.sin(np.pi * tq / tq[-1])
    y *= db(rng.uniform(-2.0, 1.5))
    return hp(y, 60.0) * fade_env(n, 0.0005, 0.1)


def holo_step(seed):
    """The Visitor's footfall: no weight, just light touching the floor."""
    rng = np.random.default_rng(seed)
    n = int(0.6 * SR)
    t = tvec(n)
    y = 0.5 * glass(hz(rng.choice(["F#5", "B5", "C#6"])) * rng.uniform(0.998, 1.002), 0.6, decay=0.12, seed=seed)
    y += 0.5 * thump(110, 70, 0.6, tau_pitch=0.03, tau_amp=0.06, noise=0.0)
    y += 0.25 * bp(rng.standard_normal(n), 2000.0, 7000.0) * np.exp(-t / 0.02)
    return y * fade_env(n, 0.003, 0.1)


def keypress(seed):
    """A chunky keyboard key: the click of the switch, the bottom-out, the release."""
    rng = np.random.default_rng(seed)
    n = int(0.25 * SR)
    t = tvec(n)
    y = 0.6 * bp(rng.standard_normal(n), 1800.0, 7000.0) * np.exp(-t / 0.002)
    y += 0.8 * thump(420, 220, 0.25, tau_pitch=0.004, tau_amp=0.012, noise=0.4, seed=seed)
    d = int(0.09 * SR)
    y[d:] += 0.3 * bp(rng.standard_normal(n - d), 2000.0, 6000.0) * np.exp(-t[:n - d] / 0.0015)
    return y * fade_env(n, 0.0003, 0.05)


# ---------------------------------------------------------------------------
# Typing
# ---------------------------------------------------------------------------

def render_typing(room):
    rng = np.random.default_rng(7)
    out = np.zeros((2, N))
    wet = np.zeros((2, N))
    film0 = next(s["start"] for s in TL["scenes"] if s["id"] == "film")
    for cue in TL["text"]:
        lvl = db(2.0) if cue["start"] < film0 else 1.0
        for ch, tt in zip(cue["text"], cue["char_times"]):
            y = key_click(rng, heavy=cue.get("style") == "emph", space=(ch == " "))
            st = to_stereo(y, float(np.clip(rng.uniform(-0.2, 0.2), -1, 1))) * 0.45 * lvl
            place(out, st, tt)
            place(wet, st * 0.35, tt)
    return out + convolve_stereo(wet, room, N)


# ---------------------------------------------------------------------------
# Ambience: outside (wind, insects), inside (room tone, hum, fridge, fans)
# ---------------------------------------------------------------------------

def inside_mask(n, t0=0.0, fade=0.03):
    t = tvec(n, t0)
    m = ((t >= INT0) & (t < INT1)).astype(float)
    k = max(1, int(fade * SR))
    return np.convolve(m, np.ones(k) / k, mode="same")


def render_amb(hall, room):
    rng = np.random.default_rng(11)
    out = np.zeros((2, N))
    t = tvec(N)
    inside = inside_mask(N)
    e0 = span("exterior")[0]

    # wind: full outside; through the walls (dark, low) inside
    w0 = e0 - 1.5
    nw = N - int(w0 * SR)
    src = pink((2, nw), rng)
    wind = tv_filter(src, 320 + 480 * smooth_noise(nw, 0.12, rng), 0.9, kind="bp")
    wind += 0.6 * lp(brown((2, nw), rng), 220.0)
    wind += 0.2 * tv_filter(rng.standard_normal((2, nw)), 1100 + 300 * smooth_noise(nw, 0.1, rng), 9.0,
                            kind="bp") * smooth_noise(nw, 0.2, rng)
    wind *= 0.35 + 0.65 * smooth_noise(nw, 0.18, rng) ** 1.5
    ins = inside[-nw:]
    through = lp(wind, 350.0, order=2) * db(-17)
    wind = wind * (1 - ins) + through * ins
    wind *= ramp_db([(w0, -120), (e0, -40), (e0 + 2.0, -30), (TITLE - 0.5, -30), (TITLE + 2.5, -44),
                     (DUR - 1.0, -120)], nw, w0)
    place(out, wind, w0)

    # insects: sparse, cool-air crickets, outside only
    ins_all = np.zeros((2, N))
    for a, b_ in ((e0, INT0), (INT1, min(DUR, TITLE + 3.0))):
        n = int((b_ - a) * SR)
        cr = crickets(b_ - a, seed=int(a * 10), voices=4) * fade_env(n, 1.0, 0.4)
        place(ins_all, cr, a)
    out += ins_all * db(-33)

    # room tone, fans, equipment hum (B1), fridge: inside only
    tone = lp(pink((2, N), rng), 900.0) * db(-55)
    s0, s1 = SURGE
    power = ramp_db([(0, 0), (s0, 0), (s0 + 0.35, -20), (LIGHTS, -20), (LIGHTS + 0.7, 0), (DUR, 0)], N)
    hum = electric_hum(DUR, hz("B1"), seed=12, bright=0.6) * db(-47)
    hum = np.stack([hum, hum]) * power
    spin = np.interp(t, [0, s0, s0 + 2.0, LIGHTS, LIGHTS + 1.5, DUR], [1, 1, 0.25, 0.25, 1, 1])
    fan_ph = np.cumsum(2350.0 * spin) / SR
    fans = bp(pink((2, N), rng), 300.0, 4000.0) * db(-58) * spin
    fans += np.stack([np.sin(TAU * fan_ph), np.sin(TAU * fan_ph)]) * db(-66) * spin
    fr_on = ramp_db([(0, 0), (s0, 0), (s0 + 0.12, -120), (LIGHTS + 1.1, -120), (LIGHTS + 1.6, 0), (DUR, 0)], N)
    fph = np.cumsum(118.0 * (1 + 0.004 * smooth_noise(N, 2.0, rng, -1, 1))) / SR
    fridge = sum(np.sin(TAU * k * fph) / k ** 0.7 for k in range(1, 9))
    fridge *= 1 + 0.3 * (0.5 + 0.5 * np.sin(TAU * 7.3 * t))
    fridge = bp(fridge, 90.0, 1200.0) * db(-52) * fr_on
    fridge = np.stack([fridge * pan_gains(-0.35)[0] * 1.41, fridge * pan_gains(-0.35)[1] * 1.41])
    interior = (tone + hum + fans + fridge) * inside
    out += interior
    # fridge compressor: a shudder as it cuts out and as it restarts
    for tt in (s0 + 0.05, LIGHTS + 1.1):
        sh = creak(0.35, seed=int(tt * 7), f_rate=(40, 70), res=(120.0, 240.0, 480.0), q=8.0)
        place(out, to_stereo(sh, -0.35) * db(-40), tt)
    return out + 0.25 * convolve_stereo(interior, room, N)


# ---------------------------------------------------------------------------
# The alarm: muffled from outside, then in the room, stops when the lights return
# ---------------------------------------------------------------------------

def render_alarm(hall, room):
    rng = np.random.default_rng(21)
    a0 = float(B["alarm"])
    a1 = LIGHTS
    n = int((a1 - a0 + 0.5) * SR)
    x = np.zeros(n)
    k = 0
    period, blen = 0.8, 0.16
    while a0 + k * period < a1 - 0.05:
        y = buzzer(blen, hz("F#5"))
        s = int(k * period * SR)
        x[s:s + len(y)] += y[:n - s]
        k += 1
    x = bp(x, 250.0, 6000.0)
    t = tvec(n, a0)
    inside = inside_mask(n, a0)
    muffled = lp(x, 650.0, order=2) * db(-13)
    x = x * inside + muffled * (1 - inside)
    # settles into the background as the scene goes on; very low while the Visitor is present
    d03 = LINES.get("d03", (INT0 + 9, INT0 + 11))[1]
    lvl = ramp_db([(a0, -3), (INT0 - 0.01, 0), (INT0, 0), (d03, -3), (span("maya_walks")[1], -6),
                   (span("pulses")[0], -8), (SURGE[0], -8), (MAT[0], -10), (DEMAT[0], -11),
                   (a1, -11)], n, a0)
    # the surge: brown-out stutter
    s0, s1 = SURGE
    flick = np.ones(n)
    tt = s0
    while tt < s1:
        seg = rng.uniform(0.03, 0.12)
        if rng.random() < 0.45:
            i, j = int((tt - a0) * SR), int((tt + seg - a0) * SR)
            flick[max(0, i):max(0, j)] = rng.uniform(0.0, 0.3)
        tt += seg
    flick = one_pole_smooth(flick, 0.004)
    x = x * lvl * flick * fade_env(n, 0.005, 0.02)
    st = np.stack([x, x]) * 0.5
    gl, gr = pan_gains(room_pan(1.2))
    st = np.stack([x * gl, x * gr]) * 0.7
    wet_in = st * inside
    wet_out = st * (1 - inside)
    st = st + 0.35 * convolve_stereo(wet_in, room, n) + 0.4 * convolve_stereo(wet_out, hall, n)
    out = np.zeros((2, N))
    place(out, st, a0)
    return out


# ---------------------------------------------------------------------------
# The monitor's little speaker (mono, centred)
# ---------------------------------------------------------------------------

def small_speaker(x):
    x = bp(x, 380.0, 6000.0, order=2)
    x = x + 0.6 * bp(x, 1500.0, 2600.0)          # cabinet resonance
    return np.tanh(1.8 * x) / np.tanh(1.8)


def render_monitor(room):
    rng = np.random.default_rng(31)
    x = np.zeros(N)
    t = tvec(N)
    P = TL["pulses"]
    times = np.array(P["times"])
    bits = np.array(P["bits"])
    f_one, f_zero = P["freq_one"], P["freq_zero"]
    p0, p1 = span("pulses")

    # static: idle floor, lifts while the pulses run, dark/noisy while the Visitor is here
    static = bp(rng.standard_normal(N), 500.0, 5000.0) * (0.6 + 0.4 * smooth_noise(N, 1.3, rng))
    static *= ramp_db([(0, -120), (INT0 - 0.01, -120), (INT0, -44), (p0 - 0.5, -44), (p0, -38), (times[-1], -36),
                       (times[-1] + 0.1, -44), (SURGE[0], -44), (SURGE[1], -38), (MAT[1], -42),
                       (LIGHTS, -44), (INT1 - 0.01, -44), (INT1, -120), (DUR, -120)], N)
    x += static

    # the 1,679 pulses: smooth-enveloped tones on TL.pulses.times, then the blurred stream
    iv = np.diff(times)
    iv = np.append(iv, iv[-1])
    lengths = np.minimum(0.09, 0.6 * iv)
    for tt, b, L in zip(times, bits, lengths):
        f = f_one if b else f_zero
        s = int(np.ceil(tt * SR))
        m = max(2, int(L * SR))
        tk = (s + np.arange(m)) / SR - tt
        a = min(int(0.005 * SR), m // 2)
        env = np.ones(m)
        if a > 0:
            ramp = 0.5 - 0.5 * np.cos(np.linspace(0, np.pi, a + 2)[1:-1])
            env[:a] = ramp
            env[m - a:] = ramp[::-1]
        x[s:s + m] += 0.5 * np.sin(TAU * f * tk) * env
    stop = times[-1] + lengths[-1]
    idx = np.clip(np.searchsorted(times, t, side="right") - 1, 0, len(times) - 1)
    fi = one_pole_smooth(np.where(bits[idx] == 1, f_one, f_zero).astype(float), 0.00025)
    stream = np.sin(TAU * np.cumsum(fi) / SR)
    rate = 1.0 / iv[idx]
    blend = np.clip((rate - 250.0) / 600.0, 0, 1) * ((t >= p0) & (t < stop))
    stream *= 0.45 * blend
    kk = int(0.004 * SR)
    si = int(stop * SR)
    stream[si - kk:si] *= np.linspace(1, 0, kk)
    x += stream

    # rows of the picture landing: soft blips, pitch from the lit bits (B minor pentatonic)
    rows = TL["grid"]["returned"]
    penta = [0, 3, 5, 7, 10]
    for tt, row in zip(TL["grid"]["row_times"], rows):
        c = sum(row)
        if c == 0:
            y = tick(0, rng, empty=True) * 0.6
        else:
            j = min(c, 13)
            y = tick(hz("B4") * 2 ** ((12 * (j // 5) + penta[j % 5]) / 12), rng) * db(-2 - 2.0 * j / 13)
        s = int(round(tt * SR))
        x[s:s + len(y)] += 0.35 * y[:N - s]

    # zoom to the added figure: a rising digital whirr, then a two-blip "target"
    z0, z1 = span("zoom_visitor")
    nz = int((z1 - z0) * SR)
    tz = tvec(nz)
    fz = 180.0 * (6.0 ** (tz / tz[-1]))
    wh = saw_blep(np.cumsum(fz) / SR, fz / SR) * np.sin(np.pi * tz / tz[-1]) ** 0.5 * 0.18
    wh = np.round(wh * 24) / 24                                          # a little bit-crush
    s = int(z0 * SR)
    x[s:s + nz] += wh
    for k in range(2):
        y = tick(hz("F#6"), rng) * 0.5
        s = int((z0 + 0.8 * (z1 - z0) + 0.11 * k) * SR)
        x[s:s + len(y)] += y

    # surge: digital glitches (stutters and sample-and-hold crunch)
    s0, s1 = SURGE
    tt = s0 + 0.05
    while tt < s1:
        seg = int(rng.uniform(0.02, 0.06) * SR)
        reps = rng.integers(2, 6)
        frag = rng.standard_normal(seg) * rng.uniform(0.1, 0.35)
        hold = rng.integers(8, 60)
        frag = np.repeat(frag[::hold], hold)[:seg]
        frag = np.round(frag * 8) / 8
        blk = np.tile(frag * fade_env(seg, 0.001, 0.002), reps)
        s = int(tt * SR)
        x[s:s + len(blk)] += blk[:N - s]
        tt += len(blk) / SR + rng.uniform(0.05, 0.25)

    y = small_speaker(x)
    st = np.stack([y, y]) * 0.5                                           # centred: no inter-channel delay
    return st + 0.2 * convolve_stereo(st, room, N)


# ---------------------------------------------------------------------------
# Foley
# ---------------------------------------------------------------------------

def render_foley(room):
    out = np.zeros((2, N))
    wet = np.zeros((2, N))

    def add(sig, t0, gain_db, x):
        st = to_stereo(sig, room_pan(x)) * db(gain_db)
        place(out, st, t0)
        place(wet, st * 0.5, t0)

    sam_x, maya_x = mark_x("sam_chair"), mark_x("maya_armchair")
    w0, w1 = span("sam_wakes")
    add(rustle(w1 - w0, 101, "hoodie"), w0, -24, sam_x)
    add(thump(260, 150, 0.2, tau_pitch=0.01, tau_amp=0.03, noise=0.5, seed=102), w0 + 0.05, -30, sam_x)
    add(squeak(0.3, 103, 820), w0 + 0.4, -34, sam_x)
    # Sam turns to her before he calls, twists further round, turns back to the screen
    for k, tt in enumerate([LINES["d01"][0] - 0.45, LINES["d03"][0] - 0.35, span("maya_walks")[1] - 0.25]):
        add(squeak(0.32, 110 + k, 760 + 40 * k), tt, -31, sam_x)
        add(rustle(0.6, 120 + k, "hoodie"), tt - 0.05, -30, sam_x)
    # Maya: arm off her eyes, sits forward (armchair), stands
    add(rustle(0.7, 130, "knit"), float(B["maya_arm_off_eyes"]) - 0.2, -31, maya_x)
    f0, f1 = span("maya_sits_forward")
    add(creak(f1 - f0, 131, f_rate=(18, 36), res=(190.0, 520.0, 1150.0), q=10.0), f0, -27, maya_x)
    add(rustle(f1 - f0, 132, "knit"), f0, -29, maya_x)
    s0, s1 = span("maya_stands")
    add(creak(s1 - s0, 133, f_rate=(30, 50), res=(210.0, 600.0, 1300.0), q=12.0), s0, -29, maya_x)
    m = int(0.5 * SR)
    spring = np.sin(TAU * 265 * tvec(m) * (1 - 0.03 * tvec(m))) * np.exp(-tvec(m) / 0.12)
    add(spring * fade_env(m, 0.002, 0.05), s1 - 0.25, -38, maya_x)
    add(rustle(s1 - s0 + 0.3, 134, "knit"), s0, -30, maya_x)
    # Sam's chair rolls back, he stands, backs away
    b0, b1 = span("sam_backs_off")
    sam_steps = [f["t"] for f in TL["footsteps"] if f["who"] == "sam"]
    roll_end = (sam_steps[0] - 0.45) if sam_steps else b0 + 0.9
    add(casters(max(0.4, roll_end - b0), 140), b0, -25, sam_x)
    stand = (sam_steps[0] - 0.25) if sam_steps else b0 + 1.2
    add(squeak(0.28, 141, 700), stand - 0.1, -30, sam_x)
    add(creak(0.4, 142, f_rate=(35, 60), res=(300.0, 800.0, 1700.0), q=12.0), stand, -32, sam_x)
    add(rustle(0.9, 143, "hoodie"), stand - 0.2, -28, sam_x)
    # Maya leans over Sam and hits the key that folds the picture
    if "maya_reach_key" in B:
        k0, k1 = span("maya_reach_key")
        add(rustle(k1 - k0, 145, "knit"), k0, -31, mark_x("maya_desk"))
        add(keypress(146), k1 - 0.4, -24, mark_x("sam_chair"))
    if "maya_raises_hand" in B:
        a, b_ = span("maya_raises_hand")
        add(rustle(b_ - a, 147, "knit"), a, -32, mark_x("maya_closer") if "maya_closer" in TL["marks"] else 0.3)
    # footsteps, exactly on TL.footsteps (the Visitor's are light touching the floor)
    walks = TL["walks"]
    for i, f in enumerate(TL["footsteps"]):
        w = next((w for w in walks if w["who"] == f["who"] and w["start"] - 1e-6 <= f["t"] <= w["end"] + 1e-6), None)
        back = bool(w and w.get("backward"))
        x = mark_x(w["to"]) if w else 0.0
        if f["who"] == "visitor":
            add(holo_step(200 + i), f["t"], -29, x)
        else:
            kind = "flat" if f["who"] == "maya" else "sneaker"
            add(footstep(kind, 200 + i, backward=back), f["t"], -21 if kind == "flat" else -20, x)
    for i, w in enumerate(walks):
        if w["who"] in ("maya", "sam"):
            add(rustle(w["end"] - w["start"] + 0.2, 160 + i, "knit" if w["who"] == "maya" else "hoodie"),
                w["start"] - 0.1, -33, mark_x(w["to"]))
    return out + convolve_stereo(wet, room, N) * 0.6


# ---------------------------------------------------------------------------
# Sound design
# ---------------------------------------------------------------------------

def render_fx(hall, space, room):
    rng = np.random.default_rng(41)
    out = np.zeros((2, N))
    hs = np.zeros((2, N))
    ss = np.zeros((2, N))
    rs = np.zeros((2, N))

    def add(sig, t0, gain_db=0.0, pan=0.0, hall_s=0.0, space_s=0.0, room_s=0.0):
        st = to_stereo(np.asarray(sig, dtype=float), pan) * db(gain_db)
        place(out, st, t0)
        for buf, s in ((hs, hall_s), (ss, space_s), (rs, room_s)):
            if s:
                place(buf, st * s, t0)

    # the surge: transformer groan, the lights buzzing and flickering, arcs, a low dip
    s0, s1 = SURGE
    ds = s1 - s0 + 0.6
    n = int(ds * SR)
    t = tvec(n)
    sag = np.interp(t, [0, 0.35, 0.9, s1 - s0, ds], [1.0, 0.7, 0.78, 0.72, 0.6])
    ph = np.cumsum(hz("B1") * sag) / SR
    groan = sum(np.sin(TAU * k * ph + k) / k ** 0.6 for k in range(1, 12)) + 0.5 * np.sin(TAU * 0.5 * ph)
    groan = np.tanh(2.5 * groan) * (0.7 + 0.3 * smooth_noise(n, 9.0, rng))
    groan *= ramp_db([(0, -40), (0.15, 0), (s1 - s0, -2), (ds, -120)], n)
    add(lp(groan, 1500.0), s0, -21, pan=room_pan(1.2), room_s=0.5)
    flick = np.zeros(n)
    tt = 0.0
    while tt < s1 - s0:
        seg = rng.uniform(0.025, 0.11)
        i, j = int(tt * SR), int((tt + seg) * SR)
        flick[i:j] = rng.choice([0.0, 0.3, 1.0], p=[0.35, 0.25, 0.4])
        tt += seg
    flick = one_pole_smooth(flick, 0.003)
    bph = np.cumsum(np.full(n, 2 * hz("B1"))) / SR
    buzz = sum(np.sin(TAU * k * bph) / k for k in range(1, 30) if k * 2 * hz("B1") < 9000)
    buzz = hp(buzz, 150.0) * flick
    add(buzz, s0, -30, pan=0.0, room_s=0.6)
    for k in range(10):
        ta = s0 + rng.uniform(0.0, s1 - s0)
        m = int(rng.uniform(0.01, 0.05) * SR)
        arc = hp(rng.standard_normal(m), 2500.0) * np.exp(-tvec(m) / 0.008)
        add(arc, ta, -30 + rng.uniform(-4, 2), pan=rng.uniform(-0.3, 0.4), room_s=0.6)
    add(thump(85, 32, 1.4, tau_pitch=0.08, tau_amp=0.45, noise=0.2, seed=42), s0, -22, room_s=0.3)

    # materialize: voxels pour out of the screen and assemble, crystalline, accelerating
    m0, m1 = MAT
    mon_x, vis_x = -0.5, mark_x("visitor")
    crystal = [hz(x) for x in ("B6", "C#7", "D#7", "F#7", "G#7", "A#6", "E7")]
    tt, k = m0 + 0.05, 0
    while tt < m1 - 0.05:
        u = (tt - m0) / (m1 - m0)
        f = min(7800.0, rng.choice(crystal) * (2 if (rng.random() < 0.25 and u > 0.5) else 1) * rng.uniform(0.997, 1.003))
        cx = room_pan(mon_x + (vis_x - mon_x) * min(1.0, u * 1.3))
        add(glass(f, 0.6, decay=0.05 + 0.25 * (1 - u) * rng.random(), seed=300 + k), tt,
            -33 + 8 * u + rng.uniform(-3, 1), pan=float(np.clip(cx + rng.normal(0, 0.1 + 0.25 * u), -0.8, 0.8)),
            hall_s=0.5, space_s=0.3)
        tt += 1.0 / (6.0 * (60.0 / 6.0) ** u) * rng.uniform(0.5, 1.5)
        k += 1
    npour = int((m1 - m0) * SR)
    tp = tvec(npour)
    pour = tv_filter(pink((2, npour), rng), 2500 + 3000 * (tp / tp[-1]), 1.2, kind="bp")
    pour *= (0.6 + 0.4 * np.sin(TAU * 11.0 * tp) ** 2) * np.sin(np.pi * np.clip(tp / tp[-1] * 1.1, 0, 1)) ** 1.2
    add(pour * fade_env(npour, 0.4, 0.4), m0, -34, pan=room_pan(0.4), hall_s=0.4, space_s=0.3)
    add(reverse_swell(1.2, rng, 800, 9000) * db(-34), m1 - 1.2, hall_s=0.3)
    for j, note in enumerate(("B6", "D#7", "F#7")):
        add(glass(hz(note), 3.0, decay=1.1, seed=380 + j), m1 + 0.03 * j, -31, pan=room_pan(vis_x) + 0.1 * (j - 1),
            hall_s=0.6, space_s=0.5)
    add(thump(90, 45, 2.0, tau_pitch=0.1, tau_amp=0.6, noise=0.05, seed=390), m1, -27, space_s=0.3)

    # the Visitor folds down to eye level, and gestures: soft glassy movement
    for name, f_a, f_b, g in (("visitor_crouch", "F#6", "B5", -36), ("visitor_gesture", "C#6", "F#6", -38)):
        if name not in B:
            continue
        a, b_ = span(name)
        nm = int((b_ - a) * SR)
        tm = tvec(nm)
        fm = hz(f_a) * (hz(f_b) / hz(f_a)) ** (tm / tm[-1])
        mv = sum(np.sin(TAU * np.cumsum(fm * r) / SR + r) for r in (1.0, 1.5, 2.0)) / 3
        mv *= (0.6 + 0.4 * np.sin(TAU * 3.1 * tm) ** 2) * np.sin(np.pi * tm / tm[-1]) ** 1.5
        mv += 0.5 * tv_filter(pink(nm, rng), fm * 2, 2.0, kind="bp") * np.sin(np.pi * tm / tm[-1]) ** 2
        add(mv, a, g, pan=room_pan(vis_x), hall_s=0.5, space_s=0.5)

    # the hand: a warm high glint rising
    h0, h1 = span("visitor_raises_hand")
    nh = int((h1 - h0 + 1.2) * SR)
    th = tvec(nh)
    glint = sum(np.sin(TAU * np.cumsum(f * 2 ** (0.2 * np.clip(th / (h1 - h0), 0, 1))) / SR + p0)
                for f, p0 in ((hz("D#7"), 0.0), (hz("B7") / 2, 1.0), (hz("F#7"), 2.0)))
    glint *= (1 - np.exp(-th / 0.4)) * fade_env(nh, 0.3, 1.0) / 3
    add(glint, h0, -37, pan=room_pan(vis_x), hall_s=0.5, space_s=0.5)

    # dissolve: light streams out of the window, a long exhale into silence
    d0, d1 = DEMAT
    win_x = 2.5
    tt, k = d0, 0
    while tt < min(d1, LIGHTS) - 0.1:
        u = (tt - d0) / (d1 - d0)
        f = min(8000.0, rng.choice(crystal) * rng.uniform(0.99, 1.01) * 2 ** (0.5 * u))
        cx = room_pan(vis_x + (win_x - vis_x) * u)
        add(glass(f, 0.8, decay=0.08 + 0.2 * rng.random(), seed=500 + k), tt, -31 - 10 * u + rng.uniform(-3, 1),
            pan=float(np.clip(cx + rng.normal(0, 0.15), -0.8, 0.9)), hall_s=0.6, space_s=0.5)
        tt += 1.0 / (45.0 * (3.0 / 45.0) ** u) * rng.uniform(0.6, 1.4)
        k += 1
    ne = int((LIGHTS - d0) * SR)
    te = tvec(ne)
    exhale = tv_filter(pink((2, ne), rng), 3000.0 * (0.12 ** (te / te[-1])), 0.9, kind="lp")
    exhale *= (1 - np.exp(-te / 0.5)) * np.exp(-te / ((LIGHTS - d0) * 0.35)) * fade_env(ne, 0.2, 0.6)
    add(exhale, d0, -27, pan=room_pan(1.8), space_s=0.4)

    # the lights return: relay, a ballast tick and buzz settling
    add(relay_clunk(seed=60, size=1.2), LIGHTS, -25, pan=room_pan(1.2), room_s=0.6)
    nb = int(0.9 * SR)
    tb = tvec(nb)
    bph = np.cumsum(np.full(nb, 2 * hz("B1"))) / SR
    tube = sum(np.sin(TAU * k * bph) / k for k in range(1, 25) if k * 2 * hz("B1") < 8000)
    tube = hp(tube, 200.0) * np.exp(-tb / 0.25) * (np.mod(tb, 0.09) > 0.03)
    add(one_pole_smooth(tube, 0.002) * fade_env(nb, 0.003, 0.2), LIGHTS + 0.04, -35, room_s=0.6)

    # exterior: the dish turns, a servo far away
    dt0, dt1 = span("dish_turns")
    sv = servo(dt1 - dt0, seed=70)
    add(lp(sv, 1400.0), dt0, -33, pan=-0.15, hall_s=0.7)

    # the title: reverse swell, deep boom, shimmering tail
    add(reverse_swell(1.5, rng, 250, 7000) * db(-27), TITLE - 1.5)
    add(boom(8.0, 72.0, 27.0, seed=95), TITLE, -12, hall_s=0.3, space_s=0.2)
    add(shimmer([hz(x) for x in ("B5", "F#6", "C#7", "E6", "G#6", "B6", "D#7")], 9.0, seed=96), TITLE + 0.02,
        -20, hall_s=0.6, space_s=0.6)

    out += convolve_stereo(hs, hall, N)
    out += convolve_stereo(ss, space, N)
    out += convolve_stereo(rs, room, N)
    return out


# ---------------------------------------------------------------------------
# Music: sparse, intimate, out of the dialogue's way
# ---------------------------------------------------------------------------

def music_open(hall, space):
    e0, e1 = span("exterior")
    bus = Bus(0.0, e1 + 0.5)
    n = bus.n
    t = tvec(n)
    f1, f0 = hz("B1"), hz("B0")
    drone = (0.55 * np.sin(TAU * f1 * t) + 0.25 * np.sin(TAU * f1 * 1.004 * t + 1.0) + 0.45 * np.sin(TAU * f0 * t))
    drone *= ramp_db([(0, -110), (1.5, -70), (e0, -42), (e0 + 2, -37), (e1, -37)], n)
    bus.add(drone, 0.0, send=0.05)
    p = pad(chord("B2 F#3 D4 C#5"), e1 - e0 + 0.4, att=2.2, rel=0.3, voices=5, detune=9, seed=10,
            fc=[(0, 800), (e1 - e0, 1800)])
    bus.add(p, e0, gain=db(-24), send=0.5, space=0.4)
    bus.add(choir([2 * hz("F#4"), 2 * hz("C#5")], e1 - e0 + 0.4, att=3.0, rel=0.3, seed=11, vowel="o"), e0,
            gain=db(-33), space=0.8)
    for i, note in enumerate(("F#5", "B5", "C#6", "D6")):
        bus.add(bell(hz(note), 4.0, decay=1.6), e0 + 1.6 + 0.85 * i, gain=db(-27), pan=0.3 * (-1) ** i,
                send=0.5, echo=0.45)
    gate = [(0, 0), (e1 - 0.06, 0), (e1 + 0.01, -120)]
    return bus.render(hall, space, gate=gate, echo_delay=0.62, echo_fb=0.5), 0.0


def music_signal(hall, space):
    d04 = LINES["d04"][0]
    p0, p1 = span("pulses")
    times = np.array(TL["pulses"]["times"])
    t0 = d04 - 0.5
    bus = Bus(t0, p1 + 0.6)
    dur = p1 - d04
    bus.add(sub(hz("B1"), dur, 3.0, 0.1), d04, gain=db(-30))
    bus.add(pad([hz("F#6")], dur, att=3.0, rel=0.1, voices=3, detune=5, seed=20, fc=6000.0), d04, gain=db(-38),
            send=0.6, space=0.3)
    for i in range(0, len(times), 16):
        tt = times[i]
        g = -34 + 12 * (tt - p0) / (p1 - p0)
        bus.add(thump(hz("B2"), hz("B1"), 0.6, tau_pitch=0.03, tau_amp=0.18, noise=0.05, seed=i), tt, gain=db(g), send=0.1)
    dc = p1 - p0
    p = pad(chord("B3 C4 F4"), dc, att=2.5, rel=0.05, voices=3, detune=12, seed=21, q=0.9,
            fc=[(0, 900), (dc, 3000)], trem=([(0, 5.0), (dc, 14.0)], 0.5))
    p *= ramp_db([(0, -40), (dc, -27)], p.shape[1])
    bus.add(p, p0, send=0.4)
    gate = [(t0, 0), (p1 - 0.03, 0), (p1 + 0.03, -120)]
    return bus.render(hall, space, gate=gate), t0


def music_fold(hall, space):
    f0, f1 = span("fold")
    rows = TL["grid"]["row_times"]
    d08 = LINES["d08"][0]
    d10 = LINES["d10"][0]
    s0 = SURGE[0]
    t0 = f0 - 0.6
    bus = Bus(t0, s0 + 0.4)
    q = (f1 - f0) / 4
    fold_chords = [("B2 F#3 D4", "B3 D4 F#4 C#5 D5 F#5"), ("G2 D3 B3", "G3 B3 D4 F#4 B4 D5"),
                   ("E2 B2 G3", "E4 G4 B4 D5 F#5 G5"), ("F#2 C#3 A#3", "F#3 C#4 E4 A#4 C#5 E5")]
    for i, (pd, arp) in enumerate(fold_chords):
        a = f0 + i * q
        p = pad(chord(pd), q + 1.2, att=0.8 if i else 1.2, rel=1.2, voices=4, detune=8, seed=30 + i,
                fc=[(0, 900), (q, 1600), (q + 1.2, 1000)])
        bus.add(p, a, gain=db(-27), send=0.45)
    ARP = [0, 2, 4, 5, 3, 1, 4, 2]
    for r in range(0, len(rows), 2):
        tt = rows[r]
        i = min(3, int((tt - f0) / q))
        tones = [hz(x) for x in fold_chords[i][1].split()]
        bus.add(pluck(tones[ARP[(r // 2) % 8] % len(tones)], 0.8, decay=0.25), tt,
                gain=db(-31 + 3 * (tt - f0) / (f1 - f0)), pan=0.35 * np.sin(r * 0.4), send=0.35, echo=0.15)
    # the motif on bells as the picture completes, finishing just before "I know this picture."
    for i, note in enumerate(("F#5", "B5", "C#6", "D6")):
        bus.add(bell(hz(note), 3.5, decay=1.5, idx=1.0), d08 - 1.1 + 0.33 * i, gain=db(-28), pan=0.2,
                send=0.5, echo=0.3)
    # recognition: warm D major, soft
    r0 = d08 - 0.3
    rd = max(1.0, d10 - r0 + 0.2)
    bus.add(pad(chord("D2 A2 F#3 E4 A4"), rd, att=1.5, rel=0.6, voices=5, detune=8, seed=40,
                fc=[(0, 1200), (rd, 2200)]), r0, gain=db(-25), send=0.55, space=0.2)
    bus.add(sub(hz("D2"), rd, 1.2, 0.6), r0, gain=db(-31))
    for j, note in enumerate(("D3", "A3", "F#4")):
        bus.add(piano(hz(note), 4.0, vel=0.3, seed=41 + j), r0 + 0.05 * j, gain=db(-27), send=0.4)
    # "Then who is that?": a low B/C cluster creeping in, then the zoom rise into the surge
    dd = s0 - d10
    p = pad(chord("B1 C2 F2"), dd, att=1.5, rel=0.05, voices=4, detune=12, seed=45, q=1.0,
            fc=[(0, 250), (dd, 1500)])
    p *= ramp_db([(0, -32), (dd, -20)], p.shape[1])
    bus.add(p, d10, send=0.35)
    z0, _ = span("zoom_visitor")
    sr = shepard_rise(s0 - z0, hz("B2"), layers=5, seed=46, fc=(700, 5000))
    sr *= ramp_db([(0, -44), (s0 - z0, -25)], sr.shape[1])
    bus.add(sr, z0, send=0.4)
    gate = [(t0, 0), (s0 - 0.05, 0), (s0 + 0.01, -120)]
    return bus.render(hall, space, gate=gate), t0


# The Visitor's harmonic colours, one per line: high glass pairs over a B pedal
VIS_TOPS = [("B5", "F#6"), ("D#6", "G#6"), ("C#6", "F#6"), ("B5", "E6"), ("D#6", "A#6")]


def music_visitor(hall, space):
    m0, m1 = MAT
    d0, d1 = DEMAT
    t0 = m0 - 0.2
    bus = Bus(t0, LIGHTS + 0.3)
    # materialize: a swell toward a soft, awe-struck presence chord
    dm = m1 - m0
    bus.add(choir(chord("B2 F#3 C#4 D#4 F#4"), dm + 3.5, att=dm, rel=3.5, seed=50), m0, gain=db(-23), space=0.8)
    bus.add(pad(chord("B2 F#3 D#4 C#5"), dm + 3.5, att=dm, rel=3.5, voices=5, detune=9, seed=51,
                fc=[(0, 600), (dm, 2600), (dm + 3.5, 900)]), m0, gain=db(-24), send=0.5, space=0.5)
    bus.add(shimmer([hz(x) for x in ("B5", "D#6", "F#6", "A#6", "C#7")], dm + 4.0, seed=52), m0 + 0.4,
            gain=db(-27), space=0.9)
    for j, note in enumerate(("B5", "D#6", "F#6", "B6")):
        bus.add(bell(hz(note), 5.0, decay=2.4, idx=0.7), m1 + 0.06 * j, gain=db(-29), pan=-0.2 + 0.15 * j,
                send=0.6, space=0.4)
    bus.add(sub(hz("B1"), 4.0, 0.8, 3.0), m1, gain=db(-27))
    # under the Visitor's lines: a low B pedal and high glass, the middle left free for the voices
    if VIS_LINES:
        v0 = VIS_LINES[0][0] - 0.4
        v1 = max(VIS_LINES[-1][1] + 0.6, d0 + 0.5)
        dv = v1 - v0
        bus.add(sub(hz("B1"), dv, 2.0, 1.5, h2=0.05), v0, gain=db(-31))
        bus.add(choir(chord("B2 F#2"), dv, att=2.5, rel=1.5, seed=53, vowel="u"), v0, gain=db(-33), space=0.6)
        for k, (a, b_) in enumerate(VIS_LINES):
            top = VIS_TOPS[k % len(VIS_TOPS)]
            nxt = VIS_LINES[k + 1][0] if k + 1 < len(VIS_LINES) else v1
            dur = max(1.5, nxt - a + 1.6)
            g = shimmer([hz(x) for x in top], dur, seed=60 + k)
            bus.add(g * fade_env(g.shape[1], 1.2, 1.5), a - 0.3, gain=db(-30), space=0.8)
    # the hand raise: the motif answered in the major (D#), soft bells
    h0, _ = span("visitor_raises_hand")
    for i, note in enumerate(("F#5", "B5", "C#6", "D#6")):
        bus.add(bell(hz(note), 3.5, decay=1.6, idx=0.8), h0 + 0.1 + 0.42 * i, gain=db(-29),
                pan=0.2 - 0.1 * i, send=0.5, space=0.4, echo=0.3)
    # dissolve: the choir breathes out
    dd = LIGHTS - d0
    bus.add(choir(chord("B3 D#4 F#4 B4"), dd, att=1.2, rel=dd - 1.3, seed=70, vowel="a"), d0, gain=db(-26),
            space=0.9)
    gate = [(t0, 0), (LIGHTS - 1.0, 0), (LIGHTS - 0.05, -40), (LIGHTS, -120)]
    return bus.render(hall, space, gate=gate, echo_delay=0.42, echo_fb=0.45), t0


def music_end(hall, space):
    w0, w1 = span("maya_to_window")
    d19 = LINES.get("d19", (w0 - 1.8, w0 - 0.2))
    d20s, d20e = LINES["d20"]
    t0 = min(w0, d19[1]) - 0.5
    bus = Bus(t0, DUR)
    # the window: felt piano, the motif held at C# until she answers
    bus.add(pad(chord("B2 F#3 C#4"), d20e - w0 + 0.8, att=2.5, rel=0.8, voices=4, detune=8, seed=80,
                fc=[(0, 700), (3.0, 1200)]), w0, gain=db(-31), send=0.5)
    for i, note in enumerate(("F#4", "B4", "C#5")):
        bus.add(piano(hz(note), 5.0, vel=0.45, seed=81 + i), w0 + 0.4 + 1.0 * i, gain=db(-21), pan=0.1,
                send=0.5, echo=0.15)
    # "Something honest." -> the D, and the strings open into the exterior
    r = d20e + 0.25
    bus.add(piano(hz("D5"), 6.0, vel=0.5, seed=85), r, gain=db(-20), pan=0.1, send=0.5, echo=0.2)
    bus.add(piano(hz("D3"), 6.0, vel=0.35, seed=86), r + 0.02, gain=db(-24), send=0.4)
    x2 = INT1
    seq = [(r, "D2 A2 F#3 E4 A4", "D2", -26), (x2, "D2 A2 F#3 C#4 E4 A4", "D1", -20),
           (x2 + (TITLE - x2) * 0.45, "G2 D3 B3 F#4 A4", "G1", -19),
           (TITLE - 1.1, "A2 E3 A3 D4 E4", "A1", -19)]
    for i, (a, spec, bs, g) in enumerate(seq):
        b_ = seq[i + 1][0] if i + 1 < len(seq) else TITLE
        dur = max(0.8, b_ - a) + 1.3
        bus.add(pad(chord(spec), dur, att=1.2 if i else 2.0, rel=1.3, voices=6, detune=9, seed=90 + i,
                    fc=[(0, 1200), (dur * 0.6, 2600 + 400 * i), (dur, 1800)]), a, gain=db(g), send=0.5, space=0.4)
        bus.add(sub(hz(bs), dur, 1.0, 1.2), a, gain=db(-28))
        if i >= 1:
            bus.add(choir(chord(" ".join(spec.split()[-3:])), dur, att=1.0, rel=1.3, seed=95 + i), a,
                    gain=db(-25), space=0.7)
    # title: taiko + soft braam on the boom, the suspended B chord, a timpani roll into it
    rng = np.random.default_rng(99)
    tt, i = TITLE - 1.0, 0
    while tt < TITLE - 0.02:
        u = (tt - (TITLE - 1.0))
        bus.add(timpani(hz("F#1"), 2.0, vel=0.4 + 0.6 * u, seed=900 + i), tt, gain=db(-30 + 12 * u), send=0.3)
        tt += 0.11 - 0.05 * u + rng.uniform(-0.01, 0.01)
        i += 1
    bus.add(taiko(1.35, seed=97), TITLE, gain=db(-17), space=0.5)
    bus.add(braam(chord("B1 B2 F#3"), 4.0, seed=98, drive=1.3, att=0.05, rel=2.5,
                  fc=((0, 300), (0.2, 1400), (1.5, 700), (4.0, 300))), TITLE, gain=db(-21), send=0.3, space=0.5)
    th = CRED[0] - TITLE
    bus.add(pad(chord("B1 B2 F#3 C#4 F#4 B4"), th + 1.0, att=0.6, rel=1.8, voices=6, detune=9, seed=100,
                fc=[(0, 1000), (th * 0.5, 2000), (th + 1.0, 900)]), TITLE, gain=db(-22), send=0.6, space=0.4)
    bus.add(choir(chord("B3 F#4 C#5"), th + 1.0, att=1.5, rel=1.8, seed=101, vowel="o"), TITLE, gain=db(-26),
            space=0.9)
    for i, note in enumerate(("F#5", "B5", "C#6")):
        bus.add(piano(hz(note), 5.0, vel=0.4, seed=110 + i), TITLE + 1.2 + 0.7 * i, gain=db(-22), send=0.5, echo=0.2)
    # credits: Gmaj9 -> D, the motif complete this time
    c0, c1 = CRED
    for i, (a, spec, bs) in enumerate(((c0, "G1 G2 D3 A3 B3 F#4", "G1"), (c0 + (c1 - c0) * 0.5, "D2 A2 F#3 E4 A4", "D2"))):
        dur = (c1 - c0) * 0.5 + 2.0
        bus.add(pad(chord(spec), dur, att=1.6, rel=2.4, voices=5, detune=9, seed=120 + i,
                    fc=[(0, 1000), (dur * 0.5, 1800), (dur, 800)]), a, gain=db(-25), send=0.6, space=0.3)
        bus.add(sub(hz(bs), dur, 1.2, 2.0), a, gain=db(-30))
    for i, note in enumerate(("F#4", "B4", "C#5", "D5")):
        bus.add(piano(hz(note), 5.0, vel=0.45, seed=130 + i), c0 + 0.5 + 0.8 * i, gain=db(-21), pan=0.1,
                send=0.5, echo=0.2)
    gate = [(t0, 0), (DUR - 3.2, 0), (DUR - 1.0, -24), (DUR - 0.12, -120)]
    return bus.render(hall, space, gate=gate, echo_delay=0.55, echo_fb=0.45), t0


def render_music(hall, space):
    out = np.zeros((2, N))
    for name, fn in (("open", music_open), ("signal", music_signal), ("fold", music_fold),
                     ("visitor", music_visitor), ("end", music_end)):
        t = time.time()
        seg, t0 = fn(hall, space)
        place(out, seg, t0)
        print(f"  music {name}: {time.time() - t:4.1f}s")
    return out


# ---------------------------------------------------------------------------

STEM_NAMES = ("music", "typing", "monitor", "foley", "amb", "alarm", "fx")


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


def main():
    t_all = time.time()
    os.makedirs(STEMS, exist_ok=True)
    print(f"dialogue lengths from {'manifest' if MAN else 'timeline targets (no manifest yet)'}")
    hall = make_ir(5.0, rt_low=3.6, rt_mid=3.0, rt_high=1.4, predelay=0.025, seed=11, width=1.0)
    space = make_ir(8.0, rt_low=6.5, rt_mid=5.5, rt_high=2.4, predelay=0.05, seed=21, width=1.0, onset=0.03)
    room = make_ir(0.9, rt_low=0.5, rt_mid=0.4, rt_high=0.2, predelay=0.004, seed=12, er_span=0.025, width=0.8)
    jobs = {"typing": lambda: render_typing(room), "monitor": lambda: render_monitor(room),
            "foley": lambda: render_foley(room), "amb": lambda: render_amb(hall, room),
            "alarm": lambda: render_alarm(hall, room), "fx": lambda: render_fx(hall, space, room),
            "music": lambda: render_music(hall, space)}
    for name in STEM_NAMES:
        t = time.time()
        x = jobs[name]()
        print(f"{name:8s}{time.time() - t:5.1f}s")
        check_and_write(name, x)
        del x
    print(f"total render {time.time() - t_all:.1f}s")


if __name__ == "__main__":
    main()
