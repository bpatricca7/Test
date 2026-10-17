"""Brick Portrait: Single. One brick-built portrait figure beside a small photo frame.

Build with the shared kit:  ./build.sh

Designed from a photo of a custom portrait figure: a woman with long blonde hair
falling past her shoulders, a red V-neck dress with bare arms and dark shoes, on
a white base beside a small white photo frame on a tan easel. The figure is
made by ../lego-kit/portrait.py from a few options (OPTIONS below); the frame
holds a flat tiled area for an optional printed photo (not a LEGO part).

Base 20 x 10 studs (16 x 8 cm). Grid (studs): x to the right, z toward the back;
layers are plates (the base plates are layer 0, its tiles layer 1).
  figure  origin x 2, z 4: head x 1-8, the hair two studs thick out to x 0 and 9
  frame   x 11-18, z 4-5: two easel legs, a white frame round a 6 x 6-stud
          photo area (4.8 cm square) and the easel's head on top
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "lego-kit"))
import portrait as pt  # noqa: E402
from bricks import Model  # noqa: E402

OPTIONS = {
    "FIGURE": dict(skin=pt.LNOUGAT, hair="long", hair_colour=pt.TAN,
                   top="dress", top_colour=pt.RED,
                   bottoms="skirt", bottoms_colour=pt.RED, shoes=pt.BLACK),
}
FIGURE = pt.Figure("her", "The figure", **OPTIONS["FIGURE"])
FRAME = pt.photo_frame("frame.ldr", x=0, z=0, layer=0)

BASE_W, BASE_D = 20, 10
AT = (2, 4)
FRAME_AT = (11, 4)

PROJECT = dict(
    main_parts_label="Display base and shoulders",
    model_name="brick_portrait_single",
    pdf_name="Brick_Portrait_Single_Instructions.pdf",
    title="Brick Portrait: Single",
    subtitle="A brick-built portrait figure with a photo frame on an easel, in LEGO&reg; bricks",
    cover_stats=(f"{FIGURE.height_cm():.0f} cm", "tall"),
    badge="Unofficial fan design",
    fine_print=("An unofficial fan-designed model (MOC). It is not affiliated with, sponsored or "
                "endorsed by The LEGO Group. LEGO&reg; is a trademark of The LEGO Group. A "
                "portrait figure is a likeness made with its subject's permission."),
    about=("A brick-built portrait figure beside a small photo frame on a white display base: "
           "a big near-cube head with a tiled face and long blonde hair falling past the "
           "shoulders, a red V-neck dress with bare arms, and black shoes. Beside her, a white "
           "frame on a tan easel holds a flat tiled area, 4.8 cm square, for a printed photo "
           "(an optional extra, not a LEGO part)."),
    facts=[("Size", f"20 &times; 10-stud base (16 &times; 8 cm); the figure is "
                    f"{FIGURE.height_cm():.0f} cm tall"),
           ("Figure", "8 studs wide, the hair 10, with a 6 &times; 6-stud tiled face"),
           ("Build time", "about 1&frac12; hours")],
    organisation=["The display base",
                  "The figure: shoes, skirt, torso, arms, shoulders, head and hair",
                  "The photo frame on its easel"],
    organisation_note=("The figure is built from the feet up. Its skirt, torso, head and hair "
                       "are built on their own and then set in place; the shoes and arms are "
                       "small modules you build twice. Every section starts with a list of the "
                       "parts it needs."),
    tips=["The face, the dress front and the photo area are built on side studs: plates press "
          "onto the studs on the front of the side-stud bricks, and tiles go on the plates. "
          "Press each plate on firmly before you add its tiles.",
          "Quarter-round tiles make the curves of the brows, the smile, the hairline and the "
          "V-neck. Turn each one the way the picture shows.",
          "A <b>&ldquo;Build 2&rdquo;</b> badge means you build that module twice: the shoes "
          "and the arms.",
          "The hair is built on its own and goes on last. Hold it level over the head and press "
          "it down evenly: it sits on the front of the head, the inner post and the shoulders."],
    legend=("her_torso.ldr", 1),
    sub_info=FIGURE.sub_info() | {
        "frame.ldr": ("The photo frame",
                      "Two tan easel legs, the white frame with its flat light grey photo area "
                      "on side studs, and the head of the easel on top.")},
    section_images={"The display base": "cover_high", "The photo frame": "cover_front"},
    section_image_default="cover_front_right",
    hero_views=[("cover_front_right", 18, 30), ("cover_front_left", 18, -30),
                ("cover_front", 6, 0), ("cover_high", 45, 20), ("back", 20, 150)],
    cover_view="cover_front_right",
    gallery=["cover_front", "cover_front_left", "cover_high", "back"],
    substitutions=[
        "<b>Hidden parts:</b> the side-stud bricks behind the face, the dress front and the "
        "photo area, the inner post of the head and the plates under the tiles can be any "
        "colour.",
        "<b>Base:</b> any white plates that cover 20 &times; 10 studs, tiled except under the "
        "shoes and the easel legs.",
        "<b>Extras:</b> an optional printed face sticker (48 &times; 48 mm) and a photo print "
        "(48 &times; 48 mm) for the frame; neither is a LEGO part."],
    order_cap_note=("Every element in this kit is on Pick a Brick's Bestseller list, which "
                    "sells up to 999 of an element per order."),
    colour_rows=pt.colour_rows(FIGURE.colours() | pt.model_colours([FRAME]) | {pt.WHITE}),
    bestseller_only=True,
    batch_sizes=[10, 25],
)


def build():
    m = Model("brick_portrait_single.ldr", "Brick Portrait: Single")
    m.header_notes = ["Brick portrait figure, generated by design.py (lego-kit/portrait.py)."]
    m.section("The display base", "White plates, then white tiles. The shoes and the easel legs "
              "stand on the bare studs.")
    fx, fz = FRAME_AT
    keep = FIGURE.footprint(*AT) | {(fx + x, fz + z) for x in (0, 7) for z in (0, 1)}
    pt.display_base(m, BASE_W, BASE_D, keep)
    FIGURE.place(m, *AT, 1)
    m.section("The photo frame", "A white frame round a flat area for a printed photo, on a "
              "tan easel.")
    m.sub(FRAME, fx, fz, 1)
    m.step()
    probs = pt.check_snot(m)
    if probs:
        raise SystemExit("side-stud collisions:\n  " + "\n  ".join(probs[:20]))
    return m, [m] + FIGURE.models + [FRAME]
