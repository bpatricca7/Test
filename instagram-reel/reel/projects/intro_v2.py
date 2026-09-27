"""Second cut: IMG_3567-3576 (handheld, closer, noisier room).

Same structure as intro_v1 - hook first, then the name card, the "what you'll
find here" list and the brand sign-off - adapted to the tighter framing: the
Minnie ears sit at the top edge, so the name card and list header live under
the chin instead of above the head, and zooms stay gentle. (Camera jitter
measured under 1 px on the background, so no stabilisation pass.)
"""

OUT_NAME = "chelsea-packs-the-magic-intro-v2"
DENOISE = True
DENOISE_ATTEN_DB = 40
TOP_HEADROOM = 0.0           # keep the ears in frame
PUNCH_HEADROOM = 0.15
CAPTION_TOP = 1250
CAP_Y = 1440
NAME_CARD = "lower"
NAME_Y, TAG_Y = 1372, 1515
LIST_HEADER_Y = 1318
HOOK_GAP_SAFE = True         # a bare bass pluck in the 'first|grade' pause read as a cough

SEGMENTS = [
    # hook: "I can manage a classroom full of first grade students ... that is where my skill set ends."
    dict(clip="IMG_3570", i=0.54, o=3.52, zoom=1.06, section="hook"),
    dict(clip="IMG_3570", i=3.52, o=6.61, zoom=1.12),
    dict(clip="IMG_3570", i=6.61, o=8.26, zoom=1.06),
    dict(clip="IMG_3570", i=8.66, o=10.62, zoom=1.20, punch=True, section="stop"),
    # "Hi, I'm Chelsea, mom of three, teacher and Disney lover."
    dict(clip="IMG_3567", i=0.00, o=4.45, zoom=1.06, push=1.10, section="groove", snap="beat"),
    # "I wanted to create a space where I could share some of our family's favorites, ..."
    dict(clip="IMG_3574", i=0.00, o=2.12, zoom=1.12, section="build", snap="eighth"),
    dict(clip="IMG_3574", i=2.12, o=3.48, zoom=1.06, section="list"),
    dict(clip="IMG_3574", i=3.99, o=5.70, zoom=1.12),
    dict(clip="IMG_3574", i=5.88, o=8.36, zoom=1.06),
    dict(clip="IMG_3574", i=8.42, o=10.75, zoom=1.20, punch=True),
    # "If that's your jam, then welcome home to Chelsea Packs the Magic."
    dict(clip="IMG_3576", i=0.00, o=1.24, zoom=1.12, section="cta", snap="beat", anchor="Chelsea"),
    dict(clip="IMG_3576", i=1.24, o=5.40, zoom=1.06, push=1.12),
]

CAPTIONS = {
    "IMG_3570": "I can manage | a classroom full of | first grade students | and when it comes | to taking my | three kids | to a Disney store 🛍️ | and then trying | to get them to leave, | that is where | my skill set ends. 😅",
    "IMG_3567": "Hi, I'm Chelsea! 👋 | mom of three, | teacher 🍎 | and Disney lover ✨",
    "IMG_3574": "I wanted | to create a space | where I could share | some of | our family's | favorites ⭐ | tips for traveling | with littles 👶 | and the very | most important | question of all... | where can I get | the best beignets? 🍩",
    "IMG_3576": "If that's your jam, | then welcome home | to Chelsea Packs | the Magic ✨",
}

NAME_CLIP, NAME_WORD = "IMG_3567", "Chelsea!"
NAME_TAGS = [("mom of 3", "mom"), ("teacher", "teacher"), ("Disney lover", "Disney")]

# Close-miked in a live room: pull the 250-400 Hz box out, lighter presence lift.
VOICE_EQ = [
    "equalizer=f=160:t=q:w=1.0:g=1.5",
    "equalizer=f=310:t=q:w=0.9:g=-4.5",
    "equalizer=f=3300:t=q:w=0.9:g=2",
    "equalizer=f=6500:t=q:w=1.0:g=2.5",
]
