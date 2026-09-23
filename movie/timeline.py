"""ECHO — master timeline.

Single source of truth for the film. Every visual and every sound is placed
from the times computed here, so picture and audio stay in sync.

Run:  python3 movie/timeline.py      -> writes movie/build/timeline.json
"""

import json
import math
import os
import random

FPS = 24
DURATION = 155.0
W, H = 1920, 1080

rng = random.Random(1974)

# ---------------------------------------------------------------------------
# Typewriter text
# ---------------------------------------------------------------------------

def typed(text, start, hold_until, fade=0.45, cps=15.0, scene=None, slot="center", style="body"):
    """A line of text typed one character at a time.

    Returns a cue with an explicit timestamp for every character so the
    audio click track lands exactly on each keystroke.
    """
    times = []
    t = start
    for i, ch in enumerate(text):
        times.append(round(t, 4))
        base = 1.0 / cps
        jitter = rng.uniform(-0.35, 0.45) * base
        pause = 0.0
        if ch in ".,:" and i < len(text) - 1:
            pause = rng.uniform(0.12, 0.22)
        t += base + jitter + pause
    return {
        "text": text,
        "start": start,
        "typed_end": round(times[-1], 4),
        "hold_until": hold_until,
        "fade": fade,
        "char_times": times,
        "scene": scene,
        "slot": slot,
        "style": style,
    }


# ---------------------------------------------------------------------------
# Scenes
# ---------------------------------------------------------------------------

SCENES = [
    {"id": "cold",        "start": 0.0,   "end": 12.5},
    {"id": "observatory", "start": 12.5,  "end": 33.5},
    {"id": "signal",      "start": 33.5,  "end": 56.0},
    {"id": "decode",      "start": 56.0,  "end": 82.0},
    {"id": "recognition", "start": 82.0,  "end": 104.0},
    {"id": "difference",  "start": 104.0, "end": 126.0},
    {"id": "ending",      "start": 126.0, "end": 155.0},
]

TEXT = [
    # cold open — black screen, one line at a time
    typed("A radio signal arrived at 03:14 UTC.", 1.0, 6.0, scene="cold"),
    typed("Nobody was listening for it.", 7.0, 11.8, scene="cold"),

    # observatory — lower third
    typed("Except one old telescope, left running over a holiday weekend.", 16.5, 24.0,
          scene="observatory", slot="lower"),
    typed("It recorded 169 seconds of pulses.", 24.8, 31.0,
          scene="observatory", slot="lower"),

    # signal — lower third over the scope
    typed("Two frequencies. On. Off.", 36.5, 42.0, scene="signal", slot="lower"),
    typed("1,679 pulses. Then silence.", 43.0, 52.0, scene="signal", slot="lower"),

    # decode
    typed("1,679 = 23 × 73", 57.0, 64.5, scene="decode", slot="center-high"),
    typed("Two primes. Only one way to fold it.", 60.0, 64.5, scene="decode", slot="center"),

    # recognition — stacked column to the right of the picture
    typed("We knew this picture.", 82.5, 104.0, scene="recognition", slot="col0"),
    typed("We sent it ourselves. In 1974.", 85.5, 104.0, scene="recognition", slot="col1"),
    typed("Toward a star cluster 25,000 light-years away.", 89.5, 104.0, scene="recognition", slot="col2"),
    typed("It should not have come back.", 94.5, 104.0, scene="recognition", slot="col3"),
    typed("Not for 50,000 years.", 97.5, 104.0, scene="recognition", slot="col4"),
    typed("It came back in 52.", 100.5, 104.0, scene="recognition", slot="col5", style="emph"),

    # difference
    typed("Except it isn't the same picture.", 106.0, 113.0, scene="difference", slot="col0"),
    typed("Someone added themselves.", 110.0, 113.0, scene="difference", slot="col1", style="emph"),

    # ending
    typed("We have not answered yet.", 127.0, 131.0, scene="ending"),
    typed("We are still deciding what to say.", 132.0, 137.0, scene="ending"),
]

# ---------------------------------------------------------------------------
# The message: a 23 x 73 pictogram (1,679 bits), in the spirit of 1974
# ---------------------------------------------------------------------------

COLS, ROWS = 23, 73


def blank():
    return [[0] * COLS for _ in range(ROWS)]


def put(g, x, y, v=1):
    if 0 <= x < COLS and 0 <= y < ROWS:
        g[y][x] = v


def binary_column(g, x, y, n, bits=4, marker=True):
    for i in range(bits):
        put(g, x, y + i, (n >> (bits - 1 - i)) & 1)
    if marker:
        put(g, x, y + bits, 1)


def sprite(g, x0, y0, rows):
    for dy, row in enumerate(rows):
        for dx, ch in enumerate(row):
            if ch == "#":
                put(g, x0 + dx, y0 + dy)


HUMAN = [
    "..#..",
    ".###.",
    "..#..",
    "#####",
    "#.#.#",
    "#.#.#",
    "..#..",
    "..#..",
    ".#.#.",
    ".#.#.",
    ".#.#.",
    "##.##",
]

# the new arrival: taller, a wide head, long arms, three legs
VISITOR = [
    ".###.",
    "#.#.#",
    "#####",
    ".###.",
    "..#..",
    "#####",
    "#.#.#",
    "#.#.#",
    "..#..",
    ".###.",
    "#.#.#",
    "#.#.#",
    "#.#.#",
]


def build_message(visitor=False):
    g = blank()
    r = random.Random(1679)

    # rows 0-4: counting 1..10 in binary, marker bit underneath
    for i, n in enumerate(range(1, 11)):
        binary_column(g, 1 + i * 2, 0, n)

    # rows 6-10: atomic numbers H C N O P
    for i, n in enumerate([1, 6, 7, 8, 15]):
        binary_column(g, 3 + i * 4, 6, n)

    # rows 12-28: formulas of the building blocks (three bands of four)
    for band in range(3):
        y0 = 12 + band * 6
        for block, x0 in enumerate([1, 6, 13, 18]):
            for dy in range(5):
                for dx in range(4):
                    put(g, x0 + dx, y0 + dy, 1 if r.random() < 0.42 else 0)

    # rows 31-45: double helix around a central counter
    for y in range(31, 46):
        ph = (y - 31) / 14.0 * math.pi * 2
        a = int(round(11 + 8.5 * math.cos(ph)))
        b = int(round(11 - 8.5 * math.cos(ph)))
        put(g, a, y)
        put(g, b, y)
        if abs(a - b) > 3:
            put(g, a + (1 if a < b else -1), y)
            put(g, b + (1 if b < a else -1), y)
    for y in range(33, 44):
        put(g, 11, y, 1 if (y % 3) else 0)

    # rows 46-57: a person, their height marker, and how many of them there are
    sprite(g, 6, 46, HUMAN)
    for y in range(46, 58):
        put(g, 3, y)
    put(g, 2, 46); put(g, 4, 46); put(g, 2, 57); put(g, 4, 57)
    binary_column(g, 1, 49, 14, bits=4, marker=False)

    if visitor:
        sprite(g, 16, 46, VISITOR)
    else:
        for y in range(47, 57):
            for x in range(16, 21):
                put(g, x, y, 1 if r.random() < 0.45 else 0)

    # rows 59-63: the solar system, third world raised toward the person
    for dy in range(3):
        for dx in range(3):
            put(g, dx, 60 + dy)
    planets = [(4, 1), (6, 1), (8, 1), (10, 1), (13, 3), (17, 3), (20, 2), (22, 2)]
    for i, (x, s) in enumerate(planets):
        y = 59 if i == 2 else 61
        put(g, x, y)
        if s >= 2:
            put(g, x, y + 1)
        if s >= 3:
            put(g, x - 1, y + 1); put(g, x + 1, y + 1); put(g, x, y + 2)

    # rows 64-72: the telescope that sent it
    for x in range(2, 21):
        dx = (x - 11) / 9.0
        y = int(round(64 + 5 * (1 - dx * dx)))
        put(g, x, y)
    put(g, 11, 65); put(g, 10, 64); put(g, 12, 64)
    for y in range(66, 69):
        put(g, 11, y)
    for x in range(2, 21):
        put(g, x, 71)
    put(g, 2, 70); put(g, 20, 70); put(g, 2, 72); put(g, 20, 72)
    return g


SENT = build_message(visitor=False)
RETURNED = build_message(visitor=True)
BITS = [b for row in RETURNED for b in row]
assert len(BITS) == 1679

# ---------------------------------------------------------------------------
# Pulses — 1,679 of them, sped up so the whole message fits in 18 seconds
# ---------------------------------------------------------------------------

PULSE_START, PULSE_SECONDS, PULSE_R0 = 35.0, 18.0, 5.0


def solve_k():
    lo, hi = 0.01, 1.0
    for _ in range(80):
        k = (lo + hi) / 2
        n = PULSE_R0 / k * (math.exp(k * PULSE_SECONDS) - 1)
        if n > 1679:
            hi = k
        else:
            lo = k
    return (lo + hi) / 2


K = solve_k()
PULSES = []
for i in range(1679):
    # invert N(t) = r0/k (e^{kt} - 1)
    t = math.log(i * K / PULSE_R0 + 1) / K
    PULSES.append(round(PULSE_START + t, 5))

# ---------------------------------------------------------------------------
# Decode grid fill, scan, voice
# ---------------------------------------------------------------------------

GRID_FILL = {"start": 65.0, "end": 77.0}
GRID_ROW_TIMES = [round(GRID_FILL["start"] + i * (GRID_FILL["end"] - GRID_FILL["start"]) / ROWS, 4)
                  for i in range(ROWS)]
GRID_MOVE = {"start": 78.0, "end": 81.5}
SCAN = {"start": 105.5, "end": 108.5}
ZOOM = {"start": 113.5, "end": 116.5}
VOICE = {"start": 117.0, "text": "We heard you."}
TITLE = {"start": 138.5, "in": 2.0, "hold_until": 144.5, "out": 1.5, "text": "ECHO"}
CREDITS = {
    "start": 146.5,
    "end": 154.0,
    "lines": [
        "Written, animated, scored and voiced entirely in code.",
        "No footage. No samples. No AI voice API.",
        "Made with Claude Code",
    ],
}

# Musical/sound cues the score should hit (seconds)
CUES = {
    "sub_swell_in": 0.0,
    "observatory_fade_in": 12.5,
    "signal_on": 33.5,
    "pulses_end": PULSES[-1],
    "silence": 53.2,
    "decode_start": 56.0,
    "grid_complete": GRID_FILL["end"],
    "recognition": 82.0,
    "came_back_in_52": 100.5,
    "scan": SCAN["start"],
    "reveal": 110.0,
    "voice": VOICE["start"],
    "fade_to_black": 124.0,
    "title_hit": TITLE["start"],
    "end": DURATION,
}

timeline = {
    "title": "ECHO",
    "fps": FPS,
    "duration": DURATION,
    "width": W,
    "height": H,
    "scenes": SCENES,
    "text": TEXT,
    "grid": {"cols": COLS, "rows": ROWS, "sent": SENT, "returned": RETURNED,
             "visitor_box": {"r0": 46, "r1": 46 + len(VISITOR) - 1, "c0": 16, "c1": 20},
             "row_times": GRID_ROW_TIMES, "fill": GRID_FILL, "move": GRID_MOVE},
    "pulses": {"times": PULSES, "bits": BITS, "freq_one": 1420.0, "freq_zero": 1000.0},
    "scan": SCAN,
    "zoom": ZOOM,
    "voice": VOICE,
    "title_card": TITLE,
    "credits": CREDITS,
    "cues": CUES,
}

if __name__ == "__main__":
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "build", "timeline.json")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w") as f:
        json.dump(timeline, f)
    print(f"wrote {out}")
    print(f"pulse k={K:.4f}  last pulse at {PULSES[-1]:.2f}s  final rate {PULSE_R0*math.exp(K*PULSE_SECONDS):.0f}/s")
    for name, g in (("SENT", SENT), ("RETURNED", RETURNED)):
        print(name)
        for y, row in enumerate(g):
            print(f"{y:2d} " + "".join("█" if b else "·" for b in row))
