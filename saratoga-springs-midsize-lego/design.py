"""Saratoga Springs Resort, mid-size display kit (resort collection).

Build with the shared kit:  ./build.sh

The mid-size format (lego-kit/compact.py, size="midsize"): a 32 x 24 base with a
black front band; one storey = 4 plates (a course of bricks and a plate band),
1 stud is about 2 m, the same scale as the compact kit. It shows the Carriage
House, the lobby building, as it stands on its street corner: the round lobby
tower IS the corner, at the front right of the base, and the building runs away
from it along both streets. The tower's tan band, front door and louvre face the
corner diagonal; the porch with the red-and-white striped edge wraps round its
front and right; the long wing runs from the tower along the front street toward
the left (the balcony section, the mint shop with its dormer and green awning,
then the cream building with its cupola), and a shorter pale wing runs from the
tower toward the back along the right street. Stone pillars with a white picket
fence (front) and a white privacy fence (right) follow both streets, and the two
sidewalks meet at the corner. The front-right view looks at the corner the way
the reference photo does.

Grid (studs): x to the right, z toward the back; the front band is z = 0..1. The
tower and its porch are symmetric about the tower's front-right diagonal,
x + z = 33.
  tower           x 18..25, z  8..15   an octagon with clipped corners (rows of 4, 6, 8,
                                       8, 8, 8, 6 and 4 studs), five storeys: a green
                                       ground floor under the porch and four mint-green
                                       storeys; a tan band up the corner of the step on
                                       the 45-degree face, a tan cornice one stud wider
                                       than the walls with a flared eave of small brown
                                       slopes, a white louvre over the band, a brown cone
                                       and a black finial
  porch           2 studs round the tower's front and right, ending level with its left
                  side and its back: tan posts, a brown roof and a red-and-white striped
                  edge
  mint wing       x  8..17, z 10..15   two storeys: the mint shop (x 8..13) with a green
                                       awning and a mint dormer with a small window, and
                                       the balcony section by the tower (x 14..17): tan
                                       posts, a brown railing, a pale yellow upper storey
                                       and a tan gable; a grey roof with a chimney
  cream building  x  0..7,  z 10..15   two storeys, red awnings, a white-trimmed gable and
                                       a white cupola with a spire on a terracotta roof
  back wing       x 18..23, z 16..21   two pale storeys behind the tower, facing the right
                                       street, with a small white-trimmed gable
  sidewalks       z 2..3 across the front and x 30..31 down the right side, meeting at
                  the corner; paving in front of the shops; the walk x 20..21, z 4..5
  fences          front z 4: stone pillars and a white picket fence from x = 12 to the
                  corner; right x 28..29: a white privacy fence between pillars
  tree            (26, 20) in the garden behind the privacy fence
The wing plinths reach one stud behind the back walls and three 2 x 4 lawn plates
lie across the back base plates' seams, so the base holds together.
"""
import math
from contextlib import contextmanager

import bricks
from bricks import (Model, Offset, PARTS, FACE, row, fill_rect, fill_cells,
                    rot_matrix, WHITE, BLACK, DBG, LBG, RED, GREEN, TAN, RBROWN, BRGREEN)
from walls import WallRing
from roofs import Roof, build_roofs
from compact import compact_project, display_base, finish_ground

SIZE = "midsize"
MINT, CREAM, TERRA = 378, 226, 484        # Sand Green, Bright Light Yellow, Dark Orange
YELLOW = CREAM                             # the balcony section's pale yellow storey
DEEP = GREEN                               # the deeper green under the porch
CONE, WING_ROOF, TRIM, WINDOW, PLINTH = RBROWN, DBG, TAN, BLACK, LBG
PALE = WHITE                               # the back wing
PAVING = TAN

# Plant Leaves 4 x 3 (a Bestseller in green), for the tops of the trees
bricks.P("ssm_leaves4x3", "2423.dat", "Plant Leaves 4 x 3", cells=[(0, 0)], studs=[(0, 0)],
         height=1)

PROJECT = compact_project(
    size=SIZE,
    slug="saratoga_springs",
    title="Saratoga Springs Resort",
    resort="Disney's Saratoga Springs Resort & Spa",
    category="Deluxe Villas (DVC)",
    merged=["The Treehouse Villas at Disney's Saratoga Springs Resort"],
    about=("The Carriage House at Saratoga Springs, the lobby building, as it stands on its "
           "street corner, in the colours the resort wears today: mint-green shingle with "
           "tan trim, a deeper green under the porch, red-and-white stripes and warm brown "
           "roofs. The round lobby tower is the corner. It is built as an octagon with "
           "clipped corners; its tan band, front door and white louvre face the corner, "
           "under a tan cornice with a flared brown eave, a brown cone roof and a black "
           "finial. A porch on slim tan posts wraps round the tower's front and right "
           "behind a red-and-white striped edge. From the tower the long wing runs along "
           "the front street to the left: a balcony section with tan posts, a brown "
           "railing, a pale yellow upper storey and a tan gable; a mint-green shop with a "
           "green awning and a mint dormer with a small window; and a cream building with "
           "red awnings, a white-trimmed gable and a white cupola with a spire on its "
           "terracotta roof. A shorter pale wing runs from the tower toward the back along "
           "the right street. Chunky river-stone pillars carry a low white picket fence "
           "along the front and a white privacy fence down the right side, with a shade "
           "tree behind, and the two sidewalks meet at the corner."),
    features=["The round lobby tower on the street corner, five storeys tall: an octagon with "
              "clipped corners in mint-green shingle over a deeper green ground floor",
              "A tan band up the tower's corner to a white louvre over the cornice, a tan "
              "cornice with a flared brown eave, a brown cone roof and a black finial",
              "The porch wrapped round the tower's front and right: slim tan posts and a "
              "red-and-white striped edge round a brown porch roof",
              "The long wing along the front street: a balcony section with tan posts, a "
              "brown railing, a pale yellow upper storey and a tan gable, then a mint-green "
              "shop with a green awning and a mint dormer with a small window",
              "A cream building with red awnings, a white-trimmed gable and a white cupola "
              "with a spire on its terracotta roof, at the far end of the front street",
              "A shorter pale wing running back from the tower along the right street, "
              "with a small white-trimmed gable",
              "Chunky river-stone pillars of tan and grey round bricks, with a low white "
              "picket fence along the front and a white privacy fence down the right side, "
              "and sidewalks along both streets that meet at the corner"],
    omitted=["The sign and the horse logo on the tower, and all other lettering",
             "The rest of the guest buildings, the Treehouse Villas, the pools and the spa",
             "The street, the lamp posts, the wall lamps and the rest of the gardens"],
    colour_rows=[("Sand Green", "Sand Green", "Sand Green"), ("Tan", "Brick Yellow", "Tan"),
                 ("Reddish Brown", "Reddish Brown", "Reddish Brown"),
                 ("Red", "Bright Red", "Red"), ("White", "White", "White"),
                 ("Green", "Dark Green", "Green"),
                 ("Bright Light Yellow", "Cool Yellow", "Bright Light Yellow"),
                 ("Dark Orange", "Dark Orange", "Dark Orange"),
                 ("Dark Bluish Gray", "Dark Stone Grey", "Dark Bluish Gray"),
                 ("Light Bluish Gray", "Medium Stone Grey", "Light Bluish Gray"),
                 ("Black", "Black", "Black"),
                 ("Bright Green", "Bright Green", "Bright Green")],
    organisation=["The display base, the sidewalks, the paving and the lawns",
                  "The Carriage House tower on the corner, with its porch",
                  "The mint-green wing: the shop and the balcony section",
                  "The cream building", "The back wing",
                  "The fences and the garden: the stone pillars, the picket and privacy "
                  "fences, shrubs and a tree"],
    sub_info={
        "tower.ldr": ("The Carriage House tower",
                      "The green ground floor and the porch round the tower's front and "
                      "right: tan posts, a brown roof and a striped edge. Then four "
                      "mint-green storeys with the tan band up the corner, the tan cornice "
                      "with its flared eave, the white louvre, the brown cone roof and the "
                      "black finial."),
        "mint_wing.ldr": ("The mint-green wing",
                          "The mint-green shop with its green awning, and the balcony "
                          "section by the tower with tan posts, a brown railing and a pale "
                          "yellow upper storey, under a grey roof with a mint dormer, a tan "
                          "gable and a chimney."),
        "cream_building.ldr": ("The cream building",
                               "Two cream storeys with white bands and red awnings over the "
                               "ground-floor windows, under a terracotta roof with a "
                               "white-trimmed gable and a white cupola with a spire."),
        "back_wing.ldr": ("The back wing",
                          "Two pale storeys behind the tower, facing the right street, under "
                          "a grey roof with a small white-trimmed gable."),
        "pillar.ldr": ("The stone pillars",
                       "Round bricks in tan and grey under a round grey cap."),
        "tree.ldr": ("The shade tree", "A brown trunk and a crown of leaves."),
    },
    legend=("tree.ldr", 1),
    tips=["The tower is an octagon: its walls step in at the corners. Lay each course side by "
          "side with the picture; its joints cross those of the course below.",
          "The tan band runs up the outer corner of the step on the tower's front-right "
          "face. Each tan brick reaches one stud into the wall, so the mint bricks beside it "
          "lock it in.",
          "The porch's brown roof plates reach from the posts onto the tower walls. The "
          "striped edge alternates red and white, a plate and a slope on each.",
          "Every plate of the tan cornice reaches back onto the wall below it. The small "
          "brown slopes round its edge go on before the cone.",
          "The cone roof goes up one ring of slopes at a time. Hidden brown bricks under a few "
          "slopes hold up the ring above; they have a step of their own.",
          "The tower's finial and the cupola's spire sit on the centre stud of a 2&times;2 "
          "dish, half a stud off the grid. The cupola's white bar pushes into the top of its "
          "cone.",
          "A <b>&ldquo;Build 6&rdquo;</b> badge means you build that module six times."],
    build_time="about 2&frac12; hours",
)

# Bestseller sizes (checked with avail.py) for colours the shared table has no entry
# for, or lists sizes that aren't Bestsellers in
KIT_SIZES = {
    ("b", MINT): "1x1 1x2 1x4",            # 1 x 6 is in too few sets since 2024
    ("p", MINT): "1x1 1x2 1x4 1x6 2x4",
    ("t", MINT): "1x1 1x2 1x4",
    ("b", DEEP): "1x2 1x3",
    ("b", TAN): "1x1 1x2 1x3 1x4 1x6",
    ("p", TAN): "1x1 1x2 1x4 1x6 2x2 2x4 4x6",
    ("t", TAN): "1x1 1x2 1x4 1x6 2x2",
    ("b", RBROWN): "1x1 1x2 1x3 1x4 1x6",
    ("t", RBROWN): "1x1 1x2 1x4 1x6 2x2",
    ("t", TERRA): "1x2",
    ("b", BLACK): "1x1 1x2",
    ("p", LBG): "1x1 1x2 1x4 1x6 1x8 2x4 2x6 2x8 6x10",
    ("p", WHITE): "1x1 1x2 1x6 4x6",
    ("t", DBG): "1x1 1x2 1x4",
    ("b", CREAM): "1x1 1x2 1x4",
    ("b", WHITE): "1x1 1x2 1x4 1x6",
}


@contextmanager
def kit_sizes():
    """Use the kit's Bestseller sizes while building, then restore the shared table."""
    saved = dict(bricks.ALLOWED)
    bricks.ALLOWED.update({k: bricks._sizes(v) for k, v in KIT_SIZES.items()})
    try:
        yield
    finally:
        bricks.ALLOWED.clear()
        bricks.ALLOWED.update(saved)


def split_steps(m, limit=20):
    """Split every step of more than `limit` parts into steps of at most `limit`, lowest
    and front-most parts first. A step's note stays with its first part."""
    groups = {}
    for it in m.items:
        groups.setdefault(it.step, []).append(it)
    notes = dict(m.step_notes)
    m.step_notes = {}
    n = 0
    for step in sorted(groups):
        items = groups[step]
        n += 1
        if step in notes:
            m.step_notes[n] = notes[step]
        chunks = -(-len(items) // limit)
        size = -(-len(items) // chunks)

        def key(it):
            return (it.layer if getattr(it, "layer", None) is not None else 999,
                    it.z if it.z is not None else 999, it.x if it.x is not None else 999)
        for i, it in enumerate(sorted(items, key=key)):
            it.step = n + i // size
        n += chunks - 1
    m.items.sort(key=lambda it: it.step)
    m.step_no = n + 1


def merge_fills(m, colour):
    """Join hidden 1 x 1 support bricks of one colour that stand side by side, in the same
    step and course, into 1 x 2, 1 x 3 or 1 x 4 bricks along x."""
    ones = [it for it in m.items if it.key == "b1x1" and it.color == colour]
    groups = {}
    for it in ones:
        groups.setdefault((it.step, it.layer, it.z), []).append(it)
    for (step, layer, z), its in groups.items():
        its.sort(key=lambda it: it.x)
        runs, cur = [], [its[0]]
        for it in its[1:]:
            if it.x == cur[-1].x + 1 and len(cur) < 4:
                cur.append(it)
            else:
                runs.append(cur)
                cur = [it]
        runs.append(cur)
        for run in runs:
            if len(run) == 1 or not bricks.allowed("b", colour, 1, len(run)):
                continue
            m.items = [it for it in m.items if it not in run]
            m.add(f"b1x{len(run)}", colour, run[0].x, z, layer).step = step
    m.items.sort(key=lambda it: it.step)


def rect(x0, z0, w, d):
    return {(x, z) for x in range(x0, x0 + w) for z in range(z0, z0 + d)}


N4 = [(0, -1, "front"), (0, 1, "back"), (-1, 0, "left"), (1, 0, "right")]


def ring8(region):
    """Cells of a region with a neighbour (sides or corners) outside it."""
    return {(x, z) for (x, z) in region
            if any((x + dx, z + dz) not in region for dx in (-1, 0, 1) for dz in (-1, 0, 1))}


def outline(ring):
    """Corner cells, in order, of a one-cell-wide closed ring (for WallRing)."""
    start = min(ring, key=lambda c: (c[1], c[0]))
    path, prev, cur = [start], None, start
    while True:
        nxt = [(cur[0] + dx, cur[1] + dz) for dx, dz, _ in N4
               if (cur[0] + dx, cur[1] + dz) in ring and (cur[0] + dx, cur[1] + dz) != prev]
        if prev is None:
            nxt = [c for c in nxt if c[1] == cur[1]]          # go along x first
        cur, prev = nxt[0], cur
        if cur == start:
            break
        path.append(cur)
    corners = []
    n = len(path)
    for i, c in enumerate(path):
        a, b = path[i - 1], path[(i + 1) % n]
        if not (a[0] == c[0] == b[0] or a[1] == c[1] == b[1]):
            corners.append(c)
    return corners


def plate_on(m, colour, cells, layer, kind="p"):
    """A plate (or tile) covering a rectangle of cells: a 1 x N run or a 2 x 2."""
    xs, zs = [c[0] for c in cells], [c[1] for c in cells]
    w, d = max(xs) - min(xs) + 1, max(zs) - min(zs) + 1
    assert w * d == len(set(cells))
    bricks.place_rect(m, kind, colour, min(xs), min(zs), w, d, layer)


# --------------------------------------------------------------------------
# the tower: an octagon of 8 x 8 studs at x 18..25, z 8..15 (main grid), on the corner
# --------------------------------------------------------------------------
TX, TZ = 18, 8
OX, OZ = TX - 2, TZ - 2                  # the tower submodel's origin (the porch's corner)
FLOORS = 5                               # the porch storey and four storeys above it


def U(x):
    return abs(2 * x - (2 * TX + 7)) // 2


def V(z):
    return abs(2 * z - (2 * TZ + 7)) // 2


def dmirror(c):
    """Mirror image of a cell in the tower's front-right diagonal (x + z = TX + TZ + 7)."""
    return (TX + TZ + 7 - c[1], TX + TZ + 7 - c[0])


def octa(a, b):
    """Cells within a of the tower's centre on both axes and within b in sum."""
    return {(x, z) for x in range(TX + 3 - a, TX + 5 + a) for z in range(TZ + 3 - a, TZ + 5 + a)
            if U(x) + V(z) <= b}


TOWER = octa(3, 4)
WALL = ring8(TOWER)
BAND = (TX + 6, TZ + 1)                  # the outer corner of the 45-degree face


def band_cells(f):
    """The tan band in storey f: the corner cell and the hidden cell behind it, along the
    wall segment that owns the corner in that course (so the band is a 1 x 2 brick)."""
    return {BAND, (TX + 5, TZ + 1) if f % 2 == 0 else (TX + 6, TZ + 2)}


# the wings stand against the tower's left side and behind it
WINGS = ({(x, z) for x in range(0, TX) for z in range(TZ + 2, 24)}
         | {(x, z) for x in range(0, TX + 6) for z in range(TZ + 8, 24)})
# the porch: 2 studs round the tower's front and right; it ends level with the tower's
# left side (where the front wing starts) and with its back (where the back wing starts)
PORCH = {c for c in octa(5, 7) - TOWER
         if (c[1] <= TZ + 1 and c[0] >= TX) or (c[0] >= TX + 6 and c[1] <= TZ + 7)}
PORCH.add((TX + 8, TZ - 1))              # the corner cell on the diagonal
OUTSIDE = PORCH | TOWER | WINGS
PORCH_EDGE = {c for c in PORCH if any((c[0] + dx, c[1] + dz) not in OUTSIDE
                                      for dx, dz, _ in N4)}
# the plinth: the porch and the tower, and the nook behind the tower's back-left corner
NOOK = {(TX, TZ + 6), (TX + 1, TZ + 7)}
PLINTH_CELLS = PORCH | TOWER | NOOK


def corner_side(c):
    """'front' for a cell on the front street's side of the diagonal, else 'right'."""
    return "front" if c[0] + c[1] < TX + TZ + 7 else "right"


def out_face(c):
    """The side a porch edge cell faces: toward its street if open there, else the way
    that is open (the porch's two ends)."""
    side = corner_side(c)
    opn = [f for dx, dz, f in N4 if (c[0] + dx, c[1] + dz) not in OUTSIDE]
    return side if side in opn else opn[0]


def along_edge(cells):
    """Edge cells in order round the tower, from the front wing to the back wing."""
    cx, cz = TX + 4, TZ + 4
    return sorted(cells, key=lambda c: math.atan2(c[1] + 0.5 - cz, c[0] + 0.5 - cx))


_POSTS = [(TX, TZ - 1), (TX + 3, TZ - 2), (TX + 6, TZ - 2), (TX + 7, TZ - 1)]
POSTS = set(_POSTS) | {dmirror(c) for c in _POSTS}
# the porch roof: plates from the edge onto the tower walls (front half; the right half
# is its mirror image), and a 2 x 2 on the two posts at the corner
_DECK = [[(TX, z) for z in range(TZ - 1, TZ + 3)],
         [(TX + 1, z) for z in range(TZ - 2, TZ + 2)]]
_DECK += [[(x, z) for z in range(TZ - 2, TZ + 1)] for x in range(TX + 2, TX + 6)]
_DECK += [[(TX + 6, z) for z in range(TZ - 2, TZ + 2)]]


def mirrored(runs, extra):
    """The runs, their mirror images (less cells already taken) and the extra runs."""
    out = [list(r) for r in runs]
    taken = {c for r in out for c in r}
    for r in runs:
        mr = [dmirror(c) for c in r if dmirror(c) not in taken]
        if mr:
            out.append(mr)
            taken |= set(mr)
    return out + extra


DECK = mirrored(_DECK, [[(x, z) for x in (TX + 7, TX + 8) for z in (TZ - 1, TZ)]])
LOUVRE = BAND                            # the louvre stands on the cornice over the band


def tower_colour(x, z, layer):
    f = (layer - 1) // 4 + 1
    if f == 1:
        return ("b", WINDOW if (x, z) in band_cells(f) else DEEP)
    if (x, z) in band_cells(f):
        return ("b", TAN)
    return ("b", MINT)


def band(m, f, layer, colour=MINT):
    """A plate band over the tower's walls, with a tan 1 x 2 plate over the band that
    crosses the joint of the band brick below."""
    tan = {BAND, (TX + 6, TZ + 2) if f % 2 == 0 else (TX + 5, TZ + 1)}
    fill_cells(m, "p", colour, WALL - tan, layer)
    plate_on(m, TAN, tan, layer)


def match_slopes(ring, inner, blocked):
    """Pair each ring cell with an inward neighbour (the slope's high cell).

    Returns {ring cell: (high cell, face)}: a maximum matching, so as many ring cells
    as possible take a 2 x 1 slope."""
    opts = {}
    for c in ring:
        if c in blocked:
            continue
        o = []
        for dx, dz, face in N4:
            out, inn = (c[0] + dx, c[1] + dz), (c[0] - dx, c[1] - dz)
            if out not in ring and out not in inner and inn in inner and inn not in blocked:
                o.append((inn, face))
        opts[c] = o
    owner = {}

    def augment(c, seen):
        for inn, face in opts[c]:
            if inn in seen:
                continue
            seen.add(inn)
            if inn not in owner or augment(owner[inn][0], seen):
                owner[inn] = (c, face)
                return True
        return False
    for c in sorted(opts, key=lambda c: (len(opts[c]), c[1], c[0])):
        augment(c, set())
    return {c: (inn, face) for inn, (c, face) in owner.items()}


def place_slope(m, colour, cells, face, layer):
    """A 45-degree slope (2 x 1, or 2 x 2 for two cells) whose low cells are `cells`."""
    dx, dz = {"front": (0, -1), "back": (0, 1), "left": (-1, 0), "right": (1, 0)}[face]
    pts = list(cells) + [(x - dx, z - dz) for x, z in cells]
    x0, z0 = min(p[0] for p in pts), min(p[1] for p in pts)
    m.add("slope45" if len(cells) == 1 else "s45x2", colour, x0, z0, layer, rot=FACE[face])


def cone_roof(m, base, regions, blocked):
    """A cone of 45-degree slopes over shrinking octagons; the last region is 4 x 4 and
    takes a pinwheel of four 2 x 2 slopes. `blocked[k]` holds cells left out of course k.
    Returns the layer on top of the cone and the corner of its 2 x 2 top."""
    occ = set()                                   # (x, z, course) taken
    for k in range(len(regions) - 1):
        outer, inner = regions[k], regions[k + 1]
        ring = outer - inner
        L = base + 3 * k
        pairs = match_slopes(ring, inner, blocked.get(k, set()) | blocked.get(k + 1, set()))
        # hidden supports under next-course cells that no slope's high end holds up
        nxt = inner - (regions[k + 2] if k + 2 < len(regions) else inner)
        nxt -= blocked.get(k + 1, set())
        highs = {inn for inn, _ in pairs.values()}
        fills = sorted(c for c in nxt if c not in highs)
        if fills:
            m.step("Hidden brown bricks hold up the next row of slopes.")
            for x, z in fills:
                for kk in range(k + 1):
                    if (x, z, kk) not in occ:
                        m.add("b1x1", CONE, x, z, base + 3 * kk)
                        occ.add((x, z, kk))
            m.step()
        # merge side-by-side slopes facing the same way into 2 x 2 slopes
        done = set()
        for c in sorted(pairs, key=lambda c: (c[1], c[0])):
            if c in done:
                continue
            inn, face = pairs[c]
            occ |= {(c[0], c[1], k), (inn[0], inn[1], k)}
            step = (1, 0) if face in ("front", "back") else (0, 1)
            d = (c[0] + step[0], c[1] + step[1])
            if d in pairs and d not in done and pairs[d][1] == face:
                place_slope(m, CONE, [c, d], face, L)
                done |= {c, d}
                occ |= {(d[0], d[1], k), (pairs[d][0][0], pairs[d][0][1], k)}
            else:
                place_slope(m, CONE, [c], face, L)
                done.add(c)
        for c in sorted(ring - set(pairs) - blocked.get(k, set())):
            face = next(f for dx, dz, f in N4 if (c[0] + dx, c[1] + dz) not in ring | inner)
            m.add("p1x1", CONE, c[0], c[1], L)
            m.add("cheese", CONE, c[0], c[1], L + 1, rot=FACE[face])
            occ.add((c[0], c[1], k))
        m.step()
    # the pinwheel on the 4 x 4 top
    k = len(regions) - 1
    L = base + 3 * k
    x0 = min(c[0] for c in regions[k])
    z0 = min(c[1] for c in regions[k])
    m.add("s45x2", CONE, x0, z0, L, rot=FACE["front"])
    m.add("s45x2", CONE, x0 + 2, z0, L, rot=FACE["right"])
    m.add("s45x2", CONE, x0 + 2, z0 + 2, L, rot=FACE["back"])
    m.add("s45x2", CONE, x0, z0 + 2, L, rot=FACE["left"])
    m.step()
    return L + 3, (x0 + 1, z0 + 1)


def build_tower():
    model = Model("tower.ldr", "The Carriage House tower")
    m = Offset(model, OX, OZ, 0)
    # plinth under the tower: a 6 x 10 plate across the middle and a row in front and
    # behind, all under the walls (the porch's outer rows go down with its posts)
    bricks.place_rect(m, "p", PLINTH, TX, TZ + 1, 10, 6, 0)
    for run in ([(x, TZ) for x in range(TX, TX + 8)],
                [(x, TZ + 7) for x in range(TX + 1, TX + 9)]):
        plate_on(m, PLINTH, run, 0)
    m.step()
    ring = WallRing(outline(WALL))
    edge = along_edge(PORCH_EDGE)
    deck = {c for run in DECK for c in run}
    assert deck >= PORCH and deck <= PORCH | WALL, "the deck must cover the porch"
    for f in range(1, FLOORS + 1):
        L = 1 + 4 * (f - 1)
        ring.course(m, L, f % 2, tower_colour)
        m.step()
        if f == 1:
            m.step("The porch floor in front of the tower, and its tan posts.")
            plate_on(m, PLINTH, [(x, TZ - 2) for x in range(TX + 1, TX + 7)], 0)
            plate_on(m, PLINTH, [(x, TZ - 1) for x in range(TX, TX + 8)], 0)
            plate_on(m, PLINTH, [(TX + 8, TZ - 1), (TX + 8, TZ)], 0)
            for x, z in sorted(POSTS):
                m.add("round1", TAN, x, z, L)
            m.step()
            m.step("The porch roof: brown plates from the posts onto the walls.")
            D = L + 3
            for run in DECK:
                plate_on(m, CONE, run, D)
            fill_cells(m, "p", MINT, WALL - deck, D)
            m.step()
            m.step("The striped edge of the porch: red and white in turn, a plate and a "
                   "slope on each.")
            for i, c in enumerate(edge):
                col = RED if i % 2 == 0 else WHITE
                m.add("p1x1", col, c[0], c[1], D + 1)
                m.add("cheese", col, c[0], c[1], D + 2, rot=FACE[out_face(c)])
            m.step()
        else:
            band(m, f, L + 3, TAN if f == FLOORS else MINT)
            m.step()
    # the cornice, one stud wider than the walls (its four diagonal corners squared off by
    # a stud, so every plate reaches back onto the wall band)
    top = 1 + 4 * FLOORS
    eaves = octa(4, 5) | {(x, z) for x in (TX, TX + 7) for z in (TZ, TZ + 7)}
    regions = [octa(3, 4), octa(2, 3), octa(1, 2)]
    cornice = [(TX + 2, TZ + 1, 4, 6),                                 # the middle
               (TX - 1, TZ + 2, 2, 4), (TX + 7, TZ + 2, 2, 4),         # the sides
               (TX + 2, TZ - 1, 4, 2), (TX + 2, TZ + 7, 4, 2),
               (TX + 1, TZ + 2, 1, 4), (TX + 6, TZ + 2, 1, 4)]
    cornice += [(x, z, 2, 2) for x in (TX, TX + 6) for z in (TZ, TZ + 6)]  # the corners
    assert sorted(c for x, z, w, d in cornice for c in rect(x, z, w, d)) == sorted(eaves)
    for x, z, w, d in cornice:
        bricks.place_rect(m, "p", TAN, x, z, w, d, top)
    m.step()
    base = top + 1
    # the flared eave: a ring of small brown slopes round the edge of the cornice
    m.step("Small brown slopes round the edge of the cornice flare the eave.")
    for c in sorted(eaves - regions[0], key=lambda c: (c[1], c[0])):
        out = [f for dx, dz, f in N4 if (c[0] + dx, c[1] + dz) not in eaves]
        face = corner_side(c) if corner_side(c) in out else out[0]
        m.add("cheese", CONE, c[0], c[1], base, rot=FACE[face])
    m.step()
    # the louvre: white plates stacked on the cornice over the band, at the corner
    m.step("The louvre: white plates stacked over the tan band, at the corner.")
    lx, lz = LOUVRE
    for k in range(6):
        m.add("p1x1", WHITE, lx, lz, base + k)
    m.step()
    blocked = {0: {LOUVRE}}
    roof_top, (cx, cz) = cone_roof(m, base, regions, blocked)
    m.step("A tan cap on the louvre.")
    m.add("p1x1", TAN, lx, lz, base + 6)
    m.add("cheese", CONE, lx, lz, base + 7, rot=FACE["front"])
    m.step()
    # the top of the cone and the finial
    m.step("Brown slopes on the four studs round the top, then the finial: a black "
           "dish, a round plate and a cone on the dish's centre stud.")
    for (x, z), face in (((cx - 1, cz), "left"), ((cx + 1, cz - 1), "front"),
                         ((cx + 2, cz + 1), "right"), ((cx, cz + 2), "back")):
        m.add("cheese", CONE, x, z, roof_top, rot=FACE[face])
    dish = m.add("dish2", BLACK, cx, cz, roof_top)
    y = -8 * (roof_top + PARTS["dish2"].height)
    px, pz = 20 * (cx + 1 - OX), 20 * (cz + 1 - OZ)
    tip = model.add_raw("round_p1", BLACK, (px, y - PARTS["round_p1"].bmax_y, pz),
                        rot_matrix(0), attach_to=dish)
    model.add_raw("cone1", BLACK, (px, y - 8 - PARTS["cone1"].bmax_y, pz), rot_matrix(0),
                  attach_to=tip)
    m.step()
    split_steps(model, 24)
    return model


# --------------------------------------------------------------------------
# mint-green wing: the mint shop with its dormer, and the balcony section by the tower
# --------------------------------------------------------------------------
MINT_AT = (8, TZ + 2)
WW, WD = 10, 6
SHOP = 6                                  # the shop front is x 0..5; the balcony x 6..9


def build_mint():
    m = Model("mint_wing.ldr", "Mint-green wing")
    outline_ = [(0, 0), (SHOP - 1, 0), (SHOP - 1, 1), (WW - 1, 1), (WW - 1, WD - 1),
                (0, WD - 1)]
    # the plinth: a row under the front, and a 6 x 10 plate under the rest that reaches a
    # stud behind the back wall, across the base plates' seam
    row(m, "p", PLINTH, 0, 0, WW, 0, sizes=[8, 2])
    bricks.place_rect(m, "p", PLINTH, 0, 1, WW, WD, 0)
    m.step()
    ring = WallRing(outline_)
    front = {1: "MDDWWM", 2: "MWMMWM"}
    balcony = {1: "MDDM", 2: "YYDY"}

    def mat(f):
        def colour(x, z, layer):
            if z == 0:
                return ("b", WINDOW if front[f][x] in "WD" else MINT)
            if z == 1 and x >= SHOP - 1:
                c = balcony[f][x - SHOP] if x >= SHOP else "MY"[f - 1]
                if c in "WD":
                    return ("b", WINDOW)
                return ("b", YELLOW if c == "Y" else MINT)
            if f == 2 and x >= SHOP and z <= 2:
                return ("b", YELLOW)
            if x == 0:
                return ("b", WINDOW if z in (2, 3) else MINT)
            if z == WD - 1:
                return ("b", WINDOW if x == 2 else MINT)
            return ("b", MINT)
        return colour
    posts = [(SHOP, 0), (WW - 1, 0)]
    for f in (1, 2):
        L = 1 + 4 * (f - 1)
        ring.course(m, L, f % 2, mat(f))
        for x, z in posts:
            m.add("round1", TAN, x, z, L)
        m.step()
        if f == 1:
            # the band, with plates reaching out under the awning
            m.add("p2x4", MINT, 0, -1, L + 3)
            for x in (4, 5):
                m.add("p1x2", MINT, x, -1, L + 3, rot=90)
            cells = {(x, z) for x in range(WW) for z in range(WD)
                     if z <= 1 or x in (0, WW - 1) or z == WD - 1}
            beam = {(x, z) for x in range(SHOP, WW) for z in range(2)}
            fill_cells(m, "p", MINT, cells - beam - {(x, 0) for x in range(SHOP)}, L + 3)
            fill_cells(m, "p", TAN, beam, L + 3)              # the balcony floor
            m.step()
            m.step("The green awning over the shop front.")
            for x in range(SHOP):
                m.add("cheese", GREEN, x, -1, L + 4, rot=FACE["front"])
            m.step()
        else:
            m.step("The balcony railing between the posts.")
            row(m, "p", RBROWN, SHOP + 1, 0, WW - SHOP - 2, L, sizes=[1])
            row(m, "t", RBROWN, SHOP + 1, 0, WW - SHOP - 2, L + 1)
            m.step()
            fill_rect(m, "p", TAN, 0, 0, WW, WD, L + 3, along="z")
            m.step()
    base = 1 + 4 * 2

    # the dormer over the shop: a mint course with the small window, under a small
    # tan-trimmed gable that runs back into the ridge
    m.step("The dormer over the shop: mint bricks round a small black window.")
    for x in (1, 4):
        m.add("b1x2", MINT, x, 0, base, rot=90)
    m.add("b1x2", WINDOW, 2, 0, base)
    m.step()
    chimney = (WW - 2, 3)
    build_roofs(m, [
        Roof(1, 5, 0, 2, base + 3, "z", pitch=45, color=WING_ROOF, trim=TRIM,
             trim_ends=("start",), wall_ends=(), name="dormer"),
        Roof(SHOP, WW, 0, 3, base, "z", pitch=45, color=WING_ROOF, trim=TRIM,
             trim_ends=("start",), wall=TRIM, wall_ends=("start",), name="balcony gable"),
        Roof(0, WW, 0, WD, base, "x", pitch=45, color=WING_ROOF, wall=MINT,
             priority=1, widths=(4, 2, 1), name="wing roof"),
    ], fill_color=WING_ROOF, keep_open={chimney}, support_caps=True)
    # the dormer's front is mint: swap its two front slopes for a mint brick and two small
    # tan slopes, in the same step (before the ridge tiles go on)
    front = [it for it in m.items if it.key == "slope45" and it.z == 0
             and it.layer == base + 3 and it.x in (1, 3)]
    assert len(front) == 2
    step = front[0].step
    m.items = [it for it in m.items if it not in front]
    for it in (m.add("b1x2", MINT, 2, 0, base + 3),
               m.add("cheese", TRIM, 1, 0, base + 3, rot=FACE["left"]),
               m.add("cheese", TRIM, 4, 0, base + 3, rot=FACE["right"])):
        it.step = step
    m.items.sort(key=lambda it: it.step)
    merge_fills(m, WING_ROOF)
    m.step("The chimney stands on the open stud of the ridge.")
    L = base + 6
    m.add("b1x1", DBG, *chimney, L)
    m.add("t1x1", DBG, *chimney, L + 3)
    m.step()
    return m


# --------------------------------------------------------------------------
# cream building: red awnings, a small gable and a white cupola
# --------------------------------------------------------------------------
CREAM_AT = (0, TZ + 2)
CW, CD = 8, 6
CREAM_WIN = (1, 6)
CREAM_DOOR = (3, 4)


def build_cream():
    m = Model("cream_building.ldr", "Cream building")
    # the plinth: a row under the front, and strips running back under the rest that
    # reach a stud behind the back wall, across the base plates' seam
    row(m, "p", PLINTH, 0, 0, CW, 0)
    fill_rect(m, "p", PLINTH, 0, 1, CW, CD, 0, along="z")
    m.step()
    ring = WallRing([(0, 0), (CW - 1, 0), (CW - 1, CD - 1), (0, CD - 1)])

    def colour(x, z, layer):
        if z == 0:
            door = x in CREAM_DOOR and layer < 4
            upper = layer > 4 and x in (3, 4)
            return ("b", WINDOW if x in CREAM_WIN or door or upper else CREAM)
        if z == CD - 1:
            return ("b", WINDOW if x in (2, 5) else CREAM)
        if x == 0:
            return ("b", WINDOW if z in (2, 3) else CREAM)
        return ("b", CREAM)
    awnings = CREAM_WIN
    for f in (1, 2):
        L = 1 + 4 * (f - 1)
        ring.course(m, L, f % 2, colour)
        m.step()
        if f == 1:
            # white bands, with a 1 x 2 plate reaching out under each awning
            for x in awnings:
                m.add("p1x2", WHITE, x, -1, L + 3, rot=90)
            cells = {(x, z) for x in range(CW) for z in range(CD)
                     if z == 0 or x in (0, CW - 1) or z == CD - 1}
            fill_cells(m, "p", WHITE, cells - {(x, 0) for x in awnings}, L + 3)
            m.step()
            m.step("Red awnings over the ground-floor windows.")
            for x in awnings:
                m.add("cheese", RED, x, -1, L + 4, rot=FACE["front"])
            m.step()
        else:
            fill_rect(m, "p", WHITE, 0, 0, CW, CD, L + 3, along="z")
            m.step()
    base = 1 + 4 * 2
    cup = {(3, 2), (4, 2), (3, 3), (4, 3)}
    build_roofs(m, [
        Roof(0, CW, 0, CD, base, "x", pitch=45, color=TERRA, trim=WHITE,
             trim_ends=("start", "end"), wall=CREAM, priority=1, name="roof"),
        Roof(2, 6, 0, 3, base, "z", pitch=45, color=TERRA, trim=WHITE, trim_ends=("start",),
             wall=CREAM, wall_ends=("start",), name="front gable"),
    ], fill_color=RBROWN, keep_open=cup, support_caps=True)
    merge_fills(m, RBROWN)
    # the cupola
    L = base + 6
    m.step("The cupola stands on the four open studs of the ridge.")
    m.add("grille1x2", WHITE, 3, 2, L)
    m.add("grille1x2", WHITE, 3, 3, L, rot=180)
    m.step()
    m.add("p2x2", WHITE, 3, 2, L + 3)
    dish = m.add("dish2", WHITE, 3, 2, L + 4)
    m.step()
    m.step("The spire: a white cone on the dish's centre stud and a white bar in the cone.")
    y = -8 * (L + 4 + PARTS["dish2"].height)
    cone = m.add_raw("cone1", WHITE, (80, y - PARTS["cone1"].bmax_y, 60), rot_matrix(0),
                     attach_to=dish)
    m.add_raw("bar3", WHITE, (80, y - 24 + 8 - 60, 60), rot_matrix(0), attach_to=cone)
    m.step()
    return m


# --------------------------------------------------------------------------
# back wing: two pale storeys behind the tower, facing the right street
# --------------------------------------------------------------------------
BACK_AT = (TX, TZ + 8)
BW, BD = 6, 6


def build_back():
    m = Model("back_wing.ldr", "Back wing")
    fill_rect(m, "p", PLINTH, 0, 0, BW, BD, 0, along="z")
    m.step()
    ring = WallRing([(0, 0), (BW - 1, 0), (BW - 1, BD - 1), (0, BD - 1)])

    def colour(x, z, layer):
        if x == BW - 1:                                   # the side facing the street
            door = layer < 4 and z in (3, 4)
            return ("b", WINDOW if z == 1 or door or (layer > 4 and z in (3, 4))
                    else PALE)
        if z == BD - 1:
            return ("b", WINDOW if x in (2, 3) else PALE)
        if x == 0:
            return ("b", WINDOW if z in (3, 4) and layer > 4 else PALE)
        return ("b", PALE)
    for f in (1, 2):
        L = 1 + 4 * (f - 1)
        ring.course(m, L, f % 2, colour)
        m.step()
        if f == 1:
            cells = {(x, z) for x in range(BW) for z in range(BD)
                     if x in (0, BW - 1) or z in (0, BD - 1)}
            fill_cells(m, "p", TAN, cells, L + 3)
        else:
            fill_rect(m, "p", TAN, 0, 0, BW, BD, L + 3, along="z")
        m.step()
    base = 1 + 4 * 2
    build_roofs(m, [
        Roof(0, BW, 0, BD, base, "z", pitch=45, color=WING_ROOF, trim=WHITE,
             trim_ends=("end",), wall=PALE, priority=1, widths=(4, 2, 1), name="roof"),
        Roof(2, BW, 2, 6, base, "x", pitch=45, color=WING_ROOF, trim=WHITE,
             trim_ends=("end",), wall=PALE, wall_ends=("end",), name="side gable"),
    ], fill_color=WING_ROOF, support_caps=True)
    merge_fills(m, WING_ROOF)
    return m


# --------------------------------------------------------------------------
# details: stone pillars and the shade tree
# --------------------------------------------------------------------------
def build_pillar():
    """A chunky pillar of river stones: round bricks in tan and greys under a round grey
    cap, a plate taller than the fence."""
    m = Model("pillar.ldr", "Stone pillar")
    for (x, z), colour in zip(((0, 0), (1, 0), (1, 1), (0, 1)), (TAN, LBG, TAN, DBG)):
        m.add("round1", colour, x, z, 0)
    m.step()
    m.add("round_p2", LBG, 0, 0, 3)
    m.step()
    return m


def build_tree():
    """A shade tree: a brown trunk and a rounded crown of leaves."""
    m = Model("tree.ldr", "Shade tree")
    for k in range(3):
        m.add("round1", RBROWN, 0, 0, 3 * k)
    m.step()
    m.add("ssm_leaves4x3", GREEN, 0, 0, 9, rot=45)
    m.add("leaves6x5", BRGREEN, 0, 0, 10, rot=0)
    m.add("leaves6x5", GREEN, 0, 0, 11, rot=90)
    m.add("leaves6x5", BRGREEN, 0, 0, 12, rot=180)
    m.add("leaves6x5", GREEN, 0, 0, 13, rot=270)
    m.add("ssm_leaves4x3", GREEN, 0, 0, 14, rot=0)
    m.add("leaves1", GREEN, 0, 0, 15, rot=45)
    m.step()
    return m


# --------------------------------------------------------------------------
# main model
# --------------------------------------------------------------------------
FENCE_Z, FENCE_X = 4, 28                # the pillars' front row and left column; the
                                        # sidewalks are z 2..3 and x 30..31
FRONT_PILLARS = (12, 18, 22, FENCE_X)   # left ends of the 2 x 2 pillars along the front
FRONT_FENCES = (14, 24)                 # left ends of the 1 x 4 picket fences
SIDE_PILLARS = (12, 20)                 # front ends of the pillars down the right side
SIDE_FENCES = (6, 14)                   # front ends of the 1 x 6 privacy fences
TIES = (6, 14, 22)                      # 2 x 4 lawn plates across the back plates' seams
WALK_X = range(20, 22)
TREES = ((26, 20),)


def ground_colour(x, z):
    if z < FENCE_Z or x >= FENCE_X + 2:
        return PAVING                                   # the sidewalks
    if x in WALK_X and z < FENCE_Z + 2:
        return PAVING                                   # the walk to the porch
    if x < CW and z >= MINT_AT[1] - 2 and x not in CREAM_DOOR:
        return GREEN                                    # the beds along the cream building
    if x < FRONT_PILLARS[0] + 2 and z < MINT_AT[1]:
        if (x, z) not in rect(FRONT_PILLARS[0], FENCE_Z, 2, 2):
            return PAVING                               # the paving in front of the shops
    return GREEN


def build_main(tower, mint, cream, back, pillar, tree):
    m = Model("saratoga_springs_midsize.ldr", "Saratoga Springs Resort (mid-size)")
    m.header_notes = ["Mid-size resort collection; generated by design.py (lego-kit)."]
    m.section("The display base", "The base and the black band are the same for every "
              "mid-size kit. The sidewalks along both streets, the paving in front of the "
              "shops and the lawns go on next; the sidewalk tiles tie the base plates "
              "together.")
    band_cells_ = display_base(m, SIZE)
    reserved = set(band_cells_) | PLINTH_CELLS
    reserved |= rect(*MINT_AT, WW, WD + 1) | rect(*CREAM_AT, CW, CD + 1)
    reserved |= rect(*BACK_AT, BW, BD)
    side = rect(FENCE_X + 2, FENCE_Z, 2, 24 - FENCE_Z)          # the right sidewalk
    reserved |= side
    for x in TIES:
        reserved |= rect(x, 22, 4, 2)
    finish_ground(m, reserved, GREEN, colour_at=ground_colour, size=SIZE)
    for x in (FENCE_X + 2, FENCE_X + 3):
        row(m, "t", PAVING, x, FENCE_Z, 24 - FENCE_Z, 1, axis="z", avoid={16 - FENCE_Z})
    for x in TIES:
        m.add("p2x4", GREEN, x, 22, 1)
    m.step()
    m.sub(tower, OX, OZ, 1)
    m.step()
    m.sub(mint, *MINT_AT, 1)
    m.step()
    m.sub(cream, *CREAM_AT, 1)
    m.step()
    m.sub(back, *BACK_AT, 1)
    m.step()
    m.section("The fences and the garden", "Chunky stone pillars along both streets: a "
              "white picket fence along the front and a white privacy fence down the right "
              "side, shrubs and flowers behind the pickets and under the awnings, and a shade "
              "tree.")
    for x in FRONT_PILLARS:
        m.sub(pillar, x, FENCE_Z, 2)
    for z in SIDE_PILLARS:
        m.sub(pillar, FENCE_X, z, 2)
    m.step()
    m.step("The picket fence: a row of white round bricks between the pillars.")
    for x in FRONT_FENCES:
        for dx in range(4):
            m.add("round1", WHITE, x + dx, FENCE_Z, 2)
    m.step()
    m.step("The privacy fence: a white brick and a white tile between the pillars.")
    for z in SIDE_FENCES:
        m.add("b1x6", WHITE, FENCE_X + 1, z, 2, rot=90)
        m.add("t1x6", WHITE, FENCE_X + 1, z, 5, rot=90)
    m.step()
    m.step("Shrubs and flowers behind the pickets and under the red awnings.")
    beds = [(x, FENCE_Z + 1) for x0 in FRONT_FENCES for x in range(x0, x0 + 4)]
    beds += [(x, MINT_AT[1] - 1) for x in range(CW) if x not in CREAM_DOOR]
    for i, (x, z) in enumerate(beds):
        if i % 3 == 1:
            m.add("flower1", RED, x, z, 2)
        else:
            m.add("leaves1", GREEN, x, z, 2, rot=90 * (x % 4))
    m.step()
    for x, z in TREES:
        m.sub(tree, x, z, 2)
    m.step()
    return m


def build():
    with kit_sizes():
        tower = build_tower()
        mint, cream, back = build_mint(), build_cream(), build_back()
        pillar, tree = build_pillar(), build_tree()
        main_m = build_main(tower, mint, cream, back, pillar, tree)
    return main_m, [main_m, tower, mint, cream, back, pillar, tree]
