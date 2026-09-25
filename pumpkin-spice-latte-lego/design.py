"""A pumpkin spice latte in LEGO bricks: a small display kit for selling.

Build with the shared kit:  ./build.sh

Rules for this kit:
  - only elements in Pick a Brick's Bestseller range that are still in current
    LEGO sets, so an order ships from the US warehouse in about a week
    (export_parts.py enforces this with "bestseller_only");
  - keep the part count and cost low.

Board 16 x 10 studs (12.8 x 8 cm). Grid: x to the right, z toward the back.
  mug      x 1..8, z 1..8 (handle out to x 10)
  pumpkin  x 12..14, z 1..3
  cinnamon sticks x 11..14, z 6..7
"""
from bricks import (Model, Offset, row, place_rect, FACE,
                    WHITE, TAN, RBROWN, GREEN, BRORANGE, NOUGAT)

MUG = WHITE
CREAM = WHITE
LATTE = NOUGAT
SPICE = RBROWN
PUMPKIN = BRORANGE
BOARD = TAN

PROJECT = dict(
    main_parts_label="Board, cinnamon sticks and leaves",
    model_name="pumpkin_spice_latte",
    pdf_name="Pumpkin_Spice_Latte_Instructions.pdf",
    title="Pumpkin Spice Latte",
    subtitle="A cosy autumn mug in LEGO&reg; bricks",
    cover_stats=("13 &times; 8 cm", "16 &times; 10 studs"),
    badge="Custom kit",
    fine_print=("A custom model built from genuine LEGO&reg; elements. It is not affiliated with, "
                "sponsored or endorsed by The LEGO Group. LEGO&reg; is a trademark of The LEGO "
                "Group."),
    about=("A white mug of pumpkin spice latte topped with whipped cream, a dusting of "
           "cinnamon and nutmeg and a cinnamon stick, on a wooden board with a little pumpkin, "
           "a bundle of cinnamon sticks and autumn leaves."),
    facts=[("Size", "16 &times; 10 studs (12.8 &times; 8 cm), 9 cm tall to the top of the "
                    "cinnamon stick"),
           ("Build time", "about 30 to 45 minutes")],
    organisation=["The board", "The mug", "The pumpkin",
                  "Cinnamon sticks and leaves"],
    organisation_note=("The mug and the pumpkin are built on their own and then set on the "
                       "board. Every section starts with a list of the parts it needs."),
    tips=["The mug's rounded corners are curved bricks. Each one has a stud at both ends; "
          "check which way it curves against the picture.",
          "The handle is two 2&times;3 bricks sticking out of the side, joined by 1&times;2 "
          "bricks. Build it with the walls, course by course.",
          "The white tiles around the top edge lock the walls together, so press them down "
          "firmly."],
    legend=("pumpkin.ldr", 2),
    sub_info={
        "mug.ldr": ("The mug",
                    "A white mug with rounded corners and a handle, filled with latte and "
                    "topped with whipped cream, spices and a cinnamon stick."),
        "pumpkin.ldr": ("The pumpkin", "A little orange pumpkin with a stem and a leaf."),
    },
    section_images={},
    section_image_default="cover_front_right",
    hero_views=[("cover_front_right", 26, 32), ("cover_front_left", 26, -32),
                ("cover_front", 12, 0), ("cover_high", 55, 20), ("back", 28, 150)],
    cover_view="cover_front_right",
    gallery=["cover_front", "cover_front_left", "cover_high", "back"],
    substitutions=[
        "<b>Board:</b> any colour of plates and tiles makes a different table top.",
        "<b>Hidden parts:</b> the core and the plates inside the mug can be any colour.",
        "<b>Mug colour:</b> the mug can be built in any colour that has the rounded corner "
        "brick (2&times;2 macaroni, design 85080)."],
    order_cap_note=("Every element in this kit was in the Bestseller range, which ships from "
                    "the US warehouse."),
    colour_rows=[("Tan", "Brick Yellow", "Tan"),
                 ("Medium Nougat", "Medium Nougat", "Medium Nougat"),
                 ("Orange", "Bright Orange", "Orange"),
                 ("Green", "Dark Green", "Green")],
    bestseller_only=True,
    batch_sizes=[10, 25],
)

BOARD_W, BOARD_D = 16, 10
MX, MZ = 1, 1                     # mug corner
PX, PZ = 12, 1                    # pumpkin corner
STICKS = (11, 6)                  # bundle of cinnamon sticks, x 11..14, z 6..7
LEAVES = [(10, 1, 0, BRORANGE), (15, 4, 90, BRORANGE), (10, 9, 180, BRORANGE),
          (15, 8, 270, GREEN), (0, 0, 45, BRORANGE)]
COURSES = (2, 5, 8, 11, 14)       # mug brick courses (the base plate is layer 1)


# --------------------------------------------------------------------------
# the mug (8 x 8 with rounded corners)
# --------------------------------------------------------------------------
def build_mug():
    mm = Model("mug.ldr", "Mug")
    m = Offset(mm, MX, MZ, 1)
    x0, z0 = MX, MZ
    x1, z1 = MX + 7, MZ + 7
    corners = [((x0, z0), FACE["left"]), ((x1 - 1, z0), 0),
               ((x0, z1 - 1), FACE["back"]), ((x1 - 1, z1 - 1), FACE["right"])]
    hx = x1 + 1                                   # handle columns x1 + 1 .. x1 + 2
    hz = z0 + 3                                   # handle rows hz .. hz + 1
    # base: plates under everything except the four rounded corners
    place_rect(m, "p", MUG, x0 + 1, z0, 6, 8, 1)
    row(m, "p", MUG, x0, z0 + 1, 6, 1, axis="z")
    row(m, "p", MUG, x1, z0 + 1, 6, 1, axis="z")
    m.step()
    for i, L in enumerate(COURSES):
        for (x, z), rot in corners:
            m.add("macaroni", MUG, x, z, L, rot=rot)
        row(m, "b", MUG, x0 + 2, z0, 4, L)                  # front
        row(m, "b", MUG, x0 + 2, z1, 4, L)                  # back
        row(m, "b", MUG, x0, z0 + 2, 4, L, axis="z")        # left
        if L in (COURSES[1], COURSES[-1]):                  # handle arms
            m.add("b1x1", MUG, x1, z0 + 2, L)
            m.add("b2x3", MUG, x1, hz, L)
            m.add("b1x1", MUG, x1, z0 + 5, L)
        else:
            row(m, "b", MUG, x1, z0 + 2, 4, L, axis="z")
            if COURSES[1] < L < COURSES[-1]:
                m.add("b1x2", MUG, hx + 1, hz, L, rot=90)   # outer side of the handle
        if L < COURSES[-1]:
            m.add("b2x2", MUG, x0 + 3, z0 + 3, L)           # core under the latte
        if L == COURSES[2]:
            m.add("t1x2", MUG, hx, hz, COURSES[1] + 3, rot=90)  # inside the handle
        m.step()

    # inside the top course: two plate layers hold the latte
    top = COURSES[-1]
    row(m, "p", MUG, x0 + 2, z0 + 1, 4, top)
    place_rect(m, "p", MUG, x0 + 1, z0 + 2, 6, 2, top)
    place_rect(m, "p", MUG, x0 + 1, z0 + 4, 6, 2, top)
    row(m, "p", MUG, x0 + 2, z0 + 6, 4, top)
    m.step()
    for x in range(x0 + 2, x0 + 6):
        row(m, "p", MUG, x, z0 + 1, 6, top + 1, axis="z")
    for x in (x0 + 1, x0 + 6):
        row(m, "p", MUG, x, z0 + 2, 4, top + 1, axis="z")
    m.step()

    # rim: tiles tie the walls together; the handle gets a rounded top
    rim = top + 3
    row(m, "t", MUG, x0 + 1, z0, 6, rim)
    row(m, "t", MUG, x0 + 1, z1, 6, rim)
    row(m, "t", MUG, x0, z0 + 1, 6, rim, axis="z")
    row(m, "t", MUG, x1, z0 + 1, 6, rim, axis="z")
    for z in (hz, hz + 1):
        m.add("curve2x1", MUG, hx, z, rim, rot=FACE["right"])
    m.step()

    # latte: a ring of foam tiles with a dusting of spice
    latte = top + 2
    ring = [(x, z) for x in range(x0 + 1, x1) for z in range(z0 + 1, z1)
            if not (x0 + 2 <= x <= x0 + 5 and z0 + 2 <= z <= z0 + 5)
            and (x, z) not in {(x0 + 1, z0 + 1), (x1 - 1, z0 + 1), (x0 + 1, z1 - 1), (x1 - 1, z1 - 1)}]
    dust = {(x0 + 1, z0 + 4), (x0 + 4, z0 + 1), (x1 - 1, z0 + 3), (x0 + 3, z1 - 1)}
    for (x, z) in ring:
        if (x, z) in dust:
            m.add("tile_round1", SPICE, x, z, latte)
        else:
            m.add("t1x1", LATTE, x, z, latte)
    m.step()
    # whipped cream: three round tiers, spices on the lowest, and a cinnamon stick
    m.add("round_p4", CREAM, x0 + 2, z0 + 2, latte)
    m.step()
    m.add("round_p2", CREAM, x0 + 3, z0 + 3, latte + 1)
    for (x, z), c in (((x0 + 2, z0 + 3), SPICE), ((x0 + 4, z0 + 5), BRORANGE),
                      ((x0 + 5, z0 + 3), SPICE), ((x0 + 3, z0 + 2), BRORANGE)):
        m.add("round_p1" if c == BRORANGE else "tile_round1", c, x, z, latte + 1)
    m.add("stick", SPICE, x0 + 5, z0 + 4, latte + 1)
    m.step()
    m.add("tile_round2", CREAM, x0 + 3, z0 + 3, latte + 2)
    m.step()
    mm.width, mm.depth = 10, 8
    return mm


# --------------------------------------------------------------------------
# the pumpkin (3 x 3)
# --------------------------------------------------------------------------
def build_pumpkin():
    m = Model("pumpkin.ldr", "Pumpkin")
    place_rect(m, "p", PUMPKIN, 0, 0, 2, 3, 0)
    m.add("p1x2", PUMPKIN, 2, 0, 0, rot=90)
    m.add("p1x1", PUMPKIN, 2, 2, 0)
    m.step()
    m.add("b2x2", PUMPKIN, 0, 0, 1)
    m.add("b1x2", PUMPKIN, 0, 2, 1)
    m.add("b1x2", PUMPKIN, 2, 0, 1, rot=90)
    m.add("b1x1", PUMPKIN, 2, 2, 1)
    m.step()
    place_rect(m, "p", PUMPKIN, 1, 0, 2, 3, 4)
    m.add("p1x2", PUMPKIN, 0, 0, 4, rot=90)
    m.add("p1x1", PUMPKIN, 0, 2, 4)
    m.step()
    # rounded top: slopes on the edges, quarter-round tiles on the corners
    m.add("cheese", PUMPKIN, 1, 0, 5, rot=FACE["front"])
    m.add("cheese", PUMPKIN, 1, 2, 5, rot=FACE["back"])
    m.add("cheese", PUMPKIN, 0, 1, 5, rot=FACE["left"])
    m.add("cheese", PUMPKIN, 2, 1, 5, rot=FACE["right"])
    for (x, z), rot in (((0, 0), QUARTER["front-left"]), ((2, 0), QUARTER["front-right"]),
                        ((0, 2), QUARTER["back-left"]), ((2, 2), QUARTER["back-right"])):
        m.add("tile_quarter", PUMPKIN, x, z, 5, rot=rot)
    m.step()
    m.add("round_p1", RBROWN, 1, 1, 5)
    m.add("leaves1", GREEN, 1, 1, 6, rot=135)
    m.step()
    m.width, m.depth = 3, 3
    return m


# rotation that puts the rounded edge of a quarter-round tile on each corner
QUARTER = {"front-right": 0, "front-left": 90, "back-left": 180, "back-right": 270}


# --------------------------------------------------------------------------
# main model: the board and everything on it
# --------------------------------------------------------------------------
def build_main(mug, pumpkin):
    m = Model("pumpkin_spice_latte.ldr", "Pumpkin spice latte")
    m.header_notes = ["Custom kit built from LEGO elements; generated by design.py (lego-kit)."]
    m.section("The board", "One big plate and two long ones make the board, and tiles make the "
              "planks. Leave the gaps open: the mug, the pumpkin, the cinnamon sticks and the "
              "leaves go there.")
    place_rect(m, "p", BOARD, 0, 0, 16, 8, 0)
    place_rect(m, "p", BOARD, 0, 8, 8, 2, 0)
    place_rect(m, "p", BOARD, 8, 8, 8, 2, 0)
    m.step()
    used = {(x, z) for x in range(MX, MX + 8) for z in range(MZ, MZ + 8)}
    used -= {(MX, MZ), (MX + 7, MZ), (MX, MZ + 7), (MX + 7, MZ + 7)}   # tiles by the corners
    used |= {(x, z) for x in range(PX, PX + 3) for z in range(PZ, PZ + 3)}
    sx, sz = STICKS
    used |= {(x, z) for x in range(sx, sx + 4) for z in (sz, sz + 1)}
    used |= {(x, z) for x, z, _, _ in LEAVES}
    # planks: the front and back edges run along the board; the rest run front to
    # back, so they tie the two long plates to the big one
    edge = {(x, z) for x in range(BOARD_W) for z in (0, BOARD_D - 1)}
    edge |= {(x, 8) for x in range(sx, sx + 4)}
    for z in range(BOARD_D):
        xs = [x for x in range(BOARD_W) if (x, z) in edge and (x, z) not in used]
        for x0, n in _runs(xs):
            row(m, "t", BOARD, x0, z, n, 1, avoid={8 - x0})
    for x in range(BOARD_W):
        zs = [z for z in range(BOARD_D) if (x, z) not in used | edge]
        for z0, n in _runs(zs):
            row(m, "t", BOARD, x, z0, n, 1, axis="z", avoid={8 - z0})
    m.step()

    m.sub(mug, MX, MZ, 1)
    m.step()
    m.sub(pumpkin, PX, PZ, 1)
    m.step()

    m.section("Cinnamon sticks and leaves", "A bundle of cinnamon sticks and a few leaves "
              "finish the scene.")
    m.add("log1x4", SPICE, sx, sz, 1)
    m.add("log1x4", SPICE, sx, sz + 1, 1)
    m.step()
    m.add("log1x4", SPICE, sx, sz, 4)
    m.step()
    # each leaf sits on a tan plate, so it spreads out over the tiles around it
    for x, z, _, _ in LEAVES:
        m.add("p1x1", BOARD, x, z, 1)
    m.step()
    for x, z, rot, colour in LEAVES:
        m.add("leaves1", colour, x, z, 2, rot=rot)
    m.step()
    return m


def _runs(xs):
    out = []
    for x in sorted(xs):
        if out and out[-1][0] + out[-1][1] == x:
            out[-1] = (out[-1][0], out[-1][1] + 1)
        else:
            out.append((x, 1))
    return out


def build():
    mug, pumpkin = build_mug(), build_pumpkin()
    main_m = build_main(mug, pumpkin)
    return main_m, [main_m, mug, pumpkin]
