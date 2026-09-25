"""Design of the BoardWalk Inn entrance model (about 1:76, like the Family Home).

Build with the shared kit:  ./build.sh

Scale: 1 stud = 2 ft (about 0.6 m). Base 48 x 32 studs (38 x 26 cm).

Grid (studs): x to the right, z toward the back; the road is at z = 0.
The model is symmetric about the middle of column 23: x pairs with 46 - x.
  gatehouse  x 11..35, z 15..26   arched front, towers and lookout on its roof
  wings      x  1..10 and 36..45, z 17..27
  planter    the oval flower bed in front, z 3..14
"""
from bricks import (Model, Offset, PARTS, row, fill_rect, fill_cells, place_rect,
                    rot_matrix, FACE, WHITE, BLACK, DBG, LBG, RED, GREEN, BRGREEN, BLUE,
                    RBROWN, CREAM, GOLD, TAN, DKGREEN)
from roofs import Roof, build_roofs
from walls import WallRing

WALL = WHITE
ROOF = DBG
WINDOW = BLACK
PASSAGE = TAN            # the warm-lit passage behind the arch
LAWN = GREEN
HEDGE = DKGREEN

PROJECT = dict(
    main_parts_label="Grounds and flower bed",
    model_name="boardwalk_entrance",
    pdf_name="BoardWalk_Entrance_Instructions.pdf",
    title="BoardWalk Inn",
    subtitle="The arched entrance gatehouse in LEGO&reg; bricks",
    cover_stats=("38 &times; 26 cm", "48 &times; 32 studs"),
    badge="Unofficial fan design",
    fine_print=("An unofficial fan-designed model (MOC), inspired by the entrance of Disney's "
                "BoardWalk Inn at Walt Disney World. It is not affiliated with, sponsored or "
                "endorsed by The LEGO Group or Disney. LEGO&reg; is a trademark of The LEGO Group."),
    about=("This model shows the entrance of the BoardWalk Inn: the white gatehouse with its big "
           "round arch, the gold lettering around it, round porthole windows and the curved "
           "roofline; the two towers with dark pyramid roofs and white spires; the cream "
           "lookout with its railing; and the low side wings. In front, a hedge rings an oval "
           "bed of red flowers with two topiaries, beside the red-and-blue painted curb."),
    facts=[("Size", "48 &times; 32 studs (38.4 &times; 25.6 cm), 18 cm tall at the spires"),
           ("Scale", "about 1:76 (1 stud = 2 ft), like the Family Home model"),
           ("Build time", "about 4 to 6 hours")],
    organisation=["The grounds: base, road, curb, lawn and the bed's soil",
                  "The gatehouse", "The towers (build 2)", "The side wings (build 2)",
                  "The flower bed: hedge, flowers, topiaries and trees"],
    organisation_note=("The gatehouse, the towers and the wings are built on their own and then "
                       "set on the base. Every section starts with a list of the parts it needs."),
    tips=["The arch steps inward one course at a time with inverted slopes. Their sloped "
          "side always faces the middle of the arch.",
          "The nine gold round plates around the arch stand in for the letters of the "
          "BOARDWALK sign. Each one clips onto a white brick with a stud on one side.",
          "The towers and the side wings are built twice.",
          "The flower bed takes about 90 red flowers and 90 leaves. Build it three rows at a "
          "time, starting at the back."],
    legend=("tree.ldr", 1),
    sub_info={
        "gatehouse.ldr": ("The gatehouse",
                          "The arched front with its gold lettering and portholes, the passage "
                          "to the lobby doors, the curved roofline, and the cream lookout with "
                          "its railing."),
        "tower.ldr": ("The towers",
                      "Two identical towers, each with a row of windows, a dark pyramid roof "
                      "and a white spire."),
        "wing.ldr": ("The side wings", "Two identical low wings with dark hipped roofs."),
        "topiary.ldr": ("Topiary", ""),
        "tree.ldr": ("Shade tree", ""),
    },
    section_images={"The grounds": "cover_high", "The flower bed": "cover_front"},
    section_image_default="cover_front_right",
    hero_views=[("cover_front_right", 20, 30), ("cover_front_left", 20, -30),
                ("cover_front", 8, 0), ("cover_high", 50, 20), ("back", 26, 150)],
    cover_view="cover_front_right",
    gallery=["cover_front", "cover_front_left", "cover_high", "back"],
    substitutions=[
        "<b>Base:</b> six 16&times;16 plates. Any plates that cover 48&times;32 studs will do.",
        "<b>Lettering:</b> if you have printed 1&times;1 letter tiles, you can spell BOARDWALK "
        "on the side studs instead of using gold round plates.",
        "<b>Hidden parts:</b> the roof deck under the towers and the supports inside the roofs "
        "can be any colour.",
        "<b>Flowers:</b> any red 1&times;1 flowers or round plates will do."],
    order_cap_note=("Every element this model needs more than 10 of was in the Bestseller range. "
                    "Four were not on the 2022 Bestseller list (the gold round plates of the "
                    "lettering, the two curved slopes at the top of the arch, two dark green "
                    "1&times;1 bricks and one grey 1&times;12 plate); the model needs 9 or fewer "
                    "of each."),
    colour_rows=[("Light Bluish Gray", "Medium Stone Grey", "Light Bluish Gray"),
                 ("Dark Bluish Gray", "Dark Stone Grey", "Dark Bluish Gray"),
                 ("Green / Dark Green", "Dark Green / Earth Green", "Green / Dark Green"),
                 ("Bright Green", "Bright Green", "Bright Green"),
                 ("Bright Light Yellow", "Cool Yellow", "Bright Light Yellow"),
                 ("Pearl Gold", "Warm Gold", "Pearl Gold"),
                 ("Tan", "Brick Yellow", "Tan")],
)


# --------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------
SNOT_FRONT = (1, 0, 0, 0, 0, -1, 0, 1, 0)    # part bottom (+y) turned to face +z


def side_mount(m, brick, key, color, face="front", stud_y=10):
    """A 1x1 round plate or tile on the side stud of a brick facing `face`."""
    ox, oy, oz, mat, _ = brick.ldraw
    lx, ly, lz = 0, stud_y, -18
    ry = rot_matrix(FACE[face])
    wx = ry[0] * lx + ry[2] * lz
    wz = ry[6] * lx + ry[8] * lz
    m3 = [ry[0:3], ry[3:6], ry[6:9]]
    t3 = [SNOT_FRONT[0:3], SNOT_FRONT[3:6], SNOT_FRONT[6:9]]
    comp = tuple(sum(m3[i][k] * t3[k][j] for k in range(3)) for i in range(3) for j in range(3))
    target = m.model if isinstance(m, Offset) else m
    return target.add_raw(key, color, (ox + wx, oy + ly, oz + wz), comp, attach_to=brick)


def mirror(x, w=1):
    """Column of the mirror image of a piece w studs wide starting at x."""
    return 46 - x - (w - 1)


def runs(xs):
    """Contiguous runs [(x0, n)] of a set of columns."""
    out = []
    for x in sorted(xs):
        if out and out[-1][0] + out[-1][1] == x:
            out[-1] = (out[-1][0], out[-1][1] + 1)
        else:
            out.append((x, 1))
    return out


# --------------------------------------------------------------------------
# the gatehouse: arched front, passage, roof deck, central block and lookout
# --------------------------------------------------------------------------
GX0, GX1, GZ0, GZ1 = 11, 35, 15, 26          # inclusive
COURSES = range(2, 23, 3)                     # 2, 5, ... 20: walls up to layer 23
DECK = 23

# arch: open columns reach up to this layer (the floor is layer 2)
OPEN_TOP = {17: 14, 18: 17, 19: 20, 20: 23}
for _x in range(21, 26):
    OPEN_TOP[_x] = 25
for _x in list(OPEN_TOP):
    OPEN_TOP[mirror(_x)] = OPEN_TOP[_x]
# arch pieces on the left: (key, outer column, layer); each covers x and x + 1
ARCH = [("slope45inv", 16, 14), ("slope45inv", 17, 17), ("slope45inv", 18, 20),
        ("curve2inv", 19, 23)]
CROWN = (19, 27, 25)                          # plate row over the top of the arch

LETTERS = [(15, 14), (17, 20), (18, 23), (21, 26), (23, 26), (25, 26),
           (28, 23), (29, 20), (31, 14)]      # B O A R D W A L K
PORTHOLES = [(14, 11), (32, 11)]

# roofline groups: (columns, wall top, curved piece or None) on the left half
GROUPS = [((11, 12, 13), 25, "curve3"), ((14, 15, 16), 28, "curve3"),
          ((17, 18, 19), 31, "curve3")]
FLAT = (range(20, 27), 33)                    # tiled flat top, x 20..26


def _arch_cells():
    cells = {}
    for key, x, L in ARCH:
        h = PARTS[key].height
        for xx in (x, x + 1, mirror(x), mirror(x + 1)):
            for y in range(L, L + h):
                cells[(xx, y)] = True
    x0, x1, L = CROWN
    for x in range(x0, x1 + 1):
        cells[(x, L)] = True
    return cells


ARCH_CELLS = _arch_cells()
SPECIAL = {(x, L) for x, L in LETTERS + PORTHOLES}


def facade_free(x, L, h=3):
    """True if a plain wall brick can fill column x, layers L..L+h-1 of the front."""
    if (x, L) in SPECIAL:
        return False
    for y in range(L, L + h):
        if y < OPEN_TOP.get(x, 0) or (x, y) in ARCH_CELLS:
            return False
    return True


def wall_top(x):
    for cols, top, _ in GROUPS:
        if x in cols or mirror(x) in cols:
            return top
    return FLAT[1]


def build_gatehouse():
    gm = Model("gatehouse.ldr", "Gatehouse")
    m = Offset(gm, GX0, GZ0, 1)
    fill_rect(m, "p", LBG, GX0, GZ0, GX1 - GX0 + 1, GZ1 - GZ0 + 1, 1, along="z")
    m.step()

    ring = WallRing([(GX0, GZ0), (GX1, GZ0), (GX1, GZ1), (GX0, GZ1)])

    def mat(x, z, layer):
        if z == GZ0:
            return ("b", WALL) if facade_free(x, layer) else None
        if z == GZ1 and x in (14, 17, 20, 26, 29, 32) and layer in (8, 14):
            return ("b", WINDOW)
        return ("b", WALL)

    specials = {}
    for i, L in enumerate(COURSES):
        ring.course(m, L, i, mat)
        # letters and portholes: side-stud bricks with gold or black round parts
        for (x, LL) in LETTERS + PORTHOLES:
            if LL == L:
                specials[(x, LL)] = m.add("stud_side", WALL, x, GZ0, L)
        for key, x, AL in ARCH:
            if AL == L:
                m.add(key, WALL, x, GZ0, L, rot=FACE["right"])
                m.add(key, WALL, mirror(x + 1), GZ0, L, rot=FACE["left"])
        # the passage behind the arch: side walls and the back wall with doors
        for x in (16, 30):
            row(m, "b", PASSAGE, x, GZ0 + 1, 5, L, axis="z")
        if L <= 8:
            row(m, "b", PASSAGE, 17, GZ0 + 6, 4, L)
            row(m, "b", RBROWN, 21, GZ0 + 6, 5, L)
            row(m, "b", PASSAGE, 26, GZ0 + 6, 4, L)
        else:
            row(m, "b", PASSAGE, 17, GZ0 + 6, 13, L)
        m.step()
    # top of the arch: curved pieces, then the plate row over the crown
    for key, x, AL in ARCH:
        if AL not in COURSES:
            m.add(key, WALL, x, GZ0, AL, rot=FACE["right"])
            m.add(key, WALL, mirror(x + 1), GZ0, AL, rot=FACE["left"])
    x0, x1, L = CROWN
    row(m, "p", WALL, x0, GZ0, x1 - x0 + 1, L)
    m.step()
    # roof deck over everything behind the front wall
    fill_rect(m, "p", ROOF, GX0, GZ0 + 1, GX1 - GX0 + 1, GZ1 - GZ0, DECK, along="x")
    m.step()

    # front wall above the deck: courses, then plates up to each group's top
    prev = set()
    for L in (23, 26, 29):
        cols = [x for x in range(GX0, GX1 + 1) if L + 3 <= wall_top(x) and facade_free(x, L)]
        for (x, LL) in LETTERS:
            if LL == L:
                specials[(x, LL)] = m.add("stud_side", WALL, x, GZ0, L)
        for x0, n in runs(cols):
            row(m, "b", WALL, x0, GZ0, n, L, avoid={s - x0 for s in prev})
        m.step()
    for layer in range(23, 33):
        cols = [x for x in range(GX0, GX1 + 1)
                if layer < wall_top(x) and _course_top(x) <= layer and facade_free(x, layer, 1)]
        for x0, n in runs(cols):
            row(m, "p", WALL, x0, GZ0, n, layer)
    m.step()
    # the curved roofline: white trim in front, dark roof edge one plate higher behind
    for cols, top, key in GROUPS:
        m.add(key, WALL, cols[0], GZ0, top, rot=FACE["left"])
        m.add(key, WALL, mirror(cols[-1]), GZ0, top, rot=FACE["right"])
    fx, ftop = FLAT
    row(m, "t", WALL, fx.start, GZ0, len(fx), ftop)
    m.step()
    _dark_edge(m)
    m.step()

    # gold letters and dark portholes on the side studs
    for (x, L) in LETTERS:
        side_mount(m, specials[(x, L)], "round_p1", GOLD)
    for (x, L) in PORTHOLES:
        side_mount(m, specials[(x, L)], "tile_round1", BLACK)
    m.step()

    # central block behind the front, and the lookout on top of it
    cb = WallRing([(18, 17), (28, 17), (28, 24), (18, 24)])
    for i, L in enumerate((24, 27, 30)):
        cb.course(m, L, i, lambda x, z, l: ("b", WALL))
        m.step()
    fill_rect(m, "p", WALL, 18, 17, 11, 8, 33, along="x")
    m.step()
    look = WallRing([(19, 18), (27, 18), (27, 23), (19, 23)])

    def look_mat(x, z, layer):
        if z in (18, 23) and x in (20, 22, 24, 26):
            return ("b", WINDOW)
        if x in (19, 27) and z in (20, 21):
            return ("b", WINDOW)
        return ("b", CREAM)

    for i, L in enumerate((34, 37)):
        look.course(m, L, i, look_mat)
        m.step()
    fill_rect(m, "p", WALL, 19, 18, 9, 6, 40, along="x")
    m.step()
    # railing: round posts and a tile hand rail; dark roof tiles inside
    edge = [(x, z) for x in range(19, 28) for z in range(18, 24)
            if x in (19, 27) or z in (18, 23)]
    for (x, z) in edge:
        if (x + z) % 2 == 1 or (x in (19, 27) and z in (18, 23)):
            m.add("round_p1", WALL, x, z, 41)
            m.add("round_p1", WALL, x, z, 42)
    fill_cells(m, "t", ROOF, {(x, z) for x in range(20, 27) for z in range(19, 23)}, 41)
    m.step()
    for z in (18, 23):
        row(m, "t", WALL, 19, z, 9, 43)
    for x in (19, 27):
        row(m, "t", WALL, x, 19, 4, 43, axis="z")
    m.step()
    gm.width, gm.depth = GX1 - GX0 + 1, GZ1 - GZ0 + 1
    return gm


def _course_top(x):
    """First layer above the last full course of the front wall in column x."""
    L = 23
    while L + 3 <= wall_top(x):
        L += 3
    return L


def _dark_edge(m):
    """A dark grey row behind the curved roofline, one plate higher (the roof edge)."""
    z = GZ0 + 1
    for cols, top, key in GROUPS:
        for c0 in (cols[0], mirror(cols[-1])):
            _dark_column(m, c0, len(cols), z, top + 1)
        m.add(key, ROOF, cols[0], z, top + 1, rot=FACE["left"])
        m.add(key, ROOF, mirror(cols[-1]), z, top + 1, rot=FACE["right"])
    fx, ftop = FLAT
    _dark_column(m, fx.start, len(fx), z, ftop + 1)
    row(m, "t", ROOF, fx.start, z, len(fx), ftop + 1)


def _dark_column(m, x0, n, z, top):
    L = DECK + 1
    while L + 3 <= top:
        row(m, "b", ROOF, x0, z, n, L)
        L += 3
    while L < top:
        row(m, "p", ROOF, x0, z, n, L)
        L += 1


# --------------------------------------------------------------------------
# tower (build 2): white walls, a row of windows, dark pyramid roof, spire
# --------------------------------------------------------------------------
def build_tower():
    m = Model("tower.ldr", "Tower (build 2)")
    fill_rect(m, "p", WALL, 1, 1, 7, 7, 0, along="x")
    m.step()
    ring = WallRing([(1, 1), (7, 1), (7, 7), (1, 7)])

    def mat(x, z, layer):
        if layer == 10 and ((z in (1, 7) and x in (2, 4, 6)) or (x in (1, 7) and z in (2, 4, 6))):
            return ("b", WINDOW)
        return ("b", WALL)

    for i, L in enumerate((1, 4, 7, 10)):
        ring.course(m, L, i, mat)
        m.step()
    fill_rect(m, "p", WALL, 1, 1, 7, 7, 13, along="x")
    m.step()
    fill_rect(m, "p", WALL, 0, 0, 9, 9, 14, along="x")
    m.step()
    m.add("b1x1", ROOF, 4, 4, 15)                   # post for the spire
    build_roofs(m, [Roof(0, 9, 0, 9, 15, "x", pitch=33, color=ROOF, hips=("start", "end"),
                         name="tower roof")],
                keep_open={(4, 4)}, support_caps=True)
    base = m.add("round1", WALL, 4, 4, 18)
    top = -8 * 21                                     # top of the round brick
    bar_y = top + 4 - 80
    bar = m.add_raw("bar4", WALL, (90, bar_y, 90), rot_matrix(0), attach_to=base)
    m.add_raw("cone1", WALL, (90, bar_y + 6 - PARTS["cone1"].bmax_y, 90), rot_matrix(0),
              attach_to=bar)
    m.step()
    m.width, m.depth = 9, 9
    return m


# --------------------------------------------------------------------------
# side wing (build 2): white walls, windows, dark hipped roof
# --------------------------------------------------------------------------
def build_wing():
    m = Model("wing.ldr", "Side wing (build 2)")
    fill_rect(m, "p", LBG, 0, 0, 10, 11, 0, along="z")
    m.step()
    ring = WallRing([(0, 0), (9, 0), (9, 10), (0, 10)])

    def mat(x, z, layer):
        if layer in (4, 10):
            if z in (0, 10) and x in (2, 4, 5, 7):
                return ("b", WINDOW)
            if x in (0, 9) and z in (3, 5, 7):
                return ("b", WINDOW)
        return ("b", WALL)

    for i, L in enumerate((1, 4, 7, 10, 13)):
        ring.course(m, L, i, mat)
        m.step()
    fill_rect(m, "p", WALL, 0, 0, 10, 11, 16, along="z")
    m.step()
    build_roofs(m, [Roof(0, 10, 0, 11, 17, "z", pitch=33, color=ROOF, hips=("start", "end"),
                         name="wing roof")], support_caps=True)
    m.width, m.depth = 10, 11
    return m


# --------------------------------------------------------------------------
# small garden pieces
# --------------------------------------------------------------------------
def build_topiary():
    m = Model("topiary.ldr", "Topiary")
    m.add("round1", GREEN, 0, 0, 0)
    m.add("leaves1", GREEN, 0, 0, 3, rot=0)
    m.add("round1", GREEN, 0, 0, 4)
    m.add("leaves1", GREEN, 0, 0, 7, rot=90)
    m.add("cone1", GREEN, 0, 0, 8)
    m.step()
    m.width, m.depth = 1, 1
    return m


def build_tree():
    m = Model("tree.ldr", "Shade tree")
    for k in range(4):
        m.add("round1", RBROWN, 0, 0, 3 * k)
    m.step()
    m.add("leaves6x5", GREEN, 0, 0, 12, rot=0)
    m.add("leaves6x5", GREEN, 0, 0, 13, rot=90)
    m.add("leaves1", GREEN, 0, 0, 14, rot=45)
    m.step()
    m.width, m.depth = 1, 1
    return m


# --------------------------------------------------------------------------
# main model
# --------------------------------------------------------------------------
BASE_W, BASE_D = 48, 32
PLANTER = (23.5, 9.0, 15.5, 5.6)             # centre x, centre z, half-width, half-depth
TOPIARIES = [(18, 12), (28, 12)]
TREES = [(3, 9), (43, 9)]


def planter_cells():
    cx, cz, a, b = PLANTER

    def inside(x, z):
        return ((x + 0.5 - cx) / a) ** 2 + ((z + 0.5 - cz) / b) ** 2 <= 1.0

    cells = {(x, z) for x in range(BASE_W) for z in range(3, 15) if inside(x, z)}
    ring = {(x, z) for (x, z) in cells
            if any((x + dx, z + dz) not in cells
                   for dx in (-1, 0, 1) for dz in (-1, 0, 1))}
    return cells, ring


def build_main(gatehouse, tower, wing, topiary, tree):
    m = Model("boardwalk_entrance.ldr", "BoardWalk entrance")
    m.header_notes = [
        "Unofficial fan design inspired by Disney's BoardWalk Inn; not affiliated with the",
        "LEGO Group or Disney. Generated by design.py (lego-kit).",
    ]
    m.section("The grounds", "Six 16 x 16 plates make the base. The road, the painted curb, "
              "the lawn and the flower bed go on top.")
    for z in (0, 16):
        for x in (0, 16, 32):
            m.add("p16x16", DBG, x, z, 0)
    m.step()
    # road and the red-and-blue curb
    for z in (0, 1):
        row(m, "t", DBG, 0, z, BASE_W, 1, avoid={16, 32})
    row(m, "p", BLUE, 0, 2, BASE_W, 1, avoid={16, 32})
    m.step()
    row(m, "t", RED, 0, 2, BASE_W, 2, avoid={16, 32})
    m.step()

    bed, ring = planter_cells()
    taken = set(bed)
    taken |= {(x, z) for x in range(GX0, GX1 + 1) for z in range(GZ0, GZ1 + 1)}
    for x0 in (1, 36):
        taken |= {(x, z) for x in range(x0, x0 + 10) for z in range(17, 28)}
    # the flower bed: soil inside, lawn-coloured plates under the hedge
    fill_cells(m, "p", RBROWN, bed - ring, 1)
    fill_cells(m, "p", GREEN, ring, 1)
    m.step()
    lawn = {(x, z) for x in range(BASE_W) for z in range(3, BASE_D)} - taken
    front = {c for c in lawn if c[1] < 16}
    fill_cells(m, "p", LAWN, front, 1)
    m.step()
    fill_cells(m, "p", LAWN, lawn - front, 1)
    m.step()

    m.step()
    m.sub(gatehouse, GX0, GZ0, 1)
    m.step()
    m.sub(tower, GX0 - 1, GZ0 + 1, DECK + 1)
    m.sub(tower, mirror(GX0 - 1, 9), GZ0 + 1, DECK + 1)
    m.step()
    m.sub(wing, 1, 17, 1)
    m.sub(wing, 36, 17, 1)
    m.step()

    m.section("The flower bed", "A hedge rings the oval bed of red flowers in front of the "
              "arch, with two topiaries and shade trees at the sides.")
    fill_cells(m, "b", HEDGE, ring, 2)
    m.step()
    inner = sorted(bed - ring - set(TOPIARIES), key=lambda c: (c[1], c[0]))
    rows = sorted({z for _, z in inner})
    for band in (rows[-3:], rows[-6:-3], rows[:-6]):   # back rows first
        for (x, z) in inner:
            if z not in band:
                continue
            if (x + z) % 2 == 0:
                m.add("flower1", RED, x, z, 2)
            else:
                m.add("leaves1", BRGREEN, x, z, 2, rot=90 * ((x * 3 + z) % 4))
        m.step()
    for x, z in TOPIARIES:
        m.sub(topiary, x, z, 2)
    for x, z in TREES:
        m.sub(tree, x, z, 2)
    m.step()
    # white spindled fences in front of the wings
    for x in (2, 6, 37, 41):
        m.add("fence_sp", WALL, x, 16, 2)
    m.step()
    return m


def build():
    gatehouse, tower, wing = build_gatehouse(), build_tower(), build_wing()
    topiary, tree = build_topiary(), build_tree()
    main_m = build_main(gatehouse, tower, wing, topiary, tree)
    return main_m, [main_m, gatehouse, tower, wing, topiary, tree]
