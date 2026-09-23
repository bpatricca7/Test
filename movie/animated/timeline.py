"""ECHO (animated cut) — master timeline.

Single source of truth for the animated cut. Every scene, camera beat,
typed character, pulse and sound cue is timed here, so picture and audio
stay in sync.

Run:  python3 movie/animated/timeline.py   -> writes movie/animated/build/timeline.json
"""

import json
import math
import os
import random
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))
# the 1,679-bit picture is shared with the first cut
from timeline import SENT, RETURNED, HUMAN, VISITOR, COLS, ROWS  # noqa: E402

FPS = 24
DURATION = 185.0
W, H = 1920, 1080

rng = random.Random(1974)


def typed(text, start, hold_until, fade=0.45, cps=15.0, slot="center", style="body"):
    """A line of text typed one character at a time, with a timestamp per character."""
    times = []
    t = start
    for i, ch in enumerate(text):
        times.append(round(t, 4))
        base = 1.0 / cps
        jitter = rng.uniform(-0.35, 0.45) * base
        pause = rng.uniform(0.12, 0.22) if ch in ".,:" and i < len(text) - 1 else 0.0
        t += base + jitter + pause
    return {"text": text, "start": start, "typed_end": round(times[-1], 4),
            "hold_until": hold_until, "fade": fade, "char_times": times,
            "slot": slot, "style": style}


# ---------------------------------------------------------------------------
# Scenes. fade_in / fade_out are dips to black; 0 means a hard or matched cut.
# ---------------------------------------------------------------------------

SCENES = [
    {"id": "open1974",    "start": 0.0,   "end": 9.0,   "fade_in": 0.0, "fade_out": 0.0},
    {"id": "valley",      "start": 9.0,   "end": 27.0,  "fade_in": 2.5, "fade_out": 0.0},
    {"id": "journey",     "start": 27.0,  "end": 47.0,  "fade_in": 0.0, "fade_out": 1.5},
    {"id": "later",       "start": 47.0,  "end": 54.0,  "fade_in": 0.0, "fade_out": 0.0},
    {"id": "observatory", "start": 54.0,  "end": 74.0,  "fade_in": 2.0, "fade_out": 0.8},
    {"id": "signal",      "start": 74.0,  "end": 96.0,  "fade_in": 0.8, "fade_out": 0.6},
    {"id": "fold",        "start": 96.0,  "end": 118.0, "fade_in": 1.0, "fade_out": 0.0},
    {"id": "recognition", "start": 118.0, "end": 138.0, "fade_in": 0.0, "fade_out": 0.0},
    {"id": "visitor",     "start": 138.0, "end": 160.0, "fade_in": 0.0, "fade_out": 2.0},
    {"id": "ending",      "start": 160.0, "end": 185.0, "fade_in": 2.0, "fade_out": 1.5},
]

TEXT = [
    # prologue: black screen, typewriter
    typed("November 16, 1974.", 1.0, 4.2),
    typed("We sent a message to the stars.", 4.8, 8.4),

    # the valley dish
    typed("1,679 bits. A picture of who we are.", 11.0, 16.5, slot="lower"),
    typed("Aimed at a star cluster 25,000 light-years away.", 19.0, 25.5, slot="lower"),

    # the journey out
    typed("It will take 25,000 years to arrive.", 33.5, 38.5, slot="lower"),
    typed("Any reply would take 25,000 more.", 40.0, 45.3, slot="lower"),

    # present day
    typed("52 years later.", 47.8, 50.8),
    typed("03:14 UTC.", 51.2, 53.5),

    # observatory
    typed("One old telescope, left running over a holiday weekend.", 55.5, 62.0, slot="lower"),
    typed("Nobody was listening.", 67.5, 72.8, slot="lower"),

    # signal
    typed("Two frequencies. On. Off.", 77.0, 82.5, slot="lower"),
    typed("1,679 pulses.", 84.0, 88.5, slot="lower"),
    typed("The same number we sent.", 89.0, 93.8, slot="lower", style="emph"),

    # fold
    typed("1,679 = 23 × 73", 97.0, 104.2, slot="center-high"),
    typed("Only one way to fold it.", 100.5, 104.2, slot="center"),

    # recognition — column right of the picture
    typed("We knew this picture.", 121.5, 137.5, slot="col0"),
    typed("It was ours.", 124.5, 137.5, slot="col1"),
    typed("It should not have come back.", 127.0, 137.5, slot="col2"),
    typed("Not for 50,000 years.", 130.0, 137.5, slot="col3"),
    typed("It came back in 52.", 133.0, 137.5, slot="col4", style="emph"),

    # visitor
    typed("Except it isn't the same picture.", 139.5, 146.5, slot="col0"),
    typed("Someone added themselves.", 143.0, 146.5, slot="col1", style="emph"),

    # ending
    typed("We have not answered yet.", 161.5, 165.5),
    typed("We are still deciding what to say.", 166.5, 170.8),
]

# ---------------------------------------------------------------------------
# Beats for each scene (all absolute film seconds)
# ---------------------------------------------------------------------------

BITS_SENT = [b for row in SENT for b in row]
BITS_RETURNED = [b for row in RETURNED for b in row]
assert len(BITS_SENT) == len(BITS_RETURNED) == 1679

VALLEY = {
    "crane": {"start": 9.0, "end": 18.0},          # camera descends onto the dish
    "power_up": 14.5,                               # platform + tower lights come on
    "transmit": {"start": 17.0, "end": 24.0},       # the 1,679 bits stream up the beam
    "tilt_up": {"start": 20.0, "end": 27.0},        # camera follows the beam into the sky
}

JOURNEY = {
    # matched "powers of ten" cuts: each stage ends with its subject shrinking
    # to the middle of the frame, and the next begins there
    "earth":  {"start": 27.0, "end": 33.0},
    "solar":  {"start": 33.0, "end": 38.5},
    "galaxy": {"start": 38.5, "end": 47.0},
}

OBSERVATORY = {
    "slew": {"start": 56.0, "end": 60.5},           # the dish turns to a new patch of sky
    "arrival": {"start": 64.0, "end": 67.0},        # rings of signal descend into the dish
    "alarm": 65.2,                                  # hut window flickers, beacon speeds up
}

PULSE_START, PULSE_SECONDS, PULSE_R0 = 76.0, 17.0, 5.0


def _solve_k():
    lo, hi = 0.01, 1.0
    for _ in range(80):
        k = (lo + hi) / 2
        if PULSE_R0 / k * (math.exp(k * PULSE_SECONDS) - 1) > 1679:
            hi = k
        else:
            lo = k
    return (lo + hi) / 2


K = _solve_k()
PULSES = [round(PULSE_START + math.log(i * K / PULSE_R0 + 1) / K, 5) for i in range(1679)]

FOLD = {
    "snake": {"start": 96.0, "end": 104.5},         # the bitstream flows through space as a ribbon
    "fold": {"start": 104.5, "end": 112.0},         # each row flies to its place in the 23 x 73 grid
    "row_stagger": 0.07,                            # seconds between rows starting to fold
    "row_flight": 1.6,                              # seconds for one row to land
    "orbit": {"start": 112.0, "end": 118.0},
}

RECOGNITION = {
    "ghost_in": {"start": 119.0, "end": 123.0},     # our 1974 original flies in behind it
    "move_left": {"start": 118.0, "end": 121.0},
}

VISITOR_BEATS = {
    "scan": {"start": 138.5, "end": 141.5},         # a scan plane sweeps top to bottom
    "push_in": {"start": 146.0, "end": 149.0},      # camera to the two figures
    "step_out": {"start": 149.0, "end": 152.0},     # visitor voxels lift out of the picture
    "turn": {"start": 151.5, "end": 153.2},         # it turns to face us
    "voice": 153.5,                                 # "We heard you."
    "raise_hand": {"start": 153.6, "end": 154.8},
    "box": {"r0": 46, "r1": 46 + len(VISITOR) - 1, "c0": 16, "c1": 20},
    "human_box": {"r0": 46, "r1": 46 + len(HUMAN) - 1, "c0": 6, "c1": 10},
}

VOICE = {"start": VISITOR_BEATS["voice"], "text": "We heard you."}
# word onsets measured from the synthesized line (movie/build/voice.wav)
VOICE["words"] = [{"w": w, "t": round(VOICE["start"] + dt, 3)}
                  for w, dt in (("WE", 0.05), ("HEARD", 0.69), ("YOU.", 1.39))]

ENDING = {
    "earth_orbit": {"start": 160.0, "end": 171.0},
    "title_particles": {"start": 171.0, "end": 173.5},   # particles swarm into the title
    "title_hold_until": 176.5,
    "title_out": 1.0,
    "credits": {"start": 177.8, "end": 184.2,
                "lines": ["Written, animated, scored and voiced entirely in code.",
                          "No footage. No samples. No AI voice API.",
                          "Made with Claude Code"]},
}

CUES = {
    "first_key": 1.0,
    "valley_in": 9.0,
    "power_up": VALLEY["power_up"],
    "transmit": VALLEY["transmit"]["start"],
    "earth": JOURNEY["earth"]["start"],
    "solar": JOURNEY["solar"]["start"],
    "galaxy": JOURNEY["galaxy"]["start"],
    "black_later": 46.5,
    "observatory_in": 54.0,
    "slew": OBSERVATORY["slew"]["start"],
    "arrival": OBSERVATORY["arrival"]["start"],
    "signal_on": 74.0,
    "pulses_start": PULSE_START,
    "pulses_end": PULSES[-1],
    "silence": 93.3,
    "snake": FOLD["snake"]["start"],
    "fold": FOLD["fold"]["start"],
    "fold_complete": FOLD["fold"]["end"],
    "recognition": 118.0,
    "came_back_in_52": 133.0,
    "scan": VISITOR_BEATS["scan"]["start"],
    "reveal": 143.0,
    "step_out": VISITOR_BEATS["step_out"]["start"],
    "voice": VOICE["start"],
    "fade_to_black": 158.0,
    "ending": 160.0,
    "title": ENDING["title_particles"]["start"],
    "credits": ENDING["credits"]["start"],
    "end": DURATION,
}

timeline = {
    "title": "ECHO",
    "fps": FPS, "duration": DURATION, "width": W, "height": H,
    "scenes": SCENES,
    "text": TEXT,
    "grid": {"cols": COLS, "rows": ROWS, "sent": SENT, "returned": RETURNED},
    "valley": dict(VALLEY, bits=BITS_SENT),
    "journey": JOURNEY,
    "observatory": OBSERVATORY,
    "pulses": {"times": PULSES, "bits": BITS_RETURNED, "freq_one": 1420.0, "freq_zero": 1000.0,
               "k": K, "r0": PULSE_R0, "start": PULSE_START},
    "fold": FOLD,
    "recognition": RECOGNITION,
    "visitor": VISITOR_BEATS,
    "voice": VOICE,
    "ending": ENDING,
    "cues": CUES,
}

if __name__ == "__main__":
    out = os.path.join(HERE, "build", "timeline.json")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w") as f:
        json.dump(timeline, f)
    print(f"wrote {out}  ({DURATION:.0f} s, {int(DURATION * FPS)} frames)")
    print(f"pulses {PULSES[0]:.2f}-{PULSES[-1]:.2f}s, final rate {PULSE_R0 * math.exp(K * PULSE_SECONDS):.0f}/s")
