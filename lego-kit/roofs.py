"""Gable roofs built from LEGO slopes, including crossing gables.

Each roof block is a rectangle of cells with a ridge running along x or z and
a pitch of 33 degrees (3-stud slopes) or 45 degrees (2-stud slopes). Several
blocks can overlap: the visible surface of each cell is the highest block
there, which gives valleys where gables cross, as on a real house.

Per block and course, a slope row runs along each eave. The top is closed
with tiles over the ridge. Gable ends get stepped wall bricks under the end
slopes, and the end slopes can take a trim colour (white rake boards). Pieces
left without a stud underneath get hidden filler bricks.

Usage:
    blocks = [Roof(...), Roof(...)]
    build_roofs(model, blocks)      # adds steps: one per course, then caps
"""
from collections import defaultdict

from bricks import PARTS, FACE, row, fill_cells

SLOPES = {33: {"s": 2, "P": 3, "keys": {1: "s33x1", 2: "s33x2", 4: "s33x4"}},
          45: {"s": 1, "P": 2, "keys": {1: "slope45", 2: "s45x2", 4: "s45x4"}}}


class Roof:
    def __init__(self, x0, x1, z0, z1, base, axis, pitch=33, color=0, trim=None,
                 trim_ends=(), wall=0, cap=None, priority=0, widths=(2, 1), name="",
                 wall_ends=("start", "end")):
        """A gable roof over cells x0..x1-1, z0..z1-1 starting at plate `base`.

        axis: 'x' = ridge along x (slopes face front/back),
              'z' = ridge along z (slopes face left/right).
        trim_ends: gable ends whose end slopes take the `trim` colour:
              'start'/'end' = the low/high end of the ridge axis.
        wall: colour of the gable-end wall bricks, or a function
              wall(model, cells, layer) that builds them.
        """
        self.x0, self.x1, self.z0, self.z1 = x0, x1, z0, z1
        self.base, self.axis, self.pitch = base, axis, pitch
        self.color, self.trim, self.trim_ends = color, trim, set(trim_ends)
        self.wall, self.cap = wall, cap if cap is not None else color
        self.priority, self.widths, self.name = priority, widths, name
        self.wall_ends = set(wall_ends)
        g = SLOPES[pitch]
        self.s, self.P = g["s"], g["P"]
        across = (z1 - z0) if axis == "x" else (x1 - x0)
        self.h = across // 2                         # cells on each side of the ridge
        self.K = (self.h - self.P) // self.s         # last course with slopes

    def cells(self):
        return [(x, z) for x in range(self.x0, self.x1) for z in range(self.z0, self.z1)]

    def coord(self, c):
        """(u along the ridge, d from the nearest eave, side -1/+1)."""
        x, z = c
        if self.axis == "x":
            u, lo, hi, a = x, self.z0, self.z1, z
        else:
            u, lo, hi, a = z, self.x0, self.x1, x
        d_lo, d_hi = a - lo, hi - 1 - a
        return (u, d_lo, -1) if d_lo <= d_hi else (u, d_hi, +1)

    def height(self, c):
        """Surface course count T at a cell (K + 2 marks the capped ridge)."""
        _, d, _ = self.coord(c)
        k = d // self.s
        return k + 1 if k <= self.K else self.K + 2

    def is_end(self, u):
        lo, hi = (self.x0, self.x1 - 1) if self.axis == "x" else (self.z0, self.z1 - 1)
        return u in (lo, hi)

    def end_name(self, u):
        lo = self.x0 if self.axis == "x" else self.z0
        return "start" if u == lo else "end"

    def cell_at(self, u, d, side):
        across_lo = self.z0 if self.axis == "x" else self.x0
        across_hi = (self.z1 if self.axis == "x" else self.x1) - 1
        a = across_lo + d if side < 0 else across_hi - d
        return (u, a) if self.axis == "x" else (a, u)

    def facing(self, side):
        if self.axis == "x":
            return FACE["front"] if side < 0 else FACE["back"]
        return FACE["left"] if side < 0 else FACE["right"]

    def layer(self, k):
        return self.base + 3 * k


def build_roofs(m, blocks, fill_color=None):
    """Place all roof blocks into model `m` (one build step per course)."""
    blocks = sorted(blocks, key=lambda b: b.priority)
    # --- composite surface: owner of each cell is the highest block there ---
    owner, top = {}, {}
    for b in blocks:
        for c in b.cells():
            t = b.height(c)
            if c not in top or t > top[c]:
                top[c], owner[c] = t, b
    occ = set()            # (x, z, layer) cells already used by roof parts
    studs = set()          # (x, z, layer) positions offering a stud at that layer
    placed = []            # (block, k, cells)
    max_k = max(b.K for b in blocks)

    for k in range(max_k + 1):
        for b in blocks:
            if k > b.K:
                continue
            runs = defaultdict(list)      # (side, colour) -> list of u
            for c in b.cells():
                u, d, side = b.coord(c)
                if d != b.s * k:
                    continue              # one anchor per column and side
                band = [b.cell_at(u, d + i, side) for i in range(b.s)]
                if not any(owner.get(x) is b and top[x] == k + 1 for x in band):
                    continue
                cover = [b.cell_at(u, d + i, side) for i in range(b.P)]
                layers = range(b.layer(k), b.layer(k) + 3)
                if any((x, z, L) in occ for (x, z) in cover for L in layers):
                    continue
                colour = b.trim if (b.trim is not None and b.is_end(u)
                                    and b.end_name(u) in b.trim_ends) else b.color
                runs[(side, colour, b.is_end(u) and colour != b.color)].append(u)
                for (x, z) in cover:
                    for L in layers:
                        occ.add((x, z, L))
            for (side, colour, single), us in runs.items():
                for start, width in _merge(sorted(us), b.widths if not single else (1,)):
                    _place_slope(m, b, k, side, start, width, colour)
                    for du in range(width):
                        cover = [b.cell_at(start + du, b.s * k + i, side) for i in range(b.P)]
                        placed.append((b, k, cover))
                        x, z = cover[-1]            # the uphill cell carries the stud
                        studs.add((x, z, b.layer(k) + 3))
        # gable-end walls under this course
        for b in blocks:
            if k > b.K + 1:
                continue
            _gable_walls(m, b, k, owner, top, occ, studs)
        m.step()

    # --- supports for pieces that ended up without a stud below ---
    _supports(m, blocks, placed, occ, studs, fill_color)

    # --- ridge caps ---
    caps = defaultdict(set)
    for c, b in owner.items():
        if top[c] == b.K + 2:
            caps[(b.layer(b.K + 1), b.cap)].add(c)
    for (layer, colour), cells in sorted(caps.items()):
        fill_cells(m, "t", colour, cells, layer)
    m.step()
    return owner, top


def _merge(us, widths):
    """Split sorted column indices into contiguous pieces of allowed widths."""
    out, i = [], 0
    while i < len(us):
        j = i
        while j + 1 < len(us) and us[j + 1] == us[j] + 1:
            j += 1
        start, n = us[i], j - i + 1
        pos = 0
        while pos < n:
            for w in widths:
                if w <= n - pos:
                    out.append((start + pos, w))
                    pos += w
                    break
        i = j + 1
    return out


def _place_slope(m, b, k, side, u, width, colour):
    key = SLOPES[b.pitch]["keys"][width]
    d0 = b.s * k
    near = b.cell_at(u, d0, side)
    far = b.cell_at(u + width - 1, d0 + b.P - 1, side)
    x = min(near[0], far[0])
    z = min(near[1], far[1])
    m.add(key, colour, x, z, b.layer(k), rot=b.facing(side))


def _gable_walls(m, b, k, owner, top, occ, studs):
    """Wall bricks in the gable-end columns that stay below the roof surface."""
    lo, hi = (b.x0, b.x1 - 1) if b.axis == "x" else (b.z0, b.z1 - 1)
    for u in (lo, hi):
        if b.end_name(u) not in b.wall_ends:
            continue
        cells = []
        for c in b.cells():
            cu, d, side = b.coord(c)
            if cu != u or owner.get(c) is not b:
                continue
            if top[c] <= k + 1:
                continue                   # the slope surface is at or below this course
            if any((c[0], c[1], L) in occ for L in range(b.layer(k), b.layer(k) + 3)):
                continue
            cells.append(c)
        if not cells:
            continue
        for c in cells:
            for L in range(b.layer(k), b.layer(k) + 3):
                occ.add((c[0], c[1], L))
            studs.add((c[0], c[1], b.layer(k) + 3))
        if callable(b.wall):
            b.wall(m, cells, b.layer(k))
        else:
            for run in _runs(cells, b.axis):
                (x, z), n = run
                row(m, "b", b.wall, x, z, n, b.layer(k), axis="z" if b.axis == "x" else "x")


def _runs(cells, axis):
    """Contiguous runs of cells along the gable-end column."""
    key = (lambda c: c[1]) if axis == "x" else (lambda c: c[0])
    cells = sorted(cells, key=key)
    out, i = [], 0
    while i < len(cells):
        j = i
        while j + 1 < len(cells) and key(cells[j + 1]) == key(cells[j]) + 1:
            j += 1
        out.append((cells[i], j - i + 1))
        i = j + 1
    return out


def _supports(m, blocks, placed, occ, studs, fill_color):
    """Add hidden filler bricks under slope pieces that have no stud below."""
    for b, k, cover in placed:
        if k == 0:
            continue                        # course 0 sits on the eave deck
        L = b.layer(k)
        if any((x, z, L) in studs for (x, z) in cover):
            continue
        # stack 1x1 bricks under the piece's lowest cell down to the deck
        x, z = cover[0]
        for kk in range(k - 1, -1, -1):
            layer = b.layer(kk)
            if any((x, z, Lq) in occ for Lq in range(layer, layer + 3)):
                break
            m.add("b1x1", fill_color if fill_color is not None else b.color, x, z, layer)
            for Lq in range(layer, layer + 3):
                occ.add((x, z, Lq))
            studs.add((x, z, layer + 3))
