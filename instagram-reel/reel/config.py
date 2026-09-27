"""Shared settings. The edit itself (segments, captions, layout tweaks) lives in
projects/<name>.py and is selected with REEL_PROJECT (default: intro_v2).
Every UPPER_CASE name a project defines overrides the default below.
"""
import importlib, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROJECT = os.environ.get("REEL_PROJECT", "intro_v2")
FOOTAGE = os.path.join(ROOT, "footage")
BUILD = os.path.join(ROOT, "build", PROJECT)
OUT = os.path.join(ROOT, "out", PROJECT)
ASSETS = os.environ.get("REEL_ASSETS", "/tmp/claude-0")  # fonts/, emoji/, models/, bin/

FPS = 30
W, H = 1080, 1920
SR = 48000
BPM = 114
BEAT = 60.0 / BPM

# Source frame geometry (iPhone portrait 720x1280)
SRC_W, SRC_H = 720, 1280

# ---- defaults a project may override -------------------------------------
OUT_NAME = "chelsea-packs-the-magic-intro"
FACE_MODE = "segment"        # frame each shot on the face median of that segment ("clip": whole clip)
CHIN_PX = None               # fixed chin offset below the face centre (source px) ...
CHIN_RATIO = 0.46            # ... or as a fraction of detected face width
CAPTION_TOP = 1330           # nothing of the face should sit below this line (output px)
TOP_HEADROOM = 0.3           # crop bias for wide shots: 0 keeps the top of frame, 0.5 centres
PUNCH_HEADROOM = 0.5         # same, for the big punch-ins (zoom > 1.15)
CAP_Y = 1420                 # caption centre line
NAME_CARD = "top"            # "top": title above the head; "lower": replaces captions under the chin
NAME_Y, TAG_Y = 226, 372
LIST_HEADER_Y = 322
DENOISE = False              # DeepFilterNet pass on the dialogue before anything else
DENOISE_ATTEN_DB = 40
MIN_SECTION_PAUSE = 0.20     # shortest silence allowed before a beat-snapped section
END_TAIL = 1.9               # seconds after the final chord hits
MUTE = []                    # (clip, t0, t1) spans of dialogue to silence (clicks, coughs)
HOOK_GAP_SAFE = False        # hook bass without plucked attacks, and no notes dropped into her pauses
VOICE_EQ = [
    "equalizer=f=190:t=q:w=0.9:g=-1.5",
    "equalizer=f=3300:t=q:w=0.9:g=3.5",
    "equalizer=f=6500:t=q:w=1.0:g=3",
]

NAME = "Chelsea"
LIST_HEADER = "What you'll find here"
BRAND_TOP, BRAND_SCRIPT, BRAND_BOTTOM = "welcome home to", "Chelsea", "PACKS THE MAGIC"
FOLLOW_CTA = "Follow for Disney family tips"

# Palette (RGB) pulled from the outfit: Minnie-bow red, white, warm gold.
RED = (224, 36, 58)
WHITE = (255, 255, 255)
INK = (22, 20, 24)
GOLD = (255, 206, 92)
GOLD_DEEP = (240, 164, 40)

_p = importlib.import_module(f"projects.{PROJECT}")
globals().update({k: v for k, v in vars(_p).items() if k.isupper()})

CLIPS = sorted({s["clip"] for s in SEGMENTS})  # noqa: F821 (defined by the project)


def voice_wav(clip):
    """The dialogue source for a clip: denoised mono if the project denoises, else the camera track."""
    suffix = "48k.dn" if DENOISE else "48k"
    return os.path.join(BUILD, "wav", f"{clip}.{suffix}.wav")
