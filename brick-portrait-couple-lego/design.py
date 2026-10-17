"""Brick Portrait: Couple. Two brick-built portrait figures side by side on a white base.

Build with the shared kit:  ./build.sh

Designed from a photo of two custom portrait figures: on the left a woman with
wavy reddish-brown shoulder-length hair, a black top with a white V-neck, dark red
trousers and black shoes with white toes; on the right a man with spiky black hair
and a black beard, a navy blazer over a pink shirt and magenta tie, tan trousers
and reddish-brown shoes. Both are made by ../lego-kit/portrait.py from a few
options each (OPTIONS below); a custom order changes those lines.

Base 22 x 12 studs (17.6 x 9.6 cm). Grid (studs): x to the right, z toward the
back; layers are plates (the base plates are layer 0, its tiles layer 1).
  woman   figure origin x 2, z 6: head x 1-8 (hair flicks to x 0 and 9), shoes z 6-8
  man     figure origin x 13, z 6: head x 12-19 (side spikes to x 11 and 20)
  hearts  a red tile heart at x 5-9, z 1-5 and a pink one at x 11-15, z 0-4
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "lego-kit"))
import portrait as pt  # noqa: E402
from bricks import Model  # noqa: E402

OPTIONS = {
    "WOMAN": dict(skin=pt.LNOUGAT, hair="wavy", hair_colour=pt.RBROWN,
                  top="vneck", top_colour=pt.BLACK, accent=pt.WHITE,
                  bottoms="trousers", bottoms_colour=pt.DKRED, shoes=pt.BLACK, toe=pt.WHITE),
    "MAN": dict(skin=pt.LNOUGAT, hair="spiky", hair_colour=pt.BLACK, beard=True,
                top="shirt_tie", top_colour=pt.DKBLUE, shirt=pt.BPINK, tie=pt.MAGENTA,
                bottoms="trousers", bottoms_colour=pt.TAN, shoes=pt.RBROWN),
}
WOMAN = pt.Figure("woman", "The woman", **OPTIONS["WOMAN"])
MAN = pt.Figure("man", "The man", **OPTIONS["MAN"])

BASE_W, BASE_D = 22, 12
AT = {"woman": (2, 6), "man": (13, 6)}
HEARTS = [(5, 1, pt.RED), (11, 0, pt.BPINK)]
TALL = max(WOMAN.height_cm(), MAN.height_cm())

PROJECT = dict(
    main_parts_label="Display base and shoulders",
    model_name="brick_portrait_couple",
    pdf_name="Brick_Portrait_Couple_Instructions.pdf",
    title="Brick Portrait: Couple",
    subtitle="Two brick-built portrait figures on a white display base, in LEGO&reg; bricks",
    cover_stats=(f"{TALL:.0f} cm", "tall"),
    badge="Unofficial fan design",
    fine_print=("An unofficial fan-designed model (MOC). It is not affiliated with, sponsored or "
                "endorsed by The LEGO Group. LEGO&reg; is a trademark of The LEGO Group. A "
                "portrait figure is a likeness made with its subject's permission."),
    about=("Two brick-built portrait figures of a couple, side by side on a white display base: "
           "big near-cube heads with tiled faces and brick-built hair, short necks, blocky "
           "torsos with the outfits in tiles, arms with hands, legs and shoes. On the left, the "
           "woman, with wavy reddish-brown hair to her shoulders, a black top with a white "
           "V-neck, dark red trousers and black shoes with white toe caps. On the right, the "
           "man, with spiky black hair and a black beard, a navy blazer over a pink shirt and "
           "magenta tie, tan trousers and reddish-brown shoes. A red and a pink heart are set "
           "into the base."),
    facts=[("Size", f"22 &times; 12-stud base (17.6 &times; 9.6 cm); the figures are "
                    f"{WOMAN.height_cm():.0f} and {MAN.height_cm():.0f} cm tall"),
           ("Figures", "two, each 8 studs wide with a 6 &times; 6-stud tiled face"),
           ("Build time", "about 2 hours")],
    organisation=["The display base, with its two tile hearts",
                  "The woman: shoes and legs, torso, arms, shoulders, head and hair",
                  "The man: shoes and legs, torso, arms, shoulders, head and hair"],
    organisation_note=("Each figure is built from the feet up. Its torso, head and hair are "
                       "built on their own and then set in place; the shoes, legs and arms are "
                       "small modules you build twice. Every section starts with a list of the "
                       "parts it needs."),
    tips=["The faces and the torso fronts are built on side studs: plates press onto the studs "
          "on the front of the side-stud bricks, and tiles go on the plates. Press each plate "
          "on firmly before you add its tiles.",
          "Quarter-round tiles make the curves of the brows, the smile, the beard, the V-neck "
          "and the tie. Turn each one the way the picture shows.",
          "A <b>&ldquo;Build 2&rdquo;</b> badge means you build that module twice: the shoes, "
          "the legs and the arms.",
          "The hair is built on its own and goes on last. Hold it level over the head and press "
          "it down evenly: it sits on the front of the head, the inner post and the floor "
          "plate (and, for the woman, on her shoulders)."],
    legend=("woman_torso.ldr", 1),
    sub_info=WOMAN.sub_info() | MAN.sub_info(),
    section_images={"The display base": "cover_high", "The woman": "cover_front_left",
                    "The man": "cover_front_right"},
    section_image_default="cover_front_right",
    hero_views=[("cover_front_right", 18, 30), ("cover_front_left", 18, -30),
                ("cover_front", 6, 0), ("cover_high", 45, 20), ("back", 20, 150)],
    cover_view="cover_front_right",
    gallery=["cover_front", "cover_front_left", "cover_high", "back"],
    substitutions=[
        "<b>Hidden parts:</b> the side-stud bricks behind the faces and torso fronts, the "
        "inner post of each head and the plates under the face tiles can be any colour.",
        "<b>Base:</b> any white plates that cover 22 &times; 12 studs, tiled except under the "
        "shoes.",
        "<b>Faces:</b> an optional printed face sticker (48 &times; 48 mm) can go over the "
        "tiled face; it is not a LEGO part."],
    order_cap_note=("Every element in this kit is on Pick a Brick's Bestseller list, which "
                    "sells up to 999 of an element per order."),
    colour_rows=pt.colour_rows(WOMAN.colours() | MAN.colours() | {pt.WHITE, pt.RED, pt.BPINK}),
    bestseller_only=True,
    batch_sizes=[10, 25],
)


def build():
    m = Model("brick_portrait_couple.ldr", "Brick Portrait: Couple")
    m.header_notes = ["Brick portrait figures, generated by design.py (lego-kit/portrait.py)."]
    m.section("The display base", "White plates, then white tiles with a red and a pink heart. "
              "The shoes stand on the bare studs.")
    keep = WOMAN.footprint(*AT["woman"]) | MAN.footprint(*AT["man"])
    pt.display_base(m, BASE_W, BASE_D, keep, hearts=HEARTS)
    WOMAN.place(m, *AT["woman"], 1)
    MAN.place(m, *AT["man"], 1)
    probs = pt.check_snot(m)
    if probs:
        raise SystemExit("side-stud collisions:\n  " + "\n  ".join(probs[:20]))
    return m, [m] + WOMAN.models + MAN.models
