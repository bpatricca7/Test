"""Yacht Club Resort, compact display kit (resort collection).

Build with the shared kit:  ./build.sh

The compact format (lego-kit/compact.py): a 24 x 16 base with a black front
band; one storey = 4 plates (a course of bricks and a plate band), 1 stud is about 2 m.

Grid (studs): x to the right, z toward the back; the front band is z = 0..1.
  centre range   x  8..15, z 7..14   three storeys, entrance porch, cupola on the ridge
  end pavilions  x  2..7 and 16..21, z 7..14   four storeys, front gables (build 2)
  lighthouse     (20, 2) at the end of a pier (z = 3) in a patch of water, x 14..23, z 2..5
  forecourt      x 10..13, z 2..6 in front of the porch
"""
from bricks import Model, PARTS, rot_matrix, row, fill_rect, fill_cells, place_rect, \
    WHITE, BLACK, LBG, DBG, RED, GREEN, BLUE, TAN, TCLEAR
from roofs import Roof, build_roofs
from compact import compact_project, display_base, finish_ground

SAND_BLUE = 379
WALL, HIDDEN, BAND, TRIM, WINDOW, ROOF, PLINTH = SAND_BLUE, LBG, LBG, WHITE, BLACK, DBG, LBG
WATER, PIER, LAMP = BLUE, TAN, RED

PROJECT = compact_project(
    slug="yacht_club",
    title="Yacht Club Resort",
    resort="Disney's Yacht Club Resort",
    category="Deluxe",
    merged=[],
    about=("The Yacht Club as a New England seaside hotel: grey-blue clapboard walls with rows "
           "of windows, two tall end pavilions with crisp white-trimmed front gables under dark "
           "grey roofs, a lower centre range with a white entrance porch and the white cupola "
           "on its ridge, and the lighthouse at the end of its pier out in the water."),
    features=["Grey-blue clapboard walls (sand blue) with rows of windows",
              "Two end pavilions with white-trimmed front gables under dark grey roofs",
              "Crisp white eaves, gable rakes and entrance porch with a railing",
              "The white cupola with a dark dome on the centre ridge",
              "The lighthouse at the end of its pier, white with a red top, in a patch of "
              "blue water"],
    omitted=["The long guest wings and the Beach Club next door",
             "The porte-cochere, the marina and the boardwalk on Crescent Lake",
             "The balconies and window trim (shown as plain rows of windows)"],
    colour_rows=[("Sand Blue", "Sand Blue", "Sand Blue"),
                 ("White", "White", "White"),
                 ("Dark Bluish Gray", "Dark Stone Grey", "Dark Bluish Gray"),
                 ("Light Bluish Gray", "Medium Stone Grey", "Light Bluish Gray"),
                 ("Black", "Black", "Black"), ("Red", "Bright Red", "Red"),
                 ("Blue", "Bright Blue", "Blue"), ("Tan", "Brick Yellow", "Tan"),
                 ("Green", "Dark Green", "Green"), ("Trans-Clear", "Transparent", "Trans-Clear")],
    organisation=["The display base, the lawn and the water", "The centre range",
                  "The end pavilions (build 2)", "The lighthouse"],
    sub_info={
        "centre.ldr": ("The centre range",
                       "Three storeys of grey-blue clapboard behind a white entrance porch, "
                       "a dark grey roof and the white cupola on the ridge."),
        "pavilion.ldr": ("The end pavilions",
                         "Two identical four-storey pavilions with a dark grey roof and a "
                         "white-trimmed gable at each end."),
        "lighthouse.ldr": ("The lighthouse",
                           "A tower of white round plates, a red band, a white dome, the clear "
                           "lantern and a red cap."),
    },
    legend=("lighthouse.ldr", 1),
    tips=["Each storey is one course of sand blue 1&times;2 bricks with black 1&times;1 bricks "
          "for the windows, then a band of light grey plates. The top band is a white plate: "
          "the eaves.",
          "Roofs go up one row of slopes at a time. The white slopes go at the gable ends.",
          "The lighthouse's lantern and cap sit on the centre stud of the white dome.",
          "A <b>&ldquo;Build 2&rdquo;</b> badge means you build that module twice."],
    substitutions=["<b>Walls:</b> sand blue is a Bestseller only as the 1&times;2 brick. Light "
                   "bluish gray 1&times;2 bricks give a grey Yacht Club if sand blue runs out."],
    build_time="about 1 to 1&frac12; hours",
)

PAV_W, PAV_D, PAV_FLOORS = 6, 8, 4
CEN_W, CEN_D, CEN_FLOORS = 8, 8, 3
CEN_WALL_Z = 2                       # the centre's walls start behind its porch
PAVILIONS = ((2, 7), (16, 7))
CX, CZ = 8, 7
LIGHT = (20, 2)                      # lighthouse, 2 x 2
WATER_X, WATER_Z = range(14, 24), range(2, 6)
PIER_CELLS = {(x, 3) for x in range(14, 20)}
WALK = range(10, 14)                 # the forecourt, as wide as the porch


def lay(m, cells, pat, layer):
    """Lay one face of a storey's brick course along ``cells`` (in +x or +z order).

      S  grey-blue clapboard: a sand blue 1x2 brick (in pairs, "SS"; sand blue is a
         Bestseller only as the 1x2 brick)
      p  plain light grey bricks, on faces hidden against a neighbour
      W  window, D door: black bricks
    """
    assert len(pat) == len(cells), (cells, pat)
    axis = "x" if cells[0][1] == cells[-1][1] else "z"
    i = 0
    while i < len(pat):
        ch = pat[i]
        if ch == "S":
            assert pat[i + 1] == "S", pat
            x, z = cells[i]
            m.add("b1x2", WALL, x, z, layer, rot=0 if axis == "x" else 90)
            i += 2
            continue
        j = i
        while j < len(pat) and pat[j] == ch:
            j += 1
        if ch == "p":
            x, z = cells[i]
            row(m, "b", HIDDEN, x, z, j - i, layer, axis=axis)
        else:
            for x, z in cells[i:j]:          # windows and doors: black 1x1 bricks
                m.add("b1x1", WINDOW, x, z, layer)
        i = j


def storeys(m, w, z0, d, floors, course):
    """Storeys on a plinth already laid: ``course(m, layer, f)`` lays each brick
    course, then a band of light grey plates; the top is a white slab (the eaves).
    Returns the roof base layer."""
    ring = {(x, z) for x in range(w) for z in range(z0, z0 + d)
            if x in (0, w - 1) or z in (z0, z0 + d - 1)}
    for f in range(1, floors + 1):
        L = 1 + 4 * (f - 1)
        course(m, L, f)
        m.step()
        if f < floors:
            fill_cells(m, "p", BAND, ring, L + 3)
        else:
            fill_rect(m, "p", TRIM, 0, z0, w, d, L + 3, along="z")
        m.step()
    return 1 + 4 * floors


def build_pavilion():
    m = Model("pavilion.ldr", "End pavilion (build 2)")
    fill_rect(m, "p", PLINTH, 0, 0, PAV_W, PAV_D, 0, along="z")
    m.step()

    def course(m, L, f):
        # the side walls own the corners (1x2 bricks turning the corner)
        lay(m, [(x, 0) for x in range(1, PAV_W - 1)], "WSSW", L)
        lay(m, [(x, PAV_D - 1) for x in range(1, PAV_W - 1)], "WSSW", L)
        for x in (0, PAV_W - 1):
            lay(m, [(x, z) for z in range(PAV_D)], "SSWSSWSS", L)
    base = storeys(m, PAV_W, 0, PAV_D, PAV_FLOORS, course)
    build_roofs(m, [Roof(0, PAV_W, 0, PAV_D, base, "z", pitch=45, color=ROOF, trim=TRIM,
                         trim_ends=("start", "end"), wall=WALL, widths=(4, 2, 1),
                         name="pavilion roof")],
                fill_color=HIDDEN, support_caps=True)
    m.width, m.depth = PAV_W, PAV_D
    return m


def build_centre():
    m = Model("centre.ldr", "Centre range")
    fill_rect(m, "p", PLINTH, 0, 0, CEN_W, CEN_D, 0, along="z")
    m.step()
    d = CEN_D - CEN_WALL_Z

    zb = CEN_D - 1

    def course(m, L, f):
        # the front and back own the corners; the sides are hidden by the pavilions
        lay(m, [(x, CEN_WALL_Z) for x in range(CEN_W)], "SSWDDWSS" if f == 1 else "SSWSSWSS", L)
        lay(m, [(x, zb) for x in range(CEN_W)], "SSWSSWSS", L)
        for x in (0, CEN_W - 1):
            lay(m, [(x, z) for z in range(CEN_WALL_Z + 1, zb)], "pppp", L)
    # the porch: two white columns, a white roof and a railing on top
    m.step("The porch columns stand on the plinth in front of the door.")
    for x in (2, 5):
        m.add("round1", TRIM, x, 0, 1)
    ring = {(x, z) for x in range(CEN_W) for z in range(CEN_WALL_Z, CEN_D)
            if x in (0, CEN_W - 1) or z in (CEN_WALL_Z, zb)}
    for f in range(1, CEN_FLOORS + 1):
        L = 1 + 4 * (f - 1)
        course(m, L, f)
        m.step()
        if f < CEN_FLOORS:
            fill_cells(m, "p", BAND, ring, L + 3)
            if f == 1:
                place_rect(m, "p", TRIM, 2, 0, 4, 2, L + 3)
        else:
            fill_rect(m, "p", TRIM, 0, CEN_WALL_Z, CEN_W, d, L + 3, along="x")
        m.step()
        if f == 1:
            m.add("fence1x4", TRIM, 2, 0, L + 4)
            m.step()
    base = 1 + 4 * CEN_FLOORS
    cupola = {(3, 4), (4, 4), (3, 5), (4, 5)}
    roof = Roof(0, CEN_W, CEN_WALL_Z, CEN_D, base, "x", pitch=45, color=ROOF, wall=WALL,
                widths=(4, 2, 1), priority=1, name="centre roof")
    build_roofs(m, [roof], fill_color=HIDDEN, keep_open=cupola, support_caps=True)
    # the cupola: a white drum, four white posts, a dark dome and a white finial
    L = roof.layer(roof.K + 1)
    m.add("b2x2", TRIM, 3, 4, L)
    m.step()
    for x, z in sorted(cupola):
        m.add("round1", TRIM, x, z, L + 3)
    m.step()
    dome = m.add("dish2", ROOF, 3, 4, L + 6)
    y = -8 * (L + 6 + PARTS["dish2"].height)
    m.add_raw("cone1", TRIM, (20 * 4, y - PARTS["cone1"].bmax_y, 20 * 5), rot_matrix(0),
              attach_to=dome)
    m.step()
    m.width, m.depth = CEN_W, CEN_D
    return m


def build_lighthouse(tower=6):
    """White tower of round plates, a red band, a white dome with the clear lantern
    on its centre stud, and a red cap."""
    m = Model("lighthouse.ldr", "Lighthouse")
    for k in range(tower + 1):
        m.add("round_p2", WHITE, 0, 0, k)
        if k % 4 == 3:
            m.step()
    m.step()
    m.add("round_p2", LAMP, 0, 0, tower + 1)
    dome = m.add("dish2", WHITE, 0, 0, tower + 2)
    m.step()
    # lantern and cap on the dome's centre stud, half a stud off the grid
    y = -8 * (tower + 2 + PARTS["dish2"].height)
    lantern = m.add_raw("round1", TCLEAR, (20, y - PARTS["round1"].bmax_y, 20), rot_matrix(0),
                        attach_to=dome)
    m.add_raw("cone1", LAMP, (20, y - 24 - PARTS["cone1"].bmax_y, 20), rot_matrix(0),
              attach_to=lantern)
    m.step()
    m.width, m.depth = 2, 2
    return m


def ground_colour(x, z):
    if (x, z) in PIER_CELLS:
        return PIER
    if x in WATER_X and z in WATER_Z:
        return WATER
    if x in WALK and z < CZ:
        return PIER
    return GREEN


def build_main(centre, pavilion, lighthouse):
    m = Model("yacht_club_compact.ldr", "Yacht Club Resort (compact)")
    m.header_notes = ["Compact resort collection; generated by design.py (lego-kit)."]
    m.section("The display base", "The base and the black band are the same for every kit in "
              "the collection. The lawn, the walk, the water and the pier go on next.")
    band = display_base(m)
    reserved = set(band)
    reserved |= {(CX + x, CZ + z) for x in range(CEN_W) for z in range(CEN_D)}
    for px, pz in PAVILIONS:
        reserved |= {(px + x, pz + z) for x in range(PAV_W) for z in range(PAV_D)}
    reserved |= {(LIGHT[0] + x, LIGHT[1] + z) for x in range(2) for z in range(2)}
    finish_ground(m, reserved, GREEN, colour_at=ground_colour)
    m.step()
    m.sub(centre, CX, CZ, 1)
    m.step()
    for px, pz in PAVILIONS:
        m.sub(pavilion, px, pz, 1)
    m.step()
    m.sub(lighthouse, *LIGHT, 1)
    m.step()
    return m


def build():
    centre, pavilion, lighthouse = build_centre(), build_pavilion(), build_lighthouse()
    main_m = build_main(centre, pavilion, lighthouse)
    return main_m, [main_m, centre, pavilion, lighthouse]
