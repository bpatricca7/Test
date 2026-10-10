"""Wilderness Lodge, mid-size display kit (resort collection).

Build with the shared kit:  ./build.sh

The mid-size format (lego-kit/compact.py, size="midsize"): a 32 x 24 base with a
black front band; one storey = 4 plates (a course of bricks and a plate band),
1 stud is about 2 m, the same scale as the compact kit. It shows the arrival front
of the great lodge, facing the band (-z), and is symmetric about x = 15.5 except
for the stone colours.

Grid (studs): x to the right, z toward the back; the front band is z = 0..1.
  great lodge    x 10..21, z 14..17   a stone storey and five storeys of logs under
                                      the steep green 12-wide front gable with the tall
                                      lobby window
  porte-cochere  x 11..20, z  8..13   paired log columns on stone piers, log beams, a
                                      deck and a steep green front gable with a log truss;
                                      its back edge touches the lodge
  wings          x  1..9 and 22..30, z 15..18   a three-storey outer block with a side
                                      gable and a four-storey inner block with a front
                                      gable (mirror images); the side against the lodge
                                      is open, the lodge's wall closes it
  chimney        x 15..16, z 18..19   stone, from the ground to above the lodge ridge
  totem poles    (9, 11) and (22, 11), either side of the porte-cochere
  drive          a loop: z 8..10 across the base under the porte-cochere, and legs at
                 x 4..6 and 25..27 out to the band
  pines          (2, 3), (3, 6), (29, 3), (28, 6) on the lawns at the front corners
"""
from contextlib import contextmanager

import bricks
from bricks import (Model, row, fill_cells, fill_rect, split_length, _sizes,
                    BLACK, LBG, DBG, GREEN, RBROWN, TAN, RED, WHITE)
from roofs import Roof, build_roofs
from walls import WallRing
from compact import compact_project, display_base, finish_ground

SIZE = "midsize"
bricks.P("wlm_log1x2", "30136.dat", "Brick 1 x 2 Log")

TURQ = 3                                   # Dark Turquoise
LOG, ROOF, WINDOW, PLINTH, PAVING, TRUSS = RBROWN, GREEN, BLACK, LBG, LBG, TAN
STONES = (LBG, DBG, LBG, TAN, DBG, LBG, DBG, LBG, TAN, DBG, LBG)

# Bestseller sizes for colours the toolkit has no entry for (checked with avail.py);
# added only while this design builds, so other kits are unaffected
EXTRA_ALLOWED = {
    ("b", RBROWN): _sizes("1x1 1x2 1x3 1x4 1x6"),
    ("t", GREEN): _sizes("1x1 1x2 1x4 2x2"),
    ("b", TAN): _sizes("1x1 1x2 1x3 1x4 1x6"),
    # the toolkit allows a 1 x 12 plate in light bluish gray; it isn't a Bestseller
    ("p", LBG): _sizes("1x1 1x2 1x3 1x4 1x6 1x8 1x10 2x2 2x3 2x4 2x6 2x8 2x10 2x12 "
                       "4x4 4x6 4x8 4x10 4x12 6x6 6x8 6x10 6x12"),
}


@contextmanager
def bestseller_sizes():
    saved = {k: bricks.ALLOWED.get(k) for k in EXTRA_ALLOWED}
    bricks.ALLOWED.update(EXTRA_ALLOWED)
    try:
        yield
    finally:
        for k, v in saved.items():
            if v is None:
                del bricks.ALLOWED[k]
            else:
                bricks.ALLOWED[k] = v


PROJECT = compact_project(
    size=SIZE,
    slug="wilderness_lodge",
    title="Wilderness Lodge",
    resort="Disney's Wilderness Lodge",
    category="Deluxe",
    merged=["Boulder Ridge Villas at Disney's Wilderness Lodge",
            "Copper Creek Villas & Cabins at Disney's Wilderness Lodge"],
    about=("The arrival front of the Wilderness Lodge, in the Pacific Northwest style of the "
           "great national-park lodges, as a guest sees it from the drive: the six-storey "
           "lodge of reddish-brown logs on a stone base, under a steep dark-green front gable "
           "with the tall lobby window; the big log porte-cochere over the drive, on paired "
           "log columns and stone piers, with a log truss in its own steep gable; guest wings "
           "on each side that step down from four storeys to three under green gables; the "
           "tall stone chimney rising behind the ridge; the two totem poles either side of the "
           "entrance, and dark-green pines along the drive that loops in from the road."),
    features=["The six-storey great lodge: a stone storey under five storeys of reddish-brown "
              "logs and rows of windows",
              "The steep dark-green front gable with the tall lobby window",
              "The big log porte-cochere over the drive: paired log columns on stone piers, "
              "log beams and a steep green gable with a log truss",
              "Guest wings stepping down on each side: four storeys under a front gable, then "
              "three under a side gable",
              "The tall stone chimney rising behind the ridge",
              "Two totem poles at the entrance, four dark-green pines and the arrival drive"],
    omitted=["The long V-shaped guest wings that reach back to the lake, Boulder Ridge and "
             "Copper Creek",
             "The lobby interior, Silver Creek, the geyser and the pool",
             "The dormers, balconies and smaller gables of the roofs"],
    colour_rows=[("Reddish Brown", "Reddish Brown", "Reddish Brown"),
                 ("Green", "Dark Green", "Green"),
                 ("Light Bluish Gray", "Medium Stone Grey", "Light Bluish Gray"),
                 ("Dark Bluish Gray", "Dark Stone Grey", "Dark Bluish Gray"),
                 ("Tan", "Brick Yellow", "Tan"), ("Black", "Black", "Black"),
                 ("Red", "Bright Red", "Red"), ("White", "White", "White"),
                 ("Dark Turquoise", "Bright Bluish Green", "Dark Turquoise")],
    organisation=["The display base, the drive and the lawns", "The great lodge",
                  "The left wing", "The right wing", "The porte-cochere", "The chimney",
                  "The totem poles and the pines"],
    sub_info={
        "lodge.ldr": ("The great lodge",
                      "A stone storey and five storeys of logs with rows of windows, then the "
                      "steep green front gable with the tall lobby window."),
        "wing_left.ldr": ("The left wing",
                          "Three storeys across the whole wing and one more on the inner "
                          "block next to the lodge; a side gable over the outer block and a "
                          "front gable over the inner one. The side that stands against the "
                          "lodge is left open."),
        "wing_right.ldr": ("The right wing",
                           "The mirror image of the left wing: the lower block is on the "
                           "right, and the open side on the left."),
        "porte.ldr": ("The porte-cochere",
                      "Paired log columns on stone piers carry log beams, a deck and a steep "
                      "green roof with a log truss in its front gable."),
        "chimney.ldr": ("The chimney",
                        "A column of masonry bricks in grey and tan, turned a quarter at "
                        "every course, that rises above the lodge ridge."),
        "totem.ldr": ("The totem poles",
                      "Two identical poles of stacked coloured bricks with spread wings."),
        "pine.ldr": ("The pines", "A trunk and a stack of leaf plates, turned a little each "
                     "time, with a cone on top."),
    },
    legend=("pine.ldr", 1),
    tips=["The walls are log bricks: 1&times;4 and 1&times;2 logs, with a plain 1&times;1 "
          "brick where a run needs one more stud. The ground storey is stone: masonry bricks "
          "in two greys and tan, mixed freely.",
          "Each storey ends with a ring of plates on the walls. It runs the other way round "
          "from the one below (across the front and back corners, then along the sides), so "
          "the corners lock together.",
          "The two wings are mirror images, each with its own pages: the lower block goes at "
          "the outer end, and the side against the lodge stays open.",
          "Roofs go up one row of slopes at a time.",
          "The porte-cochere stands on its own four feet; set it down so its back edge "
          "touches the front of the lodge.",
          "A <b>&ldquo;Build 2&rdquo;</b> or <b>&ldquo;Build 4&rdquo;</b> badge means you "
          "build that module two or four times."],
    build_time="about 2 to 2&frac12; hours",
)


# --------------------------------------------------------------------------
# log and stone walls
# --------------------------------------------------------------------------
def stone(x, z, layer):
    return STONES[((x * 7) ^ (z * 13) ^ (layer * 5)) % len(STONES)]


def log_run(m, colour, x0, z0, n, layer, axis="x", avoid=()):
    """A run of log bricks (1x4, 1x2; a plain 1x1 brick for an odd stud)."""
    pieces = split_length(n, [4, 2, 1], avoid)
    pos, used = 0, set()
    for s in pieces:
        key = {4: "log1x4", 2: "wlm_log1x2", 1: "b1x1"}[s]
        if axis == "x":
            m.add(key, colour, x0 + pos, z0, layer)
        else:
            m.add(key, colour, x0, z0 + pos, layer, rot=90)
        pos += s
        used.add(pos)
    used.discard(n)
    return used


def stone_run(m, cells, layer, parity, axis):
    """Masonry 1x2 bricks in grey and tan with a running bond; 1x1 bricks fill in."""
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
                else:       # the corner-owning walls start with a whole masonry brick
                    stone_run(m, rc, layer, parity + 1, seg["axis"])
                    new = set()
                used |= {s + rel0 for s in new}
            self.seams[si] = used


def rect(x0, z0, w, d):
    return {(x, z) for x in range(x0, x0 + w) for z in range(z0, z0 + d)}


def ring(x0, z0, w, d):
    return {c for c in rect(x0, z0, w, d)
            if c[0] in (x0, x0 + w - 1) or c[1] in (z0, z0 + d - 1)}


def ring_plates(m, colour, x0, z0, w, d, layer, extra=(), open_side=None, along="x"):
    """A ring of 1-wide plates on a block's walls, and any `extra` cells (a wall line
    inside the block). along="x": the front and back rows run the full width and cover
    the corners; along="z": the sides run the full depth instead. Storeys alternate the
    two, so every corner is bridged one way or the other and the walls interlock.
    `open_side` is the x of a side left open (it stands against another building); the
    front and back rows then always reach that corner."""
    sides = [x for x in (x0, x0 + w - 1) if x != open_side]
    if along == "x":
        for z in (z0, z0 + d - 1):     # no joint next to a corner: the plate bridges it
            row(m, "p", colour, x0, z, w, layer, avoid={1, w - 1})
        for x in sides:
            row(m, "p", colour, x, z0 + 1, d - 2, layer, axis="z")
    else:
        for x in sides:
            row(m, "p", colour, x, z0, d, layer, axis="z", avoid={1, d - 1})
        lo = x0 if open_side == x0 else x0 + 1
        hi = x0 + w - 1 if open_side == x0 + w - 1 else x0 + w - 2
        for z in (z0, z0 + d - 1):
            row(m, "p", colour, lo, z, hi - lo + 1, layer)
    extra = set(extra) - ring(x0, z0, w, d)
    if extra:
        fill_cells(m, "p", colour, extra, layer)


def storeys(m, x0, z0, w, d, first, last, mat, top_extra=(), open_side=None):
    """Storeys first..last of a block: a course of logs or stone and a plate band each.

    The plinth is layer 0, so storey f's course starts at layer 1 + 4 (f - 1). Every
    band is a ring on the walls, laid the other way round at each storey; the 45-degree
    roofs above rest on the top ring and on their own lower rows. Returns the roof base
    layer."""
    walls = LogRing([(x0, z0), (x0 + w - 1, z0), (x0 + w - 1, z0 + d - 1), (x0, z0 + d - 1)])
    for f in range(first, last + 1):
        L = 1 + 4 * (f - 1)
        walls.course(m, L, f % 2, lambda x, z, layer, f=f: mat(x, z, f))
        m.step()
        ring_plates(m, LOG, x0, z0, w, d, L + 3, top_extra if f == last else (), open_side,
                    along="x" if f % 2 else "z")
        m.step()
    return 1 + 4 * last


def gable_wall(windows, colour=LOG):
    """Gable-end wall builder: log runs, with black windows where windows(end, i) says.

    `windows(end, i)` gets the end ("front"/"back" for a ridge along z, "side" for a
    ridge along x) and the course index counted from the eave, and returns the x (or z)
    positions of window cells."""
    def wall(m, cells, layer):
        cells = sorted(cells)
        axis = "x" if cells[0][1] == cells[-1][1] else "z"
        end = ("front" if cells[0][1] == 0 else "back") if axis == "x" else "side"
        win = windows(end, (layer - wall.base) // 3)
        run, kind = [], None
        for c in cells + [None]:
            k = None if c is None else ("w" if (c[0] if axis == "x" else c[1]) in win else "l")
            if run and k != kind:
                x0, z0 = run[0]
                if kind == "w":
                    row(m, "b", WINDOW, x0, z0, len(run), layer, axis=axis)
                else:
                    log_run(m, colour, x0, z0, len(run), layer, axis)
                run = []
            if c is not None:
                run.append(c)
                kind = k
    wall.base = 0
    return wall


def roof(m, blocks):
    build_roofs(m, blocks, fill_color=LOG, support_caps=True)


# --------------------------------------------------------------------------
# the great lodge: six storeys under the steep front gable
# --------------------------------------------------------------------------
LW, LD, LFLOORS = 12, 4, 6
LODGE_WIN = {1, 2, 5, 6, 9, 10}             # window pairs in the front and back walls
WING_D = 4
HIGH_FLOORS, LOW_FLOORS = 4, 3            # the wings' inner and outer blocks


def build_lodge():
    m = Model("lodge.ldr", "The great lodge")
    ring_plates(m, PLINTH, 0, 0, LW, LD, 0)
    m.step()

    def mat(x, z, f):
        front, back, side = z == 0, z == LD - 1, x in (0, LW - 1)
        if f == 1:
            if front and x in (5, 6):
                return ("b", WINDOW)                     # the entrance doors
            return ("stone",)
        if (front or back) and x in LODGE_WIN:
            return ("b", WINDOW)
        if side and 0 < z < LD - 1 and f > HIGH_FLOORS:
            return ("b", WINDOW)                         # above the wing roofs
        return ("log", LOG)
    base = storeys(m, 0, 0, LW, LD, 1, LFLOORS, mat)

    def windows(end, i):
        if end == "front":                               # the tall lobby window
            return {5, 6} if i <= 2 else set()
        return {5, 6} if i <= 1 else set()
    wall = gable_wall(windows)
    wall.base = base
    roof(m, [Roof(0, LW, 0, LD, base, "z", pitch=45, color=ROOF, wall=wall, name="lodge gable")])
    m.width, m.depth = LW, LD
    return m


# --------------------------------------------------------------------------
# wings: a low outer block with a side gable, a taller inner block with a front gable
# --------------------------------------------------------------------------
WING_W, INNER_W = 9, 6
OUTER_W = WING_W - INNER_W


def build_wing(right):
    name = "wing_right.ldr" if right else "wing_left.ldr"
    m = Model(name, "Right wing" if right else "Left wing")
    W, D = WING_W, WING_D
    ix = 0 if right else OUTER_W                # inner block (next to the lodge)
    ox = INNER_W if right else 0                # outer block
    lodge_side = 0 if right else W - 1          # the wall against the lodge
    inner_wall = ix + INNER_W - 1 if right else ix   # the inner block's outer wall

    def u(x):                                   # 0 at the outer end of the wing
        return W - 1 - x if right else x
    # the side against the lodge is left open: the lodge's own wall closes it
    m.step("The side that will stand against the lodge stays open: the lodge's own wall "
           "closes it.")
    ring_plates(m, PLINTH, 0, 0, W, D, 0, open_side=lodge_side)
    m.step()

    def low(x, z, f):
        if x == lodge_side and 0 < z < D - 1:
            return None
        if f == 1:
            return ("stone",)
        if z in (0, D - 1) and u(x) in (1, 2, 5, 6):
            return ("b", WINDOW)
        if u(x) == 0 and 0 < z < D - 1:
            return ("b", WINDOW)
        return ("log", LOG)
    # the top band also carries the inner block's outer wall
    extra = {(inner_wall, z) for z in range(D)}
    base_low = storeys(m, 0, 0, W, D, 1, LOW_FLOORS, low, top_extra=extra, open_side=lodge_side)

    def high(x, z, f):
        if x == lodge_side and 0 < z < D - 1:
            return None
        if z in (0, D - 1) and u(x) in (5, 6):
            return ("b", WINDOW)
        return ("log", LOG)
    base_high = storeys(m, ix, 0, INNER_W, D, LOW_FLOORS + 1, HIGH_FLOORS, high,
                        open_side=lodge_side)

    # the outer block's side gable: a log gable at the outer end only
    low_wall = gable_wall(lambda end, i: set())
    low_wall.base = base_low
    roof(m, [Roof(ox, ox + OUTER_W, 0, D, base_low, "x", pitch=45, color=ROOF, wall=low_wall,
                  wall_ends=("end",) if right else ("start",), name="outer roof")])
    # the inner block's front gable, with a small window in each gable end
    high_wall = gable_wall(lambda end, i: {ix + 2, ix + 3} if i == 0 else set())
    high_wall.base = base_high
    roof(m, [Roof(ix, ix + INNER_W, 0, D, base_high, "z", pitch=45, color=ROOF, wall=high_wall,
                  name="inner gable")])
    m.width, m.depth = W, D
    return m


# --------------------------------------------------------------------------
# porte-cochere: paired log columns on stone piers, log beams, deck and gable
# --------------------------------------------------------------------------
PC_W, PC_D = 10, 6
PC_COLS = [(0, 0), (PC_W - 2, 0), (0, PC_D - 1), (PC_W - 2, PC_D - 1)]   # left cell of each pair
PC_DECK = 13


def build_porte():
    m = Model("porte.ldr", "Porte-cochere")
    m.step("Each column: a plate, a stone pier and two pairs of round log bricks.")
    for x, z in PC_COLS:
        m.add("p1x2", PLINTH, x, z, 0)
        m.add("masonry", stone(x, z, 1), x, z, 1)
        for L in range(4, PC_DECK - 3, 3):
            m.add("round1", LOG, x, z, L)
            m.add("round1", LOG, x + 1, z, L)
    m.step()
    m.step("Log beams across the front and the back tie each pair of columns.")
    for z in (0, PC_D - 1):
        log_run(m, LOG, 0, z, PC_W, PC_DECK - 3)
    m.step()
    fill_rect(m, "p", LOG, 0, 0, PC_W, PC_D, PC_DECK, along="z")
    m.step()

    def truss(m2, cells, layer):
        """The log truss in the front gable: a tie beam, then a tan king post with dark
        openings either side of it."""
        xs = sorted(c[0] for c in cells)
        z, n = cells[0][1], len(xs)
        if n >= 6:
            log_run(m2, LOG, xs[0], z, n, layer)
        elif n >= 4:
            m2.add("b1x1", WINDOW, xs[0], z, layer)
            m2.add("wlm_log1x2", TRUSS, xs[1], z, layer)
            m2.add("b1x1", WINDOW, xs[-1], z, layer)
        else:
            m2.add("wlm_log1x2", TRUSS, xs[0], z, layer)
    roof(m, [Roof(0, PC_W, 0, PC_D, PC_DECK + 1, "z", pitch=45, color=ROOF, wall=truss,
                  wall_ends=("start",), name="porte-cochere roof")])
    m.width, m.depth = PC_W, PC_D
    return m


# --------------------------------------------------------------------------
# chimney, totem pole, pine
# --------------------------------------------------------------------------
CHIM_COURSES = 15


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
    for k, c in enumerate((LOG, BLACK, RED, LOG, TURQ, BLACK, LOG)):
        m.add("b1x1", c, 1, 0, 3 * k)
    m.step()
    m.add("p1x3", BLACK, 0, 0, 21)                      # the spread wings
    m.add("b1x1", WHITE, 1, 0, 22)                      # the head and its beak
    m.add("cheese", RED, 1, 0, 25)
    m.step()
    m.width, m.depth = 3, 1
    return m


PINE_LEAVES = 9


def build_pine():
    m = Model("pine.ldr", "Pine")
    m.add("round1", LOG, 0, 0, 0)
    m.add("round1", LOG, 0, 0, 3)
    m.step()
    for i in range(PINE_LEAVES):
        m.add("leaves1", ROOF, 0, 0, 6 + i, rot=40 * i)
    m.add("cone1", ROOF, 0, 0, 6 + PINE_LEAVES)
    m.step()
    m.width, m.depth = 1, 1
    return m


# --------------------------------------------------------------------------
# main model
# --------------------------------------------------------------------------
LX, LZ = 10, 14
WINGS = ((1, 15), (22, 15))
PX, PZ = 11, 8
CHIM = (15, 18)
TOTEMS = ((9, 11), (22, 11))
PINES = ((2, 3), (3, 6), (29, 3), (28, 6))  # kept in so no branch overhangs the base
DRIVE_Z = range(8, 11)                    # the loop: across under the porte-cochere ...
DRIVE_LEGS = (range(4, 7), range(25, 28))  # ... and two legs out to the front edge


def ground_colour(x, z):
    if z in DRIVE_Z or (z < DRIVE_Z[0] and any(x in leg for leg in DRIVE_LEGS)):
        return PAVING
    if PX <= x < PX + PC_W and PZ <= z < LZ:
        return PAVING
    return GREEN


def build_main(lodge, wings, porte, chimney, totem, pine):
    m = Model("wilderness_lodge_midsize.ldr", "Wilderness Lodge (mid-size)")
    m.header_notes = ["Mid-size resort collection; generated by design.py (lego-kit)."]
    m.section("The display base", "The base and the black band are the same for every "
              "mid-size kit. The drive and the lawns go on next; the drive tiles tie the base "
              "plates together.")
    band = display_base(m, SIZE)
    reserved = set(band)
    reserved |= rect(LX, LZ, LW, LD)
    for wx, wz in WINGS:
        reserved |= rect(wx, wz, WING_W, WING_D)
    reserved |= {(PX + x + i, PZ + z) for x, z in PC_COLS for i in (0, 1)}
    reserved |= rect(*CHIM, 2, 2)
    reserved |= set(TOTEMS)
    finish_ground(m, reserved, GREEN, colour_at=ground_colour, size=SIZE)
    m.step()
    m.sub(lodge, LX, LZ, 1)
    m.step()
    for w, (wx, wz) in zip(wings, WINGS):
        m.sub(w, wx, wz, 1)
        m.step()
    m.sub(porte, PX, PZ, 1)
    m.step()
    m.sub(chimney, *CHIM, 1)
    m.step()
    m.section("The totem poles and the pines", "The two totem poles stand either side of "
              "the porte-cochere; the pines go on the lawns along the drive.")
    for tx, tz in TOTEMS:
        m.sub(totem, tx - 1, tz, 1)
    m.step()
    for px, pz in PINES:
        m.sub(pine, px, pz, 2)                  # on the lawn plates
    m.step()
    return m


def build():
    with bestseller_sizes():
        lodge = build_lodge()
        wings = [build_wing(False), build_wing(True)]
        porte = build_porte()
        chimney, totem, pine = build_chimney(), build_totem(), build_pine()
        main_m = build_main(lodge, wings, porte, chimney, totem, pine)
    return main_m, [main_m, lodge] + wings + [porte, chimney, totem, pine]
