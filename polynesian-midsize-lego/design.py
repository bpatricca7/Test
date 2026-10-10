"""Polynesian Village Resort, mid-size display kit (resort collection).

Build with the shared kit:  ./build.sh

The mid-size format (lego-kit/compact.py, size="midsize"): a 32 x 24 base with a
black front band; one storey = 4 plates (a course of bricks and a plate band),
1 stud is about 2 m, the same scale as the compact kit.

The kit shows the arrival front of the Great Ceremonial House, as a guest sees it
from the drive: everything faces the black band (-z) and the model is symmetric
about x = 16.

Grid (studs): x to the right, z toward the back; the front band is z = 0..1.
  Great Ceremonial House  x 9..22, z 10..19   a two-storey lobby of timber and glass
                          (walls x 10..21) under the very tall, steep thatched roof:
                          two flared courses of 45-degree slopes at the eaves, then four
                          courses of 65-degree slopes, each on a dark tan plate (the
                          layers of thatch); the gable end faces the drive, a dark timber
                          face with tall windows, and the ridge beam sticks out at both
                          ends
  porte-cochere           x 12..19, z 3..8   a smaller steep thatched gable (45, 45 and
                          65 degrees) on four dark timber posts over the drive, in front
                          of the entrance, so the two gables stack toward the viewer
  drive                   z 4..7 across the base, and a forecourt at z 8..9 by the door
  lava-rock walls         x 1..8 and 23..30, z 9..10   dark grey and black rock with a
                          small waterfall each into a pool at z = 8 (x 3..6, 25..28)
  tiki torches            four along the front lawn, two by the entrance
  palms, planting         four palms around the rock walls; shrubs and red flowers
                          (left half listed, mirrored on the right)

Slopes: the 65-degree slope is the part used most (92 per kit), so one Pick a Brick
order (999 per element) still covers 10 kits; the flared eaves and most of the
porte-cochere use 2x2 45-degree slopes instead.
"""
from contextlib import contextmanager

import bricks
from bricks import Model, row, fill_cells, place_rect, _sizes, split_length
from bricks import RBROWN, TAN, DTAN, DBG, LBG, BLACK, GREEN, BRORANGE, RED
from walls import WallRing
from compact import FORMATS, compact_project, display_base, finish_ground, palm

SIZE = "midsize"
# a small bush: plant leaves 4 x 3 on one stud, the leaves reaching toward the front
bricks.P("pvm_bush", "2423.dat", "Plant Leaves 4 x 3", cells=[(0, 0)], studs=[(0, 0)],
         height=1)
TORANGE, TLBLUE = 57, 43                       # Trans-Orange, Trans-Light Blue
THATCH, LAYER, TIMBER, GLASS = TAN, DTAN, RBROWN, BLACK
ROCK, ROCK2, PAVING, WATER = DBG, BLACK, LBG, TLBLUE
FLAME, GLOW, BLOOM = BRORANGE, TORANGE, RED

# Bestseller sizes for colours the toolkit has no entry for (checked with avail.py);
# set only while this design builds, so other kits are unaffected
EXTRA_ALLOWED = {
    ("b", RBROWN): _sizes("1x1 1x2 1x3 1x4 1x6"),
    ("b", TAN): _sizes("1x1 1x2 1x3 1x4 1x6 1x8"),
    ("p", DTAN): _sizes("1x2 1x4 2x4 2x6"),
    ("t", RBROWN): _sizes("1x1 1x2 1x4 1x6 2x2 2x4"),
    ("t", TLBLUE): _sizes("1x1 1x2"),
    ("b", BLACK): _sizes("1x1 1x2 1x3 1x4 1x6 1x8"),
}


@contextmanager
def bestseller_sizes():
    saved = {k: bricks.ALLOWED.get(k) for k in EXTRA_ALLOWED}
    bricks.ALLOWED.update(EXTRA_ALLOWED)
    try:
        yield
    finally:
        for k, v in saved.items():
            if v is None:
                del bricks.ALLOWED[k]
            else:
                bricks.ALLOWED[k] = v


PROJECT = compact_project(
    size=SIZE,
    slug="polynesian",
    title="Polynesian Village Resort",
    resort="Disney's Polynesian Village Resort",
    category="Deluxe",
    merged=["Disney's Polynesian Villas & Bungalows",
            "Island Tower at Disney's Polynesian Village Resort"],
    about=("The arrival front of the Polynesian, as a guest sees it from the drive: the "
           "Great Ceremonial House with its very tall, steep thatched roof and the dark "
           "timber gable with tall windows facing you, and in front of it the porte-cochere, "
           "a steep thatched gable of its own on dark timber posts over the drive, so the two "
           "peaked gables stack one behind the other. Lava-rock walls with small waterfalls "
           "frame the entrance on both sides, with palms and planting around them, and tiki "
           "torches with glowing tips line the lawn along the front."),
    features=["The Great Ceremonial House seen from the front: a very tall, steep thatched "
              "roof with its gable end facing the drive",
              "The thatch: flared 45-degree slopes at the eaves and four layers of 65-degree "
              "slopes above, each on a dark tan plate",
              "The dark timber gable with tall windows, and the ridge beam sticking out at "
              "both ends",
              "The porte-cochere: a steep thatched gable on four dark timber posts over the "
              "drive, in front of the entrance",
              "Two lava-rock walls with small waterfalls into clear blue pools, with planting "
              "on top",
              "Six tiki torches with glowing tips and four palms"],
    omitted=["The guest longhouses, Island Tower and the over-water bungalows",
             "The long sides of the Great Ceremonial House (the kit shows its front end)",
             "The monorail, the beach, the lagoon and most of the gardens"],
    colour_rows=[("Tan", "Brick Yellow", "Tan"), ("Dark Tan", "Sand Yellow", "Dark Tan"),
                 ("Reddish Brown", "Reddish Brown", "Reddish Brown"),
                 ("Black", "Black", "Black"),
                 ("Dark Bluish Gray", "Dark Stone Grey", "Dark Bluish Gray"),
                 ("Light Bluish Gray", "Medium Stone Grey", "Light Bluish Gray"),
                 ("Green", "Dark Green", "Green"),
                 ("Orange", "Bright Orange", "Orange"),
                 ("Trans-Orange", "Transparent Bright Orange", "Trans-Orange"),
                 ("Trans-Light Blue", "Transparent Light Blue", "Trans-Light Blue")],
    organisation=["The display base, the drive and the lawns",
                  "The Great Ceremonial House", "The porte-cochere",
                  "The lava-rock walls (build 2)",
                  "The tiki torches, the palms and the planting (build 6 torches and 4 palms)"],
    sub_info={
        "ceremonial_house.ldr": (
            "The Great Ceremonial House",
            "Two storeys of timber posts and glass, then the steep roof one course at a "
            "time: two flared courses of 45-degree slopes at the eaves, then four courses of "
            "65-degree slopes, each on a dark tan plate, with the timber gables and their "
            "tall windows between them."),
        "porte_cochere.ldr": (
            "The porte-cochere",
            "Four dark timber posts carry a ring of beams, then a steep thatched roof in "
            "four layers with timber gables. It stands over the drive in front of the "
            "entrance."),
        "rock_wall.ldr": (
            "The lava-rock walls",
            "Dark grey and black rock with a waterfall of clear blue round bricks in the "
            "middle and planting on top. Build two."),
        "torch.ldr": ("The tiki torches", "A tall brown post, an orange flame and a glowing "
                      "trans-orange tip."),
        "palm.ldr": ("The palms", "A trunk of round bricks and two layers of fronds."),
    },
    legend=("torch.ldr", 1),
    tips=["The roofs go up one course at a time: first the dark tan plates, then the tan "
          "slopes on them, then the reddish brown bricks of the gables at the front and back.",
          "Each slope sits on the plate or slope below it. Press every slope down firmly "
          "before the next plates go on: they lock the slopes together.",
          "The porte-cochere stands on its four posts over the drive, just in front of the "
          "entrance; its ridge beam reaches the gable of the Great Ceremonial House.",
          "A <b>&ldquo;Build 2&rdquo;</b>, <b>&ldquo;Build 4&rdquo;</b> or "
          "<b>&ldquo;Build 6&rdquo;</b> badge means you build that module that many times."],
    build_time="about 2 to 2&frac12; hours",
)

# --------------------------------------------------------------------------
# layout on the base (symmetric about x = 16)
# --------------------------------------------------------------------------
W, DD = FORMATS[SIZE]["w"], FORMATS[SIZE]["d"]      # the base: 32 x 24
HW, HD = 14, 10                    # Great Ceremonial House: eave to eave, depth
HX, HZ = 9, 10                     # its corner on the base
PW, PD = 8, 6                      # porte-cochere: eave to eave, depth
PX, PZ = 12, 3                     # its corner (posts at the four corners)
DRIVE = range(4, 8)                # the drive, between the porte-cochere posts
RWL, RWD = 8, 2                    # a rock wall
ROCKS = ((1, 9), (23, 9))
POOLS = {(x, 8) for x in (3, 4, 5, 6, 25, 26, 27, 28)}
TORCHES = ((4, 2), (10, 2), (21, 2), (27, 2), (10, 9), (21, 9))
PALMS = ((3, 13), (28, 13), (6, 19), (25, 19))      # fronds clear of the base edges
HIBISCUS = ((1, 2), (7, 3), (2, 11), (6, 12), (3, 17), (7, 21))   # left half, mirrored
SHRUBS = (((8, 12), 90), ((8, 16), 90), ((3, 21), 90), ((4, 16), 0), ((1, 18), 0))
# (cell, leaf direction), left half; mirrored on the right


def mirror(x):
    return W - 1 - x


def ground_colour(x, z):
    if (x, z) in POOLS:
        return WATER
    if z in DRIVE or (PX - 1 <= x <= PX + PW and PZ + PD - 1 <= z < HZ):
        return PAVING                  # the drive and the forecourt by the entrance
    return GREEN


# --------------------------------------------------------------------------
# small helpers
# --------------------------------------------------------------------------
def strip(m, colour, x, z, length, layer, sizes=(6, 4)):
    """A 2-wide strip of plates along z (dark tan: 2x6 and 2x4 only)."""
    pos = 0
    for n in split_length(length, list(sizes)):
        place_rect(m, "p", colour, x, z + pos, 2, n, layer)
        pos += n


def pattern_row(m, z, x0, x1, layer, colour_at):
    """Bricks from x0 to x1 (inclusive) along a row, a run per colour."""
    x = x0
    while x <= x1:
        c = colour_at(x)
        x2 = x
        while x2 + 1 <= x1 and colour_at(x2 + 1) == c:
            x2 += 1
        if c is not None:
            row(m, "b", c, x, z, x2 - x + 1, layer)
        x = x2 + 1


def thatch_roof(m, w, d, base, courses, gable, ridge=(1, 1), notes=()):
    """A steep thatched gable roof over x 0..w-1, z 0..d-1, ridge along z.

    The gables are at z = 0 (the front) and z = d - 1. ``courses`` lists
    (pitch, tie) from the eaves up: pitch 45 lays 2x2 slopes (one brick tall),
    65 lays 2x1x2 slopes (two bricks tall); ``tie`` puts a dark tan plate strip
    under the course first: the edge of a layer of thatch, which also locks the
    slopes below together. Each course steps in by one stud, so the roof needs
    w = 2 * len(courses) + 2. ``gable(x, c, r, front)`` gives the colour of a
    gable brick (course c, brick row r). ``ridge`` = studs the ridge beam sticks
    out at the front and at the back. Returns the top layer.
    """
    assert w == 2 * len(courses) + 2
    notes = dict(notes)
    L = base
    for c, (pitch, tie) in enumerate(courses):
        lo, hi = c, w - 2 - c                  # left / right slope cells
        g0, g1 = c + 2, w - 3 - c              # gable wall between them
        if tie:
            m.step(notes.get(("tie", c)))
            strip(m, LAYER, lo, 0, d, L)
            strip(m, LAYER, hi, 0, d, L)
            if g1 >= g0:
                for z in (0, d - 1):
                    row(m, "p", TIMBER, g0, z, g1 - g0 + 1, L)
            m.step()
            L += 1
        m.step(notes.get(("slopes", c)))
        if pitch == 65:
            for z in range(d):
                m.add("slope65", THATCH, lo, z, L, rot=90)
                m.add("slope65", THATCH, hi, z, L, rot=270)
        else:
            for z, n in _runs(d):
                key = "s45x2" if n == 2 else "slope45"
                m.add(key, THATCH, lo, z, L, rot=90)
                m.add(key, THATCH, hi, z, L, rot=270)
        rows = 2 if pitch == 65 else 1
        if g1 >= g0:
            if pitch == 65:
                m.step()
            for z in (0, d - 1):
                for r in range(rows):
                    pattern_row(m, z, g0, g1, L + 3 * r,
                                lambda x, c=c, r=r, z=z: gable(x, c, r, z == 0))
        m.step()
        L += 3 * rows
    # the ridge: a timber beam along the top, then a row of small slopes on each side
    n = len(courses)
    z0, z1 = -ridge[0], d - 1 + ridge[1]
    pos = z0
    for k in split_length(z1 - z0 + 1, [8, 6, 4]):
        place_rect(m, "p", TIMBER, n, pos, 2, k, L)
        pos += k
    m.step()
    for z in range(z0, z1 + 1):
        m.add("cheese", THATCH, n, z, L + 1, rot=90)
        m.add("cheese", THATCH, n + 1, z, L + 1, rot=270)
    m.step()
    return L + 1


def _runs(d):
    """2-wide pieces along z, a 1-wide piece at the end if d is odd."""
    out, z = [], 0
    while z < d:
        n = 2 if z + 1 < d else 1
        out.append((z, n))
        z += n
    return out


# --------------------------------------------------------------------------
# the Great Ceremonial House
# --------------------------------------------------------------------------
GCH_COURSES = [(45, False), (45, False), (65, True), (65, True), (65, True), (65, True)]
DOOR = (HW // 2 - 1, HW // 2)                       # local x of the entrance


def gch_wall(x, z, f):
    """The two storeys under the eaves: timber posts and dark glass."""
    if z == 0:
        if x in DOOR and f == 1:
            return None                              # the entrance
        return TIMBER if x in (1, DOOR[0] - 1, DOOR[1] + 1, HW - 2) else GLASS
    if z == HD - 1:
        return TIMBER if x % 3 != 2 else GLASS
    return TIMBER if z % 3 == 0 else GLASS            # the long sides


def gch_gable(x, c, r, front):
    """Dark timber gables with tall windows that taper with the roof."""
    mid = HW / 2 - 0.5
    off = abs(x - mid)                               # 0.5 at the two middle studs
    if c == 0:
        return TIMBER
    if c == 1:
        return GLASS if off in (1.5, 2.5) else TIMBER
    if c == 2:
        return GLASS if off < 2 else TIMBER
    if c == 3:
        return GLASS if off < 1 else TIMBER
    if c == 4:
        return GLASS if r == 0 else TIMBER
    return TIMBER


def build_house():
    m = Model("ceremonial_house.ldr", "Great Ceremonial House")
    # a ring of plinth plates under the walls (the eaves overhang the ground)
    place_rect(m, "p", ROCK, 1, 0, 2, HD, 0)
    place_rect(m, "p", ROCK, HW - 3, 0, 2, HD, 0)
    for z in (0, HD - 1):
        place_rect(m, "p", ROCK, 3, z, HW - 6, 1, 0)
    m.step()
    ring = WallRing([(1, 0), (HW - 2, 0), (HW - 2, HD - 1), (1, HD - 1)])
    ring_cells = set(ring.cells())
    for f in (1, 2):
        L = 1 + 4 * (f - 1)

        def mat(x, z, layer, f=f):
            c = gch_wall(x, z, f)
            return None if c is None else ("b", c)
        ring.course(m, L, f % 2, mat)
        if f == 1:
            m.add("t1x2", THATCH, DOOR[0], 0, 1)        # the doorstep
        m.step()
        if f == 1:
            fill_cells(m, "p", TIMBER, ring_cells, L + 3)
            m.step()
    # the eave deck: the edges of the thatch along the sides, a timber beam across the gables
    strip(m, LAYER, 0, 0, HD, 8)
    strip(m, LAYER, HW - 2, 0, HD, 8)
    for z in (0, HD - 1):
        row(m, "p", TIMBER, 2, z, HW - 4, 8)
    m.step()
    thatch_roof(m, HW, HD, 9, GCH_COURSES, gch_gable, ridge=(1, 1), notes={
        ("slopes", 0): "The first two courses of slopes flare out at the eaves.",
        ("tie", 2): "From here on each course starts with dark tan plates: the edges of the "
                    "thatch layers. They also lock the slopes below together."})
    m.width, m.depth = HW, HD
    return m


# --------------------------------------------------------------------------
# the porte-cochere
# --------------------------------------------------------------------------
PC_COURSES = [(45, False), (45, True), (65, True)]
PC_POSTS = [(0, 0), (PW - 1, 0), (0, PD - 1), (PW - 1, PD - 1)]


def pc_gable(x, c, r, front):
    """Dark timber, open between the posts of the truss at the front."""
    if front and c == 0 and x in (3, 4):
        return GLASS
    return TIMBER


def build_porte():
    m = Model("porte_cochere.ldr", "Porte-cochere")
    for x, z in PC_POSTS:
        m.add("round1", TIMBER, x, z, 0)
        m.add("round1", TIMBER, x, z, 3)
    m.step("Two round bricks make each post. Then a timber beam across the front posts "
           "and one across the back posts.")
    for z in (0, PD - 1):
        row(m, "p", TIMBER, 0, z, PW, 6)
    m.step("The dark tan eave plates join the front and back beams.")
    strip(m, LAYER, 0, 0, PD, 7)
    strip(m, LAYER, PW - 2, 0, PD, 7)
    for z in (0, PD - 1):
        row(m, "p", TIMBER, 2, z, PW - 4, 7)
    m.step()
    thatch_roof(m, PW, PD, 8, PC_COURSES, pc_gable, ridge=(1, 1))
    m.width, m.depth = PW, PD
    return m


# --------------------------------------------------------------------------
# the lava-rock walls (one model, built twice)
# --------------------------------------------------------------------------
FALL = (RWL // 2 - 1, RWL // 2)                       # the waterfall's two studs


def rock_colour(x, z, layer):
    h = (x * 7 + z * 13 + layer * 5) % 5
    return ROCK2 if h == 0 else ROCK


def build_rock_wall():
    m = Model("rock_wall.ldr", "Lava-rock wall")
    place_rect(m, "p", ROCK, 0, 0, RWL, RWD, 0)
    m.step("The clear blue round bricks in the middle are the waterfall.")
    # three courses of rock, stepping in at the ends; the waterfall in the middle
    for k, (front, back) in enumerate((((0, RWL), (0, RWL)), ((1, RWL - 1), (0, RWL)),
                                       (None, (1, RWL - 1)))):
        L = 1 + 3 * k
        for z, span in ((0, front), (1, back)):
            if span:
                water = FALL if (z == 0 or not front) else ()
                _rock_row(m, [x for x in range(*span) if x not in water], z, L, k)
        for x in FALL:
            if front:
                m.add("round1", WATER, x, 0, L)
            else:
                m.add("cheese", WATER, x, 1, L)       # the water spills over the top
                m.add("tile_round1", WATER, x, 0, L)
        m.step()
    # planting on the steps of the rock, red flowers on two of them
    for x in (0, RWL - 1):
        m.add("leaves1", GREEN, x, 0, 4)
        m.add("flower1", BLOOM, x, 0, 5)
        m.add("leaves1", GREEN, x, 1, 7)
    for x in (1, RWL - 2):
        m.add("leaves1", GREEN, x, 0, 7)
    m.add("pvm_bush", GREEN, 1, 1, 10)                # the leaves hang over the front
    m.add("pvm_bush", GREEN, RWL - 2, 1, 10)
    m.step()
    m.width, m.depth = RWL, RWD
    return m


def _rock_row(m, xs, z, layer, k):
    """Rock bricks along a row: runs of masonry 1x2 and 1x1s in two colours."""
    xs = sorted(xs)
    i = 0
    while i < len(xs):
        x = xs[i]
        nxt = i + 1 < len(xs) and xs[i + 1] == x + 1
        col = rock_colour(x, z, layer)
        if nxt and (x + k + z) % 3 != 0:
            m.add("masonry", ROCK, x, z, layer)
            i += 2
        else:
            m.add("b1x1", col, x, z, layer)
            i += 1


# --------------------------------------------------------------------------
# details
# --------------------------------------------------------------------------
def build_torch():
    m = Model("torch.ldr", "Tiki torch")
    m.add("round1", TIMBER, 0, 0, 0)
    m.add("round1", TIMBER, 0, 0, 3)
    m.step()
    m.add("cone1", FLAME, 0, 0, 6)
    m.add("tile_round1", GLOW, 0, 0, 9)
    m.step()
    m.width, m.depth = 1, 1
    return m


def rect(x0, z0, w, d):
    return {(x, z) for x in range(x0, x0 + w) for z in range(z0, z0 + d)}


def build_main(house, porte, rock, torch, tree):
    m = Model("polynesian_midsize.ldr", "Polynesian Village Resort (mid-size)")
    m.header_notes = ["Mid-size resort collection; generated by design.py (lego-kit)."]
    m.section("The display base", "The base and the black band are the same for every "
              "mid-size kit. The drive, the pools and the lawns go on next; the drive tiles "
              "tie the base plates together.")
    band = display_base(m, SIZE)
    fixed = set(band) | set(TORCHES) | set(PALMS)
    fixed |= rect(HX + 1, HZ, HW - 2, HD)
    fixed |= {(PX + x, PZ + z) for x, z in PC_POSTS}
    for rx, rz in ROCKS:
        fixed |= rect(rx, rz, RWL, RWD)
    lawn = {(x, z) for x in range(W) for z in range(DD)
            if (x, z) not in fixed and ground_colour(x, z) == GREEN}
    paved = {(x, z) for x in range(W) for z in range(DD)} - fixed - lawn
    m.step("The drive tiles run across the seam between the two big base plates.")
    finish_ground(m, fixed | lawn, GREEN, colour_at=ground_colour, size=SIZE)
    m.step()
    finish_ground(m, fixed | paved, GREEN, colour_at=ground_colour, size=SIZE)
    m.step()
    m.sub(house, HX, HZ, 1)
    m.step()
    m.sub(porte, PX, PZ, 1)
    m.step()
    for rx, rz in ROCKS:
        m.sub(rock, rx, rz, 1)
    m.step()
    m.section("The tiki torches, the palms and the planting", "Six tiki torches along the "
              "front and by the entrance, four palms around the rock walls, then shrubs and red "
              "flowers on the lawns.")
    for tx, tz in TORCHES:
        m.sub(torch, tx, tz, 1)
    m.step()
    for px, pz in PALMS:
        m.sub(tree, px, pz, 1)
    m.step()
    m.step("Small shrubs and red flowers on the lawn: a green round brick with leaves on "
           "top, and three-leaf plants with a flower.")
    for (x, z), r in SHRUBS:
        for xx, rr in ((x, r), (mirror(x), (360 - r) % 360)):
            m.add("round1", GREEN, xx, z, 2)
            m.add("pvm_bush", GREEN, xx, z, 5, rot=rr)
    for x, z in HIBISCUS:
        for xx in (x, mirror(x)):
            m.add("leaves1", GREEN, xx, z, 2)
            m.add("flower1", BLOOM, xx, z, 3)
    m.step()
    return m


def build():
    with bestseller_sizes():
        house, porte, rock = build_house(), build_porte(), build_rock_wall()
        torch, tree = build_torch(), palm(trunk=5)
        main_m = build_main(house, porte, rock, torch, tree)
    return main_m, [main_m, house, porte, rock, torch, tree]
