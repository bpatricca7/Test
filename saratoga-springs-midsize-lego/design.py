"""Saratoga Springs Resort, mid-size display kit (resort collection).

Build with the shared kit:  ./build.sh

The mid-size format (lego-kit/compact.py, size="midsize"): a 32 x 24 base with a
black front band; one storey = 4 plates (a course of bricks and a plate band),
1 stud is about 2 m, the same scale as the compact kit. It shows the arrival
front of the Carriage House facing the band: the round lobby tower in mint-green
shingle with its tan front band, louvre, tan cornice and brown cone roof, the
porch with its red-and-white striped edge round the foot of the tower, the white
picket fence with stone pillars, and a lower building on each side.

Grid (studs): x to the right, z toward the back; the front band is z = 0..1. The
tower, the porch and the fence are symmetric about x = 15.5.
  tower           x 12..19, z 10..17   an octagon with clipped corners (rows of 4, 6, 8,
                                       8, 8, 8, 6 and 4 studs), five storeys: a green
                                       ground floor under the porch and four mint-green
                                       storeys above, a tan band up the front, a tan
                                       cornice and a brown cone roof over x 11..20,
                                       z 9..18, with the louvre at the front and a black
                                       finial on top
  porch           z 8..10 round the front of the tower: tan posts, a red-and-white striped
                  edge and a brown porch roof against the tower
  mint wing       x  2..11, z 11..16   two storeys, a front gable with a small window, a
                                       balcony with a brown railing beside the tower, a
                                       green awning over the shop front, a grey roof and a
                                       chimney
  cream building  x 20..29, z 11..16   two storeys, red awnings over the ground-floor
                                       windows, a small front gable and a white cupola
                                       with a spire in a terracotta roof
  sidewalk        z 2..3 across the base; the entrance walk x 14..17, z 4..7
  fence           z 4: a white picket fence between 2 x 2 stone pillars, open at the walk;
                  shrubs and flowers behind it at z = 5
  trees           behind the buildings at (3, 20) and (28, 20)
"""
from contextlib import contextmanager

import bricks
from bricks import (Model, Offset, PARTS, FACE, row, fill_rect, fill_cells,
                    rot_matrix, WHITE, BLACK, DBG, LBG, RED, GREEN, TAN, RBROWN, BRGREEN)
from walls import WallRing
from roofs import Roof, build_roofs
from compact import compact_project, display_base, finish_ground

SIZE = "midsize"
MINT, CREAM, TERRA = 378, 226, 484        # Sand Green, Bright Light Yellow, Dark Orange
DEEP = GREEN                               # the deeper green under the porch
CONE, WING_ROOF, TRIM, WINDOW, PLINTH = RBROWN, DBG, TAN, BLACK, LBG
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
    about=("The arrival front of the Carriage House at Saratoga Springs, in the colours the "
           "resort wears today: mint-green shingle with tan trim, a deeper green under the "
           "porch, red-and-white striped awnings and warm brown roofs. The round lobby tower "
           "stands at the centre, built as an octagon with clipped corners: a tan band runs up "
           "its front to a white louvre that pokes into the brown cone roof, under a tan "
           "cornice and a black finial. A porch on slim tan posts curves round the foot of the "
           "tower behind a red-and-white striped edge, and a white picket fence between chunky "
           "river-stone pillars runs along the sidewalk. On the left, a two-storey mint-green "
           "wing has a front gable, a balcony with a brown railing beside the tower, a green "
           "awning over the shop front and a grey roof with a chimney; on the right, a cream "
           "building has red awnings over its windows and a small white-trimmed gable and a "
           "white cupola with a spire on its terracotta roof. Two trees stand behind."),
    features=["The round lobby tower, five storeys tall: an octagon with clipped corners in "
              "mint-green shingle over a deeper green ground floor",
              "A tan band up the front of the tower to a white louvre that pokes into the "
              "brown cone roof, a tan cornice under the eaves and a black finial on top",
              "The porch round the foot of the tower: slim tan posts and a red-and-white "
              "striped edge in front of a brown porch roof",
              "A white picket fence between chunky river-stone pillars of tan and grey round "
              "bricks, along the sidewalk",
              "A two-storey mint-green wing: a front gable with a small window, a balcony "
              "with tan posts and a brown railing, a green awning over the shop front and a "
              "grey roof with a chimney",
              "A cream building with red awnings over its windows, a white-trimmed gable and a "
              "white cupola with a spire on its terracotta roof"],
    omitted=["The sign and the horse logo on the tower, and all other lettering",
             "The rest of the guest buildings, the Treehouse Villas, the pools and the spa",
             "The street, the lamp posts and the rest of the gardens"],
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
    organisation=["The display base, the sidewalk and the lawns", "The Carriage House tower",
                  "The mint-green wing", "The cream building",
                  "The fence and the garden: the stone pillars, the picket fence, shrubs and "
                  "trees"],
    sub_info={
        "tower.ldr": ("The Carriage House tower",
                      "The porch floor and the green ground floor, the porch with its tan "
                      "posts and striped edge, four mint-green storeys with the tan band up "
                      "the front and the tan cornice; then the brown cone roof, the louvre "
                      "and the black finial."),
        "mint_wing.ldr": ("The mint-green wing",
                          "Two mint-green storeys with a green awning over the shop front and "
                          "a balcony with tan posts and a brown railing beside the tower, under "
                          "a grey roof with a tan-trimmed front gable and a chimney."),
        "cream_building.ldr": ("The cream building",
                               "Two cream storeys with white bands and red awnings over the "
                               "ground-floor windows, under a terracotta roof with a "
                               "white-trimmed gable and a white cupola with a spire."),
        "pillar.ldr": ("The stone pillars",
                       "Two courses of round bricks in tan and grey under a round grey cap."),
        "tree.ldr": ("The trees", "A brown trunk and a crown of leaves."),
    },
    legend=("tree.ldr", 1),
    tips=["The tower is an octagon: its walls step in at the corners. Lay each course side by "
          "side with the picture; its joints cross those of the course below.",
          "The porch's tan deck plates reach from the posts onto the tower walls and tie the "
          "porch to the tower. The striped edge alternates red and white, a plate and a slope "
          "on each.",
          "The cone roof goes up one ring of slopes at a time. Hidden brown bricks under a few "
          "slopes hold up the ring above; they have a step of their own.",
          "The tower's finial and the cupola's spire sit on the centre stud of a 2&times;2 "
          "dish, half a stud off the grid. The cupola's white bar pushes into the top of its "
          "cone.",
          "A <b>&ldquo;Build 6&rdquo;</b> or <b>&ldquo;Build 2&rdquo;</b> badge means you build "
          "that module that many times."],
    build_time="about 2 to 2&frac12; hours",
)

# Bestseller sizes (checked with avail.py) for colours the shared table has no entry
# for, or lists sizes that aren't Bestsellers in
KIT_SIZES = {
    ("b", MINT): "1x1 1x2 1x4 1x6",
    ("p", MINT): "1x1 1x2 1x4 1x6 2x4",
    ("t", MINT): "1x1 1x2 1x3 1x4",
    ("b", DEEP): "1x2 1x3",
    ("b", TAN): "1x1 1x2 1x3 1x4 1x6",
    ("p", TAN): "1x1 1x2 1x3 1x4 1x6 2x4 4x6",
    ("t", TAN): "1x1 1x2 1x4 1x6 2x2",
    ("b", RBROWN): "1x1 1x2 1x3 1x4 1x6",
    ("t", RBROWN): "1x1 1x2 1x4 1x6 2x2",
    ("t", TERRA): "1x2",
    ("b", BLACK): "1x1 1x2",
    ("p", LBG): "1x1 1x2 1x4 1x6 1x8 2x4 2x6 2x8 6x10",
    ("p", WHITE): "1x1 1x2 1x6 2x6 4x6",
    ("t", DBG): "1x1 1x2 1x4",
    ("b", CREAM): "1x1 1x2 1x4",
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


# --------------------------------------------------------------------------
# the tower: an octagon of 8 x 8 studs at x 12..19, z 10..17 (main grid)
# --------------------------------------------------------------------------
TX, TZ = 12, 10
OX, OZ = TX - 2, TZ - 2                  # the tower submodel's origin (the porch's corner)
FLOORS = 5                               # the porch storey and four storeys above it


def U(x):
    return abs(2 * x - (2 * TX + 7)) // 2


def V(z):
    return abs(2 * z - (2 * TZ + 7)) // 2


def mirror(x):
    return 2 * TX + 7 - x


def octa(a, b):
    """Cells within a of the tower's centre on both axes and within b in sum."""
    return {(x, z) for x in range(TX + 3 - a, TX + 5 + a) for z in range(TZ + 3 - a, TZ + 5 + a)
            if U(x) + V(z) <= b}


TOWER = octa(3, 4)
WALL = ring8(TOWER)
BAND = {(TX + 3, TZ), (TX + 4, TZ)}      # the front door, then the tan band above it
# the porch: 2 studs round the front of the tower, from wing to wing (z <= TZ)
PORCH = {c for c in octa(5, 7) if c[1] <= TZ and c not in TOWER}
PORCH_EDGE = {c for c in PORCH if any((c[0] + dx, c[1] + dz) not in PORCH | TOWER
                                      and c[1] + dz <= TZ for dx, dz, _ in N4)}
POSTS = {(TX + 1, TZ - 2), (TX, TZ - 1), (TX - 1, TZ)}
POSTS |= {(mirror(x), z) for x, z in POSTS}


def tower_colour(x, z, layer):
    f = (layer - 1) // 4 + 1
    if f == 1:
        return ("b", WINDOW if (x, z) in BAND else DEEP)
    if (x, z) in BAND:
        return ("b", TAN)
    side = U(x) == 3 and V(z) == 0 or V(z) == 3 and U(x) == 0 and z > TZ
    if f >= 3 and side:
        return ("b", WINDOW)
    return ("b", MINT)


def band(m, layer, colour=MINT):
    """A plate band over the tower's walls, tan over the front band."""
    fill_cells(m, "p", colour, WALL - BAND, layer)
    m.add("p1x2", TAN, TX + 3, TZ, layer)


def both(m, key, colour, x, z, layer, length=1, axis="x"):
    """A 1 x N plate on the left of the tower's centre line and its mirror image."""
    for xx in (x, mirror(x) - (length - 1 if axis == "x" else 0)):
        if length == 1:
            m.add(key, colour, xx, z, layer)
        else:
            m.add(f"p1x{length}", colour, xx, z, layer, rot=0 if axis == "x" else 90)


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
    # plinth: rows of grey plates under the porch, the side ones reaching under the walls
    both(m, None, PLINTH, TX - 1, TZ, 0, length=4)
    m.add("p1x8", PLINTH, TX, TZ - 1, 0)
    m.add("p1x6", PLINTH, TX + 1, TZ - 2, 0)
    covered = {(x, TZ) for x in range(TX - 1, TX + 3)} | {(mirror(x), TZ)
                                                          for x in range(TX - 1, TX + 3)}
    fill_cells(m, "p", PLINTH, TOWER - covered, 0)
    m.step()
    ring = WallRing(outline(WALL))
    for f in range(1, FLOORS + 1):
        L = 1 + 4 * (f - 1)
        ring.course(m, L, f % 2, tower_colour)
        m.step()
        if f == 1:
            for x, z in sorted(POSTS):
                m.add("round1", TAN, x, z, L)
            m.step()
            # the porch deck: tan plates from the posts onto the walls
            m.step("The porch deck: tan plates from the posts onto the walls.")
            D = L + 3
            both(m, None, TAN, TX, TZ - 1, D, length=4, axis="z")
            both(m, None, TAN, TX + 1, TZ - 2, D, length=4, axis="z")
            both(m, None, TAN, TX + 2, TZ - 2, D, length=3, axis="z")
            both(m, "p1x1", TAN, TX - 1, TZ, D)
            for x in (TX + 3, TX + 4):
                m.add("p1x3", TAN, x, TZ - 2, D, rot=90)
            deck = ({(TX, z) for z in range(TZ - 1, TZ + 3)}
                    | {(TX + 1, z) for z in range(TZ - 2, TZ + 2)}
                    | {(x, z) for x in range(TX + 2, TX + 4) for z in range(TZ - 2, TZ + 1)}
                    | {(TX - 1, TZ)})
            deck |= {(mirror(x), z) for x, z in deck}
            fill_cells(m, "p", MINT, WALL - deck, D)
            m.step()
            m.step("The striped edge of the porch: red and white in turn, a plate and a "
                   "slope on each. Brown slopes behind it make the porch roof.")
            order = sorted((c for c in PORCH_EDGE if c[0] <= TX + 3), key=lambda c: -c[0])
            for i, (x, z) in enumerate(order):
                col = RED if i % 2 == 0 else WHITE
                for xx in (x, mirror(x)):
                    m.add("p1x1", col, xx, z, L + 4)
                    m.add("cheese", col, xx, z, L + 5, rot=FACE["front"])
            for x, z in sorted(PORCH - PORCH_EDGE):
                face = next((f for dx, dz, f in N4 if (x + dx, z + dz) in PORCH_EDGE), "front")
                m.add("cheese", CONE, x, z, L + 4, rot=FACE[face])
            m.step()
        else:
            band(m, L + 3, TAN if f == FLOORS else MINT)
            m.step()
    # the eaves: a tan slab one stud wider than the walls
    top = 1 + 4 * FLOORS
    regions = [octa(4, 5), octa(3, 4), octa(2, 3), octa(1, 2)]
    fill_cells(m, "p", TAN, regions[0], top)
    m.step()
    base = top + 1
    # the louvre stands on the eaves at the front, in front of the cone
    lx, lz = TX + 3, TZ - 1
    box = {(lx, lz), (lx + 1, lz), (lx, lz + 1), (lx + 1, lz + 1)}
    m.step("The louvre: white bricks with a grille at the front, tan bricks behind.")
    for k in range(2):
        m.add("grille1x2", WHITE, lx, lz, base + 3 * k)
        m.add("b1x2", TAN, lx, lz + 1, base + 3 * k)
    for z in (lz, lz + 1):
        m.add("p1x2", TAN, lx, z, base + 6)
    m.step()
    blocked = {0: box, 1: box | {(lx, lz + 2), (lx + 1, lz + 2)}}
    roof_top, (cx, cz) = cone_roof(m, base, regions, blocked)
    m.add("s45x2", CONE, lx, lz, base + 7, rot=FACE["front"])
    m.add("t1x2", CONE, lx, lz + 1, base + 10)
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
# mint-green wing: a front gable over the shop, a balcony porch by the tower
# --------------------------------------------------------------------------
WW, WD = 10, 6
SHOP = 6                                  # the shop front is x 0..5; the balcony x 6..9


def build_mint():
    m = Model("mint_wing.ldr", "Mint-green wing")
    outline_ = [(0, 0), (SHOP - 1, 0), (SHOP - 1, 1), (WW - 1, 1), (WW - 1, WD - 1),
                (0, WD - 1)]
    fill_rect(m, "p", PLINTH, 0, 0, WW, WD, 0)
    m.step()
    ring = WallRing(outline_)
    front = {1: "MWWDDM", 2: "MWMMWM"}
    porch_front = {1: "MDDM", 2: "MWWM"}

    def mat(f):
        def colour(x, z, layer):
            if z == 0:
                return ("b", WINDOW if front[f][x] in "WD" else MINT)
            if z == 1 and x >= SHOP - 1:
                c = porch_front[f][x - SHOP] if x >= SHOP else "M"
                return ("b", WINDOW if c in "WD" else MINT)
            if x == 0:
                return ("b", WINDOW if z in (2, 3) else MINT)
            if z == WD - 1:
                return ("b", WINDOW if x in (2, 7) else MINT)
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
            fill_cells(m, "p", MINT, cells - {(x, 0) for x in range(SHOP)}, L + 3)
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

    def gable(mm, cells, layer):
        z = cells[0][1]
        xs = sorted(c[0] for c in cells)
        if z == 0 and len(xs) == 2:
            mm.add("b1x2", WINDOW, xs[0], z, layer)            # the small gable window
        else:
            row(mm, "b", MINT, xs[0], z, len(xs), layer)
    chimney = (WW - 2, 2)
    build_roofs(m, [
        Roof(0, SHOP, 0, WD, base, "z", pitch=45, color=WING_ROOF, trim=TRIM,
             trim_ends=("start", "end"), wall=gable, widths=(4, 2, 1), name="front gable"),
        Roof(3, WW, 0, WD, base, "x", pitch=45, color=WING_ROOF, wall=MINT,
             wall_ends=("end",), priority=1, widths=(4, 2, 1), name="wing roof"),
    ], fill_color=WING_ROOF, keep_open={chimney}, support_caps=True)
    m.step("The chimney stands on the open stud of the ridge.")
    L = base + 6
    m.add("b1x1", DBG, *chimney, L)
    m.add("t1x1", DBG, *chimney, L + 3)
    m.step()
    return m


# --------------------------------------------------------------------------
# cream building: red awnings, a small gable and a white cupola
# --------------------------------------------------------------------------
CW, CD = 10, 6
CREAM_WIN = (1, 3, 6, 8)
CREAM_DOOR = (4, 5)


def build_cream():
    m = Model("cream_building.ldr", "Cream building")
    fill_rect(m, "p", PLINTH, 0, 0, CW, CD, 0)
    m.step()
    ring = WallRing([(0, 0), (CW - 1, 0), (CW - 1, CD - 1), (0, CD - 1)])

    def colour(x, z, layer):
        if z == 0:
            door = x in CREAM_DOOR and layer < 4
            return ("b", WINDOW if x in CREAM_WIN or door else CREAM)
        if z == CD - 1:
            return ("b", WINDOW if x in (2, 7) else CREAM)
        if x == CW - 1:
            return ("b", WINDOW if z in (2, 3) else CREAM)
        return ("b", CREAM)
    for f in (1, 2):
        L = 1 + 4 * (f - 1)
        ring.course(m, L, f % 2, colour)
        m.step()
        if f == 1:
            # white bands, with a 1 x 2 plate reaching out under each awning
            for x in CREAM_WIN:
                m.add("p1x2", WHITE, x, -1, L + 3, rot=90)
            cells = {(x, z) for x in range(CW) for z in range(CD)
                     if z == 0 or x in (0, CW - 1) or z == CD - 1}
            fill_cells(m, "p", WHITE, cells - {(x, 0) for x in CREAM_WIN}, L + 3)
            m.step()
            m.step("Red awnings over the ground-floor windows.")
            for x in CREAM_WIN:
                m.add("cheese", RED, x, -1, L + 4, rot=FACE["front"])
            m.step()
        else:
            fill_rect(m, "p", WHITE, 0, 0, CW, CD, L + 3, along="z")
            m.step()
    base = 1 + 4 * 2

    def gable(mm, cells, layer):
        xs = sorted(c[0] for c in cells)
        mm.add("b1x2", WINDOW, xs[0], cells[0][1], layer)
    cup = {(4, 2), (5, 2), (4, 3), (5, 3)}
    build_roofs(m, [
        Roof(0, CW, 0, CD, base, "x", pitch=45, color=TERRA, trim=WHITE,
             trim_ends=("start", "end"), wall=CREAM, priority=1, name="roof"),
        Roof(3, 7, 0, 3, base, "z", pitch=45, color=TERRA, trim=WHITE, trim_ends=("start",),
             wall=gable, wall_ends=("start",), name="front gable"),
    ], fill_color=RBROWN, keep_open=cup, support_caps=True)
    # the cupola
    L = base + 6
    m.step("The cupola stands on the four open studs of the ridge.")
    m.add("grille1x2", WHITE, 4, 2, L)
    m.add("grille1x2", WHITE, 4, 3, L, rot=180)
    m.step()
    m.add("p2x2", WHITE, 4, 2, L + 3)
    dish = m.add("dish2", WHITE, 4, 2, L + 4)
    m.step()
    m.step("The spire: a white cone on the dish's centre stud and a white bar in the cone.")
    y = -8 * (L + 4 + PARTS["dish2"].height)
    cone = m.add_raw("cone1", WHITE, (100, y - PARTS["cone1"].bmax_y, 60), rot_matrix(0),
                     attach_to=dish)
    m.add_raw("bar3", WHITE, (100, y - 24 + 8 - 60, 60), rot_matrix(0), attach_to=cone)
    m.step()
    return m


# --------------------------------------------------------------------------
# details: stone pillars and trees
# --------------------------------------------------------------------------
def build_pillar():
    """A chunky pillar of river stones: two courses of round bricks in tan and greys, and a
    round grey cap."""
    m = Model("pillar.ldr", "Stone pillar")
    stones = ((TAN, LBG, DBG, TAN), (LBG, TAN, TAN, DBG))
    for k, colours in enumerate(stones):
        for (x, z), colour in zip(((0, 0), (1, 0), (1, 1), (0, 1)), colours):
            m.add("round1", colour, x, z, 3 * k)
        m.step()
    m.add("round_p2", LBG, 0, 0, 6)
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
MINT_AT = (2, TZ + 1)
CREAM_AT = (20, TZ + 1)
SIDEWALK_Z = range(2, 4)
WALK_X = range(14, 18)
FENCE_Z = 4
PILLARS = (0, 6, 12, 18, 24, 30)        # left ends of the 2 x 2 pillars
FENCES = (2, 8, 20, 26)                 # left ends of the 1 x 4 fence pieces
BED_Z = 5
TREES = ((3, 20), (28, 20))


def ground_colour(x, z):
    if z in SIDEWALK_Z:
        return PAVING
    if x in WALK_X and z < OZ:
        return PAVING
    return GREEN


def build_main(tower, mint, cream, pillar, tree):
    m = Model("saratoga_springs_midsize.ldr", "Saratoga Springs Resort (mid-size)")
    m.header_notes = ["Mid-size resort collection; generated by design.py (lego-kit)."]
    m.section("The display base", "The base and the black band are the same for every "
              "mid-size kit. The sidewalk, the entrance walk and the lawns go on next; the "
              "sidewalk tiles tie the base plates together.")
    band_cells = display_base(m, SIZE)
    reserved = set(band_cells) | TOWER | PORCH
    reserved |= rect(*MINT_AT, WW, WD) | rect(*CREAM_AT, CW, CD)
    finish_ground(m, reserved, GREEN, colour_at=ground_colour, size=SIZE)
    m.step()
    m.sub(tower, OX, OZ, 1)
    m.step()
    m.sub(mint, *MINT_AT, 1)
    m.step()
    m.sub(cream, *CREAM_AT, 1)
    m.step()
    m.section("The fence and the garden", "Chunky stone pillars and a white picket fence "
              "along the sidewalk, shrubs and flowers behind the fence, and two trees behind "
              "the buildings.")
    for x in PILLARS:
        m.sub(pillar, x, FENCE_Z, 2)
    m.step()
    for x in FENCES:
        m.add("fence_sp", WHITE, x, FENCE_Z, 2)
    m.step()
    m.step("Shrubs and flowers between the fence and the porch.")
    z = BED_Z
    for x in range(1, 31):
        if x in WALK_X or any(p <= x <= p + 1 for p in PILLARS):
            continue
        if x % 3 == 1:
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
        mint, cream = build_mint(), build_cream()
        pillar, tree = build_pillar(), build_tree()
        main_m = build_main(tower, mint, cream, pillar, tree)
    return main_m, [main_m, tower, mint, cream, pillar, tree]
