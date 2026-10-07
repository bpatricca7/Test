"""Riviera Resort, compact display kit (resort collection).

Build with the shared kit:  ./build.sh

The compact format (lego-kit/compact.py): a 24 x 16 base with a black front
band; one storey = 4 plates (a course of bricks and a plate band), 1 stud is about 2 m.

Grid (studs): x to the right, z toward the back; the front band is z = 0..1.
  central pavilion  x  4..13, z 8..13   three storeys, grey mansard roof with oval dormers
  domed pavilion    x 14..19, z 6..11   six storeys, square grey dome and a lantern
  palms             (3, 5) and (21, 3)
  walk              x  8..9, z 2..7 to the door
"""
from bricks import (Model, PARTS, FACE, rot_matrix, fill_rect, fill_cells,
                    WHITE, BLACK, DBG, LBG, RED, GREEN, TAN)
from walls import WallRing
from compact import compact_project, display_base, finish_ground, palm

WALL, WINDOW, BAND, CORNICE, AWNING, ROOF, PLINTH = TAN, BLACK, TAN, WHITE, RED, DBG, LBG

PROJECT = compact_project(
    slug="riviera",
    title="Riviera Resort",
    resort="Disney's Riviera Resort",
    category="Deluxe Villas (DVC)",
    merged=[],
    about=("The heart of the Riviera: a cream European pavilion with tall windows and red "
           "awnings under a steep grey mansard roof set with oval dormers, and beside it the "
           "taller corner pavilion with its square grey dome and white lantern, with two "
           "palms on the lawn."),
    features=["Cream European central pavilion with rows of tall windows",
              "Steep grey mansard roof with four oval dormers",
              "The domed corner pavilion with its white lantern",
              "Red awnings over the top-floor windows",
              "Two palms on the lawn"],
    omitted=["The guest wings and the second domed pavilion",
             "The porte-cochere and the drive",
             "The gardens, terraces and pools"],
    colour_rows=[("Tan", "Brick Yellow", "Tan"),
                 ("Dark Bluish Gray", "Dark Stone Grey", "Dark Bluish Gray"),
                 ("White", "White", "White"), ("Red", "Bright Red", "Red"),
                 ("Black", "Black", "Black"),
                 ("Light Bluish Gray", "Medium Stone Grey", "Light Bluish Gray"),
                 ("Green", "Dark Green", "Green")],
    organisation=["The display base and the lawn", "The central pavilion",
                  "The domed pavilion", "The palms (build 2)"],
    sub_info={
        "central.ldr": ("The central pavilion",
                        "Three storeys of tall windows with red awnings on the top floor, "
                        "under a steep grey mansard roof with oval dormers."),
        "dome.ldr": ("The domed pavilion",
                     "The taller corner pavilion: six storeys, a square grey dome and a "
                     "white lantern on top."),
        "palm.ldr": ("The palms", "A trunk of round bricks and two layers of fronds."),
    },
    legend=("palm.ldr", 1),
    tips=["Each storey is one course of tan bricks with black bricks for the windows, then "
          "a band of tan plates. The top band is white, two plates deep. Keep black and tan "
          "in separate trays.",
          "The red awnings are 1&times;1 slopes set into the top band, right above the "
          "top-floor windows. Point them outward.",
          "The mansard and the dome are rings of steep grey slopes. The oval dormers are "
          "white bricks with a hole, stacked between them.",
          "A <b>&ldquo;Build 2&rdquo;</b> badge means you build that module twice."],
    build_time="about 1 to 1&frac12; hours",
)

CEN_W, CEN_D, CEN_FLOORS = 10, 6, 3
DOME_W, DOME_D, DOME_FLOORS = 6, 6, 6
CX, CZ = 4, 8                       # central pavilion corner on the base
DX, DZ = 14, 6                      # domed pavilion corner
PALMS = ((3, 5), (21, 3))
WALK = (8, 9)


def storey_layer(f):
    """Bottom layer of storey f's brick course (the plinth is layer 0)."""
    return 1 + 4 * (f - 1)


def walls(m, w, d, floors, material, awnings):
    """Plinth, storeys of tan bricks and tan bands; red awnings in a white top band.

    ``material(x, z, f)`` gives the colour of a wall cell. ``awnings`` maps the
    ring cells that get a red 1x1 slope over the top-floor window to the face
    it points to. Returns the layer on top of the roof slab.
    """
    fill_rect(m, "p", PLINTH, 0, 0, w, d, 0, along="x")
    m.step()
    ring = WallRing([(0, 0), (w - 1, 0), (w - 1, d - 1), (0, d - 1)])
    cells = {(x, z) for x in range(w) for z in range(d) if x in (0, w - 1) or z in (0, d - 1)}
    for f in range(1, floors + 1):
        L = storey_layer(f)
        ring.course(m, L, f % 2, lambda x, z, layer, f=f: ("b", material(x, z, f)))
        m.step()
        if f < floors:
            fill_cells(m, "p", BAND, cells, L + 3)
            m.step()
    # top floor: red awnings over the windows in a band two plates deep
    L = storey_layer(floors) + 3
    for (x, z), face in sorted(awnings.items()):
        m.add("cheese", AWNING, x, z, L, rot=FACE[face])
    rest = cells - set(awnings)
    fill_cells(m, "p", CORNICE, rest, L)
    m.step()
    fill_cells(m, "p", CORNICE, rest, L + 1)
    m.step()
    fill_rect(m, "p", CORNICE, 0, 0, w, d, L + 2, along="x")
    m.step()
    return L + 3


def build_central():
    m = Model("central.ldr", "Central pavilion")
    front = {1, 3, 6, 8}

    def mat(x, z, f):
        if z == 0 and f == 1:             # the door, with a window at each end
            return WINDOW if x in (1, 4, 5, 8) else WALL
        if z == 0 and x in front:
            return WINDOW
        if x in (0, CEN_W - 1) and z in (2, 3):
            return WINDOW
        return WALL
    awn = {(x, 0): "front" for x in front}
    awn.update({(0, z): "left" for z in (2, 3)})
    awn.update({(CEN_W - 1, z): "right" for z in (2, 3)})
    L = walls(m, CEN_W, CEN_D, CEN_FLOORS, mat, awn)
    # mansard: a ring of 75-degree slopes, with oval dormers on the front
    pattern = "SDSDSSDSDS"
    for x, c in enumerate(pattern):
        if c == "S":
            m.add("slope75", ROOF, x, 0, L, rot=FACE["front"])
        else:
            m.add("b1x2", ROOF, x, 0, L, rot=90)
    for x in range(CEN_W):
        m.add("slope75", ROOF, x, CEN_D - 2, L, rot=FACE["back"])
    for z in range(2, CEN_D - 2):
        m.add("slope75", ROOF, 0, z, L, rot=FACE["left"])
        m.add("slope75", ROOF, CEN_W - 2, z, L, rot=FACE["right"])
    m.step()
    for x, c in enumerate(pattern):
        if c == "D":
            m.add("tech1x1", WHITE, x, 0, L + 3)
            m.add("b1x1", ROOF, x, 1, L + 3)
    m.step()
    for x, c in enumerate(pattern):
        if c == "D":
            m.add("slope45", ROOF, x, 0, L + 6, rot=FACE["front"])
    m.step()
    # flat top of the mansard
    T = L + 9
    fill_rect(m, "p", ROOF, 1, 1, CEN_W - 2, CEN_D - 2, T, along="x")
    for x, z in ((0, 1), (CEN_W - 1, 1), (0, CEN_D - 2), (CEN_W - 1, CEN_D - 2)):
        m.add("t1x1", ROOF, x, z, T)
    m.step()
    fill_rect(m, "t", ROOF, 1, 1, CEN_W - 2, CEN_D - 2, T + 1, along="x")
    m.step()
    m.width, m.depth = CEN_W, CEN_D
    return m


def build_dome():
    m = Model("dome.ldr", "Domed pavilion")
    front = {1, 4}

    def mat(x, z, f):
        if z == 0 and x in front:
            return WINDOW
        if x in (0, DOME_W - 1) and z in (1, 4):
            return WINDOW
        return WALL
    awn = {(x, 0): "front" for x in front}
    awn.update({(DOME_W - 1, z): "right" for z in (1, 4)})
    awn.update({(0, z): "left" for z in (1, 4)})
    L = walls(m, DOME_W, DOME_D, DOME_FLOORS, mat, awn)
    # the square dome: a ring of 75-degree slopes and a 4x4 plate
    for x in range(DOME_W):
        m.add("slope75", ROOF, x, 0, L, rot=FACE["front"])
        m.add("slope75", ROOF, x, DOME_D - 2, L, rot=FACE["back"])
    for z in (2, 3):
        m.add("slope75", ROOF, 0, z, L, rot=FACE["left"])
        m.add("slope75", ROOF, DOME_W - 2, z, L, rot=FACE["right"])
    m.step()
    m.add("p4x4", ROOF, 1, 1, L + 9)
    for x, z in ((0, 1), (DOME_W - 1, 1), (0, DOME_D - 2), (DOME_W - 1, DOME_D - 2)):
        m.add("t1x1", ROOF, x, z, L + 9)
    m.step()
    # the rounded top of the dome: small slopes around the lantern
    for x in range(1, 5):
        m.add("cheese", ROOF, x, 1, L + 10, rot=FACE["front"])
        m.add("cheese", ROOF, x, 4, L + 10, rot=FACE["back"])
    for z in (2, 3):
        m.add("cheese", ROOF, 1, z, L + 10, rot=FACE["left"])
        m.add("cheese", ROOF, 4, z, L + 10, rot=FACE["right"])
    m.add("b2x2", ROOF, 2, 2, L + 10)
    m.step()
    # the lantern: four white columns, a grey cap and a finial
    for x, z in ((2, 2), (3, 2), (2, 3), (3, 3)):
        m.add("round1", WHITE, x, z, L + 13)
    cap = m.add("dish2", ROOF, 2, 2, L + 16)
    m.step()
    cx = cz = 20 * 3                     # the dish's centre stud, half a stud off the grid
    y = -8 * (L + 16 + PARTS["dish2"].height)
    m.add_raw("cone1", ROOF, (cx, y - PARTS["cone1"].bmax_y, cz), rot_matrix(0),
              attach_to=cap)
    m.step()
    m.width, m.depth = DOME_W, DOME_D
    return m


def build_main(central, dome, palm):
    m = Model("riviera_compact.ldr", "Riviera Resort (compact)")
    m.header_notes = ["Compact resort collection; generated by design.py (lego-kit)."]
    m.section("The display base", "The base and the black band are the same for every kit in "
              "the collection. The lawn and the walk to the door go on next.")
    band = display_base(m)
    reserved = set(band)
    reserved |= {(CX + x, CZ + z) for x in range(CEN_W) for z in range(CEN_D)}
    reserved |= {(DX + x, DZ + z) for x in range(DOME_W) for z in range(DOME_D)}
    reserved |= set(PALMS)
    finish_ground(m, reserved, GREEN,
                  colour_at=lambda x, z: TAN if x in WALK and z < CZ else GREEN)
    m.step()
    m.sub(central, CX, CZ, 1)
    m.step()
    m.sub(dome, DX, DZ, 1)
    m.step()
    for px, pz in PALMS:
        m.sub(palm, px, pz, 1)
    m.step()
    return m


def build():
    central, dome, tree = build_central(), build_dome(), palm()
    main_m = build_main(central, dome, tree)
    return main_m, [main_m, central, dome, tree]
