"""Animal Kingdom Lodge, compact display kit (resort collection).

Build with the shared kit:  ./build.sh

The compact format (lego-kit/compact.py): a 24 x 16 base with a black front
band; one storey = 4 plates (a course of bricks and a plate band), 1 stud is about 2 m.

Grid (studs): x to the right, z toward the back; the front band is z = 0..1.
  Jambo House lobby  x  8..15, z 5..12   the roof deck on a porch of four timber posts
                                         (z 5..7) and three storeys of earthy walls
                                         (x 9..14, z 8..11) on a dark tan plinth; the
                                         tall, steep thatched hip roof: an eave of 45
                                         degree slopes, two rings of 65 degree slopes,
                                         a dark tan ridge and a timber finial
  guest wings        x  4..7 / 16..19, z 7..12  and  x 0..3 / 20..23, z 10..15:
                                         three-storey blocks stepping back on both
                                         sides, each under a steep thatched roof
                                         (one module, build 4)
  acacia             trunk at (2, 4)
  drive              x 8..15, z 2..4 to the porch
"""
import bricks
from bricks import (Model, PARTS, fill_cells, fill_rect, rot_matrix, BLACK, GREEN, RBROWN, TAN,
                    DTAN, NOUGAT)
from walls import WallRing
from compact import compact_project, display_base, finish_ground

WALL, TIMBER, THATCH, RIDGE, WINDOW, PLINTH = NOUGAT, RBROWN, TAN, DTAN, BLACK, DTAN
LEAF = GREEN

# Bestseller sizes for the colours used here as bricks, plates and tiles (avail.py)
bricks.ALLOWED[("b", NOUGAT)] = bricks._sizes("1x1 1x2")
bricks.ALLOWED[("b", RBROWN)] = bricks._sizes("1x1 1x2 1x3 1x4 1x6")
bricks.ALLOWED[("p", DTAN)] = bricks._sizes("1x2 1x4 2x4 2x6")
bricks.ALLOWED[("b", TAN)] = bricks._sizes("1x1 1x2 1x3 1x4 1x6 1x8 2x2 2x4")
bricks.ALLOWED[("t", TAN)] = bricks._sizes("1x1 1x2 1x4 1x6 2x2")
bricks.ALLOWED[("t", DTAN)] = bricks._sizes("1x1 1x2 2x2")

PROJECT = compact_project(
    slug="animal_kingdom_lodge",
    title="Animal Kingdom Lodge",
    resort="Disney's Animal Kingdom Lodge",
    category="Deluxe",
    merged=["Jambo House", "Kidani Village (Disney's Animal Kingdom Villas)"],
    about=("The entrance of Jambo House at Animal Kingdom Lodge: a tall, steep, thatched "
           "kraal-style roof over the lobby and its porch of dark timber posts, warm earthy "
           "walls with timber floor beams, the guest wings curving back on both sides under "
           "steep thatched roofs of their own, and an acacia tree out front."),
    features=["The tall, steep thatched kraal-style roof over the Jambo House lobby",
              "Dark timber: the porch posts and the floor beams",
              "Warm earthy walls on a dark tan base",
              "The guest wings curving away on both sides, suggested by stepped blocks "
              "with steep thatched roofs",
              "An acacia tree with its flat-topped canopy"],
    omitted=["The full horseshoe of guest wings and Kidani Village",
             "The savanna and its animals, the pools and the lobby interior",
             "The carved details, shields and lanterns"],
    colour_rows=[("Medium Nougat", "Medium Nougat", "Medium Nougat"),
                 ("Tan", "Brick Yellow", "Tan"),
                 ("Dark Tan", "Sand Yellow", "Dark Tan"),
                 ("Reddish Brown", "Reddish Brown", "Reddish Brown"),
                 ("Black", "Black", "Black"), ("Green", "Dark Green", "Green")],
    organisation=["The display base and the drive", "The Jambo House lobby",
                  "The guest wings (build 4)", "The acacia tree"],
    sub_info={
        "lobby.ldr": ("The Jambo House lobby",
                      "Timber porch posts, three storeys of earthy walls with timber beams, "
                      "and the tall thatched roof that rises in rings of steep slopes to a "
                      "timber finial."),
        "wing.ldr": ("The guest wings",
                     "Four identical three-storey blocks with a steep thatched roof each. "
                     "Two step back on each side of the lobby, like the curving wings."),
        "acacia.ldr": ("The acacia tree",
                       "A slim, crooked trunk and a wide, flat canopy of green plates and "
                       "leaves."),
    },
    legend=("acacia.ldr", 1),
    tips=["Each storey is one course of medium nougat bricks, with black bricks for the "
          "windows, then a band of reddish-brown plates: the timber floor beams.",
          "The thatched roofs go up one ring of steep slopes at a time. Hidden tan bricks "
          "inside each ring hold up the next one; they have a step of their own.",
          "A <b>&ldquo;Build 4&rdquo;</b> badge means you build that module four times."],
    build_time="about 1 to 1&frac12; hours",
)

# lobby, in its own grid: roof deck x 0..7, z 0..7; walls x 1..6, z 3..6; porch z 0..2
LOB_W, LOB_D, LOB_FLOORS = 8, 8, 3
WALLS = (1, 3, 6, 4)                     # x0, z0, w, d
LOB_POSTS = ((0, 0), (2, 0), (5, 0), (7, 0))
LOB = (8, 5)                             # lobby origin on the base
HUT_W, HUT_D, HUT_FLOORS = 4, 6, 3
HUTS = ((4, 7), (16, 7), (0, 10), (20, 10))
ACACIA = (1, 3)                          # acacia model origin
DRIVE = range(8, 16)


def storeys(m, x0, z0, w, d, floors, mat, slab=None):
    """Storeys: a brick course (WallRing) and a band of timber plates each.

    The top band is a full slab over `slab` cells (default: the footprint)."""
    ring = WallRing([(x0, z0), (x0 + w - 1, z0), (x0 + w - 1, z0 + d - 1), (x0, z0 + d - 1)])
    cells = {(x, z) for x in range(x0, x0 + w) for z in range(z0, z0 + d)}
    ring_cells = {c for c in cells if c[0] in (x0, x0 + w - 1) or c[1] in (z0, z0 + d - 1)}
    for f in range(1, floors + 1):
        L = 1 + 4 * (f - 1)

        def mat_(x, z, layer, f=f):
            c = mat(x, z, f)
            return None if c is None else ("b", c)
        ring.course(m, L, f % 2, mat_)
        m.step()
        if f < floors:
            fill_cells(m, "p", TIMBER, ring_cells, L + 3)
        else:
            fill_cells(m, "p", TIMBER, slab or cells, L + 3)
        m.step()
    return 1 + 4 * floors


def ring65(m, xa, xb, za, zb, L):
    """One ring of 65-degree slopes around the rectangle xa..xb, za..zb."""
    for x in range(xa, xb + 1):
        m.add("slope65", THATCH, x, za, L, rot=0)
        m.add("slope65", THATCH, x, zb - 1, L, rot=180)
    for z in range(za + 2, zb - 1):
        m.add("slope65", THATCH, xa, z, L, rot=90)
        m.add("slope65", THATCH, xb - 1, z, L, rot=270)


def core(m, xa, xb, za, zb, layers):
    """Hidden tan bricks that hold up the inner cells of the next ring."""
    cells = {(x, z) for x in range(xa, xb + 1) for z in range(za, zb + 1)}
    for L in layers:
        fill_cells(m, "b", THATCH, cells, L)


def thatch(m, w, d, base, flare=False):
    """A steep thatched hip roof over the deck x 0..w-1, z 0..d-1 at `base`.

    An optional eave ring of 45-degree slopes, then rings of 65-degree slopes
    stepping in a stud at a time, each held up by hidden bricks inside the ring
    below. Small slopes cover the studs left at the corners of the lower rings.
    Returns the top layer and the cells the caller closes the top with."""
    L, k, corners = base, 0, []
    if flare:
        for x in range(0, w, 2):
            m.add("s45x2", THATCH, x, 0, L, rot=0)
            m.add("s45x2", THATCH, x, d - 2, L, rot=180)
        for z in range(2, d - 2, 2):
            m.add("s45x2", THATCH, 0, z, L, rot=90)
            m.add("s45x2", THATCH, w - 2, z, L, rot=270)
        m.step()
        corners.append((0, w - 1, 1, d - 2, L + 3))
        L, k = L + 3, 1
    while w - 2 * k >= 4 and d - 2 * k >= 4:
        xa, xb, za, zb = k, w - 1 - k, k, d - 1 - k
        if L > base:
            h = 3 if (flare and k == 1) else 6
            core(m, xa + 1, xb - 1, za + 1, zb - 1, range(L - h, L, 3))
            m.step()
        ring65(m, xa, xb, za, zb, L)
        m.step()
        corners.append((xa, xb, za + 1, zb - 1, L + 6))
        L, k = L + 6, k + 1
    xa, xb, za, zb, L = corners.pop()
    # small slopes round off the studs left at the corners of the lower rings
    for x0, x1, z0, z1, layer in corners:
        for z in (z0, z1):
            m.add("cheese", THATCH, x0, z, layer, rot=90)
            m.add("cheese", THATCH, x1, z, layer, rot=270)
    m.step()
    top = {(x, z) for x in range(xa, xb + 1) for z in range(za, zb + 1)}
    top -= {(x, z) for x in (xa, xb) for z in range(za + 1, zb)}
    return L, top


def build_lobby():
    m = Model("lobby.ldr", "Jambo House lobby")
    wx0, wz0, ww, wd = WALLS
    for x in range(0, LOB_W, 2):     # strips from the porch under the walls; the back eave overhangs
        m.add("p2x6", PLINTH, x, 0, 0, rot=90)
    for x in range(0, LOB_W, 4):
        m.add("p1x4", PLINTH, x, 6, 0)
    m.step()
    m.step("Dark timber posts carry the deep eaves of the roof and the porch.")
    for px, pz in LOB_POSTS:
        for L in range(1, 4 * LOB_FLOORS - 2, 3):
            m.add("b1x1", TIMBER, px, pz, L)
        for L in range(4 * LOB_FLOORS - 2, 4 * LOB_FLOORS):
            m.add("p1x1", TIMBER, px, pz, L)
    m.step()

    def mat(x, z, f):
        if z == wz0:
            if x in (3, 4):
                return WINDOW if f > 1 else None           # the entrance, the lobby window
            if x in (1, 6):
                return WINDOW
        if z == wz0 + wd - 1 and x in (2, 5):
            return WINDOW
        return WALL
    base = storeys(m, wx0, wz0, ww, wd, LOB_FLOORS, mat,
                   slab={(x, z) for x in range(LOB_W) for z in range(LOB_D)})
    top, cells = thatch(m, LOB_W, LOB_D, base, flare=True)
    # the ridge: dark tan tiles, with a timber finial on a jumper plate in the middle
    xs = sorted({c[0] for c in cells})
    zs = sorted({c[1] for c in cells})
    cx, cz = (xs[0] + xs[-1]) // 2, zs[0]
    jumper = m.add("jumper2x2", THATCH, cx, cz, top)
    fill_cells(m, "t", RIDGE, cells - {(cx + i, cz + j) for i in (0, 1) for j in (0, 1)}, top)
    m.step()
    m.add_raw("cone1", TIMBER, (20 * cx + 20, -8 * (top + 1) - PARTS["cone1"].bmax_y, 20 * cz + 20),
              rot_matrix(0), attach_to=jumper)
    m.step()
    m.width, m.depth = LOB_W, LOB_D
    return m


def build_wing():
    m = Model("wing.ldr", "Guest wing (build 4)")
    fill_rect(m, "p", PLINTH, 0, 0, HUT_W, HUT_D, 0)
    m.step()

    def mat(x, z, f):
        if z in (0, HUT_D - 1) and x in (1, 2):
            return WINDOW
        if x in (0, HUT_W - 1) and z in (2, 3):
            return WINDOW
        return WALL
    base = storeys(m, 0, 0, HUT_W, HUT_D, HUT_FLOORS, mat)
    top, cells = thatch(m, HUT_W, HUT_D, base)
    # the ridge: dark tan tiles; small slopes round off the corners
    ridge = {(x, z) for x in (1, 2) for z in range(1, HUT_D - 1)}
    fill_cells(m, "t", RIDGE, ridge, top)
    for x, z in sorted(cells - ridge):
        m.add("cheese", THATCH, x, z, top, rot=90 if x == 0 else 270)
    m.step()
    m.width, m.depth = HUT_W, HUT_D
    return m


def build_acacia():
    m = Model("acacia.ldr", "Acacia tree")
    for L in (0, 3, 6):
        m.add("round1", TIMBER, 1, 1, L)
    m.add("p1x2", TIMBER, 1, 1, 9)                     # the trunk leans over
    m.add("round1", TIMBER, 2, 1, 10)
    m.step()
    m.add("p2x4", LEAF, 0, 0, 13)                     # the flat, wide canopy
    m.add("p2x4", LEAF, 1, -1, 14, rot=90)
    m.add("leaves6x5", LEAF, 1, 0, 15)
    m.step()
    m.width, m.depth = 4, 2
    return m


def build_main(lobby, wing, acacia):
    m = Model("animal_kingdom_lodge_compact.ldr", "Animal Kingdom Lodge (compact)")
    m.header_notes = ["Compact resort collection; generated by design.py (lego-kit)."]
    m.section("The display base", "The base and the black band are the same for every kit in "
              "the collection. The lawn and the drive to the porch go on next.")
    band = display_base(m)
    reserved = set(band)
    reserved |= {(LOB[0] + x, LOB[1] + z) for x in range(LOB_W) for z in range(WALLS[1] + WALLS[3])}
    for hx, hz in HUTS:
        reserved |= {(hx + x, hz + z) for x in range(HUT_W) for z in range(HUT_D)}
    reserved.add((ACACIA[0] + 1, ACACIA[1] + 1))
    finish_ground(m, reserved, GREEN,
                  colour_at=lambda x, z: TAN if x in DRIVE and z < LOB[1] else GREEN)
    m.step()
    m.sub(lobby, *LOB, 1)
    m.step()
    for hx, hz in HUTS:
        m.sub(wing, hx, hz, 1)
    m.step()
    m.sub(acacia, *ACACIA, 1)
    m.step()
    return m


def build():
    lobby, wing, acacia = build_lobby(), build_wing(), build_acacia()
    main_m = build_main(lobby, wing, acacia)
    return main_m, [main_m, lobby, wing, acacia]
