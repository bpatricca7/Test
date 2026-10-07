"""Polynesian Village Resort, mid-size display kit (resort collection).

Build with the shared kit:  ./build.sh

The mid-size format (lego-kit/compact.py, size="midsize"): a 32 x 24 base with a
black front band; one storey = 4 plates (a course of bricks and a plate band),
1 stud is about 2 m, the same scale as the compact kit.

Grid (studs): x to the right, z toward the back; the front band is z = 0..1.
  Great Ceremonial House  x 2..13, z 8..19   a long hall under the very steep A-frame
                          roof: five courses of 65-degree tan slopes, each on a dark tan
                          tie plate (the layers of thatch); the dark timber gable at the
                          front with a tall window over the door; timber posts and glass
                          along the long sides under the eaves (walls x 3..12 on a ring
                          of plinth plates); the ridge beam sticking out at both ends
  guest longhouse         x 17..28, z 13..18 (roof x 16..29, ridge x 15..30)  three
                          storeys of tan walls with glass doors set back behind timber
                          railings (z = 13 is the balcony line), under a steep tan roof
                          in two layers with timber gables
  sandy path              x 6..9, z 2..7, to the door; tiki torches at x 5 and 10, z 3 and 6
  lagoon and beach        x 12..31: blue water from the band to z 4 (z 5 from x 20), then
                          three rows of sand with tiki torches at (20, 7) and (24, 7);
                          lawn everywhere else
  palms                   (3, 4) on the lawn, (16, 6) and (28, 7) on the beach
"""
from contextlib import contextmanager

import bricks
from bricks import Model, row, fill_rect, fill_cells, place_rect, _sizes
from bricks import RBROWN, TAN, DTAN, DBG, BLACK, GREEN, BRORANGE, BLUE
from walls import WallRing
from compact import FORMATS, compact_project, display_base, finish_ground, palm

TORANGE = 57                                   # Trans-Orange
THATCH, LAYER, TIMBER, GLASS, ROCK = TAN, DTAN, RBROWN, BLACK, DBG
WALL, FLAME, GLOW, WATER, SAND = TAN, BRORANGE, TORANGE, BLUE, TAN

# Bestseller sizes for colours the toolkit has no entry for (checked with avail.py);
# added only while this design builds, so other kits are unaffected
EXTRA_ALLOWED = {
    ("b", RBROWN): _sizes("1x1 1x2 1x3 1x4 1x6"),
    ("b", TAN): _sizes("1x1 1x2 1x3 1x4 1x6 1x8"),
    ("p", DTAN): _sizes("1x2 1x4 2x4 2x6"),
    ("t", BLUE): _sizes("1x1 1x2 1x4 1x6 1x8 2x2 2x4"),
    ("t", RBROWN): _sizes("1x1 1x2 1x4 1x6 2x2 2x4"),
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
    size="midsize",
    slug="polynesian",
    title="Polynesian Village Resort",
    resort="Disney's Polynesian Village Resort",
    category="Deluxe",
    merged=["Disney's Polynesian Villas & Bungalows",
            "Island Tower at Disney's Polynesian Village Resort"],
    about=("The heart of the Polynesian: the Great Ceremonial House, a long hall under a very "
           "tall, steep thatched A-frame roof, with its dark timber gable and tall window over "
           "the entrance, and timber posts and glass along its long sides. Beside it stands a "
           "three-storey guest longhouse with balconies under a steep thatched roof of its own, "
           "looking out over a sandy beach and a strip of the lagoon. A sandy path lined with "
           "tiki torches leads to the door, and palms grow on the lawn and the beach."),
    features=["The Great Ceremonial House: a long hall under a very tall, steep A-frame roof, "
              "shown from the gable and along its long side",
              "The thatch: tan 65-degree slopes laid in five layers with dark tan edges",
              "The dark timber gable with a tall window over the entrance, and the ridge beam "
              "sticking out at both ends",
              "A three-storey guest longhouse with balconies behind timber railings, under a "
              "steep thatched roof with timber gables",
              "Six tiki torches with glowing flames: four along the sandy path to the door "
              "and two on the beach",
              "A strip of the lagoon with a sandy beach, and three palms"],
    omitted=["The other guest longhouses, Island Tower and the over-water bungalows",
             "The porte-cochere, the monorail station, the pools and most of the gardens"],
    colour_rows=[("Tan", "Brick Yellow", "Tan"), ("Dark Tan", "Sand Yellow", "Dark Tan"),
                 ("Reddish Brown", "Reddish Brown", "Reddish Brown"),
                 ("Black", "Black", "Black"),
                 ("Dark Bluish Gray", "Dark Stone Grey", "Dark Bluish Gray"),
                 ("Blue", "Bright Blue", "Blue"),
                 ("Orange", "Bright Orange", "Orange"),
                 ("Trans-Orange", "Transparent Bright Orange", "Trans-Orange"),
                 ("Green", "Dark Green", "Green")],
    organisation=["The display base, the lawn, the path, the beach and the lagoon",
                  "The Great Ceremonial House", "The guest longhouse",
                  "The tiki torches and the palms (build 6 torches and 3 palms)"],
    sub_info={
        "ceremonial_house.ldr": (
            "The Great Ceremonial House",
            "A low storey of timber and glass, then the steep roof one course at a time: "
            "a dark tan tie plate on each side, the tan slopes on it, and the timber gables "
            "between them."),
        "longhouse.ldr": (
            "The guest longhouse",
            "Three storeys of tan walls with glass doors set back behind timber railings, "
            "then a steep thatched roof in two layers with timber gables."),
        "torch.ldr": ("The tiki torches", "A tall brown post, an orange flame and a glowing "
                      "trans-orange tip."),
        "palm.ldr": ("The palms", "A trunk of round bricks and two layers of fronds."),
    },
    legend=("torch.ldr", 1),
    tips=["The roofs go up one course at a time: first the dark tan plates, then the tan "
          "slopes on them, then the reddish brown bricks of the gables at the ends.",
          "Each slope sits on the dark tan plate below it. Press every slope down firmly "
          "before the next plates go on: they lock the slopes together.",
          "On the longhouse, the railings and the posts between the balconies stand one stud "
          "in front of the glass doors; the floor plates above tie them to the walls.",
          "A <b>&ldquo;Build 6&rdquo;</b> or <b>&ldquo;Build 3&rdquo;</b> badge means you "
          "build that module that many times."],
    build_time="about 2 to 3 hours",
)

# --------------------------------------------------------------------------
# layout on the base
# --------------------------------------------------------------------------
W, DD = FORMATS["midsize"]["w"], FORMATS["midsize"]["d"]     # the base: 32 x 24
RW, D = 12, 12                     # Great Ceremonial House: roof width (eave to eave), depth
HX, HZ = 2, 8                      # its corner on the base
K = RW // 2 - 1                    # roof courses: 0 .. K-1
DOOR = (RW // 2 - 1, RW // 2)      # local x of the entrance

LW, LD = 12, 6                     # longhouse walls: x 0..LW-1, z 0..LD-1 (z = 0: balconies)
LX, LZ = 17, 13                    # its corner on the base
LK = LD // 2 - 1                   # longhouse roof courses
BAYS = ((1, 3), (5, 6), (8, 10))   # balcony bays (local x ranges); posts between them

PATH = (HX + DOOR[0] - 1, HX + DOOR[1] + 1)          # x range of the sandy path
TORCHES = ((PATH[0] - 1, 3), (PATH[1] + 1, 3), (PATH[0] - 1, 6), (PATH[1] + 1, 6),
           (20, 7), (24, 7))                         # four by the path, two on the beach
PALMS = ((3, 4), (16, 6), (28, 7))       # fronds clear of the roofs and the base edges


def ground_colour(x, z):
    """Lagoon at the front on the right, a beach behind it, a sandy path to the door."""
    if PATH[0] <= x <= PATH[1] and z < HZ:
        return SAND
    if x >= 12:
        edge = 4 if x < 20 else 5                 # the waterline
        if z <= edge:
            return WATER
        if z <= edge + 3:
            return SAND
    return GREEN


# --------------------------------------------------------------------------
# small helpers
# --------------------------------------------------------------------------
def strip(m, colour, x, z, length, layer, axis="z", sizes=(6, 4)):
    """A 2-wide strip of plates (dark tan: 2x6 and 2x4 only)."""
    pos = 0
    for n in _split_even(length, sizes):
        if axis == "z":
            place_rect(m, "p", colour, x, z + pos, 2, n, layer)
        else:
            place_rect(m, "p", colour, x + pos, z, n, 2, layer)
        pos += n


def _split_even(n, sizes):
    """Split n into the given sizes (e.g. 14 = 6 + 4 + 4)."""
    best = bricks.split_length(n, list(sizes))
    if best is None:
        raise ValueError(f"cannot split {n} into {sizes}")
    return best


def pattern_row(m, z, x0, x1, layer, colour_at, axis="x"):
    """Bricks from x0 to x1 (inclusive) along a row, a run per colour."""
    x = x0
    while x <= x1:
        c = colour_at(x)
        x2 = x
        while x2 + 1 <= x1 and colour_at(x2 + 1) == c:
            x2 += 1
        if c is not None:
            if axis == "x":
                row(m, "b", c, x, z, x2 - x + 1, layer)
            else:
                row(m, "b", c, z, x, x2 - x + 1, layer, axis="z")
        x = x2 + 1


# --------------------------------------------------------------------------
# the Great Ceremonial House
# --------------------------------------------------------------------------
def house_wall(x, z):
    """The storey under the eaves: timber posts and dark glass."""
    if z == 0:
        if x in DOOR:
            return None                                   # the entrance
        return TIMBER if x in (1, min(DOOR) - 1, max(DOOR) + 1, RW - 2) else GLASS
    if z == D - 1:
        return TIMBER if x % 3 else GLASS
    return TIMBER if z % 3 == 0 else GLASS                # the long sides


def gable_mat(x, k, r, front):
    """Timber gable; at the front a tall window rises over the entrance."""
    if front:
        if k == 0 and x in (min(DOOR) - 1, max(DOOR) + 1):
            return GLASS
        if x in DOOR and (k < 3 or (k == 3 and r == 0)):
            return GLASS
        if k == 1 and r == 0 and x in (min(DOOR) - 1, max(DOOR) + 1):
            return GLASS
    return TIMBER


def build_house():
    m = Model("ceremonial_house.ldr", "Great Ceremonial House")
    # a ring of plinth plates under the walls (the eaves overhang the lawn)
    place_rect(m, "p", ROCK, 1, 0, 2, D, 0)
    place_rect(m, "p", ROCK, RW - 3, 0, 2, D, 0)
    for z in (0, D - 1):
        place_rect(m, "p", ROCK, 3, z, RW - 6, 1, 0)
    m.step()
    ring = WallRing([(1, 0), (RW - 2, 0), (RW - 2, D - 1), (1, D - 1)])

    def mat(x, z, layer):
        c = house_wall(x, z)
        return None if c is None else ("b", c)
    ring.course(m, 1, 0, mat)
    m.add("t1x2", THATCH, min(DOOR), 0, 1)               # the doorstep
    m.step()
    # the eave deck: the edges of the thatch along the sides, a timber beam across the gables
    strip(m, LAYER, 0, 0, D, 4)
    strip(m, LAYER, RW - 2, 0, D, 4)
    for z in (0, D - 1):
        row(m, "p", TIMBER, 2, z, RW - 4, 4)
    m.step()
    base = 5
    for k in range(K):
        L = base + 7 * k                                  # bottom of this course's slopes
        if k:
            if k == 1:
                m.step("The dark tan plates are the edges of the thatch layers; they also "
                       "lock the slopes below together.")
            strip(m, LAYER, k, 0, D, L - 1)
            strip(m, LAYER, RW - 2 - k, 0, D, L - 1)
            if RW - 4 - 2 * k > 0:
                for z in (0, D - 1):
                    row(m, "p", TIMBER, k + 2, z, RW - 4 - 2 * k, L - 1)
            m.step()
        for z in range(D):
            m.add("slope65", THATCH, k, z, L, rot=90)
            m.add("slope65", THATCH, RW - 2 - k, z, L, rot=270)
        m.step()
        if RW - 4 - 2 * k > 0:
            for z in (0, D - 1):
                for r in (0, 1):
                    pattern_row(m, z, k + 2, RW - 3 - k, L + 3 * r,
                                lambda x, k=k, r=r, z=z: gable_mat(x, k, r, z == 0))
            m.step()
    # the ridge: a timber beam along the top, sticking out over both gables
    top = base + 7 * (K - 1) + 6
    rx = K
    z = -1
    for n in _split_even(D + 2, (8, 6, 4)):
        place_rect(m, "p", TIMBER, rx, z, 2, n, top)
        z += n
    m.step()
    for z in range(-1, D + 1):
        m.add("cheese", THATCH, rx, z, top + 1, rot=90)
        m.add("cheese", THATCH, rx + 1, z, top + 1, rot=270)
    m.step()
    m.width, m.depth = RW, D
    return m


# --------------------------------------------------------------------------
# the guest longhouse
# --------------------------------------------------------------------------
def long_wall(x, z, f):
    """Window wall (z = 1) mostly glass doors; tan side and back walls with windows."""
    if z == 1:
        return GLASS if any(a <= x <= b for a, b in BAYS) else WALL
    if z == LD - 1:
        return GLASS if (x % 4 == 2 and f > 1) else WALL
    if x in (0, LW - 1):
        return GLASS if (z == 3 and f > 1) else WALL
    return WALL


def build_longhouse():
    m = Model("longhouse.ldr", "Guest longhouse")
    fill_rect(m, "p", ROCK, 0, 0, LW, LD, 0, along="x")
    m.step()
    ring = WallRing([(0, 1), (LW - 1, 1), (LW - 1, LD - 1), (0, LD - 1)])
    posts = [0, LW - 1] + [b + 1 for a, b in BAYS[:-1]]
    for f in range(1, 4):
        L = 1 + 4 * (f - 1)
        ring.course(m, L, f % 2, lambda x, z, layer, f=f: ("b", long_wall(x, z, f)))
        for x in posts:
            m.add("b1x1", WALL if x in (0, LW - 1) else TIMBER, x, 0, L)
        for a, b in BAYS:
            row(m, "t", TIMBER, a, 0, b - a + 1, L)          # the railing
        m.step()
        if f < 3:
            cells = {(x, z) for x in range(LW) for z in range(LD)
                     if z in (0, 1, LD - 1) or x in (0, LW - 1)}
            fill_cells(m, "p", TIMBER, cells, L + 3)
        else:
            # the top floor: a full slab that sticks out one stud at both gable ends
            fill_rect(m, "p", TIMBER, -1, 0, LW + 2, LD, L + 3, along="z")
        m.step()
    base = 1 + 4 * 3                                      # the roof sits on the top slab
    for k in range(LK):
        L = base + 7 * k
        if k:
            strip(m, LAYER, -1, k, LW + 2, L - 1, axis="x")
            strip(m, LAYER, -1, LD - 2 - k, LW + 2, L - 1, axis="x")
            m.step()
        for x in range(-1, LW + 1):
            m.add("slope65", THATCH, x, k, L, rot=0)
            m.add("slope65", THATCH, x, LD - 2 - k, L, rot=180)
        m.step()
        if LD - 4 - 2 * k > 0:
            for x in (0, LW - 1):
                for r in (0, 1):
                    row(m, "b", TIMBER, x, k + 2, LD - 4 - 2 * k, L + 3 * r, axis="z")
            m.step()
    top = base + 7 * (LK - 1) + 6
    rz = LK
    x = -2
    for n in _split_even(LW + 4, (8, 6, 4)):
        place_rect(m, "p", TIMBER, x, rz, n, 2, top)
        x += n
    m.step()
    for x in range(-2, LW + 2):
        m.add("cheese", THATCH, x, rz, top + 1, rot=0)
        m.add("cheese", THATCH, x, rz + 1, top + 1, rot=180)
    m.step()
    m.width, m.depth = LW, LD
    return m


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


def build_main(house, longhouse, torch, tree):
    m = Model("polynesian_midsize.ldr", "Polynesian Village Resort (mid-size)")
    m.header_notes = ["Mid-size resort collection; generated by design.py (lego-kit)."]
    m.section("The display base", "The base and the black band are the same for every mid-size "
              "kit in the collection. Then the lawn, the sandy path, the beach and the lagoon.")
    band = display_base(m, "midsize")
    fixed = set(band) | set(TORCHES) | set(PALMS)
    fixed |= {(HX + x, HZ + z) for x in range(1, RW - 1) for z in range(D)}
    fixed |= {(LX + x, LZ + z) for x in range(LW) for z in range(LD)}
    lawn = {(x, z) for x in range(W) for z in range(DD)
            if (x, z) not in fixed and ground_colour(x, z) == GREEN}
    sandy = {(x, z) for x in range(W) for z in range(DD)} - fixed - lawn
    # first the tiles (the lagoon, the beach and the path), then the lawn
    m.step("The tiles of the lagoon and the beach run across the seam between the two big "
           "base plates and help hold them together.")
    finish_ground(m, fixed | lawn, GREEN, colour_at=ground_colour, size="midsize")
    m.step()
    finish_ground(m, fixed | sandy, GREEN, colour_at=ground_colour, size="midsize")
    m.step()
    m.sub(house, HX, HZ, 1)
    m.step()
    m.sub(longhouse, LX, LZ, 1)
    m.step()
    m.section("The tiki torches and the palms", "Four tiki torches along the path, two on the "
              "beach, and three palms on the lawn and the beach.")
    for tx, tz in TORCHES:
        m.sub(torch, tx, tz, 1)
    m.step()
    for px, pz in PALMS:
        m.sub(tree, px, pz, 1)
    m.step()
    return m


def build():
    with bestseller_sizes():
        house, longhouse = build_house(), build_longhouse()
        torch, tree = build_torch(), palm()
        main_m = build_main(house, longhouse, torch, tree)
    return main_m, [main_m, house, longhouse, torch, tree]
