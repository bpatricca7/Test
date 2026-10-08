"""Grand Floridian Resort, mid-size display kit (resort collection).

Build with the shared kit:  ./build.sh

The mid-size format (lego-kit/compact.py, size="midsize"): a 32 x 24 base with a
black front band; one storey = 4 plates (a course of bricks and a plate band),
1 stud is about 2 m, the same scale as the compact kit. It shows more of the
resort than the compact kit rather than a bigger copy of it: verandas on every
block, a porte-cochere over the drive, dormers, a fountain.

Grid (studs): x to the right, z toward the back; the front band is z = 0..1.
  central block   x 10..21, z 14..21   five storeys behind a veranda (z = 14), a steep
                                       10-wide front gable on a hipped roof, the cupola
  wings           x  2..9 and 22..29, z 15..22   three storeys behind a veranda, hipped
                                       roof, a gable at the outer end and a dormer
                                       (mirror images)
  porte-cochere   x 11..20, z  8..13   columns and an arch over the drive, red roof and gable
  drive           z  8..12 across the base, paved up to the main building
  walk, fountain  x 14..17, z 2..7; the fountain at x 14..17, z 3..6
  palms           (4, 5) and (27, 5), on the lawn
"""
from collections import defaultdict

import bricks
from bricks import (Model, PARTS, SubRef, row, fill_rect, fill_cells, place_rect, rot_matrix,
                    split_length, WHITE, BLACK, LBG, RED, GREEN)
from roofs import Roof, build_roofs
from walls import WallRing
from compact import compact_project, display_base, finish_ground, palm

SIZE = "midsize"
# a 1 x 2 plate with one centre stud (a Bestseller in red), for the cupola's spire
bricks.P("gfm_jumper", "15573.dat", "Plate 1 x 2 with 1 Stud")
WALL, WINDOW, ROOF, TRIM, PLINTH, PAVING = WHITE, BLACK, RED, WHITE, LBG, LBG
WATER = 43                           # Trans-Light Blue

PROJECT = compact_project(
    size=SIZE,
    slug="grand_floridian",
    title="Grand Floridian Resort",
    resort="Disney's Grand Floridian Resort & Spa",
    category="Deluxe",
    merged=["The Villas at Disney's Grand Floridian Resort"],
    about=("The main building of the Grand Floridian with its entrance: the five-storey "
           "central block wrapped in white verandas, its steep red roof and big front gable "
           "with an arched window, and the cupola with its red spire on top; two lower wings "
           "with verandas, hipped red roofs, a white-trimmed gable and a dormer each; and the "
           "porte-cochere over the drive, with white columns, an arched entrance and its own "
           "red gable. A round fountain and two palms stand on the lawn in front."),
    features=["Five-storey central block wrapped in white verandas: railings and slim "
              "columns in front of dark recesses",
              "The steep front gable with an arched window and a louvre, and the cupola with "
              "its red spire",
              "Two wings with verandas, red hipped roofs, a white-trimmed gable and a dormer",
              "The porte-cochere over the drive: white columns, the entrance arch and a red "
              "roof with its own gable",
              "A round white fountain on the entrance walk and two palms on the lawn"],
    omitted=["The outer guest lodges, the villas and the marina",
             "The chimneys, turrets and the smaller gables of the roofs",
             "The lamp posts, hedges and flower beds of the gardens"],
    colour_rows=[("White", "White", "White"), ("Red", "Bright Red", "Red"),
                 ("Black", "Black", "Black"),
                 ("Light Bluish Gray", "Medium Stone Grey", "Light Bluish Gray"),
                 ("Dark Bluish Gray", "Dark Stone Grey", "Dark Bluish Gray"),
                 ("Green", "Dark Green", "Green"),
                 ("Reddish Brown", "Reddish Brown", "Reddish Brown"),
                 ("Trans-Light Blue", "Transparent Light Blue", "Trans-Light Blue")],
    organisation=["The display base, the drive and the lawns", "The main building",
                  "The left wing", "The right wing", "The porte-cochere",
                  "The fountain and the palms"],
    sub_info={
        "central.ldr": ("The main building",
                        "Five storeys behind a veranda of white railings and slim columns, "
                        "then the red roof with its steep front gable and the cupola with "
                        "its red spire."),
        "wing_left.ldr": ("The left wing",
                          "Three storeys behind a veranda, under a hipped red roof with a "
                          "white-trimmed gable at the outer end and a dormer next to the main "
                          "building."),
        "wing_right.ldr": ("The right wing",
                           "The mirror image of the left wing: the gable is at the right-hand "
                           "end and the dormer on the left."),
        "porte.ldr": ("The porte-cochere",
                      "White columns and the entrance arch carry a deck and a red hipped roof "
                      "with a front gable. It stands over the drive in front of the main "
                      "building."),
        "palm.ldr": ("The palms", "A trunk of round bricks and two layers of fronds."),
    },
    legend=("palm.ldr", 1),
    tips=["Each storey takes three steps: the walls (black behind the veranda), the veranda "
          "railing with its slim round columns, then the white floor band that ties them "
          "together. Keep black and white parts in separate trays.",
          "The two wings are mirror images, each with its own pages: the gable goes at the "
          "outer end.",
          "Roofs go up one row of slopes at a time. Red bricks hidden under the gables and "
          "dormers have a step of their own, just before the slopes that rest on them.",
          "The cupola's spire sits on a 1&times;2 plate with one stud, laid across the two "
          "below it.",
          "A <b>&ldquo;Build 2&rdquo;</b> badge means you build that module twice."],
    build_time="about 2 to 2&frac12; hours",
)


def roofs(m, blocks, **kw):
    """build_roofs(), then join hidden 1 x 1 supports that stand side by side in one
    step into 1 x 2 to 1 x 4 bricks: fewer pieces, the same support."""
    i0 = len(m.items)
    out = build_roofs(m, blocks, fill_color=ROOF, support_caps=True, **kw)
    head, tail = m.items[:i0], m.items[i0:]
    groups = defaultdict(list)
    for it in tail:
        if not isinstance(it, SubRef) and it.key == "b1x1" and it.color == ROOF:
            groups[(it.step, it.layer)].append(it)
    merged = {}
    for (step, layer), lst in groups.items():
        cells = {(it.x, it.z) for it in lst}
        done, pieces = set(), []
        for axis in ("x", "z"):
            for (x, z) in sorted(cells, key=lambda c: (c[1], c[0]) if axis == "x" else c):
                if (x, z) in done:
                    continue
                nxt = (lambda i: (x + i, z)) if axis == "x" else (lambda i: (x, z + i))
                n = 1
                while nxt(n) in cells and nxt(n) not in done:
                    n += 1
                if n == 1 and axis == "x":
                    continue
                pos = 0
                for k in split_length(n, [4, 3, 2, 1]):
                    pieces.append((axis, *nxt(pos), k))
                    pos += k
                done |= {nxt(i) for i in range(n)}
        new = []
        for axis, x, z, k in pieces:
            pl = m.add(f"b1x{k}", ROOF, x, z, layer, rot=0 if axis == "x" else 90)
            pl.step = step
            new.append(pl)
        merged[id(lst[0])] = new
    old = {id(it) for lst in groups.values() for it in lst}
    items = list(head)
    for it in tail:
        if id(it) in merged:
            items += merged[id(it)]
        if id(it) not in old:
            items.append(it)
    m.items = items
    return out


def storey_layer(f):
    """Bottom layer of storey f's brick course (the plinth is layer 0)."""
    return 1 + 4 * (f - 1)


def runs_x(cells):
    xs = sorted(c[0] for c in cells)
    out = []
    for x in xs:
        if out and out[-1][0] + out[-1][1] == x:
            out[-1] = (out[-1][0], out[-1][1] + 1)
        else:
            out.append((x, 1))
    return out


# --------------------------------------------------------------------------
# a block with a veranda across the front (the main building and the wings)
# --------------------------------------------------------------------------
def veranda(m, w, layer, columns, ground=False):
    """The veranda row at z = 0 between the corner posts: a railing plate and slim
    round columns (round bricks on the ground floor)."""
    if ground:
        for x in columns:
            m.add("round1", WALL, x, 0, layer)
        return
    row(m, "p", WALL, 1, 0, w - 2, layer)
    for x in columns:
        m.add("round_p1", WALL, x, 0, layer + 1)
        m.add("round_p1", WALL, x, 0, layer + 2)


def floor_band(m, W, D, layer):
    """A floor band: a 2-wide plate over the veranda and the front wall, side plates
    from the front edge to the back (they tie the front to the sides), one at the back."""
    place_rect(m, "p", WALL, 1, 0, W - 2, 2, layer)
    for x in (0, W - 1):
        place_rect(m, "p", WALL, x, 0, 1, D, layer)
    place_rect(m, "p", WALL, 1, D - 1, W - 2, 1, layer)


def veranda_block(m, W, D, floors, columns, side_windows, back_windows, blind=()):
    """Plinth, storeys and floor bands of a block with a veranda across the front.

    The grey plinth is a ring under the walls. The front wall stands one stud back
    (z = 1), black behind the veranda; the veranda row (z = 0) has a white railing
    and slim columns, and each floor band ties it to the walls. ``blind`` lists
    (x, last floor) for side walls hidden by the next building: plain white there.
    Returns the roof base layer.
    """
    ring_cells = {(x, z) for x in range(W) for z in range(D)
                  if z <= 1 or z == D - 1 or x in (0, W - 1)}
    fill_cells(m, "p", PLINTH, ring_cells, 0)
    m.step()
    ring = WallRing([(0, 1), (W - 1, 1), (W - 1, D - 1), (0, D - 1)])

    corners = ((0, 1), (W - 1, 1))

    def mat(x, z, layer):
        if (x, z) in corners:
            return None                 # a corner post, laid with the course
        if z == 1 and 0 < x < W - 1:
            return ("b", WINDOW)
        if x in (0, W - 1) and 1 < z < D - 1:
            hidden = any(x == bx and layer < storey_layer(bf + 1) for bx, bf in blind)
            return ("b", WINDOW if z in side_windows and not hidden else WALL)
        if z == D - 1 and 0 < x < W - 1:
            return ("b", WINDOW if x in back_windows else WALL)
        return ("b", WALL)
    for f in range(1, floors + 1):
        L = storey_layer(f)
        ring.course(m, L, f % 2, mat)
        for x in (0, W - 1):            # the front corners and the veranda's end posts
            m.add("b1x2", WALL, x, 0, L, rot=90)
        if f > 1:                       # the ground-floor columns go in with the walls
            m.step()
        veranda(m, W, L, columns, ground=(f == 1))
        m.step()
        if f < floors:
            floor_band(m, W, D, L + 3)
        else:
            fill_rect(m, "p", WALL, 0, 0, W, D, L + 3, along="z")
        m.step()
    return storey_layer(floors) + 4


# --------------------------------------------------------------------------
# central block: verandas, a steep front gable and the cupola
# --------------------------------------------------------------------------
CEN_W, CEN_D, CEN_FLOORS = 12, 8, 5
CEN_COLS = (2, 4, 7, 9)              # veranda columns
CUPOLA = (5, 2)                      # front-left cell of the 2 x 2 cupola, on the gable ridge


def central_gable_wall(m, cells, layer):
    """The front gable: a window, the fan arch over it and a louvre at the top."""
    z = cells[0][1]
    xs = sorted(c[0] for c in cells)
    if z == 0 and len(xs) == 6:
        x0 = xs[0]
        m.add("b1x2", WALL, x0, z, layer)
        m.add("b1x2", WINDOW, x0 + 2, z, layer)
        m.add("b1x2", WALL, x0 + 4, z, layer)
        return
    if z == 0 and len(xs) == 4:
        m.add("arch1x4", WALL, xs[0], z, layer)
        return
    if z == 0 and len(xs) == 2:
        m.add("grille1x2", WALL, xs[0], z, layer)
        return
    for x, n in runs_x(cells):                # hidden inside the roof
        row(m, "b", ROOF, x, z, n, layer)


def build_central():
    m = Model("central.ldr", "Main building")
    W, D = CEN_W, CEN_D
    # the sides of the lower storeys are hidden behind the wings
    base = veranda_block(m, W, D, CEN_FLOORS, CEN_COLS, (2, 3, 5, 6), (2, 3, 8, 9),
                         blind=((0, WING_FLOORS), (W - 1, WING_FLOORS)))
    cx, cz = CUPOLA
    cup = {(cx + i, cz + j) for i in (0, 1) for j in (0, 1)}
    main = Roof(0, W, 0, D, base, "x", pitch=45, color=ROOF, hips=("start", "end"),
                priority=1, name="main roof")
    gable = Roof(1, W - 1, 0, 5, base, "z", pitch=45, color=ROOF, trim=TRIM,
                 trim_ends=("start",), wall=central_gable_wall, name="front gable")
    roofs(m, [main, gable], keep_open=cup)
    # the cupola: round windows, a white eave, a stepped red roof and the spire
    L = gable.layer(gable.K + 1)
    m.step("The cupola stands on the four open studs at the top of the gable.")
    m.add("tech1x2", WALL, cx, cz, L)
    m.add("tech1x2", WALL, cx, cz + 1, L)
    m.add("p2x2", WALL, cx, cz, L + 3)
    m.step()
    m.add("gfm_jumper", ROOF, cx, cz, L + 4)
    below = m.add("gfm_jumper", ROOF, cx, cz + 1, L + 4)
    m.step()
    # a third jumper across the two (half a stud off the grid), and the cone on its stud
    m.step("Lay the third 1×2 plate with one stud across the two below it; the cone goes "
           "on its stud.")
    y = -8 * (L + 5)
    top = m.add_raw("gfm_jumper", ROOF, (20 * cx + 20, y - PARTS["gfm_jumper"].bmax_y,
                                         20 * cz + 20), rot_matrix(90), attach_to=below)
    m.add_raw("cone1", ROOF, (20 * cx + 20, y - 8 - PARTS["cone1"].bmax_y, 20 * cz + 20),
              rot_matrix(0), attach_to=top)
    m.step()
    m.width, m.depth = W, D
    return m


# --------------------------------------------------------------------------
# wings: a hipped roof with a gable at the outer end and a dormer (mirror images)
# --------------------------------------------------------------------------
WING_W, WING_D, WING_FLOORS = 8, 8, 3
WING_COLS = (2, 5)
GABLE_W = 4


def build_wing(right):
    name = "wing_right.ldr" if right else "wing_left.ldr"
    m = Model(name, "Right wing" if right else "Left wing")
    W, D = WING_W, WING_D
    # the side against the main building is hidden: no windows there
    base = veranda_block(m, W, D, WING_FLOORS, WING_COLS, (2, 3, 5, 6), (3, 4),
                         blind=((0 if right else W - 1, WING_FLOORS),))
    gx = W - GABLE_W if right else 0          # the gable at the outer end
    dx = 0 if right else W - 4                # the dormer next to the main building
    m.step("Two hidden red bricks hold up the back of the dormer.")
    for x in (dx + 1, dx + 2):
        m.add("b1x2", ROOF, x, 2, base, rot=90)
    m.step()
    roofs(m, [
        Roof(0, W, 0, D, base, "x", pitch=45, color=ROOF, hips=("start", "end"), priority=1,
             name="wing roof"),
        Roof(gx, gx + GABLE_W, 0, 4, base, "z", pitch=45, color=ROOF, trim=TRIM,
             trim_ends=("start",), wall=WALL, name="gable"),
        Roof(dx, dx + 4, 1, 4, base + 3, "z", pitch=45, color=ROOF, trim=TRIM,
             trim_ends=("start",), wall=WALL, wall_ends=("start",), name="dormer"),
    ])
    m.width, m.depth = W, D
    return m


# --------------------------------------------------------------------------
# porte-cochere: columns, the entrance arch, a deck and a red roof with a gable
# --------------------------------------------------------------------------
PC_W, PC_D = 10, 6
PC_POSTS = [(0, 0), (PC_W - 1, 0), (0, PC_D - 1), (PC_W - 1, PC_D - 1)]
PC_ARCH = 3                          # the arch spans x 3..6 at the front
PC_FEET = PC_POSTS + [(PC_ARCH, 0), (PC_ARCH + 3, 0)]


def build_porte():
    m = Model("porte.ldr", "Porte-cochere")
    W, D = PC_W, PC_D
    for x, z in PC_FEET:
        m.add("p1x1", PAVING, x, z, 0)
    m.step()
    for x, z in PC_POSTS:
        m.add("round1", WALL, x, z, 1)
        m.add("round1", WALL, x, z, 4)
    for x in (PC_ARCH, PC_ARCH + 3):
        m.add("b1x1", WALL, x, 0, 1)
    m.step()
    m.step("The arch stands on the two white bricks.")
    m.add("arch1x4", WALL, PC_ARCH, 0, 4)
    m.step()
    fill_rect(m, "p", WALL, 0, 0, W, D, 7, along="x")
    m.step()

    def gable_wall(mm, cells, layer):
        xs = sorted(c[0] for c in cells)
        if len(xs) == 2 and cells[0][1] == 0:
            mm.add("tech1x2", WALL, xs[0], 0, layer)          # a round window
        else:
            for x, n in runs_x(cells):
                row(mm, "b", WALL, x, cells[0][1], n, layer)
    roofs(m, [
        Roof(0, W, 0, D, 8, "x", pitch=45, color=ROOF, hips=("start", "end"), priority=1,
             name="porte roof"),
        Roof(2, 8, 0, 4, 8, "z", pitch=45, color=ROOF, trim=TRIM, trim_ends=("start",),
             wall=gable_wall, name="porte gable"),
    ])
    m.width, m.depth = W, D
    return m


# --------------------------------------------------------------------------
# the fountain: a round white basin and a jet on a white dome
# --------------------------------------------------------------------------
def add_fountain(m, x0, z0, layer):
    """Four round corner bricks on the base make the basin; a white dome in the
    middle carries the jet on its centre stud."""
    m.step("Four round corner bricks make the basin; the white dome goes in the middle.")
    for (x, z), r in (((0, 0), 90), ((2, 0), 0), ((2, 2), 270), ((0, 2), 180)):
        m.add("macaroni", WALL, x0 + x, z0 + z, layer, rot=r)
    dome = m.add("dish2", WALL, x0 + 1, z0 + 1, layer)
    m.step()
    m.step("The clear blue round brick sits on the dome's centre stud.")
    y = -8 * (layer + PARTS["dish2"].height)
    cx, cz = 20 * (x0 + 2), 20 * (z0 + 2)
    m.add_raw("round1", WATER, (cx, y - PARTS["round1"].bmax_y, cz), rot_matrix(0),
              attach_to=dome)
    m.step()


# --------------------------------------------------------------------------
# main model
# --------------------------------------------------------------------------
CX, CZ = 10, 14
WINGS = ((2, 15), (22, 15))
PX, PZ = 11, 8
DRIVE_Z = range(8, 13)
WALK = (14, 15, 16, 17)
FOUNTAIN = (14, 3)
PALMS = ((4, 5), (27, 5))


def rect(x0, z0, w, d):
    return {(x, z) for x in range(x0, x0 + w) for z in range(z0, z0 + d)}


def ground_colour(x, z):
    if z in DRIVE_Z or (CX <= x < CX + CEN_W and PZ <= z < CZ):
        return PAVING
    if x in WALK and z < PZ:
        return PAVING
    return GREEN


def build_main(central, wings, porte, tree):
    m = Model("grand_floridian_midsize.ldr", "Grand Floridian Resort (mid-size)")
    m.header_notes = ["Mid-size resort collection; generated by design.py (lego-kit)."]
    m.section("The display base", "The base and the black band are the same for every "
              "mid-size kit. The drive, the walk and the lawns go on next; the drive tiles "
              "tie the base plates together.")
    band = display_base(m, SIZE)
    reserved = set(band)
    reserved |= rect(CX, CZ, CEN_W, CEN_D)
    for (wx, wz) in WINGS:
        reserved |= rect(wx, wz, WING_W, WING_D)
    reserved |= {(PX + x, PZ + z) for x, z in PC_FEET}
    reserved |= rect(*FOUNTAIN, 4, 4)
    finish_ground(m, reserved, GREEN, colour_at=ground_colour, size=SIZE)
    m.step()
    m.sub(central, CX, CZ, 1)
    m.step()
    for w, (wx, wz) in zip(wings, WINGS):
        m.sub(w, wx, wz, 1)
        m.step()
    m.sub(porte, PX, PZ, 1)
    m.step()
    m.section("The fountain and the palms", "A round fountain on the walk and two palms "
              "on the lawn finish the garden.")
    add_fountain(m, *FOUNTAIN, 1)
    for px, pz in PALMS:
        m.sub(tree, px, pz, 2)                 # on the lawn plates
    m.step()
    return m


def build():
    saved = dict(bricks.ALLOWED)
    # Bestseller sizes (checked with avail.py), trimmed to the lines this kit already uses
    bricks.ALLOWED[("b", BLACK)] = bricks._sizes("1x1 1x2 1x6 1x8")
    bricks.ALLOWED[("t", RED)] = bricks._sizes("1x2 2x2")
    try:
        return _build()
    finally:
        bricks.ALLOWED.clear()
        bricks.ALLOWED.update(saved)


def _build():
    central = build_central()
    wings = [build_wing(False), build_wing(True)]
    porte = build_porte()
    tree = palm(trunk=5)
    main_m = build_main(central, wings, porte, tree)
    return main_m, [main_m, central] + wings + [porte, tree]
