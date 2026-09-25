"""The film score. One waltz theme ("Bolt's theme") carries the story: a lonely
music box at the start, felt piano at sunset, a lullaby at night and the full
orchestra + choir when the world blooms. Timings follow src/story/timeline.js.
"""
import numpy as np
import synth as S
from synth import n2m, midi_hz

# ---------------------------------------------------------------- material
THEME = [
    [('E5', 0, 2), ('D5', 2, 1)],
    [('C5', 0, 1), ('E5', 1, 1), ('G5', 2, 1)],
    [('A5', 0, 2), ('G5', 2, 1)],
    [('E5', 0, 3)],
    [('F5', 0, 2), ('E5', 2, 1)],
    [('D5', 0, 1), ('C5', 1, 1), ('D5', 2, 1)],
    [('E5', 0, 2), ('C5', 2, 1)],
    [('D5', 0, 3)],
    [('E5', 0, 2), ('D5', 2, 1)],
    [('C5', 0, 1), ('E5', 1, 1), ('G5', 2, 1)],
    [('C6', 0, 2), ('B5', 2, 1)],
    [('A5', 0, 3)],
    [('F5', 0, 1), ('A5', 1, 1), ('G5', 2, 1)],
    [('E5', 0, 1), ('C5', 1, 1), ('D5', 2, 1)],
    [('C5', 0, 3)],
]
MAJ = ['C', 'C', 'F', 'C', 'F', 'G', 'C', 'G', 'C', 'C', 'Am', 'F', 'Dm', 'G7', 'C']
MIN = ['Am', 'Am', 'F', 'C', 'Dm', 'E', 'Am', 'E', 'Am', 'Am', 'F', 'F', 'Dm', 'E', 'Am']
CH = {
    'C': ['C', 'E', 'G'], 'F': ['F', 'A', 'C'], 'G': ['G', 'B', 'D'], 'G7': ['G', 'B', 'F'], 'Am': ['A', 'C', 'E'],
    'Dm': ['D', 'F', 'A'], 'E': ['E', 'G#', 'B'], 'Em': ['E', 'G', 'B'], 'Fmaj7': ['F', 'A', 'E'], 'Cmaj7': ['C', 'E', 'B'],
    'Dm9': ['D', 'F', 'E'], 'Gsus': ['G', 'C', 'D'],
}


def chord_midis(name, octave=4):
    notes = CH[name]
    root = n2m(notes[0] + str(octave))
    out = []
    for n in notes:
        m = n2m(n + str(octave))
        while m < root:
            m += 12
        out.append(m)
    return out


def bass_midi(name, octave=2):
    return n2m(CH[name][0] + str(octave))


def hz(m):
    return midi_hz(m)


# ---------------------------------------------------------------- helpers
def melody(tr, inst, bars, t0, bar_dur, gain=0.5, octave=0, p=0.0, vel=0.8, ring=2.2, legato=0.95):
    beat = bar_dur / 3
    for i, b in enumerate(bars):
        if b is None:
            continue
        for (n, bt, ln) in THEME[b - 1]:
            f = hz(n2m(n) + 12 * octave)
            dur = ln * beat * legato
            x = inst(f, max(dur, 0.1) if ring is None else max(ring, dur + 0.5), vel)
            tr.add(t0 + i * bar_dur + bt * beat, x, gain, p)


def pad(tr, inst, chords, t0, bar_dur, gain=0.2, octave=3, vel=0.6, p=0.0, spread=0.35, **kw):
    for i, c in enumerate(chords):
        if c is None:
            continue
        for j, m in enumerate(chord_midis(c, octave)):
            x = inst(hz(m), bar_dur * 0.98, vel, **kw)
            tr.add(t0 + i * bar_dur, x, gain, p + (j - 1) * spread)


def oompah(tr, chords, t0, bar_dur, gain=0.35, octave=3):
    beat = bar_dur / 3
    for i, c in enumerate(chords):
        tr.add(t0 + i * bar_dur, S.pizz(hz(bass_midi(c, 2)), 0.9, 0.9), gain * 1.2, -0.1)
        for k in (1, 2):
            for j, m in enumerate(chord_midis(c, octave)):
                tr.add(t0 + i * bar_dur + k * beat, S.pizz(hz(m), 0.5, 0.55), gain * 0.45, 0.25 + j * 0.1)


def arp(tr, inst, chord, t0, step, count, gain=0.3, octave=4, up=True, p=0.2, vel=0.7, ring=2.0):
    ms = chord_midis(chord, octave)
    seq = []
    o = 0
    while len(seq) < count:
        for m in ms:
            seq.append(m + 12 * o)
        o += 1
    seq = seq[:count]
    if not up:
        seq = seq[::-1]
    for k, m in enumerate(seq):
        tr.add(t0 + k * step, inst(hz(m), ring, vel), gain, p + 0.4 * np.sin(k))


def gliss(tr, t0, dur, lo='C4', hi='C6', gain=0.25, inst=None, scale=(0, 2, 4, 5, 7, 9, 11), up=True):
    inst = inst or S.harp
    ms = []
    m = n2m(lo)
    while m <= n2m(hi):
        if (m % 12) in scale:
            ms.append(m)
        m += 1
    if not up:
        ms = ms[::-1]
    for k, m in enumerate(ms):
        tr.add(t0 + dur * k / len(ms), inst(hz(m), 2.0, 0.6), gain, -0.4 + 0.8 * k / len(ms))


def tremolo_strings(tr, midis, t0, dur, gain, rate=11, swell=True):
    for j, m in enumerate(midis):
        x = S.strings(hz(m), dur, 0.7, attack=0.4 if swell else 0.05, release=0.3, voices=4, bright=0.7)
        tt = np.arange(len(x)) / S.SR
        trem = 0.55 + 0.45 * np.sin(2 * np.pi * rate * tt) ** 2
        env = (tt / dur) ** 1.5 if swell else 1
        tr.add(t0, x * trem * np.minimum(1, env + 0.15), gain, -0.3 + 0.3 * j)


def sad_trombone(tr, t0, gain=0.35):
    notes = [('G4', 0.0, 0.32), ('F#4', 0.36, 0.32), ('F4', 0.72, 0.32), ('E4', 1.08, 1.1)]
    for n, st, d in notes:
        f = hz(n2m(n) - 12)
        tt = S.t_axis(d + 0.1)
        wob = 1 + (0.02 * np.sin(2 * np.pi * 6 * tt) * (tt > 0.3) if d > 0.5 else 0)
        x = S.saw_bl(f * wob, tt, 18)
        wah = 0.5 + 0.5 * np.sin(np.minimum(tt / d, 1) * np.pi)
        x = S.lp(x, 600) * (0.4 + 0.6 * wah) + S.bp(x, 800, 2000) * 0.3 * wah
        tr.add(t0 + st, x * S.adsr(len(tt), 0.03, 0.05, 0.9, 0.1), gain)


# ---------------------------------------------------------------- the score
def score(total):
    tr = S.Track(total)
    mb, cel, gl, pno, hp_ = S.music_box, S.celesta, S.glock, S.felt_piano, S.harp

    # 1. Opening: lonely music box over a soft string bed, title swell.
    B = 2.4
    melody(tr, mb, [1, 2, 3, 4], 1.2, B, gain=0.34, octave=0, p=0.15, vel=0.7)
    pad(tr, S.strings, ['C', 'C', 'F', 'C'], 1.2, B, gain=0.06, octave=3, vel=0.6, attack=1.2, release=1.0, bright=0.2)
    gliss(tr, 10.1, 0.7, 'C4', 'C6', gain=0.16)
    pad(tr, S.strings, ['C', 'F'], 10.8, 2.0, gain=0.1, octave=4, vel=0.6, attack=0.5, release=1.2, bright=0.5)
    pad(tr, S.choir, ['C', 'F'], 10.8, 2.0, gain=0.08, octave=4, vel=0.6)
    melody(tr, gl, [9, 10], 10.8, 2.0, gain=0.2, octave=0, vel=0.7)
    tr.add(10.8, S.cymbal_swell(0.01, 0.0), 0)
    tr.add(14.8, S.cymbal_hit(2.0, 0.12), 0.5)

    # 2. Meet Bolt: tiptoe walking bass + marimba, stop, "Hi!" sparkle.
    beat = 0.6
    walk = ['C3', 'G2', 'A2', 'E2', 'F2', 'C3', 'G2', 'G2']
    for i in range(8):
        tr.add(15.2 + i * beat, S.pizz(hz(n2m(walk[i])), 0.6, 0.85), 0.34, -0.1)
    rif = ['E5', 'G5', 'E5', 'C5', 'D5', 'F5', 'E5', 'D5']
    for i in range(8):
        tr.add(15.2 + i * beat + 0.3, S.marimba(hz(n2m(rif[i])), 0.8, 0.6), 0.14, 0.3)
    tr.add(20.05, S.pizz(hz(n2m('G2')), 0.8, 0.9), 0.32)
    tr.add(20.05, S.pizz(hz(n2m('B3')), 0.6, 0.7), 0.2, 0.3)
    arp(tr, gl, 'C', 21.0, 0.1, 5, gain=0.16, octave=5, vel=0.6)
    arp(tr, cel, 'C', 21.9, 0.06, 6, gain=0.12, octave=6, vel=0.6)
    pad(tr, S.strings, ['C', 'G'], 22.3, 1.1, gain=0.07, octave=4, attack=0.3, release=0.8)

    # 3. Work song: bouncy 4/4 with hits on scoop / squish / stack.
    bt = 60 / 116
    riff = [('G4', 0), ('C5', 1), ('E5', 2), ('G5', 3), ('A5', 4), ('G5', 5), ('E5', 6), ('C5', 7),
            ('F5', 8), ('E5', 9), ('D5', 10), ('C5', 11), ('D5', 12), ('G4', 14)]
    bass_seq = ['C2', 'G2', 'C2', 'G2', 'F2', 'C2', 'G2', 'D2']
    t0 = 24.7
    for bar in range(4):
        base = t0 + bar * 4 * bt
        for k in range(4):
            tt = base + k * bt
            if tt > 33.1:
                break
            if k % 2 == 0:
                tr.add(tt, S.pizz(hz(n2m(bass_seq[(bar * 2 + k // 2) % 8])), 0.6, 0.9), 0.36, -0.15)
                tr.add(tt, S.soft_kick(0.5), 0.35)
            tr.add(tt + bt / 2, S.shaker(0.25), 0.3, 0.4)
            tr.add(tt, S.shaker(0.12), 0.25, 0.4)
    for rep in range(2):
        for n, b in riff:
            tt = t0 + rep * 16 * bt + b * bt / 2 * 1.0 + (0 if rep == 0 else 0)
            if 28.2 < tt < 33.1 and rep == 1:
                continue
            if tt < 28.3:
                tr.add(tt, S.marimba(hz(n2m(n)), 0.7, 0.7), 0.16, 0.25)
    for k, n in enumerate(['C6', 'A5', 'F5', 'D5', 'B4']):  # scoop run
        tr.add(28.5 + k * 0.06, S.marimba(hz(n2m(n)), 0.5, 0.7), 0.16, 0.2)
    for tt in (29.55, 29.95):  # squish
        tr.add(tt, S.pizz(hz(n2m('C2')), 0.7, 1.0), 0.5)
        tr.add(tt, S.timpani(hz(n2m('C2')), 0.8, 0.5), 0.25)
    for tt, n in zip([31.25, 31.75, 32.25], ['C6', 'E6', 'G6']):  # stack!
        tr.add(tt, S.glock(hz(n2m(n)), 1.6, 0.8), 0.22, 0.1)
        tr.add(tt, S.pizz(hz(n2m(n) - 24), 0.5, 0.8), 0.22)
    pad(tr, S.strings, ['C'], 32.62, 0.5, gain=0.12, octave=4, attack=0.02, release=0.35, bright=0.8)  # ta-da
    tr.add(32.62, S.cymbal_hit(1.5, 0.14), 0.4)
    tr.add(32.62, S.glock(hz(n2m('C7')), 1.5, 0.7), 0.12)

    # 4. Wobble -> bonk -> sad trombone.
    tremolo_strings(tr, [n2m('G3'), n2m('D4'), n2m('G4')], 33.3, 2.1, 0.08)
    tremolo_strings(tr, [n2m('B4'), n2m('F5')], 34.3, 1.1, 0.06, rate=14)
    sad_trombone(tr, 37.85, 0.3)

    # 5. Sunset: the theme in A minor on felt piano.
    B = 2.7
    melody(tr, pno, [1, 2, 3, 4], 40.2, B, gain=0.34, octave=-1, vel=0.55, ring=3.0)
    pad(tr, S.strings, ['Am', 'Am', 'F', 'C', 'E'], 40.2, B, gain=0.07, octave=3, attack=1.0, release=1.5, bright=0.25)
    for i, c in enumerate(['Am', 'Am', 'F', 'C']):
        tr.add(40.2 + i * B, pno(hz(bass_midi(c, 2)), 3.5, 0.45), 0.3, -0.2)
    melody(tr, pno, [7, 8], 51.0, 1.8, gain=0.26, octave=-1, vel=0.45, ring=3.0)
    tr.add(51.0, pno(hz(n2m('A2')), 3.5, 0.4), 0.28)

    # 6. Rummage: comic tiptoe.
    bt = 60 / 132
    tip = ['C4', 'G3', 'C4', 'G3', 'Eb4', 'G3', 'D4', 'G3']
    for k in range(int((56.2 - 53.2) / bt)):
        tr.add(53.2 + k * bt, S.pizz(hz(n2m(tip[k % 8])), 0.4, 0.8), 0.24, -0.2 + 0.4 * (k % 2))
    for tt, n in zip([53.9, 54.7, 55.5], ['G5', 'A5', 'B5']):
        tr.add(tt, S.glock(hz(n2m(n)), 1.0, 0.6), 0.12, 0.3)
    tr.add(56.85, cel(hz(n2m('E6')), 1.2, 0.5), 0.1)
    tr.add(56.95, cel(hz(n2m('G6')), 1.2, 0.5), 0.1)
    x = S.strings(hz(n2m('E6')), 1.4, 0.6, attack=0.5, release=0.8, voices=3, bright=0.9)
    tr.add(57.35, x, 0.05, 0.2)

    # 7. Wonder: the sprout.
    arp(tr, cel, 'Cmaj7', 58.7, 0.15, 12, gain=0.14, octave=5, vel=0.55)
    arp(tr, cel, 'Fmaj7', 60.5, 0.15, 12, gain=0.14, octave=5, vel=0.55)
    pad(tr, S.strings, ['Cmaj7', 'Fmaj7'], 58.8, 2.2, gain=0.09, octave=4, attack=0.9, release=1.2, bright=0.4)
    pad(tr, S.choir, ['C', 'F', 'C'], 59.4, 2.0, gain=0.08, octave=4)
    gliss(tr, 60.3, 0.6, 'G4', 'G6', gain=0.12)
    melody(tr, cel, [1, 2], 62.6, 1.7, gain=0.16, octave=0, vel=0.6)
    pad(tr, S.strings, ['C', 'F'], 63.3, 1.5, gain=0.07, octave=4, attack=0.7)
    gliss(tr, 65.6, 0.5, 'C5', 'C7', gain=0.12, inst=gl)
    pad(tr, S.choir, ['F', 'C'], 66.1, 0.8, gain=0.12, octave=4, attack=0.15, release=1.4)
    pad(tr, S.strings, ['C'], 66.9, 1.0, gain=0.09, octave=4, attack=0.2, release=1.2)

    # 8. Whoosh: suspense, build, impact.
    tremolo_strings(tr, [n2m('D3'), n2m('A3')], 67.6, 4.0, 0.06, rate=9)
    x = S.strings(hz(n2m('A5')), 3.8, 0.5, attack=1.0, release=0.4, voices=3, bright=0.9)
    tr.add(67.8, x, 0.03, 0.3)
    tr.add(69.9, S.cymbal_swell(1.7, 0.5), 0.3)
    tr.add(71.6, S.timpani(hz(n2m('D2')), 3.0, 1.0), 0.6)
    tr.add(71.6, S.cymbal_hit(3.0, 0.5), 0.35)
    pad(tr, S.choir, ['Dm9'], 72.0, 3.0, gain=0.06, octave=4)

    # 9. Scanning: mysterious pulsing arpeggio.
    seq = ['D5', 'F5', 'A5', 'E5', 'D5', 'A4', 'F5', 'E5']
    k = 0
    tt = 73.4
    while tt < 78.9:
        if not (77.1 < tt < 78.0):
            f = hz(n2m(seq[k % 8]))
            tone = np.sin(2 * np.pi * f * S.t_axis(0.5)) * np.exp(-S.t_axis(0.5) * 9)
            tr.add(tt, tone, 0.09, 0.5 * np.sin(k))
            tr.add(tt + 0.375, tone * 0.4, 0.09, -0.5 * np.sin(k))  # echo
        if k % 4 == 0 and not (77.1 < tt < 78.0):
            tr.add(tt, S.bass(hz(n2m('D2')), 0.3, 0.5), 0.2)
        k += 1
        tt += 0.25
    tr.add(77.12, S.pizz(hz(n2m('A4')), 0.4, 0.8), 0.18)

    # 10. Meeting.
    for m in chord_midis('G7', 4):
        tr.add(79.95, S.pizz(hz(m), 0.6, 0.9), 0.14, 0.2)
    tr.add(79.95, gl(hz(n2m('F6')), 1.0, 0.6), 0.12)
    tr.add(79.95, S.cymbal_hit(0.8, 0.08), 0.5)
    for n, st, d in [('G5', 81.2, 0.3), ('E5', 81.55, 0.3), ('C6', 81.9, 0.5), ('B5', 82.45, 0.25), ('G5', 82.75, 0.6)]:
        tr.add(st, S.flute(hz(n2m(n)), d, 0.6), 0.14, -0.2)
        tr.add(st, cel(hz(n2m(n)), 1.2, 0.4), 0.06, 0.2)
    pad(tr, S.strings, ['F', 'C'], 81.1, 1.2, gain=0.07, octave=4, attack=0.4)
    gliss(tr, 82.15, 0.45, 'C5', 'C7', gain=0.1)
    for n, st in [('C5', 84.5), ('E5', 84.65), ('G5', 84.8), ('E5', 84.95), ('C6', 85.1)]:
        tr.add(st, S.marimba(hz(n2m(n)), 0.8, 0.8), 0.17, 0.2)
    for k in range(6):
        tr.add(85.3 + k * 0.12, S.pizz(hz(n2m(['E4', 'G4', 'E4', 'C5', 'G4', 'C5'][k])), 0.4, 0.7), 0.13, 0.3 - 0.1 * k)

    # 11. "Is that a plant?!"
    x = S.strings(hz(n2m('G4')), 1.2, 0.6, attack=0.3, release=0.4, voices=4, bright=0.6)
    tr.add(86.3, x, 0.06)
    arp(tr, cel, 'Fmaj7', 87.4, 0.07, 8, gain=0.12, octave=5)
    gliss(tr, 87.4, 0.4, 'F5', 'F6', gain=0.08)
    melody(tr, gl, [1, 2], 88.0, 1.2, gain=0.18, vel=0.7)
    melody(tr, S.flute, [1, 2], 88.0, 1.2, gain=0.12, ring=None)
    pad(tr, S.strings, ['C', 'C'], 88.0, 1.2, gain=0.09, octave=4, attack=0.1)
    oompah(tr, ['C', 'C'], 88.0, 1.2, gain=0.2)
    pad(tr, S.strings, ['F', 'C'], 89.9, 0.9, gain=0.1, octave=3, attack=0.3, release=1.2)
    pad(tr, S.choir, ['F', 'C'], 89.9, 0.9, gain=0.08, octave=4)

    # 12. Montage: the full waltz!
    B = 1.8
    t0 = 91.5
    bars = [1, 2, 3, 4, 13, 14]
    chords = [MAJ[b - 1] for b in bars]
    melody(tr, gl, bars, t0, B, gain=0.2, vel=0.75)
    melody(tr, S.flute, bars, t0, B, gain=0.12, octave=0, ring=None, legato=0.9)
    oompah(tr, chords[:4], t0, B, gain=0.26)
    pad(tr, S.strings, chords, t0, B, gain=0.08, octave=4, attack=0.2, release=0.5, bright=0.6)
    for i, c in enumerate(chords[:4]):
        arp(tr, hp_, c, t0 + i * B, B / 9, 9, gain=0.08, octave=4)
    for i in range(12):
        tr.add(t0 + i * B / 3 * 1.0, S.shaker(0.18), 0.2, 0.5)
    pad(tr, S.choir, chords[4:], t0 + 4 * B, B, gain=0.06, octave=4)

    # 13. Planting: gentle celesta theme.
    B = 2.4
    t0 = 102.3
    melody(tr, cel, [15, 1, 2, 3, 4], t0, B, gain=0.2, vel=0.6)
    pad(tr, S.strings, ['C', 'C', 'C', 'F', 'C'], t0, B, gain=0.06, octave=3, attack=0.8, release=1.0, bright=0.3)
    for i, c in enumerate(['C', 'C', 'C', 'F']):
        arp(tr, hp_, c, t0 + i * B, B / 6, 6, gain=0.07, octave=3)
    rng = np.random.default_rng(4)
    for k in range(10):
        m = n2m('C6') + [0, 2, 4, 7, 9, 12][rng.integers(6)]
        tr.add(108.35 + k * 0.25 + rng.random() * 0.1, gl(hz(m), 1.0, 0.35), 0.06, rng.uniform(-0.5, 0.5))
    pad(tr, S.strings, ['F', 'Gsus'], 109.4, 1.3, gain=0.05, octave=4, attack=0.6, release=1.2)
    pad(tr, S.choir, ['Gsus'], 110.7, 1.5, gain=0.06, octave=4)

    # 14. Night lullaby.
    B = 2.6
    melody(tr, mb, [5, 6, 7], 112.3, B, gain=0.3, vel=0.6)
    pad(tr, S.choir, ['F', 'G', 'C'], 112.3, B, gain=0.05, octave=4, attack=1.0, release=1.5)
    tr.add(116.8, gl(hz(n2m('E7')), 2.0, 0.4), 0.08, -0.5)
    gliss(tr, 116.8, 0.5, 'C6', 'E7', gain=0.05, inst=cel, up=False)

    # 15. Dawn: build to the magic pulse.
    for i, c in enumerate(['C', 'Dm', 'Em', 'F']):
        pad(tr, S.choir, [c], 119.9 + i * 0.95, 1.0, gain=0.05 + 0.02 * i, octave=4, attack=0.4, release=0.6)
    x = S.strings(hz(n2m('C2')), 4.0, 0.7, attack=2.5, release=0.4, voices=5, bright=0.3)
    tr.add(119.6, x, 0.12)
    for k in range(18):
        tr.add(121.4 + k * (0.13 - 0.004 * k), hp_(hz(chord_midis(['C', 'F', 'G'][k // 6], 4)[k % 3] + 12 * (k % 6 // 3)), 1.5, 0.6), 0.07, -0.4 + 0.05 * k)
    tr.add(121.6, S.cymbal_swell(1.9, 0.5), 0.3)
    tr.add(123.5, S.timpani(hz(n2m('C2')), 3.0, 1.0), 0.55)
    tr.add(123.5, S.cymbal_hit(3.0, 0.4), 0.3)
    pad(tr, S.choir, ['C'], 123.5, 1.1, gain=0.14, octave=4, attack=0.05, release=1.0)
    pad(tr, S.strings, ['C'], 123.5, 1.1, gain=0.12, octave=4, attack=0.05, release=0.8, bright=0.8)

    # 16. Bloom: the theme in full glory.
    B = 2.1
    t0 = 124.6
    bars = [9, 10, 11, 12, 13, 14, 15]
    chords = [MAJ[b - 1] for b in bars]
    melody(tr, lambda f, d, v: S.strings(f, d, v, attack=0.08, release=0.4, voices=6, bright=0.75), bars, t0, B, gain=0.16, ring=None, legato=1.0)
    melody(tr, gl, bars, t0, B, gain=0.17, octave=1, vel=0.7)
    melody(tr, S.flute, bars, t0, B, gain=0.08, octave=0, ring=None)
    pad(tr, S.strings, chords, t0, B, gain=0.08, octave=3, attack=0.3, release=0.6, bright=0.5)
    pad(tr, S.choir, chords, t0, B, gain=0.07, octave=4, attack=0.4, release=0.8)
    oompah(tr, chords, t0, B, gain=0.26)
    for i, c in enumerate(chords):
        arp(tr, hp_, c, t0 + i * B, B / 9, 9, gain=0.07, octave=4)
        tr.add(t0 + i * B, S.timpani(hz(bass_midi(c, 2)), 1.5, 0.6), 0.25)
    tr.add(126.8, S.cymbal_swell(1.8, 0.35), 0.3)
    tr.add(130.9, S.cymbal_swell(2.0, 0.35), 0.3)
    tr.add(137.2, S.cymbal_hit(3.0, 0.3), 0.3)
    pad(tr, S.strings, ['C'], 137.2, 2.2, gain=0.1, octave=4, attack=0.1, release=1.5, bright=0.7)

    # 17. Golden hour: warm reprise.
    B = 2.6
    t0 = 139.6
    melody(tr, pno, [1, 2, 3, 4], t0, B, gain=0.3, vel=0.55, ring=3.0)
    pad(tr, S.strings, ['C', 'C', 'F', 'C'], t0, B, gain=0.07, octave=3, attack=0.9, release=1.2, bright=0.3)
    for i, c in enumerate(['C', 'C', 'F', 'C']):
        tr.add(t0 + i * B, pno(hz(bass_midi(c, 2)), 3.5, 0.4), 0.25, -0.2)
    tr.add(143.2, cel(hz(n2m('G6')), 1.5, 0.6), 0.12)
    gliss(tr, 145.35, 0.5, 'F4', 'F6', gain=0.09)
    pad(tr, S.choir, ['F', 'C'], 145.3, 1.3, gain=0.07, octave=4)

    # 18. Ending: music box, final chord on "The End", credits coda.
    B = 2.2
    melody(tr, mb, [13, 14, 15], 147.4, B, gain=0.3, vel=0.65)
    pad(tr, S.strings, ['Dm', 'G7'], 147.4, B, gain=0.07, octave=3, attack=0.8)
    gliss(tr, 151.2, 0.6, 'C4', 'C6', gain=0.12)
    pad(tr, S.strings, ['C'], 151.8, 3.5, gain=0.12, octave=3, attack=0.2, release=2.5, bright=0.4)
    pad(tr, S.choir, ['C'], 151.8, 3.0, gain=0.09, octave=4, release=2.5)
    tr.add(151.8, gl(hz(n2m('C6')), 3.0, 0.6), 0.12)
    tr.add(151.8, gl(hz(n2m('G6')), 3.0, 0.5), 0.08)
    melody(tr, mb, [1, 2, 15], 154.6, 1.6, gain=0.2, vel=0.5)
    return tr.buf


if __name__ == '__main__':
    import soundfile as sf
    y = score(160)
    ir = S.reverb_ir(2.6, 0.03, 4000)
    wet = S.convolve_stereo(y, ir)[: len(y)]
    out = y * 0.75 + wet * 0.45
    out /= np.abs(out).max() + 1e-9
    sf.write('build/music_preview.wav', (out * 0.9).astype(np.float32), S.SR)
    print('ok', len(out) / S.SR)
