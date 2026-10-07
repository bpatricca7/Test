"""Port Orleans Riverside, compact display kit (resort collection).

Build with the shared kit:  ./build.sh

The compact format (lego-kit/compact.py): a 24 x 16 base with a black front
band; one storey = 4 plates (a course of bricks and a plate band), 1 stud is about 2 m.

Grid (studs): x to the right, z toward the back; the front band is z = 0..1.
  mansion     x 6..21, z 6..13   two storeys behind a full-width porch of eight tall
                                 columns (z = 6), a white frieze, a grey hipped roof
                                 with three dormers and two brick chimneys
  magnolia    (3, 4)             trunk cell; the leaves spread about 3 studs around it
  walk        x 13..14, z 2..5 to the porch steps
"""
import bricks
from bricks import Model, row, fill_rect, fill_cells, WHITE, BLACK, LBG, DBG, GREEN, RBROWN
from roofs import Roof, build_roofs
from walls import WallRing
from compact import compact_project, display_base, finish_ground, storey_layer

# Plant Leaves 6 x 5 with its leaf-tip studs (the shared "leaves6x5" only lists the
# centre stud): the magnolia flowers sit on the tips.
bricks.P("leaves6x5t", "2417.dat", "Plant Leaves 6 x 5", cells=[(0, 0)], height=1)

WALL, WINDOW, ROOF, TRIM, PLINTH = WHITE, BLACK, DBG, WHITE, LBG
CHIMNEY, CAP = RBROWN, DBG
LEAF, FLOWER = GREEN, WHITE

PROJECT = compact_project(
    slug="port_orleans_riverside",
    title="Port Orleans Riverside",
    resort="Disney's Port Orleans Resort - Riverside",
    category="Moderate",
    merged=["Magnolia Bend", "Alligator Bayou"],
    about=("A Magnolia Bend mansion of Port Orleans Riverside: a white plantation-style house "
           "with a two-storey front porch behind a row of tall white columns, a grey hipped "
           "roof with dormers and brick chimneys, and a magnolia tree in bloom on the lawn."),
    features=["White plantation-style mansion with a full-width two-storey porch",
              "A row of eight tall white columns of stacked round bricks, with a balcony "
              "behind them and a white frieze above",
              "Grey hipped roof with white dormers and two brick chimneys",
              "A magnolia tree in bloom, with white flowers on its leaves"],
    omitted=["The other Magnolia Bend mansions and the Alligator Bayou lodges",
             "The Sassagoula River, the mill and the pool",
             "The balcony railings (shown as a white band)"],
    colour_rows=[("White", "White", "White"),
                 ("Light Bluish Gray", "Medium Stone Grey", "Light Bluish Gray"),
                 ("Black", "Black", "Black"),
                 ("Reddish Brown", "Reddish Brown", "Reddish Brown"),
                 ("Dark Bluish Gray", "Dark Stone Grey", "Dark Bluish Gray"),
                 ("Green", "Dark Green", "Green")],
    organisation=["The display base and the lawn", "The mansion", "The magnolia tree"],
    sub_info={
        "mansion.ldr": ("The mansion",
                        "Two white storeys behind a porch of tall columns, then the grey "
                        "hipped roof with its dormers and chimneys."),
        "magnolia.ldr": ("The magnolia tree",
                         "A short trunk, two tiers of leaves and white flowers on the leaf tips."),
    },
    legend=("magnolia.ldr", 1),
    tips=["Each storey is one course of white bricks with black bricks for the windows, then "
          "a band of white plates. The columns are white round bricks with a round plate "
          "between them, level with the balcony.",
          "The roof goes up one row of slopes at a time. The three dormers have a step of "
          "their own, between the second and third rows of slopes.",
          "Keep the white round tiles for the end: they are the magnolia's flowers."],
    build_time="about 1 to 1&frac12; hours",
)

MAN_W, MAN_D = 16, 8          # mansion with its porch
PORCH = 2                     # porch rows in front of the house wall (z = 0, 1)
COLUMNS = (0, 2, 4, 6, 9, 11, 13, 15)
MX, MZ = 6, 6                 # mansion corner on the base
TREES = ((3, 4),)
WALK = (13, 14)
CHIMNEYS = ((3, 3), (12, 3))  # 1x2 chimneys (along z) on the ridge, local to the mansion
FRIEZE = 1                    # plates of white frieze between the columns and the roof
DORMERS = (3, 7, 11)          # 2-wide dormers on the front slope (x of their left stud)
FLOWERS_LOW = ((-2, -2), (2, 0), (0, 3), (-1, 1), (1, -2), (-2, 0))   # leaf tips, lower tier
FLOWERS_HIGH = ((2, -1), (-2, 1), (0, 2), (2, 2), (-1, -1), (1, -2))   # leaf tips, top tier


def build_mansion():
    m = Model("mansion.ldr", "Mansion")
    w, d = MAN_W, MAN_D
    z0 = PORCH                                    # front wall of the house
    fill_rect(m, "p", PLINTH, 0, 0, w, d, 0, along="x")
    m.step()
    ring = WallRing([(0, z0), (w - 1, z0), (w - 1, d - 1), (0, d - 1)])
    ring_cells = {(x, z) for x in range(w) for z in range(z0, d)
                  if x in (0, w - 1) or z in (z0, d - 1)}
    front_windows = {x for x in range(w) if x not in COLUMNS}
    side_windows = {z0 + 2, z0 + 4}
    back_windows = {2, 5, 10, 13}

    def mat(x, z, layer):
        if z == z0:
            return ("b", WINDOW if x in front_windows else WALL)
        if x in (0, w - 1) and z in side_windows:
            return ("b", WINDOW)
        if z == d - 1 and x in back_windows:
            return ("b", WINDOW)
        return ("b", WALL)

    for f in (1, 2):
        L = storey_layer(f)
        ring.course(m, L, f % 2, mat)
        for x in COLUMNS:
            m.add("round1", WALL, x, 0, L)
        m.step()
        if f == 1:
            # floor band, with the balcony deck in front of the house wall
            for x in COLUMNS:
                m.add("round_p1", WALL, x, 0, L + 3)
            fill_cells(m, "p", WALL, ring_cells | {(x, 1) for x in range(w)}, L + 3)
            m.step()
            row(m, "t", WALL, 0, 1, w, L + 4)        # balcony railing
        else:
            fill_rect(m, "p", WALL, 0, 0, w, d, L + 3, along="x")
        m.step()
    # the frieze over the columns: a second ring of plates under the eaves
    if FRIEZE:
        fill_cells(m, "p", WALL, {(x, z) for x in range(w) for z in range(d)
                                  if x in (0, w - 1) or z in (0, d - 1)}, storey_layer(2) + 4)
        m.step()
    base = storey_layer(2) + 4 + FRIEZE
    main = Roof(0, w, 0, d, base, "x", pitch=45, color=ROOF, hips=("start", "end"),
                priority=1, name="main roof")
    chim = {(x, z + j) for x, z in CHIMNEYS for j in (0, 1)}
    build_roofs(m, [main], fill_color=ROOF, keep_open=chim, support_caps=True)
    add_dormers(m, DORMERS, base)
    top = main.layer(main.K + 1)
    for x, z in CHIMNEYS:
        m.add("b1x2", CHIMNEY, x, z, top, rot=90)
        m.add("b1x2", CHIMNEY, x, z, top + 3, rot=90)
        m.add("t1x2", CAP, x, z, top + 6, rot=90)
    m.step()
    m.width, m.depth = w, d
    return m


def add_dormers(m, x0s, base):
    """Small dormers in place of front slopes of the second roof course.

    Each 2 x 2 slope there is swapped for a white box with a dark window and a
    peaked top of two cheese slopes. The dormers get a step of their own, right
    after that course and before the next one, which rests on them.
    """
    L = base + 3
    old = []
    for x0 in x0s:
        hit = [it for it in m.items if getattr(it, "key", None) == "s45x2" and it.x == x0
               and it.z == 1 and it.layer == L and it.rot == 0]
        assert len(hit) == 1, f"no front slope at x = {x0}"
        old += hit
    s = old[0].step
    # open a new step after s: later steps move up by one
    for it in m.items:
        if it.step > s:
            it.step += 1
    m.step_notes = {(k + 1 if k > s else k): v for k, v in m.step_notes.items()}
    m.step_no += 1
    n = len(m.items)
    for x0 in x0s:
        m.add("b1x2", ROOF, x0, 2, base)              # hidden support under the back half
    for x0 in x0s:
        m.add("p2x2", WALL, x0, 1, L)
        for k in (1, 2):
            m.add("p1x2", WINDOW, x0, 1, L + k)
            m.add("p1x2", WALL, x0, 2, L + k)
        m.add("cheese", ROOF, x0, 1, L + 3, rot=90)
        m.add("cheese", ROOF, x0 + 1, 1, L + 3, rot=270)
    new = m.items[n:]
    del m.items[n:]
    for it in new:
        it.step = s + 1
    for it in old:
        m.items.remove(it)
    last = max(i for i, it in enumerate(m.items) if it.step <= s)
    m.items[last + 1:last + 1] = new
    m.step_notes[s + 1] = ("The dormers stand where three slopes were left out. A hidden grey "
                           "brick holds the back of each one.")


def build_magnolia():
    m = Model("magnolia.ldr", "Magnolia tree")
    for k in range(2):
        m.add("round1", RBROWN, 0, 0, 3 * k)
    m.step()
    m.add("leaves6x5t", LEAF, 0, 0, 6, rot=0)
    low = m.add("leaves6x5t", LEAF, 0, 0, 7, rot=180)
    m.add("round1", LEAF, 0, 0, 8)
    m.step()
    high = m.add("leaves6x5t", LEAF, 0, 0, 11, rot=90)
    m.add("leaves1", LEAF, 0, 0, 12, rot=45)
    m.step()
    # white flowers on the leaf tips and the top
    for tier, picks in ((low, FLOWERS_LOW), (high, FLOWERS_HIGH)):
        for x, z in picks:
            assert (x, z) in tier.studs, (x, z, tier.studs)
            m.add("tile_round1", FLOWER, x, z, tier.layer + 1)
    m.add("tile_round1", FLOWER, 0, 0, 13)
    m.step()
    m.width, m.depth = 1, 1
    return m


def build_main(mansion, magnolia):
    m = Model("port_orleans_riverside_compact.ldr", "Port Orleans Riverside (compact)")
    m.header_notes = ["Compact resort collection; generated by design.py (lego-kit)."]
    m.section("The display base", "The base and the black band are the same for every kit in "
              "the collection. The lawn and the walk to the porch go on next.")
    band = display_base(m)
    reserved = set(band)
    reserved |= {(MX + x, MZ + z) for x in range(MAN_W) for z in range(MAN_D)}
    reserved |= set(TREES)
    finish_ground(m, reserved, GREEN,
                  colour_at=lambda x, z: LBG if x in WALK and z < MZ else GREEN)
    m.step()
    m.sub(mansion, MX, MZ, 1)
    m.step()
    for tx, tz in TREES:
        m.sub(magnolia, tx, tz, 1)
    m.step()
    return m


def build():
    mansion, magnolia = build_mansion(), build_magnolia()
    main_m = build_main(mansion, magnolia)
    return main_m, [main_m, mansion, magnolia]
