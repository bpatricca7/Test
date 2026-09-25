"""Minimal LDraw geometry reader: bounding boxes and stud positions of parts.

Used to calibrate the part catalogue in build_model.py against the official
LDraw library so every placed element sits exactly on the stud grid.
"""
import os
from functools import lru_cache

LDRAW = os.environ.get("LDRAW_DIR", "/usr/share/ldraw")
SEARCH = ["parts", "p", "parts/s", "p/48", "p/8", "models", ""]

TOP_STUD_PRIMS = {
    "stud.dat", "stud2.dat", "stud2a.dat", "stud6.dat", "stud6a.dat",
    "stud10.dat", "stud13.dat", "stud15.dat", "stud17a.dat", "stud2s.dat",
    "studline.dat", "stud9.dat", "stud20.dat", "stud21a.dat", "stud22a.dat",
}


def _find(name):
    name = name.replace("\\", "/").lower()
    for d in SEARCH:
        p = os.path.join(LDRAW, d, name)
        if os.path.exists(p):
            return p
    return None


def _mul(a, b):
    """Compose 3x4 affine transforms stored as (M(3x3 rows), t(3))."""
    (ma, ta), (mb, tb) = a, b
    m = [[sum(ma[i][k] * mb[k][j] for k in range(3)) for j in range(3)] for i in range(3)]
    t = [sum(ma[i][k] * tb[k] for k in range(3)) + ta[i] for i in range(3)]
    return (m, t)


def _apply(tf, p):
    m, t = tf
    return tuple(sum(m[i][k] * p[k] for k in range(3)) + t[i] for i in range(3))


IDENT = ([[1, 0, 0], [0, 1, 0], [0, 0, 1]], [0, 0, 0])


@lru_cache(maxsize=None)
def _parse(name):
    path = _find(name)
    if path is None:
        raise FileNotFoundError(name)
    points, subs = [], []
    with open(path, encoding="utf-8", errors="replace") as fh:
        for line in fh:
            tok = line.split()
            if not tok:
                continue
            if tok[0] == "1" and len(tok) >= 15:
                v = list(map(float, tok[2:14]))
                tf = ([[v[3], v[4], v[5]], [v[6], v[7], v[8]], [v[9], v[10], v[11]]], [v[0], v[1], v[2]])
                subs.append((tf, " ".join(tok[14:]).lower()))
            elif tok[0] in ("2", "3", "4", "5"):
                nums = list(map(float, tok[2:]))
                cnt = {"2": 2, "3": 3, "4": 4, "5": 2}[tok[0]]
                for i in range(cnt):
                    points.append(tuple(nums[3 * i:3 * i + 3]))
    return points, subs


@lru_cache(maxsize=None)
def _flat(name):
    """All geometry points and upward stud origins of a file, flattened."""
    points, subs = _parse(name)
    pts = set(points)
    studs = set()
    for tf, sub in subs:
        base = os.path.basename(sub.replace("\\", "/"))
        up = _apply((tf[0], [0, 0, 0]), (0, -1, 0))
        if base in TOP_STUD_PRIMS and up[1] < -0.99:
            studs.add(tuple(round(c, 2) for c in _apply(tf, (0, 0, 0))))
        try:
            spts, sstuds = _flat(sub)
        except FileNotFoundError:
            continue
        for p in spts:
            pts.add(tuple(round(c, 3) for c in _apply(tf, p)))
        if up[1] < -0.99:
            for s in sstuds:
                studs.add(tuple(round(c, 2) for c in _apply(tf, s)))
    return frozenset(pts), frozenset(studs)


@lru_cache(maxsize=None)
def geometry(name):
    """Return (bbox_min, bbox_max, top_studs) in the file's own coordinates."""
    pts, studs = _flat(name)
    bmin = tuple(min(p[i] for p in pts) for i in range(3))
    bmax = tuple(max(p[i] for p in pts) for i in range(3))
    return bmin, bmax, tuple(sorted(studs))


if __name__ == "__main__":
    import sys
    for n in sys.argv[1:]:
        bmin, bmax, studs = geometry(n if n.endswith(".dat") else n + ".dat")
        print(n, "min", tuple(round(v, 1) for v in bmin), "max", tuple(round(v, 1) for v in bmax))
        print("   studs:", studs[:12], "..." if len(studs) > 12 else "")
