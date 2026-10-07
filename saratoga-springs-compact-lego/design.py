"""Saratoga Springs Resort, compact display kit (resort collection).

Build with the shared kit:  ./build.sh

The compact format (lego-kit/compact.py): a 24 x 16 base with a black front
band; one storey = 4 plates (a course of bricks and a plate band), 1 stud is about 2 m.

Grid (studs): x to the right, z toward the back; the front band is z = 0..1.
  Carriage House     x 3..20, z 4..13   cross plan: a central pavilion (x 8..15, z 4..13)
                     with a tall front gable, crossed by two-storey wings (z 6..11);
                     cream ground floor, sage-green upper floor, white floor bands,
                     steep grey 45-degree roofs with cream bargeboards, white porches
                     under the wings, a white belvedere with a grey dome at the crossing
  lamp post          (2, 3)
  walk               x 11..12, z 2..3 to the door
"""
from contextlib import contextmanager

import bricks
from bricks import (Model, place_rect, rot_matrix, PARTS, WHITE, BLACK, DBG, LBG,
                    GREEN, TAN, TCLEAR)
from walls import WallRing
from roofs import Roof, build_roofs
from compact import compact_project, display_base, finish_ground

SAGE = 378                          # Sand Green
CREAM, UPPER, TRIM, ROOF, WINDOW, PLINTH, PATH = TAN, SAGE, WHITE, DBG, BLACK, LBG, TAN
BAND, RAKE = WHITE, TAN             # white floor bands, cream bargeboards

PROJECT = compact_project(
    slug="saratoga_springs",
    title="Saratoga Springs Resort",
    resort="Disney's Saratoga Springs Resort & Spa",
    category="Deluxe Villas (DVC)",
    merged=["The Treehouse Villas at Disney's Saratoga Springs Resort"],
    about=("The Carriage House of Saratoga Springs, built like a Victorian spa-town building "
           "in upstate New York: a cream ground floor and a sage-green upper floor with white "
           "floor bands, under steep grey roofs. The central pavilion's tall front gable "
           "crosses the gabled wings, a white belvedere with a grey dome and finial sits where "
           "the roofs meet, white porches with posts and railings run under the wings, and a "
           "black lamp post stands on the lawn."),
    features=["The Carriage House: a cream ground floor and a sage-green upper floor with "
              "white floor bands",
              "Steep grey roofs: the pavilion's tall front gable crossing the gabled wings, "
              "with cream bargeboards",
              "A white belvedere with a grey dome and finial where the roofs cross",
              "White porches with posts and railings under the wings",
              "A Victorian lamp post on the lawn"],
    omitted=["The guest buildings, the Treehouse Villas, the pools and the spa",
             "The porte-cochere and the carved gable trusses",
             "The lake front and the gardens"],
    colour_rows=[("Sand Green", "Sand Green", "Sand Green"), ("Tan", "Brick Yellow", "Tan"),
                 ("White", "White", "White"),
                 ("Dark Bluish Gray", "Dark Stone Grey", "Dark Bluish Gray"),
                 ("Black", "Black", "Black"),
                 ("Light Bluish Gray", "Medium Stone Grey", "Light Bluish Gray"),
                 ("Green", "Dark Green", "Green"), ("Trans-Clear", "Transparent", "Trans-Clear")],
    organisation=["The display base and the lawn", "The Carriage House", "The lamp post"],
    sub_info={
        "carriage_house.ldr": ("The Carriage House",
                               "The cross-shaped plinth, the cream ground floor with the white "
                               "porches, the sage-green upper floor, then the crossing roofs and "
                               "the belvedere."),
        "lamp.ldr": ("The lamp post", "A black post with a clear lantern."),
    },
    legend=("lamp.ldr", 1),
    tips=["Each storey is one course of bricks, tan below and sand green above, with black "
          "bricks for the windows, then a layer of white plates.",
          "Four plates hidden inside the plinth tie its big plates together before the walls "
          "go on.",
          "The pavilion roof and the wing roof cross: build them one row of slopes at a time, "
          "with the tan slopes at the gable ends.",
          "The lamp post's bar pushes into the hollow stud of the round brick; the clear "
          "lantern slides onto the top of the bar."],
    build_time="about 1 hour",
)

W, D = 18, 10                       # Carriage House footprint
HX, HZ = 3, 4                       # its corner on the base
LAMP = (2, 3)
WALK = (11, 12)                     # the walk to the door (base x)
PAV = (5, 13)                       # x range of the central pavilion (z 0..9)
WING_Z = (2, 8)                     # z range of the wings (x 0..4 and 13..17)
DOOR = {8, 9}
BELVEDERE = (8, 4)                  # front-left cell of the 2 x 2 belvedere

# Bestseller brick sizes in sand green (the shared table has no entry for it)
KIT_SIZES = {("b", SAGE): "1x1 1x2 1x4 1x6"}


@contextmanager
def kit_sizes():
    """Use the kit's Bestseller sizes while building, then restore the shared table."""
    saved = dict(bricks.ALLOWED)
    bricks.ALLOWED.update({k: bricks._sizes(v) for k, v in KIT_SIZES.items()})
    try:
        yield
    finally:
        bricks.ALLOWED.clear()
        bricks.ALLOWED.update(saved)


def front_first(it):
    """Sort key for splitting a step: front rows first (bars and the like last)."""
    return (it.z if it.z is not None else 999, it.x if it.x is not None else 999)


def split_step(m, i0):
    """Spread the parts added since item i0 over two steps: the front half first."""
    new = m.items[i0:]
    later = {id(it) for it in sorted(new, key=front_first)[len(new) // 2:]}
    for it in new:
        if id(it) in later:
            it.step = m.step_no + 1
    m.items[i0:] = sorted(new, key=lambda it: it.step)
    m.step_no += 1
    m.step()


def split_big_steps(m, limit=20):
    """Split every step of more than `limit` parts into two: the front half first."""
    groups = {}
    for it in m.items:
        groups.setdefault(it.step, []).append(it)
    n = 0
    for step in sorted(groups):
        items = groups[step]
        n += 1
        if len(items) > limit:
            back = {id(it) for it in sorted(items, key=front_first)[len(items) // 2:]}
            for it in items:
                it.step = n + 1 if id(it) in back else n
            n += 1
        else:
            for it in items:
                it.step = n
    m.items.sort(key=lambda it: it.step)
    m.step_no = n + 1


# --------------------------------------------------------------------------
# the Carriage House
# --------------------------------------------------------------------------
def outline(front_wing_z):
    """Cross-shaped wall outline: the pavilion and the two wings (front wall at front_wing_z)."""
    p0, p1 = PAV[0], PAV[1] - 1
    w1 = WING_Z[1] - 1
    return [(0, front_wing_z), (p0, front_wing_z), (p0, 0), (p1, 0), (p1, front_wing_z),
            (W - 1, front_wing_z), (W - 1, w1), (p1, w1), (p1, D - 1), (p0, D - 1), (p0, w1),
            (0, w1)]


def windows(x, z, colour):
    """Sash windows (black) in a wall of `colour`."""
    p0, p1 = PAV
    if z == 0:                                        # pavilion front, either side of the door
        return WINDOW if x in (p0 + 1, p1 - 2) else colour
    if x < p0 or x >= p1:                             # the wings
        if z in (WING_Z[0], WING_Z[0] + 1, WING_Z[1] - 1):
            return WINDOW if x in (1, 3, W - 2, W - 4) else colour
        if x in (0, W - 1):
            return WINDOW if z == 5 else colour
        return colour
    if z == D - 1:                                    # pavilion back
        return WINDOW if x in (p0 + 2, p1 - 3) else colour
    return colour


def ground_material(x, z):
    if z == 0 and x in DOOR:
        return WINDOW
    return windows(x, z, CREAM)


def upper_material(x, z):
    if z == 0 and x in DOOR:                          # the paired window over the door
        return WINDOW
    return windows(x, z, UPPER)


def cross_layer(m, colour, layer, middle=True):
    """A layer of plates over the cross-shaped footprint: a 6 x 6 plate across each wing
    (and one in the middle, unless `middle` is False), and 2 x 8 strips across the front
    and back of the pavilion."""
    p0, p1 = PAV
    z0, z1 = WING_Z
    for x in (0, p0 + 1, p1 - 1) if middle else (0, p1 - 1):
        place_rect(m, "p", colour, x, z0, 6, z1 - z0, layer)
    place_rect(m, "p", colour, p0, 0, p1 - p0, z0, layer)
    place_rect(m, "p", colour, p0, z1, p1 - p0, D - z1, layer)


def build_house():
    m = Model("carriage_house.ldr", "The Carriage House")
    cross_layer(m, PLINTH, 0)
    # hidden tie plates inside the building, across the seams between the plinth plates,
    # so the plinth is one piece before the walls go on
    for x in (PAV[0] - 1, PAV[1] - 3):
        place_rect(m, "p", PLINTH, x, 4, 4, 2, 1)
    for z in (1, WING_Z[1] - 1):
        place_rect(m, "p", PLINTH, min(DOOR) - 1, z, 4, 2, 1)
    m.step()
    ground = WallRing(outline(WING_Z[0] + 1))
    upper = WallRing(outline(WING_Z[0]))
    porch = {(x, WING_Z[0]) for x in list(range(PAV[0])) + list(range(PAV[1], W))}
    posts = {(x, WING_Z[0]) for x in (0, PAV[0] - 1, PAV[1], W - 1)}
    rails = [(1, PAV[0] - 2), (PAV[1] + 1, W - 2)]          # x ranges of the porch railings

    # ground floor in cream; white posts in front of the wings
    L = 1
    i0 = len(m.items)
    ground.course(m, L, 0, lambda x, z, layer: ("b", ground_material(x, z)))
    split_step(m, i0)
    for x, z in sorted(posts):
        m.add("round1", TRIM, x, z, L)
    for x, z in sorted(porch - posts):
        m.add("round_p1", TRIM, x, z, L)
    m.step()
    for x0, x1 in rails:
        bricks.row(m, "t", TRIM, x0, WING_Z[0], x1 - x0 + 1, L + 1)
    m.step()
    cross_layer(m, BAND, L + 3, middle=False)
    m.step()

    # upper floor in sage green
    L = 5
    i0 = len(m.items)
    upper.course(m, L, 1, lambda x, z, layer: ("b", upper_material(x, z)))
    split_step(m, i0)
    cross_layer(m, BAND, L + 3)
    m.step()

    # the steep roofs: the pavilion's big front gable crossing the wings' roof
    base = L + 4
    bx, bz = BELVEDERE
    keep = {(bx + i, bz + j) for i in (0, 1) for j in (0, 1)}
    pav = Roof(PAV[0], PAV[1], 0, D, base, "z", pitch=45, color=ROOF, trim=RAKE,
               trim_ends=("start", "end"), wall=UPPER, name="pavilion roof")
    wings = Roof(0, W, WING_Z[0], WING_Z[1], base, "x", pitch=45, color=ROOF, trim=RAKE,
                 trim_ends=("start", "end"), wall=UPPER, priority=1, name="wing roof")
    build_roofs(m, [pav, wings], fill_color=ROOF, keep_open=keep, support_caps=True)

    # the belvedere: white columns under a grey dome and finial
    top = pav.layer(pav.K + 1)
    m.add("p2x2", TRIM, bx, bz, top)
    for i in (0, 1):
        for j in (0, 1):
            m.add("round1", TRIM, bx + i, bz + j, top + 1)
    m.add("p2x2", TRIM, bx, bz, top + 4)
    m.step()
    dome = m.add("dish2", ROOF, bx, bz, top + 5)
    m.add_raw("cone1", ROOF, (20 * bx + 20, -8 * (top + 6) - PARTS["cone1"].bmax_y, 20 * bz + 20),
              rot_matrix(0), attach_to=dome)
    m.step()
    split_big_steps(m)
    m.width, m.depth = W, D
    return m


def build_lamp():
    """A black post (a 4L bar in a round brick) with a clear lantern and a black cap."""
    m = Model("lamp.ldr", "Lamp post")
    base = m.add("round1", BLACK, 0, 0, 0)
    m.step()
    c = 10                                   # centre of the stud cell, in LDU
    bar_y = -8 * 3 + 4 - 80                  # the bar's top; 4 LDU into the hollow stud
    bar = m.add_raw("bar4", BLACK, (c, bar_y, c), rot_matrix(0), attach_to=base)
    lantern_y = bar_y + 8 - PARTS["round1"].bmax_y
    lantern = m.add_raw("round1", TCLEAR, (c, lantern_y, c), rot_matrix(0), attach_to=bar)
    m.add_raw("cone1", BLACK, (c, lantern_y - PARTS["cone1"].bmax_y, c), rot_matrix(0),
              attach_to=lantern)
    m.step()
    m.width, m.depth = 1, 1
    return m


def build_main(house, lamp):
    m = Model("saratoga_springs_compact.ldr", "Saratoga Springs Resort (compact)")
    m.header_notes = ["Compact resort collection; generated by design.py (lego-kit)."]
    m.section("The display base", "The base and the black band are the same for every kit in "
              "the collection. The lawn and the walk to the door go on next.")
    band = display_base(m)
    reserved = set(band)
    reserved |= {(HX + x, HZ + z) for x in range(W) for z in range(D)
                 if PAV[0] <= x < PAV[1] or WING_Z[0] <= z < WING_Z[1]}
    reserved.add(LAMP)
    finish_ground(m, reserved, GREEN,
                  colour_at=lambda x, z: PATH if x in WALK and z < HZ else GREEN)
    m.step()
    m.sub(house, HX, HZ, 1)
    m.step()
    m.sub(lamp, LAMP[0], LAMP[1], 1)
    m.step()
    return m


def build():
    with kit_sizes():
        house, lamp = build_house(), build_lamp()
        main_m = build_main(house, lamp)
    return main_m, [main_m, house, lamp]
