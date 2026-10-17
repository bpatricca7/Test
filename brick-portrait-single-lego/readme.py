"""Write this kit's README.md (and two extra README images) from the build outputs.

    python3 readme.py

Run it last in build.sh. The text is shared by the portrait kits
(../lego-kit/portrait.py, write_readme); the numbers come from the build: the
parts files, data/elements.csv (live Pick a Brick prices), checks.md and the
booklet, through kit_readme.kit_stats() and pricing.py.
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "lego-kit"))
import project as projects  # noqa: E402
import portrait as pt  # noqa: E402


def kit(design):
    w, r = design.FRAME.photo_area
    return dict(
        figures=[(design.FIGURE, "FIGURE", "the woman in the photo")],
        calls={k: pt.options_text(v) for k, v in design.OPTIONS.items()},
        intro=("A buildable LEGO kit of one brick-built portrait figure beside a small photo "
               "frame, designed from a photo of a custom portrait figure. The figure is chunky "
               "and about 16 cm tall: a big near-cube head with a flat tiled face and "
               "brick-built hair, a short neck, a blocky torso with the outfit in tiles, arms "
               "down at the sides ending in hands, and a skirt down to the shoes."),
        base=("A white base of 20 × 10 studs (16 × 8 cm), tiled, with a white photo frame on a "
              "tan easel beside the figure."),
        extra=("The photo frame",
               [f"A white frame of 1 × 2 bricks round a flat area of light grey tiles, "
                f"{w} × {r} studs ({w * 0.8:.1f} cm square), facing forward on side-stud "
                "bricks. It stands on two tan easel legs, with the head of the easel on top, "
                "and its top is about level with the figure's chin.",
                f"The flat area takes a printed photo: a {w * 8} × {r * 8} mm print on sticker "
                "paper, an optional extra that the seller makes (for example the customer's "
                "photo the figure was made from). It isn't a LEGO part and isn't in the parts "
                "lists or the cost. Without it the frame shows its grey tiles."]),
        extra_models=["frame.ldr"],
        notes=["**The hair** is long and straight, two studs thick at the sides. It comes down "
               "to the shoulders and rests on them, the tan tops of the arms carry it on past "
               "the shoulders, and the face's top row of tiles makes a parted fringe.",
               "**The dress:** the red front panel has a skin-coloured V-neck (Light Nougat "
               "plates showing round red quarter-round tiles). The skirt is a 6 × 4 block of red "
               "bricks standing on the two shoes, with a red tile belt in front; the arms are "
               "bare.",
               "**Joints:** the skirt's bottom plate ties the two shoes, the hip plates run "
               "across the skirt and out under the arms, the shoulder plates lock the arms at "
               "the top, and the head sits on a 2 × 2 neck. Inside the head, a post of 2 × 2 "
               "bricks holds the middle of the hair.",
               "**The frame** stands on its two legs on the base's studs; build it on the base "
               "or on its own and then press it on."],
        box="16 × 10 × 6 cm (the longest part, a 6 × 10 base plate, is 8 cm)",
    )


if __name__ == "__main__":
    proj = projects.Project(HERE)
    proj.build(verbose=False, write=False)
    pt.extra_images(proj)
    pt.write_readme(proj, kit(proj.mod))
