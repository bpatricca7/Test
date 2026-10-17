"""Brick portraits: big brick-built figures of real people, made to order.

A figure is about 16 cm tall: a big near-cube head with a tiled face and
brick-built hair, a short neck, a torso with its outfit details in tiles, blocky
arms, two legs (or a skirt) and shoes. It is built from options, so a custom
order is a few lines in a kit's design.py:

    import portrait as pt
    anna = pt.Figure("anna", "Anna", skin=pt.LNOUGAT, hair="wavy", hair_colour=pt.RBROWN,
                     top="vneck", top_colour=pt.BLACK, accent=pt.WHITE,
                     bottoms="trousers", bottoms_colour=pt.DKRED,
                     shoes=pt.BLACK, toe=pt.WHITE)
    anna.place(main_model, x, z, layer)      # adds its sections, steps and submodels
    models = [main_model] + anna.models      # for build()

`OPTION_TABLE` (near the end) lists every option and its choices; `Figure.summary()` says in
words what a figure is. Every element is chosen from the US Pick a Brick
Bestseller list of 17 October 2026 (the tables below), and a colour or part
that isn't on it raises an error that names the option to change.

Figure layout, in studs (x to the right, z toward the back) and plate layers
above the base the figure stands on:

  shoes      layers 0-4    x 0-1 and 4-5; the toe sticks out in front
  legs       layers 4-16   two 2 x 2 legs, at x 0-1 and 4-5, z 1-2
  (skirt)    layers 4-16   a 6 x 4 block instead of legs
  hips       layer 16      plates across both legs and under the arms
  torso      layers 17-27  6 x 3 of bricks (x 0-5, z 1-3) with a tiled front
                           panel (z 0) on side studs
  arms       layers 17-27  1 x 2 columns at x -1 and x 6, hands at the bottom
  shoulders  layers 27-29  plates and tiles across torso and arms
  neck       layers 28-30  2 x 2 at x 2-3, z 1-2
  head       layers 30-46  floor plate, a front wall of side-stud bricks and the
                           6 x 6 face (x 0-5, z -1); the hair walls at x -1 and
                           x 6 and z 4 frame it; the hair top from layer 46

The face and the torso front are side-stud (SNOT) panels: a layer of plates on
the side studs of 22885 bricks, with tiles on it. A panel is written as rows of
tokens, top row first, one token per stud:

    code[/shape][@backing]

  code     a key of the panel's colour legend (for a face: s skin, e eyes,
           w white, h hair, b brows, k beard, l lips, t teeth), or - for no tile
  shape    none: a square tile (neighbours of one colour are merged into larger
           tiles); o: a 1 x 1 round tile; TL, TR, BL or BR: a quarter-round
           tile whose square corner is at the top left, top right and so on
  backing  the colour of the plate under that stud; it shows round a round or
           quarter tile. Elsewhere the panel's filler colour is used.

`make_face_rows()` makes the face from options, and `Figure(face_rows=[...])` takes
a hand-drawn one. A plain face (`face="plain"`) is all skin tiles: the smooth
6 x 6 area (4.8 cm square) for an optional printed face sticker, which is not a
LEGO part. The mosaic face is also flush, so a sticker can cover it too.

validate() can't see side-stud parts (they are attached by a note, not by a
stud on the grid), so check_snot() tests them for collisions with the grid
parts, their studs and each other; Figure and the kits call it.
"""
from collections import defaultdict

from bricks import Model, PARTS, P, FACE, COLOR_NAMES, split_length, seams
from ldraw_geom import geometry

# --------------------------------------------------------------------------
# colours (LDraw codes)
# --------------------------------------------------------------------------
BLACK, WHITE, TAN, RBROWN, RED, DKRED = 0, 15, 19, 70, 4, 320
DKBLUE, BPINK, MAGENTA, MNOUGAT, LNOUGAT = 272, 29, 26, 84, 78
LBG, DBG, DKTAN, DKBROWN, BLYELLOW = 71, 72, 28, 308, 226
COLOR_NAMES.setdefault(MAGENTA, "Magenta")
COLOR_NAMES.setdefault(DKBROWN, "Dark Brown")


# --------------------------------------------------------------------------
# What is a Bestseller in which colour: the US Pick a Brick Bestseller list of
# 17 October 2026 (every element listed as available that day). Sizes are
# (short side, long side) in studs.
# --------------------------------------------------------------------------
def _s(spec):
    return frozenset(tuple(sorted(map(int, t.split("x")))) for t in spec.split())


_ALLB = "1x1 1x2 1x3 1x4 1x6 1x8 2x2 2x3 2x4"
_ALLT = "1x1 1x2 1x3 1x4 1x6 1x8 2x2 2x3 2x4"
BRICK = {c: _s(_ALLB) for c in (BLACK, WHITE, TAN, RBROWN, RED, DKBLUE, LBG, DBG)}
BRICK.update({DKRED: _s("1x1 1x2 1x3 1x4 1x6 2x2 2x4"), BPINK: _s("1x1 1x2 1x4 2x2 2x3 2x4"),
              MAGENTA: _s("1x1 1x2 1x4 1x6"), MNOUGAT: _s("1x1 1x2 1x3 1x4 1x6 1x8 2x2 2x4"),
              LNOUGAT: _s("1x1 1x2 1x3 1x4 2x2"), DKBROWN: _s("1x1 1x2 2x2"),
              DKTAN: _s("1x1 1x2 1x4 1x6 2x2 2x4"), BLYELLOW: _s("1x1 1x2 1x4 1x6 2x2 2x4")})
PLATE = {
    BLACK: _s("1x1 1x2 1x3 1x4 1x6 1x8 1x10 1x12 2x2 2x3 2x4 2x6 2x8 2x10 2x12 4x4 4x6 4x8 "
              "4x10 4x12 6x6 6x8 6x10 6x12 8x8 8x16 16x16"),
    WHITE: _s("1x1 1x2 1x3 1x4 1x6 1x8 1x10 2x2 2x3 2x4 2x6 2x8 2x10 2x12 4x4 4x6 4x8 4x10 "
              "6x6 6x8 6x10 6x12 8x8 8x16 16x16"),
    TAN: _s("1x1 1x2 1x3 1x4 1x6 1x8 1x10 1x12 2x2 2x3 2x4 2x6 2x8 2x10 2x12 4x4 4x6 4x8 "
            "4x10 6x6 6x8 6x10 6x12 8x8 8x16 16x16"),
    RBROWN: _s("1x2 1x3 1x4 1x6 1x8 1x10 1x12 2x3 2x4 2x6 2x8 2x10 2x12 4x4 4x6 4x8 4x10 "
               "4x12 6x6 6x8 6x10"),
    RED: _s("1x1 1x2 1x3 1x4 1x6 1x8 1x10 1x12 2x2 2x3 2x4 2x6 2x8 2x10 2x12 4x4 4x6 4x8 "
            "4x12 6x6 6x8 8x16 16x16"),
    DKRED: _s("1x1 1x2 1x3 1x4 1x6 1x8 1x10 2x2 2x3 2x4 2x6 2x8 2x12 4x4 4x6 4x8 4x10 6x8"),
    DKBLUE: _s("1x1 1x2 1x3 1x4 1x6 1x8 1x10 1x12 2x2 2x3 2x4 2x6 2x8 2x12 4x4 4x6 4x8 4x12 "
               "6x6 6x10"),
    BPINK: _s("1x1 1x2 1x3 1x4 1x6 1x8 2x2 2x3 2x4 2x6 2x8 4x4 6x8"),
    MAGENTA: _s("1x1 1x2 1x3 1x4 1x8 2x2 2x3 2x4 2x6 2x8"),
    MNOUGAT: _s("1x1 1x3 1x4 1x6 1x8 1x12 2x2 2x3 2x4 2x6 2x8 4x4 4x8 6x6 6x8"),
    LNOUGAT: _s("1x1 1x2 1x3 1x4 1x12 2x4"),
    DKBROWN: _s("1x1 1x2 1x3 1x4 1x6 1x8 1x10 2x2 2x4 2x6 4x8 4x10"),
    LBG: _s("1x1 1x2 1x3 1x4 1x6 1x8 1x10 1x12 2x2 2x3 2x4 2x6 2x8 2x10 2x12 4x4 4x6 4x8 "
            "4x10 4x12 6x6 6x8 6x10 6x12 8x8 8x16 16x16"),
    DBG: _s("1x1 1x2 1x3 1x4 1x6 1x8 1x10 2x2 2x3 2x4 2x6 2x8 2x10 2x12 4x4 4x6 4x8 4x10 "
            "4x12 6x6 6x8 6x10 6x12 8x8 8x16 16x16"),
    DKTAN: _s("1x1 1x2 1x3 1x4 1x6 1x8 1x10 1x12 2x2 2x3 2x4 2x6 2x8 2x10 2x12 4x6 4x8 4x10 "
              "6x6 6x8 6x10 8x8 8x16 16x16"),
    BLYELLOW: _s("1x1 1x2 1x3 1x4 1x6 1x8 2x2 2x3 2x4 2x6"),
}
TILE = {c: _s(_ALLT) for c in (BLACK, WHITE, RBROWN, RED, DKRED, DKBLUE, LBG, DBG)}
TILE.update({TAN: _s("1x1 1x3 1x4 1x6 1x8 2x2 2x3 2x4"), BPINK: _s("1x1 1x2 1x4 2x2 2x3 2x4"),
             MAGENTA: _s("1x1 1x2 1x4 2x2 2x4"), MNOUGAT: _s("1x1 1x2 1x3 1x4 1x6 2x2 2x3 2x4"),
             LNOUGAT: _s("1x1 1x2 1x4 1x6 2x2 2x3 2x4"),
             DKBROWN: _s("1x1 1x2 1x3 1x4 1x6 1x8 2x2 2x4"),
             DKTAN: _s("1x1 1x2 1x3 1x4 1x6 1x8 2x2 2x3"), BLYELLOW: _s("1x1 1x2 1x4 2x2 2x4")})

_MOST = {BLACK, WHITE, TAN, RBROWN, RED, DKRED, DKBLUE, LBG, DBG, DKTAN}
HAS = {   # special parts (bricks.PARTS keys) -> colours they are Bestsellers in
    "tile_round1": _MOST | {BPINK, MAGENTA, MNOUGAT, LNOUGAT, DKBROWN, BLYELLOW},
    "tile_quarter": (_MOST - {WHITE}) | {BPINK, MAGENTA, MNOUGAT, LNOUGAT, DKBROWN},
    "slope45": _MOST | {MNOUGAT, DKBROWN},
    "s45x2": _MOST | {BPINK, MNOUGAT},
    "slope45inv": _MOST - {TAN},
    "cheese": (_MOST - {LBG}) | {BPINK, MAGENTA, MNOUGAT, DKBROWN},
    "bp_cheese1x2": _MOST | {MNOUGAT, LNOUGAT, DKBROWN},
    "slope65": (_MOST - {DKRED}) | {MNOUGAT, DKBROWN},
    "curve2x1": _MOST | {BPINK, MAGENTA, MNOUGAT, LNOUGAT, DKBROWN, BLYELLOW},
    "curve3": _MOST | {DKBROWN},
    "bp_snot1x2": _MOST | {MAGENTA, MNOUGAT},
    "round1": _MOST - {DKTAN},
    "bp_heart1": {WHITE, BPINK},
}

# extra parts (keys prefixed bp_)
P("bp_snot1x2", "22885.dat", "Brick 1 x 2 x 1 2/3 with Studs on 1 Side",
  cells=[(-10, 0), (10, 0)])
P("bp_cheese1x2", "85984.dat", "Slope 31 1 x 2 x 2/3")
P("bp_t2x3", "26603.dat", "Tile 2 x 3")
P("bp_heart1", "39739.dat", "Tile 1 x 1 Heart", cells=[(0, 0)])

KEYS = {"b": {(1, 1): "b1x1", (1, 2): "b1x2", (1, 3): "b1x3", (1, 4): "b1x4", (1, 6): "b1x6",
              (1, 8): "b1x8", (2, 2): "b2x2", (2, 3): "b2x3", (2, 4): "b2x4"},
        "t": {(1, 1): "t1x1", (1, 2): "t1x2", (1, 3): "t1x3", (1, 4): "t1x4", (1, 6): "t1x6",
              (1, 8): "t1x8", (2, 2): "t2x2", (2, 3): "bp_t2x3", (2, 4): "t2x4"},
        "p": {}}
for _a, _b in [(1, 1), (1, 2), (1, 3), (1, 4), (1, 6), (1, 8), (1, 10), (1, 12), (2, 2), (2, 3),
               (2, 4), (2, 6), (2, 8), (2, 10), (2, 12), (4, 4), (4, 6), (4, 8), (4, 10), (4, 12),
               (6, 6), (6, 8), (6, 10), (6, 12), (8, 8), (8, 16), (16, 16)]:
    KEYS["p"][(_a, _b)] = f"p{_a}x{_b}"
TABLE = {"b": BRICK, "p": PLATE, "t": TILE}
# quarter tile: where its square corner is (seen from the front for a panel, from above
# with the back at the top for a flat tile) -> rotation
CORNER = {"TL": 0, "TR": 90, "BR": 180, "BL": 270}


def cname(colour):
    return COLOR_NAMES.get(colour, str(colour))


def sizes(kind, colour, maxw=99, maxl=99):
    """Bestseller sizes of a kind ('b', 'p', 't') in a colour, as (a, b) with a <= b."""
    if colour not in TABLE[kind]:
        raise ValueError(f"{cname(colour)} has no {dict(b='bricks', p='plates', t='tiles')[kind]} "
                         "in the Bestseller tables of portrait.py")
    return [s for s in TABLE[kind][colour] if s in KEYS[kind] and s[0] <= maxw and s[1] <= maxl]


def need(key, colour, option):
    if colour not in HAS[key]:
        raise ValueError(f"{PARTS[key].name} isn't a Bestseller in {cname(colour)}; "
                         f"choose another colour for '{option}'")


def has(key, colour):
    return colour in HAS.get(key, ())


def put(m, kind, colour, x, z, sx, sz, layer):
    """One brick, plate or tile covering sx by sz studs from (x, z)."""
    a, b = sorted((sx, sz))
    key = KEYS[kind][(a, b)]
    fp = PARTS[key].footprint(0)
    w0 = round((max(p[0] for p in fp) - min(p[0] for p in fp)) / 20) + 1
    return m.add(key, colour, x, z, layer, rot=0 if w0 == sx else 90)


def pack(cells, size_of, prefer="x", order="zx"):
    """Cover {(x, z): colour} with rectangles of allowed sizes, largest first.

    size_of(colour) gives the (a, b) sizes; prefer says which way a rectangle
    should run when both fit, order which way the cells are scanned. Returns
    [(x, z, sx, sz, colour)].
    """
    todo = dict(cells)
    out = []
    key = (lambda c: (c[1], c[0])) if order == "zx" else (lambda c: (c[0], c[1]))
    for cell in sorted(cells, key=key):
        if cell not in todo:
            continue
        col = todo[cell]
        cands = set()
        for a, b in size_of(col):
            cands |= {(a, b), (b, a)}
        cands = sorted(cands, key=lambda s: (-s[0] * s[1],
                                             (s[0] < s[1]) if prefer == "x" else (s[0] > s[1])))
        x0, z0 = cell
        for sx, sz in cands:
            blk = [(x0 + i, z0 + j) for i in range(sx) for j in range(sz)]
            if all(todo.get(b) == col for b in blk):
                for b in blk:
                    del todo[b]
                out.append((x0, z0, sx, sz, col))
                break
        else:
            raise ValueError(f"no Bestseller piece covers {cell} in {cname(col)}")
    return out


def fill(m, kind, cells, layer, prefer="x", order="zx", maxw=99, maxl=99, flip=False):
    """pack() and place: cells is {(x, z): colour}. Returns the placements.

    flip packs from the right-hand end instead, so joints fall elsewhere than in a
    course packed from the left."""
    out = []
    if flip:
        lo = min(x for x, _ in cells) + max(x for x, _ in cells)
        cells = {(lo - x, z): c for (x, z), c in cells.items()}
    for x, z, sx, sz, col in pack(cells, lambda c: sizes(kind, c, maxw, maxl), prefer, order):
        if flip:
            x = lo - (x + sx - 1)
        out.append(put(m, kind, col, x, z, sx, sz, layer))
    return out


def line(m, kind, cells, layer, axis, avoid=()):
    """A 1-wide run of bricks or plates along `axis` with joints off `avoid`.

    cells: [(x, z, colour)] in order along the axis. Returns the joints used."""
    out = set()
    i = 0
    while i < len(cells):
        j = i
        while j + 1 < len(cells) and cells[j + 1][2] == cells[i][2] and (
                (cells[j + 1][0] - cells[j][0], cells[j + 1][1] - cells[j][1])
                == ((1, 0) if axis == "x" else (0, 1))):
            j += 1
        col = cells[i][2]
        lens = sorted({b for a, b in sizes(kind, col) if a == 1}, reverse=True)
        run = j - i + 1
        start = cells[i][0] if axis == "x" else cells[i][1]
        pieces = split_length(run, lens, {a - start for a in avoid})
        pos = 0
        for n in pieces:
            x, z = cells[i][0], cells[i][1]
            if axis == "x":
                put(m, kind, col, x + pos, z, n, 1, layer)
            else:
                put(m, kind, col, x, z + pos, 1, n, layer)
            pos += n
        out |= {start + s for s in seams(pieces)}
        i = j + 1
    return out


def band(m, colour, x0, zs, layer, avoid=()):
    """A 2-wide run of bricks along z (x0, x0+1), joints off `avoid`. Returns the joints."""
    lens = sorted({b for a, b in sizes("b", colour) if a == 2} | {1}, reverse=True)
    start = zs[0]
    pieces = split_length(len(zs), lens, {a - start for a in avoid})
    pos = 0
    for n in pieces:
        put(m, "b", colour, x0, start + pos, 2, n, layer)
        pos += n
    return {start + s for s in seams(pieces)}


# --------------------------------------------------------------------------
# side-stud panels
# --------------------------------------------------------------------------
SNOT_FRONT = ((1, 0, 0), (0, 0, -1), (0, 1, 0))     # studs up -> studs to the front


def _mul(a, m):
    b = ((m[0], m[1], m[2]), (m[3], m[4], m[5]), (m[6], m[7], m[8]))
    return tuple(sum(a[i][k] * b[k][j] for k in range(3)) for i in range(3) for j in range(3))


class Panel:
    """A flat mosaic facing the front, on side studs.

    rows: token strings, top row first (see the module notes); legend: code ->
    colour; filler: colour of the backing plates where no backing is given.
    The panel is w studs wide and h studs tall (w and h even); it is held by
    22885 bricks, one per 2 x 2 studs, in the grid row behind it.
    """

    def __init__(self, rows, legend, filler, name="panel"):
        toks = [r.split() for r in rows]
        self.h, self.w = len(toks), len(toks[0])
        if any(len(t) != self.w for t in toks) or self.w % 2 or self.h % 2:
            raise ValueError(f"{name}: rows must be equal and even in width and count")
        self.name, self.filler = name, filler
        self.cells = {}
        for r, row in enumerate(toks):
            for c, tok in enumerate(row):
                self.cells[(c, self.h - 1 - r)] = self._parse(tok, legend)
        self.supports, self.backing_parts = {}, []

    def _parse(self, tok, legend):
        backing = None
        if "@" in tok:
            tok, b = tok.split("@")
            backing = legend[b]
        shape = "sq"
        if "/" in tok:
            tok, s = tok.split("/")
            shape = "round" if s == "o" else s
        if tok == "-":
            return dict(shape=None, colour=None, backing=backing)
        col = legend[tok]
        if shape == "round":
            need("tile_round1", col, f"{self.name} '{tok}'")
        elif shape != "sq":
            need("tile_quarter", col, f"{self.name} '{tok}'")
        return dict(shape=shape, colour=col, backing=backing)

    # -- mounting --------------------------------------------------------
    def at(self, x0, z_wall, layer0):
        """The panel's place: left column x0, held by bricks in grid row z_wall
        (the panel fills row z_wall - 1), bottom at layer0."""
        self.x0, self.z_wall, self.layer0 = x0, z_wall, layer0
        return self

    def add_supports(self, m, band, colour=WHITE):
        """The 22885 bricks behind rows 2*band and 2*band+1 (counted from the bottom)."""
        need("bp_snot1x2", colour, "support")
        for i in range(self.w // 2):
            self.supports[(i, band)] = m.add("bp_snot1x2", colour, self.x0 + 2 * i, self.z_wall,
                                             self.layer0 + 5 * band)

    def _put(self, m, scratch_pl, colour, attach):
        ox, oy, oz, mat, dat = scratch_pl.ldraw
        pos = (ox + 20 * self.x0, -oz - 8 * self.layer0, oy + 20 * self.z_wall)
        key = scratch_pl.key
        return m.add_raw(key, colour, pos, _mul(SNOT_FRONT, mat), attach_to=attach)

    def add_backing(self, m):
        cells = {k: (v["backing"] if v["backing"] is not None else self.filler)
                 for k, v in self.cells.items()}
        scratch = Model("scratch.ldr", "scratch")
        self._backing_at = {}
        for c, k, sx, sk, col in pack(cells, lambda col: sizes("p", col, 2, self.w), "x"):
            pl = put(scratch, "p", col, c, k, sx, sk, 0)
            raw = self._put(m, pl, col, self.supports[(c // 2, k // 2)])
            self.backing_parts.append(raw)
            for i in range(sx):
                for j in range(sk):
                    self._backing_at[(c + i, k + j)] = raw

    def add_tiles(self, m):
        scratch = Model("scratch.ldr", "scratch")
        sq = {k: v["colour"] for k, v in self.cells.items() if v["shape"] == "sq"}
        for c, k, sx, sk, col in pack(sq, lambda col: sizes("t", col), "x"):
            pl = put(scratch, "t", col, c, k, sx, sk, 1)
            self._put(m, pl, col, self._backing_at[(c, k)])
        for (c, k), v in sorted(self.cells.items()):
            if v["shape"] == "round":
                pl = scratch.add("tile_round1", v["colour"], c, k, 1)
            elif v["shape"] in CORNER:
                pl = scratch.add("tile_quarter", v["colour"], c, k, 1, rot=CORNER[v["shape"]])
            else:
                continue
            self._put(m, pl, v["colour"], self._backing_at[(c, k)])


# --------------------------------------------------------------------------
# collision check for side-stud parts
# --------------------------------------------------------------------------
def _raw_box(it, dx, dz, dl):
    ox, oy, oz, mat, dat = it.ldraw
    bmin, bmax, top = geometry(dat)
    y0 = 0.0 if top else bmin[1]          # leave out the studs (they go into the next part)
    pts = []
    for x in (bmin[0], bmax[0]):
        for y in (y0, bmax[1]):
            for z in (bmin[2], bmax[2]):
                pts.append((mat[0] * x + mat[1] * y + mat[2] * z + ox + 20 * dx,
                            mat[3] * x + mat[4] * y + mat[5] * z + oy - 8 * dl,
                            mat[6] * x + mat[7] * y + mat[8] * z + oz + 20 * dz))
    return (tuple(min(p[i] for p in pts) + 0.5 for i in range(3)),
            tuple(max(p[i] for p in pts) - 0.5 for i in range(3)))


def _overlap(a, b):
    return all(a[0][i] < b[1][i] and b[0][i] < a[1][i] for i in range(3))


def check_snot(model):
    """Problems between side-stud parts (add_raw) and the rest of the model."""
    occ, studs, raws, problems = {}, [], [], []
    for f in model.flatten():
        it, dx, dz, dl = f["item"], f["dx"], f["dz"], f["dlayer"]
        if it.layer is None:
            if it.key in ("bar3", "bar4", "glass122", "glass123", "flag2x2"):
                continue
            raws.append((it, _raw_box(it, dx, dz, dl)))
            continue
        for cx, cz in it.cells:
            for h in range(it.layer, it.layer + it.height):
                occ[(cx + dx, cz + dz, h + dl)] = it
        top = it.layer + it.height + dl
        for sx, sz in it.studs:
            studs.append((it, ((20 * (sx + dx) + 4, -8 * top - 4, 20 * (sz + dz) + 4),
                               (20 * (sx + dx) + 16, -8 * top, 20 * (sz + dz) + 16))))
    for it, (lo, hi) in raws:
        name = f"{PARTS[it.key].name} ({cname(it.color)}) at LDraw {tuple(round(v) for v in it.ldraw[:3])}"
        for cx in range(int(lo[0] // 20), int(hi[0] // 20) + 1):
            for cz in range(int(lo[2] // 20), int(hi[2] // 20) + 1):
                for h in range(int(-hi[1] // 8), int(-lo[1] // 8) + 1):
                    o = occ.get((cx, cz, h))
                    if o is not None and _overlap((lo, hi), ((20 * cx, -8 * (h + 1), 20 * cz),
                                                             (20 * cx + 20, -8 * h, 20 * cz + 20))):
                        problems.append(f"{name} overlaps {o.key}/{cname(o.color)} at {(cx, cz, h)}")
        for o, box in studs:
            if _overlap((lo, hi), box):
                problems.append(f"{name} hits a stud of {o.key}/{cname(o.color)}")
    for i in range(len(raws)):
        for j in range(i + 1, len(raws)):
            if _overlap(raws[i][1], raws[j][1]):
                a, b = raws[i][0], raws[j][0]
                problems.append(f"{a.key}/{cname(a.color)} overlaps {b.key}/{cname(b.color)} "
                                f"at LDraw {tuple(round(v) for v in a.ldraw[:3])}")
    return problems


# --------------------------------------------------------------------------
# faces and torso fronts
# --------------------------------------------------------------------------
def make_face_rows(beard=False, smile=True, hairline="corners", brows=True, nose=False):
    """A 6 x 6 face, top row first.

    hairline: None, "corners" (hair rounds the two top corners) or "fringe"
    (hair across the outer top corners, curtain bangs); beard: sideburns,
    moustache and a beard round the mouth; smile: an open smile with teeth,
    else a closed mouth; nose: the two studs of a skin plate show as a nose.
    """
    top = {None: "s s s s s s",
           "corners": "h/TL@s s s s s h/TR@s",
           "fringe": "h h/TL@s s s h/TR@s h"}[hairline]
    rows = [top,
            "s b/BR@s s s b/BL@s s" if brows else "s s s s s s",
            "s e/o@w s s e/o@w s"]
    nose_row = "s s -@s -@s s s" if nose else "s s s s s s"
    if beard:
        rows += ["k s k k s k",
                 "k k t t k k" if smile else "k k l l k k",
                 "k/TR@s k k k k k/TL@s"]
    else:
        rows += [nose_row,
                 "s l/TR@s t t l/TL@s s" if smile else "s s l l s s",
                 # the lips round under the teeth, so the open smile reads as a D
                 "s s l/TR@s l/TL@s s s" if smile else "s s s s s s"]
    return rows


PLAIN_FACE = ["s s s s s s"] * 6


def vneck_rows(depth=3):
    """Torso front with a V-neck: x the top colour, v the colour inside the V."""
    if depth == 3:
        v = ["x/BL@v v v v v x/BR@v",
             "x x/BL@v v v x/BR@v x",
             "x x x/BL@v x/BR@v x x"]
    else:
        v = ["x x/BL@v v v x/BR@v x",
             "x x x/BL@v x/BR@v x x"]
    return v + ["x x x x x x"] * (4 - len(v))


SHIRT_TIE_ROWS = ["x p/TR@x g/TR@p g/TL@p p/TL@x x",
                  "x p g g p x",
                  "x p g g p x",
                  "x p g/TR@p g/TL@p p x"]
PLAIN_TOP_ROWS = ["x x x x x x"] * 4


class Figure:
    """One portrait figure. See the module notes and OPTION_TABLE."""

    def __init__(self, key, name, *, skin=LNOUGAT, hair="wavy", hair_colour=RBROWN,
                 beard=False, beard_colour=None, face="mosaic", face_rows=None, smile=True,
                 brows=None, nose=False, hairline=None, eyes=BLACK, lips=RED,
                 top="vneck", top_colour=BLACK, accent=WHITE, v_depth=2, shirt=BPINK,
                 tie=MAGENTA, sleeves=None, bottoms="trousers", bottoms_colour=DKRED,
                 shoes=BLACK, toe=None, support=WHITE):
        self.key, self.name = key, name
        self.skin, self.hair, self.hair_colour = skin, hair, hair_colour
        self.beard, self.beard_colour = beard, beard_colour if beard_colour is not None else hair_colour
        self.top, self.top_colour, self.accent, self.v_depth = top, top_colour, accent, v_depth
        self.shirt, self.tie = shirt, tie
        self.sleeves = sleeves if sleeves is not None else (skin if top == "dress" else top_colour)
        self.bottoms, self.bottoms_colour = bottoms, bottoms_colour
        self.shoes, self.toe = shoes, toe if toe is not None else shoes
        self.support = support
        self.long_hair = hair in ("wavy", "long")       # hair down to the shoulders
        if hair not in ("short", "spiky", "wavy", "long"):
            raise ValueError(f"hair: {hair}")
        if hairline is None:
            hairline = "fringe" if hair == "long" else "corners"
        brow = brows if brows is not None else (BLACK if hair_colour in (BLACK, DKBROWN)
                                                else (RBROWN if hair_colour != RBROWN else DKBROWN))
        if face == "plain":
            rows = PLAIN_FACE
        else:
            rows = face_rows or make_face_rows(beard=beard, smile=smile, hairline=hairline,
                                           brows=True, nose=nose)
        self.face = Panel(rows, dict(s=skin, e=eyes, w=WHITE, h=hair_colour, b=brow,
                                     k=self.beard_colour, l=lips, t=WHITE), WHITE, "face")
        legend = dict(x=top_colour, v=accent if top != "dress" else skin, p=shirt, g=tie, s=skin)
        trows = {"vneck": vneck_rows(v_depth), "dress": vneck_rows(v_depth),
                 "shirt_tie": SHIRT_TIE_ROWS, "plain": PLAIN_TOP_ROWS}[top]
        filler = top_colour if (2, 6) in TABLE["p"].get(top_colour, ()) else WHITE
        self.front = Panel(trows, legend, filler, "torso front")
        self.models = []
        self._build()

    # -- words -------------------------------------------------------------
    def summary(self):
        hair = {"short": "short", "spiky": "short spiky", "wavy": "wavy shoulder-length",
                "long": "long straight"}[self.hair]
        top = {"vneck": f"a {cname(self.top_colour)} top with a {cname(self.accent)} V-neck",
               "dress": f"a {cname(self.top_colour)} V-neck dress",
               "shirt_tie": f"a {cname(self.top_colour)} blazer over a {cname(self.shirt)} shirt "
                            f"and {cname(self.tie)} tie",
               "plain": f"a {cname(self.top_colour)} top"}[self.top]
        legs = (f"{cname(self.bottoms_colour)} trousers" if self.bottoms == "trousers"
                else f"a {cname(self.bottoms_colour)} skirt")
        if self.top == "dress" and self.bottoms == "skirt" and self.bottoms_colour == self.top_colour:
            top, legs = f"a long {cname(self.top_colour)} V-neck dress with bare arms", None
        shoes = f"{cname(self.shoes)} shoes" + (f" with {cname(self.toe)} toe caps"
                                                 if self.toe != self.shoes else "")
        beard = f", a {cname(self.beard_colour)} beard" if self.beard else ""
        return (f"{cname(self.skin)} skin, {hair} {cname(self.hair_colour)} hair{beard}, {top}, "
                + (f"{legs}, " if legs else "") + shoes)

    # -- submodels ---------------------------------------------------------
    def _model(self, part, title):
        m = Model(f"{self.key}_{part}.ldr", f"{self.name}: {title}")
        self.models.append(m)
        return m

    def _build(self):
        self.shoe = self._shoe()
        self.leg = self._leg() if self.bottoms == "trousers" else None
        self.skirt = self._skirt() if self.bottoms == "skirt" else None
        self.torso = self._torso()
        self.arm = self._arm()
        self.head = self._head()
        self.hair_model = self._hair()
        for m in self.models:
            probs = check_snot(m)
            if probs:
                raise ValueError(f"{m.name}: " + "; ".join(probs[:5]))

    def _shoe(self):
        """2 x 3 sole, a 2 x 2 ankle and a 1 x 2 toe in front (local x 0-1, z 0-2)."""
        m = self._model("shoe", "shoe")
        c, toe = self.shoes, self.toe
        fill(m, "p", {(x, z): c for x in (0, 1) for z in (0, 1, 2)}, 0)
        m.step()
        fill(m, "b", {(x, z): c for x in (0, 1) for z in (1, 2)}, 1)
        if has("bp_cheese1x2", toe):
            m.add("bp_cheese1x2", toe, 0, 0, 1)
        elif has("cheese", toe):
            m.add("cheese", toe, 0, 0, 1)
            m.add("cheese", toe, 1, 0, 1)
        else:
            fill(m, "p", {(0, 0): toe, (1, 0): toe}, 1)
            fill(m, "t", {(0, 0): toe, (1, 0): toe}, 2)
        m.step()
        return m

    def _leg(self):
        """A 2 x 2 leg, 12 plates tall (local x 0-1, z 0-1)."""
        m = self._model("leg", "leg")
        for i, layer in enumerate((0, 3, 6, 9)):
            fill(m, "b", {(x, z): self.bottoms_colour for x in (0, 1) for z in (0, 1)}, layer,
                 prefer="x" if i % 2 else "z")
            if i % 2:
                m.step()
        return m

    def _skirt(self):
        """A 6 x 4 skirt from the shoes to the hips (figure x 0-5, z 0-3, layers 4-17)."""
        m = self._model("skirt", "skirt")
        c = self.bottoms_colour
        area = {(x, z): c for x in range(6) for z in range(4)}
        fill(m, "p", area, 4, maxw=4)
        m.step()
        for i, layer in enumerate((5, 8, 11)):
            fill(m, "b", area, layer, prefer="z" if i % 2 else "x", order="xz" if i % 2 else "zx")
            m.step()
        fill(m, "p", area, 14)
        fill(m, "p", area, 15, prefer="z", flip=True)
        m.step()
        # a tile belt in front of the hip plates (the torso front sits on top of it)
        fill(m, "t", {(x, 0): c for x in range(6)}, 16)
        m.step()
        return m

    def _torso(self):
        """Hip plates, a 6 x 3 core with the front panel, top at layer 27 (figure coords)."""
        m = self._model("torso", "torso")
        bc, tc = self.bottoms_colour, self.top_colour
        m.step("The hip plates reach out under both arms.")
        hip = {(x, z): bc for x in range(-1, 7) for z in (1, 2)}
        hip.update({(x, 3): bc for x in range(6)})
        fill(m, "p", hip, 16)
        m.step()
        p = self.front.at(0, 1, 17)
        block = {(x, z): tc for x in range(6) for z in (2, 3)}
        m.step("The side-stud bricks across the front hold the tiled front of the torso.")
        p.add_supports(m, 0, self.support)
        fill(m, "b", block, 17, prefer="x")
        m.step()
        fill(m, "b", block, 20, flip=True)
        p.add_supports(m, 1, self.support)
        m.step()
        fill(m, "b", block, 23, prefer="x")
        fill(m, "p", block, 26, flip=True)
        m.step()
        p.add_backing(m)
        m.step()
        p.add_tiles(m)
        m.step()
        return m

    def _arm(self):
        """A 1 x 2 arm, hand at the bottom (local x 0, z 0-1, layers 0-10)."""
        m = self._model("arm", "arm")
        upper = self.hair_colour if self.hair == "long" else self.sleeves
        put(m, "b", self.skin, 0, 0, 1, 2, 0)
        put(m, "b", self.sleeves, 0, 0, 1, 2, 3)
        m.step()
        put(m, "b", upper, 0, 0, 1, 2, 6)
        put(m, "p", upper, 0, 0, 1, 2, 9)
        m.step()
        return m

    def _shoulders(self, m, x, z, layer):
        """Plates and tiles over the torso and arms (in the parent model)."""
        upper = self.hair_colour if self.hair == "long" else self.sleeves
        col = {}
        for xx in range(-1, 7):
            for zz in range(4):
                col[(xx, zz)] = self.top_colour if 0 <= xx <= 5 else upper
        cells = {(x + a, z + b): c for (a, b), c in col.items()}
        fill(m, "p", cells, layer + 27, prefer="x")
        m.step()
        keep = {(a, b) for a in (2, 3) for b in (1, 2)}               # the neck
        if self.long_hair:
            keep |= {(a, b) for a in (-1, 6) for b in range(4)}       # the hair rests here
        tiles = {(x + a, z + b): c for (a, b), c in col.items() if (a, b) not in keep}
        fill(m, "t", tiles, layer + 28, prefer="x")
        m.step()

    def _head(self):
        """Neck, floor, the front wall of side-stud bricks, the face and an inner post."""
        m = self._model("head", "head")
        s = self.skin
        if (2, 2) in TABLE["p"].get(s, ()):
            put(m, "p", s, 2, 1, 2, 2, 28)
            put(m, "p", s, 2, 1, 2, 2, 29)
        else:
            put(m, "p", s, 2, 1, 1, 2, 28)
            put(m, "p", s, 3, 1, 1, 2, 28)
            put(m, "p", s, 2, 1, 2, 1, 29)
            put(m, "p", s, 2, 2, 2, 1, 29)
        m.step()
        # the floor reaches under the side hair unless the hair goes on down to the shoulders
        xs = range(0, 6) if self.long_hair else range(-1, 7)
        fill(m, "p", {(x, z): self.hair_colour for x in xs for z in range(4)}, 30, prefer="x")
        m.step()
        f = self.face.at(0, 0, 31)
        post = {(x, z): self.support for x in (2, 3) for z in (2, 3)}
        m.step("The front of the head is three rows of side-stud bricks. The face goes on "
               "their studs.")
        for band in range(3):
            f.add_supports(m, band, self.support)
        for i, layer in enumerate((31, 34, 37, 40)):
            fill(m, "b", post, layer, prefer="x" if i % 2 else "z")
        fill(m, "p", post, 43, prefer="x")
        fill(m, "p", post, 44, prefer="z")
        fill(m, "p", post, 45, prefer="x")
        m.step()
        f.add_backing(m)
        m.step()
        f.add_tiles(m)
        m.step()
        return m

    # -- hair ----------------------------------------------------------------
    def _hair(self):
        m = self._model("hair", "hair")
        c = self.hair_colour
        style = self.hair
        for key in ("s45x2", "slope45"):
            need(key, c, "hair_colour")
        # courses of the U-shaped wall round the sides and back of the head
        # long hair starts at the shoulders; short hair stands on the head's floor plate
        courses = ([28] if self.long_hair else []) + [31 + 3 * i for i in range(5)]
        skip, details = set(), defaultdict(list)

        def side_colour(x, z, layer):
            if style in ("short", "spiky") and not self.beard and layer < 37:
                return self.skin
            if style in ("short", "spiky") and self.beard and layer < 37:
                return self.beard_colour
            return c

        def out_slope(layer, kind, zs=range(0, 4)):
            """Slopes facing out from both sides, in place of the wall at x -2..-1 and 6..7."""
            for z in zs:
                for x in (-2, -1, 6, 7):
                    skip.add((x, z, layer))
            details[layer].append((kind, zs))

        if style == "wavy":
            out_slope(28, "s45x2")             # flicked-out ends at the shoulders
            out_slope(37, "slope45inv")        # a wave out at the temples ...
            out_slope(40, "s45x2")             # ... and back in
        elif style == "long":
            out_slope(43, "s45x2", range(-1, 5))     # the full sides round off into the top
        elif style == "spiky":
            out_slope(43, "slope45", (0, 2))   # spikes out at the sides
        t = 2 if style == "long" else 1      # long hair is two studs thick at the sides
        prev = {}
        for layer in courses:
            # the back wall takes the corners on every other course (and on the first one
            # above the floor, which ties the two sides together)
            own_back = ((layer - 31) // 3) % 2 == 0
            zs = list(range(-1, 4)) if own_back else list(range(-1, 5))
            for side in ("left", "right"):
                x0 = -t if side == "left" else 6       # the side's leftmost column
                cols = list(range(x0, x0 + t))
                runs = []
                for z in zs:
                    row = [(x, z) for x in cols if (x, z, layer) not in skip]
                    if len(row) < t:
                        continue
                    if runs and z == runs[-1][-1] + 1:
                        runs[-1].append(z)
                    else:
                        runs.append([z])
                used = set()
                for run in runs:
                    if t == 1:
                        cells = [(x0, z, side_colour(x0, z, layer)) for z in run]
                        used |= line(m, "b", cells, layer, "z", prev.get(side, ()))
                    else:
                        used |= band(m, c, x0, run, layer, prev.get(side, ()))
                prev[side] = used
            if layer >= 31:
                xs = list(range(-t, 6 + t)) if own_back else list(range(0, 6))
                cells = [(x, 4, c) for x in xs if (x, 4, layer) not in skip]
                # no joint where the back meets a side, so it ties the two sides together
                avoid = set(prev.get("x", ())) | ({0, 6} if own_back else set())
                prev["x"] = line(m, "b", cells, layer, "x", avoid)
            for kind2, zs2 in details.get(layer, ()):
                self._side_slopes(m, kind2, layer, zs2)
            m.step()
        # the top plate ties the walls to the front of the head
        fill(m, "p", {(x, z): c for x in range(-1, 7) for z in range(-1, 5)}, 46, prefer="z",
             maxw=2)
        m.step()
        {"short": self._top_short, "spiky": self._top_spiky, "wavy": self._top_round,
         "long": self._top_round}[style](m)
        return m

    def _side_slopes(self, m, kind, layer, zs):
        c = self.hair_colour
        zs = list(zs)
        if kind == "s45x2":
            for z in zs[::2]:
                m.add("s45x2", c, -2, z, layer, rot=FACE["left"])
                m.add("s45x2", c, 6, z, layer, rot=FACE["right"])
        else:
            need(kind, c, "hair_colour")
            for z in zs:
                m.add(kind, c, -2, z, layer, rot=FACE["left"])
                m.add(kind, c, 6, z, layer, rot=FACE["right"])

    def _top_round(self, m):
        """A rounded top: 45 degree slopes all round, a flat crown with tiles."""
        c = self.hair_colour
        for x in (-1, 1, 3, 5):
            m.add("s45x2", c, x, -1, 47, rot=FACE["front"])
            m.add("s45x2", c, x, 3, 47, rot=FACE["back"])
        m.add("s45x2", c, -1, 1, 47, rot=FACE["left"])
        m.add("s45x2", c, 5, 1, 47, rot=FACE["right"])
        fill(m, "b", {(x, z): c for x in range(1, 5) for z in (1, 2)}, 47)
        m.step()
        fill(m, "t", {(x, z): c for x in range(1, 5) for z in (1, 2)}, 50)
        m.step()

    def _top_short(self, m):
        c = self.hair_colour
        for x in range(-1, 7):
            m.add("slope45", c, x, -1, 47, rot=FACE["front"])
        for x in (-1, 1, 3, 5):
            m.add("s45x2", c, x, 3, 47, rot=FACE["back"])
        fill(m, "b", {(x, z): c for x in range(-1, 7) for z in (1, 2)}, 47)
        m.step()
        fill(m, "t", {(x, z): c for x in range(-1, 7) for z in (1, 2)}, 50)
        m.step()

    def _top_spiky(self, m):
        """Spikes: tall and short slopes in turn round a raised crest."""
        c = self.hair_colour
        tall = "slope65" if has("slope65", c) else "slope45"
        # a jagged fringe pointing forward, and the back pointing back
        for x in range(-1, 7):
            m.add(tall if x in (0, 2, 5) else "slope45", c, x, -1, 47, rot=FACE["front"])
            m.add(tall if x in (1, 4) else "slope45", c, x, 3, 47, rot=FACE["back"])
        fill(m, "b", {(x, z): c for x in range(-1, 7) for z in (1, 2)}, 47)
        m.step()
        # the crest: spikes out to the sides, and tall ones pointing both ways on top
        m.add("s45x2", c, -1, 1, 50, rot=FACE["left"])
        m.add("s45x2", c, 5, 1, 50, rot=FACE["right"])
        for x in range(1, 5):
            m.add(tall, c, x, 1, 50, rot=FACE["front"] if x in (1, 3) else FACE["back"])
        m.step()

    # -- placing -------------------------------------------------------------
    def sub_info(self):
        """Booklet titles and blurbs for the submodels that get a section."""
        n = self.name
        return {
            self.torso.name: (f"{n}: torso",
                              f"The hips, the torso and the tiled front: {self._front_words()}."),
            self.head.name: (f"{n}: head",
                             "The neck, the head and the face. The face is a mosaic of tiles "
                             "on side studs: eyes, brows and smile."
                             + (" The beard is part of it." if self.beard else "")),
            self.hair_model.name: (f"{n}: hair",
                                   f"The {cname(self.hair_colour)} hair round the sides, back "
                                   "and top of the head."),
        } | ({self.skirt.name: (f"{n}: skirt", f"The {cname(self.bottoms_colour)} skirt.")}
             if self.skirt else {})

    def _front_words(self):
        return {"vneck": f"a {cname(self.top_colour)} top with a {cname(self.accent)} V-neck",
                "dress": f"the {cname(self.top_colour)} dress with its V-neck",
                "shirt_tie": f"the {cname(self.top_colour)} blazer, {cname(self.shirt)} shirt and "
                             f"{cname(self.tie)} tie",
                "plain": f"a {cname(self.top_colour)} top"}[self.top]

    def place(self, m, x, z, layer):
        """Add the figure to model m, standing at (x, z) on layer `layer`."""
        n = self.name
        zs = -1 if self.bottoms == "skirt" else 0
        m.section(f"{n}: shoes and legs",
                  f"{n}'s shoes and " + ("legs." if self.leg else "skirt."))
        m.sub(self.shoe, x, z + zs, layer)
        m.sub(self.shoe, x + 4, z + zs, layer)
        m.step()
        if self.leg:
            m.sub(self.leg, x, z + 1, layer + 4)
            m.sub(self.leg, x + 4, z + 1, layer + 4)
        else:
            m.sub(self.skirt, x, z, layer)
        m.step()
        m.sub(self.torso, x, z, layer)
        m.step()
        m.step("Set both arms on the ends of the hip plates; the shoulder plates lock them in.")
        m.sub(self.arm, x - 1, z + 1, layer + 17)
        m.sub(self.arm, x + 6, z + 1, layer + 17)
        m.step()
        self._shoulders(m, x, z, layer)
        m.sub(self.head, x, z, layer)
        m.step()
        m.sub(self.hair_model, x, z, layer)
        m.step()

    def parts_count(self):
        """Every element of one figure, shoulders included: Counter((dat, colour))."""
        from collections import Counter
        c = Counter()
        mult = {self.shoe.name: 2, self.arm.name: 2}
        if self.leg:
            mult[self.leg.name] = 2
        for m in self.models:
            for k, n in m.parts_count().items():
                c[k] += n * mult.get(m.name, 1)
        tmp = Model("tmp.ldr", "tmp")
        self._shoulders(tmp, 0, 0, 0)
        c.update(tmp.parts_count())
        return c

    def colours(self):
        return {col for _, col in self.parts_count()}

    def top_layer(self):
        """The top of the hair, in plates above the soles."""
        return max(it.layer + it.height for it in self.hair_model.items)

    def height_cm(self, base=1):
        """Height standing on a base whose top tiles are `base` plates above the table."""
        return round((self.top_layer() + base) * 0.32, 1)

    def footprint(self, x, z):
        """Base cells under the shoes (they stand on the base's studs)."""
        zs = -1 if self.bottoms == "skirt" else 0
        return {(x + a + dx, z + zs + b) for a in (0, 4) for dx in (0, 1) for b in range(3)}


# --------------------------------------------------------------------------
# display base, hearts and the photo frame
# --------------------------------------------------------------------------
def heart_cells(x0, z0, colour):
    """A 5 x 5 heart lying flat, point to the front, at x0..x0+4, z0..z0+4.

    Returns {(x, z): (colour, shape)}: shape x for a square tile, o for a round
    tile (the point), or a corner name for a quarter tile."""
    rows = [["BR", "BL", None, "BR", "BL"],          # back: the two lobes
            ["x", "x", "x", "x", "x"],
            ["TR", "x", "x", "x", "TL"],
            [None, "TR", "x", "TL", None],
            [None, None, "o", None, None]]           # front: the point
    out = {}
    for r, row in enumerate(rows):
        for i, sh in enumerate(row):
            if sh:
                out[(x0 + i, z0 + 4 - r)] = (colour, sh)
    return out


def display_base(m, w, d, keep=(), colour=WHITE, hearts=(), extra=None):
    """A w x d base: plates on layer 0, tiles on layer 1 except under `keep`.

    hearts: [(x, z, colour)] 5 x 5 tile hearts set into the tiles. extra: tiles
    of other colours {(x, z): (colour, shape)}. Returns the reserved cells."""
    plates = {(x, z): colour for x in range(w) for z in range(d)}
    rects = pack(plates, lambda c: sizes("p", c, 6), "x")
    for x, z, sx, sz, c in rects:
        put(m, "p", c, x, z, sx, sz, 0)
    m.step()
    keep = set(keep)
    art = dict(extra or {})
    for hx, hz, hc in hearts:
        need("tile_quarter", hc, "heart colour")
        art.update(heart_cells(hx, hz, hc))
    free = {(x, z) for x in range(w) for z in range(d)} - keep - set(art)
    # tie the plates together: a tile across the joint of every two neighbouring plates
    owner = {}
    for i, (x, z, sx, sz, c) in enumerate(rects):
        for a in range(sx):
            for b in range(sz):
                owner[(x + a, z + b)] = i
    tied = set()
    for (x, z), i in sorted(owner.items(), key=lambda kv: (kv[0][1], kv[0][0])):
        for dx, dz in ((1, 0), (0, 1)):
            j = owner.get((x + dx, z + dz))
            if j is None or j == i or (i, j) in tied:
                continue
            for blk, (sx, sz) in (([(x, z), (x + dx, z + dz), (x + dz, z + dx),
                                    (x + dx + dz, z + dz + dx)], (2, 2)),
                                   ([(x, z), (x + dx, z + dz)], (1 + dx, 1 + dz))):
                if all(c in free for c in blk) and (min(sx, sz), max(sx, sz)) in TABLE["t"][colour]:
                    put(m, "t", colour, x, z, sx, sz, 1)
                    free -= set(blk)
                    tied |= {(i, j), (j, i)}
                    break
    tiles = {c: colour for c in free}
    for (x, z), (c, s) in art.items():
        if s == "x":
            tiles[(x, z)] = c
    fill(m, "t", tiles, 1, prefer="z")
    for (x, z), (c, s) in sorted(art.items()):
        if s in CORNER:
            m.add("tile_quarter", c, x, z, 1, rot=CORNER[s])
        elif s == "o":
            need("tile_round1", c, "heart colour")
            m.add("tile_round1", c, x, z, 1)
        elif s == "heart":
            need("bp_heart1", c, "heart colour")
            m.add("bp_heart1", c, x, z, 1)
    m.step()
    return keep | set(art)


def photo_frame(name="frame.ldr", frame=WHITE, photo=LBG, easel=TAN, x=0, z=0, layer=0,
                width=6, rows=6, legs=12, support=WHITE):
    """A white frame round a flat (light grey) tiled area for a printed photo, on an easel.

    The frame is width+2 studs wide (x .. x+width+1) and 2 deep (z, z+1). It stands
    on two easel legs of 1 x 2 bricks, `legs` plates tall, at its ends; a tan block
    on top is the head of the easel. The photo area is a side-stud panel of tiles,
    width x rows studs (both even), in the front row. Returns the submodel.
    """
    m = Model(name, "Photo frame on an easel")
    W, nb = width + 2, rows // 2
    ends = (x, x + W - 1)
    both = (z, z + 1)
    m.step("The two easel legs stand on the base.")
    for i in range(legs // 3):
        for xx in ends:
            put(m, "b", easel, xx, z, 1, 2, layer + 3 * i)
    m.step()
    fill(m, "p", {(xx, zz): frame for xx in range(x, x + W) for zz in both}, layer + legs)
    m.step()
    # one plate above the bottom plate: tiles under the photo area, plates behind it
    sill = layer + legs + 1
    inner = range(x + 1, x + W - 1)
    fill(m, "t", {(xx, z): frame for xx in inner}, sill)
    fill(m, "p", {(xx, z + 1): frame for xx in inner}, sill)
    bottom = sill + 1
    panel = Panel(["w " * width] * rows, dict(w=photo), photo, "photo").at(x + 1, z + 1, bottom)
    m.step("Side-stud bricks across the back of the frame hold the flat photo area.")
    for band in range(nb):
        panel.add_supports(m, band, support)
    h = 1 + 5 * nb                      # the sides, from the sill to the top plate
    for i in range(h // 3):
        for xx in ends:
            put(m, "b", frame, xx, z, 1, 2, sill + 3 * i)
    for i in range(h % 3):
        for xx in ends:
            put(m, "p", frame, xx, z, 1, 2, sill + 3 * (h // 3) + i)
    m.step()
    top = bottom + 5 * nb
    fill(m, "p", {(xx, zz): frame for xx in range(x, x + W) for zz in both}, top)
    m.step()
    panel.add_backing(m)
    m.step()
    panel.add_tiles(m)
    m.step()
    mid = (x + W // 2 - 1, x + W // 2)
    fill(m, "t", {(xx, zz): frame for xx in range(x, x + W) for zz in both if xx not in mid},
         top + 1)
    fill(m, "b", {(xx, zz): easel for xx in mid for zz in both}, top + 1)
    fill(m, "t", {(xx, zz): easel for xx in mid for zz in both}, top + 4)
    m.step()
    m.photo_area = (width, rows)
    return m


# --------------------------------------------------------------------------
# README of a portrait kit (each kit's readme.py calls write_readme, last in build.sh)
# --------------------------------------------------------------------------
COLOUR_ROWS = {   # LDraw colour -> (name in the booklet, LEGO name, BrickLink name)
    BLACK: ("Black", "Black", "Black"), WHITE: ("White", "White", "White"),
    TAN: ("Tan", "Brick Yellow", "Tan"), RBROWN: ("Reddish Brown", "Reddish Brown", "Reddish Brown"),
    RED: ("Red", "Bright Red", "Red"), DKRED: ("Dark Red", "New Dark Red", "Dark Red"),
    DKBLUE: ("Dark Blue", "Earth Blue", "Dark Blue"),
    BPINK: ("Bright Pink", "Light Purple", "Bright Pink"),
    MAGENTA: ("Magenta", "Bright Reddish Violet", "Magenta"),
    LNOUGAT: ("Light Nougat", "Light Nougat", "Light Nougat"),
    MNOUGAT: ("Medium Nougat", "Medium Nougat", "Medium Nougat"),
    LBG: ("Light Bluish Gray", "Medium Stone Grey", "Light Bluish Gray"),
    DBG: ("Dark Bluish Gray", "Dark Stone Grey", "Dark Bluish Gray"),
    DKBROWN: ("Dark Brown", "Dark Brown", "Dark Brown"), DKTAN: ("Dark Tan", "Sand Yellow", "Dark Tan"),
    BLYELLOW: ("Bright Light Yellow", "Cool Yellow", "Bright Light Yellow"),
}


def colour_rows(colours):
    """PROJECT colour_rows for the colours a kit uses."""
    return [COLOUR_ROWS[c] for c in sorted((c for c in colours if c in COLOUR_ROWS),
                                           key=lambda c: COLOUR_ROWS[c][0])]


def model_colours(models):
    return {col for m in models for _, col in m.parts_count()}


CONST = {BLACK: "BLACK", WHITE: "WHITE", TAN: "TAN", RBROWN: "RBROWN", RED: "RED",
         DKRED: "DKRED", DKBLUE: "DKBLUE", BPINK: "BPINK", MAGENTA: "MAGENTA",
         MNOUGAT: "MNOUGAT", LNOUGAT: "LNOUGAT", LBG: "LBG", DBG: "DBG", DKTAN: "DKTAN",
         DKBROWN: "DKBROWN", BLYELLOW: "BLYELLOW"}
COLOUR_OPTIONS = {"skin", "hair_colour", "beard_colour", "brows", "eyes", "lips", "top_colour",
                  "accent", "shirt", "tie", "sleeves", "bottoms_colour", "shoes", "toe",
                  "support"}


def options_text(opts):
    """Figure options as they are written in design.py: ["skin=pt.LNOUGAT", ...]."""
    return [f"{k}=pt.{CONST[v]}" if k in COLOUR_OPTIONS and v in CONST else f"{k}={v!r}"
            for k, v in opts.items()]


OPTION_TABLE = [
    ("`skin`", "`LNOUGAT` (Light Nougat, the lightest), `MNOUGAT` (Medium Nougat), `TAN`, "
               "`RBROWN` (Reddish Brown, the deepest)"),
    ("`hair`", "`\"short\"` (neat), `\"spiky\"` (short, with spikes on top and at the sides), "
               "`\"wavy\"` (shoulder length, flicked out at the temples and the ends), "
               "`\"long\"` (straight, two studs thick, past the shoulders and over the upper arms)"),
    ("`hair_colour`", "`BLACK`, `RBROWN` (auburn or brown), `TAN` (blonde), `DKBROWN`, `WHITE`, "
                      "`LBG` / `DBG` (grey), `RED`; the brows follow it (`brows=` to change)"),
    ("`beard`", "`True` for sideburns, a moustache and a beard round the mouth, in "
                "`beard_colour` (default: the hair colour)"),
    ("`face`", "`\"mosaic\"` (default: eyes, brows and mouth in tiles) or `\"plain\"` (all skin "
               "tiles, for a printed sticker); `smile=False` for a closed mouth, `nose=True` "
               "for a two-stud nose, `hairline=` `\"corners\"`, `\"fringe\"` or `None`, "
               "`eyes=` and `lips=` colours, or `face_rows=[...]` for a hand-drawn 6 × 6 face"),
    ("`top`", "`\"vneck\"` (`top_colour` with an `accent` V-neck), `\"shirt_tie\"` (a "
              "`top_colour` blazer over a `shirt` and `tie`), `\"dress\"` (a V-neck top in the "
              "dress colour with bare arms) or `\"plain\"`; `v_depth=2` or `3` rows; "
              "`sleeves=` (default: the top colour, skin for a dress)"),
    ("`bottoms`", "`\"trousers\"` (two 2 × 2 legs) or `\"skirt\"` (a 6 × 4 block down to the "
                  "shoes), in `bottoms_colour`"),
    ("`shoes`", "the shoe colour, and `toe=` for a toe cap in another colour"),
]


def write_readme(proj, kit):
    """Write <kit>/README.md from the build outputs (parts/, data/elements.csv, checks.md, PDF).

    kit: dict with
      figures       [(Figure, "its name in design.py", "what the photo shows"), ...]
      calls         {"NAME": ["option=...", ...]} as written in design.py
      intro         the opening paragraph (Markdown)
      base          a sentence on the base and what is on it
      extra         optional (title, [paragraphs]) for a further part, e.g. the photo frame
      extra_models  names of submodels that aren't part of a figure (the frame)
      notes         building notes, [lines]
      box           the box size for the shipping note, e.g. "24 × 14 × 22 cm"
    Costs are the live Pick a Brick prices in parts/kit_cost.csv; the base case adds
    pricing.REPRICE_LIVE (nothing) and the stress case pricing.REPRICE.
    """
    import csv
    import os
    import kit_readme
    import pricing as pr

    plain, money = kit_readme.plain, kit_readme.money
    P, s = proj.meta, kit_readme.kit_stats(proj)
    main_m, models, _ = proj.build(verbose=False, write=False)
    with open(os.path.join(proj.data_dir, "elements.csv"), newline="") as fh:
        el = {(r["ldraw_part"], int(r["ldraw_color"])): r for r in csv.DictReader(fh)}
    live_date = next((r.get("pab_live_date") for r in el.values() if r.get("pab_live_date")), "")

    def unit(dat, col):
        r = el.get((dat, col), {})
        p = r.get("pab_price_live") or r.get("pab_price_2025") or r.get("pab_price_2022")
        return float(p) if p else 0.0

    def cost(counter):
        return sum(unit(d, c) * n for (d, c), n in counter.items())

    base = getattr(pr, "REPRICE_LIVE", 0.0)       # live prices: no uplift in the base case
    stress = pr.REPRICE
    stem, pdf = P["model_name"], P["pdf_name"]
    w, d, h = s["dims"]
    figs = [(f, var, desc, f.parts_count()) for f, var, desc in kit["figures"]]
    fig_cost = [cost(c) for *_, c in figs]
    fig_pieces = [sum(c.values()) for *_, c in figs]
    by_name = {m.name: m for m in models}
    extra_cost = sum(cost(by_name[n].parts_count()) for n in kit.get("extra_models", ()))
    base_cost = s["cost"] - sum(fig_cost) - extra_cost
    when = (f"the US Pick a Brick prices of {live_date} (a snapshot of the Bestseller list)"
            if live_date else "the Pick a Brick prices last seen")
    c0 = pr.unit_costs(s["cost"], s["pieces"], base)
    c1 = pr.unit_costs(s["cost"], s["pieces"], stress)
    L = []
    add = L.append

    add(f"# {plain(P['title'])}\n")
    add("**A LEGO® portrait figure kit with build instructions.**\n")
    add(f"![The finished model](images/{stem}_front_right.jpg)\n")
    add(kit["intro"] + "\n")
    for f, var, desc, _ in figs:
        add(f"- **{f.name}** ({desc}): {f.summary()}")
    add(f"- {kit['base']}\n")
    add("The kit is sold as a pack of parts with a PDF booklet. Every part is a real LEGO "
        "element on Pick a Brick's Bestseller list (up to 999 of an element per order), and one "
        "file uploads the whole list for 1, 10 or 25 kits. The figures come from the shared "
        "generator [`../lego-kit/portrait.py`](../lego-kit/portrait.py): each one is a few "
        "lines of options, which is how a seller makes a custom figure from a customer's "
        "photo (see [Custom orders](#making-a-custom-figure-from-a-customer-photo)).\n")
    add("| | |\n|---|---|")
    add(f"| Pieces | **{s['pieces']}** ({s['lines']} part/colour lines, {s['designs']} kinds of "
        f"part, {s['colours']} colours) |")
    if len(figs) == 1:
        add(f"| Figure | {fig_pieces[0]} pieces, 8 studs (6.4 cm) wide, with a 6 × 6-stud face; "
            f"{figs[0][0].height_cm():.0f} cm tall |")
    else:
        add(f"| Figures | {len(figs)}, each 8 studs (6.4 cm) wide with a 6 × 6-stud face; "
            + ", ".join(f"{f.name.lower()} {n} pieces, {f.height_cm():.0f} cm tall"
                        for (f, *_), n in zip(figs, fig_pieces)) + " |")
    add(f"| Overall size | {w} × {d} cm, {h} cm tall on its base |")
    add(f"| Instructions | {s['pages']}-page PDF, {s['steps']} steps, {s['sections']} sections |")
    add(f"| Parts cost | **{money(s['cost'])} per kit** at {when}; prices and stock change "
        "(see [Cost assumptions](#cost-assumptions-and-resale-scenarios)) |")
    add("| Cost per figure | " + "; ".join(f"{f.name.lower()} **{money(c)}**"
                                           for (f, *_), c in zip(figs, fig_cost))
        + f"; the base {money(base_cost)}"
        + (f"; {kit['extra'][0].lower()} {money(extra_cost)}" if kit.get("extra") else "")
        + " |")
    add(f"| Kits per order | up to **{s['copies']}** (the most-used part is needed "
        f"{s['max_q']} times) |")
    add(f"\n![Front view](images/{stem}_front.jpg)\n")

    add("## The figures\n" if len(figs) > 1 else "## The figure\n")
    add(("Each figure is" if len(figs) > 1 else "The figure is")
        + " made by `portrait.Figure` in [`design.py`](design.py):\n")
    add("```python")
    for f, var, _, _ in figs:
        add(f"{var} = pt.Figure({f.key!r}, {f.name!r},\n    " + ",\n    ".join(kit["calls"][var])
            + ")")
    add("```\n")
    add("| Figure | Pieces | Part/colour lines | Parts cost |\n|---|---|---|---|")
    for (f, _, _, c), n, k in zip(figs, fig_pieces, fig_cost):
        add(f"| {f.name} | {n} | {len(c)} | {money(k)} |")
    add("")
    add("Every figure has the same build: two shoes with toe caps, two 2 × 2 legs (or a skirt), "
        "hip plates, a 6 × 3 torso of bricks whose front is a panel of tiles on side studs, two "
        "1 × 2 arms with hands, shoulder plates and tiles, a short 2 × 2 neck, and the head: a "
        "floor plate, a wall of side-stud bricks with the 6 × 6 tiled face on it, an inner post, "
        "and the hair, which wraps the sides, the back and the top and is built on its own. "
        "A figure is about 16 cm tall, 8 studs wide (the hair can flare out to 10) and 6 "
        "deep.\n")
    if kit.get("extra"):
        title, paras = kit["extra"]
        add(f"## {title}\n")
        L.extend(p + "\n" for p in paras)

    add("## Faces: a brick mosaic, or a printed sticker\n")
    add("The figures in the reference photos have custom-printed faces, which stock LEGO parts "
        "can't give. This kit offers two ways round that:\n")
    add("1. **Brick-built mosaic (the default, as in this kit).** The face is a 6 × 6-stud "
        "panel of tiles facing forward on side studs (SNOT): black round tiles on white for the "
        "eyes, quarter-round tiles for the brows, the hairline and the corners of the smile, "
        "white tiles for teeth, and for a beard black tiles round the mouth and jaw. Light "
        "Nougat tiles fill the rest.")
    add("2. **A printed face sticker (optional, not a LEGO part).** Every tile of the face is "
        "flush, so the whole 4.8 × 4.8 cm face is one smooth surface. A seller can print the "
        "customer's face (48 × 48 mm, rounded corners) on vinyl sticker paper and put it over "
        "the mosaic, or build the face with `face=\"plain\"` (all skin tiles) as a blank for "
        "the sticker. The sticker is a separate item the seller makes; it isn't in the parts "
        "lists or the cost.\n")
    add("Build the mosaic and offer the sticker as an extra: the figure still looks right "
        "without it.\n")

    add("## Options in `portrait.py`\n")
    add("| Option | Choices |\n|---|---|")
    for a, b in OPTION_TABLE:
        add(f"| {a} | {b} |")
    add("")
    add("All four skin tones are on the Bestseller list. Light Nougat, the lightest, is used "
        "for the figures in this kit; Medium Nougat, Tan and Reddish Brown cover medium to "
        "deep skin. Each colour and part the generator uses is checked against the Bestseller "
        "tables in `portrait.py` (from the US list of 17 October 2026). A choice that isn't a "
        "Bestseller (a hair colour without 45° slopes, say) stops the build with a message "
        "naming the option to change. `Figure.summary()` describes a figure in words, for the "
        "order confirmation.\n")

    add("## Making a custom figure from a customer photo\n")
    add("1. **Pick the options** from the photo, with the customer's permission to make their "
        "likeness: skin tone, hair style and colour, beard, the top and its colours, trousers "
        "or skirt, shoes. Copy this kit's folder, change the `pt.Figure(...)` lines in "
        "`design.py` (and the title), and check the look with "
        "`xvfb-run -a python3 ../lego-kit/preview.py .`, which renders it in a minute. For "
        "glasses, freckles or a different smile, draw the face as `face_rows=[...]` (six rows "
        "of six tokens; see the notes at the top of `portrait.py`).")
    add("2. **Run `./build.sh`** with `DATA_DIR` set: it renders every step, maps the parts to "
        "LEGO element IDs, checks the model, prints the booklet and writes the parts lists and "
        "this README.")
    add("3. **Order the parts:** upload `parts/pick_a_brick_upload.csv` (or the 10- or 25-kit "
        "file) to Pick a Brick and check the total.")
    add("4. **Print the extras (optional):** a 48 × 48 mm face sticker for each figure"
        + (" and the photo for the frame (see above)" if kit.get("extra") else "")
        + ", on sticker paper. They aren't LEGO parts.")
    add("5. **Pack** the parts by section (`parts/parts_by_section.csv`) with a card linking to "
        "the PDF booklet.\n")
    span = (money(fig_cost[0]) if len(figs) == 1
            else f"{money(min(fig_cost))} to {money(max(fig_cost))}")
    add(f"**Cost per extra figure:** a figure's parts cost about {span} (its "
        f"{min(fig_pieces)}–{max(fig_pieces)} pieces, shoulders included). A kit with one more "
        "figure also needs a base about 11 studs wider, a few dollars more of plates and "
        "tiles.\n")

    add("## What's in this folder\n")
    add("| Path | What it is |\n|---|---|")
    add(f"| [`instructions/{pdf}`](instructions/{pdf}) | **The instruction booklet**: cover, "
        f"section intros with parts lists, {s['steps']} numbered steps, gallery, parts inventory "
        "with element IDs, ordering guide |")
    add("| [`parts/pick_a_brick_upload.csv`](parts/pick_a_brick_upload.csv) | Pick a Brick "
        f"upload file for **one kit** ({s['lines']} element IDs) |")
    add("| [`parts/pick_a_brick_upload_x10.csv`](parts/pick_a_brick_upload_x10.csv), "
        "[`parts/pick_a_brick_upload_x25.csv`](parts/pick_a_brick_upload_x25.csv) | Upload "
        f"files for **10 kits** ({s['pieces'] * 10:,} pieces) and **25 kits** "
        f"({s['pieces'] * 25:,} pieces) |")
    add("| [`parts/kit_cost.csv`](parts/kit_cost.csv) | Cost of one kit, line by line, with the "
        "price and when it was seen |")
    add("| [`parts/pick_a_brick_list.csv`](parts/pick_a_brick_list.csv) | Bill of materials: "
        "element ID, quantity, part, LEGO colour, design ID, BrickLink part and colour |")
    add("| [`parts/pick_a_brick_mapping.csv`](parts/pick_a_brick_mapping.csv) | Part-by-part "
        "sourcing: Pick a Brick name, evidence it's sold, price, the ID to try next, BrickLink "
        "backup |")
    add("| [`parts/bricklink_wanted_list.xml`](parts/bricklink_wanted_list.xml), "
        "[`parts/rebrickable_parts.csv`](parts/rebrickable_parts.csv) | BrickLink wanted list "
        "and Rebrickable import (one kit) |")
    add("| [`parts/parts_by_section.csv`](parts/parts_by_section.csv) | Parts for each section, "
        "for bagging |")
    add(f"| [`model/{stem}.mpd`](model/{stem}.mpd) | The digital model (LDraw, with steps and "
        "submodels). Opens in BrickLink Studio, LeoCAD and LDCad |")
    add("| [`checks.md`](checks.md) | Results of the digital build checks |")
    add("| [`design.py`](design.py) | The kit: the figures' options, the base and the layout |")
    add("| [`readme.py`](readme.py) | Writes this README from the build outputs |\n")

    add("## Ordering the parts\n")
    add("1. On lego.com, open **Pick and Build → Pick a Brick** and choose **Upload list**.")
    add("2. Upload the file for 1, 10 or 25 kits.")
    add("3. Before you pay, check that every line shows the normal (Bestseller) delivery time "
        "and compare the bag total with the cost below.")
    add("4. If a line isn't matched, use the ID in the \"If not found\" column of the mapping, "
        "multiplied by the number of kits.\n")
    more = (" (the 25-kit file needs two orders, or ask LEGO customer service)"
            if s["copies"] < 25 else "")
    add(f"**Kits per order:** the part this kit uses most is needed {s['max_q']} times, so one "
        f"order holds up to **{s['copies']} kits**{more}.\n")
    add("**Sourcing evidence** (every part passes the Bestseller-only check in "
        "`export_parts.py`):\n")
    add("| Evidence | Lines |\n|---|---|")
    for k, v in s["evidence"].most_common():
        add(f"| {k} | {v} |")
    add("")
    add("The Bestseller list is a snapshot of what was available on one day, with prices but "
        "no stock counts. A part can sell out or change price, so upload the list before "
        "quoting a customer.\n")

    add("## Cost assumptions and resale scenarios\n")
    add("These are planning numbers, not quotes: the bag total on Pick a Brick is the real "
        "parts cost.\n")
    add("| Assumption | Value |\n|---|---|")
    add(f"| Parts | {when}; prices and stock change, and the snapshot has no stock counts |")
    add(f"| Parts, stress case | +{stress:.0%} on those prices (LEGO repriced about a third of "
        "Pick a Brick elements on September 14, 2026, by 16.7% on average) |")
    for a, b in pr.ASSUMPTIONS:
        if a.startswith("Parts") or a == "Prices":
            continue
        add(f"| {a} | {b} |")
    mult = " / ".join(f"{m:g}x" for m in pr.PRICE_MULTIPLES)
    add(f"| Prices | {mult} the parts cost at today's prices, rounded up to $x9.99; market "
        "prices for custom portrait figures were not researched |\n")
    add("| Per kit | Today's prices | Stress case |\n|---|---|---|")
    add(f"| Parts | {money(c0['parts'])} | {money(c1['parts'])} |")
    add(f"| Packaging | {money(pr.PACKAGING)} | {money(pr.PACKAGING)} |")
    add(f"| Labour ({s['pieces']} pieces) | {money(c0['labour'])} | {money(c1['labour'])} |")
    add(f"| Before shipping | {money(c0['before_shipping'])} | {money(c1['before_shipping'])} |")
    add(f"| Seller-paid shipping | {money(pr.SHIP_SELLER_PAID)} | {money(pr.SHIP_SELLER_PAID)} |\n")
    add("Biggest cost lines: " + ", ".join(
        f"{r['Quantity']}× {r['Description']} ({r['LEGO colour']}) "
        f"{money(float(r['Line cost (USD)']))}" for r in s["top_lines"]) + ".\n")
    add("| Price | Free shipping (seller pays): profit | margin | Buyer pays postage: profit | "
        "margin |")
    add("|---|---|---|---|---|")
    for p in [pr.round_price(s["cost"] * (1 + base) * m) for m in pr.PRICE_MULTIPLES]:
        a = pr.scenario(s["cost"], s["pieces"], p, True, base)
        b = pr.scenario(s["cost"], s["pieces"], p, False, base)
        add(f"| {money(p)} | {money(a['profit'])} | {a['margin']:.0%} | {money(b['profit'])} | "
            f"{b['margin']:.0%} |")
    add(f"\nBreak-even price: {money(pr.break_even(s['cost'], s['pieces'], True, base))} with "
        f"free shipping, {money(pr.break_even(s['cost'], s['pieces'], False, base))} when the "
        f"buyer pays postage. The stress case adds {money(c1['parts'] - c0['parts'])} per kit. "
        f"The kit packs into a box of about {kit['box']}; check the shipping weight and size "
        "band before setting a free-shipping price. A printed face sticker or photo adds its "
        "own small cost.\n")

    add("## Digital checks and physical prototype\n")
    add("`lego-kit/checks.py` checked the digital model ([`checks.md`](checks.md)):\n")
    add("| Check | Result |\n|---|---|")
    for k in ("Collisions", "Connections", "Assembly order", "Stability"):
        add(f"| {k} | {s['checks'].get(k, 'not run')} |")
    add("\nThe faces, the torso fronts" + (" and the photo area" if kit.get("extra") else "")
        + " sit on side studs, which the grid checks can't see, so "
        "`portrait.check_snot()` also tests every side-stud part for collisions with the rest "
        "of the model (none). **No physical prototype has been built.** Before selling, build "
        "one kit from the uploaded parts and the printed booklet. Check that the head sits "
        "firmly on its 2 × 2 neck and inner post, that the hair cap presses down evenly over "
        "the head, that the arms stay put under the shoulder plates, and that the figures "
        "stand steadily on the base.\n")

    add("## Building notes\n")
    add("- **Sections:**")
    L.extend(f"  {i}. {plain(x)}" for i, x in enumerate(P["organisation"], 1))
    L.extend(f"- {plain(t)}" for t in kit["notes"])
    add(f"\n![Front left view](images/{stem}_front_left.jpg)\n")
    add(f"![Aerial view](images/{stem}_aerial.jpg)\n")
    add(f"![Back view](images/{stem}_back.jpg)\n")
    add("Sample booklet pages: [a section page](images/sample_section_page.jpg) and "
        "[a step page](images/sample_step_page.jpg).\n")

    add("## How it was made\n")
    add("The figures are generated by [`../lego-kit/portrait.py`](../lego-kit/portrait.py) "
        "from the options in [`design.py`](design.py), with the shared toolkit in "
        "[`../lego-kit`](../lego-kit). The toolkit builds on the stud grid with the real part "
        "shapes from the LDraw library and checks that no two elements overlap and that every "
        "element is held by at least one stud. `./build.sh` renders the steps with LeoCAD, "
        "maps every part to LEGO element IDs, writes the parts lists and upload files, runs "
        "the checks, prints the booklet and writes this README.\n")
    add("```bash\nDATA_DIR=/path/to/element-data ./build.sh   # see ../lego-kit/README.md\n```\n")

    add("## Disclaimer\n")
    add("An unofficial fan design (MOC). It is not affiliated with, sponsored or endorsed by "
        "The LEGO Group. LEGO® is a trademark of The LEGO Group. The brick portrait style here "
        "is this shop's own design and uses no other shop's names or branding. A custom "
        "figure is a likeness of a real person and is made only with that person's "
        "permission. A printed face sticker or photo print is a separate, non-LEGO item made "
        "by the seller.")
    with open(os.path.join(proj.root, "README.md"), "w") as fh:
        fh.write("\n".join(L) + "\n")
    print(f"README: {s['pieces']} pieces, {money(s['cost'])}, figures "
          + ", ".join(money(c) for c in fig_cost) + f", {s['pages']} pages, {s['steps']} steps")


def extra_images(proj, views=(("cover_front_left", "front_left"), ("back", "back"))):
    """front_left and back README images (readme_images.py writes the other three)."""
    import os
    from PIL import Image
    out = os.path.join(proj.root, "images")
    os.makedirs(out, exist_ok=True)
    for src, dst in views:
        im = Image.open(os.path.join(proj.renders, "final", src + ".png")).convert("RGBA")
        bg = Image.new("RGB", im.size, (255, 255, 255))
        bg.paste(im, mask=im.split()[3])
        bg.thumbnail((1400, 1000))
        bg.save(os.path.join(out, f"{proj.meta['model_name']}_{dst}.jpg"), quality=85,
                optimize=True)
