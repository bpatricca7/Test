"""Brick courses around a building outline.

The outline is a closed, right-angled polygon given by its corner cells. Each
course is laid segment by segment. Corner cells alternate between the two
walls that meet there from course to course, and joints are staggered from the
course below, so the walls interlock like a real brick bond.

A material function decides what goes in each cell of a course:
    material(x, z, layer) -> None            leave the cell empty (window, door...)
                           | ("b", colour)    plain bricks, merged into long runs
                           | ("stone",)       masonry-profile 1x2 bricks, mixed colours
"""
from bricks import row, LBG, DBG, TAN, DTAN

STONE_MIX = (LBG, LBG, DBG, LBG, TAN, LBG, DBG, LBG, DBG, DTAN, LBG, DBG)


def stone_colour(x, z, layer, mix=STONE_MIX):
    h = (x * 73856093) ^ (z * 19349663) ^ (layer * 83492791)
    return mix[h % len(mix)]


class WallRing:
    def __init__(self, corners):
        self.corners = list(corners)
        self.segments = []
        n = len(corners)
        for i in range(n):
            (ax, az), (bx, bz) = corners[i], corners[(i + 1) % n]
            if az == bz:
                step = 1 if bx > ax else -1
                cells = [(x, az) for x in range(ax, bx + step, step)]
                axis = "x"
            elif ax == bx:
                step = 1 if bz > az else -1
                cells = [(ax, z) for z in range(az, bz + step, step)]
                axis = "z"
            else:
                raise ValueError("outline must be right-angled")
            self.segments.append(dict(axis=axis, cells=cells))
        self.corner_set = set(corners)
        self.seams = {}

    def cells(self):
        out = []
        for s in self.segments:
            for c in s["cells"]:
                if c not in out:
                    out.append(c)
        return out

    def course(self, m, layer, parity, material):
        """Lay one brick course (3 plates) at `layer`."""
        for si, seg in enumerate(self.segments):
            owns = (seg["axis"] == "x") == (parity % 2 == 0)
            cells = [c for c in seg["cells"] if c not in self.corner_set or owns]
            cells.sort()
            runs = []
            for c in cells:
                mat = material(c[0], c[1], layer)
                if mat is None:
                    continue
                if runs and runs[-1][0] == mat and _adjacent(runs[-1][1][-1], c):
                    runs[-1][1].append(c)
                else:
                    runs.append((mat, [c]))
            used = set()
            for mat, rc in runs:
                x0, z0 = rc[0]
                n = len(rc)
                rel0 = (x0 if seg["axis"] == "x" else z0)
                if mat[0] == "b":
                    prev = {s - rel0 for s in self.seams.get(si, ())}
                    new = row(m, "b", mat[1], x0, z0, n, layer, axis=seg["axis"],
                              avoid={s for s in prev if 0 < s < n})
                    used |= {s + rel0 for s in new}
                elif mat[0] == "stone":
                    _stone_run(m, rc, layer, parity, seg["axis"])
            self.seams[si] = used


def _adjacent(a, b):
    return abs(a[0] - b[0]) + abs(a[1] - b[1]) == 1


def _stone_run(m, cells, layer, parity, axis):
    """Masonry 1x2 bricks with a staggered bond; single cells get a 1x1 brick."""
    i = 0
    n = len(cells)
    start = cells[0][0] if axis == "x" else cells[0][1]
    # keep a running bond: pieces start on even or odd positions by course
    if (start + parity) % 2 == 1 and n > 1:
        x, z = cells[0]
        m.add("b1x1", stone_colour(x, z, layer), x, z, layer)
        i = 1
    while i < n:
        x, z = cells[i]
        if i + 1 < n:
            m.add("masonry", stone_colour(x, z, layer), x, z, layer,
                  rot=0 if axis == "x" else 90)
            i += 2
        else:
            m.add("b1x1", stone_colour(x, z, layer), x, z, layer)
            i += 1
