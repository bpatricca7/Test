"""Beach Club Resort, compact display kit (resort collection).

Build with the shared kit:  ./build.sh

The compact format (lego-kit/compact.py): a 24 x 16 base with a black front
band; one storey = 4 plates (a course of bricks and a plate band), 1 stud is about 2 m.

Grid (studs): x to the right, z toward the back; the front band is z = 0..1.
  centre       x  8..15, z 7..14   four storeys, striped entrance awning, hipped roof, spire
  wings        x  4..7 and 16..19, z 7..14   two storeys, veranda with railing (build 2)
  turrets      x  1..3 and 20..22, z 8..10   four storeys, pointed caps (build 2)
  beach        the lake along the front (z = 2..3), sand behind it, a palm and two umbrellas
"""
import bricks
from bricks import Model, PARTS, FACE, rot_matrix, row, fill_rect, place_rect, \
    WHITE, BLACK, LBG, BLUE, TAN, PINK
from walls import WallRing
from roofs import Roof, build_roofs
from compact import compact_project, display_base, finish_ground, palm

SAND_GREEN = 378
WALL, TRIM, WINDOW, ROOF, PLINTH, ACCENT = SAND_GREEN, WHITE, BLACK, LBG, LBG, PINK
SAND, WATER = TAN, BLUE

# Bestseller sizes in this kit's own colours (checked with avail.py)
bricks.ALLOWED[("b", SAND_GREEN)] = bricks._sizes("1x1 1x2 1x4 1x6")
bricks.ALLOWED[("b", PINK)] = bricks._sizes("1x1 1x2 1x4")

PROJECT = compact_project(
    slug="beach_club",
    title="Beach Club Resort",
    resort="Disney's Beach Club Resort",
    category="Deluxe",
    merged=["Disney's Beach Club Villas"],
    about=("The Beach Club as a seaside Victorian beach cottage: pale sea-green clapboard with "
           "crisp white trim, a taller centre with a pink-and-white striped entrance awning, a "
           "light grey hipped roof and a white spire, two low wings with white verandas and "
           "railings, and a turret with a pointed cap at each end, on a sandy beach by the lake "
           "with beach umbrellas and a palm."),
    features=["Pale sea-green clapboard walls (sand green) with crisp white floor bands and "
              "eaves",
              "Two turrets with pointed light grey caps and white finials",
              "A taller centre with a light grey hipped roof and a white spire",
              "White verandas with columns and railings along the wings",
              "A pink-and-white striped awning over a pink front door",
              "A sandy beach on the lake with pink-topped umbrellas and a palm"],
    omitted=["The long guest wings and the Yacht Club next door",
             "Stormalong Bay, the croquet lawn and the boardwalk",
             "The gingerbread trim and window frames (shown as plain rows of windows)"],
    colour_rows=[("Sand Green", "Sand Green", "Sand Green"),
                 ("White", "White", "White"),
                 ("Light Bluish Gray", "Medium Stone Grey", "Light Bluish Gray"),
                 ("Bright Pink", "Light Purple", "Bright Pink"),
                 ("Black", "Black", "Black"), ("Tan", "Brick Yellow", "Tan"),
                 ("Blue", "Bright Blue", "Blue"), ("Green", "Dark Green", "Green"),
                 ("Reddish Brown", "Reddish Brown", "Reddish Brown")],
    organisation=["The display base, the beach and the lake", "The centre",
                  "The wings (build 2)", "The turrets (build 2)",
                  "The palm and the beach umbrellas"],
    sub_info={
        "centre.ldr": ("The centre",
                       "Four storeys of sea-green clapboard with a pink door under a striped "
                       "awning, a light grey hipped roof and a white spire."),
        "wing.ldr": ("The wings",
                     "Two identical two-storey wings with a white veranda and railing in front "
                     "and a light grey roof."),
        "turret.ldr": ("The turrets",
                       "Two slim four-storey turrets with a window on three sides and a "
                       "pointed cap of steep slopes round a white finial."),
        "palm.ldr": ("The palm", "A trunk of round bricks and two layers of fronds."),
        "umbrella.ldr": ("The beach umbrellas",
                         "A white pole, a white canopy and a pink top."),
    },
    legend=("umbrella.ldr", 1),
    tips=["Each storey is one course of sand green bricks with black bricks for the windows, "
          "then a band of white plates.",
          "Roofs go up one row of slopes at a time. The turret caps are four steep slopes laid "
          "round a white round brick, like the blades of a pinwheel.",
          "The spire on the centre and the umbrella canopies sit on a single centre stud.",
          "A <b>&ldquo;Build 2&rdquo;</b> badge means you build that module twice."],
    substitutions=["<b>Walls:</b> sand green is a Bestseller as 1&times;1, 1&times;2, "
                   "1&times;4 and 1&times;6 bricks only; keep to those sizes."],
    build_time="about 1 to 1&frac12; hours",
)

CEN_W, CEN_D, CEN_FLOORS = 8, 8, 4
WING_W, WING_D, WING_FLOORS = 4, 8, 2
TUR_FLOORS = 4
PORCH = 2                            # rows in front of the walls (z = 0..1 of each block)
CX, CZ = 8, 7
WINGS = ((4, 7), (16, 7))
TURRETS = ((1, 8), (20, 8))
PALMS = ((3, 4),)
UMBRELLAS = ((15, 4), (19, 5))
WATER_Z = (2, 3)


def band(m, w, z0, d, layer):
    """A ring of white plates on a storey: the front and back rows, then the sides."""
    if w <= 3:                                   # a turret: one solid layer
        fill_rect(m, "p", TRIM, 0, z0, w, d, layer, along="z")
        return
    for z in (z0, z0 + d - 1):
        row(m, "p", TRIM, 0, z, w, layer)
    for x in (0, w - 1):
        row(m, "p", TRIM, x, z0 + 1, d - 2, layer, axis="z")


def storeys(m, w, z0, d, floors, material):
    """Brick courses (WallRing) and white plate bands on a plinth already laid,
    for walls at x 0..w-1, z z0..z0+d-1. The top band is a solid white slab.
    Returns the roof base layer."""
    ring = WallRing([(0, z0), (w - 1, z0), (w - 1, z0 + d - 1), (0, z0 + d - 1)])
    for f in range(1, floors + 1):
        L = 1 + 4 * (f - 1)

        def mat(x, z, layer, f=f):
            c = material(x, z - z0, f)
            return None if c is None else ("b", c)
        ring.course(m, L, f % 2, mat)
        m.step()
        if f < floors:
            band(m, w, z0, d, L + 3)
        else:
            fill_rect(m, "p", TRIM, 0, z0, w, d, L + 3, along="z",
                      widths=[4] if w % 4 == 0 else None)
        m.step()
    return 1 + 4 * floors


def on_centre_stud(m, part, colour, below, cx, cz, layer):
    """A part on the centre stud of a 2x2 dome or a round brick, half a stud off the grid.
    ``layer`` is the top of ``below``; cx, cz the stud's corner in grid units."""
    y = -8 * layer
    return m.add_raw(part, colour, (20 * cx, y - PARTS[part].bmax_y, 20 * cz), rot_matrix(0),
                     attach_to=below)


def build_centre():
    m = Model("centre.ldr", "Centre")
    fill_rect(m, "p", PLINTH, 0, 0, CEN_W, CEN_D, 0, along="z", widths=[4])
    m.step()
    d = CEN_D - PORCH

    def material(x, z, f):
        if z == 0:                                       # the front
            if f == 1 and x in (3, 4):
                return ACCENT                            # the pink door
            return WINDOW if x in (1, 3, 4, 6) else WALL
        if z == d - 1:
            return WINDOW if x in (1, 3, 4, 6) else WALL
        if f > WING_FLOORS and z in (2, 3):              # sides above the wings
            return WINDOW
        return WALL
    m.step("The porch columns stand on the plinth on each side of the pink door.")
    for x in (2, 5):
        m.add("round1", TRIM, x, 0, 1)
    base = storeys(m, CEN_W, PORCH, d, CEN_FLOORS, material)
    # the striped awning: a white plate with pink tiles, on the columns
    m.step()
    place_rect(m, "p", TRIM, 2, 0, 4, 2, 4)
    m.step()
    for x in range(2, 6):
        m.add("t1x2", ACCENT if x % 2 == 0 else TRIM, x, 0, 5, rot=90)
    m.step()
    spire = {(3, 4), (4, 4), (3, 5), (4, 5)}
    roof = Roof(0, CEN_W, PORCH, CEN_D, base, "x", pitch=45, color=ROOF,
                hips=("start", "end"), name="centre roof")
    build_roofs(m, [roof], fill_color=WALL, keep_open=spire, support_caps=True)
    # the spire: a white eave, a grey dome, a white lantern and a white point
    L = roof.layer(roof.K + 1)
    m.add("round_p2", TRIM, 3, 4, L)
    dome = m.add("dish2", ROOF, 3, 4, L + 1)
    m.step()
    lantern = on_centre_stud(m, "round1", TRIM, dome, 4, 5, L + 2)
    on_centre_stud(m, "cone1", TRIM, lantern, 4, 5, L + 5)
    m.step()
    m.width, m.depth = CEN_W, CEN_D
    return m


def build_wing():
    m = Model("wing.ldr", "Wing (build 2)")
    fill_rect(m, "p", PLINTH, 0, 0, WING_W, WING_D, 0, along="z")
    m.step()
    d = WING_D - PORCH

    def material(x, z, f):
        if z in (0, d - 1):
            return WINDOW if x in (1, 2) else WALL
        return WINDOW if z in (2, 3) else WALL
    m.step("The veranda columns stand at the front corners of the plinth.")
    for x in (0, WING_W - 1):
        m.add("round1", TRIM, x, 0, 1)
    base = storeys(m, WING_W, PORCH, d, WING_FLOORS, material)
    # the veranda roof and its railing
    m.step()
    place_rect(m, "p", TRIM, 0, 0, WING_W, 2, 4)
    m.step()
    m.add("fence1x4", TRIM, 0, 0, 5)
    m.step()
    build_roofs(m, [Roof(0, WING_W, PORCH, WING_D, base, "x", pitch=45, color=ROOF, wall=WALL,
                         name="wing roof")],
                fill_color=WALL, support_caps=True)
    m.width, m.depth = WING_W, WING_D
    return m


def build_turret():
    """A 3 x 3 turret: a window on three sides of every storey, and a pointed cap
    of four slopes laid in a pinwheel round a white spire."""
    m = Model("turret.ldr", "Turret (build 2)")
    fill_rect(m, "p", TRIM, 0, 0, 3, 3, 0, along="z")
    m.step()

    def material(x, z, f):
        if (x, z) in ((1, 0), (0, 1), (2, 1)):
            return WINDOW
        return WALL
    top = storeys(m, 3, 0, 3, TUR_FLOORS, material)
    for (x, z), face in (((0, 0), "front"), ((1, 0), "right"), ((2, 1), "back"),
                         ((0, 2), "left")):
        m.add("slope65", ROOF, x, z, top, rot=FACE[face])
    m.add("round1", TRIM, 1, 1, top)
    m.step()
    for (x, z), face in (((0, 1), "left"), ((1, 0), "front"), ((2, 1), "right"),
                         ((1, 2), "back")):
        m.add("cheese", ROOF, x, z, top + 6, rot=FACE[face])
    m.add("round1", TRIM, 1, 1, top + 3)
    m.step()
    m.add("cone1", TRIM, 1, 1, top + 6)
    m.step()
    m.width, m.depth = 3, 3
    return m


def build_umbrella():
    """A beach umbrella: a white pole, a white dome on its stud and a pink top."""
    m = Model("umbrella.ldr", "Beach umbrella (build 2)")
    m.add("round1", TRIM, 0, 0, 0)
    pole = m.add("round1", TRIM, 0, 0, 3)
    m.step()
    canopy = on_centre_stud(m, "dish2", TRIM, pole, 0.5, 0.5, 6)
    on_centre_stud(m, "round_p1", ACCENT, canopy, 0.5, 0.5, 6 + PARTS["dish2"].height)
    m.step()
    m.width, m.depth = 1, 1
    return m


def ground_colour(x, z):
    return WATER if z in WATER_Z else SAND


def build_main(centre, wing, turret, tree, umbrella):
    m = Model("beach_club_compact.ldr", "Beach Club Resort (compact)")
    m.header_notes = ["Compact resort collection; generated by design.py (lego-kit)."]
    m.section("The display base", "The base and the black band are the same for every kit in "
              "the collection. The beach and the lake go on next.")
    front = display_base(m)
    reserved = set(front)
    reserved |= {(CX + x, CZ + z) for x in range(CEN_W) for z in range(CEN_D)}
    for wx, wz in WINGS:
        reserved |= {(wx + x, wz + z) for x in range(WING_W) for z in range(WING_D)}
    for tx, tz in TURRETS:
        reserved |= {(tx + x, tz + z) for x in range(3) for z in range(3)}
    reserved |= set(PALMS) | set(UMBRELLAS)
    finish_ground(m, reserved, SAND, colour_at=ground_colour)
    m.step()
    m.sub(centre, CX, CZ, 1)
    m.step()
    for wx, wz in WINGS:
        m.sub(wing, wx, wz, 1)
    m.step()
    for tx, tz in TURRETS:
        m.sub(turret, tx, tz, 1)
    m.step()
    m.section("The palm and the beach umbrellas", "A palm at the water's edge and two "
              "beach umbrellas on the sand.")
    for px, pz in PALMS:
        m.sub(tree, px, pz, 1)
    m.step()
    for ux, uz in UMBRELLAS:
        m.sub(umbrella, ux, uz, 1)
    m.step()
    return m


def build():
    centre, wing, turret, tree = build_centre(), build_wing(), build_turret(), palm()
    umbrella = build_umbrella()
    main_m = build_main(centre, wing, turret, tree, umbrella)
    return main_m, [main_m, centre, wing, turret, tree, umbrella]
