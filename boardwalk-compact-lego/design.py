"""BoardWalk Inn, compact display kit (resort collection).

Build with the shared kit:  ./build.sh

The compact format (lego-kit/compact.py): a 24 x 16 base with a black front
band; one storey = 4 plates (a course of bricks and a plate band), 1 stud is about 2 m.

Grid (studs): x to the right, z toward the back; the front band is z = 0..1.
  gatehouse   x  4..19, z 8..13   white walls, the big round arch over x 9..14,
              gold dots for the sign, a curved roofline, a grey roof deck
  towers      walls x 4..8 and 15..19, z 9..13 (eaves one stud wider), on the roof deck:
              dark pyramid roofs, white spires
  drive       x  9..14, z 2..7 into the arch, with a red-and-blue painted curb
  topiaries   (6, 5) and (17, 5)
"""
from bricks import (Model, PARTS, FACE, rot_matrix, row, fill_rect, fill_cells, place_rect,
                    split_length,
                    WHITE, BLACK, DBG, LBG, RED, BLUE, GREEN, TAN, RBROWN, GOLD)
from roofs import Roof, build_roofs
from walls import WallRing
from compact import compact_project, display_base, finish_ground

WALL, ROOF, WINDOW, PASSAGE, DOOR, PLINTH, DOTS = WHITE, DBG, BLACK, TAN, RBROWN, LBG, GOLD

PROJECT = compact_project(
    slug="boardwalk",
    title="BoardWalk Inn",
    resort="Disney's BoardWalk Inn",
    category="Deluxe",
    merged=["Disney's BoardWalk Villas"],
    about=("The entrance of the BoardWalk Inn: the white gatehouse with its big round arch, "
           "a ring of gold dots where the sign's letters run over it and a curved roofline, "
           "two towers with dark pyramid roofs and white spires, and the drive with its "
           "red-and-blue painted curb between two topiaries."),
    features=["White gatehouse with the big round arch and the passage behind it",
              "Gold dots over the arch in place of the sign's letters",
              "The curved roofline over the arch",
              "Two towers with dark pyramid roofs and white spires",
              "Red-and-blue painted curb along the drive, and two topiaries"],
    omitted=["The side wings and the BoardWalk Villas buildings",
             "The lookout on the roof and the flower bed",
             "The boardwalk itself, the lake and the shops"],
    colour_rows=[("White", "White", "White"),
                 ("Dark Bluish Gray", "Dark Stone Grey", "Dark Bluish Gray"),
                 ("Pearl Gold", "Warm Gold", "Pearl Gold"),
                 ("Red / Blue", "Bright Red / Bright Blue", "Red / Blue"),
                 ("Tan", "Brick Yellow", "Tan"),
                 ("Reddish Brown", "Reddish Brown", "Reddish Brown"),
                 ("Black", "Black", "Black"),
                 ("Light Bluish Gray", "Medium Stone Grey", "Light Bluish Gray"),
                 ("Green", "Dark Green", "Green")],
    organisation=["The display base, the lawn and the drive", "The gatehouse",
                  "The towers (build 2)", "The topiaries (build 2)"],
    sub_info={
        "gatehouse.ldr": ("The gatehouse",
                          "The white front wall with the big round arch, the warm passage "
                          "behind it, the gold dots of the sign and the curved roofline."),
        "tower.ldr": ("The towers",
                      "Two identical towers that stand on the roof deck, each with two rows "
                      "of windows, a dark pyramid roof and a white spire."),
        "topiary.ldr": ("The topiaries", "Two green cones of round bricks and leaves."),
    },
    legend=("topiary.ldr", 1),
    tips=["The front wall is two studs thick, so the arch has a deep reveal. Around the "
          "arch it is two rows of 1-wide bricks; elsewhere 2-wide bricks tie the rows "
          "together.",
          "Each gold dot is a gold round brick on the side stud of a white brick in the "
          "inner row; it fills the gap left in the outer row. The two dark portholes are "
          "made the same way with black round bricks.",
          "The arch steps in with inverted slopes, then the raised 1&times;6 arch closes it. "
          "The sloped side of each inverted slope faces the middle of the arch.",
          "A <b>&ldquo;Build 2&rdquo;</b> badge means you build that module twice."],
    build_time="about 1 to 1&frac12; hours",
)

# --------------------------------------------------------------------------
# the gatehouse (local grid): front wall z = 0..1, the arch over x = 5..10
# --------------------------------------------------------------------------
GW, GD = 16, 6
COURSES = (1, 4, 7, 10, 13, 16)              # front wall courses below the roof deck
DECK = 19
OPEN = range(5, 11)                          # the arch opening
INV = 10                                     # course of the inverted slopes
ARCH = 13                                    # course of the raised 1x6 arch
DOT_CELLS = [(3, 10), (4, 13)] + [(x, 16) for x in range(5, 11)] + [(11, 13), (12, 10)]
PORTHOLES = [(2, 7), (13, 7)]                # round dark windows on the shoulders
GX, GZ = 4, 8                                # gatehouse corner on the base
TOWERS = ((3, 8), (14, 8))                   # tower corners on the base (7 x 7 with the eaves)
DRIVE = range(9, 15)
TOPIARIES = ((6, 5), (17, 5))

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


def lay(m, colour, cells, z, layer, prev):
    """Bricks over columns `cells` of row z, joints staggered from `prev`; returns joints."""
    seams = set()
    for x0, n in runs(cells):
        used = row(m, "b", colour, x0, z, n, layer, avoid={s - x0 for s in prev if 0 < s - x0 < n})
        seams |= {s + x0 for s in used}
    return seams


def build_gatehouse():
    m = Model("gatehouse.ldr", "Gatehouse")
    fill_rect(m, "p", PLINTH, 0, 0, GW, GD, 0, along="x")
    m.step()
    ring = WallRing([(0, 0), (GW - 1, 0), (GW - 1, GD - 1), (0, GD - 1)])

    def rear(x, z, layer, i):
        if z == 0 or (z == 1 and not (i % 2 == 1 and x in (0, GW - 1))):
            return None                      # the front wall is laid row by row below
        if x in (0, GW - 1) and z in (2, 4) and layer in (4, 10, 16):
            return ("b", WINDOW)
        return ("b", WALL)

    # the floor of the arch and the passage
    for z in range(4):
        row(m, "t", PLINTH, OPEN.start, z, len(OPEN), 1)
    m.step()
    prev = {0: set(), 1: set()}
    dots, holes = [], []
    for i, L in enumerate(COURSES):
        # the front wall: two bricks thick, 2-wide bricks where both rows are solid
        dot_x = {x for x, DL in DOT_CELLS + PORTHOLES if DL == L}
        rows = {}
        for z in (0, 1):
            cells = set(range(GW)) - dot_x
            if L < INV or L == ARCH:
                cells -= set(OPEN)
            elif L == INV:
                cells -= set(range(4, 12))   # the inverted slopes go in here
            if z == 1 and i % 2 == 1:
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
                rows[0].discard(x)
                rows[1].discard(x)
                for k in range(1, p):
                    rows[0].discard(x + k)
                    rows[1].discard(x + k)
                x += p
                joints |= {x0, x}
        for z in (0, 1):
            prev[z] = lay(m, WALL, rows[z], z, L, prev[z]) | joints
        for x in sorted(dot_x):
            b = m.add("stud_side", WALL, x, 1, L)
            (holes if (x, L) in PORTHOLES else dots).append(b)
        for z in (0, 1):
            if L == INV:
                m.add("slope45inv", WALL, 4, z, L, rot=FACE["right"])
                m.add("slope45inv", WALL, 10, z, L, rot=FACE["left"])
            if L == ARCH:
                m.add("arch1x6r", WALL, 5, z, L)
        m.step()
        # side and back walls (the rear ring takes the corners on odd courses)
        ring.course(m, L, i, lambda x, z, layer, i=i: rear(x, z, layer, i))
        # the passage behind the arch: warm side walls and the lobby doors
        for x in (4, 11):
            row(m, "b", PASSAGE, x, 2, 2, L, axis="z")
        if L < 7:
            row(m, "b", PASSAGE, 4, 4, 3, L)
            m.add("b1x2", DOOR, 7, 4, L)
            row(m, "b", PASSAGE, 9, 4, 3, L)
        else:
            row(m, "b", PASSAGE, 4, 4, 8, L)
        m.step()
    # the roof deck behind the front wall: rows of plates with staggered joints
    for z, w, lengths in ((1, 2, (4, 4, 4, 4)), (3, 2, (3, 3, 4, 3, 3)), (5, 1, (4, 4, 4, 4))):
        x = 0
        for n in lengths:
            place_rect(m, "p", WALL, x, z, n, w, DECK)
            x += n
    m.step()
    # gold dots for the letters of the sign, and the dark portholes
    for b in dots:
        round_face(m, b, DOTS)
    for b in holes:
        round_face(m, b, WINDOW)
    m.step()
    # the curved roofline: the front wall rises toward the middle in curved steps
    row(m, "b", WALL, 3, 0, 10, DECK, sizes=[6, 4])
    m.add("curve3", WALL, 0, 0, DECK, rot=FACE["left"])
    m.add("curve3", WALL, 13, 0, DECK, rot=FACE["right"])
    m.step()
    lay(m, WALL, range(6, 10), 0, DECK + 3, {8})
    m.add("curve3", WALL, 3, 0, DECK + 3, rot=FACE["left"])
    m.add("curve3", WALL, 10, 0, DECK + 3, rot=FACE["right"])
    m.step()
    row(m, "t", WALL, 6, 0, 4, DECK + 6)
    fill_cells(m, "t", ROOF, {(x, z) for x in range(5, 11) for z in range(1, GD)}, DECK + 1)
    m.step()
    m.width, m.depth = GW, GD
    return m


# --------------------------------------------------------------------------
# tower (build 2): white walls, a row of windows, dark pyramid roof, white spire
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
        if layer > 1 and ((z in (1, TW - 2) and x in (2, 4)) or (x in (1, TW - 2) and z in (2, 4))):
            return ("b", WINDOW)
        return ("b", WALL)
    # a plain course (behind the front wall), then two rows of windows with a band between
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
        m.add("b1x1", ROOF, 3, 3, L)                 # post for the spire
    build_roofs(m, [Roof(0, TW, 0, TW, B, "x", pitch=45, color=ROOF, hips=("start", "end"),
                         name="tower roof")], keep_open={(3, 3)}, support_caps=True)
    base = m.add("round1", WALL, 3, 3, B + 6)
    top = -8 * (B + 9)                               # top of the round brick
    bar_y = top + 4 - 80
    bar = m.add_raw("bar4", WALL, (70, bar_y, 70), rot_matrix(0), attach_to=base)
    m.add_raw("cone1", WALL, (70, bar_y + 6 - PARTS["cone1"].bmax_y, 70), rot_matrix(0),
              attach_to=bar)
    m.step()
    m.width, m.depth = TW, TW
    return m


def build_topiary():
    m = Model("topiary.ldr", "Topiary")
    m.add("round1", GREEN, 0, 0, 0)
    m.add("leaves1", GREEN, 0, 0, 3, rot=0)
    m.step()
    m.add("round1", GREEN, 0, 0, 4)
    m.add("leaves1", GREEN, 0, 0, 7, rot=90)
    m.add("cone1", GREEN, 0, 0, 8)
    m.step()
    m.width, m.depth = 1, 1
    return m


def build_main(gatehouse, tower, topiary):
    m = Model("boardwalk_compact.ldr", "BoardWalk Inn (compact)")
    m.header_notes = ["Compact resort collection; generated by design.py (lego-kit)."]
    m.section("The display base", "The base and the black band are the same for every kit in "
              "the collection. The lawn, the drive and its painted curb go on next.")
    band = display_base(m)
    reserved = set(band)
    reserved |= {(GX + x, GZ + z) for x in range(GW) for z in range(GD)}
    reserved |= set(TOPIARIES)

    def ground(x, z):
        if z < GZ and x in DRIVE:
            return LBG
        if z < GZ and x in (DRIVE.start - 1, DRIVE.stop):
            return RED if z % 2 == 0 else BLUE
        return GREEN
    finish_ground(m, reserved, GREEN, colour_at=ground)
    m.step()
    m.sub(gatehouse, GX, GZ, 1)
    m.step()
    for tx, tz in TOWERS:
        m.sub(tower, tx, tz, 1 + DECK + 1)
    m.step()
    for x, z in TOPIARIES:
        m.sub(topiary, x, z, 1)
    m.step()
    return m


def build():
    gatehouse, tower, topiary = build_gatehouse(), build_tower(), build_topiary()
    main_m = build_main(gatehouse, tower, topiary)
    return main_m, [main_m, gatehouse, tower, topiary]
