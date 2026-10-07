"""Wilderness Lodge, compact display kit (resort collection).

Build with the shared kit:  ./build.sh

The compact format (lego-kit/compact.py): a 24 x 16 base with a black front
band; one storey = 4 plates (a course of bricks and a plate band), 1 stud is about 2 m.

Grid (studs): x to the right, z toward the back; the front band is z = 0..1.
  great lodge    x  7..16, z 8..15   a stone storey and four storeys of logs under a
                                     steep green front gable with the lobby window
  porte-cochere  x  9..14, z 4..7    log posts and a green gable over the entrance
  wings          x  2..6 and 17..21, z 9..14   a stone storey and two of logs, green
                                     side-gable roof with a small front gable (build 2)
  chimney        x 22..23, z 10..11  stone, from the ground to above the wing roofs
  totem poles    (7, 5) and (16, 5)
  walk           x 10..13, z 2..3 to the porte-cochere
"""
import sys

import bricks
from bricks import (Model, P, row, fill_cells, fill_rect, split_length, BLACK, LBG, DBG,
                    GREEN, RBROWN, TAN, RED, WHITE)
from roofs import Roof, build_roofs
from walls import WallRing
from compact import compact_project, display_base, finish_ground

TURQ = 3                                   # Dark Turquoise
LOG, ROOF, WINDOW, PLINTH = RBROWN, GREEN, BLACK, LBG
STONES = (LBG, DBG, LBG, DBG, DBG, LBG, LBG, DBG)


def register(key, dat, name):
    """bricks.P(), plus the part-name tables that the kit scripts (render.py,
    export_parts.py, make_booklet.py) copied from PARTS when they were imported,
    before this design was loaded."""
    P(key, dat, name)
    for mod in list(sys.modules.values()):
        for attr in ("NAMES", "DAT_NAMES"):
            table = getattr(mod, attr, None)
            if isinstance(table, dict) and "3001.dat" in table:
                table.setdefault(dat, name)


register("log1x2", "30136.dat", "Brick 1 x 2 Log")
# Bestseller sizes for the colours used here as bricks and tiles (checked with avail.py)
bricks.ALLOWED[("b", RBROWN)] = bricks._sizes("1x1 1x2 1x3 1x4 1x6")
bricks.ALLOWED[("t", GREEN)] = bricks._sizes("1x1 1x2 1x4 2x2")

PROJECT = compact_project(
    slug="wilderness_lodge",
    title="Wilderness Lodge",
    resort="Disney's Wilderness Lodge",
    category="Deluxe",
    merged=["Boulder Ridge Villas at Disney's Wilderness Lodge",
            "Copper Creek Villas & Cabins at Disney's Wilderness Lodge"],
    about=("The great lodge of the Wilderness Lodge, in the Pacific Northwest style: a grey "
           "stone base under storeys of reddish-brown logs, a steep green front gable with the "
           "tall lobby window, a log porte-cochere at the entrance, two lower wings with their "
           "own green gables, the tall stone chimney and the two totem poles that guard the "
           "way in."),
    features=["Log-and-stone lodge: a grey stone base under storeys of reddish-brown logs",
              "Steep green gable roofs: the tall front gable with the lobby window, and lower "
              "wings with gables of their own",
              "The log porte-cochere over the entrance",
              "A tall stone chimney",
              "Two totem poles of stacked coloured bricks flanking the entrance"],
    omitted=["The long guest wings, Boulder Ridge and Copper Creek buildings",
             "The lobby interior, Silver Creek and the geyser",
             "The pine forest and the lakeshore"],
    colour_rows=[("Reddish Brown", "Reddish Brown", "Reddish Brown"),
                 ("Green", "Dark Green", "Green"),
                 ("Light Bluish Gray", "Medium Stone Grey", "Light Bluish Gray"),
                 ("Dark Bluish Gray", "Dark Stone Grey", "Dark Bluish Gray"),
                 ("Black", "Black", "Black"), ("Tan", "Brick Yellow", "Tan"),
                 ("Red", "Bright Red", "Red"), ("White", "White", "White"),
                 ("Dark Turquoise", "Bright Bluish Green", "Dark Turquoise")],
    organisation=["The display base and the lawn", "The great lodge", "The wings (build 2)",
                  "The chimney", "The totem poles (build 2)"],
    sub_info={
        "lodge.ldr": ("The great lodge",
                      "A stone storey, four storeys of logs with the window rows, the log "
                      "porte-cochere and the steep green front gable with the lobby window."),
        "wing.ldr": ("The wings",
                     "Two identical wings: a stone storey, two storeys of logs and a green "
                     "side-gable roof with a small front gable."),
        "chimney.ldr": ("The chimney",
                        "A column of masonry bricks in two greys, turned a quarter at every "
                        "course."),
        "totem.ldr": ("The totem poles",
                      "Two identical poles of stacked coloured bricks with spread wings."),
    },
    legend=("totem.ldr", 1),
    tips=["The walls are log bricks: 1&times;4 and 1&times;2 logs, with a plain 1&times;1 "
          "brick where a run needs one more stud. The ground storey is stone: masonry bricks "
          "in two greys, mixed freely.",
          "The log posts of the porte-cochere go in early; the deck over them is part of the "
          "third-storey floor band.",
          "Roofs go up one row of slopes at a time. A few reddish-brown bricks hidden under "
          "the gables have a step of their own, just before the slopes that rest on them.",
          "A <b>&ldquo;Build 2&rdquo;</b> badge means you build that module twice."],
    build_time="about 1&frac12; to 2 hours",
)

# great lodge, in its own grid: walls x 0..9, z 4..11; porte-cochere x 2..7, z 0..3
LW, LD, LFLOORS = 10, 8, 5
WZ = 4                                   # front wall row
PORCH = (2, 8, 0, 4)                     # x0, x1, z0, z1
POSTS = ((2, 0), (7, 0))
PORCH_FLOOR = 3                          # the porte-cochere deck is this storey's band
LX, LZ = 7, 4                            # lodge origin on the base
WING_W, WING_D, WING_FLOORS = 5, 6, 3
WINGS = ((2, 9), (17, 9))
CHIM = (22, 10)
CHIM_COURSES = 10
TOTEMS = ((7, 5), (16, 5))
WALK = range(10, 14)


def stone(x, z, layer):
    return STONES[((x * 7) ^ (z * 13) ^ (layer * 5)) % len(STONES)]


def log_run(m, colour, x0, z0, n, layer, axis="x", avoid=()):
    """A run of log bricks (1x4, 1x2; a plain 1x1 brick for an odd stud)."""
    pieces = split_length(n, [4, 2, 1], avoid)
    pos, used = 0, set()
    for s in pieces:
        key = {4: "log1x4", 2: "log1x2", 1: "b1x1"}[s]
        if axis == "x":
            m.add(key, colour, x0 + pos, z0, layer)
        else:
            m.add(key, colour, x0, z0 + pos, layer, rot=90)
        pos += s
        used.add(pos)
    used.discard(n)
    return used


def stone_run(m, cells, layer, parity, axis):
    """Masonry 1x2 bricks in two greys with a running bond; 1x1 bricks fill in."""
    i, n = 0, len(cells)
    start = cells[0][0] if axis == "x" else cells[0][1]
    if (start + parity) % 2 == 1 and n > 1:
        x, z = cells[0]
        m.add("b1x1", stone(x, z, layer), x, z, layer)
        i = 1
    while i < n:
        x, z = cells[i]
        if i + 1 < n:
            m.add("masonry", stone(x, z, layer), x, z, layer, rot=0 if axis == "x" else 90)
            i += 2
        else:
            m.add("b1x1", stone(x, z, layer), x, z, layer)
            i += 1


class LogRing(WallRing):
    """WallRing that lays log runs and stone runs as well as plain bricks.

    material(x, z, layer) -> None | ("log", colour) | ("b", colour) | ("stone",)
    """

    def course(self, m, layer, parity, material):
        for si, seg in enumerate(self.segments):
            owns = (seg["axis"] == "x") == (parity % 2 == 0)
            cells = sorted(c for c in seg["cells"] if c not in self.corner_set or owns)
            runs = []
            for c in cells:
                mat = material(c[0], c[1], layer)
                if mat is None:
                    continue
                last = runs[-1][1][-1] if runs else None
                if runs and runs[-1][0] == mat and abs(last[0] - c[0]) + abs(last[1] - c[1]) == 1:
                    runs[-1][1].append(c)
                else:
                    runs.append((mat, [c]))
            used = set()
            for mat, rc in runs:
                x0, z0 = rc[0]
                n = len(rc)
                rel0 = x0 if seg["axis"] == "x" else z0
                prev = {s - rel0 for s in self.seams.get(si, ())}
                avoid = {s for s in prev if 0 < s < n}
                if mat[0] == "log":
                    new = log_run(m, mat[1], x0, z0, n, layer, seg["axis"], avoid)
                elif mat[0] == "b":
                    new = row(m, "b", mat[1], x0, z0, n, layer, axis=seg["axis"], avoid=avoid)
                else:
                    stone_run(m, rc, layer, parity, seg["axis"])
                    new = set()
                used |= {s + rel0 for s in new}
            self.seams[si] = used


def log_gable(window=(), below=99):
    """Gable-end wall builder: log runs, with black window cells under layer `below`."""
    def wall(m, cells, layer):
        win = window if layer < below else ()
        cells = sorted(cells)
        axis = "x" if cells[0][1] == cells[-1][1] else "z"
        run, kind = [], None
        for c in cells + [None]:
            k = None if c is None else ("w" if (c[0] if axis == "x" else c[1]) in win else "l")
            if run and k != kind:
                x0, z0 = run[0]
                if kind == "w":
                    row(m, "b", WINDOW, x0, z0, len(run), layer, axis=axis)
                else:
                    log_run(m, LOG, x0, z0, len(run), layer, axis)
                run = []
            if c is not None:
                run.append(c)
                kind = k
    return wall


def storeys(m, x0, z0, w, d, floors, mat, skip_band=None, extra=None):
    """Storeys of a lodge block: one course of logs or stone and a plate band each.

    The top band is a full slab. Returns the roof base layer."""
    ring = LogRing([(x0, z0), (x0 + w - 1, z0), (x0 + w - 1, z0 + d - 1), (x0, z0 + d - 1)])
    cells = {(x, z) for x in range(x0, x0 + w) for z in range(z0, z0 + d)}
    ring_cells = {c for c in cells if c[0] in (x0, x0 + w - 1) or c[1] in (z0, z0 + d - 1)}
    for f in range(1, floors + 1):
        L = 1 + 4 * (f - 1)
        ring.course(m, L, f % 2, lambda x, z, layer, f=f: mat(x, z, f))
        m.step()
        band = (set(cells) if f == floors else set(ring_cells)) - set((skip_band or {}).get(f, ()))
        fill_cells(m, "p", LOG, band, L + 3)
        if extra:
            extra(m, f, L + 3)
        m.step()
    return 1 + 4 * floors


def build_lodge():
    m = Model("lodge.ldr", "The great lodge")
    walls = {(x, z) for x in range(LW) for z in range(WZ, WZ + LD)}
    porch = {(x, z) for x in range(PORCH[0], PORCH[1]) for z in range(PORCH[2], PORCH[3])}
    fill_cells(m, "p", PLINTH, walls | porch, 0)
    m.step()
    m.step("The two log posts of the porte-cochere stand on the plinth.")
    for px, pz in POSTS:
        for L in (1, 4, 7):
            m.add("round1", LOG, px, pz, L)
        m.add("round_p1", LOG, px, pz, 10)
        m.add("round_p1", LOG, px, pz, 11)
    m.step()
    front_win, side_win = {1, 2, 7, 8}, {WZ + 2, WZ + 5}
    deck = {(x, z) for x in range(PORCH[0], PORCH[1]) for z in range(PORCH[2], WZ + 2)}

    def mat(x, z, f):
        if f == 1:
            if z == WZ and x in (4, 5):
                return ("b", WINDOW)                     # the entrance doors
            return ("stone",)
        if z in (WZ, WZ + LD - 1) and x in front_win:
            return ("b", WINDOW)
        if x in (0, LW - 1) and z in side_win and f == LFLOORS:
            return ("b", WINDOW)                         # above the wing roofs
        if z == WZ and x in (4, 5):
            return ("b", WINDOW)
        return ("log", LOG)

    def porch_deck(m, f, layer):
        if f == PORCH_FLOOR:     # three plates from the posts into the front wall
            for x in range(PORCH[0], PORCH[1], 2):
                m.add("p2x6", LOG, x, PORCH[2], layer, rot=90)

    base = storeys(m, 0, WZ, LW, LD, LFLOORS, mat, skip_band={PORCH_FLOOR: deck}, extra=porch_deck)
    build_roofs(m, [Roof(PORCH[0], PORCH[1], PORCH[2], PORCH[3], 4 * PORCH_FLOOR + 1, "z", pitch=45,
                         color=ROOF, wall=log_gable(), wall_ends=("start",),
                         name="porte-cochere roof")],
                fill_color=LOG, support_caps=True)
    build_roofs(m, [Roof(0, LW, WZ, WZ + LD, base, "z", pitch=45, color=ROOF,
                         wall=log_gable({4, 5}, below=base + 9), name="front gable")],
                fill_color=LOG, support_caps=True)
    m.width, m.depth = LW, WZ + LD
    return m


def build_wing():
    m = Model("wing.ldr", "Wing (build 2)")
    fill_rect(m, "p", PLINTH, 0, 0, WING_W, WING_D, 0)
    m.step()

    def mat(x, z, f):
        if f == 1:
            return ("stone",)
        if z in (0, WING_D - 1) and x in (1, 3):
            return ("b", WINDOW)
        return ("log", LOG)
    base = storeys(m, 0, 0, WING_W, WING_D, WING_FLOORS, mat)
    build_roofs(m, [
        Roof(0, WING_W, 0, WING_D, base, "x", pitch=45, color=ROOF, wall=log_gable({2, 3}),
             priority=1, name="wing roof"),
        Roof(1, 5, 0, 3, base, "z", pitch=45, color=ROOF, wall=log_gable(),
             wall_ends=("start",), name="wing gable"),
    ], fill_color=LOG, support_caps=True)
    m.width, m.depth = WING_W, WING_D
    return m


def build_chimney():
    m = Model("chimney.ldr", "Stone chimney")
    for k in range(CHIM_COURSES):
        L = 3 * k
        if k % 2 == 0:
            m.add("masonry", stone(0, 0, L), 0, 0, L, rot=0)
            m.add("masonry", stone(0, 1, L), 0, 1, L, rot=180)
        else:
            m.add("masonry", stone(0, 0, L), 0, 0, L, rot=90)
            m.add("masonry", stone(1, 0, L), 1, 0, L, rot=270)
        if k % 3 == 2:
            m.step()
    top = 3 * CHIM_COURSES
    m.add("p2x2", DBG, 0, 0, top)
    m.add("t2x2", DBG, 0, 0, top + 1)
    m.step()
    m.width, m.depth = 2, 2
    return m


def build_totem():
    m = Model("totem.ldr", "Totem pole (build 2)")
    for k, c in enumerate((LOG, BLACK, LOG, RED, TURQ, LOG)):
        m.add("b1x1", c, 1, 0, 3 * k)
    m.step()
    m.add("p1x3", BLACK, 0, 0, 18)                      # the spread wings
    m.add("b1x1", WHITE, 1, 0, 19)                      # the head and its beak
    m.add("cheese", RED, 1, 0, 22)
    m.step()
    m.width, m.depth = 3, 1
    return m


def build_main(lodge, wing, chimney, totem):
    m = Model("wilderness_lodge_compact.ldr", "Wilderness Lodge (compact)")
    m.header_notes = ["Compact resort collection; generated by design.py (lego-kit)."]
    m.section("The display base", "The base and the black band are the same for every kit in "
              "the collection. The lawn and the walk to the porte-cochere go on next.")
    band = display_base(m)
    reserved = set(band)
    reserved |= {(LX + x, LZ + z) for x in range(LW) for z in range(WZ, WZ + LD)}
    reserved |= {(LX + x, LZ + z) for x in range(PORCH[0], PORCH[1])
                 for z in range(PORCH[2], PORCH[3])}
    for wx, wz in WINGS:
        reserved |= {(wx + x, wz + z) for x in range(WING_W) for z in range(WING_D)}
    reserved |= {(CHIM[0] + i, CHIM[1] + j) for i in (0, 1) for j in (0, 1)}
    reserved |= set(TOTEMS)
    finish_ground(m, reserved, GREEN,
                  colour_at=lambda x, z: TAN if x in WALK and z < LZ else GREEN)
    m.step()
    m.sub(lodge, LX, LZ, 1)
    m.step()
    for wx, wz in WINGS:
        m.sub(wing, wx, wz, 1)
    m.step()
    m.sub(chimney, *CHIM, 1)
    m.step()
    for tx, tz in TOTEMS:
        m.sub(totem, tx - 1, tz, 1)
    m.step()
    return m


def build():
    lodge, wing, chimney, totem = build_lodge(), build_wing(), build_chimney(), build_totem()
    main_m = build_main(lodge, wing, chimney, totem)
    return main_m, [main_m, lodge, wing, chimney, totem]
