"""Yacht Club Resort, mid-size display kit (resort collection).

Build with the shared kit:  ./build.sh

The mid-size format (lego-kit/compact.py, size="midsize"): a 32 x 24 base with a
black front band; one storey = 4 plates (a course of bricks and a plate band),
1 stud is about 2 m, the same scale as the compact kit. It shows the entrance
front of the Yacht Club, facing the viewer: a long, symmetric facade of grey-blue
clapboard under a row of white-trimmed front gables, the cupola on the tall centre
gable, balconies with white railings, and the white porte-cochere over the drive.

Grid (studs): x to the right, z toward the back; the front band is z = 0..1.
  centre        x 11..20, z 14..21   four storeys under a 10-wide front gable, the
                                     cupola on its ridge
  balcony wings x  7..10 and 21..24, z 16..21   four storeys set back two studs, white
                                     balcony railings on the upper floors (build 2)
  end bays      x  1..6 and 25..30, z 14..21   four storeys under a front gable (build 2)
  porte-cochere x 12..19, z  8..13   white columns, a deck and a low pedimented roof
  drive         z  8..12 across the base, paved up to the centre; walk x 14..17, z 2..7
  lighthouse    (28, 3) in a patch of water at the front right corner
  flagpole      (3, 4); lamp posts (11, 7) and (20, 7); hydrangeas along the facade
"""
import bricks
from bricks import (Model, PARTS, row, place_rect, rot_matrix,
                    WHITE, BLACK, LBG, DBG, RED, GREEN, BLUE, TCLEAR)
from roofs import Roof, build_roofs
from compact import compact_project, display_base, finish_ground

SIZE = "midsize"
SAND_BLUE, BRIGHT_LIGHT_BLUE = 379, 212
WALL, TRIM, WINDOW, ROOF, BAND, PLINTH, HIDDEN = SAND_BLUE, WHITE, BLACK, DBG, LBG, LBG, LBG
PAVING, WATER, LAMP, BLOOM = LBG, BLUE, RED, BRIGHT_LIGHT_BLUE

# a 1 x 2 plate with a clip on the end (a Bestseller in white), for the flag
bricks.P("ycm_clip_plate", "63868.dat", "Plate 1 x 2 with Clip on End", cells=[(0, 0)],
         bottom=[], height=0, solid=False, studs=[])

PROJECT = compact_project(
    size=SIZE,
    slug="yacht_club",
    title="Yacht Club Resort",
    resort="Disney's Yacht Club Resort",
    category="Deluxe",
    merged=[],
    about=("The entrance front of the Yacht Club, as a guest arriving by car sees it: a long, "
           "symmetric New England seaside hotel of grey-blue clapboard with rows of windows. "
           "A tall centre block rises under a big white-trimmed front gable with the white "
           "cupola on its ridge; end bays carry their own front gables and white louvres; "
           "recessed wings between them have white balcony railings on every upper floor; "
           "the roofs are dark grey. The white porte-cochere stands over the drive at the "
           "front door between two lamp posts, a flagpole stands on the lawn, blue hydrangeas "
           "grow along the facade, and a small lighthouse in the water at the front corner is "
           "a nod to the one on the lake side."),
    features=["The entrance front, facing you: a long, symmetric facade of grey-blue clapboard "
              "(sand blue) with rows of windows",
              "Three white-trimmed front gables under dark grey roofs: the tall centre gable "
              "with a double window and a louvre, and the two end bays",
              "The white cupola with its dark dome on the centre ridge",
              "The white porte-cochere over the drive: six columns, a deck and a low pediment",
              "Recessed wings with white balcony railings on the upper floors",
              "Two lamp posts, a flagpole with a blue flag, blue hydrangeas, and a small "
              "lighthouse in the water at the front corner"],
    omitted=["The long guest wings, the Beach Club next door and the lake side with the "
             "marina and the boardwalk",
             "The lighthouse at its real place on the dock (shown small at the front corner)",
             "The window trim, shutters and most balconies (shown as rows of windows)"],
    colour_rows=[("Sand Blue", "Sand Blue", "Sand Blue"),
                 ("White", "White", "White"),
                 ("Dark Bluish Gray", "Dark Stone Grey", "Dark Bluish Gray"),
                 ("Light Bluish Gray", "Medium Stone Grey", "Light Bluish Gray"),
                 ("Black", "Black", "Black"), ("Red", "Bright Red", "Red"),
                 ("Blue", "Bright Blue", "Blue"), ("Green", "Dark Green", "Green"),
                 ("Bright Light Blue", "Light Royal Blue", "Bright Light Blue"),
                 ("Trans-Clear", "Transparent", "Trans-Clear")],
    organisation=["The display base, the drive, the lawns and the water", "The centre",
                  "The balcony wings (build 2)", "The end bays (build 2)",
                  "The porte-cochere", "The lighthouse, the lamps, the flagpole and the "
                  "hydrangeas"],
    sub_info={
        "centre.ldr": ("The centre",
                       "Four storeys of grey-blue clapboard with the entrance on the ground "
                       "floor, under a tall front gable with white rake boards, a double "
                       "window and a louvre. The white cupola stands on the ridge."),
        "link.ldr": ("The balcony wings",
                     "Two identical wings, set back between the centre and the end bays: the "
                     "floor bands reach out to the front as balconies with white railings."),
        "bay.ldr": ("The end bays",
                    "Two identical four-storey bays with a white-trimmed gable and a louvre "
                    "at the front and the back."),
        "porte.ldr": ("The porte-cochere",
                      "Six white columns carry a white deck and a low dark grey roof with a "
                      "white pediment. It stands over the drive, against the centre."),
        "lighthouse.ldr": ("The lighthouse",
                           "A small tower of white round plates, a red band, a white dome, the "
                           "clear lantern and a red cap."),
        "lamp.ldr": ("The lamp posts", "A tall black post, a clear lantern and a black cap."),
        "flagpole.ldr": ("The flagpole",
                         "A white post and pole with a blue flag on a clip plate."),
    },
    legend=("lighthouse.ldr", 1),
    tips=["Each storey takes two steps (three on the balcony wings, with the railing): a "
          "course of sand blue 1&times;2 bricks with black bricks for the windows, then a band "
          "of light grey plates. The top band is white: the eaves. Sand blue is a Bestseller "
          "only as the 1&times;2 brick, so the walls are laid in pairs.",
          "The balcony wings have no side walls: the long plates of each floor band run from "
          "the balcony edge to the back wall and hold the wing together.",
          "Roofs go up one row of slopes at a time; the white slopes go at the gable ends.",
          "The cupola's finial and the lighthouse lantern sit on the single centre stud of a "
          "2&times;2 dish.",
          "A <b>&ldquo;Build 2&rdquo;</b> badge means you build that module twice."],
    substitutions=["<b>Walls:</b> sand blue is a Bestseller only as the 1&times;2 brick. Light "
                   "bluish gray 1&times;2 bricks give a grey Yacht Club if sand blue runs out."],
    build_time="about 2 to 2&frac12; hours",
)

FLOORS = 4


def storey_layer(f):
    """Bottom layer of storey f's brick course (the plinth is layer 0)."""
    return 1 + 4 * (f - 1)


ROOF_BASE = storey_layer(FLOORS) + 4


# --------------------------------------------------------------------------
# walls, bands and slabs
# --------------------------------------------------------------------------
def lay(m, cells, pat, layer):
    """Lay one face of a storey's brick course along ``cells`` (in +x or +z order).

      S  grey-blue clapboard: a sand blue 1x2 brick, in pairs ("SS"; sand blue is a
         Bestseller only as the 1x2 brick)
      W  window or door: black bricks (runs are joined into longer bricks)
      h  hidden faces: light grey bricks
      .  no brick (a side hidden between two neighbours)
    """
    assert len(pat) == len(cells), (cells, pat)
    axis = "x" if cells[0][1] == cells[-1][1] else "z"
    i = 0
    while i < len(pat):
        ch = pat[i]
        x, z = cells[i]
        if ch == "S":
            assert pat[i + 1] == "S", pat
            m.add("b1x2", WALL, x, z, layer, rot=0 if axis == "x" else 90)
            i += 2
            continue
        j = i
        while j < len(pat) and pat[j] == ch:
            j += 1
        if ch != ".":
            row(m, "b", WINDOW if ch == "W" else HIDDEN, x, z, j - i, layer, axis=axis)
        i = j


def course(m, W, z0, D, L, front, back, left, right):
    """A brick course of walls at x 0..W-1, z z0..z0+D-1: the front and back own
    the corners; the side patterns cover z0+1..z0+D-2."""
    lay(m, [(x, z0) for x in range(W)], front, L)
    lay(m, [(x, z0 + D - 1) for x in range(W)], back, L)
    lay(m, [(0, z) for z in range(z0 + 1, z0 + D - 1)], left, L)
    lay(m, [(W - 1, z) for z in range(z0 + 1, z0 + D - 1)], right, L)


def ring(m, W, z0, D, layer, colour=BAND):
    """A ring of plates under or over walls at x 0..W-1, z z0..z0+D-1. The side plates
    take the corners (the brick courses give them to the front and back), so every
    ring ties the four walls together."""
    for x in (0, W - 1):
        row(m, "p", colour, x, z0, D, layer, axis="z")
    for z in (z0, z0 + D - 1):
        row(m, "p", colour, 1, z, W - 2, layer)


def slab(m, W, z0, D, layer, along):
    """The white eaves slab: 2-wide plates running ``along`` x or z (W and D even)."""
    if along == "x":
        for z in range(z0, z0 + D, 2):
            m.add(f"p2x{W}", TRIM, 0, z, layer)
    else:
        for x in range(0, W, 2):
            m.add(f"p2x{D}", TRIM, x, z0, layer, rot=90)


def storeys(m, W, z0, D, pats, band=None, after_band=None, top=None):
    """Storeys on a plinth already laid: ``pats(f)`` gives the four face patterns of
    storey f; each course is followed by a ring of light grey plates (or
    ``band(m, layer)``), and the top by ``top(m, layer)``, the white eaves slab.
    Returns the roof base layer."""
    for f in range(1, FLOORS + 1):
        L = storey_layer(f)
        course(m, W, z0, D, L, *pats(f))
        m.step()
        if f < FLOORS:
            if band:
                band(m, L + 3)
            else:
                ring(m, W, z0, D, L + 3)
        else:
            top(m, L + 3)
        m.step()
        if after_band and f < FLOORS:
            after_band(m, f, L + 4)
    return ROOF_BASE


# --------------------------------------------------------------------------
# centre: four storeys under a 10-wide front gable, the cupola on its ridge
# --------------------------------------------------------------------------
CEN_W, CEN_D = 10, 8
CUPOLA = (4, 3)                      # front-left cell of the 2 x 2 cupola, on the ridge


def centre_gable(m, cells, layer):
    """The big front gable: clapboard with a double window and a white louvre at the
    top; plain clapboard at the back."""
    xs = sorted(c[0] for c in cells)
    z = cells[0][1]
    if len(xs) == 2:
        m.add("grille1x2" if z == 0 else "b1x2", TRIM if z == 0 else WALL, xs[0], z, layer)
        return
    pat = "SSWWSS" if (z == 0 and len(xs) == 6) else "S" * len(xs)
    lay(m, [(x, z) for x in xs], pat, layer)


def build_centre():
    m = Model("centre.ldr", "Centre")
    W, D = CEN_W, CEN_D
    ring(m, W, 0, D, 0, PLINTH)
    m.step()

    def pats(f):
        front = "SSWWWWWWSS" if f == 1 else "SSWWSSWWSS"
        return front, "SSWWSSWWSS", "WSSSSW", "WSSSSW"
    base = storeys(m, W, 0, D, pats, top=lambda m, L: slab(m, W, 0, D, L, "x"))
    cx, cz = CUPOLA
    cup = {(cx + i, cz + j) for i in (0, 1) for j in (0, 1)}
    roof = Roof(0, W, 0, D, base, "z", pitch=45, color=ROOF, trim=TRIM,
                trim_ends=("start", "end"), wall=centre_gable, widths=(4, 2, 1),
                name="centre roof")
    build_roofs(m, [roof], fill_color=HIDDEN, keep_open=cup, support_caps=True)
    # the cupola: a white base, four posts, a white eave, a dark dome and a finial
    L = roof.layer(roof.K + 1)
    m.step("The cupola stands on the four open studs at the top of the ridge.")
    m.add("b2x2", TRIM, cx, cz, L)
    m.step()
    for x, z in sorted(cup):
        m.add("round1", TRIM, x, z, L + 3)
    m.step()
    m.add("p2x2", TRIM, cx, cz, L + 6)
    dome = m.add("dish2", ROOF, cx, cz, L + 7)
    y = -8 * (L + 7 + PARTS["dish2"].height)
    m.add_raw("cone1", TRIM, (20 * cx + 20, y - PARTS["cone1"].bmax_y, 20 * cz + 20),
              rot_matrix(0), attach_to=dome)
    m.step()
    m.width, m.depth = W, D
    return m


# --------------------------------------------------------------------------
# balcony wings: set back two studs, white railings on the upper floors (build 2)
# --------------------------------------------------------------------------
LINK_W, LINK_D = 4, 6                # walls at z 1..5; z = 0 is the balcony row


def build_link():
    m = Model("link.ldr", "Balcony wing (build 2)")
    W, D = LINK_W, LINK_D
    # walls only at the front and back: the sides stand against the bay and the centre
    for z in (1, D - 1):
        m.add("p1x4", PLINTH, 0, z, 0)
    m.step()

    def pats(f):
        return "WSSW", "WSSW", "...", "..."

    def band(m, layer):
        """The balcony floor and floor band: a long plate down each side from the
        balcony edge to the back wall, two short ones across the front wall and one at
        the back."""
        if layer == storey_layer(1) + 3:
            m.step("The long plates run from the balcony edge to the back wall: they hold "
                   "the front and back walls together.")
        for x in (0, W - 1):
            m.add("p1x6", BAND, x, 0, layer, rot=90)
        for x in (1, 2):
            m.add("p1x2", BAND, x, 0, layer, rot=90)
        m.add("p1x2", BAND, 1, D - 1, layer)

    def railing(m, f, layer):
        if f == 1:
            m.step("The white railing stands on the balcony edge, in front of the wall.")
        m.add("fence1x4", TRIM, 0, 0, layer)
        m.step()
    base = storeys(m, W, 1, D - 1, pats, band=band, after_band=railing,
                   top=lambda m, L: slab(m, W, 0, D, L, "z"))
    build_roofs(m, [Roof(0, W, 0, D, base, "x", pitch=45, color=ROOF, wall=WALL,
                         widths=(4, 2, 1), name="link roof")],
                fill_color=HIDDEN, support_caps=True)
    m.width, m.depth = W, D
    return m


# --------------------------------------------------------------------------
# end bays: four storeys under a front gable (build 2)
# --------------------------------------------------------------------------
BAY_W, BAY_D = 6, 8


def bay_gable(m, cells, layer):
    """The gable ends: a white louvre between the rake boards."""
    xs = sorted(c[0] for c in cells)
    z = cells[0][1]
    if len(xs) == 2:
        m.add("grille1x2", TRIM, xs[0], z, layer)
    else:
        row(m, "b", HIDDEN, xs[0], z, len(xs), layer)


def build_bay():
    m = Model("bay.ldr", "End bay (build 2)")
    W, D = BAY_W, BAY_D
    ring(m, W, 0, D, 0, PLINTH)
    m.step()

    def pats(f):
        return "SSWWSS", "SSWWSS", "SSWWSS", "SSWWSS"
    base = storeys(m, W, 0, D, pats, top=lambda m, L: slab(m, W, 0, D, L, "z"))
    build_roofs(m, [Roof(0, W, 0, D, base, "z", pitch=45, color=ROOF, trim=TRIM,
                         trim_ends=("start", "end"), wall=bay_gable, widths=(4, 2, 1),
                         name="bay roof")],
                fill_color=HIDDEN, support_caps=True)
    m.width, m.depth = W, D
    return m


# --------------------------------------------------------------------------
# porte-cochere: white columns, a deck and a low pedimented roof
# --------------------------------------------------------------------------
PC_W, PC_D = 8, 6
PC_COLS = [(0, 0), (2, 0), (5, 0), (7, 0), (0, 5), (7, 5)]


def build_porte():
    m = Model("porte.ldr", "Porte-cochere")
    W, D = PC_W, PC_D
    for x, z in PC_COLS:
        m.add("round1", TRIM, x, z, 0)
        m.add("round1", TRIM, x, z, 3)
    m.step("One white 6×8 plate on the six columns makes the deck.")
    place_rect(m, "p", TRIM, 0, 0, W, D, 6)
    m.step()
    build_roofs(m, [Roof(0, W, 0, D, 7, "z", pitch=33, color=ROOF, trim=TRIM,
                         trim_ends=("start",), wall=TRIM, widths=(2, 1), name="porte roof")],
                fill_color=TRIM, support_caps=True)
    m.width, m.depth = W, D
    return m


# --------------------------------------------------------------------------
# details: lighthouse, lamp post, flagpole, hydrangeas
# --------------------------------------------------------------------------
def build_lighthouse(tower=5):
    """A small white tower of round plates, a red band, a white dome with the clear
    lantern on its centre stud, and a red cap."""
    m = Model("lighthouse.ldr", "Lighthouse")
    for k in range(tower):
        m.add("round_p2", WHITE, 0, 0, k)
    m.step()
    m.add("round_p2", LAMP, 0, 0, tower)
    dome = m.add("dish2", WHITE, 0, 0, tower + 1)
    m.step()
    y = -8 * (tower + 1 + PARTS["dish2"].height)
    lantern = m.add_raw("round1", TCLEAR, (20, y - PARTS["round1"].bmax_y, 20), rot_matrix(0),
                        attach_to=dome)
    m.add_raw("cone1", LAMP, (20, y - 24 - PARTS["cone1"].bmax_y, 20), rot_matrix(0),
              attach_to=lantern)
    m.step()
    m.width, m.depth = 2, 2
    return m


def build_lamp():
    m = Model("lamp.ldr", "Lamp post (build 2)")
    m.add("round1", BLACK, 0, 0, 0)
    m.add("round1", BLACK, 0, 0, 3)
    m.step()
    m.add("round1", TCLEAR, 0, 0, 6)
    m.add("cone1", BLACK, 0, 0, 9)
    m.step()
    m.width, m.depth = 1, 1
    return m


def build_flagpole():
    m = Model("flagpole.ldr", "Flagpole")
    m.add("round1", TRIM, 0, 0, 0)
    base = m.add("round1", TRIM, 0, 0, 3)
    m.step()
    c = 10
    top = -8 * 6
    bar_y = top + 4 - 80                      # a 4L bar pushed 4 LDU into the open stud
    bar = m.add_raw("bar4", TRIM, (c, bar_y, c), rot_matrix(0), attach_to=base)
    m.step()
    mat = (-1, 0, 0, 0, 0, 1, 0, 1, 0)
    fy = bar_y + 14
    flag = m.add_raw("ycm_clip_plate", TRIM, (c + 30, fy, c - 4), mat, attach_to=bar)
    m.add_raw("t1x2", BLUE, (c + 30, fy, c - 12), mat, attach_to=flag)
    m.step()
    m.width, m.depth = 1, 1
    return m


def add_hydrangea(m, x, z, layer):
    """A green leaf plate with a pale blue flower on its stud."""
    m.add("leaves1", GREEN, x, z, layer)
    m.add("flower1", BLOOM, x, z, layer + 1)


# --------------------------------------------------------------------------
# main model
# --------------------------------------------------------------------------
CX, CZ = 11, 14
LINKS = ((7, 16), (21, 16))
BAYS = ((1, 14), (25, 14))
PX, PZ = 12, 8
DRIVE_Z = range(8, 13)
WALK = range(14, 18)
LIGHT = (28, 3)
WATER_X, WATER_Z = range(26, 32), range(2, 6)
JETTY = {(28, 5), (29, 5)}           # a short stone jetty from the lawn to the lighthouse
FLAG = (3, 4)
LAMPS = ((11, 7), (20, 7))
SHRUBS = [(2, 13), (5, 13), (8, 15), (9, 15), (10, 13),
          (21, 13), (22, 15), (23, 15), (26, 13), (29, 13)]


def rect(x0, z0, w, d):
    return {(x, z) for x in range(x0, x0 + w) for z in range(z0, z0 + d)}


def ground_colour(x, z):
    if (x, z) in JETTY:
        return PAVING
    if x in WATER_X and z in WATER_Z:
        return WATER
    if z in DRIVE_Z or (CX <= x < CX + CEN_W and z == CZ - 1):
        return PAVING
    if x in WALK and z < PZ:
        return PAVING
    return GREEN


def build_main(centre, link, bay, porte, lighthouse, lamp, flag):
    m = Model("yacht_club_midsize.ldr", "Yacht Club Resort (mid-size)")
    m.header_notes = ["Mid-size resort collection; generated by design.py (lego-kit)."]
    m.section("The display base, the drive, the lawns and the water",
              "The base and the black band are the same for every mid-size kit. The drive, "
              "the walk, the lawns and the water go on next; the drive tiles tie the base "
              "plates together.")
    band = display_base(m, SIZE)
    reserved = set(band)
    reserved |= rect(CX, CZ, CEN_W, CEN_D)
    for lx, lz in LINKS:
        reserved |= rect(lx, lz + 1, LINK_W, LINK_D - 1)
    for bx, bz in BAYS:
        reserved |= rect(bx, bz, BAY_W, BAY_D)
    reserved |= {(PX + x, PZ + z) for x, z in PC_COLS}
    reserved |= rect(*LIGHT, 2, 2)
    reserved |= {FLAG} | set(LAMPS)
    finish_ground(m, reserved, GREEN, colour_at=ground_colour, size=SIZE)
    m.step()
    m.sub(centre, CX, CZ, 1)
    m.step()
    for lx, lz in LINKS:
        m.sub(link, lx, lz, 1)
    m.step()
    for bx, bz in BAYS:
        m.sub(bay, bx, bz, 1)
    m.step()
    m.sub(porte, PX, PZ, 1)
    m.step()
    m.section("The lighthouse, the lamps, the flagpole and the hydrangeas",
              "A small lighthouse in the water at the front corner, two lamp posts by the "
              "porte-cochere, the flagpole on the lawn and blue hydrangeas along the facade.")
    m.sub(lighthouse, *LIGHT, 1)
    for x, z in LAMPS:
        m.sub(lamp, x, z, 1)
    m.sub(flag, *FLAG, 1)
    m.step()
    for x, z in SHRUBS:
        add_hydrangea(m, x, z, 2)
    m.step()
    return m


def build():
    saved = dict(bricks.ALLOWED)
    # Bestseller sizes (checked with avail.py), trimmed to keep the part list short
    bricks.ALLOWED[("b", SAND_BLUE)] = bricks._sizes("1x2")
    bricks.ALLOWED[("b", BLACK)] = bricks._sizes("1x1 1x2")
    bricks.ALLOWED[("p", LBG)] = bricks._sizes("1x2 1x4 1x6 1x8 1x10")
    try:
        return _build()
    finally:
        bricks.ALLOWED.clear()
        bricks.ALLOWED.update(saved)


def _build():
    centre, link, bay = build_centre(), build_link(), build_bay()
    porte, lighthouse, lamp, flag = build_porte(), build_lighthouse(), build_lamp(), build_flagpole()
    main_m = build_main(centre, link, bay, porte, lighthouse, lamp, flag)
    return main_m, [main_m, centre, link, bay, porte, lighthouse, lamp, flag]
