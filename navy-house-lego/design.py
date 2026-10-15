"""Navy Craftsman House: a two-storey modern-craftsman house, designed from a photo.

Build with the shared kit:  ./build.sh

Scale: 1 stud = 2 ft (about 1:76); one storey = 4 bricks, like ../house-lego.
Lot 48 x 32 studs (38.4 x 25.6 cm).

Grid (studs): x to the right, z toward the back; the street is at z = 0.
  street      z 0..1 dark grey, curb z 2, grass strip z 3, sidewalk z 4..5
  driveway    x 4..16 from the curb to the garage, the car at x 8..11, z 7..12
  garage      x 7..16, z 14..26   one storey, steep front gable, carriage door
  porch       x 17..36, z 15..17  stone piers and white columns; a small front gable
                                  over the door (x 17..24) and a shed roof (x 25..36)
  house       x 17..36, z 18..29  stacked-stone front on the ground floor; upstairs the
                                  big front gable (x 25..36, from z 18) and a second
                                  gable set back behind it (x 17..26, from z 21)
  yard        a curved paver walk from the driveway to the porch steps, mulch beds with
              boxwoods, grasses and flowering shrubs, the lawn, a young tree at (42, 11)
              and the mailbox at (2, 3)
"""
import bricks
import walls
from bricks import (Model, Offset, P, row, fill_rect, fill_cells, place_rect, rot_matrix,
                    _sizes, FACE, WHITE, BLACK, DBG, LBG, GREEN, TAN, RBROWN, DTAN, RED, PINK,
                    BRGREEN, TCLEAR)
from roofs import Roof, build_roofs
from walls import WallRing

NAVY = 272                  # Dark Blue (LEGO Earth Blue)
LIME = 27                   # Lime (LEGO Bright Yellowish Green)
SIDING, TRIM, ROOF = NAVY, WHITE, DBG
RAKE = TRIM                 # white bargeboards: white slopes at the gable ends
STONE_MIX = (TAN, LBG, DTAN, TAN, LBG, DBG, TAN, DTAN, LBG, TAN, DTAN, LBG)
STONE_1X1 = (TAN, LBG, TAN, DBG, LBG)   # Dark Tan has no Bestseller 1 x 1 brick

# parts this kit adds to the catalogue (prefix nh_)
P("nh_win143", "60594.dat", "Window 1 x 4 x 3 Frame")
P("nh_b2x6", "2456.dat", "Brick 2 x 6")
P("nh_leaves4x3", "2423.dat", "Plant Leaves 4 x 3", cells=[(0, 0)], studs=[(0, 0)], height=1)
P("nh_glass143", "60603.dat", "Glass for Window 1 x 4 x 3", cells=[(0, 0)], bottom=[],
  height=0, solid=False, studs=[])

# Bestseller sizes for colours the toolkit has no (or a wider) entry for, checked with
# avail.py; set only while this design builds, so other kits are unaffected
EXTRA_ALLOWED = {
    ("b", NAVY): _sizes("1x1 1x2 1x3 1x4 2x2"),
    ("p", NAVY): _sizes("1x1 1x2 1x3 1x4 1x6 2x4 6x8"),
    ("t", NAVY): _sizes("1x1 1x2 2x2"),
    ("b", DTAN): _sizes("1x2 1x4 2x2 2x4"),
    ("p", DTAN): _sizes("1x2 1x4 2x4 2x6"),
    ("t", DTAN): _sizes("1x1 1x2 2x2"),
    ("b", LBG): _sizes("1x1 1x2 1x4 2x2 2x4"),
    # light bluish gray plates: the toolkit's list less the 1 x 12 (not a Bestseller)
    ("p", LBG): _sizes("1x1 1x2 1x3 1x4 1x6 1x8 1x10 2x2 2x3 2x4 2x6 2x8 2x10 2x12 "
                       "4x4 4x6 4x8 4x10 4x12 6x6 6x8 6x10 6x12"),
    ("p", BLACK): _sizes("1x1 1x2 1x3 1x4 1x6 1x8 2x2 2x3 2x4 2x6 2x8 4x4 4x6 4x8 6x6 6x8"),
}

PROJECT = dict(
    main_parts_label="Lot, garden and car placement",
    model_name="navy_house",
    pdf_name="Navy_Craftsman_House_Instructions.pdf",
    title="Navy Craftsman House",
    subtitle="A two-storey modern-craftsman house with a stone porch, in LEGO&reg; bricks",
    cover_stats=("38 &times; 26 cm", "48 &times; 32 studs"),
    badge="Unofficial fan design",
    fine_print=("An unofficial fan-designed model (MOC), made from a photo of a house. It is not "
                "affiliated with, sponsored or endorsed by The LEGO Group. LEGO&reg; is a "
                "trademark of The LEGO Group."),
    about=("This model recreates the house in the photo: deep navy walls with crisp white "
           "trim, two steep front gables nested one behind the other, the one-storey garage "
           "with its light grey carriage door, and the covered porch with white columns on "
           "stacked-stone piers in front of a stone wall with the black front door and a big "
           "white window. The lot has the street, curb and sidewalk, the driveway with a "
           "bronze compact SUV, a curved paver walk, mulch beds with boxwoods, grasses and "
           "flowering shrubs, a young tree on the lawn and the mailbox by the driveway."),
    facts=[("Size", "48 &times; 32 studs (38.4 &times; 25.6 cm), {height} cm tall to the ridge"),
           ("Scale", "about 1:76 (1 stud = 2 ft, one storey = 4 bricks)"),
           ("Build time", "about 4 to 5 hours")],
    organisation=["The lot: street, sidewalk, driveway, walk, beds and lawn", "The garage",
                  "The house: stone front, porch, upper storey and roofs",
                  "The garden: shrubs, flowers, the tree and the mailbox",
                  "The car (inside the garden section)"],
    organisation_note=("The garage, the house and the car are built on their own and then set "
                       "on the lot. Every section starts with a list of the parts it needs."),
    tips=["Each storey is four courses of bricks, laid two at a time. The white corner "
          "boards are tall 1&times;1&times;3 bricks; set them in with the courses around them.",
          "The stone front uses masonry-profile 1&times;2 bricks in four colours. The exact "
          "colour order doesn't matter, so mix them as you like.",
          "Slide the clear glass into each white 1&times;4&times;3 window frame before you "
          "place it.",
          "The two upstairs gables are built together, one row of slopes at a time. Where they "
          "meet, the slopes step around each other to form the valley."],
    legend=("car.ldr", 1),
    sub_info={
        "garage.ldr": ("The garage",
                       "The one-storey garage: navy walls with white corner boards, the light "
                       "grey carriage door with its row of windows, and a steep front gable "
                       "with white bargeboards."),
        "house.ldr": ("The house",
                      "The stacked-stone ground floor with the black front door and a big "
                      "white window, the porch with stone piers and white columns under a "
                      "small gable and a shed roof, the navy upper storey and the two nested "
                      "front gables."),
        "car.ldr": ("The car", "A bronze compact SUV for the driveway."),
    },
    section_images={"The lot": "cover_high", "The garden": "cover_front_left"},
    section_image_default="cover_front_right",
    hero_views=[("cover_front_right", 24, 32), ("cover_front_left", 24, -32),
                ("cover_front", 10, 0), ("cover_high", 52, 20), ("back", 28, 150)],
    cover_view="cover_front_right",
    gallery=["cover_front", "cover_front_left", "cover_high", "back"],
    substitutions=[
        "<b>Base:</b> six 16&times;16 plates. Any plates that cover 48&times;32 studs will do.",
        "<b>Stone:</b> mix the four colours of masonry bricks freely; plain bricks work too.",
        "<b>Hidden parts:</b> the floor plates inside the house and the fillers under the "
        "roofs can be any colour.",
        "<b>Car:</b> pick any colour to match your own car."],
    order_cap_note=("Every element in this kit was in Pick a Brick's Bestseller range, which "
                    "sells up to 999 of an element per order."),
    colour_rows=[("Dark Blue", "Earth Blue", "Dark Blue"),
                 ("Light Bluish Gray", "Medium Stone Grey", "Light Bluish Gray"),
                 ("Dark Bluish Gray", "Dark Stone Grey", "Dark Bluish Gray"),
                 ("Tan / Dark Tan", "Brick Yellow / Sand Yellow", "Tan / Dark Tan"),
                 ("Green", "Dark Green", "Green"),
                 ("Bright Green / Lime", "Bright Green / Bright Yellowish Green",
                  "Bright Green / Lime"),
                 ("Bright Pink", "Light Purple", "Bright Pink"),
                 ("Trans-Clear", "Transparent", "Trans-Clear")],
    bestseller_only=True,
    batch_sizes=[10, 25],
    clear_alpha=48,          # render the window glass as clear as real glass
    # README (make_readme.py)
    features=["Deep navy walls (Dark Blue) with crisp white corner boards, window frames, "
              "fascia, bargeboards and a white band between the storeys",
              "Two steep front gables nested one behind the other, with white bargeboards "
              "and a valley between them",
              "The one-storey garage under its own front gable, with a light grey carriage "
              "door and a row of windows across its top",
              "The covered porch: white columns on stacked-stone piers, a small front gable "
              "over the door and a shed roof over the rest",
              "A stacked-stone ground floor in four colours, with the black front door, a "
              "big white-framed window, two potted plants, two chairs and a little table",
              "The street, curb, grass strip and sidewalk; the driveway with a bronze compact "
              "SUV and a black mailbox on a wooden post",
              "A curved tan paver walk, black mulch beds with boxwoods, grasses and pink and "
              "red flowering shrubs, and a young tree with a bright green canopy"],
    omitted=["The flag on the porch column, the wooden fence and the neighbouring houses",
             "The board-and-batten texture: the walls and gables are plain navy bricks",
             "The window grids, the porch lanterns, the house number and the lawn's mowing "
             "stripes",
             "The bargeboards are stepped white slopes, so they are wider than the thin "
             "boards on the real house"],
)


# --------------------------------------------------------------------------
# small helpers
# --------------------------------------------------------------------------
def rect(x0, z0, w, d):
    return {(x, z) for x in range(x0, x0 + w) for z in range(z0, z0 + d)}


def stone_colour(x, z, layer, mix=STONE_MIX):
    h = (x * 73856093) ^ (z * 19349663) ^ (layer * 83492791)
    return mix[h % len(mix)]


def _stone_run(m, cells, layer, parity, axis):
    """walls._stone_run with this kit's stone colours (no Dark Tan 1 x 1 bricks)."""
    i, n = 0, len(cells)
    start = cells[0][0] if axis == "x" else cells[0][1]
    if (start + parity) % 2 == 1 and n > 1:
        x, z = cells[0]
        m.add("b1x1", stone_colour(x, z, layer, STONE_1X1), x, z, layer)
        i = 1
    while i < n:
        x, z = cells[i]
        if i + 1 < n:
            m.add("masonry", stone_colour(x, z, layer), x, z, layer, rot=0 if axis == "x" else 90)
            i += 2
        else:
            m.add("b1x1", stone_colour(x, z, layer, STONE_1X1), x, z, layer)
            i += 1


def window143(m, x, z, layer, face="front"):
    """A white 1 x 4 x 3 window frame with its clear glass."""
    frame = m.add("nh_win143", WHITE, x, z, layer, rot=FACE[face])
    ox, oy, oz, mat, _ = frame.ldraw
    # the frame's ldraw position is in submodel coordinates; add_raw on an
    # Offset expects parent coordinates, so go to the model directly
    target = m.model if isinstance(m, Offset) else m
    target.add_raw("nh_glass143", TCLEAR, (ox, oy, oz), mat, attach_to=frame)
    return frame


PANEL_ROT = {"front": 180, "back": 0, "right": 90, "left": 270}   # flat (glass) side out


def panel_window(m, x, z, layer, face):
    """A clear 1 x 2 x 2 panel as a small window."""
    return m.add("panel1x2x2", TCLEAR, x, z, layer, rot=PANEL_ROT[face])


class Columns:
    """White corner boards and casings as 1x1x3 bricks (and 1x1 for what is left).

    Each column is a cell and the brick courses it spans. The wall material leaves
    these cells empty, and place(m, layer) adds the column pieces that start at a
    course, so they go in with the walls around them."""

    def __init__(self, cols):
        self.pieces = {}            # layer -> [(key, x, z)]
        self.cells = set()
        for (x, z), courses in cols:
            courses = list(courses)
            i = 0
            while i < len(courses):
                tall = i + 2 < len(courses)
                self.pieces.setdefault(courses[i], []).append(("b1x1x3" if tall else "b1x1", x, z))
                i += 3 if tall else 1
            for L in courses:
                for k in range(3):
                    self.cells.add((x, z, L + k))

    def place(self, m, layer):
        for key, x, z in self.pieces.get(layer, []):
            m.add(key, TRIM, x, z, layer)


SNOT_FRONT = (1, 0, 0, 0, 0, -1, 0, 1, 0)    # tile bottom (+y) turned to face +z


def side_tile(m, brick, color, face, stud_y=10):
    """A 1x1 round tile on the side stud of a brick facing `face` (a wheel)."""
    ox, oy, oz, mat, _ = brick.ldraw
    lx, ly, lz = 0, stud_y, -18
    rot = FACE[face]
    ry = rot_matrix(rot)
    wx = ry[0] * lx + ry[2] * lz
    wz = ry[6] * lx + ry[8] * lz
    t = SNOT_FRONT
    m3 = [[ry[0], ry[1], ry[2]], [ry[3], ry[4], ry[5]], [ry[6], ry[7], ry[8]]]
    t3 = [[t[0], t[1], t[2]], [t[3], t[4], t[5]], [t[6], t[7], t[8]]]
    comp = [sum(m3[i][k] * t3[k][j] for k in range(3)) for i in range(3) for j in range(3)]
    target = m.model if isinstance(m, Offset) else m
    return target.add_raw("tile_round1", color, (ox + wx, oy + ly, oz + wz), tuple(comp),
                          attach_to=brick)


# --------------------------------------------------------------------------
# the garage
# --------------------------------------------------------------------------
GX0, GX1, GZ0, GZ1 = 7, 17, 14, 27
GDOOR = range(8, 16)                 # an 8-stud (16 ft) carriage door
G_COURSES = (1, 4, 7, 10)
G_DECK, G_ROOF = 13, 14


def build_garage():
    gm = Model("garage.ldr", "Garage")
    m = Offset(gm, GX0, GZ0, 1)
    corners = [(GX0, GZ0), (GX1 - 1, GZ0), (GX1 - 1, GZ1 - 1), (GX0, GZ1 - 1)]
    ring = WallRing(corners)
    d0 = GDOOR[0]
    cols = Columns([(c, G_COURSES) for c in corners])

    def mat(x, z, layer):
        if z == GZ0 and x in GDOOR and layer < 10:
            return None
        if (x, z, layer) in cols.cells:
            return None
        return ("b", SIDING)

    # two courses per step, so the white corner boards are tied in by the deck soon
    m.step("Navy walls with white corner boards. The garage door is light grey bricks with "
           "grooves.")
    for i, L in enumerate(G_COURSES):
        ring.course(m, L, i, mat)
        cols.place(m, L)
        if L in (1, 4):
            for x in range(d0, d0 + 8, 2):
                m.add("grille1x2", LBG, x, GZ0, L)
        if L == 7:
            row(m, "p", LBG, d0, GZ0, 8, 7)
            m.add("p1x3", BLACK, d0, GZ0, 8)
            m.add("p1x2", LBG, d0 + 3, GZ0, 8)
            m.add("p1x3", BLACK, d0 + 5, GZ0, 8)
            row(m, "p", LBG, d0, GZ0, 8, 9)
        if L == 4:
            m.step()
            m.step("The row of windows across the top of the door, and the wall over it.")
    m.step()
    fill_rect(m, "p", WHITE, GX0, GZ0, GX1 - GX0, GZ1 - GZ0, G_DECK, along="z")
    m.step()
    build_roofs(m, [Roof(GX0, GX1, GZ0, GZ1, G_ROOF, "z", pitch=45, color=ROOF, trim=RAKE,
                         widths=(4, 2, 1), trim_ends=("start",), wall=SIDING, name="garage")])
    gm.width, gm.depth = GX1 - GX0, GZ1 - GZ0
    return gm


# --------------------------------------------------------------------------
# the house
# --------------------------------------------------------------------------
HX0, HX1 = 17, 37              # x 17..36
PZ0, HZ0, HZ1 = 15, 18, 30     # porch z 15..17, walls z 18..29
UZ0, SPLIT = 21, 25            # upper storey: left part from z 21, right part x >= 25
LEFT_GABLE_X1 = 27             # the set-back gable covers x 17..26 (10 studs)
FLOOR1 = (4, 7, 10, 13)
FLOOR1_ALL = (1,) + FLOOR1     # with the foundation course
FLOOR2 = (17, 20, 23, 26)
FLOOR_DECK, EAVE_DECK, MAIN_ROOF = 16, 29, 30
DOOR_X = (20, 21)
PIERS = (HX0, SPLIT - 1, HX1 - 1)     # porch piers and columns (x, at z 15)
BIG_WIN_X = 29                 # the two big front windows, x 29..32
SMALL_WIN_X = SPLIT - 2        # the small upstairs window under the set-back gable

# windows: (kind, x, z, layer, face); "143" is a white 1x4x3 frame, "p" a clear panel
WINDOWS1 = [("143", BIG_WIN_X, HZ0, 4, "front"),
            ("p", 20, HZ1 - 1, 7, "back"), ("p", 31, HZ1 - 1, 7, "back"),
            ("p", HX1 - 1, 24, 7, "right")]
WINDOWS2 = [("143", BIG_WIN_X, HZ0, 20, "front"), ("p", SMALL_WIN_X, UZ0, 23, "front"),
            ("p", 20, HZ1 - 1, 20, "back"), ("p", 31, HZ1 - 1, 20, "back"),
            ("p", HX1 - 1, 24, 20, "right")]


def _window_cells(wins):
    cells = set()
    for kind, x, z, layer, face in wins:
        w, h = (4, 9) if kind == "143" else (2, 6)
        span = [(x + i, z) for i in range(w)] if face in ("front", "back") else \
            [(x, z + i) for i in range(w)]
        for c in span:
            for L in range(layer, layer + h):
                cells.add((c[0], c[1], L))
    return cells


def _place_windows(m, wins, layer):
    for kind, x, z, L, face in wins:
        if L != layer:
            continue
        if kind == "143":
            window143(m, x, z, L, face)
        else:
            panel_window(m, x, z, L, face)


def build_house():
    hm = Model("house.ldr", "House with porch")
    m = Offset(hm, HX0, PZ0, 1)

    # ---------------- ground floor ----------------
    ring1 = WallRing([(HX0, HZ0), (HX1 - 1, HZ0), (HX1 - 1, HZ1 - 1), (HX0, HZ1 - 1)])
    open1 = _window_cells(WINDOWS1)
    back_corners = {(HX0, HZ1 - 1), (HX1 - 1, HZ1 - 1)}
    cols1 = Columns([(c, FLOOR1_ALL) for c in back_corners]
                    + [((x, HZ0), (4, 7, 10)) for x in (DOOR_X[0] - 1, DOOR_X[1] + 1)])

    def mat1(x, z, layer):
        if (x, z, layer) in open1 or (x, z, layer) in cols1.cells:
            return None
        if x == HX0 and HZ0 < z < GZ1 - 1:
            return None                           # the garage's side wall stands here
        if z == HZ0:
            if layer == 1:
                return None                       # the porch base bricks run under it
            if x in DOOR_X and layer < 13:
                return None
            if layer == 13 and DOOR_X[0] - 1 <= x <= DOOR_X[1] + 1:
                return ("b", TRIM)                # header
            return ("stone",)
        return ("b", SIDING)

    def floor1(L, parity):
        ring1.course(m, L, parity, mat1)
        cols1.place(m, L)
        if L in (4, 7, 10):
            m.add("b1x2", BLACK, DOOR_X[0], HZ0, L)
            place_rect(m, "b", BLACK, BIG_WIN_X, HZ0 + 1, 4, 1, L)
        _place_windows(m, WINDOWS1, L)

    # two courses per step, so the white corner boards are tied in by the floor soon
    m.step("The porch base and the first courses. Its light grey bricks run back under the "
           "stone front. Slide the glass into the window frame first.")
    ring1.course(m, 1, 1, mat1)
    cols1.place(m, 1)
    # porch base: light grey 2 x 4 bricks running back under the front wall, so the stone
    # wall ties them together; they also cross the base-plate seam at z = 16. The two
    # under the big window are 2 x 6, to carry the dark backing behind its glass.
    for x in range(HX0, HX1, 2):
        if BIG_WIN_X <= x < BIG_WIN_X + 4:
            m.add("nh_b2x6", LBG, x, PZ0, 1, rot=90)
        else:
            place_rect(m, "b", LBG, x, PZ0, 2, 4, 1)
    floor1(4, 0)
    floor1(7, 1)
    m.step()

    # ---------------- porch ----------------
    m.step("The porch: stone piers, a light grey floor, two pots, two chairs and a table.")
    pier_cells = {(x, z) for x in PIERS for z in (PZ0, PZ0 + 1)}
    pots = [(DOOR_X[0] - 1, HZ0 - 1), (DOOR_X[1] + 1, HZ0 - 1)]
    chairs = [(BIG_WIN_X, HZ0 - 1), (BIG_WIN_X + 3, HZ0 - 1)]
    table = [(BIG_WIN_X + 1, HZ0 - 1), (BIG_WIN_X + 2, HZ0 - 1)]
    for x in PIERS:
        m.add("masonry", stone_colour(x, PZ0, 4), x, PZ0, 4, rot=90)
        m.add("masonry", stone_colour(x, PZ0, 7), x, PZ0, 7, rot=90)
    floor = rect(HX0, PZ0, HX1 - HX0, HZ0 - PZ0) - pier_cells - set(pots) - set(chairs) - set(table)
    fill_cells(m, "t", LBG, floor, 4)
    for x, z in pots:
        m.add("round1", DBG, x, z, 4)
        m.add("leaves1", GREEN, x, z, 7, rot=0)
        m.add("leaves1", GREEN, x, z, 8, rot=180)
    for x, z in chairs:
        m.add("p1x1", BLACK, x, z, 4)
        m.add("cheese", BLACK, x, z, 5, rot=FACE["front"])
    m.add("p1x2", BLACK, table[0][0], table[0][1], 4)
    m.add("t1x2", BLACK, table[0][0], table[0][1], 5)
    m.step()

    # ---------------- top courses, columns and the floor ----------------
    m.step("The white columns, the last courses and the floor: white plates over the porch "
           "and round the walls make the white band between the storeys.")
    floor1(10, 0)
    floor1(13, 1)
    for x in PIERS:
        m.add("b1x1", WHITE, x, PZ0, 10)
        m.add("b1x1", WHITE, x, PZ0, 13)
    # white plates: the porch ceiling (its edge is the porch beam) and the front of the
    # house, carrying the window backing; then 2-wide bands round the walls (the short
    # plates at the back corners tie the side walls, corner boards and back wall
    # together), and a strip under the set-back upper wall
    fill_cells(m, "p", WHITE, rect(HX0, PZ0, HX1 - HX0, UZ0 - PZ0), FLOOR_DECK)
    for x in (HX0, HX1 - 2):
        place_rect(m, "p", WHITE, x, UZ0, 2, 6, FLOOR_DECK)
        place_rect(m, "p", WHITE, x, UZ0 + 6, 2, HZ1 - UZ0 - 6, FLOOR_DECK)
    fill_rect(m, "p", WHITE, HX0 + 2, HZ1 - 2, HX1 - HX0 - 4, 2, FLOOR_DECK, along="x")
    fill_rect(m, "p", WHITE, HX0 + 2, UZ0, SPLIT - HX0 - 1, 2, FLOOR_DECK, along="x")
    m.step()

    # ---------------- upper storey ----------------
    outline2 = [(HX0, UZ0), (SPLIT, UZ0), (SPLIT, HZ0), (HX1 - 1, HZ0), (HX1 - 1, HZ1 - 1),
                (HX0, HZ1 - 1)]
    ring2 = WallRing(outline2)
    open2 = _window_cells(WINDOWS2)
    corners2 = {(HX0, UZ0), (SPLIT, HZ0), (HX1 - 1, HZ0), (HX1 - 1, HZ1 - 1), (HX0, HZ1 - 1)}
    cols2 = Columns([(c, FLOOR2) for c in corners2])

    def mat2(x, z, layer):
        if (x, z, layer) in open2 or (x, z, layer) in cols2.cells:
            return None
        if z == UZ0 and x in (SMALL_WIN_X - 1, SPLIT) and layer >= 23:
            return ("b", TRIM)                    # casing of the small upstairs window
        return ("b", SIDING)

    for i, L in enumerate(FLOOR2):
        if L == 17:
            m.step("The upper storey: navy walls with white corner boards. Black bricks "
                   "behind the windows make the glass look dark.")
        ring2.course(m, L, i, mat2)
        cols2.place(m, L)
        place_rect(m, "b", BLACK, BIG_WIN_X, HZ0 + 1, 4, 1, L)
        place_rect(m, "b", BLACK, SMALL_WIN_X, UZ0 + 1, 2, 1, L)
        _place_windows(m, WINDOWS2, L)
        if L == 20:
            m.step()
    m.step()

    # ---------------- eave deck ----------------
    # strips from front to back, so every plate rests on a wall
    fill_rect(m, "p", WHITE, SPLIT, HZ0, HX1 - SPLIT, HZ1 - HZ0, EAVE_DECK, along="z")
    fill_rect(m, "p", WHITE, HX0, UZ0, SPLIT - HX0, HZ1 - UZ0, EAVE_DECK, along="z")
    m.step()

    # ---------------- porch roofs ----------------
    m.step("The porch roofs: a shed roof over the window and a small gable over the door.")
    for x in range(SPLIT, HX1 - 1, 2):
        m.add("s33x2", ROOF, x, PZ0, 17, rot=FACE["front"])
    row(m, "t", ROOF, SPLIT, HZ0 - 1, HX1 - SPLIT, 20)      # flashing along the wall
    m.step()
    build_roofs(m, [Roof(HX0, SPLIT, PZ0, UZ0, 17, "z", pitch=45, color=ROOF, trim=RAKE,
                         widths=(4, 2, 1), trim_ends=("start",), wall=SIDING,
                         wall_ends=("start",), name="porch gable")])

    # ---------------- the two front gables ----------------
    m.step("The two upstairs gables are built together, one row of slopes at a time.")
    build_roofs(m, [
        Roof(HX0, LEFT_GABLE_X1, UZ0, HZ1, MAIN_ROOF, "z", pitch=45, color=ROOF, trim=RAKE,
             widths=(4, 2, 1), trim_ends=("start",), wall=SIDING, priority=0,
             name="left gable"),
        Roof(SPLIT, HX1, HZ0, HZ1, MAIN_ROOF, "z", pitch=45, color=ROOF, trim=RAKE,
             widths=(4, 2, 1), trim_ends=("start",), wall=SIDING, priority=1,
             name="right gable"),
    ], support_caps=True)
    hm.width, hm.depth = HX1 - HX0, HZ1 - PZ0
    return hm


# --------------------------------------------------------------------------
# the car: a bronze compact SUV, nose toward the garage
# --------------------------------------------------------------------------
def build_car():
    m = Model("car.ldr", "Compact SUV")
    body = DTAN
    for x, face in ((0, "left"), (3, "right")):
        m.add("b1x1", BLACK, x, 0, 0)
        m.add("stud_side", BLACK, x, 1, 0, rot=FACE[face])
        place_rect(m, "b", body, x, 2, 1, 2, 0)
        m.add("stud_side", BLACK, x, 4, 0, rot=FACE[face])
        m.add("b1x1", BLACK, x, 5, 0)
    place_rect(m, "b", body, 1, 0, 2, 4, 0)
    place_rect(m, "b", body, 1, 4, 2, 2, 0)
    m.step()
    for brick in [it for it in m.items if it.key == "stud_side"]:
        face = {FACE["left"]: "left", FACE["right"]: "right"}[brick.rot]
        side_tile(m, brick, BLACK, face)
    m.step()
    place_rect(m, "p", body, 0, 0, 2, 6, 3)
    place_rect(m, "p", body, 2, 0, 2, 6, 3)
    m.step()
    for x in range(4):
        place_rect(m, "b", BLACK, x, 1, 1, 4, 4)
    m.add("t1x1", RED, 0, 0, 4)
    m.add("t1x2", body, 1, 0, 4)
    m.add("t1x1", RED, 3, 0, 4)
    m.add("t1x2", body, 0, 5, 4)
    m.add("t1x2", body, 2, 5, 4)
    m.step()
    place_rect(m, "p", body, 0, 1, 2, 4, 7)
    place_rect(m, "p", body, 2, 1, 2, 4, 7)
    m.step()
    m.width, m.depth = 4, 6
    return m


# --------------------------------------------------------------------------
# the lot
# --------------------------------------------------------------------------
BASE_W, BASE_D = 48, 32
SEAMS = {16, 32}
DRIVE_X0, DRIVE_X1 = 4, GX1           # x 4..16: the garage width and an apron to the left
CAR_AT = (8, 7)
MAILBOX = (2, 3)
TREE = (42, 11)
STEPS = rect(DOOR_X[0] - 1, 13, 4, 2)
WALK = (rect(17, 6, 3, 1) | rect(17, 7, 4, 1) | rect(19, 8, 3, 1) | rect(20, 9, 2, 3)
        | rect(19, 12, 4, 1))
BED_LEFT = rect(17, 8, 3, 7) - WALK - STEPS
BED_PORCH = rect(23, 13, 14, 2)
BED_RIGHT = (rect(37, 13, 6, 2) | rect(35, 12, 9, 1) | rect(37, 11, 7, 1)
             | rect(39, 10, 5, 1) | rect(40, 9, 3, 1))


def _runs_x(cells):
    """Runs of cells along x: [(x0, z, n)]."""
    out = []
    for z in sorted({c[1] for c in cells}):
        xs = sorted(x for (x, zz) in cells if zz == z)
        for x in xs:
            if out and out[-1][1] == z and out[-1][0] + out[-1][2] == x:
                out[-1][2] += 1
            else:
                out.append([x, z, 1])
    return out


def build_main(garage, house, car):
    m = Model("navy_house.ldr", "Navy craftsman house")
    m.header_notes = ["Unofficial fan model of a navy craftsman house, generated by design.py "
                      "(lego-kit)."]
    m.section("The lot", "Six 16 x 16 plates make the base. The street, the sidewalk and the "
              "lawn plates lock them together.")
    for z in (0, 16):
        for x in (0, 16, 32):
            m.add("p16x16", DBG, x, z, 0)
    m.step()

    taken = set()
    # street, curb and sidewalk along the front edge
    for z in (0, 1):
        row(m, "t", DBG, 0, z, BASE_W, 1, avoid=SEAMS)
    row(m, "t", LBG, 0, 2, BASE_W, 1, avoid=SEAMS)
    for z in (4, 5):
        row(m, "t", LBG, 0, z, BASE_W, 1, avoid=SEAMS)
    taken |= rect(0, 0, BASE_W, 3) | rect(0, 4, BASE_W, 2)
    # lawn plates across the base-plate seams, so all six base plates are tied now
    for x, z, w, d in ((0, 15, 6, 2), (40, 15, 8, 2), (13, 28, 4, 2), (28, 31, 8, 1)):
        place_rect(m, "p", GREEN, x, z, w, d, 1)
        taken |= rect(x, z, w, d)
    m.step()

    # driveway: concrete tiles, plates under the car so it can be clipped on
    car_cells = rect(CAR_AT[0], CAR_AT[1], 4, 6)
    drive = rect(DRIVE_X0, 3, DRIVE_X1 - DRIVE_X0, 1) | rect(DRIVE_X0, 6, DRIVE_X1 - DRIVE_X0, 8)
    fill_cells(m, "p", LBG, car_cells, 1)
    for x0, z, n in _runs_x(drive - car_cells):
        row(m, "t", LBG, x0, z, n, 1)
    taken |= drive
    m.step()

    # footprints of the garage and the house (porch included)
    taken |= rect(GX0, GZ0, GX1 - GX0, GZ1 - GZ0) | rect(HX0, PZ0, HX1 - HX0, HZ1 - PZ0)

    # porch steps, the paver walk and the mulch beds
    sx = DOOR_X[0] - 1
    place_rect(m, "p", LBG, sx, 14, 4, 1, 1)
    place_rect(m, "p", LBG, sx, 14, 4, 1, 2)
    place_rect(m, "t", LBG, sx, 14, 4, 1, 3)
    place_rect(m, "p", LBG, sx, 13, 4, 1, 1)
    place_rect(m, "t", LBG, sx, 13, 4, 1, 2)
    fill_cells(m, "t", TAN, WALK, 1)
    taken |= STEPS | WALK
    beds = (BED_LEFT | BED_PORCH | BED_RIGHT) - taken
    fill_cells(m, "p", BLACK, beds, 1)
    taken |= beds
    m.step()

    # lawn everywhere else
    lawn = rect(0, 0, BASE_W, BASE_D) - taken
    front = {c for c in lawn if c[1] < 16}
    fill_cells(m, "p", GREEN, front, 1)
    m.step()
    fill_cells(m, "p", GREEN, lawn - front, 1)
    m.step()

    m.sub(garage, GX0, GZ0, 1)
    m.step()
    m.sub(house, HX0, PZ0, 1)
    m.step()

    m.section("The garden", "Boxwoods, grasses and flowering shrubs in the beds, the young "
              "tree, the mailbox by the driveway and the car.")
    boxwoods = [(17, 9), (18, 11), (17, 13), (24, 14), (27, 14), (30, 14), (33, 14), (36, 14),
                (38, 13), (41, 13)]
    for x, z in boxwoods:
        m.add("leaves1", GREEN, x, z, 2, rot=0)
        m.add("leaves1", GREEN, x, z, 3, rot=180)
    grasses = [(19, 10), (18, 8), (25, 13), (35, 12), (39, 11), (43, 12)]
    for x, z in grasses:
        m.add("leaves1", BRGREEN, x, z, 2, rot=45)
    for x, z in [(23, 13), (26, 13), (29, 13), (32, 13), (37, 12), (40, 12), (41, 10)]:
        m.add("round_p1", PINK, x, z, 2)
    for x, z in [(28, 14), (31, 13), (34, 13), (39, 14), (42, 13), (38, 11)]:
        m.add("flower1", RED, x, z, 2)
    m.step()
    # young tree: a trunk of round bricks through a round canopy, wide leaves below and
    # smaller lime ones on top
    tx, tz = TREE
    for L in (2, 5, 8):
        m.add("round1", RBROWN, tx, tz, L)
    for i, rot in enumerate((0, 72, 144, 216)):
        m.add("leaves6x5", BRGREEN, tx, tz, 11 + i, rot=rot)
    m.add("nh_leaves4x3", LIME, tx, tz, 15, rot=45)
    m.add("nh_leaves4x3", LIME, tx, tz, 16, rot=225)
    m.add("leaves1", BRGREEN, tx, tz, 17, rot=0)
    # mailbox on a wooden post by the driveway
    m.add("round1", RBROWN, MAILBOX[0], MAILBOX[1], 2)
    m.add("round1", RBROWN, MAILBOX[0], MAILBOX[1], 5)
    m.add("p1x2", BLACK, MAILBOX[0], MAILBOX[1] - 1, 8, rot=90)
    m.add("curve2x1", BLACK, MAILBOX[0], MAILBOX[1] - 1, 9, rot=0)
    m.step()
    m.sub(car, CAR_AT[0], CAR_AT[1], 2)
    m.step()
    return m


def build():
    saved = {k: bricks.ALLOWED.get(k) for k in EXTRA_ALLOWED}
    saved_run = walls._stone_run
    bricks.ALLOWED.update(EXTRA_ALLOWED)
    walls._stone_run = _stone_run
    try:
        garage, house, car = build_garage(), build_house(), build_car()
        main_m = build_main(garage, house, car)
        return main_m, [main_m, garage, house, car]
    finally:
        walls._stone_run = saved_run
        for k, v in saved.items():
            if v is None:
                del bricks.ALLOWED[k]
            else:
                bricks.ALLOWED[k] = v
