"""Third cut: intro_v2 with the "I wanted to create a space..." line swapped
for the tighter retake IMG_3583 (drops "some of" and "very"). Everything else -
hook, name card, sign-off, look, sound - is intro_v2.
"""
from projects.intro_v2 import *  # noqa: F401,F403

OUT_NAME = "chelsea-packs-the-magic-intro-v3"

SEGMENTS = [
    # hook: "I can manage a classroom full of first grade students ... that is where my skill set ends."
    dict(clip="IMG_3570", i=0.54, o=2.14, zoom=1.06, section="hook"),
    # cut 2.14-2.32: the throaty breath/cough between "full of" and "first"
    dict(clip="IMG_3570", i=2.32, o=6.61, zoom=1.12),
    dict(clip="IMG_3570", i=6.61, o=8.26, zoom=1.06),
    dict(clip="IMG_3570", i=8.66, o=10.62, zoom=1.20, punch=True, section="stop"),
    # "Hi, I'm Chelsea, mom of three, teacher and Disney lover."
    dict(clip="IMG_3567", i=0.00, o=4.45, zoom=1.06, push=1.10, section="groove", snap="eighth"),
    # "I wanted to create a space where I could share our family's favorites, ..."  (retake)
    dict(clip="IMG_3583", i=0.00, o=1.90, zoom=1.12, section="build", snap="eighth"),
    dict(clip="IMG_3583", i=1.90, o=3.22, zoom=1.06, section="list"),
    dict(clip="IMG_3583", i=3.63, o=5.22, zoom=1.12),
    dict(clip="IMG_3583", i=5.22, o=7.14, zoom=1.06),
    dict(clip="IMG_3583", i=7.28, o=9.20, zoom=1.20, punch=True),
    # "If that's your jam, then welcome home to Chelsea Packs the Magic."
    dict(clip="IMG_3576", i=0.00, o=1.24, zoom=1.12, section="cta", snap="beat", anchor="Chelsea",
         min_pause=0.6),   # let the beignets line land (and leave room for the ta-da)
    dict(clip="IMG_3576", i=1.24, o=5.40, zoom=1.06, push=1.12),
]

# silence non-speech mouth sounds in the dialogue (clip, from, to) - 4 ms fades either side
MUTE = [
    ("IMG_3570", 3.566, 3.596),   # sharp throat click right before "and when it comes"
]

CAPTIONS = {
    "IMG_3570": CAPTIONS["IMG_3570"],  # noqa: F405
    "IMG_3567": CAPTIONS["IMG_3567"],  # noqa: F405
    "IMG_3583": "I wanted | to create a space | where I could share | our family's | favorites ⭐ | tips for traveling | with littles 👶 | and the most | important question | of all... | where can I get | the best beignets? 🍩",
    "IMG_3576": CAPTIONS["IMG_3576"],  # noqa: F405
}
