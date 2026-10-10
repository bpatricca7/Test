"""Animal Kingdom Lodge, mid-size display kit (resort collection).

Build with the shared kit:  ./build.sh

The mid-size format (lego-kit/compact.py, size="midsize"): a 32 x 24 base with a
black front band; one storey = 4 plates (a course of bricks and a plate band),
1 stud is about 2 m, the same scale as the compact kit. It shows the arrival front
of Jambo House facing the viewer (-Z), symmetric about x = 15.5, rather than a
bigger copy of the compact kit: a porte-cochere on heavy timber posts over the
drive, the lobby behind it under a two-tier thatched roof, balconied guest wings
stepping back and down on both sides, an acacia, a rock outcrop and grasses.

Grid (studs): x to the right, z toward the back; the front band is z = 0..1.
  porte-cochere   x 12..19, z  4..11   four 2 x 2 timber posts at the corners, timber
                                       beams front and back, an 8 x 8 deck and the tall,
                                       steep thatched kraal roof: an eave of 45-degree
                                       slopes, two rings of 65-degree slopes, a timber
                                       finial on top
  lobby           x 11..20, z 12..19   four storeys of tan walls, a timber-framed glass
                                       front and a great window at the back; a two-tier
                                       thatched roof: eave and steep ring, a clerestory of
                                       timber and glass, then an upper roof on a timber
                                       deck, a timber ridge beam and two finials
  inner wings     x  5..10 and 21..26, z 13..16   four storeys of timber balconies,
                                       hipped reddish-brown roofs (one module, build 2)
  outer wings     x  0..3 and 28..31, z 17..22   two storeys, the same (build 2)
  drive           z 6..9 under the porte-cochere, legs at x 6..9 and 22..25 to the band;
                  the walk to the lobby door at x 14..17, z 10..11
  acacia          trunk at (4, 3), front left; rocks at x 27..30, z 8..10; grasses
"""
import bricks
from bricks import (Model, PARTS, fill_cells, fill_rect, place_rect, row, rot_matrix, _sizes,
                    BLACK, GREEN, RBROWN, TAN, DTAN, DBG)
from walls import WallRing
from compact import compact_project, display_base, finish_ground

SIZE = "midsize"
THATCH, TIMBER, WALL, GLASS, PLINTH = TAN, RBROWN, TAN, BLACK, DTAN
WING_ROOF, ROCK, LEAF, DRIVE = RBROWN, DBG, GREEN, TAN

# Bestseller sizes (checked with avail.py) for colours the toolkit has no entry or a
# shorter one for; added only while this design builds
EXTRA_ALLOWED = {
    ("b", TAN): _sizes("1x1 1x2 1x3 1x4 1x6 1x8 2x2 2x4"),
    ("b", RBROWN): _sizes("1x1 1x2 1x3 1x4 1x6 2x2 2x4"),
    ("b", BLACK): _sizes("1x1 1x2 1x3 1x4 1x6 1x8"),
    ("p", TAN): _sizes("1x1 1x2 1x3 1x4 1x6 1x8 1x10 2x2 2x3 2x4 2x6 2x8 4x4 4x6 8x8"),
    ("p", RBROWN): _sizes("1x1 1x2 1x3 1x4 1x6 1x8 1x10 2x2 2x3 2x4 2x6 2x8 4x4 4x6"),
    ("p", DTAN): _sizes("1x2 1x4 2x4 2x6"),
    ("t", RBROWN): _sizes("1x1 1x2 1x4 1x6 2x2 2x4"),
}

PROJECT = compact_project(
    size=SIZE,
    slug="animal_kingdom_lodge",
    title="Animal Kingdom Lodge",
    resort="Disney's Animal Kingdom Lodge",
    category="Deluxe",
    merged=["Jambo House", "Kidani Village (Disney's Animal Kingdom Villas)"],
    about=("The arrival front of Jambo House at Animal Kingdom Lodge, as a guest sees it "
           "from the drive: the porte-cochere over the drive, a tall, steep, thatched "
           "kraal-style roof on heavy timber posts; the lobby behind it, a timber-framed "
           "glass front under a two-tier thatched roof with a clerestory of timber and "
           "glass; and the guest wings with dark timber balconies and hipped roofs, "
           "stepping back and down on both sides like the curving horseshoe. An acacia, "
           "a rock outcrop and grasses stand on the lawn by the drive."),
    features=["The porte-cochere over the drive: a tall, steep thatched kraal-style roof "
              "with a timber finial, on four heavy timber posts and beams",
              "The lobby behind it: a timber-framed glass front and a two-tier thatched "
              "roof, with a clerestory of timber and glass, a timber ridge beam and two "
              "finials",
              "Guest wings with dark timber balconies and hipped reddish-brown roofs, "
              "stepping back and down on both sides (four storeys, then two) like the "
              "curving horseshoe",
              "Warm, earthy walls in tan on a dark tan base, with reddish-brown timber "
              "floor bands",
              "The drive looping under the porte-cochere, an acacia with two flat layers "
              "of canopy, a rock outcrop and grasses"],
    omitted=["The rest of the horseshoe, the savannas and Kidani Village",
             "The pool, the lobby interior, the carved details and the lanterns",
             "Most of the landscaping"],
    colour_rows=[("Tan", "Brick Yellow", "Tan"),
                 ("Dark Tan", "Sand Yellow", "Dark Tan"),
                 ("Reddish Brown", "Reddish Brown", "Reddish Brown"),
                 ("Black", "Black", "Black"),
                 ("Dark Bluish Gray", "Dark Stone Grey", "Dark Bluish Gray"),
                 ("Green", "Dark Green", "Green")],
    organisation=["The display base, the drive and the lawns", "The lobby",
                  "The inner guest wings (build 2)", "The outer guest wings (build 2)",
                  "The porte-cochere", "The acacia, the rocks and the grasses"],
    sub_info={
        "lobby.ldr": ("The lobby",
                      "Four storeys with a timber-framed glass front, then the two-tier "
                      "thatched roof: an eave and a ring of steep slopes, the clerestory of "
                      "timber and glass, the upper roof on its timber deck, and the ridge."),
        "wing_inner.ldr": ("The inner guest wings",
                           "Four storeys of balconies with timber railings and floor bands, "
                           "and a hipped roof. Build two: one goes on each side of the "
                           "lobby."),
        "wing_outer.ldr": ("The outer guest wings",
                           "Two storeys of balconies and a hipped roof. Build two: they "
                           "stand further back, at the ends of the wings."),
        "porte.ldr": ("The porte-cochere",
                      "Four heavy timber posts, two timber beams and a deck carry the tall, "
                      "steep thatched roof with its timber finial."),
        "acacia.ldr": ("The acacia tree",
                       "A forked trunk and two flat layers of canopy, each with a spray of "
                       "leaves."),
    },
    legend=("acacia.ldr", 1),
    tips=["The thatched roofs go up one ring of steep slopes at a time. Hidden tan bricks "
          "inside each ring hold up the next one; they have a step of their own.",
          "On the guest wings, each balcony railing is a reddish-brown tile one stud in "
          "front of the black glass; the floor plates above tie the walls together.",
          "The finials sit on plates with one centre stud, half a stud off the grid.",
          "A <b>&ldquo;Build 2&rdquo;</b> badge means you build that module twice."],
    build_time="about 2 to 2&frac12; hours",
)


def rect(x0, z0, w, d):
    return {(x, z) for x in range(x0, x0 + w) for z in range(z0, z0 + d)}


# --------------------------------------------------------------------------
# steep thatched roofs: rings of 65-degree slopes
# --------------------------------------------------------------------------
def ring65(m, xa, xb, za, zb, L, colour):
    """One ring of 65-degree slopes around the rectangle xa..xb, za..zb."""
    for x in range(xa, xb + 1):
        m.add("slope65", colour, x, za, L, rot=0)
        m.add("slope65", colour, x, zb - 1, L, rot=180)
    for z in range(za + 2, zb - 1):
        m.add("slope65", colour, xa, z, L, rot=90)
        m.add("slope65", colour, xb - 1, z, L, rot=270)


def ring45(m, xa, xb, za, zb, L, colour):
    """One ring of 2 x 2 45-degree slopes (even sizes only)."""
    for x in range(xa, xb + 1, 2):
        m.add("s45x2", colour, x, za, L, rot=0)
        m.add("s45x2", colour, x, zb - 1, L, rot=180)
    for z in range(za + 2, zb - 1, 2):
        m.add("s45x2", colour, xa, z, L, rot=90)
        m.add("s45x2", colour, xb - 1, z, L, rot=270)


def steep_roof(m, w, d, base, colour, flare=True, core_colour=None):
    """A steep hip roof over the deck x 0..w-1, z 0..d-1 at layer `base`.

    An eave ring of 45-degree slopes (flare), then rings of 65-degree slopes that
    step in one stud at a time, each held up by hidden bricks inside the ring
    below (a step of their own). Small slopes round off the studs left at the
    corners of the lower rings. Returns the top layer and the top cells."""
    core_colour = core_colour or colour
    L, k, corners = base, 0, []
    if flare:
        ring45(m, 0, w - 1, 0, d - 1, L, colour)
        m.step()
        corners.append((0, w - 1, 1, d - 2, L + 3))
        L, k = L + 3, 1
    while w - 2 * k >= 4 and d - 2 * k >= 4:
        xa, xb, za, zb = k, w - 1 - k, k, d - 1 - k
        if L > base:
            h = 3 if (flare and k == 1) else 6
            cells = rect(xa + 1, za + 1, xb - xa - 1, zb - za - 1)
            for Lc in range(L - h, L, 3):
                fill_cells(m, "b", core_colour, cells, Lc)
            m.step()
        ring65(m, xa, xb, za, zb, L, colour)
        m.step()
        corners.append((xa, xb, za + 1, zb - 1, L + 6))
        L, k = L + 6, k + 1
    xa, xb, za, zb, L = corners.pop()
    for x0, x1, z0, z1, layer in corners:
        for z in (z0, z1):
            m.add("cheese", colour, x0, z, layer, rot=90)
            m.add("cheese", colour, x1, z, layer, rot=270)
    m.step()
    top = rect(xa, za, xb - xa + 1, zb - za + 1)
    top -= {(x, z) for x in (xa, xb) for z in range(za + 1, zb)}
    return L, top


def finial(m, x, z, layer, colour=TIMBER, pole=True):
    """A 2 x 2 jumper plate with a timber pole and cone on its centre stud."""
    j = m.add("jumper2x2", THATCH, x, z, layer)
    y = -8 * (layer + 1)
    cx, cz = 20 * x + 20, 20 * z + 20
    below = j
    if pole:
        below = m.add_raw("round1", colour, (cx, y - PARTS["round1"].bmax_y, cz),
                          rot_matrix(0), attach_to=j)
        y -= 24
    m.add_raw("cone1", colour, (cx, y - PARTS["cone1"].bmax_y, cz), rot_matrix(0),
              attach_to=below)
    return j


# --------------------------------------------------------------------------
# the porte-cochere: timber posts, a deck and the kraal roof
# --------------------------------------------------------------------------
PC_W, PC_D = 8, 8
PC_POSTS = ((0, 0), (6, 0), (0, 6), (6, 6))      # 2 x 2 posts (min corners)
PC_POST_BRICKS = 3


def build_porte():
    m = Model("porte.ldr", "Porte-cochere")
    m.step("Heavy timber posts: three 2×2 bricks each.")
    for L in range(0, 3 * PC_POST_BRICKS, 3):
        for x, z in PC_POSTS:
            m.add("b2x2", TIMBER, x, z, L)
    m.step()
    beam = 3 * PC_POST_BRICKS
    m.step("Timber beams join the posts in pairs, front and back.")
    for z in (0, PC_D - 2):
        place_rect(m, "p", TIMBER, 0, z, PC_W, 2, beam)
    m.step()
    deck = beam + 1
    m.step("The deck: one 8×8 plate across the beams.")
    place_rect(m, "p", THATCH, 0, 0, PC_W, PC_D, deck)
    m.step()
    top, cells = steep_roof(m, PC_W, PC_D, deck + 1, THATCH)
    xs = sorted({c[0] for c in cells})
    zs = sorted({c[1] for c in cells})
    cx, cz = (xs[0] + xs[-1]) // 2, zs[0]
    m.step("The finial: a timber pole and cone on the plate with one stud.")
    finial(m, cx, cz, top)
    for x, z in sorted(cells - rect(cx, cz, 2, 2)):
        m.add("cheese", THATCH, x, z, top, rot=90 if x < cx else 270)
    m.step()
    m.width, m.depth = PC_W, PC_D
    return m


# --------------------------------------------------------------------------
# the lobby: four storeys and a two-tier thatched roof with a clerestory
# --------------------------------------------------------------------------
LOB_W, LOB_D, LOB_FLOORS = 10, 8, 4
LOB_POSTS = (1, 8)                       # timber posts framing the glass front
LOB_DOOR = (4, 5)


def storeys(m, w, d, floors, mat, band=TIMBER):
    """Plinth ring, then storeys: a brick course (WallRing) and a band of plates.
    The top band is a full slab. Returns the roof base layer."""
    ring_cells = {(x, z) for x in range(w) for z in range(d) if x in (0, w - 1) or z in (0, d - 1)}
    fill_cells(m, "p", PLINTH, ring_cells, 0)
    m.step()
    ring = WallRing([(0, 0), (w - 1, 0), (w - 1, d - 1), (0, d - 1)])
    for f in range(1, floors + 1):
        L = 1 + 4 * (f - 1)

        def mat_(x, z, layer, f=f):
            c = mat(x, z, f)
            return None if c is None else ("b", c)
        ring.course(m, L, f % 2, mat_)
        m.step()
        if f < floors:
            fill_cells(m, "p", band, ring_cells, L + 3)
        else:
            fill_rect(m, "p", band, 0, 0, w, d, L + 3, along="x")
        m.step()
    return 1 + 4 * floors


def corner_cheese(m, xa, xb, za, zb, layer, colour=THATCH):
    for z in (za, zb):
        m.add("cheese", colour, xa, z, layer, rot=90)
        m.add("cheese", colour, xb, z, layer, rot=270)


def build_lobby():
    m = Model("lobby.ldr", "Lobby")
    W, D = LOB_W, LOB_D

    def mat(x, z, f):
        if z == 0 and 0 < x < W - 1:
            if x in LOB_POSTS:
                return TIMBER
            if f == 1 and x in LOB_DOOR:
                return None                    # the entrance
            return GLASS
        if z == D - 1 and 2 < x < W - 3:
            return GLASS                       # the great window to the savanna
        return WALL
    B = storeys(m, W, D, LOB_FLOORS, mat)
    # the lower roof: an eave of 45-degree slopes and a ring of steep slopes
    ring45(m, 0, W - 1, 0, D - 1, B, THATCH)
    m.step()
    fill_cells(m, "b", THATCH, rect(2, 2, W - 4, D - 4), B)
    m.step()
    ring65(m, 1, W - 2, 1, D - 2, B + 3, THATCH)
    m.step()
    corner_cheese(m, 0, W - 1, 1, D - 2, B + 3)
    corner_cheese(m, 1, W - 2, 2, D - 3, B + 9)
    m.step()
    # the clerestory: timber and glass under the upper roof
    m.step("The clerestory: a ring of timber and glass on the lower roof.")
    ring = WallRing([(2, 2), (W - 3, 2), (W - 3, D - 3), (2, D - 3)])

    def clere(x, z, layer):
        if z in (2, D - 3) and 2 < x < W - 3:
            return ("b", TIMBER if x in LOB_DOOR else GLASS)
        return ("b", TIMBER)
    ring.course(m, B + 9, 0, clere)
    m.step()
    m.step("The deck of the upper roof overhangs the clerestory by one stud.")
    fill_rect(m, "p", TIMBER, 1, 1, W - 2, D - 2, B + 12, along="x")
    m.step()
    # the upper roof, on the deck x 1..W-2, z 1..D-2
    U = B + 13
    ring45(m, 1, W - 2, 1, D - 2, U, THATCH)
    m.step()
    fill_cells(m, "b", THATCH, rect(3, 3, W - 6, D - 6), U)
    m.step()
    ring65(m, 2, W - 3, 2, D - 3, U + 3, THATCH)
    m.step()
    corner_cheese(m, 1, W - 2, 2, D - 3, U + 3)
    m.step()
    # the ridge: a timber ridge beam of tiles between two timber finials
    top = U + 9
    fins = (2, W - 4)
    for fx in fins:
        finial(m, fx, 3, top, pole=False)
    fill_cells(m, "t", TIMBER, rect(4, 3, W - 8, 2), top, sizes={1: [2]})
    m.step()
    m.width, m.depth = W, D
    return m


# --------------------------------------------------------------------------
# guest wings: balconies with timber railings, and a hipped roof
# --------------------------------------------------------------------------
def hip45(m, w, d, base, colour):
    """A hipped roof of 2 x 2 slopes in rings, closed with tiles and small slopes."""
    L, k, rings = base, 0, []
    while w - 2 * k >= 4 and d - 2 * k >= 4:
        xa, xb, za, zb = k, w - 1 - k, k, d - 1 - k
        if k:
            cells = rect(xa + 1, za + 1, xb - xa - 1, zb - za - 1)
            fill_cells(m, "b", colour, cells, L - 3)
            m.step()
        ring45(m, xa, xb, za, zb, L, colour)
        m.step()
        rings.append((xa, xb, za, zb, L + 3))
        L, k = L + 3, k + 1
    # small slopes on the studs left at the ends of each ring's front and back rows
    for xa, xb, za, zb, layer in rings:
        for z in (za + 1, zb - 1):
            m.add("cheese", colour, xa, z, layer, rot=90)
            m.add("cheese", colour, xb, z, layer, rot=270)
    # tiles along the ridge
    xa, xb, za, zb, L = rings[-1]
    fill_cells(m, "t", colour, rect(xa + 1, za + 1, xb - xa - 1, zb - za - 1), L)
    m.step()


def build_wing(name, title, W, D, floors, front, side_windows=(2,)):
    """`front`: the recessed wall behind the balconies, x = 1..W-2 (G glass, W wall)."""
    m = Model(name, title)
    fill_rect(m, "p", PLINTH, 0, 0, W, D, 0, along="z")
    m.step()
    ring = WallRing([(0, 1), (W - 1, 1), (W - 1, D - 1), (0, D - 1)])
    corners = ((0, 1), (W - 1, 1))

    def mat(x, z, layer):
        if (x, z) in corners:
            return None                        # the corner posts, laid with the course
        if z == 1:
            return ("b", GLASS if front[x - 1] == "G" else WALL)
        if x in (0, W - 1) and z in side_windows:
            return ("b", GLASS)
        if z == D - 1 and 0 < x < W - 1:
            return ("b", GLASS)
        return ("b", WALL)
    for f in range(1, floors + 1):
        L = 1 + 4 * (f - 1)
        ring.course(m, L, f % 2, mat)
        for x in (0, W - 1):
            m.add("b1x2", WALL, x, 0, L, rot=90)
        m.step("The balcony railing: a timber tile one stud in front of the glass."
               if f == 1 else None)
        row(m, "t", TIMBER, 1, 0, W - 2, L)                  # the balcony railing
        m.step()
        if f < floors:
            fill_rect(m, "p", TIMBER, 1, 0, W - 2, 2, L + 3, along="x")
            for x in (0, W - 1):
                row(m, "p", TIMBER, x, 0, D, L + 3, axis="z")
            row(m, "p", TIMBER, 1, D - 1, W - 2, L + 3)
        else:
            fill_rect(m, "p", TIMBER, 0, 0, W, D, L + 3, along="z")
        m.step()
    hip45(m, W, D, 1 + 4 * floors, WING_ROOF)
    m.width, m.depth = W, D
    return m


# --------------------------------------------------------------------------
# details: the acacia, rocks and grasses
# --------------------------------------------------------------------------
ACACIA_TRUNK = (2, 2)                    # in the acacia's own grid


def build_acacia():
    m = Model("acacia.ldr", "Acacia tree")
    tx, tz = ACACIA_TRUNK
    for L in (0, 3, 6, 9):
        m.add("round1", TIMBER, tx, tz, L)
    m.add("p1x4", TIMBER, tx - 1, tz, 12)              # the trunk forks
    m.add("round1", TIMBER, tx - 1, tz, 13)
    m.add("round1", TIMBER, tx + 2, tz, 13)
    m.add("round1", TIMBER, tx + 2, tz, 16)
    m.step()
    m.step("Two flat layers of canopy, one on each branch.")
    m.add("p4x6", LEAF, tx - 3, tz - 2, 16, rot=90)
    m.add("leaves6x5", LEAF, tx - 2, tz, 17)
    m.add("p4x6", LEAF, tx, tz - 2, 19)
    m.add("leaves6x5", LEAF, tx + 3, tz - 1, 20, rot=90)
    m.step()
    m.width, m.depth = 9, 5
    return m


def add_rocks(m, x0, z0, layer):
    """A rock outcrop on the lawn: two big grey slopes, small slopes on top."""
    m.step("A rock outcrop: two big grey slopes, with small slopes on their studs.")
    m.add("s45x2", ROCK, x0, z0, layer, rot=0)
    m.add("s45x2", ROCK, x0 + 2, z0 + 1, layer, rot=270)
    m.step()
    m.add("cheese", ROCK, x0, z0 + 1, layer + 3, rot=90)
    m.add("cheese", ROCK, x0 + 1, z0 + 1, layer + 3, rot=0)
    m.add("cheese", ROCK, x0 + 2, z0 + 2, layer + 3, rot=270)
    m.step()


# --------------------------------------------------------------------------
# main model
# --------------------------------------------------------------------------
PORTE = (12, 4)
LOBBY = (11, 12)
INNER = ((5, 13), (21, 13))
OUTER = ((0, 17), (28, 17))
IN_W, IN_D, IN_FLOORS = 6, 4, 4
OUT_W, OUT_D, OUT_FLOORS = 4, 6, 2
DRIVE_Z = range(6, 10)
DRIVE_X = range(6, 26)
LEGS = (range(6, 10), range(22, 26))
PLAZA = rect(14, 10, 4, 2)
ACACIA = (2, 1)
ROCKS = (27, 8)
GRASS = ((11, 2), (20, 3), (26, 8), (30, 11), (28, 12), (1, 8), (5, 11), (2, 10))


def ground_colour(x, z):
    if z in DRIVE_Z and x in DRIVE_X:
        return DRIVE
    if z < 6 and any(x in leg for leg in LEGS):
        return DRIVE
    if (x, z) in PLAZA:
        return DRIVE
    return GREEN


def build_main(lobby, inner, outer, porte, acacia):
    m = Model("animal_kingdom_lodge_midsize.ldr", "Animal Kingdom Lodge (mid-size)")
    m.header_notes = ["Mid-size resort collection; generated by design.py (lego-kit)."]
    m.section("The display base", "The base and the black band are the same for every "
              "mid-size kit. The drive, the entrance and the lawns go on next.")
    band = display_base(m, SIZE)
    reserved = set(band)
    reserved |= rect(*LOBBY, LOB_W, LOB_D)
    for x, z in INNER:
        reserved |= rect(x, z, IN_W, IN_D)
    for x, z in OUTER:
        reserved |= rect(x, z, OUT_W, OUT_D)
    for px, pz in PC_POSTS:
        reserved |= rect(PORTE[0] + px, PORTE[1] + pz, 2, 2)
    reserved.add((ACACIA[0] + ACACIA_TRUNK[0], ACACIA[1] + ACACIA_TRUNK[1]))
    finish_ground(m, reserved, GREEN, colour_at=ground_colour, size=SIZE)
    m.step()
    m.sub(lobby, *LOBBY, 1)
    m.step()
    for x, z in INNER:
        m.sub(inner, x, z, 1)
    m.step()
    for x, z in OUTER:
        m.sub(outer, x, z, 1)
    m.step()
    m.sub(porte, *PORTE, 1)
    m.step()
    m.section("The acacia, the rocks and the grasses",
              "An acacia, a rock outcrop and tufts of grass finish the lawn.")
    m.sub(acacia, *ACACIA, 1)
    add_rocks(m, *ROCKS, 2)
    for x, z in GRASS:
        m.add("leaves1", LEAF, x, z, 2)
    m.step()
    return m


def build():
    saved = {k: bricks.ALLOWED.get(k) for k in EXTRA_ALLOWED}
    bricks.ALLOWED.update(EXTRA_ALLOWED)
    try:
        return _build()
    finally:
        for k, v in saved.items():
            if v is None:
                del bricks.ALLOWED[k]
            else:
                bricks.ALLOWED[k] = v


def _build():
    lobby = build_lobby()
    inner = build_wing("wing_inner.ldr", "Inner guest wing (build 2)", IN_W, IN_D, IN_FLOORS,
                       "WGGW", side_windows=(2,))
    outer = build_wing("wing_outer.ldr", "Outer guest wing (build 2)", OUT_W, OUT_D, OUT_FLOORS,
                       "GG", side_windows=(2, 3))
    porte = build_porte()
    acacia = build_acacia()
    main_m = build_main(lobby, inner, outer, porte, acacia)
    return main_m, [main_m, lobby, inner, outer, porte, acacia]
