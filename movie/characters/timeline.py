"""ECHO (characters cut) — script and master timeline.

The night the signal arrives, told through two radio astronomers in the
observatory hut, and the visitor who answers them. Every line of dialogue,
action beat, camera shot and screen event is timed here.

Run:  python3 movie/characters/timeline.py  -> writes movie/characters/build/timeline.json

Dialogue timing: `start` is when the line begins; `target` is the length the
voice should aim for. Once the voices are rendered, build/dialogue/manifest.json
holds the real durations and this file reads them to keep lines from
overlapping (see fit_dialogue).
"""

import json
import math
import os
import random
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))
from timeline import SENT, RETURNED, VISITOR as VISITOR_SPRITE, COLS, ROWS  # noqa: E402

FPS = 24
DURATION = 126.0
W, H = 1920, 1080
rng = random.Random(314)


def typed(text, start, hold_until, fade=0.45, cps=15.0, slot="center", style="body"):
    times, t = [], start
    for i, ch in enumerate(text):
        times.append(round(t, 4))
        base = 1.0 / cps
        t += base + rng.uniform(-0.35, 0.45) * base + (rng.uniform(0.12, 0.22) if ch in ".,:" and i < len(text) - 1 else 0)
    return {"text": text, "start": start, "typed_end": round(times[-1], 4), "hold_until": hold_until,
            "fade": fade, "char_times": times, "slot": slot, "style": style}


# ---------------------------------------------------------------------------
# Characters
# ---------------------------------------------------------------------------

CAST = {
    "maya": {
        "name": "Dr. Maya Reyes",
        "about": "Senior radio astronomer, early 50s. Calm, dry, quietly brilliant. Brown skin, "
                 "dark curly hair with grey streaks pulled into a loose bun, round tortoiseshell "
                 "glasses, a moss-green knitted cardigan over a cream shirt, dark trousers.",
        "voice": "Warm low alto, unhurried, precise diction. F0 ~ 175-200 Hz.",
    },
    "sam": {
        "name": "Sam Okafor",
        "about": "PhD student, mid 20s. Eager, jumpy, sleep-deprived. Dark brown skin, short "
                 "twisted hair, a faded mustard hoodie with headphones around the neck, jeans, "
                 "sneakers.",
        "voice": "Young tenor, quick, breathy when scared. F0 ~ 115-140 Hz.",
    },
    "visitor": {
        "name": "The Visitor",
        "about": "Seen only as a hologram assembled from light. Tall and slender, elongated skull "
                 "with a swept-back crest, very large dark almond eyes with a faint inner glow, "
                 "no nose, a small delicate mouth, long three-fingered hands. Calm and curious. "
                 "Its silhouette echoes the three-legged figure in the returned picture.",
        "voice": "The same eerie radio voice as the first cut's 'We heard you.' Slow, low, gentle.",
    },
}

# ---------------------------------------------------------------------------
# Dialogue
# ---------------------------------------------------------------------------
# delivery notes guide both the voice and the acting

DIALOGUE = [
    {"id": "d01", "speaker": "sam",     "start": 18.8,  "target": 1.9, "text": "Maya. Maya! Wake up.",
     "delivery": "urgent, rising, second 'Maya' louder"},
    {"id": "d02", "speaker": "maya",    "start": 21.4,  "target": 2.0, "text": "It's three in the morning, Sam.",
     "delivery": "groggy, flat, not moving, a little amused"},
    {"id": "d03", "speaker": "sam",     "start": 24.2,  "target": 2.6, "text": "Something is transmitting. Right at us.",
     "delivery": "breathless, fast, stress on 'right at us'"},
    {"id": "d04", "speaker": "maya",    "start": 33.8,  "target": 2.2, "text": "Two tones. On. Off.",
     "delivery": "quiet, reading the screen, clipped"},
    {"id": "d05", "speaker": "maya",    "start": 36.7,  "target": 2.3, "text": "That's not noise. That's a message.",
     "delivery": "slow realisation, stress on 'message'"},
    {"id": "d06", "speaker": "sam",     "start": 41.2,  "target": 2.8, "text": "Sixteen seventy-nine pulses. Then nothing.",
     "delivery": "reading off the counter, trailing off"},
    {"id": "d07", "speaker": "maya",    "start": 45.0,  "target": 2.8, "text": "Twenty-three by seventy-three. Fold it.",
     "delivery": "sharp, certain, an instruction"},
    {"id": "d08", "speaker": "maya",    "start": 56.6,  "target": 1.7, "text": "I know this picture.",
     "delivery": "awe, almost a whisper"},
    {"id": "d09", "speaker": "maya",    "start": 58.9,  "target": 2.7, "text": "We sent it. In nineteen seventy-four.",
     "delivery": "disbelief, slow"},
    {"id": "d10", "speaker": "sam",     "start": 62.5,  "target": 2.6, "text": "Then who is that? Standing next to us?",
     "delivery": "scared, question rising"},
    {"id": "d11", "speaker": "visitor", "start": 74.0,  "target": 2.2, "text": "We heard you.",
     "delivery": "calm, slow, gentle"},
    {"id": "d12", "speaker": "sam",     "start": 77.3,  "target": 0.9, "text": "Maya...",
     "delivery": "whispered, terrified"},
    {"id": "d13", "speaker": "maya",    "start": 78.9,  "target": 1.4, "text": "Who are you?",
     "delivery": "steady, brave, soft"},
    {"id": "d14", "speaker": "visitor", "start": 81.1,  "target": 2.7, "text": "You asked if anyone was out there.",
     "delivery": "patient, kind"},
    {"id": "d15", "speaker": "visitor", "start": 84.6,  "target": 1.8, "text": "We were listening.",
     "delivery": "warm, a hint of a smile"},
    {"id": "d16", "speaker": "maya",    "start": 87.2,  "target": 1.4, "text": "What do you want?",
     "delivery": "careful, curious, not afraid"},
    {"id": "d17", "speaker": "visitor", "start": 89.4,  "target": 2.4, "text": "To answer. The way you did.",
     "delivery": "slow, deliberate"},
    {"id": "d18", "speaker": "visitor", "start": 92.5,  "target": 2.3, "text": "With a picture of ourselves.",
     "delivery": "tender, final"},
    {"id": "d19", "speaker": "sam",     "start": 101.0, "target": 1.8, "text": "What do we send back?",
     "delivery": "shaky, quiet, amazed"},
    {"id": "d20", "speaker": "maya",    "start": 107.2, "target": 1.6, "text": "Something honest.",
     "delivery": "soft, a small smile, looking out of the window"},
]

TEXT = [
    typed("03:14 UTC.", 1.0, 3.3),
    typed("Kestrel Ridge Radio Observatory.", 3.6, 6.6),
]

# ---------------------------------------------------------------------------
# Action beats (absolute seconds). The monitors, lights, characters and the
# hologram all key off these.
# ---------------------------------------------------------------------------

BEATS = {
    "exterior": {"start": 7.0, "end": 15.0},        # establishing: dish on the ridge, push toward the lit hut window
    "alarm": 12.0,                                  # hut alarm starts beeping (heard outside first)
    "sam_wakes": {"start": 15.8, "end": 17.4},      # jolts awake (startle at 15.85), head up, blinks, looks at the screen
    "maya_arm_off_eyes": 23.0,                      # Maya lifts her forearm off her eyes near the end of d02
    "maya_sits_forward": {"start": 27.0, "end": 28.6},  # out of the armchair's recline
    "maya_stands": {"start": 28.9, "end": 30.1},
    "maya_walks": {"start": 30.1, "end": 33.1},     # armchair -> behind Sam's chair at the desk
    "pulses": {"start": 39.0, "end": 45.5},         # on the main monitor: 1,679 pulses, accelerating
    "maya_reach_key": {"start": 46.3, "end": 47.7},  # Maya leans over Sam and hits the key that folds it
    "fold": {"start": 48.0, "end": 55.5},           # the picture assembles row by row on the monitor
    "sam_points": {"start": 63.2, "end": 66.0},
    "zoom_visitor": {"start": 64.5, "end": 66.5},   # monitor zooms to the added figure
    "surge": {"start": 66.5, "end": 68.2},          # lights brown out and flicker, monitors glitch
    "alarm_dies": 67.4,                             # the alarm dies in the brown-out and stays silent
    "sam_backs_off": {"start": 67.0, "end": 69.5},  # chair rolls back, he stands, steps back
    "materialize": {"start": 67.8, "end": 73.4},    # voxels lift out of the screen and assemble the Visitor
    "maya_steps_forward": {"start": 78.2, "end": 79.6},
    "visitor_crouch": {"start": 84.3, "end": 88.6},  # folds down to Maya's eye level for "We were listening."
    "visitor_gesture": {"start": 89.3, "end": 92.3},
    "visitor_raises_hand": {"start": 92.6, "end": 94.0},
    "maya_raises_hand": {"start": 93.2, "end": 94.7},  # she answers the gesture: the two figures of the picture
    "dematerialize": {"start": 95.2, "end": 99.6},  # the Visitor dissolves into light that streams out of the window
    "lights_return": 99.2,
    "maya_to_window": {"start": 102.8, "end": 106.4},
    "dish_turns": {"start": 109.5, "end": 113.0},   # exterior: the dish slowly swings toward the sky
}

# ---------------------------------------------------------------------------
# Blocking: where everyone stands (metres, floor y = 0, see API.md for the room)
# ---------------------------------------------------------------------------

MARKS = {
    "sam_chair":      {"pos": [-0.50, 0, -0.85], "yaw": math.pi},        # facing the main monitor (-Z)
    "sam_chair_back": {"pos": [-0.50, 0, -0.45], "yaw": math.pi * 0.8},  # after rolling back from the desk
    "sam_retreat":    {"pos": [-1.10, 0, 0.15], "yaw": math.pi * 0.58},  # backed away, facing the Visitor
    "sam_behind_maya": {"pos": [-0.45, 0, 0.30], "yaw": math.pi * 0.64}, # edges in behind Maya
    "sam_mid":        {"pos": [0.10, 0, 0.55], "yaw": math.pi * 0.54},   # follows her toward the window
    "maya_armchair":  {"pos": [-1.85, 0, 0.95], "yaw": math.pi * 0.78},  # armchair in the corner, facing the desk
    "maya_stand":     {"pos": [-1.55, 0, 0.55], "yaw": math.pi * 0.78},
    "maya_desk":      {"pos": [-0.05, 0, -0.42], "yaw": math.pi},         # behind Sam's right shoulder, facing the monitor
    "maya_forward":   {"pos": [0.30, 0, -0.05], "yaw": math.pi * 0.63},   # stepped toward the Visitor
    "maya_closer":    {"pos": [0.55, 0, -0.22], "yaw": math.pi * 0.61},   # one more step, face to face
    "maya_window":    {"pos": [1.90, 0, 0.30], "yaw": math.pi * 0.5},     # at the window, looking out (+X)
    "visitor":        {"pos": [1.30, 0, -0.50], "yaw": -math.pi * 0.42},  # forms between the desk and the window
    "visitor_step":   {"pos": [1.12, 0, -0.38], "yaw": -math.pi * 0.41},  # a few curious steps toward them
}

WALKS = [
    {"who": "maya", "start": 30.1, "end": 33.1, "from": "maya_stand", "to": "maya_desk", "steps": 5},
    {"who": "sam", "start": 68.4, "end": 69.5, "from": "sam_chair_back", "to": "sam_retreat", "steps": 3, "backward": True},
    {"who": "visitor", "start": 75.9, "end": 77.1, "from": "visitor", "to": "visitor_step", "steps": 3, "gait": "tri"},
    {"who": "maya", "start": 78.2, "end": 79.6, "from": "maya_desk", "to": "maya_forward", "steps": 2},
    {"who": "sam", "start": 79.9, "end": 81.1, "from": "sam_retreat", "to": "sam_behind_maya", "steps": 3},
    {"who": "maya", "start": 85.0, "end": 86.2, "from": "maya_forward", "to": "maya_closer", "steps": 2},
    {"who": "sam", "start": 100.4, "end": 101.9, "from": "sam_behind_maya", "to": "sam_mid", "steps": 3},
    {"who": "maya", "start": 102.8, "end": 106.0, "from": "maya_closer", "to": "maya_window", "steps": 5},
]
# a footfall lands at the middle of each step interval (film.js drives the walk
# cycle so the feet plant exactly there; the score puts footsteps on them)
FOOTSTEPS = [{"who": w["who"], "t": round(w["start"] + (i + 0.5) * (w["end"] - w["start"]) / w["steps"], 4),
              "foot": "L" if i % 2 == 0 else "R"}
             for w in WALKS for i in range(w["steps"])]

# ---------------------------------------------------------------------------
# Shots. The camera for each is authored in scenes/film.js.
# ---------------------------------------------------------------------------

SHOTS = [
    ("ext_push",        7.0,  15.0, "EXT. Ridge, night. Dish silhouette, stars; slow push toward the hut's warm window."),
    ("int_wide",        15.0, 21.2, "INT. Hut wide. Sam asleep on the desk by the monitors, Maya dozing in the armchair behind. Alarm light pulsing."),
    ("maya_chair_cu",   21.2, 24.0, "CU Maya slumped back in the armchair, forearm over her eyes."),
    ("sam_mcu",         24.0, 27.0, "MCU Sam twisted round in his chair toward her, monitor light on his face."),
    ("int_wide_up",     27.0, 33.4, "Wide: Maya sits forward, stands, crosses to the desk behind Sam."),
    ("screen_ots",      33.4, 39.0, "Over Maya's shoulder: both faces lit by the monitors, the spectrogram."),
    ("screen_insert",   39.0, 44.8, "Insert: the monitor. Pulses accelerate, counter to 1679."),
    ("maya_cu_1",       44.8, 48.0, "CU Maya, glasses reflecting the screen."),
    ("fold_insert",     48.0, 56.2, "Insert: the picture folds together on the monitor, push in."),
    ("maya_cu_2",       56.2, 62.2, "CU Maya, lit by the picture: awe."),
    ("two_shot",        62.2, 66.5, "Two-shot from the monitor's side: Sam points at the screen."),
    ("surge_wide",      66.5, 73.8, "Wide: lights flicker, Sam backs off, voxels pour out of the screen into the Visitor."),
    ("visitor_cu_1",    73.8, 77.0, "CU the Visitor: 'We heard you.'"),
    ("sam_reaction",    77.0, 78.6, "MCU Sam, terrified."),
    ("maya_ots_visitor", 78.6, 81.0, "Over the Visitor's shoulder onto Maya stepping forward."),
    ("visitor_cu_2",    81.0, 84.4, "CU the Visitor, gentle."),
    ("arc_two",         84.4, 87.0, "Arcing two-shot: the Visitor crouches to Maya's eye level, face to face in profile."),
    ("maya_cu_3",       87.0, 89.2, "CU Maya."),
    ("visitor_ms",      89.2, 93.0, "MS the Visitor, gesturing; it begins to raise its hand."),
    ("hands_two",       93.0, 95.0, "Wide two-shot: the Visitor's hand up, and Maya slowly raising hers. The picture, made real."),
    ("dissolve_wide",   95.0, 100.6, "Wide: the Visitor dissolves; light streams out through the window."),
    ("sam_cu_after",    100.6, 102.8, "MCU Sam in the dark room."),
    ("maya_window",     102.8, 109.3, "Maya walks to the window; profile CU lit by starlight and the dish outside."),
    ("ext_dish",        109.3, 113.0, "EXT. The dish slowly turns toward the stars. Crane up."),
]

# screen content for the main monitor (compressed versions of the first film's)
PULSE_START = BEATS["pulses"]["start"]
PULSE_SECONDS = BEATS["pulses"]["end"] - PULSE_START
PULSE_R0 = 6.0


def _solve_k():
    lo, hi = 0.01, 3.0
    for _ in range(80):
        k = (lo + hi) / 2
        if PULSE_R0 / k * (math.exp(k * PULSE_SECONDS) - 1) > 1679:
            hi = k
        else:
            lo = k
    return (lo + hi) / 2


K = _solve_k()
PULSES = [round(PULSE_START + math.log(i * K / PULSE_R0 + 1) / K, 5) for i in range(1679)]
BITS_RETURNED = [b for row in RETURNED for b in row]

ROW_TIMES = [round(BEATS["fold"]["start"] + r * (BEATS["fold"]["end"] - BEATS["fold"]["start"]) / ROWS, 4)
             for r in range(ROWS)]

TITLE = {"start": 113.6, "in": 1.6, "hold_until": 118.2, "out": 1.0, "text": "ECHO"}
CREDITS = {"start": 119.4, "end": 125.6, "lines": [
    "Written, animated and scored entirely in code. No footage.",
    "Voices: Kokoro-82M, an open-source speech model, run locally.",
    "Made with Claude Code"]}

SCENES = [
    {"id": "open", "start": 0.0, "end": 7.0, "fade_in": 0.0, "fade_out": 0.0},
    {"id": "film", "start": 7.0, "end": 113.0, "fade_in": 2.0, "fade_out": 1.5},
    {"id": "titles", "start": 113.0, "end": 126.0, "fade_in": 0.0, "fade_out": 0.0},
]


def fit_dialogue():
    """If rendered voices exist, attach real durations and phoneme timing paths."""
    man = os.path.join(HERE, "build", "dialogue", "manifest.json")
    if not os.path.exists(man):
        return False
    with open(man) as f:
        m = json.load(f)
    for d in DIALOGUE:
        info = m.get("lines", {}).get(d["id"])
        if info:
            d["duration"] = info["duration"]
            d["file"] = info.get("wav")
            d["phonemes"] = info.get("phonemes", [])
            d["words"] = info.get("words", [])
    return True


timeline = {
    "title": "ECHO",
    "fps": FPS, "duration": DURATION, "width": W, "height": H,
    "scenes": SCENES,
    "text": TEXT,
    "cast": CAST,
    "dialogue": DIALOGUE,
    "beats": BEATS,
    "marks": MARKS,
    "walks": WALKS,
    "footsteps": FOOTSTEPS,
    "shots": [{"id": s, "start": a, "end": b, "desc": d} for s, a, b, d in SHOTS],
    "grid": {"cols": COLS, "rows": ROWS, "sent": SENT, "returned": RETURNED, "row_times": ROW_TIMES,
             "visitor_box": {"r0": 46, "r1": 46 + len(VISITOR_SPRITE) - 1, "c0": 16, "c1": 20}},
    "pulses": {"times": PULSES, "bits": BITS_RETURNED, "freq_one": 1420.0, "freq_zero": 1000.0,
               "k": K, "r0": PULSE_R0, "start": PULSE_START},
    "title_card": TITLE,
    "credits": CREDITS,
}

if __name__ == "__main__":
    fitted = fit_dialogue()
    out = os.path.join(HERE, "build", "timeline.json")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w") as f:
        json.dump(timeline, f)
    print(f"wrote {out}  ({DURATION:.0f} s, {int(DURATION * FPS)} frames, voices {'fitted' if fitted else 'not rendered yet'})")
    # sanity: lines must not overlap the next line by the same speaker or run past their shot
    for a, b in zip(DIALOGUE, DIALOGUE[1:]):
        end = a["start"] + a.get("duration", a["target"])
        if end > b["start"] - 0.15:
            print(f"  ! {a['id']} ends {end:.2f}s, {b['id']} starts {b['start']:.2f}s")
