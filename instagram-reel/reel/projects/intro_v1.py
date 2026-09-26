"""First cut: IMG_3540-3551 (tripod, quiet room)."""

OUT_NAME = "chelsea-packs-the-magic-intro"
FACE_MODE = "clip"
CHIN_PX = 170

# Each segment: clip, in, out (seconds in the source clip), zoom (1.0 = full frame), plus:
#   section - this segment opens a musical section
#   snap    - "beat"/"eighth": stretch the pause before it so its first word lands on the grid
#   anchor  - snap this word (possibly in a later segment) instead of the first word
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

# "|" splits caption chunks; emoji ride on the chunk. Words are aligned in order
# to the ASR words of the same clip, so spelling fixes keep the recogniser's timing.
CAPTIONS = {
    "IMG_3540": "I can manage | a classroom full | of first graders, | but when it comes | to my three kids | in a Disney store 🛍️ | that is where | my skill ends. 😅",
    "IMG_3541": "Hi, I'm Chelsea! 👋 | a mom of three, | a teacher, 🍎 | and a Disney mom ✨",
    "IMG_3544": "The last few years | of work had been | pretty challenging, | and the one thing | that kept me going | and gave me | a little glimmer | of hope ✨ | was planning | a Disney vacation 🏰 | I look forward | to that time | with my family | so much 💖",
    "IMG_3546": "So I wanted | to create a space | that I could share | a little bit | of that happiness 😊",
    "IMG_3549": "Our family's | favorites ⭐ | tips for traveling | with littles 👶 | and the most | important questions | like... | where can I get | the best beignets? 🍩",
    "IMG_3550": "If that sounds like | your kind of thing,",
    "IMG_3551": "then welcome home | to Chelsea Packs | the Magic ✨",
}

NAME_CLIP, NAME_WORD = "IMG_3541", "Chelsea!"
NAME_TAGS = [("mom of 3", "three,"), ("teacher", "teacher,"), ("Disney mom", "Disney")]

VOICE_EQ = [
    "afftdn=nr=10:nf=-58:tn=1",
    "equalizer=f=190:t=q:w=0.9:g=-1.5",
    "equalizer=f=3300:t=q:w=0.9:g=3.5",
    "equalizer=f=6500:t=q:w=1.0:g=3",
]
