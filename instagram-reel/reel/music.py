"""Original score, composed to the cut. Everything is synthesised here (no
samples, no licensed audio), so the reel is safe from music takedowns.

Key of F major, 114 BPM. Sections follow the edit (timeline.json):
  hook   - tiptoe pizzicato + celesta, finger snaps; tape-stops on the punchline
  groove - "Hi, I'm Chelsea": kick/clap/shaker, ukulele strums, pizz bass, glockenspiel
  story  - warm pad, celesta arpeggios, soft bass (the heartfelt bit)
  build  - four-on-the-floor lite + strums, IV-V into...
  list   - full groove again, "ta-da" flourish after the beignets line
  cta    - ii-V riser into the brand reveal
  finale - impact + sparkle on "Chelsea Packs the Magic", I-IV-V-I, final chord rings out
Writes build/music.wav (stereo) and build/sfx.wav (stereo).
"""
import json, os
import numpy as np, soundfile as sf, pyloudnorm as pyln
import config as C
from dsp import lowpass, highpass, bandpass, peaking, reverb_ir, convolve_stereo, limiter

SR = C.SR
B = C.BEAT
rng = np.random.default_rng(114)

NOTE = {"C": 0, "C#": 1, "Db": 1, "D": 2, "D#": 3, "Eb": 3, "E": 4, "F": 5, "F#": 6, "Gb": 6,
        "G": 7, "G#": 8, "Ab": 8, "A": 9, "A#": 10, "Bb": 10, "B": 11}


def hz(name):
    n, octv = name[:-1], int(name[-1])
    return 440.0 * 2 ** ((NOTE[n] + 12 * (octv + 1) - 69) / 12)


# ----------------------------------------------------------------- instruments
def pluck(f, dur, vel=1.0, bright=0.6, decay=1.0, pos=0.2, damp=0.05, inharm=1e-4):
    """Additive plucked string: per-harmonic exponential decay, pluck-position comb."""
    tail = min(decay * 1.5, 2.5)
    n = int((dur + tail) * SR)
    t = np.arange(n) / SR
    y = np.zeros(n)
    H = max(1, min(48, int(16000 / f)))
    for h in range(1, H + 1):
        amp = abs(np.sin(np.pi * h * pos)) / h ** (1.9 - bright)
        tau = decay / (1 + (h - 1) ** 1.25 * (1.25 - bright))
        fh = f * h * np.sqrt(1 + inharm * h * h)
        ph = 0.0 if h == 1 else rng.uniform(0, 2 * np.pi)   # fundamental in phase with sub_bass
        y += amp * np.exp(-t / tau) * np.sin(2 * np.pi * fh * t + ph)
    y[: int(0.0015 * SR)] *= np.linspace(0, 1, int(0.0015 * SR))
    # damping when the note is released (finger on the string)
    k = int(dur * SR)
    if k < n:
        y[k:] *= np.exp(-np.arange(n - k) / (damp * SR))
    return vel * y / (np.abs(y).max() + 1e-9)


def bell(f, vel=1.0, ratios=(1, 2.76, 5.40, 8.93), amps=(1, .22, .07, .03), decays=(1.8, .45, .18, .07), click=0.04):
    """Glockenspiel-style bar (inharmonic partials) with a mallet tick."""
    n = int((decays[0] * 3 + 0.05) * SR)
    t = np.arange(n) / SR
    y = sum(a * np.exp(-t / d) * np.sin(2 * np.pi * f * r * t + rng.uniform(0, 6.28))
            for r, a, d in zip(ratios, amps, decays) if f * r < 20000)
    y[: int(0.0008 * SR)] *= np.linspace(0, 1, int(0.0008 * SR))
    tick = highpass(rng.standard_normal(int(0.004 * SR)), 3000, 2) * np.linspace(1, 0, int(0.004 * SR)) * click
    y[: len(tick)] += tick
    return vel * y / (np.abs(y).max() + 1e-9)


def celesta(f, vel=1.0):
    return bell(f, vel, ratios=(1, 2, 3, 4.01), amps=(1, .28, .08, .03), decays=(1.1, .35, .15, .08), click=0.02)


def pad(freqs, dur, vel=1.0, cutoff=1500, attack=0.45, release=0.9):
    """Detuned band-limited saws, low-passed, slow envelope. Returns stereo."""
    n = int((dur + release) * SR)
    t = np.arange(n) / SR
    out = np.zeros((n, 2))
    for f in freqs:
        for det, pan in ((-7, 0.15), (0, 0.5), (7, 0.85)):
            fd = f * 2 ** (det / 1200)
            H = int(min(cutoff * 2.2, 9000) / fd)
            ph = rng.uniform(0, 6.28, H + 1)
            v = sum(np.sin(2 * np.pi * fd * h * t + ph[h]) / h for h in range(1, H + 1))
            out[:, 0] += v * np.cos(pan * np.pi / 2)
            out[:, 1] += v * np.sin(pan * np.pi / 2)
    out = lowpass(out, cutoff, 2)
    env = np.ones(n)
    a = int(attack * SR)
    env[:a] = np.linspace(0, 1, a) ** 1.5
    r0 = int(dur * SR)
    env[r0:] = np.exp(-np.arange(n - r0) / (release * SR / 4))
    out *= env[:, None]
    return vel * out / (np.abs(out).max() + 1e-9)


def sub_bass(f, dur, vel=1.0):
    n = int((dur + 0.08) * SR)
    t = np.arange(n) / SR
    y = np.sin(2 * np.pi * f * t) + 0.18 * np.sin(4 * np.pi * f * t)
    env = np.minimum(1, t / 0.006) * np.exp(-t / 0.9)
    k = int(dur * SR)
    env[k:] *= np.exp(-np.arange(n - k) / (0.02 * SR))
    return vel * y * env


def soft_bass(f, dur, vel=1.0):
    """Round, attack-free bass (sine + a little 2nd/3rd harmonic, 25 ms fade-in)."""
    n = int((dur + 0.12) * SR)
    t = np.arange(n) / SR
    y = np.sin(2 * np.pi * f * t) + 0.22 * np.sin(4 * np.pi * f * t) + 0.06 * np.sin(6 * np.pi * f * t)
    env = np.minimum(1, t / 0.025) ** 2 * np.exp(-t / 0.6)
    k = int(dur * SR)
    env[k:] *= np.exp(-np.arange(n - k) / (0.05 * SR))
    return vel * y * env


def kick(vel=1.0):
    n = int(0.45 * SR)
    t = np.arange(n) / SR
    f = 48 + 100 * np.exp(-t / 0.035)
    y = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.2)
    y[: int(0.004 * SR)] += highpass(rng.standard_normal(int(0.004 * SR)), 2500, 2) * 0.15
    return vel * y / np.abs(y).max()


def noise_hit(dur, lo, hi, decay, vel=1.0, attack=0.001):
    n = int(dur * SR)
    t = np.arange(n) / SR
    y = bandpass(rng.standard_normal(n), lo, hi, 2) * np.exp(-t / decay) * np.minimum(1, t / attack)
    return vel * y / (np.abs(y).max() + 1e-9)


def clap(vel=1.0):
    n = int(0.35 * SR)
    y = np.zeros(n)
    for k, d in enumerate((0.0, 0.009, 0.019)):
        b = noise_hit(0.03, 900, 2600, 0.006)
        i = int(d * SR)
        y[i:i + len(b)] += b * (0.8 if k < 2 else 1.0)
    tail = np.concatenate([np.zeros(int(0.019 * SR)), noise_hit(0.3, 900, 2800, 0.07)])[:n]
    y[:len(tail)] += tail * 0.6
    return vel * y / np.abs(y).max()


def snap(vel=1.0):
    y = noise_hit(0.08, 1600, 3800, 0.012)
    t = np.arange(len(y)) / SR
    y += 0.5 * np.sin(2 * np.pi * 2300 * t) * np.exp(-t / 0.008)
    return vel * y / np.abs(y).max()


def shaker(vel=1.0):
    return noise_hit(0.12, 5000, 12000, 0.035, vel, attack=0.008)


def tamb(vel=1.0):
    y = noise_hit(0.25, 6000, 14000, 0.07)
    t = np.arange(len(y)) / SR
    y += 0.25 * sum(np.sin(2 * np.pi * f * t) for f in (7100, 8900, 10300)) * np.exp(-t / 0.05)
    return vel * y / np.abs(y).max()


# ----------------------------------------------------------------- the score
CHORDS = {  # (bass root, pad/strum voicing)
    "F": ("F2", ["A3", "C4", "F4"], ["C4", "F4", "A4", "C5"]),
    "C": ("C2", ["G3", "C4", "E4"], ["C4", "E4", "G4", "C5"]),
    "C/E": ("E2", ["G3", "C4", "E4"], ["C4", "E4", "G4", "C5"]),
    "Dm": ("D2", ["A3", "D4", "F4"], ["D4", "F4", "A4", "D5"]),
    "Bb": ("Bb1", ["Bb3", "D4", "F4"], ["D4", "F4", "Bb4", "D5"]),
    "Gm": ("G1", ["Bb3", "D4", "G4"], ["D4", "G4", "Bb4", "D5"]),
    "C7": ("C2", ["Bb3", "C4", "E4"], ["C4", "E4", "G4", "Bb4"]),
}
ARP = {k: [hz(n) for n in v[2]] for k, v in CHORDS.items()}

# glockenspiel motif, 2 bars (beat offset, note, length in beats)
MOTIF = [
    [(0, "C6", .5), (.5, "A5", .5), (1, "F5", .5), (1.5, "A5", .5), (2, "C6", 1), (3, "D6", .5), (3.5, "C6", .5)],
    [(0, "E6", .5), (.5, "C6", .5), (1, "G5", 1), (2, "A5", .5), (2.5, "Bb5", .5), (3, "C6", 1)],
    [(0, "D6", .5), (.5, "F6", .5), (1, "A6", 1), (2, "G6", .5), (2.5, "F6", .5), (3, "D6", 1)],
    [(0, "D6", .5), (.5, "C6", .5), (1, "Bb5", .5), (1.5, "A5", .5), (2, "G5", 1.5)],
]


class Mix:
    def __init__(self, seconds):
        self.n = int(seconds * SR)
        self.buses = {}

    def add(self, bus, y, t, gain=1.0, pan=0.5, jitter=0.004):
        if t is None:
            return
        t += rng.uniform(-jitter, jitter) if jitter else 0
        i = int(round(t * SR))
        if i >= self.n:
            return
        if bus not in self.buses:
            self.buses[bus] = np.zeros((self.n, 2))
        b = self.buses[bus]
        if y.ndim == 1:
            y = np.stack([y * np.cos(pan * np.pi / 2), y * np.sin(pan * np.pi / 2)], axis=1) * np.sqrt(2)
        j0 = max(0, -i)
        i = max(0, i)
        m = min(len(y) - j0, self.n - i)
        if m > 0:
            b[i:i + m] += gain * y[j0:j0 + m]


def compose(tl):
    total = tl["total"]
    ev = tl["events"]
    secs = {s["name"]: s["t"] for s in tl["sections"]}
    beat = lambda t: t / B
    bt = lambda b: b * B

    stop_t = ev["stop"]
    vpath = os.path.join(C.BUILD, "voice.wav")
    vdb = None
    if os.path.exists(vpath):
        v, _ = sf.read(vpath)
        hop = SR // 100
        k = len(v) // hop
        vdb = 20 * np.log10(np.sqrt((v[:k * hop].reshape(k, hop) ** 2).mean(1)) + 1e-12)

    def voice_gap(t, span):
        """True if the dialogue dips into a pause anywhere in [t, t+span] (so a note there would be exposed)."""
        if vdb is None:
            return False
        a, z = int(t * 100), int((t + span) * 100) + 1
        w = vdb[a:z]
        return len(w) > 0 and w.min() < -38 and w.max() > -30   # a dip inside running speech
    # music sections start on the beat at (or just before) the edit's section point
    starts = {n: int(np.floor(beat(t) + 0.25)) for n, t in secs.items() if n not in ("hook", "stop", "cta")}
    cta_b = int(np.ceil(beat(tl["segments"][[s.get("section") for s in tl["segments"]].index("cta")]["tl0"]) - 0.25))
    starts["cta"] = cta_b
    order = sorted(starts.items(), key=lambda kv: kv[1])

    def end_of(name):
        i = [n for n, _ in order].index(name)
        return order[i + 1][1]

    groove_b = starts["groove"]
    list_b = starts["list"]
    reveal_b = round(beat(ev["reveal"]))
    final_b = round(beat(ev["final_chord"]))
    beig_b = int(np.ceil(beat(ev["tada"])))   # right after "...best beignets?"

    M = Mix(total + 0.5)

    def chord_at(prog, b0, b):
        return prog[min(int((b - b0) // 4), len(prog) - 1)]

    def strum(ch, t, vel, down=True, length=0.22, bright=0.72):
        notes = CHORDS[ch][2] if down else CHORDS[ch][2][::-1]
        for k, nm in enumerate(notes):
            M.add("uke", pluck(hz(nm), length, vel * (0.85 + 0.15 * rng.random()), bright=bright, decay=0.9, pos=0.23, damp=0.03),
                  t + k * 0.011, pan=0.62, jitter=0.002)

    def pizz_bass(ch, t, vel=1.0, dur=0.3, octave_up=False):
        f = hz(CHORDS[ch][0]) * (2 if octave_up else 1)
        M.add("bass", pluck(f, dur, vel, bright=0.35, decay=0.7, pos=0.3, damp=0.04), t, pan=0.5, jitter=0.002)
        M.add("bass", sub_bass(f, dur, vel * 0.55), t, pan=0.5, jitter=0)

    def glock_line(bar_notes, t0, vel=1.0):
        for off, nm, ln in bar_notes:
            M.add("glock", bell(hz(nm), vel * (0.8 + 0.2 * rng.random())), t0 + off * B, pan=0.35)

    # ---- hook: beats 0 .. stop  (F | C/E | Dm), tiptoe pizzicato
    prog = ["F", "C/E", "Dm", "Bb"]
    gap_safe = C.HOOK_GAP_SAFE
    b = 0.0
    while bt(b) < stop_t - 0.02:
        ch = chord_at(prog, 0, b)
        pos = b % 4
        if pos in (0, 2):
            if not gap_safe:
                pizz_bass(ch, bt(b), 0.9, dur=0.18)
            elif not voice_gap(bt(b), 0.22):
                # no plucked attack: on a phone speaker a bare low pluck in a pause reads as a cough
                M.add("bass", soft_bass(hz(CHORDS[ch][0]), 0.34, 0.8), bt(b), pan=0.5, jitter=0)
        if pos in (1, 3):
            M.add("perc", snap(0.8), bt(b), pan=0.6 if pos == 1 else 0.4)
        # staccato pizz chord tones on off-beats
        if pos in (0.5, 1.5, 2.5, 3.5) and not (gap_safe and voice_gap(bt(b), 0.12)):
            nm = CHORDS[ch][2][int(pos * 2) % 4]
            M.add("pizz", pluck(hz(nm), 0.09, 0.55, bright=0.55, decay=0.4, pos=0.25, damp=0.02), bt(b), pan=0.7)
        # celesta arp in 8ths, soft
        a = ARP[ch]
        M.add("cel", celesta(a[int(b * 2) % 4] * 4, 0.35), bt(b), pan=0.3)
        if b % 1 == 0.0 and rng.random() < 0.9:
            M.add("perc", shaker(0.35), bt(b + 0.5), pan=0.75)
        b += 0.5
    hook_end = stop_t

    # ---- groove: "Hi, I'm Chelsea"
    def groove(b0, b1, prog, glock=True, fill_end=True):
        b = b0
        while b < b1 - 1e-6:
            ch = chord_at(prog, b0, b)
            pos = (b - b0) % 4
            t = bt(b)
            if pos in (0, 2):
                M.add("drums", kick(0.9), t, jitter=0.001)
            if pos == 2.5 and rng.random() < 0.5:
                M.add("drums", kick(0.55), t, jitter=0.001)
            if pos in (1, 3):
                M.add("drums", clap(0.8), t, pan=0.5, jitter=0.002)
                M.add("perc", tamb(0.35), t, pan=0.7)
            # shaker 16ths with accents and a little swing
            for k in range(2):
                sw = 0.0 if k == 0 else 0.06 * B
                M.add("perc", shaker(0.42 if k == 0 else 0.25), t + k * B / 2 + sw, pan=0.8)
            # ukulele: D . D U . U D U
            if pos in (0, 1, 2.5, 3.5):
                strum(ch, t, 0.55, down=True)
            if pos in (1.5, 3):
                strum(ch, t, 0.4, down=False, length=0.15)
            # bass: root on 1, fifth-ish octave on 3, pickup on 4&
            if pos == 0:
                pizz_bass(ch, t, 1.0, dur=0.45)
            if pos == 2:
                pizz_bass(ch, t, 0.8, dur=0.3, octave_up=True)
            if pos == 3.5:
                pizz_bass(ch, t, 0.55, dur=0.15)
            b += 0.5
        if glock:
            bar = 0
            while bt(b0 + bar * 4) < bt(b1) - 0.1:
                if bar < len(MOTIF):
                    glock_line([n for n in MOTIF[bar] if b0 + bar * 4 + n[0] < b1 - 0.25], bt(b0 + bar * 4), 0.7)
                bar += 1

    g_end = end_of("groove")
    groove(groove_b, g_end, ["F", "C", "C"] if g_end - groove_b <= 12 else ["F", "C/E", "Dm", "Bb", "F", "C", "Bb", "C"], glock=True)

    # ---- story: heartfelt; pad + celesta + soft bass
    if "story" in starts:
        story_b, story_end = starts["story"], end_of("story")
        prog = ["Dm", "Bb", "F", "C", "Dm", "Bb", "Bb"]
        for bar in range((story_end - story_b + 3) // 4):
            b0 = story_b + bar * 4
            if b0 >= story_end:
                break
            ch = prog[min(bar, len(prog) - 1)]
            length = min(4, story_end - b0)
            M.add("pad", pad([hz(n) for n in CHORDS[ch][1]], bt(length) + 0.1, 0.9, cutoff=1300), bt(b0), jitter=0)
            M.add("bass", sub_bass(hz(CHORDS[ch][0]), bt(length) - 0.05, 0.55), bt(b0), jitter=0)
            a = ARP[ch]
            pattern = [0, 1, 2, 3, 2, 1, 2, 3] if bar % 2 == 0 else [0, 2, 1, 3, 2, 3, 1, 2]
            for k in range(int(length * 2)):
                M.add("cel", celesta(a[pattern[k % 8]] * 4, 0.42 if k % 2 == 0 else 0.3), bt(b0 + k * 0.5), pan=0.3 + 0.4 * (k % 2))
            if bar >= 2:
                for k in range(int(length * 2)):
                    M.add("perc", shaker(0.22 if k % 2 else 0.3), bt(b0 + k * 0.5), pan=0.8)

    # ---- build: IV - V, kick on quarters, strums, rising glock
    if "build" in starts:
        build_b, build_end = starts["build"], end_of("build")
        prog = ["Bb", "C", "C"]
        b = build_b
        while b < build_end - 1e-6:
            L = build_end - build_b
            ch = chord_at(prog, build_b, b) if L > 4 else ("Bb" if b - build_b < L / 2 else "C")   # short build: IV-V in halves
            pos = (b - build_b) % 4
            t = bt(b)
            frac = (b - build_b) / max(1, build_end - build_b)
            if pos % 1 == 0:
                M.add("drums", kick(0.55 + 0.35 * frac), t, jitter=0.001)
                strum(ch, t, 0.35 + 0.3 * frac)
                pizz_bass(ch, t, 0.6 + 0.3 * frac, dur=0.25)
            M.add("perc", shaker(0.2 + 0.25 * frac), t, pan=0.8)
            a = ARP[ch]
            M.add("glock", bell(a[int((b - build_b) * 2) % 4] * 2 * (2 if frac > 0.5 else 1), 0.25 + 0.3 * frac), t, pan=0.35)
            b += 0.5
        half = 4 if build_end - build_b > 4 else (build_end - build_b) / 2
        M.add("pad", pad([hz(n) for n in CHORDS["Bb"][1]], bt(half), 0.6, cutoff=1600), bt(build_b), jitter=0)
        M.add("pad", pad([hz(n) for n in CHORDS["C"][1]], bt(build_end - build_b - half), 0.7, cutoff=1900), bt(build_b + half), jitter=0)
        # small snare-ish lift in the last beat
        for k in range(4):
            M.add("drums", clap(0.25 + 0.12 * k), bt(build_end - 1 + k * 0.25), jitter=0.001)

    # ---- list: full groove again
    groove(list_b, cta_b, ["F", "C/E", "Dm", "Bb", "Bb"], glock=True)
    # ta-da after "the best beignets?"
    for k, nm in enumerate(["C6", "F6", "A6", "C7"]):
        M.add("glock", bell(hz(nm), 0.8), bt(beig_b) + k * 0.06, pan=0.3 + 0.13 * k, jitter=0)
    M.add("perc", tamb(0.5), bt(beig_b) + 0.18)

    # ---- cta: ii - V7 build into the reveal
    prog = ["Gm", "C7"]
    b = cta_b
    while b < reveal_b - 1e-6:
        ch = "Gm" if b < reveal_b - 2 else "C7"
        t = bt(b)
        frac = (b - cta_b) / max(1, reveal_b - cta_b)
        if (b - cta_b) % 1 == 0:
            M.add("drums", kick(0.6 + 0.3 * frac), t, jitter=0.001)
            strum(ch, t, 0.35 + 0.35 * frac)
        pizz_bass(ch, t, 0.45 + 0.4 * frac, dur=0.12)
        M.add("perc", shaker(0.25 + 0.2 * frac), t, pan=0.8)
        b += 0.5
    M.add("pad", pad([hz(n) for n in CHORDS["Gm"][1]], bt(reveal_b - cta_b - 2), 0.6, cutoff=1500), bt(cta_b), jitter=0)
    M.add("pad", pad([hz(n) for n in CHORDS["C7"][1]], bt(2), 0.75, cutoff=2200), bt(reveal_b - 2), jitter=0)
    # clap roll accelerating into the reveal
    for k in range(8):
        M.add("drums", clap(0.2 + 0.08 * k), bt(reveal_b - 1) + k * B / 8, jitter=0.001)
    # noise riser
    r0, r1 = bt(cta_b), bt(reveal_b)
    n = int((r1 - r0) * SR)
    x = rng.standard_normal(n)
    tt = np.linspace(0, 1, n)
    riser = np.zeros(n)
    for k in range(0, n, 2400):   # stepped band-pass sweep, crossfaded in 50 ms blocks
        f = 500 * (16 ** tt[k])
        blk = bandpass(x[max(0, k - 2400):k + 2400], f * 0.7, min(f * 1.4, 20000), 2)[-min(2400, n - k):] if k else x[:2400] * 0
        riser[k:k + len(blk)] = blk
    riser *= tt ** 2.2
    M.add("fx", riser / (np.abs(riser).max() + 1e-9), r0, gain=0.35, pan=0.5, jitter=0)

    # ---- finale: I - IV - V - I on the brand reveal
    prog = [("F", 2), ("Bb", 2), ("C", 2)]
    b = reveal_b
    for ch, ln in prog:
        for k in range(ln * 2):
            t = bt(b + k * 0.5)
            pos = k * 0.5
            if pos % 1 == 0:
                M.add("drums", kick(0.95), t, jitter=0.001)
            if pos == 1:
                M.add("drums", clap(0.85), t, jitter=0.002)
                M.add("perc", tamb(0.4), t, pan=0.7)
            M.add("perc", shaker(0.35), t, pan=0.8)
            strum(ch, t, 0.6 if pos % 1 == 0 else 0.42, down=pos % 1 == 0)
            if pos == 0:
                pizz_bass(ch, t, 1.0, dur=0.5)
        M.add("pad", pad([hz(n) for n in CHORDS[ch][1]], bt(ln) + 0.05, 0.8, cutoff=2400, attack=0.05), bt(b), jitter=0)
        b += ln
    glock_line(MOTIF[0][:5], bt(reveal_b), 0.85)
    glock_line([(0, "E6", .5), (.5, "G6", .5), (1, "Bb6", .5)], bt(reveal_b + 4), 0.85)
    # final chord: everything lands on F, rings out
    tf = bt(final_b)
    M.add("drums", kick(1.0), tf, jitter=0)
    M.add("pad", pad([hz(n) for n in ["F3", "A3", "C4", "F4", "A4"]], total - tf - 0.4, 0.9, cutoff=2600, attack=0.02, release=1.2), tf, jitter=0)
    M.add("bass", sub_bass(hz("F1"), total - tf - 0.2, 0.9), tf, jitter=0)
    M.add("bass", pluck(hz("F2"), 1.5, 0.8, bright=0.35, decay=1.2), tf, jitter=0)
    for k, nm in enumerate(["F3", "A3", "C4", "F4", "A4", "C5", "F5", "A5", "C6", "F6"]):     # harp-ish gliss
        M.add("uke", pluck(hz(nm), 1.2, 0.55, bright=0.5, decay=1.6, pos=0.15, damp=0.3), tf + k * 0.022, pan=0.2 + 0.06 * k, jitter=0)
    for k, nm in enumerate(["A5", "C6", "F6", "A6", "C7", "F7"]):
        M.add("glock", bell(hz(nm), 0.7 - 0.06 * k), tf + 0.05 + k * 0.045, pan=0.3 + 0.08 * k, jitter=0)
    M.add("fx", noise_hit(2.5, 5000, 16000, 0.7, attack=0.02), tf, gain=0.18, jitter=0)

    return M, hook_end, dict(reveal=bt(reveal_b), final=tf)


GAINS = {  # bus: (gain, reverb send)
    "drums": (0.55, 0.06), "perc": (0.32, 0.12), "bass": (0.55, 0.02), "uke": (0.26, 0.18),
    "pizz": (0.30, 0.20), "cel": (0.11, 0.40), "glock": (0.24, 0.38), "pad": (0.12, 0.30), "fx": (0.5, 0.25),
}


def tape_stop(y, t_stop, length=0.38):
    """Pitch-dive the last `length` seconds before t_stop to zero speed."""
    i1 = int(t_stop * SR)
    n = int(length * SR)
    i0 = i1 - n
    speed = np.linspace(1, 0, n) ** 1.3
    pos = i0 + np.cumsum(speed)
    for c in range(y.shape[1]):
        seg = np.interp(pos, np.arange(len(y)), y[:, c])
        y[i0:i1, c] = seg * np.linspace(1, 0.6, n)
    y[i1:, :] = 0
    return y


def sfx(tl):
    """Separate effects stem: sparkles, whooshes and the reveal impact."""
    ev = tl["events"]
    M = Mix(tl["total"] + 0.5)
    pent = ["F5", "G5", "A5", "C6", "D6", "F6", "G6", "A6", "C7", "D7", "F7"]
    for k, nm in enumerate(pent):                                       # name sparkle
        M.add("fx", bell(hz(nm), 0.5 + 0.04 * k), ev["name_in"] - 0.05 + k * 0.024, pan=0.25 + 0.05 * k, jitter=0)
    for t in ev["punches"]:                                             # whoosh into punch-ins
        n = int(0.28 * SR)
        x = rng.standard_normal(n)
        env = np.sin(np.linspace(0, np.pi, n)) ** 2 * np.linspace(0.4, 1, n)
        w = bandpass(x, 1500, 7000, 2) * env
        M.add("fx", w / np.abs(w).max() * 0.35, t - 0.22, pan=0.5, jitter=0)
    t = ev["reveal"]                                                    # reveal
    n = int(1.3 * SR)
    tt = np.arange(n) / SR
    boom = np.sin(2 * np.pi * np.cumsum(58 - 16 * (1 - np.exp(-tt / 0.3))) / SR) * np.exp(-tt / 0.45)
    M.add("fx", boom * 0.7, t, jitter=0)
    rev = highpass(rng.standard_normal(int(1.2 * SR)), 3500, 2) * np.linspace(0, 1, int(1.2 * SR)) ** 3   # reverse swell
    M.add("fx", rev / np.abs(rev).max() * 0.22, t - 1.2, jitter=0)
    for k, nm in enumerate(pent[2:]):
        M.add("fx", bell(hz(nm), 0.55), t + 0.02 + k * 0.03, pan=0.8 - 0.07 * k, jitter=0)
    y = M.buses["fx"]
    ir = reverb_ir(2.4, 2.0)
    y = y + 0.3 * convolve_stereo(y, ir)
    return y


def main():
    tl = json.load(open(os.path.join(C.BUILD, "timeline.json")))
    M, stop_t, marks = compose(tl)
    ir = reverb_ir(2.2, 1.7)
    dry = np.zeros((M.n, 2))
    send = np.zeros((M.n, 2))
    hook_part = np.zeros((M.n, 2))
    for bus, y in M.buses.items():
        g, s = GAINS[bus]
        if bus in ("uke", "pizz"):
            y = highpass(y, 180, 2)   # keep strums out of the voice's chest register
        dry += g * y
        send += g * s * y
    wet = convolve_stereo(send, ir)
    music = dry + wet
    # tape-stop the hook on the punchline (music before the stop only)
    i_stop = int(stop_t * SR)
    head = tape_stop(music[: int((stop_t + 0.001) * SR) + 1].copy(), stop_t)
    tail_start = int((tl["sections"][[s["name"] for s in tl["sections"]].index("groove")]["t"] - 0.05) * SR)
    music[:len(head)] = head
    music[i_stop:tail_start] *= 0.0   # silence under "...where my skill ends"
    # a little reverb bloom from the stop so it doesn't feel like a dropout
    bloom = convolve_stereo(head[-int(0.1 * SR):] * 0.6, ir)
    music[i_stop - int(0.1 * SR): i_stop - int(0.1 * SR) + len(bloom)] += bloom[: len(music) - i_stop + int(0.1 * SR)] * 0.25
    # carve a pocket for the voice and keep the low end tidy
    music = highpass(music, 35, 2)
    music = peaking(music, 2800, -3.0, 0.8)
    music = peaking(music, 350, -1.5, 1.0)
    music = music[: int(tl["total"] * SR)]
    meter = pyln.Meter(SR)
    music *= 10 ** ((-16.0 - meter.integrated_loudness(music)) / 20)
    music = limiter(music, -1.0)
    sf.write(os.path.join(C.BUILD, "music.wav"), music.astype(np.float32), SR, subtype="FLOAT")
    fx = sfx(tl)[: int(tl["total"] * SR)]
    fx *= 10 ** (-3 / 20) / np.abs(fx).max()
    sf.write(os.path.join(C.BUILD, "sfx.wav"), fx.astype(np.float32), SR, subtype="FLOAT")
    print("music LUFS", round(meter.integrated_loudness(music), 2), "sfx peak", round(20 * np.log10(np.abs(fx).max() + 1e-9), 1), marks)


if __name__ == "__main__":
    main()
