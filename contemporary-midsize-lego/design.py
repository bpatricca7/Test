"""Contemporary Resort, mid-size display kit (resort collection).

Build with the shared kit:  ./build.sh

The mid-size format (lego-kit/compact.py, size="midsize"): a 32 x 24 base with a
black front band; one storey = 4 plates (a course of bricks and a plate band),
1 stud is about 2 m, the same scale as the compact kit (contemporary-compact-lego).

Grid (studs): x to the right, z toward the back; the front band is z = 0..1.
  A-frame tower  x  6..25, z 12..21   the front end of the A-frame and a longer length of
                 it than the compact kit: twelve storeys, every second one a stud narrower
                 on both sides; above the beam the end walls are the tall glass wall of
                 the Grand Canyon Concourse; a glass top floor on the roof
  monorail beam  x 15..16, z 0..23    the whole depth of the base: on a pylon in front
                 (z = 4) and one behind (z = 23), through both end walls under storey 5
  monorail train x 15..16, z 1..13    two cars with a dark gangway between them, coming
                 out of the front portal
  forecourt      z 2..11 in front of the tower: paving, and a lawn with shrubs under the
                 monorail
  palms          (3, 4), (28, 4), (3, 16) and (28, 17)
"""
from bricks import Model, WHITE, BLACK, DBG, LBG, BLUE, GREEN, row, rect_key
from walls import WallRing
from compact import compact_project, display_base, finish_ground, storey_layer, palm

FRAME, GLASS, BALCONY, BEAM, STRIPE, PLINTH, PAVING = WHITE, BLACK, DBG, LBG, BLUE, LBG, LBG
SIZE = "midsize"

PROJECT = compact_project(
    size=SIZE,
    slug="contemporary",
    title="Contemporary Resort",
    resort="Disney's Contemporary Resort",
    category="Deluxe",
    merged=["Bay Lake Tower at Disney's Contemporary Resort"],
    about=("The front end and a longer length of the Contemporary's A-frame tower: twelve "
           "storeys whose long sides step up in rows of dark balconies, and an end wall where "
           "the tall dark glass of the Grand Canyon Concourse rises in a white sloping frame. "
           "The monorail beam runs the whole depth of the display, straight through the "
           "building and out of both ends, and a two-car white monorail train with a blue "
           "stripe comes out of the front. Four palms stand round a paved forecourt."),
    features=["The A-frame tower: twelve storeys, a trapezoid from the front, its long sides "
              "stepped in twelve rows of dark balconies between white bands",
              "Both end walls: the tall glass wall of the Grand Canyon Concourse in a white "
              "sloping frame, over four lower floors",
              "A two-storey portal in each end wall, with the monorail beam running straight "
              "through the building and out of both ends, on two pylons",
              "A two-car white monorail train with a blue stripe coming out of the front",
              "The glass top floor on the roof",
              "A paved forecourt with a lawn and shrubs under the monorail, and four palms"],
    omitted=["The rest of the A-frame's length",
             "The Garden Wing, Bay Lake Tower and the convention centre",
             "Bay Lake, the marina and the parking lots"],
    colour_rows=[("White", "White", "White"), ("Black", "Black", "Black"),
                 ("Dark Bluish Gray", "Dark Stone Grey", "Dark Bluish Gray"),
                 ("Light Bluish Gray", "Medium Stone Grey", "Light Bluish Gray"),
                 ("Blue", "Bright Blue", "Blue"), ("Green", "Dark Green", "Green")],
    organisation=["The display base and the forecourt", "The A-frame tower",
                  "The monorail, the train and the palms (build 4)"],
    sub_info={
        "tower.ldr": ("The A-frame tower",
                      "Twelve storeys; every second one is a stud narrower on both long "
                      "sides. The monorail beam goes in before the fifth storey; above it the "
                      "end walls are the tall glass of the Grand Canyon Concourse. A glass "
                      "top floor finishes the roof."),
        "car_lead.ldr": ("The lead car", "A white car with a blue stripe and a dark "
                         "windscreen."),
        "car.ldr": ("The second car", "A white car with a blue stripe."),
        "palm.ldr": ("The palms", "A trunk of round bricks and two layers of fronds."),
    },
    legend=("car_lead.ldr", 1),
    tips=["Each storey is one course of bricks, then a band of plates. The end walls are "
          "white at the edges and black (the glass) in between; the long sides are dark grey "
          "(the balconies). Keep the three colours in separate trays.",
          "Every second storey is a stud narrower on both long sides. The white tiles on "
          "each step are the balcony fronts.",
          "The monorail beam is built into the tower before the fifth storey, so the train "
          "can run straight through it. Above it, the bands across the glass are black.",
          "A <b>&ldquo;Build 4&rdquo;</b> badge means you build that module four times."],
    build_time="about 2 to 2&frac12; hours",
)

W, D, N = 20, 10, 12                # tower width (x), length (z) and storeys
TX, TZ = 6, 12                      # tower corner on the base
BX = (9, 10)                        # beam cells (tower x)
OPEN = {8, 9, 10, 11}               # the portals in both end walls (tower x)
PORTAL = {7, 12}                    # the portal's white sides
BEAM_STOREY = 5                     # the beam lies on the band under this storey
PYLONS = (4, 23)                    # pylon z on the base
PALMS = ((3, 4), (28, 4), (3, 16), (28, 17))   # fronds stay inside the base
SHRUBS = ((13, 2), (13, 5), (13, 8), (18, 2), (18, 5), (18, 8),
          (1, 9), (30, 9), (1, 21), (30, 21))
LEAD, CAR = 6, 6                    # car lengths
TRAIN_Z = 1                         # the lead car's nose


def place_rect(m, kind, colour, x, z, sx, sz, layer):
    """A sx by sz plate or tile (sizes checked with avail.py, not the kit's short list)."""
    key, rot = rect_key(kind, sx, sz)
    return m.add(key, colour, x, z, layer, rot=rot)


def span(f):
    """Leftmost and rightmost cell of storey f: one stud in on each side every two storeys."""
    a = (f - 1) // 2
    return a, W - 1 - a


def concourse(f):
    """Storeys whose end walls are the tall glass wall of the Grand Canyon Concourse."""
    return f >= BEAM_STOREY


def tower_mat(x, z, f, a, b):
    if z in (0, D - 1):                         # the end walls
        if f in (BEAM_STOREY, BEAM_STOREY + 1):
            if x in OPEN:
                return None
            if x in PORTAL:
                return FRAME                    # the white portal round the opening
        if x in (a, a + 1, b - 1, b):
            return FRAME
        return GLASS
    return BALCONY


def band_colour(x, f):
    """Colour of the end-wall band cell above storey f (between f and f + 1)."""
    if f == BEAM_STOREY + 1 and x in OPEN:
        return FRAME                            # the lintel over the portal
    if x in PORTAL and f in (BEAM_STOREY, BEAM_STOREY + 1):
        return FRAME
    if concourse(f) and concourse(f + 1):
        return GLASS
    return FRAME


def _runs(xs, key=lambda x: 0):
    """Runs of consecutive cells with the same key."""
    out = []
    for x in xs:
        if out and out[-1][-1] == x - 1 and key(out[-1][-1]) == key(x):
            out[-1].append(x)
        else:
            out.append([x])
    return out


def strip(m, colour, x, z0, sizes, layer):
    """A 2-wide run of plates along z from z0, in the given lengths."""
    z = z0
    for s in sizes:
        place_rect(m, "p", colour, x, z, 2, s, layer)
        z += s


def edge(m, x, layer):
    """White tiles along a long side, on a step: the balcony fronts."""
    m.add("t1x6", FRAME, x, 0, layer, rot=90)
    m.add("t1x4", FRAME, x, 6, layer, rot=90)


def build_tower():
    m = Model("tower.ldr", "A-frame tower")
    # the plinth: a ring of plates under the walls
    for z in (0, D - 2):
        for x in (0, W // 2):
            place_rect(m, "p", PLINTH, x, z, W // 2, 2, 0)
    for x in (0, W - 2):
        place_rect(m, "p", PLINTH, x, 2, 2, D - 4, 0)
    m.step()
    for f in range(1, N + 1):
        a, b = span(f)
        Lc = storey_layer(f)
        if f == BEAM_STOREY:
            m.step("The monorail beam goes in now. It rests on the two end walls.")
            strip(m, BEAM, BX[0], 0, (D,), Lc)
            for z in (0, D - 1):
                for x in OPEN - set(BX):
                    m.add("t1x1", FRAME, x, z, Lc)
            m.step()
            strip(m, BEAM, BX[0], 1, (D - 2,), Lc + 1)
            m.step()
        ring = WallRing([(a, 0), (b, 0), (b, D - 1), (a, D - 1)])

        def mat(x, z, layer, f=f, a=a, b=b):
            c = tower_mat(x, z, f, a, b)
            return None if c is None else ("b", c)
        ring.course(m, Lc, f % 2, mat)
        m.step()
        Lb = Lc + 3
        if f == BEAM_STOREY:
            m.step("From here up, the bands between the glass on the end walls are black: "
                   "the tall glass wall of the Grand Canyon Concourse.")
        if f < N:
            strip(m, FRAME, a, 0, (D,), Lb)
            strip(m, FRAME, b - 1, 0, (D,), Lb)
            for z in (0, D - 1):
                xs = [x for x in range(a + 2, b - 1)
                      if not (f == BEAM_STOREY and x in OPEN)]
                for run in _runs(xs, key=lambda x, f=f: band_colour(x, f)):
                    row(m, "p", band_colour(run[0], f), run[0], z, len(run), Lb)
            if span(f + 1)[0] > a:
                # the next storey steps in: white tiles on the step are the balcony fronts
                for x in (a, b):
                    edge(m, x, Lb + 1)
        else:
            for x in range(a, b + 1, 2):            # the roof: 2 x 10 plates side by side
                strip(m, FRAME, x, 0, (D,), Lb)
        m.step()
    # the top floor (California Grill): a glass box on the roof
    top = storey_layer(N) + 4
    a, b = span(N)
    ring = WallRing([(a + 1, 1), (b - 1, 1), (b - 1, D - 2), (a + 1, D - 2)])
    ring.course(m, top, 0, lambda x, z, layer: ("b", GLASS))
    for x in (a, b):
        edge(m, x, top)
    for z in (0, D - 1):
        row(m, "t", FRAME, a + 1, z, b - a - 1, top)
    m.step()
    for x in range(a + 1, b, 2):
        strip(m, FRAME, x, 1, (D - 2,), top + 3)
    m.step()
    for z in range(1, D - 1):
        row(m, "t", FRAME, a + 1, z, b - a - 1, top + 4)
    m.step()
    m.width, m.depth = W, D
    return m


def build_car(lead):
    """Two studs wide, its length along z; the lead car's nose points to the front."""
    n = LEAD if lead else CAR
    m = Model("car_lead.ldr" if lead else "car.ldr",
              "Monorail lead car" if lead else "Monorail car")
    strip(m, STRIPE, 0, 0, (n,), 0)
    m.step()
    z0 = 2 if lead else 0
    if lead:
        m.add("s45x2", GLASS, 0, 0, 1)
    for z in range(z0, n):
        m.add("b1x2", GLASS if (z + (0 if lead else 1)) % 3 else FRAME, 0, z, 1)
    m.step()
    if lead:
        for x in (0, 1):
            m.add("curve2x1", FRAME, x, 1, 4)
            m.add("t1x2", FRAME, x, 3, 4, rot=90)
            m.add("t1x1", FRAME, x, 5, 4)
    else:
        for x in (0, 1):
            m.add("t1x6", FRAME, x, 0, 4, rot=90)
    m.step()
    m.width, m.depth = 2, n
    return m


def build_main(tower, lead, car, tree):
    m = Model("contemporary_midsize.ldr", "Contemporary Resort (mid-size)")
    m.header_notes = ["Mid-size resort collection; generated by design.py (lego-kit)."]
    m.section("The display base and the forecourt", "The base and the black band are the "
              "same for every mid-size kit in the collection. The paved forecourt and the lawn "
              "under the monorail go on next, then the tower and the lawns round it.")
    band = display_base(m, SIZE)
    bx = TX + BX[0]
    pylons = {(bx + k, z) for z in PYLONS for k in (0, 1)}
    reserved = set(band) | pylons | set(PALMS)
    reserved |= {(TX + x, TZ + z) for x in range(W) for z in range(D)}

    def ground(x, z):
        if z < TZ - 2 and bx - 2 <= x <= bx + 3:
            return GREEN                            # the lawn under the monorail
        if z < TZ and TX <= x < TX + W:
            return PAVING
        return GREEN
    # the forecourt, then the tower (it ties the back plates together), then the lawns
    # round it
    back_half = {(x, z) for x in range(32) for z in range(TZ, 24)}
    finish_ground(m, reserved | back_half, GREEN, colour_at=ground, size=SIZE)
    m.step()
    m.sub(tower, TX, TZ, 1)
    m.step()
    front_half = {(x, z) for x in range(32) for z in range(TZ)}
    finish_ground(m, reserved | front_half, GREEN, colour_at=ground, size=SIZE)
    m.step()
    m.section("The monorail, the train and the palms", "Two pylons and the light grey beam "
              "in front of and behind the tower, joined to the beam inside it, the two-car "
              "train on top, then the palms and the shrubs.")
    Lw = 1 + storey_layer(BEAM_STOREY)            # beam bottom on the base
    bricks = (Lw - 1) // 3
    for pz in PYLONS:
        for k in range(bricks):
            m.add("b1x2", BEAM, bx, pz, 1 + 3 * k)
        for k in range((Lw - 1) % 3):
            m.add("p1x2", BEAM, bx, pz, 1 + 3 * bricks + k)
    m.step()
    back = TZ + D                                 # first beam cell behind the tower
    strip(m, BEAM, bx, 0, (6, TZ - 6), Lw)
    strip(m, BEAM, bx, back, (24 - back,), Lw)
    m.step()
    m.add("t1x2", BEAM, bx, 0, Lw + 1)
    strip(m, BEAM, bx, 1, (6, TZ - 6), Lw + 1)
    strip(m, BEAM, bx, back - 1, (25 - back,), Lw + 1)
    m.step()
    m.sub(lead, bx, TRAIN_Z, Lw + 2)
    m.add("t1x2", GLASS, bx, TRAIN_Z + LEAD, Lw + 2)       # the gangway between the cars
    m.sub(car, bx, TRAIN_Z + LEAD + 1, Lw + 2)
    for x in (bx, bx + 1):
        m.add("t1x2", BEAM, x, back, Lw + 2, rot=90)
    m.step()
    for px, pz in PALMS:
        m.sub(tree, px, pz, 1)
    for x, z in SHRUBS:
        m.add("leaves1", GREEN, x, z, 2)
    m.step()
    return m


def build():
    tower, lead, car, tree = build_tower(), build_car(True), build_car(False), palm()
    main_m = build_main(tower, lead, car, tree)
    return main_m, [main_m, tower, lead, car, tree]
