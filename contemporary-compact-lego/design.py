"""Contemporary Resort, compact display kit (resort collection).

Build with the shared kit:  ./build.sh

The compact format (lego-kit/compact.py): a 24 x 16 base with a black front
band; one storey = 4 plates (a course of bricks and a plate band), 1 stud is about 2 m.

Grid (studs): x to the right, z toward the back; the front band is z = 0..1.
  A-frame tower  x  4..19, z 7..14   the front end of the A-frame and a short length of
                 it: nine storeys, every second one a stud narrower on both sides, so
                 the end is a trapezoid and the long sides step up in balcony rows;
                 a glass top floor on the roof
  monorail beam  x 11..12, z 1..15   on a pylon at z = 4, through the tower halfway up
                 (on the band under storey 5) and out of the back wall
  monorail train x 11..12, z 2..9    on the beam, its nose out of a white portal in
                 the front end
  palms          (3, 3) and (20, 3)
"""
from bricks import Model, WHITE, BLACK, DBG, LBG, BLUE, GREEN, row, rect_key, fill_rect
from walls import WallRing
from compact import compact_project, display_base, finish_ground, storey_layer, palm

FRAME, GLASS, BALCONY, BEAM, STRIPE, PLINTH = WHITE, BLACK, DBG, LBG, BLUE, LBG

PROJECT = compact_project(
    slug="contemporary",
    title="Contemporary Resort",
    resort="Disney's Contemporary Resort",
    category="Deluxe",
    merged=["Bay Lake Tower at Disney's Contemporary Resort"],
    about=("The front end of the Contemporary's A-frame tower: a tall white trapezoid of "
           "glass and frame whose long sides step up in rows of dark balconies, with the "
           "monorail beam running straight through the building halfway up and a white "
           "monorail train with a blue stripe coming out of the front. Two palms stand on "
           "the lawn."),
    features=["The A-frame tower: a trapezoid from the front, its long sides stepped in "
              "rows of dark balconies between white bands",
              "The end wall: a white sloping frame round dark glass, and the glass top floor",
              "The monorail beam running straight through the building halfway up, on a "
              "pylon",
              "A white monorail train with a blue stripe coming out of the front end",
              "Two palms on the lawn"],
    omitted=["Most of the A-frame's length (the kit shows its front end and a short length)",
             "The Garden Wing, Bay Lake Tower and the convention centre",
             "Bay Lake, the marina and the parking lots"],
    colour_rows=[("White", "White", "White"), ("Black", "Black", "Black"),
                 ("Dark Bluish Gray", "Dark Stone Grey", "Dark Bluish Gray"),
                 ("Light Bluish Gray", "Medium Stone Grey", "Light Bluish Gray"),
                 ("Blue", "Bright Blue", "Blue"), ("Green", "Dark Green", "Green")],
    organisation=["The display base and the lawn", "The A-frame tower",
                  "The monorail and the palms (build 2)"],
    sub_info={
        "tower.ldr": ("The A-frame tower",
                      "Nine storeys; every second one is a stud narrower on both sides. "
                      "The monorail beam goes in halfway up, before the fifth storey, and "
                      "a glass top floor finishes the roof."),
        "monorail.ldr": ("The monorail train",
                         "A white train with a blue stripe and a dark windscreen."),
        "palm.ldr": ("The palms", "A trunk of round bricks and two layers of fronds."),
    },
    legend=("monorail.ldr", 1),
    tips=["Each storey is one course of bricks, then a band of white plates. The end walls "
          "are white at the edges and black (the glass) in between; the long sides are dark "
          "grey (the balconies). Keep the three colours in separate trays.",
          "Every second storey is a stud narrower on both sides. The white tiles on each "
          "step are the balcony fronts.",
          "The monorail beam is built into the tower before the fifth storey, so the train "
          "can run straight through it.",
          "A <b>&ldquo;Build 2&rdquo;</b> badge means you build that module twice."],
    build_time="about 1 to 1&frac12; hours",
)

W, D, N = 16, 8, 9                  # tower width, depth, storeys
TX, TZ = 4, 7                       # tower corner on the base
BX = (7, 8)                         # beam cells (tower x)
OPEN = {6, 7, 8, 9}                 # front opening for the train (tower x)
BEAM_STOREY = 5                     # the beam lies on the band under this storey
PYLON_Z = 4
PALMS = ((3, 3), (20, 3))


def place_rect(m, kind, colour, x, z, sx, sz, layer):
    """A sx by sz plate or tile (sizes checked with avail.py, not the kit's short list)."""
    key, rot = rect_key(kind, sx, sz)
    return m.add(key, colour, x, z, layer, rot=rot)


def span(f):
    """Leftmost and rightmost cell of storey f: one stud in on each side every two storeys."""
    a = (f - 1) // 2
    return a, W - 1 - a


def tower_mat(x, z, f, a, b):
    front, back = z == 0, z == D - 1
    if front or back:
        if front and f in (BEAM_STOREY, BEAM_STOREY + 1):
            if x in OPEN:
                return None
            if x in (min(OPEN) - 1, max(OPEN) + 1):
                return FRAME                    # the white portal round the opening
        if back and f == BEAM_STOREY and x in BX:
            return None
        if x in (a, a + 1, b - 1, b):
            return FRAME
        return GLASS
    return BALCONY


def build_tower():
    m = Model("tower.ldr", "A-frame tower")
    fill_rect(m, "p", PLINTH, 0, 0, W, D, 0, along="z")
    m.step()
    for f in range(1, N + 1):
        a, b = span(f)
        L = storey_layer(f)
        if f == BEAM_STOREY:
            # the monorail beam rests on the floor band of the front and back walls
            m.step("The monorail beam goes in now. It rests on the front and back walls.")
            place_rect(m, "p", BEAM, BX[0], 0, 2, D, L)
            for x in OPEN - set(BX):
                m.add("t1x1", FRAME, x, 0, L)
            m.step()
            m.add("p1x2", BEAM, BX[0], D, L)            # under the end that sticks out
            place_rect(m, "p", BEAM, BX[0], 1, 2, D, L + 1)
            m.add("p1x2", FRAME, BX[0], D - 1, L + 2)
            m.add("t1x2", BEAM, BX[0], D, L + 2)
            m.step()
        ring = WallRing([(a, 0), (b, 0), (b, D - 1), (a, D - 1)])

        def mat(x, z, layer, f=f, a=a, b=b):
            c = tower_mat(x, z, f, a, b)
            return None if c is None else ("b", c)
        ring.course(m, L, f % 2, mat)
        m.step()
        Lb = L + 3
        if f < N:
            place_rect(m, "p", FRAME, a, 0, 2, D, Lb)
            place_rect(m, "p", FRAME, b - 1, 0, 2, D, Lb)
            for z in (0, D - 1):
                xs = [x for x in range(a + 2, b - 1)
                      if not (z == 0 and f == BEAM_STOREY and x in OPEN)]
                for run in _runs(xs):
                    row(m, "p", FRAME, run[0], z, len(run), Lb)
            if span(f + 1)[0] > a:
                # the next storey steps in: white tiles on the step are the balcony fronts
                for x in (a, b):
                    m.add("t1x8", FRAME, x, 0, Lb + 1, rot=90)
        else:
            fill_rect(m, "p", FRAME, a, 0, b - a + 1, D, Lb, along="z")
        m.step()
    # the top floor (California Grill): a glass box on the roof
    top = storey_layer(N) + 4
    a, b = span(N)
    ring = WallRing([(a + 1, 1), (b - 1, 1), (b - 1, D - 2), (a + 1, D - 2)])
    ring.course(m, top, 0, lambda x, z, layer: ("b", GLASS))
    for x in (a, b):
        m.add("t1x8", FRAME, x, 0, top, rot=90)
    for z in (0, D - 1):
        row(m, "t", FRAME, a + 1, z, b - a - 1, top)
    m.step()
    fill_rect(m, "p", FRAME, a + 1, 1, b - a - 1, D - 2, top + 3)
    m.step()
    for z in range(1, D - 1):
        row(m, "t", FRAME, a + 1, z, b - a - 1, top + 4)
    m.step()
    m.width, m.depth = W, D
    return m


def _runs(xs):
    out = []
    for x in xs:
        if out and out[-1][-1] == x - 1:
            out[-1].append(x)
        else:
            out.append([x])
    return out


def build_train():
    """Two studs wide, nose toward the front (z = 0)."""
    m = Model("monorail.ldr", "Monorail train")
    place_rect(m, "p", STRIPE, 0, 0, 2, 6, 0)
    place_rect(m, "p", STRIPE, 0, 6, 2, 2, 0)
    m.step()
    m.add("s45x2", GLASS, 0, 0, 1)
    for z in range(2, 8):
        m.add("b1x2", GLASS if z % 3 else FRAME, 0, z, 1)
    m.step()
    m.add("curve2x1", FRAME, 0, 1, 4)
    m.add("curve2x1", FRAME, 1, 1, 4)
    for x in (0, 1):
        m.add("t1x4", FRAME, x, 3, 4, rot=90)
    m.step()
    m.width, m.depth = 2, 8
    return m


def build_main(tower, train, tree):
    m = Model("contemporary_compact.ldr", "Contemporary Resort (compact)")
    m.header_notes = ["Compact resort collection; generated by design.py (lego-kit)."]
    m.section("The display base", "The base and the black band are the same for every kit in "
              "the collection. The lawn and a grey forecourt under the monorail go on next.")
    band = display_base(m)
    pylon = {(TX + BX[0], PYLON_Z), (TX + BX[1], PYLON_Z)}
    reserved = set(band) | pylon | set(PALMS)
    reserved |= {(TX + x, TZ + z) for x in range(W) for z in range(D)}

    def ground(x, z):
        return LBG if 9 <= x <= 14 and z < TZ else GREEN
    finish_ground(m, reserved, GREEN, colour_at=ground)
    m.step()
    m.sub(tower, TX, TZ, 1)
    m.step()
    m.section("The monorail and the palms", "A pylon and a light grey beam in front of the "
              "tower, joined to the beam inside it, the train on top, and two palms.")
    L = 1 + storey_layer(BEAM_STOREY)            # beam bottom on the base
    bricks = (L - 1) // 3
    for k in range(bricks):
        m.add("b1x2", BEAM, TX + BX[0], PYLON_Z, 1 + 3 * k)
    for k in range((L - 1) % 3):
        m.add("p1x2", BEAM, TX + BX[0], PYLON_Z, 1 + 3 * bricks + k)
    m.step()
    place_rect(m, "p", BEAM, TX + BX[0], 1, 2, 6, L)
    m.step()
    place_rect(m, "p", BEAM, TX + BX[0], 2, 2, 6, L + 1)
    m.add("t1x2", BEAM, TX + BX[0], 1, L + 1)
    m.step()
    m.sub(train, TX + BX[0], 2, L + 2)
    m.step()
    for px, pz in PALMS:
        m.sub(tree, px, pz, 1)
    m.step()
    return m


def build():
    tower, train, tree = build_tower(), build_train(), palm()
    main_m = build_main(tower, train, tree)
    return main_m, [main_m, tower, train, tree]
