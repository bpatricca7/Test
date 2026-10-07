"""Old Key West Resort, compact display kit (resort collection).

Build with the shared kit:  ./build.sh

The compact format (lego-kit/compact.py): a 24 x 16 base with a black front
band; one storey = 4 plates (a course of bricks and a plate band), 1 stud is about 2 m.

Grid (studs): x to the right, z toward the back; the front band is z = 0..1.
  Hospitality House  x 5..18, z 4..13   raised on a lattice skirt; two yellow storeys;
                     a white porch across the front and three studs round each side,
                     a balcony over the door; a gabled tin roof (33 degree slopes)
                     with white gable trim and a louvred cupola on the ridge
  front steps        x 11..12, z 2..3
  palm               (3, 3)
"""
import bricks
from bricks import Model, place_rect, WHITE, BLACK, LBG, GREEN
from walls import WallRing
from roofs import Roof, build_roofs
from compact import compact_project, display_base, finish_ground, palm

YELLOW = 226                        # Bright Light Yellow (LEGO "Cool Yellow")
WALL, TRIM, ROOF, WINDOW, PLINTH, PATH = YELLOW, WHITE, LBG, BLACK, LBG, LBG

PROJECT = compact_project(
    slug="old_key_west",
    title="Old Key West Resort",
    resort="Disney's Old Key West Resort",
    category="Deluxe Villas (DVC)",
    merged=[],
    about=("The Hospitality House of Old Key West: a two-storey Key West house in pale "
           "yellow with white corner boards, raised on a white lattice skirt. A white porch "
           "with posts and railings runs across the front and round the corners, with a "
           "balcony over the door; on top sit a light grey tin roof with white gable trim "
           "and a louvred cupola, and a palm stands by the front steps."),
    features=["The Hospitality House: two storeys of pale yellow walls with white corner boards",
              "A white wraparound porch with posts and railings, a balcony over the door and "
              "a lattice skirt",
              "A light grey tin roof with white gable trim and a louvred cupola on the ridge",
              "A palm by the front steps"],
    omitted=["The villa buildings, the marina and the pools",
             "The shutters and the clapboard siding (shown as plain yellow walls)",
             "The gardens round the house"],
    colour_rows=[("Bright Light Yellow", "Cool Yellow", "Bright Light Yellow"),
                 ("White", "White", "White"),
                 ("Light Bluish Gray", "Medium Stone Grey", "Light Bluish Gray"),
                 ("Black", "Black", "Black"), ("Green", "Dark Green", "Green"),
                 ("Reddish Brown", "Reddish Brown", "Reddish Brown"),
                 ("Dark Bluish Gray", "Dark Stone Grey", "Dark Bluish Gray")],
    organisation=["The display base and the lawn", "The Hospitality House", "The palm"],
    sub_info={
        "house.ldr": ("The Hospitality House",
                      "A grey foundation with the lattice skirt, two yellow storeys with the "
                      "white porch and balcony, then the tin roof and the cupola."),
        "palm.ldr": ("The palm", "A trunk of round bricks and two layers of fronds."),
    },
    legend=("palm.ldr", 1),
    tips=["Each storey is one course of yellow bricks with black bricks for the windows, then "
          "a layer of plates. Keep the yellow, white and black bricks in separate trays.",
          "The porch railings are round 1&times;1 plates with tiles on top, between posts of "
          "round 1&times;1 bricks.",
          "The roof goes up one row of slopes at a time; the white slopes go at the two gable "
          "ends."],
    build_time="about 45 minutes to 1 hour",
)

W, D = 14, 10                       # house footprint, porch included
HX, HZ = 5, 4                       # house corner on the base
PALMS = ((3, 3),)
WALK = (11, 12)                     # the walk to the front steps (base x)
CUPOLA = (6, 4)                     # front-left cell of the 2 x 2 cupola (house grid)

# --------------------------------------------------------------------------
# the Hospitality House
# --------------------------------------------------------------------------
WRAP = 3                            # the porch wraps this many studs round each side
POSTS_FRONT = (0, 3, 5, 8, 10, W - 1)
ENTRANCE = {6, 7}
BALCONY = (4, 10)                   # x range of the recessed upper balcony (front)
CORNERS = {(0, 0), (W - 1, 0), (0, D - 1), (W - 1, D - 1)}
# ground-floor wall outline: behind the porch at the front, flush along the sides
GROUND = [(1, 1), (W - 2, 1), (W - 2, WRAP), (W - 1, WRAP), (W - 1, D - 1), (0, D - 1),
          (0, WRAP), (1, WRAP)]


def porch_cells():
    return {(x, 0) for x in range(W)} | {(x, z) for x in (0, W - 1) for z in range(1, WRAP)}


def ground_material(x, z):
    """Ground floor: yellow walls, windows and the door; white corner boards at the back."""
    if (x, z) in CORNERS or (x in (0, W - 1) and z == WRAP):
        return TRIM
    if z == 1:
        return WINDOW if x in {3, 10} | ENTRANCE else WALL
    if x in (0, W - 1):
        return WINDOW if z in (5, 7) else WALL
    if z == D - 1:
        return WINDOW if x in (3, 10) else WALL
    return WALL


def upper_material(x, z):
    """Upper floor over the porches: yellow walls with white corner boards."""
    if (x, z) in CORNERS:
        return TRIM
    if z == 0:
        return WINDOW if x in (2, W - 3) else WALL
    if z == 1:                               # back wall of the balcony
        return WINDOW if x in ENTRANCE else WALL
    if x in (0, W - 1):
        return WINDOW if z in (3, 6) else WALL
    return WINDOW if x in (3, 6, 7, 10) else WALL


def tile_runs(m, cells, layer, colour):
    """1-wide tile runs over a set of porch cells (along x at the front, z at the sides)."""
    cells = set(cells)
    done = set()
    for c in sorted(cells, key=lambda c: (c[1], c[0])):
        if c in done:
            continue
        x, z = c
        if (x + 1, z) in cells and z == 0:
            n = 1
            while (x + n, z) in cells:
                n += 1
            bricks.row(m, "t", colour, x, z, n, layer, axis="x")
            done |= {(x + i, z) for i in range(n)}
        else:
            n = 1
            while (x, z + n) in cells and (x, z + n) not in done:
                n += 1
            bricks.row(m, "t", colour, x, z, n, layer, axis="z")
            done |= {(x, z + i) for i in range(n)}


def railing(m, posts, rail, L, one_step=False):
    """White posts (round bricks) and a railing: round plates under a tile handrail."""
    for x, z in sorted(posts):
        m.add("round1", TRIM, x, z, L)
    for x, z in sorted(rail):
        m.add("round_p1", TRIM, x, z, L)
    if not one_step:
        m.step()
    tile_runs(m, rail, L + 1, TRIM)
    m.step()


def split_step(m, i0):
    """Spread the parts added since item i0 over two steps: the front half first."""
    new = m.items[i0:]
    later = {id(it) for it in sorted(new, key=lambda it: (it.z, it.x))[len(new) // 2:]}
    for it in new:
        if id(it) in later:
            it.step = m.step_no + 1
    m.items[i0:] = sorted(new, key=lambda it: it.step)
    m.step_no += 1
    m.step()


def slab(m, colour, layer, widths):
    """A full-footprint layer of plates: strips across the depth, `widths` from the left."""
    x = 0
    for w in widths:
        place_rect(m, "p", colour, x, 0, w, D, layer)
        x += w


def build_house():
    m = Model("house.ldr", "The Hospitality House")
    slab(m, PLINTH, 0, (2, 6, 6))
    m.step()

    # raised foundation: a white lattice skirt under the porch, the deck on top
    L = 1
    found = WallRing(GROUND)
    found.course(m, L, 0, lambda x, z, layer: ("b", PLINTH))
    m.step()
    for x in (1, 9):
        m.add("fence1x4", TRIM, x, 0, L)
    for x in (0, 5, 8, W - 1):
        m.add("b1x1", TRIM, x, 0, L)
    m.add("b1x2", PLINTH, 6, 0, L)                     # the top step
    for x in (0, W - 1):
        m.add("b1x2", TRIM, x, 1, L, rot=90)
    m.step()
    slab(m, PLINTH, L + 3, (6, 6, 2))
    m.step()

    # ground floor: yellow walls, the porch across the front and round the corners
    L = 5
    core = WallRing(GROUND)
    i0 = len(m.items)
    core.course(m, L, 1, lambda x, z, layer: ("b", ground_material(x, z)))
    split_step(m, i0)
    posts = {(x, 0) for x in POSTS_FRONT} | {(x, WRAP - 1) for x in (0, W - 1)}
    rail = porch_cells() - posts - {(x, 0) for x in ENTRANCE}
    railing(m, posts, rail, L)
    # the porch ceiling and floor of the upper storey
    slab(m, TRIM, L + 3, (2, 6, 6))
    m.step()

    # upper floor: flush with the porch, a balcony recessed over the entrance
    L = 9
    b0, b1 = BALCONY
    outer = WallRing([(0, 0), (b0 - 1, 0), (b0 - 1, 1), (b1, 1), (b1, 0), (W - 1, 0),
                      (W - 1, D - 1), (0, D - 1)])
    i0 = len(m.items)
    outer.course(m, L, 0, lambda x, z, layer: ("b", upper_material(x, z)))
    split_step(m, i0)
    railing(m, {(b0, 0), (b1 - 1, 0)}, {(x, 0) for x in range(b0 + 1, b1 - 1)}, L,
            one_step=True)
    slab(m, TRIM, L + 3, (6, 6, 2))
    m.step()

    # the tin roof (gable ends with white rakes) and the cupola on the ridge
    base = L + 4
    cup = {(CUPOLA[0] + i, CUPOLA[1] + j) for i in (0, 1) for j in (0, 1)}
    roof = Roof(0, W, 0, D, base, "x", pitch=33, color=ROOF, trim=TRIM,
                trim_ends=("start", "end"), wall=WALL, name="tin roof")
    build_roofs(m, [roof], fill_color=ROOF, keep_open=cup, support_caps=True)
    top = roof.layer(roof.K + 1)
    cx, cz = CUPOLA
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


def build_main(house, tree):
    m = Model("old_key_west_compact.ldr", "Old Key West Resort (compact)")
    m.header_notes = ["Compact resort collection; generated by design.py (lego-kit)."]
    m.section("The display base", "The base and the black band are the same for every kit in "
              "the collection. The lawn, the walk and the front step go on next.")
    band = display_base(m)
    reserved = set(band)
    reserved |= {(HX + x, HZ + z) for x in range(W) for z in range(D)}
    reserved |= set(PALMS)
    reserved |= {(HX + x, HZ - z) for x in ENTRANCE for z in (1, 2)}
    finish_ground(m, reserved, GREEN,
                  colour_at=lambda x, z: PATH if x in WALK and z < HZ else GREEN)
    m.step()
    m.sub(house, HX, HZ, 1)
    m.step()
    sx = HX + min(ENTRANCE)
    m.add("b1x2", PLINTH, sx, HZ - 1, 1)                  # the front steps
    m.add("t1x2", PLINTH, sx, HZ - 1, 4)
    m.add("p1x2", PLINTH, sx, HZ - 2, 1)
    m.add("t1x2", PLINTH, sx, HZ - 2, 2)
    m.step()
    for px, pz in PALMS:
        m.sub(tree, px, pz, 1)
    m.step()
    return m


def build():
    house, tree = build_house(), palm(trunk=6)
    main_m = build_main(house, tree)
    return main_m, [main_m, house, tree]
