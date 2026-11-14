#!/usr/bin/env python3
"""Builds audio/mix.wav for the Codex Remote reel: voiceover + a synthesized music bed + UI sound effects.

Everything except the voiceover is generated here with numpy, so the mix is reproducible and
needs no external assets. Cue times match the timeline in ../reel.js.

    python3 audio/mix.py            # run from the reel directory
"""
import os
import subprocess
import wave

import numpy as np

SR = 48000
DUR = 47.6
N = int(SR * DUR)
HERE = os.path.dirname(os.path.abspath(__file__))
rng = np.random.default_rng(7)

# voiceover parts: (file, start seconds, gain)
VO = [("vo_tight_a.wav", 0.00, 1.0), ("vo_tight_cmd.wav", 26.63, 0.9), ("vo_tight_b.wav", 29.80, 1.0)]


# ----------------------------------------------------------------------------- utilities
def read_wav(name):
    with wave.open(os.path.join(HERE, name), "rb") as w:
        assert w.getframerate() == SR and w.getsampwidth() == 2, name
        x = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768.0
        if w.getnchannels() == 2:
            x = x.reshape(-1, 2).mean(axis=1)
        return x


def fir(cut, taps=255, kind="low"):
    """Windowed-sinc FIR. cut in Hz (tuple for band-pass)."""
    n = np.arange(taps) - (taps - 1) / 2

    def lp(fc):
        h = np.sinc(2 * fc / SR * n) * np.hamming(taps)
        return h / h.sum()

    if kind == "low":
        return lp(cut)
    if kind == "high":
        h = -lp(cut)
        h[(taps - 1) // 2] += 1
        return h
    lo, hi = cut
    return lp(hi) - lp(lo)


def filt(x, cut, kind="low", taps=255):
    return np.convolve(x, fir(cut, taps, kind), mode="same").astype(np.float32)


def env_exp(n, decay):
    return np.exp(-np.arange(n) / (decay * SR)).astype(np.float32)


def place(track, sound, t, gain=1.0, pan=0.0):
    """Add a mono sound into a stereo track at time t (seconds). pan: -1 left .. 1 right."""
    i = int(t * SR)
    if i >= N or i + len(sound) <= 0:
        return
    s = sound[: max(0, N - i)]
    l, r = np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)
    track[i : i + len(s), 0] += s * gain * l * 1.414
    track[i : i + len(s), 1] += s * gain * r * 1.414


def tone(freq, dur, decay=None, shape="sine"):
    t = np.arange(int(dur * SR)) / SR
    ph = 2 * np.pi * np.cumsum(np.broadcast_to(freq, t.shape)) / SR
    x = np.sin(ph) if shape == "sine" else 2 * ((ph / (2 * np.pi)) % 1) - 1
    if decay:
        x = x * env_exp(len(t), decay)
    return x.astype(np.float32)


def fade(x, a=0.004, b=0.004):
    x = x.copy()
    na, nb = int(a * SR), int(b * SR)
    if na:
        x[:na] *= np.linspace(0, 1, na)
    if nb:
        x[-nb:] *= np.linspace(1, 0, nb)
    return x


# ----------------------------------------------------------------------------- sound effects
def sfx_click():
    x = tone(2100, 0.035, 0.008) * 0.6 + rng.standard_normal(int(0.035 * SR)).astype(np.float32) * env_exp(int(0.035 * SR), 0.003) * 0.5
    return fade(x, 0.0005, 0.005)


def sfx_tick():
    n = int(0.018 * SR)
    return fade(filt(rng.standard_normal(n).astype(np.float32), 2500, "high", 63) * env_exp(n, 0.004), 0.0003, 0.004)


def sfx_pop(f0=520, f1=980):
    n = int(0.09 * SR)
    return fade(tone(np.linspace(f0, f1, n), 0.09, 0.03), 0.001, 0.02)


def sfx_thump(f0=150, f1=48, dur=0.34):
    n = int(dur * SR)
    body = tone(f1 + (f0 - f1) * np.exp(-np.arange(n) / (0.045 * SR)), dur, 0.11)
    snap = filt(rng.standard_normal(n).astype(np.float32), 1800, "low", 63) * env_exp(n, 0.012) * 0.35
    return fade(np.tanh((body + snap) * 1.6), 0.0005, 0.03)


def sfx_whoosh(dur=0.42):
    n = int(dur * SR)
    noise = rng.standard_normal(n).astype(np.float32)
    dark, bright = filt(noise, (250, 1400), "band"), filt(noise, (1800, 7000), "band")
    k = np.linspace(0, 1, n) ** 1.5
    e = np.sin(np.linspace(0, np.pi, n)) ** 2
    return ((dark * (1 - k) + bright * k) * e * 2.2).astype(np.float32)


def sfx_chime(notes=(1318.5, 1760.0), gap=0.085, decay=0.28):
    n = int((gap * len(notes) + decay * 4) * SR)
    out = np.zeros(n, dtype=np.float32)
    for i, f in enumerate(notes):
        x = tone(f, decay * 4, decay) + 0.35 * tone(f * 2, decay * 4, decay * 0.6) + 0.15 * tone(f * 3, decay * 4, decay * 0.4)
        j = int(i * gap * SR)
        out[j : j + len(x)] += fade(x, 0.002, 0.05)[: n - j]
    return out * 0.5


def sfx_shutter():
    n = int(0.16 * SR)
    out = np.zeros(n, dtype=np.float32)
    for t0, g in ((0.0, 1.0), (0.07, 0.8)):
        m = int(0.05 * SR)
        c = filt(rng.standard_normal(m).astype(np.float32), (900, 5200), "band", 127) * env_exp(m, 0.009)
        j = int(t0 * SR)
        out[j : j + m] += c * g
    return out * 1.6


def sfx_riser(dur=0.7):
    n = int(dur * SR)
    k = np.linspace(0, 1, n)
    x = filt(rng.standard_normal(n).astype(np.float32), 900, "high", 127) * k**2 * 0.8 + tone(220 * 2 ** (k * 2.0), dur) * k**2 * 0.35
    return fade(x.astype(np.float32), 0.01, 0.01)


def sfx_scan(dur=0.9):
    n = int(dur * SR)
    k = np.linspace(0, 1, n)
    return fade(tone(700 + 900 * k, dur) * np.sin(np.pi * k) * 0.25 * (0.6 + 0.4 * np.sin(2 * np.pi * 28 * k * dur)), 0.01, 0.05)


# ----------------------------------------------------------------------------- music bed (124 BPM, A minor)
BPM = 124.0
BEAT = 60.0 / BPM
MUSIC_T0 = 4.60 - 8 * BEAT  # so that bar 3 lands exactly on the title card at 4.60s
CHORDS = [(57, 60, 64), (53, 57, 60), (48, 52, 55), (55, 59, 62)]  # Am F C G (midi), two bars each


def midi(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def music():
    m = np.zeros((N, 2), dtype=np.float32)
    kick, hat, clap = sfx_thump(120, 44, 0.3) * 0.9, None, None
    hn = int(0.05 * SR)
    hat = filt(rng.standard_normal(hn).astype(np.float32), 7000, "high", 63) * env_exp(hn, 0.012)
    cn = int(0.16 * SR)
    clap = filt(rng.standard_normal(cn).astype(np.float32), (900, 3800), "band", 127) * env_exp(cn, 0.045)

    def section(t):
        """Arrangement energy by time: which layers play."""
        if t < 4.55:
            return {"pad"}  # hook: atmosphere only
        if 25.3 <= t < 26.55:
            return {"pad"}  # "Even Claude Code" break
        if 26.55 <= t < 29.75:
            return {"pad", "hat"}  # the spoken command: stay out of the way
        if t >= 43.8:
            return {"pad", "kick", "bass", "hat"}
        if 39.85 <= t < 41.5:
            return {"pad", "clap"}
        return {"pad", "kick", "bass", "hat", "clap", "arp"}

    total_beats = int((DUR - MUSIC_T0) / BEAT) + 1
    for b in range(total_beats):
        t = MUSIC_T0 + b * BEAT
        if t < 0 or t >= DUR - 0.2:
            continue
        on = section(t)
        chord = CHORDS[(b // 8) % 4]
        if "kick" in on:
            place(m, kick, t, 0.5)
        if "clap" in on and b % 4 in (1, 3):
            place(m, clap, t, 0.2, pan=0.1)
        if "hat" in on:
            place(m, hat, t + BEAT / 2, 0.11, pan=-0.25)
            place(m, hat, t + BEAT * 0.75, 0.05, pan=0.3)
        if "bass" in on:
            root = midi(chord[0] - 24)
            for k in (0.5, 0.75) if b % 2 == 0 else (0.25, 0.5):
                note = np.tanh(filt(tone(root, BEAT * 0.24, 0.09, "saw") + tone(root, BEAT * 0.24, 0.12), 420, "low", 127) * 1.5)
                place(m, fade(note, 0.003, 0.02), t + BEAT * k, 0.34)
        if "arp" in on:
            for k in range(4):
                f = midi(chord[(b * 4 + k) % 3] + 12 + (12 if (b + k) % 3 == 0 else 0))
                pl = fade(filt(tone(f, 0.16, 0.05, "saw") * 0.5 + tone(f, 0.16, 0.06), 3200, "low", 63), 0.002, 0.02)
                place(m, pl, t + k * BEAT / 4, 0.085, pan=0.5 * np.sin(b + k))
                place(m, pl, t + k * BEAT / 4 + BEAT * 0.75, 0.035, pan=-0.5 * np.sin(b + k))  # delay tap
    # pad: slow detuned saw chords through a low-pass, the glue of the track
    pad = np.zeros(N, dtype=np.float32)
    seg = int(8 * BEAT * SR)
    start = int(MUSIC_T0 * SR)
    idx = 0
    while start < N:
        chord = CHORDS[idx % 4]
        a, b = max(start, 0), min(start + seg, N)
        if b > a:
            tt = np.arange(b - a) / SR
            x = np.zeros(b - a, dtype=np.float32)
            for note in chord:
                for det in (-0.07, 0.0, 0.06):
                    f = midi(note + det)
                    x += (2 * ((f * tt) % 1) - 1).astype(np.float32)
            e = np.minimum(1, tt / 0.6) * np.minimum(1, (tt[-1] - tt) / 0.5 + 0.15)
            pad[a:b] += x * e.astype(np.float32) / 9
        start += seg
        idx += 1
    pad = filt(pad, 900, "low", 255)
    pump = 1 - 0.45 * np.exp(-((np.arange(N) / SR - MUSIC_T0) % BEAT) / 0.11)  # side-chain style breathing
    pump[: int(4.55 * SR)] = 1
    m[:, 0] += pad * pump * 0.42
    m[:, 1] += np.roll(pad, 300) * pump * 0.42
    m[: int(0.4 * SR)] *= np.linspace(0, 1, int(0.4 * SR))[:, None]
    tail = int(1.4 * SR)
    m[-tail:] *= np.linspace(1, 0, tail)[:, None] ** 1.5
    return m


# ----------------------------------------------------------------------------- assemble
def main():
    vo = np.zeros((N, 2), dtype=np.float32)
    for name, t, g in VO:
        x = read_wav(name)
        x = filt(x, 70, "high", 511)  # rumble
        place(vo, x, t, g)
    vo /= max(1e-6, np.abs(vo).max())

    fx = np.zeros((N, 2), dtype=np.float32)
    click, tick, pop, whoosh, thump = sfx_click(), sfx_tick(), sfx_pop(), sfx_whoosh(), sfx_thump()
    for t in (4.5, 6.36, 11.76, 17.28, 19.46, 26.46, 29.66, 35.06, 39.76, 41.42, 43.72):
        place(fx, whoosh, t, 0.34, pan=rng.uniform(-0.3, 0.3))
    for t, g in ((0.0, 0.7), (5.14, 0.75), (5.58, 0.9), (25.3, 1.0), (25.74, 0.8), (40.36, 0.85), (40.72, 0.9),
                 (41.56, 0.9), (42.26, 0.7), (42.76, 1.0), (43.88, 0.9), (45.3, 0.7)):
        place(fx, thump, t, 0.62 * g)
    for t in (0.8, 2.52, 3.62, 7.05, 7.78, 17.94, 22.6, 30.14, 31.22, 36.72, 45.0):
        place(fx, click, t, 0.5)
    for t, p in ((2.78, 0), (14.3, -0.5), (15.32, 0.5), (16.16, 0.4), (21.1, -0.5), (22.5, 0), (23.14, 0.5),
                 (30.3, -0.4), (31.46, -0.4), (32.92, -0.4), (37.98, -0.5), (38.62, 0.5), (39.06, -0.5),
                 (42.5, -0.3), (42.72, -0.1), (42.94, 0.1), (43.16, 0.3)):
        place(fx, pop, t, 0.38, pan=p)
    place(fx, sfx_chime((1568.0, 2093.0), 0.07, 0.16), 3.78, 0.3)
    place(fx, sfx_chime(), 10.14, 0.6)
    place(fx, sfx_chime((1046.5, 1568.0), 0.08, 0.2), 17.98, 0.38)   # mic on
    place(fx, sfx_chime((1568.0, 2093.0), 0.07, 0.16), 33.95, 0.3)
    place(fx, sfx_chime(), 36.8, 0.6)
    place(fx, sfx_chime((1318.5, 1760.0, 2637.0), 0.08, 0.3), 45.08, 0.55)
    place(fx, sfx_shutter(), 32.9, 0.75)
    place(fx, sfx_scan(), 21.08, 0.7)
    place(fx, sfx_riser(), 24.6, 0.5)
    for a, b in ((1.35, 2.3), (23.14, 23.86), (31.46, 32.36)):
        t = a
        while t < b:
            place(fx, tick, t, rng.uniform(0.2, 0.36), pan=rng.uniform(-0.2, 0.2))
            t += rng.uniform(0.05, 0.085)

    mus = music()
    # duck the music under the voice
    level = np.abs(vo).mean(axis=1)
    win = int(0.12 * SR)
    level = np.convolve(level, np.ones(win) / win, mode="same")
    duck = 1 - 0.62 * np.clip(level / 0.05, 0, 1)
    duck = np.convolve(duck, np.ones(win) / win, mode="same").astype(np.float32)
    def db(x, sel):
        return 20 * np.log10(np.sqrt(np.mean(x[sel] ** 2)) + 1e-9)

    speaking = level > 0.02
    bed = mus * duck[:, None] * 0.52
    print(f"while speaking: voice {db(vo, speaking):.1f} dB, music {db(bed, speaking):.1f} dB, fx {db(fx * 0.5, speaking):.1f} dB")
    print(f"between lines:  music {db(bed, ~speaking):.1f} dB, fx {db(fx * 0.5, ~speaking):.1f} dB")
    mix = vo * 1.0 + bed + fx * 0.5
    mix = np.tanh(mix * 1.15) / np.tanh(1.15)
    mix *= 0.89 / np.abs(mix).max()

    raw = os.path.join(HERE, "mix_raw.wav")
    with wave.open(raw, "wb") as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes((np.clip(mix, -1, 1) * 32767).astype(np.int16).tobytes())
    out = os.path.join(HERE, "mix.wav")
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", raw, "-af", "loudnorm=I=-14:TP=-1.5:LRA=9", "-ar", str(SR), out], check=True)
    print("wrote", out)


if __name__ == "__main__":
    main()
