"""All-Star Music Resort, compact display kit (resort collection).

Build with the shared kit:  ./build.sh

The compact format (lego-kit/compact.py): a 24 x 16 base with a black front
band; one storey = 4 plates (a course of bricks and a plate band), 1 stud is about 2 m.

Grid (studs): x to the right, z toward the back; the front band is z = 0..1.
  guest building  x  5..16, z 10..13  three storeys; open walkway along the front (z 10)
  jukebox tower   x 17..22, z  9..12  the stair tower as a giant jukebox with a rounded top
  guitar          x  0..4,  z 10..11  a giant guitar standing on end
  drums           x 19..22, z  4..5   two giant drums
  walk            x 10..11, z  2..9   to the walkway
"""
import bricks
from bricks import (Model, FACE, row, fill_rect, place_rect,
                    WHITE, BLACK, LBG, RED, GREEN, RBROWN, BRORANGE as ORANGE)
from walls import WallRing
from compact import compact_project, display_base, finish_ground

YELLOW, DPURPLE, TCLEAR, MAZURE = 14, 85, 47, 322
bricks.COLOR_NAMES.setdefault(YELLOW, "Yellow")
# Bestseller sizes for the colours of this kit (checked with avail.py); a short list of
# sizes keeps the number of part/colour lines down
bricks.ALLOWED[("b", WHITE)] = bricks._sizes("1x1 1x2 1x4 1x6")
bricks.ALLOWED[("b", RED)] = bricks._sizes("1x1 1x2 1x4 2x2 2x3")
bricks.ALLOWED[("b", DPURPLE)] = bricks._sizes("1x1 1x2")
bricks.ALLOWED[("b", YELLOW)] = bricks._sizes("1x1 1x2")
bricks.ALLOWED[("b", MAZURE)] = bricks._sizes("1x1 1x2")
bricks.ALLOWED[("t", DPURPLE)] = bricks._sizes("1x2")
bricks.ALLOWED[("t", YELLOW)] = bricks._sizes("1x1 1x2")

WALL, BAND, PLINTH = WHITE, WHITE, LBG
DOOR, WINDOW, RAIL, CORNICE = DPURPLE, BLACK, YELLOW, DPURPLE
JUKE_BODY, JUKE_OUT, JUKE_IN, JUKE_TOP, GRILLE = MAZURE, RED, YELLOW, ORANGE, LBG
ARCH_FRONT = WHITE
GUITAR, NECK, HEAD, PEGS = RED, RBROWN, BLACK, YELLOW

PROJECT = compact_project(
    slug="all_star_music",
    title="All-Star Music Resort",
    resort="Disney's All-Star Music Resort",
    category="Value",
    about=("A short section of one of the bright guest buildings of All-Star Music: three "
           "storeys of rooms opening onto outdoor walkways with yellow railings, under a "
           "purple-capped parapet. Its stair tower is a giant jukebox with a rounded top, "
           "glowing light tubes and a speaker grille. A giant guitar stands on end at the "
           "other end of the building, and two giant drums sit on the lawn."),
    features=["Three-storey guest building with open walkways, yellow railings, purple doors "
              "and a purple-capped parapet",
              "The jukebox stair tower: red and yellow light tubes, a glowing window, a "
              "speaker grille and a rounded red top with a white and orange arch",
              "A giant red guitar standing on end, its neck reaching far above the roofline",
              "Two giant drums by the walk"],
    omitted=["The rest of the guest buildings and the other music-themed sections",
             "Melody Hall, the pools and the parking lots",
             "The other giant instruments (maracas, saxophones, cowboy boots)"],
    colour_rows=[("White", "White", "White"), ("Dark Purple", "Medium Lilac", "Dark Purple"),
                 ("Yellow", "Bright Yellow", "Yellow"), ("Red", "Bright Red", "Red"),
                 ("Medium Azure", "Medium Azur", "Medium Azure"),
                 ("Orange", "Bright Orange", "Orange"),
                 ("Trans-Clear", "Transparent", "Trans-Clear"), ("Black", "Black", "Black"),
                 ("Light Bluish Gray", "Medium Stone Grey", "Light Bluish Gray"),
                 ("Reddish Brown", "Reddish Brown", "Reddish Brown"),
                 ("Green", "Dark Green", "Green")],
    organisation=["The display base and the lawn", "The guest building",
                  "The jukebox stair tower", "The giant guitar", "The drums"],
    sub_info={
        "guest_building.ldr": ("The guest building",
                               "Three storeys of rooms behind open walkways. Each walkway "
                               "is a white deck on round columns with a yellow railing."),
        "jukebox.ldr": ("The jukebox stair tower",
                        "Round bricks make the light tubes up the front of the cabinet. Clear "
                        "bricks with yellow behind them make the glowing window, and slopes "
                        "round off the top."),
        "guitar.ldr": ("The giant guitar",
                       "Slopes and inverted slopes shape the body, then the neck and the "
                       "headstock with its tuning pegs."),
        "drums.ldr": ("The drums", "Two drums of round plates with white drumheads."),
    },
    legend=("drums.ldr", 1),
    tips=["Each storey of the guest building is one course of bricks with round white "
          "columns in front, then a white deck that reaches out over the walkway. On the "
          "upper storeys the yellow railing tiles sit on the edge of the deck, between the "
          "columns.",
          "Slopes shape the jukebox top and the guitar body. Check which way each slope "
          "faces in the picture before pressing it down.",
          "Keep the white, purple and yellow parts in separate trays."],
    build_time="about 1 to 1&frac12; hours",
)

# ---------------------------------------------------------------- layout
BX, BZ, BW, BD = 5, 10, 12, 4          # guest building
JX, JZ, JW, JD = 17, 9, 6, 4           # jukebox tower
GX, GZ, GW, GD = 0, 10, 5, 2           # guitar
DX, DZ, DW, DD = 19, 4, 4, 2           # drums
WALK = (10, 11)


# ---------------------------------------------------------------- guest building
COLS = (0, 3, 6, 9, 11)                # walkway columns along the front (z = 0)


def build_building():
    m = Model("guest_building.ldr", "Guest building")
    fill_rect(m, "p", PLINTH, 0, 0, BW, BD, 0, along="x", widths=[4])
    m.step()
    ring = WallRing([(0, 1), (BW - 1, 1), (BW - 1, BD - 1), (0, BD - 1)])

    def mat(x, z, layer):
        if z == 1 and 0 < x < BW - 1:              # rooms: a door and a window each
            k = x % 3
            return ("b", WALL if k == 0 else DOOR if k == 1 else WINDOW)
        if z == BD - 1 and 0 < x < BW - 1 and x % 3 == 2:
            return ("b", WINDOW)
        return ("b", WALL)

    for f in (1, 2, 3):
        L = 1 + 4 * (f - 1)
        if f > 1:
            m.step("The yellow railing runs along the edge of the deck, between the columns.")
            for x0, n in _runs(x for x in range(BW) if x not in COLS):
                row(m, "t", RAIL, x0, 0, n, L)
        ring.course(m, L, f % 2, mat)
        for x in COLS:
            m.add("round1", WALL, x, 0, L)
        m.step()
        # the floor deck reaches out over the walkway
        fill_rect(m, "p", BAND, 0, 0, BW, BD, L + 3, along="x", widths=[4])
        m.step()
    # a low parapet around the flat roof, capped with purple tiles
    top = WallRing([(0, 0), (BW - 1, 0), (BW - 1, BD - 1), (0, BD - 1)])
    top.course(m, 13, 0, lambda x, z, l: ("b", WALL))
    m.step()
    for x0, z0, n, axis in ((0, 0, BW, "x"), (0, BD - 1, BW, "x"), (0, 1, BD - 2, "z"),
                            (BW - 1, 1, BD - 2, "z")):
        row(m, "t", CORNICE, x0, z0, n, 16, axis=axis)
    m.step()
    m.width, m.depth = BW, BD
    return m


def _runs(xs):
    out = []
    for x in sorted(xs):
        if out and out[-1][0] + out[-1][1] == x:
            out[-1] = (out[-1][0], out[-1][1] + 1)
        else:
            out.append((x, 1))
    return out


# ---------------------------------------------------------------- jukebox
TUBES = ((0, JUKE_OUT), (1, JUKE_IN), (JW - 2, JUKE_IN), (JW - 1, JUKE_OUT))


def build_jukebox():
    m = Model("jukebox.ldr", "Jukebox stair tower")
    for x in range(0, JW, 2):
        place_rect(m, "p", BLACK, x, 0, 2, JD, 0)
    m.step()
    ring = WallRing([(0, 0), (JW - 1, 0), (JW - 1, JD - 1), (0, JD - 1)])
    # the middle of the front, bottom to top: speaker grille, selector, window
    centre = ("grille", "grille", WHITE, "glass", "glass")
    for c, what in enumerate(centre):
        L = 1 + 3 * c

        def mat(x, z, layer, what=what):
            if z == 0:
                if x in (0, 1, JW - 2, JW - 1) or what in ("grille", "glass"):
                    return None
                return ("b", what)
            return ("b", JUKE_BODY)
        ring.course(m, L, c % 2, mat)
        for x, col in TUBES:
            m.add("round1", col, x, 0, L)            # the light tubes
        if what == "grille":
            m.add("grille1x2", GRILLE, 2, 0, L)
        elif what == "glass":
            m.add("b1x2_open", TCLEAR, 2, 0, L)
        m.add("b1x2", JUKE_IN, 2, 1, L)              # lights behind the window
        m.step()
    # the rounded top: steep red slopes with a white front, lights behind the window
    for z in range(JD):
        col = ARCH_FRONT if z == 0 else JUKE_OUT
        m.add("slope65", col, 0, z, 16, rot=FACE["left"])
        m.add("slope65", col, JW - 2, z, 16, rot=FACE["right"])
    for k, L in enumerate((16, 19)):
        m.add("b1x2_open", TCLEAR, 2, 0, L)
        if k == 0:
            m.add("b1x2", JUKE_IN, 2, 1, L, rot=90)
            m.add("b1x2", JUKE_IN, 3, 1, L, rot=90)
            m.add("b1x2", JUKE_OUT, 2, 3, L)
        else:
            m.add("b1x2", JUKE_IN, 2, 1, L)
            m.add("b1x2", JUKE_OUT, 2, 2, L, rot=90)
            m.add("b1x2", JUKE_OUT, 3, 2, L, rot=90)
    m.step()
    # the crown: curved slopes, orange along the front
    for z in range(JD):
        col = JUKE_TOP if z == 0 else JUKE_OUT
        m.add("curve2x1", col, 1, z, 22, rot=FACE["left"])
        m.add("curve2x1", col, 3, z, 22, rot=FACE["right"])
    m.step()
    m.width, m.depth = JW, JD
    return m


# ---------------------------------------------------------------- guitar
def _bout(m, layer, inverted=False):
    """One course of the guitar body: slopes narrow it, inverted slopes widen it."""
    key = "slope45inv" if inverted else "s45x2"
    for z in ((0, 1) if inverted else (0,)):
        m.add(key, GUITAR, 0, z, layer, rot=FACE["left"])
        m.add(key, GUITAR, 3, z, layer, rot=FACE["right"])
    m.add("b1x2", GUITAR, 2, 0, layer, rot=90)


def build_guitar():
    m = Model("guitar.ldr", "Giant guitar")
    # the lower bout
    _bout(m, 0, inverted=True)
    place_rect(m, "b", GUITAR, 0, 0, 3, 2, 3)
    place_rect(m, "b", GUITAR, 3, 0, 2, 2, 3)
    m.step()
    place_rect(m, "b", GUITAR, 0, 0, 2, 2, 6)
    m.add("b1x1", BLACK, 2, 0, 6)                  # the sound hole
    m.add("b1x1", BLACK, 2, 1, 6)
    place_rect(m, "b", GUITAR, 3, 0, 2, 2, 6)
    _bout(m, 9)
    m.step()
    # the waist and the upper bout
    place_rect(m, "p", GUITAR, 1, 0, 3, 2, 12)
    m.step()
    _bout(m, 13, inverted=True)
    m.step()
    _bout(m, 16)
    m.step()
    # the neck and the headstock with its tuning pegs
    for k in range(5):
        m.add("b1x1", NECK, 2, 0, 19 + 3 * k)
    m.step()
    m.add("p1x3", HEAD, 1, 0, 34)
    m.add("b1x1", HEAD, 2, 0, 35)
    m.add("round_p1", PEGS, 1, 0, 35)
    m.add("round_p1", PEGS, 3, 0, 35)
    m.step()
    m.width, m.depth = GW, GD
    return m


# ---------------------------------------------------------------- drums
def build_drums():
    m = Model("drums.ldr", "Drums")
    m.add("p2x4", BLACK, 0, 0, 0)
    m.step()
    for k in range(3):
        m.add("round_p2", RED, 0, 0, 1 + k)
    m.add("tile_round2", WHITE, 0, 0, 4)
    for k in range(2):
        m.add("round_p2", YELLOW, 2, 0, 1 + k)
    m.add("tile_round2", WHITE, 2, 0, 3)
    m.step()
    m.width, m.depth = DW, DD
    return m


# ---------------------------------------------------------------- main model
def build_main(building, jukebox, guitar, drums):
    m = Model("all_star_music_compact.ldr", "All-Star Music Resort (compact)")
    m.header_notes = ["Compact resort collection; generated by design.py (lego-kit)."]
    m.section("The display base", "The base and the black band are the same for every kit in "
              "the collection. The lawn and the walk to the walkway go on next.")
    band = display_base(m)
    reserved = set(band)
    for (x0, z0, w, d) in ((BX, BZ, BW, BD), (JX, JZ, JW, JD), (GX, GZ, GW, GD),
                           (DX, DZ, DW, DD)):
        reserved |= {(x0 + x, z0 + z) for x in range(w) for z in range(d)}
    finish_ground(m, reserved, GREEN,
                  colour_at=lambda x, z: LBG if x in WALK and z < BZ else GREEN)
    m.step()
    m.sub(building, BX, BZ, 1)
    m.step()
    m.sub(jukebox, JX, JZ, 1)
    m.step()
    m.sub(guitar, GX, GZ, 1)
    m.step()
    m.section("The drums", "Two giant drums stand on the lawn beside the walk.")
    m.sub(drums, DX, DZ, 1)
    m.step()
    return m


def build():
    building, jukebox, guitar, drums = (build_building(), build_jukebox(), build_guitar(),
                                        build_drums())
    main_m = build_main(building, jukebox, guitar, drums)
    return main_m, [main_m, building, jukebox, guitar, drums]
