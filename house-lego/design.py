"""A two-storey family home with a front-gable garage, stone gable and porch.

Build with the shared kit:  ./build.sh

Scale: 1 stud = 2 ft (1:76, HO scale); one storey = 4 bricks.
Lot 48 x 32 studs (38 x 26 cm); the roof ridge is 40 plates (13 cm) up.

Grid (studs): x to the right, z toward the back; the street is at z = 0.
  garage  x  8..22, z 15..27   one storey, front gable, two-car door
  house   x 22..40, z 17..31   two storeys, side-gable roof
  stone   x 22..30, z 14..17   two-storey stone front with a steep gable
  porch   x 30..40, z 14..17   covered porch with a metal roof
"""
from bricks import (Model, Offset, PARTS, row, fill_rect, fill_cells, place_rect,
                    rot_matrix, FACE, WHITE, BLACK, DBG, LBG, GREEN, TAN, RBROWN,
                    DTAN, RED, PINK, MLAVENDER, TYELLOW, TCLEAR)
from roofs import Roof, build_roofs
from walls import WallRing, stone_colour

SIDING = DBG
TRIM = WHITE
ROOF = BLACK

PROJECT = dict(
    model_name="family_home",
    pdf_name="Family_Home_Instructions.pdf",
    title="Family Home",
    subtitle="A two-storey house with stone gable and porch, in LEGO&reg; bricks",
    cover_stats=("38 &times; 26 cm", "48 &times; 32 studs"),
    badge="Custom model",
    fine_print=("A custom model (MOC) designed from a photo of the house. It is not affiliated "
                "with, sponsored or endorsed by The LEGO Group. LEGO&reg; is a trademark of The "
                "LEGO Group."),
    about=("This model recreates the house in the photo: the two-car garage with its carriage "
           "door and white-trimmed gable, the two-storey stacked-stone front with its steep "
           "gable, the covered porch with white columns, railing and a black metal roof, and "
           "the charcoal siding under a black shingle roof. The lot has the driveway, sidewalk, "
           "flower beds, a lamp post, a young tree, the stepped retaining wall and the car."),
    facts=[("Size", "48 &times; 32 studs (38.4 &times; 25.6 cm), 13 cm tall to the ridge"),
           ("Scale", "about 1:76 (1 stud = 2 ft, one storey = 4 bricks)"),
           ("Build time", "about 4 to 5 hours")],
    organisation=["The lot: base, sidewalk, driveway and lawn", "The garage",
                  "The house: walls, porch and roofs", "The car",
                  "The garden: beds, lamp post, tree and retaining wall"],
    organisation_note=("The garage, the house and the car are built on their own and then set "
                       "on the lot. Every section starts with a list of the parts it needs."),
    tips=["The stone front uses masonry-profile 1&times;2 bricks in four colours. The exact "
          "colour order doesn't matter, so mix them as you like.",
          "Windows come in two parts: slide the clear glass into each white frame before you "
          "place it.",
          "Each floor is four courses of bricks. The corners swap from course to course, so "
          "follow the pictures closely where two walls meet.",
          "The roof is built one row of slopes at a time. Where the stone gable meets the main "
          "roof, the slopes step around each other to form the valley."],
    legend=("car.ldr", 1),
    sub_info={
        "garage.ldr": ("The garage",
                       "The two-car garage with its white carriage door, coach lamps, and a "
                       "front gable with white trim and a louvred vent."),
        "house.ldr": ("The house",
                      "Two storeys of charcoal siding with a stacked-stone front, the covered "
                      "porch, and the roofs: a side-gable main roof crossed by the steep stone "
                      "gable."),
        "car.ldr": ("The car", "A grey SUV for the driveway."),
    },
    section_images={"The lot": "cover_high", "The garden": "cover_front_left"},
    section_image_default="cover_front_right",
    hero_views=[("cover_front_right", 22, 30), ("cover_front_left", 22, -30),
                ("cover_front", 10, 0), ("cover_high", 50, 20), ("back", 28, 150)],
    cover_view="cover_front_right",
    gallery=["cover_front", "cover_front_left", "cover_high", "back"],
    substitutions=[
        "<b>Base:</b> six 16&times;16 plates. Any plates that cover 48&times;32 studs will do.",
        "<b>Stone:</b> mix the four colours of masonry bricks freely; plain bricks work too.",
        "<b>Hidden parts:</b> the floor plates and the fillers under the roof can be any colour.",
        "<b>Car:</b> pick any colour to match your own car."],
    order_cap_note=("Every element this model needs more than 10 of was in the Bestseller "
                    "range. The window frames and glass are Standard elements, so the model "
                    "uses at most 10 of each."),
    colour_rows=[("Light Bluish Gray", "Medium Stone Grey", "Light Bluish Gray"),
                 ("Dark Bluish Gray", "Dark Stone Grey", "Dark Bluish Gray"),
                 ("Green", "Dark Green", "Green"),
                 ("Tan / Dark Tan", "Brick Yellow / Sand Yellow", "Tan / Dark Tan"),
                 ("Bright Pink", "Light Purple", "Bright Pink"),
                 ("Trans-Clear", "Transparent", "Trans-Clear")],
)


# --------------------------------------------------------------------------
# small helpers
# --------------------------------------------------------------------------
def window(m, kind, x, z, layer, face):
    """A white window frame with clear glass, facing `face`."""
    frame = m.add("win" + kind, WHITE, x, z, layer, rot=FACE[face])
    ox, oy, oz, mat, _ = frame.ldraw
    # the frame's ldraw position is in submodel coordinates; add_raw on an
    # Offset expects parent coordinates, so go to the model directly
    target = m.model if isinstance(m, Offset) else m
    target.add_raw("glass" + kind, TCLEAR, (ox, oy, oz), mat, attach_to=frame)
    return frame


SNOT_FRONT = (1, 0, 0, 0, 0, -1, 0, 1, 0)    # tile bottom (+y) turned to face +z


def side_tile(m, brick, color, face, stud_y=10):
    """A 1x1 round tile on the side stud of a brick facing `face`."""
    ox, oy, oz, mat, _ = brick.ldraw
    # local offset from the brick origin to the tile origin, before turning
    lx, ly, lz = 0, stud_y, -18
    rot = FACE[face]
    ry = rot_matrix(rot)
    wx = ry[0] * lx + ry[2] * lz
    wz = ry[6] * lx + ry[8] * lz
    t = SNOT_FRONT
    # compose: world = Ry * T
    m3 = [[ry[0], ry[1], ry[2]], [ry[3], ry[4], ry[5]], [ry[6], ry[7], ry[8]]]
    t3 = [[t[0], t[1], t[2]], [t[3], t[4], t[5]], [t[6], t[7], t[8]]]
    comp = [sum(m3[i][k] * t3[k][j] for k in range(3)) for i in range(3) for j in range(3)]
    target = m.model if isinstance(m, Offset) else m
    return target.add_raw("tile_round1", color, (ox + wx, oy + ly, oz + wz), tuple(comp),
                          attach_to=brick)


# --------------------------------------------------------------------------
# the garage
# --------------------------------------------------------------------------
GX0, GX1, GZ0, GZ1 = 8, 22, 15, 27
DOOR_X = range(11, 19)
LAMPS_G = (10, 19)


def build_garage():
    gm = Model("garage.ldr", "Two-car garage")
    m = Offset(gm, GX0, GZ0, 1)
    fill_rect(m, "p", LBG, GX0, GZ0, GX1 - GX0, GZ1 - GZ0, 1, along="x")
    m.step()
    ring = WallRing([(GX0, GZ0), (GX1 - 1, GZ0), (GX1 - 1, GZ1 - 1), (GX0, GZ1 - 1)])
    corners = {(GX0, GZ0), (GX1 - 1, GZ0), (GX1 - 1, GZ1 - 1), (GX0, GZ1 - 1)}

    def mat(x, z, layer):
        if z == GZ0 and x in DOOR_X and layer < 11:
            return None
        if z == GZ0 and x in LAMPS_G and layer == 5:
            return None
        if (x, z) in corners:
            return ("b", TRIM)
        return ("b", SIDING)

    for i, L in enumerate((2, 5, 8, 11)):
        ring.course(m, L, i, mat)
        if L == 2:
            row(m, "b", WHITE, 11, GZ0, 8, 2)
        if L == 5:
            row(m, "b", WHITE, 11, GZ0, 8, 5, avoid={4})
            for x in LAMPS_G:
                lamp = m.add("headlight", BLACK, x, GZ0, 5)
                side_tile(m, lamp, TYELLOW, "front")
        if L == 8:
            # carriage door: a band of small windows near the top
            row(m, "p", WHITE, 11, GZ0, 8, 8)
            for x in range(11, 19, 2):
                m.add("p1x2", BLACK, x, GZ0, 9)
            row(m, "p", WHITE, 11, GZ0, 8, 10)
        m.step()
    fill_rect(m, "p", WHITE, GX0, GZ0, GX1 - GX0, GZ1 - GZ0, 14, along="z")
    m.step()

    def gable(mm, cells, layer):
        """Siding in the gable, with a white louvred vent in the front one."""
        vent = [(x, z) for (x, z) in cells if z == GZ0 and x in (14, 15) and layer == 18]
        if len(vent) == 2:
            mm.add("grille1x2", WHITE, 14, GZ0, layer)
        rest = [c for c in cells if c not in vent]
        for (x, z), n in _runs(rest):
            row(mm, "b", SIDING, x, z, n, layer)

    build_roofs(m, [Roof(GX0, GX1, GZ0, GZ1, 15, "z", pitch=33, color=ROOF, trim=TRIM,
                         trim_ends=("start", "end"), wall=gable, name="garage")])
    gm.width, gm.depth = GX1 - GX0, GZ1 - GZ0
    return gm


def _runs(cells):
    """Runs of cells along x (same z)."""
    cells = sorted(cells, key=lambda c: (c[1], c[0]))
    out = []
    for c in cells:
        if out and out[-1][0][1] == c[1] and out[-1][0][0] + out[-1][1] == c[0]:
            out[-1] = (out[-1][0], out[-1][1] + 1)
        else:
            out.append((c, 1))
    return out


# --------------------------------------------------------------------------
# the house
# --------------------------------------------------------------------------
HX0, HX1, HZ0, HZ1 = 22, 40, 17, 31        # main block
SX0, SX1, SZ0 = 22, 30, 14                  # stone front x 22..29, z 14..16
PX0, PX1 = 30, 40                           # porch x 30..39, z 14..16
DOOR = (31, 32)
FLOOR1 = (4, 7, 10, 13)
FLOOR2 = (17, 20, 23, 26)

# windows: (kind, x, z, layer, face)
WINDOWS = [
    ("123", 23, 14, 7, "front"), ("123", 25, 14, 7, "front"), ("123", 27, 14, 7, "front"),
    ("122", 24, 14, 20, "front"), ("122", 26, 14, 20, "front"),
    ("123", 35, 17, 7, "front"), ("123", 37, 17, 7, "front"),
    ("122", 31, 17, 20, "front"),
    ("122", 39, 22, 7, "right"), ("122", 39, 22, 20, "right"),
    ("122", 25, 30, 7, "back"), ("122", 34, 30, 7, "back"),
    ("122", 25, 30, 20, "back"), ("122", 34, 30, 20, "back"),
]


def _window_cells():
    cells = {}
    for kind, x, z, layer, face in WINDOWS:
        h = 9 if kind == "123" else 6
        span = [(x, z), (x + 1, z)] if face in ("front", "back") else [(x, z), (x, z + 1)]
        for c in span:
            for L in range(layer, layer + h):
                cells[(c[0], c[1], L)] = True
    return cells


def is_stone(x, z):
    return (SX0 <= x < SX1 and z == SZ0) or (x in (SX0, SX1 - 1) and SZ0 <= z < HZ0) or \
        (x == SX1 - 1 and z == HZ0)


def build_house():
    hm = Model("house.ldr", "Two-storey house with porch")
    m = Offset(hm, HX0, SZ0, 1)
    outline = [(SX0, SZ0), (SX1 - 1, SZ0), (SX1 - 1, HZ0), (HX1 - 1, HZ0), (HX1 - 1, HZ1 - 1),
               (HX0, HZ1 - 1)]
    ring = WallRing(outline)
    wcells = _window_cells()
    corner_trim = {(HX1 - 1, HZ0), (HX1 - 1, HZ1 - 1), (HX0, HZ1 - 1)}

    def mat(x, z, layer):
        if (x, z, layer) in wcells:
            return None
        if z == HZ0 and x in DOOR and 4 <= layer < 16:
            return None
        if is_stone(x, z):
            return ("stone",)
        if (x, z) in corner_trim:
            return ("b", TRIM)
        if z == HZ0 and x in (30, 33) and 4 <= layer < 16:
            return ("b", TRIM)                    # door casing
        if z == HZ0 and x in (30, 33) and 20 <= layer < 26:
            return ("b", BLACK)                   # shutters
        return ("b", SIDING)

    def place_windows(layer):
        for kind, x, z, L, face in WINDOWS:
            if L == layer:
                window(m, kind, x, z, L, face)

    # --- foundation course and porch base ---
    ring.course(m, 1, 1, mat)
    for x in range(PX0, PX1 - 1, 2):
        m.add("masonry", stone_colour(x, 14, 1), x, 14, 1)
    m.add("masonry", stone_colour(39, 15, 1), 39, 15, 1, rot=90)
    for x in (30, 34):
        m.add("b2x4", LBG, x, 15, 1)
    m.add("b1x2", LBG, 38, 15, 1, rot=90)
    m.step()

    # --- first floor ---
    for i, L in enumerate(FLOOR1):
        ring.course(m, L, i, mat)
        if L == 4:
            m.add("p1x2", WHITE, 31, HZ0, 4)
        if L in (4, 7, 10):
            m.add("b1x2", BLACK, 31, HZ0, L + 1)
        place_windows(L)
        if L == 13:
            m.add("p1x2", WHITE, 31, HZ0, 14)
            m.add("p1x2", WHITE, 31, HZ0, 15)
        m.step()

    # --- porch: floor, columns and railing ---
    columns = [(30, 14), (34, 14), (39, 14)]
    # porch floor tiles, laid so they tie the porch base bricks together
    for x in (31, 32):
        m.add("t1x3", LBG, x, 14, 4, rot=90)
    m.add("t1x2", LBG, 30, 15, 4, rot=90)
    m.add("t1x1", LBG, 33, 14, 4)
    for x0, z in ((33, 15), (35, 15), (37, 15), (33, 16), (35, 16), (38, 16)):
        m.add("t1x2", LBG, x0, z, 4)
    m.add("t1x1", LBG, 39, 15, 4)
    m.add("t1x1", LBG, 37, 16, 4)
    for x, z in columns:
        m.add("b1x1x3", WHITE, x, z, 4)
    # railing: a spindled fence with a tile for the hand rail
    m.add("fence_sp", WHITE, 35, 14, 4)
    m.step()
    m.add("t1x4", WHITE, 35, 14, 10)
    for x, z in columns:
        m.add("b1x1", WHITE, x, z, 13)
    m.step()

    # --- floor between storeys (white over the porch as its beam and ceiling) ---
    porch_band = {(x, z) for x in range(PX0, PX1) for z in range(14, 18)}
    stone_band = {(x, z) for x in range(SX0, SX1) for z in range(SZ0, HZ0)}
    wall_band = set(ring.cells()) - porch_band - stone_band
    fill_cells(m, "p", WHITE, porch_band, 16)
    fill_cells(m, "p", LBG, stone_band, 16)
    fill_cells(m, "p", SIDING, wall_band, 16)
    m.step()
    for x in range(PX0, PX1):
        m.add("s33x1", ROOF, x, 14, 17, rot=FACE["front"])
    row(m, "t", ROOF, PX0, 16, PX1 - PX0, 20)       # flashing along the wall
    m.step()

    # --- second floor ---
    for i, L in enumerate(FLOOR2):
        ring.course(m, L, i, mat)
        place_windows(L)
        m.step()

    # --- eave deck: white plates whose edges form the fascia ---
    eave = stone_band | {(x, z) for x in range(HX0, HX1) for z in range(HZ0, HZ1)}
    fill_cells(m, "p", WHITE, eave, 29)
    m.step()

    def stone_gable(mm, cells, layer):
        vent = [(x, z) for (x, z) in cells if z == SZ0 and x in (25, 26) and layer == 33]
        if len(vent) == 2:
            mm.add("grille1x2", WHITE, 25, SZ0, layer)
        rest = sorted(c for c in cells if c not in vent)
        for (x, z), n in _runs(rest):
            i = 0
            while i < n:
                if i + 1 < n:
                    mm.add("masonry", stone_colour(x + i, z, layer), x + i, z, layer)
                    i += 2
                else:
                    mm.add("b1x1", stone_colour(x + i, z, layer), x + i, z, layer)
                    i += 1

    build_roofs(m, [
        Roof(SX0, SX1, SZ0, 24, 30, "z", pitch=45, color=ROOF, trim=TRIM,
             trim_ends=("start",), wall=stone_gable, wall_ends=("start",), priority=0,
             name="stone gable"),
        Roof(HX0, HX1, HZ0, HZ1, 30, "x", pitch=33, color=ROOF, trim=TRIM,
             trim_ends=("start", "end"), wall=SIDING, priority=1, name="main roof"),
    ])
    hm.width, hm.depth = HX1 - HX0, HZ1 - SZ0
    return hm


# --------------------------------------------------------------------------
# the car (a grey SUV, nose toward the garage)
# --------------------------------------------------------------------------
def build_car():
    m = Model("car.ldr", "Grey SUV")
    body = LBG
    for x, face in ((0, "left"), (3, "right")):
        m.add("b1x1", body, x, 0, 0)
        w1 = m.add("stud_side", BLACK, x, 1, 0, rot=FACE[face])
        m.add("b1x4", body, x, 2, 0, rot=90)
        w2 = m.add("stud_side", BLACK, x, 6, 0, rot=FACE[face])
        m.add("b1x1", body, x, 7, 0)
    m.add("b2x4", body, 1, 0, 0, rot=90)
    m.add("b2x4", body, 1, 4, 0, rot=90)
    m.step()
    for brick in [it for it in m.items if it.key == "stud_side"]:
        face = {FACE["left"]: "left", FACE["right"]: "right"}[brick.rot]
        side_tile(m, brick, BLACK, face)
    m.step()
    m.add("p4x8", body, 0, 0, 3, rot=90)
    m.step()
    for x in range(4):
        m.add("b1x4", BLACK, x, 1, 4, rot=90)
        m.add("b1x1", BLACK, x, 5, 4)
    m.step()
    m.add("p4x4", body, 0, 1, 7)
    m.add("p1x4", body, 0, 5, 7)
    m.add("t1x1", RED, 0, 0, 4)
    m.add("t1x2", body, 1, 0, 4)
    m.add("t1x1", RED, 3, 0, 4)
    m.add("t2x2", body, 0, 6, 4)
    m.add("t2x2", body, 2, 6, 4)
    m.step()
    m.width, m.depth = 4, 8
    return m


# --------------------------------------------------------------------------
# the lot
# --------------------------------------------------------------------------
BASE_W, BASE_D = 48, 32
DRIVE_X = (10, 20)
CAR_AT = (12, 5)


def build_main(garage, house, car):
    m = Model("family_home.ldr", "Family home")
    m.header_notes = ["Custom model of a family home, generated by design.py (lego-kit)."]
    m.section("The lot", "Six 16 x 16 plates make the base. The sidewalk, driveway and "
              "lawn lock them together.")
    for z in (0, 16):
        for x in (0, 16, 32):
            m.add("p16x16", DBG, x, z, 0)
    m.step()

    taken = set()
    rect = lambda x0, z0, w, d: {(x, z) for x in range(x0, x0 + w) for z in range(z0, z0 + d)}

    # sidewalk and grass strip along the street
    for z in (1, 2):
        row(m, "t", LBG, 0, z, BASE_W, 1, avoid={16, 32})
    row(m, "p", GREEN, 0, 0, BASE_W, 1, avoid={16, 32})
    taken |= rect(0, 0, BASE_W, 3)
    m.step()

    # driveway: black tile rows (plates under the car so it can be clipped on)
    x0, x1 = DRIVE_X
    car_cells = rect(CAR_AT[0], CAR_AT[1], 4, 8)
    for z in range(3, 15):
        if CAR_AT[1] <= z < CAR_AT[1] + 8:
            row(m, "t", BLACK, x0, z, CAR_AT[0] - x0, 1)
            row(m, "p", BLACK, CAR_AT[0], z, 4, 1)
            row(m, "t", BLACK, CAR_AT[0] + 4, z, x1 - CAR_AT[0] - 4, 1)
        else:
            row(m, "t", BLACK, x0, z, x1 - x0, 1, avoid={16 - x0})
    taken |= rect(x0, 3, x1 - x0, 12)
    m.step()

    # footprints of the garage, house and porch
    taken |= rect(GX0, GZ0, GX1 - GX0, GZ1 - GZ0)
    taken |= rect(HX0, SZ0, HX1 - HX0, HZ1 - SZ0)

    # walkway from the driveway to the porch step, and the step
    walk = rect(20, 10, 14, 1) | rect(31, 11, 3, 2)
    fill_cells(m, "t", LBG, walk, 1)
    taken |= walk | rect(31, 13, 3, 1)
    place_rect(m, "p", LBG, 31, 13, 3, 1, 1)
    place_rect(m, "p", LBG, 31, 13, 3, 1, 2)
    place_rect(m, "t", LBG, 31, 13, 3, 1, 3)
    # flower beds in front of the house (mulch)
    beds = (rect(22, 11, 9, 3) | rect(34, 11, 6, 3)) - taken
    fill_cells(m, "p", RBROWN, beds, 1)
    taken |= beds
    m.step()

    # lawn everywhere else
    lawn = rect(0, 0, BASE_W, BASE_D) - taken
    front = {c for c in lawn if c[1] < 16}
    back = lawn - front
    fill_cells(m, "p", GREEN, front, 1)
    m.step()
    fill_cells(m, "p", GREEN, back, 1)
    m.step()

    m.sub(garage, GX0, GZ0, 1)
    m.step()
    m.sub(house, HX0, SZ0, 1)
    m.step()

    m.section("The garden", "Shrubs and flowers in the beds, a lamp post by the driveway, "
              "a young tree, the stepped retaining wall and the car.")
    shrubs = [(23, 12), (26, 11), (29, 12), (35, 12), (37, 11)]
    for x, z in shrubs:
        m.add("leaves1", GREEN, x, z, 2, rot=0)
        m.add("leaves1", GREEN, x, z, 3, rot=180)
    for x, z in [(24, 13), (25, 11), (27, 13), (28, 11), (30, 13), (36, 13), (38, 13)]:
        m.add("round_p1", PINK, x, z, 2)
    for x, z in [(22, 11), (24, 11), (27, 11), (34, 11)]:
        m.add("flower1", MLAVENDER, x, z, 2)
    m.step()
    # young tree at the right end of the porch
    m.add("round1", RBROWN, 39, 12, 2)
    m.add("round1", RBROWN, 39, 12, 5)
    for i, L in enumerate((8, 9, 10)):
        m.add("leaves1", GREEN, 39, 12, L, rot=(0, 180, 90)[i])
    # lamp post beside the driveway: black post, glowing lantern, black cap
    m.add("round1", BLACK, 21, 12, 2)
    m.add("round1", TYELLOW, 21, 12, 5)
    m.add("cone1", BLACK, 21, 12, 8)
    m.step()
    # stepped retaining wall on the right side of the lot
    for z0, z1, courses in ((12, 18, 1), (18, 24, 2), (24, 31, 3)):
        for c in range(courses):
            L = 2 + 3 * c
            z = z0
            while z < z1:
                n = 2 if z + 1 < z1 else 1
                if n == 2:
                    m.add("masonry", stone_colour(44, z, L), 44, z, L, rot=90)
                else:
                    m.add("b1x1", stone_colour(44, z, L), 44, z, L)
                z += n
    m.step()
    m.sub(car, CAR_AT[0], CAR_AT[1], 2)
    m.step()
    return m


def build():
    garage, house, car = build_garage(), build_house(), build_car()
    main_m = build_main(garage, house, car)
    return main_m, [main_m, garage, house, car]
