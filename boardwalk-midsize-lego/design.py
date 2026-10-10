"""BoardWalk Inn, mid-size display kit (resort collection).

Build with the shared kit:  ./build.sh

The mid-size format (lego-kit/compact.py, size="midsize"): a 32 x 24 base with a
black front band; one storey = 4 plates (a course of bricks and a plate band),
1 stud is about 2 m, the same scale as the compact kit. It is a smaller version of
the large build's entrance front, with the inn on either side of it.

Grid (studs): x to the right, z toward the back; the front band is z = 0..1.
The model faces the front band (-z) and is symmetric: x pairs with 31 - x.
  entrance    x  7..24, z 12..18   white front wall two studs thick with the big round
                                   arch over x 11..20, gold dots for the sign, portholes,
                                   the roofline rising in curved steps with a dark roof
                                   edge behind it, the warm passage to the lobby doors
  towers      walls x 7..11 and 20..24, z 14..18, on the roof deck (build 2): windows,
                                   dark pyramid roofs, white spires
  wings       x  1..6 and 25..30, z 13..18   the inn on either side of the entrance: a
                                   porch with white columns and a railing, then two
                                   storeys of sand green clapboard (stacked plates) with
                                   windows, low dark hipped roofs (mirror images)
  drive       x 11..20, z 2..11 into the arch, with the red-and-blue painted curb
  garden      lamp posts (9, 3) and (22, 3), topiaries (9, 10) and (22, 10), red flower
              borders along the wings at z = 12
"""
import bricks
from bricks import (Model, PARTS, FACE, row, fill_rect, fill_cells, place_rect, split_length,
                    WHITE, BLACK, DBG, LBG, RED, BLUE, GREEN, TAN, RBROWN, GOLD)
from roofs import Roof, build_roofs
from walls import WallRing
from compact import compact_project, display_base, finish_ground

SIZE = "midsize"
SAND_GREEN = 378
WALL, ROOF, WINDOW, PASSAGE, DOOR, PLINTH, DOTS = WHITE, DBG, BLACK, TAN, RBROWN, LBG, GOLD
CLAP, TRIM, IRON = SAND_GREEN, WHITE, BLACK

PROJECT = compact_project(
    size=SIZE,
    slug="boardwalk",
    title="BoardWalk Inn",
    resort="Disney's BoardWalk Inn",
    category="Deluxe",
    merged=["Disney's BoardWalk Villas"],
    about=("The arrival front of the BoardWalk Inn, as a smaller version of the large build: "
           "the white entrance with its big round arch, a ring of gold dots where the sign's "
           "letters run over it, two dark portholes and the roofline rising in curved steps "
           "to a flat top, with a dark roof edge behind it; two towers on the roof with dark "
           "pyramid roofs and white spires; and on either side the inn itself, with a porch "
           "of white columns and a railing below two storeys of sea-green clapboard, under "
           "low dark hipped roofs. The drive with its red-and-blue painted curb runs into the "
           "arch between lamp posts and topiaries, and red flowers line the porches."),
    features=["White entrance front with the big round arch, stepped in with inverted slopes, "
              "and the warm passage to the lobby doors",
              "A ring of gold dots around the arch where the sign's letters are, and two dark "
              "portholes",
              "The roofline rising in curved steps to a flat top, with a dark roof edge "
              "behind it",
              "Two towers on the roof with windows, dark pyramid roofs and white spires",
              "The inn on either side: sea-green clapboard of stacked plates with windows, a "
              "porch with white columns and a lattice railing, and a low dark hipped roof",
              "The drive with its red-and-blue painted curb, two lamp posts, two topiaries "
              "and red flower borders"],
    omitted=["The cream lookout on the roof and the oval flower bed of the large build",
             "The rest of the inn's guest wings and the BoardWalk Villas buildings",
             "The boardwalk itself, the lake and the shops"],
    colour_rows=[("White", "White", "White"),
                 ("Sand Green", "Sand Green", "Sand Green"),
                 ("Dark Bluish Gray", "Dark Stone Grey", "Dark Bluish Gray"),
                 ("Pearl Gold", "Warm Gold", "Pearl Gold"),
                 ("Red / Blue", "Bright Red / Bright Blue", "Red / Blue"),
                 ("Tan", "Brick Yellow", "Tan"),
                 ("Reddish Brown", "Reddish Brown", "Reddish Brown"),
                 ("Black", "Black", "Black"),
                 ("Light Bluish Gray", "Medium Stone Grey", "Light Bluish Gray"),
                 ("Green", "Dark Green", "Green")],
    organisation=["The display base, the lawns and the drive", "The entrance",
                  "The towers (build 2)", "The left wing", "The right wing",
                  "The garden: lamp posts, topiaries and flowers"],
    sub_info={
        "gatehouse.ldr": ("The entrance",
                          "The white front wall with the big round arch, the warm passage "
                          "behind it, the gold dots of the sign, the roof deck, and the "
                          "curved roofline with its dark edge."),
        "tower.ldr": ("The towers",
                      "Two identical towers for the roof deck, each with windows, a dark "
                      "pyramid roof and a white spire."),
        "wing_left.ldr": ("The left wing",
                          "A porch of white columns and a railing, two storeys of sea-green "
                          "clapboard with windows, and a low dark hipped roof."),
        "wing_right.ldr": ("The right wing",
                           "The mirror image of the left wing: its clapboard side with the "
                           "windows faces right."),
        "lamp.ldr": ("The lamp posts", "A black post with a white globe."),
        "topiary.ldr": ("The topiaries", "Green cones of round bricks and leaves."),
    },
    legend=("topiary.ldr", 1),
    tips=["The front wall is two studs thick, so the arch has a deep reveal. The arch steps "
          "in with inverted slopes, then the raised 1&times;6 arch closes it; the sloped side "
          "of each inverted slope faces the middle of the arch.",
          "Each gold dot is a gold round brick on the side stud of a white brick in the inner "
          "row; it fills the gap left in the outer row. The two dark portholes are made the "
          "same way with black round bricks.",
          "The wings' clapboard is three sand green plates per storey. Put the black window "
          "bricks in first, then lay the plates around them one layer at a time; their "
          "joints are staggered.",
          "The two wings are mirror images, each with its own pages: the clapboard side with "
          "the windows faces out, and the side that stands against the entrance stays open.",
          "Slide each lamp's white globe down over the top of the black bar, until the bar's "
          "end is level with the top of the globe.",
          "A <b>&ldquo;Build 2&rdquo;</b> badge means you build that module twice."],
    build_time="about 2 to 2&frac12; hours",
)

SNOT_FRONT = (1, 0, 0, 0, 0, -1, 0, 1, 0)    # part bottom (+y) turned to face +z


def round_face(m, brick, colour):
    """A round brick on the front side stud of `brick`, filling the cell in front."""
    ox, oy, oz, _, _ = brick.ldraw
    return m.add_raw("round1", colour, (ox, oy + 10, oz - 34), SNOT_FRONT, attach_to=brick)


def runs(xs):
    """Contiguous runs [(x0, n)] of a set of columns."""
    out = []
    for x in sorted(xs):
        if out and out[-1][0] + out[-1][1] == x:
            out[-1] = (out[-1][0], out[-1][1] + 1)
        else:
            out.append((x, 1))
    return out


def lay(m, kind, colour, cells, line, layer, prev, axis="x", sizes=None):
    """1-wide pieces over the positions `cells` of row z = line (axis "x") or of
    column x = line (axis "z"), joints staggered from `prev` (absolute positions);
    returns the joints used."""
    seams = set()
    for p0, n in runs(cells):
        avoid = {s - p0 for s in prev if 0 < s - p0 < n}
        if axis == "x":
            used = row(m, kind, colour, p0, line, n, layer, avoid=avoid, sizes=sizes)
        else:
            used = row(m, kind, colour, line, p0, n, layer, axis="z", avoid=avoid, sizes=sizes)
        seams |= {s + p0 for s in used} | {p0, p0 + n}
    return seams


def rect(x0, z0, w, d):
    return {(x, z) for x in range(x0, x0 + w) for z in range(z0, z0 + d)}


# --------------------------------------------------------------------------
# the entrance (local grid): front wall z = 0..1, the arch over x = 4..13
# --------------------------------------------------------------------------
GW, GD = 18, 7
COURSES = (1, 4, 7, 10, 13, 16, 19)          # front wall; the other walls stop below DECK
DECK = 19
TOP = 22                                     # top of the front wall's last full course
OPEN = range(4, 14)                          # the arch opening, 10 wide
STEPS = ((7, 3), (10, 4), (13, 5))           # (course, x): inverted slope over x, x + 1
ARCH_L, ARCH_X = 16, 6                       # raised 1x6 arch over x 6..11
DOT_CELLS = ([(3, 10), (4, 13), (5, 16)] + [(x, 19) for x in range(6, 12)]
             + [(12, 16), (13, 13), (14, 10)])
PORTHOLES = [(1, 13), (16, 13)]
PASSAGE_BACK = 3                             # the lobby wall behind the passage


def front_gap(L):
    """Columns of course L left to the arch: the opening, the slopes or the arch."""
    if L < STEPS[0][0]:
        return set(OPEN)
    for SL, sx in STEPS:
        if L == SL:
            return set(range(sx, GW - sx))
    if L == ARCH_L:
        return set(range(ARCH_X, GW - ARCH_X))
    return set()


def build_gatehouse():
    m = Model("gatehouse.ldr", "Entrance")
    # the plinth: under the walls and the passage floor (the middle stays open)
    plinth = (rect(0, 0, GW, PASSAGE_BACK + 1) | rect(0, 0, 1, GD) | rect(GW - 1, 0, 1, GD)
              | rect(0, GD - 1, GW, 1))
    fill_cells(m, "p", PLINTH, plinth, 0)
    m.step()
    ring = WallRing([(0, 0), (GW - 1, 0), (GW - 1, GD - 1), (0, GD - 1)])

    def rear(x, z, layer, i):
        if z == 0 or (z == 1 and not (i % 2 == 1 and x in (0, GW - 1))):
            return None                      # the front wall is laid row by row
        if x in (0, GW - 1) and z in (3, 5) and layer == 16:
            return ("b", WINDOW)
        return ("b", WALL)

    # the floor of the arch and the passage
    for z in range(PASSAGE_BACK):
        row(m, "t", PLINTH, OPEN.start, z, len(OPEN), 1)
    m.step()
    prev = {0: set(), 1: set()}
    pprev = set()
    dots, holes = [], []
    for i, L in enumerate(COURSES):
        # the front wall: two bricks thick, 2-wide bricks where both rows are solid
        dot_x = {x for x, DL in DOT_CELLS + PORTHOLES if DL == L}
        gap = front_gap(L)
        rows = {}
        for z in (0, 1):
            cells = set(range(GW)) - dot_x - gap
            if z == 1 and i % 2 == 1 and L < DECK:
                cells -= {0, GW - 1}         # the side walls take the corners
            rows[z] = cells
        joints = set()
        for x0, n in runs(rows[0] & rows[1]):
            pieces = split_length(n, [4, 3, 2],
                                  {s - x0 for s in prev[0] | prev[1] if 0 < s - x0 < n})
            if n < 2 or pieces is None:
                continue
            x = x0
            for p in pieces:
                m.add(f"b2x{p}", WALL, x, 0, L)
                for k in range(p):
                    rows[0].discard(x + k)
                    rows[1].discard(x + k)
                x += p
                joints |= {x0, x}
        for z in (0, 1):
            prev[z] = lay(m, "b", WALL, rows[z], z, L, prev[z]) | joints
        for x in sorted(dot_x):
            b = m.add("stud_side", WALL, x, 1, L)
            (holes if (x, L) in PORTHOLES else dots).append(b)
        for SL, sx in STEPS:
            if L == SL:
                for z in (0, 1):
                    m.add("slope45inv", WALL, sx, z, L, rot=FACE["right"])
                    m.add("slope45inv", WALL, GW - 2 - sx, z, L, rot=FACE["left"])
        if L == ARCH_L:
            for z in (0, 1):
                m.add("arch1x6r", WALL, ARCH_X, z, L)
        m.step()
        if L >= DECK:
            continue
        # side and back walls (the rear ring takes the corners on odd courses)
        ring.course(m, L, i, lambda x, z, layer, i=i: rear(x, z, layer, i))
        # the passage behind the arch: warm side walls and the lobby doors
        for x in (3, GW - 4):
            m.add("b1x1", PASSAGE, x, 2, L)
        if L < 7:
            row(m, "b", PASSAGE, 3, PASSAGE_BACK, 4, L)
            row(m, "b", DOOR, 7, PASSAGE_BACK, 4, L, sizes=[2])
            row(m, "b", PASSAGE, 11, PASSAGE_BACK, 4, L)
        else:
            pprev = lay(m, "b", PASSAGE, range(3, GW - 3), PASSAGE_BACK, L, pprev,
                        sizes=[8, 4])
        m.step()
    # the roof deck behind the front wall: dark grey, its studs show between the towers
    for x in range(0, GW, 6):
        place_rect(m, "p", ROOF, x, 2, 6, GD - 3, DECK)
    row(m, "p", ROOF, 0, GD - 1, GW, DECK, avoid={6, 12}, sizes=[6, 3])
    m.step()
    # gold dots for the letters of the sign, and the dark portholes
    for b in dots:
        round_face(m, b, DOTS)
    for b in holes:
        round_face(m, b, WINDOW)
    m.step()
    # the curved roofline: the front row rises toward the middle in curved steps
    lay(m, "b", WALL, range(3, GW - 3), 0, TOP, prev[0])
    m.add("curve3", WALL, 0, 0, TOP, rot=FACE["left"])
    m.add("curve3", WALL, GW - 3, 0, TOP, rot=FACE["right"])
    m.step()
    lay(m, "b", WALL, range(6, GW - 6), 0, TOP + 3, {9})
    m.add("curve3", WALL, 3, 0, TOP + 3, rot=FACE["left"])
    m.add("curve3", WALL, GW - 6, 0, TOP + 3, rot=FACE["right"])
    m.step()
    row(m, "t", WALL, 6, 0, GW - 12, TOP + 6)
    m.step()
    # the dark roof edge behind it, one plate higher
    for x0 in (0, GW - 3):
        row(m, "p", ROOF, x0, 1, 3, TOP)
    for x0 in (3, GW - 6):
        row(m, "b", ROOF, x0, 1, 3, TOP)
    row(m, "b", ROOF, 6, 1, GW - 12, TOP, sizes=[3])
    m.step()
    m.add("curve3", ROOF, 0, 1, TOP + 1, rot=FACE["left"])
    m.add("curve3", ROOF, GW - 3, 1, TOP + 1, rot=FACE["right"])
    for x0 in (3, GW - 6):
        row(m, "p", ROOF, x0, 1, 3, TOP + 3)
    row(m, "b", ROOF, 6, 1, GW - 12, TOP + 3, sizes=[3])
    m.step()
    m.add("curve3", ROOF, 3, 1, TOP + 4, rot=FACE["left"])
    m.add("curve3", ROOF, GW - 6, 1, TOP + 4, rot=FACE["right"])
    row(m, "p", ROOF, 6, 1, GW - 12, TOP + 6)
    m.step()
    row(m, "t", ROOF, 6, 1, GW - 12, TOP + 7, sizes=[3])
    m.step()
    m.width, m.depth = GW, GD
    return m


# --------------------------------------------------------------------------
# tower (build 2): white walls, windows, dark pyramid roof, white spire
# --------------------------------------------------------------------------
TW = 7                                       # the eaves; the walls are x, z = 1..5


def build_tower():
    m = Model("tower.ldr", "Tower (build 2)")
    # the plinth: four 2x3 plates in a pinwheel (the middle stays open)
    for x, z, sx, sz in ((1, 1, 3, 2), (4, 1, 2, 3), (3, 4, 3, 2), (1, 3, 2, 3)):
        place_rect(m, "p", WALL, x, z, sx, sz, 0)
    m.step()
    ring = WallRing([(1, 1), (TW - 2, 1), (TW - 2, TW - 2), (1, TW - 2)])
    ring_cells = set(ring.cells())

    def mat(x, z, layer):
        # windows: the lower row only on the sides (the front is behind the roofline)
        if layer > 4 and z in (1, TW - 2) and x in (2, 4):
            return ("b", WINDOW)
        if layer > 1 and x in (1, TW - 2) and z in (2, 4):
            return ("b", WINDOW)
        return ("b", WALL)
    for i, L in enumerate((1, 4)):
        ring.course(m, L, i, mat)
        m.step()
    fill_cells(m, "p", WALL, ring_cells, 7)
    m.step()
    ring.course(m, 8, 0, mat)
    m.step()
    # the eaves: strips of white plates that each cross the walls
    for k, (z, w) in enumerate(((0, 2), (2, 1), (3, 2), (5, 2))):
        a, b = (4, 3) if k % 2 == 0 else (3, 4)
        for x, n in ((0, a), (a, b)):
            place_rect(m, "p", WALL, x, z, n, w, 11)
    m.step()
    B = 12
    for L in (B, B + 3):
        m.add("b1x1", WALL, 3, 3, L)                 # post for the spire (hidden)
    build_roofs(m, [Roof(0, TW, 0, TW, B, "x", pitch=45, color=ROOF, hips=("start", "end"),
                         widths=(4, 2, 1), name="tower roof")],
                keep_open={(3, 3)}, support_caps=True)
    base = m.add("round1", WALL, 3, 3, B + 6)
    top = -8 * (B + 9)                               # top of the round brick
    bar_y = top + 4 - 80
    bar = m.add_raw("bar4", WALL, (70, bar_y, 70), bricks.rot_matrix(0), attach_to=base)
    m.add_raw("cone1", WALL, (70, bar_y + 6 - PARTS["cone1"].bmax_y, 70), bricks.rot_matrix(0),
              attach_to=bar)
    m.step()
    m.width, m.depth = TW, TW
    return m


# --------------------------------------------------------------------------
# wings: a porch, then two storeys of clapboard (mirror images)
# --------------------------------------------------------------------------
WING_W, WING_D, WING_FLOORS = 6, 6, 3
FRONT_WINDOWS = (1, 4)
SIDE_WINDOWS = (2, 3)


def build_wing(right):
    """The ground floor stands one stud back behind a porch of white columns and a
    railing; the floor band over it carries the upper storeys flush with the front.
    The walls facing the viewer are clapboard: three plates per storey. The side
    against the entrance stays open: the entrance's side wall closes it."""
    name = "wing_right.ldr" if right else "wing_left.ldr"
    m = Model(name, "Right wing" if right else "Left wing")
    W, D = WING_W, WING_D
    out_x = W - 1 if right else 0            # the clapboard side, facing out
    place_rect(m, "p", PLINTH, 0, 0, W, D, 0)
    m.step()
    prev_f, prev_s, prev_b = set(), set(), set()
    for f in range(1, WING_FLOORS + 1):
        L = 1 + 4 * (f - 1)
        zf = 1 if f == 1 else 0              # the front wall's row
        if f == 1:
            m.step("The porch: white columns at the corners and a white railing between them. "
                   f"The {'left' if right else 'right'}-hand side stays open: it stands "
                   "against the entrance.")
            for x in (0, W - 1):
                m.add("round1", TRIM, x, 0, L)
            m.add("fence1x4", TRIM, 1, 0, L)
        # windows first, then three layers of clapboard plates around them
        for x in FRONT_WINDOWS:
            m.add("b1x1", WINDOW, x, zf, L)
        for z in SIDE_WINDOWS:
            m.add("b1x1", WINDOW, out_x, z, L)
        front = [x for x in range(W) if x not in FRONT_WINDOWS]
        side = [z for z in range(zf + 1, D - 1) if z not in SIDE_WINDOWS]
        for k in range(3):
            own = (k + f) % 2 == 0                         # the front run takes the corner
            fx = [x for x in front if own or x != out_x]
            sz = side + ([] if own else [zf])
            prev_f = lay(m, "p", CLAP, fx, zf, L + k, prev_f)
            prev_s = lay(m, "p", CLAP, sz, out_x, L + k, prev_s, axis="z")
        # the back wall: plain sand green bricks
        prev_b = lay(m, "b", CLAP, range(W), D - 1, L, prev_b)
        m.step()
        if f < WING_FLOORS:
            # the floor band: across the front (the porch roof), the outer side, the back
            place_rect(m, "p", TRIM, 0, 0, W, 2, L + 3)
            place_rect(m, "p", TRIM, out_x, 2, 1, D - 3, L + 3)
            place_rect(m, "p", TRIM, 0, D - 1, W, 1, L + 3)
        else:
            fill_rect(m, "p", TRIM, 0, 0, W, D, L + 3, along="z")
        m.step()
    base = 1 + 4 * WING_FLOORS
    build_roofs(m, [Roof(0, W, 0, D, base, "x", pitch=33, color=ROOF, hips=("start", "end"),
                         name="wing roof")], fill_color=ROOF, support_caps=True)
    m.width, m.depth = W, D
    return m


# --------------------------------------------------------------------------
# details
# --------------------------------------------------------------------------
def build_lamp():
    """A black foot, a black 4L bar for the post and a white globe slid down over its top."""
    m = Model("lamp.ldr", "Lamp post (build 2)")
    foot = m.add("round_p1", IRON, 0, 0, 0)
    m.step()
    c = 10                                   # centre of the stud cell, in LDU
    bar_y = -8 + 4 - 80                      # bar pushed 4 LDU into the foot's open stud
    bar = m.add_raw("bar4", IRON, (c, bar_y, c), bricks.rot_matrix(0), attach_to=foot)
    globe_y = bar_y + 24 - PARTS["round1"].bmax_y      # the globe's top level with the bar's
    m.add_raw("round1", TRIM, (c, globe_y, c), bricks.rot_matrix(0), attach_to=bar)
    m.step()
    m.width, m.depth = 1, 1
    return m


def build_topiary():
    m = Model("topiary.ldr", "Topiary (build 2)")
    m.add("round1", GREEN, 0, 0, 0)
    m.add("leaves1", GREEN, 0, 0, 3, rot=0)
    m.step()
    m.add("round1", GREEN, 0, 0, 4)
    m.add("leaves1", GREEN, 0, 0, 7, rot=90)
    m.add("cone1", GREEN, 0, 0, 8)
    m.step()
    m.width, m.depth = 1, 1
    return m


# --------------------------------------------------------------------------
# main model
# --------------------------------------------------------------------------
GX, GZ = 7, 12                               # the entrance's corner on the base
TOWERS = ((GX - 1, GZ + 1), (GX + GW - 6, GZ + 1))
WINGS = ((1, 13), (25, 13))
DRIVE = range(GX + OPEN.start, GX + OPEN.stop)
CURB = (DRIVE.start - 1, DRIVE.stop)
LAMPS = ((9, 3), (22, 3))
TOPIARIES = ((9, 10), (22, 10))
FLOWER_Z = WINGS[0][1] - 1                   # a border along the front of each wing


def ground_colour(x, z):
    if z < GZ and x in DRIVE:
        return LBG
    if 2 <= z < GZ and x in CURB:
        return RED if z % 2 == 0 else BLUE
    return GREEN


def build_main(gatehouse, tower, wings, lamp, topiary):
    m = Model("boardwalk_midsize.ldr", "BoardWalk Inn (mid-size)")
    m.header_notes = ["Mid-size resort collection; generated by design.py (lego-kit)."]
    m.section("The display base", "The base and the black band are the same for every "
              "mid-size kit. The lawns, the drive and its painted curb go on next.")
    band = display_base(m, SIZE)
    reserved = set(band) | rect(GX, GZ, GW, GD)
    for wx, wz in WINGS:
        reserved |= rect(wx, wz, WING_W, WING_D)
    finish_ground(m, reserved, GREEN, colour_at=ground_colour, size=SIZE)
    m.step()
    m.sub(gatehouse, GX, GZ, 1)
    m.step()
    for tx, tz in TOWERS:
        m.sub(tower, tx, tz, 1 + DECK + 1)
    m.step()
    for w, (wx, wz) in zip(wings, WINGS):
        m.sub(w, wx, wz, 1)
        m.step()
    m.section("The garden", "Two lamp posts at the drive, two topiaries in front of the "
              "arch and a border of red flowers along each wing finish the lawn.")
    for x, z in LAMPS:
        m.sub(lamp, x, z, 2)
    for x, z in TOPIARIES:
        m.sub(topiary, x, z, 2)
    m.step()
    # red flowers and green leaves in front of the wings' porches
    for wx, _ in WINGS:
        for i in range(WING_W):
            x = wx + i
            if (i % 2 == 0) == (wx < GX):
                m.add("flower1", RED, x, FLOWER_Z, 2)
            else:
                m.add("leaves1", GREEN, x, FLOWER_Z, 2, rot=90 * (x % 4))
    m.step()
    return m


def build():
    saved = dict(bricks.ALLOWED)
    # Bestseller sizes (checked with avail.py)
    bricks.ALLOWED[("p", SAND_GREEN)] = bricks._sizes("1x1 1x2 1x3 1x4 1x6 2x2 2x4")
    bricks.ALLOWED[("b", SAND_GREEN)] = bricks._sizes("1x1 1x2 1x4")
    bricks.ALLOWED[("p", LBG)] = bricks.ALLOWED[("p", LBG)] - {(1, 12)}
    # fewer part lines: dark grey tiles only in the sizes the roofs already use
    bricks.ALLOWED[("t", ROOF)] = bricks._sizes("1x1 1x2 1x3")
    try:
        return _build()
    finally:
        bricks.ALLOWED.clear()
        bricks.ALLOWED.update(saved)


def _build():
    gatehouse, tower = build_gatehouse(), build_tower()
    wings = [build_wing(False), build_wing(True)]
    lamp, topiary = build_lamp(), build_topiary()
    main_m = build_main(gatehouse, tower, wings, lamp, topiary)
    return main_m, [main_m, gatehouse, tower] + wings + [lamp, topiary]
