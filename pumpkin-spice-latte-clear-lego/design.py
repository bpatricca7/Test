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
                    WHITE, TAN, DTAN, RBROWN, GREEN, BRORANGE, TCLEAR)

GLASS = TCLEAR
CREAM = WHITE
DRINK = DTAN                      # latte seen through the glass
FOAM = TAN                        # the lighter foam at the top
SPICE = RBROWN
PUMPKIN = BRORANGE
BOARD = TAN

PROJECT = dict(
    main_parts_label="Board, cinnamon sticks and leaves",
    model_name="pumpkin_spice_latte_clear",
    pdf_name="Pumpkin_Spice_Latte_Clear_Mug_Instructions.pdf",
    title="Pumpkin Spice Latte",
    subtitle="The clear glass mug edition, in LEGO&reg; bricks",
    cover_stats=("13 &times; 8 cm", "16 &times; 10 studs"),
    badge="Custom kit",
    fine_print=("A custom model built from genuine LEGO&reg; elements. It is not affiliated with, "
                "sponsored or endorsed by The LEGO Group. LEGO&reg; is a trademark of The LEGO "
                "Group."),
    about=("A clear glass mug of pumpkin spice latte, with the latte and its foam showing "
           "through the glass, topped with whipped cream, a dusting of cinnamon and nutmeg and "
           "a cinnamon stick. It stands on a wooden board with a little pumpkin, a bundle of "
           "cinnamon sticks and autumn leaves."),
    facts=[("Size", "16 &times; 10 studs (12.8 &times; 8 cm), 9 cm tall to the top of the "
                    "cinnamon stick"),
           ("Build time", "about 30 to 45 minutes")],
    organisation=["The board", "The glass mug", "The pumpkin",
                  "Cinnamon sticks and leaves"],
    organisation_note=("The mug and the pumpkin are built on their own and then set on the "
                       "board. Every section starts with a list of the parts it needs."),
    tips=["The latte inside the mug is built first, course by course, with a clear round "
          "brick at each corner. The four clear panels then slide in around it.",
          "Each clear panel has a flat side and an open side. Put the flat side on the "
          "outside of the mug, as in the pictures.",
          "The clear plates around the rim lock the corners to the panels, so press them "
          "down firmly before adding the tiles."],
    legend=("pumpkin.ldr", 2),
    sub_info={
        "mug.ldr": ("The glass mug",
                    "A clear glass mug with a handle. The latte and its foam show through the "
                    "glass; whipped cream, spices and a cinnamon stick go on top."),
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
        "<b>Drink colour:</b> the bricks inside the mug show through the glass: dark tan and "
        "tan make a latte, reddish brown makes a black coffee.",
        "<b>Handle:</b> each clear 1&times;2 brick in the handle can be swapped for two clear "
        "1&times;1 round bricks."],
    order_cap_note=("Every element in this kit was in the Bestseller range, which ships from "
                    "the US warehouse."),
    colour_rows=[("Trans-Clear", "Transparent", "Trans-Clear"),
                 ("Tan", "Brick Yellow", "Tan"),
                 ("Dark Tan", "Sand Yellow", "Dark Tan"),
                 ("Orange", "Bright Orange", "Orange"),
                 ("Green", "Dark Green", "Green")],
    bestseller_only=True,
    clear_alpha=48,                   # draw the clear glass more see-through in renders
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
# the clear glass mug (8 x 8, with the latte showing through)
# --------------------------------------------------------------------------
# Clear panels face out with these rotations (the flat side of a 1 x 6 x 5
# panel is at the back at rotation 0).
PANEL_OUT = {"front": 180, "back": 0, "right": 90, "left": 270}


def _pinwheel(m, colour, ix, iz, layer, mirror):
    """Fill 6 x 6 studs with four 2 x 4 bricks around a 2 x 2."""
    if not mirror:
        rects = [(ix, iz, 4, 2), (ix + 4, iz, 2, 4), (ix + 2, iz + 4, 4, 2), (ix, iz + 2, 2, 4)]
    else:
        rects = [(ix, iz, 2, 4), (ix + 2, iz, 4, 2), (ix + 4, iz + 2, 2, 4), (ix, iz + 4, 4, 2)]
    for x, z, sx, sz in rects:
        place_rect(m, "b", colour, x, z, sx, sz, layer)
    m.add("b2x2", colour, ix + 2, iz + 2, layer)


def build_mug():
    mm = Model("mug.ldr", "Glass mug")
    m = Offset(mm, MX, MZ, 1)
    x0, z0 = MX, MZ
    x1, z1 = MX + 7, MZ + 7
    ix, iz = x0 + 1, z0 + 1                       # the drink: 6 x 6 inside the glass
    hz = z0 + 3                                   # handle rows hz .. hz + 1
    base, top = 1, 17                             # panels stand on layers 2 .. 16

    m.step("The base is the same colour as the board, so the glass seems to stand on it.")
    m.add("p8x8", BOARD, x0, z0, base)
    m.step()
    # the drink rises course by course; the top course is the lighter foam
    for i, L in enumerate(COURSES):
        _pinwheel(m, FOAM if L == COURSES[-1] else DRINK, ix, iz, L, i % 2)
        for x, z in ((x0, z0), (x1, z0), (x0, z1), (x1, z1)):
            m.add("round1", GLASS, x, z, L)
        m.step()
    # four clear panels make the sides
    m.add("panel1x6x5", GLASS, x0 + 1, z0, 2, rot=PANEL_OUT["front"])
    m.add("panel1x6x5", GLASS, x0 + 1, z1, 2, rot=PANEL_OUT["back"])
    m.step()
    m.add("panel1x6x5", GLASS, x0, z0 + 1, 2, rot=PANEL_OUT["left"])
    m.add("panel1x6x5", GLASS, x1, z0 + 1, 2, rot=PANEL_OUT["right"])
    m.step()

    # rim: clear plates lock each corner to a panel; the handle hangs from two of them
    for x in range(x0, x1, 2):
        m.add("p1x2", GLASS, x, z0, top)
        m.add("p1x2", GLASS, x, z1, top)
    for z in (z0 + 1, z0 + 3, z0 + 5):
        m.add("p1x2", GLASS, x0, z, top, rot=90)
    for z in (z0 + 1, z0 + 5):
        m.add("p1x2", GLASS, x1, z, top, rot=90)
    for z in (hz, hz + 1):
        m.add("p1x2", GLASS, x1, z, top)
    m.step()
    # latte surface: foam with a dusting of cinnamon around the cream
    dust = {(ix, iz + 3), (ix + 3, iz), (ix + 5, iz + 2), (ix + 2, iz + 5)}
    for x, z in dust:
        m.add("tile_round1", SPICE, x, z, top)
    for z in (iz, iz + 5):
        xs = [x for x in range(ix, ix + 6) if (x, z) not in dust]
        for xa, n in _runs(xs):
            row(m, "t", FOAM, xa, z, n, top)
    for x in (ix, ix + 5):
        zs = [z for z in range(iz + 1, iz + 5) if (x, z) not in dust]
        for za, n in _runs(zs):
            row(m, "t", FOAM, x, za, n, top, axis="z")
    m.step()
    # handle: a C of clear bricks and plates hanging from the rim
    for z in (hz, hz + 1):
        m.add("p1x2", GLASS, x1 + 1, z, top - 1)
    m.step()
    m.step("Hold the handle from below while you press the bottom plates on.")
    for L in (top - 4, top - 7, top - 10, top - 13):
        m.add("b1x2_open", GLASS, x1 + 2, hz, L, rot=90)
    for z in (hz, hz + 1):
        m.add("p1x2", GLASS, x1 + 1, z, top - 14)
    m.step()
    for z in (hz, hz + 1):
        m.add("t1x1", GLASS, x1 + 1, z, top - 13)
        m.add("t1x1", GLASS, x1 + 2, z, top)
    m.step()
    rim = [(x, z) for x in range(x0, x1 + 1) for z in range(z0, z1 + 1)
           if x in (x0, x1) or z in (z0, z1)] + [(x1 + 1, hz), (x1 + 1, hz + 1)]
    for x, z in rim:
        m.add("t1x1", GLASS, x, z, top + 1)
    m.step()

    # whipped cream: three round tiers, spices on the lowest, and a cinnamon stick
    latte = top
    m.add("round_p4", CREAM, ix + 1, iz + 1, latte)
    m.step()
    m.add("round_p2", CREAM, ix + 2, iz + 2, latte + 1)
    for (x, z), c in (((ix + 1, iz + 2), SPICE), ((ix + 3, iz + 4), BRORANGE),
                      ((ix + 4, iz + 2), SPICE), ((ix + 2, iz + 1), BRORANGE)):
        m.add("round_p1" if c == BRORANGE else "tile_round1", c, x, z, latte + 1)
    m.add("stick", SPICE, ix + 4, iz + 3, latte + 1)
    m.step()
    m.add("tile_round2", CREAM, ix + 2, iz + 2, latte + 2)
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
