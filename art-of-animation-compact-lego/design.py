"""Art of Animation Resort, compact display kit (resort collection).

Build with the shared kit:  ./build.sh

The compact format (lego-kit/compact.py): a 24 x 16 base with a black front
band; one storey = 4 plates (a course of bricks and a plate band), 1 stud is about 2 m.

The real resort's guest areas are themed on animated films. This kit leaves all
of that out on purpose: no characters, no character vehicles or buildings, no
logos or lettering. It shows Animation Hall, the lobby building, and generic
animation icons only.

Grid (studs): x to the right, z toward the back; the front band is z = 0..1.
  Animation Hall  x  4..19, z 9..14    three storeys, a taller glass atrium in the middle
                                       (x 9..14) under a barrel roof
  entrance canopy x  9..14, z 6..8     a flat white canopy on two columns (part of the hall
                                       model, whose paved plinth reaches to z = 6)
  drive           x  9..14, z 2..5
  giant pencil    x  1..2,  z 3..4     yellow, with a pink eraser and a tan and black tip
  paint pots      x 19..22, z 2..5     three pots on one pad
  palm            (21, 6), behind the paint pots
"""
from contextlib import contextmanager

import bricks
from bricks import Model, PARTS, FACE, WHITE, BLACK, LBG, RED, GREEN, TAN, TCLEAR, PINK, \
    fill_rect, fill_cells, place_rect, rot_matrix
from walls import WallRing
from compact import compact_project, display_base, finish_ground, palm

YELLOW, BLUE, LIME = 14, 1, 27
bricks.COLOR_NAMES.setdefault(YELLOW, "Yellow")

WALL, GLASS, ROOF = WHITE, TCLEAR, LBG
PANELS = {"Y": YELLOW, "R": RED, "B": BLUE, "L": LIME}
PENCIL, ERASER, FERRULE, WOOD, LEAD = YELLOW, PINK, LBG, TAN, BLACK
CAN, PAD = LBG, LBG

_SIZES = {("b", YELLOW): "1x1 1x2 1x3 1x4 1x6 2x2 2x3 2x4",
          ("b", BLUE): "1x1 1x2 1x3 1x4 1x6 1x8 2x2 2x4",
          ("b", LIME): "1x1 1x2 1x4 2x2 2x4",
          ("t", YELLOW): "1x1 1x2 1x3 1x4 1x6 1x8 2x2 2x4"}


@contextmanager
def kit_sizes():
    """Pick a Brick Bestseller sizes for colours the shared size table doesn't list
    (checked with avail.py), set only while this kit builds."""
    saved = {k: bricks.ALLOWED.get(k) for k in _SIZES}
    bricks.ALLOWED.update({k: bricks._sizes(v) for k, v in _SIZES.items()})
    try:
        yield
    finally:
        for k, v in saved.items():
            if v is None:
                bricks.ALLOWED.pop(k, None)
            else:
                bricks.ALLOWED[k] = v


PROJECT = compact_project(
    slug="art_of_animation",
    title="Art of Animation Resort",
    resort="Disney's Art of Animation Resort",
    category="Value",
    about=("Animation Hall, the resort's lobby building: a modern white hall with a grid of big "
           "coloured window panels, a taller glass atrium under a white barrel roof over the "
           "entrance, and a flat white canopy in front. Out front stand two "
           "generic animation icons: a giant pencil and three pots of paint. The resort's "
           "character areas, its guest buildings themed on animated films, are left out on "
           "purpose: no characters, character vehicles or character buildings appear, so this "
           "kit is less recognisable than the others in the collection."),
    features=["Animation Hall: a modern white lobby building with big coloured window panels",
              "A taller glass atrium with a white barrel roof over the entrance",
              "The flat white entrance canopy on two columns",
              "A giant yellow pencil with a pink eraser and a sharpened tan and black tip",
              "Three giant pots of paint in red, yellow and lime"],
    omitted=["The resort's character areas, left out on purpose: all film characters, "
             "character vehicles and character-themed buildings and icons. This kit is less "
             "recognisable than the others as a result",
             "The guest-room buildings, the pools and the courtyards",
             "Lettering and logos on Animation Hall, and the Skyliner station"],
    colour_rows=[("White", "White", "White"), ("Yellow", "Bright Yellow", "Yellow"),
                 ("Red", "Bright Red", "Red"), ("Blue", "Bright Blue", "Blue"),
                 ("Lime", "Bright Yellowish Green", "Lime"),
                 ("Bright Pink", "Light Purple", "Bright Pink"),
                 ("Tan", "Brick Yellow", "Tan"), ("Trans-Clear", "Transparent", "Trans-Clear"),
                 ("Black", "Black", "Black"),
                 ("Light Bluish Gray", "Medium Stone Grey", "Light Bluish Gray"),
                 ("Green", "Dark Green", "Green"),
                 ("Reddish Brown", "Reddish Brown", "Reddish Brown")],
    organisation=["The display base and the lawn", "Animation Hall", "The giant pencil",
                  "The paint pots", "The palm"],
    sub_info={
        "hall.ldr": ("Animation Hall",
                     "Three storeys of white walls with big coloured window panels and glass, "
                     "the entrance canopy, and a fourth storey of glass in the middle under a "
                     "barrel roof of curved slopes."),
        "pencil.ldr": ("The giant pencil",
                       "It stands on its pink eraser. The tip's round brick and cone sit on the "
                       "single stud in the middle of the tan plate."),
        "paint.ldr": ("The paint pots",
                      "Three grey pots of stacked round plates on one pad, each topped with "
                      "four quarter-round tiles of paint."),
        "palm.ldr": ("The palm", "A trunk of round bricks and two layers of fronds."),
    },
    legend=("pencil.ldr", 2),
    tips=["The window panels are 1&times;2 bricks in four colours. Lay out each storey's colours "
          "before you start it.",
          "The glass is 1&times;2 clear bricks without a centre tube. Press them on gently.",
          "The pencil's tip stands half a stud off the grid, on the centre stud of the tan "
          "plate."],
    build_time="about 1 to 1&frac12; hours",
    clear_alpha=48,
)

HW, HD = 16, 9                        # hall model: canopy zone z = 0..2, building z = 3..8
HX, HZ = 4, 6
FZ = 3                                # the front wall's row in the hall model
CAN0, CAN1 = 5, 10                    # canopy and atrium, x 5..10
PENCIL_AT = (1, 3)
PAINT_AT = (19, 2)
PALMS = ((21, 6),)                    # its fronds clear the hall and stay over the base

# walls per storey: W white, G glass (backed with black inside), K black window, or a
# panel colour (Y, R, B, L)
FACADE = {1: "WYYWWGGGGGGWWBBW",
          2: "WRRWYYWGGWBBWLLW",
          3: "WLLWBBWGGWYYWRRW",
          4: "WGGGGW"}                # the atrium storey, x 5..10
BACK = {1: "WWKKWWWKKWWWWKKW", 2: "WWKKWWWKKWWWWKKW", 3: "WWKKWWWKKWWWWKKW", 4: "WKKKKW"}
SIDE = {1: "WKKW", 2: "WRRW", 3: "WYYW", 4: "WWWW"}    # z 4..7 on both ends
PLINTH_SIZES = {4: [8, 6, 4], 2: [8, 6, 4, 2], 1: [8, 6, 4, 2, 1]}


def wall_storey(m, ring, x0, f, L, front, back, side, z0, z1):
    """One storey's brick course. Glass goes in after as clear 1x2 bricks, with black
    bricks right behind it so the windows read dark."""
    def code(x, z):
        if z == z0:
            return front[x - x0]
        if z == z1:
            return back[x - x0]
        return side[z - z0 - 1]

    def mat(x, z, layer):
        c = code(x, z)
        if c == "G":
            return None
        return ("b", dict(PANELS, W=WALL, K=BLACK)[c])
    ring.course(m, L, f % 2, mat)
    glass = [x for x in range(x0, x0 + len(front)) if front[x - x0] == "G"]
    for x in glass[::2]:
        m.add("b1x2_open", GLASS, x, z0, L)
        m.add("b1x2", BLACK, x, z0 + 1, L)


def build_hall():
    m = Model("hall.ldr", "Animation Hall")
    fill_rect(m, "p", LBG, 0, 0, HW, HD, 0, along="x", sizes=PLINTH_SIZES)
    m.step()
    z0, z1 = FZ, HD - 1
    ring = WallRing([(0, z0), (HW - 1, z0), (HW - 1, z1), (0, z1)])
    ring_cells = set(ring.cells())
    canopy = {(x, z) for x in range(CAN0, CAN1 + 1) for z in range(0, FZ + 1)}
    for f in (1, 2, 3):
        L = 1 + 4 * (f - 1)
        wall_storey(m, ring, 0, f, L, FACADE[f], BACK[f], SIDE[f], z0, z1)
        if f == 1:                    # the canopy's two columns
            for x in (CAN0, CAN1):
                m.add("round1", WALL, x, 0, L)
        m.step()
        # the band reaches in behind the next storey's glass to hold its black backing
        backing = {(x, z0 + 1) for x in range(HW) if f < 3 and FACADE[f + 1][x] == "G"}
        if f == 1:
            fill_cells(m, "p", WALL, (ring_cells | backing) - canopy, L + 3)
            place_rect(m, "p", WALL, CAN0, 0, CAN1 - CAN0 + 1, FZ + 1, L + 3)
            m.step()
            for z in range(FZ):
                m.add("t1x6", WALL, CAN0, z, L + 4)
        elif f == 2:
            fill_cells(m, "p", WALL, ring_cells | backing, L + 3)
        else:
            fill_rect(m, "p", WALL, 0, z0, HW, z1 - z0 + 1, L + 3, along="x")
        m.step()
    # the atrium storey over the entrance
    L = 1 + 4 * 3
    atrium = WallRing([(CAN0, z0), (CAN1, z0), (CAN1, z1), (CAN0, z1)])
    wall_storey(m, atrium, CAN0, 4, L, FACADE[4], BACK[4], SIDE[4], z0, z1)
    # flat roofs of the lower wings: white edges, grey inside
    wings = {(x, z) for x in range(HW) for z in range(z0, z1 + 1) if x < CAN0 or x > CAN1}
    edge = {(x, z) for (x, z) in wings if x in (0, HW - 1) or z in (z0, z1)}
    fill_cells(m, "t", WALL, edge, L)
    fill_cells(m, "t", ROOF, wings - edge, L)
    m.step()
    fill_rect(m, "p", WALL, CAN0, z0, CAN1 - CAN0 + 1, z1 - z0 + 1, L + 3, along="x")
    m.step()
    # a barrel roof: curved slopes facing the front and the back, meeting at the ridge
    for x in range(CAN0, CAN1 + 1):
        m.add("curve3", WALL, x, z0, L + 4, rot=FACE["front"])
        m.add("curve3", WALL, x, z0 + 3, L + 4, rot=FACE["back"])
    m.step()
    m.width, m.depth = HW, HD
    return m


def build_pencil():
    m = Model("pencil.ldr", "Giant pencil")
    m.add("p2x2", PAD, 0, 0, 0)
    m.step()
    m.add("b2x2", ERASER, 0, 0, 1)
    m.add("p2x2", FERRULE, 0, 0, 4)
    m.add("p2x2", FERRULE, 0, 0, 5)
    m.step()
    for k in range(5):
        m.add("b2x2", PENCIL, 0, 0, 6 + 3 * k)
    m.step()
    top = 6 + 3 * 5
    jumper = m.add("jumper2x2", WOOD, 0, 0, top)
    # the sharpened tip stands on the plate's centre stud, half a stud off the grid
    c, layer, prev = 20, top + 1, jumper
    for key, col in (("round1", WOOD), ("cone1", LEAD)):
        y = -8 * layer - PARTS[key].bmax_y
        prev = m.add_raw(key, col, (c, y, c), rot_matrix(0), attach_to=prev)
        layer += PARTS[key].height
    m.step()
    m.width, m.depth = 2, 2
    return m


def build_paint():
    m = Model("paint.ldr", "Paint pots")
    fill_rect(m, "p", PAD, 0, 0, 4, 4, 0)
    m.step()
    pots = (((0, 0), 6, RED), ((2, 1), 4, YELLOW), ((0, 2), 4, LIME))   # (corner, plates, paint)
    for (x, z), h, col in pots:               # one pot per step
        for k in range(h):
            m.add("round_p2", CAN, x, z, 1 + k)
        for dx, dz, r in ((0, 0, 90), (1, 0, 0), (0, 1, 180), (1, 1, 270)):
            m.add("tile_quarter", col, x + dx, z + dz, 1 + h, rot=r)
        m.step()
    m.width, m.depth = 4, 4
    return m


def build_main(hall, pencil, paint, tree):
    m = Model("art_of_animation_compact.ldr", "Art of Animation Resort (compact)")
    m.header_notes = ["Compact resort collection; generated by design.py (lego-kit)."]
    m.section("The display base", "The base and the black band are the same for every kit in "
              "the collection. The lawn and the drive to the entrance go on next.")
    band = display_base(m)
    reserved = set(band)
    reserved |= {(HX + x, HZ + z) for x in range(HW) for z in range(HD)}
    reserved |= {(PENCIL_AT[0] + x, PENCIL_AT[1] + z) for x in range(2) for z in range(2)}
    reserved |= {(PAINT_AT[0] + x, PAINT_AT[1] + z) for x in range(4) for z in range(4)}
    reserved |= set(PALMS)

    def ground(x, z):
        if HX + CAN0 <= x <= HX + CAN1 and z < HZ:      # the drive to the canopy
            return LBG
        return GREEN
    finish_ground(m, reserved, GREEN, colour_at=ground)
    m.step()
    m.sub(hall, HX, HZ, 1)
    m.step()
    m.sub(pencil, *PENCIL_AT, 1)
    m.step()
    m.sub(paint, *PAINT_AT, 1)
    m.step()
    for px, pz in PALMS:
        m.sub(tree, px, pz, 1)
    m.step()
    return m


def build():
    with kit_sizes():
        hall, pencil, paint, tree = build_hall(), build_pencil(), build_paint(), palm()
        main_m = build_main(hall, pencil, paint, tree)
    return main_m, [main_m, hall, pencil, paint, tree]
