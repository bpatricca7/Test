"""Coronado Springs Resort, compact display kit (resort collection).

Build with the shared kit:  ./build.sh

The compact format (lego-kit/compact.py): a 24 x 16 base with a black front
band; one storey = 4 plates (a course of bricks and a plate band), 1 stud is about 2 m.

Grid (studs): x to the right, z toward the back; the front band is z = 0..1.
  Gran Destino Tower  x  8..15, z 10..13  tan tower with bands of dark windows and
                                          a crown of fins around a glass lantern
  El Centro           x  2..21, z 3..8    mission-style arcade with a terracotta roof
                                          and a stepped gable with a niche over the entrance
  palms               (4, 12) and (19, 12)
  lake                z 2, along the band (Lago Dorado)
"""
import sys

import bricks
from bricks import Model, PARTS, split_length, rect_key, BLACK, TAN, GREEN, BLUE, LBG
from roofs import Roof, build_roofs
from compact import compact_project, display_base, finish_ground, palm

DKORANGE, GOLD = 484, 297
WALL, WINDOW, ROOF, TRIM, PAVING = TAN, BLACK, DKORANGE, TAN, LBG


def _register(key, dat, name, **kw):
    """Add a part to the catalogue for this kit.

    The toolkit's export, render and booklet scripts copy the part names when
    they are imported, before design.py runs, so the name is added to those
    copies too (only names that are missing; nothing else changes).
    """
    if key not in PARTS:
        bricks.P(key, dat, name, **kw)
    for mod in list(sys.modules.values()):
        for attr in ("NAMES", "DAT_NAMES"):
            d = getattr(mod, attr, None)
            if isinstance(d, dict) and any(str(k).endswith(".dat") for k in list(d)[:1]):
                d.setdefault(dat, name)


_register("cs_b1x1x5", "2453b.dat", "Brick 1 x 1 x 5")

PROJECT = compact_project(
    slug="coronado_springs",
    title="Coronado Springs Resort",
    resort="Disney's Coronado Springs Resort",
    category="Moderate",
    merged=["Gran Destino Tower at Disney's Coronado Springs Resort"],
    about=("The Gran Destino Tower rising behind El Centro: a tall, slim tan tower with bands "
           "of dark windows and a crown of fins around a glass lantern at the top, and in "
           "front of it the low mission-style arcade of El Centro with its arches, terracotta "
           "tile roof and the stepped gable over its entrance. Two palms and a strip of the lake "
           "finish the scene."),
    features=["The Gran Destino Tower: twelve storeys of tan walls with bands of dark windows",
              "The crown at the top: tan fins tied by a crown band, with gold tips, around a "
              "dark glass lantern",
              "El Centro's arcade of round arches under a terracotta tile roof",
              "The stepped mission-style gable with an arched niche over the entrance",
              "Two palms and a strip of Lago Dorado"],
    omitted=["The Casitas, Ranchos and Cabanas guest buildings",
             "The Dig Site pool and its pyramid",
             "The lakeside walkways and gardens"],
    colour_rows=[("Tan", "Brick Yellow", "Tan"), ("Dark Orange", "Dark Orange", "Dark Orange"),
                 ("Black", "Black", "Black"), ("Pearl Gold", "Warm Gold", "Pearl Gold"),
                 ("Light Bluish Gray", "Medium Stone Grey", "Light Bluish Gray"),
                 ("Blue", "Bright Blue", "Blue"), ("Green", "Dark Green", "Green"),
                 ("Reddish Brown", "Reddish Brown", "Reddish Brown")],
    organisation=["The display base, the lake and the lawn", "The Gran Destino Tower",
                  "El Centro", "The palms (build 2)"],
    sub_info={
        "gran_destino.ldr": ("The Gran Destino Tower",
                             "Twelve storeys of tan walls with bands of dark windows, a full "
                             "plate floor on every storey, and the crown at the top."),
        "el_centro.ldr": ("El Centro",
                          "The mission-style arcade: round arches on piers, a terracotta tile "
                          "roof and a stepped gable over the entrance."),
        "palm.ldr": ("The palms", "A trunk of round bricks and two layers of fronds."),
    },
    legend=("palm.ldr", 1),
    tips=["Each storey of the tower is one course of tan and black bricks, then one 4&times;8 "
          "plate. The storeys repeat, so build them like a stack: course, plate, course, "
          "plate.",
          "Press each 4&times;8 plate down over all four walls so the tower stays square.",
          "The arches sit on piers of tan bricks; the roof goes up one row of slopes at a "
          "time.",
          "A <b>&ldquo;Build 2&rdquo;</b> badge means you build that module twice."],
    build_time="about 1 to 1&frac12; hours",
)

# -- layout ------------------------------------------------------------------
TX, TZ = 8, 10                # tower corner on the base, centred behind the gable
TW, TD = 8, 4                 # tower footprint: a slim slab
FLOORS = 12
AX, AZ = 2, 3                 # El Centro corner on the base
AW, AD = 20, 6                # El Centro footprint: arches at z 0, walls at z 2..5
PALMS = ((4, 12), (19, 12))   # fronds stay clear of the tower and inside the base
LAKE_ROWS = (2,)

# 1 x N sizes that are Pick a Brick Bestsellers in each colour (checked with avail.py)
BRICKS = {TAN: [8, 6, 4, 3, 2, 1], BLACK: [4, 3, 2, 1]}


def cover(m, kind, colour, cells, layer, sizes):
    """Cover cells with the largest rectangles first (sizes: (a, b) with a <= b)."""
    todo = set(cells)
    cands = sorted({(a * b, sx, sz) for a, b in sizes for sx, sz in ((a, b), (b, a))},
                   reverse=True)
    for z, x in sorted((c[1], c[0]) for c in todo):
        if (x, z) not in todo:
            continue
        for _, sx, sz in cands:
            blk = {(x + i, z + j) for i in range(sx) for j in range(sz)}
            if blk <= todo:
                key, rot = rect_key(kind, sx, sz)
                m.add(key, colour, x, z, layer, rot=rot)
                todo -= blk
                break
        else:
            raise ValueError(f"cannot cover {(x, z)}")


def rect(m, kind, colour, x, z, sx, sz, layer):
    """One plate/tile/brick covering sx by sz cells from (x, z)."""
    key, rot = rect_key(kind, sx, sz)
    return m.add(key, colour, x, z, layer, rot=rot)


def brick_run(m, colour, x, z, n, layer, axis, avoid=()):
    """A 1-wide run of bricks; returns the joints (relative to the run start)."""
    pieces = split_length(n, BRICKS[colour], avoid)
    pos, joints = 0, set()
    for s in pieces:
        if axis == "x":
            m.add(f"b1x{s}", colour, x + pos, z, layer)
        else:
            m.add(f"b1x{s}", colour, x, z + pos, layer, rot=90)
        pos += s
        joints.add(pos)
    return joints - {n}


def ring_course(m, w, d, layer, parity, mat, joints):
    """One brick course around a w x d outline; corners alternate between walls.

    mat(x, z) gives each cell's colour. Joints are staggered from the course below.
    """
    own_x = parity % 2 == 0
    xs = range(0, w) if own_x else range(1, w - 1)
    zs = range(1, d - 1) if own_x else range(0, d)
    sides = [("front", [(x, 0) for x in xs], "x"), ("back", [(x, d - 1) for x in xs], "x"),
             ("left", [(0, z) for z in zs], "z"), ("right", [(w - 1, z) for z in zs], "z")]
    new = {}
    for name, cells, axis in sides:
        runs = []
        for c in cells:
            col = mat(*c)
            if runs and runs[-1][0] == col:
                runs[-1][1].append(c)
            else:
                runs.append([col, [c]])
        for col, rc in runs:
            x0, z0 = rc[0]
            start = x0 if axis == "x" else z0
            prev = {j - start for j in joints.get(name, set())}
            got = brick_run(m, col, x0, z0, len(rc), layer, axis,
                            avoid={j for j in prev if 0 < j < len(rc)})
            new.setdefault(name, set()).update(j + start for j in got)
    joints.clear()
    joints.update(new)


# -- Gran Destino Tower ---------------------------------------------------------
def tower_mat(x, z):
    """Tan corners and piers; a band of dark windows across the middle of each face."""
    if z in (0, TD - 1) and 2 <= x <= TW - 3:
        return WINDOW
    if x in (0, TW - 1) and 1 <= z <= TD - 2:
        return WINDOW
    return WALL


def build_tower():
    m = Model("gran_destino.ldr", "Gran Destino Tower")
    m.step("The tower stands on one 4×8 plate.")
    rect(m, "p", WALL, 0, 0, TW, TD, 0)
    m.step()
    joints = {}
    for f in range(1, FLOORS + 1):
        L = 1 + 4 * (f - 1)
        ring_course(m, TW, TD, L, f, tower_mat, joints)
        m.step()
        rect(m, "p", WALL, 0, 0, TW, TD, L + 3)
        m.step()
    top = 1 + 4 * FLOORS                          # top of the last floor plate
    # the crown: a glass lantern of black bricks inside a ring of tan fins with gold tips
    m.step("The crown: first the dark glass lantern in the middle of the roof.")
    lantern = lambda x, z: WINDOW                  # noqa: E731
    lj = {}
    for k in range(2):
        sub = Model("_tmp", "")
        ring_course(sub, TW - 4, TD - 2, 0, k, lantern, lj)
        for it in sub.items:
            m.add(it.key, it.color, it.x + 2, it.z + 1, top + 3 * k, rot=it.rot)
    m.step()
    rect(m, "p", WALL, 2, 1, TW - 4, TD - 2, top + 6)
    m.step("Tall tan fins around the edge of the roof.")
    for x, z in FINS:
        m.add("cs_b1x1x5", WALL, x, z, top)
    m.step()
    # the crown band: a ring of plates across the tops of the fins ties them together
    m.step("The crown band ties the tops of the fins together.")
    # (the side plates rest on the corner fins, the front and back ones on the middle fins)
    rect(m, "p", WALL, 0, 0, 1, TD, top + 15)
    rect(m, "p", WALL, TW - 1, 0, 1, TD, top + 15)
    rect(m, "p", WALL, 1, 0, TW - 2, 1, top + 15)
    rect(m, "p", WALL, 1, TD - 1, TW - 2, 1, top + 15)
    m.step("A gold tip over each fin.")
    for x, z in FINS:
        m.add("round1", GOLD, x, z, top + 16)
    m.step()
    m.width, m.depth = TW, TD
    return m


FINS = [(x, z) for x in (0, 2, 5, TW - 1) for z in (0, TD - 1)]


# -- El Centro --------------------------------------------------------------------
ARCHES = range(0, AW, 4)          # each 1 x 4 arch spans x .. x+3; the legs pair up as piers


def build_el_centro():
    m = Model("el_centro.ldr", "El Centro")
    m.step("The floor of the arcade and the building behind it.")
    for x in range(0, AW, 2):
        rect(m, "p", PAVING, x, 0, 2, AD, 0)
    m.step()
    # back block walls (z 2..5): tan with dark doors and windows, two courses
    def block_mat(x, z):
        if z == 2 and x % 4 in (1, 2):
            return WINDOW
        return WALL
    joints = {}
    sub_w, sub_d = AW, AD - 2
    for k in range(2):
        sub = Model("_tmp", "")
        ring_course(sub, sub_w, sub_d, 0, k, lambda x, z: block_mat(x, z + 2), joints)
        for it in sub.items:
            m.add(it.key, it.color, it.x, it.z + 2, 1 + 3 * k, rot=it.rot)
        # arcade piers along the front edge: a 1 x 2 brick where two arches meet
        if k == 0:
            legs = sorted({x for a in ARCHES for x in (a, a + 3)})
            x = 0
            while x < len(legs):
                if x + 1 < len(legs) and legs[x + 1] == legs[x] + 1:
                    rect(m, "b", WALL, legs[x], 0, 2, 1, 1)
                    x += 2
                else:
                    m.add("b1x1", WALL, legs[x], 0, 1)
                    x += 1
        m.step()
    # the arches on the piers
    for x in ARCHES:
        m.add("arch1x4", WALL, x, 0, 4)
    m.step()
    # the roof deck over the arcade and the building
    cover(m, "p", WALL, [(x, z) for x in range(AW) for z in range(AD)], 7,
          [(4, 6), (2, 6), (2, 4)])
    m.step()
    # terracotta hipped roof
    roof = Roof(0, AW, 1, AD, 8, "x", pitch=45, color=ROOF, hips=("start", "end"),
                name="El Centro roof")
    ridge = set(roof.cells())
    _, top = build_roofs(m, [roof], fill_color=WALL, keep_open=ridge, support_caps=True)
    caps = sorted(c for c in ridge if top[c] == roof.K + 2)
    # the ridge row has no slope under it: hidden tan bricks hold the ridge tiles
    m.step("Hidden tan bricks under the ridge, then the ridge tiles.")
    L0 = roof.layer(0)
    used = {c for it in m.items if getattr(it, "layer", None) is not None
            and it.layer <= L0 < it.layer + it.height for c in it.cells}
    mid = (roof.z0 + roof.z1 - 1) // 2
    row = sorted(x for x, z in caps if z == mid and (x, z) not in used)
    brick_run(m, WALL, row[0], mid, len(row), L0, "x")
    m.step()
    cover(m, "t", ROOF, caps, roof.layer(roof.K + 1), [(1, 2)])
    m.step()
    # the mission gable over the entrance (centre bay)
    m.step("The gable over the entrance stands on the front edge of the deck.")
    px = AW // 2 - 2
    rect(m, "b", WALL, px, 0, 4, 1, 8)
    m.step()
    m.add("arch1x4", WALL, px, 0, 11)
    m.step()
    # a smooth cornice of tan tiles along the front edge, either side of the parapet
    cover(m, "t", TRIM, [(x, 0) for x in range(AW) if not px <= x < px + 4], 8, [(1, 4), (1, 2)])
    m.step()
    # the gable top: two slopes rising to a centre post with a pointed cap
    m.add("slope45", WALL, px, 0, 14, rot=90)
    m.add("slope45", WALL, px + 2, 0, 14, rot=270)
    m.step()
    rect(m, "b", WALL, px + 1, 0, 2, 1, 17)
    m.step()
    m.add("cheese", WALL, px + 1, 0, 20, rot=90)
    m.add("cheese", WALL, px + 2, 0, 20, rot=270)
    m.step()
    m.width, m.depth = AW, AD
    return m


def build_main(tower, centro, tree):
    m = Model("coronado_springs_compact.ldr", "Coronado Springs Resort (compact)")
    m.header_notes = ["Compact resort collection; generated by design.py (lego-kit)."]
    m.section("The display base", "The base and the black band are the same for every kit in "
              "the collection. The lake and the lawn go on next.")
    band = display_base(m)
    reserved = set(band)
    reserved |= {(TX + x, TZ + z) for x in range(TW) for z in range(TD)}
    reserved |= {(AX + x, AZ + z) for x in range(AW) for z in range(AD)}
    reserved |= set(PALMS)

    finish_ground(m, reserved, GREEN, colour_at=lambda x, z: BLUE if z in LAKE_ROWS else GREEN)
    m.step()
    m.sub(tower, TX, TZ, 1)
    m.step()
    m.sub(centro, AX, AZ, 1)
    m.step()
    m.section("The palms", "Two palms stand either side of the tower, behind El Centro.")
    for x, z in PALMS:
        m.sub(tree, x, z, 1)
    m.step()
    return m


def build():
    tower, centro, tree = build_tower(), build_el_centro(), palm()
    main_m = build_main(tower, centro, tree)
    return main_m, [main_m, tower, centro, tree]
