"""Edit decision list and design constants for the intro reel.

Times in SEGMENTS are seconds inside each source clip. The timeline builder
tightens nothing on its own: pauses are controlled by where each segment's
in/out points sit relative to the speech, and by the beat snapping of the
segments that open a new musical section.
"""
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FOOTAGE = os.path.join(ROOT, "footage")
BUILD = os.path.join(ROOT, "build")
OUT = os.path.join(ROOT, "out")
ASSETS = os.environ.get("REEL_ASSETS", "/tmp/claude-0")  # fonts/, emoji/, models/

FPS = 30
W, H = 1080, 1920
SR = 48000
BPM = 114
BEAT = 60.0 / BPM

# Source frame geometry (iPhone portrait 720x1280) and where the face sits.
SRC_W, SRC_H = 720, 1280
CHIN_BELOW_FACE_CENTER = 170   # px in source, face-detector centre -> chin
CAPTION_TOP = 1330             # nothing of the face should sit below this line

# Each segment: clip, in, out, zoom (1.0 = full frame), plus optional flags:
#   section - this segment opens a musical section (its start is beat-snapped)
#   anchor  - the word whose onset is snapped to the grid ("beat" or "eighth")
#   punch   - a comedic punch-in (zoom overshoot + whoosh)
#   push    - end zoom for a slow push-in across the segment
SEGMENTS = [
    dict(clip="IMG_3540", i=0.00, o=2.84, zoom=1.00, section="hook"),
    dict(clip="IMG_3540", i=3.28, o=3.72, zoom=1.00),                  # "but"
    dict(clip="IMG_3540", i=4.33, o=7.00, zoom=1.14),
    dict(clip="IMG_3540", i=7.35, o=9.40, zoom=1.32, punch=True, section="stop"),
    dict(clip="IMG_3541", i=0.14, o=2.50, zoom=1.00, section="groove", snap="beat"),
    dict(clip="IMG_3541", i=3.12, o=5.34, zoom=1.08),
    dict(clip="IMG_3544", i=0.00, o=3.20, zoom=1.00, section="story", snap="eighth"),
    dict(clip="IMG_3544", i=3.20, o=6.97, zoom=1.12),
    dict(clip="IMG_3544", i=6.97, o=9.50, zoom=1.26),
    dict(clip="IMG_3544", i=9.79, o=13.05, zoom=1.00),
    dict(clip="IMG_3546", i=0.00, o=1.54, zoom=1.14, section="build", snap="eighth"),
    dict(clip="IMG_3546", i=2.09, o=4.95, zoom=1.00),
    dict(clip="IMG_3549", i=0.00, o=3.36, zoom=1.10, section="list", snap="eighth"),
    dict(clip="IMG_3549", i=3.36, o=6.18, zoom=1.00),
    dict(clip="IMG_3549", i=6.18, o=7.85, zoom=1.32, punch=True),
    dict(clip="IMG_3550", i=0.00, o=1.90, zoom=1.12, section="cta", snap="beat", anchor="Chelsea"),
    dict(clip="IMG_3551", i=1.89, o=5.62, zoom=1.00, push=1.07),
]
MIN_SECTION_PAUSE = 0.20   # shortest silence allowed before a beat-snapped section
END_TAIL = 1.9             # seconds after the final chord hits

# On-screen captions. "|" splits caption chunks; emoji ride on the chunk.
# Words are aligned in order to the ASR words of the same clip, so spelling
# fixes ("bomb" -> "mom") keep the recogniser's timing.
CAPTIONS = {
    "IMG_3540": "I can manage | a classroom full | of first graders, | but when it comes | to my three kids | in a Disney store 🛍️ | that is where | my skill ends. 😅",
    "IMG_3541": "Hi, I'm Chelsea! 👋 | a mom of three, | a teacher, 🍎 | and a Disney mom ✨",
    "IMG_3544": "The last few years | of work had been | pretty challenging, | and the one thing | that kept me going | and gave me | a little glimmer | of hope ✨ | was planning | a Disney vacation 🏰 | I look forward | to that time | with my family | so much 💖",
    "IMG_3546": "So I wanted | to create a space | that I could share | a little bit | of that happiness 😊",
    "IMG_3549": "Our family's | favorites ⭐ | tips for traveling | with littles 👶 | and the most | important questions | like... | where can I get | the best beignets? 🍩",
    "IMG_3550": "If that sounds like | your kind of thing,",
    "IMG_3551": "then welcome home | to Chelsea Packs | the Magic ✨",
}

# Name card: header words light up when these caption words are spoken.
NAME = "Chelsea"
NAME_TAGS = [("mom of 3", "three"), ("teacher", "teacher"), ("Disney mom", "Disney")]
LIST_HEADER = "What you'll find here"
BRAND_TOP, BRAND_SCRIPT, BRAND_BOTTOM = "welcome home to", "Chelsea", "PACKS THE MAGIC"
FOLLOW_CTA = "Follow for Disney family tips"

# Palette (RGB) pulled from the outfit: Minnie-bow red, white, warm gold.
RED = (224, 36, 58)
WHITE = (255, 255, 255)
INK = (22, 20, 24)
GOLD = (255, 206, 92)
GOLD_DEEP = (240, 164, 40)
