"""An iced pumpkin spice latte in LEGO bricks: a small display kit for selling.

Build with the shared kit:  ./build.sh

Rules for this kit:
  - only elements in Pick a Brick's Bestseller range that are still in current
    LEGO sets, so an order ships from the US warehouse in about a week
    (export_parts.py enforces this with "bestseller_only");
  - keep the part count and cost low;
  - nothing that looks like a coffee chain's cup: no green, no logo, no lid.

Board 10 x 8 studs (8 x 6.4 cm). Grid: x to the right, z toward the back.
  glass    x 1..5, z 2..6 (clear panels; the drink is built inside)
  pumpkin  x 7..9, z 1..3
  cinnamon sticks x 6..9, z 5..6
"""
from bricks import (Model, Offset, row, place_rect, FACE,
                    WHITE, TAN, RBROWN, RED, BRORANGE, NOUGAT, TCLEAR, DBG)

GLASS = TCLEAR
COFFEE = RBROWN
LATTE = NOUGAT
MILK = TAN
FOAM = BRORANGE
SPICE = RBROWN
CINNAMON = NOUGAT                 # the dusting on the foam
STRAW, STRIPE = RED, WHITE
PUMPKIN = BRORANGE
BOARD = DBG                       # a dark slate board

PROJECT = dict(
    main_parts_label="Board, cinnamon sticks, leaves and ice",
    model_name="iced_pumpkin_latte",
    pdf_name="Iced_Pumpkin_Spice_Latte_Instructions.pdf",
    title="Iced Pumpkin Spice Latte",
    subtitle="A tall iced autumn latte in LEGO&reg; bricks",
    cover_stats=("10 cm", "tall"),
    badge="Custom kit",
    fine_print=("A custom model built from genuine LEGO&reg; elements. It is not affiliated with, "
                "sponsored or endorsed by The LEGO Group. LEGO&reg; is a trademark of The LEGO "
                "Group."),
    about=("A tall glass of iced latte: dark coffee at the bottom fading to milky latte at the "
           "top, clear ice cubes, a thick layer of pumpkin cream cold foam with a dusting of "
           "cinnamon, and a red straw with white stripes. It stands on a slate board with a "
           "little pumpkin, a bundle of cinnamon sticks, autumn leaves and two ice cubes."),
    facts=[("Size", "10 &times; 8 studs (8 &times; 6.4 cm), 10 cm tall to the top of the "
                    "straw; the glass is 4 cm wide and 6.4 cm tall"),
           ("Build time", "about 30 to 45 minutes")],
    organisation=["The board", "The glass", "The pumpkin",
                  "Cinnamon sticks, leaves and ice"],
    organisation_note=("The glass and the pumpkin are built on their own and then set on the "
                       "board. Every section starts with a list of the parts it needs."),
    tips=["The glass walls are clear panels with a thin wall on one side. Turn each one so the "
          "smooth wall faces out, as in the pictures.",
          "Build the drink one layer at a time. The clear pieces inside are the ice cubes, and "
          "the red round bricks in the back corner make the straw.",
          "The upper ring of panels turns the other way from the lower ring, so every panel "
          "covers a corner and locks the walls together."],
    legend=("pumpkin.ldr", 2),
    sub_info={
        "glass.ldr": ("The glass",
                      "A tall clear glass of iced latte with ice cubes, pumpkin cream cold foam, "
                      "a dusting of cinnamon and a striped straw. The drink is built one layer "
                      "at a time, and the clear walls go up around it."),
        "pumpkin.ldr": ("The pumpkin", "A little orange pumpkin with a stem and a leaf."),
    },
    section_images={},
    section_image_default="cover_front_right",
    hero_views=[("cover_front_right", 24, 32), ("cover_front_left", 24, -32),
                ("cover_front", 10, 0), ("cover_high", 55, 20), ("back", 26, 150)],
    cover_view="cover_front_right",
    gallery=["cover_front", "cover_front_left", "cover_high", "back"],
    substitutions=[
        "<b>Board:</b> any colour of plates and tiles works. Tan or reddish brown makes a "
        "wooden board.",
        "<b>Hidden parts:</b> the 1&times;1 plate in the middle of the glass's base can be any "
        "colour.",
        "<b>Straw:</b> white round bricks with red round plates make a white straw with red "
        "stripes. Avoid green.",
        "<b>Ice:</b> any clear 1&times;1 or 1&times;2 bricks work as ice cubes."],
    order_cap_note=("Every element in this kit was in the Bestseller range, which ships from "
                    "the US warehouse."),
    colour_rows=[("Trans-Clear", "Transparent", "Trans-Clear"),
                 ("Reddish Brown", "Reddish Brown", "Reddish Brown"),
                 ("Medium Nougat", "Medium Nougat", "Medium Nougat"),
                 ("Tan", "Brick Yellow", "Tan"),
                 ("Orange", "Bright Orange", "Orange"),
                 ("Dark Bluish Gray", "Dark Stone Grey", "Dark Bluish Gray")],
    bestseller_only=True,
    batch_sizes=[10, 25],
)

BOARD_W, BOARD_D = 10, 8
GX, GZ = 1, 2                     # glass corner (5 x 5)
IX, IZ = GX + 1, GZ + 1           # inside of the glass (3 x 3)
PX, PZ = 7, 1                     # pumpkin corner
STICKS = (6, 5)
LEAVES = [(6, 0, 0, BRORANGE), (9, 4, 90, BRORANGE), (0, 0, 45, BRORANGE)]
ICE = [("b1x2_open", 2, 0, 0), ("headlight", 4, 1, 180)]    # two ice cubes on the board
BASE = 1                          # the glass stands on the board studs
STRAW_AT = (IX + 2, IZ + 2)       # back-right corner inside the glass

# rotation of a panel that puts its thin wall on the outside (at rotation 0 the
# wall is on the back)
WALL = {"back": 0, "right": 90, "front": 180, "left": 270}

# drink courses inside the glass, one per brick height, as seen from above
# (back row first).  R coffee, N latte, T milk, O pumpkin foam,
# e ice (1 x 2 clear), i ice (round 1 x 1), h ice (headlight), | straw
COURSES = [
    ["RR|",
     "RRR",
     "RRR"],
    ["RR|",
     "hRR",
     "Ree"],
    ["RN|",
     "RRi",
     "iRR"],
    ["NN|",
     "NNe",
     "hNe"],
    ["TN|",
     "TNN",
     "NiT"],
    ["OO|",
     "OOO",
     "OOO"],
]
COLOURS = {"R": COFFEE, "N": LATTE, "T": MILK, "O": FOAM}
# brick shapes (studs along x, along z) available in each colour, biggest first
SHAPES = {COFFEE: [(2, 2), (1, 3), (3, 1), (1, 2), (2, 1), (1, 1)],
          LATTE: [(1, 2), (2, 1), (1, 1)],
          MILK: [(2, 2), (1, 3), (3, 1), (1, 2), (2, 1), (1, 1)],
          FOAM: [(2, 2), (1, 2), (2, 1), (1, 1)]}


def fill_course(m, rows, layer, along_z=False):
    """Cover a course inside the glass with bricks, biggest first."""
    grid = {}
    for j, line in enumerate(reversed(rows)):
        for i, ch in enumerate(line):
            grid[(i, j)] = ch
    done = set()
    for (i, j), ch in sorted(grid.items(), key=lambda kv: (kv[0][1], kv[0][0])):
        if (i, j) in done or ch == "|":
            continue
        x, z = IX + i, IZ + j
        if ch == "i":
            m.add("round1", GLASS, x, z, layer)
            done.add((i, j))
            continue
        if ch == "h":
            m.add("headlight", GLASS, x, z, layer, rot=_in(i, j))
            done.add((i, j))
            continue
        if ch == "e":
            shapes, colour = [(1, 2), (2, 1)], GLASS
        else:
            colour = COLOURS[ch]
            shapes = SHAPES[colour]
        if along_z:
            shapes = sorted(shapes, key=lambda s: (-s[0] * s[1], s[0] > s[1]))
        for sx, sz in shapes:
            cells = [(i + a, j + b) for a in range(sx) for b in range(sz)]
            if all(grid.get(c) == ch and c not in done for c in cells):
                if ch == "e":
                    m.add("b1x2_open", GLASS, x, z, layer, rot=0 if sx == 2 else 90)
                else:
                    place_rect(m, "b", colour, x, z, sx, sz, layer)
                done |= set(cells)
                break
        else:
            raise ValueError(f"cannot fill {(i, j)} in course at {layer}")


def _in(i, j):
    """Rotation that turns a headlight brick's side stud away from the nearest
    wall, so the glass shows its plain clear back (at rotation 0 the stud faces
    the front)."""
    if j == 0:
        return 180
    if j == 2:
        return 0
    return 270 if i == 0 else 90


# --------------------------------------------------------------------------
# the glass (5 x 5): two rings of panels, each ring turning the other way so
# the upper panels lock the lower ones together at the corners
# --------------------------------------------------------------------------
def glass_ring(m, L, upper):
    x0, z0, x1, z1 = GX, GZ, GX + 4, GZ + 4
    if not upper:
        m.add("panel1x4x3", GLASS, x0, z0, L, rot=WALL["front"])
        m.add("panel1x4x3", GLASS, x1, z0, L, rot=WALL["right"])
        m.add("panel1x4x3", GLASS, x0 + 1, z1, L, rot=WALL["back"])
        m.add("panel1x4x3", GLASS, x0, z0 + 1, L, rot=WALL["left"])
    else:
        m.add("panel1x4x3", GLASS, x0 + 1, z0, L, rot=WALL["front"])
        m.add("panel1x4x3", GLASS, x1, z0 + 1, L, rot=WALL["right"])
        m.add("panel1x4x3", GLASS, x0, z1, L, rot=WALL["back"])
        m.add("panel1x4x3", GLASS, x0, z0, L, rot=WALL["left"])


def build_glass():
    mm = Model("glass.ldr", "Glass")
    m = Offset(mm, GX, GZ, BASE)
    L = BASE
    # thick clear bottom; one hidden plate in the middle
    for i in range(5):
        m.add("p1x2", GLASS, GX + i, GZ, L, rot=90)
    m.step()
    for i in (0, 1, 3, 4):
        m.add("p1x2", GLASS, GX + i, GZ + 2, L, rot=90)
    m.add("p1x2", GLASS, GX + 2, GZ + 3, L, rot=90)
    m.add("p1x2", GLASS, GX, GZ + 4, L)
    m.add("p1x2", GLASS, GX + 3, GZ + 4, L)
    m.add("p1x1", COFFEE, GX + 2, GZ + 2, L)
    m.step("The red round brick is the bottom of the straw.")
    sx, sz = STRAW_AT
    course_layers = [L + 1 + 3 * k for k in range(len(COURSES))]
    for k, (rows, cl) in enumerate(zip(COURSES, course_layers)):
        if k == 3:
            m.step("Turn each panel so its smooth wall faces out.")
            glass_ring(m, course_layers[0], False)
            m.step()
        fill_course(m, rows, cl, along_z=bool(k % 2))
        m.add("round1", STRAW, sx, sz, cl)
        m.step("The clear pieces are ice cubes." if k == 0 else None)
    m.step("This ring turns the other way: each panel covers a corner below it.")
    glass_ring(m, course_layers[3], True)
    m.step()
    top = course_layers[-1] + 3
    # rim
    for x in range(GX, GX + 5):
        edge = "tile_round1" if x in (GX, GX + 4) else "t1x1"     # rounded corners
        m.add(edge, GLASS, x, GZ, top)
        m.add(edge, GLASS, x, GZ + 4, top)
    for z in range(GZ + 1, GZ + 4):
        m.add("t1x1", GLASS, GX, z, top)
        m.add("t1x1", GLASS, GX + 4, z, top)
    m.step()
    # foam top
    place_rect(m, "p", FOAM, IX, IZ, 2, 2, top)
    m.add("p1x2", FOAM, IX + 2, IZ, top, rot=90)
    m.add("p1x2", FOAM, IX, IZ + 2, top)
    m.add("round1", STRAW, sx, sz, top)
    m.step()
    # a soft mound of foam with a dusting of cinnamon
    mound = top + 1
    for i, j, face in ((1, 0, "front"), (1, 2, "back"), (0, 1, "left"), (2, 1, "right")):
        m.add("cheese", FOAM, IX + i, IZ + j, mound, rot=FACE[face])
    for (i, j), rot in (((0, 0), QUARTER["front-left"]), ((2, 0), QUARTER["front-right"]),
                        ((0, 2), QUARTER["back-left"])):
        m.add("tile_quarter", FOAM, IX + i, IZ + j, mound, rot=rot)
    m.add("round_p1", FOAM, IX + 1, IZ + 1, mound)
    m.add("tile_round1", CINNAMON, IX + 1, IZ + 1, mound + 1)
    m.step()
    # straw above the foam: red with thin white stripes
    y = top + 3
    for n in range(2):
        m.add("round_p1", STRIPE, sx, sz, y)
        m.add("round1", STRAW, sx, sz, y + 1)
        y += 4
    m.step()
    mm.width, mm.depth = 5, 5
    return mm


# rotation that puts the rounded edge of a quarter-round tile on each corner
QUARTER = {"front-right": 0, "front-left": 90, "back-left": 180, "back-right": 270}


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
    m.add("leaves1", BRORANGE, 1, 1, 6, rot=135)
    m.step()
    m.width, m.depth = 3, 3
    return m


# --------------------------------------------------------------------------
# main model: the board and everything on it
# --------------------------------------------------------------------------
def build_main(glass, pumpkin):
    m = Model("iced_pumpkin_latte.ldr", "Iced pumpkin spice latte")
    m.header_notes = ["Custom kit built from LEGO elements; generated by design.py (lego-kit)."]
    m.section("The board", "Two dark grey plates make a slate board, and tiles make its smooth "
              "top. Leave the gaps open: the glass, the pumpkin, the cinnamon sticks, the leaves "
              "and the ice cubes go there.")
    place_rect(m, "p", BOARD, 0, 0, 6, 8, 0)
    place_rect(m, "p", BOARD, 6, 0, 4, 8, 0)
    m.step()
    used = {(x, z) for x in range(GX, GX + 5) for z in range(GZ, GZ + 5)}
    used |= {(x, z) for x in range(PX, PX + 3) for z in range(PZ, PZ + 3)}
    sx, sz = STICKS
    used |= {(x, z) for x in range(sx, sx + 4) for z in (sz, sz + 1)}
    used |= {(x, z) for x, z, _, _ in LEAVES}
    for key, x, z, _ in ICE:
        used |= {(x, z), (x + 1, z)} if key == "b1x2_open" else {(x, z)}
    for z in range(BOARD_D):
        xs = [x for x in range(BOARD_W) if (x, z) not in used]
        for x0, n in _runs(xs):
            row(m, "t", BOARD, x0, z, n, 1, avoid={6 - x0})
    m.step()
    m.sub(glass, GX, GZ, BASE)
    m.step()
    m.sub(pumpkin, PX, PZ, 1)
    m.step()
    m.section("Cinnamon sticks, leaves and ice", "A bundle of cinnamon sticks, a few leaves "
              "and two ice cubes finish the scene.")
    m.add("log1x4", SPICE, sx, sz, 1)
    m.add("log1x4", SPICE, sx, sz + 1, 1)
    m.step()
    m.add("log1x4", SPICE, sx, sz, 4)
    m.step()
    for x, z, _, _ in LEAVES:
        m.add("p1x1", BOARD, x, z, 1)
    m.step()
    for x, z, rot, colour in LEAVES:
        m.add("leaves1", colour, x, z, 2, rot=rot)
    m.step()
    for key, x, z, rot in ICE:
        m.add(key, GLASS, x, z, 1, rot=rot)
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
    glass, pumpkin = build_glass(), build_pumpkin()
    main_m = build_main(glass, pumpkin)
    return main_m, [main_m, glass, pumpkin]
