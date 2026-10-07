"""Grand Floridian Resort, compact display kit (resort collection).

Build with the shared kit:  ./build.sh

The compact format (lego-kit/compact.py): a 24 x 16 base with a black front
band; one storey = 4 plates (a course of bricks and a plate band), 1 stud is about 2 m.

Grid (studs): x to the right, z toward the back; the front band is z = 0..1.
  central block  x  7..16, z 7..14   four storeys, hipped red roof, front gable, cupola
  wings          x  1..6 and 17..22, z 8..13   three storeys, hipped roof, front gable
  palms          (4, 4) and (19, 4)
  walk           x 11..12, z 2..6 to the door
"""
from bricks import Model, WHITE, BLACK, LBG, RED, GREEN
from roofs import Roof, build_roofs
from compact import compact_project, display_base, finish_ground, block, palm

WALL, WINDOW, ROOF, TRIM, PLINTH = WHITE, BLACK, RED, WHITE, LBG

PROJECT = compact_project(
    slug="grand_floridian",
    title="Grand Floridian Resort",
    resort="Disney's Grand Floridian Resort & Spa",
    category="Deluxe",
    merged=["The Villas at Disney's Grand Floridian Resort"],
    about=("The main building of the Grand Floridian: a white Victorian block with rows of "
           "windows, a steep red hipped roof, a big front gable and the little cupola on the "
           "ridge, flanked by two lower wings with red gables, and two palms out front."),
    features=["White Victorian main building with a grid of windows",
              "Steep red hipped roofs with white-trimmed front gables",
              "The cupola with its red spire on the main roof",
              "Two palms by the entrance walk"],
    omitted=["The long guest wings and the outer buildings",
             "The porte-cochere, the marina and the gardens",
             "The veranda railings (shown as the window grid)"],
    colour_rows=[("White", "White", "White"), ("Red", "Bright Red", "Red"),
                 ("Black", "Black", "Black"), ("Light Bluish Gray", "Medium Stone Grey",
                                               "Light Bluish Gray"),
                 ("Green", "Dark Green", "Green")],
    organisation=["The display base and the lawn", "The main building",
                  "The wings (build 2)", "The palms (build 2)"],
    sub_info={
        "central.ldr": ("The main building",
                        "Four storeys of windows under a steep red roof with a white-trimmed "
                        "front gable and the cupola on the ridge."),
        "wing.ldr": ("The wings",
                     "Two identical three-storey wings with a red hipped roof and a front "
                     "gable each."),
        "palm.ldr": ("The palms", "A trunk of round bricks and two layers of fronds."),
    },
    legend=("palm.ldr", 1),
    tips=["Each storey is one course of white bricks with black bricks for the windows, then "
          "a band of white plates. Keep black and white in separate trays.",
          "Roofs go up one row of slopes at a time. A few red bricks hidden under the "
          "gables have a step of their own, just before the slopes that rest on them.",
          "A <b>&ldquo;Build 2&rdquo;</b> badge means you build that module twice."],
    build_time="about 1 to 1&frac12; hours",
)

CEN_W, CEN_D, CEN_FLOORS = 10, 8, 4
WING_W, WING_D, WING_FLOORS = 6, 6, 3
CX, CZ = 7, 7                       # central block corner on the base
WINGS = ((1, 8), (17, 8))
PALMS = ((4, 4), (19, 4))
WALK = (11, 12)


def build_central():
    m = Model("central.ldr", "Main building")
    side = {2, 5}

    def mat(x, z, f):
        if z == 0 and (x in {1, 2, 4, 5, 7, 8}):
            return WINDOW
        if x in (0, CEN_W - 1) and z in side:
            return WINDOW
        return WALL
    base = block(m, CEN_W, CEN_D, CEN_FLOORS, mat)
    spire = (4, 4)
    main = Roof(0, CEN_W, 0, CEN_D, base, "x", pitch=45, color=ROOF, hips=("start", "end"),
                priority=1, name="main roof")
    gable = Roof(2, 8, 0, 4, base, "z", pitch=45, color=ROOF, trim=TRIM, trim_ends=("start",),
                 wall=WALL, name="front gable")
    build_roofs(m, [main, gable], fill_color=ROOF, keep_open={spire}, support_caps=True)
    # the cupola: a white turret on the ridge with a red spire
    L = main.layer(main.K + 1)
    m.add("round1", WALL, *spire, L)
    m.add("round1", WALL, *spire, L + 3)
    m.step()
    m.add("cone1", ROOF, *spire, L + 6)
    m.step()
    m.width, m.depth = CEN_W, CEN_D
    return m


def build_wing():
    m = Model("wing.ldr", "Wing (build 2)")

    def mat(x, z, f):
        if z == 0 and x in {1, 4}:
            return WINDOW
        if x in (0, WING_W - 1) and z in {2, 3}:
            return WINDOW
        return WALL
    base = block(m, WING_W, WING_D, WING_FLOORS, mat)
    build_roofs(m, [
        Roof(0, WING_W, 0, WING_D, base, "x", pitch=45, color=ROOF, hips=("start", "end"),
             priority=1, name="wing roof"),
        Roof(1, 5, 0, 4, base, "z", pitch=45, color=ROOF, trim=TRIM, trim_ends=("start",),
             wall=WALL, name="wing gable"),
    ], fill_color=ROOF, support_caps=True)
    m.width, m.depth = WING_W, WING_D
    return m


def build_main(central, wing, palm):
    m = Model("grand_floridian_compact.ldr", "Grand Floridian Resort (compact)")
    m.header_notes = ["Compact resort collection; generated by design.py (lego-kit)."]
    m.section("The display base", "The base and the black band are the same for every kit in "
              "the collection. The lawn and the walk to the door go on next.")
    band = display_base(m)
    reserved = set(band)
    reserved |= {(CX + x, CZ + z) for x in range(CEN_W) for z in range(CEN_D)}
    for wx, wz in WINGS:
        reserved |= {(wx + x, wz + z) for x in range(WING_W) for z in range(WING_D)}
    reserved |= set(PALMS)
    finish_ground(m, reserved, GREEN,
                  colour_at=lambda x, z: LBG if x in WALK and z < CZ else GREEN)
    m.step()
    m.sub(central, CX, CZ, 1)
    m.step()
    for wx, wz in WINGS:
        m.sub(wing, wx, wz, 1)
    m.step()
    for px, pz in PALMS:
        m.sub(palm, px, pz, 1)
    m.step()
    return m


def build():
    central, wing, tree = build_central(), build_wing(), palm()
    main_m = build_main(central, wing, tree)
    return main_m, [main_m, central, wing, tree]
