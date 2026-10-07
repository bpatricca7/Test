"""Port Orleans French Quarter, compact display kit (resort collection).

Build with the shared kit:  ./build.sh

The compact format (lego-kit/compact.py): a 24 x 16 base with a black front
band; one storey = 4 plates (a course of bricks and a plate band), 1 stud is about 2 m.

A short row of New Orleans townhouses: narrow pastel facades with black
wrought-iron balconies across the upper floors, grey roofs with dormers, and
gas lamps on the sidewalk.

Grid (studs): x to the right, z toward the back; the front band is z = 0..1.
  townhouses   x 3..8 (pink, three storeys), 9..14 (yellow, four storeys),
               15..20 (blue, three storeys); walls z 8..13, balconies over z = 7
  gas lamps    (2, 4) and (21, 4)
  sidewalk     z 4..7 in front of the houses; lawns in front, at the sides and back
"""
from contextlib import contextmanager

import bricks
from bricks import (Model, WHITE, BLACK, LBG, DBG, GREEN, TCLEAR, PINK, CREAM,
                    fill_rect, fill_cells, place_rect, _sizes)
from walls import WallRing
from roofs import Roof, build_roofs
from compact import compact_project, display_base, finish_ground, storey_layer

AZURE = 322
PAVING = LBG
ROOF, IRON, TRIM, PLINTH, DOOR, SHUTTER, WINDOW = DBG, BLACK, WHITE, DBG, BLACK, WHITE, BLACK
HIDDEN = BLACK                           # bricks hidden inside the roofs

# Bestseller sizes for the pastel wall colours (checked with avail.py); used
# only while this design builds, so other kits are unaffected
EXTRA_ALLOWED = {
    ("b", PINK): _sizes("1x1 1x2 1x4 2x2 2x4"),
    ("b", AZURE): _sizes("1x1 1x2 1x4 2x2 2x4"),
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
    slug="port_orleans_french_quarter",
    title="Port Orleans French Quarter",
    resort="Disney's Port Orleans Resort - French Quarter",
    category="Moderate",
    about=("A row of three New Orleans townhouses from Port Orleans French Quarter: narrow "
           "pastel facades in pink, pale yellow and light blue, black wrought-iron balconies "
           "on the upper floors, grey roofs with dormers, and black gas lamps on the sidewalk."),
    features=["Three narrow townhouses in pink, pale yellow and light blue, the middle one a "
              "storey taller",
              "Black wrought-iron balconies with lattice railings on the upper floors",
              "Grey roofs with a dormer on each house; arched doorways on the ground floor",
              "Two black gas lamps on the sidewalk"],
    omitted=["The long rows of guest buildings and the courtyards",
             "Doubloon Lagoon pool with its sea serpent slide",
             "The Sassagoula River boat landing and the gardens"],
    colour_rows=[("Bright Pink", "Light Purple", "Bright Pink"),
                 ("Bright Light Yellow", "Cool Yellow", "Bright Light Yellow"),
                 ("Medium Azure", "Medium Azur", "Medium Azure"),
                 ("Black", "Black", "Black"), ("White", "White", "White"),
                 ("Dark Bluish Gray", "Dark Stone Grey", "Dark Bluish Gray"),
                 ("Light Bluish Gray", "Medium Stone Grey", "Light Bluish Gray"),
                 ("Green", "Dark Green", "Green"),
                 ("Trans-Clear", "Transparent", "Trans-Clear")],
    organisation=["The display base, the sidewalk and the lawns", "The pink townhouse",
                  "The yellow townhouse", "The blue townhouse", "The gas lamps (build 2)"],
    sub_info={
        "house_pink.ldr": ("The pink townhouse",
                           "Three storeys: an arched doorway, iron balconies on the two upper "
                           "floors and a grey roof with a dormer."),
        "house_yellow.ldr": ("The yellow townhouse",
                             "Four storeys: two doors, iron balconies on the second and third "
                             "floors, shuttered windows on the top floor and a grey roof with a "
                             "dormer."),
        "house_blue.ldr": ("The blue townhouse",
                           "Three storeys: an arched doorway, iron balconies on the two upper "
                           "floors and a grey roof with a dormer."),
        "lamp.ldr": ("The gas lamps", "A black post, a clear lantern and a black cap."),
    },
    legend=("lamp.ldr", 1),
    tips=["Each storey is one course of pastel bricks, then a band of white plates. Under a "
          "balcony the band sticks out one stud at the front: that is the balcony floor.",
          "The balcony railings are black 1&times;4 lattice fences. Set each one on the front "
          "edge of its balcony floor; the next band rests on top of it.",
          "Roofs go up one row of slopes at a time; hidden bricks under the roof have a step "
          "of their own, just before the slopes that rest on them."],
    build_time="about 1 to 1&frac12; hours",
)

HOUSE_W, HOUSE_D = 6, 6                 # walls are local z = 1..HOUSE_D; z = 0 is the balcony
HOUSES = [  # file, title, wall, ground floor, storeys, balconies, side windows, x on the base
    ("house_pink.ldr", "Pink townhouse", PINK, "arch", 3, (2, 3), {1: (0,), 2: (0,), 3: (0,)}, 3),
    ("house_yellow.ldr", "Yellow townhouse", CREAM, "doors", 4, (2, 3),
     {4: (0, HOUSE_W - 1)}, 9),
    ("house_blue.ldr", "Blue townhouse", AZURE, "arch", 3, (2, 3),
     {1: (HOUSE_W - 1,), 2: (HOUSE_W - 1,), 3: (HOUSE_W - 1,)}, 15)]
HOUSE_Z = 7                              # balcony line on the base; walls at z 8..13
LAMPS = ((2, 4), (21, 4))
SIDEWALK = (4, HOUSE_Z)                 # rows of paving in front of the houses


# --------------------------------------------------------------------------
# a townhouse: pastel walls, iron balconies on floors 2 and 3, grey roof, dormer
# --------------------------------------------------------------------------
def build_house(name, title, wall, ground, floors, balconies, side_windows):
    """balconies: the floors with an iron balcony; side_windows: {floor: (x, ...)}
    with the side walls (local x) that get a window on that floor."""
    m = Model(name, title)
    w, d = HOUSE_W, HOUSE_D
    fill_rect(m, "p", PLINTH, 0, 1, w, d, 0, along="x")
    m.step()
    ring = WallRing([(0, 1), (w - 1, 1), (w - 1, d), (0, d)])
    band_cells = {(x, z) for x in range(w) for z in range(1, d + 1)
                  if x in (0, w - 1) or z in (1, d)}
    mid = (d + 1) // 2                    # side windows: local z = mid, mid + 1

    def course(L, parity, openings):
        ring.course(m, L, parity, lambda x, z, layer: None if (x, z) in openings
                    else ("b", wall))

    for f in range(1, floors + 1):
        L = storey_layer(f)
        sides = {(x, z) for x in side_windows.get(f, ()) for z in (mid, mid + 1)}
        if f == 1 and ground == "arch":
            course(L, f % 2, {(x, 1) for x in range(1, w - 1)} | sides)
            m.add("arch1x4", TRIM, 1, 1, L)
            m.add("b1x2", DOOR, 2, 2, L)
        else:
            doors = {(1, 1), (w - 2, 1)}
            course(L, f % 2, doors | sides)
            for x, z in sorted(doors):
                m.add("b1x1", DOOR if f == 1 else SHUTTER, x, z, L)
        for x in side_windows.get(f, ()):
            m.add("b1x2", WINDOW, x, mid, L, rot=90)
        if f in balconies:
            m.add("fence1x4", IRON, 1, 0, L)     # the wrought-iron railing
        m.step()
        # the floor band; it carries the balcony floor of the storey above
        if f == floors:
            fill_rect(m, "p", TRIM, 0, 0, w, d + 1, L + 3, along="z")
        elif f + 1 in balconies:
            place_rect(m, "p", TRIM, 1, 0, w - 2, 2, L + 3)
            fill_cells(m, "p", TRIM, band_cells - {(x, 1) for x in range(1, w - 1)}, L + 3)
        else:
            fill_cells(m, "p", TRIM, band_cells, L + 3)
        m.step()
    base = storey_layer(floors) + 4
    # hidden bricks under the ridge tiles that have no slope below them: the middle
    # row of the roof and the two cells behind the dormer (the gable walls hold the ends)
    for L in (base, base + 3):
        m.add("b1x4", HIDDEN, 1, 3, L)
        m.add("b1x2", HIDDEN, 2, 2, L)
    m.step()
    dormer = [(2, 1), (3, 1)]
    build_roofs(m, [
        Roof(0, w, 0, d + 1, base, "x", pitch=45, color=ROOF, wall=wall, priority=1,
             name="roof"),
        Roof(2, 4, 1, 3, base + 3, "x", pitch=45, color=ROOF, name="dormer"),
    ], fill_color=ROOF, keep_open=set(dormer))
    # the dormer: a window between white sills, under a little grey roof
    L = base + 3
    m.add("p1x2", TRIM, 2, 1, L)
    m.add("p1x2", DOOR, 2, 1, L + 1)
    m.add("p1x2", TRIM, 2, 1, L + 2)
    m.step()
    for x, z in dormer:
        m.add("cheese", ROOF, x, z, L + 3)
    m.step()
    m.width, m.depth = w, d + 1
    return m


# --------------------------------------------------------------------------
# the gas lamp: a black post, a clear lantern and a black cap
# --------------------------------------------------------------------------
def build_lamp():
    m = Model("lamp.ldr", "Gas lamp (build 2)")
    m.add("round1", IRON, 0, 0, 0)
    m.add("round1", TCLEAR, 0, 0, 3)
    m.step()
    m.add("cone1", IRON, 0, 0, 6)
    m.step()
    m.width, m.depth = 1, 1
    return m


# --------------------------------------------------------------------------
# main model
# --------------------------------------------------------------------------
def build_main(houses, lamp):
    m = Model("port_orleans_french_quarter_compact.ldr", "Port Orleans French Quarter (compact)")
    m.header_notes = ["Compact resort collection; generated by design.py (lego-kit)."]
    m.section("The display base", "The base and the black band are the same for every kit in "
              "the collection. The sidewalk in front of the houses and the lawns go on next.")
    band = display_base(m)
    reserved = set(band)
    for *_, x0 in HOUSES:
        reserved |= {(x0 + x, HOUSE_Z + z) for x in range(HOUSE_W) for z in range(1, HOUSE_D + 1)}
    reserved |= set(LAMPS)

    def ground(x, z):
        if SIDEWALK[0] <= z <= HOUSE_Z and 1 <= x < 23:
            return PAVING
        return GREEN
    finish_ground(m, reserved, GREEN, colour_at=ground)
    m.step()
    for (*_, x0), house in zip(HOUSES, houses):
        m.sub(house, x0, HOUSE_Z, 1)
        m.step()
    m.section("The gas lamps", "Two black gas lamps on the sidewalk.")
    for x, z in LAMPS:
        m.sub(lamp, x, z, 1)
    m.step()
    return m


def build():
    with bestseller_sizes():
        houses = [build_house(*h[:-1]) for h in HOUSES]
        lamp = build_lamp()
        main_m = build_main(houses, lamp)
    return main_m, [main_m] + houses + [lamp]
