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
    return dict(
        figures=[(design.WOMAN, "WOMAN", "on the left in the photo"),
                 (design.MAN, "MAN", "on the right")],
        calls={k: pt.options_text(v) for k, v in design.OPTIONS.items()},
        intro=("A buildable LEGO kit of two brick-built portrait figures, a couple side by side "
               "on a white display base, designed from a photo of two custom portrait figures. "
               "Each figure is chunky and about 16–18 cm tall: a big near-cube head with a flat "
               "tiled face and brick-built hair, a short neck, a blocky torso with the outfit "
               "in tiles, arms down at the sides ending in hands, two legs and shoes."),
        base=("A white base of 22 × 12 studs (17.6 × 9.6 cm), tiled, with a red and a pink "
              "tile heart at the front."),
        notes=["**The woman's hair** comes down to her shoulders. It flicks out at the temples "
               "(an inverted slope under a slope) and at the ends, and its sides rest on the "
               "shoulder plates.",
               "**The man's hair** is short: jagged rows of 45° and 65° slopes over a raised "
               "crest, spikes out at the sides above the temples. His beard is in the face "
               "mosaic, and the sides of his head are black.",
               "**Torso fronts:** the woman's black top has its white V-neck in white tiles with "
               "black quarter-round tiles along the edges. The man's navy blazer is open over "
               "two strips of pink shirt; his magenta tie has a rounded knot and tip.",
               "**Joints:** the legs and shoes are 2 × 2 stacks. The hip plates run across both "
               "legs and out under the arms, the shoulder plates lock the arms at the top, and "
               "the head sits on a 2 × 2 neck. Inside the head, a post of 2 × 2 bricks holds "
               "the middle of the hair."],
        box="16 × 12 × 6 cm (the longest part, a 6 × 12 base plate, is under 10 cm)",
    )


if __name__ == "__main__":
    proj = projects.Project(HERE)
    proj.build(verbose=False, write=False)
    pt.extra_images(proj)
    pt.write_readme(proj, kit(proj.mod))
