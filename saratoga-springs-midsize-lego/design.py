"""Saratoga Springs Resort, mid-size display kit (resort collection).

Build with the shared kit:  ./build.sh

The mid-size format (lego-kit/compact.py, size="midsize"): a 32 x 24 base with a
black front band; one storey = 4 plates (a course of bricks and a plate band),
1 stud is about 2 m, the same scale as the compact kit. It shows the arrival
front of the Carriage House facing the band, symmetric about x = 15.5, and more
of the resort than the compact kit rather than a bigger copy of it: a third
storey and a cross-gable on the pavilion, a porte-cochere over a carriage loop,
guest buildings, a spring, lamp posts, flower beds and trees.

Grid (studs): x to the right, z toward the back; the front band is z = 0..1.
  Carriage House  x  6..25, z 11..22   cross plan: the three-storey pavilion (x 11..20,
                                       z 11..22), its tall front gable crossing a
                                       cross-gable over z 14..19; two-storey wings (x 6..10
                                       and 21..25, z 14..19) with white porches at z = 14
                                       and gabled roofs against the pavilion. Cream ground
                                       floor, sage-green upper floors, white bands, steep
                                       dark grey roofs with cream bargeboards
  belvedere       on the pavilion ridge where the roofs cross (x 15..16, z 16..17)
  guest buildings x  0..5 and 26..31, z 16..21   two storeys and a front porch under a
                                       steep front gable (build 2)
  porte-cochere   x 13..18, z  6..10   white posts and a steep front gable over the loop
  carriage loop   across z 6..10 (x 8..23) and down to the band (x 8..11 and 20..23)
  spring          x 13..18, z  2..5    a rock with water bubbling from it, in a pool
  trees, lamps    shade trees at (3, 4) and (28, 4); lamp posts at (7, 5) and (24, 5)
  flower beds     z 12..13 in front of the wings' porches; z 15 in front of the guest
                  buildings
"""
from contextlib import contextmanager

import bricks
from bricks import (Model, PARTS, FACE, row, fill_rect, fill_cells, place_rect, rot_matrix,
                    WHITE, BLACK, DBG, LBG, GREEN, BRGREEN, TAN, RBROWN, TCLEAR, RED)
from walls import WallRing
from roofs import Roof, build_roofs
from compact import compact_project, display_base, finish_ground

SIZE = "midsize"
SAGE, WATER, LAVENDER = 378, 43, 30          # Sand Green, Trans-Light Blue, Medium Lavender
CREAM, UPPER, TRIM, ROOF, WINDOW, PLINTH = TAN, SAGE, WHITE, DBG, BLACK, LBG
BAND, RAKE, DRIVE, ROCK = WHITE, TAN, LBG, DBG      # white bands, cream bargeboards

# Plant Leaves 4 x 3 (a Bestseller in green), for the tops of the shade trees
bricks.P("ssm_leaves4x3", "2423.dat", "Plant Leaves 4 x 3", cells=[(0, 0)], studs=[(0, 0)],
         height=1)

PROJECT = compact_project(
    size=SIZE,
    slug="saratoga_springs",
    title="Saratoga Springs Resort",
    resort="Disney's Saratoga Springs Resort & Spa",
    category="Deluxe Villas (DVC)",
    merged=["The Treehouse Villas at Disney's Saratoga Springs Resort"],
    about=("The arrival front of the Carriage House at Saratoga Springs, built like a "
           "Victorian spa-town building in upstate New York: a cream ground floor and "
           "sage-green upper floors with white floor bands, under steep dark grey roofs with "
           "cream bargeboards. The three-storey central pavilion's tall front gable, with an "
           "attic window, a round window and a louvre, crosses a cross-gable that carries on "
           "the line of the gabled wings, and a white belvedere with a grey dome and finial "
           "stands where the roofs meet. White porches with posts and railings run along the "
           "wings, and a porte-cochere with its own steep gable stands over the carriage loop. "
           "Lower guest buildings in the same colours, with porches of their own, stand back "
           "at either end. In front, water bubbles from a rock in a small spring pool inside "
           "the loop, between black lamp posts, flower beds and two shade trees."),
    features=["The Carriage House front, symmetric about the entrance: a cream ground floor "
              "and sage-green upper floors with white floor bands",
              "The three-storey central pavilion, taller than in the compact kit: its tall "
              "front gable, with an attic window, a round window and a louvre, crosses a "
              "cross-gable under steep dark grey roofs with cream bargeboards",
              "The white belvedere with a grey dome and finial where the roofs cross",
              "Two-storey wings with white porches, posts and railings, gabled at the outer "
              "ends",
              "A porte-cochere on white posts with a steep front gable, over the carriage loop",
              "Two lower guest buildings in cream and sage, set back at either end, with "
              "porches of their own",
              "A spring bubbling from a rock in a clear blue pool, two black lamp posts, "
              "flower beds and two shade trees"],
    omitted=["The rest of the guest buildings, the Treehouse Villas, the pools and the spa",
             "The carved gable trusses, the brackets and the Carriage House's back wing",
             "The lake front and the rest of the gardens"],
    colour_rows=[("Sand Green", "Sand Green", "Sand Green"), ("Tan", "Brick Yellow", "Tan"),
                 ("White", "White", "White"),
                 ("Dark Bluish Gray", "Dark Stone Grey", "Dark Bluish Gray"),
                 ("Black", "Black", "Black"),
                 ("Light Bluish Gray", "Medium Stone Grey", "Light Bluish Gray"),
                 ("Green", "Dark Green", "Green"),
                 ("Bright Green", "Bright Green", "Bright Green"),
                 ("Reddish Brown", "Reddish Brown", "Reddish Brown"),
                 ("Red", "Bright Red", "Red"),
                 ("Medium Lavender", "Medium Lavender", "Medium Lavender"),
                 ("Trans-Light Blue", "Transparent Light Blue", "Trans-Light Blue"),
                 ("Trans-Clear", "Transparent", "Trans-Clear")],
    organisation=["The display base, the carriage loop and the lawns", "The Carriage House",
                  "The belvedere", "The guest buildings (build 2)", "The porte-cochere",
                  "The garden: the spring, lamp posts, flower beds and trees"],
    sub_info={
        "carriage_house.ldr": ("The Carriage House",
                               "The cross-shaped plinth, the cream ground floor with the white "
                               "porches and the sage-green upper floor; the wings' roofs; then "
                               "the pavilion's third storey and its tall front gable crossing "
                               "the cross-gable."),
        "belvedere.ldr": ("The belvedere",
                          "White columns under a grey dome and finial. It stands on the open "
                          "studs of the ridge where the roofs cross."),
        "guest.ldr": ("The guest buildings",
                      "Two identical guest buildings: a cream ground floor behind a white "
                      "porch, a sage-green upper floor and a steep front gable with cream "
                      "bargeboards."),
        "porte.ldr": ("The porte-cochere",
                      "Four white posts carry a white deck and a steep dark grey roof with a "
                      "front gable. It stands over the carriage loop at the entrance."),
        "lamp.ldr": ("The lamp posts", "A black post with a clear lantern."),
        "tree.ldr": ("The shade trees", "A brown trunk and a crown of leaves."),
    },
    legend=("tree.ldr", 1),
    tips=["Each storey is one course of bricks, tan below and sand green above, with black "
          "bricks for the windows, then a layer of white plates.",
          "Plates hidden inside the plinth tie its big plates together before the walls go on.",
          "The wings' roofs go on before the pavilion's third storey; their inner ends stand "
          "against it.",
          "The pavilion roof and its cross-gable cross: build them one row of slopes at a "
          "time, with the tan slopes at the gable ends. Hidden dark grey bricks under the "
          "valleys have a step of their own, just before the slopes they hold up.",
          "The belvedere's finial and the spring's water sit on the centre stud of a 2&times;2 "
          "dome, half a stud off the grid.",
          "Each lamp post's bar pushes into the hollow stud of the round brick; the clear "
          "lantern slides onto the top of the bar.",
          "A <b>&ldquo;Build 2&rdquo;</b> badge means you build that module twice."],
    build_time="about 2 to 2&frac12; hours",
)

# Bestseller sizes (checked with avail.py) for colours the shared table has no entry for
KIT_SIZES = {("b", TAN): "1x1 1x2", ("b", SAGE): "1x1 1x2 1x4",
             ("p", SAGE): "1x1 1x2 1x4 1x6 2x2 2x4", ("t", SAGE): "1x1 1x2 1x4",
             ("t", WATER): "1x1 1x2", ("p", WATER): "1x2"}


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
    """Sort key for splitting a step: front rows first."""
    return (it.z if it.z is not None else 999, it.x if it.x is not None else 999)


def split_big_steps(m, limit=20):
    """Split every step of more than `limit` parts into two: the front half first."""
    groups = {}
    for it in m.items:
        groups.setdefault(it.step, []).append(it)
    notes = dict(m.step_notes)
    m.step_notes = {}
    n = 0
    for step in sorted(groups):
        items = groups[step]
        n += 1
        if step in notes:
            m.step_notes[n] = notes[step]
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


def rect(x0, z0, w, d):
    return {(x, z) for x in range(x0, x0 + w) for z in range(z0, z0 + d)}


# --------------------------------------------------------------------------
# the Carriage House: a three-storey pavilion whose tall front gable crosses its
# cross-gable, between two-storey wings with porches
# --------------------------------------------------------------------------
W, D = 20, 12                        # footprint
PAV = (5, 15)                        # x range of the pavilion (z 0..11)
WING_Z = (3, 9)                      # z range of the wings (x 0..4 and 15..19)
DOOR = (9, 10)
BELV = (9, 5)                        # front-left cell of the 2 x 2 belvedere on the ridge
FLOORS = 2                           # wings and guest buildings; the pavilion has three


def outline(front_wing_z):
    """Cross-shaped wall outline: the pavilion and the two wings (front wall at front_wing_z)."""
    p0, p1 = PAV[0], PAV[1] - 1
    w1 = WING_Z[1] - 1
    return [(0, front_wing_z), (p0, front_wing_z), (p0, 0), (p1, 0), (p1, front_wing_z),
            (W - 1, front_wing_z), (W - 1, w1), (p1, w1), (p1, D - 1), (p0, D - 1), (p0, w1),
            (0, w1)]


def footprint():
    p0, p1 = PAV
    z0, z1 = WING_Z
    return {(x, z) for x in range(W) for z in range(D) if p0 <= x < p1 or z0 <= z < z1}


PAV_FRONT = {1: "CWCCDDCCWC", 2: "SWSSWWSSWS", 3: "SWSSWWSSWS"}     # x 5..14, z = 0
WING_FRONT = "CWCWC"                                                # x 0..4 (mirrored)


def wall_colour(x, z, floor):
    """Cream or sage wall, or a black window, for a wall cell."""
    plain = CREAM if floor == 1 else UPPER
    p0, p1 = PAV
    if z == 0:                                      # the pavilion front
        c = PAV_FRONT[floor][x - p0]
        return {"C": CREAM, "S": UPPER, "W": WINDOW, "D": WINDOW}[c]
    if x < p0 or x >= p1:                           # the wings
        wx = x if x < p0 else W - 1 - x
        if z in (WING_Z[0], WING_Z[0] + 1):         # front (upper z = 3, ground z = 4)
            return WINDOW if WING_FRONT[wx] == "W" else plain
        if z == WING_Z[1] - 1:                      # back
            return WINDOW if wx in (1, 3) else plain
        if x in (0, W - 1):                         # the outer ends
            return WINDOW if z in (5, 6) else plain
        return plain
    if x in (p0, p1 - 1):                           # the pavilion's sides
        return WINDOW if z in (1, D - 2) else plain
    if z == D - 1:                                  # the pavilion's back
        return WINDOW if x in (p0 + 2, p1 - 3) else plain
    return plain


def cross_layer(m, colour, layer, middle=True):
    """Plates over the cross footprint: a 6 x 6 plate across each wing and the pavilion's
    side column, a 6 x 8 in the middle (unless `middle` is False), and strips of a 2 x 10
    and a 1 x 10 across the pavilion's front and back."""
    p0, p1 = PAV
    z0, z1 = WING_Z
    for x in (0, p1 - 1):
        place_rect(m, "p", colour, x, z0, 6, z1 - z0, layer)
    if middle:
        place_rect(m, "p", colour, p0 + 1, z0, p1 - p0 - 2, z1 - z0, layer)
    for zz in ((0, 2), (D - 2, 1)):
        place_rect(m, "p", colour, p0, zz[0], p1 - p0, 2, layer)
    for zz in (2, D - 3):
        place_rect(m, "p", colour, p0, zz, p1 - p0, 1, layer)


def pav_gable(m, cells, layer):
    """The pavilion's gable walls: at the front an attic window, a round window and a
    louvre in sage green; the back one plain."""
    z = cells[0][1]
    xs = sorted(c[0] for c in cells)
    if z != 0:
        row(m, "b", UPPER, xs[0], z, len(xs), layer)
        return
    if len(xs) == 6:                                # attic window
        m.add("b1x1", UPPER, xs[0], z, layer)
        m.add("b1x2", WINDOW, xs[1], z, layer)
        m.add("b1x2", WINDOW, xs[3], z, layer)
        m.add("b1x1", UPPER, xs[5], z, layer)
    elif len(xs) == 4:                              # round window
        m.add("b1x1", UPPER, xs[0], z, layer)
        m.add("tech1x2", TRIM, xs[1], z, layer)
        m.add("b1x1", UPPER, xs[3], z, layer)
    else:                                           # louvre under the ridge
        m.add("grille1x2", TRIM, xs[0], z, layer)


def cross_gable(m, cells, layer):
    """The cross-gable's ends, above the wings' ridges: plain sage green."""
    x = cells[0][0]
    zs = sorted(c[1] for c in cells)
    row(m, "b", UPPER, x, zs[0], len(zs), layer, axis="z")


def build_house():
    m = Model("carriage_house.ldr", "The Carriage House")
    p0, p1 = PAV
    z0, z1 = WING_Z
    cross_layer(m, PLINTH, 0)
    # hidden plates inside, across the seams between the plinth plates
    for x in (p0 - 2, p1 - 2):
        place_rect(m, "p", PLINTH, x, z0 + 2, 4, 2, 1)
    for z in (1, z1 - 2):
        place_rect(m, "p", PLINTH, DOOR[0], z, 2, 4, 1)
    m.step()

    ground = WallRing(outline(z0 + 1))
    upper = WallRing(outline(z0))
    top = WallRing([(p0, 0), (p1 - 1, 0), (p1 - 1, D - 1), (p0, D - 1)])
    porch = {(x, z0) for x in list(range(p0)) + list(range(p1, W))}
    posts = {(x, z0) for x in (0, p0 - 1, p1, W - 1)}
    rails = [(1, p0 - 2), (p1 + 1, W - 2)]

    # ground floor in cream, the porches in white
    L = 1
    ground.course(m, L, 0, lambda x, z, layer: ("b", wall_colour(x, z, 1)))
    m.step()
    for x, z in sorted(posts):
        m.add("round1", TRIM, x, z, L)
    for x, z in sorted(porch - posts):
        m.add("round_p1", TRIM, x, z, L)
    m.step()
    for x0, x1 in rails:
        row(m, "t", TRIM, x0, z0, x1 - x0 + 1, L + 1)
    m.step()
    cross_layer(m, BAND, L + 3, middle=False)
    m.step()

    # upper floor in sage green
    L = 5
    upper.course(m, L, 1, lambda x, z, layer: ("b", wall_colour(x, z, 2)))
    m.step()
    cross_layer(m, BAND, L + 3, middle=False)
    m.step()

    # the wings' roofs: a gable with cream bargeboards at the outer end
    base = L + 4
    m.step("The wings' roofs. Their inner ends stand against the pavilion's third storey.")
    build_roofs(m, [
        Roof(0, p0, z0, z1, base, "x", pitch=45, color=ROOF, trim=RAKE, trim_ends=("start",),
             wall=UPPER, wall_ends=("start",), widths=(4, 2, 1), name="left wing roof"),
        Roof(p1, W, z0, z1, base, "x", pitch=45, color=ROOF, trim=RAKE, trim_ends=("end",),
             wall=UPPER, wall_ends=("end",), widths=(4, 2, 1), name="right wing roof"),
    ], fill_color=ROOF, support_caps=True)

    # the pavilion's third storey
    L = base
    top.course(m, L, 0, lambda x, z, layer: ("b", wall_colour(x, z, 3)))
    m.step()
    fill_rect(m, "p", BAND, p0, 0, p1 - p0, D, L + 3, along="z")
    m.step()

    # the steep roofs: the pavilion's tall front gable crossing its cross-gable
    base = L + 4
    bx, bz = BELV
    keep = {(bx + i, bz + j) for i in (0, 1) for j in (0, 1)}
    pav = Roof(p0, p1, 0, D, base, "z", pitch=45, color=ROOF, trim=RAKE,
               trim_ends=("start", "end"), wall=pav_gable, widths=(4, 2, 1),
               name="pavilion roof")
    cross = Roof(p0, p1, z0, z1, base, "x", pitch=45, color=ROOF, trim=RAKE,
                 trim_ends=("start", "end"), wall=cross_gable, priority=1, widths=(4, 2, 1),
                 name="cross-gable")
    build_roofs(m, [pav, cross], fill_color=ROOF, keep_open=keep, support_caps=True)
    split_big_steps(m)
    m.width, m.depth = W, D
    return m, pav.layer(pav.K + 1)


def build_belvedere():
    """White columns, a white cornice, a grey dome and a finial."""
    m = Model("belvedere.ldr", "Belvedere")
    m.add("p2x2", TRIM, 0, 0, 0)
    m.step()
    for i in (0, 1):
        for j in (0, 1):
            m.add("round1", TRIM, i, j, 1)
            m.add("round1", TRIM, i, j, 4)
    m.step()
    m.add("p2x2", TRIM, 0, 0, 7)
    dome = m.add("dish2", ROOF, 0, 0, 8)
    m.step()
    m.step("The finial sits on the dome's centre stud.")
    y = -8 * (8 + PARTS["dish2"].height)
    tip = m.add_raw("round_p1", TRIM, (20, y - PARTS["round_p1"].bmax_y, 20), rot_matrix(0),
                    attach_to=dome)
    m.add_raw("cone1", ROOF, (20, y - 8 - PARTS["cone1"].bmax_y, 20), rot_matrix(0),
              attach_to=tip)
    m.step()
    m.width, m.depth = 2, 2
    return m


# --------------------------------------------------------------------------
# guest buildings: two storeys under a steep front gable (build 2)
# --------------------------------------------------------------------------
GW, GD = 6, 6


def guest_colour(x, z, floor):
    plain = CREAM if floor == 1 else UPPER
    if z == 2 - floor:                               # front (ground z = 1, behind the porch)
        return WINDOW if x in (1, 4) else plain
    if z == GD - 1:
        return WINDOW if x in (2, 3) else plain
    if x in (0, GW - 1):
        return WINDOW if z in (2, 3) else plain
    return plain


def guest_gable(m, cells, layer):
    z = cells[0][1]
    xs = sorted(c[0] for c in cells)
    m.add("b1x2", WINDOW if z == 0 else UPPER, xs[0], z, layer)


def build_guest():
    """Two storeys under a steep front gable, with a white porch along the front."""
    m = Model("guest.ldr", "Guest building (build 2)")
    fill_rect(m, "p", PLINTH, 0, 0, GW, GD, 0)
    m.step()
    ground = WallRing([(0, 1), (GW - 1, 1), (GW - 1, GD - 1), (0, GD - 1)])
    upper = WallRing([(0, 0), (GW - 1, 0), (GW - 1, GD - 1), (0, GD - 1)])
    ground.course(m, 1, 1, lambda x, z, layer: ("b", guest_colour(x, z, 1)))
    m.step()
    for x in (0, GW - 1):
        m.add("round1", TRIM, x, 0, 1)
    for x in range(1, GW - 1):
        m.add("round_p1", TRIM, x, 0, 1)
    m.step()
    row(m, "t", TRIM, 1, 0, GW - 2, 2)
    m.step()
    fill_cells(m, "p", BAND, {(x, z) for x in range(GW) for z in range(GD)
                              if z <= 1 or z == GD - 1 or x in (0, GW - 1)}, 4)
    m.step()
    upper.course(m, 5, 0, lambda x, z, layer: ("b", guest_colour(x, z, 2)))
    m.step()
    fill_rect(m, "p", BAND, 0, 0, GW, GD, 8)
    m.step()
    base = 1 + 4 * FLOORS
    build_roofs(m, [Roof(0, GW, 0, GD, base, "z", pitch=45, color=ROOF, trim=RAKE,
                         trim_ends=("start",), wall=guest_gable, widths=(4, 2, 1),
                         name="guest roof")], fill_color=ROOF, support_caps=True)
    m.width, m.depth = GW, GD
    return m


# --------------------------------------------------------------------------
# porte-cochere: four white posts, a deck and a steep front gable
# --------------------------------------------------------------------------
PC_W, PC_D = 6, 5
PC_POSTS = [(0, 0), (PC_W - 1, 0), (0, PC_D - 1), (PC_W - 1, PC_D - 1)]


def porte_gable(m, cells, layer):
    z = cells[0][1]
    xs = sorted(c[0] for c in cells)
    row(m, "b", TRIM, xs[0], z, len(xs), layer)


def build_porte():
    m = Model("porte.ldr", "Porte-cochere")
    for x, z in PC_POSTS:
        m.add("round1", TRIM, x, z, 0)
        m.add("round1", TRIM, x, z, 3)
    m.step()
    fill_rect(m, "p", TRIM, 0, 0, PC_W, PC_D, 6, along="x")
    m.step()
    build_roofs(m, [Roof(0, PC_W, 0, PC_D, 7, "z", pitch=45, color=ROOF, trim=RAKE,
                         trim_ends=("start",), wall=porte_gable, widths=(4, 2, 1),
                         name="porte roof")], fill_color=ROOF, support_caps=True)
    m.width, m.depth = PC_W, PC_D
    return m


# --------------------------------------------------------------------------
# details: lamp posts, shade trees, the spring
# --------------------------------------------------------------------------
def build_lamp():
    """A black post (a 4L bar in a round brick) with a clear lantern and a black cap."""
    m = Model("lamp.ldr", "Lamp post")
    base = m.add("round1", BLACK, 0, 0, 0)
    m.step()
    c = 10
    bar_y = -8 * 3 + 4 - 80
    bar = m.add_raw("bar4", BLACK, (c, bar_y, c), rot_matrix(0), attach_to=base)
    lantern_y = bar_y + 8 - PARTS["round1"].bmax_y
    lantern = m.add_raw("round1", TCLEAR, (c, lantern_y, c), rot_matrix(0), attach_to=bar)
    m.add_raw("cone1", BLACK, (c, lantern_y - PARTS["cone1"].bmax_y, c), rot_matrix(0),
              attach_to=lantern)
    m.step()
    m.width, m.depth = 1, 1
    return m


def build_tree():
    """A shade tree: a brown trunk and a rounded crown of leaves."""
    m = Model("tree.ldr", "Shade tree")
    for k in range(3):
        m.add("round1", RBROWN, 0, 0, 3 * k)
    m.step()
    m.add("ssm_leaves4x3", GREEN, 0, 0, 9, rot=45)
    m.add("leaves6x5", BRGREEN, 0, 0, 10, rot=0)
    m.add("leaves6x5", GREEN, 0, 0, 11, rot=90)
    m.add("leaves6x5", BRGREEN, 0, 0, 12, rot=180)
    m.add("leaves6x5", GREEN, 0, 0, 13, rot=270)
    m.add("ssm_leaves4x3", GREEN, 0, 0, 14, rot=0)
    m.add("ssm_leaves4x3", GREEN, 0, 0, 15, rot=90)
    m.add("leaves1", GREEN, 0, 0, 16, rot=45)
    m.step()
    m.width, m.depth = 1, 1
    return m


# --------------------------------------------------------------------------
# main model
# --------------------------------------------------------------------------
HX, HZ = 6, 11                               # the Carriage House's corner on the base
GUESTS = ((0, 16), (26, 16))
PX, PZ = 13, 6                               # porte-cochere
LOOP_Z = range(6, 11)                        # the drive across, under the porte-cochere
LOOP_X = range(8, 24)
LEGS = (range(8, 12), range(20, 24))         # down to the band
SPRING = (13, 2)                             # the spring's corner: 6 x 4 studs
POOL = rect(13, 2, 6, 2) | {(13, 4), (14, 4), (17, 4), (18, 4)}
MOUND = (15, 4)                              # the rock the spring rises from (2 x 2)
TREES = ((3, 4), (28, 4))
LAMPS = ((7, 5), (24, 5))
FLOWER_Z = 13


def ground_colour(x, z):
    if z in LOOP_Z and x in LOOP_X:
        return DRIVE
    if z < LOOP_Z.start and any(x in leg for leg in LEGS):
        return DRIVE
    return GREEN


def add_spring(m):
    """The spring: a grey rock mound with water bubbling from its top, in a clear blue
    pool edged with rocks (a nod to the High Rock Spring of Saratoga Springs)."""
    m.step("The pool: clear blue tiles straight on the base, round a 2×2 space for the rock.")
    for z in sorted({c[1] for c in POOL}):
        xs = sorted(c[0] for c in POOL if c[1] == z)
        runs = []
        for x in xs:
            if runs and runs[-1][0] + runs[-1][1] == x:
                runs[-1][1] += 1
            else:
                runs.append([x, 1])
        for x, n in runs:
            row(m, "t", WATER, x, z, n, 1, sizes=[2, 1])
    m.step()
    m.step("The rock: four dark grey bricks under a dark grey dome, with rocks sloping down "
           "to it.")
    mx, mz = MOUND
    for i in (0, 1):
        for j in (0, 1):
            m.add("b1x1", ROCK, mx + i, mz + j, 1)
    dome = m.add("dish2", ROCK, mx, mz, 4)
    m.add("slope45", ROCK, mx - 2, mz + 1, 1, rot=FACE["right"])
    m.add("slope45", ROCK, mx + 2, mz + 1, 1, rot=FACE["left"])
    m.step()
    m.add("cheese", LBG, mx - 2, mz + 1, 4, rot=FACE["right"])
    m.add("cheese", LBG, mx + 3, mz + 1, 4, rot=FACE["left"])
    m.step("The spring: two clear blue round plates on the dome's centre stud.")
    y = -8 * (4 + PARTS["dish2"].height)
    cx, cz = 20 * (mx + 1), 20 * (mz + 1)
    jet = m.add_raw("round_p1", WATER, (cx, y - PARTS["round_p1"].bmax_y, cz), rot_matrix(0),
                    attach_to=dome)
    m.add_raw("round_p1", WATER, (cx, y - 8 - PARTS["round_p1"].bmax_y, cz), rot_matrix(0),
              attach_to=jet)
    m.step()


def build_main(house, roof_top, belv, guest, porte, lamp, tree):
    m = Model("saratoga_springs_midsize.ldr", "Saratoga Springs Resort (mid-size)")
    m.header_notes = ["Mid-size resort collection; generated by design.py (lego-kit)."]
    m.section("The display base", "The base and the black band are the same for every "
              "mid-size kit. The carriage loop and the lawns go on next; the drive tiles tie "
              "the base plates together.")
    band = display_base(m, SIZE)
    reserved = set(band)
    reserved |= {(HX + x, HZ + z) for x, z in footprint()}
    for gx, gz in GUESTS:
        reserved |= rect(gx, gz, GW, GD)
    reserved |= {(PX + x, PZ + z) for x, z in PC_POSTS}
    reserved |= rect(*SPRING, 6, 4)
    finish_ground(m, reserved, GREEN, colour_at=ground_colour, size=SIZE)
    m.step()
    m.sub(house, HX, HZ, 1)
    m.step()
    m.sub(belv, HX + BELV[0], HZ + BELV[1], 1 + roof_top)
    m.step()
    for gx, gz in GUESTS:
        m.sub(guest, gx, gz, 1)
    m.step()
    m.sub(porte, PX, PZ, 1)
    m.step()
    m.section("The garden", "A rocky spring in the middle of the carriage loop, lamp posts, "
              "flower beds along the porches and two shade trees finish the lawns.")
    add_spring(m)
    for x, z in LAMPS:
        m.sub(lamp, x, z, 2)
    m.step()
    m.step("Flower beds in front of the porches: red flowers in the front row, lavender "
           "behind, with green leaves between them.")
    for x0 in (HX, HX + 15):
        for i in range(5):
            x = x0 + i
            for z, colour, odd in ((FLOWER_Z, RED, 0), (FLOWER_Z - 1, LAVENDER, 1)):
                if i % 2 == odd:
                    m.add("flower1", colour, x, z, 2)
                else:
                    m.add("leaves1", GREEN, x, z, 2, rot=90 * ((x + z) % 4))
    m.step()
    for gx, gz in GUESTS:
        for i in range(GW):
            x, z = gx + i, gz - 1
            if i % 2 == (0 if gx == 0 else 1):
                m.add("flower1", RED if i in (0, GW - 1) else LAVENDER, x, z, 2)
            else:
                m.add("leaves1", GREEN, x, z, 2, rot=90 * ((x + z) % 4))
    m.step()
    for x, z in TREES:
        m.sub(tree, x, z, 2)
    m.step()
    return m


def build():
    with kit_sizes():
        house, roof_top = build_house()
        belv, guest, porte = build_belvedere(), build_guest(), build_porte()
        lamp, tree = build_lamp(), build_tree()
        main_m = build_main(house, roof_top, belv, guest, porte, lamp, tree)
    return main_m, [main_m, house, belv, guest, porte, lamp, tree]
