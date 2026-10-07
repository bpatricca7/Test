"""Pop Century Resort, compact display kit (resort collection).

Build with the shared kit:  ./build.sh

The compact format (lego-kit/compact.py): a 24 x 16 base with a black front
band; one storey = 4 plates (a course of bricks and a plate band), 1 stud is about 2 m.

Grid (studs): x to the right, z toward the back; the front band is z = 0..1.
  guest building  x  5..18, z 10..14   four storeys; z = 10 is the open walkway
  stair towers    x  1..4 and 19..22, z 9..12   (one model, built twice)
  yo-yo           x  3..6,  z 3..8     a giant yo-yo standing on its edge, discs facing
                                       left and right with the white hub in the groove
  bowling pins    x 16..17, z 4..5 and x 19..20, z 5..6   (one model, built twice)
  walk            x 11..12, z 2..8, and the sidewalk z = 9 in front of the building

Only generic decade icons: no toys of a particular brand, no characters, no
lettering.
"""
from contextlib import contextmanager

import bricks
from bricks import Model, PARTS, FACE, WHITE, BLACK, LBG, RED, GREEN, fill_rect, fill_cells, \
    rot_matrix, row
from walls import WallRing
from compact import compact_project, display_base, finish_ground

YELLOW, AZURE = 14, 322
bricks.COLOR_NAMES.setdefault(YELLOW, "Yellow")

WALL, WINDOW, RAIL, TOWER, ACCENT = WHITE, BLACK, AZURE, AZURE, YELLOW
PIN, BAND = WHITE, RED
YOYO, HUB = RED, WHITE
PAD = LBG

# Pick a Brick Bestseller sizes for the colours the shared size table doesn't
# list (checked with avail.py). Set only while this kit builds.
_SIZES = {("b", AZURE): "1x1 1x2 1x4 2x2 2x4", ("p", AZURE): "1x2 2x4",
          ("t", AZURE): "1x1 1x2 1x4 2x2",
          ("b", YELLOW): "1x1 1x2 1x3 1x4 1x6 2x2 2x3 2x4",
          ("p", YELLOW): "1x1 1x2 1x3 1x4 1x6 2x2 2x3 2x4 2x6 2x8",
          ("t", YELLOW): "1x1 1x2 1x3 1x4 1x6 1x8 2x2 2x4"}


@contextmanager
def kit_sizes():
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
    slug="pop_century",
    title="Pop Century Resort",
    resort="Disney's Pop Century Resort",
    category="Value",
    about=("A short section of a Pop Century guest building: four storeys of white rooms with "
           "the open walkways and turquoise railings along the front, and a bright stair tower "
           "at each end. On the lawn in front stand the giant decade icons: two bowling pins, "
           "white with a red band, and a yo-yo standing on its edge."),
    features=["Four-storey white guest building with open walkways and turquoise railings",
              "Two turquoise stair towers with yellow landings and sign boards",
              "Two giant bowling pins, white with a red band",
              "A giant red yo-yo standing on its edge, with the white hub in its groove"],
    omitted=["The long guest wings, the other decades' buildings and their icons",
             "The decade names and signs, and any brand-name toys or characters",
             "Classic Hall, the pools and the Skyliner station"],
    colour_rows=[("White", "White", "White"), ("Medium Azure", "Medium Azur", "Medium Azure"),
                 ("Yellow", "Bright Yellow", "Yellow"), ("Red", "Bright Red", "Red"),
                 ("Black", "Black", "Black"),
                 ("Light Bluish Gray", "Medium Stone Grey", "Light Bluish Gray"),
                 ("Green", "Dark Green", "Green")],
    organisation=["The display base and the lawn", "The guest building",
                  "The stair towers (build 2)", "The giant yo-yo", "The bowling pins (build 2)"],
    sub_info={
        "guest.ldr": ("The guest building",
                      "Four storeys of rooms. The front row of each storey is the open walkway: "
                      "a band of plates on the wall below, and a turquoise railing on top."),
        "tower.ldr": ("The stair towers",
                      "Two identical turquoise towers with yellow landings, one for each end of "
                      "the building."),
        "yoyo.ldr": ("The giant yo-yo",
                     "Two red discs on a white hub, standing on their edge. The rounded corners "
                     "are slopes: upside-down ones at the bottom, ordinary ones at the top."),
        "pin.ldr": ("The bowling pins",
                    "Round plates for the body, a dish for the shoulders, then a cone, the red "
                    "band and the head on the dish's centre stud."),
    },
    legend=("pin.ldr", 2),
    tips=["The walkways have no posts: each band of plates is held by the wall behind it and "
          "reaches out one stud over the walkway.",
          "The bowling pins' necks sit on the single stud in the middle of the dish.",
          "A <b>&ldquo;Build 2&rdquo;</b> badge means you build that module twice."],
    build_time="about 1 to 1&frac12; hours",
)

GW, GD, FLOORS = 14, 5, 4             # guest building: walkway row z = 0, rooms z = 1..4
GX, GZ = 5, 10
TW, TD, T_STOREYS = 4, 4, 5           # stair tower
TOWERS = ((1, 9), (19, 9))
YX, YW, YD = (3, 3), 4, 6             # yo-yo corner, width, depth
PINS = ((16, 4), (19, 5))              # bowling pins (2 x 2, build 2)
WALK = (11, 12)
SIDEWALK_Z = 9

PLINTH_SIZES = {4: [8, 6, 4], 2: [8, 6, 4, 2], 1: [8, 6, 4, 2, 1]}
FRONT = "WWBBWWBBWWBBWW"              # room wall behind the walkway: doors and windows
BACK = "WBWWBWWWWBWWBW"


def build_guest():
    m = Model("guest.ldr", "Guest building")
    fill_rect(m, "p", LBG, 0, 0, GW, GD, 0, along="x", sizes=PLINTH_SIZES)
    m.step()
    ring = WallRing([(0, 1), (GW - 1, 1), (GW - 1, GD - 1), (0, GD - 1)])
    ring_cells = {(x, z) for x in range(GW) for z in range(1, GD)
                  if x in (0, GW - 1) or z in (1, GD - 1)}

    def mat(x, z, layer):
        if z == 1:
            return ("b", WINDOW if FRONT[x] == "B" else WALL)
        if z == GD - 1:
            return ("b", WINDOW if BACK[x] == "B" else WALL)
        return ("b", WALL)

    for f in range(1, FLOORS + 1):
        L = 1 + 4 * (f - 1)
        ring.course(m, L, f % 2, mat)
        if f > 1:                     # the walkway railing, on the band below
            row(m, "t", RAIL, 0, 0, GW, L)
        m.step()
        if f < FLOORS:
            slab = {(x, z) for x in range(GW) for z in (0, 1)}
            fill_cells(m, "p", WALL, ring_cells | slab, L + 3)
        else:
            fill_rect(m, "p", WALL, 0, 0, GW, GD, L + 3, along="x")
        m.step()
    # flat roof: a white parapet around a grey roof
    top = 1 + 4 * FLOORS
    edge = {(x, z) for x in range(GW) for z in range(GD) if x in (0, GW - 1) or z in (0, GD - 1)}
    fill_cells(m, "p", WALL, edge, top)
    inner = {(x, z) for x in range(1, GW - 1) for z in range(1, GD - 1)}
    fill_cells(m, "t", LBG, inner, top)
    m.step()
    fill_cells(m, "t", WALL, edge, top + 1)
    m.step()
    m.width, m.depth = GW, GD
    return m


def tower_course(m, L, k, colour, open_front=False):
    """One brick course of the 4 x 4 tower ring, with 1x4 and 1x2 bricks."""
    if k % 2 == 0 and not open_front:
        m.add("b1x4", colour, 0, 0, L)
        m.add("b1x4", colour, 0, 3, L)
        m.add("b1x2", colour, 0, 1, L, rot=90)
        m.add("b1x2", colour, 3, 1, L, rot=90)
    else:                             # also every open storey: the bands tie the courses
        m.add("b1x4", colour, 0, 0, L, rot=90)
        m.add("b1x4", colour, 3, 0, L, rot=90)
        if not open_front:
            m.add("b1x2", colour, 1, 0, L)
        m.add("b1x2", colour, 1, 3, L)


def build_tower():
    m = Model("tower.ldr", "Stair tower (build 2)")
    fill_rect(m, "p", LBG, 0, 0, TW, TD, 0)
    m.step()
    for s in range(T_STOREYS):
        L = 1 + 4 * s
        is_open = 0 < s < T_STOREYS - 1
        if is_open:                           # tiles on the landing in the opening
            m.add("t2x2", ACCENT, 1, 0, L)
        tower_course(m, L, s, TOWER, open_front=is_open)
        m.step()
        fill_rect(m, "p", ACCENT, 0, 0, TW, TD, L + 3)
        m.step()
    L = 1 + 4 * T_STOREYS
    tower_course(m, L, T_STOREYS, ACCENT)
    m.step()
    fill_rect(m, "t", TOWER, 0, 0, TW, TD, L + 3)
    m.step()
    m.width, m.depth = TW, TD
    return m


def build_yoyo():
    """Two discs (x = 0 and 3) on a white hub, standing on edge."""
    m = Model("yoyo.ldr", "Giant yo-yo")
    fill_rect(m, "p", PAD, 0, 0, YW, YD, 0, along="z")
    m.step()
    for r in range(5):
        L = 1 + 3 * r
        for x in (0, YW - 1):
            if r == 0:
                m.add("slope45inv", YOYO, x, 0, L, rot=FACE["front"])
                m.add("slope45inv", YOYO, x, 4, L, rot=FACE["back"])
                m.add("b1x2", YOYO, x, 2, L, rot=90)
            elif r == 4:
                m.add("slope45", YOYO, x, 0, L, rot=FACE["front"])
                m.add("slope45", YOYO, x, 4, L, rot=FACE["back"])
                m.add("b1x2", YOYO, x, 2, L, rot=90)
            elif r == 2:                      # the white centre cap on each face
                m.add("b1x2", YOYO, x, 0, L, rot=90)
                m.add("b1x2", HUB, x, 2, L, rot=90)
                m.add("b1x2", YOYO, x, 4, L, rot=90)
            else:
                m.add("b1x6", YOYO, x, 0, L, rot=90)
        if r == 0:                            # the hub fills the groove inside the rim
            m.add("b2x2", HUB, 1, 2, L)
        elif r < 4:
            m.add("b2x4", HUB, 1, 1, L, rot=90)
        m.step()
    top = 1 + 3 * 5
    for x in (0, YW - 1):
        m.add("t1x4", YOYO, x, 1, top, rot=90)
    m.add("t2x4", HUB, 1, 1, top - 3, rot=90)
    m.step()
    m.width, m.depth = YW, YD
    return m


def build_pin():
    m = Model("pin.ldr", "Giant bowling pin (build 2)")
    m.add("p2x2", PAD, 0, 0, 0)
    m.step()
    for k in range(6):                        # the body: a stack of round plates
        m.add("round_p2", PIN, 0, 0, 1 + k)
    m.step()
    dish = m.add("dish2", PIN, 0, 0, 7)       # the shoulders
    m.step()
    # a cone narrows to the neck; the band and the head stand on the dish's centre
    # stud, half a stud off the grid
    c = 20
    layer = 8
    prev = dish
    for key, col in (("cone1", PIN), ("round_p1", BAND), ("round_p1", PIN),
                     ("round_p1", BAND), ("round1", PIN), ("tile_round1", PIN)):
        if key == "round1":
            m.step()                          # the head in a step of its own
        y = -8 * layer - PARTS[key].bmax_y
        prev = m.add_raw(key, col, (c, y, c), rot_matrix(0), attach_to=prev)
        layer += PARTS[key].height
    m.step()
    m.width, m.depth = 2, 2
    return m


def build_main(guest, tower, yoyo, pin):
    m = Model("pop_century_compact.ldr", "Pop Century Resort (compact)")
    m.header_notes = ["Compact resort collection; generated by design.py (lego-kit)."]
    m.section("The display base", "The base and the black band are the same for every kit in "
              "the collection. The lawn, the walk and the pads for the icons go on next.")
    band = display_base(m)
    reserved = set(band)
    reserved |= {(GX + x, GZ + z) for x in range(GW) for z in range(GD)}
    for tx, tz in TOWERS:
        reserved |= {(tx + x, tz + z) for x in range(TW) for z in range(TD)}
    reserved |= {(YX[0] + x, YX[1] + z) for x in range(YW) for z in range(YD)}
    for px, pz in PINS:
        reserved |= {(px + x, pz + z) for x in range(2) for z in range(2)}

    def ground(x, z):
        if x in WALK and z < GZ:
            return LBG
        if z == SIDEWALK_Z and GX <= x < GX + GW:
            return LBG
        return GREEN
    finish_ground(m, reserved, GREEN, colour_at=ground)
    m.step()
    m.sub(guest, GX, GZ, 1)
    m.step()
    for tx, tz in TOWERS:
        m.sub(tower, tx, tz, 1)
    m.step()
    m.sub(yoyo, YX[0], YX[1], 1)
    m.step()
    for px, pz in PINS:
        m.sub(pin, px, pz, 1)
    m.step()
    return m


def build():
    with kit_sizes():
        guest, tower, yoyo, pin = build_guest(), build_tower(), build_yoyo(), build_pin()
        main_m = build_main(guest, tower, yoyo, pin)
    return main_m, [main_m, guest, tower, yoyo, pin]
