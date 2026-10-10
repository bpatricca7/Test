"""Riviera Resort, mid-size display kit (resort collection).

Build with the shared kit:  ./build.sh

The mid-size format (lego-kit/compact.py, size="midsize"): a 32 x 24 base with a
black front band; one storey = 4 plates (a course of bricks and a plate band),
1 stud is about 2 m, the same scale as the compact kit and the large build. It
follows the layout of the large build (riviera-lego) on a smaller base, with
fewer storeys, narrower wings and a shorter porte-cochere: a symmetric white
entrance front facing the band, with black window grids, a grey mansard
centre, two domed towers, two lower guest wings with red awnings and flat grey
roofs, and the arched porte-cochere over the drive.

Grid (studs): x to the right, z toward the back; the front band is z = 0..1.
The model is mirror-symmetric about x = 15.5.
  central pavilion  x 12..19, z 16..19   four storeys, grey mansard with two oval
                                         dormers and the white centre dormer
  domed towers      x  6..11 and 20..25, z 15..20   six storeys, square grey dome
                                         and a white lantern (build 2)
  guest wings       x  1..5 and 26..30, z 17..20   three storeys, red awnings on the
                                         top floor, flat grey roof (build 2)
  porte-cochere     x 10..21, z 10..14   three arches front and back, grey mansard
                                         with three round dormers
  drive             z 11..13 across the base, tan walks at z = 10 and 14
  garden            x 11..20, z 4..9     clipped hedges round a bed of red flowers
  palms             (3, 8), (8, 8), (23, 8), (28, 8), along the drive
"""
from bricks import (Model, PARTS, FACE, rot_matrix, row, fill_rect, fill_cells,
                    WHITE, BLACK, DBG, LBG, RED, GREEN, DKGREEN, TAN, RBROWN)
from walls import WallRing
from compact import compact_project, display_base, finish_ground

SIZE = "midsize"
WALL, WINDOW, ROOF, FLAT, AWNING, PLINTH = WHITE, BLACK, DBG, LBG, RED, LBG
DRIVE, WALK, HEDGE, FLOWER = LBG, TAN, DKGREEN, RED
HEDGE_SIZES = [4, 3, 2]              # dark green 1 x N plates that are Bestsellers

PROJECT = compact_project(
    size=SIZE,
    slug="riviera",
    title="Riviera Resort",
    resort="Disney's Riviera Resort",
    category="Deluxe Villas (DVC)",
    merged=[],
    about=("The entrance front of the Riviera, laid out like the large Riviera build on a "
           "smaller base: a symmetric white European facade with black window grids, the "
           "central pavilion under a steep grey mansard with oval dormers and a white centre "
           "dormer, two taller corner towers with square grey domes and white lanterns, and "
           "two lower guest wings with red awnings and flat grey roofs. In front, the arched "
           "porte-cochere with its own mansard and round dormers stands over the drive, "
           "behind a garden of clipped hedges and red flowers, with palms along the drive."),
    features=["A symmetric white entrance front with black window grids: the central "
              "pavilion between two towers and two wings, as in the large build",
              "The central pavilion's steep grey mansard with two oval dormers and the white "
              "centre dormer, over red awnings",
              "Two domed corner towers, six storeys tall, with square grey domes and white "
              "lanterns: the tallest point of the model",
              "Two lower guest wings with red awnings over the top-floor windows and flat grey "
              "roofs",
              "The porte-cochere over the drive: three white arches front and back and a grey "
              "mansard with three round dormers",
              "A formal garden of clipped hedges and red flowers, and four palms along the "
              "drive"],
    omitted=["Storeys: three to six here, against eight to ten in the large build",
             "Most of the length of the guest wings, and the outer guest buildings",
             "The flags, the Skyliner station, the terraces and the pools"],
    colour_rows=[("White", "White", "White"), ("Black", "Black", "Black"),
                 ("Dark Bluish Gray", "Dark Stone Grey", "Dark Bluish Gray"),
                 ("Light Bluish Gray", "Medium Stone Grey", "Light Bluish Gray"),
                 ("Red", "Bright Red", "Red"), ("Tan", "Brick Yellow", "Tan"),
                 ("Green", "Dark Green", "Green"), ("Dark Green", "Earth Green", "Dark Green"),
                 ("Reddish Brown", "Reddish Brown", "Reddish Brown")],
    organisation=["The display base, the drive and the lawns", "The central pavilion",
                  "The domed towers (build 2)", "The guest wings (build 2)",
                  "The porte-cochere", "The garden and the palms"],
    sub_info={
        "central.ldr": ("The central pavilion",
                        "Four storeys of white walls and black windows with red awnings on "
                        "the top floor, under a steep grey mansard with two oval dormers and "
                        "the white centre dormer."),
        "tower.ldr": ("The domed towers",
                      "Two identical six-storey towers flank the central pavilion. Each is "
                      "topped by a square grey dome and a white lantern."),
        "wing.ldr": ("The guest wings",
                     "Two identical three-storey wings with red awnings over the top-floor "
                     "windows and a flat grey roof."),
        "porte.ldr": ("The porte-cochere",
                      "Three white arches at the front and three at the back carry a deck "
                      "and a grey mansard with three round dormers. It stands over the drive "
                      "in front of the central pavilion."),
        "palm.ldr": ("The palms", "A trunk of round bricks and two tufts of leaves."),
    },
    legend=("palm.ldr", 1),
    tips=["Each storey is one course of white bricks with black bricks for the windows, "
          "then a band of white plates. Check the window pattern against the picture before "
          "you add the band, and keep black and white parts in separate trays.",
          "The red awnings are 1&times;1 slopes set into the top band, right above the "
          "top-floor windows. Point them outward.",
          "The mansards and the domes are rings of steep grey slopes. The oval dormers are "
          "white bricks with a hole, stacked between them.",
          "A <b>&ldquo;Build 2&rdquo;</b> badge means you build that module twice. Build "
          "both at the same time, one step at a time."],
    build_time="about 2&frac12; to 3 hours",
)


WING_W, WING_D, WING_FLOORS = 5, 4, 3


def storey_layer(f):
    """Bottom layer of storey f's brick course (the plinth is layer 0)."""
    return 1 + 4 * (f - 1)


def fewest(m, kind, colour, x0, z0, w, d, layer):
    """fill_rect in whichever direction needs fewer pieces."""
    best = None
    for along in ("x", "z"):
        t = Model("tmp.ldr", "tmp")
        try:
            fill_rect(t, kind, colour, x0, z0, w, d, layer, along=along)
        except (ValueError, KeyError):
            continue
        if best is None or len(t.items) < best[0]:
            best = (len(t.items), along)
    fill_rect(m, kind, colour, x0, z0, w, d, layer, along=best[1])


def pavilion(m, W, D, floors, front, side, back, awnings=None):
    """Plinth, storeys of white walls with black windows and white plate bands.

    ``front`` and ``back`` give a character per cell along x, ``side`` per cell
    along z ('P' wall, 'W' or 'D' window); each can also be a function of the
    floor that returns the string. ``awnings`` maps ring cells to the face whose
    red awning sits over the top-floor window, in a two-plate white attic. The
    top band is a full slab. Returns the layer on top of it.
    """
    fewest(m, "p", PLINTH, 0, 0, W, D, 0)
    m.step()
    ring = WallRing([(0, 0), (W - 1, 0), (W - 1, D - 1), (0, D - 1)])
    cells = {(x, z) for x in range(W) for z in range(D) if x in (0, W - 1) or z in (0, D - 1)}
    pat = lambda p, f: p(f) if callable(p) else p

    def mat(x, z, layer):
        f = (layer - 1) // 4 + 1
        c = (pat(front, f)[x] if z == 0 else pat(back, f)[x] if z == D - 1
             else pat(side, f)[z])
        return ("b", WINDOW if c in "WD" else WALL)
    for f in range(1, floors + 1):
        L = storey_layer(f)
        ring.course(m, L, f % 2, mat)
        m.step()
        if f < floors:
            fill_cells(m, "p", WALL, cells, L + 3)
            m.step()
    L = storey_layer(floors) + 3
    if awnings:
        m.step("The red awnings go right above the top-floor windows, pointing outward.")
        for (x, z), face in sorted(awnings.items()):
            m.add("cheese", AWNING, x, z, L, rot=FACE[face])
        rest = cells - set(awnings)
        fill_cells(m, "p", WALL, rest, L)
        m.step()
        fill_cells(m, "p", WALL, rest, L + 1)
        m.step()
        L += 2
    fewest(m, "p", WALL, 0, 0, W, D, L)
    m.step()
    return L + 1


def awnings_over(front, W, D, side=None):
    """Awning cells over every front window (and side windows if ``side``)."""
    out = {(x, 0): "front" for x, c in enumerate(front) if c in "WD"}
    if side:
        for z, c in enumerate(side):
            if c in "WD" and 0 < z < D - 1:
                out[(0, z)] = "left"
                out[(W - 1, z)] = "right"
    return out


# --------------------------------------------------------------------------
# central pavilion: four storeys and the mansard with dormers
# --------------------------------------------------------------------------
CEN_W, CEN_D, CEN_FLOORS = 8, 4, 4
CEN_FRONT = "PWPDDPWP"
CEN_SIDE = "P" * CEN_D               # hidden behind the towers
# the mansard is two rows of steep slopes (front and back) on a 4-deep block; its
# ends stand against the towers
CEN_BACK = "P" * CEN_W
CEN_ROOF = "SDSCCSDS"                # slope, oval dormer, centre dormer


def build_central():
    m = Model("central.ldr", "Central pavilion")
    W, D = CEN_W, CEN_D
    L = pavilion(m, W, D, CEN_FLOORS, CEN_FRONT, CEN_SIDE, CEN_BACK,
                 awnings_over(CEN_FRONT, W, D))
    # the mansard: 75-degree slopes three bricks tall, dormers in the front row
    m.step("Steep grey slopes along the front. The grey 1×2 bricks carry the oval dormers; "
           "the black one is the window of the white centre dormer.")
    for x, c in enumerate(CEN_ROOF):
        if c == "S":
            m.add("slope75", ROOF, x, 0, L, rot=FACE["front"])
        elif c == "D":
            m.add("b1x2", ROOF, x, 0, L, rot=90)
    cx = CEN_ROOF.index("C")
    m.add("b1x2", WINDOW, cx, 0, L)
    m.add("b1x2", ROOF, cx, 1, L)
    m.step()
    for x, c in enumerate(CEN_ROOF):
        if c == "D":
            m.add("tech1x1", WALL, x, 0, L + 3)
            m.add("b1x1", ROOF, x, 1, L + 3)
    m.add("tech1x2", WALL, cx, 0, L + 3)
    m.add("b1x2", ROOF, cx, 1, L + 3)
    m.step()
    for x, c in enumerate(CEN_ROOF):
        if c == "D":
            m.add("slope45", ROOF, x, 0, L + 6, rot=FACE["front"])
    m.add("b1x2", WALL, cx, 0, L + 6)
    m.add("b1x2", ROOF, cx, 1, L + 6)
    m.step()
    for z in range(2, D - 2):
        m.add("slope75", ROOF, 0, z, L, rot=FACE["left"])
        m.add("slope75", ROOF, W - 2, z, L, rot=FACE["right"])
    for x in range(W):
        m.add("slope75", ROOF, x, D - 2, L, rot=FACE["back"])
    m.step()
    # the flat top of the mansard and the crest of the centre dormer
    T = L + 9
    fewest(m, "p", ROOF, 1, 1, W - 2, D - 2, T)
    m.add("p1x2", WALL, cx, 0, T)
    for x, z in ((0, 1), (W - 1, 1), (0, D - 2), (W - 1, D - 2)):
        m.add("t1x1", ROOF, x, z, T)
    m.step()
    crest = {(cx, 0), (cx + 1, 0), (cx, 1), (cx + 1, 1)}
    top = {(x, z) for x in range(1, W - 1) for z in range(1, D - 1)}
    fill_cells(m, "t", ROOF, top - crest, T + 1)
    m.step("Two white curved slopes make the round top of the centre dormer.")
    m.add("curve2x1", WALL, cx, 0, T + 1, rot=FACE["front"])
    m.add("curve2x1", WALL, cx + 1, 0, T + 1, rot=FACE["front"])
    m.step()
    m.width, m.depth = W, D
    return m


# --------------------------------------------------------------------------
# domed towers: six storeys, a square grey dome and a lantern (build 2)
# --------------------------------------------------------------------------
TOW_W, TOW_D, TOW_FLOORS = 6, 6, 6
TOW_FRONT = "PWPPWP"
TOW_BACK = "P" * TOW_W


def TOW_SIDE(f):
    """Side windows: the front one shows beside the wing; the second one only
    above the wings."""
    return "PWPPWP" if f > WING_FLOORS else "PWPPPP"


def build_tower():
    m = Model("tower.ldr", "Domed tower")
    W, D = TOW_W, TOW_D
    top = pavilion(m, W, D, TOW_FLOORS, TOW_FRONT, TOW_SIDE, TOW_BACK)
    # the dome: a ring of 75-degree slopes over the whole 6 x 6 top
    m.step("The dome is a ring of steep grey slopes: six at the front, six at the back and "
           "two on each side.")
    for x in range(6):
        m.add("slope75", ROOF, x, 0, top, rot=FACE["front"])
        m.add("slope75", ROOF, x, 4, top, rot=FACE["back"])
    for z in (2, 3):
        m.add("slope75", ROOF, 0, z, top, rot=FACE["left"])
        m.add("slope75", ROOF, 4, z, top, rot=FACE["right"])
    m.step()
    m.add("p4x4", ROOF, 1, 1, top + 9)
    m.step()
    cap = m.add("dish2", ROOF, 2, 2, top + 10)
    m.step()
    # the lantern on the dish's centre stud, half a stud off the grid
    m.step("The white round brick goes on the dish's centre stud, then the grey cone.")
    cx = cz = 20 * 3
    y = -8 * (top + 10 + PARTS["dish2"].height)
    lan = m.add_raw("round1", WALL, (cx, y - PARTS["round1"].bmax_y, cz), rot_matrix(0),
                    attach_to=cap)
    m.add_raw("cone1", ROOF, (cx, y - 24 - PARTS["cone1"].bmax_y, cz), rot_matrix(0),
              attach_to=lan)
    m.step()
    m.width, m.depth = W, D
    return m


# --------------------------------------------------------------------------
# guest wings: three storeys, red awnings, a flat grey roof (build 2)
# --------------------------------------------------------------------------
WING_FRONT = "PWPWP"
WING_SIDE = "PWWP"
WING_BACK = "P" * WING_W


def build_wing():
    m = Model("wing.ldr", "Guest wing")
    W, D = WING_W, WING_D
    top = pavilion(m, W, D, WING_FLOORS, WING_FRONT, WING_SIDE, WING_BACK,
                   awnings_over(WING_FRONT, W, D, WING_SIDE))
    fewest(m, "t", FLAT, 0, 0, W, D, top)
    m.step()
    m.width, m.depth = W, D
    return m


# --------------------------------------------------------------------------
# porte-cochere: three arches front and back, a mansard with round dormers
# --------------------------------------------------------------------------
PC_W, PC_D = 12, 5
PC_ARCHES = (0, 4, 8)                # left ends of the three 1 x 4 arches
PC_ROOF = "SDDSSDDSSDDS"             # front row: slopes and round dormers


def build_porte():
    m = Model("porte.ldr", "Porte-cochere")
    W, D = PC_W, PC_D
    legs = sorted({x0 for x0 in PC_ARCHES} | {x0 + 3 for x0 in PC_ARCHES})
    for z in (0, D - 1):
        for x in legs:
            m.add("b1x1", WALL, x, z, 0)
    m.step()
    m.step("Each arch stands on two of the white bricks.")
    for z in (0, D - 1):
        for x0 in PC_ARCHES:
            m.add("arch1x4", WALL, x0, z, 3)
    m.step()
    fewest(m, "p", WALL, 0, 0, W, D, 6)
    m.step()
    # the mansard: 45-degree slopes with three round dormers at the front, and a
    # hidden row of grey bricks down the middle that holds up the roof tiles
    m.step("The round dormers are white bricks with a hole. A row of grey bricks hidden "
           "in the middle holds up the roof tiles.")
    x = 0
    while x < W:
        if PC_ROOF[x] == "D":
            m.add("tech1x2", WALL, x, 0, 7)
            m.add("b1x2", ROOF, x, 1, 7)
            x += 2
        elif x + 1 < W and PC_ROOF[x + 1] == "S":
            m.add("s45x2", ROOF, x, 0, 7, rot=FACE["front"])
            x += 2
        else:
            m.add("slope45", ROOF, x, 0, 7, rot=FACE["front"])
            x += 1
    for x in range(0, W, 2):
        m.add("s45x2", ROOF, x, D - 2, 7, rot=FACE["back"])
    for z in range(2, D - 2):
        m.add("slope45", ROOF, 0, z, 7, rot=FACE["left"])
        m.add("slope45", ROOF, W - 2, z, 7, rot=FACE["right"])
        row(m, "b", ROOF, 2, z, W - 4, 7)
    m.step()
    fewest(m, "t", ROOF, 1, 1, W - 2, D - 2, 10)
    m.step()
    m.width, m.depth = W, D
    return m


# --------------------------------------------------------------------------
# palm: as in the large build, a slim trunk and two tufts of leaves
# --------------------------------------------------------------------------
def build_palm():
    m = Model("palm.ldr", "Palm tree")
    for k in range(5):
        m.add("round1", RBROWN, 0, 0, 3 * k)
    m.step()
    m.add("leaves1", GREEN, 0, 0, 15, rot=0)
    m.add("leaves1", GREEN, 0, 0, 16, rot=180)
    m.step()
    m.width, m.depth = 1, 1
    return m


# --------------------------------------------------------------------------
# main model
# --------------------------------------------------------------------------
CX, CZ = 12, 16
TOWERS = ((6, 15), (20, 15))
WINGS = ((1, 17), (26, 17))
PX, PZ = 10, 10
DRIVE_Z = (11, 12, 13)
WALK_Z = (10, 14)
FORECOURT = {(x, 15) for x in range(CX, CX + CEN_W)}
GARDEN = (11, 4, 10, 6)              # x0, z0, width, depth of the hedged bed
FLOWERS = ((13, 6), (18, 6), (14, 8), (17, 8))
PALMS = ((3, 8), (8, 8), (23, 8), (28, 8))


def rect(x0, z0, w, d):
    return {(x, z) for x in range(x0, x0 + w) for z in range(z0, z0 + d)}


def ground_colour(x, z):
    if z in DRIVE_Z:
        return DRIVE
    if z in WALK_Z or (x, z) in FORECOURT:
        return WALK
    return GREEN


def build_main(central, tower, wing, porte, palm):
    m = Model("riviera_midsize.ldr", "Riviera Resort (mid-size)")
    m.header_notes = ["Mid-size resort collection; generated by design.py (lego-kit)."]
    m.section("The display base", "The base and the black band are the same for every "
              "mid-size kit. The drive, the walks and the lawns go on next; the drive tiles "
              "tie the base plates together.")
    band = display_base(m, SIZE)
    reserved = set(band)
    reserved |= rect(CX, CZ, CEN_W, CEN_D)
    for tx, tz in TOWERS:
        reserved |= rect(tx, tz, TOW_W, TOW_D)
    for wx, wz in WINGS:
        reserved |= rect(wx, wz, WING_W, WING_D)
    legs = {x0 for x0 in PC_ARCHES} | {x0 + 3 for x0 in PC_ARCHES}
    reserved |= {(PX + x, PZ + z) for x in legs for z in (0, PC_D - 1)}
    finish_ground(m, reserved, GREEN, colour_at=ground_colour, size=SIZE)
    m.step()
    m.sub(central, CX, CZ, 1)
    m.step()
    for tx, tz in TOWERS:
        m.sub(tower, tx, tz, 1)
    m.step()
    for wx, wz in WINGS:
        m.sub(wing, wx, wz, 1)
    m.step()
    m.sub(porte, PX, PZ, 1)
    m.step()
    m.section("The garden and the palms", "Clipped hedges and red flowers in front of the "
              "porte-cochere, and palms along the drive.")
    gx, gz, gw, gd = GARDEN
    row(m, "p", HEDGE, gx, gz, gw, 2, sizes=HEDGE_SIZES)
    for x in (gx, gx + gw - 1):
        row(m, "p", HEDGE, x, gz + 1, gd - 1, 2, axis="z", sizes=HEDGE_SIZES)
    for x, z in FLOWERS:
        m.add("round_p1", FLOWER, x, z, 2)
    m.step()
    for x, z in PALMS:
        m.sub(palm, x, z, 2)
    m.step()
    return m


def build():
    central, tower, wing = build_central(), build_tower(), build_wing()
    porte, palm = build_porte(), build_palm()
    main_m = build_main(central, tower, wing, porte, palm)
    return main_m, [main_m, central, tower, wing, porte, palm]
