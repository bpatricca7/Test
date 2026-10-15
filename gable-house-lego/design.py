"""Gable House: a one-and-a-half-storey house with a front gable and balcony.

Build with the shared kit:  ./build.sh

Designed from a photo of an imagined home: a steep front-gable roof in black
shingles with white rake trim, a gable of warm wood siding with a balcony door
and two white-trimmed windows, charcoal siding below, and a small entry porch on
four white columns whose flat roof is the balcony.

Scale: 1 stud = 2 ft (about 1:76, like the Family Home in ../house-lego); one
storey = 4 bricks. Base 32 x 32 studs (25.6 x 25.6 cm).

Grid (studs): x to the right, z toward the back; the street is at z = 0.
  street, sidewalk  z 0..2 across the base
  walk              x 15..16, z 3..8, then two white steps (z 9, 10)
  porch             x 14..17, z 11..13: four white columns, balcony on top
  house             x  8..23, z 14..27; the roof overhangs to x 7 and x 24
  beds              x 8..13 and 18..23, z 11..13 (shrubs and daffodils)
  fence             from the right wall at z = 22 to the right edge, then back
  pines             back left and back right; a young tree right of the house

Layers (plates): base 0; lawn, walk and the house floor 1; white skirt 2;
ground-floor brick courses 3, 6, 9, 12; eave deck 15; gable and roof from 16;
ridge tiles at 40.
"""
from contextlib import contextmanager

import bricks
from bricks import (Model, Offset, row, fill_cells, place_rect, _sizes, FACE,
                    WHITE, BLACK, DBG, LBG, GREEN, RBROWN, TAN, NOUGAT, TCLEAR)
from roofs import Roof, build_roofs
from walls import WallRing

YELLOW = 14
SIDING, WOOD, TRIM, ROOF, DOOR = DBG, NOUGAT, WHITE, BLACK, BLACK

# extra parts (keys prefixed with the kit's slug)
bricks.P("gh_win1x4x3", "60594.dat", "Window 1 x 4 x 3")
bricks.P("gh_glass1x4x3", "60603.dat", "Glass for Window 1 x 4 x 3", cells=[(0, 0)],
         bottom=[], height=0, solid=False, studs=[])
bricks.P("gh_palisade1x2", "30136.dat", "Brick 1 x 2 Log")
bricks.P("gh_leaves4x3", "2423.dat", "Plant Leaves 4 x 3", cells=[(0, 0)], studs=[(0, 0)],
         height=1)

# Bestseller sizes for colours the toolkit has no entry for (checked with avail.py);
# added only while this design builds, so other kits are unaffected
EXTRA_ALLOWED = {
    ("b", NOUGAT): _sizes("1x1 1x2"),
}
# Inside the house, fewer sizes keep its section's parts list on one booklet page
HOUSE_SIZES = {
    ("b", DBG): _sizes("1x1 1x2 1x4 1x8"),
    ("b", WHITE): _sizes("1x1"),
    ("t", BLACK): _sizes("2x2"),
}


@contextmanager
def allowed_sizes(extra):
    saved = {k: bricks.ALLOWED.get(k) for k in extra}
    bricks.ALLOWED.update(extra)
    try:
        yield
    finally:
        for k, v in saved.items():
            if v is None:
                del bricks.ALLOWED[k]
            else:
                bricks.ALLOWED[k] = v


PROJECT = dict(
    main_parts_label="Lot, garden and trees",
    model_name="gable_house",
    pdf_name="Gable_House_Instructions.pdf",
    title="Gable House",
    subtitle="A one-and-a-half-storey house with a front gable and balcony, in LEGO&reg; bricks",
    cover_stats=("26 &times; 26 cm", "32 &times; 32 studs"),
    badge="Unofficial fan design",
    fine_print=("An unofficial fan-designed model (MOC) of a generic house, designed from a photo. "
                "It is not affiliated with, sponsored or endorsed by The LEGO Group. LEGO&reg; is "
                "a trademark of The LEGO Group."),
    about=("A small one-and-a-half-storey house under one steep front gable. The roof is black "
           "with white trim along both rakes and the eaves. The half-storey in the roof is clad "
           "in warm wood, with a black balcony door and a white-trimmed window either side. Below "
           "it, charcoal siding, white double windows and a small entry porch on four white "
           "columns: its flat roof is the balcony, with a white spindle railing. The lot has the "
           "lawn, the walk and steps, flower beds with shrubs and daffodils, a wooden privacy "
           "fence, tall pines behind and a young tree at the front."),
    facts=[("Size", "32 &times; 32 studs (25.6 &times; 25.6 cm), {height} cm tall"),
           ("Scale", "about 1:76 (1 stud = 2 ft, one storey = 4 bricks), like the Family Home"),
           ("Build time", "about 2 to 2&frac12; hours")],
    organisation=["The lot: base, street, sidewalk, walk, steps and lawn",
                  "The house: walls, porch, balcony, gable and roof",
                  "The garden: shrubs, daffodils and fence",
                  "The pines (build 3) and the front tree"],
    organisation_note=("The house, the pines and the tree are built on their own and then set "
                       "on the lot. Every section starts with a list of the parts it needs."),
    tips=["Each storey is four courses of bricks. The corners swap between the two walls on "
          "every course, so follow the pictures closely where two walls meet.",
          "Slide the clear glass into each white window frame before you place it. The clear "
          "panels go in with their flat side facing out.",
          "The wood gable stands on the front wall, in front of the roof. Build it course by "
          "course up to its white peak before you start the roof behind it.",
          "The roof is built one row of slopes at a time. The white slopes at its ends and the "
          "white 1&times;1 slopes on the gable's end steps form the rake trim.",
          "A <b>&ldquo;Build 3&rdquo;</b> badge means you build that module three times."],
    legend=("pine.ldr", 1),
    sub_info={
        "house.ldr": ("The house",
                      "Charcoal siding on a white skirt, white double windows and the black front "
                      "door; the porch on four white columns with the balcony on its roof; the "
                      "wood gable with the balcony door and two windows; and the steep black roof "
                      "with white rake trim."),
        "pine.ldr": ("The pines", "A brown trunk and tiers of dark green branches."),
        "tree.ldr": ("The front tree", "A young tree for the lawn at the right of the house."),
    },
    section_images={"The lot": "cover_high"},
    section_image_default="cover_front_right",
    hero_views=[("cover_front_right", 24, 32), ("cover_front_left", 24, -32),
                ("cover_front", 10, 0), ("cover_high", 50, 20), ("back", 28, 150)],
    cover_view="cover_front_right",
    gallery=["cover_front", "cover_front_left", "cover_high", "back"],
    substitutions=[
        "<b>Base:</b> four 16&times;16 plates. Any plates that cover 32&times;32 studs will do.",
        "<b>Hidden parts:</b> the floor plates and the deck under the roof can be any colour.",
        "<b>Wood:</b> the gable is Medium Nougat; Tan or Dark Tan bricks give a lighter wood."],
    order_cap_note=("Every element in this kit was in Pick a Brick's Bestseller range, which "
                    "sells up to 999 of an element per order."),
    colour_rows=[("White", "White", "White"), ("Black", "Black", "Black"),
                 ("Dark Bluish Gray", "Dark Stone Grey", "Dark Bluish Gray"),
                 ("Light Bluish Gray", "Medium Stone Grey", "Light Bluish Gray"),
                 ("Medium Nougat", "Medium Nougat", "Medium Nougat"),
                 ("Green", "Dark Green", "Green"),
                 ("Tan", "Brick Yellow", "Tan"),
                 ("Reddish Brown", "Reddish Brown", "Reddish Brown"),
                 ("Yellow", "Bright Yellow", "Yellow"),
                 ("Trans-Clear", "Transparent", "Trans-Clear")],
    clear_alpha=48,
    bestseller_only=True,
    batch_sizes=[10, 25],
)


# --------------------------------------------------------------------------
# layout
# --------------------------------------------------------------------------
BASE_W, BASE_D = 32, 32
HX0, HX1, HZ0, HZ1 = 8, 24, 14, 28          # house walls x 8..23, z 14..27
RX0, RX1 = HX0 - 1, HX1 + 1                 # roof and eave deck overhang one stud
PX0, PX1, PZ0 = 14, 18, 11                  # porch x 14..17, z 11..13
COLUMNS = [(PX0, PZ0), (PX1 - 1, PZ0), (PX0, HZ0 - 1), (PX1 - 1, HZ0 - 1)]
STEPS_Z = (9, 10)
WALK_X, WALK_Z = (15, 16), range(3, 9)
BEDS = [(8, 11, 6, 3), (18, 11, 6, 3)]       # x0, z0, w, d
SPOUT = (HX1, HZ0 + 1)                      # downspout at the front of the right wall

L_FLOOR, L_SKIRT = 1, 2
COURSES = (3, 6, 9, 12)                     # ground floor: four brick courses
L_DECK = 15
ROOF_BASE = 16

# ground floor openings
FRONT_WIN = (9, 19)                         # 1 x 4 x 3 white window frames, x0
DOOR_X = (15, 16)
SIDE_WIN = (16, 22)                         # z0 of [trim, glass, glass, trim] on the sides
BACK_WIN = (10, 18)                         # x0 of the same on the back wall

# The front gable stands on the front wall and the roof starts one stud behind it, so
# the wood reaches out to the rake on every course. White 1 x 1 slopes on the steps and
# the white slopes at the front end of the roof behind them make the rake trim.
GABLE_COURSES = 8
UP_DOOR = DOOR_X                            # balcony door, courses 0..3, header on 4
UP_GLASS = (12, 18)                         # x0 of the 1 x 2 x 2 clear panels, courses 2..3
UP_TRIM = (11, 14, 17, 20)                  # white trim either side of each window


def rect(x0, z0, w, d):
    return {(x, z) for x in range(x0, x0 + w) for z in range(z0, z0 + d)}


# --------------------------------------------------------------------------
# the house
# --------------------------------------------------------------------------
def course_of(layer):
    return COURSES.index(layer) if layer in COURSES else None


def wall_material(x, z, layer):
    c = course_of(layer)
    if z == HZ0:                                       # front
        if c >= 1 and any(x0 <= x < x0 + 4 for x0 in FRONT_WIN):
            return None
        if x in DOOR_X and c <= 2:
            return ("b", DOOR)
        return ("b", SIDING)                           # a charcoal lintel over the door
    if x in (HX0, HX1 - 1) and HZ0 < z < HZ1 - 1:      # sides
        if c >= 1 and any(z0 <= z < z0 + 4 for z0 in SIDE_WIN):
            return None
        return ("b", SIDING)
    if z == HZ1 - 1:                                   # back
        if c >= 1 and any(x0 <= x < x0 + 4 for x0 in BACK_WIN):
            return None
        return ("b", SIDING)
    return ("b", SIDING)


def tall_windows(m, layer):
    """Side and back windows: a clear 1 x 2 x 3 panel between two white 1 x 1 x 3 bricks."""
    for z0 in SIDE_WIN:
        for x, face in ((HX0, 270), (HX1 - 1, 90)):
            m.add("b1x1x3", TRIM, x, z0, layer)
            m.add("panel1x2x3", TCLEAR, x, z0 + 1, layer, rot=face)
            m.add("b1x1x3", TRIM, x, z0 + 3, layer)
    for x0 in BACK_WIN:
        m.add("b1x1x3", TRIM, x0, HZ1 - 1, layer)
        m.add("panel1x2x3", TCLEAR, x0 + 1, HZ1 - 1, layer, rot=0)
        m.add("b1x1x3", TRIM, x0 + 3, HZ1 - 1, layer)


def front_windows(m, layer):
    """The two white double windows: 1 x 4 x 3 frames with clear glass."""
    target = m.model if isinstance(m, Offset) else m
    for x0 in FRONT_WIN:
        frame = m.add("gh_win1x4x3", TRIM, x0, HZ0, layer, rot=0)
        ox, oy, oz, mat, _ = frame.ldraw
        target.add_raw("gh_glass1x4x3", TCLEAR, (ox, oy, oz), mat, attach_to=frame)


def gable_span(k):
    """Cells x of the front gable on course k (under the roof surface)."""
    return range(HX0 + k, HX1 - k)


def gable_colour(x, k):
    if x in UP_DOOR and k <= 4:
        return DOOR if k <= 3 else TRIM               # door, then its header
    if x in UP_TRIM and k in (2, 3):
        return TRIM                                   # window trim and door casing
    if k in (2, 3) and any(x0 <= x < x0 + 2 for x0 in UP_GLASS):
        return None                                   # window glass
    return WOOD


def front_gable(m, courses):
    """Courses of the wood gable, with a white 1 x 1 slope on each end step.
    Joints are staggered from the course below."""
    for k in courses:
        layer = ROOF_BASE + 3 * k
        if k == 2:
            for x0 in UP_GLASS:
                m.add("panel1x2x2", TCLEAR, x0, HZ0, layer, rot=180)
        xs = list(gable_span(k))
        used = set()
        i = 0
        while i < len(xs):
            col = gable_colour(xs[i], k)
            j = i
            while j + 1 < len(xs) and gable_colour(xs[j + 1], k) == col:
                j += 1
            x0, n = xs[i], j - i + 1
            if col is not None:
                # bridge the joints in the course below (on course 0: between the deck
                # plates and the porch roof)
                below = front_gable.seams or {PX0, PX1}
                avoid = {s - x0 for s in below if 0 < s - x0 < n}
                used |= {x0 + s for s in row(m, "b", col, x0, HZ0, n, layer, avoid=avoid)}
            used |= {x0, x0 + n}
            i = j + 1
        front_gable.seams = used
        m.add("cheese", TRIM, xs[0], HZ0, layer + 3, rot=FACE["left"])
        m.add("cheese", TRIM, xs[-1], HZ0, layer + 3, rot=FACE["right"])


front_gable.seams = set()


def build_house():
    hm = Model("house.ldr", "Gable house")
    m = Offset(hm, RX0, PZ0, 1)
    ring = WallRing([(HX0, HZ0), (HX1 - 1, HZ0), (HX1 - 1, HZ1 - 1), (HX0, HZ1 - 1)])

    # --- foundation ring, white skirt and the porch base (joints staggered) ---
    for x0, n, z in ((HX0, 10, HZ0), (HX0 + 10, 6, HZ0), (HX0, 6, HZ1 - 1),
                     (HX0 + 6, 10, HZ1 - 1)):
        m.add(f"p1x{n}", SIDING, x0, z, L_FLOOR)
    for x in (HX0, HX1 - 1):
        for z0 in (HZ0 + 1, HZ0 + 7):
            m.add("p1x6", SIDING, x, z0, L_FLOOR, rot=90)
    for z in range(PZ0, HZ0):
        m.add("p1x4", SIDING, PX0, z, L_FLOOR)
    m.step()
    m.add("p4x4", TRIM, PX0, PZ0, L_SKIRT)                  # porch, onto the front wall
    for x0 in (HX0, PX1):
        m.add("p1x6", TRIM, x0, HZ0, L_SKIRT)
    for x in (HX0, HX1 - 1):
        m.add("p1x12", TRIM, x, HZ0 + 1, L_SKIRT, rot=90)
    m.add("p1x12", TRIM, HX0, HZ1 - 1, L_SKIRT)
    m.add("p1x4", TRIM, HX0 + 12, HZ1 - 1, L_SKIRT)
    m.step()

    # --- ground floor: four courses with the windows and the front door ---
    for i, L in enumerate(COURSES):
        ring.course(m, L, i, wall_material)
        if i == 1:
            front_windows(m, L)
            tall_windows(m, L)
        if i == 0:
            for z in range(PZ0, HZ0):                    # second white layer of the porch
                m.add("p1x4", TRIM, PX0, z, L)
        m.step()

    # --- porch: floor tiles and four white columns ---
    m.step("The four white columns stand on the porch. Two are at the front corners, two "
           "against the wall either side of the door.")
    m.add("t1x2", TRIM, PX0 + 1, PZ0, 4)
    m.add("t1x4", TRIM, PX0, PZ0 + 1, 4)
    m.add("t1x2", TRIM, PX0 + 1, PZ0 + 2, 4)
    for x, z in COLUMNS:
        m.add("b1x1x3", TRIM, x, z, 4)
        m.add("p1x1", TRIM, x, z, 13)
        m.add("p1x1", TRIM, x, z, 14)
    m.step()

    # --- eave deck and the porch roof (white plates; their edges are the fascia) ---
    m.step("The white 4×4 plate is the porch roof. It reaches back onto the front wall, "
           "which ties the porch to the house.")
    place_rect(m, "p", TRIM, PX0, PZ0, 4, 4, L_DECK)
    # a ring: two studs wide along the sides (under the first row of slopes) and one along
    # the front and back walls (under the gables)
    deck = (rect(RX0, HZ0 + 1, 2, HZ1 - HZ0 - 1) | rect(RX1 - 2, HZ0 + 1, 2, HZ1 - HZ0 - 1)
            | rect(RX0, HZ1 - 1, RX1 - RX0, 1))
    front = rect(HX0, HZ0, HX1 - HX0, 1) - rect(PX0, HZ0, 4, 1)   # charcoal, under the gable
    fill_cells(m, "p", TRIM, deck, L_DECK)
    fill_cells(m, "p", SIDING, front, L_DECK)
    m.step()

    # --- balcony: floor, spindle railing, posts and hand rails ---
    for z in range(PZ0, HZ0):
        m.add("p1x4", TRIM, PX0, z, L_DECK + 1)
    m.step()
    m.add("fence_sp", TRIM, PX0, PZ0, L_DECK + 2)
    for x in (PX0, PX1 - 1):
        m.add("b1x1", TRIM, x, HZ0 - 1, L_DECK + 2)
        m.add("b1x1", TRIM, x, HZ0 - 1, L_DECK + 5)
    m.step()
    for x in (PX0, PX1 - 1):
        m.add("p1x3", TRIM, x, PZ0, L_DECK + 8, rot=90)
    m.add("t1x2", TRIM, PX0 + 1, PZ0, L_DECK + 8)
    m.step()

    # --- the wood gable, then the roof behind it ---
    front_gable.seams = set()
    m.step("The wood gable: the balcony door with its white casing and a window either side. "
           "A white 1×1 slope on each end step starts the rake trim.")
    for ks in ((0, 1), (2, 3), (4, 5), (6, 7)):
        front_gable(m, ks)
        m.step()
    top = ROOF_BASE + 3 * GABLE_COURSES
    build_roofs(m, [Roof(RX0, RX1, HZ0 + 1, HZ1, ROOF_BASE, "z", pitch=45, color=ROOF,
                         trim=TRIM, trim_ends=("start", "end"), wall=SIDING, wall_ends=("end",),
                         widths=(4, 2, 1), name="roof")],
                keep_open={(15, HZ1 - 1), (16, HZ1 - 1)})
    m.step("A white tile finishes the ridge at the back gable.")
    m.add("t1x2", TRIM, 15, HZ1 - 1, top)
    m.step()
    return hm


# --------------------------------------------------------------------------
# trees
# --------------------------------------------------------------------------
def pinwheel(m, x, z, layer, colour, turn=0):
    """Four 2 x 2 slopes around a 2 x 2 centre, each facing out to one side: a 4 x 4 tier."""
    quads = [((0, 0), "front"), ((2, 0), "right"), ((2, 2), "back"), ((0, 2), "left")]
    if turn:
        quads = [((0, 0), "left"), ((2, 0), "front"), ((2, 2), "right"), ((0, 2), "back")]
    for (dx, dz), face in quads:
        m.add("s45x2", colour, x + dx, z + dz, layer, rot=FACE[face])


def build_pine():
    """A trunk, four tiers of slopes and a narrow top; three steps, so the booklet shows
    them inline."""
    m = Model("pine.ldr", "Pine")
    for k in range(4):
        m.add("b2x2", RBROWN, 1, 1, 3 * k)
    L = 12
    for t in range(4):
        pinwheel(m, 0, 0, L, GREEN, turn=t % 2)
        m.add("b2x2", GREEN, 1, 1, L + 3)
        L += 6
        if t in (0, 2):
            m.step()
    for (x, z), face in (((1, 1), "front"), ((2, 1), "right"), ((2, 2), "back"),
                         ((1, 2), "left")):
        m.add("cheese", GREEN, x, z, L, rot=FACE[face])
    m.step()
    return m


def build_tree():
    m = Model("tree.ldr", "Front tree")
    for k in range(4):
        m.add("round1", RBROWN, 0, 0, 3 * k)
    m.step()
    L = 12
    crown = [("leaves6x5", 0), ("gh_leaves4x3", 45), ("leaves6x5", 120), ("gh_leaves4x3", 200),
             ("gh_leaves4x3", 290), ("leaves1", 0), ("gh_leaves4x3", 20), ("gh_leaves4x3", 160),
             ("leaves1", 90), ("leaves1", 200)]
    for i, (key, r) in enumerate(crown):
        m.add(key, GREEN, 0, 0, L + i, rot=r)
    m.step()
    return m


# --------------------------------------------------------------------------
# the lot
# --------------------------------------------------------------------------
PINES = [(2, 20), (3, 27), (28, 27)]
TREE = (28, 9)
FENCE_Z, FENCE_X = 22, BASE_W - 1           # along z = 22 from the house, then back along x = 31
SHRUBS = [(9, 12, 0), (12, 12, 90), (19, 12, 45)]
DAFFODILS = [(21, 12), (22, 13), (23, 12), (10, 11)]


def _logs(m, x, z, n, layer, axis, single_first):
    """A run of tan log bricks; a 1 x 1 brick fills an odd cell (first or last)."""
    step = (1, 0) if axis == "x" else (0, 1)
    pos = 0
    if single_first and n % 2 == 1:
        m.add("b1x1", TAN, x, z, layer)
        pos = 1
    while pos < n:
        cx, cz = x + step[0] * pos, z + step[1] * pos
        if pos + 1 < n:
            m.add("gh_palisade1x2", TAN, cx, cz, layer, rot=0 if axis == "x" else 90)
            pos += 2
        else:
            m.add("b1x1", TAN, cx, cz, layer)
            pos += 1


def fence(m):
    """A privacy fence of tan log bricks, three courses, interlocking at the corner."""
    for c in range(3):
        L = 2 + 3 * c
        even = c % 2 == 0
        nx = FENCE_X - HX1 + (1 if even else 0)
        _logs(m, HX1, FENCE_Z, nx, L, "x", single_first=not even)
        z0 = FENCE_Z + 1 if even else FENCE_Z
        _logs(m, FENCE_X, z0, BASE_D - z0, L, "z", single_first=False)


def build_main(house, pine, tree):
    m = Model("gable_house.ldr", "Gable house")
    m.header_notes = ["Gable House; generated by design.py (lego-kit)."]
    m.section("The lot", "Four 16 x 16 plates make the base: the front two first, tied together "
              "by the street and the sidewalk, then the back two, tied on by the lawn.")
    for x in (0, 16):
        m.add("p16x16", SIDING, x, 0, 0)
    m.step()
    taken = set()
    row(m, "t", BLACK, 0, 0, BASE_W, 1, avoid={16})
    for z in (1, 2):
        row(m, "t", LBG, 0, z, BASE_W, 1, avoid={8 * z, 16, 32 - 8 * z})
    taken |= rect(0, 0, BASE_W, 3)
    m.step()
    for x in WALK_X:
        row(m, "t", LBG, x, WALK_Z[0], len(WALK_Z), 1, axis="z")
    taken |= {(x, z) for x in WALK_X for z in WALK_Z}
    # two white steps up to the porch
    m.add("p1x4", TRIM, PX0, STEPS_Z[0], 1)
    m.add("t1x4", TRIM, PX0, STEPS_Z[0], 2)
    m.add("p1x4", TRIM, PX0, STEPS_Z[1], 1)
    m.add("p1x4", TRIM, PX0, STEPS_Z[1], 2)
    m.add("t1x4", TRIM, PX0, STEPS_Z[1], 3)
    taken |= rect(PX0, STEPS_Z[0], 4, 2)
    m.step()
    beds = set()
    for x0, z0, w, d in BEDS:
        beds |= rect(x0, z0, w, d)
    fill_cells(m, "p", RBROWN, beds, 1)
    taken |= beds
    taken |= rect(HX0, HZ0, HX1 - HX0, HZ1 - HZ0) | rect(PX0, PZ0, PX1 - PX0, HZ0 - PZ0)
    m.step()
    lawn = rect(0, 0, BASE_W, BASE_D) - taken
    fill_cells(m, "p", GREEN, {c for c in lawn if c[1] < HZ0}, 1)
    m.step()
    for x in (0, 16):
        m.add("p16x16", SIDING, x, 16, 0)
    m.step()
    fill_cells(m, "p", GREEN, {c for c in lawn if c[1] >= HZ0}, 1)
    m.step()
    m.step("The black downspout stands against the right wall, at its front corner. The eave "
           "of the roof rests on it.")
    for k in range(4):
        m.add("round1", BLACK, SPOUT[0], SPOUT[1], 2 + 3 * k)
    m.add("round_p1", BLACK, SPOUT[0], SPOUT[1], 14)
    m.step()
    m.sub(house, RX0, PZ0, 1)
    m.step()

    m.section("The garden", "Shrubs and daffodils in the beds by the porch, and the wooden "
              "privacy fence that runs back from the right side of the house.")
    for x, z, r in SHRUBS:
        m.add("gh_leaves4x3", GREEN, x, z, 2, rot=r)
        m.add("gh_leaves4x3", GREEN, x, z, 3, rot=r + 90)
        m.add("leaves1", GREEN, x, z, 4, rot=r)
    for x, z in DAFFODILS:
        m.add("leaves1", GREEN, x, z, 2, rot=30 * x)
        m.add("round_p1", YELLOW, x, z, 3)
    m.step()
    fence(m)
    m.step()
    m.section("The trees", "Three tall pines around the back of the house and a young tree to "
              "the right of it.")
    for x, z in PINES:
        m.sub(pine, x - 1, z - 1, 2)
    m.step()
    m.sub(tree, *TREE, 2)
    m.step()
    return m


def build():
    with allowed_sizes(EXTRA_ALLOWED):
        with allowed_sizes(HOUSE_SIZES):
            house = build_house()
        pine, tree = build_pine(), build_tree()
        main_m = build_main(house, pine, tree)
    return main_m, [main_m, house, pine, tree]
