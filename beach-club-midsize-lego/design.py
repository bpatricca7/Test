"""Beach Club Resort, mid-size display kit (resort collection).

Build with the shared kit:  ./build.sh

The mid-size format (lego-kit/compact.py, size="midsize"): a 32 x 24 base with a
black front band; one storey = 4 plates (a course of bricks and a plate band),
1 stud is about 2 m, the same scale as the compact kit. It shows the entrance
front of the resort, facing the band and symmetric about the walk, rather than a
bigger copy of the compact kit: a steep central gable over a white porte-cochere,
two turrets flanking the entrance, and wings with white porches under cross gables.

Grid (studs): x to the right, z toward the back; the front band is z = 0..1.
  centre          x 11..20, z 14..21   four storeys of sea-green clapboard with white
                                       corner boards, under a steep front gable with a
                                       white fan window and a louvre (hipped at the back)
  turrets         x  8..10 and 21..23, z 13..15   five storeys, an open lookout on white
                                       round bricks and a pointed cap (build 2)
  wings           x  3..10 and 21..28, z 16..21   three storeys; a porch with a white
                                       column (z = 16), a balcony with a lattice railing
                                       above it, sea-green walls on top, a cross gable
                                       over the porch (mirror images; their inner ends
                                       stand behind the turrets)
  porte-cochere   x 12..19, z  8..13   six white columns, a coral fascia, a low pediment
                                       roof with white rakes and a round window
  ground          a paved walk (x 13..18) to the porte-cochere; a sandy beach strip
                  along the band (z 2..5) with three umbrellas and a lifeguard chair;
                  lawn everywhere else; palms at (3, 12) and (28, 12)
"""
from collections import defaultdict

import bricks
from bricks import (Model, PARTS, SubRef, FACE, row, fill_rect, place_rect,
                    rot_matrix, split_length, _sizes, WHITE, BLACK, LBG, GREEN, TAN)
from roofs import Roof, build_roofs
from walls import WallRing
from compact import compact_project, display_base, finish_ground, palm

SIZE = "midsize"
SAND_GREEN, CORAL = 378, 353
WALL, TRIM, WINDOW, ROOF, PLINTH, ACCENT = SAND_GREEN, WHITE, BLACK, LBG, LBG, CORAL
PAVING, SAND, LAWN = LBG, TAN, GREEN

# Bestseller sizes for colours the toolkit has no entry for (checked with avail.py);
# set only while this design builds, so other kits are unaffected
EXTRA_ALLOWED = {
    # (the 1 x 6 brick is a Bestseller too, but in fewer than 10 sets since 2024)
    ("b", SAND_GREEN): _sizes("1x1 1x2 1x4"),
    ("p", SAND_GREEN): _sizes("1x1 1x2 1x3 1x4 1x6 2x2 2x3 2x4 2x6"),
    ("p", CORAL): _sizes("2x4"),
    # light bluish gray: the toolkit's list, less the 1 x 12 plate (not a Bestseller)
    ("p", LBG): _sizes("1x1 1x2 1x3 1x4 1x6 1x8 1x10 2x2 2x3 2x4 2x6 2x8 2x10 2x12 "
                       "4x4 4x6 4x8 4x10 4x12 6x6 6x8 6x10 6x12"),
}

PROJECT = compact_project(
    size=SIZE,
    slug="beach_club",
    title="Beach Club Resort",
    resort="Disney's Beach Club Resort",
    category="Deluxe",
    merged=["Disney's Beach Club Villas"],
    about=("The Beach Club's entrance front as a seaside Victorian beach cottage, facing the "
           "viewer: a four-storey centre of pale sea-green clapboard with crisp white trim under "
           "a steep light grey gable with a white fan window; two slim turrets flanking the "
           "entrance, each with an open white lookout and a pointed cap; lower wings with white "
           "porches and lattice railings under cross gables; and a white porte-cochere with a "
           "low pediment, a round window and a coral fascia over the walk. In front, a sandy "
           "beach strip with coral-topped umbrellas and a lifeguard chair, and two palms."),
    features=["The entrance front, facing the viewer and symmetric: the porte-cochere, the "
              "central gable and the two turrets on one axis",
              "Pale sea-green clapboard walls (sand green) with white floor bands, corner "
              "boards and eaves",
              "A steep central gable with a white fan window and a louvre",
              "Two turrets flanking the entrance, with an open white lookout and a pointed "
              "light grey cap",
              "Wings with white porches: columns on the ground floor, lattice railings on the "
              "balcony above, and a cross gable over each porch",
              "A white porte-cochere on six columns, with a low pediment, a round window and "
              "a coral fascia",
              "A sandy beach strip with three coral-topped umbrellas and a lifeguard chair, "
              "and two palms"],
    omitted=["The long guest wings, the Beach Club Villas and the Yacht Club next door",
             "Stormalong Bay, the croquet lawn and the beach on Crescent Lake, which lie "
             "behind the building (the beach strip in front stands in for them)",
             "The gingerbread trim, shutters and window frames (shown as plain rows of "
             "windows)"],
    colour_rows=[("Sand Green", "Sand Green", "Sand Green"),
                 ("White", "White", "White"),
                 ("Light Bluish Gray", "Medium Stone Grey", "Light Bluish Gray"),
                 ("Coral", "Vibrant Coral", "Coral"),
                 ("Black", "Black", "Black"), ("Tan", "Brick Yellow", "Tan"),
                 ("Green", "Dark Green", "Green"),
                 ("Reddish Brown", "Reddish Brown", "Reddish Brown"),
                 ("Dark Bluish Gray", "Dark Stone Grey", "Dark Bluish Gray")],
    organisation=["The display base, the walk, the lawns and the beach", "The centre",
                  "The turrets (build 2)", "The left wing", "The right wing",
                  "The porte-cochere",
                  "The palms, the beach umbrellas and the lifeguard chair"],
    sub_info={
        "centre.ldr": ("The centre",
                       "Four storeys of sea-green clapboard with white corner boards and floor "
                       "bands, then the steep gable roof with a white fan window and a louvre "
                       "at the front."),
        "turret.ldr": ("The turrets",
                       "Two identical slim turrets: five storeys with a window on three sides, "
                       "an open lookout on four white round bricks, and a pointed cap with a "
                       "white finial."),
        "wing_left.ldr": ("The left wing",
                          "Three storeys: a porch with a white column, a balcony with a lattice "
                          "railing, then sea-green walls, under a hipped roof with a cross gable "
                          "over the porch. The inner end stands behind the turret."),
        "wing_right.ldr": ("The right wing",
                           "The mirror image of the left wing: the porch is at the right-hand "
                           "end."),
        "porte.ldr": ("The porte-cochere",
                      "Six white columns, a coral fascia and a white deck, then a low pediment "
                      "roof with white rakes and a round window. It stands over the walk in "
                      "front of the centre."),
        "palm.ldr": ("The palms", "A trunk of round bricks and two layers of fronds."),
        "umbrella.ldr": ("The beach umbrellas",
                         "A white pole, a white canopy and a coral top on its centre stud."),
        "lifeguard.ldr": ("The lifeguard chair",
                          "Four tall white legs, a seat with a high back and a coral "
                          "sunshade."),
    },
    legend=("umbrella.ldr", 1),
    tips=["Each storey is a course of sand green bricks, with black bricks for the windows and "
          "white bricks at the corners, then a ring of white plates. The rings take turns: on "
          "one storey the front and back rows hold the corners, on the next the side rows "
          "do, so the walls lock together.",
          "On the wings the porch goes up with the walls: a white column on the ground floor, "
          "a lattice fence on the balcony, each tied in by the 2-wide white plate above it.",
          "Roofs go up one row of slopes at a time. Hidden bricks under the gables and the "
          "ridges have a step of their own, just before the slopes that rest on them.",
          "The umbrella canopies and the lifeguard chair's sunshade sit on a single centre "
          "stud, half a stud off the grid.",
          "A <b>&ldquo;Build 2&rdquo;</b> badge means you build that module twice."],
    substitutions=["<b>Walls:</b> sand green bricks are used as 1&times;1, 1&times;2 and "
                   "1&times;4 only; the 1&times;6 is a Bestseller too, but rarer.",
                   "<b>Coral:</b> the kit uses only coral 2&times;4 plates and 2&times;2 round "
                   "tiles; bright pink or red ones give a similar accent."],
    build_time="about 2 to 2&frac12; hours",
)


# --------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------
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


def roofs(m, blocks, fill=WALL, **kw):
    """build_roofs(), then join hidden 1 x 1 supports that stand side by side in one
    step into 1 x 2 and 1 x 4 bricks: fewer pieces, the same support."""
    i0 = len(m.items)
    out = build_roofs(m, blocks, fill_color=fill, support_caps=True, **kw)
    head, tail = m.items[:i0], m.items[i0:]
    groups = defaultdict(list)
    for it in tail:
        if not isinstance(it, SubRef) and it.key == "b1x1" and it.color == fill:
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
                for k in split_length(n, [4, 2, 1]):
                    pieces.append((axis, *nxt(pos), k))
                    pos += k
                done |= {nxt(i) for i in range(n)}
        new = []
        for axis, x, z, k in pieces:
            pl = m.add(f"b1x{k}", fill, x, z, layer, rot=0 if axis == "x" else 90)
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


def on_centre_stud(m, part, colour, below, cx, cz, layer):
    """A part on a stud half a stud off the grid (cx, cz in stud units, the stud's
    centre); ``layer`` is the top of ``below``."""
    y = -8 * layer
    return m.add_raw(part, colour, (20 * cx, y - PARTS[part].bmax_y, 20 * cz), rot_matrix(0),
                     attach_to=below)


def runs_plates(m, colour, runs, layer):
    """Rows of 1-wide plates, (x, z, length, axis) each, with no joint next to either
    end, so the corner cells at the ends are held by the long plate."""
    for x, z, n, axis in runs:
        row(m, "p", colour, x, z, n, layer, axis=axis, avoid={1, n - 1} if n > 2 else ())


def ring_runs(W, z0, D, corners):
    """The runs of a ring of plates round x 0..W-1, z z0..z0+D-1. With corners="x" the
    front and back rows run the full width and hold the corners, with "z" the sides
    do. Alternating them from storey to storey ties the walls together at the corners,
    where the white corner boards are single bricks."""
    zb = z0 + D - 1
    if corners == "x":
        return [(0, z0, W, "x"), (0, zb, W, "x"),
                (0, z0 + 1, D - 2, "z"), (W - 1, z0 + 1, D - 2, "z")]
    return [(0, z0, D, "z"), (W - 1, z0, D, "z"), (1, z0, W - 2, "x"), (1, zb, W - 2, "x")]


# --------------------------------------------------------------------------
# centre: four storeys and a steep front gable
# --------------------------------------------------------------------------
CEN_W, CEN_D, CEN_FLOORS = 10, 8, 4
CEN_WIN = (2, 3, 6, 7)                     # window columns on the front and back


def centre_gable_wall(m, cells, layer):
    """The front gable: a pair of windows, a white fan window over them, a louvre."""
    z = cells[0][1]
    xs = sorted(c[0] for c in cells)
    if z != 0:
        for x, n in runs_x(cells):             # hidden inside the roof
            row(m, "b", WALL, x, z, n, layer)
        return
    x0 = xs[0]
    if len(xs) == 6:
        m.add("b1x1", WALL, x0, z, layer)
        m.add("b1x4", WINDOW, x0 + 1, z, layer)
        m.add("b1x1", WALL, x0 + 5, z, layer)
    elif len(xs) == 4:
        m.add("arch1x4", TRIM, x0, z, layer)
    elif len(xs) == 2:
        m.add("grille1x2", TRIM, x0, z, layer)
    else:
        for x, n in runs_x(cells):
            row(m, "b", WALL, x, z, n, layer)


def build_centre():
    m = Model("centre.ldr", "Centre")
    W, D = CEN_W, CEN_D
    runs_plates(m, PLINTH, ring_runs(W, 0, D, "x"), 0)
    m.step()
    ring = WallRing([(0, 0), (W - 1, 0), (W - 1, D - 1), (0, D - 1)])
    corners = {(0, 0), (W - 1, 0), (W - 1, D - 1), (0, D - 1)}

    for f in range(1, CEN_FLOORS + 1):
        L = storey_layer(f)

        def mat(x, z, layer, f=f):
            if (x, z) in corners:
                return ("b", TRIM)                       # white corner boards
            if z in (0, D - 1):
                if z == 0 and f == 1 and x in (4, 5):
                    return ("b", WINDOW)                 # the entrance
                return ("b", WINDOW if x in CEN_WIN else WALL)
            if f == CEN_FLOORS and z in (2, 3, 4, 5):    # sides above the wings
                return ("b", WINDOW)
            return ("b", WALL)
        ring.course(m, L, f % 2, mat)
        m.step()
        if f < CEN_FLOORS:
            runs_plates(m, TRIM, ring_runs(W, 0, D, "z" if f % 2 else "x"), L + 3)
        else:
            fill_rect(m, "p", TRIM, 0, 0, W, D, L + 3, along="z")
        m.step()
    base = storey_layer(CEN_FLOORS) + 4
    m.step("The gable roof goes up one row of slopes at a time. The white fan window and the "
           "louvre sit in the front gable.")
    gable = Roof(0, W, 0, D, base, "z", pitch=45, color=ROOF,
                 wall=centre_gable_wall, hips=("end",), name="centre gable")
    roofs(m, [gable])
    m.width, m.depth = W, D
    return m


# --------------------------------------------------------------------------
# turret: five storeys, an open lookout and a pointed cap (build 2)
# --------------------------------------------------------------------------
TUR_FLOORS = 6                              # the top one is the open lookout


def build_turret():
    m = Model("turret.ldr", "Turret (build 2)")
    fill_rect(m, "p", PLINTH, 0, 0, 3, 3, 0, along="z")
    m.step()
    ring = WallRing([(0, 0), (2, 0), (2, 2), (0, 2)])
    windows = {(1, 0), (0, 1), (2, 1)}
    for f in range(1, TUR_FLOORS + 1):
        L = storey_layer(f)
        if f < TUR_FLOORS:
            def mat(x, z, layer):
                return ("b", WINDOW if (x, z) in windows else WALL)
            ring.course(m, L, f % 2, mat)
        else:
            m.step("The lookout: four white round bricks at the corners.")
            for x, z in ((0, 0), (2, 0), (0, 2), (2, 2)):
                m.add("round1", TRIM, x, z, L)
        m.step()
        fill_rect(m, "p", TRIM, 0, 0, 3, 3, L + 3, along="z")
        m.step()
    top = storey_layer(TUR_FLOORS) + 4
    m.step("The cap: four steep slopes laid round a white round brick, like the blades of a "
           "pinwheel.")
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


# --------------------------------------------------------------------------
# wings: three storeys, white porches on the lower two, a cross gable (mirror images)
# --------------------------------------------------------------------------
WING_W, WING_D, WING_FLOORS = 8, 6, 3
PORCH_W, PORCH_FLOORS = 6, 2


def build_wing(right):
    name = "wing_right.ldr" if right else "wing_left.ldr"
    m = Model(name, "Right wing" if right else "Left wing")
    W, D = WING_W, WING_D
    # the porch runs along the open part of the front; the rest stands behind the turret
    p0 = W - PORCH_W if right else 0
    p1 = p0 + PORCH_W - 1                            # the porch's end posts
    outer = W - 1 if right else 0                     # the end wall at the base's edge
    post = p0 if right else p1                        # the free-standing post
    porch = range(p0, p1 + 1)
    inner = 0 if right else W - 1                     # the end against the centre
    rest = [x for x in range(W) if x not in porch]      # the front wall beside the porch
    zb = D - 1

    def ring_plates(colour, layer, corners):
        """The porch (a 2-wide plate) and a ring of plates round the walls behind it.
        corners="x": the front and back rows hold the corners; "z": the sides do."""
        place_rect(m, "p", colour, p0, 0, PORCH_W, 2, layer)
        r0, r1 = min(rest), max(rest)
        if corners == "x":
            runs = [(r0, 1, r1 - r0 + 1, "x"), (0, zb, W, "x"),
                    (0, 2, D - 3, "z"), (W - 1, 2, D - 3, "z")]
        else:
            r0, r1 = (r0 + 1, r1) if inner == 0 else (r0, r1 - 1)
            runs = [(r0, 1, r1 - r0 + 1, "x"), (inner, 1, D - 1, "z"),
                    (outer, 2, D - 2, "z"), (1, zb, W - 2, "x")]
        runs_plates(m, colour, runs, layer)
    ring_plates(PLINTH, 0, "z")
    m.step()
    ring = WallRing([(0, 1), (W - 1, 1), (W - 1, D - 1), (0, D - 1)])
    corners = {(0, 1), (W - 1, 1), (W - 1, D - 1), (0, D - 1)}
    win = (p0 + 2, p0 + 3)

    for f in range(1, WING_FLOORS + 1):
        L = storey_layer(f)

        def mat(x, z, layer, f=f):
            if (x, z) == (outer, 1) and f <= PORCH_FLOORS:
                return None                               # the corner post, laid below
            if (x, z) in corners:
                return ("b", TRIM if x == outer else WALL)    # a white corner board
            if z == 1:
                return ("b", WINDOW if x in win else WALL)
            if z == D - 1:
                return ("b", WINDOW if abs(x - outer) in (2, 3, 5, 6) else WALL)
            if x == outer:
                return ("b", WINDOW if z in (2, 3) else WALL)
            return ("b", WALL)                            # against the centre
        if f == 1:
            m.step("The porch: a white corner post at the outer end and a white round column "
                   "at the other.")
        ring.course(m, L, f % 2, mat)
        if f <= PORCH_FLOORS:
            m.add("b1x2", TRIM, outer, 0, L, rot=90)       # the corner board and end post
            if f == 1:
                m.add("round1", TRIM, post, 0, L)
            else:
                m.step()
                m.step("The balcony: a lattice fence between the two white posts.")
                m.add("b1x1", TRIM, post, 0, L)
                m.add("fence1x4", TRIM, p0 + 1, 0, L)
        m.step()
        if f < WING_FLOORS:
            ring_plates(TRIM, L + 3, "x" if f % 2 else "z")       # with the porch roof
        else:
            fill_rect(m, "p", TRIM, 0, 0, W, D, L + 3, along="z")   # the eaves
        m.step()
    base = storey_layer(WING_FLOORS) + 4
    roofs(m, [
        Roof(p0, p1 + 1, 0, D, base, "z", pitch=45, color=ROOF, wall=porch_gable_wall,
             name="porch gable"),
        Roof(0, W, 0, D, base, "x", pitch=45, color=ROOF,
             hips=("start",) if right else ("end",), priority=1, name="wing roof"),
    ])
    m.width, m.depth = W, D
    return m


def porch_gable_wall(m, cells, layer):
    """The gable over a porch: a window between sea-green bricks."""
    z = cells[0][1]
    if z == 0 and len(cells) == 2:
        x0 = min(c[0] for c in cells)
        m.add("b1x2", WINDOW, x0, z, layer)
        return
    for x, n in runs_x(cells):
        row(m, "b", WALL, x, z, n, layer)


# --------------------------------------------------------------------------
# porte-cochere: white columns, a coral fascia and a low pediment roof
# --------------------------------------------------------------------------
PC_W, PC_D = 8, 6
PC_COLS = [(0, 0), (2, 0), (5, 0), (7, 0), (0, 5), (7, 5)]


def porte_gable_wall(m, cells, layer):
    """The pediment: a round window in the middle."""
    z = cells[0][1]
    xs = sorted(c[0] for c in cells)
    if z == 0 and len(xs) == 2:
        m.add("tech1x2", TRIM, xs[0], z, layer)
        return
    for x, n in runs_x(cells):
        row(m, "b", TRIM, x, z, n, layer)


def build_porte():
    m = Model("porte.ldr", "Porte-cochere")
    W, D = PC_W, PC_D
    for x, z in PC_COLS:
        m.add("p1x1", PAVING, x, z, 0)
    m.step()
    for x, z in PC_COLS:
        m.add("round1", TRIM, x, z, 1)
        m.add("round1", TRIM, x, z, 4)
    m.step()
    m.step("The coral plates make a stripe of colour round the edge of the deck.")
    fill_rect(m, "p", ACCENT, 0, 0, W, D, 7, along="x", widths=[2])
    m.step()
    fill_rect(m, "p", TRIM, 0, 0, W, D, 8, along="z")
    m.step()
    m.step("The pediment: white slopes at the front and a round window in the middle.")
    roofs(m, [Roof(0, W, 0, D, 9, "z", pitch=33, color=ROOF, trim=TRIM, trim_ends=("start",),
                   wall=porte_gable_wall, hips=("end",), name="porte roof")], fill=TRIM)
    m.width, m.depth = W, D
    return m


# --------------------------------------------------------------------------
# details
# --------------------------------------------------------------------------
def build_umbrella():
    """A beach umbrella: a white pole, a white dome and a coral top on its centre stud."""
    m = Model("umbrella.ldr", "Beach umbrella")
    m.add("round1", TRIM, 0, 0, 0)
    pole = m.add("round1", TRIM, 0, 0, 3)
    m.step()
    canopy = on_centre_stud(m, "dish2", TRIM, pole, 0.5, 0.5, 6)
    on_centre_stud(m, "tile_round2", ACCENT, canopy, 0.5, 0.5, 6 + PARTS["dish2"].height)
    m.step()
    m.width, m.depth = 1, 1
    return m


def build_lifeguard():
    """A lifeguard chair: four tall white legs, a seat with a high back and a coral
    sunshade on a short pole."""
    m = Model("lifeguard.ldr", "Lifeguard chair")
    for x in (0, 2):
        for z in (0, 1):
            m.add("round1", TRIM, x, z, 0)
            m.add("round1", TRIM, x, z, 3)
    m.step()
    m.add("p2x3", TRIM, 0, 0, 6)
    m.add("b1x3", TRIM, 0, 1, 7)
    m.add("t1x3", TRIM, 0, 0, 7)
    m.step()
    pole = m.add("round1", TRIM, 1, 1, 10)
    on_centre_stud(m, "tile_round2", ACCENT, pole, 1.5, 1.5, 13)
    m.step()
    m.width, m.depth = 3, 2
    return m


# --------------------------------------------------------------------------
# main model
# --------------------------------------------------------------------------
CX, CZ = 11, 14
TURRETS = ((8, 13), (21, 13))
WINGS = ((3, 16), (21, 16))
PX, PZ = 12, 8
WALK = range(13, 19)
BEACH_Z = range(2, 6)
PALMS = ((3, 12), (28, 12))
UMBRELLAS = ((4, 3), (9, 4), (22, 4))
LIFEGUARD = (26, 2)


def rect(x0, z0, w, d):
    return {(x, z) for x in range(x0, x0 + w) for z in range(z0, z0 + d)}


def ground_colour(x, z):
    if x in WALK and z < PZ:
        return PAVING
    if PX <= x < PX + PC_W and PZ <= z < CZ:
        return PAVING
    if z in BEACH_Z:
        return SAND
    return LAWN


def build_main(centre, turret, wings, porte, tree, umbrella, chair):
    m = Model("beach_club_midsize.ldr", "Beach Club Resort (mid-size)")
    m.header_notes = ["Mid-size resort collection; generated by design.py (lego-kit)."]
    m.section("The display base", "The base and the black band are the same for every "
              "mid-size kit. The walk, the lawns and the beach go on next.")
    band = display_base(m, SIZE)
    reserved = set(band)
    reserved |= rect(CX, CZ, CEN_W, CEN_D)
    for tx, tz in TURRETS:
        reserved |= rect(tx, tz, 3, 3)
    for wx, wz in WINGS:
        reserved |= rect(wx, wz, WING_W, WING_D)
    reserved |= {(PX + x, PZ + z) for x, z in PC_COLS}
    lx, lz = LIFEGUARD
    reserved |= set(UMBRELLAS) | {(lx + x, lz + z) for x in (0, 2) for z in (0, 1)}
    finish_ground(m, reserved, LAWN, colour_at=ground_colour, size=SIZE)
    m.step()
    m.sub(centre, CX, CZ, 1)
    m.step()
    for tx, tz in TURRETS:
        m.sub(turret, tx, tz, 1)
    m.step()
    for w, (wx, wz) in zip(wings, WINGS):
        m.sub(w, wx, wz, 1)
        m.step()
    m.sub(porte, PX, PZ, 1)
    m.step()
    m.section("The palms, the beach umbrellas and the lifeguard chair",
              "Palms on the lawn, coral umbrellas and a lifeguard chair on the beach.")
    for px, pz in PALMS:
        m.sub(tree, px, pz, 2)                 # on the lawn plates
    m.step()
    for ux, uz in UMBRELLAS:
        m.sub(umbrella, ux, uz, 1)
    m.sub(chair, *LIFEGUARD, 1)
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
    centre = build_centre()
    turret = build_turret()
    wings = [build_wing(False), build_wing(True)]
    porte = build_porte()
    tree = palm(trunk=6)
    umbrella = build_umbrella()
    chair = build_lifeguard()
    main_m = build_main(centre, turret, wings, porte, tree, umbrella, chair)
    return main_m, [main_m, centre, turret] + wings + [porte, tree, umbrella, chair]
