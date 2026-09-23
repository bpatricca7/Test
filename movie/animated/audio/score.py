#!/usr/bin/env python3
"""ECHO (animated cut, 3:05) — score and sound design, synthesized from scratch.

Renders four stems (48 kHz, stereo, float32, exactly 185.0 s) to
movie/animated/build/stems/{music,typing,signal,sfx}.wav, placing every
event from movie/animated/build/timeline.json.

Musical design
--------------
* Same tuning as the first cut: B5 = 1000 Hz (the signal's bit-0 tone), so
  the bit-1 tone (1420 Hz) is a tritone above the tonic.
* Two keys for two directions. 1974 (sending) is D major: hopeful, the
  echo motif F#-B-C#-D resolves onto the tonic. 2026 (receiving) is B minor,
  where the same four notes end on the minor third. Recognition returns to
  D major ("it was ours"), the bloom lifts G -> B major, and the ending
  leaves the motif hanging on C# over a suspended B.
* Bigger than the first cut: braams, taiko, timpani rolls, crash cymbals,
  an accelerating organ/pluck ostinato for the powers-of-ten journey, a
  horn-and-choir theme for the launch, and a second, longer "space" reverb.

Run:  python3 movie/animated/audio/score.py
"""

import json
import os
import sys
import time

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from instruments import (SR, TAU, hz, chord, db, tvec, ramp_db, fade_env, smooth_noise,  # noqa: E402
                         pan_gains, to_stereo, lp, hp, bp, tv_filter, pink, brown, convolve_stereo,
                         one_pole_smooth, Bus, place, pad, choir, bell, pluck, piano, sub, thump,
                         shepard_rise, organ, spiccato, braam, taiko, timpani, cymbal, noise_sweep,
                         reverse_swell, boom, sub_drop, shockwave, whoosh, relay_clunk, electric_hum,
                         crickets, frogs, servo, buzzer, glass, tick, shimmer, key_click)
from dsp import make_ir, write_wav_float  # noqa: E402

BUILD = os.path.join(os.path.dirname(HERE), "build")
STEMS = os.path.join(BUILD, "stems")
with open(os.path.join(BUILD, "timeline.json")) as _f:
    TL = json.load(_f)
DUR = float(TL["duration"])
N = int(round(DUR * SR))
C = TL["cues"]

MUSIC_TRIM_DB = -4.5

# fold clock: one 16th note = two row landings (row_stagger 0.07 s)
FOLD_STEP = 2 * TL["fold"]["row_stagger"]
FOLD_K0 = TL["fold"]["fold"]["start"] + TL["fold"]["row_flight"]  # first landing, 106.1


def fk(k):
    return FOLD_K0 + k * FOLD_STEP


def lead(f, dur, seed=0, bright=2200.0):
    """Horn-like lead: a small saw section with a soft filter swell plus an 'o' voice."""
    p = pad([f], dur, att=0.12, rel=min(0.5, dur * 0.4), voices=3, detune=6, seed=seed, spread=0.3,
            fc=[(0, 700), (min(0.3, dur * 0.5), bright), (dur, bright * 0.6)])
    v = choir([f], dur, att=0.1, rel=min(0.5, dur * 0.4), seed=seed + 1, vowel="o", copies=1, spread=0.2)
    return p + 0.8 * v


def timp_roll(bus, t0, t1, f, g0, g1, seed=0, send=0.3, space=0.0):
    rng = np.random.default_rng(seed)
    t, i = t0, 0
    while t < t1:
        u = (t - t0) / max(1e-6, t1 - t0)
        g = g0 + (g1 - g0) * u + rng.uniform(-1.5, 1.0)
        bus.add(timpani(f, 2.0, vel=0.4 + 0.6 * u, seed=seed * 100 + i), t, gain=db(g),
                pan=rng.uniform(-0.15, 0.15), send=send, space=space)
        t += 0.11 - 0.05 * u + rng.uniform(-0.01, 0.01)
        i += 1


def journey_phase_solve():
    """Eighth-note rate that accelerates linearly and lands bar lines on the matched cuts."""
    t0 = C["earth"]
    d1, d2 = C["solar"] - t0, C["galaxy"] - t0
    n1, n2 = 18.0, 40.0  # eighths at 33.0 and at 38.5
    # phi(t) = a*tau + b/2 * tau^2
    A = np.array([[d1, d1 * d1 / 2], [d2, d2 * d2 / 2]])
    a, b = np.linalg.solve(A, [n1, n2])
    return t0, a, b


def journey_eighths(t_end):
    t0, a, b = journey_phase_solve()
    out = []
    k = 0
    while True:
        tau = (-a + np.sqrt(a * a + 2 * b * k)) / b
        if t0 + tau >= t_end:
            break
        out.append((k, t0 + tau))
        k += 1
    return out


# ---------------------------------------------------------------------------
# M1: prologue, valley launch, powers-of-ten journey (0 -> 47)
# ---------------------------------------------------------------------------

def music_m1(hall, space):
    bus = Bus(0.0, 47.2)
    n = bus.n
    t = tvec(n)

    # prologue: a D drone creeping in from black
    f1, f0 = hz("D2"), hz("D1")
    drone = (0.55 * np.sin(TAU * f1 * t) + 0.25 * np.sin(TAU * f1 * 1.004 * t + 1.0)
             + 0.45 * np.sin(TAU * f0 * t) + 0.08 * np.sin(TAU * 2 * f1 * t + 0.4))
    drone *= ramp_db([(0, -110), (1.5, -70), (5, -44), (8.5, -37), (12, -35), (14.5, -40), (16.5, -120)], n)
    bus.add(drone, 0.0, send=0.05)
    bus.add(choir(chord("A4 D5"), 5.6, att=3.0, rel=2.0, seed=1, vowel="o"), 4.8, gain=db(-37), space=0.9)

    # valley: warm D major under the crane, then A with the power-up
    vals = [(9.0, "D2 A2 F#3 E4 A4", "D1", 3.0, 2.6), (11.8, "G2 D3 B3 F#4 A4", "G1", 2.9, 1.6),
            (14.5, "A2 E3 A3 D4 E4", "A1", 2.6, 1.0)]
    for i, (t0, spec, bs, dur, att) in enumerate(vals):
        p = pad(chord(spec), dur + 1.6, att=att, rel=1.6, voices=6, detune=9, seed=10 + i,
                fc=[(0, 900), (dur, 2400), (dur + 1.6, 1600)])
        bus.add(p, t0, gain=db(-19 + 1.5 * i), send=0.5, space=0.25)
        bus.add(sub(hz(bs), dur + 1.6, 1.5, 1.4), t0, gain=db(-28))
        if i:
            bus.add(choir(chord(" ".join(spec.split()[-2:])), dur + 1.6, att=att, rel=1.6, seed=20 + i),
                    t0, gain=db(-29), space=0.6)
    # pre-launch: tremolo strings on A, timpani roll, reverse cymbal
    p = pad(chord("A2 E3 A3 C#4 E4"), 2.6, att=1.8, rel=0.03, voices=5, detune=10, seed=15,
            fc=[(0, 800), (2.6, 3600)], trem=([(0, 8.0), (2.6, 16.0)], 0.5))
    bus.add(p, 14.4, gain=db(-24), send=0.4)
    timp_roll(bus, 15.3, 16.97, hz("A1"), -34, -19, seed=16)
    bus.add(cymbal(1.6, seed=17, reverse=True), 17.0 - 1.6, gain=db(-15), send=0.3)

    # LAUNCH (17.0): braam, taiko, crash, and the theme
    L = C["transmit"]
    bus.level = db(-7.0)
    bus.add(braam(chord("D1 D2 A2 D3 F#3 A3"), 5.5, seed=30), L, gain=db(-10), send=0.35, space=0.35)
    for j, (dt, sz, g) in enumerate([(0.0, 1.25, -9), (0.0, 0.9, -13), (0.4167, 1.0, -14), (0.8333, 1.1, -12)]):
        bus.add(taiko(sz, seed=31 + j), L + dt, gain=db(g), pan=[-0.2, 0.2, -0.3, 0.3][j], send=0.4, space=0.2)
    bus.add(cymbal(5.0, seed=35, decay=1.6), L, gain=db(-12), send=0.4, space=0.3)

    beat = 60.0 / 72.0
    theme = [(L, "D2 A2 F#3 E4 A4 D5", "D1", "D4 F#4 A4", 3.33),
             (L + 4 * beat, "B1 F#2 D3 C#4 F#4 B4", "B1", "B3 D4 F#4", 3.33),
             (L + 8 * beat, "G1 D2 B2 F#3 C#4 D5", "G1", "G3 B3 D4", 1.67),
             (L + 10 * beat, "A1 E2 A2 D3 E4 A4", "A1", "A3 D4 E4", 0.85),
             (L + 11 * beat, "A1 E2 A2 C#3 E4 A4", "A1", "A3 C#4 E4", 0.83)]
    for i, (t0, spec, bs, ch, dur) in enumerate(theme):
        p = pad(chord(spec), dur + 1.4, att=0.25 if i else 0.05, rel=1.4, voices=7, detune=11, seed=40 + i,
                spread=0.95, fc=[(0, 1600), (0.4, 4200), (dur + 1.4, 2600)])
        bus.add(p, t0, gain=db(-13), send=0.45, space=0.35)
        bus.add(choir(chord(ch), dur + 1.4, att=0.3, rel=1.4, seed=50 + i), t0, gain=db(-17), send=0.3, space=0.6)
        bus.add(sub(hz(bs), dur + 1.4, 0.05 if i == 0 else 0.3, 1.2), t0, gain=db(-19))
        br = pad(chord(" ".join(spec.split()[:3])), dur + 1.2, att=0.2, rel=1.2, voices=4, detune=7,
                 seed=60 + i, fc=[(0, 400), (0.5, 1100), (dur + 1.2, 600)], spread=0.3)
        bus.add(br, t0, gain=db(-15), send=0.3)
    # spiccato 8ths driving the theme
    roots = [(L, ["D3", "A3", "D4", "A3"]), (L + 4 * beat, ["B2", "F#3", "B3", "F#3"]),
             (L + 8 * beat, ["G2", "D3", "G3", "D3"]), (L + 10 * beat, ["A2", "E3", "A3", "E3"])]
    for ci, (t0, pat) in enumerate(roots):
        t1 = roots[ci + 1][0] if ci + 1 < len(roots) else C["earth"]
        k = 0
        while t0 + k * beat / 2 < t1 - 0.05:
            tt = t0 + k * beat / 2
            bus.add(spiccato(hz(pat[k % 4]), 0.22, seed=70 + ci * 40 + k), tt,
                    gain=db(-19 if k % 2 == 0 else -22), send=0.25)
            k += 1
    melody = [(0.45, "F#4", 0.8), (1.45, "B4", 0.8), (2.45, "C#5", 0.8), (3.45, "D5", 2.4),
              (6.1, "E5", 0.8), (7.1, "D5", 0.55), (8.0, "B4", 1.8), (10.0, "A4", 0.9),
              (11.0, "C#5", 0.95), (12.0, "D5", 2.8)]
    for i, (b, note, d) in enumerate(melody):
        bus.add(lead(hz(note), d + 0.3, seed=80 + i), L + b * beat, gain=db(-12), pan=0.1,
                send=0.4, space=0.4)
        bus.add(lead(hz(note) / 2, d + 0.3, seed=90 + i, bright=1500), L + b * beat, gain=db(-17), pan=-0.1,
                send=0.3, space=0.2)

    # JOURNEY: accelerating ostinato, bass descending in thirds, matched-cut hits
    bus.level = db(-4.5)
    J = [(C["earth"], "D2 A2 F#3 C#4 E4 A4", "D1", "D4 F#4 A4 C#5 E5 A5"),
         (30.0, "B1 F#2 D3 A3 C#4 B4", "B1", "B3 D4 F#4 A4 C#5 F#5"),
         (C["solar"], "G1 D2 B2 F#3 A3 D5", "G1", "G3 B3 D4 F#4 A4 D5"),
         (35.75, "E2 B2 G3 D4 F#4 E5", "E1", "E4 G4 B4 D5 F#5 G5"),
         (C["galaxy"], "C2 G2 E3 B3 F#4 G4 F#5", "C2", "C4 E4 G4 B4 F#5 G5"),
         (41.5, "A1 E2 A2 D3 E4 A4 E5", "A1", "A3 D4 E4 A4 D5 E5"),
         (43.5, "A1 E2 A2 C#3 E4 B4 E5", "A1", "A3 C#4 E4 A4 B4 E5")]
    j_end = 47.0
    for i, (t0, spec, bs, arp) in enumerate(J):
        t1 = J[i + 1][0] if i + 1 < len(J) else j_end
        dur = t1 - t0 + 1.5
        stage = 0 if t0 < C["solar"] else (1 if t0 < C["galaxy"] else 2)
        p = pad(chord(spec), dur, att=0.9, rel=1.5, voices=7, detune=10, seed=100 + i, spread=0.95,
                fc=[(0, 1400 + 600 * stage), (dur * 0.6, 3200 + 800 * stage), (dur, 2000)])
        bus.add(p, t0, gain=db([-17, -16, -14.5][stage]), send=0.35, space=0.5)
        bus.add(sub(hz(bs), dur, 0.6, 1.4), t0, gain=db(-23 + stage))
        if stage >= 1:
            bus.add(choir(chord(" ".join(spec.split()[-3:])), dur, att=0.8, rel=1.5, seed=120 + i),
                    t0, gain=db(-20 + stage), space=0.7)
        if stage == 2:
            hi = pad([2 * f for f in chord(" ".join(spec.split()[-3:]))], dur, att=1.0, rel=1.5, voices=5,
                     detune=8, seed=130 + i, fc=[(0, 3000), (dur, 6000)])
            bus.add(hi, t0, gain=db(-22), space=0.6)
            br = pad(chord(" ".join(spec.split()[:3])), dur, att=0.5, rel=1.4, voices=4, detune=8, seed=140 + i,
                     fc=[(0, 500), (0.8, 1500), (dur, 800)], spread=0.3)
            bus.add(br, t0, gain=db(-15), send=0.3)
    # horn line
    for i, (tt, note, d) in enumerate([(C["solar"] + 0.1, "D5", 2.6), (35.8, "E5", 2.6),
                                       (C["galaxy"] + 0.05, "F#5", 2.9), (41.5, "E5", 1.9), (43.5, "C#5", 2.4)]):
        bus.add(lead(hz(note), d, seed=150 + i, bright=3000), tt, gain=db(-15), send=0.35, space=0.5)
    ARP = [0, 2, 4, 5, 3, 1, 4, 2]
    for k, tt in journey_eighths(45.6):
        ci = max(i for i, row in enumerate(J) if row[0] <= tt + 1e-6)
        tones = [hz(x) for x in J[ci][3].split()]
        f = tones[ARP[k % 8] % len(tones)]
        stage = 0 if tt < C["solar"] else (1 if tt < C["galaxy"] else 2)
        g = -24 + 2.5 * stage + (1.0 if k % 2 == 0 else -1.0)
        bus.add(organ([f], 0.26, att=0.004, rel=0.08, seed=200 + k, leslie=0.05), tt, gain=db(g - 3),
                pan=0.35 * np.sin(k * 0.9), send=0.3, space=0.25)
        bus.add(pluck(f, 0.7, decay=0.22), tt, gain=db(g - 2), pan=-0.35 * np.sin(k * 0.9), send=0.25)
        if stage >= 1:
            bs = hz(J[ci][2]) * 2
            bus.add(spiccato(bs * (2 if k % 4 == 2 else 1), 0.18, seed=300 + k), tt, gain=db(-22 + 2 * stage), send=0.2)
        if (stage == 1 and k % 4 == 0) or (stage == 2 and k % 2 == 0):
            bus.add(taiko(1.0 if k % 8 == 0 else 0.8, seed=400 + k), tt,
                    gain=db((-19 if stage == 1 else -16) + (2 if k % 8 == 0 else 0)),
                    pan=0.25 * np.sin(k), send=0.35, space=0.15)
    # matched-cut hits
    for tt, sd in ((C["solar"], 500), (C["galaxy"], 510)):
        bus.add(cymbal(1.2, seed=sd, reverse=True), tt - 1.2, gain=db(-17), send=0.3)
        bus.add(taiko(1.3, seed=sd + 1), tt, gain=db(-12.5), send=0.4, space=0.3)
        bus.add(cymbal(4.0, seed=sd + 2, decay=1.3), tt, gain=db(-17), send=0.3, space=0.4)
        bus.add(braam(chord("G1 G2 D3" if tt < 35 else "C2 G2 C3 E3"), 3.5, seed=sd + 3, drive=1.6), tt,
                gain=db(-17), send=0.3, space=0.4)
    # climax fill into the fade
    timp_roll(bus, 43.3, 45.3, hz("A1"), -27, -17, seed=520)
    bus.add(cymbal(2.0, seed=530, reverse=True), 43.5, gain=db(-14), space=0.4)
    bus.add(cymbal(5.0, seed=531, decay=2.0), 45.5, gain=db(-15), space=0.8)
    bus.add(taiko(1.35, seed=532), 45.5, gain=db(-14), space=0.6)

    gate = [(0, 0), (45.6, 0), (46.3, -18), (46.9, -120)]
    return bus.render(hall, space, gate=gate, echo_delay=0.5, echo_fb=0.45)


# ---------------------------------------------------------------------------
# M2: 52 years later, the observatory, the arrival, the signal (hard cut 93.3)
# ---------------------------------------------------------------------------

def music_m2(hall, space):
    t_start, cut = C["black_later"], C["silence"]
    bus = Bus(t_start, cut + 1.0)
    n = bus.n
    t = tvec(n, t_start)

    f1, f0 = hz("B1"), hz("B0")
    drone = (0.55 * np.sin(TAU * f1 * t) + 0.25 * np.sin(TAU * f1 * 1.004 * t + 1.0)
             + 0.45 * np.sin(TAU * f0 * t) + 0.08 * np.sin(TAU * 2 * f1 * t + 0.4))
    drone *= ramp_db([(t_start, -120), (47.5, -70), (50.5, -44), (54, -36), (62, -32), (64, -30),
                      (74, -30), (85, -27), (cut, -22)], n, t_start)
    bus.add(drone, t_start, send=0.05)

    # observatory: cold B minor pads, the bell motif with echoes
    obs = [(54.0, "B2 F#3 D4 A4 C#5", "B1", 4.5, 2.2), (58.5, "G2 D3 B3 F#4 A4", "G1", 3.5, 1.8),
           (62.0, "F#2 C#3 B3 E4 C#5", "F#1", 2.1, 1.2)]
    for i, (t0, spec, bs, dur, att) in enumerate(obs):
        p = pad(chord(spec), dur + 1.6, att=att, rel=1.6, voices=5, detune=9, seed=600 + i,
                fc=[(0, 900), (dur * 0.6, 2400), (dur + 1.6, 1300)])
        bus.add(p, t0, gain=db(-17), send=0.6)
        bus.add(sub(hz(bs), dur + 1.6, 1.8, 1.6), t0, gain=db(-27))
        bus.add(choir([2 * hz(x) for x in spec.split()[-2:]], dur + 1.6, att=att + 0.4, rel=1.6,
                      seed=610 + i, vowel="o"), t0, gain=db(-30), send=0.9)
    for i, (tt, note) in enumerate([(55.0, "F#5"), (55.85, "B5"), (56.7, "C#6"), (57.55, "D6")]):
        bus.add(bell(hz(note), 4.0, decay=1.6), tt, gain=db(-26), pan=0.35 * (-1) ** i, send=0.5, echo=0.45)
    # anticipation
    A0 = C["arrival"]
    sr = shepard_rise(A0 - 61.3, hz("B2"), seed=620, fc=(600, 5000))
    sr *= ramp_db([(0, -44), (A0 - 61.3, -22)], sr.shape[1])
    bus.add(sr, 61.3, send=0.4)
    p = pad(chord("B3 C4 F#4"), A0 - 61.0, att=1.5, rel=0.02, voices=4, detune=12, seed=621,
            fc=[(0, 1200), (A0 - 61.0, 4500)], trem=([(0, 6.0), (A0 - 61.0, 18.0)], 0.6))
    p *= ramp_db([(0, -36), (A0 - 61.0, -19)], p.shape[1])
    bus.add(p, 61.0, send=0.5)
    bus.add(cymbal(1.5, seed=622, reverse=True), A0 - 1.5, gain=db(-14), send=0.3)
    timp_roll(bus, 62.8, A0 - 0.03, hz("F#1"), -32, -18, seed=623)

    # ARRIVAL (64.0): the signal lands
    bus.level = db(-9.0)
    bus.add(braam(chord("B1 F#2 B2 D3 C4"), 6.0, seed=630, drive=2.4), A0, gain=db(-12), send=0.4, space=0.5)
    for j, (dt, sz, g) in enumerate([(0.0, 1.35, -11), (0.75, 1.1, -15), (1.5, 1.1, -17), (2.25, 1.1, -19)]):
        bus.add(taiko(sz, seed=631 + j), A0 + dt, gain=db(g), pan=0.2 * (-1) ** j, send=0.4, space=0.3)
    bus.add(cymbal(5.0, seed=640, decay=1.8), A0, gain=db(-14), send=0.3, space=0.5)
    bus.add(timpani(hz("B1"), 4.0, vel=1.0, seed=641), A0 + 0.02, gain=db(-16), send=0.4)
    # aftermath: eerie harmonics, low 'u' voices, falling bells
    bus.level = db(-2.5)
    dur = 74.6 - (A0 + 0.4)
    hi = pad(chord("B5 C6 F#6"), dur, att=2.5, rel=1.5, voices=3, detune=6, seed=650,
             fc=[(0, 4000), (dur, 6000)], trem=(5.5, 0.35))
    bus.add(hi, A0 + 0.4, gain=db(-33), send=0.7, pan=-0.1)
    bus.add(choir(chord("B2 F#3 D4"), dur, att=3.0, rel=1.5, seed=651, vowel="u"), A0 + 0.4, gain=db(-24), send=0.6)
    for i, (tt, note) in enumerate([(69.2, "D6"), (70.1, "C#6"), (71.3, "B5")]):
        bus.add(bell(hz(note), 3.5, decay=1.4, idx=1.0), tt, gain=db(-30), pan=-0.3 + 0.3 * i, send=0.6, echo=0.4)

    # SIGNAL: dark pedal opening, tritone tremolo cluster, pulse-locked thumps and taiko
    bus.level = db(-3.0)
    s0 = C["signal_on"]
    dur = cut - s0 + 0.2
    p = pad(chord("B1 F#2 B2 F#3"), dur, att=1.5, rel=0.05, voices=6, detune=14, seed=700, q=1.1,
            fc=[(0, 240), (8, 420), (14, 900), (17.5, 2200), (dur, 4200)])
    p *= ramp_db([(0, -24), (6, -22), (12, -19), (17, -15), (dur, -11.5)], p.shape[1])
    bus.add(p, s0, send=0.35)
    c0 = 80.5
    dur = cut - c0 + 0.2
    p = pad(chord("B3 C4 F4 F#4 C5"), dur, att=4.0, rel=0.05, voices=4, detune=16, seed=701, q=0.9,
            fc=[(0, 700), (dur * 0.7, 2000), (dur, 5000)], trem=([(0, 5.0), (dur, 17.0)], 0.55))
    p *= ramp_db([(0, -34), (7, -28), (10, -22), (dur, -15.5)], p.shape[1])
    bus.add(p, c0, send=0.45)
    times = TL["pulses"]["times"]
    for i in range(0, len(times), 8):
        tt = times[i]
        nxt = times[i + 8] if i + 8 < len(times) else tt + 8 * (times[-1] - times[-2])
        iv = nxt - tt
        dec = min(0.4, 1.3 * iv)
        g = -30 + 14.0 * (tt - times[0]) / (times[-1] - times[0])
        bus.add(thump(hz("B2"), hz("B1"), min(1.6, dec * 5), tau_pitch=0.03, tau_amp=dec, noise=0.1, seed=i),
                tt, gain=db(g), send=0.12)
    for i in range(0, len(times), 16):
        tt = times[i]
        if tt < 82.0:
            continue
        u = (tt - 82.0) / (times[-1] - 82.0)
        nxt = times[i + 16] if i + 16 < len(times) else tt + 0.035
        size = 1.0 if nxt - tt > 0.15 else 0.75
        bus.add(taiko(size, seed=800 + i, dur=1.0), tt, gain=db(-25 + 10 * u - (3 if size < 1 else 0)),
                pan=0.3 * np.sin(i * 0.37), send=0.3)
    # "1,679 pulses." — low brass swell; "The same number we sent." — the motif's first notes, low horns
    bus.add(braam(chord("B1 F#2 B2"), 4.5, seed=810, drive=1.4, att=1.4, rel=1.5,
                  fc=((0, 200), (1.4, 900), (3.0, 600), (4.5, 300))), 84.0, gain=db(-17), send=0.4)
    bus.add(timpani(hz("B1"), 3.0, vel=0.8, seed=811), 89.0, gain=db(-15), send=0.4)
    bus.add(lead(hz("F#3"), 0.95, seed=812, bright=1600), 89.05, gain=db(-13), send=0.4, space=0.3)
    bus.add(lead(hz("B3"), 1.9, seed=813, bright=1600), 89.95, gain=db(-13), send=0.4, space=0.3)
    r0 = 87.3
    dur = cut - r0 + 0.1
    sr = shepard_rise(dur, hz("B2"), layers=6, seed=820, fc=(700, 6500))
    sr *= ramp_db([(0, -46), (dur * 0.7, -31), (dur, -20)], sr.shape[1])
    bus.add(sr, r0, send=0.4)
    bus.add(cymbal(2.4, seed=821, reverse=True), cut - 2.4 + 0.02, gain=db(-16), send=0.2)

    gate = [(t_start, 0), (cut - 0.02, 0), (cut + 0.03, -34), (cut + 0.9, -120)]
    return bus.render(hall, space, gate=gate, echo_delay=0.62, echo_fb=0.5)


# ---------------------------------------------------------------------------
# M3: after the silence, the fold, the orbit, recognition (drop before 133)
# ---------------------------------------------------------------------------

FOLD_CHORDS = [  # (k, pad, arp, root)
    (-72, "B2 F#3 C#4 D4", "B3 D4 F#4 C#5 D5 F#5", "B1"),
    (-40, "G2 D3 B3 F#4 C#5", "G3 B3 D4 F#4 B4 C#5", "G1"),
    (-8, "E2 B2 G3 D4 F#4", "E4 G4 B4 D5 F#5 G5", "E1"),
    (24, "C3 G3 B3 E4 F#4", "C4 E4 G4 B4 E5 F#5", "C2"),
]
ARP16 = [0, 2, 4, 5, 3, 1, 4, 2, 0, 3, 5, 4, 2, 1, 3, 5]


def music_m3(hall, space):
    t_start = C["silence"]
    cue52 = C["came_back_in_52"]
    bus = Bus(t_start, cue52 + 0.1)
    fold_done = C["fold_complete"]
    k_done = (fold_done - FOLD_K0) / FOLD_STEP  # ~42.1

    ring = np.sin(TAU * hz("B5") * tvec(int(5.0 * SR))) * fade_env(int(5.0 * SR), 1.4, 2.8)
    bus.add(ring, 93.7, gain=db(-50), send=0.6)
    bus.add(sub(hz("B0"), 4.0, 2.0, 1.5), 94.8, gain=db(-30))

    # snake + fold: pads on the fold clock with an 8th pump, arps densifying
    bus.level = db(-1.0)
    for i, (k, spec, arp, root) in enumerate(FOLD_CHORDS):
        k_end = FOLD_CHORDS[i + 1][0] if i + 1 < len(FOLD_CHORDS) else k_done
        t0, t1 = fk(k), fk(k_end)
        dur = t1 - t0 + 1.2
        p = pad(chord(spec), dur, att=1.0 if i else 1.5, rel=1.2, voices=5, detune=8, seed=900 + i, q=0.9,
                fc=[(0, 1000), (dur * 0.5, 2200 + 400 * i), (dur, 1400)])
        tt = tvec(p.shape[1], t0)
        pump = 1.0 - 0.3 * np.exp(-np.mod(tt - FOLD_K0, 2 * FOLD_STEP) / 0.08) if k >= -40 else 1.0
        bus.add(p * pump, t0, gain=db([-19, -18, -17.5, -16.5][i]), send=0.45)
        bus.add(sub(hz(root), dur, 0.6, 1.0), t0, gain=db(-27))
        tones = [hz(x) for x in arp.split()]
        for kk in range(k, int(np.ceil(k_end))):
            every = 4 if kk < -40 else (2 if kk < -8 else 1)
            if (kk + 72) % every:
                continue
            g = float(np.interp(kk, [-72, -40, -8, 24, 42], [-29.5, -27, -24.5, -22, -20])) - (0 if kk % 2 == 0 else 2.5)
            bus.add(pluck(tones[ARP16[(kk + 72) % 16] % len(tones)], 0.8, decay=0.25), fk(kk), gain=db(g),
                    pan=0.45 * np.sin(kk * 0.7), send=0.3, echo=0.15)
        if k >= -40:
            for kk in range(k, int(np.ceil(k_end)), 2):
                bs = pad([hz(root) * 2], 0.26, att=0.004, rel=0.15, voices=2, detune=6, seed=kk + 5000,
                         fc=[(0, 900), (0.26, 180)], spread=0.1)
                bus.add(bs, fk(kk), gain=db(-25 if kk % 4 == 0 else -29), send=0.05)
        if k >= -8:
            for kk in range(k, int(np.ceil(k_end)), 4):
                u = (kk + 8) / 50.0
                bus.add(taiko(0.7 if kk % 16 else 1.0, seed=kk + 6000, dur=1.0), fk(kk),
                        gain=db(-25 + 6 * u + (3 if kk % 16 == 0 else 0)), pan=0.25 * np.sin(kk), send=0.3)
    # the motif on bells over the snake
    for kk, note in [(-64, "F#5"), (-60, "B5"), (-56, "C#6"), (-52, "D6")]:
        bus.add(bell(hz(note), 3.5, decay=1.4), fk(kk), gain=db(-27), pan=0.3, send=0.5, echo=0.35)
    # fold crescendo into the lock
    timp_roll(bus, 110.2, fold_done - 0.02, hz("B1"), -30, -15, seed=940)
    bus.add(cymbal(1.8, seed=941, reverse=True), fold_done - 1.8, gain=db(-15), send=0.3)

    # GRID COMPLETE (112): the picture locks
    L = fold_done
    bus.level = db(-5.0)
    bus.add(braam(chord("B1 B2 F#3 D4"), 4.0, seed=950, drive=1.5), L, gain=db(-13), send=0.4, space=0.5)
    bus.add(taiko(1.3, seed=951), L, gain=db(-11), send=0.4, space=0.3)
    bus.add(cymbal(4.5, seed=952, decay=1.8), L, gain=db(-15), space=0.5)
    for j, note in enumerate(["B5", "D6", "F#6", "B6"]):
        bus.add(bell(hz(note), 5.0, decay=2.2, idx=0.9), L + 0.04 * j, gain=db(-26), pan=-0.3 + 0.2 * j,
                send=0.6, echo=0.3)
    # orbit: majestic, then the dominant into recognition
    bus.level = 1.0
    orbit = [(L, "B1 B2 F#3 D4 C#5 F#5", "B1", 2.3), (114.24, "G1 G2 D3 B3 F#4 D5", "G1", 2.2),
             (116.48, "F#1 F#2 C#3 B3 E4 C#5", "F#1", 0.9), (117.36, "F#1 F#2 C#3 A#3 E4 C#5", "F#1", 0.8)]
    for i, (t0, spec, bs, dur) in enumerate(orbit):
        p = pad(chord(spec), dur + 1.8, att=0.4 if i else 0.05, rel=1.8, voices=7, detune=10, seed=960 + i,
                spread=0.95, fc=[(0, 2400), (dur, 3200), (dur + 1.8, 1800)])
        bus.add(p, t0, gain=db(-16), send=0.5, space=0.4)
        bus.add(choir(chord(" ".join(spec.split()[-3:])), dur + 1.8, att=0.5, rel=1.8, seed=970 + i),
                t0, gain=db(-21), space=0.7)
        bus.add(sub(hz(bs), dur + 1.8, 0.3, 1.5), t0, gain=db(-24))
    for j, kk in enumerate(range(0, 34, 4)):
        tt = L + 0.28 * kk / 2
        tones = [hz(x) for x in "B3 D4 F#4 B4 D5 F#5".split()] if tt < 114.24 else \
            [hz(x) for x in "G3 B3 D4 G4 B4 D5".split()]
        bus.add(pluck(tones[ARP16[j] % 6], 0.9, decay=0.35), tt, gain=db(-27), pan=0.3 * np.sin(j), send=0.4, echo=0.2)

    # RECOGNITION: D major returns — the motif resolves, as it did when we sent it
    rec = [(118.0, "D2 A2 F#3 C#4 E4 A4", "D1", 3.5), (121.5, "G2 D3 B3 F#4 A4 D5", "G1", 3.0),
           (124.5, "F#2 D3 A3 E4 F#4 D5", "D2", 2.5), (127.0, "Bb1 Bb2 G3 D4 E4 G4", "Bb1", 3.0),
           (130.0, "F#2 C#3 B3 E4 C#5", "F#1", 1.0), (131.0, "F#2 C#3 A#3 E4 C#5", "F#1", 2.0)]
    gains = [-19, -18.5, -18.5, -17.5, -16, -15]
    for i, (t0, spec, bs, dur) in enumerate(rec):
        p = pad(chord(spec), dur + 2.2, att=1.4 if i else 0.3, rel=2.2, voices=6, detune=9, seed=1000 + i,
                fc=[(0, 1500), (dur, 3500), (dur + 2.2, 2000)])
        bus.add(p, t0, gain=db(gains[i]), send=0.55, space=0.2)
        bus.add(sub(hz(bs), dur + 2.2, 1.0, 1.8), t0, gain=db(-25))
        for j, note in enumerate(spec.split()[1:4]):
            bus.add(piano(hz(note), 4.0, vel=0.35, seed=1010 + i * 10 + j), t0 + 0.04 * j, gain=db(-27),
                    pan=-0.2 + 0.2 * j, send=0.4)
        if i >= 1:
            bus.add(choir(chord(" ".join(spec.split()[-3:])), dur + 2.2, att=1.8, rel=2.2, seed=1060 + i),
                    t0, gain=db(-26), send=0.7)
    melody = [(118.6, "F#4", 0.55), (119.3, "B4", 0.55), (120.0, "C#5", 0.6), (120.7, "D5", 0.7),
              (122.4, "E5", 0.55), (123.05, "D5", 0.55), (123.8, "B4", 0.6),
              (125.0, "A4", 0.5), (125.7, "B4", 0.5), (126.4, "F#4", 0.55),
              (127.0, "D5", 0.6), (127.8, "Bb4", 0.65), (129.0, "A4", 0.5),
              (130.1, "C#5", 0.6), (130.7, "B4", 0.6), (131.3, "A#4", 0.7)]
    for i, (tt, note, vel) in enumerate(melody):
        bus.add(piano(hz(note), 4.5, vel=vel, seed=1100 + i), tt, gain=db(-17), pan=0.1, send=0.45, echo=0.12)
    for i, (tt, note, d) in enumerate([(118.6, "F#4", 0.7), (119.3, "B4", 0.7), (120.0, "C#5", 0.7),
                                       (120.7, "D5", 2.2)]):
        bus.add(lead(hz(note), d, seed=1150 + i, bright=1800), tt, gain=db(-24), pan=-0.15, send=0.5, space=0.3)

    gate = [(t_start, -120), (t_start + 0.05, 0), (cue52 - 1.4, 0), (cue52 - 0.2, -40), (cue52 - 0.05, -120)]
    return bus.render(hall, space, gate=gate, echo_delay=4 * FOLD_STEP, echo_fb=0.42)


# ---------------------------------------------------------------------------
# M4: heartbeat, the difference, the reveal, the push-in (hard cut at 149)
# ---------------------------------------------------------------------------

def music_m4(hall, space):
    cue = C["came_back_in_52"]
    V = TL["visitor"]
    t_cut = V["step_out"]["start"]
    bus = Bus(cue - 0.9, t_cut + 0.3)

    for i, tb in enumerate([cue + 0.95 * i for i in range(6)]):
        g = [-11, -11, -12, -13, -16, -22][i]
        bus.add(thump(78, 46, 0.7, tau_pitch=0.035, tau_amp=0.15, noise=0.12, seed=1200 + i), tb, gain=db(g), send=0.1)
        bus.add(thump(70, 44, 0.6, tau_pitch=0.03, tau_amp=0.12, noise=0.08, seed=1210 + i), tb + 0.27,
                gain=db(g - 5), send=0.1)
    bus.add(np.sin(TAU * hz("F#6") * tvec(int(4.5 * SR))) * fade_env(int(4.5 * SR), 1.5, 2.0), cue,
            gain=db(-58), send=0.8)

    d0 = C["recognition"] + 20.0  # 138.0
    dur = t_cut - d0
    p = pad(chord("B1 C2 F2 B2"), dur, att=2.0, rel=0.05, voices=5, detune=12, seed=1300, q=1.0,
            fc=[(0, 200), (5.0, 380), (7.0, 500), (dur - 3.1, 650), (dur, 3200)])
    p *= ramp_db([(0, -26), (5, -22), (7, -20), (dur - 3.1, -20), (dur, -10)], p.shape[1])
    bus.add(p, d0, send=0.35)
    bus.add(sub(hz("B0"), dur, 3.0, 0.05), d0, gain=db(-27))
    h0 = 139.8
    dur = t_cut - h0
    p = pad(chord("B4 C5 F5"), dur, att=2.5, rel=0.05, voices=3, detune=10, seed=1301,
            fc=[(0, 1800), (dur, 6000)], trem=([(0, 7.0), (dur - 3.1, 9.0), (dur, 22.0)], 0.6))
    p *= ramp_db([(0, -40), (3.2, -34), (dur - 3.1, -32), (dur, -17)], p.shape[1])
    bus.add(p, h0, send=0.6, pan=0.15)

    rv = C["reveal"]
    bus.level = db(-3.5)
    bus.add(cymbal(1.2, seed=1310, reverse=True), rv - 1.2, gain=db(-17), send=0.3)
    bus.add(braam(chord("B1 B2 F3 G#3 C4 F4"), 4.0, seed=1311, drive=2.2), rv, gain=db(-11.5), send=0.6, space=0.4)
    bus.add(taiko(1.3, seed=1312), rv, gain=db(-11), send=0.4, space=0.3)
    bus.add(timpani(hz("B1"), 3.5, vel=1.0, seed=1313), rv, gain=db(-14), send=0.4)
    bus.add(cymbal(4.0, seed=1314, decay=1.5), rv, gain=db(-17), space=0.5)
    for i, tb in enumerate(np.arange(rv + 1.3, 145.95, 0.66)):
        note = "B1" if i % 2 == 0 else "F2"
        bus.add(thump(hz(note) * 1.5, hz(note), 0.9, tau_pitch=0.03, tau_amp=0.3, noise=0.05, seed=1320 + i),
                tb, gain=db(-21), send=0.2)

    z0 = V["push_in"]["start"]
    bus.level = db(1.5)
    tb, iv, i = z0, 0.62, 0
    while tb < t_cut - 0.05:
        g = -19 + 9 * (tb - z0) / (t_cut - z0)
        bus.add(thump(90, 48, 0.5, tau_pitch=0.03, tau_amp=0.1 + 0.05 * iv, noise=0.12, seed=1340 + i),
                tb, gain=db(g), send=0.15)
        if i % 2 == 0:
            bus.add(taiko(0.8, seed=1360 + i, dur=1.0), tb, gain=db(g - 5), send=0.3)
        tb += iv
        iv = max(0.11, iv * 0.86)
        i += 1
    dur = t_cut - z0
    sr = shepard_rise(dur, hz("B2"), layers=6, seed=1380, fc=(800, 7500))
    sr *= ramp_db([(0, -38), (dur * 0.6, -24), (dur, -11)], sr.shape[1])
    bus.add(sr, z0, send=0.4)
    bus.add(cymbal(dur, seed=1381, reverse=True), z0 + 0.02, gain=db(-15), send=0.2)

    gate = [(bus.t0, 0), (t_cut - 0.07, 0), (t_cut - 0.01, -120)]
    return bus.render(hall, space, gate=gate)


# ---------------------------------------------------------------------------
# M5: it steps out, turns, speaks; the bloom (the emotional peak)
# ---------------------------------------------------------------------------

def music_m5(hall, space):
    V = TL["visitor"]
    t0 = V["step_out"]["start"]
    v = C["voice"]
    bus = Bus(t0, 164.0)

    # assembling: a fragile high glass chord (B lydian colours), then the turn
    gl = shimmer([hz(x) for x in ["B5", "C#6", "D#6", "F#6", "A#6"]], 5.0, seed=1400)
    bus.add(gl, t0 + 0.15, gain=db(-27), send=0.4, space=0.8)
    tn0 = V["turn"]["start"]
    p = pad(chord("G1 D2 G2 B2"), V["turn"]["end"] - tn0 + 0.8, att=1.1, rel=0.9, voices=5, detune=8,
            seed=1401, fc=[(0, 200), (1.2, 600), (2.5, 300)], spread=0.6)
    bus.add(p, tn0, gain=db(-24), send=0.3, space=0.4)
    # almost nothing under the voice
    bus.add(sub(hz("G1"), 3.0, 1.0, 0.8), v + 0.1, gain=db(-40))
    bus.add(np.sin(TAU * hz("D6") * tvec(int(2.4 * SR))) * fade_env(int(2.4 * SR), 1.0, 1.0), v + 0.3,
            gain=db(-56), send=0.9)

    b0 = v + 2.3        # ~155.8: the swell begins as the last word ends
    b1 = b0 + 2.1       # ~157.9: bVI -> I, B major, as the picture fades
    bus.add(cymbal(1.4, seed=1410, reverse=True), b0 - 1.3, gain=db(-24), space=0.3)
    d1 = b1 - b0 + 2.4
    bus.add(pad(chord("G2 D3 B3 F#4 A4 D5 B5"), d1, att=1.0, rel=2.4, voices=7, detune=11, seed=1411,
                spread=0.95, fc=[(0, 800), (1.1, 4400), (3.5, 3200)]), b0, gain=db(-7.0), send=0.5, space=0.5)
    bus.add(choir(chord("G3 B3 D4 F#4 A4 D5"), d1, att=1.2, rel=2.4, seed=1412), b0, gain=db(-11), send=0.5, space=0.7)
    bus.add(braam(chord("G1 G2 D3"), d1, seed=1413, drive=1.4, att=0.9, rel=2.2,
                  fc=((0, 250), (1.0, 1000), (3.0, 600), (d1, 400))), b0, gain=db(-13), send=0.4, space=0.3)
    bus.add(sub(hz("G1"), d1, 0.9, 2.2), b0, gain=db(-16))
    bus.add(timpani(hz("G1"), 4.0, vel=0.9, seed=1414), b0 + 0.05, gain=db(-15), send=0.5, space=0.3)
    for j, note in enumerate(["G5", "B5", "D6", "F#6", "A6", "B6"]):
        bus.add(bell(hz(note), 4.0, decay=1.8, idx=1.0), b0 + 0.35 + 0.17 * j, gain=db(-25),
                pan=-0.6 + 0.24 * j, send=0.5, space=0.4, echo=0.3)
    d2 = 164.0 - b1
    bus.add(pad(chord("B2 F#3 D#4 F#4 C#5 D#5 B5"), d2, att=0.9, rel=4.2, voices=7, detune=11, seed=1420,
                spread=0.95, fc=[(0, 2500), (1.2, 3800), (d2, 700)]), b1, gain=db(-11.5), send=0.5, space=0.7)
    bus.add(choir(chord("B3 D#4 F#4 C#5 D#5 F#5"), d2, att=1.0, rel=4.0, seed=1421), b1, gain=db(-13), send=0.5, space=0.9)
    bus.add(braam(chord("B1 B2 F#3"), d2, seed=1422, drive=1.3, att=0.8, rel=3.6,
                  fc=((0, 400), (1.0, 900), (d2, 250))), b1, gain=db(-15), send=0.4, space=0.4)
    bus.add(sub(hz("B1"), d2, 0.8, 3.6), b1, gain=db(-16))
    bus.add(cymbal(5.0, seed=1423, decay=2.0), b1, gain=db(-19), space=0.8)
    for j, note in enumerate(["B5", "D#6", "F#6", "C#7"]):
        bus.add(bell(hz(note), 4.0, decay=2.0, idx=0.8), b1 + 0.1 + 0.21 * j, gain=db(-27),
                pan=0.5 - 0.3 * j, send=0.6, space=0.5, echo=0.35)

    fb = C["fade_to_black"]
    gate = [(t0, -120), (t0 + 0.03, 0), (fb + 0.5, 0), (160.5, -7), (162.5, -22), (163.8, -120)]
    return bus.render(hall, space, gate=gate, echo_delay=0.41, echo_fb=0.45) * db(-2.0)


# ---------------------------------------------------------------------------
# M6: Earth at night, the title, the credits
# ---------------------------------------------------------------------------

def music_m6(hall, space):
    t0 = 159.5
    bus = Bus(t0, DUR)
    th = TL["ending"]["title_particles"]["end"] - 0.2  # the landing, ~173.3
    chords6 = [
        (160.5, "G2 D3 B3 F#4", "G1", 4.5, -25, 2.6),
        (165.0, "F#2 D3 A3 E4", "D2", 4.0, -25, 2.0),
        (169.0, "A1 A2 E3 B3 E4", "A1", th - 169.0, -23, 1.6),
        (th, "B1 B2 F#3 C#4 F#4 B4", "B1", 177.6 - th, -21, 0.6),
        (177.8, "G1 G2 D3 A3 B3 F#4", "G1", 3.2, -24, 1.8),
        (181.0, "B1 B2 F#3 C#4 F#4", "B1", 3.9, -25, 1.8),
    ]
    for i, (tt, spec, bs, dur, g, att) in enumerate(chords6):
        rel = 2.4 if i < len(chords6) - 1 else 3.0
        fcs = [(0, 1000), (dur * 0.5, 2000), (dur + rel, 900)]
        if i == 2:  # the build into the title: the filter opens
            fcs = [(0, 1000), (dur, 5200), (dur + rel, 2000)]
        p = pad(chord(spec), dur + rel * 0.8, att=att, rel=rel, voices=6 if i == 3 else 5, detune=9,
                seed=1500 + i, fc=fcs)
        if i == 2:
            p *= ramp_db([(0, 0), (2.0, 0), (dur, 7)], p.shape[1])
        bus.add(p, tt, gain=db(g), send=0.6, space=0.4 if i >= 2 else 0.1)
        bus.add(sub(hz(bs), dur + rel * 0.8, 1.2, rel), tt, gain=db(-28 if i != 3 else -23))
        if i in (3, 5):
            bus.add(choir(chord("B3 F#4 C#5"), dur + rel * 0.8, att=1.5, rel=rel, seed=1550 + i, vowel="o"),
                    tt, gain=db(-24), send=0.4, space=0.9)
    # into the title: timpani roll, reverse cymbal, then taiko + soft braam on the landing
    timp_roll(bus, th - 1.1, th - 0.02, hz("F#1"), -30, -17, seed=1560)
    bus.add(cymbal(1.5, seed=1561, reverse=True), th - 1.5, gain=db(-17), space=0.3)
    bus.add(taiko(1.35, seed=1562), th, gain=db(-14.5), space=0.5)
    bus.add(braam(chord("B1 B2 F#3"), 4.0, seed=1563, drive=1.3, att=0.05, rel=2.5,
                  fc=((0, 300), (0.2, 1400), (1.5, 700), (4.0, 300))), th, gain=db(-17), send=0.3, space=0.5)

    melody = [(161.0, "F#4", 0.5), (161.7, "B4", 0.5), (162.4, "C#5", 0.55),
              (164.4, "G3", 0.3), (164.65, "D4", 0.3), (164.9, "B4", 0.35),
              (166.9, "E5", 0.5), (167.6, "D5", 0.45), (168.3, "C#5", 0.5), (169.5, "A4", 0.45),
              (170.3, "B4", 0.45), (170.9, "C#5", 0.5),
              (174.8, "F#5", 0.4), (175.5, "B5", 0.4), (176.2, "C#6", 0.45),
              (178.3, "F#4", 0.45), (179.0, "B4", 0.45), (179.7, "C#5", 0.5),
              (181.3, "B3", 0.35), (181.6, "F#4", 0.35)]
    for i, (tt, note, vel) in enumerate(melody):
        bus.add(piano(hz(note), 5.0, vel=vel, seed=1600 + i), tt, gain=db(-18), pan=0.12, send=0.5, echo=0.2)

    gate = [(t0, 0), (182.2, 0), (183.9, -24), (184.85, -120)]
    return bus.render(hall, space, gate=gate, echo_delay=0.7, echo_fb=0.45)


def render_music(hall, space):
    out = np.zeros((2, N))
    parts = [("m1", music_m1, 0.0), ("m2", music_m2, C["black_later"]), ("m3", music_m3, C["silence"]),
             ("m4", music_m4, C["came_back_in_52"] - 0.9), ("m5", music_m5, TL["visitor"]["step_out"]["start"]),
             ("m6", music_m6, 159.5)]
    for name, fn, start in parts:
        t = time.time()
        place(out, fn(hall, space) * db(MUSIC_TRIM_DB), start)
        print(f"  music {name}: {time.time() - t:5.1f}s")
    return out


# ---------------------------------------------------------------------------
# Typing
# ---------------------------------------------------------------------------

SLOT_PAN = {"center": 0.0, "center-high": 0.0, "lower": 0.0}
BLACK = [(0.0, 9.0), (47.0, 54.0)]  # black-screen typewriter beats: a little more present


def render_typing(room_ir):
    rng = np.random.default_rng(7)
    out = np.zeros((2, N))
    wet = np.zeros((2, N))
    for cue in TL["text"]:
        base_pan = SLOT_PAN.get(cue["slot"], 0.18)
        heavy = cue.get("style") == "emph"
        lvl = db(2.0) if any(a <= cue["start"] < b for a, b in BLACK) else 1.0
        for ch, tt in zip(cue["text"], cue["char_times"]):
            y = key_click(rng, heavy=heavy, space=(ch == " "))
            st = to_stereo(y, float(np.clip(base_pan + rng.uniform(-0.22, 0.22), -1, 1))) * 0.45 * lvl
            place(out, st, tt)
            place(wet, st * 0.35, tt)
    return out + convolve_stereo(wet, room_ir, N)


# ---------------------------------------------------------------------------
# Signal: the 1974 beam (sent bits) and the 2026 reply (FSK pulses via radio)
# ---------------------------------------------------------------------------

def fsk_stream(times, bits, t_a, n, f_one, f_zero, tau=0.00025, stop=None, period=None):
    tt = t_a + np.arange(n) / SR
    times = np.asarray(times)
    idx = np.searchsorted(times, tt, side="right") - 1
    if period is not None:
        after = tt > times[-1]
        idx[after] = (len(times) - 1 + ((tt[after] - times[-1]) / period).astype(int)) % len(times)
    idx = np.clip(idx, 0, len(times) - 1)
    f = np.where(np.asarray(bits)[idx] == 1, f_one, f_zero).astype(float)
    f = one_pole_smooth(f, tau)
    y = np.sin(TAU * np.cumsum(f) / SR)
    if stop is not None:
        y[tt >= stop] = 0.0
    return y, f


def render_signal(hall, room):
    rng = np.random.default_rng(1679)
    out = np.zeros((2, N))
    P = TL["pulses"]
    f_one, f_zero = P["freq_one"], P["freq_zero"]

    # --- 1974: the sent picture streams up the beam, 240 bits/s, clean and bright
    v = TL["valley"]
    tb0, tb1 = v["transmit"]["start"], v["transmit"]["end"]
    bits_sent = v["bits"]
    btimes = tb0 + np.arange(len(bits_sent)) * (tb1 - tb0) / len(bits_sent)
    n = int((tb1 - tb0 + 0.3) * SR)
    y, finst = fsk_stream(btimes, bits_sent, tb0, n, f_one, f_zero, tau=0.0004)
    t = tvec(n)
    y2 = np.sin(TAU * np.cumsum(finst / 2.0) / SR)  # octave-down body
    beam = 0.8 * y + 0.35 * y2
    beam *= (0.85 + 0.15 * np.sin(TAU * 7.0 * t)) * ramp_db([(0, -30), (0.06, 0), (tb1 - tb0 - 1.5, 0),
                                                            (tb1 - tb0, -4), (tb1 - tb0 + 0.2, -120)], n)
    st = np.stack([beam, beam]) * 0.32  # centred: an inter-channel delay would cancel the tones in mono
    st = st + 0.3 * convolve_stereo(st, hall, n)
    place(out, st, tb0)

    # --- 2026: the reply, 1,679 pulses through a radio receiver
    times = np.array(P["times"])
    bits = np.array(P["bits"])
    r0, r1 = C["signal_on"], C["silence"]
    p_end = C["pulses_end"]
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
    stop = p_end + lengths[-1]  # the stream stops dead with the last pulse (~93.0)
    stream, _ = fsk_stream(times, bits, t_a, n, f_one, f_zero, stop=stop)
    stream *= ramp_db([(t_a, -120), (88.0, -120), (90.5, -24), (92.3, -12), (stop, -6)], n, t_a)
    k = int(0.004 * SR)
    si = int((stop - t_a) * SR)
    stream[si - k:si] *= np.linspace(1, 0, k)
    x += 0.5 * stream
    x *= ramp_db([(t_a, -3), (85, -2), (p_end, 0)], n, t_a)
    d = int(0.0023 * SR)
    x[d:] += 0.22 * x[:-d]
    x = bp(x, 280.0, 3300.0, order=3)
    x = np.tanh(1.6 * x) / np.tanh(1.6)
    x = bp(x, 300.0, 3600.0, order=2)
    x *= 0.72 + 0.28 * smooth_noise(n, 0.9, rng)
    static = bp(rng.standard_normal(n), 300.0, 3400.0, order=2) * (0.6 + 0.4 * smooth_noise(n, 1.7, rng))
    crack = np.zeros(n)
    kk = rng.poisson(6 * n / SR)
    crack[rng.integers(0, n, kk)] = rng.lognormal(0, 0.8, kk) * rng.choice([-1, 1], kk)
    static += bp(crack, 800.0, 5000.0) * 4.0
    static *= ramp_db([(t_a, -120), (r0, -120), (r0 + 0.8, -30), (86, -31), (r1, -27)], n, t_a)
    x += static
    gate = ramp_db([(t_a, -120), (r0 - 0.02, -120), (r0 + 0.02, 0), (r1 - 0.015, 0), (r1 + 0.025, -120)], n, t_a)
    x *= gate
    st = np.stack([x, x])  # centred for mono compatibility; the room reverb supplies the width
    st = (st + 0.12 * convolve_stereo(st, room, n)) * gate * 0.85
    place(out, st, t_a)
    return out


# ---------------------------------------------------------------------------
# SFX & ambience
# ---------------------------------------------------------------------------

def rings_sound(seed=0):
    """A ring of signal descending into the dish: falling tone + band noise."""
    rng = np.random.default_rng(seed)
    dur = 1.5
    n = int(dur * SR)
    t = tvec(n)
    f = 1500.0 * (0.2 ** np.clip(t / 1.1, 0, 1))
    ph = np.cumsum(f) / SR
    env = (1 - np.exp(-t / 0.04)) * np.exp(-t / 0.5)
    y = (np.sin(TAU * ph) + 0.5 * np.sin(TAU * 1.5 * ph + 1.0)) * env
    y += 1.5 * tv_filter(rng.standard_normal(n), f * 1.3, 4.0, kind="bp") * env
    return np.stack([y, np.roll(y, int(0.003 * SR))]) * fade_env(n, 0.002, 0.2)


def render_sfx(hall, space, room):
    rng = np.random.default_rng(2024)
    out = np.zeros((2, N))
    hs = np.zeros((2, N))
    ss = np.zeros((2, N))
    rs = np.zeros((2, N))

    def add(sig, t0, gain=1.0, pan=0.0, hall_s=0.0, space_s=0.0, room_s=0.0):
        st = to_stereo(np.asarray(sig, dtype=float), pan) * gain
        place(out, st, t0)
        if hall_s:
            place(hs, st * hall_s, t0)
        if space_s:
            place(ss, st * space_s, t0)
        if room_s:
            place(rs, st * room_s, t0)

    # hiss / room tone bed: 1974 tape hiss, later a faint receiver hiss
    hiss = bp(rng.standard_normal((2, N)), 1200.0, 9000.0, order=2) * smooth_noise(N, 0.6, rng, 0.6, 1.0)
    sil = C["silence"]
    hiss *= ramp_db([(0, -110), (0.6, -56), (8.5, -57), (10.5, -72), (46.5, -72), (47.5, -54), (53.5, -55),
                     (56, -63), (sil, -63), (sil + 0.03, -76), (96, -70), (133, -70), (134, -67), (138, -70),
                     (160, -71), (184, -72), (184.9, -120)], N)
    out += hiss
    n9 = int(9.5 * SR)
    add(electric_hum(9.5, hz("A1"), seed=1) * fade_env(n9, 1.5, 1.2), 0.0, gain=db(-58))

    # valley: jungle night
    j0, j1 = C["valley_in"], 27.0
    nj = int((j1 - j0) * SR)
    jungle = crickets(j1 - j0, seed=3) * 0.5 + frogs(j1 - j0, seed=4, rate=0.9) * 0.35
    leaves = tv_filter(pink((2, nj), rng), 500 + 500 * smooth_noise(nj, 0.15, rng), 0.8, kind="bp")
    leaves *= 0.3 + 0.7 * smooth_noise(nj, 0.2, rng) ** 1.5
    jungle += leaves * 0.35
    jungle *= ramp_db([(j0, -120), (j0 + 0.1, -50), (11.5, -24), (16.8, -24), (17.3, -32), (20.5, -33),
                       (25.5, -50), (j1, -120)], nj, j0)
    add(jungle, j0, hall_s=0.15)
    # an owl, far away
    for k, (to, f) in enumerate([(12.4, 400.0), (12.75, 355.0)]):
        m = int(0.4 * SR)
        tt = tvec(m)
        y = np.sin(TAU * f * (1 - 0.04 * tt) * tt) * np.sin(np.pi * tt / tt[-1]) ** 1.5
        add(lp(y, 1500.0), to, gain=db(-34), pan=-0.6, hall_s=0.5)

    # power-up: relays, aviation lights, a hum and a rising whine
    pu = C["power_up"]
    for k, (dt, size) in enumerate([(0.0, 1.3), (0.18, 1.0), (0.46, 0.85), (0.9, 1.1)]):
        add(relay_clunk(seed=10 + k, size=size), pu + dt, gain=db(-17), pan=[-0.3, 0.2, 0.4, -0.1][k], hall_s=0.4)
    L = C["transmit"]
    dh = 27.0 - pu
    nh = int(dh * SR)
    hum = electric_hum(dh, hz("A1"), seed=11, bright=1.0)
    hum *= ramp_db([(pu, -120), (pu + 0.05, -34), (L - 0.3, -24), (L, -22), (23.0, -26), (26.5, -45), (27.0, -120)],
                   nh, pu)
    add(hum, pu, hall_s=0.2)
    nw = int((L - pu - 0.1) * SR)
    tw = tvec(nw)
    fw = hz("A4") * (4.0 ** ((tw / tw[-1]) ** 1.6))
    whine = (np.sin(TAU * np.cumsum(fw) / SR) + 0.3 * np.sin(TAU * np.cumsum(2 * fw) / SR))
    whine *= ramp_db([(0, -40), (tw[-1], -24)], nw) * fade_env(nw, 0.3, 0.03)
    add(whine, pu + 0.1, hall_s=0.3)
    # the launch: reverse swell, boom, shockwave, sub drop, and the beam's roar
    add(reverse_swell(1.1, rng, 300, 9000) * db(-26), L - 1.1)
    add(boom(8.0, 85.0, 27.0, seed=12), L, gain=db(-17.5), hall_s=0.25, space_s=0.2)
    add(shockwave(3.5, seed=13), L, gain=db(-19.5), hall_s=0.3, space_s=0.3)
    add(sub_drop(3.0, 120.0, 28.0), L, gain=db(-20))
    db0, db1 = L, 26.5
    nb = int((db1 - db0) * SR)
    tb = tvec(nb)
    roar = tv_filter(pink((2, nb), rng), 700 + 400 * smooth_noise(nb, 0.5, rng), 0.7, kind="bp")
    roar += 0.5 * lp(brown((2, nb), rng), 160.0)
    roar *= 1 - 0.25 * (0.5 + 0.5 * np.sin(TAU * 13.0 * tb))
    roar = tv_filter(roar, np.interp(tb, [0, 5.5, 9.5], [6000, 3500, 500]), 0.7, kind="lp")
    roar *= ramp_db([(0, -120), (0.05, -24), (5.5, -27), (8.5, -36), (db1 - db0, -120)], nb)
    add(roar, db0, hall_s=0.3, space_s=0.3)

    # journey: space rumble, the pass-bys at the matched cuts
    e0 = C["earth"]
    nr = int((47.0 - e0) * SR)
    rum = lp(brown((2, nr), rng), 90.0) * ramp_db([(e0, -120), (e0 + 0.5, -40), (44.5, -30), (45.8, -32),
                                                   (46.8, -120)], nr, e0)
    add(rum, e0)
    add(whoosh(2.0, seed=20, f_lo=250, f_hi=3000, center=0.8, pan0=0.6, pan1=-0.4, low=0.3), e0 - 1.6,
        gain=db(-22), space_s=0.3)
    for k, tc in enumerate((C["solar"], C["galaxy"])):
        d = 2.6
        add(whoosh(d, seed=21 + k, f_lo=160, f_hi=4200, center=0.72, pan0=-0.9 if k else 0.9,
                   pan1=0.9 if k else -0.9, q=1.0, low=0.8), tc - 0.72 * d, gain=db(-16), space_s=0.35)
        add(boom(5.0, 70.0, 30.0, seed=23 + k, tau=1.4), tc, gain=db(-18.5), space_s=0.3)

    # 52 years later: the observatory ridge
    o0, o1 = C["observatory_in"], 74.0
    no = int((o1 - o0 + 0.5) * SR)
    src = pink((2, no), rng)
    wind = tv_filter(src, 330 + 520 * smooth_noise(no, 0.12, rng), 0.9, kind="bp")
    wind += 0.6 * lp(brown((2, no), rng), 220.0)
    wind += 0.25 * tv_filter(rng.standard_normal((2, no)), 1150 + 350 * smooth_noise(no, 0.1, rng), 9.0,
                             kind="bp") * smooth_noise(no, 0.2, rng)
    wind *= 0.35 + 0.65 * smooth_noise(no, 0.18, rng) ** 1.5
    wind *= ramp_db([(o0, -120), (o0 + 0.1, -60), (56.0, -31), (64.0, -32), (64.2, -40), (66.5, -34),
                     (73.0, -36), (74.0, -52), (74.5, -120)], no, o0)
    add(wind, o0, hall_s=0.15)
    sw0, sw1 = TL["observatory"]["slew"]["start"], TL["observatory"]["slew"]["end"]
    add(relay_clunk(seed=30, size=1.6), sw0 - 0.05, gain=db(-15), pan=0.1, hall_s=0.4)
    add(servo(sw1 - sw0, seed=31), sw0, gain=db(-19), pan=0.1, hall_s=0.3)
    add(relay_clunk(seed=32, size=1.8), sw1, gain=db(-14), pan=0.1, hall_s=0.5)
    m = int(0.9 * SR)
    ring = (np.sin(TAU * 612 * tvec(m)) + 0.5 * np.sin(TAU * 1377 * tvec(m))) * np.exp(-tvec(m) / 0.25)
    add(ring * fade_env(m, 0.002, 0.1), sw1 + 0.01, gain=db(-34), pan=0.1, hall_s=0.5)
    # arrival: pre-swell, impact, rings, shake rumble, the hut alarm
    A0 = C["arrival"]
    add(reverse_swell(1.4, rng, 250, 8000) * db(-22), A0 - 1.4)
    add(boom(8.0, 80.0, 28.0, seed=33), A0, gain=db(-18), hall_s=0.3, space_s=0.2)
    add(shockwave(2.5, seed=34), A0, gain=db(-23), hall_s=0.3)
    for k, dt in enumerate((0.0, 0.75, 1.5, 2.25)):
        add(rings_sound(seed=40 + k), A0 + dt, gain=db(-21 - 2.5 * k), hall_s=0.5, space_s=0.2)
    nsk = int(3.0 * SR)
    shake = lp(brown((2, nsk), rng), 80.0) * np.exp(-tvec(nsk) / 0.9) * fade_env(nsk, 0.01, 0.5)
    add(shake, A0, gain=db(-17))
    al = TL["observatory"]["alarm"]
    alarm = np.zeros((2, int((74.0 - al) * SR)))
    k = 0
    while al + 0.42 * k < 73.3:
        place(alarm, to_stereo(buzzer(0.22, hz("A5"))), 0.42 * k)
        k += 1
    alarm = bp(alarm, 350.0, 3500.0) * ramp_db([(0, -3), (6.0, -4), (7.3, -14), (8.0, -120)], alarm.shape[1])
    add(alarm, al, gain=db(-29), pan=0.35, room_s=0.8, hall_s=0.1)

    # signal: noise riser into the silence
    r0 = 86.0
    rsw = noise_sweep(sil - r0, 300.0, 7000.0, 1.8, rng)
    rsw *= ramp_db([(0, -60), (3.5, -44), (sil - r0 - 0.6, -25), (sil - r0, -20)], rsw.shape[1])
    rsw[:, -int(0.02 * SR):] *= np.linspace(1, 0, int(0.02 * SR))
    add(rsw, r0)

    # fold: the ribbon of cubes, the flights, the landings, the lock
    s0, s1 = TL["fold"]["snake"]["start"], TL["fold"]["snake"]["end"]
    tt = s0 + 0.3
    k = 0
    while tt < s1 + 0.3:
        u = (tt - s0) / (s1 - s0)
        f = rng.choice([hz(x) for x in ("B6", "D7", "F#7", "C#7", "A6")]) * rng.uniform(0.99, 1.01)
        pan = 0.8 * np.sin(TAU * 0.23 * (tt - s0) + 0.6)
        add(glass(f, 0.25, decay=0.035, seed=k), tt, gain=db(-35 + 4 * np.sin(np.pi * min(1, u))),
            pan=float(np.clip(pan + rng.uniform(-0.15, 0.15), -1, 1)), room_s=0.5, hall_s=0.2)
        tt += rng.exponential(1 / 38.0)
        k += 1
    nrb = int((s1 - s0 + 1.0) * SR)
    trb = tvec(nrb)
    air = tv_filter(pink((2, nrb), rng), 1200 + 700 * np.sin(TAU * 0.23 * trb), 1.2, kind="bp")
    air *= (0.5 + 0.5 * np.sin(TAU * 0.23 * trb + 0.6) ** 2) * fade_env(nrb, 1.0, 1.2) * db(-34)
    add(air, s0, hall_s=0.3)
    f0 = TL["fold"]["fold"]["start"]
    stg, fl = TL["fold"]["row_stagger"], TL["fold"]["row_flight"]
    rows = TL["grid"]["returned"]
    penta = [0, 3, 5, 7, 10]
    for r in range(len(rows)):
        side = (1 if r % 2 else -1) * rng.uniform(0.3, 0.8)
        add(whoosh(fl, seed=100 + r, f_lo=450, f_hi=2600, center=0.55, pan0=side, pan1=-side * 0.2, q=1.6, low=0.0),
            f0 + r * stg, gain=db(-39))
        c = sum(rows[r])
        tl = f0 + r * stg + fl
        clack = thump(900, 420, 0.06, tau_pitch=0.004, tau_amp=0.012, noise=0.3, seed=200 + r)
        if c == 0:
            add(tick(0, rng, empty=True), tl, gain=db(-24), room_s=0.5)
            add(clack, tl, gain=db(-30), room_s=0.4)
            continue
        j = min(c, 13)
        f = hz("B4") * 2 ** ((12 * (j // 5) + penta[j % 5]) / 12)
        xs = [x for x, b in enumerate(rows[r]) if b]
        pan = (np.mean(xs) / 22.0 - 0.5) * 0.9
        add(tick(f, rng), tl, gain=db(-21 - 2.5 * j / 13), pan=pan, room_s=0.5, hall_s=0.12)
        add(clack, tl, gain=db(-27), pan=pan, room_s=0.4)
    fd = C["fold_complete"]
    add(boom(5.0, 70.0, 32.0, seed=50, tau=1.3), fd, gain=db(-17.5), hall_s=0.3)
    # recognition: the 1974 original flies in and locks into alignment
    g0, g1 = TL["recognition"]["ghost_in"]["start"], TL["recognition"]["ghost_in"]["end"]
    add(whoosh(g1 - g0, seed=60, f_lo=200, f_hi=2200, center=0.85, pan0=-0.9, pan1=0.0, q=1.2, low=0.2),
        g0, gain=db(-24), hall_s=0.4)
    for jn, note in enumerate(["D6", "F#6", "A6", "D7"]):
        add(glass(hz(note), 3.0, decay=0.9, seed=61 + jn), g1 + 0.02 * jn, gain=db(-30), pan=-0.3 + 0.2 * jn,
            hall_s=0.7)
    add(thump(120, 60, 1.0, tau_pitch=0.02, tau_amp=0.18, noise=0.1, seed=65), g1, gain=db(-24), hall_s=0.3)

    # visitor: scan sweep, the difference blips, the reveal, the push-in riser
    V = TL["visitor"]
    sc0, sc1 = V["scan"]["start"], V["scan"]["end"]
    ds = sc1 - sc0
    swp = noise_sweep(ds, 350.0, 5200.0, 6.0, rng) + 0.4 * noise_sweep(ds, 700.0, 10400.0, 3.0, rng)
    m = swp.shape[1]
    swp *= (0.8 + 0.2 * np.sin(TAU * 28.0 * tvec(m))) * fade_env(m, 0.08, 0.25) * db(-20)
    swp[0] *= np.linspace(1.15, 0.85, m)
    swp[1] *= np.linspace(0.85, 1.15, m)
    add(swp, sc0, hall_s=0.25)
    sent = TL["grid"]["sent"]
    for r in range(len(rows)):
        diff = [x for x in range(len(rows[r])) if rows[r][x] != sent[r][x]]
        if not diff:
            continue
        nb = int(0.12 * SR)
        tv = tvec(nb)
        y = (np.sin(TAU * 1420.0 * tv) + 0.6 * np.sin(TAU * 1427.0 * tv)) * np.exp(-tv / 0.035) * fade_env(nb, 0.002, 0.03)
        add(y, sc0 + (r + 0.5) / len(rows) * ds, gain=db(-30 + min(4, len(diff))),
            pan=(np.mean(diff) / 22.0 - 0.5) * 0.9, room_s=0.4, hall_s=0.2)
    rv = C["reveal"]
    add(reverse_swell(0.9, rng, 300, 4000) * db(-30), rv - 0.9)
    add(boom(6.0, 80.0, 34.0, seed=70), rv, gain=db(-17), hall_s=0.35)
    z0, zc = V["push_in"]["start"], V["step_out"]["start"]
    zr = noise_sweep(zc - z0, 250.0, 9000.0, 1.4, rng)
    zr *= ramp_db([(0, -52), (1.5, -40), (zc - z0, -21)], zr.shape[1])
    zr[:, -int(0.03 * SR):] *= np.linspace(1, 0, int(0.03 * SR))
    add(zr, z0, hall_s=0.1)
    # the visitor assembles: crystalline grains accelerating, widening; shards reversed into the turn
    a0, a1 = V["step_out"]["start"], V["step_out"]["end"]
    crystal = [hz(x) for x in ("B6", "C#7", "D#7", "F#7", "G#7", "A#6", "E7")]
    tt = a0 + 0.05
    k = 0
    while tt < a1:
        u = (tt - a0) / (a1 - a0)
        f = rng.choice(crystal) * (2 if rng.random() < 0.25 and u > 0.4 else 1) * rng.uniform(0.997, 1.003)
        f = min(f, 7800.0)
        add(glass(f, 0.6, decay=0.05 + 0.25 * (1 - u) * rng.random(), seed=300 + k), tt,
            gain=db(-31 + 9 * u + rng.uniform(-3, 1)), pan=float(np.clip(rng.normal(0, 0.25 + 0.55 * u), -1, 1)),
            hall_s=0.5, space_s=0.3)
        tt += 1.0 / (6.0 * (70.0 / 6.0) ** u) * rng.uniform(0.5, 1.5)
        k += 1
    for k in range(9):
        gg = glass(rng.choice(crystal) / 2, 0.5, decay=0.25, seed=500 + k)[::-1]
        add(gg * fade_env(len(gg), 0.2, 0.004), V["turn"]["start"] - 0.5 + 0.08 * k, gain=db(-30),
            pan=rng.uniform(-0.6, 0.6), hall_s=0.6)
    t0, t1 = V["turn"]["start"], V["turn"]["end"]
    add(whoosh(t1 - t0 + 0.4, seed=80, f_lo=90, f_hi=600, center=0.5, pan0=0.4, pan1=-0.4, q=0.9, low=0.0),
        t0, gain=db(-24), space_s=0.4)
    # the hand: a warm high glint rising (quiet, above the voice's formants)
    h0, h1 = V["raise_hand"]["start"], V["raise_hand"]["end"]
    nh = int((h1 - h0 + 1.2) * SR)
    th = tvec(nh)
    glint = sum(np.sin(TAU * np.cumsum(f * 2 ** (0.2 * np.clip(th / (h1 - h0), 0, 1))) / SR + ph)
                for f, ph in ((hz("D7"), 0.0), (hz("A7"), 1.0), (hz("F#7"), 2.0)))
    glint *= (1 - np.exp(-th / 0.4)) * fade_env(nh, 0.3, 1.0) / 3
    add(glint, h0, gain=db(-38), hall_s=0.5, space_s=0.5)
    b0 = C["voice"] + 2.3
    add(reverse_swell(1.0, rng, 200, 5000) * db(-33), b0 - 1.0 + 0.05, hall_s=0.3)
    add(boom(5.0, 60.0, 30.0, seed=90), b0 + 0.05, gain=db(-20), hall_s=0.3)

    # ending: title particles swarm and converge, the boom on the landing, a shimmering tail
    E = TL["ending"]
    p0, p1 = E["title_particles"]["start"], E["title_particles"]["end"]
    land = p1 - 0.2
    targets = [hz(x) for x in ("B5", "F#6", "C#7", "B6", "F#7", "E6")]
    part = np.zeros((2, int((p1 - p0 + 1.5) * SR)))
    k = 0
    tt = p0
    while tt < land - 0.1:
        u = (tt - p0) / (land - p0)
        dur = land - tt + rng.uniform(0.05, 0.6)
        m = int(dur * SR)
        tg = tvec(m)
        ft = rng.choice(targets)
        fs = ft * 2 ** rng.uniform(-1.5, 1.5)
        glide = np.clip(tg / max(0.05, land - tt), 0, 1) ** 1.5
        f = fs * (ft / fs) ** glide
        y = np.sin(TAU * np.cumsum(f) / SR + rng.uniform(0, TAU)) * (1 - np.exp(-tg / 0.08))
        y *= fade_env(m, 0.02, 0.25) * db(-6 + 6 * u)
        pan = rng.uniform(-1, 1) * (1 - 0.8 * glide)
        gl, gr = pan_gains(pan)
        s = int((tt - p0) * SR)
        part[0, s:s + m] += (y * gl)[:part.shape[1] - s]
        part[1, s:s + m] += (y * gr)[:part.shape[1] - s]
        tt += 1.0 / (8.0 + 70.0 * u ** 1.5)
        k += 1
    part /= np.sqrt(max(1, k)) * 0.5
    add(part, p0, gain=db(-24), hall_s=0.5, space_s=0.5)
    add(reverse_swell(1.5, rng, 250, 7000) * db(-27), land - 1.5)
    add(boom(8.0, 72.0, 27.0, seed=95), land, gain=db(-13), hall_s=0.3, space_s=0.2)
    add(shimmer([hz(x) for x in ("B5", "F#6", "C#7", "E6", "G#6", "B6", "D#7")], 9.0, seed=96), land + 0.02,
        gain=db(-19), hall_s=0.6, space_s=0.6)

    out += convolve_stereo(hs, hall, N)
    out += convolve_stereo(ss, space, N)
    out += convolve_stereo(rs, room, N)
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


def main():
    t_all = time.time()
    os.makedirs(STEMS, exist_ok=True)
    hall = make_ir(6.5, rt_low=5.2, rt_mid=4.2, rt_high=1.8, predelay=0.03, seed=11, width=1.0)
    space = make_ir(10.0, rt_low=8.0, rt_mid=6.5, rt_high=2.8, predelay=0.06, seed=21, width=1.0, onset=0.03)
    room = make_ir(1.4, rt_low=0.8, rt_mid=0.65, rt_high=0.3, predelay=0.006, seed=12, er_span=0.03, width=0.8)
    for name, fn in [("typing", lambda: render_typing(room)), ("signal", lambda: render_signal(hall, room)),
                     ("sfx", lambda: render_sfx(hall, space, room)), ("music", lambda: render_music(hall, space))]:
        t = time.time()
        x = fn()
        print(f"{name:7s} {time.time() - t:5.1f}s")
        check_and_write(name, x)
        del x
    print(f"total render {time.time() - t_all:.1f}s")


if __name__ == "__main__":
    main()
