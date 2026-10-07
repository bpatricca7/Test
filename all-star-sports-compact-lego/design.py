"""All-Star Sports Resort, compact display kit (resort collection).

Build with the shared kit:  ./build.sh

The compact format (lego-kit/compact.py): a 24 x 16 base with a black front
band; one storey = 4 plates (a course of bricks and a plate band), 1 stud is about 2 m.

Grid (studs): x to the right, z toward the back; the front band is z = 0..1.
  guest building  x 4..19, z 7..12   three storeys; open walkways with teal railings
                                     along the front (z = 7), a red and yellow roof trim
  surfboards      x 20..23, z 8..9   the right stair tower: three giant surfboards
  tennis racket   x 0..3, z 8        the left stair tower: a giant racket
  walk            x 11..12, z 2..6
No team logos, brand names or characters: generic sports shapes only.
"""
import bricks
from bricks import Model, row, fill_rect, fill_cells, WHITE, BLACK, LBG, RED, GREEN
from walls import WallRing
from compact import compact_project, display_base, finish_ground, storey_layer

YELLOW, AZURE = 14, 322
bricks.COLOR_NAMES.setdefault(YELLOW, "Yellow")

WALL, DOOR, PLINTH, GRIP, ROOF = WHITE, BLACK, LBG, BLACK, LBG
RAIL, TRIM, CAP = AZURE, RED, YELLOW
FRAME = YELLOW                  # the racket frame
HANDLE, STRINGS = 2, 4          # racket: handle bricks, rows of strings
CORE = 5                        # bricks in the stair core behind the surfboards

PROJECT = compact_project(
    slug="all_star_sports",
    title="All-Star Sports Resort",
    resort="Disney's All-Star Sports Resort",
    category="Value",
    about=("A short section of an All-Star Sports guest building: three bright storeys with "
           "open walkways behind teal railings under a red and yellow roof trim, with giant "
           "sports icons at its ends: a stair tower clad with three tall surfboards, and a "
           "giant tennis racket."),
    features=["Three-storey guest building with open walkways behind teal railings",
              "Red and yellow roof trim around a flat grey roof",
              "A stair tower clad with three giant surfboards in red, yellow and teal",
              "A giant tennis racket with white strings at the other end"],
    omitted=["The rest of the long guest buildings and the other themed sections",
             "The pools, the food court and the main building",
             "Team logos, brand names and characters (generic sports shapes only)"],
    colour_rows=[("White", "White", "White"), ("Red", "Bright Red", "Red"),
                 ("Yellow", "Bright Yellow", "Yellow"),
                 ("Medium Azure", "Medium Azur", "Medium Azure"),
                 ("Black", "Black", "Black"),
                 ("Light Bluish Gray", "Medium Stone Grey", "Light Bluish Gray"),
                 ("Green", "Dark Green", "Green")],
    organisation=["The display base and the lawn", "The guest building", "The surfboards",
                  "The tennis racket"],
    sub_info={
        "guest.ldr": ("The guest building",
                      "Three storeys of rooms with open walkways and teal railings along the "
                      "front, then the flat roof with its red and yellow parapet."),
        "surf.ldr": ("The surfboards",
                     "A white stair core on a pedestal, clad with three giant surfboards."),
        "racket.ldr": ("The tennis racket",
                       "A black and red handle, a V-shaped throat and a yellow frame with "
                       "white strings."),
    },
    legend=("surf.ldr", 3),
    tips=["Each storey is one course of white bricks with black bricks for the doors and "
          "windows, then a band of plates. Along the front the band is teal: it is the "
          "walkway, with a teal railing on its edge.",
          "Each surfboard is a stack of 1 x 2 bricks with a stripe and a pointed nose of two "
          "small slopes. Two of them face the sides of the stair core.",
          "The racket strings are white bricks with grooves."],
    build_time="about 1 to 1&frac12; hours",
)

GW, GD, FLOORS = 16, 6, 3       # guest building; the walkway is its row z = 0
GX, GZ = 4, 7                   # its corner on the base
FRONT_OPEN = {1, 3, 5, 7, 8, 10, 12, 14}   # doors and windows along the walkway
SURF = (20, 7)                  # the surfboard stair tower, right of the building
RACKET = (0, 8)                 # the racket, left of the building
WALK = (11, 12)


def build_guest():
    m = Model("guest.ldr", "Guest building")
    w, d = GW, GD
    fill_rect(m, "p", PLINTH, 0, 0, w, d, 0, along="x")
    m.step()
    ring = WallRing([(0, 1), (w - 1, 1), (w - 1, d - 1), (0, d - 1)])
    ring_cells = {(x, z) for x in range(w) for z in range(1, d)
                  if x in (0, w - 1) or z in (1, d - 1)}

    def mat(x, z, layer):
        if z == 1:
            return ("b", DOOR if x in FRONT_OPEN else WALL)
        if x in (0, w - 1) and z == 3:
            return ("b", DOOR)
        if z == d - 1 and x in (2, 5, 10, 13):
            return ("b", DOOR)
        return ("b", WALL)

    for f in range(1, FLOORS + 1):
        L = storey_layer(f)
        ring.course(m, L, f % 2, mat)
        m.step()
        if f < FLOORS:
            # the walkway: the floor band runs out over the open row in front
            fill_cells(m, "p", WALL, ring_cells | {(x, 0) for x in range(w)}, L + 3)
            m.step()
            row(m, "t", RAIL, 0, 0, w, L + 4, sizes=[4])       # teal railing
        else:
            fill_rect(m, "p", WALL, 0, 0, w, d, L + 3, along="x")
        m.step()
    # the roof trim: a red band with a yellow cap
    top = storey_layer(FLOORS) + 4
    edge = {(x, z) for x in range(w) for z in range(d) if x in (0, w - 1) or z in (0, d - 1)}
    fill_cells(m, "p", TRIM, edge, top)
    m.step()
    fill_cells(m, "t", CAP, edge, top + 1)
    fill_cells(m, "t", ROOF, {(x, z) for x in range(1, w - 1) for z in range(1, d - 1)}, top,
               sizes={2: [2]})
    m.step()
    m.width, m.depth = w, d
    return m


def board(m, x, z, colour, stripe, n, axis="x", nose=None, L=1):
    """A giant surfboard: n courses of 1 x 2 bricks with a stripe below a pointed nose.

    axis "x": the board faces the front (it runs along x); "z": it faces the side.
    """
    nose = nose or colour
    rot = 0 if axis == "x" else 90
    for k in range(n):
        if k == n - 2:
            m.add("p1x2", stripe, x, z, L, rot=rot)
            m.add("p1x2", stripe, x, z, L + 1, rot=rot)
            m.add("p1x2", colour, x, z, L + 2, rot=rot)
        else:
            m.add("b1x2", colour, x, z, L, rot=rot)
        L += 3
    if axis == "x":
        m.add("cheese", nose, x, z, L, rot=90)
        m.add("cheese", nose, x + 1, z, L, rot=270)
    else:
        m.add("cheese", nose, x, z, L, rot=0)
        m.add("cheese", nose, x, z + 1, L, rot=180)


def build_surf():
    """The stair tower: a white core clad with three giant surfboards."""
    m = Model("surf.ldr", "Surfboards")
    m.add("p4x4", WALL, 0, 0, 0)
    m.step()
    for k in range(CORE):
        m.add("b2x2", WALL, 1, 1, 1 + 3 * k)
    m.add("t2x2", CAP, 1, 1, 1 + 3 * CORE)
    m.step()
    board(m, 0, 1, RAIL, WALL, 6, axis="z", nose=WALL)
    m.step()
    board(m, 3, 1, YELLOW, RED, 7, axis="z")
    m.step()
    board(m, 1, 0, RED, WALL, 5)
    m.step()
    m.width, m.depth = 4, 4
    return m


def build_racket():
    """A giant tennis racket standing on its handle, face to the front."""
    m = Model("racket.ldr", "Tennis racket")
    for k in range(HANDLE):
        m.add("b1x2", GRIP if k < HANDLE - 1 else TRIM, 1, 0, 3 * k)
    m.step()
    # the throat: two inverted slopes make the V under the head
    L = 3 * HANDLE
    m.add("slope45inv", FRAME, 0, 0, L, rot=90)
    m.add("slope45inv", FRAME, 2, 0, L, rot=270)
    m.step()
    for k in range(STRINGS):
        L += 3
        m.add("b1x1", FRAME, 0, 0, L)
        m.add("grille1x2", WALL, 1, 0, L)
        m.add("b1x1", FRAME, 3, 0, L)
    m.step()
    L += 3
    m.add("cheese", FRAME, 0, 0, L, rot=90)
    m.add("p1x2", FRAME, 1, 0, L)
    m.add("t1x2", FRAME, 1, 0, L + 1)
    m.add("cheese", FRAME, 3, 0, L, rot=270)
    m.step()
    m.width, m.depth = 4, 1
    return m


def build_main(guest, surf, racket):
    m = Model("all_star_sports_compact.ldr", "All-Star Sports Resort (compact)")
    m.header_notes = ["Compact resort collection; generated by design.py (lego-kit)."]
    m.section("The display base", "The base and the black band are the same for every kit in "
              "the collection. The lawn and the walk to the building go on next.")
    band = display_base(m)
    reserved = set(band)
    reserved |= {(GX + x, GZ + z) for x in range(GW) for z in range(GD)}
    reserved |= {(SURF[0] + x, SURF[1] + z) for x in range(4) for z in range(4)}
    reserved |= {(RACKET[0] + x, RACKET[1]) for x in (1, 2)}
    finish_ground(m, reserved, GREEN,
                  colour_at=lambda x, z: LBG if x in WALK and z < GZ else GREEN)
    m.step()
    m.sub(guest, GX, GZ, 1)
    m.step()
    m.sub(surf, *SURF, 1)
    m.step()
    m.sub(racket, *RACKET, 1)
    m.step()
    return m


def build():
    guest, surf, racket = build_guest(), build_surf(), build_racket()
    main_m = build_main(guest, surf, racket)
    return main_m, [main_m, guest, surf, racket]
