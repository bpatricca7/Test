"""Polynesian Village Resort, compact display kit (resort collection).

Build with the shared kit:  ./build.sh

The compact format (lego-kit/compact.py): a 24 x 16 base with a black front
band; one storey = 4 plates (a course of bricks and a plate band), 1 stud is about 2 m.

Grid (studs): x to the right, z toward the back; the front band is z = 0..1.
  Great Ceremonial House  x 7..16, z 4..13   a longhouse with a low storey of timber and
                          glass under a very steep A-frame roof: four courses of
                          65-degree tan slopes, each on a dark tan tie plate (the layers
                          of thatch); the dark timber gable at the front with a tall
                          window over the door, and the ridge beam sticking out over it
  forecourt               x 6..17, z 2..3, sand-coloured tiles
  tiki torches            (9, 2) and (14, 2)
  palms                   (3, 5) and (20, 11)
"""
import bricks
from bricks import Model, rect_key, row, fill_rect
from bricks import RBROWN, TAN, DTAN, DBG, BLACK, GREEN, BRORANGE
from walls import WallRing
from compact import compact_project, display_base, finish_ground, palm

THATCH, LAYER, TIMBER, GLASS, ROCK, FLAME = TAN, DTAN, RBROWN, BLACK, DBG, BRORANGE

# reddish brown bricks that are Bestsellers (checked with avail.py; the 1 x 8 is not)
bricks.ALLOWED[("b", RBROWN)] = bricks._sizes("1x1 1x2 1x3 1x4 1x6")

PROJECT = compact_project(
    slug="polynesian",
    title="Polynesian Village Resort",
    resort="Disney's Polynesian Village Resort",
    category="Deluxe",
    merged=["Disney's Polynesian Villas & Bungalows",
            "Island Tower at Disney's Polynesian Village Resort"],
    about=("The Great Ceremonial House of the Polynesian: a longhouse under a very tall, "
           "steep thatched A-frame roof, with a dark timber gable and a tall window over the "
           "entrance and the ridge beam sticking out at the top. Two tiki torches stand on "
           "the sandy forecourt and two palms on the lawn."),
    features=["The Great Ceremonial House: a longhouse under a very tall, steep A-frame roof",
              "The thatch: tan 65-degree slopes laid in layers with dark tan edges",
              "The dark timber gable front with a tall window over the entrance, and the "
              "ridge beam sticking out over it",
              "Two tiki torches with orange flames by the door",
              "Two palms on the lawn"],
    omitted=["Most of the longhouse's length (the kit shows its gable end and a short "
             "length)",
             "The guest longhouses, the villas, the bungalows and Island Tower",
             "The porte-cochere, the beach, the lagoon and most of the gardens"],
    colour_rows=[("Tan", "Brick Yellow", "Tan"), ("Dark Tan", "Sand Yellow", "Dark Tan"),
                 ("Reddish Brown", "Reddish Brown", "Reddish Brown"),
                 ("Black", "Black", "Black"),
                 ("Dark Bluish Gray", "Dark Stone Grey", "Dark Bluish Gray"),
                 ("Orange", "Bright Orange", "Orange"), ("Green", "Dark Green", "Green")],
    organisation=["The display base, the lawn and the forecourt", "The Great Ceremonial House",
                  "The tiki torches and the palms (build 2 of each)"],
    sub_info={
        "ceremonial_house.ldr": (
            "The Great Ceremonial House",
            "A low storey of timber and glass, then the steep roof one course at a time: "
            "a dark tan tie plate on each side, the tan slopes on it, and the timber gable "
            "between them."),
        "torch.ldr": ("The tiki torches", "A brown post with an orange flame."),
        "palm.ldr": ("The palms", "A trunk of round bricks and two layers of fronds."),
    },
    legend=("torch.ldr", 1),
    tips=["The roof goes up one course at a time: first the dark tan plates, then the tan "
          "slopes on them, then the reddish brown bricks of the gables at the front and back.",
          "Each slope sits on the dark tan plate below it. Press every slope down firmly "
          "before the next plates go on: they lock the slopes together.",
          "A <b>&ldquo;Build 2&rdquo;</b> badge means you build that module twice."],
    build_time="about 1 to 1&frac12; hours",
)

RW, D = 10, 10                     # roof width (eave to eave) and depth of the house
HX, HZ = 7, 4                      # house corner on the base
K = RW // 2 - 1                    # roof courses: 0 .. K-1
TORCHES = ((9, 2), (14, 2))
PALMS = ((3, 5), (20, 11))
DOOR = (RW // 2 - 1, RW // 2)


def place_rect(m, kind, colour, x, z, sx, sz, layer):
    """A sx by sz plate or tile (sizes checked with avail.py, not the kit's short list)."""
    key, rot = rect_key(kind, sx, sz)
    return m.add(key, colour, x, z, layer, rot=rot)


def strip_z(m, colour, x, length, layer, z0=0):
    """A 2-wide strip of plates along z (2x6 and 2x4)."""
    z = z0
    for n in _split(length, (6, 4, 2)):
        place_rect(m, "p", colour, x, z, 2, n, layer)
        z += n


def _split(n, sizes):
    out = []
    while n:
        s = next(s for s in sizes if s <= n)
        out.append(s)
        n -= s
    return out


def wall_mat(x, z):
    """The storey under the eaves: timber posts and dark glass."""
    if z == 0:
        if x in DOOR:
            return None                         # the entrance
        return TIMBER if x in (1, min(DOOR) - 1, max(DOOR) + 1, RW - 2) else GLASS
    if z == D - 1:
        return TIMBER
    return GLASS if z % 3 == 2 else TIMBER


def gable_mat(x, k, r, front):
    """Timber gable; at the front a tall glass window rises over the entrance."""
    if front and x in DOOR and (k == 0 or (k == 1 and r == 0)):
        return GLASS
    return TIMBER


def pattern_row(m, z, x0, x1, layer, colour_at):
    """Bricks from x0 to x1 (inclusive), a run per colour."""
    x = x0
    while x <= x1:
        c = colour_at(x)
        x2 = x
        while x2 + 1 <= x1 and colour_at(x2 + 1) == c:
            x2 += 1
        row(m, "b", c, x, z, x2 - x + 1, layer)
        x = x2 + 1


def build_house():
    m = Model("ceremonial_house.ldr", "Great Ceremonial House")
    fill_rect(m, "p", ROCK, 0, 0, RW, D, 0, along="z")
    m.step()
    ring = WallRing([(1, 0), (RW - 2, 0), (RW - 2, D - 1), (1, D - 1)])

    def mat(x, z, layer):
        c = wall_mat(x, z)
        return None if c is None else ("b", c)
    ring.course(m, 1, 0, mat)
    m.add("t1x2", THATCH, min(DOOR), 0, 1)        # the doorstep
    m.step()
    # the eave deck: the edges of the thatch at the sides, a timber beam across the gables
    strip_z(m, LAYER, 0, D, 4)
    strip_z(m, LAYER, RW - 2, D, 4)
    for z in (0, D - 1):
        row(m, "p", TIMBER, 2, z, RW - 4, 4)
    m.step()
    base = 5
    for k in range(K):
        L = base + 7 * k                         # bottom of this course's slopes
        if k:
            # tie plates under the slopes (the layers of thatch), timber across the gables
            if k == 1:
                m.step("The dark tan plates are the edges of the thatch layers; they also "
                       "lock the slopes below together.")
            strip_z(m, LAYER, k, D, L - 1)
            strip_z(m, LAYER, RW - 2 - k, D, L - 1)
            for z in (0, D - 1):
                row(m, "p", TIMBER, k + 2, z, RW - 4 - 2 * k, L - 1)
            m.step()
        for z in range(D):
            m.add("slope65", THATCH, k, z, L, rot=90)
            m.add("slope65", THATCH, RW - 2 - k, z, L, rot=270)
        m.step()
        if RW - 4 - 2 * k > 0:
            for z in (0, D - 1):
                for r in (0, 1):
                    pattern_row(m, z, k + 2, RW - 3 - k, L + 3 * r,
                                lambda x, k=k, r=r, z=z: gable_mat(x, k, r, z == 0))
        m.step()
    # the ridge: a timber beam along the top, sticking out over the front gable
    top = base + 7 * (K - 1) + 6
    rx = K - 1 + 1
    place_rect(m, "p", TIMBER, rx, -1, 2, 6, top)
    place_rect(m, "p", TIMBER, rx, 5, 2, 6, top)
    m.step()
    for z in range(-1, D + 1):
        m.add("cheese", THATCH, rx, z, top + 1, rot=90)
        m.add("cheese", THATCH, rx + 1, z, top + 1, rot=270)
    m.step()
    m.width, m.depth = RW, D
    return m


def build_torch():
    m = Model("torch.ldr", "Tiki torch")
    m.add("round1", TIMBER, 0, 0, 0)
    m.step()
    m.add("leaves1", FLAME, 0, 0, 3)
    m.add("cone1", FLAME, 0, 0, 4)
    m.step()
    m.width, m.depth = 1, 1
    return m


def build_main(house, torch, tree):
    m = Model("polynesian_compact.ldr", "Polynesian Village Resort (compact)")
    m.header_notes = ["Compact resort collection; generated by design.py (lego-kit)."]
    m.section("The display base", "The base and the black band are the same for every kit in "
              "the collection. The lawn and a sandy forecourt go on next.")
    band = display_base(m)
    reserved = set(band) | set(TORCHES) | set(PALMS)
    reserved |= {(HX + x, HZ + z) for x in range(RW) for z in range(D)}

    def ground(x, z):
        return TAN if (z < HZ and HX - 1 <= x <= HX + RW) else GREEN
    finish_ground(m, reserved, GREEN, colour_at=ground)
    m.step()
    m.sub(house, HX, HZ, 1)
    m.step()
    m.section("The tiki torches and the palms", "Two tiki torches on the forecourt and two "
              "palms on the lawn.")
    for tx, tz in TORCHES:
        m.sub(torch, tx, tz, 1)
    m.step()
    for px, pz in PALMS:
        m.sub(tree, px, pz, 1)
    m.step()
    return m


def build():
    house, torch, tree = build_house(), build_torch(), palm()
    main_m = build_main(house, torch, tree)
    return main_m, [main_m, house, torch, tree]
