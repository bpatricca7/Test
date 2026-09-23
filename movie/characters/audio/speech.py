#!/usr/bin/env python3
"""ECHO (characters cut): every line of dialogue, spoken by synthetic voices.

A phoneme-driven, Klatt-style formant synthesizer written from scratch with
numpy/scipy only: no TTS engine, no voice API, no recorded samples, no models.
It grows out of the first cut's movie/audio/voice.py ("We heard you.").

  script          hand-written ARPAbet for every word (LEXICON, per-line overrides)
                  and a prosodic markup per line (SCRIPT: *accent, **emphasis,
                  punctuation = phrase boundaries and boundary tones)
  durations       Klatt (1979) duration rules (phrase-final lengthening, stress,
                  polysyllabic and cluster shortening, postvocalic voicing),
                  stop closures + bursts + VOT, pauses at punctuation, and one
                  tempo factor per line fitted to the line's target length
  intonation      declining baseline, H* pitch accents (downstepped), emphatic
                  accents, L-L% falls (statements, wh-questions), L* H-H% rises
                  (yes/no questions), continuation rises, microprosody
  articulation    target + locus coarticulation: vowel/diphthong/sonorant targets,
                  locus equations for each consonant place, per-formant
                  transition times, nasal pole/zero coupling, F1 cutback
  sources         Liljencrants-Fant glottal pulses (Rd voice quality, jitter,
                  shimmer), pitch-synchronous breath, aspiration, voice bar,
                  shaped frication and place-specific stop bursts
  filters         cascade: nasal pole + nasal zero, F1..F5, higher-pole correction;
                  fixed parallel banks for fricatives and bursts
  voices          MAYA (warm low alto), SAM (young tenor), VISITOR (the first cut's
                  eerie layered voice and radio/space chain, imported from voice.py)

Run from the repo root:
    python3 movie/characters/audio/speech.py            # all lines + sheets
    python3 movie/characters/audio/speech.py d05 d10    # just these lines (manifest merged)
    python3 movie/characters/audio/speech.py --no-sheets

Writes movie/characters/build/dialogue/<id>.wav (48 kHz mono 16-bit, 20 ms pre-roll)
and manifest.json (see API.md), plus analysis sheets in
movie/characters/build/voice_sheets/. Deterministic: every noise source is seeded.
"""

import importlib.util
import json
import os
import sys
import wave

import numpy as np
from scipy import signal
from scipy.interpolate import PchipInterpolator
from scipy.optimize import brentq

HERE = os.path.dirname(os.path.abspath(__file__))
CHAR_DIR = os.path.normpath(os.path.join(HERE, ".."))
MOVIE_DIR = os.path.normpath(os.path.join(CHAR_DIR, ".."))
OUT_DIR = os.path.join(CHAR_DIR, "build", "dialogue")
SHEET_DIR = os.path.join(CHAR_DIR, "build", "voice_sheets")

sys.dont_write_bytecode = True     # leave no caches next to the shipped first-cut code
sys.path.insert(0, os.path.join(MOVIE_DIR, "audio"))
import voice as V1  # noqa: E402  the first cut's Visitor voice: constants, radio chain helpers, PNG helpers

FS = 48000
CR = 1000                 # control rate of the parameter tracks (Hz)
PRE_ROLL = 0.020          # s of silence before the first phoneme
HUMAN_TAIL = 0.09         # s kept after the last phoneme (ring-down, breath)
VISITOR_TAIL = 1.9        # s of echo/reverb tail kept after the Visitor's last phoneme
SEED = 1974
LUFS_TARGET = -20.0       # speech loudness of a normal-level line (K-weighted, speech-gated)
PEAK_CEIL = -1.0          # dBFS


# ---------------------------------------------------------------------------
# Phonetic inventory
# ---------------------------------------------------------------------------
# kind: V vowel, D diphthong, G glide, L liquid, N nasal, S stop, F fricative,
#       A affricate, H /h/, X flap, P pause

KIND = {p: "V" for p in "AA AE AH AO EH ER IH IY UH UW".split()}
KIND.update({p: "D" for p in "AW AY EY OW OY".split()})
KIND.update({"W": "G", "Y": "G", "L": "L", "R": "L", "M": "N", "N": "N", "NG": "N",
             "P": "S", "B": "S", "T": "S", "D": "S", "K": "S", "G": "S",
             "F": "F", "V": "F", "TH": "F", "DH": "F", "S": "F", "Z": "F", "SH": "F", "ZH": "F",
             "CH": "A", "JH": "A", "HH": "H", "DX": "X"})
VOICED = set("AA AE AH AO EH ER IH IY UH UW AW AY EY OW OY W Y L R M N NG B D G V DH Z ZH JH DX".split())
PLACE = {"P": "lab", "B": "lab", "M": "lab", "F": "labdent", "V": "labdent", "TH": "dent", "DH": "dent",
         "T": "alv", "D": "alv", "N": "alv", "S": "alv", "Z": "alv", "DX": "alv", "L": "alv",
         "SH": "post", "ZH": "post", "CH": "post", "JH": "post", "R": "post",
         "K": "vel", "G": "vel", "NG": "vel", "W": "lab", "Y": "pal", "HH": "glot"}
TRANSPARENT = set("SFAX")          # obstruents: formants interpolate between their boundary loci
REDUCED = {"AH": "AX", "IH": "IX", "ER": "AXR", "UW": "UX"}   # unstressed vowel qualities

# Klatt (1979) inherent / minimum durations (ms). Stops: closure + burst.
DUR = {
    "AA": (240, 100), "AE": (230, 80), "AH": (140, 60), "AO": (240, 100), "AW": (260, 100),
    "AY": (250, 150), "EH": (150, 70), "ER": (180, 80), "EY": (190, 100), "IH": (135, 40),
    "IY": (155, 55), "OW": (220, 80), "OY": (280, 150), "UH": (160, 60), "UW": (210, 70),
    "AX": (120, 60), "IX": (110, 40), "AXR": (160, 60), "UX": (130, 50),
    "B": (85, 60), "D": (75, 50), "G": (80, 60), "P": (90, 50), "T": (75, 50), "K": (80, 60),
    "CH": (120, 90), "JH": (100, 70), "DX": (24, 18),
    "F": (100, 80), "V": (60, 40), "TH": (90, 60), "DH": (50, 30), "S": (105, 60), "Z": (75, 40),
    "SH": (105, 80), "ZH": (70, 40), "HH": (80, 20),
    "L": (80, 40), "R": (80, 30), "W": (80, 60), "Y": (80, 40), "M": (70, 60), "N": (60, 30), "NG": (95, 60),
}

# Vowel targets (F1, F2, F3), General American. Blended from Peterson & Barney (1952)
# and Hillenbrand et al. (1995); /ae/ and /a/ kept distinct from /E/ and /O/.
VOWEL_M = {
    "IY": (300, 2300, 3000), "IH": (410, 2000, 2650), "EH": (560, 1800, 2550), "AE": (680, 1750, 2450),
    "AA": (750, 1220, 2500), "AO": (620, 950, 2480), "UH": (450, 1080, 2350), "UW": (340, 960, 2300),
    "AH": (630, 1200, 2500), "ER": (480, 1360, 1700),
    "AX": (500, 1450, 2450), "IX": (420, 1850, 2550), "AXR": (480, 1380, 1720), "UX": (380, 1200, 2300),
}
DIPH_M = {
    "AY": ((720, 1220, 2500), (430, 1880, 2550)), "AW": ((720, 1220, 2500), (460, 1000, 2400)),
    "EY": ((480, 2000, 2600), (350, 2200, 2750)), "OW": ((520, 950, 2450), (420, 870, 2350)),
    "OY": ((560, 900, 2450), (430, 1850, 2550)),
}
VOWEL_F = {
    "IY": (360, 2750, 3350), "IH": (460, 2400, 3050), "EH": (680, 2100, 2950), "AE": (820, 2050, 2900),
    "AA": (900, 1450, 2800), "AO": (740, 1100, 2750), "UH": (500, 1250, 2780), "UW": (400, 1100, 2700),
    "AH": (750, 1420, 2850), "ER": (510, 1600, 1930),
    "AX": (580, 1700, 2850), "IX": (470, 2150, 2950), "AXR": (520, 1620, 1950), "UX": (430, 1350, 2700),
}
DIPH_F = {
    "AY": ((880, 1450, 2800), (500, 2250, 2950)), "AW": ((880, 1450, 2800), (530, 1150, 2750)),
    "EY": ((560, 2400, 3000), (420, 2600, 3150)), "OW": ((580, 1080, 2780), (470, 1000, 2700)),
    "OY": ((640, 1050, 2750), (500, 2200, 2950)),
}
# Sonorant consonant targets, male (nasals: Klatt-style murmur values, F1 nearly
# cancelled by the nasal zero so the nasal pole dominates)
SON_M = {"W": (290, 610, 2150), "Y": (260, 2070, 3020), "L": (330, 1100, 2800), "Ldark": (430, 850, 2600),
         "R": (310, 1060, 1380), "Rpost": (450, 1250, 1650),
         "M": (480, 1270, 2130), "N": (480, 1400, 2500), "NG": (480, 1900, 2600)}
# Consonant loci (L, k): boundary value = L + k * (vowel - L), per formant. Male.
LOCUS_M = {"lab": ((220, .30), (700, .75), (2100, .60)), "labdent": ((250, .35), (1100, .60), (2300, .60)),
           "dent": ((250, .35), (1500, .50), (2600, .50)), "alv": ((250, .35), (1850, .45), (2700, .50)),
           "post": ((260, .35), (2100, .40), (2600, .40)), "pal": ((260, .35), (2200, .40), (2900, .50))}
FEMALE_CONS = (1.12, 1.17, 1.15)   # female / male ratios applied to consonant targets and loci

# Fricative spectra (male reference, frequencies scale with the voice):
# level re vowel RMS (dB), highpass (Hz), [(freq, bw, gain dB), ...]
FRIC = {
    "S":  (-11.0, 3000, [(4700, 900, -4), (6100, 1200, 0), (7800, 1800, -3)]),
    "Z":  (-18.0, 3000, [(4700, 900, -4), (6100, 1200, 0), (7800, 1800, -3)]),
    "SH": (-8.0, 1500, [(2750, 500, 0), (3500, 700, -1), (5000, 1500, -8), (6600, 2000, -14)]),
    "ZH": (-15.0, 1500, [(2750, 500, 0), (3500, 700, -1), (5000, 1500, -8), (6600, 2000, -14)]),
    "F":  (-25.0, 900, [(3000, 3000, -6), (7200, 4000, 0)]),
    "V":  (-30.0, 900, [(3000, 3000, -6), (7200, 4000, 0)]),
    "TH": (-26.0, 1100, [(4200, 3000, -4), (7600, 3500, 0)]),
    "DH": (-31.0, 1100, [(4200, 3000, -4), (7600, 3500, 0)]),
    "CH": (-8.0, 1500, [(2750, 500, 0), (3500, 700, -1), (5000, 1500, -8), (6600, 2000, -14)]),
    "JH": (-15.0, 1500, [(2750, 500, 0), (3500, 700, -1), (5000, 1500, -8), (6600, 2000, -14)]),
}
# Stop bursts: level re vowel RMS (dB, over the burst), decay time constant (s), spectrum
BURST = {
    "lab": (-20.0, 0.0030, 150, [(900, 1200, 0), (2500, 2500, -8)]),
    "alv": (-13.0, 0.0045, 1800, [(3800, 900, -3), (5200, 1400, 0), (7000, 2000, -4)]),
    "vel": (-12.0, 0.0080, 700, None),        # compact peak at the velar pinch, per token
}
VOT = {  # s: aspirated (stressed onset), unstressed, after /s/, voiced
    "P": (0.058, 0.030, 0.015), "T": (0.068, 0.035, 0.020), "K": (0.078, 0.040, 0.025),
    "B": 0.010, "D": 0.016, "G": 0.022,
}
ONSETS = {("S", "T"), ("S", "P"), ("S", "K"), ("S", "T", "R"), ("S", "P", "R"), ("S", "K", "R"),
          ("P", "R"), ("T", "R"), ("K", "R"), ("B", "R"), ("D", "R"), ("G", "R"), ("F", "R"),
          ("TH", "R"), ("SH", "R"), ("P", "L"), ("K", "L"), ("B", "L"), ("G", "L"), ("F", "L"),
          ("S", "L"), ("S", "M"), ("S", "N"), ("S", "W"), ("T", "W"), ("K", "W"), ("D", "W"),
          ("P", "Y"), ("K", "Y"), ("B", "Y"), ("F", "Y"), ("M", "Y"), ("S", "K", "W")}
WH_WORDS = {"who", "what", "where", "when", "why", "how", "which", "whose"}
PROCLITIC = {"a", "the", "to", "of", "with", "in", "at", "by", "do", "i"}      # lean on the next word
FUNCTION = PROCLITIC | {"is", "it", "are", "was", "were", "if", "you", "we", "did", "it's", "that's"}
PAUSE = {".": 0.30, "!": 0.26, "?": 0.34, ",": 0.17, "...": 0.30}


# ---------------------------------------------------------------------------
# Pronunciations and the script
# ---------------------------------------------------------------------------

LEXICON = {
    "a": "AH0", "answer": "AE1 N S ER0", "anyone": "EH1 N IY0 W AH2 N", "are": "AA1 R",
    "asked": "AE1 S K T", "at": "AE0 T", "back": "B AE1 K", "by": "B AY0", "did": "D IH1 D",
    "do": "D UW0", "fold": "F OW1 L D", "four": "F AO1 R", "heard": "HH ER1 D", "honest": "AA1 N AH0 S T",
    "i": "AY1", "if": "IH0 F", "in": "IH0 N", "is": "IH0 Z", "it": "IH0 T", "it's": "IH0 T S",
    "know": "N OW1", "listening": "L IH1 S AH0 N IH0 NG", "maya": "M AY1 AH0", "message": "M EH1 S IH0 JH",
    "morning": "M AO1 R N IH0 NG", "next": "N EH1 K S T", "nine": "N AY1 N", "nineteen": "N AY2 N T IY1 N",
    "noise": "N OY1 Z", "not": "N AA1 T", "nothing": "N AH1 TH IH0 NG", "of": "AH0 V", "off": "AO1 F",
    "on": "AA1 N", "ourselves": "AW2 ER0 S EH1 L V Z", "out": "AW1 T", "picture": "P IH1 K CH ER0",
    "pulses": "P AH1 L S IH0 Z", "right": "R AY1 T", "sam": "S AE1 M", "send": "S EH1 N D",
    "sent": "S EH1 N T", "seventy": "S EH1 V AH0 N DX IY0", "sixteen": "S IH2 K S T IY1 N",
    "something": "S AH1 M TH IH0 NG", "standing": "S T AE1 N D IH0 NG", "that": "DH AE1 T",
    "that's": "DH AE1 T S", "the": "DH AH0", "then": "DH EH1 N", "there": "DH EH1 R", "this": "DH IH1 S",
    "three": "TH R IY1", "to": "T UW0", "tones": "T OW1 N Z", "transmitting": "T R AE0 N Z M IH1 DX IH0 NG",
    "twenty": "T W EH1 N DX IY0", "two": "T UW1", "up": "AH1 P", "us": "AH1 S", "wake": "W EY1 K",
    "want": "W AA1 N T", "was": "W AH0 Z", "way": "W EY1", "we": "W IY1", "were": "W ER0",
    "what": "W AH1 T", "who": "HH UW1", "with": "W IH0 DH", "you": "Y UW1",
}

# Prosodic markup: *word = pitch accent on its stressed syllable, **word = emphatic
# accent; parts of hyphenated words take their own marks. Punctuation ends a
# phrase: . ! = L-L% fall, ? = fall for wh-questions / L* H-H% rise for yes/no,
# , = continuation. style: pitch (st), range (x accent size), loud (dB), rd (+Rd,
# laxer/breathier), breath (x), pause (x), final (st of the final fall), tremor,
# whisper, breathy, tones {phrase: tone}, creak.
SCRIPT = {
    "d01": dict(markup="*Maya. **Maya! *Wake **up.",
                style=dict(pitch=3.5, range=1.35, loud=3.0, rd=-0.15, pause=0.55)),
    "d02": dict(markup="It's *three in the *morning, Sam.",
                style=dict(pitch=-1.5, range=0.45, loud=-1.5, rd=0.3, breath=1.4, tones={0: "L"},
                           final=-1.5, creak=True)),
    "d03": dict(markup="*Something is *transmitting. *Right at **us.",
                pron={"right": "R AY1 DX", "at": "AE0 DX"},
                style=dict(pitch=2.0, range=1.15, loud=1.0, rd=0.25, breath=2.0, pause=1.7, gasp=True)),
    "d04": dict(markup="*Two *tones. *On. *Off.",
                style=dict(pitch=-0.5, range=0.75, loud=-3.0, pause=1.0)),
    "d05": dict(markup="That's **not *noise. That's a **message.",
                style=dict(range=1.0, pause=1.2)),
    "d06": dict(markup="*Sixteen *seventy-*nine *pulses. Then *nothing.",
                pron={"sixteen": "S IH1 K S T IY2 N"},
                style=dict(pitch=0.5, range=0.9, rd=0.1, trail=True)),
    "d07": dict(markup="*Twenty-*three by *seventy-**three. **Fold it.",
                style=dict(range=1.15, loud=1.0, rd=-0.1)),
    "d08": dict(markup="I *know this **picture.",
                style=dict(range=0.8, loud=-4.0, breathy=True, rd=0.5)),
    "d09": dict(markup="We *sent it. In *nineteen *seventy-**four.",
                pron={"sent": "S EH1 N DX", "we": "W IY0", "nineteen": "N AY1 N T IY2 N"},
                style=dict(range=1.0, rd=0.15, pause=1.3)),
    "d10": dict(markup="Then **who is *that? *Standing *next to **us?",
                pron={"next": "N EH1 K S"},
                style=dict(pitch=2.5, range=1.2, rd=0.3, breath=2.0, tremor=0.6, gasp=True)),
    "d11": dict(markup="We *heard you."),
    "d12": dict(markup="*Maya...",
                style=dict(whisper=True, loud=-5.0, trail=2.4, tempo_max=3.0)),
    "d13": dict(markup="*Who are you?",
                style=dict(range=0.9, loud=-1.5, rd=0.1, deliberate=0.5)),
    "d14": dict(markup="You *asked if *anyone was *out there."),
    "d15": dict(markup="We were *listening.", pron={"we": "W IY0"}),
    "d16": dict(markup="What do you *want?", pron={"you": "Y UW0"},
                style=dict(range=0.9, loud=-1.0)),
    "d17": dict(markup="To *answer. The *way *you did.", pron={"to": "T UW1"}),
    "d18": dict(markup="With a *picture of *ourselves."),
    "d19": dict(markup="What do we send *back?", pron={"we": "W IY0"},
                style=dict(pitch=1.0, range=0.8, loud=-3.0, rd=0.35, breath=2.2, tremor=1.0)),
    "d20": dict(markup="*Something *honest.",
                style=dict(range=0.8, loud=-2.5, rd=0.3, breath=1.3, deliberate=0.6)),
}

# ---------------------------------------------------------------------------
# Voices
# ---------------------------------------------------------------------------
# high_poles: the vocal tract keeps resonating about every 1 kHz above F5. A
# cascade of unity-gain resonators falls -12 dB/oct per pole above its last pole,
# which Klatt's 10 kHz synthesizer never saw; at 48 kHz the series continues up to
# 20 kHz (pole_spacing, bandwidths growing with frequency) so vowels keep their
# natural high-frequency level (higher-pole correction). The Visitor keeps the
# first cut's two poles exactly (its radio band stops at 3.5 kHz anyway).

VOICES = {
    "maya": dict(sex="F", fscale=0.95, f0=160.0, top=4.0, accent=3.8, rise=6.0,
                 rd=1.55, ra_scale=0.45, shelf_db=0.0, breath_db=-15.0, jitter=0.006, shimmer=0.045,
                 b_scale=1.25, open_b1=70.0, fnp=300.0, fnz=500.0, fric_scale=1.15,
                 f4=4250.0, f5=4950.0,
                 high_poles=((5700.0, 600.0), (6800.0, 800.0)), pole_spacing=1150.0, pole_loss=0.16,
                 vot_scale=1.1, drift_st=0.25),
    "sam": dict(sex="M", fscale=1.03, f0=104.0, top=4.5, accent=4.6, rise=7.5,
                rd=1.05, ra_scale=0.50, shelf_db=0.0, breath_db=-25.0, jitter=0.007, shimmer=0.05,
                b_scale=1.0, open_b1=50.0, fnp=270.0, fnz=450.0, fric_scale=1.03,
                f4=3450.0, f5=4250.0,
                high_poles=((4950.0, 450.0), (5900.0, 650.0)), pole_spacing=1000.0,
                vot_scale=1.0, drift_st=0.3),
    # the first cut's voice: tract 10 % longer, very low pitch, the same source settings
    "visitor": dict(sex="M", fscale=V1.FORMANT_SCALE, f0=78.0, top=2.8, accent=3.4, rise=5.0,
                    rd=0.95, ra_scale=V1.RA_SCALE, shelf_db=V1.SOURCE_SHELF_DB, breath_db=-27.0,
                    jitter=0.005, shimmer=0.05, b_scale=0.85, open_b1=V1.OPEN_PHASE_B1,
                    fnp=260.0, fnz=430.0, fric_scale=0.93,
                    f4=3400.0, f5=4150.0, high_poles=V1.HIGH_POLES,
                    vot_scale=1.1, drift_st=0.0, layers=True, deliberate=1.0, tempo_max=2.9),
}


class Voice:
    """A voice's scaled phonetic tables and calibration."""

    def __init__(self, name):
        self.name = name
        self.p = dict(VOICES[name])
        p = self.p
        s = p["fscale"]
        female = p["sex"] == "F"
        vt, dt = (VOWEL_F, DIPH_F) if female else (VOWEL_M, DIPH_M)
        cs = FEMALE_CONS if female else (1.0, 1.0, 1.0)
        self.vowel = {k: tuple(v * s for v in t) for k, t in vt.items()}
        self.diph = {k: (tuple(v * s for v in a), tuple(v * s for v in b)) for k, (a, b) in dt.items()}
        self.son = {k: tuple(v * s * c for v, c in zip(t, cs)) for k, t in SON_M.items()}
        self.locus = {pl: tuple((L * s * c, k) for (L, k), c in zip(t, cs)) for pl, t in LOCUS_M.items()}
        self.cscale = tuple(s * c for c in cs)
        self.f4 = p["f4"] * s
        self.f5 = p["f5"] * s
        poles = [(f * s, b) for f, b in p["high_poles"]]
        if p.get("pole_spacing"):                 # continue the series to 20 kHz, losses growing
            f = poles[-1][0]
            while f + p["pole_spacing"] * s < 20000.0:
                f += p["pole_spacing"] * s
                poles.append((f, 200.0 + p.get("pole_loss", 0.1) * f))
        self.high_poles = tuple(poles)
        self.pole_filters = []
        for f, b in self.high_poles:              # fixed poles: plain biquads (unity gain at DC)
            r = np.exp(-np.pi * b / FS)
            c1, c2 = 2 * r * np.cos(2 * np.pi * f / FS), -r * r
            self.pole_filters.append(([1.0 - c1 - c2], [1.0, -c1, -c2]))
        self.fnp = p["fnp"] * s
        self.fnz = p["fnz"] * s
        self.lf = lf_table(p["ra_scale"])
        self.fric_cache = {}
        self.calibrate()

    # -- targets ----------------------------------------------------------
    def vowel_targets(self, seg):
        if seg.kind == "D":
            return self.diph[seg.p]
        v = self.vowel[seg.fkey]
        return v, v

    def son_target(self, seg):
        if seg.p == "L":
            return self.son["Ldark" if seg.role == "C" else "L"]
        if seg.p == "R":
            return self.son["Rpost" if seg.role == "C" else "R"]
        return self.son[seg.p]

    def locus_value(self, place, vt):
        f1v, f2v, f3v = vt
        if place in ("glot", None):
            return tuple(vt)
        if place == "vel":
            c1, c2, c3 = self.cscale
            L1 = 260 * c1
            f1 = L1 + 0.35 * (f1v - L1)
            f2 = 0.7 * f2v + 650 * c2
            f3 = max(f2 + 250 * c3, min(f3v + 100 * c3, f2 + 550 * c3))
            return f1, f2, f3
        return tuple(L + k * (v - L) for (L, k), v in zip(self.locus[place], vt))

    # -- calibration ------------------------------------------------------
    def calibrate(self):
        """Output RMS of a steady schwa (voicing), of unit noise through the same
        tract, and of the voice bar: all levels below are relative to the vowel."""
        n = int(0.5 * FS)
        rng = np.random.default_rng(7)
        f0 = np.full(n, self.p["f0"] * 2 ** (2.0 / 12))
        ep = glottal_epochs(f0, rng, 0.0)
        src, _ = render_glottal(ep, np.full(n, self.p["rd"]), n, rng, self.lf, shimmer=0.0)
        src = shelf(src, 1000.0, self.p["shelf_db"])
        F = self.vowel["AX"]
        ft = {}
        for k in range(3):
            ft["F%d" % (k + 1)] = np.full(n, F[k])
        ft["F4"], ft["F5"] = np.full(n, self.f4), np.full(n, self.f5)
        bandwidths(ft, self.p["b_scale"])
        nas = (np.full(n, self.fnp), np.full(n, self.fnp))
        v = self.tract(src, ft, nas)
        noise = signal.lfilter(*signal.butter(2, 150.0, "highpass", fs=FS), rng.standard_normal(n))
        a = self.tract(noise, ft, nas)
        vb = resonate(src, np.full(n, 190.0 * self.p["fscale"]), np.full(n, 110.0))
        seg = slice(int(0.15 * FS), n)
        self.vowel_rms = rms(v[seg])
        self.asp_gain = self.vowel_rms / rms(a[seg])
        self.vbar_gain = self.vowel_rms / rms(vb[seg])

    def tract(self, x, ft, nasal, b1_add=0.0):
        """Cascade vocal tract: nasal pole, nasal zero, F1..F5, higher poles."""
        fnp, fnz = nasal
        bnp = np.full(len(x), 100.0)
        x = resonate(x, fnp, bnp)
        x = antiresonate(x, fnz, bnp)
        for k in range(1, 6):
            bw = ft["B%d" % k] + (b1_add if k == 1 else 0.0)
            x = resonate(x, ft["F%d" % k], bw)
        for b, a in self.pole_filters:
            x = signal.lfilter(b, a, x)
        return x

    def fric_filter(self, key, comps=None, hp=None, tag=None):
        """Fixed parallel resonator bank for a fricative / burst, normalized to
        unit RMS for unit white noise. Returns a function noise -> filtered."""
        tag = tag or key
        if tag in self.fric_cache:
            return self.fric_cache[tag]
        sc = self.p["fric_scale"]
        if comps is None:
            _, hp, comps = FRIC[key]
        filters = []
        for f, bw, g in comps:
            f = min(f * sc, 0.44 * FS)
            b, a = signal.iirpeak(f, f / (bw * sc), fs=FS)
            filters.append((10 ** (g / 20), b, a))
        hp_sos = signal.butter(4, hp * sc, "highpass", fs=FS, output="sos")

        def run(x):
            y = sum(g * signal.lfilter(b, a, x) for g, b, a in filters)
            return signal.sosfilt(hp_sos, y)

        probe = run(np.random.default_rng(3).standard_normal(FS // 2))
        norm = 1.0 / rms(probe[FS // 10:])
        fn = (lambda x: run(x) * norm)
        self.fric_cache[tag] = fn
        return fn


# ---------------------------------------------------------------------------
# DSP building blocks (glottal source, resonators)
# ---------------------------------------------------------------------------

def rms(x):
    return float(np.sqrt(np.mean(np.square(x)) + 1e-20))


def gsmooth(x, sigma):
    """Gaussian smoothing (sigma in samples), edges held."""
    if sigma <= 0:
        return x
    half = int(4 * sigma) + 1
    k = np.exp(-0.5 * (np.arange(-half, half + 1) / sigma) ** 2)
    xp = np.concatenate([np.full(half, x[0]), x, np.full(half, x[-1])])
    return signal.fftconvolve(xp, k / k.sum(), mode="same")[half:half + len(x)]


def shelf(x, f_zero, gain_db):
    """First-order high shelf: flat below f_zero, +gain_db well above it."""
    wz = 2 * np.pi * f_zero
    wp = wz * 10 ** (gain_db / 20)
    b, a = signal.bilinear([1 / wz, 1], [1 / wp, 1], FS)
    return signal.lfilter(b, a, x)


def one_pole_lp(x, fc):
    a = np.exp(-2.0 * np.pi * fc / FS)
    return signal.lfilter([1.0 - a], [1.0, -a], x)


def resonate(x, freq, bw):
    """Klatt resonator with per-sample coefficients (unity gain at DC)."""
    r = np.exp(-np.pi * bw / FS)
    c = -r * r
    b = 2.0 * r * np.cos(2.0 * np.pi * freq / FS)
    a = 1.0 - b - c
    out = []
    push = out.append
    y1 = y2 = 0.0
    for an, bn, cn, xn in zip(a.tolist(), b.tolist(), c.tolist(), x.tolist()):
        y = an * xn + bn * y1 + cn * y2
        y2 = y1
        y1 = y
        push(y)
    return np.asarray(out)


def antiresonate(x, freq, bw):
    """Klatt antiresonator (the exact inverse of `resonate` with the same tracks)."""
    r = np.exp(-np.pi * bw / FS)
    c = -r * r
    b = 2.0 * r * np.cos(2.0 * np.pi * freq / FS)
    a = 1.0 - b - c
    x1 = np.concatenate([[0.0], x[:-1]])
    x2 = np.concatenate([[0.0, 0.0], x[:-2]])
    return (x - b * x1 - c * x2) / a


def bandwidths(ft, b_scale, extra=None):
    """Formant bandwidths from frequency (roughly Hawks & Miller), plus extras."""
    ft["B1"] = b_scale * (45.0 + 0.045 * ft["F1"])
    ft["B2"] = b_scale * (50.0 + 0.025 * ft["F2"])
    ft["B3"] = b_scale * (80.0 + 0.030 * ft["F3"])
    ft["B4"] = np.full(len(ft["F1"]), 250.0 * b_scale)
    ft["B5"] = np.full(len(ft["F1"]), 320.0 * b_scale)
    if extra:
        for k, v in extra.items():
            ft[k] = ft[k] + v


def lf_params(rd, ra_scale):
    """Normalized (T0 = 1) Liljencrants-Fant timing from Rd (Fant 1995), with
    the return phase scaled by ra_scale, and the solved growth/return constants."""
    ra = (-1.0 + 4.8 * rd) / 100.0
    rk = (22.4 + 11.8 * rd) / 100.0
    rg = rk / (4.0 * (0.11 * rd / (0.5 + 1.2 * rk) - ra))
    tp = 1.0 / (2.0 * rg)
    te = tp * (1.0 + rk)
    ta = ra * ra_scale
    tr = 1.0 - te
    eps = 1.0 / ta
    for _ in range(60):
        f = eps * ta - 1.0 + np.exp(-eps * tr)
        fp = ta - tr * np.exp(-eps * tr)
        eps -= f / fp
    wg = np.pi / tp

    def area(alpha):
        ex = np.exp(alpha * te)
        a_open = (ex * (alpha * np.sin(wg * te) - wg * np.cos(wg * te)) + wg) / (alpha ** 2 + wg ** 2)
        ee = -ex * np.sin(wg * te)
        a_ret = -(ee / (eps * ta)) * ((1.0 - np.exp(-eps * tr)) / eps - tr * np.exp(-eps * tr))
        return a_open + a_ret

    alpha = brentq(area, -20.0, 60.0)
    return tp, te, ta, alpha, eps


RD_GRID = np.round(np.arange(0.5, 2.71, 0.01), 2)
_LF_CACHE = {}


def lf_table(ra_scale):
    if ra_scale not in _LF_CACHE:
        _LF_CACHE[ra_scale] = np.array([lf_params(r, ra_scale) for r in RD_GRID])
    return _LF_CACHE[ra_scale]


def lf_pulse(tau, rd, table):
    i = int(np.clip(np.round((rd - RD_GRID[0]) / 0.01), 0, len(RD_GRID) - 1))
    tp, te, ta, alpha, eps = table[i]
    wg = np.pi / tp
    ee = -np.exp(alpha * te) * np.sin(wg * te)
    open_ = tau <= te
    e = np.where(open_, np.exp(alpha * tau) * np.sin(wg * tau) / ee,
                 -(np.exp(-eps * (tau - te)) - np.exp(-eps * (1.0 - te))) / (eps * ta))
    flow = np.where(open_, np.sin(np.pi * np.clip(tau / te, 0, 1)), 0.0)
    return e, flow


def glottal_epochs(f0, rng, jitter):
    """Glottal cycle start times and periods following the per-sample f0 (jitter = std)."""
    n = len(f0)
    epochs, t = [], 0.0
    while True:
        i = int(t * FS)
        if i >= n:
            break
        jit = jitter[i] if np.ndim(jitter) else jitter
        period = (1.0 / f0[i]) * (1.0 + jit * rng.standard_normal())
        epochs.append((t, period))
        t += period
    return epochs


def render_glottal(epochs, rd, n, rng, table, shimmer=0.05, rd_offset=0.0):
    src = np.zeros(n)
    flow = np.zeros(n)
    for t0, period in epochs:
        n0 = int(np.ceil(t0 * FS))
        n1 = min(n, int(np.ceil((t0 + period) * FS)))
        if n1 <= n0:
            continue
        idx = np.arange(n0, n1)
        tau = (idx / FS - t0) / period
        amp = 1.0 + shimmer * rng.standard_normal()
        e, fl = lf_pulse(tau, rd[n0] + rd_offset, table)
        src[n0:n1] += amp * e
        flow[n0:n1] = fl
    return src, flow


def smooth_noise(n, rate_hz, rng):
    return V1.smooth_noise(n, rate_hz, rng)


def ramp_env(n, i0, i1, rise, fall):
    """Raised-cosine envelope over samples [i0, i1) with the given rise/fall (samples)."""
    env = np.zeros(n)
    i0, i1 = max(0, i0), min(n, i1)
    if i1 <= i0:
        return env
    env[i0:i1] = 1.0
    rise = max(1, min(rise, (i1 - i0) // 2))
    fall = max(1, min(fall, (i1 - i0) // 2))
    env[i0:i0 + rise] = 0.5 - 0.5 * np.cos(np.pi * np.arange(rise) / rise)
    env[i1 - fall:i1] = 0.5 + 0.5 * np.cos(np.pi * np.arange(fall) / fall)
    return env


# ---------------------------------------------------------------------------
# Script -> segments
# ---------------------------------------------------------------------------

class Seg:
    def __init__(self, p, stress=-1):
        self.p = p
        self.stress = stress
        self.kind = KIND.get(p, "P")
        self.voiced = p in VOICED
        self.place = PLACE.get(p)
        self.fkey = REDUCED.get(p, p) if (stress == 0 and self.kind == "V") else p
        self.dkey = self.fkey if self.kind in "VD" else p
        self.word = self.part = self.syl = -1
        self.role = ""
        self.word_initial = False
        self.pause = 0.0
        self.gap = False
        self.release = None
        self.rel_type = None
        self.vot = 0.0
        self.aspirated = False

    def label(self):
        return self.p + (str(self.stress) if self.stress >= 0 else "")


class Syl:
    def __init__(self, **kw):
        self.__dict__.update(kw)


def syllabify(phones):
    """Syllable index and role (O onset, N nucleus, C coda) per phone, by the
    maximal-onset principle."""
    n = len(phones)
    vidx = [i for i, (p, _) in enumerate(phones) if KIND[p] in "VD"]
    syl, role = [0] * n, ["C"] * n
    for k, vi in enumerate(vidx):
        syl[vi], role[vi] = k, "N"
    for i in range(vidx[0]):
        syl[i], role[i] = 0, "O"
    for i in range(vidx[-1] + 1, n):
        syl[i], role[i] = len(vidx) - 1, "C"
    for k in range(len(vidx) - 1):
        cl = list(range(vidx[k] + 1, vidx[k + 1]))
        split = len(cl)
        for j in range(len(cl) + 1):
            onset = tuple(phones[c][0] for c in cl[j:])
            if len(onset) <= 1 and (not onset or onset[0] != "NG") or onset in ONSETS:
                split = j
                break
        for c in cl[:split]:
            syl[c], role[c] = k, "C"
        for c in cl[split:]:
            syl[c], role[c] = k + 1, "O"
    return syl, role, len(vidx)


class Line:
    """One line of dialogue: words, phrases, syllables and timed segments."""

    def __init__(self, d):
        self.id = d["id"]
        self.speaker = d["speaker"]
        self.text = d["text"]
        self.target = d["target"]
        spec = SCRIPT[self.id]
        self.style = dict(spec.get("style", {}))
        self.deliberate = self.style.get("deliberate", VOICES[self.speaker].get("deliberate", 0.0))
        pron = spec.get("pron", {})
        self.words, self.phrases = [], []
        cur = []
        for tok in spec["markup"].split():
            punct = None
            for p in ("...", "?", "!", ".", ","):
                if tok.endswith(p):
                    punct, tok = p, tok[:-len(p)]
                    break
            parts = []
            for part in tok.split("-"):
                acc = 2 if part.startswith("**") else 1 if part.startswith("*") else 0
                w = part.lstrip("*")
                ph = []
                for x in pron.get(w.lower(), LEXICON[w.lower()]).split():
                    ph.append((x[:-1], int(x[-1])) if x[-1].isdigit() else (x, -1))
                parts.append(dict(text=w, accent=acc, phones=ph))
            self.words.append(dict(text=tok.replace("*", ""), parts=parts, phrase=len(self.phrases)))
            cur.append(len(self.words) - 1)
            if punct:
                self.phrases.append(dict(words=cur, punct=punct))
                cur = []
        if cur:
            self.phrases.append(dict(words=cur, punct="."))
        said = [w["text"].lower() for w in self.words]
        want = [w.strip(".,!?").lower() for w in self.text.replace("...", "").split()]
        assert said == want, (self.id, said, want)
        for k, ph in enumerate(self.phrases):
            if ph["punct"] == "?":
                first = [self.words[i]["parts"][0]["text"].lower() for i in ph["words"][:2]]
                ph["tone"] = "L" if any(w in WH_WORDS for w in first) else "H"
            elif ph["punct"] == ",":
                ph["tone"] = "LH"
            else:
                ph["tone"] = "L"
            ph["tone"] = self.style.get("tones", {}).get(k, ph["tone"])
        self.build_segments()

    def build_segments(self):
        segs, syls = [], []
        for k, ph in enumerate(self.phrases):
            if k > 0:
                s = Seg("_")
                s.pause = PAUSE[self.phrases[k - 1]["punct"]] * self.style.get("pause", 1.0)
                s.phrase = k
                segs.append(s)
            for n_in, wi in enumerate(ph["words"]):
                if n_in > 0 and self.deliberate > 0:
                    prev_w = self.words[ph["words"][n_in - 1]]["text"].lower()
                    w = self.words[wi]
                    first_stress = next(st for p, st in w["parts"][0]["phones"] if KIND[p] in "VD")
                    if first_stress == 1 and w["text"].lower() not in FUNCTION and prev_w not in PROCLITIC:
                        g = Seg("_")
                        g.pause, g.phrase, g.gap = 0.075 * self.deliberate, k, True
                        segs.append(g)
                for pi, part in enumerate(self.words[wi]["parts"]):
                    sy_idx, roles, nsyl = syllabify(part["phones"])
                    base = len(syls)
                    stresses = [s for p, s in part["phones"] if KIND[p] in "VD"]
                    acc_syl = -1
                    if part["accent"]:
                        for want in (1, 2, 0):
                            if want in stresses:
                                acc_syl = stresses.index(want)
                                break
                    for j in range(nsyl):
                        syls.append(Syl(stress=stresses[j], accent=part["accent"] if j == acc_syl else 0,
                                        word=wi, part=(wi, pi), phrase=k, word_final=(j == nsyl - 1),
                                        nsyl=nsyl, nucleus=None, phrase_final=False))
                    for i, (p, st) in enumerate(part["phones"]):
                        s = Seg(p, st)
                        s.word, s.part, s.phrase = wi, (wi, pi), k
                        s.syl, s.role = base + sy_idx[i], roles[i]
                        s.word_initial = (i == 0 and pi == 0)
                        if s.kind in "VD":
                            syls[s.syl].nucleus = len(segs)
                        segs.append(s)
            last = [i for i, sy in enumerate(syls) if sy.phrase == k]
            syls[last[-1]].phrase_final = True
        self.segs, self.syls = segs, syls
        for s in segs:
            if s.kind != "P":
                s.accent = syls[s.syl].accent if s.kind in "VD" else 0


# ---------------------------------------------------------------------------
# Durations (Klatt 1979) and timing
# ---------------------------------------------------------------------------

def duration_rules(line):
    segs, syls = line.segs, line.syls
    n = len(segs)
    for i, s in enumerate(segs):
        if s.kind == "P":
            continue
        ih, mn = DUR[s.dkey]
        pr = 1.0
        sy = syls[s.syl]
        vowel = s.kind in "VD"
        if sy.phrase_final and (vowel or s.role == "C"):
            pr *= 1.4                                   # phrase-final lengthening
        if vowel and not sy.phrase_final:
            pr *= 0.6 + 0.25 * line.deliberate          # non-phrase-final shortening
        if line.style.get("trail") and sy.phrase_final and sy.phrase == len(line.phrases) - 1 \
                and (vowel or s.role == "C"):
            pr *= 1.5 if line.style["trail"] is True else line.style["trail"]   # trailing off
        if vowel and not sy.word_final:
            pr *= 0.85                                  # non-word-final shortening
        if vowel and sy.nsyl > 1:
            pr *= 0.8                                   # polysyllabic shortening
        if not vowel and not s.word_initial:
            pr *= 0.85                                  # non-initial consonant shortening
        if sy.stress == 0:                              # unstressed shortening
            mn *= 0.5
            pr *= 0.5 if (vowel and not sy.word_final) else 0.7
        elif sy.stress == 2:
            pr *= 0.85
        if vowel:
            pr *= (1.0, 1.1, 1.35)[sy.accent]           # accent / emphasis lengthening
            nxt = segs[i + 1] if i + 1 < n and segs[i + 1].part == s.part else None
            if nxt is None:
                f = 1.2 if sy.word_final else 1.0
            elif nxt.kind == "F" and nxt.voiced:
                f = 1.6
            elif nxt.kind in "SA" and nxt.voiced:
                f = 1.2
            elif nxt.kind == "N":
                f = 0.85
            elif nxt.kind in "SA":
                f = 0.7
            else:
                f = 1.0
            pr *= 1 + (f - 1) * (1.0 if sy.phrase_final else 0.5)   # postvocalic context
        prv = segs[i - 1] if i > 0 and segs[i - 1].kind != "P" else None
        nxt = segs[i + 1] if i + 1 < n and segs[i + 1].kind != "P" else None
        cons = lambda x: x is not None and x.kind not in "VD"
        if vowel:
            if nxt is not None and nxt.kind in "VD":
                pr *= 1.2
            if prv is not None and prv.kind in "VD":
                pr *= 0.7
        else:
            if cons(prv) and cons(nxt):
                pr *= 0.5
            elif cons(nxt) or cons(prv):
                pr *= 0.7
        s.ih, s.mn, s.pr = ih / 1000.0, mn / 1000.0, pr
    # stop releases and VOT
    for i, s in enumerate(segs):
        if s.kind not in "SA":
            continue
        nxt = segs[i + 1] if i + 1 < n else None
        if nxt is None or nxt.kind == "P":
            s.rel_type = "final"
        elif nxt.kind in "VDGLH":
            s.rel_type = "open"
        elif s.kind == "S" and s.p in "TD" and nxt.p in ("S", "Z", "SH", "ZH"):
            s.rel_type = "fric"
        else:
            s.rel_type = "unreleased"
        if s.kind == "A":
            s.rel_type = "affricate"
            continue
        if s.rel_type == "open":
            if s.voiced:
                s.vot = VOT[s.p]
            else:
                j = i + 1
                while j < n and segs[j].kind not in "VD":
                    j += 1
                stressed = j < n and line.syls[segs[j].syl].stress in (1, 2) and s.role == "O"
                after_s = i > 0 and segs[i - 1].p == "S" and segs[i - 1].syl == s.syl
                asp, unstr, aft = VOT[s.p]
                s.vot = aft if after_s else (asp if stressed else unstr)
                s.aspirated = stressed and not after_s
        elif s.rel_type == "final":
            s.vot = 0.012 if s.voiced else 0.035


def layout(line, f):
    """Assign times with tempo factor f (compressible part and pauses scale)."""
    voice = VOICES[line.speaker]
    t = PRE_ROLL
    for s in line.segs:
        s.start = t
        if s.kind == "P":
            d = s.pause * f
        elif s.kind in "VD":
            d = s.mn + (s.ih - s.mn) * s.pr * f
        else:                                   # consonants take a smaller share of tempo changes
            d = s.mn + (s.ih - s.mn) * s.pr * (1 + 0.6 * (f - 1))
        if s.kind == "S":
            if s.rel_type in ("open", "final"):
                s.release = t + d
                vot = s.vot * voice["vot_scale"] * f ** 0.35
                s.end = s.release + max(vot, 0.006)
            else:
                s.release = None
                s.end = t + d
        elif s.kind == "A":
            s.release = t + 0.45 * d
            s.end = t + d
        else:
            s.end = t + d
        t = s.end
    return line.segs[-1].end - PRE_ROLL


def fit_timing(line):
    duration_rules(line)
    lo, hi = 0.55, 3.0
    for _ in range(50):
        mid = 0.5 * (lo + hi)
        if layout(line, mid) > line.target:
            hi = mid
        else:
            lo = mid
    f = 0.5 * (lo + hi)
    f = float(np.clip(f, 0.70, line.style.get("tempo_max", VOICES[line.speaker].get("tempo_max", 2.4))))
    line.tempo = f
    line.spoken = layout(line, f)
    segs = line.segs
    for k, ph in enumerate(line.phrases):
        ss = [s for s in segs if s.kind != "P" and s.phrase == k]
        ph["t0"], ph["t1"] = ss[0].start, ss[-1].end
    for sy in line.syls:
        v = segs[sy.nucleus]
        sy.t0, sy.t1 = v.start, v.end
    line.end = segs[-1].end


# ---------------------------------------------------------------------------
# Prosody: F0, amplitude, voice quality
# ---------------------------------------------------------------------------

def bump(t, tp, h, rise, fall):
    y = np.zeros_like(t)
    a = (t >= tp - rise) & (t < tp)
    y[a] = h * 0.5 * (1 - np.cos(np.pi * (t[a] - tp + rise) / rise))
    b = (t >= tp) & (t <= tp + fall)
    y[b] = h * 0.5 * (1 + np.cos(np.pi * (t[b] - tp) / fall))
    return y


def smoothstep(u):
    u = np.clip(u, 0, 1)
    return u * u * (3 - 2 * u)


def f0_contour(line, voice, tc, rng):
    """F0 (Hz) on the control grid."""
    st = np.full(len(tc), np.nan)
    sty = line.style
    rng_acc = voice.p["accent"] * sty.get("range", 1.0)
    segs, syls = line.segs, line.syls
    for k, ph in enumerate(line.phrases):
        t0, t1 = ph["t0"], ph["t1"]
        m = (tc >= t0 - 0.04) & (tc <= t1 + 0.06)
        tt = tc[m]
        top = voice.p["top"] * sty.get("range", 1.0) ** 0.5 - 0.8 * k
        if ph["punct"] == "!":
            top += 1.5
        u = np.clip((tt - t0) / max(t1 - t0, 1e-3), 0, 1)
        comp = top * (1 - u)                                   # declination to the floor
        accents = [sy for sy in syls if sy.phrase == k and sy.accent > 0]
        tone = ph["tone"]
        t_nuc = t0
        # boundary tones complete by the end of the phrase's last voiced sound
        voiced = [s for s in segs if s.kind != "P" and s.phrase == k and (s.voiced or s.kind == "H")]
        t1 = voiced[-1].end if voiced else t1
        for j, sy in enumerate(accents):
            vd = sy.t1 - sy.t0
            h = rng_acc * (1.4 * 0.93 ** j if sy.accent == 2 else 0.82 ** j)
            nuclear = j == len(accents) - 1
            if nuclear and tone == "H":                        # L* H-H%
                tp = sy.t0 + 0.3 * vd
                comp += bump(tt, tp, -0.3 * h, 0.12, 0.08)
                r = np.clip((tt - tp) / max(t1 - tp, 0.06), 0, 1)
                comp += voice.p["rise"] * sty.get("range", 1.0) * r ** 1.5
                t_nuc = t1
            else:
                tp = sy.t0 + (0.45 if nuclear else 0.6) * vd
                comp += bump(tt, tp, h, 0.16, 0.16 if nuclear else 0.22)
                t_nuc = tp
        final = sty.get("final", -2.5)
        if tone == "L":
            r = (tt - t_nuc) / max(t1 - t_nuc, 0.06)
            comp += final * smoothstep(r)
        elif tone == "LH":
            comp += final * 0.5 * smoothstep((tt - t_nuc) / max(t1 - t_nuc, 0.06))
            comp += 2.5 * smoothstep((tt - (t1 - 0.14)) / 0.14)
        st[m] = np.where(np.isnan(st[m]), comp, np.maximum(st[m], comp))
    good = ~np.isnan(st)
    st = np.interp(tc, tc[good], st[good])
    # microprosody: onset perturbation after obstruents, intrinsic vowel F0
    for i, s in enumerate(segs):
        if s.kind not in "VD" or i == 0:
            continue
        prv = segs[i - 1]
        if prv.kind in "SFAH":
            amp = 0.9 if not prv.voiced else -0.5
            m = tc >= s.start
            st[m] += amp * np.exp(-(tc[m] - s.start) / 0.035)
        intr = 0.35 if s.fkey in ("IY", "UW", "IH", "UH", "IX", "UX") else -0.2 if s.fkey in ("AA", "AE", "AO") else 0
        st[(tc >= s.start) & (tc < s.end)] += intr
    st = gsmooth(st, 0.018 * CR)
    if voice.p["drift_st"]:
        st += voice.p["drift_st"] * smooth_noise(len(tc), 1.5 * FS / CR, rng)
    if sty.get("creak"):                                       # groggy phrase-final creak
        m = tc > line.end - 0.16
        st[m] -= 6.0 * smoothstep((tc[m] - (line.end - 0.16)) / 0.12)
    f0 = voice.p["f0"] * 2 ** ((st + sty.get("pitch", 0.0)) / 12)
    if sty.get("tremor"):                                      # fear: an irregular 5-7 Hz shake
        shake = 0.6 * np.sin(2 * np.pi * 5.6 * tc + 0.4) + 0.8 * smooth_noise(len(tc), 6.5 * FS / CR, rng)
        f0 *= 1 + 0.018 * sty["tremor"] * shake
    return f0


AV_CONS_DB = {"W": -5, "Y": -4, "L": -4, "R": -4, "M": -5, "N": -5, "NG": -6,
              "V": -9, "DH": -7, "Z": -10, "ZH": -10, "DX": -9}


def av_db(seg, sy):
    if seg.kind in "VD":
        db = {0: -4.0, 1: 0.0, 2: -1.5}[max(sy.stress, 0)]
        db += (0.0, 1.5, 3.5)[sy.accent]
        if seg.fkey in ("AA", "AE", "AO", "AW", "AY", "AH"):
            db += 0.8
        if seg.fkey in ("IY", "UW", "IH", "UH", "IX", "UX"):
            db -= 0.8
        return db
    return AV_CONS_DB.get(seg.p)


def step_track(n, spans, sigma_ms):
    """Piecewise-constant spans [(t0, t1, value)] on the control grid, smoothed."""
    x = np.zeros(n)
    for t0, t1, v in spans:
        i0, i1 = int(round(t0 * CR)), int(round(t1 * CR))
        x[max(i0, 0):max(i1, 0)] = v
    return gsmooth(x, sigma_ms * CR / 1000.0)


def source_tracks(line, voice, tc):
    """AV (voicing), AH (aspiration, re vowel), AVB (voice bar), Rd, extra bandwidths."""
    n = len(tc)
    segs, syls, sty = line.segs, line.syls, line.style
    av_spans, ah_spans, vb_spans, rd_spans = [], [], [], []
    b1x, b2x, b3x = [], [], []
    for i, s in enumerate(segs):
        if s.kind == "P":
            continue
        sy = syls[s.syl]
        prv = segs[i - 1] if i > 0 else None
        nxt = segs[i + 1] if i + 1 < len(segs) else None
        db = av_db(s, sy)
        if s.kind == "H":
            voiced_ctx = prv is not None and prv.voiced and nxt is not None and nxt.voiced
            if voiced_ctx:
                av_spans.append((s.start, s.end, 10 ** (-17 / 20)))
            ah_spans.append((s.start, s.end, 10 ** (-12 / 20)))
            b1x.append((s.start, s.end, 250.0))
            b2x.append((s.start, s.end, 60.0))
        elif s.kind == "S":
            if s.voiced and prv is not None and prv.voiced and prv.kind != "P":
                cl_end = s.release if s.release else s.end
                vb_spans.append((s.start, cl_end, 1.0))
            if s.release is not None and not s.voiced:
                lvl = -13.0 if s.aspirated else -18.0
                if s.rel_type == "final":
                    lvl = -21.0
                ah_spans.append((s.release + 0.004, s.end, 10 ** (lvl / 20)))
                b1x.append((s.release, s.end + 0.01, 280.0))
        elif s.kind == "A":
            if s.voiced and prv is not None and prv.voiced:
                vb_spans.append((s.start, s.release, 1.0))
                av_spans.append((s.release, s.end, 10 ** (-12 / 20)))
        elif s.kind == "X":
            av_spans.append((s.start, s.end, 10 ** (db / 20)))
        elif db is not None:
            av_spans.append((s.start, s.end, 10 ** (db / 20)))
        if s.kind == "N":
            b2x.append((s.start, s.end, 150.0))
            b3x.append((s.start, s.end, 150.0))
        if s.kind == "F" and s.voiced:
            b1x.append((s.start, s.end, 60.0))
        rd = 0.0
        if s.kind in "VD":
            rd = -0.12 if sy.accent else (0.12 if sy.stress == 0 else 0.0)
        rd_spans.append((s.start, s.end, rd))
    av = step_track(n, av_spans, 3.5)
    ah = step_track(n, ah_spans, 4.0)
    avb = step_track(n, vb_spans, 5.0)
    rd = step_track(n, rd_spans, 15.0) + voice.p["rd"] + sty.get("rd", 0.0)
    # phrase edges: soft onsets, declining breathy offsets
    for ph in line.phrases:
        t0, t1 = ph["t0"], ph["t1"]
        first = next(s for s in segs if s.kind != "P" and s.phrase == line.phrases.index(ph))
        attack = 0.012 if first.kind in "VD" else 0.025
        m = (tc >= t0) & (tc < t0 + attack)
        av[m] *= smoothstep((tc[m] - t0) / attack)
        rd += 0.35 * np.exp(-np.clip(tc - t0, 0, None) / 0.05) * (tc >= t0)
        last_v = [sy for sy in syls if sy.phrase == line.phrases.index(ph)][-1]
        tv = 0.5 * (last_v.t0 + last_v.t1)
        m = (tc >= tv) & (tc <= t1 + 0.05)
        decl = smoothstep((tc[m] - tv) / max(t1 - tv, 0.03))
        av[m] *= 1 - 0.55 * decl
        rd[m] += 0.5 * decl
        mm = (tc >= t1 - 0.08) & (tc < t1 + 0.06)
        ah[mm] = np.maximum(ah[mm], 10 ** (-26 / 20) * np.exp(-np.abs(tc[mm] - t1) / 0.05))
    first = segs[0].start
    for arr in (av, ah, avb):
        arr[tc < first] = 0.0
    # deliberate word gaps: the word before relaxes and fades, the next one starts softly
    for i, s in enumerate(segs):
        if not s.gap:
            continue
        pv, nx = segs[i - 1], segs[i + 1]
        m = (tc >= pv.end - 0.06) & (tc < pv.end + 0.02)
        u = smoothstep((tc[m] - (pv.end - 0.06)) / 0.06)
        av[m] *= 1 - 0.45 * u
        rd[m] += 0.3 * u
        m = (tc >= nx.start) & (tc < nx.start + 0.02)
        av[m] *= smoothstep((tc[m] - nx.start) / 0.02)
    extra = {"B1": step_track(n, b1x, 4.0), "B2": step_track(n, b2x, 4.0), "B3": step_track(n, b3x, 4.0)}
    if sty.get("creak"):
        m = tc > line.end - 0.16
        rd[m] -= 0.5 * smoothstep((tc[m] - (line.end - 0.16)) / 0.1)
    return av, ah, avb, np.clip(rd, 0.5, 2.7), extra


# ---------------------------------------------------------------------------
# Articulation: formant tracks with coarticulation
# ---------------------------------------------------------------------------

def formant_times(segs):
    """Times at which each boundary's formant values apply: a released stop's
    right boundary is its release (CV transitions run through the aspiration)."""
    for i, s in enumerate(segs):
        s.fstart = s.start
        s.fend = s.end
    for i in range(len(segs) - 1):
        a, b = segs[i], segs[i + 1]
        if a.kind == "S" and a.release is not None:
            a.fend = b.fstart = a.release
        elif a.kind == "A":
            a.fend = b.fstart = max(a.release, a.end - 0.012)


def seg_target(voice, s, segs, i):
    """(onset, offset) target triples, or None for transparent segments."""
    if s.kind in "VD":
        return voice.vowel_targets(s)
    if s.kind in "GLN":
        t = voice.son_target(s)
        return t, t
    if s.kind == "H":
        for j in list(range(i + 1, len(segs))) + list(range(i - 1, -1, -1)):
            o = segs[j]
            if o.kind == "P":
                continue
            if o.kind in "VD":
                on, off = voice.vowel_targets(o)
                return (on, on) if j > i else (off, off)
            if o.kind in "GLN":
                t = voice.son_target(o)
                return t, t
        return voice.vowel["AX"], voice.vowel["AX"]
    return None


def boundary_values(voice, segs, targets):
    """Per boundary: (value at end of left seg, value at start of right seg, jump F1?)."""
    n = len(segs)
    B = [None] * (n - 1)
    for i in range(n - 1):
        a, b = segs[i], segs[i + 1]
        if a.kind == "P" or b.kind == "P":
            continue
        ta, tb = targets[i], targets[i + 1]
        ka, kb = a.kind, b.kind
        jump = False
        if ka in TRANSPARENT and kb in TRANSPARENT:
            B[i] = "OO"
            continue
        if ka in TRANSPARENT or kb in TRANSPARENT:
            o, son, t = (a, b, tb[0]) if ka in TRANSPARENT else (b, a, ta[1])
            if son.kind in "VD":
                v = voice.locus_value(o.place, t)
            else:
                v = t
            B[i] = (v, v, False)
            continue
        if ka == "N" and kb in "VDH" or kb == "N" and ka in "VDH":
            nas, vow, vt = (a, b, tb[0]) if ka == "N" else (b, a, ta[1])
            lv = voice.locus_value(nas.place, vt)
            nt = targets[segs.index(nas)][0]
            c1 = voice.cscale[0]
            f1v = 300 * c1 + 0.5 * (vt[0] - 300 * c1)
            vn = (nt[0], lv[1], lv[2])
            vv = (f1v, lv[1], lv[2])
            B[i] = (vn, vv, True) if ka == "N" else (vv, vn, True)
            continue
        if ka == "H":
            B[i] = (tb[0], tb[0], False)
            continue
        if kb == "H":
            B[i] = (ta[1], ta[1], False)
            continue
        if ka in "GL" and kb in "VD":
            v = tuple(g + 0.3 * (w - g) for g, w in zip(ta[1], tb[0]))
        elif kb in "GL" and ka in "VD":
            v = tuple(g + 0.3 * (w - g) for g, w in zip(tb[0], ta[1]))
        else:
            v = tuple(0.5 * (x + y) for x, y in zip(ta[1], tb[0]))
        B[i] = (v, v, False)
    # obstruent clusters take the value of a neighbouring resolved boundary
    for _ in range(3):
        for i in range(n - 2, -1, -1):
            if B[i] == "OO" and i + 1 < n - 1 and isinstance(B[i + 1], tuple):
                B[i] = (B[i + 1][0], B[i + 1][0], False)
        for i in range(n - 1):
            if B[i] == "OO" and i > 0 and isinstance(B[i - 1], tuple):
                B[i] = (B[i - 1][1], B[i - 1][1], False)
    for i in range(n - 1):
        if B[i] == "OO":
            B[i] = None
    return B


def trans_time(s, nb, k):
    if nb is None or nb.kind == "P":
        return 0.0
    nk = nb.kind
    if s.kind in "VD":
        if nk in "SAX":
            return (0.028, 0.050, 0.050)[k]
        if nk == "F":
            return (0.030, 0.050, 0.050)[k]
        if nk == "N":
            return (0.010, 0.045, 0.045)[k]
        if nk == "G":
            return 0.085
        if nk == "L":
            return 0.065
        if nk in "VD":
            return 0.055
        return 0.0
    if s.kind == "G":
        return 0.035 if nk in "VD" else 0.02
    if s.kind == "L":
        return 0.028
    if s.kind == "N":
        return (0.006, 0.02, 0.02)[k]
    return 0.0


def formant_tracks(line, voice, tc):
    segs = line.segs
    formant_times(segs)
    targets = [seg_target(voice, s, segs, i) for i, s in enumerate(segs)]
    B = boundary_values(voice, segs, targets)
    n = len(segs)
    out = {}
    for k in range(3):
        pts = []
        for i, s in enumerate(segs):
            if s.kind == "P":
                continue
            left = B[i - 1] if i > 0 else None
            right = B[i] if i < n - 1 else None
            vl = left[1][k] if isinstance(left, tuple) else None
            vr = right[0][k] if isinstance(right, tuple) else None
            jl = isinstance(left, tuple) and left[2] and k == 0
            jr = isinstance(right, tuple) and right[2] and k == 0
            tl, tr = s.fstart + (0.002 if jl else 0.0), s.fend - (0.002 if jr else 0.0)
            tg = targets[i]
            if tg is None:
                if vl is None:
                    vl = vr
                if vr is None:
                    vr = vl
                if vl is None:
                    continue
                pts += [(tl, vl), (tr, vr)]
                continue
            on, off = tg[0][k], tg[1][k]
            vl = on if vl is None else vl
            vr = off if vr is None else vr
            prv = segs[i - 1] if i > 0 else None
            nxt = segs[i + 1] if i + 1 < n else None
            tin, tout = trans_time(s, prv, k), trans_time(s, nxt, k)
            d = tr - tl
            if tin + tout > 0.85 * d:
                sc = 0.85 * d / (tin + tout)
                tin, tout = tin * sc, tout * sc
            pts.append((tl, vl))
            if s.kind == "D":
                h0 = tl + max(tin, 0.28 * d)
                h1 = tr - max(tout, 0.18 * d)
                pts += [(tl + tin, on), (h0, on), (h1, off), (tr - tout, off)]
            else:
                pts += [(tl + tin, on), (tr - tout, off)]
            pts.append((tr, vr))
        out["F%d" % (k + 1)] = gsmooth(pchip(pts, tc), 0.003 * CR)
    # F4/F5: steady, nudged down with /r/ (F3 lowering drags F4)
    out["F4"] = np.full(len(tc), voice.f4)
    out["F5"] = np.full(len(tc), voice.f5)
    rpts = [(s.start, s.end, -0.06 * voice.f4) for s in segs if s.p in ("R", "ER")]
    out["F4"] = out["F4"] + step_track(len(tc), rpts, 20.0)
    # keep the formants ordered
    out["F3"] = np.minimum(out["F3"], out["F4"] - 300)
    out["F2"] = np.minimum(out["F2"], out["F3"] - 180)
    out["F1"] = np.clip(np.minimum(out["F1"], out["F2"] - 150), 150, None)
    # nasal pole/zero: the zero leaves the pole during nasal murmur and nasalized vowels
    fnz_pts = []
    base, nz = voice.fnp, voice.fnz
    mid = base + 0.45 * (nz - base)
    for i, s in enumerate(segs):
        if s.kind == "N":
            fnz_pts += [(s.start - 0.002, mid), (s.start + 0.003, nz), (s.end - 0.003, nz), (s.end + 0.002, mid)]
            if i > 0 and segs[i - 1].kind in "VDGL":
                pv = segs[i - 1]
                fnz_pts.append((max(pv.start, s.start - 0.09), base))
            if i + 1 < n and segs[i + 1].kind in "VDGL":
                nv = segs[i + 1]
                fnz_pts.append((min(nv.end, s.end + 0.04), base))
    if fnz_pts:
        fnz_pts.append((tc[0], base))
        fnz_pts.append((tc[-1], base))
    out["FNZ"] = gsmooth(pchip(fnz_pts, tc, base), 0.002 * CR)
    out["FNP"] = np.full(len(tc), base)
    return out


def pchip(points, tc, default=500.0):
    if not points:
        return np.full(len(tc), default)
    points = sorted(points, key=lambda p: p[0])
    xs, ys = [], []
    for x, y in points:
        if xs and x <= xs[-1] + 1e-6:
            if abs(y - ys[-1]) < 1e-3:
                continue
            x = xs[-1] + 0.001
        xs.append(x)
        ys.append(y)
    if len(xs) == 1:
        return np.full(len(tc), ys[0])
    return PchipInterpolator(xs, ys, extrapolate=False)(np.clip(tc, xs[0], xs[-1]))


# ---------------------------------------------------------------------------
# Synthesis
# ---------------------------------------------------------------------------

def up(track, tc, t):
    return np.interp(t, tc, track)


def frication_events(line, voice, n, rng, flow):
    """Fricatives, affricate releases and stop bursts, through fixed banks."""
    out = np.zeros(n)
    segs = line.segs
    ref = voice.vowel_rms
    for i, s in enumerate(segs):
        if s.kind not in "FSA":
            continue
        nxt = segs[i + 1] if i + 1 < len(segs) else None
        prv = segs[i - 1] if i > 0 else None
        if s.kind in "FA":
            key = s.p
            lvl = FRIC[key][0]
            if s.kind == "A":
                t0, t1, rise, fall = s.release, s.end, 0.008, 0.015
            else:
                t0, t1 = s.start, s.end
                rise = 0.020 if s.p in ("S", "SH", "Z", "ZH") else 0.012
                fall = 0.018
                if nxt is None or nxt.kind == "P":
                    fall = 0.045
            sy = line.syls[s.syl]
            if sy.stress == 0:
                lvl -= 2.0
            i0, i1 = int(t0 * FS), int(t1 * FS)
            env = ramp_env(n, i0, i1, int(rise * FS), int(fall * FS))
            if s.voiced:
                env *= 0.45 + 0.55 * flow
            pad = int(0.02 * FS)
            a, b = max(0, i0 - pad), min(n, i1 + pad)
            noise = rng.standard_normal(b - a)
            out[a:b] += voice.fric_filter(key)(noise) * env[a:b] * ref * 10 ** (lvl / 20)
            continue
        # stops
        if s.release is None:
            continue
        place = s.place
        lvl, tau, hp, comps = BURST[place]
        tag = place
        if place == "vel":
            vt = None
            for j in list(range(i + 1, len(segs))) + list(range(i - 1, -1, -1)):
                if segs[j].kind in "VD":
                    on, off = voice.vowel_targets(segs[j])
                    vt = on if j > i else off
                    break
            vt = vt or voice.vowel["AX"]
            fk = voice.locus_value("vel", vt)[1] * 1.05
            comps = [(fk / voice.p["fric_scale"], 380, 0), (1.55 * fk / voice.p["fric_scale"], 900, -10)]
            tag = "vel%d" % int(fk)
        if s.voiced:
            lvl -= 6.0
            tau *= 0.7
        if s.rel_type == "final":
            lvl -= 5.0
        if not s.aspirated and not s.voiced:
            lvl -= 2.0
        filt = voice.fric_filter(None, comps, hp, tag)
        i0 = int(s.release * FS)
        m = int(6 * tau * FS) + 1
        tt = np.arange(m) / FS
        env = (1 - np.exp(-tt / 0.0005)) * np.exp(-tt / tau)
        seg_noise = rng.standard_normal(m) * env
        seg_noise[:3] += np.array([2.5, -1.5, 0.5])          # the release transient
        pad = int(0.01 * FS)
        x = np.concatenate([np.zeros(pad), seg_noise, np.zeros(pad)])
        y = filt(x)
        # scale so the burst's RMS over ~tau matches the level
        core = y[pad:pad + max(8, int(2 * tau * FS))]
        y *= ref * 10 ** (lvl / 20) / (rms(core) + 1e-12)
        a = i0 - pad
        b = a + len(y)
        lo, hi = max(a, 0), min(b, n)
        out[lo:hi] += y[lo - a:hi - a]
    return out


def inhales(line, voice, n, rng):
    """A quick audible in-breath in each phrase pause (breathless / scared)."""
    out = np.zeros(n)
    for i, s in enumerate(line.segs):
        if s.kind != "P" or s.gap:
            continue
        d = min(0.75 * (s.end - s.start), 0.32)
        t1 = s.end - 0.035
        i0, i1 = int((t1 - d) * FS), int(t1 * FS)
        m = i1 - i0
        u = np.arange(m) / m
        env = np.where(u < 0.8, np.sin(0.5 * np.pi * u / 0.8) ** 2, np.cos(0.5 * np.pi * (u - 0.8) / 0.2) ** 2)
        x = rng.standard_normal(m + 960)
        filt = voice.fric_filter(None, [(1100, 700, 0), (2300, 900, -3), (3600, 1500, -9)], 350, "inhale")
        y = filt(x)[960:] * env
        out[i0:i1] += y * voice.vowel_rms * 10 ** (-25 / 20)
    return out


def synthesize(line, voice, seed):
    rng = np.random.default_rng(seed)
    sty = line.style
    tail = VISITOR_TAIL if voice.p.get("layers") else HUMAN_TAIL
    total = line.end + tail + 0.05
    n = int(total * FS)
    nc = int(total * CR) + 2
    tc = np.arange(nc) / CR
    t = np.arange(n) / FS

    f0c = f0_contour(line, voice, tc, rng)
    av_c, ah_c, avb_c, rd_c, extra = source_tracks(line, voice, tc)
    ftc = formant_tracks(line, voice, tc)
    if sty.get("whisper"):
        ftc["F1"] = ftc["F1"] * 1.08
        extra["B1"] = extra["B1"] + 90.0

    f0 = up(f0c, tc, t)
    if voice.p.get("layers"):                                     # the Visitor's slow wobble
        f0 *= 1.0 + 0.012 * np.sin(2 * np.pi * 0.55 * t + 0.7) + 0.006 * smooth_noise(n, 2.0, rng)
    av = up(av_c, tc, t)
    ah = up(ah_c, tc, t)
    avb = up(avb_c, tc, t)
    rd = up(rd_c, tc, t)
    ft = {k: up(v, tc, t) for k, v in ftc.items()}
    ex = {k: up(v, tc, t) for k, v in extra.items()}
    bandwidths(ft, voice.p["b_scale"], ex)

    jitter = voice.p["jitter"] * sty.get("jitter", 1.0) * (1 + 1.5 * sty.get("tremor", 0.0))
    epochs = glottal_epochs(f0, rng, jitter)
    src, flow = render_glottal(epochs, rd, n, rng, voice.lf, shimmer=voice.p["shimmer"])
    src = shelf(src, 1000.0, voice.p["shelf_db"])
    hp150 = signal.butter(2, 150.0, "highpass", fs=FS)
    noise_b = signal.lfilter(*hp150, rng.standard_normal(n))
    noise_a = signal.lfilter(*hp150, rng.standard_normal(n))
    breath = 10 ** (voice.p["breath_db"] / 20) * voice.asp_gain * sty.get("breath", 1.0)
    if sty.get("breathy"):
        breath *= 3.0
        av = av * 0.55
    if sty.get("tremor"):
        av = av * (1 + 0.08 * sty["tremor"] * smooth_noise(n, 6.0, rng))
    asp = voice.asp_gain * ah
    if sty.get("whisper"):
        exc = voice.asp_gain * 10 ** (-3 / 20) * (av + 0.0) * noise_b + asp * noise_a
        av_eff = np.zeros(n)
    else:
        gate = 0.25 + 0.75 * flow
        exc = av * src + breath * av * gate * noise_b + asp * noise_a
        av_eff = av
    asp_frac = ah / (ah + av_eff + 1e-3)
    b1_add = voice.p["open_b1"] * flow * (av_eff > 0.05) + 200.0 * asp_frac * (ah > 1e-3)
    nasal = (ft["FNP"], ft["FNZ"])
    main = voice.tract(exc, ft, nasal, b1_add=b1_add)
    vbar = resonate(src * avb, np.full(n, 190.0 * voice.p["fscale"]), np.full(n, 110.0))
    vbar *= voice.vbar_gain * 10 ** (-25 / 20)
    fric = frication_events(line, voice, n, rng, flow)
    if sty.get("breathy"):
        fric *= 0.55                                           # soft effort: weaker consonants too
    if sty.get("gasp"):
        fric += inhales(line, voice, n, rng)
    info = dict(t=t, tc=tc, f0c=f0c, av_c=av_c, ah_c=ah_c, ftc=ftc, main=main, flow=flow, epochs=epochs,
                rd=rd, ft=ft, av=av_eff, src=src, first=line.segs[0].start)
    dry = main + vbar + fric
    if voice.p.get("layers"):
        dry = visitor_layers(dry, main, info, voice, rng)
        dry = signal.sosfilt(signal.butter(2, 30.0, "highpass", fs=FS, output="sos"), dry)
    else:
        dry = signal.sosfilt(signal.butter(2, 55.0, "highpass", fs=FS, output="sos"), dry)
    return dry, info


# ---------------------------------------------------------------------------
# The Visitor: the first cut's layers and radio/space chain
# ---------------------------------------------------------------------------

def visitor_layers(dry, main, info, voice, rng):
    t, ft, av = info["t"], info["ft"], info["av"]
    n = len(t)
    epochs = info["epochs"]
    sub_epochs = [(epochs[k][0], epochs[k + 2][0] - epochs[k][0]) for k in range(0, len(epochs) - 2, 2)]
    sub_src, _ = render_glottal(sub_epochs, info["rd"], n, rng, voice.lf, shimmer=0.03, rd_offset=0.35)
    sub_src = one_pole_lp(sub_src, 1800.0)
    rel = V1.SUB_FORMANT_SCALE / V1.FORMANT_SCALE
    ft_sub = {k: (v * rel if k.startswith("F") and k not in ("FNP", "FNZ") else v) for k, v in ft.items()}
    for k in range(1, 6):
        ft_sub["B%d" % k] = ft["B%d" % k] * 0.8
    sub = voice.tract(av * sub_src, ft_sub, (ft["FNP"], ft["FNZ"]))
    d = int(0.028 * FS)
    shift = lambda x: np.concatenate([np.full(d, x[0]), x[:-d]])
    wenv = gsmooth(av, 0.02 * FS)
    wenv[:int(info["first"] * FS)] = 0.0                     # nothing before the first phoneme
    wenv = shift(wenv)
    ft_w = {k: (shift(v) * 1.05 if k.startswith("F") and k not in ("FNP", "FNZ") else shift(v))
            for k, v in ft.items()}
    for k in range(1, 6):
        ft_w["B%d" % k] = shift(ft["B%d" % k]) * 1.4
    whisper = voice.tract(rng.standard_normal(n) * wenv, ft_w, (ft["FNP"], ft["FNP"]))
    voiced = av > 0.5
    ref = rms(main[voiced])
    sub *= ref / rms(sub[voiced]) * 10 ** (V1.SUB_DB / 20)
    whisper *= ref / rms(whisper[voiced]) * 10 ** (V1.WHISPER_DB / 20)
    cdelay = (0.012 + 0.003 * np.sin(2 * np.pi * 0.31 * t)) * FS
    chorus = V1.fractional_delay(main, cdelay) * 10 ** (V1.CHORUS_DB / 20)
    return dry + chorus + sub + whisper


def visitor_radio(dry, active, throw_from, speech_end):
    """voice.py's transmission chain, generalized: band-limit + AGC + overdrive,
    fading and multipath, gated static and 1420 Hz carrier, a thrown echo on the
    last word, and the dark cavern reverb. Tail fades out VISITOR_TAIL after speech."""
    rng = np.random.default_rng(SEED + 1)
    n = len(dry)
    t = np.arange(n) / FS
    sos = lambda order, f, kind: signal.butter(order, f, kind, fs=FS, output="sos")
    x = signal.sosfilt(sos(3, 230.0, "highpass"), dry)
    x = signal.sosfilt(sos(5, 3500.0, "lowpass"), x)
    x = signal.lfilter(*V1.peaking_eq(1400.0, 3.0, 0.8), x)
    x = x / np.max(np.abs(x))
    a = np.exp(-1.0 / (0.045 * FS))
    env = np.sqrt(signal.lfilter([1 - a], [1, -a], x * x)) + 1e-9
    thresh = rms(x[active])
    x = x * np.minimum(1.0, (env / thresh) ** (1.0 / V1.COMP_RATIO - 1.0))
    x = x / np.max(np.abs(x))
    x = np.tanh(V1.RADIO_DRIVE * x) / np.tanh(V1.RADIO_DRIVE)
    x = signal.sosfilt(sos(4, 3500.0, "lowpass"), x)
    x = x * (1.0 + 0.08 * smooth_noise(n, 3.0, rng))
    mp_delay = (0.0011 + 0.0005 * np.sin(2 * np.pi * 0.37 * t)) * FS
    x = x + 0.25 * V1.fractional_delay(x, mp_delay)
    x = x / np.max(np.abs(x))
    voice_rms = rms(x[active])
    g = V1.envelope_follower(active.astype(float), 0.035, 0.45)
    static = signal.sosfilt(sos(2, [300, 3400], "bandpass"), rng.standard_normal(n))
    static *= 1.0 + 0.5 * smooth_noise(n, 9.0, rng)
    static *= voice_rms * 10 ** (V1.STATIC_DB / 20) / rms(static)
    carrier_f = 1420.0 + 2.5 * smooth_noise(n, 0.8, rng)
    carrier = np.sqrt(2) * voice_rms * 10 ** (V1.CARRIER_DB / 20) * np.sin(2 * np.pi * np.cumsum(carrier_f) / FS)
    x = x + g * (static + carrier)
    x = signal.sosfilt(sos(2, [200.0, 3700.0], "bandpass"), x)
    throw = V1.envelope_follower((t >= throw_from).astype(float), 0.03, 0.03)
    echo = np.zeros(n)
    tone = x * throw
    for delay, gain_db, lp in V1.ECHO_TAPS:
        tone = signal.sosfilt(sos(2, lp, "lowpass"), tone)
        d = int(delay * FS)
        echo[d:] += 10 ** (gain_db / 20) * tone[:n - d]
    echo = signal.sosfilt(sos(2, 400.0, "highpass"), echo)
    wet = signal.fftconvolve(x + echo, V1.reverb_ir(rng))[:n]
    out = x + echo + 10 ** (V1.REVERB_DB / 20) * wet
    end = int((speech_end + VISITOR_TAIL) * FS)
    fade = int(0.6 * FS)
    out = out[:end]
    out[-fade:] *= 0.5 * (1 + np.cos(np.linspace(0, np.pi, fade)))
    return out


# ---------------------------------------------------------------------------
# Loudness, output files
# ---------------------------------------------------------------------------

def k_weight(x):
    """ITU-R BS.1770 K-weighting at 48 kHz."""
    b1 = [1.53512485958697, -2.69169618940638, 1.19839281085285]
    a1 = [1.0, -1.69065929318241, 0.73248077421585]
    b2 = [1.0, -2.0, 1.0]
    a2 = [1.0, -1.99004745483398, 0.99007225036621]
    return signal.lfilter(b2, a2, signal.lfilter(b1, a1, x))


def speech_loudness(x, line):
    """K-weighted loudness (LUFS-like) over the phonemes (pauses excluded)."""
    k = k_weight(x)
    mask = np.zeros(len(x), bool)
    for s in line.segs:
        if s.kind != "P":
            mask[int(s.start * FS):int(s.end * FS)] = True
    return -0.691 + 10 * np.log10(np.mean(k[mask[:len(k)]] ** 2) + 1e-20)


def write_wav(path, x):
    pcm = np.clip(np.round(x * 32767.0), -32768, 32767).astype("<i2")
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(FS)
        w.writeframes(pcm.tobytes())


def render_line(d, voices):
    line = Line(d)
    voice = voices[line.speaker]
    fit_timing(line)
    seed = SEED + int(line.id[1:]) * 101
    dry, info = synthesize(line, voice, seed)
    if voice.p.get("layers"):
        active = np.zeros(len(dry), bool)
        active[int(line.segs[0].start * FS):int(line.end * FS)] = True
        throw_from = min(s.start for s in line.segs if s.word == len(line.words) - 1 and s.kind != "P")
        out = visitor_radio(dry, active, throw_from, line.end)
    else:
        end = int((line.end + HUMAN_TAIL) * FS)
        out = dry[:end].copy()
        fade = int(0.03 * FS)
        out[-fade:] *= 0.5 * (1 + np.cos(np.linspace(0, np.pi, fade)))
    out[:int(PRE_ROLL * FS * 0.5)] = 0.0
    loud = speech_loudness(out, line)
    gain = 10 ** ((LUFS_TARGET + line.style.get("loud", 0.0) - loud) / 20)
    out *= gain
    peak = np.max(np.abs(out))
    if peak > 10 ** (PEAK_CEIL / 20):
        out *= 10 ** (PEAK_CEIL / 20) / peak
    line.loudness = speech_loudness(out, line)
    line.peak_db = 20 * np.log10(np.max(np.abs(out)))
    return line, out, info


def manifest_entry(line):
    r = lambda x: round(float(x), 4)
    phon = [{"p": s.label(), "start": r(s.start), "end": r(s.end)} for s in line.segs if s.kind != "P"]
    words = []
    for wi, w in enumerate(line.words):
        ss = [s for s in line.segs if s.word == wi and s.kind != "P"]
        words.append({"w": w["text"], "start": r(ss[0].start), "end": r(ss[-1].end)})
    return {"wav": line.id + ".wav", "duration": r(line.end), "phonemes": phon, "words": words}


def load_dialogue():
    spec = importlib.util.spec_from_file_location("echo_characters_timeline", os.path.join(CHAR_DIR, "timeline.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.DIALOGUE


# ---------------------------------------------------------------------------
# Analysis sheets
# ---------------------------------------------------------------------------

def render_sheet(path, line, out, info):
    W = 1200
    L, R = 58, 14
    ph, f0h, wh = 300, 90, 70
    H = 26 + ph + 44 + f0h + 26 + wh + 16
    img = np.full((H, L + W + R, 3), 16, np.uint8)
    white, grey, cyan, yellow = (230, 230, 230), (120, 120, 120), (80, 230, 255), (255, 210, 80)
    dur = len(out) / FS
    tmax = max(dur, 0.5)
    fmax = 8000.0
    title = "%s  %s  %s   %.2f S (TARGET %.1f)  TEMPO %.2f  %.1f LUFS  PEAK %.1f DBFS" % (
        line.id.upper(), line.speaker.upper(), line.text, line.end, line.target, line.tempo,
        line.loudness, line.peak_db)
    V1.draw_text(img, L, 6, title, white)
    y0 = 26
    img[y0:y0 + ph, L:L + W] = V1.spectrogram_panel(out, tmax, W, ph, f_max=fmax, win_s=0.005)
    for k in range(0, int(fmax) + 1, 1000):
        yy = y0 + int(round((1 - k / fmax) * (ph - 1)))
        img[yy, L - 5:L] = white
        V1.draw_text(img, L - 26, yy - 5, "%dK" % (k // 1000), grey)
    x_of = lambda tm: L + int(round(tm / tmax * (W - 1)))
    ftc, tc, av, ah = info["ftc"], info["tc"], info["av_c"], info["ah_c"]
    for px in range(0, W, 2):
        tm = px / (W - 1) * tmax
        i = int(tm * CR)
        if i >= len(tc) or (av[i] < 0.05 and ah[i] < 0.02):
            continue
        for k in (1, 2, 3):
            f = ftc["F%d" % k][i]
            yy = y0 + int(round((1 - f / fmax) * (ph - 1)))
            if 0 <= yy - y0 < ph:
                img[yy:yy + 2, L + px:L + px + 2] = cyan
    ya = y0 + ph + 2
    for j, s in enumerate(s for s in line.segs if s.kind != "P"):
        xa, xb = x_of(s.start), x_of(s.end)
        img[y0 + ph - 8:y0 + ph, xa] = yellow
        V1.draw_text(img, (xa + xb) // 2 - 2 * len(s.label()), ya + (j % 2) * 7, s.label(), white, scale=1)
    for wi, w in enumerate(line.words):
        ss = [s for s in line.segs if s.word == wi and s.kind != "P"]
        xa = x_of(ss[0].start)
        V1.draw_text(img, xa, ya + 18, w["text"], yellow)
    # F0 panel (voiced parts), 50-400 Hz log
    yf = y0 + ph + 44
    img[yf:yf + f0h, L:L + W] = 28
    lo, hi = np.log(50), np.log(400)
    for hz in (50, 100, 200, 400):
        yy = yf + int((1 - (np.log(hz) - lo) / (hi - lo)) * (f0h - 1))
        img[yy, L:L + W] = 50
        V1.draw_text(img, L - 30, yy - 3, str(hz), grey, scale=1)
    for px in range(W):
        tm = px / (W - 1) * tmax
        i = int(tm * CR)
        if i < len(tc) and av[i] > 0.1:
            yy = yf + int((1 - (np.log(info["f0c"][i]) - lo) / (hi - lo)) * (f0h - 1))
            if yf <= yy < yf + f0h:
                img[yy:yy + 2, L + px] = yellow
    V1.draw_text(img, L, yf + 2, "F0", grey)
    # waveform
    yw = yf + f0h + 26
    edges = np.linspace(0, len(out), W + 1).astype(int)
    mid = yw + wh // 2
    for px in range(W):
        seg = out[edges[px]:edges[px + 1]]
        if len(seg):
            a = mid - int(seg.max() * (wh // 2 - 2))
            b = mid - int(seg.min() * (wh // 2 - 2))
            img[a:b + 1, L + px] = (120, 200, 255)
    for j in range(int(tmax * 10) + 1):
        xx = x_of(j * 0.1)
        img[yw - 6:yw - (0 if j % 5 else -2), xx] = grey
        if j % 5 == 0:
            V1.draw_text(img, xx - 6, yw - 22, "%.1f" % (j * 0.1), grey)
    V1.write_png(path, img)


# ---------------------------------------------------------------------------

def main(argv):
    only = [a for a in argv if a.startswith("d")]
    sheets = "--no-sheets" not in argv
    os.makedirs(OUT_DIR, exist_ok=True)
    if sheets:
        os.makedirs(SHEET_DIR, exist_ok=True)
    dialogue = load_dialogue()
    voices = {name: Voice(name) for name in VOICES}
    man_path = os.path.join(OUT_DIR, "manifest.json")
    manifest = {"lines": {}}
    if only and os.path.exists(man_path):
        with open(man_path) as f:
            manifest = json.load(f)
    print("id   speaker  target  speech  ratio  tempo  LUFS   peak   text")
    for d in dialogue:
        if only and d["id"] not in only:
            continue
        line, out, info = render_line(d, voices)
        write_wav(os.path.join(OUT_DIR, line.id + ".wav"), out)
        manifest["lines"][line.id] = manifest_entry(line)
        if sheets:
            render_sheet(os.path.join(SHEET_DIR, line.id + ".png"), line, out, info)
        print("%s  %-8s %5.2f  %6.2f  %5.2f  %5.2f  %5.1f  %5.1f   %s" % (
            line.id, line.speaker, line.target, line.end - PRE_ROLL, (line.end - PRE_ROLL) / line.target,
            line.tempo, line.loudness, line.peak_db, line.text))
    manifest["lines"] = dict(sorted(manifest["lines"].items()))
    with open(man_path, "w") as f:
        json.dump(manifest, f, indent=1)
    print("wrote", OUT_DIR)


if __name__ == "__main__":
    main(sys.argv[1:])
