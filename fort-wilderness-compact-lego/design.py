"""Fort Wilderness Resort, compact display kit (resort collection).

Build with the shared kit:  ./build.sh

The compact format (lego-kit/compact.py): a 24 x 16 base with a black front
band; one storey = 4 plates (a course of bricks and a plate band), 1 stud is about 2 m.

Grid (studs): x to the right, z toward the back; the front band is z = 0..1.
  Pioneer Hall    x  4..21, z 6..13   two storeys of log walls (z 8..13) behind a
                                      two-level porch (z 6..7); green gabled roof
  stone chimney   x 22..23, z 10..11  against the right gable end
  pine tree       (3, 3)              front left
  flagpole        (18, 3)             front right
  sandy forecourt x  4..21, z 4..5    along the porch, and a path x 12..13 to the band
"""
import sys

import bricks
from bricks import (Model, PARTS, split_length, rect_key, rot_matrix,
                    WHITE, BLACK, LBG, DBG, RBROWN, GREEN, TAN, RED)
from roofs import Roof, build_roofs
from compact import compact_project, display_base, finish_ground


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


_register("log1x2", "30136.dat", "Brick 1 x 2 Log")
_register("leaves4x3", "2423.dat", "Plant Leaves 4 x 3", cells=[(0, 0)], studs=[(0, 0)],
          height=1)
_register("clip_plate", "63868.dat", "Plate 1 x 2 with Clip on End", cells=[(0, 0)],
          bottom=[], height=0, solid=False, studs=[])

LOG, WINDOW, ROOF, FOUND, TRIM = RBROWN, BLACK, GREEN, LBG, TAN
STONE_MIX = (LBG, DBG, LBG, LBG, DBG, DBG)

PROJECT = compact_project(
    slug="fort_wilderness",
    title="Fort Wilderness Resort",
    resort="Disney's Fort Wilderness Resort & Campground",
    category="Campground and Cabins",
    merged=["The Cabins at Disney's Fort Wilderness Resort"],
    about=("Pioneer Hall, the frontier log building at the heart of Fort Wilderness: two "
           "storeys of reddish brown logs behind a long porch with an upper balcony, under a "
           "green gabled roof, with a stone chimney at one end. A tall pine and a flagpole "
           "stand on the lawn in front."),
    features=["Pioneer Hall's two storeys of log walls, with log-textured bricks",
              "The long front porch on log posts with the railed balcony above it",
              "The green gabled roof with log gable ends",
              "A stone chimney in two shades of grey",
              "A pine tree and a flagpole with a plain flag"],
    omitted=["The cabins, the campsites and the trading posts",
             "The marina, the beach and the trails",
             "Pioneer Hall's signs and the shows inside"],
    colour_rows=[("Reddish Brown", "Reddish Brown", "Reddish Brown"),
                 ("Green", "Dark Green", "Green"),
                 ("Light Bluish Gray", "Medium Stone Grey", "Light Bluish Gray"),
                 ("Dark Bluish Gray", "Dark Stone Grey", "Dark Bluish Gray"),
                 ("Black", "Black", "Black"), ("Tan", "Brick Yellow", "Tan"),
                 ("White", "White", "White"), ("Red", "Bright Red", "Red")],
    organisation=["The display base and the lawn", "Pioneer Hall",
                  "The pine tree and the flagpole"],
    sub_info={
        "pioneer_hall.ldr": ("Pioneer Hall",
                             "Two storeys of log walls behind a long porch with a railed "
                             "balcony, a green gabled roof and a stone chimney."),
        "fw_pine.ldr": ("The pine tree", "A trunk of round bricks with three tiers of "
                        "branches."),
        "fw_flagpole.ldr": ("The flagpole", "A grey post with a bar and a clip-on flag."),
    },
    legend=("fw_pine.ldr", 1),
    tips=["The walls use log bricks (1&times;4 and 1&times;2). Black bricks are the windows "
          "and the doors.",
          "The tan porch posts are round bricks. The balcony railing is round plates on every "
          "other stud with a rail of 1&times;6 plates on top.",
          "Roofs go up one row of slopes at a time; the log gable ends go in with each row.",
          "The chimney mixes light and dark grey masonry bricks; any order of the two shades "
          "looks right."],
    build_time="about 1 hour",
)

# -- layout ------------------------------------------------------------------
HX, HZ = 4, 6                 # Pioneer Hall corner on the base
W, D = 18, 8                  # hall footprint: porch rows z 0..1, log walls z 2..7
WZ0 = 2                       # first wall row
POSTS = (0, 3, 6, 11, 14, 17)                  # porch posts along the front edge (z = 0)
RAIL = tuple(range(0, W, 2)) + (W - 1,)        # balcony spindles along the front edge
CHIM = (W, 4)                 # chimney corner (2 x 2), against the right gable end
PINE = (3, 3)
FLAG = (18, 3)
PATH = (12, 13)               # path columns to the door

# window and door cells per storey (local x along the front/back, z along the sides)
# (chosen so that every log run has an even length: no plain 1 x 1 fillers)
FRONT = {1: {3, 4, 7, 8, 9, 10, 13, 14}, 2: {2, 3, 6, 7, 10, 11, 14, 15}}
BACK = {1: {3, 4, 13, 14}, 2: {4, 5, 12, 13}}
LEFT = {1: {4, 5}, 2: set()}
RIGHT = {1: set(), 2: set()}

# 1 x N tile lengths that are Pick a Brick Bestsellers per colour (checked with avail.py)
TILES = {RBROWN: [6, 4, 2, 1], GREEN: [4, 2, 1], TAN: [6, 4, 2, 1]}


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


def log_run(m, x, z, n, layer, axis, avoid=()):
    """A run of log bricks (4 and 2 long, a plain 1 x 1 brick for an odd length)."""
    pieces = split_length(n, [4, 2, 1], avoid)
    keys = {4: "log1x4", 2: "log1x2", 1: "b1x1"}
    pos, seams = 0, set()
    for s in pieces:
        col = LOG
        if axis == "x":
            m.add(keys[s], col, x + pos, z, layer)
        else:
            m.add(keys[s], col, x, z + pos, layer, rot=90)
        pos += s
        seams.add(pos)
    return seams - {n}


def wall_course(m, layer, parity, openings, seams):
    """One course of the log walls around x 0..W-1, z WZ0..D-1.

    Corners belong to the front/back walls on even courses and to the side walls
    on odd ones, so the corners interlock. Openings are black bricks.
    """
    x1, z1 = W - 1, D - 1
    own_x = parity % 2 == 0
    sides = [("front", [(x, WZ0) for x in range(0 if own_x else 1, W if own_x else W - 1)], "x"),
             ("back", [(x, z1) for x in range(0 if own_x else 1, W if own_x else W - 1)], "x"),
             ("left", [(0, z) for z in range(WZ0 + (1 if own_x else 0), D - (1 if own_x else 0))], "z"),
             ("right", [(x1, z) for z in range(WZ0 + (1 if own_x else 0), D - (1 if own_x else 0))], "z")]
    for name, cells, axis in sides:
        runs = []                                   # [is_window, [cells]]
        for c in cells:
            u = c[0] if axis == "x" else c[1]
            win = u in openings[name]
            if runs and runs[-1][0] == win:
                runs[-1][1].append(c)
            else:
                runs.append([win, [c]])
        for win, rc in runs:
            x0, z0 = rc[0]
            start = x0 if axis == "x" else z0
            if win:
                for i, s in enumerate(split_length(len(rc), [2, 1])):
                    off = sum(split_length(len(rc), [2, 1])[:i])
                    xx, zz = (x0 + off, z0) if axis == "x" else (x0, z0 + off)
                    m.add(f"b1x{s}", WINDOW, xx, zz, layer, rot=0 if axis == "x" else 90)
                continue
            prev = {s - start for s in seams.get(name, set())}
            new = log_run(m, x0, z0, len(rc), layer, axis,
                          avoid={s for s in prev if 0 < s < len(rc)})
            seams.setdefault("_" + name, set()).update(s + start for s in new)
    for name in ("front", "back", "left", "right"):
        seams[name] = seams.pop("_" + name, set())


def chimney_course(m, layer, parity, x0=CHIM[0], z0=CHIM[1]):
    """A 2 x 2 course of masonry bricks; the pair turns 90 degrees each course."""
    k = layer
    if parity % 2 == 0:
        for dz in (0, 1):
            m.add("masonry", STONE_MIX[(k + dz) % len(STONE_MIX)], x0, z0 + dz, layer)
    else:
        for dx in (0, 1):
            m.add("masonry", STONE_MIX[(k + dx + 3) % len(STONE_MIX)], x0 + dx, z0, layer, rot=90)


def build_hall():
    m = Model("pioneer_hall.ldr", "Pioneer Hall")
    cx, cz = CHIM
    # plinth: grey stone foundation under the walls and the porch, and under the chimney
    m.step("The foundation plates. The 4×4 plate at the right crosses a seam of the base.")
    for x in range(0, W - 4, 2):
        rect(m, "p", FOUND, x, 0, 2, 8, 0)
    rect(m, "p", FOUND, W - 4, 0, 4, 4, 0)
    rect(m, "p", FOUND, W - 4, 4, 6, 2, 0)    # runs on under the chimney
    rect(m, "p", FOUND, W - 4, 6, 4, 2, 0)
    m.step()
    seams = {}
    for f in (1, 2):
        L = 1 + 4 * (f - 1)
        openings = {"front": FRONT[f], "back": BACK[f], "left": LEFT[f], "right": RIGHT[f]}
        if f == 2:
            m.step("The upper storey stands behind the balcony.")
        wall_course(m, L, f % 2, openings, seams)
        chimney_course(m, L, f)
        if f == 1:
            m.step()
            m.step("Round bricks for the porch posts, and floor boards between them.")
            for x in POSTS:
                m.add("round1", TRIM, x, 0, L)
            # porch floor boards between the posts
            cover(m, "t", LOG, [(x, z) for x in range(W) for z in (0, 1)
                                if not (z == 0 and x in POSTS)], L, [(1, n) for n in TILES[LOG]])
        m.step()
        band = L + 3
        if f == 1:
            # balcony floor: wide plates over the posts, the front wall and the room behind
            cover(m, "p", LOG, [(x, z) for x in range(W) for z in range(4)], band, [(4, 6), (4, 4)])
            rect(m, "p", LOG, 0, 4, 1, 3, band)
            # chimney tie: two dark grey plates from the room across the wall to the chimney
            rect(m, "p", DBG, W - 2, 4, 4, 1, band)
            rect(m, "p", DBG, W - 2, 5, 4, 1, band)
            rect(m, "p", LOG, W - 1, 6, 1, 1, band)
            cover(m, "p", LOG, [(x, D - 1) for x in range(W)], band, [(1, 6)])
            m.step()
            # balcony railing: round plates as spindles, a rail of plates on top
            m.step("The balcony railing: round plates as spindles, then the rail on top.")
            for x in RAIL:
                m.add("round_p1", TRIM, x, 0, band + 1)
            for x in (0, W - 1):
                m.add("round_p1", TRIM, x, 1, band + 1)
            m.step()
            cover(m, "p", TRIM, [(x, 0) for x in range(W)], band + 2, [(1, 6)])
            for x in (0, W - 1):
                rect(m, "p", TRIM, x, 1, 1, 1, band + 2)
        else:
            # the roof deck over the walls and the chimney
            cover(m, "p", LOG, [(x, z) for x in range(12) for z in range(WZ0, WZ0 + 4)], band,
                  [(4, 6)])
            rect(m, "p", LOG, 12, 2, 6, 2, band)
            rect(m, "p", DBG, 14, 4, 6, 2, band)
            cover(m, "p", LOG, [(x, z) for x in range(W) for z in (6, 7)], band, [(2, 8), (2, 2)])
        m.step()

    # the green gabled roof with log gable ends; the chimney rises beside it
    def gable(mm, cells, layer):
        zs = sorted(c[1] for c in cells)
        log_run(mm, cells[0][0], zs[0], len(zs), layer, "z")
    roof = Roof(0, W, WZ0, D, 9, "x", pitch=45, color=ROOF, wall=gable, name="hall roof")
    m.step("The chimney goes up beside the gable end.")
    for i, L in enumerate(range(9, 18, 3)):
        chimney_course(m, L, i + 1)
    rect(m, "p", DBG, cx, cz, 2, 2, 18)
    m.step("The roof goes up one row of slopes at a time, with the log gable ends.")
    ridge = {(x, z) for x in range(W) for z in (4, 5)}
    build_roofs(m, [roof], fill_color=LOG, keep_open=ridge, support_caps=True)
    # ridge tiles: green 2 x 2 tiles (the 1 x 8 green tile isn't a Bestseller)
    cover(m, "t", ROOF, ridge, roof.layer(roof.K + 1), [(2, 2)])
    m.step()
    m.width, m.depth = W + 2, D
    return m


def build_pine():
    """Branch tiers turned so that none reach past the base edge or into the hall."""
    m = Model("fw_pine.ldr", "Pine tree")
    for k in range(2):
        m.add("round1", LOG, 0, 0, 3 * k)
    m.step()
    m.add("leaves6x5", GREEN, 0, 0, 6, rot=0)
    m.add("leaves6x5", GREEN, 0, 0, 7, rot=270)
    m.add("round1", GREEN, 0, 0, 8)
    m.add("leaves6x5", GREEN, 0, 0, 11, rot=180)
    m.add("round1", GREEN, 0, 0, 12)
    m.step()
    for i, r in enumerate((0, 90, 180, 270)):
        m.add("leaves4x3", GREEN, 0, 0, 15 + i, rot=r)
    m.add("cone1", GREEN, 0, 0, 19)
    m.step()
    m.width, m.depth = 1, 1
    return m


def build_flagpole():
    m = Model("fw_flagpole.ldr", "Flagpole")
    m.add("round1", LBG, 0, 0, 0)
    base = m.add("round1", LBG, 0, 0, 3)
    m.step()
    c = 10                                   # LDU centre of the post's stud
    top = -8 * 6                             # top of the upper round brick
    bar_y = top + 4 - 80                     # 4L bar pushed 4 LDU into the open stud
    bar = m.add_raw("bar4", WHITE, (c, bar_y, c), rot_matrix(0), attach_to=base)
    m.step()
    # the flag: a 1 x 2 plate with an end clip, turned on edge to grip the pole,
    # with a red 1 x 2 tile on its studs
    mat = (-1, 0, 0, 0, 0, 1, 0, 1, 0)
    fy = bar_y + 14
    flag = m.add_raw("clip_plate", WHITE, (c + 30, fy, c - 4), mat, attach_to=bar)
    m.add_raw("t1x2", RED, (c + 30, fy, c - 12), mat, attach_to=flag)
    m.step()
    m.width, m.depth = 1, 1
    return m


def build_main(hall, pine, flag):
    m = Model("fort_wilderness_compact.ldr", "Fort Wilderness Resort (compact)")
    m.header_notes = ["Compact resort collection; generated by design.py (lego-kit)."]
    m.section("The display base", "The base and the black band are the same for every kit in "
              "the collection. The sandy forecourt, the path and the lawn go on next.")
    band = display_base(m)
    reserved = set(band)
    reserved |= {(HX + x, HZ + z) for x in range(W) for z in range(D)}
    reserved |= {(HX + CHIM[0] + i, HZ + CHIM[1] + j) for i in (0, 1) for j in (0, 1)}
    reserved |= {PINE, FLAG}

    def sandy(x, z):
        return x in PATH and z < HZ or HX <= x < HX + W and HZ - 2 <= z < HZ
    sand = {(x, z) for x in range(24) for z in range(16) if sandy(x, z)} - reserved
    lawn = {(x, z) for x in range(24) for z in range(16)} - reserved - sand
    m.step("The sandy forecourt along the porch and the path to the door.")
    finish_ground(m, reserved | lawn, TAN)
    m.step()
    # a lawn plate beside the chimney ties the two right-hand base plates together
    tie = {(22 + i, 6 + j) for i in range(2) for j in range(4)}
    rect(m, "p", GREEN, 22, 6, 2, 4, 1)
    finish_ground(m, reserved | sand | tie, GREEN)
    m.step()
    m.sub(hall, HX, HZ, 1)
    m.step()
    m.section("The pine tree and the flagpole", "A tall pine at the front left and the "
              "flagpole by the path.")
    m.sub(pine, *PINE, 1)
    m.step()
    m.sub(flag, *FLAG, 1)
    m.step()
    return m


def build():
    hall, pine, flag = build_hall(), build_pine(), build_flagpole()
    main_m = build_main(hall, pine, flag)
    return main_m, [main_m, hall, pine, flag]
