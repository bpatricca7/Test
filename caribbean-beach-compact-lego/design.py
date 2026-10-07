"""Caribbean Beach Resort, compact display kit (resort collection).

Build with the shared kit:  ./build.sh

The compact format (lego-kit/compact.py): a 24 x 16 base with a black front
band; one storey = 4 plates (a course of bricks and a plate band), 1 stud is about 2 m.

Old Port Royale (Centertown): a cluster of bright Caribbean buildings with
white trim and red metal roofs around a clock tower with an open lookout.

Grid (studs): x to the right, z toward the back; the front band is z = 0..1.
  turquoise house  x  3..8,  z 8..13   three storeys, red gable facing the front
  clock tower      x  9..13, z 7..11   five storeys, clocks, open lookout, red hip roof
                                       with a one-stud eave all round
  orange house     x 14..21, z 8..13   two storeys, white arcade, red hipped roof
  palm             (4, 4)
  sand strip       z 2..3; sand walk x 10..12 to the tower door
"""
from contextlib import contextmanager

import bricks
from bricks import (Model, Offset, FACE, COLOR_NAMES, WHITE, BLACK, RED, GREEN, TAN,
                    fill_rect, fill_cells, rot_matrix, _sizes)
from walls import WallRing
from roofs import Roof, build_roofs
from compact import compact_project, display_base, finish_ground, palm, storey_layer

YELLOW, DTURQ, ORANGE = 14, 3, 25
COLOR_NAMES.setdefault(YELLOW, "Yellow")

TOWER, HOUSE_A, HOUSE_B = YELLOW, DTURQ, ORANGE
TRIM, ROOF, PLINTH, DOOR = WHITE, RED, WHITE, BLACK

# Bestseller sizes for the bright wall colours (checked with avail.py); used
# only while this design builds, so other kits are unaffected
EXTRA_ALLOWED = {
    ("b", YELLOW): _sizes("1x1 1x2 1x3 1x4 1x6 2x2 2x4"),
    ("b", DTURQ): _sizes("1x1 1x2 1x3 1x4"),
    ("p", YELLOW): _sizes("1x1 1x2 1x3 1x4 1x6 2x2 2x3 2x4 2x6 2x8"),
}


@contextmanager
def bestseller_sizes():
    added = [k for k in EXTRA_ALLOWED if k not in bricks.ALLOWED]
    for k in added:
        bricks.ALLOWED[k] = EXTRA_ALLOWED[k]
    try:
        yield
    finally:
        for k in added:
            del bricks.ALLOWED[k]


PROJECT = compact_project(
    slug="caribbean_beach",
    title="Caribbean Beach Resort",
    resort="Disney's Caribbean Beach Resort",
    category="Moderate",
    about=("Old Port Royale, the heart of Caribbean Beach: a cluster of bright island "
           "buildings in turquoise, yellow and orange with white trim and red metal roofs, "
           "gathered around the clock tower with its open lookout, with a strip of sand and "
           "a palm in front."),
    features=["Old Port Royale: bright turquoise and orange buildings with white trim",
              "Red metal-style roofs: a front gable and a hipped roof",
              "The yellow clock tower with clock faces and an open lookout under a red roof",
              "A palm and a strip of sand in front"],
    omitted=["The five island villages of guest buildings and Caribbean Cay",
             "The lake, the beaches and the Fuentes del Morro pool",
             "Signs, shops and the Skyliner station"],
    colour_rows=[("Yellow", "Bright Yellow", "Yellow"),
                 ("Dark Turquoise", "Bright Bluish Green", "Dark Turquoise"),
                 ("Orange", "Bright Orange", "Orange"),
                 ("Red", "Bright Red", "Red"), ("White", "White", "White"),
                 ("Black", "Black", "Black"), ("Tan", "Brick Yellow", "Tan"),
                 ("Green", "Dark Green", "Green")],
    organisation=["The display base, the sand and the lawn", "The turquoise house",
                  "The clock tower", "The orange house", "The palm"],
    sub_info={
        "house_a.ldr": ("The turquoise house",
                        "Three storeys of turquoise walls with white louvred shutters under a "
                        "red gable roof with white trim."),
        "tower.ldr": ("The clock tower",
                      "Five yellow storeys with clock faces on three sides, an open lookout "
                      "with white columns and a red hipped roof."),
        "house_b.ldr": ("The orange house",
                        "A white arcade on the ground floor, an orange upper storey with "
                        "shutters and a red hipped roof."),
        "palm.ldr": ("The palm", "A trunk of round bricks and two layers of fronds."),
    },
    legend=("palm.ldr", 1),
    tips=["Each storey is one course of coloured bricks with white shutters, then a band of "
          "white plates. Sort the three wall colours into separate trays.",
          "The clock faces are round tiles on bricks with a stud on the side: press them on "
          "once the course is in place.",
          "Roofs go up one row of slopes at a time; hidden bricks under the roof have a step "
          "of their own, just before the slopes that rest on them."],
    build_time="about 1 to 1&frac12; hours",
)

# placements on the base (cell of each submodel's local origin)
A_X, A_Z, A_W, A_D, A_FLOORS = 3, 8, 6, 6, 3
T_X, T_Z, T_W, T_FLOORS = 9, 7, 5, 5          # tower body; five storeys, then the lookout
LOOKOUT_BRICKS = 2
B_X, B_Z, B_W, B_D, B_FLOORS = 14, 8, 8, 6, 2
PALM = (4, 4)
SAND_ROWS = (2, 3)
WALK = (10, 11, 12)


# --------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------
SNOT_FRONT = (1, 0, 0, 0, 0, -1, 0, 1, 0)    # part bottom (+y) turned to face +z


def side_mount(m, brick, key, color, face="front", stud_y=10):
    """A 1x1 round tile on the side stud of a brick facing `face`."""
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


def ring_of(w, d, x0=0, z0=0):
    return WallRing([(x0, z0), (x0 + w - 1, z0), (x0 + w - 1, z0 + d - 1), (x0, z0 + d - 1)])


def ring_cells(w, d, x0=0, z0=0):
    return {(x, z) for x in range(x0, x0 + w) for z in range(z0, z0 + d)
            if x in (x0, x0 + w - 1) or z in (z0, z0 + d - 1)}


def facade_course(m, ring, L, parity, colour, specials):
    """One brick course: plain bricks in `colour`, and special pieces.

    specials maps (x, z) -> (key, colour, rot) for the first cell of a piece,
    or None for a cell that piece also covers (or that stays open).
    """
    def mat(x, z, layer):
        if (x, z) in specials:
            return None
        return ("b", colour)
    ring.course(m, L, parity, mat)
    placed = {}
    for c, spec in sorted(specials.items()):
        if spec is not None:
            key, col, rot = spec
            placed[c] = m.add(key, col, c[0], c[1], L, rot=rot)
    return placed


def shutters(xs, z, axis="x"):
    """White louvred shutters (1x2 grille bricks) starting at each of xs."""
    out = {}
    for x in xs:
        if axis == "x":
            out[(x, z)] = ("grille1x2", TRIM, 0)
            out[(x + 1, z)] = None
        else:
            out[(z, x)] = ("grille1x2", TRIM, 90)
            out[(z, x + 1)] = None
    return out


# --------------------------------------------------------------------------
# the turquoise house: three storeys, red gable facing the front
# --------------------------------------------------------------------------
def build_house_a():
    m = Model("house_a.ldr", "Turquoise house")
    w, d = A_W, A_D
    fill_rect(m, "p", PLINTH, 0, 0, w, d, 0, along="x")
    m.step()
    ring = ring_of(w, d)
    for f in range(1, A_FLOORS + 1):
        L = storey_layer(f)
        if f == 1:
            sp = {(2, 0): ("b1x1", DOOR, 0), (3, 0): ("b1x1", DOOR, 0)}
        else:
            sp = shutters([2], 0)
        sp.update(shutters([2], 0, axis="z"))
        sp.update(shutters([2], w - 1, axis="z"))
        facade_course(m, ring, L, f % 2, HOUSE_A, sp)
        m.step()
        if f < A_FLOORS:
            fill_cells(m, "p", TRIM, ring_cells(w, d), L + 3)
        else:
            fill_rect(m, "p", TRIM, 0, 0, w, d, L + 3, along="x")
        m.step()
    base = storey_layer(A_FLOORS) + 4
    build_roofs(m, [Roof(0, w, 0, d, base, "z", pitch=45, color=ROOF, trim=TRIM,
                         trim_ends=("start", "end"), wall=HOUSE_A, name="gable roof")],
                fill_color=ROOF, support_caps=True)
    m.width, m.depth = w, d
    return m


# --------------------------------------------------------------------------
# the clock tower: four storeys, clocks, open lookout, red hipped roof
# --------------------------------------------------------------------------
def build_tower():
    """The tower body is local x, z = 1..T_W; the roof eave overhangs it by one stud."""
    m = Model("tower.ldr", "Clock tower")
    w = T_W
    o = 1                                  # body offset inside the eave
    mid = o + w // 2
    fill_rect(m, "p", PLINTH, o, o, w, w, 0, along="x")
    m.step()
    ring = ring_of(w, w, o, o)
    faces = {(mid, o): "front", (o, mid): "left", (o + w - 1, mid): "right"}
    for f in range(1, T_FLOORS + 1):
        L = storey_layer(f)
        if f == 1:
            sp = {(mid, o): ("b1x1", DOOR, 0)}
        elif f < T_FLOORS:
            sp = {c: ("b1x1", BLACK, 0) for c in faces}
        else:
            sp = {c: ("headlight", TOWER, FACE[face]) for c, face in faces.items()}
        placed = facade_course(m, ring, L, f % 2, TOWER, sp)
        m.step()
        if f == T_FLOORS:
            for c, face in faces.items():
                side_mount(m, placed[c], "tile_round1", WHITE, face)
            m.step()
        if f < T_FLOORS:
            fill_cells(m, "p", TRIM, ring_cells(w, w, o, o), L + 3)
        else:
            fill_rect(m, "p", TRIM, o, o, w, w, L + 3, along="x")
        m.step()
    # the lookout: white columns at the corners, a dark core behind the open sides
    L = storey_layer(T_FLOORS + 1)
    core = ring_of(w - 2, w - 2, o + 1, o + 1)
    for k in range(LOOKOUT_BRICKS):
        core.course(m, L + 3 * k, k, lambda x, z, layer: ("b", BLACK))
        for x in (o, o + w - 1):
            for z in (o, o + w - 1):
                m.add("round1", WHITE, x, z, L + 3 * k)
        m.step()
    L += 3 * LOOKOUT_BRICKS
    # the eave deck overhangs the lookout by one stud all round
    fill_rect(m, "p", TRIM, 0, 0, w + 2, w + 2, L, along="x")
    m.step()
    base = L + 1
    top = (mid, mid)
    roof = Roof(0, w + 2, 0, w + 2, base, "x", pitch=45, color=ROOF, hips=("start", "end"),
                name="tower roof")
    for k in range(roof.K + 1):            # a hidden post for the finial
        m.add("b1x1", BLACK, *top, roof.layer(k))
    m.step()
    build_roofs(m, [roof], fill_color=ROOF, keep_open={top}, support_caps=True)
    m.add("cone1", ROOF, *top, roof.layer(roof.K + 1))
    m.step()
    m.width, m.depth = w + 2, w + 2
    return m


# --------------------------------------------------------------------------
# the orange house: white arcade, orange upper storey, red hipped roof
# --------------------------------------------------------------------------
def build_house_b():
    m = Model("house_b.ldr", "Orange house")
    w, d = B_W, B_D
    fill_rect(m, "p", PLINTH, 0, 0, w, d, 0, along="x")
    m.step()
    # ground floor: an arcade of white arches in front of an orange wall
    inner = ring_of(w, d - 1, 0, 1)
    L = storey_layer(1)
    sp = {(2, 1): ("b1x1", DOOR, 0), (5, 1): ("b1x1", DOOR, 0)}
    facade_course(m, inner, L, 1, HOUSE_B, sp)
    for x in range(0, w, 4):
        m.add("arch1x4", TRIM, x, 0, L)
    m.step()
    fill_cells(m, "p", TRIM, ring_cells(w, d) | {(x, 1) for x in range(w)}, L + 3)
    m.step()
    ring = ring_of(w, d)
    for f in range(2, B_FLOORS + 1):
        L = storey_layer(f)
        sp = shutters([1, 5], 0)
        sp.update(shutters([2], 0, axis="z"))
        sp.update(shutters([2], w - 1, axis="z"))
        facade_course(m, ring, L, f % 2, HOUSE_B, sp)
        m.step()
        if f < B_FLOORS:
            fill_cells(m, "p", TRIM, ring_cells(w, d), L + 3)
        else:
            fill_rect(m, "p", TRIM, 0, 0, w, d, L + 3, along="x")
        m.step()
    base = storey_layer(B_FLOORS) + 4
    build_roofs(m, [Roof(0, w, 0, d, base, "x", pitch=45, color=ROOF, hips=("start", "end"),
                         name="hipped roof")], fill_color=ROOF, support_caps=True)
    m.width, m.depth = w, d
    return m


# --------------------------------------------------------------------------
# main model
# --------------------------------------------------------------------------
def build_main(house_a, tower, house_b, tree):
    m = Model("caribbean_beach_compact.ldr", "Caribbean Beach Resort (compact)")
    m.header_notes = ["Compact resort collection; generated by design.py (lego-kit)."]
    m.section("The display base", "The base and the black band are the same for every kit in "
              "the collection. A strip of sand, the lawn and the sandy walk to the tower go on "
              "next.")
    band = display_base(m)
    reserved = set(band)
    reserved |= {(A_X + x, A_Z + z) for x in range(A_W) for z in range(A_D)}
    reserved |= {(T_X + x, T_Z + z) for x in range(T_W) for z in range(T_W)}
    reserved |= {(B_X + x, B_Z + z) for x in range(B_W) for z in range(B_D)}
    reserved.add(PALM)

    def ground(x, z):
        if z in SAND_ROWS or (x in WALK and z < T_Z):
            return TAN
        return GREEN
    finish_ground(m, reserved, GREEN, colour_at=ground)
    m.step()
    m.sub(house_a, A_X, A_Z, 1)
    m.step()
    m.sub(tower, T_X - 1, T_Z - 1, 1)
    m.step()
    m.sub(house_b, B_X, B_Z, 1)
    m.step()
    m.section("The palm", "A palm on the lawn by the sand.")
    m.sub(tree, *PALM, 1)
    m.step()
    return m


def build():
    with bestseller_sizes():
        house_a, tower, house_b, tree = build_house_a(), build_tower(), build_house_b(), palm()
        main_m = build_main(house_a, tower, house_b, tree)
    return main_m, [main_m, house_a, tower, house_b, tree]
