"""A glass mug of latte with whipped cream in LEGO bricks: a small display kit for selling.

Build with the shared kit:  ./build.sh

Rules for this kit:
  - only elements in Pick a Brick's Bestseller range that are still in current
    LEGO sets, so an order ships from the US warehouse in about a week
    (export_parts.py enforces this with "bestseller_only");
  - keep the part count and cost low.

Board 12 x 10 studs (9.6 x 8 cm) of white "marble". Grid: x to the right, z toward
the back.
  glass    x 4..9, z 1..6 (6 x 6 with the corner cells cut), handle out to x 2
  bowl     x 0..3, z 6..9 (on a 2 x 2 foot at x 1..2, z 7..8)

The glass is two tiers of clear 1x4x3 panels, thin wall outward. Inside is a ring
of medium nougat 1x2 bricks (the latte), a course of tan (the foam) and plates
level with the rim. The whipped cream sits on the rim: a 4x4 round plate, a 2x2
round plate, a 2x2 dish and a peak. The handle hangs from the rim on the left.
"""
from bricks import (Model, Offset, place_rect, rot_matrix, PARTS, FACE,
                    WHITE, TAN, RBROWN, BRORANGE, NOUGAT, TCLEAR)

GLASS = TCLEAR
DRINK = NOUGAT
FOAM = TAN
CREAM = WHITE
SPICE = RBROWN                    # cinnamon stick, cinnamon and cloves on the board
DUST = NOUGAT                     # cinnamon dusted on the foam and the cream
PUREE = BRORANGE
BOARD = WHITE

PROJECT = dict(
    main_parts_label="Board and spices",
    model_name="whipped_latte",
    pdf_name="Whipped_Latte_Instructions.pdf",
    title="Whipped Pumpkin Latte",
    subtitle="A glass mug of pumpkin spice latte in LEGO&reg; bricks",
    cover_stats=("9.6 &times; 8 cm", "12 &times; 10 studs"),
    badge="Custom kit",
    fine_print=("A custom model built from genuine LEGO&reg; elements. It is not affiliated with, "
                "sponsored or endorsed by The LEGO Group. LEGO&reg; is a trademark of The LEGO "
                "Group."),
    about=("A clear glass mug of pumpkin spice latte with a foamy top, a swirl of whipped cream "
           "dusted with cinnamon and a cinnamon stick, on a white marble board with a little bowl "
           "of pumpkin pur&eacute;e, whole cloves and a scattering of cinnamon and nutmeg."),
    facts=[("Size", "12 &times; 10 studs (9.6 &times; 8 cm), 9 cm tall to the top of the "
                    "cinnamon stick"),
           ("Build time", "about 30 to 45 minutes")],
    organisation=["The board and spices", "The glass mug", "The pumpkin bowl"],
    organisation_note=("The glass mug and the bowl are built on their own and then set on the "
                       "board. Every section starts with a list of the parts it needs."),
    tips=["Each clear panel has a thin wall along one long side. Turn it so the wall faces "
          "out, as in the pictures.",
          "Build the latte a few courses at a time, then slide the panels down around it.",
          "The handle hangs from the rim. Press the clear 1&times;2 plate onto the underside "
          "of the handle plate, then add the round bricks below it.",
          "Keep the clear parts in their own bag, so they don't get scratched."],
    legend=("bowl.ldr", 2),
    sub_info={
        "glass.ldr": ("The glass mug",
                      "A clear glass mug with a handle, filled with latte and a layer of foam, "
                      "topped with whipped cream, cinnamon and a cinnamon stick."),
        "bowl.ldr": ("The pumpkin bowl", "A little white bowl of pumpkin purée."),
    },
    section_images={},
    section_image_default="cover_front_left",
    hero_views=[("cover_front_left", 24, -30), ("cover_front_right", 22, 32),
                ("cover_front", 10, 0), ("cover_high", 50, -15), ("back", 28, 150)],
    cover_view="cover_front_left",
    gallery=["cover_front", "cover_front_right", "cover_high", "back"],
    substitutions=[
        "<b>Board:</b> any colour of plates and tiles makes a different table top.",
        "<b>Hidden parts:</b> the 6&times;6 plate under the glass and the 2&times;2 plate "
        "under the bowl can be any colour.",
        "<b>Latte colour:</b> the 1&times;2 bricks inside the glass can be any colour; "
        "tan makes a lighter latte."],
    order_cap_note=("Every element in this kit was in the Bestseller range, which ships from "
                    "the US warehouse."),
    colour_rows=[("Trans-Clear", "Transparent", "Trans-Clear"),
                 ("Tan", "Brick Yellow", "Tan"),
                 ("Medium Nougat", "Medium Nougat", "Medium Nougat"),
                 ("Orange", "Bright Orange", "Orange"),
                 ("Reddish Brown", "Reddish Brown", "Reddish Brown")],
    bestseller_only=True,
    clear_alpha=48,                   # draw the clear glass more see-through in renders
    batch_sizes=[10, 25],
)

BOARD_W, BOARD_D = 12, 10
GX, GZ = 4, 1                     # glass corner (6 x 6 with cut corners)
BX, BZ = 0, 6                     # bowl corner (4 x 4)
# glass heights (layers): the base plate is layer 1, flush with the board tiles
LOW, UP = 2, 11                   # the two tiers of 1x4x3 panels
RIM = 20                          # top of the panels
FOAM_COURSE = 17                  # a course of foam, then plates level with the rim
CREAM_L = RIM + 1                 # the whipped cream's round plate, on top of the rim
HZ = 3                            # handle row (glass-local z)
FRONT_LEFT = (28, -32)            # step camera: the handle and the bowl are on the left

# the board's top layer, back row first: w white tile, c cinnamon, n nutmeg,
# k clove, G glass, B bowl foot
BOARD_MAP = """
wwwwwwwwwwww
wBBwwwwkwnww
wBBwcwwwwwwc
wwwwGGGGGGnw
wwwwGGGGGGww
wwwcGGGGGGww
wwwwGGGGGGcw
wkwwGGGGGGww
wwnwGGGGGGwk
cwwwnwwwcwww
"""


def wall_rot(side):
    """Rotation that puts a clear panel's thin wall on the outside (`side`)."""
    return (FACE[side] + 180) % 360


# --------------------------------------------------------------------------
# the glass mug (6 x 6 with cut corners)
# --------------------------------------------------------------------------
def build_glass():
    mm = Model("glass.ldr", "Glass mug")
    mm.camera = FRONT_LEFT
    m = Offset(mm, GX, GZ, 1)
    x0, z0 = GX, GZ
    x1, z1 = GX + 5, GZ + 5
    a, b = x0 + 1, z0 + 1                          # the inside (4 x 4) starts here
    # base: one 6x6 plate ties the walls together; clear tiles on the cut corners
    place_rect(m, "p", BOARD, x0, z0, 6, 6, 1)
    for (x, z) in ((x0, z0), (x1, z0), (x0, z1), (x1, z1)):
        m.add("t1x1", GLASS, x, z, 2)
    m.step()

    def panels(L):
        m.add("panel1x4x3", GLASS, a, z0, L, rot=wall_rot("front"))
        m.add("panel1x4x3", GLASS, a, z1, L, rot=wall_rot("back"))
        m.add("panel1x4x3", GLASS, x0, b, L, rot=wall_rot("left"))
        m.add("panel1x4x3", GLASS, x1, b, L, rot=wall_rot("right"))

    def latte(L, turn):
        """A ring of 1x2 bricks just inside the glass, turned every course."""
        if turn:
            for x in (a, a + 2):
                m.add("b1x2", DRINK, x, b, L)
                m.add("b1x2", DRINK, x, b + 3, L)
            m.add("b1x2", DRINK, a, b + 1, L, rot=90)
            m.add("b1x2", DRINK, a + 3, b + 1, L, rot=90)
        else:
            for z in (b, b + 2):
                m.add("b1x2", DRINK, a, z, L, rot=90)
                m.add("b1x2", DRINK, a + 3, z, L, rot=90)
            m.add("b1x2", DRINK, a + 1, b, L)
            m.add("b1x2", DRINK, a + 1, b + 3, L)

    # the latte goes in first, then the glass panels slide down around it
    latte(2, False)
    m.step()
    latte(5, True)
    m.step()
    latte(8, False)
    m.step("Turn each panel so its thin wall faces out.")
    panels(LOW)
    m.step()
    latte(11, True)
    m.step()
    latte(14, False)
    m.step()
    panels(UP)
    m.step()
    # foam: a course of tan bricks and plates level with the rim, cinnamon in the corners
    place_rect(m, "b", FOAM, a, b, 2, 4, FOAM_COURSE)
    place_rect(m, "b", FOAM, a + 2, b, 2, 4, FOAM_COURSE)
    m.step()
    place_rect(m, "p", FOAM, a + 1, b, 2, 4, RIM)
    place_rect(m, "p", FOAM, a, b + 1, 1, 2, RIM)
    place_rect(m, "p", FOAM, a + 3, b + 1, 1, 2, RIM)
    for i, (x, z) in enumerate(((a, b), (a + 3, b), (a + 3, b + 3), (a, b + 3))):
        m.add("tile_round1", DUST if i % 2 else FOAM, x, z, RIM)
    m.step()
    # rim: clear tiles on the panels; on the left, the plate that holds the handle
    hz = z0 + HZ
    for x in range(a, a + 4):
        m.add("t1x1", GLASS, x, z0, RIM)
        m.add("t1x1", GLASS, x, z1, RIM)
    m.step()
    for z in range(b, b + 4):
        m.add("t1x1", GLASS, x1, z, RIM)
        if z != hz:
            m.add("t1x1", GLASS, x0, z, RIM)
    handle_top = m.add("p1x2", GLASS, x0 - 1, hz, RIM)
    m.step("Build the handle downward: the 1x2 plate clips under the handle plate.")
    # handle: a 1x2 plate under the top plate, three round bricks and a foot plate
    m.add("p1x2", GLASS, x0 - 2, hz, RIM - 1)
    for L in (RIM - 4, RIM - 7, RIM - 10):
        m.add("round1", GLASS, x0 - 2, hz, L)
    m.add("p1x2", GLASS, x0 - 2, hz, RIM - 11)
    m.add("t1x1", GLASS, x0 - 1, hz, RIM - 10)
    m.step()
    m.add("t1x1", GLASS, x0 - 1, hz, RIM + 1)
    m.add("t1x1", GLASS, x0, hz, RIM + 1)
    m.step()
    # whipped cream: a round plate, a mound, a dome and a peak, dusted with cinnamon
    m.add("round_p4", CREAM, a, b, CREAM_L)
    m.step()
    m.add("round_p2", CREAM, a + 1, b + 1, CREAM_L + 1)
    dusted = {(a + 2, b), (a, b + 2), (a + 1, b + 3)}
    for (x, z) in ((a + 1, b), (a + 2, b), (a, b + 1), (a, b + 2), (a + 3, b + 1),
                   (a + 1, b + 3), (a + 2, b + 3)):
        m.add("tile_round1", DUST if (x, z) in dusted else CREAM, x, z, CREAM_L + 1)
    stick = (a + 3, b + 2)                        # the cinnamon stick, back right
    m.add("round1", SPICE, stick[0], stick[1], CREAM_L + 1)
    m.step()
    dish = m.add("dish2", CREAM, a + 1, b + 1, CREAM_L + 2)
    # peak on the dish's centre stud, half a stud off the grid
    cx, cz = 20 * (a + 2 - GX), 20 * (b + 2 - GZ)
    y = -8 * (CREAM_L + 2 - 1 + PARTS["dish2"].height)
    peak = mm.add_raw("round_p1", CREAM, (cx, y - PARTS["round_p1"].bmax_y, cz),
                      rot_matrix(0), attach_to=dish)
    mm.add_raw("tile_round1", DUST, (cx, y - 8 - PARTS["tile_round1"].bmax_y, cz),
               rot_matrix(0), attach_to=peak)
    m.add("round1", SPICE, stick[0], stick[1], CREAM_L + 4)
    m.add("tile_round1", SPICE, stick[0], stick[1], CREAM_L + 7)
    m.step()
    mm.width, mm.depth = 8, 6
    return mm


# --------------------------------------------------------------------------
# the pumpkin bowl (4 x 4, on a 2 x 2 foot)
# --------------------------------------------------------------------------
def build_bowl():
    m = Model("bowl.ldr", "Pumpkin bowl")
    m.add("p2x2", CREAM, 1, 1, 0)
    m.step()
    m.add("round_p4", CREAM, 0, 0, 1)
    m.step()
    for (x, z), rot in (((0, 0), FACE["left"]), ((2, 0), 0),
                        ((0, 2), FACE["back"]), ((2, 2), FACE["right"])):
        m.add("macaroni", CREAM, x, z, 2, rot=rot)
    m.add("b2x2", PUREE, 1, 1, 2)
    m.step()
    # the tiles tie the rounded bricks together
    m.add("t1x2", CREAM, 1, 0, 5)
    m.add("t1x2", CREAM, 1, 3, 5)
    m.add("t1x2", CREAM, 0, 1, 5, rot=90)
    m.add("t1x2", CREAM, 3, 1, 5, rot=90)
    m.add("p2x2", PUREE, 1, 1, 5)
    m.step()
    m.add("cheese", PUREE, 1, 1, 6, rot=FACE["front"])
    m.add("cheese", PUREE, 2, 1, 6, rot=FACE["right"])
    m.add("cheese", PUREE, 2, 2, 6, rot=FACE["back"])
    m.add("cheese", PUREE, 1, 2, 6, rot=FACE["left"])
    m.step()
    m.width, m.depth = 4, 4
    return m


# --------------------------------------------------------------------------
# main model: the board and everything on it
# --------------------------------------------------------------------------
SPOT_OF = {"c": ("tile_round1", SPICE), "n": ("tile_round1", NOUGAT),
           "k": ("round_p1", SPICE)}
# white tile shapes (width x, depth z), largest first
TILE_SHAPES = [(4, 2), (2, 4), (6, 1), (1, 6), (2, 2), (4, 1), (1, 4), (2, 1), (1, 2), (1, 1)]
TILE_KEYS = {(1, 1): "t1x1", (1, 2): "t1x2", (1, 4): "t1x4", (1, 6): "t1x6",
             (2, 2): "t2x2", (2, 4): "t2x4"}


def board_cells():
    rows = BOARD_MAP.strip().splitlines()
    assert len(rows) == BOARD_D and all(len(r) == BOARD_W for r in rows)
    return {(x, BOARD_D - 1 - i): ch for i, r in enumerate(rows) for x, ch in enumerate(r)}


def plan_tiles(cells):
    """Cover cells with tiles, the largest that fit anywhere first: [(x, z, sx, sz)]."""
    todo, out = set(cells), []
    for sx, sz in TILE_SHAPES:
        for (z, x) in sorted((z, x) for x, z in cells):
            block = {(x + i, z + j) for i in range(sx) for j in range(sz)}
            if block <= todo:
                out.append((x, z, sx, sz))
                todo -= block
    assert not todo
    return out


def add_tile(m, colour, x, z, sx, sz, layer):
    key = TILE_KEYS[tuple(sorted((sx, sz)))]
    fp = PARTS[key].footprint(0)
    w0 = round((max(p[0] for p in fp) - min(p[0] for p in fp)) / 20) + 1
    m.add(key, colour, x, z, layer, rot=0 if w0 == sx else 90)


def build_main(glass, bowl):
    m = Model("whipped_latte.ldr", "Latte with whipped cream")
    m.camera = FRONT_LEFT
    m.header_notes = ["Custom kit built from LEGO elements; generated by design.py (lego-kit)."]
    m.section("The board and spices", "Two big plates make the marble board, and tiles make "
              "its top, with cinnamon, nutmeg and whole cloves scattered on it. Leave the big gaps "
              "open: the glass and the bowl go there.")
    place_rect(m, "p", BOARD, 0, 0, 6, 10, 0)
    place_rect(m, "p", BOARD, 6, 0, 6, 10, 0)
    m.step()
    cells = board_cells()
    tiles = plan_tiles({c for c, v in cells.items() if v == "w"})
    # three steps: the left side, the front and right, the back
    for part in (lambda x, z: x < GX,
                 lambda x, z: x >= GX and z < GZ + 6,
                 lambda x, z: x >= GX and z >= GZ + 6):
        for (x, z, sx, sz) in tiles:
            if part(x, z):
                add_tile(m, BOARD, x, z, sx, sz, 1)
        m.step()
    spots = sorted(((x, z), ch) for (x, z), ch in cells.items() if ch in SPOT_OF)
    for kinds in ("cn", "k"):
        for (x, z), ch in spots:
            if ch in kinds:
                key, colour = SPOT_OF[ch]
                m.add(key, colour, x, z, 1)
        m.step()
    m.sub(glass, GX, GZ, 1)
    m.step()
    m.sub(bowl, BX, BZ, 1)
    m.step()
    return m


def build():
    glass, bowl = build_glass(), build_bowl()
    main_m = build_main(glass, bowl)
    return main_m, [main_m, glass, bowl]
