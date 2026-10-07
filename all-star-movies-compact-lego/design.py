"""All-Star Movies Resort, compact display kit (resort collection).

Build with the shared kit:  ./build.sh

The compact format (lego-kit/compact.py): a 24 x 16 base with a black front
band; one storey = 4 plates (a course of bricks and a plate band), 1 stud is about 2 m.

The real resort is decorated with giant film characters. This kit shows none of
them on purpose: only the Cinema Hall marquee entrance and two generic movie icons.

Grid (studs): x to the right, z toward the back; the front band is z = 0..1.
  Cinema Hall     x  7..17, z  9..14  movie-palace facade, stepped crown
    marquee       x  8..16, z  6..8   projects over the entrance; the sign blade rises from it
  film reel       x  0..6,  z  5..6   a giant reel standing on edge
  clapperboard    x 18..23, z  5..6   a giant clapperboard
  red carpet      x 11..13, z  2..8   from the band to the doors
"""
import bricks
from bricks import (Model, FACE, row, fill_rect, fill_cells, place_rect,
                    WHITE, BLACK, LBG, RED, GREEN)
from walls import WallRing
from compact import compact_project, display_base, finish_ground

YELLOW, TCLEAR = 14, 47
bricks.COLOR_NAMES.setdefault(YELLOW, "Yellow")
# Bestseller sizes for the colours of this kit (checked with avail.py); a short list of
# sizes keeps the number of part/colour lines down
bricks.ALLOWED[("b", WHITE)] = bricks._sizes("1x1 1x2 1x4 1x6")
bricks.ALLOWED[("b", RED)] = bricks._sizes("1x1 1x2 1x3 1x4")
bricks.ALLOWED[("b", BLACK)] = bricks._sizes("1x1 1x2 2x2 2x4")
bricks.ALLOWED[("b", LBG)] = bricks._sizes("1x2 2x2 2x3")
bricks.ALLOWED[("b", YELLOW)] = bricks._sizes("1x1 1x2")
bricks.ALLOWED[("p", YELLOW)] = bricks._sizes("1x1 1x2 1x3 1x4 1x6")
bricks.ALLOWED[("t", YELLOW)] = bricks._sizes("1x2 1x4")

WALL, TRIM, PLINTH = WHITE, RED, LBG
BOARD, LETTERS, BULBS = WHITE, BLACK, YELLOW
BLADE, REEL, FILM, SLATE, CARPET = RED, LBG, BLACK, BLACK, RED
WINDOW, LOBBY = BLACK, YELLOW

PROJECT = compact_project(
    slug="all_star_movies",
    title="All-Star Movies Resort",
    resort="Disney's All-Star Movies Resort",
    category="Value",
    about=("The Cinema Hall entrance as a classic movie palace: a white facade with red "
           "pilasters and a stepped crown, a big marquee with yellow lights and rows of dark "
           "\"letters\" (no readable text), and a tall red sign blade lined with bulbs. A red "
           "carpet leads to the glass doors, with a giant film reel on one side and a giant "
           "clapperboard on the other. The real resort is decorated with giant film "
           "characters; they are left out on purpose, so this kit is less recognisable than "
           "the others in the collection."),
    features=["The Cinema Hall entrance as a movie-palace facade with red pilasters, tall "
              "windows and a stepped crown",
              "The marquee: a white letter board with rows of dark \"letters\" (no readable "
              "text) between yellow light strips and a row of bulbs",
              "A tall red sign blade lined with yellow bulbs, rising above the roofline",
              "A giant film reel and a giant black-and-white clapperboard",
              "A red carpet to the doors"],
    omitted=["The giant film characters that decorate the real resort (left out on purpose: "
             "no characters, so the kit is less recognisable than the others)",
             "The guest buildings and their themed sections",
             "The pools, the courtyards and the parking lots"],
    colour_rows=[("White", "White", "White"), ("Red", "Bright Red", "Red"),
                 ("Yellow", "Bright Yellow", "Yellow"), ("Black", "Black", "Black"),
                 ("Trans-Clear", "Transparent", "Trans-Clear"),
                 ("Light Bluish Gray", "Medium Stone Grey", "Light Bluish Gray"),
                 ("Green", "Dark Green", "Green")],
    organisation=["The display base, the lawn and the red carpet", "Cinema Hall and its marquee",
                  "The film reel", "The clapperboard"],
    sub_info={
        "cinema.ldr": ("Cinema Hall",
                       "The movie-palace entrance: glass doors, the marquee with its letter "
                       "board and lights, tall windows, the sign blade and the stepped crown."),
        "reel.ldr": ("The film reel",
                     "A giant reel standing on edge, rounded with slopes: a grey flange in "
                     "front with four holes around the hub, and black film behind it."),
        "clapper.ldr": ("The clapperboard",
                        "A black slate with a white chalk line, and the black-and-white "
                        "striped clapper on top."),
    },
    legend=("clapper.ldr", 1),
    tips=["The marquee is built up in thin layers of plates: yellow lights, then the white "
          "letter board with black \"letters\". Lay each layer exactly as in the picture.",
          "The sign blade is a stack of red bricks with a column of round yellow bulbs in "
          "front. The bulbs are only held at the bottom and at the top, so press the cap "
          "on firmly.",
          "Slopes round off the film reel. Check which way each slope faces before pressing "
          "it down."],
    build_time="about 1 to 1&frac12; hours",
)

# ---------------------------------------------------------------- layout
CX, CZ = 7, 6                      # cinema submodel origin (its marquee starts here)
CW, CD0, CD1 = 11, 3, 9            # facade 11 wide; building from local z 3 to 8
RX, RZ, RW, RD = 0, 5, 7, 2        # film reel
KX, KZ, KW, KD = 18, 5, 6, 2       # clapperboard
CARPET_X = (11, 12, 13)


# ---------------------------------------------------------------- cinema hall
def build_cinema():
    m = Model("cinema.ldr", "Cinema Hall")
    W = CW
    fill_rect(m, "p", PLINTH, 0, CD0, W, CD1 - CD0, 0, along="z", widths=[2, 1])
    m.step()
    ring = WallRing([(0, CD0), (W - 1, CD0), (W - 1, CD1 - 1), (0, CD1 - 1)])
    glass = {3, 6}                               # 1x2 clear bricks at x 3..4 and 6..7

    def ground(x, z, layer):
        if z == CD0:
            if x in (0, W - 1):
                return ("b", TRIM)
            if x in (1, W - 2):
                return ("b", BLACK)              # poster cases
            if x in (3, 4, 6, 7):
                return None
        return ("b", WALL)

    for i, L in enumerate((1, 4)):
        ring.course(m, L, i, ground)
        for x in glass:
            m.add("b1x2_open", TCLEAR, x, CD0, L)
            m.add("b1x2", LOBBY, x, CD0 + 1, L)     # the lit lobby behind the doors
        m.step()
    # the marquee deck reaches out over the entrance; the rest of the floor band
    for x in range(1, W - 2, 2):
        place_rect(m, "p", TRIM, x, 0, 2, 4, 7)
    place_rect(m, "p", TRIM, W - 2, 0, 1, 4, 7)
    band = {(x, z) for x in range(W) for z in range(CD0, CD1)
            if x in (0, W - 1) or z == CD1 - 1}
    fill_cells(m, "p", WALL, band, 7)
    m.step()
    _marquee(m)
    # the upper facade: red pilasters and tall windows; the blade is tied in at layer 14
    blade_layers = (14, 17, 20, 23, 26, 29, 32)

    def upper(x, z, layer):
        if z == CD0:
            if x in (0, 2, W - 3, W - 1):
                return ("b", TRIM)
            if layer >= 14 and x in (3, 4, 6, 7):
                return ("b", WINDOW)
            if layer == 14 and x == 5:
                return None
        return ("b", WALL)

    for i, L in enumerate((8, 11, 14, 17)):
        if L == 14:
            m.step("The sign blade starts here: its first brick is part of the wall.")
        ring.course(m, L, i, upper)
        if L == 14:
            m.add("round1", BULBS, 5, 0, 14)
            m.add("b1x3", BLADE, 5, 1, 14, rot=90)
        m.step()
    fill_rect(m, "p", WALL, 0, CD0, W, CD1 - CD0, 20, along="z", widths=[2, 1])
    for L in blade_layers[1:3]:
        m.add("round1", BULBS, 5, 0, L)
        m.add("b1x2", BLADE, 5, 1, L, rot=90)
    m.step()
    # the stepped crown
    crown = WallRing([(0, CD0), (W - 1, CD0), (W - 1, CD1 - 1), (0, CD1 - 1)])
    crown.course(m, 21, 0, lambda x, z, l: ("b", TRIM if (x in (0, W - 1) and z == CD0)
                                            else WALL))
    m.step()
    row(m, "b", WALL, 2, CD0, W - 4, 24)
    row(m, "t", TRIM, 0, CD0, 2, 24)
    row(m, "t", TRIM, W - 2, CD0, 2, 24)
    m.step()
    row(m, "b", WALL, 4, CD0, 3, 27)
    row(m, "t", TRIM, 2, CD0, 2, 27)
    row(m, "t", TRIM, W - 4, CD0, 2, 27)
    m.step()
    row(m, "t", TRIM, 4, CD0, 3, 30)
    # the rest of the sign blade, above the crown
    for L in blade_layers[3:]:
        m.add("round1", BULBS, 5, 0, L)
        m.add("b1x2", BLADE, 5, 1, L, rot=90)
    m.step()
    m.add("p1x3", BLADE, 5, 0, 35, rot=90)
    m.step()
    m.width, m.depth = W, CD1
    return m


def _marquee(m):
    """The marquee: plates in thin layers on the deck (x 1..9, z 0..2)."""
    x0, x1 = 1, 9
    front = list(range(x0, x1 + 1))
    sides = [(x0, 1), (x0, 2), (x1, 1), (x1, 2)]
    letters = {9: "WBBBWBBBW", 11: "WWBBWBBWW"}
    m.step("The marquee: a yellow light strip, then the letter board in thin layers.")
    for L in (8, 9, 10, 11):
        if L in letters:
            for colour, xs in _colour_runs(letters[L], x0):
                row(m, "p", BOARD if colour == "W" else LETTERS, xs[0], 0, len(xs), L)
        else:
            row(m, "p", BULBS if L == 8 else BOARD, x0, 0, len(front), L)
        for x, z in sides[::2]:
            m.add("p1x2", BULBS if L == 8 else BOARD, x, z, L, rot=90)
        if L == 9:
            m.step()
    m.step()
    fill_rect(m, "p", BULBS, x0, 0, len(front), 3, 12, along="x", widths=[1])
    m.step()
    # the top: a row of bulbs along the front, yellow tiles behind, studs for the blade
    for x in front:
        m.add("round_p1", BULBS, x, 0, 13)
    for z in (1, 2):
        row(m, "t", BULBS, x0, z, 4, 13)
        row(m, "t", BULBS, 6, z, 4, 13)
    m.add("p1x2", BULBS, 5, 1, 13, rot=90)
    m.step()


def _colour_runs(pattern, x0):
    out = []
    for i, c in enumerate(pattern):
        if out and out[-1][0] == c:
            out[-1][1].append(x0 + i)
        else:
            out.append((c, [x0 + i]))
    return out


# ---------------------------------------------------------------- film reel
def _reel_slopes(m, x_left, x_right, layer, key):
    """A pair of slopes facing out: grey in the front flange, black (the film) behind."""
    for z, colour in ((0, REEL), (1, FILM)):
        m.add(key, colour, x_left, z, layer, rot=FACE["left"])
        m.add(key, colour, x_right, z, layer, rot=FACE["right"])


def build_reel():
    m = Model("reel.ldr", "Film reel")
    # bottom: two feet, with the bottom hole between them
    _reel_slopes(m, 1, 4, 0, "slope45inv")
    m.step()
    _reel_slopes(m, 0, 5, 3, "slope45inv")
    m.add("b1x2", REEL, 2, 0, 3, rot=90)
    m.add("b1x2", REEL, 4, 0, 3, rot=90)
    m.add("b1x1", FILM, 3, 1, 3)
    m.step()
    # the middle: the hub, with the holes left and right showing the film
    for L in (6, 9):
        for x in (0, 6):
            m.add("b1x2", REEL, x, 0, L, rot=90)
        for x in (1, 5):
            m.add("b1x1", FILM, x, 1, L)
    place_rect(m, "b", REEL, 2, 0, 3, 2, 6)
    m.add("b1x2", REEL, 2, 0, 9, rot=90)
    m.add("b1x2", FILM, 3, 0, 9, rot=90)         # the spindle hole
    m.add("b1x2", REEL, 4, 0, 9, rot=90)
    m.step()
    # top: slopes round it off, with the top hole in the middle
    _reel_slopes(m, 0, 5, 12, "slope45")
    m.add("b1x2", REEL, 2, 0, 12, rot=90)
    m.add("b1x1", FILM, 3, 1, 12)
    m.add("b1x2", REEL, 4, 0, 12, rot=90)
    m.step()
    _reel_slopes(m, 1, 4, 15, "slope45")
    m.add("b1x2", REEL, 3, 0, 15, rot=90)
    place_rect(m, "p", REEL, 2, 0, 3, 2, 18)
    m.step()
    m.width, m.depth = RW, RD
    return m


# ---------------------------------------------------------------- clapperboard
def build_clapper():
    m = Model("clapper.ldr", "Clapperboard")
    place_rect(m, "b", SLATE, 0, 0, 4, 2, 0)
    place_rect(m, "b", SLATE, 4, 0, 2, 2, 0)
    m.step()
    place_rect(m, "p", WHITE, 0, 0, 6, 2, 3)        # a chalk line across the slate
    m.step()
    place_rect(m, "b", SLATE, 0, 0, 2, 2, 4)
    place_rect(m, "b", SLATE, 2, 0, 4, 2, 4)
    m.step()
    # the clapper: a striped stick, a thin gap, then the striped arm offset by one
    for x in range(6):
        m.add("b1x2", WHITE if x % 2 == 0 else SLATE, x, 0, 7, rot=90)
    m.step()
    place_rect(m, "p", SLATE, 0, 0, 6, 2, 10)
    for x in range(6):
        m.add("b1x2", SLATE if x % 2 == 0 else WHITE, x, 0, 11, rot=90)
    m.step()
    m.width, m.depth = KW, KD
    return m


# ---------------------------------------------------------------- main model
def build_main(cinema, reel, clapper):
    m = Model("all_star_movies_compact.ldr", "All-Star Movies Resort (compact)")
    m.header_notes = ["Compact resort collection; generated by design.py (lego-kit)."]
    m.section("The display base", "The base and the black band are the same for every kit in "
              "the collection. The lawn, the paving under the marquee and the red carpet go "
              "on next.")
    band = display_base(m)
    reserved = set(band)
    reserved |= {(CX + x, CZ + z) for x in range(CW) for z in range(CD0, CD1)}
    for (x0, z0, w, d) in ((RX, RZ, RW, RD), (KX, KZ, KW, KD)):
        reserved |= {(x0 + x, z0 + z) for x in range(w) for z in range(d)}

    carpet = {(x, z) for x in CARPET_X for z in range(2, CZ + CD0)}
    reserved |= carpet

    def colour_at(x, z):
        if CX <= x < CX + CW and CZ <= z < CZ + CD0:
            return LBG                            # paving under the marquee
        return GREEN
    finish_ground(m, reserved, GREEN, colour_at=colour_at)
    for x in CARPET_X:                            # the red carpet, in runs toward the doors
        row(m, "t", CARPET, x, 2, CZ + CD0 - 2, 1, axis="z", sizes=[4, 3])
    m.step()
    m.sub(cinema, CX, CZ, 1)
    m.step()
    m.sub(reel, RX, RZ, 1)
    m.step()
    m.sub(clapper, KX, KZ, 1)
    m.step()
    return m


def build():
    cinema, reel, clapper = build_cinema(), build_reel(), build_clapper()
    main_m = build_main(cinema, reel, clapper)
    return main_m, [main_m, cinema, reel, clapper]
