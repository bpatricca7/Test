"""Gable and hipped roofs built from LEGO slopes, including crossing gables.

Each roof block is a rectangle of cells with a ridge running along x or z and
a pitch of 33 degrees (3-stud slopes) or 45 degrees (2-stud slopes). Several
blocks can overlap: the visible surface of each cell is the highest block
there, which gives valleys where gables cross, as on a real house.

Per block and course, a slope row runs along each eave. The top is closed
with tiles over the ridge. Gable ends get stepped wall bricks under the end
slopes, and the end slopes can take a trim colour (white rake boards). An end
can be hipped instead: the side rows then step in by one course at a time and
a row of slopes facing the end fills the gap, so no corner pieces are needed.
Pieces left without a stud underneath get hidden filler bricks, in a step of
their own just before the slopes they hold up.

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
                 wall_ends=("start", "end"), hips=()):
        """A roof over cells x0..x1-1, z0..z1-1 starting at plate `base`.

        axis: 'x' = ridge along x (slopes face front/back),
              'z' = ridge along z (slopes face left/right).
        trim_ends: gable ends whose end slopes take the `trim` colour:
              'start'/'end' = the low/high end of the ridge axis.
        wall: colour of the gable-end wall bricks, or a function
              wall(model, cells, layer) that builds them.
        hips: ends that are hipped (sloped) instead of gabled.
        """
        self.x0, self.x1, self.z0, self.z1 = x0, x1, z0, z1
        self.base, self.axis, self.pitch = base, axis, pitch
        self.color, self.trim, self.trim_ends = color, trim, set(trim_ends)
        self.wall, self.cap = wall, cap if cap is not None else color
        self.priority, self.widths, self.name = priority, widths, name
        self.hips = set(hips)
        self.wall_ends = set(wall_ends) - self.hips
        g = SLOPES[pitch]
        self.s, self.P = g["s"], g["P"]
        across = (z1 - z0) if axis == "x" else (x1 - x0)
        self.h = across // 2                         # cells on each side of the ridge
        self.K = (self.h - self.P) // self.s         # last course with slopes

    def cells(self):
        return [(x, z) for x in range(self.x0, self.x1) for z in range(self.z0, self.z1)]

    def _ranges(self):
        """(along lo, along hi, across lo, across hi), inclusive."""
        if self.axis == "x":
            return self.x0, self.x1 - 1, self.z0, self.z1 - 1
        return self.z0, self.z1 - 1, self.x0, self.x1 - 1

    def coord(self, c):
        """(u along the ridge, d from the nearest side eave, side -1/+1)."""
        x, z = c
        if self.axis == "x":
            u, lo, hi, a = x, self.z0, self.z1, z
        else:
            u, lo, hi, a = z, self.x0, self.x1, x
        d_lo, d_hi = a - lo, hi - 1 - a
        return (u, d_lo, -1) if d_lo <= d_hi else (u, d_hi, +1)

    def height(self, c):
        """Surface course count T at a cell (K + 2 marks the capped ridge)."""
        u, d, _ = self.coord(c)
        lo, hi, _, _ = self._ranges()
        if "start" in self.hips:
            d = min(d, u - lo)
        if "end" in self.hips:
            d = min(d, hi - u)
        k = d // self.s
        return k + 1 if k <= self.K else self.K + 2

    def is_end(self, u):
        lo, hi, _, _ = self._ranges()
        return u in (lo, hi)

    def end_name(self, u):
        lo = self.x0 if self.axis == "x" else self.z0
        return "start" if u == lo else "end"

    def cell_at(self, u, d, side):
        _, _, across_lo, across_hi = self._ranges()
        a = across_lo + d if side < 0 else across_hi - d
        return (u, a) if self.axis == "x" else (a, u)

    # -- faces: -1 / +1 are the long sides, "start" / "end" the hipped ends --
    def faces(self):
        return [-1, +1] + [e for e in ("start", "end") if e in self.hips]

    def fcell(self, face, t, d):
        """Cell at position t along a face's eave, d cells in from the eave."""
        if face in (-1, +1):
            return self.cell_at(t, d, face)
        lo, hi, _, _ = self._ranges()
        u = lo + d if face == "start" else hi - d
        return (u, t) if self.axis == "x" else (t, u)

    def t_range(self, face, k):
        lo, hi, alo, ahi = self._ranges()
        if face in (-1, +1):
            return range(lo + (self.s * k if "start" in self.hips else 0),
                         hi - (self.s * k if "end" in self.hips else 0) + 1)
        return range(alo + self.s * k + self.P, ahi - self.s * k - self.P + 1)

    def facing(self, face):
        if face in (-1, +1):
            if self.axis == "x":
                return FACE["front"] if face < 0 else FACE["back"]
            return FACE["left"] if face < 0 else FACE["right"]
        if self.axis == "x":
            return FACE["left"] if face == "start" else FACE["right"]
        return FACE["front"] if face == "start" else FACE["back"]

    def layer(self, k):
        return self.base + 3 * k


def build_roofs(m, blocks, fill_color=None, keep_open=(), support_caps=False):
    """Place all roof blocks into model `m` (one build step per course).

    Blocks may start at different layers (a dormer set up on a roof slope);
    each cell belongs to the block whose surface is highest there.
    keep_open: ridge cells left without cap tiles (for a chimney or a turret
    standing on the ridge studs).
    support_caps: add hidden filler bricks under ridge tiles with no stud below.
    """
    blocks = sorted(blocks, key=lambda b: b.priority)
    # --- composite surface: owner of each cell is the highest block there ---
    owner, top, level = {}, {}, {}
    for b in blocks:
        for c in b.cells():
            t = b.height(c)
            h = b.base + 3 * t
            if c not in level or h > level[c]:
                level[c], top[c], owner[c] = h, t, b
    occ = set()            # (x, z, layer) cells already used by roof parts
    studs = set()          # (x, z, layer) positions offering a stud at that layer
    placed = []            # (block, k, cells)
    max_k = max(b.K for b in blocks)

    for k in range(max_k + 1):
        fills, slopes = [], []    # hidden supports go in a step of their own, first
        for b in blocks:
            if k > b.K:
                continue
            runs = defaultdict(list)      # (face, colour, single) -> list of t
            d = b.s * k
            # one anchor per face and position; visited in cell order
            anchors = sorted(((b.fcell(face, t, d), face, t)
                              for face in b.faces() for t in b.t_range(face, k)),
                             key=lambda a: a[0])
            for _, face, t in anchors:
                band = [b.fcell(face, t, d + i) for i in range(b.s)]
                if not any(owner.get(x) is b and top[x] == k + 1 for x in band):
                    continue
                cover = [b.fcell(face, t, d + i) for i in range(b.P)]
                layers = range(b.layer(k), b.layer(k) + 3)
                if any((x, z, L) in occ for (x, z) in cover for L in layers):
                    continue
                gable_end = face in (-1, +1) and b.is_end(t) and b.end_name(t) not in b.hips
                colour = b.trim if (b.trim is not None and gable_end
                                    and b.end_name(t) in b.trim_ends) else b.color
                runs[(face, colour, gable_end and colour != b.color)].append(t)
                for (x, z) in cover:
                    for L in layers:
                        occ.add((x, z, L))
            for (face, colour, single), ts in runs.items():
                for start, width in _merge(sorted(ts), b.widths if not single else (1,)):
                    covers = [[b.fcell(face, start + dt, b.s * k + i) for i in range(b.P)]
                              for dt in range(width)]
                    # filler bricks under any column of the piece with no stud to sit on
                    for cover in covers:
                        _support(fills, b, k, cover, occ, studs, fill_color)
                    slopes.append((b, k, face, start, width, colour))
                    for cover in covers:
                        placed.append((b, k, cover))
                        x, z = cover[-1]            # the uphill cell carries the stud
                        studs.add((x, z, b.layer(k) + 3))
        if fills:
            _add_fills(m, fills)
            m.step()
        for args in slopes:
            _place_slope(m, *args)
        # gable-end walls under this course
        for b in blocks:
            if k > b.K + 1:
                continue
            _gable_walls(m, b, k, owner, top, occ, studs)
        m.step()

    # --- ridge caps ---
    caps = defaultdict(set)
    keep_open = set(keep_open)
    fills = []
    for c, b in owner.items():
        if top[c] == b.K + 2 and c not in keep_open:
            caps[(b.layer(b.K + 1), b.cap)].add(c)
            if support_caps and (c[0], c[1], b.layer(b.K + 1)) not in studs:
                _fill_down(fills, b, c[0], c[1], b.K + 1, occ, studs, fill_color)
    if fills:
        _add_fills(m, fills)
        m.step()
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


def _place_slope(m, b, k, face, t, width, colour):
    key = SLOPES[b.pitch]["keys"][width]
    d0 = b.s * k
    near = b.fcell(face, t, d0)
    far = b.fcell(face, t + width - 1, d0 + b.P - 1)
    x = min(near[0], far[0])
    z = min(near[1], far[1])
    m.add(key, colour, x, z, b.layer(k), rot=b.facing(face))


def _gable_walls(m, b, k, owner, top, occ, studs):
    """Wall bricks in the gable-end columns that stay below the roof surface."""
    lo, hi, _, _ = b._ranges()
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


def _support(fills, b, k, cover, occ, studs, fill_color):
    """Hidden filler bricks under one column of a slope that has no stud below."""
    if k == 0:
        return                              # course 0 sits on the eave deck
    L = b.layer(k)
    if any((x, z, L) in studs for (x, z) in cover):
        return
    # stack 1x1 bricks under the piece's lowest cell down to the deck
    x, z = cover[0]
    _fill_down(fills, b, x, z, k, occ, studs, fill_color)


def _fill_down(fills, b, x, z, k, occ, studs, fill_color):
    """1x1 bricks in cell (x, z) from course k-1 down to the first used course."""
    for kk in range(k - 1, -1, -1):
        layer = b.layer(kk)
        if any((x, z, Lq) in occ for Lq in range(layer, layer + 3)):
            break
        fills.append((fill_color if fill_color is not None else b.color, x, z, layer))
        for Lq in range(layer, layer + 3):
            occ.add((x, z, Lq))
        studs.add((x, z, layer + 3))


def _add_fills(m, fills):
    """Place the collected filler bricks, lowest first."""
    for colour, x, z, layer in sorted(fills, key=lambda f: f[3]):
        m.add("b1x1", colour, x, z, layer)
