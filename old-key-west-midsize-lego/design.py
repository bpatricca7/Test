"""Old Key West Resort, mid-size display kit (resort collection).

Build with the shared kit:  ./build.sh

The mid-size format (lego-kit/compact.py, size="midsize"): a 32 x 24 base with a
black front band; one storey = 4 plates (a course of bricks and a plate band),
1 stud is about 2 m, the same scale as the compact kit. It shows the arrival
front of the Hospitality House facing the band, centred and symmetric, with a
guest villa on each side, rather than a bigger copy of the compact kit: a steep
tin roof with a front gable, an entrance portico with the balcony on its roof, a
porch with its own tin roof wrapping round the sides, louvred gable ends.

Grid (studs): x to the right, z toward the back; the front band is z = 0..1.
The model is symmetric about x = 15.5 (only the villas' colours differ).
  Hospitality House  x 8..23, z 8..20   raised on a white lattice skirt; two storeys
                     of pale yellow walls with white corner boards (x 9..22, z 11..20);
                     a white porch across the front (z 10) and six studs along each
                     side (x 8 and 23), under a flat grey tin porch roof; the entrance
                     portico (x 13..18, z 8..10) with the balcony on its roof, in front
                     of the doors; a 45-degree light grey tin roof with white-trimmed
                     yellow gable ends and louvres, a front gable (x 12..19) with a
                     louvre, and the louvred cupola on the ridge; the roof is a module of
                     its own (roof.ldr), set on the upper walls
  villas             x 1..6 and 25..30, z 13..20   two storeys, aqua (left) and pink
                     (right): a white porch with posts and railings under a pastel
                     upper floor, a front-gabled tin roof with white trim
  front steps, walk  x 14..17: steps at z 6..7, the tan walk z 2..5 to the band, and
                     tan paths at z 4..5 to the villas (x 3..4 and 27..28)
  details            palms beside the house (7, 16), (24, 16) and behind the villas (3, 21),
                     (28, 21); lamp posts at the walk; flowering shrubs along the porch
                     and the villa paths
"""
import bricks
from bricks import (Model, PARTS, rot_matrix, row, fill_cells, place_rect,
                    _sizes, WHITE, BLACK, LBG, GREEN, RED, BRGREEN, TAN)
from roofs import Roof, build_roofs
from walls import WallRing
from compact import compact_project, display_base, finish_ground, palm

SIZE = "midsize"
YELLOW, AQUA, PINK = 226, 322, 29     # Bright Light Yellow, Medium Azure, Bright Pink
WALL, TRIM, ROOF, WINDOW, PLINTH, PATH = YELLOW, WHITE, LBG, BLACK, LBG, TAN
LAWN, IRON, STEPS = GREEN, BLACK, LBG

# Bestseller sizes for colours the toolkit has no entry for (checked with avail.py);
# set only while this design builds, so other kits are unaffected
EXTRA_ALLOWED = {
    ("b", AQUA): _sizes("1x1 1x2 1x4"),
    ("b", PINK): _sizes("1x1 1x2 1x4"),
    # light bluish gray: the toolkit's list, less the 1 x 12 plate (not a Bestseller)
    ("p", LBG): _sizes("1x1 1x2 1x3 1x4 1x6 1x8 1x10 2x2 2x3 2x4 2x6 2x8 2x10 2x12 "
                       "4x4 4x6 4x8 4x10 4x12 6x6 6x8 6x10 6x12"),
    ("t", WHITE): _sizes("1x1 1x2 1x3 1x4 1x6 1x8 2x2"),
    # light bluish gray bricks: the 1 x 1 and 1 x 4 only (foundation and hidden supports)
    ("b", LBG): _sizes("1x1 1x4"),
}

PROJECT = compact_project(
    size=SIZE,
    slug="old_key_west",
    title="Old Key West Resort",
    resort="Disney's Old Key West Resort",
    category="Deluxe Villas (DVC)",
    merged=[],
    about=("The arrival front of Old Key West, facing the viewer: the Hospitality House as a "
           "big Key West house in pale yellow with white corner boards, raised on a white "
           "lattice skirt. A white porch with posts and railings wraps round the front and "
           "sides under a flat tin porch roof, and the entrance portico carries the balcony "
           "over the front door. Above them rise a steep light grey tin roof with white-trimmed "
           "gable ends, a front gable with a louvre and the louvred cupola on the ridge. Front "
           "steps and a sandy walk lead up from the street between lamp posts and flowering "
           "shrubs, and a smaller guest villa stands a little back on each side, one aqua and "
           "one pink, with white porches and front-gabled tin roofs, among palms."),
    features=["The Hospitality House's entrance front, centred and symmetric: two storeys of "
              "pale yellow walls with white corner boards on a white lattice skirt",
              "A white porch with posts and railings across the front and six studs down each "
              "side, under a flat grey tin porch roof",
              "The entrance portico in front of the doors, with the balcony over the front "
              "door on its roof",
              "A steep light grey tin roof: yellow gable ends with white trim and louvres, a "
              "front gable with a louvre, and the louvred cupola on the ridge",
              "Front steps and a sandy walk up to the porch, between lamp posts and flowering "
              "shrubs, with paths to the villas",
              "Two guest villas set a little back on each side, in aqua and pink, with white "
              "porches under front-gabled tin roofs",
              "Four palms beside and behind the villas"],
    omitted=["The other villa buildings, the marina, the pools and the golf course",
             "The shutters and the clapboard siding (shown as plain walls)",
             "The back of the Hospitality House (the restaurant and the pool deck)"],
    colour_rows=[("Bright Light Yellow", "Cool Yellow", "Bright Light Yellow"),
                 ("White", "White", "White"),
                 ("Light Bluish Gray", "Medium Stone Grey", "Light Bluish Gray"),
                 ("Medium Azure", "Medium Azur", "Medium Azure"),
                 ("Bright Pink", "Light Purple", "Bright Pink"),
                 ("Black", "Black", "Black"), ("Tan", "Brick Yellow", "Tan"),
                 ("Green", "Dark Green", "Green"),
                 ("Bright Green", "Bright Green", "Bright Green"),
                 ("Red", "Bright Red", "Red"),
                 ("Reddish Brown", "Reddish Brown", "Reddish Brown"),
                 ("Dark Bluish Gray", "Dark Stone Grey", "Dark Bluish Gray")],
    organisation=["The display base, the walk and the lawns", "The Hospitality House",
                  "The tin roof and the cupola", "The aqua villa", "The pink villa",
                  "The steps, the palms, the lamp posts and the shrubs"],
    sub_info={
        "house.ldr": ("The Hospitality House",
                      "A grey foundation behind the white lattice skirt, then two yellow "
                      "storeys with the white porch, its grey tin roof, the portico and the "
                      "balcony over the front door."),
        "roof.ldr": ("The tin roof and the cupola",
                     "The roof is built on its own, on a white eave band: steep grey slopes "
                     "with yellow gable ends, white trim and louvres, the front gable, then "
                     "the louvred cupola on the ridge. It goes on top of the house."),
        "villa_aqua.ldr": ("The aqua villa",
                           "A white porch with posts and railings under an aqua upper floor, "
                           "then a front-gabled tin roof with white trim."),
        "villa_pink.ldr": ("The pink villa",
                           "The same villa as the aqua one, built in pink."),
        "palm.ldr": ("The palms", "A trunk of round bricks and two layers of fronds."),
        "lamp.ldr": ("The lamp posts", "A black post with a white globe."),
        "shrub.ldr": ("The shrubs", "Two leafy round plates and a red flower."),
    },
    legend=("palm.ldr", 1),
    tips=["Each storey is one course of bricks (yellow, aqua or pink, with black bricks for "
          "the windows and white ones at the corners), then a layer of white plates. Keep the "
          "colours in separate trays.",
          "The porch railings are round 1&times;1 plates with tiles on top, between posts of "
          "round 1&times;1 bricks. The grey tiles on the porch ceiling are the porch roof.",
          "The tin roof is a module of its own: build it on the table, then set it on the "
          "upper walls. It goes up one row of slopes at a time; hidden grey bricks under the "
          "upper rows have a step of their own, just before the slopes that rest on them.",
          "The two villas are the same build in two colours."],
    substitutions=["<b>Villa colours:</b> each villa uses aqua or pink 1&times;1, 1&times;2 and "
                   "1&times;4 bricks only, so any pastel with those three bricks works.",
                   "<b>Walls:</b> the bright light yellow bricks are 1&times;1, 1&times;2 and "
                   "1&times;4 only; the 1&times;3 isn't a Bestseller in this colour."],
    build_time="about 2 to 2&frac12; hours",
)


# --------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------
def rect(x0, z0, w, d):
    return {(x, z) for x in range(x0, x0 + w) for z in range(z0, z0 + d)}


def railing(m, posts, rail, L):
    """White posts (round bricks) and a railing: round plates under a tile handrail."""
    for x, z in sorted(posts):
        m.add("round1", TRIM, x, z, L)
    for x, z in sorted(rail):
        m.add("round_p1", TRIM, x, z, L)
    m.step()
    tile_runs(m, rail, L + 1)


def tile_runs(m, cells, layer, colour=TRIM):
    """Tile runs over a set of cells: along x where the cells run along x."""
    cells = set(cells)
    done = set()
    for c in sorted(cells, key=lambda c: (c[1], c[0])):
        if c in done:
            continue
        x, z = c
        n = 1
        while (x + n, z) in cells and (x + n, z) not in done:
            n += 1
        if n > 1:
            row(m, "t", colour, x, z, n, layer, axis="x")
            done |= {(x + i, z) for i in range(n)}
            continue
        while (x, z + n) in cells and (x, z + n) not in done:
            n += 1
        row(m, "t", colour, x, z, n, layer, axis="z")
        done |= {(x, z + i) for i in range(n)}


# --------------------------------------------------------------------------
# the Hospitality House
# --------------------------------------------------------------------------
W, D = 16, 13                        # footprint, portico and porch included
PZ = 2                               # the porch row across the front
FZ = 3                               # the front wall (both storeys)
WRAP = 8                             # the porch wraps round the sides for z 2..7
PO = (5, 10)                         # the portico (x), z 0..2; its roof is the balcony
DOOR = (7, 8)
GABLE = (4, 12)                      # the front gable over x 4..11, on the front wall
CUPOLA = (7, 7)                      # front-left cell of the 2 x 2 cupola, on the ridge
BODY = [(1, FZ), (W - 2, FZ), (W - 2, D - 1), (1, D - 1)]
FRONT_WINDOWS = (3, 12)


def house_cells():
    return (rect(PO[0], 0, PO[1] - PO[0] + 1, PZ) | rect(0, PZ, W, WRAP - PZ)
            | rect(1, PZ, W - 2, D - PZ))


def porch_cells():
    """The porch round the front and sides, less the portico."""
    out = {(x, PZ) for x in range(W)} | {(x, z) for x in (0, W - 1) for z in range(PZ, WRAP)}
    return out - {(x, PZ) for x in range(PO[0], PO[1] + 1)}


def balcony_cells():
    """The railing round the balcony on the portico."""
    return ({(x, 0) for x in range(PO[0], PO[1] + 1)}
            | {(x, z) for x in PO for z in range(1, PZ + 1)})


def wall_material(floor):
    def mat(x, z, layer):
        if (x, z) in set(BODY):
            return ("b", TRIM)                      # white corner boards
        if z == FZ:
            return ("b", WINDOW if x in DOOR or x in FRONT_WINDOWS else WALL)
        if z == D - 1:
            return ("b", WINDOW if x in (3, 6, 9, 12) else WALL)
        return ("b", WINDOW if z in (5, 8, 11) else WALL)    # the side walls
    return mat


def front_gable_wall(m, cells, layer):
    """The front gable: yellow, with a white louvre at the top."""
    z = cells[0][1]
    xs = sorted(c[0] for c in cells)
    if z == FZ and len(xs) == 2:
        m.add("grille1x2", TRIM, xs[0], z, layer)
        return
    for x, n in runs(xs):
        row(m, "b", WALL, x, z, n, layer)


def side_gable_wall(m, cells, layer):
    """The gable ends of the main roof: yellow, with a white louvre at the top."""
    x = cells[0][0]
    zs = sorted(c[1] for c in cells)
    if len(zs) == 2:
        m.add("grille1x2", TRIM, x, zs[0], layer, rot=90)
        return
    for z, n in runs(zs):
        row(m, "b", WALL, x, z, n, layer, axis="z")


def runs(vals):
    out = []
    for v in vals:
        if out and out[-1][0] + out[-1][1] == v:
            out[-1] = (out[-1][0], out[-1][1] + 1)
        else:
            out.append((v, 1))
    return out


def slab(m, colour, layer):
    """The plinth and the porch deck: two 6 x 8 plates across the porch (they reach into
    the walls), the portico, and the back of the house in strips with staggered joints."""
    for x in (0, 8):
        place_rect(m, "p", colour, x, PZ, 8, WRAP - PZ, layer)
    place_rect(m, "p", colour, PO[0], 0, PO[1] - PO[0] + 1, PZ, layer)
    back(m, colour, layer, WRAP)


def back(m, colour, layer, z0):
    """Plates over x 1..14 from z0 to the back wall: 8 + 6 studs wide, 4-deep strips,
    then 1-wide rows."""
    z = z0
    while z < D:
        d = 4 if D - z >= 4 else 1
        place_rect(m, "p", colour, 1, z, 8, d, layer)
        place_rect(m, "p", colour, 9, z, W - 10, d, layer)
        z += d


def foundation(m, layer):
    """Grey bricks under the walls; each 1 x 4 spans a joint of the plinth below."""
    z0, z1 = FZ, D - 1
    for x in (1, W - 2):
        m.add("b1x1", PLINTH, x, z0, layer)
        m.add("b1x1", PLINTH, x, z0 + 1, layer)
        m.add("b1x4", PLINTH, x, z0 + 2, layer, rot=90)
        m.add("b1x4", PLINTH, x, z0 + 6, layer, rot=90)
    for z in (z0, z1):
        for x in (2, 6, 10):
            m.add("b1x4", PLINTH, x, z, layer)


def ceiling(m, layer):
    """The white porch ceiling and floor band: a 6 x 8 plate from the front of the
    portico into the house ties the portico in; plates over the side porches."""
    place_rect(m, "p", TRIM, PO[0], 0, PO[1] - PO[0] + 1, WRAP, layer)
    for x0, x1 in ((0, PO[0]), (PO[1] + 1, W)):
        inner = (x0 + 1, x1) if x0 == 0 else (x0, x1 - 1)
        place_rect(m, "p", TRIM, inner[0], PZ, inner[1] - inner[0], WRAP - PZ, layer)
        outer = 0 if x0 == 0 else W - 1
        place_rect(m, "p", TRIM, outer, PZ, 1, WRAP - PZ, layer)
    back(m, TRIM, layer, WRAP)


def eaves(m, layer):
    """The white top band under the roofs: 8 + 6 studs wide, 6 and 4 deep."""
    for z, d in ((FZ, 6), (FZ + 6, D - FZ - 6)):
        place_rect(m, "p", TRIM, 1, z, 8, d, layer)
        place_rect(m, "p", TRIM, 9, z, W - 10, d, layer)


def porch_roof(m, layer):
    """Grey tiles on the porch: a run along each side, then the front runs between."""
    for x in (0, W - 1):
        row(m, "t", ROOF, x, PZ, WRAP - PZ, layer, axis="z")
    for x0, x1 in ((1, PO[0]), (PO[1] + 1, W - 1)):
        row(m, "t", ROOF, x0, PZ, x1 - x0, layer)


def build_house():
    m = Model("house.ldr", "The Hospitality House")
    body = WallRing(BODY)
    # the plinth: strips across the porch, the portico and the back of the house; the
    # foundation bricks tie them together
    slab(m, PLINTH, 0)
    m.step()

    # the raised foundation: grey bricks under the walls, the white lattice skirt in front
    L = 1
    m.step("The white lattice skirt runs round the porch; the grey bricks behind it carry "
           "the walls.")
    foundation(m, L)
    m.add("fence1x4", TRIM, 1, PZ, L)
    m.add("fence1x4", TRIM, W - 5, PZ, L)
    m.add("fence1x4", TRIM, PO[0] + 1, 0, L)
    for x in (0, W - 1):
        m.add("fence1x4", TRIM, x, PZ + 1, L, rot=90)
        m.add("b1x1", TRIM, x, PZ, L)                    # the corner posts
        m.add("b1x1", TRIM, x, WRAP - 1, L)
    for x in PO:
        m.add("b1x3", TRIM, x, 0, L, rot=90)
    m.step()
    slab(m, PLINTH, L + 3)                   # the porch deck, laid like the plinth
    m.step()

    # ground floor: yellow walls behind the porch and the portico
    L = 5
    body.course(m, L, 1, wall_material(1))
    m.step()
    posts = ({(x, PZ) for x in (0, PO[0], PO[1], W - 1)} | {(x, WRAP - 1) for x in (0, W - 1)}
             | {(x, 0) for x in PO})
    rail = (porch_cells() - posts) | {(x, 1) for x in PO}
    railing(m, posts, rail, L)
    fill_cells(m, "t", PLINTH, rect(PO[0] + 1, 0, PO[1] - PO[0] - 1, FZ), L)   # the floor
    m.step()
    ceiling(m, L + 3)
    m.step()

    # upper floor; the porch roof in front, the balcony on the portico
    L = 9
    body.course(m, L, 0, wall_material(2))
    m.step()
    m.step("The grey tiles are the porch roof. The balcony over the front door has a white "
           "railing all round.")
    porch_roof(m, L)
    railing(m, set(), balcony_cells(), L)
    fill_cells(m, "t", ROOF, rect(PO[0] + 1, 1, PO[1] - PO[0] - 1, PZ), L)
    m.step()
    m.width, m.depth = W, D
    return m


ROOF_LAYER = 12                      # the roof stands on the upper walls (house layer 12)


def build_roof():
    """The tin roof as a module of its own: the white eave band, the roofs with their
    yellow gable ends and the front gable, then the cupola. It goes on the upper walls."""
    m = Model("roof.ldr", "The tin roof and the cupola")
    eaves(m, 0)
    m.step()
    base = 1
    m.step("The tin roof goes up one row of slopes at a time. The white slopes at the gable "
           "ends are the trim; grey bricks hidden inside the roof hold up the rows above.")
    cx, cz = CUPOLA
    cup = rect(cx, cz, 2, 2)
    main = Roof(1, W - 1, FZ, D, base, "x", pitch=45, color=ROOF, trim=TRIM,
                trim_ends=("start", "end"), wall=side_gable_wall, priority=1,
                widths=(4, 2, 1), name="tin roof")
    gable = Roof(GABLE[0], GABLE[1], FZ, cz + 2, base, "z", pitch=45, color=ROOF, trim=TRIM,
                 trim_ends=("start",), wall=front_gable_wall, widths=(4, 2, 1),
                 name="front gable")
    build_roofs(m, [main, gable], fill_color=ROOF, keep_open=cup, support_caps=True)
    top = main.layer(main.K + 1)
    m.step("The cupola stands on the four open studs on the ridge.")
    m.add("p2x2", TRIM, cx, cz, top)
    m.add("grille1x2", TRIM, cx, cz, top + 1)            # louvres front and back
    m.add("grille1x2", TRIM, cx, cz + 1, top + 1, rot=180)
    m.add("p2x2", TRIM, cx, cz, top + 4)
    m.step()
    for (dx, dz), face in (((0, 0), 0), ((1, 0), 270), ((1, 1), 180), ((0, 1), 90)):
        m.add("cheese", ROOF, cx + dx, cz + dz, top + 5, rot=face)
    m.step()
    m.width, m.depth = W, D
    return m


# --------------------------------------------------------------------------
# guest villas: a white porch under a pastel upper floor, a front-gabled tin roof
# --------------------------------------------------------------------------
VW, VD = 6, 8
V_GROUND = [(0, 1), (VW - 1, 1), (VW - 1, VD - 1), (0, VD - 1)]
V_UPPER = [(0, 0), (VW - 1, 0), (VW - 1, VD - 1), (0, VD - 1)]


def villa_material(colour, floor):
    """The front wall: the door behind the porch, two windows above it."""
    front, openings = (1, (2, 3)) if floor == 1 else (0, (1, 4))

    def mat(x, z, layer):
        if z == front:
            return ("b", WINDOW if x in openings else colour)
        if z == VD - 1:
            return ("b", WINDOW if x in (2, 3) else colour)
        return ("b", WINDOW if z in (3, 5) else colour)
    return mat


def villa_gable_wall(colour):
    def wall(m, cells, layer):
        for c in cells:
            m.add("b1x1", colour, c[0], c[1], layer)
    return wall


def build_villa(colour, name, title):
    m = Model(name, title)
    place_rect(m, "p", PLINTH, 0, 0, VW, VD, 0)
    m.step()
    WallRing(V_GROUND).course(m, 1, 1, villa_material(colour, 1))
    m.step()
    railing(m, {(0, 0), (VW - 1, 0)}, {(1, 0), (VW - 2, 0)}, 1)
    m.step()
    place_rect(m, "p", TRIM, 0, 0, VW, VD, 4)
    m.step()
    WallRing(V_UPPER).course(m, 5, 0, villa_material(colour, 2))
    m.step()
    place_rect(m, "p", TRIM, 0, 0, VW, VD, 8)
    m.step()
    roof = Roof(0, VW, 0, VD, 9, "z", pitch=45, color=ROOF, trim=TRIM, trim_ends=("start",),
                wall=villa_gable_wall(colour), hips=("end",), name="villa roof")
    build_roofs(m, [roof], fill_color=ROOF, support_caps=True)
    m.width, m.depth = VW, VD
    return m


# --------------------------------------------------------------------------
# details
# --------------------------------------------------------------------------
def build_lamp():
    """A black foot, a black 4L bar for the post and a white globe slid down over its top."""
    m = Model("lamp.ldr", "Lamp post")
    foot = m.add("round_p1", IRON, 0, 0, 0)
    m.step()
    c = 10
    bar_y = -8 + 4 - 80
    bar = m.add_raw("bar4", IRON, (c, bar_y, c), rot_matrix(0), attach_to=foot)
    globe_y = bar_y + 24 - PARTS["round1"].bmax_y
    m.add_raw("round1", TRIM, (c, globe_y, c), rot_matrix(0), attach_to=bar)
    m.step()
    m.width, m.depth = 1, 1
    return m


def build_shrub():
    """A flowering tropical shrub: two leafy round plates and a red flower."""
    m = Model("shrub.ldr", "Flowering shrub")
    m.add("leaves1", BRGREEN, 0, 0, 0, rot=0)
    m.add("leaves1", GREEN, 0, 0, 1, rot=180)
    m.add("flower1", RED, 0, 0, 2)
    m.step()
    m.width, m.depth = 1, 1
    return m


# --------------------------------------------------------------------------
# main model
# --------------------------------------------------------------------------
HX, HZ = 8, 8
VILLAS = ((1, 13), (25, 13))
WALK = range(HX + PO[0] + 1, HX + PO[1])        # x 14..17
# the palms' fronds reach 3.4 studs to the left of the trunk and 2.4 to the right, and
# 3.4 to the front: these stay over the base
PALMS = ((7, 16), (24, 16), (3, 21), (28, 21))
LAMPS = ((12, 3), (19, 3))
SEAM_PLATES = ((0, 14, 1, 4), (7, 13, 1, 4), (7, 17, 2, 4), (24, 13, 1, 4), (23, 17, 2, 4),
               (31, 14, 1, 4))
SHRUBS = ((9, 7), (11, 7), (20, 7), (22, 7), (2, 11), (5, 11), (26, 11), (29, 11))
SIDE_PATHS = ((3, 4), (27, 28))         # the paths to the villas (x), from the walk at z 4..5
PATH_Z = (4, 5)


def ground_colour(x, z):
    if x in WALK and z < HZ:
        return PATH
    for a, b in SIDE_PATHS:
        lo, hi = min(a, min(WALK)), max(b, max(WALK))
        if z in PATH_Z and lo <= x <= hi:
            return PATH
        if x in (a, b) and PATH_Z[0] <= z < VILLAS[0][1]:
            return PATH
    return LAWN


def paths_last(m, i0):
    """Split the ground laid since item i0 into two steps: the lawn, then the paths."""
    new = m.items[i0:]
    for it in new:
        if it.color != LAWN:
            it.step = m.step_no + 1
    m.items[i0:] = sorted(new, key=lambda it: it.step)
    m.step_no += 1
    m.step()


def build_main(house, roof, villas, tree, lamp, shrub):
    m = Model("old_key_west_midsize.ldr", "Old Key West Resort (mid-size)")
    m.header_notes = ["Mid-size resort collection; generated by design.py (lego-kit)."]
    m.section("The display base", "The base and the black band are the same for every "
              "mid-size kit. The walk and the lawns go on next.")
    band = display_base(m, SIZE)
    reserved = set(band)
    reserved |= {(HX + x, HZ + z) for x, z in house_cells()}
    for vx, vz in VILLAS:
        reserved |= rect(vx, vz, VW, VD)
    reserved |= {(x, z) for x in WALK for z in (HZ - 2, HZ - 1)}      # the steps
    # lawn plates across the seams of the back base plates, beside the buildings
    for x, z, w, d in SEAM_PLATES:
        place_rect(m, "p", LAWN, x, z, w, d, 1)
        reserved |= rect(x, z, w, d)
    i0 = len(m.items)
    finish_ground(m, reserved, LAWN, colour_at=ground_colour, size=SIZE)
    paths_last(m, i0)
    m.sub(house, HX, HZ, 1)
    m.step()
    m.sub(roof, HX, HZ, 1 + ROOF_LAYER)
    m.step()
    for v, (vx, vz) in zip(villas, VILLAS):
        m.sub(v, vx, vz, 1)
        m.step()
    m.section("The steps, the palms, the lamp posts and the shrubs",
              "Steps up to the porch, palms round the buildings, lamp posts at the walk and "
              "flowering shrubs along the porch.")
    x0 = min(WALK)
    n = len(WALK)
    m.step("The front steps: a grey brick and plates under each tile, the top step "
           "against the porch.")
    row(m, "b", STEPS, x0, HZ - 1, n, 1)
    row(m, "p", STEPS, x0, HZ - 2, n, 1)
    row(m, "p", STEPS, x0, HZ - 2, n, 2)
    m.step()
    row(m, "p", STEPS, x0, HZ - 1, n, 4)
    row(m, "t", STEPS, x0, HZ - 2, n, 3)
    row(m, "t", STEPS, x0, HZ - 1, n, 5)
    m.step()
    for px, pz in PALMS:
        m.sub(tree, px, pz, 2)
    m.step()
    for lx, lz in LAMPS:
        m.sub(lamp, lx, lz, 2)
    for sx, sz in SHRUBS:
        m.sub(shrub, sx, sz, 2)
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
    house, roof = build_house(), build_roof()
    villas = [build_villa(AQUA, "villa_aqua.ldr", "The aqua villa"),
              build_villa(PINK, "villa_pink.ldr", "The pink villa")]
    tree, lamp, shrub = palm(trunk=6), build_lamp(), build_shrub()
    main_m = build_main(house, roof, villas, tree, lamp, shrub)
    return main_m, [main_m, house, roof] + villas + [tree, lamp, shrub]
