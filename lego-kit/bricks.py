"""Stud-grid LEGO modelling kit that writes LDraw.

Every element is placed by the stud cell of its footprint's minimum corner,
the plate layer its underside sits on, and a rotation about the vertical axis.
Part geometry (footprint, height, stud positions and LDraw origin) is read
from the official LDraw library, so placements are exact.  The kit also
checks the model: no two elements may overlap, and every element must be
clutched to the rest of the model through real stud connections.

Grid conventions (LDraw units: 1 stud = 20 LDU, 1 plate = 8 LDU, -Y is up):
  x  -> studs to the right          LDraw X = 20 * x
  z  -> studs toward the back       LDraw Z = 20 * z   (the model faces -Z)
  layer -> plates above the table   LDraw Y = -8 * layer
"""
from collections import defaultdict, Counter
import math

from ldraw_geom import geometry

# --------------------------------------------------------------------------
# Colours (LDraw code, display name)
# --------------------------------------------------------------------------
WHITE, BLACK, DBG, LBG, RED, GREEN, DKGREEN, TAN, RBROWN, BLUE, DTAN, BRGREEN = (
    15, 0, 72, 71, 4, 2, 288, 19, 70, 1, 28, 10)
PINK, MLAVENDER, TYELLOW, TCLEAR, TRED = 29, 30, 46, 47, 36
DKRED = 320
CREAM, GOLD = 226, 297
BRORANGE, NOUGAT = 25, 84

COLOR_NAMES = {
    15: "White", 0: "Black", 72: "Dark Bluish Gray", 71: "Light Bluish Gray",
    4: "Red", 2: "Green", 288: "Dark Green", 19: "Tan", 70: "Reddish Brown",
    1: "Blue", 28: "Dark Tan", 10: "Bright Green", 29: "Bright Pink",
    30: "Medium Lavender", 46: "Trans-Yellow", 47: "Trans-Clear", 36: "Trans-Red",
    320: "Dark Red", 226: "Bright Light Yellow", 297: "Pearl Gold",
    25: "Orange", 84: "Medium Nougat",
}

# Rotation (degrees about the vertical axis) that makes a slope face a side.
# Slopes in the LDraw library face -Z (the front) at rotation 0.
FACE = {"front": 0, "left": 90, "back": 180, "right": 270}


def rot_xz(deg, x, z):
    """Rotate a horizontal vector the way an LDraw Y-rotation matrix does."""
    c = round(math.cos(math.radians(deg)))
    s = round(math.sin(math.radians(deg)))
    return (c * x + s * z, -s * x + c * z)


def rot_matrix(deg):
    """LDraw rotation about the vertical axis (exact for any angle)."""
    if deg % 90 == 0:
        c = round(math.cos(math.radians(deg)))
        s = round(math.sin(math.radians(deg)))
    else:                                   # e.g. a leaf turned 45 degrees on its stud
        c = round(math.cos(math.radians(deg)), 6)
        s = round(math.sin(math.radians(deg)), 6)
    return (c, 0, s, 0, 1, 0, -s, 0, c)


# --------------------------------------------------------------------------
# Part catalogue
# --------------------------------------------------------------------------
class PartType:
    """Grid description of one LDraw part, derived from the library."""

    def __init__(self, dat, name, cells=None, bottom=None, height=None,
                 solid=True, studs=None):
        self.dat = dat
        self.name = name
        bmin, bmax, top_studs = geometry(dat)
        self.bmax_y = bmax[1]
        if cells is None:
            xs = range(int(round(bmin[0])) + 10, int(round(bmax[0])), 20)
            zs = range(int(round(bmin[2])) + 10, int(round(bmax[2])), 20)
            cells = [(x, z) for x in xs for z in zs]
        self.cells = list(cells)                      # local cell centres (LDU)
        self.bottom = list(bottom) if bottom is not None else list(self.cells)
        if studs is None:
            studs = [(s[0], s[2]) for s in top_studs if abs(s[1]) < 0.01]
        self.studs = studs
        if height is None:
            top = 0.0 if top_studs else bmin[1]
            height = int(round((bmax[1] - top) / 8.0))
        self.height = height                          # in plates
        self.solid = solid                            # counts for collisions

    def footprint(self, rot):
        pts = [rot_xz(rot, cx, cz) for cx, cz in self.cells]
        return pts


PARTS = {}


def P(key, dat, name, **kw):
    PARTS[key] = PartType(dat, name, **kw)


def _init_parts():
    # bricks
    P("b1x1", "3005.dat", "Brick 1 x 1")
    P("b1x2", "3004.dat", "Brick 1 x 2")
    P("b1x3", "3622.dat", "Brick 1 x 3")
    P("b1x4", "3010.dat", "Brick 1 x 4")
    P("b1x6", "3009.dat", "Brick 1 x 6")
    P("b1x8", "3008.dat", "Brick 1 x 8")
    P("b2x2", "3003.dat", "Brick 2 x 2")
    P("b2x4", "3001.dat", "Brick 2 x 4")
    P("round1", "3062b.dat", "Brick Round 1 x 1")
    P("round4", "87081.dat", "Brick Round 4 x 4",
      bottom=[(x, z) for x in (-30, -10, 10, 30) for z in (-30, -10, 10, 30)
              if not (abs(x) == 30 and abs(z) == 30)])
    P("tech1x1", "6541.dat", "Technic Brick 1 x 1 with Hole")
    P("tech1x2", "3700.dat", "Technic Brick 1 x 2 with Hole")
    P("grille1x2", "2877.dat", "Brick 1 x 2 with Grille")
    # plates
    for n, d in [(1, "3024"), (2, "3023b"), (3, "3623"), (4, "3710"), (6, "3666"),
                 (8, "3460"), (10, "4477"), (12, "60479")]:
        P(f"p1x{n}", f"{d}.dat", f"Plate 1 x {n}")
    for (a, b), d in {(2, 2): "3022", (2, 3): "3021", (2, 4): "3020", (2, 6): "3795",
                      (2, 8): "3034", (2, 10): "3832", (2, 12): "2445",
                      (4, 4): "3031", (4, 6): "3032", (4, 8): "3035", (4, 10): "3030",
                      (4, 12): "3029", (6, 6): "3958", (6, 8): "3036", (6, 10): "3033",
                      (6, 12): "3028", (8, 16): "92438", (16, 16): "91405"}.items():
        P(f"p{a}x{b}", f"{d}.dat", f"Plate {a} x {b}")
    P("round_p1", "6141.dat", "Plate Round 1 x 1")
    P("jumper2x2", "87580.dat", "Plate 2 x 2 with 1 Center Stud",
      studs=[(0, 0)])
    P("leaves1", "32607.dat", "Plant Plate Round 1 x 1 with 3 Leaves",
      cells=[(0, 0)], solid=True)
    # tiles
    for (a, b), d in {(1, 1): "3070b", (1, 2): "3069b", (1, 3): "63864", (1, 4): "2431", (1, 6): "6636",
                      (1, 8): "4162", (2, 2): "3068b", (2, 4): "87079"}.items():
        P(f"t{a}x{b}", f"{d}.dat", f"Tile {a} x {b}")
    # slopes and roof parts
    P("slope45", "3040b.dat", "Slope 45 2 x 1")
    P("slope65", "60481.dat", "Slope 65 2 x 1 x 2")
    P("slope75", "4460b.dat", "Slope 75 2 x 1 x 3")
    P("s45x2", "3039.dat", "Slope 45 2 x 2")
    P("s45x4", "3037.dat", "Slope 45 2 x 4")
    P("s33x1", "4286.dat", "Slope 33 3 x 1")
    P("s33x2", "3298.dat", "Slope 33 3 x 2")
    P("s33x4", "3297.dat", "Slope 33 3 x 4")
    P("curve2x1", "11477.dat", "Slope Curved 2 x 1")
    P("cheese", "54200.dat", "Slope 30 1 x 1 x 2/3")
    P("dish4", "3960.dat", "Dish 4 x 4 Inverted",
      bottom=[(-10, -10), (-10, 10), (10, -10), (10, 10)])
    P("cone1", "4589.dat", "Cone 1 x 1")
    P("dish2", "4740.dat", "Dish 2 x 2 Inverted")
    # arches: only the legs clutch the studs below
    P("arch1x4", "3659.dat", "Arch 1 x 4", bottom=[(-30, 0), (30, 0)])
    P("arch1x6x2", "15254.dat", "Arch 1 x 6 x 2", bottom=[(-50, 0), (50, 0)])
    P("arch1x6r", "92950.dat", "Arch 1 x 6 Raised", bottom=[(-50, 0), (50, 0)])
    # accessories that do not sit on the grid
    P("bar3", "87994.dat", "Bar 3L", cells=[(0, 0)], bottom=[], height=0,
      solid=False, studs=[])
    # house parts
    P("masonry", "98283.dat", "Brick 1 x 2 with Masonry Profile")
    P("b1x1x3", "14716.dat", "Brick 1 x 1 x 3")
    P("fence1x4", "3633.dat", "Fence 1 x 4 x 1")
    P("fence_sp", "15332.dat", "Fence Spindled 1 x 4 x 2")
    P("headlight", "4070.dat", "Brick 1 x 1 with Headlight")
    P("stud_side", "87087.dat", "Brick 1 x 1 with Stud on 1 Side", cells=[(0, 0)])
    P("tile_round1", "98138.dat", "Tile Round 1 x 1")
    P("flower1", "24866.dat", "Plant Flower 1 x 1", cells=[(0, 0)])
    P("win122", "60592.dat", "Window 1 x 2 x 2 Frame")
    P("win123", "60593.dat", "Window 1 x 2 x 3 Frame")
    P("glass122", "60601.dat", "Glass for Window 1 x 2 x 2", cells=[(0, 0)], bottom=[],
      height=0, solid=False, studs=[])
    P("glass123", "60602.dat", "Glass for Window 1 x 2 x 3", cells=[(0, 0)], bottom=[],
      height=0, solid=False, studs=[])
    P("bar4", "30374.dat", "Bar 4L (Light Sword Blade)", cells=[(0, 0)], bottom=[],
      height=0, solid=False, studs=[])
    P("flag2x2", "2335.dat", "Flag 2 x 2 Square (80326)", cells=[(0, 0)], bottom=[],
      height=0, solid=False, studs=[])
    # resort parts
    P("leaves6x5", "2417.dat", "Plant Leaves 6 x 5", cells=[(0, 0)], studs=[(0, 0)],
      height=1)
    P("cone2", "3942c.dat", "Cone 2 x 2 x 2")
    P("arch1x8", "16577.dat", "Arch 1 x 8 x 2 Raised", bottom=[(-70, 0), (70, 0)])
    P("round2", "3941.dat", "Brick 2 x 2 Round")
    # boardwalk parts
    P("slope45inv", "3665b.dat", "Slope 45 2 x 1 Inverted", bottom=[(0, 0)])
    P("curve2inv", "24201.dat", "Slope Curved 2 x 1 Inverted", bottom=[(0, 20)])
    P("curve3", "50950.dat", "Slope Curved 3 x 1")
    # latte kit parts
    P("macaroni", "85080.dat", "Brick Round Corner 2 x 2 Macaroni",
      cells=[(0, -20), (20, 0), (20, -20)], bottom=[(0, -20), (20, 0)])
    P("b2x3", "3002.dat", "Brick 2 x 3")
    P("log1x4", "30137.dat", "Brick 1 x 4 Log")
    P("round_p2", "4032a.dat", "Plate Round 2 x 2 with Axle Hole")
    P("round_p4", "60474.dat", "Plate Round 4 x 4 with Hole")
    P("tile_round2", "14769.dat", "Tile Round 2 x 2")
    P("tile_quarter", "25269.dat", "Tile Round 1 x 1 Quarter")
    P("stick", "3957b.dat", "Antenna 1 x 4 with Flat Top (stick)", studs=[])
    # clear glass: panels have a thin wall on one long side
    P("panel1x6x5", "59349.dat", "Panel 1 x 6 x 5")
    P("panel1x4x3", "60581.dat", "Panel 1 x 4 x 3")
    P("panel1x2x3", "87544.dat", "Panel 1 x 2 x 3")
    P("panel1x2x2", "87552.dat", "Panel 1 x 2 x 2")
    P("b1x2x5", "46212.dat", "Brick 1 x 2 x 5")
    P("b1x2_open", "3065.dat", "Brick 1 x 2 without Bottom Tube")


_init_parts()


# --------------------------------------------------------------------------
# Model
# --------------------------------------------------------------------------
class Placement:
    __slots__ = ("key", "color", "x", "z", "layer", "rot", "step", "ldraw",
                 "cells", "bottom", "studs", "height", "note")


class Model:
    """A (sub)model built step by step on the stud grid."""

    def __init__(self, name, title):
        self.name = name            # file name, e.g. "wing.ldr"
        self.title = title
        self.items = []             # Placement or SubRef, in build order
        self.step_no = 1
        self.step_notes = {}
        self.sections = {}          # step -> (title, blurb) starting there
        self.header_notes = []      # extra comment lines for the LDraw header

    # -- building --------------------------------------------------------
    def step(self, note=None):
        """Finish the current step (no-op if it is empty)."""
        if any(getattr(i, "step", None) == self.step_no for i in self.items):
            self.step_no += 1
        if note:
            self.step_notes[self.step_no] = note

    def section(self, title, blurb=""):
        """Start a named section of the instructions at the next step."""
        self.step()
        self.sections[self.step_no] = (title, blurb)

    def add(self, key, color, x, z, layer, rot=0, ldraw=None):
        pt = PARTS[key]
        rot %= 360
        fp = pt.footprint(rot)
        minx = min(p[0] for p in fp)
        minz = min(p[1] for p in fp)
        ox = 20 * x + 10 - minx
        oz = 20 * z + 10 - minz
        oy = -8 * layer - pt.bmax_y
        pl = Placement()
        pl.key, pl.color, pl.x, pl.z, pl.layer, pl.rot = key, color, x, z, layer, rot
        pl.step = self.step_no
        pl.ldraw = ldraw or (ox, oy, oz, rot_matrix(rot), pt.dat)

        def cell(px, pz):
            wx, wz = rot_xz(rot, px, pz)
            return (int((wx + ox) // 20), int((wz + oz) // 20))

        pl.cells = [cell(*c) for c in pt.cells] if pt.solid else []
        pl.bottom = [cell(*c) for c in pt.bottom]
        pl.studs = [cell(*c) for c in pt.studs]
        pl.height = pt.height
        pl.note = None
        self.items.append(pl)
        return pl

    def add_raw(self, key, color, pos, matrix, attach_to=None):
        """Place a part at an explicit LDraw position (bars, flags)."""
        pt = PARTS[key]
        pl = Placement()
        pl.key, pl.color, pl.x, pl.z, pl.layer, pl.rot = key, color, None, None, None, 0
        pl.step = self.step_no
        pl.ldraw = (pos[0], pos[1], pos[2], matrix, pt.dat)
        pl.cells, pl.bottom, pl.studs, pl.height = [], [], [], 0
        pl.note = ("attached", attach_to)
        self.items.append(pl)
        return pl

    def sub(self, model, x, z, layer, rot=0):
        """Place a submodel whose local grid origin lands on cell (x, z)."""
        ref = SubRef(model, x, z, layer, rot, self.step_no)
        self.items.append(ref)
        return ref

    # -- flattening ------------------------------------------------------
    def flatten(self, dx=0, dz=0, dlayer=0, rot=0):
        """Yield (placement-like dict) in world grid coordinates."""
        out = []
        for it in self.items:
            if isinstance(it, SubRef):
                assert it.rot == 0, "submodels are always placed unrotated"
                out.extend(it.model.flatten(dx + it.x, dz + it.z, dlayer + it.layer, it.rot))
                continue
            out.append(dict(item=it, dx=dx, dz=dz, dlayer=dlayer, rot=rot))
        return out

    def parts_count(self):
        c = Counter()
        for it in self.items:
            if isinstance(it, SubRef):
                for k, v in it.model.parts_count().items():
                    c[k] += v
            else:
                c[(PARTS[it.key].dat, it.color)] += 1
        return c

    def steps(self):
        return sorted({it.step for it in self.items})

    # -- LDraw output ----------------------------------------------------
    def ldraw_lines(self):
        lines = [f"0 FILE {self.name}", f"0 {self.title}", f"0 Name: {self.name}",
                 "0 Author: Riviera Resort MOC generator"]
        lines += [f"0 // {n}" for n in self.header_notes] + [""]
        cur = 1
        for it in self.items:
            if it.step != cur:
                while cur < it.step:
                    lines.append("0 STEP")
                    cur += 1
            if isinstance(it, SubRef):
                m = rot_matrix(it.rot)
                ox, oy, oz = 20 * it.x, -8 * it.layer, 20 * it.z
                lines.append("1 16 %s %s %s %s %s" % (_n(ox), _n(oy), _n(oz),
                                                      " ".join(_n(v) for v in m), it.model.name))
            else:
                ox, oy, oz, m, dat = it.ldraw
                lines.append("1 %d %s %s %s %s %s" % (it.color, _n(ox), _n(oy), _n(oz),
                                                      " ".join(_n(v) for v in m), dat))
        lines.append("0 STEP")
        lines.append("0 NOFILE")
        return lines


class SubRef:
    def __init__(self, model, x, z, layer, rot, step):
        self.model, self.x, self.z, self.layer, self.rot, self.step = model, x, z, layer, rot, step
        self.key = None


def _n(v):
    if abs(v - round(v)) < 1e-6:
        return str(int(round(v)))
    return ("%.4f" % v).rstrip("0").rstrip(".")


# --------------------------------------------------------------------------
# Validation
# --------------------------------------------------------------------------
def validate(model, verbose=True):
    """Check overlaps and stud connectivity of the whole (flattened) model."""
    occ = {}
    studs = defaultdict(list)
    bottoms = defaultdict(list)
    parts = []
    problems = []
    for f in model.flatten():
        it = f["item"]
        idx = len(parts)
        parts.append(f)
        dx, dz, dl = f["dx"], f["dz"], f["dlayer"]
        if f["rot"] != 0:
            raise NotImplementedError("rotated submodels are not validated")
        if it.layer is None:
            continue
        for (cx, cz) in it.cells:
            for h in range(it.layer, it.layer + it.height):
                k = (cx + dx, cz + dz, h + dl)
                if k in occ:
                    o = parts[occ[k]]["item"]
                    problems.append(f"overlap at {k}: {it.key}/{it.color} (step {it.step}) vs {o.key}/{o.color} (step {o.step})")
                else:
                    occ[k] = idx
        for (cx, cz) in it.studs:
            studs[(cx + dx, cz + dz, it.layer + it.height + dl)].append(idx)
        for (cx, cz) in it.bottom:
            bottoms[(cx + dx, cz + dz, it.layer + dl)].append(idx)
    # union-find over stud connections
    parent = list(range(len(parts)))

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    def union(a, b):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb

    for k, lst in bottoms.items():
        for b in lst:
            for s in studs.get(k, []):
                union(b, s)
    # accessories are attached to the element named in their note
    id_to_idx = {id(p["item"]): i for i, p in enumerate(parts)}
    for i, p in enumerate(parts):
        note = p["item"].note
        if note and note[0] == "attached" and note[1] is not None:
            union(i, id_to_idx[id(note[1])])
    comps = defaultdict(list)
    for i in range(len(parts)):
        comps[find(i)].append(i)
    if len(comps) > 1:
        big = max(comps.values(), key=len)
        for c in comps.values():
            if c is big:
                continue
            desc = ", ".join(f"{parts[i]['item'].key}/{parts[i]['item'].color}@({parts[i]['item'].x + parts[i]['dx'] if parts[i]['item'].x is not None else '-'},{parts[i]['item'].z + parts[i]['dz'] if parts[i]['item'].z is not None else '-'},L{parts[i]['item'].layer + parts[i]['dlayer'] if parts[i]['item'].layer is not None else '-'}) step {parts[i]['item'].step}" for i in c[:6])
            problems.append(f"loose group of {len(c)} element(s): {desc}")
    if verbose:
        print(f"{model.name}: {len(parts)} elements, {len(comps)} connected group(s), {len(problems)} problem(s)")
        for p in problems[:40]:
            print("  !", p)
    return problems


# --------------------------------------------------------------------------
# Helpers for common construction patterns
# --------------------------------------------------------------------------
PLATE_1XN = [12, 10, 8, 6, 4, 3, 2, 1]
BRICK_1XN = [8, 6, 4, 3, 2, 1]
TILE_1XN = [8, 6, 4, 3, 2, 1]


def split_length(L, sizes, avoid=()):
    """Split L into piece lengths from `sizes`, avoiding seams in `avoid`.

    Minimises (seams that coincide with `avoid`) * 10 + number of pieces.
    """
    INF = 10 ** 9
    best = [INF] * (L + 1)
    prev = [None] * (L + 1)
    best[0] = 0
    avoid = set(avoid)
    for p in range(1, L + 1):
        for s in sizes:
            q = p - s
            if q < 0 or best[q] >= INF:
                continue
            pen = 10 if (p != L and p in avoid) else 0
            c = best[q] + 1 + pen
            if c < best[p]:
                best[p], prev[p] = c, q
    if best[L] >= INF:
        return None
    pieces, p = [], L
    while p > 0:
        pieces.append(p - prev[p])
        p = prev[p]
    pieces.reverse()
    return pieces


def seams(pieces):
    out, acc = set(), 0
    for s in pieces[:-1]:
        acc += s
        out.add(acc)
    return out


def row(model, kind, color, x0, z0, length, layer, axis="x", avoid=(), sizes=None):
    """Lay a 1-wide run of plates/bricks/tiles; returns the seam set."""
    if sizes is None:
        sizes = {"p": PLATE_1XN, "b": BRICK_1XN, "t": TILE_1XN}[kind]
    sizes = [s for s in sizes if allowed(kind, color, 1, s)]
    pieces = split_length(length, sizes, avoid)
    pos = 0
    for s in pieces:
        key = f"{kind}1x{s}"
        if axis == "x":
            model.add(key, color, x0 + pos, z0, layer, rot=0 if s == 1 else 0)
        else:
            model.add(key, color, x0, z0 + pos, layer, rot=90)
        pos += s
    return seams(pieces)


# Plate/tile/brick sizes allowed per colour: only elements in current
# production that were also in LEGO Pick a Brick's Bestseller range (the
# range that sells up to 999 of an element per order).
def _sizes(s):
    return {tuple(sorted(map(int, t.split("x")))) for t in s.split()}


ALLOWED = {
    ("p", 15): _sizes("1x1 1x2 1x3 1x4 1x6 1x8 1x10 1x12 2x2 2x3 2x4 2x6 2x8 2x10 2x12 "
                      "4x4 4x6 4x8 4x12 6x6 6x8 6x10"),
    ("p", 2): _sizes("1x1 1x2 1x3 1x4 1x6 1x8 2x2 2x3 2x4 2x6 2x8 2x10 4x4 4x6 4x8 6x8"),
    ("p", 71): _sizes("1x1 1x2 1x3 1x4 1x6 1x8 1x10 1x12 2x2 2x3 2x4 2x6 2x8 2x10 2x12 "
                      "4x4 4x6 4x8 4x10 4x12 6x6 6x8 6x10 6x12"),
    ("p", 72): _sizes("1x1 1x2 1x3 1x4 1x6 1x8 1x10 2x2 2x3 2x4 2x6 2x8 2x10 2x12 "
                      "4x4 4x6 4x8 6x8 6x10 6x12 16x16"),
    ("p", 19): _sizes("1x1 1x2 1x4 2x4 2x8 8x16"),
    ("p", 288): _sizes("1x1 1x2 1x3 1x4 2x4"),
    ("t", 71): _sizes("1x1 1x2 1x3 1x4 1x6 1x8 2x2"),
    ("t", 72): _sizes("1x1 1x2 1x3 1x4 1x6 1x8 2x2"),
    ("t", 19): _sizes("1x1 1x2 1x4 1x6 2x2"),
    ("b", 15): _sizes("1x1 1x2 1x3 1x4 1x6 1x8"),
    ("b", 72): _sizes("1x1 1x2 1x3 1x4 1x6 1x8"),
    ("b", 0): _sizes("1x1 1x2 1x3 1x4"),
    ("b", 71): _sizes("1x1 1x2 1x4"),
    ("p", 0): _sizes("1x1 1x2 1x3 1x4 1x6 2x2 2x4 2x6 2x8 4x6"),
    ("p", 70): _sizes("1x1 1x2 1x3 1x4 1x6 1x8 2x2 2x4 2x6 2x8 4x6"),
    ("t", 0): _sizes("1x1 1x2 1x4 1x6 1x8 2x2"),
    ("t", 15): _sizes("1x1 1x2 1x4 1x6 2x2"),
    ("b", 4): _sizes("1x1 1x2 1x3 1x4 1x6 1x8"),
    ("p", 4): _sizes("1x1 1x2 1x3 1x4 1x6 1x8 2x2 2x3 2x4 2x6"),
    ("t", 4): _sizes("1x1 1x2 1x3 1x4 1x6 1x8 2x2 2x4"),
    ("p", 320): _sizes("1x1 1x2 1x4 2x2 2x4"),
    ("t", 320): _sizes("1x1 1x2 1x4"),
    ("b", 288): _sizes("1x1 1x2 1x4"),
    ("b", 226): _sizes("1x1 1x2 1x4"),
    ("b", 2): _sizes("1x1 1x2 1x3 1x4"),
    ("p", 10): _sizes("1x1 1x2 2x2 2x4"),
    ("p", 1): _sizes("1x2 1x4 1x6"),
    ("t", 84): _sizes("1x1 2x2"),
    ("p", 84): _sizes("1x1 1x2"),
    # Trans-Clear: only these plate/tile sizes (use the panels, round1, headlight
    # and b1x2_open for walls; clear 3004/3010 bricks are out of production)
    ("p", 47): _sizes("1x2"),
    ("t", 47): _sizes("1x1"),
    ("b", 47): _sizes(""),
    ("p", 25): _sizes("1x1 1x2 1x4 1x6 2x2 2x3 2x4 2x6"),
    ("b", 25): _sizes("1x1 1x2 1x4 2x2 2x3 2x4"),
    ("t", 25): _sizes("1x1 1x2 2x2"),
}


def allowed(kind, color, a, b):
    s = ALLOWED.get((kind, color))
    return s is None or tuple(sorted((a, b))) in s


# sizes available per strip width (studs), long side listed
PLATE_SIZES = {1: [12, 10, 8, 6, 4, 3, 2, 1], 2: [16, 12, 10, 8, 6, 4, 3, 2],
               4: [12, 10, 8, 6, 4], 6: [12, 10, 8, 6], 8: [16, 8], 16: [16]}
TILE_SIZES = {1: [8, 6, 4, 3, 2, 1], 2: [4, 2]}


def rect_key(kind, sx, sz, color=None):
    """Return (key, rot) for a kind ('p','t','b') element covering sx by sz."""
    a, b = sorted((sx, sz))
    if color is not None and not allowed(kind, color, a, b):
        return None
    key = f"{kind}{a}x{b}"
    if key not in PARTS:
        return None
    fp = PARTS[key].footprint(0)
    w0 = round((max(p[0] for p in fp) - min(p[0] for p in fp)) / 20) + 1
    return key, (0 if w0 == sx else 90)


def place_rect(model, kind, color, x, z, sx, sz, layer):
    kr = rect_key(kind, sx, sz, color)
    if kr is None:
        raise KeyError(f"no {kind} {sx}x{sz}")
    return model.add(kr[0], color, x, z, layer, rot=kr[1])


def fill_rect(model, kind, color, x0, z0, w, d, layer, along="x", widths=None,
              avoid=(), sizes=None):
    """Cover a w x d rectangle with strips of plates/tiles running `along`.

    `avoid` holds seam positions (in the running direction, relative to the
    rectangle) that should be bridged; returns the seams used.
    """
    table = sizes or (TILE_SIZES if kind == "t" else PLATE_SIZES)
    run, cross = (w, d) if along == "x" else (d, w)
    widths = widths or sorted(table, reverse=True)
    used = set()
    pos = 0
    while pos < cross:
        left = cross - pos
        for sw in widths:
            if sw > left:
                continue
            lens = [s for s in table[sw] if rect_key(kind, s, sw, color)]
            if not lens:
                continue
            pieces = split_length(run, lens, avoid)
            if pieces is None:
                continue
            break
        else:
            raise ValueError(f"cannot fill strip {run} x {left}")
        acc = 0
        for p in pieces:
            if along == "x":
                place_rect(model, kind, color, x0 + acc, z0 + pos, p, sw, layer)
            else:
                place_rect(model, kind, color, x0 + pos, z0 + acc, sw, p, layer)
            acc += p
        used |= seams(pieces)
        pos += sw
    return used


def fill_cells(model, kind, color, cells, layer, sizes=None, prefer=None):
    """Greedily cover an arbitrary set of (x, z) cells with rectangles."""
    cells = set(cells)
    table = sizes or (TILE_SIZES if kind == "t" else PLATE_SIZES)
    cands = []
    for sw, lens in table.items():
        for s in lens:
            for sx, sz in ((s, sw), (sw, s)):
                if rect_key(kind, sx, sz, color):
                    cands.append((sx * sz, sx, sz))
    cands = sorted(set(cands), reverse=True)
    if prefer:
        cands = sorted(cands, key=prefer)
    todo = set(cells)
    for (z, x) in sorted((c[1], c[0]) for c in cells):
        if (x, z) not in todo:
            continue
        for _, sx, sz in cands:
            block = [(x + i, z + j) for i in range(sx) for j in range(sz)]
            if all(b in todo for b in block):
                place_rect(model, kind, color, x, z, sx, sz, layer)
                todo -= set(block)
                break
        else:
            raise ValueError(f"cannot cover cell {(x, z)}")


class Offset:
    """Build into a submodel using the parent's grid coordinates.

    The submodel is later placed with parent.sub(model, dx, dz, dl); the wrapper
    subtracts that offset so design code can use one coordinate system.
    """

    def __init__(self, model, dx, dz, dl):
        self.model, self.dx, self.dz, self.dl = model, dx, dz, dl

    def add(self, key, color, x, z, layer, rot=0, ldraw=None):
        return self.model.add(key, color, x - self.dx, z - self.dz, layer - self.dl, rot)

    def add_raw(self, key, color, pos, matrix, attach_to=None):
        p = (pos[0] - 20 * self.dx, pos[1] + 8 * self.dl, pos[2] - 20 * self.dz)
        return self.model.add_raw(key, color, p, matrix, attach_to=attach_to)

    def step(self, note=None):
        self.model.step(note)

    def section(self, title, blurb=""):
        self.model.section(title, blurb)

    def sub(self, model, x, z, layer, rot=0):
        return self.model.sub(model, x - self.dx, z - self.dz, layer - self.dl, rot)

    def place(self, x, z, layer):
        """Arguments for parent.sub() that put this submodel in place."""
        return self.model, self.dx, self.dz, self.dl
