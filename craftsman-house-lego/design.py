"""Craftsman Bungalow: a one-and-a-half-storey Craftsman house, designed from a photo.

Build with the shared kit:  ./build.sh

Scale: 1 stud = 2 ft (about 1:76, HO scale); one storey = 4 bricks, as in the
Family Home (../house-lego). Lot 48 x 32 studs (38.4 x 25.6 cm).

Grid (studs): x to the right, z toward the back; the street is at z = 0.
  street, curb     z 0..2         grass strip z 3, sidewalk z 4..5
  house            x 14..33       main block z 16..27: sage siding, white trim,
                                  side-gable roof (45 degrees) over a one-brick knee wall
  front-gable bay  x 14..21       z 13..15: stone skirting, wide lit window, its own gable
  porch            x 22..33       z 13..15: stone back wall, door, three stone piers with
                                  white columns, railing, steps; a low 33-degree roof
  dormers          x 22..32       on the front slope: a small shed dormer (x 22..24) and
                                  the big front-gable dormer (x 25..32)
  tree             trunk x 6..7, z 9..10, in the front-left lawn
  driveway         x 37..42       z 2..23, with the car; privacy fence along z = 24

Layers (plates): base plates 0, ground and the house plinth 1, walls 2..16 (five
courses: a stone or siding foundation course and the four-brick storey), ceiling deck
17, porch roof and knee wall 18..20, roof deck 21, main roof 22..37, dormer deck 27.

Submodels: house.ldr (plinth to the porch columns), roof.ldr (ceiling deck up: the
upper storey and all the roofs, set on the house as one module), tree.ldr, car.ldr.
The white porch columns stand half a stud off the grid, on the centre stud of a 2 x 2
jumper plate, so they are placed as attached parts (add_raw) like bars and glass.
"""
from collections import defaultdict

import bricks
from bricks import (Model, Offset, P, PARTS, FACE, rot_matrix, row, fill_cells, place_rect,
                    WHITE, BLACK, DBG, LBG, GREEN, TAN, RBROWN, DTAN, NOUGAT, TCLEAR, TYELLOW,
                    BRGREEN, RED)
import walls
from walls import WallRing
from roofs import Roof, build_roofs

SAGE, GLOW, LIME = 378, 191, 27      # Sand Green siding, Bright Light Orange lit rooms, Lime
SIDING, TRIM, ROOF = SAGE, WHITE, DBG
FLOOR = RBROWN                       # the porch deck and steps
STONE_MIX = (DTAN, TAN, NOUGAT, DTAN, TAN, NOUGAT, TAN, DTAN, NOUGAT)

PROJECT = dict(
    main_parts_label="Lot, garden, tree and car placement",
    model_name="craftsman_house",
    pdf_name="Craftsman_Bungalow_Instructions.pdf",
    title="Craftsman Bungalow",
    subtitle="A one-and-a-half-storey Craftsman house with a stone porch, in LEGO&reg; bricks",
    cover_stats=("38 &times; 26 cm", "48 &times; 32 studs"),
    badge="Unofficial fan design",
    fine_print=("An unofficial fan-designed model (MOC), made from a photo of a Craftsman-style "
                "house. It is not affiliated with, sponsored or endorsed by The LEGO Group. "
                "LEGO&reg; is a trademark of The LEGO Group."),
    about=("This model recreates the Craftsman bungalow in the photo: sage-green siding with "
           "white trim under a dark grey roof, the front-gable bay with its stone skirting and "
           "wide lit window, the big front-gable dormer and the small shed dormer beside it, and "
           "the porch across the front with white columns on chunky stone piers, a white "
           "railing, a wooden door and steps between stone cheeks. The lot has the curved walk, "
           "mulch beds with hydrangeas, hostas and shrubs, a big shade tree on the lawn, the "
           "sidewalk and curb, a mailbox, the driveway with a grey SUV and a wooden privacy "
           "fence."),
    facts=[("Size", "48 &times; 32 studs (38.4 &times; 25.6 cm), {height} cm tall"),
           ("Scale", "about 1:76 (1 stud = 2 ft, one storey = 4 bricks)"),
           ("Build time", "about 4 to 5 hours")],
    organisation=["The lot: base, street, curb and sidewalk",
                  "The house: walls, windows and porch",
                  "The upper storey and the roofs: dormers, porch roof and main roof",
                  "The yard: driveway, walk, mulch beds and lawn",
                  "The shade tree",
                  "The garden: shrubs and flowers, mailbox and fence",
                  "The car"],
    organisation_note=("The house, its upper storey and roofs, the tree and the car are built "
                       "on their own and then set on the lot. Every section starts with a list "
                       "of the parts it needs."),
    tips=["The stone parts are masonry-profile 1&times;2 bricks in three colours. The exact "
          "colour order doesn't matter, so mix them as you like.",
          "Each white column sits on the single centre stud of a tan 2&times;2 jumper plate on "
          "top of its stone pier, so it stands in the middle of the pier. Its top stud goes "
          "into the white ceiling plate above.",
          "The orange bricks behind the big windows are the lit rooms. Slide the clear glass "
          "into each white window frame before you place it.",
          "The roofs go on one row of slopes at a time. Where the bay, the dormers and the main "
          "roof meet, the slopes step around each other to form the valleys, and a few hidden "
          "bricks hold up the slopes above them."],
    legend=("car.ldr", 1),
    sub_info={
        "house.ldr": ("The house",
                      "Sage siding with white trim, the front-gable bay with its stone skirting "
                      "and wide lit window, and the porch: a stone back wall with the door and "
                      "porch lights, chunky stone piers, white columns and the railing."),
        "roof.ldr": ("The upper storey and the roofs",
                     "The white ceiling and porch beam, the low porch roof, the big front-gable "
                     "dormer and the small shed dormer, and the roofs: the main side-gable roof "
                     "and the bay gable. Built on its own, then set on the house."),
        "tree.ldr": ("The shade tree", "A thick trunk of log bricks and a full crown of leaves."),
        "car.ldr": ("The car", "A grey SUV for the driveway."),
    },
    section_images={"The lot": "cover_high"},
    section_image_default="cover_front_right",
    hero_views=[("cover_front_right", 24, 32), ("cover_front_left", 24, -32),
                ("cover_front", 10, 0), ("cover_high", 52, 20), ("back", 28, 150)],
    cover_view="cover_front_right",
    gallery=["cover_front", "cover_front_left", "cover_high", "back"],
    substitutions=[
        "<b>Base:</b> six 16&times;16 plates. Any plates that cover 48&times;32 studs will do.",
        "<b>Stone:</b> mix the three colours of masonry bricks freely; plain bricks work too.",
        "<b>Hidden parts:</b> the plinth, the ceiling and roof decks and the fillers under the "
        "roofs can be any colour.",
        "<b>Car:</b> pick any colour to match your own car."],
    order_cap_note=("Every element in this kit was in Pick a Brick's Bestseller range, which "
                    "sells up to 999 of an element per order."),
    colour_rows=[("Sand Green", "Sand Green", "Sand Green"),
                 ("Light Bluish Gray", "Medium Stone Grey", "Light Bluish Gray"),
                 ("Dark Bluish Gray", "Dark Stone Grey", "Dark Bluish Gray"),
                 ("Green", "Dark Green", "Green"),
                 ("Tan / Dark Tan", "Brick Yellow / Sand Yellow", "Tan / Dark Tan"),
                 ("Medium Nougat", "Medium Nougat", "Medium Nougat"),
                 ("Bright Light Orange", "Flame Yellowish Orange", "Bright Light Orange"),
                 ("Lime", "Bright Yellowish Green", "Lime"),
                 ("Trans-Clear", "Transparent", "Trans-Clear"),
                 ("Trans-Yellow", "Transparent Yellow", "Trans-Yellow")],
    bestseller_only=True,
    batch_sizes=[10, 25],
)

# parts this kit adds to the catalogue
P("cb_win143", "60594.dat", "Window 1 x 4 x 3")
P("cb_glass143", "60603.dat", "Glass for Window 1 x 4 x 3", cells=[(0, 0)], bottom=[],
  height=0, solid=False, studs=[])
P("cb_log2", "30136.dat", "Brick 1 x 2 Log")
P("cb_log4", "30137.dat", "Brick 1 x 4 Log")
P("cb_leaves4x3", "2423.dat", "Plant Leaves 4 x 3", cells=[(0, 0)], studs=[(0, 0)], height=1)

# Bestseller sizes for colours the shared table doesn't cover (checked with avail.py)
EXTRA_ALLOWED = {
    ("b", SAGE): "1x1 1x2 1x4", ("p", SAGE): "1x1 1x2 1x3 1x4 1x6 2x2 2x3 2x4 2x6",
    ("t", SAGE): "1x1 1x2 1x3 1x4",
    ("b", GREEN): "1x2 2x2 2x4", ("b", DBG): "1x1 1x2 1x3 1x4 1x6 1x8 2x2 2x4",
    ("t", DBG): "1x2 1x3 1x4 1x8 2x2",
    ("b", TAN): "1x1 1x2 1x3 1x4 1x6 1x8 2x2 2x4", ("t", TAN): "1x1 1x2 1x4 1x6 2x2",
    ("b", DTAN): "1x2 1x4 2x2 2x4", ("p", DTAN): "1x2 1x4 2x4 2x6", ("t", DTAN): "1x1 1x2 2x2",
    ("b", GLOW): "1x2 1x4 2x4", ("p", GLOW): "1x2", ("t", GLOW): "1x1 1x2",
    ("b", RBROWN): "1x1 1x2 1x3 1x4 1x6 2x2 2x4", ("t", RBROWN): "1x1 1x2 1x4 1x6 2x2",
    ("t", WHITE): "1x1 1x2 1x3 1x4 1x6 1x8 2x2",
    ("p", LBG): "1x1 1x2 1x3 1x4 1x6 1x8 1x10 2x2 2x3 2x4 2x6 2x8 2x10 2x12 4x4 4x6 4x8 4x10 "
                "4x12 6x6 6x8 6x10 6x12",
    ("p", BLACK): "1x1 1x2 1x3 1x4 1x6 1x8 1x10 2x2 2x3 2x4 2x6 2x8 2x10 4x4 4x6 4x8 6x6 6x8",
}


def rect(x0, z0, w, d):
    return {(x, z) for x in range(x0, x0 + w) for z in range(z0, z0 + d)}


def stone_colour(x, z, layer):
    h = (x * 73856093) ^ (z * 19349663) ^ (layer * 83492791)
    return STONE_MIX[h % len(STONE_MIX)]


def target(m):
    return m.model if isinstance(m, Offset) else m


def window(m, x, z, layer, face="front"):
    """A white 1 x 4 x 3 window frame with its clear glass."""
    frame = m.add("cb_win143", WHITE, x, z, layer, rot=FACE[face])
    ox, oy, oz, mat, _ = frame.ldraw
    target(m).add_raw("cb_glass143", TCLEAR, (ox, oy, oz), mat, attach_to=frame)
    return frame


SNOT_FRONT = (1, 0, 0, 0, 0, -1, 0, 1, 0)    # tile bottom (+y) turned to face +z


def side_tile(m, brick, color, face, stud_y=10):
    """A 1x1 round tile on the side stud of a brick facing `face`."""
    ox, oy, oz, mat, _ = brick.ldraw
    lx, ly, lz = 0, stud_y, -18
    ry = rot_matrix(FACE[face])
    wx = ry[0] * lx + ry[2] * lz
    wz = ry[6] * lx + ry[8] * lz
    t = SNOT_FRONT
    m3 = [[ry[0], ry[1], ry[2]], [ry[3], ry[4], ry[5]], [ry[6], ry[7], ry[8]]]
    t3 = [[t[0], t[1], t[2]], [t[3], t[4], t[5]], [t[6], t[7], t[8]]]
    comp = [sum(m3[i][k] * t3[k][j] for k in range(3)) for i in range(3) for j in range(3)]
    return target(m).add_raw("tile_round1", color, (ox + wx, oy + ly, oz + wz), tuple(comp),
                             attach_to=brick)


def column(m, jumper, x, z, bottom, top, colour=WHITE):
    """A 1 x 1 column on the centre stud of a 2 x 2 jumper plate at (x, z), from
    layer `bottom` up to `top`. It stands half a stud off the grid, in the middle of
    the 2 x 2 pier; its top stud goes into the tube of the 2-wide plate above."""
    X, Z = 20 * (x + 1), 20 * (z + 1)
    L = bottom
    out = []
    while L < top:
        key = "b1x1" if top - L >= 3 else "p1x1"
        pt = PARTS[key]
        out.append(m.add_raw(key, colour, (X, -8 * L - pt.bmax_y, Z), rot_matrix(0),
                             attach_to=jumper))
        L += pt.height
    return out


def lay(m, cells, layer, material, axis="x", prev=None):
    """One course along a straight wall: runs of the same material as bricks.
    material(c) -> colour or None. Returns the seams (absolute) for staggering."""
    key = (lambda c: c[0]) if axis == "x" else (lambda c: c[1])
    cells = sorted(cells, key=key)
    seams = set()
    runs = []
    for c in cells:
        col = material(c)
        if col is None:
            continue
        if runs and runs[-1][0] == col and key(c) == key(runs[-1][1][-1]) + 1:
            runs[-1][1].append(c)
        else:
            runs.append((col, [c]))
    for col, rc in runs:
        start = key(rc[0])
        avoid = {s - start for s in (prev or ()) if 0 < s - start < len(rc)}
        new = row(m, "b", col, rc[0][0], rc[0][1], len(rc), layer, axis=axis, avoid=avoid)
        seams |= {s + start for s in new}
    return seams


# --------------------------------------------------------------------------
# the house
# --------------------------------------------------------------------------
HX0, HX1, HZ0, HZ1 = 14, 34, 16, 28          # main block x 14..33, z 16..27
BX0, BX1, FZ = 14, 22, 13                     # bay x 14..21; bay and porch front at z = 13
PX0, PX1 = 22, 34                             # porch x 22..33, z 13..15
STEPS_X = (24, 25)
PIERS = ((22, 13), (26, 13), (32, 13))        # 2 x 2 stone piers (front-left cell)
RAIL_X = (28, 29, 30, 31)
DOOR_X = (24, 25)
CASING_X = (23, 26)
COURSES = (2, 5, 8, 11, 14)                   # foundation course and the four-brick storey
CEIL = 17                                     # ceiling deck (white, the porch beam)
KNEE = 18                                     # knee wall course of the main block
DECK = 21                                     # roof deck under the main roof
MAIN_BASE = 22
DORMER_DECK = 27
DORMER_BASE = 28
SHED_X = (22, 25)                             # shed dormer x 22..24
BEAM_Z = 21                                   # inner knee wall row under the roof deck
DORMER_X = (25, 33)                           # gable dormer x 25..32


# plinth plates (x, z, w, d): they tie the porch, the steps and the walls together
PLINTH = [(23, 11, 4, 6), (BX0, FZ, 8, 4), (22, FZ, 1, 4), (27, FZ, 6, 6), (33, FZ, 1, 6),
          (HX0, 17, 2, 8), (HX0, 25, 2, 3), (32, 19, 2, 6), (32, 25, 2, 3),
          (16, 26, 8, 2), (24, 26, 8, 2)]


DORMER_ZONE = {(x, z) for x in range(22, 33) for z in range(17, 22)}   # under the dormer deck
# white ceiling plates (x, z, w, d) over the bay, the porch and the main block
CEILING = [(BX0, FZ, 8, 4), (HX0, 17, 10, 6), (24, 17, 10, 6), (HX0, 23, 10, 2),
           (24, 23, 10, 2), (HX0, 25, 10, 2), (24, 25, 10, 2), (HX0, 27, 10, 1), (24, 27, 10, 1)]
# roof deck plates (x, z, w, d): sage along the gable ends, grey elsewhere; none under
# the dormers or where the bay roof runs into the main roof
ROOF_DECK = [(HX0, 16, 1, 6), (HX0, 22, 1, 6), (HX1 - 1, 16, 1, 6), (HX1 - 1, 22, 1, 6),
             (15, 16, 1, 6), (20, 16, 2, 6), (16, 18, 4, 4), (16, 17, 1, 1), (19, 17, 1, 1),
             (15, 22, 10, 6), (25, 22, 8, 6)]


def big_windows():
    """(x, z, layer, face) of the 1 x 4 x 3 frames."""
    return [(16, FZ, 8, "front"), (28, HZ0, 8, "front")]


# 1 x 2 x 2 clear panels: (x, z, layer, rot); rot 90 runs along z
PANELS = [(HX0, 18, 8, 90), (HX0, 23, 8, 90), (HX1 - 1, 18, 8, 90), (HX1 - 1, 23, 8, 90),
          (17, HZ1 - 1, 8, 180), (23, HZ1 - 1, 8, 180), (29, HZ1 - 1, 8, 180)]
GABLE_PANELS = [(HX0, 21, MAIN_BASE + 3, 90), (HX1 - 1, 21, MAIN_BASE + 3, 90)]
DORMER_PANELS = [(23, HZ0, 21, 0), (27, HZ0, 21, 0), (29, HZ0, 21, 0)]


def panel_cells(panels):
    out = set()
    for x, z, L, rot in panels:
        cells = [(x, z), (x, z + 1)] if rot in (90, 270) else [(x, z), (x + 1, z)]
        for c in cells:
            for k in range(L, L + 6):
                out.add((c[0], c[1], k))
    return out


def roof_blocks():
    bay = Roof(BX0, BX1, FZ, 20, CEIL + 1, "z", pitch=45, color=ROOF, trim=TRIM,
               trim_ends=("start",), wall=SIDING, wall_ends=("start",), priority=0, name="bay")
    main = Roof(HX0, HX1, HZ0, HZ1, MAIN_BASE, "x", pitch=45, color=ROOF, trim=TRIM,
                trim_ends=("start", "end"), wall=gable_end_wall, priority=1, widths=(4, 2, 1),
                name="main")
    dormer = Roof(DORMER_X[0], DORMER_X[1], HZ0, 22, DORMER_BASE, "z", pitch=45, color=ROOF,
                  trim=TRIM, trim_ends=("start",), wall=SIDING, wall_ends=("start",),
                  priority=2, name="dormer")
    shed = Roof(SHED_X[0], SHED_X[1], HZ0, 22, DORMER_BASE, "x", pitch=33, color=ROOF,
                wall_ends=(), priority=2, widths=(1,), name="shed")
    return bay, main, dormer, shed


def owners(blocks):
    """Cell -> owning block, as build_roofs works it out (highest surface wins)."""
    owner, level = {}, {}
    for b in sorted(blocks, key=lambda b: b.priority):
        for c in b.cells():
            h = b.base + 3 * b.height(c)
            if c not in level or h > level[c]:
                level[c], owner[c] = h, b
    return owner


def gable_end_wall(m, cells, layer):
    """Siding in the main gable ends, with a small window in the upper floor."""
    pc = panel_cells(GABLE_PANELS)
    for x, z, L, rot in GABLE_PANELS:
        if L == layer and (x, z) in cells:
            m.add("panel1x2x2", TCLEAR, x, z, L, rot=rot)
    rest = [c for c in cells if (c[0], c[1], layer) not in pc]
    for c0, n in _runs_z(rest):
        row(m, "b", SIDING, c0[0], c0[1], n, layer, axis="z")


def _runs_z(cells):
    cells = sorted(cells, key=lambda c: (c[0], c[1]))
    out = []
    for c in cells:
        if out and out[-1][0][0] == c[0] and out[-1][0][1] + out[-1][1] == c[1]:
            out[-1] = (out[-1][0], out[-1][1] + 1)
        else:
            out.append((c, 1))
    return out


def house_cells():
    return (rect(BX0, FZ, BX1 - BX0, HZ0 - FZ) | rect(PX0, FZ, PX1 - PX0, HZ0 - FZ)
            | rect(HX0, HZ0, HX1 - HX0, HZ1 - HZ0) | rect(23, 11, 4, 2))


def build_house():
    hm = Model("house.ldr", "Craftsman house")
    m = Offset(hm, HX0, 11, 1)
    blocks = roof_blocks()
    bay, main, dormer, shed = blocks
    own = owners(blocks)

    # --- plinth: plates under the walls, porch and steps, level with the lawn ---
    for x, z, w, d in PLINTH:
        place_rect(m, "p", LBG, x, z, w, d, 1)
    m.step()

    outline = [(BX0, FZ), (BX1 - 1, FZ), (BX1 - 1, HZ0), (HX1 - 1, HZ0), (HX1 - 1, HZ1 - 1),
               (HX0, HZ1 - 1)]
    ring = WallRing(outline)
    wins = set()
    for x, z, L, face in big_windows():
        for i in range(4):
            for k in range(L, L + 9):
                wins.add((x + i, z, k))
    wins |= panel_cells(PANELS)
    bay_corners = {(BX0, FZ), (BX1 - 1, FZ)}
    back_corners = {(HX0, HZ1 - 1), (HX1 - 1, HZ1 - 1)}

    def is_bay(x, z):
        return z < HZ0 and (z == FZ or x in (BX0, BX1 - 1))

    def is_porch_wall(x, z):
        return z == HZ0 and BX1 - 1 <= x <= HX1 - 1

    def mat(x, z, layer):
        if (x, z, layer) in wins:
            return None
        if is_porch_wall(x, z):
            if x in DOOR_X and layer >= 5:
                return None
            if x in CASING_X and layer >= 5:
                return None if layer == 11 else ("b", TRIM)
            return ("stone",)
        if is_bay(x, z):
            if layer < 8:
                return ("stone",)
            return ("b", TRIM) if (x, z) in bay_corners else ("b", SIDING)
        if (x, z) in back_corners and layer >= 5:
            return ("b", TRIM)
        return ("b", SIDING)

    # glow: bricks behind the big front windows, standing on the plinth
    glow = [(16, FZ + 1), (28, HZ0 + 1)]
    for i, L in enumerate(COURSES):
        ring.course(m, L, i, mat)
        for gx, gz in glow:
            m.add("b1x4", SIDING if L < 8 else GLOW, gx, gz, L)
        if L == 2:
            porch_base(m)
        if L == 5:
            m.add("b1x2", FLOOR, DOOR_X[0], HZ0, 5)
        if L == 8:
            m.add("b1x2", FLOOR, DOOR_X[0], HZ0, 8)
            for x, z, LL, face in big_windows():
                window(m, x, z, LL, face)
            for x, z, LL, rot in PANELS:
                m.add("panel1x2x2", TCLEAR, x, z, LL, rot=rot)
        if L == 11:
            m.add("p1x2", FLOOR, DOOR_X[0], HZ0, 11)
            m.add("p1x2", TYELLOW, DOOR_X[0], HZ0, 12)
            m.add("p1x2", FLOOR, DOOR_X[0], HZ0, 13)
            for x in CASING_X:
                lamp = m.add("stud_side", BLACK, x, HZ0, 11)
                side_tile(m, lamp, TYELLOW, "front")
        if L == 14:
            m.add("b1x2", TRIM, DOOR_X[0], HZ0, 14)
        if L in (2, 5):
            piers(m, L)
        m.step()

    # --- porch: jumpers on the piers, white columns, the railing ---
    jumpers = [m.add("jumper2x2", TAN, x, z, 8) for x, z in PIERS]
    m.add("fence1x4", WHITE, RAIL_X[0], FZ, 5)
    m.step()
    m.step("Each white column stands on the single centre stud of a tan jumper plate, so "
           "it sits in the middle of its stone pier.")
    for j, (x, z) in zip(jumpers, PIERS):
        column(m, j, x, z, 9, CEIL)
    m.step()
    hm.width, hm.depth = HX1 - HX0, HZ1 - 11

    # ---------------- the upper storey and the roofs: a module of their own ----------
    rm = Model("roof.ldr", "Upper storey and roofs")
    m = Offset(rm, HX0, 11, CEIL)
    m.step("Press the three white beam plates and the two hanging ferns under the front edge "
           "of the porch ceiling plate first, then set the plate on the columns and the wall.")

    # --- ceiling deck: white plates; their front edge is the porch beam and the trim ---
    place_rect(m, "p", WHITE, PX0, FZ, 12, 4, CEIL)          # porch ceiling, tied to the wall
    # under its front edge: the porch beam between the columns and two hanging ferns
    # (press them on under the ceiling plate before you place it)
    for x in (24, 28, 30):
        m.add("p1x2", WHITE, x, FZ, CEIL - 1)
    for x, r in ((28, 0), (31, 90)):
        m.add("p1x1", ROOF, x, FZ + 1, CEIL - 1)
        m.add("leaves1", GREEN, x, FZ + 1, CEIL - 2, rot=r)
    for x, z, w, d in CEILING:
        place_rect(m, "p", WHITE, x, z, w, d, CEIL)
    m.step()

    # --- porch roof (33 degrees) and the knee wall of the main block ---
    for x in range(PX0, PX1):
        m.add("s33x1", ROOF, x, FZ, CEIL + 1, rot=FACE["front"])
    knee = WallRing([(HX0, HZ0), (HX1 - 1, HZ0), (HX1 - 1, HZ1 - 1), (HX0, HZ1 - 1)])
    front_wall = {(x, HZ0) for x in range(SHED_X[0], DORMER_X[1])}

    def knee_mat(x, z, layer):
        if own.get((x, z)) is bay or (x, z) in front_wall:
            return None
        if (x, z) in back_corners:
            return ("b", TRIM)
        return ("b", SIDING)
    knee.course(m, KNEE, 1, knee_mat)
    m.add("b1x4", ROOF, 16, BEAM_Z, KNEE)                  # inner posts under the roof deck
    for x in (16, 19):
        m.add("b1x1", ROOF, x, HZ0 + 1, KNEE)
    m.step()

    # --- the dormers' front wall (x 22..32) on the ceiling deck ---
    pc = panel_cells(DORMER_PANELS)

    def dmat(c, L):
        x, z = c
        if (x, z, L) in pc:
            return None
        if L >= 21 and x in (26, 31):
            return TRIM
        return SIDING
    prev = None
    cells = sorted(front_wall)
    for L in (18, 21, 24):
        prev = lay(m, cells, L, lambda c, L=L: dmat(c, L), prev=prev)
        if L == 21:
            for x, z, LL, rot in DORMER_PANELS:
                m.add("panel1x2x2", TCLEAR, x, z, LL, rot=rot)
    m.step()

    # --- roof deck over the main block (not under the dormers), the porch roof's top ---
    deck = rect(HX0, HZ0, HX1 - HX0, HZ1 - HZ0)
    deck -= {c for c in deck if own.get(c) is bay} | front_wall | DORMER_ZONE
    laid = set()
    for x, z, w, d in ROOF_DECK:
        place_rect(m, "p", SIDING if x in (HX0, HX1 - 1) else ROOF, x, z, w, d, DECK)
        laid |= rect(x, z, w, d)
    assert laid == deck, sorted(laid ^ deck)
    row(m, "t", ROOF, PX0, FZ + 2, PX1 - PX0, DECK)        # covers the porch roof's top studs
    m.step()

    # --- lit rooms behind the dormer windows, up to the dormer deck ---
    m.step("The orange bricks behind the dormer windows are the lit rooms.")
    for x in (22, 27):
        for L in (KNEE, KNEE + 3, KNEE + 6):
            m.add("b1x4", ROOF if L == KNEE else GLOW, x, HZ0 + 1, L)
    m.step()
    # one white deck over both dormers: its front edge is their eave trim
    fill_cells(m, "p", WHITE, DORMER_ZONE | front_wall, DORMER_DECK)
    m.step()

    build_roofs(m, list(blocks), fill_color=ROOF, support_caps=True)
    # the dormer deck carries the slopes over it: drop the fillers roofs.py put under it
    rm.items = [it for it in rm.items if not (
        it.key == "b1x1" and it.color == ROOF and it.layer + CEIL + 1 < DORMER_DECK
        and (it.x + HX0, it.z + 11) in DORMER_ZONE | front_wall)]
    merge_fillers(rm)
    rm.width, rm.depth = HX1 - HX0, HZ1 - 11
    return hm, rm


def merge_fillers(model):
    """Join the hidden 1 x 1 filler bricks that stand side by side (same step and
    layer) into 2 x 2, 1 x 3 and 1 x 2 bricks: fewer, cheaper parts."""
    groups = defaultdict(list)
    for i, it in enumerate(model.items):
        if getattr(it, "key", None) == "b1x1" and it.color == ROOF:
            groups[(it.step, it.layer)].append(i)
    new = {}                      # index of the first replaced filler -> new bricks
    drop = set()
    for (step, layer), idx in groups.items():
        cells = {(model.items[i].x, model.items[i].z): i for i in idx}
        todo = set(cells)
        shapes = [((0, 0), (1, 0), (0, 1), (1, 1)), ((0, 0), (1, 0)), ((0, 0), (0, 1))]
        for x, z in sorted(todo, key=lambda c: (c[1], c[0])):
            if (x, z) not in todo:
                continue
            for shape in shapes:
                block = [(x + dx, z + dz) for dx, dz in shape]
                if len(block) > 1 and all(b in todo for b in block):
                    xs, zs = [b[0] for b in block], [b[1] for b in block]
                    w, d = max(xs) - min(xs) + 1, max(zs) - min(zs) + 1
                    first = min(cells[b] for b in block)
                    new.setdefault(first, []).append((w, d, x, z, step, layer))
                    drop |= {cells[b] for b in block}
                    todo -= set(block)
                    break
    items = []
    for i, it in enumerate(model.items):
        for w, d, x, z, step, layer in new.get(i, []):
            pl = place_rect(model, "b", ROOF, x, z, w, d, layer)
            model.items.pop()                      # place_rect appended it; move it here
            pl.step = step
            items.append(pl)
        if i not in drop:
            items.append(it)
    model.items = items


def porch_base(m):
    """Stone along the porch front, tan plates and wooden tiles for the deck,
    and the steps between stone cheeks (course 2)."""
    porch = rect(PX0, FZ, PX1 - PX0, HZ0 - FZ) - pier_cells()
    front = {(x, FZ) for x in RAIL_X}
    for x in range(RAIL_X[0], RAIL_X[-1] + 1, 2):
        m.add("masonry", stone_colour(x, FZ, 2), x, FZ, 2)
    rest = porch - front
    floor = [(22, 15, 4), (26, 15, 4), (30, 15, 4), (28, 14, 4), (24, 13, 2), (24, 14, 2)]
    assert {(x + i, z) for x, z, n in floor for i in range(n)} == rest
    for L, kind, col in ((2, "p", TAN), (3, "p", TAN), (4, "t", FLOOR)):
        for x, z, n in floor:
            m.add(f"{kind}1x{n}", col, x, z, L)
    # steps and cheeks
    m.add("p1x2", TAN, STEPS_X[0], 12, 2)
    m.add("t1x2", FLOOR, STEPS_X[0], 12, 3)
    m.add("t1x2", FLOOR, STEPS_X[0], 11, 2)
    for x in CASING_X:
        m.add("masonry", stone_colour(x, 11, 2), x, 11, 2, rot=90)
        m.add("t1x2", TAN, x, 11, 5, rot=90)


def pier_cells():
    return set().union(*(rect(x, z, 2, 2) for x, z in PIERS))


def piers(m, L):
    """One course of the 2 x 2 stone piers; the pairs turn on every course."""
    for x, z in PIERS:
        if L % 2 == 0:
            m.add("masonry", stone_colour(x, z, L), x, z, L)
            m.add("masonry", stone_colour(x, z + 1, L), x, z + 1, L)
        else:
            m.add("masonry", stone_colour(x, z, L), x, z, L, rot=90)
            m.add("masonry", stone_colour(x + 1, z, L), x + 1, z, L, rot=90)


# --------------------------------------------------------------------------
# the shade tree
# --------------------------------------------------------------------------
BRANCHES = ((-2, 1), (3, 0), (1, -3), (0, 4))


TRUNK = 6                                     # courses of log bricks in the trunk


def build_tree():
    m = Model("tree.ldr", "Shade tree")
    for k in range(TRUNK):
        L = 3 * k
        if k % 2 == 0:
            m.add("cb_log2", RBROWN, 0, 0, L)
            m.add("cb_log2", RBROWN, 0, 1, L)
        else:
            m.add("cb_log2", RBROWN, 0, 0, L, rot=90)
            m.add("cb_log2", RBROWN, 1, 0, L, rot=90)
        if k == 3:
            m.step()
    m.step()
    # the crown: a dome of green bricks on a hub plate, ringed with leaves at three
    # heights, wide at the bottom and narrowing to a tuft on top
    T = 3 * TRUNK
    place_rect(m, "p", GREEN, -2, -3, 6, 8, T)
    m.step()
    ring1 = (((-2, -3), 0), ((3, -3), 90), ((3, 4), 180), ((-2, 4), 270),
             ((-2, 1), 315), ((3, 0), 135))
    for i, ((x, z), r) in enumerate(ring1):
        m.add("leaves6x5", BRGREEN if i % 3 == 2 else GREEN, x, z, T + 1, rot=r)
    place_rect(m, "b", GREEN, -1, -2, 2, 4, T + 1)
    place_rect(m, "b", GREEN, 1, -1, 2, 4, T + 1)
    m.step()
    ring2 = (((-1, -2), 0), ((2, 2), 180), ((-1, 1), 300), ((2, -1), 120))
    for i, ((x, z), r) in enumerate(ring2):
        m.add("leaves6x5", GREEN if i % 2 else BRGREEN, x, z, T + 4, rot=r)
    m.add("b2x2", GREEN, 0, 0, T + 4)
    m.step()
    for i, ((x, z), r) in enumerate((((0, 0), 45), ((1, 1), 225), ((1, 0), 135))):
        m.add("leaves6x5", GREEN if i % 2 == 0 else BRGREEN, x, z, T + 7, rot=r)
    m.add("leaves6x5", GREEN, 0, 0, T + 8, rot=90)
    m.step()
    m.width, m.depth = 2, 2
    return m


# --------------------------------------------------------------------------
# the car (a grey SUV, tail toward the street), as in ../house-lego
# --------------------------------------------------------------------------
def build_car():
    m = Model("car.ldr", "Grey SUV")
    body = LBG
    for x, face in ((0, "left"), (3, "right")):
        m.add("b1x1", body, x, 0, 0)
        m.add("stud_side", BLACK, x, 1, 0, rot=FACE[face])
        m.add("b1x4", body, x, 2, 0, rot=90)
        m.add("stud_side", BLACK, x, 6, 0, rot=FACE[face])
        m.add("b1x1", body, x, 7, 0)
    m.add("b2x4", body, 1, 0, 0, rot=90)
    m.add("b2x4", body, 1, 4, 0, rot=90)
    m.step()
    for brick in [it for it in m.items if it.key == "stud_side"]:
        face = {FACE["left"]: "left", FACE["right"]: "right"}[brick.rot]
        side_tile(m, brick, BLACK, face)
    m.step()
    m.add("p4x8", body, 0, 0, 3, rot=90)
    m.step()
    for x in range(4):
        m.add("b1x4", BLACK, x, 1, 4, rot=90)
        m.add("b1x1", BLACK, x, 5, 4)
    m.step()
    m.add("p4x4", body, 0, 1, 7)
    m.add("p1x4", body, 0, 5, 7)
    m.add("t1x1", RED, 0, 0, 4)
    m.add("t1x2", body, 1, 0, 4)
    m.add("t1x1", RED, 3, 0, 4)
    m.add("t2x2", body, 0, 6, 4)
    m.add("t2x2", body, 2, 6, 4)
    m.step()
    m.width, m.depth = 4, 8
    return m


# --------------------------------------------------------------------------
# the lot
# --------------------------------------------------------------------------
BASE_W, BASE_D = 48, 32
DRIVE_X = (37, 43)                  # x 37..42
DRIVE_END = 24                      # the fence row
CAR_AT = (38, 12)
TREE_AT = (6, 9)
MAILBOX = (35, 3)
FENCE_X = (34, 48)
WALK = {(24, 10), (25, 10), (24, 9), (25, 9), (26, 9), (25, 8), (26, 8), (27, 8),
        (26, 7), (27, 7), (28, 7), (29, 7), (28, 6), (29, 6), (30, 6), (31, 6)}
BED_L = rect(11, 10, 12, 3) | rect(11, 13, 3, 2)
BED_R = (rect(27, 10, 7, 3) | {(26, 10)}) - WALK
BED_S = rect(34, 10, 3, 6)


def build_main(house, roof, tree, car):
    m = Model("craftsman_house.ldr", "Craftsman bungalow")
    m.header_notes = ["Custom model of a Craftsman bungalow, generated by design.py (lego-kit)."]
    m.section("The lot", "Six 16 x 16 plates make the base. The street, the curb and the "
              "sidewalk lock the front plates together; the house locks the back ones.")
    for z in (0, 16):
        for x in (0, 16, 32):
            m.add("p16x16", DBG, x, z, 0)
    m.step()
    seams = {16, 32}
    drive = set(range(*DRIVE_X))
    # street, curb and sidewalk
    for z in (0, 1):
        row(m, "t", DBG, 0, z, BASE_W, 1, avoid=seams)
    for z in (4, 5):
        row(m, "t", LBG, 0, z, BASE_W, 1, avoid=seams)
    for x0, x1 in ((0, DRIVE_X[0]), (DRIVE_X[1], BASE_W)):
        row(m, "p", LBG, x0, 2, x1 - x0, 1, avoid={s - x0 for s in seams})
        row(m, "t", LBG, x0, 2, x1 - x0, 2, avoid={s - x0 for s in seams})
    m.step()
    m.sub(house, HX0, 11, 1)
    m.step()
    m.sub(roof, HX0, 11, CEIL)
    m.step()

    m.section("The yard", "The driveway, the curved walk to the porch steps, the mulch beds "
              "and the lawn.")
    car_cells = rect(DRIVE_X[0], CAR_AT[1], DRIVE_X[1] - DRIVE_X[0], 8)
    dcells = rect(DRIVE_X[0], 2, DRIVE_X[1] - DRIVE_X[0], 2) | \
        rect(DRIVE_X[0], 6, DRIVE_X[1] - DRIVE_X[0], DRIVE_END - 6)
    place_rect(m, "p", BLACK, CAR_AT[0], CAR_AT[1], 4, 8, 1)     # the car clips on here
    for x in (DRIVE_X[0], DRIVE_X[1] - 1):
        row(m, "t", BLACK, x, CAR_AT[1], 8, 1, axis="z")
    for z in sorted({c[1] for c in dcells - car_cells if c[0] == CAR_AT[0]}):
        row(m, "t", BLACK, DRIVE_X[0], z, DRIVE_X[1] - DRIVE_X[0], 1)
    m.step()
    fill_cells(m, "t", LBG, WALK, 1)
    for bed in (BED_L, BED_R, BED_S):
        fill_cells(m, "p", RBROWN, bed, 1)
    m.step()
    taken = rect(0, 0, BASE_W, 6) | dcells | WALK | BED_L | BED_R | BED_S | house_cells()
    lawn = rect(0, 0, BASE_W, BASE_D) - taken
    lawn |= {(x, 3) for x in range(BASE_W) if x not in drive}
    for half in ({c for c in lawn if c[1] < 16}, {c for c in lawn if c[1] >= 16}):
        fill_cells(m, "p", GREEN, half, 1)
    m.step()
    m.sub(tree, *TREE_AT, 2)
    m.step()

    m.section("The garden", "Hydrangeas, hostas and round shrubs in the beds, the mailbox by "
              "the drive, the privacy fence and the car.")
    for x, z in [(11, 13), (12, 11), (14, 10), (13, 14), (20, 12)]:
        hydrangea(m, x, z)
    for x, z in [(17, 11), (22, 11), (32, 11), (35, 13)]:
        m.add("cb_leaves4x3", LIME, x, z, 2, rot=180)
    for x, z in [(16, 12), (28, 11), (30, 12), (35, 11)]:
        shrub(m, x, z)
    m.step()
    # mailbox: a wooden post and a black box
    mx, mz = MAILBOX
    m.add("round1", RBROWN, mx, mz, 2)
    m.add("round1", RBROWN, mx, mz, 5)
    m.add("p1x2", BLACK, mx, mz - 1, 8, rot=90)
    m.add("curve2x1", BLACK, mx, mz - 1, 9)
    # privacy fence of log bricks
    x0, x1 = FENCE_X
    for L, pattern in ((2, (4, 4, 4, 2)), (5, (2, 4, 4, 4))):
        x = x0
        for n in pattern:
            m.add("cb_log4" if n == 4 else "cb_log2", RBROWN, x, DRIVE_END, L)
            x += n
    m.step()
    m.sub(car, CAR_AT[0], CAR_AT[1], 2)
    m.step()
    return m


def hydrangea(m, x, z):
    m.add("leaves1", GREEN, x, z, 2, rot=0)
    m.add("leaves1", GREEN, x, z, 3, rot=180)
    m.add("round_p1", WHITE, x, z, 4)


def shrub(m, x, z):
    m.add("leaves1", GREEN, x, z, 2, rot=90)
    m.add("cb_leaves4x3", GREEN, x, z, 3, rot=0)


def build():
    saved_allowed = dict(bricks.ALLOWED)
    saved_stone = walls.stone_colour
    bricks.ALLOWED.update({k: bricks._sizes(v) for k, v in EXTRA_ALLOWED.items()})
    walls.stone_colour = stone_colour
    try:
        (house, roof), tree, car = build_house(), build_tree(), build_car()
        main_m = build_main(house, roof, tree, car)
    finally:
        bricks.ALLOWED.clear()
        bricks.ALLOWED.update(saved_allowed)
        walls.stone_colour = saved_stone
    # Dark Tan 1 x 1 bricks aren't Bestsellers: single stones are Tan
    for mm in (house, roof, main_m):
        for it in mm.items:
            if getattr(it, "key", None) == "b1x1" and it.color == DTAN:
                it.color = TAN
    return main_m, [main_m, house, roof, tree, car]
